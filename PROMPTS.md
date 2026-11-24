# Prompts used to build the Air65 FPV Sim

Every prompt given to Claude Code to build this project, in order and word for word. Each one has a short note on what it led to.

---


```
Build a minimal browser FPV drone sim of a BetaFPV Air65 tiny whoop. Keep it lean: no build tools, no tests, no extra features, no tuning or polishing passes. Write it once and stop.

- Plain index.html + one sim.js, Three.js loaded from a CDN. Runs by opening the file or `npx serve`.
- Input: Gamepad API (RadioMaster Pocket in USB joystick mode). Put axis indices, inverts, and arm button in a CONFIG object at the top of sim.js. Show live axis values on screen so I can map them myself.
- Physics: fixed-timestep rigid body. ~20 g mass, thrust-to-weight ~4, simple motor lag, linear + rotational drag, gravity.
- Acro mode only: sticks → target rates using Betaflight "Actual" rates (center 200, max 670, expo 0.54), simple P-controller on body rates.
- FPV camera with 20° uptilt, ~120° FOV. Arm switch, R to reset.
- World: one box room with a few boxes and a hoop. Collisions just stop and reset the quad.
- All tunable numbers in the CONFIG object. I'll tune them myself.

Don't explain the code at length. Just tell me how to run it and which CONFIG values control feel.
```
*Result: first version, with `index.html` and `sim.js`.*


```
when i hit an object it auto resets. I like that. The space needs to be larger, remove the side walls and remove the artificial ceiling. when i go above the ceiling ti resets. if you cant remove them, make the signifigantly larger.
```
*Result: an open 200 m ground plane with no walls or ceiling.*

```
Research the air65 specifically. understand its weight and thrust. Review videos of it flying and compare it to the sim. automatically test and tune this to be more accurate to real flying
```
*Result: drag that builds with speed, a thrust curve, weaker yaw, and automated in-browser flight tests.*


```
change the scenery to be in a city
```
*Result: a procedural city of buildings with windows, streets and sidewalks.*

```
add a menu similar to the one currently on the screen that lets me tune the rates.
```
*Result: an on-screen RATES panel.*


```
add a pause menu has an option to bring it up. pause menue can be opened with escape.
```
*Result: an Esc pause menu that can show or hide the rates panel.*

```
add trees, cars, and static people models throughout the city. Add holes in some buildings. . They dont have to be pretty, prioritize low usage. add more rings around the city. make them paths that teach skills. such as S turns,  building dives, tight turns, etc. make each skill a different color with a label on the first ring of each skill lesson.
```
*Result: trees, cars, people and building tunnels, drawn with batched rendering and fast collision lookups, plus 7 colour-coded ring lessons.*

```
i feel too floaty, as in gravity isnt heavy enough. I dont ever feel lik eim going to fall out of the sky
```
*Result: much less up/down drag, and thrust that fades in fast climbs.*

```
continue to make improvements to the gameplay and functionality of this simulator
```
*Result: lesson timing and best times, a lesson-select menu, rooftop landings, a compact flight readout and crash messages.*

```
review the weight and power of an air65. this seems way too forgiving. almost like an arcade compared to the real world. real world is much more punchy. review logs and black box data of real air 65 flying
```
*Result: retuned to the real Air65: 25.5 g, 5.5:1 thrust-to-weight, ~31% hover throttle, faster motors and quicker rotation.*

```
there are cars and objects  and such that overlap . refine.
```
*Result: objects are only placed in free space, so nothing overlaps.*

```
now instead of resetting on crash, add crash physics
```
*Result: crashes bounce, scrape and tumble instead of resetting.*

```
now the tree tops arent touching the trunks. fix this. also review and propose new features
```
*Result: tree crowns lowered onto their trunks, and a list of 9 proposed features.*

```
add 3 and 6. also move the runs in the menu to their own menu tab
```
*Result: a tabbed menu with MENU, LESSONS, CONTROLLER (map by moving sticks) and CAMERA (tilt, FOV, chase view).*

```
add a setting that allows me to switch to reset on crash instead of crash physics. make it full offline
```
*Result: a Crashes toggle (physics or reset on hit), and a local copy of Three.js so it runs with no internet.*


