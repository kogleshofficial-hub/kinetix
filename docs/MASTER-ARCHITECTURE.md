# KINETIX — Production Architecture & Evolution Plan

**Status:** Living production architecture and implementation record (updated 2026-11-03)  
**Owner:** Koglesh R. Murugan  
**Principle:** Ship measurable player value before infrastructure scale.

This document describes an evolution path. It is not a statement that cloud accounts, global multiplayer, WebGPU rendering, neural enemy training, creator payouts, or a billion-dollar business already exist.

## 1. Current engineering baseline

The repository currently uses a static Vite application with two HTML entry points, vanilla JavaScript modules, MediaPipe Pose Landmarker in a dedicated Web Worker, a fixed-step 60 Hz combat director, a Canvas 2D game scene with a separate effects canvas, local browser progression, and Node's built-in test runner.

The current motion system detects a calibrated wrist raise as PULSE, wrists held close to the chest as GUARD, and torso lean as PHASE. It uses 33-point pose landmarks. It does not yet run a hand-landmark model, face analysis, an authoritative network service, cloud progression, online matchmaking, WebGPU rendering, or server-side transactions.

Preserve this foundation. Do not migrate to a large framework or add multiple ML runtimes until measurements show a clear need.

### Delivered client foundation in the current development branch

- Camera permission is requested only after an explicit player action; page load does not open the camera.
- A root-scoped service worker caches the app shell, Creator Studio, versioned same-origin bundles, and fetched local MediaPipe WASM/model assets.
- A web app manifest includes standard 192 px and 512 px app icons plus a scalable SVG icon.
- Installation is offered only when the browser emits its install-prompt event. An available service-worker update waits for an explicit update action.
- Service-worker caching is limited to same-origin GET requests. Camera frames, pose landmarks, cross-origin fonts and arbitrary network requests are not stored by the service worker.
- These changes establish install/offline plumbing; they do not make first-time use offline, guarantee persistent browser storage, or provide native mobile camera capabilities.

## 2. Target logical architecture

```text
                     KINETIX WEB CLIENT
  ┌─────────────────────────────────────────────────────────────┐
  │ Camera Consent / Camera Preview / Accessible Input Fallback │
  ├────────────────────┬─────────────────────┬──────────────────┤
  │ Motion Runtime     │ Presentation        │ Local Profile    │
  │ Pose / Hands       │ Canvas / WebGL2     │ Settings         │
  │ Feature Extraction │ WebGPU (opt-in)     │ Offline Cache    │
  │ Gesture Classifier │ Audio / Particles   │ Replay Export     │
  ├────────────────────┴─────────────────────┴──────────────────┤
  │ Deterministic Game Simulation + Event Bus                   │
  │ Combat State · Encounter Director · Score · Replay Events   │
  └───────────────────────────┬─────────────────────────────────┘
                              │ HTTPS / WebSocket / WebTransport
  ┌───────────────────────────▼─────────────────────────────────┐
  │                  KINETIX ONLINE SERVICES                     │
  │ Identity · Matchmaking · Authoritative Match · Cloud Save    │
  │ Inventory · Ledger · Leaderboard · Tournament Scheduler     │
  │ Creator Review · Asset Metadata · Moderation                 │
  └───────────────────────────┬─────────────────────────────────┘
                              │
  ┌───────────────────────────▼─────────────────────────────────┐
  │ PostgreSQL · Object Storage · CDN · Metrics · Audit Logs     │
  └─────────────────────────────────────────────────────────────┘
```

The client is responsible for responsive controls and presentation. The server is responsible for identity, purchases, rewards, rankings, match outcomes, and any value that must not be forgeable by a browser.

## 3. Pillar A — Rendering and performance

### Renderer progression

1. Keep the existing Canvas 2D renderer as the known-good baseline.
2. Introduce a renderer interface so scene code does not depend directly on a graphics API.
3. Add an optional WebGL2 scene backend for richer 3D.
4. Add WebGPU as an opportunistic backend after device/browser capability checks.
5. Retain a fallback path and test every mode on real devices.

Do not promise universal 120 FPS. The production goal is stable frame pacing appropriate to each device class. A 120 FPS mode has an 8.33 ms total frame budget and should only be offered when measured headroom exists.

Use GPU compute for particles only where the implementation is actually faster than a bounded CPU or Canvas implementation. Use baked lighting, environment maps, screen-space effects and carefully budgeted post-processing before pursuing expensive ray tracing. WebGPU is a graphics and compute API, not a guarantee of hardware ray tracing.

### Renderer interface

A future interface may expose:

- initialize(canvas, options)
- resize(width, height, pixelRatio)
- render(snapshot, frameTime)
- setQualityPreset(preset)
- dispose()

Do not introduce a 3D engine dependency until the first 3D scene is ready to replace a specific existing scene.

