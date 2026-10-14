const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'kinetix-creator-draft-v1';
const BLUEPRINT_FORMAT = 'kinetix-motion-blueprint';
const BLUEPRINT_VERSION = 1;

const TEMPLATE_PRESETS = Object.freeze({
  dodger: {
    name: 'Rift Dodger',
    gesture: 'lean',
    rule: 'dodge',
    goal: 8,
    duration: 45,
    difficulty: 'normal',
    theme: 'rift',
    description: 'Switch lanes with a controlled lean and build a streak by avoiding incoming Rift signals.'
  },
  reflex: {
    name: 'Pulse Rush',
    gesture: 'jab',
    rule: 'hit',
    goal: 12,
    duration: 30,
    difficulty: 'expert',
    theme: 'neon',
    description: 'Use deliberate air-jabs to hit quick targets before time runs out. Keep every movement comfortable and controlled.'
  },
  puzzle: {
    name: 'Pose Puzzle',
    gesture: 'guard',
    rule: 'guard',
    goal: 5,
    duration: 60,
    difficulty: 'normal',
    theme: 'ember',
    description: 'Register a defensive pose to unlock the next sequence. This prototype simulates the rule without activating the camera.'
  }
});

const ALLOWED = Object.freeze({
  templates: new Set(Object.keys(TEMPLATE_PRESETS)),
  gestures: new Set(['lean', 'jab', 'guard', 'any']),
  rules: new Set(['dodge', 'hit', 'guard', 'collect']),
  difficulties: new Set(['relaxed', 'normal', 'expert']),
  themes: new Set(['rift', 'neon', 'ember'])
});

const defaultConfig = () => ({
  name: TEMPLATE_PRESETS.dodger.name,
  template: 'dodger',
  gesture: TEMPLATE_PRESETS.dodger.gesture,
  rule: TEMPLATE_PRESETS.dodger.rule,
  goal: TEMPLATE_PRESETS.dodger.goal,
  duration: TEMPLATE_PRESETS.dodger.duration,
  difficulty: TEMPLATE_PRESETS.dodger.difficulty,
  theme: TEMPLATE_PRESETS.dodger.theme,
  countdown: true,
  sound: true
});

function cleanName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 42) || 'Untitled Motion Game';
}

function normalizeConfig(input) {
  const fallback = defaultConfig();
  const value = input && typeof input === 'object' ? input : {};
  const boundedNumber = (candidate, min, max, step, defaultValue) => {
    const n = Number(candidate);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.min(max, Math.max(min, Math.round((n - min) / step) * step + min));
  };
  return {
    name: cleanName(value.name ?? fallback.name),
    template: ALLOWED.templates.has(value.template) ? value.template : fallback.template,
    gesture: ALLOWED.gestures.has(value.gesture) ? value.gesture : fallback.gesture,
    rule: ALLOWED.rules.has(value.rule) ? value.rule : fallback.rule,
    goal: boundedNumber(value.goal, 3, 20, 1, fallback.goal),
    duration: boundedNumber(value.duration, 15, 120, 5, fallback.duration),
    difficulty: ALLOWED.difficulties.has(value.difficulty) ? value.difficulty : fallback.difficulty,
    theme: ALLOWED.themes.has(value.theme) ? value.theme : fallback.theme,
    countdown: typeof value.countdown === 'boolean' ? value.countdown : fallback.countdown,
    sound: typeof value.sound === 'boolean' ? value.sound : fallback.sound
  };
}

let config = defaultConfig();
const canvas = $('preview-canvas');
const ctx = canvas?.getContext('2d');
let toastTimer = 0;
let animationFrame = 0;
let test = {
  status: 'idle',
  score: 0,
  startedAt: 0,
  countdownUntil: 0,
  endAt: 0,
  lastGesture: '',
  message: 'Configure it, then start a local test.'
};

const THEME = Object.freeze({
  rift: { main: '#a396ff', accent: '#67e8ef', glow: 'rgba(132,112,255,.22)', danger: '#ff91bb' },
  neon: { main: '#67e8ef', accent: '#75f0cc', glow: 'rgba(64,210,236,.2)', danger: '#ffbb7e' },
  ember: { main: '#ffbb7e', accent: '#ffe8b0', glow: 'rgba(255,152,92,.2)', danger: '#fa8f91' }
});

function showToast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

