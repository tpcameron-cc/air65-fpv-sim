// BetaFPV Air65 minimal FPV sim. Units: meters, kg, seconds, degrees where noted.
const CONFIG = {
  input: {
    gamepadIndex: null,              // null = first connected gamepad
    axes:   { roll: 0, pitch: 1, throttle: 2, yaw: 3 },
    invert: { roll: false, pitch: false, throttle: false, yaw: false },
    throttleMin: -1, throttleMax: 1, // raw axis values at throttle low/high
    deadband: 0.01,                  // sticks (not throttle)
    arm: { type: 'axis', index: 4, axisThreshold: 0.5, invert: false }, // type 'button' or 'axis'; invert = active below threshold
    armMaxThrottle: 0.05,            // must be below this to arm
    resetSwitch: { type: 'button', index: null, axisThreshold: 0.5, invert: false }, // radio switch/button that respawns; null = off
  },                                 // (the CONTROLLER tab in the Esc menu overrides these and remembers them)
  rates: {                           // Betaflight "Actual"
    roll:  { center: 200, max: 670, expo: 0.54 },
    pitch: { center: 200, max: 670, expo: 0.54 },
    yaw:   { center: 200, max: 670, expo: 0.54 },
  },
  rateP: { roll: 45, pitch: 45, yaw: 30 }, // angular accel (rad/s^2) per rad/s of rate error
  maxAngAccel: { roll: 600, pitch: 600, yaw: 200 }, // rad/s^2 authority limit per axis
  quad: {
    mass: 0.0255,                    // Air65 17.25 g dry + LAVA 1S 300 mAh 8.3 g
    thrustToWeight: 5.5,             // BetaFPV: 5.26 (23000KV) / 5.82 (27000KV); ~37 g/motor bench at 4 V
    thrustExponent: 1.5,             // thrust ~ throttle^exp; gives ~30% hover like real Air65 racing
    idleThrottle: 0.015,             // fraction of max thrust when armed at zero throttle (~7% motor idle)
    propSpeed: 25,                   // m/s climb speed where thrust reaches zero (prop inflow falloff)
    motorTau: 0.012,                 // first-order motor lag time constant (s); 31 mm props, 96 kHz Bluejay
    linearDrag: 0.01,                // N per m/s
    quadDrag: [0.003, 0.0015, 0.003], // N per (m/s)^2, body axes [side, up/down, fore/aft]
    rotDrag: 2.0,                    // 1/s, angular velocity damping
    radius: 0.033,                   // collision sphere
  },
  crash: {
    restitution: 0.35,               // bounciness (0 = dead stop, 1 = perfect bounce); whoop ducts are springy
    friction: 0.5,                   // how much sideways speed an impact / sliding contact scrubs off
    bounceMinSpeed: 0.6,             // m/s; slower touches just settle (landing)
    tumble: 4,                       // rad/s of random spin added per m/s of impact
    contactSpinDamp: 8,              // 1/s spin damping while touching something
    hardSpeed: 5,                    // m/s impact that counts as a CRASH (flash + lesson run cancelled)
    mode: 'physics',                 // 'physics' = bounce & keep flying, 'reset' = respawn on any hit (MENU tab toggles)
    landingSpeed: 1.5,               // reset mode: touching down on top of something slower than this is a landing
  },
  camera: { uptiltDeg: 20, hfovDeg: 120, near: 0.01, far: 400,
            view: 'fpv', chaseDist: 0.45, chaseHeight: 0.15 }, // view 'fpv' or 'chase' (CAMERA tab overrides)
  gravity: 9.81,
  physicsHz: 500,
  world: {
    floorSize: 600,                  // open ground plane at y=0, no walls or ceiling
    start: [0, 0.033, 3.5],          // in the middle of an intersection
    city: {
      seed: 7,
      blocks: 4,                     // blocks each direction from center (grid is 2*blocks square)
      blockSize: 40,                 // m, each block split into 2x2 lots
      streetWidth: 14,
      lotGap: 4,                     // alley between buildings in a block
      sidewalk: 3,
      minHeight: 6, maxHeight: 70,
      emptyLotChance: 0.12,          // lots left as open plazas
      holeChance: 0.15,              // buildings with a tunnel through them
      hole: { w: 4, h: 3.5 },
      treeSpacing: 9, treeChance: 0.6,
      carsPerStreet: 2,              // max cars per street segment
      peoplePerBlock: 6,
    },
    boxes: [],                        // extra obstacles: { pos: [x,y,z], size: [w,h,d] }
    ringTube: 0.06,                   // ring tube thickness as fraction of ring radius
    strike: {                         // STRIKE map (MAPS tab): find soldiers and fly into them
      size: 300,                      // m square
      roadX: 20,                      // dirt road along z; town is west of it, forest east
      townPitch: 22,                  // spacing of the ruined buildings
      trees: 2600,                    // pine placement attempts (overlaps are skipped)
      clearings: 6,
      soldiersTown: 12, soldiersForest: 12,
      hitPadding: 0.15,               // m added around a soldier for a hit to count
      launch: [20, 0, 140],           // launch point on the road at the south edge, facing north
    },
  },
};

// settings saved from the in-game menus override the defaults above
const INPUT_DEFAULTS = JSON.parse(JSON.stringify(CONFIG.input)), CAMERA_DEFAULTS = JSON.parse(JSON.stringify(CONFIG.camera));
try { const si = JSON.parse(localStorage.getItem('air65-input')); if (si) for (const k of ['axes', 'invert', 'arm', 'resetSwitch']) if (si[k]) CONFIG.input[k] = si[k]; } catch (e) {}
try { const sc = JSON.parse(localStorage.getItem('air65-camera')); if (sc) Object.assign(CONFIG.camera, sc); } catch (e) {}

// ---------- Scene ----------
const W = CONFIG.world;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202428);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(3, 5, 2); scene.add(sun);

scene.background = new THREE.Color(0x87a8c8);
scene.fog = new THREE.Fog(0x87a8c8, 80, 350);
// each map lives in its own group with its own collision grid; switching maps swaps both
const cityRoot = new THREE.Group(), strikeRoot = new THREE.Group();
scene.add(cityRoot, strikeRoot); strikeRoot.visible = false;
let root = cityRoot;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W.floorSize, W.floorSize),
  new THREE.MeshLambertMaterial({ color: 0x3a3d42 }));
floor.rotation.x = -Math.PI / 2; root.add(floor);

// --- city ---
const C = W.city, pitch = C.blockSize + C.streetWidth, half = C.blockSize / 2;
let seed = C.seed; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const dummy = new THREE.Object3D(), tmpColor = new THREE.Color();
function instanced(geo, mat, list) {          // list: [{ pos, rotY, s, color }]
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, i) => {
    dummy.position.set(...it.pos); dummy.rotation.set(0, it.rotY || 0, 0); dummy.scale.setScalar(it.s || 1);
    dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    if (it.color !== undefined) m.setColorAt(i, tmpColor.setHex(it.color));
  });
  m.count = list.length; root.add(m); return m;
}

// collision grid (xz cells) so per-step checks only touch nearby objects
const CELL = 8, ckey = (ix, iz) => ix * 65536 + iz, cityGrid = new Map(), strikeGrid = new Map();
let cgrid = cityGrid;
function addCollider(c, min, max) {
  const r = CONFIG.quad.radius;
  for (let ix = Math.floor((min.x - r) / CELL); ix <= Math.floor((max.x + r) / CELL); ix++)
    for (let iz = Math.floor((min.z - r) / CELL); iz <= Math.floor((max.z + r) / CELL); iz++) {
      const k = ckey(ix, iz); let a = cgrid.get(k); if (!a) cgrid.set(k, a = []); a.push(c);
    }
}
function addBoxCollider(pos, size) {
  const h = new THREE.Vector3(...size).multiplyScalar(0.5);
  const c = { min: new THREE.Vector3(...pos).sub(h), max: new THREE.Vector3(...pos).add(h) };
  addCollider(c, c.min, c.max);
}

// lot geometry
const lot = (C.blockSize - 2 * C.sidewalk - C.lotGap) / 2;
const lotC = (b, i) => (b + 0.5) * pitch + (i - 0.5) * (lot + C.lotGap); // lot center along one axis
const blockC = b => (b + 0.5) * pitch;
const holeMid = 1 + C.hole.h / 2;

