/*=== HARNESS:MAIN ===========================================================*/
// Game loop: init → update → draw, wiring every Forge module together, plus the
// headless selfTest that plays the whole loop in Node.
Object.assign(GAME, {
  init() {
    const prevMode = this.state ? this.state.mode : "constant";
    setSeed(42);
    ForgeItemSystem.loadDB(SPACE_HAULER_CATALOG);   // inject game catalogue into the generic engine
    ForgeEquipment.initEquipment(CONFIG.equipSlots);
    ForgeCombat.initCombat();
    ForgeFaction.initFactions();
    ForgeWorld.initWorld(42, { onToast: (t) => toast(t) });
    const stations = ForgeWorld.getStations();

    // ── solar system: generate planets and relocate ForgeWorld stations ──
    const savedSeed = _seed;
    const planets = this.makePlanets();
    for (const p of planets) {
      const st = stations[p.stationIdx];
      const stAngle = Math.atan2(p.y, p.x) + 0.3;
      const stDist = p.r * 2.8;
      st.pos.x = p.x + Math.cos(stAngle) * stDist;
      st.pos.y = p.y + Math.sin(stAngle) * stDist;
      st.name = p.name + " Station";
    }
    stations[0].name = "Homeport Mira";
    const homePos = { x: stations[0].pos.x, y: stations[0].pos.y };
    this._oreCenter = homePos;

    ForgeStore.initStore({ seed: 4242, stations });
    const npcStations = stations.map(st => ({ id: st.id, x: st.pos.x, y: st.pos.y }));
    ForgeNPC.initNPC(npcStations);

    // DEV: warp to every station unlocked from the start (no need to fly out and
    // discover each one first) — drop this before ship, it also suppresses the
    // trade-network-complete win check below so it isn't awarded for free.
    const debugAllWarpUnlocked = !this._selfTesting;
    if (debugAllWarpUnlocked) stations.forEach(st => { st.discovered = true; st.warpActive = true; });

    this.state = {
      x: homePos.x, y: homePos.y + 40, vx: 0, vy: 0, heading: -1.5708, t: 0,
      charge: 0, aimX: 1, aimY: 0, thrusting: false, holdT: 0, flare: 0, mode: prevMode,
      fuel: CONFIG.baseShip.fuelMax, fuelMax: CONFIG.baseShip.fuelMax,
      hp: this.freshHp(),
      invuln: 0, flash: 0, shieldFlash: 0, dead: false, fuelOut: false, warned: false, rationsGiven: false,
      credits: CONFIG.debugStartCredits, inventory: [], inventoryMax: 60, ore: {},
      homeStationId: stations[0].id, refineBonus: 0,
      tows: [], rocks: [], rockFree: [], junk: [], junkFree: [], planets: planets, loot: [], miners: [], aliens: [],
      fields: [], nextFieldId: 1,
      onPlanet: false, nearPlanetName: null, currentPlanetName: null, planetProgress: {},
      regions: [], regionById: null, regionGrid: null, currentRegionId: null,
      outposts: [], outpostShots: [], _reclaimT: null,
      atOutpost: null, dockKind: "station", outpostDockId: null,
      enemyBases: [], junkClusters: [], _stationDebris: 0, _moonList: [],
      nextRockId: 1, weaponCd: 0,
      atStation: false, docked: false, dockStationId: stations[0].id, dockTab: "loadout", warpOverlay: false,
      markedStations: [],   // station ids flagged from the warp screen → waypoints on the galaxy map (persisted)
      won: false, tradeNetworkComplete: false, _debugAllWarpUnlocked: debugAllWarpUnlocked,
      capturedOutpostCount: 0, maxDangerReached: 1,   // lifetime unlock stats (persisted by the save system)
      timePlayed: 0, creditsEarned: 0, _lastCredits: CONFIG.debugStartCredits,   // lifetime clock + summed positive purse deltas (persisted)
      xp: 0, level: 1, skillPoints: 0, skills: {},   // global XP / leveling + allocated skill-tree ranks (persisted; game/skills.js)
      tradeRouteEarnings: 0, tradeRaid: null, _tradeRaidT: null,   // outpost trade lanes (earnings persisted; game/trade_routes.js)
      empireRegions: 0, empireWon: false, victoryOpen: false,   // endgame: live player-region count · won flag · pause overlay
      factionsDefeated: { vex: false, krag: false, nox: false },   // one-time collapse-narrative flags (persisted)
      exploredTiles: new Set(),
      npcTraders: [], pirateTargetId: null, galaxyMapOpen: false,
      mapZoom: 1, mapFocusX: 0, mapFocusY: 0,   // galaxy-map view: zoom + panned focus (session-only, reset on open)
      navWaypoint: null, mapSetWaypointMode: false,   // user-placed nav target ({x,y}, persisted) + the map's "arm to place" flag (session-only)
      thrustPower: 0.75,
      tutorialDone: false, tutorialActive: false, tutorialStep: 0,   // first-run coach marks (done flag persisted; armed by initTutorial after loadGame)
      audioMuted: false,   // HUD speaker toggle (persisted by the save system)
      // multi-ship: owned hulls + per-ship persistent loadouts; the active
      // ship's slots mirror the live ForgeEquipment rack (_syncActiveShipSlots)
      ships: [{ id: 1, hullKey: "vulture", name: CONFIG.hulls.vulture.name, slots: new Array(CONFIG.equipSlots).fill(null) }],
      activeShipId: 1,
      derived: null, towsCap: CONFIG.hulls.vulture.baseTows,
      cam: { x: homePos.x, y: homePos.y, zoom: CONFIG.zoom0, tz: CONFIG.zoom0 },
      _nebMods: null, _npcStations: npcStations,
    };
    ForgeWorld.setPlayer(this.state);
    // flattened moon index → world position (anchors the "moon_N" rock zones)
    for (const p of planets) for (const m of p.moons) this.state._moonList.push({ x: m.x, y: m.y });

    const rocks = this.state.rocks;
    for (const ring of CONFIG.rings) for (let i = 0; i < ring.n; i++) rocks.push(this.makeRock(ring, homePos));
    const tutRock = rocks[0];
    tutRock.x = homePos.x; tutRock.y = homePos.y - 260; tutRock.vx = 0; tutRock.vy = 0;
    for (let i = 0; i < planets.length; i++) for (let k = 0; k < CONFIG.pRingRocks; k++) rocks.push(this.makeZoneRock("planet_" + i));
    this.seedJunkField();

    this.seedWorld();
    this.initEncounters(this.state);
    this.initDrones(this.state);
    this.initFleet(this.state);
    this.initContracts(this.state);
    this.initNpcTraders(this.state);
    this.initPolitics(this.state);   // faction politics: named regions + border skirmish clock
    // default starter loadout (5 of 6 slots)
    const _sr = (n) => ForgeItemSystem.seedRng(n);
    const starters = [
      ForgeItemSystem.generateItem("laser", "normal", { ilvl: 1, rng: _sr(100) }),
      ForgeItemSystem.generateItem("shield_regen_module", "normal", { ilvl: 1, rng: _sr(101) }),
      ForgeItemSystem.generateItem("armor_repair_module", "normal", { ilvl: 1, rng: _sr(102) }),
      ForgeItemSystem.generateItem("fuel_cell_module", "normal", { ilvl: 1, rng: _sr(103) }),
      ForgeItemSystem.generateItem("tractor_range", "normal", { ilvl: 1, rng: _sr(104) }),
    ];
    for (let si = 0; si < starters.length; si++) ForgeEquipment.equip(si, starters[si]);
    this._nextShipId = 2;
    this._syncActiveShipSlots();
    this.recomputeDerived();
    this.state.fuel = this.state.fuelMax;
    this._exploreTilesAround(this.state.x, this.state.y);
    if (!HEADLESS && typeof localStorage !== "undefined") {
      const tp = parseFloat(localStorage.getItem("sh_thrustPower"));
      if (tp >= 0.25 && tp <= 1) this.state.thrustPower = tp;
    }
    toasts.length = 0;
  },

  // ── fog of war: tile-based exploration ──
  _tileKey(wx, wy) {
    const t = CONFIG.FOG_TILE;
    return ((wx / t) | 0) + "," + ((wy / t) | 0);
  },
  _exploreTilesAround(wx, wy) {
    const s = this.state, t = CONFIG.FOG_TILE;
    const tx = Math.floor(wx / t), ty = Math.floor(wy / t);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      s.exploredTiles.add((tx + dx) + "," + (ty + dy));
  },
  isTileExplored(wx, wy) {
    return this.state.exploredTiles.has(this._tileKey(wx, wy));
  },

  seedWorld() {
    const s = this.state, nebs = ForgeWorld.getNebulas(), facs = CONFIG.factions;
    // rich ore inside the six ForgeWorld nebulas (zone-tagged: respawns in-cloud)
    for (let ni = 0; ni < nebs.length; ni++)
      for (let k = 0; k < CONFIG.nebulaOre; k++) s.rocks.push(this.makeZoneRock("nebula_" + ni));
    // alien groups around each planet (faction-appropriate, wedge-scaled)
    for (const p of s.planets) {
      const nGroups = 1 + ((rnd() * 2) | 0);
      for (let g = 0; g < nGroups; g++) {
        const a = rnd() * TAU, d = p.r * 3 + rnd() * p.r * 4;
        const pos = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
        const dl = getDangerLevel(pos.x, pos.y);
        const grp = ForgeFaction.generateGroup(p.faction, pos, { rng: rnd, leaderTier: dl >= 3 ? undefined : "rare" });
        for (const al of [grp.leader, ...grp.followers]) s.aliens.push(applyDangerToShip(al, dl));
      }
    }
    // nebula alien groups (inner system encounters, wedge-scaled)
    for (const neb of nebs) for (let g = 0; g < CONFIG.groupsPerNebula; g++) {
      const fac = this.factionForPos(neb.pos.x, neb.pos.y);   // lore: squads match their zone's faction
      const pos = { x: neb.pos.x + (rnd() - 0.5) * neb.radius, y: neb.pos.y + (rnd() - 0.5) * neb.radius };
      const dl = getDangerLevel(pos.x, pos.y);
      const grp = ForgeFaction.generateGroup(fac, pos, { rng: rnd, leaderTier: dl >= 3 ? undefined : "rare" });
      for (const al of [grp.leader, ...grp.followers]) s.aliens.push(applyDangerToShip(al, dl));
    }
    for (const st of ForgeWorld.getStations()) { const ms = ForgeNPC.spawnMiners({ id: st.id, x: st.pos.x, y: st.pos.y }); for (const m of ms) s.miners.push(m); }
    this.seedStationDebris();
    s.enemyBases = this.makeEnemyBases();
    this.seedRegions();         // static sector grid → every region gets ≥1 streaming field
    this.seedOutposts();        // organic faction outposts (~1 per 5 regions)
    this.seedExtraNebulas();    // after alien seeding so extras don't multiply squads
    this.updateRegions();       // set the ship's starting region
    this.tickFields(0);         // activate whatever fields already surround the ship's start
  },

  // World Density Pass: 8–12 extra game-side nebula clouds pushed into
  // ForgeWorld's live nebula array (2–3 per orbital zone; belt clouds larger +
  // flagged dense for a thicker render). Extras get full nebula behavior
  // (drag/scan/tier modifiers, enter/exit toasts) but no alien/ore seeding.
  seedExtraNebulas() {
    const nebs = ForgeWorld.getNebulas(), colors = ["cyan", "purple", "orange"];
    for (const z of CONFIG.extraNebulaZones) {
      const n = z.nMin + ((rnd() * (z.nMax - z.nMin + 1)) | 0);
      for (let k = 0; k < n; k++) {
        const radius = z.sizeMin + rnd() * (z.sizeMax - z.sizeMin);
        let pos = null;
        for (const clear of [1200, 400]) {   // strict pass, then relaxed
          for (let t = 0; t < 40 && !pos; t++) {
            const a = rnd() * TAU, d = z.rMin + rnd() * (z.rMax - z.rMin);
            const p = { x: Math.cos(a) * d, y: Math.sin(a) * d };
            if (this._stationClear(p.x, p.y, radius + clear)) pos = p;
          }
          if (pos) break;
        }
        if (!pos) continue;
        nebs.push({ id: nebs.length, pos, radius,
          color: colors[(rnd() * colors.length) | 0], extra: true, dense: z.dense });
      }
    }
  },

  update(dt) {
    const s = this.state;
    if (s.victoryOpen) return;   // EMPIRE ESTABLISHED — world frozen under the victory overlay
    if (input.restart) { input.restart = false; this.init(); this.loadGame(); this.initTutorial(this.state); return; }   // R matches page reload: back to the save (fresh world without one)
    if (input.warpToggle) { input.warpToggle = false; if (!s.warpOverlay) this.openWarpOverlay(); else this._closeWarpOverlay(); }
    if (input.mapToggle && !s.onPlanet) { input.mapToggle = false; this.toggleGalaxyMap(); }   // Phase 6 (on a planet, M is "launch" — handled in PLANET.tick)
    s.timePlayed += dt;   // lifetime clock — ticks docked/warping too, frozen only by the victory pause
    if (s.credits > s._lastCredits) { s.creditsEarned += s.credits - s._lastCredits;   // lifetime earnings = summed positive purse deltas (spends ignored)
      AUDIO.play("credits"); }   // any purse gain chimes (sell, salvage, trade run, spoils)
    s._lastCredits = s.credits;
    this.updateAudio(dt);   // hit/tractor/low-shield watches — runs docked too so the hum can stop
    this.updateDrones(dt);   // Phase 3: trade drones keep flying while docked/warping
    this.updateNpcTraders(dt, s);   // Phase 6: convoys + ambient piracy keep running too
    this.updateTradeRoutes(dt);     // outpost trade lanes: freighter loops fly while docked too
    this.updateTradeRaids(dt);      // …and pirates keep scheming against them
    this.updatePolitics(s, dt);     // faction politics: borders keep shifting while docked too
    this.updateTutorial(s);         // first-run coach marks: tip 1 auto-advances on movement

    // ── planet surface mode ────────────────────────────────────────────────────
    // When on a planet surface, the planet engine handles the whole update and we
    // return early.  Space systems (drones, traders, politics) already ticked above
    // at full speed — the "time dilation" effect is that the rest of the space game
    // (flight, aliens, enemy bases, rocks) is frozen while the player is on-surface.
    if (s.onPlanet) { PLANET.tick(dt, s); stepToasts(dt); return; }
    // ── planet proximity detection (space side) ────────────────────────────────
    s.nearPlanetName = null;
    for (const p of s.planets) {
      if (Math.hypot(s.x - p.x, s.y - p.y) < p.r * 2.5) { s.nearPlanetName = p.name; break; }
    }
    if (s.nearPlanetName && input.landEdge) { input.landEdge = false; PLANET.land(s, s.nearPlanetName); return; }
    input.landEdge = false;

    if (s.warpOverlay) {
      const w = ForgeWorld.tickWarp(dt);
      if (w && w.arrived) this._closeWarpOverlay();   // tunnel done → drop the overlay so play resumes (was frozen: needed a full reload)
      stepToasts(dt); return;
    }

    if (input.dock) { input.dock = false;
      if (!s.docked) {
        if (s.atStation) this.openDock(s.dockStationId);
        else if (s.atOutpost) this.openOutpostDock(s.atOutpost);   // owned platform → gear/store/fortify
      }
    }
    if (input.closeMenu) { input.closeMenu = false; if (s.galaxyMapOpen) this.closeGalaxyMap(); else if (s.docked) this.closeDock(); }
    // Phase 6: the open map pauses pilot input (no thrust / taps / tractor /
    // skills / fire) while the world keeps ticking underneath.
    if (s.galaxyMapOpen) {
      input.ax = input.ay = 0;
      input.tractorEdge = false; input.pickX = input.pickY = null; input.skillTap = null;
    }
    if (s.docked) {
      if (input.refuel) { input.refuel = false; this.refuel(); }
      s.hp.shield = Math.min(s.hp.shieldMax, s.hp.shield + CONFIG.dockHeal * 3 * dt);
      s.hp.armor = Math.min(s.hp.armorMax, s.hp.armor + CONFIG.dockHeal * 1.5 * dt);
      s.hp.hull = Math.min(s.hp.hullMax, s.hp.hull + CONFIG.dockHeal * 2 * dt);
      ForgeWorld.tickWarp(dt); stepToasts(dt); return;
    }

    if (input.refuel) { input.refuel = false; if (s.atStation) this.refuel(); }
    if (input.toggleMode) { input.toggleMode = false; s.mode = s.mode === "constant" ? "burst" : "constant";
      s.holdT = 0; s.charge = 0; s.thrusting = false; toast(s.mode === "constant" ? "engine: CONSTANT" : "engine: BURST"); sfx("buy"); }
    if (input.returnToBase) { input.returnToBase = false; const home = this.homeStationObj();
      s.x = home.pos.x; s.y = home.pos.y; s.vx = 0; s.vy = 0; s.holdT = 0; s.charge = 0; s.thrusting = false; toast("↩ RETURNED HOME"); sfx("grab"); }
    if (input.zoomEdge) { this.applyZoom(input.zoomEdge); input.zoomEdge = 0; }

    s.t += dt;
    this.tickCamera(dt);
    stepParticles(dt); stepToasts(dt);
    if (s.dead) return;

    this.recomputeDerived();

    // engine + nebula-modified drag + gravity
    const towing = this.tickEngine(dt);
    const mods = ForgeWorld.getNebulaModifiers({ x: s.x, y: s.y }); s._nebMods = mods;
    const drag = Math.pow(towing ? mods.dragTowing : mods.dragFree, dt * 60);
    s.vx *= drag; s.vy *= drag;
    this.applyGravity(dt);
    s.x += s.vx * dt; s.y += s.vy * dt;

    this.tickFuel(dt);
    this.tickHealth(dt);

    if (input.tractorEdge) { input.tractorEdge = false;
      const g = this.nearestGrabbable(s.derived.tractorRange);
      if (g && s.tows.length < s.towsCap) this.grabTow(g.arr, g.i);
      else if (s.tows.length) this.dropAllTows();
      else toast("no target in beam range");
    }
    if (input.pickX != null) { this.resolveTap(input.pickX, input.pickY); input.pickX = input.pickY = null; }

    this.updateRegions();  // track the ship's current region (Region Event Manager)
    this.tickFields(dt);   // stream mining fields in/out around the ship
    for (let i = 0; i < s.rocks.length; i++) { const r = s.rocks[i]; if (!r.active) continue;
      r.rot += r.spinV * dt; r.x += r.vx * dt; r.y += r.vy * dt;
      if (r.hitFlash > 0) r.hitFlash = Math.max(0, r.hitFlash - dt); }
    for (const j of s.junk) { if (!j.active) continue; j.x += j.vx * dt; j.y += j.vy * dt; j.rot += j.spinV * dt; }
    this.tickTows(dt);

    if (input.skillTap != null) { this.toggleSkill(input.skillTap); input.skillTap = null; }
    this.tickSkills(dt);
    this.updateLock(dt);
    if (!s.galaxyMapOpen) { this.tryFireWeapon(dt); this.updatePiracy(dt); }   // Phase 6: no fire while mapping
    else s.weaponCd = Math.max(0, (s.weaponCd || 0) - dt * 1000);
    ForgeCombat.updateProjectiles(dt);
    this.updateAliens(dt);
    this.updateFleet(dt);   // Phase 5: formation following + fleet combat AI
    this.updateEnemyBases(dt);
    this.updateOutposts(dt);
    // outpost turret shots: move + hit player (hostile) or aliens (friendly —
    // fired by captured platforms; kills settle via updateAliens' loot sweep)
    if (s.outpostShots) {
      for (let i = s.outpostShots.length - 1; i >= 0; i--) {
        const sh = s.outpostShots[i];
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;
        sh.life -= dt * 1000;
        if (sh.life <= 0) { s.outpostShots.splice(i, 1); continue; }
        if (sh.friendly) {
          for (const al of s.aliens) {
            if (al.state === "DEAD" || al.hp.hull <= 0) continue;
            if (Math.hypot(al.x - sh.x, al.y - sh.y) < (al.r || 15) + 4) {
              ForgeCombat.applyDamage(al, sh.dmg, sh.dmg, sh.dmg);
              burst(al.x, al.y, "#ffd24a", 4);
              s.outpostShots.splice(i, 1);
              break;
            }
          }
          continue;
        }
        if (Math.hypot(s.x - sh.x, s.y - sh.y) < CONFIG.shipR + 4 && s.invuln <= 0) {
          this.damageShip(sh.dmg);
          s.outpostShots.splice(i, 1);
        }
      }
    }
    ForgeNPC.updateMiners(s.miners, s.rocks, dt);
    ForgeNPC.updateStationTurrets(s._npcStations, { x: s.x, y: s.y, hp: s.hp }, dt);
    if (s.hp.hull <= 0 && !s.dead) this.onShipDestroyed();
    this.updateLoot(dt);
    this.updateEncounters(dt, s);
    this.updateContracts(dt);   // Phase 4: escort convoys + defense raid waves
    for (let i = 0; i < s.rocks.length; i++) { const r = s.rocks[i]; if (!r.active || !r.mined) continue;
      r.mined = false; r.towedBy = null; this.respawnRock(i); }

    const discEvents = ForgeWorld.updateDiscovery({ x: s.x, y: s.y });
    for (const ev of discEvents) if (ev.type === "discover" && ev.station) {
      ev.station.warpActive = true;   // fly-to-once unlocks warp — no gate to build
      const mi = s.markedStations ? s.markedStations.indexOf(ev.station.id) : -1;
      if (mi >= 0) s.markedStations.splice(mi, 1);   // reached a marked target → clear its waypoint
      toast("⌘ WARP UNLOCKED — " + ev.station.name, "#8fd0ff");
      this.checkWin();   // discovering the last station now also completes the trade network
    }
    this._exploreTilesAround(s.x, s.y);

    // collisions — the rock passes run only on the neighborhood around the ship
    // (distant rocks are static, so far pairs can never matter). The rock–rock
    // pair pass is grid-bucketed in rockPairPass; a flat loop over the near set
    // is quadratic and caps local rock density at ~300.
    const nearRocks = [], nearR2 = CONFIG.collNear * CONFIG.collNear;
    for (let i = 0; i < s.rocks.length; i++) { const r = s.rocks[i]; if (!r.active) continue;
      const ndx = r.x - s.x, ndy = r.y - s.y;
      if (ndx * ndx + ndy * ndy < nearR2) nearRocks.push(i); }
    for (const i of nearRocks) { if (this.isTowed("rocks", i)) continue; const r = s.rocks[i];
      if (this.circleHit(s, CONFIG.shipR, CONFIG.shipMass, r, r.size * 20, r.mass) && s.invuln <= 0 && !s.atStation) this.damageShip(5 + r.mass * 3); }
    for (let i = 0; i < s.junk.length; i++) { const j = s.junk[i]; if (!j.active || this.isTowed("junk", i)) continue;
      if (this.circleHit(s, CONFIG.shipR, CONFIG.shipMass, j, j.r, CONFIG.junkMass) && s.invuln <= 0 && !s.atStation) this.damageShip(1); }
    this.rockPairPass(nearRocks);

    // nav waypoint reached → clear it (and its HUD arrow)
    if (s.navWaypoint && Math.hypot(s.x - s.navWaypoint.x, s.y - s.navWaypoint.y) < 240) {
      s.navWaypoint = null; toast("◎ waypoint reached", "#7fdfff"); sfx("grab"); this.saveGame();
    }

    // at-station: auto-bank haul + slow repair + emergency rations
    const near = this.nearestStationInfo();
    s.atStation = !!(near.station && near.station.discovered && near.dist < CONFIG.dockR);
    if (s.atStation) {
      s.dockStationId = near.station.id;
      if (s.tows.length) { const got = this.depositTows(); if (got.ore || got.mods) { toast(`stored +${got.ore} ore, +${got.mods} salvage`); sfx("sell"); } }
      s.hp.hull = Math.min(s.hp.hullMax, s.hp.hull + CONFIG.dockHeal * dt);
      s.hp.armor = Math.min(s.hp.armorMax, s.hp.armor + CONFIG.dockHeal * 0.5 * dt);
      if (s.fuel < 20 && s.credits < 5 && !s.rationsGiven) { s.fuel = Math.min(s.fuelMax, s.fuel + CONFIG.rationFuel); s.fuelOut = false; s.rationsGiven = true; toast("station charity: rations"); sfx("buy"); }
    } else s.rationsGiven = false;
  },

  draw(g) {
    if (HEADLESS) return;
    const s = this.state;
    this.syncLoadoutDOM();   // show/hide the #loadoutPanel DOM overlay from dock state
    this.syncDroneDOM();  // show/hide + refresh the #dronePanel DOM overlay
    this.syncContractsDOM();   // show/hide + first-show render of #contractsPanel
    this.syncFleetDOM();  // Phase 5: show/hide + first-show render of #fleetPanel
    this.syncStoreDOM();  // show/hide + first-show render of #storePanel
    this.syncWarpDOM();   // show/hide + first-show render of #warpPanel
    this.syncShipsDOM();  // show/hide + first-show render of #shipsPanel (ship market)
    this.syncSkillsDOM();    // show/hide the #skillsPanel skill-tree overlay (game/skills.js)
    this.syncFortifyDOM();   // show/hide + first-show render of #fortifyPanel (outpost dock)
    this.syncVictoryDOM();   // show/hide the #victoryPanel EMPIRE ESTABLISHED overlay
    this.syncTutorialDOM();  // show/hide + re-place the #tutPanel first-run coach mark
    if (s.warpOverlay) { ForgeWorld.drawWarpUI(this._ctx, { width: CONFIG.W, height: CONFIG.H }); return; }
    if (s.onPlanet) { PLANET.draw(g, s); return; }
    if (s.docked) {
      g.fillStyle = "#070a12"; g.fillRect(0, 0, CONFIG.W, CONFIG.H);
      return;
    }
    this.drawWorld(g);
    this.drawDronesWorld(g);      // Phase 3: in-flight trade drones (flat plane)
    this.drawFleetWorld(g);       // Phase 5: teal fleet wingmen (flat plane)
    this.drawTradeRoutesWorld(g);    // dashed outpost trade lanes (under the freighters)
    this.drawOutpostDroneWorld(g);   // FORTIFY-stationed drones at player outposts
    this.drawTradersWorld(g);     // Phase 6: NPC cargo wedges (flat plane)
    this.drawEncounterMarkers(g);
    this.drawContractWorld(g);    // Phase 4: escort freighter + bounty flagship dressing
    ForgeHUD.drawHUD(this.buildHudState());
    this.drawXpBar(g);            // ambient global-XP hairline atop the HUD (game/skills.js)
    this.drawEncounterIcons(g);   // overlays ForgeHUD's minimap
    this.drawEnemyBasesMinimap(g);   // hostile red triangles on the same disc
    this.drawDronesMinimap(g);    // cyan trade-drone dots on the same disc
    this.drawFleetMinimap(g);     // Phase 5: teal fleet triangles on the same disc
    this.drawTradersMinimap(g);   // Phase 6: white trader squares on the same disc
    this.drawContractMinimap(g);  // gold escort dot + bounty reticle on the same disc
    this.drawTradeMarkers(g);     // Phase 7: on-screen ring / edge arrow + ETA for trade runs
    this.drawWaypointHUD(g);      // light edge arrow toward the user's nav waypoint (galaxy_map.js)
    this.drawControls(g);
    this.drawSecBadge(g);         // SEC danger level near minimap
    this.drawShipBadge(g);        // current hull name under the top-strip bars
    this.drawContractHUD(g);      // Phase 4: active-contract box, top-right
    this.drawTraderAlert(g);      // Phase 6: blinking "trader under attack" edge note
    this.drawTradeRouteAlert(g);  // blinking "trade route under attack" edge note (trade_routes.js)
    this.drawPoliticsTicker(g);   // faction politics: news ticker, top-center
    if (s.flash > 0) { g.fillStyle = `rgba(255,60,60,${(s.flash / CONFIG.flashT) * 0.32})`; g.fillRect(0, 0, CONFIG.W, CONFIG.H); }
    if (s.tradeNetworkComplete) {
      g.fillStyle = "rgba(5,7,13,.62)"; g.fillRect(0, CONFIG.H / 2 - 46, CONFIG.W, 66);
      g.fillStyle = "#ffd27a"; g.font = "bold 16px monospace"; g.textAlign = "center";
      g.fillText("★ TRADE NETWORK COMPLETE ★", CONFIG.W / 2, CONFIG.H / 2 - 18);
      g.font = "11px monospace"; g.fillStyle = "#e8edf4"; g.fillText(`${s.credits}cr banked · game continues`, CONFIG.W / 2, CONFIG.H / 2 + 4); g.textAlign = "left";
    }
    if (s.galaxyMapOpen) this.drawGalaxyMap(g);   // Phase 6: topmost overlay
    // ── planet landing prompt ──────────────────────────────────────────────────
    if (s.nearPlanetName) {
      const W = CONFIG.W, H = CONFIG.H;
      g.fillStyle = "rgba(5,7,13,0.78)";
      g.fillRect(0, H - 40, W, 40);
      g.fillStyle = "#57d1c9"; g.font = "bold 11px monospace"; g.textAlign = "center";
      g.fillText("Near " + s.nearPlanetName, W / 2, H - 14);
      g.textAlign = "left";
    }
  },

  // dock tab bar (game-owned chrome over the Forge overlays)
  dockTabs() {
    const w = 39, h = 30, y = 8, gap = 2;   // 7 tabs + launch fit the 390 canvas
    const t = (i) => ({ x: 8 + (w + gap) * i, y, w, h });
    return { loadout: t(0), store: t(1), warp: t(2), ships: t(3), drones: t(4), fleet: t(5), contracts: t(6),
             launch: { x: CONFIG.W - 88, y, w: 80, h } };
  },
  _dockTabDefs: [
    ["loadout", "⚙ FIT"], ["store", "☰ STORE"], ["warp", "⌘ WARP"], ["ships", "⛭ SHIPS"],
    ["drones", "◈ HANGAR"], ["fleet", "▲ FLEET"], ["contracts", "✦ JOBS"],
  ],
  drawDockTabs(g) {
    const s = this.state, tb = this.dockTabs();
    const tab = (r, label, on) => { g.fillStyle = on ? "#1c5a54" : "#16202f"; g.strokeStyle = on ? "#2c8b82" : "#2a3a52"; g.lineWidth = 1;
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill(); g.stroke();
      g.fillStyle = on ? "#dffdf8" : "#e8edf4"; g.font = "bold 7px monospace"; g.textAlign = "center";
      g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 3); g.textAlign = "left"; };
    for (const [key, label] of this._dockTabDefs) tab(tb[key], label, s.dockTab === key);
    tab(tb.launch, "LAUNCH ▸", false);
  },
  hitDockTabs(x, y) {
    const tb = this.dockTabs(), hit = r => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
    for (const [key] of this._dockTabDefs) if (hit(tb[key])) { this.setDockTab(key); return true; }
    if (hit(tb.launch)) { input.closeMenu = true; return true; }
    return false;
  },

  getState() {
    const s = this.state, sk = ForgeEquipment.getSkillState(), eq = ForgeEquipment.getEquipped();
    const fitted = eq.slots.filter(Boolean).length;
    return {
      credits: s.credits, fuel: +s.fuel.toFixed(1),
      shield: +s.hp.shield.toFixed(1), armor: +s.hp.armor.toFixed(1), hull: +s.hp.hull.toFixed(1),
      dead: s.dead, tows: s.tows.length, charge: +s.charge.toFixed(2), dist: Math.hypot(s.x, s.y) | 0,
      atStation: s.atStation, docked: s.docked, tradeNetworkComplete: s.tradeNetworkComplete, zoom: +s.cam.zoom.toFixed(2), mode: s.mode,
      oreTypes: Object.keys(s.ore).length, inventory: s.inventory.length, equipped: fitted, skills: sk.filter(x => x.item).length,
      aliens: s.aliens.length, miners: s.miners.length, loot: s.loot.length, encounters: s.encounters.length,
      enemyBases: s.enemyBases.filter(b => !b.destroyed).length,
      drones: s.drones.length, refinedBars: { ...s.refinedBars },
      fleet: s.playerFleet.length, escorts: this.escorts(s).length,
      ships: s.ships.length, activeShip: s.activeShipId,
      contracts: s.contracts.length,
      npcTraders: s.npcTraders.length, galaxyMapOpen: s.galaxyMapOpen,
      empireRegions: s.empireRegions, empireWon: s.empireWon, victoryOpen: s.victoryOpen, timePlayed: +s.timePlayed.toFixed(1),
      tutorialDone: !!s.tutorialDone, tutorialStep: s.tutorialActive ? s.tutorialStep : -1,
      lock: ForgeCombat.getLock().status, locked: ForgeCombat.isLocked(),
      discovered: ForgeWorld.getState().discovered, gated: ForgeWorld.getState().active,
      rocks: s.rocks.length, junk: s.junk.length, planets: s.planets.length, projectiles: ForgeCombat.getProjectiles().length,
      derived: { ...s.derived }, t: +s.t.toFixed(2),
    };
  },
  probe() { const s = this.state; return { fuel: s.fuel, hp: s.hp, x: s.x, y: s.y, vx: s.vx, vy: s.vy, charge: s.charge }; },

  selfTest() {
    const step = () => this.update(1 / 60);
    const FORGE = { ForgeItemSystem, ForgeEquipment, ForgeHUD, ForgeWorld, ForgeStore, ForgeCombat, ForgeFaction, ForgeNPC };
    this._selfTesting = true;   // disarm saveGame — the suite must never clobber a real save
    this.wireUI(null, null);
    this.init(); let s = this.state;

    // ===== 0) all 9 Forge module globals present + each own selfTest GREEN =====
    // faction/npc selfTests fire through ForgeCombat (85% hit on Math.random) —
    // seed a deterministic hitting rng so their turret/AI damage checks are stable.
    for (const k of Object.keys(FORGE)) {
      if (!FORGE[k] || typeof FORGE[k].selfTest !== "function") throw new Error("missing Forge global: " + k);
      if (k === "ForgeFaction" || k === "ForgeNPC") ForgeCombat.initCombat({ rng: () => 0.1 });
      const f = FORGE[k].selfTest();
      if (!Array.isArray(f) || f.length) throw new Error(k + ".selfTest: " + JSON.stringify(f));
    }
    ForgeCombat.initCombat();
    this.init(); s = this.state;   // re-init after Forge selfTests reset module state

    // ===== world composition: static sector grid + streaming fields =====
    const homeObj = this.homeStationObj();
    // tutorial rock (a legacy home-ring rock) is still eagerly seeded at home
    if (s.rocks[0].type !== "junk" || Math.abs(s.rocks[0].y - (homeObj.pos.y - 260)) > 1) throw new Error("tutorial rock missing");
    const fieldsOf = (k) => s.fields.filter(f => f.kind === k);
    // sector grid: numbered regions tiling the disc, each guaranteed content
    if (!s.regions.length || !s.regionGrid) throw new Error("no regions seeded");
    if (s.regions.length < 800 || s.regions.length > 2400) throw new Error("region count out of band: " + s.regions.length);
    for (const r of s.regions) {
      if (Math.hypot(r.cx, r.cy) > CONFIG.WORLD_RADIUS + 1) throw new Error("region center outside disc: " + r.id);
      if (r.fields.length < 1) throw new Error("region " + r.id + " has no field");        // coverage guarantee
      if (r.resources.length < 1) throw new Error("region " + r.id + " has no resource");   // ≥1 resource each
      if (r.fields.length > 3) throw new Error("region " + r.id + " over-dense: " + r.fields.length);
    }
    // every field belongs to exactly one region; region.fields references resolve
    if (s.fields.some(f => f.regionId == null || !s.regionById.has(f.regionId))) throw new Error("field with bad regionId");
    // regionAt(x,y) round-trips to the region whose cell contains the point
    for (const r of [s.regions[0], s.regions[(s.regions.length / 2) | 0], s.regions[s.regions.length - 1]]) {
      const got = this.regionAt(r.cx, r.cy);
      if (!got || got.id !== r.id) throw new Error("regionAt round-trip failed for " + r.id);
    }
    // station regions carry a station event; the ship starts inside a real region
    if (s.regions.filter(r => r.event && r.event.type === "station").length !== ForgeWorld.getStations().length) throw new Error("station region count");
    if (s.currentRegionId == null || !s.regionById.has(s.currentRegionId)) throw new Error("ship not in a valid region");
    // outposts: organic settlement layer — ~1-in-5 regions, min-distance spaced,
    // faction-aligned with their region, never sharing a station's region
    if (s.outposts.length < 150 || s.outposts.length > 400) throw new Error("outpost count out of band: " + s.outposts.length);
    for (let i = 0; i < s.outposts.length; i++) {
      const o = s.outposts[i], region = s.regionById.get(o.regionId);
      if (!region) throw new Error("outpost with bad region");
      if (o.faction !== region.faction) throw new Error("outpost faction != region faction");
      if (region.event && region.event.type === "station") throw new Error("outpost in a station region");
      if (o.guardRecs.length !== 3) throw new Error("outpost must start with 3 guards");
      if (o.shieldMax <= 0 || o.turretRange <= 0) throw new Error("outpost missing health/turret fields");
      for (let j = i + 1; j < s.outposts.length; j++)
        if (this.dist(o.x, o.y, s.outposts[j].x, s.outposts[j].y) < CONFIG.outpostMinDist - 1) throw new Error("outposts too close");
    }
    if (s.outposts[0].shieldMax <= 0) throw new Error("outpost[0].shieldMax must be > 0");
    if (s.outposts[0].turretRange <= 0) throw new Error("outpost[0].turretRange must be > 0");
    // live rocks stay bounded — only nearby fields instantiate, never total
    // capacity (~6k). Dense zones (the belt ring) can reach ~1400 concurrently.
    const liveNow = () => s.rocks.reduce((a, r) => a + (r.active ? 1 : 0), 0);
    if (liveNow() > 2200) throw new Error("live rocks not bounded: " + liveNow());
    // belt fields sit within the 37k–40k annulus (± a sector)
    const beltFields = fieldsOf("belt");
    if (!beltFields.length) throw new Error("no belt fields");
    for (const f of beltFields) { const d = Math.hypot(f.x, f.y);
      if (d < CONFIG.asteroidBelt.innerR - CONFIG.sectorSize || d > CONFIG.asteroidBelt.outerR + CONFIG.sectorSize) throw new Error("belt field radius: " + d); }

    // activate a belt field → rocks instantiate inside the disc, gold/platinum + bonus
    const bf = beltFields[0];
    if (bf.active) this.deactivateField(bf);
    bf.stock = bf.cap;
    this.activateField(bf);
    const bfRocks = s.rocks.filter(r => r.active && r.fieldId === bf.id);
    if (bfRocks.length !== Math.floor(bf.cap)) throw new Error("belt field spawn count: " + bfRocks.length + " vs cap " + bf.cap);
    for (const r of bfRocks) {
      if (r.type !== "gold" && r.type !== "platinum") throw new Error("belt field ore: " + r.type);
      if (!r.ringBonus) throw new Error("belt field rock missing bonus");
      if (this.dist(r.x, r.y, bf.x, bf.y) > bf.r + 1) throw new Error("belt field rock outside its disc");
    }
    // depletion: mining a field rock frees its slot (does NOT respawn)
    const beforeLive = liveNow(), victim = s.rocks.indexOf(bfRocks[0]);
    this.respawnRock(victim);
    if (s.rocks[victim].active) throw new Error("mined field rock not freed");
    if (s.rockFree.indexOf(victim) < 0) throw new Error("freed slot not pooled for reuse");
    if (liveNow() !== beforeLive - 1) throw new Error("depletion did not drop live count");
    // deactivate captures the depleted stock; slot reuse keeps the array bounded
    this.deactivateField(bf);
    if (bf.active) throw new Error("field still active after deactivate");
    if (bf.stock >= bf.cap) throw new Error("stock not reduced by mining: " + bf.stock + "/" + bf.cap);
    // slow regen refills a dormant field toward its cap
    const stockPre = bf.stock;
    this.tickFields(30);   // 30 dormant seconds (ship is at home, far from the belt)
    if (bf.stock <= stockPre) throw new Error("dormant field did not regen");
    if (bf.stock > bf.cap) throw new Error("regen overshot cap");
    // legacy home-ring rock still respawns in place (index-stable, non-field)
    if (s.rocks[3].fieldId) throw new Error("expected a legacy ring rock at index 3");
    this.respawnRock(3);
    if (!s.rocks[3].active || s.rocks[3].fieldId) throw new Error("legacy respawn must stay a live non-field rock");
    if (s.planets.length !== CONFIG.solarPlanets.length) throw new Error("planet count: " + s.planets.length);
    for (const p of s.planets) { if (p.orbit < 5000) throw new Error("planet orbit too small"); if (p.r < 600 || p.r > 2200) throw new Error("planet radius: " + p.r); }
    // junk field: 600–1100 floaters across halos / lanes / stations / hotspots / fill
    const jz = (z) => s.junk.filter(j => j.zone === z);
    const sts0 = ForgeWorld.getStations();
    if (s.junk.length < 600 || s.junk.length > 1100) throw new Error("junk count out of band: " + s.junk.length);
    if (s._stationDebris < CONFIG.stationDebrisMin * sts0.length || s._stationDebris > CONFIG.stationDebrisMax * sts0.length) throw new Error("station debris: " + s._stationDebris);
    for (let i = 0; i < sts0.length; i++) {
      const deb = jz("station_" + i);
      if (deb.length < CONFIG.stationDebrisMin || deb.length > CONFIG.stationDebrisMax) throw new Error("station_" + i + " debris: " + deb.length);
      for (const j of deb) if (this.dist(j.x, j.y, sts0[i].pos.x, sts0[i].pos.y) > CONFIG.stationDebrisDistMax + 1) throw new Error("station debris too far");
    }
    for (let i = 0; i < s.planets.length; i++) {
      const h = jz("halo_" + i), L = jz("lane_" + i);
      if (h.length < CONFIG.junkPlanetHaloMin || h.length > CONFIG.junkPlanetHaloMax) throw new Error("halo_" + i + " junk: " + h.length);
      if (L.length < CONFIG.junkLaneMin || L.length > CONFIG.junkLaneMax) throw new Error("lane_" + i + " junk: " + L.length);
      for (const j of h) { const d = this.dist(j.x, j.y, s.planets[i].x, s.planets[i].y);
        if (d < CONFIG.junkHaloDistMin - 1 || d > CONFIG.junkHaloDistMax + 1) throw new Error("halo dist: " + d); }
      for (const j of L) if (Math.abs(Math.hypot(j.x, j.y) - s.planets[i].orbit) > CONFIG.junkLaneSpread + 1) throw new Error("lane radius off orbit");
    }
    // every live floater drifts slowly (0.1–0.4 u/s); inert streamed-out slots skip
    for (const j of s.junk) { if (!j.active) continue; const sp = Math.hypot(j.vx, j.vy);
      if (sp < CONFIG.junkDriftMin - 1e-9 || sp > CONFIG.junkDriftMax + 1e-9) throw new Error("junk drift speed: " + sp); }
    // field junk streams with its field: present while active, freed on deactivate
    { const af = s.fields.find(f => f.active);
      if (af) {
        const fj = (i0 => { let n = 0; for (const j of s.junk) if (j.active && j.fieldId === af.id) n++; return n; })();
        if (fj < 1) throw new Error("active field has no junk mixed in");
        this.deactivateField(af);
        for (const j of s.junk) if (j.active && j.fieldId === af.id) throw new Error("field junk survived deactivation");
        this.activateField(af);
      } }
    for (const cl of s.junkClusters) for (const st of sts0)
      if (this.dist(cl.x, cl.y, st.pos.x, st.pos.y) < CONFIG.junkClusterStationGap) throw new Error("junk cluster overlaps station");
    // hauled junk respawns into its own zone
    { const hi = s.junk.indexOf(jz("halo_3")[0]);
      this.respawnJunk(hi);
      if (s.junk[hi].zone !== "halo_3" || this.dist(s.junk[hi].x, s.junk[hi].y, s.planets[3].x, s.planets[3].y) > CONFIG.junkHaloDistMax + 1)
        throw new Error("junk zone respawn"); }
    // nebulas: 6 ForgeWorld + 8–12 game-side extras; belt clouds large + dense
    const nebAll = ForgeWorld.getNebulas(), nebExtra = nebAll.filter(n => n.extra);
    if (nebAll.length < 14 || nebAll.length > 18) throw new Error("nebula count: " + nebAll.length);
    if (nebExtra.length !== nebAll.length - 6) throw new Error("extra nebula flags: " + nebExtra.length);
    const beltNebs = nebExtra.filter(n => n.dense);
    if (beltNebs.length < 2) throw new Error("no dense belt nebulas");
    for (const n of beltNebs) {
      if (n.radius < 2499 || n.radius > 4001) throw new Error("belt nebula radius: " + n.radius);
      const d = Math.hypot(n.pos.x, n.pos.y);
      if (d < CONFIG.asteroidBelt.innerR - 1 || d > CONFIG.asteroidBelt.outerR + 1) throw new Error("belt nebula off belt: " + d);
    }
    for (const n of nebExtra) if (!n.dense && (n.radius < 1799 || n.radius > 3501)) throw new Error("extra nebula radius: " + n.radius);
    if (s.enemyBases.length < CONFIG.enemyBaseMin || s.enemyBases.length > CONFIG.enemyBaseMax) throw new Error("enemy base count: " + s.enemyBases.length);
    for (const b of s.enemyBases) {
      const bd = Math.hypot(b.x, b.y);
      if (bd < CONFIG.enemyBaseRMin || bd > CONFIG.enemyBaseRMax) throw new Error("enemy base distance: " + bd);
      if (!CONFIG.factions.includes(b.faction)) throw new Error("enemy base faction: " + b.faction);
      if (b.destroyed || b.hp.hull !== CONFIG.enemyBaseHp || b.maxHp !== CONFIG.enemyBaseHp) throw new Error("enemy base hp init");
      if (b.spawnCooldown < CONFIG.enemyBaseSpawnMin || b.spawnCooldown > CONFIG.enemyBaseSpawnMax) throw new Error("enemy base spawn cooldown");
      for (const st of ForgeWorld.getStations()) if (this.dist(b.x, b.y, st.pos.x, st.pos.y) < CONFIG.enemyBaseGap) throw new Error("enemy base too close to station");
      for (const o of s.enemyBases) if (o !== b && this.dist(b.x, b.y, o.x, o.y) < CONFIG.enemyBaseGap) throw new Error("enemy bases too close");
    }
    if (!s.aliens.length) throw new Error("no aliens seeded");
    if (!s.miners.length) throw new Error("no miners seeded");

    // ===== 1) 3-LAYER HEALTH MATH (Shield → Armor → Hull, overflow penetrates) =====
    this.init(); s = this.state;
    s.hp.res.shield = s.hp.res.armor = s.hp.res.hull = 0;   // pure overflow math
    s.hp.shield = 100; s.hp.armor = 80; s.hp.hull = 60; s.invuln = 0;
    let toHull = this.damageShip(150);                       // 100 → shield, 50 → armor
    if (s.hp.shield !== 0 || Math.abs(s.hp.armor - 30) > 1e-6 || s.hp.hull !== 60 || toHull !== 0) throw new Error("3-layer step1: " + JSON.stringify(s.hp));
    toHull = this.damageShip(50); s.invuln = 0;              // 30 → armor, 20 → hull
    if (s.hp.armor !== 0 || Math.abs(s.hp.hull - 40) > 1e-6 || Math.abs(toHull - 20) > 1e-6) throw new Error("3-layer step2: " + JSON.stringify(s.hp));

    // ===== 2) CONSTANT thrust: accelerate while held + burn fuel/sec + throttle glow =====
    // (planets/miners cleared as before; rocks/junk too — the density pass fills
    //  the y=9000 lane with Vesper's ring torus + lane junk, and a bounce would
    //  break the exact velocity/fuel math.)
    this.init(); s = this.state; s.aliens = []; s.planets = []; s.miners = []; s.rocks.length = 0; s.rockFree = []; s.junkFree = []; s.fields = []; s.outposts = []; s.junk.length = 0; s.x = 0; s.y = 9000; s.vx = s.vy = 0;
    input.ax = 1; input.ay = 0; const f0 = s.fuel;
    for (let i = 0; i < 60; i++) step();
    const v1 = s.vx;
    if (!(v1 > 400 && v1 < CONFIG.accel)) throw new Error("thrust accel: " + v1);
    if (Math.abs(f0 - s.fuel - CONFIG.thrustFuelRate) > 0.6) throw new Error("thrust fuel cost: " + (f0 - s.fuel));
    if (!(s.charge > 0.9)) throw new Error("throttle glow did not ramp: " + s.charge);
    const fCoast = s.fuel; input.ax = 0; step();
    if (s.vx >= v1) throw new Error("thrust did not stop on release");
    if (Math.abs(fCoast - s.fuel) > 0.02) throw new Error("fuel burned while coasting");

    // ===== 3) drift drag free vs towing (nebula modifiers, clear space) + no fuel while drifting =====
    this.init(); s = this.state; s.aliens = []; s.planets = []; s.miners = []; s.junk.length = 0; s.rocks = [s.rocks[0]]; s.rockFree = []; s.junkFree = []; s.fields = []; s.outposts = []; s.x = 0; s.y = 9000; s.vx = 100; s.vy = 0; const f1 = s.fuel;
    for (let i = 0; i < 60; i++) step();
    const vFree = s.vx;
    if (Math.abs(vFree - 100 * Math.pow(CONFIG.dragFree, 60)) > 3) throw new Error("free drag: " + vFree);
    const ti = 0; s.tows = [{ arr: "rocks", i: ti }];
    s.x = 0; s.y = 9100; s.vx = 100; s.vy = 0; s.rocks[ti].x = 0; s.rocks[ti].y = 9160; s.rocks[ti].vx = s.rocks[ti].vy = 0;
    for (let i = 0; i < 60; i++) step();
    const vTow = s.vx;
    if (Math.abs(vTow - 100 * Math.pow(CONFIG.dragTow, 60)) > 3) throw new Error("tow drag: " + vTow);
    if (!(vTow < vFree * 0.7)) throw new Error("tow drag not stronger");
    if (Math.abs(s.fuel - f1) > 0.001) throw new Error("drift consumed fuel");
    const towLeash = CONFIG.leashBase + this.towRadius(s.tows[0]) + 3;
    if (this.shipTo(s.rocks[ti]) > towLeash) throw new Error("tow exceeded leash: " + this.shipTo(s.rocks[ti]));

    // ===== 4) collision: bounce + damage to hull + invuln window =====
    // (shield/armor 0 so damage lands on hull; _sinceHit=0 so shield doesn't
    //  regen a sliver this frame; hull starts at hullMax since recompute clamps.)
    this.init(); s = this.state; s.aliens = []; s.hp.res.shield = s.hp.res.armor = s.hp.res.hull = 0;
    s.hp.shield = 0; s.hp.armor = 0; s.hp.hull = s.hp.hullMax; s.hp._sinceHit = 0;
    s.miners = []; s.junk.length = 0; s.rocks = [s.rocks[3]]; s.rockFree = []; s.junkFree = []; s.fields = []; s.outposts = [];   // exactly one collider in the lane
    const rk = s.rocks[0]; rk.x = 0; rk.y = 9030; rk.vx = rk.vy = 0;
    s.x = 0; s.y = 9000; s.vx = 0; s.vy = 50; s.invuln = 0;
    const hullMax = s.hp.hullMax; step();
    if (Math.abs(hullMax - s.hp.hull - (5 + rk.mass * 3)) > 1e-6) throw new Error("collision hull dmg: drop=" + (hullMax - s.hp.hull));
    if (!(rk.vy > s.vy)) throw new Error("no elastic bounce");
    if (!(s.invuln > 0)) throw new Error("no invuln window");
    const hp1 = s.hp.hull; rk.x = s.x; rk.y = s.y + 20; rk.vx = rk.vy = 0; step();
    if (s.hp.hull !== hp1) throw new Error("invuln window failed");

    // ===== 5) planet gravity: pull inside 1.5r, silent outside =====
    // (isolate one well: 6–8 seeded planets can overlap the probe point, so keep
    //  only planets[0]; miners cleared so nothing mines/respawns its ring rocks.)
    this.init(); s = this.state; s.aliens = []; s.miners = []; s.junk.length = 0; s.rocks.length = 0; s.rockFree = []; s.junkFree = []; s.fields = []; s.outposts = [];
    s.planets = [s.planets[0]];
    const p0 = s.planets[0]; s.x = p0.x - p0.r * 1.2; s.y = p0.y; s.vx = s.vy = 0;
    for (let i = 0; i < 30; i++) step();
    if (!(s.vx > 0.4)) throw new Error("gravity pull: " + s.vx);
    s.x = p0.x; s.y = p0.y - p0.r * 2.6; s.vx = s.vy = 0;
    for (let i = 0; i < 30; i++) step();
    if (Math.hypot(s.vx, s.vy) > 0.2) throw new Error("gravity leaks outside zone");

    // ===== 6) zoom clamped 0.08–3.0 =====
    for (let i = 0; i < 40; i++) { input.zoomEdge = -1; step(); }
    if (Math.abs(s.cam.tz - CONFIG.zoomMin) > 1e-9) throw new Error("zoom min clamp");
    for (let i = 0; i < 40; i++) { input.zoomEdge = 1; step(); }
    if (Math.abs(s.cam.tz - CONFIG.zoomMax) > 1e-9) throw new Error("zoom max clamp");
    s.cam.tz = CONFIG.zoom0;

    // ===== 7) FORGE EQUIPMENT: equip derives new stats; unequip reverts =====
    this.init(); s = this.state;
    const base = ForgeEquipment.getActiveStats(CONFIG.baseShip).fuelMax;
    const cell = ForgeItemSystem.generateItem("fuel_cell", "elite", { rng: rnd });
    const eq = ForgeEquipment.equip(0, cell); if (!eq.ok) throw new Error("equip fuel_cell failed: " + eq.reason);
    this.recomputeDerived();
    if (!(s.derived.fuelMax > base)) throw new Error("equip did not raise fuelMax: " + s.derived.fuelMax + " vs " + base);
    ForgeEquipment.unequip(eq.index); this.recomputeDerived();
    if (Math.abs(s.derived.fuelMax - base) > 1e-6) throw new Error("unequip did not revert fuelMax");

    // ===== 8) FORGE EQUIPMENT SKILLS: tickSkills fires skill_fn on cooldown =====
    this.init(); s = this.state; s.aliens = []; s.x = 0; s.y = 9000; s.vx = s.vy = 0;
    const regen = ForgeItemSystem.generateItem("shield_regen_module", "normal", { rng: rnd });
    const cd = regen.skill.cooldown_ms, amt = regen.skill.regen_amount;
    const er = ForgeEquipment.equip(0, regen); if (!er.ok) throw new Error("equip skill failed: " + er.reason);
    if (!ForgeEquipment.activateSkill(0).ok) throw new Error("activateSkill failed");
    s.hp.shield = 5; const sh0 = s.hp.shield;
    const shipState = { shield: s.hp.shield, shieldMax: s.hp.shieldMax, armor: s.hp.armor, armorMax: s.hp.armorMax, hull: s.hp.hull, hullMax: s.hp.hullMax, fuel: s.fuel, fuelMax: s.fuelMax };
    let fired = [];
    for (let i = 0; i < Math.ceil(cd / 16.7) + 3 && !fired.length; i++) fired = fired.concat(ForgeEquipment.tickSkills(20, shipState));
    if (!fired.length) throw new Error("tickSkills never fired skill_fn");
    if (!(shipState.shield > sh0)) throw new Error("skill_fn did not regen shield: " + shipState.shield);
    if (Math.abs(shipState.shield - Math.min(s.hp.shieldMax, sh0 + amt)) > 1e-6) throw new Error("skill regen amount wrong: " + shipState.shield);
    // and via the game wrapper
    this.init(); s = this.state; s.aliens = []; s.x = 0; s.y = 9000; s.vx = s.vy = 0;
    ForgeEquipment.equip(0, ForgeItemSystem.generateItem("shield_regen_module", "normal", { rng: rnd }));
    ForgeEquipment.activateSkill(0); s.hp.shield = 5;
    for (let i = 0; i < 260; i++) step();
    if (!(s.hp.shield > 5)) throw new Error("game tickSkills did not regen: " + s.hp.shield);

    // ===== 9) FORGE COMBAT: lock-on returns true in range; completes; weapon fires =====
    this.init(); s = this.state; s.aliens = []; s.x = 0; s.y = 0; s.vx = s.vy = 0;
    ForgeCombat.clearLock();
    const foe = ForgeFaction.generateAlienShip("krag", "normal", { rng: rnd, x: 300, y: 0 }); s.aliens = [foe];
    const lockScreen = this.SF(foe.x, foe.y);
    const kind = this.resolveTap(lockScreen.x, lockScreen.y);   // tap alien in scan range → lock
    if (kind !== "lock") throw new Error("tap did not lock alien: " + kind);
    if (ForgeCombat.getLock().targetId !== foe.id) throw new Error("lock target not set");
    // ForgeCombat.lockOn direct contract
    if (ForgeCombat.lockOn(foe, { x: s.x, y: s.y, scanRange: s.derived.scanRange, targets: s.aliens }) !== true) throw new Error("ForgeCombat.lockOn should return true in range");
    if (ForgeCombat.lockOn(foe, { x: s.x, y: s.y, scanRange: 10, targets: s.aliens }) !== false) throw new Error("lockOn should return false out of range");
    ForgeCombat.lockOn(foe, { x: s.x, y: s.y, scanRange: s.derived.scanRange, targets: s.aliens });
    for (let i = 0; i < 40; i++) ForgeCombat.updateProjectiles(1 / 60);
    if (!ForgeCombat.isLocked()) throw new Error("lock did not complete");
    // weapon fire damages the locked alien (forced-hit rng for determinism)
    const wpn = ForgeItemSystem.generateItem("cannon", "elite", { rng: rnd });
    const foeHpBefore = foe.hp.shield + foe.hp.armor + foe.hp.hull;
    const shot = ForgeCombat.fireWeapon(wpn, foe, s.aliens, { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg, fireRate: 1, fuel: 999, fuelCostK: 1 }, { rng: () => 0.5 });
    if (!shot.ok || !shot.hit) throw new Error("forced weapon shot missed: " + JSON.stringify(shot.reason));
    if (!(foe.hp.shield + foe.hp.armor + foe.hp.hull < foeHpBefore)) throw new Error("weapon fire did not damage alien");
    // smoke-test the game-side firing path (weapon must be toggled active to fire; must not throw)
    ForgeEquipment.equip(0, wpn); ForgeEquipment.activateSkill(0); this.recomputeDerived(); s.weaponCd = 0; this.tryFireWeapon(1 / 60);

    // ===== 10) FORGE WORLD: updateDiscovery triggers at the correct radius =====
    this.init(); s = this.state;
    const d0 = ForgeWorld.getState().discovered;
    const st1 = ForgeWorld.getStations().find(x => !x.discovered);
    s.x = st1.pos.x + 1200; s.y = st1.pos.y;                    // >800 away → no discovery
    ForgeWorld.updateDiscovery({ x: s.x, y: s.y });
    if (ForgeWorld.getState().discovered !== d0) throw new Error("discovered too far (>800)");
    s.x = st1.pos.x + 400; s.y = st1.pos.y;                     // ≤800 → discovers
    ForgeWorld.updateDiscovery({ x: s.x, y: s.y });
    if (ForgeWorld.getState().discovered !== d0 + 1) throw new Error("did not discover within 800");
    if (!st1.discovered) throw new Error("station not flagged discovered");

    // ===== 11) FORGE STORE: buy needs credits, deducts price, moves item to cargo; sell refunds =====
    this.init(); s = this.state;
    const store = ForgeWorld.getStations()[0];
    ForgeStore.openStore(store, s, {});
    if (!store.stock.length) throw new Error("store not stocked");
    const item0 = store.stock[0], price = ForgeStore.buyPrice(item0);
    s.credits = price - 1; const bad = ForgeStore.buyItem(0, s); if (bad.success) throw new Error("bought without funds");
    s.credits = price + 20; const invN = s.inventory.length;
    const buy = ForgeStore.buyItem(0, s); if (!buy.success) throw new Error("buy failed: " + buy.reason);
    if (s.inventory.length !== invN + 1) throw new Error("bought item not delivered");
    if (s.credits !== 20) throw new Error("price not deducted: " + s.credits);
    const sold = s.inventory[s.inventory.length - 1], cr0 = s.credits;
    ForgeStore.sellItem(sold, s);
    if (!(s.credits > cr0)) throw new Error("sell did not refund");
    ForgeStore.closeStore();

    // ===== 12) FORGE FACTION: group formation (leader + minions) + AI progression =====
    this.init(); s = this.state;
    const grp = ForgeFaction.generateGroup("vex", { x: 20000, y: 0 }, { rng: rnd });
    if (!grp.leader || !grp.leader.isLeader) throw new Error("group has no leader");
    if (grp.followers.length < 2) throw new Error("group too small");
    if (grp.followers.some(f => f.groupId !== grp.leader.groupId)) throw new Error("group ids mismatch");
    const alien = grp.leader, hp0 = alien.hp.hull;
    ForgeFaction.activateGroup(alien, [alien, ...grp.followers]);
    const pStub = { x: alien.x + 100, y: alien.y, hp: { shield: 200, shieldMax: 200, armor: 100, armorMax: 100, hull: 100, hullMax: 100, res: { shield: 0, armor: 0, hull: 0 }, _sinceHit: 99 }, nebulae: [] };
    let moved = false; const ax0 = alien.x, ay0 = alien.y;
    for (let i = 0; i < 120; i++) { ForgeFaction.updateAlienAI(alien, pStub, [alien, ...grp.followers], 1 / 60); if (alien.x !== ax0 || alien.y !== ay0) moved = true; }
    if (!moved) throw new Error("alien AI never moved");

    // ===== 13) FORGE NPC: reputation events move rep; canDock allowed with fee/status =====
    this.init(); s = this.state;
    const sid = ForgeWorld.getStations()[0].id;
    const r0 = ForgeNPC.getReputation(sid);
    ForgeNPC.updateReputation(sid, "sell");
    if (!(ForgeNPC.getReputation(sid) > r0)) throw new Error("sell did not raise reputation");
    const dock = ForgeNPC.canDock(sid);
    if (!dock.allowed) throw new Error("canDock should always allow");
    ForgeNPC.updateReputation(sid, "kill_miner"); ForgeNPC.updateReputation(sid, "kill_miner"); ForgeNPC.updateReputation(sid, "kill_miner");
    if (ForgeNPC.getStatus(sid).status !== "outlaw" && ForgeNPC.getStatus(sid).status !== "hostile") throw new Error("rep did not drop with kills: " + ForgeNPC.getStatus(sid).status);

    // ===== 14) BURST engine: hold charges, release fires one impulse + fuel =====
    this.init(); s = this.state; s.aliens = []; s.planets = []; s.miners = []; s.rocks.length = 0; s.rockFree = []; s.junkFree = []; s.fields = []; s.outposts = []; s.junk.length = 0; s.mode = "burst"; s.x = 0; s.y = 9000; s.vx = s.vy = 0; s.fuel = 100;
    input.ax = 1; input.ay = 0;
    for (let i = 0; i < 150; i++) step();
    if (Math.abs(s.charge - 1) > 0.03) throw new Error("burst charge accum: " + s.charge);
    if (s.vx > 1) throw new Error("burst thrust before release");
    const bf0 = s.fuel; input.ax = 0; step();
    if (!(s.vx > 380 && s.vx <= CONFIG.impulse * (s.derived.thrust / 100) + 1)) throw new Error("burst impulse: " + s.vx);
    if (Math.abs(bf0 - s.fuel - CONFIG.burstCost) > 0.6) throw new Error("burst fuel cost: " + (bf0 - s.fuel));
    if (s.charge !== 0 || s.holdT !== 0) throw new Error("burst not reset");
    s.mode = "constant";

    // ===== 15) FULL LOOP: fly → grab → tow home → auto-bank ore =====
    this.init(); s = this.state; s.aliens = []; s.hp.shield = 100;
    const flyTo = (target, cond, maxF) => {
      let f = 0;
      while (f < maxF) {
        if (cond()) { input.ax = input.ay = 0; step(); return true; }
        const dx = target.x - s.x, dy = target.y - s.y, d = Math.hypot(dx, dy) || 1, wv = Math.min(200, Math.max(40, d * 0.9));
        const dvx = dx / d * wv - s.vx, dvy = dy / d * wv - s.vy, need = Math.hypot(dvx, dvy);
        if (need > 25) { input.ax = dvx / need; input.ay = dvy / need; } else { input.ax = input.ay = 0; }
        step(); f++;
        s.encounters.length = 0;   // isolate the haul from random ambushes (same idea as s.aliens = [])
      }
      input.ax = input.ay = 0; return cond();
    };
    const rock0 = s.rocks[0];
    rock0.x = s.x; rock0.y = s.y - 1200;
    if (!flyTo(rock0, () => this.shipTo(rock0) < s.derived.tractorRange, 5000)) throw new Error("never reached tutorial rock");
    this.grabTow("rocks", 0); step();
    if (s.tows.length !== 1) throw new Error("tractor grab failed");
    const home = this.homeStationObj();
    if (!flyTo({ x: home.pos.x, y: home.pos.y }, () => s.atStation, 9000)) throw new Error("never reached home station");
    if (s.tows.length !== 0) throw new Error("haul not auto-banked");
    if (!s.ore.junk || s.ore.junk.count !== 1) throw new Error("ore not auto-stored: " + JSON.stringify(s.ore));

    // ===== 16) SELL ore + TRADE NETWORK WIN =====
    this.init(); s = this.state;
    s.ore.platinum = { count: 6, bonus: false }; s.dockStationId = 0;
    const purse = s.credits;
    const sale = this.sellAllOre();
    if (!(sale > 0) || s.credits !== purse + sale) throw new Error("ore sell failed");
    // trade network: not complete until all stations discovered + warp-gated
    this.checkWin(); if (s.tradeNetworkComplete) throw new Error("trade network complete too early");
    const sts16 = ForgeWorld.getStations();
    for (const st of sts16) { st.discovered = true; st.warpActive = true; }
    this.checkWin();
    if (!s.tradeNetworkComplete) throw new Error("trade network should be complete");
    if (s.credits !== purse + sale + CONFIG.tradeNetworkBonus) throw new Error("trade network bonus not awarded");

    // ===== 17) DEFEAT → respawn at home (no permadeath), −100cr =====
    this.init(); s = this.state; s.aliens = []; s.credits = 250;
    s.x = 5000; s.y = 5000; s.hp.shield = 0; s.hp.armor = 0; s.hp.hull = 3; s.invuln = 0;
    this.onShipDestroyed();
    const home2 = this.homeStationObj();
    if (s.dead) throw new Error("defeat should not be permadeath");
    if (Math.hypot(s.x - home2.pos.x, s.y - home2.pos.y) > 250) throw new Error("did not respawn home");
    if (s.hp.hull !== s.hp.hullMax) throw new Error("hull not restored on respawn");
    if (s.credits !== 150) throw new Error("defeat penalty wrong: " + s.credits);

    // ===== 17b) ENCOUNTERS: init empty · spawn ring + cap · every type triggers =====
    this.init(); s = this.state;
    if (!Array.isArray(s.encounters) || s.encounters.length) throw new Error("encounters not empty on init");
    s.aliens = []; s.x = 0; s.y = 40000; s.atStation = false;   // clear of every station
    for (let i = 0; i < 10; i++) this.spawnEncounter(s);
    if (s.encounters.length > 5) throw new Error("encounter cap exceeded: " + s.encounters.length);
    if (s.encounters.length !== 5) throw new Error("open-space spawns should fill the cap: " + s.encounters.length);
    for (const e of s.encounters) {
      const d = this.dist(s.x, s.y, e.x, e.y);
      if (d < 650 || d > 2200) throw new Error("encounter spawn distance: " + d);
      if (e.life < 120 || e.life > 180) throw new Error("encounter life range: " + e.life);
      if (e.resolved) throw new Error("encounter should spawn unresolved");
      for (const st of ForgeWorld.getStations())
        if (this.dist(e.x, e.y, st.pos.x, st.pos.y) < 600) throw new Error("encounter spawned inside station keep-out");
    }
    s.encounters.length = 0;
    // each type: triggerEncounter resolves + fires the right side effects
    // Position in the 0-40° danger-8 wedge so squad-size assertions (≥3, ≥6) are always met
    const mkEnc = (type) => ({ id: 900 + this._nextEncId++, type, x: 60000, y: 1000, life: 150, resolved: false, vx: 0, vy: 0, data: {} });
    let encT = mkEnc("pirate_ambush"), a0 = s.aliens.length;
    this.triggerEncounter(encT, s);
    if (!encT.resolved) throw new Error("pirate_ambush not resolved");
    if (s.aliens.length < a0 + 3) throw new Error("pirate_ambush spawned no squad");
    if (!s.aliens.slice(a0).every(a => a.faction === "nox")) throw new Error("pirates must be nox");
    this.triggerEncounter(encT, s);   // resolved encounters are inert
    if (s.aliens.slice(a0).length > 5) throw new Error("re-trigger should be a no-op");
    encT = mkEnc("faction_battle"); a0 = s.aliens.length;
    this.triggerEncounter(encT, s);
    const battle = s.aliens.slice(a0);
    if (battle.length < 6) throw new Error("faction_battle should spawn two squads: " + battle.length);
    if (!(battle.some(a => a.faction === "vex") && battle.some(a => a.faction === "krag"))) throw new Error("faction_battle needs vex + krag");
    encT = mkEnc("derelict"); const l0 = s.loot.length;
    this.triggerEncounter(encT, s);
    const salvage = s.loot.slice(l0);
    if (salvage.length < 4 || salvage.length > 7) throw new Error("derelict loot count: " + salvage.length);
    if (!salvage.every(L => L.item && (L.item.tier === "rare" || L.item.tier === "unique"))) throw new Error("derelict loot must be Rare/Unique");
    encT = mkEnc("distress_signal"); a0 = s.aliens.length; const l1 = s.loot.length;
    this.triggerEncounter(encT, s);
    if (s.aliens.length < a0 + 3) throw new Error("distress_signal spawned no hostiles");
    if (!s.aliens.slice(a0).every(a => a.faction === "krag")) throw new Error("distress hostiles must be krag");
    if (s.loot.length - l1 < 2 || s.loot.length - l1 > 3) throw new Error("distress loot count: " + (s.loot.length - l1));
    // update loop: approach (<450) triggers, then the resolved event is culled; expiry despawns
    s.aliens = [];
    const near = { id: 9001, type: "derelict", x: s.x + 300, y: s.y, life: 150, resolved: false, vx: 0, vy: 0, data: {} };
    s.encounters.push(near); step();
    if (!near.resolved) throw new Error("approach did not trigger encounter");
    step();
    if (s.encounters.includes(near)) throw new Error("resolved encounter not culled");
    const stale = { id: 9002, type: "derelict", x: s.x + 5000, y: s.y, life: 0.001, resolved: false, vx: 0, vy: 0, data: {} };
    s.encounters.push(stale); step();
    if (s.encounters.includes(stale)) throw new Error("expired encounter not despawned");

    // ===== 17c) ENEMY BASES: patrol timer · damage · destroy → elite loot, spawning stops =====
    this.init(); s = this.state; s.x = 0; s.y = 9000; s.vx = s.vy = 0;
    s.outposts = [];   // alien-count assertions below — keep outpost guards out of s.aliens
    const eb = s.enemyBases[0];
    ForgeCombat.applyDamage(eb, 0, 0, 40);
    if (!(eb.hp.hull < eb.maxHp)) throw new Error("enemy base did not take damage");
    if (ForgeCombat.lockOn(eb, { x: eb.x - 500, y: eb.y, scanRange: 900 }) !== true) throw new Error("lockOn enemy base failed");
    ForgeCombat.clearLock();
    let alienN = s.aliens.length;
    eb.spawnTimer = 0.001; step();
    if (s.aliens.length !== alienN + 3) throw new Error("base patrol should add 1 elite + 2 normals: +" + (s.aliens.length - alienN));
    const pat = s.aliens.slice(-3);
    if (!pat.some(a => a.isLeader && a.tier === "elite")) throw new Error("patrol missing elite leader");
    if (pat.some(a => a._baseId !== eb.id || a.faction !== eb.faction)) throw new Error("patrol not tagged to its base");
    if (Math.abs(eb.spawnTimer - eb.spawnCooldown) > 0.1) throw new Error("spawn timer did not reset");
    const lootN = s.loot.length;
    eb.hp.hull = 0; step();
    if (!eb.destroyed) throw new Error("base not marked destroyed at 0 hull");
    const dropped = s.loot.length - lootN;
    if (dropped < CONFIG.enemyBaseDropMin || dropped > CONFIG.enemyBaseDropMax) throw new Error("base should drop 3–5 items: " + dropped);
    if (!s.loot.slice(lootN).every(L => L.item.tier === "elite")) throw new Error("base drops must be Elite tier");
    if (!toasts.some(t => t.text === "ENEMY BASE DESTROYED")) throw new Error("destroy toast missing");
    alienN = s.aliens.length;
    eb.spawnTimer = 0.001; step(); step();
    if (s.aliens.length !== alienN) throw new Error("destroyed base must not keep spawning");

    // ===== 17d) PHASE 3 DRONES: refinery · launch · travel · pirate checks =====
    this.init(); s = this.state;
    if (!Array.isArray(s.drones) || s.drones.length) throw new Error("drones not empty on init");
    if (!s.refinedBars || typeof s.refinedBars !== "object" || Object.keys(s.refinedBars).length) throw new Error("refinedBars not initialized empty");
    // refinery: 6 copper ore → 3 bars (2:1, floor), ore fully consumed; odd ore stays raw
    s.ore.copper = { count: 6, bonus: false };
    this.refineAllOre();
    if (s.refinedBars.copper !== 3) throw new Error("refine: want 3 copper bars, got " + s.refinedBars.copper);
    if (s.ore.copper) throw new Error("refine did not consume the copper ore");
    s.ore.silver = { count: 5, bonus: false }; this.refineAllOre();
    if (s.refinedBars.silver !== 2 || !s.ore.silver || s.ore.silver.count !== 1) throw new Error("refine floor/remainder: " + s.refinedBars.silver + "/" + JSON.stringify(s.ore.silver));
    // launch: tier 0 = 25cr + 2 copper bars; destination = another DISCOVERED station
    const stD = ForgeWorld.getStations()[1];
    ForgeWorld.updateDiscovery({ x: stD.pos.x, y: stD.pos.y });   // reveal a destination
    s.dockStationId = 0; s.credits = 10;
    if (this.launchDrones(0, 1, false).ok) throw new Error("launched without credits");
    s.credits = 100;
    const lr = this.launchDrones(0, 1, false);
    if (!lr.ok) throw new Error("launch failed: " + lr.reason);
    if (s.credits !== 75) throw new Error("launch credit deduction: " + s.credits);
    if (s.refinedBars.copper !== 1) throw new Error("launch bar deduction: " + s.refinedBars.copper);
    if (s.drones.length !== 1) throw new Error("drone not pushed to s.drones");
    const dr = s.drones[0];
    if (dr.fromId !== 0 || dr.toId === 0 || dr.tier !== 0 || dr.payout !== 125) throw new Error("drone fields: " + JSON.stringify([dr.fromId, dr.toId, dr.tier, dr.payout]));
    if (dr.hp !== 40 || dr.shield !== 20 || dr.fuel !== 80 || Math.abs(dr.successRate - 0.72) > 1e-9) throw new Error("tier-0 stat block");
    if (!dr.loadout.length || dr.loadout[0].type !== "weapon") throw new Error("tier-0 loadout");
    // travel: progress → 1 arrives + pays out exactly once
    dr.pirateClock = 9999; dr.progress = 0.999; dr.travelTime = 4;
    const cr1 = s.credits;
    this.updateDrones(0.1, s);
    if (!dr.arrived || dr.progress < 1) throw new Error("drone did not arrive at progress 1");
    if (s.credits !== cr1 + 125) throw new Error("arrival payout: " + (s.credits - cr1));
    this.updateDrones(0.1, s);
    if (s.credits !== cr1 + 125) throw new Error("payout credited twice");
    // pirate: forced ambush — successRate 1 survives with chip damage, 0 destroys on the first event
    s.refinedBars.copper = 2;
    const lr2 = this.launchDrones(0, 1, false);
    if (!lr2.ok) throw new Error("second launch failed: " + lr2.reason);
    const d2 = s.drones[s.drones.length - 1];
    d2.pirateClock = 9999;
    d2.piratePending = true; d2.pirateTimer = 0.5; d2.successRate = 1;
    const hp0d = d2.hp + d2.shield;
    for (let k = 0; k < 30; k++) this.updateDrones(1 / 30, s);
    if (d2.destroyed) throw new Error("successRate-1 drone must survive its pirate event");
    if (!(d2.hp + d2.shield < hp0d)) throw new Error("pirate fight dealt no damage");
    if (d2.piratePending) throw new Error("piratePending did not clear");
    if (d2.pirateEvents !== 1) throw new Error("pirate event not counted");
    d2.pirateEvents = 0; d2.successRate = 0; d2.piratePending = true; d2.pirateTimer = 0.1;
    const cr2 = s.credits;
    for (let k = 0; k < 8; k++) this.updateDrones(1 / 30, s);
    if (!d2.destroyed) throw new Error("successRate-0 drone must be destroyed on its first pirate event");
    for (let k = 0; k < 40; k++) this.updateDrones(1 / 30, s);   // ride out the 0.5s red-flash window
    if (s.drones.includes(d2)) throw new Error("destroyed drone not culled after flash");
    if (s.credits !== cr2) throw new Error("destroyed drone must not pay out");

    // ===== 17e) PHASE 4 CONTRACTS: board generation bands · strike kills · salvage ·
    // escort arrive/die · bounty flagship · defense waves · turn-in =====
    this.init(); s = this.state;
    if (!Array.isArray(s.contracts) || s.contracts.length || s.escorts.length) throw new Error("contracts not empty on init");
    if (!s.stationContracts || Object.keys(s.stationContracts).length) throw new Error("station boards not empty on init");
    // generation: 3 distance bands → difficulty 1/2/3, reward ranges, rough type weights
    const bandSt = [{ id: 101, name: "Near", pos: { x: 800, y: 0 } },
                    { id: 102, name: "Mid", pos: { x: 2500, y: 0 } },
                    { id: 103, name: "Far", pos: { x: 4800, y: 0 } }];
    const typeCount = {}; let totalC = 0;
    for (let rep = 0; rep < 60; rep++) for (let bi = 0; bi < 3; bi++) {
      const list = this.generateStationContracts(bandSt[bi], s);
      if (list.length < 3 || list.length > 4) throw new Error("contracts per dock: " + list.length);
      if (s.stationContracts[bandSt[bi].id] !== list) throw new Error("board not stored by stationId");
      for (const c of list) {
        totalC++; typeCount[c.type] = (typeCount[c.type] || 0) + 1;
        if (c.difficulty !== bi + 1) throw new Error("difficulty band: " + c.difficulty + " at dist " + bandSt[bi].pos.x);
        const rr = CONTRACTS.rewards[c.difficulty];
        if (c.reward < rr[0] || c.reward > rr[1]) throw new Error("reward range: " + c.reward + " at diff " + c.difficulty);
        if (c.status !== "available" || c.stationId !== bandSt[bi].id) throw new Error("new contract state");
        if (c.type === "salvage" && c.amountNeeded !== c.difficulty * 2) throw new Error("salvage amount: " + c.amountNeeded);
        if ((c.type === "faction_strike" || c.type === "pirate_clear") && !(c.killsNeeded > 0 && c.killsDone === 0)) throw new Error("kill fields missing");
        if (c.type === "pirate_clear" && c.targetFaction !== "nox") throw new Error("pirates must be nox");
        if (c.type === "escort" && (c.targetStationId == null || c.targetStationId === bandSt[bi].id)) throw new Error("escort target station");
        if (c.type === "defense" && (c.raidNeeded < 2 || c.raidNeeded > 3)) throw new Error("defense waves: " + c.raidNeeded);
      }
    }
    for (const tp of CONTRACTS.types) {
      const frac = (typeCount[tp.type] || 0) / totalC;
      if (Math.abs(frac - tp.w) > 0.10) throw new Error("type weight off: " + tp.type + " " + frac.toFixed(2) + " vs " + tp.w);
    }
    delete s.stationContracts[101]; delete s.stationContracts[102]; delete s.stationContracts[103];
    const mkC = (over) => Object.assign({
      id: 9000 + this._nextContractId++, type: "faction_strike", title: "T", description: "t", reward: 300,
      stationId: 0, difficulty: 1, targetFaction: null, killsNeeded: null, killsDone: null,
      targetStationId: null, escortNpcId: null, amountNeeded: null, amountDone: null,
      targetKilled: null, targetId: null, raidWave: null, raidDone: null, raidNeeded: null,
      status: "available", expiresAt: null }, over);
    // faction_strike: accept (1-slot rule) → 5 kills → complete → turn in for the reward
    const strike = mkC({ title: "STRIKE: VEX", targetFaction: "vex", killsNeeded: 5, killsDone: 0 });
    s.stationContracts[0] = [strike];
    if (!this.acceptContract(strike)) throw new Error("accept failed");
    if (s.contracts.length !== 1 || strike.status !== "active") throw new Error("accept state");
    if (this.acceptContract(mkC({}))) throw new Error("second accept must be blocked (slot full)");
    for (let i = 0; i < 5; i++) this.onContractKill({ id: "fake" + i, faction: i === 2 ? "krag" : "vex" });
    if (strike.killsDone !== 4) throw new Error("off-faction kill counted: " + strike.killsDone);
    this.onContractKill({ id: "fake9", faction: "vex" });
    if (strike.status !== "complete" || strike.killsDone !== 5) throw new Error("strike not complete: " + strike.status + "/" + strike.killsDone);
    if (!toasts.some(t => t.text === "CONTRACT COMPLETE: " + strike.title)) throw new Error("complete toast missing");
    if (this.turnInContract(strike)) throw new Error("turn-in must require docking at the issuer");
    s.docked = true; s.dockStationId = 0;
    const crBefore = s.credits;
    if (!this.turnInContract(strike)) throw new Error("turn-in failed");
    if (s.credits !== crBefore + strike.reward) throw new Error("reward not credited: " + s.credits);
    if (s.contracts.length) throw new Error("turned-in contract not removed");
    s.docked = false;
    // salvage: only Rare+ items advance the count
    const sal = mkC({ type: "salvage", title: "SALVAGE RUN", amountNeeded: 2, amountDone: 0 });
    s.stationContracts[0] = [sal];
    if (!this.acceptContract(sal)) throw new Error("salvage accept failed");
    this.onContractItem({ tier: "normal" });
    if (sal.amountDone !== 0) throw new Error("normal item must not count");
    this.onContractItem({ tier: "rare" }); this.onContractItem({ tier: "elite" });
    if (sal.status !== "complete" || sal.amountDone !== 2) throw new Error("salvage not complete: " + sal.amountDone);
    s.contracts.length = 0;
    // escort: NPC spawns at the issuer and arrival at the target station completes…
    s.aliens = [];
    const stA = ForgeWorld.getStations()[0], stB = ForgeWorld.getStations()[1];
    const esc1 = mkC({ type: "escort", title: "ESCORT: TEST", stationId: stA.id, targetStationId: stB.id });
    s.stationContracts[stA.id] = [esc1];
    if (!this.acceptContract(esc1)) throw new Error("escort accept failed");
    if (s.escorts.length !== 1 || esc1.escortNpcId !== s.escorts[0].id) throw new Error("escort NPC not spawned");
    if (this.dist(s.escorts[0].x, s.escorts[0].y, stA.pos.x, stA.pos.y) > 200) throw new Error("escort must spawn at the issuer");
    s.escorts[0].x = stB.pos.x + 80; s.escorts[0].y = stB.pos.y;   // teleport to the doorstep
    this.updateContracts(1 / 60);
    if (esc1.status !== "complete") throw new Error("escort arrival should complete: " + esc1.status);
    if (s.escorts.length) throw new Error("arrived escort should despawn");
    s.contracts.length = 0;
    // …and the freighter dying fails the contract + frees the slot
    const esc2 = mkC({ type: "escort", title: "ESCORT: TEST2", stationId: stA.id, targetStationId: stB.id });
    s.stationContracts[stA.id] = [esc2];
    if (!this.acceptContract(esc2)) throw new Error("escort2 accept failed");
    const eNpc = s.escorts[0];
    eNpc.hp.shield = 0; eNpc.hp.armor = 0; eNpc.hp.hull = 0;
    this.updateContracts(1 / 60);
    if (esc2.status !== "failed") throw new Error("dead escort should fail: " + esc2.status);
    if (s.contracts.length || s.escorts.length) throw new Error("failed escort should clear slot + npc");
    if (!toasts.some(t => t.text.indexOf("CONTRACT FAILED") === 0)) throw new Error("fail toast missing");
    // bounty (difficulty 3): flagship + 5 guards, 3× hp named lead; killing the lead completes
    const alienN0 = s.aliens.length;
    const bty = mkC({ type: "bounty", title: "BOUNTY: Krag Warchief Dorn", difficulty: 3,
      targetFaction: "krag", targetName: "Krag Warchief Dorn", targetKilled: false });
    s.stationContracts[0] = [bty];
    if (!this.acceptContract(bty)) throw new Error("bounty accept failed");
    if (s.aliens.length !== alienN0 + 6) throw new Error("flagship group should be lead + 5 guards: +" + (s.aliens.length - alienN0));
    const lead = s.aliens.find(a => a.id === bty.targetId);
    if (!lead || !lead._flagship || lead.name !== "Krag Warchief Dorn") throw new Error("bounty lead wrong");
    if (!(lead.hp.hullMax >= 240 && lead.hp.hull === lead.hp.hullMax)) throw new Error("bounty lead should carry 3× hp: " + lead.hp.hullMax);
    this.onContractKill(s.aliens.find(a => a !== lead && a.faction === "krag"));   // guards don't count
    if (bty.targetKilled) throw new Error("guard kill must not complete a bounty");
    this.onContractKill(lead);
    if (!bty.targetKilled || bty.status !== "complete") throw new Error("bounty kill should complete");
    s.contracts.length = 0; s.aliens = [];
    // defense: wave 1 on accept (difficulty×3 ships) → clear → wave 2 → clear → complete
    const def = mkC({ type: "defense", title: "STATION DEFENSE", raidNeeded: 2, raidWave: 0, raidDone: 0 });
    s.stationContracts[0] = [def];
    if (!this.acceptContract(def)) throw new Error("defense accept failed");
    if (def.raidWave !== 1 || def.raidHp !== CONTRACTS.defenseHp) throw new Error("wave 1 should spawn on accept");
    let raiders = s.aliens.filter(a => a._contractId === def.id);
    if (raiders.length !== 3) throw new Error("wave size should be difficulty×3: " + raiders.length);
    for (const r of raiders) { r.hp.hull = 0; this.onAlienKilled(r); }
    this.updateContracts(1 / 60);
    if (def.raidWave !== 2 || def.raidDone !== 1) throw new Error("wave 2 should spawn after a clear: " + def.raidWave + "/" + def.raidDone);
    raiders = s.aliens.filter(a => a._contractId === def.id);
    for (const r of raiders) { r.hp.hull = 0; this.onAlienKilled(r); }
    this.updateContracts(1 / 60);
    if (def.status !== "complete" || def.raidDone !== 2) throw new Error("defense should complete after the final wave");
    s.contracts.length = 0; s.aliens = []; s.loot.length = 0;
    // …and an emptied station HP pool fails it
    const def2 = mkC({ type: "defense", title: "STATION DEFENSE", raidNeeded: 2, raidWave: 0, raidDone: 0 });
    s.stationContracts[0] = [def2];
    if (!this.acceptContract(def2)) throw new Error("defense2 accept failed");
    def2.raidHp = 0;
    this.updateContracts(1 / 60);
    if (def2.status !== "failed") throw new Error("overrun station should fail the contract");
    if (s.contracts.length) throw new Error("failed defense should free the slot");
    s.aliens = []; s.escorts.length = 0;

    // ===== 17f) PHASE 6: NPC traders spawn/travel/flip · piracy loot + rep · galaxy map =====
    this.init(); s = this.state;
    if (!Array.isArray(s.npcTraders)) throw new Error("npcTraders missing from state");
    if (s.npcTraders.length < NPC_TRADERS.countMin || s.npcTraders.length > NPC_TRADERS.countMax)
      throw new Error("trader count: " + s.npcTraders.length);
    const trStIds = ForgeWorld.getStations().map(st => st.id);
    for (const t of s.npcTraders) {
      if (t.type !== "trader" || t.dead) throw new Error("trader init flags");
      if (!trStIds.includes(t.fromId) || !trStIds.includes(t.toId) || t.fromId === t.toId)
        throw new Error("trader route ids: " + t.fromId + "→" + t.toId);
      if (!(t.progress >= 0 && t.progress < 1)) throw new Error("trader spawn progress: " + t.progress);
      if (t.speed !== NPC_TRADERS.speed || t.hp !== t.maxHp || t.shield !== t.maxShield) throw new Error("trader stat block");
      if (!Array.isArray(t.cargo) || t.cargo.length < 1 || t.cargo.length > 3) throw new Error("trader cargo: " + JSON.stringify(t.cargo));
      if (t.credits < NPC_TRADERS.creditsMin || t.credits > NPC_TRADERS.creditsMax) throw new Error("trader credits: " + t.credits);
    }
    // travel: progress advances by speed/dist; hitting 1 flips the route (loops forever)
    s.aliens = [];   // keep ambient piracy rolls out of the math
    const tr0 = s.npcTraders[0], trFrom = tr0.fromId, trTo = tr0.toId;
    tr0.progress = 0.9999; this.updateNpcTraders(1, s);
    if (tr0.fromId !== trTo || tr0.toId !== trFrom) throw new Error("trader did not flip at progress 1");
    if (tr0.progress > 0.1) throw new Error("progress not reset on flip: " + tr0.progress);
    if (Math.abs(tr0.x - (tr0.fromX + (tr0.toX - tr0.fromX) * tr0.progress)) > 1e-6) throw new Error("trader x not synced to progress");
    // piracy: shield soaks first, kill drops a credit orb + cargo ore orbs + −10 rep nearby
    const vic = s.npcTraders[1], vicCr = vic.credits, vicCargo = vic.cargo.length;
    this._damageTrader(vic, 10, true);
    if (vic.dead || vic.shield !== vic.maxShield - 10 || vic.hp !== vic.maxHp) throw new Error("shield should soak first: " + vic.shield + "/" + vic.hp);
    const trLootN = s.loot.length, trRepSt = this.nearestStationInfo().station;
    const trRep0 = ForgeNPC.getReputation(trRepSt.id);
    if (!this.attackTrader(vic, 99999)) throw new Error("piracy kill failed");
    if (!vic.dead) throw new Error("trader not flagged dead");
    if (s.loot.length !== trLootN + 1 + vicCargo) throw new Error("trader loot drop: +" + (s.loot.length - trLootN));
    if (!s.loot.slice(trLootN).some(L => L.credits === vicCr)) throw new Error("credit orb missing");
    if (!s.loot.slice(trLootN).some(L => NPC_TRADERS.cargoTypes.includes(L.ore))) throw new Error("cargo ore orbs missing");
    if (ForgeNPC.getReputation(trRepSt.id) !== trRep0 + NPC_TRADERS.repPenalty)
      throw new Error("piracy rep penalty: " + ForgeNPC.getReputation(trRepSt.id));
    if (!toasts.some(t => t.text.indexOf("Pirate!") === 0)) throw new Error("piracy toast missing");
    for (let k = 0; k < 40; k++) this.updateNpcTraders(1 / 30, s);
    if (s.npcTraders.includes(vic)) throw new Error("dead trader not culled after flash");
    // credit orb pickup banks directly
    const trOrb = s.loot.find(L => L.credits);
    const trCr0 = s.credits; s.x = trOrb.x; s.y = trOrb.y;
    this.updateLoot(1 / 60);
    if (s.credits !== trCr0 + vicCr) throw new Error("credit orb not banked: " + (s.credits - trCr0));
    // galaxy map: open pauses pilot input while the loop keeps ticking; close restores
    this.openGalaxyMap();
    if (!s.galaxyMapOpen) throw new Error("galaxy map did not open");
    input.ax = 1; input.ay = 0;
    for (let k = 0; k < 3; k++) step();   // must not throw with the map up
    if (s.thrusting || s.charge > 0.05) throw new Error("map must pause thrust input");
    input.ax = 0;
    this.closeGalaxyMap();
    if (s.galaxyMapOpen) throw new Error("galaxy map did not close");
    step();
    input.mapToggle = true; step();       // toggle path through update()
    if (!s.galaxyMapOpen) throw new Error("mapToggle did not open the map");
    input.mapToggle = true; step();
    if (s.galaxyMapOpen) throw new Error("mapToggle did not close the map");

    // ===== 17g) PHASE 5 FLEET: buildDrone · full cap · formation · combat AI ·
    // repair/retreat · remove · permanent death =====
    this.init(); s = this.state;
    if (!Array.isArray(s.playerFleet) || s.playerFleet.length) throw new Error("playerFleet not empty on init");
    s.dockStationId = 0; s.aliens = [];
    const mkCompanion = (tier) => {
      s.credits += 500;
      for (const m of DRONES.tiers[tier].materials) s.refinedBars[m.type] = (s.refinedBars[m.type] || 0) + m.n;
      const r = this.buildDrone(tier);
      if (!r.ok) throw new Error("buildDrone failed: " + r.reason);
      return r.drone;
    };
    const fd = mkCompanion(1);
    if (s.playerFleet[0] !== fd) throw new Error("drone did not enter playerFleet");
    if (fd.role !== "escort" || fd.formationIdx !== 0 || fd.state !== "follow" || fd.targetAlienId !== null || fd.tier !== 1)
      throw new Error("fleet fields: " + JSON.stringify([fd.role, fd.formationIdx, fd.state, fd.targetAlienId, fd.tier]));
    if (fd.offsetX !== -80 || fd.offsetY !== 0) throw new Error("slot-0 offset: " + fd.offsetX + "," + fd.offsetY);
    for (let k = 1; k < 3; k++) mkCompanion(0);
    if (s.playerFleet.length !== 3) throw new Error("fleet should hold 3: " + s.playerFleet.length);
    if (this.escorts(s).some((d, k) => d.formationIdx !== k)) throw new Error("formation indices not 0–2");
    // builds beyond the 3-slot escort wing overflow into the hangar until ownedMax, then block
    const four = this.buildDrone(0);   // (mkCompanion asserts ok — pay manually here)
    if (four.ok) throw new Error("4th build must fail unpaid");   // still gated on materials
    const hangDrones = [];
    for (let k = 3; k < DRONES.ownedMax; k++) hangDrones.push(mkCompanion(0));
    if (hangDrones.some(d => d.role !== "hangar")) throw new Error("overflow drones must wait in hangar");
    if (hangDrones.some(d => d.formationIdx !== null)) throw new Error("hangar drones must not hold formation slots");
    if (s.playerFleet.length !== DRONES.ownedMax) throw new Error("owned list should hold ownedMax: " + s.playerFleet.length);
    s.credits += 500; for (const m of DRONES.tiers[0].materials) s.refinedBars[m.type] = (s.refinedBars[m.type] || 0) + m.n;
    if (this.buildDrone(0).ok) throw new Error("build beyond ownedMax must be blocked");
    if (s.playerFleet.length !== DRONES.ownedMax) throw new Error("blocked build must not grow the owned list");
    // hangar drones are inert: updateFleet must not move them or tick their AI
    const hang1 = hangDrones[0];
    const hangX = hang1.x, hangY = hang1.y;
    this.updateFleet(0.5, s);
    if (hang1.x !== hangX || hang1.y !== hangY) throw new Error("hangar drone moved");
    // combat AI: alien within 300u → acquire + attack + one applyDamage volley
    const foeFl = ForgeFaction.generateAlienShip("vex", "normal", { rng: rnd, x: s.x + 200, y: s.y });
    s.aliens = [foeFl];
    fd.x = s.x + 50; fd.y = s.y; fd.wcd = 0;
    const foeHp0 = foeFl.hp.shield + foeFl.hp.armor + foeFl.hp.hull;
    this.updateFleet(0.016, s);
    if (fd.state !== "attack" || fd.targetAlienId !== foeFl.id) throw new Error("fleet did not acquire: " + fd.state);
    if (!(foeFl.hp.shield + foeFl.hp.armor + foeFl.hp.hull < foeHp0)) throw new Error("fleet weapon applyDamage not applied");
    if (!(fd.wcd > 0)) throw new Error("fleet weapon cooldown not set");
    // spread: a second drone prefers the un-targeted alien
    const foeFl2 = ForgeFaction.generateAlienShip("krag", "normal", { rng: rnd, x: s.x + 260, y: s.y });
    s.aliens.push(foeFl2);
    const fd2 = s.playerFleet[1];
    fd2.x = s.x + 40; fd2.y = s.y; fd2.state = "follow"; fd2.targetAlienId = null;
    this.updateFleet(0.016, s);
    if (fd2.targetAlienId !== foeFl2.id) throw new Error("fleet drones did not spread targets: " + fd2.targetAlienId);
    s.aliens = s.aliens.filter(a => a !== foeFl);
    this.updateFleet(0.016, s);
    if (fd.targetAlienId === foeFl.id) throw new Error("dead target not cleared");
    // repair: hp < 30% → repair state, Tier-1 Repair Bot ticks hull, > 80% resumes
    s.aliens = [];
    for (const d of s.playerFleet) { d.targetAlienId = null; d.state = "follow"; }
    fd.hp = fd.maxHp * 0.2; fd.shield = fd.maxShield;
    this.updateFleet(0.016, s);
    if (fd.state !== "repair" || fd.targetAlienId !== null) throw new Error("low hp should enter repair: " + fd.state);
    const hpR0 = fd.hp;
    for (let k = 0; k < 60; k++) this.updateFleet(1 / 60, s);
    if (!(fd.hp > hpR0)) throw new Error("repair module did not tick hull");
    fd.hp = fd.maxHp * 0.85; this.updateFleet(0.016, s);
    if (fd.state !== "follow") throw new Error("repaired drone should resume follow: " + fd.state);
    // retreat: shield 0 + hp < 50% → retreat; hp back over 50% leaves retreat
    fd.shield = 0; fd.hp = fd.maxHp * 0.4;
    this.updateFleet(0.016, s);
    if (fd.state !== "retreat") throw new Error("dry shield + low hull should retreat: " + fd.state);
    fd.hp = fd.maxHp * 0.6; this.updateFleet(0.016, s);
    if (fd.state === "retreat") throw new Error("recovered drone stuck in retreat");
    fd.shield = fd.maxShield; fd.hp = fd.maxHp;
    // formation following: converge on the heading-rotated slot, speed clamped
    fd.state = "follow"; fd.x = s.x + 600; fd.y = s.y; fd.vx = fd.vy = 0;
    const slotFl = this.fleetSlotPos(fd, s);
    if (Math.abs(slotFl.x - (s.x - 80)) > 1 || Math.abs(slotFl.y - s.y) > 1) throw new Error("slot-0 world pos: " + JSON.stringify(slotFl));
    const dSlot0 = this.dist(fd.x, fd.y, slotFl.x, slotFl.y);
    for (let k = 0; k < 300; k++) {
      this.updateFleet(1 / 60, s);
      if (Math.hypot(fd.vx, fd.vy) > FLEET.maxSpeed + 1e-6) throw new Error("fleet speed clamp broken: " + Math.hypot(fd.vx, fd.vy));
    }
    if (!(this.dist(fd.x, fd.y, slotFl.x, slotFl.y) < Math.min(60, dSlot0))) throw new Error("drone did not converge on its slot");
    // remove: companion dismissed, remaining escort slots re-pack
    if (!this.removeFromFleet(0)) throw new Error("fleet remove failed");
    if (s.playerFleet.length !== DRONES.ownedMax - 1) throw new Error("remove counts wrong: " + s.playerFleet.length);
    if (this.escorts(s).some((d, k) => d.formationIdx !== k)) throw new Error("formation not re-packed after remove");
    if (this.escorts(s).length !== 2) throw new Error("escort count after remove: " + this.escorts(s).length);
    // roles: escort ⇄ hangar transitions (docked-only), trade dispatch + return
    s.docked = true;
    const hangDr = s.playerFleet.find(d => d.role === "hangar");
    const hangIdx = s.playerFleet.indexOf(hangDr);
    if (!this.setDroneRole(hangIdx, "escort").ok) throw new Error("hangar→escort with a free slot must work");
    if (this.escorts(s).length !== 3) throw new Error("promotion should fill the wing");
    if (this.setDroneRole(s.playerFleet.indexOf(s.playerFleet.find(d => d.role === "hangar")), "escort").ok)
      throw new Error("4th escort must be blocked at the wing cap");
    // one-way trade run: dispatch to a chosen station, payout ∝ distance, and on
    // arrival the drone banks the payout and parks free in the bay (no return leg)
    s.docked = true;
    // all 8 outposts are tradeable even while UNCHARTED (follow the convoy to
    // discover them); the picker just flags the undiscovered ones. Prove it with
    // the spare hangar drone so the escort wing below is unaffected.
    const allStations = ForgeWorld.getStations();
    if (allStations.filter(st => !st.discovered).length < 1) throw new Error("test needs some undiscovered stations at init");
    const openDests = this.tradeDestinations();
    if (openDests.length !== allStations.length - 1) throw new Error("all stations minus origin must be tradeable regardless of discovery: " + openDests.length);
    const unchartedDest = openDests.find(dd => !dd.discovered);
    if (!unchartedDest) throw new Error("uncharted stations must appear as trade destinations");
    const spareHangar = s.playerFleet.find(d => d.role === "hangar");
    if (spareHangar) {
      if (!this.sendOnTradeRun(s.playerFleet.indexOf(spareHangar), unchartedDest.id).ok) throw new Error("dispatch to an uncharted station must succeed");
      if (ForgeWorld.getStations().find(st => st.id === unchartedDest.id).discovered) throw new Error("dispatching a drone must NOT auto-discover the destination");
    }
    ForgeWorld.getStations().forEach(st => { st.discovered = true; });
    const dests = this.tradeDestinations();
    if (!dests.length) throw new Error("trade destinations should list stations");
    if (dests.some((a, i) => i > 0 && a.dist < dests[i - 1].dist)) throw new Error("destinations should sort by distance");
    const nearDst = dests[0], farDst = dests[dests.length - 1];
    if (!(farDst.payout > nearDst.payout)) throw new Error("farther destination must pay more (payout ∝ distance)");
    if (Math.abs(nearDst.payout - Math.round(nearDst.dist * DRONES.tradeCrPerUnit)) > 0.5) throw new Error("payout not distance-scaled");
    const escDr = this.escorts(s)[0], escDrIdx = s.playerFleet.indexOf(escDr);
    const creditsPre = s.credits;
    const disp = this.sendOnTradeRun(escDrIdx, farDst.id);
    if (!disp.ok || disp.payout !== farDst.payout) throw new Error("escort trade dispatch failed");
    if (escDr.role !== "trade" || escDr.formationIdx !== null) throw new Error("trade run must vacate the formation slot");
    if (this.escorts(s).length !== 2) throw new Error("wing should shrink while trading");
    if (this.sendOnTradeRun(escDrIdx, nearDst.id).ok) throw new Error("a flying drone can't take a second mission");
    // mid-flight: progress advances by wall clock, no payout yet
    escDr.departMs = this._nowMs() - 1000; escDr.arriveMs = this._nowMs() + 1000;
    this.updateFleet(0.05, s);
    if (!(escDr.progress > 0.3 && escDr.progress < 0.7)) throw new Error("wall-clock progress mid-flight: " + escDr.progress);
    if (s.credits !== creditsPre) throw new Error("payout must not bank before arrival");
    // force arrival → payout banked, drone parked free in the bay at the destination
    // (surviveP pinned like the convoy test below — the parking contract must not
    //  flake on the global rnd stream, which any content addition shifts)
    escDr.surviveP = 1;
    escDr.arriveMs = this._nowMs() - 1;
    this.updateFleet(0.05, s);
    if (escDr.role !== "hangar" || escDr.state !== "follow") throw new Error("arrived trade drone should park free in the bay");
    if (escDr.stationId !== farDst.id) throw new Error("arrived drone should note its destination station");
    if (s.credits !== creditsPre + farDst.payout) throw new Error("arrival must bank exactly the payout");
    if (escDr.toId != null || escDr.arriveMs != null) throw new Error("trade fields not cleared on arrival");
    if (this.escorts(s).some((d, k) => d.formationIdx !== k)) throw new Error("formation not re-packed on arrival");
    // reversible drone modules: any module fits any free slot (untyped), the
    // module remembers its source item, and unfit returns it to cargo
    const modItem = ForgeItemSystem.generateItem("laser", "rare", { ilvl: 2, rng: ForgeItemSystem.seedRng(5) });
    s.inventory.push(modItem);
    const invModN = s.inventory.length;
    const dr0 = s.playerFleet[0], preLen = dr0.loadout.length;
    if (preLen >= DRONES.slotCount) throw new Error("test drone has no free slot");
    if (!this.fleetSwapModule(0, preLen, s.inventory.length - 1)) throw new Error("drone module fit failed");
    if (s.inventory.length !== invModN - 1) throw new Error("fit must consume the cargo item");
    const fitIdx = dr0.loadout.findIndex(m => m && m.srcItem === modItem);
    if (fitIdx < 0) throw new Error("module must remember its source item");
    // untyped slots: a weapon can share the rack with the factory weapon (glass cannon)
    if (dr0.loadout.filter(m => m.type === "weapon").length < 2) throw new Error("weapon must fit alongside another weapon");
    if (!this.fleetUnequipModule(0, fitIdx)) throw new Error("drone module unequip failed");
    if (!s.inventory.includes(modItem)) throw new Error("unequip must return the item to cargo");
    // factory built-ins can now be removed too — frees the slot, nothing returns to cargo
    const facLen = dr0.loadout.length, facInv = s.inventory.length;
    if (!this.fleetUnequipModule(0, 0)) throw new Error("factory module should now unequip");
    if (dr0.loadout.length !== facLen - 1) throw new Error("factory unequip must free the slot");
    if (s.inventory.length !== facInv) throw new Error("factory unequip must not add a cargo item");
    // reorder: fit two modules, swap their slots
    s.inventory.push(ForgeItemSystem.generateItem("laser", "rare", { ilvl: 2, rng: ForgeItemSystem.seedRng(6) }));
    s.inventory.push(ForgeItemSystem.generateItem("cannon", "rare", { ilvl: 2, rng: ForgeItemSystem.seedRng(7) }));
    this.fleetSwapModule(0, dr0.loadout.length, s.inventory.length - 2);
    this.fleetSwapModule(0, dr0.loadout.length, s.inventory.length - 1);
    const dslot0 = dr0.loadout[0], dslot1 = dr0.loadout[1];
    if (!this.fleetReorderModule(0, 0, 1)) throw new Error("drone module reorder failed");
    if (dr0.loadout[0] !== dslot1 || dr0.loadout[1] !== dslot0) throw new Error("reorder must swap the two slots");

    // ===== 17h) MULTI-SHIP: unlock gates · buyShipUpgrade module transfer ·
    // switch conservation · inactive refits =====
    this.init(); s = this.state;
    if (s.ships.length !== 1 || s.activeShipId !== 1 || s.ships[0].hullKey !== "vulture") throw new Error("ship registry boot state");
    if (s.ships[0].slots.filter(Boolean).length !== 5) throw new Error("starter loadout not mirrored into the ship record");
    s.docked = true;
    if (this.buyShip("vulture").ok) throw new Error("starter hull must not be for sale");
    // progression gates: a fresh pilot sees LOCKED regardless of purse
    // (OR-gate: cumulative outpost captures / lifetime max danger reached)
    s.credits = 500000;
    if (this.shipUnlockStatus("atlas").unlocked) throw new Error("atlas must boot locked");
    if (this.buyShip("atlas").ok) throw new Error("locked hull must not sell");
    s.maxDangerReached = 4;                       // flew into a danger-4 wedge once
    if (!this.shipUnlockStatus("atlas").unlocked) throw new Error("danger 4 must unlock the atlas");
    s.credits = 100;
    if (this.buyShip("atlas").ok) throw new Error("broke buyShip must fail");
    s.credits = 60000;
    // upgrade: fitted modules ride along, the old rack empties, health restores full
    const rackIds = ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join();
    const invPreSwitch = s.inventory.length;
    s.hp.shield = 10; s.hp.hull = 100;            // fly in beat up — the new hull leaves dock fresh
    const shipBuy = this.buyShipUpgrade("atlas");
    if (!shipBuy.ok) throw new Error("atlas upgrade failed: " + shipBuy.reason);
    if (s.credits !== 60000 - CONFIG.hulls.atlas.cost.credits) throw new Error("upgrade credits not deducted");
    if (s.activeShipId !== shipBuy.ship.id) throw new Error("upgrade must switch to the new hull");
    if (ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join() !== rackIds) throw new Error("modules must transfer to the new ship");
    if (s.ships[0].slots.some(Boolean)) throw new Error("old hull must hand its modules over");
    if (s.inventory.length !== invPreSwitch) throw new Error("upgrade leaked items into cargo");
    if (s.derived.hullMax !== 1350 || s.derived.fuelMax !== 1500) throw new Error("derived stats must follow the atlas hull");
    if (s.hp.hull !== s.hp.hullMax || s.hp.shield !== s.hp.shieldMax || s.hp.armor !== s.hp.armorMax) throw new Error("upgrade must restore full health");
    if (this.buyShip("atlas").ok) throw new Error("duplicate hull must be refused");
    // aegis gates on the capture-counter path — danger 4 isn't enough
    if (this.shipUnlockStatus("aegis").unlocked) throw new Error("aegis must still be locked at danger 4");
    s.capturedOutpostCount = 10;
    if (!this.shipUnlockStatus("aegis").unlocked) throw new Error("10 captures must unlock the aegis");
    // item conservation across a plain switch — nothing duped, nothing lost
    ForgeEquipment.activateSkill(1);
    s.docked = false;
    if (this.switchActiveShip(1).ok) throw new Error("undocked switch must be refused");
    s.docked = true;
    if (!this.switchActiveShip(1).ok) throw new Error("switch back to the vulture failed");
    if (!ForgeEquipment.getEquipped().slots.every(x => x === null)) throw new Error("vulture rack should now be empty");
    if (s.derived.hullMax !== 900) throw new Error("derived not back on the vulture hull");
    if (ForgeEquipment.getSkillState().some(sk => sk.active)) throw new Error("skills must deactivate on switch");
    if (!this.switchActiveShip(shipBuy.ship.id).ok) throw new Error("switch to atlas failed");
    if (ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join() !== rackIds) throw new Error("atlas rack not restored");
    if (s.hp.hullMax !== 1350 || s.fuel > s.fuelMax + 1e-9) throw new Error("hp/fuel not resynced on switch");
    if (s.inventory.length !== invPreSwitch) throw new Error("switch leaked items into cargo");
    // inactive-ship refits are pure array moves; the live rack never notices
    const vultureShip = s.ships.find(sh => sh.hullKey === "vulture");
    const spareItem = ForgeItemSystem.generateItem("shield_extender", "rare", { ilvl: 3, rng: ForgeItemSystem.seedRng(9) });
    s.inventory.push(spareItem);
    const rackSnap = ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join();
    if (!this.loadoutEquip(vultureShip.id, s.inventory.length - 1, null)) throw new Error("inactive-ship equip failed");
    if (vultureShip.slots[0] !== spareItem || s.inventory.includes(spareItem)) throw new Error("inactive equip must move item cargo→slots");
    if (ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join() !== rackSnap) throw new Error("inactive refit touched the live rack");
    // stat delta preview is pure
    const prevSlots = vultureShip.slots.slice();
    const dl = this._loShipDeltas(vultureShip, new Array(CONFIG.equipSlots).fill(null));
    if (!dl.some(x => x.label === "Shield" && x.to < x.from)) throw new Error("delta preview should report the shield loss");
    if (vultureShip.slots.join() !== prevSlots.join()) throw new Error("delta preview mutated ship slots");
    if (ForgeEquipment.getEquipped().slots.filter(Boolean).map(i => i.id).join() !== rackSnap) throw new Error("delta preview touched the live rack");
    if (!this.loadoutUnequip(vultureShip.id, 0)) throw new Error("inactive-ship unequip failed");
    if (!s.inventory.includes(spareItem)) throw new Error("inactive unequip must return the item");

    // ===== 17i) TRADE CONVOYS: stacked payout · survival scaling · casualties =====
    this.init(); s = this.state;
    s.docked = true; s.dockStationId = 0;
    ForgeWorld.getStations().forEach(st => { st.discovered = true; });
    const cvGive = (t) => { s.credits += 500; for (const m of DRONES.tiers[t].materials) s.refinedBars[m.type] = (s.refinedBars[m.type] || 0) + m.n; };
    for (let k = 0; k < DRONES.ownedMax; k++) { cvGive(0); if (!this.buildDrone(0).ok) throw new Error("convoy test build " + k); }
    // 3 are escorts, the rest hangar; move all escorts to the hangar so we have a pool
    this.escorts(s).slice().forEach(d => this.setDroneRole(s.playerFleet.indexOf(d), "hangar"));
    if (s.playerFleet.some(d => d.role !== "hangar")) throw new Error("convoy setup: all drones should be hangar");
    // payout math: full first share + 90% each extra → 2 ships double a route ≈ ×1.9
    const perShip0 = 2000;
    if (this._convoyTotal(perShip0, 1) !== 2000) throw new Error("solo convoy total must equal per-ship");
    if (this._convoyTotal(perShip0, 2) !== 3800) throw new Error("2-ship convoy total should be 3800 (10% fleet penalty): " + this._convoyTotal(perShip0, 2));
    // survival rises with convoy size and tier, capped
    if (!(this._convoySurvive(1, 0) < this._convoySurvive(3, 0))) throw new Error("bigger convoy must be safer");
    if (!(this._convoySurvive(1, 0) < this._convoySurvive(1, 2))) throw new Error("higher tier must be safer");
    if (this._convoySurvive(5, 2) > DRONES.surviveCap + 1e-9) throw new Error("survival must cap");
    // eligibility guards (a convoy run is capped separately at DRONES.tradeConvoyMax,
    // independent of the ownership cap DRONES.ownedMax)
    if (this.launchTradeConvoy([], 3).ok) throw new Error("empty convoy must fail");
    if (this.launchTradeConvoy([0, 1], 0).ok) throw new Error("convoy to the origin station must fail");
    // (the tradeConvoyMax length guard short-circuits before destId is ever resolved, so any id works here)
    if (DRONES.ownedMax > DRONES.tradeConvoyMax &&
        this.launchTradeConvoy(Array.from({ length: DRONES.ownedMax }, (_, i) => i), 3).ok)
      throw new Error("convoy larger than tradeConvoyMax must be rejected");
    // launch a 2-ship convoy to a chosen station
    const dest = this.tradeDestinations()[3];
    const perShipD = this._tradePerShip(ForgeWorld.getStations().find(st => st.id === dest.id));
    const expectTotal = this._convoyTotal(perShipD, 2), expectShare = Math.round(expectTotal / 2);
    const convoy = this.launchTradeConvoy([0, 1], dest.id);
    if (!convoy.ok || convoy.count !== 2 || convoy.total !== expectTotal) throw new Error("convoy launch payout: " + JSON.stringify(convoy));
    const flying = s.playerFleet.filter(d => d.role === "trade");
    if (flying.length !== 2) throw new Error("both convoy ships should be flying");
    if (flying[0].convoyId == null || flying[0].convoyId !== flying[1].convoyId) throw new Error("convoy ships must share a convoyId");
    if (flying.some(d => d.payout !== expectShare)) throw new Error("each convoy ship should carry an equal share");
    if (flying.some(d => d.laneOffset === undefined)) throw new Error("convoy ships need a lane offset for spread");
    if (this.launchTradeConvoy([0], dest.id).ok) throw new Error("a flying (non-hangar) drone can't be re-convoyed");
    // arrival, all survive → banks the full stacked total, both park free
    const credB = s.credits;
    flying.forEach(d => { d.surviveP = 1; d.departMs = this._nowMs() - 1000; d.arriveMs = this._nowMs() - 1; });
    this.updateFleet(0.05, s);
    if (s.credits !== credB + expectShare * 2) throw new Error("surviving convoy should bank both shares: " + (s.credits - credB));
    if (s.playerFleet.filter(d => d.role === "hangar").length !== DRONES.ownedMax) throw new Error("arrived convoy should park (all " + DRONES.ownedMax + " hangar drones)");
    // a doomed run destroys the ship (no bank, removed from the fleet)
    const owned0 = s.playerFleet.length, cred1 = s.credits;
    const solo = this.sendOnTradeRun(0, dest.id);
    if (!solo.ok) throw new Error("solo dispatch for casualty test failed");
    const doomed = s.playerFleet.find(d => d.role === "trade");
    doomed.surviveP = 0; doomed.departMs = this._nowMs() - 1000; doomed.arriveMs = this._nowMs() - 1;
    this.updateFleet(0.05, s);
    if (s.playerFleet.length !== owned0 - 1) throw new Error("a lost trade drone must be removed from the fleet");
    if (s.credits !== cred1) throw new Error("a lost trade drone must bank nothing");

    // ===== 18) SOLAR SYSTEM LAYOUT =====
    this.init(); s = this.state;
    if (s.planets.length !== 8) throw new Error("solar system: need 8 planets, got " + s.planets.length);
    const pNames = s.planets.map(p => p.name);
    for (const expected of ["Vesper","Cinder","Arix","Dusk","Mira","Sorn","Halveth","Nox Prime"])
      if (!pNames.includes(expected)) throw new Error("missing planet: " + expected);
    const mira = s.planets.find(p => p.name === "Mira");
    if (!mira || mira.orbit !== 44000) throw new Error("Mira orbit wrong");
    const homeSt = this.homeStationObj();
    if (!homeSt.name.includes("Mira")) throw new Error("home station not at Mira: " + homeSt.name);
    const homeDist = Math.hypot(homeSt.pos.x - mira.x, homeSt.pos.y - mira.y);
    if (homeDist > mira.r * 5) throw new Error("home station too far from Mira: " + homeDist);
    // station positions must match their planet's orbital neighborhood
    for (const p of s.planets) {
      const st = ForgeWorld.getStations()[p.stationIdx];
      const d = Math.hypot(st.pos.x - p.x, st.pos.y - p.y);
      if (d > p.r * 5) throw new Error(p.name + " station too far from planet: " + d);
    }
    // player starts near Mira
    if (Math.hypot(s.x - mira.x, s.y - mira.y) > mira.r * 6) throw new Error("player not near Mira");

    // ===== 19) FACTION TERRITORIES =====
    for (const p of s.planets) {
      const orb = p.orbit;
      let expectedFac = null;
      for (const [fac, zone] of Object.entries(CONFIG.factionZones))
        if (orb >= zone.innerR && orb < zone.outerR) { expectedFac = fac; break; }
      if (expectedFac && p.faction !== expectedFac) throw new Error(p.name + " faction " + p.faction + " expected " + expectedFac);
    }

    // ===== 20) FOG OF WAR =====
    this.init(); s = this.state;
    if (!(s.exploredTiles instanceof Set) || s.exploredTiles.size === 0) throw new Error("fog: no explored tiles at start");
    const startKey = this._tileKey(s.x, s.y);
    if (!s.exploredTiles.has(startKey)) throw new Error("fog: starting tile not explored");
    const farKey = this._tileKey(80000, 80000);
    if (s.exploredTiles.has(farKey)) throw new Error("fog: far tile should be unexplored");
    if (this.isTileExplored(s.x, s.y) !== true) throw new Error("fog: isTileExplored wrong for explored tile");
    if (this.isTileExplored(80000, 80000) !== false) throw new Error("fog: isTileExplored wrong for unexplored tile");

    // ===== 21) TRADE NETWORK WIN =====
    this.init(); s = this.state;
    this.checkWin();
    if (s.tradeNetworkComplete) throw new Error("trade network: should not be complete at start");
    const allSts = ForgeWorld.getStations();
    for (const st of allSts) { st.discovered = true; st.warpActive = true; }
    const crPre = s.credits;
    this.checkWin();
    if (!s.tradeNetworkComplete) throw new Error("trade network: should be complete after all gates");
    if (s.credits !== crPre + CONFIG.tradeNetworkBonus) throw new Error("trade network: bonus not awarded");
    this.checkWin();
    if (s.credits !== crPre + CONFIG.tradeNetworkBonus) throw new Error("trade network: bonus awarded twice");

    // ===== 21b) FACTION POLITICS: pie territory · geometric regions · majority
    // control · border skirmishes · kill heat · patrols =====
    this.init(); s = this.state;
    if (!Array.isArray(s.politicsEvents)) throw new Error("politicsEvents not an array");
    if (typeof REGIONS === "undefined" || REGIONS.length !== 10) throw new Error("REGIONS must have 10 entries");
    // pie geometry: 120° faction wedges (Vex 0–120 · Krag 120–240 · Nox 240–360),
    // each tiled exactly by its angular sub-regions; neighbors must touch
    const polWedge = { vex: [0, 120], krag: [120, 240], nox: [240, 360] };
    const polCount = { vex: 0, krag: 0, nox: 0 };
    for (const pr of REGIONS) {
      if (!pr.id || !pr.name || !pr.lore) throw new Error("political region fields: " + pr.id);
      if (!CONFIG.factions.includes(pr.faction)) throw new Error("political region faction: " + pr.id);
      if (pr.minAngle < polWedge[pr.faction][0] || pr.maxAngle > polWedge[pr.faction][1] || pr.minAngle >= pr.maxAngle)
        throw new Error("region outside its faction wedge: " + pr.id);
      if (!Array.isArray(pr.neighbors) || !pr.neighbors.length) throw new Error("region without neighbors: " + pr.id);
      for (const nid of pr.neighbors) {
        const nb = getRegion(nid);
        if (!nb) throw new Error("unresolved neighbor: " + pr.id + "→" + nid);
        if (!nb.neighbors.includes(pr.id)) throw new Error("neighbor link not symmetric: " + pr.id + "↔" + nid);
        if (pr.maxAngle % 360 !== nb.minAngle % 360 && nb.maxAngle % 360 !== pr.minAngle % 360)
          throw new Error("neighbors do not touch angularly: " + pr.id + "↔" + nid);
      }
      polCount[pr.faction]++;
    }
    if (polCount.vex !== 3 || polCount.krag !== 4 || polCount.nox !== 3) throw new Error("region split must be 3 vex / 4 krag / 3 nox");
    for (const fac of CONFIG.factions) {
      const span = REGIONS.filter(r => r.faction === fac).reduce((a, r) => a + (r.maxAngle - r.minAngle), 0);
      if (span !== 120) throw new Error(fac + " wedge not fully tiled: " + span + "°");
    }
    // cross-faction fronts: exactly the three wedge seams (the pie makes Vex and
    // Nox touch across 0° — a front the old band map never had)
    const polSeams = new Set();
    for (const pr of REGIONS) for (const nid of pr.neighbors) {
      const nb = getRegion(nid);
      if (nb.faction !== pr.faction) polSeams.add([pr.id, nid].sort().join("~"));
    }
    if (polSeams.size !== 3) throw new Error("expected 3 cross-faction seams: " + [...polSeams].join(" "));
    for (const want of ["krag_frontier~vex_embergate", "krag_wardens~nox_voidrim", "nox_palemarch~vex_crucible"])
      if (!polSeams.has(want)) throw new Error("missing seam: " + want);
    // geometric membership: getOutpostsInRegion partitions the live outpost list
    let polSum = 0;
    for (const pr of REGIONS) {
      const inside = getOutpostsInRegion(pr.id, s.outposts);
      if (!inside.length) throw new Error("region has no outposts: " + pr.id);
      polSum += inside.length;
      for (const o of inside) {
        const a = ((Math.atan2(o.y, o.x) * 180 / Math.PI) + 360) % 360;
        if (a < pr.minAngle || a >= pr.maxAngle) throw new Error("outpost outside claimed bounds: " + pr.id);
        if (politicalRegionAt(o.x, o.y) !== pr) throw new Error("politicalRegionAt mismatch in " + pr.id);
      }
    }
    if (polSum !== s.outposts.length) throw new Error("regions must partition the outposts: " + polSum + "/" + s.outposts.length);
    // pie-native seeding: every region opens under its founder's majority
    for (const pr of REGIONS) if (pr.controller !== pr.faction) throw new Error("pristine controller: " + pr.id + " → " + pr.controller);
    if (getRegionController("vex_crucible") !== "vex") throw new Error("getRegionController broken");
    const vexFronts = getContestableRegions("vex");
    if (!vexFronts.some(r => r.id === "krag_frontier")) throw new Error("Ember Gate ↔ Frontier front missing");
    if (!vexFronts.some(r => r.id === "nox_palemarch")) throw new Error("Crucible ↔ Pale March front missing");
    // 60% majority control: a challenger needs ≥60% of outposts to take a
    // region; under 60% the incumbent holds (prevents rapid oscillation).
    const mjR = getRegion("krag_ashfield"), mjO = getOutpostsInRegion(mjR.id, s.outposts);
    const mj60 = Math.ceil(mjO.length * 0.6);
    const mjInsufficient = (mjO.length >> 1) + 1;
    for (let i = 0; i < mjInsufficient; i++) this._politicsFlipOutpost(mjO[i], "nox");
    this._recalcRegionController(mjR, s);
    if (mjR.controller !== "krag") throw new Error("sub-60% must not flip: " + mjR.controller);
    for (let i = 0; i < mjInsufficient; i++) this._politicsFlipOutpost(mjO[i], "krag");
    for (let i = 0; i < mj60; i++) this._politicsFlipOutpost(mjO[i], "nox");
    this._recalcRegionController(mjR, s);
    if (mjR.controller !== "nox") throw new Error("60% flip did not move control: " + mjR.controller);
    for (let i = 0; i < mj60; i++) this._politicsFlipOutpost(mjO[i], "krag");
    this._recalcRegionController(mjR, s);
    if (mjR.controller !== "krag") throw new Error("control restore failed");
    if (!s.factionKills || CONFIG.factions.some(f => typeof s.factionKills[f] !== "number")) throw new Error("factionKills missing keys");
    if (!s.factionKillTimer || CONFIG.factions.some(f => typeof s.factionKillTimer[f] !== "number")) throw new Error("factionKillTimer missing keys");
    // kill heat: 3 kills inside the window → aggressive; 5 quiet minutes reset the ledger
    this.onFactionShipKilled({ faction: "krag" }); this.onFactionShipKilled({ faction: "krag" });
    if (this.isFactionAggro("krag")) throw new Error("2 kills must not read aggressive");
    this.onFactionShipKilled({ faction: "krag" });
    if (s.factionKills.krag !== 3 || !this.isFactionAggro("krag")) throw new Error("3 kills should turn krag aggressive");
    this._tickFactionHeat(s, 301);
    if (s.factionKills.krag !== 0 || this.isFactionAggro("krag")) throw new Error("kill heat did not decay");
    // pushEvent: newest-first ring buffer capped at 8
    for (let i = 0; i < 12; i++) this.pushEvent(s, "evt " + i);
    if (s.politicsEvents.length !== 8 || s.politicsEvents[0].msg !== "evt 11") throw new Error("politicsEvents ring buffer");
    s.politicsEvents.length = 0;
    // forced skirmish win: exactly ONE enemy outpost inside a contested border flips
    const polOwners = () => s.outposts.map(o => o.owner);
    const ownBefore = polOwners();
    const skm = this.resolveBorderSkirmish(s, { forceWin: true });
    if (!skm || !skm.win || !skm.outpost) throw new Error("forced skirmish did not resolve");
    if (skm.outpost.owner !== skm.attacker || skm.outpost.faction !== skm.attacker) throw new Error("skirmish did not flip the outpost");
    if (politicalRegionAt(skm.outpost.x, skm.outpost.y) !== skm.region) throw new Error("skirmish flipped an outpost outside its region");
    const ownAfter = polOwners();
    let polDiff = 0;
    for (let i = 0; i < ownAfter.length; i++) if (ownAfter[i] !== ownBefore[i]) polDiff++;
    if (polDiff !== 1) throw new Error("skirmish must flip exactly one outpost: " + polDiff);
    if (!s.politicsEvents.length || typeof s.politicsEvents[0].msg !== "string") throw new Error("skirmish pushed no event");
    if (s.politicsEvents[0].msg.indexOf("{") >= 0) throw new Error("event tokens not substituted: " + s.politicsEvents[0].msg);
    if (skm.region.lastContestT !== s.t) throw new Error("contest pulse timestamp not set");
    // defender hold leaves the map untouched
    const holdOwners = polOwners().join();
    const skh = this.resolveBorderSkirmish(s, { forceWin: false });
    if (!skh || skh.win || polOwners().join() !== holdOwners) throw new Error("defender hold must not flip outposts");
    // the politics clock fires a skirmish and re-arms in the 90–150s band
    s.politicsTimer = 0; s._politicsNext = 5; s.politicsEvents.length = 0;
    this.updatePolitics(s, 6);
    if (!s.politicsEvents.length) throw new Error("politics clock did not fire a skirmish");
    if (s.politicsTimer !== 0 || s._politicsNext < 90 || s._politicsNext > 150) throw new Error("politics clock did not re-arm: " + s._politicsNext);
    // simulateFactionWar: N instant skirmishes, returns faction tally + flip list
    const warResult = this.simulateFactionWar(s, 10);
    if (typeof warResult.vex !== "number" || typeof warResult.krag !== "number" || typeof warResult.nox !== "number") throw new Error("simulateFactionWar tally missing");
    if (!Array.isArray(warResult.flips)) throw new Error("simulateFactionWar flips not an array");
    // SEC badge state: getDangerLevel returns 1-9 for any valid position
    const secDL = getDangerLevel(s.x, s.y);
    if (secDL < 1 || secDL > 9) throw new Error("getDangerLevel out of range: " + secDL);
    if (typeof dangerColor(secDL) !== "string") throw new Error("dangerColor must return a string");
    // faction patrols: 2–3 ships spawn at a faction outpost, hold their orbit,
    // ignore a clean player, engage a bloodied one, and stand down off-shift
    s.patrols = []; s.aliens = [];
    const patHost = s.outposts.find(o => CONFIG.factions.includes(o.owner));
    const patA = this.spawnFactionPatrol(patHost, s);
    if (!patA || patA.ships.length < 2 || patA.ships.length > 3) throw new Error("patrol size: " + (patA && patA.ships.length));
    if (patA.faction !== patHost.owner) throw new Error("patrol faction mismatch");
    if (!(patA.r >= 800 && patA.r <= 1200)) throw new Error("patrol orbit radius: " + patA.r);
    if (!patA.ships.every(sh => sh._patrol && s.aliens.includes(sh))) throw new Error("patrol ships not registered");
    s.x = patHost.x + 9000; s.y = patHost.y;   // in streaming range, out of engage range
    const patX0 = patA.ships[0].x, patY0 = patA.ships[0].y;
    for (let i = 0; i < 60; i++) this.updateFactionPatrols(1 / 60, s);
    if (patA.engaged) throw new Error("patrol engaged with nobody near");
    if (patA.ships[0].x === patX0 && patA.ships[0].y === patY0) throw new Error("patrol not moving along its orbit");
    if (Math.abs(this.dist(patA.ships[0].x, patA.ships[0].y, patHost.x, patHost.y) - patA.r) > 1) throw new Error("patrol drifted off its orbit");
    s.x = patA.ships[0].x + 100; s.y = patA.ships[0].y;   // clean record: picket ignores you
    this.updateFactionPatrols(1 / 60, s);
    if (patA.engaged) throw new Error("patrol must ignore a clean player");
    s.factionKills[patA.faction] = 1; s.factionKillTimer[patA.faction] = 300;
    this.updateFactionPatrols(1 / 60, s);
    if (!patA.engaged) throw new Error("patrol must engage a bloodied player in its picket");
    s.factionKills[patA.faction] = 0; s.factionKillTimer[patA.faction] = 0;
    // aggressive-on-sight: 3+ kills extends the trigger to 1500u
    s.patrols = []; s.aliens = [];
    const pat2 = this.spawnFactionPatrol(patHost, s);
    s.factionKills[pat2.faction] = 3; s.factionKillTimer[pat2.faction] = 300;
    s.x = pat2.ships[0].x + 1300; s.y = pat2.ships[0].y;   // between 500 and 1500
    this.updateFactionPatrols(1 / 60, s);
    if (!pat2.engaged) throw new Error("hot faction must engage at 1500u");
    s.factionKills[pat2.faction] = 0; s.factionKillTimer[pat2.faction] = 0;
    // an unbothered patrol stands down when its shift ends
    s.patrols = []; s.aliens = [];
    const pat3 = this.spawnFactionPatrol(patHost, s);
    pat3.t = 0.01; s.x = patHost.x + 9000; s.y = patHost.y;
    this.updateFactionPatrols(0.1, s);
    if (s.patrols.includes(pat3)) throw new Error("off-shift patrol must stand down");
    if (pat3.ships.some(sh => s.aliens.includes(sh))) throw new Error("off-shift patrol ships not removed");

    // ===== 21c) OUTPOST CAPTURE FLOW: player weapons vs the platform · hull 0
    // flips (never destroys) · FORTIFY modules + stationed-drone defense =====
    this.init(); s = this.state;
    const cap = s.outposts.find(o => CONFIG.factions.includes(o.owner));
    if (cap.kind !== "outpost" || !Array.isArray(cap.modules) || !Array.isArray(cap.stationedDrones)) throw new Error("outpost missing capture-flow fields");
    if (this.findCombatTarget(cap.id) !== cap) throw new Error("findCombatTarget must resolve an enemy outpost");
    s.x = cap.x + 200; s.y = cap.y;
    if (!ForgeCombat.lockOn(cap, { x: s.x, y: s.y, scanRange: s.derived.scanRange })) throw new Error("enemy outpost must be lockable");
    ForgeCombat.clearLock();
    // player weapons chew the structure shield-first (deterministic plain hit)
    ForgeCombat.initCombat({ rng: () => 0.5 });
    const capW = ForgeItemSystem.generateItem("laser", "normal", { ilvl: 1, rng: ForgeItemSystem.seedRng(70) });
    const capSh0 = cap.shield;
    this.fireAtOutpost(cap, capW);
    if (!(cap.shield < capSh0)) throw new Error("outpost shield must take weapon damage: " + cap.shield);
    if (!cap.provoked) throw new Error("attacking the platform must provoke the garrison");
    // hull to 0 → capture, not destruction: player owner, full pools, news wire
    const capRegion = politicalRegionAt(cap.x, cap.y), capPrevOwner = cap.owner;
    cap.shield = 0; cap.armor = 0; cap.hull = 1;
    s.politicsEvents.length = 0;
    this.fireAtOutpost(cap, capW);
    ForgeCombat.initCombat();
    if (cap.owner !== "player") throw new Error("hull 0 must flip the outpost to the player");
    if (cap.shield !== cap.shieldMax || cap.armor !== cap.armorMax || cap.hull !== cap.hullMax) throw new Error("captured outpost must restore to full");
    if (cap.shieldMax !== 300 || cap.armorMax !== 200 || cap.hullMax !== 150) throw new Error("captured outpost pools must be 300/200/150");
    if (!s.politicsEvents.length || s.politicsEvents[0].msg.indexOf("captured by player") < 0) throw new Error("capture must push the politics headline");
    if (capRegion.contestFrom !== capPrevOwner) throw new Error("capture must touch the region controller recalc");
    if (this.outpostFactionCol(cap) !== "#22cccc") throw new Error("player outpost must render cyan #22cccc");
    if (this.findCombatTarget(cap.id)) throw new Error("a player outpost must not stay a combat target");
    // 60%+ player ownership takes the region (same majority rule as factions)
    const capO = getOutpostsInRegion(capRegion.id, s.outposts);
    const capNeed = Math.ceil(capO.length * 0.6);
    for (let i = 0; i < capNeed; i++) capO[i].owner = "player";
    this._recalcRegionController(capRegion, s);
    if (capRegion.controller !== "player") throw new Error("player 60% majority must take the region");
    for (const oo of capO) if (oo !== cap && oo.owner === "player") oo.owner = oo.faction;
    this._recalcRegionController(capRegion, s);
    // FORTIFY: modules move cargo → hardpoints (cap 4) and rebuild the defense block
    const capMod = ForgeItemSystem.generateItem("shield_extender", "normal", { ilvl: 1, rng: ForgeItemSystem.seedRng(71) });
    s.inventory.push(capMod);
    if (!this.fortifyEquipModule(cap, s.inventory.indexOf(capMod))) throw new Error("fortify equip failed");
    if (cap.modules.length !== 1 || s.inventory.includes(capMod)) throw new Error("fortify equip must move the item out of cargo");
    if (cap.shieldMax <= 300) throw new Error("shield module must raise outpost shieldMax: " + cap.shieldMax);
    const capWep = ForgeItemSystem.generateItem("cannon", "normal", { ilvl: 1, rng: ForgeItemSystem.seedRng(72) });
    const capTd0 = cap.turretDmg;
    s.inventory.push(capWep);
    this.fortifyEquipModule(cap, s.inventory.indexOf(capWep));
    if (cap.turretDmg <= capTd0) throw new Error("weapon module must raise turretDmg");
    const capFill = [];
    for (let i = 0; i < 3; i++) { const it = ForgeItemSystem.generateItem("hull_plating", "normal", { ilvl: 1, rng: ForgeItemSystem.seedRng(73 + i) }); s.inventory.push(it); capFill.push(it); }
    this.fortifyEquipModule(cap, s.inventory.indexOf(capFill[0]));
    this.fortifyEquipModule(cap, s.inventory.indexOf(capFill[1]));
    if (cap.modules.length !== 4) throw new Error("outpost should hold 4 modules: " + cap.modules.length);
    if (this.fortifyEquipModule(cap, s.inventory.indexOf(capFill[2]))) throw new Error("5th module must be rejected");
    const capInvN = s.inventory.length;
    this.fortifyUnequipModule(cap, 0);
    if (cap.modules.length !== 3 || s.inventory.length !== capInvN + 1) throw new Error("fortify unequip must return the item");
    if (cap.shieldMax !== 300) throw new Error("unequip must recompute the defense block: " + cap.shieldMax);
    // stationed drones: fleet → berth (cap 3), launch at a threat inside 800u,
    // kill it, return, re-station, recall back to the fleet
    s.credits = 100000; s.refinedBars = { copper: 99, silver: 99, gold: 99, platinum: 99 };
    this.buildDrone(0); this.buildDrone(0); this.buildDrone(0); this.buildDrone(1);
    const capFleetN = s.playerFleet.length;
    if (!this.assignDroneToOutpost(cap, 0).ok) throw new Error("assign to outpost failed");
    this.assignDroneToOutpost(cap, 0); this.assignDroneToOutpost(cap, 0);
    if (cap.stationedDrones.length !== 3 || s.playerFleet.length !== capFleetN - 3) throw new Error("3 drones should be stationed");
    if (this.assignDroneToOutpost(cap, 0).ok) throw new Error("4th stationed drone must be rejected");
    if (!cap.stationedDrones.every(dd => dd.role === "stationed")) throw new Error("stationed role not set");
    s.x = cap.x + 500; s.y = cap.y;   // player on-site: local sim is live
    s.aliens = [];
    const capRaider = ForgeFaction.generateGroup("vex", { x: cap.x + 400, y: cap.y }, { rng: rnd, followerCount: 2 }).leader;
    capRaider.x = cap.x + 400; capRaider.y = cap.y;
    s.aliens.push(capRaider);
    this.updateOutpostDefense(cap, 1 / 60);
    if (!cap.stationedDrones.some(dd => dd.state === "defend")) throw new Error("drones must launch at a threat inside 800u");
    for (let i = 0; i < 3000 && s.aliens.includes(capRaider); i++) this.updateOutpostDefense(cap, 1 / 30);
    if (s.aliens.includes(capRaider)) throw new Error("stationed drones failed to down the raider");
    for (let i = 0; i < 4000 && !cap.stationedDrones.every(dd => dd.state === "stationed"); i++) this.updateOutpostDefense(cap, 1 / 30);
    if (!cap.stationedDrones.every(dd => dd.state === "stationed")) throw new Error("drones must return and re-station once the perimeter clears");
    const capBackN = s.playerFleet.length;
    if (!this.recallDroneFromOutpost(cap, 0).ok) throw new Error("recall failed");
    if (cap.stationedDrones.length !== 2 || s.playerFleet.length !== capBackN + 1) throw new Error("recall must return the drone to the fleet");
    if (s.playerFleet[s.playerFleet.length - 1].role !== "hangar") throw new Error("recalled drone should wait in the hangar");

    // ---- berthed-drone module editing (fortify uses the shared drone-object cores) ----
    const bd = cap.stationedDrones[0], bdLen0 = bd.loadout.length;
    const bmod = ForgeItemSystem.generateItem("laser", "rare", { ilvl: 2, rng: ForgeItemSystem.seedRng(11) });
    s.inventory.push(bmod);
    if (!this.droneFitModule(bd, bd.loadout.length, s.inventory.length - 1)) throw new Error("berth drone fit failed");
    if (bd.loadout.length !== bdLen0 + 1) throw new Error("berth fit must add a module");
    const bfi = bd.loadout.findIndex(m => m && m.srcItem === bmod);
    if (bfi < 0) throw new Error("berth module must remember its source item");
    if (!this.droneUnequipModule(bd, bfi)) throw new Error("berth drone unequip failed");
    if (!s.inventory.includes(bmod)) throw new Error("berth unequip must return the module to cargo");

    // ---- recall-with-swap when the hangar is full ----
    s.credits = 100000; s.refinedBars = { copper: 99, silver: 99, gold: 99, platinum: 99 };
    while (s.playerFleet.length < DRONES.ownedMax && this.buildDrone(0).ok) { /* fill hangar */ }
    if (s.playerFleet.length !== DRONES.ownedMax) throw new Error("could not fill hangar for swap test");
    if (this.recallDroneFromOutpost(cap, 0).ok) throw new Error("recall must fail when hangar is full");
    const berthedRef = cap.stationedDrones[0], swapRef = s.playerFleet[0];
    const swBerthN = cap.stationedDrones.length, swFleetN = s.playerFleet.length;
    if (!this.recallDroneWithSwap(cap, 0, 0).ok) throw new Error("recall-with-swap failed");
    if (cap.stationedDrones.length !== swBerthN || s.playerFleet.length !== swFleetN) throw new Error("swap must preserve counts");
    if (cap.stationedDrones[0] !== swapRef || swapRef.role !== "stationed") throw new Error("swapped drone must take the berth");
    if (!s.playerFleet.includes(berthedRef) || berthedRef.role !== "hangar") throw new Error("recalled drone must join the hangar");
    if (this.escorts(s).some((d, k) => d.formationIdx !== k)) throw new Error("formation not re-packed after swap");
    const swTrade = s.playerFleet.find(d => d.role !== "trade");
    if (swTrade) { swTrade.role = "trade"; if (this.recallDroneWithSwap(cap, 0, s.playerFleet.indexOf(swTrade)).ok) throw new Error("swap must reject a trade-run drone"); swTrade.role = "hangar"; }

    // ---- salvageDrone: 50% bars + 50% credits + player-fitted modules to cargo ----
    s.credits = 0; s.refinedBars = { copper: 0, silver: 0, gold: 0, platinum: 0 };
    const sd = s.playerFleet.find(d => d.tier === 0 && d.role !== "trade"), sdIdx = s.playerFleet.indexOf(sd);
    const smod = ForgeItemSystem.generateItem("laser", "rare", { ilvl: 2, rng: ForgeItemSystem.seedRng(12) });
    s.inventory.push(smod);
    this.droneFitModule(sd, sd.loadout.length, s.inventory.length - 1);
    const svInvN = s.inventory.length, svFleetN = s.playerFleet.length;
    const salvR = this.salvageDrone(sdIdx);
    if (!salvR.ok) throw new Error("salvage failed");
    if (s.credits !== Math.floor(DRONES.tiers[0].cost * DRONES.salvageFrac)) throw new Error("salvage credit refund wrong: " + s.credits);
    if ((s.refinedBars.copper || 0) !== Math.floor(2 * DRONES.salvageFrac)) throw new Error("salvage bar refund wrong");
    if (!s.inventory.includes(smod)) throw new Error("salvage must return player modules to cargo");
    if (s.inventory.length !== svInvN + 1) throw new Error("salvage returns only player modules (factory discarded)");
    if (s.playerFleet.length !== svFleetN - 1) throw new Error("salvage must remove the drone");
    const svTrade = s.playerFleet.find(d => d.role !== "trade");
    if (svTrade) { svTrade.role = "trade"; if (this.salvageDrone(s.playerFleet.indexOf(svTrade)).ok) throw new Error("salvage must reject a trade-run drone"); svTrade.role = "hangar"; }
    // outpost dock: DOCK near the owned platform opens the trimmed 3-tab menu
    this.openOutpostDock(cap.id);
    if (!s.docked || s.dockKind !== "outpost" || s.outpostDockId !== cap.id || s.dockTab !== "loadout") throw new Error("outpost dock did not open");
    const capStore = this._dockStation();
    if (!capStore || String(capStore.name).indexOf("Outpost") !== 0) throw new Error("outpost store station missing");
    if (!Array.isArray(capStore.stock) || !capStore.stock.length) throw new Error("outpost store rolled no stock");
    this.closeDock();
    if (s.docked || s.outpostDockId) throw new Error("closeDock did not clear the outpost dock");

    // ===== 21d) SAVE SYSTEM: serialize → fresh init → applySaveData restores the
    // run (pure-data round trip; localStorage itself is browser-only + fail-soft) =====
    if (!(s.capturedOutpostCount >= 1)) throw new Error("captureOutpost must count captures: " + s.capturedOutpostCount);
    s.x = Math.cos(340 * Math.PI / 180) * 30000; s.y = Math.sin(340 * Math.PI / 180) * 30000;   // Pale March — danger 9
    this.updateRegions();
    if (s.maxDangerReached !== 9) throw new Error("maxDangerReached must track the danger-9 wedge: " + s.maxDangerReached);
    // dirty every persisted field to a distinctive value
    s.credits = 4321;
    s.ore = { gold: { count: 7, bonus: false } };
    s.refinedBars = { copper: 3 };
    s.inventory = [ForgeItemSystem.generateItem("laser", "rare", { ilvl: 3, rng: ForgeItemSystem.seedRng(777) })];
    s.factionKills.vex = 2; s.factionKillTimer.vex = 100;
    this.pushEvent(s, "save-system probe headline", "#ffffff");
    setRegionController("krag_frontier", "vex");
    cap.shield = 123;   // partial damage must survive the round trip (clamped to max)
    const svSt = ForgeWorld.getStations()[1];
    svSt.discovered = true; svSt.warpActive = true;
    s.homeStationId = svSt.id; s.refineBonus = 0.10;
    const svN = { ships: s.ships.length, active: s.activeShipId, fitted: ForgeEquipment.getEquipped().slots.filter(Boolean).length,
      fleet: s.playerFleet.length, mods: cap.modules.length, berthed: cap.stationedDrones.length,
      captured: s.capturedOutpostCount, tiles: s.exploredTiles.size };
    const svTile = [...s.exploredTiles][0];
    const snap = JSON.parse(JSON.stringify(this.serializeGame()));   // storage-realistic: pure data, no live refs
    if (this.applySaveData(null) || this.applySaveData({ v: 99 })) throw new Error("bad save payloads must be rejected");
    this.init(); s = this.state;   // fresh world — everything above is gone
    if (s.credits === 4321 || this.outpostById(cap.id).owner === "player" || getRegionController("krag_frontier") !== "krag")
      throw new Error("fresh init should not retain run state");
    if (!this.applySaveData(snap)) throw new Error("applySaveData rejected a valid save");
    if (s.credits !== 4321) throw new Error("credits not restored: " + s.credits);
    if (!s.ore.gold || s.ore.gold.count !== 7 || (s.refinedBars.copper || 0) !== 3) throw new Error("cargo not restored");
    if (s.inventory.length !== 1 || s.inventory[0].base !== "laser") throw new Error("inventory not restored");
    if (s.ships.length !== svN.ships || s.activeShipId !== svN.active) throw new Error("ship registry not restored");
    if (ForgeEquipment.getEquipped().slots.filter(Boolean).length !== svN.fitted) throw new Error("active loadout not re-equipped");
    if (s.playerFleet.length !== svN.fleet) throw new Error("fleet not restored: " + s.playerFleet.length);
    if (s.factionKills.vex !== 2 || !(s.factionKillTimer.vex > 0)) throw new Error("faction heat not restored");
    const svCap = this.outpostById(cap.id);
    if (svCap.owner !== "player" || !svCap.discovered) throw new Error("outpost ownership not restored");
    if (svCap.modules.length !== svN.mods || svCap.stationedDrones.length !== svN.berthed) throw new Error("outpost fortify state not restored");
    if (Math.abs(svCap.shield - 123) > 0.01) throw new Error("outpost damage not restored: " + svCap.shield);
    if (svCap.guardRecs.some(r => r.alive) || svCap.capturable) throw new Error("captured outpost must not re-arm its garrison");
    if (getRegionController("krag_frontier") !== "vex") throw new Error("region controller not restored");
    if (!s.politicsEvents.length || s.politicsEvents[0].msg !== "save-system probe headline") throw new Error("politics events not restored");
    if (s.capturedOutpostCount !== svN.captured || s.maxDangerReached !== 9) throw new Error("unlock stats not restored");
    const svSt2 = ForgeWorld.getStations()[1];
    if (!svSt2.discovered || !svSt2.warpActive) throw new Error("charted space not restored");
    if (s.homeStationId !== svSt2.id || s.refineBonus !== 0.10) throw new Error("home port not restored");
    if (s.exploredTiles.size < svN.tiles || !s.exploredTiles.has(svTile)) throw new Error("fog exploration not restored");
    // a headless saveGame must fail SOFT, never throw (no localStorage in Node)
    if (this.saveGame() !== false) throw new Error("headless saveGame must return false");

    // ===== 21e) ENDGAME: empire progress · faction collapse · 10/10 victory
    // pause + resume · lifetime clock/earnings · save round trip =====
    this.init(); s = this.state;   // pristine map — founders hold everything
    this.checkEmpireProgress(s);
    if (s.empireRegions !== 0 || s.empireWon || s.victoryOpen) throw new Error("no empire at start");
    if (this.fmtTimePlayed(3725) !== "01:02:05" || this.fmtTimePlayed(0) !== "00:00:00") throw new Error("fmtTimePlayed must format HH:MM:SS");
    const vicT0 = s.timePlayed;
    this.update(1 / 60);
    if (!(s.timePlayed > vicT0)) throw new Error("timePlayed must tick");
    const vicC0 = s.creditsEarned;
    s.credits += 500; this.update(1 / 60);
    if (s.creditsEarned !== vicC0 + 500) throw new Error("creditsEarned must sum positive deltas: " + s.creditsEarned);
    const vicC1 = s.creditsEarned;
    s.credits -= 400; this.update(1 / 60);
    if (s.creditsEarned !== vicC1) throw new Error("spending must not count as earnings");
    // faction collapse: vex loses all 3 home regions → ONE narrative newsline;
    // its outposts stay vex-flagged (remnants, not despawns)
    for (const r of REGIONS) if (r.faction === "vex") setRegionController(r.id, "krag");
    this.checkEmpireProgress(s);
    if (!s.factionsDefeated.vex || s.factionsDefeated.krag) throw new Error("vex collapse flag wrong");
    if (s.politicsEvents[0].msg.indexOf("Vex Collective has been shattered") < 0) throw new Error("vex defeat newsline missing: " + s.politicsEvents[0].msg);
    const vicEvN = s.politicsEvents.length;
    this.checkEmpireProgress(s);
    if (s.politicsEvents.length !== vicEvN) throw new Error("defeat newsline must fire only once");
    if (!s.outposts.some(o => o.owner === "vex")) throw new Error("defeated faction must keep its remnant outposts");
    // 10/10 player regions → victory fires through the live politics path:
    // pause flag up, world frozen, CONTINUE resumes, overlay never re-fires
    for (const r of REGIONS) setRegionController(r.id, "player");
    this.updatePolitics(s, 1 / 60);
    if (s.empireRegions !== 10 || !s.empireWon || !s.victoryOpen) throw new Error("10/10 regions must trigger victory");
    if (!s.factionsDefeated.krag || !s.factionsDefeated.nox) throw new Error("total conquest must collapse every faction");
    const vicT1 = s.timePlayed, vicWorldT = s.t;
    this.update(1 / 60);
    if (s.timePlayed !== vicT1 || s.t !== vicWorldT) throw new Error("victory must pause the update loop");
    this.continueVictory();
    if (s.victoryOpen || !s.empireWon) throw new Error("CONTINUE must resume with the win intact");
    this.update(1 / 60);
    if (!(s.timePlayed > vicT1)) throw new Error("world must resume after CONTINUE");
    this.checkEmpireProgress(s);
    if (s.victoryOpen) throw new Error("victory overlay must not re-fire");
    // save round trip: the endgame fields ride the whitelist
    s.timePlayed = 4321.5; s.creditsEarned = 98765;
    const vicSnap = JSON.parse(JSON.stringify(this.serializeGame()));
    this.init(); s = this.state;
    if (s.empireWon || s.timePlayed !== 0 || s.factionsDefeated.vex) throw new Error("fresh init must reset the endgame");
    if (!this.applySaveData(vicSnap)) throw new Error("applySaveData rejected the endgame save");
    if (Math.abs(s.timePlayed - 4321.5) > 0.01 || s.creditsEarned !== 98765) throw new Error("clock/earnings not restored");
    if (!s.empireWon || !s.factionsDefeated.vex || !s.factionsDefeated.nox) throw new Error("endgame flags not restored");
    if (s.empireRegions !== 10) throw new Error("restored controllers must recount the empire: " + s.empireRegions);
    if (s.victoryOpen) throw new Error("a loaded won save must not re-open the overlay");

    // ===== 21f) TUTORIAL: brand-new game shows · tip 1 auto-advances on
    // movement · NEXT walks / SKIP dismisses · done flag rides the save =====
    this.init(); s = this.state;
    if (s.tutorialDone || s.tutorialActive) throw new Error("tutorial flags must boot clean");
    this.initTutorial(s);
    if (!s.tutorialActive || s.tutorialStep !== 0) throw new Error("fresh game must arm the tutorial at tip 1");
    this.updateTutorial(s);
    if (s.tutorialStep !== 0) throw new Error("tip 1 must wait for movement");
    s.vx = 30; this.updateTutorial(s); s.vx = 0;
    if (s.tutorialStep !== 1) throw new Error("tip 1 must auto-advance on movement");
    for (let i = 1; i < TUTORIAL_TIPS.length - 1; i++) this.advanceTutorial();
    if (!s.tutorialActive || s.tutorialStep !== TUTORIAL_TIPS.length - 1) throw new Error("NEXT must walk the tips");
    this.advanceTutorial();   // NEXT on the last tip completes
    if (s.tutorialActive || !s.tutorialDone) throw new Error("finishing the tutorial must set tutorialDone");
    this.advanceTutorial(); this.updateTutorial(s);   // finished → both no-op
    if (s.tutorialActive || s.tutorialStep !== TUTORIAL_TIPS.length - 1) throw new Error("finished tutorial must stay finished");
    this.init(); s = this.state; this.initTutorial(s);
    this.advanceTutorial();   // mid-sequence...
    this.skipTutorial();      // ...SKIP dismisses the rest
    if (s.tutorialActive || !s.tutorialDone) throw new Error("SKIP must dismiss + mark done");
    // save round trip: a loaded save never re-shows the tutorial
    const tutSnap = JSON.parse(JSON.stringify(this.serializeGame()));
    if (tutSnap.tutorialDone !== true) throw new Error("tutorialDone must ride the save whitelist");
    this.init(); s = this.state;
    if (!this.applySaveData(tutSnap)) throw new Error("applySaveData rejected the tutorial save");
    this.initTutorial(s);
    if (!s.tutorialDone || s.tutorialActive) throw new Error("a loaded save must skip the tutorial");
    delete tutSnap.tutorialDone;   // pre-tutorial saves = veteran runs → skip too
    this.init(); s = this.state; this.applySaveData(tutSnap); this.initTutorial(s);
    if (!s.tutorialDone || s.tutorialActive) throw new Error("pre-tutorial saves must skip the tutorial");

    // ===== 22) reset =====
    this.init(); const gs = this.getState();
    if (gs.credits !== CONFIG.debugStartCredits || gs.tradeNetworkComplete || gs.hull !== CONFIG.baseShip.hullMax || gs.equipped !== 5 || gs.inventory !== 0) throw new Error("init reset");
    if (gs.ships !== 1 || gs.activeShip !== 1 || gs.escorts !== 0) throw new Error("init reset: ship registry");
    this._selfTesting = false;
    return true;
  },
});

