/* forge/modules/faction.js — Forge alien factions: ship generation + squad AI.
 *
 * Global: ForgeFaction  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: the faction build request. Alien ships are generated with the SAME
 * equipment rules as the player (Shield/Armor/Hull layers, rolled item modules);
 * a faction just dictates which item bases roll into the loadout.
 *
 * Cross-module use is by GLOBAL only (never by reaching into private state):
 *   ForgeItemSystem.generateItem   — roll the same item instances the player gets
 *   ForgeEquipment.applyItemsToStats — stateless derivation over the alien's own
 *                                      item list (never touches the player fit rack)
 *   ForgeCombat.fireWeapon / weaponCooldownMs — aliens fire with the same rules
 * Under Node these are require()'d on demand so the module self-bootstraps for tests;
 * in a browser/inlined build the globals already exist and the require branch is dead.
 *
 * Key exports:
 *   initFactions()                                  → reset counters
 *   generateAlienShip(faction, tier, opts?)         → full alien object (hp, items, loot pool)
 *   generateGroup(faction, pos, opts?)              → { leader, followers, groupId }
 *   activateGroup(alienOrGroupId, allAliens)        → mark a squad ALERT (call on player lock-on)
 *   updateAlienAI(alien, playerState, allAliens, delta) → mutate alien; returns {state,fired,shot}
 *   getDrops(alien, opts?)                          → rolled loot items[] on death
 *   drawAlienShip(ctx, alien, camera)               → world-space ship sprite (no HUD)
 *   FACTIONS, getState(), selfTest()
 */
