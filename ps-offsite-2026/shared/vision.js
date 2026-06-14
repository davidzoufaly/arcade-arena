// Vendored locally — the runtime bundle is npm-installed (Vite chunks it via
// the dynamic import below, so it only loads when a game actually starts), and
// the wasm + .task models live under public/mediapipe (fetched by
// scripts/fetch-vision-assets.mjs). No CDN at runtime.
// BASE_URL keeps these working under a sub-path deploy (e.g. GitHub Pages
// /arcade-arena/); it's '/' in dev, so paths stay '/mediapipe/...' locally.
const BASE = import.meta.env.BASE_URL;
const WASM_URL = `${BASE}mediapipe/wasm`;
export const MODEL_URL = {
  hand: `${BASE}mediapipe/models/hand_landmarker.task`,
};

let visionPromise;
export async function loadVision() {
  if (!visionPromise) {
    // Cache only on success: clear the cached promise on failure so a transient
    // wasm/model load error isn't pinned forever and the next call can retry.
    visionPromise = (async () => {
      const mod = await import('@mediapipe/tasks-vision');
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      return { mod, fileset };
    })().catch(e => { visionPromise = undefined; throw e; });
  }
  return visionPromise;
}

export async function createCamStream({ width = 640, height = 480 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width, height, facingMode: 'user' }
  });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
    await video.play();
    return { video, stream };
  } catch (e) {
    // getUserMedia already turned the camera on; if play()/loadedmetadata
    // rejects, stop the tracks so we don't leak a live MediaStream (the
    // camera light staying on with no consumer).
    stream.getTracks().forEach(t => t.stop());
    throw e;
  }
}

export async function createHandTracker(video, { numHands = 4, minRunMs = 0 } = {}) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL.hand,
      delegate: 'GPU'
    },
    numHands,
    runningMode: 'VIDEO'
  });

  let latest = { hands: [] };
  let raf;
  let lastTs = 0;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2 && ts - lastTs >= minRunMs) {
      lastTs = ts;
      // A transient detectForVideo throw (e.g. mid-frame GPU hiccup) must not
      // permanently kill the loop — log and keep the last good result, retry
      // next frame.
      try {
        const result = tracker.detectForVideo(video, ts);
        latest = { hands: result.landmarks ?? [] };
      } catch (e) {
        console.warn('hand detectForVideo failed (continuing)', e);
      }
    }
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    latest() { return latest; },
    stop() { cancelAnimationFrame(raf); tracker.close(); }
  };
}

// Helpers used by dino for gesture interpretation
export function isPalmOpen(hand) {
  if (!hand) return false;
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  return tips.every((t, i) => hand[t].y < hand[pips[i]].y);
}

export function isFist(hand) {
  if (!hand) return false;
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  return tips.every((t, i) => hand[t].y > hand[pips[i]].y);
}

// The resting "ready" pose: a victory / V sign ✌️ — index + middle extended,
// ring + pinky curled. Same crisp tip-vs-knuckle y-test as palm/fist, so it
// reads reliably (unlike a foreshortened hand pointed at the lens). Mutually
// exclusive with palm (ring/pinky must be down) and fist (index/middle must be
// up). Disarms the jump (not an open palm) without ducking (not a fist).
export function isVictorySign(hand) {
  if (!hand) return false;
  const up = [[8, 6], [12, 10]];     // index, middle: tip above pip
  const down = [[16, 14], [20, 18]]; // ring, pinky: tip below pip
  return up.every(([t, p]) => hand[t].y < hand[p].y)
      && down.every(([t, p]) => hand[t].y > hand[p].y);
}
