/*=== HARNESS:NPC_TRADERS ====================================================*/
// Phase 6 — NPC traders. Civilian cargo wedges spawned at world init that loop
// forever between station pairs on the drone progress math (fromX/Y → toX/Y).
// Un-aggro'd pirates near a route may break off and raid them ("save the
// convoy" — kill the raiders while the trader lives for a bonus); the player
// can raid them too (tap to mark, weapon auto-fires — piracy costs station
// rep). Death spills a credit orb + the ore cargo as loot (player.js
// updateLoot banks both kinds). Flat hp/shield struct like Phase 3 drones —
// no Forge hp block, so damage is the applyDamage soak pattern game-side.
const NPC_TRADERS = {
  countMin: 3, countMax: 6,
  speed: 60,                   // world units/sec along the route
  hp: 60, shield: 40,
  creditsMin: 50, creditsMax: 200,   // rolled at spawn, dropped on death
  cargoTypes: ["copper", "silver", "gold", "platinum"],
  pirateRange: 400,            // un-engaged alien within this may turn pirate
  pirateChance: 0.05,          // per-second roll for that alien to raid
  raidRange: 500, raidEvery: 1.2,    // engaged raider re-attack cadence
  alertRange: 1200,            // "TRADER UNDER ATTACK" edge blink + save radius
  saveBonus: 50,
  repPenalty: -10,             // piracy rep hit at the nearest station
  hpBarRange: 800,
  flashT: 0.5,                 // death flash before the wreck is culled
};

