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

  // exotic vein tier: distance band → one of the four exotic ores (config.exoticOres)
  exoticRingFor(d) {
    const band = CONFIG.exoticOres.find(b => d <= b.maxDist) || CONFIG.exoticOres[CONFIG.exoticOres.length - 1];
    return CONFIG.rings.find(r => r.type === band.type);
  },
  // representative ore tier for a field of `kind` at distance `d` — drives both
  // the dormant icon color and region.resources labeling.
  fieldTier(kind, d) {
    if (kind === "exotic") return this.exoticRingFor(d);                   // the vein IS its ore
    if (kind === "nebula" || kind === "belt") return CONFIG.rings[4];      // platinum-leaning payday
    if (kind === "rich") return CONFIG.rings[Math.min(4, 2 + ((d > 45000) ? 2 : 1))]; // silver/gold/platinum pocket
    return this.zoneOreRing(d);
  },
  makeField(cx, cy, r, kind, cap, regionId) {
    const s = this.state, tier = this.fieldTier(kind, Math.hypot(cx, cy));
    return { id: "fld" + (s.nextFieldId++), x: cx, y: cy, r, kind, cap,
      // BOTH stocks are finite and one-way. Junk used to be "infinite flavor"
      // that respawned in-field on every activation; it is now a counted resource
      // exactly like ore, so a worked-out field really is worked out.
      stock: cap, junkStock: Math.round(cap * CONFIG.fieldJunkFrac),
      active: false, discovered: false, col: tier.col, oreType: tier.type,
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
    // exotic veins are homogeneous: every rock is the field's stamped ore
    if (f.kind === "exotic") { ring = CONFIG.rings.find(r => r.type === f.oreType) || this.exoticRingFor(dd); bonus = true; }
    // onboarding graded-ore vein: same homogeneous stamp, common industrial ores only
    else if (f.kind === "tutor") { ring = CONFIG.rings.find(r => r.type === f.oreType) || CONFIG.rings[1]; bonus = true; }
    // belt + nebula are guaranteed gold/platinum paydays (their disc can spill
    // past the strict annulus, so pick the tier directly rather than by distance)
    else if (f.kind === "nebula" || f.kind === "belt") { ring = CONFIG.rings[rnd() < 0.7 ? 3 : 4]; bonus = true; }   // gold 70 / platinum 30
    // rich pocket: half its rocks are the payday tier, half the local ambient
    // mix — the pocket still glitters against its zone without flooding the
    // world's rare-ore supply (pure-tier pockets made gold commoner than silver)
    else if (f.kind === "rich") {
      if (rnd() < 0.5) { ring = this.fieldTier("rich", dd); bonus = true; }
      else ring = this.zoneOreRing(dd);
    }
    else ring = this.zoneOreRing(dd);
    // rare exotic surprise salted into ANY ordinary field past the tutorial
    // bubble — a single exotic rock among common ore (config.exoticSprinkleChance).
    // Guarded to the general kinds only; belt/nebula (paydays) and exotic veins
    // (already homogeneous) are left untouched.
    if ((f.kind === "bg" || f.kind === "ring" || f.kind === "moon" || f.kind === "base" || f.kind === "rich")
        && dd >= CONFIG.exoticMinDist && rnd() < CONFIG.exoticSprinkleChance) {
      ring = this.exoticRingFor(dd); bonus = true;
    }
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
    // regions drop a MIX: ore rocks + salvage junk. Spawned from the field's OWN
    // junkStock — deriving it from the rock count each activation is what made
    // junk infinite (haul it all off, fly away, come back to a full field).
    const nj = Math.floor(f.junkStock);
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
      // keep towed rocks live so the tow survives — towedBy marks NPC-miner
      // tows; the PLAYER tow chain references rocks by index via s.tows, so it
      // must be checked too, else the freed slot gets reused by the next field
      // activation and the player's haul silently swaps into a different rock.
      if (r.towedBy || this.isTowed("rocks", i)) continue;
      this._freeRockSlot(i);
    }
    let aliveJunk = 0;
    for (let i = 0; i < s.junk.length; i++) {
      const j = s.junk[i];
      if (!j.active || j.fieldId !== f.id) continue;
      aliveJunk++;
      if (this.isTowed("junk", i)) continue;   // keep towed junk live for the tow
      this._freeJunkSlot(i);
    }
    f.stock = alive; f.junkStock = aliveJunk; f.active = false;
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
      // NO REGEN. Fields used to refill toward cap while dormant, which meant no
      // amount of mining could ever exhaust the world — fly away, come back,
      // full field. Ore and salvage are now strictly one-way: the map depletes,
      // and the answer to a worked-out region is to push into a new one.
      // reveal a field's map icon once the ship is near it OR its tile is explored
      if (!f.discovered && d2 < disc2) f.discovered = true;   // proximity only — a survey gives a contact, not an ID
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
      // ghosted: a worked-out field stays on the chart but owes you nothing
      const fade = this.fieldSpent(f) ? 0.3 : 1;
      g.globalAlpha = fade;
      if (overview) { this._drawFieldIcon(g, f, sp); g.globalAlpha = 1; continue; }   // clean single target icon
      // near view: soft haze + a scatter of dots that reads as a real ore field
      const grd = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, haze);
      grd.addColorStop(0, hexA(f.col, 0.34)); grd.addColorStop(0.6, hexA(f.col, 0.12)); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(sp.x, sp.y, haze, haze * P, 0, 0, TAU); g.fill();
      let seed = 0; for (let i = 0; i < f.id.length; i++) seed = (seed * 31 + f.id.charCodeAt(i)) | 0;
      const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const dots = Math.min(12, 4 + (f.cap / 22 | 0)), ds = Math.max(1.4, 2.4 * z), spread = Math.max(haze * 0.82, f.r * 0.82 * z);
      g.fillStyle = f.col; g.globalAlpha = 0.85 * fade;
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
  // nothing left to take — worth saying plainly, since the icon would otherwise
  // keep advertising a field the player has already stripped
  fieldSpent(f) { return f.stock < 1 && (f.junkStock || 0) < 1; },
  _fieldLabel(f) {
    if (this.fieldSpent(f)) return "× WORKED OUT";
    return f.kind === "belt" ? "◆ ASTEROID BELT" : f.kind === "nebula" ? "◆ NEBULA ORE"
      : f.kind === "exotic" ? "◆ " + (CONFIG.oreNames[f.oreType] || "EXOTIC").toUpperCase() + " VEIN"
      : f.kind === "tutor" ? "◆ " + (CONFIG.oreNames[f.oreType] || "ORE").toUpperCase() + " MARK"
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
      case "exotic": return { r: C.exoticFieldR, cap: irnd(C.exoticCapMin, C.exoticCapMax) };   // tight rare vein
      case "tutor":  return { r: 400, cap: 6 };   // guided onboarding pocket: enough for the 3-rock quota + spare
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

  // ---- onboarding graded-ore veins (copper/silver/gold/platinum rungs) ----
  // While a haul_<ore> tutor quest is active, place a small homogeneous pocket
  // near the issuing station. Distance escalates with grade (copper near home →
  // platinum at the edge of a neighbor sector) so the contact's "further out"
  // copy matches the map. NEVER past home + Chebyshev-neighbor regions.
  // Session-only (fields rebuild on load) — re-called from ensureTutorOreField.
  tutorOreForAction(action) {
    if (!action || action.indexOf("haul_") !== 0) return null;
    const ore = action.slice(5);
    if (ore === "copper" || ore === "silver" || ore === "gold" || ore === "platinum") return ore;
    return null;
  },
  // Hop band + world-distance band from the dock. Hops are Chebyshev steps on
  // the sector grid (0 = home region, 1 = any of the 8 neighbors). Distances
  // stack so copper < silver < gold < platinum while staying ≤ ~1 sector out.
  tutorOrePlacement(oreType) {
    // sectorSize is 4000; neighbor centers sit ~4000 (ortho) / ~5600 (diag) out.
    const S = (CONFIG && CONFIG.sectorSize) || 4000;
    const table = {
      copper:   { minHop: 0, maxHop: 0, minD: S * 0.22, maxD: S * 0.38 }, // ~900–1500, home cell
      silver:   { minHop: 0, maxHop: 1, minD: S * 0.42, maxD: S * 0.62 }, // ~1700–2500
      gold:     { minHop: 1, maxHop: 1, minD: S * 0.62, maxD: S * 0.85 }, // ~2500–3400, neighbor
      platinum: { minHop: 1, maxHop: 1, minD: S * 0.85, maxD: S * 1.12 }, // ~3400–4500, outer neighbor
    };
    return table[oreType] || table.copper;
  },
  // Home sector + the 8 neighbors (Chebyshev ≤ 1). Empty if the grid is missing.
  _tutorNeighborRegions(station) {
    const home = this.regionAt(station.pos.x, station.pos.y);
    if (!home || typeof this.regionByColRow !== "function") return [];
    const out = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const r = this.regionByColRow(home.col + dc, home.row + dr);
      if (!r) continue;
      const hop = Math.max(Math.abs(dc), Math.abs(dr));
      out.push({ reg: r, hop,
        dist: Math.hypot(r.cx - station.pos.x, r.cy - station.pos.y) });
    }
    return out;
  },
  clearTutorOreFields() {
    const s = this.state; if (!s || !s.fields) return;
    for (let i = s.fields.length - 1; i >= 0; i--) {
      const f = s.fields[i];
      if (!f || f.kind !== "tutor") continue;
      if (f.active) this.deactivateField(f);
      s.fields.splice(i, 1);
    }
  },
  spawnTutorOreField(oreType, station) {
    this.clearTutorOreFields();
    if (!station || !station.pos || !oreType) return null;
    const ring = CONFIG.rings.find(r => r.type === oreType);
    if (!ring) return null;
    const s = this.state;
    const place = this.tutorOrePlacement(oreType);
    const neighbors = this._tutorNeighborRegions(station);
    const allowed = neighbors.filter(n => n.hop >= place.minHop && n.hop <= place.maxHop);
    const pool = allowed.length ? allowed : neighbors; // soft fallback: any local cell

    let cx = null, cy = null, regionId = null;
    const half = ((CONFIG && CONFIG.sectorSize) || 4000) * 0.45;
    // Prefer a random point in a hop-matching cell whose distance from the
    // station falls in the ore's distance band (escalating grades fly further).
    for (let attempt = 0; attempt < 48; attempt++) {
      const pick = pool.length ? pool[(rnd() * pool.length) | 0] : null;
      let x, y, reg = null;
      if (pick) {
        reg = pick.reg;
        // Jitter inside the cell; bias slightly away from the station so higher
        // grades land on the far side of a neighbor sector.
        const jx = (rnd() - 0.5) * 2 * half, jy = (rnd() - 0.5) * 2 * half;
        x = reg.cx + jx; y = reg.cy + jy;
        // Nudge outward along the station→cell vector for gold/platinum.
        if (place.minHop >= 1) {
          const dx = reg.cx - station.pos.x, dy = reg.cy - station.pos.y;
          const len = Math.hypot(dx, dy) || 1;
          const push = (place.minD + place.maxD) * 0.5 * 0.15;
          x += (dx / len) * push; y += (dy / len) * push;
        }
      } else {
        const a = rnd() * TAU;
        const d = place.minD + rnd() * (place.maxD - place.minD);
        x = station.pos.x + Math.cos(a) * d;
        y = station.pos.y + Math.sin(a) * d;
        reg = this.regionAt(x, y);
      }
      const d = Math.hypot(x - station.pos.x, y - station.pos.y);
      if (d < place.minD * 0.85 || d > place.maxD * 1.15) continue;
      // Must stay in home or a neighbor — never two hops out.
      if (reg && neighbors.length) {
        const ok = neighbors.some(n => n.reg.id === reg.id);
        if (!ok) continue;
        if (allowed.length && !allowed.some(n => n.reg.id === reg.id)) continue;
      }
      cx = x; cy = y; regionId = reg ? reg.id : null;
      break;
    }
    // Deterministic fallback: best-matching cell center by hop, then by dist band.
    if (cx == null) {
      const list = (allowed.length ? allowed : neighbors).slice()
        .sort((a, b) => {
          const ta = Math.abs(a.dist - (place.minD + place.maxD) * 0.5);
          const tb = Math.abs(b.dist - (place.minD + place.maxD) * 0.5);
          return ta - tb;
        });
      if (list.length) {
        const best = list[0];
        const dx = best.reg.cx - station.pos.x, dy = best.reg.cy - station.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        const target = (place.minD + place.maxD) * 0.5;
        // Place along the ray toward the cell, clamped to the distance band.
        const d = Math.max(place.minD, Math.min(place.maxD, target));
        cx = station.pos.x + (dx / len) * d;
        cy = station.pos.y + (dy / len) * d;
        // Snap region to whatever cell the point landed in (still local).
        const reg = this.regionAt(cx, cy) || best.reg;
        regionId = reg.id;
      } else {
        const a = rnd() * TAU, d = (place.minD + place.maxD) * 0.5;
        cx = station.pos.x + Math.cos(a) * d;
        cy = station.pos.y + Math.sin(a) * d;
        const reg = this.regionAt(cx, cy);
        regionId = reg ? reg.id : null;
      }
    }

    const spec = this.fieldSpec("tutor");
    const f = this.makeField(cx, cy, spec.r, "tutor", spec.cap, regionId);
    f.oreType = oreType;
    f.col = ring.col;
    f.notable = true;
    f.discovered = true;   // charted the moment the job is issued
    f.junkStock = 0;       // pure graded cargo — no slag noise
    s.fields.push(f);
    this.tickFields(0);    // stream rocks if the ship is already nearby (docked)
    return f;
  },
  // Re-attach a guided vein for the held graded tutor rung (grant + load).
  ensureTutorOreField() {
    const s = this.state; if (!s || !s.quests) return null;
    let q = null;
    for (const cand of s.quests) {
      if (cand.kind === "tutor" && this.tutorOreForAction(cand.action)) { q = cand; break; }
    }
    if (!q) { this.clearTutorOreFields(); return null; }
    const ore = this.tutorOreForAction(q.action);
    const existing = s.fields && s.fields.find(f => f.kind === "tutor" && f.oreType === ore);
    if (existing) {
      q.tutorFieldId = existing.id;
      existing.discovered = true;
      return existing;
    }
    const st = (this._questStation && this._questStation(q)) || this.homeStationObj();
    const f = this.spawnTutorOreField(ore, st);
    if (f) q.tutorFieldId = f.id;
    return f;
  },
});
