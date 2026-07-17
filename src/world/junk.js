/*=== HARNESS:JUNK ===========================================================*/
// Inert drifting debris floaters (4 procedural types). Hauling one to a station
// rolls a Forge salvage drop (ForgeItemSystem.rollDrop, keyed by floater type).
SPRITES.define("junk_can", { w: 48, h: 48, brief: "fuel canister debris",
  bake(g) {
    g.save(); g.translate(24, 24); g.rotate(0.4);
    const grd = g.createLinearGradient(0, -8, 0, 8);
    grd.addColorStop(0, "#9aa2ac"); grd.addColorStop(0.5, "#6d747d"); grd.addColorStop(1, "#454a52");
    g.fillStyle = grd; g.fillRect(-13, -8, 26, 16);
    g.fillStyle = "#565c64"; g.beginPath(); g.ellipse(-13, 0, 4, 8, 0, 0, TAU); g.fill();
    g.fillStyle = "#7d858f"; g.beginPath(); g.ellipse(13, 0, 4, 8, 0, 0, TAU); g.fill();
    g.fillStyle = "#8a4d2a"; g.globalAlpha = 0.7;
    g.beginPath(); g.ellipse(-4, 3, 5, 3, 0.5, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(6, -4, 4, 2.5, -0.3, 0, TAU); g.fill();
    g.globalAlpha = 1; g.restore();
  },
});
SPRITES.define("junk_panel", { w: 64, h: 32, brief: "solar panel fragment",
  bake(g) {
    g.save(); g.translate(32, 16); g.rotate(-0.12);
    g.fillStyle = "#23282f"; g.fillRect(-26, -9, 52, 18);
    g.fillStyle = "#3d6b9e"; g.fillRect(-23, -6, 46, 12);
    g.strokeStyle = "#23282f"; g.lineWidth = 1.4;
    for (let x = -23; x <= 23; x += 7.6) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 6); g.stroke(); }
    g.fillStyle = "rgba(200,230,255,0.5)";
    g.beginPath(); g.moveTo(-20, -6); g.lineTo(-8, -6); g.lineTo(-16, 6); g.lineTo(-23, 6); g.closePath(); g.fill();
    g.restore();
  },
});
SPRITES.define("junk_crate", { w: 48, h: 48, brief: "worn cargo crate",
  bake(g) {
    g.save(); g.translate(24, 24); g.rotate(0.3);
    const grd = g.createLinearGradient(-10, -10, 10, 10);
    grd.addColorStop(0, "#c8a83a"); grd.addColorStop(1, "#8a6f1e");
    g.fillStyle = grd; g.fillRect(-11, -11, 22, 22);
    g.strokeStyle = "#5c4a12"; g.lineWidth = 2; g.strokeRect(-11, -11, 22, 22);
    g.strokeStyle = "rgba(60,48,10,0.6)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-8, 2); g.lineTo(6, -5); g.stroke();
    g.fillStyle = "#3d434c";
    for (const [bx, by] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) { g.beginPath(); g.arc(bx, by, 2, 0, TAU); g.fill(); }
    g.restore();
  },
});
SPRITES.define("junk_debris", { w: 40, h: 40, brief: "small rock fragment",
  bake(g) {
    const cx = 20, cy = 20, pts = [[-9, -6], [2, -10], [10, -3], [7, 7], [-2, 10], [-10, 4]];
    const grd = g.createRadialGradient(cx - 4, cy - 4, 1, cx, cy, 12);
    grd.addColorStop(0, "#7d828a"); grd.addColorStop(1, "#3a3e45");
    g.fillStyle = grd; g.beginPath(); g.moveTo(cx + pts[0][0], cy + pts[0][1]);
    for (const p of pts) g.lineTo(cx + p[0], cy + p[1]); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.15)"; g.lineWidth = 1; g.stroke();
  },
});

