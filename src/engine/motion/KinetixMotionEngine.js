const DEFAULT_KEYS = Object.freeze({
  solo: {
    ' ': ['PULSE', 1], j: ['PULSE', 1], g: ['GUARD', 1], shift: ['GUARD', 1],
    a: ['PHASE_LEFT', 1], arrowleft: ['PHASE_LEFT', 1],
    d: ['PHASE_RIGHT', 1], arrowright: ['PHASE_RIGHT', 1],
    q: ['NOVA', 1], enter: ['NOVA', 1], r: ['COLLECT', 1], e: ['MEDKIT', 1], f: ['LAST_LIGHT', 1]
  },
  duo: {
    ' ': ['PULSE', 1], g: ['GUARD', 1], shift: ['GUARD', 1], a: ['PHASE_LEFT', 1], d: ['PHASE_RIGHT', 1],
    q: ['NOVA', 1], r: ['COLLECT', 1], e: ['MEDKIT', 1],
    j: ['PULSE', 2], l: ['GUARD', 2], arrowleft: ['PHASE_LEFT', 2], arrowright: ['PHASE_RIGHT', 2],
    u: ['NOVA', 2], i: ['COLLECT', 2], o: ['MEDKIT', 2]
  }
});

export class KinetixMotionEngine {
  constructor({
    modelUrl = '/models/pose_landmarker_lite.task',
    wasmUrl = '/mediapipe/wasm',
    onAction = () => {},
    onTracking = () => {},
    onError = () => {},
    workerFactory = () => new Worker(new URL('./motion.worker.js', import.meta.url), {
      type: 'module',
      name: 'kinetix-motion-worker'
    })
  } = {}) {
    this.modelUrl = modelUrl;
    this.wasmUrl = wasmUrl;
    this.onAction = onAction;
    this.onTracking = onTracking;
    this.onError = onError;
    this.workerFactory = workerFactory;
    this.worker = null;
    this.video = null;
    this.ready = false;
    this.running = false;
    this.players = 1;
    this.requiredPlayers = 1;
    this.sensitivity = 'high';
    this.frameInFlight = false;
    this.lastTimestamp = 0;
    this.videoFrameHandle = null;
    this.rafHandle = 0;
    this.requestSequence = 0;
    this.pending = new Map();
    this.keyboardTarget = null;
    this.keyboardOptions = null;
    this.keyboardDown = new Set();
    this._onMessage = this._onMessage.bind(this);
    this._onWorkerError = this._onWorkerError.bind(this);
    this._captureFrame = this._captureFrame.bind(this);
    this._keyboardDown = this._keyboardDown.bind(this);
    this._keyboardUp = this._keyboardUp.bind(this);
    this._releaseKeyboardGuards = this._releaseKeyboardGuards.bind(this);
  }

  get isReady() {
    return this.ready && Boolean(this.worker);
  }