## 4. Pillar B — Motion intelligence

### Processing pipeline

Camera permission → local video frame → pose/hand landmarks → quality checks → normalized features → temporal gesture classifier → validated game action event.

The video frame and raw landmark arrays stay on-device. Only the minimal game action and timing data may leave the client when an online match requires it.

### Motion roadmap

**M1 — Current:** Pose Landmarker, 33 landmarks, calibration, worker isolation, confidence thresholds, comfortable gesture heuristics.

**M2 — In progress:** Temporal wrist path classification. LINEAR and ARC are presentation variants only; neither increases damage or score.

**M3 — Later:** Optional Hand Landmarker (21 landmarks per hand) for pinch/open-hand/spell-selection controls. Load it only for a mode that uses it and measure thermal/battery impact.

**M4 — Later:** Optional local ONNX models for custom temporal gesture classification, after collecting consented, non-identifying evaluation data and establishing a labelled validation set.

**M5 — Later:** WebNN or WebGPU inference acceleration when supported by the browser and model operators. Keep a WASM or CPU fallback.

Never infer morale, fatigue, health, or emotional state from facial micro-expressions. Use explicit difficulty controls and observable in-game performance metrics instead.

### Recognition rules

- Normalize positions by shoulder width to reduce camera-distance sensitivity.
- Use timestamps rather than assuming a fixed camera frame rate.
- Reject low-confidence landmarks and clear their temporal history.
- Apply hysteresis and cooldowns to prevent repeated triggers.
- Recalibrate after major camera repositioning or prolonged tracking loss.
- Provide keyboard, touch, and seated-friendly alternatives.
- Never reward force, unsafe speed, or increasingly aggressive real-world movement.

## 5. Pillar C — Combat and adaptive encounters

Keep the simulation fixed-step and deterministic. The renderer may run at 30, 60, 90 or 120 frames per second without changing combat rules.

Combat actions should be validated against a finite set of action names, legal state transitions, cooldowns, and per-player limits. Gesture metadata is untrusted and should be normalized before it reaches the simulation.

The Rift Director should begin as a seeded finite-state machine and a rules-based difficulty controller. It can adapt pacing from match events such as reaction windows, missed reads, defensive success, and repeated move patterns. It must not secretly read camera footage or change an encounter after the player has already committed to an action.

Procedural bosses should be assembled from reviewed archetypes, safe parameter ranges, authored animation/audio sets, and a reproducible seed. Store the encounter seed and version with replay records.

Use offline simulation to evaluate learned enemy policies before any online release. RLHF is not a substitute for deterministic rules, QA, or a fair difficulty model.

## 6. Pillar D — Online multiplayer and authority

Start with asynchronous challenges and server-validated score submissions. Real-time remote duels are a separate project.

For remote duels:

- Use WebSocket as the broadly compatible first transport.
- Evaluate WebTransport datagrams for low-latency server communication where supported.
- Use WebRTC only when direct peer transport has a clear benefit; do not treat peer-to-peer clients as trusted authorities.
- Keep a regional authoritative match service responsible for health, cooldowns, round timers, scoring, and results.
- Use client-side prediction for the local player's immediate animation.
- Interpolate remote presentation and correct against server snapshots.
- Measure RTT and jitter; match by both skill and connection quality.
- Treat every client action as untrusted input.

A global sub-10 ms end-to-end guarantee is physically and operationally unrealistic. Optimize local input-to-render separately from network round-trip time, and publish measured percentiles by region and device.

## 7. Pillar E — Identity, economy, creator tools

### Identity and progression

Move from browser-local profiles to authenticated cloud profiles only after the game has retention. Use server-issued session credentials, rate limits, account recovery, and strict authorization checks.

The current local Kinet wallet is not tamper-proof. It must never be represented as real money or as an authoritative online balance.

### Kinet ledger

If online currency is introduced, use an append-only transaction ledger:

- transaction ID
- account ID
- source and reason
- positive or negative amount
- idempotency key
- timestamp
- related match or purchase ID
- server-side validation result

Balance is derived from valid ledger entries or maintained through a transactionally updated balance table. Browser clients never decide the balance.

Start with non-transferable, non-cash in-game currency. Avoid blockchain unless a concrete player or business requirement justifies its cost and regulatory complexity.

### Cosmetics and creator economy

Use directly purchasable cosmetics with clear previews. Keep gameplay power separate from paid cosmetics.

A future creator studio should accept declarative, constrained asset manifests rather than arbitrary executable code. Validate file size, dimensions, formats, polygon/texture budgets, dependencies, provenance, moderation state and license grants. Run uploaded assets through an isolated processing pipeline before publication.

A proposed 70% creator share must be calculated from a clearly defined net-receipts base after refunds, taxes and payment/distribution costs. Cash payouts require professional review of contracts, tax, consumer, payment, age and marketplace obligations before implementation.

