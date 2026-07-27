/*=== HARNESS:FOG ============================================================*/
// Inked star-chart fog of war. Owns BOTH fog surfaces: the in-world overlay you
// fly through and the galaxy-map chart. Unknown space renders as a slate-parchment
// card with cross-hatching and a torn, hand-inked coastline along the frontier.
//
// Three knowledge tiers, ranked by ink density (dense → sparse → none):
//   UNKNOWN  full paper + hatch          — never been there, never scanned
//   SCANNED  thin tint + contact ticks   — a region survey says "something's here"
//   CLEAR    nothing                     — you flew through it (s.exploredTiles)
//
// Granularity differs per surface ON PURPOSE. Reveal happens at CONFIG.FOG_TILE
// (2000u), so the in-world pass must draw at 2000u or it visibly over/under-reveals.
// The map draws paper + scan state at REGION granularity (4000u) because at
// mapZoom 1 a 2000u tile is 3.9px and can't carry a texture — but a partial
// region's clear quadrants are punched back out at 2000u and the frontier ink
// runs on the 2000u lattice, so the coastline on the chart is the same curve you
// see from the cockpit.
//
// Loaded AFTER world/rendering.js so its drawFogOverlay wins the Object.assign.
const FOG_INK = {
  PATCH: 128, SS: 2,              // paper patch: 128 logical px, 2× supersampled
  hatchGap: 7, hatchGap2: 11,     // 45° / 135° spacing — coprime-ish, kills moiré
  VJIT: 0.115,                    // lattice-vertex jitter, fraction of a cell
  PJIT: 0.055,                    // mid-edge wobble, fraction of a cell
  NSEG: 24,                       // sample slots per edge (stride varies, not this)

  // (a) UNKNOWN. Map bg is rgba(10,13,20,.92) ≈ L5%; paper lands at L≈8% after
  // hatching — a legible lighter card, still far under the teal owned-region
  // fill (L≈30%). Unknown space must never become the brightest thing on screen.
  paper: ["#161920", "#191c23", "#1c2028", "#1f232b"],   // hash-picked per map cell
  paperSolid: "#191c23",          // in-world: the patch carries the mottle instead
  paperA: 0.92,
  hatch: "rgba(5,7,12,0.55)",     // DARKER than the paper — hatching lowers luminance
  // (c) SCANNED but not flown
  scanFill: "rgba(34,58,66,0.30)",
  hatchA_scan: 0.28,
  scanTick: "rgba(122,178,190,0.42)",
  // frontier ink: a wide dark bleed pass under a thin pen pass
  edgeInk: "rgba(96,112,134,0.72)",
  edgeBleed: "rgba(3,5,9,0.42)",
  edgeInkDot: "rgba(96,112,134,0.34)",

  _patch: null, _pats: null,

  // Stable uint32 hash. Math.imul keeps the mixes in 32-bit (plain * drifts to
  // float and biases every sample low — see clay_world_engine's hash2 note).
  // NOTE: fog must NEVER call rnd() — that mutates the global _seed and would
  // desync every later world roll the moment a lazy bake fires.
  hash3(x, y, k) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(k | 0, 2246822519);
    h = (h ^ 0x5bf03635) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },

  // The paper texture: one canvas, baked once, tiled forever. Every line family
  // is drawn across a 3×3 super-range so the pattern wraps seamlessly.
  patch() {
    if (this._patch) return this._patch;
    if (HEADLESS || typeof document === "undefined") return null;
    const Q = this.PATCH, SS = this.SS, N = Q * SS;
    const cv = document.createElement("canvas"); cv.width = cv.height = N;
    const b = cv.getContext("2d"); if (!b) return null;
    b.scale(SS, SS);
    b.strokeStyle = this.hatch; b.lineWidth = 1 / SS;
    for (const [gap, dir] of [[this.hatchGap, 1], [this.hatchGap2, -1]]) {
      b.beginPath();
      for (let i = -Q; i <= Q * 2; i += gap) {
        b.moveTo(i, dir > 0 ? -Q : Q * 2);
        b.lineTo(i + Q * 3 * dir, dir > 0 ? Q * 2 : -Q);
      }
      b.stroke();
    }
    for (let i = 0; i < 700; i++)                       // ink grain
      { b.fillStyle = "rgba(0,0,0,0.10)"; b.fillRect(this.hash3(i, 1, 3) * Q | 0, this.hash3(i, 2, 3) * Q | 0, 1, 1); }
    for (let i = 0; i < 250; i++)                       // paper tooth (lighter specks)
      { b.fillStyle = "rgba(190,200,215,0.045)"; b.fillRect(this.hash3(i, 5, 9) * Q | 0, this.hash3(i, 6, 9) * Q | 0, 1, 1); }
    b.strokeStyle = "rgba(0,0,0,0.12)"; b.lineWidth = 1 / SS;   // pulp fibers
    b.beginPath();
    for (let i = 0; i < 40; i++) {
      const fx = this.hash3(i, 11, 13) * Q, fy = this.hash3(i, 12, 13) * Q;
      const a = this.hash3(i, 13, 13) * TAU, L = 3 + this.hash3(i, 14, 13) * 3;
      b.moveTo(fx, fy); b.lineTo(fx + Math.cos(a) * L, fy + Math.sin(a) * L);
    }
    b.stroke();
    this._patch = cv;
    return cv;
  },
  // CanvasPattern, cached per drawing context (the map bake has its own ctx)
  pattern(g) {
    if (!this._pats) this._pats = new Map();
    if (this._pats.has(g)) return this._pats.get(g);
    const cv = this.patch();
    let p = null;
    try { p = cv && g.createPattern ? g.createPattern(cv, "repeat") : null; } catch (e) { p = null; }
    if (p && p.setTransform === undefined) { /* fine — we translate the ctx instead */ }
    this._pats.set(g, p);
    return p;
  },

  // Lattice-vertex jitter. Jittering VERTICES (not whole edges) is what lets
  // neighbouring edges share an endpoint exactly — no notches at the corners.
  vjx(vx, vy, cell) { return (this.hash3(vx, vy, 11) * 2 - 1) * this.VJIT * cell; },
  vjy(vx, vy, cell) { return (this.hash3(vx, vy, 29) * 2 - 1) * this.VJIT * cell; },
};

