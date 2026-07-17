/* forge/modules/equipment_system.js — Forge flat-slot fit manager (v4.1).
 *
 * Global: ForgeEquipment  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: forge/SYSTEMS_SPEC.md §1.9 (stat application).
 *
 * v4.1 UI revamp: the old High/Mid/Low/Rig/Skill slot groups are gone. The rack is
 * now a single flat array of 6 GENERIC slots — any item fits any slot, no slot-type
 * validation. An item is "activatable" (a skill button) automatically when it carries
 * an active descriptor: item.skill (repair/regen loop) or item.weapon (auto-fire).
 *
 * Key exports:
 *   initEquipment(slotCount=6)       → reset to a flat array of `slotCount` empty slots
 *   equip(slotIndex, item)           → {ok, index, swapped} — puts item in slots[0..n-1]
 *   unequip(slotIndex)               → {ok, index, item} — removes and returns the item
 *   getEquipped()                    → { slots: [ …6 items or null ] }
 *   getActiveStats(baseStats)        → derived ship stat block (every slot, any category)
 *   applyItemsToStats(baseStats, items) → stateless derivation (aliens build their own fits)
 *   activateSkill(i) / deactivateSkill(i) → start / stop the active loop on ANY slot 0..n-1
 *   tickSkills(deltaMs, shipState)   → advance skill cooldowns, fire skill_fn (mutates shipState)
 *   getSkillState()                  → [{item,active,cooldownRemaining,cooldownTotal} ×slotCount]
 *   fireWeapon(i, targetPos, ship)   → {ok, projectile} for the weapon in slots[i]
 *   restockAmmo(i?)                  → refill ammo-limited weapons (station restock)
 *   getState(), selfTest()
 */
