/*=== HARNESS:GALAXY_MAP =====================================================*/
// Solar system galaxy map overlay. Shows central star, orbital rings, named
// planets colored by type, fog of war, faction territory shading, station
// markers, warp routes, trade drones, NPC traders, fleet, encounters,
// contracts, and the player's position.
const GALAXY_MAP = {
  worldSize: CONFIG.WORLD_RADIUS * 2,
  bg: "rgba(10,13,20,0.92)",
  routeCol: "#2a3a4a",
  scaleRefU: 20000,
  factionColors: { vex: "rgba(255,80,96,0.06)", krag: "rgba(80,180,255,0.06)", nox: "rgba(180,100,255,0.06)" },
  factionStroke: { vex: "rgba(255,80,96,0.15)", krag: "rgba(80,180,255,0.15)", nox: "rgba(180,100,255,0.15)" },
};

Object.assign(GAME, {
  openGalaxyMap() {
    const s = this.state;
    if (s.galaxyMapOpen || s.docked || s.warpOverlay) return;
    s.galaxyMapOpen = true;
    this.mapZoomReset();   // always open on the full-system view
    s.mapSetWaypointMode = false;   // never open already armed
    input.ax = input.ay = 0; s.thrusting = false; s.holdT = 0; s.charge = 0;
    sfx("grab");
  },
  closeGalaxyMap() {
    const s = this.state;
    if (!s.galaxyMapOpen) return;
    s.galaxyMapOpen = false; s.mapSetWaypointMode = false; sfx("drop");
  },
  toggleGalaxyMap() { if (this.state.galaxyMapOpen) this.closeGalaxyMap(); else this.openGalaxyMap(); },

  GALAXY_ZOOM_MAX: 6,
  _mapGeom() {
    const s = this.state, zoom = s.mapZoom || 1;
    const scale = Math.min(CONFIG.W, CONFIG.H) * 0.42 * zoom;   // disc radius, magnified by the live zoom
    return { cx: CONFIG.W / 2, cy: CONFIG.H / 2 + 10, scale, zoom,
             worldR: CONFIG.WORLD_RADIUS, focusX: s.mapFocusX || 0, focusY: s.mapFocusY || 0 };
  },
  // world → screen, panned so `focus` sits at the map centre and scaled by zoom
  mapPoint(wx, wy) {
    const m = this._mapGeom();
    return { x: m.cx + ((wx - m.focusX) / m.worldR) * m.scale,
             y: m.cy + ((wy - m.focusY) / m.worldR) * m.scale };
  },
  // screen → world (inverse of mapPoint) — powers zoom-to-cursor + drag-pan
  mapWorldAt(sx, sy) {
    const m = this._mapGeom();
    return { x: m.focusX + ((sx - m.cx) / m.scale) * m.worldR,
             y: m.focusY + ((sy - m.cy) / m.scale) * m.worldR };
  },
  mapZoomReset() { const s = this.state; s.mapZoom = 1; s.mapFocusX = 0; s.mapFocusY = 0; },
  _mapClampFocus() {
    const s = this.state, lim = CONFIG.WORLD_RADIUS * 1.05;   // keep the disc from wandering fully off-screen
    s.mapFocusX = clamp(s.mapFocusX || 0, -lim, lim);
    s.mapFocusY = clamp(s.mapFocusY || 0, -lim, lim);
  },
  // multiply the zoom by `factor`, keeping the world point under (atX,atY) pinned to the cursor
  mapZoomBy(factor, atX, atY) {
    const s = this.state, z0 = s.mapZoom || 1;
    const z1 = clamp(z0 * factor, 1, this.GALAXY_ZOOM_MAX);
    if (Math.abs(z1 - z0) < 1e-4) return;
    const w = (atX != null) ? this.mapWorldAt(atX, atY) : null;
    s.mapZoom = z1;
    if (w) { const w2 = this.mapWorldAt(atX, atY); s.mapFocusX = (s.mapFocusX || 0) + (w.x - w2.x); s.mapFocusY = (s.mapFocusY || 0) + (w.y - w2.y); }
    if (z1 <= 1.0001) { s.mapFocusX = 0; s.mapFocusY = 0; }   // fully out → snap back to the whole-system view
    this._mapClampFocus();
  },
  // shift the view by a screen-pixel delta (finger/drag pan); a no-op at full-system view
  mapPanBy(dsx, dsy) {
    const s = this.state, m = this._mapGeom();
    if ((s.mapZoom || 1) <= 1.0001) return;
    s.mapFocusX = (s.mapFocusX || 0) - (dsx / m.scale) * m.worldR;
    s.mapFocusY = (s.mapFocusY || 0) - (dsy / m.scale) * m.worldR;
    this._mapClampFocus();
  },
  _mapCloseRect() { return { x: CONFIG.W - 42, y: 10, w: 32, h: 32 }; },
  // controls, stacked bottom-right: [+] [−] [⌂ reset] [⌖ set-waypoint]
  _mapZoomRects() {
    const x = CONFIG.W - 40, w = 30, h = 30;
    return { in: { x, y: CONFIG.H - 178, w, h }, out: { x, y: CONFIG.H - 144, w, h },
             reset: { x, y: CONFIG.H - 110, w, h }, waypoint: { x, y: CONFIG.H - 76, w, h } };
  },
  // where the current contract resolves on the map (station / escort dest / live bounty), or null
  _questLocation(c) {
    if (!c || (c.status !== "active" && c.status !== "complete")) return null;
    const s = this.state;
    if (c.type === "bounty") {
      const tgt = (s.aliens || []).find(a => a.id === c.targetId && a.state !== "DEAD");
      if (tgt) return { x: tgt.x, y: tgt.y };
    }
    const sid = c.type === "escort" && c.targetStationId != null ? c.targetStationId : c.stationId;
    const st = ForgeWorld.getStations().find(x => x.id === sid);
    return st ? { x: st.pos.x, y: st.pos.y } : null;
  },
  // place the nav waypoint at a screen tap, snapping to a nearby quest/station/planet
  _setNavWaypointAt(sx, sy) {
    const s = this.state;
    let best = this.mapWorldAt(sx, sy), bestD = 18;   // px snap radius
    const consider = (wx, wy) => { const p = this.mapPoint(wx, wy); const d = Math.hypot(sx - p.x, sy - p.y); if (d < bestD) { bestD = d; best = { x: wx, y: wy }; } };
    const q = this._questLocation((s.contracts || [])[0]); if (q) consider(q.x, q.y);
    for (const st of ForgeWorld.getStations()) if (st.discovered) consider(st.pos.x, st.pos.y);
    for (const sid of (s.markedStations || [])) { const st = ForgeWorld.getStations().find(t => t.id === sid); if (st) consider(st.pos.x, st.pos.y); }
    for (const pl of (s.planets || [])) if (this.isTileExplored(pl.x, pl.y)) consider(pl.x, pl.y);
    s.navWaypoint = { x: best.x, y: best.y };
    s.mapSetWaypointMode = false;
    this.saveGame(); sfx("grab"); toast("◎ waypoint set — follow the arrow", "#7fdfff");
  },
  galaxyMapClick(x, y) {
    const s = this.state, hit = (r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
    if (hit(this._mapCloseRect())) { this.closeGalaxyMap(); return true; }
    const z = this._mapZoomRects(), cx = CONFIG.W / 2, cy = CONFIG.H / 2 + 10;
    if (hit(z.in)) { this.mapZoomBy(1.5, cx, cy); sfx("grab"); return true; }
    if (hit(z.out)) { this.mapZoomBy(1 / 1.5, cx, cy); sfx("drop"); return true; }
    if (hit(z.reset)) { this.mapZoomReset(); sfx("drop"); return true; }
    if (hit(z.waypoint)) {
      if (s.mapSetWaypointMode) {
        // armed, then the button tapped again (no map tap) → remove the waypoint / disarm
        s.mapSetWaypointMode = false; sfx("drop");
        if (s.navWaypoint) { s.navWaypoint = null; this.saveGame(); toast("◎ waypoint removed", "#7fdfff"); }
        else toast("waypoint mode off", "#7fdfff");
      } else {
        s.mapSetWaypointMode = true; sfx("grab");
        toast(s.navWaypoint ? "⌖ tap map to move · ⌖ again to remove" : "⌖ tap the map to set a waypoint", "#7fdfff");
      }
      return true;
    }
    if (s.mapSetWaypointMode) { this._setNavWaypointAt(x, y); return true; }   // armed → drop it here
    return true;
  },

  drawGalaxyMap(g) {
    if (HEADLESS) return;
    const s = this.state, stations = ForgeWorld.getStations();
    const m = this._mapGeom();
    const o = this.mapPoint(0, 0);   // screen position of the world origin — the sun + all orbits pan/zoom around it
    g.fillStyle = GALAXY_MAP.bg; g.fillRect(0, 0, CONFIG.W, CONFIG.H);

    // header + close
    g.fillStyle = "#8fd0ff"; g.font = "bold 13px monospace"; g.textAlign = "center";
    g.fillText("── SOLAR SYSTEM ──", CONFIG.W / 2, 28);
    const cr = this._mapCloseRect();
    g.fillStyle = "rgba(20,29,43,0.9)"; g.strokeStyle = "#333f50"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(cr.x, cr.y, cr.w, cr.h, 8); g.fill(); g.stroke();
    g.fillStyle = "#e8edf4"; g.font = "bold 14px monospace";
    g.fillText("✕", cr.x + cr.w / 2, cr.y + cr.h / 2 + 5);

    // pie-wedge faction overlay (120° wedges from the sun outward)
    const wedges = [
      { faction: "vex",  color: "#cc2244", start: 0,               end: Math.PI * 2 / 3 },
      { faction: "krag", color: "#cc7722", start: Math.PI * 2 / 3, end: Math.PI * 4 / 3 },
      { faction: "nox",  color: "#8822cc", start: Math.PI * 4 / 3, end: Math.PI * 2 },
    ];
    const maxMapR = (CONFIG.WORLD_RADIUS / m.worldR) * m.scale;
    wedges.forEach(w => {
      g.beginPath();
      g.moveTo(o.x, o.y);
      g.arc(o.x, o.y, maxMapR, w.start, w.end);
      g.closePath();
      g.fillStyle = w.color + "33";
      g.fill();
    });

    // political regions: live controller colors over the static wedges
    this.drawMapPoliticalRegions(g, m);

    // region layer: faint sector grid + player-claimed regions burning bright —
    // the territory game read at a glance (regions ARE the game map)
    const grid = s.regionGrid;
    if (grid) {
      const cell = (grid.size / m.worldR) * m.scale, half = cell / 2;
      for (const region of s.regions) {
        const p = this.mapPoint(region.cx, region.cy);
        if (region.owner === "player") {
          g.fillStyle = "rgba(87,209,201,0.4)";
          g.fillRect(p.x - half, p.y - half, cell, cell);
          g.strokeStyle = "#57d1c9"; g.lineWidth = 0.8;
          g.strokeRect(p.x - half, p.y - half, cell, cell);
        } else if (region.visited) {
          g.strokeStyle = "rgba(120,140,170,0.10)"; g.lineWidth = 0.5;
          g.strokeRect(p.x - half, p.y - half, cell, cell);
        }
      }
    }

    // orbital rings
    g.strokeStyle = "rgba(80,100,130,0.15)"; g.lineWidth = 0.5;
    for (const pdef of CONFIG.solarPlanets) {
      const rr = (pdef.orbit / m.worldR) * m.scale;
      g.beginPath(); g.arc(o.x, o.y, rr, 0, TAU); g.stroke();
    }

    // asteroid belt
    const beltInR = (CONFIG.asteroidBelt.innerR / m.worldR) * m.scale;
    const beltOutR = (CONFIG.asteroidBelt.outerR / m.worldR) * m.scale;
    g.fillStyle = "rgba(120,110,90,0.08)";
    g.beginPath(); g.arc(o.x, o.y, beltOutR, 0, TAU);
    g.arc(o.x, o.y, beltInR, 0, TAU, true); g.fill();

    // central star
    const starR = Math.max(4, (CONFIG.STAR_RADIUS / m.worldR) * m.scale);
    const starGrd = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, starR * 2.5);
    starGrd.addColorStop(0, "rgba(255,230,160,0.8)");
    starGrd.addColorStop(0.4, "rgba(255,180,60,0.3)");
    starGrd.addColorStop(1, "rgba(255,140,40,0)");
    g.fillStyle = starGrd; g.beginPath(); g.arc(o.x, o.y, starR * 2.5, 0, TAU); g.fill();
    g.fillStyle = "#ffd860"; g.beginPath(); g.arc(o.x, o.y, starR, 0, TAU); g.fill();

    // warp-route lines
    g.strokeStyle = GALAXY_MAP.routeCol; g.lineWidth = 1;
    if (g.setLineDash) g.setLineDash([6, 4]);
    for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
      const A = stations[i], B = stations[j];
      if (!A.warpActive || !B.warpActive || !A.discovered || !B.discovered) continue;
      const pa = this.mapPoint(A.pos.x, A.pos.y), pb = this.mapPoint(B.pos.x, B.pos.y);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
    }
    if (g.setLineDash) g.setLineDash([]);

    // fog of war overlay on map
    const fogTile = CONFIG.FOG_TILE;
    const fogR = Math.ceil(CONFIG.WORLD_RADIUS / fogTile);
    g.fillStyle = "rgba(5,7,13,0.5)";
    for (let tx = -fogR; tx <= fogR; tx++) {
      for (let ty = -fogR; ty <= fogR; ty++) {
        if (s.exploredTiles.has(tx + "," + ty)) continue;
        const wx = tx * fogTile, wy = ty * fogTile;
        const d = Math.sqrt(wx * wx + wy * wy);
        if (d > CONFIG.WORLD_RADIUS * 1.2) continue;
        const p1 = this.mapPoint(wx, wy);
        const p2 = this.mapPoint(wx + fogTile, wy + fogTile);
        g.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      }
    }

    // planets
    g.font = "8px monospace";
    for (const p of s.planets) {
      const explored = this.isTileExplored(p.x, p.y);
      const pp = this.mapPoint(p.x, p.y);
      const def = CONFIG.planetDefs[p.type];
      const pr = Math.max(3, (p.r / m.worldR) * m.scale * 1.5);
      if (explored) {
        g.fillStyle = hexA(def.mid, 0.25);
        g.beginPath(); g.arc(pp.x, pp.y, pr + 4, 0, TAU); g.fill();
        g.fillStyle = def.mid;
        g.beginPath(); g.arc(pp.x, pp.y, pr, 0, TAU); g.fill();
        g.textAlign = "center";
        g.fillStyle = "#c7d2e0";
        g.fillText(p.name, pp.x, pp.y + pr + 12);
      } else {
        g.fillStyle = "#2a3040";
        g.beginPath(); g.arc(pp.x, pp.y, pr, 0, TAU); g.fill();
      }
    }

    // outpost trade lanes: dashed teal between owned outposts running freighter
    // loops; a raided lane pulses red (same alarm language as attacked outposts)
    for (const pr of this.tradeRoutePairs()) {
      const pa = this.mapPoint(pr.a.x, pr.a.y), pb = this.mapPoint(pr.b.x, pr.b.y);
      if (pr.raided) {
        const pulse = 0.5 + 0.5 * Math.sin(s.t * 6);
        g.strokeStyle = "#ff5060"; g.globalAlpha = 0.35 + pulse * 0.55; g.lineWidth = 1.6;
      } else {
        g.strokeStyle = "#22cccc"; g.globalAlpha = 0.5; g.lineWidth = 1;
      }
      if (g.setLineDash) g.setLineDash([5, 5]);
      g.beginPath(); g.moveTo(pa.x, pa.y); g.lineTo(pb.x, pb.y); g.stroke();
    }
    if (g.setLineDash) g.setLineDash([]);
    g.globalAlpha = 1;
    if (s.tradeRaid) {   // ambush point: pulsing red ring on the overlay
      const p = this.mapPoint(s.tradeRaid.x, s.tradeRaid.y);
      const pulse = 0.5 + 0.5 * Math.sin(s.t * 6);
      g.strokeStyle = "#ff5060"; g.globalAlpha = 0.5 + pulse * 0.5; g.lineWidth = 1.4;
      g.beginPath(); g.arc(p.x, p.y, 5 + pulse * 3, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    }

    // outposts: faction diamonds, player-held stand out, attacked ones pulse
    for (const o of (s.outposts || [])) {
      if (!o.discovered) continue;
      const p = this.mapPoint(o.x, o.y), col = this.outpostFactionCol(o);
      let r = o.owner === "player" ? 4 : 2.8;
      if (o.underAttack) r *= 1 + 0.35 * Math.sin(s.t * 6);
      g.fillStyle = o.underAttack ? "#ff5060" : col;
      g.beginPath(); g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y);
      g.closePath(); g.fill();
      if (o.owner === "player") { g.strokeStyle = "#e8fdf9"; g.lineWidth = 0.8; g.stroke(); }
    }

    // station nodes (names surface once zoomed in — read objectives at a glance)
    for (const st of stations) {
      if (!st.discovered) continue;
      const p = this.mapPoint(st.pos.x, st.pos.y);
      const col = st.id === s.homeStationId ? "#ffd24a" : "#57d1c9";
      g.fillStyle = hexA(col, 0.22);
      g.beginPath(); g.arc(p.x, p.y, 8, 0, TAU); g.fill();
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, p.y, 8, 0, TAU); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.arc(p.x, p.y, 2, 0, TAU); g.fill();
      if (m.zoom > 1.5) {
        g.font = "bold 7px monospace"; g.textAlign = "center";
        g.fillText(st.name, p.x, p.y - 11);
        g.textAlign = "left";
      }
    }

    // player waypoints: uncharted stations flagged on the warp screen (fly here to unlock warp)
    const pulseW = 0.5 + 0.5 * Math.sin(s.t * 4);
    for (const sid of (s.markedStations || [])) {
      const st = stations.find(x => x.id === sid);
      if (!st || st.discovered) continue;   // once discovered it draws as a normal node
      const p = this.mapPoint(st.pos.x, st.pos.y);
      g.strokeStyle = "#ffd24a"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.x, p.y, 7 + pulseW * 4, 0, TAU); g.stroke();
      g.fillStyle = "#ffd24a";
      g.beginPath(); g.moveTo(p.x, p.y - 5); g.lineTo(p.x + 5, p.y); g.lineTo(p.x, p.y + 5); g.lineTo(p.x - 5, p.y); g.closePath(); g.fill();
      g.fillStyle = "#ffe9a8"; g.font = "bold 8px monospace"; g.textAlign = "center";
      g.fillText("⌖ WAYPOINT", p.x, p.y - 12);
      g.textAlign = "left";
    }

    // trade drones
    g.fillStyle = "#57e6ff";
    for (const d of s.drones || []) {
      if (d.destroyed || d.arrived) continue;
      const dp = this.dronePos(d), p = this.mapPoint(dp.x, dp.y);
      g.beginPath(); g.arc(p.x, p.y, 2, 0, TAU); g.fill();
    }
    // NPC traders
    g.fillStyle = "#e8edf4";
    for (const t of s.npcTraders || []) {
      if (t.dead) continue;
      const p = this.mapPoint(t.x, t.y);
      g.beginPath(); g.arc(p.x, p.y, 1.5, 0, TAU); g.fill();
    }
    // fleet drones (hangar drones are docked — no map presence)
    for (const f of s.playerFleet || []) {
      if (f.role === "hangar") continue;
      const fx = f && typeof f.x === "number" ? f.x : s.x;
      const fy = f && typeof f.y === "number" ? f.y : s.y;
      const p = this.mapPoint(fx, fy);
      g.fillStyle = "#2c8b82";
      g.beginPath(); g.moveTo(p.x, p.y - 3); g.lineTo(p.x + 2.5, p.y + 2); g.lineTo(p.x - 2.5, p.y + 2);
      g.closePath(); g.fill();
    }

    // encounters
    for (const e of s.encounters || []) {
      if (e.resolved) continue;
      const p = this.mapPoint(e.x, e.y), r = 4;
      g.lineWidth = 1.5;
      if (e.type === "pirate_ambush") { g.fillStyle = "#ff5060"; g.beginPath(); g.arc(p.x, p.y, r - 1, 0, TAU); g.fill(); }
      else if (e.type === "faction_battle") { g.strokeStyle = "#b06cff"; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); }
      else if (e.type === "derelict") { g.strokeStyle = "#ffd24a"; g.beginPath();
        g.moveTo(p.x, p.y - r); g.lineTo(p.x + r, p.y); g.lineTo(p.x, p.y + r); g.lineTo(p.x - r, p.y);
        g.closePath(); g.stroke(); }
      else if (e.type === "distress_signal") { g.strokeStyle = "#ff9a3c"; g.beginPath();
        g.moveTo(p.x, p.y - r); g.lineTo(p.x + r * 0.87, p.y + r * 0.5); g.lineTo(p.x - r * 0.87, p.y + r * 0.5);
        g.closePath(); g.stroke(); }
    }

    // active quest marker — a labelled, pulsing beacon at wherever the current contract resolves
    const c = (s.contracts || [])[0];
    const qloc = this._questLocation(c);
    if (c && qloc) {
      const p = this.mapPoint(qloc.x, qloc.y), done = c.status === "complete";
      const col = done ? "#7bd88f" : "#ffd24a", pulseQ = 0.5 + 0.5 * Math.sin(s.t * 4);
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.x, p.y, 9 + pulseQ * 5, 0, TAU); g.stroke();
      g.fillStyle = col; g.font = "bold 12px monospace"; g.textAlign = "center";
      g.fillText("✦", p.x, p.y - 11);
      let title = c.title || "QUEST"; if (title.length > 22) title = title.slice(0, 21) + "…";
      g.font = "bold 8px monospace";
      g.fillText((done ? "✔ " : "◆ ") + title, p.x, p.y + 20);
      g.textAlign = "left";
    }

    // user nav waypoint (set via the ⌖ button) — the in-flight HUD arrow points here
    if (s.navWaypoint) {
      const wp = this.mapPoint(s.navWaypoint.x, s.navWaypoint.y), pw = 0.5 + 0.5 * Math.sin(s.t * 4);
      g.strokeStyle = "#7fdfff"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(wp.x, wp.y, 8 + pw * 4, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(wp.x - 9, wp.y); g.lineTo(wp.x + 9, wp.y); g.moveTo(wp.x, wp.y - 9); g.lineTo(wp.x, wp.y + 9); g.stroke();
      g.fillStyle = "#bfefff"; g.font = "bold 8px monospace"; g.textAlign = "center";
      g.fillText("◎ WAYPOINT", wp.x, wp.y - 13);
      g.textAlign = "left";
    }

    // player
    const pp = this.mapPoint(s.x, s.y), pulse = 0.5 + 0.5 * Math.sin(s.t * 4);
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(pp.x, pp.y, 4, 0, TAU); g.fill();
    g.strokeStyle = `rgba(255,255,255,${(0.75 - pulse * 0.55).toFixed(3)})`; g.lineWidth = 1.5;
    g.beginPath(); g.arc(pp.x, pp.y, 5 + pulse * 5, 0, TAU); g.stroke();

    // scale bar
    const segW = (GALAXY_MAP.scaleRefU / m.worldR) * m.scale, sy0 = CONFIG.H - 26;
    g.strokeStyle = "#9aa7b8"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(14, sy0); g.lineTo(14 + segW, sy0); g.stroke();
    g.beginPath(); g.moveTo(14, sy0 - 3); g.lineTo(14, sy0 + 3); g.stroke();
    g.beginPath(); g.moveTo(14 + segW, sy0 - 3); g.lineTo(14 + segW, sy0 + 3); g.stroke();
    g.fillStyle = "#9aa7b8"; g.font = "9px monospace"; g.textAlign = "left";
    g.fillText(GALAXY_MAP.scaleRefU + "u", 14, sy0 - 7);

    // empire progress — win condition: control all 10 political regions
    g.fillStyle = "#57d1c9"; g.font = "bold 9px monospace"; g.textAlign = "left";
    g.fillText("YOUR EMPIRE: " + (s.empireRegions || 0) + " / 10 REGIONS", 12, 38);

    // faction legend (political layer)
    this.drawMapPoliticalLegend(g);

    // active-quest tracker — always visible so you know what you're chasing
    if (c) {
      const done = c.status === "complete";
      let qt = c.title || "QUEST"; if (qt.length > 26) qt = qt.slice(0, 25) + "…";
      g.fillStyle = done ? "#7bd88f" : "#ffd24a"; g.font = "bold 9px monospace"; g.textAlign = "center";
      g.fillText((done ? "✔ QUEST DONE: " : "◆ TRACKING: ") + qt, CONFIG.W / 2, CONFIG.H - 58);
    }

    // trade network progress — charting a station now also unlocks its warp
    const discovered = stations.filter(st => st.discovered).length;
    const marked = (s.markedStations || []).filter(id => { const st = stations.find(x => x.id === id); return st && !st.discovered; }).length;
    g.fillStyle = "#5a6a82"; g.font = "9px monospace"; g.textAlign = "center";
    g.fillText(`Stations charted: ${discovered}/8` + (marked ? `   ·   ${marked} waypoint${marked > 1 ? "s" : ""}` : ""), CONFIG.W / 2, CONFIG.H - 42);
    g.fillText((m.zoom > 1.0001 ? "drag to pan · " : "") + "pinch / scroll to zoom · ⌖ sets a waypoint", CONFIG.W / 2, CONFIG.H - 10);
    g.textAlign = "left";

    // arming banner while the ⌖ set-waypoint mode is active
    if (s.mapSetWaypointMode) {
      const t = s.navWaypoint ? "⌖ TAP MAP TO MOVE · ⌖ AGAIN TO REMOVE" : "⌖ TAP THE MAP TO SET A WAYPOINT", tx = CONFIG.W / 2, ty = 46;
      g.font = "bold 10px monospace"; g.textAlign = "center";
      const bw = g.measureText(t).width + 22;
      g.fillStyle = "rgba(10,22,30,0.92)"; g.strokeStyle = "#7fdfff"; g.lineWidth = 1;
      g.beginPath(); g.roundRect(tx - bw / 2, ty - 13, bw, 21, 7); g.fill(); g.stroke();
      g.fillStyle = "#bfefff"; g.fillText(t, tx, ty + 2);
      g.textAlign = "left";
    }

    // zoom controls (drawn last so they sit above the map)
    this._drawMapZoomControls(g);
  },

  // bottom-right cluster: [+] [−] [⌂] [⌖] with a live "N.N×" readout above
  _drawMapZoomControls(g) {
    const s = this.state, z = this._mapZoomRects(), zoom = s.mapZoom || 1;
    // on = usable/lit, hot = actively armed (bright cyan)
    const btn = (r, glyph, on, hot) => {
      g.fillStyle = hot ? "rgba(28,52,64,0.95)" : "rgba(20,29,43,0.9)";
      g.strokeStyle = hot ? "#7fdfff" : (on ? "#57d1c9" : "#2b3648"); g.lineWidth = hot ? 1.5 : 1;
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 7); g.fill(); g.stroke();
      g.fillStyle = hot ? "#bfefff" : (on ? "#e8edf4" : "#4a5568"); g.font = "bold 16px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(glyph, r.x + r.w / 2, r.y + r.h / 2 + 1);
      g.textBaseline = "alphabetic";
    };
    btn(z.in, "+", zoom < this.GALAXY_ZOOM_MAX - 1e-3);
    btn(z.out, "−", zoom > 1.0001);
    btn(z.reset, "⌂", zoom > 1.0001);
    btn(z.waypoint, "⌖", !!s.navWaypoint, !!s.mapSetWaypointMode);   // lit once a waypoint exists, hot while arming
    g.fillStyle = "#8fd0ff"; g.font = "bold 9px monospace"; g.textAlign = "center";
    g.fillText(zoom.toFixed(1) + "×", z.in.x + z.in.w / 2, z.in.y - 6);
    g.textAlign = "left";
  },

  // minimal in-flight guide toward the nav waypoint: a light edge arrow + faint
  // guide line when it's off-screen, a small crosshair ring when it's on-screen
  drawWaypointHUD(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.navWaypoint) return;
    const W = CONFIG.W, H = CONFIG.H, inset = 22;
    const pt = this.SF(s.navWaypoint.x, s.navWaypoint.y);
    const dist = Math.hypot(s.x - s.navWaypoint.x, s.y - s.navWaypoint.y);
    const label = "◎ " + (dist >= 1000 ? (dist / 1000).toFixed(1) + "k" : Math.round(dist) + "u");
    const on = pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H;
    g.save();
    g.strokeStyle = "#7fdfff"; g.fillStyle = "#7fdfff";
    if (on) {
      const pw = 0.5 + 0.5 * Math.sin(s.t * 5);
      g.globalAlpha = 0.85; g.lineWidth = 1.5;
      g.beginPath(); g.arc(pt.x, pt.y, 9 + pw * 3, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(pt.x - 7, pt.y); g.lineTo(pt.x + 7, pt.y); g.moveTo(pt.x, pt.y - 7); g.lineTo(pt.x, pt.y + 7); g.stroke();
      g.globalAlpha = 0.7; g.font = "bold 9px monospace"; g.textAlign = "center";
      g.fillText(label, pt.x, pt.y - 14); g.textAlign = "left";
    } else {
      const cx = W / 2, cy = H / 2, a = Math.atan2(pt.y - cy, pt.x - cx);
      const ex = clamp(cx + Math.cos(a) * W, inset, W - inset);
      const ey = clamp(cy + Math.sin(a) * H, inset, H - inset);
      g.globalAlpha = 0.30; g.lineWidth = 1.5;   // faint guide line from just ahead of the ship toward the edge
      g.beginPath(); g.moveTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); g.lineTo(ex - Math.cos(a) * 13, ey - Math.sin(a) * 13); g.stroke();
      g.globalAlpha = 0.9;
      g.save(); g.translate(ex, ey); g.rotate(a);
      g.beginPath(); g.moveTo(10, 0); g.lineTo(-7, -6); g.lineTo(-7, 6); g.closePath(); g.fill();
      g.restore();
      g.globalAlpha = 0.78; g.font = "bold 9px monospace"; g.textAlign = "center";
      g.fillText(label, clamp(ex, 30, W - 30), ey < inset + 14 ? ey + 18 : ey - 12);
      g.textAlign = "left";
    }
    g.restore();
  },

  // ---- faction politics overlay (game/regions.js + game/politics.js) ----------
  // Every political region draws as a sun-to-rim PIE WEDGE in its live
  // controller's color at 20% opacity (player-held wedges turn cyan); a wedge
  // contested in the last 30s flashes between the loser's and the holder's
  // colors. Name labels sit at each wedge's mid-angle.
  drawMapPoliticalRegions(g, m) {
    if (typeof REGIONS === "undefined") return;
    const s = this.state, D = Math.PI / 180, o = this.mapPoint(0, 0);   // wedges radiate from the panned/zoomed sun
    const r0 = Math.max(4, (CONFIG.STAR_RADIUS * 1.6 / m.worldR) * m.scale);   // keep the star clear
    const r1 = m.scale;                                                        // rim of the disc
    for (const r of REGIONS) {
      const col = POLITICS.factionCol[r.controller] || "#9aa7b8";
      let drawCol = col, alpha = 0.20;
      if (s.t - r.lastContestT < POLITICS.contestPulseT) {   // contested: pulse
        const blink = 0.5 + 0.5 * Math.sin(s.t * 5);
        drawCol = blink > 0.5 ? col : (POLITICS.factionCol[r.contestFrom] || col);
        alpha = 0.14 + blink * 0.16;
      }
      const a0 = r.minAngle * D, a1 = r.maxAngle * D;
      g.fillStyle = hexA(drawCol, alpha);
      g.beginPath();
      g.arc(o.x, o.y, r1, a0, a1);
      g.arc(o.x, o.y, r0, a1, a0, true);
      g.closePath(); g.fill();
      g.strokeStyle = hexA(col, 0.30); g.lineWidth = 0.6; g.stroke();
      const aMid = (a0 + a1) / 2, rMid = r1 * 0.62;
      // label carries the sec rating in its danger color: "THE CRUCIBLE [8]"
      g.fillStyle = hexA(dangerColor(r.dangerLevel), 0.95); g.font = "bold 7px monospace"; g.textAlign = "center";
      g.fillText(r.name.toUpperCase() + " [" + r.dangerLevel + "]",
        o.x + Math.cos(aMid) * rMid, o.y + Math.sin(aMid) * rMid);
    }
    g.textAlign = "left";
  },
  // corner legend: faction swatches + live outpost holdings
  drawMapPoliticalLegend(g) {
    if (typeof POLITICS === "undefined") return;
    const s = this.state, counts = { vex: 0, krag: 0, nox: 0, player: 0 };
    for (const o of s.outposts || []) if (counts[o.owner] != null) counts[o.owner]++;
    let y = 50;
    g.font = "8px monospace"; g.textAlign = "left"; g.textBaseline = "middle";
    for (const [key, label] of [["vex", "VEX"], ["krag", "KRAG"], ["nox", "NOX"], ["player", "YOURS"]]) {
      if (key === "player" && !counts.player) continue;
      const icon = ART.get("icon_" + key);   // faction badge PNG (player has none → swatch)
      if (icon) g.drawImage(icon, 12, y - 7, 14, 14);
      else { g.fillStyle = POLITICS.factionCol[key]; g.fillRect(12, y - 3, 7, 7); }
      g.fillStyle = "#c7d2e0";
      g.fillText(label + " · " + counts[key] + " outposts", 30, y);
      y += 16;
    }
    g.textBaseline = "alphabetic";
  },
});
