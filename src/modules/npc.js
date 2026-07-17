/* forge/modules/npc.js — Forge station NPCs: miner ships + reputation + turrets.
 *
 * Global: ForgeNPC  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: the NPC build request. Miners are lockable/killable like any target
 * (their hp block feeds ForgeCombat.applyDamage). Reputation is per-station and is
 * part of the game's save state (getReputationState / initNPC's saved arg).
 *
 * Cross-module use is by GLOBAL only:
 *   ForgeItemSystem.generateItem — miner cargo + death loot
 *   ForgeCombat.fireWeapon       — station turrets fire the same cannon rules
 * (Node require() fallback so the module self-bootstraps for headless tests.)
 *
 * Key exports:
 *   initNPC(stations, savedRep?)                    → register stations, seed reputation
 *   spawnMiners(station)                            → 2–3 miner ships for a station
 *   updateMiners(allMiners, oreRocks, delta)        → run the mine→tow→sell loop
 *   updateReputation(stationId, event, amount?)     → apply a rep change; returns new rep
 *   getReputation(stationId)                        → number (−1000..1000)
 *   getStatus(stationId)                            → {status,color,fee,discount,label}
 *   canDock(stationId)                              → {allowed, fee, status, discount}
 *   updateStationTurrets(stations, playerShip, delta) → outlaw-only auto-fire; returns events[]
 *   getMinerDrops(miner, opts?)                     → loot items[] on miner death
 *   onMinerAttacked(miner, killed)                  → convenience rep hook
 *   drawNPCShip(ctx, npc, camera), drawTurretRange(ctx, station, camera)
 *   getReputationState(), getState(), selfTest()
 */
