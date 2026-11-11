const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Detects a deliberate raised-hand pose using shoulder-relative landmarks.
 * No forward reach, striking trajectory, or movement-speed signal is used.
 */
export function detectRaisedHand({ wristY, elbowY, shoulderY, shoulderWidth }, profile = {}) {
  const values = [wristY, elbowY, shoulderY, shoulderWidth];
  if (!values.every(Number.isFinite) || shoulderWidth <= 0) {
    return Object.freeze({ detected: false, confidence: 0 });
  }

  const raiseThreshold = clamp(
    Number.isFinite(profile.raiseThreshold) ? profile.raiseThreshold : 0.08,
    0.01,
    0.35
  );
  const wristRaised = wristY <= shoulderY + shoulderWidth * raiseThreshold;
  const elbowLifted = elbowY <= shoulderY + shoulderWidth * 0.62;
  const wristAboveElbow = wristY <= elbowY + shoulderWidth * 0.18;
  const detected = wristRaised && elbowLifted && wristAboveElbow;

  return Object.freeze({
    detected,
    confidence: detected ? 1 : 0
  });
}

export function measureForwardReach({ baselineWristZ, wristZ, baselineShoulderZ = 0, shoulderZ = 0, shoulderWidth }) {
  const values = [baselineWristZ, wristZ, baselineShoulderZ, shoulderZ, shoulderWidth];
  if (!values.every(Number.isFinite) || shoulderWidth <= 0) return 0;
  return ((baselineWristZ - wristZ) - (baselineShoulderZ - shoulderZ)) / Math.max(shoulderWidth, 1e-6);
}

export function measureForwardSpeed({ previousWristZ, wristZ, previousShoulderZ = 0, shoulderZ = 0, shoulderWidth, seconds }) {
  const values = [previousWristZ, wristZ, previousShoulderZ, shoulderZ, shoulderWidth, seconds];
  if (!values.every(Number.isFinite) || shoulderWidth <= 0 || seconds <= 0) return 0;
  return ((previousWristZ - wristZ) - (previousShoulderZ - shoulderZ)) / Math.max(shoulderWidth, 1e-6) / Math.max(seconds, 0.001);
}

/**
 * Classify a short, shoulder-normalized wrist trajectory.
 *
 * This is deliberately a presentation hint, not a measure of strength and not
 * an input to damage, rewards, ranking, or any competitive calculation.
 *
 * Expected sample coordinates are relative to the shoulder centre and divided
 * by shoulder width. That makes the thresholds less sensitive to camera zoom.
 */
export function classifyPulseTrajectory(samples, {
  minSamples = 4,
  minPathLength = 0.12,
  arcStraightness = 0.86,
  minCurveDistance = 0.035
} = {}) {
  const valid = Array.isArray(samples)
    ? samples.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    : [];

  if (valid.length < minSamples) {
    return Object.freeze({
      pulseStyle: 'NEUTRAL',
      confidence: 0,
      straightness: 0,
      pathLength: 0,
      directionX: 0,
      directionY: 0
    });
  }

  let pathLength = 0;
  for (let index = 1; index < valid.length; index += 1) {
    pathLength += distance(valid[index - 1], valid[index]);
  }

  const first = valid[0];
  const last = valid[valid.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const displacement = Math.hypot(dx, dy);

  if (pathLength < minPathLength || displacement < minPathLength * 0.35) {
    return Object.freeze({
      pulseStyle: 'NEUTRAL',
      confidence: 0,
      straightness: pathLength > 0 ? displacement / pathLength : 0,
      pathLength,
      directionX: 0,
      directionY: 0
    });
  }

  const straightness = clamp(displacement / Math.max(pathLength, 1e-6), 0, 1);
  const curveDistance = Math.max(0, pathLength - displacement);
  const isArc = straightness <= arcStraightness && curveDistance >= minCurveDistance;
  const pulseStyle = isArc ? 'ARC' : 'LINEAR';

  const confidence = isArc
    ? clamp((arcStraightness - straightness) / Math.max(0.01, arcStraightness - 0.45), 0, 1)
      * clamp(curveDistance / Math.max(minCurveDistance, 0.12), 0, 1)
    : clamp(straightness, 0, 1);

  return Object.freeze({
    pulseStyle,
    confidence: Number(confidence.toFixed(3)),
    straightness: Number(straightness.toFixed(3)),
    pathLength: Number(pathLength.toFixed(3)),
    directionX: Number((dx / displacement).toFixed(3)),
    directionY: Number((dy / displacement).toFixed(3))
  });
}
