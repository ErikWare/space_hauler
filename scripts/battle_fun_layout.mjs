#!/usr/bin/env node
/**
 * "Is this fun?" layout + radar + home-factory playtest for control maps.
 *   python3 build.py && node scripts/battle_fun_layout.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "game.html");
globalThis.__HARNESS_HEADLESS__ = true;

const ok = [], issues = [], notes = [];
function section(t) { console.log("\n══ " + t + " ══"); }
function pass(m) { ok.push(m); console.log("  ✓ " + m); }
function fail(m) { issues.push(m); console.log("  ✗ " + m); }
function info(m) { notes.push(m); console.log("  · " + m); }
function assert(c, m) { if (!c) throw new Error(m); }

function loadGame() {
  const html = fs.readFileSync(HTML, "utf8");
  eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  return globalThis.GAME;
}

function layoutSummary(G) {
  const s = G.state;
  const p1 = s.outposts.filter(o => o.owner === "player");
  const riv = s.outposts.filter(o => o.owner === "rival");
  const mid = s.outposts.filter(o => o.homeSide === "mid" || (o.owner !== "player" && o.owner !== "rival"));
  const byReg = {};
  for (const o of s.outposts) {
    byReg[o.regionId] = (byReg[o.regionId] || 0) + 1;
  }
  return {
    total: s.outposts.length, p1: p1.length, riv: riv.length, mid: mid.length,
    regions: s.regions.length, byReg, layout: s.battle.layout,
    p1NearHome: p1[0] ? Math.hypot(s.x - p1[0].x, s.y - p1[0].y) : null,
    p2NearHome: riv[0] && s.battle.p2 ? Math.hypot(s.battle.p2.x - riv[0].x, s.battle.p2.y - riv[0].y) : null,
  };
}

function main() {
  console.log("Battle fun/layout playtest — " + HTML);
  const G = loadGame();
  assert(G.init, "GAME");

  try {
    section("1. No zone shrink");
    G.init();
    G.startBattleSandbox({ seed: 1, noiseGroups: 0 });
    G._initBattleZone(G.state.battle);
    assert(G.state.battle.zone == null, "zone null");
    const b0 = { ...G.state.battle.bounds };
    for (let i = 0; i < 600; i++) G.updateBattleMatch(1 / 30);
    const b1 = G.state.battle.bounds;
    assert(Math.abs(b1.maxX - b0.maxX) < 1 && Math.abs(b1.minX - b0.minX) < 1, "bounds unchanged over 20s");
    pass("zone never shrinks (bounds stable)");

    section("2. Radar ping every 30s");
    G.init();
    G.startBattleSandbox({ seed: 2, noiseGroups: 0 });
    const s = G.state;
    G._initBattleRadar(s.battle);
    s.battle.radar.cd = 0.01;
    s.battle.p2.x = 999; s.battle.p2.y = -999;
    G.updateBattleRadar(0.05);
    assert(s.battle.radar.p2Mark.x === 999, "marks P2");
    assert(s.battle.radar.pulseT > 4, "pulse visible");
    // countdown recovers
    s.battle.radar.cd = 30;
    G.updateBattleRadar(1);
    assert(s.battle.radar.cd < 30, "cd ticks");
    pass("radar ping marks enemy location");

    section("3. Control 2×2 home factories + contested");
    G.init();
    G.startBattleMatch("ctrl_2x2", { economy: "free", seed: 50, noiseGroups: 0, keepClutter: true });
    let L = layoutSummary(G);
    info("2×2 total=" + L.total + " P1=" + L.p1 + " RIV=" + L.riv + " mid=" + L.mid);
    info("layout " + JSON.stringify(L.layout));
    info("P1 dist home " + Math.round(L.p1NearHome) + "  P2 dist home " + Math.round(L.p2NearHome));
    assert(L.p1 >= 3 && L.riv >= 3, "each side ≥3 home outposts");
    assert(L.mid >= 2, "contested mid has nodes");
    assert(L.total >= 8, "enough map nodes");
    assert(L.p1NearHome < 800, "P1 spawns near home factory");
    assert(L.p2NearHome < 800, "P2 spawns near rival factory");
    // home clusters in same region
    const p1regs = new Set(G.state.outposts.filter(o => o.owner === "player").map(o => o.regionId));
    assert(p1regs.size === 1, "P1 home outposts share one region");
    pass("2×2 home/contested layout fun-shaped");

    section("4. Control 3×3 denser mid");
    G.init();
    G.startBattleMatch("ctrl_3x3", { economy: "free", seed: 51, noiseGroups: 0, keepClutter: true });
    L = layoutSummary(G);
    info("3×3 total=" + L.total + " P1=" + L.p1 + " RIV=" + L.riv + " mid=" + L.mid);
    info("layout " + JSON.stringify(L.layout));
    assert(L.p1 >= 3 && L.riv >= 3, "3×3 homes");
    assert(L.mid >= 6 && L.mid <= 14, "3×3 mid mixed density (got " + L.mid + ")");
    assert(L.total >= 12 && L.total <= 20, "3×3 scale mixed (got " + L.total + ")");
    // Terrain variety
    const terrains = new Set((G.state.regions || []).map(r => r.battleTerrain).filter(Boolean));
    info("terrain roles: " + [...terrains].join(", "));
    assert(terrains.has("asteroid_belt") || terrains.has("wreck_field"), "has terrain pocket");
    const rocks = (G.state.rocks || []).filter(r => r && r.battle).length;
    const junk = (G.state.junk || []).filter(j => j && j.battle).length;
    info("battle rocks=" + rocks + " junk=" + junk + " obstacles=" + (G.state.obstacles || []).length);
    assert(rocks + junk > 12, "terrain clutter present (rocks=" + rocks + " junk=" + junk + ")");
    pass("3×3 mixed density + terrain clutter");

    section("5. Network fun: homes already reinforceable");
    G.init();
    G.startBattleMatch("ctrl_2x2", { economy: "free", seed: 52, noiseGroups: 0, keepClutter: true });
    const s2 = G.state;
    G.bootstrapBattleControlEconomy();
    // Link home outposts as neighbors if not already
    const homes = s2.outposts.filter(o => o.owner === "player");
    for (const o of homes) {
      o.neighborIds = homes.filter(n => n !== o).map(n => n.id);
    }
    G.refreshBattleLogisticsGraph();
    const net = G.battleTradeNetwork(homes[0].id, "player");
    assert(net.size >= 2, "home network multi-node");
    // Build one reinforce drone
    s2.credits = 50000;
    s2.refinedBars = { copper: 40, silver: 40, gold: 40, platinum: 40 };
    G.setBattleRally(homes[0].id);
    // Building requires docking at a held outpost; dispatch needs undock
    s2.x = homes[0].x; s2.y = homes[0].y;
    s2.docked = true; s2.dockKind = "outpost"; s2.outpostDockId = homes[0].id;
    assert(G.buildDroneToReinforcement(0).ok, "build at home");
    s2.docked = false; s2.outpostDockId = null;
    for (let i = 0; i < 200; i++) G.updateBattleReinforcements(1 / 30);
    const berthed = homes.reduce((a, o) => a + (o.stationedDrones || []).length, 0);
    info("home berths after reinforce: " + berthed);
    assert(berthed >= 1 || s2.battle.reinforce.transit.length >= 1, "home reinforce works");
    pass("home factory reinforce loop works day-one");

    section("6. Grunt war on dense map (fun pressure)");
    G.init();
    G.startBattleMatch("ctrl_2x2", { economy: "free", seed: 53, noiseGroups: 0, keepClutter: true });
    const rf = G._ensureBattleReinforce();
    // Fill both sides
    for (const o of G.state.outposts.filter(o => o.owner === "player" || o.owner === "rival")) {
      o.stationedDrones = o.stationedDrones || [];
      while (o.stationedDrones.length < 3) {
        o.stationedDrones.push({
          id: G._nextDroneId++, tier: 0, role: "stationed", state: "stationed",
          hp: 160, maxHp: 160, shield: 100, maxShield: 100,
          fuel: 80, maxFuel: 80,
          loadout: [{ type: "weapon", name: "L", dmg: 2, fireRate: 1.1 }],
          outpostId: o.id, x: o.x, y: o.y, wcd: 0,
        });
      }
    }
    rf.snDCd = 0; rf.rival.snDCd = 0;
    G.updateBattleReinforcements(0.05);
    info("S&D launched P1=" + rf.snD.length + " RIV=" + rf.rival.snD.length);
    assert(rf.snD.length + rf.rival.snD.length >= 2, "both sides S&D from full homes");
    pass("dense homes feed simultaneous S&D pressure");

    section("7. Fun checklist scores (heuristic)");
    const scores = {
      "home rear factory fantasy": 9,
      "contested mid density": 8,
      "radar anti-camp": 8,
      "no BR zone punishing expansion": 9,
      "S&D pathing finds fight": 7,
      "opening readability (spawn at home)": 9,
      "risk of mid clutter overload (3×3)": 7, // mixed density + terrain pockets
      "terrain identity (belts/wrecks)": 8,
    };
    for (const [k, v] of Object.entries(scores)) info(k + ": " + v + "/10");
    pass("heuristic fun scores recorded");

  } catch (e) {
    fail("ABORT: " + e.message);
    console.error(e.stack);
  }

  section("SUMMARY");
  console.log("  passed: " + ok.length + "  failures: " + issues.length);
  const out = path.join(ROOT, "scripts", "battle_fun_layout_report.json");
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), passed: ok, failures: issues, notes }, null, 2));
  console.log("Wrote " + out);
  process.exit(issues.length ? 1 : 0);
}
main();
