// Fetch mediapipe runtime + models into ps-offsite-2026/public/mediapipe.
// These are large binaries (~60MB) kept out of git (see .gitignore). Run on
// install/build/dev so local + Netlify always have them. Idempotent: skips
// non-empty files already in place, so re-runs are cheap. Downloads land via a
// temp file + atomic rename, so an interrupted run never leaves a truncated
// model that a later run would treat as complete.
import { cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const PUBLIC = resolve(ROOT, 'ps-offsite-2026/public/mediapipe');
const WASM_SRC = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DST = resolve(PUBLIC, 'wasm');
const MODELS_DST = resolve(PUBLIC, 'models');

// Models pinned to the same float16/1 revisions the games used from the CDN.
const BASE = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = {
  'gesture_recognizer.task': `${BASE}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  'hand_landmarker.task': `${BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
  'pose_landmarker_lite.task': `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'pose_landmarker_heavy.task': `${BASE}/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
};

const statOf = async (p) => stat(p).catch(() => null);
const exists = async (p) => !!(await statOf(p));

async function copyWasm() {
  if (await exists(resolve(WASM_DST, 'vision_wasm_internal.wasm'))) {
    console.log('wasm: already present, skip');
    return;
  }
  if (!(await exists(WASM_SRC))) {
    throw new Error(`wasm source missing at ${WASM_SRC} — run npm install first`);
  }
  await mkdir(WASM_DST, { recursive: true });
  await cp(WASM_SRC, WASM_DST, { recursive: true });
  console.log('wasm: copied from node_modules');
}

async function fetchModels() {
  await mkdir(MODELS_DST, { recursive: true });
  for (const [name, url] of Object.entries(MODELS)) {
    const dst = resolve(MODELS_DST, name);
    // A non-empty file at the final path means a previous run finished this
    // download (we only rename into place after a complete write), so skip.
    const st = await statOf(dst);
    if (st && st.size > 0) {
      console.log(`model ${name}: already present, skip`);
      continue;
    }
    process.stdout.write(`model ${name}: downloading… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed ${url}: ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error(`empty download for ${url}`);
    // Download to a temp path, then atomically rename on success. An interrupted
    // run leaves only the .tmp (cleaned up below / next run), never a truncated
    // file at the real path that future runs would mistake for complete.
    const tmp = `${dst}.tmp`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, dst);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    console.log('done');
  }
}

await copyWasm();
await fetchModels();
console.log('vision assets ready at', PUBLIC);
