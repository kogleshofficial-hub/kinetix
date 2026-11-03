import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { classifyPulseTrajectory } from './KinetixMotionMath.js';

let landmarker = null;
let playerLimit = 1;
let requiredPlayerCount = 1;
let sensitivity = 'high';
let lastTimestamp = 0;
let lastTrackingAt = 0;
let latest = [];
let calibrated = false;
let memories = [];

const profiles = Object.freeze({
  high: Object.freeze({ lift: 0.125, liftSpeed: 0.48, lean: 0.155, cooldown: 420 }),
  max: Object.freeze({ lift: 0.085, liftSpeed: 0.34, lean: 0.12, cooldown: 340 })
});

function makeMemory() {
  return {
    filters: new Map(),
    baselineLean: 0,
    baselineWristY: [null, null],
    previousWristY: [null, null],
    pulseArmed: [true, true],
    lastPulseAt: [-Infinity, -Infinity],
    guard: false,
    lastGuardAt: -Infinity,
    phaseSide: 0,
    lastPhaseAt: -Infinity,
    wristHistory: [[], []]
  };
}

function visible(point, threshold = 0.2) {
  return Boolean(point) && (point.visibility === undefined || point.visibility >= threshold);
}

function smoothLandmarks(points, memory) {
  return points.map((point, index) => {
    if (!visible(point, 0.08)) {
      memory.filters.delete(index);
      return null;
    }
    const previous = memory.filters.get(index);
    if (!previous) {
      const first = { x: point.x, y: point.y, z: point.z || 0, visibility: point.visibility ?? 1 };
      memory.filters.set(index, first);
      return first;
    }
    const alpha = 0.62;
    const next = {
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
      z: previous.z + ((point.z || 0) - previous.z) * alpha,
      visibility: point.visibility ?? previous.visibility
    };
    memory.filters.set(index, next);
    return next;
  });
}

function torso(points) {
  if (!points || points.length < 25) return null;
  const ls = points[11], rs = points[12], lh = points[23], rh = points[24];
  if (![ls, rs, lh, rh].every((point) => visible(point, 0.16))) return null;
  const sx = (ls.x + rs.x) / 2;
  const sy = (ls.y + rs.y) / 2;
  const hx = (lh.x + rh.x) / 2;
  const hy = (lh.y + rh.y) / 2;
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const torsoHeight = hy - sy;
  if (shoulderWidth < 0.035 || torsoHeight < 0.035 || torsoHeight > 0.8) return null;
  return {
    sx, sy, hx, hy, shoulderWidth,
    lean: (sx - hx) / shoulderWidth,
    wrists: [visible(points[15], 0.12) ? points[15] : null, visible(points[16], 0.12) ? points[16] : null]
  };
}

function calibrate() {
  if (!latest.length || latest.some((points) => !torso(points))) return false;
  memories = memories.slice(0, playerLimit);
  latest.forEach((points, index) => {
    const body = torso(points);
    const memory = memories[index] || makeMemory();
    memory.baselineLean = body.lean;
    memory.baselineWristY = body.wrists.map((wrist) => wrist ? wrist.y : null);
    memory.previousWristY = memory.baselineWristY.slice();
    memory.pulseArmed = [true, true];
    memory.wristHistory = [[], []];
    memory.guard = false;
    memory.phaseSide = 0;
    memories[index] = memory;
  });
  calibrated = true;
  return true;
}

function emitAction(kind, player, timestamp, details = null) {
  self.postMessage({ type: 'ACTION', kind, player: player + 1, timestamp, details });
}

