/*=== HARNESS:ART ============================================================*/
// External AI-generated PNG art layer (sprites/*.png, served over HTTP right
// next to game.html — no base64). This is a SEPARATE system from the procedural
// bake `SPRITES` in config.js: SPRITES draws pseudo-3D fallback shapes on a
// canvas, ART blits real PNGs. Every ART draw SITE keeps its prior SPRITES /
// canvas draw as a fallback, so the headless selfTest (Image never loads) and
// the pre-load first frames still render correctly.
//
// Naming note: the integration brief called this global `SPRITES`, but that
// identifier is already the procedural system above — a second `const SPRITES`
// is a duplicate declaration that breaks the whole concatenated bundle. Renamed
// to `ART`; the draw-site snippets were adapted from `SPRITES[key]` to
// `ART.get(key)` / `ART.draw(...)`.
//
// The art was regenerated as 1280×720 side-view HERO SHOTS (not the square
// top-down sprites the manifest text describes), so ART.draw preserves each
// image's native aspect ratio and, for ships, mirrors vertically instead of
// rolling belly-up when the heading points left.
const ART_MANIFEST = {
  // Ships — gameplay (side-view hero shots, nose-right)
  ship_vulture: "sprites/vulture_tug.png",
  ship_atlas:   "sprites/atlas_freighter.png",
  ship_aegis:   "sprites/aegis_battlecruiser.png",
  ship_vex:     "sprites/vex_fighter.png",
  ship_krag:    "sprites/krag_raider.png",
  ship_nox:     "sprites/nox_phantom.png",
  ship_drone:   "sprites/companion_drone.png",
  // Ships — menu glamour shots
  ship_vulture_menu: "sprites/vulture_tug_menu.png",
  ship_atlas_menu:   "sprites/atlas_freighter_menu.png",
  ship_aegis_menu:   "sprites/aegis_battlecruiser_menu.png",
  // World
  station_vex:    "sprites/station_vex.png",
  station_krag:   "sprites/station_krag.png",
  station_nox:    "sprites/station_nox.png",
  outpost_player: "sprites/outpost_player.png",
  outpost_enemy:  "sprites/outpost_enemy.png",
  asteroid:       "sprites/asteroid_ore.png",
  // Inert junk/salvage floaters — keys match CONFIG.junkTypes / j.key exactly so
  // the world draw site can blit ART.draw(g, j.key, …) directly.
  junk_can:       "sprites/junk_can.png",
  junk_panel:     "sprites/junk_panel.png",
  junk_crate:     "sprites/junk_crate.png",
  junk_debris:    "sprites/junk_debris.png",
  warp_gate:      "sprites/warp_gate.png",
  nebula_blue:    "sprites/nebula_blue.png",
  nebula_red:     "sprites/nebula_red.png",
  nebula_green:   "sprites/nebula_green.png",
  // Characters
  portrait_commander: "sprites/commander_portrait.png",
  portrait_vex:       "sprites/vex_leader.png",
  portrait_krag:      "sprites/krag_leader.png",
  portrait_nox:       "sprites/nox_leader.png",
  portrait_station:   "sprites/station_commander.png",
  // Story scenes
  scene_opening:  "sprites/opening_scene.png",
  scene_victory:  "sprites/victory_scene.png",
  // Icons
  icon_vex:       "sprites/icon_vex.png",
  icon_krag:      "sprites/icon_krag.png",
  icon_nox:       "sprites/icon_nox.png",
  // Planet surface — Earth-like isometric sprites
  // Generated via xAI grok-imagine-image, black backgrounds removed by planet_remove_bg.py.
  // Flip PLANET_SPRITES to true once sprites are polished and present.
  planet_tree:         "sprites/planet_tree.png",
  planet_bush:         "sprites/planet_bush.png",
  planet_pine:         "sprites/planet_pine.png",
  planet_rock:         "sprites/planet_rock.png",
  planet_mountain:     "sprites/planet_mountain.png",
  planet_barn:         "sprites/planet_barn.png",
  planet_market:       "sprites/planet_market.png",
  planet_house:        "sprites/planet_house.png",
  planet_windmill:     "sprites/planet_windmill.png",
  planet_well:         "sprites/planet_well.png",
  planet_launchpad:    "sprites/planet_launchpad.png",
  planet_rocket:       "sprites/planet_rocket.png",
  planet_player:       "sprites/planet_player.png",
  planet_farmer:       "sprites/planet_farmer.png",
  planet_merchant:     "sprites/planet_merchant.png",
  planet_flower_patch: "sprites/planet_flower_patch.png",
  planet_crop_row:     "sprites/planet_crop_row.png",
  planet_fence:        "sprites/planet_fence.png",
  // (Terrain tile sets are registered dynamically below — see TERRAIN_TILESETS.)
  // Mira building sprites — cute 3D iso PNGs with alpha (sprites/pipeline.py).
  // Keys are 'bldg_' + the CITY_BTYPES/BTYPES type key; drawBuilding tries the
  // sprite first and falls back to its procedural isoBox when absent.
  bldg_ctrl_tower:    'sprites/mira/bldg_ctrl_tower.png',
  bldg_hangar:        'sprites/mira/bldg_hangar.png',
  bldg_cargo_bay:     'sprites/mira/bldg_cargo_bay.png',
  bldg_fuel_depot:    'sprites/mira/bldg_fuel_depot.png',
  bldg_comms_tower:   'sprites/mira/bldg_comms_tower.png',
  bldg_repair_shop:   'sprites/mira/bldg_repair_shop.png',
  bldg_power_station: 'sprites/mira/bldg_power_station.png',
  bldg_med_bay:       'sprites/mira/bldg_med_bay.png',
  bldg_round_guard:   'sprites/mira/bldg_round_guard.png',
  bldg_city_hall:     'sprites/mira/bldg_city_hall.png',
  bldg_city_market:   'sprites/mira/bldg_city_market.png',
  bldg_traders_guild: 'sprites/mira/bldg_traders_guild.png',
  bldg_cantina:       'sprites/mira/bldg_cantina.png',
  bldg_hotel:         'sprites/mira/bldg_hotel.png',
  bldg_blacksmith:    'sprites/mira/bldg_blacksmith.png',
  bldg_city_shop:     'sprites/mira/bldg_city_shop.png',
  bldg_apartment:     'sprites/mira/bldg_apartment.png',
  bldg_town_house:    'sprites/mira/bldg_town_house.png',
  bldg_sky_deco:      'sprites/mira/bldg_sky_deco.png',
  bldg_sky_glass:     'sprites/mira/bldg_sky_glass.png',
  bldg_sky_rect:      'sprites/mira/bldg_sky_rect.png',
  bldg_sky_cyl:       'sprites/mira/bldg_sky_cyl.png',
  bldg_sky_med:       'sprites/mira/bldg_sky_med.png',
  bldg_sawmill:       'sprites/mira/bldg_sawmill.png',
  bldg_quarry:        'sprites/mira/bldg_quarry.png',
  bldg_barn:          'sprites/mira/bldg_barn.png',
  bldg_well:          'sprites/mira/bldg_well.png',
  bldg_shelter:       'sprites/mira/bldg_shelter.png',
  bldg_market:        'sprites/mira/bldg_market.png',
  bldg_city_inn:      'sprites/mira/bldg_city_inn.png',
  bldg_city_gate:     'sprites/mira/bldg_city_gate.png',
  bldg_silo:          'sprites/mira/bldg_silo.png',
  // landmarks + housing variety sheet (faction-styled per MARA_PLANET_LORE_SPEC.md)
  bldg_obelisk:        'sprites/mira/bldg_obelisk.png',
  bldg_pyramid:        'sprites/mira/bldg_pyramid.png',
  bldg_stepped_temple: 'sprites/mira/bldg_stepped_temple.png',
  bldg_water_tower:    'sprites/mira/bldg_water_tower.png',
  bldg_barracks:       'sprites/mira/bldg_barracks.png',
  bldg_ore_depot:      'sprites/mira/bldg_ore_depot.png',
  bldg_town_house_b:   'sprites/mira/bldg_town_house_b.png',
  bldg_town_house_c:   'sprites/mira/bldg_town_house_c.png',
  bldg_apartment_b:    'sprites/mira/bldg_apartment_b.png',
};

