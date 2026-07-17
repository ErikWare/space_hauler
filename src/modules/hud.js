/* forge/modules/hud.js — Forge canvas HUD renderer.
 *
 * Global: ForgeHUD  (plain IIFE — paste directly into an inline <script> block).
 * Blueprint: forge/SYSTEMS_SPEC.md §3. Canvas 2D only, no DOM elements.
 *
 * All layout is authored at a 390×700 base viewport and scaled by
 * k = min(W/390, H/700); right/bottom elements anchor to W/H (spec §3.7).
 *
 * Key exports:
 *   initHUD(canvas, ctx, opts?) → bind a canvas + 2D context (any ctx-shaped object works);
 *                                 opts.onSkillActivate(slotIndex) fires on a skill-button tap
 *   drawHUD(state)           → draw one HUD frame from a plain model object
 *   resizeHUD(canvas)        → recompute W/H/k after a canvas resize; returns k
 *   chargeColor(t)           → charge-arc color ramp for the game's existing arc (§3.3)
 *   hitSkillButton(x,y)      → fit-slot index of the skill button hit | -1
 *   skillSlotRect(i)         → rect of the i-th drawn skill button (left column)
 *   skillTap(x,y)            → hit-test a skill button and fire onSkillActivate; returns fit-slot | -1
 *   drawProjectile(ctx,proj) → render an in-flight shot (laser beam / cannon slug / missile)
 *   COL (canonical palette), getState(), selfTest()
 *
 * drawHUD state model (all plain numbers/objects, no engine coupling):
 *   { hp:{shield,shieldMax,armor,armorMax,hull,hullMax},
 *     fuel, fuelMax, solar, cargo, cargoMax, credits, dist,
 *     // one skill-button descriptor per equipped ACTIVE module (nulls skipped); the
 *     // array index is the ForgeEquipment fit-slot. Stacked down the left column.
 *     skills:[{item,active,cooldownRemaining,cooldownTotal} …6],
 *     weapon:{type:"laser"|"cannon"|"missile", ammo},  // equipped-weapon indicator (top-right)
 *     minimap:{ship:{x,y}, station:{x,y}, planets:[{x,y,r,mid}], rocks:[{x,y,color}], range},
 *     toasts:[{text,age}], flash:{hull,shield}, gameOver, t }
 *
 * projectile model (drawProjectile):
 *   { type, from:{x,y}, to:{x,y},  // laser beam endpoints
 *     x, y, angle }                // cannon/missile in-flight position + heading
 */
