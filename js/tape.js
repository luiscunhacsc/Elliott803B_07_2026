class Tape {
    constructor() {
        this.data = new Uint8Array(0);
        this.ptr = 0;
        this.name = 'Untitled';

        this.figures = "#12*4$=78',+:-.%0()3?56/@9#     ";
        this.letters = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ     ';
    }

    loadBytes(bytes) {
        this.data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
        this.ptr = 0;
    }

    loadText(text) {
        const out = [];
        let isFigure = false;
        let isFirst = true;

        const letterUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const letterLower = 'abcdefghijklmnopqrstuvwxyz';
        const figureShift = "12*4$=78',+:-.%0()3?56/@9£";
        const figureAlt = "    &   ;       [] !  \\  #";
        const figureAlt2 = "                   }     {";

        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);

            const li = Math.max(letterUpper.indexOf(ch), letterLower.indexOf(ch));
            if (li >= 0) {
                if (isFirst || isFigure) {
                    out.push(31); // LS
                    isFirst = false;
                    isFigure = false;
                }
                out.push(li + 1);
                continue;
            }

            let fi = figureShift.indexOf(ch);
            if (fi < 0 && ch !== ' ') fi = figureAlt.indexOf(ch);
            if (fi < 0 && ch !== ' ') fi = figureAlt2.indexOf(ch);
            if (fi >= 0) {
                if (isFirst || !isFigure) {
                    out.push(27); // FS
                    isFirst = false;
                    isFigure = true;
                }
                out.push(fi + 1);
                continue;
            }

            if (ch === '\0' || ch === '_') {
                out.push(0);
                continue;
            }
            if (ch === ' ' || ch === '\t') {
                out.push(28);
                continue;
            }
            if (ch === '\r') {
                out.push(29);
                continue;
            }
            if (ch === '\n') {
                out.push(30);
                continue;
            }
        }

        // Ensure text tapes end with an explicit end-of-tape mark.
        if (out.length === 0 || out[out.length - 1] !== 0) {
            out.push(0);
        }

        this.loadBytes(new Uint8Array(out));
    }

    loadUnknown(content) {
        if (content instanceof Uint8Array) {
            this.loadBytes(content);
            return;
        }

        if (typeof content !== 'string') {
            this.loadBytes(new Uint8Array(0));
            return;
        }

        let binary = true;
        for (let i = 0; i < content.length; i++) {
            if (content.charCodeAt(i) > 31) {
                binary = false;
                break;
            }
        }

        if (binary) {
            const bytes = new Uint8Array(content.length);
            for (let i = 0; i < content.length; i++) {
                bytes[i] = content.charCodeAt(i) & 0x1F;
            }
            this.loadBytes(bytes);
            return;
        }

        this.loadText(content);
    }

    read() {
        if (!this.hasMore()) return 0;
        return this.data[this.ptr++] & 0x1F;
    }

    hasMore() {
        return this.ptr < this.data.length;
    }
}

class TapeReader {
    constructor() {
        this.tape = null;
    }

    loadTape(tape) {
        this.tape = tape;
    }

    read() {
        if (!this.tape) return 0;
        return this.tape.read();
    }

    isReady() {
        return !!(this.tape && this.tape.hasMore());
    }
}

class TapePunch {
    constructor() {
        this.data = [];
    }

    write(ch) {
        this.data.push(ch & 0x1F);
    }

    clear() {
        this.data = [];
    }

    getData() {
        return new Uint8Array(this.data);
    }

    hasData() {
        return this.data.length > 0;
    }
}

window.Tape = Tape;
window.TapeReader = TapeReader;
window.TapePunch = TapePunch;
