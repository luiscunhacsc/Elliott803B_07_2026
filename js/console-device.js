/**
 * Elliott 803B Console Device
 *
 * Hardware emulation of the Console.
 * Handles:
 * - Word Generator (Input)
 * - Speaker (Sound) — via AudioWorklet (off-thread) with ScriptProcessorNode fallback
 * - Busy/Overflow status updates (from CPU)
 */
class ConsoleDevice {
    constructor(computer) {
        this.computer = computer;
        this.wordGen = 0n;

        this.speakerOn = true;
        this.volume = 0.045;

        this.sampleRate = 44100;
        this.frameSize = 12;
        this.cycleUs = Math.floor((this.frameSize * 1000000) / this.sampleRate); // ~=272us

        this.audioCtx = null;
        this.masterGain = null;
        this.audioNode = null;  // AudioWorkletNode or ScriptProcessorNode
        this.useWorklet = false;

        // Batching: accumulate segments on main thread, flush periodically
        this.pendingSegments = [];
        this.flushScheduled = false;

        // Fallback state (only used if ScriptProcessorNode path is active)
        this.segmentQueue = [];
        this.maxQueuedFrames = Math.floor((this.sampleRate * 2) / this.frameSize); // ~2s
        this.totalQueuedFrames = 0;
        this.currentType = 0;
        this.currentFramesLeft = 0;
        this.framePos = 0;

        this.pulseAmplitude = 0.38;

        // Smooth fade-out on underrun (prevents pops)
        this.lastSample = 0;
        this.fadeOut = false;
        this.fadeLevel = 0;
        this.fadeDecay = 0.97;
    }

    reset() {
        this.wordGen = 0n;

        if (this.useWorklet && this.audioNode) {
            // Tell the worklet to reset its internal state
            this.audioNode.port.postMessage({ cmd: 'reset' });
            this.pendingSegments = [];
            this.flushScheduled = false;
        } else {
            // ScriptProcessorNode fallback
            this.segmentQueue = [];
            this.totalQueuedFrames = 0;
            this.currentType = 0;
            this.currentFramesLeft = 0;
            this.framePos = 0;
            this.lastSample = 0;
            this.fadeOut = false;
            this.fadeLevel = 0;
        }
    }

    read() {
        return this.wordGen;
    }

    setWordGen(val) {
        this.wordGen = BigInt(val) & 0x7FFFFFFFFFn;
    }

    setWordGenBit(bit, active) {
        const mask = 1n << BigInt(bit);
        if (active) {
            this.wordGen |= mask;
        } else {
            this.wordGen &= ~mask;
        }
    }

