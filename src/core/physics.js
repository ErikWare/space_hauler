/*=== HARNESS:PHYSICS ========================================================*/
// Collision detection + elastic bounce, planet gravity wells, and the
// game-side 3-layer health model (Shield → Armor → Hull, overflow penetrates).
// Typed weapon damage is handled by ForgeCombat; this covers ram/collision.
Object.assign(GAME, {
  dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); },
  shipTo(o) { const s = this.state; return this.dist(s.x, s.y, o.x, o.y); },

  // Active hull's collision mass (per-hull since the faction lines: a Krag
  // dreadnought at mass 8 shoves rocks aside where the vulture bounces off).
  // Also scales ram damage DOWN via shipRamMult — heavy plate shrugs debris.
  shipMass() {
    const h = this.activeHull ? this.activeHull() : null;
    return (h && h.baseShip.mass) || CONFIG.shipMass;
  },
  shipRamMult(refMass) { return Math.min(1, (refMass || 2) / this.shipMass()); },

  // circle overlap → separate + elastic impulse along the normal. Mutates both.
  circleHit(a, ra, ma, b, rb, mb) {
    const dx = b.x - a.x, dy = b.y - a.y, rr = ra + rb, d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d, tot = ma + mb, push = rr - d;
    a.x -= nx * push * (mb / tot); a.y -= ny * push * (mb / tot);
    b.x += nx * push * (ma / tot); b.y += ny * push * (ma / tot);
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel < 0) { const j = -1.9 * rel / (1 / ma + 1 / mb);   // restitution 0.9
      a.vx -= j * nx / ma; a.vy -= j * ny / ma; b.vx += j * nx / mb; b.vy += j * ny / mb; }
    return true;
  },

  // 3-layer damage: untyped amount flows Shield → Armor → Hull, overflow
  // penetrating to the next layer. Returns the amount that reached the hull.
  // (per-layer resist is applied so gear that boosts resist still matters.)
  damageShip(dmg) {
    const s = this.state, h = s.hp;
    s.invuln = CONFIG.invulnT; s.flash = CONFIG.flashT; h._sinceHit = 0;
    let d = dmg, toHull = 0;
    if (h.shield > 0 && d > 0) {
      const eff = d * (1 - (h.res.shield || 0)), soak = Math.min(h.shield, eff);
      h.shield -= soak; d = eff > soak ? (eff - soak) / (1 - (h.res.shield || 0)) : 0;
      s.shieldFlash = 0.3;
      if (d <= 0) { sfx("crunch"); burst(s.x, s.y, "#7df9ff", 8); return 0; }
    }
    if (h.armor > 0 && d > 0) {
      const eff = d * (1 - (h.res.armor || 0)), soak = Math.min(h.armor, eff);
      h.armor -= soak; d = eff > soak ? (eff - soak) / (1 - (h.res.armor || 0)) : 0;
      if (d <= 0) { sfx("crunch"); burst(s.x, s.y, "#ffb020", 8); return 0; }
    }
    if (d > 0) { const eff = d * (1 - (h.res.hull || 0)); h.hull = Math.max(0, h.hull - eff); toHull = eff; }
    sfx("crunch"); burst(s.x, s.y, "#ff6b6b", 10);
    if (h.hull <= 0 && !s.dead) this.onShipDestroyed();
    return toHull;
  },

  // Rock–rock broadphase. A flat pair loop over the near set is O(K²) — at
  // K=1084 that is 587k circleHit calls/frame (~25ms), which is what forced the
  // world to stay sparse. A uniform grid makes it linear in K.
  //   CONFIG.collCell must exceed the diameter of the largest rock (belt
  //   platinum: size 1.675 → r 33.5 → d 67) so any overlapping pair lands in
  //   the same cell or in one of the four forward neighbours below. The four
  //   are the mirror-halves of the eight surrounding cells, so every pair is
  //   visited exactly once.
  ROCK_NB: [[1, 0], [-1, 1], [0, 1], [1, 1]],
  rockPairPass(near) {
    const s = this.state, CELL = CONFIG.collCell, grid = new Map(), cells = [];
    for (let a = 0; a < near.length; a++) {
      const i = near[a];
      if (this.isTowed("rocks", i)) continue;
      const r = s.rocks[i], cx = Math.floor(r.x / CELL), cy = Math.floor(r.y / CELL), k = cx + ":" + cy;
      let c = grid.get(k);
      if (!c) { c = { cx, cy, list: [] }; grid.set(k, c); cells.push(c); }
      c.list.push(i);
    }
    for (const c of cells) {
      const L = c.list;
      for (let a = 0; a < L.length; a++) {
        const A = s.rocks[L[a]], ar = A.size * 20;
        for (let b = a + 1; b < L.length; b++) { const B = s.rocks[L[b]];
          this.circleHit(A, ar, A.mass, B, B.size * 20, B.mass); }
        for (const [ox, oy] of this.ROCK_NB) {
          const oc = grid.get((c.cx + ox) + ":" + (c.cy + oy));
          if (!oc) continue;
          for (const bi of oc.list) { const B = s.rocks[bi];
            this.circleHit(A, ar, A.mass, B, B.size * 20, B.mass); }
        }
      }
    }
  },

  // planet gravity: gentle pull inside gravZone×radius (no collision damage).
  applyGravity(dt) {
    const s = this.state;
    for (const p of s.planets) {
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (d < p.r * CONFIG.gravZone && d > 1) {
        const gp = CONFIG.planetGrav * dt / d; s.vx += dx * gp; s.vy += dy * gp;
      }
    }
  },
});
