/* forge/modules/item_system.js — Forge item generation engine.
 *
 * Global: ForgeItemSystem  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: forge/SYSTEMS_SPEC.md §1.
 *
 * The engine ships with NO game content — only a tiny SYNTH_DB fixture so it can
 * self-test standalone. A game supplies its real catalogue with
 * ForgeItemSystem.loadDB(json) at boot (Space Hauler does this in main.js from
 * src/content/catalog.js). All item names, stats, and drop tables are game data.
 *
 * Weapon bases carry a `weapon` damage/ballistics profile and skill modules carry
 * a `skill` descriptor; generateItem() clones these onto the item so the equipment
 * system can fire weapons / run activatable skills off the instance.
 *
 * Key exports:
 *   generateItem(baseType, tier?, opts?)  → item instance (tier omitted = weighted roll)
 *   rollTier(sourceType, opts?)           → { baseType, tier } from drop_map + tier weights
 *   rollDrop(sourceType, opts?)           → full rolled item from a junk-sprite source
 *   getItemValue(item)                    → credits (spec §1.6 value formula)
 *   describeItem(item)                    → [{text, color}] tooltip lines (spec §4.5)
 *   loadDB(json), rarityColor(tier), TIERS, PATHS, DROP_MAP, ORE, uid, seedRng,
 *   getState(), selfTest()
 */
