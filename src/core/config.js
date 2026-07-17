/*=== HARNESS:CONFIG =========================================================*/
// Space Hauler v4 — CONFIG, constants, world sizing, engine helpers, sprite
// framework. Everything below this point is game-side glue; the nine Forge
// modules are inlined ABOVE (see HARNESS:MODULES) and are referenced here by
// their globals (ForgeItemSystem, ForgeEquipment, ForgeHUD, ForgeWorld,
// ForgeStore, ForgeCombat, ForgeFaction, ForgeNPC). The item catalogue is game
// content in src/content/catalog.js, injected via ForgeItemSystem.loadDB().
const HEADLESS = !!globalThis.__HARNESS_HEADLESS__;
let DEBUG = !HEADLESS && typeof location !== "undefined" && location.hash.includes("debug");
const TAU = 6.283185307179586;

const CONFIG = {
  W: 390, H: 700,
  // ---- dual engine (kept from v3) ----
  //   CONSTANT: hold = accelerate toward click, burn fuel/sec
  //   BURST:    hold = charge, release = one impulse toward it
  thrustFuelRate: 5, chargeTime: 2.5, burstCost: 12,
  dragFree: 0.994, dragTow: 0.985,     // velocity ×/frame @60fps (overridden by nebula)
  solarRegen: 2, solarMax: 25,         // dry-tank trickle floor (never a hard softlock)
  accel: 1100, impulse: 560,           // base magnitudes; scaled by derived.thrust/100
  // ---- hull / physics ----
  shipR: 16, shipMass: 2, invulnT: 0.8, flashT: 0.3, dockHeal: 8, junkMass: 0.4,
  // ---- tractor / tow ----
  leashBase: 48, leashStep: 40, towPull: 0.30, towBodyDrag: 0.86,
  tapPickR: 30, towK: 0.50, baseTows: 3,
  // ---- economy / progression ----
  fuelPerCredit: 2.5, rationFuel: 30, dockR: 160, defeatPenalty: 100,
  equipSlots: 6,                     // flat generic loadout rack (ForgeEquipment)
  // ---- HULL registry (multi-ship) ------------------------------------------
  // Each hull is a full base stat block (ForgeEquipment.getActiveStats input;
  // 3-layer health: shield regens after shieldDelay, armor repairs only via
  // fuel-cost modules, hull is FIXED per hull — stronger hulls are better
  // SHIPS, never modules). All player hulls run the same flat 6-slot rack
  // (CONFIG.equipSlots; hud.js skill keys 1-6). cost:null = starter; buyable
  // hulls sell for credits at the station SHIPS market (buyShipUpgrade) and
  // are progression-gated: unlock = cumulative outpost captures OR the highest
  // danger wedge the pilot has ever flown into (either condition suffices).
  hulls: {
    vulture: {
      name: "Vulture Tug", tier: "STARTER",
      desc: "starter hauler — light, thirsty-cheap, and honest about both",
      cost: null, baseTows: 3,
      baseShip: {
        shieldMax: 1500, shieldRegen: 75, shieldDelay: 3.0,
        armorMax: 1200, armorRepair: 0,
        hullMax: 900,
        res: { shield: 0, armor: 0.15, hull: 0 },
        fuelMax: 1500, solarRegen: 2,
        thrust: 100, turnSpeed: 100,
        scanRange: 900,
        tractorRange: 600, tractorStr: 1,
        fuelCostK: 1,
        weaponDmg: 10, fireRate: 1, weaponRange: 0,
      },
    },
    atlas: {
      name: "Atlas Freighter", tier: "MID-TIER",
      desc: "heavy industry hull — big tanks, big tows, forgives your mistakes",
      cost: { credits: 50000 }, baseTows: 4,
      unlock: { outposts: 3, danger: 4 },
      baseShip: {
        shieldMax: 1950, shieldRegen: 75, shieldDelay: 3.0,
        armorMax: 1650, armorRepair: 0,
        hullMax: 1350,
        res: { shield: 0, armor: 0.20, hull: 0 },
        fuelMax: 1500, solarRegen: 2.5,
        thrust: 90, turnSpeed: 90,
        scanRange: 1000,
        tractorRange: 700, tractorStr: 1.4,
        fuelCostK: 1,
        weaponDmg: 10, fireRate: 1,
      },
    },
    aegis: {
      name: "Aegis Warhauler", tier: "HEAVY",
      desc: "combat hull — hard shell, hot guns, null-sec pedigree",
      cost: { credits: 200000 }, baseTows: 3,
      unlock: { outposts: 10, danger: 7 },
      baseShip: {
        shieldMax: 2550, shieldRegen: 90, shieldDelay: 2.6,
        armorMax: 2250, armorRepair: 0,
        hullMax: 1800,
        res: { shield: 0.05, armor: 0.25, hull: 0 },
        fuelMax: 1500, solarRegen: 2,
        thrust: 120, turnSpeed: 115,
        scanRange: 1100,
        tractorRange: 600, tractorStr: 1.2,
        fuelCostK: 1,
        weaponDmg: 13, fireRate: 1,
      },
    },
  },
  // ---- weapon projectiles / cooldown fallbacks ----
  rockHp: (mass) => Math.round(mass * 16 + 8),
  junkHp: 14, projLife: 1.4, projR: 5, weaponCd: 0.6,
  // ---- collision broadphase (GAME.rockPairPass) ----
  collNear: 4000,   // ship-centred radius the rock pair pass considers
  collCell: 128,    // grid cell; must exceed the largest rock's diameter (~67)
  // ---- camera (pitch = foreshortened world-y) ----
  pitch: 0.82, zoom0: 1.0, zoomMin: 0.08, zoomMax: 3.0, zoomStep: 1.18, zoomLerp: 0.12,
  // ---- ORE rings (centered on home station at Mira; ore sells directly) ----
  rings: [
    { r: 400,  n: 8, type: "junk",     value: 8,   mass: 1.0, col: "#8a8f98", rarity: "normal" },
    { r: 1000, n: 7, type: "copper",   value: 30,  mass: 1.4, col: "#c9784a", rarity: "normal" },
    { r: 2200, n: 6, type: "silver",   value: 90,  mass: 1.8, col: "#c8d4e0", rarity: "rare" },
    { r: 4000, n: 5, type: "gold",     value: 240, mass: 2.4, col: "#ffd24a", rarity: "unique" },
    { r: 7000, n: 4, type: "platinum", value: 600, mass: 3.2, col: "#7ff0e8", rarity: "elite" },
  ],
  oreNames: { junk: "Slag Ore", copper: "Copper Ore", silver: "Silver Ore", gold: "Gold Ore", platinum: "Platinum Ore" },
  debugStartCredits: 10000,        // DEBUG: starting purse — drop back to 0 before ship
  ringSpread: 60,
  rarityCol: { normal: "#b8c0cc", rare: "#5fa8ff", unique: "#c77dff", elite: "#ffb020" },
  // ---- solar system layout ----
  WORLD_RADIUS: 85000,
  STAR_RADIUS: 1800,
  FOG_TILE: 2000,
  solarPlanets: [
    { name: "Vesper",    orbit: 8000,  r: 800,  type: "cratered",   moons: 0, rings: false, stationIdx: 1, faction: "vex" },
    { name: "Cinder",    orbit: 14000, r: 1000, type: "lava",       moons: 1, rings: false, stationIdx: 2, faction: "vex" },
    { name: "Arix",      orbit: 22000, r: 1800, type: "tan_gas",    moons: 2, rings: true,  stationIdx: 3, faction: "vex" },
    { name: "Dusk",      orbit: 32000, r: 1200, type: "ice",        moons: 1, rings: false, stationIdx: 4, faction: "krag" },
    { name: "Mira",      orbit: 44000, r: 1400, type: "life",       moons: 2, rings: false, stationIdx: 0, faction: "krag" },
    { name: "Sorn",      orbit: 58000, r: 1100, type: "desert",     moons: 1, rings: false, stationIdx: 5, faction: "krag" },
    { name: "Halveth",   orbit: 72000, r: 2000, type: "purple_gas", moons: 3, rings: true,  stationIdx: 6, faction: "nox" },
    { name: "Nox Prime", orbit: 80000, r: 1600, type: "dark",       moons: 1, rings: false, stationIdx: 7, faction: "nox" },
  ],
  asteroidBelt: { innerR: 37000, outerR: 40000 },   // rock count: beltRocksMin/Max below
  factionZones: {
    vex:  { innerR: 0,     outerR: 27000 },
    krag: { innerR: 27000, outerR: 65000 },
    nox:  { innerR: 65000, outerR: 85000 },
  },
  warpGateCosts: [500, 800, 1200, 2000, 4000, 8000, 14000, 20000],
  tradeNetworkBonus: 10000,
  // ---- planets (rendering; gravity in gravZone×r; ring ore = +50%) ----
  planetGrav: 2, gravZone: 1.5, pRingIn: 1.4, pRingOut: 2.2, pRingRocks: 4,
  planetRingDotsMin: 30, planetRingDotsMax: 130,
  planetDefs: {
    cratered:    { base:"#b0a89a", mid:"#8a7f70", dark:"#4a4238", halo:"rgba(160,150,130,0.25)", ring:"#7a7060", label:"VESPER" },
    lava:        { base:"#ff9944", mid:"#cc4411", dark:"#661100", halo:"rgba(255,120,40,0.35)",  ring:"#5a4a42", label:"CINDER" },
    tan_gas:     { base:"#e8d0a0", mid:"#c4a060", dark:"#6a5030", halo:"rgba(220,190,130,0.30)", ring:"#d0c090", label:"ARIX" },
    ice:         { base:"#d8eef8", mid:"#8ec8e8", dark:"#3a6888", halo:"rgba(140,210,240,0.35)", ring:"#c8d4e0", label:"DUSK" },
    life:        { base:"#70c890", mid:"#3090a0", dark:"#184858", halo:"rgba(80,200,160,0.35)",  ring:"#60a878", label:"MIRA" },
    desert:      { base:"#d8884a", mid:"#b05820", dark:"#603010", halo:"rgba(210,130,60,0.25)",  ring:"#a07040", label:"SORN" },
    purple_gas:  { base:"#c0a0d0", mid:"#7a5898", dark:"#3a2050", halo:"rgba(180,140,220,0.30)", ring:"#b090c0", label:"HALVETH" },
    dark:        { base:"#3a3840", mid:"#222028", dark:"#0e0c14", halo:"rgba(60,50,80,0.20)",    ring:"#2a2830", label:"NOX PRIME" },
    ice_world:   { base:"#eef8fd", mid:"#9fcfe8", dark:"#3d6b8c", halo:"rgba(120,220,255,0.35)", ring:"#c8d4e0", label:"ICE WORLD" },
    fire_world:  { base:"#ffb066", mid:"#d84a20", dark:"#5a1005", halo:"rgba(255,90,50,0.30)",  ring:"#5a4a42", label:"FIRE WORLD" },
    gas_giant:   { base:"#d9b8f0", mid:"#8a5cb8", dark:"#32224e", halo:"rgba(200,160,255,0.30)", ring:"#a8d890", label:"GAS GIANT" },
  },
  // ---- inert junk floaters (→ Forge salvage items when hauled in) ----
  // World Density Pass: ~850 floaters across five zone types — planet halos,
  // orbital lane scatter, station debris fields, hotspot clusters, whole-map
  // fill. Every floater drifts 0.1–0.4 u/s and respawns back into its zone.
  junkPlanetHaloMin: 25, junkPlanetHaloMax: 38,
  junkHaloDistMin: 1500, junkHaloDistMax: 4000,
  junkLaneMin: 20, junkLaneMax: 30, junkLaneSpread: 2000,
  junkClusterMin: 12, junkClusterMax: 16,
  junkClusterRMin: 200, junkClusterRMax: 400, junkClusterStationGap: 1200,
  junkHotspotMin: 6, junkHotspotMax: 10,
  junkFillMin: 70, junkFillMax: 100,
  stationDebrisMin: 20, stationDebrisMax: 30,
  stationDebrisDistMin: 500, stationDebrisDistMax: 800,
  junkDriftMin: 0.1, junkDriftMax: 0.4,
  junkTypes: [   // keys match ForgeItemSystem drop_map exactly
    { key: "junk_can",    r: 9 },
    { key: "junk_panel",  r: 10 },
    { key: "junk_crate",  r: 9 },
    { key: "junk_debris", r: 7 },
  ],
  // ---- zone rock density (World Density Pass; ~1000 rocks total) ----
  // asteroidBelt (r=37k–40k between Dusk and Mira) is the payday zone: 200–240
  // gold/platinum bonus rocks. Each planet gets a full-360° ore torus at its
  // orbital radius ±oreRingSpread; each moon a tight cluster; enemy bases a
  // scatter field; the remainder is background clusters of 3–8.
  beltRocksMin: 200, beltRocksMax: 240,
  oreRingRocksMin: 50, oreRingRocksMax: 65, oreRingSpread: 3000,
  moonRocksMin: 8, moonRocksMax: 13, moonRockDist: 600,
  bgRocksMin: 100, bgRocksMax: 140, bgClusterMin: 3, bgClusterMax: 8,
  baseRocksMin: 20, baseRocksMax: 28, baseRockDist: 2000,
  // ---- streaming mining fields (world/fields.js) ------------------------------
  // A field is a dormant descriptor + map icon until the ship comes within
  // (field.r + fieldActivatePad); then its `stock` rocks instantiate into
  // s.rocks and drain back to the descriptor on exit. Live rock count therefore
  // tracks only the 1–4 active fields, not total world capacity (~7k rocks).
  // Mining a field rock depletes stock; stock refills at fieldRegenPerSec while
  // the field is dormant (slow-regen renewable resource).
  fieldActivatePad: 2200,     // activate margin beyond field radius (off-screen)
  fieldDeactivatePad: 4200,   // deactivate margin — hysteresis vs activate
  fieldRegenPerSec: 0.4,      // stock refilled/sec while dormant
  fieldDiscoverR: 4200,       // ship within this of a field → icon revealed for good
  // field radii exceed the 2000 half-sector so neighboring regions' drops
  // overlap at the edges — a continuous resource fabric, not island clusters.
  // makeFieldRock biases toward the center (fieldSpreadPow) but reaches the rim.
  fieldSpreadPow: 0.7,        // radius = r·u^pow — 0.5 uniform, higher = denser core
  fieldJunkFrac: 0.45,        // junk floaters spawned per field = frac × rock cap
  fieldBeltCount: 6,   fieldBeltR: 2400,  fieldBeltCapMin: 170, fieldBeltCapMax: 250,
  fieldRingPerPlanet: 3, fieldRingR: 2700, fieldRingCapMin: 60, fieldRingCapMax: 110,
  fieldMoonR: 900,     fieldMoonCapMin: 14, fieldMoonCapMax: 22,
  fieldBaseR: 1600,    fieldBaseCapMin: 24, fieldBaseCapMax: 36,
  fieldNebulaR: 1800,  fieldNebulaCapMin: 40, fieldNebulaCapMax: 70,
  fieldBgRMin: 2400,   fieldBgRMax: 3000, fieldBgCapMin: 30, fieldBgCapMax: 90,
  // ---- static sector grid + region content (world/regions.js) -----------------
  // The disc is tiled by a fixed square grid; every in-disc cell is a numbered
  // REGION guaranteed at least one resource field. Anchors (belt / planet ring /
  // moon / nebula / base / station) claim their region's field type; the rest
  // get a distance-tiered background field. Rich regions roll 2–3 fields with
  // mixed ore. sectorSize 4000 ⇒ region radius 2000; at max zoom-out (~4875u of
  // world visible) that shows 1–3 field targets, the intended navigation feel.
  // The Region Event Manager (updateRegions) tracks the ship's region + scales
  // content by quest progress. Regions and the map are STATIC (seed-deterministic).
  sectorSize: 4000,           // cell side; region "radius" = sectorSize/2
  regionRich2Chance: 0.16,    // P(a plain region rolls a 2nd field)
  regionRich3Chance: 0.05,    // P(a plain region rolls a 3rd field) — very rich
  regionFieldJitter: 900,     // field center offset from region center
  regionStreamRadius: 1,      // manager window in cells around the ship (1 ⇒ 3×3)
  fieldOverviewZoom: 0.14,    // below this zoom, only landmark fields draw markers
  // ---- faction outposts + territory game (game/outposts.js) -------------------
  // Organic min-distance placement lands ~1 outpost per 5 regions. 3 IDLE guards
  // (passive until attacked) garrison each; kill them → dock captures the outpost
  // and claims its region. Owned outposts: local full-price turn-in + up to 3
  // purchased guard drones. Hold >reclaimFreeHolds and factions send waves.
  outpostMinDist: 7200,       // organic spacing (≈1-in-5 of the 1425 regions)
  outpostDockR: 110,          // turn-in / capture radius
  outpostGuardStreamR: 5200,  // materialize guards inside this ship distance
  outpostDroneMax: 3,
  outpostDroneCosts: [400, 800, 1400],
  outpostDroneHp: 120,
  reclaimFreeHolds: 3,        // own this many before factions notice
  reclaimHeavyHolds: 10,      // holdings where raids turn serious
  reclaimWaveMin: 180, reclaimWaveMax: 420,   // seconds between raids (by heat)
  reclaimResolveT: 45,        // travel time before a raid lands
  reclaimDmgPerStrength: 60,  // abstract damage per strength vs stationed drones
  // ---- outpost capture + fortify (player-owned platforms) ----
  outpostDefendR: 800,        // enemy inside this of a player outpost → stationed drones launch
  outpostModuleSlots: 4,      // FORTIFY hardpoints per outpost
  outpostStationedMax: 3,     // FORTIFY drone berths per outpost
  // ---- extra game-side nebula clouds (on top of ForgeWorld's 6) ----
  // 2–3 per orbital zone; the asteroid-belt clouds are larger and denser.
  extraNebulaZones: [
    { rMin: 6000,  rMax: 19000, nMin: 2, nMax: 3, sizeMin: 1800, sizeMax: 3000, dense: false },
    { rMin: 20000, rMax: 36000, nMin: 2, nMax: 3, sizeMin: 1800, sizeMax: 3200, dense: false },
    { rMin: 37000, rMax: 40000, nMin: 2, nMax: 3, sizeMin: 2500, sizeMax: 4000, dense: true },
    { rMin: 45000, rMax: 80000, nMin: 2, nMax: 3, sizeMin: 2000, sizeMax: 3500, dense: false },
  ],
  // ---- living world (ForgeWorld authoritative; nebula spawns ForgeFaction groups) ----
  factions: ["vex", "krag", "nox"],
  groupsPerNebula: 2,          // 2–3 alien groups seeded per nebula cloud
  nebulaOre: 4,                // rich gold/platinum rocks seeded per nebula
  lootPickR: 46,
  // ---- enemy bases (spread across solar system) ----
  enemyBaseMin: 2, enemyBaseMax: 3,
  enemyBaseRMin: 20000, enemyBaseRMax: 75000, enemyBaseGap: 8000,
  enemyBaseHp: 500, enemyBaseR: 60,
  enemyBaseSpawnMin: 45, enemyBaseSpawnMax: 90,   // patrol timer range (per base)
  enemyBasePatrolCap: 9,       // max live patrol ships per base (3 waves of 3)
  enemyBaseDropMin: 3, enemyBaseDropMax: 5,
};

