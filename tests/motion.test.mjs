import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPulseTrajectory } from '../src/engine/motion/KinetixMotionMath.js';

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
  for (const value of Object.values(result)) {
    assert.ok(Number.isFinite(value));
  }
});
