import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageWasm = join(projectRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const publicWasm = join(projectRoot, 'public', 'mediapipe', 'wasm');
const modelDirectory = join(projectRoot, 'public', 'models');
const modelPath = join(modelDirectory, 'pose_landmarker_lite.task');
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

if (!existsSync(packageWasm)) throw new Error('MediaPipe WASM package assets are missing: ' + packageWasm);
rmSync(publicWasm, { recursive: true, force: true });
mkdirSync(dirname(publicWasm), { recursive: true });
cpSync(packageWasm, publicWasm, { recursive: true });
mkdirSync(modelDirectory, { recursive: true });

if (!existsSync(modelPath) || statSync(modelPath).size < 1_000_000) {
  console.log('Downloading the pose model during build so browsers do not need a third-party model CDN.');
  const response = await fetch(modelUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error('Pose model download failed during build: HTTP ' + response.status);
  const model = Buffer.from(await response.arrayBuffer());
  if (model.byteLength < 1_000_000) throw new Error('Pose model download was unexpectedly small (' + model.byteLength + ' bytes).');
  writeFileSync(modelPath, model);
}
const modelBytes = statSync(modelPath).size;
if (modelBytes < 1_000_000) throw new Error('Local pose model is missing or invalid.');

const wasmFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else wasmFiles.push(full);
  }
}
walk(publicWasm);
if (!wasmFiles.some((file) => file.endsWith('.wasm')) || !wasmFiles.some((file) => file.endsWith('.js'))) {
  throw new Error('Copied MediaPipe WASM runtime is incomplete.');
}
console.log('Prepared ' + wasmFiles.length + ' MediaPipe runtime files and local pose model (' + modelBytes + ' bytes).');