// Alias: the starter hull's stat block. Kept so engine-facing call sites and
// selfTests that predate multi-ship (main.js state literal, §22 reset checks)
// keep reading a valid base block; live code should prefer GAME.activeHull().
CONFIG.baseShip = CONFIG.hulls.vulture.baseShip;

/*=== HARNESS:ENGINE =========================================================*/
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
let _seed = 42;
function setSeed(s) { _seed = (s >>> 0) || 1; }
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hexA = (h, a) => { const c = hexRGB(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const shade = (h, f) => { const c = hexRGB(h).map(v => clamp(Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)), 0, 255)); return `rgb(${c[0]},${c[1]},${c[2]})`; };
function chargeColor(c) {  // dim blue → orange → white (mirrors ForgeHUD.chargeColor)
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const blue = [74, 123, 255], orange = [255, 154, 60], white = [255, 255, 255];
  const rgb = c < 0.5 ? mix(blue, orange, c * 2) : mix(orange, white, (c - 0.5) * 2);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// ---- SFX (procedural WebAudio; counted headless so tests can assert plays) ----
const SFX_DEFS = {
  grab:  { type: "triangle", f0: 380, f1: 980, dur: 0.30, vol: 0.12 },
  drop:  { type: "square", f0: 500, f1: 180, dur: 0.16, vol: 0.10 },
  sell:  { type: "square", f0: 800, f1: 1500, dur: 0.12, vol: 0.11 },
  buy:   { type: "triangle", f0: 500, f1: 1100, dur: 0.22, vol: 0.11 },
  warn:  { type: "sawtooth", f0: 300, f1: 140, dur: 0.25, vol: 0.10 },
  boost: { noise: true, f0: 900, f1: 90, dur: 0.45, vol: 0.20 },
  crunch:{ noise: true, f0: 500, f1: 60, dur: 0.22, vol: 0.24 },
  boom:  { noise: true, f0: 700, f1: 30, dur: 0.9, vol: 0.30 },
};
let sfxPlays = 0, audioCtx = null;
function sfx(name) {
  const p = SFX_DEFS[name]; if (!p) return; sfxPlays++;
  if (HEADLESS) return;
  if (GAME.state && GAME.state.audioMuted) return;   // HUD mute silences these too (count stays for tests)
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime, gn = audioCtx.createGain();
    gn.gain.setValueAtTime(p.vol, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + p.dur);
    gn.connect(audioCtx.destination);
    if (p.noise) {
      const len = (audioCtx.sampleRate * p.dur) | 0, buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = audioCtx.createBufferSource(); src.buffer = buf;
      const f = audioCtx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(p.f0 * 4, t0); f.frequency.exponentialRampToValueAtTime(Math.max(40, p.f1), t0 + p.dur);
      src.connect(f).connect(gn); src.start(t0); src.stop(t0 + p.dur);
    } else {
      const o = audioCtx.createOscillator(); o.type = p.type;
      o.frequency.setValueAtTime(p.f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(30, p.f1), t0 + p.dur);
      o.connect(gn); o.start(t0); o.stop(t0 + p.dur);
    }
  } catch (e) {}
}

