/*=== HARNESS:ENCOUNTERS =====================================================*/
// Phase 2 — Skyrim-style dynamic encounters. Random events spawn near the
// player while flying (max 5 active, 650–2200 out, never near a station),
// trigger on approach (<450) and despawn if ignored. Forge modules are called
// by API only: ForgeFaction spawns the hostile squads, ForgeItemSystem rolls
// the salvage. Minimap icons overlay ForgeHUD's minimap (same geometry) so the
// forge module stays untouched.
const ENCOUNTERS = {
  maxActive: 5, spawnEvery: 25,            // avg seconds between spawns
  spawnMin: 650, spawnMax: 2200,           // spawn ring around the player
  triggerR: 450, stationClearR: 600,       // approach trigger / station keep-out
  lifeMin: 120, lifeMax: 180,              // seconds before an ignored event despawns
  markerR: 1500,                           // world-space marker visible range
  types: [                                 // weighted spawn table
    { type: "pirate_ambush",   w: 0.40, drift: true,  col: "#ff5060" },
    { type: "faction_battle",  w: 0.25, drift: true,  col: "#b06cff" },
    { type: "derelict",        w: 0.20, drift: false, col: "#ffd24a" },
    { type: "distress_signal", w: 0.15, drift: false, col: "#ff9a3c" },
  ],
};

// Faction patrols — territory-aware wings distinct from the random encounter
// ring above. A 2–3 ship group spawns at a faction outpost near the player and
// slowly orbits it; it engages when the player has recent blood on their hands
// against that faction (any kill in the 5-min ledger → 500u picket, 3+ kills →
// aggressive-on-sight at 1500u — see game/politics.js), or joins any firefight
// that strays into its picket line. A patrol nobody provokes stands down after
// its 3-minute shift.
const PATROLS = {
  maxActive: 2, spawnEvery: 55,        // avg seconds between spawn rolls
  spawnMin: 2500, spawnMax: 7000,      // candidate outposts this far from the ship
  stationClearR: 3000,                 // no patrol theater on station approaches
  orbitMin: 800, orbitMax: 1200,       // orbit radius around the outpost
  orbitOmega: 0.05,                    // rad/s (~50 u/s at 1000u)
  engageR: 500, aggroEngageR: 1500,    // picket trigger / aggressive-on-sight
  life: 180,                           // seconds before an unbothered patrol stands down
  despawnR: 12000,                     // player past this → fold the patrol out
};

