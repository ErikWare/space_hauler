/*=== HARNESS:CONTENT:CATALOG ================================================*/
// Space Hauler item catalogue. GAME content, NOT engine — loaded into the
// generic ForgeItemSystem via ForgeItemSystem.loadDB(SPACE_HAULER_CATALOG) at
// boot (see main.js init / selfTest). The engine ships with only a tiny
// synthetic fixture; every real item name, stat, and drop table lives here.
//
// Retune notes (weapons/loadout rework):
//   • Weapons carry projSpeed + color (was hardcoded in combat.js) and a
//     per-weapon fireRate_ms: laser fast, cannon medium, missile slow.
//   • DPS-PARITY PASS: per-shot damage now scales inversely with fire rate so
//     the three weapons deal comparable *aggregate* DPS. Laser is the reference
//     (fast+cheap-to-tune); cannon (1s) and missile (2.2s) carry proportionally
//     higher per-shot damage to compensate their slower cadence. Each keeps its
//     layer-ratio identity: laser anti-shield, cannon anti-armor, missile equal
//     vs all + AoE. Missile sits slightly under single-target parity because its
//     splash, longest range, and best fuel-economy are the rest of its budget.
//   • Missile deals equal 5.0× on all three layers (ratio = "equal vs all")
//     and is unlimited-ammo; its cost lever is low fuel + slow fire + AoE.
//   • Skill repair modules cost fuel to fire (skill.fuel_cost).
//   • drop_map is the PLAYER junk-haul pool.
//     Bases with "faction" carry faction naming (prefix/suffix) automatically.
//     Base weapons (laser/cannon/missile) remain in all pools; faction variants
//     appear at lower weight so they feel like real finds.
const SPACE_HAULER_CATALOG = {
  "_meta": {
    "version": 2,
    "tiers": {
      "normal": { "specials": [0, 0], "weight": 100, "valueMult": 1.0, "color": "#e8edf4" },
      "rare":   { "specials": [1, 2], "weight": 34,  "valueMult": 1.8, "color": "#5c8cff" },
      "unique": { "specials": [2, 3], "weight": 10,  "valueMult": 3.2, "color": "#ffd24a" },
      "elite":  { "specials": [4, 5], "weight": 3,   "valueMult": 6.0, "color": "#ff7a3c" }
    }
  },
  "bases": {
    // ── PLAYER MODULES ─────────────────────────────────────────────────────
    // Defense — shield boost/hardener/repair, armor boost/hardener/repair
    "shield_extender": { "cat": "shield", "slot": "mid",
      "names": ["Shield Boost", "Cap Extender", "Shield Slab", "Barrier Plate"],
      "name": "Shield Boost",    "base_value": 90,
      "stats": { "shield_cap_pct": 20 },
      "affix_pool": ["shield_cap_pct","shield_resist","shield_regen","shield_delay_pct"],
      "drop_from": ["junk_panel"] },

    "shield_hardener": { "cat": "shield", "slot": "mid",
      "names": ["Shield Hardener", "Ablative Veil", "Reflex Dampener", "Hardpoint Shield"],
      "name": "Shield Hardener", "base_value": 110,
      "stats": { "shield_resist": 12 },
      "affix_pool": ["shield_resist","shield_cap_pct","shield_delay_pct"],
      "drop_from": ["junk_panel"] },

    "armor_plate":     { "cat": "armor", "slot": "low",
      "names": ["Armor Boost", "Plate Pack", "Steel Shell", "Blast Plate"],
      "name": "Armor Boost",    "base_value": 75,
      "stats": { "armor_hp": 40 },
      "affix_pool": ["armor_hp","armor_hp_pct","armor_resist"],
      "drop_from": ["junk_debris"] },

    "armor_coating":   { "cat": "armor", "slot": "rig",
      "names": ["Armor Hardener", "Impact Coat", "Temper Coat", "Ceramic Shell"],
      "name": "Armor Hardener",  "base_value": 95,
      "stats": { "armor_resist": 10 },
      "affix_pool": ["armor_resist","armor_hp_pct","armor_hp"],
      "drop_from": ["junk_debris"] },

    "shield_regen_module": { "cat": "shield", "slot": "skill",
      "names": ["Shield Repair", "Shield Pulse", "Regen Rig", "Shield Injector"],
      "name": "Shield Repair",  "base_value": 90,
      "stats": {},
      "skill": { "skill_fn": "shield_regen", "cooldown_ms": 6000, "regen_amount": 25, "fuel_cost": 10 },
      "affix_pool": ["skill_amount_pct","skill_cooldown_pct"],
      "drop_from": ["junk_panel"] },

    "armor_repair_module": { "cat": "armor", "slot": "skill",
      "names": ["Armor Repair", "Patch Welder", "Hull Forge", "Armor Injector"],
      "name": "Armor Repair",   "base_value": 100,
      "stats": {},
      "skill": { "skill_fn": "armor_repair", "cooldown_ms": 8000, "regen_amount": 20, "fuel_cost": 14 },
      "affix_pool": ["skill_amount_pct","skill_cooldown_pct"],
      "drop_from": ["junk_crate"] },

    // Utility / propulsion
    "tractor_range":   { "cat": "tractor", "slot": "mid",
      "names": ["Tractor Beam Range", "Long-Arm Tractor", "Reach Extender", "Haul Amplifier"],
      "name": "Tractor Beam Range",  "base_value": 85,
      "stats": { "tractor_range_pct": 25 },
      "affix_pool": ["tractor_range_pct","tractor_str_pct","scan_range_pct","fuel_eff_pct"],
      "drop_from": ["junk_can"] },

    "tractor_slots":   { "cat": "tractor", "slot": "mid",
      "names": ["Additional Tow Slots", "Tow Hardpoint", "Haul Rack", "Cargo Yoke"],
      "name": "Additional Tow Slots", "base_value": 150,
      "stats": { "tractor_slots_flat": 1 },
      "affix_pool": ["tractor_range_pct","tractor_str_pct"],
      "drop_from": ["junk_crate"] },

    "ore_scanner":     { "cat": "utility", "slot": "mid",
      "names": ["Survey Scanner", "Deep Scan Array", "Ore Sniffer", "Field Mapper"],
      "name": "Survey Scanner",      "base_value": 60,
      "stats": { "scan_range_pct": 40 },
      "affix_pool": ["scan_range_pct","tractor_range_pct"],
      "drop_from": [] },

    "engine_booster":  { "cat": "propulsion", "slot": "mid",
      "names": ["Engine Enhancement", "Thrust Spike", "Drive Booster", "Burn Amplifier"],
      "name": "Engine Enhancement",  "base_value": 100,
      "stats": { "thrust_pct": 20 },
      "affix_pool": ["thrust_pct","turn_pct","fuel_eff_pct","fuel_cap_pct"],
      "drop_from": ["junk_can"] },

    "fuel_regulator":  { "cat": "propulsion", "slot": "low",
      "names": ["Usage Reduction", "Flow Throttle", "Burn Regulator", "Fuel Saver"],
      "name": "Usage Reduction",     "base_value": 90,
      "stats": { "fuel_eff_pct": 20 },
      "affix_pool": ["fuel_eff_pct","fuel_cap_pct"],
      "drop_from": ["junk_can"] },

    "fuel_cell":       { "cat": "propulsion", "slot": "low",
      "names": ["Fuel Cell", "Reserve Tank", "Deep Tank", "Fuel Slab"],
      "name": "Fuel Cell",           "base_value": 65,
      "stats": { "fuel_cap_pct": 25 },
      "affix_pool": ["fuel_cap_pct","fuel_eff_pct"],
      "drop_from": ["junk_can"] },

    "solar_wing":      { "cat": "propulsion", "slot": "low",
      "names": ["Solar Wing", "Photon Vane", "Sun Panel", "Solar Fin"],
      "name": "Solar Wing",          "base_value": 80,
      "stats": { "solar_regen": 1.5 },
      "affix_pool": ["solar_regen","fuel_cap_pct"],
      "drop_from": ["junk_panel"] },

    // ── NEW PLAYER MODULES ─────────────────────────────────────────────────
    // Combined-stat modules with distinct flavored names; drop from junk pools.

    "reactive_web":    { "cat": "shield", "slot": "mid",
      "names": ["Reactive Shield Web", "Phasic Shield Mesh", "Shield Lattice", "Flux Web Array"],
      "name": "Reactive Shield Web", "base_value": 105,
      "stats": { "shield_regen": 3, "shield_resist": 5 },
      "affix_pool": ["shield_regen","shield_resist","shield_cap_pct","shield_delay_pct"],
      "drop_from": ["junk_panel"] },

    "ablative_plating": { "cat": "armor", "slot": "low",
      "names": ["Ablative Plating", "Scatter Plate", "Flex Armor", "Reactive Hull Plate"],
      "name": "Ablative Plating",    "base_value": 90,
      "stats": { "armor_hp": 25, "hull_hp": 15 },
      "affix_pool": ["armor_hp","hull_hp","armor_hp_pct","armor_resist"],
      "drop_from": ["junk_debris"] },

    "thruster_web":    { "cat": "propulsion", "slot": "mid",
      "names": ["Thruster Web", "Drive Web", "Burn Grid", "Maneuver Rig"],
      "name": "Thruster Web",        "base_value": 95,
      "stats": { "thrust_pct": 12, "turn_pct": 10 },
      "affix_pool": ["thrust_pct","turn_pct","fuel_eff_pct","fuel_cap_pct"],
      "drop_from": ["junk_can"] },

    "void_capacitor":  { "cat": "shield", "slot": "mid",
      "names": ["Void Capacitor", "Shield Charge Cache", "Shield Buffer", "Energy Sink"],
      "name": "Void Capacitor",      "base_value": 85,
      "stats": { "shield_delay_pct": 18, "shield_cap_pct": 8 },
      "affix_pool": ["shield_delay_pct","shield_cap_pct","shield_regen","fuel_eff_pct"],
      "drop_from": ["junk_panel"] },

    // ── BASE WEAPONS ───────────────────────────────────────────────────────
    // Three canonical weapon archetypes — the game's DPS reference. Faction
    // variants below are tuned relative to these baselines.
    "laser":   { "cat": "weapons", "slot": "high", "name": "Laser",   "base_value": 140,
      "stats": {},
      "weapon": { "type": "laser",   "dmgShield": 1.6, "dmgArmor": 0.6, "dmgHull": 1.0,
                  "range": 600, "fuelPerShot": 8, "aoe": 0, "ammo": null,
                  "fireRate_ms": 400,  "projSpeed": 1600, "color": "#4ad2ff" },
      "affix_pool": ["damage_pct","weapon_range_pct","fuel_eff_pct","rof_pct"],
      "variants": [
        { "name": "Beam Cutter",  "mods": { "dmgShield": 0.3, "dmgArmor": 0.1, "dmgHull": 0.2, "range": -150 } },
        { "name": "Pulse Lance",  "mods": { "range": 200, "fireRate_ms": 150, "fuelPerShot": 3 } },
        { "name": "Arc Emitter",  "mods": { "dmgShield": 0.5, "dmgArmor": -0.1, "dmgHull": -0.3, "range": -50, "fuelPerShot": 1 } },
        { "name": "Photon Drill", "mods": { "dmgShield": -0.3, "dmgArmor": 0.3 } },
        { "name": "Ray Repeater", "mods": { "dmgShield": -0.2, "dmgArmor": -0.1, "dmgHull": -0.1, "range": -100, "fireRate_ms": -100, "fuelPerShot": 2 } }
      ],
      "drop_from": [] },

    "cannon":  { "cat": "weapons", "slot": "high", "name": "Cannon",  "base_value": 140,
      "stats": {},
      "weapon": { "type": "cannon",  "dmgShield": 1.5, "dmgArmor": 4.0, "dmgHull": 2.5,
                  "range": 900, "fuelPerShot": 5, "aoe": 0, "ammo": null,
                  "fireRate_ms": 1000, "projSpeed": 1200, "color": "#ffb040" },
      "affix_pool": ["damage_pct","weapon_range_pct","fuel_eff_pct","rof_pct"],
      "variants": [
        { "name": "Rail Driver",  "mods": { "range": 300, "fireRate_ms": 400, "fuelPerShot": 3 } },
        { "name": "Slug Thrower", "mods": { "dmgShield": 0.2, "dmgArmor": 0.5, "dmgHull": 0.5, "range": -200 } },
        { "name": "Coil Gun",     "mods": { "dmgShield": -0.2, "dmgArmor": -0.5, "dmgHull": -0.3, "fireRate_ms": -100, "fuelPerShot": -2 } },
        { "name": "Mass Driver",  "mods": { "dmgShield": -0.3, "dmgArmor": 1.0, "dmgHull": 1.0, "range": -100, "fireRate_ms": 400, "fuelPerShot": 2 } },
        { "name": "Bore Hammer",  "mods": { "dmgShield": -0.5, "dmgArmor": 1.5, "dmgHull": 0.5, "range": -300, "fireRate_ms": 200, "fuelPerShot": 1 } }
      ],
      "drop_from": [] },

    "missile": { "cat": "weapons", "slot": "high", "name": "Missile", "base_value": 150,
      "stats": {},
      "weapon": { "type": "missile", "dmgShield": 5.0, "dmgArmor": 5.0, "dmgHull": 5.0,
                  "range": 1400, "fuelPerShot": 3, "aoe": 120, "ammo": null,
                  "fireRate_ms": 2200, "projSpeed": 700, "color": "#57d1c9" },
      "affix_pool": ["damage_pct","aoe_radius_pct","fuel_eff_pct","rof_pct"],
      "variants": [
        { "name": "Torpedo",      "mods": { "dmgShield": 1.5, "dmgArmor": 1.5, "dmgHull": 1.5, "fireRate_ms": 600, "fuelPerShot": 1, "aoe": -60 } },
        { "name": "Seeker Pod",   "mods": { "range": 400, "fireRate_ms": 400, "fuelPerShot": 1 } },
        { "name": "Warhead Rack", "mods": { "dmgShield": -1.0, "dmgArmor": -1.0, "dmgHull": -1.0, "range": -200, "fireRate_ms": -400, "aoe": 80 } },
        { "name": "Salvo Array",  "mods": { "dmgShield": -1.5, "dmgArmor": -1.5, "dmgHull": -1.5, "range": -200, "fireRate_ms": -600, "fuelPerShot": 1, "aoe": -20 } },
        { "name": "Swarm Pod",    "mods": { "dmgShield": -2.0, "dmgArmor": -2.0, "dmgHull": -2.0, "range": -400, "fireRate_ms": -800, "fuelPerShot": 2, "aoe": 130 } }
      ],
      "drop_from": [] },

    // ── KRAG WEAPONS — industrial, salvaged, breach-and-clear ─────────────
    // Krag cannons: built in a hurry from mining gear and scrap hulls.
    // The Scatter-Rig hits everything in a cone; the Siege-Breaker punches
    // through armor at long range but needs the target to hold still.
    // All Krag bases carry "faction":"krag" so the name engine uses Krag
    // prefixes ("Scrap-Forged", "Welded", "Jury-Rigged"…) and Krag elite
    // suffixes ("Mk.II", "Rig", "Breaker"…) at rare/unique/elite tier.

    "krag_scatter_rig":  { "cat": "weapons", "slot": "high", "faction": "krag",
      "names": ["Scatter-Rig", "Blast Cannon", "Choke Bore", "Spread-Fire Mk.II"],
      "name": "Scatter-Rig", "base_value": 145,
      "stats": {},
      "weapon": { "type": "cannon", "dmgShield": 0.8, "dmgArmor": 4.5, "dmgHull": 2.5,
                  "range": 520, "fuelPerShot": 5, "aoe": 60, "ammo": null,
                  "fireRate_ms": 900, "projSpeed": 950, "color": "#ffb040" },
      "affix_pool": ["damage_pct","rof_pct","fuel_eff_pct","weapon_range_pct"],
      "drop_from": [] },

    "krag_siege_breaker": { "cat": "weapons", "slot": "high", "faction": "krag",
      "names": ["Siege-Breaker", "Bunker Buster", "Hull Crusher", "Warhead Driver"],
      "name": "Siege-Breaker", "base_value": 155,
      "stats": {},
      "weapon": { "type": "cannon", "dmgShield": 1.0, "dmgArmor": 6.5, "dmgHull": 3.0,
                  "range": 1100, "fuelPerShot": 4, "aoe": 0, "ammo": null,
                  "fireRate_ms": 1700, "projSpeed": 1400, "color": "#e89030" },
      "affix_pool": ["damage_pct","weapon_range_pct","rof_pct","fuel_eff_pct"],
      "drop_from": [] },

    // ── VEX WEAPONS — precision military, fast, anti-shield ───────────────
    // Vex lasers: mass-produced but ruthlessly optimized. The Lancer Array
    // reaches further than anything the player can mount; the Phase Disruptor
    // punches through shields and keeps punching until there's nothing left.
    // Vex prefixes: "Precision", "Focused", "Surgical", "Null-Point"…
    // Vex elite suffixes: "Pattern IV", "Directive", "Protocol", "Array".

    "vex_lancer":   { "cat": "weapons", "slot": "high", "faction": "vex",
      "names": ["Lancer Array", "Needle Lance", "Rail-Tip Beam", "Bore Lance"],
      "name": "Lancer Array", "base_value": 145,
      "stats": {},
      "weapon": { "type": "laser", "dmgShield": 1.6, "dmgArmor": 0.5, "dmgHull": 0.9,
                  "range": 800, "fuelPerShot": 9, "aoe": 0, "ammo": null,
                  "fireRate_ms": 350, "projSpeed": 1900, "color": "#7ce8ff" },
      "affix_pool": ["rof_pct","weapon_range_pct","damage_pct","fuel_eff_pct"],
      "drop_from": [] },

    "vex_disruptor": { "cat": "weapons", "slot": "high", "faction": "vex",
      "names": ["Ion Disruptor", "Void Needle", "Shield Lancer", "Disruptor Coil"],
      "name": "Phase Disruptor", "base_value": 155,
      "stats": {},
      "weapon": { "type": "laser", "dmgShield": 2.8, "dmgArmor": 0.2, "dmgHull": 1.3,
                  "range": 520, "fuelPerShot": 11, "aoe": 0, "ammo": null,
                  "fireRate_ms": 550, "projSpeed": 2000, "color": "#a0c8ff" },
      "affix_pool": ["damage_pct","fuel_eff_pct","rof_pct","weapon_range_pct"],
      "drop_from": [] },

    // ── NOX WEAPONS — alien-organic, AoE-saturating, biological ──────────
    // Nox launchers: living projectiles that burrow into hull plating. The
    // Tendril Caster fires fast and keeps firing; the Spore Pod blooms into
    // a cloud that strips whole formations.
    // Nox prefixes: "Resonance", "Living", "Echo", "Grown", "Murmur"…
    // Nox elite suffixes: "Bloom", "Choir", "Weave", "Scream".

    "nox_tendril":  { "cat": "weapons", "slot": "high", "faction": "nox",
      "names": ["Tendril Caster", "Brood Lance", "Barb Tendril", "Spore Thread"],
      "name": "Tendril Caster", "base_value": 150,
      "stats": {},
      "weapon": { "type": "missile", "dmgShield": 3.2, "dmgArmor": 3.5, "dmgHull": 3.5,
                  "range": 950, "fuelPerShot": 4, "aoe": 80, "ammo": null,
                  "fireRate_ms": 1500, "projSpeed": 850, "color": "#57d1c9" },
      "affix_pool": ["damage_pct","aoe_radius_pct","rof_pct","fuel_eff_pct"],
      "drop_from": [] },

    "nox_spore_pod": { "cat": "weapons", "slot": "high", "faction": "nox",
      "names": ["Spore Pod", "Bloom Launcher", "Mycelial Cannon", "Void Bloom"],
      "name": "Spore Pod", "base_value": 160,
      "stats": {},
      "weapon": { "type": "missile", "dmgShield": 4.0, "dmgArmor": 4.5, "dmgHull": 4.5,
                  "range": 1300, "fuelPerShot": 3, "aoe": 200, "ammo": null,
                  "fireRate_ms": 3000, "projSpeed": 580, "color": "#7bffb0" },
      "affix_pool": ["aoe_radius_pct","damage_pct","fuel_eff_pct","rof_pct"],
      "drop_from": [] },

    // ── NPC / ALIEN-INTERNAL BASES ─────────────────────────────────────────
    // Referenced by faction.js loadouts and npc.js miners. Not in drop_map, so
    // they never reach the player from junk; kept so those systems resolve.
    "shield_booster":  { "cat": "shield", "slot": "mid", "name": "Shield Booster",  "base_value": 80,  "stats": { "shield_regen": 6 },   "affix_pool": ["shield_cap_pct","shield_regen_pct","shield_resist","shield_delay_pct","fuel_eff_pct"], "drop_from": [] },
    "armor_repairer":  { "cat": "armor", "slot": "low", "name": "Armor Repairer", "base_value": 100, "stats": { "armor_repair": 4 },  "affix_pool": ["armor_repair","armor_hp","armor_resist","hull_hp"], "drop_from": [] },
    "hull_repair_kit": { "cat": "hull", "slot": "low", "name": "Hull Repair Kit", "base_value": 85, "stats": { "hull_hp": 30 },     "affix_pool": ["hull_hp","hull_hp_pct","hull_resist","armor_repair"], "drop_from": [] },
    "hull_plating":    { "cat": "hull", "slot": "low", "name": "Hull Plating",    "base_value": 70, "stats": { "hull_hp": 25 },     "affix_pool": ["hull_hp","hull_hp_pct","hull_resist","armor_hp"], "drop_from": [] },
    "cargo_expander":  { "cat": "cargo", "slot": "low", "name": "Cargo Expander", "base_value": 80, "stats": { "cargo_cap_pct": 30 },   "affix_pool": ["cargo_cap_pct","tractor_str_pct"], "drop_from": [] },
    "afterburner":     { "cat": "propulsion", "slot": "mid", "name": "Afterburner",    "base_value": 115, "stats": { "thrust_pct": 30 },   "affix_pool": ["thrust_pct","turn_pct","fuel_eff_pct"], "drop_from": [] },
    "turret":          { "cat": "weapons", "slot": "high", "name": "Turret",     "base_value": 130, "stats": { "damage_pct": 20 }, "affix_pool": ["damage_pct","rof_pct","scan_range_pct"], "drop_from": [] },
    "mine_layer":      { "cat": "weapons", "slot": "high", "name": "Mine Layer",  "base_value": 110, "stats": { "damage_pct": 25 }, "affix_pool": ["damage_pct","rof_pct"], "drop_from": [] },
    "nav_computer":    { "cat": "utility", "slot": "mid", "name": "Nav Computer",   "base_value": 70, "stats": { "turn_pct": 15 },      "affix_pool": ["turn_pct","thrust_pct","fuel_eff_pct"], "drop_from": [] },
    "fuel_cell_module":    { "cat": "fuel",   "slot": "skill", "name": "Fuel Cell Module",    "base_value": 85,  "stats": {}, "skill": { "skill_fn": "fuel_cell",    "cooldown_ms": 8000, "fuel_amount": 20 },  "affix_pool": ["skill_amount_pct","skill_cooldown_pct"], "drop_from": [] },
    "hull_repair_module":  { "cat": "hull",   "slot": "skill", "name": "Hull Repair Module",  "base_value": 95,  "stats": {}, "skill": { "skill_fn": "hull_repair",  "cooldown_ms": 10000, "regen_amount": 5 }, "affix_pool": ["skill_amount_pct","skill_cooldown_pct"], "drop_from": [] }
  },
  "attributes": {
    "shield_cap_pct":    { "label": "+% Shield Capacity",       "unit": "pct",    "dir": 1,  "affects": "shieldMax",    "path": "shield_tank",  "step": 1,   "range": { "normal": [0,0], "rare": [6,12],  "unique": [10,18], "elite": [16,26] } },
    "shield_regen":      { "label": "Shield Regen",             "unit": "perSec", "dir": 1,  "affects": "shieldRegen",  "path": "shield_tank",  "step": 0.5, "range": { "normal": [0,0], "rare": [2,4],   "unique": [3,6],   "elite": [5,9] } },
    "shield_regen_pct":  { "label": "+% Shield Regen",          "unit": "pct",    "dir": 1,  "affects": "shieldRegen",  "path": "shield_tank",  "step": 1,   "range": { "normal": [0,0], "rare": [8,16],  "unique": [14,24], "elite": [22,36] } },
    "shield_resist":     { "label": "Shield Resist",            "unit": "pct",    "dir": 1,  "affects": "res.shield",   "path": "shield_tank",  "step": 1,   "range": { "normal": [0,0], "rare": [4,8],   "unique": [7,13],  "elite": [11,20] } },
    "shield_delay_pct":  { "label": "-% Shield Recharge Delay", "unit": "pct",    "dir": -1, "affects": "shieldDelay",  "path": "shield_tank",  "step": 1,   "range": { "normal": [0,0], "rare": [6,12],  "unique": [10,18], "elite": [16,28] } },
    "armor_hp":          { "label": "+Armor HP",                "unit": "flat",   "dir": 1,  "affects": "armorMax",     "path": "armor_tank",   "step": 5,   "range": { "normal": [0,0], "rare": [15,35], "unique": [30,60], "elite": [50,100] } },
    "armor_hp_pct":      { "label": "+% Armor HP",              "unit": "pct",    "dir": 1,  "affects": "armorMax",     "path": "armor_tank",   "step": 1,   "range": { "normal": [0,0], "rare": [8,16],  "unique": [14,24], "elite": [22,38] } },
    "armor_resist":      { "label": "Armor Resist",             "unit": "pct",    "dir": 1,  "affects": "res.armor",    "path": "armor_tank",   "step": 1,   "range": { "normal": [0,0], "rare": [4,9],   "unique": [8,15],  "elite": [13,24] } },
    "armor_repair":      { "label": "Armor Repair",             "unit": "perSec", "dir": 1,  "affects": "armorRepair",  "path": "armor_tank",   "step": 0.5, "range": { "normal": [0,0], "rare": [1.5,3], "unique": [2.5,5], "elite": [4,8] } },
    "hull_hp":           { "label": "+Hull HP",                 "unit": "flat",   "dir": 1,  "affects": "hullMax",      "path": "armor_tank",   "step": 5,   "range": { "normal": [0,0], "rare": [10,25], "unique": [20,45], "elite": [40,80] } },
    "hull_hp_pct":       { "label": "+% Hull HP",               "unit": "pct",    "dir": 1,  "affects": "hullMax",      "path": "armor_tank",   "step": 1,   "range": { "normal": [0,0], "rare": [6,14],  "unique": [12,22], "elite": [20,34] } },
    "hull_resist":       { "label": "Hull Resist",              "unit": "pct",    "dir": 1,  "affects": "res.hull",     "path": "armor_tank",   "step": 1,   "range": { "normal": [0,0], "rare": [3,7],   "unique": [6,12],  "elite": [10,20] } },
    "damage_pct":        { "label": "+% Weapon Damage",         "unit": "pct",    "dir": 1,  "affects": "weaponDmg",    "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,18],  "unique": [15,30], "elite": [26,48] } },
    "rof_pct":           { "label": "+% Rate of Fire",          "unit": "pct",    "dir": 1,  "affects": "fireRate",     "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [6,14],  "unique": [12,24], "elite": [20,38] } },
    "scan_range_pct":    { "label": "+% Scanner Range",         "unit": "pct",    "dir": 1,  "affects": "scanRange",    "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [10,25], "unique": [20,40], "elite": [35,65] } },
    "tractor_range_pct": { "label": "+% Tractor Range",         "unit": "pct",    "dir": 1,  "affects": "tractorRange", "path": "hauler",       "step": 1,   "range": { "normal": [0,0], "rare": [8,18],  "unique": [15,30], "elite": [26,45] } },
    "tractor_str_pct":   { "label": "+% Tractor Strength",      "unit": "pct",    "dir": 1,  "affects": "tractorStr",   "path": "hauler",       "step": 1,   "range": { "normal": [0,0], "rare": [6,14],  "unique": [12,24], "elite": [20,38] } },
    "tractor_slots_flat":{ "label": "+Tow Slots",              "unit": "flat",   "dir": 1,  "affects": "tractorSlots", "path": "hauler",       "step": 1,   "range": { "normal": [0,0], "rare": [0,1],   "unique": [1,1],   "elite": [1,2] } },
    "fuel_eff_pct":      { "label": "-% Fuel Cost",             "unit": "pct",    "dir": -1, "affects": "fuelCostK",    "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [5,12],  "unique": [10,20], "elite": [17,30] } },
    "fuel_cap_pct":      { "label": "+% Fuel Capacity",         "unit": "pct",    "dir": 1,  "affects": "fuelMax",      "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,18],  "unique": [15,30], "elite": [26,45] } },
    "solar_regen":       { "label": "Solar Recharge",           "unit": "perSec", "dir": 1,  "affects": "solarRegen",   "path": null,           "step": 0.5, "range": { "normal": [0,0], "rare": [1,2],   "unique": [1.5,3], "elite": [2.5,4.5] } },
    "thrust_pct":        { "label": "+% Thrust",                "unit": "pct",    "dir": 1,  "affects": "thrust",       "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [6,14],  "unique": [12,24], "elite": [20,36] } },
    "turn_pct":          { "label": "+% Turn Speed",            "unit": "pct",    "dir": 1,  "affects": "turnSpeed",    "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [6,14],  "unique": [12,22], "elite": [18,32] } },
    "weapon_range_pct":  { "label": "+% Weapon Range",          "unit": "pct",    "dir": 1,  "affects": "weaponRange",  "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,16],  "unique": [14,26], "elite": [22,40] } },
    "aoe_radius_pct":    { "label": "+% AoE Radius",            "unit": "pct",    "dir": 1,  "affects": "aoeRadius",    "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,16],  "unique": [14,26], "elite": [22,40] } },
    "skill_amount_pct":  { "label": "+% Skill Amount",          "unit": "pct",    "dir": 1,  "affects": "skillAmount",  "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,16],  "unique": [14,26], "elite": [22,40] } },
    "skill_cooldown_pct":{ "label": "-% Skill Cooldown",        "unit": "pct",    "dir": -1, "affects": "skillCooldown","path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [6,12],  "unique": [10,20], "elite": [16,28] } },
    "cargo_cap_pct":     { "label": "+% Cargo Capacity",        "unit": "pct",    "dir": 1,  "affects": "cargoMax",     "path": null,           "step": 1,   "range": { "normal": [0,0], "rare": [8,18],  "unique": [15,32], "elite": [28,50] } }
  },
  // PLAYER junk-haul loot pools. Base weapons (laser/cannon/missile) at w:20
  // each dominate every pool. Faction variants appear at w:4–7 — rare enough
  // to feel like finds, common enough that players see them regularly.
  // New modules slot into their thematic pools alongside existing ones.
  "drop_map": {
    "junk_can":    [ {"base":"laser","w":20},{"base":"cannon","w":20},{"base":"missile","w":20},
                     {"base":"krag_scatter_rig","w":6},{"base":"krag_siege_breaker","w":4},
                     {"base":"vex_lancer","w":5},{"base":"vex_disruptor","w":4},
                     {"base":"nox_tendril","w":5},{"base":"nox_spore_pod","w":4},
                     {"base":"fuel_cell","w":10},{"base":"engine_booster","w":10},
                     {"base":"fuel_regulator","w":10},{"base":"tractor_range","w":10},
                     {"base":"thruster_web","w":7} ],
    "junk_panel":  [ {"base":"laser","w":20},{"base":"cannon","w":20},{"base":"missile","w":20},
                     {"base":"krag_scatter_rig","w":4},{"base":"krag_siege_breaker","w":3},
                     {"base":"vex_lancer","w":7},{"base":"vex_disruptor","w":6},
                     {"base":"nox_tendril","w":4},{"base":"nox_spore_pod","w":3},
                     {"base":"shield_extender","w":14},{"base":"shield_hardener","w":13},
                     {"base":"shield_regen_module","w":13},
                     {"base":"reactive_web","w":8},{"base":"void_capacitor","w":6} ],
    "junk_crate":  [ {"base":"laser","w":20},{"base":"cannon","w":20},{"base":"missile","w":20},
                     {"base":"krag_scatter_rig","w":7},{"base":"krag_siege_breaker","w":6},
                     {"base":"vex_lancer","w":4},{"base":"vex_disruptor","w":3},
                     {"base":"nox_tendril","w":5},{"base":"nox_spore_pod","w":4},
                     {"base":"armor_plate","w":14},{"base":"armor_repair_module","w":13},
                     {"base":"tractor_slots","w":13},
                     {"base":"ablative_plating","w":8} ],
    "junk_debris": [ {"base":"laser","w":20},{"base":"cannon","w":20},{"base":"missile","w":20},
                     {"base":"krag_scatter_rig","w":5},{"base":"krag_siege_breaker","w":4},
                     {"base":"vex_lancer","w":4},{"base":"vex_disruptor","w":3},
                     {"base":"nox_tendril","w":7},{"base":"nox_spore_pod","w":6},
                     {"base":"armor_plate","w":13},{"base":"armor_coating","w":14},
                     {"base":"solar_wing","w":13},
                     {"base":"ablative_plating","w":7} ]
  },
  "ore": {
    "ore_copper":   { "label": "Copper Ore",   "refined_value": 30,  "refine_time": 6,  "refine_cost": 6,  "yield": 1, "raw_sell_penalty": 0.35 },
    "ore_silver":   { "label": "Silver Ore",   "refined_value": 90,  "refine_time": 10, "refine_cost": 14, "yield": 1, "raw_sell_penalty": 0.35 },
    "ore_gold":     { "label": "Gold Ore",     "refined_value": 240, "refine_time": 16, "refine_cost": 34, "yield": 1, "raw_sell_penalty": 0.35 },
    "ore_platinum": { "label": "Platinum Ore", "refined_value": 600, "refine_time": 26, "refine_cost": 80, "yield": 1, "raw_sell_penalty": 0.35 }
  },
  "paths": {
    "shield_tank": { "label": "Shield Tank", "color": "#4ad2ff", "attrs": ["shield_cap_pct","shield_regen","shield_regen_pct","shield_resist","shield_delay_pct"], "bases": ["shield_extender","shield_hardener","shield_regen_module","reactive_web","void_capacitor"] },
    "armor_tank":  { "label": "Armor Tank",  "color": "#ffb040", "attrs": ["armor_hp","armor_hp_pct","armor_resist","armor_repair"], "bases": ["armor_plate","armor_coating","armor_repair_module","ablative_plating"] },
    "hauler":      { "label": "Hauler",      "color": "#57d1c9", "attrs": ["tractor_range_pct","tractor_str_pct","tractor_slots_flat"], "bases": ["tractor_range","tractor_slots"] }
  }
};
if (typeof globalThis !== "undefined") globalThis.SPACE_HAULER_CATALOG = SPACE_HAULER_CATALOG;
if (typeof module !== "undefined" && module.exports) module.exports = SPACE_HAULER_CATALOG;
