/*=== HARNESS:PLANETS ========================================================*/
// Solar system planet sprites — 8 unique types plus moon sprite. Each planet is
// a baked 512×512 gradient sphere with type-specific surface detail. The seeded
// layout places planets at fixed orbital radii with deterministic angles.

function _planetDetail(key) {
  return function (g, cx, cy, r, rr) {
    if (key === "cratered") {
      g.fillStyle = "rgba(60,50,40,0.4)";
      for (let i = 0; i < 18; i++) {
        const cr = 8 + rr() * 40;
        g.beginPath(); g.arc(cx + (rr() - 0.5) * r * 1.6, cy + (rr() - 0.5) * r * 1.6, cr, 0, TAU); g.fill();
      }
      g.fillStyle = "rgba(200,190,170,0.2)";
      for (let i = 0; i < 6; i++) {
        g.beginPath(); g.arc(cx + (rr() - 0.5) * r * 1.2, cy + (rr() - 0.5) * r * 1.2, 3 + rr() * 12, 0, TAU); g.fill();
      }
    } else if (key === "lava") {
      for (let i = 0; i < 12; i++) {
        let x = cx + (rr() - 0.5) * r * 1.6, y = cy + (rr() - 0.5) * r * 1.6;
        const seg = [[x, y]];
        for (let k = 0; k < 6; k++) { x += (rr() - 0.5) * r * 0.45; y += (rr() - 0.5) * r * 0.45; seg.push([x, y]); }
        g.strokeStyle = "rgba(255,120,30,0.85)"; g.lineWidth = 5;
        g.beginPath(); g.moveTo(seg[0][0], seg[0][1]); for (const p of seg) g.lineTo(p[0], p[1]); g.stroke();
        g.strokeStyle = "rgba(255,220,120,0.9)"; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(seg[0][0], seg[0][1]); for (const p of seg) g.lineTo(p[0], p[1]); g.stroke();
      }
      g.fillStyle = "rgba(30,6,2,0.5)";
      for (let i = 0; i < 7; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.4, cy + (rr() - 0.5) * r * 1.4, 24 + rr() * 55, 16 + rr() * 34, rr() * 3, 0, TAU); g.fill(); }
    } else if (key === "tan_gas") {
      let y = cy - r;
      const cols = ["rgba(210,180,120,0.4)", "rgba(180,140,80,0.35)", "rgba(230,200,150,0.3)", "rgba(160,120,70,0.4)"];
      let ci = 0;
      while (y < cy + r) {
        const bh = 18 + rr() * 42;
        g.fillStyle = cols[ci++ % cols.length];
        g.beginPath(); g.moveTo(cx - r * 1.2, y);
        for (let x = -r * 1.2; x <= r * 1.2; x += r * 0.2) g.lineTo(cx + x, y + Math.sin(x * 0.013 + ci) * 7);
        for (let x = r * 1.2; x >= -r * 1.2; x -= r * 0.2) g.lineTo(cx + x, y + bh + Math.sin(x * 0.011 + ci) * 7);
        g.closePath(); g.fill(); y += bh;
      }
      g.fillStyle = "rgba(200,170,110,0.4)";
      g.beginPath(); g.ellipse(cx + r * 0.25, cy + r * 0.2, r * 0.18, r * 0.08, -0.2, 0, TAU); g.fill();
    } else if (key === "ice") {
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 3;
      for (let i = 0; i < 14; i++) {
        let x = cx + (rr() - 0.5) * r * 1.6, y = cy + (rr() - 0.5) * r * 1.6;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rr() - 0.5) * r * 0.5; y += (rr() - 0.5) * r * 0.5; g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = "rgba(180,225,245,0.3)";
      for (let i = 0; i < 8; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.4, cy + (rr() - 0.5) * r * 1.4, 20 + rr() * 60, 12 + rr() * 30, rr() * 3, 0, TAU); g.fill(); }
    } else if (key === "life") {
      g.fillStyle = "rgba(40,120,80,0.45)";
      for (let i = 0; i < 10; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.4, cy + (rr() - 0.5) * r * 1.4, 30 + rr() * 80, 20 + rr() * 40, rr() * 3, 0, TAU); g.fill(); }
      g.fillStyle = "rgba(30,80,140,0.35)";
      for (let i = 0; i < 5; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.6, cy + (rr() - 0.5) * r * 1.4, 40 + rr() * 60, 30 + rr() * 40, rr() * 3, 0, TAU); g.fill(); }
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.beginPath(); g.ellipse(cx - r * 0.1, cy - r * 0.55, r * 0.35, r * 0.12, 0.15, 0, TAU); g.fill();
    } else if (key === "desert") {
      g.fillStyle = "rgba(120,60,20,0.35)";
      for (let i = 0; i < 12; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.6, cy + (rr() - 0.5) * r * 1.6, 20 + rr() * 70, 8 + rr() * 25, rr() * 3, 0, TAU); g.fill(); }
      g.strokeStyle = "rgba(180,100,40,0.4)"; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        let x = cx + (rr() - 0.5) * r * 1.4, y = cy + (rr() - 0.5) * r * 1.2;
        g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rr() - 0.5) * r * 0.4; y += rr() * r * 0.15; g.lineTo(x, y); }
        g.stroke();
      }
    } else if (key === "purple_gas") {
      let y = cy - r;
      const cols = ["rgba(150,90,200,0.5)", "rgba(100,70,140,0.4)", "rgba(180,130,220,0.35)", "rgba(80,50,120,0.4)"];
      let ci = 0;
      while (y < cy + r) {
        const bh = 18 + rr() * 42;
        g.fillStyle = cols[ci++ % cols.length];
        g.beginPath(); g.moveTo(cx - r * 1.2, y);
        for (let x = -r * 1.2; x <= r * 1.2; x += r * 0.2) g.lineTo(cx + x, y + Math.sin(x * 0.013 + ci) * 7);
        for (let x = r * 1.2; x >= -r * 1.2; x -= r * 0.2) g.lineTo(cx + x, y + bh + Math.sin(x * 0.011 + ci) * 7);
        g.closePath(); g.fill(); y += bh;
      }
      g.fillStyle = "rgba(200,160,240,0.45)";
      g.beginPath(); g.ellipse(cx + r * 0.3, cy + r * 0.25, r * 0.22, r * 0.1, -0.2, 0, TAU); g.fill();
    } else if (key === "dark") {
      g.fillStyle = "rgba(20,15,30,0.5)";
      for (let i = 0; i < 8; i++) { g.beginPath();
        g.ellipse(cx + (rr() - 0.5) * r * 1.4, cy + (rr() - 0.5) * r * 1.4, 30 + rr() * 70, 20 + rr() * 40, rr() * 3, 0, TAU); g.fill(); }
      g.strokeStyle = "rgba(80,60,120,0.3)"; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        let x = cx + (rr() - 0.5) * r * 1.2, y = cy + (rr() - 0.5) * r * 1.2;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x += (rr() - 0.5) * r * 0.5; y += (rr() - 0.5) * r * 0.5; g.lineTo(x, y); }
        g.stroke();
      }
    }
  };
}

