/*=== HARNESS:MERC_QUESTS =====================================================*/
// Post-tutorial mercenary contract pool. Gated on tutorial completion
// (_vnSave().seen.onb_done); never offered before the onboarding ladder ends.
// Faction-agnostic: available to ALL players regardless of starting faction.
//
// Shape: 50 flavour-heavy specs (MERC_QUEST_POOL) — each paired with a named
// NPC quest-giver and a site type. When a quest is offered at a station a VN
// briefing scene is generated from the site-type lore pool and the NPC's voice;
// the same synthetic-target builder used by story_quests.js
// (_storyMakeSynthQuest) populates the real-world location so the same spec
// reads differently at every station dock.
//
// Flow:
//   openDock (ui.js) → generateStationQuests (quests.js) →
//     [this override] → _mercMaybeOffer(station) appends 3 offers to the board
//   player taps offer → VN briefing plays (merc_brief_<id>) →
//     "I'll take the job" → acceptQuest [provider slot] → kind:"merc" quest
//     "Not my problem"   → declined, no penalty
//   objective complete → normal godo/hold/collect tick (quests.js updateQuests)
//   player turns in at issuer → turnInQuest → mercQuestTurnedIn (soft hook) →
//     spec id appended to s.mercCompleted (never reoffered)
//
// Serialization:
//   s.mercCompleted   → save.js serializeGame / applySaveData
//   accepted quests   → already in s.quests, serialized by _serializeQuest
//     (mercSpecId field added to _serializeQuest in quests.js)
//
// Self-test: gated by onb_done so the existing questsSelfTest board-size
// checks (3-5 offers) are unaffected.

/* ---- NPC quest-givers -------------------------------------------------------
   Four recurring "fixers" who appear on station job boards. Each has a
   distinct voice and gravitates toward certain mission flavours.
   key   — used as portrait root in VN_ASSETS (harlan_neutral, etc.)
   name  — ALLCAPS speaker label in VN dialogue boxes
   color — name colour in the dialogue box (mirrored in VN_CAST)              */
const MERC_NPCS = {
  harlan: { key: "harlan", name: "HARLAN", color: "#c8a96e" },
  // Old salvage broker, 40 years in the belt. Gruff, precise, short sentences.
  // Knows where every wreck is and why. Favours: salvage, collect, escort.

  zera: { key: "zera", name: "ZERA", color: "#7ec8e3" },
  // Vex data broker, tracks anomalies for insurance clients. Curious, slightly
  // clinical. Frames everything as "data suggests…". Favours: blackbox, scan, sensor.

  pell: { key: "pell", name: "PELL", color: "#b48aff" },
  // Independent fixer working the Nox fringe. Knows too much about things she
  // shouldn't. Oblique, implies more than she says. Favours: bounty, sabotage, mystery.

  oryn: { key: "oryn", name: "ORYN", color: "#ff8c6e" },
  // Station security contractor, ex-Krag militia. Straight-ahead, tactical.
  // Mission-brief style: "objective is…", "threat level is…". Favours: clear, assault, rescue.
};

/* ---- Site type lore pools ---------------------------------------------------
   Defined in src/lore/site_lore.js (loaded before this file in build.py).
   10 variants per type. One is picked at random when a quest is offered and
   becomes the NPC's opening line — the "why is this place notable" before the
   actual job ask (spec.briefLine2).
   Reference: MERC_SITE_LORE is a global from site_lore.js.                  */

/* ---- 50 mercenary contract specs ------------------------------------------
   id         — stable key for the completion tracker (s.mercCompleted[]).
   action     — primary _storyMakeSynthQuest action; see QUEST_GODO + scan/defeat/collect.
   fallback   — used if the primary can't find a target in this territory.
   reward     — preset credits; overrides the territory difficulty band.
   title      — ALL-CAPS HUD label.
   npc        — one of harlan|zera|pell|oryn; drives the briefing voice/portrait.
   siteType   — one of shipwreck|outpost|heavy_body|debris_field; selects lore pool.
   briefLine2 — the actual job ask (1 line, in the NPC's voice). Shown on the
                 board as a teaser; the lore opener is picked from siteType pool.
   All 50 specs are faction-agnostic: available to all players after onb_done.  */
