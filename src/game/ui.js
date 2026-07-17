/*=== HARNESS:UI =============================================================*/
/*
  AUDIT FINDINGS — full click-through of every dock tab (2026-07-09):
  ─────────────────────────────────────────────────────────────────────
  GEAR TAB
  • No ship stats shown — player has no idea of current DPS, shield, armor, hull, speed, cargo.
  • No UNEQUIP button on filled slots — only way to unequip is to click the slot (undiscoverable).
  • No EQUIP/SELL buttons on cargo items — tap-to-select then tap-empty-slot is the only path.
  • SELL ALL ORE has no credit yield preview — player can't see what they'll earn.
  • Item tooltip/stat info missing — only name, rarity, and value shown.

  STORE TAB (canvas — ForgeStore)
  • Buy shows "bought <name>" toast but no "+1 Item" confirmation.
  • Sell shows "sold <name> +<cr>cr" — acceptable.
  • Insufficient credits: no toast, silent fail.
  • Station stock doesn't show item stats in tooltip (ForgeStore limitation — would need module change).
  • SELL ALL ORE on gear tab doesn't show credit yield.

  WARP TAB (DOM #warpPanel + in-flight canvas overlay)
  • No gate economy: charting a station (flying within range once) unlocks its warp.
  • Uncharted stations list a MARK ON MAP action → a galaxy-map waypoint to fly to.

  HANGAR TAB (DOM — drones + fleet)
  • Refine/launch/active drones all functional.
  • Fleet cards: no DPS/Shield/Armor/Hull stats shown.
  • Fleet SWAP flow works end-to-end but no stat preview.

  CONTRACTS TAB (DOM)
  • Board generates per dock, shows type/difficulty/reward/description.
  • ACCEPT works. Active card shows, ABANDON works.
  • TURN IN properly gated to completed + issuer station.

  FIXES IMPLEMENTED BELOW:
  • Ship loadout stats panel (DPS, Shield, Armor, Hull, Speed, Cargo, weapon type)
  • UNEQUIP buttons on filled equipment slots
  • EQUIP and SELL buttons on cargo item rows
  • SELL ALL ORE shows credit yield preview
  • Store buy shows "+1 Item" toast, insufficient credits shows red error
  • Fleet drone cards show DPS/Shield/Armor/Hull stats
  • Fleet drone cards show 3 loadout slots with working SWAP
*/
// Dock screen (DOM gear panel + ForgeStore market + ForgeWorld warp), flight HUD
// wiring (ForgeHUD), and the glue that keeps s.inventory / ForgeEquipment / credits
// in sync as the player equips, sells, buys and warps.
//
// v4.1 UI revamp: the gear tab is now a DOM overlay (#gearPanel — see build.py
// <body>) instead of the ForgeInventory canvas grid; equipment is the flat 6-slot
// ForgeEquipment rack. s.inventory is the single source of truth for cargo.

// Rarity + category palette shared by the DOM gear panel (canvas HUD keeps its own).
const GH_RARITY = { normal: "#8a8f98", rare: "#57d1c9", unique: "#ffd24a", elite: "#9b70ff" };
const GH_RARITY_LABEL = { normal: "Normal", rare: "Rare", unique: "Unique", elite: "Elite" };
const GH_CAT_COL = { weapon: "#ff5060", shield: "#57d1c9", armor: "#ffd24a", hull: "#7bd88f", skill: "#9b70ff", misc: "#8a8f98" };

// Map a v4 item to its badge {category-key} — weapons red, skill modules purple,
// shield/armor/hull by name, everything else (mining/propulsion/cargo/utility/fuel) grey.
function ghBadgeKey(item) {
  if (!item) return "misc";
  if (item.weapon) return "weapon";
  if (item.skill) return "skill";
  if (item.cat === "shield") return "shield";
  if (item.cat === "armor") return "armor";
  if (item.cat === "hull") return "hull";
  return "misc";
}
function ghBadge(item) {
  const key = ghBadgeKey(item);
  return { col: GH_CAT_COL[key], txt: key.slice(0, 2).toUpperCase() };
}

