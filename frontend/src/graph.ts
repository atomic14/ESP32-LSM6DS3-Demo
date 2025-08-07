export type AccelVector = { x: number; y: number; z: number };

interface AccelGraphOptions {
  historyLength?: number;
  minG?: number;
  maxG?: number;
}

/**
 * Lightweight canvas sparkline graph for accelerometer X/Y/Z.
 * Designed as an overlay; canvas should have CSS size, we handle DPR scaling.
 */
export class AccelGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private historyLength: number;
  private minG: number;
  private maxG: number;
  private accelX: number[] = [];
  private accelY: number[] = [];
  private accelZ: number[] = [];

  constructor(canvas: HTMLCanvasElement, options: AccelGraphOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for graph canvas');
    this.ctx = ctx;

    this.historyLength = options.historyLength ?? 300;
    this.minG = options.minG ?? -2;
    this.maxG = options.maxG ?? 2;

    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // Only resize canvas backing store if size actually changed
    const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
    const targetHeight = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    // Draw using CSS pixels coordinates
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  addPoint(accel: AccelVector) {
    this.accelX.push(accel.x);
    this.accelY.push(accel.y);
    this.accelZ.push(accel.z);

    if (this.accelX.length > this.historyLength) this.accelX.shift();
    if (this.accelY.length > this.historyLength) this.accelY.shift();
    if (this.accelZ.length > this.historyLength) this.accelZ.shift();

    this.draw();
  }

  clear() {
    this.accelX = [];
    this.accelY = [];
    this.accelZ = [];
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    const cssWidth = this.canvas.clientWidth || 300;
    const cssHeight = this.canvas.clientHeight || 120;
    const width = cssWidth;
    const height = cssHeight;
    const padLeft = 8;
    const padRight = 8;
    const padTop = 8;
    const padBottom = 16;

    // Background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // Grid lines: zero, ±1g
    const valueToY = (v: number) => {
      const t = (v - this.minG) / (this.maxG - this.minG);
      return Math.max(
        padTop,
        Math.min(height - padBottom, height - padBottom - t * (height - padTop - padBottom))
      );
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([4, 4]);
    [this.minG, 0, 1, -1, this.maxG].forEach((v) => {
      const y = valueToY(v);
      ctx.beginPath();
      ctx.moveTo(padLeft, y + 0.5);
      ctx.lineTo(width - padRight, y + 0.5);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Labels for range
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${this.maxG.toFixed(1)}g`, padLeft, 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${this.minG.toFixed(1)}g`, padLeft, height - 2);

    const drawSeries = (data: number[], color: string) => {
      if (data.length < 2) return;
      const innerWidth = width - padLeft - padRight;
      const sampleSpacing = innerWidth / Math.max(1, this.historyLength - 1);
      const len = data.length;
      const startX = padLeft + Math.max(0, innerWidth - (len - 1) * sampleSpacing);
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const x = startX + i * sampleSpacing;
        const y = valueToY(data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    drawSeries(this.accelX, '#ff6666');
    drawSeries(this.accelY, '#66ff66');
    drawSeries(this.accelZ, '#6699ff');

    // Legend
    const legendY = height - 6;
    const legendItems = [
      { label: 'X', color: '#ff6666' },
      { label: 'Y', color: '#66ff66' },
      { label: 'Z', color: '#6699ff' },
    ];
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    let xOff = padLeft;
    for (const item of legendItems) {
      ctx.fillStyle = item.color;
      ctx.fillRect(xOff, legendY - 8, 10, 3);
      xOff += 14;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(item.label, xOff, legendY);
      xOff += ctx.measureText(item.label).width + 10;
    }
  }
}


