/*=== HARNESS:OBJECTIVES =====================================================*/
// Phase 6 — per-territory passive meta-objectives. Every one of the 10
// political territories (game/regions.js) carries four goals that track
// automatically — no accept step, no quest log entry:
//   outposts   hold 5 / hold 10 / hold ALL outposts in the territory
//   shipwrecks discover 3 shipwreck sites in the territory
//   pirates    kill 50 pirates (nox ships) whose SPAWN point was in the territory
//   battles    fight 25 battles inside the territory (a battle = a combat
//              window ≥3s long that killed ≥1 enemy; credited to the territory
//              where most of its kills landed)
// Outpost and wreck progress is computed LIVE from the lineage layer
// (game/lineage.js) — no counters to drift. Pirate kills and battles are the
// only persisted counters; they ride the save (game/save.js) together with the
// one-time `claimed` milestone flags, so rewards can never double-grant on
// reload. Rewards: credits (outposts), +1 permanent tow/cargo slot (wrecks —
// recomputeDerived reads objectiveCargoBonus), +10% player weapon damage while
// flying that territory (pirates — fire paths read territoryDamageMult), and a
// 10% store discount at the territory's station (battles — the dock's onBuy
// refunds through territoryDiscount).
const OBJECTIVES = {
  combatR: 2500,        // an aggroed hostile inside this range keeps a battle window open
  battleMinT: 3,        // seconds of combat a window needs to count as a battle
  battleGrace: 6,       // seconds of quiet before the window closes and settles
  pirateKillTarget: 50, battleTarget: 25, wreckTarget: 3,
  milestones: {         // one-time rewards; `claimed` flags persist in the save
    outpost5:   { credits: 500,  short: "hold 5 outposts",     reward: "+500cr" },
    outpost10:  { credits: 1500, short: "hold 10 outposts",    reward: "+1500cr" },
    outpostAll: { credits: 5000, short: "hold every outpost",  reward: "+5000cr" },
    wrecks3:    { credits: 0,    short: "chart 3 shipwrecks",  reward: "+1 cargo slot" },
    kills50:    { credits: 0,    short: "down 50 pirates",     reward: "+10% dmg here" },
    battles25:  { credits: 0,    short: "fight 25 battles",    reward: "10% store discount" },
  },
};

