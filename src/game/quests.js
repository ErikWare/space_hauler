/*=== HARNESS:QUESTS =========================================================*/
// Phase 5 — station region quests. Every station dock refreshes a quest board
// (3-5 offers) BESIDE the mercenary contracts; targets come from the lineage
// layer (game/lineage.js), never from "near me" geometry — a station only ever
// sends the player into R-#### cells of its OWN territory. Two shapes:
//   godo  — go-do-return: survey a site (hold nearby until the scan fills),
//           clear a site's defenders, or recover a drifting cache; then dock
//           back at the issuer for the reward.
//   chain — 3-tier sensor net: place sensors at 3 sites/outposts across the
//           territory, ANY order; tier progress lives on the quest object so a
//           placed sensor survives death (respawn never touches s.quests).
// The player holds any number of quests but tracks ONE (s.activeQuestId): only
// the active quest drives s.navWaypoint (the existing galaxy-map waypoint) and
// only the active quest arms the defender boost — +1-2 extra garrison ships
// stream in near its target while the player approaches, recorded as
// guardRec-style {frac,alive} entries on the quest (dead stays dead), and
// despawned the moment the quest is completed, abandoned, or untracked.
const QUESTS = {
  perStationMin: 3, perStationMax: 5,      // offers per dock (board refreshes like contracts)
  chainW: 0.35, chainTiers: 3,             // sensor-net weight + tier count
  chainRewardMult: 1.6,                    // chains pay more (3 stops + the flight home)
  multiW: 0.18,                            // single-site multi-tier "relic dig" weight (alien sites only)
  relicRewardMult: 1.9,                    // relic digs pay most (clear + breach + extract + the flight home)
  rewards: { 1: [250, 600], 2: [600, 1400], 3: [1400, 3200] },   // by contract distance band
  scanR: 700, scanHold: 3,                 // survey: hold inside scanR for scanHold seconds
  collectR: 180,                           // cache pickup radius
  sensorR: 450,                            // sensor placement radius around the tier entity
  boostMin: 1, boostMax: 2,                // extra defenders while the quest is ACTIVE
};

// --- Site-archetype-specific godo actions (beyond the base scan/defeat/collect).
// Each site type earns a purposeful role: resource clusters get mining work,
// wrecks get salvage/recovery, alien derelicts get anomaly ops, and the
// territory's fortified outposts get bounty/sabotage/assault jobs. mech is the
// objective evaluator (hold = loiter inside r for dur seconds; collect = grab a
// cached point; bounty = down the garrison commander). need = the objective only
// advances once the target's defenders are cleared. tgt/type route generation to
// a matching lineage ownable. Copy is deliberately faction-neutral (see below).
const QUEST_GODO = {
  extract:  { mech: "collect", tgt: "site",    type: "asteroid_cluster" },
  escort:   { mech: "hold",    tgt: "site",    type: "asteroid_cluster", r: 340, dur: 7 },
  salvage:  { mech: "collect", tgt: "site",    type: "shipwreck" },
  blackbox: { mech: "collect", tgt: "site",    type: "shipwreck", need: true },
  rescue:   { mech: "hold",    tgt: "site",    type: "shipwreck", r: 300, dur: 3, need: true },
  sensor:   { mech: "hold",    tgt: "site",    type: "alien_derelict", r: 420, dur: 4 },
  bounty:   { mech: "bounty",  tgt: "outpost" },
  sabotage: { mech: "hold",    tgt: "outpost", r: 260, dur: 2.5 },
  assault:  { mech: "hold",    tgt: "outpost", r: 320, dur: 4, need: true },
};
const QUEST_RMULT = {   // reward multipliers — riskier shapes pay more
  extract: 1.15, escort: 1.2, salvage: 1.15, blackbox: 1.35, rescue: 1.35,
  sensor: 1.1, bounty: 1.3, sabotage: 1.25, assault: 1.4,
};
// Faction-neutral flavour. `where` is prefilled with "the <site label> in R-####"
// or "the fortified outpost in R-####", so no template names a faction.
const QUEST_COPY = {
  extract:  { title: "EXTRACT: ORE HAUL",     desc: w => `Deploy your extractor at ${w} and pull out the ore payload, then haul it home.` },
  escort:   { title: "ESCORT: MINING RIG",    desc: w => `A mining drone is working ${w}. Hold station and cover it until the run is finished, then report back.` },
  salvage:  { title: "SALVAGE RUN",           desc: w => `Intact salvage is drifting through ${w}. Recover it, then bring it home.` },
  blackbox: { title: "BLACK BOX RECOVERY",    desc: w => `The flight recorder is still aboard ${w}. Clear the scavengers, pull the box, and return it.` },
  rescue:   { title: "RESCUE: SURVIVOR",      desc: w => `A survivor is stranded at ${w}. Fight off the hostiles, hold long enough to pull them aboard, then get them home.` },
  sensor:   { title: "DEPLOY: SENSOR ARRAY",  desc: w => `Deploy a sensor array against ${w} — hold position while it aligns, then report the readings.` },
  bounty:   { title: "BOUNTY: COMMANDER",     desc: w => `A bounty is out on the commander garrisoned at ${w}. Eliminate them, then collect at home.` },
  sabotage: { title: "SABOTAGE",              desc: w => `Slip in and plant a charge on ${w} — hold position while it arms, then break off and report.` },
  assault:  { title: "ASSAULT & HOLD",        desc: w => `Break ${w}: destroy every defender, then hold the position until it is secured. Report back when done.` },
};

