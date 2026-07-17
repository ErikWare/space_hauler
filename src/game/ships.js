/*=== HARNESS:SHIPS ==========================================================*/
// SHIPS tab — the station ship market. One card per CONFIG.hulls entry with
// tier label, 3-layer stat bars, flavor line, price and a progression-gated
// BUY. Buying is an UPGRADE: the fitted modules ride along to the new hull
// (same 6 slots), health restores to the new pools, and the old hull stays in
// the hangar with an empty rack (no trade-in — you just pay for the upgrade).
// Unlocks are OR-gates on the lifetime stats the save system persists:
// cumulative outpost captures (s.capturedOutpostCount) or the highest danger
// wedge ever flown into (s.maxDangerReached).
Object.assign(GAME, {
  // ---- unlock gate: either condition satisfies (starter hulls have none) ----
  shipUnlockStatus(hullKey) {
    const s = this.state, hull = CONFIG.hulls[hullKey];
    const u = hull && hull.unlock;
    if (!u) return { unlocked: true, req: "" };
    const caps = s.capturedOutpostCount || 0, dmax = s.maxDangerReached || 1;
    return {
      unlocked: caps >= u.outposts || dmax >= u.danger,
      req: `capture ${u.outposts} outposts (${caps}/${u.outposts}) or reach danger ${u.danger}+ (best ${dmax})`,
    };
  },

  // ---- purchase + fly-out: buyShip validates and registers, then the fit
  // transfers, the switch happens, and the fresh hull leaves dock at full pools.
  buyShipUpgrade(hullKey) {
    const s = this.state, prev = this.activeShip();
    const res = this.buyShip(hullKey, { quiet: true });   // dock/unlock/credits/dupe checks + deduction
    if (!res.ok) return res;
    res.ship.slots = ForgeEquipment.getEquipped().slots;  // carry the fitted modules over (copy)
    const sw = this.switchActiveShip(res.ship.id, { quiet: true });
    if (sw.ok && prev) prev.slots = new Array(CONFIG.equipSlots).fill(null);  // moved, not copied
    this.recomputeDerived();                              // maxes include the transferred modules
    const h = s.hp;
    h.shield = h.shieldMax; h.armor = h.armorMax; h.hull = h.hullMax;
    toast("You are now flying the " + CONFIG.hulls[hullKey].name, "#57d1c9"); sfx("buy");
    return res;
  },

  // ================= DOM SHIP MARKET PANEL (#shipsPanel — build.py <body>) ======
  // Same overlay pattern as the other dock tabs: fixed full-screen DOM, shown
  // while docked on the "ships" tab, rebuilt on show/action + when credits move.
  _shipsDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._sp) return this._sp;
    const $ = id => document.getElementById(id);
    const panel = $("shipsPanel");
    if (!panel) return null;
    this._sp = { panel, cred: $("spCred"), list: $("spList"), _shown: false, _tick: 0, _lastCred: null };
    return this._sp;
  },
  syncShipsDOM() {
    const sp = this._shipsDOM(); if (!sp) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "ships");
    sp.panel.classList.toggle("show", show);
    if (!show) { sp._shown = false; return; }
    this._syncDockTabs(sp.panel);
    if (!sp._shown) { sp._shown = true; sp._tick = 0; this.renderShipsPanel(); }
    sp._tick++;
    // background income (drone arrivals etc.) can flip affordability mid-visit
    if (sp._tick % 20 === 1 && sp._lastCred !== Math.round(s.credits)) this.renderShipsPanel();
  },
  renderShipsPanel() {
    const sp = this._shipsDOM(); if (!sp) return;
    const s = this.state, mk = this._drEl.bind(this);
    sp._lastCred = Math.round(s.credits);
    sp.cred.textContent = sp._lastCred;
    sp.list.innerHTML = "";
    // stat bars scale against the biggest hull so the tiers read as growth
    const tops = { shieldMax: 0, armorMax: 0, hullMax: 0, fuelMax: 0 };
    for (const h of Object.values(CONFIG.hulls))
      for (const k of Object.keys(tops)) tops[k] = Math.max(tops[k], h.baseShip[k]);
    const tierCls = { STARTER: "t0", "MID-TIER": "t1", HEAVY: "t2" };
    for (const [key, hull] of Object.entries(CONFIG.hulls)) {
      const b = hull.baseShip;
      const active = this.activeShip() && this.activeShip().hullKey === key;
      const owned = s.ships.some(sh => sh.hullKey === key);
      const un = this.shipUnlockStatus(key);
      const afford = hull.cost && s.credits >= hull.cost.credits;
      const card = mk("spCard" + (active ? " current" : "") + (!owned && !un.unlocked ? " locked" : ""), null, sp.list);
      const top = mk("spTop", null, card);
      mk("spName", hull.name, top);
      const tier = mk("spTier " + (tierCls[hull.tier] || "t0"), hull.tier || "STARTER", top);
      tier.title = "hull tier";
      if (active) mk("spCur", "CURRENT", top);
      mk("spFlavor", hull.desc, card);
      const stats = mk("spStats", null, card);
      const row = (label, val, top_, cls) => {
        const r = mk("ghStatRow", null, stats);
        mk("ghStatLabel", label, r);
        const out = mk("ghStatBarOut", null, r);
        const fill = mk("ghStatBarFill", null, out);
        fill.style.width = Math.round(val / top_ * 100) + "%";
        fill.style.background = cls;
        const v = mk("ghStatVal", String(val), r); v.style.color = cls;
      };
      row("Shield", b.shieldMax, tops.shieldMax, "#57d1c9");
      row("Armor",  b.armorMax,  tops.armorMax,  "#ffd24a");
      row("Hull",   b.hullMax,   tops.hullMax,   "#7bd88f");
      row("Fuel",   b.fuelMax,   tops.fuelMax,   "#8fd0ff");
      if (active) mk("spFlavor", "This is your ship.", card);
      else if (owned) mk("spFlavor", "✓ owned — set it active in LOADOUT", card);
      else {
        mk("spPrice", hull.cost ? hull.cost.credits.toLocaleString("en-US") + " cr" : "—", card);
        if (!un.unlocked) mk("spLock", "⚠ LOCKED — " + un.req, card);
        const buy = mk("btn:ghBtn go spBuy", "BUY — FLY IT OUT", card);
        buy.dataset.hull = key;
        buy.disabled = !un.unlocked || !afford;
        if (un.unlocked && !afford) mk("spLock", "need " + hull.cost.credits.toLocaleString("en-US") + "cr", card);
      }
    }
  },
  wireShipsDOM() {
    const sp = this._shipsDOM(); if (!sp) return;
    sp.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("spLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    sp.list.addEventListener("click", (e) => {
      const buy = e.target.closest ? e.target.closest(".spBuy") : null;
      if (!buy || buy.disabled) return;
      this.buyShipUpgrade(buy.dataset.hull);
      this.renderShipsPanel();
    });
  },

  // ---- HUD: current hull name under the top-strip bars (flight frames) ----
  drawShipBadge(g) {
    if (HEADLESS) return;
    const sh = this.activeShip(); if (!sh) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
    g.textAlign = "left";
    g.fillStyle = "#8fd0ff";
    g.fillText("⬡ " + sh.hullKey.toUpperCase(), 8 * k, 68 * k);
  },
});
