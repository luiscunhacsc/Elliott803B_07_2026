/**
 * Elliott 803B simple assembler (Tim Baldwin compatible subset)
 */
class Assembler {
    static assemble(source) {
        const symbols = new Map();
        const sourceCode = [];
        let loadDirective = null;
        let triggerDirective = null;

        const rawLines = source.split(/\r?\n/);

        const addSymbol = (label, offset, lineNo) => {
            if (symbols.has(label)) {
                throw new Error(`Line ${lineNo}: Symbol defined more than once: ${label}`);
            }
            symbols.set(label, offset);
        };

        const isInteger = (s) => /^[+-]?\d+$/.test(s);
        const isFloat = (s) => /^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:@[+-]?\d+)?$/.test(s);
        const isLabel = (s) => /^[A-Za-z]\w*$/.test(s);

        const isConstantToken = (s) => isInteger(s) || isFloat(s) || isLabel(s);
        const isConstantLine = (line) => {
            const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
            if (parts.length === 0) return false;
            return parts.every((p) => isConstantToken(p));
        };

        const isCodeLine = (line) => /^[0-7]{2}\s+\S+(?:\s*[:/]\s*[0-7]{2}\s+\S+)?$/.test(line);

        const pushString = (text, lineNo) => {
            const tc = Assembler.charToTelecode(text);
            for (const ch of tc) {
                sourceCode.push({ lineNo, source: String(ch) });
            }
        };

        for (let i = 0; i < rawLines.length; i++) {
            const lineNo = i + 1;
            let line = rawLines[i];
            const comment = line.indexOf('*');
            if (comment >= 0) line = line.substring(0, comment);
            line = line.trim();
            if (!line) continue;

            // Consume one or more labels at the front of the line.
            for (;;) {
                const m = line.match(/^([A-Za-z]\w*)\s*:\s*(.*)$/);
                if (!m) break;
                addSymbol(m[1], sourceCode.length, lineNo);
                line = m[2].trim();
                if (!line) break;
            }
            if (!line) continue;

            if (line.startsWith('=')) {
                if (loadDirective !== null) throw new Error(`Line ${lineNo}: Load directive already set`);
                const addr = line.substring(1).trim();
                if (!/^\d{1,4}$/.test(addr)) throw new Error(`Line ${lineNo}: Incorrect load directive: ${line}`);
                loadDirective = { lineNo, source: line };
                continue;
            }

            if (line.startsWith('@')) {
                if (triggerDirective !== null) throw new Error(`Line ${lineNo}: Entry directive already set`);
                const target = line.substring(1).trim();
                if (!(/^\d{1,4}$/.test(target) || /^[A-Za-z]\w*$/.test(target))) {
                    throw new Error(`Line ${lineNo}: Incorrect entry directive: ${line}`);
                }
                triggerDirective = { lineNo, source: line };
                continue;
            }

            if (/^'.*'$/.test(line)) {
                pushString(line.slice(1, -1), lineNo);
                continue;
            }

            if (isConstantLine(line)) {
                const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
                for (const p of parts) {
                    sourceCode.push({ lineNo, source: p });
                }
                continue;
            }

            if (isCodeLine(line)) {
                sourceCode.push({ lineNo, source: line });
                continue;
            }

            throw new Error(`Line ${lineNo}: Syntax error: ${line}`);
        }

        let loadAddress;
        if (loadDirective) {
            loadAddress = parseInt(loadDirective.source.substring(1).trim(), 10);
        } else {
            loadAddress = 8192 - sourceCode.length;
        }

        if (loadAddress < 0 || loadAddress > 8191) {
            throw new Error(`Load address out of range: ${loadAddress}`);
        }

        for (const [k, v] of symbols.entries()) {
            symbols.set(k, v + loadAddress);
        }

        let triggerAddress = -1;
        if (triggerDirective) {
            const target = triggerDirective.source.substring(1).trim();
            if (/^\d{1,4}$/.test(target)) {
                triggerAddress = parseInt(target, 10);
            } else if (symbols.has(target)) {
                triggerAddress = symbols.get(target);
            } else {
                throw new Error(`Line ${triggerDirective.lineNo}: Incorrect entry point: ${triggerDirective.source}`);
            }
        }

        const objectCode = [];

        for (const s of sourceCode) {
            const src = s.source;

            if (isInteger(src)) {
                const n = BigInt(src.startsWith('+') ? src.slice(1) : src);
                objectCode.push(Assembler.asWord(n));
                continue;
            }

            if (isFloat(src)) {
                const value = Number(src.replace('@', 'e'));
                if (!Number.isFinite(value)) throw new Error(`Line ${s.lineNo}: Float value out of range: ${src}`);
                const w = Assembler.floatToWord(value);
                if (w === null) throw new Error(`Line ${s.lineNo}: Float value out of range: ${src}`);
                objectCode.push(w);
                continue;
            }

            if (isLabel(src)) {
                if (!symbols.has(src)) throw new Error(`Line ${s.lineNo}: Unresolved symbol: ${src}`);
                objectCode.push(Assembler.asWord(BigInt(symbols.get(src))));
                continue;
            }

            const word = Assembler.parseCodeLine(src, symbols, s.lineNo);
            objectCode.push(word);
        }

        const tape = [];
        Assembler.pushWordToTape(tape, BigInt(loadAddress - 4));
        for (const w of objectCode) {
            Assembler.pushWordToTape(tape, w);
        }

