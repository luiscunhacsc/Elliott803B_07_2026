class Guide {
    constructor() {
        this.currentStepIndex = 0;
        this.baseSteps = [];
        this.activeSteps = [];
        this.currentTarget = null;
        this.activeListener = null;
        this.tooltip = null;
        this.asmPicker = null;
        this.asmProgram = null;
        this.asmReplayPrompt = null;
        this.algolPicker = null;
        this.algolProgram = null;
        this.algolReplayPrompt = null;
        this.algolBootReady = false;
        this.outputCheckpoint = '';
        this.feedbackTimeout = null;
        this.tooltipMessageEl = null;
        this.tooltipHintEl = null;
        this.recoveryTargets = [];
        this.recoveryFlow = null;
        this.recoveryListener = null;
        this.customPoller = null;
        this.lastCompileEvidence = false;
    }

    startAlgol() {
        this.stopRecoveryFlow();
        this.asmProgram = null;
        this.algolProgram = null;
        this.closeAsmProgramPicker();
        this.closeAsmReplayPrompt();
        this.closeAlgolReplayPrompt();
        this.showAlgolProgramPicker();
    }

    startASM() {
        this.stopRecoveryFlow();
        this.algolProgram = null;
        this.closeAlgolProgramPicker();
        this.closeAlgolReplayPrompt();
        this.closeAsmReplayPrompt();
        this.showAsmProgramPicker();
    }

    start() {
        console.log("Starting Guide...");
        this.currentStepIndex = 0;
        this.showStep();
    }

    showStep() {
        this.clearCustomPoller();
        if (this.currentStepIndex >= this.activeSteps.length) {
            this.finish();
            return;
        }

        const step = this.activeSteps[this.currentStepIndex];
        if (typeof step.onEnter === 'function') {
            step.onEnter();
        }
        let target = null;

        if (step.targetSelector) {
            target = document.querySelector(step.targetSelector);
        } else {
            target = document.getElementById(step.targetId);
        }

        if (!target) {
            console.warn(`Target ${step.targetId || step.targetSelector} not found, skipping.`);
            this.currentStepIndex++;
            this.showStep();
            return;
        }

        // Apply file filter if specified
        if (target.tagName === 'INPUT' && target.type === 'file' && step.accept) {
            target.setAttribute('accept', step.accept);
        }

        // Handle hidden file inputs by targeting their label
        if (target.tagName === 'INPUT' && target.type === 'file' && window.getComputedStyle(target).display === 'none') {
            const label = document.querySelector(`label[for="${step.targetId}"]`);
            if (label) {
                target = label; // Highlight the label instead
            } else {
                // Try parent wrapper
                target = target.parentElement;
            }
        }

        // Clean up previous
        this.clearHighlight();
        this.clearRecoveryTargets();

        // set current target
        this.currentTarget = target;

        // Add Highlight Class
        target.classList.add('guide-target');

        // Show Tooltip
        this.showTooltip(target, step.message);

        // Scroll to target if needed
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Add Listener to advance
        this.activeListener = (e) => {
            // Wait a slightly bit to allow the action to happen
            setTimeout(() => {
                this.currentStepIndex++;
                this.showStep();
            }, 1000);
        };

        if (step.isCustomEvent) {
            // Poll for custom check
            if (step.customCheck) {
                this.customPoller = setInterval(() => {
                    if (step.customCheck()) {
                        this.clearCustomPoller();
                        this.activeListener();
                    }
                }, 500);
            }
        } else {
            // Listener Attachment Logic
            if (step.targetSelector) {
                // simple target reference
                target.addEventListener(step.trigger, this.activeListener, { once: true });
            } else {
                // Standard ID-based
                const originalTarget = document.getElementById(step.targetId);
                // If special trigger like 'change' for file input
                if (step.trigger === 'change' && originalTarget) {
                    const guarded = (e) => {
                        const selected = e && e.target ? e.target.value : undefined;
                        if (!this.matchesExpectedSelection(step, selected)) {
                            const expected = this.getExpectedSelectionText(step);
                            this.showStepFeedback(`Wrong selection. Please choose '${expected}'.`);
                            return;
                        }
                        originalTarget.removeEventListener(step.trigger, guarded);
                        this.activeListener(e);
                    };
                    originalTarget.addEventListener(step.trigger, guarded);
                } else {
                    target.addEventListener(step.trigger, this.activeListener, { once: true });
                }
            }
        }
    }

    checkForOutput(text) {
        const el = document.getElementById('teleprinter-output');
        if (!el) return false;
        // Check for the character at the end, ignoring trailing whitespace/newlines
        return el.value.trim().endsWith(text);
    }

    checkForPattern(pattern) {
        const el = document.getElementById('teleprinter-output');
        if (!el) return false;
        return pattern.test(el.value || '');
    }

    setOutputCheckpoint() {
        const el = document.getElementById('teleprinter-output');
        this.outputCheckpoint = el ? (el.value || '') : '';
    }

    hasNewOutput() {
        const el = document.getElementById('teleprinter-output');
        if (!el) return false;
        return (el.value || '').length > this.outputCheckpoint.length;
    }

    getOutputDelta() {
        const el = document.getElementById('teleprinter-output');
        if (!el) return '';
        return (el.value || '').slice(this.outputCheckpoint.length);
    }

    getWordGenState() {
        const word = (window.elliott && window.elliott.console && typeof window.elliott.console.read === 'function')
            ? window.elliott.console.read()
            : 0n;
        const f1 = (((word >> 38n) & 1n) === 1n);
        const f2 = (((word >> 18n) & 1n) === 1n);
        return { f1, f2 };
    }

    isReader1Ready() {
        return !!(window.elliott && window.elliott.tapeReaders
            && window.elliott.tapeReaders[0]
            && window.elliott.tapeReaders[0].isReady());
    }

    isTapeWaitState() {
        if (!window.elliott || !window.elliott.cpu) return false;
        return !this.isReader1Ready() && !!window.elliott.cpu.busy;
    }

    isCompileWaitState() {
        if (!window.elliott || !window.elliott.cpu) return false;
        const cpuBusy = !!window.elliott.cpu.busy;
        const wg = this.getWordGenState();
        // Typical state after source has been consumed in compile phase.
        return !this.isReader1Ready() && cpuBusy && wg.f1 && !wg.f2;
    }

    isSystemWaitState() {
        if (!window.elliott || !window.elliott.cpu) return false;
        const cpuBusy = !!window.elliott.cpu.busy;
        const wg = this.getWordGenState();
        return !cpuBusy && !this.isReader1Ready() && !wg.f1 && !wg.f2;
    }

    isReadyToCompileState() {
        if (!window.elliott || !window.elliott.cpu) return true;
        const wg = this.getWordGenState();
        const cpuStopped = !!window.elliott.cpu.stopped || !window.elliott.running;
        // Accept canonical System Wait and also the practical case where BUSY remains latched
        // after installer stop but compiler is ready and F1/F2 are clear.
        return (!this.isReader1Ready() && !wg.f1 && !wg.f2 && cpuStopped) || this.isSystemWaitState();
    }

    hasCompilePhaseEvidence(selected) {
        const sourcePattern = selected && selected.name ? new RegExp(selected.name, 'i') : null;
        const ok = this.checkForPattern(/FREE STORE|DATA WAIT|END OF PHASE|ERROR/i)
            || (sourcePattern ? this.checkForPattern(sourcePattern) : false)
            || this.isCompileWaitState()
            || (this.hasNewOutput() && /[A-Z0-9]/i.test(this.getOutputDelta()));
        if (ok) this.lastCompileEvidence = true;
        return ok;
    }

    hasProgramRunEvidence(selected) {
        const hasSelectedOutput = !!(selected && selected.pattern && this.checkForPattern(selected.pattern));
        const hasGenericRunOutput = this.checkForPattern(/END OF PROGRAM|ERROR/i)
            || (this.hasNewOutput() && /[A-Z0-9]/i.test(this.getOutputDelta()));
        return hasSelectedOutput || hasGenericRunOutput;
    }

    isWordGenBitActive(bit) {
        if (!window.elliott || !window.elliott.console || typeof window.elliott.console.read !== 'function') return false;
        const word = window.elliott.console.read();
        return (((word >> BigInt(bit)) & 1n) === 1n);
    }

    isCpuBusy() {
        return !!(window.elliott && window.elliott.cpu && window.elliott.cpu.busy);
    }

    isCpuRunning() {
        return !!(window.elliott && window.elliott.running && window.elliott.cpu && !window.elliott.cpu.stopped);
    }

    startRecoveryFlow() {
        if (this.recoveryFlow) {
            this.showRecoveryStep();
            return;
        }
        if (this.currentTarget) {
            this.currentTarget.classList.remove('guide-target');
        }
        const steps = [
            {
                target: () => document.querySelector('#row-f2 button.wg-btn:nth-of-type(2)'),
                message: "Click FUNCTION 2 left-most 40 bit if it is lit, to release it.",
                skipWhen: () => !this.isWordGenBitActive(18)
            },
            {
                target: () => document.querySelector('#row-f1 button.wg-btn:nth-of-type(2)'),
                message: "Click FUNCTION 1 left-most 40 bit if it is lit, to release it.",
                skipWhen: () => !this.isWordGenBitActive(38)
            },
            {
                target: () => document.getElementById('btn-reset'),
                message: "If BUSY is still on after clearing F1/F2, click RESET.",
                skipWhen: () => !this.isCpuBusy()
            },
            {
                target: () => document.getElementById('btn-guide-algol'),
                message: "Click GUIDES > ALGOL to restart the walkthrough from compile state."
            }
        ];
        this.recoveryFlow = { index: 0, steps };
        this.showRecoveryStep();
    }

    showRecoveryStep() {
        if (!this.recoveryFlow) return;
        const flow = this.recoveryFlow;
        if (flow.index >= flow.steps.length) {
            this.stopRecoveryFlow();
            return;
        }

        const step = flow.steps[flow.index];
        if (typeof step.skipWhen === 'function' && step.skipWhen()) {
            flow.index++;
            this.showRecoveryStep();
            return;
        }

        const target = step.target();
        if (!target) {
            flow.index++;
            this.showRecoveryStep();
            return;
        }

        this.showRecoveryTargets(flow.index);
        this.showTooltip(target, `Recovery ${flow.index + 1}/${flow.steps.length}. ${step.message}`);

        if (this.recoveryListener && this.recoveryListener.target && this.recoveryListener.handler) {
            this.recoveryListener.target.removeEventListener('click', this.recoveryListener.handler);
        }
        const handler = () => {
            setTimeout(() => {
                if (!this.recoveryFlow) return;
                this.recoveryFlow.index++;
                this.showRecoveryStep();
            }, 250);
        };
        target.addEventListener('click', handler, { once: true });
        this.recoveryListener = { target, handler };
    }

    stopRecoveryFlow() {
        if (this.recoveryListener && this.recoveryListener.target && this.recoveryListener.handler) {
            this.recoveryListener.target.removeEventListener('click', this.recoveryListener.handler);
        }
        this.recoveryListener = null;
        this.recoveryFlow = null;
        this.clearRecoveryTargets();
        if (this.currentTarget) {
            this.currentTarget.classList.add('guide-target');
        }
    }

    checkAndReportAlgolDeadEnd() {
        if (!window.elliott || !window.elliott.cpu) return false;
        const cpuBusy = !!window.elliott.cpu.busy;
        const wg = this.getWordGenState();
        const deadEnd = cpuBusy && !this.isReader1Ready() && wg.f1 && wg.f2;
        const hasMeaningfulProgress = this.lastCompileEvidence || this.hasNewOutput() || this.checkForPattern(/FREE STORE|DATA WAIT|END OF PROGRAM|ERROR/i);
        if (!hasMeaningfulProgress) {
            return false;
        }
        if (deadEnd) {
            this.startRecoveryFlow();
        }
        return deadEnd || !!this.recoveryFlow;
    }

    clearCustomPoller() {
        if (this.customPoller) {
            clearInterval(this.customPoller);
            this.customPoller = null;
        }
    }

    showRecoveryTargets(currentIndex = -1) {
        this.clearRecoveryTargets();
        if (!this.recoveryFlow || !Array.isArray(this.recoveryFlow.steps)) return;
        if (currentIndex < 0 || currentIndex >= this.recoveryFlow.steps.length) return;
        const step = this.recoveryFlow.steps[currentIndex];
        const el = step && step.target ? step.target() : null;
        if (!el) return;
        el.classList.add('guide-target');
        this.recoveryTargets.push(el);
    }

    clearRecoveryTargets() {
        if (!Array.isArray(this.recoveryTargets)) return;
        this.recoveryTargets.forEach((el) => {
            if (!el) return;
            el.classList.remove('guide-target');
        });
        this.recoveryTargets = [];
    }

    ensureCpuRunning() {
        if (!window.elliott || !window.elliott.cpu) return;
        if (!window.elliott.running || window.elliott.cpu.stopped) {
            if (typeof window.toggleRun === 'function') {
                window.toggleRun();
            }
        }
    }

    matchesExpectedSelection(step, value) {
        if (!step) return true;
        if (typeof step.expectedValue === 'string') return value === step.expectedValue;
        if (Array.isArray(step.expectedValues)) return step.expectedValues.includes(value);
        return true;
    }

    getExpectedSelectionText(step) {
        if (!step) return 'the expected item';
        if (step.expectedLabel) return step.expectedLabel;
        if (typeof step.expectedValue === 'string') {
            const parts = step.expectedValue.split('/');
            return parts[parts.length - 1] || step.expectedValue;
        }
        if (Array.isArray(step.expectedValues) && step.expectedValues.length > 0) {
            const parts = step.expectedValues[0].split('/');
            return parts[parts.length - 1] || step.expectedValues[0];
        }
        return 'the expected item';
    }

    showStepFeedback(message) {
        if (this.tooltipMessageEl) {
            this.tooltipMessageEl.innerText = message;
        } else if (this.tooltip) {
            this.tooltip.innerText = message;
        }
        if (this.feedbackTimeout) {
            clearTimeout(this.feedbackTimeout);
        }
        this.feedbackTimeout = setTimeout(() => {
            const step = this.activeSteps[this.currentStepIndex];
            if (step && this.tooltipMessageEl) {
                this.tooltipMessageEl.innerText = step.message;
            } else if (this.tooltip && step) {
                this.tooltip.innerText = step.message;
            }
        }, 1800);
    }

    isAlgolReady() {
        if (window.runtime && window.runtime.algolInstalled) return true;
        if (this.algolBootReady) return true;
        // Heuristic: monitor printout uses lone "2" when ALGOL monitor is ready.
        return this.checkForPattern(/(^|[\r\n])2([\r\n]|$)/);
    }

    getAlgolStatusText() {
        const el = document.getElementById('algol-status');
        return ((el && el.textContent) ? el.textContent : '').toUpperCase();
    }

    isAlgolInstallFailureState() {
        const status = this.getAlgolStatusText();
        return /INSTALL FAILED|INSTALL TIMEOUT/.test(status);
    }

    showTooltip(target, message) {
        if (!this.tooltip) {
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'guide-tooltip';
            this.tooltipMessageEl = document.createElement('div');
            this.tooltipMessageEl.className = 'guide-tooltip-message';
            this.tooltipHintEl = document.createElement('div');
            this.tooltipHintEl.className = 'guide-tooltip-hint';
            this.tooltip.appendChild(this.tooltipMessageEl);
            this.tooltip.appendChild(this.tooltipHintEl);
            document.body.appendChild(this.tooltip);
        }

        const rect = target.getBoundingClientRect();
        this.tooltip.style.left = `${rect.right + 10}px`;
        this.tooltip.style.top = `${rect.top}px`;
        if (this.tooltipMessageEl) {
            this.tooltipMessageEl.innerText = message;
        }
        const step = this.activeSteps[this.currentStepIndex];
        const hasExpected = !!(step && (step.expectedValue || (Array.isArray(step.expectedValues) && step.expectedValues.length > 0)));
        if (this.tooltipHintEl) {
            if (hasExpected) {
                this.tooltipHintEl.innerText = `Required: ${this.getExpectedSelectionText(step)}`;
                this.tooltipHintEl.style.display = 'block';
            } else {
                this.tooltipHintEl.innerText = '';
                this.tooltipHintEl.style.display = 'none';
            }
        }
        this.tooltip.style.display = 'block';
    }

    clearHighlight() {
        if (this.currentTarget) {
            this.currentTarget.classList.remove('guide-target');
            this.currentTarget = null;
        }
        this.clearCustomPoller();
        this.stopRecoveryFlow();
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }

    finish() {
        this.clearHighlight();
        this.closeAsmProgramPicker();
        this.closeAlgolProgramPicker();
        if (window.elliott && window.elliott.printer) {
            window.elliott.printer.log("GUIDE: Setup complete. You are ready to Run!");
        }
        if (this.asmProgram) {
            this.showAsmReplayPrompt();
        } else if (this.algolProgram) {
            this.showAlgolReplayPrompt();
        }
        // alert("You are ready to go!");
    }

    beginALGOL(program) {
        this.algolProgram = program;
        this.closeAlgolProgramPicker();
        this.lastCompileEvidence = false;

        const sources = {
            hello: { file: 'hello.algol', name: 'HELLO', pattern: /HELLO WORLD/i },
            plot: { file: 'plot.algol', name: 'PLOT', pattern: /PLOTTING/i },
            sort: { file: 'sort.algol', name: 'SORT' },
            trig: { file: 'trig.algol', name: 'TRIG' },
            factorial4: { file: 'factorial4.algol', name: 'FACTORIAL4' },
            pi4: { file: 'pi4.algol', name: 'PI4' },
            sortacm: { file: 'sortacm.algol', name: 'SORTACM' },
            random: { file: 'random.algol', name: 'RANDOM' }
        };

        const selected = sources[program] || sources.hello;
        const ready = this.isAlgolReady();
        if (ready) {
            // Compiler already loaded — guide user through compile & run
            this.activeSteps = [
                {
                    targetId: 'tape-library-select',
                    message: `1. Select '${selected.file}' from Library.`,
                    trigger: 'algol-lib-select',
                    isCustomEvent: true,
                    onEnter: () => this.prepareLibrarySelection(),
                    customCheck: () => this.isReaderLoadedWith(selected.file)
                },
                {
                    targetSelector: '#row-f1 button.wg-btn:nth-of-type(2)',
                    message: "2. Press F1 left-most 40 bit to start compilation.",
                    trigger: 'click',
                    onEnter: () => this.setOutputCheckpoint()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "3. Wait for compile output (title + FREE STORE).",
                    trigger: 'algol-quick-wait-compile',
                    isCustomEvent: true,
                    customCheck: () => this.hasCompilePhaseEvidence(selected)
                },
                {
                    targetSelector: '#row-f1 button.red-btn',
                    message: "4. Press the red FUNCTION 1 row button to release F1.",
                    trigger: 'click',
                    onEnter: () => this.setOutputCheckpoint()
                },
                {
                    targetSelector: '#row-f2 button.wg-btn:nth-of-type(2)',
                    message: "5. Press F2 left-most 40 bit to run the program.",
                    trigger: 'click',
                    onEnter: () => {
                        this.setOutputCheckpoint();
                        if (program === 'factorial4') {
                            this.loadDataTapeToReader2('tapes/data/factorial_data.tape');
                        } else if (program === 'pi4') {
                            this.loadDataTapeToReader2('tapes/data/pi_data.tape');
                        }
                    }
                },
                {
                    targetId: 'teleprinter-output',
                    message: "6. Wait for program output.",
                    trigger: 'algol-quick-wait-output',
                    isCustomEvent: true,
                    customCheck: () => {
                        this.checkAndReportAlgolDeadEnd();
                        return this.hasProgramRunEvidence(selected);
                    }
                }
            ];
        } else {
            // Need to install compiler first
            this.activeSteps = [
                {
                    targetId: 'btn-install-algol',
                    message: "1. Click 'ALGOL MODE' to load the A104 compiler.",
                    trigger: 'click',
                    onEnter: () => this.ensureCpuRunning()
                },
                {
                    targetId: 'algol-status',
                    message: "2. Wait for ALGOL: READY (loading compiler tapes).",
                    trigger: 'algol-install-wait',
                    isCustomEvent: true,
                    customCheck: () => {
                        if (this.isAlgolInstallFailureState()) {
                            this.showStepFeedback("Installation failed. Please try again.");
                            return false;
                        }
                        return this.isAlgolReady();
                    }
                },
                {
                    targetId: 'tape-library-select',
                    message: `3. Select '${selected.file}' from Library.`,
                    trigger: 'algol-lib-select',
                    isCustomEvent: true,
                    onEnter: () => this.prepareLibrarySelection(),
                    customCheck: () => this.isReaderLoadedWith(selected.file)
                },
                {
                    targetSelector: '#row-f1 button.wg-btn:nth-of-type(2)',
                    message: "4. Press F1 left-most 40 bit to start compilation.",
                    trigger: 'click',
                    onEnter: () => this.setOutputCheckpoint()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "5. Wait for compile output (title + FREE STORE).",
                    trigger: 'algol-wait-compile',
                    isCustomEvent: true,
                    customCheck: () => this.hasCompilePhaseEvidence(selected)
                },
                {
                    targetSelector: '#row-f1 button.red-btn',
                    message: "6. Press the red FUNCTION 1 row button to release F1.",
                    trigger: 'click',
                    onEnter: () => this.setOutputCheckpoint()
                },
                {
                    targetSelector: '#row-f2 button.wg-btn:nth-of-type(2)',
                    message: "7. Press F2 left-most 40 bit to run the program.",
                    trigger: 'click',
                    onEnter: () => {
                        this.setOutputCheckpoint();
                        if (program === 'factorial4') {
                            this.loadDataTapeToReader2('tapes/data/factorial_data.tape');
                        } else if (program === 'pi4') {
                            this.loadDataTapeToReader2('tapes/data/pi_data.tape');
                        }
                    }
                },
                {
                    targetId: 'teleprinter-output',
                    message: "8. Wait for program output.",
                    trigger: 'algol-wait-output',
                    isCustomEvent: true,
                    customCheck: () => {
                        this.checkAndReportAlgolDeadEnd();
                        return this.hasProgramRunEvidence(selected);
                    }
                }
            ];
        }

        this.start();
    }

    beginASM(program) {
        this.asmProgram = program;
        this.closeAsmProgramPicker();

        if (program === 'music' || program === 'casaPT') {
            // Force Real-Time for music programs
            console.log("[GUIDE] beginASM: Forcing Real-Time for Music.");
            if (window.setTurboMode) window.setTurboMode(false);
            else if (window.runtime) window.runtime.turboMode = false;
        }

        this.currentProgram = program;
        this.currentMode = 'asm';
        this.activeSteps = [];
        if (program === 'hello1') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'hello1.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/hello1.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select continuous run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start execution.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "5. Wait for HELLO WORLD to print.",
                    trigger: 'asm-wait-hello1',
                    isCustomEvent: true,
                    customCheck: () => this.checkForPattern(/HELLO WORLD/i)
                }
            ];
        } else if (program === 'music') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'music.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/music.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start the music.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetSelector: '#row-f1 button.wg-btn:nth-of-type(2)',
                    message: "5. Toggle the left-most FUNCTION 1 bit (sign bit) to trigger the tune.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "6. When the tune ends, press the OPERATE bar to stop.",
                    trigger: 'click'
                }
            ];
        } else if (program === 'casaPT') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'casaPT.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/casaPT.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start the music.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetSelector: '#row-f1 button.wg-btn:nth-of-type(2)',
                    message: "5. Toggle the left-most FUNCTION 1 bit (sign bit) to trigger the tune.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "6. When the tune ends, press the OPERATE bar to stop.",
                    trigger: 'click'
                }
            ];
        } else if (program === 'random') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'random.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/random.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "5. Wait for random number output.",
                    trigger: 'asm-wait-random',
                    isCustomEvent: true,
                    customCheck: () => this.hasNewOutput()
                }
            ];
        } else if (program === 'hello2') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'hello2.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/hello2.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "5. Wait for HELLO WORLD to print.",
                    trigger: 'asm-wait-hello2',
                    isCustomEvent: true,
                    customCheck: () => this.checkForPattern(/HELLO WORLD/i)
                },
                {
                    targetId: 'operate-bar',
                    message: "6. Press 'OPERATE' to stop the endless loop.",
                    trigger: 'click'
                }
            ];
        } else if (program === 'charset') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'charset.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/charset.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press the OPERATE bar to start.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "5. Wait for alphabet and figure-shift character set lines.",
                    trigger: 'asm-wait-charset',
                    isCustomEvent: true,
                    customCheck: () => this.checkForPattern(/A B C D E F/i)
                }
            ];
        } else if (program === 'print') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'print.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/print.a1'
                },
                {
                    targetId: 'swap-readers',
                    message: "3. Turn on 'SWAP READERS' so print.a1 reads from Reader 1.",
                    trigger: 'change'
                },
                {
                    targetId: 'tape-library-select',
                    message: "4. Select 'hello.algol' as the text tape to print.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/hello.algol'
                },
                {
                    targetId: 'btn-normal',
                    message: "5. Press 'NORMAL' to select run mode.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "6. Press the OPERATE bar to start.",
                    trigger: 'click',
                    onEnter: () => this.prepareToRun()
                },
                {
                    targetId: 'teleprinter-output',
                    message: "6. Wait for printed tape text.",
                    trigger: 'asm-wait-print',
                    isCustomEvent: true,
                    customCheck: () => this.checkForPattern(/HELLO|BEGIN|PRINT/i)
                }
            ];
        } else if (program === 'random') {
            this.activeSteps = [
                {
                    targetId: 'btn-clear-store',
                    message: "1. Click 'CLEAR STORE' to wipe memory.",
                    trigger: 'click'
                },
                {
                    targetId: 'tape-library-select',
                    message: "2. Select 'random.a1' from the Library.",
                    trigger: 'change',
                    onEnter: () => this.prepareLibrarySelection(),
                    expectedValue: 'software/random.a1'
                },
                {
                    targetId: 'btn-normal',
                    message: "3. Press 'NORMAL' to start random store writes.",
                    trigger: 'click'
                },
                {
                    targetId: 'operate-bar',
                    message: "4. Press 'OPERATE' after a few seconds to stop.",
                    trigger: 'click'
                }
            ];
        }

        this.start();
    }

    prepareLibrarySelection() {
        const select = document.getElementById('tape-library-select');
        if (!select) return;
        select.value = '';
    }

    /**
     * Called in onEnter of the OPERATE bar guide step.
     * Releases the Clear Store latch (still latched from step 1) so that
     * toggleRun() starts the CPU instead of clearing the store again.
     * Also jumps to the tape entry address when useEntryPoint is true.
     */
    prepareToRun(useEntryPoint = true) {
        if (window.clearStoreLatched) {
            window.clearStoreLatched = false;
            const btn = document.getElementById('btn-clear-store');
            if (btn) btn.classList.remove('active');
        }
        if (useEntryPoint) {
            const reader1 = window.elliott && window.elliott.tapeReaders[0];
            if (reader1 && reader1.tape && reader1.tape.entry !== undefined) {
                window.elliott.cpu.scr = reader1.tape.entry & 0x1FFF;
                window.elliott.cpu.scr2 = 0;
                window.elliott.cpu.fetch();
            }
        }
    }

    isReaderLoadedWith(filename) {
        // Check if Reader 1 has (or had) this tape loaded.
        // In turbo mode the CPU may consume the tape before our poll fires,
        // so we don't require isReady() — just check the tape name.
        if (window.elliott && window.elliott.tapeReaders) {
            const reader = window.elliott.tapeReaders[0];
            if (reader && reader.tape && reader.tape.name === filename) return true;
        }
        // Fallback: check if the dropdown has the right value selected
        const select = document.getElementById('tape-library-select');
        if (select && select.value) {
            const selectedName = select.value.split('/').pop();
            if (selectedName === filename) return true;
        }
        return false;
    }

    showAsmProgramPicker() {
        this.closeAsmProgramPicker();

        const overlay = document.createElement('div');
        overlay.className = 'guide-choice-overlay';

        const panel = document.createElement('div');
        panel.className = 'guide-choice-panel';
        panel.innerHTML = `
            <div class="guide-choice-title">Assembly Guide</div>
            <div class="guide-choice-subtitle">Choose the program walkthrough.</div>
            <div class="guide-choice-grid">
                <button class="guide-choice-card" data-program="hello1">
                    <span class="guide-choice-name">hello1.a1</span>
                    <span class="guide-choice-desc">Quick hello-world run check.</span>
                </button>
                <button class="guide-choice-card" data-program="music">
                    <span class="guide-choice-name">music.a1</span>
                    <span class="guide-choice-desc">Load and trigger speaker tune.</span>
                </button>
                <button class="guide-choice-card" data-program="casaPT">
                    <span class="guide-choice-name">casaPT.a1</span>
                    <span class="guide-choice-desc">Uma Casa Portuguesa speaker tune.</span>
                </button>
                <button class="guide-choice-card" data-program="hello2">
                    <span class="guide-choice-name">hello2.a1</span>
                    <span class="guide-choice-desc">Alternate hello-world control flow.</span>
                </button>
                <button class="guide-choice-card" data-program="charset">
                    <span class="guide-choice-name">charset.a1</span>
                    <span class="guide-choice-desc">Print letters and figure-shift ordering.</span>
                </button>
                <button class="guide-choice-card" data-program="print">
                    <span class="guide-choice-name">print.a1</span>
                    <span class="guide-choice-desc">Print a selected Reader 1 tape via swap.</span>
                </button>
                <button class="guide-choice-card" data-program="random">
                    <span class="guide-choice-name">random.a1</span>
                    <span class="guide-choice-desc">Run random store writes and stop safely.</span>
                </button>
            </div>
            <div class="guide-choice-actions">
                <button class="guide-choice-cancel" type="button">Cancel</button>
            </div>
        `;

        panel.querySelectorAll('[data-program]').forEach((btn) => {
            btn.addEventListener('click', () => this.beginASM(btn.dataset.program));
        });

        panel.querySelector('.guide-choice-cancel').addEventListener('click', () => {
            this.closeAsmProgramPicker();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAsmProgramPicker();
        });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.asmPicker = overlay;
    }

    closeAsmProgramPicker() {
        if (this.asmPicker && this.asmPicker.parentElement) {
            this.asmPicker.parentElement.removeChild(this.asmPicker);
        }
        this.asmPicker = null;
    }

    showAlgolProgramPicker() {
        this.closeAlgolProgramPicker();
        const ready = this.isAlgolReady();
        const bootstrapHint = ready
            ? 'ALGOL compiler is ready in memory.'
            : 'ALGOL compiler is not loaded. The guide will use canonical tape sequence: a104-1, 40 0 boot, then a104-2.';

        const overlay = document.createElement('div');
        overlay.className = 'guide-choice-overlay';

        const panel = document.createElement('div');
        panel.className = 'guide-choice-panel';
        panel.innerHTML = `
            <div class="guide-choice-title">ALGOL Guide</div>
            <div class="guide-choice-subtitle">${bootstrapHint} Choose the ALGOL sample walkthrough.</div>
            <div class="guide-choice-grid">
                <button class="guide-choice-card" data-program="hello">
                    <span class="guide-choice-name">hello.algol</span>
                    <span class="guide-choice-desc">Minimal compile and print check.</span>
                </button>
                <button class="guide-choice-card" data-program="plot">
                    <span class="guide-choice-name">plot.algol</span>
                    <span class="guide-choice-desc">Compile and run plotter waveform demo.</span>
                </button>
                <button class="guide-choice-card" data-program="sort">
                    <span class="guide-choice-name">sort.algol</span>
                    <span class="guide-choice-desc">Compile and run sorting sample.</span>
                </button>
                <button class="guide-choice-card" data-program="trig">
                    <span class="guide-choice-name">trig.algol</span>
                    <span class="guide-choice-desc">Compile and run trigonometric sample.</span>
                </button>
                <button class="guide-choice-card" data-program="factorial4">
                    <span class="guide-choice-name">factorial4.algol</span>
                    <span class="guide-choice-desc">Compile and run large factorial demo.</span>
                </button>
                <button class="guide-choice-card" data-program="pi4">
                    <span class="guide-choice-name">pi4.algol</span>
                    <span class="guide-choice-desc">Compile and run PI multi-precision demo.</span>
                </button>
                <button class="guide-choice-card" data-program="sortacm">
                    <span class="guide-choice-name">sortacm.algol</span>
                    <span class="guide-choice-desc">Compile and run ACM-style sort demo.</span>
                </button>
            </div>
            <div class="guide-choice-actions">
                <button class="guide-choice-cancel" type="button">Cancel</button>
            </div>
        `;

        panel.querySelectorAll('[data-program]').forEach((btn) => {
            btn.addEventListener('click', () => this.beginALGOL(btn.dataset.program));
        });

        panel.querySelector('.guide-choice-cancel').addEventListener('click', () => {
            this.closeAlgolProgramPicker();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAlgolProgramPicker();
        });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.algolPicker = overlay;
    }

    closeAlgolProgramPicker() {
        if (this.algolPicker && this.algolPicker.parentElement) {
            this.algolPicker.parentElement.removeChild(this.algolPicker);
        }
        this.algolPicker = null;
    }

    showAsmReplayPrompt() {
        this.closeAsmReplayPrompt();

        const panel = document.createElement('div');
        panel.className = 'guide-replay-panel';
        panel.innerHTML = `
            <div class="guide-replay-text">Assembly tour complete.</div>
            <button class="guide-replay-btn" type="button">Choose Another Program</button>
        `;

        panel.querySelector('.guide-replay-btn').addEventListener('click', () => {
            this.closeAsmReplayPrompt();
            this.showAsmProgramPicker();
        });

        document.body.appendChild(panel);
        this.asmReplayPrompt = panel;
    }

    closeAsmReplayPrompt() {
        if (this.asmReplayPrompt && this.asmReplayPrompt.parentElement) {
            this.asmReplayPrompt.parentElement.removeChild(this.asmReplayPrompt);
        }
        this.asmReplayPrompt = null;
    }

    showAlgolReplayPrompt() {
        this.closeAlgolReplayPrompt();

        const panel = document.createElement('div');
        panel.className = 'guide-replay-panel';
        panel.innerHTML = `
            <div class="guide-replay-text">ALGOL tour complete.</div>
            <button class="guide-replay-btn" type="button">Choose Another Program</button>
        `;

        panel.querySelector('.guide-replay-btn').addEventListener('click', () => {
            this.closeAlgolReplayPrompt();
            this.showAlgolProgramPicker();
        });

        document.body.appendChild(panel);
        this.algolReplayPrompt = panel;
    }

    closeAlgolReplayPrompt() {
        if (this.algolReplayPrompt && this.algolReplayPrompt.parentElement) {
            this.algolReplayPrompt.parentElement.removeChild(this.algolReplayPrompt);
        }
        this.algolReplayPrompt = null;
    }

    async loadDataTapeToReader2(path) {
        if (!window.elliott || !window.elliott.tapeReaders || window.elliott.tapeReaders.length < 2) return;
        const reader2 = window.elliott.tapeReaders[1];

        try {
            const response = await fetch(path);
            const content = await response.text();
            const tape = new Tape();
            tape.name = path.split('/').pop();
            tape.loadUnknown(content);
            reader2.loadTape(tape);
            if (window.elliott.printer) window.elliott.printer.log(`Guide: Loaded data tape ${tape.name} to Reader 2.`);

            // Set status in UI
            const el = document.getElementById('reader2-status');
            if (el) el.innerText = 'READY';
        } catch (e) {
            console.error("Failed to load data tape", e);
        }
    }
}

