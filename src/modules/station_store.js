/* forge/modules/station_store.js — Forge station storefront + home switching.
 *
 * Global: ForgeStore  (plain IIFE — paste directly into an inline <script> block).
 * Companion build request: station store layered on SYSTEMS_SPEC.md §4.4.
 * Canvas 2D only for the UI; all buy/sell/restock/home math runs headless.
 *
 * Each station carries a rolling stock of 8–12 rolled items, weighted by station
 * class — the central home base stocks common/rare, outer stations reach into
 * rare/unique/elite. Items are minted through ForgeItemSystem.generateItem() and
 * ForgeItemSystem.rollDrop(). Stock restocks 5 minutes (real-time) after a visit.
 *
 * Economy: buy at value×1.3, sell at value×0.7 (the station takes a cut). A warp
 * gate is offered as a special listing whose escalating price comes from ForgeWorld.
 *
 * Key exports:
 *   initStore(opts?)                 → reset; opts {seed, restockSeconds, stations, now}
 *   generateStock(station, seed?)    → array of 8–12 rolled items (seed → deterministic)
 *   restockIfExpired(station, now?)  → regenerate stock when the 5-min timer lapses
 *   openStore(station, playerState, callbacks?) / closeStore()
 *   buyItem(itemIndex, playerState)  → { success, newCredits, item }
 *   generateBarStock(station, seed?) → { copper:n, silver:n, gold:n, platinum:n }
 *   buyBar(type, qty, playerState)   → { success, newCredits, type, qty, price }
 *   barBuyPrice(type)                → refined-bar price (bars only; no raw ore)
 *   sellItem(item, playerState)      → newCredits
 *   setHomeStation(stationId, playerState) → { success, homeStationId }
 *   warpGateListing()                → { cost, owned, pending } from ForgeWorld
 *   renderStore(ctx, canvas, state?) → draw the two-panel store
 *   handleStoreClick(x,y)            → route a tap (select / buy / sell / home / warp)
 *   buyPrice(item), sellPrice(item), isOpen(), getState(), selfTest()
 *
 * playerState shape (game-owned, mutated in place):
 *   { credits:Number, inventory:[item…], inventoryMax?:Number, homeStationId?:Number,
 *     refinedBars?:{ copper:Number, silver:Number, gold:Number, platinum:Number } }
 */
