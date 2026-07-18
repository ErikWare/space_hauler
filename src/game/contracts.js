/*=== HARNESS:CONTRACTS ======================================================*/
// Phase 4 — mercenary contracts. Station boards generate 3–4 jobs per dock
// (difficulty scales with station distance); the player holds ONE contract at
// a time, tracked through the existing kill / loot hooks. Forge modules are
// called by API only: ForgeFaction spawns bounty targets + raid waves,
// ForgeCombat.applyDamage hurts the escort freighter, ForgeNPC.drawNPCShip
// renders it. UI is a DOM overlay (#contractsPanel) matching the gear tab,
// plus an always-visible HUD box and minimap icons overlaying ForgeHUD.
const CONTRACTS = {
  perStationMin: 3, perStationMax: 4,
  types: [                                 // weighted generation table
    { type: "faction_strike", w: 0.30 },
    { type: "pirate_clear",   w: 0.20 },
    { type: "salvage",        w: 0.25 },
    { type: "escort",         w: 0.15 },
    { type: "bounty",         w: 0.07 },
    { type: "defense",        w: 0.03 },
  ],
  diffNear: 1500, diffFar: 3500,           // station distance → difficulty band
  rewards: { 1: [200, 500], 2: [500, 1200], 3: [1200, 3000] },
  strikeKills: [3, 5, 7], clearKills: [4, 6, 8],   // killsNeeded by difficulty
  escortSpeed: 55, escortArriveR: 90,      // slower than miners (90); arrive = dockR
  escortHarassR: 300, escortHarassDps: 6,  // hostiles near the freighter chip it
  defenseWavesMin: 2, defenseWavesMax: 3,
  defenseHp: 400, defenseRaidR: 500, defenseRaidDps: 5,   // contract-local station HP
  defenseWaveDist: 700,
  bountySpawnMin: 1200, bountySpawnMax: 2400,
  bountyRanks: { vex: "Vex Commander", krag: "Krag Warchief", nox: "Nox Dread" },
  bountyNames: ["Xal", "Dorn", "Vekk", "Zhin", "Korr", "Maul", "Thax", "Ruun", "Skarn", "Veyla"],
};