// ---- ring lessons ----
const ringSpecs = [], labels = [], lessons = [];
const R = (pos, dir, r = 1) => ({ pos, dir, r });
function lesson(name, color, rings) {
  const li = lessons.length; lessons.push({ name, color, start: ringSpecs.length, n: rings.length });
  labels.push({ name, color, ring: rings[0] }); rings.forEach((r, idx) => ringSpecs.push({ ...r, color, li, idx }));
}
// S-turns: weave down the start avenue
lesson('S-TURNS', 0xffd400, Array.from({ length: 9 }, (_, i) => R([i % 2 ? 4 : -4, 2.5, -10 - i * 10], [0, 0, -1])));
// Tight turns: full circle inside the next intersection
lesson('TIGHT TURNS', 0xff8c00, Array.from({ length: 10 }, (_, i) => {
  const a = i / 10 * Math.PI * 2; return R([5 * Math.cos(a), 2, -2 * pitch + 5 * Math.sin(a)], [-Math.sin(a), 0, Math.cos(a)]);
}));
// Power loop: vertical loop over an intersection, entering heading -X
lesson('POWER LOOP', 0x30e060, Array.from({ length: 8 }, (_, i) => {
  const f = i / 8 * Math.PI * 2; return R([-2 * pitch - 6 * Math.sin(f), 7 - 6 * Math.cos(f), 0], [-Math.cos(f), Math.sin(f), 0], 1.3);
}));
// Building dive: over a 30 m roof, down its face, pull out along the avenue
const diveX = lotC(0, 0), diveZ = lotC(0, 0), diveH = 30, faceX = diveX - lot / 2;
lesson('BUILDING DIVE', 0xff3030, [
  R([faceX + 3, diveH + 3, diveZ], [-1, 0, 0], 1.5),
  R([faceX - 6, diveH - 4, diveZ], [0, -1, 0], 1.5),
  R([faceX - 6, diveH - 14, diveZ], [0, -1, 0], 1.5),
  R([faceX - 6, diveH - 22, diveZ], [0, -1, 0], 1.5),
  R([0, 2.5, diveZ + 12], [0, 0, 1], 1.5),
]);
// Gap shots: through tunnels in two buildings
const gapZ = lotC(0, 0), gapA = lotC(-1, 1), gapB = lotC(-1, 0);
lesson('GAP SHOTS', 0xb040ff, [
  R([gapA + lot / 2 + 3, holeMid, gapZ], [-1, 0, 0], 1.2),
  R([(gapA + gapB) / 2, holeMid, gapZ], [-1, 0, 0], 1.2),
  R([gapB - lot / 2 - 3, holeMid, gapZ], [-1, 0, 0], 1.2),
]);
// Alley run: down the narrow gap between buildings
const alleyX = (lotC(0, 0) + lotC(0, 1)) / 2, alleyZ = blockC(-1);
lesson('ALLEY RUN', 0x20d0f0, [half - 1.5, 9, 0, -9, -(half - 1.5)].map(t => R([alleyX, 2.5, alleyZ + t], [0, 0, -1])));
// Punch-out: stacked flat rings straight up
lesson('PUNCH-OUT', 0xffffff, [2, 8, 16, 26, 38].map(y => R([pitch, y, 0], [0, 1, 0], 1.5)));

const forced = {                       // lots the lessons depend on: key bx,bz,i,j
  '0,0,0,0': { h: diveH },
  '-1,0,1,0': { h: 14, hole: { axis: 'x', y1: 1, y2: 1 + C.hole.h } },
  '-1,0,0,0': { h: 14, hole: { axis: 'x', y1: 1, y2: 1 + C.hole.h } },
};
function clearOfRings(x, z, top, ext) {
  for (const r of ringSpecs)
    if (r.pos[1] - r.r < top + 1 && Math.hypot(r.pos[0] - x, r.pos[2] - z) < r.r + ext + 2) return false;
  return Math.hypot(x - W.start[0], z - W.start[2]) > 8;
}

// sidewalks / block bases
const walkMat = new THREE.MeshLambertMaterial({ color: 0x8c8c88 });
// street centerline dashes
const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c860 });
const ext = C.blocks * pitch, nPer = Math.floor(2 * ext / 6), nLines = 2 * C.blocks + 1;
const dashGeo = new THREE.PlaneGeometry(0.2, 3).rotateX(-Math.PI / 2);
const dashes = new THREE.InstancedMesh(dashGeo, dashMat, nLines * nPer * 2);
const dm = new THREE.Object3D(); let di = 0;
for (let k = -C.blocks; k <= C.blocks; k++) for (let n = 0; n < nPer; n++) {
  const t = -ext + n * 6;
  dm.rotation.set(0, 0, 0); dm.position.set(k * pitch, 0.01, t); dm.updateMatrix(); dashes.setMatrixAt(di++, dm.matrix);
  dm.rotation.set(0, Math.PI / 2, 0); dm.position.set(t, 0.01, k * pitch); dm.updateMatrix(); dashes.setMatrixAt(di++, dm.matrix);
}
root.add(dashes);
// window texture
const cv = document.createElement('canvas'); cv.width = cv.height = 64;
const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 64, 64);
cx.fillStyle = '#556677'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) cx.fillRect(6 + i * 32, 8 + j * 32, 20, 18);
const winTex = new THREE.CanvasTexture(cv); winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
const tints = [0xd8cfc0, 0xb8b0a8, 0xc8a080, 0x9aa4b0, 0xe0e0d8, 0xa89080];

// buildings: every box is merged into ONE mesh (one draw call)
const bparts = [];
function addPart(pos, size, color) {
  if (size[0] < 0.01 || size[1] < 0.01 || size[2] < 0.01) return;
  bparts.push({ pos, size, color }); addBoxCollider(pos, size);
}
function addBuilding(x, z, w, d, h, color, hole) {
  const base = 0.15, top = base + h;
  if (!hole) return addPart([x, (base + top) / 2, z], [w, h, d], color);
  const { y1, y2 } = hole, hw = C.hole.w / 2, hy = (y1 + y2) / 2, hh = y2 - y1;
  addPart([x, (base + y1) / 2, z], [w, y1 - base, d], color);
  addPart([x, (y2 + top) / 2, z], [w, top - y2, d], color);
  if (hole.axis === 'x') { const sz = d / 2 - hw;  // tunnel runs along x
    addPart([x, hy, z - hw - sz / 2], [w, hh, sz], color); addPart([x, hy, z + hw + sz / 2], [w, hh, sz], color);
  } else { const sx = w / 2 - hw;
    addPart([x - hw - sx / 2, hy, z], [sx, hh, d], color); addPart([x + hw + sx / 2, hy, z], [sx, hh, d], color);
  }
}
const curbs = [], treeSpots = [];
for (let bx = -C.blocks; bx < C.blocks; bx++) for (let bz = -C.blocks; bz < C.blocks; bz++) {
  curbs.push({ pos: [blockC(bx), 0, blockC(bz)] });
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const f = forced[`${bx},${bz},${i},${j}`];
    const x = lotC(bx, i), z = lotC(bz, j);
    if (!f && rnd() < C.emptyLotChance) {      // plaza: a few trees
      for (let t = 0; t < 3; t++) treeSpots.push([x + (rnd() - 0.5) * lot * 0.7, z + (rnd() - 0.5) * lot * 0.7]);
      continue;
    }
    const h = f ? f.h : C.minHeight + Math.pow(rnd(), 2) * (C.maxHeight - C.minHeight);
    const size = f ? lot : lot - rnd() * 2;
    let hole = f ? f.hole : null;
    if (!f && h > 10 && rnd() < C.holeChance) {
      const y1 = 1 + rnd() * (h - C.hole.h - 3); hole = { axis: rnd() < 0.5 ? 'x' : 'z', y1, y2: y1 + C.hole.h };
    }
    addBuilding(x, z, size, size, h, pick(tints), hole);
  }
}
W.boxes.forEach(b => addPart(b.pos, b.size, 0xc0743a));
function mergeParts(parts) {
  const P = [], N = [], U = [], Cl = [], col = new THREE.Color(), roof = new THREE.Color(), s = 1 / 7;
  for (const b of parts) {
    const [w, h, d] = b.size, g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];  // roof/floor get plain UV (0,0)
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
      const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] * s, uv.getY(i) * dims[f][1] * s);
    }
    g.translate(...b.pos);
    const ng = g.toNonIndexed(), p = ng.attributes.position.array, n = ng.attributes.normal.array, u = ng.attributes.uv.array;
    col.setHex(b.color); roof.copy(col).multiplyScalar(0.55);
    for (let i = 0; i < p.length / 3; i++) {
      P.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]); N.push(n[3 * i], n[3 * i + 1], n[3 * i + 2]); U.push(u[2 * i], u[2 * i + 1]);
      const c = Math.abs(n[3 * i + 1]) > 0.5 ? roof : col; Cl.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cl, 3));
  root.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: winTex, vertexColors: true })));
}
mergeParts(bparts);
instanced(new THREE.BoxGeometry(C.blockSize, 0.15, C.blockSize).translate(0, 0.075, 0), walkMat, curbs); // no collision

