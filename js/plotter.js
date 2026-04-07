/**
 * Elliott 803B Digital Plotter — Continuous Paper Roll
 * 
 * Simulates a Calcomp pen plotter with continuous paper.
 * The canvas auto-expands vertically as the pen moves,
 * and the wrapper scrolls to follow the pen position.
 */
class Plotter {
    constructor() {
        this.canvas = document.getElementById('plotter-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.wrapper = this.canvas ? this.canvas.parentElement : null;

        // Fixed horizontal size (1100 plotter units wide)
        this.plotterWidth = 1100;

        // Track min/max Y to know the paper extent
        this.minY = -250;
        this.maxY = 250;

        this.reset();
    }

    reset() {
        this.penDown = false;
        this.x = 0;
        this.y = 0;
        this.minY = -250;
        this.maxY = 250;

        if (!this.canvas || !this.ctx) return;

        // Set initial canvas size
        this.canvas.width = 600;
        this.canvas.height = 500;
        this.clearCanvas();
    }

    clearCanvas() {
        if (!this.ctx) return;
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.strokeStyle = '#0b3d91';
        this.ctx.lineWidth = 1;
        this.ctx.lineCap = 'round';
    }

    /**
     * Expand the canvas if the pen has moved beyond current bounds.
     * Preserves all existing drawings by copying them to the new canvas.
     */
    expandIfNeeded() {
        const margin = 50;
        let needsExpand = false;

        // Update bounds if pen is outside
        if (this.y < this.minY) {
            this.minY = this.y - margin;
            needsExpand = true;
        }
        if (this.y > this.maxY) {
            this.maxY = this.y + margin;
            needsExpand = true;
        }

        if (!needsExpand || !this.ctx) return;

        // Since toCanvasY centers 0 at height/2, we need a height that accommodates
        // the furthest point from 0 in either direction symmetrically.
        const maxExtent = Math.max(Math.abs(this.minY), Math.abs(this.maxY));
        const newHeight = Math.max(500, maxExtent * 2);

        if (newHeight <= this.canvas.height) return;

        // Save the current canvas content
        const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const oldHeight = this.canvas.height;

        // Calculate the center offset to keep Y=0 in the middle
        const oldMid = oldHeight / 2;
        const newMid = newHeight / 2;
        const offsetY = newMid - oldMid;

        // Resize canvas (this clears it)
        this.canvas.height = newHeight;

        // Restore drawing state
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.canvas.width, newHeight);

        // Put image data back, shifted so the center (Y=0) stays aligned
        this.ctx.putImageData(imageData, 0, offsetY);

        // Restore drawing style
        this.ctx.strokeStyle = '#0b3d91';
        this.ctx.lineWidth = 1;
        this.ctx.lineCap = 'round';
    }

    controlWrite(addr) {
        if (!this.ctx) return;

        let dx = 0;
        let dy = 0;

        switch (addr) {
            case 7184: this.penDown = false; return;
            case 7200: this.penDown = true; return;
            case 7169: dx = 1; break;
            case 7170: dx = -1; break;
            case 7172: dy = 1; break;
            case 7176: dy = -1; break;
            case 7173: dx = 1; dy = 1; break;
            case 7174: dx = -1; dy = 1; break;
            case 7177: dx = 1; dy = -1; break;
            case 7178: dx = -1; dy = -1; break;
            default: return;
        }

        const oldX = this.x;
        const oldY = this.y;

        this.x = Math.max(0, Math.min(this.plotterWidth - 1, this.x + dx));
        this.y = this.y + dy;

        // Expand canvas if pen exceeded current bounds
        this.expandIfNeeded();

        if (this.penDown) {
            const sx1 = this.toCanvasX(oldX);
            const sy1 = this.toCanvasY(oldY);
            const sx2 = this.toCanvasX(this.x);
            const sy2 = this.toCanvasY(this.y);

            this.ctx.beginPath();
            this.ctx.moveTo(sx1, sy1);
            this.ctx.lineTo(sx2, sy2);
            this.ctx.stroke();
        }

        // Auto-scroll to follow pen position
        this.scrollToPen();
    }

    toCanvasX(x) {
        return (x / (this.plotterWidth - 1)) * (this.canvas.width - 1);
    }

    toCanvasY(y) {
        const mid = this.canvas.height / 2;
        return mid - y;
    }

    scrollToPen() {
        if (!this.wrapper) return;
        const penCanvasY = this.toCanvasY(this.y);
        const wrapperHeight = this.wrapper.clientHeight;
        // Scroll so the pen is roughly centered in the viewport
        const targetScroll = penCanvasY - wrapperHeight / 2;
        this.wrapper.scrollTop = Math.max(0, targetScroll);
    }
}

window.Plotter = Plotter;
