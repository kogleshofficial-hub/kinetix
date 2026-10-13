# Kinetix

**Your body. Your power. Your arena.**

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

## Health, mana and supplies

Pulses consume mana; mana regenerates slowly. Guard reduces incoming damage, while a well-timed phase can evade an attack. NOVA costs more mana, so timing matters. Med kits restore up to 28 HP and are limited; save them when health is already full. Supply drops periodically offer either a med kit or a mana orb. In local duel, each supply drop is shared, so the first player to claim it gets the item.

## Motion input and physical comfort

MediaPipe Pose Landmarker estimates body landmarks in camera frames. Kinetix uses calibrated gesture heuristics for wrist movement, an upper-torso guard pose and small torso leans; it does not measure actual strike force. For Duo, the prototype attempts to track up to two bodies from the same camera. Good lighting and enough space between players improve tracking reliability.

Keep the play area clear. Use controlled, comfortable air gestures only—no physical contact, striking objects, forceful jumps or high-impact movements. If tracking is lost, the match pauses until the required player(s) are visible again.

## Current scope and limitations

The prototype includes a solo AI encounter, same-device local duel, camera permission gate, pose calibration, touch/keyboard backup, health and mana meters, med kits, supply drops, hit/heal feedback, original Canvas fighter visuals, sound effects, pause/replay and a downloadable result card. Real-time online multiplayer, accounts, cloud leaderboards, payments and automatic camera recording are not included. Camera tracking and small-screen performance still need testing on a range of real devices before this can be called production-ready.

Built by **Koglesh R. Murugan**.
