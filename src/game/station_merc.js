/*=== HARNESS:STATION_MERC ===================================================*/
// Per-station mercenary campaign: 10 ranks × 10 stations = 100 finite jobs.
// Each station has a unique fixer. Ranks unlock in order at that station.
// Difficulty scales with (station territory danger + rank). Late ranks demand
// carrier escort caps and pay elite loot — the tank-boat + drone fantasy.
//
// Complements the global MERC_QUEST_POOL (50 free-roam jobs). Board mix:
//   1 next station-rank job (if available)
//   up to 2 global merc offers
//
// Spec id form: st{stationId}_r{rank}  e.g. st0_r7

const STATION_FIXERS = {
  0: { key: "fixer_brek", name: "BREK",  color: "#c8a96e", title: "Dock Foreman",
    voice: "gruff", blurb: "Mira's berth boss — wastes nothing, least of all words." },
  1: { key: "fixer_june", name: "JUNE",  color: "#e07a4a", title: "Ash Broker",
    voice: "dry", blurb: "Vesper/Cinder ash-trade fixer. Counts slag like coin." },
  2: { key: "fixer_sol",  name: "SOL",   color: "#ff8c4a", title: "Cinder Runner",
    voice: "hot", blurb: "Runs heat and ore through Cinder's furnaces." },
  3: { key: "fixer_kith", name: "KITH",  color: "#ff6a5e", title: "Gate Clerk",
    voice: "formal", blurb: "Arix approach clerk who 'loses' paperwork for a fee." },
  4: { key: "fixer_yara", name: "YARA",  color: "#8fd0ff", title: "Ice Warden",
    voice: "cool", blurb: "Dusk ice-lane warden. Soft voice, hard contracts." },
  5: { key: "fixer_toll", name: "TOLL",  color: "#d8884a", title: "Claim Agent",
    voice: "sharp", blurb: "Sorn claim-jumper turned legitimate. Mostly." },
  6: { key: "fixer_niv",  name: "NIV",   color: "#b48aff", title: "Tithe Broker",
    voice: "soft", blurb: "Halveth tithe-ship broker. Never says the whole price." },
  7: { key: "fixer_qen",  name: "QEN",   color: "#9a86c4", title: "Vault Liaison",
    voice: "cold", blurb: "Nox Prime vault liaison. Patience as a weapon." },
  8: { key: "fixer_gash", name: "GASH",  color: "#9fd36a", title: "Scrap Broker",
    voice: "merc", blurb: "Wrecker's Anchorage scrap king. Free agent, free fire." },
  9: { key: "fixer_sil",  name: "SIL",   color: "#c9a8ff", title: "Shrine Keeper",
    voice: "quiet", blurb: "Pale March shrine-keeper. Contracts that feel like rites." },
};

// Rank ladder: action escalates; late ranks require carrier decks + pay loot.
// minEscortCap gates accept (escortCap from hull.escortSlots).
// boostMin/Max inflate quest-layer defenders on approach.
// minEscort matches rebalanced hull wing sizes:
//   R5–6 ≥2 (Atlas+ / Warbarge / Saber / Veil+)
//   R7–8 ≥3 (Warbarge / Saber / Veil+)
//   R9   ≥4 (Aegis / Dread / Executor / Umbra+)
//   R10  ≥6 (Eclipse only — crown)
const STATION_RANK_LADDER = [
  { rank: 1,  action: "scan",     fallback: "collect",  boost: [1, 1], minEscort: 0, rewardK: 1.0,  loot: null,
    tag: "SWEEP",   ask: "Fly the approach, hold a clean scan, and report back." },
  { rank: 2,  action: "collect",  fallback: "scan",     boost: [1, 1], minEscort: 0, rewardK: 1.1,  loot: null,
    tag: "CACHE",   ask: "A package went adrift in our wedge. Recover it before freelancers do." },
  { rank: 3,  action: "salvage",  fallback: "collect",  boost: [1, 2], minEscort: 0, rewardK: 1.2,  loot: null,
    tag: "SALVAGE", ask: "There's recoverable cargo on a wreck under our watch. Pull it home." },
  { rank: 4,  action: "escort",   fallback: "scan",     boost: [1, 2], minEscort: 1, rewardK: 1.35, loot: null,
    tag: "COVER",   ask: "Hold cover on a working site until the run finishes. Expect company." },
  { rank: 5,  action: "blackbox", fallback: "salvage",  boost: [2, 2], minEscort: 2, rewardK: 1.5,  loot: "rare",
    tag: "RECORDER", ask: "Pull the flight recorder. Clear scavengers first. Do not open it. [wing ≥ 2]" },
  { rank: 6,  action: "rescue",   fallback: "scan",     boost: [2, 3], minEscort: 2, rewardK: 1.7,  loot: "rare",
    tag: "EXTRACT", ask: "Live beacon. Clear hostiles, hold for extract. [wing ≥ 2]" },
  { rank: 7,  action: "bounty",   fallback: "assault",  boost: [2, 3], minEscort: 3, rewardK: 2.0,  loot: "unique",
    tag: "HUNT",    ask: "Garrison commander bounty. Bring a real wing. [wing ≥ 3]" },
  { rank: 8,  action: "assault",  fallback: "sabotage", boost: [3, 4], minEscort: 3, rewardK: 2.4,  loot: "unique",
    tag: "BREACH",  ask: "Hard target. Clear defenders, hold the platform. [wing ≥ 3]" },
  { rank: 9,  action: "assault",  fallback: "bounty",   boost: [4, 5], minEscort: 4, rewardK: 3.0,  loot: "elite",
    tag: "SIEGE",   ask: "Fortified siege. Aegis / Dread / Executor / Umbra class. [wing ≥ 4]" },
  { rank: 10, action: "assault",  fallback: "assault",  boost: [5, 6], minEscort: 6, rewardK: 4.0,  loot: "elite",
    tag: "CROWN",   ask: "Station crown. Only a full six-drone deck clears this. [wing ≥ 6 · Eclipse]" },
];