// ---- trees, cars, people (instanced, box colliders) ----
const edgeOff = half - 1;                     // trees near the curb, clear of building faces
for (let bx = -C.blocks; bx < C.blocks; bx++) for (let bz = -C.blocks; bz < C.blocks; bz++)
  for (let t = -half + 2; t <= half - 2; t += C.treeSpacing) {
    const cx0 = blockC(bx), cz0 = blockC(bz);
    for (const [x, z] of [[cx0 + t, cz0 - edgeOff], [cx0 + t, cz0 + edgeOff], [cx0 - edgeOff, cz0 + t], [cx0 + edgeOff, cz0 + t]])
      if (rnd() < C.treeChance) treeSpots.push([x, z]);
  }
// true if a box (center pos, size) plus a side margin doesn't touch anything already placed
function isFree(pos, size, m = 0.3) {
  const x0 = pos[0] - size[0] / 2 - m, x1 = pos[0] + size[0] / 2 + m, z0 = pos[2] - size[2] / 2 - m, z1 = pos[2] + size[2] / 2 + m;
  const y0 = pos[1] - size[1] / 2, y1 = pos[1] + size[1] / 2;
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
    for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++)
      for (const c of cgrid.get(ckey(ix, iz)) || [])
        if (!c.ring && c.min.x < x1 && c.max.x > x0 && c.min.z < z1 && c.max.z > z0 && c.min.y < y1 && c.max.y > y0) return false;
  return true;
}
const trees = [];
for (const [x, z] of treeSpots) {
  const sc = 0.8 + rnd() * 0.5;
  const trunk = [[x, 0.15 + sc, z], [0.4 * sc, 2 * sc, 0.4 * sc]], crown = [[x, 0.15 + 2.7 * sc, z], [2.2 * sc, 2.2 * sc, 2.2 * sc]];
  if (!clearOfRings(x, z, 3.8 * sc, 1.1 * sc) || !isFree(...trunk) || !isFree(...crown)) continue;
  trees.push({ pos: [x, 0.15, z], s: sc, rotY: rnd() * 6 });
  addBoxCollider(...trunk); addBoxCollider(...crown);
}
instanced(new THREE.CylinderGeometry(0.15, 0.2, 2, 5).translate(0, 1, 0), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }), trees);
instanced(new THREE.IcosahedronGeometry(1.1, 0).translate(0, 2.7, 0), new THREE.MeshLambertMaterial({ color: 0x3f7a35, flatShading: true }), trees);

const cars = [], carColors = [0xc03030, 0x2050b0, 0xe0e0e0, 0x202020, 0xd0b020, 0x708090];
for (let k = -C.blocks; k <= C.blocks; k++) for (let b = -C.blocks; b < C.blocks; b++) for (const alongZ of [true, false]) {
  const n = Math.floor(rnd() * (C.carsPerStreet + 1));
  for (let c = 0; c < n; c++) {
    const lane = rnd() < 0.5 ? -3.5 : 3.5, t = blockC(b) + (rnd() * 2 - 1) * (half - 3);
    const x = alongZ ? k * pitch + lane : t, z = alongZ ? t : k * pitch + lane;
    const box = [[x, 0.825, z], alongZ ? [1.8, 1.65, 4.2] : [4.2, 1.65, 1.8]];
    if (!clearOfRings(x, z, 1.65, 2.1) || !isFree(...box, 0.8)) continue;
    cars.push({ pos: [x, 0, z], rotY: alongZ ? 0 : Math.PI / 2, color: pick(carColors) });
    addBoxCollider(...box);
  }
}
instanced(new THREE.BoxGeometry(1.8, 0.9, 4.2).translate(0, 0.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), cars);
instanced(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.35, -0.2), new THREE.MeshLambertMaterial({ color: 0x223344 }), cars);

const people = [], shirtColors = [0xd04040, 0x4060d0, 0x40a040, 0xe0e0e0, 0x303030, 0xe0a030];
for (let bx = -C.blocks; bx < C.blocks; bx++) for (let bz = -C.blocks; bz < C.blocks; bz++)
  for (let i = 0; i < C.peoplePerBlock; i++) {
    const t = (rnd() * 2 - 1) * (half - 1), o = half - 0.5 - rnd() * (C.sidewalk - 1), e = Math.floor(rnd() * 4);
    const x = blockC(bx) + [t, t, -o, o][e], z = blockC(bz) + [-o, o, t, t][e];
    const box = [[x, 0.15 + 0.875, z], [0.5, 1.75, 0.5]];
    if (!clearOfRings(x, z, 1.75, 0.3) || !isFree(...box, 0.25)) continue;
    people.push({ pos: [x, 0.15, z], rotY: rnd() * 6, color: pick(shirtColors) });
    addBoxCollider(...box);
  }
instanced(new THREE.BoxGeometry(0.45, 1.45, 0.28).translate(0, 0.725, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), people);
instanced(new THREE.BoxGeometry(0.25, 0.25, 0.25).translate(0, 1.6, 0), new THREE.MeshLambertMaterial({ color: 0xd8b090 }), people);

// ---- rings (instanced) + lesson labels ----
const Zaxis = new THREE.Vector3(0, 0, 1);
const ringMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1, W.ringTube, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }), ringSpecs.length);
ringSpecs.forEach((rs, i) => {
  const q = new THREE.Quaternion().setFromUnitVectors(Zaxis, new THREE.Vector3(...rs.dir).normalize());
  dummy.position.set(...rs.pos); dummy.quaternion.copy(q); dummy.scale.setScalar(rs.r); dummy.updateMatrix();
  ringMesh.setMatrixAt(i, dummy.matrix); ringMesh.setColorAt(i, tmpColor.setHex(rs.color));
  const c = { ring: true, pos: new THREE.Vector3(...rs.pos), qInv: q.clone().invert(), r: rs.r, tube: rs.r * W.ringTube };
  c.q = q; rs.c = c;
  const e = rs.r + c.tube; addCollider(c, c.pos.clone().subScalar(e), c.pos.clone().addScalar(e));
});
dummy.quaternion.identity(); root.add(ringMesh);
for (const l of labels) {
  const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 96;
  const g = cvs.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 512, 96);
  g.font = 'bold 52px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#' + l.color.toString(16).padStart(6, '0'); g.fillText(l.name, 256, 50);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs) }));
  sp.scale.set(5, 0.94, 1); sp.position.set(l.ring.pos[0], l.ring.pos[1] + l.ring.r + 1.2, l.ring.pos[2]); root.add(sp);
}

