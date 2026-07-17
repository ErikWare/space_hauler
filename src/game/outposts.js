/*=== HARNESS:OUTPOSTS =======================================================*/
// Faction outposts — the settled layer of the region map, and the territory
// game. ~1-in-5 regions gets an outpost via organic min-distance placement (no
// grid feel). Each is owned by its region's faction and garrisoned by 3
// stationary IDLE guards (ForgeFaction ships — passive until provoked, so you
// can dock and trade freely). Dock to TURN IN tows for credits locally (raw
// price; full price at outposts you own). Kill the guards → dock captures the
// outpost and claims its region. Owned outposts accept up to 3 purchased guard
// drones (tap the outpost while docked). Hold more than reclaimFreeHolds and
// the factions send reconquest waves — real squads if you're there to fight,
// abstract drone-defense resolution if you're not.
SPRITES.define("outpost", { w: 96, h: 96, brief: "small hex outpost platform, 3/4 iso",
  bake(g, w, h) {
    const cx = 48, cy = 52, rx = 30, ry = 13;
    g.strokeStyle = "#3a4658"; g.lineWidth = 7;
    g.beginPath(); g.ellipse(cx, cy + 2, rx, ry, 0, 0, TAU); g.stroke();
    g.strokeStyle = "#7d8ba3"; g.lineWidth = 5;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5;
      g.strokeStyle = "#55688a"; g.lineWidth = 3; g.beginPath();
      g.moveTo(cx, cy - 12); g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); g.stroke(); }
    g.fillStyle = "#232c3e"; g.beginPath(); g.arc(cx, cy - 12, 9, 0, TAU); g.fill();
    g.strokeStyle = "#9db8d9"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#ffd24a"; g.beginPath(); g.arc(cx, cy - 12, 3.2, 0, TAU); g.fill();
  },
});

