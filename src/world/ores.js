/*=== HARNESS:ORES ===========================================================*/
// Ore rock sprites (pseudo-sphere shading) + ring-zone spawning + planet-ring
// bonus rocks. Ore is a SEPARATE economy path from Forge salvage items: rocks
// stack by type and sell directly (rarer = worth more, ring ore = +50%).
function defineRock(key, col, glow) {
  SPRITES.define(key, { w: 64, h: 64, brief: `${key} asteroid, pseudo-sphere`,
    bake(g, w, h) {
      const cx = 32, cy = 32, R = 26, n = 12;
      let s = key.length * 7 + 3, rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const pts = [];
      for (let i = 0; i < n; i++) { const a = i / n * TAU, r = R * (0.82 + rr() * 0.18);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) g.lineTo(p[0], p[1]); g.closePath();
      const grd = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.12, cx, cy, R * 1.05);
      grd.addColorStop(0, shade(col, 0.55)); grd.addColorStop(0.45, col); grd.addColorStop(1, shade(col, -0.62));
      g.fillStyle = grd; g.fill();
      g.save(); g.clip();
      if (glow) { g.strokeStyle = glow; g.lineWidth = 2; g.globalAlpha = 0.9;
        for (let i = 0; i < 4; i++) { g.beginPath();
          g.moveTo(cx + (rr() - 0.5) * R, cy + (rr() - 0.5) * R);
          g.lineTo(cx + (rr() - 0.5) * R, cy + (rr() - 0.5) * R); g.stroke(); }
        g.globalAlpha = 1; }
      for (let i = 0; i < 5; i++) {
        const px = cx + (rr() - 0.5) * R * 1.3, py = cy + (rr() - 0.5) * R * 1.3, pr = 1.5 + rr() * 3;
        g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
        g.fillStyle = "rgba(255,255,255,0.14)"; g.beginPath(); g.arc(px - pr * 0.35, py - pr * 0.35, pr * 0.5, 0, TAU); g.fill(); }
      g.restore();
    } });
}
defineRock("rock_junk", "#8a8f98", null);
defineRock("rock_copper", "#c9784a", "#ffb066");
defineRock("rock_silver", "#c8d4e0", "#ffffff");
defineRock("rock_gold", "#c9a23a", "#ffe27a");
defineRock("rock_platinum", "#6fb8b0", "#aefff5");

