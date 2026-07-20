/*=== HARNESS:RENDERING ======================================================*/
// Ship + station sprites, plus the world draw pass. Central star, planets with
// moons, fog of war overlay. Pitched projection S() for static; flat SF() for
// dynamic Forge entities.
SPRITES.define("ship", { w: 64, h: 64, brief: "mining tug, 3/4 iso, nose right",
  bake(g, w, h) {
    const cx = 32, cy = 33;
    g.fillStyle = "#28324a";
    g.beginPath(); g.ellipse(cx - 17, cy, 4, 7.5, 0, 0, TAU); g.fill();
    g.fillStyle = "#c3d0de";
    g.beginPath(); g.moveTo(cx - 13, cy - 17); g.quadraticCurveTo(cx + 3, cy - 9, cx + 6, cy - 2);
    g.lineTo(cx - 9, cy - 2); g.closePath(); g.fill();
    g.fillStyle = "#94a4b8";
    g.beginPath(); g.moveTo(cx - 13, cy + 17); g.quadraticCurveTo(cx + 3, cy + 9, cx + 6, cy + 2);
    g.lineTo(cx - 9, cy + 2); g.closePath(); g.fill();
    const grd = g.createLinearGradient(0, cy - 12, 0, cy + 12);
    grd.addColorStop(0, "#ffe08a"); grd.addColorStop(0.5, "#f0b73c"); grd.addColorStop(1, "#a8781c");
    g.fillStyle = grd; g.beginPath(); g.moveTo(cx + 23, cy - 1);
    g.quadraticCurveTo(cx + 8, cy - 11, cx - 12, cy - 8);
    g.quadraticCurveTo(cx - 18, cy, cx - 12, cy + 8);
    g.quadraticCurveTo(cx + 8, cy + 11, cx + 23, cy + 1); g.closePath(); g.fill();
    g.strokeStyle = "#7a5a14"; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = "#274068";
    g.beginPath(); g.ellipse(cx + 7, cy - 3, 5, 3.4, -0.25, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.beginPath(); g.ellipse(cx + 8, cy - 4.4, 2.4, 1.2, -0.25, 0, TAU); g.fill();
  },
});
// Companion drone (loadout-screen portrait; in-world fleet keeps the cheap
// teal triangle). Teal wedge echoing the fleet silhouette, nose right; tier
// identity is an overlay ring drawn by the panel, not baked here.
SPRITES.define("drone", { w: 48, h: 48, brief: "companion drone, teal wedge, nose right",
  bake(g, w, h) {
    const cx = 24, cy = 24;
    g.fillStyle = "#0b2e2a";                                        // engine block
    g.beginPath(); g.ellipse(cx - 12, cy, 3.4, 5.6, 0, 0, TAU); g.fill();
    g.fillStyle = "#0e6b60";                                        // lower wing
    g.beginPath(); g.moveTo(cx - 10, cy + 12); g.lineTo(cx + 3, cy + 4); g.lineTo(cx - 7, cy + 2); g.closePath(); g.fill();
    g.fillStyle = "#12857a";                                        // upper wing
    g.beginPath(); g.moveTo(cx - 10, cy - 12); g.lineTo(cx + 3, cy - 4); g.lineTo(cx - 7, cy - 2); g.closePath(); g.fill();
    const grd = g.createLinearGradient(0, cy - 8, 0, cy + 8);       // hull wedge
    grd.addColorStop(0, "#5ff2de"); grd.addColorStop(0.5, "#00e5cc"); grd.addColorStop(1, "#00907e");
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(cx + 17, cy);
    g.quadraticCurveTo(cx + 4, cy - 8, cx - 9, cy - 5);
    g.quadraticCurveTo(cx - 13, cy, cx - 9, cy + 5);
    g.quadraticCurveTo(cx + 4, cy + 8, cx + 17, cy); g.closePath(); g.fill();
    g.strokeStyle = "#065f55"; g.lineWidth = 1.1; g.stroke();
    g.fillStyle = "#0d1017";                                        // sensor eye
    g.beginPath(); g.ellipse(cx + 6, cy - 1, 3.2, 2.2, -0.2, 0, TAU); g.fill();
    g.fillStyle = "rgba(160,255,240,0.5)";
    g.beginPath(); g.ellipse(cx + 7, cy - 1.8, 1.4, 0.8, -0.2, 0, TAU); g.fill();
  },
});
// Procedural TWIN-TORUS station — two segmented rings stacked on a central
// spine (a tall spool silhouette), reactor glow between them, solar wings off
// the mid-spine, and a command dome + antenna beacon on top. Baked once; drawn
// large & tall (native 240×300 → ~330×412 on screen).
SPRITES.define("station", { w: 240, h: 300, brief: "twin-torus station: stacked rings on a central spine",
  bake(g, w, h) {
    const cx = 120, upperY = 120, lowerY = 198, rx = 82, ry = 32, P = ry / rx;
    const midY = (upperY + lowerY) / 2, domeY = upperY - 24;
    g.lineJoin = "round"; g.lineCap = "round";
    // ambient halo around the whole structure
    let halo = g.createRadialGradient(cx, midY, rx * 0.2, cx, midY, rx * 1.7);
    halo.addColorStop(0, "rgba(96,134,196,0.12)"); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.beginPath(); g.ellipse(cx, midY, rx * 1.6, (lowerY - upperY) / 2 + ry * 2.4, 0, 0, TAU); g.fill();

    // one segmented torus ring centred at yy
    const ring = (yy) => {
      g.strokeStyle = "#2b3450"; g.lineWidth = 20;                    // dark tube base
      g.beginPath(); g.ellipse(cx, yy, rx, ry, 0, 0, TAU); g.stroke();
      g.strokeStyle = "#455574"; g.lineWidth = 16;                    // mid tube
      g.beginPath(); g.ellipse(cx, yy, rx, ry, 0, 0, TAU); g.stroke();
      g.strokeStyle = "#8299c0"; g.lineWidth = 11;                    // front-lit highlight arc
      g.beginPath(); g.ellipse(cx, yy, rx, ry, 0, 0.12, Math.PI - 0.12); g.stroke();
      g.strokeStyle = "#1a2136"; g.lineWidth = 2;                     // panel ticks
      for (let i = 0; i < 26; i++) { const a = i / 26 * TAU;
        const ox = cx + Math.cos(a) * (rx + 8), oy = yy + Math.sin(a) * (ry + 8 * P);
        const ix = cx + Math.cos(a) * (rx - 8), iy = yy + Math.sin(a) * (ry - 8 * P);
        g.beginPath(); g.moveTo(ix, iy); g.lineTo(ox, oy); g.stroke(); }
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU + 0.1;   // docking lights
        g.fillStyle = i % 4 === 0 ? "#ffd27a" : "#7fd0ff";
        g.beginPath(); g.arc(cx + Math.cos(a) * rx, yy + Math.sin(a) * ry, 1.9, 0, TAU); g.fill(); }
    };
    // spokes from an axle point (cx, hy) out to a ring at yy
    const spokes = (yy, hy) => {
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3;
        const ex = cx + Math.cos(a) * rx * 0.9, ey = yy + Math.sin(a) * ry * 0.9;
        g.strokeStyle = "#3d4c6c"; g.lineWidth = 5; g.beginPath(); g.moveTo(cx, hy); g.lineTo(ex, ey); g.stroke();
        g.strokeStyle = "#6d82a8"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, hy); g.lineTo(ex, ey); g.stroke(); }
    };
    // solar wing off the mid-spine
    const wing = (sgn) => {
      const bx = cx + sgn * (rx + 6), by = midY;
      g.strokeStyle = "#48597c"; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx, midY); g.lineTo(bx, by); g.stroke();
      const pw = 26, ph = 40, x0 = sgn > 0 ? bx : bx - pw, y0 = by - ph / 2;
      g.fillStyle = "#16294a"; g.fillRect(x0, y0, pw, ph);
      g.strokeStyle = "#3f6db0"; g.lineWidth = 1.3; g.strokeRect(x0, y0, pw, ph);
      g.strokeStyle = "rgba(120,180,255,0.4)"; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x0 + pw * i / 4, y0); g.lineTo(x0 + pw * i / 4, y0 + ph); g.stroke(); }
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x0, y0 + ph * i / 6); g.lineTo(x0 + pw, y0 + ph * i / 6); g.stroke(); }
    };

    // ── draw back-to-front ──
    wing(-1); wing(1);                                                // wings behind everything
    ring(lowerY); spokes(lowerY, midY);                              // lower/back ring
    // reactor glow between the rings
    const rg = g.createRadialGradient(cx, midY, 2, cx, midY, 30);
    rg.addColorStop(0, "rgba(127,208,255,0.55)"); rg.addColorStop(1, "rgba(127,208,255,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(cx, midY, 30, 0, TAU); g.fill();
    // central spine cylinder connecting the two rings
    const sw = 14;
    const sp = g.createLinearGradient(cx - sw, 0, cx + sw, 0);
    sp.addColorStop(0, "#28324a"); sp.addColorStop(0.5, "#54648a"); sp.addColorStop(1, "#28324a");
    g.fillStyle = sp; g.fillRect(cx - sw, upperY - 6, sw * 2, lowerY - upperY + 12);
    g.strokeStyle = "#1a2136"; g.lineWidth = 1;                       // spine panel bands
    for (let i = 1; i < 5; i++) { const yy = upperY + (lowerY - upperY) * i / 5;
      g.beginPath(); g.moveTo(cx - sw, yy); g.lineTo(cx + sw, yy); g.stroke(); }
    spokes(upperY, domeY + 10);
    ring(upperY);                                                    // upper/front ring
    // ── command dome + antenna on top ──
    g.fillStyle = "#33405e"; g.beginPath(); g.ellipse(cx, domeY + 8, 26, 12, 0, 0, TAU); g.fill();   // platform
    g.strokeStyle = "#5570a0"; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = "#3c4a6a"; g.beginPath(); g.ellipse(cx, domeY + 2, 19, 9, 0, 0, TAU); g.fill();     // mid tier
    g.fillStyle = "#4a5c82"; g.beginPath(); g.arc(cx, domeY - 2, 11, Math.PI, TAU); g.fill();          // dome cap
    g.strokeStyle = "#6d82a8"; g.stroke();
    const glow = g.createRadialGradient(cx, domeY - 3, 1, cx, domeY - 3, 18);
    glow.addColorStop(0, "rgba(191,233,255,0.95)"); glow.addColorStop(1, "rgba(127,208,255,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(cx, domeY - 3, 18, 0, TAU); g.fill();
    g.fillStyle = "#bfe9ff"; g.beginPath(); g.arc(cx, domeY - 3, 3.2, 0, TAU); g.fill();
    g.strokeStyle = "#8fa6cc"; g.lineWidth = 1.6;                     // antenna spire
    g.beginPath(); g.moveTo(cx, domeY - 12); g.lineTo(cx, domeY - 34); g.stroke();
    g.fillStyle = "#ff6b6b"; g.beginPath(); g.arc(cx, domeY - 35, 2.4, 0, TAU); g.fill();
  },
});