Object.assign(GAME, {
  FOG_UNKNOWN: 0, FOG_SCANNED: 1, FOG_CLEAR: 2,

  // ---- knowledge queries ---------------------------------------------------
  // Everything here is SPARSE. CONFIG.FOG_TILE is small enough that the ship's
  // reveal bubble is a bubble and not the whole screen, which puts ~180k cells
  // in the disc — far too many to walk per frame or even per bake. The two
  // things the player actually knows (exploredTiles, scannedRegions) are tiny,
  // so every pass is driven off those instead of off the lattice.

  // Split a "tx,ty" key. Returns false for the literal "merc-probe-tile" key
  // onboarding injects into exploredTiles (which would otherwise parse as NaN).
  _fogKey(key, out) {
    const c = key.indexOf(",");
    if (c < 1) return false;
    const tx = +key.slice(0, c), ty = +key.slice(c + 1);
    if (tx !== tx || ty !== ty) return false;
    out[0] = tx; out[1] = ty;
    return true;
  },
  _fogScannedAt(tx, ty) {
    const s = this.state, sc = s.scannedRegions;
    if (!sc || !sc.size) return false;
    const t = CONFIG.FOG_TILE;
    const r = this.regionAt(tx * t + t / 2, ty * t + t / 2);
    return !!(r && sc.has(r.id));
  },

  // A small Uint8Array over just the cells on screen — built fresh each frame,
  // so there is no cache to go stale and no full-disc walk.
  _fogWin(minTx, maxTx, minTy, maxTy) {
    const s = this.state;
    if (!s.exploredTiles) return null;
    const w = maxTx - minTx + 1, h = maxTy - minTy + 1, need = w * h;
    if (need <= 0 || need > 262144) return null;
    if (!this._fogWinA || this._fogWinA.length < need) this._fogWinA = new Uint8Array(Math.max(4096, need * 2));
    const a = this._fogWinA, sc = s.scannedRegions, sn = sc ? sc.size : 0;
    let i = 0;
    for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++, i++)
      a[i] = s.exploredTiles.has(tx + "," + ty) ? this.FOG_CLEAR
           : (sn && this._fogScannedAt(tx, ty)) ? this.FOG_SCANNED : this.FOG_UNKNOWN;
    return { a, minTx, minTy, w, h };
  },
  // Cells outside the window read UNKNOWN — callers pad the window by a cell so
  // that only off-screen borders are ever affected.
  _fogStateAt(win, tx, ty) {
    if (!win || tx < win.minTx || ty < win.minTy || tx >= win.minTx + win.w || ty >= win.minTy + win.h)
      return this.FOG_UNKNOWN;
    return win.a[(ty - win.minTy) * win.w + (tx - win.minTx)];
  },

  // ---- frontier ink --------------------------------------------------------
  // Walk one canonical edge, writing screen-space points into `out`. Detail
  // varies by STRIDE over a fixed 24 slots, so zooming refines the same curve
  // instead of morphing it. The sin(πt) envelope pins the wobble to zero at both
  // endpoints, so consecutive edges meet exactly at the shared jittered vertex.
  _fogEdgePts(ex, ey, axis, cell, stride, project, out, n) {
    const F = FOG_INK, NS = F.NSEG;
    const v0x = ex, v0y = ey, v1x = ex + (axis ? 0 : 1), v1y = ey + (axis ? 1 : 0);
    const p0x = v0x * cell + F.vjx(v0x, v0y, cell), p0y = v0y * cell + F.vjy(v0x, v0y, cell);
    const p1x = v1x * cell + F.vjx(v1x, v1y, cell), p1y = v1y * cell + F.vjy(v1x, v1y, cell);
    const dx = p1x - p0x, dy = p1y - p0y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i <= NS; i += stride) {
      const t = i / NS;
      const w = (F.hash3(ex, ey, axis * 64 + i + 101) * 2 - 1) * F.PJIT * cell * Math.sin(Math.PI * t);
      const p = project(p0x + dx * t + nx * w, p0y + dy * t + ny * w);
      out[n++] = p.x; out[n++] = p.y;
    }
    if ((NS % stride) !== 0) {   // always land on the shared endpoint
      const p = project(p1x, p1y); out[n++] = p.x; out[n++] = p.y;
    }
    out[n++] = NaN; out[n++] = NaN;   // pen-up marker between edges
    return n;
  },
  // Trace one cell as a closed jittered quad, appended as a SUBPATH. Because
  // the corner offsets come from the shared lattice vertices, neighbouring
  // cells' quads meet exactly — so filling every cell of a group in ONE path
  // unions them (nonzero winding cancels the interior edges, no seams) and
  // only the group's OUTER boundary comes out torn. This is what makes the
  // paper itself ragged; an ink line traced over square fills never would.
  _fogTileSubpath(g, tx, ty, cell, stride, project, scratch) {
    const seg = (ex, ey, axis, rev, first) => {
      const n = this._fogEdgePts(ex, ey, axis, cell, stride, project, scratch, 0) - 2;   // drop the NaN marker
      if (rev) { for (let i = n - 2; i >= 0; i -= 2) (first && i === n - 2 ? g.moveTo : g.lineTo).call(g, scratch[i], scratch[i + 1]); }
      else { for (let i = 0; i < n; i += 2) (first && i === 0 ? g.moveTo : g.lineTo).call(g, scratch[i], scratch[i + 1]); }
    };
    seg(tx, ty, 0, false, true);        // top,    left → right
    seg(tx + 1, ty, 1, false, false);   // right,  top → bottom
    seg(tx, ty + 1, 0, true, false);    // bottom, right → left
    seg(tx, ty, 1, true, false);        // left,   bottom → top
    g.closePath();
  },

  // Replay a point buffer as ONE path — two stroke() calls total for the whole
  // frontier, however many edges it holds.
  _fogEdgeStroke(g, buf, np, w, style) {
    if (np < 6) return;
    g.strokeStyle = style; g.lineWidth = w;
    g.lineJoin = "round"; g.lineCap = "round";
    g.beginPath();
    let pen = false;
    for (let i = 0; i < np; i += 2) {
      if (buf[i] !== buf[i]) { pen = false; continue; }        // NaN → pen up
      if (!pen) { g.moveTo(buf[i], buf[i + 1]); pen = true; } else g.lineTo(buf[i], buf[i + 1]);
    }
    g.stroke();
    g.lineWidth = 1;
  },
  _fogBuf(need) {
    if (!this._fogPts || this._fogPts.length < need) this._fogPts = new Float64Array(Math.max(4096, need * 2));
    return this._fogPts;
  },
  // separate from _fogBuf: _fogTileSubpath borrows one while the ink pass owns the other
  _fogScratch() {
    if (!this._fogScr) this._fogScr = new Float64Array(4 * (FOG_INK.NSEG + 8));
    return this._fogScr;
  },

  // ---- surface A: in-world overlay -----------------------------------------
  // Bounded by the viewport, so the cell count is a few hundred at zoomMin. The
  // torn-polygon path only runs when a cell is big enough on screen for the tear
  // to read; below that it falls back to plain rects, which look identical at
  // that size and cost a fraction of the points.
  drawFogOverlay(g, z) {
    if (HEADLESS) return;
    const s = this.state, t = CONFIG.FOG_TILE, P = CONFIG.pitch, F = FOG_INK;
    const pat = F.pattern(g);
    if (!pat) { this._fogFlatFallback(g, z); return; }

    const halfW = CONFIG.W / 2 / z, halfH = CONFIG.H / 2 / z / P;
    const minTx = Math.floor((s.cam.x - halfW) / t) - 1, maxTx = Math.ceil((s.cam.x + halfW) / t) + 1;
    const minTy = Math.floor((s.cam.y - halfH) / t) - 1, maxTy = Math.ceil((s.cam.y + halfH) / t) + 1;
    const gr = this._fogWin(minTx, maxTx, minTy, maxTy);
    if (!gr) { this._fogFlatFallback(g, z); return; }
    const cx = CONFIG.W / 2 - s.cam.x * z, cy = CONFIG.H / 2 - s.cam.y * z * P;   // inlined S()
    const sx = wx => wx * z + cx, sy = wy => wy * z * P + cy;

    // Paper, as one torn-edged polygon per knowledge tier. The pattern is
    // world-locked in TRANSLATION but fixed in SCALE: no crawl when you pan, no
    // pop or resample blur when you zoom. Paper grain belongs to the chart, not
    // the territory — and it must NOT take the pitch, which would skew the 45°
    // hatch to 39.4° and read as a rendering bug.
    const Q = F.PATCH;
    const ox = -((((s.cam.x * z) % Q) + Q) % Q), oy = -((((s.cam.y * z * P) % Q) + Q) % Q);
    const proj = (wx, wy) => ({ x: sx(wx) - ox, y: sy(wy) - oy });
    const edgeLen = t * z;
    const stride = edgeLen < 120 ? 8 : edgeLen < 340 ? 4 : edgeLen < 900 ? 2 : 1;
    // below ~34px a cell's ±11% tear is under half a pixel — invisible, and
    // hundreds of jittered quads a frame for nothing
    const torn = edgeLen >= 34;
    const scratch = this._fogScratch();
    g.save();
    g.translate(ox, oy);
    for (const tier of [this.FOG_UNKNOWN, this.FOG_SCANNED]) {
      let any = false;
      g.beginPath();
      for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
        if (this._fogStateAt(gr, tx, ty) !== tier) continue;
        if (torn) this._fogTileSubpath(g, tx, ty, t, stride, proj, scratch);
        else { const p0 = proj(tx * t, ty * t), p1 = proj((tx + 1) * t, (ty + 1) * t);
               g.rect(p0.x, p0.y, p1.x - p0.x + 0.5, p1.y - p0.y + 0.5); }
        any = true;
      }
      if (!any) continue;
      const scanned = tier === this.FOG_SCANNED;
      g.globalAlpha = scanned ? 0.38 : F.paperA;
      g.fillStyle = scanned ? F.scanFill : F.paperSolid;
      g.fill();
      g.globalAlpha = scanned ? F.hatchA_scan : 1;
      g.fillStyle = pat;
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();

    // Contact ticks inside scanned-but-unflown space. Placed per REGION, not per
    // tile — a 4000u sector is 100 tiles at this lattice and a tick each would be
    // a snowstorm.
    const sc = s.scannedRegions;
    if (sc && sc.size) {
      const cell = CONFIG.sectorSize, tickR = Math.max(1.2, Math.min(3.5, 0.00075 * cell * z));
      g.fillStyle = F.scanTick;
      for (const rid of sc) {
        const r = this.regionGet(rid); if (!r) continue;
        if (Math.abs(r.cx - s.cam.x) > halfW + cell || Math.abs(r.cy - s.cam.y) > halfH + cell) continue;
        for (let i = 0; i < 7; i++) {
          const wx = r.cx - cell / 2 + FOG_INK.hash3(r.col, r.row, 40 + 2 * i) * cell;
          const wy = r.cy - cell / 2 + FOG_INK.hash3(r.col, r.row, 41 + 2 * i) * cell;
          if (this._fogStateAt(gr, Math.floor(wx / t), Math.floor(wy / t)) !== this.FOG_SCANNED) continue;
          g.beginPath(); g.arc(sx(wx), sy(wy), tickR, 0, TAU); g.fill();
        }
      }
    }

    // Frontier ink along the torn edge. Only unknown cells emit, and only on
    // sides facing known space, so no edge is ever inked twice.
    const inkProj = (wx, wy) => ({ x: sx(wx), y: sy(wy) });
    const buf = this._fogBuf((maxTx - minTx + 3) * (maxTy - minTy + 3) * 4 * (F.NSEG + 4) * 2);
    let n = 0;
    for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
      if (this._fogStateAt(gr, tx, ty) !== this.FOG_UNKNOWN) continue;
      if (this._fogStateAt(gr, tx, ty - 1) !== this.FOG_UNKNOWN) n = this._fogEdgePts(tx, ty, 0, t, stride, inkProj, buf, n);
      if (this._fogStateAt(gr, tx, ty + 1) !== this.FOG_UNKNOWN) n = this._fogEdgePts(tx, ty + 1, 0, t, stride, inkProj, buf, n);
      if (this._fogStateAt(gr, tx - 1, ty) !== this.FOG_UNKNOWN) n = this._fogEdgePts(tx, ty, 1, t, stride, inkProj, buf, n);
      if (this._fogStateAt(gr, tx + 1, ty) !== this.FOG_UNKNOWN) n = this._fogEdgePts(tx + 1, ty, 1, t, stride, inkProj, buf, n);
    }
    const w = Math.max(1.1, Math.min(2.4, 1.6 * Math.pow(z, 0.35)));
    this._fogEdgeStroke(g, buf, n, w * 2.1, F.edgeBleed);
    this._fogEdgeStroke(g, buf, n, w, F.edgeInk);
  },

  // The pre-ink flat wash, kept verbatim as the fallback whenever the paper
  // patch or a pattern can't be built (old webview, no createPattern).
  _fogFlatFallback(g, z) {
    const s = this.state, t = CONFIG.FOG_TILE, P = CONFIG.pitch;
    const halfW = CONFIG.W / 2 / z, halfH = CONFIG.H / 2 / z / P;
    const minTx = Math.floor((s.cam.x - halfW) / t) - 1, maxTx = Math.ceil((s.cam.x + halfW) / t) + 1;
    const minTy = Math.floor((s.cam.y - halfH) / t) - 1, maxTy = Math.ceil((s.cam.y + halfH) / t) + 1;
    g.fillStyle = "rgba(5,7,13,0.55)";
    for (let tx = minTx; tx <= maxTx; tx++) for (let ty = minTy; ty <= maxTy; ty++) {
      if (s.exploredTiles.has(tx + "," + ty)) continue;
      const wp = this.S(tx * t, ty * t), wp2 = this.S((tx + 1) * t, (ty + 1) * t);
      g.fillRect(wp.x, wp.y, wp2.x - wp.x, wp2.y - wp.y);
    }
  },

  // ---- surface B: galaxy-map chart -----------------------------------------
  // The old loop ran 7569 iterations and ~27k allocations EVERY map frame. This
  // bakes the whole chart once into an offscreen canvas and blits it.
  FOG_BAKE_R: 102000,   // 3 cells past the region lattice so the rim still fogs

  _fogMapBake() {
    if (HEADLESS || typeof document === "undefined") return null;
    const s = this.state, F = FOG_INK, t = CONFIG.FOG_TILE;
    if (!s.exploredTiles) return null;
    const tiles = s.exploredTiles, n = tiles.size, scan = s.scannedRegions, sn = scan ? scan.size : 0;
    const c = this._fogBake;
    const B = 1024;
    // Identity AND size on both Sets: save.js assigns a BRAND-NEW Set on load, so
    // a size-only key silently serves the previous run's chart when counts match.
    if (c && c.B === B && c.tiles === tiles && c.n === n && c.scan === scan && c.sn === sn) return c;
    // update() keeps running with the map open, so the ship coasts and reveals
    // tiles mid-view — throttle rebakes rather than rebuilding every frame.
    if (c && s.t - (c._at || -9) < 0.25) return c;

    const R2 = this.FOG_BAKE_R, cell = CONFIG.sectorSize;
    const cv = c && c.cvs && c.cvs.width === B ? c.cvs
      : (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(B, B) : document.createElement("canvas"));
    cv.width = B; cv.height = B;
    const b = cv.getContext("2d"); if (!b) return null;
    b.clearRect(0, 0, B, B);
    const K = B / (R2 * 2);                       // world → bake px
    const bx = wx => (wx + R2) * K, by = wy => (wy + R2) * K;

    // ONE continuous sheet. Drawing per-cell cards instead made the region grid
    // read as a checkerboard and gave the chart a stair-stepped rim where the
    // cards ran out — paper should have no edge you can point at.
    b.globalAlpha = F.paperA;
    b.fillStyle = F.paperSolid;
    b.fillRect(0, 0, B, B);
    b.globalAlpha = 1;
    // gentle per-region mottle: enough to break the flat, far too weak to read
    // as cells (a 4000u region is only ~8px on screen at mapZoom 1)
    const NR = Math.ceil(R2 / cell);
    for (let row = -NR; row <= NR; row++) for (let col = -NR; col <= NR; col++) {
      const h = FOG_INK.hash3(col, row, 3);
      b.fillStyle = h < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(150,170,200,0.035)";
      b.fillRect(bx(col * cell - cell / 2), by(row * cell - cell / 2), cell * K + 0.5, cell * K + 0.5);
    }
    // scanned sectors read as thinner ink, not a different card
    if (s.scannedRegions && s.scannedRegions.size)
      for (const rid of s.scannedRegions) {
        const r = this.regionGet(rid); if (!r) continue;
        b.globalCompositeOperation = "destination-out";
        b.fillStyle = "rgba(0,0,0,0.62)";   // thin the sheet rather than paint over it
        b.fillRect(bx(r.cx - cell / 2), by(r.cy - cell / 2), cell * K + 0.5, cell * K + 0.5);
        b.globalCompositeOperation = "source-over";
      }
    // ONE fillRect hatches every paper cell, perfectly masked — no 2000-rect clip
    const pat = F.pattern(b);
    if (pat) {
      b.globalCompositeOperation = "source-atop";
      b.fillStyle = pat; b.fillRect(0, 0, B, B);
      b.globalCompositeOperation = "source-over";
    }
    // feather the sheet away past the rim so the chart ends in paper, not in a
    // hard square where the bake ran out
    const gcen = B / 2, grd = b.createRadialGradient(gcen, gcen, R2 * 0.86 * K, gcen, gcen, R2 * K);
    grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,1)");
    b.globalCompositeOperation = "destination-out";
    b.fillStyle = grd; b.fillRect(0, 0, B, B);
    b.globalCompositeOperation = "source-over";

    // Punch the flown tiles back out. Driven off the SET, not the lattice: the
    // disc holds ~180k cells at this tile size but a save only ever carries the
    // few thousand you actually flew through. Punched as ONE path so nonzero
    // winding unions the tiles (no seams) and only the corridor's outer boundary
    // comes out torn.
    const bProj = (wx, wy) => ({ x: bx(wx), y: by(wy) });
    const bScratch = this._fogScratch();
    const kv = this._fogKV || (this._fogKV = [0, 0]);
    // above this many tiles the per-tile tear is invisible on a 1024px bake
    // anyway, so plain rects buy back the time
    const tornPunch = n <= 6000;
    let punched = false;
    b.beginPath();
    for (const key of tiles) {
      if (!this._fogKey(key, kv)) continue;
      const tx = kv[0], ty = kv[1];
      if (tornPunch) this._fogTileSubpath(b, tx, ty, t, 4, bProj, bScratch);
      else b.rect(bx(tx * t), by(ty * t), t * K + 0.5, t * K + 0.5);
      punched = true;
    }
    if (punched) {
      b.globalCompositeOperation = "destination-out";
      b.fillStyle = "#000"; b.fill();
      b.globalCompositeOperation = "source-over";
    }
    // contact ticks, one scatter per surveyed sector
    b.fillStyle = F.scanTick;
    if (sn) for (const rid of scan) {
      const r = this.regionGet(rid); if (!r) continue;
      for (let i = 0; i < 7; i++) {
        const wx = r.cx - cell / 2 + FOG_INK.hash3(r.col, r.row, 40 + 2 * i) * cell;
        const wy = r.cy - cell / 2 + FOG_INK.hash3(r.col, r.row, 41 + 2 * i) * cell;
        if (tiles.has(Math.floor(wx / t) + "," + Math.floor(wy / t))) continue;
        b.fillRect(bx(wx), by(wy), 3, 3);
      }
    }
    // NOTE: the frontier ink is deliberately NOT baked. The bake is blitted at
    // anywhere from 0.4× to 10× depending on mapZoom, so a baked line is either
    // invisible or a fat blur — and it double-draws under the crisp pass. Only
    // the paper is baked; _fogMapInk stitches the coastline live every frame.

    this._fogBake = { cvs: cv, B, R2, tiles, n, scan, sn, _at: s.t };
    return this._fogBake;
  },

  // Replaces the galaxy map's per-frame tile loop: one drawImage for the paper,
  // plus a live-stroked coastline that stays a pen line at every zoom.
  drawMapFog(g, m) {
    if (HEADLESS) return;
    const bake = this._fogMapBake();
    if (!bake) { this._mapFogFlatFallback(g); return; }
    const R2 = bake.R2;
    const p0 = this.mapPoint(-R2, -R2), p1 = this.mapPoint(R2, R2);
    g.drawImage(bake.cvs, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    this._fogMapInk(g, m);
  },

  // The coastline in WORLD space, cached. Walked from the CLEAR side (iterating
  // exploredTiles) rather than the unknown side — the canonical edge form makes
  // the geometry identical either way, and the clear set is thousands of entries
  // where the lattice is hundreds of thousands.
  //
  // This must be cached: a well-explored save holds ~17k tiles, and testing four
  // neighbours each costs 68k string concats + Set probes. Doing that per frame
  // measured 17ms — the whole frame budget. The geometry only moves when
  // knowledge changes (or the LOD stride does), so that is the cache key; the
  // per-frame job is just transform + stroke.
  // Level 1 — TOPOLOGY: which canonical edges exist. This is the expensive pass
  // (four Set probes per clear tile) and it is stride-independent, so a zoom step
  // that changes LOD must not pay for it. Throttled, because the ship keeps
  // coasting and revealing tiles while the map sits open.
  _fogInkEdges() {
    const s = this.state, tiles = s.exploredTiles;
    const c = this._fogInkE;
    if (c && c.tiles === tiles && c.n === tiles.size) return c;
    if (c && s.t - c._at < 0.25) return c;
    const out = new Int32Array(Math.max(1024, tiles.size * 12));
    const kv = this._fogKV || (this._fogKV = [0, 0]);
    // Re-index into NUMERIC keys first. Four "tx,ty" concats per tile is ~65k
    // string builds on a well-explored save and dominated this pass 4:1; the
    // parse+rebuild pays for itself immediately.
    const K = 2097152, num = new Set(), pts = [];
    for (const key of tiles) {
      if (!this._fogKey(key, kv)) continue;
      num.add(kv[0] * K + kv[1]); pts.push(kv[0], kv[1]);
    }
    let n = 0;
    const push = (ex, ey, axis) => { out[n++] = ex; out[n++] = ey; out[n++] = axis; };
    for (let i = 0; i < pts.length; i += 2) {
      const tx = pts[i], ty = pts[i + 1], base = tx * K + ty;
      if (!num.has(base - 1)) push(tx, ty, 0);
      if (!num.has(base + 1)) push(tx, ty + 1, 0);
      if (!num.has(base - K)) push(tx, ty, 1);
      if (!num.has(base + K)) push(tx + 1, ty, 1);
    }
    this._fogInkE = { e: out, ne: n, tiles, n: tiles.size, _at: s.t };
    return this._fogInkE;
  },
  // Level 2 — SAMPLING: walk each cached edge at the current LOD. Cheap, so a
  // zoom step only pays this.
  _fogInkPts(stride) {
    const t = CONFIG.FOG_TILE;
    const eds = this._fogInkEdges();
    const c = this._fogInkC;
    if (c && c.eds === eds && c.stride === stride) return c;
    const world = (wx, wy) => ({ x: wx, y: wy });          // identity: stay in world space
    const per = Math.ceil(FOG_INK.NSEG / stride) + 3;
    const buf = new Float64Array(Math.max(4096, (eds.ne / 3) * per * 2 + 16));
    let n = 0;
    for (let i = 0; i < eds.ne; i += 3)
      n = this._fogEdgePts(eds.e[i], eds.e[i + 1], eds.e[i + 2], t, stride, world, buf, n);
    this._fogInkC = { pts: buf, np: n, eds, stride };
    return this._fogInkC;
  },

  _fogMapInk(g, m) {
    const s = this.state, t = CONFIG.FOG_TILE, tiles = s.exploredTiles;
    if (!tiles || !tiles.size) return;
    const edgeLen = t / (m && m.worldR || CONFIG.WORLD_RADIUS) * (m && m.scale || 1);
    const stride = edgeLen < 6 ? 12 : edgeLen < 20 ? 8 : edgeLen < 60 ? 4 : edgeLen < 160 ? 2 : 1;
    const cache = this._fogInkPts(stride);
    // inline mapPoint — an allocated {x,y} per point would be the new bottleneck
    const geo = this._mapGeom();
    const kx = geo.scale / geo.worldR;
    const ax = geo.cx - geo.focusX * kx, ay = geo.cy - geo.focusY * kx;
    const pad = t * 2;
    const vx0 = (0 - ax) / kx - pad, vx1 = (CONFIG.W - ax) / kx + pad;
    const vy0 = (0 - ay) / kx - pad, vy1 = (CONFIG.H - ay) / kx + pad;
    const src = cache.pts, out = this._fogBuf(cache.np);
    // transform run by run, dropping whole runs that fall off screen — at high
    // zoom that is nearly all of them
    let n = 0, i = 0;
    while (i < cache.np) {
      let j = i;
      while (j < cache.np && src[j] === src[j]) j += 2;     // run = up to the NaN marker
      let vis = false;
      for (let p = i; p < j; p += 2)
        if (src[p] >= vx0 && src[p] <= vx1 && src[p + 1] >= vy0 && src[p + 1] <= vy1) { vis = true; break; }
      if (vis) {
        for (let p = i; p < j; p += 2) { out[n++] = src[p] * kx + ax; out[n++] = src[p + 1] * kx + ay; }
        out[n++] = NaN; out[n++] = NaN;
      }
      i = j + 2;
    }
    const w = Math.max(0.9, Math.min(2.0, 0.9 + edgeLen * 0.012));
    this._fogEdgeStroke(g, out, n, w * 2.4, FOG_INK.edgeBleed);
    this._fogEdgeStroke(g, out, n, w, FOG_INK.edgeInk);
  },

  _mapFogFlatFallback(g) {
    const s = this.state, t = CONFIG.FOG_TILE, R = Math.ceil(CONFIG.WORLD_RADIUS / t);
    g.fillStyle = "rgba(5,7,13,0.5)";
    for (let tx = -R; tx <= R; tx++) for (let ty = -R; ty <= R; ty++) {
      if (s.exploredTiles.has(tx + "," + ty)) continue;
      const wx = tx * t, wy = ty * t;
      if (Math.hypot(wx, wy) > CONFIG.WORLD_RADIUS * 1.2) continue;
      const p1 = this.mapPoint(wx, wy), p2 = this.mapPoint(wx + t, wy + t);
      g.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }
  },

  fogSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state, t = CONFIG.FOG_TILE;
      // hash3 must be deterministic, in [0,1), and not biased low
      check(FOG_INK.hash3(3, 4, 5) === FOG_INK.hash3(3, 4, 5), "hash3 not deterministic");
      let hi = 0;
      for (let i = 0; i < 400; i++) { const v = FOG_INK.hash3(i, i * 7, 2); if (v >= 1 || v < 0) { fails.push("FAIL: hash3 out of range"); break; } if (v > 0.5) hi++; }
      check(hi > 140 && hi < 260, "hash3 badly biased (" + hi + "/400 above .5)");
      // the reveal is a BUBBLE: every cleared tile centre sits inside fogRevealR,
      // and the cleared span never approaches the old 6000u block
      const stx = Math.floor(s.x / t), sty = Math.floor(s.y / t);
      let minX = 1e9, maxX = -1e9, outside = 0;
      for (const key of s.exploredTiles) {
        const kv = [0, 0]; if (!this._fogKey(key, kv)) continue;
        minX = Math.min(minX, kv[0]); maxX = Math.max(maxX, kv[0]);
        const dx = kv[0] * t + t / 2 - s.x, dy = kv[1] * t + t / 2 - s.y;
        if (Math.hypot(dx, dy) > CONFIG.fogRevealR + t) outside++;
      }
      check(outside === 0, outside + " revealed tiles lie outside the reveal bubble");
      check((maxX - minX + 1) * t <= CONFIG.fogRevealR * 2 + 2 * t,
        "reveal spans " + ((maxX - minX + 1) * t) + "u — wider than the bubble");
      check(CONFIG.fogRevealR * 2 < 1600, "reveal bubble must stay well inside a screen of world");

      // three tiers resolve correctly through the sparse window
      const win = this._fogWin(stx - 40, stx + 40, sty - 40, sty + 40);
      check(!!win, "fog window not built");
      check(this._fogStateAt(win, stx, sty) === this.FOG_CLEAR, "start tile should be CLEAR");
      const farTx = stx + 30, farTy = sty + 30;
      check(this._fogStateAt(win, farTx, farTy) === this.FOG_UNKNOWN, "far tile should be UNKNOWN");
      // surveying a region flips its tiles to SCANNED WITHOUT clearing them
      const far = this.regionAt(farTx * t + t / 2, farTy * t + t / 2);
      if (far) {
        s.scannedRegions.add(far.id);
        const win2 = this._fogWin(stx - 40, stx + 40, sty - 40, sty + 40);
        check(this._fogStateAt(win2, farTx, farTy) === this.FOG_SCANNED, "surveyed tile should be SCANNED");
        check(!s.exploredTiles.has(farTx + "," + farTy), "a survey must not clear fog");
        s.scannedRegions.delete(far.id);
      }
      // the poison key onboarding injects must never parse as a tile
      check(this._fogKey("merc-probe-tile", [0, 0]) === false, "probe key must be rejected");
      check(this._fogKey("3,-4", [0, 0]) === true, "a real tile key must parse");
      // edge points: endpoints are pinned to the shared jittered vertex
      const out = new Float64Array(256);
      const id = (x, y) => ({ x, y });
      const nA = this._fogEdgePts(2, 3, 1, 2000, 1, id, out, 0);      // left side of (2,3)
      const ax = out[0], ay = out[1], bx2 = out[nA - 4], by2 = out[nA - 3];
      const out2 = new Float64Array(256);
      const nB = this._fogEdgePts(2, 4, 1, 2000, 1, id, out2, 0);      // the edge below it
      check(Math.abs(out2[0] - bx2) < 1e-6 && Math.abs(out2[1] - by2) < 1e-6,
        "adjacent frontier edges must share an endpoint exactly (gap at the corner)");
      check(ax === 2 * 2000 + FOG_INK.vjx(2, 3, 2000), "edge start must sit on the jittered lattice vertex");
      check(nB > 0, "edge produced no points");
    } catch (e) { fails.push("FAIL: fogSelfTest threw: " + (e && e.message)); }
    return fails;
  },
});
