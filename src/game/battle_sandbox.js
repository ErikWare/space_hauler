/*=== HARNESS:BATTLE_SANDBOX =================================================*/
// Sandbox battle lane: non-ladder free-build. Three local slots store ships /
// inventory / fleet / credits. Fresh profile = 100k credits, all hulls unlocked
// to buy, rich store stock. Direct applyBattleSandboxLoadout() still exists for
// tests / one-click rematches (full free-fit, skip hub).
const BATTLE_SANDBOX = {
  slots: 3,
  startCredits: 100000,
  defaultHull: "vulture",
  // Module bases for free-fit rematch / test loadouts
  modulePool: [
    "laser", "cannon", "missile",
    "shield_extender", "shield_regen_module", "armor_plate", "armor_repair_module",
    "tractor_range", "engine_booster", "fuel_cell",
  ],
  // Rich hub store pool (player buys into sandbox inventory)
  storePool: [
    "laser", "cannon", "missile",
    "krag_scatter_rig", "krag_siege_breaker",
    "vex_lancer", "vex_disruptor",
    "nox_tendril", "nox_spore_pod",
    "shield_extender", "shield_regen_module", "armor_plate", "armor_repair_module",
    "hull_plating", "hull_repair_kit",
    "tractor_range", "engine_booster", "fuel_cell", "cargo_expander",
  ],
  defaultRarity: "rare",
  defaultIlvl: 4,
  droneTiers: [0, 1, 1],
  // localStorage keys (isolated from career space_hauler_save_N)
  slotKey: n => "space_hauler_sandbox_" + n,
  metaKey: "space_hauler_sandbox_meta",
};