Object.assign(GAME, {
  spriteKey(r) { return "rock_" + r.type; },
  _stationClear(x, y, gap) {
    return ForgeWorld.getStations().every(st => this.dist(x, y, st.pos.x, st.pos.y) >= gap);
  },
  // legacy tutorial rings around the home station (rocks carry no zone; they
  // respawn back into their home ring by type via _center)
  makeRock(ring, center) {
    center = center || this._oreCenter || { x: 0, y: 0 };
    const a = rnd() * TAU, r = ring.r + (rnd() * 2 - 1) * CONFIG.ringSpread;
    const hp = CONFIG.rockHp(ring.mass);
    return { id: "rk" + (this.state ? this.state.nextRockId++ : 0),
             x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, vx: 0, vy: 0, type: ring.type,
             value: ring.value, mass: ring.mass, col: ring.col, size: 0.5 + ring.mass * 0.28,
             rot: rnd() * TAU, spinV: (rnd() - 0.5) * 0.6, ringBonus: false, planet: null, outer: null, zone: null,
             fieldId: null, _center: center, hp, maxHp: hp, hitFlash: 0, mined: false, towedBy: null, active: true };
  },

  /* ── World Density Pass: zone rocks ──────────────────────────────────────
     Zones: "ring_N"   full-360° ore torus at planet N's orbital radius ±3000
            "moon_N"   tight cluster around flattened moon index N (≤600u)
            "belt"     the 37k–40k asteroid belt — gold/platinum, +50% bonus
            "planet_N" rich ore in planet N's close ring annulus (+50% bonus)
            "nebula_N" rich gold/platinum inside nebula N
            "base_N"   scatter field around enemy base N (≤2000u)
            "background" anywhere on the map, seeded in clusters of 3–8
     A mined rock respawns back into its own zone (rockZonePos below); zones
     whose anchor is gone (selfTest sections clear s.planets) fall back to a
     background scatter instead of crashing. */
  zoneOreRing(d) {   // ore tier by distance from the star
    const R = CONFIG.rings, belt = CONFIG.asteroidBelt;
    if (d >= belt.innerR && d <= belt.outerR) return R[3 + ((rnd() * 2) | 0)];   // gold/platinum
    if (d < 20000) return R[rnd() < 0.6 ? 1 : 0];                                // copper/slag
    if (d < 45000) return R[rnd() < 0.6 ? 2 : 3];                                // silver/gold
    return R[rnd() < 0.7 ? 4 : 3];                                               // platinum/gold
  },
  rockZonePos(zone) {
    const s = this.state, belt = CONFIG.asteroidBelt;
    let a, d, pos;
    if (zone === "belt") {
      a = rnd() * TAU; d = belt.innerR + rnd() * (belt.outerR - belt.innerR);
      return { x: Math.cos(a) * d, y: Math.sin(a) * d };
    }
    if (zone.startsWith("ring_")) {
      const p = s.planets[+zone.slice(5)];
      if (p) {
        for (let t = 0; t < 8; t++) {
          a = rnd() * TAU; d = p.orbit + (rnd() * 2 - 1) * CONFIG.oreRingSpread;
          pos = { x: Math.cos(a) * d, y: Math.sin(a) * d };
          if (this._stationClear(pos.x, pos.y, 500)) break;
        }
        return pos;
      }
    }
    if (zone.startsWith("moon_")) {
      const m = (s._moonList || [])[+zone.slice(5)];
      if (m) { a = rnd() * TAU; d = 60 + rnd() * (CONFIG.moonRockDist - 60);
        return { x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d }; }
    }
    if (zone.startsWith("planet_")) {
      const p = s.planets[+zone.slice(7)];
      if (p) { a = rnd() * TAU; d = p.r * (CONFIG.pRingIn + rnd() * (CONFIG.pRingOut - CONFIG.pRingIn));
        return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }; }
    }
    if (zone.startsWith("nebula_")) {
      const nb = ForgeWorld.getNebulas()[+zone.slice(7)];
      if (nb) { a = rnd() * TAU; d = rnd() * nb.radius * 0.8;
        return { x: nb.pos.x + Math.cos(a) * d, y: nb.pos.y + Math.sin(a) * d }; }
    }
    if (zone.startsWith("base_")) {
      const b = (s.enemyBases || [])[+zone.slice(5)];
      if (b) { a = rnd() * TAU; d = 150 + rnd() * (CONFIG.baseRockDist - 150);
        return { x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d }; }
    }
    // "background" (and any orphaned zone): anywhere in the disc, clear of stations
    for (let t = 0; t < 8; t++) {
      a = rnd() * TAU; d = 5000 + rnd() * (CONFIG.WORLD_RADIUS - 8000);
      pos = { x: Math.cos(a) * d, y: Math.sin(a) * d };
      if (this._stationClear(pos.x, pos.y, 800)) break;
    }
    return pos;
  },
  makeZoneRock(zone, at) {
    const pos = at || this.rockZonePos(zone);
    const d = Math.hypot(pos.x, pos.y);
    let ring, bonus = false;
    if (zone.startsWith("planet_")) { ring = CONFIG.rings[2 + Math.min(2, (rnd() * 3) | 0)]; bonus = true; }
    else if (zone.startsWith("nebula_")) { ring = CONFIG.rings[3 + ((rnd() * 2) | 0)]; bonus = true; }
    else { ring = this.zoneOreRing(d); bonus = zone === "belt"; }
    const hp = CONFIG.rockHp(ring.mass);
    const rock = { id: "rk" + (this.state ? this.state.nextRockId++ : 0),
      x: pos.x, y: pos.y, vx: 0, vy: 0, type: ring.type,
      value: ring.value, mass: ring.mass, col: ring.col, size: 0.5 + ring.mass * 0.28,
      rot: rnd() * TAU, spinV: (rnd() - 0.5) * 0.6, ringBonus: bonus, planet: null, outer: null, zone,
      fieldId: null, _center: null, hp, maxHp: hp, hitFlash: 0, mined: false, towedBy: null, active: true };
    if (zone === "belt") { rock.size *= 1.2; rock.outer = d; }   // belt glow halo
    return rock;
  },
  seedZoneRocks() {   // called from seedWorld AFTER enemy bases exist
    const s = this.state, cfg = CONFIG;
    const irnd = (a, b) => a + ((rnd() * (b - a + 1)) | 0);
    // dense orbital rings: full 360° around each planet's orbital radius
    for (let i = 0; i < s.planets.length; i++) {
      const n = irnd(cfg.oreRingRocksMin, cfg.oreRingRocksMax);
      for (let k = 0; k < n; k++) s.rocks.push(this.makeZoneRock("ring_" + i));
    }
    // moon clusters
    for (let m = 0; m < (s._moonList || []).length; m++) {
      const n = irnd(cfg.moonRocksMin, cfg.moonRocksMax);
      for (let k = 0; k < n; k++) s.rocks.push(this.makeZoneRock("moon_" + m));
    }
    // asteroid belt — the most dangerous, most mineable zone
    const nb = irnd(cfg.beltRocksMin, cfg.beltRocksMax);
    for (let k = 0; k < nb; k++) s.rocks.push(this.makeZoneRock("belt"));
    // background fill in small clusters of 3–8
    const bgN = irnd(cfg.bgRocksMin, cfg.bgRocksMax);
    for (let placed = 0; placed < bgN;) {
      const c = this.rockZonePos("background");
      const n = Math.min(irnd(cfg.bgClusterMin, cfg.bgClusterMax), bgN - placed);
      for (let k = 0; k < n; k++, placed++) {
        const a = rnd() * TAU, d = rnd() * 400;
        s.rocks.push(this.makeZoneRock("background", { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d }));
      }
    }
    // enemy base scatter fields
    for (let b = 0; b < s.enemyBases.length; b++) {
      const n = irnd(cfg.baseRocksMin, cfg.baseRocksMax);
      for (let k = 0; k < n; k++) s.rocks.push(this.makeZoneRock("base_" + b));
    }
  },
  // when a rock is consumed (mined by player/weapon/NPC):
  //   field rock  → DEPLETE: free the slot; the field's stock (captured on
  //                 deactivation + slow regen) accounts for the loss. A rock
  //                 towed away from an already-dormant field decrements its
  //                 stock directly, since deactivation already counted it.
  //   legacy rock → respawn an equivalent back into its home zone/ring.
  respawnRock(i) {
    const s = this.state, r = s.rocks[i];
    if (r.fieldId) {
      const f = this.fieldById(r.fieldId);
      if (f && !f.active) f.stock = Math.max(0, f.stock - 1);
      this._freeRockSlot(i);
      return;
    }
    s.rocks[i] = r.zone ? this.makeZoneRock(r.zone)
               : this.makeRock(CONFIG.rings.find(g => g.type === r.type) || CONFIG.rings[0], r._center);
  },
});