## 8. Pillar F — Distribution and acquisition

### Device support

- Desktop browsers: primary development target.
- Mobile browsers: responsive UI, conservative inference rate and thermal-aware quality.
- PWA: installable shell and same-origin offline caching are implemented in the development branch; first-visit network requirements, browser storage eviction and camera permission limits still apply.
- Capacitor: evaluate only after the mobile browser experience is stable.
- Electron: only if desktop packaging delivers a clear benefit.
- Quest / Vision Pro: treat as a separate compatibility and interaction validation effort. RGB camera availability and app sandbox rules vary; do not promise unrestricted access to headset cameras.

### Sharing loop

Generate an opt-in replay from compact game events, not camera video. Render a short branded replay locally and let the player preview it before sharing. Do not include face or webcam footage by default.

Include a launch URL and a privacy-respecting share card. Never auto-post.

## 9. Production roadmap and release gates

### Phase 0 — Baseline and reliability
- Preserve current production branch.
- Record current bundle size, startup time, camera initialization time and frame pacing.
- Add repeatable tests for gesture math, combat transitions, progression and worker lifecycle.
- Test tracking under low light, multiple body positions, mobile thermal load and permission denial.

**Exit gate:** Existing solo and local duo modes still work, no camera frame leaks, and CI passes.

### Phase 1 — Motion engine 1.0
- Add temporal trajectory features.
- Add explicit tracking quality state.
- Improve player identity continuity for two-person tracking.
- Add optional hand tracking behind a feature flag.
- Provide calibration guidance and camera stop controls.

**Exit gate:** Gesture false-trigger rate and missed-trigger rate are measured on a defined device set.

### Phase 2 — Game quality
- Improve attack readability, enemy telegraphs, audio mix, accessibility and onboarding.
- **Local Daily Rift challenge:** deterministic UTC-date seed, repeatable no-repeat lane sequence, replay action and seed-bearing share card are implemented in the development branch. No server leaderboard or reward bonus is claimed.
- Add opt-in local replay and share-card output.

**Exit gate:** Players can understand the core loop without a developer explaining it.

### Phase 3 — Retention validation
- Add privacy-respecting product analytics.
- Measure first-match completion, next-day and next-week return, crash-free sessions, camera permission completion, and session satisfaction.
- Improve the features associated with retention.

**Exit gate:** Cohorts show repeat use. Do not add expensive network features solely because the roadmap lists them.

### Phase 4 — Online foundation
- Select an identity provider and managed PostgreSQL provider.
- Add server-owned profiles, saves and ledger.
- Add asynchronous challenges and server-validated leaderboards.
- Threat model all account, score and economy endpoints.

**Exit gate:** No client-trusted currency, rewards or rank outcomes.

### Phase 5 — Live multiplayer
- Regional matchmaking.
- Authoritative simulation.
- WebSocket first, WebTransport evaluation, WebRTC optional.
- Connection-quality-aware matchmaking and disconnect recovery.

**Exit gate:** Load tests, abuse tests, fairness evaluation and real-world regional latency reports pass.

### Phase 6 — Platform and creator expansion
- **PWA shell and offline asset caching:** initial implementation delivered; validate install prompts and offline camera/model startup on a device matrix before calling this complete.
- Mobile packaging if warranted.
- Constrained creator asset pipeline.
- Moderation and rights-management workflow.
- Creator analytics and compliant payouts only after legal readiness.

**Exit gate:** Unit economics and moderation operations are sustainable.

## 10. Metrics that decide whether KINETIX is working

Measure these before talking about global scale:

- Camera permission completion rate.
- Time from landing to first playable action.
- First-match completion rate.
- Gesture precision and false-trigger rate.
- Median and p95 input-to-feedback latency.
- Frame-time p50/p95 and dropped-frame rate.
- Crash-free session rate.
- Day 1 / Day 7 / Day 30 return rate.
- Matches per active player.
- Organic invite conversion.
- Cost per retained player.
- Net revenue per paying player, refunds and payment costs.
- Creator asset approval time and moderation incident rate.

Revenue projections should be scenario models, not promises. A billion-dollar outcome would require exceptional global distribution, durable retention, a strong brand, large-scale operations and profitable monetization. No architecture can guarantee it.

## 11. Non-negotiable engineering rules

1. Main branch remains releasable.
2. Every major subsystem has an interface and tests.
3. Camera frames remain local by default.
4. Server is authoritative for online rewards, purchases, ranks and match results.
5. No paid gameplay advantage.
6. No unreviewed arbitrary executable creator uploads.
7. No global 120 FPS or sub-10 ms network promises.
8. Feature flags gate experimental runtimes.
9. Accessibility and physical comfort are first-class requirements.
10. Ship a measurable player benefit before adding infrastructure.
