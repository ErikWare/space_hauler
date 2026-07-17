/* forge/modules/world.js — Forge world generation + warp-gate network.
 *
 * Global: ForgeWorld  (plain IIFE — paste directly into an inline <script> block).
 * Companion build request: world/station systems layered on SYSTEMS_SPEC.md.
 * Canvas 2D only for the warp UI; all world/state math runs headless (no DOM).
 *
 * A ~12,000×12,000 unit field holding 8 stations, 6 nebula clouds and a
 * purchasable warp-gate network. Station 0 is the central home base (discovered +
 * warp-active); stations 1–7 are seeded at 2,500–6,000 units from centre, no two
 * within 1,500 units, and start hidden until the ship comes within 800 units.
 *
 * Key exports:
 *   initWorld(seed, opts?)          → generate the field; opts {player,onToast,canvas,ctx}
 *   getStations() / getNebulas()    → live arrays of station / nebula objects
 *   updateDiscovery(shipPos)        → per-frame tick: reveals stations + nebula
 *                                     enter/exit; returns an events[] and fires toasts
 *   isInNebula(shipPos)             → bool
 *   getNebulaModifiers(shipPos)     → { inNebula, tierBoost, scanRangeMult,
 *                                       dragTowing, dragFree, color }
 *   getWarpGateCost(owned)          → 1000·2^owned (1000,2000,4000,…)
 *   buyWarpGate(credits)            → { cost, success, newCredits }
 *   activateWarpGate(stationId)     → { success, station } — spends a bought gate
 *   openWarpUI(cb) / closeWarpUI()  → full-screen jump overlay; cb(station) on jump
 *   jumpTo(stationId, onArrival)    → warp: −50 fuel, teleport, 1.5s tunnel anim
 *   getWarpState()                  → { owned, used, pending, nextCost }
 *   drawWarpUI(ctx, canvas)         → render the overlay / warp tunnel
 *   handleWarpClick(x,y)            → route a tap inside the warp UI
 *   tickWarp(dt), isWarping(), setPlayer(p), setToastFn(fn),
 *   getState(), selfTest()
 */