        if (triggerAddress !== -1) {
            const pad = 8192 - (loadAddress + objectCode.length);
            for (let i = 0; i < pad + 4; i++) {
                Assembler.pushWordToTape(tape, 0n);
            }

            const trigInstr2 = (BigInt(0o22) << 13n) | BigInt(triggerAddress - 4);
            const trigWord = trigInstr2;
            Assembler.pushWordToTape(tape, trigWord);
            Assembler.pushWordToTape(tape, 0n);
        }

        return {
            data: new Uint8Array(tape),
            entry: triggerAddress !== -1 ? triggerAddress : loadAddress,
            storeImage: objectCode.map((w, i) => ({ addr: loadAddress + i, val: w }))
        };
    }

    static asWord(v) {
        return BigInt(v) & 0x7FFFFFFFFFn;
    }

    static parseCodeLine(line, symbols, lineNo) {
        const parts = line.split(/([:/])/).map((x) => x.trim()).filter((x) => x.length > 0);

        const parseInstruction = (text) => {
            const m = text.match(/^([0-7]{2})\s+(\S+)$/);
            if (!m) throw new Error(`Line ${lineNo}: Invalid instruction: ${text}`);

            const op = parseInt(m[1], 8);
            const target = m[2];
            let addr;

            if (/^\d{1,4}$/.test(target)) {
                addr = parseInt(target, 10);
            } else if (/^[A-Za-z]\w*$/.test(target)) {
                if (!symbols.has(target)) throw new Error(`Line ${lineNo}: Unresolved symbol: ${target}`);
                addr = symbols.get(target);
            } else {
                throw new Error(`Line ${lineNo}: Invalid address: ${target}`);
            }

            if (addr < 0 || addr > 8191) {
                throw new Error(`Line ${lineNo}: Address out of range: ${addr}`);
            }

            return (BigInt(op) << 13n) | BigInt(addr);
        };

        const i1 = parseInstruction(parts[0]);
        let b = 0n;
        let i2 = 0n;

        if (parts.length >= 3) {
            b = parts[1] === '/' ? 1n : 0n;
            i2 = parseInstruction(parts[2]);
        }

        return (i1 << 20n) | (b << 19n) | i2;
    }

    static pushWordToTape(tape, wordVal) {
        const bytes = new Uint8Array(8);
        let temp = Assembler.asWord(wordVal);
        for (let i = 7; i >= 0; i--) {
            bytes[i] = Number(temp & 0x1Fn);
            temp >>= 5n;
        }
        bytes[0] |= 0x10;
        for (const b of bytes) tape.push(b);
    }

    static floatToWord(value) {
        if (value === 0) return 0n;

        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        dv.setFloat64(0, value, false);
        const bits = dv.getBigUint64(0, false);

        const IEEE_EXP_MASK = 0x7FFn;
        const IEEE_FRAC_MASK = 0xFFFFFFFFFFFFFn;
        const IEEE_HIDDEN_BIT = 0x10000000000000n;
        const IEEE_TOP_BITS = 0x30000000000000n;

        const FP_FRAC_MASK = 0x3FFFFFFFn;

        const ds = Number(bits >> 63n);
        let de = Number((bits >> 52n) & IEEE_EXP_MASK) - 1023;
        let df = (bits & IEEE_FRAC_MASK) | IEEE_HIDDEN_BIT;

        if (ds !== 0) df = -df;

        while ((df & IEEE_TOP_BITS) === 0n || (df & IEEE_TOP_BITS) === IEEE_TOP_BITS) {
            df <<= 1n;
            de -= 1;
        }

        const a = (df >> 24n) & FP_FRAC_MASK;
        const b = de + 257;

        if (b > 511) return null;
        if (b < 0) return 0n;

        return (a << 9n) | BigInt(b);
    }

    static charToTelecode(text) {
        const out = [];
        let isFigure = false;
        let first = true;

        const letterUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const letterLower = 'abcdefghijklmnopqrstuvwxyz';
        const figurePrimary = "12*4$=78',+:-.%0()3?56/@9£";

        const figureMap = new Map();
        for (let i = 0; i < figurePrimary.length; i++) {
            figureMap.set(figurePrimary[i], i + 1);
        }

        figureMap.set('&', 5);
        figureMap.set(';', 9);
        figureMap.set('[', 17);
        figureMap.set(']', 18);
        figureMap.set('!', 20);
        figureMap.set('}', 20);
        figureMap.set('\\', 23);
        figureMap.set('#', 26);
        figureMap.set('{', 26);

        const ls = 31;
        const fs = 27;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];

            let li = letterUpper.indexOf(ch);
            if (li < 0) li = letterLower.indexOf(ch);
            if (li >= 0) {
                if (first || isFigure) {
                    out.push(ls);
                    first = false;
                    isFigure = false;
                }
                out.push(li + 1);
                continue;
            }

            const fi = figureMap.get(ch);
            if (fi !== undefined) {
                if (first || !isFigure) {
                    out.push(fs);
                    first = false;
                    isFigure = true;
                }
                out.push(fi);
                continue;
            }

            if (ch === '\0' || ch === '_') {
                out.push(0);
            } else if (ch === ' ' || ch === '\t') {
                out.push(28);
            } else if (ch === '\r') {
                out.push(29);
            } else if (ch === '\n') {
                out.push(30);
            }
        }

        return out;
    }
}

window.Assembler = Assembler;
