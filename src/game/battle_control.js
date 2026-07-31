/*=== HARNESS:BATTLE_CONTROL =================================================*/
// DOTA-style control fantasy for 2×2 / 3×3 battle maps:
//   • capture outposts → fortify → station drones
//   • owned outposts unlock fog vision on that region
//   • REINFORCEMENT QUEUE (manual) — player builds/enqueues drones; they launch
//     from the RALLY outpost along trade-lane multi-hop paths to fill emptiest
//     berths first (rear-first; combat naturally opens gaps at the front)
//   • SEARCH & DESTROY — full (3) outposts sortie every 30s toward enemy outposts
//     (DOTA creep wave). Unlimited fuel on trade lanes / at outposts; finite fuel
//     off-lane → weapons/regen burn fuel → dry tank detonates
//   • RIVAL MIRROR — AI side auto-fills berths + S&D so grunt war can stalemate
// 1×1 deathmatch does NOT use this module.
const REINFORCE = {
  queueMax: 18,              // manual backlog (beyond 6-slot personal hangar)
  speed: 420,                // snappier lane transit (was 300 — felt sluggish)
  snDEvery: 28,              // global S&D countdown
  snDSpeed: 360,             // snappier creeps
  snDPatrolR: 900,
  snDFireR: null,            // FLEET.fireRange fallback
  snDFuelMult: 1.25,         // off-lane tank = maxFuel * this
  snDCruiseFuelPerS: 2.8,    // slightly shorter off-lane lives (less orphan spam)
  snDWeaponFuel: 1.0,
  snDRegenFuelPerS: 0.6,
  snDOutpostDmg: 0.55,
  snDVsPilotDmg: 0.35,
  snDMaxConcurrent: 4,       // iOS: fewer live combat AI agents
  rivalFillEvery: 8,
  rivalSnDEvery: 28,
  rivalMaxBerth: 3,
  rivalSnDMax: 4,            // mirror S&D cap
  transitChipPerS: 18,
  gruntNoKillPilot: true,
  visionEvery: 0.55,         // fog re-stamp interval (iOS fill-rate)
  toastQuiet: true,
  laneCol: "#57e6ff",
  transitCol: "#ffd24a",
  snDCol: "#ff9a3c",
  rallyCol: "#b06cff",
  rivalCol: "#ff6a5e",
};

// DOTA pacing for control maps: pilot kills are tempo (respawn + bounty), the
// match is decided by TERRITORY — feed outposts with drones/resources and
// slowly strangle the enemy network. Deathmatch ignores all of this.
const BATTLE_PACE = {
  respawnP2: 12,         // s before the AI pilot rebuilds at its rear outpost
  respawnGrow: 5,        // +s per prior death — late-game kills buy more time
  killBounty: 350,       // credits to the side that downs the enemy pilot
  deathPenalty: 150,     // credits the downed side loses
  incomeEvery: 12,       // s between territory stipends
  incomeCr: 30,          // credits per owned outpost per stipend
  incomeBars: 1,         // bars per owned outpost per stipend (player: copper)
  p2SiegePerS: 10,       // P2 pilot chew rate on platform hull (was 25 — too fast)
  junkFuel: 50,          // fuel per salvage floater hauled in (economy.js)
};

