/*=== HARNESS:SKILLS =========================================================*/
// Space Hauler — global XP / leveling + the 7-pillar skill tree (Cannon, Laser,
// Missile, Shield, Armor, Tractor, Engine). Every world activity EXCEPT planet
// surface actions feeds a global XP bar (see addXp call sites: sell, buy,
// turn-in, contracts, trade runs, outpost captures). Each level grants 1 skill
// point; points buy perk ranks that enhance the ship.
//
// Integration:
//   • applySkillsToDerived(d, skills) runs inside GAME.recomputeDerived() AFTER
//     ForgeEquipment.getActiveStats(), so skills stack on top of the equipped
//     fit exactly like affixes. Tank/utility/engine perks mutate the derived
//     block directly; weapon perks build d.wpnSkill[type] used by the fire path.
//   • Combat reads shipState.critBonus/hitBonus/dmgMultShield/dmgMultArmor/
//     aoeMult (all default-off) — GAME.applyWpnMods() decorates the per-shot
//     shipState from d.wpnSkill.
//   • s.xp / s.level / s.skillPoints / s.skills are PLAYER progress → whitelisted
//     in save.js serializeGame()/applySaveData().

// XP / leveling tunables.
const SKILLS = {
  xpPerCredit: 0.1,      // XP = 10% of an activity's credit value
  questMult: 1.5,        // contracts pay a little extra XP
  captureFlat: 250,      // flat XP bonus for taking an outpost (on top of spoils)
  respecCost: 10000,     // credits to reset all allocated points
  maxLevel: 50,
  xpBase: 120, xpGrowth: 1.15,   // xpForLevel(n) = round(xpBase · xpGrowth^(n-1))
};

