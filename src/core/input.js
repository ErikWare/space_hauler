/*=== HARNESS:INPUT ==========================================================*/
// Pointer/keyboard → game intent. The `input` object (config.js) is the shared
// mailbox the DOM handlers (main.js boot) fill; these helpers turn a screen
// point into a thrust vector or resolve a tap to a lock-on / tow target.
Object.assign(GAME, {
  // convert a held screen point into a normalized thrust direction from the
  // ship's on-screen position (undo the pitch on y so aim feels world-true).
  aimVector(px, py) {
    const shipS = this.S(this.state.x, this.state.y);
    const dx = px - shipS.x, dy = (py - shipS.y) / CONFIG.pitch;
    const L = Math.hypot(dx, dy);
    return L > 6 ? { ax: dx / L, ay: dy / L } : { ax: 0, ay: 0 };
  },

  // screen tap → nearest grabbable body (rock or junk) in tractor range that
  // isn't already towed. Returns { arr, i } or null.
  pickGrabbableAt(sx, sy) {
    const s = this.state, range = s.derived.tractorRange, z = s.cam.zoom;
    let best = null, bd = CONFIG.tapPickR;
    const test = (arr, i, body, worldR) => {
      if (this.shipTo(body) > range && !this.isTowed(arr, i)) return;
      const p = this.S(body.x, body.y), d = Math.hypot(p.x - sx, p.y - sy);
      const hitR = Math.max(CONFIG.tapPickR, worldR * z);
      if (d < hitR && d < bd + worldR * z) { bd = d; best = { arr, i }; }
    };
    for (let i = 0; i < s.rocks.length; i++) test("rocks", i, s.rocks[i], s.rocks[i].size * 20);
    for (let i = 0; i < s.junk.length; i++) test("junk", i, s.junk[i], s.junk[i].r);
    return best;
  },

  // screen tap → nearest living combat target (alien or enemy base) in scan range.
  // Aliens use the FLAT projection (SF) matching ForgeFaction.drawAlienShip; enemy
  // bases use the pitched S() matching their depth-sorted world sprite.
  pickAlienAt(sx, sy) {
    const s = this.state, z = s.cam.zoom, scan = s.derived.scanRange;
    let best = null, bd = CONFIG.tapPickR;
    for (const al of s.aliens) {
      if (al.state === "DEAD") continue;
      if (this.dist(s.x, s.y, al.x, al.y) > scan) continue;
      const p = this.SF(al.x, al.y), dd = Math.hypot(p.x - sx, p.y - sy);
      const r = (al.r || 15) * z, hitR = Math.max(CONFIG.tapPickR, r);
      if (dd < hitR && dd < bd + r) { bd = dd; best = al; }
    }
    for (const b of s.enemyBases) {
      if (b.destroyed) continue;
      if (this.dist(s.x, s.y, b.x, b.y) > scan) continue;
      const p = this.S(b.x, b.y), dd = Math.hypot(p.x - sx, p.y - sy);
      const r = (b.r || 55) * z, hitR = Math.max(CONFIG.tapPickR, r);
      if (dd < hitR && dd < bd + r) { bd = dd; best = b; }
    }
    // enemy-faction outposts are lockable structures (pitched S(), like bases)
    for (const o of (s.outposts || [])) {
      if (!o.discovered || o.owner === "player") continue;
      if (this.dist(s.x, s.y, o.x, o.y) > scan) continue;
      const p = this.S(o.x, o.y), dd = Math.hypot(p.x - sx, p.y - sy);
      const r = 34 * z, hitR = Math.max(CONFIG.tapPickR, r);
      if (dd < hitR && dd < bd + r) { bd = dd; best = o; }
    }
    return best;
  },

  pickRockAt(sx, sy) {
    const s = this.state, z = s.cam.zoom, scan = s.derived.scanRange;
    let best = null, bd = CONFIG.tapPickR;
    for (let i = 0; i < s.rocks.length; i++) {
      const r = s.rocks[i];
      if (this.dist(s.x, s.y, r.x, r.y) > scan) continue;
      const p = this.S(r.x, r.y), dd = Math.hypot(p.x - sx, p.y - sy);
      const rr = r.size * 20 * z, hitR = Math.max(CONFIG.tapPickR, rr);
      if (dd < hitR && dd < bd + rr) { bd = dd; best = i; }
    }
    return best;
  },

  resolveTap(sx, sy) {
    const s = this.state;
    // docked at an owned outpost: tapping the platform stations a guard drone
    const op = this.pickOutpostAt(sx, sy);
    if (op && op.owner === "player") { this.buyOutpostDrone(op); return "outpost"; }
    if (!s.tows.length) {
      const al = this.pickAlienAt(sx, sy);
      if (al) { this.lockAlien(al); return "lock"; }
      const tr = this.pickTraderAt(sx, sy);
      if (tr) {
        if (s.pirateTargetId === tr.id) { s.pirateTargetId = null; toast("piracy called off"); sfx("drop"); }
        else { s.pirateTargetId = tr.id; toast("⚠ targeting trader — piracy!", "#ff9a3c"); sfx("warn"); }
        return "pirate";
      }
    }
    const hit = this.pickGrabbableAt(sx, sy);
    if (hit) { this.toggleGrabAt(hit.arr, hit.i); return "tow"; }
    const ri = this.pickRockAt(sx, sy);
    if (ri != null) { this.lockRock(ri); return "lock"; }
    return "none";
  },
});