// Gameplay sprites are disabled until the art is polished — with this off, every
// in-world draw (ships, stations, outposts, asteroids, warp gates, junk) falls
// back to its original procedural canvas shape. Story/lore art still shows: the
// opening cinematic + victory scene are DOM/CSS blits (not ART.draw), and the
// dock portrait banner + character/faction art route through ART.draw/get with a
// STORY key. Flip to true to re-enable the gameplay PNGs.
const GAMEPLAY_SPRITES = false;
// Planet surface sprites — flip to true once planet_gen.py + planet_remove_bg.py
// have been run and the PNGs are in sprites/. Falls back to procedural canvas art
// on false, so the game always renders correctly either way.
const PLANET_SPRITES = false;
const STORY_KEYS = new Set([
  'scene_opening', 'scene_victory',
  'ship_vulture_menu', 'ship_atlas_menu', 'ship_aegis_menu',
  'portrait_commander', 'portrait_vex', 'portrait_krag', 'portrait_nox', 'portrait_station',
  'icon_vex', 'icon_krag', 'icon_nox',
]);
const PLANET_KEYS = new Set([
  'planet_tree', 'planet_bush', 'planet_pine', 'planet_rock', 'planet_mountain',
  'planet_barn', 'planet_market', 'planet_house', 'planet_windmill', 'planet_well',
  'planet_launchpad', 'planet_rocket', 'planet_player', 'planet_farmer', 'planet_merchant',
  'planet_flower_patch', 'planet_crop_row', 'planet_fence',
]);
// Mira terrain tiles always render (not gated by GAMEPLAY_SPRITES or PLANET_SPRITES).
// Terrain tile sets on disk (sprites/<set>/<set>_flat_<variant>.png), one per
// planet culture, generated by sprites/pipeline.py `tiles <planet>`. The
// pipeline prints the name to append here when a new planet's set lands;
// PLANET_DEFS[planet].tileset picks the prefix at draw time (planets without
// their own art keep tileset:'mira'). Only listed sets are fetched — never
// register a set whose PNGs aren't on disk or every boot 404s nine times.
const TERRAIN_TILESETS = ['mira'];
const TERRAIN_VARIANTS = [
  'grass_base', 'grass_pebbles', 'soil_tilled', 'soil_seedling',
  'crop_harvest', 'road_dirt', 'path_stone', 'water_stream', 'wildflowers',
];
const MIRA_TERRAIN_KEYS = new Set();
for (const set of TERRAIN_TILESETS)
  for (const v of TERRAIN_VARIANTS) {
    const k = `${set}_flat_${v}`;
    ART_MANIFEST[k] = `sprites/${set}/${k}.png`;
    MIRA_TERRAIN_KEYS.add(k);
  }

