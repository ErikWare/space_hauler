/*=== HARNESS:POLITICS =======================================================*/
// Faction politics driver — the living-world layer over game/regions.js.
// ALL ~150–400 organic outposts are the battlefield: every 90–150s two
// factions skirmish across a contested border — 60% the attacker flips ONE
// random enemy outpost inside the target region, 40% the defender holds. A
// region's controller is whichever side owns the most outposts inside its
// geometric bounds (getOutpostsInRegion), so each skirmish nudges a tally of
// dozens and the front line drifts slowly over a long session — a region only
// changes hands after many skirmishes swing its majority. Each resolution
// pushes a newsline into s.politicsEvents (newest-first ring buffer, 8 deep)
// that the flight HUD scrolls through a top-of-screen ticker; player
// captures/losses (game/outposts.js hooks) feed the same wire and the same
// majorities. Also owns the faction "heat" ledger: 3+ kills against a faction
// inside 5 minutes turns its patrols (game/encounters.js) aggressive-on-sight.
const POLITICS = {
  minInterval: 90, maxInterval: 150,   // seconds between border skirmishes
  attackerWinChance: 0.6,
  maxEvents: 8,                        // ring buffer depth
  eventLife: 8,                        // seconds a newsline holds the ticker
  killMemory: 300,                     // faction kill ledger window (5 min)
  aggroKills: 3,                       // kills inside the window → hostile patrols
  contestPulseT: 30,                   // map wedge pulses this long after a flip
  factionCol: { vex: "#ff5060", krag: "#ffb040", nox: "#b06cff", player: "#57d1c9" },
  factionName: { vex: "Vex", krag: "Krag", nox: "Nox", player: "the Commander" },
  msgs: {
    // {o} outpost designation · {r} region name · {f} opposing faction name
    "vex>krag": [
      "Vex strike force seizes {o}",
      "Vex warships push into {r}",
      "Dominion lances burn through the Krag pickets at {o}",
      "Vex shock troops storm {o} — Krag defenders scattered",
      "The Dominion plants its banner on {o}",
      "Vex vanguard overruns Krag positions across {r}",
      "Krag garrison at {o} breaks under Vex bombardment",
      "{o} falls in hours — the Vex crusade rolls on",
      "Vex reprisal fleet levels the Krag yards at {o}",
    ],
    "krag>vex": [
      "Krag scavengers raid {o}",
      "Krag salvage fleets strip {o} to the ribs",
      "Krag breakers swarm the Vex lines in {r}",
      "{o} goes dark — Krag wreckers move in",
      "Krag industrial guard annexes {o}",
      "Vex garrison at {o} sold for scrap — the Krag take the field",
      "Krag drill-barges breach the Vex cordon at {o}",
      "The Krag claim {o} — every bolt of it",
      "Krag press-gangs empty {o} before the Vex relief arrives",
    ],
    "krag>nox": [
      "Krag expansion fleet engages the Nox border",
      "Krag prospectors wrench {o} from the silence",
      "Krag floodlights drive the dark out of {o}",
      "Krag wreckers cut deep into {r}",
      "{o} rings with Krag hammers — the Nox withdraw",
      "Krag convoy guns scatter the Nox watch at {o}",
      "The Krag torch the still shrines of {o}",
      "Krag claim-markers rise across {r}",
      "Nox beacons at {o} fall silent under Krag cutting torches",
    ],
    "nox>krag": [
      "Nox collective absorbs {o} into the silence",
      "{o} stops transmitting — the Nox have come",
      "Nox shades drift through the Krag lines in {r}",
      "Krag miners flee {o} ahead of the advancing dark",
      "The Nox reclaim {o} — no shots recorded",
      "Cold signals blanket {r} — Nox ascendancy at {o}",
      "Nox tithe-ships settle over {o} and do not leave",
      "The silence takes {o}",
      "Krag distress calls from {o} cut off mid-word",
    ],
    "vex>nox": [
      "Vex crusade fleet burns into the silence at {o}",
      "Dominion lances pierce the Nox veil — {o} taken",
      "The Vex drag {o} back into the light",
      "Vex purge squads sweep the shrine-decks of {o}",
      "{o} falls — the Dominion does not fear the dark",
      "Vex warships shatter the stillness over {r}",
      "The silence at {o} is answered with Vex fire",
      "Vex banners burn bright where {o} kept its vigil",
    ],
    "nox>vex": [
      "The Nox unmake the Vex garrison at {o}",
      "{o} goes dark — Dominion signals cease",
      "Nox shades pass the Vex pickets in {r} unseen",
      "The silence closes over {o}",
      "Vex defenders at {o} are found drifting, systems cold",
      "Nox tithe-ships claim {o} without a single hail",
      "The dark advances — {o} absorbed into the collective",
      "{o} answers no more — the Dominion line thins",
    ],
    "hold:vex": [
      "Vex iron holds the line at {o}",
      "Vex guns turn the assault on {r}",
      "Dominion garrison repels raiders at {o}",
      "The attack on {o} dies on Vex armor",
    ],
    "hold:krag": [
      "Krag barricades hold at {o}",
      "Krag wreckers repel the push into {r}",
      "The raid on {o} breaks against Krag plate",
      "Krag hold {o} — the attackers limp home as scrap",
    ],
    "hold:nox": [
      "The silence over {o} does not lift",
      "Nox stillness swallows the assault on {r}",
      "The attack on {o} fades — the Nox remain",
      "The Nox do not yield {o}",
    ],
    player_take: [
      "Commander seizes {o} from {f}",
      "Commander's flag rises over {o}",
      "{o} taken — {f} forces routed by the Commander",
      "The Commander cracks {f} defenses at {o}",
    ],
    player_lose: [
      "{o} has fallen to {f} forces",
      "{o} lost — {f} banners over the wreckage",
      "{f} retakes {o} from the Commander",
      "Commander's garrison at {o} is overrun by {f}",
    ],
    region_take: {
      vex:    "{r} falls under Vex dominion",
      krag:   "Krag salvage law now rules {r}",
      nox:    "{r} passes into the silence",
      player: "REGION SECURED — the Commander now holds {r}",
    },
  },
};

