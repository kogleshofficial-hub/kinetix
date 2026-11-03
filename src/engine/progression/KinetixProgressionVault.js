import { CAMPAIGN_RANKS, getMissionById, rankForCampaign } from '../campaign/KinetixCampaign.js';

const REWARDS = Object.freeze({
  easy: Object.freeze({ kinets: 15, xp: 10 }),
  normal: Object.freeze({ kinets: 20, xp: 20 }),
  hard: Object.freeze({ kinets: 30, xp: 35 })
});

export const RANK_TIERS = CAMPAIGN_RANKS;

const DEFAULT_PROFILE = Object.freeze({
  username: 'Rift Runner',
  kinets: 0,
  rankXp: 0,
  soloWins: 0,
  soloLosses: 0,
  ownedCharacters: Object.freeze(['starter']),
  equippedCharacter: 'starter',
  ownedBanners: Object.freeze(['classic']),
  equippedBanner: 'classic',
  campaign: Object.freeze({ highestUnlocked: 1, clearedMissions: Object.freeze([]), stars: Object.freeze({}) }),
  schemaVersion: 3
});

const validId = /^[a-z0-9_-]{1,48}$/;
const validName = /^[A-Za-z0-9 _-]{3,18}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class LocalProfileAdapter {
  constructor({ storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), key = 'kinetix-profile-v2', legacyKey = 'kinetix-profile-v1' } = {}) {
    this.storage = storage;
    this.key = key;
    this.legacyKey = legacyKey;
  }

  async read() {
    if (!this.storage) return null;
    try {
      const encoded = this.storage.getItem(this.key);
      if (encoded) {
        try { return JSON.parse(decodeBase64(encoded)); }
        catch { return null; }
      }
      const legacy = this.storage.getItem(this.legacyKey);
      if (legacy) {
        try { return JSON.parse(legacy); }
        catch { return null; }
      }
      return null;
    } catch {
      return null;
    }
  }

  async write(profile) {
    if (!this.storage) return { persisted: false, reason: 'storage-unavailable' };
    try {
      this.storage.setItem(this.key, encodeBase64(JSON.stringify(profile)));
      return { persisted: true };
    } catch (error) {
      return { persisted: false, reason: error?.name || 'storage-error' };
    }
  }

  async remove() {
    try { this.storage?.removeItem(this.key); return true; }
    catch { return false; }
  }
}

