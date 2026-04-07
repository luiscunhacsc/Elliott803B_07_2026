window.elliott = null;

window.runtime = {
    turboMode: false,
    algolInstalled: false,
    installingAlgol: false,
    runCycles: 0,
    runStartedAtMs: null,
    // Cumulative tracking for the Elliott Time clock
    totalElliottCycles: 0,
    totalComputeMs: 0,
    lastSliceStartMs: null
};

// Console mode: 'read', 'normal', or 'obey'
// These three buttons are mechanically interlocked — only one active at a time.
// Per the original 803B manual (Section 3.2.1):
//   READ + Operate  → loads F1/N1 word generator into instruction register
//   NORMAL + Operate → starts continuous automatic execution
//   OBEY + Operate  → executes one instruction, then stops (step-by-step)
window.consoleMode = 'normal';

// Push-push (latch) toggle states for Selected Stop and Manual Data
window.selectedStopActive = false;
window.manualDataActive = false;
window.clearStoreLatched = false;

window.onerror = function (msg, url, line, col, error) {
    console.error(`Global Error: ${msg} at line ${line}`, error);
    alert(`System Error: ${msg}`);
};

function init() {
    try {
        window.elliott = new Elliott803();
        window.elliott.printer = new Teleprinter();

        window.consoleUI = new ConsoleUI(window.elliott);
        window.updateConsoleLights = null;

        setupControls();
        setupAudioUnlock();
        updateAlgolStatus();
        updateRunStatus();
        updateDebugStatus();
        updateUI();

        // Initialize the computer room wall clock
        window.elliottClock = new ElliottClock('elliott-clock-container');

        window.elliott.printer.log('Ready.');
    } catch (e) {
        console.error('Initialization failed:', e);
        alert(`Emulator Initialization Failed: ${e.message}`);
    }
}




function setupAudioUnlock() {
    const unlock = () => {
        if (window.elliott && window.elliott.console) {
            window.elliott.console.unlockAudio();
        }
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('keydown', unlock);
    };

    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
}

