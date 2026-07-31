#!/usr/bin/env node
/**
 * Live functional playfeel sim — full updateBattleMatch ticks, both modes.
 * Reports how control / deathmatch actually play under AI.
 *
 *   python3 build.py && node scripts/battle_live_playfeel.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "game.html");
globalThis.__HARNESS_HEADLESS__ = true;

function loadGame() {
  const html = fs.readFileSync(HTML, "utf8");
  eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  return globalThis.GAME;
}

function ehp(hp) {
  if (!hp) return 0;
  return (hp.shield || 0) + (hp.armor || 0) + (hp.hull || 0);
}

function own(s) {
  let p = 0, r = 0, n = 0;
  for (const o of s.outposts || []) {
    if (o.owner === "player") p++;
    else if (o.owner === "rival") r++;
    else n++;
  }
  return { p, r, n };
}

function berths(s, owner) {
  let n = 0, full = 0;
  for (const o of s.outposts || []) {
    if (o.owner !== owner) continue;
    const b = (o.stationedDrones || []).length;
    n += b;
    if (b >= 3) full++;
  }
  return { drones: n, fullOutposts: full };
}

function tickMatch(G, sec, dt = 1 / 20) {
  const steps = Math.ceil(sec / dt);
  const samples = [];
  const s = G.state;
  let lastRadar = 0, radarPings = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    // Keep human undocked so combat/radar path runs
    s.docked = false;
    // AI P1 for pure sim
    if (s.battle) s.battle.aiPilotP1 = true;
    G.updateBattleMatch(dt);
    if (typeof G.updateFleet === "function") G.updateFleet(dt);
    if (typeof G.updateOutposts === "function") G.updateOutposts(dt);

    const b = s.battle;
    if (b && b.radar && b.radar.pulseT > 5.5 && t - lastRadar > 5) {
      radarPings++;
      lastRadar = t;
    }
    if (i % Math.ceil(15 / dt) === 0 || b.phase === "result") {
      samples.push({
        t: Math.round(t),
        phase: b.phase,
        own: own(s),
        p1ehp: Math.round(ehp(s.hp)),
        p2ehp: Math.round(ehp(b.p2 && b.p2.hp)),
        rfQ: b.reinforce ? b.reinforce.queue.length : 0,
        rfT: b.reinforce ? b.reinforce.transit.length : 0,
        snD: b.reinforce ? b.reinforce.snD.length : 0,
        rSnD: b.reinforce && b.reinforce.rival ? b.reinforce.rival.snD.length : 0,
        pBerth: berths(s, "player"),
        rBerth: berths(s, "rival"),
        radarCd: b.radar ? Math.round(b.radar.cd) : null,
        dist: b.p2 ? Math.round(Math.hypot(s.x - b.p2.x, s.y - b.p2.y)) : null,
      });
    }
    if (b.phase === "result") break;
  }
  return { samples, radarPings, result: s.battle.result, duration: samples.length ? samples[samples.length - 1].t : 0 };
}

function fillHomes(G, owner, n = 3) {
  for (const o of G.state.outposts || []) {
    if (o.owner !== owner) continue;
    o.stationedDrones = o.stationedDrones || [];
    while (o.stationedDrones.length < n) {
      o.stationedDrones.push({
        id: G._nextDroneId++, tier: 0, role: "stationed", state: "stationed",
        hp: 160, maxHp: 160, shield: 100, maxShield: 100, fuel: 100, maxFuel: 100,
        loadout: [{ type: "weapon", name: "L", dmg: 3, fireRate: 1.1 }],
        outpostId: o.id, x: o.x, y: o.y, wcd: 0,
      });
    }
  }
}

function maintainPlayerFactory(G) {
  // Sim "human keeps reinforce hangar fed" every few seconds
  const s = G.state;
  if (!G.isBattleControl || !G.isBattleControl()) return;
  s.credits = Math.max(s.credits, 5000);
  s.refinedBars = s.refinedBars || {};
  for (const t of ["copper", "silver", "gold", "platinum"])
    s.refinedBars[t] = Math.max(s.refinedBars[t] || 0, 8);
  const rf = G._ensureBattleRefineReinforce
    ? G._ensureBattleRefineReinforce()
    : G._ensureBattleReinforce();
  if (!rf) return;
  const gaps = typeof G.fortificationGaps === "function" ? G.fortificationGaps() : [];
  const need = gaps.reduce((a, g) => a + g.open, 0);
  if (need > 0 && rf.queue.length < need) {
    G.buildDroneToReinforcement && G.buildDroneToReinforcement(0);
  }
}

function runControlScenario(G, label, opts) {
  G.init();
  G.startBattleMatch(opts.kind || "ctrl_2x2", {
    economy: "free", seed: opts.seed || 100,
    noiseGroups: opts.noise || 0, keepClutter: true,
    aiDifficulty: opts.diff || "normal",
  });
  const s = G.state;
  s.battle.aiPilotP1 = true;
  s.credits = 20000;
  s.refinedBars = { copper: 40, silver: 40, gold: 40, platinum: 40 };
  if (opts.fillHomes) {
    fillHomes(G, "player", 3);
    fillHomes(G, "rival", 3);
  }
  if (opts.starveRival && s.battle.reinforce && s.battle.reinforce.rival) {
    s.battle.reinforce.rival.starved = true;
    s.battle.reinforce.rival.credits = 0;
    s.battle.reinforce.rival.bars = 0;
  }
  // Force early S&D
  if (s.battle.reinforce) {
    s.battle.reinforce.snDCd = 2;
    if (s.battle.reinforce.rival) s.battle.reinforce.rival.snDCd = 2;
  }
  // Periodic factory maintain
  const sec = opts.sec || 120;
  const dt = 1 / 20;
  const steps = Math.ceil(sec / dt);
  let radarPings = 0, lastR = -99;
  const timeline = [];
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    s.docked = false;
    if (i % Math.ceil(3 / dt) === 0 && opts.maintain) maintainPlayerFactory(G);
    G.updateBattleMatch(dt);
    if (G.updateFleet) G.updateFleet(dt);
    if (G.updateOutposts) G.updateOutposts(dt);
    if (s.battle.radar && s.battle.radar.pulseT > 5.5 && t - lastR > 10) {
      radarPings++; lastR = t;
    }
    if (i % Math.ceil(20 / dt) === 0 || s.battle.phase === "result") {
      timeline.push({
        t: Math.round(t),
        own: own(s),
        p1: Math.round(ehp(s.hp)),
        p2: Math.round(ehp(s.battle.p2 && s.battle.p2.hp)),
        snD: s.battle.reinforce ? s.battle.reinforce.snD.length : 0,
        rSnD: s.battle.reinforce && s.battle.reinforce.rival ? s.battle.reinforce.rival.snD.length : 0,
        dist: s.battle.p2 ? Math.round(Math.hypot(s.x - s.battle.p2.x, s.y - s.battle.p2.y)) : null,
        phase: s.battle.phase,
      });
    }
    if (s.battle.phase === "result") break;
  }
  return {
    label,
    kind: opts.kind || "ctrl_2x2",
    duration: timeline.length ? timeline[timeline.length - 1].t : 0,
    result: s.battle.result,
    radarPings,
    startOwn: timeline[0] && timeline[0].own,
    endOwn: timeline[timeline.length - 1] && timeline[timeline.length - 1].own,
    timeline,
    layout: s.battle.layout,
    outposts: s.outposts.length,
  };
}

function runDuelScenario(G, label, opts) {
  G.init();
  G.startBattleSandbox({
    seed: opts.seed || 200,
    noiseGroups: 0,
    aiDifficulty: opts.diff || "normal",
    aiPilotP1: true,
    noDrones: !!opts.noDrones,
  });
  const s = G.state;
  s.battle.aiPilotP1 = true;
  const dt = 1 / 20;
  const sec = opts.sec || 90;
  const steps = Math.ceil(sec / dt);
  let radarPings = 0, lastR = -99;
  const timeline = [];
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    s.docked = false;
    G.updateBattleMatch(dt);
    if (G.updateFleet) G.updateFleet(dt);
    if (s.battle.radar && s.battle.radar.pulseT > 5.5 && t - lastR > 10) {
      radarPings++; lastR = t;
    }
    if (i % Math.ceil(10 / dt) === 0 || s.battle.phase === "result") {
      timeline.push({
        t: Math.round(t),
        p1: Math.round(ehp(s.hp)),
        p2: Math.round(ehp(s.battle.p2 && s.battle.p2.hp)),
        dist: s.battle.p2 ? Math.round(Math.hypot(s.x - s.battle.p2.x, s.y - s.battle.p2.y)) : null,
        p2fleet: s.battle.p2 && s.battle.p2.fleet ? s.battle.p2.fleet.filter(d => d.hp > 0).length : 0,
        p1fleet: (s.playerFleet || []).filter(d => (d.role === "escort" || d.role === "tank") && d.hp > 0).length,
        phase: s.battle.phase,
      });
    }
    if (s.battle.phase === "result") break;
  }
  return {
    label,
    duration: timeline.length ? timeline[timeline.length - 1].t : 0,
    result: s.battle.result,
    radarPings,
    timeline,
    winner: s.battle.result && s.battle.result.winner,
  };
}

function main() {
  console.log("Live playfeel functional balance — " + HTML);
  const G = loadGame();
  const report = { at: new Date().toISOString(), control: [], duel: [], read: [] };

  // ── CONTROL ─────────────────────────────────────────────
  console.log("\n══ CONTROL 2×2 — passive (no maintain, homes full) ══");
  let r = runControlScenario(G, "2x2 full homes passive AI", {
    kind: "ctrl_2x2", seed: 11, sec: 150, fillHomes: true, maintain: false, diff: "normal",
  });
  report.control.push(r);
  console.log("  duration", r.duration, "result", r.result && r.result.reason, r.result && r.result.winner);
  console.log("  ownership", JSON.stringify(r.startOwn), "→", JSON.stringify(r.endOwn));
  console.log("  radar pings", r.radarPings, "outposts", r.outposts);
  console.log("  timeline every ~20s:");
  for (const row of r.timeline) {
    console.log("   t=" + row.t + "s own=" + row.own.p + "/" + row.own.r + "/" + row.own.n +
      " EHP " + row.p1 + "/" + row.p2 + " S&D " + row.snD + "/" + row.rSnD +
      " dist=" + row.dist + " " + row.phase);
  }

  console.log("\n══ CONTROL 2×2 — human maintains factory ══");
  r = runControlScenario(G, "2x2 maintain factory", {
    kind: "ctrl_2x2", seed: 12, sec: 150, fillHomes: true, maintain: true, diff: "normal",
  });
  report.control.push(r);
  console.log("  duration", r.duration, "result", r.result && r.result.reason, r.result && r.result.winner);
  console.log("  ownership", JSON.stringify(r.startOwn), "→", JSON.stringify(r.endOwn));
  console.log("  radar pings", r.radarPings);

  console.log("\n══ CONTROL 2×2 — rival starved ══");
  r = runControlScenario(G, "2x2 starve rival", {
    kind: "ctrl_2x2", seed: 13, sec: 150, fillHomes: true, maintain: true, starveRival: true, diff: "normal",
  });
  report.control.push(r);
  console.log("  duration", r.duration, "result", r.result && r.result.reason, r.result && r.result.winner);
  console.log("  ownership", JSON.stringify(r.startOwn), "→", JSON.stringify(r.endOwn));

  console.log("\n══ CONTROL 3×3 — full homes 180s ══");
  r = runControlScenario(G, "3x3 full homes", {
    kind: "ctrl_3x3", seed: 14, sec: 180, fillHomes: true, maintain: true, diff: "normal",
  });
  report.control.push(r);
  console.log("  duration", r.duration, "result", r.result && r.result.reason, r.result && r.result.winner);
  console.log("  ownership", JSON.stringify(r.startOwn), "→", JSON.stringify(r.endOwn));
  console.log("  layout", JSON.stringify(r.layout));
  console.log("  radar pings", r.radarPings);
  for (const row of r.timeline.filter((_, i) => i % 2 === 0)) {
    console.log("   t=" + row.t + "s own=" + row.own.p + "/" + row.own.r + "/" + row.own.n +
      " EHP " + row.p1 + "/" + row.p2 + " dist=" + row.dist);
  }

  // ── DUEL ────────────────────────────────────────────────
  console.log("\n══ DEATHMATCH 1×1 — with drones ×8 ══");
  const duelW = { P1: 0, P2: 0, none: 0 };
  const duelDur = [];
  for (let i = 0; i < 8; i++) {
    const d = runDuelScenario(G, "dm" + i, { seed: 300 + i, sec: 100, noDrones: false, diff: "normal" });
    report.duel.push(d);
    const w = d.winner || "none";
    duelW[w] = (duelW[w] || 0) + 1;
    duelDur.push(d.duration);
    console.log("  bout " + i + ": " + w + " in " + d.duration + "s radar=" + d.radarPings +
      " final EHP timeline last=" + JSON.stringify(d.timeline[d.timeline.length - 1]));
  }
  console.log("  aggregate wins", duelW, "avg duration", Math.round(duelDur.reduce((a, b) => a + b, 0) / duelDur.length) + "s");

  console.log("\n══ DEATHMATCH 1×1 — no drones ×6 ══");
  const duelW2 = { P1: 0, P2: 0, none: 0 };
  for (let i = 0; i < 6; i++) {
    const d = runDuelScenario(G, "dmnd" + i, { seed: 400 + i, sec: 100, noDrones: true, diff: "normal" });
    report.duel.push(d);
    duelW2[d.winner || "none"] = (duelW2[d.winner || "none"] || 0) + 1;
    console.log("  bout " + i + ": " + (d.winner || "draw") + " in " + d.duration + "s");
  }
  console.log("  aggregate wins", duelW2);

  // ── READ ────────────────────────────────────────────────
  console.log("\n══ PLAYFEEL READ ══");
  const reads = [];
  const push = (s) => { reads.push(s); console.log("  • " + s); };

  // Control ownership drift
  for (const c of report.control) {
    if (!c.startOwn || !c.endOwn) continue;
    const dp = c.endOwn.p - c.startOwn.p;
    const dr = c.endOwn.r - c.startOwn.r;
    push(c.label + ": ownership ΔP=" + dp + " ΔR=" + dr + " over " + c.duration + "s" +
      (c.result ? (" → " + c.result.winner + " (" + c.result.reason + ")") : " (still fighting)"));
  }
  push("Radar: control matches saw " +
    report.control.map(c => c.radarPings).join("/") + " pings (expect ~1 per 30s of fight)");
  push("Duel with drones: " + JSON.stringify(duelW) + " over 8 bouts");
  push("Duel pilot-only: " + JSON.stringify(duelW2) + " over 6 bouts");

  // Verdict heuristics
  const controlKillRate = report.control.filter(c => c.result && (c.result.reason === "p2_down" || c.result.reason === "death")).length;
  push("Control ended by pilot kill in " + controlKillRate + "/" + report.control.length + " scenarios (kill still dominates long games)");

  report.read = reads;
  const out = path.join(ROOT, "scripts", "battle_live_playfeel_report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log("\nWrote " + out);
}

main();