Object.assign(GAME, {
  // ---- sandbox slot plumbing (never touches career saves) -------------------
  sandboxSlotUsed(n) {
    const store = this._saveStore && this._saveStore(); if (!store) return false;
    try { return store.getItem(BATTLE_SANDBOX.slotKey(n)) != null; } catch (e) { return false; }
  },
  readSandboxSlot(n) {
    const store = this._saveStore && this._saveStore(); if (!store) return null;
    try {
      const raw = store.getItem(BATTLE_SANDBOX.slotKey(n));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  readSandboxMeta() {
    const store = this._saveStore && this._saveStore(); if (!store) return {};
    try {
      const m = JSON.parse(store.getItem(BATTLE_SANDBOX.metaKey) || "null");
      return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
  },
  sandboxMetaFrom(data) {
    const ships = (data && data.ships) || [];
    const active = ships.find(sh => sh.id === data.activeShipId) || ships[0];
    return {
      credits: (data && data.credits) || 0,
      hullKey: active ? active.hullKey : null,
      shipCount: ships.length,
      fleet: Array.isArray(data && data.fleet) ? data.fleet.length : 0,
      inv: Array.isArray(data && data.inventory) ? data.inventory.length : 0,
      lastSaved: (data && data.savedAt) || 0,
      name: (data && data.name) || null,
    };
  },
  writeSandboxSlot(n, data) {
    const store = this._saveStore && this._saveStore(); if (!store) return false;
    try {
      store.setItem(BATTLE_SANDBOX.slotKey(n), JSON.stringify(data));
      const meta = this.readSandboxMeta();
      meta[n] = this.sandboxMetaFrom(data);
      store.setItem(BATTLE_SANDBOX.metaKey, JSON.stringify(meta));
      return true;
    } catch (e) { console.warn("sandbox save failed:", e); return false; }
  },
  clearSandboxSlot(n) {
    const store = this._saveStore && this._saveStore(); if (!store) return false;
    try {
      const key = BATTLE_SANDBOX.slotKey(n);
      const had = store.getItem(key) != null;
      store.removeItem(key);
      const meta = this.readSandboxMeta();
      if (meta[n]) { delete meta[n]; store.setItem(BATTLE_SANDBOX.metaKey, JSON.stringify(meta)); }
      return had;
    } catch (e) { return false; }
  },

  serializeSandboxSession() {
    const s = this.state;
    const b = s.battle || {};
    return {
      v: 1, kind: "sandbox",
      savedAt: (typeof Date !== "undefined" && Date.now) ? Date.now() : 0,
      name: b.sandboxName || ("Sandbox " + (b.sandboxSlot || 1)),
      credits: s.credits || 0,
      inventory: Array.isArray(s.inventory) ? s.inventory.map(it => it && typeof it === "object" ? { ...it } : it) : [],
      ore: s.ore && typeof s.ore === "object" ? JSON.parse(JSON.stringify(s.ore)) : {},
      refinedBars: s.refinedBars && typeof s.refinedBars === "object" ? { ...s.refinedBars } : {},
      ships: (s.ships || []).map(sh => ({
        id: sh.id, hullKey: sh.hullKey, name: sh.name,
        slots: (sh.slots || []).map(it => it ? { ...it } : null),
      })),
      activeShipId: s.activeShipId,
      fleet: (s.playerFleet || []).map(d => ({
        ...d, loadout: (d.loadout || []).map(m => m ? { ...m } : m),
      })),
      skills: s.skills && typeof s.skills === "object" ? { ...s.skills } : {},
      xp: s.xp || 0, level: s.level || 1, skillPoints: s.skillPoints || 0,
      // Persist store stock so bought-out shelves stay empty until restock
      storeStock: b._store && Array.isArray(b._store.stock)
        ? b._store.stock.map(it => it ? { ...it } : it) : null,
      storeBarStock: b._store && b._store.barStock ? { ...b._store.barStock } : null,
    };
  },

  // Write current hub fit into the active sandbox slot (no career touch).
  saveSandboxSession(opts) {
    opts = opts || {};
    const s = this.state, b = s.battle;
    if (!b || b.lane !== "sandbox") return false;
    const n = b.sandboxSlot | 0;
    if (n < 1 || n > BATTLE_SANDBOX.slots) return false;
    if (this._selfTesting) return true;   // headless tests must not touch real storage
    const data = this.serializeSandboxSession();
    if (opts.name) data.name = opts.name;
    b.sandboxName = data.name;
    const ok = this.writeSandboxSlot(n, data);
    if (ok && !opts.quiet && typeof toast === "function")
      toast("sandbox slot " + n + " saved", "#7bd88f", 1.6);
    return ok;
  },

  // Fresh non-ladder profile: 100k, ALL hulls pre-owned (empty racks), starter
  // fitted and active so the pilot can fly immediately and swap free in LOADOUT.
  initFreshSandboxProfile(opts) {
    opts = opts || {};
    const s = this.state;
    const hullKey = opts.hullKey || BATTLE_SANDBOX.defaultHull;
    const starterHull = CONFIG.hulls[hullKey] || CONFIG.hulls.vulture;

    s.credits = BATTLE_SANDBOX.startCredits;
    s.inventory = [];
    s.ore = {};
    s.refinedBars = { copper: 80, silver: 60, gold: 40, platinum: 30 };
    s.xp = 0; s.level = 1; s.skillPoints = 0; s.skills = {};
    s.capturedOutpostCount = 99;
    s.maxDangerReached = 9;

    // Every hull in the roster — owned, no purchase gate. Only the starter gets
    // a light fitted rack so a brand-new profile is flyable out of the box.
    const rng = (typeof ForgeItemSystem !== "undefined" && ForgeItemSystem.seedRng)
      ? ForgeItemSystem.seedRng(opts.seed || 9001) : Math.random;
    const starterMods = ["laser", "shield_regen_module", "armor_plate", "engine_booster", "fuel_cell"];
    s.ships = [];
    let nextId = 1, activeId = 1;
    for (const key of Object.keys(CONFIG.hulls)) {
      const h = CONFIG.hulls[key];
      if (!h || !h.baseShip) continue;
      const nSlots = h.equipSlots != null ? h.equipSlots : CONFIG.equipSlots;
      const slots = new Array(nSlots).fill(null);
      if (key === hullKey && typeof ForgeItemSystem !== "undefined" && ForgeItemSystem.generateItem) {
        for (let i = 0; i < Math.min(nSlots, starterMods.length); i++) {
          try { slots[i] = ForgeItemSystem.generateItem(starterMods[i], "normal", { ilvl: 2, rng }); }
          catch (e) { slots[i] = null; }
        }
      }
      const id = nextId++;
      if (key === hullKey) activeId = id;
      s.ships.push({ id, hullKey: key, name: h.name, slots });
    }
    if (!s.ships.length) {
      s.ships = [{ id: 1, hullKey: "vulture", name: "Vulture", slots: [null, null, null] }];
      activeId = 1; nextId = 2;
    }
    s.activeShipId = activeId;
    this._nextShipId = nextId;
    this._bindBattleShipRack(s);
    s.playerFleet = [];
    if (typeof this.initFleet === "function") this.initFleet(s);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    this._battleRefreshVitalsFromDerived(starterHull);
    s.towsCap = starterHull.baseTows || 2;
  },

  // Apply a stored sandbox blob onto the live session (hub only).
  applySandboxSessionData(data) {
    if (!data || data.v !== 1) return false;
    const s = this.state;
    s.credits = data.credits != null ? data.credits : BATTLE_SANDBOX.startCredits;
    s.inventory = Array.isArray(data.inventory)
      ? data.inventory.map(it => it && typeof it === "object" ? { ...it } : it) : [];
    s.ore = data.ore && typeof data.ore === "object" ? JSON.parse(JSON.stringify(data.ore)) : {};
    s.refinedBars = data.refinedBars && typeof data.refinedBars === "object"
      ? { ...data.refinedBars } : {};
    s.xp = data.xp || 0; s.level = data.level || 1; s.skillPoints = data.skillPoints || 0;
    s.skills = data.skills && typeof data.skills === "object" ? { ...data.skills } : {};
    s.capturedOutpostCount = 99; s.maxDangerReached = 9;
    if (Array.isArray(data.ships) && data.ships.length) {
      s.ships = data.ships.map(sh => ({
        id: sh.id, hullKey: sh.hullKey, name: sh.name,
        slots: (sh.slots || []).map(it => it ? { ...it } : null),
      }));
      s.activeShipId = data.activeShipId || s.ships[0].id;
      let maxId = 1;
      for (const sh of s.ships) if (sh.id > maxId) maxId = sh.id;
      this._nextShipId = maxId + 1;
    } else {
      this.initFreshSandboxProfile();
      return true;
    }
    this._bindBattleShipRack(s);
    if (Array.isArray(data.fleet)) {
      s.playerFleet = data.fleet.map(d => ({
        ...d, loadout: (d.loadout || []).map(m => m ? { ...m } : m),
      }));
    } else s.playerFleet = [];
    if (typeof this.reindexFormation === "function") this.reindexFormation(s);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    this._battleRefreshVitalsFromDerived();
    if (typeof this.reapplyDroneStats === "function") this.reapplyDroneStats();
    // Restore store shelves if present
    if (s.battle) {
      if (data.storeStock) {
        const st = this._battleSandboxStore(true);
        st.stock = data.storeStock.map(it => it ? { ...it } : it);
        if (data.storeBarStock) st.barStock = { ...data.storeBarStock };
      }
      s.battle.sandboxName = data.name || s.battle.sandboxName;
    }
    return true;
  },

  _bindBattleShipRack(s) {
    s = s || this.state;
    const ship = (s.ships || []).find(sh => sh.id === s.activeShipId) || (s.ships && s.ships[0]);
    if (!ship || typeof ForgeEquipment === "undefined") return;
    const nSlots = (CONFIG.hulls[ship.hullKey] && CONFIG.hulls[ship.hullKey].equipSlots != null)
      ? CONFIG.hulls[ship.hullKey].equipSlots : CONFIG.equipSlots;
    ForgeEquipment.initEquipment(nSlots);
    for (let i = 0; i < (ship.slots || []).length; i++) {
      if (ship.slots[i]) ForgeEquipment.equip(i, ship.slots[i]);
    }
  },

  _battleRefreshVitalsFromDerived(hull) {
    const s = this.state;
    if (s.derived) {
      s.hp = {
        shield: s.derived.shieldMax, shieldMax: s.derived.shieldMax,
        armor: s.derived.armorMax, armorMax: s.derived.armorMax,
        hull: s.derived.hullMax, hullMax: s.derived.hullMax,
        shieldRegen: s.derived.shieldRegen, shieldDelay: s.derived.shieldDelay,
        armorRepair: s.derived.armorRepair || 0,
        res: Object.assign({ shield: 0, armor: 0, hull: 0 }, s.derived.res || {}),
        _sinceHit: 99,
      };
      s.fuelMax = s.derived.fuelMax; s.fuel = s.derived.fuelMax;
    } else if (hull && hull.baseShip) {
      const bs = hull.baseShip;
      s.hp = {
        shield: bs.shieldMax, shieldMax: bs.shieldMax,
        armor: bs.armorMax, armorMax: bs.armorMax,
        hull: bs.hullMax, hullMax: bs.hullMax,
        shieldRegen: bs.shieldRegen, shieldDelay: bs.shieldDelay,
        armorRepair: bs.armorRepair || 0,
        res: Object.assign({ shield: 0, armor: 0, hull: 0 }, bs.res || {}),
        _sinceHit: 99,
      };
      s.fuelMax = bs.fuelMax; s.fuel = bs.fuelMax;
    }
  },

  // Synthetic station used by the sandbox hub STORE tab.
  // Deep catalog × several copies, then collapsed into qty stacks for a dense UI.
  _battleSandboxStore(forceNew) {
    const s = this.state, b = s.battle;
    if (!b) return null;
    if (b._store && !forceNew) {
      if (typeof ForgeStore !== "undefined" && ForgeStore.restockIfExpired)
        ForgeStore.restockIfExpired(b._store);
      return b._store;
    }
    const st = {
      id: 99001, name: "Sandbox Armory",
      pos: { x: 0, y: 0 },
      class: "outer",
      stock: [], barStock: {},
      _restockAtMs: null, _restockCount: 0,
    };
    const raw = [];
    if (typeof ForgeStore !== "undefined" && ForgeStore.generateStock) {
      // Two restock-sized draws for base variety
      raw.push.apply(raw, ForgeStore.generateStock(st, (b.seed || 42) ^ 0x5A) || []);
      raw.push.apply(raw, ForgeStore.generateStock(st, (b.seed || 42) ^ 0xBEE) || []);
    }
    if (typeof ForgeItemSystem !== "undefined" && ForgeItemSystem.generateItem) {
      const rng = ForgeItemSystem.seedRng
        ? ForgeItemSystem.seedRng((b.seed || 42) ^ 0xA11)
        : Math.random;
      const rarities = ["normal", "normal", "rare", "rare", "unique", "elite"];
      // Several copies of each pool base so stacking is meaningful
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < BATTLE_SANDBOX.storePool.length; i++) {
          const base = BATTLE_SANDBOX.storePool[i];
          const rar = rarities[(i + pass) % rarities.length];
          try {
            const it = ForgeItemSystem.generateItem(base, rar, { ilvl: 2 + ((i + pass) % 6), rng });
            if (it) raw.push(it);
          } catch (e) { /* skip */ }
        }
      }
    }
    st.stock = (typeof ForgeStore !== "undefined" && ForgeStore.stackStock)
      ? ForgeStore.stackStock(raw) : raw;
    st.barStock = { copper: 99, silver: 99, gold: 80, platinum: 60 };
    st._restockAtMs = ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0) + 3600e3;
    b._store = st;
    return st;
  },

  isBattleSandbox() {
    const b = this.state && this.state.battle;
    return !!(b && b.lane === "sandbox");
  },
  isBattleCareer() {
    const b = this.state && this.state.battle;
    return !!(b && b.lane === "career");
  },

  // One-click free-fit for tests / rematch (skips hub shopping).
  applyBattleSandboxLoadout(opts) {
    opts = opts || {};
    const s = this.state;
    const hullKey = opts.hullKey || BATTLE_SANDBOX.defaultHull;
    const hull = CONFIG.hulls[hullKey] || CONFIG.hulls.vulture;
    const nSlots = hull.equipSlots != null ? hull.equipSlots : CONFIG.equipSlots;
    const rarity = opts.rarity || BATTLE_SANDBOX.defaultRarity;
    const ilvl = opts.ilvl != null ? opts.ilvl : BATTLE_SANDBOX.defaultIlvl;

    s.credits = Math.max(s.credits || 0, BATTLE_SANDBOX.startCredits);
    s.refinedBars = s.refinedBars || {};
    for (const t of ["copper", "silver", "gold", "platinum"])
      s.refinedBars[t] = Math.max(s.refinedBars[t] || 0, 40);
    s.ore = s.ore || {};
    s.inventory = [];
    s.capturedOutpostCount = 99; s.maxDangerReached = 9;

    const slots = new Array(nSlots).fill(null);
    const pool = BATTLE_SANDBOX.modulePool;
    if (typeof ForgeItemSystem !== "undefined" && ForgeItemSystem.generateItem) {
      const rng = ForgeItemSystem.seedRng
        ? ForgeItemSystem.seedRng((s.battle && s.battle.seed) || 42)
        : Math.random;
      for (let i = 0; i < nSlots; i++) {
        const base = pool[i % pool.length];
        try { slots[i] = ForgeItemSystem.generateItem(base, rarity, { ilvl, rng }); }
        catch (e) { slots[i] = null; }
      }
    }

    s.ships = [{ id: 1, hullKey, name: hull.name, slots }];
    s.activeShipId = 1;
    this._nextShipId = 2;
    this._bindBattleShipRack(s);
    if (typeof this.recomputeDerived === "function") this.recomputeDerived();
    this._battleRefreshVitalsFromDerived(hull);
    s.towsCap = hull.baseTows || 2;

    s.playerFleet = [];
    if (typeof this.initFleet === "function") this.initFleet(s);
    const wing = hull.escortSlots != null ? hull.escortSlots : 1;
    const tiers = opts.droneTiers || BATTLE_SANDBOX.droneTiers;
    for (let i = 0; i < wing; i++) {
      const tier = tiers[i] != null ? tiers[i] : Math.min(2, i);
      const spec = DRONES.tiers[tier] || DRONES.tiers[0];
      s.playerFleet.push({
        id: (this._nextDroneId = (this._nextDroneId || 1) + 1) - 1,
        tier, role: i === 0 && wing > 1 ? "tank" : "escort",
        hp: spec.maxHp, maxHp: spec.maxHp,
        shield: spec.maxShield, maxShield: spec.maxShield,
        fuel: spec.maxFuel, maxFuel: spec.maxFuel,
        loadout: spec.loadout.map(m => ({ ...m })),
        formationIdx: null, offsetX: 0, offsetY: 0,
        state: "follow", targetAlienId: null, wcd: 0, vx: 0, vy: 0,
        x: s.x, y: s.y,
      });
    }
    if (typeof this.reindexFormation === "function") this.reindexFormation(s);
    if (typeof this.reapplyDroneStats === "function") this.reapplyDroneStats();
  },
});