// ================= STRIKE MAP: urban ruins (west) + forest (east), hidden soldiers =================
const S = W.strike;
root = strikeRoot; cgrid = strikeGrid;
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W.floorSize, W.floorSize), new THREE.MeshLambertMaterial({ color: 0x5a5a3c }));
  ground.rotation.x = -Math.PI / 2; root.add(ground);
  // dirt road from the launch point north, splitting the town and the forest
  const road = new THREE.Mesh(new THREE.PlaneGeometry(8, S.size).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6e5f46 }));
  road.position.set(S.roadX, 0.01, 0); root.add(road);
}
const strikeParts = [], ruinTints = [0x8a8478, 0x9a948a, 0x7a746c, 0xa49c8e, 0x6c6660];
const sHalf = S.size / 2;
// --- urban section: small blocks of low, damaged buildings with gaps, walls and rubble ---
{
  const add = (pos, size, color) => { strikeParts.push({ pos, size, color }); addBoxCollider(pos, size); };
  for (let x = -sHalf + 10; x < S.roadX - 24; x += S.townPitch) for (let z = -sHalf + 10; z < sHalf - 30; z += S.townPitch) {
    if (rnd() < 0.15) continue;                                   // open lot
    const w = 8 + rnd() * 8, d = 8 + rnd() * 8, h = 3 + rnd() * (rnd() < 0.2 ? 16 : 7);
    const cx = x + rnd() * 3, cz = z + rnd() * 3, col = pick(ruinTints);
    if (rnd() < 0.35) {                                           // bombed-out shell: walls only, open roof
      const t = 0.5, hh = h * (0.5 + rnd() * 0.5);
      add([cx, hh / 2, cz - d / 2 + t / 2], [w, hh, t], col); add([cx, hh / 2, cz + d / 2 - t / 2], [w, hh * 0.6, t], col);
      add([cx - w / 2 + t / 2, hh / 2, cz], [t, hh * 0.8, d - 2 * t], col);
    } else {
      const holeY = 1 + rnd() * Math.max(0.1, h - 5);
      const hole = h > 6 && rnd() < 0.4 ? { axis: rnd() < 0.5 ? 'x' : 'z', y1: holeY, y2: holeY + 2.5 } : null;
      const saved = bparts.length; addBuilding(cx, cz, w, d, h, col, hole);
      strikeParts.push(...bparts.splice(saved));                  // addBuilding wrote into the city list; move it
    }
    for (let k = 0; k < 3; k++) {                                 // rubble piles
      const rx = cx + (rnd() - 0.5) * (w + 6), rz = cz + (rnd() - 0.5) * (d + 6), rs = 0.6 + rnd() * 1.4;
      if (isFree([rx, rs / 2, rz], [rs * 1.5, rs, rs])) add([rx, rs / 2, rz], [rs * 1.5, rs, rs], 0x77706a);
    }
  }
  mergeParts(strikeParts);
  // burned-out vehicles along the road edge
  const wrecks = [];
  for (let z = -sHalf + 20; z < sHalf - 40; z += 18 + rnd() * 20) {
    const x = S.roadX + (rnd() < 0.5 ? -5.5 : 5.5), box = [[x, 0.825, z], [1.8, 1.65, 4.2]];
    if (!isFree(...box, 0.8)) continue;
    wrecks.push({ pos: [x, 0, z], rotY: (rnd() - 0.5) * 0.6, color: 0x2a2622 }); addBoxCollider(...box);
  }
  instanced(new THREE.BoxGeometry(1.8, 0.9, 4.2).translate(0, 0.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), wrecks);
  instanced(new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.35, -0.2), new THREE.MeshLambertMaterial({ color: 0x151515 }), wrecks);
}
// --- forest section: dense pines with a few clearings ---
const clearings = Array.from({ length: S.clearings }, () => [S.roadX + 25 + rnd() * (sHalf - S.roadX - 40), -sHalf + 20 + rnd() * (S.size - 70), 8 + rnd() * 8]);
{
  const pines = [];
  for (let i = 0; i < S.trees; i++) {
    const x = S.roadX + 8 + rnd() * (sHalf - S.roadX - 10), z = -sHalf + 5 + rnd() * (S.size - 45), sc = 0.8 + rnd() * 0.9;
    if (clearings.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
    const trunk = [[x, 1.5 * sc, z], [0.4 * sc, 3 * sc, 0.4 * sc]], crown = [[x, 5 * sc, z], [3 * sc, 6 * sc, 3 * sc]];
    if (!isFree(...trunk, 0.2) || !isFree(...crown, 0)) continue;
    pines.push({ pos: [x, 0, z], s: sc, rotY: rnd() * 6 }); addBoxCollider(...trunk); addBoxCollider(...crown);
  }
  instanced(new THREE.CylinderGeometry(0.15, 0.22, 3, 5).translate(0, 1.5, 0), new THREE.MeshLambertMaterial({ color: 0x5a3e24 }), pines);
  instanced(new THREE.ConeGeometry(1.5, 6, 6).translate(0, 5, 0), new THREE.MeshLambertMaterial({ color: 0x2f5a2a, flatShading: true }), pines);
}
// --- soldiers: half in town, half in the forest; colliders are tagged so a hit counts ---
const soldiers = [];
{
  const place = (x, z) => {
    const box = [[x, 0.9, z], [0.6, 1.8, 0.6]];
    if (!isFree(...box, 0.4) || Math.hypot(x - S.launch[0], z - S.launch[2]) < 40) return false;
    const c = { min: new THREE.Vector3(x - 0.3, 0, z - 0.3), max: new THREE.Vector3(x + 0.3, 1.8, z + 0.3), soldier: soldiers.length };
    addCollider(c, c.min, c.max); soldiers.push({ pos: [x, 0, z], rotY: rnd() * 6, alive: true, area: x < S.roadX ? 'town' : 'forest' });
    return true;
  };
  for (let n = 0, tries = 0; n < S.soldiersTown && tries < 5000; tries++)
    if (place(-sHalf + 8 + rnd() * (S.roadX - 12 + sHalf - 8), -sHalf + 8 + rnd() * (S.size - 50))) n++;
  for (let n = 0, tries = 0; n < S.soldiersForest && tries < 5000; tries++) {
    const cl = rnd() < 0.4 ? pick(clearings) : null;             // some in clearings, most under the trees
    const x = cl ? cl[0] + (rnd() - 0.5) * cl[2] : S.roadX + 10 + rnd() * (sHalf - S.roadX - 14);
    const z = cl ? cl[1] + (rnd() - 0.5) * cl[2] : -sHalf + 8 + rnd() * (S.size - 50);
    if (place(x, z)) n++;
  }
}
const olive = new THREE.MeshLambertMaterial({ color: 0x4b5320 });
const soldierMeshes = [
  instanced(new THREE.BoxGeometry(0.45, 1.3, 0.3).translate(0, 0.65, 0), olive, soldiers),                                                         // body
  instanced(new THREE.BoxGeometry(0.3, 0.22, 0.3).translate(0, 1.47, 0), new THREE.MeshLambertMaterial({ color: 0xc8a07a }), soldiers),            // face
  instanced(new THREE.BoxGeometry(0.36, 0.14, 0.36).translate(0, 1.64, 0), new THREE.MeshLambertMaterial({ color: 0x3a4018 }), soldiers),          // helmet
  instanced(new THREE.BoxGeometry(0.06, 0.08, 0.8).translate(0.25, 1.0, -0.2), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), soldiers),      // rifle
];
function hideSoldier(i, hidden) {
  const it = soldiers[i]; dummy.position.set(...it.pos); dummy.rotation.set(0, it.rotY, 0); dummy.scale.setScalar(hidden ? 0 : 1); dummy.updateMatrix();
  for (const m of soldierMeshes) { m.setMatrixAt(i, dummy.matrix); m.instanceMatrix.needsUpdate = true; }
  dummy.scale.setScalar(1);
}
// impact fireball (one reused sprite)
const boomCv = document.createElement('canvas'); boomCv.width = boomCv.height = 64;
{ const g = boomCv.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, '#fff6c0'); gr.addColorStop(0.4, '#ff9a20'); gr.addColorStop(1, 'rgba(80,30,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
const boom = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(boomCv), transparent: true, depthWrite: false }));
boom.visible = false; root.add(boom);
const strikeSpawn = { pos: new THREE.Vector3(S.launch[0], CONFIG.quad.radius + 0.001, S.launch[2]), q: new THREE.Quaternion() };
root = cityRoot; cgrid = cityGrid;

const camera = new THREE.PerspectiveCamera(60, 1, CONFIG.camera.near, CONFIG.camera.far);
const tiltQ = new THREE.Quaternion();
const updateTilt = () => tiltQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), CONFIG.camera.uptiltDeg * Math.PI / 180);
updateTilt();

// quad model, only visible in chase view (65 mm whoop: 4 ducts + body + canopy)
const quadModel = new THREE.Group(); quadModel.visible = false; scene.add(quadModel);
{
  const ductMat = new THREE.MeshLambertMaterial({ color: 0x202020 }), bodyMat = new THREE.MeshLambertMaterial({ color: 0x3060ff });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16, 1, true), ductMat);
    d.material.side = THREE.DoubleSide; d.position.set(x * 0.023, 0, z * 0.023); quadModel.add(d);
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.015, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.35 }));
    p.position.set(x * 0.023, 0.004, z * 0.023); quadModel.add(p);
  }
  quadModel.add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.03), bodyMat));
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.008), ductMat); cam.position.set(0, 0.008, -0.012); quadModel.add(cam);
}
const chasePos = new THREE.Vector3(), chaseFwd = new THREE.Vector3(0, 0, -1);
function resize() {
  const a = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = a;
  camera.fov = 2 * Math.atan(Math.tan(CONFIG.camera.hfovDeg * Math.PI / 360) / a) * 180 / Math.PI;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- State ----------
// Body frame: +Y up (thrust), -Z forward, +X right.
const s = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(),
  w: [0, 0, 0], aa: [0, 0, 0], thrust: 0, armed: false,
};
const citySpawn = { pos: new THREE.Vector3(...W.start), q: new THREE.Quaternion() };
let spawn = citySpawn, currentMap = 'city';
function reset() {
  s.pos.copy(spawn.pos); s.vel.set(0, 0, 0); s.q.copy(spawn.q);
  s.w = [0, 0, 0]; s.aa = [0, 0, 0]; s.thrust = 0; s.armed = false;
  prevPos.copy(s.pos); cancelRun();
}
// highest surface (ground, roof, car...) under x,z that is below maxY
function surfaceY(x, z, maxY) {
  let h = 0; for (const c of cgrid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL))) || [])
    if (!c.ring && x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y <= maxY) h = Math.max(h, c.max.y);
  return h;
}
// spawn on the surface a few meters before a lesson's first ring, facing through it
for (const L of lessons) {
  const rs = ringSpecs[L.start], d = new THREE.Vector3(rs.dir[0], 0, rs.dir[2]);
  const p = new THREE.Vector3(...rs.pos), q = new THREE.Quaternion();
  if (d.lengthSq() > 0.01) { d.normalize(); p.addScaledVector(d, -6); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-d.x, -d.z)); }
  p.y = surfaceY(p.x, p.z, rs.pos[1]) + CONFIG.quad.radius + 0.001;
  L.spawn = { pos: p, q };
}

