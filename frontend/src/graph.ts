export type DataVector = { x: number; y: number; z: number };

interface AccelGraphOptions {
  historyLength?: number;
  minValue?: number;
  maxValue?: number;
  unitLabel?: string; // label suffix for axis (e.g., 'g', '°/s')
  title?: string; // optional chart title
  seriesLabels?: string[]; // labels for legend; length 1-3, defaults to ['X','Y','Z']
  autoscale?: boolean; // if true, scale min/max from current data each draw
  autoscalePadding?: number; // fraction of range to pad when autoscaling (default 0.1)
  minSpan?: number; // enforce a minimum value span when autoscaling (same units as data)
}

/**
 * Lightweight canvas sparkline graph for arbitrary X/Y/Z time series.
 * Designed as an overlay; canvas should have CSS size, we handle DPR scaling.
 */
export class AccelGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private historyLength: number;
  private minValue: number;
  private maxValue: number;
  private unitLabel: string;
  private title: string;
  private seriesLabels: string[];
  private seriesColors: string[] = ['#ff6666', '#66ff66', '#6699ff'];
  private autoscale: boolean;
  private autoscalePadding: number;
  private minSpan: number;
  private seriesX: number[] = [];
  private seriesY: number[] = [];
  private seriesZ: number[] = [];

  constructor(canvas: HTMLCanvasElement, options: AccelGraphOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for graph canvas');
    this.ctx = ctx;

    this.historyLength = options.historyLength ?? 300;
    this.minValue = options.minValue ?? -2;
    this.maxValue = options.maxValue ?? 2;
    this.unitLabel = options.unitLabel ?? 'g';
    this.title = options.title ?? '';
    this.seriesLabels = (options.seriesLabels && options.seriesLabels.length > 0)
      ? options.seriesLabels.slice(0, 3)
      : ['X', 'Y', 'Z'];
    this.autoscale = options.autoscale ?? false;
    this.autoscalePadding = Math.max(0, options.autoscalePadding ?? 0.1);
    this.minSpan = Math.max(0, options.minSpan ?? 0);

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

  addPoint(vector: DataVector) {
    this.seriesX.push(vector.x);
    this.seriesY.push(vector.y);
    this.seriesZ.push(vector.z);

    if (this.seriesX.length > this.historyLength) this.seriesX.shift();
    if (this.seriesY.length > this.historyLength) this.seriesY.shift();
    if (this.seriesZ.length > this.historyLength) this.seriesZ.shift();

    this.draw();
  }

  clear() {
    this.seriesX = [];
    this.seriesY = [];
    this.seriesZ = [];
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

    // Title (top-center)
    if (this.title) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(this.title, Math.floor(width / 2), 4);
    }

    // Determine display range (fixed or autoscaled)
    const seriesData = [this.seriesX, this.seriesY, this.seriesZ];
    const visibleCount = Math.max(1, Math.min(this.seriesLabels.length, 3));
    let displayMin = this.minValue;
    let displayMax = this.maxValue;
    if (this.autoscale) {
      let dataMin = Number.POSITIVE_INFINITY;
      let dataMax = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < visibleCount; i++) {
        const arr = seriesData[i];
        for (let j = 0; j < arr.length; j++) {
          const v = arr[j];
          if (v < dataMin) dataMin = v;
          if (v > dataMax) dataMax = v;
        }
      }
      if (dataMin === Number.POSITIVE_INFINITY || dataMax === Number.NEGATIVE_INFINITY) {
        // no data yet; keep configured range
      } else {
        if (dataMax - dataMin < 1e-6) {
          // Avoid zero span; use a small default span around value
          const center = (dataMax + dataMin) / 2;
          dataMin = center - 0.5;
          dataMax = center + 0.5;
        }
        const pad = (dataMax - dataMin) * this.autoscalePadding;
        displayMin = dataMin - pad;
        displayMax = dataMax + pad;
        // Enforce minimum span around current center if requested
        if (this.minSpan > 0 && (displayMax - displayMin) < this.minSpan) {
          const center = (displayMax + displayMin) / 2;
          const half = this.minSpan / 2;
          displayMin = center - half;
          displayMax = center + half;
        }
      }
    }

    // Grid lines
    const valueToY = (v: number) => {
      const t = (v - displayMin) / (displayMax - displayMin);
      return Math.max(
        padTop,
        Math.min(height - padBottom, height - padBottom - t * (height - padTop - padBottom))
      );
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([4, 4]);
    const gridValues: number[] = [displayMin, displayMax];
    if (0 >= displayMin && 0 <= displayMax) gridValues.push(0);
    // Optionally draw mid line
    const mid = (displayMin + displayMax) / 2;
    gridValues.push(mid);
    // De-duplicate and sort
    const seen = new Set<number>();
    gridValues
      .filter((v) => {
        const key = Math.round(v * 1e6) / 1e6;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a - b)
      .forEach((v) => {
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
    ctx.fillText(`${displayMax.toFixed(1)}${this.unitLabel}`, padLeft, 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${displayMin.toFixed(1)}${this.unitLabel}`, padLeft, height - 2);

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

    // Draw visible series
    for (let i = 0; i < visibleCount; i++) {
      drawSeries(seriesData[i], this.seriesColors[i]);
    }

    // Legend (aligned to the right)
    const legendY = height - 6;
    const legendItems = this.seriesLabels.slice(0, 3).map((label, idx) => ({ label, color: this.seriesColors[idx] }));
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    // Compute total legend width (box 10 + gap 4 + text + gap 10 for each item)
    let legendTotalWidth = 0;
    for (const item of legendItems) {
      const textWidth = ctx.measureText(item.label).width;
      legendTotalWidth += 10 + 4 + textWidth + 10;
    }
    // Starting from the right, but not beyond left padding
    let xOff = Math.max(padLeft, (width - padRight) - legendTotalWidth);
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


