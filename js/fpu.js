class FPU {
    constructor(cpu) {
        this.cpu = cpu;
        this.overflow = false;
        this.fpOverflow = false;

        this.WORD_MASK = 0x7FFFFFFFFFn;
        this.INT_MASK = 0x3FFFFFFFFFn;
        this.SIGNBIT = 0x4000000000n;

        this.FP_FRAC_MASK = 0x3FFFFFFFn;
        this.FP_EXP_MASK = 0x1FFn;
        this.FP_FRAC_SIGN = 0x20000000;
        this.FP_FRAC_BITS = 0x1FFFFFFF;

        this.IEEE_EXP_MASK = 0x7FFn;
        this.IEEE_FRAC_MASK = 0xFFFFFFFFFFFFFn;
        this.IEEE_HIDDEN_BIT = 0x10000000000000n;
        this.IEEE_TOP_BITS = 0x30000000000000n;
    }

    getLong(word) {
        const w = word & this.WORD_MASK;
        if ((w & this.SIGNBIT) === 0n) return w & this.INT_MASK;
        return w | ~this.INT_MASK;
    }

    getDouble(word) {
        let w = this.getLong(word);
        if (w === 0n) return 0;

        let em = Number(w >> 9n);
        let ee = Number(w & this.FP_EXP_MASK) - 256;

        if (em === 0) return 0;

        let s = 0n;
        if (em < 0) {
            s = 1n;
            em = -em;
        }

        while ((em & this.FP_FRAC_SIGN) === 0) {
            em <<= 1;
            ee -= 1;
        }

        const a = (BigInt(em & this.FP_FRAC_BITS) << 23n) & this.IEEE_FRAC_MASK;
        const b = BigInt((ee + 1023) & 0x7FF);
        const bits = (s << 63n) | (b << 52n) | a;

        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        dv.setBigUint64(0, bits, false);
        return dv.getFloat64(0, false);
    }

    asFloat(value) {
        if (value === 0) return 0n;

        const buf = new ArrayBuffer(8);
        const dv = new DataView(buf);
        dv.setFloat64(0, value, false);
        const bits = dv.getBigUint64(0, false);

        const ds = Number(bits >> 63n);
        let de = Number((bits >> 52n) & this.IEEE_EXP_MASK) - 1023;
        let df = (bits & this.IEEE_FRAC_MASK) | this.IEEE_HIDDEN_BIT;

        if (ds !== 0) df = -df;

        while ((df & this.IEEE_TOP_BITS) === 0n || (df & this.IEEE_TOP_BITS) === this.IEEE_TOP_BITS) {
            df <<= 1n;
            de -= 1;
        }

        const a = (df >> 24n) & this.FP_FRAC_MASK;
        const b = de + 257;

        if (b > 511) return -1n;
        if (b < 0) return 0n;
        return ((a << 9n) | BigInt(b)) & this.WORD_MASK;
    }

    makeFloat(value) {
        const result = this.asFloat(value);
        this.overflow = false;
        this.fpOverflow = false;
        if (result === -1n) {
            this.fpOverflow = true;
            return 0n;
        }
        return result;
    }

    add(n1, n2) {
        return this.makeFloat(this.getDouble(n1) + this.getDouble(n2));
    }

    sub(n1, n2) {
        return this.makeFloat(this.getDouble(n1) - this.getDouble(n2));
    }

    mul(n1, n2) {
        return this.makeFloat(this.getDouble(n1) * this.getDouble(n2));
    }

    div(n1, n2) {
        if ((n2 & this.WORD_MASK) === 0n) {
            this.overflow = true;
            this.fpOverflow = true;
            return 0n;
        }
        return this.makeFloat(this.getDouble(n1) / this.getDouble(n2));
    }

    convert(n) {
        return this.makeFloat(Number(this.getLong(n)));
    }

    shl(n1, shift) {
        const s = shift % 39;
        const w = n1 & this.WORD_MASK;
        return ((w << BigInt(s)) | (w >> BigInt(39 - s))) & this.WORD_MASK;
    }

    sdiv(n1, n2) {
        if ((n2 & this.WORD_MASK) === 0n) return 0n;
        const q = this.getLong(n1) / this.getLong(n2);
        return q & this.WORD_MASK;
    }

    sqrt(n) {
        const v = Number(this.getLong(n));
        if (v < 0) return 0n;
        return (BigInt(Math.floor(Math.sqrt(v))) & this.WORD_MASK);
    }

    isOverflow() {
        return this.overflow;
    }

    isFpOverflow() {
        return this.fpOverflow;
    }
}

window.FPU = FPU;
