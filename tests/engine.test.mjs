import test from 'node:test';
import assert from 'node:assert/strict';
import { KinetixEventBus } from '../src/engine/EventBus.js';
import { KinetixCombatDirector } from '../src/engine/combat/KinetixCombatDirector.js';
import { KinetixProgressionVault, LocalProfileAdapter, RANK_TIERS } from '../src/engine/progression/KinetixProgressionVault.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

test('event bus supports once listeners and immutable payloads', () => {
  const bus = new KinetixEventBus();
  let calls = 0;
  bus.once('sample', (payload) => {
    calls += 1;
    assert.equal(Object.isFrozen(payload), true);
    assert.equal(payload.value, 7);
  });
  bus.emit('sample', { value: 7 });
  bus.emit('sample', { value: 8 });
  assert.equal(calls, 1);
  assert.equal(bus.listenerCount('sample'), 0);
});

test('combat director advances fixed 60 Hz ticks independently of render cadence', () => {
  let ticks = 0;
  const director = new KinetixCombatDirector({
    autoStart: false,
    tickRate: 60,
    onTick: () => { ticks += 1; },
    getSnapshot: () => ({ status: 'playing', phase: 'idle', hp: 100, mana: 20 })
  });
  director.beginMatch({ seed: 123 });
  for (let frame = 0; frame < 144; frame += 1) director.advance(1 / 144);
  assert.equal(ticks, 60);
  assert.equal(director.tick, 60);
  assert.equal(director.state, 'ACTIVE_COMBAT');
  director.endMatch('test');
  assert.equal(director.state, 'MATCH_OVER');
});

test('combat director rejects invalid lifecycle actions and queues valid commands for the next tick', () => {
  const commands = [];
  const director = new KinetixCombatDirector({
    autoStart: false,
    onCommand: (command) => commands.push(command.kind),
    getSnapshot: () => ({ status: 'playing', phase: 'idle', hp: 100 })
  });
  assert.equal(director.enqueueAction('PULSE'), false);
  assert.equal(director.transition('ACTIVE_COMBAT'), false);
  director.beginMatch();
  assert.equal(director.enqueueAction('PULSE', 1, 'test'), true);
  assert.equal(director.enqueueAction('GUARD_RELEASE', 1, 'test'), true);
  director.advance(1 / 60);
  assert.deepEqual(commands, ['PULSE', 'GUARD_RELEASE']);
  assert.equal(Object.isFrozen(director.lastSnapshot), true);
  director.endMatch('test');
});

test('combat director has deterministic seeded random output', () => {
  const one = new KinetixCombatDirector({ autoStart: false });
  const two = new KinetixCombatDirector({ autoStart: false });
  one.beginMatch({ seed: 9876 });
  two.beginMatch({ seed: 9876 });
  assert.deepEqual(
    Array.from({ length: 8 }, () => one.random()),
    Array.from({ length: 8 }, () => two.random())
  );
  one.endMatch(); two.endMatch();
});

test('progression store serializes purchases and never overspends a local wallet', async () => {
  const storage = new MemoryStorage();
  const adapter = new LocalProfileAdapter({ storage, key: 'test-profile', legacyKey: 'legacy-profile' });
  await adapter.write({
    username: 'Test Pilot', kinets: 400, rankXp: 0, soloWins: 0, soloLosses: 0,
    ownedCharacters: ['starter'], equippedCharacter: 'starter',
    ownedBanners: ['classic'], equippedBanner: 'classic'
  });
  const vault = new KinetixProgressionVault({ adapter });
  await vault.load();

  const [pulseKnight, voidStriker] = await Promise.all([
    vault.purchaseCharacter('elite'),
    vault.purchaseCharacter('epic')
  ]);
  assert.equal(pulseKnight.ok, true);
  assert.equal(voidStriker.ok, false);
  assert.equal(voidStriker.reason, 'insufficient-funds');
  assert.equal(vault.peek().kinets, 280);
  assert.deepEqual(vault.peek().ownedCharacters, ['starter', 'elite']);
  assert.equal(Object.isFrozen(pulseKnight.receipt), true);
  assert.equal(pulseKnight.receipt.trust, 'client-local-unverified');
  assert.equal(pulseKnight.receipt.signature, null);
});

test('progression reward table and seven rank thresholds are stable', async () => {
  const storage = new MemoryStorage();
  const adapter = new LocalProfileAdapter({ storage, key: 'rewards', legacyKey: 'legacy' });
  const vault = new KinetixProgressionVault({ adapter });
  await vault.load();

  assert.deepEqual(KinetixProgressionVault.rewardFor('easy'), { kinets: 15, xp: 10 });
  assert.deepEqual(KinetixProgressionVault.rewardFor('normal'), { kinets: 20, xp: 20 });
  assert.deepEqual(KinetixProgressionVault.rewardFor('hard'), { kinets: 30, xp: 35 });
  assert.equal(RANK_TIERS.length, 7);
  const reward = await vault.awardVictory('hard');
  assert.equal(reward.profile.kinets, 30);
  assert.equal(reward.profile.rankXp, 35);
  assert.equal(reward.profile.soloWins, 1);
  assert.equal(reward.rankedUp, false);
});

test('legacy JSON profile migrates into the wrapped v2 local key', async () => {
  const storage = new MemoryStorage();
  storage.setItem('legacy-profile', JSON.stringify({
    username: 'Legacy Pilot', kinets: 41, ownedCharacters: ['starter'],
    equippedCharacter: 'starter', soloWins: 2, rankXp: 25,
    ownedBanners: ['classic'], equippedBanner: 'classic'
  }));
  const adapter = new LocalProfileAdapter({ storage, key: 'v2-profile', legacyKey: 'legacy-profile' });
  const vault = new KinetixProgressionVault({ adapter });
  const profile = await vault.load();
  assert.equal(profile.username, 'Legacy Pilot');
  assert.equal(profile.kinets, 41);
  assert.ok(storage.getItem('v2-profile'));
  assert.notEqual(storage.getItem('v2-profile'), JSON.stringify(profile));
});


test('a failed local write does not report a purchase or mutate the in-memory wallet', async () => {
  const adapter = {
    read: async () => ({
      username: 'Write Failure',
      kinets: 200,
      rankXp: 0,
      soloWins: 0,
      soloLosses: 0,
      ownedCharacters: ['starter'],
      equippedCharacter: 'starter',
      ownedBanners: ['classic'],
      equippedBanner: 'classic'
    }),
    write: async () => ({ persisted: false, reason: 'quota-exceeded' })
  };
  const vault = new KinetixProgressionVault({ adapter });
  await vault.load();
  await assert.rejects(vault.purchaseCharacter('elite'), /persistence failed/i);
  assert.equal(vault.peek().kinets, 200);
  assert.deepEqual(vault.peek().ownedCharacters, ['starter']);
});

test('unknown inherited catalog properties cannot be purchased', async () => {
  const vault = new KinetixProgressionVault();
  await vault.load();
  await assert.rejects(vault.purchaseCharacter('constructor'), /unknown character/i);
  await assert.rejects(vault.purchaseBanner('toString'), /unknown combo banner/i);
});