// ---------- Lessons: ring passing, timing, best times ----------
const prevPos = new THREE.Vector3(), lp = new THREE.Vector3(), lc = new THREE.Vector3();
let simTime = 0, bests = {};
try { bests = JSON.parse(localStorage.getItem('air65-bests')) || {}; } catch (e) {}
const run = { li: -1, next: 0, t0: 0 };
function passed(rs) {                       // crossed the ring plane (in its direction) inside the ring
  const c = rs.c;
  lp.copy(prevPos).sub(c.pos).applyQuaternion(c.qInv); lc.copy(s.pos).sub(c.pos).applyQuaternion(c.qInv);
  if (!(lp.z < 0 && lc.z >= 0)) return false;
  const t = lp.z / (lp.z - lc.z);
  return Math.hypot(lp.x + (lc.x - lp.x) * t, lp.y + (lc.y - lp.y) * t) < c.r;
}
function checkRings() {
  if (run.li >= 0) {
    const L = lessons[run.li];
    if (passed(ringSpecs[L.start + run.next])) {
      if (++run.next === L.n) {
        const t = simTime - run.t0, b = bests[L.name], nb = !b || t < b;
        if (nb) { bests[L.name] = t; try { localStorage.setItem('air65-bests', JSON.stringify(bests)); } catch (e) {} buildLessonMenu(); }
        flash(`${L.name} ${t.toFixed(2)}s${nb ? '  NEW BEST' : `  (best ${b.toFixed(2)}s)`}`, L.color, 3);
        run.li = -1;
      }
      paintRings(); return;
    }
  }
  for (let li = 0; li < lessons.length; li++) {
    const L = lessons[li];
    if (passed(ringSpecs[L.start])) {
      run.li = li; run.next = 1; run.t0 = simTime; spawn = L.spawn; paintRings();
      if (L.n === 1) checkRings(); return;
    }
  }
}
function cancelRun() { if (run.li >= 0) { run.li = -1; paintRings(); } }
const dimColor = new THREE.Color();
function paintRings() {
  ringSpecs.forEach((rs, i) => {
    tmpColor.setHex(rs.color);
    if (rs.li === run.li) {
      if (rs.idx < run.next) tmpColor.setHex(0x404040);
      else if (rs.idx > run.next) tmpColor.multiplyScalar(0.35);
    }
    ringMesh.setColorAt(i, tmpColor);
  });
  ringMesh.instanceColor.needsUpdate = true;
}

const flashEl = document.getElementById('flash'); let flashUntil = 0;
function flash(text, color, secs) {
  flashEl.textContent = text; flashEl.style.color = '#' + color.toString(16).padStart(6, '0');
  flashEl.style.display = 'block'; flashUntil = performance.now() + secs * 1000;
}
addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT' && (e.key === 'r' || e.key === 'R')) reset(); });

// ---------- Input ----------
const inp = { roll: 0, pitch: 0, yaw: 0, throttle: 0, armSwitch: false, pad: null };
function readInput() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  if (CONFIG.input.gamepadIndex != null) pad = pads[CONFIG.input.gamepadIndex];
  else for (const p of pads) if (p) { pad = p; break; }
  inp.pad = pad;
  if (!pad) { inp.roll = inp.pitch = inp.yaw = inp.throttle = 0; inp.armSwitch = false; return; }
  const I = CONFIG.input;
  const ax = n => { let v = pad.axes[I.axes[n]] ?? 0; return I.invert[n] ? -v : v; };
  const db = v => Math.abs(v) < I.deadband ? 0 : v;
  inp.roll = db(ax('roll')); inp.pitch = db(ax('pitch')); inp.yaw = db(ax('yaw'));
  inp.throttle = Math.min(1, Math.max(0, (ax('throttle') - I.throttleMin) / (I.throttleMax - I.throttleMin)));
  const sw = c => c.index == null ? false : c.type === 'button'
    ? !!(pad.buttons[c.index] && pad.buttons[c.index].pressed)
    : c.invert ? (pad.axes[c.index] ?? 1) < c.axisThreshold : (pad.axes[c.index] ?? -1) > c.axisThreshold;
  inp.armSwitch = sw(I.arm);
  const rs = sw(I.resetSwitch);
  if (rs && !inp.resetPrev) reset();         // on flip, not while held
  inp.resetPrev = rs;
}

// Betaflight Actual rates, returns deg/s
function actualRate(x, r) {
  x = Math.max(-1, Math.min(1, x));
  const a = Math.abs(x);
  const expof = a * (Math.pow(x, 5) * r.expo + x * (1 - r.expo));
  return x * r.center + Math.max(0, r.max - r.center) * expof;
}

// ---------- Physics ----------
const vb = new THREE.Vector3(), qInv = new THREE.Quaternion();
const tmp = new THREE.Vector3(), up = new THREE.Vector3(), dq = new THREE.Quaternion(), axis = new THREE.Vector3();

function step(dt) {
  const Q = CONFIG.quad, g = CONFIG.gravity, k = 1 - Math.exp(-dt / Q.motorTau);
  const maxThrust = Q.thrustToWeight * Q.mass * g;
  const thrCmd = s.armed ? (Q.idleThrottle + (1 - Q.idleThrottle) * Math.pow(inp.throttle, Q.thrustExponent)) * maxThrust : 0;
  s.thrust += (thrCmd - s.thrust) * k;

  const D = Math.PI / 180, R = CONFIG.rates, P = CONFIG.rateP;
  const target = [-actualRate(inp.pitch, R.pitch) * D, -actualRate(inp.yaw, R.yaw) * D, -actualRate(inp.roll, R.roll) * D];
  const gains = [P.pitch, P.yaw, P.roll], M = CONFIG.maxAngAccel, lim = [M.pitch, M.yaw, M.roll];
  for (let i = 0; i < 3; i++) {
    // P on rate error + feedforward cancelling rotDrag (stands in for BF's I-term so rates are hit exactly)
    let a = s.armed ? gains[i] * (target[i] - s.w[i]) + Q.rotDrag * target[i] : 0;
    a = Math.max(-lim[i], Math.min(lim[i], a));
    s.aa[i] += (a - s.aa[i]) * k;
    s.w[i] += (s.aa[i] - Q.rotDrag * s.w[i]) * dt;
  }

  up.set(0, 1, 0).applyQuaternion(s.q);
  // drag in body frame (whoops are much draggier vertically through the ducts)
  qInv.copy(s.q).invert();
  vb.copy(s.vel).applyQuaternion(qInv);
  vb.set(-(Q.linearDrag + Q.quadDrag[0] * Math.abs(vb.x)) * vb.x,
         -(Q.linearDrag + Q.quadDrag[1] * Math.abs(vb.y)) * vb.y,
         -(Q.linearDrag + Q.quadDrag[2] * Math.abs(vb.z)) * vb.z).applyQuaternion(s.q);
  const inflow = Math.max(0, s.vel.dot(up));                 // air coming through the props from above
  tmp.copy(up).multiplyScalar(s.thrust * Math.max(0, 1 - inflow / Q.propSpeed)).add(vb);
  tmp.y -= Q.mass * g;
  s.vel.addScaledVector(tmp, dt / Q.mass);
  prevPos.copy(s.pos);
  s.pos.addScaledVector(s.vel, dt);
  simTime += dt;
  if (currentMap === 'city') checkRings();

  axis.set(s.w[0], s.w[1], s.w[2]);
  const wm = axis.length();
  if (wm > 1e-9) { dq.setFromAxisAngle(axis.multiplyScalar(1 / wm), wm * dt); s.q.multiply(dq).normalize(); }

  return collide(dt) > CONFIG.crash.hardSpeed;
}

