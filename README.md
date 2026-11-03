# Kinetix

**Your body. Your power. Your arena.**
*Train smart. Survive the Rift.*

Kinetix is a browser-first, webcam-controlled fantasy combat prototype created by **Koglesh R. Murugan**. It includes a solo boss encounter and a local two-player duel, with readable motion gestures, health and mana management, healing supplies, impact feedback and original energy effects.

This is an early playable prototype—not a finished commercial game or a claim that webcam-controlled games are new.

## Camera is optional

KINETIX can be played without granting camera access. Choose **SOLO VS RIFT AI · TOUCH / KEYBOARD** or **2-PLAYER LOCAL DUEL · TOUCH** to start directly. The first camera gate also has a **CONTINUE WITHOUT CAMERA** option.

Choose **SOLO · CAMERA MOTION** or **2-PLAYER LOCAL DUEL · CAMERA** only when you want body-tracking controls. The browser asks for camera permission after that explicit action; no microphone is requested. Camera access requires HTTPS (or localhost). Camera frames and pose landmarks are processed locally in the browser; KINETIX does not record or upload camera footage. The production build bundles the MediaPipe JavaScript library and serves its WASM runtime and pose model from the same site, avoiding runtime JavaScript-module CDN imports.

If camera permission is denied or the device has no camera, continue using keyboard/touch. You can retry motion setup later without losing access to the non-camera modes.

## Install and offline use

KINETIX includes an installable web-app manifest and a same-origin service worker. In browsers that support installation, an **Install KINETIX** control appears when the browser offers the install prompt; other browsers can use their own browser-menu install/add-to-home-screen option when available. The app shell and Creator Studio are cached for repeat visits. Hashed build assets, the local MediaPipe WASM runtime and pose model are cached as they are successfully fetched. This means offline launch is intended after a successful connected visit—not on the very first visit—and it depends on the browser retaining site storage. A cleared cache or a model never downloaded on that device requires a connection again. Camera availability and permission remain browser/device dependent even when the shell is offline.

The app checks for a newer service worker and exposes an update control when one is waiting. Updates are activated only after the player selects that control; the page then reloads onto the new version.

## Play modes

- **Solo vs Rift AI — keyboard/touch:** starts immediately without camera permission. Use the on-screen controls on phones/tablets or the keyboard on computers.
- **Solo — camera motion:** optional body-tracking input. Calibrate after the camera and pose model are ready; on-screen buttons remain available as backup.
- **2-player local duel — touch/keyboard:** two players share one screen and use the split control panels or assigned keyboard keys. No camera is required.
- **2-player local duel — camera:** two players stand apart in front of one camera. Both must be visible and calibrated before the round starts. Each has independent health, mana, combos, defence, NOVA and med-kit inventory. When time runs out, remaining health decides the result, with a draw possible.
- **Daily Rift:** can be played using keyboard/touch or optional camera motion. The UTC seed is the same for the date; local personal records are device-only and are not server-verified.

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

The webcam detects controlled movement, not strike force. Raise one hand comfortably from its neutral position and return it to rest to trigger PULSE; bring both wrists close together in the upper-chest area for GUARD; shift the upper torso slightly to change lanes. Difficulty comes from the Rift's stats and timing—not from hitting harder or forcing speed.

## Daily Rift challenge

The lobby offers a local **Daily Rift** challenge. It derives a deterministic seed from the current UTC date and uses that seed for the encounter's lane sequence. Players using the same ruleset and UTC date receive the same sequence; the result card includes the date and seed code so friends can compare runs.

Daily Rift uses your selected solo difficulty and the normal solo victory reward table. It does not award bonus currency, require an account, upload camera footage, or submit scores to an online leaderboard. A device-local history keeps up to 31 UTC dates of attempts, clears and personal-best combo/damage/accuracy, and the lobby shows today's personal record. This history is not synced, is editable/clearable with browser storage, and may be unavailable when storage is blocked. The current build does not verify results on a server, so the seed and personal record are reproducibility/personal-history aids—not anti-cheat or competitive rankings. The challenge can be replayed on the same date.

## Health, mana and supplies

Pulses consume mana; mana regenerates slowly. Guard reduces incoming damage, while a well-timed phase can evade an attack. NOVA costs more mana, so timing matters. Med kits restore up to 28 HP and are limited; save them when health is already full. Supply drops periodically offer either a med kit or a mana orb. In local duel, each supply drop is shared, so the first player to claim it gets the item.

## Motion input and physical comfort

