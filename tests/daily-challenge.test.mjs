import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyChallenge } from '../src/engine/challenge/KinetixDailyChallenge.js';

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