function gestureLabel(value = config.gesture) {
  return ({ lean: 'LEAN LEFT / RIGHT', jab: 'AIR JAB', guard: 'X-BLOCK / GUARD', any: 'ANY REGISTERED MOVE' })[value] || 'MOTION';
}

function ruleLabel(value = config.rule) {
  return ({ dodge: 'AVOID A HAZARD', hit: 'HIT A TARGET', guard: 'HOLD A GUARD', collect: 'COLLECT A SIGNAL' })[value] || 'COMPLETE THE GOAL';
}

function templateLabel(value = config.template) {
  return ({ dodger: 'RIFT DODGER', reflex: 'PULSE RUSH', puzzle: 'POSE PUZZLE' })[value] || 'MOTION GAME';
}

function getBlueprint() {
  return {
    format: BLUEPRINT_FORMAT,
    schemaVersion: BLUEPRINT_VERSION,
    engine: 'KINETIX CREATOR STUDIO ALPHA',
    exportedAt: new Date().toISOString(),
    project: {
      name: config.name,
      template: config.template,
      primaryGesture: config.gesture,
      successRule: config.rule,
      goalCount: config.goal,
      durationSeconds: config.duration,
      difficulty: config.difficulty,
      theme: config.theme,
      options: { countdown: config.countdown, soundCues: config.sound }
    },
    runtime: {
      mode: 'blueprint-only',
      inference: 'on-device when connected to a compatible runtime',
      cameraRequestedByEditor: false,
      onlinePublishingAvailable: false
    }
  };
}

function saveDraft(silent = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      format: BLUEPRINT_FORMAT,
      schemaVersion: BLUEPRINT_VERSION,
      savedAt: new Date().toISOString(),
      config
    }));
    if (!silent) showToast('Draft saved on this device.');
    $('preview-state').textContent = 'SAVED LOCALLY';
    return true;
  } catch (error) {
    console.warn('Kinetix draft could not be saved locally.', error);
    if (!silent) showToast('Local storage is unavailable. Export a backup instead.');
    return false;
  }
}

function applyConfigToControls() {
  $('project-name').value = config.name;
  $('gesture').value = config.gesture;
  $('rule').value = config.rule;
  $('goal').value = String(config.goal);
  $('duration').value = String(config.duration);
  $('difficulty').value = config.difficulty;
  $('theme').value = config.theme;
  $('countdown').checked = config.countdown;
  $('sound').checked = config.sound;
  document.querySelectorAll('[data-template]').forEach(button => {
    const selected = button.dataset.template === config.template;
    button.setAttribute('aria-pressed', String(selected));
  });
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved?.format !== BLUEPRINT_FORMAT || saved?.schemaVersion !== BLUEPRINT_VERSION) {
      return false;
    }
    config = normalizeConfig(saved.config);
    return true;
  } catch (error) {
    console.warn('Ignoring an unreadable saved Kinetix draft.', error);
    return false;
  }
}

function syncConfigFromControls() {
  config = normalizeConfig({
    name: $('project-name').value,
    template: config.template,
    gesture: $('gesture').value,
    rule: $('rule').value,
    goal: $('goal').value,
    duration: $('duration').value,
    difficulty: $('difficulty').value,
    theme: $('theme').value,
    countdown: $('countdown').checked,
    sound: $('sound').checked
  });
}

function updateOutputs() {
  $('goal-value').value = String(config.goal);
  $('duration-value').value = config.duration + 's';
  $('template-description').textContent = TEMPLATE_PRESETS[config.template].description;
  $('rule-label').textContent = 'RULE / ' + ruleLabel().replaceAll(' ', ' ');
  $('preview-title').textContent = '02 / ' + templateLabel() + ' PREVIEW';
  $('preview-message').textContent = test.message;
  $('progress-stat').textContent = test.score + ' / ' + config.goal;
  $('time-stat').textContent = remainingSeconds() + 's';
  $('score-stat').textContent = ({ idle: 'IDLE', countdown: 'READY', running: 'LIVE', won: 'CLEAR', failed: 'TIME UP' })[test.status] || 'IDLE';
  $('start-test').disabled = test.status === 'running' || test.status === 'countdown';
  $('start-test').textContent = test.status === 'running' ? 'TEST RUNNING' : test.status === 'countdown' ? 'GET READY…' : test.status === 'won' ? '✓ ROUND CLEARED' : '▶ START LOCAL TEST';
}