// Decorative clay ground-scatter props (CLAY_GROUND_SPEC.md pivot): flat
// procedural ground + rich clay props on top. Generated by pipeline.py
// `props <planet>` → sprites/<set>/prop_<variant>.png. Pure decoration —
// draw sites skip silently when art is missing (no procedural fallback).
const PROP_SETS = ['mira'];
const PROP_VARIANTS = [
  'grass_tuft_a', 'grass_tuft_b', 'flower_white', 'flower_pink',
  'pebble_cluster', 'bush_round', 'reed_clump', 'stone_mossy', 'stump_small',
];
const PROP_KEYS = new Set();
for (const set of PROP_SETS)
  for (const v of PROP_VARIANTS) {
    const k = `prop_${set}_${v}`;
    ART_MANIFEST[k] = `sprites/${set}/prop_${v}.png`;
    PROP_KEYS.add(k);
  }

// 3D-clay isometric floor SLABS (CLAY_GROUND_SPEC.md v2): each ground tile is
// a diamond clay slab OBJECT (top face + rounded edges + thickness), blitted
// per tile in the iso grid. The grout line between slabs is intentional.
// Slabs are lit objects — NEVER rotate/flip variants (light stays upper-left).
// Generated by pipeline.py `slabs <planet>` → sprites/<set>/slab_<variant>.png
const SLAB_SETS = ['mira'];
const SLAB_VARIANTS = [
  'grass_a', 'grass_b', 'grass_flowers', 'dirt', 'stone_path', 'water',
  'soil_tilled', 'soil_seedling', 'soil_harvest',
];
const SLAB_KEYS = new Set();
for (const set of SLAB_SETS)
  for (const v of SLAB_VARIANTS) {
    const k = `slab_${set}_${v}`;
    ART_MANIFEST[k] = `sprites/${set}/slab_${v}.png`;
    SLAB_KEYS.add(k);
  }

