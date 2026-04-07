/**
 * Elliott 803B Speaker AudioWorklet Processor
 *
 * Runs on a dedicated audio thread, completely independent of the main thread.
 * Receives audio segments ({type, count}) via MessagePort from the main thread
 * and generates pulse/silence samples for the Elliott 803B speaker emulation.
 *
 * Includes pre-buffering to absorb MessagePort delivery jitter, and smooth
 * fade-out on queue underrun to eliminate pops.
 */
class SpeakerWorkletProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        const params = (options && options.processorOptions) || {};
        this.frameSize = params.frameSize || 12;
        this.sampleRate = params.sampleRate || 44100;
        this.pulseAmplitude = params.pulseAmplitude || 0.38;
        this.maxQueuedFrames = Math.floor((this.sampleRate * 2) / this.frameSize);

        // Pre-buffering: don't start producing audio until we have enough data.
        // This absorbs the bursty nature of MessagePort delivery.
        // ~55ms of audio at 3675 frames/sec ≈ 200 frames
        this.preBufferFrames = 200;
        this.primed = false;

        // Segment queue (same format as old main-thread queue)
        this.segmentQueue = [];
        this.totalQueuedFrames = 0;

        // Current playback state
        this.currentType = 0;
        this.currentFramesLeft = 0;
        this.framePos = 0;

        // Smooth fade-out on underrun (prevents pops)
        this.lastSample = 0;
        this.fadeOut = false;
        this.fadeLevel = 0;
        this.fadeDecay = 0.97; // ~10ms fade at 44.1kHz

        this.port.onmessage = (e) => this.handleMessage(e.data);
    }

    handleMessage(msg) {
        if (msg.cmd === 'segments') {
            const segs = msg.data;
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                const last = this.segmentQueue[this.segmentQueue.length - 1];
                if (last && last.type === seg.type) {
                    last.count += seg.count;
                } else {
                    this.segmentQueue.push({ type: seg.type, count: seg.count });
                }
                this.totalQueuedFrames += seg.count;
            }

            // Drop oldest frames if queue is too deep
            while (this.totalQueuedFrames > this.maxQueuedFrames && this.segmentQueue.length > 0) {
                const seg = this.segmentQueue[0];
                const drop = Math.min(seg.count, this.totalQueuedFrames - this.maxQueuedFrames);
                seg.count -= drop;
                this.totalQueuedFrames -= drop;
                if (seg.count <= 0) this.segmentQueue.shift();
            }
        } else if (msg.cmd === 'amplitude') {
            this.pulseAmplitude = msg.value;
        } else if (msg.cmd === 'reset') {
            this.segmentQueue = [];
            this.totalQueuedFrames = 0;
            this.currentType = 0;
            this.currentFramesLeft = 0;
            this.framePos = 0;
            this.primed = false;
            this.fadeOut = false;
            this.fadeLevel = 0;
            this.lastSample = 0;
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

    process(inputs, outputs) {
        const out = outputs[0][0];
        if (!out) return true;

        // Pre-buffering: output silence until we've accumulated enough data
        if (!this.primed) {
            if (this.totalQueuedFrames < this.preBufferFrames) {
                out.fill(0);
                return true;
            }
            this.primed = true;
        }

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

        return true;
    }
}

registerProcessor('speaker-worklet-processor', SpeakerWorkletProcessor);