// ---------- Contacts: push out, bounce, scrub, tumble ----------
const cn = new THREE.Vector3(), cvt = new THREE.Vector3();
let touching = false;
let resetHit = false;                        // reset mode: set when a contact counts as a crash
let soldierHit = -1;                         // strike map: index of a soldier touched this step
function contact(depth, dt) {                 // cn = world contact normal (unit, pointing out of the obstacle)
  const K = CONFIG.crash;
  if (K.mode === 'reset' && (cn.y < 0.7 || -s.vel.dot(cn) > K.landingSpeed)) resetHit = true; // wall/ring/edge or hard landing
  s.pos.addScaledVector(cn, depth);
  const vn = s.vel.dot(cn);
  touching = true;
  if (vn >= 0) return 0;
  const impact = -vn;
  cvt.copy(s.vel).addScaledVector(cn, -vn);                       // tangential part
  const e = impact > K.bounceMinSpeed ? K.restitution : 0;         // slow touches don't bounce (no jitter)
  cvt.multiplyScalar(Math.max(0, 1 - K.friction * Math.min(1, impact / 2 + dt * 20))); // impact scrub + sliding friction
  s.vel.copy(cvt).addScaledVector(cn, impact * e);
  if (impact > K.bounceMinSpeed) for (let i = 0; i < 3; i++)       // knocked into a tumble
    s.w[i] += (Math.random() * 2 - 1) * K.tumble * impact;
  return impact;
}
function collide(dt = 1 / CONFIG.physicsHz) {
  const r = CONFIG.quad.radius, p = s.pos;
  let hardest = 0; touching = false;
  if (p.y < r) { cn.set(0, 1, 0); hardest = Math.max(hardest, contact(r - p.y, dt)); }
  const cell = cgrid.get(ckey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (cell) for (const c of cell) {
    if (c.soldier !== undefined) {                 // soldiers don't push back: touching one is a hit
      if (soldiers[c.soldier].alive) {
        tmp.copy(p).clamp(c.min, c.max); const pr = r + W.strike.hitPadding;
        if (tmp.distanceToSquared(p) < pr * pr) soldierHit = c.soldier;
      }
      continue;
    }
    if (c.ring) {
      tmp.copy(p).sub(c.pos).applyQuaternion(c.qInv);
      const rho = Math.hypot(tmp.x, tmp.y) || 1e-6;
      lc.set(tmp.x / rho * c.r, tmp.y / rho * c.r, 0);             // nearest point on the ring's centre circle
      tmp.sub(lc); const d = tmp.length();
      if (d >= c.tube + r || d < 1e-9) continue;
      cn.copy(tmp).multiplyScalar(1 / d).applyQuaternion(c.q);
      hardest = Math.max(hardest, contact(c.tube + r - d, dt));
    } else {
      tmp.copy(p).clamp(c.min, c.max);
      const d2 = tmp.distanceToSquared(p);
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) { const d = Math.sqrt(d2); cn.copy(p).sub(tmp).multiplyScalar(1 / d); hardest = Math.max(hardest, contact(r - d, dt)); }
      else {                                                         // centre inside the box: exit via the nearest face
        const f = [p.x - c.min.x, c.max.x - p.x, p.y - c.min.y, c.max.y - p.y, p.z - c.min.z, c.max.z - p.z];
        const i = f.indexOf(Math.min(...f));
        cn.set(0, 0, 0).setComponent(i >> 1, i & 1 ? 1 : -1);
        hardest = Math.max(hardest, contact(f[i] + r, dt));
      }
    }
  }
  if (touching) { const k = Math.max(0, 1 - CONFIG.crash.contactSpinDamp * dt); for (let i = 0; i < 3; i++) s.w[i] *= k; }
  return hardest;
}

// ---------- Rates menu ----------
const RATE_DEFAULTS = JSON.parse(JSON.stringify(CONFIG.rates));
try { const saved = JSON.parse(localStorage.getItem('air65-rates'));
  if (saved) for (const ax in CONFIG.rates) Object.assign(CONFIG.rates[ax], saved[ax]); } catch (e) {}
const ratesEl = document.getElementById('rates');
function buildRatesMenu() {
  let h = 'RATES (Actual)<table><tr><th></th><th>center</th><th>max</th><th>expo</th><th>now °/s</th></tr>';
  for (const ax of ['roll', 'pitch', 'yaw']) {
    const r = CONFIG.rates[ax];
    h += `<tr><td>${ax}</td>` +
      `<td><input type="number" data-ax="${ax}" data-k="center" value="${r.center}" step="10" min="0"></td>` +
      `<td><input type="number" data-ax="${ax}" data-k="max" value="${r.max}" step="10" min="0"></td>` +
      `<td><input type="number" data-ax="${ax}" data-k="expo" value="${r.expo}" step="0.01" min="0" max="1"></td>` +
      `<td id="now-${ax}">0</td></tr>`;
  }
  ratesEl.innerHTML = h + '</table><button id="rates-reset">defaults</button>';
  ratesEl.querySelectorAll('input').forEach(el => el.addEventListener('input', () => {
    const v = parseFloat(el.value); if (!isFinite(v)) return;
    CONFIG.rates[el.dataset.ax][el.dataset.k] = v;
    try { localStorage.setItem('air65-rates', JSON.stringify(CONFIG.rates)); } catch (e) {}
  }));
  document.getElementById('rates-reset').onclick = () => {
    for (const ax in RATE_DEFAULTS) Object.assign(CONFIG.rates[ax], RATE_DEFAULTS[ax]);
    try { localStorage.removeItem('air65-rates'); } catch (e) {}
    buildRatesMenu();
  };
}
buildRatesMenu();

// ---------- Pause menu ----------
let paused = false;
const pauseEl = document.getElementById('pause'), pRates = document.getElementById('p-rates');
function setPaused(p) {
  paused = p; pauseEl.style.display = p ? 'flex' : 'none';
  if (document.activeElement) document.activeElement.blur();
}
function setRatesVisible(v) {
  ratesEl.style.display = v ? '' : 'none';
  pRates.textContent = v ? 'Hide rates menu' : 'Show rates menu';
}
let showDebug = false;
const pDebug = document.getElementById('p-debug');
function setDebug(v) { showDebug = v; pDebug.textContent = v ? 'Hide input debug' : 'Show input debug'; }
document.getElementById('p-resume').onclick = () => setPaused(false);
document.getElementById('p-reset').onclick = () => { reset(); setPaused(false); };
document.getElementById('p-city').onclick = () => { if (currentMap !== 'city') setMap('city'); spawn = citySpawn; reset(); setPaused(false); };
const pCrash = document.getElementById('p-crash');
function setCrashMode(m) {
  CONFIG.crash.mode = m;
  pCrash.textContent = m === 'reset' ? 'Crashes: reset on hit' : 'Crashes: physics (bounce)';
  try { localStorage.setItem('air65-crashmode', m); } catch (e) {}
}
try { const m = localStorage.getItem('air65-crashmode'); if (m === 'reset' || m === 'physics') CONFIG.crash.mode = m; } catch (e) {}
setCrashMode(CONFIG.crash.mode);
pCrash.onclick = () => setCrashMode(CONFIG.crash.mode === 'reset' ? 'physics' : 'reset');
pRates.onclick = () => setRatesVisible(ratesEl.style.display === 'none');
pDebug.onclick = () => setDebug(!showDebug);
function buildLessonMenu() {
  const el = document.getElementById('p-lessons'); el.innerHTML = '';
  lessons.forEach(L => {
    const b = document.createElement('button');
    b.textContent = L.name + (bests[L.name] ? `  ${bests[L.name].toFixed(2)}s` : '');
    b.style.color = '#' + L.color.toString(16).padStart(6, '0');
    b.onclick = () => { if (currentMap !== 'city') setMap('city'); spawn = L.spawn; reset(); setPaused(false); };
    el.appendChild(b);
  });
}
buildLessonMenu();

// tabs
const tabBtns = [...document.querySelectorAll('#ptabs button')];
tabBtns.forEach(b => b.onclick = () => {
  tabBtns.forEach(o => o.classList.toggle('on', o === b));
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  mapping = null; buildControls();
});
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (mapping) { mapping = null; buildControls(); return; }   // Esc cancels a mapping first
  setPaused(!paused);
});