function updateGestures(points, playerIndex, timestamp) {
  const memory = memories[playerIndex];
  const body = torso(points);
  if (!body) {
    if (memory.guard) emitAction('GUARD_RELEASE', playerIndex, timestamp);
    memory.guard = false;
    memory.phaseSide = 0;
    memory.previousWristY = [null, null];
    memory.wristHistory = [[], []];
    return;
  }

  const config = profiles[sensitivity];
  const seconds = Math.max(0.001, Math.min(0.2, (timestamp - (memory.lastFrameAt || timestamp - 33)) / 1000));
  memory.lastFrameAt = timestamp;

  const wristPair = body.wrists;
  const chestY = body.sy + (body.hy - body.sy) * 0.36;
  const insideChest = wristPair.every((wrist) => wrist
    && wrist.x >= body.sx - body.shoulderWidth * 0.66
    && wrist.x <= body.sx + body.shoulderWidth * 0.66
    && wrist.y >= body.sy - body.shoulderWidth * 0.12
    && wrist.y <= body.hy + body.shoulderWidth * 0.12);
  const wristsNear = wristPair.every(Boolean)
    && Math.hypot(wristPair[0].x - wristPair[1].x, wristPair[0].y - wristPair[1].y) < body.shoulderWidth * 0.92;
  const guardNow = insideChest && wristsNear;

  if (guardNow) {
    if (!memory.guard || timestamp - memory.lastGuardAt >= 180) {
      emitAction('GUARD', playerIndex, timestamp);
      memory.lastGuardAt = timestamp;
    }
  } else if (memory.guard) {
    emitAction('GUARD_RELEASE', playerIndex, timestamp);
  }
  memory.guard = guardNow;

  if (!guardNow) {
    for (let side = 0; side < 2; side++) {
      const wrist = wristPair[side];
      let baseline = memory.baselineWristY[side];
      const previousY = memory.previousWristY[side];
      if (!wrist) {
        memory.previousWristY[side] = null;
        memory.wristHistory[side] = [];
        continue;
      }
      if (baseline === null || baseline === undefined) {
        memory.baselineWristY[side] = wrist.y;
        memory.previousWristY[side] = wrist.y;
        baseline = wrist.y;
        continue;
      }

      const lift = (baseline - wrist.y) / body.shoulderWidth;
      const riseSpeed = previousY === null ? 0 : ((previousY - wrist.y) / body.shoulderWidth) / seconds;
      if (!memory.pulseArmed[side] && lift < config.lift * 0.34) {
        memory.pulseArmed[side] = true;
        memory.wristHistory[side] = [];
      }

      const history = memory.wristHistory[side];
      history.push({
        x: (wrist.x - body.sx) / body.shoulderWidth,
        y: (wrist.y - body.sy) / body.shoulderWidth,
        timestamp
      });
      if (history.length > 10) history.shift();

      const raisedIntoControlZone = wrist.y < body.sy + body.shoulderWidth * 0.3;
      if (memory.pulseArmed[side]
        && lift >= config.lift
        && riseSpeed >= config.liftSpeed
        && raisedIntoControlZone
        && timestamp - memory.lastPulseAt[side] >= config.cooldown) {
        const trajectory = classifyPulseTrajectory(history);
        emitAction('PULSE', playerIndex, timestamp, {
          pulseStyle: trajectory.pulseStyle,
          pulseConfidence: trajectory.confidence
        });
        memory.lastPulseAt[side] = timestamp;
        memory.pulseArmed[side] = false;
      }
      memory.previousWristY[side] = wrist.y;
    }
  } else {
    memory.previousWristY = wristPair.map((wrist) => wrist ? wrist.y : null);
    memory.wristHistory = [[], []];
  }

  const leanDelta = body.lean - memory.baselineLean;
  const side = leanDelta <= -config.lean ? -1 : leanDelta >= config.lean ? 1 : 0;
  if (!guardNow && side !== 0 && memory.phaseSide === 0 && timestamp - memory.lastPhaseAt >= 420) {
    emitAction(side < 0 ? 'PHASE_LEFT' : 'PHASE_RIGHT', playerIndex, timestamp);
    memory.lastPhaseAt = timestamp;
  }
  if (Math.abs(leanDelta) < config.lean * 0.48) memory.phaseSide = 0;
  else if (side !== 0) memory.phaseSide = side;
}

