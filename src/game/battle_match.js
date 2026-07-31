/*=== HARNESS:BATTLE_MATCH ===================================================*/
// Match tick: timer, enemy radar pings (no zone shrink), kill resolution,
// P2-only outpost menu gank warning. Win by destroying the other pilot.
Object.assign(GAME, {
  // Zone shrink removed — S&D + radar pings drive contact instead of BR pressure.
  // Kept as no-ops so older tests/calls don't throw.
  _initBattleZone(b) {
    if (!b || !b.bounds) return;
    // Freeze full map bounds; never shrink.
    if (!b.boundsFull) {
      b.boundsFull = {
        minX: b.bounds.minX, maxX: b.bounds.maxX,
        minY: b.bounds.minY, maxY: b.bounds.maxY,
      };
    } else {
      b.bounds.minX = b.boundsFull.minX; b.bounds.maxX = b.boundsFull.maxX;
      b.bounds.minY = b.boundsFull.minY; b.bounds.maxY = b.boundsFull.maxY;
    }
    b.zone = null; // explicitly disabled
  },
  updateBattleZone(dt) {
    // no-op: keep full arena open
    const b = this.state && this.state.battle;
    if (b && b.boundsFull) {
      b.bounds.minX = b.boundsFull.minX; b.bounds.maxX = b.boundsFull.maxX;
      b.bounds.minY = b.boundsFull.minY; b.bounds.maxY = b.boundsFull.maxY;
    }
    b && (b.zone = null);
  },

  // ---- Enemy radar ping: "you can run but you can't hide" --------------------
  // Every ~30s, both pilots get a brief map mark on the other pilot's position.
  // Encourages hunts without BR-style zone pressure.
  _initBattleRadar(b) {
    if (!b || b.radar) return;
    b.radar = {
      every: 30,
      cd: 12,              // first ping a bit early so opening isn't pure fog
      pulseT: 0,           // remaining display time
      pulseDur: 6,         // how long the mark stays visible
      p1Mark: null,        // last known P1 (for P2 AI / draw)
      p2Mark: null,        // last known P2 (for P1 draw)
    };
  },
  updateBattleRadar(dt) {
    const s = this.state, b = s.battle;
    if (!b || b.phase !== "match") return;
    this._initBattleRadar(b);
    const r = b.radar;
    r.cd = (r.cd == null ? r.every : r.cd) - dt;
    if (r.pulseT > 0) r.pulseT = Math.max(0, r.pulseT - dt);
    if (r.cd > 0) return;
    r.cd = r.every;
    r.pulseT = r.pulseDur;
    // Snapshot positions
    r.p1Mark = { x: s.x, y: s.y, t: s.t };
    if (b.p2 && !b.p2.dead) r.p2Mark = { x: b.p2.x, y: b.p2.y, t: s.t };
    // Reveal a small fog bubble around enemy for the player
    if (r.p2Mark && typeof this._battleRevealAround === "function")
      this._battleRevealAround(r.p2Mark.x, r.p2Mark.y, 500);
    else if (r.p2Mark && typeof this._exploreTilesAround === "function")
      this._exploreTilesAround(r.p2Mark.x, r.p2Mark.y);
    toast("◎ RADAR PING — enemy pilot marked on map (" + Math.round(r.pulseDur) + "s)", "#ff9a3c", 2.2);
    if (typeof sfx === "function") sfx("grab");
    if (b.alerts) b.alerts.push({ t: s.t, msg: "radar_ping" });
  },

  updateBattleMatch(dt) {
    if (!this.isBattleMatch()) return;
    const s = this.state, b = s.battle;
    if (!b || b.phase !== "match") return;

    b.timerLeft = Math.max(0, b.timerLeft - dt);

    // Kill tally (NPC noise / garrisons — informational)
    if (!b._seenDead) b._seenDead = new Set();
    for (const a of s.aliens || []) {
      if (!a || a.id == null || b._seenDead.has(a.id)) continue;
      if (a.state === "DEAD" || (a.hp && a.hp.hull <= 0)) {
        b._seenDead.add(a.id);
        b.objectives.kills = (b.objectives.kills || 0) + 1;
      }
    }

    b.objectives.outpostsOwned = (s.outposts || []).filter(o => o.owner === "player").length;

    // Full map bounds only (no shrink)
    this.updateBattleZone(dt);
    // Periodic enemy position pings
    this.updateBattleRadar(dt);

    // Control maps: vision (throttled), reinforcements, S&D, P2 strategy
    if (typeof this.updateBattleControlVision === "function") {
      if (b) b._visionDt = dt;
      this.updateBattleControlVision();
    }
    if (typeof this.updateBattleReinforcements === "function") this.updateBattleReinforcements(dt);
    if (typeof this.updateBattleControlP2 === "function") this.updateBattleControlP2(dt);

    // P2-only outpost-menu approach warning
    this._battleMenuGankCheck(dt);

    // P1 vs P2 dogfight AI
    if (this.updateBattleDuel) this.updateBattleDuel(dt);

    // Control maps: TERRITORY is the win condition — losing every outpost ends
    // the match even if both pilots still fly. Pilot kills respawn while the
    // side holds territory (battle_control.js intercept).
    if (b.control) {
      let pOwn = 0, rOwn = 0;
      for (const o of s.outposts || []) {
        if (o.owner === "player") pOwn++;
        else if (o.owner === "rival") rOwn++;
      }
      b.objectives.outpostsOwned = pOwn;
      b.objectives.control = Object.assign(b.objectives.control || {}, {
        outpostsPlayer: pOwn, outpostsRival: rOwn,
        outpostsNeutral: (s.outposts || []).length - pOwn - rOwn,
      });
      if (pOwn === 0) { this.endBattleMatch("bases_lost"); return; }
      if (rOwn === 0) { this.endBattleMatch("rival_bases_down"); return; }
      if (b._p2RespawnT != null && typeof this._tickP2Respawn === "function")
        this._tickP2Respawn(dt);
    }

    // End conditions — pilot kill ends deathmatch; control absorbs it as respawn
    if (s.dead || (s.hp && s.hp.hull <= 0)) {
      this.endBattleMatch("death");
      return;
    }
    if (b.duel && b.p2 && b._p2RespawnT == null
        && (b.p2.dead || (b.p2.hp && b.p2.hp.hull <= 0))) {
      if (b.phase === "match") this.endBattleMatch("p2_down");
      return;
    }
    if (b.timerLeft <= 0) {
      this.endBattleMatch("timer");
    }
  },

  // Only when docked at an OUTPOST menu and the ENEMY PILOT (P2) is in the
  // same region — never for NPC noise. DOTA-style "someone is ganking your base".
  _battleMenuGankCheck(dt) {
    const s = this.state, b = s.battle;
    if (!s.docked || (b.rules && b.rules.dockMenusSafe)) return;
    if (s.dockKind !== "outpost") { b._gankWarnT = 0; b._gankFlash = 0; return; }
    const p2 = b.p2;
    if (!p2 || p2.dead || !p2.hp || p2.hp.hull <= 0) { b._gankWarnT = 0; b._gankFlash = 0; return; }
    const reg = this.regionAt(s.x, s.y);
    const p2reg = this.regionAt(p2.x, p2.y);
    if (!reg || !p2reg || reg.id !== p2reg.id) { b._gankWarnT = 0; b._gankFlash = 0; return; }

    b._gankWarnT = (b._gankWarnT || 0) + dt;
    b._gankFlash = 1;
    if (b._gankWarnT > 0.05 && b._gankWarnT < 0.05 + dt + 0.02) {
      toast("⚠ ENEMY SHIP APPROACHING", "#ff6a5e", 3);
      if (typeof sfx === "function") sfx("warn");
      b.alerts.push({ t: s.t, msg: "enemy_pilot_approach" });
    }
    if (b._gankWarnT >= 3) {
      b._gankWarnT = 0;
      b._gankFlash = 0;
      if (typeof this.closeDock === "function") {
        this._closeAllOverlays();
        s.docked = false; s.dockKind = "station"; s.outpostDockId = null;
        if (typeof this.syncLoadoutDOM === "function") this.syncLoadoutDOM();
      } else s.docked = false;
      toast("⚔ FORCED UNDOCK — enemy pilot in sector", "#ff9a3c", 2);
    }
  },

  // Match card geometry — top band, right of the vertical vitals cluster.
  // The vitals used to run the full width here (four 132k pills + labels); as
  // vertical gauges they occupy ~110k, leaving this strip free. Bounded on the
  // right by the credits chip / nav readout, which are right-aligned.
  battleHudLayout() {
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const b = this.state && this.state.battle;
    const vit = (typeof ForgeHUD !== "undefined" && ForgeHUD.vitalsRect)
      ? ForgeHUD.vitalsRect() : { x: 12 * k, y: 5 * k, w: 100 * k, h: 64 * k };
    const left = vit.x + vit.w + 10 * k;
    const navW = 96 * k;                       // credits chip + base/region/coords
    const w = Math.min(178 * k, CONFIG.W - navW - left - 6 * k);
    const x = left;
    const y = vit.y;
    const strip = !!(b && b.control && b.reinforce);
    // Compact enough that card + strip clear the ship/thrust strip at y 72k
    const h = strip ? 40 * k : 52 * k;
    const stripY = y + h + 3 * k, stripH = 18 * k;
    return { x, y, w, h, k, strip, stripY, stripH,
             bottom: strip ? stripY + stripH : y + h };
  },

  drawBattleHUD(g) {
    if (HEADLESS || !this.isBattleMatch()) return;
    const s = this.state, b = s.battle;
    if (!b) return;
    const lay = this.battleHudLayout();
    const k = lay.k, x = lay.x, y = lay.y, w = lay.w;
    g.save();
    g.fillStyle = "rgba(8,12,22,0.72)";
    g.fillRect(x, y, w, lay.h);
    g.strokeStyle = "rgba(255,180,94,0.55)";
    g.lineWidth = 1; g.strokeRect(x, y, w, lay.h);
    g.fillStyle = "#ffb45e";
    g.font = "bold " + Math.round(9 * k) + "px monospace";
    g.textAlign = "left";
    const def = BATTLE.kinds[b.kind];
    const kindLbl = (def && (def.short || def.label)) || "BATTLE";
    const aiLbl = b.aiDifficulty && this.battleAiProfile
      ? ((this.battleAiProfile(b.aiDifficulty) || {}).label || "")
      : "";
    g.fillText(kindLbl + (aiLbl ? " · " + aiLbl : ""), x + 7 * k, y + 12 * k);
    // radar countdown, right-aligned on the header row
    if (b.radar) {
      g.fillStyle = b.radar.pulseT > 0 ? "#ff9a3c" : "#7f8ea6";
      g.font = Math.round(8 * k) + "px monospace";
      g.textAlign = "right";
      const txt = b.radar.pulseT > 0
        ? ("PING " + Math.ceil(b.radar.pulseT) + "s")
        : ("RADAR " + Math.ceil(Math.max(0, b.radar.cd || 0)) + "s");
      g.fillText(txt, x + w - 7 * k, y + 12 * k);
      g.textAlign = "left";
    }
    g.fillStyle = b.timerLeft < 60 ? "#ff6a5e" : "#e8edf4";
    g.font = "bold " + Math.round(13 * k) + "px monospace";
    g.fillText(this._fmtBattleTimer(b.timerLeft), x + 7 * k, y + 30 * k);
    g.font = Math.round(9 * k) + "px monospace";
    if (b.control && b.objectives && b.objectives.control) {
      const c = b.objectives.control;
      // Ownership tally shares the timer row (the card is half its old height)
      g.fillStyle = "#57e6ff";
      g.fillText("OPS " + (c.outpostsPlayer || 0), x + 62 * k, y + 30 * k);
      g.fillStyle = "#ff6a5e";
      g.fillText("RIV " + (c.outpostsRival || 0), x + 104 * k, y + 30 * k);
      g.fillStyle = "#9ab8e0";
      g.fillText("·" + (c.outpostsNeutral || 0), x + 146 * k, y + 30 * k);
      const rf = b.reinforce;
      if (rf) {
        const y2 = lay.stripY;
        g.fillStyle = "rgba(8,12,22,0.72)";
        g.fillRect(x, y2, w, lay.stripH);
        g.strokeStyle = "rgba(87,230,255,0.4)";
        g.lineWidth = 1; g.strokeRect(x, y2, w, lay.stripH);
        g.font = Math.round(8 * k) + "px monospace";
        g.fillStyle = "#57e6ff";
        const qn = (rf.queue || []).length, tn = (rf.transit || []).length, sn = (rf.snD || []).length;
        const rsn = rf.rival ? (rf.rival.snD || []).length : 0;
        g.fillText("RF " + qn + "h " + tn + "fly", x + 7 * k, y2 + 12 * k);
        g.fillStyle = "#ff9a3c";
        g.fillText("S&D " + Math.ceil(Math.max(0, rf.snDCd || 0)) + "s", x + 76 * k, y2 + 12 * k);
        g.fillStyle = "#ffb45e";
        g.fillText("×" + sn + "/" + rsn, x + 130 * k, y2 + 12 * k);
        if (b._p2RespawnT != null) {
          g.fillStyle = "#ff9a3c";
          g.textAlign = "right";
          g.fillText("P2⟳" + Math.ceil(b._p2RespawnT), x + w - 7 * k, y2 + 12 * k);
          g.textAlign = "left";
        }
      }
    } else if (b.duel && b.objectives && b.objectives.duel) {
      const d = b.objectives.duel;
      g.fillStyle = "#57e6ff";
      g.fillText("P1 " + Math.round((d.p1Ehp != null ? d.p1Ehp : 0)), x + 7 * k, y + 46 * k);
      g.fillStyle = "#ff6a5e";
      g.fillText("P2 " + Math.round((d.p2Ehp != null ? d.p2Ehp : 0)), x + 80 * k, y + 46 * k);
    }
    // gank flash banner
    if (b._gankFlash > 0) {
      g.fillStyle = "rgba(255,60,60," + (0.25 + 0.25 * Math.sin(s.t * 12)) + ")";
      g.fillRect(0, CONFIG.H * 0.18, CONFIG.W, 36 * k);
      g.fillStyle = "#ffd0d0";
      g.font = "bold " + Math.round(13 * k) + "px monospace";
      g.textAlign = "center";
      g.fillText("⚠ ENEMY SHIP APPROACHING", CONFIG.W / 2, CONFIG.H * 0.18 + 24 * k);
      g.textAlign = "left";
    }
    // Radar ping mark — screen-space diamond toward last-known P2
    if (b.radar && b.radar.pulseT > 0 && b.radar.p2Mark && typeof this.SF === "function") {
      const m = b.radar.p2Mark;
      const p = this.SF(m.x, m.y);
      const pulse = 0.55 + 0.45 * Math.sin(s.t * 8);
      g.globalAlpha = pulse;
      g.strokeStyle = "#ff9a3c";
      g.fillStyle = "rgba(255,154,60,0.25)";
      g.lineWidth = 2;
      const rr = 10 + pulse * 6;
      g.beginPath();
      g.moveTo(p.x, p.y - rr); g.lineTo(p.x + rr, p.y);
      g.lineTo(p.x, p.y + rr); g.lineTo(p.x - rr, p.y);
      g.closePath(); g.fill(); g.stroke();
      g.font = "bold " + Math.round(10 * k) + "px monospace";
      g.fillStyle = "#ffb45e"; g.textAlign = "center";
      g.fillText("ENEMY", p.x, p.y - rr - 6);
      g.textAlign = "left";
      g.globalAlpha = 1;
    }
    g.restore();
  },
});