// ---- input schema (see core/input.js + main.js boot for the DOM wiring) ----
const input = {
  ax: 0, ay: 0,                    // held thrust direction (screen-aligned, up = -y)
  tractorEdge: false, restart: false, zoomEdge: 0,
  returnToBase: false, toggleMode: false,
  pickX: null, pickY: null,        // world tap → lock alien (in scan) or tow rock/junk
  dock: false, refuel: false, closeMenu: false,
  skillTap: null,                  // skill slot index (0/1) to toggle
  uiClick: null,                   // {x,y} routed to the active dock overlay
  dockTab: null,                   // "loadout" | "store" | "warp" | "ships" | "drones" | "fleet" | "contracts" request
  warpToggle: false,
  mapToggle: false,                // M key / MAP button → galaxy map overlay
  landEdge: false,                 // L key near a planet → land; also used as launch key in space
};

// ---- particles + toasts ----
const particles = [];
function burst(x, y, color, n = 8) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (rnd() * 2 - 1) * 110, vy: (rnd() * 2 - 1) * 110,
    life: 0.3 + rnd() * 0.4, t: 0, color });
}
function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i];
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.t >= p.life) particles.splice(i, 1); }
}
const toasts = [];   // { text, age } — shape ForgeHUD.drawToasts expects
function toast(text, col, life) { toasts.push({ text: text, age: 0, col, life }); if (toasts.length > 4) toasts.shift(); }
function stepToasts(dt) { for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].age += dt; if (toasts[i].age > (toasts[i].life || 3)) toasts.splice(i, 1); } }