;(function (root) {
  "use strict";

  /* Canonical palette (SYSTEMS_SPEC.md — shared across HUD, tooltips, sprite briefs). */
  var COL = {
    bg: "#0d1017", bgPanel: "rgba(13,16,23,0.92)",
    ink: "#e8edf4", dim: "#9aa7b8", faint: "#3a4658",
    line: "#333f50", slot: "#1c2430",
    shield: "#4ad2ff", armor: "#ffb040", hull: "#ff5060",
    fuel: "#7bd88f", fuelLow: "#ff6b6b", cargo: "#57d1c9",
    charge0: "#4a7bff", charge1: "#ff9a3c", charge2: "#ffffff",
    rNormal: "#e8edf4", rRare: "#5c8cff", rUnique: "#ffd24a", rElite: "#ff7a3c"
  };

  // Rarity palette for equipment borders (matches the DOM gear panel — v4.1 revamp).
  var RARITY = { normal: "#8a8f98", rare: "#57d1c9", unique: "#ffd24a", elite: "#9b70ff" };

  // Category → badge color: weapon red · shield cyan · armor yellow · hull green ·
  // skill purple · everything else grey. An item is a weapon/skill by its descriptor.
  var CAT_COL = { weapon: "#ff5060", shield: "#57d1c9", armor: "#ffd24a", hull: "#7bd88f", skill: "#9b70ff", misc: "#8a8f98" };
  function badgeKey(item) {
    if (!item) return "misc";
    if (item.weapon) return "weapon";
    if (item.skill) return "skill";
    if (item.cat === "shield") return "shield";
    if (item.cat === "armor") return "armor";
    if (item.cat === "hull") return "hull";
    return "misc";
  }
  // Badge = colored disc + first 2 chars of the category, uppercased in white.
  function catBadge(item) { var key = badgeKey(item); return { col: CAT_COL[key], txt: key.slice(0, 2).toUpperCase() }; }

  // Skill-button type tag: weapon → LAS/CAN/MSL · skill module → its repair kind.
  function skillTag(item) {
    if (item && item.weapon) { var t = item.weapon.type; return t === "laser" ? "LAS" : t === "cannon" ? "CAN" : t === "missile" ? "MSL" : "WPN"; }
    if (item && item.skill) {
      var f = item.skill.skill_fn;
      return f === "hull_repair" ? "HULL+" : f === "shield_regen" ? "SHLD+" : f === "fuel_cell" ? "FUEL+" : f === "armor_repair" ? "ARM+" : "SKL+";
    }
    return "";
  }

  // Single-letter weapon badge glyph (top-right indicator).
  var WEAPON_LETTER = { laser: "L", cannon: "C", missile: "M" };

  /* Nebula screen-border tint (rgb triplets; alpha applied at 0.15). Purple is the
   * build-request default; the actual cloud color tints it when the game supplies it. */
  var NEBULA_TINT = { cyan: "74,210,255", purple: "150,90,255", orange: "255,150,60" };

  var canvas = null, ctx = null, W = 390, H = 700, k = 1;
  var onSkillActivateCb = null;

  /* ── setup / scaling ─────────────────────────────────────────────────────── */

  function initHUD(canvas_, ctx_, opts) {
    canvas = canvas_ || null;
    ctx = ctx_ || null;
    if (opts && typeof opts.onSkillActivate === "function") onSkillActivateCb = opts.onSkillActivate;
    return resizeHUD(canvas);
  }

  function resizeHUD(canvas_) {
    if (canvas_) canvas = canvas_;
    if (canvas) { W = canvas.width || W; H = canvas.height || H; }
    k = Math.min(W / 390, H / 700);
    return k;
  }

  /* ── small draw helpers ──────────────────────────────────────────────────── */

  function font(px, bold) {
    return (bold ? "bold " : "") + Math.max(1, Math.round(px * k)) + "px monospace";
  }

  function rrect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // Slot fill → colored fill w·ratio → line stroke (spec §3.1 bar recipe).
  function bar(x, y, w, h, ratio, color) {
    ratio = ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio);
    ctx.fillStyle = COL.slot;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  function hexLerp(a, b, t) {
    function ch(hex, i) { return parseInt(hex.substr(1 + i * 2, 2), 16); }
    function hx(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }
    return "#" + hx(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t)
               + hx(ch(a, 1) + (ch(b, 1) - ch(a, 1)) * t)
               + hx(ch(a, 2) + (ch(b, 2) - ch(a, 2)) * t);
  }

  // Charge-arc color ramp (spec §3.3): charge0 → charge1 → charge2 as t goes 0→1.
  function chargeColor(t) {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t <= 0.5 ? hexLerp(COL.charge0, COL.charge1, t * 2)
                    : hexLerp(COL.charge1, COL.charge2, (t - 0.5) * 2);
  }

  /* ── layout rects (single source for draw + hit-tests) ───────────────────── */

  // Skill/weapon buttons stack down the LEFT column (v4.1: one per equipped active
  // module — the room freed by removing the tractor + engine-mode buttons). The i-th
  // drawn button lives at skillSlotRect(i); the real fit-slot index is tracked in
  // _skillLayout so a tap maps to the right ForgeEquipment slot.
  var SKILL_SIZE = 44, SKILL_GAP = 8, SKILL_X = 12, SKILL_Y0 = 150;
  var _skillLayout = [];
  function skillSlotRect(i) {
    var size = SKILL_SIZE * k;
    return { x: SKILL_X * k, y: SKILL_Y0 * k + i * (size + SKILL_GAP * k), w: size, h: size };
  }

  // Weapon-type indicator badge, upper-right (below the mini-map disc).
  function weaponBadgeRect() {
    var w = 42 * k, h = 18 * k;
    return { x: W - 12 * k - w, y: 168 * k, w: w, h: h };
  }

  // Warp-gate button, bottom-left, sitting just above the thrust-mode pill.
  function warpRect() { return { x: 12 * k, y: H - 68 * k, w: 64 * k, h: 22 * k }; }
  // Only shown when docked or within 200 units of a station (build request).
  function warpVisible(s) { return !!(s && (s.docked || (s.stationDist != null && s.stationDist <= 200))); }
  function hitWarpButton(x, y) {
    var r = warpRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // Hit-test against the buttons drawn last frame; returns the ForgeEquipment fit-slot
  // index (0..5) of the button hit, or −1.
  function hitSkillButton(x, y) {
    for (var i = 0; i < _skillLayout.length; i++) {
      var r = _skillLayout[i].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return _skillLayout[i].slot;
    }
    return -1;
  }

  // Route a tap to the skill buttons: if one is hit, fire the onSkillActivate
  // callback (set via initHUD) with the fit-slot index and return it; otherwise −1.
  function skillTap(x, y) {
    var i = hitSkillButton(x, y);
    if (i !== -1 && onSkillActivateCb) onSkillActivateCb(i);
    return i;
  }

  /* ── HUD sections ────────────────────────────────────────────────────────── */

  // A glossy rounded "pill" vital bar: colored underglow, dark track, gradient
  // fill with a top gloss band + bright leading cap, and an optional low-warning
  // pulse ring (pass warnT = s.t to arm it). The caller draws the label.
  function vitalBar(x, y, w, h, ratio, color, warnT) {
    ratio = ratio < 0 ? 0 : (ratio > 1 ? 1 : ratio);
    var r = h / 2;
    // soft colored underglow so a healthy bar reads as "lit"
    ctx.globalAlpha = 0.14;
    rrect(ctx, x - 1.5 * k, y - 1.5 * k, w + 3 * k, h + 3 * k, r + 1.5 * k);
    ctx.fillStyle = color; ctx.fill();
    ctx.globalAlpha = 1;
    // recessed dark track
    rrect(ctx, x, y, w, h, r);
    ctx.fillStyle = "#0c111b"; ctx.fill();
    ctx.strokeStyle = "rgba(233,237,244,0.08)"; ctx.lineWidth = 1; ctx.stroke();
    // gradient fill, clipped so the leading edge keeps a rounded cap
    if (ratio > 0) {
      ctx.save();
      rrect(ctx, x, y, w, h, r); ctx.clip();
      var fw = Math.max(h, w * ratio);
      var g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, hexLerp(color, "#ffffff", 0.30));
      g.addColorStop(0.55, color);
      g.addColorStop(1, hexLerp(color, "#000000", 0.30));
      ctx.fillStyle = g;
      rrect(ctx, x, y, fw, h, r); ctx.fill();
      // gloss band along the top third
      ctx.globalAlpha = 0.22; ctx.fillStyle = "#ffffff";
      rrect(ctx, x + 1.5 * k, y + 1.2 * k, Math.max(0.1, fw - 3 * k), h * 0.42, r * 0.6); ctx.fill();
      ctx.globalAlpha = 1;
      // bright leading cap
      if (ratio < 0.99) {
        ctx.fillStyle = hexLerp(color, "#ffffff", 0.55);
        ctx.fillRect(x + fw - 2 * k, y, 2 * k, h);
      }
      ctx.restore();
    }
    // low-vital warning: a pulsing colored outline (hull <30%, fuel <15%)
    if (warnT != null) {
      ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(warnT * 6));
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * k;
      rrect(ctx, x - 1 * k, y - 1 * k, w + 2 * k, h + 2 * k, r + 1 * k); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
  }

  function drawTopStrip(s) {
    var hp = s.hp || {}, t = s.t || 0;
    // soft panel: opaque at the top, fading to nothing — no hard bottom edge
    var pg = ctx.createLinearGradient(0, 0, 0, 82 * k);
    pg.addColorStop(0, "rgba(10,13,21,0.94)");
    pg.addColorStop(0.6, "rgba(10,13,21,0.72)");
    pg.addColorStop(1, "rgba(10,13,21,0)");
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, W, 84 * k);

    var x0 = 12 * k, barW = 132 * k, barH = 11 * k, rowH = 15.5 * k, y0 = 9 * k;
    var rows = [
      { cur: hp.shield || 0, max: hp.shieldMax || 1, col: COL.shield, tag: "SHD" },
      { cur: hp.armor || 0,  max: hp.armorMax || 1,  col: COL.armor,  tag: "ARM" },
      { cur: hp.hull || 0,   max: hp.hullMax || 1,   col: COL.hull,   tag: "HULL" }
    ];
    ctx.textBaseline = "middle";
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], y = y0 + i * rowH, ratio = row.cur / row.max;
      var warn = row.tag === "HULL" && ratio < 0.30;
      vitalBar(x0, y, barW, barH, ratio, row.col, warn ? t : null);
      ctx.fillStyle = warn ? COL.hull : hexLerp(row.col, "#ffffff", 0.5);
      ctx.font = font(8.5, true);
      ctx.textAlign = "left";
      ctx.fillText(row.tag + " " + Math.round(row.cur) + "/" + Math.round(row.max), x0 + barW + 9 * k, y + barH / 2);
    }

    // fuel pill (§3.1): green → red <25% → white in the solar trickle
    var fuel = s.fuel || 0, fuelMax = s.fuelMax || 1, fr = fuel / fuelMax;
    var fuelCol = s.solar ? COL.charge2 : (fr < 0.25 ? COL.fuelLow : COL.fuel);
    var fy = y0 + 3 * rowH;
    vitalBar(x0, fy, barW, barH, fr, fuelCol, (fr < 0.15 && !s.solar) ? t : null);
    ctx.fillStyle = hexLerp(fuelCol, "#ffffff", 0.5);
    ctx.font = font(8.5, true);
    ctx.textAlign = "left";
    ctx.fillText("FUEL " + Math.round(fuel) + "/" + Math.round(fuelMax), x0 + barW + 9 * k, fy + barH / 2);

    // ── nav cluster, top-right: credits chip + base / region / coord ──
    var rx = W - 12 * k;
    ctx.font = font(11, true);
    var credTxt = (s.credits != null ? Math.round(s.credits) : 0) + "cr";
    var cw = ctx.measureText(credTxt).width + 24 * k;
    rrect(ctx, rx - cw, 6 * k, cw, 20 * k, 6 * k);
    ctx.fillStyle = "rgba(20,28,42,0.72)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,210,74,0.35)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = COL.rUnique;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("◇", rx - cw + 8 * k, 16.5 * k);
    ctx.fillStyle = COL.ink;
    ctx.textAlign = "right";
    ctx.fillText(credTxt, rx - 8 * k, 16.5 * k);
    // base distance · region · coordinates
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    ctx.fillStyle = COL.dim; ctx.font = font(9.5, false);
    ctx.fillText("base " + (s.dist != null ? Math.round(s.dist) : 0) + "m", rx, 39 * k);
    if (s.region != null) { ctx.fillStyle = COL.accent || "#57d1c9"; ctx.font = font(10, true);
      ctx.fillText("R-" + s.region, rx, 53 * k); }
    if (s.coord) { ctx.fillStyle = COL.dim; ctx.font = font(8.5, false);
      ctx.fillText(s.coord.x + ", " + s.coord.y, rx, 65 * k); }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawMinimap(s) {
    var mm = s.minimap || {};
    var R = 44 * k, cx = W - 58 * k, cy = 118 * k;
    var range = mm.range || 1000;
    var kMap = R / range;
    var ship = mm.ship || { x: 0, y: 0 };

    // recessed radar dish: radial gradient for depth (lighter toward the top)
    var mg = ctx.createRadialGradient(cx, cy - R * 0.35, R * 0.15, cx, cy, R);
    mg.addColorStop(0, "rgba(18,27,42,0.94)");
    mg.addColorStop(1, "rgba(8,11,19,0.94)");
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = mg;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    (mm.planets || []).forEach(function (p) {
      ctx.beginPath();
      ctx.arc(cx + (p.x - ship.x) * kMap, cy + (p.y - ship.y) * kMap,
              Math.max(3, (p.r || 0) * kMap), 0, Math.PI * 2);
      ctx.fillStyle = p.mid || COL.dim;
      ctx.fill();
    });

    (mm.rocks || []).forEach(function (r) {
      ctx.fillStyle = r.color || COL.dim;
      ctx.fillRect(cx + (r.x - ship.x) * kMap - 1.5 * k, cy + (r.y - ship.y) * kMap - 1.5 * k, 3 * k, 3 * k);
    });
    // outposts: bright diamonds in owner color; rim-clamped when out of range so
    // the settled world is always visible on the dial (§living-world markers)
    (mm.outposts || []).forEach(function (o) {
      var dx = o.x - ship.x, dy = o.y - ship.y, d = Math.sqrt(dx * dx + dy * dy);
      var px, py;
      if (d * kMap <= R - 6 * k) { px = cx + dx * kMap; py = cy + dy * kMap; }
      else { var a = Math.atan2(dy, dx); px = cx + Math.cos(a) * (R - 6 * k); py = cy + Math.sin(a) * (R - 6 * k); }
      var r0 = (o.owned ? 4.5 : 3.5) * k;
      if (o.attacked) r0 *= 1 + 0.3 * Math.sin((s.t || 0) * 6);
      ctx.fillStyle = o.attacked ? "#ff5060" : (o.color || COL.dim);
      ctx.beginPath();
      ctx.moveTo(px, py - r0); ctx.lineTo(px + r0, py); ctx.lineTo(px, py + r0); ctx.lineTo(px - r0, py);
      ctx.closePath(); ctx.fill();
      if (o.owned) { ctx.strokeStyle = "#e8fdf9"; ctx.lineWidth = 1 * k; ctx.stroke(); }
    });
    ctx.restore();

    // Station dot; clamped to the rim with an outward chevron when off-range (§3.2).
    if (mm.station) {
      var dx = mm.station.x - ship.x, dy = mm.station.y - ship.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      ctx.fillStyle = COL.charge0;
      if (d * kMap <= R - 4 * k) {
        ctx.beginPath();
        ctx.arc(cx + dx * kMap, cy + dy * kMap, 2.5 * k, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var a = Math.atan2(dy, dx), rr = R - 5 * k;
        var sx = cx + Math.cos(a) * rr, sy = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COL.charge0;
        ctx.lineWidth = 1.5 * k;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a - 0.5) * 4 * k, sy + Math.sin(a - 0.5) * 4 * k);
        ctx.lineTo(sx + Math.cos(a) * 6 * k, sy + Math.sin(a) * 6 * k);
        ctx.lineTo(sx + Math.cos(a + 0.5) * 4 * k, sy + Math.sin(a + 0.5) * 4 * k);
        ctx.stroke();
      }
    }

    // Discovered stations as larger dots: home (id 0) blue, others green when
    // friendly / red when hostile rep; undiscovered stations are not shown (§build).
    (mm.stations || []).forEach(function (st) {
      if (!st.discovered) return;
      var sdx = st.x - ship.x, sdy = st.y - ship.y;
      var sd = Math.sqrt(sdx * sdx + sdy * sdy);
      var col = (st.home || st.id === 0) ? COL.charge0 : ((st.rep == null || st.rep >= 0) ? COL.fuel : COL.hull);
      var pxx, pyy;
      if (sd * kMap <= R - 4 * k) { pxx = cx + sdx * kMap; pyy = cy + sdy * kMap; }
      else { var sa = Math.atan2(sdy, sdx), rr2 = R - 5 * k; pxx = cx + Math.cos(sa) * rr2; pyy = cy + Math.sin(sa) * rr2; }
      ctx.beginPath();
      ctx.arc(pxx, pyy, 3.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    });

    // Ship: always dead-center.
    ctx.beginPath();
    ctx.arc(cx, cy, 2 * k, 0, Math.PI * 2);
    ctx.fillStyle = COL.ink;
    ctx.fill();

    // radar rim: soft teal glow ring + a crisp inner ring + a faint mid ring and
    // cardinal ticks for a "dish" read
    ctx.globalAlpha = 0.28;
    ctx.beginPath(); ctx.arc(cx, cy, R + 2 * k, 0, Math.PI * 2);
    ctx.strokeStyle = "#57d1c9"; ctx.lineWidth = 3 * k; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(150,196,214,0.65)"; ctx.lineWidth = 1.2 * k; ctx.stroke();
    ctx.globalAlpha = 0.16; ctx.strokeStyle = "#8fb6c8"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.58, 0, Math.PI * 2); ctx.stroke();
    for (var ti = 0; ti < 4; ti++) {
      var ta = ti * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ta) * (R - 4 * k), cy + Math.sin(ta) * (R - 4 * k));
      ctx.lineTo(cx + Math.cos(ta) * R, cy + Math.sin(ta) * R);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Category badge: a filled colored disc with the 2-char category code in white.
  function drawBadge(item, cx, cy, rad) {
    var b = catBadge(item);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = b.col;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold " + Math.max(6, Math.round(rad * 0.95)) + "px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.txt, cx, cy);
  }

  // One left-column skill button (V3 drawSkills port): dark rounded tile, rarity-colored
  // border (bright when active / dim when idle), a centered category badge, a type tag
  // top-left (LAS/CAN/MSL/HULL+/SHLD+/FUEL+), a status dot bottom-right (green when
  // firing), and a radial cooldown sweep that grows as the cooldown drains.
  function drawSkillButton(rect, entry) {
    var r = rect, item = entry.item, active = !!entry.active;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var rar = RARITY[item.tier] || COL.dim;

    rrect(ctx, r.x, r.y, r.w, r.h, 10 * k);
    ctx.fillStyle = active ? "#123028" : "#141d2b";
    ctx.fill();
    ctx.globalAlpha = active ? 1 : 0.55;
    ctx.strokeStyle = rar;
    ctx.lineWidth = active ? 2 * k : 1.5 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    // centered category badge
    ctx.globalAlpha = active ? 1 : 0.85;
    drawBadge(item, cx, cy + 1 * k, r.w * 0.26);
    ctx.globalAlpha = 1;

    // radial cooldown sweep (active + cooling only)
    var total = entry.cooldownTotal || 0, rem = entry.cooldownRemaining || 0;
    if (active && total > 0 && rem > 0) {
      var frac = rem / total; frac = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
      ctx.strokeStyle = rar;
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.arc(cx, cy + 1 * k, r.w * 0.40, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // type tag, top-left
    ctx.fillStyle = active ? "#dffdf8" : "#8fa0b6";
    ctx.font = font(8, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(skillTag(item), r.x + 4 * k, r.y + 11 * k);

    // status dot, bottom-right (green = active/firing, grey = idle)
    ctx.beginPath();
    ctx.arc(r.x + r.w - 7 * k, r.y + r.h - 7 * k, 3 * k, 0, Math.PI * 2);
    ctx.fillStyle = active ? COL.fuel : "#5a7590";
    ctx.fill();
  }

  // Draw one button per equipped ACTIVE module (skill or weapon), stacked down the
  // left column. Records each button's fit-slot index for hit-testing.
  function drawSkillButtons(s) {
    _skillLayout = [];
    var list = s.skills || [];
    var drawn = 0;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || !entry.item) continue;
      var rect = skillSlotRect(drawn);
      drawSkillButton(rect, entry);
      _skillLayout.push({ slot: i, rect: rect });
      drawn++;
    }
  }

  // Weapon-type indicator (top-right): L/C/M glyph, with ammo count for missiles.
  function drawWeaponIndicator(s) {
    var w = s.weapon;
    if (!w || !w.type) return;
    var r = weaponBadgeRect();
    rrect(ctx, r.x, r.y, r.w, r.h, 4 * k);
    ctx.fillStyle = COL.slot;
    ctx.fill();
    ctx.strokeStyle = COL.rElite;
    ctx.lineWidth = 1;
    ctx.stroke();
    var letter = WEAPON_LETTER[w.type] || "?";
    var label = letter + (w.type === "missile" && w.ammo != null ? String(w.ammo) : "");
    ctx.fillStyle = COL.ink;
    ctx.font = font(11, true);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + 6 * k, r.y + r.h / 2);
  }

  /* In-flight projectile renderer (spec §projectile): laser = thin cyan beam,
   * cannon = grey slug, missile = orange triangle. Takes an explicit ctx so the
   * game can draw projectiles into the world layer independent of the HUD. */
  function drawProjectile(c, proj) {
    c = c || ctx;
    if (!c || !proj) return;
    if (proj.type === "laser") {
      var from = proj.from || { x: proj.x, y: proj.y };
      var to = proj.to || { x: proj.tx, y: proj.ty };
      if (!from || !to || to.x == null) return;
      c.strokeStyle = COL.shield; // cyan beam
      c.lineWidth = Math.max(1, 1.5 * k);
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(to.x, to.y);
      c.stroke();
      c.lineWidth = 1;
    } else if (proj.type === "cannon") {
      c.fillStyle = "#c8d0da"; // grey slug
      c.beginPath();
      c.arc(proj.x || 0, proj.y || 0, Math.max(2, 3 * k), 0, Math.PI * 2);
      c.fill();
    } else if (proj.type === "missile") {
      // Orange triangle, rotated to its heading — computed without translate/rotate
      // so any minimal 2D context can draw it.
      var a = proj.angle != null ? proj.angle : 0;
      var ca = Math.cos(a), sa = Math.sin(a), sz = Math.max(3, 5 * k);
      var px = proj.x || 0, py = proj.y || 0;
      function pt(dx, dy) { return { x: px + dx * ca - dy * sa, y: py + dx * sa + dy * ca }; }
      var p1 = pt(sz, 0), p2 = pt(-sz * 0.7, sz * 0.6), p3 = pt(-sz * 0.7, -sz * 0.6);
      c.fillStyle = COL.charge1; // orange
      c.beginPath();
      c.moveTo(p1.x, p1.y);
      c.lineTo(p2.x, p2.y);
      c.lineTo(p3.x, p3.y);
      c.closePath();
      c.fill();
    }
  }

  // Warp-gate button (bottom-left) — visible near/at a station; opens the warp UI.
  function drawWarpButton(s) {
    if (!warpVisible(s)) return;
    var r = warpRect();
    rrect(ctx, r.x, r.y, r.w, r.h, 8 * k);
    ctx.fillStyle = COL.slot;
    ctx.fill();
    ctx.strokeStyle = COL.charge0;
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.ink;
    ctx.font = font(10, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("WARP", r.x + r.w / 2, r.y + r.h / 2);
  }

  // Subtle purple (or cloud-colored) screen-border tint while inside a nebula.
  function drawNebulaBorder(s) {
    if (!s.inNebula) return;
    var rgb = NEBULA_TINT[s.nebulaColor] || NEBULA_TINT.purple;
    ctx.strokeStyle = "rgba(" + rgb + ",0.15)";
    ctx.lineWidth = 12 * k;
    ctx.strokeRect(6 * k, 6 * k, W - 12 * k, H - 12 * k);
    ctx.lineWidth = 1;
  }

  // Proximity label for the nearest station: "UNKNOWN SIGNAL" while undiscovered,
  // its name once discovered, with a small chevron pointing toward it (angle in rad).
  function drawProximity(s) {
    var p = s.proximity;
    if (!p) return;
    var label = p.discovered ? (p.name || "STATION") : "UNKNOWN SIGNAL";
    var col = p.discovered ? COL.dim : COL.rUnique;
    var cx = W / 2, cy = 150 * k, a = p.angle || 0;
    // Direction pointer above the text.
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12 * k);
    ctx.lineTo(cx + Math.cos(a) * 9 * k, cy - 12 * k + Math.sin(a) * 9 * k);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = col;
    ctx.font = font(9, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
  }

  // Reputation pip near the cargo indicator: green good, yellow neutral, red bad.
  function drawRepPip(s) {
    if (s.reputation == null) return;
    var rep = s.reputation;
    var col = rep > 0 ? COL.fuel : (rep < 0 ? COL.fuelLow : COL.rUnique);
    var pipx = W - 12 * k - 60 * k - 6 * k, pipy = 47 * k;
    ctx.beginPath();
    ctx.arc(pipx, pipy, 3 * k, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  function drawToasts(s) {
    (s.toasts || []).forEach(function (t, i) {
      var alpha = Math.max(0, 1 - (t.age || 0) / 3);
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COL.rUnique;
      ctx.font = font(11, true);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t.text, W / 2, (96 + i * 16) * k);
      ctx.globalAlpha = 1;
    });
  }

  function drawFlash(s) {
    var f = s.flash || {};
    // Hull hit: full-screen red wash; shield-only hit: thin cyan rim (spec §3.6).
    if (f.hull > 0) {
      ctx.fillStyle = "rgba(255,80,96," + (0.35 * Math.min(1, f.hull)).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (f.shield > 0) {
      ctx.strokeStyle = "rgba(74,210,255," + (0.6 * Math.min(1, f.shield)).toFixed(3) + ")";
      ctx.lineWidth = 6 * k;
      ctx.strokeRect(3 * k, 3 * k, W - 6 * k, H - 6 * k);
      ctx.lineWidth = 1;
    }
  }

  function drawGameOver() {
    ctx.fillStyle = "rgba(5,7,13,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COL.hull;
    ctx.font = font(24, true);
    ctx.fillText("HULL BREACH", W / 2, H / 2 - 14 * k);
    ctx.fillStyle = COL.dim;
    ctx.font = font(11, false);
    ctx.fillText("press R to restart", W / 2, H / 2 + 14 * k);
  }

  function drawHUD(state) {
    if (!ctx) return; // headless / not initialized — draw is a no-op
    var s = state || {};
    drawTopStrip(s);
    drawRepPip(s);
    drawMinimap(s);
    drawWeaponIndicator(s);
    drawProximity(s);
    drawWarpButton(s);
    drawSkillButtons(s);
    drawToasts(s);
    drawNebulaBorder(s);
    drawFlash(s);
    if (s.gameOver) drawGameOver();
  }

  function getState() { return { W: W, H: H, k: k, bound: !!ctx }; }

  /* ── selfTest ────────────────────────────────────────────────────────────── */

  function makeStubCtx(ops) {
    var names = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
      "arc", "arcTo", "rect", "fill", "stroke", "fillRect", "strokeRect",
      "clearRect", "fillText", "strokeText", "clip"];
    var c = {};
    names.forEach(function (n) {
      c[n] = function () { ops.push([n, Array.prototype.slice.call(arguments)]); };
    });
    // richer 2D-context methods the HUD uses (gradients / text metrics / dashes):
    // return inert stand-ins so drawHUD renders headless without a real canvas.
    c.createLinearGradient = function () { ops.push(["createLinearGradient", []]); return { addColorStop: function () {} }; };
    c.createRadialGradient = function () { ops.push(["createRadialGradient", []]); return { addColorStop: function () {} }; };
    c.measureText = function (txt) { return { width: String(txt == null ? "" : txt).length * 6 }; };
    c.setLineDash = function () {};
    return c;
  }

  function selfTest() {
    var fails = [];
    function check(cond, msg) { if (!cond) fails.push("FAIL: " + msg); }

    var savedCanvas = canvas, savedCtx = ctx, savedW = W, savedH = H, savedK = k, savedCb = onSkillActivateCb;
    try {
      var ops = [];
      var stubCanvas = { width: 390, height: 700 };
      initHUD(stubCanvas, makeStubCtx(ops));
      check(k === 1, "k should be 1 at 390x700, got " + k);

      var state = {
        hp: { shield: 50, shieldMax: 100, armor: 60, armorMax: 80, hull: 10, hullMax: 60 },
        fuel: 30, fuelMax: 100, cargo: 5, cargoMax: 12, credits: 1234, dist: 250,
        thrustMode: "wasd",
        slots: [
          { item: { cat: "mining", tier: "rare" }, active: true },
          { item: { cat: "shield", tier: "elite" } },
          null, null
        ],
        minimap: {
          ship: { x: 0, y: 0 },
          station: { x: 5000, y: 0 },              // off-range → rim chevron path
          planets: [{ x: 100, y: 100, r: 40, mid: "#886644" }],
          rocks: [{ x: -200, y: 50, color: "#aa8855" }],
          range: 900
        },
        toasts: [{ text: "+1 Shield Booster", age: 0.5 }],
        flash: { hull: 0.5, shield: 0.3 },
        t: 1.25
      };
      drawHUD(state);

      var texts = ops.filter(function (o) { return o[0] === "fillText"; })
                     .map(function (o) { return String(o[1][0]); });
      ["SHD 50/100", "ARM 60/80", "HULL 10/60", "FUEL 30/100", "1234cr",
       "base 250m", "+1 Shield Booster"
      ].forEach(function (want) {
        check(texts.indexOf(want) !== -1, "expected HUD text '" + want + "' not drawn");
      });
      check(ops.some(function (o) { return o[0] === "arc"; }), "minimap arcs not drawn");
      check(ops.some(function (o) { return o[0] === "clip"; }), "minimap should clip its contents");

      // Game-over overlay.
      ops.length = 0;
      drawHUD({ gameOver: true });
      var goTexts = ops.filter(function (o) { return o[0] === "fillText"; })
                       .map(function (o) { return String(o[1][0]); });
      check(goTexts.indexOf("HULL BREACH") !== -1, "game-over text missing");

      // Charge color ramp endpoints + midpoints are valid hex (spec §3.3).
      check(chargeColor(0) === COL.charge0, "chargeColor(0) should be " + COL.charge0 + ", got " + chargeColor(0));
      check(chargeColor(0.5) === COL.charge1, "chargeColor(0.5) should be " + COL.charge1);
      check(chargeColor(1) === COL.charge2, "chargeColor(1) should be " + COL.charge2);
      check(/^#[0-9a-f]{6}$/.test(chargeColor(0.25)), "chargeColor(0.25) not a hex color: " + chargeColor(0.25));
      check(chargeColor(-1) === COL.charge0 && chargeColor(2) === COL.charge2, "chargeColor should clamp t");

      // Resize doubles k; layout rects scale with it.
      resizeHUD({ width: 780, height: 1400 });
      check(k === 2, "k should be 2 at 780x1400, got " + k);

      // ── skill buttons, weapon indicator, projectiles ──────────────────────────
      var activated = [];
      initHUD(stubCanvas, makeStubCtx(ops), { onSkillActivate: function (i) { activated.push(i); } });
      check(k === 1, "re-init should reset k to 1");
      ops.length = 0;
      var skState = {
        hp: { shield: 50, shieldMax: 100, armor: 60, armorMax: 80, hull: 40, hullMax: 60 },
        fuel: 80, fuelMax: 100, cargo: 2, cargoMax: 10, credits: 10, dist: 0, thrustMode: "vector",
        skills: [
          { item: { cat: "shield", tier: "rare" }, active: true, cooldownRemaining: 1500, cooldownTotal: 3000 },
          { item: { cat: "fuel", tier: "normal" }, active: false, cooldownRemaining: 0, cooldownTotal: 8000 }
        ],
        weapon: { type: "missile", ammo: 20 },
        minimap: { ship: { x: 0, y: 0 }, range: 900 },
        t: 0.5
      };
      drawHUD(skState); // cooldown arc + skill tiles + weapon badge — must not throw
      check(ops.some(function (o) { return o[0] === "arc"; }), "skill cooldown arc should render an arc");
      var skTexts = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      check(skTexts.indexOf("M20") !== -1, "weapon indicator should show missile 'M20'");
      check(skTexts.indexOf("SH") !== -1, "active skill glyph SH should draw");

      // Skill buttons stack down the left column; hit-test returns the fit-slot index.
      var sb0 = skillSlotRect(0), sb1 = skillSlotRect(1);
      check(hitSkillButton(sb0.x + sb0.w / 2, sb0.y + sb0.h / 2) === 0, "skill button 0 center should hit fit-slot 0");
      check(hitSkillButton(sb1.x + sb1.w / 2, sb1.y + sb1.h / 2) === 1, "skill button 1 center should hit fit-slot 1");
      check(hitSkillButton(5, 5) === -1, "top-left corner should miss skill buttons");

      // skillTap fires the onSkillActivate callback with the tapped fit-slot index.
      skillTap(sb1.x + sb1.w / 2, sb1.y + sb1.h / 2);
      check(activated.length === 1 && activated[0] === 1, "skillTap should fire onSkillActivate(1), got " + JSON.stringify(activated));

      // drawProjectile renders all three shot types without throwing.
      var pOps = [];
      drawProjectile(makeStubCtx(pOps), { type: "laser", from: { x: 0, y: 0 }, to: { x: 50, y: 50 } });
      drawProjectile(makeStubCtx(pOps), { type: "cannon", x: 20, y: 20 });
      drawProjectile(makeStubCtx(pOps), { type: "missile", x: 30, y: 30, angle: 1.2 });
      check(pOps.some(function (o) { return o[0] === "stroke"; }), "laser projectile should stroke a beam");
      check(pOps.filter(function (o) { return o[0] === "fill"; }).length >= 2, "cannon + missile projectiles should fill");

      // ── world / station HUD additions: warp button, nebula tint, proximity, rep, map ──
      resizeHUD(stubCanvas);                 // back to k=1
      ops.length = 0;
      var worldState = {
        hp: { shield: 50, shieldMax: 100, armor: 60, armorMax: 80, hull: 40, hullMax: 60 },
        fuel: 80, fuelMax: 100, cargo: 2, cargoMax: 12, credits: 500, dist: 90, thrustMode: "vector",
        docked: false, stationDist: 120,      // within 200 → warp button shows
        inNebula: true, nebulaColor: "purple",
        proximity: { name: "Outpost Kira", discovered: false, angle: 0.6 },
        reputation: 0,
        minimap: {
          ship: { x: 0, y: 0 }, range: 900,
          stations: [
            { x: 0, y: 0, id: 0, discovered: true, home: true, rep: 0 },
            { x: 300, y: 100, id: 1, discovered: true, rep: 5 },
            { x: -200, y: 50, id: 2, discovered: true, rep: -3 },
            { x: 9000, y: 0, id: 3, discovered: true, rep: 0 },  // off-range → clamped to rim
            { x: 400, y: 400, id: 4, discovered: false, rep: 0 } // hidden → skipped
          ]
        },
        t: 0.5
      };
      drawHUD(worldState);
      var wTexts = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      check(wTexts.indexOf("WARP") !== -1, "warp button should show within 200 units of a station");
      check(wTexts.indexOf("UNKNOWN SIGNAL") !== -1, "undiscovered proximity should read UNKNOWN SIGNAL");
      check(ops.some(function (o) { return o[0] === "strokeRect" && Math.round(o[1][2]) === 378; }), "nebula border tint strokeRect expected");
      // hitWarpButton at button center (k=1): warpRect x=12,y=632,w=64,h=22 → center (44,643).
      check(hitWarpButton(44, 643) === true, "hitWarpButton should hit the warp button center");
      check(hitWarpButton(300, 300) === false, "hitWarpButton should miss away from the button");

      // Discovered proximity shows the station name; friendly rep pip must not throw.
      ops.length = 0;
      worldState.proximity = { name: "Depot Vance", discovered: true, angle: 0 };
      worldState.reputation = 5;
      drawHUD(worldState);
      var wTexts2 = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      check(wTexts2.indexOf("Depot Vance") !== -1, "discovered proximity should show the station name");

      // Warp button hides when far from any station and not docked.
      ops.length = 0;
      worldState.docked = false; worldState.stationDist = 900;
      drawHUD(worldState);
      var wTexts3 = ops.filter(function (o) { return o[0] === "fillText"; }).map(function (o) { return String(o[1][0]); });
      check(wTexts3.indexOf("WARP") === -1, "warp button should hide when far from any station");

      // Empty state and unbound ctx must not throw.
      resizeHUD(stubCanvas);
      drawHUD({});
      ctx = null;
      drawHUD(state); // no-op, must not throw
      drawProjectile(null, { type: "laser", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }); // no ctx → no-op
    } catch (e) {
      fails.push("FAIL: selfTest threw: " + (e && e.message));
    } finally {
      canvas = savedCanvas; ctx = savedCtx; W = savedW; H = savedH; k = savedK; onSkillActivateCb = savedCb;
    }
    return fails;
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var Api = {
    initHUD: initHUD,
    drawHUD: drawHUD,
    resizeHUD: resizeHUD,
    chargeColor: chargeColor,
    hitSkillButton: hitSkillButton,
    hitWarpButton: hitWarpButton,
    skillSlotRect: skillSlotRect,
    skillTap: skillTap,
    drawProjectile: drawProjectile,
    COL: COL,
    getState: getState,
    selfTest: selfTest
  };

  root.ForgeHUD = Api;
  if (typeof module !== "undefined" && module.exports) module.exports = Api;
})(typeof globalThis !== "undefined" ? globalThis : this);
