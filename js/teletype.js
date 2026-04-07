class Teletype {
    constructor() {
        this.printer = null;
        this.shift = 1;
        this.figures = "#12*4$=78',+:-.%0()3?56/@9£     ";
        this.letters = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ     ';
    }

    reset() {
        this.shift = 1;
    }

    write(code) {
        code &= 0x1F;

        if (code === 27) {
            this.shift = 0;
            return;
        }
        if (code === 31) {
            this.shift = 1;
            return;
        }

        if (code === 28) return this.printChar(' ');
        if (code === 29) return this.printChar('\r');
        if (code === 30) return this.printChar('\n');

        const table = this.shift ? this.letters : this.figures;
        this.printChar(table[code] || '?');
    }

    printChar(ch) {
        if (!this.printer && window.elliott && window.elliott.printer) {
            this.printer = window.elliott.printer;
        }

        if (this.printer) {
            this.printer.print(ch);
        }
    }
}

window.Teletype = Teletype;
