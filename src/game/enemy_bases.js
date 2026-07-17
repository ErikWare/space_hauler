/*=== HARNESS:ENEMY_BASES ====================================================*/
// Phase 1 enemy bases: 2–3 permanent hostile stations in distant sectors. Each
// has a faction, spawns a patrol group (1 elite + 2 normals via ForgeFaction)
// on its own 45–90s timer, and can be locked + destroyed with player weapons
// (ForgeCombat.applyDamage path) for a 3–5 Elite-item payout.
SPRITES.define("enemy_base", { w: 200, h: 200, brief: "hostile base, dark red angular station",
  bake(g) {
    const cx = 100, cy = 100, spikes = 8;
    g.save(); g.translate(cx, cy);
    g.fillStyle = "#2a0d12";
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = i / (spikes * 2) * TAU, r = i % 2 === 0 ? 88 : 46;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
    g.strokeStyle = "#7a1f28"; g.lineWidth = 3; g.stroke();
    const grd = g.createRadialGradient(-14, -14, 6, 0, 0, 46);
    grd.addColorStop(0, "#8c2833"); grd.addColorStop(0.6, "#571620"); grd.addColorStop(1, "#20080c");
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i < spikes; i++) { const a = i / spikes * TAU + 0.39;
      const x = Math.cos(a) * 46, y = Math.sin(a) * 46;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.closePath(); g.fill();
    g.strokeStyle = "#a03040"; g.lineWidth = 2; g.stroke();
    const eye = g.createRadialGradient(0, 0, 1, 0, 0, 18);
    eye.addColorStop(0, "rgba(255,90,96,0.95)"); eye.addColorStop(1, "rgba(255,90,96,0)");
    g.fillStyle = eye; g.beginPath(); g.arc(0, 0, 18, 0, TAU); g.fill();
    g.fillStyle = "#ff5060"; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
    g.fillStyle = "#d8404e";
    for (let i = 0; i < spikes; i++) { const a = i / spikes * TAU;
      g.beginPath(); g.arc(Math.cos(a) * 74, Math.sin(a) * 74, 3, 0, TAU); g.fill(); }
    g.restore();
  },
});