Object.assign(GAME, {
  makeJunkAt(cx, cy, spread, zone) {   // one floater scattered within `spread` of a point
    const jt = CONFIG.junkTypes[(rnd() * CONFIG.junkTypes.length) | 0];
    const a = rnd() * TAU, d = rnd() * spread, sa = rnd() * TAU;
    const sp = CONFIG.junkDriftMin + rnd() * (CONFIG.junkDriftMax - CONFIG.junkDriftMin);
    return { key: jt.key, r: jt.r, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
      vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, rot: rnd() * TAU, spinV: (rnd() - 0.5) * 1.2,
      zone: zone || null, fieldId: null, active: true };
  },

  /* ── World Density Pass: junk zones ──────────────────────────────────────
     Zones: "halo_N"    dense debris cloud 1500–4000u around planet N
            "lane_N"    scatter along planet N's full orbital circle ±2000u
            "station_N" drifting debris 500–800u around station N
            "hotspot_N" action-hotspot cluster N (s.junkClusters)
            "fill"      anywhere on the map, clear of stations
     Hauled junk respawns back into its own zone. */
  junkZonePos(zone) {
    const s = this.state, cfg = CONFIG;
    let a, d, pos;
    if (zone.startsWith("halo_")) {
      const p = s.planets[+zone.slice(5)];
      if (p) { a = rnd() * TAU; d = cfg.junkHaloDistMin + rnd() * (cfg.junkHaloDistMax - cfg.junkHaloDistMin);
        return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }; }
    }
    if (zone.startsWith("lane_")) {
      const p = s.planets[+zone.slice(5)];
      if (p) {
        for (let t = 0; t < 8; t++) {
          a = rnd() * TAU; d = p.orbit + (rnd() * 2 - 1) * cfg.junkLaneSpread;
          pos = { x: Math.cos(a) * d, y: Math.sin(a) * d };
          if (this._stationClear(pos.x, pos.y, 400)) break;
        }
        return pos;
      }
    }
    if (zone.startsWith("station_")) {
      const st = ForgeWorld.getStations()[+zone.slice(8)];
      if (st) { a = rnd() * TAU; d = cfg.stationDebrisDistMin + rnd() * (cfg.stationDebrisDistMax - cfg.stationDebrisDistMin);
        return { x: st.pos.x + Math.cos(a) * d, y: st.pos.y + Math.sin(a) * d }; }
    }
    if (zone.startsWith("hotspot_")) {
      const c = (s.junkClusters || [])[+zone.slice(8)];
      if (c) { a = rnd() * TAU; d = rnd() * c.r;
        return { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d }; }
    }
    // "fill" (and any orphaned zone): anywhere in the disc, clear of stations
    for (let t = 0; t < 8; t++) {
      a = rnd() * TAU; d = 3000 + rnd() * (cfg.WORLD_RADIUS - 6000);
      pos = { x: Math.cos(a) * d, y: Math.sin(a) * d };
      if (this._stationClear(pos.x, pos.y, 600)) break;
    }
    return pos;
  },
  makeJunkZone(zone) {
    const p = this.junkZonePos(zone);
    return this.makeJunkAt(p.x, p.y, 0, zone);
  },
  makeJunkClusters() {   // action-hotspot centers, anywhere on the map away from stations
    const centers = [];
    const n = CONFIG.junkClusterMin + ((rnd() * (CONFIG.junkClusterMax - CONFIG.junkClusterMin + 1)) | 0);
    for (let c = 0; c < n; c++) {
      const r = CONFIG.junkClusterRMin + rnd() * (CONFIG.junkClusterRMax - CONFIG.junkClusterRMin);
      for (let tries = 0; tries < 80; tries++) {
        const a = rnd() * TAU, d = 3000 + rnd() * (CONFIG.WORLD_RADIUS - 6000);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (this._stationClear(x, y, CONFIG.junkClusterStationGap + r)) { centers.push({ x, y, r }); break; }
      }
    }
    return centers;
  },
  seedJunkField() {
    const s = this.state, irnd = (a, b) => a + ((rnd() * (b - a + 1)) | 0);
    // planet halos + orbital lane scatter
    for (let i = 0; i < s.planets.length; i++) {
      let n = irnd(CONFIG.junkPlanetHaloMin, CONFIG.junkPlanetHaloMax);
      for (let k = 0; k < n; k++) s.junk.push(this.makeJunkZone("halo_" + i));
      n = irnd(CONFIG.junkLaneMin, CONFIG.junkLaneMax);
      for (let k = 0; k < n; k++) s.junk.push(this.makeJunkZone("lane_" + i));
    }
    // action hotspots
    s.junkClusters = this.makeJunkClusters();
    for (let c = 0; c < s.junkClusters.length; c++) {
      const n = irnd(CONFIG.junkHotspotMin, CONFIG.junkHotspotMax);
      for (let k = 0; k < n; k++) s.junk.push(this.makeJunkZone("hotspot_" + c));
    }
    // general fill
    const n = irnd(CONFIG.junkFillMin, CONFIG.junkFillMax);
    for (let k = 0; k < n; k++) s.junk.push(this.makeJunkZone("fill"));
  },
  seedStationDebris() {   // 20–30 drifting debris pieces around EVERY station
    const s = this.state, sts = ForgeWorld.getStations(); let n = 0;
    for (let i = 0; i < sts.length; i++) {
      const count = CONFIG.stationDebrisMin + ((rnd() * (CONFIG.stationDebrisMax - CONFIG.stationDebrisMin + 1)) | 0);
      for (let k = 0; k < count; k++) { s.junk.push(this.makeJunkZone("station_" + i)); n++; }
    }
    s._stationDebris = n;
  },
  respawnJunk(i) {   // re-scatter a hauled-off debris slot back into its zone
    const j = this.state.junk[i];
    if (j.fieldId) {   // field junk: respawn in-field while active, else free the slot
      const f = this.fieldById(j.fieldId);
      if (f && f.active) { const nj = this.makeFieldJunk(f); this.state.junk[i] = nj; }
      else this._freeJunkSlot(i);
      return;
    }
    const nj = this.makeJunkZone(j.zone || "fill");
    Object.assign(j, nj);
  },
});