export class HttpProfileAdapter {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, getHeaders = () => ({}) } = {}) {
    if (!baseUrl) throw new TypeError('baseUrl is required for a remote profile adapter.');
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.getHeaders = getHeaders;
    this.etag = null;
  }

  async read() {
    const response = await this.fetch(this.baseUrl + '/profile', {
      headers: { ...await this.getHeaders(), Accept: 'application/json' }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Profile read failed: HTTP ' + response.status);
    this.etag = response.headers.get('etag');
    return response.json();
  }

  async write(profile) {
    const response = await this.fetch(this.baseUrl + '/profile', {
      method: 'PUT',
      headers: {
        ...await this.getHeaders(),
        'Content-Type': 'application/json',
        ...(this.etag ? { 'If-Match': this.etag } : {})
      },
      body: JSON.stringify(profile)
    });
    if (response.status === 409 || response.status === 412) throw new Error('Profile version conflict; reload before retrying.');
    if (!response.ok) throw new Error('Profile write failed: HTTP ' + response.status);
    this.etag = response.headers.get('etag') || this.etag;
    return response.json().catch(() => ({ persisted: true }));
  }

  async transact(command) {
    const response = await this.fetch(this.baseUrl + '/transactions', {
      method: 'POST',
      headers: {
        ...await this.getHeaders(),
        'Content-Type': 'application/json',
        ...(command.idempotencyKey ? { 'Idempotency-Key': command.idempotencyKey } : {})
      },
      body: JSON.stringify(command)
    });
    if (!response.ok) throw new Error('Remote transaction rejected: HTTP ' + response.status);
    return response.json();
  }
}

export class KinetixProgressionVault {
  constructor({
    adapter = new LocalProfileAdapter(),
    characters = {
      starter: { name: 'Rift Runner', price: 0 },
      elite: { name: 'Pulse Knight', price: 120 },
      epic: { name: 'Void Striker', price: 300 },
      legendary: { name: 'Rift Sovereign', price: 600 }
    },
    banners = {
      classic: { name: 'COMBO', price: 0 },
      unstoppable: { name: 'UNSTOPPABLE', price: 100 },
      riftbreaker: { name: 'RIFT BREAKER', price: 250 }
    }
  } = {}) {
    this.adapter = adapter;
    this.characters = characters;
    this.banners = banners;
    this.profile = clone(DEFAULT_PROFILE);
    this.queue = Promise.resolve();
    this.receipts = new Set();
  }

  static rankForXp(xp) {
    const safeXp = Math.max(0, Math.floor(Number(xp) || 0));
    return RANK_TIERS.reduce((rank, next) => safeXp >= next.xp ? next : rank, RANK_TIERS[0]);
  }

  static rewardFor(difficulty) {
    const reward = REWARDS[String(difficulty).toLowerCase()];
    if (!reward) throw new RangeError('Unknown difficulty: ' + difficulty);
    return { ...reward };
  }

  static rankForCampaign(rankXp, clearedCount) {
    return rankForCampaign(rankXp, clearedCount);
  }

  async load() {
    const stored = await this.adapter.read();
    this.profile = this._sanitize(stored || DEFAULT_PROFILE);
    if (stored) await this.adapter.write(this.profile);
    return clone(this.profile);
  }

  peek() {
    return clone(this.profile);
  }

  async save(nextProfile = this.profile) {
    return this._serial(async () => this._commitProfile(nextProfile));
  }

  async purchaseCharacter(id) {
    return this._serial(async () => {
      const item = this.characters[id];
      if (!Object.hasOwn(this.characters, id) || !item || !validId.test(id)) throw new RangeError('Unknown character style.');
      if (!Number.isSafeInteger(item.price) || item.price < 0) throw new TypeError('Character price is invalid.');
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'purchase-character', itemId: id });
      const next = clone(this.profile);
      if (next.ownedCharacters.includes(id)) {
        next.equippedCharacter = id;
        const committed = await this._commitProfile(next);
        return freeze({ ...committed, alreadyOwned: true, receipt: null });
      }
      if (next.kinets < item.price) return freeze({ ok: false, reason: 'insufficient-funds', required: item.price, balance: next.kinets });
      next.kinets -= item.price;
      next.ownedCharacters.push(id);
      next.equippedCharacter = id;
      return this._commitPurchase(next, 'character', id, item.price);
    });
  }

  async purchaseBanner(id) {
    return this._serial(async () => {
      const item = this.banners[id];
      if (!Object.hasOwn(this.banners, id) || !item || !validId.test(id)) throw new RangeError('Unknown combo banner.');
      if (!Number.isSafeInteger(item.price) || item.price < 0) throw new TypeError('Banner price is invalid.');
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'purchase-banner', itemId: id });
      const next = clone(this.profile);
      if (next.ownedBanners.includes(id)) {
        next.equippedBanner = id;
        const committed = await this._commitProfile(next);
        return freeze({ ...committed, alreadyOwned: true, receipt: null });
      }
      if (next.kinets < item.price) return freeze({ ok: false, reason: 'insufficient-funds', required: item.price, balance: next.kinets });
      next.kinets -= item.price;
      next.ownedBanners.push(id);
      next.equippedBanner = id;
      return this._commitPurchase(next, 'banner', id, item.price);
    });
  }

  async equipCharacter(id) {
    return this._serial(async () => {
      if (!Object.hasOwn(this.characters, id) || !this.profile.ownedCharacters.includes(id)) throw new Error('Character is not unlocked.');
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'equip-character', itemId: id });
      const next = clone(this.profile);
      next.equippedCharacter = id;
      return this._commitProfile(next);
    });
  }

  async equipBanner(id) {
    return this._serial(async () => {
      if (!Object.hasOwn(this.banners, id) || !this.profile.ownedBanners.includes(id)) throw new Error('Banner is not unlocked.');
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'equip-banner', itemId: id });
      const next = clone(this.profile);
      next.equippedBanner = id;
      return this._commitProfile(next);
    });
  }

  async rename(username, cost = 100) {
    return this._serial(async () => {
      const name = String(username).trim();
      if (!validName.test(name)) throw new RangeError('Username must be 3–18 allowed characters.');
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'rename', username: name });
      const next = clone(this.profile);
      if (name === next.username) return freeze({ ok: true, unchanged: true, profile: clone(next) });
      if (next.kinets < cost) return freeze({ ok: false, reason: 'insufficient-funds', required: cost, balance: next.kinets });
      next.kinets -= cost;
      next.username = name;
      return this._commitProfile(next);
    });
  }

  async awardVictory(difficulty) {
    return this._serial(async () => {
      const reward = KinetixProgressionVault.rewardFor(difficulty);
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'award-victory', difficulty: String(difficulty).toLowerCase() });
      const next = clone(this.profile);
      const rankBefore = KinetixProgressionVault.rankForXp(next.rankXp);
      next.kinets += reward.kinets;
      next.rankXp += reward.xp;
      next.soloWins += 1;
      const rankAfter = KinetixProgressionVault.rankForXp(next.rankXp);
      const result = await this._commitProfile(next);
      return freeze({
        ...result,
        reward,
        rankBefore,
        rankAfter,
        rankedUp: rankBefore.id !== rankAfter.id
      });
    });
  }

  async awardMissionClear(missionId, stars = 1) {
    return this._serial(async () => {
      const mission = getMissionById(missionId);
      if (!mission) throw new RangeError('Unknown campaign mission.');
      const score = Math.max(1, Math.min(3, Math.floor(Number(stars) || 1)));
      const next = clone(this.profile);
      const campaign = next.campaign || { highestUnlocked: 1, clearedMissions: [], stars: {} };
      if (mission.id > campaign.highestUnlocked) {
        return freeze({ ok: false, reason: 'mission-locked', requiredMission: campaign.highestUnlocked, profile: clone(next) });
      }

      const firstClear = !campaign.clearedMissions.includes(mission.id);
      const previousBest = Number(campaign.stars[mission.id] || 0);
      campaign.stars[mission.id] = Math.max(previousBest, score);
      if (firstClear) {
        campaign.clearedMissions.push(mission.id);
        campaign.clearedMissions.sort((a, b) => a - b);
        campaign.highestUnlocked = Math.min(12, Math.max(campaign.highestUnlocked, mission.id + 1));
      }

      const reward = firstClear
        ? { kinets: mission.rewardBase + (score - 1) * 4, xp: 30 + mission.chapter * 3 + score * 4 }
        : { kinets: 0, xp: 0 };
      const rankBefore = rankForCampaign(next.rankXp, campaign.clearedMissions.length);
      if (firstClear) {
        next.kinets += reward.kinets;
        next.rankXp += reward.xp;
      }
      next.soloWins += 1;
      next.campaign = campaign;
      const committed = await this._commitProfile(next);
      const rankAfter = rankForCampaign(this.profile.rankXp, this.profile.campaign.clearedMissions.length);
      const nextMission = this.profile.campaign.clearedMissions.length >= 12
        ? null
        : getMissionById(this.profile.campaign.highestUnlocked);
      return freeze({
        ...committed,
        missionId: mission.id,
        stars: campaign.stars[mission.id],
        firstClear,
        improvedBest: score > previousBest,
        reward,
        rankBefore,
        rankAfter,
        rankedUp: rankBefore.id !== rankAfter.id,
        nextMissionId: nextMission?.id ?? null
      });
    });
  }

  async awardPracticeVictory() {
    return this._serial(async () => {
      const next = clone(this.profile);
      const reward = { kinets: 8, xp: 0 };
      next.kinets += reward.kinets;
      next.soloWins += 1;
      const committed = await this._commitProfile(next);
      return freeze({ ...committed, reward, rankedUp: false, firstClear: false });
    });
  }

  async awardLoss() {
    return this._serial(async () => {
      if (typeof this.adapter.transact === 'function') return this._remoteTransaction({ operation: 'award-loss' });
      const next = clone(this.profile);
      next.soloLosses += 1;
      return this._commitProfile(next);
    });
  }

  async _remoteTransaction(command) {
    const idempotencyKey = globalThis.crypto?.randomUUID?.()
      || ('kinetix-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    const response = await this.adapter.transact({ ...command, idempotencyKey });
    if (!response || !response.profile || typeof response.profile !== 'object') {
      throw new Error('Remote transaction response did not contain an authoritative profile.');
    }
    this.profile = this._sanitize(response.profile);
    return freeze({
      ...response,
      ok: response.ok !== false,
      profile: clone(this.profile),
      receipt: response.receipt ? freeze(response.receipt) : null
    });
  }

  async _commitPurchase(profile, type, itemId, amount) {
    const receipt = freeze({
      receiptId: globalThis.crypto?.randomUUID?.() || ('local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)),
      type,
      itemId,
      amount,
      currency: 'KINETS',
      issuedAt: new Date().toISOString(),
      trust: 'client-local-unverified',
      signature: null
    });
    const nextProfile = this._sanitize(profile);
    await this._writeLocal(nextProfile);
    this.profile = nextProfile;
    this.receipts.add(receipt.receiptId);
    return freeze({ ok: true, profile: clone(this.profile), receipt });
  }

  async _commitProfile(profile) {
    const nextProfile = this._sanitize(profile);
    await this._writeLocal(nextProfile);
    this.profile = nextProfile;
    return freeze({ ok: true, profile: clone(this.profile) });
  }

  async _writeLocal(profile) {
    const result = await this.adapter.write(profile);
    if (result && result.persisted === false) {
      throw new Error('Profile persistence failed; the transaction was not applied.');
    }
    return result;
  }

  _sanitize(input) {
    const value = input && typeof input === 'object' ? input : {};
    const ownedCharacters = [...new Set((Array.isArray(value.ownedCharacters) ? value.ownedCharacters : ['starter'])
      .filter((id) => typeof id === 'string' && Object.hasOwn(this.characters, id)))];
    const ownedBanners = [...new Set((Array.isArray(value.ownedBanners) ? value.ownedBanners : ['classic'])
      .filter((id) => typeof id === 'string' && Object.hasOwn(this.banners, id)))];
    if (!ownedCharacters.includes('starter')) ownedCharacters.unshift('starter');
    if (!ownedBanners.includes('classic')) ownedBanners.unshift('classic');

    const username = typeof value.username === 'string' && validName.test(value.username.trim())
      ? value.username.trim() : DEFAULT_PROFILE.username;
    const integer = (number) => Number.isFinite(Number(number)) ? Math.max(0, Math.min(1_000_000_000, Math.floor(Number(number)))) : 0;
    const equippedCharacter = ownedCharacters.includes(value.equippedCharacter) ? value.equippedCharacter : 'starter';
    const equippedBanner = ownedBanners.includes(value.equippedBanner) ? value.equippedBanner : 'classic';
    const rawCampaign = value.campaign && typeof value.campaign === 'object' ? value.campaign : {};
    const rawClears = new Set((Array.isArray(rawCampaign.clearedMissions) ? rawCampaign.clearedMissions : [])
      .map((id) => Math.floor(Number(id)))
      .filter((id) => Number.isInteger(id) && id >= 1 && id <= 12));
    const clearedMissions = [];
    for (let id = 1; id <= 12 && rawClears.has(id); id += 1) clearedMissions.push(id);
    const rawStars = rawCampaign.stars && typeof rawCampaign.stars === 'object' ? rawCampaign.stars : {};
    const stars = {};
    for (const id of clearedMissions) {
      const score = Math.floor(Number(rawStars[id]) || 0);
      stars[id] = Math.max(1, Math.min(3, score || 1));
    }
    const campaign = {
      highestUnlocked: Math.min(12, clearedMissions.length + 1),
      clearedMissions,
      stars
    };

    return {
      username,
      kinets: integer(value.kinets),
      rankXp: integer(value.rankXp),
      soloWins: integer(value.soloWins),
      soloLosses: integer(value.soloLosses),
      ownedCharacters,
      equippedCharacter,
      ownedBanners,
      equippedBanner,
      campaign,
      schemaVersion: 3
    };
  }

  _serial(operation) {
    const execute = () => {
      const locks = globalThis.navigator?.locks;
      if (typeof locks?.request === 'function') {
        return locks.request('kinetix-progression-vault-v2', { mode: 'exclusive' }, operation);
      }
      return operation();
    };
    const run = this.queue.then(execute, execute);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export { REWARDS as KINETIX_SOLO_REWARDS };
