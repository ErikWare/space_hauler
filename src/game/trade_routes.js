/*=== HARNESS:TRADE_ROUTES ===================================================*/
// Outpost trade routes — captured outposts become credit-generating logistics
// nodes instead of static docking points. Every FORTIFY-stationed drone doubles
// as a freighter: while its home outpost is calm it flies a ROUND-TRIP loop to
// one of the outpost's LOCAL neighbors (nearest ≤3 outposts within TROUTE.maxDist
// — never a cross-map haul) that the player also owns, earning credits each time
// it completes the full out-and-back. A light dashed lane draws in space and on
// the galaxy overlay, so a built-out empire visibly comes alive with traffic.
//
// Simulation model: legs are WALL-CLOCK (departMs → legMs), the same pattern as
// the Phase-3 station trade drones, so loops progress even when the player is on
// the far side of the disc (or docked). Defense keeps priority — a threatened
// outpost launches its berthed drones as before (updateOutpostDefense), no new
// trade leg departs while raiders are inside the perimeter (or a strike force
// is inbound, o.underAttack), and every mid-route freighter is RECALLED: it
// abandons the run and burns home at recallSpeedMult to stand with the defense
// — guarding the platform outranks trade. Only a leg already inbound with cargo
// keeps its payout. Once the platform is clear, loops resume on their own.
//
// Pirate raids ("protect the trade route"): on a slow clock, one active lane is
// ambushed — warning toast + politics wire + flashing lane on the galaxy map,
// mirroring the outpost reclaim-wave UX. Fly to the ambush point before the
// timer runs out and REAL pirates spawn to kill for a defense bonus; ignore it
// and the freighter drone takes the hit abstractly (and can be destroyed).
//
// Persistence: routes/raids are derived + transient — only the lifetime earnings
// counter persists (s.tradeRouteEarnings; save.js). Restored stationed drones are
// normalized back to their berth (wall-clock departMs would be stale).
const TROUTE = {
  neighborMax: 3,        // "local neighbors" per outpost (nearest, distance-capped)
  maxDist: 20000,        // reasonable-distance cap — beyond this is not "local"
  speed: 260,            // u/s along the lane (wall-clock legs)
  recallSpeedMult: 1.5,  // recalled freighters burn home this much faster than lane cruise
  payoutTier: [30, 55, 110],   // credits per completed ROUND TRIP, by drone tier
  dwellS: 4,             // berth pause at home between trips (visible docking beat)
  turnS: 2.5,            // turnaround pause at the far end
  laneGap: 70,           // perpendicular fan-out per berth so parallel drones read as lanes
  dockRepairPerS: 4,     // hp+shield/s patched while berthed at home (keeps loops sustainable)
  raidGraceS: 180,       // quiet period after the first lane opens
  raidEveryMin: 300, raidEveryMax: 540,   // seconds between lane ambushes
  raidResolveT: 45,      // countdown before an ignored ambush resolves abstractly
  raidEngageR: 2600,     // player inside this of the ambush → real pirates spawn
  raidDmgFrac: 0.6,      // ignored ambush costs this fraction of the freighter's pool…
  raidDmgFloor: 40,      // …with a floor, so a healthy drone limps home but a worn one dies
  defendBonus: 200,      // base credits for clearing the ambush (× danger loot mult)
  laneCol: "#22cccc", laneRaidCol: "#ff5060",
};