;(function (root) {
  "use strict";

  function IS() { return root.ForgeItemSystem || (typeof require !== "undefined" ? require("./item_system.js") : null); }
  function CB() { return root.ForgeCombat || (typeof require !== "undefined" ? require("./combat.js") : null); }

  var REP_MIN = -1000, REP_MAX = 1000;
  var EVENT_DELTAS = { sell: 5, delivery: 20, dock_buy: 2, buy: 2, attack_miner: -150, kill_miner: -300 };
  var MINER_SPEED = 90;          // world units / s
  var PICKUP_DIST = 30, DOCK_DIST = 40;
  var TURRET_RANGE = 300, TURRET_INTERVAL = 3000, TURRET_DMG = 12; // 300u, every 3s, cannon
  var MINER_CARGO_BASES = ["shield_booster", "armor_plate", "fuel_cell", "cargo_expander", "hull_plating", "engine_booster"];

  // Stateless turret cannon (same profile as the catalog cannon; no fuel/ammo).
  var TURRET_CANNON = { id: "turret_cannon", weapon: { type: "cannon", dmgShield: 0.6, dmgArmor: 1.6, dmgHull: 1.0, range: TURRET_RANGE, fuelPerShot: 0, aoe: 0, ammo: null }, specials: [] };

  var STATUS_INFO = {
    friendly: { label: "Friendly", color: "#7bd88f", fee: 0, discount: 0.05 },
    neutral: { label: "Neutral", color: "#e8d24a", fee: 0, discount: 0 },
    hostile: { label: "Hostile", color: "#ff8a3c", fee: 200, discount: 0 },
    outlaw: { label: "Outlaw", color: "#ff5060", fee: 200, discount: 0 }
  };

  var state = { stations: [], rep: {}, _mid: 0 };

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function stationId(st, idx) {
    if (st && st.id != null) return st.id;
    if (st) { st.id = "st" + (idx == null ? 0 : idx); return st.id; }
    return "st" + (idx == null ? 0 : idx);
  }
  function stationById(id) {
    for (var i = 0; i < state.stations.length; i++) if (stationId(state.stations[i], i) === id) return state.stations[i];
    return null;
  }

  /* ── setup ───────────────────────────────────────────────────────────────── */

  function initNPC(stations, savedRep) {
    state.stations = stations || [];
    state.rep = {};
    state._mid = 0;
    state.stations.forEach(function (st, i) {
      var id = stationId(st, i);
      state.rep[id] = (savedRep && savedRep[id] != null) ? clamp(savedRep[id], REP_MIN, REP_MAX) : 0;
      st._turretCd = 0;
    });
    return getState();
  }

  /* ── reputation ──────────────────────────────────────────────────────────── */

  // amount overrides the event's default delta (updateReputation(id,'custom',n)).
  function updateReputation(stationId_, event, amount) {
    var delta = amount != null ? amount : (EVENT_DELTAS[event] || 0);
    var cur = state.rep[stationId_] != null ? state.rep[stationId_] : 0;
    state.rep[stationId_] = clamp(cur + delta, REP_MIN, REP_MAX);
    return state.rep[stationId_];
  }

  function getReputation(stationId_) { return state.rep[stationId_] != null ? state.rep[stationId_] : 0; }

  function repStatus(rep) {
    if (rep > 200) return "friendly";
    if (rep >= -100) return "neutral";
    if (rep >= -400) return "hostile";
    return "outlaw";
  }

  function getStatus(stationId_) {
    var s = repStatus(getReputation(stationId_));
    var info = STATUS_INFO[s];
    return { status: s, label: info.label, color: info.color, fee: info.fee, discount: info.discount };
  }

  // Hostile/Outlaw stations demand a 200cr docking fee first; Friendly gets a 5% store
  // discount. Docking is never hard-blocked (an Outlaw can still dock — but see turrets).
  function canDock(stationId_) {
    var st = getStatus(stationId_);
    return { allowed: true, fee: st.fee, status: st.status, discount: st.discount };
  }

  // Convenience: apply the correct rep hit when the player shoots/kills a miner.
  function onMinerAttacked(miner, killed) {
    if (!miner || miner.stationId == null) return getReputation(miner && miner.stationId);
    return updateReputation(miner.stationId, killed ? "kill_miner" : "attack_miner");
  }

  function getReputationState() { return clone(state.rep); }

  /* ── miners ──────────────────────────────────────────────────────────────── */

  function minerHp() {
    return { shield: 50, shieldMax: 50, armor: 30, armorMax: 30, hull: 40, hullMax: 40, res: { shield: 0, armor: 0.1, hull: 0 }, _sinceHit: 99 };
  }

  // 2–3 miners spawned around a station, each carrying 1–2 real Normal-tier items.
  function spawnMiners(station) {
    var Items = IS();
    var sid = stationId(station, state.stations.indexOf(station));
    var rng = Math.random;
    var count = 2 + Math.floor(rng() * 2); // 2 or 3
    var miners = [];
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var cargo = [];
      if (Items) {
        var nCargo = 1 + Math.floor(rng() * 2); // 1 or 2
        for (var c = 0; c < nCargo; c++) {
          var base = MINER_CARGO_BASES[Math.floor(rng() * MINER_CARGO_BASES.length)];
          cargo.push(Items.generateItem(base, "normal", { ilvl: 2, rng: rng }));
        }
      }
      state._mid += 1;
      miners.push({
        id: "miner_" + state._mid, kind: "miner", stationId: sid, color: "#9aa7b8",
        x: (station.x || 0) + Math.cos(a) * 70, y: (station.y || 0) + Math.sin(a) * 70,
        vx: 0, vy: 0, angle: 0,
        hp: minerHp(), cargo: cargo, cargoMax: 2,
        state: "SEEK", target: null, towed: null, speed: MINER_SPEED
      });
    }
    return miners;
  }

  function steerTo(m, tx, ty, speed, delta) {
    var dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1;
    m.vx = dx / d * speed; m.vy = dy / d * speed;
    m.x += m.vx * delta; m.y += m.vy * delta;
    if (d > 1) m.angle = Math.atan2(dy, dx);
  }

  function nearestFreeRock(m, rocks) {
    if (!rocks) return null;
    var best = null, bd = Infinity;
    for (var i = 0; i < rocks.length; i++) {
      var r = rocks[i];
      if (!r || r.active === false || r.mined || (r.towedBy && r.towedBy !== m.id)) continue;
      var d = dist(m, r);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // Simple economy loop per miner: SEEK nearest ore → tow it home → SELL → repeat.
  // Marks sold rocks {mined:true} (the game may respawn them). delta is seconds.
  function updateMiners(allMiners, oreRocks, delta) {
    delta = delta || 0;
    (allMiners || []).forEach(function (m) {
      if (!m || (m.hp && m.hp.hull <= 0)) { if (m) m.state = "DEAD"; return; }
      var st = stationById(m.stationId);
      switch (m.state) {
        case "SEEK":
          var rock = nearestFreeRock(m, oreRocks);
          if (!rock) { if (st) steerTo(m, st.x, st.y, m.speed * 0.3, delta); break; } // idle near home
          m.target = rock;
          steerTo(m, rock.x, rock.y, m.speed, delta);
          if (dist(m, rock) < PICKUP_DIST) { m.towed = rock; rock.towedBy = m.id; m.state = "RETURN"; }
          break;
        case "RETURN":
          if (!st) { m.state = "SEEK"; break; }
          steerTo(m, st.x, st.y, m.speed, delta);
          if (m.towed) { m.towed.x = m.x; m.towed.y = m.y; }         // drag the rock home
          if (dist(m, st) < DOCK_DIST) m.state = "SELL";
          break;
        case "SELL":
          if (m.towed) { m.towed.towedBy = null; m.towed.mined = true; m.towed = null; } // ore consumed
          m.target = null;
          m.state = "SEEK";
          break;
        default: break;
      }
    });
    return allMiners;
  }

  // Miner death loot: 1–2 items from its cargo + 1 fresh Normal-tier item.
  function getMinerDrops(miner, opts) {
    opts = opts || {};
    var Items = IS();
    var rng = opts.rng || Math.random;
    var out = [];
    var cargo = (miner && miner.cargo) || [];
    var n = Math.min(cargo.length, 1 + Math.floor(rng() * 2)); // 1–2
    for (var i = 0; i < n; i++) out.push(cargo[i]);
    if (Items) {
      var base = MINER_CARGO_BASES[Math.floor(rng() * MINER_CARGO_BASES.length)];
      out.push(Items.generateItem(base, "normal", { ilvl: 2, rng: rng }));
    }
    return out;
  }

  /* ── station turrets ─────────────────────────────────────────────────────── */

  // Outlaw-rep only: a stationary 300u cannon that auto-fires every 3s at the player.
  function updateStationTurrets(stations, playerShip, delta) {
    delta = delta || 0;
    var dtMs = delta * 1000;
    var Combat = CB();
    var events = [];
    (stations || []).forEach(function (st, i) {
      var id = stationId(st, i);
      var outlaw = repStatus(getReputation(id)) === "outlaw";
      var inRange = playerShip && dist(st, playerShip) <= TURRET_RANGE;
      st._turretCd = (st._turretCd || 0) - dtMs;
      if (outlaw && inRange) {
        if (st._turretCd <= 0) {
          st._turretCd = TURRET_INTERVAL;
          var turretShip = { x: st.x || 0, y: st.y || 0, weaponDmg: TURRET_DMG, fireRate: 1 };
          var shot = Combat ? Combat.fireWeapon(TURRET_CANNON, playerShip, [playerShip], turretShip) : null;
          events.push({ stationId: id, shot: shot });
        }
      } else if (st._turretCd < 0) {
        st._turretCd = 0; // stay primed while idle
      }
    });
    return events;
  }

  /* ── drawing (world-space only — never HUD) ──────────────────────────────── */

  function project(camera, wx, wy) {
    var c = camera || {}, z = c.zoom || 1;
    return { x: (wx - (c.x || 0)) * z + (c.offX || 0), y: (wy - (c.y || 0)) * z + (c.offY || 0) };
  }

  function drawNPCShip(ctx, npc, camera) {
    if (!ctx || !npc) return;
    var z = (camera && camera.zoom) || 1;
    var p = project(camera, npc.x, npc.y);
    var s = 9 * z;
    ctx.save && ctx.save();
    // diamond body
    ctx.fillStyle = npc.color || "#9aa7b8";
    ctx.strokeStyle = "#0d1017";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x + s, p.y);
    ctx.lineTo(p.x, p.y + s);
    ctx.lineTo(p.x - s, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // hull bar
    var hp = npc.hp || {};
    var barW = 20 * z;
    ctx.fillStyle = "#1c2430";
    ctx.fillRect(p.x - barW / 2, p.y - s - 7 * z, barW, 3 * z);
    ctx.fillStyle = "#ff5060";
    ctx.fillRect(p.x - barW / 2, p.y - s - 7 * z, barW * clamp((hp.hull || 0) / (hp.hullMax || 1), 0, 1), 3 * z);
    ctx.restore && ctx.restore();
  }

  // The turret's 300u threat ring — draw it when the player is Outlaw at this station.
  function drawTurretRange(ctx, station, camera) {
    if (!ctx || !station) return;
    var z = (camera && camera.zoom) || 1;
    var p = project(camera, station.x, station.y);
    ctx.strokeStyle = "#ff5060";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, TURRET_RANGE * z, 0, Math.PI * 2);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // turret nub
    ctx.fillStyle = "#ff5060";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * z, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── inspection ──────────────────────────────────────────────────────────── */

  function getState() {
    return { stations: state.stations.length, reputation: clone(state.rep) };
  }

  /* ── selfTest ────────────────────────────────────────────────────────────── */

  function makeStubCtx(ops) {
    var names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
      "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect",
      "clearRect", "fillText", "strokeText", "clip", "setLineDash"];
    var c = {};
    names.forEach(function (n) { c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); }; });
    return c;
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    try {
      if (!IS()) return ["FAIL: ForgeItemSystem must load before npc"];
      var stations = [{ id: "s0", x: 0, y: 0 }, { id: "s1", x: 2000, y: 0 }];
      initNPC(stations);
      check(getReputation("s0") === 0, "rep should start at 0");

      // 1. Reputation events + thresholds.
      check(updateReputation("s0", "sell") === 5, "sell should +5");
      check(updateReputation("s0", "delivery") === 25, "delivery should +20 (→25)");
      check(getStatus("s0").status === "neutral", "0..200 is neutral");
      updateReputation("s1", "custom", 300);
      check(getStatus("s1").status === "friendly" && getStatus("s1").discount === 0.05, "rep>200 → friendly, 5% discount");
      check(canDock("s1").fee === 0, "friendly docking is free");

      // 2. Hostile / Outlaw thresholds + docking fee.
      updateReputation("s0", "custom", -200); // 25 → -175 → hostile
      check(getStatus("s0").status === "hostile", "rep<-100 → hostile, got " + getStatus("s0").status);
      check(canDock("s0").allowed && canDock("s0").fee === 200, "hostile must pay a 200cr docking fee");
      updateReputation("s0", "custom", -300); // -175 → -475 → outlaw
      check(getStatus("s0").status === "outlaw", "rep<-400 → outlaw, got " + getStatus("s0").status);

      // 3. Clamp to [-1000, 1000].
      updateReputation("s1", "custom", 99999);
      check(getReputation("s1") === 1000, "rep clamps at +1000");
      updateReputation("s0", "custom", -99999);
      check(getReputation("s0") === -1000, "rep clamps at -1000");

      // 4. Persistence round-trip.
      var saved = getReputationState();
      initNPC(stations, saved);
      check(getReputation("s1") === 1000 && getReputation("s0") === -1000, "saved reputation should restore");
      initNPC(stations); // reset for the rest of the tests

      // 5. Miners spawn with correct stats + real cargo.
      var miners = spawnMiners(stations[0]);
      check(miners.length >= 2 && miners.length <= 3, "should spawn 2–3 miners, got " + miners.length);
      check(miners.every(function (m) { return m.hp.shieldMax === 50 && m.hp.armorMax === 30 && m.hp.hullMax === 40; }), "miner stats wrong");
      check(miners.every(function (m) { return m.stationId === "s0" && m.cargoMax === 2 && m.cargo.length >= 1; }), "miners should belong to s0 and carry cargo");

      // 6. Miner loop: SEEK → tow → RETURN → SELL, moving and consuming the rock.
      var m0 = miners[0]; m0.x = 300; m0.y = 300; m0.state = "SEEK";
      var rocks = [{ id: "r0", x: 500, y: 300 }];
      var reachedSell = false, ranReturn = false;
      for (var t = 0; t < 600; t++) {
        updateMiners([m0], rocks, 1 / 30);
        if (m0.state === "RETURN") ranReturn = true;
        if (m0.state === "SELL") reachedSell = true;
      }
      check(ranReturn, "miner should tow a rock (enter RETURN)");
      check(rocks[0].mined === true, "the towed rock should be consumed (mined)");

      // 7. Miner is a valid combat target (applyDamage kills it), then drops loot.
      var Combat = CB();
      var victim = miners[1];
      if (Combat) { Combat.applyDamage(victim, 999, 999, 999); }
      check(victim.hp.hull <= 0, "combat damage should be able to kill a miner");
      var drops = getMinerDrops(victim, { rng: function () { return 0; } });
      check(drops.length >= 2, "miner death should drop cargo + 1 normal item, got " + drops.length);
      check(drops.every(function (d) { return d && d.base && d.id; }), "miner drops should be real items");
      check(onMinerAttacked(victim, true) === -300, "killing a miner should be -300 rep");

      // 8. Turret: outlaw + in range → fires cannon every 3s at the player.
      initNPC([{ id: "s0", x: 0, y: 0 }]);
      updateReputation("s0", "custom", -500); // outlaw
      var player = { x: 100, y: 0, hp: { shield: 100, shieldMax: 100, armor: 50, armorMax: 50, hull: 50, hullMax: 50, res: { shield: 0, armor: 0, hull: 0 } } };
      var ev1 = updateStationTurrets(state.stations, player, 0.1);
      check(ev1.length === 1, "outlaw turret in range should fire once, got " + ev1.length);
      check(player.hp.shield < 100 || player.hp.armor < 50, "turret fire should damage the player (or miss occasionally)");
      // On cooldown for ~3s.
      var ev2 = updateStationTurrets(state.stations, player, 0.1);
      check(ev2.length === 0, "turret should be on cooldown right after firing");
      // Player out of range → no fire.
      player.x = 9999;
      var evFar = updateStationTurrets(state.stations, player, 5);
      check(evFar.length === 0, "turret should not fire at an out-of-range player");

      // 9. Non-outlaw station never fires.
      initNPC([{ id: "s0", x: 0, y: 0 }]);
      var pl2 = { x: 50, y: 0, hp: { shield: 100, shieldMax: 100, armor: 0, hull: 0, res: {} } };
      var evNeutral = updateStationTurrets(state.stations, pl2, 5);
      check(evNeutral.length === 0, "neutral station turret must stay silent");

      // 10. Draw calls are headless-safe.
      var ops = [];
      drawNPCShip(makeStubCtx(ops), miners[0], { x: 0, y: 0, zoom: 1, offX: 195, offY: 350 });
      check(ops.some(function (o) { return o[0] === "fill"; }), "drawNPCShip should fill the body");
      ops.length = 0;
      drawTurretRange(makeStubCtx(ops), { x: 0, y: 0 }, { zoom: 1 });
      check(ops.some(function (o) { return o[0] === "arc"; }), "drawTurretRange should draw the range ring");
      drawNPCShip(null, miners[0], {}); // headless no-op

      check(getState().stations === 1, "getState station count");
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    initNPC: initNPC,
    spawnMiners: spawnMiners,
    updateMiners: updateMiners,
    updateReputation: updateReputation,
    getReputation: getReputation,
    getStatus: getStatus,
    canDock: canDock,
    onMinerAttacked: onMinerAttacked,
    updateStationTurrets: updateStationTurrets,
    getMinerDrops: getMinerDrops,
    getReputationState: getReputationState,
    drawNPCShip: drawNPCShip,
    drawTurretRange: drawTurretRange,
    getState: getState,
    selfTest: selfTest
  };

  root.ForgeNPC = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
