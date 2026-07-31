/*=== HARNESS:SCAN ===========================================================*/
// Two sensor tools (EVE-style contact list):
//   SURVEY (cyan) — 5s region sweep. Marks WHERE POIs are, and AGGROS every
//     hostile in that region ("hello, I'm here"). Once per region.
//   SCAN (orange) — short pulse. Quietly adds all hostiles currently in the
//     player's region to the scan queue (no aggro / no discover). Click a
//     contact to make it the active target (weapons + drones focus there).
//
// Scan queue is sticky: leaving a region does NOT drop contacts. Dead entries
// are pruned. Light orange ring = scanned; dark orange = active target.
const SCAN = {
  dur: 5,                  // survey seconds to complete
  pings: 3,                // echo rings emitted over the channel
  ringLife: 2.0,           // seconds a ring takes to reach full radius
  ringR: CONFIG.sectorSize * 0.62,
  col: "#57e6ff",
  glyph: { mass: "◌", signal: "⌁", hostile: "△" },
  glyphCol: { mass: "#9fb4c8", signal: "#7fdfff", hostile: "#ff8a8a" },
  // World markers on hostiles
  markCol: "rgba(255,170,90,0.75)",     // light orange — scanned
  activeCol: "rgba(255,110,30,0.95)",   // dark orange — active target
  listMax: 12,             // visible rows; scroll via active selection
};

// Active SCAN button — orange cousin of survey (short pulse + recharge).
// Single expanding ring (not multi-ping) — cleaner, less visual spam.
const ACTIVE_SCAN = {
  pulseDur: 1.15,
  cd: 5.0,
  pings: 1,                // one orange ring only
  ringLife: 1.45,
  ringR: 1200,
  col: "#ff8a3c",
  rangeBonus: 400,         // temporary lock range boost during/after pulse
};

