import { KinetixEventBus } from '../EventBus.js';

export const COMBAT_STATES = Object.freeze([
  'INITIALIZING',
  'CAMERA_CONNECTING',
  'CALIBRATING',
  'MATCH_START',
  'PATTERN_READ',
  'ACTIVE_COMBAT',
  'TIME_CRITICAL',
  'MATCH_OVER'
]);

const ACTIONS = new Set([
  'PULSE', 'GUARD', 'GUARD_RELEASE', 'PHASE_LEFT', 'PHASE_RIGHT',
  'NOVA', 'COLLECT', 'MEDKIT', 'LAST_LIGHT'
]);

const TRANSITIONS = Object.freeze({
  INITIALIZING: new Set(['CAMERA_CONNECTING', 'CALIBRATING', 'MATCH_START']),
  CAMERA_CONNECTING: new Set(['CALIBRATING', 'INITIALIZING']),
  CALIBRATING: new Set(['MATCH_START', 'INITIALIZING']),
  MATCH_START: new Set(['PATTERN_READ', 'ACTIVE_COMBAT', 'MATCH_OVER']),
  PATTERN_READ: new Set(['ACTIVE_COMBAT', 'TIME_CRITICAL', 'MATCH_OVER']),
  ACTIVE_COMBAT: new Set(['PATTERN_READ', 'TIME_CRITICAL', 'MATCH_OVER']),
  TIME_CRITICAL: new Set(['MATCH_OVER']),
  MATCH_OVER: new Set(['INITIALIZING', 'MATCH_START'])
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function immutableSnapshot(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) immutableSnapshot(item, seen);
  return Object.freeze(value);
}

export class KinetixCombatDirector {
  constructor({
    tickRate = 60,
    maxFrameDelta = 0.25,
    maxCatchUpTicks = 8,
    maxQueueSize = 256,
    onTick = () => {},
    onCommand = () => {},
    getSnapshot = () => ({}),
    autoStart = true,
    isEnabled = () => true
  } = {}) {
    if (!Number.isFinite(tickRate) || tickRate <= 0 || tickRate > 240) throw new RangeError('tickRate must be between 0 and 240.');
    this.tickRate = tickRate;
    this.stepSeconds = 1 / tickRate;
    this.maxFrameDelta = clamp(maxFrameDelta, this.stepSeconds, 1);
    this.maxCatchUpTicks = Math.max(1, Math.floor(maxCatchUpTicks));
    this.maxQueueSize = Math.max(8, Math.floor(maxQueueSize));
    this.onTick = onTick;
    this.onCommand = onCommand;
    this.getSnapshot = getSnapshot;
    this.autoStart = Boolean(autoStart);
    this.isEnabled = isEnabled;
    this.timer = null;
    this.running = false;
    this.lastPumpAt = 0;
    this.bus = new KinetixEventBus();
    this.state = 'INITIALIZING';
    this.tick = 0;
    this.accumulator = 0;
    this.commandSequence = 0;
    this.commandQueue = [];
    this.seed = 0x4b494e45;
    this.lastSnapshot = null;
  }

  transition(nextState, metadata = {}) {
    if (!COMBAT_STATES.includes(nextState)) throw new RangeError('Unknown combat state: ' + nextState);
    if (nextState === this.state) return false;
    if (!TRANSITIONS[this.state]?.has(nextState)) {
      this.bus.emit('combat:invalid-transition', { from: this.state, to: nextState, tick: this.tick });
      return false;
    }
    const previous = this.state;
    this.state = nextState;
    this.bus.emit('combat:state', { previous, state: nextState, tick: this.tick, metadata });
    return true;
  }

  connectCamera() {
    if (this.state === 'MATCH_OVER') this.reset();
    return this.transition('CAMERA_CONNECTING');
  }

  beginCalibration() {
    if (!['INITIALIZING', 'CAMERA_CONNECTING', 'MATCH_OVER'].includes(this.state)) return false;
    if (this.state === 'MATCH_OVER') this.reset();
    return this.transition('CALIBRATING');
  }

  beginMatch({ seed } = {}) {
    if (!['INITIALIZING', 'CALIBRATING', 'MATCH_OVER'].includes(this.state)) {
      throw new Error('A match cannot begin from ' + this.state + '.');
    }
    if (seed !== undefined) this.seed = Number(seed) >>> 0;
    this.accumulator = 0;
    this.tick = 0;
    this.commandQueue.length = 0;
    this.transition('MATCH_START');
    this.transition('PATTERN_READ');
    this.bus.emit('combat:match-start', { tick: this.tick, tickRate: this.tickRate });
    if (this.autoStart) this.start();
  }

  endMatch(result = 'complete') {
    if (this.state === 'MATCH_OVER') return false;
    const transitioned = this.transition('MATCH_OVER', { result });
    this.stop();
    this.commandQueue.length = 0;
    this.accumulator = 0;
    this.bus.emit('combat:match-end', { result, tick: this.tick });
    return transitioned;
  }

  reset() {
    this.stop();
    const previous = this.state;
    this.state = 'INITIALIZING';
    this.tick = 0;
    this.accumulator = 0;
    this.commandQueue.length = 0;
    this.seed = 0x4b494e45;
    this.lastSnapshot = null;
    this.bus.emit('combat:state', { previous, state: this.state, tick: this.tick, metadata: { reset: true } });
  }

  clearCommands(reason = 'cleared') {
    const count = this.commandQueue.length;
    this.commandQueue.length = 0;
    if (count) this.bus.emit('combat:queue-cleared', { reason, count, tick: this.tick });
    return count;
  }

  enqueueAction(kind, player = 1, source = 'unknown') {
    if (!ACTIONS.has(kind) || !Number.isInteger(player) || player < 1 || player > 2) return false;
    if (!['PATTERN_READ', 'ACTIVE_COMBAT', 'TIME_CRITICAL'].includes(this.state)) return false;
    if (this.commandQueue.length >= this.maxQueueSize) {
      this.bus.emit('combat:queue-overflow', { kind, player, queueSize: this.commandQueue.length });
      return false;
    }
    const command = Object.freeze({
      sequence: ++this.commandSequence,
      kind,
      player,
      source: String(source).slice(0, 24),
      queuedAtTick: this.tick
    });
    this.commandQueue.push(command);
    return true;
  }

  start() {
    if (this.running || !this.autoStart) return false;
    this.running = true;
    this.lastPumpAt = performance.now();
    const pump = () => {
      if (!this.running) return;
      const now = performance.now();
      const delta = Math.max(0, (now - this.lastPumpAt) / 1000);
      this.lastPumpAt = now;
      this.advance(delta, { enabled: this.isEnabled() });
      if (this.running) {
        const elapsed = performance.now() - now;
        this.timer = setTimeout(pump, Math.max(0, this.stepSeconds * 1000 - elapsed));
      }
    };
    this.timer = setTimeout(pump, this.stepSeconds * 1000);
    return true;
  }

  stop() {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.lastPumpAt = 0;
    this.accumulator = 0;
    return true;
  }

  advance(deltaSeconds, { enabled = true } = {}) {
    if (!enabled || this.state === 'INITIALIZING' || this.state === 'CAMERA_CONNECTING'
      || this.state === 'CALIBRATING' || this.state === 'MATCH_OVER') {
      this.accumulator = 0;
      return 0;
    }
    const delta = Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, this.maxFrameDelta) : 0;
    this.accumulator = Math.min(this.accumulator + delta, this.stepSeconds * this.maxCatchUpTicks);
    let steps = 0;

    while (this.accumulator + 1e-9 >= this.stepSeconds && steps < this.maxCatchUpTicks) {
      this.accumulator -= this.stepSeconds;
      this._fixedStep();
      steps += 1;
      if (this.state === 'MATCH_OVER') break;
    }

    if (steps === this.maxCatchUpTicks && this.accumulator >= this.stepSeconds) {
      this.accumulator = Math.min(this.accumulator, this.stepSeconds);
      this.bus.emit('combat:time-clamped', { tick: this.tick, droppedSeconds: delta });
    }
    return steps;
  }

  _fixedStep() {
    this.tick += 1;
    if (this.state === 'MATCH_START') this.transition('PATTERN_READ');

    const queue = this.commandQueue.splice(0, this.maxQueueSize);
    for (const command of queue) {
      try {
        this.onCommand(command);
        this.bus.emit('combat:action', { ...command, tick: this.tick });
      } catch (error) {
        this.bus.emit('combat:command-error', { command, message: error?.message || 'Command failed.' });
      }
    }

    try {
      this.onTick(this.stepSeconds, this.tick);
    } catch (error) {
      this.bus.emit('combat:simulation-error', { tick: this.tick, message: error?.message || 'Simulation tick failed.' });
      this.endMatch('simulation-error');
      return;
    }

    const raw = this.getSnapshot() || {};
    const snapshot = immutableSnapshot({
      tick: this.tick,
      tickRate: this.tickRate,
      lifecycle: this.state,
      status: raw.status ?? 'unknown',
      phase: raw.phase ?? 'idle',
      hp: raw.hp ?? null,
      enemyHp: raw.enemyHp ?? null,
      mana: raw.mana ?? null,
      combo: raw.combo ?? 0,
      remainingSeconds: raw.remainingSeconds ?? null
    });
    this.lastSnapshot = snapshot;

    if (raw.status && raw.status !== 'playing') {
      this.endMatch(raw.status);
      return;
    }
    if (this.state !== 'TIME_CRITICAL' && Number.isFinite(raw.hp) && raw.hp > 0 && raw.hp <= 24) {
      this.transition('TIME_CRITICAL', { hp: raw.hp });
    } else if (this.state !== 'TIME_CRITICAL' && raw.phase === 'telegraph' && this.state === 'ACTIVE_COMBAT') {
      this.transition('PATTERN_READ');
    } else if (this.state === 'PATTERN_READ' && raw.phase !== 'telegraph') {
      this.transition('ACTIVE_COMBAT');
    }

    this.bus.emit('combat:snapshot', snapshot);
  }

  emit(type, payload) {
    return this.bus.emit(type, payload);
  }

  random() {
    // Mulberry32: seeded, deterministic, and independent of render-frame timing.
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