function setupControls() {
    // --- Interlocked mode buttons: READ, NORMAL, OBEY ---
    // Per the 803B manual (Section 3.2.1): these three are mechanically interlocked;
    // pressing one releases the others. Only one can be down at a time.

    function setConsoleMode(mode) {
        window.consoleMode = mode;
        const modes = ['read', 'normal', 'obey'];
        modes.forEach(m => {
            const btn = document.getElementById(`btn-${m}`);
            if (btn) btn.classList.toggle('active', m === mode);
        });
    }

    // Initialise to 'normal' as the default active mode on startup
    setConsoleMode('normal');

    document.getElementById('btn-read')?.addEventListener('click', () => {
        setConsoleMode('read');
        // Entering Read stops automatic running (Step-by-Step lamp lights)
        if (window.elliott && window.elliott.running) {
            stopCpuRun();
            finishRunAccounting('Stopped by READ.');
        }
        updateRunStatus();
        updateUI();
        window.elliott?.printer?.log('READ mode selected.');
    });

    document.getElementById('btn-normal')?.addEventListener('click', () => {
        if (window.elliott && window.elliott.console) {
            window.elliott.console.unlockAudio();
        }
        setConsoleMode('normal');
        window.elliott?.printer?.log('NORMAL mode selected.');
        updateRunStatus();
        updateUI();
    });

    document.getElementById('btn-obey')?.addEventListener('click', () => {
        setConsoleMode('obey');
        // Entering Obey stops automatic running (Step-by-Step lamp lights)
        if (window.elliott && window.elliott.running) {
            stopCpuRun();
            finishRunAccounting('Stopped by OBEY.');
        }
        updateRunStatus();
        updateUI();
        window.elliott?.printer?.log('OBEY mode selected (step-by-step).');
    });

    // --- OPERATE BAR ---
    // Behaviour depends on the currently selected mode (READ / NORMAL / OBEY)
    document.getElementById('operate-bar')?.addEventListener('click', () => {
        if (window.elliott && window.elliott.console) {
            window.elliott.console.unlockAudio();
        }

        // Animate the bar
        const bar = document.getElementById('operate-bar');
        if (bar) {
            bar.style.transform = 'scaleY(0.9)';
            setTimeout(() => (bar.style.transform = 'scaleY(1)'), 100);
        }

        const mode = window.consoleMode;

        if (mode === 'normal') {
            // C behavior for Manual Data (Fn70 wait):
            // if CPU is running and busy on Manual Data, Operate should release
            // that wait point instead of stopping the run loop.
            if (window.manualDataActive && window.elliott?.running && window.elliott?.cpu?.busy) {
                window.elliott.cpu.manualDataOperateLatch = true;
                return;
            }

            // Start/stop continuous execution
            toggleRun();

        } else if (mode === 'read') {
            // READ + Operate: loads F1/N1 word generator into instruction register.
            // Does NOT start execution.
            if (!window.elliott || !window.elliott.cpu) return;
            const cpu = window.elliott.cpu;
            const wg = window.elliott.console ? window.elliott.console.read() : 0n;
            // F1 is bits 38-33, N1 is bits 32-20 of the word generator
            const f1 = (wg >> 33n) & 0x3Fn;  // 6 bits
            const n1 = (wg >> 20n) & 0x1FFFn; // 13 bits
            const instr = (f1 << 13n) | n1;
            const INSTR_MASK = 0x7FFFFn;
            const LOWER20_MASK = 0xFFFFFn;

            // Replace only the currently pending instruction slot, preserving
            // the other half-word and the current SCR/SCR2 sequencing.
            if (cpu.scr2 === 0) {
                cpu.ir = ((instr & INSTR_MASK) << 20n) | (cpu.ir & LOWER20_MASK);
            } else {
                cpu.ir = (cpu.ir & ~INSTR_MASK) | (instr & INSTR_MASK);
            }
            cpu.irx = instr & INSTR_MASK;
            cpu.stopped = true;
            window.elliott.running = false;
            window.elliott.printer.log(`READ + Operate: IR loaded with F1=${Number(f1)}, N1=${Number(n1)}.`);
            updateRunStatus();
            updateDebugStatus();
            updateUI();

        } else if (mode === 'obey') {
            // OBEY + Operate: execute one instruction then stop (step-by-step)
            // If Manual Data is active and CPU is busy on a function-70, also continue
            if (!window.elliott || !window.elliott.cpu) return;
            if (window.manualDataActive && window.elliott.cpu.busy) {
                // Resume one paused Fn70 while keeping Manual Data latched.
                window.elliott.cpu.manualDataOperateLatch = true;
                step();
            } else {
                step();
            }
        }
    });

    // --- SYSTEM RESET ---
    // Per manual Section 3.2.4: stops the machine (step-by-step), clears Busy/Overflow/
    // Block Transfer lamps. Does NOT clear store or CPU registers.
    document.getElementById('btn-reset')?.addEventListener('click', () => {
        if (!window.elliott || !window.elliott.cpu) return;
        // Stop execution
        stopCpuRun();
        // Clear peripheral busy and overflow flags only
        window.elliott.cpu.busy = false;
        window.elliott.cpu.overflow = false;
        window.elliott.cpu.fpOverflow = false;
        window.elliott.cpu.stopped = true;
        window.elliott.running = false;
        window.elliott.printer.log('RESET: Machine stopped. BUSY/OVERFLOW cleared.');
        finishRunAccounting('Reset.');
        updateRunStatus();
        updateDebugStatus();
        updateUI();
    });

    // --- CLEAR STORE (push-push latch) ---
    // Per manual Section 3.2.3: push-push toggle. When latched + Normal + Operate,
    // fills the store with zeros. The button latches on first press, releases on second.
    document.getElementById('btn-clear-store')?.addEventListener('click', () => {
        window.clearStoreLatched = !window.clearStoreLatched;
        const btn = document.getElementById('btn-clear-store');
        if (btn) btn.classList.toggle('active', window.clearStoreLatched);

        if (window.clearStoreLatched) {
            window.elliott?.printer?.log('CLEAR STORE latched. Select NORMAL then OPERATE to clear.');
        } else {
            // Second press releases the latch
            window.elliott?.printer?.log('CLEAR STORE released.');
        }
    });

    // --- SELECTED STOP (push-push latch) ---
    // Per manual Section 3.2.2: when active, stops the machine when the instruction
    // address matches the N2 buttons of the word generator.
    document.getElementById('btn-select-stop')?.addEventListener('click', () => {
        window.selectedStopActive = !window.selectedStopActive;
        const btn = document.getElementById('btn-select-stop');
        if (btn) btn.classList.toggle('active', window.selectedStopActive);
        window.elliott?.printer?.log(`SELECTED STOP: ${window.selectedStopActive ? 'ON' : 'OFF'}.`);
    });

    // --- MANUAL DATA (push-push latch) ---
    // Per manual Section 3.2.5: when active, CPU pauses on function-70 instructions
    // until the Operate bar is pressed.
    document.getElementById('btn-manual-data')?.addEventListener('click', () => {
        window.manualDataActive = !window.manualDataActive;
        if (window.elliott && window.elliott.cpu) {
            window.elliott.cpu.manualDataEnabled = window.manualDataActive;
            if (!window.manualDataActive) {
                window.elliott.cpu.manualDataOperateLatch = false;
            }
        }
        const btn = document.getElementById('btn-manual-data');
        if (btn) btn.classList.toggle('active', window.manualDataActive);
        window.elliott?.printer?.log(`MANUAL DATA: ${window.manualDataActive ? 'ON' : 'OFF'}.`);
    });

    document.getElementById('swap-readers')?.addEventListener('change', (e) => {
        window.elliott.cpu.setReaderSelect(e.target.checked);
        window.elliott.printer.log(`Readers Swapped: ${e.target.checked ? '2 Primary' : '1 Primary'}`);
    });

    document.getElementById('swap-punches')?.addEventListener('change', (e) => {
        window.elliott.cpu.setPunchSelect(e.target.checked);
        window.elliott.printer.log(`Punches Swapped: ${e.target.checked ? '2 Primary' : '1 Primary'}`);
    });

    const librarySelect = document.getElementById('tape-library-select');
    if (librarySelect) setupLibrary(librarySelect);

    document.getElementById('btn-download-punch1')?.addEventListener('click', () => {
        downloadPunch(0, 'punch1.tape');
    });

    document.getElementById('btn-download-punch2')?.addEventListener('click', () => {
        downloadPunch(1, 'punch2.tape');
    });

    document.getElementById('btn-guide-algol')?.addEventListener('click', () => {
        if (window.elliottGuide) window.elliottGuide.startAlgol();
    });

    document.getElementById('btn-guide-asm')?.addEventListener('click', () => {
        if (window.elliottGuide) window.elliottGuide.startASM();
    });

    document.getElementById('btn-install-algol')?.addEventListener('click', () => {
        installAlgolCompiler();
    });

    // Speed toggle buttons
    document.getElementById('btn-speed-realtime')?.addEventListener('click', () => {
        setTurboMode(false);
        restartRunInterval();
    });
    document.getElementById('btn-speed-turbo')?.addEventListener('click', () => {
        setTurboMode(true);
        restartRunInterval();
    });

    // Clock reset button
    document.getElementById('btn-reset-clock')?.addEventListener('click', () => {
        if (window.elliottClock) {
            window.elliottClock.resetToNow();
            if (window.elliott && window.elliott.printer) {
                window.elliott.printer.log('Clock reset to current time.');
            }
        }
    });

    // Default to real-time mode
    setTurboMode(false);

    setupVolumeControl();
}

