import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('camera gate offers an explicit continue-without-camera path', () => {
  assert.ok(html.includes('id="gate-skip"'));
  assert.ok(main.includes("$('gate-skip').addEventListener('click',()=>continueWithoutCamera());"));
  assert.ok(main.includes("function continueWithoutCamera()"));
  assert.ok(main.includes("$('camera-gate').classList.add('hidden')"));
});

test('solo keyboard and touch mode starts without requesting camera permission', () => {
  assert.ok(html.includes('id="play-keyboard"'));
  assert.ok(main.includes("$('play-keyboard').addEventListener('click',()=>startSoloWithoutCamera());"));
  assert.ok(main.includes("function startSoloWithoutCamera(dailyChallenge=null)"));
  const helperStart = main.indexOf('function startSoloWithoutCamera');
  const helperEnd = main.indexOf('function startTouchDuel', helperStart);
  const helper = main.slice(helperStart, helperEnd);
  assert.ok(helper.includes("beginGame('solo',dailyChallenge)"));
  assert.ok(!helper.includes('startCamera('));
});

test('solo camera motion remains an explicit opt-in route', () => {
  assert.ok(html.includes('id="play-camera"'));
  assert.ok(main.includes("$('play-camera').addEventListener('click',()=>chooseGameMode('solo'));"));
  const chooserStart = main.indexOf('function chooseGameMode');
  const chooserEnd = main.indexOf('function lockToCameraGate', chooserStart);
  const chooser = main.slice(chooserStart, chooserEnd);
  assert.ok(chooser.indexOf('cameraTargetMode=mode') < chooser.indexOf('if(cameraStatus'));
  assert.ok(chooser.includes('startCamera(mode)'));
});

test('two-player touch duel works without camera permission', () => {
  assert.ok(html.includes('id="play-duo-touch"'));
  assert.ok(main.includes("$('play-duo-touch').addEventListener('click',()=>startTouchDuel());"));
  const helperStart = main.indexOf('function startTouchDuel');
  const helperEnd = main.indexOf('function continueWithoutCamera', helperStart);
  const helper = main.slice(helperStart, helperEnd);
  assert.ok(helper.includes("beginGame('duo')"));
  assert.ok(!helper.includes('startCamera('));
});

test('Daily Rift supports both touch/keyboard and optional camera motion', () => {
  assert.ok(html.includes('id="play-daily"'));
  assert.ok(html.includes('id="play-daily-camera"'));
  assert.ok(main.includes("$('play-daily').addEventListener('click',()=>startSoloWithoutCamera(createDailyChallenge()));"));
  assert.ok(main.includes("$('play-daily-camera').addEventListener('click',()=>chooseGameMode('solo',createDailyChallenge()));"));
  assert.equal((main.match(/\$\('play-daily'\)\.addEventListener/g) || []).length, 1);
});

test('camera disconnect does not claim camera is required for all play modes', () => {
  const start = main.indexOf('function lockToCameraGate');
  const end = main.indexOf('function returnToModeSelection', start);
  const helper = main.slice(start, end);
  assert.ok(helper.includes('continue without camera'));
  assert.ok(!helper.includes('cannot start a round without the camera'));
});

test('Y8-facing game page has no external creator promotion and preserves camera-free play', () => {
  assert.ok(!html.includes('href="https://'));
  assert.ok(!html.includes("href='https://"));
  assert.ok(!html.includes('href="http://'));
  assert.ok(!html.includes('youtube.com'));
  assert.ok(!html.includes('creator-youtube'));
  assert.ok(html.includes('Created By Koglesh R. Murugan'));
  assert.ok(main.includes("startSoloWithoutCamera"));
  assert.ok(!html.includes('subscribe to unlock'));
});
