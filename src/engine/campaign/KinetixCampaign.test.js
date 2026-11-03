import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_RANKS,
  KINETIX_MISSIONS,
  KINETIX_WORLDS,
  calculateMissionStars,
  getMissionById,
  rankForCampaign
} from './KinetixCampaign.js';

test('campaign is a sequential twelve-mission journey across three distinct worlds', () => {
  assert.equal(KINETIX_MISSIONS.length, 12);
  assert.deepEqual([...new Set(KINETIX_MISSIONS.map((mission) => mission.world))], ['verdant', 'drowned', 'ashen']);
  assert.equal(KINETIX_WORLDS.verdant.art, '/worlds/verdant-reach.svg');
  assert.equal(getMissionById(1).title, 'The Broken Causeway');
  assert.equal(getMissionById(12).threat, 'FINAL BOSS');
  assert.equal(getMissionById(13), null);
});

test('rank promotions require both rank XP and completed campaign levels', () => {
  assert.equal(rankForCampaign(999, 0).id, 'recruit');
  assert.equal(rankForCampaign(999, 1).id, 'initiate');
  assert.equal(rankForCampaign(80, 2).id, 'adept');
  assert.equal(rankForCampaign(999, 12).id, 'sovereign');
  assert.equal(CAMPAIGN_RANKS.length, 7);
});

test('mission stars reward survival and clean execution without making a clear impossible', () => {
  assert.equal(calculateMissionStars({ healthRatio: 0.1, accuracy: 10, bestCombo: 1 }), 1);
  assert.equal(calculateMissionStars({ healthRatio: 0.5, accuracy: 10, bestCombo: 1 }), 2);
  assert.equal(calculateMissionStars({ healthRatio: 0.8, accuracy: 70, bestCombo: 5 }), 3);
});
