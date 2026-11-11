import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { detectRaisedHand } from './KinetixMotionMath.js';

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
  high: Object.freeze({ raiseThreshold: 0.04, releaseThreshold: 0.30, confirmFrames: 3, releaseFrames: 2, lean: 0.155, cooldown: 260 }),
  max: Object.freeze({ raiseThreshold: 0.18, releaseThreshold: 0.30, confirmFrames: 2, releaseFrames: 2, lean: 0.12, cooldown: 260 })
});

function makeMemory() {
  return {
    filters: new Map(),
    baselineLean: 0,
    raiseArmed: [true, true],
    raiseFrames: [0, 0],
    releaseFrames: [0, 0],
    lastRaiseAt: [-Infinity, -Infinity],
    guard: false,
    lastGuardAt: -Infinity,
    phaseSide: 0,
    lastPhaseAt: -Infinity
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
    const alpha = index === 13 || index === 14 || index === 15 || index === 16 ? 0.74 : 0.62;
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
    shoulderZ: ((ls.z || 0) + (rs.z || 0)) / 2,
    lean: (sx - hx) / shoulderWidth,
    elbows: [visible(points[13], 0.12) ? points[13] : null, visible(points[14], 0.12) ? points[14] : null],
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
    memory.raiseArmed = body.wrists.map((wrist) => !wrist || wrist.y >= body.sy + body.shoulderWidth * 0.30);
    memory.raiseFrames = [0, 0];
    memory.releaseFrames = [0, 0];
    memory.lastRaiseAt = [-Infinity, -Infinity];
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
    memory.raiseFrames = [0, 0];
    memory.releaseFrames = [0, 0];
    return;
  }

  const config = profiles[sensitivity];
  const seconds = Math.max(0.001, Math.min(0.2, (timestamp - (memory.lastFrameAt || timestamp - 33)) / 1000));
  memory.lastFrameAt = timestamp;

  const wristPair = body.wrists;
  const previousShoulderZ = Number.isFinite(memory.previousShoulderZ) ? memory.previousShoulderZ : body.shoulderZ;
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

  for (let side = 0; side < 2; side += 1) {
    const wrist = wristPair[side];
    const elbow = body.elbows[side];
    if (!wrist || !elbow) {
      memory.raiseFrames[side] = 0;
      memory.releaseFrames[side] = 0;
      continue;
    }

    const lowered = wrist.y >= body.sy + body.shoulderWidth * config.releaseThreshold;
    if (lowered) {
      memory.releaseFrames[side] += 1;
      if (memory.releaseFrames[side] >= config.releaseFrames) {
        memory.raiseArmed[side] = true;
        memory.raiseFrames[side] = 0;
      }
    } else {
      memory.releaseFrames[side] = 0;
    }

    const raised = !guardNow && detectRaisedHand({
      wristY: wrist.y,
      elbowY: elbow.y,
      shoulderY: body.sy,
      shoulderWidth: body.shoulderWidth
    }, config).detected;

    if (raised && memory.raiseArmed[side]) {
      memory.raiseFrames[side] += 1;
      if (memory.raiseFrames[side] >= config.confirmFrames
        && timestamp - memory.lastRaiseAt[side] >= config.cooldown) {
        emitAction('PULSE', playerIndex, timestamp, {
          gestureType: 'RAISED_HAND',
          control: 'RAISE_AND_LOWER',
          pulseStyle: 'NEUTRAL',
          pulseConfidence: 1
        });
        memory.lastRaiseAt[side] = timestamp;
        memory.raiseArmed[side] = false;
        memory.raiseFrames[side] = 0;
        memory.releaseFrames[side] = 0;
      }
    } else {
      memory.raiseFrames[side] = 0;
    }
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

    self.postMessage({
      type: 'TRACKING', ready, count, required: requiredPlayerCount, tracked: playerLimit, timestamp: safeTimestamp,
      // Landmark coordinates stay on-device and are used only for the live camera skeleton overlay.
      poses: latest.map((pose) => pose.map((point) => point ? { x: point.x, y: point.y, visibility: point.visibility } : null))
    });

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