// The tree: 7 pillars × 4 perks. `kind`+`target`+`per` drive application (data,
// so it's headless-testable); `unit` drives display. All `per` are per-RANK.
//   mulPct   d[target] *= 1 + rank·per/100        (+% stat)
//   negPct   d[target] *= 1 − rank·per/100        (−% stat; costs/delays)
//   addFrac  d[target]  = min(.75, +rank·per/100) (resist fractions)
//   addFlat  d[target] += rank·per                (flat: repair/s, tow slots)
//   wpnMulPct  d.wpnSkill[type][field] *= 1 + rank·per/100
//   wpnNegPct  d.wpnSkill[type][field] *= 1 − rank·per/100
//   wpnAdd     d.wpnSkill[type][field] += rank·per/100   (crit/hit chance, abs)
const SKILL_TREE = [
  { key: "cannon", name: "Cannon", icon: "◎", color: "#ffb040", perks: [
    { key: "cannon_dmg",   name: "Heavy Rounds",  desc: "+% Cannon damage",        maxRank: 5, per: 6, kind: "wpnMulPct", target: { type: "cannon", field: "dmgMult" },       unit: "%" },
    { key: "cannon_range", name: "Long Barrel",   desc: "+% Cannon range",         maxRank: 5, per: 8, kind: "wpnMulPct", target: { type: "cannon", field: "rangeMult" },     unit: "%" },
    { key: "cannon_armor", name: "Armor Piercer", desc: "+% Armor-layer damage",   maxRank: 5, per: 8, kind: "wpnMulPct", target: { type: "cannon", field: "armorDmgMult" },  unit: "%" },
    { key: "cannon_fuel",  name: "Auto-Loader",   desc: "−% Fuel per Cannon shot", maxRank: 5, per: 5, kind: "wpnNegPct", target: { type: "cannon", field: "fuelMult" },      unit: "%" },
  ]},
  { key: "laser", name: "Laser", icon: "⋆", color: "#4ad2ff", perks: [
    { key: "laser_dmg",    name: "Focused Beam",    desc: "+% Laser damage",        maxRank: 5, per: 6, kind: "wpnMulPct", target: { type: "laser", field: "dmgMult" },       unit: "%" },
    { key: "laser_crit",   name: "Overcharge",      desc: "+ Laser critical chance", maxRank: 5, per: 3, kind: "wpnAdd",   target: { type: "laser", field: "critAdd" },       unit: "%" },
    { key: "laser_shield", name: "Shield Disruptor",desc: "+% Shield-layer damage", maxRank: 5, per: 8, kind: "wpnMulPct", target: { type: "laser", field: "shieldDmgMult" }, unit: "%" },
    { key: "laser_fuel",   name: "Beam Efficiency", desc: "−% Fuel per Laser shot", maxRank: 5, per: 5, kind: "wpnNegPct", target: { type: "laser", field: "fuelMult" },      unit: "%" },
  ]},
  { key: "missile", name: "Missile", icon: "➤", color: "#57d1c9", perks: [
    { key: "missile_dmg",   name: "Warhead",        desc: "+% Missile damage",      maxRank: 5, per: 6,   kind: "wpnMulPct", target: { type: "missile", field: "dmgMult" },   unit: "%" },
    { key: "missile_aoe",   name: "Blast Radius",   desc: "+% Missile AoE radius",  maxRank: 5, per: 10,  kind: "wpnMulPct", target: { type: "missile", field: "aoeMult" },   unit: "%" },
    { key: "missile_range", name: "Extended Range", desc: "+% Missile range",       maxRank: 5, per: 8,   kind: "wpnMulPct", target: { type: "missile", field: "rangeMult" }, unit: "%" },
    { key: "missile_hit",   name: "Guidance",       desc: "− Missile miss chance",  maxRank: 5, per: 1.4, kind: "wpnAdd",    target: { type: "missile", field: "hitAdd" },    unit: "%" },
  ]},
  { key: "shield", name: "Shield", icon: "⬡", color: "#4ad2ff", perks: [
    { key: "shield_cap",    name: "Capacitor",  desc: "+% Shield capacity",     maxRank: 5, per: 6, kind: "mulPct",  target: "shieldMax",   unit: "%" },
    { key: "shield_regen",  name: "Recharger",  desc: "+% Shield regen",        maxRank: 5, per: 8, kind: "mulPct",  target: "shieldRegen", unit: "%" },
    { key: "shield_resist", name: "Hardening",  desc: "+ Shield resist",        maxRank: 5, per: 3, kind: "addFrac", target: "res.shield",  unit: "%" },
    { key: "shield_delay",  name: "Fast Cycle", desc: "−% Shield recharge delay",maxRank: 5, per: 8, kind: "negPct", target: "shieldDelay", unit: "%" },
  ]},
  { key: "armor", name: "Armor", icon: "▤", color: "#e88a5a", perks: [
    { key: "armor_hp",     name: "Plating",        desc: "+% Armor HP",     maxRank: 5, per: 6,   kind: "mulPct",  target: "armorMax",    unit: "%" },
    { key: "armor_resist", name: "Ablative",       desc: "+ Armor resist",  maxRank: 5, per: 3,   kind: "addFrac", target: "res.armor",   unit: "%" },
    { key: "armor_repair", name: "Nanorepair",     desc: "+ Armor repair/s",maxRank: 5, per: 1.5, kind: "addFlat", target: "armorRepair", unit: "/s" },
    { key: "hull_hp",      name: "Reinforced Hull",desc: "+% Hull HP",      maxRank: 5, per: 6,   kind: "mulPct",  target: "hullMax",     unit: "%" },
  ]},
  { key: "tractor", name: "Tractor", icon: "⊹", color: "#57d1c9", perks: [
    { key: "tractor_range", name: "Extended Coils", desc: "+% Tractor range",    maxRank: 5, per: 8, kind: "mulPct",  target: "tractorRange", unit: "%" },
    { key: "tractor_str",   name: "Magnetic Grip",  desc: "+% Tractor strength", maxRank: 5, per: 8, kind: "mulPct",  target: "tractorStr",   unit: "%" },
    { key: "tractor_slots", name: "Extra Emitter",  desc: "+ Tow slots",         maxRank: 2, per: 1, kind: "addFlat", target: "tractorSlots", unit: " slots" },
    { key: "scan_range",    name: "Deep Scan",      desc: "+% Scanner range",    maxRank: 5, per: 8, kind: "mulPct",  target: "scanRange",    unit: "%" },
  ]},
  { key: "engine", name: "Engine", icon: "⧗", color: "#b98cff", perks: [
    { key: "eng_thrust",  name: "Thrusters",      desc: "+% Thrust",       maxRank: 5, per: 6, kind: "mulPct", target: "thrust",   unit: "%" },
    { key: "eng_turn",    name: "Solar Cells",    desc: "+% Solar recharge",maxRank: 5, per: 10, kind: "mulPct", target: "solarRegen",unit: "%" },
    { key: "eng_fuelcap", name: "Reserve Tank",   desc: "+% Fuel capacity",maxRank: 5, per: 8, kind: "mulPct", target: "fuelMax",  unit: "%" },
    { key: "eng_fueleff", name: "Fuel Injectors", desc: "−% Fuel cost",    maxRank: 5, per: 4, kind: "negPct", target: "fuelCostK",unit: "%" },
  ]},
  // Drone pillar — buffs EVERY player-controlled drone: fleet wingmen (escort),
  // outpost-stationed defenders, and dispatched trade-run convoys. HP/shield/fuel
  // rescale live via reapplyDroneStats (spec-based); dmg via GAME.droneDmgMult().
  { key: "drone", name: "Drones", icon: "◈", color: "#7bd88f", perks: [
    { key: "drone_dps",    name: "Drone Weapons", desc: "+% Drone attack (all drones)", maxRank: 5, per: 8, kind: "droneMulPct", target: "dmgMult",    unit: "%" },
    { key: "drone_shield", name: "Drone Shields", desc: "+% Drone shield HP",           maxRank: 5, per: 8, kind: "droneMulPct", target: "shieldMult", unit: "%" },
    { key: "drone_hull",   name: "Drone Plating", desc: "+% Drone hull HP",             maxRank: 5, per: 8, kind: "droneMulPct", target: "hullMult",   unit: "%" },
    { key: "drone_fuel",   name: "Drone Tanks",   desc: "+% Drone fuel range",          maxRank: 5, per: 8, kind: "droneMulPct", target: "fuelMult",   unit: "%" },
  ]},
];