    unlockAudio() {
        if (!this.audioCtx) {
            this.initAudio();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => { });
        }
    }

    setVolume(level) {
        const v = Math.max(0, Math.min(1, Number(level)));
        this.volume = v;
        this.speakerOn = v > 0;

        const curve = Math.pow(v, 2.0);
        this.pulseAmplitude = (v > 0) ? (0.06 + (0.72 * curve)) : 0;

        if (this.useWorklet && this.audioNode) {
            this.audioNode.port.postMessage({ cmd: 'amplitude', value: this.pulseAmplitude });
        }

        if (this.masterGain && this.audioCtx) {
            const now = this.audioCtx.currentTime;
            this.masterGain.gain.setTargetAtTime(v > 0 ? 1 : 0, now, 0.015);
        }
    }

    speakerSound(click, cycles) {
        if (!this.speakerOn) return;
        if (!this.audioCtx) return;

        const count = Math.max(0, Number(cycles) || 0);
        if (count === 0) return;

        const type = click ? 1 : 0;

        if (this.useWorklet) {
            // Batch segments and flush to the worklet periodically
            const last = this.pendingSegments[this.pendingSegments.length - 1];
            if (last && last.type === type) {
                last.count += count;
            } else {
                this.pendingSegments.push({ type, count });
            }

            if (!this.flushScheduled) {
                this.flushScheduled = true;
                // Use queueMicrotask for minimal latency — flushes after the
                // current JS task (CPU slice) completes but before the browser
                // does any rendering or timer callbacks.
                queueMicrotask(() => this.flushToWorklet());
            }
        } else {
            // ScriptProcessorNode fallback — same logic as before
            const last = this.segmentQueue[this.segmentQueue.length - 1];
            if (last && last.type === type) {
                last.count += count;
            } else {
                this.segmentQueue.push({ type, count });
            }

            this.totalQueuedFrames += count;

            while (this.totalQueuedFrames > this.maxQueuedFrames && this.segmentQueue.length > 0) {
                const seg = this.segmentQueue[0];
                const drop = Math.min(seg.count, this.totalQueuedFrames - this.maxQueuedFrames);
                seg.count -= drop;
                this.totalQueuedFrames -= drop;
                if (seg.count <= 0) this.segmentQueue.shift();
            }
        }
    }

    flushToWorklet() {
        this.flushScheduled = false;
        if (this.pendingSegments.length === 0) return;
        if (!this.audioNode) return;

        this.audioNode.port.postMessage({
            cmd: 'segments',
            data: this.pendingSegments
        });
        this.pendingSegments = [];
    }

    initAudio() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            this.audioCtx = new AudioContext({ sampleRate: this.sampleRate });

            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 0;
            this.masterGain.connect(this.audioCtx.destination);

            // ScriptProcessorNode provides more consistent audio because it has
            // direct synchronous access to the segment queue. AudioWorklet runs
            // off-thread but MessagePort delivery jitter can cause audio gaps.
            this.initScriptProcessor();

            this.setVolume(this.volume);
        } catch (e) {
            console.error('Audio Init Failed', e);
        }
    }

    async initWorklet() {
        try {
            await this.audioCtx.audioWorklet.addModule('js/speaker-worklet.js');

            this.audioNode = new AudioWorkletNode(this.audioCtx, 'speaker-worklet-processor', {
                outputChannelCount: [1],
                processorOptions: {
                    frameSize: this.frameSize,
                    sampleRate: this.sampleRate,
                    pulseAmplitude: this.pulseAmplitude
                }
            });

            this.audioNode.connect(this.masterGain);
            this.useWorklet = true;
            console.log('Audio: using AudioWorklet (off-thread)');
        } catch (e) {
            console.warn('AudioWorklet failed, falling back to ScriptProcessorNode:', e);
            this.initScriptProcessor();
        }
    }

    initScriptProcessor() {
        this.scriptNode = this.audioCtx.createScriptProcessor(8192, 0, 1);
        this.scriptNode.onaudioprocess = (ev) => this.fillAudio(ev.outputBuffer.getChannelData(0));
        this.scriptNode.connect(this.masterGain);
        this.audioNode = this.scriptNode;
        this.useWorklet = false;
        console.log('Audio: using ScriptProcessorNode (main-thread fallback)');
    }

    // --- ScriptProcessorNode fallback audio fill ---

    fillAudio(out) {
        for (let i = 0; i < out.length; i++) {
            if (this.currentFramesLeft <= 0 && this.framePos === 0) {
                if (!this.loadNextSegment()) {
                    // Queue underrun — fade out smoothly instead of hard silence
                    if (this.lastSample !== 0 && !this.fadeOut) {
                        this.fadeOut = true;
                        this.fadeLevel = Math.abs(this.lastSample);
                    }

                    if (this.fadeOut && this.fadeLevel > 0.001) {
                        this.fadeLevel *= this.fadeDecay;
                        out[i] = this.fadeLevel * Math.sign(this.lastSample);
                    } else {
                        out[i] = 0;
                        this.fadeOut = false;
                        this.fadeLevel = 0;
                    }
                    continue;
                }
            }

            let sample = 0;
            if (this.currentType === 1) {
                // Pulse frame: first half non-zero, second half zero.
                if (this.framePos < (this.frameSize >> 1)) {
                    sample = this.pulseAmplitude;
                }
            }

            out[i] = sample;
            this.lastSample = sample;

            this.framePos++;
            if (this.framePos >= this.frameSize) {
                this.framePos = 0;
                if (this.currentFramesLeft > 0) this.currentFramesLeft--;
            }
        }
    }

    loadNextSegment() {
        if (this.segmentQueue.length === 0) {
            return false; // Queue empty — signal underrun
        }

        const seg = this.segmentQueue[0];
        this.currentType = seg.type;
        this.currentFramesLeft = seg.count;
        this.totalQueuedFrames -= seg.count;
        this.segmentQueue.shift();
        this.fadeOut = false;
        return true;
    }

    setBusy() {
        if (window.consoleUI) window.consoleUI.updateLights(this.computer.cpu);
    }

    setOverflow() {
        if (window.consoleUI) window.consoleUI.updateLights(this.computer.cpu);
    }

    setStep() {
        if (window.consoleUI) window.consoleUI.updateLights(this.computer.cpu);
    }
}

window.ConsoleDevice = ConsoleDevice;
