const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PATTERN = /^[0-9A-F]{8}$/;
const RESULTS = new Set(['won', 'lost', 'time-up']);

function validDate(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function integer(value, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function normalizeBest(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    cleared: Boolean(value.cleared),
    combo: integer(value.combo, 999),
    damage: integer(value.damage, 99999),
    accuracy: integer(value.accuracy, 100)
  });
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || !validDate(value.date)
    || typeof value.code !== 'string' || !CODE_PATTERN.test(value.code)
    || !RESULTS.has(value.lastResult)) return null;

  const best = normalizeBest(value.best);
  if (!best) return null;

  return Object.freeze({
    date: value.date,
    code: value.code,
    attempts: Math.max(1, integer(value.attempts, 9999)),
    wins: integer(value.wins, 9999),
    lastResult: value.lastResult,
    best,
    lastPlayedAt: integer(value.lastPlayedAt, Number.MAX_SAFE_INTEGER)
  });
}

function freezeCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])));
}

function isBetter(candidate, current) {
  if (candidate.cleared !== current.cleared) return candidate.cleared;
  if (candidate.combo !== current.combo) return candidate.combo > current.combo;
  if (candidate.damage !== current.damage) return candidate.damage > current.damage;
  return candidate.accuracy > current.accuracy;
}

function defaultStorage() {
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

/**
 * Personal Daily Rift history. This is intentionally local and unverified:
 * it is not an authoritative leaderboard or a source of rewards/currency.
 */
export class DailyRiftRecords {
  constructor({ storage = defaultStorage(), key = 'kinetix-daily-rift-records-v1', maxDays = 31 } = {}) {
    this.storage = storage;
    this.key = key;
    this.maxDays = Math.max(1, Math.min(90, Math.floor(maxDays) || 31));
    this.records = new Map();
    this._load();
  }

  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.records)) return;

      for (const candidate of parsed.records) {
        const record = normalizeRecord(candidate);
        if (record) this.records.set(record.date, record);
      }
      this._prune();
    } catch {
      this.records.clear();
    }
  }

  _prune() {
    const recent = [...this.records.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, this.maxDays);
    this.records = new Map(recent.map((record) => [record.date, record]));
  }

  _persist() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify({
        version: 1,
        records: [...this.records.values()]
      }));
      return true;
    } catch {
      return false;
    }
  }

  get(date) {
    const record = this.records.get(date);
    return record ? freezeCopy(record) : null;
  }

  list() {
    return freezeCopy([...this.records.values()].sort((left, right) => right.date.localeCompare(left.date)));
  }

  record(challenge, result) {
    if (!challenge || !validDate(challenge.date) || challenge.ruleset !== 1
      || typeof challenge.code !== 'string' || !CODE_PATTERN.test(challenge.code)) {
      throw new TypeError('A valid KINETIX Daily Rift challenge is required.');
    }
    if (!RESULTS.has(result?.status)) throw new RangeError('Daily Rift result must be won, lost, or time-up.');

    const previous = this.records.get(challenge.date);
    const sameChallenge = previous?.code === challenge.code;
    const previousBest = sameChallenge ? previous.best : null;
    const candidate = Object.freeze({
      cleared: result.status === 'won',
      combo: integer(result.bestCombo, 999),
      damage: integer(result.damage, 99999),
      accuracy: integer(result.accuracy, 100)
    });
    const isPersonalBest = !previousBest || isBetter(candidate, previousBest);
    const next = Object.freeze({
      date: challenge.date,
      code: challenge.code,
      attempts: (sameChallenge ? previous.attempts : 0) + 1,
      wins: (sameChallenge ? previous.wins : 0) + (candidate.cleared ? 1 : 0),
      lastResult: result.status,
      best: isPersonalBest ? candidate : previousBest,
      lastPlayedAt: Date.now()
    });

    this.records.set(next.date, next);
    this._prune();
    const persisted = this._persist();
    return Object.freeze({
      record: freezeCopy(next),
      isPersonalBest,
      persisted
    });
  }
}
