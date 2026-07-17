/*=== HARNESS:POLITICAL_REGIONS ==============================================*/
// Faction politics — the NAMED region map, PIE-CHART edition. Faction space
// divides the solar disc like a pie: each faction owns a 120° wedge from the
// sun to the rim (Vex 0–120° · Krag 120–240° · Nox 240–360°; factionForPos in
// world/regions.js follows the same wedges, so the sector grid and outpost
// seeding are pie-native too). Each wedge subdivides into angular sub-regions
// spanning ALL radii — Vex ×3 and Nox ×3 at 40°, Krag ×4 at 30°, 10 regions
// total. Region membership is pure geometry — NO outpost ID lists:
// getOutpostsInRegion() filters the live outpost array by atan2 angle, and a
// region's controller is whichever side owns the most outposts inside it, so
// ALL ~150–400 organic outposts are the battlefield and the front line drifts
// one outpost at a time. Border regions are the slices touching another
// faction's wedge: Ember Gate ↔ The Frontier (120°), Warden's Reach ↔ The Void
// Rim (240°), and Pale March ↔ The Crucible across the 0° seam — the pie is a
// circle, so Vex and Nox share a front the old band map never had.
//
// DANGER LEVELS (EVE-style sec rating, 1 safest → 9 deadliest). The player
// spawns at Homeport Mira (~169°, Krag Depths), so danger radiates ANGULARLY
// from that wedge in both directions around the pie and the two ramps meet at
// the 0°/360° seam on the far side: Depths 1 → Ashfield 2 → Warden's 4 →
// Void Rim 5 → Shadow Basin 7 → Pale March 9 one way, Depths 1 → Frontier 3 →
// Ember Gate 4 → Iron Wall 6 → Crucible 8 the other. Every neighboring pair
// (seam included) differs by ≤2, and each cross-faction border slice carries a
// bump over the home-side interior it guards.
const REGIONS = [
  // ---- Vex: 0°–120° (aggressive, militaristic) ----
  { id: "vex_crucible", name: "The Crucible", faction: "vex", controller: "vex",
    minAngle: 0, maxAngle: 40, dangerLevel: 8,
    neighbors: ["vex_ironwall", "nox_palemarch"],
    lore: "Where the Vex Dominion tempers its officers in live-fire trials under the star's naked glare. The wrecks of the unworthy still orbit the proving grounds as instruction.",
    lastContestT: -1e9, contestFrom: null },
  { id: "vex_ironwall", name: "Iron Wall", faction: "vex", controller: "vex",
    minAngle: 40, maxAngle: 80, dangerLevel: 6,
    neighbors: ["vex_crucible", "vex_embergate"],
    lore: "A lattice of gun-fortresses older than the Dominion itself, welded hull to hull from the sun-lanes to the rim. Nothing has breached the Wall in living memory; the Vex intend to keep the count at zero.",
    lastContestT: -1e9, contestFrom: null },
  { id: "vex_embergate", name: "Ember Gate", faction: "vex", controller: "vex",
    minAngle: 80, maxAngle: 120, dangerLevel: 4,
    neighbors: ["vex_ironwall", "krag_frontier"],
    lore: "The Dominion's eastern gate, scorched black by a century of border wars with the Krag. Every scar on its bulkheads is logged, numbered, and owed.",
    lastContestT: -1e9, contestFrom: null },
  // ---- Krag: 120°–240° (industrial scavengers) ----
  { id: "krag_frontier", name: "The Frontier", faction: "krag", controller: "krag",
    minAngle: 120, maxAngle: 150, dangerLevel: 3,
    neighbors: ["vex_embergate", "krag_depths"],
    lore: "Boomtown rigs and claim-jumper fleets pressed hard against the Vex border. Everything here is bolted down twice — the Krag learned long ago that the Dominion takes what isn't.",
    lastContestT: -1e9, contestFrom: null },
  { id: "krag_depths", name: "Krag Depths", faction: "krag", controller: "krag",
    minAngle: 150, maxAngle: 180, dangerLevel: 1,   // Homeport Mira spawns here — the safest wedge
    neighbors: ["krag_frontier", "krag_ashfield"],
    lore: "Strip-mined moons and hollowed planetoids, worked by crews who haven't seen an open sky in generations. The Depths feed the Krag machine, and the machine is always hungry.",
    lastContestT: -1e9, contestFrom: null },
  { id: "krag_ashfield", name: "Ashfield", faction: "krag", controller: "krag",
    minAngle: 180, maxAngle: 210, dangerLevel: 2,
    neighbors: ["krag_depths", "krag_wardens"],
    lore: "A graveyard of slag-tips and burnt-out refinery hulks from the first expansion, now picked over by third-generation wreckers. The Krag waste nothing — least of all their own ruins.",
    lastContestT: -1e9, contestFrom: null },
  { id: "krag_wardens", name: "Warden's Reach", faction: "krag", controller: "krag",
    minAngle: 210, maxAngle: 240, dangerLevel: 4,
    neighbors: ["krag_ashfield", "nox_voidrim"],
    lore: "The watchtower line facing the Nox dark, crewed by Krag who volunteer once and never quite leave. They say the Wardens don't watch for the Nox — they watch for the moment the Nox stop pretending to be quiet.",
    lastContestT: -1e9, contestFrom: null },
  // ---- Nox: 240°–360° (cold, ancient, calculating) ----
  { id: "nox_voidrim", name: "The Void Rim", faction: "nox", controller: "nox",
    minAngle: 240, maxAngle: 280, dangerLevel: 5,
    neighbors: ["krag_wardens", "nox_shadowbasin"],
    lore: "Where the silence begins. Nox tithe-ships drift the Rim in patterns older than any charted war, and every Krag signal that crosses the line is answered — eventually, and on Nox terms.",
    lastContestT: -1e9, contestFrom: null },
  { id: "nox_shadowbasin", name: "Shadow Basin", faction: "nox", controller: "nox",
    minAngle: 280, maxAngle: 320, dangerLevel: 7,
    neighbors: ["nox_voidrim", "nox_palemarch"],
    lore: "A depression in the dark where even starlight arrives thin. The Nox keep their oldest vaults here, and no salvager who went in after them has ever filed a claim.",
    lastContestT: -1e9, contestFrom: null },
  { id: "nox_palemarch", name: "Pale March", faction: "nox", controller: "nox",
    minAngle: 320, maxAngle: 360, dangerLevel: 9,   // deepest null-sec — the far side of the ring from spawn
    neighbors: ["nox_shadowbasin", "vex_crucible"],
    lore: "The long cold road to the Vex frontier, marked by shrine-beacons that transmit nothing and miss nothing. The Nox call it a pilgrimage route. The Vex across the seam call it a siege line that has never once moved.",
    lastContestT: -1e9, contestFrom: null },
];

