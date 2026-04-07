/**
 * Elliott 803B ALU
 * 
 * Ports the logic from ALU.java to JavaScript using BigInt for 39-bit arithmetic.
 */
class ALU {
    constructor(cpu) {
        this.cpu = cpu;
        this.overflow = false;
        // Constants
        this.BITS39 = 0x7FFFFFFFFFn;
        this.SIGNBIT = 0x4000000000n; // Bit 39
        this.INT_MASK = 0x3FFFFFFFFFn; // 38 bits
        this.WORD_MASK = 0x7FFFFFFFFFn;

        this.extension = 0n;
    }

    /**
     * Sign extend 39-bit word to BigInt (which is arbitrary precision, effectively infinite bits)
     */
    getLong(word) {
        // If sign bit (39) is set, treat as negative 39-bit integer
        if ((word & this.SIGNBIT) !== 0n) {
            return word | ~this.INT_MASK; // Accessing BigInt internals via bitwise NOT? No, in JS ~BigInt works.
            // Wait, ~this.INT_MASK will handle the bits UP TO the width of the BigInt implementation?
            // JS BigInts are conceptually infinite width. ~INT_MASK will flip all bits above 38.
            // (word & INT_MASK) | ~INT_MASK results in ...11111111111[word_bits].
            // This effectively sign extends it to infinity (which JS represents correctly as a negative number).
            // Let's verify: 
            // INT_MASK = 0x3F...F (38 ones)
            // ~INT_MASK = -0x40...0 (Infinite ones, then zeroes at 0-38?)
            // Actually: ~N = -(N+1). 
            // Correct logic: return (word & INT_MASK) - (1n << 38n); if we want value?
            // Reference: ((word & SIGN_BIT) == 0) ? (word & INT_MASK) : (word | ~INT_MASK);
            // This Java logic assumes 64-bit Long. In JS BigInt, we can just subtract 2^39 if bit 39 is set?
            // Or simpler:
            // let val = word & this.INT_MASK;
            // if ((word & this.SIGNBIT) !== 0n) val -= (1n << 38n) * 2n; // i.e. - 2^39
            // return val;
        }
        return word & this.INT_MASK;
    }

    // Better helper for "interpret 39 bits as signed BigInt"
    toSigned(word) {
        let val = word & this.BITS39;
        if ((val & this.SIGNBIT) !== 0n) {
            // It's negative. 
            // 39-bit two's complement.
            // Value = val - 2^39
            return val - (1n << 39n);
        }
        return val;
    }

    // Convert signed BigInt back to 39-bit word
    toWord(val) {
        return val & this.BITS39;
    }

    checkOverflow(result) {
        // Result is a BigInt. 
        // We need to check if it fits in 39-bit signed range.
        // Range: -2^38 to 2^38 - 1
        // Min: -274877906944
        // Max:  274877906943

        const min = -(1n << 38n);
        const max = (1n << 38n) - 1n;

        if (result < min || result > max) {
            this.overflow = true;
        }
    }

    add(n1, n2) {
        let v1 = this.toSigned(n1);
        let v2 = this.toSigned(n2);
        let res = v1 + v2;
        this.checkOverflow(res);
        return this.toWord(res);
    }

    sub(n1, n2) {
        let v1 = this.toSigned(n1);
        let v2 = this.toSigned(n2);
        let res = v1 - v2;
        this.checkOverflow(res);
        return this.toWord(res);
    }

    and(n1, n2) {
        // Bitwise AND doesn't care about sign extension usually, but reference uses it.
        // "Sign extend... perform operation... reduce".
        // For AND, sign extension matters if top bits are involved. 
        // But result is masked to 39 bits anyway.
        let res = n1 & n2;
        // Reference checks overflow? "checkOverflow(result)". 
        // Java: result = n1 & n2 (Longs). 
        // If result logic produces something outside 39 bit range? Impossible for AND.
        // But Reference implements it, let's stick to simple & and mask.
        return this.toWord(res);
    }

    shr(n1, shift) {
        // Logical right shift? Reference: "Right shift needs an unsigned value... cannot overflow"
        // But it shifts "n1" (39 bits).
        let val = n1 & this.BITS39; // Unsigned view
        let res = val >> BigInt(shift);
        return this.toWord(res);
    }

