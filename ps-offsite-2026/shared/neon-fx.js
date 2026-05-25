export function withGlow(ctx, color, blur, fn) {
  // Fast halo: draw a translucent thick stroke pass behind the fill, then the fill on top.
  // `blur` is treated as halo radius for backwards compat.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, blur * 0.6);
  ctx.globalAlpha = 0.25;
  fn();
  ctx.lineWidth = Math.max(1, blur * 0.25);
  ctx.globalAlpha = 0.5;
  fn();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = color;
  fn();
  ctx.restore();
}

export function fadeOverlay(ctx, alpha = 0.15) {
  ctx.fillStyle = `rgba(10, 10, 26, ${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawGridFloor(ctx, scrollOffset, color = '#00ffff') {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const horizonY = h * 0.55;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.5;
  // horizontal lines (perspective)
  for (let i = 0; i < 12; i++) {
    const t = (i + (scrollOffset % 1)) / 12;
    const y = horizonY + t * t * (h - horizonY);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // vertical lines
  for (let i = -10; i <= 10; i++) {
    const x = w / 2 + i * (w * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, horizonY);
    ctx.lineTo(w / 2 + i * w * 0.6, h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export class ScreenShake {
  constructor() { this.frames = 0; this.intensity = 0; }
  trigger(frames = 5, intensity = 8) { this.frames = frames; this.intensity = intensity; }
  apply(ctx) {
    if (this.frames <= 0) return;
    const dx = (Math.random() - 0.5) * this.intensity;
    const dy = (Math.random() - 0.5) * this.intensity;
    ctx.translate(dx, dy);
    this.frames -= 1;
  }
}
