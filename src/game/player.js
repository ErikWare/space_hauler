/*=== HARNESS:PLAYER =========================================================*/
// Ship state (3-layer health block), the burst/constant impulse engine, fuel,
// health regen, the tractor tow chain, and the combat wiring that delegates to
// ForgeEquipment (skills/stats), ForgeCombat (lock/fire/death) and
// ForgeFaction (alien AI/loot).
Object.assign(GAME, {
  // ---- multi-ship registry (per-ship loadouts live on s.ships[i].slots; the
  // ForgeEquipment singleton is always "the ACTIVE ship's rack") ----
  activeShip() {
    const s = this.state;
    return (s && s.ships && s.ships.find(sh => sh.id === s.activeShipId)) || null;
  },
  activeHull() {
    const sh = this.activeShip();
    return (sh && CONFIG.hulls[sh.hullKey]) || CONFIG.hulls.vulture;   // fallback: freshHp() runs mid-state-literal, before s.ships exists
  },
  // Per-hull module rack size (3–6). CONFIG.equipSlots is the absolute max.
  hullEquipSlots(hull) {
    hull = hull || this.activeHull();
    const n = (hull && hull.equipSlots != null) ? hull.equipSlots : CONFIG.equipSlots;
    return Math.max(1, Math.min(CONFIG.equipSlots, n | 0));
  },
  // Resize a slots array to n: keep fitted modules that fit, dump overflow to inventory.
  _resizeShipSlots(slots, n, s) {
    slots = Array.isArray(slots) ? slots.slice() : [];
    while (slots.length < n) slots.push(null);
    if (slots.length > n) {
      const dump = slots.splice(n);
      if (s) {
        s.inventory = s.inventory || [];
        for (const it of dump) if (it) s.inventory.push(it);
      }
    }
    return slots;
  },
  // mirror the live rack into the active ship's record (call after any equip change)
  _syncActiveShipSlots() {
    const sh = this.activeShip();
    if (sh) sh.slots = ForgeEquipment.getEquipped().slots;
  },
  freshHp() {
    const b = this.activeHull().baseShip;
    return { shield: b.shieldMax, shieldMax: b.shieldMax, armor: b.armorMax, armorMax: b.armorMax,
             hull: b.hullMax, hullMax: b.hullMax, res: { shield: b.res.shield, armor: b.res.armor, hull: b.res.hull },
             shieldRegen: b.shieldRegen, armorRepair: b.armorRepair, shieldDelay: b.shieldDelay, _sinceHit: 99 };
  },

  // Swap the live rack to another owned ship (docked only). Snapshot the
  // outgoing loadout, atomically wipe slots+skills (initEquipment — no stale
  // auto-fire/cooldowns), then load the incoming loadout into the empty rack.
  // opts.quiet skips the toast (buyShipUpgrade announces the new hull itself).
  switchActiveShip(shipId, opts) {
    const s = this.state;
    if (!s.docked) { toast("ship swap needs a dock"); sfx("warn"); return { ok: false, reason: "not docked" }; }
    const next = s.ships.find(sh => sh.id === shipId);
    if (!next) return { ok: false, reason: "no such ship" };
    if (shipId === s.activeShipId) return { ok: false, reason: "already active" };
    const cur = this.activeShip();
    if (cur) {
      cur.slots = ForgeEquipment.getEquipped().slots;      // snapshot OUT before the wipe
      const curHull = CONFIG.hulls[cur.hullKey] || CONFIG.hulls.vulture;
      cur.slots = this._resizeShipSlots(cur.slots, this.hullEquipSlots(curHull), s);
    }
    const nextHull = CONFIG.hulls[next.hullKey] || CONFIG.hulls.vulture;
    const nSlots = this.hullEquipSlots(nextHull);
    next.slots = this._resizeShipSlots(next.slots, nSlots, s);
    ForgeEquipment.initEquipment(nSlots);
    next.slots.forEach((item, i) => { if (item) ForgeEquipment.equip(i, item); });
    s.activeShipId = shipId;
    ForgeEquipment.restockAmmo();
    this.recomputeDerived();
    if (this.enforceEscortCap) this.enforceEscortCap(s);   // larger→smaller hull shrinks the wing
    s.hp = this.freshHp();                                        // fresh boat off the dock (dock heals anyway)
    s.fuel = Math.min(s.fuel, s.fuelMax);
    s.weaponCd = 0;
    if (!(opts && opts.quiet)) { toast("★ " + next.name + " is now active", "#57d1c9"); sfx("buy"); }
    return { ok: true, shipId };
  },

  homeStationObj() {
    const s = this.state, stations = ForgeWorld.getStations();
    return stations.find(st => st.id === s.homeStationId) || stations[0];
  },

  // derive all ship performance from the equipped fit each frame (ForgeEquipment)
  _sumAttr(items, key) {
    let v = 0;
    for (const it of items) {
      if (it.base_stats && it.base_stats[key]) v += it.base_stats[key];
      if (it.specials) for (const sp of it.specials) if (sp.key === key) v += sp.val;
    }
    return v;
  },
  recomputeDerived() {
    const hull = this.activeHull();
    const s = this.state, d = ForgeEquipment.getActiveStats(hull.baseShip), h = s.hp;
    s.derived = d;
    // Tractor derivations first — tow slots need the hull base + affixes resolved
    // BEFORE the skill tree adds to them (else the skill bonus gets overwritten).
    const eq = ForgeEquipment.getEquipped().slots.filter(Boolean);
    d.tractorLock = 600 * (1 + this._sumAttr(eq, "tractor_lock_pct") / 100);
    // base tow slots from the active hull (+1 per Additional Tow Slots module)
    d.tractorSlots = hull.baseTows + this._sumAttr(eq, "tractor_slots_flat");
    d.towDrag = Math.max(0.3, 1 - this._sumAttr(eq, "tractor_drag_pct") / 100);
    d.towCapacity = 1 * (1 + this._sumAttr(eq, "tractor_cap_pct") / 100);
    // Skill tree: stack allocated perks on top of the equipped fit and build the
    // per-weapon modifier block (d.wpnSkill) the fire path reads. (skills.js)
    if (this.applySkillsToDerived) this.applySkillsToDerived(d, s.skills);
    // Mirror the finalized maxes onto live hp (after equipment AND skills).
    h.shieldMax = d.shieldMax; h.armorMax = d.armorMax; h.hullMax = d.hullMax;
    h.shieldRegen = d.shieldRegen; h.armorRepair = d.armorRepair; h.shieldDelay = d.shieldDelay;
    h.res.shield = d.res.shield; h.res.armor = d.res.armor; h.res.hull = d.res.hull;
    if (h.shield > h.shieldMax) h.shield = h.shieldMax;
    if (h.armor > h.armorMax) h.armor = h.armorMax;
    if (h.hull > h.hullMax) h.hull = h.hullMax;
    s.fuelMax = d.fuelMax;
    if (s.fuel > s.fuelMax) s.fuel = s.fuelMax;
    // Phase 6: +1 permanent slot per claimed 3-shipwreck territory milestone —
    // added to the hard cap too, so the reward is never dead on a maxed fit
    const cargoBonus = this.objectiveCargoBonus ? this.objectiveCargoBonus() : 0;
    d.tractorSlots += cargoBonus;
    s.towsCap = Math.min(6 + cargoBonus, d.tractorSlots);
    if (this.reapplyDroneStats) this.reapplyDroneStats(s);   // drone-skill max HP/shield/fuel (skills.js)
    return d;
  },

  // ---- dual engine (CONSTANT accelerate / BURST charge-release) ----
  tickEngine(dt) {
    const s = this.state, towing = s.tows.length > 0;
    let towMass = 0;
    for (const t of s.tows) towMass += (t.arr === "rocks" ? this.towBody(t).mass : CONFIG.junkMass);
    // tractorStr (Magnetic Grip skill / tow affixes) eases the tow-mass penalty:
    // a stronger beam hauls heavy loads with less fuel cost + speed loss.
    const towMult = (1 + towMass * CONFIG.towK / (s.derived.tractorStr || 1)) * (s.derived.fuelCostK || 1);
    const thrustMul = s.derived.thrust / 100 * (s.thrustPower || 0.75);
    const dirMag = Math.hypot(input.ax, input.ay);
    if (dirMag > 0.02) { s.aimX = input.ax / dirMag; s.aimY = input.ay / dirMag; s.heading = Math.atan2(s.aimY, s.aimX); }
    if (s.mode === "constant") {
      if (dirMag > 0.02 && s.fuel > 0.01) {
        const cost = CONFIG.thrustFuelRate * towMult * dt, eff = cost > 0 ? Math.min(1, s.fuel / cost) : 0;
        const acc = CONFIG.accel * thrustMul * eff;
        s.vx += s.aimX * acc * dt; s.vy += s.aimY * acc * dt;
        s.fuel = Math.max(0, s.fuel - cost * eff);
        if (!s.thrusting) sfx("boost"); s.thrusting = true;
        s.charge = lerp(s.charge, eff, Math.min(1, 12 * dt));
      } else { s.thrusting = false; s.charge = lerp(s.charge, 0, Math.min(1, 12 * dt)); }
    } else {
      if (dirMag > 0.02) { s.thrusting = true; if (s.fuel > 0.01) s.holdT += dt; s.charge = clamp(s.holdT / CONFIG.chargeTime, 0, 1); }
      else if (s.holdT > 0) {
        const c = s.charge, cost = c * CONFIG.burstCost * towMult, eff = cost > 0 ? Math.min(1, s.fuel / cost) : 0;
        if (eff > 0) { const imp = c * CONFIG.impulse * thrustMul * eff;
          s.vx += s.aimX * imp; s.vy += s.aimY * imp; s.fuel = Math.max(0, s.fuel - cost * eff); s.flare = 0.5 + c * 0.8; sfx("boost"); }
        s.holdT = 0; s.charge = 0; s.thrusting = false;
      }
    }
    s.flare = Math.max(0, s.flare - 2.2 * dt);
    return towing;
  },

  // fuel floor: solar trickle so a dry tank is never a hard softlock
  tickFuel(dt) {
    const s = this.state;
    if (s.fuel <= 0.01 && !s.fuelOut) { s.fuelOut = true; sfx("warn");
      if (s.tows.length) { this.dropAllTows(); toast("FUEL OUT — loads dropped"); }
      toast("FUEL OUT — solar trickle charging"); }
    const solar = (s.derived && s.derived.solarRegen) || CONFIG.solarRegen;
    if (s.fuel < CONFIG.solarMax) s.fuel = Math.min(CONFIG.solarMax, s.fuel + solar * dt);
    if (s.fuelOut && s.fuel > s.fuelMax * 0.3) s.fuelOut = false;
    if (!s.warned && s.fuel < s.fuelMax * 0.25) { s.warned = true; sfx("warn"); toast("fuel low"); }
    if (s.fuel > s.fuelMax * 0.3) s.warned = false;
  },

  // health regen: shield after shieldDelay since last hit; armor only if a
  // repair module grants passive armorRepair. Hull never regens passively.
  tickHealth(dt) {
    const s = this.state, h = s.hp;
    h._sinceHit += dt; s.invuln = Math.max(0, s.invuln - dt); s.flash = Math.max(0, s.flash - dt);
    s.shieldFlash = Math.max(0, (s.shieldFlash || 0) - dt);
    s.fireAnimT = Math.max(0, (s.fireAnimT || 0) - dt);   // muzzle-flash frame timer (rendering.js)
    if (h._sinceHit >= (h.shieldDelay || 3) && h.shield < h.shieldMax) h.shield = Math.min(h.shieldMax, h.shield + h.shieldRegen * dt);
    if (h.armorRepair > 0 && h.armor < h.armorMax) h.armor = Math.min(h.armorMax, h.armor + h.armorRepair * dt);
  },

  // ---- skill slots (ForgeEquipment) ----
  tickSkills(dt) {
    const s = this.state;
    const ship = { shield: s.hp.shield, shieldMax: s.hp.shieldMax, armor: s.hp.armor, armorMax: s.hp.armorMax,
                   hull: s.hp.hull, hullMax: s.hp.hullMax, fuel: s.fuel, fuelMax: s.fuelMax };
    const fired = ForgeEquipment.tickSkills(dt * 1000, ship);
    s.hp.shield = ship.shield; s.hp.armor = ship.armor; s.hp.hull = ship.hull; s.fuel = ship.fuel;
    if (fired && fired.length) { sfx("buy"); for (let k = 0; k < fired.length; k++) burst(s.x, s.y, "#7df9ff", 5); }
    return fired;
  },
  toggleSkill(i) {
    const st = ForgeEquipment.getSkillState()[i];
    if (!st || !st.item) return false;
    if (st.active) { ForgeEquipment.deactivateSkill(i); toast(st.item.name + " off"); }
    else { ForgeEquipment.activateSkill(i); toast(st.item.name + " ON"); sfx("boost"); }
    return true;
  },

  // ---- weapons (ForgeCombat) ----
  // The first equipped weapon whose skill button is toggled ON (auto-fire enabled).
  // A weapon sits idle until its left-column skill button activates it (V3 rule).
  activeWeaponItem() {
    const eq = ForgeEquipment.getEquipped(), sk = ForgeEquipment.getSkillState();
    for (let i = 0; i < eq.slots.length; i++) {
      const it = eq.slots[i];
      if (it && it.weapon && sk[i] && sk[i].active) return it;
    }
    return null;
  },
  tryFireWeapon(dt) {
    const s = this.state;
    s.weaponCd = Math.max(0, (s.weaponCd || 0) - dt * 1000);
    if (!ForgeCombat.isLocked() || s.weaponCd > 0) return;
    const w = this.activeWeaponItem(); if (!w) return;
    const target = this.findCombatTarget(ForgeCombat.getLock().targetId);
    if (!target) return;
    if (typeof target.hp === "number") { this.fireAtRock(target, w); return; }
    if (target.kind === "outpost") { this.fireAtOutpost(target, w); return; }
    if (target.kind === "emplacement") { this.fireAtEmplacement(target, w); return; }
    if (target.kind === "torpedo") { this.fireAtTorpedo(target, w); return; }
    // Range gate: only fire if target is within weapon range (range affixes + skill range mult)
    const weapRange = (w.weapon.range || 800) * (1 + (s.derived.weaponRange || 0) / 100) * this.wpnRangeMult(w.weapon.type);
    const tgtDist = Math.hypot(target.x - s.x, target.y - s.y);
    if (tgtDist > weapRange) { s._outOfRange = 60; return; }  // blink HUD indicator, don't fire
    s._outOfRange = 0;
    // territoryDamageMult: Phase 6 +10% in wedges whose 50-pirate milestone is claimed
    const shipState = { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg * this.territoryDamageMult(s.x, s.y),
                        fireRate: s.derived.fireRate, fuel: s.fuel, fuelCostK: s.derived.fuelCostK };
    this.applyWpnMods(shipState, w.weapon.type);   // per-weapon skill perks (dmg/fuel/crit/hit/layer/aoe)
    const preShield = target.hp.shield;   // which layer the hit sound lands on
    const res = ForgeCombat.fireWeapon(w, target, s.aliens, shipState);
    if (res.ok) {
      AUDIO.play("shoot");
      s.fuel = shipState.fuel;
      s.weaponCd = ForgeCombat.weaponCooldownMs(w, shipState);
      s.flare = Math.max(s.flare, 0.4);
      s.fireAnimType = w.weapon.type; s.fireAnimT = 0.25;   // swap in the muzzle-flash flight frame
      if (res.hit) { AUDIO.play(preShield > 0 ? "hit_shield" : "hit_armor");
        const tag = res.crit ? "CRIT " + res.damage : res.glancing ? "graze " + res.damage : "-" + res.damage;
        toast(tag, res.crit ? "#ffd27a" : res.glancing ? "#9aa7b8" : "#ff8f6b"); }
      if (res.dead) { if (target.kind === "enemyBase") this.onEnemyBaseDestroyed(target); else this.onAlienKilled(target); }
    } else if (res.reason === "insufficient fuel") { toast("no fuel to fire"); }
  },
  // Manual rock fire is allowed but gives NO reward — rocks yield ore only by
  // towing them home. A towed rock is immune. Destroying a rock is pure loss.
  fireAtRock(rock, w) {
    const s = this.state;
    const idx = s.rocks.indexOf(rock);
    if (idx >= 0 && this.isTowed("rocks", idx)) { ForgeCombat.clearLock(); return; }  // towed = immune
    const wrapper = { id: rock.id, x: rock.x, y: rock.y,
                      hp: { shield: 0, armor: 0, hull: rock.hp, res: {} } };
    const shipState = { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg, fireRate: s.derived.fireRate,
                        fuel: s.fuel, fuelCostK: s.derived.fuelCostK };
    this.applyWpnMods(shipState, w.weapon.type);   // per-weapon skill perks
    const res = ForgeCombat.fireWeapon(w, wrapper, [], shipState);
    if (res.ok) {
      AUDIO.play("shoot");
      s.fuel = shipState.fuel;
      s.weaponCd = ForgeCombat.weaponCooldownMs(w, shipState);
      s.flare = Math.max(s.flare, 0.4);
      s.fireAnimType = w.weapon.type; s.fireAnimT = 0.25;   // swap in the muzzle-flash flight frame
      if (res.hit) { rock.hp = Math.max(0, wrapper.hp.hull); rock.hitFlash = 0.3; }
      if (rock.hp <= 0) {                              // destroyed → no ore, just gone
        if (idx >= 0) { burst(rock.x, rock.y, rock.col, 12); sfx("crunch"); this.respawnRock(idx); }
        ForgeCombat.clearLock();
      }
    } else if (res.reason === "insufficient fuel") { toast("no fuel to fire"); }
  },

  // Auto-scan: find and lock the nearest hostile alien within scan range.
  // Cycles through enemies if one is already dead or locked — call on SCAN button tap
  // and automatically after each kill to chain targets.
  scanNearestEnemy() {
    const s = this.state;
    const curLockId = ForgeCombat.getLock().targetId;
    let best = null, bd = s.derived.scanRange;
    for (const al of s.aliens) {
      if (al.state === "DEAD") continue;
      if (al.id === curLockId) continue;  // skip current target (allow cycling)
      const d = Math.hypot(al.x - s.x, al.y - s.y);
      if (d < bd) { bd = d; best = al; }
    }
    // If nothing else found but the current target is still alive, keep it
    if (!best && curLockId) {
      const cur = this.findCombatTarget(curLockId);
      if (cur && cur.state !== "DEAD") return;  // already locked on something good
    }
    if (best) { this.lockAlien(best); return true; }
    // Also scan enemy bases if no aliens
    for (const al of s.aliens) {
      if (al.kind !== "enemyBase") continue;
      const d = Math.hypot(al.x - s.x, al.y - s.y);
      if (d <= s.derived.scanRange) { this.lockAlien(al); return true; }
    }
    ForgeCombat.clearLock();
    toast("no targets in scan range");
    return false;
  },
  lockAlien(al) {
    const s = this.state, shipState = { x: s.x, y: s.y, scanRange: s.derived.scanRange, targets: s.aliens };
    const ok = ForgeCombat.lockOn(al, shipState);
    if (ok) {
      if (al.kind === "enemyBase") {
        for (const a of s.aliens) if (a._baseId === al.id && a.state === "IDLE") ForgeFaction.activateGroup(a, s.aliens);
      } else if (al.kind === "outpost") {
        this._provokeOutpost(al);
      } else if (al.kind === "emplacement") {
        this._provokeSite(this.siteById(al.siteId));   // waking the platform wakes the garrison
      } else if (al.kind === "torpedo") {
        /* just a lock — torpedoes have no group */
      } else ForgeFaction.activateGroup(al, s.aliens);
      sfx("grab"); toast("acquiring lock…");
    } else toast("target out of scan range");
    return ok;
  },
  _provokeOutpost(o) {   // locking or shooting the platform wakes its garrison
    const s = this.state;
    if (o.provoked) return;
    o.provoked = true;
    const g0 = (o._ships || []).find(sh => sh.state !== "DEAD" && sh.hp.hull > 0);
    if (g0) ForgeFaction.activateGroup(g0, s.aliens);
  },
  // Player weapons vs an enemy outpost structure: the platform's flat 3-layer
  // pools wrap into a ForgeCombat-shaped target for one shot (same trick as
  // fireAtRock), then write back. Hull to 0 flips the platform to player
  // control — outposts are captured, never destroyed.
  fireAtOutpost(o, w) {
    const s = this.state;
    if (o.owner === "player") { ForgeCombat.clearLock(); return; }
    const wrapper = { id: o.id, x: o.x, y: o.y,
      hp: { shield: o.shield, shieldMax: o.shieldMax, armor: o.armor, armorMax: o.armorMax,
            hull: o.hull, hullMax: o.hullMax, res: { shield: 0, armor: 0, hull: 0 }, _sinceHit: 0 } };
    const shipState = { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg * this.territoryDamageMult(s.x, s.y),
                        fireRate: s.derived.fireRate, fuel: s.fuel, fuelCostK: s.derived.fuelCostK };
    this.applyWpnMods(shipState, w.weapon.type);   // per-weapon skill perks
    const res = ForgeCombat.fireWeapon(w, wrapper, [], shipState);
    if (res.ok) {
      AUDIO.play("shoot");
      s.fuel = shipState.fuel;
      s.weaponCd = ForgeCombat.weaponCooldownMs(w, shipState);
      s.flare = Math.max(s.flare, 0.4);
      s.fireAnimType = w.weapon.type; s.fireAnimT = 0.25;   // swap in the muzzle-flash flight frame
      this._provokeOutpost(o);
      if (res.hit) {
        AUDIO.play(o.shield > 0 ? "hit_shield" : "hit_armor");
        o.shield = wrapper.hp.shield; o.armor = wrapper.hp.armor; o.hull = wrapper.hp.hull;
        const tag = res.crit ? "CRIT " + res.damage : res.glancing ? "graze " + res.damage : "-" + res.damage;
        toast(tag, res.crit ? "#ffd27a" : res.glancing ? "#9aa7b8" : "#ff8f6b");
      }
      if (o.hull <= 0) this._captureOutpostByForce(o);
    } else if (res.reason === "insufficient fuel") { toast("no fuel to fire"); }
  },
  // Player weapons vs a site base emplacement. The platform carries a real 3-layer
  // hp block (armor+hull), so it wraps like an alien but resolves to _destroyEmplacement
  // (loot payout) at hull 0 — never onAlienKilled. Firing wakes the site garrison.
  fireAtEmplacement(emp, w) {
    const s = this.state;
    if (emp.destroyed) { ForgeCombat.clearLock(); return; }
    const wrapper = { id: emp.id, x: emp.x, y: emp.y, hp: emp.hp };   // applyDamage mutates emp.hp in place
    const shipState = { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg * this.territoryDamageMult(s.x, s.y),
                        fireRate: s.derived.fireRate, fuel: s.fuel, fuelCostK: s.derived.fuelCostK };
    this.applyWpnMods(shipState, w.weapon.type);
    const res = ForgeCombat.fireWeapon(w, wrapper, [], shipState);
    if (res.ok) {
      AUDIO.play("shoot"); s.fuel = shipState.fuel;
      s.weaponCd = ForgeCombat.weaponCooldownMs(w, shipState); s.flare = Math.max(s.flare, 0.4);
      s.fireAnimType = w.weapon.type; s.fireAnimT = 0.25;   // swap in the muzzle-flash flight frame
      this._provokeSite(this.siteById(emp.siteId));
      if (res.hit) {
        AUDIO.play(emp.hp.armor > 0 ? "hit_shield" : "hit_armor");
        const tag = res.crit ? "CRIT " + res.damage : res.glancing ? "graze " + res.damage : "-" + res.damage;
        toast(tag, res.crit ? "#ffd27a" : res.glancing ? "#9aa7b8" : "#ff8f6b");
      }
      if (emp.hp.hull <= 0) this._destroyEmplacement(emp);
    } else if (res.reason === "insufficient fuel") { toast("no fuel to fire"); }
  },
  // Shoot down an inbound torpedo drone (its own small hull pool). Death is settled
  // by _updateEmpProjectiles the next frame (burst + delist + clear lock).
  fireAtTorpedo(tp, w) {
    const s = this.state;
    const wrapper = { id: tp.id, x: tp.x, y: tp.y, hp: tp.hp };
    const shipState = { x: s.x, y: s.y, weaponDmg: s.derived.weaponDmg * this.territoryDamageMult(s.x, s.y),
                        fireRate: s.derived.fireRate, fuel: s.fuel, fuelCostK: s.derived.fuelCostK };
    this.applyWpnMods(shipState, w.weapon.type);
    const res = ForgeCombat.fireWeapon(w, wrapper, [], shipState);
    if (res.ok) {
      AUDIO.play("shoot"); s.fuel = shipState.fuel;
      s.weaponCd = ForgeCombat.weaponCooldownMs(w, shipState); s.flare = Math.max(s.flare, 0.4);
      s.fireAnimType = w.weapon.type; s.fireAnimT = 0.25;   // swap in the muzzle-flash flight frame
      if (res.hit) { AUDIO.play("hit_armor"); burst(tp.x, tp.y, "#ff9a3c", 4); }
    } else if (res.reason === "insufficient fuel") { toast("no fuel to fire"); }
  },
  lockRock(rockIdx) {
    const s = this.state, r = s.rocks[rockIdx];
    const ok = ForgeCombat.lockOn(r, { x: s.x, y: s.y, scanRange: s.derived.scanRange });
    if (ok) { sfx("grab"); toast("targeting asteroid…"); }
    else toast("asteroid out of range");
    return ok;
  },
  updateLock(dt) {
    const s = this.state, lock = ForgeCombat.getLock();
    if (lock.targetId == null) return;
    const t = this.findCombatTarget(lock.targetId);
    if (!t) { ForgeCombat.clearLock(); return; }
    ForgeCombat.lockOn(t, { x: s.x, y: s.y, scanRange: s.derived.scanRange, targets: s.aliens });
  },

  // ---- alien AI (ForgeFaction) — aliens fire on the player inside updateAlienAI ----
  updateAliens(dt) {
    const s = this.state;
    const playerState = { x: s.x, y: s.y, hp: s.hp, nebulae: ForgeWorld.getNebulas().map(n => ({ x: n.pos.x, y: n.pos.y })) };
    for (const al of s.aliens) {
      if (al.state === "DEAD") continue;
      ForgeFaction.updateAlienAI(al, playerState, s.aliens, dt);
      if (al.x != null) { const d = this.dist(s.x, s.y, al.x, al.y);
        if (d < (al.r || 15) + CONFIG.shipR && s.invuln <= 0 && !s.atStation) this.damageShip(4 + (al.isLeader ? 4 : 0)); }  // ram — no collision inside station exclusion zone
    }
    if (s.hp.hull <= 0 && !s.dead) this.onShipDestroyed();
    for (let i = s.aliens.length - 1; i >= 0; i--) { const al = s.aliens[i];
      if (al.hp.hull <= 0 && !al._looted) this.onAlienKilled(al); }
  },
  onAlienKilled(al) {
    if (al._looted) return; al._looted = true; al.state = "DEAD";
    const s = this.state;
    burst(al.x, al.y, al.color, 22); burst(al.x, al.y, "#ffd27a", 14); AUDIO.play("explosion");
    // ForgeFaction.getDrops decides WHICH items drop; the danger table decides
    // their tier — kill in null-sec, loot rolls toward Unique/Elite
    const dl = al._dangerLevel || getDangerLevel(al.x, al.y);
    for (const it of ForgeFaction.getDrops(al)) {
      const item = ForgeItemSystem.generateItem(it.base, rollDangerTier(dl, rnd), { ilvl: al.ilvl || 1, rng: rnd });
      s.loot.push({ x: al.x + (rnd() - 0.5) * 24, y: al.y + (rnd() - 0.5) * 24, vx: (rnd() - 0.5) * 24, vy: (rnd() - 0.5) * 24, item, t: 0 });
    }
    // credit bounty orb — base by ship tier × the wedge's reward multiplier
    const rw = al._rewardMult != null ? al._rewardMult : dangerEnemyMult(dl).reward;
    const bounty = Math.round((DANGER.bounty[al.tier] || DANGER.bounty.normal) * rw);
    if (bounty > 0)
      s.loot.push({ x: al.x + (rnd() - 0.5) * 24, y: al.y + (rnd() - 0.5) * 24, vx: (rnd() - 0.5) * 24, vy: (rnd() - 0.5) * 24, credits: bounty, t: 0 });
    toast(al.isLeader ? "ELITE DOWN" : "alien down", al.isLeader ? "#ffb020" : "#e8edf4");
    if (ForgeCombat.getLock().targetId === al.id) ForgeCombat.clearLock();
    const i = s.aliens.indexOf(al); if (i >= 0) s.aliens.splice(i, 1);
    this.onContractKill(al);   // Phase 4: strike/pirate/bounty progress
    this.onTraderRaiderKilled(al);   // Phase 6: "save the convoy" bonus check
    this.onFactionShipKilled(al);    // faction politics: kill ledger → patrol aggression
    this.onObjectiveKill(al);        // Phase 6: territory pirate/battle ledgers (game/objectives.js)
    // Auto-advance: if the active weapon is armed, immediately scan for the next target
    if (this.activeWeaponItem()) setTimeout(() => this.scanNearestEnemy(), 200);
  },
  updateLoot(dt) {
    const s = this.state;
    for (let i = s.loot.length - 1; i >= 0; i--) {
      const L = s.loot[i]; L.x += L.vx * dt; L.y += L.vy * dt; L.vx *= 0.95; L.vy *= 0.95; L.t += dt;
      if (this.dist(s.x, s.y, L.x, L.y) < CONFIG.lootPickR) {
        // Phase 6 trader spills: credit orbs bank directly, ore orbs stack in the hold
        if (L.credits) { s.credits += L.credits; sfx("sell"); toast(`+${L.credits}cr salvaged`, "#ffd24a"); this.checkWin(); }
        else if (L.ore) {
          const slot = s.ore[L.ore] || (s.ore[L.ore] = { count: 0, bonus: false }); slot.count += 1;
          sfx("grab"); toast("+ " + (CONFIG.oreNames[L.ore] || L.ore), (CONFIG.rings.find(r => r.type === L.ore) || {}).col);
        } else {
          s.inventory.push(L.item); sfx("grab"); toast("+ " + L.item.name, CONFIG.rarityCol[L.item.tier]);
          this.onContractItem(L.item);   // Phase 4: salvage-contract pickup hook
        }
        s.loot.splice(i, 1);
      } else if (L.t > 90) s.loot.splice(i, 1);
    }
  },
  onShipDestroyed() {
    const s = this.state, home = this.homeStationObj();
    ForgeCombat.onPlayerDeath(s, { x: home.pos.x, y: home.pos.y });
    s.cam.x = s.x; s.cam.y = s.y;
    s.fuel = Math.max(s.fuel, s.fuelMax * 0.5); s.invuln = CONFIG.invulnT * 4;
    if (s.tows.length) this.dropAllTows();
    for (const al of s.aliens) { al.aggro = false; if (al.state !== "DEAD") al.state = "IDLE"; }
    sfx("boom"); toast("SHIP DESTROYED — recovered at " + home.name + " (−" + CONFIG.defeatPenalty + "cr)");
    this.onPlayerDeathContracts();   // Phase 4: defender down → defense contract fails
  },

  // ---- tractor tow chain ----
  towBody(t) { return t.arr === "rocks" ? this.state.rocks[t.i] : this.state.junk[t.i]; },
  towRadius(t) { const b = this.towBody(t); return t.arr === "rocks" ? b.size * 20 : b.r; },
  isTowed(arr, i) { return this.state.tows.some(t => t.arr === arr && t.i === i); },
  nearestGrabbable(range) {
    const s = this.state; let best = null, bd = range;
    for (let i = 0; i < s.rocks.length; i++) { if (!s.rocks[i].active || this.isTowed("rocks", i)) continue;
      const d = this.shipTo(s.rocks[i]); if (d < bd) { bd = d; best = { arr: "rocks", i }; } }
    for (let i = 0; i < s.junk.length; i++) { if (!s.junk[i].active || this.isTowed("junk", i)) continue;
      const d = this.shipTo(s.junk[i]); if (d < bd) { bd = d; best = { arr: "junk", i }; } }
    return best;
  },
  // dock zones (station dockR / outpost dockR) auto-deposit tows, so grabbing
  // NEW tows inside one would bank rocks/junk without ever flying to them.
  // Blocking the grab (not the deposit) forces the intended loop: fly out,
  // tractor the haul, pull it back in. Releasing a tow is always allowed.
  inDockZone() {
    const s = this.state;
    if (s.atStation) return true;
    if (s.outposts) for (const o of s.outposts)
      if (this.dist(s.x, s.y, o.x, o.y) < CONFIG.outpostDockR) return true;
    return false;
  },
  grabTow(arr, i) {
    const s = this.state;
    if (this.isTowed(arr, i)) return false;
    if (this.inDockZone()) { toast("tractor offline in dock zone — haul from open space"); sfx("warn"); return false; }
    if (s.tows.length >= s.towsCap) { toast(`tractor full (${s.towsCap})`); sfx("warn"); return false; }
    const b = arr === "rocks" ? s.rocks[i] : s.junk[i];
    // stamp the sec rating of the grab site — turn-in yields scale by where the
    // haul CAME FROM, not by the (usually safe) wedge it gets sold in
    s.tows.push({ arr, i, dangerLevel: getDangerLevel(b.x, b.y) });
    b.vx = s.vx; b.vy = s.vy;
    sfx("grab"); toast(`tractor lock: ${arr === "rocks" ? b.type.toUpperCase() : "DEBRIS"} (${s.tows.length}/${s.towsCap})`);
    return true;
  },
  releaseTowAt(arr, i) {
    const s = this.state, k = s.tows.findIndex(t => t.arr === arr && t.i === i);
    if (k < 0) return false;
    const b = this.towBody(s.tows[k]); b.vx = s.vx * 0.6; b.vy = s.vy * 0.6;
    s.tows.splice(k, 1); sfx("drop"); toast("released"); return true;
  },
  dropAllTows() {
    const s = this.state; if (!s.tows.length) return;
    for (const t of s.tows) { const b = this.towBody(t); b.vx = s.vx * 0.6; b.vy = s.vy * 0.6; }
    s.tows = []; sfx("drop"); toast("all loads released");
  },
  toggleGrabAt(arr, i) { if (this.isTowed(arr, i)) this.releaseTowAt(arr, i); else this.grabTow(arr, i); },
  tickTows(dt) {
    const s = this.state;
    const dragK = 1 - (1 - CONFIG.towBodyDrag) * (s.derived.towDrag || 1);
    const bd = Math.pow(dragK, dt * 60), pull = 1 - Math.pow(1 - CONFIG.towPull, dt * 60);
    for (let k = 0; k < s.tows.length; k++) {
      const b = this.towBody(s.tows[k]), a = k === 0 ? s : this.towBody(s.tows[k - 1]);
      const leash = CONFIG.leashBase + k * CONFIG.leashStep + this.towRadius(s.tows[k]);
      const dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy) || 0.001;
      if (dd > leash) { const over = (dd - leash) / dd; b.x -= dx * over; b.y -= dy * over;
        b.vx = lerp(b.vx, a.vx, pull); b.vy = lerp(b.vy, a.vy, pull); }
      b.vx *= bd; b.vy *= bd;
    }
  },
});
