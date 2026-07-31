/*=== HARNESS:BATTLE_OPPONENT ================================================*/
// Battle is a PLAYER-SHIP duel: P1 (human or AI) vs P2 (AI or remote snapshot).
// Faction NPC packs are arena NOISE only — they do not decide the match.
//
// P2 is a full 3-layer player-style combatant (same hull/modules/drones stats as
// a real pilot), piloted by BATTLE_AI difficulty profiles. The same profiles
// are the hook for future career boss battles (use "boss" + combatantFromSave).
//
// AI tiers change pilot BEHAVIOR (aim, fire rate, aggression), not free hull
// cheats — except boss, which may add modest pool mults for campaign setpieces.
const BATTLE_AI = {
  easy: {
    key: "easy", label: "EASY",
    standoff: 430, thrustMul: 0.72, turnMul: 0.72,
    fireRangeMul: 0.82, fireCdMul: 1.55, dmgMul: 0.72,
    aimJitter: 0.42, droneDmgMul: 0.55, droneFireMul: 0.65,
    reactionDelay: 0.45, hullMul: 1, shieldMul: 1,
  },
  normal: {
    key: "normal", label: "NORMAL",
    // Closer orbit + slightly hotter guns so fights resolve before soft timer
    standoff: 280, thrustMul: 1.05, turnMul: 1.05,
    fireRangeMul: 1.08, fireCdMul: 0.92, dmgMul: 1.05,
    aimJitter: 0.06, droneDmgMul: 1.05, droneFireMul: 1.05,
    reactionDelay: 0.05, hullMul: 1, shieldMul: 1,
  },
  hard: {
    key: "hard", label: "HARD",
    standoff: 250, thrustMul: 1.15, turnMul: 1.2,
    fireRangeMul: 1.14, fireCdMul: 0.78, dmgMul: 1.15,
    aimJitter: 0.025, droneDmgMul: 1.2, droneFireMul: 1.15,
    reactionDelay: 0, hullMul: 1, shieldMul: 1,
  },
  // Boss: used for career setpieces / balance stress. Mild pool mult + sharper AI.
  boss: {
    key: "boss", label: "BOSS",
    standoff: 250, thrustMul: 1.22, turnMul: 1.28,
    fireRangeMul: 1.18, fireCdMul: 0.68, dmgMul: 1.28,
    aimJitter: 0.015, droneDmgMul: 1.35, droneFireMul: 1.25,
    reactionDelay: 0, hullMul: 1.18, shieldMul: 1.12,
  },
};

