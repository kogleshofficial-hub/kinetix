import test from 'node:test';
import assert from 'node:assert/strict';
import { KinetixProgressionVault } from './KinetixProgressionVault.js';

function memoryAdapter(initial = null) {
  let value = initial;
  return {
    async read() { return value; },
    async write(next) { value = structuredClone(next); return { persisted: true }; },
    get value() { return structuredClone(value); }
  };
}

test('campaign clear unlocks exactly the next mission and awards first-clear rewards', async () => {
  const adapter = memoryAdapter();
  const vault = new KinetixProgressionVault({ adapter });
  await vault.load();

  const result = await vault.awardMissionClear(1, 3);
  assert.equal(result.ok, true);
  assert.equal(result.firstClear, true);
  assert.equal(result.reward.kinets, 26);
  assert.equal(result.reward.xp, 37);
  assert.equal(result.profile.campaign.highestUnlocked, 2);
  assert.deepEqual(result.profile.campaign.clearedMissions, [1]);
  assert.equal(result.rankAfter.id, 'initiate');
  assert.equal(result.rankedUp, true);
});

test('replaying a cleared mission cannot farm rank XP or Kinets but can improve stars', async () => {
  const adapter = memoryAdapter();
  const vault = new KinetixProgressionVault({ adapter });
  await vault.load();
  await vault.awardMissionClear(1, 1);

  const replay = await vault.awardMissionClear(1, 3);
  assert.equal(replay.firstClear, false);
  assert.equal(replay.reward.kinets, 0);
  assert.equal(replay.reward.xp, 0);
  assert.equal(replay.improvedBest, true);
  assert.equal(replay.stars, 3);
  assert.deepEqual(replay.profile.campaign.clearedMissions, [1]);
});

test('a locked mission cannot be cleared out of order', async () => {
  const vault = new KinetixProgressionVault({ adapter: memoryAdapter() });
  await vault.load();
  const result = await vault.awardMissionClear(4, 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mission-locked');
  assert.equal(result.profile.campaign.highestUnlocked, 1);
});

test('practice victories grant a small wallet reward but never rank XP', async () => {
  const vault = new KinetixProgressionVault({ adapter: memoryAdapter() });
  await vault.load();
  const result = await vault.awardPracticeVictory();
  assert.equal(result.reward.kinets, 8);
  assert.equal(result.reward.xp, 0);
  assert.equal(result.profile.rankXp, 0);
  assert.equal(result.profile.campaign.clearedMissions.length, 0);
});

test('legacy schema v2 profiles retain their wallet and cosmetics during migration', async () => {
  const legacy = {
    username: 'Old Pilot',
    kinets: 145,
    rankXp: 220,
    soloWins: 6,
    soloLosses: 2,
    ownedCharacters: ['starter', 'elite'],
    equippedCharacter: 'elite',
    ownedBanners: ['classic', 'unstoppable'],
    equippedBanner: 'unstoppable',
    schemaVersion: 2
  };
  const adapter = memoryAdapter(legacy);
  const vault = new KinetixProgressionVault({ adapter });
  const migrated = await vault.load();

  assert.equal(migrated.kinets, 145);
  assert.equal(migrated.equippedCharacter, 'elite');
  assert.equal(migrated.equippedBanner, 'unstoppable');
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.campaign.clearedMissions, []);
  assert.equal(KinetixProgressionVault.rankForCampaign(migrated.rankXp, 0).id, 'recruit');
});