/*=== HARNESS:BOOT ===========================================================*/
if (HEADLESS) {
  globalThis.GAME = GAME; globalThis.GAME_CONFIG = CONFIG;
  GAME.wireUI(null, null); GAME.init();
} else {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  GAME._canvas = canvas; GAME._ctx = ctx;
  window.GAME = GAME; window.GAME_CONFIG = CONFIG; GAME._input = input;   // debug handles (console access)
  // Bind a LOGICAL-dims proxy (not the raw canvas) so warp-UI draw + hit-boxes
  // use CONFIG.W/H units, matching the logical tap coords — the backing buffer
  // is now physical (device) pixels and would mis-scale both.
  ForgeWorld.setContext({ get width() { return CONFIG.W; }, get height() { return CONFIG.H; } }, ctx);
  // Aspect-adaptive viewport: the canvas fills the window in ANY orientation
  // instead of being locked to a 390×700 portrait box (which shrank to a tiny
  // letterboxed strip on rotation). We keep the SHORT screen axis ≈ VIEW_BASE
  // logical units so UI density feels the same portrait vs landscape, and let
  // the long axis grow. CONFIG.W/H are read live by the camera projection and
  // every corner-anchored HUD element, so they reflow automatically; the HUD's
  // cached scale is refreshed via ForgeHUD.resizeHUD.
  const VIEW_BASE = 390;
  // Logical→device pixel scale for the per-frame base transform (set by fit()).
  let renderScaleX = 1, renderScaleY = 1;
  const fit = () => {
    // Cap the backing-buffer density at 2×. On dpr-3 phones the town's neon fills
    // and shadow-blurs are pixel-bound on the mobile GPU; rasterizing 3× the pixels
    // saturates it, the browser falls back to lower-res compositing (the "pixels
    // get bigger" + lag), and frames tank. 2× is still retina-sharp and cuts pixel
    // cost ~2.25× vs 3×. Purely a resolution cap — all layout stays in logical units.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    const scale = Math.min(vw, vh) / VIEW_BASE;          // css px per logical unit
    CONFIG.W = Math.max(320, Math.round(vw / scale));
    CONFIG.H = Math.max(320, Math.round(vh / scale));
    // Backing buffer at FULL device resolution (css px × dpr) — not the logical
    // CONFIG.W/H, which would render a low-res buffer that CSS then stretches to
    // fill the viewport (blurry, esp. on Retina/dpr=2). All draw code stays in
    // logical units; the frame loop applies renderScale to map them onto the
    // physical buffer, so world coords / camera / HUD are untouched.
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    canvas.style.width = vw + "px"; canvas.style.height = vh + "px";   // fill the viewport (no letterbox)
    renderScaleX = canvas.width / CONFIG.W;              // logical unit → device px
    renderScaleY = canvas.height / CONFIG.H;
    // ForgeHUD lays out from the dims it's handed — feed it LOGICAL, not the
    // physical buffer, so its k/font sizing stays in logical units.
    if (typeof ForgeHUD !== "undefined" && ForgeHUD.resizeHUD) ForgeHUD.resizeHUD({ width: CONFIG.W, height: CONFIG.H });
  };
  fit();
  requestAnimationFrame(fit);                 // re-fit once first layout settles
  addEventListener("load", fit);              // and after full load (fonts/among late layout)
  addEventListener("resize", fit);
  addEventListener("orientationchange", () => { setTimeout(fit, 100); setTimeout(fit, 300); });
  if (window.visualViewport) visualViewport.addEventListener("resize", fit);
  GAME.wireUI(canvas, ctx); GAME.wireLoadoutDOM(); GAME.wireDroneDOM(); GAME.wireContractsDOM(); GAME.wireFleetDOM(); GAME.wireStoreDOM(); GAME.wireWarpDOM(); GAME.wireShipsDOM(); GAME.wireFortifyDOM(); GAME.wireSkillsUI(); GAME.wireVictoryDOM(); GAME.wireSaveUI(); GAME.wireTutorialDOM(); GAME.init();
  GAME.loadGame();   // restore a saved run before the first frame renders (no-op without a save)
  GAME.initTutorial(GAME.state);   // first-run coach marks: brand-new game only (a loaded save marks them done)
  // Preload the external AI PNG art (sprites/*.png). The frame loop shows a
  // "Loading assets…" card until ART.ready, then a brand-new run opens with the
  // intro scene. Safety timeout: never let a stalled image block boot forever.
  ART.load(() => {
    const s = GAME.state;
    if (s && s.tutorialActive) GAME.showOpeningScene();   // tutorialActive ⇒ fresh game (a loaded save marks it done)
  });
  setTimeout(() => { ART.ready = true; }, 6000);
  setInterval(() => GAME.saveGame(), 5 * 60 * 1000);   // belt-and-suspenders auto-save
  // Web Audio unlocks only inside a user gesture; left attached so a
  // browser-suspended context (tab switch) resumes on the next input too
  addEventListener("pointerdown", () => AUDIO.unlock());
  addEventListener("keydown", () => AUDIO.unlock());
  document.addEventListener("visibilitychange", () => { if (document.hidden) AUDIO.stopAll(); });   // RAF pauses hidden — don't leave the hum running

  // ---- keyboard ----
  const held = {};
  const applyKeys = () => { input.ax = (held.right ? 1 : 0) - (held.left ? 1 : 0); input.ay = (held.down ? 1 : 0) - (held.up ? 1 : 0); };
  const keyDir = k => ({ arrowleft: "left", a: "left", arrowright: "right", d: "right", arrowup: "up", w: "up", arrowdown: "down", s: "down" }[k]);
  addEventListener("keydown", e => {
    const m = keyDir(e.key.toLowerCase());
    if (m) { held[m] = true; applyKeys(); e.preventDefault(); }
    if (e.key === " ") { input.tractorEdge = true; e.preventDefault(); }
    if (e.key === "=" || e.key === "+") { if (GAME.state.galaxyMapOpen) GAME.mapZoomBy(1.5, CONFIG.W / 2, CONFIG.H / 2 + 10); else input.zoomEdge = 1; }
    if (e.key === "-" || e.key === "_") { if (GAME.state.galaxyMapOpen) GAME.mapZoomBy(1 / 1.5, CONFIG.W / 2, CONFIG.H / 2 + 10); else input.zoomEdge = -1; }
    if (e.key === "q" || e.key === "Q") input.toggleMode = true;
    if (e.key === "e" || e.key === "E" || e.key === "Enter") input.dock = true;
    if (e.key === "f" || e.key === "F") input.refuel = true;
    if (e.key === "b" || e.key === "B") input.returnToBase = true;
    if (e.key === "m" || e.key === "M") input.mapToggle = true;
    if (e.key === "l" || e.key === "L") { input.landEdge = true; input.closeMenu = true; }
    if (e.key === "Escape") input.closeMenu = true;
    if (e.key >= "1" && e.key <= "6") input.skillTap = +e.key - 1;   // toggle skill/weapon in slot 0–5
    if (e.key === "r" || e.key === "R") input.restart = true;
    if (e.key === "g" || e.key === "G") DEBUG = !DEBUG;
  });
  addEventListener("keyup", e => { const m = keyDir(e.key.toLowerCase()); if (m) { held[m] = false; applyKeys(); } });
  addEventListener("wheel", e => {
    if (GAME.state.galaxyMapOpen) {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * CONFIG.W, y = (e.clientY - r.top) / r.height * CONFIG.H;
      GAME.mapZoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, x, y); return;
    }
    input.zoomEdge = e.deltaY < 0 ? 1 : -1;
  }, { passive: true });

  // ---- pointer ----
  const toLog = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * CONFIG.W, y: (e.clientY - r.top) / r.height * CONFIG.H }; };
  const ptrs = new Map();
  let aimPtr = null, aimId = null, pinch0 = 0, pending = null, mapPtr = null;
  const MOVE_THRESH = 12, HOLD_MS = 180;
  // gear tab is the #gearPanel DOM overlay (own listeners); it eats canvas pointers while shown
  const overlayActive = () => { const s = GAME.state; return s.warpOverlay || s.docked || s.galaxyMapOpen || s.victoryOpen || s.onPlanet; };
  canvas.addEventListener("pointerdown", e => {
    const p = toLog(e); ptrs.set(e.pointerId, p);
    const s = GAME.state;
    if (overlayActive()) {
      // On the planet surface a single-finger tap sets a walk destination; a
      // second finger is a pinch-zoom, handled by PLANET's own touch listeners, so
      // don't let it register as a tap.
      if (s.onPlanet) { if (ptrs.size === 1) GAME.overlayClick(p.x, p.y); return; }
      // Galaxy map: one finger drags to pan, two pinch to zoom; a clean tap (no
      // drag) falls through to the on-map buttons on pointerup.
      if (s.galaxyMapOpen) {
        if (ptrs.size >= 2) { const a = [...ptrs.values()]; pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); mapPtr = null; }
        else mapPtr = { id: e.pointerId, x: p.x, y: p.y, moved: false };
        return;
      }
      if (s.docked && GAME.hitDockTabs(p.x, p.y)) return;
      GAME.overlayClick(p.x, p.y); return;
    }
    if (ptrs.size === 1) {
      if (GAME.flightTap(p.x, p.y)) { ptrs.delete(e.pointerId); return; }
      if (GAME.pickGrabbableAt(p.x, p.y) || GAME.pickAlienAt(p.x, p.y) || GAME.pickTraderAt(p.x, p.y)) pending = { id: e.pointerId, x: p.x, y: p.y, t: performance.now() };
      else { aimPtr = p; aimId = e.pointerId; }
    } else if (ptrs.size === 2) { const a = [...ptrs.values()]; pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); aimPtr = aimId = null; pending = null; input.ax = input.ay = 0; }
  });
  addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return; const p = toLog(e); ptrs.set(e.pointerId, p);
    if (GAME.state.galaxyMapOpen) {
      if (ptrs.size >= 2) {   // pinch → zoom toward the gesture midpoint
        const a = [...ptrs.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch0 > 0 && d > 0) GAME.mapZoomBy(d / pinch0, (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
        pinch0 = d;
      } else if (mapPtr && mapPtr.id === e.pointerId) {   // one finger → pan
        const dx = p.x - mapPtr.x, dy = p.y - mapPtr.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) mapPtr.moved = true;
        GAME.mapPanBy(dx, dy); mapPtr.x = p.x; mapPtr.y = p.y;
      }
      return;
    }
    if (ptrs.size >= 2) { const a = [...ptrs.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (pinch0 && Math.abs(d - pinch0) > 26) { input.zoomEdge = d > pinch0 ? 1 : -1; pinch0 = d; } return; }
    if (pending && e.pointerId === pending.id) {
      if (Math.hypot(p.x - pending.x, p.y - pending.y) > MOVE_THRESH) { aimPtr = p; aimId = pending.id; pending = null; } else return;
    }
    if (aimId === e.pointerId) aimPtr = p;
  });
  const endPtr = e => {
    if (GAME.state.galaxyMapOpen) {
      const last = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
      if (mapPtr && mapPtr.id === e.pointerId) {
        if (!mapPtr.moved && last) GAME.galaxyMapClick(last.x, last.y);   // a tap that didn't pan → the on-map buttons
        mapPtr = null;
      }
      if (ptrs.size < 2) pinch0 = 0;
      return;
    }
    ptrs.delete(e.pointerId);
    if (pending && e.pointerId === pending.id) { input.pickX = pending.x; input.pickY = pending.y; pending = null; }
    if (e.pointerId === aimId) { aimPtr = aimId = null; input.ax = input.ay = 0; applyKeys(); }
    if (ptrs.size < 2) pinch0 = 0;
  };
  addEventListener("pointerup", endPtr); addEventListener("pointercancel", endPtr);

  const applyAim = () => {
    if (pending && performance.now() - pending.t > HOLD_MS) { aimPtr = { x: pending.x, y: pending.y }; aimId = pending.id; pending = null; }
    if (!aimPtr) return;
    const v = GAME.aimVector(aimPtr.x, aimPtr.y); input.ax = v.ax; input.ay = v.ay;
  };

  const drawLoadingScreen = () => {
    ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#8fd0ff"; ctx.font = "bold 18px monospace";
    ctx.fillText("SPACE HAULER", CONFIG.W / 2, CONFIG.H / 2 - 12);
    ctx.fillStyle = "#7f8ea6"; ctx.font = "12px monospace";
    ctx.fillText("Loading assets…", CONFIG.W / 2, CONFIG.H / 2 + 14);
    ctx.textAlign = "left";
  };
  let last = performance.now(), threw = 0;
  (function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    // Base transform: map logical CONFIG.W/H units onto the physical (device-px)
    // buffer. Re-applied every frame (canvas.width= in fit() resets the context,
    // and it defends against any sub-draw that might touch the transform). All
    // sub-draws use balanced save/restore, so this persists through the frame.
    ctx.setTransform(renderScaleX, 0, 0, renderScaleY, 0, 0);
    if (!ART.ready) { drawLoadingScreen(ctx); return; }   // hold the first frames until PNG art settles
    try { if (!overlayActive()) applyAim(); GAME.update(dt); GAME.draw(ctx); }
    catch (e) { if (threw++ < 3) setTimeout(() => { throw e; }, 0); }
  })(last);
}
/*=== HARNESS:CODE:END ===*/