const MERC_QUEST_POOL = [

  /* ==== SALVAGE (5) ======================================================= */
  { id: "ms01", action: "salvage", fallback: "collect", reward: 550,
    title: "SALVAGE: VX-MIRA",
    npc: "harlan", siteType: "shipwreck",
    briefLine2: "The VX-Mira went dark two years back. Insurance settled before recovery teams mobilised — someone wanted it on their schedule. Manifest was never recovered. I want to know what's still in that hold." },

  { id: "ms02", action: "salvage", fallback: "collect", reward: 650,
    title: "SALVAGE: MINING BARGE ORE-7",
    npc: "harlan", siteType: "shipwreck",
    briefLine2: "Crew got out. Cargo didn't. Owner wants confirmation before he writes off the whole run — if the ore's still in the hold, we file for recovery. Go find out." },

  { id: "ms03", action: "salvage", fallback: "collect", reward: 700,
    title: "SALVAGE: VD-44 CONVOY",
    npc: "harlan", siteType: "shipwreck",
    briefLine2: "Two hulls made it through. The third didn't. It was running VD-77-adjacent drone hardware — same class that caused the cascade failure in Year 17. Pull what survived and don't touch the drone units." },

  { id: "ms04", action: "salvage", fallback: "collect", reward: 800,
    title: "SALVAGE: CALYX DRIFT",
    npc: "harlan", siteType: "shipwreck",
    briefLine2: "The Ardent Claim was stripped here — the frame's still there, and so is whatever they left behind when Krag pulled the crew after the Meridian Incident. Retrieve whatever is recoverable before the factions get interested." },

  { id: "ms05", action: "salvage", fallback: "collect", reward: 450,
    title: "SALVAGE: UNCLAIMED HAUL",
    npc: "harlan", siteType: "debris_field",
    briefLine2: "Recovery filing expires in forty-eight hours. First ship in takes the claim. There's Picket Field material in that corridor — Krag and Vex both lost ships there. Neither faction filed for disposal. That's you." },

  /* ==== BLACK BOX (4) ===================================================== */
  { id: "mb01", action: "blackbox", fallback: "salvage", reward: 900,
    title: "RECOVER: TK-RUNO RECORDER",
    npc: "zera", siteType: "shipwreck",
    briefLine2: "My clients want the black box before the inquiry team does. If this is Hendricks Array hardware — Vex mobile data station, Picket Field — those drives have been sitting in debris orbit since Year 11. Pull the recorder. Don't open it." },

  { id: "mb02", action: "blackbox", fallback: "salvage", reward: 1100,
    title: "RECOVER: INTERDICTION LOG",
    npc: "zera", siteType: "shipwreck",
    briefLine2: "The official filing says navigation error. My models suggest otherwise — the same anomaly pattern preceded the VX-Mira disappearance. The recorder will tell us which story is accurate. I have clients who prefer accuracy." },

  { id: "mb03", action: "blackbox", fallback: "salvage", reward: 1200,
    title: "RECOVER: HULL ORIGIN",
    npc: "zera", siteType: "shipwreck",
    briefLine2: "Hull number was ground off before she was scuttled. Flight recorder will establish who owned her. My data suggests Deep Meridian — Krag survey vessel, pulled from the Meridian Incident site before the investigation. I have clients who want to know if I'm right." },

  { id: "mb04", action: "blackbox", fallback: "salvage", reward: 850,
    title: "RECOVER: CALYX LOG",
    npc: "zera", siteType: "shipwreck",
    briefLine2: "Recovery team found the wreck but the recorder was absent — moved deliberately, data suggests, not lost in the damage. That is consistent with how the Patient Ledger's manifest disappeared. Someone is cleaning up a record. Go find what they left." },

  /* ==== RESCUE (4) ======================================================== */
  { id: "mr01", action: "rescue", fallback: "scan", reward: 1000,
    title: "RESCUE: MIRA'S HOPE",
    npc: "oryn", siteType: "shipwreck",
    briefLine2: "Beacon's been transmitting fourteen hours. Objective is live extraction — clear hostiles, make contact, get them out." },

  { id: "mr02", action: "rescue", fallback: "scan", reward: 950,
    title: "RESCUE: EJECTED CAPSULE",
    npc: "oryn", siteType: "shipwreck",
    briefLine2: "Capsule oxygen runs forty-eight hours. Clock started twenty-two hours ago. Low threat, no margin." },

  { id: "mr03", action: "rescue", fallback: "scan", reward: 1100,
    title: "RESCUE: OLD FREQUENCY",
    npc: "oryn", siteType: "shipwreck",
    briefLine2: "Beacon's transmitting on a pre-Accord frequency — same band Survey 7 used, if you know what that means. Someone who knows the old codes is still out there. Objective is live recovery. Find out who before anybody else does." },

  { id: "mr04", action: "rescue", fallback: "scan", reward: 900,
    title: "RESCUE: COVENANT SCOUT",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Last telemetry places them at an outer-reach post — Nox infrastructure, Covenant doesn't confirm what kind. They want a live recovery, no questions asked. Threat level unknown. Last contact was cold and that was thirty-six hours ago." },

  /* ==== COLLECT / CACHE (5) =============================================== */
  { id: "mc01", action: "collect", fallback: null, reward: 400,
    title: "RECOVER: ABANDONED SUPPLY",
    npc: "harlan", siteType: "debris_field",
    briefLine2: "It's been adrift three weeks. Recover it before the independent salvagers close in." },

  { id: "mc02", action: "collect", fallback: null, reward: 500,
    title: "RECOVER: PLATINUM PODS",
    npc: "harlan", siteType: "debris_field",
    briefLine2: "Crew got out, cargo didn't. First party to file a completed recovery earns the freight value." },

  { id: "mc03", action: "collect", fallback: null, reward: 450,
    title: "RECOVER: MANIFEST PACKAGE",
    npc: "zera", siteType: "debris_field",
    briefLine2: "The owner wants it back before someone with fewer obligations finds it. Sensitive manifest — don't read it." },

  { id: "mc04", action: "collect", fallback: null, reward: 350,
    title: "RECOVER: RELAY MODULE",
    npc: "zera", siteType: "debris_field",
    briefLine2: "Retrieve it and return it to me. The contents are not your concern." },

  { id: "mc05", action: "collect", fallback: null, reward: 600,
    title: "RECOVER: BURIAL PROBE",
    npc: "pell", siteType: "debris_field",
    briefLine2: "Return it to the Covenant waypoint — outer Nox infrastructure, same network as the Year 7 expansion observatories. The Pale Reckoning's last known position was near this sector. Don't let whoever's been watching that site find the probe first." },

  /* ==== SCAN / SURVEY (5) ================================================= */
  { id: "mv01", action: "scan", fallback: null, reward: 300,
    title: "INVESTIGATE: LONG BEACON",
    npc: "zera", siteType: "outpost",
    briefLine2: "Fly out, get close enough to sweep it, and report. My models need the raw data." },

  { id: "mv02", action: "scan", fallback: null, reward: 350,
    title: "SURVEY: OLD CLAIM",
    npc: "zera", siteType: "heavy_body",
    briefLine2: "Something's still transmitting on a pre-Accord claim frequency — same band as Survey 7. My models flag it as a pre-Accord filing. Confirm the source and bring me the raw sweep. My clients will know what they're looking at." },

  { id: "mv03", action: "scan", fallback: null, reward: 400,
    title: "INVESTIGATE: CORRUPTED SWEEP",
    npc: "zera", siteType: "heavy_body",
    briefLine2: "Three separate probes returned corrupted data at the same depth. My models need a crewed scan to fill the gap." },

  { id: "mv04", action: "scan", fallback: null, reward: 280,
    title: "SURVEY: OUT-OF-SCHEDULE",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Either it's malfunctioning or it's reporting something. Threat level is undefined — that's the problem. Sweep the area." },

  { id: "mv05", action: "scan", fallback: null, reward: 320,
    title: "INVESTIGATE: GHOST SIGNAL",
    npc: "pell", siteType: "outpost",
    briefLine2: "No registered origin. Someone is paying for an answer and they're not telling me why. Go get me that answer." },

  /* ==== DEFEAT (3) ======================================================== */
  { id: "md01", action: "defeat", fallback: "scan", reward: 550,
    title: "CLEAR: APPROACH TOLL",
    npc: "oryn", siteType: "outpost",
    briefLine2: "They are not authorized. Objective is removal. Three shipping operators split the fee." },

  { id: "md02", action: "defeat", fallback: "scan", reward: 700,
    title: "CLEAR: UNAUTHORIZED OCCUPANTS",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Resolve it without creating paperwork. That's the exact phrasing I was given." },

  { id: "md03", action: "defeat", fallback: "scan", reward: 600,
    title: "CLEAR: TERRITORIAL INTRUSION",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Remove them before the affected party has to file a formal complaint. After that, it gets complicated." },

  /* ==== ASSAULT (8) ======================================================= */
  { id: "ma01", action: "assault", fallback: "scan", reward: 900,
    title: "ASSAULT: MINING PLATFORM",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Objective is to clear and hold the platform for the hand-off. They stopped responding day three — expect resistance." },

  { id: "ma02", action: "assault", fallback: "scan", reward: 1000,
    title: "ASSAULT: HARROW POSITION",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Dislodge them. Hold for twelve hours after the last defender is down. Client wants confirmation on docking." },

  { id: "ma03", action: "assault", fallback: "scan", reward: 1100,
    title: "ASSAULT: UNAUTHORIZED POST",
    npc: "oryn", siteType: "outpost",
    briefLine2: "No filing, no clearance, no response to any hail. Plausible deniability was mentioned. Read it how you like." },

  { id: "ma04", action: "assault", fallback: "scan", reward: 1200,
    title: "ASSAULT: INTERNAL OVERREACH",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Outside their authorized zone. Correct this. Client wants confirmation before the next reporting cycle." },

  { id: "ma05", action: "assault", fallback: "scan", reward: 950,
    title: "ASSAULT: COVENANT TERRITORY",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Covenant considers it an administrative error. I call it a job. Threat level is entrenched — plan accordingly." },

  { id: "ma06", action: "assault", fallback: "scan", reward: 800,
    title: "ASSAULT: WAYPOINT SQUATTERS",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Covenant issued one notice. No second notice coming. Clear the platform and hold until the relief crew arrives." },

  { id: "ma07", action: "assault", fallback: "scan", reward: 850,
    title: "ASSAULT: NEUTRAL CORRIDOR",
    npc: "oryn", siteType: "outpost",
    briefLine2: "Three shipping operators pooled the fee. Clear it and hold long enough to confirm the corridor is open." },

  { id: "ma08", action: "assault", fallback: "scan", reward: 750,
    title: "ASSAULT: OLD WAR POSITION",
    npc: "pell", siteType: "outpost",
    briefLine2: "Nobody credible knows why they're there. Someone is paying to end the arrangement. I'm not asking why." },

  /* ==== BOUNTY (5) ======================================================== */
  { id: "mn01", action: "bounty", fallback: "assault", reward: 1200,
    title: "BOUNTY: PRIVATE ENFORCER",
    npc: "pell", siteType: "outpost",
    briefLine2: "Active warrant, four months outstanding. I know where they are. The client doesn't need to know I told you." },

  { id: "mn02", action: "bounty", fallback: "assault", reward: 1400,
    title: "BOUNTY: VD-77 COMMANDER",
    npc: "pell", siteType: "outpost",
    briefLine2: "Tribunal warrant, active before the current administration. Connected to the VD-77 cascade failure in Year 17 — thirty-four drones, classified report, 'autonomy drift.' DREN says the warrant predates anything he was asked to do. I believe about half of that." },

  { id: "mn03", action: "bounty", fallback: "assault", reward: 1300,
    title: "BOUNTY: OFF-RESERVATION HANDLER",
    npc: "pell", siteType: "outpost",
    briefLine2: "Bounty comes from a third party with reasons of their own. The Covenant doesn't comment on that. I do — quietly." },

  { id: "mn04", action: "bounty", fallback: "assault", reward: 1500,
    title: "BOUNTY: ROUTE COMMANDER",
    npc: "pell", siteType: "outpost",
    briefLine2: "Two separate parties posted it, each thinking they posted it exclusively. Collect once. Don't tell either of them about the other." },

  { id: "mn05", action: "bounty", fallback: "assault", reward: 1100,
    title: "BOUNTY: REREGISTERED RAIDER",
    npc: "pell", siteType: "outpost",
    briefLine2: "Operating under a new registry name since the last sweep. Open warrant under either identity. I know both." },

  /* ==== SABOTAGE (4) ====================================================== */
  { id: "mk01", action: "sabotage", fallback: "collect", reward: 700,
    title: "SABOTAGE: RIGGED GENERATOR",
    npc: "pell", siteType: "outpost",
    briefLine2: "Infiltrate, neutralize the charge, and clear out before the garrison notices. Timing matters more than force." },

  { id: "mk02", action: "sabotage", fallback: "collect", reward: 800,
    title: "SABOTAGE: OUT-OF-SPEC",
    npc: "pell", siteType: "outpost",
    briefLine2: "Plant a charge, arm it, clear the sector before the next inspection cycle. The client will know if you waited too long." },

  { id: "mk03", action: "sabotage", fallback: "collect", reward: 900,
    title: "SABOTAGE: FORTIFIED APPROACH",
    npc: "pell", siteType: "outpost",
    briefLine2: "Covenant wants the tactical advantage removed. Subtly, if the situation allows. Less subtly if it doesn't." },

  { id: "mk04", action: "sabotage", fallback: "collect", reward: 1000,
    title: "SABOTAGE: POINT DEFENSE",
    npc: "pell", siteType: "outpost",
    briefLine2: "Convoy crew doesn't know this job is happening. Keep it that way — they file incident reports." },

  /* ==== SENSOR / ANOMALY (4) ============================================== */
  { id: "mz01", action: "sensor", fallback: "scan", reward: 750,
    title: "DEPLOY: SENSOR — DARK ARRAY",
    npc: "zera", siteType: "outpost",
    briefLine2: "Hold station for the diagnostic alignment window so the output can be relayed. My clients want to know why it went dark." },

  { id: "mz02", action: "sensor", fallback: "scan", reward: 700,
    title: "DEPLOY: SENSOR — ANOMALY COVER",
    npc: "zera", siteType: "heavy_body",
    briefLine2: "Hold station until they signal completion. My data on what they're surveying is incomplete — that's intentional on their part." },

  { id: "mz03", action: "sensor", fallback: "scan", reward: 800,
    title: "DEPLOY: SENSOR — DEAD CHANNEL",
    npc: "zera", siteType: "outpost",
    briefLine2: "Hold station for the full sensor pass and relay the output. This is a Quorum-14 adjacent node — same network as the relay that went dark in Year 14. The Covenant says the content is not relevant. My data suggests otherwise, and my data has been correct about this network before." },

  { id: "mz04", action: "sensor", fallback: "scan", reward: 650,
    title: "DEPLOY: SENSOR — DATA PURCHASE",
    npc: "zera", siteType: "heavy_body",
    briefLine2: "Raw sensor data, full sweep, deliver on docking. The client isn't explaining what they're looking for. My models have a theory." },

  /* ==== ESCORT (3) ======================================================== */
  { id: "me01", action: "escort", fallback: "scan", reward: 500,
    title: "ESCORT: MINING COVER",
    npc: "oryn", siteType: "debris_field",
    briefLine2: "Operator filed a cover request after a raider contact last month. Hold station until the extraction run completes." },

  { id: "me02", action: "escort", fallback: "scan", reward: 600,
    title: "ESCORT: VEX EXTRACTION",
    npc: "oryn", siteType: "debris_field",
    briefLine2: "Site's been contested twice this quarter. Hold station until the haul is complete and the rig clears the area." },

  { id: "me03", action: "escort", fallback: "scan", reward: 550,
    title: "ESCORT: INDEPENDENT SWEEP",
    npc: "oryn", siteType: "debris_field",
    briefLine2: "They were robbed at the last one. They're paying for a deterrent. I'm not expecting a fight — but I'm not counting it out." },
];

// Sanity check: the pool must have exactly 50 entries.
if (MERC_QUEST_POOL.length !== 50) {
  console.error("MERC_QUEST_POOL has " + MERC_QUEST_POOL.length + " entries — expected 50");
}

/* ---- Pre-register VN briefing scenes for all 50 specs ---------------------
   Each scene is built now (at file load) with the first lore variant so that
   vnSelfTest can validate background, portrait, and dialogue structure. When
   a quest is actually offered, _mercBuildBriefScene() updates the dialogue
   with a randomly-chosen lore variant for that specific offer.
   Scenes are named  merc_brief_<specId>  and sit outside any act chain
   (same pattern as the onboarding briefing scenes in onboarding.js).

   Choices navigate to shared terminal scenes (merc_accept / merc_decline).
   The accept terminal carries a per-spec flag set by the choice; the UI
   calls vnStart with a callback that checks this flag to decide whether to
   call acceptQuest. The decline terminal simply closes the overlay.           */
(function () {
  // Shared terminal scenes for accept/decline choices.
  // vnSelfTest requires dialogue to be non-empty and choices' next to be valid.
  VN_SCENES["merc_accept"] = {
    id: "merc_accept", background: "bg_wreckers_anchorage", character: null,
    dialogue: [{ speaker: null, text: "You shake on it. The job is yours." }],
    choices: null, next: null, autoAdvance: null,
  };
  VN_SCENES["merc_decline"] = {
    id: "merc_decline", background: "bg_wreckers_anchorage", character: null,
    dialogue: [{ speaker: null, text: "You step away from the board." }],
    choices: null, next: null, autoAdvance: null,
  };

  for (const sp of MERC_QUEST_POOL) {
    const npc = MERC_NPCS[sp.npc];
    const lorePool = MERC_SITE_LORE[sp.siteType] || MERC_SITE_LORE.shipwreck;
    VN_SCENES["merc_brief_" + sp.id] = {
      id:         "merc_brief_" + sp.id,
      background: "bg_wreckers_anchorage",   // neutral station interior
      character:  { portrait: npc.key, expression: "neutral", position: "left" },
      dialogue: [
        { speaker: npc.name, text: lorePool[0] },      // site story (replaced on offer)
        { speaker: npc.name, text: sp.briefLine2 },    // job ask
      ],
      choices: [
        // flag lets the onComplete callback distinguish accept from decline
        { label: "I'll take the job.", next: "merc_accept",  flag: "merc_took_" + sp.id },
        { label: "Not my problem.",    next: "merc_decline" },
      ],
      next:        null,
      autoAdvance: null,
    };
  }
})();

/* ---- Patch initQuests to also clear merc state ---------------------------
   Called from main.js init() on new game and from selfTest resets.           */
(function () {
  const _orig = GAME.initQuests;
  GAME.initQuests = function (s) {
    _orig.call(this, s);
    const st = s || this.state;
    st.mercCompleted = [];   // spec IDs the player has completed (never reoffered)
  };
})();

/* ---- Patch generateStationQuests to append merc offers -------------------
   Called on every dock (ui.js openDock).
   Returns the same array as before (for the existing board-size self-test);
   merc offers are pushed onto the same stationQuests array but only when
   onb_done is true, which it never is during questsSelfTest.                 */
(function () {
  const _orig = GAME.generateStationQuests;
  GAME.generateStationQuests = function (station, state) {
    const list = _orig.call(this, station, state);
    this._mercMaybeOffer(station, state);
    return list;
  };
})();

/* ---- Patch acceptQuest: escort-cap gates for hard ranks (provider caps in quests.js) ---- */
(function () {
  const _orig = GAME.acceptQuest;
  GAME.acceptQuest = function (q) {
    if (q && q.kind === "merc") {
      const need = q.minEscortCap | 0;
      if (need > 0 && typeof this.escortCap === "function" && this.escortCap() < need) {
        if (typeof toast === "function") {
          toast("escort deck too small — need wing capacity ≥ " + need, "#ff5060", 3);
        }
        if (typeof sfx === "function") sfx("warn");
        return false;
      }
    }
    return _orig.call(this, q);
  };
})();

/* ---- Core methods -------------------------------------------------------- */
Object.assign(GAME, {

  // Populate the station board with:
  //   • 1 station-campaign rank job (next incomplete rank for THIS berth)
  //   • 1 global merc offer (side provider — lounge shows one roaming fixer)
  // Tutorial must be complete (onb_done).
  _mercMaybeOffer(st, state) {
    const s = state || this.state;
    const vn = this._vnSave();
    if (!vn || !vn.seen || !vn.seen.onb_done) return;
    s.mercCompleted = s.mercCompleted || [];
    const terr = politicalRegionAt(st.pos.x, st.pos.y);
    if (!terr) return;
    const board = s.stationQuests[st.id];
    if (!board) return;
    let offered = 0;

    // ---- 1) Station campaign (finite 10 ranks per berth) ----
    if (typeof this._stationMercNextSpec === "function") {
      const nextSp = this._stationMercNextSpec(st);
      if (nextSp) {
        const sq = this._stationMercMakeOffer(nextSp, st);
        if (sq) { board.push(sq); offered++; }
      }
    }

    // ---- 2) Global free-roam pool (one SIDE offer for the lounge) ----
    const avail = MERC_QUEST_POOL.filter(sp => !s.mercCompleted.includes(sp.id));
    for (let i = avail.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = avail[i]; avail[i] = avail[j]; avail[j] = tmp;
    }
    for (let si = 0; si < avail.length && offered < 2; si++) {
      const spec = avail[si];
      let q = null;
      for (const action of [spec.action, spec.fallback]) {
        if (!action) continue;
        q = this._storyMakeSynthQuest(action, st);
        if (q) break;
      }
      if (!q) continue;
      delete q._storyWhere;

      const lorePool = MERC_SITE_LORE[spec.siteType] || MERC_SITE_LORE.shipwreck;
      const loreVariant = lorePool[(rnd() * lorePool.length) | 0];
      this._mercBuildBriefScene(spec, MERC_NPCS[spec.npc], loreVariant);

      q.kind = "merc";
      q.status = "offer";
      q.mercSpecId = spec.id;
      q.mercNpc = spec.npc;
      q.mercBriefSceneId = "merc_brief_" + spec.id;
      q.title = spec.title;
      q.description = spec.briefLine2;
      q.reward = spec.reward;
      // Light boost scaling by territory danger for global mercs
      const d = (terr.dangerLevel || 1);
      q.boostMin = d >= 6 ? 2 : 1;
      q.boostMax = d >= 7 ? 3 : (d >= 4 ? 2 : 1);

      board.push(q);
      offered++;
    }
  },

  // Update the pre-registered VN briefing scene for a global merc spec.
  _mercBuildBriefScene(spec, npc, loreVariant) {
    const scene = VN_SCENES["merc_brief_" + spec.id];
    if (!scene || !npc) return;
    const splash = (typeof this._mercSplashFor === "function")
      ? this._mercSplashFor(spec.siteType) : "bg_wreckers_anchorage";
    scene.background = splash;
    scene.character = { portrait: npc.key, expression: "neutral", position: "left" };
    scene.dialogue = [
      { speaker: npc.name, text: loreVariant },
      { speaker: npc.name, text: spec.briefLine2 },
    ];
  },

  // Soft hook from turnInQuest when kind === "merc".
  mercQuestTurnedIn(q) {
    const s = this.state;
    s.mercCompleted = s.mercCompleted || [];
    if (q.mercSpecId && !s.mercCompleted.includes(q.mercSpecId)) {
      s.mercCompleted.push(q.mercSpecId);
    }
    // High-rank station loot / hazard bonus
    if (q.mercLootTier && typeof this._mercGrantLoot === "function") {
      this._mercGrantLoot(q.mercLootTier);
    }
    // Crown toast: finished all 10 ranks at this berth
    if (q.mercStationId != null && q.mercRank === 10) {
      const st = (typeof ForgeWorld !== "undefined" && ForgeWorld.getStations)
        ? ForgeWorld.getStations().find(x => x.id === q.mercStationId) : null;
      const name = st ? st.name : ("Station " + q.mercStationId);
      if (typeof toast === "function") toast("★ " + name.toUpperCase() + " CROWNED — all 10 ranks", "#ffd24a", 4);
      const crowns = typeof this.stationMercCrowns === "function" ? this.stationMercCrowns() : 0;
      if (crowns >= 10 && typeof toast === "function") {
        toast("◆ ALL TEN BERTHS CROWNED — the free lanes answer to you", "#9fd36a", 5);
      }
    }
    // Short completion VO if possible
    if (!HEADLESS && typeof VN_SCENES !== "undefined" && VN_SCENES.merc_complete && !this._vn) {
      const npcName = (q.mercNpc && STATION_FIXERS && Object.values(STATION_FIXERS).find(f => f.key === q.mercNpc))
        || (typeof MERC_NPCS !== "undefined" && MERC_NPCS[q.mercNpc]);
      if (npcName && VN_SCENES.merc_complete) {
        const who = npcName.name || "FIXER";
        VN_SCENES.merc_complete.dialogue = [
          { speaker: who, text: "Job's closed. Credits are yours. Come back when you want harder work." },
        ];
      }
      // non-blocking: skip auto VN to avoid stacking on turn-in UI; toast is enough
    }
    this.saveGame();
  },

  // ---- minimal self-test (does not run inside questsSelfTest to keep board-
  //      size assertions clean; invoked separately when desired)              */
  mercQuestsSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      // 1. Pool has exactly 50 unique ids.
      check(MERC_QUEST_POOL.length === 50, "pool must have 50 specs, has " + MERC_QUEST_POOL.length);
      const ids = new Set(MERC_QUEST_POOL.map(s => s.id));
      check(ids.size === 50, "pool ids must all be unique, found " + ids.size + " distinct");

      // 2. Every spec has the required fields.
      for (const sp of MERC_QUEST_POOL) {
        check(typeof sp.id === "string" && sp.id.length > 0,
          "spec " + sp.id + " missing id");
        check(typeof sp.title === "string" && sp.title.length > 0,
          "spec " + sp.id + " missing title");
        check(typeof sp.reward === "number" && sp.reward > 0,
          "spec " + sp.id + " invalid reward");
        check(typeof sp.npc === "string" && !!MERC_NPCS[sp.npc],
          "spec " + sp.id + " invalid npc: " + sp.npc);
        check(typeof sp.siteType === "string" && !!(MERC_SITE_LORE[sp.siteType]),
          "spec " + sp.id + " invalid siteType: " + sp.siteType);
        check(typeof sp.briefLine2 === "string" && sp.briefLine2.length > 10,
          "spec " + sp.id + " briefLine2 missing or too short");
        // briefing scene must be pre-registered in VN_SCENES
        check(!!VN_SCENES["merc_brief_" + sp.id],
          "spec " + sp.id + " missing pre-registered brief scene");
      }

      // 3. _mercMaybeOffer populates the board when tutorial is complete.
      this.init();
      const s = this.state;
      this._vnSave().seen.onb_done = true;
      s.mercCompleted = [];
      const sts = ForgeWorld.getStations();
      // Generate a board normally first, then trigger merc offers.
      const list = this.generateStationQuests(sts[0], s);
      const mercOffers = (s.stationQuests[sts[0].id] || []).filter(q => q.kind === "merc");
      check(mercOffers.length > 0, "merc offers must appear when tutorial is complete (onb_done)");
      check(mercOffers.length <= 2, "at most 2 merc offers per dock (station+side), got " + mercOffers.length);
      for (const q of mercOffers) {
        check(q.status === "offer", "merc offer must have status 'offer'");
        check(typeof q.mercSpecId === "string", "merc offer must carry mercSpecId");
        const known = ids.has(q.mercSpecId)
          || (typeof STATION_MERC_POOL !== "undefined"
              && STATION_MERC_POOL.some(sp => sp.id === q.mercSpecId));
        check(known, "mercSpecId must be a known pool id");
        check(typeof q.title === "string" && q.title.length > 0, "merc offer missing title");
        check(typeof q.description === "string" && q.description.length > 0, "merc offer missing description");
        check(q.reward > 0, "merc offer reward must be positive");
        const npcOk = typeof q.mercNpc === "string" && (
          !!MERC_NPCS[q.mercNpc]
          || (typeof STATION_FIXERS !== "undefined"
              && Object.values(STATION_FIXERS).some(f => f.key === q.mercNpc))
        );
        check(npcOk, "merc offer must carry valid mercNpc");
        check(typeof q.mercBriefSceneId === "string" && !!VN_SCENES[q.mercBriefSceneId],
          "merc offer must carry a valid mercBriefSceneId");
      }

      // 4. Accepting a merc offer moves it into s.quests with kind "merc".
      const offer = mercOffers[0];
      check(this.acceptQuest(offer), "merc offer accept must succeed");
      check(s.quests.some(q => q.kind === "merc"), "accepted merc quest must be in s.quests");
      check(!(s.stationQuests[sts[0].id] || []).includes(offer), "accepted offer must leave the board");

      // 5. Provider caps: at most one STATION merc + one SIDE merc held.
      this.generateStationQuests(sts[0], s);
      const offers2 = (s.stationQuests[sts[0].id] || []).filter(q => q.kind === "merc");
      for (const o of offers2) this.acceptQuest(o);   // duplicate provider refused
      const stationHeld = s.quests.filter(q => q.kind === "merc" && q.mercStationId != null).length;
      const sideHeld = s.quests.filter(q => q.kind === "merc" && q.mercStationId == null).length;
      check(stationHeld <= 1, "at most 1 station merc held, found " + stationHeld);
      check(sideHeld <= 1, "at most 1 side merc held, found " + sideHeld);
      // second side offer must be refused while side slot full
      const sideMore = (s.stationQuests[sts[0].id] || []).filter(q => q.kind === "merc" && q.mercStationId == null);
      // re-offer side
      this.generateStationQuests(sts[1 % sts.length], s);
      const sideOffer = (s.stationQuests[sts[1 % sts.length].id] || [])
        .find(q => q.kind === "merc" && q.mercStationId == null);
      if (sideHeld >= 1 && sideOffer) {
        check(!this.acceptQuest(sideOffer), "second side merc must be refused while slot full");
      }

      // 6. mercQuestTurnedIn adds specId to s.mercCompleted.
      const held = s.quests.find(q => q.kind === "merc");
      if (held) {
        const specId = held.mercSpecId;
        // mark objective complete manually for the turn-in test
        held.collected = true; held.holdT = (held.holdDur || 0) + 1; held.scanT = 10;
        // complete the objective by forcing status to ready
        held.status = "ready";
        s.docked = true; s.dockStationId = held.stationId;
        const cr0 = s.credits;
        const ok = this.turnInQuest(held);
        check(ok, "merc quest turn-in must succeed when docked at the issuer");
        check(s.credits === cr0 + held.reward, "merc quest reward must be credited on turn-in");
        check(s.mercCompleted.includes(specId), "turned-in spec must appear in s.mercCompleted");
        s.docked = false;
      }

      // 7. Completed global specs are not reoffered (station ranks use different ids).
      s.mercCompleted = MERC_QUEST_POOL.map(sp => sp.id);   // mark free-roam pool done
      this.generateStationQuests(sts[0], s);
      const sideLeft = (s.stationQuests[sts[0].id] || [])
        .filter(q => q.kind === "merc" && q.mercStationId == null);
      check(sideLeft.length === 0, "no SIDE merc offers when global pool is completed");

      // 8. _serializeQuest round-trips mercSpecId.
      this.init();
      const s2 = this.state;
      this._vnSave().seen.onb_done = true;
      s2.mercCompleted = [];
      this.generateStationQuests(sts[0], s2);
      const mo = (s2.stationQuests[sts[0].id] || []).find(q => q.kind === "merc");
      if (mo) {
        this.acceptQuest(mo);
        const held2 = s2.quests.find(q => q.kind === "merc");
        if (held2) {
          const blob = this._serializeQuest(held2);
          check(blob.kind === "merc", "serialized quest must keep kind 'merc'");
          check(blob.mercSpecId === held2.mercSpecId, "serialized quest must keep mercSpecId");
        }
      }

      this.init();   // clean up world state
    } catch (e) {
      fails.push("FAIL: mercQuestsSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
