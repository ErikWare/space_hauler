/*=== HARNESS:DRONES =========================================================*/
// Phase 3 — drone trade system. Ore refines into bars at the station (2 ore →
// 1 bar, floor; odd ore stays raw), bars + credits buy tiered trade drones that
// fly station-to-station over real time for a payout on arrival. Pirates roll
// one ambush check per drone per 25s interval; a failed survival roll on the
// FIRST ambush destroys the drone, later ambushes only chew shield/hp. Drones
// are self-contained (hardcoded loadouts — no ForgeItemSystem calls) so Phase 5
// can lift the struct wholesale. UI is the DOM #dronePanel overlay (same
// pattern as #gearPanel); active drones render as cyan dots on the minimap.
const DRONES = {
  speed: 80,                 // world units/sec → travelTime = station dist / 80
  // ---- one-way trade runs (Phase 7 rework) ----
  // A drone flies station→station in real time; payout scales with the distance
  // it covers, the trip time is that distance at a realistic cruise speed, and
  // on arrival the drone is free again (no forced return leg). Progress is
  // WALL-CLOCK anchored (departMs/arriveMs) so it advances across a background /
  // "take a break" gap, not just active frames.
  tradeSpeed: 150,           // world units/sec — ~7-8 min for an average station hop
  tradeCrPerUnit: 0.1,       // payout = round(distance × this)  (20 000u → 2 000cr)
  // ---- convoys: send 1-5 hangar drones together on one route ----
  tradeConvoyMax: 5,         // ships per convoy
  convoyPenalty: 0.10,       // each ship beyond the first earns (1-this)× a full share
  laneSpacing: 55,           // perpendicular spread between convoy ships (world units)
  // survival = a ship reaching the destination; failure DESTROYS the ship. Bigger,
  // higher-tier convoys are a stronger force → better odds (shown to the player).
  soloSurvive: 0.85,         // a lone Basic drone's arrival chance
  convoySurviveBonus: 0.05,  // + per extra ship in the convoy
  tradeTierSurvive: 0.05,    // + per drone tier (armored ships are hardier)
  surviveCap: 0.98, surviveFloor: 0.5,
  ownedMax: 6,               // total drones owned (escort cap is FLEET.max=3; rest hangar/trade)
  slotCount: 3,              // module slots per drone — untyped: any module fits any slot
  salvageFrac: 0.5,          // scrap a drone → this fraction of its bar + credit cost comes back
  convoyMax: 5,
  orePerBar: 2,              // refinery ratio (floor) — remainder stays in the ore hold
  barTypes: ["copper", "silver", "gold", "platinum"],
  pirateEvery: 25,           // one ambush roll per drone per 25s of travel
  pirateChance: 0.33,
  escortBonus: 0.15,         // flat successRate boost when the convoy is escorted
  convoyLossCap: 2,          // pirates disengage after downing 2 drones of one convoy
  fuelPerTrip: 0.8,          // fraction of the tank a full no-combat trip burns
  fightDps: 12, fightDpsTier: 5,   // incoming pirate dps (shield soaks first); ×2 when dry
  flashT: 0.5,               // destroyed → red map flash, then culled from s.drones
  arrivedLinger: 6,          // arrived rows stay in the bay list this long
  tiers: [
    { name: "Basic",      cost: 25,  materials: [{ type: "copper", n: 2 }],
      payout: 125, successRate: 0.72, maxFuel: 80, maxHp: 40, maxShield: 20,
      loadout: [{ type: "weapon", name: "Light Laser", dmg: 4, amount: 0, fuelCost: 1, fireRate: 1.5 }] },
    { name: "Reinforced", cost: 60,  materials: [{ type: "silver", n: 3 }, { type: "gold", n: 1 }],
      payout: 220, successRate: 0.82, maxFuel: 120, maxHp: 70, maxShield: 50,
      loadout: [{ type: "weapon", name: "Pulse Laser", dmg: 7, amount: 0, fuelCost: 1.2, fireRate: 1.5 },
                { type: "repair", name: "Repair Bot", dmg: 0, amount: 4, fuelCost: 0.5, fireRate: 0.5 }] },
    { name: "Armored",    cost: 150, materials: [{ type: "platinum", n: 2 }, { type: "gold", n: 3 }],
      payout: 450, successRate: 0.91, maxFuel: 180, maxHp: 120, maxShield: 90,
      loadout: [{ type: "weapon", name: "Drone Cannon", dmg: 12, amount: 0, fuelCost: 1.5, fireRate: 1.2 },
                { type: "repair", name: "Nano Repair Rig", dmg: 0, amount: 6, fuelCost: 0.5, fireRate: 0.5 },
                { type: "utility", name: "Shield Booster", dmg: 0, amount: 5, fuelCost: 0.4, fireRate: 0.5 }] },
  ],
  // per-tier drone colour — quality reads at a glance, in the menu AND in flight:
  // Basic = steel blue, Reinforced = teal (the fleet signature), Armored = purple.
  tierCol: ["#5aa9e6", "#00e5cc", "#b06cff"],
};