;(function (root) {
  "use strict";

  var COL = {
    bg: "#0d1017", bgPanel: "rgba(13,16,23,0.92)", dimWash: "rgba(5,7,13,0.86)",
    ink: "#e8edf4", dim: "#9aa7b8", faint: "#3a4658",
    line: "#333f50", slot: "#1c2430",
    cargo: "#57d1c9", good: "#7bd88f", gold: "#ffd24a", warn: "#ff6b6b",
    rNormal: "#e8edf4", rRare: "#5c8cff", rUnique: "#ffd24a", rElite: "#ff7a3c"
  };
  var RARITY = { normal: COL.rNormal, rare: COL.rRare, unique: COL.rUnique, elite: COL.rElite };
  var GLYPHS = {
    shield: "SH", armor: "AR", hull: "HL", mining: "ML",
    propulsion: "EN", cargo: "CG", weapons: "WP", utility: "NV", fuel: "FU"
  };

  var TIER_ORDER = ["normal", "rare", "unique", "elite"];
  var RESTOCK_SECONDS = 300;                 // 5 minutes real-time per station
  var STOCK_MIN = 8, STOCK_MAX = 12;
  var MARKUP = 1.3, MARKDOWN = 0.7;          // buy ×1.3, sell ×0.7
  var HOME_REFINE_BONUS = 0.10;              // 10% better refining at your home

  /* Tier weighting by station class. Home stocks common/rare only; outer stations
   * can surface unique/elite (build request). */
  var STOCK_TIER_WEIGHTS = {
    home:  { normal: 60, rare: 40, unique: 0,  elite: 0 },
    outer: { normal: 18, rare: 42, unique: 28, elite: 12 }
  };

  /* ── refined-bar market ────────────────────────────────────────────────────
   * Stations trade in refined bars only — never raw ore. The player mines ore
   * and refines it (2 ore → 1 bar, see DRONES.orePerBar), or skips the grind
   * and buys bars here to feed drone construction.
   *
   * A bar's base value is 2× its ore's value (CONFIG.rings), so the buy price
   * is the same ×1.3 markup the item stock uses. Values are duplicated here
   * because this module runs headless without CONFIG. */
  var BAR_TYPES = ["copper", "silver", "gold", "platinum"];
  var BAR_BASE_VALUE = { copper: 60, silver: 180, gold: 480, platinum: 1200 };

  /* Quantity range [min,max] rolled per type each restock — scarcity tracks the
   * bar's tier, so platinum can come up sold out while copper is always bulk.
   * (Not keyed on stationClass: every station orbits far from the world centre,
   * so they all classify "outer".) */
  var BAR_STOCK_RANGE = {
    copper: [4, 10], silver: [3, 7], gold: [1, 4], platinum: [0, 2]
  };

  var state = {
    seed: 12345,
    restockSeconds: RESTOCK_SECONDS,
    open: false,
    station: null,
    playerState: null,
    callbacks: null,
    selected: null            // { side:"stock"|"inv", index, item }
  };

  /* ── lazy cross-module resolvers (globals when inlined, require() headless) ── */
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }
  function items() { return root.ForgeItemSystem || (typeof require !== "undefined" ? safeRequire("./item_system.js") : null); }
  function world() { return root.ForgeWorld || (typeof require !== "undefined" ? safeRequire("./world.js") : null); }

  /* ── helpers ──────────────────────────────────────────────────────────────── */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function nowMs() { return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0; }

  function seedRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedPick(weights, order, rng) {
    var total = 0, i;
    for (i = 0; i < order.length; i++) total += weights[order[i]];
    var r = rng() * total;
    for (i = 0; i < order.length; i++) { r -= weights[order[i]]; if (r < 0) return order[i]; }
    return order[order.length - 1];
  }

  function baseKeys(IS) {
    var db = IS && IS.DB;
    return db && db.bases ? Object.keys(db.bases) : [];
  }
  function junkSources(IS) {
    var db = IS && IS.DB;
    return db && db.drop_map ? Object.keys(db.drop_map) : [];
  }

  // Central station (near world centre) is "home" class; anything further is "outer".
  function stationClass(station) {
    var p = station.pos || { x: 0, y: 0 };
    return Math.sqrt(p.x * p.x + p.y * p.y) < 1800 ? "home" : "outer";
  }
  // ilvl scales with distance from centre so far stations roll richer/pricier gear.
  function stationIlvl(station) {
    var p = station.pos || { x: 0, y: 0 };
    return clamp(1 + Math.round(Math.sqrt(p.x * p.x + p.y * p.y) / 500), 1, 20);
  }

  /* ── stock generation ─────────────────────────────────────────────────────── */

  /* generateStock(station, seed?) — 8–12 rolled items. Home stock is weighted-tier
   * generateItem() only (guaranteed common/rare); outer mixes in rollDrop() salvage. */
  function generateStock(station, seed) {
    var IS = items();
    if (!IS) return [];
    var rng = (seed != null) ? seedRng(seed >>> 0) : Math.random;
    var cls = stationClass(station);
    var weights = STOCK_TIER_WEIGHTS[cls];
    var ilvl = stationIlvl(station);
    var keys = baseKeys(IS), sources = junkSources(IS);
    var n = STOCK_MIN + Math.floor(rng() * (STOCK_MAX - STOCK_MIN + 1));
    var out = [];
    for (var i = 0; i < n; i++) {
      // Outer stations pull ~1/3 of stock from junk drop tables (uses rollDrop);
      // the rest — and all of home's stock — is a weighted-tier generateItem roll.
      if (cls === "outer" && sources.length && rng() < 0.35) {
        var src = sources[Math.floor(rng() * sources.length)];
        var salvage = IS.rollDrop(src, { ilvl: ilvl, rng: rng });
        if (salvage) { out.push(salvage); continue; }
      }
      var tier = weightedPick(weights, TIER_ORDER, rng);
      var base = keys[Math.floor(rng() * keys.length)];
      out.push(IS.generateItem(base, tier, { ilvl: ilvl, rng: rng }));
    }
    return out;
  }

  /* generateBarStock(station, seed?) — { copper:n, silver:n, gold:n, platinum:n }.
   * Only refined bars; raw ore is never stocked (the player mines that). */
  function generateBarStock(station, seed) {
    var rng = (seed != null) ? seedRng((seed ^ 0x9e3779b9) >>> 0) : Math.random;
    var out = {};
    for (var i = 0; i < BAR_TYPES.length; i++) {
      var t = BAR_TYPES[i], r = BAR_STOCK_RANGE[t];
      out[t] = r[0] + Math.floor(rng() * (r[1] - r[0] + 1));
    }
    return out;
  }

  // Force a restock now (used on the timer boundary and first visit).
  function restockStation(station, seed, when) {
    station.stock = generateStock(station, seed);
    station.barStock = generateBarStock(station, seed);
    station._restockAtMs = (when != null ? when : nowMs()) + state.restockSeconds * 1000;
    return station.stock;
  }

  /* restockIfExpired(station, now?) — regenerate stock once the 5-min timer lapses
   * (or on the first visit, when no timer is set yet). Returns true if it restocked. */
  function restockIfExpired(station, now) {
    var t = (now != null) ? now : nowMs();
    if (station._restockAtMs == null || t >= station._restockAtMs) {
      var n = station._restockCount || 0;
      // A per-station, per-cycle seed keeps stock varied yet reproducible.
      var seed = ((state.seed ^ Math.imul(station.id + 1, 2654435761) ^ Math.imul(n + 1, 40503)) >>> 0);
      station._restockCount = n + 1;
      restockStation(station, seed, t);
      return true;
    }
    return false;
  }

  /* ── lifecycle ────────────────────────────────────────────────────────────── */

  function initStore(opts) {
    opts = opts || {};
    state.seed = (opts.seed != null ? opts.seed : 12345) >>> 0;
    state.restockSeconds = opts.restockSeconds != null ? opts.restockSeconds : RESTOCK_SECONDS;
    state.open = false; state.station = null; state.playerState = null;
    state.callbacks = null; state.selected = null;
    if (opts.stations) {
      var when = opts.now != null ? opts.now : nowMs();
      opts.stations.forEach(function (st) {
        var seed = ((state.seed ^ Math.imul(st.id + 1, 2654435761)) >>> 0);
        st._restockCount = 1;
        restockStation(st, seed, when);
      });
    }
    return getState();
  }

  function openStore(station, playerState, callbacks) {
    state.station = station || null;
    state.playerState = playerState || null;
    state.callbacks = callbacks || {};
    state.selected = null;
    state.open = true;
    if (station && (!station.stock || !station.stock.length)) restockIfExpired(station);
    if (station && !station.barStock) station.barStock = generateBarStock(station);
    return getState();
  }

  function closeStore() { state.open = false; state.selected = null; }
  function isOpen() { return state.open; }

  /* ── economy ──────────────────────────────────────────────────────────────── */

  function buyPrice(item) { return Math.round((item && item.value != null ? item.value : 0) * MARKUP); }
  function sellPrice(item) { return Math.round((item && item.value != null ? item.value : 0) * MARKDOWN); }

  function buyItem(itemIndex, playerState) {
    var ps = playerState || state.playerState;
    var st = state.station;
    var credits = ps ? ps.credits : 0;
    if (!st || !st.stock) return { success: false, reason: "no store open", newCredits: credits };
    var item = st.stock[itemIndex];
    if (!item) return { success: false, reason: "no such item", newCredits: credits };
    var price = buyPrice(item);
    if (!ps || ps.credits < price) return { success: false, reason: "insufficient credits", newCredits: credits, item: item, price: price };
    if (!ps.inventory) ps.inventory = [];
    if (ps.inventoryMax != null && ps.inventory.length >= ps.inventoryMax) {
      return { success: false, reason: "inventory full", newCredits: credits, item: item, price: price };
    }
    ps.credits -= price;
    ps.inventory.push(item);
    st.stock.splice(itemIndex, 1);
    if (state.selected && state.selected.side === "stock") state.selected = null;
    if (state.callbacks && state.callbacks.onBuy) state.callbacks.onBuy(item, price);
    return { success: true, newCredits: ps.credits, item: item, price: price };
  }

  function barBuyPrice(type) { return Math.round((BAR_BASE_VALUE[type] || 0) * MARKUP); }

  /* buyBar(type, qty, playerState) — bars land in playerState.refinedBars, the
   * same pool the drone hangar spends. Bars are weightless: no inventory cap. */
  function buyBar(type, qty, playerState) {
    var ps = playerState || state.playerState;
    var st = state.station;
    var credits = ps ? ps.credits : 0;
    qty = Math.max(1, (qty | 0) || 1);
    if (!BAR_BASE_VALUE[type]) return { success: false, reason: "no such bar", newCredits: credits };
    if (!st || !st.barStock) return { success: false, reason: "no store open", newCredits: credits };
    if ((st.barStock[type] || 0) < qty) return { success: false, reason: "out of stock", newCredits: credits, type: type };
    var price = barBuyPrice(type) * qty;
    if (!ps || ps.credits < price) return { success: false, reason: "insufficient credits", newCredits: credits, type: type, price: price };
    if (!ps.refinedBars) ps.refinedBars = {};
    ps.credits -= price;
    ps.refinedBars[type] = (ps.refinedBars[type] || 0) + qty;
    st.barStock[type] -= qty;
    if (state.callbacks && state.callbacks.onBuyBar) state.callbacks.onBuyBar(type, qty, price);
    return { success: true, newCredits: ps.credits, type: type, qty: qty, price: price };
  }

  function sellItem(item, playerState) {
    var ps = playerState || state.playerState;
    if (!ps) return 0;
    var gain = sellPrice(item);
    if (ps.inventory) {
      var idx = ps.inventory.indexOf(item);
      if (idx !== -1) ps.inventory.splice(idx, 1);
    }
    ps.credits = (ps.credits || 0) + gain;
    if (state.selected && state.selected.side === "inv") state.selected = null;
    if (state.callbacks && state.callbacks.onSell) state.callbacks.onSell(item, gain);
    return ps.credits;
  }

  /* ── home station switching ───────────────────────────────────────────────── */

  function setHomeStation(stationId, playerState) {
    var ps = playerState || state.playerState;
    if (!ps) return { success: false, reason: "no player" };
    var W = world();
    if (W) {
      var st = null, all = W.getStations();
      for (var i = 0; i < all.length; i++) if (all[i].id === stationId) { st = all[i]; break; }
      if (!st) return { success: false, reason: "no such station" };
      if (!st.discovered) return { success: false, reason: "station not discovered" };
    }
    ps.homeStationId = stationId;               // only one home at a time
    ps.refineBonus = HOME_REFINE_BONUS;         // refining is best at home
    if (state.callbacks && state.callbacks.onSetHome) state.callbacks.onSetHome(stationId);
    return { success: true, homeStationId: stationId };
  }

  /* ── warp-gate listing (price sourced from ForgeWorld) ────────────────────── */

  function warpGateListing() {
    var W = world();
    if (!W) return null;
    var ws = W.getWarpState ? W.getWarpState() : { owned: 0, pending: 0 };
    return { cost: W.getWarpGateCost(ws.owned), owned: ws.owned, pending: ws.pending };
  }

  /* ── layout (single source for draw + hit-tests) ─────────────────────────── */

  function layoutFor(W, H, k) {
    var pad = 10 * k;
    var colW = (W - 3 * pad) / 2;
    var gridTop = 66 * k;
    var cols = 5;
    var cell = Math.floor((colW - (cols + 1) * (3 * k)) / cols);
    var gut = 3 * k;
    var stride = cell + gut;
    var rows = 6;
    return {
      pad: pad, colW: colW, cols: cols, rows: rows, cell: cell, stride: stride, gridTop: gridTop,
      stockX: pad + gut, invX: pad * 2 + colW + gut,
      close: { x: W - 34 * k, y: 8 * k, w: 26 * k, h: 22 * k },
      card: { x: pad, y: H - 132 * k, w: colW, h: 96 * k },
      buy: { x: pad, y: H - 30 * k, w: colW / 2 - 4 * k, h: 26 * k },
      sell: { x: pad + colW / 2 + 4 * k, y: H - 30 * k, w: colW / 2 - 4 * k, h: 26 * k },
      warp: { x: pad * 2 + colW, y: H - 30 * k, w: colW / 2 - 4 * k, h: 26 * k },
      home: { x: pad * 2 + colW + colW / 2 + 4 * k, y: H - 30 * k, w: colW / 2 - 4 * k, h: 26 * k }
    };
  }

  function cellRect(L, baseX, i) {
    var col = i % L.cols, row = Math.floor(i / L.cols);
    return { x: baseX + col * L.stride, y: L.gridTop + row * L.stride, w: L.cell, h: L.cell };
  }

  function inRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  function metrics() {
    var cv = (state._canvas) || { width: 390, height: 700 };
    var W = cv.width || 390, H = cv.height || 700, k = Math.min(W / 390, H / 700);
    return { W: W, H: H, k: k };
  }

  function handleStoreClick(x, y) {
    if (!state.open) return { action: "none" };
    var m = metrics(), L = layoutFor(m.W, m.H, m.k);
    var st = state.station, ps = state.playerState;
    var stock = (st && st.stock) || [], inv = (ps && ps.inventory) || [];

    if (inRect(x, y, L.close)) { closeStore(); return { action: "close" }; }
    if (inRect(x, y, L.warp)) {
      if (state.callbacks && state.callbacks.onBuyWarpGate) state.callbacks.onBuyWarpGate(warpGateListing());
      return { action: "buy_warp", listing: warpGateListing() };
    }
    if (inRect(x, y, L.home)) return { action: "set_home", result: setHomeStation(st ? st.id : null, ps) };
    if (inRect(x, y, L.buy)) {
      if (state.selected && state.selected.side === "stock") return { action: "buy", result: buyItem(state.selected.index, ps) };
      return { action: "buy_none" };
    }
    if (inRect(x, y, L.sell)) {
      if (state.selected && state.selected.side === "inv") {
        var it = inv[state.selected.index];
        return { action: "sell", newCredits: sellItem(it, ps) };
      }
      return { action: "sell_none" };
    }
    var i;
    for (i = 0; i < stock.length; i++) if (inRect(x, y, cellRect(L, L.stockX, i))) { state.selected = { side: "stock", index: i, item: stock[i] }; return { action: "select_stock", index: i, item: stock[i] }; }
    for (i = 0; i < inv.length; i++) if (inRect(x, y, cellRect(L, L.invX, i))) { state.selected = { side: "inv", index: i, item: inv[i] }; return { action: "select_inv", index: i, item: inv[i] }; }
    return { action: "none" };
  }

  /* ── drawing ──────────────────────────────────────────────────────────────── */

  function font(px, bold, k) { return (bold ? "bold " : "") + Math.max(1, Math.round(px * k)) + "px monospace"; }

  function drawTile(g, r, item, k, selected) {
    g.fillStyle = COL.slot; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = item ? (RARITY[item.tier] || COL.line) : COL.line;
    g.lineWidth = selected ? 2.5 * k : (item ? 1.5 * k : 1);
    if (selected) g.strokeStyle = COL.gold;
    g.strokeRect(r.x, r.y, r.w, r.h); g.lineWidth = 1;
    if (item) {
      g.fillStyle = COL.ink; g.font = font(Math.max(7, r.h * 0.34), true, 1);
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(GLYPHS[item.cat] || "??", r.x + r.w / 2, r.y + r.h / 2);
    }
  }

  function drawGrid(g, L, baseX, list, side, k) {
    var n = L.cols * L.rows;
    for (var i = 0; i < n; i++) {
      var r = cellRect(L, baseX, i);
      var item = list[i] || null;
      var sel = state.selected && state.selected.side === side && state.selected.index === i;
      drawTile(g, r, item, k, sel);
    }
  }

  function drawCard(g, L, k) {
    var r = L.card, sel = state.selected;
    g.fillStyle = COL.bgPanel; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = sel && sel.item ? (RARITY[sel.item.tier] || COL.line) : COL.line;
    g.strokeRect(r.x, r.y, r.w, r.h);
    g.textAlign = "left"; g.textBaseline = "middle";
    if (!sel || !sel.item) {
      g.fillStyle = COL.dim; g.font = font(9, false, k);
      g.fillText("Select an item…", r.x + 8 * k, r.y + r.h / 2);
      return;
    }
    var item = sel.item;
    var IS = items();
    var lines = IS && IS.describeItem ? IS.describeItem(item) : [{ text: item.name || item.base, color: RARITY[item.tier] || COL.ink }];
    var priceLabel = sel.side === "stock" ? ("BUY  " + buyPrice(item) + " cr") : ("SELL  " + sellPrice(item) + " cr");
    for (var i = 0; i < lines.length; i++) {
      var ly = r.y + (11 + i * 12) * k;
      if (ly > r.y + r.h - 14 * k) break;
      g.fillStyle = lines[i].color; g.font = font(i === 0 ? 10 : 8.5, i === 0, k);
      g.fillText(lines[i].text, r.x + 8 * k, ly);
    }
    g.fillStyle = sel.side === "stock" ? COL.gold : COL.good;
    g.font = font(10, true, k);
    g.fillText(priceLabel, r.x + 8 * k, r.y + r.h - 8 * k);
  }

  function drawButton(g, r, text, k, accent) {
    g.fillStyle = COL.slot; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = accent || COL.line; g.lineWidth = accent ? 1.5 * k : 1;
    g.strokeRect(r.x, r.y, r.w, r.h); g.lineWidth = 1;
    g.fillStyle = accent || COL.ink; g.font = font(9, true, k);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
  }

  function renderStore(ctx, canvas, model) {
    if (!ctx || !state.open) return;
    state._canvas = canvas || state._canvas || { width: 390, height: 700 };
    var cv = state._canvas;
    var W = cv.width || 390, H = cv.height || 700, k = Math.min(W / 390, H / 700);
    var L = layoutFor(W, H, k);
    var st = state.station, ps = state.playerState;
    var credits = (model && model.credits != null) ? model.credits : (ps ? ps.credits : 0);

    ctx.fillStyle = COL.dimWash; ctx.fillRect(0, 0, W, H);

    // Header: station name + credits.
    ctx.fillStyle = COL.gold; ctx.font = font(12, true, k);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("── " + ((st && st.name) || "STATION") + " ──", W / 2, 18 * k);
    ctx.fillStyle = COL.ink; ctx.font = font(10, true, k);
    ctx.textAlign = "left";
    ctx.fillText(Math.round(credits) + " cr", L.pad, 40 * k);

    // Panel labels.
    ctx.fillStyle = COL.dim; ctx.font = font(9, true, k);
    ctx.textAlign = "left";
    ctx.fillText("STATION STOCK", L.pad, 56 * k);
    ctx.fillText("YOUR CARGO", L.pad * 2 + L.colW, 56 * k);

    drawGrid(ctx, L, L.stockX, (st && st.stock) || [], "stock", k);
    drawGrid(ctx, L, L.invX, (ps && ps.inventory) || [], "inv", k);
    drawCard(ctx, L, k);

    // Buttons.
    drawButton(ctx, L.buy, "BUY", k, COL.gold);
    drawButton(ctx, L.sell, "SELL", k, COL.good);
    var listing = warpGateListing();
    drawButton(ctx, L.warp, listing ? ("WARP GATE " + listing.cost) : "WARP GATE", k, COL.cargo);
    var isHome = ps && st && ps.homeStationId === st.id;
    drawButton(ctx, L.home, isHome ? "★ HOME" : "SET AS HOME", k, isHome ? COL.good : COL.dim);
    drawButton(ctx, L.close, "✕", k);
  }

  /* ── inspection ───────────────────────────────────────────────────────────── */

  function getState() {
    var st = state.station;
    return {
      open: state.open,
      stationId: st ? st.id : null,
      stockCount: (st && st.stock) ? st.stock.length : 0,
      selected: state.selected ? state.selected.side : null,
      restockSeconds: state.restockSeconds
    };
  }

  /* ── selfTest ─────────────────────────────────────────────────────────────── */

  function makeStubCtx(ops) {
    var names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
      "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect", "clearRect",
      "fillText", "strokeText", "clip"];
    var c = {};
    names.forEach(function (n) { c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); }; });
    return c;
  }

  function mkStation(id, x, y) { return { id: id, name: "S" + id, pos: { x: x, y: y }, stock: [] }; }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    var saved = {
      seed: state.seed, restockSeconds: state.restockSeconds, open: state.open,
      station: state.station, playerState: state.playerState, callbacks: state.callbacks,
      selected: state.selected, canvas: state._canvas
    };
    try {
      var IS = items();
      check(!!IS, "ForgeItemSystem must resolve for the store to roll stock");

      // 1. Stock generation for 3 station classes: count in range; deterministic per seed.
      initStore({ seed: 7 });
      var home = mkStation(0, 0, 0);
      var mid = mkStation(3, 3000, 0);
      var outer = mkStation(6, 5800, 0);
      [home, mid, outer].forEach(function (stn, idx) {
        var s1 = generateStock(stn, 100 + idx);
        check(s1.length >= STOCK_MIN && s1.length <= STOCK_MAX, "stock count " + s1.length + " out of 8–12 for station " + stn.id);
        s1.forEach(function (it) { check(it && it.id && it.base && it.value != null, "malformed stock item on station " + stn.id); });
        var s2 = generateStock(stn, 100 + idx);
        check(s1.length === s2.length && s1[0].base === s2[0].base && s1[0].value === s2[0].value, "generateStock not deterministic for seed on station " + stn.id);
      });

      // 2. Home class stocks common/rare only; outer can reach unique/elite.
      var homeStock = generateStock(home, 4242);
      check(homeStock.every(function (it) { return it.tier === "normal" || it.tier === "rare"; }),
        "home stock must be common/rare only, saw " + homeStock.map(function (i) { return i.tier; }).join(","));

      // 3. Markup / markdown math.
      var item = IS.generateItem("shield_booster", "rare", { ilvl: 5, rng: IS.seedRng(1) });
      var baseVal = item.value;
      check(buyPrice(item) === Math.round(baseVal * 1.3), "buyPrice should be value×1.3");
      check(sellPrice(item) === Math.round(baseVal * 0.7), "sellPrice should be value×0.7");

      // 4. Buy: deducts markup, moves item, removes from stock; blocked when broke.
      var buyStation = mkStation(5, 5000, 0);
      buyStation.stock = [item];
      var ps = { credits: 1000, inventory: [] };
      openStore(buyStation, ps, {});
      var poor = buyItem(0, { credits: 5, inventory: [] });
      check(poor.success === false && poor.newCredits === 5, "buy with too few credits must fail");
      var r = buyItem(0, ps);
      check(r.success === true && r.newCredits === 1000 - buyPrice(item), "buy should deduct the markup price");
      check(ps.inventory.length === 1 && ps.inventory[0] === item, "bought item should land in inventory");
      check(buyStation.stock.length === 0, "bought item should leave the stock");

      // 5. Sell: adds markdown credits, removes from inventory.
      var before = ps.credits;
      var nc = sellItem(item, ps);
      check(nc === before + sellPrice(item), "sell should add value×0.7, got " + nc);
      check(ps.inventory.length === 0, "sold item should leave inventory");

      // 6. Inventory-full guard.
      var fullPs = { credits: 100000, inventory: [{}, {}], inventoryMax: 2 };
      var fullStation = mkStation(2, 4000, 0);
      fullStation.stock = [IS.generateItem("armor_plate", "normal")];
      openStore(fullStation, fullPs, {});
      check(buyItem(0, fullPs).success === false, "buy into a full inventory must fail");

      // 6b. Bar market: bars only, scarcity by tier, buy moves credits → refinedBars.
      var barStk = generateBarStock(outer, 77);
      check(Object.keys(barStk).join(",") === BAR_TYPES.join(","), "bar stock must list only refined bar types");
      BAR_TYPES.forEach(function (t) {
        var r = BAR_STOCK_RANGE[t];
        check(barStk[t] >= r[0] && barStk[t] <= r[1], "bar stock for " + t + " out of range: " + barStk[t]);
      });
      check(generateBarStock(outer, 77).copper === barStk.copper, "generateBarStock not deterministic for seed");
      check(barBuyPrice("copper") === Math.round(60 * MARKUP), "bar price should be 2×ore value ×1.3");

      var barStation = mkStation(8, 5200, 0);
      restockStation(barStation, 31, 0);
      barStation.barStock = { copper: 3, silver: 0, gold: 0, platinum: 0 };
      var barPs = { credits: barBuyPrice("copper") * 2, inventory: [] };
      openStore(barStation, barPs, {});
      check(buyBar("silver", 1, barPs).success === false, "buying an out-of-stock bar must fail");
      var bb = buyBar("copper", 2, barPs);
      check(bb.success === true && barPs.credits === 0, "buying 2 copper bars should spend exactly 2× the price");
      check(barPs.refinedBars.copper === 2, "bought bars should land in refinedBars");
      check(barStation.barStock.copper === 1, "bought bars should leave the station stock");
      check(buyBar("copper", 1, barPs).success === false, "buying a bar while broke must fail");

      // 7. Restock timer: not before the window, yes after it lapses.
      initStore({ seed: 9, restockSeconds: 300 });
      var rs = mkStation(4, 4200, 0);
      restockStation(rs, 555, 1000);                 // _restockAtMs = 1000 + 300000
      var firstBase = rs.stock[0] && rs.stock[0].base;
      check(restockIfExpired(rs, 300999) === false, "restock must not fire before 5 minutes");
      check(restockIfExpired(rs, 301000) === true, "restock must fire once 5 minutes elapse");
      check(rs.stock.length >= STOCK_MIN, "restock should refill the stock");
      void firstBase;

      // 8. Home switching (needs ForgeWorld): only discovered stations; one at a time.
      var W = world();
      check(!!W, "ForgeWorld must resolve for home switching");
      W.initWorld(42);
      var ps2 = { credits: 0, inventory: [] };
      var hidden = W.getStations()[5];
      check(setHomeStation(5, ps2).success === false, "cannot set an undiscovered station as home");
      W.updateDiscovery({ x: hidden.pos.x, y: hidden.pos.y });
      var setH = setHomeStation(5, ps2);
      check(setH.success === true && ps2.homeStationId === 5, "home switch should update playerState.homeStationId");
      check(ps2.refineBonus === HOME_REFINE_BONUS, "home switch should grant the refine bonus");
      var setHome0 = setHomeStation(0, ps2);
      check(setHome0.success === true && ps2.homeStationId === 0, "switching home again should move it (one home at a time)");

      // 9. Warp-gate listing price sequence tracks ForgeWorld's doubling cost.
      W.initWorld(42);
      var wantSeq = [1000, 2000, 4000, 8000, 16000, 32000, 64000];
      for (var g = 0; g < wantSeq.length; g++) {
        check(warpGateListing().cost === wantSeq[g], "warp listing cost " + warpGateListing().cost + " != " + wantSeq[g] + " at owned " + g);
        W.buyWarpGate(999999);                        // own one more → next price doubles
      }

      // 10. Draw pass renders panels + buttons; close stops drawing.
      var drawStation = mkStation(1, 3500, 0);
      drawStation.stock = [IS.generateItem("turret", "rare"), IS.generateItem("fuel_cell", "normal")];
      var drawPs = { credits: 100000, inventory: [IS.generateItem("nav_computer", "unique")], homeStationId: 0 };
      openStore(drawStation, drawPs, {});
      var ops = [], stubCanvas = { width: 390, height: 700 };
      renderStore(makeStubCtx(ops), stubCanvas);
      var texts = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      ["STATION STOCK", "YOUR CARGO", "BUY", "SELL", "SET AS HOME"].forEach(function (want) {
        check(texts.indexOf(want) !== -1, "store render missing text '" + want + "'");
      });
      check(texts.some(function (t) { return /^WARP GATE/.test(t); }), "store render missing warp-gate listing");

      // 11. Click routing: select a stock item, buy via the BUY button.
      var m = metrics ? null : null; void m;
      var L = layoutFor(390, 700, 1);
      state._canvas = stubCanvas;
      var c0 = cellRect(L, L.stockX, 0);
      var selAct = handleStoreClick(c0.x + 2, c0.y + 2);
      check(selAct.action === "select_stock" && getState().selected === "stock", "clicking a stock cell should select it");
      var buyAct = handleStoreClick(L.buy.x + 2, L.buy.y + 2);
      check(buyAct.action === "buy" && buyAct.result.success === true, "BUY button should purchase the selected stock item");
      check(drawPs.inventory.length === 2, "purchase should add to inventory");

      closeStore();
      check(!isOpen(), "closeStore should close");
      ops.length = 0;
      renderStore(makeStubCtx(ops), stubCanvas);
      check(ops.length === 0, "renderStore must be a no-op when closed");
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.message));
    } finally {
      state.seed = saved.seed; state.restockSeconds = saved.restockSeconds; state.open = saved.open;
      state.station = saved.station; state.playerState = saved.playerState; state.callbacks = saved.callbacks;
      state.selected = saved.selected; state._canvas = saved.canvas;
    }
    return fails;
  }

  /* ── export ───────────────────────────────────────────────────────────────── */

  var Api = {
    initStore: initStore,
    generateStock: generateStock,
    restockStation: restockStation,
    restockIfExpired: restockIfExpired,
    openStore: openStore,
    closeStore: closeStore,
    buyItem: buyItem,
    generateBarStock: generateBarStock,
    buyBar: buyBar,
    barBuyPrice: barBuyPrice,
    BAR_TYPES: BAR_TYPES,
    sellItem: sellItem,
    setHomeStation: setHomeStation,
    warpGateListing: warpGateListing,
    renderStore: renderStore,
    handleStoreClick: handleStoreClick,
    buyPrice: buyPrice,
    sellPrice: sellPrice,
    isOpen: isOpen,
    COL: COL,
    getState: getState,
    selfTest: selfTest
  };

  root.ForgeStore = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
