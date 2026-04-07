class Store {
    constructor() {
        this.size = 8192;
        this.data = new BigInt64Array(this.size);
        this.MASK_39 = 0x7FFFFFFFFFn;
        this.reset();
    }

    reset() {
        this.data.fill(0n);

        const asm = (o1, a1, b, o2, a2) => {
            const i1 = (BigInt(o1) << 13n) | BigInt(a1);
            const i2 = (BigInt(o2) << 13n) | BigInt(a2);
            let word = (i1 << 20n) | i2;
            if (b) word |= 0x80000n;
            return word;
        };

        this.data[0] = asm(0o26, 4, false, 0o06, 0);
        this.data[1] = asm(0o22, 4, true, 0o16, 3);
        this.data[2] = asm(0o55, 5, false, 0o71, 0);
        this.data[3] = asm(0o43, 1, false, 0o40, 2);
    }

    // Data read: returns 0 for initial instruction addresses (0-3)
    read(address) {
        if (address < 0 || address >= this.size) return 0n;
        if (address < 4) return 0n;
        return this.data[address] & this.MASK_39;
    }

    // Instruction fetch: returns initial instructions for addresses 0-3
    fetch(address) {
        if (address < 0 || address >= this.size) return 0n;
        return this.data[address] & this.MASK_39;
    }

    clear() {
        for (let i = 4; i < this.size; i++) {
            this.data[i] = 0n;
        }
    }

    write(address, value) {
        if (address < 0 || address >= this.size) return;
        if (address < 4) return; // Cannot overwrite initial instructions
        this.data[address] = BigInt(value) & this.MASK_39;

        if (window.updateStoreView) {
            window.updateStoreView(address, this.data[address]);
        }
    }
}

window.Store = Store;