function setTurboMode(enabled) {
    const desired = !!enabled;
    if (window.runtime.turboMode !== desired) {
        window.runtime.turboMode = desired;
        console.log(`[DEBUG] setTurboMode: Switching to ${desired ? 'TURBO' : 'REAL-TIME'}`);
        if (window.elliott && window.elliott.printer) {
            window.elliott.printer.log(`Speed: ${desired ? 'TURBO' : 'REAL-TIME'}`);
        }
    }
    // Always sync the UI toggle buttons
    const btnRT = document.getElementById('btn-speed-realtime');
    const btnTurbo = document.getElementById('btn-speed-turbo');
    if (btnRT && btnTurbo) {
        btnRT.classList.toggle('active', !desired);
        btnTurbo.classList.toggle('active', desired);
    }
}

// Restart the CPU run interval with the current turboMode tick rate.
// Called when the user toggles speed while the CPU is already running.
function restartRunInterval() {
    if (!window.elliott || !window.elliott.running) return;
    clearInterval(window.elliott.intervalId);
    // Stop and restart the run loop with the new speed
    window.elliott.running = false;
    window.elliott.cpu.stopped = true;
    // Re-enter toggleRun which will start a fresh interval
    toggleRun();
}

function updateAlgolStatus(messageOverride) {
    const el = document.getElementById('algol-status');
    if (!el) return;

    if (messageOverride) {
        el.textContent = messageOverride;
        return;
    }

    if (window.runtime.installingAlgol) {
        el.textContent = 'ALGOL: INSTALLING...';
        el.style.color = '#ffeb3b';
        return;
    }

    if (window.runtime.algolInstalled) {
        el.textContent = 'ALGOL: READY';
        el.style.color = '#7CFC00';
        return;
    }

    el.textContent = 'ALGOL: NOT INSTALLED';
    el.style.color = '#fbc02d';
}

function updateRunStatus() {
    const el = document.getElementById('run-status');
    if (!el || !window.elliott || !window.elliott.cpu) return;

    const running = !!window.elliott.running && !window.elliott.cpu.stopped;
    if (running) {
        el.textContent = 'CPU: RUNNING';
        el.style.color = '#7CFC00';
    } else {
        el.textContent = 'CPU: STOPPED';
        el.style.color = '#ff6b6b';
    }
}

function updateDebugStatus() {
    const el = document.getElementById('debug-status');
    if (!el || !window.elliott || !window.elliott.cpu) return;

    // Throttle DOM updates to prevent layout thrashing / trembling
    const now = performance.now();
    if (updateDebugStatus._lastUpdate && (now - updateDebugStatus._lastUpdate) < 200) return;
    updateDebugStatus._lastUpdate = now;

    const cpu = window.elliott.cpu;
    const busy = cpu.busy ? 1 : 0;
    const reader1Ready = (window.elliott.tapeReaders[0] && window.elliott.tapeReaders[0].isReady()) ? 1 : 0;
    const word = (window.elliott.console && typeof window.elliott.console.read === 'function') ? window.elliott.console.read() : 0n;
    const f1 = (((word >> 38n) & 1n) === 1n) ? 1 : 0;
    const f2 = (((word >> 18n) & 1n) === 1n) ? 1 : 0;
    const scr = cpu.scr & 0x1FFF;
    const ir = cpu.ir;

    el.textContent = `DBG busy=${busy} r1=${reader1Ready} f1=${f1} f2=${f2} scr=${scr} ir=${ir}`;
}


