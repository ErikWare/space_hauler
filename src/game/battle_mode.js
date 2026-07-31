/*=== HARNESS:BATTLE_MODE ====================================================*/
// Battle Mode session lifecycle. Isolated from campaign: uses s.playMode
// ("campaign"|"battle") — NOT s.mode (engine constant/burst). Never sets
// _activeSlot, never calls saveGame with campaign writes. Exit re-inits the
// full solar world so NEW/LOAD resume cleanly from the title screen.
const BATTLE = {
  timerDefault: 600,          // 10 minutes (deathmatch + quick control)
  timerControlLong: 1200,     // 20 minutes (3×3 strategy)
  defaultAiDifficulty: "normal",
  kinds: {
    // Pure deathmatch — no outposts, no resource loop, kill the other pilot
    // survey:true — SCAN lists hostiles quietly; SURVEY reveals + aggros the sector
    // `short` is the flight-HUD card label — the full one no longer fits now
    // that the card shares the top band with the vitals + nav cluster.
    sandbox_1x1: { cols: 1, rows: 1, label: "DEATHMATCH 1×1", short: "DM 1×1", survey: true, control: false, deathmatch: true, timer: 600 },
    dm_1x1:      { cols: 1, rows: 1, label: "DEATHMATCH 1×1", short: "DM 1×1", survey: true, control: false, deathmatch: true, timer: 600 },
    // DOTA-style strategy maps
    ctrl_2x2:    { cols: 2, rows: 2, label: "CONTROL 2×2", short: "CTRL 2×2", survey: true, control: true, deathmatch: false, timer: 900 },
    ctrl_3x3:    { cols: 3, rows: 3, label: "CONTROL 3×3", short: "CTRL 3×3", survey: true, control: true, deathmatch: false, timer: 1200 },
  },
};