Object.assign(GAME, {
  // 2–3 bases at 3500–5500 from origin, ≥1500 from every station and each other.
  makeEnemyBases() {
    const stations = ForgeWorld.getStations(), bases = [];
    const n = CONFIG.enemyBaseMin + ((rnd() * (CONFIG.enemyBaseMax - CONFIG.enemyBaseMin + 1)) | 0);
    for (let i = 0; i < n; i++) {
      let pos = null;
      for (let tries = 0; tries < 300 && !pos; tries++) {
        const a = rnd() * TAU, d = CONFIG.enemyBaseRMin + rnd() * (CONFIG.enemyBaseRMax - CONFIG.enemyBaseRMin);
        const p = { x: Math.cos(a) * d, y: Math.sin(a) * d };
        if (stations.every(st => this.dist(p.x, p.y, st.pos.x, st.pos.y) >= CONFIG.enemyBaseGap) &&
            bases.every(b => this.dist(p.x, p.y, b.x, b.y) >= CONFIG.enemyBaseGap)) pos = p;
      }
      if (!pos) continue;
      const hp = CONFIG.enemyBaseHp;
      bases.push({
        id: "base_" + i, kind: "enemyBase", x: pos.x, y: pos.y, r: CONFIG.enemyBaseR,
        faction: CONFIG.factions[(rnd() * CONFIG.factions.length) | 0],
        hp: { shield: 0, shieldMax: 0, armor: 0, armorMax: 0, hull: hp, hullMax: hp,
              res: { shield: 0, armor: 0, hull: 0 }, _sinceHit: 99 },
        maxHp: hp,
        spawnCooldown: CONFIG.enemyBaseSpawnMin + rnd() * (CONFIG.enemyBaseSpawnMax - CONFIG.enemyBaseSpawnMin),
        spawnTimer: 0, destroyed: false,
      });
      bases[bases.length - 1].spawnTimer = bases[bases.length - 1].spawnCooldown;
    }
    return bases;
  },

  findCombatTarget(id) {
    if (id == null) return null;
    const s = this.state;
    return s.aliens.find(a => a.id === id && a.state !== "DEAD")
        || s.enemyBases.find(b => b.id === id && !b.destroyed)
        || (s.outposts || []).find(o => o.id === id && o.owner !== "player")
        || s.rocks.find(r => r.active && r.id === id) || null;
  },
  baseAlienCount(baseId) {
    let n = 0;
    for (const a of this.state.aliens) if (a._baseId === baseId && a.state !== "DEAD") n++;
    return n;
  },
  spawnBasePatrol(b) {   // 1 elite leader + 2 normals, tagged to the base
    const s = this.state;
    const pos = { x: b.x + (rnd() - 0.5) * 300, y: b.y + (rnd() - 0.5) * 300 };
    const grp = ForgeFaction.generateGroup(b.faction, pos, { rng: rnd, leaderTier: "elite", followerCount: 2 });
    const dl = getDangerLevel(b.x, b.y);   // patrol strength follows the base's wedge
    grp.leader._baseId = b.id;
    s.aliens.push(applyDangerToShip(grp.leader, dl));
    for (const f of grp.followers) { f._baseId = b.id; s.aliens.push(applyDangerToShip(f, dl)); }
    return grp;
  },
  updateEnemyBases(dt) {
    const s = this.state;
    for (const b of s.enemyBases) {
      if (b.destroyed) continue;
      if (b.hp.hull <= 0) { this.onEnemyBaseDestroyed(b); continue; }
      b.spawnTimer -= dt;
      if (b.spawnTimer <= 0) {
        b.spawnTimer = b.spawnCooldown;
        if (this.baseAlienCount(b.id) < CONFIG.enemyBasePatrolCap) this.spawnBasePatrol(b);
      }
    }
  },
  onEnemyBaseDestroyed(b) {
    if (b.destroyed) return;
    b.destroyed = true; b.hp.hull = 0;
    const s = this.state;
    burst(b.x, b.y, "#ff5060", 30); burst(b.x, b.y, "#ffd27a", 20); burst(b.x, b.y, "#ffffff", 12);
    sfx("boom");
    toast("ENEMY BASE DESTROYED", "#ffb020");
    const pool = Object.keys(ForgeItemSystem.DB.bases);
    const n = CONFIG.enemyBaseDropMin + ((rnd() * (CONFIG.enemyBaseDropMax - CONFIG.enemyBaseDropMin + 1)) | 0);
    for (let k = 0; k < n; k++) {
      const it = ForgeItemSystem.generateItem(pool[(rnd() * pool.length) | 0], "elite", { rng: rnd });
      s.loot.push({ x: b.x + (rnd() - 0.5) * 80, y: b.y + (rnd() - 0.5) * 80,
                    vx: (rnd() - 0.5) * 30, vy: (rnd() - 0.5) * 30, item: it, t: 0 });
    }
    if (ForgeCombat.getLock().targetId === b.id) ForgeCombat.clearLock();
  },

  // ---- drawing (world sprite via the pitched S(); called from the depth-sorted pass) ----
  drawEnemyBase(g, b, pt, z) {
    const s = this.state, P = CONFIG.pitch;
    if (b.destroyed) {   // burnt-out wreck: dim, no ring, no bar
      g.globalAlpha = 0.35;
      SPRITES.draw(g, "enemy_base", pt.x, pt.y, b.r * 2.4 / 200 * z, 0.4);
      g.globalAlpha = 1;
      return;
    }
    const fcol = (ForgeFaction.FACTIONS[b.faction] || {}).color || "#ff5060";
    g.strokeStyle = hexA(fcol, Math.min(0.8, 0.35 + Math.sin(s.t * 2.5) * 0.15));
    g.lineWidth = Math.max(1, 2.5 * z);
    if (g.setLineDash) g.setLineDash([8 * z, 6 * z]);
    g.beginPath(); g.ellipse(pt.x, pt.y, b.r * 1.7 * z, b.r * 1.7 * z * P, 0, 0, TAU); g.stroke();
    if (g.setLineDash) g.setLineDash([]);
    SPRITES.draw(g, "enemy_base", pt.x, pt.y, b.r * 2.4 / 200 * z, s.t * 0.05);
    if (ForgeCombat.getLock().targetId === b.id)
      this.drawSelectRing(g, pt, (b.r + 10) * z, "#ff8a3c", z);
    if (z > 0.35) {   // HP bar + tag, visible when zoomed in
      const bw = Math.max(30, b.r * 1.6 * z), by = pt.y - b.r * 1.3 * z - 10;
      g.fillStyle = "#1c2430"; g.fillRect(pt.x - bw / 2, by, bw, 4);
      g.fillStyle = "#ff5060"; g.fillRect(pt.x - bw / 2, by, bw * Math.max(0, b.hp.hull / b.hp.hullMax), 4);
      g.font = `bold ${Math.max(8, 10 * z) | 0}px monospace`; g.textAlign = "center";
      g.fillStyle = fcol; g.fillText("⛔ " + b.faction.toUpperCase() + " BASE", pt.x, by - 4);
      g.textAlign = "left";
    }
  },

  // Red hostile triangles on the minimap disc. ForgeHUD owns the minimap render
  // (module untouched), so this overlays the same disc geometry after drawHUD.
  drawEnemyBasesMinimap(g) {
    if (HEADLESS) return;
    const s = this.state, k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const range = (s.derived && s.derived.scanRange) || 1000, kMap = R / range;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    for (const b of s.enemyBases) {
      if (b.destroyed) continue;
      const dx = (b.x - s.x) * kMap, dy = (b.y - s.y) * kMap;
      if (dx * dx + dy * dy > (R - 4 * k) * (R - 4 * k)) continue;   // hostile signal only in scan range
      const px = cx + dx, py = cy + dy, t = 4 * k;
      g.fillStyle = "#ff5060";
      g.beginPath(); g.moveTo(px, py - t); g.lineTo(px + t, py + t); g.lineTo(px - t, py + t);
      g.closePath(); g.fill();
    }
    g.restore();
  },
});