;(function (root) {
  "use strict";

  /* ── lazy cross-module handles (global first, Node require() fallback) ─────── */
  function IS() { return root.ForgeItemSystem || (typeof require !== "undefined" ? require("./item_system.js") : null); }
  function EQ() { return root.ForgeEquipment || (typeof require !== "undefined" ? require("./equipment_system.js") : null); }
  function CB() { return root.ForgeCombat || (typeof require !== "undefined" ? require("./combat.js") : null); }

  var TIER_ORDER = ["normal", "rare", "unique", "elite"];
  var ILVL_BY_TIER = { normal: 3, rare: 8, unique: 11, elite: 15 };
  var WEAPON_DMG = { normal: 8, rare: 11, unique: 13, elite: 15 };
  var DROP_CHANCE = { normal: 0.30, rare: 0.40, unique: 0.45, elite: 0.50 };
  // Ship CLASS + hull radius by tier — capability reads as size/shape. A leader
  // is the group's flagship (bumped a class up + bigger), so a squad reads as a
  // big carrier/cruiser escorted by little fighters. (drawn by rendering.js)
  var CLASS_BY_TIER = { normal: "fighter", rare: "raider", unique: "gunship", elite: "carrier" };
  var HULLR_BY_CLASS = { fighter: 12, raider: 16, gunship: 21, carrier: 28 };

  var BASE_SPEED = 120;   // world units/s at speedMul 1.0, thrust 100
  var SCATTER_TIME = 3;   // seconds followers scatter after their leader dies
  var DEFAULT_FIRE_MS = 1200;

  /* Three factions. base.* are the ship-theme stats from the build request; the
   * loadout() decides which item bases roll into each ship (same catalog the player
   * draws from). Where the request names a conceptual rig with no catalog base
   * ("shield capacity rig", "missile ammo rig", "damage rig") the effect is folded
   * into a real base (shield_extender / armor bases) or a direct stat (missileAmmo,
   * dmgMul) — documented inline. */
  var FACTIONS = {
    vex: {
      key: "vex", name: "Vex", weapon: "laser", color: "#4ad2ff", dmgMul: 0.7,
      base: { shield: 50, armor: 15, hull: 25, scanRange: 700, speedMul: 1.4, armorRes: 0.0, shieldRegen: 3, armorRepair: 0 },
      ranks: { normal: "Vex Scout", rare: "Vex Hunter", unique: "Vex Adept", elite: "Vex Commander" },
      behavior: "kite", priority: "lowShield", preferredRange: 450, retreatHull: 0
    },
    krag: {
      key: "krag", name: "Krag", weapon: "cannon", color: "#ffb040", dmgMul: 1.25, // "high damage" = the damage rig
      base: { shield: 40, armor: 140, hull: 80, scanRange: 500, speedMul: 0.7, armorRes: 0.1, shieldRegen: 0, armorRepair: 3 },
      ranks: { normal: "Krag Grunt", rare: "Krag Enforcer", unique: "Krag Breaker", elite: "Krag Warlord" },
      behavior: "advance", priority: "lowArmor", preferredRange: 250, retreatHull: 0
    },
    nox: {
      key: "nox", name: "Nox", weapon: "missile", color: "#57d1c9", dmgMul: 1.0, missileAmmo: 40, // the ammo rig
      base: { shield: 80, armor: 80, hull: 100, scanRange: 450, speedMul: 1.0, armorRes: 0.1, shieldRegen: 4, armorRepair: 0 },
      ranks: { normal: "Nox Drone", rare: "Nox Striker", unique: "Nox Warden", elite: "Nox Overlord" },
      behavior: "hold", priority: null, preferredRange: 300, retreatHull: 0.30
    }
  };

  function loadout(F, tier) {
    var L = [{ base: F.weapon, tier: tier }];               // weapon at the ship's tier
    var elitePlus = (tier === "elite" || tier === "unique");
    if (F.key === "vex") {
      L.push({ base: "shield_regen_module" });               // always
      if (elitePlus) L.push({ base: "shield_booster" });     // random shield booster (Elite)
      L.push({ base: "engine_booster" });                    // speed mod
      L.push({ base: "shield_extender" });                   // "shield capacity rig"
    } else if (F.key === "krag") {
      L.push({ base: "armor_repair_module" });               // always
      if (elitePlus) L.push({ base: "armor_plate" });        // armor plate (Unique+)
      L.push({ base: "armor_coating" });                     // "armor capacity rig" (resist)
    } else if (F.key === "nox") {
      L.push({ base: "fuel_cell_module" });                  // stays mobile
      L.push({ base: "hull_repair_module" });                // passive 5 hull / 10s
    }
    return L;
  }

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  var _count = 0, _gid = 0;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function dist(a, b) { return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)); }
  function normFaction(f) {
    if (!f) return null;
    if (FACTIONS[f]) return FACTIONS[f];
    var k = String(f).toLowerCase();
    return FACTIONS[k] || null;
  }
  function normTier(t) { return TIER_ORDER.indexOf(t) !== -1 ? t : "normal"; }

  /* ── ship generation ─────────────────────────────────────────────────────── */

  function generateAlienShip(faction, tier, opts) {
    opts = opts || {};
    var F = normFaction(faction);
    if (!F) throw new Error("ForgeFaction: unknown faction '" + faction + "'");
    tier = normTier(tier);
    var Items = IS(), Equip = EQ();
    if (!Items || !Equip) throw new Error("ForgeFaction: ForgeItemSystem + ForgeEquipment required");
    var rng = opts.rng || Math.random;
    var ilvl = opts.ilvl != null ? opts.ilvl : ILVL_BY_TIER[tier];

    // Roll the loadout as real item instances (these double as the loot pool).
    var items = loadout(F, tier).map(function (spec) {
      return Items.generateItem(spec.base, spec.tier || tier, { ilvl: ilvl, rng: rng });
    });
    var weapon = null;
    for (var i = 0; i < items.length; i++) if (items[i].weapon) { weapon = items[i]; break; }
    // Nox "missile ammo rig": aliens fight with limited missiles even though the
    // player's missile is unlimited (base ammo null) — the rig seeds the counter.
    if (F.key === "nox" && weapon && weapon.weapon && F.missileAmmo != null) {
      weapon.weapon.ammo = F.missileAmmo;
      weapon.ammo = F.missileAmmo;
    }

    // Derive stats from the faction base + the rolled items (same rules as player).
    var base = {
      shieldMax: F.base.shield, armorMax: F.base.armor, hullMax: F.base.hull,
      shieldRegen: F.base.shieldRegen, shieldDelay: 3.0, armorRepair: F.base.armorRepair,
      res: { shield: 0, armor: F.base.armorRes || 0, hull: 0 },
      scanRange: F.base.scanRange, thrust: 100, turnSpeed: 100,
      weaponDmg: WEAPON_DMG[tier] * (F.dmgMul || 1), fireRate: 1,
      fuelMax: 100, cargoMax: 20, oreYield: 1, miningSpeed: 1,
      tractorRange: 140, tractorStr: 1, fuelCostK: 1, cargoWeightK: 1, refineYield: 0
    };
    var d = Equip.applyItemsToStats(base, items);

    var hp = {
      shield: d.shieldMax, shieldMax: d.shieldMax,
      armor: d.armorMax, armorMax: d.armorMax,
      hull: d.hullMax, hullMax: d.hullMax,
      res: d.res,
      shieldRegen: d.shieldRegen, shieldDelay: d.shieldDelay, armorRepair: d.armorRepair,
      _sinceHit: 99
    };

    // Passive hull regen (Nox hull_repair_module): read amount/interval off the item.
    var hullRegenAmt = 0, hullRegenInterval = 10000;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.base === "hull_repair_module" && it.skill) {
        hullRegenAmt = it.skill.regen_amount != null ? it.skill.regen_amount : 5;
        hullRegenInterval = it.skill.cooldown_ms != null ? it.skill.cooldown_ms : 10000;
      }
    }

    var Combat = CB();
    var fireCdMax = Combat ? Combat.weaponCooldownMs(weapon, { fireRate: d.fireRate })
      : DEFAULT_FIRE_MS / (d.fireRate || 1);

    _count += 1;
    // capability → class → hull radius; a leader flies the flagship (one class up)
    var shipClass = CLASS_BY_TIER[tier] || "fighter";
    if (opts.isLeader) shipClass = { fighter: "raider", raider: "gunship", gunship: "carrier", carrier: "carrier" }[shipClass];
    var hullR = HULLR_BY_CLASS[shipClass] || 12;
    return {
      id: "npc_" + F.key + "_" + _count + "_" + Math.floor(rng() * 1e6).toString(36),
      faction: F.key, tier: tier, name: F.ranks[tier] || (F.name + " " + tier),
      color: F.color, kind: "alien", shipClass: shipClass, r: hullR,
      x: opts.x || 0, y: opts.y || 0, vx: 0, vy: 0, angle: 0,
      hp: hp,
      scanRange: d.scanRange, speed: F.base.speedMul * (d.thrust / 100),
      weaponDmg: d.weaponDmg, fireRate: d.fireRate,
      weapon: weapon, ammoMax: weapon && weapon.ammo != null ? weapon.ammo : null,
      items: items, ilvl: ilvl,
      state: "IDLE", groupId: opts.groupId || null, isLeader: !!opts.isLeader, aggro: false,
      behavior: F.behavior, targetPriority: F.priority,
      preferredRange: F.preferredRange, orbitRadius: opts.orbitRadius || 0, retreatHull: F.retreatHull || 0,
      _fireCd: 0, _fireCdMax: fireCdMax,
      _hullRegenAmt: hullRegenAmt, _hullRegenInterval: hullRegenInterval, _hullRegenAccum: 0,
      _scatterT: 0, _leaderDeadHandled: false, _jitter: (rng() - 0.5) * 1.2
    };
  }

  /* ── group formation ─────────────────────────────────────────────────────── */

  // A squad = 1 Rare/Elite leader (orbit 400) + 2–4 Normal followers (orbit 200–350).
  function generateGroup(faction, pos, opts) {
    opts = opts || {};
    var F = normFaction(faction);
    if (!F) throw new Error("ForgeFaction: unknown faction '" + faction + "'");
    pos = pos || { x: 0, y: 0 };
    var rng = opts.rng || Math.random;
    var tierRoll = rng() < 0.5 ? "rare" : "elite"; // always consume rng so call-site leaderTier opts don't shift the sequence
    var leaderTier = opts.leaderTier != null ? opts.leaderTier : tierRoll;
    var count = opts.followerCount != null ? opts.followerCount : (2 + Math.floor(rng() * 3)); // 2–4
    count = clamp(count, 2, 4);
    _gid += 1;
    var groupId = "grp_" + F.key + "_" + _gid;

    var leader = generateAlienShip(faction, leaderTier, { rng: rng, x: pos.x, y: pos.y, groupId: groupId, isLeader: true, ilvl: opts.ilvl });
    leader.orbitRadius = 400;

    var followers = [];
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var f = generateAlienShip(faction, "normal", {
        rng: rng, x: pos.x + Math.cos(a) * 60, y: pos.y + Math.sin(a) * 60,
        groupId: groupId, isLeader: false, ilvl: opts.ilvl
      });
      // spread followers evenly across the 200–350 orbit band
      f.orbitRadius = count > 1 ? Math.round(200 + (150 * i) / (count - 1)) : 275;
      followers.push(f);
    }
    return { leader: leader, followers: followers, groupId: groupId };
  }

  // Player locked ANY member → the whole squad wakes and pathfinds toward the player.
  function activateGroup(alienOrId, allAliens) {
    var gid = (alienOrId && typeof alienOrId === "object") ? alienOrId.groupId : alienOrId;
    var n = 0;
    if (alienOrId && typeof alienOrId === "object" && !gid) { // solo alien, no squad
      if (alienOrId.state !== "DEAD") { alienOrId.state = "ALERT"; alienOrId.aggro = true; n = 1; }
      return n;
    }
    (allAliens || []).forEach(function (a) {
      if (a && a.groupId === gid && a.state !== "DEAD") { a.state = "ALERT"; a.aggro = true; n++; }
    });
    return n;
  }

  /* ── AI ──────────────────────────────────────────────────────────────────── */

  function regenTick(alien, delta, dtMs) {
    var hp = alien.hp; if (!hp) return;
    hp._sinceHit = (hp._sinceHit || 0) + delta;
    if (hp.shieldRegen > 0 && hp._sinceHit >= (hp.shieldDelay || 3))
      hp.shield = Math.min(hp.shieldMax, hp.shield + hp.shieldRegen * delta);
    if (hp.armorRepair > 0)
      hp.armor = Math.min(hp.armorMax, hp.armor + hp.armorRepair * delta);
    if (alien._hullRegenAmt > 0) {
      alien._hullRegenAccum += dtMs;
      while (alien._hullRegenAccum >= alien._hullRegenInterval) {
        alien._hullRegenAccum -= alien._hullRegenInterval;
        hp.hull = Math.min(hp.hullMax, hp.hull + alien._hullRegenAmt);
      }
    }
  }

  // Heavy-body avoidance. When the game tags an alien with `_avoid` (a list of
  // {x,y,r} circles — the site chunks it should flank around), blend a repulsion
  // into the pursuit heading so it curves around cover instead of grinding into
  // it. Each near chunk contributes an outward push plus a one-handed tangential
  // swirl so a head-on approach deflects to a side rather than stalling. Renormal-
  // ized to full speed → the alien still commits, just along a curved path. No
  // `_avoid` (all non-site combat) → returns null and the caller is unchanged.
  var AV = (typeof CONFIG !== "undefined" && CONFIG) ? CONFIG : {};
  function avoidBlend(alien, vx, vy, speed) {
    var list = alien && alien._avoid;
    if (!list || !list.length || speed <= 0) return null;
    var pad = AV.avoidPad || 150, tang = AV.avoidTangent || 0.9, wt = AV.avoidWeight || 1.5;
    var ax = 0, ay = 0, any = false;
    for (var i = 0; i < list.length; i++) {
      var c = list[i], dx = alien.x - c.x, dy = alien.y - c.y;
      var d = Math.hypot(dx, dy) || 0.001, reach = c.r + pad;
      if (d >= reach) continue;
      var strength = (reach - d) / pad; if (strength > 1) strength = 1;
      var nx = dx / d, ny = dy / d;
      ax += nx * strength; ay += ny * strength;                  // outward from the chunk
      ax += -ny * strength * tang; ay += nx * strength * tang;   // swirl → flank, no stall
      any = true;
    }
    if (!any) return null;
    var bx = vx / speed + ax * wt, by = vy / speed + ay * wt;
    var bl = Math.hypot(bx, by) || 1;
    return { vx: bx / bl * speed, vy: by / bl * speed };
  }

  function steerTo(alien, tx, ty, speed, delta) {
    var dx = tx - alien.x, dy = ty - alien.y, d = Math.hypot(dx, dy) || 1;
    alien.vx = dx / d * speed; alien.vy = dy / d * speed;
    var av = avoidBlend(alien, alien.vx, alien.vy, speed);
    if (av) { alien.vx = av.vx; alien.vy = av.vy; }
    alien.x += alien.vx * delta; alien.y += alien.vy * delta;
    if (d > 1) alien.angle = Math.atan2(dy, dx);
  }

  // Maintain a preferred distance from the player: close in if too far, back off if
  // too close (kiting), orbit tangentially inside the dead-band. Always faces player.
  function holdRange(alien, px, py, desired, speed, delta) {
    var dx = alien.x - px, dy = alien.y - py, d = Math.hypot(dx, dy) || 1;
    var ux = dx / d, uy = dy / d;
    var err = d - desired, mx, my;
    if (Math.abs(err) > 20) { var rdir = err > 0 ? -1 : 1; mx = ux * rdir; my = uy * rdir; }
    else { mx = -uy; my = ux; }                              // tangential orbit
    var m = Math.hypot(mx, my) || 1;
    alien.vx = mx / m * speed; alien.vy = my / m * speed;
    var av = avoidBlend(alien, alien.vx, alien.vy, speed);
    if (av) { alien.vx = av.vx; alien.vy = av.vy; }
    alien.x += alien.vx * delta; alien.y += alien.vy * delta;
    alien.angle = Math.atan2(py - alien.y, px - alien.x);
  }

  function findLeaderAlive(allAliens, gid) {
    if (!allAliens || !gid) return null;
    for (var i = 0; i < allAliens.length; i++) {
      var a = allAliens[i];
      if (a && a.groupId === gid && a.isLeader && a.state !== "DEAD" && a.hp && a.hp.hull > 0) return a;
    }
    return null;
  }

  function nearestNebula(alien, player) {
    var list = player && player.nebulae;
    if (!list || !list.length) return null;
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) { var d = dist(alien, list[i]); if (d < bd) { bd = d; best = list[i]; } }
    return best;
  }

  function tryFire(alien, target) {
    var Combat = CB();
    if (!Combat || alien._fireCd > 0) return { fired: false, shot: null };
    var w = alien.weapon, range = (w && w.weapon && w.weapon.range) || 0;
    if (!target || dist(alien, target) > range) return { fired: false, shot: null };
    var shot = Combat.fireWeapon(w, target, [target], { x: alien.x, y: alien.y, weaponDmg: alien.weaponDmg, fireRate: alien.fireRate });
    if (shot && shot.ok) { alien._fireCd = alien._fireCdMax; return { fired: true, shot: shot }; }
    return { fired: false, shot: shot };
  }

  // Advance one alien: regen, state machine, movement, and (in COMBAT) firing.
  // delta is seconds. Mutates alien; returns { state, fired, shot, scattering? }.
  function updateAlienAI(alien, playerState, allAliens, delta) {
    if (!alien) return null;
    delta = delta || 0;
    var dtMs = delta * 1000;
    var player = playerState || { x: 0, y: 0 };

    if (alien.hp && alien.hp.hull <= 0) { alien.state = "DEAD"; alien.vx = 0; alien.vy = 0; return { state: "DEAD", fired: false, shot: null }; }

    regenTick(alien, delta, dtMs);
    alien._fireCd -= dtMs;

    // Leader-death scatter: first frame the leader is gone, scatter for SCATTER_TIME.
    if (!alien.isLeader && alien.groupId && alien.state !== "IDLE" && alien.state !== "DEAD") {
      if (!findLeaderAlive(allAliens, alien.groupId) && !alien._leaderDeadHandled) {
        alien._scatterT = SCATTER_TIME; alien._leaderDeadHandled = true;
      }
    }
    if (alien._scatterT > 0) alien._scatterT = Math.max(0, alien._scatterT - delta);

    var speed = BASE_SPEED * (alien.speed || 1);

    if (alien._scatterT > 0) {   // flee erratically away from the player, then resume
      var sa = Math.atan2(alien.y - player.y, alien.x - player.x) + (alien._jitter || 0);
      steerTo(alien, alien.x + Math.cos(sa) * 300, alien.y + Math.sin(sa) * 300, speed, delta);
      return { state: alien.state, scattering: true, fired: false, shot: null };
    }

    var fired = false, shot = null;
    var dp = dist(alien, player);
    var desired = alien.orbitRadius || alien.preferredRange;

    switch (alien.state) {
      case "IDLE":
        break;                                   // dormant until activateGroup wakes it
      case "ALERT":
        alien.state = "APPROACH";
        steerTo(alien, player.x, player.y, speed, delta);
        break;
      case "APPROACH":
        if (dp <= desired + 80) alien.state = "COMBAT";
        else steerTo(alien, player.x, player.y, speed, delta);
        break;
      case "COMBAT":
        if (alien.retreatHull > 0 && alien.hp.hull / alien.hp.hullMax < alien.retreatHull) { alien.state = "RETREAT"; break; }
        holdRange(alien, player.x, player.y, desired, speed, delta);
        var r = tryFire(alien, player);
        fired = r.fired; shot = r.shot;
        break;
      case "RETREAT":
        if (alien.hp.hull / alien.hp.hullMax >= alien.retreatHull + 0.10) { alien.state = "COMBAT"; break; }
        var nb = nearestNebula(alien, player);
        if (nb) steerTo(alien, nb.x, nb.y, speed, delta);
        else { var fa = Math.atan2(alien.y - player.y, alien.x - player.x); steerTo(alien, alien.x + Math.cos(fa) * 400, alien.y + Math.sin(fa) * 400, speed, delta); }
        break;
      default: break;
    }
    return { state: alien.state, fired: fired, shot: shot };
  }

  /* ── loot ────────────────────────────────────────────────────────────────── */

  // Each equipped item rolls its drop chance (by ship tier); dropped items re-roll
  // at the ship's tier or one tier lower (50/50).
  function getDrops(alien, opts) {
    opts = opts || {};
    var Items = IS();
    if (!Items || !alien || !alien.items) return [];
    var rng = opts.rng || Math.random;
    var chance = DROP_CHANCE[alien.tier] != null ? DROP_CHANCE[alien.tier] : 0.30;
    var shipIdx = TIER_ORDER.indexOf(alien.tier); if (shipIdx < 0) shipIdx = 0;
    var out = [];
    alien.items.forEach(function (it) {
      if (rng() >= chance) return;
      var idx = rng() < 0.5 ? shipIdx : Math.max(0, shipIdx - 1);
      out.push(Items.generateItem(it.base, TIER_ORDER[idx], { ilvl: alien.ilvl, rng: rng, faction: alien.faction }));
    });
    return out;
  }

  /* ── drawing (world-space ship only — never HUD) ─────────────────────────── */

  function project(camera, wx, wy) {
    var c = camera || {}, z = c.zoom || 1;
    return { x: (wx - (c.x || 0)) * z + (c.offX || 0), y: (wy - (c.y || 0)) * z + (c.offY || 0) };
  }

  function drawAlienShip(ctx, alien, camera) {
    if (!ctx || !alien) return;
    var z = (camera && camera.zoom) || 1;
    var p = project(camera, alien.x, alien.y);
    var s = 12 * z;
    var ang = alien.angle || 0;
    // hull triangle
    ctx.save && ctx.save();
    ctx.fillStyle = alien.color || "#e8edf4";
    ctx.strokeStyle = "#0d1017";
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(ang) * s, p.y + Math.sin(ang) * s);
    ctx.lineTo(p.x + Math.cos(ang + 2.5) * s, p.y + Math.sin(ang + 2.5) * s);
    ctx.lineTo(p.x + Math.cos(ang - 2.5) * s, p.y + Math.sin(ang - 2.5) * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // shield ring proportional to remaining shield
    var hp = alien.hp || {};
    if (hp.shieldMax > 0) {
      ctx.globalAlpha = 0.6 * clamp((hp.shield || 0) / hp.shieldMax, 0, 1);
      ctx.strokeStyle = "#4ad2ff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, s + 4 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // hull bar + name for leaders / damaged ships
    var barW = 26 * z;
    ctx.fillStyle = "#1c2430";
    ctx.fillRect(p.x - barW / 2, p.y - s - 8 * z, barW, 3 * z);
    ctx.fillStyle = "#ff5060";
    ctx.fillRect(p.x - barW / 2, p.y - s - 8 * z, barW * clamp((hp.hull || 0) / (hp.hullMax || 1), 0, 1), 3 * z);
    if (alien.isLeader) {
      ctx.fillStyle = alien.color || "#e8edf4";
      ctx.font = "bold " + Math.max(1, Math.round(8 * z)) + "px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(alien.name || alien.faction, p.x, p.y - s - 11 * z);
    }
    ctx.restore && ctx.restore();
  }

  /* ── inspection ──────────────────────────────────────────────────────────── */

  function initFactions() { _count = 0; _gid = 0; return getState(); }
  function getState() { return { factions: Object.keys(FACTIONS).length, generated: _count, groups: _gid }; }

  /* ── selfTest ────────────────────────────────────────────────────────────── */

  function makeStubCtx(ops) {
    var names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
      "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect",
      "clearRect", "fillText", "strokeText", "clip", "setLineDash"];
    var c = {};
    names.forEach(function (n) { c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); }; });
    return c;
  }
  function seedRng(seed) {
    var t = seed >>> 0;
    return function () { t = (t + 0x6D2B79F5) >>> 0; var r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    try {
      if (!IS() || !EQ()) { return ["FAIL: ForgeItemSystem + ForgeEquipment must load before faction"]; }
      initFactions();
      var rng = seedRng(4242);

      // 1. Vex: fast/fragile/high-shield, laser, shield capacity boosted by extender.
      var vex = generateAlienShip("vex", "normal", { rng: rng, x: 0, y: 0 });
      check(vex.faction === "vex" && vex.name === "Vex Scout", "vex name/faction wrong: " + vex.name);
      check(vex.weapon && vex.weapon.weapon && vex.weapon.weapon.type === "laser", "vex should carry a laser");
      check(Math.abs(vex.hp.shieldMax - 60) < 1e-6, "vex shieldMax = 50×1.2 (extender) = 60, got " + vex.hp.shieldMax);
      check(vex.hp.armorMax === 15 && vex.hp.hullMax === 25, "vex armor/hull base wrong");
      check(vex.scanRange === 700, "vex scanRange should be 700, got " + vex.scanRange);
      check(vex.speed > 1.4, "engine booster should push vex speed above the 1.4 base, got " + vex.speed);
      check(vex.state === "IDLE" && vex.hp.shield === vex.hp.shieldMax, "new ship starts IDLE at full shield");

      // 2. Krag: heavily armored, cannon, resist above base, high damage (damage rig).
      var krag = generateAlienShip("krag", "elite", { rng: rng });
      check(krag.weapon.weapon.type === "cannon", "krag should carry a cannon");
      check(krag.hp.armorMax > 140, "krag armor should exceed 140 with plate+affixes, got " + krag.hp.armorMax);
      check(krag.hp.res.armor > 0.1, "krag armor resist should exceed the 0.1 base (coating), got " + krag.hp.res.armor);
      check(krag.weaponDmg > WEAPON_DMG.elite, "krag damage rig (dmgMul) should raise weaponDmg, got " + krag.weaponDmg);
      check(krag.hp.armorRepair >= 3, "krag should have an armor repair rate");

      // 3. Nox: missile with the 40-ammo rig + passive hull regen module.
      var nox = generateAlienShip("nox", "rare", { rng: rng });
      check(nox.weapon.weapon.type === "missile", "nox should carry a missile");
      check(nox.weapon.ammo === 40 && nox.ammoMax === 40, "nox missile ammo rig should start at 40, got " + nox.weapon.ammo);
      check(nox.hp.hullMax === 100, "nox hull base should be 100");
      check(nox._hullRegenAmt === 5 && nox._hullRegenInterval === 10000, "nox should regen 5 hull / 10s");
      check(nox.items.some(function (i) { return i.base === "hull_repair_module"; }), "nox loadout must include the hull repair module");

      // 4. Passive hull regen actually ticks (5 hull every 10s).
      nox.hp.hull = 50;
      updateAlienAI(nox, { x: 99999, y: 0 }, [], 10);  // 10 s elapsed, out of range → no combat
      check(nox.hp.hull === 55, "nox hull should regen 50→55 after 10s, got " + nox.hp.hull);

      // 5. Group: 1 elite leader (orbit 400) + N normal followers (orbit 200–350), shared id.
      var grp = generateGroup("vex", { x: 0, y: 0 }, { rng: seedRng(7), leaderTier: "elite", followerCount: 3 });
      check(grp.leader.isLeader && grp.leader.tier === "elite" && grp.leader.orbitRadius === 400, "leader wrong");
      check(grp.followers.length === 3, "should spawn 3 followers");
      check(grp.followers.every(function (f) { return f.groupId === grp.groupId && !f.isLeader && f.orbitRadius >= 200 && f.orbitRadius <= 350; }),
        "followers should share groupId and orbit 200–350: " + grp.followers.map(function (f) { return f.orbitRadius; }));

      // 6. activateGroup wakes the whole squad on a single lock-on.
      var squad = [grp.leader].concat(grp.followers);
      check(activateGroup(grp.followers[0], squad) === 4, "locking one member should wake all 4");
      check(squad.every(function (a) { return a.state === "ALERT" && a.aggro; }), "all squad members should be ALERT");

      // 7. AI progression ALERT → APPROACH → COMBAT, and it fires once in range.
      var player = { id: "player", x: 300, y: 0, hp: { shield: 200, shieldMax: 200, armor: 100, armorMax: 100, hull: 100, hullMax: 100, res: { shield: 0, armor: 0, hull: 0 } } };
      var lead = grp.leader; lead.x = 2000; lead.y = 0; lead.state = "ALERT";
      var sawApproach = false, sawCombat = false, everFired = false;
      for (var t = 0; t < 240; t++) {
        var ev = updateAlienAI(lead, player, squad, 1 / 30);
        if (ev.state === "APPROACH") sawApproach = true;
        if (ev.state === "COMBAT") sawCombat = true;
        if (ev.fired) everFired = true;
      }
      check(sawApproach, "leader should pass through APPROACH");
      check(sawCombat, "leader should reach COMBAT");
      check(everFired, "leader should fire in COMBAT (combat.js present)");
      check(player.hp.shield < 200, "player should have taken alien fire, shield=" + player.hp.shield);

      // 8. Nox RETREAT when hull < 30%, fleeing toward the nearest nebula.
      var noxR = generateAlienShip("nox", "normal", { rng: seedRng(3), x: 500, y: 0 });
      noxR.state = "COMBAT"; noxR._hullRegenAmt = 0; // isolate movement from regen
      noxR.hp.hull = noxR.hp.hullMax * 0.2;
      var pl2 = { x: 0, y: 0, nebulae: [{ x: 5000, y: 0 }] };
      var evR = updateAlienAI(noxR, pl2, [noxR], 0.5);   // COMBAT → RETREAT (transition frame)
      check(evR.state === "RETREAT", "low-hull nox should RETREAT, got " + evR.state);
      var before = noxR.x;
      updateAlienAI(noxR, pl2, [noxR], 0.5);             // now flee toward the nebula
      check(noxR.x > before, "retreating nox should move toward the nebula (away from player at origin)");

      // 9. Leader death → followers scatter for ~3s, then resume.
      var grp2 = generateGroup("krag", { x: 0, y: 0 }, { rng: seedRng(11), leaderTier: "rare", followerCount: 2 });
      var squad2 = [grp2.leader].concat(grp2.followers);
      squad2.forEach(function (a) { a.state = "COMBAT"; });
      grp2.leader.hp.hull = 0;
      updateAlienAI(grp2.leader, { x: 0, y: 0 }, squad2, 0.1); // leader → DEAD
      var fol = grp2.followers[0];
      var evS = updateAlienAI(fol, { x: 0, y: 0 }, squad2, 0.1);
      check(evS.scattering === true && fol._scatterT > 0, "follower should scatter when leader dies");
      for (var s = 0; s < 40; s++) updateAlienAI(fol, { x: 0, y: 0 }, squad2, 0.1); // 4s
      check(fol._scatterT === 0, "scatter should end after ~3s");

      // 10. getDrops: forced drops re-roll from the ship's own item bases at valid tiers.
      var dropAll = getDrops(krag, { rng: function () { return 0; } }); // rng 0 → always drop, same tier
      check(dropAll.length === krag.items.length, "rng<chance should drop every item, got " + dropAll.length);
      check(dropAll.every(function (d) { return krag.items.some(function (it) { return it.base === d.base; }) && TIER_ORDER.indexOf(d.tier) !== -1; }),
        "drops must come from the ship's bases at valid tiers");
      var dropNone = getDrops(krag, { rng: function () { return 0.99; } });
      check(dropNone.length === 0, "rng>chance should drop nothing");

      // 11. dead ship: AI returns DEAD, halts.
      var dead = generateAlienShip("vex", "normal", { rng: seedRng(1) });
      dead.hp.hull = 0;
      check(updateAlienAI(dead, player, [], 0.1).state === "DEAD", "hull 0 → DEAD");

      // 12. drawAlienShip headless-safe.
      var ops = [];
      drawAlienShip(makeStubCtx(ops), grp.leader, { x: 0, y: 0, zoom: 1, offX: 195, offY: 350 });
      check(ops.some(function (o) { return o[0] === "fill"; }), "drawAlienShip should fill the hull");
      drawAlienShip(null, grp.leader, {}); // headless no-op

      // 13. Unknown faction throws; getState counts.
      var threw = false; try { generateAlienShip("zorg", "normal"); } catch (e) { threw = true; }
      check(threw, "unknown faction should throw");
      check(getState().factions === 3, "there should be 3 factions");
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    }
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    initFactions: initFactions,
    generateAlienShip: generateAlienShip,
    generateGroup: generateGroup,
    activateGroup: activateGroup,
    updateAlienAI: updateAlienAI,
    getDrops: getDrops,
    drawAlienShip: drawAlienShip,
    FACTIONS: FACTIONS,
    getState: getState,
    selfTest: selfTest
  };

  root.ForgeFaction = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