Object.assign(GAME, {
  initObjectives(s) {
    s = s || this.state;
    s.territoryObjectives = {};
    for (const t of REGIONS) s.territoryObjectives[t.id] = { pirateKills: 0, battles: 0, claimed: {} };
    s._battle = null;             // open combat window { t, quiet, kills:{territoryId:n} } (session-only)
    s.mapTerritoryPanel = null;   // galaxy-map panel target (session-only)
    this._objSweepT = 0;
  },
  _objEntry(tid) {
    const s = this.state;
    if (!s.territoryObjectives) s.territoryObjectives = {};
    return s.territoryObjectives[tid] || (s.territoryObjectives[tid] = { pirateKills: 0, battles: 0, claimed: {} });
  },
  territoryObjectiveState(tid) { return this._objEntry(tid); },

  // ---- live progress (lineage-derived — nothing to persist) ----------------
  territoryOutpostStats(territoryName) {
    let held = 0, total = 0;
    for (const e of ownablesOfTerritory(territoryName))
      if (e.type === "outpost") { total++; if (e.entity.owner === "player") held++; }
    return { held, total };
  },
  territoryWreckStats(territoryName) {
    let found = 0, total = 0;
    for (const e of ownablesOfTerritory(territoryName))
      if (e.type === "site" && e.entity.type === "shipwreck") { total++; if (e.entity.discovered) found++; }
    return { found, total };
  },
  // all six objective rows for one territory — the single source of truth the
  // milestone sweep AND the map panel read (max 0 = not achievable → ignored)
  _objRows(t, e) {
    const o = this.territoryOutpostStats(t.name), w = this.territoryWreckStats(t.name);
    return [
      { key: "outpost5",   cur: o.held,        max: o.total ? Math.min(5, o.total) : 0 },
      { key: "outpost10",  cur: o.held,        max: o.total ? Math.min(10, o.total) : 0 },
      { key: "outpostAll", cur: o.held,        max: o.total },
      { key: "wrecks3",    cur: w.found,       max: w.total ? Math.min(OBJECTIVES.wreckTarget, w.total) : 0 },
      { key: "kills50",    cur: e.pirateKills, max: OBJECTIVES.pirateKillTarget },
      { key: "battles25",  cur: e.battles,     max: OBJECTIVES.battleTarget },
    ].map(r => Object.assign({}, OBJECTIVES.milestones[r.key], r,
      { done: r.max > 0 && r.cur >= r.max, claimed: !!e.claimed[r.key] }));
  },

  // ---- milestone sweep (one-time grants; claimed flags persist) ------------
  checkTerritoryMilestones() {
    const s = this.state;
    if (!s.territoryObjectives || !s.regions || !s.regions.length) return;
    for (const t of REGIONS) {
      const e = this._objEntry(t.id);
      for (const row of this._objRows(t, e)) {
        if (row.claimed || !row.done) continue;
        e.claimed[row.key] = true;   // flag first — grant() may recompute off it
        this._objGrant(t, row);
      }
    }
  },
  _objGrant(t, row) {
    const s = this.state, def = OBJECTIVES.milestones[row.key];
    if (def.credits) s.credits += def.credits;
    if (row.key === "wrecks3") this.recomputeDerived();   // the extra tow slot lands immediately
    toast("★ " + t.name.toUpperCase() + " — " + def.short + ": " + def.reward, "#ffd24a");
    sfx("sell");
    this.saveGame();
  },

  // ---- reward taps the rest of the game reads -------------------------------
  // +1 tow/cargo slot per territory whose 3-shipwreck milestone is claimed
  // (player.js recomputeDerived adds this to tractorSlots AND the hard cap)
  objectiveCargoBonus() {
    const all = this.state && this.state.territoryObjectives;
    if (!all) return 0;
    let n = 0;
    for (const tid in all) if (all[tid].claimed && all[tid].claimed.wrecks3) n++;
    return n;
  },
  // +10% player weapon damage while INSIDE a territory with kills50 claimed
  territoryDamageMult(x, y) {
    const all = this.state && this.state.territoryObjectives;
    if (!all) return 1;
    const t = politicalRegionAt(x, y);
    return t && all[t.id] && all[t.id].claimed.kills50 ? 1.10 : 1;
  },
  // 10% store discount at the station of a territory with battles25 claimed
  // (ui.js refunds it through the dock store's onBuy callback)
  territoryDiscount(station) {
    const all = this.state && this.state.territoryObjectives, p = station && station.pos;
    if (!all || !p) return 0;
    const t = politicalRegionAt(p.x, p.y);
    return t && all[t.id] && all[t.id].claimed.battles25 ? 0.10 : 0;
  },

  // ---- tracking hooks -------------------------------------------------------
  // player.js onAlienKilled funnels EVERY ship kill through here (player guns,
  // fleet drones, friendly outpost turrets, raid resolutions)
  onObjectiveKill(al) {
    const s = this.state;
    if (!s.territoryObjectives || !al || al.kind === "enemyBase") return;
    // pirate ledger: nox are the pirate faction; credit the SPAWN territory
    // (updateObjectives stamps _spawnX/_spawnY the first frame a ship exists)
    if (al.faction === "nox") {
      const t = politicalRegionAt(al._spawnX != null ? al._spawnX : al.x,
                                  al._spawnY != null ? al._spawnY : al.y);
      if (t) this._objEntry(t.id).pirateKills++;
    }
    // battle ledger: a kill opens (or refreshes) the combat window and logs
    // where the enemy DIED — the window settles in updateObjectives
    const kt = politicalRegionAt(al.x, al.y);
    if (kt) {
      if (!s._battle) s._battle = { t: 0, quiet: 0, kills: {} };
      s._battle.quiet = 0;
      s._battle.kills[kt.id] = (s._battle.kills[kt.id] || 0) + 1;
    }
    this.checkTerritoryMilestones();
  },

  // per-frame (main.js update, after updateQuests)
  updateObjectives(dt) {
    const s = this.state;
    if (!s.territoryObjectives) return;
    // stamp spawn positions — every spawn path pushes into s.aliens, so the
    // first frame a ship exists IS its spawn point (kill attribution reads it)
    for (const al of s.aliens) if (al._spawnX == null && typeof al.x === "number") { al._spawnX = al.x; al._spawnY = al.y; }
    // battle window: open while an aggroed hostile is near, settle after quiet
    const inCombat = !s.dead && s.aliens.some(a =>
      a.aggro && a.state !== "DEAD" && a.hp && a.hp.hull > 0 &&
      this.dist(s.x, s.y, a.x, a.y) < OBJECTIVES.combatR);
    if (s._battle) {
      if (inCombat) { s._battle.t += dt; s._battle.quiet = 0; }
      else if ((s._battle.quiet += dt) >= OBJECTIVES.battleGrace) this._closeBattle();
    } else if (inCombat) s._battle = { t: 0, quiet: 0, kills: {} };
    // slow sweep — outpost captures and wreck discoveries happen outside kills
    this._objSweepT = (this._objSweepT || 0) + dt;
    if (this._objSweepT >= 1) { this._objSweepT = 0; this.checkTerritoryMilestones(); }
  },
  _closeBattle() {
    const s = this.state, b = s._battle;
    s._battle = null;
    if (!b || b.t < OBJECTIVES.battleMinT) return;   // too short, or no window
    let tid = null, best = 0;
    for (const id in b.kills) if (b.kills[id] > best) { best = b.kills[id]; tid = id; }
    if (!tid) return;                                // no enemy died — not a battle
    const e = this._objEntry(tid), t = getRegion(tid);
    e.battles++;
    if (t && e.battles <= OBJECTIVES.battleTarget)
      toast("⚔ battle logged — " + t.name + " (" + e.battles + "/" + OBJECTIVES.battleTarget + ")", "#b06cff");
    this.checkTerritoryMilestones();
  },

  // ---- persistence (whitelisted by game/save.js) ----------------------------
  _serializeObjectives() {
    const all = this.state.territoryObjectives || {}, out = {};
    for (const t of REGIONS) {
      const e = all[t.id];
      if (e) out[t.id] = { pirateKills: e.pirateKills | 0, battles: e.battles | 0,
        claimed: Object.assign({}, e.claimed) };
    }
    return out;
  },
  _applyObjectivesData(data) {
    if (!data || typeof data !== "object") return;   // pre-Phase-6 save → fresh counters
    for (const t of REGIONS) {
      const rec = data[t.id];
      if (!rec) continue;
      const e = this._objEntry(t.id);
      e.pirateKills = Math.max(0, rec.pirateKills | 0);
      e.battles = Math.max(0, rec.battles | 0);
      e.claimed = {};
      if (rec.claimed) for (const k of Object.keys(OBJECTIVES.milestones)) if (rec.claimed[k]) e.claimed[k] = true;
    }
    if (this.objectiveCargoBonus() > 0) this.recomputeDerived();   // restored wreck slots
  },

  // ================= galaxy-map territory panel (P6c) ========================
  // Tap a wedge on the open galaxy map → this panel; tap its ✕ (or open space
  // outside the disc, or the same wedge again) → closed. Screen-space overlay,
  // so it ignores the mapPoint pan/zoom funnel entirely.
  _territoryPanelRect() {
    return { x: 12, y: 120, w: Math.min(240, CONFIG.W - 24), h: 262 };
  },
  galaxyMapTerritoryClick(x, y) {
    const s = this.state, hit = (r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
    if (s.mapTerritoryPanel != null) {
      const r = this._territoryPanelRect();
      if (hit({ x: r.x + r.w - 32, y: r.y + 4, w: 28, h: 24 })) { s.mapTerritoryPanel = null; sfx("drop"); return true; }
      if (hit(r)) return true;   // taps inside the panel never fall through to the map
    }
    const w = this.mapWorldAt(x, y);
    const t = Math.hypot(w.x, w.y) <= CONFIG.WORLD_RADIUS ? politicalRegionAt(w.x, w.y) : null;
    if (!t) {   // off the disc: close an open panel, otherwise not ours
      if (s.mapTerritoryPanel != null) { s.mapTerritoryPanel = null; sfx("drop"); return true; }
      return false;
    }
    s.mapTerritoryPanel = s.mapTerritoryPanel === t.id ? null : t.id;
    sfx("grab");
    return true;
  },
  // full panel data model — headless-testable without a canvas
  territoryPanelModel(tid) {
    const t = getRegion(tid);
    if (!t || !this.state.territoryObjectives) return null;
    const st = stationOfTerritory(t.name);
    return { id: t.id, name: t.name, faction: t.faction, controller: t.controller,
      dangerLevel: t.dangerLevel, station: st ? st.name : "—",
      rows: this._objRows(t, this._objEntry(t.id)) };
  },
  drawTerritoryPanelOverlay(g) {   // drawGalaxyMap calls this last (topmost)
    if (HEADLESS) return;
    const s = this.state;
    if (s.mapTerritoryPanel == null) return;
    const m = this.territoryPanelModel(s.mapTerritoryPanel);
    if (m) this.drawTerritoryPanel(g, m);
  },
  drawTerritoryPanel(g, m) {   // pure ctx+model → the selfTest drives it with a stub ctx
    const r = this._territoryPanelRect();
    g.fillStyle = "rgba(10,16,24,0.94)"; g.strokeStyle = "#2b3648"; g.lineWidth = 1;
    g.beginPath();
    if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, 10); else g.rect(r.x, r.y, r.w, r.h);
    g.fill(); g.stroke();
    g.textAlign = "left";
    let y = r.y + 20;
    g.fillStyle = dangerColor(m.dangerLevel); g.font = "bold 11px monospace";
    g.fillText(m.name.toUpperCase() + "  [" + m.dangerLevel + "]", r.x + 12, y);
    g.fillStyle = "#9aa7b8"; g.font = "bold 12px monospace";
    g.fillText("✕", r.x + r.w - 24, y);
    y += 16;
    g.fillStyle = "#9aa7b8"; g.font = "9px monospace";
    g.fillText(m.faction.toUpperCase() + " space · held by " + String(m.controller).toUpperCase(), r.x + 12, y); y += 13;
    g.fillText("station: " + m.station, r.x + 12, y); y += 18;
    g.fillStyle = "#57d1c9"; g.font = "bold 9px monospace";
    g.fillText("TERRITORY OBJECTIVES", r.x + 12, y); y += 12;
    const barW = r.w - 24;
    for (const row of m.rows) {
      const done = row.claimed || row.done;
      g.fillStyle = done ? "#7bd88f" : "#c7d2e0"; g.font = "9px monospace";
      g.fillText((done ? "✔ " : "· ") + row.short, r.x + 12, y);
      g.textAlign = "right";
      g.fillStyle = row.claimed ? "#7bd88f" : "#8fd0ff";
      g.fillText(row.claimed ? row.reward + " ✓" : row.reward, r.x + r.w - 12, y);
      g.textAlign = "left";
      y += 6;
      const frac = row.max > 0 ? Math.min(1, row.cur / row.max) : 0;
      g.fillStyle = "#1c2430"; g.fillRect(r.x + 12, y, barW, 5);
      g.fillStyle = done ? "#7bd88f" : "#57d1c9"; g.fillRect(r.x + 12, y, barW * frac, 5);
      y += 9;
      g.fillStyle = "#5a6a82"; g.font = "8px monospace";
      g.fillText(row.cur + " / " + row.max, r.x + 12, y);
      y += 14;
    }
  },

  // ---- selfTest (build.py --check wires this in) ----------------------------
  _objStubCtx(ops) {   // hud.js makeStubCtx pattern + roundRect (the panel uses it)
    const names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
      "rect", "roundRect", "fill", "stroke", "fillRect", "strokeRect", "clearRect", "fillText", "clip"];
    const c = {};
    for (const n of names) c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); };
    c.measureText = (t) => ({ width: String(t == null ? "" : t).length * 6 });
    c.setLineDash = () => {};
    c.createLinearGradient = c.createRadialGradient = () => ({ addColorStop() {} });
    return c;
  },
  objectivesSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;

      // 1. all 10 territories initialized + panel model + stub-ctx render + map tap
      for (const t of REGIONS) {
        const e = this.territoryObjectiveState(t.id);
        check(e && e.pirateKills === 0 && e.battles === 0 && typeof e.claimed === "object",
          "territory '" + t.name + "' objective state not initialized");
        const m = this.territoryPanelModel(t.id);
        check(!!m && m.rows.length === 6 && m.name === t.name && typeof m.station === "string" && m.station !== "—",
          "panel model broken for '" + t.name + "'");
        const ops = [];
        this.drawTerritoryPanel(this._objStubCtx(ops), m);
        const texts = ops.filter(o => o[0] === "fillText").map(o => String(o[1][0]));
        check(texts.some(x => x.indexOf(t.name.toUpperCase()) >= 0), "panel must draw the name of " + t.name);
        check(texts.length >= 13, "panel drew only " + texts.length + " text ops for " + t.name);
        this.mapZoomReset();
        const cell = this.regionGet(regionsOfTerritory(t.name)[0]);
        const p = this.mapPoint(cell.cx, cell.cy);
        s.mapTerritoryPanel = null;
        check(this.galaxyMapTerritoryClick(p.x, p.y) && s.mapTerritoryPanel === t.id,
          "map tap must open the panel for " + t.name);
      }
      s.mapTerritoryPanel = null;

      // 2. milestones fire exactly ONCE (credits + the permanent cargo slot)
      const tOut = REGIONS.find(t => this.territoryOutpostStats(t.name).total >= 5);
      check(!!tOut, "no territory holds ≥5 outposts (seedOutposts changed?)");
      const outEntries = ownablesOfTerritory(tOut.name).filter(x => x.type === "outpost");
      for (let i = 0; i < 5; i++) outEntries[i].entity.owner = "player";
      const cr0 = s.credits;
      this.checkTerritoryMilestones();
      check(s.credits === cr0 + 500, "outpost5 must grant +500cr (got +" + (s.credits - cr0) + ")");
      check(this.territoryObjectiveState(tOut.id).claimed.outpost5 === true, "outpost5 not flagged claimed");
      this.checkTerritoryMilestones();
      check(s.credits === cr0 + 500, "outpost5 must never grant twice");

      const tWr = REGIONS.find(t => this.territoryWreckStats(t.name).total >= 3);
      check(!!tWr, "no territory holds ≥3 shipwreck sites (seedSites changed?)");
      const wrecks = ownablesOfTerritory(tWr.name).filter(x => x.type === "site" && x.entity.type === "shipwreck");
      const cap0 = s.towsCap;
      for (let i = 0; i < 3; i++) wrecks[i].entity.discovered = true;
      this.checkTerritoryMilestones();
      check(this.objectiveCargoBonus() === 1, "wrecks3 must add exactly one cargo bonus");
      check(s.towsCap === cap0 + 1, "cargo slot must land on towsCap (was " + cap0 + ", now " + s.towsCap + ")");
      this.checkTerritoryMilestones();
      check(this.objectiveCargoBonus() === 1 && s.towsCap === cap0 + 1, "wrecks3 must never grant twice");

      // 3. pirate kills credit the SPAWN territory, and only nox count
      const ridA = regionsOfTerritory(REGIONS[0].name)[0], ridB = regionsOfTerritory(REGIONS[5].name)[0];
      const cellA = this.regionGet(ridA), cellB = this.regionGet(ridB);
      const eA = this.territoryObjectiveState(REGIONS[0].id), eB = this.territoryObjectiveState(REGIONS[5].id);
      const k0A = eA.pirateKills, k0B = eB.pirateKills;
      s.aliens = [];
      const pir = ForgeFaction.generateAlienShip("nox", "normal", { rng: rnd, x: cellA.cx, y: cellA.cy });
      s.aliens.push(pir);
      this.updateObjectives(1 / 60);   // stamps _spawnX/_spawnY
      check(pir._spawnX === cellA.cx && pir._spawnY === cellA.cy, "spawn stamp missing");
      pir.x = cellB.cx; pir.y = cellB.cy;   // drifted into another territory before dying
      this.onAlienKilled(pir);
      check(eA.pirateKills === k0A + 1, "pirate kill must credit the SPAWN territory");
      check(eB.pirateKills === k0B, "pirate kill must NOT credit the death territory");
      const vex = ForgeFaction.generateAlienShip("vex", "normal", { rng: rnd, x: cellA.cx, y: cellA.cy });
      s.aliens.push(vex); this.updateObjectives(1 / 60);
      this.onAlienKilled(vex);
      check(eA.pirateKills === k0A + 1, "non-nox kills must not count as pirates");

      // 4. battles: ≥3s of combat + ≥1 kill logs one battle; a <3s skirmish doesn't
      s._battle = null; s.aliens = [];
      s.x = cellA.cx; s.y = cellA.cy; s.vx = s.vy = 0;
      const b0 = eA.battles;
      const foe = ForgeFaction.generateAlienShip("nox", "normal", { rng: rnd, x: cellA.cx + 300, y: cellA.cy });
      foe.aggro = true; s.aliens.push(foe);
      for (let i = 0; i < 200; i++) this.updateObjectives(1 / 60);   // ~3.3s of live combat
      check(!!s._battle && s._battle.t >= OBJECTIVES.battleMinT, "combat window must accumulate time");
      foe.x = cellA.cx; foe.y = cellA.cy;
      this.onAlienKilled(foe);
      for (let i = 0; i < 60 * 7; i++) this.updateObjectives(1 / 60);   // 7s quiet → settle
      check(s._battle === null, "battle window must close after the quiet grace");
      check(eA.battles === b0 + 1, "a ≥3s battle with a kill must count (got " + (eA.battles - b0) + ")");
      const foe2 = ForgeFaction.generateAlienShip("nox", "normal", { rng: rnd, x: cellA.cx + 300, y: cellA.cy });
      foe2.aggro = true; s.aliens.push(foe2);
      for (let i = 0; i < 60; i++) this.updateObjectives(1 / 60);   // only ~1s of combat
      foe2.x = cellA.cx; foe2.y = cellA.cy;
      this.onAlienKilled(foe2);
      for (let i = 0; i < 60 * 7; i++) this.updateObjectives(1 / 60);
      check(eA.battles === b0 + 1, "a sub-3s skirmish must not log a battle");

      // 5. save round-trip: counters + claimed flags persist, nothing re-grants
      const expPirates = eA.pirateKills, expBattles = eA.battles;   // the battle kills above were nox too
      const blob = JSON.parse(JSON.stringify(this.serializeGame()));
      this.init();
      check(this.applySaveData(blob) === true, "applySaveData rejected the blob");
      const s2 = this.state;
      const rA = this.territoryObjectiveState(REGIONS[0].id);
      check(rA.pirateKills === expPirates && rA.battles === expBattles, "counters must survive the save round-trip");
      check(expPirates > 0 && expBattles > 0, "round-trip must exercise non-zero counters");
      check(this.territoryObjectiveState(tOut.id).claimed.outpost5 === true &&
            this.territoryObjectiveState(tWr.id).claimed.wrecks3 === true, "claimed flags must survive the round-trip");
      check(this.objectiveCargoBonus() === 1 && s2.towsCap === cap0 + 1, "restored cargo bonus must reach towsCap");
      const crR = s2.credits;
      this.checkTerritoryMilestones();
      check(s2.credits === crR, "restored milestones must not re-grant on reload");

      this.init();   // leave a clean world behind (the walk moved the ship)
    } catch (e) {
      fails.push("FAIL: objectivesSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