Object.assign(GAME, {
  initQuests(s) {
    s = s || this.state;
    s.quests = []; s.stationQuests = {}; s.activeQuestId = null; s.nextQuestId = 1;
    s._questWp = null; s._questWpKey = null;   // last quest-set waypoint (session-only)
  },

  // ---- generation (fresh board every dock, targets via lineage only) ------
  generateStationQuests(station, state) {
    const s = state || this.state;
    const terr = politicalRegionAt(station.pos.x, station.pos.y);
    if (!terr) { s.stationQuests[station.id] = []; return []; }
    const own = ownablesOfTerritory(terr.name);
    const siteCells = own.filter(e => e.type === "site");
    const outpostCells = own.filter(e => e.type === "outpost" && e.entity.owner !== "player");
    const anchorCells = own.filter(e => e.type);         // sites + outposts (chain stops)
    const rids = regionsOfTerritory(terr.name);
    const byType = {};                                   // sites grouped by archetype
    for (const e of siteCells) (byType[e.entity.type] = byType[e.entity.type] || []).push(e);
    const diff = this.stationDifficulty(station);
    const [lo, hi] = QUESTS.rewards[diff];
    const n = QUESTS.perStationMin + ((rnd() * (QUESTS.perStationMax - QUESTS.perStationMin + 1)) | 0);
    const list = [];
    for (let i = 0; i < n; i++) {
      const q = { id: s.nextQuestId++, kind: "godo", action: null,
        stationId: station.id, territory: terr.name,
        title: "", description: "", difficulty: diff,
        reward: Math.round((lo + rnd() * (hi - lo)) / 5) * 5,
        regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
        scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
        boosts: {}, status: "offer" };
      const alienCells = byType.alien_derelict;
      if (alienCells && alienCells.length && rnd() < QUESTS.multiW) {
        // single-site multi-tier dig at a high-value alien derelict (any order)
        this._genMulti(q, alienCells[(rnd() * alienCells.length) | 0]);
      } else if (anchorCells.length >= QUESTS.chainTiers && rnd() < QUESTS.chainW) {
        // cross-territory sensor net (existing chain shape, unchanged)
        q.kind = "chain"; q.tiers = [];
        const pool = anchorCells.slice();
        for (let k = 0; k < QUESTS.chainTiers; k++) {
          const e = pool.splice((rnd() * pool.length) | 0, 1)[0];
          q.tiers.push({ regionId: e.regionId, type: e.type, refId: e.entity.id, done: false });
        }
        q.reward = Math.round(q.reward * QUESTS.chainRewardMult / 5) * 5;
        q.title = "SENSOR NET: " + terr.name.toUpperCase();
        q.description = `Place survey sensors at 3 marked locations across ${terr.name} — any order — then report back.`;
      } else {
        this._genGodo(q, { siteCells, byType, outpostCells, rids });
      }
      list.push(q);
    }
    s.stationQuests[station.id] = list;
    return list;
  },

  // Build a single-objective (go-do-return) quest. The action pool is whatever
  // the issuing territory can actually support, so a hub with no shipwreck never
  // offers a salvage run. scan/defeat/collect keep their original copy exactly;
  // the archetype-specific shapes (QUEST_GODO) are spec-driven and share the
  // eval/text/waypoint helpers below.
  _genGodo(q, ctx) {
    const { siteCells, byType, outpostCells, rids } = ctx;
    const pool = [];
    if (siteCells.length) pool.push("scan", "defeat");          // any site
    pool.push("collect");                                       // region cache — always available
    if (byType.asteroid_cluster) pool.push("extract", "escort");
    if (byType.shipwreck) pool.push("salvage", "blackbox", "rescue");
    if (byType.alien_derelict) pool.push("sensor");            // "investigate the anomaly" is served by scan
    if (outpostCells.length) pool.push("bounty", "sabotage", "assault");
    const action = pool[(rnd() * pool.length) | 0];
    q.action = action;
    // ---- original shapes: keep exact fields + copy ----
    if (action === "collect") {
      q.regionId = rids[(rnd() * rids.length) | 0];
      const lbl = this.regionLabel(this.regionGet(q.regionId));
      q.title = "RECOVER: CACHE " + lbl;
      q.description = `A supply cache went adrift in sector ${lbl}. Fly out, pick it up, and bring it home.`;
      return;
    }
    if (action === "scan" || action === "defeat") {
      const e = siteCells[(rnd() * siteCells.length) | 0];
      q.regionId = e.regionId; q.siteId = e.entity.id;
      const def = SITE_DEFS[e.entity.type], lbl = this.regionLabel(this.regionGet(q.regionId));
      if (action === "scan") {
        q.title = "SURVEY: " + def.label.toUpperCase() + " " + lbl;
        q.description = `Run a close-range scan of the ${def.label} in ${lbl}. Hold position nearby until the sweep completes, then return.`;
      } else {
        q.title = "CLEAR: " + def.label.toUpperCase() + " " + lbl;
        q.description = `Hostiles are dug in at the ${def.label} in ${lbl}. Destroy every defender, then return.`;
      }
      return;
    }
    // ---- archetype-specific shapes (spec-driven) ----
    const spec = QUEST_GODO[action];
    if (spec.tgt === "outpost") {
      const e = outpostCells[(rnd() * outpostCells.length) | 0];
      q.outpostId = e.entity.id; q.regionId = e.regionId;
    } else {
      const sitePool = byType[spec.type] || siteCells;
      const e = sitePool[(rnd() * sitePool.length) | 0];
      q.regionId = e.regionId; q.siteId = e.entity.id;
    }
    if (spec.mech === "hold") { q.holdR = spec.r; q.holdDur = spec.dur; q.holdT = 0; }
    if (spec.mech === "collect") q.collected = false;
    q.needClear = !!spec.need;
    this._questFlavor(q, action, spec);
    q.reward = Math.round(q.reward * (QUEST_RMULT[action] || 1) / 5) * 5;
  },

  // Multi-tier excavation at one alien derelict: clear the outer sentinels,
  // breach the inner seal, extract the relic — ANY order, and each tier's `done`
  // lives on the quest so it survives death (like a chain tier). Node offsets are
  // deterministic per quest+site so a reload lands the reticles in the same spots.
  _genMulti(q, alienCell) {
    const site = alienCell.entity;
    q.kind = "multi"; q.action = "relic";
    q.siteId = site.id; q.regionId = alienCell.regionId;
    const lbl = this.regionLabel(this.regionGet(q.regionId));
    const rng = this._siteRng(this._siteHash(q.id * 733 + (site.regionId || 0) * 17 + 3));
    const a = rng() * TAU, br = (site.r || 120) * 0.85;
    q.nodes = [
      { action: "defeat",  dx: 0, dy: 0, r: 0, dur: 0, done: false, t: 0, label: "outer sentinels cleared" },
      { action: "hold",    dx: Math.cos(a) * br, dy: Math.sin(a) * br, r: 340, dur: 4, done: false, t: 0, label: "inner seal breached" },
      { action: "collect", dx: 0, dy: 0, r: QUESTS.collectR, dur: 0, done: false, t: 0, label: "relic extracted" },
    ];
    q.reward = Math.round(q.reward * QUESTS.relicRewardMult / 5) * 5;
    q.title = "EXCAVATION: ALIEN DERELICT " + lbl;
    q.description = `A sealed vault waits at the alien derelict in ${lbl}. Clear the outer sentinels, breach the inner seal, and extract the relic — in any order — then return.`;
  },

  _questFlavor(q, action, spec) {
    const lbl = this.regionLabel(this.regionGet(q.regionId));
    let where;
    if (spec.tgt === "outpost") where = `the fortified outpost in ${lbl}`;
    else { const t = this.siteById(q.siteId); where = `the ${SITE_DEFS[t.type].label} in ${lbl}`; }
    const c = QUEST_COPY[action];
    q.title = c.title + " " + lbl;
    q.description = c.desc(where, lbl);
  },

  // ---- lookups ------------------------------------------------------------
  activeQuest() {
    const s = this.state;
    return s.activeQuestId == null ? null : s.quests.find(q => q.id === s.activeQuestId) || null;
  },
  _questStation(q) { return ForgeWorld.getStations().find(x => x.id === q.stationId); },
  _questTierPos(t) {
    const e = t.type === "site" ? this.siteById(t.refId) : this.outpostById(t.refId);
    return e ? { x: e.x, y: e.y } : null;
  },
  _questCachePos(q) {   // deterministic drift point inside the target cell
    const r = this.regionGet(q.regionId);
    if (!r) return null;
    const rng = this._siteRng(this._siteHash(q.regionId * 31 + q.id * 7));
    return { x: r.cx + (rng() - 0.5) * 1400, y: r.cy + (rng() - 0.5) * 1400 };
  },
  _questSiteCachePos(q) {   // deterministic point inside the target SITE's debris field
    const t = this.siteById(q.siteId);
    if (!t) return null;
    const rng = this._siteRng(this._siteHash(q.id * 97 + (t.regionId || 0) * 13 + 5));
    const a = rng() * TAU, R = t.r || 120, d = R * 0.35 + rng() * R * 0.3;
    return { x: t.x + Math.cos(a) * d, y: t.y + Math.sin(a) * d };
  },
  _questNodePos(q, nd) {   // a multi-tier node, positioned off the site anchor
    const t = this.siteById(q.siteId);
    return t ? { x: t.x + nd.dx, y: t.y + nd.dy } : null;
  },
  // Where a spec-driven godo objective sits: a site (hold at the anchor, collect
  // at its cache point) or the target outpost. scan/defeat (non-spec) aim at the site.
  _questActionPos(q) {
    const spec = QUEST_GODO[q.action];
    if (spec && spec.tgt === "outpost") { const o = this.outpostById(q.outpostId); return o ? { x: o.x, y: o.y } : null; }
    if (spec && spec.mech === "collect") return this._questSiteCachePos(q);
    const t = this.siteById(q.siteId);
    return t ? { x: t.x, y: t.y } : null;
  },
  _outpostDefendersLeft(o) {
    if (!o || o.owner === "player") return 0;
    return o.streamed ? o._ships.filter(sh => sh.hp.hull > 0 && sh.state !== "DEAD").length
                      : o.guardRecs.filter(r => r.alive).length;
  },
  // Live defenders at THIS quest's target (site garrison or outpost garrison, plus
  // this quest's own boost layer) — drives the needClear gate + defeat objectives.
  _questTargetDefendersLeft(q) {
    const spec = QUEST_GODO[q.action];
    if (spec && spec.tgt === "outpost") {
      let n = this._outpostDefendersLeft(this.outpostById(q.outpostId));
      const recs = q.boosts && q.boosts[q.regionId];
      if (recs) n += (q._bShips && q._bShips[q.regionId])
        ? q._bShips[q.regionId].filter(sh => sh.hp.hull > 0 && sh.state !== "DEAD").length
        : recs.filter(r => r.alive).length;
      return n;
    }
    return this._questDefendersLeft(q);
  },
  _questOutpostLeaderAlive(q) {   // the garrison "commander" = guardRec/ship index 0
    const o = this.outpostById(q.outpostId);
    if (!o || o.owner === "player") return false;
    if (o.streamed) { const lead = o._ships.find(sh => sh._guardIdx === 0); return !!lead && lead.hp.hull > 0 && lead.state !== "DEAD"; }
    return !!(o.guardRecs[0] && o.guardRecs[0].alive);
  },
  _questNodeToast(q, nd) {
    toast("⊚ " + nd.label + " — " + q.nodes.filter(n => n.done).length + "/" + q.nodes.length, "#57e6ff"); sfx("grab");
  },

  // ---- objective state ----------------------------------------------------
  // live defenders at a "clear" target: site garrison (streamed ships when
  // present, else the persistent recs) + this quest's boost layer
  _questDefendersLeft(q) {
    const t = this.siteById(q.siteId);
    let n = 0;
    if (t) n += t.streamed
      ? t._ships.filter(sh => sh.hp.hull > 0 && sh.state !== "DEAD").length
      : t.guardRecs.filter(r => r.alive).length;
    const recs = q.boosts && q.boosts[q.regionId];
    if (recs) n += (q._bShips && q._bShips[q.regionId])
      ? q._bShips[q.regionId].filter(sh => sh.hp.hull > 0 && sh.state !== "DEAD").length
      : recs.filter(r => r.alive).length;
    return n;
  },
  questObjectiveDone(q) {
    if (q.kind === "chain") return q.tiers.every(t => t.done);
    if (q.kind === "multi") return q.nodes.every(n => n.done);
    if (q.action === "scan") return q.scanT >= QUESTS.scanHold;
    if (q.action === "collect") return !!q.collected;
    if (q.action === "defeat") return this._questDefendersLeft(q) === 0;
    const spec = QUEST_GODO[q.action];
    if (spec) {
      if (spec.mech === "hold") return q.holdT >= q.holdDur;
      if (spec.mech === "collect") return !!q.collected;
      if (spec.mech === "bounty") return !this._questOutpostLeaderAlive(q);
    }
    return false;
  },
  questProgressText(q) {
    if (q.kind === "chain") return `${q.tiers.filter(t => t.done).length}/${q.tiers.length} sensors placed`;
    if (q.kind === "multi") return `${q.nodes.filter(n => n.done).length}/${q.nodes.length} objectives done`;
    if (q.action === "scan") return `scan ${Math.round(Math.min(1, q.scanT / QUESTS.scanHold) * 100)}%`;
    if (q.action === "collect") return q.collected ? "cache aboard" : "cache adrift in " + this.regionLabel(this.regionGet(q.regionId));
    if (q.action === "defeat") return `${this._questDefendersLeft(q)} defenders left`;
    const spec = QUEST_GODO[q.action];
    if (spec) {
      if (spec.mech === "bounty") return this._questOutpostLeaderAlive(q) ? "commander at large" : "commander down";
      if (q.needClear) { const left = this._questTargetDefendersLeft(q); if (left > 0) return `${left} defenders left`; }
      if (spec.mech === "hold") return `holding ${Math.round(Math.min(1, q.holdT / q.holdDur) * 100)}%`;
      if (spec.mech === "collect") return q.collected ? "objective aboard" : "objective adrift in " + this.regionLabel(this.regionGet(q.regionId));
    }
    return "";
  },
  // where the nav waypoint should aim: the next objective, or home when ready
  _questObjectivePoint(q) {
    const s = this.state;
    if (this.questObjectiveDone(q)) {
      const st = this._questStation(q);
      return st ? { x: st.pos.x, y: st.pos.y } : null;
    }
    if (q.kind === "chain") {   // nearest incomplete tier
      let best = null, bd = Infinity;
      for (const t of q.tiers) {
        if (t.done) continue;
        const p = this._questTierPos(t);
        if (!p) continue;
        const d = this.dist(s.x, s.y, p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    if (q.kind === "multi") {   // nearest incomplete tier of the dig
      let best = null, bd = Infinity;
      for (const nd of q.nodes) {
        if (nd.done) continue;
        const p = this._questNodePos(q, nd);
        if (!p) continue;
        const d = this.dist(s.x, s.y, p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    if (q.action === "collect") return this._questCachePos(q);
    return this._questActionPos(q);
  },

  // ---- accept / abandon / turn in (hold many, track one) ------------------
  acceptQuest(q) {
    const s = this.state;
    if (!q || q.status !== "offer") return false;
    const board = s.stationQuests[q.stationId];
    if (board) { const i = board.indexOf(q); if (i >= 0) board.splice(i, 1); }
    q.status = "held";
    s.quests.push(q);
    if (s.activeQuestId == null) this.setActiveQuest(q.id);   // first pickup auto-tracks
    toast("QUEST ACCEPTED: " + q.title, "#57d1c9"); sfx("buy");
    return true;
  },
  abandonQuest(q) {
    const s = this.state, i = s.quests.indexOf(q);
    if (i < 0) return false;
    this._questDespawnBoost(q);
    s.quests.splice(i, 1);
    if (s.activeQuestId === q.id) this.setActiveQuest(null);
    toast("QUEST ABANDONED: " + q.title, "#ff5060"); sfx("warn");
    return true;
  },
  turnInQuest(q) {
    const s = this.state;
    if (!q || !s.quests.includes(q)) return false;
    if (!this.questObjectiveDone(q)) { toast("quest objectives not complete"); sfx("warn"); return false; }
    if (!s.docked || s.dockStationId !== q.stationId) {
      const st = this._questStation(q);
      toast("turn in at " + (st ? st.name : "the issuing station")); sfx("warn"); return false;
    }
    this._questDespawnBoost(q);
    s.quests.splice(s.quests.indexOf(q), 1);
    if (s.activeQuestId === q.id) this.setActiveQuest(null);
    s.credits += q.reward;
    GAME.addXpFromCredits(q.reward, SKILLS.questMult);   // XP: doing quests (bonus multiplier)
    this.gainRep("delivery");
    toast(`+${q.reward}cr — ${q.title}`, "#ffd24a"); sfx("sell");
    this.checkWin();
    return true;
  },
  setActiveQuest(id) {   // null untracks; the sync below re-aims (or clears) the waypoint
    const s = this.state;
    s.activeQuestId = id == null ? null : id;
    s._questWpKey = null;   // force a fresh aim even if the objective is unchanged
    const active = this.activeQuest();
    this._questBoostTick(active);      // despawn the previous quest's extra defenders now
    this._questWaypointSync(active);
  },

  // ---- per-frame tick (flight only — main.js update, after contracts) -----
  updateQuests(dt) {
    const s = this.state;
    if (!s.quests) return;
    for (const q of s.quests) {
      // objective progress advances for EVERY held quest; only the active one
      // steers the waypoint + defender boost below
      if (q.kind === "chain") {
        for (const t of q.tiers) {
          if (t.done) continue;
          const p = this._questTierPos(t);
          if (!p) continue;
          if (this.dist(s.x, s.y, p.x, p.y) < QUESTS.sensorR) {
            t.done = true;
            const nDone = q.tiers.filter(x => x.done).length;
            toast(`⊚ sensor placed — ${this.regionLabel(this.regionGet(t.regionId))} (${nDone}/${q.tiers.length})`, "#57e6ff"); sfx("grab");
          }
        }
      } else if (q.kind === "multi") {
        const site = this.siteById(q.siteId);
        for (const nd of q.nodes) {
          if (nd.done) continue;
          if (nd.action === "defeat") {
            if (this._questDefendersLeft(q) === 0) { nd.done = true; this._questNodeToast(q, nd); }
          } else if (site) {
            const px = site.x + nd.dx, py = site.y + nd.dy;
            if (this.dist(s.x, s.y, px, py) < (nd.r || QUESTS.collectR)) {
              if (nd.action === "collect") { nd.done = true; this._questNodeToast(q, nd); }
              else { nd.t = Math.min(nd.dur, (nd.t || 0) + dt);   // hold: breach the seal
                if (nd.t >= nd.dur) { nd.done = true; this._questNodeToast(q, nd); } }
            }
          }
        }
      } else if (q.action === "scan" && q.scanT < QUESTS.scanHold) {
        const t = this.siteById(q.siteId);
        if (t && this.dist(s.x, s.y, t.x, t.y) < QUESTS.scanR) {
          q.scanT = Math.min(QUESTS.scanHold, q.scanT + dt);
          if (q.scanT >= QUESTS.scanHold) { toast("⊚ survey complete", "#57e6ff"); sfx("grab"); }
        }
      } else if (q.action === "collect" && !q.collected) {
        const p = this._questCachePos(q);
        if (p && this.dist(s.x, s.y, p.x, p.y) < QUESTS.collectR) {
          q.collected = true; toast("+ supply cache recovered", "#ffd27a"); sfx("grab");
        }
      } else if (QUEST_GODO[q.action]) {
        const spec = QUEST_GODO[q.action];
        const cleared = !q.needClear || this._questTargetDefendersLeft(q) === 0;
        if (spec.mech === "hold" && q.holdT < q.holdDur) {
          const p = this._questActionPos(q);
          if (p && cleared && this.dist(s.x, s.y, p.x, p.y) < q.holdR) {
            q.holdT = Math.min(q.holdDur, q.holdT + dt);
            if (q.holdT >= q.holdDur) { toast("⊚ objective secured", "#57e6ff"); sfx("grab"); }
          }
        } else if (spec.mech === "collect" && !q.collected) {
          const p = this._questActionPos(q);
          if (p && cleared && this.dist(s.x, s.y, p.x, p.y) < QUESTS.collectR) {
            q.collected = true; toast("+ objective recovered", "#ffd27a"); sfx("grab");
          }
        }
        // bounty: completion is derived from the commander's state, no tick needed
      }
      if (q.status === "held" && this.questObjectiveDone(q)) {
        q.status = "ready";
        const st = this._questStation(q);
        toast("QUEST READY: " + q.title + " — return to " + (st ? st.name : "the issuer"), "#7bd88f"); sfx("sell");
      }
    }
    this._questBoostTick(this.activeQuest());
    this._questWaypointSync(this.activeQuest());
  },

  // ---- quest-layer defenders (ACTIVE quest only) --------------------------
  // Boost targets: the godo site target, or every incomplete chain tier that
  // points at a hostile site/outpost. Player-owned outposts never boost.
  _questBoostAnchors(q) {
    const out = [];
    const addSite = (siteId) => {
      const t = this.siteById(siteId);
      if (t) out.push({ regionId: t.regionId, x: t.x, y: t.y, groupId: t.id,
        faction: SITE_DEFS[t.type].guardFaction, tier: SITE_DEFS[t.type].guardTier });
    };
    const addOutpost = (o) => {
      if (o && o.owner !== "player") out.push({ regionId: o.regionId, x: o.x, y: o.y,
        groupId: o.id, faction: o.faction, tier: "normal" });
    };
    if (q.kind === "godo" && q.siteId) addSite(q.siteId);
    if (q.kind === "godo" && q.outpostId) addOutpost(this.outpostById(q.outpostId));
    if (q.kind === "multi" && q.siteId && !q.nodes.every(n => n.done)) addSite(q.siteId);
    if (q.kind === "chain") for (const t of q.tiers) {
      if (t.done) continue;
      if (t.type === "site") addSite(t.refId); else addOutpost(this.outpostById(t.refId));
    }
    return out;
  },
  _questBoostTick(active) {
    const s = this.state, streamR = CONFIG.outpostGuardStreamR;
    for (const q of s.quests) if (q !== active) this._questDespawnBoost(q);
    if (!active) return;
    const q = active, anchors = this._questBoostAnchors(q);
    q._bShips = q._bShips || {};
    // anchors that dropped out (tier placed, outpost captured) stand down now
    for (const rid of Object.keys(q._bShips).map(Number))
      if (!anchors.some(a => a.regionId === rid)) this._questBoostOut(q, rid);
    for (const a of anchors) {
      const rid = a.regionId, d = this.dist(s.x, s.y, a.x, a.y);
      if (q._bShips[rid]) {
        if (d > streamR + 1500) this._questBoostOut(q, rid);
        continue;
      }
      if (d > streamR) continue;
      // first approach mints the persistent recs: +1-2 extra defenders
      if (!q.boosts[rid]) {
        const nB = QUESTS.boostMin + this._siteHash(q.id * 131 + rid) % (QUESTS.boostMax - QUESTS.boostMin + 1);
        q.boosts[rid] = [];
        for (let i = 0; i < nB; i++) q.boosts[rid].push({ frac: 1, alive: true });
      }
      const recs = q.boosts[rid];
      if (!recs.some(r => r.alive)) continue;
      const ships = [], dl = getDangerLevel(a.x, a.y);
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        if (!rec.alive) continue;
        const ship = ForgeFaction.generateAlienShip(a.faction, a.tier,
          { rng: rnd, x: a.x, y: a.y, groupId: a.groupId, orbitRadius: 260 });
        applyDangerToShip(ship, dl);   // scale full pools first, then the saved frac
        const ang = i / recs.length * TAU + 2.1;
        ship.x = a.x + Math.cos(ang) * 320; ship.y = a.y + Math.sin(ang) * 320;
        ship.hp.shield *= rec.frac; ship.hp.armor *= rec.frac; ship.hp.hull *= rec.frac;
        ship._questId = q.id; ship._questRegion = rid; ship._qbIdx = i;
        s.aliens.push(ship); ships.push(ship);
      }
      if (ships.length) q._bShips[rid] = ships;
    }
  },
  _questBoostOut(q, rid) {   // write the fight back into the recs, cull the ships
    const s = this.state, recs = q.boosts[rid] || [], ships = (q._bShips && q._bShips[rid]) || [];
    for (const ship of ships) {
      const rec = recs[ship._qbIdx];
      if (!rec) continue;
      rec.frac = Math.max(0, ship.hp.hull / ship.hp.hullMax);
      rec.alive = ship.hp.hull > 0 && ship.state !== "DEAD";
    }
    s.aliens = s.aliens.filter(a => !(a._questId === q.id && a._questRegion === rid));
    if (q._bShips) delete q._bShips[rid];
  },
  _questDespawnBoost(q) {
    if (!q._bShips) return;
    for (const rid of Object.keys(q._bShips).map(Number)) this._questBoostOut(q, rid);
  },

  // ---- waypoint drive (the ONE nav waypoint belongs to the active quest) --
  // Re-aims only when the objective point changes, so main.js's "waypoint
  // reached" clear sticks until the quest moves the goalpost (next tier /
  // return leg) — no set/clear fight inside the arrival radius.
  _questWaypointSync(active) {
    const s = this.state;
    if (!active) {
      if (s._questWp) {   // untracked/finished → take the quest's waypoint down
        if (s.navWaypoint && s.navWaypoint.x === s._questWp.x && s.navWaypoint.y === s._questWp.y)
          s.navWaypoint = null;
        s._questWp = null; s._questWpKey = null;
      }
      return;
    }
    const p = this._questObjectivePoint(active);
    if (!p) return;
    const key = active.id + ":" + Math.round(p.x) + ":" + Math.round(p.y);
    if (s._questWpKey !== key) {
      s._questWpKey = key;
      s.navWaypoint = { x: p.x, y: p.y };
      s._questWp = { x: p.x, y: p.y };
    }
  },

  // ---- world overlay: pulsing reticle on the active quest's objectives ----
  drawQuestWorld(g) {
    if (HEADLESS) return;
    const s = this.state, q = this.activeQuest();
    if (!q || s.docked) return;
    const z = s.cam.zoom, viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 400;
    const pts = [];
    if (q.kind === "chain") {
      for (const t of q.tiers) {
        if (t.done) continue;
        const p = this._questTierPos(t);
        if (p) pts.push(p);
      }
    } else if (q.kind === "multi") {
      for (const nd of q.nodes) {
        if (nd.done) continue;
        const p = this._questNodePos(q, nd);
        if (p) pts.push(p);
      }
    } else if (!this.questObjectiveDone(q)) {
      const p = this._questObjectivePoint(q);
      if (p) pts.push(p);
    }
    // escort: draw the mining drone the player is covering, orbiting the cluster
    if (q.kind === "godo" && q.action === "escort" && !this.questObjectiveDone(q)) {
      const t = this.siteById(q.siteId);
      if (t && this.dist(t.x, t.y, s.cam.x, s.cam.y) <= viewR) {
        const dp = this.SF(t.x + Math.cos(s.t * 0.8) * 90, t.y + Math.sin(s.t * 0.8) * 90);
        g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(dp.x, dp.y, Math.max(3, 5 * z), 0, TAU); g.fill();
        g.strokeStyle = "rgba(255,210,122,0.5)"; g.lineWidth = 1;
        g.beginPath(); g.arc(dp.x, dp.y, Math.max(6, 9 * z), 0, TAU); g.stroke();
      }
    }
    for (const w of pts) {
      if (this.dist(w.x, w.y, s.cam.x, s.cam.y) > viewR) continue;
      const p = this.SF(w.x, w.y), pw = 0.5 + 0.5 * Math.sin(s.t * 3);
      g.strokeStyle = `rgba(87,230,255,${0.45 + 0.4 * pw})`; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, (26 + 6 * pw) * z, 0, TAU); g.stroke();
      g.font = `bold ${Math.max(8, 9 * z) | 0}px monospace`; g.textAlign = "center";
      g.fillStyle = "#57e6ff"; g.fillText("◇ OBJECTIVE", p.x, p.y - (36 + 6 * pw) * z);
      g.textAlign = "left";
    }
  },

  // ---- persistence (whitelisted by game/save.js) --------------------------
  // Explicit field pick = the sanitizer: runtime _bShips (live ship refs)
  // never reach JSON, and a restored blob re-picks to drop stale keys.
  _serializeQuest(q) {
    return { id: q.id, kind: q.kind, action: q.action || null,
      stationId: q.stationId, territory: q.territory,
      title: q.title, description: q.description, difficulty: q.difficulty, reward: q.reward,
      regionId: q.regionId != null ? q.regionId : null, siteId: q.siteId || null,
      outpostId: q.outpostId || null,
      scanT: +q.scanT || 0, collected: !!q.collected,
      holdT: +q.holdT || 0, holdR: q.holdR != null ? q.holdR : null,
      holdDur: q.holdDur != null ? q.holdDur : null, needClear: !!q.needClear,
      tiers: Array.isArray(q.tiers)
        ? q.tiers.map(t => ({ regionId: t.regionId, type: t.type, refId: t.refId, done: !!t.done }))
        : null,
      nodes: Array.isArray(q.nodes)
        ? q.nodes.map(n => ({ action: n.action, dx: n.dx, dy: n.dy, r: n.r, dur: n.dur, done: !!n.done, t: +n.t || 0, label: n.label }))
        : null,
      boosts: q.boosts && typeof q.boosts === "object" ? q.boosts : {},
      status: q.status === "ready" ? "ready" : "held" };
  },

  // ================= DOM: quest sections of #contractsPanel ====================
  // Rendered by renderContractsPanel (same refresh-on-every-press flow); the
  // shared onClick in wireContractsDOM routes data-qact buttons here.
  renderQuestsPanel() {
    const ct = this._ctDOM(); if (!ct || !ct.qsHeld) return;
    const s = this.state, sid = s.dockStationId;
    // ---- quest log (held; the active one is highlighted) ----
    ct.qsHeld.innerHTML = "";
    if (!s.quests.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "no quests held — accept some from the board below";
      ct.qsHeld.appendChild(note);
    }
    for (const q of s.quests) {
      const isActive = s.activeQuestId === q.id;
      const card = this._ctCard(q);
      if (isActive) card.classList.add("qActive");
      const row = document.createElement("div"); row.className = "ctBtnRow";
      const act = document.createElement("button"); act.className = "ghBtn";
      act.textContent = isActive ? "◉ ACTIVE — waypoint set" : "○ SET ACTIVE";
      if (isActive) act.classList.add("go");
      act.dataset.qact = "active"; act.dataset.qid = String(q.id);
      row.appendChild(act);
      const ready = this.questObjectiveDone(q), here = q.stationId === sid;
      const ti = document.createElement("button"); ti.className = "ghBtn";
      const st = this._questStation(q);
      ti.textContent = ready
        ? (here ? "TURN IN ▸ +" + q.reward + "cr" : "turn in at " + (st ? st.name : "the issuer"))
        : "IN PROGRESS — " + this.questProgressText(q);
      ti.disabled = !(ready && here);
      if (ready && here) ti.classList.add("go");
      ti.dataset.qact = "turnin"; ti.dataset.qid = String(q.id);
      row.appendChild(ti);
      const ab = document.createElement("button"); ab.className = "ghBtn ctAbandon";
      ab.textContent = "ABANDON"; ab.dataset.qact = "abandon"; ab.dataset.qid = String(q.id);
      row.appendChild(ab);
      card.appendChild(row);
      ct.qsHeld.appendChild(card);
    }
    // ---- quest board (this station's offers) ----
    ct.qsList.innerHTML = "";
    const avail = (s.stationQuests[sid] || []).filter(q => q.status === "offer");
    if (!avail.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "no quests on the board — redock to refresh";
      ct.qsList.appendChild(note);
    }
    for (const q of avail) {
      const card = this._ctCard(q);
      const row = document.createElement("div"); row.className = "ctBtnRow";
      const btn = document.createElement("button"); btn.className = "ghBtn go";
      btn.textContent = "ACCEPT"; btn.dataset.qact = "accept"; btn.dataset.qid = String(q.id);
      row.appendChild(btn);
      card.appendChild(row);
      ct.qsList.appendChild(card);
    }
  },
  questDomAct(btn) {
    const s = this.state, id = +btn.dataset.qid, act = btn.dataset.qact;
    if (act === "accept") {
      const q = (s.stationQuests[s.dockStationId] || []).find(x => x.id === id);
      if (q) this.acceptQuest(q);
      return;
    }
    const q = s.quests.find(x => x.id === id);
    if (!q) return;
    if (act === "active") this.setActiveQuest(s.activeQuestId === q.id ? null : q.id);
    else if (act === "turnin") this.turnInQuest(q);
    else if (act === "abandon") this.abandonQuest(q);
  },

  // ---- selfTest (build.py --check wires this in) --------------------------
  questsSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state, stations = ForgeWorld.getStations();

      // 1. every station's board: 3-5 offers, and every target region belongs
      // to the ISSUER's territory (per the lineage lists, chains included)
      const shapes = new Set();
      for (const st of stations) {
        const list = this.generateStationQuests(st, s);
        check(list.length >= QUESTS.perStationMin && list.length <= QUESTS.perStationMax,
          st.name + " board size " + list.length);
        check(s.stationQuests[st.id] === list, st.name + " board not stored by stationId");
        const terr = politicalRegionAt(st.pos.x, st.pos.y);
        check(!!terr, st.name + " resolves no territory");
        const rids = new Set(regionsOfTerritory(terr.name));
        for (const q of list) {
          shapes.add(q.kind === "chain" ? "chain" : q.action);
          check(q.territory === terr.name, q.title + " carries the wrong territory");
          const targets = q.kind === "chain" ? q.tiers.map(t => t.regionId) : [q.regionId];
          for (const rid of targets)
            check(rids.has(rid), st.name + " quest '" + q.title + "' targets R-" + rid + " outside " + terr.name);
          if (q.kind === "chain") {
            check(q.tiers.length === QUESTS.chainTiers, "chain tier count " + q.tiers.length);
            check(new Set(q.tiers.map(t => t.regionId)).size === q.tiers.length, "chain tiers must hit distinct regions");
            for (const t of q.tiers)
              check(t.type === "site" ? !!this.siteById(t.refId) : !!this.outpostById(t.refId),
                "chain tier entity missing at R-" + t.regionId);
          }
          if (q.siteId) {
            const t = this.siteById(q.siteId);
            check(!!t && t.regionId === q.regionId, q.title + " site/region mismatch");
          }
        }
      }
      // both shapes + every original godo action appear over enough boards (the
      // wider archetype pool dilutes each, so loop until the four are all present)
      const wantBase = ["chain", "scan", "defeat", "collect"];
      for (let tries = 0; tries < 160 && !wantBase.every(w => shapes.has(w)); tries++)
        for (const q of this.generateStationQuests(stations[tries % stations.length], s))
          shapes.add(q.kind === "chain" ? "chain" : q.action);
      for (const want of wantBase)
        check(shapes.has(want), "quest shape '" + want + "' never generated");
      // redock refresh: a second generation replaces the board
      const before = s.stationQuests[stations[0].id];
      check(this.generateStationQuests(stations[0], s) !== before, "board must refresh on redock");

      // 2+3. chain: out-of-order tiers, death-persistent progress, turn-in
      let qc = null;
      for (let tries = 0; tries < 160 && !qc; tries++)
        qc = this.generateStationQuests(stations[tries % stations.length], s).find(q => q.kind === "chain");
      check(!!qc, "no chain quest generated in 160 boards");
      if (qc) {
        check(this.acceptQuest(qc), "chain accept failed");
        check(qc.status === "held" && s.quests.includes(qc), "accepted chain not held");
        check(s.activeQuestId === qc.id, "first accepted quest must auto-track");
        const goTier = (idx, full) => {
          const p = this._questTierPos(qc.tiers[idx]);
          s.x = p.x + 100; s.y = p.y; s.vx = s.vy = 0;
          if (full) this.update(1 / 60); else this.updateQuests(1 / 60);
        };
        goTier(2, true);   // full update once — proves the main-loop wiring
        check(qc.tiers[2].done && !qc.tiers[0].done && !qc.tiers[1].done,
          "tier 3 alone should be done after the first stop (out-of-order)");
        // death mid-chain: the real destruction path must not touch the quest
        const credits0 = s.credits;
        s.hp.hull = 0; this.update(1 / 60);   // onShipDestroyed → respawn at home
        check(s.credits < credits0, "death penalty missing (death path did not run)");
        check(s.quests.includes(qc) && s.activeQuestId === qc.id, "death dropped the held quest");
        check(qc.tiers[2].done, "placed sensor must survive death/respawn");
        goTier(0, false); goTier(1, false);
        check(qc.tiers.every(t => t.done), "all tiers done after visiting the rest in any order");
        check(this.questObjectiveDone(qc) && qc.status === "ready", "finished chain must read ready");
        const st = this._questStation(qc);
        if (this.turnInQuest(qc)) fails.push("FAIL: turn-in must require docking at the issuer");
        s.docked = true; s.dockStationId = st.id;
        const cr0 = s.credits;
        check(this.turnInQuest(qc), "chain turn-in failed");
        check(s.credits === cr0 + qc.reward, "chain reward not credited");
        check(!s.quests.includes(qc) && s.activeQuestId === null, "turned-in quest must clear log + tracking");
        s.docked = false;
      }

      // 4. waypoint: only the ACTIVE quest aims the nav waypoint
      let qa = null, qb = null;
      for (let tries = 0; tries < 160 && !(qa && qb); tries++) {
        const list = this.generateStationQuests(stations[tries % stations.length], s);
        for (const q of list) {
          if (q.kind !== "godo") continue;
          if (!qa) qa = q; else if (!qb && q !== qa) qb = q;
        }
      }
      check(!!(qa && qb), "could not source two godo quests");
      if (qa && qb) {
        s.navWaypoint = null; s._questWp = null; s._questWpKey = null;
        this.acceptQuest(qa); this.acceptQuest(qb);
        check(s.activeQuestId === qa.id, "second accept must not steal tracking");
        this.updateQuests(1 / 60);
        const pa = this._questObjectivePoint(qa), pb = this._questObjectivePoint(qb);
        check(!!s.navWaypoint && s.navWaypoint.x === pa.x && s.navWaypoint.y === pa.y,
          "waypoint must aim at the ACTIVE quest's objective");
        check(!(s.navWaypoint.x === pb.x && s.navWaypoint.y === pb.y), "held-but-inactive quest must not aim the waypoint");
        this.setActiveQuest(qb.id);
        check(!!s.navWaypoint && s.navWaypoint.x === pb.x && s.navWaypoint.y === pb.y, "toggling active must re-aim the waypoint");
        this.setActiveQuest(null);
        check(s.navWaypoint === null, "untracking must clear the quest waypoint");
        this.abandonQuest(qa); this.abandonQuest(qb);
      }

      // 5. quest-layer defenders: +1-2 on approach, persistent recs, despawn on end
      let qs = null;
      for (let tries = 0; tries < 160 && !qs; tries++)
        qs = this.generateStationQuests(stations[tries % stations.length], s).find(q => q.action === "scan");
      check(!!qs, "no scan quest generated in 160 boards");
      if (qs) {
        this.acceptQuest(qs); this.setActiveQuest(qs.id);
        const site = this.siteById(qs.siteId);
        s.x = site.x + 2000; s.y = site.y; s.vx = s.vy = 0;   // inside streamR, outside scanR
        this.updateQuests(1 / 60);
        const boosted = () => s.aliens.filter(a => a._questId === qs.id);
        const n0 = boosted().length;
        check(n0 >= QUESTS.boostMin && n0 <= QUESTS.boostMax, "boost size on approach: " + n0);
        check(Array.isArray(qs.boosts[qs.regionId]) && qs.boosts[qs.regionId].length === n0,
          "boost recs must mirror the spawned ships");
        s.x = site.x + CONFIG.outpostGuardStreamR + 4000;   // leave → stream out
        this.updateQuests(1 / 60);
        check(boosted().length === 0, "boost must despawn when the player leaves");
        check(qs.boosts[qs.regionId].every(r => r.alive), "unhurt boost recs must survive the stream-out");
        s.x = site.x + 2000;                                 // return → stream back in
        this.updateQuests(1 / 60);
        check(boosted().length === n0, "boost must respawn from its recs on re-approach");
        this.abandonQuest(qs);
        check(boosted().length === 0, "boost must despawn when the quest ends");
        check(!s.aliens.some(a => a._questId === qs.id), "no quest ships may outlive their quest");
      }

      // ============ archetype-specific shapes (this phase) ==================
      this.init();
      const s2 = this.state, sts = ForgeWorld.getStations();

      // 6. every new archetype shape generates somewhere (all site types +
      // hostile outposts exist globally, so every action is reachable).
      const acts = new Set();
      let sawMulti = false;
      for (let round = 0; round < 120 && (acts.size < 9 || !sawMulti); round++)
        for (const st of sts)
          for (const q of this.generateStationQuests(st, s2)) {
            if (q.kind === "multi") { sawMulti = true; continue; }
            if (q.kind === "godo" && QUEST_GODO[q.action]) acts.add(q.action);
          }
      for (const want of ["extract", "escort", "salvage", "blackbox", "rescue", "sensor", "bounty", "sabotage", "assault"])
        check(acts.has(want), "archetype quest shape '" + want + "' never generated");
      check(sawMulti, "multi-tier relic quest never generated");

      // pull one fresh OFFER matching pred, across every station's board
      const pull = (pred) => {
        for (let round = 0; round < 200; round++)
          for (const st of sts) {
            const hit = this.generateStationQuests(st, s2).find(pred);
            if (hit) return hit;
          }
        return null;
      };

      // 7. hold + needClear: an ASSAULT only progresses once the target is clear.
      // Held-but-untracked so no boost layer spawns to muddy the defender count.
      const qh = pull(q => q.action === "assault");
      check(!!qh, "no assault quest to test");
      if (qh) {
        this.acceptQuest(qh); this.setActiveQuest(null);
        const o = this.outpostById(qh.outpostId);
        o.streamed = false; o.guardRecs.forEach(r => { r.alive = true; r.frac = 1; });
        const p = this._questActionPos(qh); s2.x = p.x; s2.y = p.y; s2.vx = s2.vy = 0;
        for (let k = 0; k < 10; k++) this.updateQuests(1 / 60);
        check(qh.holdT === 0, "needClear hold must not advance while defenders live");
        o.guardRecs.forEach(r => { r.alive = false; r.frac = 0; });   // player clears the garrison
        for (let k = 0; k < Math.ceil(qh.holdDur * 60) + 4; k++) this.updateQuests(1 / 60);
        check(this.questObjectiveDone(qh), "assault must complete once cleared and held");
        this.abandonQuest(qh);
      }

      // 8. bounty: completes when the outpost commander (garrison index 0) is down.
      const qbty = pull(q => q.action === "bounty");
      check(!!qbty, "no bounty quest to test");
      if (qbty) {
        this.acceptQuest(qbty); this.setActiveQuest(null);
        const o = this.outpostById(qbty.outpostId);
        o.streamed = false; o.guardRecs.forEach(r => { r.alive = true; r.frac = 1; });
        check(!this.questObjectiveDone(qbty), "bounty must stay open while the commander lives");
        o.guardRecs[0].alive = false;                                 // commander eliminated
        check(this.questObjectiveDone(qbty), "bounty must complete when the commander is down");
        this.abandonQuest(qbty);
      }

      // 9. multi-tier relic: ANY-order nodes, death-persistent progress, turn-in.
      const qm = pull(q => q.kind === "multi");
      check(!!qm, "no multi-tier relic quest to test");
      if (qm) {
        this.acceptQuest(qm); this.setActiveQuest(null);   // untracked → no boost interference
        const site = this.siteById(qm.siteId);
        site.streamed = false; site._ships = [];
        site.guardRecs.forEach(r => { r.alive = false; r.frac = 0; });   // outer sentinels down
        const relic = qm.nodes.find(n => n.action === "collect");
        const hold = qm.nodes.find(n => n.action === "hold");
        const rp = this._questNodePos(qm, relic); s2.x = rp.x; s2.y = rp.y; s2.vx = s2.vy = 0;
        this.update(1 / 60);   // full loop once — proves main.js wiring
        check(relic.done, "relic (collect) node must complete out of order");
        // death mid-dig: node progress must survive the respawn
        const cr0 = s2.credits; s2.hp.hull = 0; this.update(1 / 60);
        check(s2.credits < cr0, "death penalty missing (death path did not run)");
        check(s2.quests.includes(qm) && relic.done, "relic-node progress must survive death");
        for (let k = 0; k < 4; k++) this.updateQuests(1 / 60);          // defeat node sees 0 defenders
        check(qm.nodes.find(n => n.action === "defeat").done, "defeat node must clear with no defenders left");
        const hp = this._questNodePos(qm, hold); s2.x = hp.x; s2.y = hp.y; s2.vx = s2.vy = 0;
        for (let k = 0; k < Math.ceil(hold.dur * 60) + 4; k++) this.updateQuests(1 / 60);
        check(qm.nodes.every(n => n.done), "all relic nodes done after visiting in any order");
        check(this.questObjectiveDone(qm) && qm.status === "ready", "finished relic must read ready");
        const stq = this._questStation(qm); s2.docked = true; s2.dockStationId = stq.id;
        const c2 = s2.credits;
        check(this.turnInQuest(qm), "relic turn-in failed");
        check(s2.credits === c2 + qm.reward, "relic reward not credited");
        s2.docked = false;
      }

      // 10. new persistent fields survive _serializeQuest (the save whitelist path)
      const qms = pull(q => q.kind === "multi");
      if (qms) {
        const b = this._serializeQuest(qms);
        check(Array.isArray(b.nodes) && b.nodes.length === 3, "multi nodes must serialize");
        check(b.nodes.every(n => typeof n.done === "boolean" && typeof n.dx === "number"), "serialized node shape");
      }
      const qhs = pull(q => q.action === "assault" || q.action === "rescue");
      if (qhs) {
        const b = this._serializeQuest(qhs);
        check(b.holdDur > 0 && b.needClear === true && typeof b.holdT === "number", "hold fields must serialize");
        check(b.outpostId != null || b.siteId != null, "hold-quest target id must serialize");
      }

      this.init();   // leave a clean world behind (the walk moved the ship)
    } catch (e) {
      fails.push("FAIL: questsSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
