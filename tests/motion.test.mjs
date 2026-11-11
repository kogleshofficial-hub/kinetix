import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPulseTrajectory, detectRaisedHand, measureForwardReach, measureForwardSpeed } from '../src/engine/motion/KinetixMotionMath.js';
import { KinetixCombatDirector } from '../src/engine/combat/KinetixCombatDirector.js';

const MAX_SENSITIVITY_PROFILE = Object.freeze({ raiseThreshold: 0.18 });
const HIGH_SENSITIVITY_PROFILE = Object.freeze({ raiseThreshold: 0.04 });

test('MAX accepts a small, controlled raised-hand posture', () => {
  const result = detectRaisedHand({
    wristY: 0.27,
    elbowY: 0.32,
    shoulderY: 0.25,
    shoulderWidth: 0.2
  }, MAX_SENSITIVITY_PROFILE);
  assert.equal(result.detected, true);
});

test('HIGH requires a clearer hand raise than MAX', () => {
  const slightlyRaised = {
    wristY: 0.27,
    elbowY: 0.32,
    shoulderY: 0.25,
    shoulderWidth: 0.2
  };
  assert.equal(detectRaisedHand(slightlyRaised, MAX_SENSITIVITY_PROFILE).detected, true);
  assert.equal(detectRaisedHand(slightlyRaised, HIGH_SENSITIVITY_PROFILE).detected, false);

  const clearlyRaised = { ...slightlyRaised, wristY: 0.252 };
  assert.equal(detectRaisedHand(clearlyRaised, HIGH_SENSITIVITY_PROFILE).detected, true);
});

test('forward reach without a raised hand does not trigger the camera control', () => {
  const result = detectRaisedHand({
    wristY: 0.36,
    elbowY: 0.34,
    shoulderY: 0.25,
    shoulderWidth: 0.2
  }, MAX_SENSITIVITY_PROFILE);
  assert.equal(result.detected, false);
});

test('raised-hand detector safely rejects missing or invalid landmarks', () => {
  assert.equal(detectRaisedHand({ wristY: NaN, elbowY: 0.2, shoulderY: 0.25, shoulderWidth: 0.2 }, MAX_SENSITIVITY_PROFILE).detected, false);
  assert.equal(detectRaisedHand({ wristY: 0.2, elbowY: 0.2, shoulderY: 0.25, shoulderWidth: 0 }, MAX_SENSITIVITY_PROFILE).detected, false);
});

test('measures forward reach relative to shoulder movement', () => {
  const reach = measureForwardReach({ baselineWristZ: -0.2, wristZ: -0.3, baselineShoulderZ: -0.1, shoulderZ: -0.15, shoulderWidth: 0.4 });
  assert.equal(Number(reach.toFixed(3)), 0.125);
  const speed = measureForwardSpeed({ previousWristZ: -0.2, wristZ: -0.3, previousShoulderZ: -0.1, shoulderZ: -0.15, shoulderWidth: 0.4, seconds: 0.5 });
  assert.equal(Number(speed.toFixed(3)), 0.25);
});

test('rejects invalid depth measurements', () => {
  assert.equal(measureForwardReach({ baselineWristZ: NaN, wristZ: 0, shoulderWidth: 0.4 }), 0);
  assert.equal(measureForwardSpeed({ previousWristZ: 0, wristZ: 1, shoulderWidth: 0.4, seconds: 0 }), 0);
});

test('classifies a clear near-straight movement as LINEAR', () => {
  const result = classifyPulseTrajectory([
    { x: 0, y: 0 },
    { x: 0.01, y: -0.05 },
    { x: 0.01, y: -0.11 },
    { x: 0.02, y: -0.18 },
    { x: 0.02, y: -0.25 }
  ]);

  assert.equal(result.pulseStyle, 'LINEAR');
  assert.ok(result.confidence > 0.8);
  assert.ok(result.directionY < 0);
});

test('classifies a sufficiently curved movement as ARC', () => {
  const result = classifyPulseTrajectory([
    { x: -0.10, y: 0 },
    { x: 0, y: -0.12 },
    { x: 0.12, y: -0.15 },
    { x: 0.22, y: -0.07 },
    { x: 0.26, y: 0 }
  ]);

  assert.equal(result.pulseStyle, 'ARC');
  assert.ok(result.pathLength > 0.12);
  assert.ok(result.confidence > 0);
});

test('returns NEUTRAL for insufficient or tiny movement', () => {
  assert.equal(classifyPulseTrajectory([]).pulseStyle, 'NEUTRAL');
  assert.equal(classifyPulseTrajectory([{ x: 0, y: 0 }, { x: 0.01, y: 0 }]).pulseStyle, 'NEUTRAL');

  const tiny = classifyPulseTrajectory([
    { x: 0, y: 0 },
    { x: 0.01, y: -0.01 },
    { x: 0.02, y: -0.015 },
    { x: 0.025, y: -0.02 }
  ]);
  assert.equal(tiny.pulseStyle, 'NEUTRAL');
  assert.equal(tiny.confidence, 0);
});

test('ignores malformed points and never emits non-finite metrics', () => {
  const result = classifyPulseTrajectory([
    { x: 0, y: 0 },
    null,
    { x: Number.NaN, y: 0 },
    { x: 0, y: -0.08 },
    { x: 0, y: -0.17 },
    { x: 0, y: -0.25 }
  ]);

  assert.equal(result.pulseStyle, 'LINEAR');
  for (const key of ['confidence', 'straightness', 'pathLength', 'directionX', 'directionY']) {
    assert.ok(Number.isFinite(result[key]), key + ' should be finite');
  }
});


test('combat director allowlists trajectory metadata and clamps confidence', () => {
  let received = null;
  const director = new KinetixCombatDirector({
    autoStart: false,
    onCommand: (command) => { received = command; },
    getSnapshot: () => ({ status: 'playing', phase: 'idle', hp: 100 })
  });

  director.beginMatch({ seed: 42 });
  assert.equal(director.enqueueAction('PULSE', 1, 'camera', {
    pulseStyle: 'ARC',
    pulseConfidence: 1.8,
    injectedField: 'must-not-cross-boundary'
  }), true);
  director.advance(1 / 60);

  assert.equal(received.details.pulseStyle, 'ARC');
  assert.equal(received.details.pulseConfidence, 1);
  assert.equal(Object.hasOwn(received.details, 'injectedField'), false);
  assert.equal(Object.isFrozen(received.details), true);
  director.endMatch('test');
});

test('non-pulse actions cannot carry gesture presentation metadata', () => {
  let received = null;
  const director = new KinetixCombatDirector({
    autoStart: false,
    onCommand: (command) => { received = command; },
    getSnapshot: () => ({ status: 'playing', phase: 'idle', hp: 100 })
  });

  director.beginMatch();
  assert.equal(director.enqueueAction('GUARD', 1, 'camera', {
    pulseStyle: 'ARC',
    pulseConfidence: 0.9
  }), true);
  director.advance(1 / 60);

  assert.equal(received.details, null);
  director.endMatch('test');
});
