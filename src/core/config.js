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
  // Four LINES (shipLines below drives the SHIPS market carousel grouping):
  //   hauler — the freighter-tug progression (starter line, credits only)
  //   krag   — LOW-output faction yard: battlecruisers. Brawler playstyle —
  //            thick armor, huge mass (plows rocks aside), ram-forward, cheap.
  //   vex    — MEDIUM-output faction yard: destroyers. Gun-platform playstyle —
  //            speed, weapon damage + fire rate, thinner plate.
  //   nox    — HIGH-output faction yard: carriers. Fleet-command playstyle —
  //            escortSlots raises the drone escort wing cap (base 3, top 6 =
  //            the whole hangar), big shields/scan, heaviest mass in the game.
  // baseShip.mass feeds the ship↔rock/junk/obstacle collision impulse
  // (physics.circleHit) AND scales ram damage down — heavy hulls shrug off
  // the debris they shove aside. Faction hulls price in EXOTIC ORE
  // (cost.ore, deducted from s.ore holdings) on top of credits.
  hulls: {
    vulture: {
      name: "Vulture Tug", tier: "STARTER", line: "hauler",
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
        mass: 2,
      },
    },
    atlas: {
      name: "Atlas Freighter", tier: "MID-TIER", line: "hauler",
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
        mass: 3,
      },
    },
    aegis: {
      name: "Aegis Warhauler", tier: "HEAVY", line: "hauler",
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
        mass: 3.5,
      },
    },
    // ---- KRAG battlecruisers (low-tier yard · armor brawlers) ----
    krag_ironclad: {
      name: "Krag Ironclad", tier: "BC MK I", line: "krag",
      desc: "riveted rust-iron brawler — all armor, all attitude, shoves rocks like furniture",
      cost: { credits: 38000 }, baseTows: 3,
      unlock: { outposts: 2, danger: 3 },
      baseShip: {
        shieldMax: 1600, shieldRegen: 70, shieldDelay: 3.2,
        armorMax: 2400, armorRepair: 0,
        hullMax: 1500,
        res: { shield: 0, armor: 0.30, hull: 0 },
        fuelMax: 1600, solarRegen: 2.2,
        thrust: 95, turnSpeed: 85,
        scanRange: 950,
        tractorRange: 650, tractorStr: 1.2,
        fuelCostK: 1,
        weaponDmg: 12, fireRate: 1,
        mass: 4,
      },
    },
    krag_warbarge: {
      name: "Krag Warbarge", tier: "BC MK II", line: "krag",
      desc: "layered plate and salvage cranes — a rolling fortress that hauls on the side",
      cost: { credits: 125000, ore: { iridium: 4 } }, baseTows: 4,
      unlock: { outposts: 6, danger: 5 },
      baseShip: {
        shieldMax: 2000, shieldRegen: 75, shieldDelay: 3.1,
        armorMax: 3300, armorRepair: 0,
        hullMax: 2100,
        res: { shield: 0, armor: 0.35, hull: 0.05 },
        fuelMax: 1700, solarRegen: 2.4,
        thrust: 100, turnSpeed: 90,
        scanRange: 1000,
        tractorRange: 700, tractorStr: 1.4,
        fuelCostK: 1,
        weaponDmg: 15, fireRate: 1,
        mass: 6,
      },
    },
    krag_dreadnought: {
      name: "Krag Dreadnought", tier: "BC MK III", line: "krag",
      desc: "the fortress that flies — a toothed ram prow and enough plate to ignore the map",
      cost: { credits: 300000, ore: { iridium: 8, cryonite: 4 } }, baseTows: 5,
      unlock: { outposts: 12, danger: 7 },
      baseShip: {
        shieldMax: 2600, shieldRegen: 85, shieldDelay: 3.0,
        armorMax: 4500, armorRepair: 2,
        hullMax: 2800,
        res: { shield: 0.05, armor: 0.40, hull: 0.10 },
        fuelMax: 1800, solarRegen: 2.6,
        thrust: 105, turnSpeed: 95,
        scanRange: 1050,
        tractorRange: 750, tractorStr: 1.6,
        fuelCostK: 1,
        weaponDmg: 18, fireRate: 1,
        mass: 8,
      },
    },
    // ---- VEX destroyers (medium-tier yard · gun platforms) ----
    vex_lance: {
      name: "Vex Lance", tier: "DD MK I", line: "vex",
      desc: "knife-blade destroyer — first to the fight, first on the trigger",
      cost: { credits: 75000 }, baseTows: 3,
      unlock: { outposts: 4, danger: 4 },
      baseShip: {
        shieldMax: 2200, shieldRegen: 85, shieldDelay: 2.8,
        armorMax: 1600, armorRepair: 0,
        hullMax: 1300,
        res: { shield: 0.05, armor: 0.20, hull: 0 },
        fuelMax: 1500, solarRegen: 2,
        thrust: 130, turnSpeed: 125,
        scanRange: 1200,
        tractorRange: 600, tractorStr: 1,
        fuelCostK: 1,
        weaponDmg: 16, fireRate: 1.15,
        mass: 3.5,
      },
    },
    vex_saber: {
      name: "Vex Saber", tier: "DD MK II", line: "vex",
      desc: "twin spinal cannons and no patience — the fleet's favorite executioner's blade",
      cost: { credits: 250000, ore: { iridium: 6, cryonite: 3 } }, baseTows: 3,
      unlock: { outposts: 10, danger: 6 },
      baseShip: {
        shieldMax: 2900, shieldRegen: 95, shieldDelay: 2.6,
        armorMax: 2100, armorRepair: 0,
        hullMax: 1700,
        res: { shield: 0.10, armor: 0.25, hull: 0 },
        fuelMax: 1600, solarRegen: 2.2,
        thrust: 140, turnSpeed: 130,
        scanRange: 1300,
        tractorRange: 600, tractorStr: 1.1,
        fuelCostK: 1,
        weaponDmg: 20, fireRate: 1.25,
        mass: 5,
      },
    },
    vex_executor: {
      name: "Vex Executor", tier: "DD MK III", line: "vex",
      desc: "a siege cannon with a ship built around it — the argument-ender of the Vex navy",
      cost: { credits: 600000, ore: { cryonite: 8, solarite: 4 } }, baseTows: 4,
      unlock: { outposts: 16, danger: 8 },
      baseShip: {
        shieldMax: 3800, shieldRegen: 110, shieldDelay: 2.4,
        armorMax: 2700, armorRepair: 0,
        hullMax: 2200,
        res: { shield: 0.15, armor: 0.30, hull: 0.05 },
        fuelMax: 1700, solarRegen: 2.4,
        thrust: 150, turnSpeed: 135,
        scanRange: 1400,
        tractorRange: 650, tractorStr: 1.2,
        fuelCostK: 1,
        weaponDmg: 26, fireRate: 1.35,
        mass: 7,
      },
    },
    // ---- NOX carriers (high-tier yard · fleet command) ----
    nox_veil: {
      name: "Nox Veil", tier: "CV MK I", line: "nox",
      desc: "escort carrier grown from living crystal — your drones come home to it",
      cost: { credits: 200000, ore: { iridium: 8 } }, baseTows: 4,
      escortSlots: 4,
      unlock: { outposts: 8, danger: 6 },
      baseShip: {
        shieldMax: 3200, shieldRegen: 100, shieldDelay: 2.6,
        armorMax: 2200, armorRepair: 0,
        hullMax: 2000,
        res: { shield: 0.10, armor: 0.20, hull: 0 },
        fuelMax: 1800, solarRegen: 2.8,
        thrust: 110, turnSpeed: 90,
        scanRange: 1400,
        tractorRange: 700, tractorStr: 1.3,
        fuelCostK: 1,
        weaponDmg: 15, fireRate: 1,
        mass: 6,
      },
    },
    nox_umbra: {
      name: "Nox Umbra", tier: "CV MK II", line: "nox",
      desc: "twin-deck fleet carrier — a wing of five and sensors that see the whole wedge",
      cost: { credits: 500000, ore: { solarite: 6, cryonite: 6 } }, baseTows: 5,
      escortSlots: 5,
      unlock: { outposts: 14, danger: 8 },
      baseShip: {
        shieldMax: 4200, shieldRegen: 120, shieldDelay: 2.4,
        armorMax: 3000, armorRepair: 0,
        hullMax: 2600,
        res: { shield: 0.15, armor: 0.25, hull: 0.05 },
        fuelMax: 2000, solarRegen: 3.2,
        thrust: 115, turnSpeed: 95,
        scanRange: 1600,
        tractorRange: 750, tractorStr: 1.5,
        fuelCostK: 1,
        weaponDmg: 19, fireRate: 1.1,
        mass: 9,
      },
    },
    nox_eclipse: {
      name: "Nox Eclipse", tier: "CV MK III", line: "nox",
      desc: "the cathedral supercarrier — six drones, a full hangar aloft, junk parts before its bow",
      cost: { credits: 1000000, ore: { voidium: 6, solarite: 8 } }, baseTows: 6,
      escortSlots: 6,
      unlock: { outposts: 20, danger: 9 },
      baseShip: {
        shieldMax: 5500, shieldRegen: 140, shieldDelay: 2.2,
        armorMax: 3800, armorRepair: 3,
        hullMax: 3400,
        res: { shield: 0.20, armor: 0.30, hull: 0.10 },
        fuelMax: 2200, solarRegen: 3.6,
        thrust: 120, turnSpeed: 100,
        scanRange: 1800,
        tractorRange: 800, tractorStr: 1.8,
        fuelCostK: 1,
        weaponDmg: 24, fireRate: 1.15,
        mass: 12,
      },
    },
  },
  // SHIPS-market carousel line order + labels (ships.js). Faction yards are
  // rated by ship output: krag LOW, vex MEDIUM, nox HIGH.
  shipLines: {
    hauler: { name: "Hauler Guild",  sub: "freighter-tug line · the working fleet",           col: "#57d1c9" },
    krag:   { name: "Krag Foundry",  sub: "LOW-tier yard · battlecruisers — armor & mass",    col: "#ff9a5a" },
    vex:    { name: "Vex Arsenal",   sub: "MED-tier yard · destroyers — speed & firepower",   col: "#ff6b6b" },
    nox:    { name: "Nox Grove",     sub: "HIGH-tier yard · carriers — fleet command",        col: "#c9b8ff" },
  },
  // ---- AGE-OF-SAIL combat retune (GAME.tuneCombatCatalog applies these to the
  // shared weapon catalog at load; player AND aliens draw from the same bases so
  // their DPS stays symmetric). rate ×2 + damage ×2 is DPS-NEUTRAL — same kill
  // times, but each shot is a slow, heavy, committed broadside instead of a
  // fire-and-forget stream. fuelPerShot ×2.3 puts a premium on opening fire, so
  // sustained shooting draws down the shared fuel pool you also need for the
  // shield booster and for escaping. Tune here, rebuild, re-run the TTK sim. ----
  combat: { fireRateMult: 2.0, dmgMult: 2.0, fuelPerShotMult: 2.3 },
  // ---- weapon projectiles / cooldown fallbacks ----
  rockHp: (mass) => Math.round(mass * 16 + 8),
  junkHp: 14, projLife: 1.4, projR: 5, weaponCd: 0.6,
  // ---- collision broadphase (GAME.rockPairPass) ----
  collNear: 4000,   // ship-centred radius the rock pair pass considers
  collCell: 128,    // grid cell; must exceed the largest rock's diameter (~67)
  // ---- camera (pitch = foreshortened world-y) ----
  pitch: 0.82, zoom0: 1.0, zoomMin: 0.08, zoomMax: 3.0, zoomStep: 1.18, zoomLerp: 0.12,
  // ---- ORE rings (centered on home station at Mira; ore sells directly) ----
  // n = legacy home-ring spawn count (n:0 = never seeded at home). Only the
  // first five (junk→platinum) ring the home station; every other ore is a
  // map-only find distributed by CONFIG.oreBands (distance-weighted variety).
  //   INDUSTRIAL (refine→bars, drone economy): copper/silver/gold/platinum
  //   PRECIOUS   (raw-sell variety, indices 9-12): hematite/titanium/malachite/cobalt
  //   EXOTIC     (raw-sell, veins + rare map sprinkle, indices 5-8): iridium…voidium
  // Indices 0-4 are load-bearing (belt/nebula/fieldTier index CONFIG.rings by
  // position) — APPEND new ores, never reorder the first five.
  rings: [
    { r: 400,  n: 8, type: "junk",     value: 8,     mass: 1.0, col: "#8a8f98", rarity: "normal" },
    { r: 1000, n: 7, type: "copper",   value: 30,    mass: 1.4, col: "#c9784a", rarity: "normal" },
    { r: 2200, n: 6, type: "silver",   value: 90,    mass: 1.8, col: "#c8d4e0", rarity: "rare" },
    { r: 4000, n: 5, type: "gold",     value: 240,   mass: 2.4, col: "#ffd24a", rarity: "unique" },
    { r: 7000, n: 4, type: "platinum", value: 600,   mass: 3.2, col: "#7ff0e8", rarity: "elite" },
    { r: 0,    n: 0, type: "iridium",  value: 1500,  mass: 3.6, col: "#b78aff", rarity: "exotic" },
    { r: 0,    n: 0, type: "cryonite", value: 3200,  mass: 4.0, col: "#4a86ff", rarity: "exotic" },
    { r: 0,    n: 0, type: "solarite", value: 7000,  mass: 4.4, col: "#ff5a4a", rarity: "exotic" },
    { r: 0,    n: 0, type: "voidium",  value: 15000, mass: 5.0, col: "#ff4ad8", rarity: "exotic" },
    // precious variety ores — interleave the classic value tiers, own distinct hues
    { r: 0,    n: 0, type: "hematite", value: 45,    mass: 1.5, col: "#b5533a", rarity: "normal" },
    { r: 0,    n: 0, type: "titanium", value: 65,    mass: 1.6, col: "#6b7f9c", rarity: "normal" },
    { r: 0,    n: 0, type: "malachite",value: 150,   mass: 2.0, col: "#3fae72", rarity: "rare"   },
    { r: 0,    n: 0, type: "cobalt",   value: 430,   mass: 2.8, col: "#4468c8", rarity: "unique" },
  ],
  oreNames: { junk: "Slag Ore", copper: "Copper Ore", silver: "Silver Ore", gold: "Gold Ore", platinum: "Platinum Ore",
              iridium: "Iridium Ore", cryonite: "Cryonite Ore", solarite: "Solarite Ore", voidium: "Voidium Ore",
              hematite: "Hematite Ore", titanium: "Titanium Ore", malachite: "Malachite Ore", cobalt: "Cobalt Ore" },
  // Distance-weighted ore mix for ordinary fields (world/ores.js zoneOreRing).
  // Each band lists {type: weight}; deeper bands trend richer. This is what makes
  // the general map varied instead of "gold/silver/platinum everywhere". Belt +
  // nebula fields bypass this (guaranteed gold/platinum paydays).
  oreBands: [
    { maxDist: 20000, w: { junk: 12, copper: 30, hematite: 26, titanium: 18, silver: 10, malachite: 4 } },
    { maxDist: 45000, w: { copper: 8, hematite: 10, titanium: 18, silver: 24, malachite: 20, gold: 10, cobalt: 12 } },
    { maxDist: 1e9,   w: { titanium: 8, silver: 14, malachite: 20, gold: 15, cobalt: 26, platinum: 17 } },
  ],
  debugStartCredits: 10000,        // DEBUG: starting purse — drop back to 0 before ship
  ringSpread: 60,
  rarityCol: { normal: "#b8c0cc", rare: "#5fa8ff", unique: "#c77dff", elite: "#ffb020" },
  // ---- solar system layout ----
  WORLD_RADIUS: 85000,
  STAR_RADIUS: 1800,
  FOG_TILE: 2000,
  solarPlanets: [
    // r +25% (2026-07-17 look/feel pass): planets read too small next to the
    // clay globes' presence. Stations sit at r*2.8 (main.js) and rings/gravity
    // scale off r, so everything follows; orbit gaps still clear the rings.
    { name: "Vesper",    orbit: 8000,  r: 1000, type: "cratered",   moons: 0, rings: false, stationIdx: 1, faction: "vex" },
    { name: "Cinder",    orbit: 14000, r: 1250, type: "lava",       moons: 1, rings: false, stationIdx: 2, faction: "vex" },
    { name: "Arix",      orbit: 22000, r: 2250, type: "tan_gas",    moons: 2, rings: true,  stationIdx: 3, faction: "vex" },
    { name: "Dusk",      orbit: 32000, r: 1500, type: "ice",        moons: 1, rings: false, stationIdx: 4, faction: "krag" },
    { name: "Mira",      orbit: 44000, r: 1750, type: "life",       moons: 2, rings: false, stationIdx: 0, faction: "krag" },
    { name: "Sorn",      orbit: 58000, r: 1375, type: "desert",     moons: 1, rings: false, stationIdx: 5, faction: "krag" },
    { name: "Halveth",   orbit: 72000, r: 2500, type: "purple_gas", moons: 3, rings: true,  stationIdx: 6, faction: "nox" },
    { name: "Nox Prime", orbit: 80000, r: 2000, type: "dark",       moons: 1, rings: false, stationIdx: 7, faction: "nox" },
  ],
  // Deep-space stations — free-floating quest hubs for the two territories the
  // planet layout leaves stationless (Ashfield 180–210° · Pale March 320–360°;
  // wedges in game/regions.js). stationIdx continues the ForgeWorld id sequence
  // after the 8 planet-bound stations; angleDeg/dist must land inside the
  // territory's wedge and the region grid (main.js pushes them at init).
  deepSpaceStations: [
    { name: "Wrecker's Anchorage", territory: "Ashfield",   stationIdx: 8, angleDeg: 195, dist: 36000, faction: "krag" },
    { name: "Shrine Terminus",     territory: "Pale March", stationIdx: 9, angleDeg: 340, dist: 62000, faction: "nox" },
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
  // counts −30% (2026-07-17 look/feel pass — clay sprites made the old density
  // read as clutter)
  junkPlanetHaloMin: 18, junkPlanetHaloMax: 27,
  junkHaloDistMin: 1500, junkHaloDistMax: 4000,
  junkLaneMin: 14, junkLaneMax: 21, junkLaneSpread: 2000,
  junkClusterMin: 9, junkClusterMax: 12,
  junkClusterRMin: 200, junkClusterRMax: 400, junkClusterStationGap: 1200,
  junkHotspotMin: 4, junkHotspotMax: 7,
  junkFillMin: 50, junkFillMax: 70,
  stationDebrisMin: 14, stationDebrisMax: 21,
  stationDebrisDistMin: 500, stationDebrisDistMax: 800,
  junkDriftMin: 0.1, junkDriftMax: 0.4,
  // Depositing a towed rock/junk at a station used to respawn it INSTANTLY back
  // into its zone — right outside the station you were docked at — which let the
  // player spam-mine home base for free modules. Non-field deposits now free the
  // slot and queue a delayed respawn (world/ores.js, world/junk.js, game/economy.js)
  // so the resource has to regenerate over time. Field rocks are unaffected — they
  // already stream out and regen via fieldRegenPerSec.
  depositRespawnDelay: 150,   // seconds before a deposited zone rock/junk re-scatters
  junkTypes: [   // keys match ForgeItemSystem drop_map exactly
    // r drives collision + tap radius AND draw scale (rendering.js j.r×5). Bumped
    // ~1.5× (2026-07-16) so salvage reads at the same visual weight as ore rocks
    // (rocks draw at size×54 ≈ 42–90px; junk now ≈ 55–75px) instead of tiny specks.
    { key: "junk_can",    r: 14 },
    { key: "junk_panel",  r: 15 },
    { key: "junk_crate",  r: 13 },
    { key: "junk_debris", r: 11 },
  ],
  // ---- zone rock density (World Density Pass; ~1000 rocks total) ----
  // asteroidBelt (r=37k–40k between Dusk and Mira) is the payday zone: 200–240
  // gold/platinum bonus rocks. Each planet gets a full-360° ore torus at its
  // orbital radius ±oreRingSpread; each moon a tight cluster; enemy bases a
  // scatter field; the remainder is background clusters of 3–8.
  // −30% across static zones (2026-07-17 look/feel pass): with the clay rock
  // sprites the old density read as clutter — fields should feel like finds,
  // not wallpaper.
  beltRocksMin: 140, beltRocksMax: 168,
  oreRingRocksMin: 35, oreRingRocksMax: 46, oreRingSpread: 3000,
  moonRocksMin: 6, moonRocksMax: 9, moonRockDist: 600,
  bgRocksMin: 70, bgRocksMax: 98, bgClusterMin: 3, bgClusterMax: 6,
  baseRocksMin: 14, baseRocksMax: 20, baseRockDist: 2000,
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
  fieldJunkFrac: 0.40,        // junk floaters spawned per field = frac × rock cap
                              // (0.56→0.40 with the 2026-07-17 −30% clutter pass —
                              // junk thins along with rocks this time)
  // cap ranges: −20% 2026-07-16, then a further −30% (2026-07-17 look/feel
  // pass) — the clay sprites carry more visual weight per rock, so fewer sell
  // the same richness without clutter.
  fieldBeltCount: 6,   fieldBeltR: 2400,  fieldBeltCapMin: 95, fieldBeltCapMax: 140,
  fieldRingPerPlanet: 3, fieldRingR: 2700, fieldRingCapMin: 34, fieldRingCapMax: 62,
  fieldMoonR: 900,     fieldMoonCapMin: 8, fieldMoonCapMax: 13,
  fieldBaseR: 1600,    fieldBaseCapMin: 13, fieldBaseCapMax: 20,
  fieldNebulaR: 1800,  fieldNebulaCapMin: 22, fieldNebulaCapMax: 39,
  fieldBgRMin: 2400,   fieldBgRMax: 3000, fieldBgCapMin: 17, fieldBgCapMax: 50,
  // ---- exotic ore veins (world/fields.js kind "exotic") ------------------------
  // Tight, rare pockets of the four exotic ores; the vein's whole stock is ONE
  // ore. Tier is by distance band (deeper = better), roll chance per band keeps
  // rarer ores in rarer veins. Veins never land in a station's sector, and
  // seedOutposts skips any sector holding one (region.exotic) — exotics are
  // always a trip into open space.
  exoticOres: [
    { maxDist: 32000, type: "iridium",  chance: 0.040 },
    { maxDist: 52000, type: "cryonite", chance: 0.030 },
    { maxDist: 68000, type: "solarite", chance: 0.022 },
    { maxDist: 1e9,   type: "voidium",  chance: 0.015 },
  ],
  exoticMinDist: 8000,        // keep veins out of the star's glare (cf. outposts' 6000)
  exoticFieldR: 1300, exoticCapMin: 10, exoticCapMax: 16,
  // Beyond the veins, a trace of exotic ore is salted into ORDINARY fields
  // map-wide (past exoticMinDist) — the "AHH what's that?" single-rock surprise.
  // Type follows the same distance bands as the veins (exoticRingFor). Kept low
  // so exotics stay a premium find, not a staple.
  exoticSprinkleChance: 0.0016,
  // ---- obstacle terrain bodies (world/obstacles.js) ---------------------------
  // Large, solid, non-minable planetoids scattered in open space — no ore, not
  // lockable/tappable/towable, they just have mass and get in the way. The ship
  // bounces off them (elastic circleHit); a fast ram stings (speed-scaled, invuln-
  // gated), a slow nudge is free. Seeded deterministically at world build, clear
  // of stations/planets/outposts and the home tutorial bubble; slow drift + spin.
  obstacleCount: 170,          // total bodies scattered across the disc
  obstacleMinDist: 2600,       // min spacing between bodies (no clumping)
  obstacleClearStation: 3200,  // keep clear of station centers
  obstacleClearPlanet: 2600,   // keep clear of planet surfaces (+ planet.r)
  obstacleClearOutpost: 1400,  // keep clear of outpost platforms
  obstacleClearHome: 9000,     // empty tutorial bubble around the start
  obstacleTiers: [             // radius range + spawn weight per size class
    { rMin: 90,  rMax: 160, w: 5 },     // small
    { rMin: 175, rMax: 285, w: 3 },     // medium
    { rMin: 300, rMax: 470, w: 1.4 },   // large
  ],
  obstacleMassK: 0.02,         // mass = r·r·K → very heavy, so the ship bounces off
  obstacleDriftMax: 5,         // u/s slow drift ("floatable")
  obstacleSpinMax: 0.12,       // rad/s slow tumble
  obstacleRamDmg: 8,           // base ram damage; + speed·K, capped, invuln-gated
  obstacleRamSpeedK: 0.05,     // extra ram damage per u/s of impact speed
  obstacleRamMax: 34,          // ram damage ceiling
  obstacleRamMinSpeed: 90,     // impacts slower than this do no damage (just a bump)
  siteCollK: 0.4,              // site piece solid-core radius as a fraction of its draw width
  siteMass: 4000,             // pieces collide as effectively immovable walls (ship bounces off)
  // ---- garrison avoidance steering (faction.js reads alien._avoid, sites.js fills it) ----
  // Enemies pursuing the player blend a perpendicular repulsion away from nearby
  // heavy-body circles so they flank around site chunks instead of grinding into
  // them. Zero footprint when _avoid is unset (all non-site combat unchanged).
  avoidPad: 150,              // avoidance influence reaches this far past a body's surface
  avoidPush: 0.35,            // small outward bias layered on the tangent so hulls aren't grazed
  guardLoseSightT: 3,         // s a garrison guard may lose sight of the player before giving up
  guardLoseSightDist: 800,    // ...and only past this range, so hugging a chunk never shakes them
  // ---- site base emplacements (game/sites.js) ---------------------------------
  // A fixed high-damage weapon platform bolted to the centrepiece of the two
  // guarded site themes: alien_derelict → charged laser cannon, shipwreck →
  // missile barrage. Both also launch homing torpedo drones. Resource clusters
  // stay unarmed. The emplacement has its own hull pool (danger-scaled), is
  // lockable + destroyable, and every projectile respects line-of-sight so the
  // site's own heavy chunks are cover. Speeds are world u/s; a thrusting player
  // tops out ~2300 u/s, so the torpedo (~40% of that) is escapable by a committed
  // sprint but runs down a maneuvering ship — break it on a chunk instead.
  empThemeWeapon: { alien_derelict: "laser", shipwreck: "missile" },
  // Rarity gate. MOST guarded sites are just a garrison fleet — a base emplacement
  // is a depth layer, not the default, so meeting one has to feel like walking
  // into a stronghold. Odds are indexed by the wedge's danger rating (1-9): the
  // home wedges never fortify, null-sec often does. Rolled deterministically per
  // region, so a site's fortification is stable across inits and saves.
  empChanceByDanger: [0, 0, 0.02, 0.06, 0.12, 0.20, 0.30, 0.44, 0.58, 0.72],
  empHpBase: 560,             // hull pool before danger scaling (×dangerEnemyMult.hp); armor pool = ×0.55
  empRange: 1500,             // player must be within this for the platform to engage
  empRegen: 0,                // no self-repair — damage sticks between visits
  // missile barrage: a cone of dumb-fire missiles, area denial (dodge the gaps)
  empMissileCdMin: 8000, empMissileCdMax: 12000,   // ms between barrages
  empMissileCount: [3, 5],    // missiles per barrage (inclusive range)
  empMissileSpreadDeg: 18,    // half-angle of the firing cone — tight enough to threaten, gapped enough to weave
  empMissileSpeed: 560,       // medium, clearly dodgeable
  empMissileDmg: 16,          // per hit before danger scaling — moderate
  empMissileLife: 6000,       // ms before a missile fizzles
  empMissileR: 8,             // hit radius vs the ship
  // charged laser cannon: 3s telegraphed lock, then a near-instant heavy beam
  empLaserCdMs: 20000,        // ms between shots (the engage window)
  empLaserLockMs: 3000,       // lock-on charge time — break LoS or leave range to dodge
  empLaserArmorFrac: 0.5,     // beam deals 50% of max armor as damage (after dropping shields)
  empLaserBeamMs: 380,        // beam flash duration
  empLaserR: 26,              // beam impact tolerance around the locked point
  // homing torpedo drone: slow relentless hunter, one-shots weak ships
  empTorpedoCdMin: 30000, empTorpedoCdMax: 45000, // ms between launches
  empTorpedoSpeed: 900,       // ~40% of player sprint — outrun it or break it on terrain
  empTorpedoTurn: 2.2,        // rad/s tracking — nimble enough to juke
  empTorpedoDmg: 68,          // massive; danger-scaled
  empTorpedoR: 14,            // hit radius vs the ship
  empTorpedoHp: 14,           // shootable — a few laser hits kill it
  empTorpedoLife: 22000,      // ms before it self-destructs (safety valve)
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
  Procedural baked sprites (2.5D pseudo-sphere / 3/4 iso), rastered on demand
  by _bake(). draw() blits in SCREEN space. (External PNG art is the separate
  ART layer in game/sprites.js.)
============================================================================*/
const SS = 2;
const SPRITES = {
  defs: {}, cache: {},
  define(k, spec) { this.defs[k] = spec; },
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
    g.drawImage(this._bake(k), -s.w / 2, -s.h / 2, s.w, s.h);
    g.restore();
  },
};

/*=== HARNESS:GAME ===========================================================*/
// The whole game is one GAME object; methods are attached across the src files
// (camera / physics / world / player / economy / ui / main) and composed at
// build time. State is renderer-free so selfTest plays the loop headless.
const GAME = { state: null };