// Base reward by territory danger (1–9). Rank multiplies via rewardK.
const STATION_MERC_BASE_REWARD = {
  1: 280, 2: 360, 3: 480, 4: 650, 5: 900, 6: 1200, 7: 1600, 8: 2200, 9: 3000,
};

// Build the 100-spec pool once at load.
const STATION_MERC_POOL = [];
(function buildStationMercPool() {
  for (let sid = 0; sid < 10; sid++) {
    const fixer = STATION_FIXERS[sid];
    if (!fixer) continue;
    for (const step of STATION_RANK_LADDER) {
      const id = "st" + sid + "_r" + step.rank;
      STATION_MERC_POOL.push({
        id, stationId: sid, rank: step.rank,
        action: step.action, fallback: step.fallback,
        minEscortCap: step.minEscort,
        boostMin: step.boost[0], boostMax: step.boost[1],
        rewardK: step.rewardK, lootTier: step.loot,
        npc: fixer.key, npcName: fixer.name, npcColor: fixer.color,
        tag: step.tag, ask: step.ask,
        siteType: step.rank <= 3 ? "debris_field"
          : step.rank <= 5 ? "shipwreck"
          : step.rank <= 6 ? "shipwreck"
          : "outpost",
        title: "STATION " + sid + " · R" + step.rank + ": " + step.tag,
        // title refined at offer time with live station name
      });
    }
  }
})();

// Register VN brief scenes for station mercs + cast colours.
(function registerStationMercVN() {
  if (typeof VN_SCENES === "undefined") return;
  // Cast colours
  if (typeof VN_CAST !== "undefined") {
    for (const sid of Object.keys(STATION_FIXERS)) {
      const f = STATION_FIXERS[sid];
      VN_CAST[f.name] = f.color;
    }
  }
  // Portraits: prefer generated sprites/intro/<key>.png; else fall back to
  // commander with the fixer's edge colour (no wrong faction-leader face).
  if (typeof VN_ASSETS !== "undefined") {
    for (const sid of Object.keys(STATION_FIXERS)) {
      const f = STATION_FIXERS[sid];
      const key = f.key + "_neutral";
      if (!VN_ASSETS[key]) {
        VN_ASSETS[key] = {
          src: "sprites/intro/" + f.key + ".png",
          edge: f.color,
        };
        // If the PNG is missing at runtime the browser shows empty; generate
        // via storyline/prompts/gen_station_fixers.py. Soft alias:
        VN_ASSETS[f.key] = VN_ASSETS[key];
      }
    }
  }
  if (!VN_SCENES.merc_accept) {
    VN_SCENES.merc_accept = {
      id: "merc_accept", background: "bg_wreckers_anchorage", character: null,
      dialogue: [{ speaker: null, text: "You shake on it. The job is yours." }],
      choices: null, next: null, autoAdvance: null,
    };
  }
  if (!VN_SCENES.merc_decline) {
    VN_SCENES.merc_decline = {
      id: "merc_decline", background: "bg_wreckers_anchorage", character: null,
      dialogue: [{ speaker: null, text: "You step away from the board." }],
      choices: null, next: null, autoAdvance: null,
    };
  }
  if (!VN_SCENES.merc_complete) {
    VN_SCENES.merc_complete = {
      id: "merc_complete", background: "onboard_dock_crowd", character: null,
      dialogue: [{ speaker: null, text: "Contract closed. Credits land. The board forgets you until the next job." }],
      choices: null, next: null, autoAdvance: 3500,
    };
  }
  for (const sp of STATION_MERC_POOL) {
    const f = STATION_FIXERS[sp.stationId];
    VN_SCENES["merc_brief_" + sp.id] = {
      id: "merc_brief_" + sp.id,
      background: "onboard_dock_crowd",
      character: { portrait: f.key, expression: "neutral", position: "left" },
      dialogue: [
        { speaker: f.name, text: f.blurb },
        { speaker: f.name, text: sp.ask },
      ],
      choices: [
        { label: "I'll take the job.", next: "merc_accept", flag: "merc_took_" + sp.id },
        { label: "Not yet.", next: "merc_decline" },
      ],
      next: null, autoAdvance: null,
    };
  }
})();

