/**
 * Elliott 803B Computer Room Wall Clock
 * 1960s British Industrial Style Analog Clock
 * 
 * Shows "Elliott Time" — what the wall clock in the computer room
 * would show if you were sitting in front of a real Elliott 803B.
 * During turbo computation, the clock spins fast because what takes
 * milliseconds for us would take minutes on the real machine.
 */
class ElliottClock {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.animationFrame = null;
        this.messageTimeout = null;

        this.buildClock();
        this.start();
    }

    buildClock() {
        this.container.innerHTML = `
            <div id="elliott-clock">
                <svg viewBox="0 0 100 100">
                    <defs>
                        <linearGradient id="bezel-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#d4c9a8"/>
                            <stop offset="30%" style="stop-color:#c0b090"/>
                            <stop offset="50%" style="stop-color:#a09078"/>
                            <stop offset="70%" style="stop-color:#c0b090"/>
                            <stop offset="100%" style="stop-color:#8a7d6b"/>
                        </linearGradient>
                    </defs>

                    <!-- Face -->
                    <circle class="clock-face" cx="50" cy="50" r="45"/>
                    <circle class="clock-bezel" cx="50" cy="50" r="47"/>

                    <!-- Brand text -->
                    <text x="50" y="32" text-anchor="middle" 
                          font-family="serif" font-size="4.5" fill="#555"
                          letter-spacing="0.8">ELLIOTT</text>

                    <!-- Hour markers -->
                    ${this.generateMarkers()}

                    <!-- Hands -->
                    <line class="clock-hand-hour" id="clock-hour"
                          x1="50" y1="50" x2="50" y2="24"/>
                    <line class="clock-hand-minute" id="clock-minute"
                          x1="50" y1="50" x2="50" y2="16"/>
                    <line class="clock-hand-second" id="clock-second"
                          x1="50" y1="55" x2="50" y2="14"/>

                    <!-- Center -->
                    <circle class="clock-center-dot" cx="50" cy="50" r="2.5"/>
                    <circle class="clock-center-pin" cx="50" cy="50" r="1"/>
                </svg>
            </div>
            <div class="clock-label">Elliott Time</div>
            <div id="elliott-time-message"></div>
        `;

        this.hourHand = document.getElementById('clock-hour');
        this.minuteHand = document.getElementById('clock-minute');
        this.secondHand = document.getElementById('clock-second');
        this.clockEl = document.getElementById('elliott-clock');
        this.messageEl = document.getElementById('elliott-time-message');
    }

    generateMarkers() {
        let markers = '';
        for (let i = 0; i < 60; i++) {
            const angle = (i * 6) * Math.PI / 180;
            const isHour = i % 5 === 0;
            const innerR = isHour ? 38 : 41;
            const outerR = 43;
            const x1 = 50 + innerR * Math.sin(angle);
            const y1 = 50 - innerR * Math.cos(angle);
            const x2 = 50 + outerR * Math.sin(angle);
            const y2 = 50 - outerR * Math.cos(angle);
            const cls = isHour ? 'clock-marker' : 'clock-marker-minor';
            markers += `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        }
        return markers;
    }

    start() {
        const tick = () => {
            this.updateHands();
            this.animationFrame = requestAnimationFrame(tick);
        };
        tick();
    }

    /**
     * Calculate the Elliott Time offset in milliseconds.
     * 
     * The offset = (time the computation would take on a real Elliott)
     *             - (time it actually took on the host machine)
     * 
     * During turbo mode, we execute millions of cycles in milliseconds.
     * On a real Elliott 803B at 272μs/cycle, those same cycles would
     * take much longer. The difference is the clock's forward offset.
     */
    getElliottOffsetMs() {
        if (!window.runtime) return 0;
        const elliottMs = (window.runtime.totalElliottCycles * 272) / 1000;
        const realMs = window.runtime.totalComputeMs || 0;
        return elliottMs - realMs;
    }

    updateHands() {
        // Elliott Time = real time + offset from computation speed difference
        const offsetMs = this.getElliottOffsetMs();
        const elliottTime = new Date(Date.now() + offsetMs);

        const hours = elliottTime.getHours() % 12;
        const minutes = elliottTime.getMinutes();
        const seconds = elliottTime.getSeconds();
        const ms = elliottTime.getMilliseconds();

        // Smooth second hand
        const secondAngle = (seconds + ms / 1000) * 6;
        const minuteAngle = (minutes + seconds / 60) * 6;
        const hourAngle = (hours + minutes / 60) * 30;

        this.setHandRotation(this.hourHand, hourAngle);
        this.setHandRotation(this.minuteHand, minuteAngle);
        this.setHandRotation(this.secondHand, secondAngle);

        // Update the message with current offset if significant
        this.updateOffsetDisplay(offsetMs);
    }

    setHandRotation(hand, degrees) {
        if (!hand) return;
        hand.setAttribute('transform', `rotate(${degrees} 50 50)`);
    }

    updateOffsetDisplay(offsetMs) {
        if (!this.messageEl) return;
        const offsetSec = offsetMs / 1000;

        if (offsetSec < 1) {
            // No significant offset — clock matches real time
            if (this.messageEl.classList.contains('visible')) {
                this.messageEl.classList.remove('visible');
            }
            return;
        }

        // Show how far ahead the Elliott clock is
        const msg = this.formatElliottDuration(offsetSec);
        this.messageEl.textContent = msg;
        if (!this.messageEl.classList.contains('visible')) {
            this.messageEl.classList.add('visible');
        }
    }

    /**
     * Show a specific message after program completion.
     */
    showElliottTime(realSeconds) {
        if (!this.messageEl) return;
        const msg = `Task would take ${this.formatDuration(realSeconds)} on a real Elliott 803B`;
        this.messageEl.textContent = msg;
        this.messageEl.classList.add('visible');

        if (this.messageTimeout) clearTimeout(this.messageTimeout);
        this.messageTimeout = setTimeout(() => {
            // Return to showing live offset
        }, 20000);
    }

    formatElliottDuration(seconds) {
        if (seconds < 60) return `+${seconds.toFixed(0)}s ahead`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `+${h}h ${m}m ahead`;
        return `+${m}m ${s}s ahead`;
    }

    formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0s';
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}h ${m}m ${s}s`;
        return `${m}m ${s}s`;
    }

    resetToNow() {
        if (window.runtime) {
            window.runtime.totalElliottCycles = 0;
            window.runtime.totalComputeMs = 0;
        }
        if (this.messageEl) {
            this.messageEl.textContent = '';
            this.messageEl.classList.remove('visible');
        }
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }

    destroy() {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        if (this.messageTimeout) clearTimeout(this.messageTimeout);
    }
}

window.ElliottClock = ElliottClock;
