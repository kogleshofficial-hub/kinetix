# Kinetix

**Your body. Your power. Your arena.**
*Train smart. Survive the Rift.*

Kinetix is a browser-first, webcam-controlled fantasy combat prototype created by **Koglesh R. Murugan**. It includes a solo boss encounter and a local two-player duel, with readable motion gestures, health and mana management, healing supplies, impact feedback and original energy effects.

This is an early playable prototype—not a finished commercial game or a claim that webcam-controlled games are new.

## Camera is required

Kinetix requests camera access automatically when the page opens. The browser may reuse a permission already granted for this site, so it might not show a new prompt every visit. No match can start until camera access and the pose model are ready.

If the request is denied, open the browser's site permissions, allow camera access, then retry. Camera access requires HTTPS (or localhost). Camera frames and pose landmarks are processed locally in the browser; Kinetix does not record or upload camera footage and does not request microphone access. The production build bundles the MediaPipe JavaScript library and serves its WASM runtime and pose model from the same site, avoiding runtime JavaScript-module CDN imports.

## Play modes

- **Solo vs Rift AI:** one tracked player fights the Hollow. Read its warnings, time guard or phase dodges, manage mana, use NOVA and claim supply drops.
- **2-player local duel:** two players stand apart in front of one camera. Both must be visible and calibrated before the round starts. Each has independent health, mana, combos, defence, NOVA and med-kit inventory. The first player to reduce the other player's health to zero wins; when time runs out, remaining health decides the result, with a draw possible.
- **Phone and touch:** layouts and control panels adapt to smaller screens. Touch buttons are a backup input for play while the camera remains enabled; they do not bypass the camera requirement.

## Controls

**Solo**
- **Pulse:** Space or J / on-screen button
- **Guard:** G or Shift / on-screen button
- **Phase left/right:** A/D or arrow keys / on-screen buttons
- **NOVA:** Q or Enter when the mana meter is full
- **Claim supply drop:** R / on-screen button
- **Use med kit:** E / on-screen button
- **Pause:** Escape

**Two-player local duel**
- **Player 1:** Space (Pulse), G (Guard), A/D (Phase), Q (NOVA), R (claim drop), E (med kit)
- **Player 2:** J (Pulse), L (Guard), Left/Right arrows (Phase), U (NOVA), I (claim drop), O (med kit)
- On-screen split panels provide touch backup controls for both players.

## Solo difficulty

- **Easy:** 100 Rift HP, 12 damage per hit, generous warnings and wide counter windows for learning the controls.
- **Normal (default):** 210 Rift HP and 28 damage per landed hit. Use this as the regular practice challenge.
- **Hard — The Rift Master:** 420 Rift HP, 48 damage per landed hit, a short warning, brief counter windows, reduced glancing damage and lane patterns that change between attacks. A hit can remove 40% of the solo player's 120 HP, so defensive reads matter. It is intentionally very difficult, but timed counters, blocks, dodges, supplies and NOVA keep it beatable in principle.

The webcam detects gestures, not strike force. Use short, comfortable air-jabs; difficulty comes from the Rift's stats and timing—not from hitting harder or forcing unsafe speed.

## Health, mana and supplies

Pulses consume mana; mana regenerates slowly. Guard reduces incoming damage, while a well-timed phase can evade an attack. NOVA costs more mana, so timing matters. Med kits restore up to 28 HP and are limited; save them when health is already full. Supply drops periodically offer either a med kit or a mana orb. In local duel, each supply drop is shared, so the first player to claim it gets the item.

## Motion input and physical comfort

MediaPipe Pose Landmarker estimates body landmarks in camera frames. Kinetix uses calibrated gesture heuristics for wrist movement, an upper-torso guard pose and small torso leans; it does not measure actual strike force. For Duo, the prototype requests up to two poses, sorts them left-to-right, requires both players before calibration, and routes each player's gestures to independent controls. Automated checks cover this wiring, but real two-person webcam tracking still needs a hands-on test on supported devices. Good lighting and enough space between players improve tracking reliability.

Keep the play area clear. Use controlled, comfortable air gestures only—no physical contact, striking objects, forceful jumps or high-impact movements. If tracking is lost, the match pauses until the required player(s) are visible again.

## Kinets and customization

Solo victories award Kinets: Easy **15**, Normal **20**, and Hard **30**. Kinets can unlock cosmetic fighter styles (Elite **120**, Epic **300**, Legendary **600**) or a username change (**100**). Cosmetics do not improve combat stats. Local Duo matches do not award Kinets.

The current profile is stored in browser local storage on the current device. It is not an authenticated account, cannot sync across devices, and can be cleared by browser data deletion. A server-backed account and trusted economy would be required before treating balances, usernames, or purchases as secure.

## Ranks, Perfect Reads and Last Light

Solo wins award Rank XP: Easy **10**, Normal **20**, and Hard **35**. The local rank ladder is Rift Recruit, Kinetic Initiate, Pulse Adept, Rift Hunter, Void Vanguard, Rift Champion, and Kinetix Sovereign. Progress is based on solo victory difficulty; Duo play does not award progression currency or rank XP.

A last-moment guard or lane-changing phase can trigger a Perfect Read with brief visual hit-stop, a pulse of sound and bonus energy. Once per solo round, surviving a hit with health at or below the next incoming hit's damage opens a short Last Light window. Press **F** only during a counter opening to perform the special counter. These are skill feedback and comeback tools, not random jackpots.

Combo banners cost **100** or **250 Kinets** and appear in solo play from a five-hit combo. They are cosmetic. The current profile is stored in this browser only; no authenticated account, synced wallet, or online leaderboard exists.

## Creator Studio (alpha)

Open the **Create Game** link or visit `/creator.html` to use the local-first Creator Studio. It offers three starter templates, configurable gesture/rule/goal/duration/difficulty/theme settings, a simulated local test, browser-local draft saving, and portable JSON export/import.

This is currently a **game blueprint editor**, not a fully generated motion-game runtime. Preview gestures are simulated and do not activate the camera. The blueprint describes the intended configuration for a future engine runtime; it is not yet a published custom game. No creator accounts, sharing platform, paid passes, marketplace, revenue share, cloud project storage, or server-backed game logic exists yet.

## Current scope and limitations

The prototype includes a solo AI encounter, same-device local duel, camera permission gate, pose calibration, touch/keyboard backup, health and mana meters, med kits, supply drops, hit/heal feedback, original Canvas fighter visuals, sound effects, pause/replay and a downloadable result card. Real-time online multiplayer, accounts, cloud leaderboards, payments and automatic camera recording are not included. Camera tracking and small-screen performance still need testing on a range of real devices before this can be called production-ready.

Built by **Koglesh R. Murugan**.


## Copyright and source-code policy

Copyright © 2026 Koglesh R. Murugan. All rights reserved for the original Kinetix-authored source code, text, interface design, and original game materials, except where a component or asset is identified as third-party material.

Unless permission is granted in writing, public access to this repository or the live game does not grant permission to copy, redistribute, adapt, or commercially reuse the original materials. Third-party libraries and assets remain governed by their own licenses. This notice is not a claim that every game mechanic or general idea is exclusive, and it does not replace technical access controls.

The production build is minified and applies conservative obfuscation to Kinetix-authored client logic. Source maps are disabled, and third-party MediaPipe runtime code is kept separate rather than obfuscated. Because a browser must receive client-side code to run it, these measures only add friction; they cannot make browser code secret. Keep credentials and any future authoritative online economy or account logic on a trusted server, never in frontend JavaScript.