function getSpeedMultiplier() {
    return 1;
}

function beginRunAccounting() {
    window.runtime.runCycles = 0;
    window.runtime.runStartedAtMs = performance.now();
}

function addRunCycles(cycles) {
    if (window.runtime.runStartedAtMs === null) return;
    const c = cycles || 1;
    window.runtime.runCycles += c;
    // Only accumulate Elliott time offset in turbo mode.
    // In real-time mode the CPU already runs at the correct speed,
    // so the clock should stay synchronized with wall time.
    if (!window.elliott.cpu.busy && window.runtime.turboMode) {
        window.runtime.totalElliottCycles += c;
    }
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0.0s';
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds - (m * 60);
    return `${m}m ${s.toFixed(1)}s`;
}

function finishRunAccounting(reason) {
    if (window.runtime.runStartedAtMs === null) return;
    const hostSeconds = (performance.now() - window.runtime.runStartedAtMs) / 1000;
    const realSeconds = (window.runtime.runCycles * 272) / 1000000;
    window.runtime.runStartedAtMs = null;
    window.runtime.runCycles = 0;
    if (window.elliott && window.elliott.printer) {
        window.elliott.printer.log(`${reason} Estimated real Elliott time: ${formatDuration(realSeconds)} (host elapsed ${formatDuration(hostSeconds)}).`);
    }
    // Animate the wall clock to show real Elliott time
    if (window.elliottClock && realSeconds > 0) {
        window.elliottClock.showElliottTime(realSeconds);
    }
}

function syncWordGenButton(bit, active) {
    const btn = document.querySelector(`.wg-btn[data-bit="${bit}"]`);
    if (!btn) return;
    btn.classList.toggle('active', !!active);
    btn.classList.toggle('btn-pressed', !!active);
}

function setWordGenBitState(bit, active) {
    if (!window.elliott || !window.elliott.console) return;
    window.elliott.console.setWordGenBit(bit, !!active);
    syncWordGenButton(bit, !!active);
}

function getWordGenBitState(bit) {
    if (!window.elliott || !window.elliott.console || typeof window.elliott.console.read !== 'function') return false;
    const word = window.elliott.console.read();
    return (((word >> BigInt(bit)) & 1n) === 1n);
}

function toggleWordGenBit(bit) {
    if (!window.elliott || !window.elliott.console) return;
    const active = getWordGenBitState(bit);
    setWordGenBitState(bit, !active);
}

function setupVolumeControl() {
    const volumeSlot = document.querySelector('.volume-slider-slot');
    if (!volumeSlot) return;

    const setVolumeFromEvent = (evt) => {
        const rect = volumeSlot.getBoundingClientRect();
        const y = (evt.touches && evt.touches.length > 0) ? evt.touches[0].clientY : evt.clientY;
        const ratio = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        const level = 1 - ratio;

        volumeSlot.style.setProperty('--volume-pos', `${ratio * 100}%`);
        if (window.elliott && window.elliott.console) {
            window.elliott.console.setVolume(level);
        }
    };

    let dragging = false;

    volumeSlot.addEventListener('mousedown', (evt) => {
        dragging = true;
        setVolumeFromEvent(evt);
    });
    document.addEventListener('mousemove', (evt) => {
        if (dragging) setVolumeFromEvent(evt);
    });
    document.addEventListener('mouseup', () => {
        dragging = false;
    });

    volumeSlot.addEventListener('touchstart', (evt) => {
        dragging = true;
        setVolumeFromEvent(evt);
    }, { passive: true });
    document.addEventListener('touchmove', (evt) => {
        if (dragging) setVolumeFromEvent(evt);
    }, { passive: true });
    document.addEventListener('touchend', () => {
        dragging = false;
    });

    const initial = window.elliott?.console?.volume ?? 0.045;
    volumeSlot.style.setProperty('--volume-pos', `${(1 - initial) * 100}%`);
}

function downloadPunch(punchIndex, filename) {
    const punch = window.elliott.tapePunches[punchIndex];
    if (!punch || !punch.hasData()) {
        window.elliott.printer.log(`Punch ${punchIndex + 1}: No data to download.`);
        return;
    }

    const data = punch.getData();
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    window.elliott.printer.log(`Punch ${punchIndex + 1}: Downloaded ${data.length} bytes.`);
}

