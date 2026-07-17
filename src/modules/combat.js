/* forge/modules/combat.js — Forge lock-on combat: targeting, weapon firing, hit resolution.
 *
 * Global: ForgeCombat  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: the combat build request. Canvas 2D only for drawCombat; all state
 * math (lock, hit rolls, damage) runs headless (draw is guarded by `if (!ctx) return`).
 *
 * Damage model (the "same 3-layer rules as the player", chosen interpretation):
 *   A shot carries a per-layer, weapon-typed damage (Shield/Armor/Hull), each the
 *   ship's weaponDmg × that weapon's multiplier. It flows Shield → Armor → Hull.
 *   Each layer applies its own resist to the damage aimed at it; whatever fraction
 *   of the shot the layer fails to absorb (`penFrac`) carries to the next layer and
 *   scales THAT layer's typed damage. So a laser (dmgShield 1.6 / dmgArmor 0.6) that
 *   overkills a shield spends only its weak armor coefficient on the residual. This
 *   keeps weapon typing meaningful across layers and is fully deterministic.
 *
 * Key exports:
 *   initCombat(opts?)                              → reset combat state (opts.rng to seed)
 *   lockOn(target, shipState)                      → bool (target in ship.scanRange?)
 *   clearLock()                                    → drop the current lock
 *   fireWeapon(weaponItem, target, allTargets, shipState, opts?)
 *                                                  → { ok, hit, crit, glancing, damage, projectile, ... }
 *   applyDamage(target, dmgShield, dmgArmor, dmgHull) → target (3-layer, mutated)
 *   updateProjectiles(delta)                       → live projectiles[] (also ages lock + floaters)
 *   drawCombat(ctx, camera, state)                 → reticle + projectiles + floaters (no HUD)
 *   onPlayerDeath(playerState, homeStation)        → { newState } (teleport, -100cr, reset, clear)
 *   isLocked(), getLock(), getFloaters(), tickRespawn(), respawnText(),
 *   seedRng(seed), getState(), selfTest()
 *
 * lockOn/fireWeapon resolve a target from either a target OBJECT (has .x/.y) or an
 * id looked up in shipState.targets (array of {id,x,y,...}). shipState carries the
 * shooter's { x, y, scanRange, weaponDmg, fuel?, fuelCostK?, targets? }.
 */