// Initialize
window.elliottGuide = new Guide();

// Styles for guide
const style = document.createElement('style');
style.innerHTML = `
    .guide-target {
        outline: 4px solid #ffeb3b !important;
        box-shadow: 0 0 15px #ffeb3b;
        position: relative;
        z-index: 1000;
    }
    .guide-tooltip {
        position: fixed;
        background: #333;
        color: #fff;
        padding: 10px;
        border-radius: 5px;
        font-family: sans-serif;
        font-size: 14px;
        z-index: 1001;
        pointer-events: none;
        display: none;
        max-width: 260px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    .guide-tooltip-message {
        line-height: 1.35;
    }
    .guide-tooltip-hint {
        margin-top: 6px;
        font-size: 12px;
        color: #ffe082;
        line-height: 1.3;
    }
    .guide-choice-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 13, 16, 0.62);
        backdrop-filter: blur(3px);
        z-index: 1100;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
    }
    .guide-choice-panel {
        width: min(760px, 100%);
        background: linear-gradient(165deg, #f4f6f7 0%, #d7dbde 100%);
        border: 1px solid #8a9198;
        box-shadow: 0 20px 48px rgba(0,0,0,0.35);
        border-radius: 12px;
        padding: 16px;
        color: #1d2329;
    }
    .guide-choice-title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.2px;
    }
    .guide-choice-subtitle {
        margin-top: 4px;
        font-size: 13px;
        color: #3d4751;
    }
    .guide-choice-bootline {
        margin-top: 8px;
        margin-bottom: 4px;
    }
    .guide-choice-toggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        color: #2e3740;
        user-select: none;
    }
    .guide-choice-grid {
        margin-top: 14px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
    }
    .guide-choice-card {
        text-align: left;
        border: 1px solid #98a1aa;
        background: #ffffff;
        border-radius: 10px;
        padding: 12px;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
    }
    .guide-choice-card:hover,
    .guide-choice-card:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 8px 22px rgba(29,35,41,0.18);
        border-color: #5b6772;
        outline: none;
    }
    .guide-choice-name {
        display: block;
        font-size: 14px;
        font-weight: 700;
        color: #1f2730;
    }
    .guide-choice-desc {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        color: #4b5660;
    }
    .guide-choice-actions {
        margin-top: 12px;
        display: flex;
        justify-content: flex-end;
    }
    .guide-choice-cancel {
        border: 1px solid #8f97a0;
        border-radius: 8px;
        background: #eceff1;
        color: #2b333b;
        padding: 7px 12px;
        cursor: pointer;
    }
    @media (max-width: 760px) {
        .guide-choice-grid {
            grid-template-columns: 1fr;
        }
    }
    .guide-replay-panel {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 1102;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid #97a0aa;
        border-radius: 10px;
        background: #f4f6f7;
        box-shadow: 0 10px 22px rgba(0,0,0,0.28);
        color: #1f2630;
    }
    .guide-replay-text {
        font-size: 12px;
        color: #3e4852;
    }
    .guide-replay-btn {
        border: 1px solid #808b96;
        background: #ffffff;
        color: #202833;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
    }
`;
document.head.appendChild(style);
