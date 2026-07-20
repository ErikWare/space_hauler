/*=== HARNESS:SITES ==========================================================*/
// Region sites (Phase 4) — landmark POIs that give empty sector-grid cells an
// ownable identity: asteroid clusters, human shipwrecks, and derelict alien
// stations. A site lives in exactly one R-#### cell (world/regions.js) and the
// cell can hold an outpost OR a site, never both — seedSites runs after
// seedOutposts and skips claimed cells, and nothing spawns outposts later.
// Density: eligible cells in the 8-neighbourhood of the outposts, ~1 per 3-4,
// plus a guarantee pass so EVERY outpost keeps at least one neighbouring site
// (quests in later phases send the player "next door"). Everything about a
// site derives from a hash of its region id (theme, layout, garrison size), so
// sites are stable across inits regardless of the global rnd() stream.
//
// Pieces are static clay PNGs (pipeline.py `sites`) drawn in the depth-sorted
// static pass; a missing PNG falls back to a flat colored rectangle so the
// game runs art-less (and headless). Defenders reuse the outpost garrison
// pattern exactly: persistent guardRecs (dead stays dead), real ForgeFaction
// ships streamed into s.aliens inside CONFIG.outpostGuardStreamR, written back
// out on leave. Alien-derelict sentinels are the heaviest hull (nox elite →
// carrier) renamed + retinted — there is no fourth species in the engine.
const SITE_TYPE_ORDER = ["asteroid_cluster", "shipwreck", "alien_derelict"];

const SITE_DEFS = {
  asteroid_cluster: {
    label: "asteroid cluster", glyph: "⬡", col: "#8f8778", mapCol: "#b9ae95",
    pieceKeys: ["asteroid_chunk_1", "asteroid_chunk_2", "asteroid_chunk_3",
                "asteroid_chunk_4", "asteroid_chunk_5", "asteroid_chunk_6"],
    pieceW: [300, 240, 170, 260, 250, 140],
    tumble: true,             // loose rocks spin; wreck/derelict pieces hang dead
    guards: [1, 2], guardFaction: "nox", guardTier: "normal",   // light pirate opportunists
  },
  shipwreck: {
    label: "shipwreck", glyph: "✕", col: "#8a5f4a", mapCol: "#d08a5e",
    pieceKeys: ["wreck_bow", "wreck_hull", "wreck_stern", "wreck_debris"],
    pieceW: [330, 330, 320, 290],
    tumble: false,
    guards: [2, 3], guardFaction: "nox", guardTier: "rare",     // territorial scavengers
  },
  alien_derelict: {
    label: "alien derelict", glyph: "✦", col: "#7a6a9e", mapCol: "#c084ff",
    pieceKeys: ["alien_body", "alien_wing", "alien_glyph", "alien_conduit"],
    pieceW: [520, 380, 170, 200],
    tumble: false,
    guards: [1, 2], guardFaction: "nox", guardTier: "elite",    // heaviest hull, renamed
    guardName: "Ancient Sentinel", guardColor: "#c084ff",
  },
};

// small-rock/junk crowding scatter shared by all themes (existing clay keys)
const SITE_SCATTER = [
  { key: "asteroid_a", w: 110 }, { key: "asteroid_b", w: 120 }, { key: "asteroid_c", w: 100 },
  { key: "junk_can", w: 70 }, { key: "junk_panel", w: 90 }, { key: "junk_crate", w: 75 },
  { key: "junk_debris", w: 95 },
];