Object.assign(GAME, {
  initDrones(s) {
    s = s || this.state;
    s.drones = []; s.refinedBars = {}; s._convoyLosses = {};
    this._nextDroneId = 1; this._nextConvoyId = 1;
    this._drUI = this._drUI || { tier: 0, convoy: 1, escort: false };
  },

  // ---- ore refinery: 2 ore → 1 bar per type (floor); odd remainder stays raw ----
  refineAllOre() {
    const s = this.state; let made = 0;
    for (const type of DRONES.barTypes) {
      const o = s.ore[type]; if (!o || o.count < DRONES.orePerBar) continue;
      const n = Math.floor(o.count / DRONES.orePerBar);
      s.refinedBars[type] = (s.refinedBars[type] || 0) + n;
      o.count -= n * DRONES.orePerBar;
      if (o.count <= 0) delete s.ore[type];
      made += n;
    }
    if (made > 0) { sfx("sell"); toast(`⚒ refined ${made} bar${made > 1 ? "s" : ""}`); }
    else toast("need 2+ ore of a type to refine");
    return made;
  },

  droneEngineBonus() {
    let b = 0;
    for (const it of ForgeEquipment.getEquipped().slots) if (it && it.cat === "propulsion") b += 0.05;
    return Math.min(0.15, b);
  },

  buildDrone(tier) {
    const s = this.state, spec = DRONES.tiers[tier];
    if (!spec) return { ok: false, reason: "bad tier" };
    if (s.playerFleet.length >= DRONES.ownedMax) { toast(`drone bay full (${DRONES.ownedMax})`); sfx("warn"); return { ok: false, reason: "fleet full" }; }
    if (s.credits < spec.cost) { toast(`need ${spec.cost}cr`); sfx("warn"); return { ok: false, reason: "credits" }; }
    for (const m of spec.materials)
      if ((s.refinedBars[m.type] || 0) < m.n) { toast(`need ${m.n} ${m.type} bar${m.n > 1 ? "s" : ""}`); sfx("warn"); return { ok: false, reason: "materials" }; }
    s.credits -= spec.cost;
    for (const m of spec.materials) s.refinedBars[m.type] -= m.n;
    // fresh drones join the wing while a formation slot is free, else wait in the bay
    const role = this.escorts(s).length < FLEET.max ? "escort" : "hangar";
    const d = {
      id: this._nextDroneId++, tier, role,
      hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
      fuel: spec.maxFuel, maxFuel: spec.maxFuel,
      loadout: spec.loadout.map(m => ({ ...m })),
      formationIdx: null, offsetX: 0, offsetY: 0,
      state: "follow", targetAlienId: null, wcd: 0, vx: 0, vy: 0,
      x: s.x, y: s.y,
    };
    s.playerFleet.push(d);
    this.reindexFormation(s);
    toast(role === "escort" ? "Companion drone deployed!" : "Drone built — waiting in hangar", FLEET.trail); sfx("buy");
    return { ok: true, drone: d };
  },

  // scrap a hangar drone for parts: DRONES.salvageFrac of its tier build cost
  // (credits + refined bars, floored) comes back, and any PLAYER-fitted modules
  // (loadout entries with srcItem) return to cargo. Factory built-ins are lost.
  salvageDrone(fleetIdx) {
    const s = this.state, d = s.playerFleet[fleetIdx];
    if (!d) return { ok: false, reason: "no such drone" };
    if (d.role === "trade") { toast("drone is mid trade run"); sfx("warn"); return { ok: false, reason: "on a trade run" }; }
    const spec = DRONES.tiers[d.tier], frac = DRONES.salvageFrac;
    const crBack = Math.floor((spec.cost || 0) * frac);
    s.credits += crBack;
    if (!s.refinedBars) s.refinedBars = {};
    for (const m of spec.materials) { const n = Math.floor(m.n * frac); if (n > 0) s.refinedBars[m.type] = (s.refinedBars[m.type] || 0) + n; }
    let mods = 0;
    for (const m of (d.loadout || [])) if (m && m.srcItem) { s.inventory.push(m.srcItem); mods++; }
    s.playerFleet.splice(fleetIdx, 1);
    this.reindexFormation(s);
    toast(`⚒ salvaged ${spec.name}: +${crBack}cr` + (mods ? ` · +${mods} module${mods > 1 ? "s" : ""}` : ""), "#ffd27a"); sfx("sell");
    return { ok: true, credits: crBack, modules: mods };
  },

  // wall-clock (ms) — drives real-time trade progress across background gaps
  _nowMs() { return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0; },
  _stName(id) { const st = ForgeWorld.getStations().find(x => x.id === id); return st ? st.name : "?"; },
  _fmtEta(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), r = sec % 60;
    return m > 0 ? (m + "m " + (r < 10 ? "0" : "") + r + "s") : (r + "s");
  },
  // Every station a drone could be sent to from the player's dock, priced by
  // distance: { id, name, dist, payout, etaSec, discovered }. All 8 outposts are
  // valid trade targets even while UNCHARTED — following the convoy to an unknown
  // station is how the player discovers what's out there (discovery still happens
  // via the player's own proximity; the drone doesn't reveal the map for you).
  tradeDestinations() {
    const s = this.state, stations = ForgeWorld.getStations();
    const from = stations.find(st => st.id === s.dockStationId);
    if (!from) return [];
    return stations.filter(st => st.id !== from.id).map(st => {
      const dist = this.dist(from.pos.x, from.pos.y, st.pos.x, st.pos.y);
      return { id: st.id, name: st.name, dist, discovered: !!st.discovered,
        payout: Math.max(1, Math.round(dist * DRONES.tradeCrPerUnit)),
        etaSec: Math.max(4, dist / DRONES.tradeSpeed) };
    }).sort((a, b) => a.dist - b.dist);
  },
  // ---- convoy math (shared by solo dispatch + the convoy builder) ----
  // Arrival chance for a ship in an n-strong convoy of the given tier — a bigger,
  // hardier force fends off pirates better. A failed roll DESTROYS the ship.
  _convoySurvive(n, tier) {
    return clamp(DRONES.soloSurvive + DRONES.convoySurviveBonus * (n - 1) + DRONES.tradeTierSurvive * (tier || 0),
      DRONES.surviveFloor, DRONES.surviveCap);
  },
  // Convoy total if every ship arrives: full share for the first, (1-penalty)×
  // for each additional ship (2× a 2 000cr route → 3 800, a 10% fleet penalty).
  _convoyTotal(perShip, n) { return Math.round(perShip * (1 + (1 - DRONES.convoyPenalty) * (n - 1))); },
  // A destination's per-ship base payout for the player's current dock.
  _tradePerShip(to) {
    const s = this.state, from = ForgeWorld.getStations().find(st => st.id === s.dockStationId);
    if (!from || !to) return 0;
    return Math.max(1, Math.round(this.dist(from.pos.x, from.pos.y, to.pos.x, to.pos.y) * DRONES.tradeCrPerUnit));
  },

  // Put one drone in flight to `to`. share = credits it banks on arrival (if it
  // survives); surviveP = its arrival odds; convoyId/laneOffset group + spread a
  // convoy visually. The single-ship path (sendOnTradeRun) is a convoy of one.
  _beginTradeRun(d, from, to, opts) {
    const s = this.state, now = this._nowMs();
    const dist = this.dist(from.pos.x, from.pos.y, to.pos.x, to.pos.y);
    const travelTime = Math.max(4, dist / DRONES.tradeSpeed);
    d.role = "trade"; d.state = "trade"; d.targetAlienId = null; d.formationIdx = null;
    d.fromId = from.id; d.toId = to.id;
    d.fromX = from.pos.x; d.fromY = from.pos.y; d.toX = to.pos.x; d.toY = to.pos.y;
    d.x = from.pos.x; d.y = from.pos.y;
    d.progress = 0; d.travelTime = travelTime;
    d.departMs = now; d.arriveMs = now + travelTime * 1000;
    d.payout = opts.share; d.surviveP = opts.surviveP;
    d.convoyId = opts.convoyId || null; d.laneOffset = opts.laneOffset || 0;
    return travelTime;
  },

  // Send a single drone one-way from the player's dock to a chosen station.
  // Payout ∝ distance, banked on arrival; the drone is free again once there (no
  // return leg). Escorts and hangar drones are both eligible; a flying drone is
  // not. A convoy of one — carries the same pirate risk as any trade run.
  sendOnTradeRun(fleetIdx, destId) {
    const s = this.state, d = s.playerFleet[fleetIdx];
    if (!d) return { ok: false, reason: "no drone" };
    if (d.role === "trade") return { ok: false, reason: "already on trade run" };
    if (!s.docked) { toast("dock to dispatch a trade run"); sfx("warn"); return { ok: false, reason: "not docked" }; }
    const stations = ForgeWorld.getStations();
    const from = stations.find(st => st.id === s.dockStationId);
    if (!from) return { ok: false, reason: "no origin station" };
    const to = destId != null ? stations.find(st => st.id === destId && st.id !== from.id) : null;
    if (!to) return { ok: false, reason: "bad destination" };
    const perShip = this._tradePerShip(to);
    const surviveP = this._convoySurvive(1, d.tier);
    const travelTime = this._beginTradeRun(d, from, to, { share: perShip, surviveP });
    this.reindexFormation(s);          // free the vacated escort slot
    toast(`⇪ ${DRONES.tiers[d.tier].name} → ${to.name} (${this._fmtEta(travelTime)}, +${perShip}cr · ${Math.round(surviveP * 100)}% safe)`, "#57e6ff"); sfx("buy");
    return { ok: true, toId: to.id, payout: perShip, etaSec: travelTime, surviveP };
  },

  // Launch a custom convoy: 1-5 HANGAR (non-escort) drones to one station. Payout
  // stacks across ships (10% fleet penalty per extra), and the whole force flies
  // together for a better per-ship survival chance. Returns the plan for the UI.
  launchTradeConvoy(fleetIdxs, destId) {
    const s = this.state;
    if (!s.docked) { toast("dock to launch a convoy"); sfx("warn"); return { ok: false, reason: "not docked" }; }
    const idxs = Array.from(new Set((fleetIdxs || []).map(Number))).filter(i => s.playerFleet[i]);
    if (!idxs.length) return { ok: false, reason: "no drones selected" };
    if (idxs.length > DRONES.tradeConvoyMax) return { ok: false, reason: "convoy too large" };
    const drones = idxs.map(i => s.playerFleet[i]);
    if (drones.some(d => d.role !== "hangar")) { toast("only hangar drones can convoy"); sfx("warn"); return { ok: false, reason: "escort/flying drone in convoy" }; }
    const stations = ForgeWorld.getStations();
    const from = stations.find(st => st.id === s.dockStationId);
    const to = destId != null ? stations.find(st => st.id === destId && st.id !== from.id) : null;
    if (!from || !to) return { ok: false, reason: "bad destination" };
    const n = drones.length, perShip = this._tradePerShip(to);
    const total = this._convoyTotal(perShip, n);
    const share = Math.round(total / n);
    const convoyId = this._nextConvoyId++;
    let travelTime = 0;
    drones.forEach((d, i) => {
      const surviveP = this._convoySurvive(n, d.tier);
      const laneOffset = (i - (n - 1) / 2) * DRONES.laneSpacing;   // spread across the lane
      travelTime = this._beginTradeRun(d, from, to, { share, surviveP, convoyId, laneOffset });
    });
    this.reindexFormation(s);
    const pct = Math.round(this._convoySurvive(n, Math.max(...drones.map(d => d.tier))) * 100);
    toast(`⇪ ${n}× convoy → ${to.name} (${this._fmtEta(travelTime)}, +${total}cr · ~${pct}% each)`, "#57e6ff"); sfx("buy");
    return { ok: true, toId: to.id, count: n, total, share, etaSec: travelTime };
  },

  launchDrones(tier, count, escorted) {
    const s = this.state, spec = DRONES.tiers[tier];
    if (!spec) return { ok: false, reason: "bad tier" };
    count = clamp((count | 0) || 1, 1, DRONES.convoyMax);
    const stations = ForgeWorld.getStations();
    const from = stations.find(st => st.id === s.dockStationId);
    if (!from) return { ok: false, reason: "no origin station" };
    const dests = stations.filter(st => st.discovered && st.id !== from.id);
    if (!dests.length) { toast("no known destination — discover another station"); sfx("warn"); return { ok: false, reason: "no destination" }; }
    const costCr = spec.cost * count;
    if (s.credits < costCr) { toast(`need ${costCr}cr`); sfx("warn"); return { ok: false, reason: "credits" }; }
    for (const m of spec.materials)
      if ((s.refinedBars[m.type] || 0) < m.n * count) { toast(`need ${m.n * count} ${m.type} bar${m.n * count > 1 ? "s" : ""}`); sfx("warn"); return { ok: false, reason: "materials" }; }
    s.credits -= costCr;
    for (const m of spec.materials) s.refinedBars[m.type] -= m.n * count;
    const to = dests[(rnd() * dests.length) | 0];
    const travelTime = Math.max(4, this.dist(from.pos.x, from.pos.y, to.pos.x, to.pos.y) / DRONES.speed);
    const engineBonus = this.droneEngineBonus();
    const convoyId = this._nextConvoyId++;
    for (let i = 0; i < count; i++) {
      s.drones.push({
        id: this._nextDroneId++, convoyId,
        fromId: from.id, toId: to.id,
        fromX: from.pos.x, fromY: from.pos.y, toX: to.pos.x, toY: to.pos.y,
        progress: 0, tier, payout: spec.payout, engineBonus,
        hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
        fuel: spec.maxFuel, maxFuel: spec.maxFuel,
        successRate: spec.successRate, travelTime,
        piratePending: false, pirateTimer: 0, pirateEvents: 0, pirateClock: DRONES.pirateEvery,
        destroyed: false, arrived: false, escorted: !!escorted,
        delay: i * 0.2, flashT: 0, doneT: 0,
        loadout: spec.loadout.map(m => ({ ...m })),
      });
    }
    toast(`⇪ ${count}× ${spec.name} → ${to.name}`); sfx("buy");
    return { ok: true, count, toId: to.id };
  },

  // pirate exchange while the timer runs: incoming dps soaks shield-then-hp,
  // the loadout answers (weapons burn fuel, repair heals hull, utility recharges shield)
  _droneFightTick(d, dt) {
    const inc = (DRONES.fightDps + d.tier * DRONES.fightDpsTier) * (d.fuel <= 0 ? 2 : 1) * dt;
    const soak = Math.min(d.shield, inc);
    d.shield -= soak; d.hp -= inc - soak;
    for (const m of d.loadout) {
      if (m.type === "weapon") d.fuel = Math.max(0, d.fuel - m.fuelCost * m.fireRate * dt);
      else if (m.type === "repair") d.hp = Math.min(d.maxHp, d.hp + m.amount * dt);
      else if (m.type === "utility") d.shield = Math.min(d.maxShield, d.shield + m.amount * dt);
    }
  },
  _destroyDrone(s, d) {
    d.destroyed = true; d.piratePending = false; d.hp = 0; d.flashT = DRONES.flashT;
    s._convoyLosses[d.convoyId] = (s._convoyLosses[d.convoyId] || 0) + 1;
    toast("✖ drone destroyed by pirates", "#ff5060"); sfx("warn");
  },

  updateDrones(dt, sArg) {
    const s = sArg || this.state;
    if (!s || !s.drones || !s.drones.length) return;
    for (let i = s.drones.length - 1; i >= 0; i--) {
      const d = s.drones[i];
      if (d.destroyed) { d.flashT -= dt; if (d.flashT <= 0) s.drones.splice(i, 1); continue; }
      if (d.arrived) { d.doneT -= dt; if (d.doneT <= 0) s.drones.splice(i, 1); continue; }
      if (d.delay > 0) { d.delay -= dt; continue; }

      const dp = (dt / d.travelTime) * (1 + d.engineBonus);
      d.progress += dp;
      d.fuel = Math.max(0, d.fuel - dp * d.maxFuel * DRONES.fuelPerTrip);

      // one ambush roll per 25s interval; pirates disengage from a mauled convoy
      d.pirateClock -= dt;
      if (d.pirateClock <= 0 && !d.piratePending) {
        d.pirateClock = DRONES.pirateEvery;
        if ((s._convoyLosses[d.convoyId] || 0) < DRONES.convoyLossCap && rnd() < DRONES.pirateChance) {
          d.piratePending = true; d.pirateTimer = 2 + rnd() * 2;
          toast("⚠ convoy under pirate attack", "#ff9a3c"); sfx("warn");
        }
      }
      if (d.piratePending) {
        d.pirateTimer -= dt;
        this._droneFightTick(d, dt);
        if (d.hp <= 0) { this._destroyDrone(s, d); continue; }
        if (d.pirateTimer <= 0) {
          d.piratePending = false; d.pirateEvents++;
          // dry tank = helpless; escort = +0.15; only the FIRST ambush can outright destroy
          const rate = d.fuel <= 0 ? 0 : d.successRate + (d.escorted ? DRONES.escortBonus : 0);
          if (rnd() > rate && d.pirateEvents === 1) { this._destroyDrone(s, d); continue; }
        }
      }

      if (d.progress >= 1) {
        d.progress = 1; d.arrived = true; d.doneT = DRONES.arrivedLinger;
        s.credits += d.payout;
        GAME.addXpFromCredits(d.payout);   // XP: running trade runs (drone haul)
        toast(`Drone arrived! +${d.payout}cr`, "#57d1c9"); sfx("sell");
        this.checkWin();
      }
    }
  },

  dronePos(d) {
    return { x: d.fromX + (d.toX - d.fromX) * d.progress, y: d.fromY + (d.toY - d.fromY) * d.progress };
  },

  // ---- drawing: cyan dots in the world + on the minimap; destroyed = red flash ----
  drawDronesWorld(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.drones.length) return;
    const z = s.cam.zoom;
    for (const d of s.drones) {
      if (d.arrived) continue;
      const p = this.dronePos(d), pt = this.SF(p.x, p.y);
      if (pt.x < -24 || pt.x > CONFIG.W + 24 || pt.y < -24 || pt.y > CONFIG.H + 24) continue;
      if (d.destroyed) {
        g.fillStyle = `rgba(255,80,96,${Math.max(0, d.flashT / DRONES.flashT)})`;
        g.beginPath(); g.arc(pt.x, pt.y, (3 + (DRONES.flashT - d.flashT) * 16) * Math.max(0.4, z), 0, TAU); g.fill();
      } else {
        const r = Math.max(1.6, 2.4 * z);
        g.fillStyle = d.piratePending ? "#ff9a3c" : "#57e6ff";
        g.beginPath(); g.arc(pt.x, pt.y, r, 0, TAU); g.fill();
        g.strokeStyle = "rgba(87,230,255,0.25)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(pt.x, pt.y);
        const a = Math.atan2(d.toY - d.fromY, d.toX - d.fromX);
        g.lineTo(pt.x - Math.cos(a) * r * 4, pt.y - Math.sin(a) * r * 4); g.stroke();
      }
    }
  },
  // overlays ForgeHUD's minimap disc (same geometry trick as encounters/bases — hud.js untouched)
  drawDronesMinimap(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.drones.length) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / ((s.derived && s.derived.scanRange) || 1000);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    for (const d of s.drones) {
      if (d.arrived) continue;
      const p = this.dronePos(d);
      const dx = (p.x - s.x) * kMap, dy = (p.y - s.y) * kMap;
      if (dx * dx + dy * dy > R * R) continue;
      if (d.destroyed) {
        g.fillStyle = `rgba(255,80,96,${Math.max(0, d.flashT / DRONES.flashT)})`;
        g.beginPath(); g.arc(cx + dx, cy + dy, (2 + (DRONES.flashT - d.flashT) * 6) * k, 0, TAU); g.fill();
      } else {
        g.fillStyle = "#57e6ff";
        g.beginPath(); g.arc(cx + dx, cy + dy, 2 * k, 0, TAU); g.fill();
      }
    }
    g.restore();
  },

  // ================= DOM DRONE BAY PANEL (#dronePanel — build.py <body>) ========
  // Same overlay pattern as the gear tab: fixed full-screen DOM, shown while
  // docked on the "drones" tab, rebuilt on action + a ~3Hz list refresh.
  _droneDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._dr) return this._dr;
    const $ = id => document.getElementById(id);
    const panel = $("dronePanel");
    if (!panel) return null;
    this._dr = { panel, cred: $("drCred"), ores: $("drOres"), bars: $("drBars"),
                 tiers: $("drTiers"), list: $("drList"), _shown: false, _tick: 0 };
    return this._dr;
  },
  syncDroneDOM() {
    const dm = this._droneDOM(); if (!dm) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "drones");
    dm.panel.classList.toggle("show", show);
    if (show) this._syncDockTabs(dm.panel);
    if (!show) { dm._shown = false; return; }
    if (!dm._shown) { dm._shown = true; dm._tick = 0; this.renderDronePanel(); }
    dm._tick++;
    if (dm._tick % 20 === 1) dm.cred.textContent = Math.round(s.credits);   // ~3Hz credits tick
  },
  _drEl(cls, text, parent) {
    const el = document.createElement(cls.startsWith("btn:") ? "button" : "div");
    el.className = cls.replace("btn:", "");
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  },
  _canAffordDrones(spec, count) {
    const s = this.state;
    if (s.credits < spec.cost * count) return false;
    return spec.materials.every(m => (s.refinedBars[m.type] || 0) >= m.n * count);
  },

  renderDronePanel() {
    const dm = this._droneDOM(); if (!dm) return;
    const s = this.state, ui = this._drUI;
    dm.cred.textContent = Math.round(s.credits);

    // ---- refinery: raw ore counts + bar stock ----
    dm.ores.innerHTML = ""; dm.bars.innerHTML = "";
    for (const t of DRONES.barTypes) {
      const ring = CONFIG.rings.find(r => r.type === t);
      const ore = this._drEl("drPill", null, dm.ores);
      const dot = this._drEl("drDot", null, ore); dot.style.background = ring.col;
      this._drEl("drPillTxt", `${t} ore ×${(s.ore[t] && s.ore[t].count) || 0}`, ore);
      const bar = this._drEl("drPill", null, dm.bars);
      const sq = this._drEl("drSq", null, bar); sq.style.background = ring.col;
      this._drEl("drPillTxt", `${t} bars ×${s.refinedBars[t] || 0}`, bar);
    }

    // ---- DRONES: tier cards (single build; owned cap DRONES.ownedMax) ----
    dm.tiers.innerHTML = "";
    const full = s.playerFleet.length >= DRONES.ownedMax;
    DRONES.tiers.forEach((spec, ti) => {
      const card = this._drEl("drCard" + (ui.tier === ti ? " sel" : "") +
        (full || !this._canAffordDrones(spec, 1) ? " cant" : ""), null, dm.tiers);
      card.dataset.tier = String(ti);
      this._drEl("drCardName", `T${ti} · ${spec.name}`, card);
      const mats = spec.materials.map(m => `${m.n} ${m.type} bar${m.n > 1 ? "s" : ""}`).join(" + ");
      this._drEl("drCardLine", `cost ${spec.cost}cr + ${mats}`, card);
      // show the stats the drone will ACTUALLY have with the player's drone skills
      const dsk = (s.derived && s.derived.droneSkill) || {};
      const eHp = Math.round(spec.maxHp * (dsk.hullMult || 1)), eSh = Math.round(spec.maxShield * (dsk.shieldMult || 1));
      this._drEl("drCardLine", `HP ${eHp}  Shield ${eSh}`, card);
      const w = spec.loadout.find(m => m.type === "weapon");
      if (w) this._drEl("drCardLine dim", `weapon: ${w.name} (${Math.round(w.dmg * (dsk.dmgMult || 1) * 10) / 10} dmg)`, card);
    });
    const cap = document.getElementById("drCap");
    if (cap) cap.textContent = `owned ${s.playerFleet.length}/${DRONES.ownedMax} · escorts ${this.escorts(s).length}/${FLEET.max}`;

    // ---- owned-drone list: role + HP, SALVAGE for parts (50% back) ----
    if (dm.list) {
      dm.list.innerHTML = "";
      if (!s.playerFleet.length) this._drEl("ghNote", "No drones yet — build one above.", dm.list);
      s.playerFleet.forEach((d, fi) => {
        const row = this._drEl("drDrone", null, dm.list);
        this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, row);
        this._drEl("drRoute", (d.role || "hangar").toUpperCase() + " · HP " + Math.round(d.hp) + "/" + d.maxHp, row);
        const out = this._drEl("drBarOut", null, row);
        const fill = this._drEl("drBarFill flHp", null, out);
        fill.style.width = Math.round(clamp(d.hp / d.maxHp, 0, 1) * 100) + "%";
        const sv = this._drEl("btn:ghBtn flRemove", "SALVAGE", row);
        sv.dataset.salvage = String(fi);
        if (d.role === "trade") sv.disabled = true;
      });
    }
  },

  // buy a hull: gate on progression (SHIPS market unlocks), spend credits, add
  // a fresh empty-rack ship to s.ships. buyShipUpgrade (ships.js) wraps this
  // with the module transfer + switch; opts.quiet skips the delivery toast.
  buyShip(hullKey, opts) {
    const s = this.state, hull = CONFIG.hulls[hullKey];
    if (!hull) return { ok: false, reason: "no such hull" };
    if (!hull.cost) return { ok: false, reason: "not for sale" };
    if (!s.docked) { toast("ship purchases need a dock"); sfx("warn"); return { ok: false, reason: "not docked" }; }
    if (s.ships.some(sh => sh.hullKey === hullKey)) return { ok: false, reason: "already owned" };
    const un = this.shipUnlockStatus(hullKey);
    if (!un.unlocked) { toast("LOCKED — " + un.req, "#ff8a8a"); sfx("warn"); return { ok: false, reason: "locked" }; }
    if (s.credits < hull.cost.credits) { toast(`need ${hull.cost.credits}cr`); sfx("warn"); return { ok: false, reason: "credits" }; }
    s.credits -= hull.cost.credits;
    const ship = { id: this._nextShipId++, hullKey, name: hull.name, slots: new Array(CONFIG.equipSlots).fill(null) };
    s.ships.push(ship);
    if (!(opts && opts.quiet)) { toast("★ " + hull.name + " delivered — fit it in LOADOUT", "#ffd24a"); sfx("buy"); }
    this.saveGame();   // auto-save: hull purchases are progress worth keeping
    return { ok: true, ship };
  },

  // ---- DOM event wiring (boot-time, non-headless) ----
  wireDroneDOM() {
    const dm = this._droneDOM(); if (!dm) return;
    dm.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const undock = document.getElementById("drUndock");
    if (undock) undock.addEventListener("click", () => { input.closeMenu = true; });
    const refine = document.getElementById("drRefine");
    if (refine) refine.addEventListener("click", () => { this.refineAllOre(); this.renderDronePanel(); });
    dm.tiers.addEventListener("click", (e) => {
      const card = e.target.closest ? e.target.closest(".drCard") : null;
      if (!card) return;
      this._drUI.tier = +card.dataset.tier; this.renderDronePanel();
    });
    const build = document.getElementById("drBuild");
    if (build) build.addEventListener("click", () => {
      this.buildDrone(this._drUI.tier);
      this.renderDronePanel();
    });
    // owned-drone list: SALVAGE → confirm modal (an Armored scrap is a big loss)
    if (dm.list) dm.list.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("[data-salvage]") : null;
      if (!btn || btn.disabled) return;
      const fi = +btn.dataset.salvage, d = this.state.playerFleet[fi];
      if (!d) return;
      const spec = DRONES.tiers[d.tier], frac = DRONES.salvageFrac;
      const crBack = Math.floor((spec.cost || 0) * frac);
      const barBack = spec.materials.map(m => `${Math.floor(m.n * frac)} ${m.type}`).filter(x => !x.startsWith("0 ")).join(" + ") || "no bars";
      const mods = (d.loadout || []).filter(m => m && m.srcItem).length;
      const rows = [["refund", `+${crBack}cr · ${barBack}`]];
      if (mods) rows.push(["modules returned", `${mods} to cargo`]);
      this._ghOpenModal({ name: "Salvage " + spec.name + " Drone", tier: "normal", cat: "material" }, {
        moduleRows: rows,
        confirm: { label: "SALVAGE", danger: true, onYes: () => { this.salvageDrone(fi); this.renderDronePanel(); } },
      });
    });
  },
});