function definePlanet(key, def, detail) {
  SPRITES.define(key, { w: 512, h: 512, brief: `${key} planet sphere`,
    bake(g, w, h) {
      const cx = 256, cy = 256, r = 230;
      const halo = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 1.11);
      halo.addColorStop(0, def.halo); halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, r * 1.11, 0, TAU); g.fill();
      const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      grd.addColorStop(0, def.base); grd.addColorStop(0.55, def.mid); grd.addColorStop(1, def.dark);
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
      let s = key.length * 31 + 7, rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      detail(g, cx, cy, r, rr);
      const limb = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.5, cx, cy, r * 1.02);
      limb.addColorStop(0, "rgba(0,0,0,0)"); limb.addColorStop(1, "rgba(2,4,14,0.55)");
      g.fillStyle = limb; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.restore();
    } });
}

// define all planet types
for (const ptype of Object.keys(CONFIG.planetDefs)) {
  if (ptype === "ice_world" || ptype === "fire_world" || ptype === "gas_giant") continue;
  definePlanet("planet_" + ptype, CONFIG.planetDefs[ptype], _planetDetail(ptype));
}
// legacy types (kept for any remaining references)
definePlanet("planet_ice", CONFIG.planetDefs.ice_world, _planetDetail("ice"));
definePlanet("planet_fire", CONFIG.planetDefs.fire_world, _planetDetail("lava"));
definePlanet("planet_gas", CONFIG.planetDefs.gas_giant, _planetDetail("purple_gas"));

// moon sprite: small grey cratered body
SPRITES.define("moon", { w: 128, h: 128, brief: "small grey moon",
  bake(g) {
    const cx = 64, cy = 64, r = 50;
    const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grd.addColorStop(0, "#c0bab0"); grd.addColorStop(0.5, "#8a8478"); grd.addColorStop(1, "#4a4640");
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    let s = 77; const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    g.fillStyle = "rgba(50,45,40,0.4)";
    for (let i = 0; i < 10; i++) {
      const cr = 3 + rr() * 14;
      g.beginPath(); g.arc(cx + (rr() - 0.5) * r * 1.4, cy + (rr() - 0.5) * r * 1.4, cr, 0, TAU); g.fill();
    }
    const limb = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.4, cx, cy, r * 1.02);
    limb.addColorStop(0, "rgba(0,0,0,0)"); limb.addColorStop(1, "rgba(2,4,14,0.5)");
    g.fillStyle = limb; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  },
});

Object.assign(GAME, {
  planetSprite(t) { return "planet_" + t; },

  // deterministic solar system: 8 fixed planets at specified orbital radii,
  // each with seeded angle, moons, and optional ring dots
  makePlanets() {
    const defs = CONFIG.solarPlanets, planets = [];
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      const angle = (i / defs.length) * TAU + rnd() * 0.5 - 0.25;
      const x = Math.cos(angle) * def.orbit;
      const y = Math.sin(angle) * def.orbit;
      const dotN = CONFIG.planetRingDotsMin + ((rnd() * (CONFIG.planetRingDotsMax - CONFIG.planetRingDotsMin)) | 0);
      const dots = [];
      if (def.rings) {
        for (let k = 0; k < dotN; k++) dots.push({ a: rnd() * TAU,
          u: CONFIG.pRingIn + rnd() * (CONFIG.pRingOut - CONFIG.pRingIn), s: 3 + rnd() * 8 });
      }
      const moons = [];
      for (let m = 0; m < def.moons; m++) {
        const ma = rnd() * TAU, md = def.r * 2.5 + rnd() * def.r * 1.5;
        moons.push({ x: x + Math.cos(ma) * md, y: y + Math.sin(ma) * md, r: 60 + rnd() * 80 });
      }
      planets.push({ name: def.name, type: def.type, x, y, r: def.r, dots, moons,
        orbit: def.orbit, stationIdx: def.stationIdx, faction: def.faction });
    }
    return planets;
  },
});
