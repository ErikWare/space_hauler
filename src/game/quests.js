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
// Provider slots (lounge UX): main + station + side + open (one each).
// Tracks ONE (s.activeQuestId): only the active quest drives s.navWaypoint
// and only the active quest arms the defender boost — +1-2 extra garrison ships
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
// --- Onboarding ("tutor") quests — the Q1-Q10 ladder in storyline/QUEST_DESIGN.md.
// Unlike godo/chain/multi these are NEVER generated onto a station board:
// game/onboarding.js grants them one at a time on a new game. The objective is a
// plain {need, have} counter fed by a tap in whichever system the quest teaches
// (questTutorDeposit below, called from economy.js depositTows), so a tutor quest
// needs no per-frame tick at all — updateQuests' branch chain skips it and the
// shared "objective done → status ready" check at the bottom picks it up.
const QUEST_TUTOR = {
  haul_junk: { need: 10, reward: 150, unit: "junk hauled", title: "SALVAGE PICKUP",
    desc: "Loose debris drifts all through this sector. Tractor it in and tow it back to the dock — ten pieces.",
    count: (h) => h.junk },
  haul_rock: { need: 10, reward: 250, unit: "ore rocks hauled", title: "ORE PICKUP",
    desc: "Ore rocks this time. Same beam, better cargo — tow ten of them back to the dock.",
    count: (h) => h.rocks },
  // Q3-Q6, the graded-ore ladder: same verb four times, escalating tier and pay.
  // These count by ORE TYPE via hauled.types, so they ignore junk floaters for
  // free (see QUEST_DESIGN.md §7.3 — `junk` is both an array and an ore type).
  // The four tiers are exactly DRONES.barTypes, so this ladder also stocks the
  // hold for Q7's refinery lesson.
  haul_copper: { need: 3, reward: 350, unit: "copper hauled", title: "GRADED CARGO: COPPER",
    desc: "Graded ore from here on. Copper is the bottom rung and it is everywhere — tow three copper rocks back to the dock.",
    count: (h) => h.types && h.types.copper },
  haul_silver: { need: 3, reward: 500, unit: "silver hauled", title: "GRADED CARGO: SILVER",
    desc: "Silver sits further out than copper and pays about triple. Three rocks, same beam, longer trip.",
    count: (h) => h.types && h.types.silver },
  haul_gold: { need: 3, reward: 700, unit: "gold hauled", title: "GRADED CARGO: GOLD",
    desc: "Gold rings are rich enough to be worth guarding, and somebody is usually guarding them. Bring three rocks home.",
    count: (h) => h.types && h.types.gold },
  haul_platinum: { need: 3, reward: 900, unit: "platinum hauled", title: "GRADED CARGO: PLATINUM",
    desc: "Platinum is the top of the common ladder and deep enough that the trip out is the dangerous part. Three rocks.",
    count: (h) => h.types && h.types.platinum },
  // Q7-Q10 — the operative half of the ladder, opened by the Act 0 promotion.
  // These are STATE quests, not delivery quests: nothing is towed, so nothing
  // feeds them through questTutorDeposit. Each declares poll(G, s, q) returning
  // how many of its `need` conditions hold RIGHT NOW, and _questTutorPoll
  // mirrors that onto q.have for display/serialization.
  //
  // Polled on demand rather than on a tick because every one of them is
  // satisfied AT A DOCK — setDroneRole refuses to run undocked (fleet.js:59),
  // the refinery is a dock panel (drones.js:534) — and main.js:306 returns from
  // update() before updateQuests whenever s.docked. A tick-fed counter would
  // leave the rung reading IN PROGRESS on the very screen the player finished it
  // on. questObjectiveDone/questProgressText call the poll instead, which is
  // exactly what the dock's turn-in button (renderQuestsPanel) already reads.
  // The refine half is a LATCH (vn.seen.onb_refined, set by the refineAllOre
  // wrapper in game/onboarding.js), not a "do you hold bars" level — because
  // building the drone this same rung asks for SPENDS those bars
  // (drones.js:103). A holdings test would un-complete itself the moment the
  // player did the other half of their own quest. Bars-on-hand still satisfies
  // it, so a save that refined before the latch existed is not stranded.
  refine_drone: { need: 2, reward: 1200, unit: "milestones", title: "BARS AND A WINGMAN",
    desc: "Raw ore is ballast with a price tag. Run it through the station refinery into bars, and put one drone on your wing while you are docked.",
    poll: (G, s) => (G._tutorRefined(s) ? 1 : 0) + (G.escorts(s).length >= 1 ? 1 : 0),
    text: (G, s) => `refine ore ${G._tutorRefined(s) ? "✓" : "✗"} · 1 drone escorting ${G.escorts(s).length >= 1 ? "✓" : "✗"}` },
  // Starter Vulture only fields 1 escort; Q8 teaches ownership vs wing space —
  // build a second drone that waits in the hangar (garrison / trade / next hull).
  wing_two: { need: 2, reward: 400, unit: "drones owned", title: "HANGAR RESERVE",
    desc: "Your tug only flies one wing drone. Build a second for the hangar — garrison work, trade runs, and the next hull's bigger deck.",
    poll: (G, s) => (s.playerFleet || []).length,
    text: (G, s) => `${Math.min(2, (s.playerFleet || []).length)}/2 drones owned (build at DRONES; only one can escort on a starter tug)` },
  // Baselined against the LIFETIME capture counter (outposts.js:182) rather than
  // against "do you own one": a player who took an outpost during Q1-Q6 should
  // still be asked to take one now, and capturedOutpostCount only ever rises, so
  // the delta cannot be undone by losing the outpost back to its faction.
  take_outpost: { need: 1, reward: 1500, unit: "outposts taken", title: "TAKE THE OUTPOST",
    desc: "Find an enemy outpost, clear its garrison, and put your flag on the platform. This is not a haul job.",
    base: (G, s) => s.capturedOutpostCount || 0,
    poll: (G, s, q) => (s.capturedOutpostCount || 0) - (q.base || 0),
    text: (G, s, q) => ((s.capturedOutpostCount || 0) - (q.base || 0) >= 1
      ? "outpost taken" : "no outpost taken yet — clear a garrison and hold the platform") },
  garrison_outpost: { need: 1, reward: 500, unit: "outposts garrisoned", title: "MAKE IT WORK FOR YOU",
    desc: "An outpost you cannot hold is a gift to whoever comes next. Station a drone on the platform you took.",
    poll: (G, s) => ((s.outposts || []).some(o => o.owner === "player"
      && o.stationedDrones && o.stationedDrones.length >= 1) ? 1 : 0),
    text: (G, s) => {
      const o = (s.outposts || []).find(x => x.owner === "player");
      if (!o) return "no outpost held";
      const n = (o.stationedDrones || []).length;
      return `${Math.min(1, n)}/1 drone stationed (tap the outpost to assign)`;
    } },
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

  // ---- onboarding (tutor) quests -----------------------------------------
  // Built on demand by game/onboarding.js, not by generateStationQuests. Shape
  // matches the generated quests field-for-field so every downstream consumer
  // (log DOM, waypoint, save) treats it as an ordinary held quest.
  makeTutorQuest(key, station) {
    const spec = QUEST_TUTOR[key]; if (!spec || !station) return null;
    const s = this.state;
    const terr = politicalRegionAt(station.pos.x, station.pos.y);
    return { id: s.nextQuestId++, kind: "tutor", action: key,
      stationId: station.id, territory: terr ? terr.name : "",
      title: spec.title, description: spec.desc, difficulty: 1, reward: spec.reward,
      regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
      scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
      need: spec.need, have: 0,
      // Snapshot for the state rungs that measure a DELTA rather than a level
      // (Q9 off the lifetime capture counter). Serialized, so the snapshot a
      // rung was issued against survives a reload.
      base: spec.base ? spec.base(this, s) | 0 : 0,
      boosts: {}, status: "offer" };
  },
  // Total refined bars on hand, across every bar type (drones.js DRONES.barTypes
  // is the authority on which ores refine) — Q7's "you have used the refinery" test.
  _tutorBarsHeld(s) {
    const bars = (s || this.state).refinedBars || {};
    let n = 0;
    for (const k in bars) n += bars[k] | 0;
    return n;
  },
  // "Has this save ever used the refinery?" — the latch set by onboarding.js's
  // refineAllOre wrapper, or bars simply on hand right now.
  _tutorRefined(s) {
    return !!(this._vnSave().seen.onb_refined) || this._tutorBarsHeld(s) > 0;
  },
  // Refresh a STATE rung's counter from live state. q.have is a display mirror
  // for these (the world is the truth), so this is called from
  // questObjectiveDone/questProgressText rather than from a tick — see the
  // QUEST_TUTOR Q7-Q10 note on why a tick would read stale at a dock.
  _questTutorPoll(q) {
    const spec = QUEST_TUTOR[q.action];
    if (!spec || !spec.poll) return q.have || 0;
    q.have = Math.max(0, Math.min(q.need, spec.poll(this, this.state, q) | 0));
    return q.have;
  },
  // Delivery tap — economy.js depositTows hands over what just left the tow
  // chain as {junk, rocks, types:{<oreType>:n}}. Every held tutor quest whose
  // spec counts some of it advances; nothing else in the log is touched.
  // State rungs (Q7-Q10) carry no `count` and are skipped: they are polled.
  questTutorDeposit(hauled) {
    const s = this.state;
    if (!s.quests || !hauled) return;
    for (const q of s.quests) {
      if (q.kind !== "tutor" || (q.have || 0) >= q.need) continue;
      const spec = QUEST_TUTOR[q.action]; if (!spec || !spec.count) continue;
      const n = spec.count(hauled) | 0;
      if (n <= 0) continue;
      q.have = Math.min(q.need, (q.have || 0) + n);
      toast(`⊚ ${q.have}/${q.need} ${spec.unit}`, "#57e6ff");
    }
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
    if (q.kind === "tutor") {
      const sp = QUEST_TUTOR[q.action];
      if (sp && sp.poll) return this._questTutorPoll(q) >= q.need;
      return (q.have || 0) >= q.need;
    }
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
    if (q.kind === "tutor") {
      const sp = QUEST_TUTOR[q.action];
      if (sp && sp.poll) {
        this._questTutorPoll(q);
        if (sp.text) return sp.text(this, this.state, q);
      }
      return `${q.have || 0}/${q.need} ${sp ? sp.unit : "collected"}`;
    }
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
    if (q.kind === "tutor" || this.questObjectiveDone(q)) {
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

  // ---- job providers (lounge: talk to people, one job per provider) --------
  // main    = tutor / story (faction contact)
  // station = berth merc ladder (STATION_FIXERS)
  // side    = free-roam merc pool (HARLAN/ZERA/PELL/ORYN)
  // open    = territory godo/chain/multi OR Phase 4 combat contract
  questProvider(q) {
    if (!q) return null;
    if (q.kind === "tutor" || q.kind === "story") return "main";
    if (q.kind === "merc") return (q.mercStationId != null) ? "station" : "side";
    if (q.kind === "godo" || q.kind === "chain" || q.kind === "multi") return "open";
    return "open";
  },
  heldQuestForProvider(provider, s) {
    s = s || this.state;
    return (s.quests || []).find(q => this.questProvider(q) === provider) || null;
  },
  openSlotBusy(s) {
    s = s || this.state;
    if (this.heldQuestForProvider("open", s)) return true;
    if ((s.contracts || []).length) return true;
    return false;
  },
  canAcceptQuestProvider(q, s) {
    s = s || this.state;
    const p = this.questProvider(q);
    if (!p) return { ok: false, reason: "unknown job" };
    if (p === "main") {
      if (this.heldQuestForProvider("main", s))
        return { ok: false, reason: "finish your main job first", provider: p };
      return { ok: true, provider: p };
    }
    if (p === "open") {
      if (this.openSlotBusy(s))
        return { ok: false, reason: "you already have open-bay work — finish or drop it", provider: p };
      return { ok: true, provider: p };
    }
    // station / side
    if (this.heldQuestForProvider(p, s)) {
      const who = p === "station" ? "the station fixer" : "your side contact";
      return { ok: false, reason: "already on a job with " + who + " — finish or drop it", provider: p };
    }
    return { ok: true, provider: p };
  },

  // ---- accept / abandon / turn in (provider slots; track one) ------------------
  acceptQuest(q) {
    const s = this.state;
    if (!q || q.status !== "offer") return false;
    const gate = this.canAcceptQuestProvider(q, s);
    if (!gate.ok) {
      if (typeof toast === "function") toast(gate.reason, "#ff5060");
      if (typeof sfx === "function") sfx("warn");
      return false;
    }
    const board = s.stationQuests[q.stationId];
    if (board) { const i = board.indexOf(q); if (i >= 0) board.splice(i, 1); }
    q.status = "held";
    s.quests.push(q);
    // MAIN always tracks; others auto-track only if nothing is tracked
    if (gate.provider === "main" || s.activeQuestId == null) this.setActiveQuest(q.id);
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
    // onboarding ladder: hand over the next step (game/onboarding.js). Soft hook
    // so quests.js stays loadable without the onboarding module.
    if (q.kind === "tutor" && this.onboardQuestTurnedIn) this.onboardQuestTurnedIn(q);
    // story quest chain: advance companion beats + grant next mission (game/story_quests.js).
    if (q.kind === "story" && this.storyQuestTurnedIn) this.storyQuestTurnedIn(q);
    // mercenary contract pool: mark spec complete + refresh next dock (game/merc_quests.js).
    if (q.kind === "merc" && this.mercQuestTurnedIn) this.mercQuestTurnedIn(q);
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
    if ((q.kind === "godo" || q.kind === "story") && q.siteId) addSite(q.siteId);
    if ((q.kind === "godo" || q.kind === "story") && q.outpostId) addOutpost(this.outpostById(q.outpostId));
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
      // (station-merc hard ranks may raise boostMin/Max on the quest object)
      if (!q.boosts[rid]) {
        const bMin = (q.boostMin != null) ? q.boostMin : QUESTS.boostMin;
        const bMax = (q.boostMax != null) ? q.boostMax : QUESTS.boostMax;
        const span = Math.max(0, bMax - bMin);
        const nB = bMin + (span ? (this._siteHash(q.id * 131 + rid) % (span + 1)) : 0);
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

  // ---- HUD: active-quest tracker (top-right, under the contract box) ------
  // The quest layer's only always-on readout. Everything else it shows is
  // world-space (drawQuestWorld's reticles, which need the objective on screen)
  // or dock-only (renderQuestsPanel), so without this the player's progress
  // lives entirely in transient toasts — a reload, or one missed toast, leaves
  // a tutor rung looking like it never counted. Shares the top-right column
  // with drawContractHUD, so it drops a row when a contract is also running.
  drawQuestHUD(g) {
    if (HEADLESS) return;
    const s = this.state, q = this.activeQuest();
    if (!q || s.docked) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const w = 158 * k, h = 34 * k, x = CONFIG.W - 12 * k - w;
    const y = (s.contracts && s.contracts[0] ? 232 : 192) * k;   // stack under the contract box
    const ready = this.questObjectiveDone(q);
    const st = this._questStation(q);
    // Fit to the BOX, not to a character count: station names and progress copy
    // vary wildly in length, and k shrinks the font on narrow canvases, so a
    // fixed slice(0,24) overflows the border on exactly the lines that matter
    // ("turn in at <station>"). Measure and trim instead.
    const maxW = w - 16 * k;
    const clip = (t) => {
      if (g.measureText(t).width <= maxW) return t;
      while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    };
    g.fillStyle = "rgba(13,16,23,0.85)";
    g.strokeStyle = ready ? "#7bd88f" : "#57e6ff"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, w, h, 6 * k); g.fill(); g.stroke();
    g.textAlign = "left"; g.textBaseline = "middle";
    g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
    g.fillStyle = "#e8edf4";
    g.fillText(clip("◇ " + q.title), x + 8 * k, y + 10 * k);
    g.font = `${Math.max(8, 9 * k) | 0}px monospace`;
    g.fillStyle = ready ? "#7bd88f" : "#9aa7b8";
    // Verb first, destination second: on a squeezed canvas the clip eats the tail,
    // and "TURN IN" is the part the player must not lose (the waypoint arrow and
    // the QUEST READY toast both already name the station).
    g.fillText(clip(ready ? "▸ TURN IN · " + (st ? st.name : "the issuer") : this.questProgressText(q)),
      x + 8 * k, y + 24 * k);
    g.textBaseline = "alphabetic";
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
      need: q.need != null ? q.need : null, have: +q.have || 0, base: +q.base || 0,
      tiers: Array.isArray(q.tiers)
        ? q.tiers.map(t => ({ regionId: t.regionId, type: t.type, refId: t.refId, done: !!t.done }))
        : null,
      nodes: Array.isArray(q.nodes)
        ? q.nodes.map(n => ({ action: n.action, dx: n.dx, dy: n.dy, r: n.r, dur: n.dur, done: !!n.done, t: +n.t || 0, label: n.label }))
        : null,
      boosts: q.boosts && typeof q.boosts === "object" ? q.boosts : {},
      status: q.status === "ready" ? "ready" : "held",
      mercSpecId: q.mercSpecId || null,
      mercStationId: q.mercStationId != null ? q.mercStationId : null,
      mercRank: q.mercRank || null,
      mercLootTier: q.mercLootTier || null,
      minEscortCap: q.minEscortCap || 0,
      boostMin: q.boostMin != null ? q.boostMin : null,
      boostMax: q.boostMax != null ? q.boostMax : null };
  },

  // ================= DOM: lounge contacts on #contractsPanel ====================
  // People-first Work tab: four providers (main/station/side/open) + Your work.
  // Shared onClick in wireContractsDOM routes data-qact / data-lact buttons.
  _jobProviderLabel(p) {
    return ({ main: "MAIN", station: "STATION", side: "SIDE", open: "OPEN" })[p] || p;
  },
  _jobPortraitSrc(key) {
    if (!key) return "";
    // Resolve through VN_ASSETS when present (faction contacts, mercs, fixers).
    if (typeof VN_ASSETS !== "undefined") {
      const a = VN_ASSETS[key + "_neutral"] || VN_ASSETS[key];
      if (a && a.src) return a.src;
      if (a && a.fallback) {
        const b = VN_ASSETS[a.fallback];
        if (b && b.src) return b.src;
      }
    }
    // Common on-disk locations for lounge faces
    if (key.indexOf("fixer_") === 0 || key === "harlan" || key === "zera"
        || key === "pell" || key === "oryn")
      return "sprites/intro/" + key + ".png";
    if (key === "krag_voss") return "sprites/krag_leader.png";
    if (key === "vex_dren") return "sprites/station_commander.png";
    if (key === "nox_sive") return "sprites/nox_leader.png";
    return "sprites/intro/" + key + ".png";
  },
  _mainContactInfo(s) {
    s = s || this.state;
    const fac = s.playerFaction || "krag";
    const pack = (typeof ONBOARD_VN !== "undefined" && ONBOARD_VN[fac]) ? ONBOARD_VN[fac] : null;
    const name = pack ? pack.speaker : ({ krag: "VOSS", vex: "DREN", nox: "SIVE" }[fac] || "CONTACT");
    const portrait = pack ? (pack.portrait || "").replace(/_neutral$/, "") : fac + "_leader";
    // pack.portrait is often "krag_voss" style root
    const key = pack && pack.portrait ? pack.portrait : ({
      krag: "krag_voss", vex: "vex_dren", nox: "nox_sive",
    }[fac] || "krag_voss");
    return {
      provider: "main", name, title: "Dock Contact",
      color: pack && pack.speaker ? "#ff9a5a" : "#8fd0ff",
      portraitKey: key,
      blurb: "Your main thread — promotions, the ladder, the next real job.",
    };
  },
  _stationFixerInfo(sid) {
    const f = (typeof STATION_FIXERS !== "undefined" && STATION_FIXERS[sid]) ? STATION_FIXERS[sid] : null;
    if (!f) return {
      provider: "station", name: "FIXER", title: "Station Fixer",
      color: "#c8a96e", portraitKey: "fixer_brek",
      blurb: "This berth's rank ladder. Ten rungs; finish them in order.",
    };
    return {
      provider: "station", name: f.name, title: f.title || "Station Fixer",
      color: f.color || "#c8a96e", portraitKey: f.key,
      blurb: f.blurb || "This berth's campaign.",
    };
  },
  _sideContactInfo(offerOrHeld) {
    const npcKey = offerOrHeld && offerOrHeld.mercNpc;
    const npc = (typeof MERC_NPCS !== "undefined" && npcKey && MERC_NPCS[npcKey]) ? MERC_NPCS[npcKey] : null;
    if (npc) {
      return {
        provider: "side", name: npc.name, title: "Roaming Fixer",
        color: npc.color || "#7ec8e3", portraitKey: npc.key,
        blurb: "Free-lane contracts. One at a time.",
      };
    }
    return {
      provider: "side", name: "FIXER", title: "Roaming Fixer",
      color: "#7ec8e3", portraitKey: "harlan",
      blurb: "Free-lane contracts. Redock after the tutorial.",
    };
  },
  _openContactInfo() {
    return {
      provider: "open", name: "DISPATCH", title: "Bay Contractor",
      color: "#9aa7b8", portraitKey: "station_clerk",
      blurb: "Generic territory runs and combat contracts. One open slot.",
    };
  },
  _boardOffers(sid, s) {
    s = s || this.state;
    return (s.stationQuests[sid] || []).filter(q => q.status === "offer");
  },
  _offerForProvider(provider, sid, s) {
    s = s || this.state;
    const offers = this._boardOffers(sid, s);
    if (provider === "station")
      return offers.find(q => q.kind === "merc" && q.mercStationId != null) || null;
    if (provider === "side")
      return offers.find(q => q.kind === "merc" && q.mercStationId == null) || null;
    if (provider === "open")
      return offers.find(q => q.kind === "godo" || q.kind === "chain" || q.kind === "multi") || null;
    return null;
  },
  _mainJobStatus(s) {
    s = s || this.state;
    const held = this.heldQuestForProvider("main", s);
    if (held) {
      const ready = this.questObjectiveDone(held);
      return { state: ready ? "turnin" : "progress", held, offer: null };
    }
    // Tutor/story grants are scripted — card is talk-only when nothing held
    const vn = this._vnSave ? this._vnSave() : null;
    const onbDone = !!(vn && vn.seen && vn.seen.onb_done);
    if (!onbDone) return { state: "available", held: null, offer: null, note: "Continue the hire ladder with your contact." };
    // Story may grant later; no open offer on board
    return { state: "idle", held: null, offer: null, note: "No main job right now — fly your side work." };
  },
  _providerStatus(provider, sid, s) {
    s = s || this.state;
    if (provider === "main") return this._mainJobStatus(s);
    if (provider === "open") {
      const heldQ = this.heldQuestForProvider("open", s);
      if (heldQ) {
        const ready = this.questObjectiveDone(heldQ);
        return { state: ready ? "turnin" : "progress", held: heldQ, offer: null, contract: null };
      }
      const c = (s.contracts || [])[0] || null;
      if (c) {
        return { state: c.status === "complete" ? "turnin" : "progress", held: null, offer: null, contract: c };
      }
      const offer = this._offerForProvider("open", sid, s);
      const cOff = ((s.stationContracts || {})[sid] || []).find(x => x.status === "available") || null;
      if (offer || cOff) return { state: "available", held: null, offer, contractOffer: cOff };
      return { state: "idle", held: null, offer: null, note: "Nothing on the bay wire — redock to refresh." };
    }
    const held = this.heldQuestForProvider(provider, s);
    if (held) {
      const ready = this.questObjectiveDone(held);
      return { state: ready ? "turnin" : "progress", held, offer: null };
    }
    const offer = this._offerForProvider(provider, sid, s);
    if (offer) return { state: "available", held: null, offer };
    const vn = this._vnSave ? this._vnSave() : null;
    if (provider === "side" || provider === "station") {
      if (!(vn && vn.seen && vn.seen.onb_done))
        return { state: "idle", held: null, offer: null, note: "Unlocks after the onboarding ladder." };
    }
    return { state: "idle", held: null, offer: null, note: provider === "station" ? "No rank job right now." : "No free-lane job right now." };
  },
  _loungeChip(state) {
    return ({
      available: ["HAS WORK", "#9fd36a"],
      progress: ["IN PROGRESS", "#57e6ff"],
      turnin: ["TURN IN", "#ffd27a"],
      idle: ["NOTHING", "#5a6578"],
    })[state] || ["—", "#5a6578"];
  },
  renderQuestsPanel() {
    const ct = this._ctDOM(); if (!ct || !ct.qsHeld) return;
    const s = this.state, sid = s.dockStationId;
    const ui = this._loungeUI || (this._loungeUI = { sel: "main" });
    if (!ui.sel) ui.sel = "main";

    // ---- character strip ----
    const lounge = ct.lounge || ct.qsList; // prefer #ctLounge, fallback qsList
    const detail = ct.detail || ct.qsHeld; // prefer #ctDetail — we'll map in _ctDOM
    // Layout: qsList = lounge strip, qsHeld = detail+work when lounge markup present
    // With new markup: ct.lounge, ct.detail, ct.work
    const stripEl = ct.lounge || ct.qsList;
    const detailEl = ct.detail || null;
    const workEl = ct.work || ct.qsHeld;

    const contacts = [
      this._mainContactInfo(s),
      this._stationFixerInfo(sid),
      (() => {
        const st = this._providerStatus("side", sid, s);
        const src = st.held || st.offer;
        return this._sideContactInfo(src);
      })(),
      this._openContactInfo(),
    ];

    if (stripEl) {
      stripEl.innerHTML = "";
      stripEl.classList.add("ctLoungeStrip");
      for (const c of contacts) {
        const st = this._providerStatus(c.provider, sid, s);
        const [chip, chipCol] = this._loungeChip(st.state);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "ctContact" + (ui.sel === c.provider ? " on" : "");
        card.dataset.lact = "select";
        card.dataset.provider = c.provider;
        card.style.borderColor = ui.sel === c.provider ? c.color : "";
        const face = document.createElement("div"); face.className = "ctFace";
        face.style.boxShadow = "inset 0 0 0 2px " + c.color;
        const img = document.createElement("img");
        img.alt = c.name;
        img.src = this._jobPortraitSrc(c.portraitKey);
        img.onerror = function () { this.style.display = "none"; };
        face.appendChild(img);
        const nm = document.createElement("div"); nm.className = "ctContactName";
        nm.textContent = c.name; nm.style.color = c.color;
        const role = document.createElement("div"); role.className = "ctContactRole";
        role.textContent = this._jobProviderLabel(c.provider) + " · " + c.title;
        const badge = document.createElement("div"); badge.className = "ctContactBadge";
        badge.textContent = chip; badge.style.color = chipCol;
        card.appendChild(face); card.appendChild(nm); card.appendChild(role); card.appendChild(badge);
        stripEl.appendChild(card);
      }
    }

    // ---- detail for selected provider ----
    const targetDetail = detailEl || workEl;
    // If we have separate workEl and detailEl, detail is separate; else reuse workEl top
    if (detailEl) detailEl.innerHTML = "";
    if (workEl) workEl.innerHTML = "";

    const sel = ui.sel || "main";
    const info = contacts.find(c => c.provider === sel) || contacts[0];
    const st = this._providerStatus(sel, sid, s);
    const droot = detailEl || (() => {
      const box = document.createElement("div"); box.className = "ctDetailBox";
      if (workEl) workEl.appendChild(box);
      return box;
    })();
    if (detailEl) { /* droot is detailEl */ }

    const head = document.createElement("div"); head.className = "ctDetailHead";
    const hName = document.createElement("div"); hName.className = "ctDetailName";
    hName.textContent = info.name; hName.style.color = info.color;
    const hSub = document.createElement("div"); hSub.className = "ctDesc";
    hSub.textContent = info.title + " — " + (info.blurb || "");
    head.appendChild(hName); head.appendChild(hSub);
    droot.appendChild(head);

    // body: offer / held / idle
    const body = document.createElement("div"); body.className = "ctCard";
    if (st.held) {
      const q = st.held;
      const t = document.createElement("div"); t.className = "ctTitle"; t.textContent = q.title;
      const desc = document.createElement("div"); desc.className = "ctDesc"; desc.textContent = q.description || "";
      const meta = document.createElement("div"); meta.className = "ctMeta";
      meta.textContent = "◇ " + q.reward + "cr · " + this.questProgressText(q);
      body.appendChild(t); body.appendChild(desc); body.appendChild(meta);
    } else if (st.contract) {
      const c = st.contract;
      const t = document.createElement("div"); t.className = "ctTitle"; t.textContent = c.title;
      const desc = document.createElement("div"); desc.className = "ctDesc"; desc.textContent = c.description || "";
      const meta = document.createElement("div"); meta.className = "ctMeta";
      meta.textContent = "◇ " + c.reward + "cr · " + (this.contractProgressText ? this.contractProgressText(c) : c.status);
      body.appendChild(t); body.appendChild(desc); body.appendChild(meta);
    } else if (st.offer) {
      const q = st.offer;
      const t = document.createElement("div"); t.className = "ctTitle"; t.textContent = q.title;
      const desc = document.createElement("div"); desc.className = "ctDesc"; desc.textContent = q.description || "";
      const meta = document.createElement("div"); meta.className = "ctMeta";
      meta.textContent = "◇ " + q.reward + "cr" + (q.difficulty ? " · " + "⭐".repeat(q.difficulty) : "");
      body.appendChild(t); body.appendChild(desc); body.appendChild(meta);
    } else if (st.contractOffer) {
      const c = st.contractOffer;
      const t = document.createElement("div"); t.className = "ctTitle"; t.textContent = c.title;
      const desc = document.createElement("div"); desc.className = "ctDesc"; desc.textContent = c.description || "";
      const meta = document.createElement("div"); meta.className = "ctMeta";
      meta.textContent = "◇ " + c.reward + "cr · combat contract";
      body.appendChild(t); body.appendChild(desc); body.appendChild(meta);
    } else {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = st.note || "Nothing right now.";
      body.appendChild(note);
    }
    droot.appendChild(body);

    // actions
    const row = document.createElement("div"); row.className = "ctBtnRow";
    if (st.held) {
      const q = st.held;
      const isActive = s.activeQuestId === q.id;
      const tr = document.createElement("button"); tr.className = "ghBtn" + (isActive ? " go" : "");
      tr.textContent = isActive ? "◉ TRACKING — map waypoint" : "○ TRACK";
      tr.dataset.qact = "active"; tr.dataset.qid = String(q.id);
      row.appendChild(tr);
      const ready = this.questObjectiveDone(q), here = q.stationId === sid;
      const ti = document.createElement("button"); ti.className = "ghBtn";
      const stn = this._questStation(q);
      ti.textContent = ready
        ? (here ? "TURN IN ▸ +" + q.reward + "cr" : "turn in at " + (stn ? stn.name : "issuer"))
        : "IN PROGRESS";
      ti.disabled = !(ready && here);
      if (ready && here) ti.classList.add("go");
      ti.dataset.qact = "turnin"; ti.dataset.qid = String(q.id);
      row.appendChild(ti);
      const ab = document.createElement("button"); ab.className = "ghBtn ctAbandon";
      ab.textContent = "DROP JOB"; ab.dataset.qact = "abandon"; ab.dataset.qid = String(q.id);
      row.appendChild(ab);
    } else if (st.contract) {
      const c = st.contract;
      const here = c.stationId === sid;
      const ready = c.status === "complete" && here;
      const ti = document.createElement("button"); ti.className = "ghBtn";
      ti.textContent = c.status === "complete"
        ? (here ? "TURN IN ▸ +" + c.reward + "cr" : "turn in at issuer")
        : "IN PROGRESS";
      ti.disabled = !ready;
      if (ready) ti.classList.add("go");
      ti.dataset.act = "turnin";
      row.appendChild(ti);
      const ab = document.createElement("button"); ab.className = "ghBtn ctAbandon";
      ab.textContent = "DROP JOB"; ab.dataset.act = "abandon";
      row.appendChild(ab);
    } else if (st.offer) {
      const btn = document.createElement("button"); btn.className = "ghBtn go";
      btn.textContent = "TALK / TAKE JOB";
      btn.dataset.qact = "accept"; btn.dataset.qid = String(st.offer.id);
      row.appendChild(btn);
    } else if (st.contractOffer) {
      const btn = document.createElement("button"); btn.className = "ghBtn go";
      btn.textContent = "TALK / TAKE JOB";
      btn.dataset.act = "accept"; btn.dataset.cid = String(st.contractOffer.id);
      row.appendChild(btn);
    } else if (sel === "main" && st.state === "available") {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "Your contact handles the main ladder in dialogue — check the dockmaster after hauls.";
      droot.appendChild(note);
    }
    if (row.childNodes.length) droot.appendChild(row);

    // Prefer quest offer over contract for open when both exist: show secondary take
    if (sel === "open" && st.offer && st.contractOffer && !st.held && !st.contract) {
      const row2 = document.createElement("div"); row2.className = "ctBtnRow";
      const btn2 = document.createElement("button"); btn2.className = "ghBtn";
      btn2.textContent = "OR COMBAT: " + st.contractOffer.title.slice(0, 28);
      btn2.dataset.act = "accept"; btn2.dataset.cid = String(st.contractOffer.id);
      row2.appendChild(btn2);
      droot.appendChild(row2);
    }

    // ---- Your work list ----
    const wroot = workEl;
    if (wroot) {
      // if detail was inlined into workEl, append section header
      const h2 = document.createElement("h2");
      h2.textContent = "Your work — TRACK sets the map waypoint";
      h2.style.marginTop = "12px";
      wroot.appendChild(h2);
      if (!s.quests.length && !(s.contracts || []).length) {
        const note = document.createElement("div"); note.className = "ghNote";
        note.textContent = "no jobs held — talk to someone above";
        wroot.appendChild(note);
      }
      for (const q of s.quests) {
        const isActive = s.activeQuestId === q.id;
        const card = this._ctCard(q);
        if (isActive) card.classList.add("qActive");
        const prov = this.questProvider(q);
        const tag = document.createElement("div"); tag.className = "ctMeta";
        tag.textContent = this._jobProviderLabel(prov) + (isActive ? " · TRACKING" : "");
        card.insertBefore(tag, card.firstChild);
        const brow = document.createElement("div"); brow.className = "ctBtnRow";
        const act = document.createElement("button"); act.className = "ghBtn" + (isActive ? " go" : "");
        act.textContent = isActive ? "◉ TRACKING" : "○ TRACK";
        act.dataset.qact = "active"; act.dataset.qid = String(q.id);
        brow.appendChild(act);
        const ready = this.questObjectiveDone(q), here = q.stationId === sid;
        const ti = document.createElement("button"); ti.className = "ghBtn";
        const stn = this._questStation(q);
        ti.textContent = ready
          ? (here ? "TURN IN ▸ +" + q.reward + "cr" : "turn in at " + (stn ? stn.name : "issuer"))
          : this.questProgressText(q);
        ti.disabled = !(ready && here);
        if (ready && here) ti.classList.add("go");
        ti.dataset.qact = "turnin"; ti.dataset.qid = String(q.id);
        brow.appendChild(ti);
        card.appendChild(brow);
        wroot.appendChild(card);
      }
      if ((s.contracts || [])[0]) {
        const c = s.contracts[0];
        const card = this._ctCard(c, { active: true });
        const tag = document.createElement("div"); tag.className = "ctMeta";
        tag.textContent = "OPEN · COMBAT";
        card.insertBefore(tag, card.firstChild);
        wroot.appendChild(card);
      }
    }
  },
  questDomAct(btn) {
    const s = this.state, act = btn.dataset.qact;
    if (act === "select" || btn.dataset.lact === "select") {
      this._loungeUI = this._loungeUI || {};
      this._loungeUI.sel = btn.dataset.provider || "main";
      return;
    }
    const id = +btn.dataset.qid;
    if (act === "accept") {
      const q = (s.stationQuests[s.dockStationId] || []).find(x => x.id === id);
      if (!q) return;
      // Play merc brief if registered, then accept (vnStart is fire-and-forget flavour).
      if (q.mercBriefSceneId && typeof this.vnStart === "function" && typeof VN_SCENES !== "undefined"
          && VN_SCENES[q.mercBriefSceneId] && !HEADLESS) {
        try { this.vnStart(q.mercBriefSceneId); } catch (e) { /* non-fatal */ }
      }
      this.acceptQuest(q);
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
        check(this.acceptQuest(qa), "first open accept must succeed");
        check(!this.acceptQuest(qb), "OPEN provider allows only one godo/chain/multi");
        check(s.activeQuestId === qa.id, "first accepted quest must auto-track");
        // free OPEN slot, then accept qb to test waypoint handoff
        this.abandonQuest(qa);
        check(this.acceptQuest(qb), "second open accept after abandon must succeed");
        // grab another godo for dual-hold is impossible; use a merc side if available
        // waypoint tests on single held open job:
        this.updateQuests(1 / 60);
        const pb = this._questObjectivePoint(qb);
        check(!!s.navWaypoint && s.navWaypoint.x === pb.x && s.navWaypoint.y === pb.y,
          "waypoint must aim at the ACTIVE quest's objective");
        this.setActiveQuest(null);
        check(s.navWaypoint === null, "untracking must clear the quest waypoint");
        this.setActiveQuest(qb.id);
        check(!!s.navWaypoint && s.navWaypoint.x === pb.x && s.navWaypoint.y === pb.y, "re-track must re-aim");
        this.abandonQuest(qb);
        // provider helpers sanity
        check(this.questProvider({ kind: "tutor" }) === "main", "tutor is main");
        check(this.questProvider({ kind: "merc", mercStationId: 0 }) === "station", "station merc");
        check(this.questProvider({ kind: "merc" }) === "side", "side merc");
        check(this.questProvider({ kind: "godo" }) === "open", "godo is open");
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

      // 11. HUD tracker (drawQuestHUD): it is the only always-on quest readout,
      // and it prints questProgressText verbatim — an empty string there renders
      // a blank box, so every shape the generator can emit must have copy.
      check(typeof this.drawQuestHUD === "function", "drawQuestHUD missing (the in-flight quest tracker)");
      const seenShapes = new Set();
      for (let round = 0; round < 60 && seenShapes.size < 12; round++)
        for (const st of sts)
          for (const q of this.generateStationQuests(st, s2)) {
            const shape = q.kind === "godo" ? q.action : q.kind;
            if (seenShapes.has(shape)) continue;
            seenShapes.add(shape);
            check(!!this.questProgressText(q),
              "quest shape '" + shape + "' has no tracker progress text");
            check(!!q.title, "quest shape '" + shape + "' has no title to track");
          }

      this.init();   // leave a clean world behind (the walk moved the ship)
    } catch (e) {
      fails.push("FAIL: questsSelfTest threw: " + (e && e.message));
    }
    return fails;
  },

  // ---- lounge / provider playtest (Work tab flow, headless) ---------------
  loungeSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;
      const stations = ForgeWorld.getStations();
      check(!!stations.length, "no stations");
      s.playerFaction = "krag";
      this._vnSave().seen.onb_done = true;
      s.mercCompleted = [];

      // Taxonomy
      check(this.questProvider({ kind: "tutor" }) === "main", "tutor → main");
      check(this.questProvider({ kind: "story" }) === "main", "story → main");
      check(this.questProvider({ kind: "merc", mercStationId: 0 }) === "station", "station merc");
      check(this.questProvider({ kind: "merc" }) === "side", "side merc");
      check(this.questProvider({ kind: "godo" }) === "open", "godo → open");
      check(this.questProvider({ kind: "chain" }) === "open", "chain → open");
      check(this.questProvider({ kind: "multi" }) === "open", "multi → open");

      // Portraits resolve
      for (const key of ["krag_voss", "vex_dren", "nox_sive", "harlan", "fixer_brek", "zera"]) {
        const src = this._jobPortraitSrc(key);
        check(!!src && src.indexOf("sprites/") === 0, "portrait path for " + key + ": " + src);
      }

      // Contact info helpers
      const main = this._mainContactInfo(s);
      check(main.provider === "main" && main.name === "VOSS", "krag main contact is VOSS");
      const fix = this._stationFixerInfo(stations[0].id);
      check(fix.provider === "station" && !!fix.name, "station fixer has a name");
      const openC = this._openContactInfo();
      check(openC.provider === "open" && openC.name === "DISPATCH", "open contact is DISPATCH");

      // Board after tutorial: merc inject
      this.generateStationQuests(stations[0], s);
      if (typeof this.generateStationContracts === "function")
        this.generateStationContracts(stations[0], s);
      const board = s.stationQuests[stations[0].id] || [];
      const stationMercs = board.filter(q => q.kind === "merc" && q.mercStationId != null);
      const sideMercs = board.filter(q => q.kind === "merc" && q.mercStationId == null);
      const opens = board.filter(q => q.kind === "godo" || q.kind === "chain" || q.kind === "multi");
      check(stationMercs.length <= 1, "≤1 station merc offer, got " + stationMercs.length);
      check(sideMercs.length <= 1, "≤1 side merc offer, got " + sideMercs.length);
      check(opens.length >= 1, "at least one OPEN territory offer");

      // Provider status chips
      let stOpen = this._providerStatus("open", stations[0].id, s);
      check(stOpen.state === "available" || stOpen.state === "idle", "open status before accept: " + stOpen.state);
      if (opens[0]) {
        check(stOpen.offer || stOpen.state === "available", "open should surface an offer when board has godo");
      }

      // Accept OPEN once; second OPEN refused
      const o1 = opens[0];
      const o2 = opens[1] || null;
      check(this.acceptQuest(o1), "first OPEN accept");
      check(this.heldQuestForProvider("open", s) === o1, "held open is o1");
      check(s.activeQuestId === o1.id, "first job auto-tracks");
      stOpen = this._providerStatus("open", stations[0].id, s);
      check(stOpen.state === "progress" || stOpen.state === "turnin", "open status after accept: " + stOpen.state);
      if (o2) {
        check(!this.acceptQuest(o2), "second OPEN must be refused");
        check(s.quests.filter(q => this.questProvider(q) === "open").length === 1, "still one open held");
      }
      // openSlotBusy
      check(this.openSlotBusy(s) === true, "open slot busy with quest");

      // SIDE + STATION can coexist with OPEN
      if (sideMercs[0]) {
        // re-fetch board may have removed accepted; side still on board if not accepted
        let side = (s.stationQuests[stations[0].id] || []).find(q => q.kind === "merc" && q.mercStationId == null);
        if (!side) {
          // regenerate other station for side offer without wiping held
          this._vnSave().seen.onb_done = true;
          // push a synthetic side offer
          side = {
            id: s.nextQuestId++, kind: "merc", action: "scan", status: "offer",
            stationId: stations[0].id, territory: "test", title: "SIDE TEST",
            description: "test", difficulty: 1, reward: 100,
            regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
            scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
            boosts: {}, mercSpecId: "lounge_side_test", mercNpc: "harlan",
          };
          (s.stationQuests[stations[0].id] = s.stationQuests[stations[0].id] || []).push(side);
        }
        check(this.acceptQuest(side), "SIDE accept while OPEN held");
        check(this.heldQuestForProvider("side", s), "side held");
        // second side refused
        const side2 = {
          id: s.nextQuestId++, kind: "merc", action: "scan", status: "offer",
          stationId: stations[0].id, territory: "test", title: "SIDE TEST 2",
          description: "test", difficulty: 1, reward: 100,
          regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
          scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
          boosts: {}, mercSpecId: "lounge_side_test2", mercNpc: "zera",
        };
        (s.stationQuests[stations[0].id] || []).push(side2);
        check(!this.acceptQuest(side2), "second SIDE refused");
      }

      let stationOffer = (s.stationQuests[stations[0].id] || [])
        .find(q => q.kind === "merc" && q.mercStationId != null);
      if (!stationOffer) {
        stationOffer = {
          id: s.nextQuestId++, kind: "merc", action: "scan", status: "offer",
          stationId: stations[0].id, territory: "test", title: "STATION R1",
          description: "test", difficulty: 1, reward: 100,
          regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
          scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
          boosts: {}, mercSpecId: "st0_r1", mercNpc: "fixer_brek",
          mercStationId: stations[0].id, mercRank: 1,
        };
        (s.stationQuests[stations[0].id] = s.stationQuests[stations[0].id] || []).push(stationOffer);
      }
      check(this.acceptQuest(stationOffer), "STATION accept with OPEN (+ SIDE) held");
      check(this.heldQuestForProvider("station", s), "station held");
      check(s.quests.length >= 2, "multi-provider hold works, n=" + s.quests.length);

      // TRACK handoff
      const sideHeld = this.heldQuestForProvider("side", s);
      const openHeld = this.heldQuestForProvider("open", s);
      if (sideHeld && openHeld) {
        this.setActiveQuest(sideHeld.id);
        check(s.activeQuestId === sideHeld.id, "track side");
        this.setActiveQuest(openHeld.id);
        check(s.activeQuestId === openHeld.id, "track open");
        this.setActiveQuest(null);
        check(s.activeQuestId == null, "untrack");
        this.setActiveQuest(openHeld.id);
      }

      // Contract vs OPEN mutual exclusion
      this.abandonQuest(this.heldQuestForProvider("open", s));
      check(!this.openSlotBusy(s) || this.heldQuestForProvider("side", s) || this.heldQuestForProvider("station", s),
        "open free after abandon (other providers may remain)");
      check(!this.heldQuestForProvider("open", s), "open cleared");
      // If contracts system available, take one and ensure open blocked
      if (typeof this.generateStationContracts === "function" && typeof this.acceptContract === "function") {
        this.generateStationContracts(stations[0], s);
        const cAvail = (s.stationContracts[stations[0].id] || []).filter(c => c.status === "available");
        if (cAvail[0]) {
          check(this.acceptContract(cAvail[0]), "accept combat contract into OPEN slot");
          check(this.openSlotBusy(s), "contract occupies open slot");
          // fresh open offer should refuse
          const freshOpen = {
            id: s.nextQuestId++, kind: "godo", action: "scan", status: "offer",
            stationId: stations[0].id, territory: "test", title: "BLOCKED OPEN",
            description: "test", difficulty: 1, reward: 50,
            regionId: null, siteId: null, outpostId: null, tiers: null, nodes: null,
            scanT: 0, collected: false, holdT: 0, holdR: null, holdDur: null, needClear: false,
            boosts: {},
          };
          (s.stationQuests[stations[0].id] || []).push(freshOpen);
          check(!this.acceptQuest(freshOpen), "OPEN quest refused while contract held");
          if (typeof this.abandonContract === "function") this.abandonContract(s.contracts[0]);
        }
      }

      // MAIN status post-tutorial (no held main)
      const mainSt = this._mainJobStatus(s);
      check(mainSt.state === "idle" || mainSt.state === "available", "main status: " + mainSt.state);

      // Loadout slot count helper (same source as UI)
      const vN = this.hullEquipSlots(CONFIG.hulls.vulture);
      const eN = this.hullEquipSlots(CONFIG.hulls.nox_eclipse);
      check(vN === 3, "vulture 3 slots, got " + vN);
      check(eN === 6, "eclipse 6 slots, got " + eN);

      // canAcceptQuestProvider gate messages
      const gate = this.canAcceptQuestProvider({ kind: "godo", status: "offer" }, s);
      // may or may not be free depending on contract abandon
      check(typeof gate.ok === "boolean" && gate.provider === "open", "gate shape ok");

      this.init();
    } catch (e) {
      fails.push("FAIL: loungeSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