Object.assign(GAME, {
  // ---- deterministic per-region randomness --------------------------------
  _siteHash(id) {
    let h = (id * 2654435761) >>> 0;
    h ^= h >>> 13; h = (h * 2246822519) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  },
  _siteRng(seed) {   // tiny LCG over the region hash — independent of global rnd()
    let x = (seed >>> 0) || 1;
    return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  },

  siteById(id) { return (this.state.sites || []).find(t => t.id === id) || null; },

  // Can `region` host a site? relax 0 = strict, 1 = allow exotic-vein cells,
  // 2 = also allow star-glare cells (guarantee-pass fallbacks only).
  _siteRegionEligible(region, relax) {
    if (!region || region.site || region.outpostId) return false;
    if (region.event && region.event.type === "station") return false;
    if (relax < 1 && region.exotic) return false;
    if (relax < 2 && region.dist < 6000) return false;
    return true;
  },

  // ---- seeding (seedWorld: after seedOutposts, before seedObstacles) ------
  seedSites() {
    const s = this.state;
    s.sites = []; s.nextSiteId = 1;
    // density pass: eligible cells ringing any outpost, ~1 site per 3.5 cells
    const nearIds = new Set();
    for (const o of s.outposts) {
      const reg = this.regionGet(o.regionId);
      if (!reg) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nb = this.regionByColRow(reg.col + dc, reg.row + dr);
        if (nb) nearIds.add(nb.id);
      }
    }
    for (const id of [...nearIds].sort((a, b) => a - b)) {   // Set order → stable order
      const region = this.regionGet(id);
      if (!this._siteRegionEligible(region, 0)) continue;
      if (this._siteHash(id) % 7 >= 2) continue;
      if (!this._stationClear(region.cx, region.cy, 2200)) continue;
      this._makeSite(region, null);
    }
    // guarantee pass: every outpost keeps ≥1 neighbouring site
    for (const o of s.outposts) {
      const reg = this.regionGet(o.regionId);
      if (!reg) continue;
      let has = false; const cands = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nb = this.regionByColRow(reg.col + dc, reg.row + dr);
        if (!nb) continue;
        if (nb.site) has = true; else cands.push(nb);
      }
      for (let relax = 0; relax <= 2 && !has; relax++)
        for (const nb of cands)
          if (this._siteRegionEligible(nb, relax)) { this._makeSite(nb, null); has = true; break; }
      if (!has) console.warn("sites: outpost " + o.id + " has no eligible neighbour cell");
    }
    // coverage pass: hash theming all but guarantees the three types over this
    // many sites — still, retheme tail sites of over-represented types if not
    for (const ty of SITE_TYPE_ORDER) {
      if (s.sites.some(t => t.type === ty)) continue;
      const counts = {};
      for (const t of s.sites) counts[t.type] = (counts[t.type] || 0) + 1;
      for (let i = s.sites.length - 1; i >= 0; i--) {
        const t = s.sites[i];
        if (counts[t.type] > 1) { this._rethemeSite(t, ty); break; }
      }
    }
  },

  _makeSite(region, forceType) {
    const s = this.state, h = this._siteHash(region.id);
    const type = forceType || SITE_TYPE_ORDER[h % 3];
    const rng = this._siteRng(h);
    const site = {
      id: "site" + (s.nextSiteId++), kind: "site", type, regionId: region.id,
      x: region.cx + (rng() - 0.5) * 900, y: region.cy + (rng() - 0.5) * 900,
      r: 120, dangerLevel: 1, discovered: false, streamed: false, provoked: false,
      guardRecs: [], _ships: [], pieces: [],
    };
    site.dangerLevel = getDangerLevel(site.x, site.y);
    this._buildSitePieces(site, rng);
    region.site = site;           // region ownership: outpost OR site, never both
    s.sites.push(site);
    return site;
  },

  // Regenerate a site in place under a new theme (coverage pass only).
  _rethemeSite(site, type) {
    site.type = type;
    site.pieces = []; site.guardRecs = []; site.r = 120;
    this._buildSitePieces(site, this._siteRng(this._siteHash(site.regionId) ^ 0x9e3779b9));
  },

  // 3-5 theme pieces + 2-4 crowding scatter pieces, mild non-overlapping
  // spread off the anchor. First theme piece is the centrepiece at the anchor.
  _buildSitePieces(site, rng) {
    const def = SITE_DEFS[site.type];
    site._avoidCircles = null;   // pieces are being rebuilt → drop the cached collision circles
    const nTheme = 3 + ((rng() * 3) | 0), nScatter = 2 + ((rng() * 3) | 0);
    const order = def.pieceKeys.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]];
    }
    const place = (key, w, tumble, scatter) => {
      let dx = 0, dy = 0;
      if (site.pieces.length) {
        for (let t = 0; t < 26; t++) {   // widen the ring until the piece fits
          const a = rng() * TAU, d = 100 + rng() * 380 + t * 26;
          dx = Math.cos(a) * d; dy = Math.sin(a) * d * 0.8;
          let ok = true;
          for (const q of site.pieces)
            if (Math.hypot(dx - q.dx, dy - q.dy) < (w + q.w) * 0.55) { ok = false; break; }
          if (ok) break;
        }
      }
      site.pieces.push({ key, dx, dy, w,
        rot: tumble ? rng() * TAU : (rng() - 0.5) * 1.2,
        spinV: tumble ? (rng() * 2 - 1) * 0.1 : 0, scatter });
    };
    for (let i = 0; i < nTheme; i++) {
      const idx = order[i % order.length];   // wraps when nTheme > distinct keys
      place(def.pieceKeys[idx], def.pieceW[idx] * (0.85 + rng() * 0.3), def.tumble, false);
    }
    for (let i = 0; i < nScatter; i++) {
      const sc = SITE_SCATTER[(rng() * SITE_SCATTER.length) | 0];
      place(sc.key, sc.w * (0.8 + rng() * 0.5), true, true);
    }
    for (const p of site.pieces) site.r = Math.max(site.r, Math.hypot(p.dx, p.dy) + p.w / 2);
    // baseline garrison: 1-3 persistent guard records (streamed like outposts)
    const n = def.guards[0] + ((rng() * (def.guards[1] - def.guards[0] + 1)) | 0);
    for (let i = 0; i < n; i++) site.guardRecs.push({ frac: 1, alive: true });
    // base emplacement: a fixed heavy-weapon platform on the two guarded themes
    // (alien_derelict → charged laser, shipwreck → missile barrage; both also
    // launch homing torpedoes). Resource clusters spawn none. Co-located with the
    // centrepiece (pieces[0], at the anchor) so the chunk shields the platform.
    site.emplacement = this._makeEmplacement(site);
  },

  // Build the stationary weapon platform for a site, or null if its theme is
  // unarmed. Hull + armor pools scale with the site's danger wedge (like guards),
  // so a null-sec fortress is a genuine grind. Timers start staggered so a fresh
  // stream-in never fires on frame one.
  _makeEmplacement(site) {
    const weapon = CONFIG.empThemeWeapon[site.type];
    if (!weapon) return null;
    // Rarity gate — most guarded sites are just a garrison fleet. Odds climb with
    // the wedge's danger rating, so home space is plain fights and null-sec holds
    // the strongholds. Rolled off bits 11-20 of the region hash (the theme picker
    // owns the low bits, the art variant bit 5), so it is stable across inits and
    // independent of both.
    const dl = clamp(Math.round(site.dangerLevel || 1), 1, 9);
    const roll = ((this._siteHash(site.regionId) >>> 11) & 1023) / 1023;
    if (roll >= (CONFIG.empChanceByDanger[dl] || 0)) return null;
    const C = CONFIG, m = dangerEnemyMult(site.dangerLevel || 1).hp;
    const dmgM = dangerEnemyMult(site.dangerLevel || 1).dmg;
    const hullMax = Math.round(C.empHpBase * m), armorMax = Math.round(C.empHpBase * 0.55 * m);
    // Two clay looks per weapon so ~100 armed sites don't read identically.
    // Bit 5 of the region hash — the theme picker already spent the low bits
    // (h % 3), so a different bit keeps look and theme uncorrelated.
    const art = "emp_" + weapon + (((this._siteHash(site.regionId) >>> 5) & 1) ? "_b" : "_a");
    return {
      id: site.id + "_emp", kind: "emplacement", siteId: site.id, weapon, art,
      x: site.x, y: site.y, r: 30, destroyed: false,
      hp: { shield: 0, shieldMax: 0, armor: armorMax, armorMax, hull: hullMax, hullMax,
            res: { shield: 0, armor: 0, hull: 0 }, _sinceHit: 99 },
      missileDmg: Math.round(C.empMissileDmg * dmgM * 10) / 10,
      torpedoDmg: Math.round(C.empTorpedoDmg * dmgM * 10) / 10,
      primaryCd: 2500 + (weapon === "laser" ? 1500 : 0),   // brief spin-up before the first shot
      torpedoCd: C.empTorpedoCdMin,
      locking: false, lockT: 0, aimX: site.x, aimY: site.y,
      beamT: 0, beamX: site.x, beamY: site.y,
    };
  },

  // ---- defenders: the outpost garrison pattern (persistent recs + streaming)
  _streamSiteGuardsIn(t) {
    if (t.streamed) return;
    t.streamed = true; t._ships = [];
    if (!t.guardRecs.some(r => r.alive)) return;
    const s = this.state, def = SITE_DEFS[t.type];
    const dl = t.dangerLevel || getDangerLevel(t.x, t.y);
    for (let i = 0; i < t.guardRecs.length; i++) {
      const rec = t.guardRecs[i];
      if (!rec.alive) continue;
      const ship = ForgeFaction.generateAlienShip(def.guardFaction, def.guardTier,
        { rng: rnd, x: t.x, y: t.y, groupId: t.id, isLeader: i === 0, orbitRadius: t.r + 150 });
      if (def.guardName) {
        ship.name = def.guardName + (t.guardRecs.length > 1 ? " " + (i + 1) : "");
        ship.color = def.guardColor;
      }
      applyDangerToShip(ship, dl);   // scale full pools first, then the saved frac
      const a = i / t.guardRecs.length * TAU + 0.4;
      ship.x = t.x + Math.cos(a) * (t.r + 130); ship.y = t.y + Math.sin(a) * (t.r + 130);
      ship.hp.shield *= rec.frac; ship.hp.armor *= rec.frac; ship.hp.hull *= rec.frac;
      ship._siteId = t.id; ship._guardIdx = i;
      s.aliens.push(ship); t._ships.push(ship);
      if (t.provoked) ForgeFaction.activateGroup(ship, s.aliens);
    }
  },
  _streamSiteGuardsOut(t) {
    if (!t.streamed) return;
    const s = this.state;
    for (const ship of t._ships) {
      const rec = t.guardRecs[ship._guardIdx];
      if (!rec) continue;
      rec.frac = Math.max(0, ship.hp.hull / ship.hp.hullMax);
      rec.alive = ship.hp.hull > 0 && ship.state !== "DEAD";
    }
    s.aliens = s.aliens.filter(a => a._siteId !== t.id);
    t._ships = []; t.streamed = false;
  },

  updateSites(dt) {
    const s = this.state;
    if (!s.sites) return;
    this._updateEmpProjectiles(dt);   // emplacement missiles/torpedoes advance even while dead
    for (const al of s.aliens) if (al._avoid) al._avoid = null;   // reset per-frame flank targets
    if (s.dead) return;
    const C = CONFIG, streamR = C.outpostGuardStreamR;
    for (const t of s.sites) {
      const d = this.dist(s.x, s.y, t.x, t.y);
      if (!t.discovered && (d < C.fieldDiscoverR || this.isTileExplored(t.x, t.y))) {
        t.discovered = true;
        const def = SITE_DEFS[t.type];
        // a fortified site is the exception — say so, the player is about to be shot at
        const fort = t.emplacement && !t.emplacement.destroyed;
        toast(def.glyph + " " + def.label + " sighted — " +
          this.regionLabel(this.regionGet(t.regionId)) + (fort ? "  ⚠ FORTIFIED" : ""),
          fort ? "#ff9a3c" : def.mapCol);
      }
      if (d < t.r + C.shipR + 4) this._collideSite(t);   // solid pieces block the ship
      // enemies: after their AI has moved them this frame (updateAliens runs
      // first), push any that ended up inside a piece back out, and mark the site's
      // chunks as flank-avoidance targets so their pursuit curves around instead of
      // grinding in. Gated to sites that can hold combatants — aliens only exist
      // near the ship, so a streamed or ship-near site is the only place one can be.
      if (t.streamed || d < streamR) {
        const reach = t.r + C.avoidPad + 80;   // wide enough that they start flanking early
        const circles = this._siteAvoidCircles(t);
        for (const al of s.aliens) {
          if (al.x == null || al.state === "DEAD") continue;
          const adx = al.x - t.x, ady = al.y - t.y;
          if (adx * adx + ady * ady < reach * reach) {
            this._pushOutOfSite(t, al, al.r || 15);
            al._avoid = al._avoid ? al._avoid.concat(circles) : circles;   // read-only share
            this._guardSightCheck(t, al, dt);   // cover can shake a pursuing garrison
          }
        }
      }
      if (!t.streamed && d < streamR) this._streamSiteGuardsIn(t);
      else if (t.streamed && d > streamR + 1500) this._streamSiteGuardsOut(t);
      if (t.streamed && !t.provoked) {
        // provoked the moment any defender takes damage or wakes — then the
        // whole garrison turns (they share groupId = site id)
        for (const ship of t._ships)
          if (ship.hp.hull < ship.hp.hullMax || ship.aggro) {
            t.provoked = true;
            ForgeFaction.activateGroup(ship, s.aliens);
            break;
          }
      }
      if (t.emplacement && !t.emplacement.destroyed) this._updateEmplacements(t, dt, d);
    }
  },

  // Heavy bodies are cover in both directions: a garrison guard that loses sight
  // of the player for guardLoseSightT seconds AND is beyond guardLoseSightDist
  // gives up and drops back to dormant watch — duck behind a chunk and burn
  // distance and you genuinely shake pursuit. Hugging a chunk at knife range
  // never works (the distance gate), and a lock or a hit re-provokes instantly
  // through the existing paths. t.provoked is deliberately left set so a merely
  // wounded guard doesn't re-aggro itself on the very next frame.
  _guardSightCheck(t, al, dt) {
    if (al._siteId !== t.id || al.state === "IDLE" || al.state === "DEAD") return;
    const s = this.state, C = CONFIG;
    const far = this.dist(al.x, al.y, s.x, s.y) > C.guardLoseSightDist;
    if (far && this._losBlocked(al.x, al.y, s.x, s.y, t)) {
      al._losLostT = (al._losLostT || 0) + dt;
      if (al._losLostT > C.guardLoseSightT) {
        al.state = "IDLE"; al.aggro = false; al._losLostT = 0;
      }
    } else al._losLostT = 0;
  },

  // World-space collision circles for a site's chunks, cached (pieces are static).
  // Rebuilt lazily; invalidated in _buildSitePieces when a site is (re)themed.
  _siteAvoidCircles(t) {
    if (t._avoidCircles) return t._avoidCircles;
    const k = CONFIG.siteCollK, arr = [];
    for (const pc of t.pieces) arr.push({ x: t.x + pc.dx, y: t.y + pc.dy, r: pc.w * k });
    return (t._avoidCircles = arr);
  },

  // Solid pieces — a site is a landmark you fly AROUND, not through. Each piece
  // is a static, effectively immovable circle (siteMass ≫ shipMass), so the ship
  // bounces off it via the shared elastic circleHit. We collide PER PIECE, never
  // against the bounding radius t.r: a site is a cluster with gaps, and walling
  // off the whole disc would block the empty lanes between chunks. A fast ram
  // into a substantial theme piece stings on the shared obstacleRam* budget;
  // scatter debris just blocks (a soft bump). Like the s.obstacles terrain
  // bodies, only the player ship is blocked — garrison ships are AI-driven
  // (position-set, not velocity) and orbit outside the pieces anyway.
  _collideSite(t) {
    const s = this.state, C = CONFIG, shipR = C.shipR;
    const impact = Math.hypot(s.vx, s.vy);   // incoming closing speed (pieces are static)
    let ramSolid = false;
    for (const pc of t.pieces) {
      const px = t.x + pc.dx, py = t.y + pc.dy, pr = pc.w * C.siteCollK;
      const dx = px - s.x, dy = py - s.y, reach = pr + shipR;
      if (dx * dx + dy * dy > reach * reach) continue;
      const body = { x: px, y: py, vx: 0, vy: 0 };   // discarded: the landmark never moves
      if (this.circleHit(s, shipR, this.shipMass(), body, pr, C.siteMass) && !pc.scatter) ramSolid = true;
    }
    if (ramSolid && s.invuln <= 0 && !s.atStation && impact > C.obstacleRamMinSpeed) {
      this.damageShip(Math.max(1, Math.min(C.obstacleRamMax, C.obstacleRamDmg + impact * C.obstacleRamSpeedK) * this.shipRamMult(3)));
      sfx("crunch");
    }
  },

  // Push a position-driven entity (x, y; radius er) out of every piece it
  // overlaps, along the piece→entity normal. Velocity-free, so it works for
  // AI-steered ships whose vx/vy is recomputed each frame toward a target: the
  // penetrating normal component is corrected while tangential motion survives,
  // so over frames the entity slides along the hull instead of phasing through.
  _pushOutOfSite(t, ent, er) {
    const k = CONFIG.siteCollK;
    for (const pc of t.pieces) {
      const px = t.x + pc.dx, py = t.y + pc.dy, rr = pc.w * k + er;
      const dx = ent.x - px, dy = ent.y - py, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001, push = rr - d;
      ent.x += dx / d * push; ent.y += dy / d * push;
    }
  },

  /*=== SITE BASE EMPLACEMENTS ==============================================*/
  // A fixed weapon platform bolted to a guarded site's centrepiece. It engages
  // the player inside empRange with a danger-scaled arsenal, every shot honoring
  // line of sight so the site's own heavy chunks are cover. It has its own hull
  // pool, is lockable + destroyable (fireAtEmplacement, player.js), and pays out
  // like an enemy base when it falls. Provoking it wakes the garrison too.

  emplacementById(id) {
    for (const t of (this.state.sites || [])) {
      const e = t.emplacement;
      if (e && e.id === id && !e.destroyed) return e;
    }
    return null;
  },

  _provokeSite(t) {
    if (!t || t.provoked) return;
    t.provoked = true;
    const s = this.state;
    const g0 = (t._ships || []).find(sh => sh.state !== "DEAD" && sh.hp.hull > 0);
    if (g0) ForgeFaction.activateGroup(g0, s.aliens);
  },

  // Per-site emplacement tick (updateSites; d = ship→platform distance).
  _updateEmplacements(t, dt, d) {
    const emp = t.emplacement, s = this.state, C = CONFIG, dtMs = dt * 1000;
    emp.primaryCd = Math.max(0, emp.primaryCd - dtMs);
    emp.torpedoCd = Math.max(0, emp.torpedoCd - dtMs);
    if (emp.beamT > 0) emp.beamT = Math.max(0, emp.beamT - dtMs);
    emp.hp._sinceHit = (emp.hp._sinceHit || 0) + dt;
    const inRange = !s.dead && !s.atStation && d <= C.empRange;
    if (emp.weapon === "laser") this._empLaserTick(t, emp, inRange, dtMs);
    else this._empMissileTick(t, emp, inRange);
    // both armed themes also launch homing torpedo drones on their own timer
    if (inRange && emp.torpedoCd <= 0) {
      this._empLaunchTorpedo(t, emp);
      emp.torpedoCd = C.empTorpedoCdMin + rnd() * (C.empTorpedoCdMax - C.empTorpedoCdMin);
    }
  },

  // Charged laser cannon: a 3s telegraphed lock that fires a near-instant heavy
  // beam. Breaking line of sight (duck behind a chunk) or leaving range during
  // the lock cancels it — that is the whole fight.
  _empLaserTick(t, emp, inRange, dtMs) {
    const s = this.state, C = CONFIG;
    if (emp.locking) {
      if (!inRange || this._losBlocked(emp.x, emp.y, s.x, s.y, t)) {   // dodged out of the kill line
        emp.locking = false; emp.lockT = 0;
        return;
      }
      emp.lockT += dtMs; emp.aimX = s.x; emp.aimY = s.y;   // track the ship through the charge
      if (emp.lockT >= C.empLaserLockMs) {
        emp.locking = false; emp.lockT = 0; emp.primaryCd = C.empLaserCdMs;
        this._empFireBeam(t, emp);
      }
    } else if (inRange && emp.primaryCd <= 0 && !this._losBlocked(emp.x, emp.y, s.x, s.y, t)) {
      emp.locking = true; emp.lockT = 0; emp.aimX = s.x; emp.aimY = s.y;
      this._provokeSite(t);
      AUDIO.play("warning");
      toast("⚠ CANNON LOCK-ON — break line of sight!", "#ff3b3b");
    }
  },

  _empFireBeam(t, emp) {
    const s = this.state, C = CONFIG;
    emp.beamT = C.empLaserBeamMs; emp.beamX = s.x; emp.beamY = s.y;
    AUDIO.play("explosion");
    // fires at the player's live position; only lands if LoS is still clear and
    // they are still in range (they had the full lock window to break it)
    const d = Math.hypot(s.x - emp.x, s.y - emp.y);
    if (d > C.empRange + C.empLaserR || this._losBlocked(emp.x, emp.y, s.x, s.y, t)) {
      toast("beam grazed the rocks — you're clear", "#7fdfff"); return;
    }
    if (s.dead || s.atStation || s.invuln > 0) return;
    s.hp.shield = 0; s.shieldFlash = 0.3;                       // shields instantly gone
    this.damageShip(s.hp.armorMax * C.empLaserArmorFrac);       // + 50% max-armor bite (armor→hull overflow)
    burst(s.x, s.y, "#ff2b2b", 18); AUDIO.play("hit_armor");
    toast("✖ CHARGED BEAM HIT — shields down!", "#ff2b2b");
  },

  // Missile barrage: a cone of dumb-fire missiles — area denial. Held while LoS
  // is blocked so it does not waste a volley into a rock.
  _empMissileTick(t, emp, inRange) {
    const s = this.state, C = CONFIG;
    if (!inRange || emp.primaryCd > 0) return;
    if (this._losBlocked(emp.x, emp.y, s.x, s.y, t)) return;
    emp.primaryCd = C.empMissileCdMin + rnd() * (C.empMissileCdMax - C.empMissileCdMin);
    this._provokeSite(t);
    const n = C.empMissileCount[0] + ((rnd() * (C.empMissileCount[1] - C.empMissileCount[0] + 1)) | 0);
    const base = Math.atan2(s.y - emp.y, s.x - emp.x), spread = C.empMissileSpreadDeg * Math.PI / 180;
    const shots = s.empShots || (s.empShots = []), arm2 = (t.r * 1.08) * (t.r * 1.08);
    for (let i = 0; i < n; i++) {
      const frac = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0;   // spread across the cone (-1..1)
      const a = base + frac * spread;
      shots.push({ kind: "missile", siteId: t.id, x: emp.x, y: emp.y, ox: emp.x, oy: emp.y, arm2, armed: false,
        vx: Math.cos(a) * C.empMissileSpeed, vy: Math.sin(a) * C.empMissileSpeed,
        dmg: emp.missileDmg, life: C.empMissileLife, r: C.empMissileR });
    }
    sfx("boom");
  },

  // Homing torpedo drone: slow, relentless, one-shots a weak ship. Destroyed by
  // any heavy body (lead it into a cluster) and shootable (own hp pool + id).
  _empLaunchTorpedo(t, emp) {
    const s = this.state, C = CONFIG;
    const a = Math.atan2(s.y - emp.y, s.x - emp.x), arm2 = (t.r * 1.08) * (t.r * 1.08);
    const list = s.empTorpedoes || (s.empTorpedoes = []);
    list.push({ kind: "torpedo", id: "tp" + (s.nextTorpedoId++), siteId: t.id,
      x: emp.x, y: emp.y, ox: emp.x, oy: emp.y, arm2, armed: false, angle: a,
      vx: Math.cos(a) * C.empTorpedoSpeed, vy: Math.sin(a) * C.empTorpedoSpeed,
      dmg: emp.torpedoDmg, r: C.empTorpedoR, life: C.empTorpedoLife,
      hp: { shield: 0, shieldMax: 0, armor: 0, armorMax: 0, hull: C.empTorpedoHp, hullMax: C.empTorpedoHp, res: {}, _sinceHit: 99 } });
    this._provokeSite(t);
    AUDIO.play("warning"); toast("◈ TORPEDO INBOUND — lead it into the rocks", "#ff9a3c");
  },

  // Advance all live emplacement projectiles (runs every frame, even while dead,
  // so nothing lingers). Missiles fly straight; torpedoes home. Both arm only
  // after clearing their own site so they never self-detonate on launch.
  _updateEmpProjectiles(dt) {
    const s = this.state, C = CONFIG, dtMs = dt * 1000;
    const hittable = !s.dead && !s.atStation && s.invuln <= 0;
    const ms = s.empShots;
    if (ms) for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dtMs;
      if (!m.armed && (m.x - m.ox) * (m.x - m.ox) + (m.y - m.oy) * (m.y - m.oy) > m.arm2) m.armed = true;
      if (m.life <= 0) { ms.splice(i, 1); continue; }
      if (this._pointInHeavyBody(m.x, m.y, m)) { burst(m.x, m.y, "#ffb08a", 5); ms.splice(i, 1); continue; }
      if (hittable && Math.hypot(s.x - m.x, s.y - m.y) < C.shipR + m.r) {
        this.damageShip(m.dmg); burst(m.x, m.y, "#ff8a5a", 8); ms.splice(i, 1);
      }
    }
    const ts = s.empTorpedoes;
    if (ts) for (let i = ts.length - 1; i >= 0; i--) {
      const tp = ts[i];
      tp.life -= dtMs;
      if (tp.life <= 0 || tp.hp.hull <= 0) {
        if (tp.hp.hull <= 0) { burst(tp.x, tp.y, "#ff5060", 12); sfx("boom"); }
        if (ForgeCombat.getLock().targetId === tp.id) ForgeCombat.clearLock();
        ts.splice(i, 1); continue;
      }
      if (!s.dead) {   // continuous homing toward the player
        let da = Math.atan2(s.y - tp.y, s.x - tp.x) - tp.angle;
        while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        const mt = C.empTorpedoTurn * dt;
        tp.angle += da > mt ? mt : da < -mt ? -mt : da;
      }
      tp.vx = Math.cos(tp.angle) * C.empTorpedoSpeed; tp.vy = Math.sin(tp.angle) * C.empTorpedoSpeed;
      tp.x += tp.vx * dt; tp.y += tp.vy * dt;
      if (!tp.armed && (tp.x - tp.ox) * (tp.x - tp.ox) + (tp.y - tp.oy) * (tp.y - tp.oy) > tp.arm2) tp.armed = true;
      if (this._pointInHeavyBody(tp.x, tp.y, tp)) {   // smashed into terrain — dead
        burst(tp.x, tp.y, "#ff5060", 16); sfx("boom");
        if (ForgeCombat.getLock().targetId === tp.id) ForgeCombat.clearLock();
        ts.splice(i, 1); continue;
      }
      if (hittable && Math.hypot(s.x - tp.x, s.y - tp.y) < C.shipR + tp.r) {   // direct hit — massive
        this.damageShip(tp.dmg); burst(tp.x, tp.y, "#ff2b2b", 22); AUDIO.play("explosion");
        if (ForgeCombat.getLock().targetId === tp.id) ForgeCombat.clearLock();
        ts.splice(i, 1);
      }
    }
  },

  // Segment (x1,y1)-(x2,y2) intersects circle (cx,cy,r)?
  _segCircleHit(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    const a = dx * dx + dy * dy, c = fx * fx + fy * fy - r * r;
    if (a < 1e-6) return c <= 0;
    const b = 2 * (fx * dx + fy * dy);
    let disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    disc = Math.sqrt(disc);
    const t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
  },

  // Is the sightline from (x1,y1) to (x2,y2) blocked by a heavy body? Checks the
  // given site's own chunks (skipping any the origin sits inside — a platform
  // sees out past its own centrepiece) plus every large terrain obstacle.
  _losBlocked(x1, y1, x2, y2, site) {
    const C = CONFIG;
    if (site) for (const pc of site.pieces) {
      const px = site.x + pc.dx, py = site.y + pc.dy, pr = pc.w * C.siteCollK;
      if ((x1 - px) * (x1 - px) + (y1 - py) * (y1 - py) <= pr * pr) continue;
      if (this._segCircleHit(x1, y1, x2, y2, px, py, pr)) return true;
    }
    const obs = this.state.obstacles;
    if (obs) for (const o of obs) if (this._segCircleHit(x1, y1, x2, y2, o.x, o.y, o.r * 0.92)) return true;
    return false;
  },

  // Is a world point buried in a heavy body (site chunk or terrain obstacle)?
  // A projectile skips its own site until armed so it clears the launch tube.
  _pointInHeavyBody(x, y, proj) {
    const C = CONFIG, s = this.state;
    if (s.sites) for (const t of s.sites) {
      if (proj && !proj.armed && t.id === proj.siteId) continue;
      const rr = t.r + 40;
      if ((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y) > rr * rr) continue;
      for (const pc of t.pieces) {
        const px = t.x + pc.dx, py = t.y + pc.dy, pr = pc.w * C.siteCollK;
        if ((x - px) * (x - px) + (y - py) * (y - py) <= pr * pr) return true;
      }
    }
    if (s.obstacles) for (const o of s.obstacles)
      if ((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y) <= (o.r * 0.9) * (o.r * 0.9)) return true;
    return false;
  },

  // Destroy the platform: burst + payout (a danger-scaled bounty and a couple of
  // elite-leaning drops), the reward for clearing a defended site.
  _destroyEmplacement(emp) {
    if (emp.destroyed) return;
    emp.destroyed = true; emp.hp.hull = 0; emp.locking = false; emp.beamT = 0;
    const s = this.state, t = this.siteById(emp.siteId);
    burst(emp.x, emp.y, "#ff5060", 30); burst(emp.x, emp.y, "#ffd27a", 20); burst(emp.x, emp.y, "#ffffff", 12);
    AUDIO.play("explosion"); sfx("boom");
    toast("★ BASE EMPLACEMENT DESTROYED", "#ffb020");
    const dl = t ? (t.dangerLevel || getDangerLevel(emp.x, emp.y)) : getDangerLevel(emp.x, emp.y);
    const bounty = Math.round(600 * dangerLootMult(dl).credits);
    s.loot.push({ x: emp.x + (rnd() - 0.5) * 40, y: emp.y + (rnd() - 0.5) * 40,
                  vx: (rnd() - 0.5) * 24, vy: (rnd() - 0.5) * 24, credits: bounty, t: 0 });
    const pool = Object.keys(ForgeItemSystem.DB.bases), n = 2 + ((rnd() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const it = ForgeItemSystem.generateItem(pool[(rnd() * pool.length) | 0], rollDangerTier(dl, rnd), { rng: rnd });
      s.loot.push({ x: emp.x + (rnd() - 0.5) * 60, y: emp.y + (rnd() - 0.5) * 60,
                    vx: (rnd() - 0.5) * 30, vy: (rnd() - 0.5) * 30, item: it, t: 0 });
    }
    if (ForgeCombat.getLock().targetId === emp.id) ForgeCombat.clearLock();
    this._provokeSite(t);
  },

  // ---- rendering: pieces join the depth-sorted static pass ----------------
  drawSites(g, items, isWorldVisible, z) {
    const s = this.state;
    if (!s.sites) return;
    for (const t of s.sites) {
      if (!isWorldVisible(t.x, t.y, t.r + 300)) continue;
      const def = SITE_DEFS[t.type];
      for (const pc of t.pieces) {
        const p = this.S(t.x + pc.dx, t.y + pc.dy), W = Math.max(12, pc.w * z);
        items.push({ y: p.y, f: () => {
          const rot = pc.spinV ? pc.rot + s.t * pc.spinV : pc.rot;
          if (!ART.draw(g, pc.key, p.x, p.y, W, rot)) {
            // PNG missing/still loading → flat colored stand-in keeps the site
            ART.warnMissing(pc.key, "placeholder rect");
            g.save(); g.translate(p.x, p.y); g.rotate(rot);
            g.globalAlpha = 0.85; g.fillStyle = def.col;
            g.fillRect(-W / 2, -W * 0.35, W, W * 0.7);
            g.globalAlpha = 1; g.restore();
          }
        } });
      }
    }
    // NB: the platform itself is NOT pushed into `items` — it sits at the site
    // anchor, so any chunk with a larger world-y sorts after it and would bury
    // the one thing the player needs to see and shoot. It is drawn in its own
    // pass (drawEmpProjectiles) above the whole static layer instead.
  },

  // The base structure: an angular battery on the centrepiece. Colored by weapon
  // (laser = violet-red, missile = amber). Shows a charge/HP overlay, a pulsing
  // LOCK ring while a laser charges, and the player's lock reticle when targeted.
  _drawEmplacement(g, t, p, z) {
    const emp = t.emplacement, s = this.state;
    const wpnCol = emp.weapon === "laser" ? "#c23bd6" : "#ffae42";
    const W = Math.max(30, 94 * z), R = W * 0.36;
    // The turret art is strict top-down with the muzzle at rot 0 (pointing right)
    // and its base plate recentred on the image pivot (pipeline recenter_pivot),
    // so it can be spun to track the player without the base wandering.
    // The aim angle is measured in SCREEN space — the platform projects through
    // the pitched S() while the ship draws through the flat SF(), so a world-space
    // atan2 would aim slightly off the ship you actually see.
    const shipP = this.SF(s.x, s.y);
    const ang = emp.destroyed ? (emp._aimAng || 0) : Math.atan2(shipP.y - p.y, shipP.x - p.x);
    if (!emp.destroyed) emp._aimAng = ang;   // a dead turret freezes where it died
    if (emp.destroyed) {
      g.save(); g.globalAlpha = 0.3;
      if (!ART.draw(g, emp.art, p.x, p.y, W, ang)) {
        g.translate(p.x, p.y); g.fillStyle = "#3a2630"; this._empBattery(g, R);
      }
      g.globalAlpha = 1; g.restore();
      return;
    }
    if (!ART.draw(g, emp.art, p.x, p.y, W, ang)) {
      ART.warnMissing(emp.art, "procedural battery");
      g.save(); g.translate(p.x, p.y);
      g.fillStyle = "#20141c"; this._empBattery(g, R * 1.15);
      g.fillStyle = hexA(wpnCol, 0.9); this._empBattery(g, R);
      g.strokeStyle = hexA(wpnCol, 0.9); g.lineWidth = Math.max(1, 1.6 * z);
      this._empBattery(g, R, true);
      g.rotate(ang); g.fillStyle = "#12060c";                 // barrel tracks the ship
      g.fillRect(0, -R * 0.22, R * 1.5, R * 0.44);
      g.fillStyle = emp.locking ? "#ff3b3b" : hexA(wpnCol, 0.8);
      g.fillRect(R * 1.1, -R * 0.16, R * 0.5, R * 0.32);
      g.restore();
    }
    // laser lock telegraph: pulsing red ring that fills as the charge completes
    if (emp.locking) {
      const frac = Math.min(1, emp.lockT / CONFIG.empLaserLockMs);
      const pr = R + 6 + Math.sin(s.t * 16) * 3;
      g.strokeStyle = "#ff2b2b"; g.lineWidth = Math.max(1.5, 2.5 * z);
      g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(s.t * 10));
      g.beginPath(); g.arc(p.x, p.y, pr, 0, TAU); g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = "#ffd24a"; g.lineWidth = Math.max(2, 3 * z);
      g.beginPath(); g.arc(p.x, p.y, pr, -Math.PI / 2, -Math.PI / 2 + frac * TAU); g.stroke();
      g.lineWidth = 1;
    }
    if (ForgeCombat.getLock().targetId === emp.id) this.drawSelectRing(g, p, (R + 8), "#ff8a3c", z);
    if (z > 0.3) {   // HP bar + tag
      const dmgd = emp.hp.hull < emp.hp.hullMax || emp.hp.armor < emp.hp.armorMax;
      if (dmgd) {
        const bw = Math.max(28, R * 2), by = p.y - R * 1.5 - 8;
        g.fillStyle = "#1c2430"; g.fillRect(p.x - bw / 2, by, bw, 4);
        g.fillStyle = "#ff5060"; g.fillRect(p.x - bw / 2, by, bw * Math.max(0, emp.hp.hull / emp.hp.hullMax), 4);
        if (emp.hp.armorMax > 0) { g.fillStyle = hexA("#ffb020", 0.9);
          g.fillRect(p.x - bw / 2, by - 3, bw * Math.max(0, emp.hp.armor / emp.hp.armorMax), 2); }
      }
      g.font = `bold ${Math.max(8, 9 * z) | 0}px monospace`; g.textAlign = "center";
      g.fillStyle = wpnCol;
      g.fillText(emp.weapon === "laser" ? "⚡ ION CANNON" : "❖ MISSILE BATTERY", p.x, p.y - R * 1.5 - 12);
      g.textAlign = "left";
    }
  },
  _empBattery(g, r, stroke) {   // 6-sided battery silhouette centered at origin
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.26, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.closePath(); stroke ? g.stroke() : g.fill();
  },

  // Flat (SF) pass for emplacement projectiles + beams — drawn with the ship /
  // combat layer so tracers line up with the ship they target. Called from draw().
  drawEmpProjectiles(g) {
    if (HEADLESS) return;
    const s = this.state, z = s.cam.zoom;
    // base platforms first, on the pitched plane with their host chunks but above
    // the whole static layer so a chunk in front can never bury the target
    if (s.sites) for (const t of s.sites) {
      if (!t.emplacement) continue;
      const p = this.S(t.emplacement.x, t.emplacement.y);
      if (p.x < -120 || p.x > CONFIG.W + 120 || p.y < -120 || p.y > CONFIG.H + 120) continue;
      this._drawEmplacement(g, t, p, z);
    }
    // charged-laser beams (bright thick flash, fades over beamT)
    if (s.sites) for (const t of s.sites) {
      const emp = t.emplacement;
      if (!emp || emp.beamT <= 0) continue;
      const a = this.SF(emp.x, emp.y), b = this.SF(emp.beamX, emp.beamY);
      const al = Math.min(1, emp.beamT / CONFIG.empLaserBeamMs);
      g.strokeStyle = hexA("#ff3bd0", al); g.lineWidth = Math.max(3, 7 * z);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = hexA("#ffffff", al); g.lineWidth = Math.max(1, 2.5 * z);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.lineWidth = 1;
    }
    // missiles: small amber darts with a stub trail
    if (s.empShots) for (const m of s.empShots) {
      const p = this.SF(m.x, m.y), tr = this.SF(m.x - m.vx * 0.04, m.y - m.vy * 0.04);
      g.strokeStyle = hexA("#ff8a3c", 0.7); g.lineWidth = Math.max(1, 2 * z);
      g.beginPath(); g.moveTo(tr.x, tr.y); g.lineTo(p.x, p.y); g.stroke();
      g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(p.x, p.y, Math.max(2, 3 * z), 0, TAU); g.fill();
    }
    // torpedoes: unmistakable glowing red drone + long trail
    if (s.empTorpedoes) for (const tp of s.empTorpedoes) {
      const p = this.SF(tp.x, tp.y), tr = this.SF(tp.x - tp.vx * 0.06, tp.y - tp.vy * 0.06);
      const grd = g.createLinearGradient(tr.x, tr.y, p.x, p.y);
      grd.addColorStop(0, "rgba(255,40,60,0)"); grd.addColorStop(1, "rgba(255,80,90,0.85)");
      g.strokeStyle = grd; g.lineWidth = Math.max(2, 4 * z);
      g.beginPath(); g.moveTo(tr.x, tr.y); g.lineTo(p.x, p.y); g.stroke();
      const rr = Math.max(3, tp.r * z);
      const gl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr * 2.2);
      gl.addColorStop(0, "rgba(255,90,96,0.95)"); gl.addColorStop(1, "rgba(255,90,96,0)");
      g.fillStyle = gl; g.beginPath(); g.arc(p.x, p.y, rr * 2.2, 0, TAU); g.fill();
      g.fillStyle = "#ff2b2b"; g.beginPath(); g.arc(p.x, p.y, rr, 0, TAU); g.fill();
      if (ForgeCombat.getLock().targetId === tp.id) this.drawSelectRing(g, p, rr + 6, "#ff8a3c", z);
      g.lineWidth = 1;
    }
  },

  // Screen-space klaxon while any nearby platform charges its laser, plus a live
  // count of inbound torpedoes — the "unmissable" LOCKED-ON warning.
  drawEmpAlert(g) {
    if (HEADLESS) return;
    const s = this.state, C = CONFIG, W = CONFIG.W;
    let locking = null;
    if (s.sites) for (const t of s.sites) {
      const emp = t.emplacement;
      if (emp && !emp.destroyed && emp.locking) { locking = emp; break; }
    }
    const torps = (s.empTorpedoes || []).length;
    if (!locking && !torps) return;
    const H = CONFIG.H, k = Math.min(W / 390, H / 700);
    // Vertical placement is a FRACTION of height, not k-scaled: the toast stack and
    // the trader/route alert lines own the k-scaled band up top, and this has to
    // stay clear of them at every aspect ratio.
    let y = H * 0.30;
    g.save(); g.textAlign = "center";
    if (locking) {
      const frac = Math.min(1, locking.lockT / C.empLaserLockMs);
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(s.t * 12));
      g.fillStyle = hexA("#ff2b2b", 0.16 * pulse);   // edge wash — unmissable in peripheral vision
      g.fillRect(0, 0, W, 10 * k); g.fillRect(0, H - 10 * k, W, 10 * k);
      g.fillStyle = "rgba(5,7,13,0.55)"; g.fillRect(0, y - 13 * k, W, 26 * k);
      g.fillStyle = hexA("#ff3b3b", pulse); g.font = `bold ${13 * k | 0}px monospace`;
      g.fillText("⚠ LOCKED ON — BREAK LINE OF SIGHT", W / 2, y);
      g.fillStyle = "#1c2430"; g.fillRect(W / 2 - 70 * k, y + 6 * k, 140 * k, 5 * k);
      g.fillStyle = "#ff2b2b"; g.fillRect(W / 2 - 70 * k, y + 6 * k, 140 * k * frac, 5 * k);
      y += 26 * k;
    }
    if (torps) {
      g.fillStyle = hexA("#ff9a3c", 0.5 + 0.5 * Math.abs(Math.sin(s.t * 8)));
      g.font = `bold ${11 * k | 0}px monospace`;
      g.fillText("◈ " + torps + " TORPEDO" + (torps > 1 ? "ES" : "") + " INBOUND", W / 2, y);
    }
    g.textAlign = "left"; g.restore();
  },

  // ---- selfTest (build.py --check wires this in) --------------------------
  sitesSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;
      check(Array.isArray(s.sites) && s.sites.length > 0, "no sites seeded");

      // 1. every outpost has ≥1 neighbouring region with a site
      for (const o of s.outposts) {
        const reg = this.regionGet(o.regionId);
        let ok = false;
        for (let dr = -1; dr <= 1 && !ok; dr++) for (let dc = -1; dc <= 1 && !ok; dc++) {
          if (!dr && !dc) continue;
          const nb = this.regionByColRow(reg.col + dc, reg.row + dr);
          if (nb && nb.site) ok = true;
        }
        check(ok, "outpost " + o.id + " has no neighbouring site");
      }

      // 2. region ownership is mutually exclusive, and back-links are sound
      for (const r of s.regions)
        check(!(r.outpostId && r.site), "region R-" + r.id + " holds both an outpost and a site");
      const seenRegion = new Set();
      for (const t of s.sites) {
        const r = this.regionGet(t.regionId);
        check(!!r && r.site === t, t.id + " region back-link broken (R-" + t.regionId + ")");
        check(!seenRegion.has(t.regionId), "two sites share region R-" + t.regionId);
        seenRegion.add(t.regionId);
      }

      // 3. all three themes exist somewhere on the map
      for (const ty of SITE_TYPE_ORDER)
        check(s.sites.some(t => t.type === ty), "no '" + ty + "' site spawned");

      // 4. composition: 3-5 theme pieces + 2-4 scatter, 1-3 defenders, known keys
      for (const t of s.sites) {
        const def = SITE_DEFS[t.type];
        const themed = t.pieces.filter(p => !p.scatter), scatter = t.pieces.filter(p => p.scatter);
        check(themed.length >= 3 && themed.length <= 5, t.id + " has " + themed.length + " theme pieces");
        check(scatter.length >= 2 && scatter.length <= 4, t.id + " has " + scatter.length + " scatter pieces");
        check(t.guardRecs.length >= 1 && t.guardRecs.length <= 3, t.id + " has " + t.guardRecs.length + " defenders");
        for (const p of themed) check(def.pieceKeys.includes(p.key), t.id + " off-theme piece '" + p.key + "'");
      }

      // 5. garrison streaming: approach → real ships in s.aliens; leave → recs
      const t0 = s.sites[0];
      s.x = t0.x + t0.r + 200; s.y = t0.y; s.vx = s.vy = 0;
      this.update(1 / 60);
      check(t0.streamed === true, "guards must stream in on approach");
      const alive = t0.guardRecs.filter(r => r.alive).length;
      check(t0._ships.length === alive, "streamed " + t0._ships.length + " ships for " + alive + " live recs");
      check(t0._ships.every(sh => s.aliens.includes(sh)), "streamed guards must live in s.aliens");
      s.x = t0.x + CONFIG.outpostGuardStreamR + 4000; this.update(1 / 60);
      check(t0.streamed === false, "guards must stream out after leaving");
      check(!s.aliens.some(a => a._siteId === t0.id), "streamed-out guards must leave s.aliens");

      // 6. solid pieces: a ship overlapping a chunk is pushed clear (rigid body),
      //    and a fast ram into a substantial theme piece deals damage
      this.init();
      const sc = this.state, site = sc.sites[0], p0 = site.pieces.find(p => !p.scatter);
      const pcx = site.x + p0.dx, pcy = site.y + p0.dy, pr = p0.w * CONFIG.siteCollK;
      sc.aliens = []; sc.atStation = false;
      sc.x = pcx - 2; sc.y = pcy; sc.vx = 220; sc.vy = 0; sc.invuln = 0;   // overlapping, closing fast
      const preSh = sc.hp.shield;
      this._collideSite(site);
      check(this.dist(sc.x, sc.y, pcx, pcy) >= pr + CONFIG.shipR - 1, "ship must be pushed clear of a solid site piece");
      check(sc.hp.shield < preSh, "a fast ram into a site piece should deal damage");

      // 7. enemies: an alien whose AI drove it into a piece is pushed back out to
      //    the hull surface (position-only depenetration — no velocity needed)
      const foe = { x: pcx + 1, y: pcy, r: 16, state: "IDLE" };   // buried in the centrepiece
      this._pushOutOfSite(site, foe, foe.r);
      check(this.dist(foe.x, foe.y, pcx, pcy) >= pr + foe.r - 0.5, "enemy must be pushed clear of a site piece");

      // 8. base emplacements: RARE, and only on the two guarded themes. Most
      //    guarded sites are just a garrison fleet — a fortified one is the exception.
      this.init();
      const se = this.state;
      const laserSite = se.sites.find(t => t.type === "alien_derelict" && t.emplacement);
      const missileSite = se.sites.find(t => t.type === "shipwreck" && t.emplacement);
      check(laserSite && laserSite.emplacement.weapon === "laser", "some alien_derelict must mount a laser cannon");
      check(missileSite && missileSite.emplacement.weapon === "missile", "some shipwreck must mount a missile battery");
      check(!se.sites.some(t => t.type === "asteroid_cluster" && t.emplacement), "resource clusters must never be armed");
      check(laserSite.emplacement.hp.hullMax > 0 && laserSite.emplacement.hp.armorMax > 0, "emplacement must have an armor+hull pool");

      // rarity: a clear minority of eligible sites, and biased to dangerous space
      const eligible = se.sites.filter(t => CONFIG.empThemeWeapon[t.type]);
      const armed = se.sites.filter(t => t.emplacement);
      const frac = armed.length / Math.max(1, eligible.length);
      check(frac > 0.02 && frac < 0.45,
        "fortified sites must stay a minority of eligible sites, got " +
        (frac * 100).toFixed(0) + "% (" + armed.length + "/" + eligible.length + ")");
      const mean = list => list.reduce((a, t) => a + (t.dangerLevel || 1), 0) / Math.max(1, list.length);
      const dArmed = mean(armed), dPlain = mean(eligible.filter(t => !t.emplacement));
      check(dArmed > dPlain + 0.5,
        "fortification must skew to dangerous wedges (armed avg danger " +
        dArmed.toFixed(2) + " vs plain " + dPlain.toFixed(2) + ")");
      check(!armed.some(t => (t.dangerLevel || 1) <= 1), "the safest wedge must never fortify");

      // clay art: valid key, both looks per weapon in play, and stable across inits
      check(armed.every(t => /^emp_(laser|missile)_[ab]$/.test(t.emplacement.art)),
        "every emplacement must carry a valid clay art key");
      check(armed.every(t => t.emplacement.art.startsWith("emp_" + t.emplacement.weapon)),
        "art key must match the platform's weapon type");
      const looks = new Set(armed.map(t => t.emplacement.art));
      check(looks.size === 4, "both looks of both weapons should appear across the map, got " + [...looks].sort().join(","));
      const artSig = t => armed.slice(0, 8).map(x => x.id + ":" + x.emplacement.art).join("|");
      const sigBefore = artSig();
      this.init();
      const armed2 = this.state.sites.filter(t => t.emplacement);
      check(armed2.slice(0, 8).map(x => x.id + ":" + x.emplacement.art).join("|") === sigBefore,
        "emplacement art must be deterministic across inits (hashed off the region)");

      // line of sight: a chunk on the line blocks; a clear lane doesn't
      const stub = { x: 0, y: 0, pieces: [{ dx: 300, dy: 0, w: 200, scatter: false }] };
      se.obstacles = [];
      check(this._losBlocked(-100, 0, 500, 0, stub) === true, "a chunk on the sightline blocks LoS");
      check(this._losBlocked(-100, 0, -100, 900, stub) === false, "a clear lane is not blocked");

      // charged laser: enters range with clear LoS → begins locking; break LoS → cancel;
      // full charge → beam fires, drops shields to 0, chews armor, goes on cooldown
      this.init();
      const sl = this.state, lst = sl.sites.find(t => t.type === "alien_derelict" && t.emplacement), le = lst.emplacement;
      sl.obstacles = []; sl.aliens = []; sl.atStation = false; sl.dead = false; sl.invuln = 0;
      lst.pieces = lst.pieces.slice(0, 1); lst._avoidCircles = null;   // keep only the (skipped) centrepiece → clear LoS
      sl.x = le.x + 400; sl.y = le.y; sl.vx = sl.vy = 0;
      le.primaryCd = 0; le.locking = false; le.lockT = 0; le.beamT = 0;
      this._updateEmplacements(lst, 1 / 60, 400);
      check(le.locking === true, "laser must begin locking on a clear in-range shot");
      lst.pieces.push({ dx: 200, dy: 0, w: 400, scatter: false }); lst._avoidCircles = null;   // block the line
      this._updateEmplacements(lst, 1 / 60, 400);
      check(le.locking === false, "breaking line of sight must cancel the lock");
      lst.pieces = lst.pieces.slice(0, 1); lst._avoidCircles = null;
      le.primaryCd = 0; le.locking = false; le.lockT = 0; le.torpedoCd = 9e9;
      sl.hp.shield = sl.hp.shieldMax; sl.hp.armor = sl.hp.armorMax;
      let beamed = false;
      for (let k = 0; k < 220 && !beamed; k++) { this._updateEmplacements(lst, 1 / 60, 400); if (le.beamT > 0) beamed = true; }
      check(beamed, "laser must fire a beam after the lock window");
      check(sl.hp.shield === 0, "beam must drop shields to zero");
      check(sl.hp.armor < sl.hp.armorMax, "beam must deal armor damage");
      check(le.primaryCd > 0, "laser must go on cooldown after firing");

      // missile barrage: a clear in-range shot launches a cone volley
      this.init();
      const sm = this.state, mst = sm.sites.find(t => t.type === "shipwreck" && t.emplacement), me = mst.emplacement;
      sm.obstacles = []; sm.empShots = []; sm.dead = false; sm.atStation = false;
      mst.pieces = mst.pieces.slice(0, 1); mst._avoidCircles = null;
      sm.x = me.x + 400; sm.y = me.y; me.primaryCd = 0; me.torpedoCd = 9e9;
      this._updateEmplacements(mst, 1 / 60, 400);
      check(sm.empShots.length >= CONFIG.empMissileCount[0], "missile barrage must launch a volley");
      check(sm.empShots.every(m => m.siteId === mst.id && m.dmg > 0), "each missile is tagged + damaging");

      // torpedo drone: launches, homes toward the player, dies on terrain, is shootable
      this.init();
      const st = this.state, tst = st.sites.find(t => t.type === "alien_derelict" && t.emplacement), te = tst.emplacement;
      st.obstacles = []; st.empTorpedoes = []; st.dead = false; st.atStation = false; st.invuln = 0;
      st.x = te.x + 400; st.y = te.y; te.torpedoCd = 0;
      this._updateEmplacements(tst, 1 / 60, 400);
      check(st.empTorpedoes.length === 1, "emplacement must launch a homing torpedo");
      const tp = st.empTorpedoes[0];
      const angDiff = (a, b) => { let dd = (a - b) % TAU; if (dd > Math.PI) dd -= TAU; if (dd < -Math.PI) dd += TAU; return Math.abs(dd); };
      st.x = te.x; st.y = te.y + 500;   // player now off to the side
      const d1 = angDiff(tp.angle, Math.atan2(st.y - tp.y, st.x - tp.x));
      this._updateEmpProjectiles(1 / 60);
      const d2 = angDiff(tp.angle, Math.atan2(st.y - tp.y, st.x - tp.x));
      check(d2 <= d1 + 1e-6, "torpedo must turn toward the player each frame");
      // destroyed on contact with a heavy body
      st.sites = []; st.obstacles = [{ x: 0, y: 0, r: 300 }]; st.dead = true;
      st.empTorpedoes = [{ kind: "torpedo", id: "tpTerr", siteId: "none", x: 0, y: 0, ox: -9e9, oy: 0, arm2: 1, armed: true,
        angle: 0, vx: 0, vy: 0, dmg: 10, r: 14, life: 5000, hp: { shield: 0, armor: 0, hull: 14, hullMax: 14, res: {} } }];
      this._updateEmpProjectiles(1 / 60);
      check(st.empTorpedoes.length === 0, "a torpedo must be destroyed by a heavy body");
      // shot down (hull to 0)
      st.sites = []; st.obstacles = [];
      st.empTorpedoes = [{ kind: "torpedo", id: "tpShot", siteId: "none", x: 9e9, y: 0, ox: 9e9, oy: 0, arm2: 1, armed: true,
        angle: 0, vx: 0, vy: 0, dmg: 10, r: 14, life: 5000, hp: { shield: 0, armor: 0, hull: 0, hullMax: 14, res: {} } }];
      this._updateEmpProjectiles(1 / 60);
      check(st.empTorpedoes.length === 0, "a torpedo shot to 0 hull is destroyed");

      // destruction pays out (bounty + drops)
      this.init();
      const sd = this.state, dst = sd.sites.find(t => t.emplacement), de = dst.emplacement;
      sd.loot = []; de.hp.hull = 0;
      this._destroyEmplacement(de);
      check(de.destroyed === true, "emplacement must flip to destroyed at 0 hull");
      check(sd.loot.length > 0, "destroying an emplacement must drop loot/credits");
      check(this.emplacementById(de.id) === null, "a destroyed emplacement is no longer a combat target");

      // save round-trip: emplacement wear + fate persist
      this.init();
      const sv = this.state, vst = sv.sites.find(t => t.emplacement), ve = vst.emplacement;
      ve.hp.hull = ve.hp.hullMax * 0.5; ve.hp.armor = 0;
      const blob = JSON.parse(JSON.stringify(this.serializeGame()));
      this.init(); this.applySaveData(blob);
      const rest = this.siteById(vst.id).emplacement;
      check(Math.abs(rest.hp.hull - ve.hp.hullMax * 0.5) < 1 && rest.hp.armor === 0, "emplacement damage must survive a save round-trip");

      // 9. flank avoidance: an alien tagged with a chunk to route around has its
      //    pursuit velocity deflected off the straight line to the player
      const al = { x: 200, y: 0, vx: 0, vy: 0, angle: 0, state: "COMBAT", speed: 1,
        orbitRadius: 0, preferredRange: 200, retreatHull: 0, _fireCd: 0, _fireCdMax: 1000,
        hp: { shield: 0, shieldMax: 0, armor: 0, armorMax: 0, hull: 100, hullMax: 100 },
        _avoid: [{ x: 300, y: 0, r: 120 }] };   // chunk dead ahead on the path to (1000,0)
      ForgeFaction.updateAlienAI(al, { x: 1000, y: 0 }, [al], 1 / 60);
      check(Math.abs(al.vy) > 1, "avoidance must deflect pursuit off the straight line");
      const al2 = { x: 200, y: 0, vx: 0, vy: 0, angle: 0, state: "COMBAT", speed: 1,
        orbitRadius: 0, preferredRange: 200, retreatHull: 0, _fireCd: 0, _fireCdMax: 1000,
        hp: { shield: 0, shieldMax: 0, armor: 0, armorMax: 0, hull: 100, hullMax: 100 } };   // no _avoid
      ForgeFaction.updateAlienAI(al2, { x: 1000, y: 0 }, [al2], 1 / 60);
      check(Math.abs(al2.vy) < 1e-6, "no _avoid → pursuit is unchanged (straight line)");

      // 10. cover shakes pursuit: sight blocked AT RANGE for guardLoseSightT drops a
      //     guard back to dormant; clear sight, or a close hug, keeps it hunting
      const sg = this.state;
      const stubSite = { id: "stubSite", x: 0, y: 0, pieces: [{ dx: 0, dy: 0, w: 500, scatter: false }] };
      sg.obstacles = [];
      const mkGuard = (x, y) => ({ _siteId: "stubSite", state: "COMBAT", aggro: true, x, y, r: 15 });
      const gFar = mkGuard(-900, 0);
      sg.x = 900; sg.y = 0;   // player on the far side of the chunk, well out of reach
      check(this._losBlocked(gFar.x, gFar.y, sg.x, sg.y, stubSite) === true, "a chunk between guard and player blocks sight");
      for (let k = 0; k < 4 * 60; k++) this._guardSightCheck(stubSite, gFar, 1 / 60);
      check(gFar.state === "IDLE" && !gFar.aggro, "losing sight at range must break pursuit");
      const gSee = mkGuard(900, 400);   // clear lane to the player
      for (let k = 0; k < 4 * 60; k++) this._guardSightCheck(stubSite, gSee, 1 / 60);
      check(gSee.state === "COMBAT", "a guard with clear sight keeps pursuing");
      const gNear = mkGuard(-300, 0);
      sg.x = 300; sg.y = 0;   // blocked, but only 600 apart — too close to shake
      for (let k = 0; k < 4 * 60; k++) this._guardSightCheck(stubSite, gNear, 1 / 60);
      check(gNear.state === "COMBAT", "hugging a chunk at close range must not shake pursuit");

      this.init();   // leave a clean world behind (the walk moved the ship)
    } catch (e) {
      fails.push("FAIL: sitesSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
