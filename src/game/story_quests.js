/*=== HARNESS:STORY_QUESTS ===================================================*/
// Act 2 and Act 3 story quests. Granted one at a time by the story sequencer,
// gated on companion-beat milestones, never by the station board.
//
// Quest shape: kind "story" — behaves exactly like a godo quest for objective
// evaluation and waypoint routing (all action-based branches in quests.js apply),
// but turnInQuest fires storyQuestTurnedIn() rather than onboardQuestTurnedIn().
//
// Sequencer (storyQuestTurnedIn + _vnMaybeCompBeat in visual_novel.js):
//   Act 2 VN close  → grant a2q1
//   a2q1 turn-in    → comp beat2 → grant a2q2
//   a2q2 turn-in    → comp beat3 → grant a2q3
//   a2q3 turn-in    → comp beat4 → grant a3q1
//   a3q1 turn-in    → grant a3q2
//   a3q2 turn-in    → _vnMaybeAct3 (the Act 3 climax)
//
// Core game loop tie-in: Act 2 missions are outpost-capture / territory-work.
// The player is building a freelance base of operations: each outpost supports
// up to 3 drones earning passive income. Briefing lines reference this loop.

/* ---- VN briefing scenes ---------------------------------------------------
   Standalone scenes: NOT reachable from any act chain, so the vnSelfTest
   isolation walk never touches them. 2 lines max, next: null. They fire
   immediately after quest grant so the player hears the contact's brief
   for the mission already in their log.                                     */
(function () {
  if (typeof VN_SCENES === "undefined") return;   // headless: VN not loaded yet
  const add = (sc) => { VN_SCENES[sc.id] = sc; };

  /* ---- KRAG ACT 2 — VOSS (bg_krag_dock, neutral then grim) -------------- */
  add({ id: "krag_a2q1_brief", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "There's an outpost keeping our supply approach contested. Take it — clear every defender, hold the platform." },
      { speaker: "VOSS", text: "Station a drone there when you're done. An empty platform is just waiting to be re-taken, and I have had enough of re-taking." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "krag_a2q2_brief", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Reva tells me you did the first one clean. Good. There is a second platform — same job." },
      { speaker: "VOSS", text: "Clear it, hold it, drone it up. I will be watching the income numbers this time." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "krag_a2q3_brief", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Last contested point on the approach. After this, the sector runs clean and you start seeing real drone returns." },
      { speaker: "VOSS", text: "Don't just clear it. Fortify it. I want to know it is ours next week, not somebody else's problem." },
    ], choices: null, next: null, autoAdvance: null });

  /* ---- KRAG ACT 3 — VOSS (grim) ----------------------------------------- */
  add({ id: "krag_a3q1_brief", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "There's a site in our territory that nobody has touched in two hundred years. I want a full sweep — hold position until the scan finalizes." },
      { speaker: "VOSS", text: "Whatever that log deck says about who laid the countersign, I want to know before Internal does." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "krag_a3q2_brief", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Harrow is on a tether off Mira. Combine Internal is on the same tether, reading his appointment book, and ours." },
      { speaker: "VOSS", text: "We are going up. Your platform, my authorization, and we do not announce this in advance. Keep a count of the exits before you go in." },
    ], choices: null, next: null, autoAdvance: null });

  /* ---- VEX ACT 2 — DREN (bg_vex_hangar) --------------------------------- */
  add({ id: "vex_a2q1_brief", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "The routing anomaly has a physical anchor — an outpost, occupied by persons not on any filed roster. Clear it and hold it." },
      { speaker: "DREN", text: "Station a drone on the platform when you're done. Income offsets the operational risk, and Cade says it offsets it considerably." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "vex_a2q2_brief", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "There's a flight recorder in the debris field adjacent to the position you cleared. The flight data will tell us who placed those occupants." },
      { speaker: "DREN", text: "Retrieve it before the next patrol cycle. Cade says he can provide a distraction, which I have declined to file as official." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "vex_a2q3_brief", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "One more position before the sector is clean. Cade says this one is harder. I am inclined to agree and decline to say so out loud." },
      { speaker: "DREN", text: "Take it and hold it. Three linked platforms running drones each — that is what the numbers look like when this is done." },
    ], choices: null, next: null, autoAdvance: null });

  /* ---- VEX ACT 3 — DREN (tired) ----------------------------------------- */
  add({ id: "vex_a3q1_brief", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "tired", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "There is a site nine surveys describe as unremarkable. One of those surveys was filed by us. Hold a sensor array on it until the sweep is complete." },
      { speaker: "DREN", text: "No log, no transponder. Whatever is transmitting out there has been reading Dominion filings for two hundred years — don't hand it a schedule." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "vex_a3q2_brief", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "tired", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "There is a wreck in our territory with a hull number ground off. The flight recorder will tell us what it actually was." },
      { speaker: "DREN", text: "Retrieve it before the next patrol rotation. Cade has instructions about the aft compartment. I am passing them along without comment." },
    ], choices: null, next: null, autoAdvance: null });

  /* ---- NOX ACT 2 — SIVE (bg_nox_cryo) ----------------------------------- */
  add({ id: "nox_a2q1_brief", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "There is a platform near the outer mooring that I would like to have under different management. Quietly, if you can manage it." },
      { speaker: "SIVE", text: "The difference between a clean transfer and a contested one is four months of repair drone fees, and I dislike avoidable fees." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "nox_a2q2_brief", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "A cache. In the sector adjacent to the position you secured. Retrieve it without logging the flight." },
      { speaker: "SIVE", text: "Lira will confirm the coordinates. She has been very careful about which coordinates she shares with me, which I find reassuring." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "nox_a2q3_brief", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "The last platform before the approach is ours in all but name, and I am working on the name part." },
      { speaker: "SIVE", text: "Three platforms, three drone slots each — that is what the numbers look like when this is done. Please station something on each one." },
    ], choices: null, next: null, autoAdvance: null });

  /* ---- NOX ACT 3 — SIVE (pleased on the reveal) ------------------------- */
  add({ id: "nox_a3q1_brief", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "A second mooring. Further than the first. The same approach window — hold station until the sensor sweep is complete." },
      { speaker: "SIVE", text: "Do not examine the far berth. I am aware that instruction draws attention to it. I am making the request anyway." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "nox_a3q2_brief", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "pleased", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "There is something I have been deciding whether to show you. I have decided." },
      { speaker: "SIVE", text: "The coordinates are in your nav log. The charts call it a ruin. I would prefer you see it before you read anything else about what it is." },
    ], choices: null, next: null, autoAdvance: null });
})();