// world angle in degrees, normalized 0–360 (the coordinate every bound uses)
function polAngleDeg(x, y) {
  let a = Math.atan2(y, x) * 180 / Math.PI;
  if (a < 0) a += 360;
  return a;
}
function getRegion(id) { return REGIONS.find(r => r.id === id) || null; }
function getRegionController(id) { const r = getRegion(id); return r ? r.controller : null; }
function setRegionController(id, faction) { const r = getRegion(id); if (r) r.controller = faction; return r; }
// Border regions `faction` can legally attack: any region it does not control
// whose neighbor graph touches a region it DOES control. Queried on live
// controllers, so a captured region (player included) opens its whole
// neighborhood as new fronts automatically.
function getContestableRegions(faction) {
  return REGIONS.filter(r => r.controller !== faction &&
    r.neighbors.some(nid => { const n = getRegion(nid); return n && n.controller === faction; }));
}
// geometric membership — no ID lists; the live outpost array is the territory
function getOutpostsInRegion(regionId, outposts) {
  const r = getRegion(regionId);
  if (!r || !outposts) return [];
  return outposts.filter(o => { const a = polAngleDeg(o.x, o.y); return a >= r.minAngle && a < r.maxAngle; });
}
function politicalRegionAt(x, y) {
  const a = polAngleDeg(x, y);
  for (const r of REGIONS) if (a >= r.minAngle && a < r.maxAngle) return r;
  return null;
}