Object.assign(GAME, {
  isBattle() { return !!(this.state && this.state.playMode === "battle"); },
  isBattleMatch() {
    const b = this.state && this.state.battle;
    return !!(this.isBattle() && b && b.phase === "match");
  },
  isBattleHub() {
    const b = this.state && this.state.battle;
    return !!(this.isBattle() && b && b.phase === "hub");
  },

  // Empty session shell (hub or pre-match).
  // lane: "sandbox" | "career" — drives store access + save plumbing.
  // sourceSlot = career save index; sandboxSlot = sandbox profile index.
  _emptyBattle(opts) {
    opts = opts || {};
    const lane = opts.lane || (opts.sourceSlot != null ? "career" : "sandbox");
    return {
      phase: opts.phase || "hub",
      lane,
      sourceSlot: opts.sourceSlot != null ? opts.sourceSlot : null,
      sandboxSlot: opts.sandboxSlot != null ? opts.sandboxSlot : null,
      sandboxName: opts.sandboxName || null,
      sessionReady: !!opts.sessionReady,   // hub applied a profile — don't wipe on match start
      kind: opts.kind || null,
      seed: opts.seed != null ? opts.seed : ((Math.random() * 1e9) | 0),
      bounds: null,
      grid: null,
      timerMax: BATTLE.timerDefault,
      timerLeft: BATTLE.timerDefault,
      rules: {
        surveyAllowed: false,
        activeScanAllowed: true,
        warpAllowed: false,
        dockMenusSafe: false,
        economy: opts.economy || "session",
      },
      objectives: { kills: 0, killTarget: 0, outpostsOwned: 0 },
      opponent: null,
      alerts: [],
      result: null,
      enemyGroups: opts.enemyGroups != null ? opts.enemyGroups : 3,
      danger: opts.danger != null ? opts.danger : 4,
      aiDifficulty: opts.aiDifficulty || BATTLE.defaultAiDifficulty,
      p2SourceSlot: opts.p2SourceSlot != null ? opts.p2SourceSlot : null,
      careerVsCareer: !!opts.careerVsCareer,
      _store: null,
    };
  },

  setBattleAiDifficulty(key) {
    const s = this.state;
    if (!s.battle) return false;
    if (!this.battleAiProfile || !this.battleAiProfile(key)) return false;
    s.battle.aiDifficulty = key;
    // Live P2 already spawned — re-apply profile
    if (s.battle.p2) this.applyBattleAiDifficulty(s.battle.p2, key);
    return true;
  },

  // Title → BATTLE → sandbox: open the hub for a sandbox profile slot.
  // Empty slot → fresh 100k / all-ships-unlocked profile. Used slot → load.
  // opts.fresh forces a new profile even if the slot has data.
  enterBattleSandboxHub(slot, opts) {
    opts = opts || {};
    const n = slot | 0;
    if (n < 1 || n > (BATTLE_SANDBOX.slots || 3)) {
      toast("bad sandbox slot", "#ff5060"); sfx("warn");
      return { ok: false, reason: "bad slot" };
    }
    this._activeSlot = 0;
    this._pendingFaction = null;
    const s = this.state;
    s.playMode = "battle";
    s.titleOpen = false;
    s.victoryOpen = false;
    s.galaxyMapOpen = false;
    s.onPlanet = false;
    this._hideTitle();
    s.battle = this._emptyBattle({
      phase: "hub",
      lane: "sandbox",
      sandboxSlot: n,
      sourceSlot: null,
      economy: "session",
      sessionReady: true,
      seed: opts.seed,
      aiDifficulty: opts.aiDifficulty || this._pendingBattleDiff || BATTLE.defaultAiDifficulty,
    });
    s.battle.rules.economy = "session";
    this._prepareBattleWorld();
    this.seedBattleArena("sandbox_1x1", s.battle.seed ^ 0xC0FF);
    const used = !opts.fresh && this.sandboxSlotUsed && this.sandboxSlotUsed(n);
    if (used) {
      const data = this.readSandboxSlot(n);
      if (!data || !this.applySandboxSessionData(data)) {
        this.initFreshSandboxProfile({ seed: s.battle.seed });
        s.battle.sandboxName = "Sandbox " + n;
      }
    } else {
      this.initFreshSandboxProfile({ seed: s.battle.seed });
      s.battle.sandboxName = "Sandbox " + n;
      // Persist empty slot immediately so the title card shows as used
      if (this.saveSandboxSession) this.saveSandboxSession({ quiet: true });
    }
    this._battleSpawnPlayer();
    s.docked = true; s.dockTab = "battle"; s.dockKind = "station";
    s.dockStationId = 99001;   // synthetic armory id for store UI
    if (typeof this.initTutorial === "function") {
      s.tutorialDone = true; s.tutorialActive = false;
    }
    toast(
      used
        ? "⚔ SANDBOX HUB · slot " + n + " — shop, fit, hangar, then MATCHES"
        : "⚔ NEW SANDBOX · 100k cr · all ships unlocked · slot " + n,
      "#57e6ff", 3.2
    );
    sfx("buy");
    if (typeof this.renderBattlePanel === "function") this.renderBattlePanel();
    if (typeof this.syncBattleDOM === "function") this.syncBattleDOM();
    return { ok: true, slot: n, fresh: !used };
  },

  // Direct 1×1 duel (tests / rematch). Skips hub — free-fit loadout.
  startBattleSandbox(opts) {
    opts = opts || {};
    this._activeSlot = 0;
    this._pendingFaction = null;
    const s = this.state;
    s.playMode = "battle";
    s.titleOpen = false;
    s.victoryOpen = false;
    s.galaxyMapOpen = false;
    s.onPlanet = false;
    this._hideTitle();
    s.battle = this._emptyBattle({
      phase: "match",
      lane: "sandbox",
      sourceSlot: null,
      sandboxSlot: opts.sandboxSlot != null ? opts.sandboxSlot : null,
      kind: "sandbox_1x1",
      economy: "free",
      seed: opts.seed,
      sessionReady: false,
      enemyGroups: opts.noiseGroups != null ? opts.noiseGroups : (opts.enemyGroups != null ? opts.enemyGroups : 0),
      danger: opts.noiseDanger != null ? opts.noiseDanger : (opts.danger != null ? opts.danger : 2),
    });
    s.battle.rules.surveyAllowed = true;
    s.battle.rules.economy = "free";
    const def0 = BATTLE.kinds.sandbox_1x1;
    s.battle.timerMax = opts.timerMax != null ? opts.timerMax : (def0.timer || 600);
    s.battle.timerLeft = s.battle.timerMax;
    this._prepareBattleWorld();
    this.seedBattleArena("sandbox_1x1", s.battle.seed);
    this.applyBattleSandboxLoadout(opts);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    const diff = opts.aiDifficulty || s.battle.aiDifficulty || "normal";
    s.battle.aiDifficulty = diff;
    this.spawnBattleDuel({
      aiPilotP1: !!opts.aiPilotP1,
      noDrones: !!opts.noDrones,
      noiseGroups: s.battle.enemyGroups,
      noiseDanger: s.battle.danger,
      spawnAngle: opts.spawnAngle,
      keepClutter: !!opts.keepClutter,
      aiDifficulty: diff,
    });
    if (typeof this.initTutorial === "function") {
      s.tutorialDone = true; s.tutorialActive = false;
    }
    const dlab = (this.battleAiProfile && this.battleAiProfile(diff).label) || diff;
    toast("⚔ DUEL — arm weapons · kill P2 · radar pings · AI " + dlab, "#ffb45e", 3);
    sfx("buy");
    return { ok: true };
  },

  // Title → BATTLE → career slot: hub with a cloned career snapshot (no writeback).
  startBattleFromSlot(n) {
    if (!this.slotUsed(n)) { toast("empty slot", "#ff5060"); sfx("warn"); return { ok: false, reason: "empty" }; }
    const data = this.readSlot(n);
    if (!data) { toast("slot unreadable", "#ff5060"); sfx("warn"); return { ok: false, reason: "unreadable" }; }
    this._activeSlot = 0;   // never write campaign during battle
    const s = this.state;
    s.playMode = "battle";
    s.titleOpen = false;
    s.victoryOpen = false;
    this._hideTitle();
    s.battle = this._emptyBattle({
      phase: "hub",
      lane: "career",
      sourceSlot: n,
      economy: "session",
      sessionReady: true,
      aiDifficulty: (this._pendingBattleDiff || BATTLE.defaultAiDifficulty),
    });
    // Combat-relevant fields only — no campaign world progress, no writeback.
    this.applyBattleCareerSnapshot(data);
    this._prepareBattleWorld();
    this.seedBattleArena("sandbox_1x1", s.battle.seed ^ 0xB17);
    this._battleSpawnPlayer();
    s.docked = true; s.dockTab = "battle"; s.dockKind = "station";
    s.dockStationId = null;
    if (typeof this.initTutorial === "function") {
      s.tutorialDone = true; s.tutorialActive = false;
    }
    toast("⚔ LADDER HUB — slot " + n + " snapshot · loadout/hangar free · no store · no career writeback", "#57e6ff", 3.4);
    sfx("buy");
    if (typeof this.renderBattlePanel === "function") this.renderBattlePanel();
    if (typeof this.syncBattleDOM === "function") this.syncBattleDOM();
    return { ok: true };
  },

  // Career vs career: P1 = slotA live fit, P2 = slotB combatant snapshot.
  // Same slot → ghost duel (you vs yourself). Different slots → real loadout clash.
  // Does not write either campaign save.
  startBattleCareerVsCareer(p1Slot, p2Slot, opts) {
    opts = opts || {};
    if (!this.slotUsed(p1Slot)) { toast("P1 slot empty", "#ff5060"); sfx("warn"); return { ok: false, reason: "p1 empty" }; }
    if (!this.slotUsed(p2Slot)) { toast("P2 slot empty", "#ff5060"); sfx("warn"); return { ok: false, reason: "p2 empty" }; }
    const d1 = this.readSlot(p1Slot), d2 = this.readSlot(p2Slot);
    if (!d1 || !d2) { toast("slot unreadable", "#ff5060"); sfx("warn"); return { ok: false, reason: "unreadable" }; }
    const p2Snap = this.combatantFromSaveData(d2, "P2 SLOT " + p2Slot);
    if (!p2Snap) { toast("P2 has no flyable ship", "#ff5060"); sfx("warn"); return { ok: false, reason: "p2 no ship" }; }

    this._activeSlot = 0;
    const s = this.state;
    s.playMode = "battle";
    s.titleOpen = false;
    s.victoryOpen = false;
    s.galaxyMapOpen = false;
    s.onPlanet = false;
    this._hideTitle();

    const diff = opts.aiDifficulty || this._pendingBattleDiff || BATTLE.defaultAiDifficulty;
    s.battle = this._emptyBattle({
      phase: "match",
      lane: "career",
      sourceSlot: p1Slot,
      p2SourceSlot: p2Slot,
      careerVsCareer: true,
      sessionReady: true,
      kind: "dm_1x1",
      economy: "session",
      seed: opts.seed,
      aiDifficulty: diff,
      enemyGroups: opts.noiseGroups != null ? opts.noiseGroups : 0,
      danger: 2,
    });
    s.battle.rules.surveyAllowed = true;
    s.battle.timerMax = opts.timerMax != null ? opts.timerMax : 600;
    s.battle.timerLeft = s.battle.timerMax;

    this._prepareBattleWorld();
    this.seedBattleArena("dm_1x1", s.battle.seed || 1);
    this.applyBattleCareerSnapshot(d1);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    // Full HP for the fight
    if (s.hp) {
      s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
      s.hp._sinceHit = 99;
    }
    s.fuel = s.fuelMax;

    this.spawnBattleDuel({
      p2Snap,
      even: p1Slot === p2Slot,
      aiDifficulty: diff,
      noDrones: !!opts.noDrones,
      noiseGroups: s.battle.enemyGroups,
      keepClutter: !!opts.keepClutter,
      spawnAngle: opts.spawnAngle,
      aiPilotP1: !!opts.aiPilotP1,
    });

    if (typeof this.initTutorial === "function") {
      s.tutorialDone = true; s.tutorialActive = false;
    }
    const dlab = (this.battleAiProfile && this.battleAiProfile(diff).label) || diff;
    const ghost = p1Slot === p2Slot;
    toast(
      ghost
        ? "⚔ GHOST DUEL — you vs your fit · AI " + dlab
        : "⚔ CAREER DUEL — slot " + p1Slot + " vs slot " + p2Slot + " · AI " + dlab,
      "#ffb45e", 3
    );
    sfx("buy");
    return { ok: true, p1Slot, p2Slot, difficulty: diff };
  },

  // Launch a match kind from the hub (or directly).
  // Hub sessions (sessionReady) keep the player's current ships/fleet/inventory.
  startBattleMatch(kind, opts) {
    opts = opts || {};
    const def = BATTLE.kinds[kind];
    if (!def) return { ok: false, reason: "bad kind" };
    const s = this.state;
    if (!this.isBattle()) {
      s.playMode = "battle";
      s.battle = this._emptyBattle({ phase: "match", kind, economy: opts.economy || "session", lane: "sandbox" });
    }
    const b = s.battle;
    // Bank sandbox fit before the arena wipe of world state (ships stay on s.*)
    if (b.lane === "sandbox" && b.sessionReady && this.saveSandboxSession)
      this.saveSandboxSession({ quiet: true });
    // Snapshot live fit before _prepareBattleWorld (does not clear ships)
    const keepFit = !!b.sessionReady || b.lane === "career" || b.sourceSlot != null || b.careerVsCareer;
    b.phase = "match";
    b.kind = kind;
    b.seed = opts.seed != null ? opts.seed : ((Math.random() * 1e9) | 0);
    b.timerMax = opts.timerMax != null ? opts.timerMax : (def.timer || BATTLE.timerDefault);
    b.timerLeft = b.timerMax;
    b.result = null;
    b.objectives = { kills: 0, killTarget: 0, outpostsOwned: 0 };
    b.rules.surveyAllowed = !!def.survey;
    b.rules.economy = opts.economy || b.rules.economy || "session";
    b.control = !!def.control;
    b.deathmatch = !!def.deathmatch;
    const defaultNoise = def.control ? 2 : 0;
    b.enemyGroups = opts.noiseGroups != null ? opts.noiseGroups : (opts.enemyGroups != null ? opts.enemyGroups : defaultNoise);
    b.danger = opts.noiseDanger != null ? opts.noiseDanger : (opts.danger != null ? opts.danger : (def.control ? 3 : 2));
    s.docked = false; s.atOutpost = null; s.atStation = false;
    s.galaxyMapOpen = false; s.warpOverlay = false;
    this._prepareBattleWorld();
    this.seedBattleArena(kind, b.seed);
    // Free-fit only when launching cold (tests / no hub). Hub fits are sacred.
    if (!keepFit && (b.rules.economy === "free" || kind === "sandbox_1x1" || kind === "dm_1x1" || def.control))
      this.applyBattleSandboxLoadout(opts);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    // Full vitals for the fight
    if (s.hp) {
      s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
      s.hp._sinceHit = 99; s.fuel = s.fuelMax;
    }
    const diff = opts.aiDifficulty || b.aiDifficulty || BATTLE.defaultAiDifficulty;
    b.aiDifficulty = diff;
    // Career hub: optional ghost/other-slot P2
    let p2Snap = null;
    if (opts.p2Snap) p2Snap = opts.p2Snap;
    else if (b.p2SourceSlot != null && this.slotUsed(b.p2SourceSlot)) {
      const d2 = this.readSlot(b.p2SourceSlot);
      p2Snap = this.combatantFromSaveData(d2, "P2 SLOT " + b.p2SourceSlot);
    }
    // Deathmatch: strip outposts. Control: keep outposts/sites/fields.
    const keepClutter = opts.keepClutter != null ? !!opts.keepClutter : !!def.control;
    this.spawnBattleDuel({
      aiPilotP1: !!opts.aiPilotP1,
      noDrones: !!opts.noDrones,
      noiseGroups: b.enemyGroups,
      noiseDanger: b.danger,
      spawnAngle: opts.spawnAngle,
      aiDifficulty: diff,
      p2Snap: p2Snap || undefined,
      even: !p2Snap,
      keepClutter,
    });
    if (def.control && typeof this.bootstrapBattleControlEconomy === "function")
      this.bootstrapBattleControlEconomy();
    if (def.control && typeof this.updateBattleControlVision === "function")
      this.updateBattleControlVision();
    const dlab = (this.battleAiProfile && this.battleAiProfile(diff).label) || diff;
    const tip = def.control
      ? "home factories · contest mid · reinforce · S&D · radar · kill P2"
      : "arm skills · kill P2 · radar pings";
    toast("⚔ " + def.label + " · " + tip + " · AI " + dlab, "#ffb45e", 3);
    sfx("buy");
    return { ok: true };
  },

  // Strip campaign solar clutter so arena seed owns the map.
  _prepareBattleWorld() {
    const s = this.state;
    s.aliens = [];
    s.miners = [];
    s.npcTraders = [];
    s.enemyBases = [];
    s.outposts = [];
    s.sites = [];
    s.obstacles = [];
    s.empShots = []; s.empTorpedoes = [];
    s.loot = [];
    s.tows = [];
    s.rocks = []; s.rockFree = [];
    s.junk = []; s.junkFree = [];
    s.fields = []; s.nextFieldId = 1;
    s.regions = []; s.regionById = new Map(); s.regionGrid = null; s.currentRegionId = null;
    s.exploredTiles = new Set();
    s.scannedRegions = new Set();
    s.scanList = []; s.scanActiveId = null; s._scanListScroll = 0;
    s.scanCh = null; s.scanPulse = null; s.scanPulseCd = 0; s._scanRings = [];
    s.contracts = []; s.escorts = [];
    s.planets = s.planets || [];
    // Keep planet array empty for arena anchors (bg fields only).
    s.planets = [];
    s._moonList = [];
    s.dead = false; s.invuln = 1.5; s.flash = 0;
    s.vx = s.vy = 0; s.holdT = 0; s.charge = 0; s.thrusting = false;
    if (s.hp) {
      s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
    }
    s.fuel = s.fuelMax;
    // Kill politics / reclaim clocks
    s._reclaimT = null;
    s.tradeRaid = null;
  },

  _battleSpawnPlayer() {
    const s = this.state, b = s.battle;
    const bounds = b && b.bounds;
    let x = 0, y = 0;
    if (bounds) {
      // Spawn slightly off-center so the first look isn't at the origin clutter.
      x = (bounds.minX + bounds.maxX) * 0.5 - 180;
      y = (bounds.minY + bounds.maxY) * 0.5 + 220;
    }
    s.x = x; s.y = y; s.vx = s.vy = 0;
    s.cam.x = x; s.cam.y = y;
    s.heading = -Math.PI / 2;
    this._exploreTilesAround(x, y);
    this.updateRegions();
    this.tickFields(0);
    // Sync fleet drones to player
    if (s.playerFleet) {
      for (const d of s.playerFleet) {
        if (d.role === "escort" || d.role === "tank") {
          d.x = s.x; d.y = s.y; d.vx = d.vy = 0; d.hp = d.maxHp; d.shield = d.maxShield;
        }
      }
      if (typeof this.reindexFormation === "function") this.reindexFormation(s);
    }
  },

  // Career snapshot: ships, fleet, inventory, credits, skills, identity.
  applyBattleCareerSnapshot(data) {
    const s = this.state;
    if (!data) return;
    s.playerFaction = data.playerFaction || s.playerFaction;
    s.playerPortraitId = data.playerPortraitId || null;
    s.playerGender = data.playerGender || null;
    s.playerRace = data.playerRace || null;
    s.mercenary = !!data.mercenary;
    s.credits = data.credits != null ? data.credits : s.credits;
    s.inventory = Array.isArray(data.inventory) ? data.inventory.map(it => it && typeof it === "object" ? { ...it } : it) : [];
    s.ore = data.ore && typeof data.ore === "object" ? JSON.parse(JSON.stringify(data.ore)) : {};
    s.refinedBars = data.refinedBars && typeof data.refinedBars === "object" ? { ...data.refinedBars } : {};
    s.xp = data.xp || 0; s.level = data.level || 1; s.skillPoints = data.skillPoints || 0;
    s.skills = data.skills && typeof data.skills === "object" ? { ...data.skills } : {};
    if (Array.isArray(data.ships) && data.ships.length) {
      s.ships = data.ships.map(sh => ({
        id: sh.id, hullKey: sh.hullKey, name: sh.name,
        slots: (sh.slots || []).map(it => it ? { ...it } : null),
      }));
      s.activeShipId = data.activeShipId || s.ships[0].id;
    }
    if (Array.isArray(data.fleet)) {
      s.playerFleet = data.fleet.map(d => ({ ...d, loadout: (d.loadout || []).map(m => m ? { ...m } : m) }));
    }
    // Rebind equipment rack from active ship
    const ship = (s.ships || []).find(sh => sh.id === s.activeShipId) || (s.ships && s.ships[0]);
    if (ship && typeof ForgeEquipment !== "undefined") {
      const nSlots = (CONFIG.hulls[ship.hullKey] && CONFIG.hulls[ship.hullKey].equipSlots != null)
        ? CONFIG.hulls[ship.hullKey].equipSlots : CONFIG.equipSlots;
      ForgeEquipment.initEquipment(nSlots);
      // equip(slotIndex, item) — index first
      for (let i = 0; i < (ship.slots || []).length; i++) {
        if (ship.slots[i]) ForgeEquipment.equip(i, ship.slots[i]);
      }
    }
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    if (typeof this.freshHp === "function") {
      const base = this.freshHp();
      s.hp = base;
    }
    if (typeof this.reapplyDroneStats === "function") this.reapplyDroneStats();
    if (typeof this.recomputeSkills === "function") this.recomputeSkills();
    else if (typeof this.applySkills === "function") this.applySkills();
  },

  endBattleMatch(reason) {
    const s = this.state, b = s.battle;
    if (!b || b.phase === "result") return;
    // Control maps: pilot kills are tempo, not match point — a side that still
    // holds outposts respawns its pilot (battle_control.js intercept).
    if (typeof this._battleControlIntercept === "function"
        && this._battleControlIntercept(reason)) return;
    const r = this._scoreBattleResult(reason || "ended");
    b.phase = "result";
    b.result = r;
    s.docked = true; s.dockTab = "battle";
    toast(r.won ? "★ VICTORY — " + r.summary : "✖ DEFEAT — " + r.summary, r.won ? "#57e6ff" : "#ff5060", 4);
    sfx(r.won ? "sell" : "warn");
    if (typeof this.renderBattlePanel === "function") this.renderBattlePanel();
  },

  _scoreBattleResult(reason) {
    const s = this.state, b = s.battle;
    const kills = (b.objectives && b.objectives.kills) || 0;
    const p2 = b.p2;
    const p2Dead = !!(p2 && (p2.dead || (p2.hp && p2.hp.hull <= 0)));
    const playerDead = !!(s.dead || (s.hp && s.hp.hull <= 0));
    const ops = (s.outposts || []).filter(o => o.owner === "player").length;
    const opsTotal = (s.outposts || []).length;
    const def = BATTLE.kinds[b.kind];
    const p1Ehp = s.hp ? (s.hp.shield + s.hp.armor + s.hp.hull) : 0;
    const p2Ehp = p2 && p2.hp ? (p2.hp.shield + p2.hp.armor + p2.hp.hull) : 0;
    let won = false, summary = reason, winner = null;
    if (reason === "rival_bases_down") {
      won = true; winner = "P1"; summary = "enemy outpost network destroyed";
    } else if (reason === "bases_lost") {
      won = false; winner = "P2"; summary = "all outposts lost";
    } else if (reason === "p2_down") {
      won = true; winner = "P1"; summary = "P2 hull destroyed";
    } else if (reason === "death" || reason === "p1_down") {
      won = false; winner = "P2"; summary = "P1 hull destroyed";
    } else if (reason === "forfeit") {
      won = false; winner = "P2"; summary = "P1 forfeit";
    } else if (reason === "timer") {
      if (def && def.control) {
        // Territory decides: whoever holds more outposts at the horn wins.
        const rOps = (s.outposts || []).filter(o => o.owner === "rival").length;
        won = !playerDead && ops > rOps;
        summary = "outposts P1 " + ops + " vs P2 " + rOps + " (of " + opsTotal + ")";
        winner = won ? "P1" : "P2";
      } else {
        // Duel: more remaining EHP wins
        won = !playerDead && (p2Dead || p1Ehp >= p2Ehp);
        winner = won ? "P1" : "P2";
        summary = p2Dead ? "P2 down" : ("EHP P1 " + Math.round(p1Ehp) + " vs P2 " + Math.round(p2Ehp));
      }
    } else if (reason === "wipe") {
      // legacy — prefer duel outcomes
      won = !playerDead; winner = won ? "P1" : "P2";
      summary = "packs cleared";
    } else {
      won = !playerDead && p2Dead;
      winner = won ? "P1" : (playerDead ? "P2" : null);
      summary = reason;
    }
    if (playerDead && reason !== "timer" && reason !== "rival_bases_down") {
      won = false; winner = "P2"; summary = "P1 hull destroyed";
    }
    return {
      won, reason, summary, winner, kills, outposts: ops,
      p1Ehp: Math.round(p1Ehp), p2Ehp: Math.round(p2Ehp),
      hullKey: b.p1Snap && b.p1Snap.hullKey,
    };
  },

  // Return from result/match → hub (sandbox + career). Never dumps sandbox to title.
  battleBackFromResult() {
    const s = this.state, b = s.battle;
    if (!b) { this.exitBattleToTitle(); return; }
    const hasHub = b.lane === "sandbox" || b.lane === "career" || b.sourceSlot != null || b.sandboxSlot != null;
    if (hasHub) {
      // Persist sandbox fit after the fight (spent ammo etc.)
      if (b.lane === "sandbox" && this.saveSandboxSession) this.saveSandboxSession({ quiet: true });
      b.phase = "hub";
      b.result = null;
      b.kind = null;
      b.sessionReady = true;
      s.docked = true; s.dockTab = "battle"; s.dockKind = "station";
      if (b.lane === "sandbox") s.dockStationId = 99001;
      this._prepareBattleWorld();
      this.seedBattleArena("sandbox_1x1", b.seed ^ 0x51);
      this._battleSpawnPlayer();
      // Full repair at hub
      if (s.hp) {
        s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
        s.hp._sinceHit = 99; s.fuel = s.fuelMax;
      }
      if (typeof this.renderBattlePanel === "function") this.renderBattlePanel();
      if (typeof this.syncBattleDOM === "function") this.syncBattleDOM();
    } else {
      this.exitBattleToTitle();
    }
  },

  // Leave hub / battle → title. Sandbox profiles auto-save first.
  exitBattleToTitle() {
    const b = this.state && this.state.battle;
    if (b && b.lane === "sandbox" && b.sessionReady && this.saveSandboxSession)
      this.saveSandboxSession({ quiet: true });
    this._activeSlot = 0;
    if (this.state) {
      this.state.playMode = "campaign";
      this.state.battle = null;
      this.state.docked = false;
      this.state.titleOpen = true;
    }
    this.init();   // rebuild full solar system for NEW/LOAD
    this.showTitleScreen();
    toast("returned to title", "#8a8f98", 2);
  },

  _fmtBattleTimer(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = (sec / 60) | 0, r = sec % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  },
});
