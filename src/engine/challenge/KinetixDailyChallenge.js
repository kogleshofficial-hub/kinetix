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
