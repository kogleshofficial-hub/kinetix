import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyChallenge } from '../src/engine/challenge/KinetixDailyChallenge.js';
import { DailyRiftRecords } from '../src/engine/challenge/DailyRiftRecords.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

test('stores a local daily result and returns a personal best', () => {
  const storage = new MemoryStorage();
  const records = new DailyRiftRecords({ storage });
  const challenge = createDailyChallenge('2026-11-03');

  const result = records.record(challenge, {
    status: 'won',
    bestCombo: 8,
    damage: 170,
    accuracy: 92
  });

  assert.equal(result.persisted, true);
  assert.equal(result.isPersonalBest, true);
  assert.equal(result.record.attempts, 1);
  assert.equal(result.record.wins, 1);
  assert.equal(result.record.best.cleared, true);
  assert.equal(records.get(challenge.date).best.combo, 8);
});

test('keeps the best run across attempts and counts wins', () => {
  const storage = new MemoryStorage();
  const challenge = createDailyChallenge('2026-11-03');
  const records = new DailyRiftRecords({ storage });

  records.record(challenge, { status: 'lost', bestCombo: 12, damage: 80, accuracy: 50 });
  const improved = records.record(challenge, { status: 'won', bestCombo: 4, damage: 100, accuracy: 70 });
  const lower = records.record(challenge, { status: 'lost', bestCombo: 2, damage: 20, accuracy: 20 });

  assert.equal(improved.isPersonalBest, true);
  assert.equal(lower.isPersonalBest, false);
  assert.equal(lower.record.attempts, 3);
  assert.equal(lower.record.wins, 1);
  assert.equal(lower.record.best.cleared, true);
  assert.equal(lower.record.best.combo, 4);
});

test('records are restored from local storage and bounded by date count', () => {
  const storage = new MemoryStorage();
  const records = new DailyRiftRecords({ storage, maxDays: 2 });
  for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) {
    records.record(createDailyChallenge(date), { status: 'time-up', bestCombo: 1, damage: 5, accuracy: 10 });
  }

  const restored = new DailyRiftRecords({ storage, maxDays: 2 });
  assert.deepEqual(restored.list().map((item) => item.date), ['2026-11-03', '2026-11-02']);
  assert.equal(restored.get('2026-11-01'), null);
});

test('local records reject mismatched or invalid challenge/result data', () => {
  const records = new DailyRiftRecords({ storage: new MemoryStorage() });
  const challenge = createDailyChallenge('2026-11-03');

  assert.throws(() => records.record({ ...challenge, code: 'INVALID' }, { status: 'won' }), /valid KINETIX Daily Rift/i);
  assert.throws(() => records.record(challenge, { status: 'unknown' }), /must be won, lost, or time-up/i);
});

test('storage failures do not crash a local match', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('storage full'); }
  };
  const records = new DailyRiftRecords({ storage });
  const challenge = createDailyChallenge('2026-11-03');
  const result = records.record(challenge, { status: 'won', bestCombo: 5, damage: 100, accuracy: 80 });

  assert.equal(result.persisted, false);
  assert.equal(records.get(challenge.date).best.combo, 5);
});
