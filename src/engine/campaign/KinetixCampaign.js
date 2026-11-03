export const CAMPAIGN_RANKS = Object.freeze([
  Object.freeze({ id: 'recruit', name: 'Rift Recruit', xp: 0, clears: 0 }),
  Object.freeze({ id: 'initiate', name: 'Kinetic Initiate', xp: 35, clears: 1 }),
  Object.freeze({ id: 'adept', name: 'Pulse Adept', xp: 80, clears: 2 }),
  Object.freeze({ id: 'hunter', name: 'Rift Hunter', xp: 150, clears: 4 }),
  Object.freeze({ id: 'vanguard', name: 'Void Vanguard', xp: 235, clears: 6 }),
  Object.freeze({ id: 'champion', name: 'Rift Champion', xp: 335, clears: 9 }),
  Object.freeze({ id: 'sovereign', name: 'Kinetix Sovereign', xp: 450, clears: 12 })
]);

export const KINETIX_WORLDS = Object.freeze({
  verdant: Object.freeze({
    id: 'verdant',
    name: 'THE VERDANT REACH',
    subtitle: 'Where the old world disappeared beneath the wild.',
    art: '/worlds/verdant-reach.svg',
    palette: Object.freeze({ horizon: '#819d83', floor: '#25352e', fog: '#bdcdb2', accent: '#c8ff3d' })
  }),
  drowned: Object.freeze({
    id: 'drowned',
    name: 'THE SUNKEN DISTRICT',
    subtitle: 'A drowned city still carrying a signal below the waterline.',
    art: '/worlds/sunken-district.svg',
    palette: Object.freeze({ horizon: '#83999b', floor: '#243638', fog: '#b9d0ca', accent: '#79d8d0' })
  }),
  ashen: Object.freeze({
    id: 'ashen',
    name: 'THE ASHEN CITADEL',
    subtitle: 'A fortress at the edge of the last known breach.',
    art: '/worlds/ashen-citadel.svg',
    palette: Object.freeze({ horizon: '#a18c75', floor: '#382c29', fog: '#d1bda1', accent: '#ffc16d' })
  })
});