/* ---- Story quest spec table -----------------------------------------------
   Each entry: { phase, idx, action, fallback, brief, title, desc(where) }
   action/fallback are QUEST_GODO keys (or "scan"/"collect"/"defeat").
   brief is a VN_SCENES id. desc(where) builds the quest description string. */
const STORY_QUEST_SPECS = {
  /* ---------- KRAG -------------------------------------------------------- */
  krag_a2q1: { phase: "a2", idx: 1, action: "assault",  fallback: "sabotage",
    brief: "krag_a2q1_brief", title: "SECURE: APPROACH A",
    desc: (w) => `Garrison dug in at ${w}. Clear every defender, hold the platform, then report back. Station a drone there — idle platforms get re-taken.` },
  krag_a2q2: { phase: "a2", idx: 2, action: "assault",  fallback: "scan",
    brief: "krag_a2q2_brief", title: "SECURE: APPROACH B",
    desc: (w) => `Second approach platform at ${w} — same job as the first. Clear it, hold it, station a drone, then report to Voss.` },
  krag_a2q3: { phase: "a2", idx: 3, action: "sabotage", fallback: "assault",
    brief: "krag_a2q3_brief", title: "FINAL CLAIM",
    desc: (w) => `Last contested approach point at ${w}. Hold long enough to register the claim, then report back. Fortify and station a drone.` },
  krag_a3q1: { phase: "a3", idx: 1, action: "scan",     fallback: "sensor",
    brief: "krag_a3q1_brief", title: "SURVEY: LONG WATCH",
    desc: (w) => `Full sweep at ${w} — hold position until the scan finalizes. Voss wants the complete log before Combine Internal gets there.` },
  krag_a3q2: { phase: "a3", idx: 2, action: "assault",  fallback: "sabotage",
    brief: "krag_a3q2_brief", title: "ENGAGE: HARROW TETHER",
    desc: (w) => `Combine Internal has the position at ${w}. Clear it. Voss has authorization — keep a count of the exits before you go in.` },

  /* ---------- VEX --------------------------------------------------------- */
  vex_a2q1: { phase: "a2", idx: 1, action: "assault",  fallback: "sabotage",
    brief: "vex_a2q1_brief", title: "CLEAR: SIGNAL ANCHOR",
    desc: (w) => `Unregistered occupants at ${w}. Clear them, hold the position, station a drone — DREN wants income on this node.` },
  vex_a2q2: { phase: "a2", idx: 2, action: "blackbox", fallback: "salvage",
    brief: "vex_a2q2_brief", title: "RECOVER: FLIGHT DATA",
    desc: (w) => `Flight recorder still aboard ${w}. Clear any scavengers, pull the box, and return it. Do not open the aft compartment.` },
  vex_a2q3: { phase: "a2", idx: 3, action: "assault",  fallback: "bounty",
    brief: "vex_a2q3_brief", title: "COMPLETE: SECTOR LINE",
    desc: (w) => `Final position — clear ${w} and hold it. Three linked platforms running drones means real passive income; station something there.` },
  vex_a3q1: { phase: "a3", idx: 1, action: "sensor",   fallback: "scan",
    brief: "vex_a3q1_brief", title: "SURVEY: ASSESSED VOLUME",
    desc: (w) => `Deploy a sensor array near ${w} and hold until the sweep is complete. No log, no transponder — this volume is not as empty as the surveys claim.` },
  vex_a3q2: { phase: "a3", idx: 2, action: "blackbox", fallback: "salvage",
    brief: "vex_a3q2_brief", title: "RECOVER: VD-77 DATA",
    desc: (w) => `Wreck at ${w} with a hull number ground off. Retrieve the flight recorder before the next patrol. Cade's aft compartment instructions apply.` },

  /* ---------- NOX --------------------------------------------------------- */
  nox_a2q1: { phase: "a2", idx: 1, action: "sabotage", fallback: "assault",
    brief: "nox_a2q1_brief", title: "QUIET DISPLACEMENT",
    desc: (w) => `The outpost at ${w} needs to change management. Hold near it long enough to register the transfer, then report. Quietly, if possible.` },
  nox_a2q2: { phase: "a2", idx: 2, action: "collect",  fallback: "scan",
    brief: "nox_a2q2_brief", title: "CACHE RUN",
    desc: (w) => `Supply cache adrift in ${w}. Retrieve it and bring it home — do not log the flight. Sive says the approach is quiet, and Lira verified it.` },
  nox_a2q3: { phase: "a2", idx: 3, action: "assault",  fallback: "sabotage",
    brief: "nox_a2q3_brief", title: "FINAL APPROACH",
    desc: (w) => `Last platform before the approach is ours — clear the outpost at ${w} and hold it. Three platforms running three drones each is the shape this becomes.` },
  nox_a3q1: { phase: "a3", idx: 1, action: "sensor",   fallback: "scan",
    brief: "nox_a3q1_brief", title: "THE FURTHER MOORING",
    desc: (w) => `Hold station near ${w} for the full sensor window. Do not examine the far berth. This is a direct request, not a suggestion.` },
  nox_a3q2: { phase: "a3", idx: 2, action: "collect",  fallback: "scan",
    brief: "nox_a3q2_brief", title: "NOX PRIME",
    desc: (w) => `Sive has coordinates at ${w}. The charts call it a ruin — she would like you to see it before you read anything else about what it is.` },
};

