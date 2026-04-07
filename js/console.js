class ConsoleUI {
    constructor(emulator) {
        this.emulator = emulator;
        this.buttonsByBit = new Map();
        this.rowBits = new Map();

        // 803B word mapping:
        // F1: 38-33, N1: 32-20, B: 19, F2: 18-13, N2: 12-0
        const functionLabels = ['4', '2', '1', '4', '2', '1'];

        this.rows = [
            {
                id: 'row-f1',
                type: 'function',
                startBit: 33,
                labels: functionLabels
            },
            {
                id: 'row-n1',
                type: 'address',
                startBit: 20,
                labels: [4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1],
                bBit: 19
            },
            {
                id: 'row-f2',
                type: 'function',
                startBit: 13,
                labels: functionLabels
            },
            {
                id: 'row-n2',
                type: 'address',
                startBit: 0,
                labels: [4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]
            }
        ];

        console.log('ConsoleUI: Instantiated.');
        this.init();
    }

    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.generateButtonsAndBind();
            });
        } else {
            this.generateButtonsAndBind();
        }
    }

    generateButtonsAndBind() {
        try {
            this.createWordGeneratorButtons();
            console.log('ConsoleUI: Buttons generated.');
        } catch (e) {
            console.error('ConsoleUI: Error generating buttons', e);
            alert(`ConsoleUI Generation Error: ${e.message}`);
        }

        this.bindVisuals();
    }

    createWordGeneratorButtons() {
        this.rows.forEach((row) => {
            const container = document.getElementById(row.id);
            if (!container) return;

            container.innerHTML = '';
            this.rowBits.set(row.id, []);

            // Left red row reset button
            const clearBtn = this.createRowResetButton(row.id);
            container.appendChild(clearBtn);

            this.createGap(container);

            if (row.type === 'function') {
                row.labels.forEach((label, idx) => {
                    const bit = row.startBit + (row.labels.length - 1 - idx);
                    this.createBitButton(row.id, container, label, bit);
                });
            } else {
                row.labels.forEach((label) => {
                    const relBit = Math.log2(label);
                    const bit = row.startBit + relBit;
                    this.createBitButton(row.id, container, label, bit);
                });
            }

            if (typeof row.bBit === 'number') {
                // No extra gap before B to match original panel spacing.
                this.createBitButton(row.id, container, 'B', row.bBit, 'red');
            }
        });
    }

    createRowResetButton(rowId) {
        const btn = this.createButton('red', '');
        btn.title = 'Clear Row';
        btn.addEventListener('click', () => this.clearRow(rowId));
        this.bindMomentaryPress(btn);
        return btn;
    }

    clearRow(rowId) {
        const bits = this.rowBits.get(rowId) || [];
        bits.forEach((bit) => this.setBitState(bit, false));
    }

    createGap(container, width = '30px') {
        const gap = document.createElement('div');
        gap.className = 'wg-gap';
        gap.style.width = width;
        gap.style.minWidth = width;
        container.appendChild(gap);
    }

    createBitButton(rowId, container, label, bitIndex, color = 'black') {
        const btn = this.createButton(color, label);
        btn.dataset.bit = String(bitIndex);

        this.buttonsByBit.set(bitIndex, btn);

        const bits = this.rowBits.get(rowId);
        if (bits) bits.push(bitIndex);

        btn.addEventListener('click', () => {
            // 803 behavior: these buttons latch ON and do not toggle OFF directly.
            if (btn.classList.contains('active')) return;
            this.setBitState(bitIndex, true);
        });

        container.appendChild(btn);
    }

    setBitState(bit, active) {
        if (window.elliott && window.elliott.console) {
            window.elliott.console.setWordGenBit(bit, !!active);
        }

        const btn = this.buttonsByBit.get(bit);
        if (!btn) return;

        btn.classList.toggle('active', !!active);
        btn.classList.toggle('btn-pressed', !!active);
    }

    createButton(color, label) {
        const btn = document.createElement('button');
        btn.className = `wg-btn ${color === 'red' ? 'red-btn' : ''}`;
        btn.style.width = '36px';
        btn.style.height = '36px';
        btn.style.display = 'block';

        if (label !== undefined && label !== null && label !== '') {
            const span = document.createElement('span');
            span.className = 'wg-sublabel';
            span.textContent = label.toString();
            btn.appendChild(span);
        }

        return btn;
    }

    bindMomentaryPress(btn) {
        btn.addEventListener('mousedown', () => btn.classList.add('btn-pressed'));
        btn.addEventListener('mouseup', () => btn.classList.remove('btn-pressed'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('btn-pressed'));
        btn.addEventListener('touchstart', () => btn.classList.add('btn-pressed'), { passive: true });
        btn.addEventListener('touchend', () => btn.classList.remove('btn-pressed'));
        btn.addEventListener('touchcancel', () => btn.classList.remove('btn-pressed'));
    }

    bindVisuals() {
        // Momentary push controls
        const momentaryIds = [
            'btn-batt-on', 'btn-batt-off', 'btn-comp-on', 'btn-comp-off',
            'btn-reset', 'btn-read', 'btn-normal', 'btn-obey', 'operate-bar'
        ];

        momentaryIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) this.bindMomentaryPress(btn);
        });

        // Push-push latch controls get only press animation here;
        // their latched "active" state is managed in main.js.
        const latchIds = ['btn-clear-store', 'btn-manual-data', 'btn-select-stop'];
        latchIds.forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) this.bindMomentaryPress(btn);
        });
    }

    updateLights(cpu) {
        const setLight = (id, state) => {
            const el = document.getElementById(id);
            if (el) {
                if (state) el.classList.add('active');
                else el.classList.remove('active');
            }
        };

        if (cpu) {
            setLight('light-parity', false);
            setLight('light-block', false);
            setLight('light-busy', cpu.busy);
            setLight('light-fp-overflow', cpu.fpOverflow);
            setLight('light-step', cpu.stopped);
            setLight('light-overflow', cpu.overflow);
        }
    }
}

window.ConsoleUI = ConsoleUI;
