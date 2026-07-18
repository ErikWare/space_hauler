/*=== HARNESS:PHASE7 =========================================================*/
// Phase 7 — cross-phase invariants. Each earlier layer proves itself in its
// own selfTest; this suite proves the JOINS between them: every territory is
// fully provisioned (station + sites + quest board + objective state), one
// save blob carries the whole feature stack at once, quest targets never
// escape their issuer's territory, and the boot flow neither autoloads a
// slot nor lets the sim run under the title screen.
Object.assign(GAME, {
  phase7SelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      let s = this.state;
      const stations = ForgeWorld.getStations();

      // 1. every territory is fully provisioned: exactly one station (10
      // distinct over 10 territories), ≥1 site, a stocked quest board at its
      // station, and initialized objective state + panel model.
      const claimed = new Set();
      for (const t of REGIONS) {
        const st = stationOfTerritory(t.name);
        check(!!st, t.name + " has no station");
        if (st) { check(!claimed.has(st.id), "station " + st.id + " serves two territories"); claimed.add(st.id); }
        const own = ownablesOfTerritory(t.name);
        check(own.some(e => e.type === "site"), t.name + " holds no sites");
        check(own.some(e => e.type === "outpost"), t.name + " holds no outposts");
        if (st) {
          const board = this.generateStationQuests(st, s);
          check(board.length >= QUESTS.perStationMin, t.name + " board under min (" + board.length + ")");
          check(board.every(q => q.status === "offer"), t.name + " board must hold offers only");
        }
        const e = this.territoryObjectiveState(t.id);
        check(!!e && typeof e.pirateKills === "number" && typeof e.battles === "number" && !!e.claimed,
          t.name + " objective state not initialized");
        const model = this.territoryPanelModel(t.id);
        check(!!model && model.rows.length === 6 && model.station !== "—", t.name + " panel model incomplete");
      }
      check(claimed.size === REGIONS.length, "territories must own " + REGIONS.length + " distinct stations, got " + claimed.size);

      // 2. no orphaned quest targets: on every station's board, each quest's
      // territory is the issuer's, every target region sits inside that
      // territory, and every referenced entity resolves to a live record.
      for (const st of stations) {
        const terr = politicalRegionAt(st.pos.x, st.pos.y);
        const rids = new Set(regionsOfTerritory(terr.name));
        for (const q of this.generateStationQuests(st, s)) {
          check(q.territory === terr.name, q.title + " issued by " + st.name + " carries territory '" + q.territory + "'");
          const targets = q.kind === "chain" ? q.tiers.map(x => x.regionId) : [q.regionId];
          for (const rid of targets)
            check(rids.has(rid), st.name + " quest '" + q.title + "' targets R-" + rid + " outside " + terr.name);
          if (q.siteId) {
            const site = this.siteById(q.siteId);
            check(!!site && site.regionId === q.regionId, q.title + " points at a missing/mismatched site");
          }
          if (q.kind === "chain") for (const tr of q.tiers) {
            const ent = tr.type === "site" ? this.siteById(tr.refId) : this.outpostById(tr.refId);
            check(!!ent && ent.regionId === tr.regionId, q.title + " tier entity missing at R-" + tr.regionId);
          }
        }
      }

      // 3. ONE save blob carries the whole stack: faction pick, held quests
      // (incl. chain tier progress + active tracking), objective counters +
      // milestone flags, and site discovery/garrison fates — all at once.
      s.playerFaction = "vex";
      let chain = null, godo = null;
      for (let tries = 0; tries < 60 && !(chain && godo); tries++)
        for (const q of this.generateStationQuests(stations[tries % stations.length], s)) {
          if (q.kind === "chain" && !chain) chain = q;
          if (q.kind === "godo" && !godo) godo = q;
        }
      check(!!(chain && godo), "could not source a chain + a godo quest");
      if (chain && godo) {
        this.acceptQuest(godo); this.acceptQuest(chain);
        chain.tiers[0].done = true;               // mid-chain progress rides the save
        this.setActiveQuest(chain.id);
      }
      const tOut = REGIONS.find(t => this.territoryOutpostStats(t.name).total >= 5);
      check(!!tOut, "no territory holds ≥5 outposts");
      if (tOut) {
        const ops = ownablesOfTerritory(tOut.name).filter(x => x.type === "outpost");
        for (let i = 0; i < 5; i++) ops[i].entity.owner = "player";
        this.checkTerritoryMilestones();          // claims outpost5 (flag must persist)
      }
      const eObj = this.territoryObjectiveState(REGIONS[0].id);
      eObj.pirateKills = 17; eObj.battles = 4;
      const siteA = s.sites[0], siteB = s.sites[1];
      siteA.discovered = true;
      siteB.discovered = true;
      siteB.guardRecs[0].alive = false; siteB.guardRecs[0].frac = 0;
      const keep = { siteA: siteA.id, siteB: siteB.id, chainId: chain && chain.id,
        godoId: godo && godo.id, tOut: tOut && tOut.id };
      const blob = JSON.parse(JSON.stringify(this.serializeGame()));

      this.init(); s = this.state;                // fresh world — everything above is gone
      check(s.playerFaction === null && s.quests.length === 0 && s.activeQuestId === null,
        "fresh init must not retain the run");
      check(this.applySaveData(blob) === true, "applySaveData rejected the full-stack blob");
      check(s.playerFaction === "vex", "playerFaction lost in the round-trip");
      if (chain && godo) {
        const rc = s.quests.find(q => q.id === keep.chainId), rg = s.quests.find(q => q.id === keep.godoId);
        check(!!rc && !!rg && s.quests.length === 2, "held quests lost in the round-trip");
        check(s.activeQuestId === keep.chainId, "activeQuestId lost in the round-trip");
        if (rc) {
          check(rc.kind === "chain" && rc.tiers.length === QUESTS.chainTiers, "chain shape lost");
          check(rc.tiers[0].done === true && !rc.tiers[1].done && !rc.tiers[2].done, "chain tier progress lost");
          check(rc.territory === chain.territory && rc.stationId === chain.stationId, "chain issuer lost");
        }
      }
      if (tOut) {
        check(this.territoryObjectiveState(keep.tOut).claimed.outpost5 === true, "milestone flag lost in the round-trip");
        const cr = s.credits;
        this.checkTerritoryMilestones();
        check(s.credits === cr, "restored milestone must not re-grant");
      }
      const rObj = this.territoryObjectiveState(REGIONS[0].id);
      check(rObj.pirateKills === 17 && rObj.battles === 4, "objective counters lost in the round-trip");
      const rA = this.siteById(keep.siteA), rB = this.siteById(keep.siteB);
      check(!!rA && rA.discovered === true, "site discovery lost in the round-trip");
      check(!!rB && rB.discovered === true && rB.guardRecs[0].alive === false && rB.guardRecs[0].frac === 0,
        "site garrison fate lost in the round-trip");
      check(s.sites.some(t => !t.discovered), "undiscovered sites must stay undiscovered");

      // 4. boot flow: init() never pulls a slot (a stocked store stays
      // untouched), and the sim idles while the title screen is up. The DOM
      // side (titleOpen=true on a real cold boot) is browser-verified.
      const mk = () => { const m = new Map(); return {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k) }; };
      this._storeOverride = mk();
      const bait = JSON.parse(JSON.stringify(blob)); bait.credits = 999999;
      check(this.writeSlot(1, bait), "writeSlot must land in the mock store");
      this.init(); s = this.state;
      check(s.credits !== 999999 && s.playerFaction === null, "init must NEVER autoload a save slot");
      check(this.slotUsed(1), "the stocked slot must survive a boot untouched");
      delete this._storeOverride;
      s.titleOpen = true;
      const t0 = s.t, tp0 = s.timePlayed;
      for (let i = 0; i < 5; i++) this.update(1 / 60);
      check(s.t === t0 && s.timePlayed === tp0, "the sim must idle while the title screen is up");
      s.titleOpen = false;
      this.update(1 / 60);
      check(s.t > t0, "the sim must resume once the title screen closes");

      this.init();   // leave a clean world behind
    } catch (e) {
      fails.push("FAIL: phase7SelfTest threw: " + (e && e.message));
      delete this._storeOverride;
    }
    return fails;
  },
});
