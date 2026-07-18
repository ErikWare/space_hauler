/*=== HARNESS:FLEET ==========================================================*/
// Player fleet. s.playerFleet is the OWNED drone list (cap DRONES.ownedMax=6);
// each drone carries a role — "escort" flies a formation slot around the player
// (cap FLEET.max=3), "hangar" idles docked (no AI, no position, no drawing),
// "trade" runs station-to-station for a payout (state trade/returning). Escorts
// spread targets across nearby aliens, fire their loadout weapon through
// ForgeCombat.applyDamage, and drop into repair/retreat when mauled. Roles are
// assigned from the FLEET dock tab (#fleetPanel); loadouts are edited on the
// LOADOUT screen's drone pages.
const FLEET = {
  max: 3,                   // escort cap (formation slots); ownership cap is DRONES.ownedMax
  offsets: [[-80, 0], [80, 0], [0, 80]],
  slotNames: ["LEFT WING", "RIGHT WING", "REAR"],
  maxSpeed: 220,            // u/s velocity clamp
  damping: 0.85,            // velocity retention per frame @60fps (lerp toward goal)
  scanRange: 600, fireRange: 300, standoff: 160,
  repairBelow: 0.30, repairResume: 0.80,   // hp fractions: enter / leave repair
  retreatHull: 0.50,        // retreat when shield 0 AND hp under this fraction
  retreatOffset: 40,        // retreat point sits this far behind the player
  snapDist: 3000,           // warp/respawn catch-up: teleport to slot beyond this
  trail: "#00e5cc",         // teal — distinct from trade-drone cyan (#00bcd4/#57e6ff)
  tierMult: { normal: 1, rare: 1.4, unique: 1.8, elite: 2.4 },   // cargo-item swap scaling
};

