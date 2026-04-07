/**
 * Elliott 803B Core Loader
 * 
 * Loads .803/.img binary core dumps into the Store.
 * Format:
 * [Address (4 bytes, Big Endian)]
 * [Count (4 bytes, Big Endian)]
 * [Word (8 bytes, Big Endian)] * Count
 * ... Repeated until Address == 0
 */
class CoreLoader {
    constructor(store) {
        this.store = store;
    }

    readInt64BE(view, offset) {
        // Modern path.
        if (typeof view.getBigInt64 === 'function') {
            return view.getBigInt64(offset, false);
        }

        // Compatibility path for older browsers that lack DataView#getBigInt64.
        const hi = view.getUint32(offset, false);
        const lo = view.getUint32(offset + 4, false);
        let value = (BigInt(hi) << 32n) | BigInt(lo);
        if ((hi & 0x80000000) !== 0) {
            value -= (1n << 64n);
        }
        return value;
    }

    /**
     * Load binary ArrayBuffer into Store
     * @param {ArrayBuffer} buffer 
     */
    load(buffer) {
        const view = new DataView(buffer);
        let offset = 0;
        let totalWords = 0;

        console.log("Loading Core Image...");

        while (offset < view.byteLength) {
            // Read Address
            if (offset + 4 > view.byteLength) break;
            const address = view.getInt32(offset, false); // Big Endian
            offset += 4;

            // Read Count
            if (offset + 4 > view.byteLength) break;
            const count = view.getInt32(offset, false);
            offset += 4;

            // Check for Terminator (Address 0, Count 0) - or just strict usage?
            // Some dumps might use -1. But if we see 0, 0 it's definitely end.
            // If Address is 0 but Count > 0, IT IS VALID DATA at 0.
            if (address === 0 && count === 0) {
                console.log("End of Core Image (Terminator)");
                break;
            }

            if (address < 0 || address > 8191) {
                throw new Error(`Invalid core block address: ${address}`);
            }
            if (count <= 0 || (address + count) > 8192) {
                throw new Error(`Invalid core block count: ${count} at ${address}`);
            }

            console.log(`Loading block: Addr ${address}, Count ${count}`);

            // Read Words
            for (let i = 0; i < count; i++) {
                if (offset + 8 > view.byteLength) {
                    throw new Error("Unexpected EOF in Core Image");
                }

                // Read 64-bit BigInt
                const word = this.readInt64BE(view, offset);
                offset += 8;

                // Store in memory
                // Verify if we need to mask? JSim803 `loadWord` just reads bytes. 
                // `cpu.setMem` probably handles masking if needed, or the dump is already 39-bit clean (in 64-bit container)?
                // JSim uses `long` which is 64-bit signed. 803 words are 39-bit.
                // Masking to 39 bits just in case.

                // Note: JSim803 `loadWord` construct: `a = (a << 8) + b`. 
                // If the dump has full 64-bit garbage in top bits, we should mask.
                // 0x7FFFFFFFFF is 39 bits.

                this.store.write(address + i, word & 0x7FFFFFFFFFn);
                totalWords++;
            }
        }

        if (totalWords === 0) {
            throw new Error("Core image contained no data blocks.");
        }

        console.log("Core Load Complete.");
        if (window.elliott.printer) {
            window.elliott.printer.log("System Loaded: Algol 803");
        }
        return totalWords;
    }
}

window.CoreLoader = CoreLoader;
