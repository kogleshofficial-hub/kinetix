# Kinetix

**Your body. Your power. Your arena.**

Kinetix is a browser-first motion-controlled fantasy combat prototype created by **Koglesh R. Murugan**. It combines a solo boss encounter with a local two-player duel, readable controls, health/mana management and original energy effects.

This is an early prototype—not a finished commercial game or a claim that webcam-controlled games are new.

## Play modes

- **Solo vs Rift AI:** fight the Hollow, read its warning, time your guard or phase dodge, build energy and trigger NOVA.
- **2-player local duel:** two players share one camera and screen. Each has separate health, mana, combos, defense, NOVA and a med-kit inventory. The first player to reduce the opponent's health to zero wins; if time runs out, remaining health decides the result, with a tie possible.
- **Phone and touch:** the arena and dual action panels are responsive. The on-screen controls can be used when gestures aren't comfortable or available. If camera setup fails, the two-player touch fallback is available.

## Run locally

Open `index.html` through a local static server or deploy it over HTTPS. Camera access requires HTTPS (or localhost) and explicit browser permission. Keyboard and touch controls do not require a camera. No package build step is required for the static prototype.

## Controls

**Solo**
- **Pulse:** Space or J
- **Guard:** G or Shift
- **Phase left/right:** A/D or arrow keys
- **NOVA:** Q or Enter when the meter is full
- **Claim supply drop:** R
- **Use med kit:** E
- **Pause:** Escape

**Two-player duel**
- **Player 1:** Space (Pulse), G (Guard), A/D (Phase), Q (NOVA), R (claim drop), E (med kit)
- **Player 2:** J (Pulse), L (Guard), Left/Right arrows (Phase), U (NOVA), I (claim drop), O (med kit)
- Touch players can use each player's own on-screen control panel.

## Health, mana and supply drops

Pulses consume mana; mana regenerates over time. Guard reduces incoming damage, while a well-timed phase can evade a hit. NOVA costs a larger amount of mana, so timing matters. Med kits restore up to 28 HP and are limited; save one when health is already full. Supply drops periodically offer either a med kit or a mana orb. In local duel, one player can claim each shared drop first.

The prototype rewards timing, resource choices and adapting to an opponent; it intentionally avoids paid random loot boxes, punitive streak mechanics and pay-to-win upgrades.

## Motion input and privacy

Camera mode uses MediaPipe pose landmarks to recognize wrist movement, an upper-torso guard pose and a calibrated torso lean. The prototype requires one tracked body for Solo camera mode and two visible bodies for motion-based local duel. Keep both players apart and use controlled, comfortable air gestures—never make contact.

These are gesture heuristics, not measurements of physical force. Camera frames and landmarks are processed locally; the prototype does not upload or record camera footage and does not request microphone access. MediaPipe's model/WASM assets are downloaded from the configured CDN on first use.

## Current scope and limitations

The game includes a solo AI, a same-device local duel, touch/keyboard fallback, health and mana bars, hit/heal feedback, basic pickups, original Canvas fighter visuals, sound effects, pause/replay and a downloadable result card. Real-time online multiplayer, accounts, cloud leaderboards, monetization and automatic camera recording are not included. Camera tracking should still be tested on multiple phones and laptops before calling it production-ready.

Built by **Koglesh R. Murugan**.