Object.assign(GAME, {
  initFleet(s) { (s || this.state).playerFleet = []; },

  // ---- roles ----------------------------------------------------------------
  escorts(s) { return ((s || this.state).playerFleet || []).filter(d => d.role === "escort"); },
  // re-pack formation slots 0..n over ESCORTS ONLY (hangar/trade drones keep
  // formationIdx:null — indexing the whole owned list would hand them offsets)
  reindexFormation(s) {
    s = s || this.state;
    let k = 0;
    for (const d of s.playerFleet) {
      if (d.role !== "escort") { d.formationIdx = null; continue; }
      d.formationIdx = k; d.offsetX = FLEET.offsets[k][0]; d.offsetY = FLEET.offsets[k][1]; k++;
    }
  },
  // hangar ↔ escort transitions (docked only; trade role is entered via
  // sendOnTradeRun and left automatically on return)
  setDroneRole(fleetIdx, role) {
    const s = this.state, d = s.playerFleet[fleetIdx];
    if (!d) return { ok: false, reason: "no such drone" };
    if (!s.docked) { toast("role changes need a dock"); sfx("warn"); return { ok: false, reason: "not docked" }; }
    if (d.role === "trade") return { ok: false, reason: "on a trade run" };
    if (d.role === role) return { ok: false, reason: "already " + role };
    if (role === "escort") {
      if (this.escorts(s).length >= FLEET.max) { toast(`escort wing full (${FLEET.max})`); sfx("warn"); return { ok: false, reason: "escort full" }; }
      d.role = "escort"; d.state = "follow"; d.targetAlienId = null; d.wcd = 0; d.vx = 0; d.vy = 0;
      this.reindexFormation(s);
      const slot = this.fleetSlotPos(d, s);
      d.x = slot.x; d.y = slot.y;
      toast("companion joins your wing", FLEET.trail); sfx("buy");
    } else if (role === "hangar") {
      d.role = "hangar"; d.state = "follow"; d.targetAlienId = null;
      this.reindexFormation(s);
      toast("companion docked in the hangar"); sfx("drop");
    } else return { ok: false, reason: "bad role" };
    return { ok: true, role };
  },

  // world position of a drone's formation slot (player frame, heading-rotated)
  fleetSlotPos(d, s) {
    s = s || this.state;
    const off = FLEET.offsets[d.formationIdx] || FLEET.offsets[0];
    const a = s.heading + Math.PI / 2;
    return { x: s.x + off[0] * Math.cos(a) - off[1] * Math.sin(a),
             y: s.y + off[0] * Math.sin(a) + off[1] * Math.cos(a) };
  },

  removeFromFleet(fleetIdx) {
    const s = this.state, d = s.playerFleet[fleetIdx];
    if (!d) return false;
    s.playerFleet.splice(fleetIdx, 1);
    this.reindexFormation(s);
    toast("companion dismissed"); sfx("drop");
    return true;
  },

  updateFleet(dt, sArg) {
    const s = sArg || this.state;
    if (!s || !s.playerFleet || !s.playerFleet.length) return;
    for (let fi = s.playerFleet.length - 1; fi >= 0; fi--) {
      const d = s.playerFleet[fi];
      if (d.role === "hangar") continue;   // docked in the bay: no AI, no position

      // one-way trade run: wall-clock progress along fromX→toX (with a small
      // perpendicular lane offset so a convoy fans out). On arrival a survival
      // roll fires — success banks the share and parks the ship free; failure
      // destroys it (pirates). No auto-return leg; advances across a background gap.
      if (d.role === "trade") {
        const span = Math.max(1, d.arriveMs - d.departMs);
        d.progress = clamp((this._nowMs() - d.departMs) / span, 0, 1);
        const pos = this.dronePos(d);
        if (d.laneOffset) {   // shift perpendicular to the route
          const a = Math.atan2(d.toY - d.fromY, d.toX - d.fromX) + Math.PI / 2;
          pos.x += Math.cos(a) * d.laneOffset; pos.y += Math.sin(a) * d.laneOffset;
        }
        d.x = pos.x; d.y = pos.y;
        if (d.progress >= 1) {
          const survived = rnd() < (d.surviveP != null ? d.surviveP : 1);
          if (!survived) {
            burst(d.x, d.y, "#ff5060", 16); sfx("warn");
            toast(`✖ ${DRONES.tiers[d.tier].name} lost to pirates en route to ${this._stName(d.toId)}`, "#ff5060");
            s.playerFleet.splice(fi, 1);
            this.reindexFormation(s);
            continue;
          }
          s.credits += d.payout;
          GAME.addXpFromCredits(d.payout);   // XP: running trade runs
          toast(`Trade run complete at ${this._stName(d.toId)}! +${d.payout}cr`, "#57e6ff"); sfx("sell");
          this.checkWin();
          d.role = "hangar"; d.state = "follow"; d.targetAlienId = null;
          d.stationId = d.toId; d.fuel = d.maxFuel; d.shield = d.maxShield;
          delete d.fromId; delete d.toId; delete d.fromX; delete d.fromY; delete d.toX; delete d.toY;
          delete d.departMs; delete d.arriveMs; delete d.travelTime; delete d.payout; delete d.progress;
          delete d.surviveP; delete d.convoyId; delete d.laneOffset;
          this.reindexFormation(s);
        }
        continue;
      }

      d.wcd = Math.max(0, (d.wcd || 0) - dt);

      if (d.state !== "retreat" && d.shield <= 0 && d.hp < d.maxHp * FLEET.retreatHull) { d.state = "retreat"; d.targetAlienId = null; }
      else if ((d.state === "follow" || d.state === "attack") && d.hp < d.maxHp * FLEET.repairBelow) { d.state = "repair"; d.targetAlienId = null; }
      if (d.state === "retreat" && d.hp >= d.maxHp * FLEET.retreatHull) d.state = "repair";
      if (d.state === "repair" && d.hp > d.maxHp * FLEET.repairResume) d.state = "follow";

      if (d.state === "follow" || d.state === "attack") {
        let tgt = d.targetAlienId != null ? s.aliens.find(a => a.id === d.targetAlienId && a.state !== "DEAD") : null;
        if (d.targetAlienId != null && !tgt) { d.targetAlienId = null; d.state = "follow"; }
        if (!tgt) {
          const taken = new Set();
          for (const o of s.playerFleet) if (o !== d && o.targetAlienId != null) taken.add(o.targetAlienId);
          let best = null, bd = FLEET.scanRange, bestFree = null, bdFree = FLEET.scanRange;
          for (const a of s.aliens) {
            if (a.state === "DEAD") continue;
            const dd = this.dist(d.x, d.y, a.x, a.y);
            if (dd < bd) { bd = dd; best = a; }
            if (dd < bdFree && !taken.has(a.id)) { bdFree = dd; bestFree = a; }
          }
          tgt = bestFree || best;
          if (tgt) { d.targetAlienId = tgt.id; d.state = "attack"; }
        }
        if (d.state === "attack" && tgt) {
          // every fitted weapon fires together — 3-weapon glass cannon = 3× volley
          const ws = d.loadout.filter(m => m.type === "weapon");
          if (ws.length && d.wcd <= 0 && this.dist(d.x, d.y, tgt.x, tgt.y) <= FLEET.fireRange) {
            const dmg = ws.reduce((a, w) => a + w.dmg, 0);   // w.dmg already baked with drone-skill boost (reapplyDroneStats)
            ForgeCombat.applyDamage(tgt, dmg, dmg, dmg);
            d.wcd = 1 / (ws[0].fireRate || 1);
            burst(tgt.x, tgt.y, FLEET.trail, 3);
            if (tgt.hp.hull <= 0) this.onAlienKilled(tgt);
          }
        }
      }

      if (d.state === "repair" || d.state === "retreat") {
        for (const m of d.loadout) {
          if (m.type === "repair") d.hp = Math.min(d.maxHp, d.hp + m.amount * dt);
          else if (m.type === "utility") d.shield = Math.min(d.maxShield, d.shield + m.amount * dt);
        }
      }

      if (this.dist(d.x, d.y, s.x, s.y) > FLEET.snapDist) {
        const slot = this.fleetSlotPos(d, s);
        d.x = slot.x; d.y = slot.y; d.vx = d.vy = 0;
        continue;
      }
      let goal;
      if (d.state === "attack") {
        const tgt = s.aliens.find(a => a.id === d.targetAlienId);
        goal = tgt && this.dist(d.x, d.y, tgt.x, tgt.y) > FLEET.standoff
          ? { x: tgt.x, y: tgt.y } : { x: d.x, y: d.y };
      } else if (d.state === "retreat") {
        goal = { x: s.x - Math.cos(s.heading) * FLEET.retreatOffset,
                 y: s.y - Math.sin(s.heading) * FLEET.retreatOffset };
      } else goal = this.fleetSlotPos(d, s);

      // Formation follow is a velocity controller: FEED-FORWARD the ship's own
      // velocity (the slot is rigidly attached to the ship, so it moves at the
      // ship's speed) plus a proportional pull toward the slot to close residual
      // gap. Without the feed-forward the old `targetV = gap` law needed a gap
      // equal to the ship's speed to keep pace — so escorts trailed ~700u behind
      // a fast tug, then snapped back ("sit there → respawn"). Attack/retreat
      // chase an independent point, so they skip the feed-forward.
      const follow = !(d.state === "attack" || d.state === "retreat");
      const shipSpd = Math.hypot(s.vx, s.vy);
      const cap = Math.max(FLEET.maxSpeed, shipSpd * 1.25 + 200);   // headroom above ship speed to close
      const kP = 3.5;
      let dvx = (follow ? s.vx : 0) + (goal.x - d.x) * kP;
      let dvy = (follow ? s.vy : 0) + (goal.y - d.y) * kP;
      const dm = Math.hypot(dvx, dvy);
      if (dm > cap) { dvx = dvx / dm * cap; dvy = dvy / dm * cap; }
      const keep = Math.pow(FLEET.damping, dt * 60);
      d.vx = d.vx * keep + dvx * (1 - keep);
      d.vy = d.vy * keep + dvy * (1 - keep);
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > cap) { d.vx = d.vx / sp * cap; d.vy = d.vy / sp * cap; }
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
  },

  // ---- world drawing (flat plane via SF, like aliens/miners) ----
  drawFleetWorld(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.playerFleet.length) return;
    const z = s.cam.zoom, viewR = Math.max(CONFIG.W, CONFIG.H) * 0.6 / z + 250;
    for (const d of s.playerFleet) {
      if (d.role === "hangar") continue;   // bay drones have no world presence
      if (this.dist(d.x, d.y, s.cam.x, s.cam.y) > viewR) continue;
      const p = this.SF(d.x, d.y), sz = 9 * z;
      const col = (DRONES.tierCol && DRONES.tierCol[d.tier]) || FLEET.trail;   // colour by quality tier
      // thin leash to the formation slot (escorts only — traders fly routes)
      if (d.role !== "trade") {
        const slot = this.fleetSlotPos(d, s), sl = this.SF(slot.x, slot.y);
        g.strokeStyle = hexA(col, 0.20); g.lineWidth = Math.max(0.8, 1 * z);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(sl.x, sl.y); g.stroke();
      }
      // faint red line to the target while attacking
      if (d.state === "attack" && d.targetAlienId != null) {
        const t = s.aliens.find(a => a.id === d.targetAlienId);
        if (t) { const tp = this.SF(t.x, t.y);
          g.strokeStyle = "rgba(255,80,96,0.30)"; g.lineWidth = Math.max(0.8, 1 * z);
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(tp.x, tp.y); g.stroke(); }
      }
      // teal drive trail opposite the motion vector
      const sp = Math.hypot(d.vx, d.vy);
      const ang = sp > 8 ? Math.atan2(d.vy, d.vx) : s.heading;
      const tl = (10 + sp * 0.12) * z;
      const bx = p.x - Math.cos(ang) * sz, by = p.y - Math.sin(ang) * sz;
      const grd = g.createLinearGradient(bx, by, bx - Math.cos(ang) * tl, by - Math.sin(ang) * tl);
      grd.addColorStop(0, hexA(col, 0.7)); grd.addColorStop(1, hexA(col, 0));
      g.strokeStyle = grd; g.lineWidth = Math.max(1.5, 3 * z); g.lineCap = "round";
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - Math.cos(ang) * tl, by - Math.sin(ang) * tl); g.stroke();
      g.lineCap = "butt";
      // hull — clay tier sprite first (drone_t0/1/2, cooler as tiers advance;
      // width grows a touch per tier), procedural wedge as fallback (the trail
      // above already renders the drive, so the fallback skips engine bloom)
      if (!ART.draw(g, "drone_t" + (d.tier || 0), p.x, p.y, sz * (2.8 + (d.tier || 0) * 0.4), ang))
        this.drawDroneShape(g, p.x, p.y, ang, sz, col, { thrust: false });
      // shield ring + health bar + name tag (alien bar geometry, friendly colors)
      if (d.maxShield > 0 && d.shield > 0) {
        g.globalAlpha = 0.6 * Math.min(1, d.shield / d.maxShield);
        g.strokeStyle = "#4ad2ff"; g.beginPath(); g.arc(p.x, p.y, sz + 4 * z, 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
      const barW = 26 * z, barY = p.y - sz - 8 * z;
      g.fillStyle = "#1c2430"; g.fillRect(p.x - barW / 2, barY, barW, 3 * z);
      g.fillStyle = "#7bd88f"; g.fillRect(p.x - barW / 2, barY, barW * clamp(d.hp / d.maxHp, 0, 1), 3 * z);
      g.fillStyle = "#e8edf4"; g.font = `bold ${Math.max(6, Math.round(7 * z))}px monospace`; g.textAlign = "center";
      g.fillText(d.role === "trade" ? "TRADE" : "FLEET-" + (d.formationIdx + 1), p.x, barY - 3);
      g.textAlign = "left";
    }
  },

  // teal ▲ on the minimap disc, player-marker sized (same overlay geometry
  // trick as encounters/bases/trade drones — hud.js untouched)
  drawFleetMinimap(g) {
    if (HEADLESS) return;
    const s = this.state; if (!s.playerFleet.length) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const R = 44 * k, cx = CONFIG.W - 58 * k, cy = 118 * k;
    const kMap = R / ((s.derived && s.derived.scanRange) || 1000);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
    for (const d of s.playerFleet) {
      if (d.role === "hangar") continue;
      const dx = (d.x - s.x) * kMap, dy = (d.y - s.y) * kMap;
      if (dx * dx + dy * dy > R * R) continue;
      const px = cx + dx, py = cy + dy, t = 3 * k;
      g.fillStyle = d.role === "trade" ? "#ffd27a" : ((DRONES.tierCol && DRONES.tierCol[d.tier]) || FLEET.trail);   // trade runs gold-flagged, else quality-tier colour
      g.beginPath(); g.moveTo(px, py - t); g.lineTo(px + t, py + t); g.lineTo(px - t, py + t);
      g.closePath(); g.fill();
    }
    g.restore();
  },

  // HUD markers for in-flight trade runs: an on-screen ring + ETA over the drone,
  // or a clamped edge arrow pointing to it (with ETA) when it's off the viewport.
  // Drawn on top of the flight HUD; a no-op while docked (panel covers the canvas).
  drawTradeMarkers(g) {
    if (HEADLESS) return;
    const s = this.state;
    const runs = (s.playerFleet || []).filter(d => d.role === "trade");
    if (!runs.length) return;
    const now = this._nowMs(), W = CONFIG.W, H = CONFIG.H, inset = 20;
    for (const d of runs) {
      const p = this.dronePos(d), pt = this.SF(p.x, p.y);
      const eta = "⇪ " + this._fmtEta((d.arriveMs - now) / 1000);
      const on = pt.x >= 0 && pt.x <= W && pt.y >= 0 && pt.y <= H;
      g.fillStyle = "#57e6ff"; g.strokeStyle = "#57e6ff";
      if (on) {
        g.lineWidth = 1.5; g.beginPath(); g.arc(pt.x, pt.y, 10, 0, TAU); g.stroke();
        g.font = "bold 9px monospace"; g.textAlign = "center";
        g.fillText(eta, pt.x, pt.y - 15); g.textAlign = "left";
      } else {
        const cx = W / 2, cy = H / 2, a = Math.atan2(pt.y - cy, pt.x - cx);
        const ex = clamp(cx + Math.cos(a) * W, inset, W - inset);
        const ey = clamp(cy + Math.sin(a) * H, inset, H - inset);
        g.save(); g.translate(ex, ey); g.rotate(a);
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -6); g.lineTo(-6, 6); g.closePath(); g.fill();
        g.restore();
        g.font = "bold 9px monospace"; g.textAlign = "center";
        g.fillText(eta, clamp(ex, 26, W - 26), ey < inset + 12 ? ey + 18 : ey - 12);
        g.textAlign = "left";
      }
    }
  },

  // ---- loadout editing: cargo item → drone module entry ----
  // Slots are UNTYPED: any module fits any of the drone's DRONES.slotCount slots.
  // The item's own nature decides how it BEHAVES on the drone — a weapon deals
  // damage, a repair module heals hull, everything else recharges shield — so a
  // player can build a 3-weapon glass cannon or an all-repair tank by choice.
  // The module keeps a reference to its source item (srcItem) so a later swap
  // or unequip returns the real item to cargo — refits are reversible. Factory
  // built-ins (DRONES.tiers loadouts) have no srcItem and are simply replaced.
  fleetItemToModule(item) {
    if (!item) return null;
    const mult = FLEET.tierMult[item.tier] || 1;
    if (item.weapon) {
      const w = item.weapon;
      return { type: "weapon", name: item.name, srcItem: item,
        dmg: Math.max(1, Math.round(10 * (w.dmgShield + w.dmgArmor + w.dmgHull) / 3 * mult)),
        amount: 0, fuelCost: 1,
        fireRate: Math.round(10000 / ForgeCombat.weaponCooldownMs(item, { fireRate: 1 })) / 10 };
    }
    // Read the item's REAL rolled stats (base_stats + specials) via _sumAttr —
    // items carry armor_repair / shield_regen flat values (catalog.js) that a
    // rarer roll pushes higher; a bare fallback would silently ignore all of it.
    const fn = (item.skill && item.skill.skill_fn) || "";
    const armorRepair = this._sumAttr([item], "armor_repair") + ((fn === "armor_repair" || fn === "hull_repair") ? (item.skill.regen_amount || 0) : 0);
    if (armorRepair > 0 || fn === "armor_repair" || fn === "hull_repair" || (item.base && item.base.indexOf("repair") >= 0)) {
      const amt = armorRepair || 4;
      return { type: "repair", name: item.name, srcItem: item, dmg: 0,
        amount: Math.round(amt * mult * 10) / 10, fuelCost: 0.5, fireRate: 0.5 };
    }
    // fallback: anything else acts as a shield-recharge utility module
    const shieldRegen = this._sumAttr([item], "shield_regen") + (fn === "shield_regen" ? (item.skill.regen_amount || 0) : 0);
    const amt = shieldRegen || 5;
    return { type: "utility", name: item.name, srcItem: item, dmg: 0,
      amount: Math.round(amt * mult * 10) / 10, fuelCost: 0.4, fireRate: 0.5 };
  },
  // fit a cargo item into a slot by INDEX; a displaced player-fitted module hands
  // its source item back to cargo (factory built-ins just vanish). slotIdx beyond
  // the current rack appends into the next free slot (up to DRONES.slotCount).
  fleetSwapModule(fleetIdx, slotIdx, invIdx) { return this.droneFitModule(this.state.playerFleet[fleetIdx], slotIdx, invIdx); },
  fleetUnequipModule(fleetIdx, slotIdx) { return this.droneUnequipModule(this.state.playerFleet[fleetIdx], slotIdx); },
  fleetReorderModule(fleetIdx, fromIdx, toIdx) { return this.droneReorderModule(this.state.playerFleet[fleetIdx], fromIdx, toIdx); },

  // ---- drone-object module cores (shared by hangar drones AND berthed outpost
  // drones): operate on a drone struct `d` directly, drawing from / returning to
  // the player's ship cargo (s.inventory). Any module fits any of DRONES.slotCount
  // untyped slots; slotIdx past the rack appends into the next free slot. ----
  droneFitModule(d, slotIdx, invIdx) {
    const s = this.state;
    if (!d) return false;
    if (!d.loadout) d.loadout = [];
    const mod = this.fleetItemToModule(s.inventory[invIdx]);
    if (!mod) { toast("nothing to fit"); sfx("warn"); return false; }
    if (slotIdx >= d.loadout.length && d.loadout.length >= DRONES.slotCount) {
      toast(`all ${DRONES.slotCount} slots full — unfit one first`); sfx("warn"); return false;
    }
    s.inventory.splice(invIdx, 1);
    if (slotIdx < d.loadout.length) {
      if (d.loadout[slotIdx].srcItem) s.inventory.push(d.loadout[slotIdx].srcItem);
      d.loadout[slotIdx] = mod;
    } else d.loadout.push(mod);
    if (this.reapplyDroneStats) this.reapplyDroneStats(s);   // bake drone-skill dmg into the fresh module
    toast("fitted " + mod.name); sfx("grab");
    return true;
  },
  // pull ANY module off the drone by slot index, freeing the slot. Player-fitted
  // modules return their source item to cargo; factory built-ins have no item to
  // give back, so they're simply discarded (the slot opens up for your own pick).
  droneUnequipModule(d, slotIdx) {
    const s = this.state;
    if (!d || !d.loadout || !d.loadout[slotIdx]) return false;
    const mod = d.loadout[slotIdx];
    d.loadout.splice(slotIdx, 1);
    if (mod.srcItem) { s.inventory.push(mod.srcItem); toast("module returned to cargo"); }
    else toast("removed built-in " + (mod.name || "module"));   // factory: nothing to return
    if (this.reapplyDroneStats) this.reapplyDroneStats(s);   // pulling a cap-boosting module must shrink maxHp/maxShield back down
    sfx("drop");
    return true;
  },
  // swap two occupied module slots (drag one drone slot onto another to reorder)
  droneReorderModule(d, fromIdx, toIdx) {
    if (!d || !d.loadout) return false;
    const n = d.loadout.length;
    if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return false;
    const tmp = d.loadout[toIdx]; d.loadout[toIdx] = d.loadout[fromIdx]; d.loadout[fromIdx] = tmp;
    sfx("grab");
    return true;
  },

  // ================= DOM FLEET PANEL (#fleetPanel — build.py <body>) ===========
  // Role-assignment command board (its own dock tab): every OWNED drone as a
  // card with role badge + hp/shield, and per-role actions — escort ⇄ hangar,
  // dispatch on trade runs, dismiss. Module refits live on the LOADOUT screen.
  _flDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._fl) return this._fl;
    const $ = id => document.getElementById(id);
    const panel = $("fleetPanel");
    if (!panel) return null;
    this._fl = { panel, cred: $("ftCred"), summary: $("ftSummary"), list: $("ftList"), convoy: $("ftConvoy"), _shown: false, _tick: 0 };
    return this._fl;
  },
  syncFleetDOM() {
    const fl = this._flDOM(); if (!fl) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "fleet");
    fl.panel.classList.toggle("show", show);
    if (show) this._syncDockTabs(fl.panel);
    if (!show) { fl._shown = false; return; }
    if (!fl._shown) { fl._shown = true; fl._tick = 0; this.renderFleetPanel(); }
    fl._tick++;
    if (fl._tick % 20 === 1) this.renderFleetPanel();   // ~3Hz: live trade progress/hp
  },
  renderFleetPanel() {
    const fl = this._flDOM(); if (!fl) return;
    const s = this.state, ui = this._flUI = this._flUI || { pick: null };
    fl.cred.textContent = Math.round(s.credits);
    const esc = this.escorts(s).length;
    const trade = s.playerFleet.filter(d => d.role === "trade").length;
    fl.summary.textContent = `Owned ${s.playerFleet.length}/${DRONES.ownedMax} · Escorting ${esc}/${FLEET.max} · On trade runs ${trade}`;
    this.renderConvoyCard();
    fl.list.innerHTML = "";
    if (!s.playerFleet.length) { this._drEl("ghNote", "No drones yet — build one in the HANGAR tab.", fl.list); return; }
    const roleBadge = { escort: ["ESCORT", "#00e5cc"], hangar: ["HANGAR", "#8a8f98"], trade: ["TRADE RUN", "#ffd27a"] };
    s.playerFleet.forEach((d, fi) => {
      const flying = d.role === "trade";
      const card = this._drEl("flCard" + (flying ? " flTradeCard" : ""), null, fl.list);
      const top = this._drEl("flTop", null, card);
      this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, top);
      const [rl, rc] = roleBadge[d.role] || [d.role, "#c7d2e0"];
      const roleEl = this._drEl("flRole", rl, top); roleEl.style.color = rc; roleEl.style.borderColor = rc;
      if (d.role === "escort" && d.formationIdx != null)
        this._drEl("flSlotLbl", FLEET.slotNames[d.formationIdx] || `SLOT ${d.formationIdx + 1}`, top);
      const bars = this._drEl("flBars", null, card);
      const bar = (v, max, cls) => {
        const out = this._drEl("drBarOut flBarOut", null, bars);
        const fill = this._drEl("drBarFill " + cls, null, out);
        fill.style.width = Math.round(clamp(max > 0 ? v / max : 0, 0, 1) * 100) + "%";
      };
      bar(d.hp, d.maxHp, "flHp"); bar(d.shield, d.maxShield, "flSh");

      if (flying) {
        // in flight → route + live progress bar + ETA countdown; no actions
        const etaSec = Math.max(0, (d.arriveMs - this._nowMs()) / 1000);
        const trRow = this._drEl("flBars", null, card);
        this._drEl("drRoute", `${this._stName(d.fromId)} → ${this._stName(d.toId)}`, trRow);
        this._drEl("flEta", "ETA " + this._fmtEta(etaSec), trRow).style.color = "#57e6ff";
        const barOut = this._drEl("drBarOut flTradeBar", null, card);
        const fill = this._drEl("drBarFill", null, barOut);
        fill.style.width = Math.round(clamp(d.progress || 0, 0, 1) * 100) + "%";
        this._drEl("flNote", `payout +${d.payout}cr on arrival · in flight, can't redirect`, card);
        return;
      }

      // idle → role toggles + trade dispatch (opens the destination picker)
      const actRow = this._drEl("flBars", null, card);
      if (d.role === "escort") {
        const hg = this._drEl("btn:ghBtn flToHangar", "→ HANGAR", actRow);
        hg.dataset.act = "hangar"; hg.dataset.fi = String(fi);
      } else if (d.role === "hangar") {
        const es = this._drEl("btn:ghBtn flToEscort", "JOIN ESCORT", actRow);
        es.dataset.act = "escort"; es.dataset.fi = String(fi);
        es.disabled = esc >= FLEET.max;
      }
      const tr = this._drEl("btn:ghBtn flTrade", ui.pick === fi ? "▾ CHOOSE DESTINATION" : "SEND ON TRADE RUN", actRow);
      tr.dataset.act = "trade"; tr.dataset.fi = String(fi);
      const rm = this._drEl("btn:ghBtn flRemove", "DISMISS", actRow);
      rm.dataset.act = "remove"; rm.dataset.fi = String(fi);

      if (ui.pick === fi) {
        const picker = this._drEl("flDest", null, card);
        const dests = this.tradeDestinations();
        if (!dests.length) {
          this._drEl("ghNote", "No other stations to trade with.", picker);
        } else {
          this._drEl("flDestHead", `From ${this._stName(s.dockStationId)} — payout scales with distance · ◇ = uncharted, follow to find out`, picker);
          for (const dst of dests) {
            const row = this._drEl("btn:flDestRow", null, picker);
            row.dataset.act = "dispatch"; row.dataset.fi = String(fi); row.dataset.dest = String(dst.id);
            const nm = this._drEl("flDestName", (dst.discovered ? "" : "◇ ") + dst.name, row);
            if (!dst.discovered) nm.style.color = "#9ab8e0";   // muted — uncharted destination
            this._drEl("flDestEta", this._fmtEta(dst.etaSec), row);
            this._drEl("flDestPay", "+" + dst.payout + "cr", row);
          }
        }
        const cancel = this._drEl("btn:ghBtn flDestCancel", "cancel", picker);
        cancel.dataset.act = "cancelpick";
      }
    });
  },
  // ================= TRADE RUN MANAGEMENT (#ftConvoy) ==========================
  // A convoy builder below the drone list: multi-select 1-5 HANGAR (non-escort)
  // drones, pick a destination, launch them together. Payout stacks (10% fleet
  // penalty per extra ship); a bigger, hardier force has better survival odds.
  _convoyUI() {
    const u = this._flUI = this._flUI || { pick: null };
    if (!u.convoy) u.convoy = { open: false, selIds: [], dest: null };
    return u.convoy;
  },
  renderConvoyCard() {
    const fl = this._flDOM(); if (!fl || !fl.convoy) return;
    const s = this.state, cv = this._convoyUI();
    fl.convoy.innerHTML = "";
    const eligible = s.playerFleet.filter(d => d.role === "hangar");
    // drop any selections that are no longer eligible (dispatched/dismissed)
    cv.selIds = cv.selIds.filter(id => eligible.some(d => d.id === id));

    if (!cv.open) {
      const btn = this._drEl("btn:ghBtn go ftConvoyNew", "＋ NEW CONVOY", fl.convoy);
      btn.dataset.cv = "open"; btn.disabled = !eligible.length;
      this._drEl("flNote", eligible.length
        ? "Bundle hangar drones into one transport run — stacked payout, safer in numbers."
        : "No hangar drones free — build more (HANGAR tab) or pull an escort back to the bay.", fl.convoy);
      return;
    }

    // ---- ship picker ----
    this._drEl("flDestHead", `Choose ships — ${cv.selIds.length}/${DRONES.tradeConvoyMax} selected (hangar only)`, fl.convoy);
    const ships = this._drEl("ftConvoyShips", null, fl.convoy);
    eligible.forEach(d => {
      const on = cv.selIds.indexOf(d.id) >= 0;
      const row = this._drEl("btn:ftShipRow" + (on ? " sel" : ""), null, ships);
      row.dataset.cv = "toggle"; row.dataset.id = String(d.id);
      this._drEl("ftShipChk", on ? "✔" : "＋", row);
      this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, row);
      this._drEl("ftShipHp", `HP ${d.maxHp} · SH ${d.maxShield}`, row);
    });

    // ---- destination picker (each row shows THIS convoy's stacked total) ----
    const n = Math.max(1, cv.selIds.length);
    this._drEl("flDestHead", `Destination — payout for a ${n}-ship convoy · ◇ uncharted`, fl.convoy);
    const dests = this.tradeDestinations();
    const destWrap = this._drEl("ftConvoyDests", null, fl.convoy);
    for (const dst of dests) {
      const total = this._convoyTotal(dst.payout, n);
      const on = cv.dest === dst.id;
      const row = this._drEl("btn:flDestRow" + (on ? " sel" : ""), null, destWrap);
      row.dataset.cv = "dest"; row.dataset.dest = String(dst.id);
      const nm = this._drEl("flDestName", (dst.discovered ? "" : "◇ ") + dst.name, row);
      if (!dst.discovered) nm.style.color = "#9ab8e0";
      this._drEl("flDestEta", this._fmtEta(dst.etaSec), row);
      this._drEl("flDestPay", "+" + total + "cr", row);
    }

    // ---- summary + launch ----
    const tiers = cv.selIds.map(id => (eligible.find(d => d.id === id) || {}).tier || 0);
    const pct = cv.selIds.length ? Math.round(this._convoySurvive(cv.selIds.length, Math.max(...tiers)) * 100) : 0;
    const destObj = dests.find(dd => dd.id === cv.dest);
    const total = destObj ? this._convoyTotal(destObj.payout, cv.selIds.length || 1) : 0;
    const sum = this._drEl("ftConvoySum", null, fl.convoy);
    sum.textContent = cv.selIds.length && destObj
      ? `${cv.selIds.length} ships → ${destObj.name} · +${total}cr · ~${pct}% each arrives`
      : "Select ships and a destination.";
    const row = this._drEl("flBars", null, fl.convoy);
    const go = this._drEl("btn:ghBtn go ftConvoyLaunch", "LAUNCH CONVOY", row);
    go.dataset.cv = "launch"; go.disabled = !(cv.selIds.length && cv.dest != null);
    const cancel = this._drEl("btn:ghBtn flDestCancel", "cancel", row);
    cancel.dataset.cv = "close";
  },

  // ---- DOM event wiring (boot-time, non-headless; mirrors wireContractsDOM) ----
  wireFleetDOM() {
    const fl = this._flDOM(); if (!fl) return;
    fl.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("ftLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    fl.list.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!btn) return;
      const ui = this._flUI = this._flUI || { pick: null };
      const fi = btn.dataset.fi != null ? +btn.dataset.fi : -1;
      const act = btn.dataset.act;
      if (act === "remove") { ui.pick = null; this.removeFromFleet(fi); }
      else if (act === "escort") { ui.pick = null; this.setDroneRole(fi, "escort"); }
      else if (act === "hangar") { ui.pick = null; this.setDroneRole(fi, "hangar"); }
      else if (act === "trade") { ui.pick = ui.pick === fi ? null : fi; }   // toggle the picker
      else if (act === "cancelpick") { ui.pick = null; }
      else if (act === "dispatch") { const r = this.sendOnTradeRun(fi, +btn.dataset.dest); if (r.ok) ui.pick = null; }
      this.renderFleetPanel();
    });
    if (fl.convoy) fl.convoy.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("[data-cv]") : null;
      if (!btn) return;
      const cv = this._convoyUI(), act = btn.dataset.cv;
      if (act === "open") { cv.open = true; }
      else if (act === "close") { cv.open = false; cv.selIds = []; cv.dest = null; }
      else if (act === "toggle") {
        const id = +btn.dataset.id, at = cv.selIds.indexOf(id);
        if (at >= 0) cv.selIds.splice(at, 1);
        else if (cv.selIds.length < DRONES.tradeConvoyMax) cv.selIds.push(id);
        else { toast(`convoy holds ${DRONES.tradeConvoyMax} ships max`); sfx("warn"); }
      }
      else if (act === "dest") { cv.dest = +btn.dataset.dest; }
      else if (act === "launch") {
        const idxs = cv.selIds.map(id => this.state.playerFleet.findIndex(d => d.id === id)).filter(i => i >= 0);
        const r = this.launchTradeConvoy(idxs, cv.dest);
        if (r.ok) { cv.open = false; cv.selIds = []; cv.dest = null; }
      }
      this.renderFleetPanel();
    });
  },
});
