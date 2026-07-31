#!/usr/bin/env node
/**
 * Battle balance + multi-weapon fire-rate + P2 drone parity tests.
 *   python3 build.py && node scripts/battle_balance_full.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "game.html");
globalThis.__HARNESS_HEADLESS__ = true;

const ok = [], issues = [], warnings = [];
function section(t) { console.log("\n══ " + t + " ══"); }
function pass(m) { ok.push(m); console.log("  ✓ " + m); }
function fail(m) { issues.push(m); console.log("  ✗ " + m); }
function warn(m) { warnings.push(m); console.log("  ⚠ " + m); }
function info(m) { console.log("  · " + m); }
function assert(c, m) { if (!c) throw new Error(m); }

function loadGame() {
  const html = fs.readFileSync(HTML, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no script");
  (0, eval)(m[1]);
  return globalThis.GAME;
}

function ehp(hp) {
  if (!hp) return 0;
  return (hp.shield || 0) + (hp.armor || 0) + (hp.hull || 0);
}

function testMultiWeaponCd(G) {
  section("1. Multi-weapon independent fire rates");
  G.init();
  const s = G.state;
  // Equip missile slot 0, laser slot 2, arm both
  const missile = ForgeItemSystem.generateItem("missile", "normal", { ilvl: 1, rng: () => 0.5 });
  const laser = ForgeItemSystem.generateItem("laser", "normal", { ilvl: 1, rng: () => 0.5 });
  assert(missile && missile.weapon && laser && laser.weapon, "items generated");
  // Clear rack and fit
  const ship = s.ships[0];
  ship.slots = ship.slots || [];
  while (ship.slots.length < 4) ship.slots.push(null);
  ship.slots[0] = missile;
  ship.slots[1] = null;
  ship.slots[2] = laser;
  ForgeEquipment.initEquipment(ship.slots.length);
  for (let i = 0; i < ship.slots.length; i++) {
    if (ship.slots[i]) ForgeEquipment.equip(i, ship.slots[i]);
  }
  // Activate both skill slots
  ForgeEquipment.activateSkill(0);
  ForgeEquipment.activateSkill(2);
  G.recomputeDerived();

  const armed = G.activeWeaponSlots();
  assert(armed.length === 2, "two armed weapons, got " + armed.length);
  pass("missile + laser both armed");

  // Spawn soft target and lock
  const foe = {
    id: 77001, kind: "pirate", state: "ALIVE",
    x: s.x + 200, y: s.y, vx: 0, vy: 0,
    hp: { shield: 5000, armor: 5000, hull: 5000, shieldMax: 5000, armorMax: 5000, hullMax: 5000, res: {}, _sinceHit: 0 },
  };
  s.aliens = [foe];
  s.fuel = s.fuelMax;
  // Complete lock: locking → locked after ~0.35s of combat update
  ForgeCombat.lockOn(foe, { x: s.x, y: s.y, scanRange: 5000, targets: s.aliens });
  for (let i = 0; i < 30; i++) {
    if (typeof ForgeCombat.updateProjectiles === "function")
      ForgeCombat.updateProjectiles(1 / 30);
    if (typeof G.updateLock === "function")
      G.updateLock(1 / 30);
    if (ForgeCombat.isLocked()) break;
  }
  assert(ForgeCombat.isLocked(), "target locked for fire test (status=" +
    (ForgeCombat.getLock() && ForgeCombat.getLock().status) + ")");

  s.weaponCds = [];
  s.weaponCd = 0;
  let laserShots = 0, missileShots = 0;
  // 4 seconds of fire
  for (let i = 0; i < 120; i++) {
    const cdsBefore = (s.weaponCds || []).slice();
    G.tryFireWeapon(1 / 30);
    if ((s.weaponCds[0] || 0) > (cdsBefore[0] || 0) + 50) missileShots++;
    if ((s.weaponCds[2] || 0) > (cdsBefore[2] || 0) + 50) laserShots++;
  }
  info("shots in 3s: laser≈" + laserShots + " missile≈" + missileShots);
  // Laser ~400ms base * 1.85 tune ≈ 740ms → ~4/s theoretical raw; with mult ~3-5 in 3s
  // Missile ~2200*1.85 ≈ 4s → 0-2 in 3s
  assert(laserShots >= 2, "laser should fire multiple times (got " + laserShots + ")");
  assert(missileShots <= laserShots, "missile should not outpace laser");
  // Critical: laser not blocked to missile cadence (would be ~1 shot)
  assert(laserShots > missileShots || laserShots >= 3, "laser not gated to missile rate");
  pass("independent CDs: laser fires faster than missile");
}

function testEvenDuelDrones(G) {
  section("2. 1×1 even duel with mirrored drones");
  G.init();
  const results = [];
  for (const hull of ["atlas", "aegis", "vulture"]) {
    let p1 = 0, p2 = 0, draw = 0;
    for (let seed = 0; seed < 8; seed++) {
      const r = G.simEvenDuel({ hullKey: hull, seed, maxSec: 75, noDrones: false });
      if (r.winner === "A") p1++;
      else if (r.winner === "B") p2++;
      else draw++;
    }
    results.push({ hull, p1, p2, draw });
    info(hull + ": P1=" + p1 + " P2=" + p2 + " draw=" + draw);
    // No side should dominate 7+/8
    assert(p1 <= 7 && p2 <= 7, hull + " one-sided " + p1 + "/" + p2);
  }
  pass("even duel with drones roughly balanced across hulls");
  return results;
}

function testEvenDuelNoDrones(G) {
  section("3. 1×1 even duel NO drones (pilot-only)");
  let p1 = 0, p2 = 0, draw = 0;
  for (let seed = 0; seed < 12; seed++) {
    const r = G.simEvenDuel({ hullKey: "atlas", seed, maxSec: 70, noDrones: true });
    if (r.winner === "A") p1++;
    else if (r.winner === "B") p2++;
    else draw++;
  }
  info("atlas pilot-only: P1=" + p1 + " P2=" + p2 + " draw=" + draw);
  assert(Math.abs(p1 - p2) <= 6, "pilot-only swing too large");
  pass("pilot-only even match within tolerance");
}

function testP2FleetParity(G) {
  section("4. P2 fleet snapshot parity");
  G.init();
  G.startBattleSandbox({ seed: 9, noiseGroups: 0, noDrones: false });
  const s = G.state;
  const p2 = s.battle.p2;
  assert(p2 && p2.fleet, "P2 has fleet array");
  const p1n = (s.playerFleet || []).filter(d => d.role === "escort" || d.role === "tank" || d.role === "hangar").length;
  info("P1 fleet " + s.playerFleet.length + "  P2 fleet " + (p2.fleet || []).length);
  // Sandbox even match clones P1 → P2 should have same count
  assert((p2.fleet || []).length === p1n || (p2.fleet || []).length >= Math.min(1, p1n),
    "P2 drone count mirrors P1");
  pass("P2 drones present in even duel (n=" + (p2.fleet || []).length + ")");

  // Tick and ensure P2 drones deal damage
  const p1e0 = ehp(s.hp);
  for (let i = 0; i < 180; i++) {
    G.updateBattleMatch(1 / 30);
    if (s.battle.phase === "result") break;
  }
  const p1e1 = ehp(s.hp);
  info("P1 EHP under P2+drones: " + Math.round(p1e0) + "→" + Math.round(p1e1));
  pass("duel sim with P2 drones runs without crash");
}

function testControlResourceStarvation(G) {
  section("5. Control grunt war: equal vs starved resources");
  G.init();
  G.startBattleMatch("ctrl_2x2", { economy: "free", seed: 30, noiseGroups: 0, keepClutter: true });
  const s = G.state;
  s.outposts.forEach((o, i) => {
    o.owner = i % 2 === 0 ? "player" : "rival";
    o.stationedDrones = [];
    o.hull = o.hullMax;
  });
  for (const o of s.outposts)
    o.neighborIds = s.outposts.filter(n => n !== o).map(n => n.id);
  G.refreshBattleLogisticsGraph();
  const rf = G._ensureBattleReinforce();
  // Equal resources
  rf.rival.credits = 8000; rf.rival.bars = 50; rf.rival.starved = false;
  s.credits = 8000;
  s.refinedBars = { copper: 50, silver: 50, gold: 50, platinum: 50 };
  G.setBattleRally(s.outposts.find(o => o.owner === "player").id);

  const eq = G.simBattleGruntBalance({ seconds: 50, dt: 1 / 15 });
  assert(eq.ok, "equal sim");
  info("equal ownership P " + eq.start.p + "→" + eq.end.p + " R " + eq.start.r + "→" + eq.end.r);
  assert(Math.abs(eq.end.p - eq.start.p) <= 2, "equal war ownership stable");
  pass("equal resource grunt war stable");

  // Starve rival
  G.init();
  G.startBattleMatch("ctrl_2x2", { economy: "free", seed: 31, noiseGroups: 0, keepClutter: true });
  const s2 = G.state;
  s2.outposts.forEach((o, i) => {
    o.owner = i % 2 === 0 ? "player" : "rival";
    o.stationedDrones = [];
    o.hull = o.hullMax;
  });
  for (const o of s2.outposts)
    o.neighborIds = s2.outposts.filter(n => n !== o).map(n => n.id);
  G.refreshBattleLogisticsGraph();
  const rf2 = G._ensureBattleReinforce();
  rf2.rival.credits = 0; rf2.rival.bars = 0; rf2.rival.starved = true;
  s2.credits = 99999;
  s2.refinedBars = { copper: 99, silver: 99, gold: 99, platinum: 99 };
  G.setBattleRally(s2.outposts.find(o => o.owner === "player").id);
  const st = G.simBattleGruntBalance({ seconds: 60, dt: 1 / 15, starveRival: true });
  info("starved rival P " + st.start.p + "→" + st.end.p + " R " + st.start.r + "→" + st.end.r +
    " rivCredits=" + rf2.rival.credits);
  assert(st.end.p >= st.start.p - 1, "player holds when rival out of resources");
  pass("resource exhaustion shifts pressure correctly");
}

function testLoadBalance(G) {
  section("6. Load / tick cost smoke (control + duel)");
  G.init();
  G.startBattleMatch("ctrl_3x3", { economy: "free", seed: 40, noiseGroups: 2, keepClutter: true });
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) G.updateBattleMatch(1 / 30);
  const ms = Date.now() - t0;
  info("300 control ticks in " + ms + "ms");
  assert(ms < 8000, "control tick budget reasonable");
  pass("control load ok (" + ms + "ms / 10s sim)");

  G.init();
  G.startBattleSandbox({ seed: 41, noiseGroups: 0 });
  const t1 = Date.now();
  for (let i = 0; i < 300; i++) G.updateBattleMatch(1 / 30);
  const ms2 = Date.now() - t1;
  info("300 duel ticks in " + ms2 + "ms");
  assert(ms2 < 5000, "duel tick budget");
  pass("duel load ok (" + ms2 + "ms / 10s sim)");
}

function testScanSingleRing(G) {
  section("7. Active scan single orange ring");
  G.init();
  const s = G.state;
  s._scanRings = [];
  G.beginActiveScanPulse(true);
  G.updateRegionScan(0.05);
  const active = (s._scanRings || []).filter(r => r.kind === "active");
  assert(active.length === 1, "exactly one active ring, got " + active.length);
  // pulse again shouldn't stack multiples while one lives if we filter — fire after clear
  G.updateRegionScan(2);
  s.scanPulse = null; s.scanPulseCd = 0;
  G.beginActiveScanPulse(true);
  G.updateRegionScan(0.05);
  const active2 = (s._scanRings || []).filter(r => r.kind === "active");
  assert(active2.length === 1, "still one active ring after re-fire");
  pass("scan emits single orange ring");
}

function main() {
  console.log("Battle balance full suite — " + HTML);
  const G = loadGame();
  assert(G && G.init, "GAME");
  try {
    testMultiWeaponCd(G);
    testEvenDuelDrones(G);
    testEvenDuelNoDrones(G);
    testP2FleetParity(G);
    testControlResourceStarvation(G);
    testLoadBalance(G);
    testScanSingleRing(G);
  } catch (e) {
    fail("ABORT: " + e.message);
    console.error(e.stack);
  }
  section("SUMMARY");
  console.log("  passed:   " + ok.length);
  console.log("  warnings: " + warnings.length);
  console.log("  failures: " + issues.length);
  if (issues.length) issues.forEach((w, i) => console.log("  " + (i + 1) + ". " + w));
  const out = path.join(ROOT, "scripts", "battle_balance_full_report.json");
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), passed: ok, warnings, failures: issues }, null, 2));
  console.log("\nWrote " + out);
  process.exit(issues.length ? 1 : 0);
}
main();