export const KINETIX_MISSIONS = Object.freeze([
  Object.freeze({ id: 1, chapter: 1, chapterName: 'THE VERDANT REACH', world: 'verdant', title: 'The Broken Causeway', location: 'NORTH BANK / OLD WORLD', enemyName: 'MIRE SENTINEL', threat: 'SCOUT', difficulty: 'easy', enemyHp: 100, enemyDamage: 10, time: 82, firstWait: 1.2, description: 'A damaged signal has awakened something beneath the abandoned crossing. Learn to read its warning and take the first step into the Reach.', objective: 'SURVIVE THE FIRST CONTACT', rewardBase: 18 }),
  Object.freeze({ id: 2, chapter: 1, chapterName: 'THE VERDANT REACH', world: 'verdant', title: 'Signal in the Canopy', location: 'OVERGROWN RELAY / EAST RIDGE', enemyName: 'CANOPY STALKER', threat: 'STALKER', difficulty: 'easy', enemyHp: 125, enemyDamage: 12, time: 80, firstWait: 1.05, description: 'A relay tower is broadcasting from inside the forest. The signal is not human. Reach the tower and silence its guardian.', objective: 'BREAK THE RELAY GUARD', rewardBase: 20 }),
  Object.freeze({ id: 3, chapter: 1, chapterName: 'THE VERDANT REACH', world: 'verdant', title: 'The Watchtower Echo', location: 'OLD WATCH / HIGH GROUND', enemyName: 'RUIN WATCHER', threat: 'ELITE', difficulty: 'normal', enemyHp: 155, enemyDamage: 18, time: 78, firstWait: 0.9, description: 'The watchtower is still standing, but its defence system has learned your movement. Patience matters more than speed.', objective: 'CLEAR THE WATCHTOWER', rewardBase: 22 }),
  Object.freeze({ id: 4, chapter: 1, chapterName: 'THE VERDANT REACH', world: 'verdant', title: 'Rootbound Warden', location: 'THE OLD BRIDGE / BOSS SITE', enemyName: 'ROOTBOUND WARDEN', threat: 'BOSS', difficulty: 'normal', enemyHp: 190, enemyDamage: 22, time: 76, firstWait: 0.78, description: 'The breach has grown around an ancient machine. This is the first true test of your timing. Close the Reach.', objective: 'DEFEAT THE CHAPTER WARDEN', rewardBase: 28 }),
  Object.freeze({ id: 5, chapter: 2, chapterName: 'THE SUNKEN DISTRICT', world: 'drowned', title: 'Floodline', location: 'LOWER CITY / FLOOD GATE', enemyName: 'TIDE HUNTER', threat: 'SCOUT', difficulty: 'normal', enemyHp: 215, enemyDamage: 24, time: 74, firstWait: 0.72, description: 'The route descends into a drowned city. A moving signal is crossing the flood gates. Follow it before the current turns.', objective: 'SECURE THE FLOOD GATE', rewardBase: 30 }),
  Object.freeze({ id: 6, chapter: 2, chapterName: 'THE SUNKEN DISTRICT', world: 'drowned', title: 'The Quiet Station', location: 'METRO TERMINAL / PLATFORM 03', enemyName: 'SIGNAL KEEPER', threat: 'ELITE', difficulty: 'normal', enemyHp: 245, enemyDamage: 26, time: 72, firstWait: 0.65, description: 'A station beneath the city still has power. Something is guarding the last train control room.', objective: 'RESTORE THE STATION SIGNAL', rewardBase: 32 }),
  Object.freeze({ id: 7, chapter: 2, chapterName: 'THE SUNKEN DISTRICT', world: 'drowned', title: 'Glasswater Crossing', location: 'RIVERFRONT / COLLAPSED HIGHWAY', enemyName: 'GLASSWATER BRUTE', threat: 'HEAVY', difficulty: 'normal', enemyHp: 280, enemyDamage: 28, time: 70, firstWait: 0.58, description: 'The bridge is split in two. The only safe route runs through a hostile patrol. Your counters must be clean.', objective: 'HOLD THE CROSSING', rewardBase: 34 }),
  Object.freeze({ id: 8, chapter: 2, chapterName: 'THE SUNKEN DISTRICT', world: 'drowned', title: 'The Drowned Warden', location: 'SUBMERGED ARCHIVE / BOSS SITE', enemyName: 'DROWNED WARDEN', threat: 'BOSS', difficulty: 'hard', enemyHp: 315, enemyDamage: 32, time: 70, firstWait: 0.5, description: 'The archive opens beneath the water. The signal has a source, and it is waiting for you.', objective: 'DEFEAT THE CHAPTER WARDEN', rewardBase: 40 }),
  Object.freeze({ id: 9, chapter: 3, chapterName: 'THE ASHEN CITADEL', world: 'ashen', title: 'Ashfall Gate', location: 'CITADEL OUTER WALL / WEST', enemyName: 'ASHEN SENTINEL', threat: 'VETERAN', difficulty: 'normal', enemyHp: 325, enemyDamage: 30, time: 68, firstWait: 0.5, description: 'Beyond the city, an old stone fortress rises above the ash. Its outer gate has not opened in years.', objective: 'BREACH THE OUTER GATE', rewardBase: 42 }),
  Object.freeze({ id: 10, chapter: 3, chapterName: 'THE ASHEN CITADEL', world: 'ashen', title: 'The Furnace Keep', location: 'LOWER FOUNDRY / INNER COURT', enemyName: 'FURNACE KNIGHT', threat: 'ELITE', difficulty: 'hard', enemyHp: 350, enemyDamage: 34, time: 66, firstWait: 0.42, description: 'The keep is powered by a failing reactor. Its guardian is faster than anything you have faced.', objective: 'SHUT DOWN THE FURNACE', rewardBase: 45 }),
  Object.freeze({ id: 11, chapter: 3, chapterName: 'THE ASHEN CITADEL', world: 'ashen', title: 'The Last Signal', location: 'HIGH CITADEL / SIGNAL SPIRE', enemyName: 'VOID EXECUTIONER', threat: 'CHAMPION', difficulty: 'hard', enemyHp: 385, enemyDamage: 40, time: 64, firstWait: 0.36, description: 'The final transmission reveals why the rifts opened. One guardian remains between you and the source.', objective: 'REACH THE SIGNAL SPIRE', rewardBase: 48 }),
  Object.freeze({ id: 12, chapter: 3, chapterName: 'THE ASHEN CITADEL', world: 'ashen', title: 'Kinetix: The First Dawn', location: 'THE RIFT HEART / FINAL ENCOUNTER', enemyName: 'THE RIFT SOVEREIGN', threat: 'FINAL BOSS', difficulty: 'hard', enemyHp: 420, enemyDamage: 48, time: 64, firstWait: 0.3, description: 'The source is awake. Every lesson from the Reach, the District and the Citadel leads to this moment.', objective: 'CLOSE THE FIRST RIFT', rewardBase: 55 })
]);

export function getMissionById(id) {
  const safeId = Number(id);
  return Number.isInteger(safeId) ? KINETIX_MISSIONS.find((mission) => mission.id === safeId) || null : null;
}

export function rankForCampaign(rankXp = 0, clearedCount = 0) {
  const xp = Math.max(0, Math.floor(Number(rankXp) || 0));
  const clears = Math.max(0, Math.floor(Number(clearedCount) || 0));
  return CAMPAIGN_RANKS.reduce((current, rank) => (
    xp >= rank.xp && clears >= rank.clears ? rank : current
  ), CAMPAIGN_RANKS[0]);
}

export function calculateMissionStars({ healthRatio = 0, accuracy = 0, bestCombo = 0 } = {}) {
  const health = Math.max(0, Math.min(1, Number(healthRatio) || 0));
  const cleanAccuracy = Math.max(0, Math.min(100, Number(accuracy) || 0));
  const combo = Math.max(0, Math.floor(Number(bestCombo) || 0));
  let stars = 1; // A clear always earns the first star.
  if (health >= 0.45 || cleanAccuracy >= 60) stars += 1;
  if (health >= 0.75 && combo >= 4) stars += 1;
  return stars;
}
