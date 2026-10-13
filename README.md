# Kinetix

**Your body. Your power. Your arena.**

Kinetix is a browser-first, motion-powered fantasy combat prototype by Koglesh R. Murugan. The first mode, Rift Duel, combines readable enemy attack warnings, timing-based combat, lane dodges, gesture input and original energy effects.

This is an early playable prototype, not a finished commercial game or a claim of being the first webcam-controlled game.

## Run locally

The app is served as a static site. Open `index.html` through a local static server or deploy it over HTTPS. Camera mode requires HTTPS (or localhost) and explicit browser permission. Keyboard/click mode works without camera access.

## Controls

- **Pulse:** Space / J / on-screen button
- **Guard:** G / Shift / on-screen button
- **Phase left/right:** A/D or arrow keys / on-screen buttons
- **NOVA:** Q / Enter when energy is full
- **Pause:** Escape

## Motion input and privacy

Camera mode uses browser-based pose landmarks to recognize controlled wrist movements, an upper-torso guard pose and a calibrated torso lean. These are gesture heuristics, not physical-force measurements. Camera frames and landmarks are processed locally; the prototype does not upload or record camera footage and does not request microphone access. Model assets may be downloaded from their configured CDN on first use.

Keep the surrounding space clear, use comfortable movement and do not strike objects or people.

## Scope

Rift Duel includes a single-player encounter, HUD, timing windows, energy, a NOVA finisher, pause/replay, audio effects, keyboard fallback and a downloadable score card. Online PvP, accounts, cloud leaderboards, payments and automatic video recording are not part of the MVP.

Built by **Koglesh R. Murugan**.