Object.assign(GAME, {
  nebulaHex(color) { return { cyan: "#4fd6c8", purple: "#b06cff", orange: "#ff9a3c" }[color] || "#8a6cff"; },

  // Shared procedural drone hull — a little arrowhead craft with side nacelles,
  // an engine bloom, a spine highlight, and a glowing cockpit. Used by the fleet
  // escorts and outpost-stationed/guard drones so every drone reads as a ship,
  // not a bare triangle. Drawn in SCREEN space at (x,y), heading `ang`, scale `sz`
  // (≈ hull half-length). opts.thrust:false kills the bloom (for tiny orbiters).
  drawDroneShape(g, x, y, ang, sz, col, opts) {
    opts = opts || {};
    const dark = "#0b0f16", lw = Math.max(0.7, sz * 0.11);
    g.save(); g.translate(x, y); g.rotate(ang);
    if (opts.thrust !== false) {                       // engine bloom aft
      const gr = g.createRadialGradient(-sz * 0.85, 0, 0, -sz * 0.85, 0, sz * 0.85);
      gr.addColorStop(0, hexA(col, 0.75)); gr.addColorStop(1, hexA(col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(-sz * 0.85, 0, sz * 0.85, 0, TAU); g.fill();
    }
    g.lineJoin = "round"; g.strokeStyle = dark; g.lineWidth = lw;
    g.fillStyle = shade(col, -0.4);                    // side nacelles
    for (const sgn of [-1, 1]) {
      g.beginPath(); g.ellipse(-sz * 0.1, sgn * sz * 0.6, sz * 0.36, sz * 0.2, 0, 0, TAU);
      g.fill(); g.stroke();
    }
    g.fillStyle = col;                                 // main hull (hex arrowhead)
    g.beginPath();
    g.moveTo(sz * 1.05, 0);
    g.lineTo(sz * 0.2, sz * 0.52);
    g.lineTo(-sz * 0.72, sz * 0.34);
    g.lineTo(-sz * 0.52, 0);
    g.lineTo(-sz * 0.72, -sz * 0.34);
    g.lineTo(sz * 0.2, -sz * 0.52);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = hexA("#ffffff", 0.4); g.lineWidth = Math.max(0.5, sz * 0.09);   // spine
    g.beginPath(); g.moveTo(sz * 0.85, 0); g.lineTo(-sz * 0.45, 0); g.stroke();
    g.fillStyle = opts.eye || "#dff6ff";               // cockpit
    g.beginPath(); g.arc(sz * 0.32, 0, sz * 0.19, 0, TAU); g.fill();
    g.restore();
  },

  // faction key for a station id (→ station_vex/krag/nox PNG). Each solar planet
  // carries the faction of the station that orbits it; deep-space stations
  // carry their own faction tag (CONFIG.deepSpaceStations).
  stationFaction(id) {
    const pdef = CONFIG.solarPlanets.find(p => p.stationIdx === id) ||
                 CONFIG.deepSpaceStations.find(d => d.stationIdx === id);
    return (pdef && pdef.faction) || "vex";
  },

  // HP bar + shield ring + leader name drawn over an ART alien PNG — the bits
  // ForgeFaction.drawAlienShip draws around its hull triangle, replicated here
  // because we swapped that triangle for a faction sprite (screen-space, SF).
  drawAlienStatus(g, al, p, z, isLocked) {
    // anchor radius tracks the drawn sprite (r × class width mult / 2 — keep in
    // sync with drawEnemyShip's sprW) so ring/bar/name clear the bigger hulls
    const sprW = { fighter: 3.4, raider: 3.6, gunship: 3.9, carrier: 4.6 }[al.shipClass] || 3.4;
    const hp = al.hp || {}, s = (al.r || 13) * sprW * 0.5 * z, clamp01 = v => Math.max(0, Math.min(1, v));
    if (hp.shieldMax > 0) {
      g.globalAlpha = 0.6 * clamp01((hp.shield || 0) / hp.shieldMax);
      g.strokeStyle = "#4ad2ff"; g.lineWidth = 1;
      g.beginPath(); g.arc(p.x, p.y, s + 4 * z, 0, TAU); g.stroke();
      g.globalAlpha = 1;
    }
    // the always-on mini hull bar is replaced by the rich segmented bar when locked
    if (!isLocked) {
      const barW = 26 * z, by = p.y - s - 8 * z;
      g.fillStyle = "#1c2430"; g.fillRect(p.x - barW / 2, by, barW, 3 * z);
      g.fillStyle = "#ff5060"; g.fillRect(p.x - barW / 2, by, barW * clamp01((hp.hull || 0) / (hp.hullMax || 1)), 3 * z);
    }
    if (al.isLeader) {
      g.fillStyle = al.color || "#e8edf4";
      g.font = "bold " + Math.max(1, Math.round(8 * z)) + "px monospace";
      g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillText(al.name || al.faction, p.x, p.y - s - (isLocked ? 20 : 11) * z);
      g.textAlign = "left"; g.textBaseline = "alphabetic";
    }
  },

  // Procedural enemy ship — silhouette + hull size vary by CLASS (fighter/raider/
  // gunship/carrier, from tier+leader in faction.js), tinted the faction colour.
  // Replaces the single per-faction PNG so a squad reads as capital + escorts.
  drawEnemyShip(g, al, p, z) {
    const col = al.color || "#e8edf4", cls = al.shipClass || "fighter";
    const R = (al.r || 12) * z, s = this.state, dark = "#0c1420";
    // Clay fleet sprite first (sprites/space/, per faction × class). Width tracks
    // the class hull radius (HULLR_BY_CLASS in faction.js) so a squad reads as a
    // capital ship + escorts; carriers get an extra bump for flagship drama.
    // Sprites are top-down, nose right at angle 0 — same convention as the
    // procedural hulls. Falls back to the tinted procedural shape (headless /
    // missing art).
    // Bumped ~35% (2026-07-17 look/feel pass): fighters were 31px specks next
    // to the 80px player hull. Fighter 41 / raider 58 / gunship 82 / carrier
    // 129px @ z=1 — a carrier now clearly outclasses the player's Vulture.
    const sprW = { fighter: 3.4, raider: 3.6, gunship: 3.9, carrier: 4.6 }[cls] || 3.4;
    if (ART.draw(g, "ship_" + (al.faction || "vex") + "_" + cls, p.x, p.y, R * sprW, al.angle || 0))
      return;
    const pulse = 0.55 + 0.45 * Math.sin((s.t || 0) * 8 + (al._jitter || 0) * 9);
    g.save(); g.translate(p.x, p.y); g.rotate(al.angle || 0);
    const eng = (x, y, rr) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, hexA(col, 0.85 * pulse)); gr.addColorStop(1, hexA(col, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    };
    g.lineJoin = "round"; g.strokeStyle = "#0a0f18"; g.lineWidth = Math.max(1, 1.2 * z);
    const cockpit = (x, r) => { g.fillStyle = "#dff6ff"; g.beginPath(); g.arc(x, 0, r, 0, TAU); g.fill(); };
    if (cls === "fighter") {
      eng(-R * 0.9, 0, R * 0.7);
      g.fillStyle = col; g.beginPath();
      g.moveTo(R * 1.15, 0); g.lineTo(-R * 0.6, R * 0.75); g.lineTo(-R * 0.25, 0); g.lineTo(-R * 0.6, -R * 0.75);
      g.closePath(); g.fill(); g.stroke();
      cockpit(R * 0.4, R * 0.17);
    } else if (cls === "raider") {
      eng(-R * 0.9, R * 0.35, R * 0.55); eng(-R * 0.9, -R * 0.35, R * 0.55);
      g.fillStyle = col; g.beginPath();
      g.moveTo(R * 1.25, 0); g.lineTo(-R * 0.15, R * 0.95); g.lineTo(-R * 0.85, R * 0.5); g.lineTo(-R * 0.5, 0);
      g.lineTo(-R * 0.85, -R * 0.5); g.lineTo(-R * 0.15, -R * 0.95);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = dark; g.beginPath(); g.moveTo(R * 0.75, 0); g.lineTo(-R * 0.25, R * 0.22); g.lineTo(-R * 0.25, -R * 0.22); g.closePath(); g.fill();
      cockpit(R * 0.5, R * 0.15);
    } else if (cls === "gunship") {
      eng(-R * 1.0, R * 0.4, R * 0.5); eng(-R * 1.0, -R * 0.4, R * 0.5);
      g.fillStyle = dark;   // side gun pods
      g.fillRect(-R * 0.15, R * 0.55, R * 0.95, R * 0.3); g.strokeRect(-R * 0.15, R * 0.55, R * 0.95, R * 0.3);
      g.fillRect(-R * 0.15, -R * 0.85, R * 0.95, R * 0.3); g.strokeRect(-R * 0.15, -R * 0.85, R * 0.95, R * 0.3);
      g.fillStyle = col; g.beginPath();   // hex hull
      g.moveTo(R * 1.2, 0); g.lineTo(R * 0.5, R * 0.62); g.lineTo(-R * 0.8, R * 0.55); g.lineTo(-R * 1.0, 0);
      g.lineTo(-R * 0.8, -R * 0.55); g.lineTo(R * 0.5, -R * 0.62);
      g.closePath(); g.fill(); g.stroke();
      cockpit(R * 0.4, R * 0.2);
    } else {   // carrier / flagship
      eng(-R * 1.15, R * 0.45, R * 0.6); eng(-R * 1.15, 0, R * 0.72); eng(-R * 1.15, -R * 0.45, R * 0.6);
      g.fillStyle = col; g.beginPath();   // long deck hull
      g.moveTo(R * 1.35, 0); g.lineTo(R * 0.95, R * 0.48); g.lineTo(-R * 1.0, R * 0.62); g.lineTo(-R * 1.2, R * 0.32);
      g.lineTo(-R * 1.2, -R * 0.32); g.lineTo(-R * 1.0, -R * 0.62); g.lineTo(R * 0.95, -R * 0.48);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = dark; g.fillRect(-R * 0.95, -R * 0.3, R * 1.75, R * 0.6);   // flight deck
      g.fillStyle = hexA(col, 0.35 + 0.4 * pulse); g.fillRect(-R * 1.2, -R * 0.24, R * 0.24, R * 0.48);   // hangar mouth
      g.fillStyle = col; g.beginPath();   // bridge tower
      g.moveTo(R * 0.15, R * 0.12); g.lineTo(R * 0.6, 0); g.lineTo(R * 0.15, -R * 0.12); g.closePath(); g.fill(); g.stroke();
      cockpit(R * 0.35, R * 0.1);
      g.fillStyle = "#ffd24a";   // deck running lights
      for (let i = -2; i <= 2; i++) { const lx = -R * 0.15 + i * R * 0.3, lr = Math.max(0.6, 1.1 * z);
        g.beginPath(); g.arc(lx, R * 0.5, lr, 0, TAU); g.fill();
        g.beginPath(); g.arc(lx, -R * 0.5, lr, 0, TAU); g.fill(); }
    }
    g.restore();
  },

  // Locked-target health bar: a segmented shield→armor→hull strip floating above
  // whatever the player has locked (enemy ship, enemy base, or hostile outpost).
  // Blue drains first, then yellow, then red — a clear "keep fighting or bail?" read.
  drawLockedHealthBar(g) {
    if (HEADLESS) return;
    const s = this.state, lock = ForgeCombat.getLock();
    if (!lock || lock.targetId == null || lock.status === "none") return;
    const t = this.findCombatTarget(lock.targetId);
    if (!t || t.kind === "rock") return;
    const hp = t.hp || {};
    const shield = hp.shield != null ? hp.shield : (t.shield || 0);
    const shieldMax = hp.shieldMax != null ? hp.shieldMax : (t.shieldMax || 0);
    const armor = hp.armor != null ? hp.armor : (t.armor || 0);
    const armorMax = hp.armorMax != null ? hp.armorMax : (t.armorMax || 0);
    const hull = hp.hull != null ? hp.hull : (t.hull || 0);
    const hullMax = hp.hullMax != null ? hp.hullMax : (t.hullMax || 0);
    const totalMax = shieldMax + armorMax + hullMax;
    if (totalMax <= 0) return;
    const z = s.cam.zoom, p = this.SF(t.x, t.y);
    const tr = t.r || (t.kind === "outpost" ? 34 : 14);
    const barW = Math.max(56, (tr * 2 + 30) * z), barH = 6 * z;
    const bx = p.x - barW / 2, by = p.y - (tr + 20) * z;
    g.fillStyle = "rgba(6,10,18,0.85)"; g.fillRect(bx - 1.5, by - 1.5, barW + 3, barH + 3);   // backing
    let x = bx;
    const seg = (cur, max, col) => {
      if (max <= 0) return;
      const w = barW * (max / totalMax);
      g.fillStyle = "#1c2430"; g.fillRect(x, by, w, barH);
      g.fillStyle = col; g.fillRect(x, by, w * clamp(cur / max, 0, 1), barH);
      x += w;
      g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + barH); g.stroke();
    };
    seg(shield, shieldMax, "#4ad2ff");
    seg(armor, armorMax, "#ffb040");
    seg(hull, hullMax, "#ff5060");
    g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 1; g.strokeRect(bx, by, barW, barH);
    const label = (t.name || (t.kind === "outpost" ? "OUTPOST" : t.kind === "enemyBase" ? "ENEMY BASE" : t.faction) || "TARGET").toUpperCase();
    g.fillStyle = "#e8edf4"; g.font = "bold " + Math.max(7, Math.round(8 * z)) + "px monospace";
    g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText(label, p.x, by - 3 * z);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
  },

  drawSelectRing(g, pt, rad, color, z) {
    const r = Math.max(6, rad), c = r * 0.5;
    g.strokeStyle = color; g.lineWidth = Math.max(1, 1.6 * z);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = pt.x + sx * r, y = pt.y + sy * r;
      g.beginPath(); g.moveTo(x - sx * c, y); g.lineTo(x, y); g.lineTo(x, y - sy * c); g.stroke();
    }
  },

  drawPlanetRing(g, p, sp, z, front) {
    const P = CONFIG.pitch, def = CONFIG.planetDefs[p.type];
    if (!def) return;
    if (!front) {
      g.strokeStyle = def.ring; g.globalAlpha = 0.10;
      g.lineWidth = Math.max(1, p.r * (CONFIG.pRingOut - CONFIG.pRingIn) * 0.5 * z);
      g.beginPath(); g.ellipse(sp.x, sp.y, p.r * 1.8 * z, p.r * 1.8 * z * P, 0, 0, TAU); g.stroke();
    }
    g.fillStyle = def.ring; g.globalAlpha = 0.7;
    for (const d of p.dots) {
      const wy = Math.sin(d.a) * d.u * p.r;
      if (front ? wy <= 0 : wy > 0) continue;
      const x = sp.x + Math.cos(d.a) * d.u * p.r * z, y = sp.y + wy * z * P;
      const sz = Math.max(0.8, d.s * z);
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  },

  drawStar(g, z) {
    const sp = this.S(0, 0), P = CONFIG.pitch;
    const sr = CONFIG.STAR_RADIUS * z;
    if (sp.x < -sr * 1.3 || sp.x > CONFIG.W + sr * 1.3 || sp.y < -sr * 1.3 || sp.y > CONFIG.H + sr * 1.3) return;
    const grd = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr * 1.3);
    grd.addColorStop(0, "rgba(255,240,200,0.9)");
    grd.addColorStop(0.3, "rgba(255,200,80,0.6)");
    grd.addColorStop(0.7, "rgba(255,140,40,0.15)");
    grd.addColorStop(1, "rgba(255,100,20,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(sp.x, sp.y, sr * 1.3, 0, TAU); g.fill();
    const core = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sr);
    core.addColorStop(0, "#fffbe8");
    core.addColorStop(0.6, "#ffd060");
    core.addColorStop(1, "#cc8020");
    g.fillStyle = core; g.beginPath(); g.arc(sp.x, sp.y, sr, 0, TAU); g.fill();
  },

  drawMoon(g, moon, z) {
    const sp = this.S(moon.x, moon.y);
    const mr = Math.max(2, moon.r * z);
    if (sp.x < -mr || sp.x > CONFIG.W + mr || sp.y < -mr || sp.y > CONFIG.H + mr) return;
    // Clay moon variants, hashed off the moon's stable orbit anchor so each
    // moon keeps its face; baked-sprite fallback.
    const mh = (Math.abs((moon.ox || moon.x) * 13 + (moon.oy || moon.y) * 7) | 0) % 3;
    if (!ART.draw(g, "moon_" + "abc"[mh], sp.x, sp.y, moon.r * 2.05 * z, 0))
      SPRITES.draw(g, "moon", sp.x, sp.y, moon.r / 50 * z, 0);
  },

  buildMinimap() {
    const s = this.state, stations = ForgeWorld.getStations();
    const rg = s.derived.scanRange * 1.15, rg2 = rg * rg;   // only rocks on the disc — 1000+ rocks would swamp the HUD pass
    return {
      range: s.derived.scanRange,
      ship: { x: s.x, y: s.y },
      planets: s.planets.filter(p => this.isTileExplored(p.x, p.y))
        .map(p => ({ x: p.x, y: p.y, r: p.r, mid: CONFIG.planetDefs[p.type].mid })),
      rocks: s.rocks.filter(r => { if (!r.active) return false; const dx = r.x - s.x, dy = r.y - s.y; return dx * dx + dy * dy <= rg2; })
        .map(r => ({ x: r.x, y: r.y, color: r.col })),
      fields: s.fields.filter(f => f.discovered && !f.active)
        .map(f => ({ x: f.x, y: f.y, r: f.r, color: f.col })),
      outposts: (s.outposts || []).filter(o => o.discovered)
        .map(o => ({ x: o.x, y: o.y, color: this.outpostFactionCol(o),
          owned: o.owner === "player", attacked: !!o.underAttack })),
      stations: stations.filter(st => st.discovered)
        .map(st => ({ x: st.pos.x, y: st.pos.y, id: st.id,
          discovered: st.discovered, home: st.id === s.homeStationId, rep: st.reputation })),
    };
  },

  drawFogOverlay(g, z) {
    if (HEADLESS) return;
    const s = this.state, t = CONFIG.FOG_TILE, P = CONFIG.pitch;
    const halfW = CONFIG.W / 2 / z, halfH = CONFIG.H / 2 / z / P;
    const minTx = Math.floor((s.cam.x - halfW) / t) - 1;
    const maxTx = Math.ceil((s.cam.x + halfW) / t) + 1;
    const minTy = Math.floor((s.cam.y - halfH) / t) - 1;
    const maxTy = Math.ceil((s.cam.y + halfH) / t) + 1;
    g.fillStyle = "rgba(5,7,13,0.55)";
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (s.exploredTiles.has(tx + "," + ty)) continue;
        const wp = this.S(tx * t, ty * t);
        const wp2 = this.S((tx + 1) * t, (ty + 1) * t);
        g.fillRect(wp.x, wp.y, wp2.x - wp.x, wp2.y - wp.y);
      }
    }
  },

  drawWorld(g) {
    if (HEADLESS) return;
    const s = this.state, c = s.cam, z = c.zoom, P = CONFIG.pitch, cam = this.drawCamera();
    const isWorldVisible = (wx, wy, radius = 50) => {
      const dx = wx - s.cam.x, dy = wy - s.cam.y;
      const viewRadius = (Math.max(CONFIG.W, CONFIG.H) * 0.6 / s.cam.zoom) + radius + 220;
      return (dx * dx + dy * dy) <= viewRadius * viewRadius;
    };
    g.fillStyle = "#05070d"; g.fillRect(0, 0, CONFIG.W, CONFIG.H);
    // 3-layer parallax star field
    for (const st of STARS) {
      const sx = (st.x - c.x * st.z) * z + CONFIG.W / 2, sy = (st.y - c.y * st.z) * z + CONFIG.H / 2;
      const wx = ((sx % CONFIG.W) + CONFIG.W) % CONFIG.W, wy = ((sy % CONFIG.H) + CONFIG.H) % CONFIG.H;
      g.globalAlpha = st.b * (0.3 + st.z * 0.7); g.fillStyle = "#bfd0e8";
      const px = st.z > 0.7 ? 2 : 1; g.fillRect(wx, wy, px, px);
    }
    g.globalAlpha = 1;

    // central star (always visible through fog)
    this.drawStar(g, z);

    // orbital ring guides (faint)
    const starS = this.S(0, 0);
    for (const pdef of CONFIG.solarPlanets) {
      const rr = pdef.orbit * z;
      if (rr < 2) continue;
      g.strokeStyle = "rgba(60,80,110,0.08)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(starS.x, starS.y, rr, rr * P, 0, 0, TAU); g.stroke();
    }

    // nebula clouds (ForgeWorld)
    for (const neb of ForgeWorld.getNebulas()) {
      const col = this.nebulaHex(neb.color), np = this.S(neb.pos.x, neb.pos.y), rr = neb.radius * z;
      if (np.x < -rr || np.x > CONFIG.W + rr || np.y < -rr || np.y > CONFIG.H + rr) continue;
      const grd = g.createRadialGradient(np.x, np.y, 0, np.x, np.y, rr);
      // belt clouds are flagged dense → thicker core
      grd.addColorStop(0, hexA(col, neb.dense ? 0.30 : 0.20));
      grd.addColorStop(0.55, hexA(col, neb.dense ? 0.14 : 0.09));
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(np.x, np.y, rr, rr * P, 0, 0, TAU); g.fill();
    }
    // planets: back ring → globe → front ring, plus moons
    for (const p of s.planets) {
      const sp = this.S(p.x, p.y), ext = p.r * CONFIG.pRingOut * z + 20;
      if (sp.x < -ext || sp.x > CONFIG.W + ext || sp.y < -ext || sp.y > CONFIG.H + ext) continue;
      if (p.dots && p.dots.length) this.drawPlanetRing(g, p, sp, z, false);
      // Clay planet globe per planetDefs type (region variants reuse the nearest
      // concept); rings stay procedural above/below. Baked-sprite fallback.
      const pKey = { ice_world: "planet_ice", fire_world: "planet_lava" }["" + p.type] || ("planet_" + p.type);
      if (!ART.draw(g, pKey, sp.x, sp.y, p.r * 2.05 * z, 0))
        SPRITES.draw(g, this.planetSprite(p.type), sp.x, sp.y, p.r * z / 230, 0);
      if (p.dots && p.dots.length) this.drawPlanetRing(g, p, sp, z, true);
      if (z > 0.03) for (const m of (p.moons || [])) this.drawMoon(g, m, z);
    }
    // ore ring guides around home station (n:0 exotic ores have no home ring)
    const base = this.S(this._oreCenter ? this._oreCenter.x : 0, this._oreCenter ? this._oreCenter.y : 0);
    for (const ring of CONFIG.rings) {
      if (!ring.n) continue;
      g.strokeStyle = "rgba(90,110,150,0.13)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(base.x, base.y, ring.r * z, ring.r * z * P, 0, 0, TAU); g.stroke();
    }
    // dormant mining-field markers (the zoomed-out "discoverable zones")
    this.drawFields(g, z);
    // depth-sorted static entities
    const items = [];
    for (const st of ForgeWorld.getStations()) {
      if (!st.discovered) continue;
      if (!isWorldVisible(st.pos.x, st.pos.y, 300)) continue;   // tall twin-torus station → wider cull margin
      const pt = this.S(st.pos.x, st.pos.y);
      // Territory capture reskins the landmark (EMPIRE flow): a station whose
      // political wedge the player holds (controller === "player", set by the
      // outpost-majority recalc — game/regions.js) flies the player's civ hull
      // (s.playerFaction) instead of the founder's. Pre-faction saves (null)
      // and a missing civ PNG (warn-once) keep the founder skin.
      let fac = this.stationFaction(st.id);
      const preg = politicalRegionAt(st.pos.x, st.pos.y);
      if (preg && preg.controller === "player" && s.playerFaction) {
        const fk = "station_" + s.playerFaction;
        if (!ART.ready || ART.has(fk)) fac = s.playerFaction;
        else ART.warnMissing(fk, "station_" + fac);
      }
      items.push({ y: st.pos.y, f: () => {
        // warp-active (charted) station → portal behind the hull (larger, so its ring
        // frames it); fall back to the pulsing purple ellipse when the PNG is absent
        if (st.warpActive && !ART.draw(g, "warp_gate", pt.x, pt.y, 370 * z, 0)) {
          g.strokeStyle = `rgba(150,110,255,${0.5 + Math.sin(s.t * 3) * 0.2})`; g.lineWidth = Math.max(1, 2 * z);
          g.beginPath(); g.ellipse(pt.x, pt.y, 42 * z, 42 * z * P, 0, 0, TAU); g.stroke();
        }
        // Stations are the sector landmarks (native draw width 500→560px @
        // z=1, Phase 2 size bump). Scales ×z like the ship/rocks, but with a
        // 24px screen-size floor so the landmark stays findable at max
        // zoom-out (z=0.08 → 45px today; the floor only binds if the zoom
        // range ever widens).
        const stW = Math.max(24, 560 * z);
        if (!ART.draw(g, "station_" + fac, pt.x, pt.y, stW, 0))
          SPRITES.draw(g, "station", pt.x, pt.y, stW / 240, 0);   // procedural fallback at the same width (native 240px)
        if (z > 0.22) { g.font = `bold ${Math.max(9, 11 * z) | 0}px monospace`; g.textAlign = "center";
          g.fillStyle = st.id === s.homeStationId ? "#7fd0ff" : "#cdd8e6";
          g.fillText((st.id === s.homeStationId ? "⌂ " : "") + st.name, pt.x, pt.y - 142 * z - 4); g.textAlign = "left"; }   // clear the taller sprite
      } });
    }
    for (let i = 0; i < s.rocks.length; i++) { const r = s.rocks[i];
      if (!r.active || !isWorldVisible(r.x, r.y, r.size * 20)) continue;
      const pt = this.S(r.x, r.y);
      items.push({ y: r.y, f: () => {
        if (r.outer) {
          const gr = Math.max(6, r.size * 30 * z);
          const grd = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, gr);
          grd.addColorStop(0, hexA(r.col, 0.3)); grd.addColorStop(1, "rgba(0,0,0,0)");
          g.fillStyle = grd; g.beginPath(); g.arc(pt.x, pt.y, gr, 0, TAU); g.fill();
        }
        // Clay asteroid variants (neutral grey art) recoloured per ore type
        // (r.col from CONFIG.rings). Variant is hashed off the stable rock id so
        // it never flickers; exotic/elite ores get the crystal-studded rock, the
        // very largest rocks read as planetoids ("large terrain bodies"). Tints
        // are baked per (key,color) — a handful of cached canvases, no per-frame
        // cost. Legacy single-PNG then procedural as fallbacks.
        const rh = (parseInt(String(r.id).slice(2), 10) || 0);
        const rKey = r.size >= 1.7 ? "planetoid_" + "abc"[rh % 3]
          : (r.type === "gold" || r.type === "platinum" || r.type === "iridium" ||
             r.type === "cryonite" || r.type === "solarite") ? "asteroid_crystal"
          : "asteroid_" + "abc"[rh % 3];
        // ×44 (was ×54, 2026-07-17 look/feel pass): visual radius ≈ size*22 now
        // sits on the size*20 physics/tow radius instead of 35% fat — rocks read
        // lighter and grabs land where the pixels are.
        if (!ART.drawTint(g, rKey, pt.x, pt.y, r.size * 44 * z, r.rot, hexA(r.col, 0.45)) &&
            !ART.drawTint(g, "asteroid", pt.x, pt.y, r.size * 44 * z, r.rot, hexA(r.col, 0.45)))
          SPRITES.draw(g, this.spriteKey(r), pt.x, pt.y, r.size * 20 / 26 * z, r.rot);   // procedural fallback
        if (r.hitFlash > 0) { g.globalAlpha = r.hitFlash * 2.5; g.fillStyle = "#ffffff";
          g.beginPath(); g.arc(pt.x, pt.y, r.size * 20 * z, 0, TAU); g.fill(); g.globalAlpha = 1; }
        if (r.hp < r.maxHp) { const bw = Math.max(16, r.size * 34 * z), by = pt.y - r.size * 22 * z - 6;
          g.fillStyle = "#1c2430"; g.fillRect(pt.x - bw / 2, by, bw, 3);
          g.fillStyle = "#ff8f6b"; g.fillRect(pt.x - bw / 2, by, bw * Math.max(0, r.hp / r.maxHp), 3); }
      } });
    }
    for (const j of s.junk) {
      if (!j.active || !isWorldVisible(j.x, j.y, j.r)) continue;
      const pt = this.S(j.x, j.y);
      // Real PNG hero shot per junk type (junk_can/panel/crate/debris). ×3.6
      // (was ×5, 2026-07-17 look/feel pass): salvage should read as pickups a
      // notch under the ore rocks, not compete with them for the screen.
      items.push({ y: j.y, f: () => {
        if (!ART.draw(g, j.key, pt.x, pt.y, j.r * 3.6 * z, j.rot))
          SPRITES.draw(g, j.key, pt.x, pt.y, j.r * 2.6 / SPRITES.defs[j.key].w * z, j.rot); } }); }
    for (const b of s.enemyBases) {
      if (!isWorldVisible(b.x, b.y, b.r * 2)) continue;
      const pt = this.S(b.x, b.y);
      items.push({ y: b.y, f: () => this.drawEnemyBase(g, b, pt, z) });
    }
    this.drawOutposts(g, items, isWorldVisible, z);
    this.drawObstacles(g, items, isWorldVisible, z);   // large non-minable terrain bodies
    this.drawSites(g, items, isWorldVisible, z);       // region landmark sites (game/sites.js)
    const shipS = this.S(s.x, s.y);
    items.push({ y: s.y, f: () => {
      const glow = Math.max(s.charge, s.flare);
      if (glow > 0.02) { const gx = shipS.x - Math.cos(s.heading) * 18 * z, gy = shipS.y - Math.sin(s.heading) * 18 * z * P;
        const gr = Math.max(2, (3 + glow * 11) * z);
        const grd = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grd.addColorStop(0, chargeColor(glow)); grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.beginPath(); g.arc(gx, gy, gr, 0, TAU); g.fill(); }
      if (s.invuln > 0 && (s.t * 10 | 0) % 2) g.globalAlpha = 0.45;
      // Clay hulls are top-down nose-right (not the old side-view art), so no
      // upright flip; width steps up per hull so the progression reads in flight.
      const hullKey = (this.activeShip() && this.activeShip().hullKey) || "vulture";
      const hullW = { vulture: 5.0, atlas: 6.0, aegis: 6.8,
                      krag_ironclad: 6.6, krag_warbarge: 7.6, krag_dreadnought: 8.8,
                      vex_lance: 6.8, vex_saber: 7.8, vex_executor: 9.0,
                      nox_veil: 7.8, nox_umbra: 9.0, nox_eclipse: 10.4 }[hullKey] || 5.4;
      // Faction-line hulls carry real animation frames (pipeline.py playerlines,
      // frame-registered so the hull never jumps): a muzzle-flash frame per
      // weapon type while fireAnimT runs, else a 2-frame engine burn while
      // thrusting. Frames that didn't ship fall back to the idle sprite.
      let frame = "";
      if ((s.fireAnimT || 0) > 0 && s.fireAnimType) frame = "_fire_" + s.fireAnimType;
      else if (s.thrusting) frame = ((s.t * 9 | 0) % 2) ? "_thrust_b" : "_thrust";
      if (frame && !ART.get("ship_" + hullKey + frame)) frame = "";
      if (!ART.draw(g, "ship_" + hullKey + frame, shipS.x, shipS.y, CONFIG.shipR * hullW * z, s.heading))
        SPRITES.draw(g, "ship", shipS.x, shipS.y, 0.68 * z, s.heading);   // procedural fallback (headless / pre-load)
      g.globalAlpha = 1;
      if (s.hp.shield > 0 && s.hp.shieldMax > 0) {
        const sr = (CONFIG.shipR + 7) * z, a = 0.18 + (s.shieldFlash || 0) * 1.6 + 0.12 * (s.hp.shield / s.hp.shieldMax);
        g.strokeStyle = `rgba(125,249,255,${Math.min(0.9, a)})`; g.lineWidth = Math.max(1, 2 * z);
        g.beginPath(); g.ellipse(shipS.x, shipS.y, sr, sr * P, 0, 0, TAU); g.stroke();
      }
    } });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    // dynamic Forge entities (flat plane)
    for (const st of this._npcStations || []) {
      if (ForgeNPC.getStatus(st.id).status === "outlaw") ForgeNPC.drawTurretRange(g, st, cam);
    }
    for (const m of s.miners) {
      if (m.state === "DEAD" || !isWorldVisible(m.x, m.y, 30)) continue;
      // Docked at home: idle/returning miners steer onto their station center (npc.js),
      // so a parked miner would draw its hull over the station sprite. Skip while docked;
      // seeking/patrolling miners are far out at the ore rings and still render.
      const hs = (s._npcStations || []).find(h => h.id === m.stationId);
      if (hs && (m.x - hs.x) * (m.x - hs.x) + (m.y - hs.y) * (m.y - hs.y) < CONFIG.dockR * CONFIG.dockR) continue;
      ForgeNPC.drawNPCShip(g, m, cam);
    }
    const lockId = ForgeCombat.getLock().targetId;
    for (const al of s.aliens) {
      if (al.state === "DEAD" || !isWorldVisible(al.x, al.y, 80)) continue;
      const ap = this.SF(al.x, al.y);
      this.drawEnemyShip(g, al, ap, z);   // class-shaped, faction-tinted procedural hull
      this.drawAlienStatus(g, al, ap, z, al.id === lockId);   // shield ring + hull bar / leader name
    }
    ForgeCombat.drawCombat(g, cam, { targets: s.aliens });
    this.drawLockedHealthBar(g);   // rich shield→armor→hull bar for the locked enemy / outpost

    // loot orbs
    for (const L of s.loot) { if (!isWorldVisible(L.x, L.y, 30)) continue; const pt = this.SF(L.x, L.y);
      const col = L.credits ? "#ffd24a"
        : L.ore ? ((CONFIG.rings.find(r => r.type === L.ore) || {}).col || "#c8d4e0")
        : (CONFIG.rarityCol[L.item.tier] || "#ffd27a");
      const rr = (5 + Math.sin(s.t * 6 + L.t) * 1.5) * z;
      const grd = g.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rr * 2.2);
      grd.addColorStop(0, hexA(col, 0.9)); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(pt.x, pt.y, rr * 2.2, 0, TAU); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(pt.x, pt.y, Math.max(2, rr * 0.7), 0, TAU); g.fill(); }

    // outpost turret shots
    if (s.outpostShots) for (const sh of s.outpostShots) {
      if (!isWorldVisible(sh.x, sh.y, 6)) continue;
      const sp = this.SF(sh.x, sh.y);
      g.fillStyle = sh.friendly ? "#ffd24a" : "#ff3030"; g.beginPath(); g.arc(sp.x, sp.y, Math.max(2, 3 * z), 0, TAU); g.fill();
    }

    // tractor HUD
    const beamRange = s.derived.tractorRange, pulse = 0.45 + Math.sin(s.t * 6) * 0.25;
    for (let i = 0; i < s.rocks.length; i++) { const r = s.rocks[i]; if (!r.active || this.isTowed("rocks", i)) continue;
      if (this.shipTo(r) > beamRange) continue; this.drawSelectRing(g, this.S(r.x, r.y), (r.size * 20 + 7) * z, `rgba(87,209,201,${pulse})`, z); }
    for (let i = 0; i < s.junk.length; i++) { const j = s.junk[i]; if (!j.active || this.isTowed("junk", i)) continue;
      if (this.shipTo(j) > beamRange) continue; this.drawSelectRing(g, this.S(j.x, j.y), (j.r + 6) * z, `rgba(255,180,80,${pulse * 0.8})`, z); }
    s.tows.forEach((t, k) => {
      const b = this.towBody(t), rp = this.S(b.x, b.y);
      g.strokeStyle = `rgba(87,209,201,${0.45 + Math.sin(s.t * 10 - k) * 0.3})`; g.lineWidth = Math.max(1.5, 3 * z);
      g.beginPath(); g.moveTo(shipS.x, shipS.y); g.lineTo(rp.x, rp.y); g.stroke();
      const lr = (this.towRadius(t) + 6) * z;
      g.strokeStyle = "#57d1c9"; g.lineWidth = Math.max(1.2, 2 * z);
      g.beginPath(); g.ellipse(rp.x, rp.y, lr, lr * P, 0, 0, TAU); g.stroke();
    });
    // charge arc
    if (s.charge > 0) { const ar = Math.max(15, 26 * z);
      g.strokeStyle = chargeColor(s.charge); g.lineWidth = 3; g.globalAlpha = 0.9;
      g.beginPath(); g.arc(shipS.x, shipS.y, ar, -Math.PI / 2, -Math.PI / 2 + s.charge * TAU); g.stroke(); g.globalAlpha = 1; }
    for (const p of particles) { g.globalAlpha = 1 - p.t / p.life; g.fillStyle = p.color;
      const pp = this.S(p.x, p.y); g.fillRect(pp.x - 2, pp.y - 2, 4, 4); }
    g.globalAlpha = 1;
    // planet labels at far zoom
    if (z <= 0.25) { g.font = "bold 10px monospace"; g.textAlign = "center";
      for (const p of s.planets) { const sp = this.S(p.x, p.y);
        g.fillStyle = "#e8edf4"; g.fillText(p.name || CONFIG.planetDefs[p.type].label, sp.x, sp.y - p.r * z * P - 8); }
      g.textAlign = "left"; }

    // fog of war overlay
    this.drawFogOverlay(g, z);

    // outpost proximity banner + territory-under-attack alert (screen space)
    this.drawOutpostHUD(g);
  },
});
