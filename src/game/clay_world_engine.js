/*=== HARNESS:CLAY_WORLD_ENGINE ================================================
 * Procedural ISO clay world generation + paint engine.
 *
 * LOCKED contract for all clay-diorama planets. One engine, many world recipes.
 * planet_surface.js owns gameplay (farm, ship, city interaction); this module
 * owns:
 *   - recipe normalization / validation
 *   - generation knobs (elevation drama, node sizes, deco density, landmarks)
 *   - 100% procedural ground paint (no tilesets / slabs)
 *   - cliff / water / shore paint
 *
 * Adding a world = write a recipe (palette + port/city + proc knobs), set
 * ground:'diorama'. Do NOT fork paint code per planet.
 *
 *   ClayWorldEngine.VERSION / .LAYOUT_V
 *   ClayWorldEngine.normalizeRecipe(raw)
 *   ClayWorldEngine.isDiorama(def)
 *   ClayWorldEngine.drawCell(ctx) / .drawCliff(ctx) / .drawShoreFoam(ctx)
 *   ClayWorldEngine.nodeScale(type,x,y,proc)
 *   ClayWorldEngine.selfTest()
 *============================================================================*/

const ClayWorldEngine = (() => {
  // Bump VERSION when the public API / recipe schema changes incompatibly.
  // Bump LAYOUT_V when generated layout shape changes (planet_surface reseed).
  const VERSION = 6;
  // 20: remove experimental moon sandbox/megatile/paint forks
  const LAYOUT_V = 20;
  const ENGINE_ID = "ClayWorldEngine";

  // Shared tile / biome IDs (must match planet_surface.js)
  const T_WATER = 0, T_GRASS = 1, T_ROAD = 2;
  const B_GRASS = 0, B_JUNGLE = 1, B_DESERT = 2, B_MOUNTAIN = 3;

  // Multi-tile landmark footprints [minTiles, maxTiles] — diameter of collidable range
  const LANDMARK_FOOTPRINT = Object.freeze({
    mountain: Object.freeze([7, 11]),
    volcano:  Object.freeze([8, 12]),
    mesa:     Object.freeze([5, 8]),
    ridge:    Object.freeze([6, 10]),
    dune:     Object.freeze([5, 9]),
    boulder:  Object.freeze([2, 4]),
  });

  // Deco keys that should FILL the iso tile (full diamond cover, not a speck)
  const FULL_TILE_DECO = Object.freeze([
    "grass_tuft_a", "grass_tuft_b", "flower_white", "flower_pink",
    "reed_clump", "bush_round",
  ]);

  // ── Default procedural knobs (high-quality clay diorama baseline) ─────────
  // Worlds override via recipe.proc — never by editing paint code.
  const DEFAULT_PROC = Object.freeze({
    // Elevation
    elevDramatic: true,
    elevMountainBoost: 0.28,
    elevJungleSink: 0.10,
    // thresholds for elev tiers 2 / 3 / 4 (else 1). Dramatic worlds use lower cuts.
    elevThresholds: Object.freeze([0.50, 0.66, 0.84]),
    elevThresholdsCalm: Object.freeze([0.56, 0.72, 0.88]),

    // Ground look: seamless sprite carpet (no visible iso grid)
    seamlessSprite: true,     // hide diamond/grout; paint overlapping ground sprites
    groundOverlap: 1.38,      // heavy bleed — kills residual iso grid
    groundJitter: true,       // second sprite pass with sub-tile offset
    carpetAll: true,          // every land/water/road cell gets a ground sprite
    // Deco size mix: most mid-sized so player is visible; some stay huge for
    // "tiny explorer on alien world" feel. Values are multipliers on tile fill.
    decoDense: 2.0,
    decoSizeMin: 0.45,        // ~50% of previous full-tile bulk
    decoSizeMax: 0.75,        // common shrubs/grass
    decoHeroChance: 0.18,     // chance a prop stays LARGE (1.1–1.35 tile fill)
    decoHeroMin: 1.05,
    decoHeroMax: 1.35,
    decoFullTile: true,
    decoTileFill: 1.0,        // base fill before size roll
    decoMirror: true,         // hash-flip props for free variety

    // Resource node base widths (world-px before zoom) × nodeScale.
    // UNIT: explorer avatar is ~34 world-px tall at z=1. Use that as the ruler:
    //   rock  ≈ 1.5–2.5 players (looks good — leave nodeBaseRock alone)
    //   tree  ≈ 2.0–3.2 players typical, ~4 players for rare giants
    //   (was base 140 × 1.6–5.2 → trees filled half the screen; too big)
    nodeBaseTree: 78,
    nodeBaseRock: 64,
    nodeBaseBerry: 52,
    rockScale: Object.freeze([0.9, 2.5]),
    treeScale: Object.freeze([0.90, 1.40]),  // ~70–110 px @ z=1
    treeGiantChance: 0.05,                  // rare taller specimens only
    treeGiantScale: Object.freeze([1.55, 1.95]), // ~120–150 px — impressive, not absurd
    berryScale: Object.freeze([0.9, 1.5]),

    // Multi-tile landmarks + clusters
    landmarkN: 5,             // fewer but MUCH bigger ranges
    landmarkSizeMin: 1.0,
    landmarkSizeMax: 1.6,     // visual height multiplier on top of footprint
    landmarkClusterMin: 2,    // mountains clump together
    landmarkClusterMax: 4,
    landmarkMinSep: 10,       // clusters keep space between ranges
    landscapeN: 3,            // large backdrop vista pieces (no collision)

    // Water presentation
    waterIsLava: false,

    // Clay paint geometry
    clayInset: 0.93,          // top-face shrink → visible grout seams
    thickMul: 0.48,           // lip thickness vs tile half-height
    fleckGrass: false,        // real props fill tiles now; flecks optional
  });

  // Themes — starting points for new worlds (merge into recipe.proc)
  const THEMES = Object.freeze({
    temperate: {
      elevDramatic: true, decoDense: 1.55, waterIsLava: false,
      landmarkN: 5, landscapeN: 3, decoFullTile: true,
    },
    volcanic: {
      elevDramatic: true, elevMountainBoost: 0.34, decoDense: 1.0,
      waterIsLava: true, fleckGrass: false,
      rockScale: [1.0, 2.6], landmarkN: 4, landscapeN: 4,
      landmarkClusterMin: 2, landmarkClusterMax: 5,
    },
    ice: {
      elevDramatic: true, elevMountainBoost: 0.30, decoDense: 1.1,
      waterIsLava: false, fleckGrass: false,
      treeScale: [1.0, 1.8], landmarkN: 5, landscapeN: 4,
    },
    desert: {
      elevDramatic: false, decoDense: 0.9, waterIsLava: false, fleckGrass: false,
      rockScale: [0.9, 2.2], landmarkN: 5, landscapeN: 3,
    },
    barren: {
      elevDramatic: true, decoDense: 0.7, fleckGrass: false,
      rockScale: [1.0, 2.5], treeScale: [0.8, 1.2],
      landmarkN: 4, landscapeN: 3,
    },
  });

  // Required top-level recipe fields for a landable clay world
  const REQUIRED = ["name", "biomeLO", "biomeHI", "water", "road", "crops"];

  // ── Math / color helpers (self-contained — no PLANET dependency) ──────────
  // Stable uint32 hash — Math.imul keeps mixes in 32-bit (plain * drifts to float
  // and biased every sample below 0.5, which broke flip + giant rolls).
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = (h ^ 0x5bf03635) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function darker(col, f) {
    if (col && col[0] === "#" && col.length >= 7) {
      const n = parseInt(col.slice(1, 7), 16);
      return `rgb(${(((n >> 16) & 255) * f) | 0},${(((n >> 8) & 255) * f) | 0},${((n & 255) * f) | 0})`;
    }
    const m = (col || "").match(/\d+/g);
    if (!m || m.length < 3) return col;
    return `rgb(${(m[0] * f) | 0},${(m[1] * f) | 0},${(m[2] * f) | 0})`;
  }

  function shadeRgb(col, f) {
    if (col && col[0] === "#" && col.length >= 7) {
      const n = parseInt(col.slice(1, 7), 16);
      const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
      const g0 = Math.min(255, ((n >> 8) & 255) * f) | 0;
      const b = Math.min(255, (n & 255) * f) | 0;
      return `rgb(${r},${g0},${b})`;
    }
    const m = (col || "").match(/\d+/g);
    if (!m || m.length < 3) return col;
    return `rgb(${Math.min(255, m[0] * f) | 0},${Math.min(255, m[1] * f) | 0},${Math.min(255, m[2] * f) | 0})`;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── Recipe API ────────────────────────────────────────────────────────────
  function isDiorama(def) {
    return !!(def && def.ground === "diorama");
  }
  function isSoftGround(def) {
    return !!(def && (def.ground === "diorama" || def.ground === "clay"));
  }

  /**
   * Merge theme + proc overrides into a frozen-safe proc knobs object.
   * Accepts arrays (rockScale etc.) as mutable copies for safety.
   */
  function mergeProc(partial, themeName) {
    const theme = (themeName && THEMES[themeName]) || {};
    const src = Object.assign({}, DEFAULT_PROC, theme, partial || {});
    // clone arrays so callers can't mutate DEFAULT_PROC
    src.elevThresholds = (src.elevThresholds || DEFAULT_PROC.elevThresholds).slice();
    src.elevThresholdsCalm = (src.elevThresholdsCalm || DEFAULT_PROC.elevThresholdsCalm).slice();
    src.rockScale = (src.rockScale || DEFAULT_PROC.rockScale).slice();
    src.treeScale = (src.treeScale || DEFAULT_PROC.treeScale).slice();
    src.berryScale = (src.berryScale || DEFAULT_PROC.berryScale).slice();
    return src;
  }

  /**
   * Normalize a world recipe. Call once when registering a planet def.
   * Returns a new object; does not freeze (planet_surface may still attach runtime fields).
   */
  function normalizeRecipe(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error(ENGINE_ID + ".normalizeRecipe: expected object recipe");
    }
    const out = Object.assign({}, raw);
    for (const k of REQUIRED) {
      if (out[k] == null) throw new Error(ENGINE_ID + ": recipe missing required field '" + k + "'");
    }
    if (!Array.isArray(out.biomeLO) || out.biomeLO.length < 4)
      throw new Error(ENGINE_ID + ": biomeLO needs 4 biome colors [grass,jungle,desert,mountain]");
    if (!Array.isArray(out.biomeHI) || out.biomeHI.length < 4)
      throw new Error(ENGINE_ID + ": biomeHI needs 4 biome colors");
    if (!Array.isArray(out.water) || out.water.length < 2)
      throw new Error(ENGINE_ID + ": water needs [mid, deep] colors");
    if (!Array.isArray(out.crops) || !out.crops.length)
      throw new Error(ENGINE_ID + ": crops needs at least one native seed key");

    // Ground default for new clay worlds is diorama (locked engine path)
    if (!out.ground) out.ground = "diorama";

    out.glint = out.glint || "#E8F6FF";
    out.propset = out.propset || "mira";
    out.nodeset = out.nodeset || out.propset || "mira";
    out.bldgset = out.bldgset || out.propset || "mira";
    out.tileset = out.tileset || out.propset || "mira"; // legacy path only
    out.landmarks = out.landmarks || ["mesa", "boulder", "ridge"];
    out.landmarkEmoji = out.landmarkEmoji || {};
    out.port = out.port || { flip: false, hangars: 2 };
    out.city = out.city || { pattern: "grid", monument: "obelisk", skyline: "towers" };

    out.proc = mergeProc(out.proc, out.theme);
    // landmarkN: recipe top-level wins, else proc
    if (out.landmarkN == null) out.landmarkN = out.proc.landmarkN;

    out._engine = ENGINE_ID;
    out._engineVersion = VERSION;
    return out;
  }

  /**
   * Build a recipe from a short description — preferred way to author new worlds.
   *   ClayWorldEngine.makeRecipe({
   *     id:'ember', name:'Ember', theme:'volcanic',
   *     biomeLO:[...], biomeHI:[...], water:[...], road:'#…', crops:['…'],
   *     …port/city/landmarks…
   *   })
   */
  function makeRecipe(spec) {
    const raw = Object.assign({ ground: "diorama" }, spec);
    delete raw.id; // id is the PLANET_DEFS key, not stored on the def
    return normalizeRecipe(raw);
  }

  // ── Generation helpers (used inside genWorld) ─────────────────────────────
  function elevTier(noiseVal, biome, proc) {
    let e = noiseVal;
    if (biome === B_MOUNTAIN) e += proc.elevMountainBoost;
    else if (biome === B_JUNGLE) e -= proc.elevJungleSink;
    const th = proc.elevDramatic ? proc.elevThresholds : proc.elevThresholdsCalm;
    if (e > th[2]) return 4;
    if (e > th[1]) return 3;
    if (e > th[0]) return 2;
    return 1;
  }

  function nodeScale(type, x, y, proc) {
    const p = proc || DEFAULT_PROC;
    if (type === "tree") {
      // Independent roll so giant chance isn't coupled to size hash
      const giantRoll = hash2(x * 41 + 3, y * 37 + 7);
      if (giantRoll < (p.treeGiantChance != null ? p.treeGiantChance : 0.05)) {
        const g = p.treeGiantScale || [1.55, 1.95];
        const u = hash2(x * 17, y * 19);
        return g[0] + u * (g[1] - g[0]);
      }
      const range = p.treeScale || [0.90, 1.40];
      const t = hash2(x * 5 + 1, y * 9 + 2);
      return range[0] + t * (range[1] - range[0]);
    }
    const t = hash2(x * (type === "rock" ? 11 : 5) + 1, y * (type === "rock" ? 13 : 9) + 2);
    let range;
    if (type === "rock") range = p.rockScale;
    else if (type === "berry") range = p.berryScale;
    else range = [0.85, 1.3];
    return range[0] + t * (range[1] - range[0]);
  }

  function decoSize(x, y, proc) {
    const p = proc || DEFAULT_PROC;
    // Independent hero roll
    const heroRoll = hash2(x * 19 + 1, y * 23 + 4);
    if (heroRoll < (p.decoHeroChance != null ? p.decoHeroChance : 0.18)) {
      const u = hash2(x * 3, y * 23);
      const lo = p.decoHeroMin || 1.05, hi = p.decoHeroMax || 1.35;
      return lo + u * (hi - lo);
    }
    const t = hash2(x * 11 + 7, y * 13 + 5);
    const lo = p.decoSizeMin != null ? p.decoSizeMin : 0.45;
    const hi = p.decoSizeMax != null ? p.decoSizeMax : 0.75;
    return lo + t * (hi - lo);
  }

  /** Hash-stable mirror pick for free prop variety (~50%). */
  function decoFlip(x, y, proc) {
    if (proc && proc.decoMirror === false) return false;
    return hash2(x * 31 + 2, y * 17 + 5) >= 0.5;
  }

  function landmarkSizeMul(rnd, proc) {
    const p = proc || DEFAULT_PROC;
    const r = typeof rnd === "function" ? rnd() : hash2((rnd | 0) * 3, 17);
    return p.landmarkSizeMin + r * (p.landmarkSizeMax - p.landmarkSizeMin);
  }

  /** Tile diameter for a landmark type (multi-tile ranges). */
  function landmarkFootprintTiles(key, rnd, proc) {
    const range = LANDMARK_FOOTPRINT[key] || LANDMARK_FOOTPRINT.mesa;
    const r = typeof rnd === "function" ? rnd() : 0.5;
    return Math.round(range[0] + r * (range[1] - range[0]));
  }

  /** Collision: elliptical footprint around center (tile coords). */
  function landmarkBlocks(L, px, py) {
    if (!L || !L.collide) return false;
    const hw = (L.w || L.r * 2 || 2) * 0.48;
    const hh = (L.h || L.w || L.r * 2 || 2) * 0.48;
    if (hw < 0.3 || hh < 0.3) return Math.hypot(px - L.x, py - L.y) < (L.r || 1.2);
    const dx = (px - L.x) / hw;
    const dy = (py - L.y) / hh;
    return dx * dx + dy * dy <= 1;
  }

  /**
   * Display width for a deco prop in world-px (before zoom).
   * Full-tile keys span ~2*ISO_HW so they carpet the diamond.
   */
  function decoDisplayW(key, s, ISO_HW, proc) {
    const p = proc || DEFAULT_PROC;
    const scale = s == null ? 1 : s;
    if (p.decoFullTile && FULL_TILE_DECO.indexOf(key) >= 0) {
      return 2 * ISO_HW * (p.decoTileFill || 1.05) * scale;
    }
    // smaller ambient props still chunky
    const base = {
      pebble_cluster: ISO_HW * 1.1,
      stone_mossy: ISO_HW * 1.25,
      stump_small: ISO_HW * 1.15,
    };
    return (base[key] || ISO_HW * 1.0) * scale;
  }

  function nodeBaseW(type, proc) {
    const p = proc || DEFAULT_PROC;
    if (type === "tree") return p.nodeBaseTree || 70;
    if (type === "rock") return p.nodeBaseRock || 58;
    if (type === "berry") return p.nodeBaseBerry || 48;
    return 50;
  }

  /**
   * Procedural multi-tile mountain / mesa mass (when PNG missing or as clay body).
   * Draws several stacked iso peaks filling the footprint so it reads as a range.
   * ctx: { g, sx, sy, z, ISO_HW, ISO_HH, L, ink, isoBox }
   */
  function drawLandmarkMass(ctx) {
    const { g, sx, sy, z, ISO_HW: IHW, ISO_HH: IHH, L, ink, isoBox } = ctx;
    if (!L) return;
    const tiles = Math.max(L.w || 4, L.h || 4);
    const sm = L.sizeMul || 1;
    const key = L.key || "mountain";
    // Palette by type
    let topC = "#C4A882", midC = "#9A7A58", dkC = "#6E5640";
    if (key === "ridge" || key === "mountain") { topC = "#B8B0A4"; midC = "#8A8478"; dkC = "#5C564C"; }
    if (key === "volcano") { topC = "#6A5048"; midC = "#4A3830"; dkC = "#2E2420"; }
    if (key === "dune") { topC = "#E8CC88"; midC = "#C8A860"; dkC = "#A08040"; }
    if (key === "boulder") { topC = "#B0A898"; midC = "#888078"; dkC = "#5C564E"; }

    // Shadow under the whole mass
    const spanW = tiles * IHW * z * 0.55;
    const spanH = tiles * IHH * z * 0.55;
    g.save(); g.globalAlpha = 0.22; g.fillStyle = "#101018";
    g.beginPath(); g.ellipse(sx, sy + 6 * z, spanW * 0.95, spanH * 0.75, 0, 0, Math.PI * 2); g.fill();
    g.restore();

    // Peak count scales with footprint — clustered massifs
    const peaks = Math.max(3, Math.min(9, (tiles / 2) | 0));
    for (let i = 0; i < peaks; i++) {
      const u = hash2(L.x * 13 + i, L.y * 7 + i * 3);
      const v = hash2(L.x * 5 + i * 2, L.y * 11 + i);
      const ox = (u - 0.5) * spanW * 1.1;
      const oy = (v - 0.5) * spanH * 0.9;
      const peakScale = (0.55 + u * 0.55) * sm;
      const phw = IHW * z * 0.55 * peakScale * (tiles / 6);
      const phh = IHH * z * 0.55 * peakScale * (tiles / 6);
      const pbh = (18 + tiles * 4.5 * peakScale) * z * sm;
      // Draw back peaks first (higher oy = more south = in front in iso… invert)
      if (typeof isoBox === "function") {
        isoBox(g, sx + ox, sy + oy, phw, phh, pbh, topC, midC, dkC, ink || "#2a2418");
      } else {
        // Fallback triangle peak
        g.fillStyle = topC;
        g.beginPath();
        g.moveTo(sx + ox, sy + oy - pbh);
        g.lineTo(sx + ox + phw, sy + oy);
        g.lineTo(sx + ox - phw, sy + oy);
        g.closePath(); g.fill();
      }
    }
    // Volcano glow core
    if (key === "volcano") {
      g.save();
      g.globalAlpha = 0.45;
      g.fillStyle = "#FF6A20";
      g.beginPath(); g.ellipse(sx, sy - tiles * 3 * z * sm, 8 * z * sm, 5 * z * sm, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  // ── Paint (locked diorama look) ───────────────────────────────────────────
  /**
   * Clay diamond: top face + thickness lip.
   * @param {CanvasRenderingContext2D} g
   * @param {number} sx,sy center
   * @param {number} hw,hh half extents
   * @param {number} thick lip height in px
   * @param {string} topC,lipL,lipR colors
   * @param {number} edgeA edge alpha 0–1
   * @param {number} [inset=0.94] top-face shrink for grout seams
   */
  function clayDiamond(g, sx, sy, hw, hh, thick, topC, lipL, lipR, edgeA, inset) {
    const ins = inset == null ? 0.94 : inset;
    const thw = hw * ins, thh = hh * ins;
    if (thick > 0.4) {
      g.beginPath();
      g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + thick); g.lineTo(sx - hw, sy + thick);
      g.closePath(); g.fillStyle = lipL; g.fill();
      g.beginPath();
      g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + thick); g.lineTo(sx + hw, sy + thick);
      g.closePath(); g.fillStyle = lipR; g.fill();
      g.beginPath();
      g.moveTo(sx - hw, sy); g.lineTo(sx, sy - hh); g.lineTo(sx, sy - hh + thick * 0.35); g.lineTo(sx - hw, sy + thick * 0.35);
      g.closePath(); g.fillStyle = lipL; g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
    }
    g.beginPath();
    g.moveTo(sx, sy - thh); g.lineTo(sx + thw, sy); g.lineTo(sx, sy + thh); g.lineTo(sx - thw, sy);
    g.closePath();
    g.fillStyle = topC; g.fill();
    if (edgeA > 0.01) {
      g.save();
      g.globalAlpha = Math.min(0.55, edgeA + 0.08);
      g.strokeStyle = "rgba(48,38,24,0.45)";
      g.lineWidth = Math.max(0.5, 0.7 * (hw / 40));
      g.stroke();
      g.globalAlpha = edgeA * 0.65;
      g.strokeStyle = "rgba(255,250,230,0.65)";
      g.beginPath();
      g.moveTo(sx - thw * 0.75, sy - thh * 0.05);
      g.lineTo(sx, sy - thh);
      g.lineTo(sx + thw * 0.3, sy - thh * 0.5);
      g.stroke();
      g.restore();
    }
  }

  /**
   * Pick ground carpet sprite key for a cell (slab_* art — clay objects, not flat tiles).
   * set = propset / planet art pack name.
   */
  function carpetSpriteKey(set, ttype, tilled, crop, bio, tx, ty, worldType) {
    const s = set || "mira";
    if (ttype === T_WATER) return "slab_" + s + "_water";
    if (ttype === T_ROAD) return "slab_" + s + "_stone_path";
    if (tilled) {
      if (crop && crop.ripe) return "slab_" + s + "_soil_harvest";
      if (crop) return "slab_" + s + "_soil_seedling";
      return "slab_" + s + "_soil_tilled";
    }
    // Moon: dirt/regolith only — avoid grass_* keys that read as meadow
    if (worldType === "moon") {
      const hv = hash2(tx, ty);
      if (hv > 0.78) return "slab_" + s + "_dirt_b";
      if (hv > 0.42) return "slab_" + s + "_dirt";
      if (hv > 0.18) return "slab_" + s + "_dirt_b";
      return "slab_" + s + "_dirt";
    }
    if (bio === B_DESERT || bio === B_MOUNTAIN) {
      return hash2(tx + 3, ty + 9) > 0.5 ? "slab_" + s + "_dirt_b" : "slab_" + s + "_dirt";
    }
    const hv = hash2(tx, ty);
    if (hv > 0.88) return "slab_" + s + "_grass_flowers";
    if (hv > 0.62) return "slab_" + s + "_grass_b";
    if (hv > 0.38) return "slab_" + s + "_grass_c";
    return "slab_" + s + "_grass_a";
  }

  /**
   * Soft continuous underpaint — ELLIPSE not diamond so the iso grid never
   * imprints through the sprite carpet.
   */
  function softBlob(g, sx, sy, hw, hh, col) {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(sx, sy, hw * 1.05, hh * 1.15, 0, 0, Math.PI * 2);
    g.fill();
  }

  /**
   * Paint one ground cell.
   * Seamless sprite mode (default): overlapping clay SLAB sprites so the iso
   * grid is invisible — every surface is art, not a diamond fill.
   * ctx: {
   *   g, sx, sy, z, ISO_HW, ISO_HH,
   *   col, ttype, tilled, crop:{ripe,watered}|null, bio, tx, ty, elev,
   *   def, frame, ART  (optional ART with drawSlab/slabReady)
   * }
   */
  function drawCell(ctx) {
    const {
      g, sx, sy, z, ISO_HW: IHW, ISO_HH: IHH,
      col, ttype, tilled, crop, bio, tx, ty, elev, def, frame, ART,
    } = ctx;
    const proc = (def && def.proc) || DEFAULT_PROC;
    const seamless = proc.seamlessSprite !== false;
    const ov = seamless ? (proc.groundOverlap || 1.18) : 1.0;
    const hw = IHW * z * ov, hh = IHH * z * ov;
    const micro = hash2(tx * 3 + 1, ty * 5 + 2);
    const t = frame || 0;
    const set = (def && (def.propset || def.tileset)) || "mira";

    // Continuous soft underpaint — ellipses, not diamonds
    let under = col || "#6EA843";
    if (def && def.worldType === "moon") {
      under = (ttype === T_WATER) ? "#0A0A0E"
        : (ttype === T_ROAD) ? "#7A828C"
        : (tilled) ? "#3A3836"
        : "#5A5856";
    }
    softBlob(g, sx, sy, hw, hh, under);
    if (seamless) {
      g.save(); g.globalAlpha = 0.45;
      softBlob(g, sx + (micro - 0.5) * IHW * z * 0.3, sy + (hash2(tx, ty) - 0.5) * IHH * z * 0.3,
        hw * 1.05, hh * 1.05, shadeRgb(under, 0.97 + micro * 0.08));
      g.restore();
    }

    // ── SPRITE CARPET (primary look) ────────────────────────────────────────
    let drewSprite = false;
    if (ART && typeof ART.drawSlab === "function") {
      let key = carpetSpriteKey(set, ttype, tilled, crop, bio, tx, ty, def && def.worldType);
      const earthLike = !set || set === "mira";
      if ((!ART.slabReady || !ART.slabReady(key)) && earthLike) {
        key = key.replace("slab_" + set + "_", "slab_mira_");
      }
      if (ART.slabReady && ART.slabReady(key)) {
        const ghw = IHW * z * ov, ghh = IHH * z * ov;
        drewSprite = !!ART.drawSlab(g, key, sx, sy, ghw, ghh, null);
        if (drewSprite && seamless && proc.groundJitter !== false) {
          const jx = (hash2(tx * 9, ty * 4) - 0.5) * IHW * z * 0.35;
          const jy = (hash2(tx * 2, ty * 11) - 0.5) * IHH * z * 0.35;
          g.save(); g.globalAlpha = 0.55;
          ART.drawSlab(g, key, sx + jx, sy + jy, ghw * 0.95, ghh * 0.95, null);
          g.restore();
        }
      }
    }

    // Water shimmer
    if (ttype === T_WATER) {
      if (def && def.worldType === "moon") {
        g.save();
        g.globalAlpha = 0.35;
        g.fillStyle = "#050508";
        g.beginPath();
        g.ellipse(sx, sy, hw * 0.95, hh * 1.05, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        return;
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + tx * 0.4 + ty * 0.35);
      g.save();
      g.globalAlpha = 0.16 + 0.10 * pulse;
      g.fillStyle = (def && def.glint) || "#E8F6FF";
      g.beginPath();
      g.ellipse(sx - hw * 0.08, sy - hh * 0.08, hw * 0.35, hh * 0.28, -0.35, 0, Math.PI * 2);
      g.fill();
      g.restore();
      return;
    }


    // Farm furrow marks on top of soil sprite
    if (tilled) {
      g.save();
      g.globalAlpha = 0.40;
      g.strokeStyle = "#4A3018";
      g.lineWidth = Math.max(0.8, 1.2 * z);
      for (let f = -2; f <= 2; f++) {
        g.beginPath();
        g.moveTo(sx - IHW * z * 0.55, sy + f * IHH * z * 0.20);
        g.lineTo(sx + IHW * z * 0.55, sy + f * IHH * z * 0.20 + IHW * z * 0.02);
        g.stroke();
      }
      g.restore();
      if (crop && crop.watered) {
        g.save(); g.globalAlpha = 0.28; g.fillStyle = "#2b6fb0";
        g.beginPath(); g.ellipse(sx, sy + 1 * z, IHW * z * 0.42, IHH * z * 0.38, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      return;
    }

    // If sprites failed to load, keep soft continuous fill only (no diamond edges)
    if (!drewSprite && !seamless) {
      // legacy path with clay diamond (only if seamless disabled)
      const thick = Math.max(3.0 * z, hh * (proc.thickMul || 0.48));
      clayDiamond(g, sx, sy, IHW * z, IHH * z, thick, under,
        darker(under, 0.76), darker(under, 0.62), 0.12, proc.clayInset);
    }
  }

  function drawCliff(ctx) {
    const { g, sx, sy, z, ISO_HW: IHW, ISO_HH: IHH, col, ch, face, waterfall, lava, frame, ART } = ctx;
    if (ch < 1.5) return;
    const hw = IHW * z * 1.08, hh = IHH * z * 1.08; // slight overflow hides cliff tile edges
    // Earthy rock (planets) / basalt grey (moon) — not grass-colored
    const lunar = (ctx.def && ctx.def.worldType === 'moon');
    const pack = (ctx.def && (ctx.def.propset || ctx.def.tileset)) || "mira";
    const rockMid = lunar ? "#6A6864" : "#8A7060";
    const rockDk = lunar ? "#2E2C2A" : "#5C4A40";
    const rockDeep = lunar ? "#141312" : "#3A2C24";
    const rockTop = lunar ? "#A8A49C" : "#B09880";
    const rockHi = lunar ? "#C8C4BC" : "#C8B090";

    // Contact shadow where wall meets lower ground (grounds the cliff)
    g.save();
    g.globalAlpha = lunar ? 0.45 : 0.28;
    g.fillStyle = "#000000";
    if (face === "S") {
      g.beginPath();
      g.ellipse(sx, sy + hh + ch + 2 * z, hw * 0.95, hh * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.ellipse(sx + hw * 0.35, sy + hh + ch * 0.55, hw * 0.35, ch * 0.35, 0.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // Textured cliff panel (Selene and any pack with cliff_<pack>_s/e)
    const cliffKey = "cliff_" + pack + "_" + (face === "S" ? "s" : "e");
    const cliffIm = (ART && ART.get) ? ART.get(cliffKey) : null;
    if (cliffIm && cliffIm.naturalWidth) {
      g.save();
      g.beginPath();
      if (face === "S") {
        g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx - hw, sy + ch);
        g.closePath();
        g.clip();
        // Cover left facet + bleed into center
        g.globalAlpha = 0.95;
        g.drawImage(cliffIm, sx - hw, sy, hw * 1.05, hh + ch + 2 * z);
        g.restore();
        g.save();
        g.beginPath();
        g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch);
        g.closePath();
        g.clip();
        g.globalAlpha = 0.88;
        // Slightly darker on the right facet
        g.drawImage(cliffIm, sx - hw * 0.15, sy, hw * 1.2, hh + ch + 2 * z);
        g.fillStyle = "rgba(0,0,0,0.22)";
        g.fillRect(sx - hw * 0.15, sy, hw * 1.2, hh + ch + 2 * z);
      } else {
        g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch);
        g.closePath();
        g.clip();
        g.globalAlpha = 0.92;
        g.drawImage(cliffIm, sx, sy, hw * 1.15, hh + ch + 2 * z);
        g.fillStyle = "rgba(0,0,0,0.18)";
        g.fillRect(sx, sy, hw * 1.15, hh + ch + 2 * z);
      }
      g.restore();
      // Top lip highlight
      g.save();
      g.globalAlpha = 0.45;
      g.strokeStyle = rockHi;
      g.lineWidth = Math.max(0.8, 1.2 * z);
      g.beginPath();
      if (face === "S") {
        g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx + hw, sy);
      } else {
        g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh);
      }
      g.stroke();
      g.restore();
      return;
    }

    if (face === "S") {
      // Left facet (lit) + right facet (shade) — basalt block look
      g.beginPath();
      g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx - hw, sy + ch);
      g.closePath(); g.fillStyle = rockMid; g.fill();
      g.beginPath();
      g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch);
      g.closePath(); g.fillStyle = rockDk; g.fill();
      // Deep base band (reads as thick rock mass)
      g.save(); g.globalAlpha = 0.55; g.fillStyle = rockDeep;
      g.beginPath();
      g.moveTo(sx - hw, sy + ch * 0.72); g.lineTo(sx + hw, sy + ch * 0.72);
      g.lineTo(sx + hw, sy + ch); g.lineTo(sx - hw, sy + ch);
      g.closePath(); g.fill(); g.restore();
    } else {
      g.beginPath();
      g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch);
      g.closePath(); g.fillStyle = rockDk; g.fill();
      g.save(); g.globalAlpha = 0.5; g.fillStyle = rockDeep;
      g.beginPath();
      g.moveTo(sx + hw * 0.15, sy + hh + ch * 0.65);
      g.lineTo(sx + hw, sy + ch * 0.65);
      g.lineTo(sx + hw, sy + ch);
      g.lineTo(sx, sy + hh + ch);
      g.closePath(); g.fill(); g.restore();
    }
    // Horizontal strata + highlight flecks (WC3-style cliff banding)
    g.save();
    g.globalAlpha = lunar ? 0.28 : 0.22;
    g.strokeStyle = rockTop;
    g.lineWidth = Math.max(0.6, 0.9 * z);
    const bands = Math.max(3, Math.min(7, (ch / (8 * z)) | 0));
    for (let k = 1; k <= bands; k++) {
      const yy = sy + hh + ch * (k / (bands + 1));
      const wobble = (hash2((sx * 0.1) | 0, k) - 0.5) * hw * 0.12;
      g.beginPath();
      if (face === "S") {
        g.moveTo(sx - hw * 0.92 + wobble, yy);
        g.lineTo(sx + hw * 0.92 + wobble * 0.5, yy + z);
      } else {
        g.moveTo(sx + hw * 0.1, yy);
        g.lineTo(sx + hw * 0.95, yy + z * 0.5);
      }
      g.stroke();
    }
    g.globalAlpha = 0.18;
    g.fillStyle = rockHi;
    for (let k = 0; k < 4; k++) {
      const yy = sy + hh + ch * ((k + 0.6) / 5);
      const rx = face === "S" ? sx - hw * 0.35 + k * hw * 0.22 : sx + hw * 0.45;
      g.beginPath(); g.ellipse(rx, yy, hw * 0.12, ch * 0.04, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // Top lip highlight (rim of the drop)
    g.save();
    g.globalAlpha = 0.4;
    g.strokeStyle = rockHi;
    g.lineWidth = Math.max(0.8, 1.2 * z);
    g.beginPath();
    if (face === "S") {
      g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx + hw, sy);
    } else {
      g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh);
    }
    g.stroke();
    g.restore();
    if (waterfall && ch > 5 && !lunar) {
      const t = frame || 0;
      g.save();
      g.globalAlpha = 0.38 + 0.16 * Math.sin(t * 4 + sx * 0.02);
      g.fillStyle = lava ? "#FF8C2A" : "#A8E0FF";
      const fw = hw * (face === "S" ? 0.24 : 0.16);
      const fx = face === "S" ? sx - fw * 0.5 : sx + hw * 0.2;
      g.fillRect(fx, sy + hh * 0.25, fw, ch + hh * 0.35);
      g.globalAlpha = 0.5;
      g.fillStyle = lava ? "#FFE080" : "#FFFFFF";
      g.fillRect(fx + fw * 0.28, sy + hh * 0.25, fw * 0.35, ch + hh * 0.35);
      g.restore();
    }
  }

  /** Shore foam on land tiles next to water. */
  function drawShoreFoam(ctx) {
    const { g, sx, sy, z, ISO_HW: IHW, ISO_HH: IHH, tx, frame } = ctx;
    g.save();
    g.globalAlpha = 0.22 + 0.08 * Math.sin((frame || 0) * 2.2 + tx);
    g.fillStyle = "#E8F6FF";
    g.beginPath();
    g.ellipse(sx, sy + IHH * z * 0.15, IHW * z * 0.28, IHH * z * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function isLavaWorld(def) {
    if (!def) return false;
    if (def.proc && def.proc.waterIsLava) return true;
    if ((def.tag || "").indexOf("volcan") >= 0) return true;
    if ((def.name || "") === "Cinder") return true;
    return false;
  }

  // ── Self-test (headless-safe) ─────────────────────────────────────────────
  function selfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: ClayWorldEngine " + m); };
    try {
      check(VERSION >= 1, "version");
      check(LAYOUT_V >= 8, "layout v");
      check(!!THEMES.temperate && !!THEMES.volcanic, "themes");

      // normalize happy path
      const r = normalizeRecipe({
        name: "Test", tag: "unit",
        biomeLO: ["#111111", "#222222", "#333333", "#444444"],
        biomeHI: ["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd"],
        water: ["#4FA9D8", "#2C6FA6"], road: "#B9AE97",
        crops: ["carrot"],
        ground: "diorama", theme: "temperate",
      });
      check(r.ground === "diorama", "default ground");
      check(r.proc && r.proc.decoDense > 0, "proc merged");
      check(r._engine === ENGINE_ID, "engine stamp");
      check(r._engineVersion === VERSION, "engine version stamp");

      // makeRecipe + theme
      const vol = makeRecipe({
        name: "Vol", theme: "volcanic",
        biomeLO: ["#5A4038", "#4A3028", "#6E5A46", "#3E3430"],
        biomeHI: ["#7A5A4C", "#684A3C", "#8E765C", "#5A4C44"],
        water: ["#E8752A", "#B8481A"], road: "#6E6258",
        crops: ["emberchili"],
      });
      check(vol.proc.waterIsLava === true, "volcanic lava flag");
      check(isDiorama(vol), "isDiorama");
      check(isSoftGround(vol), "isSoftGround");
      check(isLavaWorld(vol), "isLavaWorld");

      // node scale ranges
      let minR = 99, maxR = 0;
      for (let i = 0; i < 40; i++) {
        const s = nodeScale("rock", i, i * 3, r.proc);
        minR = Math.min(minR, s); maxR = Math.max(maxR, s);
      }
      check(minR >= r.proc.rockScale[0] - 0.01, "rock scale min");
      check(maxR <= r.proc.rockScale[1] + 0.01, "rock scale max");
      check(maxR > minR + 0.3, "rock scale variety");

      // elev tiers
      check(elevTier(0.9, B_MOUNTAIN, r.proc) === 4, "elev high mountain");
      check(elevTier(0.2, B_GRASS, r.proc) === 1, "elev low grass");

      // landmark sizes + multi-tile footprints
      const ls = landmarkSizeMul(() => 0.5, r.proc);
      check(ls >= r.proc.landmarkSizeMin && ls <= r.proc.landmarkSizeMax, "landmark size");
      const fp = landmarkFootprintTiles("mountain", () => 0.5, r.proc);
      check(fp >= 6 && fp <= 12, "mountain footprint multi-tile got " + fp);
      const fpB = landmarkFootprintTiles("boulder", () => 0.5, r.proc);
      check(fpB >= 2 && fpB <= 5, "boulder footprint");

      // collision ellipse
      const fakeL = { x: 10, y: 10, w: 8, h: 8, collide: true };
      check(landmarkBlocks(fakeL, 10, 10) === true, "blocks center");
      check(landmarkBlocks(fakeL, 10.5, 10.2) === true, "blocks near center");
      check(landmarkBlocks(fakeL, 20, 20) === false, "clear far away");

      // full-tile deco width
      const dw = decoDisplayW("grass_tuft_a", 1, 40, r.proc);
      check(dw >= 70, "grass fills tile-ish width got " + dw);
      check(nodeBaseW("tree", r.proc) >= 60, "tree base large");
      check(r.proc.seamlessSprite === true, "seamless sprite default");
      check(r.proc.carpetAll === true, "carpetAll default");
      const ck = carpetSpriteKey("mira", T_GRASS, false, null, B_GRASS, 3, 7);
      check(ck.indexOf("slab_mira_grass") === 0, "carpet grass key " + ck);
      check(carpetSpriteKey("mira", T_WATER, false, null, 0, 0, 0) === "slab_mira_water", "carpet water");

      // missing field should throw
      let threw = false;
      try { normalizeRecipe({ name: "X" }); } catch (e) { threw = true; }
      check(threw, "rejects incomplete recipe");

      // paint is callable headless (no-op-ish with stub ctx — just must not throw)
      if (typeof document === "undefined") {
        check(typeof clayDiamond === "function", "clayDiamond fn");
        check(typeof drawCell === "function", "drawCell fn");
        check(typeof drawLandmarkMass === "function", "drawLandmarkMass fn");
      }
    } catch (e) {
      fails.push("FAIL: ClayWorldEngine selfTest threw: " + (e && e.message));
    }
    return fails;
  }

  return {
    VERSION,
    LAYOUT_V,
    ENGINE_ID,
    T_WATER, T_GRASS, T_ROAD,
    B_GRASS, B_JUNGLE, B_DESERT, B_MOUNTAIN,
    DEFAULT_PROC,
    THEMES,
    LANDMARK_FOOTPRINT,
    FULL_TILE_DECO,
    hash2, darker, shadeRgb, lerp, clamp,
    isDiorama, isSoftGround, isLavaWorld,
    mergeProc, normalizeRecipe, makeRecipe,
    elevTier, nodeScale, decoSize, decoFlip, landmarkSizeMul,
    landmarkFootprintTiles, landmarkBlocks,
    decoDisplayW, nodeBaseW, drawLandmarkMass,
    carpetSpriteKey, softBlob,
    clayDiamond, drawCell, drawCliff, drawShoreFoam,
    selfTest,
  };
})();

// Browser / harness global (build.py concatenates; Node headless uses globalThis)
if (typeof globalThis !== "undefined") globalThis.ClayWorldEngine = ClayWorldEngine;