// ---- DANGER SYSTEM (EVE-style sec rating) -----------------------------------
// One table drives everything danger touches: item-tier odds on any drop,
// ore/credit yield multipliers, enemy hp/damage/reward scaling, and encounter
// squad sizes. Region dangerLevels live on REGIONS above; getDangerLevel(x,y)
// is the single lookup every consumer (drops, spawns, turrets, HUD) goes
// through, so danger is always a property of WHERE, never of what.
const DANGER = {
  // item tier odds (percent) per danger level
  tiers: {
    1: { normal: 80, rare: 18, unique:  2, elite:  0 },
    2: { normal: 70, rare: 25, unique:  5, elite:  0 },
    3: { normal: 60, rare: 30, unique:  9, elite:  1 },
    4: { normal: 50, rare: 35, unique: 12, elite:  3 },
    5: { normal: 40, rare: 35, unique: 20, elite:  5 },
    6: { normal: 30, rare: 35, unique: 25, elite: 10 },
    7: { normal: 20, rare: 30, unique: 30, elite: 20 },
    8: { normal: 10, rare: 25, unique: 35, elite: 30 },
    9: { normal:  5, rare: 20, unique: 35, elite: 40 },
  },
  // enemy stat scaling per danger level (hp × / damage × / credit bounty ×)
  enemy: {
    1: { hp: 0.5, dmg: 0.6,  reward: 1.0 },
    2: { hp: 0.7, dmg: 0.7,  reward: 1.2 },
    3: { hp: 0.9, dmg: 0.85, reward: 1.5 },
    4: { hp: 1.0, dmg: 1.0,  reward: 1.8 },
    5: { hp: 1.3, dmg: 1.2,  reward: 2.2 },
    6: { hp: 1.6, dmg: 1.4,  reward: 2.8 },
    7: { hp: 2.0, dmg: 1.7,  reward: 3.5 },
    8: { hp: 2.6, dmg: 2.1,  reward: 4.5 },
    9: { hp: 3.5, dmg: 2.8,  reward: 6.0 },
  },
  // base credit bounty an enemy kill spills (× the reward mult above)
  bounty: { normal: 15, rare: 40, unique: 70, elite: 120 },
};
function dangerColor(level) {   // 1-2 green · 3-4 yellow · 5-6 orange · 7-8 red · 9 crimson
  return level <= 2 ? "#22cc44" : level <= 4 ? "#cccc22" : level <= 6 ? "#cc7722"
       : level <= 8 ? "#cc2222" : "#880011";
}
function getDangerLevel(x, y) {
  const r = politicalRegionAt(x, y);
  return r ? r.dangerLevel : 1;
}
function rollDangerTier(level, rng) {
  const w = DANGER.tiers[clamp(Math.round(level) || 1, 1, 9)];
  let roll = ((rng || rnd)()) * 100;
  for (const t of ["normal", "rare", "unique", "elite"]) { roll -= w[t]; if (roll < 0) return t; }
  return "elite";
}
function dangerEnemyMult(level) { return DANGER.enemy[clamp(Math.round(level) || 1, 1, 9)]; }
// ore/credit yield bands: low-sec hauls at par, mid-sec ×1.5/×1.3, null-sec ×2.5/×1.6
function dangerLootMult(level) {
  return level <= 3 ? { credits: 1.0, ore: 1.0 }
       : level <= 6 ? { credits: 1.5, ore: 1.3 }
       :              { credits: 2.5, ore: 1.6 };
}
function dangerGroupBounds(level) { return level <= 3 ? [1, 2] : level <= 6 ? [2, 4] : [3, 6]; }
function dangerGroupSize(level, rng) {
  const b = dangerGroupBounds(level);
  return b[0] + ((((rng || rnd)()) * (b[1] - b[0] + 1)) | 0);
}
// scale a freshly generated ship (hp layers + weapon damage) to its spawn
// wedge and stamp the level/reward so kill rewards read the SPAWN danger
function applyDangerToShip(ship, level) {
  const m = dangerEnemyMult(level), hp = ship.hp;
  for (const k of ["shield", "shieldMax", "armor", "armorMax", "hull", "hullMax"]) hp[k] *= m.hp;
  ship.weaponDmg *= m.dmg;
  ship._dangerLevel = level;
  ship._rewardMult = m.reward;
  return ship;
}
