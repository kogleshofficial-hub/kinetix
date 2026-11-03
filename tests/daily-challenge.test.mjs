import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyChallenge, selectDailyLane } from '../src/engine/challenge/KinetixDailyChallenge.js';

test('daily Rift seed is deterministic for the same UTC date', () => {
  const first = createDailyChallenge('2026-11-03');
  const second = createDailyChallenge('2026-11-03');

  assert.deepEqual(first, second);
  assert.equal(first.date, '2026-11-03');
  assert.equal(first.code.length, 8);
  assert.equal(first.ruleset, 1);
  assert.equal(Object.isFrozen(first), true);
});

test('different UTC dates produce different challenge seeds', () => {
  const first = createDailyChallenge('2026-11-03');
  const next = createDailyChallenge('2026-11-04');

  assert.notEqual(first.seed, next.seed);
  assert.notEqual(first.code, next.code);
});

test('Date input is normalized to UTC day boundaries', () => {
  const challenge = createDailyChallenge(new Date('2026-11-03T23:59:59.000Z'));

  assert.equal(challenge.date, '2026-11-03');
});

test('invalid calendar dates are rejected', () => {
  assert.throws(() => createDailyChallenge('2026-02-30'), /real calendar date/i);
  assert.throws(() => createDailyChallenge('not-a-date'), /YYYY-MM-DD/i);
  assert.throws(() => createDailyChallenge(new Date('invalid')), /YYYY-MM-DD/i);
});

test('daily lane selector never repeats the previous lane', () => {
  for (const previous of [-1, 0, 1]) {
    for (const sample of [0, 0.25, 0.5, 0.999]) {
      const next = selectDailyLane(() => sample, previous);
      assert.ok([-1, 0, 1].includes(next));
      assert.notEqual(next, previous);
    }
  }
});

test('daily lane selector is reproducible for the same random stream', () => {
  const samples = [0.1, 0.7, 0.4, 0.99, 0.2];
  const generate = () => {
    let previous = 0;
    let index = 0;
    return samples.map((sample) => {
      previous = selectDailyLane(() => sample, previous);
      index += 1;
      return previous;
    });
  };
  assert.deepEqual(generate(), generate());
});

test('daily lane selector rejects invalid random samples and previous lanes', () => {
  assert.throws(() => selectDailyLane(() => 1, 0), /range \[0, 1\)/i);
  assert.throws(() => selectDailyLane(() => -0.1, 0), /range \[0, 1\)/i);
  assert.throws(() => selectDailyLane(() => 0.2, 4), /previous lane/i);
});