;(function (root) {
  "use strict";

  var SLOT_COUNT = 6;   // flat generic rack: any item type fits any slot

  /* attribute key → ship-stat mutation. Generic stat schema; unknown affix keys
   * (game-specific stats the engine doesn't model) are ignored, not fatal.
   * unit: flat|perSec|pct; attrs affecting res.* are additive fractions capped at 0.75. */
  var ATTRS = {
    shield_cap_pct:    { affects: "shieldMax",    unit: "pct",    dir: 1 },
    shield_regen:      { affects: "shieldRegen",  unit: "perSec", dir: 1 },
    shield_regen_pct:  { affects: "shieldRegen",  unit: "pct",    dir: 1 },
    shield_resist:     { affects: "res.shield",   unit: "pct",    dir: 1 },
    shield_delay_pct:  { affects: "shieldDelay",  unit: "pct",    dir: -1 },
    armor_hp:          { affects: "armorMax",     unit: "flat",   dir: 1 },
    armor_hp_pct:      { affects: "armorMax",     unit: "pct",    dir: 1 },
    armor_resist:      { affects: "res.armor",    unit: "pct",    dir: 1 },
    armor_repair:      { affects: "armorRepair",  unit: "perSec", dir: 1 },
    hull_hp:           { affects: "hullMax",      unit: "flat",   dir: 1 },
    hull_hp_pct:       { affects: "hullMax",      unit: "pct",    dir: 1 },
    hull_resist:       { affects: "res.hull",     unit: "pct",    dir: 1 },
    damage_pct:        { affects: "weaponDmg",    unit: "pct",    dir: 1 },
    rof_pct:           { affects: "fireRate",     unit: "pct",    dir: 1 },
    scan_range_pct:    { affects: "scanRange",    unit: "pct",    dir: 1 },
    weapon_range_pct:  { affects: "weaponRange",  unit: "pct",    dir: 1 },
    tractor_range_pct: { affects: "tractorRange", unit: "pct",    dir: 1 },
    tractor_str_pct:   { affects: "tractorStr",   unit: "pct",    dir: 1 },
    tractor_slots_flat:{ affects: "tractorSlots", unit: "flat",   dir: 1 },
    fuel_eff_pct:      { affects: "fuelCostK",    unit: "pct",    dir: -1 },
    fuel_cap_pct:      { affects: "fuelMax",      unit: "pct",    dir: 1 },
    solar_regen:       { affects: "solarRegen",   unit: "perSec", dir: 1 },
    thrust_pct:        { affects: "thrust",       unit: "pct",    dir: 1 },
    turn_pct:          { affects: "turnSpeed",    unit: "pct",    dir: 1 }
  };

  var RESIST_CAP = 0.75;

  /* Baseline ship stat block used only when getActiveStats is called without one;
   * games normally pass their own base (Space Hauler passes CONFIG.baseShip). */
  var DEFAULT_BASE = {
    shieldMax: 1500, shieldRegen: 75, shieldDelay: 3.0,
    armorMax: 1200, armorRepair: 0,
    hullMax: 900,
    res: { shield: 0.0, armor: 0.15, hull: 0.0 },
    fuelMax: 1500, solarRegen: 2,
    thrust: 100, turnSpeed: 100,
    scanRange: 900,
    tractorRange: 140, tractorStr: 1, tractorSlots: 1,
    fuelCostK: 1,
    weaponDmg: 10, fireRate: 1, weaponRange: 0
  };

  var state = { slots: null, skills: null };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* An item is "activatable" — i.e. it becomes a skill button — when it carries an
   * active descriptor: a skill loop (item.skill) OR an auto-fire weapon (item.weapon). */
  function isActivatable(item) { return !!(item && (item.skill || item.weapon)); }

  /* ── skill helpers (activatable "skill"-slot modules) ─────────────────────────
   * A skill item carries item.skill = { skill_fn, cooldown_ms, regen_amount|fuel_amount }.
   * skill_fn is a STRING KEY resolved here to a real function that mutates the ship
   * state directly. Per-item affixes (skill_amount_pct, skill_cooldown_pct) tune it. */

  function specialSum(item, key) {
    var t = 0;
    ((item && item.specials) || []).forEach(function (s) { if (s.key === key) t += s.val; });
    return t;
  }

  function skillAmount(item) {
    var sk = (item && item.skill) || {};
    var base = sk.regen_amount != null ? sk.regen_amount : (sk.fuel_amount != null ? sk.fuel_amount : 0);
    return base * (1 + specialSum(item, "skill_amount_pct") / 100);
  }

  // Cooldown in ms after skill_cooldown_pct reduction (dir −1); floored at 1ms.
  // Weapons (no item.skill) have no skill cooldown here (0) — combat.js clocks them.
  function skillCooldown(item) {
    var sk = (item && item.skill);
    if (!sk) return 0;
    var base = sk.cooldown_ms != null ? sk.cooldown_ms : 0;
    var cd = base * (1 - specialSum(item, "skill_cooldown_pct") / 100);
    return cd > 1 ? cd : 1;
  }

  var SKILL_FNS = {
    // Restore shield toward shieldMax.
    shield_regen: function (item, ship) {
      var cap = ship.shieldMax != null ? ship.shieldMax : Infinity;
      ship.shield = Math.min(cap, (ship.shield || 0) + skillAmount(item));
    },
    // Restore armor toward armorMax.
    armor_repair: function (item, ship) {
      var cap = ship.armorMax != null ? ship.armorMax : Infinity;
      ship.armor = Math.min(cap, (ship.armor || 0) + skillAmount(item));
    },
    // Restore fuel toward fuelMax.
    fuel_cell: function (item, ship) {
      var cap = ship.fuelMax != null ? ship.fuelMax : Infinity;
      ship.fuel = Math.min(cap, (ship.fuel || 0) + skillAmount(item));
    },
    // Restore hull toward hullMax (hull otherwise never passively regens).
    hull_repair: function (item, ship) {
      var cap = ship.hullMax != null ? ship.hullMax : Infinity;
      ship.hull = Math.min(cap, (ship.hull || 0) + skillAmount(item));
    }
  };

  function emptySkill() { return { item: null, active: false, cooldownRemaining: 0, cooldownTotal: 0 }; }

  // Fresh runtime skill slot for a just-fitted item (inactive, ready to fire).
  function skillFor(item) {
    if (!isActivatable(item)) return emptySkill();
    return { item: item, active: false, cooldownRemaining: 0, cooldownTotal: skillCooldown(item) };
  }

  function initEquipment(slotCount) {
    var n = (slotCount != null && slotCount > 0) ? (slotCount | 0) : SLOT_COUNT;
    state.slots = new Array(n).fill(null);
    state.skills = new Array(n).fill(null).map(emptySkill);
    return getEquipped();
  }

  function ensureInit() { if (!state.slots) initEquipment(); }

  function inRange(i) { return typeof i === "number" && i >= 0 && i < state.slots.length; }

  // Put an item in slots[slotIndex] (0..n-1). Any item fits any slot — no validation.
  function equip(slotIndex, item) {
    ensureInit();
    if (!item) return { ok: false, reason: "no item" };
    if (!inRange(slotIndex)) return { ok: false, reason: "slot index " + slotIndex + " out of range (0.." + (state.slots.length - 1) + ")" };
    var prev = state.slots[slotIndex];
    state.slots[slotIndex] = item;
    state.skills[slotIndex] = skillFor(item);   // (re)seed the runtime skill slot
    return { ok: true, index: slotIndex, swapped: prev || null };
  }

  // Remove and return the item in slots[slotIndex]. With no index, clears the first
  // occupied slot (keeps parity with the old convenience form).
  function unequip(slotIndex) {
    ensureInit();
    var i = slotIndex;
    if (i == null) {
      i = -1;
      for (var j = 0; j < state.slots.length; j++) if (state.slots[j]) { i = j; break; }
      if (i === -1) return { ok: false, reason: "nothing equipped" };
    } else if (!inRange(i)) {
      return { ok: false, reason: "slot index " + i + " out of range" };
    } else if (!state.slots[i]) {
      return { ok: false, reason: "slot " + i + " is empty" };
    }
    var item = state.slots[i];
    state.slots[i] = null;
    state.skills[i] = emptySkill();   // stop any running skill / auto-fire
    return { ok: true, index: i, item: item };
  }

  function getEquipped() {
    ensureInit();
    return { slots: state.slots.slice() };
  }

  function allEquipped() {
    ensureInit();
    return state.slots.filter(function (it) { return !!it; });
  }

  /* ── stat application (spec §1.9) ─────────────────────────────────────────
   * Apply order, deterministic: (1) flat adds, (2) perSec + resist adds,
   * (3) pct multipliers last. base_stats apply the same way as specials.
   * pct: stat *= (1 + val/100), dir −1 attrs use (1 − val/100).
   * resist attrs are additive fractions (val/100), hard-capped at 0.75. */

  function getPath(obj, path) {
    var parts = path.split("."), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, val) {
    var parts = path.split("."), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function attrPhase(a) {
    if (a.affects.indexOf("res.") === 0) return "resist";
    if (a.unit === "flat") return "flat";
    if (a.unit === "perSec") return "perSec";
    return "pct";
  }

  function collectMods(items) {
    var mods = [];
    items.forEach(function (it) {
      var bs = it.base_stats || {};
      Object.keys(bs).forEach(function (k) { mods.push({ key: k, val: bs[k] }); });
      (it.specials || []).forEach(function (s) { mods.push({ key: s.key, val: s.val }); });
    });
    return mods;
  }

  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  function roundStats(obj) {
    Object.keys(obj).forEach(function (k) {
      if (typeof obj[k] === "number") obj[k] = round6(obj[k]);
      else if (obj[k] && typeof obj[k] === "object") roundStats(obj[k]);
    });
  }

  /* Stateless derivation: apply an explicit item list to a base stat block
   * (spec §1.9). getActiveStats is the singleton wrapper over the player's fit;
   * other systems (e.g. faction.js building alien ships) call this directly with
   * their own item list so they never touch the shared player rack. */
  function applyItemsToStats(baseStats, items) {
    var derived = clone(baseStats || DEFAULT_BASE);
    if (!derived.res) derived.res = { shield: 0, armor: 0, hull: 0 };

    var mods = collectMods(items || []);
    var phases = { flat: [], perSec: [], resist: [], pct: [] };
    mods.forEach(function (m) {
      var a = ATTRS[m.key];
      if (!a) return; // unknown keys are ignored, not fatal
      phases[attrPhase(a)].push({ a: a, val: m.val });
    });

    phases.flat.forEach(function (m) {
      setPath(derived, m.a.affects, (getPath(derived, m.a.affects) || 0) + m.val);
    });
    phases.perSec.forEach(function (m) {
      setPath(derived, m.a.affects, (getPath(derived, m.a.affects) || 0) + m.val);
    });
    phases.resist.forEach(function (m) {
      var cur = (getPath(derived, m.a.affects) || 0) + m.val / 100;
      setPath(derived, m.a.affects, Math.min(RESIST_CAP, cur));
    });
    phases.pct.forEach(function (m) {
      var factor = m.a.dir < 0 ? (1 - m.val / 100) : (1 + m.val / 100);
      setPath(derived, m.a.affects, (getPath(derived, m.a.affects) || 0) * factor);
    });

    if (!derived.res) derived.res = { shield: 0, armor: 0, hull: 0 };
    ["shield", "armor", "hull"].forEach(function (layer) {
      if (derived.res[layer] > RESIST_CAP) derived.res[layer] = RESIST_CAP;
    });
    roundStats(derived);
    return derived;
  }

  function getActiveStats(baseStats) {
    ensureInit();
    return applyItemsToStats(baseStats, allEquipped());
  }

  function getState() {
    ensureInit();
    var fitted = allEquipped().length;
    var active = state.skills.filter(function (sk) { return sk && sk.item; }).length;
    return { slots: state.slots.length, fitted: fitted, active: active, total: fitted };
  }

  /* ── skill loop (spec: activate → fire → cooldown → refire while active) ──────
   * Every slot can be activated. A slot holding a skill module runs its repair/regen
   * loop off tickSkills; a slot holding a weapon just flips its active (auto-fire)
   * flag — combat.js drives the actual shots. Contract:
   *   activateSkill   → marks the slot active. A fresh slot has cooldownRemaining 0,
   *                     so the next tick fires immediately.
   *   tickSkills(dt)  → decrements cooldownRemaining on active skill slots; on hitting
   *                     0 it runs skill_fn(item, shipState) and re-arms cooldownTotal.
   *   deactivateSkill → clears active; the loop / auto-fire stops. */

  function activateSkill(slotIndex) {
    ensureInit();
    var sk = state.skills[slotIndex];
    if (!sk || !sk.item) return { ok: false, reason: "no active module in slot " + slotIndex };
    sk.active = true;
    return { ok: true, index: slotIndex };
  }

  function deactivateSkill(slotIndex) {
    ensureInit();
    var sk = state.skills[slotIndex];
    if (!sk || !sk.item) return { ok: false, reason: "no active module in slot " + slotIndex };
    sk.active = false;
    return { ok: true, index: slotIndex };
  }

  // Advance every active SKILL slot's cooldown; fire skill_fn when it elapses. Weapon
  // slots have no skill_fn so they are ignored here (combat.js fires them). Returns the
  // list of slot indices that fired this tick (drives HUD pulses / sfx game-side).
  function tickSkills(deltaMs, shipState) {
    ensureInit();
    var fired = [];
    for (var i = 0; i < state.skills.length; i++) {
      var sk = state.skills[i];
      if (!sk || !sk.item || !sk.active || !sk.item.skill) continue;
      sk.cooldownRemaining -= deltaMs;
      if (sk.cooldownRemaining <= 0) {
        var desc = sk.item.skill;
        // Fuel-gated skills (repairs) cost fuel to fire and draw the shared pool.
        // If the ship can't afford it, skip WITHOUT re-arming — retry next tick.
        var fcost = desc.fuel_cost || 0;
        if (fcost > 0 && shipState && shipState.fuel != null) {
          var fk = shipState.fuelCostK != null ? shipState.fuelCostK : 1;
          var need = round6(fcost * fk);
          if (shipState.fuel < need) continue;
          shipState.fuel = round6(shipState.fuel - need);
        }
        var fn = SKILL_FNS[desc.skill_fn];
        if (fn && shipState) { fn(sk.item, shipState); fired.push(i); }
        sk.cooldownRemaining = sk.cooldownTotal;
      }
    }
    return fired;
  }

  // Read-only snapshot of every slot's runtime skill state (for the HUD).
  function getSkillState() {
    ensureInit();
    return state.skills.map(function (sk) {
      return sk ? {
        item: sk.item, active: sk.active,
        cooldownRemaining: sk.cooldownRemaining, cooldownTotal: sk.cooldownTotal
      } : emptySkill();
    });
  }

  /* ── weapons (active offense) ─────────────────────────────────────────────────
   * fireWeapon(slotIndex, targetPos, shipState) resolves the weapon in slots[slotIndex],
   * gates on ammo (missiles) and fuel, consumes both, and returns a projectile. Games
   * usually route combat through ForgeCombat; this is the self-contained fallback. */

  function fireWeapon(slotIndex, targetPos, shipState) {
    ensureInit();
    var item = state.slots[slotIndex];
    if (!item || !item.weapon) {
      return { ok: false, reason: "no weapon in slot " + slotIndex, projectile: null };
    }
    var w = item.weapon, ship = shipState || {};
    var ammoLimited = (w.ammo != null);
    if (ammoLimited && (item.ammo == null || item.ammo <= 0)) {
      return { ok: false, reason: "out of ammo", projectile: null };
    }

    var fuelCostK = ship.fuelCostK != null ? ship.fuelCostK : 1;
    var fuelCost = round6(w.fuelPerShot * fuelCostK);
    if (ship.fuel != null && ship.fuel < fuelCost) {
      return { ok: false, reason: "insufficient fuel", projectile: null };
    }

    // Consume resources.
    if (ship.fuel != null) ship.fuel = round6(ship.fuel - fuelCost);
    if (ammoLimited) item.ammo -= 1;

    var baseDmg = ship.weaponDmg != null ? ship.weaponDmg : 10;
    var rangeBonus = specialSum(item, "weapon_range_pct") / 100;
    var aoeBonus = specialSum(item, "aoe_radius_pct") / 100;

    var projectile = {
      type: w.type,
      from: { x: ship.x || 0, y: ship.y || 0 },
      to: targetPos ? { x: targetPos.x, y: targetPos.y } : null,
      x: ship.x || 0, y: ship.y || 0,
      dmgShield: round6(baseDmg * w.dmgShield),
      dmgArmor: round6(baseDmg * w.dmgArmor),
      dmgHull: round6(baseDmg * w.dmgHull),
      range: round6(w.range * (1 + rangeBonus)),
      aoe: round6(w.aoe * (1 + aoeBonus)),
      fuelCost: fuelCost,
      ammoLeft: ammoLimited ? item.ammo : null,
      sourceId: item.id
    };
    return { ok: true, projectile: projectile };
  }

  // Refill ammo-limited weapons (missiles) to their max — the station restock.
  // Pass a slotIndex to restock one slot; omit to restock all.
  function restockAmmo(slotIndex) {
    ensureInit();
    for (var i = 0; i < state.slots.length; i++) {
      if (slotIndex != null && i !== slotIndex) continue;
      var it = state.slots[i];
      if (it && it.weapon && it.weapon.ammo != null) it.ammo = it.weapon.ammo;
    }
  }

  /* ── selfTest ────────────────────────────────────────────────────────────── */

  function mkItem(base, base_stats, specials) {
    return {
      id: "t_" + base + "_" + Math.floor(Math.random() * 1e6),
      base: base, cat: "test", tier: "rare", name: base,
      ilvl: 1, base_stats: base_stats || {}, specials: specials || [], value: 1
    };
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    try {
      // 1. Flat rack: default is 6 empty slots; getEquipped exposes .slots.
      initEquipment();
      check(getEquipped().slots.length === 6, "default rack should be 6 slots, got " + getEquipped().slots.length);
      check(getEquipped().slots.every(function (x) { return x === null; }), "fresh rack must be all null");

      // 2. Spec §1.9 invariant: +20% shield_cap on a 100-shield ship → 120; unequip → 100.
      var base = { shieldMax: 100, armorMax: 80, hullMax: 60, res: { shield: 0, armor: 0.15, hull: 0 }, fuelCostK: 1 };
      var ext = mkItem("shield_extender", { shield_cap_pct: 20 });
      var r = equip(0, ext);
      check(r.ok && r.index === 0, "equip slot 0 failed: " + JSON.stringify(r));
      check(getActiveStats(base).shieldMax === 120, "shieldMax should be exactly 120, got " + getActiveStats(base).shieldMax);
      var u = unequip(0);
      check(u.ok && u.item === ext, "unequip should return the item");
      check(getActiveStats(base).shieldMax === 100, "shieldMax should restore to 100");
      check(base.shieldMax === 100 && base.res.armor === 0.15, "baseStats must not be mutated");

      // 3. Any item fits any slot — no slot-type validation; bad index / null still fail.
      initEquipment();
      var mid = mkItem("shield_extender", { shield_cap_pct: 20 });
      var high = mkItem("test_util", { scan_range_pct: 25 });
      check(equip(5, mid).ok === true, "a 'mid' item must fit slot 5 (no slot typing)");
      check(equip(3, high).ok === true, "a 'high' item must fit slot 3 (no slot typing)");
      check(equip(6, mid).ok === false, "index 6 must be out of range");
      check(equip(-1, mid).ok === false, "negative index must fail");
      check(equip(0, null).ok === false, "null item must fail");

      // 4. Every occupied slot contributes stats regardless of category.
      initEquipment();
      equip(0, mkItem("armor_plate", { armor_hp: 40 }));
      equip(4, mkItem("fuel_cell", { fuel_cap_pct: 50 }));
      var d = getActiveStats(base);
      check(d.armorMax === 120, "armor from slot 0 should apply: expected 120, got " + d.armorMax);
      check(getState().fitted === 2 && getState().slots === 6, "getState counts wrong: " + JSON.stringify(getState()));

      // 5. equip swaps the occupant of a filled slot.
      initEquipment();
      var a1 = mkItem("shield_booster", { shield_regen: 6 });
      var a2 = mkItem("afterburner", { thrust_pct: 30 });
      equip(1, a1);
      var sw = equip(1, a2);
      check(sw.ok && sw.swapped === a1, "re-equipping a filled slot should return the old occupant");
      check(getEquipped().slots[1] === a2, "slot 1 should now hold the new item");

      // 6. Apply order: flat before pct → (80 + 40) × 1.5 = 180.
      initEquipment();
      equip(0, mkItem("armor_plate", { armor_hp: 40 }, [{ key: "armor_hp_pct", val: 50 }]));
      check(getActiveStats(base).armorMax === 180, "apply order broken: expected (80+40)*1.5=180, got " + getActiveStats(base).armorMax);

      // 7. Resists are additive fractions, hard-capped at 0.75.
      initEquipment();
      equip(0, mkItem("shield_hardener", { shield_resist: 30 }));
      equip(1, mkItem("shield_hardener", { shield_resist: 30 }));
      equip(2, mkItem("shield_hardener", { shield_resist: 30 }));
      check(getActiveStats(base).res.shield === 0.75, "resist must cap at 0.75, got " + getActiveStats(base).res.shield);

      // 8. dir −1 pct reduces the stat: −10% fuel cost → fuelCostK 0.9.
      initEquipment();
      equip(0, mkItem("fuel_cell", {}, [{ key: "fuel_eff_pct", val: 10 }]));
      check(getActiveStats(base).fuelCostK === 0.9, "fuel_eff_pct should reduce fuelCostK to 0.9, got " + getActiveStats(base).fuelCostK);

      // 9. perSec adds: shield_regen 6 base + 2 special on default block (regen 75) → 83.
      initEquipment();
      equip(0, mkItem("shield_booster", { shield_regen: 6 }, [{ key: "shield_regen", val: 2 }]));
      check(getActiveStats().shieldRegen === 83, "perSec adds wrong: expected 83, got " + getActiveStats().shieldRegen);

      // 10. getEquipped returns a snapshot, not live state.
      initEquipment();
      equip(0, mkItem("turret", { damage_pct: 20 }));
      var snap = getEquipped();
      snap.slots[0] = null;
      check(getEquipped().slots[0] !== null, "getEquipped must be a snapshot");
      check(unequip(0).ok === true, "unequip by index failed");
      check(unequip(0).ok === false, "unequip of empty slot must fail");

      // 11. Skill slot: any slot activates. A skill module ticks; activate → tick fires
      //     skill_fn → deactivate stops the loop.
      initEquipment();
      var regen = mkItem("shield_regen_module", {});
      regen.cat = "shield";
      regen.skill = { skill_fn: "shield_regen", cooldown_ms: 3000, regen_amount: 15 };
      var esk = equip(2, regen);   // put it in a middle slot to prove "any slot"
      check(esk.ok && esk.index === 2, "equip skill failed: " + JSON.stringify(esk));
      check(getSkillState()[2].item === regen && getSkillState()[2].cooldownTotal === 3000,
        "skill runtime slot should hold the module with its cooldown");
      var ship = { shield: 50, shieldMax: 100, armor: 40, armorMax: 80, fuel: 30, fuelMax: 100 };
      check(tickSkills(3000, ship).length === 0 && ship.shield === 50, "inactive skill must not fire");
      activateSkill(2);
      var fired = tickSkills(3000, ship);
      check(fired.indexOf(2) !== -1 && ship.shield === 65,
        "shield_regen should fire once and add 15 (50→65), got shield=" + ship.shield);
      ship.shield = 95;
      tickSkills(3000, ship);
      check(ship.shield === 100, "shield regen must cap at shieldMax, got " + ship.shield);
      deactivateSkill(2);
      ship.shield = 50;
      var fired2 = tickSkills(3000, ship);
      check(fired2.length === 0 && ship.shield === 50, "deactivated skill must not fire, shield=" + ship.shield);
      // skill_amount_pct affix scales the amount: 10 base +50% = 15 armor.
      initEquipment();
      var arep = mkItem("armor_repair_module", {}, [{ key: "skill_amount_pct", val: 50 }]);
      arep.skill = { skill_fn: "armor_repair", cooldown_ms: 5000, regen_amount: 10 };
      equip(0, arep);
      activateSkill(0);
      var ashipe = { armor: 0, armorMax: 80 };
      tickSkills(5000, ashipe);
      check(ashipe.armor === 15, "skill_amount_pct +50% should make armor_repair heal 15, got " + ashipe.armor);

      // 12. A weapon is activatable too: getSkillState exposes it, activate flips its
      //     auto-fire flag, but tickSkills never "fires" a weapon (no skill_fn).
      initEquipment();
      var wpn = mkItem("laser", {});
      wpn.cat = "weapons";
      wpn.weapon = { type: "laser", dmgShield: 1.6, dmgArmor: 0.6, dmgHull: 1.0, range: 600, fuelPerShot: 8, aoe: 0, ammo: null };
      equip(1, wpn);
      check(getSkillState()[1].item === wpn, "weapon slot should surface as an activatable skill");
      activateSkill(1);
      check(getSkillState()[1].active === true, "activating a weapon slot should set active");
      check(tickSkills(9000, { shield: 0, shieldMax: 100 }).length === 0, "tickSkills must never fire a weapon slot");
      deactivateSkill(1);
      check(getSkillState()[1].active === false, "deactivating a weapon slot should clear active");

      // 13. Fire a laser: damage profile + fuel cost, fuel deducted from ship.
      initEquipment();
      var laser = mkItem("laser", {});
      laser.cat = "weapons";
      laser.weapon = { type: "laser", dmgShield: 1.6, dmgArmor: 0.6, dmgHull: 1.0, range: 600, fuelPerShot: 8, aoe: 0, ammo: null };
      equip(0, laser);
      var wship = { weaponDmg: 10, fuel: 100, fuelCostK: 1, x: 0, y: 0 };
      var shot = fireWeapon(0, { x: 300, y: 0 }, wship);
      check(shot.ok && shot.projectile, "fireWeapon should return a projectile");
      check(shot.projectile.type === "laser", "projectile type should be laser");
      check(shot.projectile.dmgShield === 16 && shot.projectile.dmgArmor === 6 && shot.projectile.dmgHull === 10,
        "laser damage profile wrong: " + JSON.stringify(shot.projectile));
      check(shot.projectile.range === 600 && shot.projectile.aoe === 0 && shot.projectile.fuelCost === 8,
        "laser range/aoe/fuel wrong: " + JSON.stringify(shot.projectile));
      check(wship.fuel === 92, "fireWeapon should deduct fuel (100-8=92), got " + wship.fuel);
      var wship2 = { weaponDmg: 10, fuel: 100, fuelCostK: 0.5 };
      check(fireWeapon(0, null, wship2).projectile.fuelCost === 4, "fuelCostK 0.5 should halve fuel cost to 4");

      // 14. Missile is ammo-limited; fireWeapon decrements and refuses when empty; restock refills.
      initEquipment();
      var missile = mkItem("missile", {});
      missile.cat = "weapons";
      missile.weapon = { type: "missile", dmgShield: 1.0, dmgArmor: 1.0, dmgHull: 1.0, range: 400, fuelPerShot: 3, aoe: 120, ammo: 2 };
      missile.ammo = 2;
      equip(0, missile);
      var mship = { weaponDmg: 10, fuel: 100, fuelCostK: 1 };
      var s1 = fireWeapon(0, { x: 0, y: 0 }, mship);
      check(s1.ok && s1.projectile.aoe === 120 && s1.projectile.ammoLeft === 1, "missile shot 1 → aoe 120, 1 ammo left");
      var s2 = fireWeapon(0, { x: 0, y: 0 }, mship);
      check(s2.ok && s2.projectile.ammoLeft === 0, "missile shot 2 → 0 ammo left");
      var s3 = fireWeapon(0, { x: 0, y: 0 }, mship);
      check(s3.ok === false && s3.projectile === null, "missile fire with 0 ammo must fail");
      restockAmmo();
      check(missile.ammo === 2, "restockAmmo should refill the missile to 2");

      // 15. fireWeapon on an empty or non-weapon slot fails cleanly.
      initEquipment();
      check(fireWeapon(0, { x: 0, y: 0 }, {}).ok === false, "fireWeapon on empty slot must fail");
      equip(0, mkItem("test_util", { scan_range_pct: 25 }));
      check(fireWeapon(0, { x: 0, y: 0 }, {}).ok === false, "fireWeapon on a non-weapon module must fail");

      // 16. Custom slot count.
      initEquipment(4);
      check(getEquipped().slots.length === 4, "custom slot count not applied");
      check(equip(3, mkItem("turret", {})).ok === true && equip(4, mkItem("turret", {})).ok === false,
        "custom rack should accept index 3 but reject 4");
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.message));
    }
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    initEquipment: initEquipment,
    equip: equip,
    unequip: unequip,
    getActiveStats: getActiveStats,
    applyItemsToStats: applyItemsToStats,
    getEquipped: getEquipped,
    activateSkill: activateSkill,
    deactivateSkill: deactivateSkill,
    tickSkills: tickSkills,
    getSkillState: getSkillState,
    fireWeapon: fireWeapon,
    restockAmmo: restockAmmo,
    getState: getState,
    selfTest: selfTest,
    isActivatable: isActivatable,
    SLOT_COUNT: SLOT_COUNT,
    DEFAULT_BASE: DEFAULT_BASE
  };

  root.ForgeEquipment = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
