/*=== HARNESS:SCAN ===========================================================*/
// Region survey — the middle knowledge tier. Flying lifts fog (world/fog.js);
// a 5-second survey tells you WHERE things are in the current sector; only
// closing to CONFIG.fieldDiscoverR tells you WHAT they are.
//
// A survey NEVER sets `discovered`. It emits vague CONTACTS — "something
// massive", "an artificial signal", "hostiles" — so deep space gives you a
// reason to push out without handing you the map. Contacts are DERIVED from
// live entities at draw time, not stored, so one vanishes the instant you
// identify its entity and the save only ever carries the scanned-region set.
//
// Nothing cancels a survey: no damage interrupt, no fuel cost. The brake is
// that a region only ever needs surveying once.
const SCAN = {
  dur: 5,                  // seconds to complete
  pings: 3,                // echo rings emitted over the channel
  ringLife: 2.0,           // seconds a ring takes to reach full radius (> the 1.67s
                           // ping spacing, so the sweep never blinks fully dark)
  ringR: CONFIG.sectorSize * 0.62,
  col: "#57e6ff",
  glyph: { mass: "◌", signal: "⌁", hostile: "△" },
  glyphCol: { mass: "#9fb4c8", signal: "#7fdfff", hostile: "#ff8a8a" },
};

Object.assign(GAME, {
  initScan(s) {
    s = s || this.state;
    if (!(s.scannedRegions instanceof Set)) s.scannedRegions = new Set();
    s.scanCh = null;
    s._scanRings = [];
  },

  regionScanned(region) {
    const s = this.state;
    return !!(region && s.scannedRegions && s.scannedRegions.has(region.id));
  },

  // SURVEY button / K key. Consume-then-act; safe to call any time.
  startRegionScan() {
    const s = this.state;
    if (s.docked || s.dead || s.onPlanet) return false;
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
  updateRegionScan(dt) {
    const s = this.state;
    if (s._scanRings && s._scanRings.length)
      for (let i = s._scanRings.length - 1; i >= 0; i--) {
        s._scanRings[i].t += dt;
        if (s._scanRings[i].t > SCAN.ringLife) s._scanRings.splice(i, 1);
      }
    const ch = s.scanCh; if (!ch) return;
    if (s.docked || s.onPlanet) { s.scanCh = null; return; }   // dock/land drops the sweep
    ch.t = Math.min(ch.dur, ch.t + dt);
    // echo pings spaced across the channel
    const due = Math.min(SCAN.pings, Math.floor(ch.t / (ch.dur / SCAN.pings)) + 1);
    while (ch.pinged < due) {
      ch.pinged++;
      s._scanRings.push({ x: s.x, y: s.y, t: 0 });
      sfx("grab");
    }
    if (ch.t >= ch.dur) { s.scanCh = null; this._finishRegionScan(this.regionGet(ch.regionId)); }
  },

  _finishRegionScan(region) {
    const s = this.state;
    if (!region) return;
    s.scannedRegions.add(region.id);
    region.visited = true;
    const cs = this.regionContacts(region);
    const nSig = cs.filter(c => c.cls === "signal").length;
    const nHos = cs.filter(c => c.cls === "hostile").length;
    const lbl = this.regionLabel(region);
    // counts only — a survey never names what it found
    let tail = cs.length ? cs.length + " contact" + (cs.length > 1 ? "s" : "") : "nothing out here";
    if (nSig) tail += " · " + nSig + " signal" + (nSig > 1 ? "s" : "");
    if (nHos) tail += " · " + nHos + " hostile" + (nHos > 1 ? "s" : "");
    toast("⊙ " + lbl + " surveyed · " + tail, nHos ? "#ff8a8a" : SCAN.col, 3.2);
    sfx("sell");
    if (this.radioSayCd)
      this.radioSayCd("scan_" + region.id, "local", "Local net — sweep returns from " + lbl + ". " + tail + ".",
        nHos ? "#ff8a8a" : "#c8a96e", 20);
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
  drawScanWorld(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s._scanRings || !s._scanRings.length) return;
    const z = s.cam.zoom, P = CONFIG.pitch;
    for (const ring of s._scanRings) {
      const k = ring.t / SCAN.ringLife;
      const rr = SCAN.ringR * k * z, a = (1 - k) * 0.55;
      if (rr <= 1 || a <= 0) continue;
      const p = this.S(ring.x, ring.y);
      g.strokeStyle = SCAN.col; g.globalAlpha = a; g.lineWidth = Math.max(1, 2.5 * (1 - k) * Math.max(0.4, z));
      g.beginPath(); g.ellipse(p.x, p.y, rr, rr * P, 0, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1; g.lineWidth = 1;
  },

  // Progress arc riding the minimap rim while the sweep runs.
  drawScanHUD(g) {
    if (HEADLESS) return;
    const s = this.state, ch = s.scanCh; if (!ch) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const frac = ch.t / ch.dur;
    g.strokeStyle = SCAN.col; g.lineWidth = 3 * k; g.globalAlpha = 0.9;
    g.beginPath(); g.arc(cx, cy, R + 4 * k, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.stroke();
    g.globalAlpha = 1; g.lineWidth = 1;
    g.fillStyle = SCAN.col; g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`; g.textAlign = "center";
    g.fillText("SWEEP " + Math.round(frac * 100) + "%", cx, cy + R + 16 * k);
    g.textAlign = "left";
  },

  scanSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;
      check(s.scannedRegions instanceof Set, "scannedRegions must init as a Set");
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
