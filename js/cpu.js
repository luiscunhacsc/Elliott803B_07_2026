class CPU {
    constructor(store, tapeReaders, tapePunches, teletype, plotter, consoleDevice, devices) {
        this.store = store;
        this.tapeReaders = Array.isArray(tapeReaders) ? tapeReaders : [tapeReaders];
        this.tapePunches = Array.isArray(tapePunches) ? tapePunches : [tapePunches];
        this.teletype = teletype;
        this.plotter = plotter;
        this.console = consoleDevice;
        this.devices = devices || { controlWrite() { }, controlRead() { return null; } };

        this.alu = new ALU(this);
        this.fpu = new FPU(this);

        this.BITS39 = 0x7FFFFFFFFFn;
        this.SIGNBIT = 0x4000000000n;
        this.INSTR_MASK = 0x7FFFFn;
        this.NOTHING = -1n;

        this.reset();
    }

    reset() {
        this.accumulator = 0n;
        this.auxiliary = 0n;
        this.overflow = false;
        this.fpOverflow = false;
        this.busy = false;

        this.scr = 0;
        this.scr2 = 0;
        this.ir = 0n;
        this.irx = 0n;

        this.jumped = false;
        this.stopped = true;

        this.readerSelect = 0;
        this.punchSelect = 0;

        this.cycles = 2;
        this.lastCycles = 2;

        // Manual Data: when true, function-70 instructions pause until Operate is pressed
        this.manualDataEnabled = false;
        this.manualDataOperateLatch = false;

        this.alu.overflow = false;
        this.fpu.overflow = false;
        this.fpu.fpOverflow = false;

        this.fetch();
    }

    setReaderSelect(swapped) {
        this.readerSelect = swapped ? 1 : 0;
    }

    setPunchSelect(swapped) {
        this.punchSelect = swapped ? 1 : 0;
    }

    step() {
        this.obey();
    }

    obey() {
        this.execute();

        if (!this.jumped) {
            if (this.scr2 === 0) {
                this.scr2 = 1;
            } else {
                this.scr2 = 0;
                this.scr = (this.scr + 1) & 0x1FFF;
            }
        }

        this.fetch();

        // Selected Stop: check if the new SCR matches the N2 address on the word generator.
        // Per manual Section 3.2.2: machine stops when the instruction address matches N2.
        if (window.selectedStopActive && this.console) {
            const wg = this.console.read();
            const n2 = Number((wg) & 0x1FFFn); // N2 = bits 12-0
            if (this.scr === n2) {
                this.stopped = true;
                if (window.elliott) window.elliott.running = false;
            }
        }
    }

    fetch() {
        if (this.scr2 === 0) {
            this.ir = this.store.fetch(this.scr);
            this.irx = (this.ir >> 20n) & this.INSTR_MASK;
            return;
        }

        const b = (this.ir >> 19n) & 1n;
        if (this.jumped || b === 0n) {
            this.ir = this.store.fetch(this.scr);
            this.irx = this.ir & this.INSTR_MASK;
            return;
        }

        const bAddr = this.getAddr(this.irx);
        const bWord = this.store.read(bAddr);
        this.irx = ((this.ir & this.INSTR_MASK) + (bWord & this.INSTR_MASK)) & this.INSTR_MASK;
    }

    execute() {
        const op = this.getOp(this.irx);
        const addr = this.getAddr(this.irx);

        this.jumped = false;
        this.busy = false;
        this.cycles = 2;

        if (this.console) this.console.speakerSound(op > 0o37, 1);

        switch (op >> 3) {
            case 0:
            case 1:
            case 2:
            case 3:
                this.group0123(op, addr);
                break;
            case 4:
                this.group4(op, addr);
                break;
            case 5:
                this.group5(op, addr);
                break;
            case 6:
                this.group6(op, addr);
                break;
            case 7:
                this.group7(op, addr);
                break;
        }

        if (this.console) {
            this.console.speakerSound(false, Math.max(0, this.cycles - 1));
            this.console.setOverflow(this.overflow, this.fpOverflow);
            this.console.setBusy(this.busy);
        }

        this.lastCycles = this.cycles;

        if (typeof window.updateConsoleLights === 'function') {
            window.updateConsoleLights(this);
        }
    }

    group0123(op, addr) {
        const a = this.accumulator;
        const n = this.store.read(addr);
        const x = ((op & 0o10) === 0) ? a : n;

        let result = 0n;
        switch (op & 0o7) {
            case 0: result = this.alu.add(0n, x); break;
            case 1: result = this.alu.sub(0n, x); break;
            case 2: result = this.alu.add(1n, n); break;
            case 3: result = this.alu.and(a, n); break;
            case 4: result = this.alu.add(a, n); break;
            case 5: result = this.alu.sub(a, n); break;
            case 6: result = this.alu.add(0n, 0n); break;
            case 7: result = this.alu.sub(n, a); break;
        }

        this.overflow = this.overflow || this.alu.overflow;
        this.alu.overflow = false;

        let out = 0n;
        switch (op >> 3) {
            case 0:
                this.accumulator = result;
                out = n;
                break;
            case 1:
                this.accumulator = result;
                out = a;
                break;
            case 2:
                this.accumulator = a;
                out = result;
                break;
            case 3:
                this.accumulator = n;
                out = result;
                break;
        }

        this.store.write(addr, out);
        this.cycles = 2;
    }

    group4(op, addr) {
        switch (op & 0o3) {
            case 0:
                this.jumped = true;
                break;
            case 1:
                this.jumped = this.alu.isNeg(this.accumulator);
                break;
            case 2:
                this.jumped = this.alu.isZero(this.accumulator);
                break;
            case 3:
                this.jumped = this.overflow;
                this.overflow = false;
                break;
        }

        if (this.jumped) {
            this.scr = addr & 0x1FFF;
            this.scr2 = (op & 0o7) >> 2;
        }

        this.cycles = 1;
    }

    group5(op, addr) {
        const n = this.store.read(addr);
        const s = addr & 0x7F;

        if ((op & 0o1) !== 0) {
            switch (op & 0o7) {
                case 1:
                    this.accumulator = this.alu.shr(this.accumulator, s);
                    this.auxiliary = 0n;
                    this.cycles = s + 2;
                    break;
                case 5:
                    this.accumulator = this.alu.shl(this.accumulator, s);
                    this.auxiliary = 0n;
                    this.cycles = s + 2;
                    break;
                case 3:
                    this.accumulator = this.alu.mul(this.accumulator, n);
                    this.auxiliary = 0n;
                    this.cycles = 43 - this.y();
                    break;
                case 7:
                    this.accumulator = this.auxiliary;
                    this.cycles = 2;
                    break;
            }
        } else {
            switch (op & 0o7) {
                case 0:
                    this.accumulator = this.alu.longShr(this.accumulator, this.auxiliary, s);
                    this.cycles = s + 2;
                    break;
                case 4:
                    this.accumulator = this.alu.longShl(this.accumulator, this.auxiliary, s);
                    this.cycles = s + 2;
                    break;
                case 2:
                    this.accumulator = this.alu.longMul(this.accumulator, n);
                    this.cycles = 42 - this.y();
                    break;
                case 6:
                    this.accumulator = this.alu.longDiv(this.accumulator, this.auxiliary, n);
                    this.cycles = 42;
                    break;
            }
            this.auxiliary = this.alu.getExtension();
        }

        this.overflow = this.overflow || this.alu.overflow;
        this.alu.overflow = false;
    }

    group6(op, addr) {
        const n = this.store.read(addr);

        switch (op & 0o7) {
            case 0: this.accumulator = this.fpu.add(this.accumulator, n); this.cycles = 3; break;
            case 1: this.accumulator = this.fpu.sub(this.accumulator, n); this.cycles = 3; break;
            case 2: this.accumulator = this.fpu.sub(n, this.accumulator); this.cycles = 3; break;
            case 3: this.accumulator = this.fpu.mul(this.accumulator, n); this.cycles = 17; break;
            case 4: this.accumulator = this.fpu.div(this.accumulator, n); this.cycles = 34; break;
            case 5:
                if (addr < 4096) {
                    this.accumulator = this.fpu.shl(this.accumulator, addr % 64);
                    this.cycles = 2;
                } else {
                    this.accumulator = this.fpu.convert(this.accumulator);
                    this.cycles = 2;
                }
                break;
            case 6: this.accumulator = this.fpu.sdiv(this.accumulator, n); this.cycles = 16; break;
            case 7: this.accumulator = this.fpu.sqrt(this.accumulator); this.cycles = 15; break;
        }

        this.auxiliary = 0n;
        this.overflow = this.overflow || this.fpu.isOverflow();
        this.fpOverflow = this.fpOverflow || this.fpu.isFpOverflow();
        this.fpu.overflow = false;
        this.fpu.fpOverflow = false;
    }

    group7(op, addr) {
        switch (op & 0o7) {
            case 0:
                // Function 70: read word generator into accumulator.
                // If Manual Data is enabled (per manual Section 3.2.5), pause here
                // and wait for the Operate bar before transferring the value.
                if (this.manualDataEnabled) {
                    if (this.manualDataOperateLatch) {
                        // C version behavior (SS3): a single Operate press allows
                        // exactly one paused Fn70 to complete while Manual Data stays ON.
                        this.manualDataOperateLatch = false;
                        if (this.console && this.console.read) {
                            this.accumulator = this.console.read() & this.BITS39;
                        }
                    } else {
                        this.busy = true;
                        this.jumped = true; // re-execute this instruction next cycle
                    }
                } else if (this.console && this.console.read) {
                    this.accumulator = this.console.read() & this.BITS39;
                }
                break;

            case 1: {
                const idx = ((addr >= 2048) ? 1 : 0) ^ this.readerSelect;
                const reader = this.tapeReaders[idx];
                if (reader && reader.isReady()) {
                    this.accumulator = (this.accumulator | BigInt(reader.read())) & this.BITS39;
                } else {
                    this.busy = true;
                    this.jumped = true;
                }
                break;
            }

            case 2:
                this.devices.controlWrite(addr, this.accumulator);
                break;

            case 3: {
                const s = BigInt(this.scr & 0x1FFF);
                this.store.write(addr, (s << 20n) | s);
                break;
            }

            case 4: {
                const out = addr & 0x1F;
                if (addr >= 4096) {
                    if (this.teletype) this.teletype.write(out);
                } else {
                    const idx = ((addr >= 2048) ? 1 : 0) ^ this.punchSelect;
                    const punch = this.tapePunches[idx];
                    if (punch) punch.write(out);
                }
                break;
            }

            case 5: {
                const value = this.devices.controlRead(addr);
                if (value !== null && value !== undefined && value !== this.NOTHING) {
                    this.accumulator = BigInt(value) & this.BITS39;
                }
                break;
            }

            case 6:
            case 7:
                break;
        }
    }

    y() {
        let y = 0;
        let a = this.accumulator & this.BITS39;
        const bit = a & this.SIGNBIT;
        while (y < 39 && (a & this.SIGNBIT) === bit) {
            y++;
            a = (a << 1n) & this.BITS39;
        }
        return y;
    }

    getOp(instr) {
        return Number((instr >> 13n) & 0x3Fn);
    }

    getAddr(instr) {
        return Number(instr & 0x1FFFn);
    }
}

window.CPU = CPU;