;(function (root) {
  "use strict";

  /* ── Synthetic default fixture (NOT game content) ─────────────────────────────
   * Generic bases/attributes with placeholder names so the engine self-tests
   * without any game catalogue loaded. loadDB() replaces this wholesale. */
  var SYNTH_DB = {
    "_meta": {
      "version": 0,
      "tiers": {
        "normal": { "specials": [0, 0], "weight": 100, "valueMult": 1.0, "color": "#e8edf4" },
        "rare":   { "specials": [1, 2], "weight": 34,  "valueMult": 1.8, "color": "#5c8cff" },
        "unique": { "specials": [2, 3], "weight": 10,  "valueMult": 3.2, "color": "#ffd24a" },
        "elite":  { "specials": [4, 5], "weight": 3,   "valueMult": 6.0, "color": "#ff7a3c" }
      }
    },
    "bases": {
      "test_mod":    { "cat": "test", "slot": "mid", "name": "Test Module", "base_value": 80, "stats": { "stat_a_pct": 20 }, "affix_pool": ["stat_a_pct", "stat_b_flat", "stat_c_pct", "fx_eff_pct", "stat_d_ps"], "drop_from": ["src_x"] },
      "test_small":  { "cat": "test", "slot": "low", "name": "Test Small",  "base_value": 60, "stats": { "stat_b_flat": 10 }, "affix_pool": ["stat_a_pct", "stat_b_flat"], "drop_from": ["src_x"] },
      "test_weapon": { "cat": "weapons", "slot": "high", "name": "Test Blaster", "base_value": 140, "stats": {}, "weapon": { "type": "laser", "dmgShield": 1.6, "dmgArmor": 0.6, "dmgHull": 1.0, "range": 600, "fuelPerShot": 8, "aoe": 0, "ammo": null, "fireRate_ms": 400, "projSpeed": 1600, "color": "#4ad2ff" }, "affix_pool": ["stat_c_pct", "fx_eff_pct"], "drop_from": [] },
      "test_pod":    { "cat": "weapons", "slot": "high", "name": "Test Pod", "base_value": 150, "stats": {}, "weapon": { "type": "missile", "dmgShield": 1.0, "dmgArmor": 1.0, "dmgHull": 1.0, "range": 400, "fuelPerShot": 3, "aoe": 120, "ammo": 20 }, "affix_pool": ["stat_c_pct"], "drop_from": [] },
      "test_skill":  { "cat": "test", "slot": "skill", "name": "Test Skill", "base_value": 90, "stats": {}, "skill": { "skill_fn": "shield_regen", "cooldown_ms": 3000, "regen_amount": 15 }, "affix_pool": ["stat_amt_pct", "stat_cd_pct"], "drop_from": [] }
    },
    "attributes": {
      "stat_a_pct":  { "label": "+% Stat A", "unit": "pct",    "dir": 1,  "affects": "statA", "path": "path_x", "step": 1,   "range": { "normal": [0,0], "rare": [6,12],  "unique": [10,18], "elite": [16,26] } },
      "stat_b_flat": { "label": "+Stat B",   "unit": "flat",   "dir": 1,  "affects": "statB", "path": "path_x", "step": 5,   "range": { "normal": [0,0], "rare": [15,35], "unique": [30,60], "elite": [50,100] } },
      "stat_c_pct":  { "label": "+% Stat C", "unit": "pct",    "dir": 1,  "affects": "statC", "path": null,     "step": 1,   "range": { "normal": [0,0], "rare": [8,18],  "unique": [15,30], "elite": [26,48] } },
      "stat_d_ps":   { "label": "Stat D",    "unit": "perSec", "dir": 1,  "affects": "statD", "path": "path_x", "step": 0.5, "range": { "normal": [0,0], "rare": [2,4],   "unique": [3,6],   "elite": [5,9] } },
      "fx_eff_pct":  { "label": "-% FX Cost","unit": "pct",    "dir": -1, "affects": "fxK",   "path": null,     "step": 1,   "range": { "normal": [0,0], "rare": [5,12],  "unique": [10,20], "elite": [17,30] } },
      "stat_amt_pct":{ "label": "+% Skill Amount",   "unit": "pct", "dir": 1,  "affects": "skillAmount",   "path": null, "step": 1, "range": { "normal": [0,0], "rare": [8,16], "unique": [14,26], "elite": [22,40] } },
      "stat_cd_pct": { "label": "-% Skill Cooldown", "unit": "pct", "dir": -1, "affects": "skillCooldown", "path": null, "step": 1, "range": { "normal": [0,0], "rare": [6,12], "unique": [10,20], "elite": [16,28] } }
    },
    "drop_map": { "src_x": ["test_mod", "test_small"], "src_w": [{ "base": "test_mod", "w": 9 }, { "base": "test_small", "w": 1 }] },
    "ore": {},
    "paths": {
      "path_x": { "label": "Path X", "color": "#4ad2ff", "attrs": ["stat_a_pct", "stat_b_flat", "stat_d_ps"], "bases": ["test_mod", "test_small"] }
    }
  };

  var DB = SYNTH_DB;

  var TIER_ORDER = ["normal", "rare", "unique", "elite"];

  var COL = { ink: "#e8edf4", dim: "#9aa7b8", good: "#7bd88f", gold: "#ffd24a" };

  /* Name generation vocabulary (spec §1.6): prefix by dominant special path,
   * elite gets a proper-noun suffix. Names stay ≤ 34 chars. Path keys are looked
   * up leniently — an unknown path falls back to the neutral prefix set. */
  var PREFIXES = {
    shield_tank:  ["Reinforced", "Aegis", "Bulwark", "Charged", "Warden's", "Resonant", "Phase", "Prismatic"],
    armor_tank:   ["Fortified", "Bastion", "Ironclad", "Tempered", "Riveted", "Plated", "Hardened", "Annealed"],
    hauler:       ["Cavernous", "Hauler's", "Freighter", "Deep-Hold", "Long-Haul", "Wide-Bore", "Heavy-Lift", "Industrial"],
    _none:        ["Calibrated", "Tuned", "Surplus", "Modified", "Field-Tested", "Salvaged", "Custom", "Overclocked", "Refurbished", "Prototype"],
    vex:          ["Precision", "Focused", "Phase", "Directive", "Vector", "Null-Point", "Refined", "Surgical"],
    krag:         ["Scrap-Forged", "Breach", "Slag", "Bolted", "Welded", "Jury-Rigged", "Brute", "Scorched"],
    nox:          ["Resonance", "Hollow", "Pulse", "Living", "Echo", "Woven", "Grown", "Murmur"]
  };
  var ELITE_SUFFIXES = ["of the Void", "Kessler-pattern", "of the Belt", "Mk.X", "Prime", "of the Rim", "Mk.VII", "Apex", "Zero-Point", "Mk.IV", "of the Deep", "Ascendant"];
  var FACTION_SUFFIXES = {
    vex:  ["Pattern IV", "Directive", "Protocol", "Array"],
    krag: ["Mk.II", "Rig", "Mod", "Breaker"],
    nox:  ["Bloom", "Choir", "Weave", "Scream"]
  };
  var NAME_MAX = 34;

  /* ── helpers ──────────────────────────────────────────────────────────────── */

  var _uidCounter = 0;
  function uid() {
    _uidCounter += 1;
    return "it_" + _uidCounter.toString(36) + Math.floor(Math.random() * 1679616).toString(36);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function randInt(lo, hi, rng) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  function pickN(arr, n, rng) {
    var copy = arr.slice(), out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    return out;
  }

  function weightedPick(weights, order, rng) {
    var total = 0, i;
    for (i = 0; i < order.length; i++) total += weights[order[i]];
    var r = rng() * total;
    for (i = 0; i < order.length; i++) {
      r -= weights[order[i]];
      if (r < 0) return order[i];
    }
    return order[order.length - 1];
  }

  /* Deterministic RNG for tests / seeded rolls (mulberry32). */
  function seedRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── rolling ──────────────────────────────────────────────────────────────── */

  function tierWeights(ilvl) {
    return {
      normal: 100,
      rare:   34 + ilvl * 1.5,
      unique: 10 + ilvl * 0.8,
      elite:  3  + ilvl * 0.35
    };
  }

  // Weighted tier pick (spec §1.6). Higher ilvl nudges rarity up.
  function rollTierName(ilvl, rng) {
    return weightedPick(tierWeights(ilvl || 0), TIER_ORDER, rng || Math.random);
  }

  // rollTier(sourceType): what drops from a junk-sprite source. Picks a base type
  // from DB.drop_map[sourceType] and a weighted tier. baseType is null for unknown
  // sources (tier still rolls, so rollTier(null, {ilvl}) doubles as a plain tier roll).
  // A drop_map pool entry is either a base-key string (weight 1) or { base, w }.
  // Weighted so a game can bias a loot table (e.g. skew junk toward weapons).
  function poolBase(entry) { return (entry && typeof entry === "object") ? entry.base : entry; }
  function pickPool(pool, rng) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += (typeof pool[i] === "object" ? (pool[i].w || 1) : 1);
    var r = rng() * total;
    for (i = 0; i < pool.length; i++) {
      r -= (typeof pool[i] === "object" ? (pool[i].w || 1) : 1);
      if (r < 0) return poolBase(pool[i]);
    }
    return poolBase(pool[pool.length - 1]);
  }
  function rollTier(sourceType, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var pool = DB.drop_map[sourceType];
    return {
      baseType: (pool && pool.length) ? pickPool(pool, rng) : null,
      tier: rollTierName(opts.ilvl == null ? 1 : opts.ilvl, rng)
    };
  }

  // Uniform roll in the attribute's per-tier range, rounded to step, clamped.
  function rollAttr(key, tier, rng) {
    var a = DB.attributes[key];
    if (!a) throw new Error("ForgeItemSystem: unknown attribute '" + key + "'");
    var range = a.range[tier] || [0, 0];
    rng = rng || Math.random;
    var v = range[0] + rng() * (range[1] - range[0]);
    v = Math.round(v / a.step) * a.step;
    v = clampNum(v, range[0], range[1]);
    return Math.round(v * 100) / 100;
  }

  function priceOf(base, tier, specials, ilvl) {
    return Math.round(
      base.base_value *
      DB._meta.tiers[tier].valueMult *
      (1 + 0.04 * (ilvl || 0)) *
      (1 + 0.10 * (specials ? specials.length : 0))
    );
  }

  function dominantPath(specials) {
    var counts = {}, best = null, bestN = 0;
    (specials || []).forEach(function (s) {
      var a = DB.attributes[s.key];
      var p = a && a.path;
      if (!p) return;
      counts[p] = (counts[p] || 0) + 1;
      if (counts[p] > bestN) { bestN = counts[p]; best = p; }
    });
    return { path: best, count: bestN };
  }

  function makeName(base, tier, specials, rng, opts) {
    var baseName = (opts && opts.variantName)
      || ((base.names && base.names.length) ? pick(base.names, rng) : base.name);
    if (tier === "normal") return baseName;
    var dom = dominantPath(specials).path;
    var faction = (opts && opts.faction) || base.faction;
    var pool = (faction && PREFIXES[faction]) || PREFIXES[dom] || PREFIXES._none;
    var name = pick(pool, rng) + " " + baseName;
    if (tier === "elite") {
      var spool = (faction && FACTION_SUFFIXES[faction]) || ELITE_SUFFIXES;
      var withSuffix = name + " " + pick(spool, rng);
      if (withSuffix.length <= NAME_MAX) name = withSuffix;
    }
    if (name.length > NAME_MAX) name = baseName;
    return name;
  }

  /* generateItem(baseType, tier?, opts?) — the procedural roll (spec §1.6).
   * opts: { ilvl=1, rng=Math.random }. tier null/undefined → weighted roll. */
  function generateItem(baseType, tier, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var ilvl = opts.ilvl == null ? 1 : opts.ilvl;
    var base = DB.bases[baseType];
    if (!base) throw new Error("ForgeItemSystem: unknown base type '" + baseType + "'");
    tier = tier || rollTierName(ilvl, rng);
    if (!DB._meta.tiers[tier]) throw new Error("ForgeItemSystem: unknown tier '" + tier + "'");

    var variant = (base.variants && base.variants.length) ? pick(base.variants, rng) : null;
    var nameOpts = variant ? { faction: opts.faction, variantName: variant.name } : opts;

    var lohi = DB._meta.tiers[tier].specials;
    var n = Math.min(randInt(lohi[0], lohi[1], rng), base.affix_pool.length);
    var specials = pickN(base.affix_pool, n, rng).map(function (k) {
      return { key: k, val: rollAttr(k, tier, rng) };
    });

    var item = {
      id: uid(),
      base: baseType,
      slot: base.slot,
      cat: base.cat,
      tier: tier,
      name: makeName(base, tier, specials, rng, nameOpts),
      ilvl: ilvl,
      base_stats: clone(base.stats),
      specials: specials,
      value: priceOf(base, tier, specials, ilvl)
    };

    // Weapon bases carry a ballistics/damage profile (dmgShield/dmgArmor/dmgHull,
    // range, fuelPerShot, aoe, ammo, fireRate_ms, projSpeed, color); it rides on
    // the instance for firing. Ammo-limited weapons seed a live ammo counter.
    if (base.weapon) {
      item.weapon = clone(base.weapon);
      if (variant && variant.mods) {
        var m = variant.mods;
        for (var k in m) if (m.hasOwnProperty(k)) {
          var v = (item.weapon[k] || 0) + m[k];
          item.weapon[k] = Math.round(v * 100) / 100;
        }
      }
      if (item.weapon.ammo != null) item.ammo = item.weapon.ammo;
    }
    // Skill modules carry an activatable descriptor (skill_fn key, cooldown_ms,
    // regen_amount|fuel_amount, optional fuel_cost); the equipment system runs it.
    if (base.skill) item.skill = clone(base.skill);

    return item;
  }

  // Full drop from a junk-sprite source: rollTier picks base+tier, then generateItem.
  function rollDrop(sourceType, opts) {
    var r = rollTier(sourceType, opts);
    return r.baseType ? generateItem(r.baseType, r.tier, opts) : null;
  }

  function getItemValue(item) {
    if (!item) return 0;
    var base = DB.bases[item.base];
    if (!base) return item.value || 0;
    return priceOf(base, item.tier, item.specials, item.ilvl == null ? 1 : item.ilvl);
  }

  function rarityColor(tier) {
    var t = DB._meta.tiers[tier];
    return t ? t.color : DB._meta.tiers.normal.color;
  }

  /* ── description / tooltip lines (spec §4.5) ─────────────────────────────── */

  function fmtStat(key, val) {
    var a = DB.attributes[key];
    if (!a) return key + " " + val;
    if (a.unit === "pct") return a.label.replace("%", val + "%");
    if (a.unit === "perSec") return "+" + val + " " + a.label + "/s";
    return a.label.replace("+", "+" + val + " ");
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // describeItem(item) → array of { text, color } tooltip lines.
  function describeItem(item) {
    var lines = [];
    lines.push({ text: item.name, color: rarityColor(item.tier) });
    var meta = capitalize(item.cat);
    if (item.slot) meta += " · " + capitalize(item.slot) + " slot";
    meta += " · ilvl " + item.ilvl;
    lines.push({ text: meta, color: COL.dim });
    var bs = item.base_stats || {};
    Object.keys(bs).forEach(function (k) {
      lines.push({ text: fmtStat(k, bs[k]), color: COL.ink });
    });
    (item.specials || []).forEach(function (s) {
      lines.push({ text: fmtStat(s.key, s.val), color: COL.good });
    });
    var dom = dominantPath(item.specials);
    if (dom.path && dom.count >= 2 && DB.paths[dom.path]) {
      lines.push({ text: "★ " + DB.paths[dom.path].label + " synergy", color: DB.paths[dom.path].color });
    }
    lines.push({ text: "Value: " + (item.value != null ? item.value : getItemValue(item)) + " cr", color: COL.gold });
    return lines;
  }

  /* ── DB management / inspection ──────────────────────────────────────────── */

  function loadDB(json) {
    if (!json || !json.bases || !json.attributes) {
      throw new Error("ForgeItemSystem.loadDB: catalog needs 'bases' and 'attributes'");
    }
    DB = json;
    if (!DB._meta) DB._meta = { tiers: SYNTH_DB._meta.tiers };
    return getState();
  }

  function getState() {
    return {
      bases: Object.keys(DB.bases).length,
      attributes: Object.keys(DB.attributes).length,
      sources: Object.keys(DB.drop_map || {}).length,
      tiers: TIER_ORDER.slice()
    };
  }

  /* ── selfTest (runs against SYNTH_DB — never game content) ─────────────────── */

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    var _prevDB = DB;
    DB = SYNTH_DB;                       // isolate from any game catalogue loaded
    try {
      var rng = seedRng(1234);
      var expected = { normal: [0, 0], rare: [1, 2], unique: [2, 3], elite: [4, 5] };

      // 1. Specials count per tier (test_mod pool has 5 affixes → never clamps).
      TIER_ORDER.forEach(function (tier) {
        for (var i = 0; i < 40; i++) {
          var it = generateItem("test_mod", tier, { ilvl: 3, rng: rng });
          var n = it.specials.length;
          check(n >= expected[tier][0] && n <= expected[tier][1],
            tier + " rolled " + n + " specials, expected " + expected[tier].join("-"));
          check(it.tier === tier, "tier not honored: " + it.tier);
          check(it.slot === "mid" && it.cat === "test", "slot/cat not resolved from base");
          var seen = {};
          it.specials.forEach(function (s) {
            check(!seen[s.key], "duplicate affix key " + s.key);
            seen[s.key] = true;
            var a = DB.attributes[s.key], r = a.range[tier];
            check(s.val >= r[0] - 1e-9 && s.val <= r[1] + 1e-9,
              s.key + "=" + s.val + " outside " + tier + " range " + r.join(".."));
            check(Math.abs(s.val / a.step - Math.round(s.val / a.step)) < 1e-9,
              s.key + "=" + s.val + " not aligned to step " + a.step);
          });
          check(it.name.length <= NAME_MAX, "name too long: '" + it.name + "'");
        }
      });

      // 2. Elite clamps to pool size (test_small pool has only 2 affixes).
      var clamped = generateItem("test_small", "elite", { rng: rng });
      check(clamped.specials.length === 2, "elite test_small should clamp to pool size 2, got " + clamped.specials.length);

      // 3. Normal tier: no specials, name = plain base name.
      var plain = generateItem("test_mod", "normal", { rng: rng });
      check(plain.specials.length === 0, "normal tier rolled specials");
      check(plain.name === "Test Module", "normal name should be base name, got '" + plain.name + "'");

      // 4. Value formula: base_value × tierMult × (1+0.04·ilvl) × (1+0.10·nSpecials).
      var priced = generateItem("test_mod", "rare", { ilvl: 5, rng: rng });
      var want = Math.round(80 * 1.8 * (1 + 0.04 * 5) * (1 + 0.10 * priced.specials.length));
      check(priced.value === want, "value " + priced.value + " != formula " + want);
      check(getItemValue(priced) === priced.value, "getItemValue disagrees with rolled value");

      // 5. Determinism: same seed → identical roll (ids aside).
      function strip(it) { return JSON.stringify({ b: it.base, t: it.tier, n: it.name, s: it.specials, v: it.value }); }
      var a1 = generateItem("test_mod", "unique", { ilvl: 4, rng: seedRng(77) });
      var a2 = generateItem("test_mod", "unique", { ilvl: 4, rng: seedRng(77) });
      check(strip(a1) === strip(a2), "seeded rolls are not deterministic");

      // 6. rollTier(sourceType) → base from drop_map + valid tier; unknown → null base.
      var drng = seedRng(9);
      var counts = { normal: 0, rare: 0, unique: 0, elite: 0 };
      for (var d = 0; d < 200; d++) {
        var roll = rollTier("src_x", { ilvl: 0, rng: drng });
        check(DB.drop_map.src_x.indexOf(roll.baseType) !== -1, "src_x rolled bad base " + roll.baseType);
        check(TIER_ORDER.indexOf(roll.tier) !== -1, "bad tier " + roll.tier);
        counts[roll.tier]++;
      }
      check(counts.normal > counts.elite, "tier weights look inverted (normal " + counts.normal + " vs elite " + counts.elite + ")");
      check(rollTier("no_such_src", { rng: drng }).baseType === null, "unknown source should give null baseType");

      // 6b. Weighted pool: src_w skews 9:1 toward test_mod — the picker honours weights.
      var wc = { test_mod: 0, test_small: 0 };
      for (var wd = 0; wd < 400; wd++) wc[rollTier("src_w", { rng: drng }).baseType]++;
      check(wc.test_mod > wc.test_small * 3, "weighted pool must skew to the heavy entry (" + JSON.stringify(wc) + ")");

      // 7. rollDrop returns a fully-formed item from the source's pool.
      var dropped = rollDrop("src_x", { ilvl: 2, rng: seedRng(5) });
      check(dropped && DB.drop_map.src_x.indexOf(dropped.base) !== -1, "rollDrop base not in src_x pool");
      check(dropped && dropped.id && dropped.base_stats, "rollDrop item malformed");

      // 8. Unique ids.
      check(generateItem("test_mod", "normal").id !== generateItem("test_mod", "normal").id, "ids not unique");

      // 9. describeItem lines: name in rarity color, value line last.
      var descItem = generateItem("test_mod", "unique", { ilvl: 6, rng: seedRng(3) });
      var lines = describeItem(descItem);
      check(lines[0].text === descItem.name && lines[0].color === rarityColor("unique"), "describeItem name line wrong");
      check(lines[1].text.indexOf("Mid slot") !== -1 && lines[1].text.indexOf("ilvl 6") !== -1, "describeItem meta line wrong");
      check(lines[lines.length - 1].text === "Value: " + descItem.value + " cr", "describeItem value line wrong");

      // 10. rarityColor + error paths + getState counts (SYNTH: 5 bases, 7 attrs, 1 src).
      check(rarityColor("elite") === "#ff7a3c", "rarityColor(elite) wrong");
      var threw = false;
      try { generateItem("warp_drive_9000"); } catch (e) { threw = true; }
      check(threw, "unknown base type should throw");
      var st = getState();
      check(st.bases === 5 && st.attributes === 7 && st.sources === 2, "getState counts wrong: " + JSON.stringify(st));

      // 11. Weapon bases carry a ballistics profile; generateItem clones it.
      var wpn = generateItem("test_weapon", "rare", { ilvl: 3, rng: seedRng(11) });
      check(wpn.slot === "high" && wpn.cat === "weapons", "weapon slot/cat wrong: " + wpn.slot + "/" + wpn.cat);
      check(wpn.weapon && wpn.weapon.type === "laser", "weapon missing weapon.type");
      check(wpn.weapon.range === 600 && wpn.weapon.fuelPerShot === 8 && wpn.weapon.aoe === 0,
        "weapon range/fuel/aoe wrong: " + JSON.stringify(wpn.weapon));
      check(wpn.weapon.fireRate_ms === 400 && wpn.weapon.projSpeed === 1600 && wpn.weapon.color === "#4ad2ff",
        "weapon fireRate/projSpeed/color must survive the clone: " + JSON.stringify(wpn.weapon));
      var pod = generateItem("test_pod", "normal");
      check(pod.weapon.aoe === 120 && pod.weapon.ammo === 20 && pod.ammo === 20,
        "ammo-limited weapon seeds a live counter: " + JSON.stringify(pod.weapon) + " ammo=" + pod.ammo);
      var wpnE = generateItem("test_weapon", "elite", { rng: seedRng(21) });
      check(wpnE.specials.every(function (s) { return DB.bases.test_weapon.affix_pool.indexOf(s.key) !== -1; }),
        "weapon specials must come from the weapon's affix pool");

      // 12. Skill modules carry an activatable descriptor; generateItem clones it.
      var sk = generateItem("test_skill", "rare", { ilvl: 2, rng: seedRng(12) });
      check(sk.slot === "skill" && sk.cat === "test", "skill module slot/cat wrong: " + sk.slot + "/" + sk.cat);
      check(sk.skill && sk.skill.skill_fn === "shield_regen" && sk.skill.cooldown_ms === 3000 && sk.skill.regen_amount === 15,
        "skill descriptor wrong: " + JSON.stringify(sk.skill));
      var skE = generateItem("test_skill", "elite", { rng: seedRng(99) });
      check(skE.specials.length === 2 && skE.specials.every(function (s) {
        return s.key === "stat_amt_pct" || s.key === "stat_cd_pct";
      }), "skill module elite specials must clamp to the 2-affix pool: " + JSON.stringify(skE.specials));

      // 13. loadDB swaps the catalogue and getState reflects it; restore after.
      var mini = { _meta: SYNTH_DB._meta, bases: { one: { cat: "x", name: "One", base_value: 1, stats: {}, affix_pool: [] } }, attributes: { a: SYNTH_DB.attributes.stat_a_pct }, drop_map: {}, ore: {}, paths: {} };
      loadDB(mini);
      check(getState().bases === 1, "loadDB should swap the catalogue");
      DB = SYNTH_DB;
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.message));
    }
    DB = _prevDB;                        // restore whatever the game had loaded
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    generateItem: generateItem,
    rollTier: rollTier,
    rollDrop: rollDrop,
    rollAttr: rollAttr,
    getItemValue: getItemValue,
    describeItem: describeItem,
    rarityColor: rarityColor,
    loadDB: loadDB,
    uid: uid,
    seedRng: seedRng,
    getState: getState,
    selfTest: selfTest,
    get TIERS() { return DB._meta.tiers; },
    get PATHS() { return DB.paths; },
    get DROP_MAP() { return DB.drop_map; },
    get ORE() { return DB.ore; },
    get DB() { return DB; }
  };

  root.ForgeItemSystem = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
