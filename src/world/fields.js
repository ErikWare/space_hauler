/*=== HARNESS:FIELDS =========================================================*/
// Streaming mining fields. A field is a lightweight descriptor (center, radius,
// ore kind, stock) that renders as a single map icon while DORMANT. When the
// ship comes within (field.r + fieldActivatePad) the field ACTIVATES: `stock`
// rocks instantiate into s.rocks; when it leaves (+fieldDeactivatePad) they drain
// back to the descriptor. So the live rock array tracks only the handful of
// active fields, never the whole world's capacity — that is what keeps the
// per-frame cost flat as the world grows.
//
// INDEX STABILITY: player tows and junk reference s.rocks/s.junk by index, so
// rocks are NEVER spliced out. A removed rock's slot is overwritten with the
// shared INERT sentinel and pushed onto s.rockFree; activation reuses free slots
// (or appends). Every per-frame rock loop skips `!r.active`. Array length stays
// near the high-water mark of concurrently-live rocks.
Object.assign(GAME, {
  // one shared, never-mutated inert rock; parked far away with size/mass 0 so a
  // missed `!r.active` guard still can't collide, render, or be grabbed.
  INERT: { active: false, x: 1e9, y: 1e9, vx: 0, vy: 0, size: 0, mass: 0, r: 0,
    type: "junk", value: 0, col: "#000", rot: 0, spinV: 0, ringBonus: false,
    planet: null, outer: null, zone: null, fieldId: null, _center: null,
    hp: 0, maxHp: 1, hitFlash: 0, mined: false, towedBy: null },

  _spawnRock(rock) {   // → index; reuse a free slot or append
    const s = this.state;
    if (s.rockFree.length) { const i = s.rockFree.pop(); s.rocks[i] = rock; return i; }
    s.rocks.push(rock); return s.rocks.length - 1;
  },
  _freeRockSlot(i) {   // tombstone a slot (index stays valid for tows)
    const s = this.state;
    if (!s.rocks[i] || !s.rocks[i].active) return;
    s.rocks[i] = this.INERT; s.rockFree.push(i);
  },

  fieldById(id) { const s = this.state; return s.fields && s.fields.find(f => f.id === id); },

  // representative ore tier for a field of `kind` at distance `d` — drives both
  // the dormant icon color and region.resources labeling.
  fieldTier(kind, d) {
    if (kind === "nebula" || kind === "belt") return CONFIG.rings[4];      // platinum-leaning payday
    if (kind === "rich") return CONFIG.rings[Math.min(4, 2 + ((d > 45000) ? 2 : 1))]; // silver/gold/platinum pocket
    return this.zoneOreRing(d);
  },
  makeField(cx, cy, r, kind, cap, regionId) {
    const s = this.state, tier = this.fieldTier(kind, Math.hypot(cx, cy));
    return { id: "fld" + (s.nextFieldId++), x: cx, y: cy, r, kind, cap,
      stock: cap, active: false, discovered: false, col: tier.col, oreType: tier.type,
      regionId: regionId != null ? regionId : null,
      // landmarks are the sparse "fly-to targets" shown at galaxy-overview zoom;
      // ordinary bg/ring fields are ambient and only surface as you zoom in.
      notable: kind !== "bg" && kind !== "ring" };
  },

  // one rock somewhere inside a field's disc, tagged with its field id.
  // u^fieldSpreadPow: denser toward the field core, but drops reach the rim so
  // overlapping neighbor fields knit into one continuous resource fabric.
  makeFieldRock(f) {
    const a = rnd() * TAU, d = Math.pow(rnd(), CONFIG.fieldSpreadPow) * f.r;
    const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, dd = Math.hypot(x, y);
    let ring, bonus = false;
    // belt + nebula are guaranteed gold/platinum paydays (their disc can spill
    // past the strict annulus, so pick the tier directly rather than by distance)
    if (f.kind === "nebula" || f.kind === "belt") { ring = CONFIG.rings[3 + ((rnd() * 2) | 0)]; bonus = true; }
    else if (f.kind === "rich") { ring = this.fieldTier("rich", dd); bonus = true; }   // rare pocket
    else ring = this.zoneOreRing(dd);
    const hp = CONFIG.rockHp(ring.mass);
    const rock = { id: "rk" + (this.state ? this.state.nextRockId++ : 0),
      x, y, vx: 0, vy: 0, type: ring.type, value: ring.value, mass: ring.mass, col: ring.col,
      size: 0.5 + ring.mass * 0.28, rot: rnd() * TAU, spinV: (rnd() - 0.5) * 0.6,
      ringBonus: bonus, planet: null, outer: f.kind === "belt" ? dd : null, zone: null,
      fieldId: f.id, _center: null, hp, maxHp: hp, hitFlash: 0, mined: false, towedBy: null, active: true };
    if (f.kind === "belt") rock.size *= 1.2;
    return rock;
  },

  // ---- junk streaming (same INERT/free-list pattern as rocks; junk is also
  // index-referenced by player tows, so slots are tombstoned, never spliced) --
  INERT_JUNK: { active: false, key: "junk_debris", r: 0, x: 1e9, y: 1e9,
    vx: 0, vy: 0, rot: 0, spinV: 0, zone: null, fieldId: null },
  _spawnJunk(j) {
    const s = this.state;
    if (s.junkFree.length) { const i = s.junkFree.pop(); s.junk[i] = j; return i; }
    s.junk.push(j); return s.junk.length - 1;
  },
  _freeJunkSlot(i) {
    const s = this.state;
    if (!s.junk[i] || !s.junk[i].active) return;
    s.junk[i] = this.INERT_JUNK; s.junkFree.push(i);
  },
  makeFieldJunk(f) {   // one drifting floater inside the field's disc
    const a = rnd() * TAU, d = Math.pow(rnd(), CONFIG.fieldSpreadPow) * f.r;
    const j = this.makeJunkAt(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0, null);
    j.fieldId = f.id;
    return j;
  },

  activateField(f) {
    if (f.active) return;
    const n = Math.floor(f.stock);
    for (let k = 0; k < n; k++) this._spawnRock(this.makeFieldRock(f));
    // regions drop a MIX: ore rocks + salvage junk (junk is infinite flavor —
    // it respawns in-field while active and just despawns with the field)
    const nj = Math.round(n * CONFIG.fieldJunkFrac);
    for (let k = 0; k < nj; k++) this._spawnJunk(this.makeFieldJunk(f));
    f.active = true;
  },
  deactivateField(f) {
    if (!f.active) return;
    const s = this.state; let alive = 0;
    for (let i = 0; i < s.rocks.length; i++) {
      const r = s.rocks[i];
      if (!r.active || r.fieldId !== f.id) continue;
      alive++;                          // still part of the field (present or towed)
      if (r.towedBy) continue;          // keep towed rocks live so the tow survives
      this._freeRockSlot(i);
    }
    for (let i = 0; i < s.junk.length; i++) {
      const j = s.junk[i];
      if (!j.active || j.fieldId !== f.id) continue;
      if (this.isTowed("junk", i)) continue;   // keep towed junk live for the tow
      this._freeJunkSlot(i);
    }
    f.stock = alive; f.active = false;
  },

  // per-frame: activate/deactivate by ship distance (hysteresis), regen dormant.
  tickFields(dt) {
    const s = this.state, sx = s.x, sy = s.y;
    const disc2 = CONFIG.fieldDiscoverR * CONFIG.fieldDiscoverR;
    for (const f of s.fields) {
      const dx = f.x - sx, dy = f.y - sy, d2 = dx * dx + dy * dy;
      const actR = f.r + CONFIG.fieldActivatePad, deR = f.r + CONFIG.fieldDeactivatePad;
      if (!f.active && d2 < actR * actR) this.activateField(f);
      else if (f.active && d2 > deR * deR) this.deactivateField(f);
      if (!f.active && f.stock < f.cap) f.stock = Math.min(f.cap, f.stock + CONFIG.fieldRegenPerSec * dt);
      // reveal a field's map icon once the ship is near it OR its tile is explored
      if (!f.discovered && (d2 < disc2 || this.isTileExplored(f.x, f.y))) f.discovered = true;
    }
  },

  // Dormant-field LOD: a discovered field that isn't yet streamed renders as a
  // soft tier-colored haze + a scatter of marker dots — the "discoverable zone"
  // the player sees while zoomed out, before flying in auto-loads the real rocks.
  drawFields(g, z) {
    if (HEADLESS) return;
    const s = this.state, P = CONFIG.pitch, overview = z < CONFIG.fieldOverviewZoom;
    for (const f of s.fields) {
      if (f.active || !f.discovered) continue;
      if (overview && !f.notable) continue;   // deep zoom-out: only landmark targets
      const sp = this.S(f.x, f.y), haze = Math.max(16, f.r * z);
      if (sp.x < -haze - 60 || sp.x > CONFIG.W + haze + 60 || sp.y < -haze - 60 || sp.y > CONFIG.H + haze + 60) continue;
      if (overview) { this._drawFieldIcon(g, f, sp); continue; }   // clean single target icon
      // near view: soft haze + a scatter of dots that reads as a real ore field
      const grd = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, haze);
      grd.addColorStop(0, hexA(f.col, 0.34)); grd.addColorStop(0.6, hexA(f.col, 0.12)); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(sp.x, sp.y, haze, haze * P, 0, 0, TAU); g.fill();
      let seed = 0; for (let i = 0; i < f.id.length; i++) seed = (seed * 31 + f.id.charCodeAt(i)) | 0;
      const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const dots = Math.min(12, 4 + (f.cap / 22 | 0)), ds = Math.max(1.4, 2.4 * z), spread = Math.max(haze * 0.82, f.r * 0.82 * z);
      g.fillStyle = f.col; g.globalAlpha = 0.85;
      for (let i = 0; i < dots; i++) { const a = rr() * TAU, d = Math.sqrt(rr()) * spread;
        const dx = sp.x + Math.cos(a) * d, dy = sp.y + Math.sin(a) * d * P;
        g.fillRect(dx - ds / 2, dy - ds / 2, ds, ds); }
      g.globalAlpha = 1;
      g.strokeStyle = hexA(f.col, 0.5); g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(sp.x, sp.y, haze, haze * P, 0, 0, TAU); g.stroke();
      if (z <= 0.5) { g.font = "bold 9px monospace"; g.textAlign = "center";
        g.fillStyle = hexA(f.col, 0.95); g.fillText(this._fieldLabel(f), sp.x, sp.y - haze * P - 5); g.textAlign = "left"; }
    }
  },
  _fieldLabel(f) {
    return f.kind === "belt" ? "◆ ASTEROID BELT" : f.kind === "nebula" ? "◆ NEBULA ORE"
      : "◇ " + (CONFIG.oreNames[f.oreType] || "ore field");
  },
  // Compact overview marker: one diamond + halo + label. Sparse, legible targets.
  _drawFieldIcon(g, f, sp) {
    const r = 5, halo = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 16);
    halo.addColorStop(0, hexA(f.col, 0.5)); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(sp.x, sp.y, 16, 0, TAU); g.fill();
    g.fillStyle = f.col;
    g.beginPath(); g.moveTo(sp.x, sp.y - r); g.lineTo(sp.x + r, sp.y); g.lineTo(sp.x, sp.y + r); g.lineTo(sp.x - r, sp.y); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1; g.stroke();
    g.font = "bold 9px monospace"; g.textAlign = "center"; g.fillStyle = hexA(f.col, 0.95);
    g.fillText(this._fieldLabel(f), sp.x, sp.y - 13); g.textAlign = "left";
  },

  // Radius + capacity for a field of a given kind (region-driven generation in
  // world/regions.js supplies the kind + center; this fills in the sizing).
  fieldSpec(kind) {
    const C = CONFIG, irnd = (a, b) => a + ((rnd() * (b - a + 1)) | 0);
    switch (kind) {
      case "belt":   return { r: C.fieldBeltR,   cap: irnd(C.fieldBeltCapMin, C.fieldBeltCapMax) };
      case "ring":   return { r: C.fieldRingR,   cap: irnd(C.fieldRingCapMin, C.fieldRingCapMax) };
      case "moon":   return { r: C.fieldMoonR,   cap: irnd(C.fieldMoonCapMin, C.fieldMoonCapMax) };
      case "base":   return { r: C.fieldBaseR,   cap: irnd(C.fieldBaseCapMin, C.fieldBaseCapMax) };
      case "nebula": return { r: C.fieldNebulaR, cap: irnd(C.fieldNebulaCapMin, C.fieldNebulaCapMax) };
      default:       // "bg" / "rich" — wide discs that overlap neighbor regions
        return { r: C.fieldBgRMin + rnd() * (C.fieldBgRMax - C.fieldBgRMin), cap: irnd(C.fieldBgCapMin, C.fieldBgCapMax) };
    }
  },
  // Place one field of `kind` for a region: centered on the region (belt/ring
  // fields must stay on their anchor) or lightly jittered for variety.
  makeRegionField(region, kind, jitter) {
    const spec = this.fieldSpec(kind);
    let cx = region.cx, cy = region.cy;
    if (jitter) { const a = rnd() * TAU, d = rnd() * CONFIG.regionFieldJitter; cx += Math.cos(a) * d; cy += Math.sin(a) * d; }
    return this.makeField(cx, cy, spec.r, kind, spec.cap, region.id);
  },
});
