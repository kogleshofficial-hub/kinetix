const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Creates a UTC-date challenge seed. The same date and ruleset always produce
 * the same seed on every device. This is a local deterministic challenge,
 * not a server-issued competition token or a leaderboard verification proof.
 */
export function createDailyChallenge(date = new Date()) {
  const day = date instanceof Date
    ? (Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10))
    : String(date);

  if (!DAY_PATTERN.test(day)) {
    throw new TypeError('Daily challenge date must be a valid UTC date in YYYY-MM-DD form.');
  }

  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (check.toISOString().slice(0, 10) !== day) {
    throw new RangeError('Daily challenge date is not a real calendar date.');
  }

  // FNV-1a 32-bit, fixed input namespace so future rulesets can version seeds.
  const input = 'KINETIX_DAILY_RIFT_V1:' + day;
  let seed = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  if (seed === 0) seed = 0x4b494e45;

  return Object.freeze({
    date: day,
    seed,
    code: seed.toString(16).toUpperCase().padStart(8, '0'),
    ruleset: 1,
    difficulty: 'player-selected'
  });
}

/**
 * Picks a new lane without repeating the immediately previous lane.
 * The injected RNG keeps encounter generation deterministic and testable.
 */
export function selectDailyLane(random, previousLane = 0) {
  if (typeof random !== 'function') {
    throw new TypeError('A deterministic random function is required.');
  }
  if (![-1, 0, 1].includes(previousLane)) {
    throw new RangeError('Previous lane must be -1, 0, or 1.');
  }
  const candidates = [-1, 0, 1].filter((lane) => lane !== previousLane);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Random sample must be in the range [0, 1).');
  }
  return candidates[Math.floor(sample * candidates.length)];
}