function remainingSeconds(now = performance.now()) {
  if (test.status === 'idle') return config.duration;
  if (test.status === 'won' || test.status === 'failed') return Math.max(0, Math.ceil((test.endAt - test.startedAt) / 1000));
  if (test.status === 'countdown') {
    return config.duration;
  }
  return Math.max(0, Math.ceil((test.endAt - now) / 1000));
}

function resetTest(message = 'Configure it, then start a local test.') {
  test = {
    status: 'idle',
    score: 0,
    startedAt: 0,
    countdownUntil: 0,
    endAt: 0,
    lastGesture: '',
    message
  };
  cancelAnimationFrame(animationFrame);
  updateOutputs();
  drawPreview();
}

function beginRunning(now = performance.now()) {
  test.status = 'running';
  test.startedAt = now;
  test.endAt = now + config.duration * 1000;
  test.message = 'Test live — register the selected gesture to score.';
  $('preview-state').textContent = 'LOCAL TEST LIVE';
  updateOutputs();
  animationFrame = requestAnimationFrame(tickTest);
}

function startTest() {
  resetTest('Get ready…');
  const now = performance.now();
  if (config.countdown) {
    test.status = 'countdown';
    test.countdownUntil = now + 3000;
    test.startedAt = now;
    test.endAt = test.countdownUntil + config.duration * 1000;
    test.message = 'Three-second countdown. Get into a comfortable position.';
    $('preview-state').textContent = 'COUNTDOWN';
    updateOutputs();
    animationFrame = requestAnimationFrame(tickTest);
  } else {
    beginRunning(now);
  }
}

function tickTest(now) {
  if (test.status === 'countdown') {
    const left = Math.max(0, test.countdownUntil - now);
    test.message = left > 0
      ? 'Starting in ' + Math.max(1, Math.ceil(left / 1000)) + '…'
      : 'Test live — register the selected gesture to score.';
    if (left <= 0) {
      test.status = 'running';
      test.startedAt = now;
      test.endAt = now + config.duration * 1000;
      $('preview-state').textContent = 'LOCAL TEST LIVE';
    }
  } else if (test.status === 'running' && now >= test.endAt) {
    test.status = 'failed';
    test.message = 'Time is up. Adjust the blueprint or start another test.';
    $('preview-state').textContent = 'ROUND ENDED';
  }

  updateOutputs();
  drawPreview(now);
  if (test.status === 'countdown' || test.status === 'running') {
    animationFrame = requestAnimationFrame(tickTest);
  }
}

function handleGesture(requestedGesture) {
  if (test.status !== 'running') {
    showToast(test.status === 'countdown' ? 'Countdown first — get ready!' : 'Start a local test before simulating gestures.');
    return;
  }

  const actualGesture = requestedGesture === 'any' ? config.gesture : requestedGesture;
  const matches = config.gesture === 'any' || actualGesture === config.gesture;
  if (!matches) {
    test.lastGesture = actualGesture;
    test.message = gestureLabel(actualGesture) + ' does not match ' + gestureLabel(config.gesture) + '.';
    drawPreview();
    updateOutputs();
    showToast('That gesture does not match this blueprint’s primary gesture.');
    return;
  }

  test.lastGesture = actualGesture;
  test.score = Math.min(config.goal, test.score + 1);
  test.message = 'Registered ' + gestureLabel(actualGesture) + ' · ' + test.score + ' of ' + config.goal + '.';
  if (test.score >= config.goal) {
    test.status = 'won';
    test.endAt = performance.now();
    test.message = 'Blueprint cleared! You reached the goal in this simulated test.';
    $('preview-state').textContent = 'GOAL REACHED';
    cancelAnimationFrame(animationFrame);
    showToast('Goal reached — blueprint test cleared.');
  }
  updateOutputs();
  drawPreview();
}