// Minable resource NODES (trees / rocks / berry bushes) — the interactive
// layer, replacing emoji placeholders. Same clay language as the buildings.
// Generated by pipeline.py `nodes <planet>` → sprites/<set>/node_<variant>.png
const NODE_SETS = ['mira'];
const NODE_VARIANTS = [
  'tree_oak_a', 'tree_oak_b', 'tree_palm', 'tree_pine', 'tree_cactus',
  'rock_a', 'rock_b', 'berry_bush', 'tree_dead',
];
const NODE_KEYS = new Set();
for (const set of NODE_SETS)
  for (const v of NODE_VARIANTS) {
    const k = `node_${set}_${v}`;
    ART_MANIFEST[k] = `sprites/${set}/node_${v}.png`;
    NODE_KEYS.add(k);
  }

// Building sprites, ungated like the terrain tiles — every draw site keeps its
// procedural isoBox fallback for headless mode and missing art.
const MIRA_BLDG_KEYS = new Set([
  'bldg_ctrl_tower', 'bldg_hangar', 'bldg_cargo_bay', 'bldg_fuel_depot',
  'bldg_comms_tower', 'bldg_repair_shop', 'bldg_power_station', 'bldg_med_bay',
  'bldg_round_guard', 'bldg_city_hall', 'bldg_city_market', 'bldg_traders_guild',
  'bldg_cantina', 'bldg_hotel', 'bldg_blacksmith', 'bldg_city_shop',
  'bldg_apartment', 'bldg_town_house', 'bldg_sky_deco', 'bldg_sky_glass',
  'bldg_sky_rect', 'bldg_sky_cyl', 'bldg_sky_med', 'bldg_sawmill',
  'bldg_quarry', 'bldg_barn', 'bldg_well', 'bldg_shelter', 'bldg_market',
  'bldg_city_inn', 'bldg_city_gate', 'bldg_silo',
  'bldg_obelisk', 'bldg_pyramid', 'bldg_stepped_temple', 'bldg_water_tower',
  'bldg_barracks', 'bldg_ore_depot', 'bldg_town_house_b', 'bldg_town_house_c',
  'bldg_apartment_b',
]);

// Per-planet building sets (sprites/<set>/bldg_<set>_<type>.png), generated by
// pipeline.py `buildings <sheet> <planet>` with the faction accent from the
// lore spec. drawMiraBldg tries the planet set first, then the shared pool
// above. Add a set name here only once its PNGs are on disk.
const BLDG_SETS = [];
for (const set of BLDG_SETS)
  for (const key of [...MIRA_BLDG_KEYS]) {
    const k = key.replace('bldg_', `bldg_${set}_`);
    ART_MANIFEST[k] = `sprites/${set}/${k}.png`;
    MIRA_BLDG_KEYS.add(k);
  }