async function initialize(message) {
  try {
    playerLimit = message.players === 2 ? 2 : 1;
    requiredPlayerCount = message.requiredPlayers === 2 ? 2 : 1;
    sensitivity = profiles[message.sensitivity] ? message.sensitivity : 'high';
    const files = await FilesetResolver.forVisionTasks(message.wasmUrl);
    const options = {
      baseOptions: { modelAssetPath: message.modelUrl, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: playerLimit,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45
    };
    try {
      landmarker = await PoseLandmarker.createFromOptions(files, options);
    } catch {
      landmarker = await PoseLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { modelAssetPath: message.modelUrl, delegate: 'CPU' }
      });
    }
    memories = Array.from({ length: playerLimit }, makeMemory);
    self.postMessage({ type: 'READY' });
  } catch (error) {
    self.postMessage({ type: 'INIT_ERROR', message: error?.message || 'Could not initialize the pose model.' });
  }
}

async function processFrame(bitmap, timestamp) {
  if (!landmarker || !bitmap) {
    bitmap?.close?.();
    self.postMessage({ type: 'FRAME_DONE' });
    return;
  }

  try {
    const safeTimestamp = Math.max(lastTimestamp + 0.01, timestamp);
    lastTimestamp = safeTimestamp;
    const result = landmarker.detectForVideo(bitmap, safeTimestamp);
    bitmap.close();

    const candidates = (result.landmarks || [])
      .filter((pose) => Array.isArray(pose) && pose.length >= 25)
      .sort((a, b) => ((a[11]?.x || 0) + (a[12]?.x || 0)) - ((b[11]?.x || 0) + (b[12]?.x || 0)))
      .slice(0, playerLimit);
    const poses = candidates
      .map((pose, index) => smoothLandmarks(pose, memories[index] || makeMemory()))
      .filter(Boolean);

    latest = poses.slice(0, playerLimit);
    const count = latest.filter((pose) => Boolean(torso(pose))).length;
    const ready = count >= requiredPlayerCount;
    lastTrackingAt = ready ? safeTimestamp : lastTrackingAt;

    self.postMessage({ type: 'TRACKING', ready, count, required: requiredPlayerCount, tracked: playerLimit, timestamp: safeTimestamp });

    if (calibrated && ready) {
      latest.forEach((pose, index) => updateGestures(pose, index, safeTimestamp));
    }
  } catch (error) {
    self.postMessage({ type: 'FRAME_ERROR', message: error?.message || 'Pose frame failed.' });
  } finally {
    if (bitmap && !bitmap.closed) bitmap.close?.();
    self.postMessage({ type: 'FRAME_DONE' });
  }
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'INIT') {
    void initialize(message);
    return;
  }
  if (message.type === 'FRAME') {
    void processFrame(message.bitmap, message.timestamp || performance.now());
    return;
  }
  if (message.type === 'CONFIG') {
    playerLimit = message.players === 2 ? 2 : 1;
    requiredPlayerCount = message.requiredPlayers === 2 ? 2 : 1;
    memories = Array.from({ length: playerLimit }, makeMemory);
    latest = [];
    calibrated = false;
    self.postMessage({ type: 'TRACKING', ready: false, count: 0, required: requiredPlayerCount });
    return;
  }
  if (message.type === 'SET_SENSITIVITY') {
    sensitivity = profiles[message.value] ? message.value : sensitivity;
    return;
  }
  if (message.type === 'CALIBRATE') {
    const ok = calibrate();
    self.postMessage({
      type: 'CALIBRATED',
      requestId: message.requestId,
      ok,
      reason: ok ? '' : 'Keep the required player or players visible, then calibrate again.'
    });
    return;
  }
  if (message.type === 'STOP') {
    try { landmarker?.close(); } catch {}
    landmarker = null;
    calibrated = false;
    latest = [];
    memories = [];
  }
});