;(function (root) {
  "use strict";

  /* Canonical palette subset (SYSTEMS_SPEC.md) for the warp overlay + nebulas. */
  var COL = {
    bg: "#0d1017", bgPanel: "rgba(13,16,23,0.92)", dimWash: "rgba(5,7,13,0.9)",
    ink: "#e8edf4", dim: "#9aa7b8", faint: "#3a4658",
    line: "#333f50", slot: "#1c2430",
    good: "#7bd88f", gold: "#ffd24a", warn: "#ff6b6b", charge0: "#4a7bff", charge2: "#ffffff"
  };

  /* Nebula tint colors (name → rgba builder). */
  var NEBULA_HEX = { cyan: "74,210,255", purple: "150,90,255", orange: "255,150,60" };

  /* ── config constants ─────────────────────────────────────────────────────── */
  var FIELD = 12000, HALF = FIELD / 2;          // 12,000-unit square field (±6000)
  var STATION_COUNT = 8;
  var DISCOVER_RADIUS = 800;                     // reveal within this range
  var MIN_STATION_GAP = 1500;                    // stations no closer than this
  var STATION_MIN_R = 2500, STATION_MAX_R = 6000;// outer stations' orbit band
  var NEBULA_COUNT = 6;
  var NEBULA_MIN_R = 400, NEBULA_MAX_R = 800;
  var NEBULA_STATION_CLEAR = 1000;               // nebula edge ≥ this from any station
  var NEBULA_COLORS = ["cyan", "purple", "orange"];
  var WARP_FUEL_COST = 50;
  var WARP_GATE_BASE = 1000;                     // cost doubles per gate owned
  var WARP_DUR = 1.5;                            // tunnel animation seconds

  /* Procedural station naming. Index 0 forces "Homeport" so the home base reads. */
  var STATION_PREFIX = ["Outpost", "Depot", "Station", "Haven", "Port", "Waypoint",
    "Terminal", "Relay", "Bastion", "Foundry", "Anchorage", "Beacon"];
  var STATION_PROPER = ["Kira", "Vance", "Orion", "Talon", "Cygnus", "Reyes", "Mara",
    "Kess", "Vega", "Nero", "Sable", "Corvus", "Draco", "Lyra", "Rhea", "Zeta",
    "Halcyon", "Quill", "Bishop", "Cole", "Ardent", "Sila", "Pike", "Onyx"];

  /* ── module state ─────────────────────────────────────────────────────────── */
  var state = {
    seed: 0,
    stations: [],
    nebulas: [],
    warp: { owned: 0, used: 0 },
    player: null,                 // { x, y, fuel } the game mutates/reads
    onToast: null,                // fn(text) — game toast sink
    lastNebulaId: null,           // for enter/exit transition toasts
    warpUI: { open: false, cb: null },
    warpAnim: null                // { active, t, dur, destId, onArrival }
  };

  var boundCanvas = null, boundCtx = null;

  /* ── helpers ──────────────────────────────────────────────────────────────── */
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Deterministic RNG (mulberry32) — matches item_system for cross-module parity. */
  function seedRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function emitToast(text) { if (state.onToast) state.onToast(text); }
  function stationById(id) {
    for (var i = 0; i < state.stations.length; i++) if (state.stations[i].id === id) return state.stations[i];
    return null;
  }

  /* ── generation ───────────────────────────────────────────────────────────── */

  function nameStations(rng) {
    var props = STATION_PROPER.slice(), names = [];
    for (var i = 0; i < STATION_COUNT; i++) {
      var prefix = i === 0 ? "Homeport" : STATION_PREFIX[Math.floor(rng() * STATION_PREFIX.length)];
      var pi = Math.floor(rng() * props.length);
      var proper = props.splice(pi, 1)[0] || ("Site-" + i);   // proper names never repeat
      names.push(prefix + " " + proper);
    }
    return names;
  }

  function genStations(rng) {
    var names = nameStations(rng);
    var sts = [{ id: 0, name: names[0], pos: { x: 0, y: 0 }, discovered: true, warpActive: true, reputation: 0, stock: [], npcMiners: [] }];
    for (var id = 1; id < STATION_COUNT; id++) {
      var placed = null;
      for (var tries = 0; tries < 800 && !placed; tries++) {
        var ang = rng() * Math.PI * 2;
        var d = STATION_MIN_R + rng() * (STATION_MAX_R - STATION_MIN_R);
        var p = { x: Math.cos(ang) * d, y: Math.sin(ang) * d };
        var ok = true;
        for (var j = 0; j < sts.length; j++) { if (dist(p, sts[j].pos) < MIN_STATION_GAP) { ok = false; break; } }
        if (ok) placed = p;
      }
      if (!placed) {                              // fallback: evenly spaced 4000-unit ring
        var a = (id / (STATION_COUNT - 1)) * Math.PI * 2;
        placed = { x: Math.cos(a) * 4000, y: Math.sin(a) * 4000 };
      }
      sts.push({ id: id, name: names[id], pos: placed, discovered: false, warpActive: false, reputation: 0, stock: [], npcMiners: [] });
    }
    return sts;
  }

  function genNebulas(rng, stations) {
    var nebs = [];
    // Two passes: first honors nebula-to-nebula spacing, a relaxed pass fills any
    // shortfall so the field always ends up with NEBULA_COUNT clouds.
    var passes = [{ nebGap: 300, guard: 3000 }, { nebGap: 0, guard: 3000 }];
    for (var pass = 0; pass < passes.length && nebs.length < NEBULA_COUNT; pass++) {
      var cfg = passes[pass], guard = 0;
      while (nebs.length < NEBULA_COUNT && guard < cfg.guard) {
        guard++;
        var r = NEBULA_MIN_R + rng() * (NEBULA_MAX_R - NEBULA_MIN_R);
        var lim = HALF - r - 200;
        var p = { x: (rng() * 2 - 1) * lim, y: (rng() * 2 - 1) * lim };
        var ok = true, s;
        for (s = 0; s < stations.length && ok; s++) if (dist(p, stations[s].pos) < r + NEBULA_STATION_CLEAR) ok = false;
        for (s = 0; s < nebs.length && ok; s++) if (dist(p, nebs[s].pos) < r + nebs[s].radius + cfg.nebGap) ok = false;
        if (ok) nebs.push({ id: nebs.length, pos: p, radius: r, color: NEBULA_COLORS[Math.floor(rng() * NEBULA_COLORS.length)] });
      }
    }
    return nebs;
  }

  function initWorld(seed, opts) {
    opts = opts || {};
    state.seed = (seed == null ? 1 : seed) >>> 0;
    var rng = seedRng(state.seed);
    state.stations = genStations(rng);
    state.nebulas = genNebulas(rng, state.stations);
    state.warp = { owned: 0, used: 0 };
    state.lastNebulaId = null;
    state.warpUI = { open: false, cb: null };
    state.warpAnim = null;
    if (opts.player !== undefined) state.player = opts.player;
    if (opts.onToast !== undefined) state.onToast = opts.onToast;
    if (opts.canvas) boundCanvas = opts.canvas;
    if (opts.ctx) boundCtx = opts.ctx;
    return getState();
  }

  function getStations() { return state.stations; }
  function getNebulas() { return state.nebulas; }
  function setPlayer(p) { state.player = p; }
  function setToastFn(fn) { state.onToast = fn; }
  function setContext(canvas, ctx) { boundCanvas = canvas || boundCanvas; boundCtx = ctx || boundCtx; }

  /* ── discovery + nebula transitions (per-frame world tick) ────────────────── */

  function nebulaAt(shipPos) {
    if (!shipPos) return null;
    for (var i = 0; i < state.nebulas.length; i++) {
      if (dist(shipPos, state.nebulas[i].pos) <= state.nebulas[i].radius) return state.nebulas[i];
    }
    return null;
  }

  function isInNebula(shipPos) { return !!nebulaAt(shipPos); }

  function getNebulaModifiers(shipPos) {
    var neb = nebulaAt(shipPos);
    if (!neb) return { inNebula: false, tierBoost: 0, scanRangeMult: 1, dragTowing: 0.985, dragFree: 0.994, color: null };
    // Inside a cloud: +1 drop tier, −30% scan range, slightly higher engine drag.
    return { inNebula: true, tierBoost: 1, scanRangeMult: 0.7, dragTowing: 0.990, dragFree: 0.996, color: neb.color };
  }

  /* updateDiscovery(shipPos) — reveals any station within 800 units and tracks
   * nebula entry/exit. Returns an events[] and fires the toast sink for each. */
  function updateDiscovery(shipPos) {
    var events = [];
    if (!shipPos) return events;
    var i;
    for (i = 0; i < state.stations.length; i++) {
      var st = state.stations[i];
      if (!st.discovered && dist(shipPos, st.pos) <= DISCOVER_RADIUS) {
        st.discovered = true;
        st.reputation = 0;                        // discovery starts neutral
        var toast = "NEW STATION DISCOVERED: " + st.name;
        events.push({ type: "discover", station: st, toast: toast });
        emitToast(toast);
      }
    }
    var neb = nebulaAt(shipPos);
    var nowId = neb ? neb.id : null;
    if (nowId !== state.lastNebulaId) {
      if (nowId != null) { events.push({ type: "nebula_enter", nebula: neb, toast: "ENTERING NEBULA" }); emitToast("ENTERING NEBULA"); }
      else { events.push({ type: "nebula_exit", toast: "NEBULA CLEARED" }); emitToast("NEBULA CLEARED"); }
      state.lastNebulaId = nowId;
    }
    return events;
  }

  /* ── warp-gate economy ────────────────────────────────────────────────────── */

  function getWarpGateCost(owned) { return WARP_GATE_BASE * Math.pow(2, owned || 0); }
  function pendingGates() { return state.warp.owned - state.warp.used; }
  function getWarpState() {
    return { owned: state.warp.owned, used: state.warp.used, pending: pendingGates(), nextCost: getWarpGateCost(state.warp.owned) };
  }

  function buyWarpGate(credits) {
    var cost = getWarpGateCost(state.warp.owned);
    if (credits >= cost) { state.warp.owned += 1; return { cost: cost, success: true, newCredits: credits - cost }; }
    return { cost: cost, success: false, newCredits: credits };
  }

  function activateWarpGate(stationId) {
    var st = stationById(stationId);
    if (!st) return { success: false, reason: "no such station" };
    if (!st.discovered) return { success: false, reason: "station not discovered" };
    if (st.warpActive) return { success: false, reason: "warp gate already active" };
    if (pendingGates() <= 0) return { success: false, reason: "no warp gate available" };
    st.warpActive = true;
    state.warp.used += 1;
    emitToast("WARP GATE ONLINE: " + st.name);
    return { success: true, station: st };
  }

  /* ── jump sequence ────────────────────────────────────────────────────────── */

  function jumpTo(stationId, onArrival) {
    var st = stationById(stationId);
    if (!st) return { ok: false, reason: "no such station" };
    if (!st.discovered || !st.warpActive) return { ok: false, reason: "station not jumpable" };
    var p = state.player;
    var fuelBefore = (p && p.fuel != null) ? p.fuel : null;
    if (fuelBefore != null && fuelBefore < WARP_FUEL_COST) return { ok: false, reason: "insufficient fuel" };
    // State changes commit immediately (correctness); the tunnel is cosmetic.
    if (p) {
      if (p.fuel != null) p.fuel = fuelBefore - WARP_FUEL_COST;
      if (p.x != null) p.x = st.pos.x;
      if (p.y != null) p.y = st.pos.y;
    }
    state.warpAnim = { active: true, t: 0, dur: WARP_DUR, destId: stationId, onArrival: onArrival || null };
    state.warpUI.open = false;                    // jump replaces the picker
    return { ok: true, fuelCost: WARP_FUEL_COST, destination: st, newFuel: (p && p.fuel != null) ? p.fuel : null };
  }

  // Advance the tunnel animation; fires onArrival(station) once when it completes.
  function tickWarp(dt) {
    var a = state.warpAnim;
    if (!a || !a.active) return null;
    a.t += dt;
    if (a.t >= a.dur) {
      a.active = false;
      var st = stationById(a.destId);
      if (a.onArrival) a.onArrival(st);
      return { arrived: true, station: st };
    }
    return { arrived: false, progress: a.t / a.dur };
  }

  function isWarping() { return !!(state.warpAnim && state.warpAnim.active); }

  /* ── warp UI (full-screen jump overlay) ───────────────────────────────────── */

  function openWarpUI(cb) { state.warpUI.open = true; state.warpUI.cb = cb || null; }
  function closeWarpUI() { state.warpUI.open = false; }
  function isWarpUIOpen() { return state.warpUI.open; }

  function warpLayout(W, H, k) {
    var x = W * 0.14, w = W * 0.72;
    var top = H * 0.16;
    var rowH = Math.min(46 * k, (H * 0.62) / STATION_COUNT) - 6 * k;
    var gap = 6 * k, rows = [];
    for (var i = 0; i < STATION_COUNT; i++) rows.push({ x: x, y: top + i * (rowH + gap), w: w, h: rowH, id: i });
    var closeY = top + STATION_COUNT * (rowH + gap) + 8 * k;
    return { rows: rows, close: { x: W / 2 - 46 * k, y: closeY, w: 92 * k, h: 28 * k } };
  }

  function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  // Route a tap inside the open warp UI: jump to an active station, spend a pending
  // gate to activate a discovered-inactive one, or close. Returns the action taken.
  function handleWarpClick(x, y) {
    if (!state.warpUI.open) return { action: "none" };
    var cv = boundCanvas || { width: 390, height: 700 };
    var W = cv.width || 390, H = cv.height || 700, k = Math.min(W / 390, H / 700);
    var L = warpLayout(W, H, k);
    if (inRect(x, y, L.close)) { closeWarpUI(); return { action: "close" }; }
    for (var i = 0; i < L.rows.length; i++) {
      if (!inRect(x, y, L.rows[i])) continue;
      var st = state.stations[i];
      if (!st.discovered) return { action: "locked", station: st };
      if (st.warpActive) { return { action: "jump", station: st, result: jumpTo(st.id, state.warpUI.cb) }; }
      if (pendingGates() > 0) return { action: "activate", station: st, result: activateWarpGate(st.id) };
      return { action: "need_gate", station: st };
    }
    return { action: "none" };
  }

  function fontFor(px, bold, k) { return (bold ? "bold " : "") + Math.max(1, Math.round(px * k)) + "px monospace"; }

  function drawButton(g, r, text, k, hot) {
    g.fillStyle = COL.slot; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = hot ? COL.gold : COL.line; g.lineWidth = hot ? 2 * k : 1;
    g.strokeRect(r.x, r.y, r.w, r.h); g.lineWidth = 1;
    g.fillStyle = COL.ink; g.font = fontFor(10, true, k);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
  }

  function drawWarpRow(g, row, st, k) {
    var discovered = st.discovered, active = st.warpActive;
    var label, sub, col;
    if (!discovered) { label = "???"; sub = ""; col = COL.faint; }
    else if (active) { label = st.name; sub = st.id === 0 ? "HOME" : "JUMP READY"; col = COL.ink; }
    else { label = st.name; sub = pendingGates() > 0 ? "ACTIVATE — gate ready" : "Warp Gate Required"; col = COL.dim; }

    g.fillStyle = COL.slot; g.fillRect(row.x, row.y, row.w, row.h);
    g.strokeStyle = (discovered && active) ? COL.good : COL.line;
    g.lineWidth = (discovered && active) ? 2 * k : 1;
    g.strokeRect(row.x, row.y, row.w, row.h); g.lineWidth = 1;

    g.fillStyle = col; g.font = fontFor(12, discovered && active, k);
    g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText(label, row.x + 12 * k, row.y + row.h / 2);
    if (sub) {
      g.fillStyle = COL.dim; g.font = fontFor(9, false, k);
      g.textAlign = "right";
      g.fillText(sub, row.x + row.w - 12 * k, row.y + row.h / 2);
    }
  }

  function drawTunnel(g, W, H, k, anim) {
    var p = clamp(anim.t / anim.dur, 0, 1);
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    // Streaking stars radiating from centre; length grows with progress.
    var cx = W / 2, cy = H / 2, N = 80;
    g.strokeStyle = "rgba(180,210,255,0.8)"; g.lineWidth = Math.max(1, 1.5 * k);
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2 + p * 6;
      var seed = (i * 9301 + 49297) % 233280 / 233280;     // stable per-streak radius
      var r0 = (40 + seed * 120) * k * (0.3 + p);
      var r1 = r0 + (60 + seed * 160) * k * p;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    g.lineWidth = 1;
    // Opening white flash.
    if (p < 0.2) { g.fillStyle = "rgba(255,255,255," + (1 - p / 0.2).toFixed(3) + ")"; g.fillRect(0, 0, W, H); }
  }

  function drawWarpUI(g, canvasArg) {
    g = g || boundCtx;
    if (!g) return;
    var cv = canvasArg || boundCanvas || { width: 390, height: 700 };
    var W = cv.width || 390, H = cv.height || 700, k = Math.min(W / 390, H / 700);
    var anim = state.warpAnim;
    if (anim && anim.active) { drawTunnel(g, W, H, k, anim); return; }
    if (!state.warpUI.open) return;

    g.fillStyle = COL.dimWash; g.fillRect(0, 0, W, H);
    g.fillStyle = COL.gold; g.font = fontFor(13, true, k);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("── SELECT DESTINATION ──", W / 2, H * 0.10);

    var L = warpLayout(W, H, k);
    for (var i = 0; i < L.rows.length; i++) drawWarpRow(g, L.rows[i], state.stations[i], k);
    drawButton(g, L.close, "CLOSE", k);
  }

  /* ── inspection ───────────────────────────────────────────────────────────── */

  function getState() {
    var discovered = 0, active = 0;
    state.stations.forEach(function (s) { if (s.discovered) discovered++; if (s.warpActive) active++; });
    return {
      seed: state.seed,
      stations: state.stations.length,
      discovered: discovered,
      active: active,
      nebulas: state.nebulas.length,
      warp: getWarpState(),
      warpUIOpen: state.warpUI.open,
      warping: isWarping()
    };
  }

  /* ── selfTest ─────────────────────────────────────────────────────────────── */

  function makeStubCtx(ops) {
    var names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
      "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect", "clearRect",
      "fillText", "strokeText", "clip"];
    var c = {};
    names.forEach(function (n) { c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); }; });
    return c;
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    var saved = { player: state.player, onToast: state.onToast, cv: boundCanvas, cx: boundCtx };
    try {
      // 1. Generate seed-42 world: 8 stations, station 0 central + discovered + active.
      initWorld(42);
      var sts = getStations();
      check(sts.length === 8, "expected 8 stations, got " + sts.length);
      check(sts[0].id === 0 && sts[0].discovered === true && sts[0].warpActive === true,
        "station 0 must be discovered + warp-active");
      check(Math.abs(sts[0].pos.x) < 1e-9 && Math.abs(sts[0].pos.y) < 1e-9, "station 0 must sit at world centre");
      check(/^Homeport /.test(sts[0].name), "station 0 name should read as the home base, got '" + sts[0].name + "'");

      // 2. Stations 1–7 start hidden; orbit band 2500–6000; pairwise gap ≥ 1500; unique names.
      var names = {};
      for (var i = 1; i < sts.length; i++) {
        check(sts[i].discovered === false && sts[i].warpActive === false, "station " + i + " should start hidden/inactive");
        var d = Math.sqrt(sts[i].pos.x * sts[i].pos.x + sts[i].pos.y * sts[i].pos.y);
        check(d >= STATION_MIN_R - 1e-6 && d <= STATION_MAX_R + 1e-6, "station " + i + " distance " + d.toFixed(0) + " outside 2500–6000");
      }
      for (var a = 0; a < sts.length; a++) {
        check(!names[sts[a].name], "duplicate station name '" + sts[a].name + "'");
        names[sts[a].name] = true;
        for (var b = a + 1; b < sts.length; b++) {
          check(dist(sts[a].pos, sts[b].pos) >= MIN_STATION_GAP - 1e-6,
            "stations " + a + "/" + b + " closer than " + MIN_STATION_GAP);
        }
      }

      // 3. Nebulas: 6 clouds, radius 400–800, valid color, ≥1000 clear of every station.
      var nebs = getNebulas();
      check(nebs.length === NEBULA_COUNT, "expected " + NEBULA_COUNT + " nebulas, got " + nebs.length);
      nebs.forEach(function (n, ni) {
        check(n.radius >= NEBULA_MIN_R - 1e-6 && n.radius <= NEBULA_MAX_R + 1e-6, "nebula " + ni + " radius out of range: " + n.radius);
        check(NEBULA_COLORS.indexOf(n.color) !== -1, "nebula " + ni + " bad color '" + n.color + "'");
        sts.forEach(function (s, si) {
          check(dist(n.pos, s.pos) >= n.radius + NEBULA_STATION_CLEAR - 1e-6,
            "nebula " + ni + " overlaps/too close to station " + si);
        });
      });

      // 4. Warp-gate cost doubles: 1000,2000,4000,8000,16000,32000,64000.
      var wantCost = [1000, 2000, 4000, 8000, 16000, 32000, 64000];
      for (var w = 0; w < wantCost.length; w++) check(getWarpGateCost(w) === wantCost[w], "getWarpGateCost(" + w + ") = " + getWarpGateCost(w) + ", want " + wantCost[w]);

      // 5. buyWarpGate: rejects when short, deducts + increments owned when affordable.
      initWorld(42);
      var poor = buyWarpGate(500);
      check(poor.success === false && poor.cost === 1000 && poor.newCredits === 500, "buyWarpGate short should fail cleanly");
      var rich = buyWarpGate(1000);
      check(rich.success === true && rich.newCredits === 0 && getWarpState().owned === 1, "buyWarpGate should deduct + increment owned");
      check(getWarpState().nextCost === 2000, "next gate should cost 2000 after buying one");

      // 6. Discovery radius: reveals at ≤800, not at >800. Toasts fire.
      initWorld(42);
      var toasts = [];
      setToastFn(function (t) { toasts.push(t); });
      var target = getStations()[1];
      var far = { x: target.pos.x + 900, y: target.pos.y };
      check(updateDiscovery(far).length === 0 && target.discovered === false, "station must stay hidden at 900 units");
      var near = { x: target.pos.x + 799, y: target.pos.y };
      var ev = updateDiscovery(near);
      check(target.discovered === true, "station must reveal within 800 units");
      check(ev.some(function (e) { return e.type === "discover" && e.station === target; }), "discovery event missing");
      check(toasts.some(function (t) { return t === "NEW STATION DISCOVERED: " + target.name; }), "discovery toast not fired");

      // 7. Nebula modifiers + enter/exit toasts.
      initWorld(42);
      var toasts2 = [];
      setToastFn(function (t) { toasts2.push(t); });
      var neb = getNebulas()[0];
      var inside = { x: neb.pos.x, y: neb.pos.y };
      check(isInNebula(inside) === true, "centre of a nebula must read as inside");
      var mods = getNebulaModifiers(inside);
      check(mods.inNebula && mods.tierBoost === 1 && mods.scanRangeMult === 0.7, "nebula modifiers wrong: " + JSON.stringify(mods));
      check(mods.dragTowing === 0.990 && mods.dragFree === 0.996, "nebula drag values wrong: " + JSON.stringify(mods));
      var outside = { x: 0, y: 0 };               // station 0 sits clear of any nebula
      check(isInNebula(outside) === false, "world centre should be clear of nebulas");
      var clear = getNebulaModifiers(outside);
      check(clear.dragTowing === 0.985 && clear.dragFree === 0.994 && clear.tierBoost === 0, "clear-space modifiers wrong: " + JSON.stringify(clear));
      updateDiscovery(inside);
      check(toasts2.indexOf("ENTERING NEBULA") !== -1, "ENTERING NEBULA toast missing");
      updateDiscovery(outside);
      check(toasts2.indexOf("NEBULA CLEARED") !== -1, "NEBULA CLEARED toast missing");

      // 8. Activation gates: needs a bought gate + a discovered station; blocks repeats.
      initWorld(42);
      var s1 = getStations()[1];
      check(activateWarpGate(1).success === false, "activate without a bought gate must fail");
      updateDiscovery({ x: s1.pos.x, y: s1.pos.y });   // discover it
      buyWarpGate(999999);                             // owns 1 gate
      check(activateWarpGate(1).success === true && s1.warpActive === true, "activate should light a discovered station");
      check(activateWarpGate(1).success === false, "re-activating an active gate must fail");
      check(getWarpState().pending === 0, "gate should be spent after activation");

      // 9. Jump: −50 fuel, teleport to destination, onArrival fires after the tunnel.
      initWorld(42);
      var player = { x: 10, y: 20, fuel: 100 };
      setPlayer(player);
      var s2 = getStations()[2];
      check(jumpTo(2).ok === false, "jump to an un-jumpable station must fail");
      updateDiscovery({ x: s2.pos.x, y: s2.pos.y });
      buyWarpGate(999999); activateWarpGate(2);
      var arrived = null;
      var jr = jumpTo(2, function (st) { arrived = st; });
      check(jr.ok === true && jr.fuelCost === 50, "jump should succeed at cost 50 fuel");
      check(player.fuel === 50, "jump must deduct 50 fuel, got " + player.fuel);
      check(player.x === s2.pos.x && player.y === s2.pos.y, "jump must teleport the ship to the station");
      check(isWarping() === true, "warp animation should be running");
      check(arrived === null, "onArrival must wait for the tunnel to finish");
      var tw = tickWarp(2.0);
      check(tw && tw.arrived === true && arrived === s2, "onArrival should fire once the tunnel completes");
      check(isWarping() === false, "warp animation should be done after it completes");

      // 10. Warp UI: opens, lists all 8 stations (names, ??? , Warp Gate Required), routes taps.
      initWorld(42);
      var picked = null;
      var stubCanvas = { width: 390, height: 700 };
      setContext(stubCanvas, null);
      var disc = getStations()[3];                       // reveal one so it reads "Warp Gate Required"
      updateDiscovery({ x: disc.pos.x, y: disc.pos.y });
      openWarpUI(function (st) { picked = st; });
      check(isWarpUIOpen() === true, "openWarpUI should open the overlay");
      var ops = [];
      drawWarpUI(makeStubCtx(ops), stubCanvas);
      var texts = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      check(texts.indexOf("── SELECT DESTINATION ──") !== -1, "warp UI header missing");
      check(texts.indexOf(getStations()[0].name) !== -1, "warp UI should list the home station name");
      check(texts.indexOf("???") !== -1, "warp UI should hide undiscovered stations as ???");
      check(texts.indexOf("Warp Gate Required") !== -1, "warp UI should mark discovered-inactive stations");
      // Tap the home row (station 0, active) → jump.
      var L = warpLayout(390, 700, 1);
      var row0 = L.rows[0];
      setPlayer({ x: 0, y: 0, fuel: 100 });
      var act = handleWarpClick(row0.x + 5, row0.y + row0.h / 2);
      check(act.action === "jump" && act.station.id === 0, "tapping an active row should jump, got " + JSON.stringify(act.action));
      check(isWarpUIOpen() === false, "jump should close the warp UI");
      tickWarp(2.0);
      check(picked === getStations()[0], "warp UI callback should receive the arrival station");
      // Close button.
      openWarpUI(null);
      var cl = handleWarpClick(L.close.x + 2, L.close.y + 2);
      check(cl.action === "close" && isWarpUIOpen() === false, "close button should shut the warp UI");

      // 11. getState snapshot shape.
      initWorld(42);
      var gs = getState();
      check(gs.stations === 8 && gs.nebulas === 6 && gs.discovered === 1 && gs.active === 1, "getState counts wrong: " + JSON.stringify(gs));
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.message));
    } finally {
      state.player = saved.player; state.onToast = saved.onToast;
      boundCanvas = saved.cv; boundCtx = saved.cx;
    }
    return fails;
  }

  /* ── export ───────────────────────────────────────────────────────────────── */

  var Api = {
    initWorld: initWorld,
    getStations: getStations,
    getNebulas: getNebulas,
    updateDiscovery: updateDiscovery,
    isInNebula: isInNebula,
    getNebulaModifiers: getNebulaModifiers,
    getWarpGateCost: getWarpGateCost,
    getWarpState: getWarpState,
    buyWarpGate: buyWarpGate,
    activateWarpGate: activateWarpGate,
    openWarpUI: openWarpUI,
    closeWarpUI: closeWarpUI,
    isWarpUIOpen: isWarpUIOpen,
    handleWarpClick: handleWarpClick,
    drawWarpUI: drawWarpUI,
    jumpTo: jumpTo,
    tickWarp: tickWarp,
    isWarping: isWarping,
    setPlayer: setPlayer,
    setToastFn: setToastFn,
    setContext: setContext,
    COL: COL,
    getState: getState,
    selfTest: selfTest
  };

  root.ForgeWorld = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
