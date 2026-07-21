/*=== HARNESS:SHIPS ==========================================================*/
// SHIPS tab — the station ship market, a loadout-style showroom carousel:
// ◀ ▶ arrows page through every CONFIG.hulls entry (hauler → krag → vex → nox
// lines), beauty art on canvas, stat bars + spec chips, credits + exotic-ore
// price and a progression-gated BUY. Buying is an UPGRADE: the fitted modules
// ride along to the new hull
// (modules that fit the new rack; overflow goes to inventory), health restores
// to the new pools, and the old hull stays in the hangar with an empty rack.
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
    // Carry modules into the new hull rack size (overflow → inventory via switch)
    const newHull = CONFIG.hulls[hullKey];
    const nSlots = this.hullEquipSlots ? this.hullEquipSlots(newHull) : CONFIG.equipSlots;
    const live = ForgeEquipment.getEquipped().slots.slice();
    res.ship.slots = this._resizeShipSlots
      ? this._resizeShipSlots(live, nSlots, this.state)
      : live;
    const sw = this.switchActiveShip(res.ship.id, { quiet: true });
    if (sw.ok && prev) {
      const oldN = this.hullEquipSlots
        ? this.hullEquipSlots(CONFIG.hulls[prev.hullKey]) : CONFIG.equipSlots;
      prev.slots = new Array(oldN).fill(null);  // modules moved, not copied
    }
    this.recomputeDerived();
    const h = s.hp;
    h.shield = h.shieldMax; h.armor = h.armorMax; h.hull = h.hullMax;
    toast("You are now flying the " + CONFIG.hulls[hullKey].name, "#57d1c9"); sfx("buy");
    return res;
  },

  // ================= DOM SHIP MARKET PANEL (#shipsPanel — build.py <body>) ======
  // Loadout-style showroom carousel: ◀ ▶ arrows page through every hull in
  // CONFIG.hulls (line order: hauler → krag → vex → nox), a widescreen canvas
  // shows the hull's side-angle beauty art (ship_<key>_beauty), stats + spec
  // chips below, then the price row —
  // credits, exotic-ore chips (green have / red short), unlock gate, BUY.
  _shipsDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._sp) return this._sp;
    const $ = id => document.getElementById(id);
    const panel = $("shipsPanel");
    if (!panel) return null;
    this._sp = { panel, cred: $("spCred"), canvas: $("spShipCanvas"),
                 pageLbl: $("spPageLbl"), lineTag: $("spLineTag"),
                 shipName: $("spShipName"), shipSub: $("spShipSub"),
                 specs: $("spSpecs"), stats: $("spStats"), buyRow: $("spBuyRow"),
                 _shown: false, _tick: 0, _lastCred: null };
    return this._sp;
  },
  syncShipsDOM() {
    const sp = this._shipsDOM(); if (!sp) return;
    const s = this.state, show = !!(s.docked && s.dockTab === "ships");
    sp.panel.classList.toggle("show", show);
    if (!show) { sp._shown = false; return; }
    this._syncDockTabs(sp.panel);
    if (!sp._shown) {
      sp._shown = true; sp._tick = 0;
      // open the showroom on the hull you're flying
      const keys = this._spHullKeys(), cur = this.activeShip();
      this._spUI = { idx: Math.max(0, keys.indexOf(cur ? cur.hullKey : "vulture")) };
      this.renderShipsPanel();
    }
    sp._tick++;
    // background income (drone arrivals etc.) can flip affordability mid-visit
    if (sp._tick % 20 === 1 && sp._lastCred !== Math.round(s.credits)) this.renderShipsPanel();
  },
  _spHullKeys() { return Object.keys(CONFIG.hulls); },
  _spPageKey() {
    const keys = this._spHullKeys();
    const ui = this._spUI || (this._spUI = { idx: 0 });
    ui.idx = ((ui.idx % keys.length) + keys.length) % keys.length;
    return keys[ui.idx];
  },
  // exotic-ore requirement status for a hull: [{type,need,have,ok}...]
  _spOreStatus(hull) {
    const s = this.state, out = [];
    for (const [type, need] of Object.entries((hull.cost && hull.cost.ore) || {}))
      out.push({ type, need, have: (s.ore[type] && s.ore[type].count) || 0 });
    out.forEach(o => o.ok = o.have >= o.need);
    return out;
  },
  // showroom canvas: hangar-glow backdrop + the hull's beauty art (locked hulls
  // render dimmed — window shopping is the point of a showroom)
  _spDrawPortrait(key, locked) {
    const sp = this._sp; if (!sp || !sp.canvas || !sp.canvas.getContext) return;
    const hull = CONFIG.hulls[key], line = (CONFIG.shipLines || {})[hull.line] || {};
    const g = sp.canvas.getContext("2d"), W = sp.canvas.width, H = sp.canvas.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, col = line.col || "#57d1c9";
    const glow = g.createRadialGradient(cx, cy, 10, cx, cy, W * 0.45);
    glow.addColorStop(0, col + "26"); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(143,208,255,0.20)"; g.lineWidth = 2; g.setLineDash([7, 9]);
    g.beginPath(); g.ellipse(cx, cy + H * 0.30, W * 0.40, H * 0.16, 0, 0, TAU); g.stroke();
    g.setLineDash([2, 11]);
    g.beginPath(); g.ellipse(cx, cy + H * 0.30, W * 0.28, H * 0.11, 0, 0, TAU); g.stroke();
    g.setLineDash([]);
    if (locked) g.globalAlpha = 0.45;
    // every line ships a side-angle showroom render (pipeline.py playerlines
    // `beauty`); the top-down flight sprite is the fallback if one is missing
    if (!ART.draw(g, "ship_" + key + "_beauty", cx, cy, W * 0.86, 0))
      if (!ART.draw(g, "ship_" + key, cx, cy, W * 0.62, 0))
        SPRITES.draw(g, "ship", cx, cy, 3.0, -Math.PI / 2);
    g.globalAlpha = 1;
    if (locked) {
      g.font = "bold 15px ui-monospace,Menlo,monospace"; g.textAlign = "center";
      g.fillStyle = "rgba(255,138,138,0.85)";
      g.fillText("⚠ LOCKED", cx, H - 14);
    }
  },
  renderShipsPanel() {
    const sp = this._shipsDOM(); if (!sp) return;
    const s = this.state, mk = this._drEl.bind(this);
    sp._lastCred = Math.round(s.credits);
    sp.cred.textContent = sp._lastCred;
    const keys = this._spHullKeys(), key = this._spPageKey(), hull = CONFIG.hulls[key];
    const line = (CONFIG.shipLines || {})[hull.line] || { name: hull.line, sub: "", col: "#57d1c9" };
    const b = hull.baseShip;
    const active = this.activeShip() && this.activeShip().hullKey === key;
    const owned = s.ships.some(sh => sh.hullKey === key);
    const un = this.shipUnlockStatus(key);
    const ores = this._spOreStatus(hull);
    const afford = !!hull.cost && s.credits >= hull.cost.credits && ores.every(o => o.ok);
    const locked = !owned && !un.unlocked;

    sp.pageLbl.textContent = (this._spUI.idx + 1) + " / " + keys.length;
    sp.lineTag.textContent = line.name + " · " + line.sub;
    sp.lineTag.style.color = line.col;
    this._spDrawPortrait(key, locked);

    // name row: name + tier chip (+ CURRENT)
    sp.shipName.innerHTML = "";
    const nm = document.createElement("span"); nm.textContent = hull.name; sp.shipName.appendChild(nm);
    const tier = mk("spTier", hull.tier || "STARTER", sp.shipName);
    tier.style.borderColor = line.col; tier.style.color = line.col;
    if (active) mk("spCur", "CURRENT SHIP", sp.shipName);
    sp.shipSub.textContent = hull.desc;

    // spec chips — the identity stats that aren't health pools
    sp.specs.innerHTML = "";
    const chip = (label, val) => { const c = mk("spSpec", "", sp.specs); c.innerHTML = label + " <b>" + val + "</b>"; };
    chip("THRUST", b.thrust); chip("TURN", b.turnSpeed);
    chip("DPS", Math.round(b.weaponDmg * (b.fireRate || 1) * 10) / 10);
    chip("MASS", b.mass || CONFIG.shipMass);
    chip("MOD SLOTS", hull.equipSlots != null ? hull.equipSlots : CONFIG.equipSlots);
    chip("DRONE WING", hull.escortSlots != null ? hull.escortSlots : 1);
    chip("TOWS", hull.baseTows); chip("SCAN", b.scanRange);

    // stat bars scale against the biggest hull so the tiers read as growth
    const tops = { shieldMax: 0, armorMax: 0, hullMax: 0, fuelMax: 0 };
    for (const h of Object.values(CONFIG.hulls))
      for (const k of Object.keys(tops)) tops[k] = Math.max(tops[k], h.baseShip[k]);
    sp.stats.innerHTML = "";
    const row = (label, val, top_, cls) => {
      const r = mk("ghStatRow", null, sp.stats);
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

    // price / ownership row
    sp.buyRow.innerHTML = "";
    if (active) mk("spOwnNote", "★ This is your ship.", sp.buyRow);
    else if (owned) mk("spOwnNote", "✓ Owned — set it active in LOADOUT.", sp.buyRow);
    else {
      mk("spPrice", hull.cost ? hull.cost.credits.toLocaleString("en-US") + " cr" : "—", sp.buyRow);
      for (const o of ores) {
        const c = mk("spOreChip " + (o.ok ? "ok" : "short"),
          o.need + "× " + (CONFIG.oreNames[o.type] || o.type) + " (" + o.have + "/" + o.need + ")", sp.buyRow);
        c.title = "exotic material — haul and hold the raw ore";
      }
      const buy = mk("btn:ghBtn go", "BUY — FLY IT OUT", sp.buyRow);
      buy.id = "spBuyBtn"; buy.dataset.hull = key;
      buy.disabled = locked || !afford;
      if (locked) mk("spLock", "⚠ LOCKED — " + un.req, sp.buyRow);
      else if (!afford && hull.cost && s.credits < hull.cost.credits)
        mk("spLock", "need " + hull.cost.credits.toLocaleString("en-US") + "cr", sp.buyRow);
    }
  },
  wireShipsDOM() {
    const sp = this._shipsDOM(); if (!sp) return;
    sp.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const launch = document.getElementById("spLaunch");
    if (launch) launch.addEventListener("click", () => { input.closeMenu = true; });
    const prev = document.getElementById("spPrev"), next = document.getElementById("spNext");
    if (prev) prev.addEventListener("click", () => { this._spUI = this._spUI || { idx: 0 }; this._spUI.idx--; sfx("grab"); this.renderShipsPanel(); });
    if (next) next.addEventListener("click", () => { this._spUI = this._spUI || { idx: 0 }; this._spUI.idx++; sfx("grab"); this.renderShipsPanel(); });
    sp.buyRow.addEventListener("click", (e) => {
      const buy = e.target.closest ? e.target.closest("#spBuyBtn") : null;
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