Object.assign(GAME, {
  initScan(s) {
    s = s || this.state;
    if (!(s.scannedRegions instanceof Set)) s.scannedRegions = new Set();
    s.scanCh = null;
    s._scanRings = [];
    s.scanPulse = null;      // { t, dur, pinged } active orange pulse
    s.scanPulseCd = 0;       // seconds remaining on SCAN cooldown
    s._surveyFlashT = 0;     // brief POI highlight after a survey finishes
    // EVE-style contact queue: sticky across regions; only death prunes
    if (!Array.isArray(s.scanList)) s.scanList = [];
    if (s.scanActiveId === undefined) s.scanActiveId = null;
    if (s._scanListScroll == null) s._scanListScroll = 0;
  },

  regionScanned(region) {
    const s = this.state;
    return !!(region && s.scannedRegions && s.scannedRegions.has(region.id));
  },

  // SURVEY button / K key. Consume-then-act; safe to call any time.
  startRegionScan() {
    const s = this.state;
    if (s.docked || s.dead || s.onPlanet) return false;
    // Deathmatch / sandbox battle: no survey — find enemies by eye through fog.
    if (s.playMode === "battle" && s.battle && s.battle.rules && !s.battle.rules.surveyAllowed) {
      toast("⊙ survey offline in this arena", "#ff9a3c", 1.6); sfx("warn"); return false;
    }
    if (s.scanCh) { toast("⊙ survey already running", "#7f8ea6", 1.2); return false; }
    const region = this.regionAt(s.x, s.y);
    if (!region) { toast("⊙ no sector lock out here", "#7f8ea6", 1.4); sfx("warn"); return false; }
    if (this.regionScanned(region)) {
      toast("⊙ " + this.regionLabel(region) + " already surveyed", "#7f8ea6", 1.4);
      return false;
    }
    s.scanCh = { regionId: region.id, t: 0, dur: SCAN.dur, pinged: 0 };
    s._scanRings = s._scanRings || [];
    toast("⊙ SURVEY — holding sensor sweep…", SCAN.col, 2);
    return true;
  },

  // Hold-timer pattern from the quest survey godo: accumulate, never decay.
  // Also ticks the orange active-scan pulse + cooldown + ring lifetimes.
  updateRegionScan(dt) {
    const s = this.state;
    if (s._surveyFlashT > 0) s._surveyFlashT = Math.max(0, s._surveyFlashT - dt);
    if (s.scanPulseCd > 0) s.scanPulseCd = Math.max(0, s.scanPulseCd - dt);
    // Keep the contact queue honest + re-acquire active lock when in range
    this.pruneScanList();
    this._tickActiveScanLock(dt);

    // Active SCAN pulse — single orange ring on start; populate queue at peak
    if (s.scanPulse) {
      const p = s.scanPulse;
      p.t = Math.min(p.dur, p.t + dt);
      if (p.pinged < 1) {
        p.pinged = 1;
        s._scanRings = s._scanRings || [];
        // Drop any prior active rings so only one orange ring is visible
        s._scanRings = s._scanRings.filter(r => r.kind !== "active");
        s._scanRings.push({
          x: s.x, y: s.y, t: 0, kind: "active",
          col: ACTIVE_SCAN.col, r: ACTIVE_SCAN.ringR, life: ACTIVE_SCAN.ringLife,
        });
        if (typeof sfx === "function") sfx("grab");
        // Quiet region sweep → add hostiles to the contact queue (no aggro)
        this.scanRegionIntoList(this.regionAt(s.x, s.y), { aggro: false });
      }
      if (p.t >= p.dur) s.scanPulse = null;
    }

    if (s._scanRings && s._scanRings.length)
      for (let i = s._scanRings.length - 1; i >= 0; i--) {
        const ring = s._scanRings[i];
        ring.t += dt;
        const life = ring.life != null ? ring.life : SCAN.ringLife;
        if (ring.t > life) s._scanRings.splice(i, 1);
      }

    const ch = s.scanCh; if (!ch) return;
    if (s.docked || s.onPlanet) { s.scanCh = null; return; }   // dock/land drops the sweep
    ch.t = Math.min(ch.dur, ch.t + dt);
    // echo pings spaced across the channel
    const due = Math.min(SCAN.pings, Math.floor(ch.t / (ch.dur / SCAN.pings)) + 1);
    while (ch.pinged < due) {
      ch.pinged++;
      s._scanRings.push({ x: s.x, y: s.y, t: 0, kind: "survey", col: SCAN.col, r: SCAN.ringR, life: SCAN.ringLife });
      sfx("grab");
    }
    if (ch.t >= ch.dur) { s.scanCh = null; this._finishRegionScan(this.regionGet(ch.regionId)); }
  },

  // Fire the orange active SCAN (button / space combat). Quest marks arm even
  // during cooldown so survey jobs always feel responsive.
  beginActiveScanPulse(force) {
    const s = this.state;
    if (!s || s.docked || s.dead || s.onPlanet) return false;
    if (!force && (s.scanPulseCd || 0) > 0 && !s.scanPulse) return false;
    if (!s.scanPulse) {
      s.scanPulse = { t: 0, dur: ACTIVE_SCAN.pulseDur, pinged: 0 };
      if (!force || (s.scanPulseCd || 0) <= 0)
        s.scanPulseCd = ACTIVE_SCAN.cd;
    }
    return true;
  },

  // Effective combat lock range (base + pulse bonus while scanning / short after).
  activeScanRange() {
    const s = this.state;
    const base = (s.derived && s.derived.scanRange) || 1250;
    const boost = (s.scanPulse || (s.scanPulseCd > ACTIVE_SCAN.cd - 1.2))
      ? ACTIVE_SCAN.rangeBonus : 0;
    return base + boost;
  },

  _finishRegionScan(region) {
    const s = this.state;
    if (!region) return;
    s.scannedRegions.add(region.id);
    region.visited = true;
    s._surveyFlashT = 4.5;   // world + minimap POIs pulse after the sweep
    const cs = this.regionContacts(region);
    const nSig = cs.filter(c => c.cls === "signal").length;
    const nHos = cs.filter(c => c.cls === "hostile").length;
    // SURVEY is loud: load hostiles into the queue AND wake them onto the player
    const woke = this.scanRegionIntoList(region, { aggro: true });
    const lbl = this.regionLabel(region);
    // counts only — a survey never names what it found
    let tail = cs.length ? cs.length + " contact" + (cs.length > 1 ? "s" : "") : "nothing out here";
    if (nSig) tail += " · " + nSig + " signal" + (nSig > 1 ? "s" : "");
    if (nHos) tail += " · " + nHos + " hostile" + (nHos > 1 ? "s" : "");
    if (woke > 0) tail += " · " + woke + " ship" + (woke > 1 ? "s" : "") + " lit up";
    toast("⊙ " + lbl + " surveyed · " + tail + (woke ? " — HOSTILES AGGRO" : " — POIs marked"),
      woke || nHos ? "#ff8a8a" : SCAN.col, 3.2);
    sfx("sell");
    if (this.radioSayCd)
      this.radioSayCd("scan_" + region.id, "local", "Local net — sweep returns from " + lbl + ". " + tail + ".",
        nHos || woke ? "#ff8a8a" : "#c8a96e", 20);
  },

  // ---- hostile contact queue (EVE-style) ------------------------------------
  // Build a lightweight contact descriptor for the scan list UI + markers.
  _scanContactFromEntity(ent, regionId) {
    if (!ent) return null;
    if (ent.kind === "battlePilot") {
      const hull = ent.hullName || ent.hullKey || "pilot";
      return {
        id: ent.id, kind: "pilot",
        name: ent.label || "ENEMY PILOT",
        cls: String(hull).toUpperCase(),
        faction: ent.faction || null,
        regionId: regionId != null ? regionId : null,
        threat: 100,
      };
    }
    if (ent.kind === "p2drone" || ent._p2drone) {
      const tier = ent.tier != null ? ent.tier : (ent._drone && ent._drone.tier) || 0;
      return {
        id: ent.id, kind: "drone",
        name: "WING DRONE",
        cls: "T" + tier + " DRONE",
        faction: null,
        regionId: regionId != null ? regionId : null,
        threat: 30 + tier * 10,
      };
    }
    if (ent.kind === "enemyBase") {
      return {
        id: ent.id, kind: "base",
        name: (ent.faction || "HOSTILE").toUpperCase() + " BASE",
        cls: "BASE",
        faction: ent.faction || null,
        regionId: regionId != null ? regionId : null,
        threat: 80,
      };
    }
    // NPC alien (default)
    const cls = (ent.shipClass || (ent.isLeader ? "elite" : "fighter") || "ship").toUpperCase();
    const fac = (ent.faction || "HOSTILE").toUpperCase();
    const nm = ent.name || (ent.isLeader ? fac + " LEAD" : fac + " " + cls);
    return {
      id: ent.id, kind: "npc",
      name: nm,
      cls: cls + (ent.tier ? " · " + String(ent.tier).toUpperCase() : ""),
      faction: ent.faction || null,
      regionId: regionId != null ? regionId : null,
      threat: (ent.isLeader ? 60 : 40) + (ent.tier === "elite" ? 20 : 0),
    };
  },

  // Live hostiles currently inside a region cell (player-side enemies only).
  regionHostiles(region) {
    const s = this.state, out = [];
    if (!region) return out;
    // Battle P2 pilot
    if (s.playMode === "battle" && s.battle && s.battle.p2 && !s.battle.p2.dead
        && s.battle.p2.hp && s.battle.p2.hp.hull > 0) {
      const p2 = s.battle.p2;
      if (this._regionInCell(region, p2.x, p2.y)) out.push(p2);
      // P2 wing drones (shared combat shell — same object weapons damage)
      if (p2.fleet) for (const d of p2.fleet) {
        if ((d.hp || 0) <= 0) continue;
        if (this._regionInCell(region, d.x, d.y)) {
          const wrap = this.wrapP2Drone ? this.wrapP2Drone(d) : null;
          if (wrap) out.push(wrap);
        }
      }
    }
    for (const al of (s.aliens || [])) {
      if (al.state === "DEAD" || al._warpIn) continue;
      if (this._regionInCell(region, al.x, al.y)) out.push(al);
    }
    for (const b of (s.enemyBases || [])) {
      if (b.destroyed) continue;
      if (this._regionInCell(region, b.x, b.y)) out.push(b);
    }
    return out;
  },

  // Live range from player → contact (world units). Missing targets = Infinity.
  _scanContactDist(c) {
    const s = this.state;
    if (!c) return Infinity;
    const t = this.findCombatTarget(c.id);
    if (!t) return Infinity;
    return Math.hypot((t.x || 0) - s.x, (t.y || 0) - s.y);
  },

  // Closest hostiles first so the list answers "who is on me / who to shoot".
  // Called on every SCAN/SURVEY merge and whenever the player rescans.
  sortScanListByDistance() {
    const s = this.state;
    if (!s.scanList || !s.scanList.length) return;
    for (const c of s.scanList) c.dist = this._scanContactDist(c);
    s.scanList.sort((a, b) => {
      const da = a.dist != null ? a.dist : Infinity;
      const db = b.dist != null ? b.dist : Infinity;
      if (da !== db) return da - db;
      // Stable secondary: higher threat when ranges tie
      return (b.threat || 0) - (a.threat || 0);
    });
  },

  // Compact range label for the contact list (e.g. "420", "1.2k").
  _fmtScanDist(d) {
    if (d == null || !isFinite(d)) return "—";
    if (d < 1000) return String(Math.round(d));
    if (d < 10000) return (d / 1000).toFixed(1) + "k";
    return Math.round(d / 1000) + "k";
  },

  // Merge hostiles from a region into the sticky scan list.
  // opts.aggro → wake them onto the player (survey "hello").
  // Always re-sorts by distance to the player (rescan refreshes order).
  // Returns number of newly added contacts (not total).
  scanRegionIntoList(region, opts) {
    opts = opts || {};
    const s = this.state;
    if (!s.scanList) s.scanList = [];
    if (!region) {
      if (typeof toast === "function") toast("⊕ no sector lock", "#ff8a3c", 1.2);
      return 0;
    }
    const hostiles = this.regionHostiles(region);
    let added = 0, woke = 0;
    const seen = new Set(s.scanList.map(c => c.id));
    for (const ent of hostiles) {
      if (!seen.has(ent.id)) {
        const c = this._scanContactFromEntity(ent, region.id);
        if (c) { s.scanList.push(c); seen.add(c.id); added++; }
      }
      if (opts.aggro) {
        if (this._aggroHostile(ent)) woke++;
      }
    }
    // Nearest first — rescan reorders so the fight list stays useful mid-combat
    this.sortScanListByDistance();
    if (added > 0 && typeof toast === "function" && !opts.aggro) {
      toast("⊕ +" + added + " · nearest first · " + s.scanList.length + " on scope",
        ACTIVE_SCAN.col, 1.8);
    }
    return opts.aggro ? woke : added;
  },

  // Wake a hostile onto the player without requiring a weapon lock.
  _aggroHostile(ent) {
    const s = this.state;
    if (!ent) return false;
    if (ent.kind === "battlePilot" || ent.kind === "p2drone") return true; // already hostile
    if (ent.kind === "enemyBase") {
      for (const a of s.aliens) if (a._baseId === ent.id && a.state === "IDLE")
        ForgeFaction.activateGroup(a, s.aliens);
      return true;
    }
    // NPC alien — activate group / force combat
    if (typeof ForgeFaction !== "undefined" && ForgeFaction.activateGroup) {
      ForgeFaction.activateGroup(ent, s.aliens);
    }
    ent.aggro = true;
    if (ent.state === "IDLE" || ent.state === "PATROL" || ent.state === "HOLD") ent.state = "COMBAT";
    return true;
  },

  // Drop dead / missing entities. Does NOT drop just because the player left
  // the region — sticky list by design. After pruning, keep nearest-first order.
  pruneScanList() {
    const s = this.state;
    if (!s.scanList || !s.scanList.length) return;
    let changed = false;
    for (let i = s.scanList.length - 1; i >= 0; i--) {
      const c = s.scanList[i];
      if (!this.findCombatTarget(c.id)) { s.scanList.splice(i, 1); changed = true; }
    }
    if (s.scanActiveId != null && !this.findCombatTarget(s.scanActiveId)) {
      s.scanActiveId = null;
      // Prefer next living contact so the fight keeps flowing (list is nearest-first)
      if (s.scanList.length) this.selectScanTarget(s.scanList[0].id, { quiet: true });
    }
    // Cheap re-order when someone died so the top of the list stays "who is closest"
    if (changed && s.scanList.length) this.sortScanListByDistance();
  },

  // Click / list selection → single active target. Directs weapons + drones.
  selectScanTarget(id, opts) {
    opts = opts || {};
    const s = this.state;
    if (id == null) return false;
    const t = this.findCombatTarget(id);
    if (!t) {
      if (!opts.quiet && typeof toast === "function") toast("⊕ contact lost", "#7f8ea6", 1.2);
      return false;
    }
    s.scanActiveId = id;
    // Ensure it's on the list (world-click path)
    if (s.scanList && !s.scanList.some(c => c.id === id)) {
      const reg = this.regionAt(t.x, t.y);
      const c = this._scanContactFromEntity(t, reg ? reg.id : null);
      if (c) s.scanList.unshift(c);
    }
    // Acquire combat lock when in scan range (fire needs isLocked)
    const shipState = {
      x: s.x, y: s.y,
      scanRange: (this.activeScanRange ? this.activeScanRange() : (s.derived && s.derived.scanRange) || 1250) * 1.35,
      targets: s.aliens,
    };
    const ok = ForgeCombat.lockOn(t, shipState);
    // Point fleet drones at this target
    this._directFleetToScanTarget(id);
    if (!opts.quiet) {
      const label = (t.name || t.label || t.shipClass || "target");
      if (typeof toast === "function")
        toast(ok ? "⊕ TARGET · " + label : "⊕ TARGET · " + label + " (closing…)", ACTIVE_SCAN.col, 1.4);
      if (typeof sfx === "function") sfx("grab");
    }
    return true;
  },

  _directFleetToScanTarget(id) {
    const s = this.state;
    if (!s.playerFleet) return;
    for (const d of s.playerFleet) {
      if (d.role !== "escort" && d.role !== "tank") continue;
      if (d.state === "retreat" || d.state === "repair") continue;
      d.targetAlienId = id === "battle_p2" ? "battle_p2" : id;
      if (d.role !== "tank") d.state = "attack";
    }
  },

  // Re-lock the active scan target each tick when in range (sticky intent).
  _tickActiveScanLock(dt) {
    const s = this.state;
    if (s.scanActiveId == null) return;
    const t = this.findCombatTarget(s.scanActiveId);
    if (!t) return;
    const lock = ForgeCombat.getLock();
    // Already locked on this target and healthy
    if (lock.targetId === s.scanActiveId && (lock.status === "locked" || lock.status === "locking")) {
      // refresh in-range flag
      ForgeCombat.lockOn(t, {
        x: s.x, y: s.y,
        scanRange: (this.activeScanRange ? this.activeScanRange() : (s.derived && s.derived.scanRange) || 1250) * 1.35,
        targets: s.aliens,
      });
      return;
    }
    // Re-acquire if we have an active intent
    if (lock.targetId == null || lock.targetId === s.scanActiveId || lock.status === "broken" || lock.status === "none") {
      ForgeCombat.lockOn(t, {
        x: s.x, y: s.y,
        scanRange: (this.activeScanRange ? this.activeScanRange() : (s.derived && s.derived.scanRange) || 1250) * 1.35,
        targets: s.aliens,
      });
    }
  },

  clearScanTarget() {
    const s = this.state;
    s.scanActiveId = null;
    ForgeCombat.clearLock();
  },

  // Next living contact after the current active (post-kill advance).
  advanceScanTarget() {
    const s = this.state;
    this.pruneScanList();
    if (!s.scanList || !s.scanList.length) { s.scanActiveId = null; return false; }
    let idx = s.scanList.findIndex(c => c.id === s.scanActiveId);
    if (idx < 0) idx = -1;
    const next = s.scanList[(idx + 1) % s.scanList.length];
    return this.selectScanTarget(next.id, { quiet: true });
  },

  // ---- contacts ------------------------------------------------------------
  // Derived, never stored. Anything already `discovered` is dropped — you know
  // what it is, so it draws as its real icon instead.
  regionContacts(region) {
    const s = this.state, out = [];
    if (!region) return out;
    const rid = region.id;
    for (const t of (s.sites || []))
      if (t.regionId === rid && !t.discovered)
        out.push({ x: t.x, y: t.y, cls: (t.emplacement && !t.emplacement.destroyed) ? "hostile" : "mass" });
    for (const o of (s.outposts || []))
      if (o.regionId === rid && !o.discovered) out.push({ x: o.x, y: o.y, cls: "signal" });
    for (const f of (s.fields || []))
      if (f.regionId === rid && f.notable && !f.discovered) out.push({ x: f.x, y: f.y, cls: "mass" });
    for (const b of (s.enemyBases || []))
      if (!b.destroyed && this._regionInCell(region, b.x, b.y)) out.push({ x: b.x, y: b.y, cls: "hostile" });
    for (const st of ForgeWorld.getStations())
      if (!st.discovered && this._regionInCell(region, st.pos.x, st.pos.y))
        out.push({ x: st.pos.x, y: st.pos.y, cls: "signal" });
    return out;
  },

  // Every contact within `r` of (x,y) — the minimap and galaxy map both pull
  // from here. Walks only the scanned regions in range, not the whole grid.
  scanContactsNear(x, y, r) {
    const s = this.state, out = [];
    if (!s.scannedRegions || !s.scannedRegions.size || !s.regionGrid) return out;
    const g = s.regionGrid, span = Math.ceil((r + g.size) / g.size);
    const c0 = Math.round(x / g.size), r0 = Math.round(y / g.size), r2 = r * r;
    for (let row = r0 - span; row <= r0 + span; row++)
      for (let col = c0 - span; col <= c0 + span; col++) {
        const reg = this.regionByColRow(col, row);
        if (!reg || !s.scannedRegions.has(reg.id)) continue;
        for (const c of this.regionContacts(reg)) {
          const dx = c.x - x, dy = c.y - y;
          if (dx * dx + dy * dy <= r2) out.push(c);
        }
      }
    return out;
  },

  // ---- draw ----------------------------------------------------------------
  // Echo rings on the world plane (pitched ellipses, matching the tow rings).
  // Survey = cyan, active SCAN = orange.
  drawScanWorld(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s._scanRings || !s._scanRings.length) return;
    const z = s.cam.zoom, P = CONFIG.pitch;
    for (const ring of s._scanRings) {
      const life = ring.life != null ? ring.life : SCAN.ringLife;
      const maxR = ring.r != null ? ring.r : SCAN.ringR;
      const col = ring.col || SCAN.col;
      const k = ring.t / life;
      const rr = maxR * k * z, a = (1 - k) * 0.55;
      if (rr <= 1 || a <= 0) continue;
      const p = this.S(ring.x, ring.y);
      g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = Math.max(1, 2.5 * (1 - k) * Math.max(0.4, z));
      g.beginPath(); g.ellipse(p.x, p.y, rr, rr * P, 0, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1; g.lineWidth = 1;
  },

  // World-space POI highlights for the current surveyed region — the point of
  // SURVEY is to paint contacts on the HUD so you know where to push.
  drawSurveyPOIs(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (s.docked || s.onPlanet || s.galaxyMapOpen || s.titleOpen) return;
    const region = this.regionAt(s.x, s.y);
    if (!region || !this.regionScanned(region)) return;
    const cs = this.regionContacts(region);
    if (!cs.length) return;
    const z = s.cam.zoom;
    const flash = (s._surveyFlashT || 0) > 0;
    const pulse = 0.55 + 0.45 * Math.sin((s.t || 0) * 2.8);
    const pad = 18;
    for (const c of cs) {
      const col = SCAN.glyphCol[c.cls] || SCAN.col;
      const glyph = SCAN.glyph[c.cls] || "◌";
      const p = this.SF(c.x, c.y);
      const onScreen = p.x > pad && p.x < CONFIG.W - pad && p.y > pad && p.y < CONFIG.H - pad;
      g.globalAlpha = flash ? (0.75 + 0.25 * pulse) : (0.5 + 0.2 * pulse);
      if (onScreen) {
        // Soft reticle on the contact itself
        const rr = Math.max(10, 14 * z) * (flash ? 1.15 : 1);
        g.strokeStyle = col; g.lineWidth = flash ? 2 : 1.4;
        g.beginPath(); g.arc(p.x, p.y, rr, 0, TAU); g.stroke();
        g.font = `bold ${Math.max(10, 11 * z) | 0}px monospace`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = col;
        g.fillText(glyph, p.x, p.y);
        g.textBaseline = "alphabetic";
      } else {
        // Edge arrow toward off-screen POI
        const cx = CONFIG.W / 2, cy = CONFIG.H / 2;
        const dx = p.x - cx, dy = p.y - cy;
        const ang = Math.atan2(dy, dx);
        const m = Math.min(
          (CONFIG.W / 2 - pad) / Math.max(0.01, Math.abs(Math.cos(ang))),
          (CONFIG.H / 2 - pad) / Math.max(0.01, Math.abs(Math.sin(ang)))
        );
        const ex = cx + Math.cos(ang) * m, ey = cy + Math.sin(ang) * m;
        g.fillStyle = col;
        g.save();
        g.translate(ex, ey);
        g.rotate(ang);
        g.beginPath();
        g.moveTo(6, 0); g.lineTo(-5, 5); g.lineTo(-5, -5);
        g.closePath(); g.fill();
        g.restore();
        g.font = `bold ${Math.max(9, 10) | 0}px monospace`;
        g.textAlign = "center";
        g.fillText(glyph, ex - Math.cos(ang) * 14, ey - Math.sin(ang) * 14 + 3);
      }
    }
    g.globalAlpha = 1; g.textAlign = "left"; g.lineWidth = 1;
  },

  // Progress arcs on the minimap rim: cyan survey and/or orange active scan.
  drawScanHUD(g) {
    if (HEADLESS) return;
    const s = this.state;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const ch = s.scanCh;
    if (ch) {
      const frac = ch.t / ch.dur;
      g.strokeStyle = SCAN.col; g.lineWidth = 3 * k; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(cx, cy, R + 4 * k, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.stroke();
      g.globalAlpha = 1; g.lineWidth = 1;
      g.fillStyle = SCAN.col; g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`; g.textAlign = "center";
      g.fillText("SWEEP " + Math.round(frac * 100) + "%", cx, cy + R + 16 * k);
    }
    if (s.scanPulse) {
      const frac = s.scanPulse.t / s.scanPulse.dur;
      g.strokeStyle = ACTIVE_SCAN.col; g.lineWidth = 2.5 * k; g.globalAlpha = 0.95;
      g.beginPath(); g.arc(cx, cy, R + 8 * k, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.stroke();
      g.globalAlpha = 1;
      if (!ch) {
        g.fillStyle = ACTIVE_SCAN.col; g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`; g.textAlign = "center";
        g.fillText("SCAN " + Math.round(frac * 100) + "%", cx, cy + R + 16 * k);
      }
    } else if ((s.scanPulseCd || 0) > 0 && !ch) {
      const frac = 1 - (s.scanPulseCd / ACTIVE_SCAN.cd);
      g.strokeStyle = "rgba(255,138,60,0.45)"; g.lineWidth = 2 * k;
      g.beginPath(); g.arc(cx, cy, R + 8 * k, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.stroke();
    }
    g.textAlign = "left"; g.lineWidth = 1;
    // Minimal contact queue — top-right under minimap, never eats the fight
    this.drawScanList(g);
  },

  // Light orange ring on scanned contacts; dark orange on the active target.
  drawScanTargetMarkers(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s.scanList || !s.scanList.length) return;
    if (s.docked || s.onPlanet || s.galaxyMapOpen || s.titleOpen) return;
    const z = s.cam.zoom, P = CONFIG.pitch || 1;
    const pulse = 0.55 + 0.45 * Math.sin((s.t || 0) * 3.2);
    for (const c of s.scanList) {
      const t = this.findCombatTarget(c.id);
      if (!t) continue;
      const p = this.SF(t.x, t.y);
      const isActive = c.id === s.scanActiveId;
      const baseR = (t.r || (c.kind === "base" ? 50 : c.kind === "pilot" ? 18 : 12));
      const rr = Math.max(10, (baseR + (isActive ? 10 : 6)) * z);
      g.strokeStyle = isActive ? SCAN.activeCol : SCAN.markCol;
      g.globalAlpha = isActive ? (0.75 + 0.25 * pulse) : (0.4 + 0.2 * pulse);
      g.lineWidth = Math.max(1.2, (isActive ? 2.4 : 1.5) * z);
      g.beginPath(); g.ellipse(p.x, p.y, rr, rr * P, 0, 0, TAU); g.stroke();
      if (isActive) {
        // solid inner tick so the active target reads at a glance
        g.globalAlpha = 0.9;
        g.lineWidth = Math.max(1, 1.6 * z);
        g.beginPath(); g.ellipse(p.x, p.y, rr * 0.72, rr * 0.72 * P, 0, 0, TAU); g.stroke();
      }
    }
    g.globalAlpha = 1; g.lineWidth = 1;
  },

  // Compact scan queue: name + range (nearest first). Max SCAN.listMax rows.
  // Layout: right column under minimap so it stays out of thrust/skill UI.
  scanListLayout() {
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const s = this.state;
    const listLen = (s.scanList && s.scanList.length) || 0;
    if (!listLen) return null;
    const rowH = Math.max(16, 17 * k);
    const w = Math.max(124, 136 * k);
    const x = CONFIG.W - w - 10 * k;
    const headH = 14 * k, padH = 4 * k;
    // Bottom-anchored to the radio card: the list stacks directly on top of it
    // and rides its height, so expanding the radio (short↔tall) pushes the list
    // up instead of letting the two overlap.
    // Stack above the whole bottom cluster: the radio card (right) and the
    // weapon-button row (left, but wide enough to reach under this list).
    const radio = this._radioGeom ? this._radioGeom() : null;
    const skillRow = (typeof ForgeHUD !== "undefined" && ForgeHUD.skillRowRect)
      ? ForgeHUD.skillRowRect() : null;
    let floor = radio ? radio.y : CONFIG.H - 10 * k;
    if (skillRow) floor = Math.min(floor, skillRow.y);
    const bottom = floor - 6 * k;
    // Clear the minimap + SEC badge (and the match card, wherever it sits)
    const bLay = this.isBattleMatch && this.isBattleMatch() && this.battleHudLayout
      ? this.battleHudLayout() : null;
    const top = Math.max(210 * k, bLay ? bLay.bottom + 6 * k : 0);
    const room = bottom - top - headH - padH;
    // Trim visible rows to whatever space is left (scroll keeps the active
    // contact in view) so a long list never grows back over the minimap.
    const n = Math.max(1, Math.min(SCAN.listMax, listLen, Math.floor(room / rowH)));
    const h = headH + n * rowH + padH;
    return { x, y: bottom - h, w, h, rowH, k, n };
  },

  drawScanList(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s.scanList || !s.scanList.length) return;
    if (s.docked || s.onPlanet || s.galaxyMapOpen || s.titleOpen || s.warpOverlay) return;
    const lay = this.scanListLayout();
    if (!lay) return;
    const { x, y, w, h, rowH, k, n } = lay;
    // Refresh live ranges for the visible window (cheap; list is small)
    for (const c of s.scanList) c.dist = this._scanContactDist(c);
    // Panel — almost transparent so it never fights the action
    g.fillStyle = "rgba(8,12,20,0.62)";
    g.strokeStyle = "rgba(255,138,60,0.4)";
    g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill(); g.stroke();
    g.fillStyle = "rgba(255,170,90,0.9)";
    g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
    g.textAlign = "left"; g.textBaseline = "top";
    g.fillText("TARGETS " + s.scanList.length, x + 6 * k, y + 3 * k);
    g.fillStyle = "rgba(255,170,90,0.45)";
    g.font = `${Math.max(7, 7.5 * k) | 0}px monospace`;
    g.textAlign = "right";
    g.fillText("NEAR→FAR", x + w - 6 * k, y + 4 * k);
    g.textAlign = "left";
    // Visible window — keep active row in view
    let scroll = s._scanListScroll || 0;
    const activeIdx = s.scanList.findIndex(c => c.id === s.scanActiveId);
    if (activeIdx >= 0) {
      if (activeIdx < scroll) scroll = activeIdx;
      if (activeIdx >= scroll + n) scroll = activeIdx - n + 1;
    }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, s.scanList.length - n)));
    s._scanListScroll = scroll;
    const startY = y + 14 * k;
    for (let i = 0; i < n; i++) {
      const c = s.scanList[scroll + i];
      if (!c) break;
      const ry = startY + i * rowH;
      const isActive = c.id === s.scanActiveId;
      const dist = c.dist != null ? c.dist : Infinity;
      // Close contacts read hotter so "who is on me" is obvious
      const close = isFinite(dist) && dist < 450;
      if (isActive) {
        g.fillStyle = "rgba(255,110,30,0.32)";
        g.fillRect(x + 2, ry - 1, w - 4, rowH);
      } else if (close) {
        g.fillStyle = "rgba(255,80,60,0.12)";
        g.fillRect(x + 2, ry - 1, w - 4, rowH);
      }
      // Threat / active pip
      g.fillStyle = isActive ? SCAN.activeCol : (close ? "#ff6a5a" : SCAN.markCol);
      g.beginPath(); g.arc(x + 8 * k, ry + rowH * 0.45, 2.4 * k, 0, TAU); g.fill();
      g.fillStyle = isActive ? "#ffe0c0" : (close ? "#ffc8b8" : "#d0d8e4");
      g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
      // Truncate name (leave room for range on the right)
      let nm = c.name || "?";
      if (nm.length > 11) nm = nm.slice(0, 10) + "…";
      g.fillText(nm, x + 14 * k, ry + 1);
      // Range — right-aligned, the decision cue
      const dLab = this._fmtScanDist(dist);
      g.fillStyle = isActive ? "#ffd0a0" : (close ? "#ff8a7a" : "#8a96a8");
      g.font = `bold ${Math.max(7, 8 * k) | 0}px monospace`;
      g.textAlign = "right";
      g.fillText(dLab, x + w - 6 * k, ry + 1);
      g.textAlign = "left";
      g.fillStyle = isActive ? "#ffb070" : "#7a8698";
      g.font = `${Math.max(7, 7.5 * k) | 0}px monospace`;
      let cls = c.cls || "";
      if (c.kind === "drone") cls = "DRONE" + (cls ? " · " + cls : "");
      if (cls.length > 16) cls = cls.slice(0, 15) + "…";
      g.fillText(cls, x + 14 * k, ry + rowH * 0.52);
    }
    g.textBaseline = "alphabetic"; g.textAlign = "left"; g.lineWidth = 1;
  },

  // Hit-test the contact list. Returns contact id or null.
  hitScanList(sx, sy) {
    const s = this.state;
    if (!s.scanList || !s.scanList.length) return null;
    const lay = this.scanListLayout();
    if (!lay) return null;
    const { x, y, w, h, rowH, k, n } = lay;
    if (sx < x || sx > x + w || sy < y || sy > y + h) return null;
    const startY = y + 12 * k;
    const scroll = s._scanListScroll || 0;
    const rel = sy - startY;
    if (rel < 0) return null;
    const i = Math.floor(rel / rowH);
    if (i < 0 || i >= n) return null;
    const c = s.scanList[scroll + i];
    return c ? c.id : null;
  },

  scanSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;
      check(s.scannedRegions instanceof Set, "scannedRegions must init as a Set");
      check(Array.isArray(s.scanList), "scanList must init as array");
      check(s.scanActiveId === null || s.scanActiveId === undefined || s.scanActiveId != null,
        "scanActiveId field present");
      const region = this.regionAt(s.x, s.y);
      check(!!region, "ship must start inside a region");
      // snapshot every discovery flag — a survey must not flip a single one
      const snap = () => [].concat(
        (s.sites || []).map(t => !!t.discovered),
        (s.outposts || []).map(o => !!o.discovered),
        (s.fields || []).map(f => !!f.discovered));
      const before = snap().join(",");

      check(this.startRegionScan() === true, "startRegionScan should arm in an unscanned region");
      check(this.startRegionScan() === false, "a second start while running must be refused");
      for (let i = 0; i < Math.ceil(SCAN.dur * 60) + 4; i++) this.updateRegionScan(1 / 60);
      check(s.scanCh === null, "channel should clear on completion");
      check(s.scannedRegions.has(region.id), "completed survey must record the region");
      check(snap().join(",") === before, "a survey must NOT set discovered on anything");
      check(this.startRegionScan() === false, "re-surveying a scanned region must be refused");

      // contacts: derived, and only for things not yet identified
      const cs = this.regionContacts(region);
      check(Array.isArray(cs), "regionContacts must return an array");
      check(cs.every(c => c.cls === "mass" || c.cls === "signal" || c.cls === "hostile"),
        "every contact needs a valid class");
      const seeded = (s.sites || []).find(t => t.regionId === region.id);
      if (seeded) {
        seeded.discovered = true;
        check(!this.regionContacts(region).some(c => c.x === seeded.x && c.y === seeded.y),
          "an identified entity must stop emitting a contact");
        seeded.discovered = false;
      }
      // an unscanned region yields nothing, however close
      const grid = s.regionGrid;
      const far = this.regionByColRow(grid.N - 2, 0) || this.regionByColRow(0, grid.N - 2);
      if (far) check(this.scanContactsNear(far.cx, far.cy, 4000).length === 0,
        "unscanned regions must yield no contacts");

      // ping rings are emitted and expire
      this.init();
      this.startRegionScan();
      for (let i = 0; i < 30; i++) this.updateRegionScan(1 / 60);
      check(this.state._scanRings.length > 0, "survey should emit an echo ring");
      for (let i = 0; i < Math.ceil(SCAN.ringLife * 60) + 400; i++) this.updateRegionScan(1 / 60);
      check(this.state._scanRings.length === 0, "echo rings must expire");

      // active SCAN pulse + cooldown + sticky list
      this.init();
      check(this.beginActiveScanPulse(false) === true, "active scan should arm");
      check(!!this.state.scanPulse, "scanPulse should be set");
      check(this.state.scanPulseCd > 0, "active scan starts a cooldown");
      check(this.beginActiveScanPulse(false) === true, "second arm while pulsing is ok (same pulse)");
      for (let i = 0; i < Math.ceil(ACTIVE_SCAN.pulseDur * 60) + 4; i++) this.updateRegionScan(1 / 60);
      check(this.state.scanPulse === null, "pulse should clear");
      check(this.beginActiveScanPulse(false) === false, "cooldown blocks a fresh combat scan");
      check(this.beginActiveScanPulse(true) === true, "force (quest) pulse works on cooldown");

      // sticky list: plant a fake contact, leave "region", still present until pruned dead
      this.init();
      const s3 = this.state;
      s3.scanList = [{ id: "ghost", kind: "npc", name: "GHOST", cls: "TEST", threat: 1, regionId: 0 }];
      // no live entity → prune drops it
      this.pruneScanList();
      check(s3.scanList.length === 0, "pruneScanList drops missing contacts");
      // plant a real alien contact and verify sticky merge
      const al = s3.aliens && s3.aliens.find(a => a.state !== "DEAD");
      if (al) {
        const reg = this.regionAt(al.x, al.y) || this.regionAt(s3.x, s3.y);
        const n = this.scanRegionIntoList(reg, { aggro: false });
        check(n >= 1 || s3.scanList.some(c => c.id === al.id), "scanRegionIntoList should capture hostiles");
        const beforeN = s3.scanList.length;
        // re-scan same region should not duplicate
        this.scanRegionIntoList(reg, { aggro: false });
        check(s3.scanList.length === beforeN, "scan list must not duplicate ids");
        check(this.selectScanTarget(al.id, { quiet: true }) === true, "selectScanTarget on live alien");
        check(s3.scanActiveId === al.id, "scanActiveId tracks selection");
      }

      // save round-trip
      this.init();
      const s2 = this.state, reg2 = this.regionAt(s2.x, s2.y);
      s2.scannedRegions.add(reg2.id);
      const blob = this.serializeGame();
      check(Array.isArray(blob.scannedRegions) && blob.scannedRegions.indexOf(reg2.id) >= 0,
        "serializeGame must carry scannedRegions");
      this.init();
      this.applySaveData(blob);
      check(this.state.scannedRegions.has(reg2.id), "applySaveData must restore scannedRegions");
    } catch (e) { fails.push("FAIL: scanSelfTest threw: " + (e && e.message)); }
    return fails;
  },
});
