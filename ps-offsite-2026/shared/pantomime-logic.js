export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

export const SKEL_LINES = [
  ['nose', 'lSh'], ['nose', 'rSh'],
  ['lSh', 'rSh'],
  ['lSh', 'lEl'], ['lEl', 'lWr'],
  ['rSh', 'rEl'], ['rEl', 'rWr'],
  ['lSh', 'lHip'], ['rSh', 'rHip'],
  ['lHip', 'rHip'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'],
  ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
];

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

export function smoothScore(value, target, tol) {
  const d = Math.abs(value - target);
  if (d <= tol) return 1;
  if (d >= 2 * tol) return 0;
  return 1 - (d - tol) / tol;
}

// Ref builders (one per pose)
function tposeRef() {
  return {
    nose: { x: 0.50, y: 0.10 },
    lSh:  { x: 0.40, y: 0.25 }, rSh: { x: 0.60, y: 0.25 },
    lEl:  { x: 0.25, y: 0.25 }, rEl: { x: 0.75, y: 0.25 },
    lWr:  { x: 0.10, y: 0.25 }, rWr: { x: 0.90, y: 0.25 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.45, y: 0.75 }, rKnee:{ x: 0.55, y: 0.75 },
    lAnkle:{x: 0.45, y: 0.95 }, rAnkle:{x: 0.55, y: 0.95 },
  };
}
function starRef() {
  return {
    nose: { x: 0.50, y: 0.10 },
    lSh:  { x: 0.42, y: 0.22 }, rSh: { x: 0.58, y: 0.22 },
    lEl:  { x: 0.30, y: 0.10 }, rEl: { x: 0.70, y: 0.10 },
    lWr:  { x: 0.18, y: 0.02 }, rWr: { x: 0.82, y: 0.02 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.35, y: 0.75 }, rKnee:{ x: 0.65, y: 0.75 },
    lAnkle:{x: 0.20, y: 0.95 }, rAnkle:{x: 0.80, y: 0.95 },
  };
}
function conductorRef() {
  return {
    nose: { x: 0.50, y: 0.12 },
    lSh:  { x: 0.42, y: 0.25 }, rSh: { x: 0.58, y: 0.25 },
    lEl:  { x: 0.40, y: 0.42 }, rEl: { x: 0.62, y: 0.10 },
    lWr:  { x: 0.42, y: 0.55 }, rWr: { x: 0.66, y: 0.00 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.45, y: 0.75 }, rKnee:{ x: 0.55, y: 0.75 },
    lAnkle:{x: 0.45, y: 0.95 }, rAnkle:{x: 0.55, y: 0.95 },
  };
}
function superheroRef() {
  return {
    nose: { x: 0.50, y: 0.10 },
    lSh:  { x: 0.38, y: 0.25 }, rSh: { x: 0.62, y: 0.25 },
    lEl:  { x: 0.28, y: 0.40 }, rEl: { x: 0.72, y: 0.40 },
    lWr:  { x: 0.43, y: 0.55 }, rWr: { x: 0.57, y: 0.55 },
    lHip: { x: 0.43, y: 0.55 }, rHip: { x: 0.57, y: 0.55 },
    lKnee:{ x: 0.42, y: 0.75 }, rKnee:{ x: 0.58, y: 0.75 },
    lAnkle:{x: 0.42, y: 0.95 }, rAnkle:{x: 0.58, y: 0.95 },
  };
}
function skierRef() {
  return {
    nose: { x: 0.50, y: 0.22 },
    lSh:  { x: 0.42, y: 0.32 }, rSh: { x: 0.58, y: 0.32 },
    lEl:  { x: 0.40, y: 0.45 }, rEl: { x: 0.60, y: 0.45 },
    lWr:  { x: 0.43, y: 0.55 }, rWr: { x: 0.57, y: 0.55 },
    lHip: { x: 0.45, y: 0.58 }, rHip: { x: 0.55, y: 0.58 },
    lKnee:{ x: 0.40, y: 0.72 }, rKnee:{ x: 0.60, y: 0.72 },
    lAnkle:{x: 0.42, y: 0.95 }, rAnkle:{x: 0.58, y: 0.95 },
  };
}
function discoRef() {
  return {
    nose: { x: 0.50, y: 0.12 },
    lSh:  { x: 0.40, y: 0.25 }, rSh: { x: 0.60, y: 0.25 },
    lEl:  { x: 0.38, y: 0.42 }, rEl: { x: 0.72, y: 0.12 },
    lWr:  { x: 0.42, y: 0.55 }, rWr: { x: 0.85, y: 0.00 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.45, y: 0.75 }, rKnee:{ x: 0.55, y: 0.75 },
    lAnkle:{x: 0.45, y: 0.95 }, rAnkle:{x: 0.55, y: 0.95 },
  };
}
function warriorRef() {
  return {
    nose: { x: 0.55, y: 0.12 },
    lSh:  { x: 0.47, y: 0.25 }, rSh: { x: 0.63, y: 0.25 },
    lEl:  { x: 0.46, y: 0.10 }, rEl: { x: 0.64, y: 0.10 },
    lWr:  { x: 0.46, y: 0.02 }, rWr: { x: 0.64, y: 0.02 },
    lHip: { x: 0.50, y: 0.50 }, rHip: { x: 0.60, y: 0.50 },
    lKnee:{ x: 0.30, y: 0.70 }, rKnee:{ x: 0.72, y: 0.65 },
    lAnkle:{x: 0.18, y: 0.95 }, rAnkle:{x: 0.80, y: 0.95 },
  };
}
function treeRef() {
  return {
    nose: { x: 0.50, y: 0.08 },
    lSh:  { x: 0.44, y: 0.20 }, rSh: { x: 0.56, y: 0.20 },
    lEl:  { x: 0.46, y: 0.05 }, rEl: { x: 0.54, y: 0.05 },
    lWr:  { x: 0.50, y: 0.02 }, rWr: { x: 0.50, y: 0.02 },
    lHip: { x: 0.46, y: 0.50 }, rHip: { x: 0.54, y: 0.50 },
    lKnee:{ x: 0.46, y: 0.72 }, rKnee:{ x: 0.30, y: 0.55 },
    lAnkle:{x: 0.46, y: 0.95 }, rAnkle:{x: 0.50, y: 0.55 },
  };
}
function wideSquatRef() {
  return {
    nose: { x: 0.50, y: 0.20 },
    lSh:  { x: 0.42, y: 0.32 }, rSh: { x: 0.58, y: 0.32 },
    lEl:  { x: 0.30, y: 0.40 }, rEl: { x: 0.70, y: 0.40 },
    lWr:  { x: 0.20, y: 0.42 }, rWr: { x: 0.80, y: 0.42 },
    lHip: { x: 0.42, y: 0.62 }, rHip: { x: 0.58, y: 0.62 },
    lKnee:{ x: 0.20, y: 0.72 }, rKnee:{ x: 0.80, y: 0.72 },
    lAnkle:{x: 0.18, y: 0.95 }, rAnkle:{x: 0.82, y: 0.95 },
  };
}
function libertyRef() {
  return {
    nose: { x: 0.50, y: 0.10 },
    lSh:  { x: 0.42, y: 0.25 }, rSh: { x: 0.58, y: 0.25 },
    lEl:  { x: 0.30, y: 0.30 }, rEl: { x: 0.62, y: 0.10 },
    lWr:  { x: 0.45, y: 0.32 }, rWr: { x: 0.66, y: -0.05 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.45, y: 0.75 }, rKnee:{ x: 0.55, y: 0.75 },
    lAnkle:{x: 0.45, y: 0.95 }, rAnkle:{x: 0.55, y: 0.95 },
  };
}
function karateRef() {
  return {
    nose: { x: 0.50, y: 0.10 },
    lSh:  { x: 0.42, y: 0.25 }, rSh: { x: 0.58, y: 0.25 },
    lEl:  { x: 0.36, y: 0.40 }, rEl: { x: 0.64, y: 0.40 },
    lWr:  { x: 0.34, y: 0.55 }, rWr: { x: 0.66, y: 0.55 },
    lHip: { x: 0.45, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.45, y: 0.75 }, rKnee:{ x: 0.75, y: 0.40 },
    lAnkle:{x: 0.45, y: 0.95 }, rAnkle:{x: 0.90, y: 0.30 },
  };
}
function arabesqueRef() {
  return {
    nose: { x: 0.45, y: 0.18 },
    lSh:  { x: 0.40, y: 0.30 }, rSh: { x: 0.52, y: 0.30 },
    lEl:  { x: 0.25, y: 0.30 }, rEl: { x: 0.65, y: 0.30 },
    lWr:  { x: 0.10, y: 0.30 }, rWr: { x: 0.80, y: 0.30 },
    lHip: { x: 0.50, y: 0.55 }, rHip: { x: 0.55, y: 0.55 },
    lKnee:{ x: 0.50, y: 0.75 }, rKnee:{ x: 0.85, y: 0.55 },
    lAnkle:{x: 0.50, y: 0.95 }, rAnkle:{x: 0.97, y: 0.40 },
  };
}

export const POSE_POOL = [
  {
    id: 'tpose',
    name: 'T-Pose',
    emoji: '✝️',
    difficulty: 'easy',
    timeout: 25,
    desc: 'Both arms straight out to the sides, body upright.',
    ref: tposeRef(),
    checks: [
      { name: 'Left arm horizontal', fn: lm => smoothScore(Math.abs(lm[LM.L_SHOULDER].y - lm[LM.L_WRIST].y), 0, 0.06) },
      { name: 'Right arm horizontal', fn: lm => smoothScore(Math.abs(lm[LM.R_SHOULDER].y - lm[LM.R_WRIST].y), 0, 0.06) },
      { name: 'Left arm extended', fn: lm => smoothScore(angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST]), 175, 25) },
      { name: 'Right arm extended', fn: lm => smoothScore(angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]), 175, 25) },
      { name: 'Body upright', fn: lm => smoothScore(((lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2) - ((lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2), 0.25, 0.15) },
    ],
  },
  {
    id: 'star',
    name: 'Star Jump',
    emoji: '⭐',
    difficulty: 'easy',
    timeout: 25,
    desc: 'Arms diagonally up, legs spread wide. Make a big X with your body.',
    ref: starRef(),
    checks: [
      { name: 'Left arm up & out', fn: lm => {
        const sh = lm[LM.L_SHOULDER], wr = lm[LM.L_WRIST];
        const upDir = (sh.y - wr.y) > 0.15 ? 1 : 0;
        const outDir = (sh.x - wr.x) > 0.10 ? 1 : 0;
        return (upDir + outDir) / 2;
      }},
      { name: 'Right arm up & out', fn: lm => {
        const sh = lm[LM.R_SHOULDER], wr = lm[LM.R_WRIST];
        const upDir = (sh.y - wr.y) > 0.15 ? 1 : 0;
        const outDir = (wr.x - sh.x) > 0.10 ? 1 : 0;
        return (upDir + outDir) / 2;
      }},
      { name: 'Legs spread wide', fn: lm => {
        const ankleSpread = Math.abs(lm[LM.L_ANKLE].x - lm[LM.R_ANKLE].x);
        const hipSpread = Math.abs(lm[LM.L_HIP].x - lm[LM.R_HIP].x);
        return smoothScore(ankleSpread / Math.max(0.05, hipSpread), 2.0, 0.8);
      }},
      { name: 'Arms straight', fn: lm => {
        const lAng = angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST]);
        const rAng = angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]);
        return (smoothScore(lAng, 170, 25) + smoothScore(rAng, 170, 25)) / 2;
      }},
    ],
  },
  {
    id: 'conductor',
    name: 'Conductor',
    emoji: '🎼',
    difficulty: 'medium',
    timeout: 35,
    desc: 'One hand high above the head, the other arm relaxed by your side.',
    ref: conductorRef(),
    checks: [
      { name: 'One hand above head', fn: lm => {
        const headY = lm[LM.NOSE].y;
        const upWrist = Math.min(lm[LM.L_WRIST].y, lm[LM.R_WRIST].y);
        return smoothScore(headY - upWrist, 0.18, 0.12);
      }},
      { name: 'Other hand near hip', fn: lm => {
        const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        const downWrist = Math.max(lm[LM.L_WRIST].y, lm[LM.R_WRIST].y);
        return smoothScore(downWrist - hipY, 0, 0.15);
      }},
      { name: 'Raised arm extended', fn: lm => {
        const lUp = lm[LM.L_WRIST].y < lm[LM.R_WRIST].y;
        const a = lUp
          ? angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST])
          : angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]);
        return smoothScore(a, 165, 30);
      }},
      { name: 'Body upright', fn: lm => smoothScore(((lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2) - ((lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2), 0.25, 0.15) },
    ],
  },
  {
    id: 'superhero',
    name: 'Superhero',
    emoji: '🦸',
    difficulty: 'medium',
    timeout: 35,
    desc: 'Hands on hips, elbows pointing out wide, chest forward. Strike a pose.',
    ref: superheroRef(),
    checks: [
      { name: 'Right wrist near right hip', fn: lm => smoothScore(dist(lm[LM.R_WRIST], lm[LM.R_HIP]), 0, 0.13) },
      { name: 'Left wrist near left hip', fn: lm => smoothScore(dist(lm[LM.L_WRIST], lm[LM.L_HIP]), 0, 0.13) },
      { name: 'Left elbow out', fn: lm => {
        const center = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const dEl = Math.abs(lm[LM.L_ELBOW].x - center);
        const dSh = Math.abs(lm[LM.L_SHOULDER].x - center);
        return smoothScore(dEl - dSh, 0.05, 0.05);
      }},
      { name: 'Right elbow out', fn: lm => {
        const center = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const dEl = Math.abs(lm[LM.R_ELBOW].x - center);
        const dSh = Math.abs(lm[LM.R_SHOULDER].x - center);
        return smoothScore(dEl - dSh, 0.05, 0.05);
      }},
      { name: 'Body upright', fn: lm => smoothScore(((lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2) - ((lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2), 0.25, 0.12) },
    ],
  },
  {
    id: 'skier',
    name: 'Downhill Skier',
    emoji: '⛷️',
    difficulty: 'medium',
    timeout: 35,
    desc: 'Squat down, knees bent, both fists forward as if holding ski poles.',
    ref: skierRef(),
    checks: [
      { name: 'Knees bent', fn: lm => {
        const lAng = angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]);
        const rAng = angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE]);
        const a = (lAng + rAng) / 2;
        return smoothScore(a, 120, 25);
      }},
      { name: 'Both hands forward', fn: lm => {
        const lWr = lm[LM.L_WRIST], rWr = lm[LM.R_WRIST];
        const lSh = lm[LM.L_SHOULDER], rSh = lm[LM.R_SHOULDER];
        const lHip = lm[LM.L_HIP], rHip = lm[LM.R_HIP];
        const lOk = (lWr.y > lSh.y - 0.05) && (lWr.y < lHip.y + 0.05) ? 1 : 0;
        const rOk = (rWr.y > rSh.y - 0.05) && (rWr.y < rHip.y + 0.05) ? 1 : 0;
        return (lOk + rOk) / 2;
      }},
      { name: 'Hands close together', fn: lm => smoothScore(dist(lm[LM.L_WRIST], lm[LM.R_WRIST]), 0.25, 0.18) },
      { name: 'Forward lean', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const hip = (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
        return smoothScore(Math.abs(sh - hip), 0, 0.10);
      }},
    ],
  },
  {
    id: 'disco',
    name: 'Disco King',
    emoji: '🕺',
    difficulty: 'hard',
    timeout: 45,
    desc: 'Saturday Night Fever — one arm high diagonally up, other arm low at your side.',
    ref: discoRef(),
    checks: [
      { name: 'One arm pointing high (~45°)', fn: lm => {
        const lh = lm[LM.L_WRIST].y, rh = lm[LM.R_WRIST].y;
        const upWr = lh < rh ? lm[LM.L_WRIST] : lm[LM.R_WRIST];
        const upSh = lh < rh ? lm[LM.L_SHOULDER] : lm[LM.R_SHOULDER];
        const dy = upSh.y - upWr.y;
        const dx = Math.abs(upWr.x - upSh.x);
        if (dy < 0.10) return 0;
        const ratio = dx / Math.max(0.01, dy);
        return smoothScore(ratio, 1.0, 0.5);
      }},
      { name: 'Other arm low and crossed', fn: lm => {
        const lh = lm[LM.L_WRIST].y, rh = lm[LM.R_WRIST].y;
        const downWr = lh > rh ? lm[LM.L_WRIST] : lm[LM.R_WRIST];
        const downSh = lh > rh ? lm[LM.L_SHOULDER] : lm[LM.R_SHOULDER];
        const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        const ok = downWr.y > hipY - 0.05 ? 1 : 0;
        const ok2 = (downWr.y - downSh.y) > 0.15 ? 1 : 0;
        return (ok + ok2) / 2;
      }},
      { name: 'Raised arm fully extended', fn: lm => {
        const lh = lm[LM.L_WRIST].y, rh = lm[LM.R_WRIST].y;
        const a = lh < rh
          ? angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST])
          : angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]);
        return smoothScore(a, 170, 25);
      }},
      { name: 'Hip slightly tilted', fn: lm => {
        const dHip = Math.abs(lm[LM.L_HIP].y - lm[LM.R_HIP].y);
        return smoothScore(dHip, 0.04, 0.06);
      }},
    ],
  },
  {
    id: 'warrior',
    name: 'Warrior I',
    emoji: '🧘',
    difficulty: 'hard',
    timeout: 45,
    desc: 'Yoga lunge — one leg forward bent at knee, back leg straight, both arms straight up overhead.',
    ref: warriorRef(),
    checks: [
      { name: 'Both arms straight up', fn: lm => {
        const headY = lm[LM.NOSE].y;
        const lOk = lm[LM.L_WRIST].y < headY - 0.10 ? 1 : 0;
        const rOk = lm[LM.R_WRIST].y < headY - 0.10 ? 1 : 0;
        return (lOk + rOk) / 2;
      }},
      { name: 'Arms extended', fn: lm => {
        const lA = angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST]);
        const rA = angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]);
        return (smoothScore(lA, 165, 30) + smoothScore(rA, 165, 30)) / 2;
      }},
      { name: 'Front knee bent (lunge)', fn: lm => {
        const lA = angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]);
        const rA = angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE]);
        const minA = Math.min(lA, rA);
        return smoothScore(minA, 110, 30);
      }},
      { name: 'Other leg straight', fn: lm => {
        const lA = angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]);
        const rA = angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE]);
        const maxA = Math.max(lA, rA);
        return smoothScore(maxA, 170, 25);
      }},
      { name: 'Legs spread (lunge stance)', fn: lm => {
        const ankleSpread = Math.abs(lm[LM.L_ANKLE].x - lm[LM.R_ANKLE].x);
        return smoothScore(ankleSpread, 0.30, 0.20);
      }},
    ],
  },
  {
    id: 'tree',
    name: 'Tree Pose',
    emoji: '🌳',
    difficulty: 'hard',
    timeout: 45,
    desc: 'Yoga balance — stand on one leg, the other foot pressed against the standing leg. Hands together above head OR at chest.',
    ref: treeRef(),
    checks: [
      { name: 'One foot lifted off ground', fn: lm => {
        const lA = lm[LM.L_ANKLE].y, rA = lm[LM.R_ANKLE].y;
        const diff = Math.abs(lA - rA);
        return smoothScore(diff, 0.20, 0.15);
      }},
      { name: 'Lifted ankle near body centerline', fn: lm => {
        const lA = lm[LM.L_ANKLE].y, rA = lm[LM.R_ANKLE].y;
        const liftedAnkle = lA < rA ? lm[LM.L_ANKLE] : lm[LM.R_ANKLE];
        const hipCenter = (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
        return smoothScore(Math.abs(liftedAnkle.x - hipCenter), 0, 0.12);
      }},
      { name: 'Hands above head OR together at chest', fn: lm => {
        const wristDist = dist(lm[LM.L_WRIST], lm[LM.R_WRIST]);
        const wristsTogether = smoothScore(wristDist, 0, 0.10);
        const headY = lm[LM.NOSE].y;
        const wristsHigh = ((headY - lm[LM.L_WRIST].y > 0.12) && (headY - lm[LM.R_WRIST].y > 0.12)) ? 1 : 0;
        return Math.max(wristsTogether, wristsHigh);
      }},
      { name: 'Body upright, balanced', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const hip = (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
        return smoothScore(Math.abs(sh - hip), 0, 0.08);
      }},
    ],
  },
  {
    id: 'wide-squat',
    name: 'Wide Squat',
    emoji: '🦴',
    difficulty: 'medium',
    timeout: 35,
    desc: 'Deep squat — feet very wide apart, knees bent close to 90°, both arms extended out to the sides.',
    ref: wideSquatRef(),
    checks: [
      { name: 'Knees bent ~90°', fn: lm => {
        const lAng = angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]);
        const rAng = angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE]);
        const a = (lAng + rAng) / 2;
        return smoothScore(a, 100, 20);
      }},
      { name: 'Feet very wide apart', fn: lm => {
        const ankleSpread = Math.abs(lm[LM.L_ANKLE].x - lm[LM.R_ANKLE].x);
        const shoulderSpread = Math.abs(lm[LM.L_SHOULDER].x - lm[LM.R_SHOULDER].x);
        return smoothScore(ankleSpread / Math.max(0.05, shoulderSpread), 3.0, 0.8);
      }},
      { name: 'Hips below shoulders by a lot', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2;
        const hip = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        return smoothScore(hip - sh, 0.30, 0.10);
      }},
      { name: 'Both arms extended sideways', fn: lm => {
        const lDx = Math.abs(lm[LM.L_WRIST].x - lm[LM.L_SHOULDER].x);
        const rDx = Math.abs(lm[LM.R_WRIST].x - lm[LM.R_SHOULDER].x);
        const lOk = smoothScore(lDx, 0.20, 0.10);
        const rOk = smoothScore(rDx, 0.20, 0.10);
        return (lOk + rOk) / 2;
      }},
      { name: 'Arms roughly horizontal', fn: lm => {
        const lDy = Math.abs(lm[LM.L_WRIST].y - lm[LM.L_SHOULDER].y);
        const rDy = Math.abs(lm[LM.R_WRIST].y - lm[LM.R_SHOULDER].y);
        return (smoothScore(lDy, 0, 0.10) + smoothScore(rDy, 0, 0.10)) / 2;
      }},
    ],
  },
  {
    id: 'liberty',
    name: 'Statue of Liberty',
    emoji: '🗽',
    difficulty: 'hard',
    timeout: 45,
    desc: 'One arm straight up high (the torch). Other arm bent at the elbow, forearm horizontal across the chest (the tablet). Stand tall.',
    ref: libertyRef(),
    checks: [
      { name: 'One wrist high above head', fn: lm => {
        const headY = lm[LM.NOSE].y;
        const upWrist = Math.min(lm[LM.L_WRIST].y, lm[LM.R_WRIST].y);
        return smoothScore(headY - upWrist, 0.22, 0.08);
      }},
      { name: 'Raised arm straight & vertical', fn: lm => {
        const lUp = lm[LM.L_WRIST].y < lm[LM.R_WRIST].y;
        const sh = lUp ? lm[LM.L_SHOULDER] : lm[LM.R_SHOULDER];
        const wr = lUp ? lm[LM.L_WRIST] : lm[LM.R_WRIST];
        const a = lUp
          ? angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST])
          : angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST]);
        const straight = smoothScore(a, 175, 15);
        const verticalDx = Math.abs(wr.x - sh.x);
        const vertical = smoothScore(verticalDx, 0, 0.06);
        return (straight + vertical) / 2;
      }},
      { name: 'Other forearm horizontal across chest', fn: lm => {
        const lUp = lm[LM.L_WRIST].y < lm[LM.R_WRIST].y;
        const el = lUp ? lm[LM.R_ELBOW] : lm[LM.L_ELBOW];
        const wr = lUp ? lm[LM.R_WRIST] : lm[LM.L_WRIST];
        const sh = lUp ? lm[LM.R_SHOULDER] : lm[LM.L_SHOULDER];
        const a = lUp
          ? angle(lm[LM.R_SHOULDER], lm[LM.R_ELBOW], lm[LM.R_WRIST])
          : angle(lm[LM.L_SHOULDER], lm[LM.L_ELBOW], lm[LM.L_WRIST]);
        // Want a sharp bend (~90°)
        const bent = smoothScore(a, 90, 25);
        // Forearm horizontal: elbow.y close to wrist.y
        const horiz = smoothScore(Math.abs(el.y - wr.y), 0, 0.06);
        // Wrist crossed near body center
        const center = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const crossed = smoothScore(Math.abs(wr.x - center), 0, 0.10);
        return (bent + horiz + crossed) / 3;
      }},
      { name: 'Body upright', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const hip = (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
        return smoothScore(Math.abs(sh - hip), 0, 0.05);
      }},
    ],
  },
  {
    id: 'karate',
    name: 'Karate Kick',
    emoji: '🥋',
    difficulty: 'hard',
    timeout: 45,
    desc: 'Stand on one leg. Kick the other leg out high and to the side — knee at hip level or higher. Keep balance.',
    ref: karateRef(),
    checks: [
      { name: 'One leg lifted high', fn: lm => {
        const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        const upKnee = Math.min(lm[LM.L_KNEE].y, lm[LM.R_KNEE].y);
        return smoothScore(hipY - upKnee, 0.05, 0.08);
      }},
      { name: 'Lifted leg extended sideways', fn: lm => {
        const lUp = lm[LM.L_KNEE].y < lm[LM.R_KNEE].y;
        const ankle = lUp ? lm[LM.L_ANKLE] : lm[LM.R_ANKLE];
        const hip = lUp ? lm[LM.L_HIP] : lm[LM.R_HIP];
        const dx = Math.abs(ankle.x - hip.x);
        return smoothScore(dx, 0.25, 0.15);
      }},
      { name: 'Standing leg straight', fn: lm => {
        const lUp = lm[LM.L_KNEE].y < lm[LM.R_KNEE].y;
        const a = lUp
          ? angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE])
          : angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE]);
        return smoothScore(a, 175, 15);
      }},
      { name: 'Lifted ankle near or above hip level', fn: lm => {
        const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        const upAnkle = Math.min(lm[LM.L_ANKLE].y, lm[LM.R_ANKLE].y);
        return smoothScore(hipY - upAnkle, 0.10, 0.15);
      }},
      { name: 'Body upright (not toppling)', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2;
        const hip = (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
        return smoothScore(Math.abs(sh - hip), 0, 0.10);
      }},
    ],
  },
  {
    id: 'arabesque',
    name: 'Arabesque',
    emoji: '🩰',
    difficulty: 'hard',
    timeout: 45,
    desc: 'Ballet pose — stand on one leg, lift the other leg straight back, body leaned forward, arms extended sideways like wings.',
    ref: arabesqueRef(),
    checks: [
      { name: 'One leg lifted (foot off ground)', fn: lm => {
        const diff = Math.abs(lm[LM.L_ANKLE].y - lm[LM.R_ANKLE].y);
        return smoothScore(diff, 0.30, 0.15);
      }},
      { name: 'Lifted leg straight (not bent)', fn: lm => {
        const lUp = lm[LM.L_ANKLE].y < lm[LM.R_ANKLE].y;
        const a = lUp
          ? angle(lm[LM.L_HIP], lm[LM.L_KNEE], lm[LM.L_ANKLE])
          : angle(lm[LM.R_HIP], lm[LM.R_KNEE], lm[LM.R_ANKLE]);
        return smoothScore(a, 170, 20);
      }},
      { name: 'Both arms extended sideways', fn: lm => {
        const lDx = Math.abs(lm[LM.L_WRIST].x - lm[LM.L_SHOULDER].x);
        const rDx = Math.abs(lm[LM.R_WRIST].x - lm[LM.R_SHOULDER].x);
        return (smoothScore(lDx, 0.22, 0.10) + smoothScore(rDx, 0.22, 0.10)) / 2;
      }},
      { name: 'Arms roughly horizontal', fn: lm => {
        const lDy = Math.abs(lm[LM.L_WRIST].y - lm[LM.L_SHOULDER].y);
        const rDy = Math.abs(lm[LM.R_WRIST].y - lm[LM.R_SHOULDER].y);
        return (smoothScore(lDy, 0, 0.10) + smoothScore(rDy, 0, 0.10)) / 2;
      }},
      { name: 'Body leaned forward', fn: lm => {
        const sh = (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2;
        const hip = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2;
        // Less torso vertical separation = leaning
        return smoothScore(hip - sh, 0.18, 0.10);
      }},
    ],
  },
];