;(function (root) {
  "use strict";

  /* Canonical palette subset (SYSTEMS_SPEC.md) used by the reticle / tracers. */
  var COL = {
    ink: "#e8edf4", dim: "#9aa7b8",
    lockOn: "#ff8a3c", lockBroken: "#6b7686",       // orange reticle / grey when broken
    laser: "#4ad2ff", cannon: "#ffb040", missile: "#57d1c9",
    crit: "#ffd24a", miss: "#9aa7b8"
  };

  /* Tunables (the combat build request). */
  var LOCK_TIME = 0.35;        // seconds of "locking" (dotted) before "locked" (solid)
  var HIT_CHANCE = 0.92;       // base chance a shot connects
  var CRIT_CHANCE = 0.15;      // chance a hit crits
  var CRIT_MULT = 1.5;         // crit damage multiplier
  var GLANCE_CHANCE = 0.20;    // chance a non-crit hit glances
  var GLANCE_MULT = 0.5;       // glancing damage multiplier
  var AOE_FACTOR = 0.40;       // missile splash = 40% of base per-layer damage
  var DEFAULT_FIRE_MS = 1200;  // default weapon cooldown when a weapon omits fireRate_ms
  var PROJ_SPEED = { laser: 1600, cannon: 1200, missile: 700 }; // world units / s
  var RESPAWN_DESTROYED_S = 2.0; // "SHIP DESTROYED" hold before "WARPING TO BASE..."

  /* Deterministic RNG (mulberry32) for seeded rolls / tests. */
  function seedRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  var state = null;

  function freshState(opts) {
    opts = opts || {};
    return {
      lock: { targetId: null, status: "none", t: 0, inRange: false }, // none|locking|locked|broken
      projectiles: [],
      floaters: [],
      rng: opts.rng || Math.random,
      _pid: 0
    };
  }

  function initCombat(opts) {
    state = freshState(opts);
    return getState();
  }

  function ensure() { if (!state) initCombat(); }

  /* ── small helpers ───────────────────────────────────────────────────────── */

  function round4(v) { return Math.round(v * 1e4) / 1e4; }
  function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }
  function hpOf(t) { return (t && t.hp) ? t.hp : t; }
  function hpTotal(t) { var hp = hpOf(t); return hp ? ((hp.shield || 0) + (hp.armor || 0) + (hp.hull || 0)) : 0; }

  function specialSum(item, key) {
    var s = 0;
    ((item && item.specials) || []).forEach(function (sp) { if (sp.key === key) s += sp.val; });
    return s;
  }

  function findById(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  // Resolve a target argument to a live object with x/y. Accepts the object itself
  // or an id looked up in shipState.targets.
  function resolveTarget(target, shipState) {
    if (target && typeof target === "object" && (target.x != null || target.y != null)) return target;
    if (shipState && shipState.targets) return findById(shipState.targets, target);
    return null;
  }

  function targetIdOf(target) {
    if (target && typeof target === "object") return target.id != null ? target.id : target;
    return target;
  }

  /* ── lock-on ─────────────────────────────────────────────────────────────── */

  // Call each frame with the current target to keep the lock fresh: returns true
  // while the target sits inside ship.scanRange, false (and breaks the lock) once
  // it leaves. A new in-range target starts a short "locking" phase (dotted reticle)
  // that updateProjectiles() ages into "locked" (solid) after LOCK_TIME.
  function lockOn(target, shipState) {
    ensure();
    var ship = shipState || {};
    var tgt = resolveTarget(target, shipState);
    if (!tgt) return false;
    var id = targetIdOf(target != null && typeof target === "object" ? target : tgt);
    if (id == null) id = tgt.id;

    var scan = ship.scanRange || 0;
    var d = dist(tgt, { x: ship.x || 0, y: ship.y || 0 });
    var inRange = d <= scan;
    var lk = state.lock;

    if (inRange) {
      if (lk.targetId !== id || lk.status === "none" || lk.status === "broken") {
        state.lock = { targetId: id, status: "locking", t: 0, inRange: true };
      } else {
        lk.inRange = true; // same target still in range — keep locking/locked progress
      }
      return true;
    }
    if (lk.targetId === id) { lk.status = "broken"; lk.inRange = false; }
    return false;
  }

  function clearLock() {
    ensure();
    state.lock = { targetId: null, status: "none", t: 0, inRange: false };
  }

  function isLocked() { ensure(); return state.lock.status === "locked"; }
  function getLock() { ensure(); var l = state.lock; return { targetId: l.targetId, status: l.status, t: round4(l.t), inRange: l.inRange }; }

  // Cooldown (ms) for a weapon item, honoring rof_pct affixes via shipState.fireRate.
  function weaponCooldownMs(weaponItem, shipState) {
    var w = weaponItem && weaponItem.weapon;
    var baseMs = (w && w.fireRate_ms) || DEFAULT_FIRE_MS;
    var rate = (shipState && shipState.fireRate) || 1;
    return baseMs / (rate > 0 ? rate : 1);
  }

  /* ── damage application (3-layer, weapon-typed, penetrating) ─────────────── */

  function layerHit(cur, res, typed) {
    res = res || 0;
    if (cur <= 0) return { cur: 0, dealt: 0, penFrac: 1 };      // layer already gone — pass full shot on
    if (typed <= 0) return { cur: cur, dealt: 0, penFrac: 0 };  // layer holds, weapon can't touch it
    var eff = typed * (1 - res);
    if (eff <= cur) return { cur: cur - eff, dealt: eff, penFrac: 0 };
    return { cur: 0, dealt: cur, penFrac: (eff - cur) / eff };  // fraction of the shot that survived
  }

  function resolveDamage(hp, dS, dA, dH) {
    var res = hp.res || {};
    var s = layerHit(hp.shield || 0, res.shield || 0, dS || 0);
    hp.shield = round4(s.cur);
    var a = layerHit(hp.armor || 0, res.armor || 0, (dA || 0) * s.penFrac);
    hp.armor = round4(a.cur);
    var h = layerHit(hp.hull || 0, res.hull || 0, (dH || 0) * a.penFrac);
    hp.hull = round4(Math.max(0, h.cur));
    hp._sinceHit = 0;
    return {
      dealt: round4(s.dealt + a.dealt + h.dealt),
      shieldHit: s.dealt > 0, armorHit: a.dealt > 0, hullHit: h.dealt > 0,
      dead: hp.hull <= 0
    };
  }

  // Public: apply pre-typed per-layer damage to a target (target.hp or the block
  // itself). Returns the target; last-hit telemetry is stashed on target._lastDamage.
  function applyDamage(target, dmgShield, dmgArmor, dmgHull) {
    var hp = hpOf(target);
    if (!hp) return target;
    var tel = resolveDamage(hp, dmgShield, dmgArmor, dmgHull);
    if (target && typeof target === "object") target._lastDamage = tel;
    return target;
  }

  /* ── projectiles + floaters ──────────────────────────────────────────────── */

  // projSpeed and color come from the weapon's data (game content), not a table
  // baked into the engine; PROJ_SPEED/COL are only neutral fallbacks.
  function makeProjectile(type, from, to, speedOverride, color) {
    ensure();
    var speed = speedOverride || PROJ_SPEED[type] || 1000;
    var d = Math.hypot(to.x - from.x, to.y - from.y);
    var ttl = Math.min(2.5, d / speed + 0.05);   // laser no longer clips short — full travel distance
    return {
      id: ++state._pid, type: type, color: color || COL[type] || COL.ink,
      from: { x: from.x, y: from.y }, x: from.x, y: from.y, tx: to.x, ty: to.y,
      speed: speed, ttl: ttl, life: 0, dead: false,
      hit: false, crit: false, glancing: false, aoe: 0
    };
  }

  function addFloater(text, x, y, color) {
    ensure();
    state.floaters.push({ text: text, x: x, y: y, age: 0, ttl: 1.0, color: color || COL.dim });
  }

  /* ── firing ──────────────────────────────────────────────────────────────── */

  // fireWeapon resolves ONE shot: gates on ammo/fuel (and consumes them), rolls
  // hit / crit / glancing, applies typed damage to the target (and 40% splash to
  // AoE weapons' neighbours), and returns the outcome plus a visual projectile.
  // opts.rng overrides the roll source (used by selfTest to force outcomes).
  function fireWeapon(weaponItem, target, allTargets, shipState, opts) {
    ensure();
    opts = opts || {};
    var rng = opts.rng || state.rng;
    var ship = shipState || {};
    var w = weaponItem && weaponItem.weapon;
    var nores = { ok: false, hit: false, crit: false, glancing: false, damage: 0, projectile: null };
    if (!w) { nores.reason = "not a weapon"; return nores; }

    var ammoLimited = (w.ammo != null);
    if (ammoLimited && (weaponItem.ammo == null || weaponItem.ammo <= 0)) {
      nores.reason = "out of ammo"; nores.outOfAmmo = true; return nores;
    }
    var fuelCostK = ship.fuelCostK != null ? ship.fuelCostK : 1;
    var fuelCost = round4((w.fuelPerShot || 0) * fuelCostK);
    if (ship.fuel != null && ship.fuel < fuelCost) { nores.reason = "insufficient fuel"; return nores; }

    // A shot is spent whether or not it connects.
    if (ship.fuel != null) ship.fuel = round4(ship.fuel - fuelCost);
    if (ammoLimited) weaponItem.ammo -= 1;

    var base = ship.weaponDmg != null ? ship.weaponDmg : 10;
    var from = { x: ship.x || 0, y: ship.y || 0 };
    var to = target ? { x: (target.x || 0), y: (target.y || 0) } : from;
    var proj = makeProjectile(w.type, from, to, w.projSpeed, w.color);
    state.projectiles.push(proj);

    var out = {
      ok: true, hit: false, crit: false, glancing: false, damage: 0, mult: 0,
      fuelCost: fuelCost, ammoLeft: ammoLimited ? weaponItem.ammo : null, projectile: proj
    };

    // Per-ship accuracy / crit come from shipState when supplied (skill tree,
    // hull tuning); absent → the module defaults, so headless callers and
    // selfTests keep the original 0.92 hit / 0.15 crit behaviour. hitBonus /
    // critBonus are ADDITIVE nudges (skills pass these; combat owns the base).
    var hitChance = (ship.hitChance != null ? ship.hitChance : HIT_CHANCE) + (ship.hitBonus || 0);
    var critChance = (ship.critChance != null ? ship.critChance : CRIT_CHANCE) + (ship.critBonus || 0);
    if (hitChance > 1) hitChance = 1;
    if (critChance > 1) critChance = 1;

    if (rng() >= hitChance) {                         // miss
      addFloater("MISS", to.x, to.y, COL.miss);
      return out;
    }

    var crit = false, glancing = false, mult = 1;
    if (rng() < critChance) { crit = true; mult = CRIT_MULT; }
    else if (rng() < GLANCE_CHANCE) { glancing = true; mult = GLANCE_MULT; }
    proj.hit = true; proj.crit = crit; proj.glancing = glancing;

    // Per-layer damage multipliers ("boost shield/armor damage" skills); default
    // 1 leaves existing behaviour and selfTests unchanged.
    var mS = ship.dmgMultShield != null ? ship.dmgMultShield : 1;
    var mA = ship.dmgMultArmor != null ? ship.dmgMultArmor : 1;
    var mH = ship.dmgMultHull != null ? ship.dmgMultHull : 1;
    var dS = base * w.dmgShield * mult * mS;
    var dA = base * w.dmgArmor * mult * mA;
    var dH = base * w.dmgHull * mult * mH;

    var before = hpTotal(target);
    applyDamage(target, dS, dA, dH);
    out.hit = true; out.crit = crit; out.glancing = glancing; out.mult = mult;
    out.damage = round4(before - hpTotal(target));
    out.dead = !!(target && target._lastDamage && target._lastDamage.dead);

    // Missile splash: 40% of base per-layer damage to everything within the (affix-
    // boosted) AoE radius of the impact point, excluding the primary target.
    if (w.aoe && w.aoe > 0 && allTargets && allTargets.length) {
      var aoeMult = ship.aoeMult != null ? ship.aoeMult : 1;   // "blast radius" skill; default 1
      var radius = w.aoe * (1 + specialSum(weaponItem, "aoe_radius_pct") / 100) * aoeMult;
      proj.aoe = round4(radius);
      for (var i = 0; i < allTargets.length; i++) {
        var o = allTargets[i];
        if (!o || o === target) continue;
        if (dist(o, to) <= radius) applyDamage(o, dS * AOE_FACTOR, dA * AOE_FACTOR, dH * AOE_FACTOR);
      }
    }

    if (crit) addFloater("CRIT", to.x, to.y, COL.crit);
    return out;
  }

  // Advance projectiles toward their impact points, age the lock's locking→locked
  // timer and the damage floaters. Returns the still-live projectiles.
  function updateProjectiles(delta) {
    ensure();
    delta = delta || 0;

    var lk = state.lock;
    if (lk.status === "locking" && lk.inRange) {
      lk.t += delta;
      if (lk.t >= LOCK_TIME) lk.status = "locked";
    }

    var live = [];
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      p.life += delta;
      var dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      var step = p.speed * delta;
      if (d <= step || p.life >= p.ttl) { p.x = p.tx; p.y = p.ty; p.dead = true; }
      else { p.x += dx / d * step; p.y += dy / d * step; }
      if (!p.dead) live.push(p);
    }
    state.projectiles = live;

    var fl = [];
    for (var j = 0; j < state.floaters.length; j++) {
      var f = state.floaters[j];
      f.age += delta; f.y -= 24 * delta;
      if (f.age < f.ttl) fl.push(f);
    }
    state.floaters = fl;

    return state.projectiles;
  }

  function getFloaters() { ensure(); return state.floaters.slice(); }
  function getProjectiles() { ensure(); return state.projectiles.slice(); }

  /* ── death / respawn ─────────────────────────────────────────────────────── */

  // Teleport the ship home, dock the death fee, restore all layers, and clear the
  // combat table (lock, projectiles, skills). Returns { newState } (playerState is
  // mutated in place). homeStation may be the station object/{x,y} or omitted (then
  // playerState.homeStation is used). The game/HUD renders playerState.respawn.
  function onPlayerDeath(playerState, homeStation) {
    ensure();
    var ps = playerState || {};
    var pos = (homeStation && typeof homeStation === "object") ? homeStation
      : (ps.homeStation && typeof ps.homeStation === "object" ? ps.homeStation : null);
    if (pos) { ps.x = pos.x || 0; ps.y = pos.y || 0; ps.vx = 0; ps.vy = 0; }

    if (ps.credits != null) ps.credits = Math.max(0, ps.credits - 100);

    var hp = ps.hp;
    if (hp) {
      if (hp.shieldMax != null) hp.shield = hp.shieldMax;
      if (hp.armorMax != null) hp.armor = hp.armorMax;
      if (hp.hullMax != null) hp.hull = hp.hullMax;
      hp._sinceHit = 99;
    }

    clearLock();
    state.projectiles = [];
    state.floaters = [];

    var EQ = root.ForgeEquipment;
    if (EQ && EQ.getSkillState && EQ.deactivateSkill) {
      var sk = EQ.getSkillState();
      for (var i = 0; i < sk.length; i++) if (sk[i] && sk[i].item) EQ.deactivateSkill(i);
    }

    ps.respawn = { phase: "destroyed", t: 0, destroyedFor: RESPAWN_DESTROYED_S };
    return { newState: ps };
  }

  // Advance the respawn overlay clock; flips 'destroyed' → 'warping' after 2s.
  function tickRespawn(playerState, delta) {
    var r = playerState && playerState.respawn;
    if (!r) return null;
    r.t += delta || 0;
    r.phase = r.t < (r.destroyedFor || RESPAWN_DESTROYED_S) ? "destroyed" : "warping";
    return r;
  }

  function respawnText(playerState) {
    var r = playerState && playerState.respawn;
    if (!r) return "";
    return r.phase === "warping" ? "WARPING TO BASE..." : "SHIP DESTROYED";
  }

  /* ── drawing (reticle + tracers + floaters only — never HUD) ─────────────── */

  function project(camera, wx, wy) {
    var c = camera || {};
    var z = c.zoom || 1;
    return { x: (wx - (c.x || 0)) * z + (c.offX || 0), y: (wy - (c.y || 0)) * z + (c.offY || 0) };
  }

  function drawReticle(ctx, camera, model) {
    var lk = state.lock;
    if (lk.status === "none" || lk.targetId == null) return;
    var tgt = (model && (model.lockTarget || findById(model.targets, lk.targetId))) || null;
    if (!tgt) return;
    var z = (camera && camera.zoom) || 1;
    var p = project(camera, tgt.x || 0, tgt.y || 0);
    var r = ((tgt.r || 20) + 8) * z;

    var solid = lk.status === "locked";
    ctx.strokeStyle = lk.status === "broken" ? COL.lockBroken : COL.lockOn;
    ctx.lineWidth = solid ? 2 : 1.5;
    if (ctx.setLineDash) ctx.setLineDash(solid ? [] : [4, 4]);
    ctx.globalAlpha = lk.status === "broken" ? 0.5 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // corner ticks on a solid lock
    if (solid) {
      var t = r + 4;
      for (var a = 0; a < 4; a++) {
        var ang = Math.PI / 4 + a * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r);
        ctx.lineTo(p.x + Math.cos(ang) * t, p.y + Math.sin(ang) * t);
        ctx.stroke();
      }
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  function drawProjectiles(ctx, camera) {
    for (var i = 0; i < state.projectiles.length; i++) {
      var p = state.projectiles[i];
      var col = COL[p.type] || COL.ink;
      var a = project(camera, p.x, p.y);
      var b = project(camera, p.from.x, p.from.y);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = p.type === "laser" ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.x, a.y, p.type === "missile" ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
    }
  }

  function drawFloaters(ctx, camera) {
    for (var i = 0; i < state.floaters.length; i++) {
      var f = state.floaters[i];
      var p = project(camera, f.x, f.y);
      ctx.globalAlpha = Math.max(0, 1 - f.age / f.ttl);
      ctx.fillStyle = f.color;
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  // Draw the lock reticle, weapon tracers and damage floaters in world space.
  // Draws NOTHING that the HUD owns (bars, buttons) — spec: no overlap.
  function drawCombat(ctx, camera, model) {
    if (!ctx) return;   // headless / not initialized
    ensure();
    drawReticle(ctx, camera, model || {});
    drawProjectiles(ctx, camera);
    drawFloaters(ctx, camera);
  }

  /* ── inspection ──────────────────────────────────────────────────────────── */

  function getState() {
    ensure();
    return {
      locked: state.lock.status === "locked",
      lockStatus: state.lock.status,
      lockTarget: state.lock.targetId,
      projectiles: state.projectiles.length,
      floaters: state.floaters.length
    };
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

  function seq(arr) { var i = 0; return function () { return arr[i++ % arr.length]; }; }
  function laserItem() { return { id: "w_l", weapon: { type: "laser", dmgShield: 1.6, dmgArmor: 0.6, dmgHull: 1.0, range: 600, fuelPerShot: 8, aoe: 0, ammo: null }, specials: [] }; }
  function missileItem(ammo) { return { id: "w_m", weapon: { type: "missile", dmgShield: 1.0, dmgArmor: 1.0, dmgHull: 1.0, range: 400, fuelPerShot: 3, aoe: 120, ammo: 20 }, ammo: ammo == null ? 20 : ammo, specials: [] }; }
  function mkTarget(id, x, y, s, a, h) {
    return { id: id, x: x, y: y, hp: { shield: s, shieldMax: s, armor: a, armorMax: a, hull: h, hullMax: h, res: { shield: 0, armor: 0, hull: 0 } } };
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }
    function near(a, b, e, msg) { if (Math.abs(a - b) > (e || 1e-6)) fails.push("FAIL: " + msg + " (" + a + " vs " + b + ")"); }

    try {
      initCombat();

      // 1. lockOn: in-range succeeds (locking → locked after LOCK_TIME); out-of-range breaks.
      var ship = { x: 0, y: 0, scanRange: 500, weaponDmg: 10, targets: [] };
      var tgt = mkTarget("a", 300, 0, 100, 80, 60);
      ship.targets = [tgt];
      check(lockOn("a", ship) === true, "lockOn in range should return true");
      check(getLock().status === "locking", "fresh lock should be 'locking', got " + getLock().status);
      check(isLocked() === false, "should not be fully locked before LOCK_TIME");
      updateProjectiles(0.4);
      check(isLocked() === true, "lock should complete to 'locked' after LOCK_TIME");
      tgt.x = 9000; // moved out of scanRange
      check(lockOn("a", ship) === false, "lockOn out of range should return false");
      check(getLock().status === "broken", "lock should break when target leaves scanRange");
      tgt.x = 300;
      check(lockOn("a", ship) === true && getLock().status === "locking", "re-entering range should re-acquire");
      clearLock();
      check(getLock().status === "none" && isLocked() === false, "clearLock should reset");

      // 2. lockOn accepts a target object directly (no targets array needed).
      check(lockOn({ id: "b", x: 100, y: 0 }, { x: 0, y: 0, scanRange: 200 }) === true, "object target in range");
      check(lockOn({ id: "b", x: 100, y: 0 }, { x: 0, y: 0, scanRange: 50 }) === false, "object target out of range");
      clearLock();

      // 3. applyDamage 3-layer worked example: laser-typed 16 to a full shield.
      var t3 = mkTarget("t3", 0, 0, 100, 80, 60);
      applyDamage(t3, 16, 6, 10);
      near(t3.hp.shield, 84, 1e-6, "shield should drop 100→84");
      check(t3.hp.armor === 80 && t3.hp.hull === 60, "no overflow while shield holds");
      check(t3._lastDamage.shieldHit && !t3._lastDamage.armorHit, "telemetry: shield-only hit");

      // 4. Penetrating overflow: a big shield-typed hit spills the surviving fraction to armor.
      var t4 = mkTarget("t4", 10, 0, 10, 80, 60);   // shield 10
      applyDamage(t4, 20, 20, 20);                  // shield eats 10 (penFrac .5) → armor takes 20*.5=10
      check(t4.hp.shield === 0, "shield should be depleted");
      near(t4.hp.armor, 70, 1e-6, "armor should take the surviving half (80→70)");

      // 5. Resist reduces damage; dead flag when hull reaches 0.
      var t5 = mkTarget("t5", 0, 0, 0, 0, 50); t5.hp.res.hull = 0.5;
      applyDamage(t5, 0, 0, 40);                    // 40 hull-typed × (1-.5) = 20
      near(t5.hp.hull, 30, 1e-6, "hull resist should halve the hit (50→30)");
      applyDamage(t5, 0, 0, 1000);
      check(t5.hp.hull === 0 && t5._lastDamage.dead, "hull to 0 sets dead");

      // 6. fireWeapon hit path: laser, forced normal hit → shield 100→84, fuel + tracer.
      initCombat();
      var shooter = { x: 0, y: 0, weaponDmg: 10, fuel: 100, fuelCostK: 1 };
      var target = mkTarget("z", 200, 0, 100, 80, 60);
      var laser = laserItem();
      var r6 = fireWeapon(laser, target, [target], shooter, { rng: seq([0.5, 0.5, 0.5]) });
      check(r6.ok && r6.hit && !r6.crit && !r6.glancing, "forced normal hit expected");
      near(target.hp.shield, 84, 1e-6, "laser hit should take shield 100→84");
      near(r6.damage, 16, 1e-6, "reported damage should be 16");
      near(shooter.fuel, 92, 1e-6, "fuel should drop by fuelPerShot (100→92)");
      check(getProjectiles().length === 1, "a tracer projectile should be queued");

      // 7. Crit (1.5×) and glancing (0.5×) multipliers; not stackable.
      initCombat();
      var tc = mkTarget("c", 200, 0, 1000, 0, 0);
      var rc = fireWeapon(laserItem(), tc, [tc], { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.1, 0.1]) });
      check(rc.crit && !rc.glancing, "forced crit expected");
      near(rc.damage, 24, 1e-6, "crit laser = 16×1.5 = 24");
      var tg = mkTarget("g", 200, 0, 1000, 0, 0);
      var rg = fireWeapon(laserItem(), tg, [tg], { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.5, 0.5, 0.1]) });
      check(rg.glancing && !rg.crit, "forced glancing expected");
      near(rg.damage, 8, 1e-6, "glancing laser = 16×0.5 = 8");

      // 8. Miss path: no damage, MISS floater spawned.
      initCombat();
      var tm = mkTarget("m", 200, 0, 100, 0, 0);
      var rm = fireWeapon(laserItem(), tm, [tm], { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.99]) });
      check(rm.ok && !rm.hit && rm.damage === 0, "forced miss deals no damage");
      check(tm.hp.shield === 100, "missed target keeps full shield");
      check(getFloaters().some(function (f) { return f.text === "MISS"; }), "MISS floater should spawn");

      // 9. Missile AoE: 40% of base per-layer damage to neighbours within 120 units.
      initCombat();
      var prim = mkTarget("p", 300, 0, 50, 0, 0);
      var near1 = mkTarget("n1", 350, 0, 50, 0, 0);  // 50 units from impact — inside AoE
      var far1 = mkTarget("f1", 600, 0, 50, 0, 0);   // 300 units — outside AoE
      var rmis = fireWeapon(missileItem(20), prim, [prim, near1, far1], { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.5, 0.5, 0.5]) });
      near(prim.hp.shield, 40, 1e-6, "missile primary: 50 - (10×1.0) = 40");
      near(near1.hp.shield, 46, 1e-6, "AoE neighbour: 50 - (10×0.4) = 46");
      check(far1.hp.shield === 50, "target outside AoE radius untouched");
      check(rmis.ammoLeft === 19, "missile ammo should decrement 20→19");

      // 10. Out of ammo: no shot, outOfAmmo flag.
      var empty = missileItem(0);
      var re = fireWeapon(empty, prim, [prim], { x: 0, y: 0, weaponDmg: 10 });
      check(!re.ok && re.outOfAmmo, "empty missile launcher reports outOfAmmo");

      // 11. Insufficient fuel blocks the shot (no ammo/fuel consumed).
      var rf = fireWeapon(laserItem(), prim, [prim], { x: 0, y: 0, weaponDmg: 10, fuel: 2, fuelCostK: 1 });
      check(!rf.ok && rf.reason === "insufficient fuel", "low fuel should block firing");

      // 12. updateProjectiles advances + expires tracers.
      initCombat();
      fireWeapon(laserItem(), mkTarget("q", 100, 0, 100, 0, 0), null, { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.5, 0.5, 0.5]) });
      check(getProjectiles().length === 1, "one tracer live");
      updateProjectiles(1.0);
      check(getProjectiles().length === 0, "tracer should expire after its ttl");

      // 13. onPlayerDeath: teleport home, -100 credits, restore layers, clear lock/projectiles.
      initCombat();
      lockOn({ id: "x", x: 10, y: 0 }, { x: 0, y: 0, scanRange: 100 });
      var player = { x: 999, y: 999, credits: 150, hp: { shield: 0, shieldMax: 100, armor: 0, armorMax: 80, hull: 0, hullMax: 60, res: {} } };
      var dr = onPlayerDeath(player, { x: 42, y: 7 });
      check(dr.newState === player, "onPlayerDeath returns the mutated state");
      check(player.x === 42 && player.y === 7, "ship should teleport to the home station");
      check(player.credits === 50, "death fee should deduct 100 credits (150→50)");
      check(player.hp.shield === 100 && player.hp.armor === 80 && player.hp.hull === 60, "layers should restore to max");
      check(getLock().status === "none" && getState().projectiles === 0, "death should clear lock + projectiles");
      check(player.respawn && respawnText(player) === "SHIP DESTROYED", "respawn overlay should start at SHIP DESTROYED");
      tickRespawn(player, 2.5);
      check(respawnText(player) === "WARPING TO BASE...", "overlay should flip to WARPING after 2s");
      check(Math.max(0, 0 - 100) === 0, "credit floor sanity");
      var poor = { credits: 40, hp: null };
      onPlayerDeath(poor, null);
      check(poor.credits === 0, "credits floor at 0");

      // 14. drawCombat is headless-safe and draws reticle/tracers (stub ctx).
      initCombat();
      lockOn({ id: "d", x: 100, y: 0 }, { x: 0, y: 0, scanRange: 500 });
      updateProjectiles(0.4);
      fireWeapon(laserItem(), { id: "d", x: 100, y: 0, hp: { shield: 100, armor: 0, hull: 0, res: {} } }, null, { x: 0, y: 0, weaponDmg: 10 }, { rng: seq([0.5, 0.5, 0.5]) });
      var ops = [];
      drawCombat(makeStubCtx(ops), { x: 0, y: 0, zoom: 1, offX: 195, offY: 350 }, { lockTarget: { id: "d", x: 100, y: 0, r: 20 } });
      check(ops.some(function (o) { return o[0] === "arc"; }), "drawCombat should draw the reticle arc");
      check(ops.some(function (o) { return o[0] === "stroke"; }), "drawCombat should stroke tracers/reticle");
      drawCombat(null, {}, {}); // headless no-op must not throw

      // 15. weaponCooldownMs honors rof (fireRate) and the 1200ms default.
      near(weaponCooldownMs(laserItem(), { fireRate: 1 }), 1200, 1e-6, "default cooldown 1200ms");
      near(weaponCooldownMs(laserItem(), { fireRate: 2 }), 600, 1e-6, "fireRate 2× halves cooldown");

      // 16. shipState combat modifiers (skill-tree hooks) override module defaults;
      //     omitting them preserves the original 0.92 hit / 0.15 crit / ×1 dmg behaviour.
      initCombat();
      var mtC = mkTarget("mtC", 200, 0, 1000, 0, 0);
      var rCrit = fireWeapon(laserItem(), mtC, [mtC], { x: 0, y: 0, weaponDmg: 10, critChance: 1 }, { rng: seq([0.5, 0.5]) });
      check(rCrit.crit === true, "critChance=1 should force a crit");
      var mtM = mkTarget("mtM", 200, 0, 100, 0, 0);
      var rMiss = fireWeapon(laserItem(), mtM, [mtM], { x: 0, y: 0, weaponDmg: 10, hitChance: 0 }, { rng: seq([0.5]) });
      check(!rMiss.hit && mtM.hp.shield === 100, "hitChance=0 should force a miss");
      var mtD = mkTarget("mtD", 200, 0, 1000, 0, 0);
      var rDmg = fireWeapon(laserItem(), mtD, [mtD], { x: 0, y: 0, weaponDmg: 10, dmgMultShield: 2 }, { rng: seq([0.5, 0.5, 0.5]) });
      near(rDmg.damage, 32, 1e-6, "dmgMultShield=2 should double laser shield damage 16→32");
      initCombat();
      var pA = mkTarget("pA", 300, 0, 50, 0, 0), nA = mkTarget("nA", 500, 0, 50, 0, 0);   // neighbour 200u from impact
      fireWeapon(missileItem(20), pA, [pA, nA], { x: 0, y: 0, weaponDmg: 10, aoeMult: 2 }, { rng: seq([0.5, 0.5, 0.5]) });
      check(nA.hp.shield < 50, "aoeMult=2 should extend splash to a 200u neighbour (radius 120→240)");
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    initCombat: initCombat,
    lockOn: lockOn,
    clearLock: clearLock,
    isLocked: isLocked,
    getLock: getLock,
    weaponCooldownMs: weaponCooldownMs,
    fireWeapon: fireWeapon,
    applyDamage: applyDamage,
    updateProjectiles: updateProjectiles,
    getProjectiles: getProjectiles,
    getFloaters: getFloaters,
    drawCombat: drawCombat,
    onPlayerDeath: onPlayerDeath,
    tickRespawn: tickRespawn,
    respawnText: respawnText,
    seedRng: seedRng,
    getState: getState,
    selfTest: selfTest,
    COL: COL
  };

  root.ForgeCombat = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
