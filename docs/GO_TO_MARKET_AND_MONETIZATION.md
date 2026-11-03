# KINETIX — Product, audience and monetization plan

**Status:** Planning document only. No payments, subscriptions, ad SDKs, customer accounts or online economy are implemented.
**Owner:** Koglesh R. Murugan
**Principle:** Build a game people choose to return to because it is good—not because the interface pressures them.

## 1. Reality before revenue

No game can guarantee income, much less millions or billions. A strong game still needs product-market fit, distribution, trust, legal compliance, reliable operations, customer support and a sustainable cost structure. KINETIX should earn the right to monetize through real player value.

The current build is a local-first browser game. It has no authenticated account system, trusted server economy, synchronized inventory, server-verified results or payment backend. Its local Kinets and records can be modified or cleared by the device owner. They are game progression, not money and not proof of competitive achievement.

**Release rule:** Do not add a checkout button, sell local Kinets, promise prizes, or describe local scores as verified until the backend and the business/legal requirements have actually been built and reviewed.

## 2. Product sequence

### Stage A — Make the game easy to try

- Let people start immediately with keyboard/touch; camera motion is an optional input style.
- Make the first match understandable without reading a long manual.
- Give clear feedback for telegraphs, guard timing, lane changes, damage and results.
- Make pause, replay and exit easy to find.
- Keep solo and same-device multiplayer playable without an account.
- Test on low-, mid- and high-range Android phones, tablets and desktop browsers.

### Stage B — Prove that players enjoy it

Run small, permission-based playtests. Collect only the minimum information needed, explain what is collected, and provide a way to opt out. Do not add third-party tracking by default.

Useful product measures:
- landing page to first playable action;
- camera permission success, reported separately from overall play starts;
- tutorial completion and first-match completion;
- game errors and performance on real devices;
- voluntary return visits, without penalizing players for taking breaks;
- player-reported enjoyment, confusion and accessibility barriers.

Review feedback and fix repeated friction before expanding the feature set. Do not treat longer screen time as the definition of a better game.

### Stage C — Build trust and a real online foundation

Before online accounts, multiplayer or purchases:
- define the game service's data inventory, retention and deletion behavior;
- publish clear privacy, terms, support and refund information;
- add server-authenticated identity and server-authoritative match/economy transactions;
- validate all client-submitted match data on the server;
- add abuse prevention, rate limits, moderation and account recovery;
- monitor reliability, costs, latency and security incidents.

Never store payment secrets or authoritative currency logic in browser JavaScript. A Base64 wrapper, obfuscation or localStorage is not security.

## 3. Monetization options to evaluate later

These are possible business models, not commitments or income forecasts.

1. **Optional fixed-price cosmetics:** clearly priced visual styles, banners or themes. Purchases must not increase combat stats, hide core controls or create a pay-to-win advantage. Show exactly what is received before purchase.
2. **Event and education licensing:** a separate event/school/club version for supervised demonstrations, workshops or local tournaments, with clear device, privacy and support requirements.
3. **Transparent sponsorships:** clearly label paid partnerships. Sponsors must not determine gameplay outcomes or require players to share personal information.
4. **Creator-led distribution:** development videos, public playtests, community feedback and collaborations. Keep following the creator optional; playing must never depend on subscribing to a channel.

Do not launch randomized paid reward packs, artificial scarcity, loss-aversion timers, punitive login streaks, notification spam or mechanics designed to make players feel unable to stop. Daily Rift is a repeatable skill challenge, not a streak obligation.

## 4. YouTube integration policy

The current game links to the creator's channel as an optional external destination. It does not require YouTube login, inspect a player's subscriptions or grant game benefits for subscribing.

Do **not** offer a discount, currency, item, prize or gameplay advantage in exchange for subscribing. YouTube's Terms prohibit encouraging inaccurate engagement metrics, including incentives to increase channel subscribers. The YouTube Data API has OAuth-based subscription-list methods, but technical access does not make an incentive campaign compliant or justify requesting players' account permissions.

The channel link is for voluntary discovery of the creator's work. Any future promotion must be reviewed against the current YouTube Terms and applicable advertising rules.

## 5. Payments and age-related requirements

No payment provider is connected to KINETIX.

Payment services have different eligibility, identity, business, tax and consumer-protection requirements. Stripe's Malaysia Services Agreement states that an individual or sole proprietor who is 13 or older but under 18 must have a parent or legal guardian as the account representative. Do not bypass age checks or use another person's identity. Before accepting money, review the current provider agreement with the required adult representative and obtain appropriate professional advice about business registration, taxes, refunds and consumer obligations.

Do not request card details, identity documents, payment-provider passwords or API secrets in game chat, public issues or source code.

## 6. What is deliberately not shipping now

- no checkout or payment forms;
- no paid currency or purchase flow;
- no YouTube OAuth or subscription verification;
- no subscribe-to-unlock discount;
- no server leaderboard claim;
- no randomized paid rewards;
- no behavioral advertising or hidden tracking.

## 7. Official references

- [YouTube Terms of Service](https://www.youtube.com/t/terms) — restrictions on manipulating engagement metrics and incentivizing subscriber growth.
- [YouTube Data API — subscription implementation](https://developers.google.com/youtube/data/guides/implementation/subscriptions) — OAuth-based subscription-list methods.
- [YouTube Data API — subscriptions.list](https://developers.google.com/youtube/data/reference/rest/v3/subscriptions/list) — API fields and limits.
- [Stripe Services Agreement — Malaysia](https://stripe.com/legal/ssa/my) — account representative requirements, including representatives for users under 18.
- [Ethical Games: evidence-based guidance](https://doi.org/10.1145/3685207) — research-oriented discussion of player welfare and ethical game design.

Recheck provider terms and laws before implementing any payment or promotional campaign. This document is product planning, not legal, tax or financial advice.

---

**Success for the next release is not a revenue number.** It is a game that starts reliably, works for players without cameras, feels fair, gets useful feedback and earns voluntary return visits.
