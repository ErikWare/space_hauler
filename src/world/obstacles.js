/*=== HARNESS:OBSTACLES ======================================================*/
// Large, solid "terrain" bodies — planetoids/megaliths that just drift in open
// space and get in the way. They have MASS and collide (elastic bounce via
// circleHit) but carry NO ore and are NOT lockable, tappable, towable, or
// minable (they live in their own s.obstacles array, absent from every pick /
// mine / tow path). Seeded deterministically at world build, clear of stations,
// planets, outposts, and the home tutorial bubble; slow drift + tumble for life.
//
// Rendered PROCEDURALLY at world scale each frame (not from a baked sprite) so a
// 90u pebble and a 470u planetoid are both crisp — the per-body silhouette +
// craters are generated once at makeObstacle and just replayed.
const OBSTACLE_COLS = ["#6b6458", "#59606c", "#6a5748"];   // grey-brown / slate / rust

Object.assign(GAME, {
  _obstacleTier() {
    const tiers = CONFIG.obstacleTiers;
    let total = 0; for (const t of tiers) total += t.w;
    let r = rnd() * total;
    for (const t of tiers) { r -= t.w; if (r < 0) return t; }
    return tiers[tiers.length - 1];
  },
  makeObstacle(x, y, r, variant) {
    // irregular silhouette (radial multipliers) + crater field, in UNIT space so
    // the same body scales cleanly to any zoom.
    const n = 16, shape = [];
    for (let i = 0; i < n; i++) shape.push(0.82 + rnd() * 0.18);
    const craters = [], nc = 6 + ((rnd() * 5) | 0);
    for (let i = 0; i < nc; i++) craters.push({ ax: (rnd() * 2 - 1) * 0.72, ay: (rnd() * 2 - 1) * 0.72, cr: 0.06 + rnd() * 0.15 });
    return { id: "ob" + (this.state ? this.state.nextObstacleId++ : 0),
      x, y, vx: (rnd() * 2 - 1) * CONFIG.obstacleDriftMax, vy: (rnd() * 2 - 1) * CONFIG.obstacleDriftMax,
      r, mass: r * r * CONFIG.obstacleMassK, variant, col: OBSTACLE_COLS[variant % OBSTACLE_COLS.length],
      rot: rnd() * TAU, spinV: (rnd() * 2 - 1) * CONFIG.obstacleSpinMax, shape, craters };
  },
  // Is (x,y) far enough from every station / planet / outpost / other obstacle /
  // the star and the home bubble to drop a body of radius `r`?
  _obstacleSpotClear(x, y, r) {
    const s = this.state, C = CONFIG, home = this._oreCenter || { x: 0, y: 0 };
    if (this.dist(x, y, 0, 0) < CONFIG.STAR_RADIUS + r + 1500) return false;   // not on the sun
    if (this.dist(x, y, home.x, home.y) < C.obstacleClearHome) return false;   // tutorial bubble
    for (const st of ForgeWorld.getStations()) if (this.dist(x, y, st.pos.x, st.pos.y) < C.obstacleClearStation + r) return false;
    for (const p of s.planets) if (this.dist(x, y, p.x, p.y) < C.obstacleClearPlanet + p.r + r) return false;
    for (const o of (s.outposts || [])) if (this.dist(x, y, o.x, o.y) < C.obstacleClearOutpost + r) return false;
    for (const t of (s.sites || [])) if (this.dist(x, y, t.x, t.y) < t.r + r + 400) return false;   // region sites seed first
    for (const b of s.obstacles) if (this.dist(x, y, b.x, b.y) < C.obstacleMinDist + r + b.r) return false;
    return true;
  },
  // Scatter CONFIG.obstacleCount bodies across the disc (deterministic; call in
  // seedWorld AFTER stations/planets/outposts exist so clearance checks work).
  seedObstacles() {
    const s = this.state, C = CONFIG, R = C.WORLD_RADIUS;
    s.obstacles = []; s.nextObstacleId = 1;
    let placed = 0, attempts = 0, cap = C.obstacleCount * 40;
    while (placed < C.obstacleCount && attempts < cap) {
      attempts++;
      const tier = this._obstacleTier(), rad = tier.rMin + rnd() * (tier.rMax - tier.rMin);
      const a = rnd() * TAU, d = 6000 + rnd() * (R - 8000);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (!this._obstacleSpotClear(x, y, rad)) continue;
      s.obstacles.push(this.makeObstacle(x, y, rad, (rnd() * 3) | 0));
      placed++;
    }
  },
  // per-frame: drift + tumble all bodies; bounce the ship off any it overlaps.
  updateObstacles(dt) {
    const s = this.state; if (!s.obstacles || !s.obstacles.length) return;
    const near = CONFIG.collNear;
    for (const o of s.obstacles) {
      o.x += o.vx * dt; o.y += o.vy * dt; o.rot += o.spinV * dt;
      const dx = o.x - s.x, dy = o.y - s.y, reach = o.r + near;
      if (dx * dx + dy * dy > reach * reach) continue;                 // far: skip collision
      const impact = Math.hypot(s.vx - o.vx, s.vy - o.vy);            // closing speed BEFORE resolution
      if (this.circleHit(s, CONFIG.shipR, CONFIG.shipMass, o, o.r, o.mass)) {
        if (s.invuln <= 0 && !s.atStation && impact > CONFIG.obstacleRamMinSpeed) {
          this.damageShip(Math.min(CONFIG.obstacleRamMax, CONFIG.obstacleRamDmg + impact * CONFIG.obstacleRamSpeedK));
          sfx("crunch");
        }
      }
    }
  },
  // world render: depth-sorted with rocks/ships (pushes closures into `items`).
  drawObstacles(g, items, isWorldVisible, z) {
    const s = this.state; if (!s.obstacles) return;
    for (const o of s.obstacles) {
      if (!isWorldVisible(o.x, o.y, o.r)) continue;
      const pt = this.S(o.x, o.y), R = o.r * z;
      items.push({ y: o.y, f: () => this._paintObstacle(g, o, pt.x, pt.y, R) });
    }
  },
  _paintObstacle(g, o, x, y, R) {
    const base = o.col, n = o.shape.length;
    g.save(); g.translate(x, y); g.rotate(o.rot);
    g.lineJoin = "round";
    // soft occlusion shadow so the solid body reads against the starfield
    const halo = g.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 1.14);
    halo.addColorStop(0, "rgba(0,0,0,0)"); halo.addColorStop(1, "rgba(0,0,0,0.4)");
    g.fillStyle = halo; g.beginPath(); g.arc(0, 0, R * 1.14, 0, TAU); g.fill();
    const path = () => { g.beginPath();
      for (let i = 0; i < n; i++) { const a = i / n * TAU, rad = R * o.shape[i];
        const px = Math.cos(a) * rad, py = Math.sin(a) * rad; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); };
    // lit-sphere body: highlight up-left → dark rim
    path();
    const grd = g.createRadialGradient(-R * 0.38, -R * 0.42, R * 0.08, 0, 0, R * 1.08);
    grd.addColorStop(0, shade(base, 0.42)); grd.addColorStop(0.5, base); grd.addColorStop(1, shade(base, -0.72));
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    for (const c of o.craters) { const cx = c.ax * R, cy = c.ay * R, cr = c.cr * R;
      g.fillStyle = "rgba(0,0,0,0.30)"; g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,0.10)"; g.beginPath(); g.arc(cx - cr * 0.3, cy - cr * 0.3, cr * 0.55, 0, TAU); g.fill(); }
    g.restore();
    path(); g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = Math.max(1, R * 0.02); g.stroke();
    g.restore();
  },
  // minimap: faint grey bodies on the radar disc so the player can route around
  // them (same overlay geometry as drawFleetMinimap — hud.js untouched).
  drawObstaclesMinimap(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.obstacles || !s.obstacles.length) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / ((s.derived && s.derived.scanRange) || 1000);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.fillStyle = "rgba(150,140,120,0.75)";
    for (const o of s.obstacles) {
      const dx = (o.x - s.x) * kMap, dy = (o.y - s.y) * kMap;
      if (dx * dx + dy * dy > R * R) continue;
      const rr = Math.max(1.4, Math.min(5, o.r * kMap));   // scale the blip with the body
      g.beginPath(); g.arc(cx + dx, cy + dy, rr, 0, TAU); g.fill();
    }
    g.restore();
  },
});
