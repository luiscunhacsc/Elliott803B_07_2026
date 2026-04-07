class Elliott803 {
    constructor() {
        this.store = new Store();

        this.tapeReaders = [new TapeReader(), new TapeReader()];
        this.tapePunches = [new TapePunch(), new TapePunch()];
        this.teletype = new Teletype();
        this.plotter = new Plotter();
        this.console = new ConsoleDevice(this);

        this.devices = {
            controlWrite: (addr, acc) => {
                if ((addr & 0x1FC0) === 7168 && this.plotter) {
                    this.plotter.controlWrite(addr, acc);
                    return;
                }

                if ((addr & 0x1FFC) === 8188) {
                    switch (addr) {
                        case 8191:
                            this.reset();
                            break;
                        case 8190:
                            if (window.elliott && window.elliott.printer) {
                                window.elliott.printer.log('Core dump command received (not yet implemented).');
                            }
                            break;
                        case 8189:
                            if (window.elliott && window.elliott.printer) {
                                window.elliott.printer.log('Trace ON command received (not yet implemented).');
                            }
                            break;
                        case 8188:
                            if (window.elliott && window.elliott.printer) {
                                window.elliott.printer.log('Trace OFF command received (not yet implemented).');
                            }
                            break;
                    }
                }
            },

            controlRead: (addr) => {
                if ((addr & 0x1FFF) === 8000) {
                    const hi = Math.floor(Math.random() * (1 << 19));
                    const lo = Math.floor(Math.random() * (1 << 19));
                    return (BigInt(hi) << 19n) | BigInt(lo);
                }
                return null;
            }
        };

        this.cpu = new CPU(
            this.store,
            this.tapeReaders,
            this.tapePunches,
            this.teletype,
            this.plotter,
            this.console,
            this.devices
        );

        this.ui = null;
    }

    setUI(ui) {
        this.ui = ui;
    }

    reset() {
        this.cpu.reset();
        if (this.teletype) this.teletype.reset();
        if (this.plotter) this.plotter.reset();
    }

    operate() {
        this.cpu.step();
    }
}

window.Elliott803 = Elliott803;
