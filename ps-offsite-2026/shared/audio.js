export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function smooth(alpha) {
  let val = null;
  return {
    next(x) {
      if (val === null) { val = x; return x; }
      val = alpha * x + (1 - alpha) * val;
      return val;
    },
    value() { return val ?? 0; },
    reset() { val = null; }
  };
}

export class SustainTracker {
  constructor({ threshold, windowMs }) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.startedAt = null;
    this.lastNow = 0;
  }
  feed(amp, nowMs) {
    this.lastNow = nowMs;
    if (amp >= this.threshold) {
      if (this.startedAt === null) this.startedAt = nowMs;
    } else {
      this.startedAt = null;
    }
  }
  isSustained() {
    return this.startedAt !== null && this.lastNow - this.startedAt >= this.windowMs;
  }
  reset() { this.startedAt = null; }
}

export async function createAudioInput({ smoothing = 0.4, sustainThreshold = 0.12, sustainMs = 1000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  // Browsers create the AudioContext suspended until a user gesture; without
  // this the analyser only ever reads silence (zero amplitude). createAudioInput
  // is itself called from a click handler, so the resume is allowed.
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const sm = smooth(smoothing);
  const sus = new SustainTracker({ threshold: sustainThreshold, windowMs: sustainMs });

  function tick() {
    analyser.getFloatTimeDomainData(buf);
    const x = rms(buf);
    sm.next(x);
    sus.feed(sm.value(), performance.now());
  }

  let raf;
  function loop() { tick(); raf = requestAnimationFrame(loop); }
  loop();

  return {
    amplitude() { return sm.value(); },
    isSustained() { return sus.isSustained(); },
    setSustainThreshold(v) { sus.threshold = v; },
    // Exposed so callers can detect a mid-run mic disconnect via the track's
    // 'ended' event (mirrors how the camera games watch the video track).
    stream,
    track: stream.getAudioTracks()[0] ?? null,
    stop() { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ctx.close(); }
  };
}