Object.assign(GAME, {
  outpostById(id) { return this.state.outposts.find(o => o.id === id); },
  outpostFactionCol(o) {
    if (o.owner === "player") return "#22cccc";   // player faction cyan
    return { vex: "#4ad2ff", krag: "#ffb040", nox: "#b06cff" }[o.owner] || "#9aa7b8";
  },

  // organic placement: shuffled regions, min-distance rejection — settlements
  // cluster loosely and drift off cell centers, never reading as a grid.
  seedOutposts() {
    const s = this.state, C = CONFIG, half = C.sectorSize / 2;
    s.outposts = [];
    const order = s.regions.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    let nid = 1;
    for (const region of order) {
      if (region.event && region.event.type === "station") continue;   // main hubs keep their region
      if (region.dist < 6000) continue;                                // not in the star's glare
      const a = rnd() * TAU, jd = half * (0.25 + rnd() * 0.7);         // drift toward cell edges/borders
      const x = region.cx + Math.cos(a) * jd, y = region.cy + Math.sin(a) * jd;
      if (!s.outposts.every(o => this.dist(x, y, o.x, o.y) >= C.outpostMinDist)) continue;
      if (!this._stationClear(x, y, 2500)) continue;
      // turret bite scales with the wedge's sec rating: 6dmg/600u in danger 1
      // up to ~17dmg/1000u in danger 9 (guards scale on stream-in the same way)
      const dl = getDangerLevel(x, y);
      const o = { id: "op" + (nid++), kind: "outpost", x, y, regionId: region.id,
        faction: region.faction, owner: region.faction, dangerLevel: dl,
        discovered: false, provoked: false, capturable: false, streamed: false,
        shieldMax: 300, shield: 300,
        armorMax: 200, armor: 200,
        hullMax: 150, hull: 150,
        shieldRegen: 5,
        turretCooldown: 0, turretFireRate: 3000,
        turretDmg: Math.round(6 * dangerEnemyMult(dl).dmg * 10) / 10,
        turretRange: 600 + (dl - 1) * 50,
        guardRecs: [{ frac: 1, alive: true }, { frac: 1, alive: true }, { frac: 1, alive: true }],
        _ships: [], droneGuards: [], underAttack: null,
        modules: [], stationedDrones: [] };
      // fortify recompute rebuilds from this pristine block (modules stack on top)
      o._def0 = { shieldMax: o.shieldMax, armorMax: o.armorMax, hullMax: o.hullMax,
                  shieldRegen: o.shieldRegen, turretDmg: o.turretDmg, turretRange: o.turretRange };
      s.outposts.push(o);
      region.outpostId = o.id;
      region.event = region.event || { type: "outpost", id: o.id };
    }
    this.computeOutpostNeighbors();   // local-neighbor graph for trade routes (game/trade_routes.js)
  },

  // ---- guard streaming (same philosophy as fields: abstract records when far,
  // real ForgeFaction ships in s.aliens when the ship is close) ----
  _streamGuardsIn(o) {
    if (o.streamed) return;
    o.streamed = true; o._ships = [];
    if (o.owner === "player") return;                     // player outposts use drone guards
    const alive = o.guardRecs.filter(r => r.alive);
    if (!alive.length) { o.capturable = true; return; }
    const grp = ForgeFaction.generateGroup(o.faction, { x: o.x, y: o.y }, { rng: rnd, followerCount: 2, leaderTier: "rare" });
    const ships = [grp.leader, grp.followers[0], grp.followers[1]];
    const s = this.state, dl = o.dangerLevel || getDangerLevel(o.x, o.y);
    for (let i = 0; i < 3; i++) {
      const rec = o.guardRecs[i], ship = ships[i];
      if (!rec.alive) continue;
      applyDangerToShip(ship, dl);   // scale full pools first, then the saved frac
      const a = i / 3 * TAU + 0.7;
      ship.x = o.x + Math.cos(a) * 170; ship.y = o.y + Math.sin(a) * 170;
      ship.hp.shield *= rec.frac; ship.hp.armor *= rec.frac; ship.hp.hull *= rec.frac;
      ship._outpostId = o.id; ship._guardIdx = i;
      s.aliens.push(ship); o._ships.push(ship);
      if (o.provoked) ForgeFaction.activateGroup(ship, s.aliens);
    }
  },
  _streamGuardsOut(o) {
    if (!o.streamed) return;
    const s = this.state;
    for (const ship of o._ships) {
      const rec = o.guardRecs[ship._guardIdx];
      rec.frac = Math.max(0, ship.hp.hull / ship.hp.hullMax);
      rec.alive = ship.hp.hull > 0 && ship.state !== "DEAD";
    }
    s.aliens = s.aliens.filter(a => a._outpostId !== o.id);
    o._ships = []; o.streamed = false;
  },

  // dock turn-in: tows are stowed into cargo (raw ore + salvage), same as a
  // station — the player then chooses to sell raw or refine into bars, rather
  // than the outpost auto-selling rocks the instant they arrive.
  _outpostTurnIn(o) {
    const got = this.depositTows();
    if (got.ore) toast(`stored +${got.ore} ore`, "#7bd88f");
    if (got.mods) toast(`+${got.mods} salvage`, "#ffd27a");
    if (got.ore || got.mods) sfx("sell");
  },

  captureOutpost(o) {
    const s = this.state, region = this.regionGet(o.regionId);
    o.owner = "player"; o.capturable = false; o.provoked = false;
    o.droneGuards = []; o.underAttack = null;
    if (!o.modules) o.modules = [];
    if (!o.stationedDrones) o.stationedDrones = [];
    this._streamGuardsOut(o);
    o.guardRecs.forEach(r => { r.alive = false; r.frac = 0; });
    // the platform is repaired under new management (fresh 300/200/150 pools)
    this.recomputeOutpostDefense(o);
    o.shield = o.shieldMax; o.armor = o.armorMax; o.hull = o.hullMax;
    if (region) region.owner = "player";
    // capture spoils: the garrison's strongbox + 2 salvage items, both scaled
    // by the wedge's sec rating (danger tier table + credit multiplier)
    const dl = o.dangerLevel || getDangerLevel(o.x, o.y);
    const spoils = Math.round(120 * dangerLootMult(dl).credits);
    s.credits += spoils;
    GAME.addXpFromCredits(spoils); GAME.addXp(SKILLS.captureFlat);   // XP: taking an outpost (spoils + flat milestone)
    for (let k = 0; k < 2; k++) {
      const roll = ForgeItemSystem.rollTier("junk_crate", { rng: rnd });
      if (!roll.baseType) continue;
      s.loot.push({ x: o.x + (rnd() - 0.5) * 160, y: o.y + (rnd() - 0.5) * 160,
        vx: (rnd() - 0.5) * 20, vy: (rnd() - 0.5) * 20,
        item: ForgeItemSystem.generateItem(roll.baseType, rollDangerTier(dl, rnd), { ilvl: dl, rng: rnd }), t: 0 });
    }
    toast("★ OUTPOST " + this.regionLabel(region) + " CAPTURED  +" + spoils + "cr", "#22cccc"); AUDIO.play("capture");
    toast("tap outpost to station a guard drone", "#9aa7b8");
    s.capturedOutpostCount = (s.capturedOutpostCount || 0) + 1;   // lifetime unlock stat
    if (this.onOutpostCaptured) this.onOutpostCaptured(o);   // faction politics news wire
    this.saveGame();   // auto-save: an outpost capture is progress worth keeping
  },
  // Battering the platform's hull to 0 doesn't destroy it — it flips it. Same
  // spoils/news-wire path as a guards-down capture, plus an explicit headline.
  _captureOutpostByForce(o) {
    const s = this.state;
    if (o.owner === "player") return;
    this.captureOutpost(o);
    this.pushEvent(s, this._polOutpostName(o) + " captured by player!", "#22cccc");
    if (ForgeCombat.getLock().targetId === o.id) ForgeCombat.clearLock();
  },

  // ---- FORTIFY: modules + stationed companion drones on player outposts ----
  // Defense stats rebuild from the seeded _def0 block each time the module rack
  // changes: shield/armor/hull caps and regen read the same item attributes the
  // ship rack uses (_sumAttr over base_stats + specials); fitted weapons stack
  // their average per-layer damage onto the turret.
  recomputeOutpostDefense(o) {
    const base = o._def0 || { shieldMax: 300, armorMax: 200, hullMax: 150,
                              shieldRegen: 5, turretDmg: o.turretDmg || 6, turretRange: o.turretRange || 600 };
    const mods = (o.modules || []).filter(Boolean);
    const pct = k => this._sumAttr(mods, k) / 100;
    const flat = k => this._sumAttr(mods, k);
    o.shieldMax = Math.round(base.shieldMax * (1 + pct("shield_cap_pct")));
    o.armorMax = Math.round(base.armorMax * (1 + pct("armor_hp_pct")) + flat("armor_hp"));
    o.hullMax = Math.round(base.hullMax * (1 + pct("hull_hp_pct")) + flat("hull_hp"));
    o.shieldRegen = Math.round((base.shieldRegen * (1 + pct("shield_regen_pct")) + flat("shield_regen")) * 10) / 10;
    let tdmg = base.turretDmg * (1 + pct("damage_pct"));
    for (const m of mods) if (m.weapon)
      tdmg += 10 * (m.weapon.dmgShield + m.weapon.dmgArmor + (m.weapon.dmgHull || 0)) / 3;
    o.turretDmg = Math.round(tdmg * 10) / 10;
    o.turretRange = base.turretRange;
    o.shield = Math.min(o.shield, o.shieldMax);
    o.armor = Math.min(o.armor, o.armorMax);
    o.hull = Math.min(o.hull, o.hullMax);
    return o;
  },
  fortifyEquipModule(o, invIdx) {
    const s = this.state, item = s.inventory[invIdx];
    if (!o || o.owner !== "player" || !item) return false;
    if (!o.modules) o.modules = [];
    if (o.modules.length >= CONFIG.outpostModuleSlots) { toast(`all ${CONFIG.outpostModuleSlots} hardpoints fitted`); sfx("warn"); return false; }
    s.inventory.splice(invIdx, 1);
    o.modules.push(item);
    this.recomputeOutpostDefense(o);
    toast("outpost fitted: " + item.name, "#22cccc"); sfx("grab");
    return true;
  },
  fortifyUnequipModule(o, slotIdx) {
    const s = this.state;
    if (!o || !o.modules || !o.modules[slotIdx]) return false;
    s.inventory.push(o.modules[slotIdx]);
    o.modules.splice(slotIdx, 1);
    this.recomputeOutpostDefense(o);
    sfx("drop"); toast("module returned to cargo");
    return true;
  },
  // Move a companion drone from the player fleet into an outpost berth. The
  // drone struct transfers wholesale (same trick as Phase 5 lifted Phase 3's).
  assignDroneToOutpost(o, fleetIdx) {
    const s = this.state, d = s.playerFleet[fleetIdx];
    if (!o || o.owner !== "player") return { ok: false, reason: "not yours" };
    if (!d) return { ok: false, reason: "no such drone" };
    if (d.role === "trade") { toast("drone is mid trade run"); sfx("warn"); return { ok: false, reason: "on a trade run" }; }
    if (!o.stationedDrones) o.stationedDrones = [];
    if (o.stationedDrones.length >= CONFIG.outpostStationedMax) { toast(`outpost berths full (${CONFIG.outpostStationedMax})`); sfx("warn"); return { ok: false, reason: "berths full" }; }
    s.playerFleet.splice(fleetIdx, 1);
    d.role = "stationed"; d.state = "stationed"; d.outpostId = o.id;
    d.formationIdx = null; d.targetAlienId = null; d.wcd = 0;
    d.x = o.x; d.y = o.y; d.vx = 0; d.vy = 0;
    o.stationedDrones.push(d);
    this.reindexFormation(s);
    toast(`drone stationed (${o.stationedDrones.length}/${CONFIG.outpostStationedMax})`, "#22cccc"); sfx("buy");
    return { ok: true };
  },
  recallDroneFromOutpost(o, idx) {
    const s = this.state, d = o && o.stationedDrones && o.stationedDrones[idx];
    if (!d) return { ok: false, reason: "no drone in that berth" };
    if (s.playerFleet.length >= DRONES.ownedMax) { toast(`fleet full (${DRONES.ownedMax})`); sfx("warn"); return { ok: false, reason: "fleet full" }; }
    o.stationedDrones.splice(idx, 1);
    d.role = "hangar"; d.state = "follow"; delete d.outpostId;
    d.targetAlienId = null; d.x = s.x; d.y = s.y; d.vx = 0; d.vy = 0;
    s.playerFleet.push(d);
    this.reindexFormation(s);
    toast("drone recalled to your fleet"); sfx("drop");
    return { ok: true };
  },
  // Recall a berthed drone when the hangar is already full: a chosen fleet drone
  // takes its place in the berth (net counts preserved). Both keep their loadouts.
  recallDroneWithSwap(o, berthIdx, fleetIdx) {
    const s = this.state;
    const berthed = o && o.stationedDrones && o.stationedDrones[berthIdx];
    const swap = s.playerFleet[fleetIdx];
    if (!berthed) return { ok: false, reason: "no drone in that berth" };
    if (!swap) return { ok: false, reason: "no such drone" };
    if (swap.role === "trade") { toast("drone is mid trade run"); sfx("warn"); return { ok: false, reason: "on a trade run" }; }
    // splice both out first so indices don't invalidate, then place the swaps
    s.playerFleet.splice(fleetIdx, 1);
    o.stationedDrones.splice(berthIdx, 1);
    swap.role = "stationed"; swap.state = "stationed"; swap.outpostId = o.id;
    swap.formationIdx = null; swap.targetAlienId = null; swap.wcd = 0;
    swap.x = o.x; swap.y = o.y; swap.vx = 0; swap.vy = 0;
    o.stationedDrones.splice(berthIdx, 0, swap);
    berthed.role = "hangar"; berthed.state = "follow"; delete berthed.outpostId;
    berthed.targetAlienId = null; berthed.x = s.x; berthed.y = s.y; berthed.vx = 0; berthed.vy = 0;
    s.playerFleet.push(berthed);
    this.reindexFormation(s);
    toast("drones swapped — berth held, companion recalled", "#22cccc"); sfx("drop");
    return { ok: true };
  },
  // Stationed-drone defense AI: enemies inside outpostDefendR launch the wing
  // (companion combat behavior, tethered to the platform); a cleared perimeter
  // sends them home to re-station. Runs only while the player is near enough
  // for the local sim to be live (same streaming philosophy as the guards).
  updateOutpostDefense(o, dt) {
    const s = this.state, drones = o.stationedDrones;
    if (!drones || !drones.length) return;
    const R = CONFIG.outpostDefendR;
    let threat = false;
    for (const al of s.aliens) {
      if (al.state === "DEAD" || al.hp.hull <= 0) continue;
      if (this.dist(o.x, o.y, al.x, al.y) < R) { threat = true; break; }
    }
    for (let di = 0; di < drones.length; di++) {
      const d = drones[di];
      if (d.state === "trade") continue;   // mid-flight freighter — the trade sim owns it (and recalls it home when the outpost is under attack)
      d.wcd = Math.max(0, (d.wcd || 0) - dt);
      if (threat && d.state !== "defend") { d.state = "defend"; d.targetAlienId = null; }
      else if (!threat && d.state === "defend") { d.state = "return"; d.targetAlienId = null; }

      if (d.state === "defend") {
        let tgt = d.targetAlienId != null ? s.aliens.find(a => a.id === d.targetAlienId && a.state !== "DEAD" && a.hp.hull > 0) : null;
        if (tgt && this.dist(o.x, o.y, tgt.x, tgt.y) > R * 1.5) tgt = null;   // never chase past the perimeter
        if (!tgt) {
          let bd = R;
          for (const al of s.aliens) {
            if (al.state === "DEAD" || al.hp.hull <= 0) continue;
            const ad = this.dist(o.x, o.y, al.x, al.y);
            if (ad < bd) { bd = ad; tgt = al; }
          }
          d.targetAlienId = tgt ? tgt.id : null;
        }
        if (tgt) {
          const ws = d.loadout.filter(m => m.type === "weapon");
          if (ws.length && d.wcd <= 0 && this.dist(d.x, d.y, tgt.x, tgt.y) <= FLEET.fireRange) {
            const dmg = ws.reduce((a, w) => a + w.dmg, 0);   // w.dmg already baked with drone-skill boost (reapplyDroneStats)
            ForgeCombat.applyDamage(tgt, dmg, dmg, dmg);
            d.wcd = 1 / (ws[0].fireRate || 1);
            burst(tgt.x, tgt.y, "#22cccc", 3);
            if (tgt.hp.hull <= 0) this.onAlienKilled(tgt);
          }
          this._outpostDroneMove(d, tgt.x, tgt.y, FLEET.standoff, dt);
        } else this._outpostDroneMove(d, o.x, o.y, 40, dt);
      } else if (d.state === "return") {
        this._outpostDroneMove(d, o.x, o.y, 0, dt);
        if (this.dist(d.x, d.y, o.x, o.y) < 40) { d.state = "stationed"; d.vx = d.vy = 0; d.targetAlienId = null; }
      } else {
        d.state = "stationed";
        // parked: slow orbit for the renderer + loadout repair ticks
        const a = s.t * 0.5 + di / CONFIG.outpostStationedMax * TAU;
        d.x = o.x + Math.cos(a) * 60; d.y = o.y + Math.sin(a) * 60; d.vx = d.vy = 0;
        for (const m of d.loadout) {
          if (m.type === "repair") d.hp = Math.min(d.maxHp, d.hp + m.amount * dt);
          else if (m.type === "utility") d.shield = Math.min(d.maxShield, d.shield + m.amount * dt);
        }
      }
    }
  },
  _outpostDroneMove(d, gx, gy, standoff, dt) {
    let dvx = gx - d.x, dvy = gy - d.y;
    const dm = Math.hypot(dvx, dvy);
    if (standoff && dm <= standoff) { dvx = 0; dvy = 0; }
    else if (dm > FLEET.maxSpeed) { dvx = dvx / dm * FLEET.maxSpeed; dvy = dvy / dm * FLEET.maxSpeed; }
    const keep = Math.pow(FLEET.damping, dt * 60);
    d.vx = (d.vx || 0) * keep + dvx * (1 - keep);
    d.vy = (d.vy || 0) * keep + dvy * (1 - keep);
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > FLEET.maxSpeed) { d.vx = d.vx / sp * FLEET.maxSpeed; d.vy = d.vy / sp * FLEET.maxSpeed; }
    d.x += d.vx * dt; d.y += d.vy * dt;
  },
  buyOutpostDrone(o) {
    const s = this.state, n = o.droneGuards.length;
    if (o.owner !== "player") return false;
    if (n >= CONFIG.outpostDroneMax) { toast("outpost garrison full"); return false; }
    const cost = CONFIG.outpostDroneCosts[n];
    if (s.credits < cost) { toast(`need ${cost}cr for a guard drone`, "#ff6b6b"); return false; }
    s.credits -= cost;
    o.droneGuards.push({ hp: CONFIG.outpostDroneHp, hpMax: CONFIG.outpostDroneHp, tier: n + 1 });
    toast(`guard drone stationed (${o.droneGuards.length}/${CONFIG.outpostDroneMax})`, "#57d1c9"); sfx("buy");
    return true;
  },
  pickOutpostAt(sx, sy) {   // screen tap → docked-at outpost (for drone purchase)
    const s = this.state, z = s.cam.zoom;
    for (const o of s.outposts) {
      if (this.dist(s.x, s.y, o.x, o.y) > CONFIG.outpostDockR) continue;
      const p = this.S(o.x, o.y);
      if (Math.hypot(p.x - sx, p.y - sy) < Math.max(CONFIG.tapPickR, 34 * z)) return o;
    }
    return null;
  },

  // ---- faction reconquest: hold few, fly free; hold many, defend them ----
  _ownedOutposts() { return this.state.outposts.filter(o => o.owner === "player"); },
  _scheduleReclaim(dt) {
    const s = this.state, C = CONFIG, owned = this._ownedOutposts();
    if (owned.length <= C.reclaimFreeHolds) { s._reclaimT = null; return; }
    if (s._reclaimT == null) {
      const heat = Math.min(1, (owned.length - C.reclaimFreeHolds) / (C.reclaimHeavyHolds - C.reclaimFreeHolds));
      s._reclaimT = C.reclaimWaveMax - (C.reclaimWaveMax - C.reclaimWaveMin) * heat;
    }
    s._reclaimT -= dt;
    if (s._reclaimT > 0) return;
    s._reclaimT = null;
    const target = owned[(rnd() * owned.length) | 0];
    const excess = owned.length - C.reclaimFreeHolds;
    const strength = Math.min(6, 1 + excess + (owned.length >= C.reclaimHeavyHolds ? 2 : 0));
    const region = this.regionGet(target.regionId);
    target.underAttack = { strength, t: C.reclaimResolveT, aliens: null };
    toast("⚠ " + (target.faction || "").toUpperCase() + " strike force en route to " + this.regionLabel(region), "#ff6b6b");
    sfx("warn");
  },
  _tickReclaim(o, dt) {
    const s = this.state, atk = o.underAttack;
    if (!atk) return;
    if (atk.aliens) {   // live battle — repelled when the whole squad is down
      if (atk.aliens.every(a => a.state === "DEAD" || a.hp.hull <= 0)) {
        o.underAttack = null;
        toast("★ raid on " + this.regionLabel(this.regionGet(o.regionId)) + " repelled", "#57d1c9"); sfx("sell");
      }
      return;
    }
    atk.t -= dt;
    if (atk.t > 0) return;
    if (this.dist(s.x, s.y, o.x, o.y) < CONFIG.outpostGuardStreamR) {
      // player is on-site: the raid is a real fight
      const grp = ForgeFaction.generateGroup(o.faction, { x: o.x + 900, y: o.y + 900 },
        { rng: rnd, followerCount: Math.min(4, 1 + atk.strength) });
      const squad = [grp.leader, ...grp.followers];
      for (const a of squad) { a._raidOutpostId = o.id; s.aliens.push(a); }
      ForgeFaction.activateGroup(grp.leader, s.aliens);
      atk.aliens = squad;
      toast("⚠ raiders on site — defend the outpost!", "#ff6b6b"); sfx("warn");
      return;
    }
    // player absent: drones absorb the wave abstractly (guards first, then any
    // FORTIFY-stationed companions — those die for real if they run dry)
    let dmg = atk.strength * CONFIG.reclaimDmgPerStrength;
    while (dmg > 0 && o.droneGuards.length) {
      const d0 = o.droneGuards[0], soak = Math.min(d0.hp, dmg);
      d0.hp -= soak; dmg -= soak;
      if (d0.hp <= 0) o.droneGuards.shift();
    }
    while (dmg > 0 && o.stationedDrones && o.stationedDrones.length) {
      const d0 = o.stationedDrones[0], soak = Math.min(d0.hp, dmg);
      d0.hp -= soak; dmg -= soak;
      if (d0.hp <= 0) { o.stationedDrones.shift(); toast("✖ stationed drone destroyed", "#ff6b6b"); }
    }
    o.underAttack = null;
    const region = this.regionGet(o.regionId);
    if (dmg > 0) {   // defenses fell — the faction takes it back
      o.owner = o.faction; o.droneGuards = [];
      o.guardRecs.forEach(r => { r.alive = true; r.frac = 1; });
      // surviving stationed companions escape home; fitted modules are seized
      if (o.stationedDrones && o.stationedDrones.length) {
        for (const d of o.stationedDrones) {
          d.role = "hangar"; d.state = "follow"; delete d.outpostId;
          delete d.route;   // a mid-route/recalling freighter drops its trade leg
          d.targetAlienId = null; s.playerFleet.push(d);
        }
        toast("stationed drones escaped to your fleet", "#22cccc");
        o.stationedDrones = [];
        this.reindexFormation(s);
      }
      o.modules = [];
      this.recomputeOutpostDefense(o);
      o.shield = o.shieldMax; o.armor = o.armorMax; o.hull = o.hullMax;   // new garrison repairs it
      if (region) region.owner = region.faction;
      if (o.streamed) { this._streamGuardsOut(o); }   // re-garrison on next approach
      toast("✖ OUTPOST " + this.regionLabel(region) + " LOST to " + (o.faction || "").toUpperCase(), "#ff6b6b"); sfx("boom");
      if (this.onOutpostLost) this.onOutpostLost(o);   // faction politics news wire
    } else {
      toast("★ drones held " + this.regionLabel(region) + " (" + o.droneGuards.length + " left)", "#57d1c9");
    }
  },

  updateOutposts(dt) {
    const s = this.state;
    if (!s.outposts || s.dead) return;
    const C = CONFIG, streamR = C.outpostGuardStreamR;
    this._scheduleReclaim(dt);
    s.atOutpost = null;   // refreshed below: owned outpost in dock range → DOCK button
    for (const o of s.outposts) {
      const d = this.dist(s.x, s.y, o.x, o.y);
      // safety net: any damage path that zeroes the hull flips the platform
      if (o.hull <= 0 && o.owner !== "player") this._captureOutpostByForce(o);
      if (!o.discovered && (d < C.fieldDiscoverR || this.isTileExplored(o.x, o.y))) {
        o.discovered = true;
        toast("◆ outpost sighted — " + this.regionLabel(this.regionGet(o.regionId)), this.outpostFactionCol(o));
      }
      if (!o.streamed && d < streamR) this._streamGuardsIn(o);
      else if (o.streamed && d > streamR + 1500) this._streamGuardsOut(o);
      if (o.streamed && !o.provoked) {
        // provoked the moment any guard takes damage or wakes (lock → activateGroup)
        for (const ship of o._ships)
          if (ship.hp.hull < ship.hp.hullMax || ship.aggro) { o.provoked = true; break; }
      }
      if (o.streamed && !o.capturable && o.owner !== "player" &&
          o._ships.every(sh => sh.state === "DEAD" || sh.hp.hull <= 0)) {
        o.capturable = true;
        toast("outpost defenses down — dock to capture", "#ffd24a"); sfx("sell");
      }
      // turret auto-fire: enemy platforms shoot the player; captured platforms
      // shoot the nearest hostile ship instead (only while the local sim is live)
      o.turretCooldown = Math.max(0, o.turretCooldown - dt * 1000);
      if (o.turretCooldown <= 0) {
        if (o.owner !== "player") {
          if (d < o.turretRange) {
            o.turretCooldown = o.turretFireRate;
            if (!s.outpostShots) s.outpostShots = [];
            const ang = Math.atan2(s.y - o.y, s.x - o.x);
            s.outpostShots.push({ x: o.x, y: o.y, vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180, dmg: o.turretDmg, life: 4000 });
          }
        } else if (d < streamR) {
          let tgt = null, td = o.turretRange;
          for (const al of s.aliens) {
            if (al.state === "DEAD" || al.hp.hull <= 0) continue;
            const ad = this.dist(o.x, o.y, al.x, al.y);
            if (ad < td) { td = ad; tgt = al; }
          }
          if (tgt) {
            o.turretCooldown = o.turretFireRate;
            if (!s.outpostShots) s.outpostShots = [];
            const ang = Math.atan2(tgt.y - o.y, tgt.x - o.x);
            s.outpostShots.push({ x: o.x, y: o.y, vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180, dmg: o.turretDmg, life: 4000, friendly: true });
          }
        }
      }
      // shield regen
      if (o.shield < o.shieldMax) o.shield = Math.min(o.shieldMax, o.shield + o.shieldRegen * dt / 1000);
      // FORTIFY-stationed drones defend the perimeter (streamed like the guards)
      if (o.owner === "player" && o.stationedDrones && o.stationedDrones.length && d < streamR + 1500)
        this.updateOutpostDefense(o, dt);

      const docked = d < C.outpostDockR;
      if (docked) {
        if (o.capturable && o.owner !== "player") this.captureOutpost(o);
        else if (s.tows.length && (o.owner === "player" || !o.provoked)) this._outpostTurnIn(o);
        if (o.owner === "player") s.atOutpost = o.id;   // DOCK opens the outpost menu
      }
      this._tickReclaim(o, dt);
    }
  },

  // ---- rendering: world sprite + drone ring + HUD banner ----
  drawOutposts(g, items, isWorldVisible, z) {
    const s = this.state, P = CONFIG.pitch;
    for (const o of s.outposts) {
      if (!o.discovered || !isWorldVisible(o.x, o.y, 120)) continue;
      const pt = this.S(o.x, o.y), col = this.outpostFactionCol(o);
      items.push({ y: o.y, f: () => {
        if (!ART.draw(g, o.owner === "player" ? "outpost_player" : "outpost_enemy", pt.x, pt.y, Math.max(42, 86 * z), 0))
          SPRITES.draw(g, "outpost", pt.x, pt.y, Math.max(0.35, z), 0);   // procedural fallback (headless / pre-load)
        // ownership ring — bright, readable at any zoom
        g.strokeStyle = col; g.lineWidth = Math.max(1.2, 2 * z); g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(pt.x, pt.y, Math.max(10, 34 * z), Math.max(10, 34 * z) * P, 0, 0, TAU); g.stroke();
        g.globalAlpha = 1;
        if (o.underAttack) { const pulse = 0.5 + 0.5 * Math.sin(s.t * 6);
          g.strokeStyle = `rgba(255,80,96,${0.4 + pulse * 0.5})`; g.lineWidth = Math.max(1.5, 3 * z);
          g.beginPath(); g.ellipse(pt.x, pt.y, Math.max(14, 46 * z), Math.max(14, 46 * z) * P, 0, 0, TAU); g.stroke(); }
        // stationed guard drones orbit as teal wedges
        for (let i = 0; i < o.droneGuards.length; i++) {
          const a = s.t * 0.7 + i / CONFIG.outpostDroneMax * TAU;
          const dx = pt.x + Math.cos(a) * 26 * Math.max(0.4, z), dy = pt.y + Math.sin(a) * 26 * Math.max(0.4, z) * P;
          g.fillStyle = "#57d1c9";
          g.beginPath(); g.moveTo(dx + 5, dy); g.lineTo(dx - 4, dy - 3.5); g.lineTo(dx - 4, dy + 3.5); g.closePath(); g.fill();
        }
        if (z > 0.10) { g.font = `bold ${Math.max(8, 10 * z) | 0}px monospace`; g.textAlign = "center";
          g.fillStyle = col;
          const tag = o.owner === "player" ? "★ " : "◆ ";
          g.fillText(tag + "OUTPOST " + this.regionLabel(this.regionGet(o.regionId)), pt.x, pt.y - 34 * z - 6);
          g.textAlign = "left"; }
      } });
    }
  },
  // FORTIFY-stationed drones (flat SF plane, like the fleet wingmen): cyan
  // triangles orbiting a held platform, breaking formation to engage raiders.
  drawOutpostDroneWorld(g) {
    if (HEADLESS) return;
    const s = this.state, z = s.cam.zoom, viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 900;
    for (const o of s.outposts) {
      if (o.owner !== "player" || !o.stationedDrones || !o.stationedDrones.length) continue;
      for (const d of o.stationedDrones) {
        // per-DRONE visibility: a mid-route freighter can be far from its home
        // outpost, so cull on the drone's own position, not the platform's
        if (this.dist(d.x, d.y, s.cam.x, s.cam.y) > viewR) continue;
        const p = this.SF(d.x, d.y), sz = 9 * z;
        if (d.state === "defend" && d.targetAlienId != null) {
          const t = s.aliens.find(a => a.id === d.targetAlienId);
          if (t) { const tp = this.SF(t.x, t.y);
            g.strokeStyle = "rgba(255,80,96,0.30)"; g.lineWidth = Math.max(0.8, 1 * z);
            g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(tp.x, tp.y); g.stroke(); }
        }
        const sp = Math.hypot(d.vx || 0, d.vy || 0);
        const ang = sp > 8 ? Math.atan2(d.vy, d.vx) : s.t * 0.5;
        g.fillStyle = (DRONES.tierCol && DRONES.tierCol[d.tier]) || "#22cccc"; g.strokeStyle = "#0d1017"; g.lineWidth = 1;   // colour by quality tier
        g.beginPath();
        g.moveTo(p.x + Math.cos(ang) * sz, p.y + Math.sin(ang) * sz);
        g.lineTo(p.x + Math.cos(ang + 2.5) * sz, p.y + Math.sin(ang + 2.5) * sz);
        g.lineTo(p.x + Math.cos(ang - 2.5) * sz, p.y + Math.sin(ang - 2.5) * sz);
        g.closePath(); g.fill(); g.stroke();
        const barW = 26 * z, barY = p.y - sz - 8 * z;
        g.fillStyle = "#1c2430"; g.fillRect(p.x - barW / 2, barY, barW, 3 * z);
        g.fillStyle = "#7bd88f"; g.fillRect(p.x - barW / 2, barY, barW * clamp(d.hp / d.maxHp, 0, 1), 3 * z);
      }
    }
  },
  drawOutpostHUD(g) {   // screen-space banners (called after the world pass)
    const s = this.state;
    if (!s.outposts) return;
    // global under-attack alert
    const hit = s.outposts.find(o => o.underAttack && o.owner === "player");
    if (hit) { const pulse = 0.6 + 0.4 * Math.sin(s.t * 5);
      g.font = "bold 13px monospace"; g.textAlign = "center";
      g.fillStyle = `rgba(255,80,96,${pulse})`;
      g.fillText("⚠ " + this.regionLabel(this.regionGet(hit.regionId)) + " UNDER ATTACK ⚠", CONFIG.W / 2, 92);
      g.textAlign = "left"; }
    // proximity banner for the nearest outpost
    let best = null, bd = 1600;
    for (const o of s.outposts) { if (!o.discovered) continue;
      const d = this.dist(s.x, s.y, o.x, o.y); if (d < bd) { bd = d; best = o; } }
    if (!best) return;
    const col = this.outpostFactionCol(best), docked = bd < CONFIG.outpostDockR;
    const label = "OUTPOST " + this.regionLabel(this.regionGet(best.regionId)) +
      (best.owner === "player" ? " — YOURS" : " — " + (best.owner || "").toUpperCase());
    const sub = best.owner === "player"
        ? (docked ? "DOCK: gear · store · fortify — tap platform: guard drone (" + best.droneGuards.length + "/" + CONFIG.outpostDroneMax + ")" : "your territory")
      : best.capturable ? "DEFENSES DOWN — dock to capture"
      : docked ? "turn-in active — drop tows to sell"
      : "dock to trade · attack the platform or guards to contest";
    g.font = "bold 12px monospace"; g.textAlign = "center";
    g.fillStyle = col; g.fillText("◆ " + label, CONFIG.W / 2, 110);
    g.font = "10px monospace"; g.fillStyle = "#9aa7b8"; g.fillText(sub, CONFIG.W / 2, 124);
    g.textAlign = "left";
  },
});