Object.assign(GAME, {
  battleAiProfile(key) {
    return BATTLE_AI[key] || BATTLE_AI.normal;
  },
  battleAiKeys() { return Object.keys(BATTLE_AI); },

  // Apply difficulty to a combatant (behavior + optional boss pool mults).
  applyBattleAiDifficulty(pilot, difficulty) {
    if (!pilot) return pilot;
    const prof = this.battleAiProfile(difficulty);
    pilot.aiDifficulty = prof.key;
    pilot.ai = Object.assign(pilot.ai || {}, {
      standoff: prof.standoff,
      strafe: (pilot.ai && pilot.ai.strafe) || 1,
      aimJitter: prof.aimJitter,
      fireRangeMul: prof.fireRangeMul,
      fireCdMul: prof.fireCdMul,
      dmgMul: prof.dmgMul,
      droneDmgMul: prof.droneDmgMul,
      droneFireMul: prof.droneFireMul,
      reactionDelay: prof.reactionDelay,
      thrustMul: prof.thrustMul,
      turnMul: prof.turnMul,
      reactT: 0,
    });
    // Boss setpiece pool mults only (dmgMul applies per-shot in pilot tick).
    if (!pilot._aiPoolsScaled && ((prof.hullMul && prof.hullMul !== 1) || (prof.shieldMul && prof.shieldMul !== 1))) {
      const sm = prof.shieldMul || 1, hm = prof.hullMul || 1;
      pilot.hp.shieldMax = Math.round(pilot.hp.shieldMax * sm);
      pilot.hp.armorMax = Math.round(pilot.hp.armorMax * hm);
      pilot.hp.hullMax = Math.round(pilot.hp.hullMax * hm);
      pilot.hp.shield = pilot.hp.shieldMax;
      pilot.hp.armor = pilot.hp.armorMax;
      pilot.hp.hull = pilot.hp.hullMax;
      pilot._aiPoolsScaled = true;
    }
    return pilot;
  },
  // ---- Combatant snapshot from the live player (or free-fit opts) ------------
  captureBattleCombatant(label) {
    const s = this.state;
    const ship = (s.ships || []).find(sh => sh.id === s.activeShipId) || (s.ships && s.ships[0]);
    const hullKey = (ship && ship.hullKey) || "vulture";
    const hull = CONFIG.hulls[hullKey] || CONFIG.hulls.vulture;
    const slots = (ship && ship.slots ? ship.slots : []).map(it => it ? JSON.parse(JSON.stringify(it)) : null);
    const eq = (typeof ForgeEquipment !== "undefined" && ForgeEquipment.getEquipped)
      ? ForgeEquipment.getEquipped().slots.map(it => it ? JSON.parse(JSON.stringify(it)) : null)
      : slots.slice();
    // Prefer live rack if fitted
    const rack = eq.some(Boolean) ? eq : slots;
    let weapon = null;
    for (const it of rack) if (it && it.weapon) { weapon = JSON.parse(JSON.stringify(it)); break; }

    const d = s.derived || {};
    const hp = s.hp || {};
    // Wing parity: P2 flies the same ACTIVE wing a real pilot would — escorts
    // and tanks only (hangar drones stay benched), capped at the hull's escort
    // slots. Without this P2 fielded the whole 6+ drone roster and alpha-struck.
    const wingCap = hull.escortSlots != null ? hull.escortSlots
      : ((typeof FLEET !== "undefined" && FLEET.max) || 3);
    const fleet = (s.playerFleet || [])
      .filter(dr => dr.role === "escort" || dr.role === "tank")
      .slice(0, wingCap)
      .map(dr => ({
        id: "p2d_" + dr.id, tier: dr.tier, role: dr.role,
        hp: dr.maxHp, maxHp: dr.maxHp, shield: dr.maxShield, maxShield: dr.maxShield,
        loadout: (dr.loadout || []).map(m => ({ ...m })),
        x: 0, y: 0, vx: 0, vy: 0, wcd: 0, state: "follow", targetId: null,
      }));

    return {
      label: label || "PILOT",
      hullKey,
      hullName: hull.name,
      slots: rack,
      weapon,
      // derived combat stats (frozen at snapshot — even matches share the same)
      weaponDmg: d.weaponDmg != null ? d.weaponDmg : (hull.baseShip && hull.baseShip.weaponDmg) || 10,
      fireRate: d.fireRate != null ? d.fireRate : 1,
      thrust: d.thrust != null ? d.thrust : (hull.baseShip && hull.baseShip.thrust) || 100,
      turnSpeed: d.turnSpeed != null ? d.turnSpeed : 100,
      scanRange: d.scanRange != null ? d.scanRange : 1000,
      fuelCostK: d.fuelCostK != null ? d.fuelCostK : 1,
      mass: d.mass != null ? d.mass : (hull.baseShip && hull.baseShip.mass) || 2,
      hp: {
        shield: hp.shieldMax || (hull.baseShip && hull.baseShip.shieldMax) || 1000,
        shieldMax: hp.shieldMax || (hull.baseShip && hull.baseShip.shieldMax) || 1000,
        armor: hp.armorMax || (hull.baseShip && hull.baseShip.armorMax) || 800,
        armorMax: hp.armorMax || (hull.baseShip && hull.baseShip.armorMax) || 800,
        hull: hp.hullMax || (hull.baseShip && hull.baseShip.hullMax) || 600,
        hullMax: hp.hullMax || (hull.baseShip && hull.baseShip.hullMax) || 600,
        shieldRegen: hp.shieldRegen || (hull.baseShip && hull.baseShip.shieldRegen) || 50,
        shieldDelay: hp.shieldDelay || 3,
        armorRepair: hp.armorRepair || 0,
        res: Object.assign({ shield: 0, armor: 0, hull: 0 }, hp.res || (hull.baseShip && hull.baseShip.res) || {}),
        _sinceHit: 99,
      },
      fuel: s.fuelMax || (hull.baseShip && hull.baseShip.fuelMax) || 1200,
      fuelMax: s.fuelMax || (hull.baseShip && hull.baseShip.fuelMax) || 1200,
      fleet,
    };
  },

  // Build a combatant snapshot from a serialized save blob (career vs career)
  // without mutating the live player rack. Skills + fitted modules both count.
  combatantFromSaveData(data, label) {
    if (!data || !Array.isArray(data.ships) || !data.ships.length) return null;
    const ship = data.ships.find(sh => sh.id === data.activeShipId) || data.ships[0];
    if (!ship) return null;
    const hullKey = ship.hullKey || "vulture";
    const hull = CONFIG.hulls[hullKey] || CONFIG.hulls.vulture;
    const slots = (ship.slots || []).map(it => it ? JSON.parse(JSON.stringify(it)) : null);
    const items = slots.filter(Boolean);
    let stats = null;
    if (typeof ForgeEquipment !== "undefined" && ForgeEquipment.applyItemsToStats) {
      stats = ForgeEquipment.applyItemsToStats(
        Object.assign({}, hull.baseShip), items);
    } else {
      stats = Object.assign({}, hull.baseShip);
    }
    // Career skill tree bonuses (same path as campaign recompute)
    if (typeof this.applySkillsToDerived === "function" && data.skills) {
      try { stats = this.applySkillsToDerived(stats, data.skills); } catch (e) { /* keep base */ }
    }
    let weapon = null;
    for (const it of slots) if (it && it.weapon) { weapon = JSON.parse(JSON.stringify(it)); break; }

    // Same wing-parity rule as captureBattleCombatant: active escorts/tanks
    // only, capped at the hull's escort slots (old saves can hold 6+ drones).
    const wingCap = hull.escortSlots != null ? hull.escortSlots
      : ((typeof FLEET !== "undefined" && FLEET.max) || 3);
    const fleet = (Array.isArray(data.fleet) ? data.fleet : [])
      .filter(dr => dr && (dr.role === "escort" || dr.role === "tank"))
      .slice(0, wingCap)
      .map((dr, i) => {
        const tier = dr.tier || 0;
        const spec = (typeof DRONES !== "undefined" && DRONES.tiers[tier]) || { maxHp: 160, maxShield: 100 };
        return {
          id: "cv_" + (dr.id || i),
          tier, role: dr.role || "escort",
          hp: dr.maxHp || spec.maxHp, maxHp: dr.maxHp || spec.maxHp,
          shield: dr.maxShield || spec.maxShield, maxShield: dr.maxShield || spec.maxShield,
          loadout: (dr.loadout || []).map(m => m ? { ...m } : m),
          x: 0, y: 0, vx: 0, vy: 0, wcd: 0, state: "follow", targetId: null,
        };
      });

    return {
      label: label || "CAREER",
      hullKey, hullName: hull.name, slots, weapon,
      weaponDmg: stats.weaponDmg != null ? stats.weaponDmg : 10,
      fireRate: stats.fireRate != null ? stats.fireRate : 1,
      thrust: stats.thrust != null ? stats.thrust : 100,
      turnSpeed: stats.turnSpeed != null ? stats.turnSpeed : 100,
      scanRange: stats.scanRange != null ? stats.scanRange : 1000,
      fuelCostK: stats.fuelCostK != null ? stats.fuelCostK : 1,
      mass: stats.mass != null ? stats.mass : 2,
      hp: {
        shield: stats.shieldMax, shieldMax: stats.shieldMax,
        armor: stats.armorMax, armorMax: stats.armorMax,
        hull: stats.hullMax, hullMax: stats.hullMax,
        shieldRegen: stats.shieldRegen || 50, shieldDelay: stats.shieldDelay || 3,
        armorRepair: stats.armorRepair || 0,
        res: Object.assign({ shield: 0, armor: 0, hull: 0 }, stats.res || {}),
        _sinceHit: 99,
      },
      fuel: stats.fuelMax || 1200, fuelMax: stats.fuelMax || 1200,
      fleet,
      source: "career",
      level: data.level || 1,
      faction: data.playerFaction || null,
    };
  },

  // Instantiate a live duel combatant from a snapshot at (x,y).
  _spawnBattlePilot(snap, x, y, side) {
    const c = JSON.parse(JSON.stringify(snap));
    c.id = side === 1 ? "battle_p1" : "battle_p2";
    c.kind = "battlePilot";
    c.side = side;
    c.x = x; c.y = y; c.vx = 0; c.vy = 0;
    c.heading = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    c.aimX = side === 1 ? 1 : -1; c.aimY = 0;
    c.weaponCd = 0; c.weaponCds = []; c.invuln = 1.2; c.dead = false; c.state = "ALIVE";
    c.r = (CONFIG.shipR || 14);
    c.color = side === 1 ? "#57e6ff" : "#ff6a5e";
    c.wcd = 0;
    // All weapons on the rack for independent fire rates (parity with player multi-gun)
    c.weapons = [];
    if (c.slots) {
      for (let i = 0; i < c.slots.length; i++) {
        const it = c.slots[i];
        if (it && it.weapon) c.weapons.push({ slot: i, item: it });
      }
    }
    if (!c.weapons.length && c.weapon) c.weapons.push({ slot: 0, item: c.weapon });
    // Full HP at spawn
    c.hp.shield = c.hp.shieldMax;
    c.hp.armor = c.hp.armorMax;
    c.hp.hull = c.hp.hullMax;
    c.hp._sinceHit = 99;
    c.fuel = c.fuelMax;
    // Place wing
    if (c.fleet) {
      c.fleet.forEach((d, i) => {
        const a = (i / Math.max(1, c.fleet.length)) * Math.PI * 2;
        d.x = x + Math.cos(a) * 70; d.y = y + Math.sin(a) * 70;
        d.hp = d.maxHp; d.shield = d.maxShield; d.wcd = 0;
      });
    }
    // Default AI — difficulty overwrites via applyBattleAiDifficulty
    c.ai = { standoff: 320, repath: 0, strafe: side === 1 ? 1 : -1 };
    return c;
  },

  // Duel spawn: P1 = live player (from current fit), P2 = clone OR opts.p2Snap.
  // opts.aiDifficulty controls P2 pilot (and AI-P1 when both-AI).
  spawnBattleDuel(opts) {
    opts = opts || {};
    const s = this.state, b = s.battle;
    if (!b || !b.bounds) return { ok: false, reason: "no arena" };

    const difficulty = opts.aiDifficulty || b.aiDifficulty || "normal";
    b.aiDifficulty = difficulty;

    // P1 template from live fit (or explicit override)
    const template = opts.p1Snap
      ? JSON.parse(JSON.stringify(opts.p1Snap))
      : this.captureBattleCombatant("P1");
    if (opts.noDrones) template.fleet = [];

    // P2: career snap, explicit snap, or even-match clone of P1
    let p2Snap = opts.p2Snap
      ? JSON.parse(JSON.stringify(opts.p2Snap))
      : JSON.parse(JSON.stringify(template));
    if (opts.noDrones) p2Snap.fleet = [];
    const even = !opts.p2Snap || !!(opts.even);

    const bounds = b.bounds;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    // Control: spawn near home outpost clusters. Deathmatch: opposite sides.
    let p1x, p1y, p2x, p2y;
    const homeP1 = (s.outposts || []).find(o => o.homeSide === "p1" || o.owner === "player");
    const homeP2 = (s.outposts || []).find(o => o.homeSide === "p2" || o.owner === "rival");
    if (opts.keepClutter && homeP1 && homeP2) {
      p1x = homeP1.x + 180; p1y = homeP1.y + 120;
      p2x = homeP2.x - 180; p2y = homeP2.y - 120;
    } else {
      const span = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.32;
      const ang = (opts.spawnAngle != null) ? opts.spawnAngle : ((b.seed || 0) % 360) * Math.PI / 180;
      p1x = cx + Math.cos(ang) * span;
      p1y = cy + Math.sin(ang) * span;
      p2x = cx - Math.cos(ang) * span;
      p2y = cy - Math.sin(ang) * span;
    }

    // Live player is P1 — teleport + restore full vitals from template
    s.x = p1x; s.y = p1y; s.vx = s.vy = 0;
    s.cam.x = p1x; s.cam.y = p1y;
    s.heading = Math.atan2(p2y - p1y, p2x - p1x);
    s.aimX = Math.cos(s.heading); s.aimY = Math.sin(s.heading);
    s.hp.shield = template.hp.shieldMax; s.hp.shieldMax = template.hp.shieldMax;
    s.hp.armor = template.hp.armorMax; s.hp.armorMax = template.hp.armorMax;
    s.hp.hull = template.hp.hullMax; s.hp.hullMax = template.hp.hullMax;
    s.hp.shieldRegen = template.hp.shieldRegen;
    s.hp.shieldDelay = template.hp.shieldDelay;
    s.hp.armorRepair = template.hp.armorRepair;
    s.hp.res = Object.assign({}, template.hp.res);
    s.hp._sinceHit = 99;
    s.fuel = template.fuelMax; s.fuelMax = template.fuelMax;
    s.invuln = 1.2; s.dead = false;
    // Refresh P1 drones to full
    if (s.playerFleet) {
      for (const d of s.playerFleet) {
        if (d.role === "escort" || d.role === "tank") {
          d.hp = d.maxHp; d.shield = d.maxShield;
          d.x = s.x; d.y = s.y; d.vx = d.vy = 0;
        }
      }
    }

    const p2 = this._spawnBattlePilot(p2Snap, p2x, p2y, 2);
    p2.label = p2Snap.label || "P2";
    p2.heading = Math.atan2(p1y - p2y, p1x - p2x);
    p2.aimX = Math.cos(p2.heading); p2.aimY = Math.sin(p2.heading);
    this.applyBattleAiDifficulty(p2, difficulty);

    b.p1Snap = template;
    b.p2Snap = p2Snap;
    b.p2 = p2;
    b.duel = true;
    b.aiPilotP1 = !!opts.aiPilotP1;   // both-AI for balance sims
    b.opponent = {
      kind: "playerShip",
      hullKey: p2Snap.hullKey,
      even: !!even && template.hullKey === p2Snap.hullKey,
      label: p2.label,
      difficulty,
      source: p2Snap.source || (opts.p2Snap ? "custom" : "clone"),
    };
    b.objectives.duel = { p1Hull: 1, p2Hull: 1 };

    // Deathmatch: strip outposts (pure PvP). Control passes keepClutter=true.
    // Keep light obstacles for cover in deathmatch unless stripObstacles.
    if (!opts.keepClutter) {
      s.outposts = [];
      if (opts.stripObstacles) s.obstacles = [];
      for (const r of s.regions || []) { r.outpostId = null; }
    }

    // Noise NPCs — weak, few, not match-deciding (0 by default for even tests)
    const noiseGroups = opts.noiseGroups != null ? opts.noiseGroups : 0;
    const noiseDanger = opts.noiseDanger != null ? opts.noiseDanger : 2;
    this.spawnBattleNoise(noiseGroups, noiseDanger);

    this._exploreTilesAround(s.x, s.y);
    this.updateRegions();
    // Full-map bounds freeze (no zone shrink) + radar ping clock
    if (typeof this._initBattleZone === "function") this._initBattleZone(b);
    if (typeof this._initBattleRadar === "function") this._initBattleRadar(b);
    return { ok: true, p1: { x: p1x, y: p1y }, p2: { x: p2x, y: p2y } };
  },

  // Background faction packs (noise).
  spawnBattleNoise(groups, danger) {
    const s = this.state, b = s.battle;
    if (!b || !b.bounds || typeof ForgeFaction === "undefined") return { groups: 0 };
    const n = Math.max(0, groups | 0);
    if (!n) return { groups: 0 };
    const dl = Math.max(1, Math.min(9, danger | 0));
    const bounds = b.bounds;
    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.minY + bounds.maxY) * 0.5;
    const span = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.22;
    let g = 0;
    for (let i = 0; i < n; i++) {
      const fac = ["vex", "krag", "nox"][i % 3];
      const a = (i / n) * Math.PI * 2 + 1.1;
      const x = cx + Math.cos(a) * span;
      const y = cy + Math.sin(a) * span;
      try {
        const grp = ForgeFaction.generateGroup(fac, { x, y }, {
          rng: rnd, followerCount: 1, leaderTier: "normal",
        });
        for (const ship of [grp.leader].concat(grp.followers || [])) {
          if (!ship) continue;
          if (typeof applyDangerToShip === "function") applyDangerToShip(ship, dl);
          ship._battleHostile = true;
          ship._battleNoise = true;
          s.aliens.push(ship);
          if (typeof ForgeFaction.activateGroup === "function")
            ForgeFaction.activateGroup(ship, s.aliens);
        }
        g++;
      } catch (e) { /* ignore */ }
    }
    return { groups: g };
  },

  // Legacy name — used by older start paths; now spawns noise only if duel already set.
  spawnBattleOpponents(b) {
    b = b || (this.state && this.state.battle);
    if (!b) return { groups: 0 };
    if (b.duel) return this.spawnBattleNoise(b.enemyGroups || 1, b.danger || 2);
    // Non-duel fallback: light noise packs
    return this.spawnBattleNoise(b.enemyGroups != null ? b.enemyGroups : 2, b.danger || 3);
  },

  // ---- Dogfight AI (shared) -------------------------------------------------
  // pilot: combatant with x/y/vx/vy/heading/aim/hp/weapon
  // target: {x,y,hp?} 
  _battlePilotTick(pilot, target, dt, opts) {
    if (!pilot || pilot.dead || !target) return;
    opts = opts || {};
    const ai = pilot.ai || {};
    const standoff = ai.standoff || 400;
    const thrustMul = ai.thrustMul != null ? ai.thrustMul : 1;
    const turnMul = ai.turnMul != null ? ai.turnMul : 1;
    const fireRangeMul = ai.fireRangeMul != null ? ai.fireRangeMul : 1.05;
    const fireCdMul = ai.fireCdMul != null ? ai.fireCdMul : 1;
    const dmgMul = ai.dmgMul != null ? ai.dmgMul : 1;
    const aimJitter = ai.aimJitter || 0;
    const droneDmgMul = ai.droneDmgMul != null ? ai.droneDmgMul : 1;
    const droneFireMul = ai.droneFireMul != null ? ai.droneFireMul : 1;
    const reactionDelay = ai.reactionDelay || 0;

    // Reaction delay: easy AI "thinks" before engaging
    ai.reactT = (ai.reactT || 0) + dt;
    const canFight = ai.reactT >= reactionDelay;

    const dx = target.x - pilot.x, dy = target.y - pilot.y;
    const dist = Math.hypot(dx, dy) || 1;
    let ux = dx / dist, uy = dy / dist;
    // Aim jitter (difficulty) — pull aim off-target
    if (aimJitter > 0) {
      const j = (rnd() - 0.5) * 2 * aimJitter;
      const c = Math.cos(j), sn = Math.sin(j);
      const nx = ux * c - uy * sn, ny = ux * sn + uy * c;
      ux = nx; uy = ny;
    }
    // Desired point: orbit on the tangent when in range, close when far
    let tx = target.x, ty = target.y;
    if (dist < standoff * 0.85) {
      const strafe = ai.strafe || 1;
      tx = pilot.x - ux * 200 + (-uy) * strafe * 160;
      ty = pilot.y - uy * 200 + (ux) * strafe * 160;
    } else if (dist < standoff * 1.25) {
      const strafe = ai.strafe || 1;
      tx = target.x + (-uy) * standoff * 0.55 * strafe;
      ty = target.y + (ux) * standoff * 0.55 * strafe;
    }
    const tdx = tx - pilot.x, tdy = ty - pilot.y;
    const wantA = Math.atan2(tdy, tdx);
    // turn
    let ha = pilot.heading;
    let da = wantA - ha;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const turn = (pilot.turnSpeed || 100) * 0.035 * turnMul * dt;
    if (Math.abs(da) < turn) pilot.heading = wantA;
    else pilot.heading += Math.sign(da) * turn;

    // thrust along heading
    const thr = (pilot.thrust || 100) * 0.55 * thrustMul;
    pilot.vx += Math.cos(pilot.heading) * thr * dt;
    pilot.vy += Math.sin(pilot.heading) * thr * dt;
    // drag
    const drag = Math.pow(0.992, dt * 60);
    pilot.vx *= drag; pilot.vy *= drag;
    // speed clamp
    const spd = Math.hypot(pilot.vx, pilot.vy), maxSpd = 220 * Math.max(0.7, thrustMul);
    if (spd > maxSpd) { pilot.vx *= maxSpd / spd; pilot.vy *= maxSpd / spd; }
    pilot.x += pilot.vx * dt; pilot.y += pilot.vy * dt;

    // aim at (jittered) target direction
    pilot.aimX = ux; pilot.aimY = uy;

    // shield / armor regen (same formula as GAME.tickHealth)
    const h = pilot.hp;
    h._sinceHit = (h._sinceHit || 0) + dt;
    pilot.invuln = Math.max(0, (pilot.invuln || 0) - dt);
    if (h._sinceHit >= (h.shieldDelay || 3) && h.shield < h.shieldMax)
      h.shield = Math.min(h.shieldMax, h.shield + (h.shieldRegen || 0) * dt);
    if (h.armorRepair > 0 && h.armor < h.armorMax)
      h.armor = Math.min(h.armorMax, h.armor + h.armorRepair * dt);
    if ((pilot.fuel || 0) < (pilot.fuelMax || 0) * 0.3)
      pilot.fuel = Math.min(pilot.fuelMax || 0, (pilot.fuel || 0) + 2 * dt);

    // fire — each armed weapon has its own cooldown (same rule as player multi-gun)
    if (!pilot.weaponCds) pilot.weaponCds = [];
    for (let i = 0; i < pilot.weaponCds.length; i++)
      pilot.weaponCds[i] = Math.max(0, (pilot.weaponCds[i] || 0) - dt * 1000);
    pilot.weaponCd = Math.max(0, (pilot.weaponCd || 0) - dt * 1000);
    const guns = (pilot.weapons && pilot.weapons.length)
      ? pilot.weapons
      : (pilot.weapon ? [{ slot: 0, item: pilot.weapon }] : []);
    const tgt = target.hp ? target : target;
    if (canFight && tgt.hp && tgt.hp.hull > 0) {
      for (const g of guns) {
        const w = g.item;
        if (!w || !w.weapon) continue;
        const si = g.slot || 0;
        while (pilot.weaponCds.length <= si) pilot.weaponCds.push(0);
        if (pilot.weaponCds[si] > 0) continue;
        const rangeOk = dist < ((w.weapon.range || 800) * fireRangeMul);
        if (!rangeOk) continue;
        const shipState = {
          x: pilot.x, y: pilot.y,
          weaponDmg: (pilot.weaponDmg || 10) * dmgMul,
          fireRate: pilot.fireRate || 1,
          fuel: pilot.fuel, fuelCostK: pilot.fuelCostK || 1,
        };
        const res = ForgeCombat.fireWeapon(w, tgt, [], shipState);
        if (res && res.ok) {
          pilot.fuel = shipState.fuel;
          const baseCd = ForgeCombat.weaponCooldownMs
            ? ForgeCombat.weaponCooldownMs(w, shipState)
            : (w.weapon.fireRate_ms || 800);
          pilot.weaponCds[si] = baseCd * fireCdMul;
          pilot.weaponCd = Math.min(...pilot.weaponCds.filter(c => c > 0).concat([baseCd]));
          if (res.hit && tgt.hp) tgt.hp._sinceHit = 0;
          if (res.dead || (tgt.hp && tgt.hp.hull <= 0)) {
            if (opts.onKill) opts.onKill(tgt);
            break;
          }
        }
      }
    }

    // drones: formation follow + combat (parity with player wing DPS curve)
    if (pilot.fleet && pilot.fleet.length) {
      const fireR = (typeof FLEET !== "undefined" && FLEET.fireRange) || 260;
      for (let i = 0; i < pilot.fleet.length; i++) {
        const d = pilot.fleet[i];
        if ((d.hp || 0) <= 0) continue;
        // tank on point, escorts fan back
        const isTank = d.role === "tank";
        const offA = pilot.heading + Math.PI + (isTank ? 0 : (i - (pilot.fleet.length - 1) / 2) * 0.55);
        const distOff = isTank ? 55 : 85;
        const ox = pilot.x + Math.cos(offA) * distOff;
        const oy = pilot.y + Math.sin(offA) * distOff;
        // engage: close on target if in combat envelope
        let gx = ox, gy = oy;
        if (canFight && target.hp && target.hp.hull > 0) {
          const dd = Math.hypot(target.x - d.x, target.y - d.y);
          if (dd < fireR * 2.2) {
            const standoff = isTank ? 70 : 110;
            const ang = Math.atan2(target.y - d.y, target.x - d.x);
            gx = target.x - Math.cos(ang) * standoff;
            gy = target.y - Math.sin(ang) * standoff;
          }
        }
        d.x += (gx - d.x) * Math.min(1, 5 * dt);
        d.y += (gy - d.y) * Math.min(1, 5 * dt);
        d.wcd = Math.max(0, (d.wcd || 0) - dt);
        if (canFight && d.wcd <= 0 && target.hp && target.hp.hull > 0) {
          const dd = Math.hypot(target.x - d.x, target.y - d.y);
          if (dd < fireR) {
            const wpn = (d.loadout || []).find(m => m.type === "weapon");
            // Parity with player escorts: same FLEET.dmgScale + tank malus, so
            // an even wing can't alpha-strike a pilot (droneDmgMul = difficulty)
            const raw = wpn ? (wpn.dmg || 2) : 2;
            const scale = (typeof FLEET !== "undefined" && FLEET.dmgScale) || 0.38;
            const dmg = Math.max(1, Math.round(raw * scale * (isTank ? 0.55 : 1) * droneDmgMul));
            if (typeof ForgeCombat !== "undefined" && ForgeCombat.applyDamage) {
              ForgeCombat.applyDamage(target, dmg, dmg, dmg);
              if (target.hp) target.hp._sinceHit = 0;
            }
            d.wcd = (1 / Math.max(0.4, (wpn && wpn.fireRate) || 1.1)) / Math.max(0.4, droneFireMul);
            if (target.hp && target.hp.hull <= 0 && opts.onKill) opts.onKill(tgt);
          }
        }
        // light regen while near pilot (keep combat shell in lockstep)
        if ((d.shield || 0) < (d.maxShield || 0)) {
          const sh = Math.min(d.maxShield || 0, (d.shield || 0) + 4 * dt);
          if (this._setDronePools) this._setDronePools(d, sh, d.hp);
          else {
            d.shield = sh;
            if (d._combatHp) d._combatHp.shield = sh;
          }
        }
      }
      // cull dead
      pilot.fleet = pilot.fleet.filter(d => (d.hp || 0) > 0);
    }
  },

  updateBattleDuel(dt) {
    if (!this.isBattleMatch()) return;
    const s = this.state, b = s.battle;
    if (!b || !b.duel || !b.p2) return;
    const p2 = b.p2;
    if (p2.dead) return;

    // P1 as target object (live player hp)
    const p1Target = { id: "battle_p1", x: s.x, y: s.y, hp: s.hp, kind: "battlePilot" };

    // Order: for fairness flip who moves first each second (removes first-mover bias)
    const p2First = ((s.t * 2) | 0) % 2 === 0;

    const runP1Ai = () => {
    // Optional AI for P1 (balance sims) — same pilot tick as P2
    if (b.aiPilotP1 && !s.dead) {
      if (!b._p1Ai) {
        b._p1Ai = {
          thrust: (s.derived && s.derived.thrust) || 100,
          turnSpeed: (s.derived && s.derived.turnSpeed) || 100,
          weaponDmg: (s.derived && s.derived.weaponDmg) || 10,
          fireRate: (s.derived && s.derived.fireRate) || 1,
          fuelCostK: (s.derived && s.derived.fuelCostK) || 1,
          weapon: (typeof this.activeWeaponItem === "function") ? this.activeWeaponItem() : null,
          weaponCd: 0,
          ai: { standoff: 320, strafe: 1 },
          fleet: null,
          hp: s.hp,
        };
        // Full-rack parity with P2 — every armed weapon fires on its own
        // cooldown (a single-gun AI-P1 lost every even sim to a multi-gun P2).
        if (typeof ForgeEquipment !== "undefined" && ForgeEquipment.getEquipped) {
          const slots = (ForgeEquipment.getEquipped() || {}).slots || [];
          b._p1Ai.weapons = [];
          for (let i = 0; i < slots.length; i++)
            if (slots[i] && slots[i].weapon) b._p1Ai.weapons.push({ slot: i, item: slots[i] });
        }
        // Even AI-vs-AI: P1 uses normal; P2 uses b.aiDifficulty
        this.applyBattleAiDifficulty(b._p1Ai, b.p1AiDifficulty || "normal");
      }
      const p1Pilot = b._p1Ai;
      p1Pilot.x = s.x; p1Pilot.y = s.y; p1Pilot.vx = s.vx; p1Pilot.vy = s.vy;
      p1Pilot.heading = s.heading; p1Pilot.aimX = s.aimX; p1Pilot.aimY = s.aimY;
      p1Pilot.fuel = s.fuel; p1Pilot.fuelMax = s.fuelMax;
      p1Pilot.hp = s.hp; p1Pilot.invuln = s.invuln;
      p1Pilot.dead = false;
      // Keep weapon snapshot fresh once
      if (!p1Pilot.weapon && typeof this.activeWeaponItem === "function")
        p1Pilot.weapon = this.activeWeaponItem();
      this._battlePilotTick(p1Pilot, p2, dt, {
        onKill: () => { p2.dead = true; p2.state = "DEAD"; },
      });
      s.x = p1Pilot.x; s.y = p1Pilot.y; s.vx = p1Pilot.vx; s.vy = p1Pilot.vy;
      s.heading = p1Pilot.heading; s.aimX = p1Pilot.aimX; s.aimY = p1Pilot.aimY;
      s.weaponCd = p1Pilot.weaponCd; s.fuel = p1Pilot.fuel;
      s.invuln = p1Pilot.invuln;
    }
    };

    const runP2Ai = () => {
    // P2 AI → always hunts P1 (identical pilot code)
    this._battlePilotTick(p2, p1Target, dt, {
      onKill: () => { /* player death handled by hull check */ },
    });
    };

    if (p2First) { runP2Ai(); runP1Ai(); }
    else { runP1Ai(); runP2Ai(); }

    // Bounds clamp for both pilots (AI-P1 skips the main-loop clamp)
    const bounds = b.bounds;
    if (bounds) {
      const clampBody = (o, isPlayer) => {
        if (o.x < bounds.minX) { o.x = bounds.minX; if (o.vx < 0) o.vx = 0; }
        if (o.x > bounds.maxX) { o.x = bounds.maxX; if (o.vx > 0) o.vx = 0; }
        if (o.y < bounds.minY) { o.y = bounds.minY; if (o.vy < 0) o.vy = 0; }
        if (o.y > bounds.maxY) { o.y = bounds.maxY; if (o.vy > 0) o.vy = 0; }
        if (isPlayer) { s.x = o.x; s.y = o.y; s.vx = o.vx; s.vy = o.vy; }
      };
      if (b.aiPilotP1) clampBody(s, true);
      clampBody(p2, false);
    }

    // Sync duel HUD fractions
    b.objectives.duel = {
      p1Hull: s.hp.hullMax > 0 ? s.hp.hull / s.hp.hullMax : 0,
      p2Hull: p2.hp.hullMax > 0 ? p2.hp.hull / p2.hp.hullMax : 0,
      p1Ehp: (s.hp.shield || 0) + (s.hp.armor || 0) + (s.hp.hull || 0),
      p2Ehp: (p2.hp.shield || 0) + (p2.hp.armor || 0) + (p2.hp.hull || 0),
    };

    if (p2.hp.hull <= 0 && !p2.dead) {
      p2.dead = true; p2.state = "DEAD";
      this.endBattleMatch("p2_down");
    }
  },

  // Pure two-combatant sim (no player-state privilege). Used for balance labs.
  // opts.aDifficulty / bDifficulty default normal/normal for even ship tests.
  // Returns { winner: "A"|"B"|"draw", t, aEhp, bEhp, a0, b0 }.
  simEvenDuel(opts) {
    opts = opts || {};
    const hullKey = opts.hullKey || "atlas";
    const seed = opts.seed != null ? opts.seed : 1;
    const maxT = opts.maxSec != null ? opts.maxSec : 90;
    const dt = opts.dt || 1 / 20;
    const aDiff = opts.aDifficulty || "normal";
    const bDiff = opts.bDifficulty || opts.aiDifficulty || "normal";
    // Build a temporary player fit to capture a real combatant snapshot
    this.applyBattleSandboxLoadout({ hullKey, seed });
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    const snap = this.captureBattleCombatant("SIM");
    if (opts.noDrones) snap.fleet = [];

    const ang = (opts.spawnAngle != null) ? opts.spawnAngle : (seed % 360) * Math.PI / 180;
    const span = 900;
    const a = this._spawnBattlePilot(snap, Math.cos(ang) * span, Math.sin(ang) * span, 1);
    const b = this._spawnBattlePilot(snap, -Math.cos(ang) * span, -Math.sin(ang) * span, 2);
    a.label = "A"; b.label = "B";
    a.ai.strafe = 1; b.ai.strafe = -1;
    this.applyBattleAiDifficulty(a, aDiff);
    this.applyBattleAiDifficulty(b, bDiff);
    const a0 = a.hp.shield + a.hp.armor + a.hp.hull;
    const b0 = b.hp.shield + b.hp.armor + b.hp.hull;

    let t = 0, winner = "draw";
    while (t < maxT) {
      // alternate first mover every half-second
      if (((t * 2) | 0) % 2 === 0) {
        this._battlePilotTick(a, b, dt, {});
        this._battlePilotTick(b, a, dt, {});
      } else {
        this._battlePilotTick(b, a, dt, {});
        this._battlePilotTick(a, b, dt, {});
      }
      t += dt;
      if (a.hp.hull <= 0 && b.hp.hull <= 0) { winner = "draw"; break; }
      if (a.hp.hull <= 0) { winner = "B"; break; }
      if (b.hp.hull <= 0) { winner = "A"; break; }
    }
    if (winner === "draw" && t >= maxT) {
      const ae = a.hp.shield + a.hp.armor + a.hp.hull;
      const be = b.hp.shield + b.hp.armor + b.hp.hull;
      if (ae > be + 1) winner = "A";
      else if (be > ae + 1) winner = "B";
      else winner = "draw";
    }
    return {
      winner, t: Math.round(t),
      aEhp: Math.round(a.hp.shield + a.hp.armor + a.hp.hull),
      bEhp: Math.round(b.hp.shield + b.hp.armor + b.hp.hull),
      a0: Math.round(a0), b0: Math.round(b0),
      even: Math.abs(a0 - b0) < 1 && aDiff === bDiff,
      hullKey: snap.hullKey,
      weaponDmg: snap.weaponDmg,
      aDifficulty: aDiff, bDifficulty: bDiff,
    };
  },

  // All sandbox hull keys (for multi-hull balance suite).
  battleHullKeys() {
    return Object.keys(CONFIG.hulls || {});
  },

  drawBattleP2(g) {
    if (HEADLESS || !this.isBattleMatch()) return;
    const s = this.state;
    const p2 = s.battle && s.battle.p2;
    if (!p2 || p2.dead || !this.SF) return;
    const pt = this.SF(p2.x, p2.y);
    const z = s.cam.zoom || 1;
    const P = CONFIG.pitch || 1;
    // Same hull sprite language as P1 (ship_<hullKey>), so even matches look like real ships.
    const hullKey = p2.hullKey || (s.battle.p2Snap && s.battle.p2Snap.hullKey) || "atlas";
    const hullW = {
      vulture: 5.0, atlas: 6.0, aegis: 6.8,
      krag_ironclad: 6.6, krag_warbarge: 7.6, krag_dreadnought: 8.8,
      vex_lance: 6.8, vex_saber: 7.8, vex_executor: 9.0,
      nox_veil: 7.8, nox_umbra: 9.0, nox_eclipse: 10.4,
    }[hullKey] || 5.4;
    const shipW = (CONFIG.shipR || 16) * hullW * z;
    const heading = p2.heading != null ? p2.heading : 0;
    // Engine burn frame when moving
    const sp = Math.hypot(p2.vx || 0, p2.vy || 0);
    let frame = "";
    if (sp > 40) frame = ((s.t * 9 | 0) % 2) ? "_thrust_b" : "_thrust";
    if (frame && typeof ART !== "undefined" && ART.get && !ART.get("ship_" + hullKey + frame)) frame = "";

    g.save();
    if (p2.invuln > 0 && (s.t * 10 | 0) % 2) g.globalAlpha = 0.45;
    let drew = false;
    if (typeof ART !== "undefined" && ART.draw) {
      drew = ART.draw(g, "ship_" + hullKey + frame, pt.x, pt.y, shipW, heading);
      if (!drew) drew = ART.draw(g, "ship_" + hullKey, pt.x, pt.y, shipW, heading);
    }
    if (!drew && typeof SPRITES !== "undefined" && SPRITES.draw) {
      SPRITES.draw(g, "ship", pt.x, pt.y, 0.68 * z, heading);
      drew = true;
    }
    if (!drew) {
      // Last-resort wedge so P2 is never invisible
      const R = Math.max(8, 14 * z);
      g.translate(pt.x, pt.y);
      g.rotate(heading + Math.PI / 2);
      g.fillStyle = p2.color || "#ff6a5e";
      g.strokeStyle = "rgba(255,255,255,0.4)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -R); g.lineTo(R * 0.7, R * 0.7); g.lineTo(0, R * 0.35); g.lineTo(-R * 0.7, R * 0.7);
      g.closePath(); g.fill(); g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();

    // Shield ring (same language as player)
    if (p2.hp && p2.hp.shield > 0 && p2.hp.shieldMax > 0) {
      const sr = ((CONFIG.shipR || 16) + 7) * z;
      const a = 0.22 + 0.14 * (p2.hp.shield / p2.hp.shieldMax);
      g.strokeStyle = "rgba(255,120,100," + Math.min(0.85, a) + ")";
      g.lineWidth = Math.max(1, 2 * z);
      g.beginPath(); g.ellipse(pt.x, pt.y, sr, sr * P, 0, 0, Math.PI * 2); g.stroke();
    }

    // HP pip + label
    const barW = Math.max(28, 22 * z);
    const barY = pt.y - (CONFIG.shipR || 16) * hullW * z * 0.55 - 12;
    const ehp = (p2.hp.shield + p2.hp.armor + p2.hp.hull);
    const max = (p2.hp.shieldMax + p2.hp.armorMax + p2.hp.hullMax) || 1;
    const frac = clamp(ehp / max, 0, 1);
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(pt.x - barW / 2, barY, barW, 4);
    g.fillStyle = frac > 0.35 ? "#ff6a5e" : "#ff2b2b";
    g.fillRect(pt.x - barW / 2, barY, barW * frac, 4);
    g.fillStyle = "#ffb0a0";
    g.font = "bold " + Math.max(9, Math.round(10 * z)) + "px monospace";
    g.textAlign = "center";
    g.fillText(p2.label || "P2", pt.x, barY - 4);
    g.textAlign = "left";

    // Wing drones — real drone sprites when available
    if (p2.fleet) {
      for (const d of p2.fleet) {
        if ((d.hp || 0) <= 0) continue;
        const dp = this.SF(d.x, d.y);
        const ang = Math.atan2(d.y - p2.y, d.x - p2.x);
        const sz = Math.max(8, 11 * z);
        let ddrew = false;
        if (typeof ART !== "undefined" && ART.draw) {
          const key = "drone_t" + (d.tier || 0);
          ddrew = ART.draw(g, key, dp.x, dp.y, sz * 2.4, ang);
          if (!ddrew) ddrew = ART.draw(g, "ship_drone", dp.x, dp.y, sz * 2.2, ang);
        }
        if (!ddrew && typeof this.drawDroneShape === "function") {
          this.drawDroneShape(g, dp.x, dp.y, ang, sz * 0.7, "#ffb45e");
        } else if (!ddrew) {
          g.fillStyle = "#ffb45e";
          g.beginPath(); g.arc(dp.x, dp.y, Math.max(2.5, 3.5 * z), 0, Math.PI * 2); g.fill();
        }
      }
    }
  },
});