MediaPipe Pose Landmarker runs inside a dedicated Web Worker. Camera frames are transferred to the worker as ImageBitmaps; landmark smoothing, calibration and gesture calculations happen off the window thread. PULSE also samples a short wrist trajectory normalized by shoulder width and classifies its visual presentation as LINEAR or ARC when confidence is sufficient. This is a cosmetic feedback distinction only: it does not measure strike force or change damage, rewards, ranking or competitive balance. Low-confidence or short paths use a neutral effect. Kinetix uses calibrated heuristics for a controlled wrist raise, wrists held close together in the upper-chest area and small torso shifts; it does not measure actual strike force. For Duo, the prototype requests up to two poses, sorts them left-to-right, requires both players before calibration, and routes each player's gestures to independent controls. Automated checks cover this wiring, but real two-person webcam tracking still needs a hands-on test on supported devices. Good lighting and enough space between players improve tracking reliability.

Keep the play area clear. Use controlled, comfortable air gestures only—no physical contact, striking objects, forceful jumps or high-impact movements. If tracking is lost, the match pauses until the required player(s) are visible again.

## Creator and community

The game includes an optional link to the creator's YouTube channel. It is a voluntary way to follow the project; subscribing is not required for gameplay, does not unlock features, and is not tied to a discount or reward. KINETIX does not ask players to connect a YouTube account.

## Kinets and customization

Solo victories award Kinets: Easy **15**, Normal **20**, and Hard **30**. Kinets can unlock cosmetic fighter styles (Elite **120**, Epic **300**, Legendary **600**) or a username change (**100**). Cosmetics do not improve combat stats. Local Duo matches do not award Kinets.

The current profile is stored in browser local storage on the current device. Its Base64 wrapper is obfuscation only—not encryption, authentication or tamper protection. Local receipts are explicitly unverified. The asynchronous vault includes a remote adapter contract, but an authoritative server transaction endpoint, database constraints, account identity and server-issued signatures must exist before balances or purchases can be trusted. Local data cannot sync across devices and can be cleared or edited by the browser user.

## Ranks, Perfect Reads and Last Light

Solo wins award Rank XP: Easy **10**, Normal **20**, and Hard **35**. The local rank ladder is Rift Recruit, Kinetic Initiate, Pulse Adept, Rift Hunter, Void Vanguard, Rift Champion, and Kinetix Sovereign. Progress is based on solo victory difficulty; Duo play does not award progression currency or rank XP.

A last-moment guard or lane-changing phase can trigger a Perfect Read with brief visual hit-stop, a pulse of sound and bonus energy. Once per solo round, surviving a hit with health at or below the next incoming hit's damage opens a short Last Light window. Press **F** only during a counter opening to perform the special counter. These are skill feedback and comeback tools, not random jackpots.

Combo banners cost **100** or **250 Kinets** and appear in solo play from a five-hit combo. They are cosmetic. The current profile is stored in this browser only; no authenticated account, synced wallet, or online leaderboard exists.

## Creator Studio (alpha)

Open the **Create Game** link or visit `/creator.html` to use the local-first Creator Studio. It offers three starter templates, configurable gesture/rule/goal/duration/difficulty/theme settings, a simulated local test, browser-local draft saving, and portable JSON export/import.

This is currently a **game blueprint editor**, not a fully generated motion-game runtime. Preview gestures are simulated and do not activate the camera. The blueprint describes the intended configuration for a future engine runtime; it is not yet a published custom game. No creator accounts, sharing platform, paid passes, marketplace, revenue share, cloud project storage, or server-backed game logic exists yet.

## Current scope and limitations

The development branch includes solo AI, same-device local duel, optional camera motion, camera-free keyboard/touch solo, camera-free touch/keyboard Duo, health and mana, med kits, supply drops, hit/heal feedback, Canvas fighter visuals, sound effects, pause/replay and a downloadable result card. Real-time online multiplayer, accounts, cloud leaderboards, payments and automatic camera recording are not included. Camera tracking, touch usability and small-screen performance still need testing on a range of real devices before this can be called production-ready.

Built by **Koglesh R. Murugan**.


## Copyright and source-code policy

Copyright © 2026 Koglesh R. Murugan. All rights reserved for the original Kinetix-authored source code, text, interface design, and original game materials, except where a component or asset is identified as third-party material.

Unless permission is granted in writing, public access to this repository or the live game does not grant permission to copy, redistribute, adapt, or commercially reuse the original materials. Third-party libraries and assets remain governed by their own licenses. This notice is not a claim that every game mechanic or general idea is exclusive, and it does not replace technical access controls.

The production build is minified and applies conservative obfuscation to the main page entry points. Source maps are disabled; the camera worker and its MediaPipe dependency are emitted as a separate module bundle and are not run through the app-entry obfuscator. Because a browser must receive client-side code to run it, these measures only add friction; they cannot make browser code secret. Keep credentials and any future authoritative online economy or account logic on a trusted server, never in frontend JavaScript.