  async start(video, { players = 1, requiredPlayers = players, sensitivity = this.sensitivity } = {}) {
    if (!video || typeof video.requestVideoFrameCallback !== 'function' && typeof requestAnimationFrame !== 'function') {
      throw new Error('This browser cannot provide camera frames to the motion worker.');
    }
    if (players !== 1 && players !== 2) throw new RangeError('Player count must be 1 or 2.');
    if (![1, 2].includes(requiredPlayers) || requiredPlayers > players) throw new RangeError('Required player count must be 1 or 2 and cannot exceed tracked players.');
    if (this.running) await this.stop();

    this.video = video;
    this.players = players;
    this.requiredPlayers = requiredPlayers;
    this.setSensitivity(sensitivity);
    this.lastTimestamp = 0;
    this.frameInFlight = false;

    const worker = this.workerFactory();
    this.worker = worker;
    worker.addEventListener('message', this._onMessage);
    worker.addEventListener('error', this._onWorkerError);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete('init');
        reject(new Error('Motion worker initialization timed out.'));
      }, 30000);
      this.pending.set('init', {
        resolve: () => { clearTimeout(timeout); resolve(); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      worker.postMessage({
        type: 'INIT',
        modelUrl: this.modelUrl,
        wasmUrl: this.wasmUrl,
        players: this.players,
        requiredPlayers: this.requiredPlayers,
        sensitivity: this.sensitivity
      });
    });

    this.ready = true;
    this.running = true;
    this._scheduleFrame();
    return true;
  }

  configure({ players = this.players, requiredPlayers = players } = {}) {
    if (![1, 2].includes(players) || ![1, 2].includes(requiredPlayers) || requiredPlayers > players) {
      throw new RangeError('Invalid tracked/required player count.');
    }
    this.players = players;
    this.requiredPlayers = requiredPlayers;
    this.worker?.postMessage({ type: 'CONFIG', players, requiredPlayers });
    return { players, requiredPlayers };
  }

  setSensitivity(mode) {
    const normalized = String(mode).toLowerCase();
    if (!['high', 'max'].includes(normalized)) throw new RangeError('Sensitivity must be HIGH or MAX.');
    this.sensitivity = normalized;
    this.worker?.postMessage({ type: 'SET_SENSITIVITY', value: normalized });
    return normalized;
  }

  async calibrate() {
    if (!this.isReady || !this.running) return { ok: false, reason: 'Camera tracking is not ready.' };
    const id = ++this.requestSequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Calibration request timed out.'));
      }, 3000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      this.worker.postMessage({ type: 'CALIBRATE', requestId: id });
    });
  }

  attachKeyboard(target = window, {
    getMode = () => 'solo',
    isEnabled = () => true
  } = {}) {
    this.detachKeyboard();
    this.keyboardTarget = target;
    this.keyboardOptions = { getMode, isEnabled };
    target.addEventListener('keydown', this._keyboardDown);
    target.addEventListener('keyup', this._keyboardUp);
    target.addEventListener('blur', this._releaseKeyboardGuards);
    return () => this.detachKeyboard();
  }

  detachKeyboard() {
    if (!this.keyboardTarget) return;
    this.keyboardTarget.removeEventListener('keydown', this._keyboardDown);
    this.keyboardTarget.removeEventListener('keyup', this._keyboardUp);
    this.keyboardTarget.removeEventListener('blur', this._releaseKeyboardGuards);
    this.keyboardTarget = null;
    this.keyboardOptions = null;
    this.keyboardDown.clear();
  }

  _keyboardDown(event) {
    if (!this.keyboardOptions?.isEnabled()) return;
    const key = event.key.toLowerCase();
    const mode = this.keyboardOptions.getMode() === 'duo' ? 'duo' : 'solo';
    const mapping = DEFAULT_KEYS[mode][key];
    if (!mapping || event.repeat) return;
    if ([' ', 'arrowleft', 'arrowright', 'enter'].includes(key)) event.preventDefault();
    this.keyboardDown.add(key);
    this.onAction(mapping[0], mapping[1], 'keyboard');
  }

  _keyboardUp(event) {
    const key = event.key.toLowerCase();
    this.keyboardDown.delete(key);
    if (['g', 'shift', 'l'].includes(key)) {
      const player = key === 'l' ? 2 : 1;
      this.onAction('GUARD_RELEASE', player, 'keyboard');
    }
  }

  _releaseKeyboardGuards() {
    for (const key of this.keyboardDown) {
      if (['g', 'shift', 'l'].includes(key)) this.onAction('GUARD_RELEASE', key === 'l' ? 2 : 1, 'keyboard');
    }
    this.keyboardDown.clear();
  }

  _scheduleFrame() {
    if (!this.running || !this.video) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.videoFrameHandle = this.video.requestVideoFrameCallback(this._captureFrame);
    } else {
      this.rafHandle = requestAnimationFrame(this._captureFrame);
    }
  }

  async _captureFrame(now, metadata) {
    if (!this.running || !this.video) return;
    this._scheduleFrame();

    if (this.frameInFlight || this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return;
    this.frameInFlight = true;

    try {
      const bitmap = await createImageBitmap(this.video);
      if (!this.running || !this.worker) {
        bitmap.close();
        this.frameInFlight = false;
        return;
      }
      const rawTime = Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime * 1000 : now;
      const timestamp = Math.max(this.lastTimestamp + 0.01, Number.isFinite(rawTime) ? rawTime : performance.now());
      this.lastTimestamp = timestamp;
      this.worker.postMessage({ type: 'FRAME', bitmap, timestamp }, [bitmap]);
    } catch (error) {
      this.frameInFlight = false;
      this.onError(error);
    }
  }

  _onMessage(event) {
    const message = event.data || {};
    if (message.type === 'READY') {
      this.pending.get('init')?.resolve();
      this.pending.delete('init');
      return;
    }
    if (message.type === 'INIT_ERROR') {
      const error = new Error(message.message || 'Motion worker failed to initialize.');
      this.pending.get('init')?.reject(error);
      this.pending.delete('init');
      this.onError(error);
      return;
    }
    if (message.type === 'FRAME_DONE') {
      this.frameInFlight = false;
      return;
    }
    if (message.type === 'FRAME_ERROR') {
      this.onError(new Error(message.message || 'Camera frame processing failed.'));
      return;
    }
    if (message.type === 'TRACKING') {
      this.onTracking(message);
      return;
    }
    if (message.type === 'ACTION') {
      this.onAction(message.kind, message.player || 1, 'camera');
      return;
    }
    if (message.type === 'CALIBRATED') {
      const pending = this.pending.get(message.requestId);
      if (pending) {
        pending.resolve({ ok: Boolean(message.ok), reason: message.reason || '' });
        this.pending.delete(message.requestId);
      }
    }
  }

  _onWorkerError(event) {
    const error = event.error || new Error(event.message || 'Motion worker crashed.');
    this.onError(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.ready = false;
    this.running = false;
  }

  async stop() {
    this.running = false;
    this.ready = false;
    if (this.video && this.videoFrameHandle !== null && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this.videoFrameHandle);
    }
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.videoFrameHandle = null;
    this.rafHandle = 0;
    this.frameInFlight = false;

    if (this.worker) {
      this.worker.removeEventListener('message', this._onMessage);
      this.worker.removeEventListener('error', this._onWorkerError);
      this.worker.postMessage({ type: 'STOP' });
      this.worker.terminate();
    }
    this.worker = null;
    this.video = null;

    for (const pending of this.pending.values()) pending.reject(new Error('Motion engine stopped.'));
    this.pending.clear();
    return true;
  }
}