Object.assign(GAME, {
  initEncounters(s) { s = s || this.state; s.encounters = []; s.patrols = []; this._nextEncId = 1; },

  // per-frame: age + drift + cull, roll a spawn, trigger on player approach
  updateEncounters(dt, s) {
    s = s || this.state;
    this.updateFactionPatrols(dt, s);
    const enc = s.encounters;
    for (let i = enc.length - 1; i >= 0; i--) {
      const e = enc[i];
      e.life -= dt; e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.resolved || e.life <= 0) enc.splice(i, 1);
    }
    if (s.atStation || s.dead) return;
    if (enc.length < ENCOUNTERS.maxActive && rnd() < dt / ENCOUNTERS.spawnEvery) this.spawnEncounter(s);
    for (const e of enc)
      if (!e.resolved && this.dist(s.x, s.y, e.x, e.y) < ENCOUNTERS.triggerR) this.triggerEncounter(e, s);
  },

  // weighted type roll + a spawn point on the 650–2200 ring that is clear of
  // every station (a few placement attempts; a crowded sky just skips a beat)
  spawnEncounter(s) {
    s = s || this.state;
    if (s.encounters.length >= ENCOUNTERS.maxActive) return null;
    let roll = rnd(), spec = ENCOUNTERS.types[0];
    for (const t of ENCOUNTERS.types) { roll -= t.w; if (roll < 0) { spec = t; break; } }
    const stations = ForgeWorld.getStations();
    let x = 0, y = 0, placed = false;
    for (let tries = 0; tries < 8 && !placed; tries++) {
      const a = rnd() * TAU, d = ENCOUNTERS.spawnMin + rnd() * (ENCOUNTERS.spawnMax - ENCOUNTERS.spawnMin);
      x = s.x + Math.cos(a) * d; y = s.y + Math.sin(a) * d;
      placed = stations.every(st => this.dist(x, y, st.pos.x, st.pos.y) >= ENCOUNTERS.stationClearR);
    }
    if (!placed) return null;
    const da = rnd() * TAU, dv = spec.drift ? 0.3 + rnd() * 0.2 : 0;   // slow drift or stationary
    const e = { id: this._nextEncId++, type: spec.type, x, y,
      life: ENCOUNTERS.lifeMin + rnd() * (ENCOUNTERS.lifeMax - ENCOUNTERS.lifeMin),
      resolved: false, vx: Math.cos(da) * dv, vy: Math.sin(da) * dv, data: {} };
    s.encounters.push(e);
    return e;
  },

  // spawn a squad at (x,y) already ALERT — flying into an encounter drags you
  // in. Squad SIZE and STATS follow the wedge's sec rating: danger 1-3 fields
  // 1-2 ships at half strength, danger 7-9 fields 3-6 ships at up to 3.5× hp.
  // generateGroup clamps followers to 2-4, so over-provision and keep `size`.
  _encGroup(s, faction, x, y) {
    const dl = getDangerLevel(x, y);
    const size = dangerGroupSize(dl, rnd);
    const grp = ForgeFaction.generateGroup(faction, { x, y }, { rng: rnd, followerCount: clamp(size - 1, 2, 4), leaderTier: dl >= 3 ? undefined : "rare" });
    const squad = [grp.leader, ...grp.followers].slice(0, Math.max(1, size));
    for (const a of squad) { applyDangerToShip(a, dl); s.aliens.push(a); }
    ForgeFaction.activateGroup(grp.leader, squad);
    return squad;
  },
  // scatter a rolled salvage item near (x,y) as a loot orb (player.js updateLoot)
  _encLoot(s, x, y, item) {
    if (!item) return;
    s.loot.push({ x: x + (rnd() - 0.5) * 220, y: y + (rnd() - 0.5) * 220,
      vx: (rnd() - 0.5) * 16, vy: (rnd() - 0.5) * 16, item, t: 0 });
  },
  // derelict salvage: junk_crate pool base at a forced Rare/Unique tier
  // (rollDrop always tier-rolls by weight, so base and tier are picked apart)
  _encRareDrop() {
    const r = ForgeItemSystem.rollTier("junk_crate", { rng: rnd });
    return ForgeItemSystem.generateItem(r.baseType, rnd() < 0.65 ? "rare" : "unique", { ilvl: 6, rng: rnd });
  },

  triggerEncounter(e, s) {
    s = s || this.state;
    if (e.resolved) return;
    e.resolved = true;
    if (e.type === "pirate_ambush") {          // Nox are the pirate faction
      this._encGroup(s, "nox", e.x, e.y);
      toast("⚠ PIRATE AMBUSH", "#ff5060"); sfx("warn");
    } else if (e.type === "faction_battle") {  // two squads on top of each other
      this._encGroup(s, "vex", e.x, e.y);
      this._encGroup(s, "krag", e.x + 200, e.y);
      toast("⚔ FACTION BATTLE", "#b06cff"); sfx("warn");
    } else if (e.type === "derelict") {        // 4–7 high-tier salvage, no fight
      const n = 4 + (rnd() * 4 | 0);
      for (let i = 0; i < n; i++) this._encLoot(s, e.x, e.y, this._encRareDrop());
      toast("◈ DERELICT — salvage adrift", "#ffd24a"); sfx("grab");
    } else if (e.type === "distress_signal") { // hostiles + a small loot drop
      this._encGroup(s, "krag", e.x, e.y);
      const dl = getDangerLevel(e.x, e.y);
      const n = 2 + (rnd() * 2 | 0);
      for (let i = 0; i < n; i++) {   // loot tier follows the wedge's danger table
        const roll = ForgeItemSystem.rollTier("junk_crate", { rng: rnd });
        if (roll.baseType)
          this._encLoot(s, e.x, e.y, ForgeItemSystem.generateItem(roll.baseType, rollDangerTier(dl, rnd), { ilvl: 3, rng: rnd }));
      }
      toast("DISTRESS SIGNAL RESOLVED", "#ff9a3c"); sfx("warn");
    }
  },

  // ---- faction patrols --------------------------------------------------------
  updateFactionPatrols(dt, s) {
    s = s || this.state;
    if (!s.patrols) s.patrols = [];
    for (let i = s.patrols.length - 1; i >= 0; i--) {
      const p = s.patrols[i];
      p.ships = p.ships.filter(sh => sh.state !== "DEAD" && sh.hp.hull > 0 && s.aliens.includes(sh));
      if (!p.ships.length) { s.patrols.splice(i, 1); continue; }
      if (!p.engaged && p.ships.some(sh => sh.aggro || sh.hp.hull < sh.hp.hullMax)) p.engaged = true;
      if (this.dist(s.x, s.y, p.cx, p.cy) > PATROLS.despawnR) { this._despawnPatrol(p, s, i); continue; }
      if (p.engaged) continue;   // ForgeFaction AI owns them once the shooting starts
      p.t -= dt;
      if (p.t <= 0) { this._despawnPatrol(p, s, i); continue; }   // shift over, nothing happened
      p.angle += PATROLS.orbitOmega * dt;
      for (let j = 0; j < p.ships.length; j++) {
        const a = p.angle + j * 0.22;
        p.ships[j].x = p.cx + Math.cos(a) * p.r;
        p.ships[j].y = p.cy + Math.sin(a) * p.r;
      }
      // engagement: a bloodied player inside the picket (1500u once the faction
      // is hot, 500u after any recent kill), or an active firefight drifting in
      const heat = s.factionKills ? s.factionKills[p.faction] || 0 : 0;
      const er = this.isFactionAggro(p.faction) ? PATROLS.aggroEngageR : PATROLS.engageR;
      let engage = heat > 0 && p.ships.some(sh => this.dist(s.x, s.y, sh.x, sh.y) < er);
      if (!engage) for (const al of s.aliens) {
        if (al.faction === p.faction || al.state === "DEAD" || !al.aggro) continue;
        if (p.ships.some(sh => this.dist(al.x, al.y, sh.x, sh.y) < PATROLS.engageR)) { engage = true; break; }
      }
      if (engage) { p.engaged = true; ForgeFaction.activateGroup(p.ships[0], s.aliens); }
    }
    // spawn roll — needs a free wing, open space, and a faction outpost nearby
    if (s.dead || s.atStation || s.patrols.length >= PATROLS.maxActive) return;
    if (rnd() >= dt / PATROLS.spawnEvery) return;
    for (const st of ForgeWorld.getStations())
      if (this.dist(s.x, s.y, st.pos.x, st.pos.y) < PATROLS.stationClearR) return;
    const cands = (s.outposts || []).filter(o => {
      if (!CONFIG.factions.includes(o.owner)) return false;
      const d = this.dist(s.x, s.y, o.x, o.y);
      return d > PATROLS.spawnMin && d < PATROLS.spawnMax;
    });
    if (cands.length) this.spawnFactionPatrol(cands[(rnd() * cands.length) | 0], s);
  },
  spawnFactionPatrol(o, s) {
    s = s || this.state;
    const r = PATROLS.orbitMin + rnd() * (PATROLS.orbitMax - PATROLS.orbitMin);
    const angle = rnd() * TAU;
    const dl = o.dangerLevel || getDangerLevel(o.x, o.y);   // stats scale with the wedge
    const grp = ForgeFaction.generateGroup(o.owner, { x: o.x + Math.cos(angle) * r, y: o.y + Math.sin(angle) * r },
      { rng: rnd, followerCount: 1 + (rnd() * 2 | 0), leaderTier: dl >= 3 ? undefined : "rare" });   // 2–3 ships
    const ships = [grp.leader, ...grp.followers];
    for (const sh of ships) { applyDangerToShip(sh, dl); sh._patrol = true; s.aliens.push(sh); }
    const p = { outpostId: o.id, faction: o.owner, cx: o.x, cy: o.y,
      r, angle, t: PATROLS.life, engaged: false, ships };
    s.patrols.push(p);
    return p;
  },
  _despawnPatrol(p, s, idx) {
    for (const sh of p.ships) { const k = s.aliens.indexOf(sh); if (k >= 0) s.aliens.splice(k, 1); }
    s.patrols.splice(idx, 1);
  },

  encounterColor(type) { const t = ENCOUNTERS.types.find(k => k.type === type); return t ? t.col : "#e8edf4"; },

  // faint pulsing world-space ring while unresolved and the player is close
  // enough to notice. Flat projection (SF) so the marker sits exactly where
  // the triggered squad / loot will spawn.
  encounterLabel(type) {
    return { pirate_ambush: "⚠ PIRATES", faction_battle: "⚔ BATTLE",
             derelict: "◈ DERELICT", distress_signal: "◉ DISTRESS" }[type] || "◈ EVENT";
  },
  // World-space event beacon — the "something is HERE" cue. Bright double ring
  // with a glow core and a labeled callout; clamps to a minimum screen size so
  // it stays a real target at any zoom instead of a faint bobbing circle.
  drawEncounterMarkers(g) {
    if (HEADLESS) return;
    const s = this.state, z = s.cam.zoom;
    for (const e of s.encounters) {
      if (e.resolved || this.dist(s.x, s.y, e.x, e.y) > ENCOUNTERS.markerR) continue;
      const pt = this.SF(e.x, e.y), col = this.encounterColor(e.type);
      const pulse = 0.5 + 0.5 * Math.sin(s.t * 2.6 + e.id * 1.7);
      const r = Math.max(16, (46 + pulse * 30) * z);
      const glow = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
      glow.addColorStop(0, hexA(col, 0.35 + pulse * 0.2));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow; g.beginPath(); g.arc(pt.x, pt.y, r, 0, TAU); g.fill();
      g.strokeStyle = col; g.globalAlpha = 0.55 + pulse * 0.4;
      g.lineWidth = Math.max(1.6, 2.5 * z);
      g.beginPath(); g.arc(pt.x, pt.y, r, 0, TAU); g.stroke();
      g.globalAlpha = 0.35 + pulse * 0.25; g.lineWidth = Math.max(1, 1.4 * z);
      g.beginPath(); g.arc(pt.x, pt.y, r * 0.55, 0, TAU); g.stroke();
      g.globalAlpha = 1;
      g.font = "bold 10px monospace"; g.textAlign = "center";
      g.fillStyle = col;
      g.fillText(this.encounterLabel(e.type), pt.x, pt.y - r - 6);
      g.textAlign = "left";
    }
  },

  // minimap overlay: one icon per unresolved in-range encounter, drawn over
  // ForgeHUD's minimap (same geometry: R=44k disc at (W−58k, 118k), k=min-scale,
  // kMap=R/scanRange — mirrors hud.js drawMinimap + rendering.js buildMinimap)
  drawEncounterIcons(g) {
    if (HEADLESS) return;
    const s = this.state, k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / (s.derived.scanRange || 1000);
    for (const e of s.encounters) {
      if (e.resolved) continue;
      const dx = (e.x - s.x) * kMap, dy = (e.y - s.y) * kMap;
      if (Math.hypot(dx, dy) > R - 5 * k) continue;        // outside minimap range
      const x = cx + dx, y = cy + dy, r = 4 * k;
      g.lineWidth = 1.5 * k;
      if (e.type === "pirate_ambush") {                    // red filled circle
        g.fillStyle = "#ff5060";
        g.beginPath(); g.arc(x, y, 3 * k, 0, TAU); g.fill();
      } else if (e.type === "faction_battle") {            // purple ring
        g.strokeStyle = "#b06cff";
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      } else if (e.type === "derelict") {                  // yellow diamond ◇
        g.strokeStyle = "#ffd24a";
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
        g.closePath(); g.stroke();
      } else if (e.type === "distress_signal") {           // orange triangle △
        g.strokeStyle = "#ff9a3c";
        g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.87, y + r * 0.5); g.lineTo(x - r * 0.87, y + r * 0.5);
        g.closePath(); g.stroke();
      }
    }
  },
});
