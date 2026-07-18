/*=== HARNESS:SAVE ===========================================================*/
// Persistence — THREE JSON slots in localStorage["space_hauler_save_1..3"] plus
// a card-metadata index ["space_hauler_saves_meta"] the title screen reads
// without parsing full blobs. The world itself regenerates deterministically
// (setSeed(42) in init), so a save only carries what the PLAYER changed: purse,
// ships + per-ship loadouts, cargo (ore + refined bars), inventory, companion
// fleet, outpost ownership/fortify state, the political map, charted space,
// the chosen faction, and the unlock-stat counters.
// serializeGame()/applySaveData() are pure data (headless-testable); the slot
// plumbing goes through _saveStore() (localStorage, or an injected mock in the
// selfTest) and fails soft everywhere (private browsing → console.warn, the
// game plays on without persistence). The pre-slot single save
// ["space_hauler_save"] auto-migrates to slot 1 on boot (migrateLegacySave).
const SAVE_SLOTS = 3;
const SAVE_KEY_LEGACY = "space_hauler_save";           // pre-slot single-save key
const SAVE_META_KEY = "space_hauler_saves_meta";
const saveSlotKey = n => "space_hauler_save_" + n;

Object.assign(GAME, {
  // Snapshot the run as a plain JSON-safe object. Returns live references —
  // stringify before storing (saveGame does; the selfTest round-trips through
  // JSON.parse(JSON.stringify(...)) for the same isolation).
  serializeGame() {
    const s = this.state, stations = ForgeWorld.getStations();
    const controllers = {};
    for (const r of REGIONS) controllers[r.id] = r.controller;
    return {
      v: 1, savedAt: (typeof Date !== "undefined" && Date.now) ? Date.now() : 0,
      // ---- player ----
      credits: s.credits,
      playerFaction: s.playerFaction || null,   // chosen at the title screen's faction pick (game/title.js)
      ships: s.ships, activeShipId: s.activeShipId,   // hull ownership + per-ship 6-slot loadouts (covers ship/equipped)
      inventory: s.inventory,
      ore: s.ore, refinedBars: s.refinedBars,          // the cargo hold
      fleet: s.playerFleet,
      factionKills: s.factionKills,
      // ---- world ----
      outposts: s.outposts.map(o => ({ id: o.id, owner: o.owner, faction: o.faction,
        discovered: !!o.discovered, shield: o.shield, armor: o.armor, hull: o.hull,
        modules: o.modules || [], stationedDrones: o.stationedDrones || [] })),
      sites: (s.sites || []).map(t => ({ id: t.id, discovered: !!t.discovered,
        guardRecs: t.guardRecs.map(r => ({ frac: r.frac, alive: !!r.alive })),
        emp: t.emplacement ? { destroyed: !!t.emplacement.destroyed,
          armor: t.emplacement.hp.armor, hull: t.emplacement.hp.hull } : null })),
      regionControllers: controllers,
      politicsEvents: (s.politicsEvents || []).slice(0, POLITICS.maxEvents),
      stations: stations.map(st => ({ id: st.id, discovered: !!st.discovered, warpActive: !!st.warpActive })),
      markedStations: (s.markedStations || []).slice(),   // galaxy-map waypoints for uncharted stations
      navWaypoint: s.navWaypoint && typeof s.navWaypoint.x === "number" ? { x: s.navWaypoint.x, y: s.navWaypoint.y } : null,   // user-placed nav target
      exploredTiles: [...s.exploredTiles],
      homeStationId: s.homeStationId, refineBonus: s.refineBonus,
      tradeNetworkComplete: s.tradeNetworkComplete, won: s.won,
      audioMuted: !!s.audioMuted,   // HUD speaker toggle (game/audio.js)
      tutorialDone: !!s.tutorialDone,   // first-run coach marks dismissed (game/tutorial.js)
      // ---- planet surfaces (game/planet_surface.js) ----
      planetProgress: s.planetProgress || {},   // per-planet farms/buildings/stores
      planetCargo: s.planetCargo || {},         // crops loaded aboard the ship
      seedBag: s.seedBag || {},                 // seeds travel with the ship
      questState: s.questState || null,         // City Hall jobs (active + offers)
      // ---- station region quests (game/quests.js) ----
      quests: (s.quests || []).map(q => this._serializeQuest(q)),   // held quests incl. tier/boost progress
      activeQuestId: s.activeQuestId != null ? s.activeQuestId : null,
      // ---- territory objectives (game/objectives.js) ----
      territoryObjectives: this._serializeObjectives(),   // pirate/battle counters + one-time milestone flags
      // ---- stats (unlock conditions) ----
      capturedOutpostCount: s.capturedOutpostCount || 0,
      maxDangerReached: s.maxDangerReached || 1,
      // ---- skills / XP (game/skills.js) ----
      xp: s.xp || 0, level: s.level || 1, skillPoints: s.skillPoints || 0, skills: s.skills || {},
      // ---- outpost trade lanes (game/trade_routes.js) ----
      tradeRouteEarnings: s.tradeRouteEarnings || 0,
      // ---- endgame (game/victory.js) ----
      timePlayed: s.timePlayed || 0, creditsEarned: s.creditsEarned || 0,
      empireWon: !!s.empireWon, factionsDefeated: s.factionsDefeated,
    };
  },

  // Restore a parsed save onto a freshly init()'d state. Call ONLY with parsed
  // JSON (never live references) — the restored objects BECOME the live state.
  applySaveData(data) {
    if (!data || data.v !== 1) return false;
    const s = this.state, stations = ForgeWorld.getStations();
    // ---- player ----
    if (typeof data.credits === "number") s.credits = data.credits;
    s.playerFaction = typeof data.playerFaction === "string" ? data.playerFaction : null;   // pre-faction saves → unaligned
    // ---- skills / XP (set BEFORE the ships block so its recomputeDerived picks
    // up perk bonuses into the fresh hp maxes; game/skills.js) ----
    if (typeof data.xp === "number") s.xp = data.xp;
    if (typeof data.level === "number") s.level = clamp(data.level, 1, 50);
    if (typeof data.skillPoints === "number") s.skillPoints = data.skillPoints;
    if (data.skills && typeof data.skills === "object" && !Array.isArray(data.skills)) s.skills = data.skills;
    if (Array.isArray(data.inventory)) s.inventory = data.inventory;
    if (data.ore) s.ore = data.ore;
    if (data.refinedBars) s.refinedBars = data.refinedBars;
    if (data.factionKills) for (const f of CONFIG.factions) {
      s.factionKills[f] = data.factionKills[f] || 0;
      s.factionKillTimer[f] = s.factionKills[f] > 0 ? POLITICS.killMemory : 0;   // restored heat decays normally
    }
    // ---- ships + the live equipment rack (same wipe→reload as switchActiveShip) ----
    if (Array.isArray(data.ships) && data.ships.length) {
      s.ships = data.ships;
      s.activeShipId = s.ships.some(sh => sh.id === data.activeShipId) ? data.activeShipId : s.ships[0].id;
      this._nextShipId = 1 + s.ships.reduce((m, sh) => Math.max(m, sh.id || 0), 0);
      const active = this.activeShip();
      ForgeEquipment.initEquipment(CONFIG.equipSlots);
      active.slots.forEach((item, i) => { if (item) ForgeEquipment.equip(i, item); });
      ForgeEquipment.restockAmmo();
      this.recomputeDerived();
      s.hp = this.freshHp();
      s.fuel = s.fuelMax; s.weaponCd = 0;
    }
    // ---- companion fleet (trade-run drones keep their wall-clock route) ----
    if (Array.isArray(data.fleet)) {
      s.playerFleet = data.fleet;
      for (const d of s.playerFleet) if (d.role !== "trade") { d.x = s.x; d.y = s.y; d.vx = d.vy = 0; d.targetAlienId = null; }
      this.reindexFormation(s);
    }
    // ---- outposts (deterministic world gen → records match by id) ----
    if (Array.isArray(data.outposts)) for (const rec of data.outposts) {
      const o = this.outpostById(rec.id);
      if (!o) continue;
      o.owner = rec.owner || o.owner;
      o.faction = rec.faction || o.faction;
      o.discovered = !!rec.discovered || o.owner === "player";
      o.modules = Array.isArray(rec.modules) ? rec.modules : [];
      o.stationedDrones = Array.isArray(rec.stationedDrones) ? rec.stationedDrones : [];
      // normalize restored freighters back to their berth — wall-clock trade legs
      // (route.departMs) are stale across sessions; loops re-depart on their own
      for (const d of o.stationedDrones) {
        delete d.route; d.state = "stationed"; d.tradeDwellT = 0;
        d.x = o.x; d.y = o.y; d.vx = d.vy = 0; d.targetAlienId = null;
      }
      const region = this.regionGet(o.regionId);
      if (o.owner === "player") {
        o.capturable = false; o.provoked = false;
        o.guardRecs.forEach(r => { r.alive = false; r.frac = 0; });   // the garrison fell at capture
        if (region) region.owner = "player";
      } else if (region) region.owner = region.faction;
      this.recomputeOutpostDefense(o);   // rebuild maxes from _def0 + restored modules
      if (typeof rec.shield === "number") o.shield = clamp(rec.shield, 0, o.shieldMax);
      if (typeof rec.armor === "number") o.armor = clamp(rec.armor, 0, o.armorMax);
      if (typeof rec.hull === "number") o.hull = clamp(rec.hull, 1, o.hullMax);   // 0 would re-trigger the capture net
    }
    // ---- region sites (deterministic world gen → records match by id; only
    // discovery + the garrison's fate are player-made; pre-site saves skip) ----
    if (Array.isArray(data.sites)) for (const rec of data.sites) {
      const t = this.siteById(rec.id);
      if (!t) continue;
      t.discovered = !!rec.discovered;
      if (Array.isArray(rec.guardRecs)) t.guardRecs.forEach((r, i) => {
        const rr = rec.guardRecs[i];
        if (rr) { r.frac = clamp(+rr.frac || 0, 0, 1); r.alive = !!rr.alive; }
      });
      // base emplacement: world re-seeds it fresh; only its wear + fate persist
      if (rec.emp && t.emplacement) {
        const e = t.emplacement;
        e.destroyed = !!rec.emp.destroyed;
        e.hp.armor = clamp(+rec.emp.armor || 0, 0, e.hp.armorMax);
        e.hp.hull = e.destroyed ? 0 : clamp(+rec.emp.hull || 0, 0, e.hp.hullMax);
      }
    }
    // drone id counter must clear everything restored (fleet + outpost berths)
    let maxDrone = 0;
    for (const d of s.playerFleet) maxDrone = Math.max(maxDrone, d.id || 0);
    for (const o of s.outposts) for (const d of (o.stationedDrones || [])) maxDrone = Math.max(maxDrone, d.id || 0);
    this._nextDroneId = Math.max(this._nextDroneId || 1, maxDrone + 1);
    // ---- political map (the saved controllers are authoritative over any recalc) ----
    if (data.regionControllers) for (const id in data.regionControllers) setRegionController(id, data.regionControllers[id]);
    if (Array.isArray(data.politicsEvents))
      s.politicsEvents = data.politicsEvents.slice(0, POLITICS.maxEvents)
        .map(e => ({ msg: String(e.msg), col: e.col || "#c7d2e0", t: +e.t || 0 }));
    // ---- charted space (discovery only ever adds — home starts true) ----
    if (Array.isArray(data.stations)) for (const rec of data.stations) {
      const st = stations.find(x => x.id === rec.id);
      if (!st) continue;
      st.discovered = st.discovered || !!rec.discovered;
      st.warpActive = st.warpActive || !!rec.warpActive || st.discovered;   // charting a station now grants warp (migrates pre-gate-removal saves)
    }
    if (Array.isArray(data.markedStations))
      s.markedStations = data.markedStations.filter(id => stations.some(st => st.id === id && !st.discovered));
    if (data.navWaypoint && typeof data.navWaypoint.x === "number" && typeof data.navWaypoint.y === "number")
      s.navWaypoint = { x: data.navWaypoint.x, y: data.navWaypoint.y };
    if (Array.isArray(data.exploredTiles)) { s.exploredTiles = new Set(data.exploredTiles); this._exploreTilesAround(s.x, s.y); }
    if (data.homeStationId != null && stations.some(st => st.id === data.homeStationId)) s.homeStationId = data.homeStationId;
    if (typeof data.refineBonus === "number") s.refineBonus = data.refineBonus;
    s.tradeNetworkComplete = !!data.tradeNetworkComplete;
    s.won = !!data.won;
    s.audioMuted = !!data.audioMuted;   // pre-audio saves default to sound on
    s.tutorialDone = data.tutorialDone !== false;   // any save = a seen run (pre-tutorial saves too); false only if saved mid-tutorial
    // ---- planet surfaces (absent in older saves → fresh farms) ----
    if (data.planetProgress && typeof data.planetProgress === "object") s.planetProgress = data.planetProgress;
    if (data.planetCargo && typeof data.planetCargo === "object") s.planetCargo = data.planetCargo;
    if (data.seedBag && typeof data.seedBag === "object") s.seedBag = data.seedBag;
    if (data.questState && typeof data.questState === "object") s.questState = data.questState;
    // ---- station region quests (absent in older saves → empty log) ----
    if (Array.isArray(data.quests)) {
      s.quests = data.quests.map(q => this._serializeQuest(q));   // re-pick fields = sanitize the blob
      s.nextQuestId = 1 + s.quests.reduce((m, q) => Math.max(m, q.id || 0), 0);
      s.activeQuestId = s.quests.some(q => q.id === data.activeQuestId) ? data.activeQuestId : null;
    }
    // ---- territory objectives (absent in older saves → fresh counters; restoring
    // the claimed flags BEFORE any milestone sweep is the no-double-grant guard) ----
    this._applyObjectivesData(data.territoryObjectives);
    // ---- stats (unlock conditions) ----
    s.capturedOutpostCount = data.capturedOutpostCount || 0;
    s.maxDangerReached = clamp(data.maxDangerReached || 1, 1, 9);
    if (typeof data.tradeRouteEarnings === "number") s.tradeRouteEarnings = data.tradeRouteEarnings;
    // ---- endgame (game/victory.js; absent in pre-victory saves → defaults) ----
    if (typeof data.timePlayed === "number") s.timePlayed = data.timePlayed;
    if (typeof data.creditsEarned === "number") s.creditsEarned = data.creditsEarned;
    s._lastCredits = s.credits;   // a restored purse is not "earnings"
    s.empireWon = !!data.empireWon;   // won overlay never re-fires on load
    if (data.factionsDefeated) for (const f of CONFIG.factions) s.factionsDefeated[f] = !!data.factionsDefeated[f];
    s.empireRegions = this.empireRegionCount();   // recount from the restored controllers
    return true;
  },

  // ---- slot plumbing (fail-soft everywhere) ----
  _activeSlot: 1,   // the slot saveGame/clearSave target; set by loadGame / the title's new-game flow
  // storage handle: real localStorage, or _storeOverride (a mock the selfTest injects)
  _saveStore() {
    if (this._storeOverride) return this._storeOverride;
    try { return typeof localStorage !== "undefined" ? localStorage : null; }
    catch (e) { return null; }
  },
  slotUsed(n) {
    const store = this._saveStore(); if (!store) return false;
    try { return store.getItem(saveSlotKey(n)) != null; } catch (e) { return false; }
  },
  readSlot(n) {
    const store = this._saveStore(); if (!store) return null;
    try { const raw = store.getItem(saveSlotKey(n)); return raw ? JSON.parse(raw) : null; }
    catch (e) { console.warn("slot " + n + " unreadable:", e); return null; }
  },
  readSlotsMeta() {
    const store = this._saveStore(); if (!store) return {};
    try { const m = JSON.parse(store.getItem(SAVE_META_KEY) || "null"); return m && typeof m === "object" ? m : {}; }
    catch (e) { return {}; }
  },
  // title-card metadata derived from a SERIALIZED blob (works for migrated saves too)
  slotMetaFrom(data) {
    let territoriesHeld = 0;
    if (data.regionControllers) for (const id in data.regionControllers) if (data.regionControllers[id] === "player") territoriesHeld++;
    return {
      faction: data.playerFaction || null,
      credits: data.credits || 0,
      level: data.level || 1,
      outpostsOwned: Array.isArray(data.outposts) ? data.outposts.filter(o => o.owner === "player").length : 0,
      territoriesHeld,
      timePlayed: data.timePlayed || 0,
      lastSaved: data.savedAt || 0,
    };
  },
  writeSlot(n, data) {
    const store = this._saveStore(); if (!store) return false;
    try {
      store.setItem(saveSlotKey(n), JSON.stringify(data));
      const meta = this.readSlotsMeta();
      meta[n] = this.slotMetaFrom(data);
      store.setItem(SAVE_META_KEY, JSON.stringify(meta));
      return true;
    } catch (e) { console.warn("save failed (private browsing?):", e); return false; }
  },
  // one-time boot migration: pre-slot space_hauler_save → slot 1 (then the old
  // key is deleted). Never clobbers — an occupied slot 1 leaves the legacy key be.
  migrateLegacySave() {
    const store = this._saveStore(); if (!store) return false;
    try {
      const raw = store.getItem(SAVE_KEY_LEGACY);
      if (!raw) return false;
      if (this.slotUsed(1)) { console.warn("legacy save found but slot 1 is occupied — not migrating"); return false; }
      if (!this.writeSlot(1, JSON.parse(raw))) return false;
      store.removeItem(SAVE_KEY_LEGACY);
      console.log("space_hauler: migrated legacy single-slot save → slot 1");
      return true;
    } catch (e) { console.warn("legacy save migration failed:", e); return false; }
  },
  saveGame() {
    if (HEADLESS || this._selfTesting) return false;   // the test harness must never clobber a real save
    if (this.state && this.state.titleOpen) return false;   // no run to save while the title screen is up
    if (!this._saveStore()) { console.warn("save skipped: no localStorage"); return false; }
    return this.writeSlot(this._activeSlot || 1, this.serializeGame());
  },
  loadGame(slot) {
    if (HEADLESS) return false;
    const n = slot || this._activeSlot || 1;
    const data = this.readSlot(n);
    if (!data) return false;
    if (!this.applySaveData(data)) return false;
    this._activeSlot = n;
    // wake up at the saved home port (position itself isn't persisted; the
    // default home is Homeport Mira, a faction pick moves it — game/title.js)
    const homeSt = ForgeWorld.getStations().find(st => st.id === this.state.homeStationId);
    if (homeSt) this._spawnAtStation(homeSt);
    toast("SAVE LOADED", "#57d1c9", 2);
    return true;
  },
  clearSave() {   // clears the ACTIVE slot only (its meta card too)
    const store = this._saveStore(); if (!store) return;
    try {
      const n = this._activeSlot || 1;
      store.removeItem(saveSlotKey(n));
      const meta = this.readSlotsMeta();
      delete meta[n];
      store.setItem(SAVE_META_KEY, JSON.stringify(meta));
    } catch (e) { console.warn("clear save failed:", e); }
  },

  // SAVE / MENU buttons in the loadout (main dock) header
  wireSaveUI() {
    if (HEADLESS || typeof document === "undefined") return;
    const save = document.getElementById("loSaveBtn"), fresh = document.getElementById("loNewGame");
    if (save) save.addEventListener("click", () => {
      if (this.saveGame()) {
        save.textContent = "Saved!";
        setTimeout(() => { save.textContent = "SAVE"; }, 1000);
      } else toast("save unavailable", "#ff5060", 1);
    });
    if (fresh) fresh.addEventListener("click", () => {
      if (!confirm("Return to the title screen? Unsaved progress will be lost.")) return;
      location.reload();   // boot lands on the title — saves stay in their slots
    });
  },
});