Object.assign(GAME, {

  // ---- synthetic quest builder --------------------------------------------
  // Build a quest of the given action type targeting something in the
  // issuing station's territory. Returns null if no matching target exists.
  _storyMakeSynthQuest(action, st) {
    const s = this.state;
    const terr = politicalRegionAt(st.pos.x, st.pos.y);
    if (!terr) return null;
    const own = ownablesOfTerritory(terr.name);
    const rids = regionsOfTerritory(terr.name);
    const spec = QUEST_GODO[action];
    const diff = this.stationDifficulty(st);
    const [lo, hi] = QUESTS.rewards[diff];
    const baseReward = Math.round((lo + rnd() * (hi - lo)) / 5) * 5;

    let regionId = null, siteId = null, outpostId = null;
    let holdR = null, holdDur = null, needClear = false, collected = false;

    if (action === "scan" || action === "defeat") {
      const sites = own.filter(e => e.type === "site");
      if (!sites.length) return null;
      const e = sites[(rnd() * sites.length) | 0];
      regionId = e.regionId; siteId = e.entity.id;
    } else if (action === "collect") {
      if (!rids.length) return null;
      regionId = rids[(rnd() * rids.length) | 0];
    } else if (spec) {
      if (spec.tgt === "outpost") {
        const hostile = own.filter(e => e.type === "outpost" && e.entity.owner !== "player");
        if (!hostile.length) return null;
        const e = hostile[(rnd() * hostile.length) | 0];
        outpostId = e.entity.id; regionId = e.regionId;
      } else {
        const typed = own.filter(e => e.type === "site" && e.entity.type === spec.type);
        const pool = typed.length ? typed : own.filter(e => e.type === "site");
        if (!pool.length) return null;
        const e = pool[(rnd() * pool.length) | 0];
        regionId = e.regionId; siteId = e.entity.id;
      }
      if (spec.mech === "hold") { holdR = spec.r; holdDur = spec.dur; }
      needClear = !!spec.need;
      if (spec.mech === "collect") collected = false;
    } else {
      return null;
    }

    // Build the human-readable "where" string for description injection
    const lbl = this.regionLabel(this.regionGet(regionId));
    let where;
    if (outpostId)  where = `the fortified outpost in ${lbl}`;
    else if (siteId) {
      const site = this.siteById(siteId);
      where = site ? `the ${SITE_DEFS[site.type].label} in ${lbl}` : `the site in ${lbl}`;
    } else           where = `sector ${lbl}`;

    const reward = Math.round(baseReward * (QUEST_RMULT[action] || 1) / 5) * 5;
    return {
      id: s.nextQuestId++, kind: "story", action,
      stationId: st.id, territory: terr.name,
      title: "", description: "", difficulty: diff, reward,
      regionId, siteId, outpostId, tiers: null, nodes: null,
      scanT: 0, collected,
      holdT: 0, holdR, holdDur, needClear,
      need: null, have: 0, base: 0,
      boosts: {}, status: "held",
      _storyWhere: where,   // ephemeral helper, not persisted
    };
  },

  // Grant a story quest by key (e.g. "krag_a2q1"). Picks a synthetic target
  // from the home territory, overrides title/desc with story copy, fires the
  // briefing VN scene (80 ms deferred so any closing VN fully clears first).
  _storyGrantQuest(questKey) {
    const s = this.state;
    if (!s.mercenary) return false;
    if (s.quests.some(q => q.kind === "story")) return false;   // only one at a time
    const spec = STORY_QUEST_SPECS[questKey]; if (!spec) return false;
    const st = this.homeStationObj(); if (!st) return false;

    let q = null;
    for (const action of [spec.action, spec.fallback]) {
      if (!action) continue;
      q = this._storyMakeSynthQuest(action, st);
      if (q) break;
    }
    if (!q) return false;

    const where = q._storyWhere || "the target";
    delete q._storyWhere;
    q.title       = spec.title;
    q.description = typeof spec.desc === "function" ? spec.desc(where) : (spec.desc || "");

    s.quests.push(q);
    if (s.activeQuestId == null) this.setActiveQuest(q.id);
    this.saveGame();
    toast("MISSION: " + q.title, "#ffd24a"); sfx("buy");

    // Fire briefing VN scene (non-headless, deferred so VN queue is clear)
    const briefId = spec.brief;
    if (typeof HEADLESS === "undefined" || !HEADLESS) {
      if (typeof VN_SCENES !== "undefined" && briefId && VN_SCENES[briefId]) {
        setTimeout(() => { if (!GAME._vn) GAME.vnStart(briefId, () => {}); }, 80);
      }
    }
    return true;
  },

  // Convenience: build the quest key from faction / phase / index.
  _storyQuestKey(fac, phase, idx) { return fac + "_" + phase + "q" + idx; },

  // Grant Act 2 quest n (1–3) for the current faction, guarded by seen flags.
  _storyMaybeGrantAct2Q(n) {
    const fac = this.state.playerFaction;
    const vn  = this._vnSave();
    for (let i = 1; i < n; i++) if (!vn.seen[fac + "_a2q" + i]) return false;
    if (vn.seen[fac + "_a2q" + n]) return false;
    return this._storyGrantQuest(this._storyQuestKey(fac, "a2", n));
  },

  // Grant Act 3 quest n (1–2) for the current faction, guarded by seen flags.
  // Requires comp_beat4 to have been seen first.
  _storyMaybeGrantAct3Q(n) {
    const fac = this.state.playerFaction;
    const vn  = this._vnSave();
    if (!vn.seen[fac + "_comp_beat4"]) return false;
    for (let i = 1; i < n; i++) if (!vn.seen[fac + "_a3q" + i]) return false;
    if (vn.seen[fac + "_a3q" + n]) return false;
    return this._storyGrantQuest(this._storyQuestKey(fac, "a3", n));
  },

  // ---- soft hook from turnInQuest -----------------------------------------
  // Called for every kind:"story" quest. Advances the chain via seen flags:
  //   a2q1 done → fire comp beat2 (beat2 onClose → grant a2q2)
  //   a2q2 done → fire comp beat3 (beat3 onClose → grant a2q3)
  //   a2q3 done → fire comp beat4 (beat4 onClose → grant a3q1)
  //   a3q1 done → grant a3q2
  //   a3q2 done → _vnMaybeAct3 (the Act 3 climax)
  storyQuestTurnedIn(q) {
    const fac = this.state.playerFaction;
    const vn  = this._vnSave();
    if (!vn.seen[fac + "_a2q1"]) {
      vn.seen[fac + "_a2q1"] = true; this.saveGame();
      this._vnMaybeCompBeat(2);
    } else if (!vn.seen[fac + "_a2q2"]) {
      vn.seen[fac + "_a2q2"] = true; this.saveGame();
      this._vnMaybeCompBeat(3);
    } else if (!vn.seen[fac + "_a2q3"]) {
      vn.seen[fac + "_a2q3"] = true; this.saveGame();
      this._vnMaybeCompBeat(4);
    } else if (!vn.seen[fac + "_a3q1"]) {
      vn.seen[fac + "_a3q1"] = true; this.saveGame();
      this._storyMaybeGrantAct3Q(2);
    } else if (!vn.seen[fac + "_a3q2"]) {
      vn.seen[fac + "_a3q2"] = true; this.saveGame();
      this._vnMaybeAct3();
    }
  },

  // ---- reload safety net --------------------------------------------------
  // Called on every home-station dock. If a story quest should be in the log
  // but isn't (quit after grant, before the next save), re-grants it.
  _storyMaybePending() {
    const s  = this.state;
    if (!s.mercenary) return;
    const fac = s.playerFaction;
    const vn  = this._vnSave();
    if (!vn.seen[fac + "_act2"]) return;           // Act 2 VN must have played
    if (s.quests.some(q => q.kind === "story")) return;   // already one in log

    if      (!vn.seen[fac + "_a2q1"])                              this._storyMaybeGrantAct2Q(1);
    else if (!vn.seen[fac + "_a2q2"])                              this._storyMaybeGrantAct2Q(2);
    else if (!vn.seen[fac + "_a2q3"])                              this._storyMaybeGrantAct2Q(3);
    else if (vn.seen[fac + "_comp_beat4"] && !vn.seen[fac + "_a3q1"]) this._storyMaybeGrantAct3Q(1);
    else if (vn.seen[fac + "_a3q1"] && !vn.seen[fac + "_a3q2"])   this._storyMaybeGrantAct3Q(2);
  },
});
