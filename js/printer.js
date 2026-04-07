/**
 * Elliott 803B Teleprinter / Logger
 */
class Teleprinter {
    constructor() {
        this.element = document.getElementById('teleprinter-output');
    }

    print(text) {
        if (this.element) {
            this.element.value += text;
            this.element.scrollTop = this.element.scrollHeight;
            this.dirty = true;
        }
        console.log(`[PRINTER] ${text}`);
    }

    log(message) {
        // System logs vs Printer output
        console.log(`[SYSTEM] ${message}`);
        // Print system logs to the teleprinter with a prefix
        // this.print(`[SYS] ${message}\n`);
    }

    clear() {
        if (this.element) this.element.value = "";
    }
}

window.Teleprinter = Teleprinter;