Object.assign(GAME, {
  initContracts(s) {
    s = s || this.state;
    s.contracts = []; s.stationContracts = {}; s.escorts = [];
    this._nextContractId = 1; this._nextEscortId = 1;
  },

  // ---- generation (fresh board every dock) ----
  stationDifficulty(station) {
    const d = Math.hypot(station.pos.x, station.pos.y);
    return d < CONTRACTS.diffNear ? 1 : d <= CONTRACTS.diffFar ? 2 : 3;
  },
  rollContractType() {
    let roll = rnd(), spec = CONTRACTS.types[0];
    for (const t of CONTRACTS.types) { roll -= t.w; if (roll < 0) { spec = t; break; } }
    return spec.type;
  },
  _newContract(station, diff) {
    const [lo, hi] = CONTRACTS.rewards[diff];
    return {
      id: this._nextContractId++,
      type: "", title: "", description: "",
      reward: Math.round((lo + rnd() * (hi - lo)) / 5) * 5,
      stationId: station.id, difficulty: diff,
      targetFaction: null, killsNeeded: null, killsDone: null,
      targetStationId: null, escortNpcId: null,
      amountNeeded: null, amountDone: null,
      targetKilled: null, targetId: null,
      raidWave: null, raidDone: null, raidNeeded: null,
      status: "available", expiresAt: null,
    };
  },
  generateStationContracts(station, state) {
    const s = state || this.state, diff = this.stationDifficulty(station);
    const n = CONTRACTS.perStationMin + ((rnd() * (CONTRACTS.perStationMax - CONTRACTS.perStationMin + 1)) | 0);
    const list = [];
    for (let i = 0; i < n; i++) {
      const c = this._newContract(station, diff), t = this.rollContractType();
      c.type = t;
      if (t === "faction_strike") {
        c.targetFaction = CONFIG.factions[(rnd() * CONFIG.factions.length) | 0];
        c.killsNeeded = CONTRACTS.strikeKills[diff - 1]; c.killsDone = 0;
        const F = ForgeFaction.FACTIONS[c.targetFaction];
        c.title = "STRIKE: " + F.name.toUpperCase();
        c.description = `Destroy ${c.killsNeeded} ${F.name} ships. Their raids are choking our supply lanes.`;
      } else if (t === "pirate_clear") {
        c.targetFaction = "nox";                       // Nox are the pirate faction (Phase 2)
        c.killsNeeded = CONTRACTS.clearKills[diff - 1]; c.killsDone = 0;
        c.title = "PIRATE CLEAR";
        c.description = `Clear ${c.killsNeeded} Nox pirates from the space lanes around this station.`;
      } else if (t === "salvage") {
        c.amountNeeded = diff * 2; c.amountDone = 0;
        c.title = "SALVAGE RUN";
        c.description = `Recover ${c.amountNeeded} high-value (Rare or better) salvage items and hold onto them.`;
      } else if (t === "escort") {
        const others = ForgeWorld.getStations().filter(x => x.id !== station.id);
        const tgt = others[(rnd() * others.length) | 0];
        c.targetStationId = tgt.id;
        c.title = "ESCORT: " + tgt.name.toUpperCase();
        c.description = `Guard our freighter until it docks at ${tgt.name}. If it dies en route, no pay.`;
      } else if (t === "bounty") {
        c.targetFaction = CONFIG.factions[(rnd() * CONFIG.factions.length) | 0];
        c.targetName = CONTRACTS.bountyRanks[c.targetFaction] + " " +
          CONTRACTS.bountyNames[(rnd() * CONTRACTS.bountyNames.length) | 0];
        c.targetKilled = false;
        c.title = "BOUNTY: " + c.targetName;
        c.description = diff >= 3 ? `${c.targetName} commands a flagship with a guard fleet. Eliminate the target.`
          : diff === 2 ? `${c.targetName} travels with an armed escort. Eliminate the target.`
          : `${c.targetName} flies alone near this station. Eliminate the target.`;
      } else if (t === "defense") {
        c.raidNeeded = CONTRACTS.defenseWavesMin + ((rnd() * (CONTRACTS.defenseWavesMax - CONTRACTS.defenseWavesMin + 1)) | 0);
        c.raidWave = 0; c.raidDone = 0;
        c.title = "STATION DEFENSE";
        c.description = `A ${c.raidNeeded}-wave raid is inbound. Kill every raider — don't let the station fall.`;
      }
      list.push(c);
    }
    s.stationContracts[station.id] = list;
    return list;
  },

  _contractStation(c) { return ForgeWorld.getStations().find(x => x.id === c.stationId); },

  // ---- accept / turn in / abandon (one active contract at a time) ----
  acceptContract(c) {
    const s = this.state;
    if (!c || c.status !== "available") return false;
    if (s.contracts.length) { toast("Contract slot full"); sfx("warn"); return false; }
    c.status = "active";
    const board = s.stationContracts[c.stationId];
    if (board) { const i = board.indexOf(c); if (i >= 0) board.splice(i, 1); }
    s.contracts.push(c);
    if (c.type === "escort") this._spawnEscort(c);
    else if (c.type === "bounty") this._spawnBountyTarget(c);
    else if (c.type === "defense") { c.raidHp = CONTRACTS.defenseHp; c.raidHpMax = CONTRACTS.defenseHp; this._spawnDefenseWave(c); }
    toast("CONTRACT ACCEPTED", "#57d1c9"); sfx("buy");
    return true;
  },
  turnInContract(c) {
    const s = this.state;
    if (!c || c.status !== "complete") { toast("contract not complete"); sfx("warn"); return false; }
    if (!s.docked || s.dockStationId !== c.stationId) {
      toast("turn in at " + this._contractStation(c).name); sfx("warn"); return false;
    }
    const i = s.contracts.indexOf(c);
    if (i >= 0) s.contracts.splice(i, 1);
    s.credits += c.reward;
    GAME.addXpFromCredits(c.reward, SKILLS.questMult);   // XP: doing quests (bonus multiplier)
    this.gainRep("delivery");
    toast(`+${c.reward}cr — ${c.title}`, "#ffd24a"); sfx("sell");
    this.checkWin();
    return true;
  },
  abandonContract(c) { this._failContract(c, "abandoned"); },
  _failContract(c, why) {
    if (!c || c.status !== "active") return;
    c.status = "failed";
    const s = this.state, i = s.contracts.indexOf(c);
    if (i >= 0) s.contracts.splice(i, 1);
    toast("CONTRACT FAILED: " + c.title + (why ? " — " + why : ""), "#ff5060"); sfx("warn");
  },
  _checkContract(c) {
    if (c.status !== "active") return;
    const done =
      (c.type === "faction_strike" || c.type === "pirate_clear") ? c.killsDone >= c.killsNeeded :
      c.type === "salvage" ? c.amountDone >= c.amountNeeded :
      c.type === "bounty" ? !!c.targetKilled :
      c.type === "defense" ? c.raidDone >= c.raidNeeded :
      c.type === "escort" ? !!c._arrived : false;
    if (done) { c.status = "complete"; toast("CONTRACT COMPLETE: " + c.title, "#7bd88f"); sfx("sell"); }
  },

  // ---- type-specific spawns ----
  _spawnEscort(c) {
    const st = this._contractStation(c), s = this.state;
    const e = { id: "esc_" + this._nextEscortId++, kind: "escort", contractId: c.id, color: "#ffd24a",
      x: st.pos.x + 60, y: st.pos.y + 60, vx: 0, vy: 0, angle: 0, speed: CONTRACTS.escortSpeed,
      targetStationId: c.targetStationId,
      hp: { shield: 60, shieldMax: 60, armor: 40, armorMax: 40, hull: 80, hullMax: 80,
            res: { shield: 0, armor: 0.1, hull: 0 }, _sinceHit: 99 } };
    s.escorts.push(e);
    c.escortNpcId = e.id;
  },
  _spawnBountyTarget(c) {
    const st = this._contractStation(c), s = this.state;
    const a = rnd() * TAU, d = CONTRACTS.bountySpawnMin + rnd() * (CONTRACTS.bountySpawnMax - CONTRACTS.bountySpawnMin);
    const pos = { x: st.pos.x + Math.cos(a) * d, y: st.pos.y + Math.sin(a) * d };
    let lead;
    if (c.difficulty <= 1) {                 // lone elite
      lead = ForgeFaction.generateAlienShip(c.targetFaction, "elite", { rng: rnd, x: pos.x, y: pos.y, isLeader: true });
      s.aliens.push(lead);
    } else {                                 // elite + 2 guards / flagship + 5 guards
      const grp = ForgeFaction.generateGroup(c.targetFaction, pos,
        { rng: rnd, leaderTier: "elite", followerCount: c.difficulty >= 3 ? 4 : 2 });
      lead = grp.leader;
      s.aliens.push(lead); for (const f of grp.followers) s.aliens.push(f);
      if (c.difficulty >= 3) {               // 5th guard (generateGroup caps followers at 4)
        const g5 = ForgeFaction.generateAlienShip(c.targetFaction, "normal",
          { rng: rnd, x: pos.x + 80, y: pos.y - 60, groupId: grp.groupId });
        g5.orbitRadius = 320; s.aliens.push(g5);
      }
    }
    lead.name = c.targetName;                // forge draws leader names above the hull bar
    for (const L of ["shield", "armor", "hull"]) { lead.hp[L] *= 3; lead.hp[L + "Max"] *= 3; }
    if (c.difficulty >= 3) lead._flagship = true;   // 1.4× hull echo + magenta trail (game-side)
    lead._bounty = true;
    c.targetId = lead.id;
  },
  _spawnDefenseWave(c) {
    const st = this._contractStation(c), s = this.state;
    c.raidWave += 1;
    const fac = CONFIG.factions[(rnd() * CONFIG.factions.length) | 0];
    for (let gI = 0; gI < c.difficulty; gI++) {      // difficulty × 3 ships (1 leader + 2 each)
      const a = rnd() * TAU, d = CONTRACTS.defenseWaveDist + rnd() * 200;
      const grp = ForgeFaction.generateGroup(fac,
        { x: st.pos.x + Math.cos(a) * d, y: st.pos.y + Math.sin(a) * d },
        { rng: rnd, followerCount: 2 });
      const squad = [grp.leader, ...grp.followers];
      for (const al of squad) { al._contractId = c.id; s.aliens.push(al); }
      ForgeFaction.activateGroup(grp.leader, squad);
    }
    toast(`RAID WAVE ${c.raidWave}/${c.raidNeeded} INBOUND`, "#ff8a3c"); sfx("warn");
  },

  // ---- event hooks (wired from player.js / economy.js) ----
  onContractKill(al) {
    for (const c of this.state.contracts) {
      if (c.status !== "active") continue;
      if ((c.type === "faction_strike" || c.type === "pirate_clear") && al.faction === c.targetFaction) {
        c.killsDone += 1; this._checkContract(c);
      } else if (c.type === "bounty" && al.id === c.targetId) {
        c.targetKilled = true; toast("TARGET DOWN: " + c.targetName, "#ffd24a"); this._checkContract(c);
      }
      // defense wave kills advance via the live-count scan in updateContracts
    }
  },
  onContractItem(item) {                     // "high-value" = anything above Normal tier
    if (!item || item.tier === "normal") return;
    for (const c of this.state.contracts) {
      if (c.status !== "active" || c.type !== "salvage") continue;
      c.amountDone += 1;
      toast(`salvage ${Math.min(c.amountDone, c.amountNeeded)}/${c.amountNeeded}`, "#ffd24a");
      this._checkContract(c);
    }
  },
  onPlayerDeathContracts() {                 // defender down mid-raid → contract lost
    for (const c of this.state.contracts.slice())
      if (c.type === "defense") this._failContract(c, "defender down");
  },

  // ---- per-frame tick ----
  updateContracts(dt) {
    const s = this.state;
    this._updateEscorts(dt);
    for (const c of s.contracts.slice()) {
      if (c.status !== "active") continue;
      if (c.type === "defense") this._updateDefense(c, dt);
    }
  },
  _updateEscorts(dt) {
    const s = this.state;
    for (let i = s.escorts.length - 1; i >= 0; i--) {
      const e = s.escorts[i];
      const c = s.contracts.find(x => x.id === e.contractId);
      if (!c || c.status !== "active") { s.escorts.splice(i, 1); continue; }
      // shield trickle so a grazed freighter isn't doomed
      e.hp._sinceHit += dt;
      if (e.hp._sinceHit > 3 && e.hp.shield < e.hp.shieldMax)
        e.hp.shield = Math.min(e.hp.shieldMax, e.hp.shield + 4 * dt);
      // crawl toward the destination station
      const st = ForgeWorld.getStations().find(x => x.id === e.targetStationId);
      const dx = st.pos.x - e.x, dy = st.pos.y - e.y, d = Math.hypot(dx, dy) || 1;
      e.vx = dx / d * e.speed; e.vy = dy / d * e.speed;
      e.x += e.vx * dt; e.y += e.vy * dt; e.angle = Math.atan2(dy, dx);
      // hostiles near the freighter chip it (and wake up so the player can fight them)
      for (const al of s.aliens) {
        if (al.state === "DEAD") continue;
        if (this.dist(al.x, al.y, e.x, e.y) > CONTRACTS.escortHarassR) continue;
        const hit = CONTRACTS.escortHarassDps * dt;
        ForgeCombat.applyDamage(e, hit, hit, hit);
        if (al.state === "IDLE") ForgeFaction.activateGroup(al, s.aliens);
      }
      if (e.hp.hull <= 0) {
        burst(e.x, e.y, "#ffd24a", 18); sfx("boom");
        s.escorts.splice(i, 1);
        this._failContract(c, "freighter destroyed");
        continue;
      }
      if (d < CONTRACTS.escortArriveR) {     // docked safely
        s.escorts.splice(i, 1);
        c._arrived = true; this._checkContract(c);
      }
    }
  },
  _updateDefense(c, dt) {
    const s = this.state, st = this._contractStation(c);
    let alive = 0;
    for (const al of s.aliens) {
      if (al._contractId !== c.id || al.state === "DEAD") continue;
      alive++;
      if (this.dist(al.x, al.y, st.pos.x, st.pos.y) < CONTRACTS.defenseRaidR)
        c.raidHp -= CONTRACTS.defenseRaidDps * dt;   // contract-local HP; the station itself is safe
    }
    if (c.raidHp <= 0) { this._failContract(c, st.name + " overrun"); return; }
    if (alive === 0) {
      c.raidDone = c.raidWave;
      if (c.raidDone >= c.raidNeeded) this._checkContract(c);
      else this._spawnDefenseWave(c);
    }
  },

  // ---- HUD: always-visible active contract box (top-right, below weapon badge) ----
  contractProgressText(c) {
    const s = this.state;
    if (c.status === "complete") return "✔ turn in at " + this._contractStation(c).name;
    if (c.type === "faction_strike" || c.type === "pirate_clear") return `${c.killsDone}/${c.killsNeeded} kills`;
    if (c.type === "salvage") return `${c.amountDone}/${c.amountNeeded} items`;
    if (c.type === "defense") return `wave ${c.raidWave}/${c.raidNeeded} · station ${Math.max(0, Math.round(c.raidHp))}hp`;
    if (c.type === "escort") {
      const e = s.escorts.find(x => x.id === c.escortNpcId);
      if (!e) return "freighter en route";
      const st = ForgeWorld.getStations().find(x => x.id === c.targetStationId);
      return `freighter ${Math.round(this.dist(e.x, e.y, st.pos.x, st.pos.y))}u out`;
    }
    if (c.type === "bounty") {
      const t = s.aliens.find(a => a.id === c.targetId);
      return t ? `target ${Math.round(this.shipTo(t))}u away` : "locating target…";
    }
    return "";
  },
  drawContractHUD(g) {
    if (HEADLESS) return;
    const s = this.state, c = s.contracts[0];
    if (!c) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const w = 158 * k, h = 34 * k, x = CONFIG.W - 12 * k - w, y = 192 * k;
    const done = c.status === "complete";
    g.fillStyle = "rgba(13,16,23,0.85)";
    g.strokeStyle = done ? "#ffd24a" : "#57d1c9"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, w, h, 6 * k); g.fill(); g.stroke();
    g.textAlign = "left"; g.textBaseline = "middle";
    g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
    g.fillStyle = "#e8edf4";
    let title = c.title; if (title.length > 25) title = title.slice(0, 24) + "…";
    g.fillText(title, x + 8 * k, y + 10 * k);
    g.font = `${Math.max(8, 9 * k) | 0}px monospace`;
    g.fillStyle = done ? "#ffd24a" : "#9aa7b8";
    g.fillText(this.contractProgressText(c), x + 8 * k, y + 24 * k);
    g.textBaseline = "alphabetic";
  },

  // ---- world overlays: escort freighter + bounty flagship dressing ----
  drawContractWorld(g) {
    if (HEADLESS) return;
    const s = this.state, z = s.cam.zoom, cam = this.drawCamera();
    const viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 250;
    for (const e of s.escorts) {
      if (this.dist(e.x, e.y, s.cam.x, s.cam.y) > viewR) continue;
      ForgeNPC.drawNPCShip(g, e, cam);       // gold "miner-like" diamond + hull bar
      const p = this.SF(e.x, e.y);
      g.font = `bold ${Math.max(7, 8 * z) | 0}px monospace`; g.textAlign = "center";
      g.fillStyle = "#ffd24a"; g.fillText("⛟ ESCORT", p.x, p.y - 14 * z - 6);
      g.textAlign = "left";
    }
    for (const c of s.contracts) {
      if (c.status !== "active" || c.type !== "bounty") continue;
      const t = s.aliens.find(a => a.id === c.targetId);
      if (!t || t.state === "DEAD" || this.dist(t.x, t.y, s.cam.x, s.cam.y) > viewR) continue;
      const p = this.SF(t.x, t.y), ang = t.angle || 0;
      if (t._flagship) {
        // flagship reads extra-large: 1.4× hull echo + a long magenta drive trail
        const sc = 12 * 1.4 * z;
        const bx = p.x - Math.cos(ang) * sc, by = p.y - Math.sin(ang) * sc, tl = 46 * z;
        const grd = g.createLinearGradient(bx, by, bx - Math.cos(ang) * tl, by - Math.sin(ang) * tl);
        grd.addColorStop(0, "rgba(255,95,215,0.75)"); grd.addColorStop(1, "rgba(255,95,215,0)");
        g.strokeStyle = grd; g.lineWidth = Math.max(2, 5 * z); g.lineCap = "round";
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - Math.cos(ang) * tl, by - Math.sin(ang) * tl); g.stroke();
        g.lineCap = "butt";
        g.globalAlpha = 0.55; g.strokeStyle = t.color || "#e8edf4"; g.lineWidth = Math.max(1, 2 * z);
        g.beginPath();
        g.moveTo(p.x + Math.cos(ang) * sc, p.y + Math.sin(ang) * sc);
        g.lineTo(p.x + Math.cos(ang + 2.5) * sc, p.y + Math.sin(ang + 2.5) * sc);
        g.lineTo(p.x + Math.cos(ang - 2.5) * sc, p.y + Math.sin(ang - 2.5) * sc);
        g.closePath(); g.stroke();
        g.globalAlpha = 1;
      }
      this.drawSelectRing(g, p, 22 * z, "#ffd24a", z);   // gold bounty brackets
    }
  },

  // minimap overlay: gold reticle = bounty target, gold dot = escort freighter
  // (same disc geometry trick as encounters / enemy bases — hud.js untouched)
  drawContractMinimap(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s.contracts.length && !s.escorts.length) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / ((s.derived && s.derived.scanRange) || 1000);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    for (const e of s.escorts) {
      const dx = (e.x - s.x) * kMap, dy = (e.y - s.y) * kMap;
      if (dx * dx + dy * dy > (R - 4 * k) * (R - 4 * k)) continue;
      g.fillStyle = "#ffd24a";
      g.beginPath(); g.arc(cx + dx, cy + dy, 2.5 * k, 0, TAU); g.fill();
    }
    for (const c of s.contracts) {
      if (c.status !== "active" || c.type !== "bounty") continue;
      const t = s.aliens.find(a => a.id === c.targetId); if (!t) continue;
      const dx = (t.x - s.x) * kMap, dy = (t.y - s.y) * kMap;
      if (dx * dx + dy * dy > (R - 5 * k) * (R - 5 * k)) continue;
      g.strokeStyle = "#ffd24a"; g.lineWidth = 1.5 * k;
      g.beginPath(); g.arc(cx + dx, cy + dy, 4 * k, 0, TAU); g.stroke();
      g.fillStyle = "#ffd24a";
      g.beginPath(); g.arc(cx + dx, cy + dy, 1.4 * k, 0, TAU); g.fill();
    }
    g.restore();
  },

  // ================= DOM CONTRACTS PANEL (#contractsPanel — build.py <body>) ====
  // Top: active contract card + TURN IN / ABANDON. Bottom: the station board.
  // Same overlay pattern as the gear tab (#gearPanel): shown while docked on
  // the CONTRACTS tab, re-rendered on open and after every button press.
  _ctDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._ct) return this._ct;
    const $ = id => document.getElementById(id);
    const panel = $("contractsPanel");
    if (!panel) return null;
    this._ct = { panel, active: $("ctActive"), list: $("ctList"), cred: $("ctCred"),
      qsHeld: $("qsHeld"), qsList: $("qsList"), _shown: false };   // Phase 5 quest sections (game/quests.js)
    return this._ct;
  },
  // called each draw frame (same pattern as syncDroneDOM): show/hide + first-show render
  syncContractsDOM() {
    const ct = this._ctDOM(); if (!ct) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "contracts");
    ct.panel.classList.toggle("show", show);
    if (!show) { ct._shown = false; return; }
    if (!ct._shown) { ct._shown = true; this.renderContractsPanel(); }
  },
  _ctCard(c, opts) {
    const card = document.createElement("div"); card.className = "ctCard" + (c.status === "complete" ? " done" : "");
    const head = document.createElement("div"); head.className = "ctHeadRow";
    const title = document.createElement("span"); title.className = "ctTitle"; title.textContent = c.title;
    const stars = document.createElement("span"); stars.className = "ctStars"; stars.textContent = "⭐".repeat(c.difficulty);
    head.appendChild(title); head.appendChild(stars);
    const desc = document.createElement("div"); desc.className = "ctDesc"; desc.textContent = c.description;
    const meta = document.createElement("div"); meta.className = "ctMeta";
    meta.textContent = "◇ " + c.reward + "cr" + (opts && opts.active ? " · " + c.status.toUpperCase() : "");
    card.appendChild(head); card.appendChild(desc); card.appendChild(meta);
    return card;
  },
  renderContractsPanel() {
    const ct = this._ctDOM(); if (!ct) return;
    const s = this.state, sid = s.dockStationId;
    ct.cred.textContent = Math.round(s.credits);

    // ---- active contract ----
    ct.active.innerHTML = "";
    const mine = s.contracts[0] || null;
    if (!mine) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "no active contract — accept one below";
      ct.active.appendChild(note);
    } else {
      const here = mine.stationId === sid;
      const card = this._ctCard(mine, { active: true });
      const row = document.createElement("div"); row.className = "ctBtnRow";
      const btn = document.createElement("button"); btn.className = "ghBtn";
      const ready = mine.status === "complete" && here;
      btn.textContent = mine.status === "complete"
        ? (here ? "TURN IN ▸ +" + mine.reward + "cr" : "turn in at " + this._contractStation(mine).name)
        : "IN PROGRESS — " + this.contractProgressText(mine);
      btn.disabled = !ready;
      if (ready) btn.classList.add("go");
      btn.dataset.act = "turnin";
      row.appendChild(btn);
      const ab = document.createElement("button"); ab.className = "ghBtn ctAbandon";
      ab.textContent = "ABANDON"; ab.dataset.act = "abandon";
      row.appendChild(ab);
      card.appendChild(row);
      ct.active.appendChild(card);
    }

    // ---- available board ----
    ct.list.innerHTML = "";
    const avail = (s.stationContracts[sid] || []).filter(c => c.status === "available");
    if (!avail.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "no contracts on the board — redock to refresh";
      ct.list.appendChild(note);
    }
    for (const c of avail) {
      const card = this._ctCard(c);
      const row = document.createElement("div"); row.className = "ctBtnRow";
      const btn = document.createElement("button"); btn.className = "ghBtn";
      if (s.contracts.length) { btn.textContent = "Contract slot full"; btn.disabled = true; }
      else { btn.textContent = "ACCEPT"; btn.classList.add("go"); btn.dataset.act = "accept"; btn.dataset.cid = String(c.id); }
      row.appendChild(btn);
      card.appendChild(row);
      ct.list.appendChild(card);
    }

    this.renderQuestsPanel();   // Phase 5: quest log + quest board (game/quests.js)
  },
  wireContractsDOM() {
    const ct = this._ctDOM(); if (!ct) return;
    ct.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("ctLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    const onClick = (e) => {
      const btn = e.target.closest ? e.target.closest("button[data-act],button[data-qact]") : null;
      if (!btn || btn.disabled) return;
      const s = this.state;
      if (btn.dataset.qact) { this.questDomAct(btn); this.renderContractsPanel(); return; }   // Phase 5 quest buttons
      if (btn.dataset.act === "accept") {
        const c = (s.stationContracts[s.dockStationId] || []).find(x => x.id === +btn.dataset.cid);
        if (c) this.acceptContract(c);
      } else if (btn.dataset.act === "turnin" && s.contracts[0]) this.turnInContract(s.contracts[0]);
      else if (btn.dataset.act === "abandon" && s.contracts[0]) this.abandonContract(s.contracts[0]);
      this.renderContractsPanel();
    };
    ct.active.addEventListener("click", onClick);
    ct.list.addEventListener("click", onClick);
    if (ct.qsHeld) ct.qsHeld.addEventListener("click", onClick);   // Phase 5 quest sections share the handler
    if (ct.qsList) ct.qsList.addEventListener("click", onClick);
  },
});