// ---- CONTROLLER tab: map sticks/switches by moving them ----
const FUNCS = {
  roll:     { label: 'Roll',     prompt: 'Push the ROLL stick fully RIGHT', stick: true },
  pitch:    { label: 'Pitch',    prompt: 'Push the PITCH stick fully FORWARD (up)', stick: true },
  yaw:      { label: 'Yaw',      prompt: 'Push the YAW stick fully RIGHT', stick: true },
  throttle: { label: 'Throttle', prompt: 'Put THROTTLE at the bottom, then push it to the TOP', stick: true },
  arm:      { label: 'Arm',      prompt: 'Flip your ARM switch to the ARMED position' },
  reset:    { label: 'Respawn',  prompt: 'Flip the switch / press the button you want for RESPAWN' },
};
let mapping = null;   // { fn, base:{axes,buttons}, found:{type,index,t} }
const ctlEl = document.getElementById('tab-controls');
const swCfg = fn => fn === 'arm' ? CONFIG.input.arm : CONFIG.input.resetSwitch;
function describe(fn) {
  const I = CONFIG.input;
  if (FUNCS[fn].stick) return `axis ${I.axes[fn]}${I.invert[fn] ? ' (inverted)' : ''}`;
  const c = swCfg(fn);
  if (c.index == null) return 'not set';
  return c.type === 'button' ? `button ${c.index}` : `axis ${c.index} ${c.invert ? '<' : '>'} ${(+c.axisThreshold).toFixed(2)}`;
}
function saveInput() {
  const I = CONFIG.input;
  try { localStorage.setItem('air65-input', JSON.stringify({ axes: I.axes, invert: I.invert, arm: I.arm, resetSwitch: I.resetSwitch })); } catch (e) {}
}
function buildControls() {
  let h = `<div class="hint" id="ctl-pad"></div><table>`;
  for (const fn in FUNCS) {
    h += `<tr><td>${FUNCS[fn].label}</td><td>${describe(fn)}</td><td id="live-${fn}" style="width:70px"></td>` +
      `<td><button data-map="${fn}">${mapping && mapping.fn === fn ? 'waiting…' : 'Map'}</button></td>` +
      (FUNCS[fn].stick ? `<td><label><input type="checkbox" data-inv="${fn}" ${CONFIG.input.invert[fn] ? 'checked' : ''}>inv</label></td>`
                       : fn === 'reset' ? `<td><button data-clear="reset">clear</button></td>` : '<td></td>') + '</tr>';
  }
  h += `</table><div class="hint" id="ctl-hint">${mapping ? FUNCS[mapping.fn].prompt + '  (Esc = cancel)' : 'Click Map, then move that stick or switch.'}</div>`;
  h += `<button id="ctl-defaults">Reset to CONFIG defaults</button>`;
  ctlEl.innerHTML = h;
  ctlEl.querySelectorAll('[data-map]').forEach(b => b.onclick = () => {
    const pad = inp.pad; if (!pad) { document.getElementById('ctl-hint').textContent = 'No gamepad detected - move a stick first.'; return; }
    mapping = { fn: b.dataset.map, base: { axes: [...pad.axes], buttons: pad.buttons.map(x => x.pressed) }, found: null };
    buildControls();
  });
  ctlEl.querySelectorAll('[data-inv]').forEach(c => c.onchange = () => { CONFIG.input.invert[c.dataset.inv] = c.checked; saveInput(); buildControls(); });
  ctlEl.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { CONFIG.input.resetSwitch.index = null; saveInput(); buildControls(); });
  document.getElementById('ctl-defaults').onclick = () => {
    const d = JSON.parse(JSON.stringify(INPUT_DEFAULTS));
    for (const k of ['axes', 'invert', 'arm', 'resetSwitch']) CONFIG.input[k] = d[k];
    try { localStorage.removeItem('air65-input'); } catch (e) {}
    mapping = null; buildControls();
  };
}
function updateMapping(pad) {           // called every frame while the menu is open
  if (!mapping || !pad) return;
  const m = mapping, fn = m.fn;
  if (!m.found) {
    let bi = -1, bd = 0;
    pad.axes.forEach((v, i) => { const d = Math.abs(v - (m.base.axes[i] ?? 0)); if (d > bd) { bd = d; bi = i; } });
    if (bd > 0.6) m.found = { type: 'axis', index: bi, t: performance.now() };
    else if (!FUNCS[fn].stick) {
      const b = pad.buttons.findIndex((x, i) => x.pressed && !m.base.buttons[i]);
      if (b >= 0) m.found = { type: 'button', index: b, t: performance.now() };
    }
    return;
  }
  if (performance.now() - m.found.t < 300) return;   // let the stick/switch settle, then read where it ended up
  const I = CONFIG.input, i = m.found.index, base = m.base.axes[i] ?? 0, cur = pad.axes[i] ?? 0;
  if (FUNCS[fn].stick) { I.axes[fn] = i; I.invert[fn] = cur < base; }
  else {
    const c = swCfg(fn);
    c.type = m.found.type; c.index = i;
    if (c.type === 'axis') { c.axisThreshold = +((base + cur) / 2).toFixed(2); c.invert = cur < base; }
  }
  saveInput(); mapping = null; buildControls();
  document.getElementById('ctl-hint').textContent = `${FUNCS[fn].label} mapped to ${describe(fn)}.`;
}
function updateControlsLive(pad) {
  if (!ctlEl.classList.contains('on') || !paused) return;
  const padEl = document.getElementById('ctl-pad'); if (!padEl) return;
  padEl.textContent = pad ? pad.id.slice(0, 40) : 'No gamepad detected - move a stick or press a button';
  const bar = v => { const n = Math.round((v + 1) * 4); return '[' + '#'.repeat(n) + '.'.repeat(8 - n) + ']'; };
  const set = (fn, t) => { const el = document.getElementById('live-' + fn); if (el) el.textContent = t; };
  set('roll', bar(inp.roll)); set('pitch', bar(inp.pitch)); set('yaw', bar(inp.yaw)); set('throttle', bar(inp.throttle * 2 - 1));
  set('arm', inp.armSwitch ? 'ON' : 'off'); set('reset', inp.resetPrev ? 'ON' : 'off');
}
buildControls();

// ---- CAMERA tab ----
const camEl = document.getElementById('tab-camera');
function saveCamera() {
  const c = CONFIG.camera;
  try { localStorage.setItem('air65-camera', JSON.stringify({ uptiltDeg: c.uptiltDeg, hfovDeg: c.hfovDeg, view: c.view })); } catch (e) {}
}
function buildCamera() {
  const c = CONFIG.camera;
  camEl.innerHTML =
    `<div class="row">View <span><button data-view="fpv">${c.view === 'fpv' ? '[FPV]' : 'FPV'}</button> ` +
    `<button data-view="chase">${c.view === 'chase' ? '[CHASE]' : 'CHASE'}</button></span></div>` +
    `<div class="row">Uptilt <input type="range" id="cam-tilt" min="0" max="60" step="1" value="${c.uptiltDeg}"><span id="cam-tilt-v">${c.uptiltDeg}°</span></div>` +
    `<div class="row">FOV <input type="range" id="cam-fov" min="80" max="160" step="1" value="${c.hfovDeg}"><span id="cam-fov-v">${c.hfovDeg}°</span></div>` +
    `<div class="hint">Uptilt applies to the FPV camera. V key toggles view while flying.</div>` +
    `<button id="cam-defaults">Reset to CONFIG defaults</button>`;
  camEl.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  const tilt = document.getElementById('cam-tilt'), fov = document.getElementById('cam-fov');
  tilt.oninput = () => { c.uptiltDeg = +tilt.value; document.getElementById('cam-tilt-v').textContent = c.uptiltDeg + '°'; updateTilt(); saveCamera(); };
  fov.oninput = () => { c.hfovDeg = +fov.value; document.getElementById('cam-fov-v').textContent = c.hfovDeg + '°'; resize(); saveCamera(); };
  document.getElementById('cam-defaults').onclick = () => {
    Object.assign(c, JSON.parse(JSON.stringify(CAMERA_DEFAULTS))); try { localStorage.removeItem('air65-camera'); } catch (e) {}
    updateTilt(); resize(); setView(c.view);
  };
}
function setView(v) { CONFIG.camera.view = v; chasePos.copy(s.pos); saveCamera(); buildCamera(); }
addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT' && (e.key === 'v' || e.key === 'V')) setView(CONFIG.camera.view === 'fpv' ? 'chase' : 'fpv'); });
buildCamera();