function drawPreview(now = performance.now()) {
  if (!ctx || !canvas) return;
  const width = canvas.width;
  const height = canvas.height;
  const palette = THEME[config.theme] || THEME.rift;
  const running = test.status === 'running';
  const t = running ? Math.max(0, (now - test.startedAt) / 1000) : 0;
  const wave = running ? Math.sin(t * 2.1) : Math.sin(now / 2400) * .15;
  ctx.clearRect(0, 0, width, height);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#11142c');
  background.addColorStop(.55, '#0a0c1d');
  background.addColorStop(1, '#10122a');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = 'rgba(140,153,223,.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  const glow = ctx.createRadialGradient(width * .5, height * .53, 15, width * .5, height * .53, width * .55);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, 'rgba(7,9,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = palette.main + '72';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(width*.5, height*.52, width*.30, height*.38, -.08, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([6, 12]);
  ctx.strokeStyle = palette.accent + '55';
  ctx.beginPath(); ctx.ellipse(width*.5, height*.52, width*.23, height*.3, .1, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  
  const lane = test.lastGesture === 'lean' ? (test.score % 2 ? -1 : 1) : 0;
  const playerX = width * (.5 + lane * .12 + (running ? wave * .04 : 0));
  const playerY = height * .62;
  const playerR = 23;
  ctx.shadowColor = palette.main;
  ctx.shadowBlur = 24;
  ctx.fillStyle = palette.main + '30';
  ctx.beginPath(); ctx.arc(playerX, playerY, playerR * 1.9, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 8;
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(playerX, playerY, playerR, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#f0fbff';
  ctx.beginPath(); ctx.arc(playerX, playerY, 5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.main;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(playerX - 7, playerY + 27); ctx.lineTo(playerX - 14, playerY + 47);
  ctx.moveTo(playerX + 7, playerY + 27); ctx.lineTo(playerX + 14, playerY + 47);
  ctx.moveTo(playerX - 12, playerY + 35); ctx.lineTo(playerX + 12, playerY + 35);
  ctx.stroke();

  const targetCount = Math.max(3, Math.min(6, Math.ceil(config.goal / 2)));
  for (let i=0; i<targetCount; i++) {
    const phase = running ? t * (config.difficulty === 'expert' ? 2.1 : config.difficulty === 'relaxed' ? .7 : 1.3) : i*.82;
    const x = width*.5 + Math.sin(phase + i*1.1) * width*.27;
    const y = height*.31 + Math.cos(phase*.8 + i)*height*.085;
    const r = 8 + (i%3)*2;
    ctx.strokeStyle = i < test.score ? palette.accent : palette.main + 'bb';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(x, y, r + Math.sin(phase)*2, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = i < test.score ? palette.accent : palette.main + '3c';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    if (i === test.score % targetCount && test.status !== 'won') {
      ctx.strokeStyle = palette.accent + '6a';
      ctx.beginPath(); ctx.arc(x, y, r+7, 0, Math.PI*2); ctx.stroke();
    }
  }

  ctx.fillStyle = '#8993b9';
  ctx.font = '500 12px "DM Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(templateLabel(), 22, 35);
  ctx.font = '400 10px "DM Mono", monospace';
  ctx.fillStyle = '#687295';
  ctx.fillText('GESTURE / ' + gestureLabel(), 22, 56);
  ctx.fillText('RULE / ' + ruleLabel(), 22, 73);

  ctx.textAlign = 'right';
  ctx.fillStyle = palette.accent;
  ctx.font = '500 11px "DM Mono", monospace';
  ctx.fillText(config.name.toUpperCase().slice(0, 30), width-22, 35);
  ctx.fillStyle = '#747ea2';
  ctx.font = '400 10px "DM Mono", monospace';
  ctx.fillText('GOAL ' + test.score + '/' + config.goal, width-22, 56);
  ctx.fillText(config.difficulty.toUpperCase() + ' · ' + config.duration + ' SEC', width-22, 73);

  if (test.status === 'countdown') {
    const n = Math.max(1, Math.ceil((test.countdownUntil-now)/1000));
    ctx.fillStyle = 'rgba(4,6,18,.7)';
    ctx.fillRect(width*.38, height*.36, width*.24, height*.22);
    ctx.strokeStyle = palette.accent + '9a';
    ctx.strokeRect(width*.38, height*.36, width*.24, height*.22);
    ctx.fillStyle = '#f5f7ff';
    ctx.font = '600 58px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(n), width*.5, height*.51);
  } else if (test.status === 'won' || test.status === 'failed') {
    ctx.fillStyle = 'rgba(4,6,18,.76)';
    ctx.fillRect(width*.2, height*.38, width*.6, height*.2);
    ctx.strokeStyle = test.status === 'won' ? palette.accent : palette.danger;
    ctx.strokeRect(width*.2, height*.38, width*.6, height*.2);
    ctx.fillStyle = test.status === 'won' ? palette.accent : palette.danger;
    ctx.textAlign = 'center';
    ctx.font = '600 23px "Space Grotesk", sans-serif';
    ctx.fillText(test.status === 'won' ? 'BLUEPRINT CLEARED' : 'TIME EXPIRED', width*.5, height*.465);
    ctx.fillStyle = '#d1d6f0';
    ctx.font = '400 10px "DM Mono", monospace';
    ctx.fillText(test.score + ' / ' + config.goal + ' SUCCESSFUL ACTIONS', width*.5, height*.52);
  }
  ctx.restore();
}

function updateConfiguration(changedByTemplate = false) {
  syncConfigFromControls();
  if (test.status !== 'idle') resetTest('Blueprint changed — start a fresh test.');
  updateOutputs();
  drawPreview();
  saveDraft(true);
  if (!changedByTemplate) $('preview-state').textContent = 'DRAFT UPDATED';
}

function chooseTemplate(id) {
  const preset = TEMPLATE_PRESETS[id];
  if (!preset) return;
  config = normalizeConfig({
    ...config,
    ...preset,
    name: preset.name,
    template: id
  });
  applyConfigToControls();
  resetTest('Template loaded. Start a local test when ready.');
  updateOutputs();
  drawPreview();
  saveDraft(true);
  showToast(templateLabel() + ' template loaded.');
}

function exportBlueprint() {
  const blob = new Blob([JSON.stringify(getBlueprint(), null, 2) + '\n'], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'motion-game';
  link.href = url;
  link.download = safeName + '.kinetix.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Blueprint exported as JSON.');
}

async function importBlueprint(file) {
  if (!file) return;
  if (file.size > 128 * 1024) {
    showToast('That file is too large for a game blueprint.');
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.format !== BLUEPRINT_FORMAT || parsed?.schemaVersion !== BLUEPRINT_VERSION || !parsed.project) {
      throw new Error('Unsupported blueprint format or schema version.');
    }
    const imported = parsed.project;
    config = normalizeConfig({
      name: imported.name,
      template: imported.template,
      gesture: imported.primaryGesture,
      rule: imported.successRule,
      goal: imported.goalCount,
      duration: imported.durationSeconds,
      difficulty: imported.difficulty,
      theme: imported.theme,
      countdown: imported.options?.countdown,
      sound: imported.options?.soundCues
    });
    applyConfigToControls();
    resetTest('Blueprint imported. Review settings, then start a local test.');
    updateOutputs();
    drawPreview();
    saveDraft(true);
    showToast('Blueprint imported and saved locally.');
  } catch (error) {
    console.warn('Blueprint import failed.', error);
    showToast('Could not import that file. Choose a KINETIX blueprint JSON export.');
  } finally {
    $('import-file').value = '';
  }
}

function bindEvents() {
  for (const id of ['project-name', 'gesture', 'rule', 'goal', 'duration', 'difficulty', 'theme', 'countdown', 'sound']) {
    const element = $(id);
    element.addEventListener(id === 'project-name' || id === 'goal' || id === 'duration' ? 'input' : 'change', () => updateConfiguration());
  }
  document.querySelectorAll('[data-template]').forEach(button => {
    button.addEventListener('click', () => chooseTemplate(button.dataset.template));
  });
  $('start-test').addEventListener('click', startTest);
  $('reset-test').addEventListener('click', () => resetTest());
  $('save-draft').addEventListener('click', () => saveDraft(false));
  $('export-button').addEventListener('click', exportBlueprint);
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', event => importBlueprint(event.currentTarget.files?.[0]));

  document.querySelectorAll('[data-simulate]').forEach(button => {
    button.addEventListener('click', () => handleGesture(button.dataset.simulate));
  });

  window.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return;
    let gesture = '';
    if (event.code === 'Space' || event.key.toLowerCase() === 'j') gesture = 'jab';
    else if (event.key.toLowerCase() === 'g') gesture = 'guard';
    else if (['a', 'd', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase())) gesture = 'lean';
    if (gesture) {
      if (event.code === 'Space') event.preventDefault();
      handleGesture(gesture);
    }
  });
}

function init() {
  loadDraft();
  applyConfigToControls();
  bindEvents();
  updateOutputs();
  drawPreview();
  saveDraft(true);
}

init();
