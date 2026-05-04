const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let visionPromise;
async function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const mod = await import(MP_URL);
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      return { mod, fileset };
    })();
  }
  return visionPromise;
}

export async function createCamStream() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  await video.play();
  return { video, stream };
}

export async function createHandTracker(video) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    numHands: 4,
    runningMode: 'VIDEO'
  });

  let latest = { hands: [] };
  let raf;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2) {
      const result = tracker.detectForVideo(video, ts);
      latest = { hands: result.landmarks ?? [] };
    }
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    latest() { return latest; },
    stop() { cancelAnimationFrame(raf); tracker.close(); }
  };
}

export async function createPoseTracker(video) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    numPoses: 1,
    runningMode: 'VIDEO'
  });

  let latest = { pose: null };
  let raf;
  let lastTs = 0;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2 && ts - lastTs > 33) {
      lastTs = ts;
      const result = tracker.detectForVideo(video, ts);
      latest = { pose: result.landmarks?.[0] ?? null };
    }
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    latest() { return latest; },
    stop() { cancelAnimationFrame(raf); tracker.close(); }
  };
}

// Helpers used by dino/main.js for gesture interpretation
export function isFingerUp(hand) {
  if (!hand || !hand[8] || !hand[6] || !hand[0]) return false;
  // tip clearly above PIP, OR whole hand raised high in frame
  return hand[8].y < hand[6].y - 0.02 || hand[0].y < 0.45;
}

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

export function isArmOverhead(hand) {
  if (!hand || !hand[0]) return false;
  return hand[0].y < 0.3; // wrist in upper third of frame
}

export function isJumpingPose(pose, baselineShoulderY) {
  if (!pose) return false;
  const shoulderY = (pose[11].y + pose[12].y) / 2;
  return shoulderY < baselineShoulderY - 0.08;
}

export function isCrouchingPose(pose, baselineHipY) {
  if (!pose) return false;
  const hipY = (pose[23].y + pose[24].y) / 2;
  return hipY > baselineHipY + 0.06;
}

export function countFingersUp(hand) {
  if (!hand) return 0;
  let n = 0;
  // four fingers: index, middle, ring, pinky — tip Y above PIP Y means raised
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  for (let i = 0; i < tips.length; i++) {
    if (hand[tips[i]] && hand[pips[i]] && hand[tips[i]].y < hand[pips[i]].y - 0.015) n++;
  }
  // thumb: extended when tip is significantly farther from wrist than the knuckle
  const t4 = hand[4], t2 = hand[2], t0 = hand[0];
  if (t4 && t2 && t0) {
    const dTip = Math.hypot(t4.x - t0.x, t4.y - t0.y);
    const dKnuckle = Math.hypot(t2.x - t0.x, t2.y - t0.y);
    if (dTip > dKnuckle * 1.2) n++;
  }
  return n;
}