Object.assign(GAME, {
  // ---- local-neighbor graph (deterministic world → computed at seed, no save) ----
  computeOutpostNeighbors() {
    const s = this.state, os = s.outposts || [];
    for (const o of os) {
      o.neighborIds = os
        .filter(n => n !== o)
        .map(n => ({ id: n.id, d: this.dist(o.x, o.y, n.x, n.y) }))
        .filter(e => e.d <= TROUTE.maxDist)
        .sort((a, b) => a.d - b.d)
        .slice(0, TROUTE.neighborMax)
        .map(e => e.id);
    }
  },
  tradeNeighborsOwned(o) {
    return (o.neighborIds || []).map(id => this.outpostById(id))
      .filter(n => n && n.owner === "player");
  },
  // active + established lane pairs for drawing: every owned outpost with ≥1
  // berthed/trading drone lights a lane to each owned neighbor. Deduped by key.
  tradeRoutePairs() {
    const s = this.state, seen = new Set(), pairs = [];
    const raid = s.tradeRaid;
    for (const o of (s.outposts || [])) {
      if (o.owner !== "player" || !o.stationedDrones || !o.stationedDrones.length) continue;
      for (const n of this.tradeNeighborsOwned(o)) {
        const key = o.id < n.id ? o.id + "|" + n.id : n.id + "|" + o.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const raided = !!(raid && ((raid.outpostId === o.id && raid.destId === n.id) ||
                                   (raid.outpostId === n.id && raid.destId === o.id)));
        pairs.push({ a: o, b: n, raided });
      }
    }
    return pairs;
  },

  // ---- the loop simulation (runs every frame, docked or not — wall-clock legs) ----
  updateTradeRoutes(dt) {
    const s = this.state;
    if (!s || !s.outposts) return;
    const now = this._nowMs();
    for (const o of s.outposts) {
      if (!o.stationedDrones || !o.stationedDrones.length) continue;
      if (o.owner !== "player") {   // outpost fell with drones mid-route: routes die with it
        for (const d of o.stationedDrones) if (d.route) { delete d.route; d.state = "stationed"; }
        continue;
      }
      // attack alert: live raiders inside the perimeter (s.aliens is streaming-
      // local, so this half only exists while the sim is live) OR an inbound
      // reclaim strike force (o.underAttack — wall-clock, works anywhere).
      let threat = false;
      for (const al of s.aliens) {
        if (al.state === "DEAD" || al.hp.hull <= 0) continue;
        if (this.dist(o.x, o.y, al.x, al.y) < CONFIG.outpostDefendR) { threat = true; break; }
      }
      const alert = threat || !!o.underAttack;
      // under attack → every assigned freighter abandons its run and burns home;
      // guarding the platform outranks trade (loops resume once it's clear)
      if (alert) {
        let recalled = 0;
        for (const d of o.stationedDrones)
          if (d.state === "trade" && d.route && d.route.leg !== "recall") { this._recallFreighter(o, d, now); recalled++; }
        if (recalled)
          toast("⟲ freighters recalled to defend " + this.regionLabel(this.regionGet(o.regionId)), "#ff9a3c");
      }
      for (let di = 0; di < o.stationedDrones.length; di++) {
        const d = o.stationedDrones[di];
        if (d.state === "trade") { this._tickTradeLeg(o, d, dt, now); continue; }
        if (d.state === "defend" || d.state === "return") continue;   // fighting — defense AI owns it
        // berthed: outpost crew patches the freighter, then the next loop departs
        d.hp = Math.min(d.maxHp, (d.hp || 0) + TROUTE.dockRepairPerS * dt);
        d.shield = Math.min(d.maxShield, (d.shield || 0) + TROUTE.dockRepairPerS * dt);
        if (d.tradeDwellT > 0) { d.tradeDwellT -= dt; continue; }
        if (alert) continue;   // no departures while the platform is threatened
        const owned = this.tradeNeighborsOwned(o);
        if (!owned.length) continue;   // no owned local neighbor → pure defense duty
        const dest = owned[di % owned.length];   // berth i works lane i (cycled)
        const legDist = this.dist(o.x, o.y, dest.x, dest.y);
        d.state = "trade";
        d.targetAlienId = null;
        d.route = {
          destId: dest.id, leg: "out", departMs: now,
          legMs: Math.max(1000, legDist / TROUTE.speed * 1000),
          laneOffset: (di - (CONFIG.outpostStationedMax - 1) / 2) * TROUTE.laneGap,
          payout: TROUTE.payoutTier[d.tier] || TROUTE.payoutTier[0],
          turnT: 0,
        };
      }
    }
  },
  // attack recall: replace whatever leg the freighter is on with a straight
  // wall-clock burn from its CURRENT position back to the home platform. A leg
  // already inbound ("back") keeps its round-trip payout — the cargo is aboard;
  // an aborted out-leg/turnaround banks nothing.
  _recallFreighter(o, d, now) {
    const r = d.route, dd = this.dist(d.x, d.y, o.x, o.y);
    d.route = {
      destId: r.destId, leg: "recall", departMs: now,
      legMs: Math.max(500, dd / (TROUTE.speed * TROUTE.recallSpeedMult) * 1000),
      fx: d.x, fy: d.y,             // recall starts wherever the freighter was
      laneOffset: 0, turnT: 0,
      payout: r.leg === "back" ? r.payout : 0,
    };
  },
  // land at the home berth: bank whatever the run earned, then dwell
  _dockFreighter(o, d, pay) {
    if (pay) {
      const s = this.state;
      s.credits += pay;
      s.tradeRouteEarnings = (s.tradeRouteEarnings || 0) + pay;
      this.addXpFromCredits(pay);   // XP: running trade runs (outpost logistics)
      if (this.dist(s.x, s.y, o.x, o.y) < 2600)
        toast(`⇄ trade loop +${pay}cr — ${this.regionLabel(this.regionGet(o.regionId))}`, TROUTE.laneCol);
    }
    delete d.route;
    d.state = "stationed";
    d.tradeDwellT = TROUTE.dwellS;
    d.vx = d.vy = 0;
  },
  _tickTradeLeg(o, d, dt, now) {
    const r = d.route;
    if (!r) { d.state = "stationed"; return; }
    if (r.leg === "recall") {   // outpost under attack — off the lane, burning home
      const prog = clamp((now - r.departMs) / r.legMs, 0, 1);
      d.x = lerp(r.fx, o.x, prog); d.y = lerp(r.fy, o.y, prog);
      const a = Math.atan2(o.y - r.fy, o.x - r.fx), spd = TROUTE.speed * TROUTE.recallSpeedMult;
      d.vx = Math.cos(a) * spd; d.vy = Math.sin(a) * spd;
      if (prog >= 1) this._dockFreighter(o, d, r.payout);   // re-berthed → defense AI can launch it
      return;
    }
    const dest = this.outpostById(r.destId);
    if (!dest) { delete d.route; d.state = "stationed"; return; }
    if (r.leg === "turn") {   // brief far-end turnaround: hold position, then run home
      r.turnT -= dt;
      if (r.turnT <= 0) { r.leg = "back"; r.departMs = now; }
      return;
    }
    const back = r.leg === "back";
    const fx = back ? dest.x : o.x, fy = back ? dest.y : o.y;
    const tx = back ? o.x : dest.x, ty = back ? o.y : dest.y;
    const prog = clamp((now - r.departMs) / r.legMs, 0, 1);
    const a = Math.atan2(ty - fy, tx - fx) + Math.PI / 2;   // lane offset ⊥ to the route
    d.x = lerp(fx, tx, prog) + Math.cos(a) * r.laneOffset;
    d.y = lerp(fy, ty, prog) + Math.sin(a) * r.laneOffset;
    d.vx = Math.cos(a - Math.PI / 2) * TROUTE.speed;   // heading for the renderer
    d.vy = Math.sin(a - Math.PI / 2) * TROUTE.speed;
    if (prog < 1) return;
    if (!back) { r.leg = "turn"; r.turnT = TROUTE.turnS; return; }
    this._dockFreighter(o, d, r.payout);   // full round trip complete — bank the run
  },

  // ---- pirate ambushes on the lanes ("protect the trade route") ----------------
  // recall legs don't count: a freighter rushing home to defend isn't working a
  // lane, so new ambushes never target it (one already sprung can still catch it).
  _tradingDrones() {
    const s = this.state, out = [];
    for (const o of (s.outposts || [])) {
      if (o.owner !== "player" || !o.stationedDrones) continue;
      for (const d of o.stationedDrones)
        if (d.state === "trade" && d.route && d.route.leg !== "recall") out.push({ o, d });
    }
    return out;
  },
  updateTradeRaids(dt) {
    const s = this.state;
    if (!s || s.dead) return;
    const raid = s.tradeRaid;
    if (!raid) {
      const active = this._tradingDrones();
      if (!active.length) { s._tradeRaidT = null; return; }
      if (s._tradeRaidT == null)   // first lane just opened → grace, then the slow clock
        s._tradeRaidT = TROUTE.raidGraceS + TROUTE.raidEveryMin + rnd() * (TROUTE.raidEveryMax - TROUTE.raidEveryMin);
      s._tradeRaidT -= dt;
      if (s._tradeRaidT > 0) return;
      s._tradeRaidT = null;
      const pick = active[(rnd() * active.length) | 0];
      const region = this.regionGet(pick.o.regionId);
      s.tradeRaid = { outpostId: pick.o.id, destId: pick.d.route.destId, droneId: pick.d.id,
                      x: pick.d.x, y: pick.d.y, t: TROUTE.raidResolveT, aliens: null,
                      faction: pick.o.faction || "nox" };
      toast("⚠ PIRATES AMBUSH YOUR TRADE ROUTE — " + this.regionLabel(region), "#ff6b6b");
      sfx("warn"); AUDIO.play("warning");
      if (this.pushEvent) this.pushEvent(s, "pirates ambush the " + this.regionLabel(region) + " trade lane", "#ff9a3c");
      return;
    }
    // live fight: cleared when the whole ambush squad is down
    if (raid.aliens) {
      if (raid.aliens.every(a => a.state === "DEAD" || a.hp.hull <= 0)) {
        const o = this.outpostById(raid.outpostId);
        const bonus = Math.round(TROUTE.defendBonus * dangerLootMult(o ? o.dangerLevel : 1).credits);
        s.credits += bonus;
        this.addXpFromCredits(bonus);
        s.tradeRaid = null;
        toast("★ TRADE ROUTE DEFENDED  +" + bonus + "cr", "#57d1c9"); sfx("sell");
        return;
      }
    } else if (this.dist(s.x, s.y, raid.x, raid.y) < TROUTE.raidEngageR) {
      // player answered the call — the ambush becomes a real fight
      const grp = ForgeFaction.generateGroup(raid.faction, { x: raid.x + 400, y: raid.y + 400 },
        { rng: rnd, followerCount: 2 });
      const squad = [grp.leader, ...grp.followers];
      for (const a of squad) { a._tradeRaid = true; s.aliens.push(a); }
      ForgeFaction.activateGroup(grp.leader, s.aliens);
      raid.aliens = squad;
      toast("⚠ pirates sighted on the trade lane — engage!", "#ff6b6b"); sfx("warn");
    }
    // ambushed freighter already made it home → the pirates find an empty lane
    const victim = this._raidVictim(raid);
    if (!victim && !raid.aliens) { s.tradeRaid = null; return; }
    raid.t -= dt;
    if (raid.t > 0) return;
    // timer ran out (player absent or too slow): the freighter takes the hit
    if (victim) {
      const { o, d } = victim;
      let dmg = Math.max(TROUTE.raidDmgFloor, Math.round(TROUTE.raidDmgFrac * (d.maxHp + (d.maxShield || 0))));
      const soak = Math.min(d.shield || 0, dmg);
      d.shield -= soak; dmg -= soak;
      d.hp -= dmg;
      if (d.hp <= 0) {
        const i = o.stationedDrones.indexOf(d);
        if (i >= 0) o.stationedDrones.splice(i, 1);
        burst(d.x, d.y, "#ff5060", 16);
        toast("✖ freighter drone lost to pirates — " + this.regionLabel(this.regionGet(o.regionId)) + " lane", "#ff6b6b");
        sfx("boom");
      } else {
        toast("⚠ freighter mauled on the trade lane — limped home", "#ff9a3c");
        delete d.route; d.state = "stationed"; d.tradeDwellT = TROUTE.dwellS * 2;
        d.x = o.x; d.y = o.y; d.vx = d.vy = 0;
      }
    }
    s.tradeRaid = null;   // spawned-but-unkilled pirates linger as regular hostiles
  },
  _raidVictim(raid) {
    const o = this.outpostById(raid.outpostId);
    if (!o || o.owner !== "player" || !o.stationedDrones) return null;
    const d = o.stationedDrones.find(x => x.id === raid.droneId);
    return (d && d.state === "trade") ? { o, d } : null;
  },

  // ---- drawing: light dashed lanes in world space + raid alert -----------------
  drawTradeRoutesWorld(g) {
    if (HEADLESS) return;
    const s = this.state, z = s.cam.zoom;
    const pairs = this.tradeRoutePairs();
    if (!pairs.length) return;
    g.save();
    for (const pr of pairs) {
      const pa = this.SF(pr.a.x, pr.a.y), pb = this.SF(pr.b.x, pr.b.y);
      if (pr.raided) {
        const pulse = 0.5 + 0.5 * Math.sin(s.t * 6);
        g.strokeStyle = TROUTE.laneRaidCol; g.globalAlpha = 0.25 + pulse * 0.45;
        g.lineWidth = Math.max(1.2, 2 * z);
      } else {
        g.strokeStyle = TROUTE.laneCol; g.globalAlpha = 0.22;
        g.lineWidth = Math.max(0.8, 1.2 * z);
      }
      if (g.setLineDash) g.setLineDash([Math.max(4, 10 * z), Math.max(6, 14 * z)]);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
    }
    if (g.setLineDash) g.setLineDash([]);
    // ambush marker: pulsing red diamond at the raid point
    if (s.tradeRaid) {
      const p = this.SF(s.tradeRaid.x, s.tradeRaid.y);
      const pulse = 0.5 + 0.5 * Math.sin(s.t * 6), r = 8 + pulse * 5;
      g.globalAlpha = 0.5 + pulse * 0.5; g.strokeStyle = TROUTE.laneRaidCol; g.lineWidth = 2;
      g.beginPath(); g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y);
      g.closePath(); g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  },
  // blinking edge note while a lane is being hit (mirrors drawTraderAlert)
  drawTradeRouteAlert(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s.tradeRaid || Math.sin(s.t * 9) < -0.2) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    g.font = `bold ${Math.max(10, 12 * k) | 0}px monospace`; g.textAlign = "center";
    g.fillStyle = TROUTE.laneRaidCol;
    g.fillText("⚠ TRADE ROUTE UNDER ATTACK", CONFIG.W / 2, 74 * k);   // below the trader alert line
    g.textAlign = "left";
  },

  // ---- selfTest (headless; wired into build.py --check) ------------------------
  tradeRoutesSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      if (!this.state) this.init();
      const s = this.state;
      const snap = { credits: s.credits, xp: s.xp, level: s.level, skillPoints: s.skillPoints,
                     earnings: s.tradeRouteEarnings || 0 };

      // 1. neighbor graph: ≤ neighborMax each, all within maxDist, nearest-sorted.
      check(s.outposts.length > 4, "world should seed outposts");
      check(s.outposts.every(o => (o.neighborIds || []).length <= TROUTE.neighborMax), "neighbor cap");
      for (const o of s.outposts) {
        let prev = 0;
        for (const id of (o.neighborIds || [])) {
          const n = this.outpostById(id);
          const dd = this.dist(o.x, o.y, n.x, n.y);
          check(dd <= TROUTE.maxDist, "neighbor beyond maxDist: " + Math.round(dd));
          check(dd >= prev - 1e-6, "neighbors must be nearest-first");
          prev = dd;
        }
      }

      // 2. a berthed drone on an owned outpost with an owned neighbor departs a loop.
      const o = s.outposts.find(x => (x.neighborIds || []).length >= 1);
      check(!!o, "an outpost with a local neighbor exists");
      const nb = this.outpostById(o.neighborIds[0]);
      const own0 = { o: o.owner, n: nb.owner };
      o.owner = "player"; nb.owner = "player";
      const spec = DRONES.tiers[0];
      const drone = { id: 99901, tier: 0, role: "stationed", state: "stationed", outpostId: o.id,
                      x: o.x, y: o.y, vx: 0, vy: 0, wcd: 0, targetAlienId: null,
                      hp: spec.maxHp, maxHp: spec.maxHp, shield: spec.maxShield, maxShield: spec.maxShield,
                      fuel: spec.maxFuel, maxFuel: spec.maxFuel, loadout: spec.loadout.map(m => ({ ...m })) };
      o.stationedDrones.push(drone);
      drone.tradeDwellT = 0;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "trade" && drone.route && drone.route.destId === nb.id,
        "berthed drone should depart to the owned neighbor, got " + drone.state);
      check(this.tradeRoutePairs().some(p => (p.a === o && p.b === nb) || (p.a === nb && p.b === o)),
        "an active lane pair should register for drawing");

      // 3. wall-clock legs: out → turn → back → home pays the round trip.
      drone.route.departMs -= drone.route.legMs + 10;   // finish the out leg
      this.updateTradeRoutes(1 / 60);
      check(drone.route.leg === "turn", "out leg should end in a turnaround, got " + drone.route.leg);
      this.updateTradeRoutes(TROUTE.turnS + 0.1);       // burn the turnaround
      check(drone.route.leg === "back", "turnaround should flip to the back leg");
      const c0 = s.credits, e0 = s.tradeRouteEarnings || 0;
      drone.route.departMs -= drone.route.legMs + 10;   // finish the back leg
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "stationed" && !drone.route, "round trip should re-berth the drone");
      check(s.credits === c0 + TROUTE.payoutTier[0], "round trip should pay " + TROUTE.payoutTier[0] + "cr");
      check((s.tradeRouteEarnings || 0) === e0 + TROUTE.payoutTier[0], "lifetime earnings should accumulate");

      // 4. threat gates departures AND recalls mid-route freighters home to
      //    defend (the trade sim owns the flight — the defense AI still never
      //    touches a state:"trade" drone directly).
      const alien = { id: "tr_test", state: "COMBAT", x: o.x + 200, y: o.y,
                      hp: { shield: 0, armor: 0, hull: 10, hullMax: 10, res: {} } };
      s.aliens.push(alien);
      drone.tradeDwellT = 0;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "stationed", "threat inside the perimeter must hold departures");
      drone.state = "trade"; drone.route = { destId: nb.id, leg: "out", departMs: this._nowMs(), legMs: 60000, laneOffset: 0, payout: 30, turnT: 0 };
      drone.x = (o.x + nb.x) / 2; drone.y = (o.y + nb.y) / 2;   // caught mid-lane
      this.updateOutpostDefense(o, 1 / 60);
      check(drone.state === "trade" && drone.route.leg === "out", "defense AI must not yank a mid-route freighter");
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "trade" && drone.route.leg === "recall",
        "threat must recall the mid-route freighter, got " + (drone.route && drone.route.leg));
      check(drone.route.payout === 0, "an aborted out-leg must not keep its payout");
      const cR = s.credits;
      drone.route.departMs -= drone.route.legMs + 10;   // land the recall burn
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "stationed" && !drone.route, "recalled freighter re-berths at home");
      check(this.dist(drone.x, drone.y, o.x, o.y) < 1, "recall must end at the platform");
      check(s.credits === cR, "an aborted run banks nothing");
      check(!this._tradingDrones().length, "a recalled freighter is not a raid target");
      s.aliens.splice(s.aliens.indexOf(alien), 1);
      drone.tradeDwellT = 0;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "trade" && drone.route && drone.route.leg === "out",
        "freighter resumes trade loops once the threat clears");

      // 4b. an inbound strike force (o.underAttack) recalls too — and a leg
      //     already flying home with cargo keeps its round-trip payout.
      drone.route.leg = "back"; drone.route.departMs = this._nowMs();
      drone.x = nb.x; drone.y = nb.y;   // at the far end, inbound
      o.underAttack = { strength: 1, t: 999, aliens: null };
      this.updateTradeRoutes(1 / 60);
      check(drone.route && drone.route.leg === "recall" && drone.route.payout === TROUTE.payoutTier[0],
        "strike force must recall the freighter; inbound cargo keeps its payout");
      const cB = s.credits;
      drone.route.departMs -= drone.route.legMs + 10;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "stationed" && s.credits === cB + TROUTE.payoutTier[0],
        "back-leg recall banks the trip on arrival");
      drone.tradeDwellT = 0;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "stationed", "underAttack must hold departures");
      o.underAttack = null;
      drone.tradeDwellT = 0;
      this.updateTradeRoutes(1 / 60);
      check(drone.state === "trade" && drone.route && drone.route.leg === "out",
        "freighter resumes trade loops once the strike is repelled");

      // 5. raid lifecycle: ambush lands on the lane, timeout mauls the freighter.
      s.tradeRaid = null; s._tradeRaidT = 0.0001;
      this.updateTradeRaids(1 / 60);
      check(!!s.tradeRaid && s.tradeRaid.droneId === drone.id, "raid should target the only active freighter");
      const hp0 = drone.hp + (drone.shield || 0);
      s.tradeRaid.t = 0.0001;
      this.updateTradeRaids(1 / 60);
      check(!s.tradeRaid, "raid should resolve and clear");
      const hp1 = drone.hp + (drone.shield || 0);
      check(hp1 < hp0, "ignored ambush should damage the freighter (" + hp0 + " → " + hp1 + ")");
      check(drone.state === "stationed", "mauled freighter limps home to its berth");

      // 6. losing the home outpost kills its routes cleanly.
      drone.state = "trade"; drone.route = { destId: nb.id, leg: "out", departMs: this._nowMs(), legMs: 60000, laneOffset: 0, payout: 30, turnT: 0 };
      o.owner = o.faction;
      this.updateTradeRoutes(1 / 60);
      check(!drone.route && drone.state === "stationed", "lost outpost should void its routes");

      // cleanup
      o.stationedDrones.splice(o.stationedDrones.indexOf(drone), 1);
      o.owner = own0.o; nb.owner = own0.n;
      s.tradeRaid = null; s._tradeRaidT = null;
      s.credits = snap.credits; s.xp = snap.xp; s.level = snap.level; s.skillPoints = snap.skillPoints;
      s.tradeRouteEarnings = snap.earnings;
    } catch (e) {
      fails.push("FAIL: tradeRoutesSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