Object.assign(GAME, {
  // ---- one-time UI callback wiring (idempotent) ----
  wireUI(canvas, ctx) {
    if (this._uiWired) return;
    this._uiWired = true;
    // HUD lays out from the dims it's handed — always feed LOGICAL CONFIG.W/H
    // (the real canvas buffer is now physical device px and would mis-size k/fonts).
    ForgeHUD.initHUD({ width: CONFIG.W, height: CONFIG.H }, ctx || null, { onSkillActivate: (i) => this.toggleSkill(i) });
  },

  // ---- dock lifecycle ----
  openDock(stationId) {
    const s = this.state;
    if (s.docked) return;
    s.docked = true; s.dockKind = "station"; s.outpostDockId = null;
    s.dockTab = "loadout"; s.dockStationId = stationId;
    s.vx = s.vy = 0; s.holdT = 0; s.charge = 0; s.thrusting = false; input.ax = input.ay = 0;
    // docking fee / reputation (ForgeNPC)
    const dock = ForgeNPC.canDock(stationId);
    if (dock.fee > 0 && s.credits >= dock.fee) { s.credits -= dock.fee; toast(`docking fee −${dock.fee}cr (${dock.status})`); }
    ForgeNPC.updateReputation(stationId, "dock_buy");
    const st = ForgeWorld.getStations().find(x => x.id === stationId); if (st) st.reputation = ForgeNPC.getReputation(stationId);
    ForgeEquipment.restockAmmo();
    if (st) this.generateStationContracts(st, s);   // Phase 4: fresh board every dock
    // instant full repair on docking — station crew patches the ship
    s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
    s.fuel = s.fuelMax;
    this._openTab("loadout");
    AUDIO.play("dock");
  },
  // Docking at a player-owned outpost: same DOM overlay flow as a station, but
  // the tab set trims to GEAR / STORE / FORTIFY (no warp/hangar/fleet/jobs) and
  // the store trades against the outpost's own synthetic stock.
  openOutpostDock(outpostId) {
    const s = this.state;
    if (s.docked) return;
    const o = this.outpostById(outpostId);
    if (!o || o.owner !== "player") return;
    s.docked = true; s.dockKind = "outpost"; s.outpostDockId = outpostId;
    s.dockTab = "loadout";
    s.vx = s.vy = 0; s.holdT = 0; s.charge = 0; s.thrusting = false; input.ax = input.ay = 0;
    ForgeEquipment.restockAmmo();
    // instant full repair on docking — outpost crew patches the ship
    s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax;
    s.fuel = s.fuelMax;
    this._openTab("loadout");
    AUDIO.play("dock");
  },
  dockedOutpost() {
    const s = this.state;
    return s.docked && s.dockKind === "outpost" ? this.outpostById(s.outpostDockId) : null;
  },
  closeDock() {
    const s = this.state; if (!s.docked) return;
    this._closeAllOverlays();
    s.docked = false; s.dockKind = "station"; s.outpostDockId = null;
    this.syncLoadoutDOM(); sfx("boost"); toast("launching");
    this.saveGame();   // auto-save on leaving any dock menu (station or outpost)
  },
  setDockTab(tab) {
    const s = this.state; if (!s.docked || s.dockTab === tab) return;
    this._closeAllOverlays(); s.dockTab = tab; this._openTab(tab); this.syncLoadoutDOM();
  },
  // the station-like object the STORE tab trades against (real station, or the
  // docked outpost's synthetic storefront)
  _dockStation() {
    const s = this.state;
    const o = this.dockedOutpost();
    if (o) return this._outpostStore(o);
    return ForgeWorld.getStations().find(x => x.id === s.dockStationId);
  },
  // Lazily mint a ForgeStore-compatible station for a captured outpost: id/pos
  // drive the deterministic restock seed + ilvl (far outposts stock rich gear).
  _outpostStore(o) {
    if (!o._store) {
      o._store = { id: 9000 + (parseInt(String(o.id).replace(/\D/g, ""), 10) || 0),
                   name: "Outpost " + this.regionLabel(this.regionGet(o.regionId)),
                   pos: { x: o.x, y: o.y } };
    }
    ForgeStore.restockIfExpired(o._store);
    return o._store;
  },
  _openTab(tab) {
    const s = this.state, st = this._dockStation();
    if (tab === "loadout") { this.renderLoadoutPanel(); this.syncLoadoutDOM(); }
    else if (tab === "fortify") { this.renderFortifyPanel(); }
    else if (tab === "store") {
      ForgeStore.openStore(st, s, {
        onBuy: (item, price) => { s.inventory = s.inventory; sfx("buy"); toast("+1 " + item.name, "#7bd88f"); toast("-" + price + "cr", "#ffd27a"); this.addXpFromCredits(price); this.gainRep("buy"); this.checkWin(); this.renderStorePanel(); },
        onSell: (item, gain) => { sfx("sell"); toast("+" + gain + "cr", "#ffd27a"); this.addXpFromCredits(gain); this.gainRep("sell"); this.checkWin(); this.renderStorePanel(); },
        onBuyFail: () => { sfx("warn"); toast("NOT ENOUGH CREDITS", "#ff5060"); },
        onSetHome: (sid) => { s.homeStationId = sid; s.refineBonus = 0.10; toast("home port set"); sfx("buy"); this.renderStorePanel(); },
      });
      this.renderStorePanel();
    } else if (tab === "warp") { this.renderWarpPanel(); }
    else if (tab === "ships") { this.renderShipsPanel(); }
    else if (tab === "skills") { this.renderSkillsPanel(); }
  },
  _closeAllOverlays() {
    if (ForgeStore.isOpen()) ForgeStore.closeStore();
    this._ghCloseModal();   // switching tabs / leaving dock clears any open item modal
  },
  // Warp to a discovered station (shared by the dock WARP tab + the in-flight
  // overlay). Commits the jump, then shows the fullscreen tunnel — the update
  // loop drops s.warpOverlay once tickWarp reports arrival.
  warpJump(sid) {
    const s = this.state;
    const st = ForgeWorld.getStations().find(x => x.id === sid);
    if (!st || !st.discovered || !st.warpActive) { toast("can't warp there yet"); sfx("warn"); return false; }
    ForgeWorld.setPlayer(s);
    const r = ForgeWorld.jumpTo(sid, (station) => { toast("⌘ warped to " + station.name); this._afterWarp(); });
    if (!r.ok) { toast(r.reason || "can't jump"); sfx("warn"); return false; }
    s.fuel = r.newFuel != null ? r.newFuel : s.fuel;
    s.x = st.pos.x; s.y = st.pos.y;
    if (s.docked) this.closeDock();   // leave the bay so the tunnel plays fullscreen
    s.warpOverlay = true;             // draw the warp tunnel; update loop closes it on arrival
    ForgeWorld.closeWarpUI();         // no destination picker under the tunnel
    return true;
  },
  _afterWarp() {   // ForgeWorld.jumpTo already moved s.x/s.y/s.fuel
    const s = this.state; s.vx = s.vy = 0; s.cam.x = s.x; s.cam.y = s.y;
    ForgeCombat.clearLock();
    if (s.docked) this.closeDock();
  },

  // ================= DOM LOADOUT PANEL (#loadoutPanel — build.py <body>) ========
  // The one-stop refit screen: a carousel over [player ships…, fleet drones…].
  // Center: baked sprite portrait; flanks: the ship's 6 flat rack slots (drones
  // show their 3 typed module slots); below: full stat readout + the cargo
  // grid. Tap a slot or a cargo tile → detail modal with stat DELTA preview
  // computed statelessly via ForgeEquipment.applyItemsToStats — the live rack
  // is only touched for the ACTIVE ship (gearEquip/gearUnequip).
  _loadoutDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._lo) return this._lo;
    const $ = id => document.getElementById(id);
    const panel = $("loadoutPanel");
    if (!panel) return null;
    this._lo = { panel, cred: $("loCred"), fuel: $("loFuel"),
                 canvas: $("loShipCanvas"), shipName: $("loShipName"), shipSub: $("loShipSub"),
                 activeBtn: $("loActiveBtn"), pageLbl: $("loPageLbl"),
                 slotsGrid: $("loSlotsGrid"),
                 stats: $("loStats"), inv: $("loInv") };
    return this._lo;
  },
  // Station docks show the full 6-tab bar; outpost docks trim each panel's
  // header to GEAR / STORE / FORTIFY. Cheap: re-walks the buttons only when
  // the dock kind actually changes.
  _syncDockTabs(panel) {
    const s = this.state, mode = s.docked && s.dockKind === "outpost" ? "outpost" : "station";
    if (panel._tabMode === mode) return;
    panel._tabMode = mode;
    panel.querySelectorAll(".ghTab").forEach(btn => {
      const t = btn.dataset.tab;
      const vis = mode === "outpost" ? (t === "loadout" || t === "store" || t === "fortify" || t === "drones") : (t !== "fortify");
      btn.style.display = vis ? "" : "none";
    });
  },
  // Toggle overlay visibility from game state (called each draw frame; cheap).
  syncLoadoutDOM() {
    const lo = this._loadoutDOM(); if (!lo) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "loadout");
    lo.panel.classList.toggle("show", show);
    if (show) this._syncDockTabs(lo.panel);
    // #ghModal is shared by every dock tab (loadout/store/…). Only tear it down
    // when the dock is fully closed — NOT merely because we're off the loadout
    // tab, or the store's Buy modal gets nuked the same frame it opens.
    if (!s.docked) this._ghCloseModal();
  },
  // carousel pages: owned ships first, then owned drones
  _loPages() {
    const s = this.state, pages = [];
    for (const sh of s.ships) pages.push({ kind: "ship", ship: sh });
    (s.playerFleet || []).forEach((d, fi) => pages.push({ kind: "drone", drone: d, fleetIdx: fi }));
    return pages;
  },
  _loPage() {
    const pages = this._loPages(), ui = this._loUI = this._loUI || { idx: 0 };
    if (!pages.length) return null;
    ui.idx = ((ui.idx % pages.length) + pages.length) % pages.length;
    return pages[ui.idx];
  },
  // stat block for a ship page — live derived for the active ship, a stateless
  // applyItemsToStats pass for everything else (never touches the rack)
  _loShipStats(ship) {
    const s = this.state;
    if (ship.id === s.activeShipId && s.derived) return s.derived;
    const base = (CONFIG.hulls[ship.hullKey] || CONFIG.hulls.vulture).baseShip;
    return ForgeEquipment.applyItemsToStats(base, ship.slots.filter(Boolean));
  },
  // Build one badge element: a per-type icon glyph (item_icons.js) tinted by the
  // item's category color, on a dark tile. Same element everywhere items show.
  _ghBadgeEl(item) {
    const b = ghBadge(item), el = document.createElement("span");
    el.className = "ghBadge";
    el.style.background = "#0e1626";
    el.style.color = b.col;                       // drives currentColor in the SVG glyph
    el.style.border = "1px solid " + b.col;
    el.innerHTML = itemIconSVG(item);
    el.title = ITEM_ICON_LABEL[itemIconKey(item)] || "";
    return el;
  },
  _ghComputeDps(derived, items) {
    const eq = items || ForgeEquipment.getEquipped().slots;
    let dps = 0;
    for (const item of eq) {
      if (!item || !item.weapon) continue;
      const w = item.weapon;
      // Mirror the fire path's per-weapon-type skill boosts so the readout tracks
      // Focused Beam / Heavy Rounds / Warhead (dmgMult) AND Shield Disruptor /
      // Armor Piercer (per-layer mults). Present only on the active ship's derived;
      // other ships show equipment-only DPS.
      const wsk = derived.wpnSkill && derived.wpnSkill[w.type];
      const dmgMult = (wsk && wsk.dmgMult) || 1;
      const shM = (wsk && wsk.shieldDmgMult) || 1, arM = (wsk && wsk.armorDmgMult) || 1;
      const avgCoeff = (w.dmgShield * shM + w.dmgArmor * arM + (w.dmgHull || 0)) / 3;
      const dmg = (derived.weaponDmg || 10) * dmgMult * avgCoeff;
      const cdMs = ForgeCombat.weaponCooldownMs(item, { fireRate: derived.fireRate });
      dps += dmg / (cdMs / 1000);
    }
    return Math.round(dps * 10) / 10;
  },
  // Companion-drone loadout summary — shared by the LOADOUT drone page and the
  // FORTIFY berth cards so a fitted module (weapon/repair/utility) always shows
  // up somewhere: DPS sums weapon modules, repairAmt/utilAmt sum the hp/s and
  // shield/s a fitted repair or utility module actually contributes.
  _droneStatSummary(d) {
    const loadout = (d && d.loadout) || [];
    const dps = Math.round(loadout.filter(m => m.type === "weapon").reduce((a, m) => a + m.dmg * (m.fireRate || 1), 0) * 10) / 10;
    const repairAmt = Math.round(loadout.filter(m => m.type === "repair").reduce((a, m) => a + m.amount, 0) * 10) / 10;
    const utilAmt = Math.round(loadout.filter(m => m.type === "utility").reduce((a, m) => a + m.amount, 0) * 10) / 10;
    return { dps, repairAmt, utilAmt };
  },
  _ghWeaponType(items) {
    const eq = items || ForgeEquipment.getEquipped().slots;
    const types = [];
    for (const item of eq) {
      if (!item || !item.weapon) continue;
      const t = item.weapon.type;
      if (t && types.indexOf(t) < 0) types.push(t);
    }
    return types.length ? types.join(" / ") : "none";
  },
  _ghSellItem(invIdx) {
    const s = this.state, item = s.inventory[invIdx];
    if (!item) return;
    const val = Math.round(ForgeItemSystem.getItemValue(item) * 0.7);
    s.inventory.splice(invIdx, 1);
    s.credits += val;
    // the sold item lands back on the station's shelf (front of the list) so it's
    // buyable again — survives launching, cleared on the next 5-min restock
    const station = this._dockStation();
    if (station && station.stock) station.stock.unshift(item);
    sfx("sell"); toast("sold " + item.name + " +" + val + "cr");
    this.gainRep("sell"); this._ghCloseModal();
    if (s.dockTab === "store") { this.renderStorePanel(); return; }
    if (s.dockTab === "fortify") { this.renderFortifyPanel(); return; }
    this.renderLoadoutPanel();
  },
  // ---- item modal ----
  _ghOpenModal(item, opts) {
    if (HEADLESS || typeof document === "undefined") return;
    const modal = document.getElementById("ghModal"); if (!modal) return;
    modal.innerHTML = "";
    const box = document.createElement("div"); box.className = "ghMBox";
    const badge = this._ghBadgeEl(item);
    badge.style.width = "36px"; badge.style.height = "36px"; badge.style.fontSize = "14px"; badge.style.borderRadius = "10px";
    box.appendChild(badge);
    const nm = document.createElement("div"); nm.className = "ghMName";
    nm.style.color = GH_RARITY[item.tier] || "#e8edf4"; nm.textContent = item.name;
    box.appendChild(nm);
    const rar = document.createElement("div"); rar.className = "ghMRar";
    rar.style.color = GH_RARITY[item.tier] || GH_RARITY.normal;
    rar.textContent = (GH_RARITY_LABEL[item.tier] || item.tier) + " · " + (item.cat || "misc");
    box.appendChild(rar);
    if (opts.buyMode && opts.buyPrice != null) {
      const val = document.createElement("div"); val.className = "ghMVal";
      val.textContent = opts.buyPrice + " cr";
      box.appendChild(val);
    } else if (!opts.buyMode && item.id != null) {   // drone factory modules are pseudo-items with no market value
      const val = document.createElement("div"); val.className = "ghMVal";
      val.textContent = ForgeItemSystem.getItemValue(item) + " cr";
      box.appendChild(val);
    }
    box.appendChild(document.createElement("hr")).className = "ghMSep";
    if (opts.buyStock != null) {
      const row = document.createElement("div"); row.className = "ghMStatRow";
      const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = "Station Stock";
      const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = "×" + opts.buyStock;
      row.appendChild(l); row.appendChild(r); box.appendChild(row);
    }
    if (opts.moduleRows) {
      for (const [lbl, v] of opts.moduleRows) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
        const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.weapon) {
      const w = item.weapon;
      const stats = [
        ["Type", w.type], ["Shield Dmg", w.dmgShield], ["Armor Dmg", w.dmgArmor],
        ["Hull Dmg", w.dmgHull || 0], ["Range", w.range], ["Fuel/Shot", w.fuelPerShot],
      ];
      if (w.aoe) stats.push(["AoE", w.aoe]);
      if (w.ammo != null) stats.push(["Ammo", item.ammo != null ? item.ammo : w.ammo]);
      for (const [lbl, v] of stats) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
        const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.skill) {
      const sk = item.skill;
      const stats = [["Skill", sk.skill_fn.replace(/_/g, " ")], ["Cooldown", (sk.cooldown_ms / 1000) + "s"]];
      if (sk.regen_amount) stats.push(["Amount", sk.regen_amount]);
      if (sk.fuel_amount) stats.push(["Fuel", sk.fuel_amount]);
      for (const [lbl, v] of stats) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
        const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.base_stats) {
      for (const [k, v] of Object.entries(item.base_stats)) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl";
        l.textContent = k.replace(/_pct$/, "").replace(/_/g, " ");
        const r = document.createElement("span"); r.className = "ghMStatVal";
        r.textContent = (v > 0 ? "+" : "") + v + (k.endsWith("_pct") ? "%" : "");
        r.style.color = "#7bd88f";
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.specials && item.specials.length) {
      for (const sp of item.specials) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl";
        l.textContent = sp.key.replace(/_pct$/, "").replace(/_/g, " ");
        const r = document.createElement("span"); r.className = "ghMStatVal";
        r.textContent = (sp.val > 0 ? "+" : "") + sp.val + (sp.key.endsWith("_pct") ? "%" : "");
        r.style.color = "#57d1c9";
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    // ---- stat delta preview ("what this module does for THIS ship") ----
    if (opts.deltas && opts.deltas.length) {
      const sep = document.createElement("hr"); sep.className = "ghMSep"; box.appendChild(sep);
      const hd = document.createElement("div"); hd.className = "ghMRar"; hd.style.color = "#8fd0ff";
      hd.textContent = opts.deltaLabel || "ship impact";
      box.appendChild(hd);
      for (const dl of opts.deltas) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = dl.label;
        const r = document.createElement("span"); r.className = "ghMStatVal";
        const diff = Math.round((dl.to - dl.from) * 10) / 10;
        r.textContent = dl.from + " → " + dl.to + "  (" + (diff > 0 ? "+" : "") + diff + ")";
        r.style.color = diff > 0 ? "#7bd88f" : "#ff8a8a";
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    const acts = document.createElement("div"); acts.className = "ghMActions";
    if (opts.equipShip != null) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "EQUIP";
      b.addEventListener("click", () => {
        const ship = this.state.ships.find(sh => sh.id === opts.equipShip);
        const emptySlot = ship ? ship.slots.indexOf(null) : -1;
        if (emptySlot >= 0) { this.loadoutEquip(opts.equipShip, opts.invIdx, emptySlot); this._ghCloseModal(); this.renderLoadoutPanel(); }
        else { toast("all slots full — unequip one first"); sfx("warn"); }
      });
      acts.appendChild(b);
    }
    if (opts.unequipShip) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "UNEQUIP";
      b.addEventListener("click", () => { this.loadoutUnequip(opts.unequipShip.shipId, opts.unequipShip.slotIdx); this._ghCloseModal(); this.renderLoadoutPanel(); });
      acts.appendChild(b);
    }
    if (opts.fitDrone) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "FIT TO DRONE";
      b.addEventListener("click", () => {
        const d = this.state.playerFleet[opts.fitDrone.fleetIdx];
        this.fleetSwapModule(opts.fitDrone.fleetIdx, d ? (d.loadout || []).length : 0, opts.invIdx);
        this._ghCloseModal(); this.renderLoadoutPanel();
      });
      acts.appendChild(b);
    }
    if (opts.unfitDrone) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "UNEQUIP";
      b.addEventListener("click", () => { this.fleetUnequipModule(opts.unfitDrone.fleetIdx, opts.unfitDrone.slotIdx); this._ghCloseModal(); this.renderLoadoutPanel(); });
      acts.appendChild(b);
    }
    if (opts.fortifyEquip) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "FIT TO OUTPOST";
      b.addEventListener("click", () => {
        const o = this.dockedOutpost();
        if (o && this.fortifyEquipModule(o, opts.invIdx)) { this._ghCloseModal(); this.renderFortifyPanel(); }
      });
      acts.appendChild(b);
    }
    if (opts.unfitFortify) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "UNEQUIP";
      b.addEventListener("click", () => {
        const o = this.dockedOutpost();
        if (o) this.fortifyUnequipModule(o, opts.unfitFortify.slotIdx);
        this._ghCloseModal(); this.renderFortifyPanel();
      });
      acts.appendChild(b);
    }
    // fit a cargo module onto a specific berthed outpost drone (one button per berth)
    if (opts.fortifyDroneTargets) for (const t of opts.fortifyDroneTargets) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "FIT → " + t.label;
      b.addEventListener("click", () => {
        const o = this.dockedOutpost(), d = o && o.stationedDrones && o.stationedDrones[t.berthIdx];
        if (d) this.droneFitModule(d, (d.loadout || []).length, opts.invIdx);
        this._ghCloseModal(); this.renderFortifyPanel();
      });
      acts.appendChild(b);
    }
    if (opts.unfitOutpostDrone) {
      const b = document.createElement("button"); b.className = "eq"; b.textContent = "UNEQUIP";
      b.addEventListener("click", () => {
        const o = this.dockedOutpost(), d = o && o.stationedDrones && o.stationedDrones[opts.unfitOutpostDrone.berthIdx];
        if (d) this.droneUnequipModule(d, opts.unfitOutpostDrone.slotIdx);
        this._ghCloseModal(); this.renderFortifyPanel();
      });
      acts.appendChild(b);
    }
    // generic confirm action (e.g. salvage) — a colored YES button + BACK
    if (opts.confirm) {
      const b = document.createElement("button"); b.className = opts.confirm.danger ? "sl" : "eq";
      b.textContent = opts.confirm.label || "CONFIRM";
      b.addEventListener("click", () => { if (opts.confirm.onYes) opts.confirm.onYes(); this._ghCloseModal(); });
      acts.appendChild(b);
      const back = document.createElement("button"); back.textContent = "BACK";
      back.addEventListener("click", () => this._ghCloseModal());
      acts.appendChild(back);
    }
    if (opts.sell) {
      const sellVal = Math.round(ForgeItemSystem.getItemValue(item) * 0.7);
      const b = document.createElement("button"); b.className = "sl"; b.textContent = "SELL " + sellVal + "cr";
      b.addEventListener("click", () => { this._ghSellItem(opts.invIdx); });
      acts.appendChild(b);
    }
    if (opts.buyMode) {
      const unit = opts.buyPrice != null ? opts.buyPrice : 0;
      const qtyMax = Math.max(1, opts.qtyMax || 1);
      let qty = 1;
      const buyBtn = document.createElement("button"); buyBtn.className = "eq";
      const refreshBuy = () => {
        const total = unit * qty;
        const afford = unit === 0 || this.state.credits >= total;
        buyBtn.disabled = !afford;
        buyBtn.textContent = !afford ? "NOT ENOUGH CR"
          : "BUY" + (qty > 1 ? " ×" + qty : "") + (opts.buyPrice != null ? " · " + total + "cr" : "");
      };
      // quantity picker (stepper + slider) — only for stackable buys (bars)
      if (qtyMax > 1) {
        const wrap = document.createElement("div"); wrap.className = "ghMQty";
        const row = document.createElement("div"); row.className = "ghMQtyRow";
        const nLbl = document.createElement("span"); nLbl.className = "ghMQtyN";
        const tLbl = document.createElement("span"); tLbl.className = "ghMQtyTotal";
        row.appendChild(nLbl); row.appendChild(tLbl); wrap.appendChild(row);
        const step = document.createElement("div"); step.className = "ghMQtyStepper";
        const minus = document.createElement("button"); minus.textContent = "−";
        const slider = document.createElement("input"); slider.type = "range";
        slider.className = "ghMQtySlider"; slider.min = "1"; slider.max = String(qtyMax); slider.value = "1";
        const plus = document.createElement("button"); plus.textContent = "+";
        step.appendChild(minus); step.appendChild(slider); step.appendChild(plus); wrap.appendChild(step);
        const setQty = (n) => {
          qty = Math.max(1, Math.min(qtyMax, n | 0));
          slider.value = String(qty);
          nLbl.textContent = "×" + qty + " of " + qtyMax;
          tLbl.textContent = (unit * qty) + "cr";
          refreshBuy();
        };
        slider.addEventListener("input", () => setQty(+slider.value));
        minus.addEventListener("click", () => setQty(qty - 1));
        plus.addEventListener("click", () => setQty(qty + 1));
        box.appendChild(wrap);
        setQty(1);
      } else {
        refreshBuy();
      }
      buyBtn.addEventListener("click", () => { if (opts.onBuy) opts.onBuy(qty); this._ghCloseModal(); });
      acts.appendChild(buyBtn);
      const back = document.createElement("button"); back.textContent = "BACK";
      back.addEventListener("click", () => this._ghCloseModal());
      acts.appendChild(back);
    } else if (!opts.confirm) {   // confirm modals bring their own YES + BACK
      const close = document.createElement("button"); close.textContent = "CLOSE";
      close.addEventListener("click", () => this._ghCloseModal());
      acts.appendChild(close);
    }
    box.appendChild(acts);
    modal.appendChild(box);
    modal.classList.add("show");
    modal.addEventListener("click", (e) => { if (e.target === modal) this._ghCloseModal(); }, { once: true });
  },
  _ghCloseModal() {
    if (HEADLESS || typeof document === "undefined") return;
    const modal = document.getElementById("ghModal");
    if (modal) { modal.classList.remove("show"); modal.innerHTML = ""; }
  },
  _ghOpenStoreModal(item, storeIdx) {
    if (HEADLESS || typeof document === "undefined") return;
    const modal = document.getElementById("ghModal"); if (!modal) return;
    modal.innerHTML = "";
    const box = document.createElement("div"); box.className = "ghMBox";
    const badge = this._ghBadgeEl(item);
    badge.style.width = "36px"; badge.style.height = "36px"; badge.style.fontSize = "14px"; badge.style.borderRadius = "10px";
    box.appendChild(badge);
    const nm = document.createElement("div"); nm.className = "ghMName";
    nm.style.color = GH_RARITY[item.tier] || "#e8edf4"; nm.textContent = item.name;
    box.appendChild(nm);
    const rar = document.createElement("div"); rar.className = "ghMRar";
    rar.style.color = GH_RARITY[item.tier] || GH_RARITY.normal;
    rar.textContent = (GH_RARITY_LABEL[item.tier] || item.tier) + " · " + (item.cat || "misc");
    box.appendChild(rar);
    const price = ForgeStore.buyPrice(item);
    const val = document.createElement("div"); val.className = "ghMVal";
    val.textContent = price + " cr";
    box.appendChild(val);
    box.appendChild(document.createElement("hr")).className = "ghMSep";
    if (item.weapon) {
      const w = item.weapon;
      for (const [lbl, v] of [["Type", w.type], ["Shield Dmg", w.dmgShield], ["Armor Dmg", w.dmgArmor],
        ["Hull Dmg", w.dmgHull || 0], ["Range", w.range], ["Fuel/Shot", w.fuelPerShot]]) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
        const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.skill) {
      const sk = item.skill;
      for (const [lbl, v] of [["Skill", sk.skill_fn.replace(/_/g, " ")], ["Cooldown", (sk.cooldown_ms / 1000) + "s"]]) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
        const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.base_stats) {
      for (const [k, v] of Object.entries(item.base_stats)) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl";
        l.textContent = k.replace(/_pct$/, "").replace(/_/g, " ");
        const r = document.createElement("span"); r.className = "ghMStatVal";
        r.textContent = (v > 0 ? "+" : "") + v + (k.endsWith("_pct") ? "%" : "");
        r.style.color = "#7bd88f";
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    if (item.specials && item.specials.length) {
      for (const sp of item.specials) {
        const row = document.createElement("div"); row.className = "ghMStatRow";
        const l = document.createElement("span"); l.className = "ghMStatLbl";
        l.textContent = sp.key.replace(/_pct$/, "").replace(/_/g, " ");
        const r = document.createElement("span"); r.className = "ghMStatVal";
        r.textContent = (sp.val > 0 ? "+" : "") + sp.val + (sp.key.endsWith("_pct") ? "%" : "");
        r.style.color = "#57d1c9";
        row.appendChild(l); row.appendChild(r); box.appendChild(row);
      }
    }
    const acts = document.createElement("div"); acts.className = "ghMActions";
    const s = this.state;
    const canAfford = s.credits >= price;
    const buyBtn = document.createElement("button"); buyBtn.className = "eq";
    buyBtn.textContent = canAfford ? "BUY " + price + "cr" : "NOT ENOUGH CR";
    buyBtn.disabled = !canAfford;   // inventory is unlimited (no cargo hold)
    buyBtn.addEventListener("click", () => {
      const r = ForgeStore.buyItem(storeIdx, this.state);
      if (!r.success) {
        if (r.reason === "insufficient credits") { sfx("warn"); toast("NOT ENOUGH CREDITS", "#ff5060"); }
        else if (r.reason === "inventory full") { sfx("warn"); toast("CARGO FULL", "#ff5060"); }
      } else {
        sfx("buy"); toast("+1 " + r.item.name, "#7bd88f"); toast("-" + r.price + "cr", "#ffd27a");
        this.gainRep("buy"); this.checkWin();
      }
      this._ghCloseModal(); this.renderStorePanel();
    });
    acts.appendChild(buyBtn);
    const close = document.createElement("button"); close.textContent = "CLOSE";
    close.addEventListener("click", () => this._ghCloseModal());
    acts.appendChild(close);
    box.appendChild(acts);
    modal.appendChild(box);
    modal.classList.add("show");
    modal.addEventListener("click", (e) => { if (e.target === modal) this._ghCloseModal(); }, { once: true });
  },
  // ---- stat delta preview: swap ONE slot on a copy and diff the derivation ----
  _loShipDeltas(ship, nextSlots) {
    const base = (CONFIG.hulls[ship.hullKey] || CONFIG.hulls.vulture).baseShip;
    const cur = ForgeEquipment.applyItemsToStats(base, ship.slots.filter(Boolean));
    const nxt = ForgeEquipment.applyItemsToStats(base, nextSlots.filter(Boolean));
    const r1 = v => Math.round(v * 10) / 10;
    const rows = [];
    const dps0 = this._ghComputeDps(cur, ship.slots), dps1 = this._ghComputeDps(nxt, nextSlots);
    if (dps0 !== dps1) rows.push({ label: "DPS", from: dps0, to: dps1 });
    const KEYS = [["Shield", "shieldMax"], ["Sh.Regen", "shieldRegen"], ["Armor", "armorMax"], ["Hull", "hullMax"],
                  ["Fuel", "fuelMax"], ["Solar", "solarRegen"], ["Thrust", "thrust"], ["Turn", "turnSpeed"],
                  ["Scan", "scanRange"], ["T.Range", "tractorRange"], ["T.Power", "tractorStr"],
                  ["Fuel Use", "fuelCostK"], ["Wpn Dmg", "weaponDmg"], ["Fire Rate", "fireRate"]];
    for (const [label, key] of KEYS) {
      const a = r1(cur[key] || 0), b = r1(nxt[key] || 0);
      if (a !== b) rows.push({ label, from: a, to: b });
    }
    for (const rk of ["shield", "armor"]) {
      const a = Math.round((cur.res[rk] || 0) * 100), b = Math.round((nxt.res[rk] || 0) * 100);
      if (a !== b) rows.push({ label: rk + " resist %", from: a, to: b });
    }
    // tow slots come from a game-side affix, not the engine derivation
    const t0 = this._sumAttr(ship.slots.filter(Boolean), "tractor_slots_flat"),
          t1 = this._sumAttr(nextSlots.filter(Boolean), "tractor_slots_flat");
    if (t0 !== t1) {
      const bt = (CONFIG.hulls[ship.hullKey] || CONFIG.hulls.vulture).baseTows;
      rows.push({ label: "Tow Slots", from: Math.min(6, bt + t0), to: Math.min(6, bt + t1) });
    }
    return rows;
  },

  // ---- portrait: baked sprite into the panel canvas + backdrop rings ----
  _loDrawPortrait(page) {
    const lo = this._loadoutDOM(); if (!lo || !lo.canvas || !lo.canvas.getContext) return;
    const g = lo.canvas.getContext("2d"), W = lo.canvas.width, H = lo.canvas.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    // hangar-bay backdrop: soft glow + dashed cradle rings
    const glow = g.createRadialGradient(cx, cy, 8, cx, cy, W * 0.48);
    glow.addColorStop(0, "rgba(87,209,201,0.14)"); glow.addColorStop(1, "rgba(87,209,201,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(143,208,255,0.22)"; g.lineWidth = 2; g.setLineDash([6, 8]);
    g.beginPath(); g.arc(cx, cy, W * 0.40, 0, TAU); g.stroke();
    g.setLineDash([2, 10]);
    g.beginPath(); g.arc(cx, cy, W * 0.30, 0, TAU); g.stroke();
    g.setLineDash([]);
    if (page.kind === "ship") {
      // glamour banner (menu hero shot) for the current hull; baked sprite otherwise
      const hull = (page.ship && page.ship.hullKey) || "vulture";
      if (!ART.draw(g, "ship_" + hull + "_menu", cx, cy, W * 0.94, 0))
        SPRITES.draw(g, "ship", cx, cy, 2.6, -Math.PI / 2);
    } else {
      SPRITES.draw(g, "drone", cx, cy, 2.6, -Math.PI / 2);
      const ringCol = (DRONES.tierCol && DRONES.tierCol[page.drone.tier]) || "#8a8f98";
      g.strokeStyle = ringCol; g.globalAlpha = 0.85; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, W * 0.36, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    }
  },

  _loSlotEl(parent, item, data, emptyLabel) {
    const el = document.createElement("div"); el.className = "ghSlot loSlot";
    for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
    el.classList.toggle("filled", !!item);
    if (item) {
      const badge = this._ghBadgeEl(item);
      badge.style.borderColor = GH_RARITY[item.tier] || GH_RARITY.normal;
      badge.style.boxShadow = "0 0 6px " + (GH_RARITY[item.tier] || GH_RARITY.normal);
      el.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghSlotName"; nm.textContent = item.name;
      nm.style.color = GH_RARITY[item.tier] || "#c7d2e0";
      el.appendChild(nm);
      el.style.borderColor = GH_RARITY[item.tier] || "#2c4a6a";
    } else {
      const e = document.createElement("span"); e.className = "ghEmpty"; e.textContent = emptyLabel || "— empty —";
      el.appendChild(e);
    }
    parent.appendChild(el);
    return el;
  },

  // The whole panel: carousel header, portrait, flanking slots, stat bars, cargo.
  renderLoadoutPanel() {
    const lo = this._loadoutDOM(); if (!lo) return;
    const s = this.state, page = this._loPage(); if (!page) return;
    const pages = this._loPages(), ui = this._loUI;
    lo.cred.textContent = Math.round(s.credits);
    lo.fuel.textContent = Math.round(s.fuel) + "/" + Math.round(s.fuelMax);
    lo.pageLbl.textContent = (ui.idx + 1) + " / " + pages.length;

    // ---- portrait + identity ----
    this._loDrawPortrait(page);
    lo.slotsGrid.innerHTML = "";
    if (page.kind === "ship") {
      const ship = page.ship, hull = CONFIG.hulls[ship.hullKey] || CONFIG.hulls.vulture;
      const isActive = ship.id === s.activeShipId;
      lo.shipName.textContent = ship.name;
      lo.shipName.style.color = "#8fd0ff";
      lo.shipSub.textContent = hull.desc + " · hull " + hull.baseShip.hullMax;
      lo.activeBtn.style.display = "";
      lo.activeBtn.textContent = isActive ? "★ ACTIVE SHIP" : "SET ACTIVE";
      lo.activeBtn.classList.toggle("on", isActive);
      lo.activeBtn.disabled = isActive;
      // 6 flat slots in a 3-col grid below the portrait (left-to-right reading order)
      for (const i of [0, 1, 2, 3, 4, 5]) this._loSlotEl(lo.slotsGrid, ship.slots[i], { slot: String(i) }, "slot " + (i + 1));
    } else {
      const d = page.drone, spec = DRONES.tiers[d.tier];
      const roleLbl = { escort: "ESCORT WING", hangar: "IN HANGAR", trade: "ON TRADE RUN" }[d.role] || d.role;
      lo.shipName.textContent = spec.name + " Drone";
      lo.shipName.style.color = (DRONES.tierCol && DRONES.tierCol[d.tier]) || FLEET.trail;
      lo.shipSub.textContent = "T" + d.tier + " companion · " + roleLbl;
      lo.activeBtn.style.display = "none";
      // DRONES.slotCount UNTYPED module slots — any module fits any slot. Each
      // filled slot is labelled by what it actually does (its module's behaviour).
      d.loadout = d.loadout || [];
      for (let i = 0; i < DRONES.slotCount; i++) {
        const m = d.loadout[i] || null;
        const label = m ? m.type.toUpperCase() : "SLOT " + (i + 1);
        this._loSlotEl(lo.slotsGrid, m && (m.srcItem || { name: m.name, tier: "normal", cat: m.type === "weapon" ? "weapons" : "utility" }),
          { dslot: String(i) }, label);
      }
    }

    // ---- stat readout ----
    lo.stats.innerHTML = "";
    const bar = (label, val, max, col) => {
      const row = document.createElement("div"); row.className = "ghStatRow";
      const lbl = document.createElement("span"); lbl.className = "ghStatLabel"; lbl.textContent = label;
      const barOut = document.createElement("div"); barOut.className = "ghStatBarOut";
      const barFill = document.createElement("div"); barFill.className = "ghStatBarFill";
      barFill.style.width = Math.min(100, (val / max) * 100) + "%";
      barFill.style.background = col;
      barOut.appendChild(barFill);
      const valEl = document.createElement("span"); valEl.className = "ghStatVal"; valEl.style.color = col;
      valEl.textContent = val;
      row.appendChild(lbl); row.appendChild(barOut); row.appendChild(valEl);
      lo.stats.appendChild(row);
    };
    if (page.kind === "ship") {
      const ship = page.ship, hull = CONFIG.hulls[ship.hullKey] || CONFIG.hulls.vulture;
      const d = this._loShipStats(ship);
      const isActive = ship.id === s.activeShipId;
      const tows = isActive ? s.towsCap : Math.min(6, hull.baseTows + this._sumAttr(ship.slots.filter(Boolean), "tractor_slots_flat"));
      bar("DPS", this._ghComputeDps(d, ship.slots), 60, "#ff5060");
      bar("Shield", Math.round(d.shieldMax), Math.max(300, d.shieldMax), "#57d1c9");
      bar("Armor", Math.round(d.armorMax), Math.max(300, d.armorMax), "#ffd24a");
      bar("Hull", Math.round(d.hullMax), Math.max(300, d.hullMax), "#7bd88f");
      bar("Speed", Math.round(d.thrust * 2), 600, "#8fd0ff");
      bar("Fuel", Math.round(d.fuelMax), 300, "#c7d2e0");
      bar("T.Range", Math.round(d.tractorRange), 1200, "#9ab8e0");
      bar("T.Slots", tows, 6, "#9ab8e0");
      const wtype = this._ghWeaponType(ship.slots);
      if (wtype !== "none") {
        const wt = document.createElement("div"); wt.className = "ghWeaponType";
        wt.textContent = "Weapon: " + wtype.toUpperCase();
        lo.stats.appendChild(wt);
      }
    } else {
      const d = page.drone, spec = DRONES.tiers[d.tier];
      const { dps, repairAmt, utilAmt } = this._droneStatSummary(d);
      bar("DPS", dps, 40, "#ff5060");
      bar("HP", Math.round(d.hp), d.maxHp, "#7bd88f");
      if (repairAmt) bar("Repair", repairAmt, 20, "#7bd88f");   // only shown once a repair module is fitted
      bar("Shield", Math.round(d.shield), Math.max(1, d.maxShield), "#57d1c9");
      if (utilAmt) bar("Shield Regen", utilAmt, 20, "#57d1c9");  // only shown once a utility module is fitted
      bar("Fuel", Math.round(d.fuel), d.maxFuel, "#c7d2e0");
      const wt = document.createElement("div"); wt.className = "ghWeaponType";
      wt.textContent = "Trade payout " + spec.payout + "cr · survival " + Math.round(spec.successRate * 100) + "%";
      lo.stats.appendChild(wt);
    }

    // ---- cargo grid (ore stacks sell on tap; items open the fit modal) ----
    lo.inv.innerHTML = "";
    const oreTypes = Object.keys(s.ore).filter(t => s.ore[t] && s.ore[t].count > 0);
    for (const type of oreTypes) {
      const ring = CONFIG.rings.find(r => r.type === type);
      if (!ring) continue;
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.oreType = type;
      const badge = document.createElement("span"); badge.className = "ghBadge"; badge.style.background = ring.col; badge.textContent = "OR";
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.textContent = (CONFIG.oreNames[type] || type) + " ×" + s.ore[type].count;
      tile.appendChild(nm);
      tile.style.borderColor = ring.col;
      lo.inv.appendChild(tile);
    }
    if (!s.inventory.length && !oreTypes.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.style.gridColumn = "1 / -1";
      note.textContent = "cargo empty";
      lo.inv.appendChild(note);
    }
    const TIER_RANK = { elite: 3, unique: 2, rare: 1, normal: 0 };
    const invDisplay = s.inventory.map((item, idx) => ({ item, idx })).sort((a, b) => {
      const tDiff = (TIER_RANK[b.item.tier] || 0) - (TIER_RANK[a.item.tier] || 0);
      if (tDiff !== 0) return tDiff;
      return this._invStrength(b.item) - this._invStrength(a.item);
    });
    invDisplay.forEach(({ item, idx }) => {
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.inv = String(idx);
      const badge = this._ghBadgeEl(item);
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "12px"; badge.style.borderRadius = "8px";
      badge.style.boxShadow = "0 0 6px " + (GH_RARITY[item.tier] || GH_RARITY.normal);
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.style.color = GH_RARITY[item.tier] || "#c7d2e0";
      nm.textContent = item.name;
      tile.appendChild(nm);
      tile.style.borderColor = GH_RARITY[item.tier] || "#223047";
      lo.inv.appendChild(tile);
    });
  },

  _invStrength(item) {
    if (item.cat === "weapons" && item.weapon) {
      const w = item.weapon;
      const dmg = (w.dmgShield || 0) + (w.dmgArmor || 0) + (w.dmgHull || 0);
      let dps = dmg / ((w.fireRate_ms || 1000) / 1000);
      for (const sp of item.specials) {
        if (sp.key === "damage_pct") dps *= (1 + sp.val / 100);
      }
      return dps;
    }
    if (item.cat === "armor") {
      let hp = item.base_stats.armor_hp || 0;
      for (const sp of item.specials) {
        if (sp.key === "armor_hp") hp += sp.val;
      }
      return hp;
    }
    return item.value || 0;
  },

  // ---- equip / unequip actions (flat ForgeEquipment rack) ----
  gearEquip(invIdx, slotIndex) {
    const s = this.state;
    const item = s.inventory[invIdx]; if (!item) return false;
    const r = ForgeEquipment.equip(slotIndex, item);
    if (!r.ok) { toast(r.reason || "can't equip"); sfx("warn"); return false; }
    s.inventory.splice(invIdx, 1);
    if (r.swapped) s.inventory.push(r.swapped);   // displaced module returns to cargo
    this._syncActiveShipSlots();
    sfx("grab"); this.recomputeDerived(); this.checkWin();
    this.renderLoadoutPanel();
    return true;
  },
  gearUnequip(slotIndex) {
    const s = this.state;
    const r = ForgeEquipment.unequip(slotIndex);
    if (!r.ok) return false;
    s.inventory.push(r.item);
    this._syncActiveShipSlots();
    sfx("drop"); this.recomputeDerived();
    this.renderLoadoutPanel();
    return true;
  },

  // ---- ship-aware equip paths (loadout screen) --------------------------------
  // Active ship → the live-rack primitives above. Inactive ship → pure array
  // moves on ship.slots ↔ s.inventory: no ForgeEquipment, no recomputeDerived —
  // the live rack must never notice another ship's refit.
  loadoutEquip(shipId, invIdx, slotIndex) {
    const s = this.state;
    if (shipId === s.activeShipId) return this.gearEquip(invIdx, slotIndex);
    const ship = s.ships.find(sh => sh.id === shipId); if (!ship) return false;
    const item = s.inventory[invIdx]; if (!item) return false;
    if (slotIndex == null || slotIndex < 0) slotIndex = ship.slots.indexOf(null);
    if (slotIndex < 0 || slotIndex >= ship.slots.length) { toast("no free slot"); sfx("warn"); return false; }
    s.inventory.splice(invIdx, 1);
    const swapped = ship.slots[slotIndex];
    ship.slots[slotIndex] = item;
    if (swapped) s.inventory.push(swapped);
    sfx("grab");
    return true;
  },
  loadoutUnequip(shipId, slotIndex) {
    const s = this.state;
    if (shipId === s.activeShipId) return this.gearUnequip(slotIndex);
    const ship = s.ships.find(sh => sh.id === shipId); if (!ship) return false;
    const item = ship.slots[slotIndex]; if (!item) return false;
    ship.slots[slotIndex] = null;
    s.inventory.push(item);
    sfx("drop");
    return true;
  },

  // ---- Long-press to open stat modal on any .ghTile container ----
  _attachLongPress(container) {
    if (!container || HEADLESS || typeof document === "undefined") return;
    let timer = null, startX = 0, startY = 0, lastLpMs = 0;
    container.addEventListener("touchstart", (e) => {
      const tile = e.target.closest && e.target.closest(".ghTile");
      if (!tile) { timer = null; return; }
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      timer = setTimeout(() => {
        timer = null; lastLpMs = Date.now();
        this._onLongPressTile(tile);
      }, 490);
    }, { passive: true });
    container.addEventListener("touchmove", (e) => {
      if (!timer) return;
      const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
      if (Math.hypot(dx, dy) > 10) { clearTimeout(timer); timer = null; }
    }, { passive: true });
    container.addEventListener("touchend", () => { clearTimeout(timer); timer = null; }, { passive: true });
    container.addEventListener("touchcancel", () => { clearTimeout(timer); timer = null; }, { passive: true });
    // suppress the click that fires after long-press touchend
    container.addEventListener("click", (e) => {
      if (Date.now() - lastLpMs < 400) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  },
  _onLongPressTile(tile) {
    const s = this.state;
    // loadout inventory tile → open fit/sell modal (same as tap)
    if (tile.dataset.inv != null) {
      const item = s.inventory[+tile.dataset.inv]; if (!item) return;
      const page = this._loPage ? this._loPage() : null;
      if (page && page.kind === "ship") {
        const ship = page.ship, empty = ship.slots.indexOf(null);
        let deltas = null;
        if (empty >= 0) { const ns = ship.slots.slice(); ns[empty] = item; deltas = this._loShipDeltas(ship, ns); }
        this._ghOpenModal(item, { equipShip: ship.id, sell: true, invIdx: +tile.dataset.inv,
          deltas, deltaLabel: "if equipped on " + ship.name });
      } else {
        this._ghOpenModal(item, { sell: true, invIdx: +tile.dataset.inv });
      }
      return;
    }
    // store stock tile (module) → open buy modal
    if (tile.dataset.storeIdx != null) {
      const station = this._dockStation();
      const item = station && station.stock && station.stock[+tile.dataset.storeIdx];
      if (!item) return;
      this._ghOpenStoreModal(item, +tile.dataset.storeIdx); return;
    }
    // cargo tile → open sell modal
    if (tile.dataset.cargoIdx != null) {
      const item = s.inventory[+tile.dataset.cargoIdx]; if (!item) return;
      this._ghOpenModal(item, { sell: true, invIdx: +tile.dataset.cargoIdx }); return;
    }
    // material bar tile → info toast
    if (tile.dataset.bar) {
      const type = tile.dataset.bar, price = ForgeStore.barBuyPrice(type);
      const have = (s.refinedBars && s.refinedBars[type]) || 0;
      const station = this._dockStation();
      const left = ((station && station.barStock) || {})[type] || 0;
      toast(type + " bar · " + price + "cr · own " + have + " · stock " + left, "#57d1c9");
    }
  },

  // ---- DOM event wiring (boot-time, non-headless) ----
  wireLoadoutDOM() {
    const lo = this._loadoutDOM(); if (!lo) return;
    const panel = lo.panel;

    // header: tab buttons + launch
    panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("loLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });

    // carousel arrows + SET ACTIVE
    const prev = document.getElementById("loPrev"), next = document.getElementById("loNext");
    if (prev) prev.addEventListener("click", () => { this._loUI = this._loUI || { idx: 0 }; this._loUI.idx--; sfx("grab"); this.renderLoadoutPanel(); });
    if (next) next.addEventListener("click", () => { this._loUI = this._loUI || { idx: 0 }; this._loUI.idx++; sfx("grab"); this.renderLoadoutPanel(); });
    if (lo.activeBtn) lo.activeBtn.addEventListener("click", () => {
      const page = this._loPage();
      if (page && page.kind === "ship" && this.switchActiveShip(page.ship.id).ok) this.renderLoadoutPanel();
    });

    // tap a cargo tile → fit/sell modal (with the delta preview for the shown ship)
    lo.inv.addEventListener("click", (e) => {
      const tile = e.target.closest ? e.target.closest(".ghTile") : null;
      if (!tile) return;
      if (tile.dataset.oreType) {
        this.sellOre(tile.dataset.oreType); this.renderLoadoutPanel(); return;
      }
      if (tile.dataset.inv == null) return;
      const idx = +tile.dataset.inv;
      const item = this.state.inventory[idx]; if (!item) return;
      const page = this._loPage(); if (!page) return;
      if (page.kind === "ship") {
        const ship = page.ship, empty = ship.slots.indexOf(null);
        let deltas = null;
        if (empty >= 0) {
          const nextSlots = ship.slots.slice(); nextSlots[empty] = item;
          deltas = this._loShipDeltas(ship, nextSlots);
        }
        this._ghOpenModal(item, { equipShip: ship.id, sell: true, invIdx: idx,
          deltas, deltaLabel: "if equipped on " + ship.name });
      } else {
        // any module fits any slot: classify what it WOULD do, then fit to the next free slot
        const m = this.fleetItemToModule(item);
        const full = (page.drone.loadout || []).length >= DRONES.slotCount;
        const rows = m ? [[m.type + " fit", m.type === "weapon" ? m.dmg + " dmg @ " + m.fireRate + "/s" : "+" + m.amount + "/s"]] : [];
        if (full) rows.push(["slots", "full — unfit one first"]);
        this._ghOpenModal(item, { fitDrone: (m && !full) ? { fleetIdx: page.fleetIdx } : null,
          sell: true, invIdx: idx, moduleRows: rows });
      }
    });

    // tap a slot → contribution modal (UNEQUIP + what-it's-doing deltas)
    const onSlotTap = (e) => {
      const slotEl = e.target.closest ? e.target.closest(".loSlot") : null;
      if (!slotEl) return;
      const page = this._loPage(); if (!page) return;
      if (page.kind === "ship" && slotEl.dataset.slot != null) {
        const ship = page.ship, si = +slotEl.dataset.slot, item = ship.slots[si];
        if (!item) { toast("tap a cargo item to fit this slot"); return; }
        const without = ship.slots.slice(); without[si] = null;
        this._ghOpenModal(item, { unequipShip: { shipId: ship.id, slotIdx: si },
          deltas: this._loShipDeltas(ship, without), deltaLabel: "if unequipped" });
      } else if (page.kind === "drone" && slotEl.dataset.dslot != null) {
        const d = page.drone, si = +slotEl.dataset.dslot;
        const mod = (d.loadout || [])[si];
        if (!mod) { toast("tap a cargo item to fit this slot"); return; }
        const rows = [[mod.type, mod.type === "weapon" ? mod.dmg + " dmg @ " + mod.fireRate + "/s" : "+" + mod.amount + "/s"],
                      ["fuel/tick", mod.fuelCost]];
        // every slot — factory built-in or player-fitted — can be unequipped now
        const modalItem = mod.srcItem || { name: mod.name, tier: "normal", cat: mod.type === "weapon" ? "weapons" : "utility" };
        this._ghOpenModal(modalItem, { unfitDrone: { fleetIdx: page.fleetIdx, slotIdx: si }, moduleRows: rows });
      }
    };
    lo.slotsGrid.addEventListener("click", onSlotTap);
    this._attachLongPress(lo.inv);

    // Touch drag-and-drop (covers both loadout and store; safe to init once here)
    this._initTouchDragDrop();
  },

  // ---- Touch drag-and-drop for mobile dock panels ----
  // Inventory → slot:   drag a cargo tile onto an equipment slot to equip
  // Slot → slot:        drag between equipment slots to swap their contents
  // Slot → cargo area:  drag out of a slot to unequip back to cargo
  // Store cargo → sell zone: drag a cargo tile onto #stSellZone to sell instantly
  _initTouchDragDrop() {
    if (HEADLESS || typeof document === "undefined") return;
    if (this._ddInited) return; this._ddInited = true;

    const ghost = document.getElementById("ddGhost");
    if (!ghost) return;

    let drag = null;
    const THRESH = 12; // px of movement before drag activates

    // Hide ghost to sample what's under the pointer, then restore
    const elUnder = (x, y) => {
      const prev = ghost.style.display;
      ghost.style.display = "none";
      const el = document.elementFromPoint(x, y);
      ghost.style.display = prev;
      return el;
    };
    const clearOver = () => {
      document.querySelectorAll(".ddOver").forEach(e => e.classList.remove("ddOver"));
    };

    // Shared pointer logic — touch and mouse both funnel through these three.
    const processDragStart = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return;

      const tile = el.closest && el.closest(".ghTile");
      const slot = el.closest && el.closest(".ghSlot.loSlot");

      if (tile && tile.dataset.inv != null) {
        // Inventory tile in loadout panel
        const idx = +tile.dataset.inv;
        const item = this.state.inventory[idx]; if (!item) return;
        drag = { kind: "inv", idx, name: item.name, sx: x, sy: y, moved: false };
      } else if (tile && tile.dataset.cargoIdx != null) {
        // Cargo tile in store panel
        const idx = +tile.dataset.cargoIdx;
        const item = this.state.inventory[idx]; if (!item) return;
        drag = { kind: "cargo", idx, name: item.name, sx: x, sy: y, moved: false };
      } else if (slot && slot.dataset.slot != null) {
        // Ship equipment slot → drag to swap with another slot or unequip to cargo
        const page = this._loPage();
        if (!page || page.kind !== "ship") return;
        const si = +slot.dataset.slot;
        const item = page.ship.slots[si]; if (!item) return;
        drag = { kind: "slot", si, shipId: page.ship.id, name: item.name, sx: x, sy: y, moved: false };
      } else if (slot && slot.dataset.berth != null) {
        // Outpost berth drone module slot (fortify) — test berth BEFORE dslot,
        // berth slots carry both. Context = docked outpost, never _loPage().
        const o = this.dockedOutpost(); if (!o) return;
        const bi = +slot.dataset.berth, di = +slot.dataset.dslot;
        const d = o.stationedDrones[bi], mod = d && (d.loadout || [])[di]; if (!mod) return;
        drag = { kind: "bslot", bi, di, name: mod.name, sx: x, sy: y, moved: false };
      } else if (slot && slot.dataset.dslot != null) {
        // Drone module slot → drag to reorder or drop on cargo to unequip
        const page = this._loPage();
        if (!page || page.kind !== "drone") return;
        const di = +slot.dataset.dslot;
        const mod = (page.drone.loadout || [])[di]; if (!mod) return;
        drag = { kind: "dslot", di, fleetIdx: page.fleetIdx, name: mod.name, sx: x, sy: y, moved: false };
      }
    };

    const processDragMove = (x, y, evt) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) < THRESH) return;

      drag.moved = true;
      // prevent accidental scroll (touch) / text selection (mouse) during drag
      if (evt && evt.cancelable) evt.preventDefault();

      ghost.textContent = drag.name;
      ghost.style.display = "block";
      ghost.style.left = x + "px";
      ghost.style.top = y + "px";

      clearOver();
      const under = elUnder(x, y);
      if (!under) return;
      if (drag.kind === "inv" || drag.kind === "slot" || drag.kind === "dslot" || drag.kind === "bslot") {
        const dropSlot = under.closest && under.closest(".ghSlot.loSlot");
        if (dropSlot) { dropSlot.classList.add("ddOver"); return; }
        // Dragging a fitted slot out to the cargo area → highlight inv wrap (= unequip)
        if (drag.kind === "slot" || drag.kind === "dslot") {
          const inv = under.closest && under.closest("#loInvWrap");
          if (inv) { inv.classList.add("ddOver"); return; }
        }
        if (drag.kind === "bslot") {
          const inv = under.closest && under.closest("#foInvWrap");
          if (inv) { inv.classList.add("ddOver"); return; }
        }
      }
      // Cargo or inventory dragged UP onto the FOR SALE card → sell target
      if (drag.kind === "cargo" || drag.kind === "inv") {
        const zone = under.closest && (under.closest("#stStockWrap"));
        if (zone) {
          const wrap = document.getElementById("stStockWrap");
          if (wrap) wrap.classList.add("ddOver");
        }
      }
    };

    const processDragEnd = (x, y) => {
      if (!drag) return;
      const { kind, moved } = drag;
      ghost.style.display = "none";
      clearOver();

      if (moved) {
        const under = elUnder(x, y);
        if (under) {
          if (kind === "inv") {
            // Drop inventory item onto a slot → equip
            const dropSlot = under.closest && under.closest(".ghSlot.loSlot");
            if (dropSlot && dropSlot.dataset.slot != null) {
              const page = this._loPage();
              if (page && page.kind === "ship") {
                this.loadoutEquip(page.ship.id, drag.idx, +dropSlot.dataset.slot);
                this.renderLoadoutPanel();
              }
            } else if (dropSlot && dropSlot.dataset.berth != null) {
              // Drop cargo item onto an outpost berth drone slot → fit (berth before dslot)
              const o = this.dockedOutpost(), d = o && o.stationedDrones[+dropSlot.dataset.berth];
              if (d && this.droneFitModule(d, +dropSlot.dataset.dslot, drag.idx)) this.renderFortifyPanel();
            } else if (dropSlot && dropSlot.dataset.dslot != null) {
              // Drop inventory item onto a drone module slot → fit to that slot
              const page = this._loPage();
              if (page && page.kind === "drone") {
                this.fleetSwapModule(page.fleetIdx, +dropSlot.dataset.dslot, drag.idx);
                this.renderLoadoutPanel();
              }
            } else if (dropSlot && dropSlot.dataset.fslot != null) {
              // Drop inventory item onto a fortify hardpoint → fit to outpost
              const o = this.dockedOutpost();
              if (o && this.fortifyEquipModule(o, drag.idx)) this.renderFortifyPanel();
            } else {
              // Drop inventory item onto the FOR SALE card → sell (re-renders store)
              const zone = under.closest && (under.closest("#stStockWrap"));
              if (zone && this.state.inventory[drag.idx]) this._ghSellItem(drag.idx);
            }
          } else if (kind === "slot") {
            const dropSlot = under.closest && under.closest(".ghSlot.loSlot");
            if (dropSlot && dropSlot.dataset.slot != null) {
              // Drop slot onto slot → swap
              const targetSi = +dropSlot.dataset.slot;
              if (targetSi !== drag.si) {
                const ship = this.state.ships.find(sh => sh.id === drag.shipId);
                if (ship) {
                  const tmp = ship.slots[targetSi];
                  ship.slots[targetSi] = ship.slots[drag.si];
                  ship.slots[drag.si] = tmp;
                  sfx("grab"); this.renderLoadoutPanel();
                }
              }
            } else {
              // Drop slot onto cargo area → unequip
              const inv = under.closest && under.closest("#loInvWrap");
              if (inv) {
                this.loadoutUnequip(drag.shipId, drag.si);
                this.renderLoadoutPanel();
              }
            }
          } else if (kind === "dslot") {
            const dropSlot = under.closest && under.closest(".ghSlot.loSlot");
            if (dropSlot && dropSlot.dataset.dslot != null) {
              // Drop drone slot onto another drone slot → reorder
              const targetDi = +dropSlot.dataset.dslot;
              if (targetDi !== drag.di && this.fleetReorderModule(drag.fleetIdx, drag.di, targetDi))
                this.renderLoadoutPanel();
            } else {
              // Drop drone slot onto cargo area → unequip (frees the slot)
              const inv = under.closest && under.closest("#loInvWrap");
              if (inv) { this.fleetUnequipModule(drag.fleetIdx, drag.di); this.renderLoadoutPanel(); }
            }
          } else if (kind === "bslot") {
            const o = this.dockedOutpost(), d = o && o.stationedDrones[drag.bi];
            const dropSlot = under.closest && under.closest(".ghSlot.loSlot[data-berth]");
            if (dropSlot && +dropSlot.dataset.berth === drag.bi) {
              // reorder within the same berth (cross-berth intentionally unsupported)
              const targetDi = +dropSlot.dataset.dslot;
              if (targetDi !== drag.di && d && this.droneReorderModule(d, drag.di, targetDi)) this.renderFortifyPanel();
            } else {
              // drop on the fortify cargo area → unequip (frees the slot)
              const inv = under.closest && under.closest("#foInvWrap");
              if (inv && d) { this.droneUnequipModule(d, drag.di); this.renderFortifyPanel(); }
            }
          } else if (kind === "cargo") {
            // Drop cargo UP onto the FOR SALE card → sell immediately
            const zone = under.closest && (under.closest("#stStockWrap"));
            if (zone) this._ghSellItem(drag.idx);
          }
        }
      }
      drag = null;
    };

    // ---- Touch ----
    document.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      processDragStart(t.clientX, t.clientY);
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (!drag) return;
      const t = e.touches[0];
      processDragMove(t.clientX, t.clientY, e);
    }, { passive: false });

    document.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0];
      processDragEnd(t.clientX, t.clientY);
    }, { passive: true });

    // ---- Mouse (desktop) — same logic as touch ----
    document.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // Suppress text selection when starting a drag on a draggable element
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tile = el && el.closest && el.closest(".ghTile");
      const slot = el && el.closest && el.closest(".ghSlot.loSlot");
      if ((tile && (tile.dataset.inv != null || tile.dataset.cargoIdx != null)) ||
          (slot && (slot.dataset.slot != null || slot.dataset.dslot != null))) {
        e.preventDefault();
      }
      processDragStart(e.clientX, e.clientY);
    }, { passive: false });

    document.addEventListener("mousemove", (e) => {
      if (!drag) return;
      processDragMove(e.clientX, e.clientY, e);
    }, { passive: false });

    document.addEventListener("mouseup", (e) => {
      if (!drag) return;
      processDragEnd(e.clientX, e.clientY);
    }, { passive: true });
  },

  // ================= DOM STORE PANEL (#storePanel — build.py <body>) =============
  _storeDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._st) return this._st;
    const $ = id => document.getElementById(id);
    const panel = $("storePanel");
    if (!panel) return null;
    this._st = { panel, cred: $("stCred"), stock: $("stStock"), cargo: $("stCargo"),
                 stockHead: $("stStockHead"), _shown: false };
    return this._st;
  },
  syncStoreDOM() {
    const st = this._storeDOM(); if (!st) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "store");
    st.panel.classList.toggle("show", show);
    if (!show) { st._shown = false; return; }
    this._syncDockTabs(st.panel);
    if (!st._shown) { st._shown = true; this.renderStorePanel(); }
  },
  _stItemStat(item) {
    if (!item) return "";
    if (item.weapon) {
      const w = item.weapon;
      const avg = Math.round((w.dmgShield + w.dmgArmor + (w.dmgHull || 0)) / 2);
      return avg + " dmg";
    }
    const bs = item.base_stats;
    if (bs) {
      const keys = Object.keys(bs);
      if (keys.length) {
        const k = keys[0], v = bs[k];
        const label = k.replace(/_pct$/, "").replace(/_/g, " ");
        return (v > 0 ? "+" : "") + v + (k.endsWith("_pct") ? "% " : " ") + label;
      }
    }
    return "";
  },
  renderStorePanel() {
    const sd = this._storeDOM(); if (!sd) return;
    const s = this.state, station = this._dockStation();
    sd.cred.textContent = Math.round(s.credits);
    sd.stockHead.textContent = (station ? station.name.toUpperCase() : "STATION") + " — FOR SALE · drag cargo here to sell";
    const stock = (station && station.stock) || [];

    // ---- station stock (4-col icon grid) — bar tiles first, then modules ----
    sd.stock.innerHTML = "";
    // refined material bar tiles (tap to buy 1)
    const barStock = (station && station.barStock) || {};
    for (const type of ForgeStore.BAR_TYPES) {
      const ring = CONFIG.rings.find(r => r.type === type);
      const have = (s.refinedBars && s.refinedBars[type]) || 0;
      const left = barStock[type] || 0;
      const price = ForgeStore.barBuyPrice(type);
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.bar = type;
      if (left < 1) tile.style.opacity = "0.4";
      const badge = document.createElement("span"); badge.className = "ghBadge";
      badge.style.background = ring ? ring.col : "#8a8f98";
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "10px"; badge.style.borderRadius = "8px";
      badge.textContent = type.slice(0, 2).toUpperCase();
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.textContent = type + " bar";
      tile.appendChild(nm);
      const pr = document.createElement("span"); pr.className = "ghTileName";
      pr.style.color = "#ffd27a"; pr.style.fontSize = "9px";
      pr.textContent = price + "cr · ×" + left + " stk";
      tile.appendChild(pr);
      tile.style.borderColor = ring ? ring.col : "#223047";
      sd.stock.appendChild(tile);
    }
    if (!stock.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.style.gridColumn = "1 / -1";
      note.textContent = "store empty — come back later";
      sd.stock.appendChild(note);
    }
    stock.forEach((item, idx) => {
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.storeIdx = String(idx);
      const badge = this._ghBadgeEl(item);
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "12px"; badge.style.borderRadius = "8px";
      badge.style.boxShadow = "0 0 6px " + (GH_RARITY[item.tier] || GH_RARITY.normal);
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.style.color = GH_RARITY[item.tier] || "#c7d2e0";
      nm.textContent = item.name;
      tile.appendChild(nm);
      const price = document.createElement("span"); price.className = "ghTileName";
      price.style.color = "#ffd27a"; price.style.fontSize = "9px";
      price.textContent = ForgeStore.buyPrice(item) + "cr";
      tile.appendChild(price);
      tile.style.borderColor = GH_RARITY[item.tier] || "#223047";
      sd.stock.appendChild(tile);
    });

    // ---- home station button (stations only — an outpost can't be home port) ----
    if (!this.dockedOutpost()) {
      const isHome = s.homeStationId === s.dockStationId;
      const homeBtn = document.createElement("button");
      homeBtn.className = "stHomeBtn" + (isHome ? " active" : "");
      homeBtn.dataset.act = "home";
      homeBtn.textContent = isHome ? "★ HOME PORT" : "SET AS HOME PORT";
      homeBtn.style.gridColumn = "1 / -1";
      sd.stock.appendChild(homeBtn);
    }

    // ---- your cargo (4-col icon grid) ----
    sd.cargo.innerHTML = "";
    const oreTypes = Object.keys(s.ore).filter(t => s.ore[t] && s.ore[t].count > 0);
    for (const type of oreTypes) {
      const ring = CONFIG.rings.find(r => r.type === type);
      if (!ring) continue;
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.oreType = type;
      const badge = document.createElement("span"); badge.className = "ghBadge"; badge.style.background = ring.col; badge.textContent = "OR";
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "12px"; badge.style.borderRadius = "8px";
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.textContent = (CONFIG.oreNames[type] || type) + " ×" + s.ore[type].count;
      tile.appendChild(nm);
      tile.style.borderColor = ring.col;
      sd.cargo.appendChild(tile);
    }
    // refined bar cargo tiles — player's held bars shown for sell-back
    const refinedBars = s.refinedBars || {};
    for (const type of ForgeStore.BAR_TYPES) {
      const have = refinedBars[type] || 0;
      if (have < 1) continue;
      const ring = CONFIG.rings.find(r => r.type === type);
      const barSellPr = Math.round(ForgeStore.barBuyPrice(type) * 0.8);
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.barCargo = type;
      const badge = document.createElement("span"); badge.className = "ghBadge";
      badge.style.background = ring ? ring.col : "#8a8f98";
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "10px"; badge.style.borderRadius = "8px";
      badge.textContent = type.slice(0, 2).toUpperCase();
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName"; nm.textContent = type + " bar ×" + have;
      tile.appendChild(nm);
      const sp = document.createElement("span"); sp.className = "ghTileSell"; sp.textContent = barSellPr + "cr";
      tile.appendChild(sp);
      tile.style.borderColor = ring ? ring.col : "#223047";
      sd.cargo.appendChild(tile);
    }
    if (!s.inventory.length && !oreTypes.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.style.gridColumn = "1 / -1";
      note.textContent = "cargo empty";
      sd.cargo.appendChild(note);
    }
    s.inventory.forEach((item, idx) => {
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.cargoIdx = String(idx);
      const badge = this._ghBadgeEl(item);
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "12px"; badge.style.borderRadius = "8px";
      badge.style.boxShadow = "0 0 6px " + (GH_RARITY[item.tier] || GH_RARITY.normal);
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.style.color = GH_RARITY[item.tier] || "#c7d2e0";
      nm.textContent = item.name;
      tile.appendChild(nm);
      const sellVal = Math.round(ForgeItemSystem.getItemValue(item) * 0.7);
      const sp = document.createElement("span"); sp.className = "ghTileSell";
      sp.textContent = sellVal + "cr";
      tile.appendChild(sp);
      tile.style.borderColor = GH_RARITY[item.tier] || "#223047";
      sd.cargo.appendChild(tile);
    });
  },
  wireStoreDOM() {
    const sd = this._storeDOM(); if (!sd) return;
    sd.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("stLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    // stock tiles: tap opens stat modal with Buy/Back buttons
    sd.stock.addEventListener("click", (e) => {
      const tile = e.target.closest ? e.target.closest(".ghTile") : null;
      const homeBtn = e.target.closest ? e.target.closest(".stHomeBtn") : null;
      if (homeBtn) {
        const s = this.state;
        ForgeStore.setHomeStation(s.dockStationId, s);
        s.homeStationId = s.dockStationId; s.refineBonus = 0.10;
        toast("home port set"); sfx("buy"); this.renderStorePanel();
        return;
      }
      if (!tile) return;
      // bar tile: open modal with Buy/Back
      if (tile.dataset.bar) {
        const s = this.state, type = tile.dataset.bar;
        const station2 = this._dockStation();
        const barStock2 = (station2 && station2.barStock) || {};
        const left = barStock2[type] || 0;
        const price = ForgeStore.barBuyPrice(type);
        if (left < 1) { toast("sold out"); sfx("warn"); return; }
        // slider caps at whatever's affordable AND in stock, so the buy can't fail
        const affordable = price > 0 ? Math.floor(s.credits / price) : left;
        const qtyMax = Math.max(1, Math.min(left, affordable));
        const pseudoItem = { name: type + " bar", tier: "normal", cat: "material" };
        this._ghOpenModal(pseudoItem, {
          buyMode: true, buyPrice: price, qtyMax,
          onBuy: (qty) => {
            qty = Math.max(1, qty | 0);
            if (!s.refinedBars) s.refinedBars = {};
            const r = ForgeStore.buyBar(type, qty, s);
            if (!r.success) { toast(r.reason === "insufficient credits" ? "not enough credits" : "sold out"); sfx("warn"); return; }
            sfx("buy"); toast(`+${r.qty} ${r.type} bar${r.qty > 1 ? "s" : ""}`, "#7bd88f"); toast(`-${r.price}cr`, "#ffd27a");
            this.addXpFromCredits(r.price); this.gainRep("buy"); this.renderStorePanel();
          }
        });
        return;
      }
      if (tile.dataset.storeIdx == null) return;
      const idx = +tile.dataset.storeIdx;
      const station = this._dockStation();
      const stock = (station && station.stock) || [];
      const item = stock[idx]; if (!item) return;
      const buyPrice = ForgeStore.buyPrice(item);
      this._ghOpenModal(item, {
        buyMode: true, buyPrice: buyPrice,
        onBuy: () => {
          const r = ForgeStore.buyItem(idx, this.state);
          if (!r.success) {
            if (r.reason === "insufficient credits") { sfx("warn"); toast("NOT ENOUGH CREDITS", "#ff5060"); }
            else if (r.reason === "inventory full") { sfx("warn"); toast("CARGO FULL", "#ff5060"); }
          } else {
            sfx("buy"); toast("+1 " + r.item.name, "#7bd88f"); toast("-" + r.price + "cr", "#ffd27a");
            this.gainRep("buy"); this.checkWin();
          }
          this.renderStorePanel();
        }
      });
    });
    this._attachLongPress(sd.stock);
    this._attachLongPress(sd.cargo);
    // cargo tiles → open modal with SELL
    sd.cargo.addEventListener("click", (e) => {
      const tile = e.target.closest ? e.target.closest(".ghTile") : null;
      if (!tile) return;
      // bar cargo tile → sell 1 bar back to station
      if (tile.dataset.barCargo) {
        const s = this.state, type = tile.dataset.barCargo;
        const have = (s.refinedBars && s.refinedBars[type]) || 0;
        if (have < 1) { toast("none to sell"); sfx("warn"); return; }
        const barSellPr = Math.round(ForgeStore.barBuyPrice(type) * 0.8);
        s.refinedBars[type] = have - 1;
        s.credits = (s.credits || 0) + barSellPr;
        // return the bar to the station shelf so its stock count reflects the sale
        const station = this._dockStation();
        if (station) { if (!station.barStock) station.barStock = {}; station.barStock[type] = (station.barStock[type] || 0) + 1; }
        sfx("sell"); toast("-1 " + type + " bar", "#ff9a3c"); toast("+" + barSellPr + "cr", "#ffd27a");
        this.gainRep("sell"); this.renderStorePanel(); return;
      }
      if (tile.dataset.oreType) {
        this.sellOre(tile.dataset.oreType); this.renderStorePanel(); return;
      }
      if (tile.dataset.cargoIdx != null) {
        const idx = +tile.dataset.cargoIdx;
        const item = this.state.inventory[idx]; if (!item) return;
        this._ghOpenModal(item, { sell: true, invIdx: idx });
      }
    });
    // "Sell All…" button → open the rarity/ore modal
    const sellAll = document.getElementById("stSellAllBtn");
    if (sellAll) sellAll.addEventListener("click", () => this._openSellAllModal());
  },

  // ---- "Sell All" modal: bulk-sell inventory by rarity tier (+ optionally mined ores) ----
  _openSellAllModal() {
    if (HEADLESS || typeof document === "undefined") return;
    if (document.getElementById("sellAllModal")) return;   // already open
    const s = this.state;
    // Rarity tiers come straight from GH_RARITY (normal/rare/unique/elite). Only "normal" (Basic) on by default.
    const tiers = Object.keys(GH_RARITY);

    const overlay = document.createElement("div"); overlay.id = "sellAllModal";
    const card = document.createElement("div"); card.className = "saCard";
    card.innerHTML =
      '<h3>Sell All Items</h3>' +
      '<div class="saLbl">Sell items of rarity:</div>' +
      '<div class="saGrid">' +
        tiers.map((t, i) =>
          '<label><input type="checkbox" class="saTier" data-tier="' + t + '"' +
          (i === 0 ? ' checked' : '') + '>' + (GH_RARITY_LABEL[t] || t) + '</label>').join('') +
      '</div>' +
      '<div class="saDiv"></div>' +
      '<label class="saOre"><input type="checkbox" id="saOre">Also sell mined ores</label>' +
      '<div class="saBtns">' +
        '<button class="saCancel">Cancel</button>' +
        '<button class="saConfirm">Sell (0 items)</button>' +
      '</div>';
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const tierBoxes = () => Array.from(card.querySelectorAll('.saTier'));
    const oreBox = card.querySelector('#saOre');
    const confirm = card.querySelector('.saConfirm');
    const cancel = card.querySelector('.saCancel');

    const checkedTiers = () => tierBoxes().filter(b => b.checked).map(b => b.dataset.tier);
    const oreUnits = () => Object.keys(s.ore).reduce((n, t) =>
      n + ((s.ore[t] && s.ore[t].count > 0) ? s.ore[t].count : 0), 0);
    const countItems = () => {
      const cts = checkedTiers();
      let n = s.inventory.filter(it => it && cts.indexOf(it.tier) >= 0).length;
      if (oreBox.checked) n += oreUnits();
      return n;
    };
    const refresh = () => {
      const n = countItems();
      confirm.textContent = 'Sell (' + n + ' item' + (n === 1 ? '' : 's') + ')';
      confirm.disabled = n === 0;
    };
    refresh();

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    tierBoxes().forEach(b => b.addEventListener('change', refresh));
    oreBox.addEventListener('change', refresh);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      const cts = checkedTiers();
      // Sell high index → low so earlier removals don't shift the indices we still need.
      for (let i = s.inventory.length - 1; i >= 0; i--) {
        const it = s.inventory[i];
        if (it && cts.indexOf(it.tier) >= 0) this._ghSellItem(i);
      }
      if (oreBox.checked) this.sellAllOre();
      this.renderStorePanel();
      close();
    });
  },

  // ================= DOM WARP PANEL (#warpPanel — build.py <body>) ===============
  _warpDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._wp) return this._wp;
    const $ = id => document.getElementById(id);
    const panel = $("warpPanel");
    if (!panel) return null;
    this._wp = { panel, cred: $("wpCred"), list: $("wpList"), listHead: $("wpListHead"),
                 progress: $("wpProgress"), _shown: false };
    return this._wp;
  },
  syncWarpDOM() {
    const wp = this._warpDOM(); if (!wp) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "warp");
    wp.panel.classList.toggle("show", show);
    if (show) this._syncDockTabs(wp.panel);
    if (!show) { wp._shown = false; return; }
    if (!wp._shown) { wp._shown = true; this.renderWarpPanel(); }
  },
  renderWarpPanel() {
    const wp = this._warpDOM(); if (!wp) return;
    const s = this.state, stations = ForgeWorld.getStations();
    const curStation = stations.find(x => x.id === s.dockStationId);
    const originX = curStation ? curStation.pos.x : s.x, originY = curStation ? curStation.pos.y : s.y;
    if (!s.markedStations) s.markedStations = [];
    wp.cred.textContent = Math.round(s.credits);
    wp.listHead.textContent = "WARP NETWORK — " + (curStation ? curStation.name.toUpperCase() : "STATION");

    const COMPASS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    const bearing = (dx, dy) => COMPASS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
    const distTo = st => Math.round(Math.hypot(st.pos.x - originX, st.pos.y - originY));

    wp.list.innerHTML = "";
    // ---- charted destinations: flying there once already unlocked the warp ----
    const charted = stations.filter(st => st.discovered && st.id !== s.dockStationId).sort((a, b) => distTo(a) - distTo(b));
    for (const st of charted) {
      const row = document.createElement("div"); row.className = "wpRow";
      const nm = document.createElement("span"); nm.className = "wpStName"; nm.textContent = st.name;
      const planet = s.planets.find(p => p.stationIdx === st.id);
      const planetEl = document.createElement("span"); planetEl.className = "wpPlanet"; planetEl.textContent = planet ? planet.name : "";
      const distEl = document.createElement("span"); distEl.className = "wpDist"; distEl.textContent = distTo(st) + "u";
      const badge = document.createElement("span"); badge.className = "wpGateBadge built"; badge.textContent = "⌘ READY";
      const jumpBtn = document.createElement("button"); jumpBtn.className = "wpJumpBtn";
      jumpBtn.textContent = "JUMP →"; jumpBtn.dataset.act = "jump"; jumpBtn.dataset.sid = String(st.id);
      if (s.fuel < 50) { jumpBtn.disabled = true; jumpBtn.title = "need 50 fuel to warp"; }
      row.appendChild(nm); row.appendChild(planetEl); row.appendChild(distEl); row.appendChild(badge); row.appendChild(jumpBtn);
      wp.list.appendChild(row);
    }

    // ---- uncharted: can't warp yet, but MARK ON MAP drops a waypoint on the galaxy map ----
    const uncharted = stations.filter(st => !st.discovered).sort((a, b) => distTo(a) - distTo(b));
    if (uncharted.length) {
      const sub = document.createElement("div"); sub.className = "wpSubHead";
      sub.textContent = "UNCHARTED — fly there once to unlock warp";
      wp.list.appendChild(sub);
    }
    for (const st of uncharted) {
      const marked = s.markedStations.indexOf(st.id) >= 0;
      const row = document.createElement("div"); row.className = "wpRow uncharted";
      const nm = document.createElement("span"); nm.className = "wpStName"; nm.textContent = "◌ Uncharted Station";
      const distEl = document.createElement("span"); distEl.className = "wpDist";
      distEl.textContent = distTo(st) + "u · " + bearing(st.pos.x - originX, st.pos.y - originY);
      const badge = document.createElement("span"); badge.className = "wpGateBadge" + (marked ? " marked" : " none");
      badge.textContent = marked ? "◎ MARKED" : "UNKNOWN";
      const markBtn = document.createElement("button"); markBtn.className = "wpMarkBtn" + (marked ? " marked" : "");
      markBtn.textContent = marked ? "✓ ON MAP" : "MARK ON MAP"; markBtn.dataset.act = "mark"; markBtn.dataset.sid = String(st.id);
      row.appendChild(nm); row.appendChild(distEl); row.appendChild(badge); row.appendChild(markBtn);
      wp.list.appendChild(row);
    }

    if (!wp.list.children.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.textContent = "no other stations in range — explore the system";
      wp.list.appendChild(note);
    }

    wp.progress.innerHTML = "";
    const chartedCount = stations.filter(st => st.discovered).length;
    const markCount = s.markedStations.filter(id => { const st = stations.find(x => x.id === id); return st && !st.discovered; }).length;
    const d1 = document.createElement("span"); d1.innerHTML = "Charted: <b>" + chartedCount + " / " + stations.length + "</b> stations";
    const d2 = document.createElement("span"); d2.innerHTML = "Marked: <b>" + markCount + "</b> on map";
    wp.progress.appendChild(d1); wp.progress.appendChild(d2);
  },
  wireWarpDOM() {
    const wp = this._warpDOM(); if (!wp) return;
    wp.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("wpLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    wp.list.addEventListener("click", (e) => {
      const btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn || btn.disabled) return;
      const s = this.state, sid = +btn.dataset.sid;
      if (btn.dataset.act === "jump") {
        this.warpJump(sid);   // commits the jump + shows the fullscreen tunnel; leaving the bay hides this panel
      } else if (btn.dataset.act === "mark") {
        if (!s.markedStations) s.markedStations = [];
        const idx = s.markedStations.indexOf(sid);
        if (idx >= 0) { s.markedStations.splice(idx, 1); toast("waypoint cleared"); sfx("drop"); }
        else { s.markedStations.push(sid); toast("◎ marked on galaxy map", "#ffd24a"); sfx("grab"); }
        this.saveGame();
        this.renderWarpPanel();
      }
    });
  },

  // ================= DOM FORTIFY PANEL (#fortifyPanel — build.py <body>) =========
  // Outpost-dock only tab: 4 module hardpoints (equip from cargo via the shared
  // item modal) + 3 stationed-drone berths (ASSIGN from the player fleet /
  // RECALL back), over the same dark-card DOM pattern as the other dock tabs.
  _foDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._fo) return this._fo;
    const $ = id => document.getElementById(id);
    const panel = $("fortifyPanel");
    if (!panel) return null;
    this._fo = { panel, cred: $("foCred"), name: $("foName"), slots: $("foSlots"),
                 stats: $("foStats"), drones: $("foDrones"), inv: $("foInv"), _shown: false };
    return this._fo;
  },
  syncFortifyDOM() {
    const fo = this._foDOM(); if (!fo) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "fortify" && this.dockedOutpost());
    fo.panel.classList.toggle("show", show);
    if (show) this._syncDockTabs(fo.panel);
    if (!show) { fo._shown = false; if (this._foUI) { this._foUI.assign = false; this._foUI.swap = null; } return; }
    if (!fo._shown) { fo._shown = true; this.renderFortifyPanel(); }
  },
  renderFortifyPanel() {
    const fo = this._foDOM(); if (!fo) return;
    const s = this.state, o = this.dockedOutpost(); if (!o) return;
    const ui = this._foUI = this._foUI || { assign: false };
    fo.cred.textContent = Math.round(s.credits);
    if (fo.name) fo.name.textContent = "Outpost " + this.regionLabel(this.regionGet(o.regionId));

    // ---- 4 module hardpoints ----
    fo.slots.innerHTML = "";
    for (let i = 0; i < CONFIG.outpostModuleSlots; i++)
      this._loSlotEl(fo.slots, o.modules[i] || null, { fslot: String(i) }, "hardpoint " + (i + 1));

    // ---- defense readout ----
    fo.stats.innerHTML = "";
    const statLine = (lbl, v, col) => {
      const row = document.createElement("div"); row.className = "ghMStatRow";
      const l = document.createElement("span"); l.className = "ghMStatLbl"; l.textContent = lbl;
      const r = document.createElement("span"); r.className = "ghMStatVal"; r.textContent = v;
      if (col) r.style.color = col;
      row.appendChild(l); row.appendChild(r); fo.stats.appendChild(row);
    };
    statLine("Shield", Math.round(o.shield) + " / " + o.shieldMax, "#57d1c9");
    statLine("Armor", Math.round(o.armor) + " / " + o.armorMax, "#ffd24a");
    statLine("Hull", Math.round(o.hull) + " / " + o.hullMax, "#7bd88f");
    statLine("Shield Regen", o.shieldRegen + "/s", "#57d1c9");
    statLine("Turret", o.turretDmg + " dmg · " + o.turretRange + "u", "#ff8f6b");
    // ---- trade lanes (game/trade_routes.js): local owned neighbors = open routes ----
    const nbAll = (o.neighborIds || []).length, nbOwned = this.tradeNeighborsOwned(o).length;
    statLine("Trade Lanes", nbOwned + " open / " + nbAll + " local neighbors",
      nbOwned ? "#22cccc" : "#7f8ea6");
    statLine("Route Earnings", Math.round(s.tradeRouteEarnings || 0) + "cr lifetime", "#ffd27a");
    if (!nbOwned && nbAll) {
      const hint = document.createElement("div"); hint.className = "ghNote";
      hint.textContent = "capture a neighboring outpost, then berth drones here — they'll run trade loops automatically";
      fo.stats.appendChild(hint);
    }

    // ---- 3 stationed-drone berths — each a card with editable module slots ----
    fo.drones.innerHTML = "";
    for (let i = 0; i < CONFIG.outpostStationedMax; i++) {
      const d = o.stationedDrones[i];
      if (d) {
        const card = this._drEl("foBerth", null, fo.drones);
        const top = this._drEl("foBerthTop", null, card);
        this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, top);
        // trading freighters show their lane + per-trip pay; others their duty state
        let duty = (d.state || "stationed").toUpperCase();
        const recalling = d.state === "trade" && d.route && d.route.leg === "recall";
        if (recalling) duty = "⟲ RECALLED — DEFEND HOME";
        else if (d.state === "trade" && d.route) {
          const destO = this.outpostById(d.route.destId);
          duty = "⇄ " + (destO ? this.regionLabel(this.regionGet(destO.regionId)) : "route") + " · " + d.route.payout + "cr/trip";
        }
        const dutyEl = this._drEl("drRoute", duty, top);
        if (d.state === "trade") dutyEl.style.color = recalling ? "#ff9a3c" : "#22cccc";
        const out = this._drEl("drBarOut", null, top);
        const fill = this._drEl("drBarFill flHp", null, out);
        fill.style.width = Math.round(clamp(d.hp / d.maxHp, 0, 1) * 100) + "%";
        const rc = this._drEl("btn:ghBtn flRemove", "RECALL", top);
        rc.dataset.recall = String(i);
        // fitted-module readout: DPS / repair / shield-regen only show once a module
        // actually contributes them, so this is the "modules are working" confirmation
        const { dps, repairAmt, utilAmt } = this._droneStatSummary(d);
        const statParts = ["HP " + Math.round(d.hp) + "/" + d.maxHp, "Shield " + Math.round(d.shield) + "/" + Math.max(1, d.maxShield)];
        if (dps) statParts.push("DPS " + dps);
        if (repairAmt) statParts.push("Repair +" + repairAmt + "/s");
        if (utilAmt) statParts.push("Shield Regen +" + utilAmt + "/s");
        this._drEl("foBerthStats", statParts.join(" · "), card);
        // the drone's own 3 module slots — drag a cargo module on, tap to remove
        const grid = this._drEl("foBerthSlots", null, card);
        d.loadout = d.loadout || [];
        for (let sl = 0; sl < DRONES.slotCount; sl++) {
          const m = d.loadout[sl] || null;
          const label = m ? m.type.toUpperCase() : "SLOT " + (sl + 1);
          this._loSlotEl(grid, m && (m.srcItem || { name: m.name, tier: "normal", cat: m.type === "weapon" ? "weapons" : "utility" }),
            { berth: String(i), dslot: String(sl) }, label);
        }
      } else {
        const row = this._drEl("drDrone", null, fo.drones);
        const e = this._drEl("drRoute", "— berth " + (i + 1) + " empty —", row);
        e.style.color = "#5a6a82";
        const as = this._drEl("btn:ghBtn flToEscort", "ASSIGN", row);
        as.dataset.assignopen = "1";
      }
    }
    if (ui.assign) {   // inline picker over the player fleet (trade runs excluded)
      const picker = this._drEl("flDest", null, fo.drones);
      const eligible = s.playerFleet.map((d, fi) => ({ d, fi })).filter(x => x.d.role !== "trade");
      this._drEl("flDestHead", "Station a companion — it leaves your fleet and defends this outpost", picker);
      if (!eligible.length) this._drEl("ghNote", "No drones free — build companions at a station HANGAR.", picker);
      for (const { d, fi } of eligible) {
        const row = this._drEl("btn:flDestRow", null, picker);
        row.dataset.assignpick = String(fi);
        this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, row);
        this._drEl("flDestName", (d.role || "").toUpperCase() + " · HP " + Math.round(d.hp) + "/" + d.maxHp, row);
      }
      const cancel = this._drEl("btn:ghBtn flDestCancel", "cancel", picker);
      cancel.dataset.assigncancel = "1";
    }
    if (ui.swap != null) {   // hangar full — pick a drone to send to the berth in exchange
      const picker = this._drEl("flDest", null, fo.drones);
      const eligible = s.playerFleet.map((d, fi) => ({ d, fi })).filter(x => x.d.role !== "trade");
      this._drEl("flDestHead", "Hangar full — pick a drone to send to this berth in exchange for the recalled one", picker);
      if (!eligible.length) this._drEl("ghNote", "No swappable drones (all on trade runs).", picker);
      for (const { d, fi } of eligible) {
        const row = this._drEl("btn:flDestRow", null, picker);
        row.dataset.swappick = String(fi);
        this._drEl("drTag t" + d.tier, DRONES.tiers[d.tier].name, row);
        this._drEl("flDestName", (d.role || "").toUpperCase() + " · HP " + Math.round(d.hp) + "/" + d.maxHp, row);
      }
      const cancel = this._drEl("btn:ghBtn flDestCancel", "cancel", picker);
      cancel.dataset.swapcancel = "1";
    }

    // ---- cargo grid (items only — tap opens the shared fit/sell modal) ----
    fo.inv.innerHTML = "";
    if (!s.inventory.length) {
      const note = document.createElement("div"); note.className = "ghNote";
      note.style.gridColumn = "1 / -1";
      note.textContent = "cargo empty — buy or salvage modules to fortify";
      fo.inv.appendChild(note);
    }
    s.inventory.forEach((item, idx) => {
      const tile = document.createElement("div"); tile.className = "ghTile"; tile.dataset.inv = String(idx);
      const badge = this._ghBadgeEl(item);
      badge.style.width = "30px"; badge.style.height = "30px"; badge.style.fontSize = "12px"; badge.style.borderRadius = "8px";
      badge.style.boxShadow = "0 0 6px " + (GH_RARITY[item.tier] || GH_RARITY.normal);
      tile.appendChild(badge);
      const nm = document.createElement("span"); nm.className = "ghTileName";
      nm.style.color = GH_RARITY[item.tier] || "#c7d2e0";
      nm.textContent = item.name;
      tile.appendChild(nm);
      tile.style.borderColor = GH_RARITY[item.tier] || "#223047";
      fo.inv.appendChild(tile);
    });
  },
  wireFortifyDOM() {
    const fo = this._foDOM(); if (!fo) return;
    fo.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("foLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    // hardpoint slots → module detail modal with UNEQUIP
    fo.slots.addEventListener("click", (e) => {
      const slotEl = e.target.closest ? e.target.closest(".loSlot") : null;
      if (!slotEl || slotEl.dataset.fslot == null) return;
      const o = this.dockedOutpost(); if (!o) return;
      const si = +slotEl.dataset.fslot, item = o.modules[si];
      if (!item) { toast("tap a cargo item to fit this hardpoint"); return; }
      this._ghOpenModal(item, { unfitFortify: { slotIdx: si } });
    });
    // drone berths → berth-slot module edit · assign · recall (with swap) · swap pick
    fo.drones.addEventListener("click", (e) => {
      const o = this.dockedOutpost(); if (!o) return;
      const ui = this._foUI = this._foUI || { assign: false };
      // a berthed drone's own module slot: filled → unequip modal; empty → hint
      const slotEl = e.target.closest ? e.target.closest(".loSlot[data-berth]") : null;
      if (slotEl) {
        const bi = +slotEl.dataset.berth, si = +slotEl.dataset.dslot;
        const d = o.stationedDrones[bi], mod = d && (d.loadout || [])[si];
        if (!mod) { toast("drag a cargo module here to fit this slot"); return; }
        const modalItem = mod.srcItem || { name: mod.name, tier: "normal", cat: mod.type === "weapon" ? "weapons" : "utility" };
        this._ghOpenModal(modalItem, { unfitOutpostDrone: { berthIdx: bi, slotIdx: si },
          moduleRows: [[mod.type, mod.type === "weapon" ? mod.dmg + " dmg @ " + mod.fireRate + "/s" : "+" + mod.amount + "/s"], ["fuel/tick", mod.fuelCost]] });
        return;
      }
      const btn = e.target.closest ? e.target.closest("[data-recall],[data-assignopen],[data-assignpick],[data-assigncancel],[data-swappick],[data-swapcancel]") : null;
      if (!btn) return;
      if (btn.dataset.recall != null) {
        const bi = +btn.dataset.recall;
        if (this.state.playerFleet.length < DRONES.ownedMax) this.recallDroneFromOutpost(o, bi);
        else { ui.swap = bi; ui.assign = false; }   // hangar full → open swap picker
      }
      else if (btn.dataset.assignopen) { ui.assign = true; ui.swap = null; }
      else if (btn.dataset.assigncancel) ui.assign = false;
      else if (btn.dataset.assignpick != null) { if (this.assignDroneToOutpost(o, +btn.dataset.assignpick).ok) ui.assign = false; }
      else if (btn.dataset.swapcancel) ui.swap = null;
      else if (btn.dataset.swappick != null) { if (this.recallDroneWithSwap(o, ui.swap, +btn.dataset.swappick).ok) ui.swap = null; }
      this.renderFortifyPanel();
    });
    // cargo tiles → shared item modal: FIT TO OUTPOST (platform) / FIT → each berth drone / SELL
    fo.inv.addEventListener("click", (e) => {
      const tile = e.target.closest ? e.target.closest(".ghTile") : null;
      if (!tile || tile.dataset.inv == null) return;
      const idx = +tile.dataset.inv, item = this.state.inventory[idx];
      if (!item) return;
      const o = this.dockedOutpost();
      const targets = !o ? [] : (o.stationedDrones || []).map((d, bi) => ({ d, bi }))
        .filter(x => (x.d.loadout || []).length < DRONES.slotCount)
        .map(x => ({ berthIdx: x.bi, label: DRONES.tiers[x.d.tier].name + " b" + (x.bi + 1) }));
      this._ghOpenModal(item, { fortifyEquip: true, fortifyDroneTargets: targets, sell: true, invIdx: idx });
    });
  },

  // ---- flight HUD taps (returns true if consumed) ----
  // TRACTOR + engine-mode buttons removed (v4.1 declutter): SPACE / tap-a-rock tow,
  // Q toggles engine mode, thrust direction is automatic.
  gameButtons() {
    const W = CONFIG.W, H = CONFIG.H;
    const tw = 36, tg = 4, ty = H - 36, tx0 = W - (tw * 4 + tg * 3) - 10;
    const k = Math.min(W / 390, H / 700);   // mute tracks the k-scaled SEC badge above it
    return {
      dock:    { x: 12, y: 70, w: 84, h: 26 },
      fuel:    { x: 100, y: 70, w: 76, h: 26 },
      mute:    { x: W - 48 * k, y: 178 * k, w: 36 * k, h: 22 * k },   // speaker toggle under SEC
      map:     { x: 12, y: H - 96, w: 64, h: 22 },
      empire:  { x: 12, y: H - 122, w: 84, h: 22 },   // live region count — opens the galaxy map
      scan:    { x: 12, y: H - 148, w: 84, h: 22 },   // auto-scan nearest enemy
      thrust25:  { x: tx0,                  y: ty, w: tw, h: 22 },
      thrust50:  { x: tx0 + (tw + tg),      y: ty, w: tw, h: 22 },
      thrust75:  { x: tx0 + (tw + tg) * 2,  y: ty, w: tw, h: 22 },
      thrust100: { x: tx0 + (tw + tg) * 3,  y: ty, w: tw, h: 22 },
    };
  },
  setThrustPower(v) {
    this.state.thrustPower = v;
    if (!HEADLESS && typeof localStorage !== "undefined") localStorage.setItem("sh_thrustPower", String(v));
    toast("thrust " + Math.round(v * 100) + "%");
  },
  flightTap(x, y) {
    const s = this.state, gb = this.gameButtons();
    const hit = r => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
    if (hit(gb.map)) { input.mapToggle = true; return true; }
    if (hit(gb.empire)) { input.mapToggle = true; return true; }   // empire chip = same map shortcut
    if (hit(gb.mute)) { this.toggleMute(); return true; }
    if (hit(gb.scan)) { this.scanNearestEnemy(); return true; }    // SCAN button — auto-target nearest
    if (hit(gb.thrust25))  { this.setThrustPower(0.25); return true; }
    if (hit(gb.thrust50))  { this.setThrustPower(0.50); return true; }
    if (hit(gb.thrust75))  { this.setThrustPower(0.75); return true; }
    if (hit(gb.thrust100)) { this.setThrustPower(1.00); return true; }
    if (s.atStation) { if (hit(gb.dock)) { input.dock = true; return true; } if (hit(gb.fuel)) { input.refuel = true; return true; } }
    else if (s.atOutpost && hit(gb.dock)) { input.dock = true; return true; }   // owned outpost → dock menu
    else if (s.nearPlanetName && hit(gb.dock)) { input.landEdge = true; input.closeMenu = true; return true; }  // planet → land
    if (ForgeHUD.skillTap(x, y) >= 0) return true;
    const near = this.nearestStationInfo();
    if ((s.atStation || near.dist <= 200) && ForgeHUD.hitWarpButton(x, y)) { input.warpToggle = true; return true; }
    return false;
  },
  // route a click while a dock/warp overlay is up (gear/store/warp tabs are DOM — handle themselves)
  overlayClick(x, y) {
    const s = this.state;
    if (s.onPlanet) { PLANET.tap(x, y, s); return true; }   // planet surface: tap-to-move
    if (s.galaxyMapOpen) { this.galaxyMapClick(x, y); return true; }   // Phase 6
    if (s.warpOverlay) {
      const r = ForgeWorld.handleWarpClick(x, y);
      if (r.action === "close") { this._closeWarpOverlay(); }
      else if (r.action === "jump" && r.result && r.result.ok) this._afterWarp();
      return true;
    }
    // store + warp dock tabs are DOM panels now — canvas click is a no-op
    if (s.docked && (s.dockTab === "store" || s.dockTab === "warp")) return true;
    return false;
  },
  openWarpOverlay() {
    const s = this.state; if (s.warpOverlay) return;
    s.warpOverlay = true; s.vx = s.vy = 0;
    ForgeWorld.openWarpUI((station) => { toast("⌘ warped to " + station.name); this._afterWarp(); });
  },
  _closeWarpOverlay() { const s = this.state; s.warpOverlay = false; ForgeWorld.closeWarpUI(); },

  nearestStationInfo() {
    const s = this.state; let best = null, bd = 1e18;
    for (const st of ForgeWorld.getStations()) { const d = this.dist(s.x, s.y, st.pos.x, st.pos.y); if (d < bd) { bd = d; best = st; } }
    if (!best) return { dist: 1e9, rep: null, proximity: null, station: null };
    return { dist: bd, station: best, rep: best.discovered ? best.reputation : null,
      proximity: { name: best.name, discovered: best.discovered, angle: Math.atan2(best.pos.y - s.y, best.pos.x - s.x) } };
  },

  // ---- ForgeHUD state (drawn each flight frame) ----
  buildHudState() {
    const s = this.state, h = s.hp, d = s.derived;
    const sk = ForgeEquipment.getSkillState();
    const w = this.activeWeaponItem(), near = this.nearestStationInfo();
    const mods = s._nebMods || { inNebula: false, color: null };
    // One skill-button descriptor per slot (nulls skipped by the HUD). Weapons take
    // their cooldown from the game-side weapon clock; skill modules from ForgeEquipment.
    const skills = sk.map((x, i) => {
      const it = x.item;
      if (!it) return { item: null };
      if (it.weapon) {
        const total = ForgeCombat.weaponCooldownMs(it, { fireRate: d.fireRate });
        return { item: it, active: x.active, kind: "weapon",
                 cooldownRemaining: x.active ? (s.weaponCd || 0) : 0, cooldownTotal: total };
      }
      return { item: it, active: x.active, kind: "skill",
               cooldownRemaining: x.cooldownRemaining, cooldownTotal: x.cooldownTotal };
    });
    return {
      hp: { shield: h.shield, shieldMax: h.shieldMax, armor: h.armor, armorMax: h.armorMax, hull: h.hull, hullMax: h.hullMax },
      fuel: s.fuel, fuelMax: s.fuelMax, solar: s.fuelOut,
      credits: s.credits, dist: Math.hypot(s.x - (GAME._oreCenter ? GAME._oreCenter.x : 0), s.y - (GAME._oreCenter ? GAME._oreCenter.y : 0)),
      coord: { x: Math.round(s.x), y: Math.round(s.y) },
      region: s.currentRegionId != null ? s.currentRegionId : null,
      reputation: near.rep,
      minimap: this.buildMinimap(),
      weapon: w ? { type: w.weapon.type, ammo: w.ammo } : null,
      proximity: near.station && near.dist < 1400 ? near.proximity : null,
      docked: s.atStation, stationDist: near.dist,
      skills: skills,
      toasts: toasts,
      inNebula: mods.inNebula, nebulaColor: mods.color,
      flash: { hull: s.flash / CONFIG.flashT, shield: s.shieldFlash || 0 },
      gameOver: false, t: s.t,
    };
  },

  // SEC badge near the minimap — updates once per second to avoid per-frame atan2
  drawSecBadge(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (s._secT == null || s.t - s._secT >= 1) {
      s._secT = s.t;
      s._secLevel = getDangerLevel(s.x, s.y);
    }
    const dl = s._secLevel || 1;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const x = CONFIG.W - 14 * k, y = 170 * k;
    g.font = `bold ${Math.max(10, 12 * k) | 0}px monospace`;
    g.textAlign = "right";
    g.fillStyle = dangerColor(dl);
    g.fillText("SEC " + dl, x, y);
    g.textAlign = "left";
  },

  // draw the small game-owned action buttons ForgeHUD doesn't provide (dock/refuel only)
  drawControls(g) {
    if (HEADLESS) return;
    const s = this.state, gb = this.gameButtons();
    const btn = (r, label, on, fg) => {
      g.fillStyle = on ? "#57d1c9" : "rgba(20,29,43,0.9)"; g.strokeStyle = "#333f50"; g.lineWidth = 1;
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill(); g.stroke();
      g.fillStyle = on ? "#0d1017" : (fg || "#e8edf4"); g.font = "bold 10px monospace"; g.textAlign = "center";
      g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 3.5); g.textAlign = "left";
    };
    btn(gb.map, "◈ MAP", false, "#8fd0ff");
    btn(gb.empire, "EMPIRE " + (s.empireRegions || 0) + "/10", false, "#57d1c9");
    // SCAN button — pulses orange when there are hostiles in range, dim when no targets
    const hasTargets = s.aliens && s.aliens.some(al => al.state !== "DEAD" &&
      Math.hypot(al.x - s.x, al.y - s.y) <= (s.derived ? s.derived.scanRange : 900));
    const isLocked = ForgeCombat.isLocked() || ForgeCombat.getLock().status === "locking";
    const outOfRange = (s._outOfRange || 0) > 0;
    const scanCol = outOfRange ? "#ff5050" : (isLocked ? "#57d1c9" : (hasTargets ? "#ff8a3c" : "#5a6a82"));
    const scanLabel = outOfRange ? "TOO FAR" : (isLocked ? "LOCKED" : (hasTargets ? "⊕ SCAN" : "◎ SCAN"));
    btn(gb.scan, scanLabel, isLocked && !outOfRange, scanCol);
    // Out-of-range warning blink
    if (outOfRange && ((s.t * 4) | 0) % 2 === 0) {
      g.fillStyle = "rgba(255,80,80,0.12)";
      g.beginPath(); g.roundRect(gb.scan.x, gb.scan.y, gb.scan.w, gb.scan.h, 8); g.fill();
    }
    // speaker toggle (needs a bigger glyph than btn's 10px, so drawn by hand)
    const mu = gb.mute;
    g.fillStyle = "rgba(20,29,43,0.9)"; g.strokeStyle = "#333f50"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(mu.x, mu.y, mu.w, mu.h, 6); g.fill(); g.stroke();
    g.font = `${Math.max(11, mu.h * 0.6) | 0}px monospace`; g.textAlign = "center";
    g.fillStyle = s.audioMuted ? "#7f8ea6" : "#8fd0ff";
    g.fillText(s.audioMuted ? "🔇" : "🔊", mu.x + mu.w / 2, mu.y + mu.h * 0.72);
    g.textAlign = "left";
    if (s.atStation) { btn(gb.dock, "◈ DOCK", true, "#0d1017"); btn(gb.fuel, "⛽ FUEL", false, "#7bd88f"); }
    else if (s.atOutpost) btn(gb.dock, "◈ DOCK", true, "#0d1017");
    else if (s.nearPlanetName) btn(gb.dock, "◈ LAND", true, "#0d1017");  // planet landing button
    const tp = s.thrustPower || 0.75;
    g.fillStyle = "#7f8ea6"; g.font = "bold 8px monospace"; g.textAlign = "right";
    g.fillText("THRUST", gb.thrust25.x - 4, gb.thrust25.y + 14);
    g.textAlign = "left";
    btn(gb.thrust25,  "25%",  tp === 0.25, tp === 0.25 ? "#0d1017" : "#9aa7b8");
    btn(gb.thrust50,  "50%",  tp === 0.50, tp === 0.50 ? "#0d1017" : "#9aa7b8");
    btn(gb.thrust75,  "75%",  tp === 0.75, tp === 0.75 ? "#0d1017" : "#9aa7b8");
    btn(gb.thrust100, "100%", tp === 1.00, tp === 1.00 ? "#0d1017" : "#9aa7b8");
    // Weapon range ring — drawn in world space so player can see their effective reach
    if (!s.atStation && !s.atOutpost && !s.docked) this.drawWeaponRangeRing(g);
    // Decay out-of-range indicator
    if (s._outOfRange > 0) s._outOfRange--;
  },

  drawWeaponRangeRing(g) {
    const s = this.state;
    const w = this.activeWeaponItem(); if (!w) return;
    const sk = ForgeEquipment.getSkillState();
    const eq = ForgeEquipment.getEquipped();
    const slotIdx = eq.slots.indexOf(w); if (slotIdx < 0 || !sk[slotIdx] || !sk[slotIdx].active) return;
    const range = (w.weapon.range || 800) * (1 + (s.derived.weaponRange || 0) / 100) * this.wpnRangeMult(w.weapon.type);
    const cam = s.cam, W = CONFIG.W, H = CONFIG.H;
    const cx = W / 2 + (s.x - cam.x), cy = H / 2 + (s.y - cam.y);
    const screenR = range * cam.zoom;
    const outOfRange = (s._outOfRange || 0) > 0;
    g.save();
    g.strokeStyle = outOfRange ? "rgba(255,80,80,0.35)" : "rgba(255,138,60,0.25)";
    g.lineWidth = outOfRange ? 2 : 1;
    g.setLineDash([6, 6]);
    g.beginPath(); g.arc(cx, cy, screenR, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.restore();
  },
});