// ---------- Loop ----------
// ---------- Maps & strike mission ----------
const STRIKE_KEY = 'STRIKE MISSION';
const mission = { t0: 0, hits: 0, done: false, endT: 0 };
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function restartMission() {
  soldiers.forEach((sd, i) => { sd.alive = true; hideSoldier(i, false); });
  mission.t0 = simTime; mission.hits = 0; mission.done = false;
}
function setMap(m) {
  currentMap = m; cityRoot.visible = m === 'city'; strikeRoot.visible = m === 'strike';
  cgrid = m === 'city' ? cityGrid : strikeGrid; spawn = m === 'city' ? citySpawn : strikeSpawn;
  cancelRun(); if (m === 'strike') restartMission();
  signalLostUntil = 0; staticEl.style.display = 'none'; boom.visible = false;
  reset(); buildMaps();
  try { localStorage.setItem('air65-map', m); } catch (e) {}
}
// a hit: fireball, the FPV feed cuts to static, then the next drone launches from the road
let signalLostUntil = 0, boomUntil = 0;
const staticEl = document.getElementById('static'), staticCv = staticEl.querySelector('canvas'), staticCtx = staticCv.getContext('2d');
const staticImg = staticCtx.createImageData(staticCv.width, staticCv.height);
function onSoldierHit(i, now) {
  soldiers[i].alive = false; hideSoldier(i, true); mission.hits++;
  boom.position.copy(s.pos); boom.scale.setScalar(5); boom.visible = true; boomUntil = now + 700;
  signalLostUntil = now + 1100; staticEl.style.display = 'flex';
  if (mission.hits === soldiers.length) {
    mission.done = true; mission.endT = simTime - mission.t0;
    const b = bests[STRIKE_KEY], nb = !b || mission.endT < b;
    if (nb) { bests[STRIKE_KEY] = mission.endT; try { localStorage.setItem('air65-bests', JSON.stringify(bests)); } catch (e) {} }
    flash(`MISSION COMPLETE  ${fmtTime(mission.endT)}${nb ? '  NEW BEST' : `  (best ${fmtTime(b)})`}`, 0x40ff40, 5);
    buildMaps();
  } else flash(`TARGET HIT  ${mission.hits}/${soldiers.length}`, 0xffa020, 1.6);
}
function updateStrikeFx(now) {
  if (boom.visible && now > boomUntil) boom.visible = false;
  if (!signalLostUntil) return;
  if (now < signalLostUntil) {                 // hold the sim and draw noise
    acc = 0; const d = staticImg.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    staticCtx.putImageData(staticImg, 0, 0);
  } else { signalLostUntil = 0; staticEl.style.display = 'none'; reset(); }
}
const mapsEl = document.getElementById('tab-maps');
function buildMaps() {
  const b = bests[STRIKE_KEY];
  mapsEl.innerHTML =
    `<button data-map-sel="city">${currentMap === 'city' ? '[CITY TRAINING]' : 'City training'}</button>` +
    `<button data-map-sel="strike">${currentMap === 'strike' ? '[STRIKE MISSION]' : 'Strike mission'}</button>` +
    `<div class="hint">STRIKE: ${soldiers.length} soldiers are hidden in the ruined town (west of the road) and the pine forest (east). ` +
    `Find them and fly into them. Each hit expends the drone; the next one launches from the road.</div>` +
    `<div class="hint">Best mission time: ${b ? fmtTime(b) : '-'}</div>` +
    (currentMap === 'strike' ? `<button id="m-restart">Restart mission</button>` : '');
  mapsEl.querySelectorAll('[data-map-sel]').forEach(el => el.onclick = () => { setMap(el.dataset.mapSel); setPaused(false); });
  const rb = document.getElementById('m-restart'); if (rb) rb.onclick = () => { restartMission(); reset(); setPaused(false); };
}

const hud = document.getElementById('hud');
const DT = 1 / CONFIG.physicsHz;
let acc = 0, last = performance.now();
{ let m = 'city'; try { m = localStorage.getItem('air65-map') === 'strike' ? 'strike' : 'city'; } catch (e) {} setMap(m); }

function frame(now) {
  requestAnimationFrame(frame);
  acc = paused ? 0 : acc + Math.min(0.1, (now - last) / 1000); last = now;
  readInput();
  if (!inp.armSwitch) s.armed = false;
  else if (!s.armed && inp.throttle < CONFIG.input.armMaxThrottle) s.armed = true;

  while (acc >= DT) {
    acc -= DT;
    resetHit = false; soldierHit = -1;
    const hard = step(DT);
    if (soldierHit >= 0) { onSoldierHit(soldierHit, now); acc = 0; break; }
    if (resetHit) { flash('CRASH', 0xff4040, 0.8); reset(); acc = 0; break; }
    if (hard) { flash(run.li >= 0 ? 'CRASH - lesson failed' : 'CRASH', 0xff4040, 1.2); cancelRun(); }
    else if (touching && s.vel.lengthSq() < 0.01 && up.set(0, 1, 0).applyQuaternion(s.q).y < -0.3 && !flashUntil)
      flash('UPSIDE DOWN - press R', 0xffa040, 1.5);
  }
  if (flashUntil && now > flashUntil) { flashEl.style.display = 'none'; flashUntil = 0; }
  updateStrikeFx(now);

  if (paused) { updateMapping(inp.pad); updateControlsLive(inp.pad); }

  const chase = CONFIG.camera.view === 'chase';
  quadModel.visible = chase;
  if (chase) {
    quadModel.position.copy(s.pos); quadModel.quaternion.copy(s.q);
    // follow behind the quad's heading (flattened), smoothed so flips don't whip the camera
    tmp.set(0, 0, -1).applyQuaternion(s.q); tmp.y = 0;
    if (tmp.lengthSq() > 0.04) { tmp.normalize(); chaseFwd.lerp(tmp, 0.1); if (chaseFwd.lengthSq() < 0.01) chaseFwd.copy(tmp); chaseFwd.normalize(); }
    tmp.copy(s.pos).addScaledVector(chaseFwd, -CONFIG.camera.chaseDist); tmp.y += CONFIG.camera.chaseHeight;
    if (chasePos.distanceToSquared(s.pos) > 25) chasePos.copy(tmp);   // after a respawn, jump straight there
    chasePos.lerp(tmp, paused ? 0 : 0.15);
    camera.position.copy(chasePos); camera.lookAt(s.pos);
  } else {
    camera.position.copy(s.pos);
    camera.quaternion.copy(s.q).multiply(tiltQ);
  }
  renderer.render(scene, camera);

  const pad = inp.pad;
  let t = `${s.armed ? 'ARMED' : (inp.armSwitch ? 'ARM SW ON - LOWER THROTTLE' : 'DISARMED')}\n`;
  t += `THR ${String(Math.round(inp.throttle * 100)).padStart(3)}%  ${String(Math.round(s.vel.length() * 3.6)).padStart(3)} km/h  ALT ${s.pos.y.toFixed(1)} m\n`;
  if (run.li >= 0) {
    const L = lessons[run.li], b = bests[L.name];
    t += `${L.name}  ring ${run.next + 1}/${L.n}  ${(simTime - run.t0).toFixed(1)}s${b ? `  best ${b.toFixed(2)}s` : ''}\n`;
  }
  if (currentMap === 'strike') {
    const left = a => soldiers.filter(x => x.alive && x.area === a).length, b = bests[STRIKE_KEY];
    const tm = mission.done ? mission.endT : simTime - mission.t0;
    t += `TARGETS ${mission.hits}/${soldiers.length}  (town ${left('town')}, forest ${left('forest')} left)\n`;
    t += `TIME ${fmtTime(tm)}${mission.done ? '  COMPLETE' : ''}${b ? `  best ${fmtTime(b)}` : ''}\n`;
  }
  if (!pad) t += 'No gamepad (move a stick / press a button)\n';
  if (showDebug && pad) {
    t += `\n${pad.id}\n` + pad.axes.map((v, i) => `axis ${i}: ${v.toFixed(3).padStart(7)}`).join('\n') + '\n';
    t += 'buttons: ' + pad.buttons.map((b, i) => b.pressed ? i : null).filter(v => v !== null).join(' ') + '\n';
    t += `roll ${inp.roll.toFixed(2)} pitch ${inp.pitch.toFixed(2)} yaw ${inp.yaw.toFixed(2)} thr ${inp.throttle.toFixed(2)}\n`;
  }
  t += 'Esc = menu   R = respawn   V = view';
  hud.textContent = t;
  for (const ax of ['roll', 'pitch', 'yaw'])
    document.getElementById('now-' + ax).textContent = Math.round(actualRate(inp[ax], CONFIG.rates[ax]));
}
requestAnimationFrame(frame);
