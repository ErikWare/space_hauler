/*=== HARNESS:ECONOMY ========================================================*/
// Credits, cargo, ore refining & sell (a separate path from Forge salvage
// items). Junk floaters roll a Forge item drop (ForgeItemSystem.rollDrop) into
// the inventory; ore rocks stack by type and sell directly with a refine bonus.
Object.assign(GAME, {
  // deposit the tow chain: rocks → ore stacks, junk floaters → Forge salvage.
  depositTows() {
    const s = this.state; let ore = 0, mods = 0;
    for (const t of s.tows) {
      if (t.arr === "rocks") {
        const r = s.rocks[t.i], slot = s.ore[r.type] || (s.ore[r.type] = { count: 0, bonus: false });
        // ore yield scales by the sec rating of the grab site (danger 4-6 ×1.3,
        // 7-9 ×1.6); the fractional part rolls probabilistically to stay integer
        const om = dangerLootMult(t.dangerLevel || 1).ore;
        let q = om | 0; if (rnd() < om - q) q++;
        slot.count += q; if (r.ringBonus) slot.bonus = true; ore += q;
        this.depositRespawnRock(t.i);   // delayed re-scatter, not instant (no home-base spam loop)
      } else {
        const drop = this.rollJunkDrop(s.junk[t.i].key, t.dangerLevel);
        if (drop) { s.inventory.push(drop); mods++; this.onContractItem(drop); }   // Phase 4 salvage hook
        this.depositRespawnJunk(t.i);   // delayed re-scatter, not instant
      }
    }
    s.tows = [];
    return { ore, mods };
  },
  // roll a Forge salvage item from a junk floater type: base from the floater's
  // drop pool, TIER from the danger table (where the junk was grabbed).
  rollJunkDrop(junkKey, dangerLevel) {
    const s = this.state;
    const mods = ForgeWorld.getNebulaModifiers({ x: s.x, y: s.y });
    const ilvl = 1 + (mods.tierBoost || 0);
    const r = ForgeItemSystem.rollTier(junkKey, { ilvl, rng: rnd });
    if (!r.baseType) return null;
    const dl = dangerLevel || getDangerLevel(s.x, s.y);
    return ForgeItemSystem.generateItem(r.baseType, rollDangerTier(dl, rnd), { ilvl, rng: rnd });
  },
  // NOTE: weapons no longer mine rocks or bust junk for loot. Rocks and junk are
  // collected ONLY by towing them to a station (see depositTows). Shooting a rock
  // just destroys it (player.js fireAtRock) with no reward — combat targets ships.

  // ---- ore value / sell (home-station refine bonus) ----
  oreUnitValue(type) {
    const s = this.state, ring = CONFIG.rings.find(r => r.type === type), o = s.ore[type];
    let v = ring.value * (o && o.bonus ? 1.5 : 1);
    v *= 1 + (s.refineBonus || 0);           // ForgeStore sets refineBonus when a station is home
    return Math.round(v);
  },
  sellOre(type) {
    const s = this.state, o = s.ore[type];
    if (!o || o.count <= 0) return 0;
    const total = this.oreUnitValue(type) * o.count;
    s.credits += total; delete s.ore[type]; sfx("sell"); toast(`sold ${type} +${total}cr`);
    GAME.addXpFromCredits(total);   // XP: selling
    this.gainRep("sell"); this.checkWin(); return total;
  },
  sellAllOre() { let t = 0; for (const type of Object.keys(this.state.ore)) t += this.sellOre(type); return t; },

  // reputation hook (ForgeNPC) keyed to the docked station. Outpost docks have
  // no NPC station behind them — trading there moves no reputation.
  gainRep(event) {
    const s = this.state; if (s.dockStationId == null) return;
    if (s.docked && s.dockKind === "outpost") return;
    ForgeNPC.updateReputation(s.dockStationId, event);
    const st = ForgeWorld.getStations().find(x => x.id === s.dockStationId);
    if (st) st.reputation = ForgeNPC.getReputation(s.dockStationId);
  },

  refuel() {
    const s = this.state, missing = s.fuelMax - s.fuel;
    if (missing <= 0.5) { toast("tank full"); return 0; }
    const cost = Math.ceil(missing / CONFIG.fuelPerCredit);
    if (s.credits >= cost) { s.credits -= cost; s.fuel = s.fuelMax; s.fuelOut = false; sfx("buy"); toast(`refueled (-${cost}cr)`); GAME.addXpFromCredits(cost); return cost; }
    if (s.credits > 0) { s.fuel += s.credits * CONFIG.fuelPerCredit; s.credits = 0; s.fuelOut = false; sfx("buy"); toast("partial refuel"); return -1; }
    toast("no credits for fuel"); return 0;
  },

  checkWin() {
    const s = this.state;
    if (s.tradeNetworkComplete || s._debugAllWarpUnlocked) return;
    const stations = ForgeWorld.getStations();
    const allDiscovered = stations.every(st => st.discovered);
    const allWarped = stations.every(st => st.warpActive);
    if (allDiscovered && allWarped) {
      s.tradeNetworkComplete = true;
      s.credits += CONFIG.tradeNetworkBonus;
      sfx("grab");
      toast("★ GALACTIC TRADE NETWORK COMPLETE ★", "#ffd24a");
      toast(`+${CONFIG.tradeNetworkBonus}cr bonus!`, "#ffd24a");
    }
  },
});