const ART = {
  img: {},
  ready: false,
  _tileCache: new Map(),
  _lastCacheHw: -1,
  _lastCacheHh: -1,

  // Preload every manifest entry. onDone fires once ALL images settle (load OR
  // error — a 404 must not hang the loading screen). No-op + instant-ready under
  // HEADLESS so the selfTest and any non-DOM host never block.
  load(onDone) {
    if (HEADLESS || typeof Image === "undefined") { this.ready = true; if (onDone) onDone(); return; }
    const keys = Object.keys(ART_MANIFEST);
    let remaining = keys.length;
    if (!remaining) { this.ready = true; if (onDone) onDone(); return; }
    const settle = () => { if (--remaining <= 0) { this.ready = true; if (onDone) onDone(); } };
    for (const k of keys) {
      const im = new Image();
      im.onload = settle;
      im.onerror = settle;              // graceful fail — get() rejects the broken image, the draw site falls back
      im.src = ART_MANIFEST[k];
      // Warm-decode terrain tiles off the critical path: the browser decodes
      // PNGs lazily on first draw, and paying 18 megapixel decodes inside the
      // first buildTileCache() was a multi-second hitch on landing.
      if (MIRA_TERRAIN_KEYS.has(k) && typeof im.decode === 'function') im.decode().catch(()=>{});
      this.img[k] = im;
    }
  },

  // Pre-bake each flat terrain tile into an OffscreenCanvas sized to the diamond
  // bounding box. Call when zoom changes (hw/hh change with _cam.z). Returns the
  // number of tiles cached (0 if OffscreenCanvas unavailable or images not ready).
  // Diamonds are baked PAD px oversized so adjacent tiles overlap slightly —
  // exact-size clips leave antialiased hairline gaps that read as a grid.
  _tilePad: 2,
  _cacheBuiltHw: -1,   // tile half-size the cache was baked at (for scaled blits mid-zoom)
  _cacheBuiltHh: -1,
  buildTileCache(hw, hh) {
    if (typeof OffscreenCanvas === 'undefined') return 0;
    this._tileCache.clear();
    this._cacheBuiltHw = hw; this._cacheBuiltHh = hh;
    const PAD = this._tilePad, HW = hw + PAD, HH = hh + PAD;
    for (const key of MIRA_TERRAIN_KEYS) {
      const img = this.img[key];
      if (!img || !img.complete || !img.naturalWidth) continue;
      const w = img.naturalWidth, h = img.naturalHeight;
      const oc = new OffscreenCanvas(HW * 2, HH * 2);
      const octx = oc.getContext('2d');
      const cx = HW, cy = HH;
      octx.beginPath();
      octx.moveTo(cx,      cy - HH);
      octx.lineTo(cx + HW, cy);
      octx.lineTo(cx,      cy + HH);
      octx.lineTo(cx - HW, cy);
      octx.closePath();
      octx.clip();
      octx.transform(HW / w, HH / w, -HW / h, HH / h, cx, cy - HH);
      octx.drawImage(img, 0, 0);
      this._tileCache.set(key, oc);
      // 180°-rotated variant ('#r' suffix) — free per-tile variety. Draw sites
      // only request it for organic textures (grass/water/dirt) where a
      // reversed edge still blends; structured tiles (cobbles, furrows) would
      // show mismatched seams.
      const ocr = new OffscreenCanvas(HW * 2, HH * 2);
      const rctx = ocr.getContext('2d');
      rctx.translate(HW, HH); rctx.rotate(Math.PI); rctx.translate(-HW, -HH);
      rctx.drawImage(oc, 0, 0);
      this._tileCache.set(key + '#r', ocr);
    }
    return this._tileCache.size;
  },

  // A decodable, loaded <img> for `key`, or null (headless / not-loaded-yet /
  // failed). Draw sites use `if (ART.get(k)) …use PNG… else …fallback…`.
  get(key) {
    if (HEADLESS) return null;
    const im = this.img[key];
    return (im && im.complete && im.naturalWidth > 0) ? im : null;
  },
  has(key) { return !!this.get(key); },

  // Blit a PNG centered at (sx,sy) in SCREEN space, sized to `wPx` wide with the
  // image's native aspect ratio preserved (these are 16:9 hero shots). rot spins
  // about the center. `upright` (ship art): a left-facing heading mirrors the
  // sprite vertically so a side-view hull never flies belly-up. Returns true if
  // it actually drew — the caller falls back on false.
  draw(g, key, sx, sy, wPx, rot, upright) {
    if (!GAMEPLAY_SPRITES && !STORY_KEYS.has(key)) return false;   // gameplay art off → procedural fallback
    const im = this.get(key); if (!im) return false;
    const hPx = wPx * (im.naturalHeight / im.naturalWidth);
    g.save();
    // These PNGs are hi-res photographic hero shots scaled down to world size —
    // keep bilinear smoothing on (canvas default, but assert it in case a
    // pixel-art draw site elsewhere left the context on nearest-neighbor).
    g.imageSmoothingEnabled = true;
    g.translate(sx, sy);
    if (rot) g.rotate(rot);
    if (upright && Math.cos(rot || 0) < 0) g.scale(1, -1);
    g.drawImage(im, -wPx / 2, -hPx / 2, wPx, hPx);
    g.restore();
    return true;
  },

  // ---- clay floor slabs ---------------------------------------------------------
  // Blit one clay slab tile with its TOP FACE filling the engine's grid diamond
  // (2hw × 2hh at sx,sy) and the slab thickness hanging below — pass 1 draws
  // back-to-front, so the nearer row covers the lip except at cliffs and
  // map/shore edges, where it reads as real depth. The art's top face is 2:1
  // (artW/2 tall); the engine diamond is 2hw × 2hh, so Y squashes by 2hh/hw
  // (0.8 at the 2.5:1 engine ratio) — clay tolerates the slight flattening.
  // `tint` (optional CSS color) bakes a multiply-recolor variant into the
  // cache — used to re-skin the green grass slab for jungle, the dirt slab
  // for mountain rock, etc. Cached per key|tint at 160px, so per-frame cost
  // is one small scaled drawImage per tile.
  _slabCache: new Map(),
  slabReady(key) { return !!this.get(key); },
  drawSlab(ctx, key, sx, sy, hw, hh, tint) {
    const ck = key + '|' + (tint || '');
    let oc = this._slabCache.get(ck);
    if (oc === undefined) {
      const im = this.get(key);
      if (!im) return false;                    // not loaded yet — retry next frame
      const W = 160, s = W / im.naturalWidth;
      const H = Math.max(1, Math.round(im.naturalHeight * s));
      oc = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(W, H)
        : (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; })();
      const o = oc.getContext('2d');
      o.drawImage(im, 0, 0, W, H);
      if (tint) {
        o.globalCompositeOperation = 'multiply'; o.globalAlpha = 0.42;
        o.fillStyle = tint; o.fillRect(0, 0, W, H);
        o.globalAlpha = 1; o.globalCompositeOperation = 'destination-in';
        o.drawImage(im, 0, 0, W, H);            // restore the slab's alpha silhouette
        o.globalCompositeOperation = 'source-over';
      }
      this._slabCache.set(ck, oc);
    }
    const dw = 2 * hw;
    const dh = oc.height * (dw / oc.width) * ((2 * hh) / hw);
    ctx.drawImage(oc, sx - hw, sy - hh, dw, dh);
    return true;
  },

  // ---- clay ground-scatter props ----------------------------------------------
  // Blit a small decorative prop, bottom-anchored at (sx, sy), wPx wide.
  // Each PNG is pre-rastered ONCE to a ≤96px offscreen (the emojiSprite
  // pattern) so per-frame cost is a single small scaled drawImage — never a
  // hi-res rescale. Returns false (and draws nothing) when art isn't loaded:
  // decos are pure decoration, the flat clay ground is valid without them.
  _propCache: new Map(),
  drawProp(ctx, key, sx, sy, wPx, res) {
    let oc = this._propCache.get(key);
    if (oc === undefined) {
      const im = this.get(key);
      if (!im) return false;                    // not loaded yet — retry next frame
      // `res` = cache raster size: 96 suits small decos; resource nodes pass
      // ~192 so trees stay crisp at high zoom / retina
      const P = res || 96, s = P / Math.max(im.naturalWidth, im.naturalHeight);
      const w = Math.max(1, Math.round(im.naturalWidth * s));
      const h = Math.max(1, Math.round(im.naturalHeight * s));
      oc = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(w, h)
        : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; })();
      oc.getContext('2d').drawImage(im, 0, 0, w, h);
      this._propCache.set(key, oc);
    }
    const hPx = wPx * (oc.height / oc.width);
    ctx.drawImage(oc, sx - wPx / 2, sy - hPx, wPx, hPx);
    return true;
  },

  // ---- isometric planet surface sprites --------------------------------------
  // Draw a planet sprite in isometric world space. The sprite is bottom-centered
  // at (sx, sy) — so the object appears to rest ON the tile. wPx is the display
  // width in screen pixels; aspect ratio is preserved. Returns true if drawn.
  // Falls back to false when PLANET_SPRITES is false or the image isn't loaded.
  drawIso(g, key, sx, sy, wPx) {
    if (!PLANET_SPRITES && !PLANET_KEYS.has(key)) return false;
    if (!PLANET_SPRITES) return false;
    const im = this.get(key); if (!im) return false;
    const hPx = wPx * (im.naturalHeight / im.naturalWidth);
    g.imageSmoothingEnabled = true;
    // center-bottom anchor: sprite sits on the tile rather than floating above it
    g.drawImage(im, sx - wPx / 2, sy - hPx, wPx, hPx);
    return true;
  },

  // ---- Mira isometric terrain tiles -----------------------------------------
  // Draw a terrain tile diamond centered at (sx,sy). hw/hh are the diamond
  // half-extents in screen-px (ISO_HW*z and ISO_HH*z). Returns true if the PNG
  // was drawn — caller falls back to flatTile on false.
  drawTerrain(g, key, sx, sy, hw, hh) {
    if (!MIRA_TERRAIN_KEYS.has(key)) return false;
    const im = this.get(key); if (!im) return false;
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(im, sx - hw, sy - hh, 2*hw, 2*hh);
    g.restore();
    return true;
  },

  // Affine-map a flat square texture onto the iso diamond with pixel-perfect fit.
  // top-left→top, top-right→right, bottom-left→left, bottom-right→bottom.
  // Fast path: if buildTileCache was called for this hw/hh, blits a single
  // pre-clipped OffscreenCanvas (1 drawImage, no save/clip/transform/restore).
  drawFlatTexture(ctx, key, cx, cy, hw, hh) {
    // '#r' suffix = the 180°-rotated cache variant of the same texture
    const base = key.endsWith('#r') ? key.slice(0, -2) : key;
    if (!MIRA_TERRAIN_KEYS.has(base)) return false;
    const cached = this._tileCache.get(key);
    if (cached) {
      const bhw = this._cacheBuiltHw;
      if (bhw <= 0 || Math.abs(bhw - hw) < 0.01) {
        // cache matches the current zoom — pixel-perfect 1:1 blit
        ctx.drawImage(cached, cx - hw - this._tilePad, cy - hh - this._tilePad);
      } else {
        // zoom is mid-animation: scale the stale cache to the current tile
        // size (slightly soft for a beat) instead of re-baking every frame
        const sc = hw / bhw;
        ctx.drawImage(cached,
          cx - hw - this._tilePad*sc, cy - hh - this._tilePad*sc,
          cached.width*sc, cached.height*sc);
      }
      return true;
    }
    // Slow path — cache not built yet or OffscreenCanvas unavailable
    // (draws the unrotated image; rotation only exists in the cache)
    const img = this.get(base); if (!img) return false;
    const w = img.naturalWidth, h = img.naturalHeight;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx,      cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx,      cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.clip();
    ctx.transform(hw / w, hh / w, -hw / h, hh / h, cx, cy - hh);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    return true;
  },

  // Mira building sprite — cute 3D iso PNG bottom-anchored on the footprint
  // diamond centered at (sx, sy) with half-extents (hw, hh). maxH caps the
  // on-screen height so tall art can't dwarf its procedural neighbors.
  // `set` (optional) picks a per-planet faction pack first, falling back to
  // the shared pool. Returns drawn pixel height (0 = not drawn → fall back).
  drawMiraBldg(g, type, sx, sy, hw, hh, maxH, set) {
    let key = set ? `bldg_${set}_${type}` : '';
    if (!key || !MIRA_BLDG_KEYS.has(key) || !this.get(key)) key = 'bldg_' + type;
    if (!MIRA_BLDG_KEYS.has(key)) return 0;
    const im = this.get(key); if (!im) return 0;
    let wPx = hw * 2.3, hPx = wPx * (im.naturalHeight / im.naturalWidth);
    if (maxH && hPx > maxH) { wPx *= maxH / hPx; hPx = maxH; }
    // soft contact shadow grounds the sprite on its tile
    g.save(); g.globalAlpha = 0.16; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(sx, sy, hw * 0.92, hh * 0.92, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.imageSmoothingEnabled = true;
    g.drawImage(im, sx - wPx / 2, sy + hh - hPx, wPx, hPx);
    return hPx;
  },

  // ---- per-ore-type tinting (asteroids) --------------------------------------
  // A single PNG (asteroid_ore.png) backs every rock, so distinct ore types are
  // recovered by overlaying each ring's colour. The tint MUST be composited on
  // an isolated offscreen canvas: `source-atop` on the live game canvas would
  // paint everything already drawn under the sprite's box (stars/planets/other
  // rocks), not just this rock's opaque pixels. Only a handful of (key,tint)
  // pairs ever exist (5 ore colours), so each tinted copy is baked once at the
  // PNG's native resolution and cached — no per-frame compositing.
  _tintCache: {},
  tinted(key, tint) {
    const im = this.get(key); if (!im) return null;
    const ck = key + "|" + tint;
    let c = this._tintCache[ck];
    if (!c) {
      if (typeof document === "undefined") return im;   // no offscreen host — draw untinted
      c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const cg = c.getContext("2d");
      cg.drawImage(im, 0, 0);
      cg.globalCompositeOperation = "source-atop";       // fill only over the sprite's opaque pixels
      cg.fillStyle = tint;
      cg.fillRect(0, 0, c.width, c.height);
      this._tintCache[ck] = c;
    }
    return c;
  },

  // Like draw(), but recolours the sprite's opaque pixels with `tint` (any CSS
  // colour, e.g. a semi-transparent rgba from hexA). Falls back (returns false)
  // whenever the PNG isn't ready, so the caller keeps its procedural fallback.
  drawTint(g, key, sx, sy, wPx, rot, tint) {
    if (!GAMEPLAY_SPRITES && !STORY_KEYS.has(key)) return false;   // gameplay art off → procedural fallback
    const src = this.tinted(key, tint); if (!src) return false;
    const iw = src.width, ih = src.height;
    const hPx = wPx * (ih / iw);
    g.save();
    g.imageSmoothingEnabled = true;
    g.translate(sx, sy);
    if (rot) g.rotate(rot);
    g.drawImage(src, -wPx / 2, -hPx / 2, wPx, hPx);
    g.restore();
    return true;
  },
};