Object.assign(GAME, {
  // ---- spawn 3–6 traders on random routes, spread out along them ----
  // Route pool prefers gated (warpActive) station pairs; pre-gate worlds only
  // have Homeport online, so the fallback routes between any station pair.
  initNpcTraders(s) {
    s = s || this.state;
    s.npcTraders = [];
    this._nextTraderId = 1;
    const stations = ForgeWorld.getStations();
    const gated = stations.filter(st => st.warpActive);
    const pool = gated.length >= 2 ? gated : stations;
    const n = NPC_TRADERS.countMin + ((rnd() * (NPC_TRADERS.countMax - NPC_TRADERS.countMin + 1)) | 0);
    for (let i = 0; i < n; i++) {
      const from = pool[(rnd() * pool.length) | 0];
      let to = from;
      while (to === from) to = pool[(rnd() * pool.length) | 0];
      const t = {
        id: this._nextTraderId++, type: "trader",
        fromId: from.id, toId: to.id,
        fromX: from.pos.x, fromY: from.pos.y, toX: to.pos.x, toY: to.pos.y,
        x: 0, y: 0, vx: 0, vy: 0,
        progress: rnd() * 0.9,
        hp: NPC_TRADERS.hp, maxHp: NPC_TRADERS.hp,
        shield: NPC_TRADERS.shield, maxShield: NPC_TRADERS.shield,
        credits: NPC_TRADERS.creditsMin + ((rnd() * (NPC_TRADERS.creditsMax - NPC_TRADERS.creditsMin + 1)) | 0),
        cargo: [], speed: NPC_TRADERS.speed,
        dead: false, underAttackT: 0, flashT: 0,
      };
      const nc = 1 + (rnd() * 3 | 0);
      for (let c = 0; c < nc; c++) t.cargo.push(NPC_TRADERS.cargoTypes[(rnd() * NPC_TRADERS.cargoTypes.length) | 0]);
      this._traderSyncPos(t);
      s.npcTraders.push(t);
    }
    return s.npcTraders;
  },

  _traderSyncPos(t) {
    t.x = t.fromX + (t.toX - t.fromX) * t.progress;
    t.y = t.fromY + (t.toY - t.fromY) * t.progress;
    const d = Math.hypot(t.toX - t.fromX, t.toY - t.fromY) || 1;
    t.vx = (t.toX - t.fromX) / d * t.speed;
    t.vy = (t.toY - t.fromY) / d * t.speed;
  },

  updateNpcTraders(dt, sArg) {
    const s = sArg || this.state;
    if (!s || !s.npcTraders) return;
    for (let i = s.npcTraders.length - 1; i >= 0; i--) {
      const t = s.npcTraders[i];
      if (t.dead) { t.flashT -= dt; if (t.flashT <= 0) s.npcTraders.splice(i, 1); continue; }

      const dist = this.dist(t.fromX, t.fromY, t.toX, t.toY) || 1;
      t.progress += dt * t.speed / dist;
      if (t.progress >= 1) {               // arrived: turn around, haul back
        const fi = t.fromId, fx = t.fromX, fy = t.fromY;
        t.fromId = t.toId; t.fromX = t.toX; t.fromY = t.toY;
        t.toId = fi; t.toX = fx; t.toY = fy;
        t.progress = 0;
      }
      this._traderSyncPos(t);
      t.underAttackT = Math.max(0, t.underAttackT - dt);
      if (t.underAttackT <= 0 && t.shield < t.maxShield)
        t.shield = Math.min(t.maxShield, t.shield + 3 * dt);

      // ambient piracy: an alien with no player lock may break off and raid
      for (const al of s.aliens) {
        if (al.state === "DEAD") continue;
        if (al._raidTraderId === t.id) {   // engaged raider: sustained fire
          al._raidCd = (al._raidCd || 0) - dt;
          if (al._raidCd <= 0 && this.dist(al.x, al.y, t.x, t.y) < NPC_TRADERS.raidRange) {
            al._raidCd = NPC_TRADERS.raidEvery;
            this._damageTrader(t, al.weaponDmg || 8, false);
            if (t.dead) break;
          }
        } else if (!al.aggro && al._raidTraderId == null &&
                   this.dist(al.x, al.y, t.x, t.y) < NPC_TRADERS.pirateRange &&
                   rnd() < NPC_TRADERS.pirateChance * dt) {
          al._raidTraderId = t.id; al._raidCd = 0;
        }
      }
    }
  },

  // shield soaks first, overflow hits hp — ForgeCombat.applyDamage pattern on
  // the flat drone-style struct.
  _damageTrader(t, dmg, byPlayer) {
    if (!t || t.dead) return;
    const soak = Math.min(t.shield, dmg);
    t.shield -= soak; t.hp -= dmg - soak;
    t.underAttackT = 3;
    burst(t.x, t.y, "#e8edf4", 4);
    if (t.hp <= 0) this._killTrader(t, byPlayer);
  },
  // player piracy entry point (also the auto-fire path): returns true on kill
  attackTrader(t, dmg) {
    if (!t || t.dead) return false;
    this._damageTrader(t, dmg, true);
    return t.dead;
  },

  _killTrader(t, byPlayer) {
    if (t.dead) return;
    t.dead = true; t.hp = 0; t.flashT = NPC_TRADERS.flashT;
    const s = this.state;
    burst(t.x, t.y, "#e8edf4", 18); burst(t.x, t.y, "#ffd24a", 10); sfx("boom");
    // spilled hold: one credit orb + one ore orb per cargo entry
    s.loot.push({ x: t.x, y: t.y, vx: (rnd() - 0.5) * 20, vy: (rnd() - 0.5) * 20, credits: t.credits, t: 0 });
    for (const type of t.cargo)
      s.loot.push({ x: t.x + (rnd() - 0.5) * 60, y: t.y + (rnd() - 0.5) * 60,
                    vx: (rnd() - 0.5) * 20, vy: (rnd() - 0.5) * 20, ore: type, t: 0 });
    for (const al of s.aliens) if (al._raidTraderId === t.id) al._raidTraderId = null;
    if (s.pirateTargetId === t.id) s.pirateTargetId = null;
    if (byPlayer) {
      const near = this.nearestStationInfo();
      if (near.station) {
        ForgeNPC.updateReputation(near.station.id, "custom", NPC_TRADERS.repPenalty);
        near.station.reputation = ForgeNPC.getReputation(near.station.id);
        toast(`Pirate! Rep ${NPC_TRADERS.repPenalty} at ${near.station.name}`, "#ff5060");
      }
      sfx("warn");
    } else {
      toast(this.dist(s.x, s.y, t.x, t.y) < NPC_TRADERS.alertRange
        ? "TRADER LOST ON YOUR WATCH — PIRATES WIN"
        : "NPC TRADER DESTROYED — PIRATES WIN", "#ff9a3c");
    }
  },

  // "save the convoy": last raider down while the hurt trader still lives and
  // the player is close enough to have fought for it → bonus. player.js
  // onAlienKilled calls this for every alien death.
  onTraderRaiderKilled(al) {
    if (al._raidTraderId == null) return;
    const s = this.state, t = (s.npcTraders || []).find(x => x.id === al._raidTraderId);
    al._raidTraderId = null;
    if (!t || t.dead) return;
    if (this.dist(s.x, s.y, t.x, t.y) > NPC_TRADERS.alertRange) return;
    if (t.hp >= t.maxHp && t.shield >= t.maxShield) return;
    if (s.aliens.some(a => a.state !== "DEAD" && a._raidTraderId === t.id)) return;
    s.credits += NPC_TRADERS.saveBonus;
    GAME.addXpFromCredits(NPC_TRADERS.saveBonus);   // XP: convoy rescue reward
    toast(`CONVOY SAVED! +${NPC_TRADERS.saveBonus}cr`, "#7bd88f"); sfx("sell");
    this.checkWin();
  },

  // ---- player piracy: tap a trader (input.js resolveTap) to mark it, the
  // active weapon then auto-fires whenever it's in range and no alien lock
  // has priority. Shares the s.weaponCd clock with normal combat. ----
  pickTraderAt(sx, sy) {
    const s = this.state, z = s.cam.zoom, scan = s.derived ? s.derived.scanRange : 900;
    let best = null, bd = CONFIG.tapPickR;
    for (const t of s.npcTraders || []) {
      if (t.dead) continue;
      if (this.dist(s.x, s.y, t.x, t.y) > scan) continue;
      const p = this.SF(t.x, t.y), dd = Math.hypot(p.x - sx, p.y - sy);
      const hitR = Math.max(CONFIG.tapPickR, 12 * z);
      if (dd < hitR && dd < bd + 12 * z) { bd = dd; best = t; }
    }
    return best;
  },
  updatePiracy(dt) {
    const s = this.state;
    if (s.pirateTargetId == null) return;
    const t = (s.npcTraders || []).find(x => x.id === s.pirateTargetId && !x.dead);
    if (!t) { s.pirateTargetId = null; return; }
    if (ForgeCombat.getLock().targetId != null) return;   // alien combat first
    if (s.weaponCd > 0) return;
    const w = this.activeWeaponItem(); if (!w) return;
    if (this.shipTo(t) > (w.weapon.range || 300)) return;
    s.weaponCd = ForgeCombat.weaponCooldownMs(w, { fireRate: s.derived.fireRate });
    s.flare = Math.max(s.flare, 0.4);
    toast("-" + Math.round(s.derived.weaponDmg), "#ff8f6b");
    this.attackTrader(t, s.derived.weaponDmg);
  },

  // ---- drawing: flat cargo wedge in the world, □ on the minimap ----
  drawTradersWorld(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.npcTraders || !s.npcTraders.length) return;
    const z = s.cam.zoom;
    for (const t of s.npcTraders) {
      const pt = this.SF(t.x, t.y);
      if (pt.x < -30 || pt.x > CONFIG.W + 30 || pt.y < -30 || pt.y > CONFIG.H + 30) continue;
      if (t.dead) {                          // brief white pop, then culled
        g.fillStyle = `rgba(255,255,255,${Math.max(0, t.flashT / NPC_TRADERS.flashT)})`;
        g.beginPath(); g.arc(pt.x, pt.y, (3 + (NPC_TRADERS.flashT - t.flashT) * 14) * Math.max(0.4, z), 0, TAU); g.fill();
        continue;
      }
      // wider, flatter wedge than the fighters — reads as a cargo hull
      const a = Math.atan2(t.vy, t.vx), L = 11 * z, Wd = 8 * z;
      g.fillStyle = "#e8edf4"; g.strokeStyle = "#8a8f98"; g.lineWidth = Math.max(1, 1.2 * z);
      g.beginPath();
      g.moveTo(pt.x + Math.cos(a) * L, pt.y + Math.sin(a) * L);
      g.lineTo(pt.x + Math.cos(a + 2.6) * Wd, pt.y + Math.sin(a + 2.6) * Wd);
      g.lineTo(pt.x + Math.cos(a - 2.6) * Wd, pt.y + Math.sin(a - 2.6) * Wd);
      g.closePath(); g.fill(); g.stroke();
      if (this.shipTo(t) < NPC_TRADERS.hpBarRange) {
        const bw = 22 * z, bh = Math.max(2, 3 * z), by = pt.y - 12 * z - 6;
        g.fillStyle = "#1c2430"; g.fillRect(pt.x - bw / 2, by, bw, bh);
        g.fillStyle = t.underAttackT > 0 ? "#ff9a3c" : "#7bd88f";
        g.fillRect(pt.x - bw / 2, by, bw * clamp(t.hp / t.maxHp, 0, 1), bh);
      }
      if (s.pirateTargetId === t.id) this.drawSelectRing(g, pt, 16 * z, "#ff9a3c", z);
    }
  },
  // overlays ForgeHUD's minimap disc (same geometry trick as drones/encounters)
  drawTradersMinimap(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.npcTraders || !s.npcTraders.length) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / ((s.derived && s.derived.scanRange) || 1000);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    g.strokeStyle = "#e8edf4"; g.lineWidth = 1;
    for (const t of s.npcTraders) {
      if (t.dead) continue;
      const dx = (t.x - s.x) * kMap, dy = (t.y - s.y) * kMap;
      if (dx * dx + dy * dy > (R - 3 * k) * (R - 3 * k)) continue;
      const sq = 2.4 * k;
      g.strokeRect(cx + dx - sq / 2, cy + dy - sq / 2, sq, sq);
    }
    g.restore();
  },
  // blinking edge notification while a nearby convoy is being raided
  drawTraderAlert(g) {
    if (HEADLESS) return;
    const s = this.state;
    const hot = (s.npcTraders || []).some(t => !t.dead && t.underAttackT > 0 &&
      this.dist(s.x, s.y, t.x, t.y) < NPC_TRADERS.alertRange);
    if (!hot || Math.sin(s.t * 9) < -0.2) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    g.font = `bold ${Math.max(10, 12 * k) | 0}px monospace`; g.textAlign = "center";
    g.fillStyle = "#ff9a3c";
    g.fillText("⚠ TRADER UNDER ATTACK", CONFIG.W / 2, 60 * k);   // just below the HUD bars
    g.textAlign = "left";
  },
});