function setupLibrary(select) {
    const tapes = [
        { name: 'a104-1.tape', path: 'tapes/algol/a104-1.tape' },
        { name: 'a104-2.tape', path: 'tapes/algol/a104-2.tape' },
        { name: 'hello.algol', path: 'software/hello.algol' },
        { name: 'plot.algol', path: 'software/plot.algol' },
        { name: 'sort.algol', path: 'software/sort.algol' },
        { name: 'trig.algol', path: 'software/trig.algol' },
        { name: 'factorial4.algol', path: 'software/factorial4.algol' },
        { name: 'pi4.algol', path: 'software/pi4.algol' },
        { name: 'sortacm.algol', path: 'software/sortacm.algol' },
        { name: 'hello1.a1', path: 'software/hello1.a1' },
        { name: 'hello2.a1', path: 'software/hello2.a1' },
        { name: 'music.a1', path: 'software/music.a1' },
        { name: 'casaPT.a1', path: 'software/casaPT.a1' },
        { name: 'portuguesehouse.a1', path: 'software/portuguesehouse.a1' },
        { name: 'charset.a1', path: 'software/charset.a1' },
        { name: 'print.a1', path: 'software/print.a1' },
        { name: 'random.a1', path: 'software/random.a1' },
        { name: 'factorial_data.tape', path: 'tapes/data/factorial_data.tape' },
        { name: 'pi_data.tape', path: 'tapes/data/pi_data.tape' }
    ];

    tapes.forEach((tape) => {
        const option = document.createElement('option');
        option.value = tape.path;
        option.textContent = tape.name;
        select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
        const path = e.target.value;
        if (!path) return;
        await loadLibraryTape(path);
    });
}

async function loadLibraryTape(path) {
    const filename = path.split('/').pop();
    let content = null;

    if (window.Assets && window.Assets.tapes && Object.prototype.hasOwnProperty.call(window.Assets.tapes, filename)) {
        content = window.Assets.tapes[filename];
    }

    if (content === null) {
        try {
            const response = await fetch(path);
            content = await response.text();
        } catch (err) {
            window.elliott.printer.log(`Load error: ${err}`);
            return false;
        }
    }

    if (filename.endsWith('.a1')) {
        console.log(`[DEBUG] loadLibraryTape: Detected ASM file: ${filename}`);
        setTurboMode(false); // ASM programs often need real-time execution (e.g. music)
        window.elliott.printer.log(`Assembling ${filename}...`);
        try {
            const assembly = window.Assembler.assemble(content);
            const tape = new Tape();
            tape.name = filename;
            tape.loadBytes(assembly.data);
            tape.entry = assembly.entry;

            if (assembly.storeImage) {
                assembly.storeImage.forEach((item) => {
                    window.elliott.store.write(item.addr, item.val);
                });
                window.elliott.printer.log(`Magic Loader: Loaded ${assembly.storeImage.length} words.`);
            }

            window.elliott.tapeReaders[0].loadTape(tape);
            window.elliott.printer.log(`Assembly complete. Reader 1 ready.`);
            document.getElementById('reader1-status').innerText = 'READY';
            return true;
        } catch (err) {
            window.elliott.printer.log(`Assembly Error: ${err.message}`);
            return false;
        }
    }

    setTurboMode(false); // Algol programs run in real-time by default
    const tape = new Tape();
    tape.name = filename;
    tape.loadUnknown(content);
    window.elliott.tapeReaders[0].loadTape(tape);
    window.elliott.printer.log(`Reader 1: Loaded ${filename}`);
    if (filename.endsWith('.algol') && window.runtime.algolInstalled) {
        window.elliott.printer.log('ALGOL source loaded. Set F1 to compile, then F2 to run.');
    }
    document.getElementById('reader1-status').innerText = 'READY';
    return true;
}

