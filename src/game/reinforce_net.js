/*=== HARNESS:REINFORCE_NET ==================================================*/
// Per-network reinforcement queues — career, sandbox, campaign, and control
// battles share this path.
//
// Model:
//   • Player-owned outposts form networks via local neighbor links (trade graph).
//   • Each network has ONE queue (stored on the root outpost = lowest id) of
//     drones waiting to fill fortify berths (CONFIG.outpostStationedMax each).
//   • Hangar tab always shows the queue(s). Enqueue only while docked at a
//     player-owned outpost in that network (frees a personal hangar slot).
//   • While docked: queue is frozen (loadout-editable). While undocked: empty
//     berths pull from the queue; drones fly multi-hop along owned lanes, then
//     become stationed fortify drones (no longer in the queue / loadout).
//
// Battle-control S&D / rival AI stay in battle_control.js; player queue/transit
// is owned here.
const RF_NET = {
  queueMax: 18,
  speed: 320,
  arriveR: 28,
};

Object.assign(GAME, {
  // ---- graph helpers --------------------------------------------------------
  outpostNetworkMembers(seed, owner) {
    owner = owner || "player";
    const start = typeof seed === "object" ? seed : this.outpostById(seed);
    if (!start || start.owner !== owner) return [];
    const seen = new Set([start.id]), out = [start], q = [start];
    while (q.length) {
      const cur = q.shift();
      for (const id of (cur.neighborIds || [])) {
        if (seen.has(id)) continue;
        const n = this.outpostById(id);
        if (!n || n.owner !== owner) continue;
        seen.add(id); out.push(n); q.push(n);
      }
    }
    return out;
  },

  outpostNetworkRoot(seed, owner) {
    const mem = this.outpostNetworkMembers(seed, owner);
    if (!mem.length) return null;
    let root = mem[0];
    for (const o of mem) {
      const a = String(o.id), b = String(root.id);
      if (a < b) root = o;
    }
    return root;
  },

  // Ensure queue/transit arrays live on the network root.
  networkReinforceState(seed, owner) {
    const root = this.outpostNetworkRoot(seed, owner);
    if (!root) return null;
    if (!Array.isArray(root.reinforceQueue)) root.reinforceQueue = [];
    if (!Array.isArray(root.reinforceTransit)) root.reinforceTransit = [];
    return { root, queue: root.reinforceQueue, transit: root.reinforceTransit };
  },

  // Every distinct player network root that currently exists.
  allPlayerNetworkRoots() {
    const s = this.state, seen = new Set(), roots = [];
    for (const o of (s.outposts || [])) {
      if (o.owner !== "player") continue;
      const root = this.outpostNetworkRoot(o, "player");
      if (!root || seen.has(root.id)) continue;
      seen.add(root.id);
      roots.push(root);
    }
    return roots;
  },

  // Move queue/transit data onto the true root if networks merged/split.
  consolidateNetworkQueues() {
    const s = this.state;
    // Collect every outpost that still carries queue data
    const carriers = (s.outposts || []).filter(o =>
      (o.reinforceQueue && o.reinforceQueue.length)
      || (o.reinforceTransit && o.reinforceTransit.length)
      || (Array.isArray(o.reinforceQueue) && o.owner === "player"));
    for (const o of (s.outposts || [])) {
      if (o.owner !== "player") continue;
      if (!Array.isArray(o.reinforceQueue) && !Array.isArray(o.reinforceTransit)) continue;
      const root = this.outpostNetworkRoot(o, "player");
      if (!root || root === o) continue;
      // Fold into root
      if (!Array.isArray(root.reinforceQueue)) root.reinforceQueue = [];
      if (!Array.isArray(root.reinforceTransit)) root.reinforceTransit = [];
      if (o.reinforceQueue && o.reinforceQueue.length) {
        root.reinforceQueue.push.apply(root.reinforceQueue, o.reinforceQueue);
        o.reinforceQueue = [];
      }
      if (o.reinforceTransit && o.reinforceTransit.length) {
        root.reinforceTransit.push.apply(root.reinforceTransit, o.reinforceTransit);
        o.reinforceTransit = [];
      }
    }
    // Cap queues
    for (const root of this.allPlayerNetworkRoots()) {
      const st = this.networkReinforceState(root);
      if (!st) continue;
      while (st.queue.length > RF_NET.queueMax) {
        // Overflow back to hangar if possible, else drop (shouldn't happen)
        const d = st.queue.pop();
        if (s.playerFleet.length < DRONES.ownedMax) {
          d.role = "hangar"; d.state = "follow";
          s.playerFleet.push(d);
        }
      }
    }
  },

  networkFortificationGaps(root, owner) {
    owner = owner || "player";
    const mem = this.outpostNetworkMembers(root, owner);
    const max = CONFIG.outpostStationedMax || 3;
    const st = this.networkReinforceState(root, owner);
    const gaps = [];
    for (const o of mem) {
      const n = (o.stationedDrones || []).length;
      let inbound = 0;
      if (st) for (const t of st.transit) if (t.destId === o.id) inbound++;
      const open = max - n - inbound;
      if (open > 0) gaps.push({ o, open, n });
    }
    gaps.sort((a, b) => a.n - b.n || a.open - b.open);
    return gaps;
  },

  networkReinforcePath(fromId, toId, owner) {
    if (fromId === toId) return [fromId];
    const from = this.outpostById(fromId), to = this.outpostById(toId);
    if (!from || !to) return [];
    owner = owner || "player";
    const prev = new Map([[fromId, null]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      if (cur.id === toId) break;
      for (const id of (cur.neighborIds || [])) {
        if (prev.has(id)) continue;
        const n = this.outpostById(id);
        if (!n || n.owner !== owner) continue;
        prev.set(id, cur.id);
        q.push(n);
      }
    }
    if (!prev.has(toId)) return [];
    const path = [];
    let c = toId;
    while (c != null) { path.push(c); c = prev.get(c); }
    path.reverse();
    return path;
  },

  // True when player may add/remove from a network queue.
  canManageReinforceQueue() {
    const o = this.dockedOutpost && this.dockedOutpost();
    return !!(o && o.owner === "player");
  },

  // Docked network (or null).
  dockedReinforceNetwork() {
    const o = this.dockedOutpost && this.dockedOutpost();
    if (!o || o.owner !== "player") return null;
    return this.networkReinforceState(o, "player");
  },

  // Flat list for hangar / loadout: { drone, root, queueIdx, netLabel }
  listNetworkQueueEntries() {
    this.consolidateNetworkQueues();
    const out = [];
    for (const root of this.allPlayerNetworkRoots()) {
      const st = this.networkReinforceState(root);
      if (!st || !st.queue.length) continue;
      const label = this.regionLabel
        ? this.regionLabel(this.regionGet(root.regionId))
        : String(root.id);
      st.queue.forEach((d, qi) => out.push({
        drone: d, root, queueIdx: qi, netLabel: label, netSize: this.outpostNetworkMembers(root).length,
      }));
    }
    return out;
  },

  // ---- enqueue / dequeue ----------------------------------------------------
  // Move a personal-hangar drone into THIS docked outpost's network queue.
  enqueueNetworkReinforcement(fleetIdx) {
    const s = this.state;
    const o = this.dockedOutpost && this.dockedOutpost();
    if (!o || o.owner !== "player") {
      if (typeof toast === "function") toast("dock at a held outpost to queue reinforcements", "#ff9a3c", 2.2);
      if (typeof sfx === "function") sfx("warn");
      return { ok: false, reason: "not at outpost" };
    }
    const d = s.playerFleet[fleetIdx];
    if (!d) return { ok: false, reason: "no drone" };
    if (d.role === "trade" || d.role === "claim") {
      if (typeof toast === "function") toast("drone busy"); sfx("warn");
      return { ok: false, reason: "busy" };
    }
    const st = this.networkReinforceState(o, "player");
    if (!st) return { ok: false, reason: "no network" };
    if (st.queue.length >= RF_NET.queueMax) {
      if (typeof toast === "function") toast("reinforcement queue full (" + RF_NET.queueMax + ")"); sfx("warn");
      return { ok: false, reason: "queue full" };
    }
    s.playerFleet.splice(fleetIdx, 1);
    d.role = "reinforce"; d.state = "queued"; d.formationIdx = null;
    d.targetAlienId = null; d.vx = 0; d.vy = 0;
    d.originId = o.id; d.x = o.x; d.y = o.y;
    d.networkRootId = st.root.id;
    delete d.outpostId;
    st.queue.push(d);
    if (typeof this.reindexFormation === "function") this.reindexFormation(s);
    const lbl = this.regionLabel
      ? this.regionLabel(this.regionGet(st.root.regionId)) : "network";
    if (typeof toast === "function")
      toast("→ REINFORCE QUEUE · " + lbl + " (" + st.queue.length + "/" + RF_NET.queueMax
        + ") · edit on LOADOUT · flies when undocked", "#57e6ff", 2.6);
    if (typeof sfx === "function") sfx("buy");
    return { ok: true, root: st.root };
  },

  dequeueNetworkReinforcement(rootOrId, queueIdx) {
    const s = this.state;
    const root = typeof rootOrId === "object" ? rootOrId : this.outpostById(rootOrId);
    const st = this.networkReinforceState(root, "player");
    if (!st) return { ok: false, reason: "no network" };
    const d = st.queue[queueIdx];
    if (!d) return { ok: false, reason: "empty" };
    if (s.playerFleet.length >= DRONES.ownedMax) {
      if (typeof toast === "function") toast("personal hangar full (" + DRONES.ownedMax + ")"); sfx("warn");
      return { ok: false, reason: "hangar full" };
    }
    st.queue.splice(queueIdx, 1);
    d.role = "hangar"; d.state = "follow"; d.formationIdx = null;
    delete d.originId; delete d.outpostId; delete d.networkRootId;
    d.x = s.x; d.y = s.y;
    s.playerFleet.push(d);
    if (typeof this.reindexFormation === "function") this.reindexFormation(s);
    if (typeof toast === "function")
      toast("↩ " + ((DRONES.tiers[d.tier] || {}).name || "drone") + " back to hangar", "#8a8f98");
    if (typeof sfx === "function") sfx("drop");
    return { ok: true };
  },

  // Build straight into the docked network queue (when personal hangar is full).
  buildDroneToNetworkReinforcement(tier) {
    const s = this.state;
    const o = this.dockedOutpost && this.dockedOutpost();
    if (!o || o.owner !== "player") {
      if (typeof toast === "function") toast("dock at a held outpost to build into the queue", "#ff9a3c");
      sfx("warn"); return { ok: false, reason: "not at outpost" };
    }
    const st = this.networkReinforceState(o, "player");
    if (!st) return { ok: false, reason: "no network" };
    const spec = DRONES.tiers[tier];
    if (!spec) return { ok: false, reason: "bad tier" };
    if (st.queue.length >= RF_NET.queueMax) {
      toast("reinforcement queue full"); sfx("warn"); return { ok: false, reason: "queue full" };
    }
    if (s.credits < spec.cost) { toast("need " + spec.cost + "cr"); sfx("warn"); return { ok: false, reason: "credits" }; }
    for (const m of spec.materials)
      if ((s.refinedBars[m.type] || 0) < m.n) {
        toast("need " + m.n + " " + m.type + " bars"); sfx("warn"); return { ok: false, reason: "materials" };
      }
    s.credits -= spec.cost;
    for (const m of spec.materials) s.refinedBars[m.type] -= m.n;
    const d = {
      id: this._nextDroneId++, tier, role: "reinforce",
      hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
      fuel: spec.maxFuel, maxFuel: spec.maxFuel,
      loadout: spec.loadout.map(m => ({ ...m })),
      formationIdx: null, offsetX: 0, offsetY: 0,
      state: "queued", targetAlienId: null, wcd: 0, vx: 0, vy: 0,
      x: o.x, y: o.y, originId: o.id, networkRootId: st.root.id,
    };
    const dsk = (s.derived && s.derived.droneSkill) || {};
    if (dsk.hullMult) { d.maxHp = Math.round(spec.maxHp * dsk.hullMult); d.hp = d.maxHp; }
    if (dsk.shieldMult) { d.maxShield = Math.round(spec.maxShield * dsk.shieldMult); d.shield = d.maxShield; }
    st.queue.push(d);
    toast("built → reinforce queue (" + st.queue.length + "/" + RF_NET.queueMax + ")", "#57e6ff", 2);
    sfx("buy");
    return { ok: true, drone: d };
  },

  // ---- tick: dispatch (undocked) + transit ----------------------------------
  updateNetworkReinforcements(dt) {
    const s = this.state;
    if (!s || !s.outposts || !s.outposts.length) return;
    this.consolidateNetworkQueues();
    // Frozen while docked — player is still shopping / fitting modules
    const dispatchOk = !s.docked;
    for (const root of this.allPlayerNetworkRoots()) {
      const st = this.networkReinforceState(root);
      if (!st) continue;
      if (dispatchOk) this._dispatchNetworkQueue(st, root);
      this._tickNetworkTransit(st, root, dt);
    }
  },

  _dispatchNetworkQueue(st, root) {
    if (!st.queue.length) return;
    // Prefer last docked origin in this network, else root
    let origin = root;
    const docked = this.dockedOutpost && this.dockedOutpost();
    // already undocked — use root or first member as launch pad
    const members = this.outpostNetworkMembers(root, "player");
    if (members.length) origin = members[0];

    for (let qi = 0; qi < st.queue.length; ) {
      const d = st.queue[qi];
      const gaps = this.networkFortificationGaps(root, "player");
      if (!gaps.length) break; // no berths anywhere — wait
      let dispatched = false;
      for (const gap of gaps) {
        if (gap.open <= 0) continue;
        // Launch from origin if path exists; else from any member that can reach dest
        let path = this.networkReinforcePath(origin.id, gap.o.id, "player");
        let launch = origin;
        if (!path.length) {
          for (const m of members) {
            path = this.networkReinforcePath(m.id, gap.o.id, "player");
            if (path.length) { launch = m; break; }
          }
        }
        // Same-outpost berth fill (path of one)
        if (!path.length && launch.id === gap.o.id) path = [gap.o.id];
        if (!path.length) continue;
        st.queue.splice(qi, 1);
        d.role = "reinforce"; d.state = "transit";
        d.x = launch.x; d.y = launch.y; d.vx = 0; d.vy = 0;
        d.outpostId = gap.o.id; d.originId = launch.id;
        d.fuel = d.maxFuel;
        st.transit.push({ drone: d, path, hop: 0, destId: gap.o.id, originId: launch.id });
        dispatched = true;
        break;
      }
      if (!dispatched) qi++;
    }
  },

  _tickNetworkTransit(st, root, dt) {
    const s = this.state;
    const speed = (typeof REINFORCE !== "undefined" && REINFORCE.speed) || RF_NET.speed;
    for (let i = st.transit.length - 1; i >= 0; i--) {
      const t = st.transit[i];
      const d = t.drone;
      const dest = this.outpostById(t.destId);
      if (!dest || dest.owner !== "player") {
        // Lost ownership — requeue on root
        d.role = "reinforce"; d.state = "queued";
        if (st.queue.length < RF_NET.queueMax) st.queue.push(d);
        st.transit.splice(i, 1);
        continue;
      }
      const hopId = t.path[Math.min(t.hop, t.path.length - 1)];
      const wp = this.outpostById(hopId);
      if (!wp || wp.owner !== "player") {
        // Path broke — repath
        const path = this.networkReinforcePath(t.originId || root.id, t.destId, "player");
        if (!path.length) {
          d.role = "reinforce"; d.state = "queued";
          if (st.queue.length < RF_NET.queueMax) st.queue.push(d);
          st.transit.splice(i, 1);
          continue;
        }
        t.path = path; t.hop = 0;
        continue;
      }
      const dx = wp.x - d.x, dy = wp.y - d.y;
      const dist = Math.hypot(dx, dy) || 1;
      const step = speed * dt;
      if (dist <= step + RF_NET.arriveR) {
        d.x = wp.x; d.y = wp.y;
        if (t.hop < t.path.length - 1) {
          t.hop++;
        } else {
          // Arrive at destination berth
          if (!dest.stationedDrones) dest.stationedDrones = [];
          const max = CONFIG.outpostStationedMax || 3;
          if (dest.stationedDrones.length < max) {
            d.role = "stationed"; d.state = "stationed"; d.outpostId = dest.id;
            d.formationIdx = null; d.targetAlienId = null; d.vx = d.vy = 0;
            d.fuel = d.maxFuel;
            delete d.networkRootId; delete d.originId;
            dest.stationedDrones.push(d);
            if (typeof toast === "function")
              toast("⛨ reinforced " + (this.regionLabel
                ? this.regionLabel(this.regionGet(dest.regionId)) : "outpost"), "#22cccc", 1.6);
          } else {
            d.role = "reinforce"; d.state = "queued";
            if (st.queue.length < RF_NET.queueMax) st.queue.push(d);
          }
          st.transit.splice(i, 1);
        }
      } else {
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
        d.vx = (dx / dist) * speed;
        d.vy = (dy / dist) * speed;
      }
    }
  },

  // World draw: reinforce transit (queued drones are off-map / at platform)
  drawNetworkReinforceWorld(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s || !s.outposts) return;
    const z = s.cam.zoom, viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 900;
    for (const root of this.allPlayerNetworkRoots()) {
      const st = this.networkReinforceState(root);
      if (!st) continue;
      for (const t of st.transit) {
        const d = t.drone;
        if (this.dist(d.x, d.y, s.cam.x, s.cam.y) > viewR) continue;
        const p = this.SF(d.x, d.y), sz = 9 * z;
        const ang = Math.atan2(d.vy || 0, d.vx || 1);
        const dcol = "#57e6ff";
        if (typeof ART !== "undefined" && ART.draw
            && !ART.draw(g, "drone_t" + (d.tier || 0), p.x, p.y, sz * (2.8 + (d.tier || 0) * 0.4), ang)) {
          if (this.drawDroneShape) this.drawDroneShape(g, p.x, p.y, ang, sz, dcol);
        } else if (this.drawDroneShape) {
          this.drawDroneShape(g, p.x, p.y, ang, sz, dcol);
        }
      }
    }
  },
});