    shl(n1, shift) {
        // Left shift needs signed value for overflow detection
        let val = this.toSigned(n1);
        let res = val << BigInt(shift);
        this.checkOverflow(res);
        return this.toWord(res);
    }

    mul(n1, n2) {
        let v1 = this.toSigned(n1);
        let v2 = this.toSigned(n2);
        let res = v1 * v2;

        // Result can be up to 78 bits.
        // Check overflow for single word result ( > 38 bits)
        // Reference: overflow = bigResult.bitLength() > 38;
        // Strict check: if it doesn't fit in 39-bit signed
        this.checkOverflow(res);

        return this.toWord(res);
    }

    isZero(n) {
        return (n & this.BITS39) === 0n;
    }

    isNeg(n) {
        return (n & this.SIGNBIT) !== 0n; // Bit 39 set
    }

    getOverflow() {
        return this.overflow;
    }

    clearOverflow() {
        this.overflow = false;
    }

    // --- Double Length Operations (Group 5) ---
    // These operate on (n1, nx) as a 77-bit integer? 
    // Reference: "Operate on 77 bit value form by n1 and nx... n1 forming most significant bits"
    // Format: [n1 (39 bits)] [nx (38 bits)]?
    // Reference Word.java: makeBig(n, nx): valueOf(n).shiftLeft(38).or(valueOf(nx))
    // So it's n (39 bits) + nx (38 bits lower).

    makeDouble(n1, nx) {
        let v1 = this.toSigned(n1);
        // Shift v1 left by 38
        let upper = v1 << 38n;
        // nx is treated as unsigned 38 bits? 
        // Reference: nx & INT_MASK (38 bits)
        let lower = nx & this.INT_MASK;
        return upper | lower;
    }

    splitDouble(bigRes) {
        // Extract top 39 bits for Acc, bottom 38 for Aux
        // "makeLong2(result)"
        // extension = result & INT_MASK
        // acc = result >> 38

        // Handling signed BigInt right shift:
        // result >> 38n should preserve sign.

        let accVal = bigRes >> 38n;
        let extVal = bigRes & this.INT_MASK; // Bottom 38 bits

        this.extension = extVal;
        return this.toWord(accVal);
    }

    longMul(n1, n2) {
        let v1 = this.toSigned(n1);
        let v2 = this.toSigned(n2);
        let res = v1 * v2;

        // Overflow if > 76 bits?
        // Reference: result.bitLength() > 76
        // Range check: -2^76 to 2^76 - 1
        const min = -(1n << 76n);
        const max = (1n << 76n) - 1n;
        if (res < min || res > max) this.overflow = true;

        return this.splitDouble(res);
    }

    longDiv(n1, nx, n2) {
        let dividend = this.makeDouble(n1, nx);
        let divisor = this.toSigned(n2);

        if (divisor === 0n) {
            this.overflow = true;
            this.extension = 0n;
            return 0n; // Undefined/Zero
        }

        let res = dividend / divisor;
        // Overflow check similar to mul
        const min = -(1n << 76n);
        const max = (1n << 76n) - 1n;
        if (res < min || res > max) this.overflow = true;

        // Just return the quotient as single word? 
        // Reference: returns makeLong1(result) -> extension=0, return asInteger.
        // Wait, longDiv in reference:
        // overflow = result.bitLength() > 76 -- Wait, quotient shouldn't be that large usually?
        // Ah, "makeLong1" sets extension = 0.
        this.extension = 0n;
        return this.toWord(res);
    }

    longShr(n1, nx, shift) {
        let val = this.makeDouble(n1, nx);
        let res = val >> BigInt(shift);
        return this.splitDouble(res);
    }

    longShl(n1, nx, shift) {
        let val = this.makeDouble(n1, nx);
        let res = val << BigInt(shift);

        // Check overflow (must fit in 77 bits?)
        const min = -(1n << 76n);
        const max = (1n << 76n) - 1n;
        if (res < min || res > max) this.overflow = true;

        return this.splitDouble(res);
    }

    getExtension() {
        return this.extension;
    }
}

window.ALU = ALU;