Object.assign(GAME, {
  isBattleControl() {
    const b = this.state && this.state.battle;
    if (!b || b.phase !== "match") return false;
    const def = BATTLE.kinds[b.kind];
    return !!(def && def.control);
  },
  isBattleDeathmatch() {
    const b = this.state && this.state.battle;
    if (!b) return false;
    const def = BATTLE.kinds[b.kind];
    return !!(def && def.deathmatch);
  },

  // ---- session reinforce state (not saved — battle only) --------------------
  _ensureBattleReinforce() {
    const b = this.state && this.state.battle;
    if (!b) return null;
    if (!b.reinforce) {
      b.reinforce = {
        queue: [],
        transit: [],
        snD: [],
        snDCd: REINFORCE.snDEvery,
        rallyId: null,           // player-chosen launch outpost
        // Rival mirror force (AI factory — not player-controllable)
        rival: {
          snD: [],
          snDCd: REINFORCE.rivalSnDEvery,
          fillT: REINFORCE.rivalFillEvery,
          starved: false,        // balance tests can starve AI
          // Mirror economy — spends like player builds (bars+credits abstract)
          credits: 6500,
          bars: 40,              // abstract refined bars pool
          buildCostCr: 25,       // basic drone credit cost
          buildCostBars: 2,
        },
      };
    } else if (!b.reinforce.rival) {
      b.reinforce.rival = {
        snD: [], snDCd: REINFORCE.rivalSnDEvery,
        fillT: REINFORCE.rivalFillEvery, starved: false,
        credits: 6500, bars: 40, buildCostCr: 25, buildCostBars: 2,
      };
    }
    return b.reinforce;
  },

  // ---- Vision (throttled — full re-stamp is tile-heavy) ----------------------
  updateBattleControlVision(force) {
    if (!this.isBattleControl()) return;
    const s = this.state, b = s.battle;
    if (!force) {
      b._visionAcc = (b._visionAcc || 0) + (b._visionDt != null ? b._visionDt : 0.016);
      b._visionDt = null;
      if (b._visionAcc < REINFORCE.visionEvery) return;
      b._visionAcc = 0;
    }
    if (!s.exploredTiles) s.exploredTiles = new Set();
    if (!s.scannedRegions) s.scannedRegions = new Set();
    const half = (CONFIG.sectorSize || 4000) * 0.45; // slightly tighter than full sector
    const nearR = Math.max(CONFIG.fogRevealR || 650, 700);
    for (const o of s.outposts || []) {
      if (o.owner !== "player") continue;
      this._battleRevealAround(o.x, o.y, nearR);
      const reg = this.regionGet(o.regionId);
      if (reg) {
        s.scannedRegions.add(reg.id);
        this._battleRevealAround(reg.cx, reg.cy, half);
      }
      o.discovered = true;
    }
  },

  _battleRevealAround(wx, wy, R) {
    const s = this.state, t = CONFIG.FOG_TILE || 400, R2 = R * R;
    const span = Math.ceil(R / t);
    const tx = Math.floor(wx / t), ty = Math.floor(wy / t);
    // Coarser step when large R — fewer Set ops (feel + GC)
    const step = span > 6 ? 2 : 1;
    for (let dx = -span; dx <= span; dx += step) for (let dy = -span; dy <= span; dy += step) {
      const cxw = (tx + dx) * t + t / 2 - wx, cyw = (ty + dy) * t + t / 2 - wy;
      if (cxw * cxw + cyw * cyw <= R2) s.exploredTiles.add((tx + dx) + "," + (ty + dy));
    }
  },

  _battleToast(msg, col, dur) {
    if (REINFORCE.toastQuiet) {
      const s = this.state, b = s.battle;
      if (!b) { toast(msg, col, dur); return; }
      const now = s.t || 0;
      if (b._toastT && now - b._toastT < 1.2) return; // rate limit
      b._toastT = now;
    }
    toast(msg, col, dur);
  },

  bootstrapBattleControlEconomy() {
    if (!this.isBattleControl()) return;
    const s = this.state;
    // Enough to hand-build a wing + queue without free auto-spam
    s.credits = Math.max(s.credits || 0, 6500);
    s.refinedBars = s.refinedBars || {};
    for (const t of ["copper", "silver", "gold", "platinum"])
      s.refinedBars[t] = Math.max(s.refinedBars[t] || 0, 10);
    if (!s.battle.objectives) s.battle.objectives = {};
    s.battle.objectives.control = {
      outpostsPlayer: 0, outpostsRival: 0, outpostsNeutral: 0,
    };
    this._ensureBattleReinforce();
    // Homes already assigned at arena seed (player SW cluster, rival NE cluster).
    // Ensure rival outposts are fully owned; set rally to a player home node.
    for (const o of s.outposts || []) {
      if (o.homeSide === "p1" || o.owner === "player") {
        o.owner = "player"; o.capturable = false; o.discovered = true;
      } else if (o.homeSide === "p2" || o.owner === "rival") {
        o.owner = "rival"; o.capturable = false; o.discovered = true;
      }
    }
    this.refreshBattleLogisticsGraph();
    const home = (s.outposts || []).find(o => o.homeSide === "p1") || (s.outposts || []).find(o => o.owner === "player");
    if (home && typeof this.setBattleRally === "function") this.setBattleRally(home.id);
  },

  // ---- Graph / rally --------------------------------------------------------
  battleOwnedOutposts(owner) {
    owner = owner || "player";
    return (this.state.outposts || []).filter(o => o.owner === owner);
  },
  battleOwnedTradeNeighbors(o, owner) {
    if (!o) return [];
    owner = owner || o.owner || "player";
    return (o.neighborIds || []).map(id => this.outpostById(id))
      .filter(n => n && n.owner === owner);
  },
  // Full trade-lane connected component for an owner.
  battleTradeNetwork(rootId, owner) {
    const root = this.outpostById(rootId);
    if (!root) return new Set();
    owner = owner || root.owner;
    if (root.owner !== owner) return new Set();
    const seen = new Set([root.id]);
    const q = [root];
    while (q.length) {
      const cur = q.shift();
      for (const n of this.battleOwnedTradeNeighbors(cur, owner)) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        q.push(n);
      }
    }
    return seen;
  },
  battleLanePairs() {
    if (!this.isBattleControl()) return [];
    const pairs = [], seen = new Set();
    for (const o of this.battleOwnedOutposts("player")) {
      for (const n of this.battleOwnedTradeNeighbors(o, "player")) {
        const key = o.id < n.id ? o.id + "|" + n.id : n.id + "|" + o.id;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ a: o, b: n });
      }
    }
    return pairs;
  },
  battleReinforcePath(fromId, toId, owner) {
    if (fromId === toId) return [fromId];
    const start = this.outpostById(fromId), goal = this.outpostById(toId);
    if (!start || !goal) return [];
    owner = owner || start.owner;
    if (start.owner !== owner || goal.owner !== owner) return [];
    const prev = new Map();
    const q = [start];
    const seen = new Set([fromId]);
    while (q.length) {
      const cur = q.shift();
      if (cur.id === toId) break;
      for (const n of this.battleOwnedTradeNeighbors(cur, owner)) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        prev.set(n.id, cur.id);
        q.push(n);
      }
    }
    if (!seen.has(toId)) return [];
    const path = [toId];
    let cur = toId;
    while (cur !== fromId) {
      cur = prev.get(cur);
      if (cur == null) return [];
      path.push(cur);
    }
    path.reverse();
    return path;
  },

  // Recompute neighbor graph + repath network queues when ownership changes.
  refreshBattleLogisticsGraph() {
    if (typeof this.computeOutpostNeighbors === "function") this.computeOutpostNeighbors();
    const rf = this._ensureBattleReinforce();
    if (!rf) return;
    // Keep / fix rally
    if (rf.rallyId) {
      const r = this.outpostById(rf.rallyId);
      if (!r || r.owner !== "player") rf.rallyId = this._pickDefaultRally();
    } else {
      rf.rallyId = this._pickDefaultRally();
    }
    // Fold queues onto true roots + repath mid-flight legs
    if (typeof this.consolidateNetworkQueues === "function") this.consolidateNetworkQueues();
    if (this.allPlayerNetworkRoots) {
      for (const root of this.allPlayerNetworkRoots()) {
        const st = this.networkReinforceState && this.networkReinforceState(root, "player");
        if (!st) continue;
        for (const d of st.queue) {
          d.originId = rf.rallyId || root.id;
          const o = this.outpostById(d.originId);
          if (o && o.owner === "player") { d.x = o.x; d.y = o.y; }
        }
        for (let i = st.transit.length - 1; i >= 0; i--) {
          const t = st.transit[i];
          const dest = this.outpostById(t.destId);
          const origin = this.outpostById(t.originId || root.id);
          if (!dest || dest.owner !== "player" || !origin || origin.owner !== "player") {
            this._requeueReinforceDrone(t.drone, t.originId || root.id);
            st.transit.splice(i, 1);
            continue;
          }
          const path = this.networkReinforcePath
            ? this.networkReinforcePath(origin.id, dest.id, "player")
            : this.battleReinforcePath(origin.id, dest.id, "player");
          if (!path.length) {
            this._requeueReinforceDrone(t.drone, origin.id);
            st.transit.splice(i, 1);
            continue;
          }
          let hop = 0, bd = 1e12;
          for (let h = 0; h < path.length; h++) {
            const wp = this.outpostById(path[h]);
            if (!wp) continue;
            const dd = this.dist(t.drone.x, t.drone.y, wp.x, wp.y);
            if (dd < bd) { bd = dd; hop = h; }
          }
          t.path = path; t.hop = hop; t.originId = origin.id;
        }
      }
    }
    if (typeof this.updateNetworkReinforcements === "function" && !this.state.docked)
      this.updateNetworkReinforcements(0);
    if (this._syncBattleRfMirror) this._syncBattleRfMirror();
  },

  _pickDefaultRally() {
    const owned = this.battleOwnedOutposts("player");
    if (!owned.length) return null;
    // Prefer most "rear" = farthest average distance from non-player outposts
    let best = owned[0], bestScore = -1;
    for (const o of owned) {
      let score = 0, n = 0;
      for (const e of this.state.outposts || []) {
        if (e.owner === "player") continue;
        score += this.dist(o.x, o.y, e.x, e.y); n++;
      }
      score = n ? score / n : 0;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best.id;
  },

  setBattleRally(outpostId) {
    if (!this.isBattleControl()) return { ok: false, reason: "not control" };
    const o = this.outpostById(outpostId);
    if (!o || o.owner !== "player") {
      toast("rally must be an outpost you own", "#ff6b6b"); sfx("warn");
      return { ok: false, reason: "not yours" };
    }
    const rf = this._ensureBattleReinforce();
    rf.rallyId = o.id;
    // Restamp this network's queued drones to the new rally pad
    if (this.networkReinforceState) {
      const st = this.networkReinforceState(o, "player");
      if (st) for (const d of st.queue) { d.originId = o.id; d.x = o.x; d.y = o.y; }
    }
    toast("★ RALLY SET — reinforcements launch from " + this.regionLabel(this.regionGet(o.regionId)),
      REINFORCE.rallyCol, 3);
    sfx("buy");
    if (typeof this.updateNetworkReinforcements === "function" && !this.state.docked)
      this.updateNetworkReinforcements(0);
    this._syncBattleRfMirror && this._syncBattleRfMirror();
    return { ok: true };
  },

  getBattleRally() {
    const rf = this._ensureBattleReinforce();
    if (!rf) return null;
    if (!rf.rallyId) rf.rallyId = this._pickDefaultRally();
    return rf.rallyId ? this.outpostById(rf.rallyId) : null;
  },

  fortificationGaps(netIds, owner) {
    owner = owner || "player";
    const max = CONFIG.outpostStationedMax || 3;
    const gaps = [];
    for (const o of this.battleOwnedOutposts(owner)) {
      if (netIds && !netIds.has(o.id)) continue;
      const n = (o.stationedDrones || []).length;
      let inbound = 0;
      if (owner === "player" && this.networkReinforceState) {
        const st = this.networkReinforceState(o, "player");
        if (st) for (const t of st.transit) if (t.destId === o.id) inbound++;
      }
      const open = max - n - inbound;
      if (open > 0) gaps.push({ o, open, n });
    }
    // Emptiest first (rear-first fantasy — combat opens front gaps organically)
    gaps.sort((a, b) => a.n - b.n || a.open - b.open);
    return gaps;
  },

  // ---- Manual queue API (shared network queues — career / sandbox / control) --
  enqueueReinforcement(fleetIdx) {
    // Works at any held outpost (campaign + battle), not only control maps.
    if (typeof this.enqueueNetworkReinforcement === "function")
      return this.enqueueNetworkReinforcement(fleetIdx);
    return { ok: false, reason: "no reinforce net" };
  },

  dequeueReinforcement(queueIdx, rootId) {
    // Hangar passes root when multi-network; default docked network
    if (typeof this.dequeueNetworkReinforcement === "function") {
      const root = rootId != null
        ? this.outpostById(rootId)
        : (this.dockedOutpost && this.dockedOutpost());
      if (!root) {
        // Fall back: first network with a queue
        const roots = this.allPlayerNetworkRoots && this.allPlayerNetworkRoots();
        if (roots && roots[0]) return this.dequeueNetworkReinforcement(roots[0], queueIdx);
        return { ok: false, reason: "no network" };
      }
      return this.dequeueNetworkReinforcement(root, queueIdx);
    }
    return { ok: false, reason: "no reinforce net" };
  },

  buildDroneToReinforcement(tier) {
    if (typeof this.buildDroneToNetworkReinforcement === "function")
      return this.buildDroneToNetworkReinforcement(tier);
    return { ok: false, reason: "no reinforce net" };
  },

  _requeueReinforceDrone(d, originId) {
    // Re-home onto the network root of the origin outpost
    const o = originId && this.outpostById(originId);
    const st = o && this.networkReinforceState
      ? this.networkReinforceState(o, "player") : null;
    if (!st || !d) return;
    d.role = "reinforce"; d.state = "queued";
    d.originId = originId || st.root.id;
    const home = this.outpostById(d.originId);
    if (home && home.owner === "player") { d.x = home.x; d.y = home.y; }
    if (st.queue.length < ((typeof RF_NET !== "undefined" && RF_NET.queueMax) || 18))
      st.queue.push(d);
  },

  // Mirror network queues into legacy b.reinforce.{queue,transit} for HUD/draw
  // code that still reads those arrays.
  _syncBattleRfMirror() {
    const rf = this._ensureBattleReinforce();
    if (!rf || !this.allPlayerNetworkRoots) return;
    rf.queue = [];
    rf.transit = [];
    for (const root of this.allPlayerNetworkRoots()) {
      const st = this.networkReinforceState && this.networkReinforceState(root, "player");
      if (!st) continue;
      for (const d of st.queue) rf.queue.push(d);
      for (const t of st.transit) rf.transit.push(t);
    }
  },

  // ---- Main tick ------------------------------------------------------------
  updateBattleReinforcements(dt) {
    if (!this.isBattleControl()) return;
    const rf = this._ensureBattleReinforce();
    if (!rf) return;
    // Player queues/transit: shared network system
    if (typeof this.updateNetworkReinforcements === "function")
      this.updateNetworkReinforcements(dt);
    this._syncBattleRfMirror();
    this._tickBattleSnD(dt);
    this._tickRivalMirror(dt);
    this._tickBattleIncome(dt);
  },

  // ---- DOTA pacing: territory income + pilot respawns ------------------------
  // Held territory pays. Every stipend tick each outpost feeds its side's war
  // economy — more holds = faster drone production = bigger S&D waves. This is
  // the "feed the outposts" macro loop that decides control matches.
  _tickBattleIncome(dt) {
    const s = this.state, b = s.battle;
    if (!b) return;
    b._incomeT = (b._incomeT == null ? BATTLE_PACE.incomeEvery : b._incomeT) - dt;
    if (b._incomeT > 0) return;
    b._incomeT = BATTLE_PACE.incomeEvery;
    let p = 0, r = 0;
    for (const o of s.outposts || []) {
      if (o.owner === "player") p++;
      else if (o.owner === "rival") r++;
    }
    if (p > 0) {
      s.credits = (s.credits || 0) + BATTLE_PACE.incomeCr * p;
      s.refinedBars = s.refinedBars || {};
      s.refinedBars.copper = (s.refinedBars.copper || 0) + BATTLE_PACE.incomeBars * p;
    }
    const rf = this._ensureBattleReinforce();
    if (r > 0 && rf && rf.rival) {
      rf.rival.credits = (rf.rival.credits || 0) + BATTLE_PACE.incomeCr * r;
      rf.rival.bars = (rf.rival.bars || 0) + BATTLE_PACE.incomeBars * r;
    }
  },

  // endBattleMatch gate. Returns true when a pilot kill was absorbed as a
  // respawn (side still holds outposts). Homeless sides die for real.
  _battleControlIntercept(reason) {
    if (!this.isBattleControl()) return false;
    const s = this.state, b = s.battle;
    if (!b || b.phase !== "match") return false;
    if (reason === "p2_down") {
      if (b._p2RespawnT != null) return true;   // already rebuilding
      if (!this.battleOwnedOutposts("rival").length) return false; // network dead → real win
      b._p2Deaths = (b._p2Deaths || 0) + 1;
      b._p2RespawnT = BATTLE_PACE.respawnP2 + (b._p2Deaths - 1) * BATTLE_PACE.respawnGrow;
      s.credits = (s.credits || 0) + BATTLE_PACE.killBounty;
      const rf = this._ensureBattleReinforce();
      if (rf && rf.rival)
        rf.rival.credits = Math.max(0, (rf.rival.credits || 0) - BATTLE_PACE.deathPenalty);
      if (b.p2) burst(b.p2.x, b.p2.y, "#ff6a5e", 26);
      toast("☠ ENEMY PILOT DOWN  +" + BATTLE_PACE.killBounty + "cr · rebuilds in "
        + Math.round(b._p2RespawnT) + "s — push their outposts", "#57e6ff", 3.4);
      if (typeof sfx === "function") sfx("sell");
      return true;
    }
    if (reason === "death" || reason === "p1_down") {
      if (!this.battleOwnedOutposts("player").length) return false; // homeless → real loss
      return this._battleRespawnP1();
    }
    return false;
  },

  // P1 down on a control map: redeploy at the rally pad. The flight back across
  // the map is the real death cost (DOTA downtime), plus a credit hit.
  _battleRespawnP1() {
    const s = this.state, b = s.battle;
    const pad = this.getBattleRally() || this.battleOwnedOutposts("player")[0];
    if (!pad) return false;
    b._p1Deaths = (b._p1Deaths || 0) + 1;
    s.credits = Math.max(0, (s.credits || 0) - BATTLE_PACE.deathPenalty);
    const rf = this._ensureBattleReinforce();
    if (rf && rf.rival) rf.rival.credits = (rf.rival.credits || 0) + BATTLE_PACE.killBounty;
    s.dead = false;
    s.x = pad.x + 140; s.y = pad.y + 90; s.vx = s.vy = 0;
    s.cam.x = s.x; s.cam.y = s.y;
    if (s.hp) {
      s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
      s.hp._sinceHit = 99;
    }
    s.fuel = s.fuelMax;
    s.invuln = 3;
    if (s.tows && s.tows.length && typeof this.dropAllTows === "function") this.dropAllTows();
    for (const d of s.playerFleet || []) {
      if (d.role === "escort" || d.role === "tank") {
        d.hp = d.maxHp; d.shield = d.maxShield;
        d.x = s.x; d.y = s.y; d.vx = d.vy = 0;
      }
    }
    if (typeof ForgeCombat !== "undefined" && ForgeCombat.clearLock) ForgeCombat.clearLock();
    toast("✖ SHIP DOWN — redeployed at " + this.regionLabel(this.regionGet(pad.regionId))
      + " (−" + BATTLE_PACE.deathPenalty + "cr)", "#ff6a5e", 3.2);
    if (typeof sfx === "function") sfx("boom");
    return true;
  },

  // Rebuild P2 at the rear-most rival outpost once its respawn clock runs out.
  _tickP2Respawn(dt) {
    const s = this.state, b = s.battle;
    if (!b || b._p2RespawnT == null) return;
    b._p2RespawnT -= dt;
    if (b._p2RespawnT > 0) return;
    b._p2RespawnT = null;
    const owned = this.battleOwnedOutposts("rival");
    if (!owned.length) { this.endBattleMatch("p2_down"); return; }
    let pad = owned[0], best = -1;
    for (const o of owned) {
      const dd = this.dist(o.x, o.y, s.x, s.y);
      if (dd > best) { best = dd; pad = o; }
    }
    const p2 = this._spawnBattlePilot(b.p2Snap, pad.x - 140, pad.y - 90, 2);
    p2.label = (b.p2Snap && b.p2Snap.label) || "P2";
    this.applyBattleAiDifficulty(p2, b.aiDifficulty);
    b.p2 = p2;
    this._battleToast("⚠ enemy pilot redeployed", "#ff9a3c", 2.2);
  },

  _tickReinforceTransit(dt) {
    const s = this.state, rf = this._ensureBattleReinforce();
    const p2 = s.battle && s.battle.p2;
    const fireR = REINFORCE.snDFireR || (typeof FLEET !== "undefined" && FLEET.fireRange) || 220;

    for (let i = rf.transit.length - 1; i >= 0; i--) {
      const t = rf.transit[i];
      const d = t.drone;
      const dest = this.outpostById(t.destId);
      if (!dest || dest.owner !== "player") {
        this._requeueReinforceDrone(d, t.originId || rf.rallyId);
        rf.transit.splice(i, 1);
        continue;
      }
      const hopId = t.path[Math.min(t.hop, t.path.length - 1)];
      const wp = this.outpostById(hopId);
      if (!wp || wp.owner !== "player") {
        // Mid-path node lost — repath after graph refresh
        this.refreshBattleLogisticsGraph();
        continue;
      }

      const dx = wp.x - d.x, dy = wp.y - d.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = REINFORCE.speed * dt;
      if (dist <= step + 20) {
        d.x = wp.x; d.y = wp.y;
        if (t.hop < t.path.length - 1) {
          t.hop++;
        } else {
          if (!dest.stationedDrones) dest.stationedDrones = [];
          if (dest.stationedDrones.length < (CONFIG.outpostStationedMax || 3)) {
            d.role = "stationed"; d.state = "stationed"; d.outpostId = dest.id;
            d.formationIdx = null; d.targetAlienId = null; d.vx = d.vy = 0;
            d.fuel = d.maxFuel;
            dest.stationedDrones.push(d);
            this._battleToast("⛨ reinforced " + this.regionLabel(this.regionGet(dest.regionId)), "#22cccc", 1.6);
          } else {
            this._requeueReinforceDrone(d, t.originId || rf.rallyId);
          }
          rf.transit.splice(i, 1);
          continue;
        }
      } else {
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
        d.vx = (dx / dist) * REINFORCE.speed;
        d.vy = (dy / dist) * REINFORCE.speed;
      }

      // On-lane: unlimited fuel; combat exposure
      d.fuel = d.maxFuel;
      this._battleDroneCombatTick(d, dt, fireR, p2, true, { canKillPilot: false, unlimitedFuel: true });
      if (d.hp <= 0) {
        burst(d.x, d.y, "#ff6b6b", 8);
        this._battleToast("reinforcement shot down", "#ff6b6b", 1.5);
        if (typeof sfx === "function") sfx("boom");
        rf.transit.splice(i, 1);
      }
    }
  },

  // opts: canKillPilot, unlimitedFuel, fuelBurn
  _battleDroneCombatTick(d, dt, fireR, p2, returnFire, opts) {
    opts = opts || {};
    const s = this.state;
    const unlimited = !!opts.unlimitedFuel;
    const canKill = opts.canKillPilot != null ? opts.canKillPilot : !REINFORCE.gruntNoKillPilot;
    d.wcd = Math.max(0, (d.wcd || 0) - dt);

    if (p2 && !p2.dead && p2.hp && p2.hp.hull > 0) {
      const pd = this.dist(d.x, d.y, p2.x, p2.y);
      if (pd < fireR * 1.15) {
        const chip = REINFORCE.transitChipPerS * dt;
        d.shield = (d.shield || 0) - chip;
        if (d.shield < 0) { d.hp += d.shield; d.shield = 0; }
      }
      if (returnFire && d.wcd <= 0 && pd <= fireR) {
        const ws = (d.loadout || []).filter(m => m.type === "weapon");
        if (ws.length) {
          if (!unlimited && (d.fuel || 0) < REINFORCE.snDWeaponFuel) {
            // can't fire dry
          } else {
            if (!unlimited) d.fuel = Math.max(0, (d.fuel || 0) - REINFORCE.snDWeaponFuel);
            const dmg = ws.reduce((a, w) => a + w.dmg, 0) * REINFORCE.snDVsPilotDmg;
            if (dmg > 0 && typeof ForgeCombat !== "undefined") {
              const hullBefore = p2.hp.hull;
              ForgeCombat.applyDamage(p2, dmg, dmg, dmg);
              if (!canKill && p2.hp.hull < 1) {
                p2.hp.hull = Math.max(1, hullBefore > 1 ? 1 : hullBefore);
                p2.dead = false; p2.state = "ALIVE";
              }
              d.wcd = 1 / (ws[0].fireRate || 1);
              burst(p2.x, p2.y, "#22cccc", 2);
              if (canKill && p2.hp.hull <= 0) {
                p2.dead = true; p2.state = "DEAD";
                if (this.isBattleMatch && this.isBattleMatch()) this.endBattleMatch("p2_down");
              }
            }
          }
        }
      }
    }
    for (const al of s.aliens || []) {
      if (!al || al.state === "DEAD" || !al.hp || al.hp.hull <= 0) continue;
      const ad = this.dist(d.x, d.y, al.x, al.y);
      if (ad < fireR * 0.9) {
        d.shield = (d.shield || 0) - 8 * dt;
        if (d.shield < 0) { d.hp += d.shield; d.shield = 0; }
      }
      if (returnFire && d.wcd <= 0 && ad <= fireR) {
        const ws = (d.loadout || []).filter(m => m.type === "weapon");
        if (ws.length && typeof ForgeCombat !== "undefined") {
          if (!unlimited && (d.fuel || 0) < REINFORCE.snDWeaponFuel) continue;
          if (!unlimited) d.fuel = Math.max(0, (d.fuel || 0) - REINFORCE.snDWeaponFuel);
          const dmg = ws.reduce((a, w) => a + w.dmg, 0);
          ForgeCombat.applyDamage(al, dmg, dmg, dmg);
          d.wcd = 1 / (ws[0].fireRate || 1);
          if (al.hp.hull <= 0 && typeof this.onAlienKilled === "function") this.onAlienKilled(al);
        }
      }
    }
  },

  // True if drone is at any outpost (player or enemy) — unlimited fuel zone.
  _droneAtAnyOutpost(d, R) {
    R = R || (CONFIG.outpostDefendR || 800) * 0.55;
    for (const o of this.state.outposts || []) {
      if (this.dist(d.x, d.y, o.x, o.y) < R) return o;
    }
    return null;
  },
  // True if near a player-owned trade lane segment (unlimited fuel corridor).
  _droneOnPlayerTradeLane(d, pad) {
    pad = pad != null ? pad : 140;
    const pairs = this.battleLanePairs();
    for (const pr of pairs) {
      const ax = pr.a.x, ay = pr.a.y, bx = pr.b.x, by = pr.b.y;
      const abx = bx - ax, aby = by - ay;
      const len2 = abx * abx + aby * aby || 1;
      let t = ((d.x - ax) * abx + (d.y - ay) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = ax + abx * t, py = ay + aby * t;
      if (this.dist(d.x, d.y, px, py) <= pad) return true;
    }
    return false;
  },

  // ---- Search & Destroy (player) --------------------------------------------
  _tickBattleSnD(dt) {
    const rf = this._ensureBattleReinforce();
    rf.snDCd = (rf.snDCd == null ? REINFORCE.snDEvery : rf.snDCd) - dt;
    if (rf.snDCd <= 0) {
      rf.snDCd = REINFORCE.snDEvery;
      this._launchBattleSnDSorties("player");
    }
    this._updateSnDList(rf.snD, dt, "player");
  },

  _launchBattleSnDSorties(owner) {
    const rf = this._ensureBattleReinforce();
    const max = CONFIG.outpostStationedMax || 3;
    const list = owner === "rival" ? rf.rival.snD : rf.snD;
    const cap = owner === "rival"
      ? (REINFORCE.rivalSnDMax || REINFORCE.snDMaxConcurrent)
      : REINFORCE.snDMaxConcurrent;
    if (list.length >= cap) return 0;
    let launched = 0;
    for (const o of this.battleOwnedOutposts(owner)) {
      if (!o.stationedDrones || o.stationedDrones.length < max) continue;
      if (list.length + launched >= cap) break;
      let bi = o.stationedDrones.findIndex(d => d.state === "stationed" || d.state === "return");
      if (bi < 0) bi = 0;
      const d = o.stationedDrones[bi];
      if (!d) continue;
      o.stationedDrones.splice(bi, 1);
      d.role = "snd"; d.state = "snd";
      d.homeOutpostId = o.id;
      d.sndOwner = owner;
      delete d.outpostId;
      d.targetAlienId = null;
      d.sndWaypoint = null;
      d.sndTargetOutpostId = null;
      d.x = o.x; d.y = o.y;
      // Off-lane tank: extra fuel for sortie; full tank when leaving berth
      d.fuel = (d.maxFuel || 80) * REINFORCE.snDFuelMult;
      d.maxFuel = Math.max(d.maxFuel || 80, d.fuel);
      list.push(d);
      launched++;
    }
    if (launched > 0 && owner === "player") {
      if (owner === "player")
        this._battleToast("⚔ S&D ×" + launched, REINFORCE.snDCol, 1.8);
    }
    return launched;
  },

  _nearestEnemyOutpost(d, owner) {
    const enemy = owner === "player" ? "rival" : "player";
    // Prefer enemy-owned, else any non-own
    let best = null, bd = 1e12;
    for (const o of this.state.outposts || []) {
      if (o.owner === owner) continue;
      // Prefer rival/player over neutral for DOTA feel
      let score = this.dist(d.x, d.y, o.x, o.y);
      if (o.owner === enemy) score *= 0.65;
      if (score < bd) { bd = score; best = o; }
    }
    return best;
  },

  _updateSnDList(list, dt, owner) {
    const s = this.state;
    const p2 = s.battle && s.battle.p2;
    const fireR = REINFORCE.snDFireR || (typeof FLEET !== "undefined" && FLEET.fireRange) || 220;

    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      const atOp = this._droneAtAnyOutpost(d);
      const onLane = owner === "player" && this._droneOnPlayerTradeLane(d);
      const unlimited = !!(atOp || onLane);

      if (unlimited) {
        d.fuel = d.maxFuel;
      } else {
        d.fuel = (d.fuel || 0) - REINFORCE.snDCruiseFuelPerS * dt;
        // regen modules cost fuel off-lane
        for (const m of d.loadout || []) {
          if (m.type === "repair" || m.type === "utility")
            d.fuel -= REINFORCE.snDRegenFuelPerS * dt * 0.35;
        }
        if (d.fuel <= 0) {
          burst(d.x, d.y, "#ff9a3c", 10);
          if (owner === "player") this._battleToast("S&D fuel-out", "#ff9a3c", 1.4);
          if (typeof sfx === "function") sfx("boom");
          list.splice(i, 1);
          continue;
        }
      }

      // DOTA creep: prioritize enemy outposts over pilots/aliens
      let tgt = null, tKind = null;
      const opTgt = this._nearestEnemyOutpost(d, owner);
      if (opTgt) {
        // Commit to a target outpost until dead/captured
        if (!d.sndTargetOutpostId || !this.outpostById(d.sndTargetOutpostId)
            || this.outpostById(d.sndTargetOutpostId).owner === owner) {
          d.sndTargetOutpostId = opTgt.id;
        }
        const committed = this.outpostById(d.sndTargetOutpostId) || opTgt;
        tgt = committed; tKind = "outpost";
      }
      // Local defense: enemy pilot very close can be shot (chip only)
      if (owner === "player" && p2 && !p2.dead && p2.hp && p2.hp.hull > 0) {
        const pd = this.dist(d.x, d.y, p2.x, p2.y);
        if (pd < fireR * 1.1) { tgt = p2; tKind = "p2"; }
      }
      if (owner === "rival") {
        const pd = this.dist(d.x, d.y, s.x, s.y);
        if (pd < fireR * 1.1) { tgt = s; tKind = "p1"; }
      }
      // Block enemy grunts
      if (!tgt || tKind === "outpost") {
        const foes = owner === "player"
          ? (this._ensureBattleReinforce().rival.snD || [])
          : (this._ensureBattleReinforce().snD || []);
        let bd = fireR * 1.4;
        for (const f of foes) {
          const fd = this.dist(d.x, d.y, f.x, f.y);
          if (fd < bd) { bd = fd; tgt = f; tKind = "grunt"; }
        }
      }

      if (tgt) {
        const tx = tgt.x != null ? tgt.x : s.x, ty = tgt.y != null ? tgt.y : s.y;
        const dx = tx - d.x, dy = ty - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        const standoff = tKind === "outpost" ? 150 : 85;
        if (dist > standoff) {
          const step = REINFORCE.snDSpeed * dt;
          d.x += (dx / dist) * step;
          d.y += (dy / dist) * step;
          d.vx = (dx / dist) * REINFORCE.snDSpeed;
          d.vy = (dy / dist) * REINFORCE.snDSpeed;
        }
        d.wcd = Math.max(0, (d.wcd || 0) - dt);
        if (d.wcd <= 0 && dist <= fireR + (tKind === "outpost" ? 50 : 0)) {
          const ws = (d.loadout || []).filter(m => m.type === "weapon");
          if (ws.length) {
            if (!unlimited && (d.fuel || 0) < REINFORCE.snDWeaponFuel) {
              // dry guns — still cruise until detonation
            } else {
              if (!unlimited) d.fuel -= REINFORCE.snDWeaponFuel;
              const base = ws.reduce((a, w) => a + w.dmg, 0);
              if (tKind === "outpost") {
                const dmg = base * REINFORCE.snDOutpostDmg;
                tgt.hull = Math.max(0, (tgt.hull || 0) - dmg);
                if (tgt._ships) {
                  for (const sh of tgt._ships) {
                    if (sh && sh.hp && sh.hp.hull > 0 && typeof ForgeCombat !== "undefined")
                      ForgeCombat.applyDamage(sh, dmg * 0.35, dmg * 0.35, dmg * 0.35);
                  }
                }
                // Also chew enemy stationed grunts
                if (tgt.stationedDrones && tgt.stationedDrones.length) {
                  const gd = tgt.stationedDrones[0];
                  gd.hp = (gd.hp || 0) - dmg;
                  if (gd.hp <= 0) {
                    tgt.stationedDrones.shift();
                    burst(tgt.x, tgt.y, "#ff6b6b", 4);
                  }
                }
                if (tgt.hull <= 0) {
                  tgt.capturable = true;
                  if (owner === "rival" && tgt.owner === "player") {
                    // AI can flip if capturable and no defenders
                    if (!tgt.stationedDrones.length)
                      this._battleRivalCapture(tgt);
                  } else if (owner === "player" && tgt.owner !== "player") {
                    // Player grunts soften only — pilot still captures by docking
                  }
                }
                burst(tgt.x, tgt.y, owner === "player" ? REINFORCE.snDCol : REINFORCE.rivalCol, 3);
              } else if (tKind === "grunt") {
                tgt.hp = (tgt.hp || 0) - base;
                burst(tgt.x, tgt.y, "#ffb45e", 2);
              } else if (tKind === "p2" && typeof ForgeCombat !== "undefined") {
                const dmg = base * REINFORCE.snDVsPilotDmg;
                const hullBefore = p2.hp.hull;
                ForgeCombat.applyDamage(p2, dmg, dmg, dmg);
                if (REINFORCE.gruntNoKillPilot && p2.hp.hull < 1)
                  p2.hp.hull = Math.max(1, hullBefore > 1 ? 1 : hullBefore);
                burst(p2.x, p2.y, REINFORCE.snDCol, 2);
              } else if (tKind === "p1") {
                const dmg = base * REINFORCE.snDVsPilotDmg;
                if (typeof this.damageShip === "function") this.damageShip(dmg);
                else if (s.hp) {
                  s.hp.shield = Math.max(0, s.hp.shield - dmg);
                  if (s.hp.shield <= 0) s.hp.hull = Math.max(1, s.hp.hull - dmg * 0.25);
                }
              }
              d.wcd = 1 / (ws[0].fireRate || 1);
            }
          }
        }
      }

      // Incoming
      if (owner === "player")
        this._battleDroneCombatTick(d, dt, fireR, p2, false, { canKillPilot: false, unlimitedFuel: unlimited });
      // Cull dead grunts
      if (d.hp <= 0) {
        burst(d.x, d.y, "#ff6b6b", 8);
        if (owner === "player") this._battleToast("S&D lost", "#ff6b6b", 1.4);
        if (typeof sfx === "function") sfx("boom");
        list.splice(i, 1);
      }
    }
    // Remove dead enemy grunts from rival list if player killed them via tKind grunt
    for (let i = list.length - 1; i >= 0; i--)
      if (list[i].hp <= 0) list.splice(i, 1);
  },

  // ---- Rival mirror factory + S&D -------------------------------------------
  _tickRivalMirror(dt) {
    const rf = this._ensureBattleReinforce();
    const riv = rf.rival;
    if (!riv.starved) {
      riv.fillT = (riv.fillT || 0) - dt;
      if (riv.fillT <= 0) {
        riv.fillT = REINFORCE.rivalFillEvery;
        this._rivalFillBerths();
      }
    }
    riv.snDCd = (riv.snDCd == null ? REINFORCE.rivalSnDEvery : riv.snDCd) - dt;
    if (riv.snDCd <= 0) {
      riv.snDCd = REINFORCE.rivalSnDEvery;
      this._launchBattleSnDSorties("rival");
    }
    this._updateSnDList(riv.snD, dt, "rival");
  },

  _rivalFillBerths() {
    const rf = this._ensureBattleReinforce();
    const riv = rf.rival;
    if (riv.starved) return;
    const max = CONFIG.outpostStationedMax || 3;
    const costCr = riv.buildCostCr != null ? riv.buildCostCr : 25;
    const costBars = riv.buildCostBars != null ? riv.buildCostBars : 2;
    for (const o of this.battleOwnedOutposts("rival")) {
      if (!o.stationedDrones) o.stationedDrones = [];
      if (o.stationedDrones.length >= max) continue;
      // Spend mirror economy — same cost class as player Basic drone
      if ((riv.credits || 0) < costCr || (riv.bars || 0) < costBars) continue;
      riv.credits -= costCr;
      riv.bars -= costBars;
      const spec = DRONES.tiers[0];
      o.stationedDrones.push({
        id: this._nextDroneId++, tier: 0, role: "stationed", state: "stationed",
        hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
        fuel: spec.maxFuel, maxFuel: spec.maxFuel,
        loadout: spec.loadout.map(m => ({ ...m })),
        formationIdx: null, outpostId: o.id, wcd: 0, vx: 0, vy: 0,
        x: o.x, y: o.y, sndOwner: "rival",
      });
    }
  },

  // ---- Draw -----------------------------------------------------------------
  drawBattleControlLanes(g) {
    if (HEADLESS || !this.isBattleControl()) return;
    const s = this.state, z = s.cam.zoom;
    const pairs = this.battleLanePairs();
    const rally = this.getBattleRally();
    if (pairs.length) {
      g.save();
      g.strokeStyle = REINFORCE.laneCol;
      g.globalAlpha = 0.28;
      g.lineWidth = Math.max(0.8, 1.3 * z);
      if (g.setLineDash) g.setLineDash([Math.max(4, 10 * z), Math.max(6, 14 * z)]);
      for (const pr of pairs) {
        const pa = this.SF(pr.a.x, pr.a.y), pb = this.SF(pr.b.x, pr.b.y);
        g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
      }
      if (g.setLineDash) g.setLineDash([]);
      g.globalAlpha = 1;
      g.restore();
    }
    if (rally) {
      const p = this.SF(rally.x, rally.y);
      g.save();
      g.strokeStyle = REINFORCE.rallyCol;
      g.globalAlpha = 0.55 + 0.25 * Math.sin(s.t * 3);
      g.lineWidth = Math.max(1.2, 2 * z);
      g.beginPath(); g.arc(p.x, p.y, 18 * z, 0, Math.PI * 2); g.stroke();
      g.font = "bold " + Math.round(10 * z) + "px monospace";
      g.fillStyle = REINFORCE.rallyCol; g.textAlign = "center";
      g.fillText("RALLY", p.x, p.y - 22 * z);
      g.textAlign = "left";
      g.restore();
    }
  },

  drawBattleReinforceDrones(g) {
    if (HEADLESS || !this.isBattleControl()) return;
    const s = this.state, rf = this._ensureBattleReinforce();
    if (!rf) return;
    const z = s.cam.zoom, viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 900;
    const drawOne = (d, col) => {
      if (this.dist(d.x, d.y, s.cam.x, s.cam.y) > viewR) return;
      const p = this.SF(d.x, d.y), sz = 9 * z;
      const sp = Math.hypot(d.vx || 0, d.vy || 0);
      const ang = sp > 8 ? Math.atan2(d.vy, d.vx) : s.t * 0.5;
      if (!ART.draw(g, "drone_t" + (d.tier || 0), p.x, p.y, sz * (2.8 + (d.tier || 0) * 0.4), ang))
        this.drawDroneShape(g, p.x, p.y, ang, sz, col);
      const barW = 26 * z, barY = p.y - sz - 8 * z;
      g.fillStyle = "#1c2430"; g.fillRect(p.x - barW / 2, barY, barW, 3 * z);
      g.fillStyle = col; g.fillRect(p.x - barW / 2, barY, barW * clamp(d.hp / Math.max(1, d.maxHp), 0, 1), 3 * z);
      if (d.role === "snd" && d.maxFuel) {
        g.fillStyle = "#1c2430"; g.fillRect(p.x - barW / 2, barY + 4 * z, barW, 2 * z);
        g.fillStyle = "#c7d2e0";
        g.fillRect(p.x - barW / 2, barY + 4 * z, barW * clamp(d.fuel / d.maxFuel, 0, 1), 2 * z);
      }
    };
    for (const t of rf.transit) drawOne(t.drone, REINFORCE.transitCol);
    for (const d of rf.snD) drawOne(d, REINFORCE.snDCol);
    for (const d of rf.rival.snD) drawOne(d, REINFORCE.rivalCol);
  },

  // ---- P2 pilot strategy ----------------------------------------------------
  updateBattleControlP2(dt) {
    if (!this.isBattleControl()) return;
    const s = this.state, b = s.battle, p2 = b && b.p2;
    if (!p2 || p2.dead || !p2.hp || p2.hp.hull <= 0) return;

    let pOwn = 0, rOwn = 0, neu = 0;
    for (const o of s.outposts || []) {
      if (o.owner === "player") pOwn++;
      else if (o.owner === "rival") rOwn++;
      else neu++;
    }
    b.objectives.outpostsOwned = pOwn;
    b.objectives.control = { outpostsPlayer: pOwn, outpostsRival: rOwn, outpostsNeutral: neu };

    let obj = null, best = 1e12;
    for (const o of s.outposts || []) {
      if (o.owner === "rival") continue;
      let score = this.dist(p2.x, p2.y, o.x, o.y);
      if (o.owner === "player") score *= 0.85;
      if (o.capturable) score *= 0.55;
      if (o.hull < o.hullMax * 0.5) score *= 0.7;
      const rf = b.reinforce;
      if (rf && rf.transit && rf.transit.length) {
        for (const t of rf.transit) {
          const td = this.dist(p2.x, p2.y, t.drone.x, t.drone.y);
          if (td < 900) score = Math.min(score, td * 0.7);
        }
      }
      if (score < best) { best = score; obj = o; }
    }

    const rf = b.reinforce;
    if (rf && rf.transit && rf.transit.length) {
      let nearest = null, nd = 700;
      for (const t of rf.transit) {
        const td = this.dist(p2.x, p2.y, t.drone.x, t.drone.y);
        if (td < nd) { nd = td; nearest = t.drone; }
      }
      if (nearest) {
        const dx = nearest.x - p2.x, dy = nearest.y - p2.y;
        const d = Math.hypot(dx, dy) || 1;
        p2.vx += (dx / d) * (p2.thrust || 100) * 0.4 * dt;
        p2.vy += (dy / d) * (p2.thrust || 100) * 0.4 * dt;
        return;
      }
    }

    const p1Dist = this.dist(p2.x, p2.y, s.x, s.y);
    const huntPlayer = !obj || p1Dist < 420 || (pOwn === 0 && rOwn >= 1 && p1Dist < 900);
    if (huntPlayer) {
      if (p2.ai) p2.ai.standoff = Math.min(p2.ai.standoff || 280, 260);
    } else if (obj) {
      const dx = obj.x - p2.x, dy = obj.y - p2.y;
      const d = Math.hypot(dx, dy) || 1;
      p2.vx += (dx / d) * (p2.thrust || 100) * 0.35 * dt;
      p2.vy += (dy / d) * (p2.thrust || 100) * 0.35 * dt;
      if (d < (CONFIG.outpostDockR || 110) + 40) {
        if (obj.owner !== "rival") {
          if (obj._ships && obj._ships.length) {
            for (const sh of obj._ships) {
              if (sh && sh.hp && sh.hp.hull > 0)
                ForgeCombat.applyDamage(sh, 8 * dt, 6 * dt, 5 * dt);
            }
            if (obj._ships.every(sh => !sh || sh.state === "DEAD" || (sh.hp && sh.hp.hull <= 0)))
              obj.capturable = true;
          } else obj.capturable = true;
          if (!obj.capturable && obj.hull > 0) {
            // Slow siege — the player gets a real window to fly over and defend
            obj.hull = Math.max(0, obj.hull - BATTLE_PACE.p2SiegePerS * dt);
            if (obj.hull <= 0) obj.capturable = true;
          }
          if (obj.capturable || obj.hull <= 0) this._battleRivalCapture(obj);
        }
      }
    }
  },

  _battleRivalCapture(o) {
    if (!o || o.owner === "rival") return;
    const s = this.state;
    const wasPlayer = o.owner === "player";
    const rf = this._ensureBattleReinforce();
    // Survivors fall back to the reinforce hangar on a network we STILL own —
    // flip ownership FIRST so the requeue can't land on the lost node. (Queues
    // live on network roots; rf.queue is a draw mirror and must not be pushed.)
    const survivors = wasPlayer && o.stationedDrones ? o.stationedDrones.slice() : [];
    o.stationedDrones = [];
    if (rf && rf.rallyId === o.id) rf.rallyId = null;
    o.owner = "rival";
    o.capturable = false;
    o.provoked = false;
    o.hull = o.hullMax; o.shield = o.shieldMax; o.armor = o.armorMax;
    o.guardRecs = [{ frac: 1, alive: true }, { frac: 1, alive: true }, { frac: 1, alive: true }];
    if (o.streamed) this._streamGuardsOut(o);
    const region = this.regionGet(o.regionId);
    if (region) region.owner = "rival";
    // Authoritative repath: in-flight legs to/through the lost node requeue here
    this.refreshBattleLogisticsGraph();
    const home = (rf && rf.rallyId && this.outpostById(rf.rallyId))
      || this.battleOwnedOutposts("player")[0] || null;
    for (const d of survivors) {
      delete d.outpostId; d.targetAlienId = null;
      if (home) this._requeueReinforceDrone(d, home.id);
      else if (s.playerFleet.length < DRONES.ownedMax) {
        d.role = "hangar"; d.state = "follow";
        d.x = s.x; d.y = s.y;
        s.playerFleet.push(d);
      }
    }
    if (this._syncBattleRfMirror) this._syncBattleRfMirror();
    toast("✖ OUTPOST LOST — " + this.regionLabel(region) + " (survivors → reinforce hangar)", "#ff6b6b", 3);
    if (typeof sfx === "function") sfx("boom");
  },

  onBattleOutpostCaptured(o) {
    if (!this.isBattleControl() || !o) return;
    o.discovered = true;
    this.updateBattleControlVision();
    const s = this.state;
    const bounty = 400 + (o.dangerLevel || 3) * 80;
    s.credits = (s.credits || 0) + bounty;
    const rf = this._ensureBattleReinforce();
    const first = !rf.rallyId;
    // Global links refresh so the new node is part of the reinforce network
    this.refreshBattleLogisticsGraph();
    if (first && rf.rallyId) {
      toast("★ HOLD SECURED · RALLY auto-set · +" + bounty + "cr", REINFORCE.rallyCol, 3);
    } else {
      toast("★ HOLD SECURED · network refreshed · +" + bounty + "cr", "#57e6ff", 3);
    }
  },

  // ---- Balance helpers (tests / sandbox) ------------------------------------
  // Run N seconds of grunt-only sim. opts.starveRival / starvePlayer skip refills.
  simBattleGruntBalance(opts) {
    opts = opts || {};
    const seconds = opts.seconds != null ? opts.seconds : 90;
    const dt = opts.dt || 1 / 20;
    if (!this.isBattleControl()) return { ok: false, reason: "not control" };
    const rf = this._ensureBattleReinforce();
    if (opts.starveRival) rf.rival.starved = true;
    if (opts.feedRival) rf.rival.starved = false;
    // Seed both sides with full berths if empty
    for (const o of this.battleOwnedOutposts("player")) {
      if (!o.stationedDrones) o.stationedDrones = [];
      while (o.stationedDrones.length < 3 && !opts.starvePlayer) {
        const r = this.buildDroneToReinforcement(0);
        if (!r.ok) {
          // gift
          const spec = DRONES.tiers[0];
          o.stationedDrones.push({
            id: this._nextDroneId++, tier: 0, role: "stationed", state: "stationed",
            hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
            fuel: spec.maxFuel, maxFuel: spec.maxFuel,
            loadout: spec.loadout.map(m => ({ ...m })),
            outpostId: o.id, wcd: 0, x: o.x, y: o.y,
          });
        } else {
          for (let k = 0; k < 200; k++) this.updateBattleReinforcements(dt);
        }
      }
    }
    this._rivalFillBerths(); this._rivalFillBerths(); this._rivalFillBerths();
    const snap = () => {
      let p = 0, r = 0;
      for (const o of this.state.outposts || []) {
        if (o.owner === "player") p++;
        else if (o.owner === "rival") r++;
      }
      return { p, r, pSnD: rf.snD.length, rSnD: rf.rival.snD.length };
    };
    const start = snap();
    const steps = Math.ceil(seconds / dt);
    for (let i = 0; i < steps; i++) {
      // Keep player berths topped if not starved (sim "player maintains queue")
      if (!opts.starvePlayer && i % Math.ceil(5 / dt) === 0) {
        for (const o of this.battleOwnedOutposts("player")) {
          while ((o.stationedDrones || []).length < 3) {
            const spec = DRONES.tiers[0];
            o.stationedDrones.push({
              id: this._nextDroneId++, tier: 0, role: "stationed", state: "stationed",
              hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
              fuel: spec.maxFuel, maxFuel: spec.maxFuel,
              loadout: spec.loadout.map(m => ({ ...m })),
              outpostId: o.id, wcd: 0, x: o.x, y: o.y,
            });
          }
        }
      }
      this.updateBattleReinforcements(dt);
    }
    const end = snap();
    return { ok: true, start, end, seconds, starvedRival: !!opts.starveRival, starvedPlayer: !!opts.starvePlayer };
  },
});