function setReaderStatus(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function stopCpuRun() {
    if (!window.elliott || !window.elliott.cpu) return;
    window.elliott.running = false;
    window.elliott.cpu.stopped = true;
    clearInterval(window.elliott.intervalId);
}

function resetForAlgolBootstrap() {
    window.elliott.store.reset();  // Reinitializes Initial Instructions at 0-3
    window.elliott.cpu.reset();
    window.elliott.cpu.setReaderSelect(false);
    window.elliott.cpu.setPunchSelect(false);
    window.elliott.tapeReaders[1].loadTape(null);

    const swapReaders = document.getElementById('swap-readers');
    if (swapReaders) swapReaders.checked = false;
    const swapPunches = document.getElementById('swap-punches');
    if (swapPunches) swapPunches.checked = false;

    setWordGenBitState(38, false);
    setWordGenBitState(18, false);
    setReaderStatus('reader2-status', 'EMPTY');

    // CPU starts at address 0 — the Initial Instructions bootloader
    window.elliott.cpu.scr = 0;
    window.elliott.cpu.scr2 = 0;
    window.elliott.cpu.fetch();
}

async function loadAlgolTape(path, filename) {
    const tape = new Tape();
    tape.name = filename;

    const bundled = window.Assets && window.Assets.tapes
        ? window.Assets.tapes[filename]
        : null;

    if (bundled instanceof Uint8Array) {
        tape.loadBytes(bundled);
        console.log(`Tape ${filename} loaded from assets (binary), size: ${tape.data.length}`);
        if (window.elliott.printer) window.elliott.printer.log(`Loaded ${filename}: ${tape.data.length} bytes.`);
        return tape;
    }

    if (typeof bundled === 'string') {
        tape.loadUnknown(bundled);
        console.log(`Tape ${filename} loaded from assets (string), size: ${tape.data.length}`);
        if (window.elliott.printer) window.elliott.printer.log(`Loaded ${filename}: ${tape.data.length} bytes (from string).`);
        return tape;
    }

    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Cannot load ${path} (HTTP ${response.status}).`);
    }

    const buf = await response.arrayBuffer();
    tape.loadBytes(new Uint8Array(buf));
    console.log(`Tape ${filename} downloaded, size: ${tape.data.length}`);
    if (window.elliott.printer) window.elliott.printer.log(`Downloaded ${filename}: ${tape.data.length} bytes.`);
    return tape;
}

async function runCpuUntil(checkFn, maxSteps, phaseName) {
    let steps = 0;
    const chunkSize = 50000; // Smaller chunks for better UI updates

    window.elliott.running = true;
    window.elliott.cpu.stopped = false;

    while (steps < maxSteps) {
        const chunkLimit = Math.min(maxSteps, steps + chunkSize);
        while (steps < chunkLimit) {
            window.elliott.operate();
            steps++;
            if (checkFn()) return steps;
        }
        updateRunStatus();
        updateDebugStatus();
        updateUI();

        // Yield to UI
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error(`Install timeout during ${phaseName}.`);
}

async function runUntilTapeLoadComplete(reader, phaseName, maxSteps) {
    let lastPtr = -1;
    let stallCount = 0;
    const STALL_THRESHOLD = 500000; // 500k cycles of no tape movement = done.

    return runCpuUntil(() => {
        if (!reader || !reader.tape) return true; // Error or done

        // 1. If tape is empty, we are done.
        if (!reader.isReady()) return true;

        // 2. If tape has data but pointer isn't moving, CPU has stopped reading.
        const currentPtr = reader.tape.ptr;
        if (currentPtr === lastPtr) {
            stallCount++;
            if (stallCount % 10000 === 0) {
                console.log(`[Install] Stalled ${stallCount}/${STALL_THRESHOLD} cycles at ptr ${currentPtr}`);
            }
            if (stallCount >= STALL_THRESHOLD) {
                console.log(`[Install] Tape load stalled at ptr ${currentPtr}. CPU finished reading?`);
                return true;
            }
        } else {
            if (lastPtr !== -1 && currentPtr > lastPtr + 100) {
                // console.log(`[Install] Progress: ptr ${currentPtr}`);
            }
            lastPtr = currentPtr;
            stallCount = 0;
        }

        return false;
    }, maxSteps, phaseName);
}

async function installAlgolCompiler() {
    if (window.runtime.installingAlgol) return;

    stopCpuRun();

    window.runtime.installingAlgol = true;
    window.runtime.algolInstalled = false;
    const setAlgolStatus = (text, color) => {
        updateAlgolStatus(text);
        const status = document.getElementById('algol-status');
        if (status && color) status.style.color = color;
    };

    setAlgolStatus('ALGOL: ENABLING MODE...', '#ffeb3b');
    if (window.elliottGuide) {
        window.elliottGuide.algolBootReady = false;
    }
    window.elliott.printer.log('ALGOL mode: loading A104 compiler tapes...');

    // PREFETCH OPTIMIZATION:
    // Start downloading BOTH tapes immediately in the background.
    const tape1Promise = loadAlgolTape('tapes/algol/a104-1.tape', 'a104-1.tape');
    // We initiate Tape 2 fetch for caching purposes (it might not be used immediately but will be ready when needed)
    fetch('tapes/algol/a104-2.tape')
        .then(r => r.text())
        .then(content => {
            if (!window.Assets) window.Assets = {};
            if (!window.Assets.tapes) window.Assets.tapes = {};
            window.Assets.tapes['a104-2.tape'] = content;
            console.log('Optimization: Tape 2 pre-fetched and cached.');
        })
        .catch(e => console.warn('Optimization: Tape 2 pre-fetch failed', e));

    try {
        // MAGIC LOAD OPTIMIZATION:
        // Instead of relying on the fragile bootstrap loader, we simply load the 
        // a104-1.tape content directly into memory if we can parse it.
        // A104-1 is usually a binary tape.
        // If we treat it as a sequence of 39-bit words (packed into 5 bytes or similar schemes),
        // we can load it.
        // BUT, we don't know the exact format of the tape (Elliott 803 binary format is complex).

        // ALTERNATIVE:
        // Since the previous bootstrap (store.reset) + Tape combination FAILED,
        // we will try a DIFFERENT bootstrap instruction.
        // "Read into Store" is not a single instruction.

        // Let's go back to the "Standard 40 0" idea but implement it correctly.
        // Op 40 (octal) is 32 (decimal). 
        // Op 32 is "Jump if Zero". That's not it.

        // Op 71 (octal) is "Read".
        // Let's write `00 71 0 0` at address 0.
        // 71 oct = 57 dec.
        // Instruction: 57 << 13 | 0 = 466944.
        // Word: 466944 << 20 = 489626271744n.
        // We write this to 0, 1, 2. 
        // And we set SCR to 0.
        // This will READ one character into Accumulator. 
        // THIS IS NOT ENOUGH.

        // REVERTING TO ORIGINAL STRATEGY FAILED.
        // Let's try the "Magic Loader" for the tape content itself.
        // Since we can't parse it easily, we will try ONE MORE bootstrap variation.
        // The `store.reset()` loader expects a specific format.

        // === TAPE 1: Let the CPU bootloader (Initial Instructions at 0-3) read it ===
        resetForAlgolBootstrap();
        const reader1 = window.elliott.tapeReaders[0];

        const tape1 = await tape1Promise;
        reader1.loadTape(tape1);
        setReaderStatus('reader1-status', 'READY');
        window.elliott.printer.log('Loading Tape 1 via CPU bootloader...');

        // The CPU starts at address 0 (set by resetForAlgolBootstrap).
        // The Initial Instructions read from tape via opcode 71 and
        // assemble 39-bit words into memory at addresses specified by the tape.
        // Tape 1 is 44KB — at ~2500 cycles/byte this needs ~110M cycles.
        const tape1Steps = await runUntilTapeLoadComplete(reader1, 'a104-1.tape', 200000000);
        window.elliott.printer.log(`Tape 1 loaded in ${tape1Steps} CPU cycles.`);

        // Log CPU state after Tape 1
        const scrAfterT1 = window.elliott.cpu.scr;
        window.elliott.printer.log(`Tape 1 done. SCR=${scrAfterT1}.`);

        // === TAPE 2: Load it into Reader 1, toggle F1 to signal CPU ===
        const tape2 = await loadAlgolTape('tapes/algol/a104-2.tape', 'a104-2.tape');
        reader1.loadTape(tape2);
        setReaderStatus('reader1-status', 'READY');
        window.elliott.printer.log('Loading Tape 2 via CPU...');

        // Toggle F1 to signal the compiler to continue loading
        const f1Current = getWordGenBitState(38);
        setWordGenBitState(38, !f1Current);
        window.elliott.printer.log('Signaling CPU to continue (Toggle F1)...');

        // Tape 2 is ~20KB, needs ~50M cycles
        const tape2Steps = await runUntilTapeLoadComplete(reader1, 'a104-2.tape', 100000000);
        window.elliott.printer.log(`Tape 2 loaded in ${tape2Steps} CPU cycles.`);

        setReaderStatus('reader1-status', reader1.isReady() ? 'READY' : 'EMPTY');
        setWordGenBitState(38, false);
        setWordGenBitState(18, false);

        // Don't stop the CPU — leave it running so the compiler's
        // "waiting for source tape" loop is active. When the user loads
        // a source tape, the compiler will automatically read and compile it.
        // We need to transition from the runUntilTapeLoadComplete loop
        // to the normal toggleRun interval loop.
        window.elliott.running = false;
        window.elliott.cpu.stopped = true;

        // === Verify memory load ===
        let nonZero = 0;
        for (let i = 100; i < 8192; i++) {
            if (window.elliott.store.fetch(i) !== 0n) nonZero++;
        }

        if (nonZero > 500) {
            window.runtime.algolInstalled = true;
            if (window.elliottGuide) {
                window.elliottGuide.algolBootReady = true;
            }
            window.elliott.printer.log(`ALGOL INSTALLED. Memory check: ${nonZero} words active.`);
            window.elliott.printer.log('Ready for source tape. Select a program from the Library.');

            // Start the normal CPU loop — compiler is waiting for tape input
            toggleRun();
        } else {
            throw new Error(`Memory check failed. Only ${nonZero} words loaded.`);
        }
    } catch (err) {
        const reason = String((err && err.message) ? err.message : err || 'unknown error');
        const shortReason = reason.length > 26 ? `${reason.slice(0, 26)}...` : reason;
        setAlgolStatus(`ALGOL: INSTALL FAILED (${shortReason})`, '#ff6b6b');
        window.elliott.printer.log(`ALGOL mode install failed: ${reason}`);
        console.error('ALGOL mode load failed:', err);
    } finally {
        window.runtime.installingAlgol = false;
        if (window.runtime.algolInstalled) {
            updateAlgolStatus();
        }
        updateRunStatus();
        updateDebugStatus();
        updateUI();
    }
}

function step() {
    try {
        if (!window.elliott || !window.elliott.cpu) return;

        const cpu = window.elliott.cpu;
        window.elliott.running = false;
        cpu.stopped = false;

        // In C, OBEY + Operate runs until the current instruction completes.
        // For busy instructions this may require repeated attempts.
        let guard = 0;
        const maxBusyRetries = 5000;
        do {
            window.elliott.operate();
            guard++;

            if (!cpu.busy) break;

            // Manual Data waits at Fn70 until Operate is pressed again.
            if (window.manualDataActive && !cpu.manualDataOperateLatch) {
                break;
            }
        } while (guard < maxBusyRetries);

        if (cpu.busy && guard >= maxBusyRetries) {
            window.elliott.printer?.log('OBEY: instruction still BUSY after retry limit.');
        }

        cpu.stopped = true;
        updateRunStatus();
        updateDebugStatus();
        updateUI();
    } catch (e) {
        window.elliott.printer.log(`Error: ${e.message}`);
        window.elliott.running = false;
        clearInterval(window.elliott.intervalId);
        updateRunStatus();
        updateDebugStatus();
    }
}

function toggleRun() {
    if (window.elliott.running) {
        window.elliott.running = false;
        window.elliott.cpu.stopped = true;
        clearInterval(window.elliott.intervalId);
        updateRunStatus();
        updateDebugStatus();
        finishRunAccounting('Run stopped.');
        return;
    }

    // If Clear Store is latched and we are in Normal mode, execute store clear
    if (window.clearStoreLatched && window.consoleMode === 'normal') {
        window.elliott.store.clear();
        window.elliott.printer.log('Store cleared (6-12 seconds on real hardware). Press OBEY then release CLEAR STORE to finish.');
        // Don't start normal execution — operator should press Obey then release Clear Store
        return;
    }

    window.elliott.running = true;
    window.elliott.cpu.stopped = false;
    updateRunStatus();
    updateDebugStatus();
    beginRunAccounting();

    // Auto-detect ASM tape to force Real-Time
    const reader1 = window.elliott.tapeReaders[0];
    const isAsm = reader1 && reader1.tape && reader1.tape.name && reader1.tape.name.endsWith('.a1');
    console.log(`[DEBUG] toggleRun: isAsm=${isAsm}, currentTurbo=${window.runtime.turboMode}`);

    if (isAsm) {
        if (window.runtime.turboMode) {
            console.log("[DEBUG] toggleRun: FORCE DISABLE TURBO for ASM");
            setTurboMode(false);
        }
    }

    // RE-READ turboMode in case it changed above
    const tickMs = window.runtime.turboMode ? 1 : 10;
    console.log(`[DEBUG] toggleRun: tickMs=${tickMs}`);
    const cycleUs = 272;
    let cycleBudget = 0;
    let lastTickTime = performance.now();

    // Pre-seed the audio queue with silence to create buffer headroom.
    // This absorbs setInterval jitter during the first few ticks.
    if (!window.runtime.turboMode && window.elliott.console) {
        window.elliott.console.speakerSound(false, 200);
    }

    window.elliott.intervalId = setInterval(() => {
        if (!window.elliott.running) return;
        const sliceStart = performance.now();
        let guard = 0;
        if (window.runtime.turboMode) {
            let busySteps = 0;
            const maxTurboOpsPerSlice = 200000;
            // Clear dirty flags at start of slice
            if (window.elliott.printer) window.elliott.printer.dirty = false;

            while (window.elliott.running && !window.elliott.cpu.stopped && guard < maxTurboOpsPerSlice) {
                window.elliott.operate();
                addRunCycles(window.elliott.cpu.lastCycles || 1);
                guard++;

                // Yield on BUSY waits only if we've been stuck for a while (e.g. waiting for input).
                if (window.elliott.cpu.busy) {
                    busySteps++;
                    if (busySteps > 5000) {
                        break;
                    }
                } else {
                    busySteps = 0;
                }

                // Yield early if the printer has new output so the browser can repaint.
                // Check every 1000 ops to avoid overhead on every iteration.
                if ((guard & 0x3FF) === 0 && window.elliott.printer && window.elliott.printer.dirty) {
                    break;
                }
            }
        } else {
            // Wall-clock-based cycle budget: compensates for setInterval jitter.
            // If a tick arrives late, we run extra cycles to catch up, keeping
            // audio production synchronized with consumption.
            const now = performance.now();
            const elapsedMs = now - lastTickTime;
            lastTickTime = now;
            const cyclesFromElapsed = ((elapsedMs * 1000) / cycleUs) * getSpeedMultiplier();
            cycleBudget += cyclesFromElapsed;
            while (window.elliott.running && !window.elliott.cpu.stopped && cycleBudget >= 1 && guard < 2000) {
                window.elliott.operate();
                const spent = window.elliott.cpu.lastCycles || 1;
                addRunCycles(spent);
                cycleBudget -= spent;
                guard++;
            }
        }

        // Track real wall time spent computing for the Elliott Time clock
        window.runtime.totalComputeMs += (performance.now() - sliceStart);

        if (cycleBudget > 1000) {
            cycleBudget = 1000;
        }
        if (window.elliott.running && window.elliott.cpu.stopped) {
            window.elliott.running = false;
            clearInterval(window.elliott.intervalId);
            updateRunStatus();
            updateDebugStatus();
            finishRunAccounting('Run complete.');
            return;
        }
        updateRunStatus();
        updateDebugStatus();
        updateUI();
    }, tickMs);
}

function updateUI() {
    if (window.consoleUI && window.elliott && window.elliott.cpu) {
        window.consoleUI.updateLights(window.elliott.cpu);
    }
}

window.setWordGenBitState = setWordGenBitState;
window.toggleWordGenBit = toggleWordGenBit;

window.addEventListener('DOMContentLoaded', init);
