#!/usr/bin/env node
/**
 * Even-match P1 vs P2 balance suite — all hulls + AI difficulty ladder.
 *
 *   node scripts/battle_duel_balance.mjs
 *   node scripts/battle_duel_balance.mjs --bouts 20 --hull all
 *   node scripts/battle_duel_balance.mjs --hull atlas --diff-ladder
 *   node scripts/battle_duel_balance.mjs --hulls vulture,atlas,aegis
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
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no script — run build.py");
  (0, eval)(m[1]);
  // game attaches CONFIG / GAME on globalThis (not ESM exports)
  if (!globalThis.CONFIG && globalThis.GAME_CONFIG) globalThis.CONFIG = globalThis.GAME_CONFIG;
  return globalThis.GAME;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    bouts: 24,
    hull: "all",
    hulls: null,
    maxSec: 90,
    noDrones: false,
    diffLadder: false,
    aDiff: "normal",
    bDiff: "normal",
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--bouts") o.bouts = +a[++i];
    else if (a[i] === "--hull") o.hull = a[++i];
    else if (a[i] === "--hulls") o.hulls = a[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a[i] === "--maxSec") o.maxSec = +a[++i];
    else if (a[i] === "--noDrones") o.noDrones = true;
    else if (a[i] === "--diff-ladder") o.diffLadder = true;
    else if (a[i] === "--aDiff") o.aDiff = a[++i];
    else if (a[i] === "--bDiff") o.bDiff = a[++i];
  }
  return o;
}

function suiteHulls(G, opts) {
  if (opts.hulls) return opts.hulls;
  if (opts.hull && opts.hull !== "all") return [opts.hull];
  return G.battleHullKeys ? G.battleHullKeys() : ["vulture", "atlas", "aegis"];
}

function runHull(G, hullKey, opts) {
  const results = [];
  let p1 = 0, p2 = 0, draws = 0;
  for (let i = 0; i < opts.bouts; i++) {
    G.init();
    const r = G.simEvenDuel({
      seed: 70000 + i * 9973 + hullKey.length * 100,
      hullKey,
      noDrones: opts.noDrones,
      maxSec: opts.maxSec,
      spawnAngle: i * 0.37,
      aDifficulty: opts.aDiff,
      bDifficulty: opts.bDiff,
    });
    results.push(r);
    if (r.winner === "A") p1++;
    else if (r.winner === "B") p2++;
    else draws++;
  }
  const decided = p1 + p2;
  const p1Rate = decided ? p1 / decided : 0.5;
  const balanced = decided >= opts.bouts * 0.4 && p1Rate >= 0.35 && p1Rate <= 0.65;
  const ehp0 = results[0] ? results[0].a0 : 0;
  const wpn = results[0] ? results[0].weaponDmg : 0;
  return {
    hullKey, p1, p2, draws, p1Rate, p2Rate: decided ? p2 / decided : 0.5,
    balanced, ehp0, wpn, decided, bouts: opts.bouts,
    aDiff: opts.aDiff, bDiff: opts.bDiff,
  };
}

function runDiffLadder(G, hullKey, opts) {
  const tiers = G.battleAiKeys ? G.battleAiKeys() : ["easy", "normal", "hard", "boss"];
  const rows = [];
  // Human-like side A always normal; B climbs the ladder
  for (const bDiff of tiers) {
    const r = runHull(G, hullKey, { ...opts, aDiff: "normal", bDiff, bouts: Math.max(12, opts.bouts | 0) });
    rows.push(r);
  }
  return rows;
}

function main() {
  const opts = parseArgs();
  console.log("=== Multi-hull / AI difficulty balance ===");
  console.log(opts);
  const G = loadGame();
  G.wireUI(null, null);
  G.init();

  const hulls = suiteHulls(G, opts);
  const report = { opts, hulls: {}, ladder: {}, at: new Date().toISOString() };

  if (opts.diffLadder) {
    const hull = hulls[0] || "atlas";
    console.log("\n── AI difficulty ladder (A=normal vs B=tier) · " + hull + " ──");
    const rows = runDiffLadder(G, hull, opts);
    report.ladder[hull] = rows;
    for (const r of rows) {
      console.log(
        `  B=${String(r.bDiff).padEnd(7)}  A wins ${(r.p1Rate * 100).toFixed(0).padStart(3)}%` +
        `  B wins ${(r.p2Rate * 100).toFixed(0).padStart(3)}%  (n=${r.bouts})  EHP0=${r.ehp0}`
      );
    }
  } else {
    console.log("\n── Even match per hull (A=B=" + opts.aDiff + ") ──");
    console.log(
      "  " +
      "hull".padEnd(18) +
      "EHP".padStart(6) +
      "wpn".padStart(8) +
      "A%".padStart(7) +
      "B%".padStart(7) +
      "  verdict"
    );
    for (const hull of hulls) {
      const C = globalThis.CONFIG || globalThis.GAME_CONFIG;
      if (!C || !C.hulls || !C.hulls[hull]) {
        console.log("  skip unknown hull " + hull);
        continue;
      }
      const r = runHull(G, hull, opts);
      report.hulls[hull] = r;
      const ver = r.balanced ? "OK" : "SKEW";
      console.log(
        "  " +
        hull.padEnd(18) +
        String(r.ehp0).padStart(6) +
        (r.wpn != null ? r.wpn.toFixed(1) : "?").padStart(8) +
        (r.p1Rate * 100).toFixed(0).padStart(6) + "%" +
        (r.p2Rate * 100).toFixed(0).padStart(6) + "%" +
        "  " + ver
      );
    }
  }

  const out = path.join(ROOT, "scripts", "battle_duel_balance_report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log("\nWrote " + out);

  // Exit non-zero if any even-match hull is badly skewed
  if (!opts.diffLadder) {
    const bad = Object.values(report.hulls).filter(r => !r.balanced);
    if (bad.length) {
      console.log("\nSkewed hulls: " + bad.map(r => r.hullKey).join(", "));
      process.exit(2);
    }
  }
  process.exit(0);
}

main();