/*=== HARNESS:ASSETS =========================================================
  Procedural baked fallback sprites (2.5D pseudo-sphere / 3/4 iso). Each is
  swappable for a Grok PNG via assets/<key>.png. draw() blits in SCREEN space.
============================================================================*/
const SS = 2;
const SPRITES = {
  defs: {}, img: {}, cache: {},
  define(k, spec) { this.defs[k] = spec; },
  load() {
    if (HEADLESS) return;
    for (const k of Object.keys(this.defs)) {
      const src = (typeof EMBEDDED_ASSETS !== "undefined" && EMBEDDED_ASSETS[k]) || `assets/${k}.png`;
      const im = new Image(); im.onload = () => { this.img[k] = im; }; im.onerror = () => {};
      im.src = src;
    }
  },
  _bake(k) {
    if (this.cache[k]) return this.cache[k];
    const s = this.defs[k], c = document.createElement("canvas");
    c.width = s.w * SS; c.height = s.h * SS;
    const g = c.getContext("2d"); g.scale(SS, SS); s.bake(g, s.w, s.h);
    this.cache[k] = c; return c;
  },
  draw(g, k, sx, sy, scale, rot) {
    const s = this.defs[k]; if (!s || HEADLESS) return;
    g.save(); g.translate(sx, sy); if (rot) g.rotate(rot); g.scale(scale, scale);
    const im = this.img[k];
    if (im) g.drawImage(im, -s.w / 2, -s.h / 2, s.w, s.h);
    else g.drawImage(this._bake(k), -s.w / 2, -s.h / 2, s.w, s.h);
    g.restore();
  },
};

/*=== HARNESS:EMBEDDED:BEGIN ===*/
const EMBEDDED_ASSETS = {};
/*=== HARNESS:EMBEDDED:END ===*/

/*=== HARNESS:GAME ===========================================================*/
// The whole game is one GAME object; methods are attached across the src files
// (camera / physics / world / player / economy / ui / main) and composed at
// build time. State is renderer-free so selfTest plays the loop headless.
const GAME = { state: null };