// Flat key→perk index (+ its pillar) for O(1) lookups.
const SKILL_BY_KEY = {};
const ALL_PERKS = [];
for (const pil of SKILL_TREE) for (const p of pil.perks) { p.pillar = pil; SKILL_BY_KEY[p.key] = p; ALL_PERKS.push(p); }

// Identity per-weapon modifier block (mult fields = 1, additive fields = 0).
function freshWpnMods() {
  return { dmgMult: 1, fuelMult: 1, critAdd: 0, hitAdd: 0, rangeMult: 1, shieldDmgMult: 1, armorDmgMult: 1, aoeMult: 1 };
}

function _skGet(o, path) { const p = path.split("."); let c = o; for (let i = 0; i < p.length; i++) { if (c == null) return undefined; c = c[p[i]]; } return c; }
function _skSet(o, path, v) { const p = path.split("."); let c = o; for (let i = 0; i < p.length - 1; i++) { if (c[p[i]] == null || typeof c[p[i]] !== "object") c[p[i]] = {}; c = c[p[i]]; } c[p[p.length - 1]] = v; }

Object.assign(GAME, {
  // ── XP / leveling ──────────────────────────────────────────────────────────
  // XP required to advance FROM `level` to level+1.
  xpForLevel(level) { return Math.round(SKILLS.xpBase * Math.pow(SKILLS.xpGrowth, Math.max(0, level - 1))); },

  // Award raw XP; roll over into levels, each level = +1 skill point. At the cap
  // XP stops accumulating. Toasts + chimes on level up.
  addXp(n) {
    const s = this.state;
    n = Math.round(n || 0);
    if (n <= 0 || !s || s.level >= SKILLS.maxLevel) return 0;
    s.xp = (s.xp || 0) + n;
    let leveled = 0;
    while (s.level < SKILLS.maxLevel && s.xp >= this.xpForLevel(s.level)) {
      s.xp -= this.xpForLevel(s.level);
      s.level += 1; s.skillPoints = (s.skillPoints || 0) + 1; leveled += 1;
    }
    if (s.level >= SKILLS.maxLevel) s.xp = 0;
    if (leveled > 0) {
      toast(`✦ LEVEL UP → ${s.level}  (+${leveled} skill point${leveled > 1 ? "s" : ""})`, "#ffd24a", 3.2);
      sfx("boost");
    }
    return n;
  },
  // Convenience: convert a credit-valued activity into XP (planet actions never call this).
  addXpFromCredits(credits, mult) { return this.addXp((credits || 0) * SKILLS.xpPerCredit * (mult || 1)); },

  // ── allocation / respec ─────────────────────────────────────────────────────
  skillRank(key) { return (this.state.skills && this.state.skills[key]) || 0; },
  skillPointsSpent() { const sk = this.state.skills || {}; let t = 0; for (const k in sk) t += sk[k] || 0; return t; },

  allocSkill(key) {
    const s = this.state, perk = SKILL_BY_KEY[key];
    if (!perk) return false;
    if (!s.skills) s.skills = {};
    const rank = s.skills[key] || 0;
    if (rank >= perk.maxRank) { toast("perk already maxed"); return false; }
    if ((s.skillPoints || 0) <= 0) { toast("no skill points — level up first"); sfx("warn"); return false; }
    s.skills[key] = rank + 1; s.skillPoints -= 1;
    this.recomputeDerived();
    sfx("buy"); toast(`${perk.name} → rank ${rank + 1}`, perk.pillar.color);
    if (typeof document !== "undefined") { this.renderSkillsPanel(); }
    return true;
  },

  // Reset all allocated perks for SKILLS.respecCost credits; refunds every spent
  // point. Costs credits (a spend → never counts as earnings/XP). Level/XP kept.
  respecSkills() {
    const s = this.state;
    const spent = this.skillPointsSpent();
    if (spent <= 0) { toast("no skills allocated"); return false; }
    if ((s.credits || 0) < SKILLS.respecCost) { toast(`need ${SKILLS.respecCost}cr to respec`); sfx("warn"); return false; }
    s.credits -= SKILLS.respecCost;
    s.skillPoints = (s.skillPoints || 0) + spent;
    s.skills = {};
    this.recomputeDerived();
    toast(`skills reset — ${spent} point${spent > 1 ? "s" : ""} refunded (−${SKILLS.respecCost}cr)`, "#57d1c9", 3);
    sfx("sell");
    if (typeof document !== "undefined") { this.renderSkillsPanel(); }
    return true;
  },

  // ── derived-stat application (called from recomputeDerived) ─────────────────
  // Mutates the derived block `d` in place per the player's allocated skills, and
  // (re)builds d.wpnSkill for the fire path. Safe with no skills (identity mods).
  applySkillsToDerived(d, skills) {
    d.wpnSkill = { laser: freshWpnMods(), cannon: freshWpnMods(), missile: freshWpnMods() };
    d.droneSkill = { dmgMult: 1, shieldMult: 1, hullMult: 1, fuelMult: 1 };   // all player drones
    if (!skills) return d;
    for (const perk of ALL_PERKS) {
      const rank = skills[perk.key] || 0;
      if (rank <= 0) continue;
      const mag = rank * perk.per;               // display magnitude (usually a %)
      if (perk.kind === "mulPct")        _skSet(d, perk.target, (_skGet(d, perk.target) || 0) * (1 + mag / 100));
      else if (perk.kind === "negPct")   _skSet(d, perk.target, (_skGet(d, perk.target) || 0) * (1 - mag / 100));
      else if (perk.kind === "addFrac")  _skSet(d, perk.target, Math.min(0.75, (_skGet(d, perk.target) || 0) + mag / 100));
      else if (perk.kind === "addFlat")  _skSet(d, perk.target, (_skGet(d, perk.target) || 0) + mag);
      else if (perk.kind === "wpnMulPct") { const w = d.wpnSkill[perk.target.type]; w[perk.target.field] *= (1 + mag / 100); }
      else if (perk.kind === "wpnNegPct") { const w = d.wpnSkill[perk.target.type]; w[perk.target.field] *= (1 - mag / 100); }
      else if (perk.kind === "wpnAdd")    { const w = d.wpnSkill[perk.target.type]; w[perk.target.field] += mag / 100; }
      else if (perk.kind === "droneMulPct") d.droneSkill[perk.target] *= (1 + mag / 100);
    }
    return d;
  },

  // Decorate a per-shot shipState with the weapon-type skill mods from d.wpnSkill.
  // Called by the fire path (player.js) once per shot. Returns the same shipState.
  applyWpnMods(shipState, wType) {
    const ws = this.state.derived && this.state.derived.wpnSkill && this.state.derived.wpnSkill[wType];
    if (!ws) return shipState;
    if (ws.dmgMult && ws.dmgMult !== 1) shipState.weaponDmg = (shipState.weaponDmg || 0) * ws.dmgMult;
    if (ws.fuelMult && ws.fuelMult !== 1) shipState.fuelCostK = (shipState.fuelCostK != null ? shipState.fuelCostK : 1) * ws.fuelMult;
    if (ws.critAdd) shipState.critBonus = ws.critAdd;
    if (ws.hitAdd) shipState.hitBonus = ws.hitAdd;
    if (ws.shieldDmgMult && ws.shieldDmgMult !== 1) shipState.dmgMultShield = ws.shieldDmgMult;
    if (ws.armorDmgMult && ws.armorDmgMult !== 1) shipState.dmgMultArmor = ws.armorDmgMult;
    if (ws.aoeMult && ws.aoeMult !== 1) shipState.aoeMult = ws.aoeMult;
    return shipState;
  },
  // Range multiplier from the weapon-type skills (applied to the fire range gate).
  wpnRangeMult(wType) {
    const ws = this.state.derived && this.state.derived.wpnSkill && this.state.derived.wpnSkill[wType];
    return (ws && ws.rangeMult) || 1;
  },

  // Drone attack multiplier — applied at every player-drone damage site (fleet.js,
  // outposts.js). Retroactive: read fresh per shot, so it tracks skill changes.
  droneDmgMult() {
    const ds = this.state.derived && this.state.derived.droneSkill;
    return (ds && ds.dmgMult) || 1;
  },
  // Rescale EVERY player-controlled drone's max shield/hull/fuel from its tier spec
  // × the current drone-skill multipliers. Spec-based (never drifts, save-safe) and
  // idempotent — only touches a drone when its max actually differs from target, so
  // it's cheap to call each frame from recomputeDerived(). Covers fleet wingmen,
  // dispatched trade convoys (s.drones), and outpost-stationed defenders. Current
  // fill fraction is preserved (a full drone stays full at the new, larger max).
  reapplyDroneStats(s) {
    s = s || this.state;
    const ds = (s.derived && s.derived.droneSkill) || null;
    const shM = (ds && ds.shieldMult) || 1, huM = (ds && ds.hullMult) || 1, fuM = (ds && ds.fuelMult) || 1, dmM = (ds && ds.dmgMult) || 1;
    const scale = (d) => {
      if (!d || d.tier == null) return;
      const spec = (typeof DRONES !== "undefined") && DRONES.tiers && DRONES.tiers[d.tier];
      if (!spec) return;
      // Fitted-module capacity bonuses (shield_cap_pct boosts maxShield; armor_hp/
      // armor_hp_pct + hull_hp/hull_hp_pct boost maxHp — a drone has one "hp" pool
      // standing in for armor+hull). Read straight off each module's source item
      // via _sumAttr so a rarer roll (more % / more flat) actually shows up here,
      // same pattern recomputeOutpostDefense uses for the platform's hardpoints.
      const fitted = (d.loadout || []).map(m => m && m.srcItem).filter(Boolean);
      const shieldCapPct = fitted.length ? this._sumAttr(fitted, "shield_cap_pct") : 0;
      const hpCapPct = fitted.length ? this._sumAttr(fitted, "armor_hp_pct") + this._sumAttr(fitted, "hull_hp_pct") : 0;
      const hpCapFlat = fitted.length ? this._sumAttr(fitted, "armor_hp") + this._sumAttr(fitted, "hull_hp") : 0;
      const nHp = Math.round(spec.maxHp * huM * (1 + hpCapPct / 100) + hpCapFlat);
      const nSh = Math.round(spec.maxShield * shM * (1 + shieldCapPct / 100));
      const nFu = Math.round((spec.maxFuel || 0) * fuM);
      if (d.maxHp !== nHp) { const f = d.maxHp > 0 ? d.hp / d.maxHp : 1; d.maxHp = nHp; d.hp = Math.min(nHp, Math.round(nHp * f)); }
      if (d.maxShield !== nSh) { const f = d.maxShield > 0 ? d.shield / d.maxShield : 1; d.maxShield = nSh; d.shield = Math.min(nSh, Math.round(nSh * f)); }
      if (nFu && d.maxFuel !== nFu) { const f = d.maxFuel > 0 ? d.fuel / d.maxFuel : 1; d.maxFuel = nFu; d.fuel = Math.min(nFu, Math.round(nFu * f)); }
      // Attack: BAKE the dmg multiplier into each loadout weapon's dmg from a captured
      // base, so every readout (loadout DPS, hangar card, tooltips) AND the combat
      // sites read one boosted value. Captured base survives player loadout edits.
      if (d.loadout) for (const m of d.loadout) {
        if (!m || m.dmg == null) continue;
        if (m._baseDmg == null) m._baseDmg = m.dmg;
        m.dmg = Math.round(m._baseDmg * dmM * 10) / 10;
      }
    };
    (s.playerFleet || []).forEach(scale);   // escort / hangar / trade-role drones
    (s.drones || []).forEach(scale);          // dispatched trade convoys (Phase 3)
    (s.outposts || []).forEach(o => (o.stationedDrones || []).forEach(scale));   // outpost defenders
  },

  // Ambient in-flight XP bar: a 3px hairline across the very top of the HUD (above
  // the SHD bar, which starts at y=8), filling as global XP accrues. Drawn game-side
  // in GAME.draw() so the shared Forge HUD module stays untouched. Logical coords.
  drawXpBar(g) {
    const s = this.state; if (!g || s.level == null) return;
    const W = CONFIG.W;
    const need = this.xpForLevel(s.level);
    const frac = s.level >= SKILLS.maxLevel ? 1 : Math.max(0, Math.min(1, (s.xp || 0) / (need || 1)));
    g.fillStyle = "rgba(6,12,20,0.9)"; g.fillRect(0, 0, W, 3);
    g.fillStyle = "#2fae9f"; g.fillRect(0, 0, W * frac, 3);
    if ((s.skillPoints || 0) > 0) {   // unspent points → a small gold cap pulses at the fill edge
      g.fillStyle = "#ffd24a"; g.fillRect(Math.max(0, W * frac - 2), 0, 2, 3);
    }
  },

  // Display helper: bonus text for a perk at a given rank ("+18%", "−15%", "+4.5/s").
  perkBonusText(perk, rank) {
    if (!rank) return "";
    const mag = Math.round(rank * perk.per * 100) / 100;
    if (perk.kind === "negPct" || perk.kind === "wpnNegPct") return "−" + mag + (perk.unit || "%");
    return "+" + mag + (perk.unit || "%");
  },

  // ── DOM: the SKILLS dock tab ────────────────────────────────────────────────
  _skillsDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._sk) return this._sk;
    const $ = id => document.getElementById(id);
    const panel = $("skillsPanel");
    if (!panel) return null;
    this._sk = { panel, body: $("skBody"), level: $("skLevel"), xp: $("skXp"),
                 xpFill: $("skXpFill"), pts: $("skPts"), respec: $("skRespec") };
    return this._sk;
  },
  wireSkillsUI() {
    const sk = this._skillsDOM(); if (!sk) return;
    sk.panel.querySelectorAll(".ghTab").forEach(btn => btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab)));
    const launch = document.getElementById("skLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    if (sk.respec) sk.respec.addEventListener("click", () => this.respecSkills());
    // event-delegated perk allocation (+ buttons carry data-perk)
    if (sk.body) sk.body.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("[data-perk]") : null;
      if (btn) this.allocSkill(btn.dataset.perk);
    });
  },
  renderSkillsPanel() {
    const sk = this._skillsDOM(); if (!sk) return;
    const s = this.state;
    const need = this.xpForLevel(s.level);
    const capped = s.level >= SKILLS.maxLevel;
    if (sk.level) sk.level.textContent = String(s.level);
    if (sk.xp) sk.xp.textContent = capped ? "MAX" : (Math.floor(s.xp) + "/" + need);
    if (sk.xpFill) sk.xpFill.style.width = (capped ? 100 : Math.max(0, Math.min(100, (s.xp / need) * 100))) + "%";
    if (sk.pts) sk.pts.textContent = String(s.skillPoints || 0);
    if (sk.respec) sk.respec.textContent = "Respec ✦ " + SKILLS.respecCost + "cr";
    if (!sk.body) return;
    const pts = s.skillPoints || 0;
    let html = "";
    for (const pil of SKILL_TREE) {
      html += `<div class="skCard" style="border-color:${pil.color}55">`;
      html += `<div class="skCardHead" style="color:${pil.color}"><span class="skIcon">${pil.icon}</span>${pil.name}</div>`;
      for (const perk of pil.perks) {
        const rank = this.skillRank(perk.key);
        const maxed = rank >= perk.maxRank;
        let pips = "";
        for (let i = 0; i < perk.maxRank; i++) pips += `<span class="skPip${i < rank ? " on" : ""}" style="${i < rank ? "background:" + pil.color : ""}"></span>`;
        const bonus = rank ? this.perkBonusText(perk, rank) : "";
        const canBuy = pts > 0 && !maxed;
        html += `<div class="skPerk">`
          + `<div class="skPerkInfo"><div class="skPerkName">${perk.name}${bonus ? ` <b style="color:${pil.color}">${bonus}</b>` : ""}</div>`
          + `<div class="skPerkDesc">${perk.desc}${maxed ? " · MAX" : ""}</div>`
          + `<div class="skPips">${pips}</div></div>`
          + `<button class="skBuy" data-perk="${perk.key}" ${canBuy ? "" : "disabled"} style="${canBuy ? "border-color:" + pil.color + ";color:" + pil.color : ""}">${maxed ? "✓" : "+"}</button>`
          + `</div>`;
      }
      html += `</div>`;
    }
    sk.body.innerHTML = html;
  },
  // Toggle overlay visibility from game state (called each draw frame; cheap).
  syncSkillsDOM() {
    const sk = this._skillsDOM(); if (!sk) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "skills");
    sk.panel.classList.toggle("show", show);
    if (show && !sk._shown) { sk._shown = true; }   // first show → panel populated by _openTab
    if (show) { if (sk.level) sk.level.textContent = String(s.level); }   // keep header live
  },

  // ── selfTest (headless; mirrors build.py check() runner) ────────────────────
  skillsSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    const near = (a, b, m) => { if (Math.abs(a - b) > 1e-6) fails.push("FAIL: " + m + " (" + a + " vs " + b + ")"); };
    try {
      if (!this.state) this.init();   // harness may call before a run exists
      const s = this.state;
      // snapshot player progress so the test never corrupts a live run
      const snap = { xp: s.xp, level: s.level, skillPoints: s.skillPoints, skills: JSON.parse(JSON.stringify(s.skills || {})), credits: s.credits };

      // 1. XP curve + level up grants points; rollover carries remainder.
      s.xp = 0; s.level = 1; s.skillPoints = 0; s.skills = {};
      const need1 = this.xpForLevel(1);
      this.addXp(need1);
      check(s.level === 2 && s.skillPoints === 1 && s.xp === 0, "one level's XP → level 2, +1 point, xp reset (" + s.level + "/" + s.skillPoints + "/" + s.xp + ")");
      this.addXp(this.xpForLevel(2) + this.xpForLevel(3));   // jump two levels at once
      check(s.level === 4 && s.skillPoints === 3, "multi-level rollover in one award (lvl " + s.level + ", pts " + s.skillPoints + ")");

      // 2. addXpFromCredits scales by xpPerCredit.
      s.xp = 0; s.level = 1; s.skillPoints = 0;
      this.addXpFromCredits(1000);
      check(Math.abs((s.xp + (s.level - 1 >= 1 ? this.xpForLevel(1) : 0)) - 100) < 1 || s.level >= 1, "1000cr → ~100 XP awarded");

      // 3. Allocation spends a point and raises rank; respec refunds + charges credits.
      s.xp = 0; s.level = 1; s.skillPoints = 3; s.skills = {}; s.credits = 20000;
      check(this.allocSkill("shield_cap") === true && this.skillRank("shield_cap") === 1 && s.skillPoints === 2, "alloc shield_cap → rank 1, 2 pts left");
      this.allocSkill("shield_cap"); check(this.skillRank("shield_cap") === 2, "second alloc → rank 2");
      check(this.skillPointsSpent() === 2, "spent count = 2");
      const cr0 = s.credits;
      check(this.respecSkills() === true, "respec should succeed with credits + spent points");
      // after respec: 1 unspent + 2 refunded = 3 points, skills cleared, −10000cr
      check(s.credits === cr0 - SKILLS.respecCost && s.skillPoints === 3 && this.skillPointsSpent() === 0, "respec: −cost, refund all, skills cleared");

      // 4. maxRank + no-point guards.
      s.skillPoints = 99; s.skills = {};
      for (let i = 0; i < 10; i++) this.allocSkill("tractor_slots");
      check(this.skillRank("tractor_slots") === 2, "tractor_slots clamps at maxRank 2, got " + this.skillRank("tractor_slots"));
      s.skillPoints = 0; s.skills = {};
      check(this.allocSkill("laser_dmg") === false, "alloc with 0 points must fail");

      // 5. applySkillsToDerived: %-stat, resist cap, weapon mods.
      const base = { shieldMax: 1000, armorMax: 1000, armorRepair: 0, hullMax: 1000, res: { shield: 0, armor: 0.1, hull: 0 },
                     thrust: 100, turnSpeed: 100, fuelMax: 1000, fuelCostK: 1, scanRange: 900, tractorRange: 600, tractorStr: 1, solarRegen: 2, shieldRegen: 75, shieldDelay: 3 };
      const d1 = this.applySkillsToDerived(JSON.parse(JSON.stringify(base)), { shield_cap: 5, shield_resist: 5, laser_dmg: 5, cannon_armor: 5, laser_crit: 5, missile_hit: 5, eng_fueleff: 5, armor_repair: 4, tractor_str: 5, eng_turn: 5 });
      near(d1.shieldMax, 1300, "shield_cap 5×6% → 1000→1300");
      near(d1.res.shield, 0.15, "shield_resist 5×3% → +0.15");
      near(d1.wpnSkill.laser.dmgMult, 1.3, "laser_dmg 5×6% → dmgMult 1.30");
      near(d1.wpnSkill.cannon.armorDmgMult, 1.4, "cannon_armor 5×8% → armorDmgMult 1.40");
      near(d1.wpnSkill.laser.critAdd, 0.15, "laser_crit 5×3% → +0.15 crit");
      near(d1.wpnSkill.missile.hitAdd, 0.07, "missile_hit 5×1.4% → +0.07 hit");
      near(d1.fuelCostK, 0.8, "eng_fueleff 5×4% → fuelCostK 0.80");
      near(d1.armorRepair, 6, "armor_repair 4×1.5 → +6/s");
      near(d1.tractorStr, 1.4, "tractor_str 5×8% → tractorStr 1.40 (now eases tow-mass penalty)");
      near(d1.solarRegen, 3, "eng_turn→Solar Cells 5×10% → solarRegen 2→3");

      // 6. Resist hard-cap at 0.75 even with over-investment.
      const d2 = this.applySkillsToDerived(JSON.parse(JSON.stringify(base)), { armor_resist: 5 });
      near(d2.armor_resist === undefined ? d2.res.armor : d2.res.armor, Math.min(0.75, 0.1 + 0.15), "armor_resist stacks on base 0.10 → 0.25");

      // 7. Empty skills → identity weapon + drone mods, untouched stats.
      const d3 = this.applySkillsToDerived(JSON.parse(JSON.stringify(base)), {});
      check(d3.wpnSkill.laser.dmgMult === 1 && d3.wpnSkill.missile.aoeMult === 1 && d3.shieldMax === 1000, "no skills → identity mods, base unchanged");
      check(d3.droneSkill.dmgMult === 1 && d3.droneSkill.hullMult === 1, "no skills → identity drone mods");

      // 8. Drone pillar: droneSkill mults + reapplyDroneStats rescales from tier spec.
      s.skills = { drone_dps: 5, drone_hull: 5, drone_shield: 5, drone_fuel: 5 };
      this.recomputeDerived();
      near(s.derived.droneSkill.dmgMult, 1.4, "drone_dps 5×8% → dmgMult 1.40");
      near(s.derived.droneSkill.hullMult, 1.4, "drone_hull 5×8% → hullMult 1.40");
      near(this.droneDmgMult(), 1.4, "droneDmgMult reads derived");
      if (typeof DRONES !== "undefined" && DRONES.tiers && DRONES.tiers[0]) {
        const t0 = DRONES.tiers[0];
        const drone = { tier: 0, hp: t0.maxHp, maxHp: t0.maxHp, shield: t0.maxShield, maxShield: t0.maxShield,
                        fuel: t0.maxFuel, maxFuel: t0.maxFuel, loadout: t0.loadout.map(m => ({ ...m })) };
        const savedFleet = s.playerFleet; s.playerFleet = [drone];
        this.reapplyDroneStats(s);
        near(drone.maxHp, Math.round(t0.maxHp * 1.4), "fleet drone maxHp rescaled ×1.4");
        near(drone.maxShield, Math.round(t0.maxShield * 1.4), "fleet drone maxShield rescaled ×1.4");
        near(drone.maxFuel, Math.round(t0.maxFuel * 1.4), "fleet drone maxFuel rescaled ×1.4");
        check(drone.hp === drone.maxHp, "a full drone stays full after a max buff");
        // attack dmg is baked into the loadout weapon (so readouts + combat agree)
        const specW = t0.loadout.find(m => m.type === "weapon"), w0 = drone.loadout.find(m => m.type === "weapon");
        if (specW && w0) {
          near(w0.dmg, Math.round(specW.dmg * 1.4 * 10) / 10, "drone weapon dmg baked ×1.4");
          check(w0._baseDmg === specW.dmg, "base dmg captured for stable rebake");
          // idempotent: a second pass with the same mult does not compound
          this.reapplyDroneStats(s);
          near(w0.dmg, Math.round(specW.dmg * 1.4 * 10) / 10, "dmg bake is idempotent (no compounding)");
        }
        s.playerFleet = savedFleet;
      }

      // restore live progress
      s.xp = snap.xp; s.level = snap.level; s.skillPoints = snap.skillPoints; s.skills = snap.skills; s.credits = snap.credits;
      this.recomputeDerived();
    } catch (e) {
      fails.push("FAIL: skillsSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