Object.assign(GAME, {
  // ---- init / per-frame -----------------------------------------------------
  initPolitics(s) {
    s = s || this.state;
    s.politicsTimer = 0;
    s.politicsEvents = [];
    s.factionKills = { vex: 0, krag: 0, nox: 0 };
    s.factionKillTimer = { vex: 0, krag: 0, nox: 0 };
    s._politicsNext = POLITICS.minInterval + rnd() * (POLITICS.maxInterval - POLITICS.minInterval);
    // REGIONS is module-static — reset live fields, then let the live outpost
    // majorities elect each controller (pie-native seeding → founders hold).
    for (const r of REGIONS) { r.controller = r.faction; r.lastContestT = -1e9; r.contestFrom = null; }
    for (const r of REGIONS) this._recalcRegionController(r, s);
  },

  updatePolitics(s, dt) {
    s = s || this.state;
    if (!s || !s.politicsEvents) return;
    for (const ev of s.politicsEvents) ev.t += dt;
    this._tickFactionHeat(s, dt);
    s.politicsTimer += dt;
    if (s.politicsTimer >= s._politicsNext) {
      s.politicsTimer = 0;
      s._politicsNext = POLITICS.minInterval + rnd() * (POLITICS.maxInterval - POLITICS.minInterval);
      this.resolveBorderSkirmish(s);
    }
    this.checkEmpireProgress(s);   // endgame: empire count + faction collapse + 10/10 victory (game/victory.js)
  },

  // ---- news wire --------------------------------------------------------------
  pushEvent(s, msg, col) {
    s = s || this.state;
    if (!s.politicsEvents) s.politicsEvents = [];
    s.politicsEvents.unshift({ msg, col: col || "#c7d2e0", t: 0 });
    if (s.politicsEvents.length > POLITICS.maxEvents) s.politicsEvents.length = POLITICS.maxEvents;
  },
  _polOutpostName(o) {   // every outpost already has a map identity — reuse it
    return "outpost " + this.regionLabel(this.regionGet(o.regionId));
  },
  _polMsg(pool, o, region, foeFaction) {
    const m = pool[(rnd() * pool.length) | 0];
    return m.replace(/\{o\}/g, o ? this._polOutpostName(o) : "the border")
            .replace(/\{r\}/g, region ? region.name : "the border")
            .replace(/\{f\}/g, POLITICS.factionName[foeFaction] || foeFaction || "enemy");
  },

  // ---- faction heat (kill ledger drives patrol aggression) --------------------
  onFactionShipKilled(al) {
    const s = this.state;
    if (!s || !s.factionKills || !al || s.factionKills[al.faction] == null) return;
    s.factionKills[al.faction]++;
    s.factionKillTimer[al.faction] = POLITICS.killMemory;
  },
  _tickFactionHeat(s, dt) {
    for (const f of CONFIG.factions) {
      if (s.factionKillTimer[f] > 0) {
        s.factionKillTimer[f] -= dt;
        if (s.factionKillTimer[f] <= 0) { s.factionKillTimer[f] = 0; s.factionKills[f] = 0; }
      }
    }
  },
  isFactionAggro(fac) {
    const s = this.state;
    return !!(s && s.factionKills && s.factionKills[fac] >= POLITICS.aggroKills);
  },

  // ---- border skirmish resolution ---------------------------------------------
  // Fronts are (attacker, region) pairs from getContestableRegions where the
  // defending controller is an NPC faction and the region still holds enemy
  // outposts the attacker can take. One skirmish = one outpost — the regional
  // majority shifts slowly across many resolutions. Player-held regions are
  // never auto-skirmished (outpost reclaim waves already contest those), and
  // player-owned outposts are never political currency.
  resolveBorderSkirmish(s, opts) {
    s = s || this.state; opts = opts || {};
    const fronts = [];
    for (const atk of CONFIG.factions) {
      for (const r of getContestableRegions(atk)) {
        if (!CONFIG.factions.includes(r.controller)) continue;
        const targets = getOutpostsInRegion(r.id, s.outposts)
          .filter(o => CONFIG.factions.includes(o.owner) && o.owner !== atk);
        if (targets.length) fronts.push({ region: r, attacker: atk, defender: r.controller, targets });
      }
    }
    if (!fronts.length) return null;
    const f = fronts[(rnd() * fronts.length) | 0];
    const win = opts.forceWin != null ? opts.forceWin : rnd() < POLITICS.attackerWinChance;
    if (!win) {
      this.pushEvent(s, this._polMsg(POLITICS.msgs["hold:" + f.defender] || POLITICS.msgs["hold:krag"],
        f.targets[0], f.region, f.attacker), POLITICS.factionCol[f.defender]);
      return { region: f.region, attacker: f.attacker, defender: f.defender, win: false, outpost: null };
    }
    const o = f.targets[(rnd() * f.targets.length) | 0];
    const prevOwner = o.owner;
    this._politicsFlipOutpost(o, f.attacker);
    f.region.lastContestT = s.t;
    f.region.contestFrom = prevOwner;
    const pool = POLITICS.msgs[f.attacker + ">" + prevOwner] || POLITICS.msgs["vex>krag"];
    this.pushEvent(s, this._polMsg(pool, o, f.region, prevOwner), POLITICS.factionCol[f.attacker]);
    const prev = f.region.controller;
    this._recalcRegionController(f.region, s);
    if (f.region.controller !== prev)
      this.pushEvent(s, POLITICS.msgs.region_take[f.region.controller].replace(/\{r\}/g, f.region.name),
        POLITICS.factionCol[f.region.controller]);
    return { region: f.region, attacker: f.attacker, defender: f.defender, win: true, outpost: o };
  },
  // Hand an NPC outpost to a faction: fresh garrison, fresh flags. Streamed
  // guards are folded out first so the next approach materializes the new owner.
  _politicsFlipOutpost(o, fac) {
    if (!o || o.owner === "player") return;
    if (o.streamed) this._streamGuardsOut(o);
    o.owner = fac; o.faction = fac;
    o.provoked = false; o.capturable = false;
    o.guardRecs.forEach(r => { r.alive = true; r.frac = 1; });
    if (o.shieldMax != null) { o.shield = o.shieldMax; o.armor = o.armorMax; o.hull = o.hullMax; }   // new garrison repairs the platform
    const gridRegion = this.regionGet(o.regionId);
    if (gridRegion && gridRegion.owner !== "player") gridRegion.owner = fac;
  },
  // controller = whoever owns ≥60% of outposts inside the region's geometric
  // bounds; below 60% the incumbent holds (prevents rapid oscillation).
  // Ties and sub-threshold pluralities keep the current controller.
  _recalcRegionController(r, s) {
    s = s || this.state;
    const inside = getOutpostsInRegion(r.id, s.outposts);
    const total = inside.length;
    if (!total) return false;
    const tally = {};
    for (const o of inside) tally[o.owner] = (tally[o.owner] || 0) + 1;
    let best = r.controller, bestN = 0;
    for (const k in tally) if (tally[k] > bestN) { best = k; bestN = tally[k]; }
    const top = Object.keys(tally).filter(k => tally[k] === bestN);
    if (top.length > 1 && top.includes(r.controller)) best = r.controller;
    if (best === r.controller) return false;
    if (bestN / total < 0.6) return false;
    setRegionController(r.id, best);
    return true;
  },

  // ---- player capture / loss hooks (called from game/outposts.js) --------------
  onOutpostCaptured(o) {
    const s = this.state;
    this.pushEvent(s, this._polMsg(POLITICS.msgs.player_take, o, null, o.faction), POLITICS.factionCol.player);
    this._polTouchRegion(o, o.faction);
  },
  onOutpostLost(o) {
    const s = this.state;
    this.pushEvent(s, this._polMsg(POLITICS.msgs.player_lose, o, null, o.faction), "#ff5060");
    this._polTouchRegion(o, "player");
  },
  _polTouchRegion(o, fromSide) {
    const s = this.state, pr = politicalRegionAt(o.x, o.y);
    if (!pr) return;
    pr.lastContestT = s.t;
    pr.contestFrom = fromSide;
    const prev = pr.controller;
    this._recalcRegionController(pr, s);
    if (pr.controller !== prev)
      this.pushEvent(s, POLITICS.msgs.region_take[pr.controller].replace(/\{r\}/g, pr.name),
        POLITICS.factionCol[pr.controller]);
  },

  // ---- HUD news ticker ----------------------------------------------------------
  // Latest newsline, top-center of the flight HUD: fades in, holds 8s, fades out.
  drawPoliticsTicker(g) {
    if (HEADLESS) return;
    const s = this.state, ev = s.politicsEvents && s.politicsEvents[0];
    if (!ev || ev.t > POLITICS.eventLife) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const a = Math.min(Math.min(1, ev.t / 0.5), Math.min(1, Math.max(0, (POLITICS.eventLife - ev.t) / 1)));
    const w = 300 * k, cx = CONFIG.W / 2, cy = 74 * k;
    g.save(); g.globalAlpha = a;
    g.fillStyle = "rgba(5,7,13,0.55)";
    g.beginPath(); g.roundRect(cx - w / 2, cy - 9 * k, w, 16 * k, 5 * k); g.fill();
    g.font = `${Math.max(8, 9 * k) | 0}px monospace`; g.textAlign = "center";
    g.fillStyle = ev.col || "#c7d2e0";
    let txt = "✦ " + ev.msg;
    while (txt.length > 8 && g.measureText(txt).width > w - 14 * k) txt = txt.slice(0, -2);
    if (txt.length < ev.msg.length + 2) txt += "…";
    g.fillText(txt, cx, cy + 3 * k);
    g.textAlign = "left"; g.restore();
  },

  // ---- simulation: instant N-round war for testing faction balance -----------
  simulateFactionWar(s, rounds) {
    s = s || this.state;
    const tally = { vex: 0, krag: 0, nox: 0, player: 0 }, flips = [];
    for (let i = 0; i < rounds; i++) {
      const prev = REGIONS.map(r => r.controller);
      this.resolveBorderSkirmish(s);
      for (let j = 0; j < REGIONS.length; j++) {
        if (REGIONS[j].controller !== prev[j]) {
          flips.push(REGIONS[j].id);
          tally[REGIONS[j].controller]++;
        }
      }
    }
    return { vex: tally.vex, krag: tally.krag, nox: tally.nox, player: tally.player, flips };
  },
});