Object.assign(GAME, {
  // Danger 1–9 at a station berth (territory security).
  _stationDanger(st) {
    if (!st || !st.pos) return 1;
    const r = politicalRegionAt(st.pos.x, st.pos.y);
    return (r && r.dangerLevel) || 1;
  },

  // Highest completed rank at a station (0 if none).
  _stationMercRankDone(stationId) {
    const s = this.state;
    const done = s.mercCompleted || [];
    let max = 0;
    for (let r = 1; r <= 10; r++) {
      if (done.includes("st" + stationId + "_r" + r)) max = r;
      else break; // sequential unlock
    }
    return max;
  },

  _stationMercSpec(stationId, rank) {
    return STATION_MERC_POOL.find(sp => sp.stationId === stationId && sp.rank === rank) || null;
  },

  // Next rank offer for this station (rank done+1), or null if campaign complete.
  _stationMercNextSpec(st) {
    if (!st) return null;
    const sid = st.id | 0;
    if (!STATION_FIXERS[sid]) return null;
    const next = this._stationMercRankDone(sid) + 1;
    if (next > 10) return null;
    return this._stationMercSpec(sid, next);
  },

  // Build a board offer from a station-merc spec.
  _stationMercMakeOffer(spec, st) {
    if (!spec || !st) return null;
    let q = null;
    for (const action of [spec.action, spec.fallback]) {
      if (!action) continue;
      q = this._storyMakeSynthQuest(action, st);
      if (q) break;
    }
    if (!q) return null;
    delete q._storyWhere;

    const danger = this._stationDanger(st);
    const base = STATION_MERC_BASE_REWARD[danger] || STATION_MERC_BASE_REWARD[5];
    const reward = Math.round(base * (spec.rewardK || 1) / 5) * 5;
    const f = STATION_FIXERS[spec.stationId];
    const stName = (st.name || ("Station " + spec.stationId)).toUpperCase();

    q.kind = "merc";
    q.status = "offer";
    q.mercSpecId = spec.id;
    q.mercNpc = f.key;
    q.mercStationId = spec.stationId;
    q.mercRank = spec.rank;
    q.mercBriefSceneId = "merc_brief_" + spec.id;
    q.mercLootTier = spec.lootTier;
    q.minEscortCap = spec.minEscortCap || 0;
    q.boostMin = spec.boostMin;
    q.boostMax = spec.boostMax;
    q.title = stName + " · R" + spec.rank + ": " + spec.tag;
    q.description = spec.ask +
      (spec.minEscortCap
        ? ` [requires escort wing ≥ ${spec.minEscortCap}]`
        : "");
    q.reward = reward;
    q.difficulty = Math.min(3, 1 + ((danger / 3) | 0));

    // Refresh brief dialogue with live danger flavour
    const sc = VN_SCENES["merc_brief_" + spec.id];
    if (sc && f) {
      const hard = spec.rank >= 8
        ? " Security here runs hot. Bring a real deck — drones win the fight; you hold the line."
        : spec.rank >= 5
          ? " This wedge bites. Fly ready."
          : "";
      sc.background = this._mercSplashFor(spec.siteType || "outpost");
      sc.character = { portrait: f.key, expression: "neutral", position: "left" };
      sc.dialogue = [
        { speaker: f.name, text: f.blurb + " This is rank " + spec.rank + " of ten for this berth." },
        { speaker: f.name, text: spec.ask + hard },
      ];
    }
    return q;
  },

  // Map site type → mission splash plate for merc VN.
  _mercSplashFor(siteType) {
    const m = {
      shipwreck: "onboard_debris",
      debris_field: "onboard_debris",
      outpost: "onboard_outpost",
      heavy_body: "onboard_ore_rich",
      asteroid_cluster: "onboard_ore_ring",
    };
    return m[siteType] || "onboard_dock_crowd";
  },

  // Elite loot roll for high-rank station merc turn-ins.
  _mercGrantLoot(tier) {
    if (!tier || HEADLESS) return;
    const s = this.state;
    if (!s.inventory) s.inventory = [];
    // Prefer ForgeItemSystem if present; else credit bonus.
    try {
      if (typeof ForgeItemSystem !== "undefined" && ForgeItemSystem.roll) {
        const item = ForgeItemSystem.roll({ tier: tier === "elite" ? "elite" : tier === "unique" ? "unique" : "rare" });
        if (item) {
          s.inventory.push(item);
          if (typeof toast === "function") toast("loot secured: " + (item.name || tier), "#ffd24a");
          return;
        }
      }
    } catch (e) { /* soft */ }
    const bonus = tier === "elite" ? 2500 : tier === "unique" ? 1200 : 500;
    s.credits = (s.credits || 0) + bonus;
    if (typeof toast === "function") toast("hazard bonus +" + bonus + "cr", "#ffd24a");
  },

  // Progress: stations fully cleared (all 10 ranks).
  stationMercCrowns() {
    const s = this.state, done = s.mercCompleted || [];
    let n = 0;
    for (let sid = 0; sid < 10; sid++) {
      if (done.includes("st" + sid + "_r10")) n++;
    }
    return n;
  },


  stationMercSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      check(STATION_MERC_POOL.length === 100, "pool size " + STATION_MERC_POOL.length);
      const ids = new Set(STATION_MERC_POOL.map(sp => sp.id));
      check(ids.size === 100, "unique pool ids");
      for (let sid = 0; sid < 10; sid++)
        for (let r = 1; r <= 10; r++)
          check(ids.has("st" + sid + "_r" + r), "missing st" + sid + "_r" + r);
      check(Object.keys(STATION_FIXERS).length === 10, "10 fixers");

      this.init();
      const s = this.state;
      this._vnSave().seen.onb_done = true;
      s.mercCompleted = [];
      const sts = ForgeWorld.getStations();

      this.generateStationQuests(sts[0], s);
      let stOffers = (s.stationQuests[sts[0].id] || []).filter(q => q.kind === "merc" && q.mercStationId != null);
      check(stOffers.length === 1, "one station offer got " + stOffers.length);
      check(stOffers[0] && stOffers[0].mercRank === 1, "first rank is 1");

      s.mercCompleted.push(stOffers[0].mercSpecId);
      this.generateStationQuests(sts[0], s);
      stOffers = (s.stationQuests[sts[0].id] || []).filter(q => q.kind === "merc" && q.mercStationId != null);
      check(stOffers[0] && stOffers[0].mercRank === 2, "rank 2 after complete r1");

      // Escort refuse R7
      s.mercCompleted = [];
      for (let r = 1; r < 7; r++) s.mercCompleted.push("st" + sts[0].id + "_r" + r);
      check(this.escortCap() === 1, "starter wing 1");
      this.generateStationQuests(sts[0], s);
      const r7 = (s.stationQuests[sts[0].id] || []).find(q => q.kind === "merc" && q.mercRank === 7);
      check(!!r7, "r7 offered");
      if (r7) check(!this.acceptQuest(r7), "r7 refused on wing 1");

      // Free Warbarge for wing 3
      const hull = CONFIG.hulls.krag_warbarge;
      const nSlots = this.hullEquipSlots ? this.hullEquipSlots(hull) : 4;
      s.ships.push({ id: 99, hullKey: "krag_warbarge", name: hull.name, slots: new Array(nSlots).fill(null) });
      s.activeShipId = 99;
      ForgeEquipment.initEquipment(nSlots);
      this.recomputeDerived();
      if (this.enforceEscortCap) this.enforceEscortCap(s);
      check(this.escortCap() >= 3, "warbarge wing " + this.escortCap());
      this.generateStationQuests(sts[0], s);
      const r7b = (s.stationQuests[sts[0].id] || []).find(q => q.kind === "merc" && q.mercRank === 7);
      if (r7b) {
        check(this.acceptQuest(r7b), "r7 accept wing 3");
        this.setActiveQuest(r7b.id);
        const anchors = this._questBoostAnchors(r7b);
        if (anchors.length) {
          s.x = anchors[0].x + 80; s.y = anchors[0].y;
          this.updateQuests(1 / 60);
          const recs = r7b.boosts[anchors[0].regionId];
          check(!!recs && recs.length >= (r7b.boostMin || 1), "merc boost on approach");
          check(r7b._beats && r7b._beats.approached, "approach beat fired");
        }
        this.abandonQuest(r7b);
      }

      s.mercCompleted = [];
      for (let sid = 0; sid < 10; sid++) s.mercCompleted.push("st" + sid + "_r10");
      check(this.stationMercCrowns() === 10, "10 crowns");
      this.init();
    } catch (e) {
      fails.push("FAIL: stationMercSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
