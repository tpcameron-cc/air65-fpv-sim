# Air65 FPV Sim

A lightweight browser FPV simulator for the **BetaFPV Air65** 65 mm tiny whoop. Fly acro with a real radio (RadioMaster Pocket or any USB joystick) through a procedural city, run timed ring lessons, and tune rates and physics live — no install, no build tools, works fully offline.

![Three.js](https://img.shields.io/badge/three.js-r128-black) ![No build](https://img.shields.io/badge/build-none-green) ![Offline](https://img.shields.io/badge/runs-offline-blue)

## Run it

1. Download or clone this repo (if you got a zip: **right-click → Extract All** first).
2. Double-click `index.html` (Chrome or Edge recommended).
3. Plug your radio in as a USB joystick, press any button so the browser sees it.
4. Press **Esc → CONTROLLER** and map your sticks and arm switch by moving them.
5. Flip arm with throttle low and fly.

Optional local server instead of opening the file: `npx serve` (on Windows PowerShell use `npx.cmd serve`).

The three files `index.html`, `sim.js` and `three.min.js` must stay in the same folder.

## Controls

| Key / input | Action |
|---|---|
| Sticks | Acro (rate) mode, Betaflight "Actual" rates |
| Arm switch | Arm (throttle must be low) |
| **Esc** | Pause menu |
| **R** | Respawn (at the current lesson's start, or the city start) |
| **V** | Toggle FPV / chase camera |
| Radio switch (optional) | Respawn — map it in the CONTROLLER tab |

## Features

- **Physics** — fixed 500 Hz rigid body: 25.5 g, 5.5:1 thrust-to-weight, first-order motor lag, nonlinear throttle→thrust curve, prop-inflow thrust falloff on climbs, body-frame linear + quadratic drag (ducts make vertical drag different from horizontal), rotational damping.
- **Acro flight controller** — sticks → Betaflight Actual rates (center 200, max 670, expo 0.54 by default) → P controller on body rates with drag feedforward and per-axis authority limits (yaw is weaker, like a real whoop).
- **FPV camera** — 20° uptilt, 120° horizontal FOV, both adjustable in game; optional chase camera with a small whoop model.
- **City** — procedural blocks of buildings (some with tunnels through them), sidewalks, ~750 trees, ~150 cars and ~350 people, all collidable and placed without overlaps. Rendered in about a dozen draw calls.
- **Ring lessons** with colored rings, a label on each lesson's first ring, timing and saved best times:
  | Lesson | Color | Skill |
  |---|---|---|
  | S-TURNS | yellow | weaving left/right down an avenue |
  | TIGHT TURNS | orange | a full circle inside an intersection |
  | POWER LOOP | green | vertical loop over an intersection |
  | BUILDING DIVE | red | over a 30 m roof, down the face, pull out |
  | GAP SHOTS | purple | through tunnels in two buildings |
  | ALLEY RUN | cyan | down a 4 m alley between buildings |
  | PUNCH-OUT | white | straight up through stacked rings |
- **Crashes** — choose in the menu: *physics* (bounce, scrub speed, tumble, keep flying; hard hits fail the lesson) or *reset on hit* (respawn on any wall/obstacle contact; gentle touchdowns still count as landings). Land on roofs and cars either way.
- **In-game menus** — Esc opens tabs for MENU, LESSONS, CONTROLLER (map by moving sticks/switches, live input bars, inverts) and CAMERA (view, uptilt, FOV). A RATES panel edits center/max/expo per axis while flying. All settings persist in the browser.

## Tuning

Every number lives in the `CONFIG` object at the top of [`sim.js`](sim.js). The ones that change the feel most:

| Setting | What it does |
|---|---|
| `rates.*` | Center / max / expo per axis (also editable in game) |
| `rateP`, `maxAngAccel` | How snappy rotation starts and stops |
| `quad.thrustToWeight`, `quad.mass` | Punch and hover throttle |
| `quad.thrustExponent`, `quad.idleThrottle` | Throttle curve, lift at zero throttle |
| `quad.motorTau` | Motor response lag |
| `quad.quadDrag`, `quad.linearDrag` | Top speed, floatiness, how fast it falls |
| `quad.propSpeed` | How quickly thrust fades in fast climbs |
| `crash.*` | Bounciness, friction, tumble, crash threshold, crash mode |
| `world.city.*` | City size, building heights, density of trees/cars/people, tunnels |

### Where the numbers come from

| | Real Air65 | Sim |
|---|---|---|
| Weight | 17.25 g dry + 8.3 g LAVA 1S 300 mAh = 25.5 g | 25.5 g |
| Thrust-to-weight | 5.26 (23000KV) / 5.82 (27000KV), BetaFPV | 5.5 |
| Hover throttle | ~30% racing / ~35% freestyle (fresh pack) | 31% |

Measured in the sim: full-throttle climb 9.6 m in the first second, 13 m/s max climb, ~58 km/h top speed, roll reaches 90% of 670°/s in 40 ms.

Sources: [Oscar Liang's Air65 review](https://oscarliang.com/betafpv-air65/), [BetaFPV Air65](https://betafpv.com/products/air65-brushless-whoop-quadcopter), [BetaFPV LAVA 300 mAh](https://betafpv.com/products/lava-1s-300mah-75c-battery-5pcs), [BetaFPV 0702 II motors](https://betafpv.com/collections/brushless-motors/products/0702-ii-brushless-motors).

Not modeled yet: battery sag, propwash, ground effect, wind.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page, HUD and menu markup |
| `sim.js` | Everything else: CONFIG, city, physics, controller, lessons, menus |
| `three.min.js` | Three.js r128 (MIT), bundled for offline use |

## Credits

Built on [Three.js](https://threejs.org/) (MIT license, notice kept in `three.min.js`). Not affiliated with BetaFPV.
