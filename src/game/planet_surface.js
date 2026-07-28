/*=== HARNESS:PLANET_SURFACE ==================================================*/
// Planet surface mode — full procedural world: biomes, resources, town building.
// Ported from Burrow & Beyond world engine, adapted for Space Hauler's ISO renderer.
//   PLANET.land(s, planetName)  — called from GAME.update() on L press near a planet
//   PLANET.tick(dt, s)          — planet game loop (replaces space update while on surface)
//   PLANET.draw(g, s)           — ISO tile renderer + HUD (replaces space draw)
// All canvas calls guarded by (HEADLESS). Progress stored in s.planetProgress[name].
//
// CLAY DIORAMA: ground paint + gen knobs live in ClayWorldEngine (locked).
// Add a world by writing a recipe (see CLAY_WORLD_ENGINE.md) — do not fork paint.

const PLANET = (() => {
  // Engine handle (loaded before this file by build.py). Local alias for speed.
  const CWE = (typeof ClayWorldEngine !== "undefined") ? ClayWorldEngine : null;
  const ENGINE_LAYOUT_V = (CWE && CWE.LAYOUT_V) || 8;
  // ── constants ───────────────────────────────────────────────────────────────
  // 96×72 (was 80×60): +44% land — room to build and farm between the port and
  // town, and space for the terrain to roll. NOTE: pre-existing saves keep
  // their positions (all old coords remain in-bounds) but their worlds regen
  // with the new dimensions, so terrain around saved structures may shift.
  const MAP_W = 96, MAP_H = 72;
  const PLAYER_SPEED = 5.5;
  const INTERACT_R   = 2.4;
  const SHIP_R       = 3.5;
  const NODE_RESPAWN = 90;      // seconds before a harvested node regrows
  // 4 elevation tiers + taller cliff steps (16→22 world-px): the de-flattening
  // pass. Mountains now stack visibly; plateaus read as real landforms.
  const MAX_ELEV     = 4;
  const CLIFF_PX     = 22;      // world-px per elevation level (before zoom)

  // ── Rover (car) physics ─────────────────────────────────────────────────────
  const CAR_THRUST     = 0.037;  // forward acceleration per frame
  const CAR_REVERSE    = 0.019;  // backward acceleration per frame
  const CAR_TURN_SPEED = 0.055;  // radians/frame at full speed
  const CAR_MAX_SPEED  = 0.16;   // tiles/frame
  const LONG_DRAG      = 0.94;   // longitudinal drag multiplier per frame
  const LAT_DRAG       = 0.72;   // lateral drag multiplier per frame (causes drift)

  // tile types
  const T_WATER = 0, T_GRASS = 1, T_ROAD = 2;
  // biome IDs
  const B_GRASS = 0, B_JUNGLE = 1, B_DESERT = 2, B_MOUNTAIN = 3;

  // ISO geometry — 2.5:1 diamond (was 2:1). The flatter ground now reads at the
  // same squish as the building roofs, so structures sit ON the tiles instead of
  // looking like they're planted in a steeper plane than everything on top of it.
  const ISO_HW = 40, ISO_HH = 16;   // half tile width / height in world-px

  // Mira — bright, Earth-like daytime palette (home planet, not Night City)
  const C = {
    ink:       '#2a2418',   // soft brown-grey outline (was near-black)
    sky0:      '#6FB7F0',   // high sky blue
    sky1:      '#CFEAF7',   // pale horizon
    playerTop: '#E8552E',   // warm explorer suit (reads on green ground)
    playerL:   '#B33C1E',
    playerR:   '#8E2E15',
    playerHd:  '#FFE08A',   // sun-yellow accent
    shipTop:   '#C8CDD6',   // clean metallic hull
    shipSide:  '#9AA0AB',
    shipDk:    '#6E747E',
    padTop:    '#B8B0A0',
    padL:      '#948C7C',
    padR:      '#736C5E',
  };

  // ── camera ──────────────────────────────────────────────────────────────────
  let _cam       = { x: 0, y: 0, z: 0.9, init: false };
  let _zoomTgt   = 0.9;
  let _camActive = false;
  let _frame     = 0;   // time accumulator for animated effects

  // ── world cache (regenerated from seed each session) ────────────────────────
  let _worldCache = null;

  // ── star field (generated once, reused every draw) ───────────────────────────
  let _stars = null;
  let _clouds = null;   // drifting daytime clouds

  // ── rain particles (generated once, updated every draw) ──────────────────────
  let _rain = null;

  // ── screen glitch state ──────────────────────────────────────────────────────
  let _glitch = { active: false, ttl: 0, bands: [] };

  // ── lightning state ───────────────────────────────────────────────────────────
  let _lightning = { alpha: 0, ttl: 0 };

  // ── season system ─────────────────────────────────────────────────────────────
  // idx: 0=Spring 1=Summer 2=Autumn 3=Winter. Time no longer advances seasons —
  // they only turn when the player SLEEPS (rests at the Inn / a Shelter). Each
  // season lasts SLEEPS_PER_SEASON sleeps; `tick` counts sleeps into the current
  // season (0 … SLEEPS_PER_SEASON-1).
  const SEASON_NAMES     = ['SPRING','SUMMER','AUTUMN','WINTER'];
  const FESTIVAL_NAMES   = ['BLOSSOM FESTIVAL','NEON CARNIVAL','HARVEST MARKET','ICE GALA'];
  const SLEEPS_PER_SEASON = 16;   // 16 sleeps per season (one sleep = one turn)
  let _season = { idx: 0, tick: 0 };

  // ── weather system ────────────────────────────────────────────────────────────
  // type: 'CLEAR' | 'RAIN' | 'STORM' | 'FOG' | 'HAZE' | 'SNOW' | 'BLIZZARD'
  // Weather also only changes on sleep, rolled from the current season's table.
  const WEATHER_TYPES   = ['CLEAR','RAIN','STORM','FOG','HAZE','SNOW','BLIZZARD'];
  // weights per season: [CLEAR, RAIN, STORM, FOG, HAZE, SNOW, BLIZZARD]
  const WEATHER_WEIGHTS = [
    [0.35, 0.30, 0.00, 0.20, 0.15, 0.00, 0.00], // Spring
    [0.50, 0.00, 0.15, 0.10, 0.25, 0.00, 0.00], // Summer
    [0.30, 0.25, 0.00, 0.25, 0.20, 0.00, 0.00], // Autumn
    [0.20, 0.00, 0.00, 0.15, 0.00, 0.40, 0.25], // Winter
  ];
  let _weather = { type: 'CLEAR', notifAlpha: 0, notifText: '' };
  let _snow = null;   // lazy-init snow particle pool (screen-space, like _rain)

  // ── festival system ───────────────────────────────────────────────────────────
  // The season's festival is ALWAYS live while on the surface (it no longer opens
  // and closes on a timer) — it lasts the whole time the player is in the world.
  let _festival = { active: true, name: FESTIVAL_NAMES[0], ttl: 0 };

  // ── general particle pool (world-space, for festival effects) ─────────────────
  let _particles = [];   // { wx, wy, vx, vy, life, maxLife, col, size }

  // ── seeded RNG ──────────────────────────────────────────────────────────────
  let _rngState = 1;
  function rngSeed(s) { _rngState = (s >>> 0) || 1; }
  function rnd() {
    _rngState = (_rngState * 1103515245 + 12345) & 0x7fffffff;
    return _rngState / 0x7fffffff;
  }
  // Legacy deco widths (clay slab path). Diorama uses ClayWorldEngine.decoDisplayW
  // so grass/flowers fill the whole tile diamond.
  const DECO_W = {
    grass_tuft_a: 78, grass_tuft_b: 78, flower_white: 72, flower_pink: 72,
    pebble_cluster: 44, bush_round: 70, reed_clump: 68, stone_mossy: 50,
    stump_small: 46,
  };

  // Building sprite grandeur — per-type visual footprint multiplier. The city
  // generator already reserves clearance (talls r=2, small r=1), so big types
  // can DRAW bigger than one tile without colliding: skyline towers loom,
  // civic buildings read as landmarks, houses stay humble. Pure draw scale —
  // interaction radii and tile occupancy are unchanged.
  const BLDG_SCALE = {
    sky_deco:1.5, sky_glass:1.5, sky_rect:1.45, sky_cyl:1.45, sky_med:1.35,
    city_hall:1.5, hotel:1.3, traders_guild:1.3, city_market:1.3, cantina:1.25,
    ctrl_tower:1.4, hangar:1.35, cargo_bay:1.3, fuel_depot:1.25,
    obelisk:1.4, pyramid:1.45, stepped_temple:1.45, water_tower:1.3,
    city_gate:1.3, apartment:1.25, city_inn:1.2, barracks:1.2,
    power_station:1.2, comms_tower:1.25, silo:1.25, blacksmith:1.15,
    town_house:1.1, city_shop:1.15, med_bay:1.15, repair_shop:1.15,
    round_guard:1.2,
  };

  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
    h = ((h ^ (h >> 13)) * 1274126177) >>> 0;
    return (h ^ (h >> 16)) / 4294967295;
  }

  // ── smooth noise (B&B makeNoise) ────────────────────────────────────────────
  function makeNoise(scale) {
    const gs = Math.ceil(Math.max(MAP_W, MAP_H) / scale) + 3;
    const g = [];
    for (let i = 0; i < gs * gs; i++) g.push(rnd());
    const sm = t => t * t * (3 - 2 * t);
    return (x, y) => {
      x /= scale; y /= scale;
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const at = (r, c) => g[Math.min(gs-1, Math.max(0,r)) * gs + Math.min(gs-1, Math.max(0,c))] || 0;
      const a = at(yi,xi), b = at(yi,xi+1), cv = at(yi+1,xi), d = at(yi+1,xi+1);
      return a + (b-a)*sm(xf) + (cv-a)*sm(yf) + (a-b-cv+d)*sm(xf)*sm(yf);
    };
  }

  // ── ISO coordinate helpers ───────────────────────────────────────────────────
  function isoWorld(tx, ty)     { return { x: (tx - ty) * ISO_HW, y: (tx + ty) * ISO_HH }; }
  function isoScreen(wx, wy, W, H) { return { x: (wx - _cam.x)*_cam.z + W/2, y: (wy - _cam.y)*_cam.z + H/2 }; }
  function tileScreen(tx, ty, W, H) { const {x,y} = isoWorld(tx,ty); return isoScreen(x, y, W, H); }

  // ISO diamond (flat tile face)
  function flatTile(g, sx, sy, col, outline) {
    const hw = ISO_HW*_cam.z, hh = ISO_HH*_cam.z;
    g.beginPath();
    g.moveTo(sx, sy-hh); g.lineTo(sx+hw, sy); g.lineTo(sx, sy+hh); g.lineTo(sx-hw, sy);
    g.closePath();
    g.fillStyle = col; g.fill();
    if (outline) { g.strokeStyle = outline; g.lineWidth = Math.max(0.3, 0.6*_cam.z); g.stroke(); }
  }

  // ── ClayWorldEngine paint bridge (locked procedural diorama) ────────────────
  // Full implementation lives in clay_world_engine.js. These thin wrappers keep
  // call sites readable and pass ISO geometry + live frame time.
  function clayDiamond(g, sx, sy, hw, hh, thick, topC, lipL, lipR, edgeA, inset) {
    if (CWE) return CWE.clayDiamond(g, sx, sy, hw, hh, thick, topC, lipL, lipR, edgeA, inset);
  }
  function shadeRgb(col, f) {
    if (CWE) return CWE.shadeRgb(col, f);
    return col;
  }
  function drawDioramaCell(g, sx, sy, z, col, ttype, tilled, crop, bio, tx, ty, elev) {
    if (!CWE) {
      // Emergency fallback if engine missing: flat fill only
      flatTile(g, sx, sy, col, null);
      return;
    }
    CWE.drawCell({
      g, sx, sy, z, ISO_HW, ISO_HH,
      col, ttype, tilled, crop, bio, tx, ty, elev,
      def: _pdef, frame: _frame,
      ART: (typeof ART !== "undefined") ? ART : null,
    });
  }
  function drawDioramaCliff(g, sx, sy, z, col, ch, face, waterfall, lava) {
    if (!CWE) return;
    CWE.drawCliff({
      g, sx, sy, z, ISO_HW, ISO_HH, col, ch, face, waterfall, lava, frame: _frame,
      def: _pdef,
      ART: (typeof ART !== "undefined") ? ART : null,
    });
  }

  // 3-face ISO box  (top + left + right)
  function isoBox(g, sx, sy, hw, hh, bh, topC, lC, rC, out) {
    const lw = out ? Math.max(0.5, _cam.z) : 0;
    g.beginPath();
    g.moveTo(sx, sy-hh-bh); g.lineTo(sx+hw, sy-bh); g.lineTo(sx, sy+hh-bh); g.lineTo(sx-hw, sy-bh);
    g.closePath(); g.fillStyle = topC; g.fill();
    if (out) { g.strokeStyle=out; g.lineWidth=lw; g.stroke(); }
    g.beginPath();
    g.moveTo(sx-hw, sy-bh); g.lineTo(sx, sy+hh-bh); g.lineTo(sx, sy+hh); g.lineTo(sx-hw, sy);
    g.closePath(); g.fillStyle = lC; g.fill();
    if (out) g.stroke();
    g.beginPath();
    g.moveTo(sx+hw, sy-bh); g.lineTo(sx, sy+hh-bh); g.lineTo(sx, sy+hh); g.lineTo(sx+hw, sy);
    g.closePath(); g.fillStyle = rC; g.fill();
    if (out) g.stroke();
  }

  // Shade an rgb() or #RRGGBB string darker by factor (0–1).
  // MUST handle hex: road/marking tileColors are hex, and naively regex-ing
  // digits out of "#B9AE97" produced an invalid fillStyle — canvas silently
  // kept the PREVIOUS fill color (the bright-green grout-line bug).
  function darker(col, f) {
    if (col && col[0] === '#' && col.length >= 7) {
      const n = parseInt(col.slice(1, 7), 16);
      return `rgb(${((n>>16&255)*f)|0},${((n>>8&255)*f)|0},${((n&255)*f)|0})`;
    }
    const m = col.match(/\d+/g);
    if (!m || m.length < 3) return col;
    return `rgb(${m[0]*f|0},${m[1]*f|0},${m[2]*f|0})`;
  }

  // ── WORLD GENERATION ────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  //  PROCEDURAL CITY GENERATOR — one blueprint, many cultures.
  //
  //  Every town follows the same rules (that's the blueprint): a paved civic
  //  plaza holding ALL the interactive buildings — City Hall, Hotel, Cantina,
  //  Trade Guild, Market Hall — around the planet's monument; a downtown whose
  //  towers are tallest at its anchor and thin outward; residential lots that
  //  face the streets; a few utility structures on the edges so the place reads
  //  worked-in; a gate arch where the highway enters.
  //
  //  What CHANGES per planet is the street culture (def.city.pattern):
  //    grid    — surveyed colonial blocks (Mira: the metropolis)
  //    radial  — rings + spokes around the plaza (Cinder: a defensive
  //              stockade; Dusk: the same instinct, huddled tight for warmth)
  //    strip   — one long caravan boulevard, bazaar at the middle (Sorn)
  //    organic — a wandering main drag with branches, grown not planned
  //              (Vesper's mining warren)
  //  …and the seeded jitter inside the pattern: avenue positions, plaza spot,
  //  spoke counts, building draws. Deterministic from the world seed — each
  //  save rolls its own towns once, then they're stable across every landing.
  function buildCity(rnd, def, ctx) {
    const { tiles, ok, I, CX, CY, CW, CH } = ctx;
    const buildings = [], carRoutes = [], pedRoutes = [];
    const cconf = def.city || {};
    const MON   = cconf.monument || 'obelisk';
    const SKYLINES = {
      towers:     ['sky_deco','sky_glass','sky_rect','sky_cyl','sky_med','sky_glass'],   // metropolis
      industrial: ['silo','cargo_bay','water_tower','sky_med','blacksmith','silo'],      // mining town
      frontier:   ['round_guard','blacksmith','barracks','apartment_b','round_guard','town_house_c'],
      low:        ['town_house','apartment_b','town_house_c','city_inn','apartment','town_house_b'],
      market:     ['city_market','city_shop','sky_med','city_market','city_shop','city_inn'],
    };
    const SKY   = SKYLINES[cconf.skyline || 'towers'] || SKYLINES.towers;
    // housing variety: three house types + two apartment types mixed through
    // the residential fill so streets don't repeat one silhouette
    const SMALL = ['town_house','apartment','city_shop','town_house_b','city_inn','town_house_c','blacksmith','apartment_b'];
    const UTIL  = ['water_tower','power_station','med_bay','repair_shop','comms_tower','barracks','ore_depot'];

    // ── local-coord road painting + occupancy ────────────────────────────────
    // All geometry below is in city-local coords (0..CW, 0..CH); world = C+local.
    const roadSet = new Set(), occ = new Set();
    const inC = (x,y) => x>=0 && x<=CW && y>=0 && y<=CH;
    const R = (x,y) => { x=Math.round(x); y=Math.round(y);
      if (!inC(x,y) || !ok(CX+x,CY+y)) return;
      tiles[I(CX+x,CY+y)] = T_ROAD; roadSet.add(x+','+y); };
    const isRoad   = (x,y) => roadSet.has(x+','+y);
    const nearRoad = (x,y,d) => { for (let dy=-d;dy<=d;dy++) for (let dx=-d;dx<=d;dx++) if (isRoad(x+dx,y+dy)) return true; return false; };
    const line = (x0,y0,x1,y1,twoLane) => {
      const n = Math.max(1, Math.max(Math.abs(x1-x0), Math.abs(y1-y0))|0);
      for (let i=0;i<=n;i++){ const x=x0+(x1-x0)*i/n, y=y0+(y1-y0)*i/n; R(x,y);
        if (twoLane){ if (Math.abs(x1-x0) >= Math.abs(y1-y0)) R(x,y+1); else R(x+1,y); } } };
    const ring = (cx,cy,r) => { const n=Math.max(12,(2*Math.PI*r*1.6)|0);
      for (let i=0;i<n;i++){ const a=i/n*2*Math.PI; R(cx+Math.cos(a)*r, cy+Math.sin(a)*r); } };
    const disc = (cx,cy,r) => { for (let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++)
      for (let x=Math.floor(cx-r);x<=Math.ceil(cx+r);x++) if (Math.hypot(x-cx,y-cy)<=r) R(x,y); };

    // Occupancy-aware building placement. `r` = clearance radius: tall towers
    // demand 2 (they're visually wide), houses 1. Local x 0..1 stays clear —
    // the home↔city connector road runs up that column (section 10).
    const canPut = (x,y,r) => {
      if (!inC(x,y) || x<2 || isRoad(x,y)) return false;
      if (!ok(CX+x,CY+y) || tiles[I(CX+x,CY+y)] !== T_GRASS) return false;
      for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) if (occ.has((x+dx)+','+(y+dy))) return false;
      return true; };
    const put = (x,y,type,r) => { if (!canPut(x,y,r??1)) return false;
      buildings.push({ x:CX+x, y:CY+y, type }); occ.add(x+','+y); return true; };

    // ── street pattern (the planet's culture) ────────────────────────────────
    let px=11, py=11, pr=2.3;      // plaza centre + radius
    let ax=11, ay=11, ar=5;        // downtown anchor + falloff radius
    const V = (x,y) => ({ tx:CX+x, ty:CY+y });   // route waypoint → world coords
    const pattern = cconf.pattern || 'grid';

    if (pattern === 'grid') {
      // Surveyed blocks: 3 avenues × 3 streets at seeded positions + ring road.
      const av = [3+((rnd()*3)|0), 11+((rnd()*2)|0), 17+((rnd()*2)|0)];
      const st = [3+((rnd()*3)|0), 10+((rnd()*2)|0), 16+((rnd()*3)|0)];
      for (const x of av) line(x,1,x,CH-1);
      line(av[1]+1,1,av[1]+1,CH-1);                    // main avenue: two lanes
      for (const y of st) line(1,y,CW-1,y);
      line(1,st[1]+1,CW-1,st[1]+1);                    // main street: two lanes
      line(1,1,CW-1,1); line(1,CH-1,CW-1,CH-1);        // ring road
      line(1,1,1,CH-1); line(CW-1,1,CW-1,CH-1);
      // market square off the crossing (the ADMIN plaza is placed separately below)
      for (let y=st[0]+1;y<=st[0]+4;y++) for (let x=av[1]-5;x<=av[1]-1;x++) R(x,y);
      ax = av[1]; ay = st[1]; ar = 5.5;                // downtown at the central crossing
      carRoutes.push(
        [V(av[0]+.5,st[0]+.5),V(av[1]+.5,st[0]+.5),V(av[1]+.5,st[1]+.5),V(av[0]+.5,st[1]+.5)],
        [V(av[1]+.5,st[1]+.5),V(av[2]+.5,st[1]+.5),V(av[2]+.5,st[2]+.5),V(av[1]+.5,st[2]+.5)],
        [V(1.5,1.5),V(CW-.5,1.5),V(CW-.5,CH-.5),V(1.5,CH-.5)],
        [V(av[1]+.5,1.5),V(av[1]+.5,CH-.5)]);
    }
    else if (pattern === 'radial') {
      // Rings + spokes around a central plaza. `compact` pulls everything in
      // tight (Dusk huddles against the cold); frontier towns garrison the
      // spoke tips with watch towers.
      const cx0 = 10+((rnd()*3)|0), cy0 = 10+((rnd()*3)|0);
      const r1 = cconf.compact ? 3.5 : 4.5, r2 = cconf.compact ? 6.5 : 8.5;
      disc(cx0, cy0, 2.2);   // paved central roundabout (admin plaza placed separately)
      ring(cx0, cy0, r1); ring(cx0, cy0, r2);
      const k = 4+((rnd()*3)|0), a0 = rnd()*Math.PI;
      const tips = [];
      for (let i=0;i<k;i++){
        const a = a0 + i/k*2*Math.PI;
        const ex = cx0+Math.cos(a)*(r2+2.5), ey = cy0+Math.sin(a)*(r2+2.5);
        line(cx0+Math.cos(a)*2, cy0+Math.sin(a)*2, ex, ey);
        tips.push([Math.round(ex), Math.round(ey)]);
      }
      ax = cx0; ay = cy0; ar = r1+1.5;
      if (cconf.skyline === 'frontier') for (const [gx,gy] of tips) put(gx,gy,'round_guard',1);
      const loop = (r) => { const pts=[]; for (let i=0;i<10;i++){ const a=i/10*2*Math.PI;
        pts.push(V(cx0+Math.cos(a)*r, cy0+Math.sin(a)*r)); } return pts; };
      carRoutes.push(loop(r1), loop(r2), [V(cx0+.5,cy0-r2),V(cx0+.5,cy0+r2)]);
    }
    else if (pattern === 'strip') {
      // One long caravan boulevard with a kink, side alleys, bazaar mid-strip.
      const by = 9+((rnd()*4)|0), by2 = by + (rnd()<0.5?-1:1);
      line(1,by,8,by,true); line(8,by,14,by2,true); line(14,by2,CW-1,by2,true);
      const alleys = [];
      for (let i=0;i<5;i++){ const x=3+((rnd()*(CW-6))|0); alleys.push(x); line(x,by-4,x,by+4); }
      // bazaar paving mid-strip (the ADMIN plaza is placed separately below)
      for (let y=Math.min(by,by2)-1;y<=Math.max(by,by2)+2;y++) for (let x=8;x<=14;x++) R(x,y);
      ax = 11; ay = by; ar = 4.5;
      carRoutes.push(
        [V(1.5,by-.5),V(8,by-.5),V(14,by2-.5),V(CW-1.5,by2-.5),
         V(CW-1.5,by2+1.5),V(14,by2+1.5),V(8,by+1.5),V(1.5,by+1.5)],
        [V(alleys[0]+.5,by-3.5),V(alleys[0]+.5,by+3.5)]);
    }
    else {   // 'organic' — a main drag that wanders, grown not planned
      let wx = 1, wy = 9+((rnd()*5)|0); const pts = [[wx,wy]];
      while (wx < CW-1){
        wx++; if (rnd()<0.45) wy += rnd()<0.5?-1:1;
        wy = Math.max(3, Math.min(CH-3, wy));
        R(wx,wy); R(wx,wy+1); pts.push([wx,wy]);
      }
      for (let b=0;b<4;b++){    // branches wander off the main drag
        const p = pts[3+((rnd()*(pts.length-6))|0)];
        let bx=p[0], byy=p[1]; const dir=rnd()<0.5?-1:1, len=5+((rnd()*6)|0);
        for (let i2=0;i2<len;i2++){ byy+=dir; if (rnd()<0.35) bx+=rnd()<0.5?-1:1;
          bx=Math.max(2,Math.min(CW-2,bx)); if (byy<2||byy>CH-2) break; R(bx,byy); }
      }
      const mid = pts[(pts.length/2)|0];
      disc(mid[0], mid[1], 2.2);   // paved junction square (admin plaza placed separately)
      ax = mid[0]; ay = mid[1]; ar = 4.5;
      const wp = []; for (let i2=0;i2<pts.length;i2+=4) wp.push(V(pts[i2][0]+.5, pts[i2][1]+.5));
      wp.push(V(pts[pts.length-1][0]+.5, pts[pts.length-1][1]+.5));
      carRoutes.push(wp.concat(wp.slice(1,-1).reverse()), [V(px+.5,py-3),V(px+.5,py+3)]);
    }

    // ── TWO DISTRICTS ───────────────────────────────────────────────────────
    // ISO draws higher (tx+ty) later = "in front". Pad approaches from the south
    // (high world-Y). Put ADMIN on the approach edge (high local y) so skyline
    // downtown sits BEHIND (lower local y) and never occludes interactive halls.
    //
    //   ┌─ DOWNTOWN (skyline, tall) ─┐  local y ~ 2..9
    //   │                            │
    //   │     avenue                 │
    //   │                            │
    //   └─ CITY HALL DISTRICT ───────┘  local y ~ CH-8..CH-2  (faces pad)
    //
    px = Math.max(4, Math.min(CW - 4, 11 + ((rnd() * 3) | 0) - 1));  // near mid X
    py = Math.max(CH - 6, Math.min(CH - 3, CH - 4.5));                 // south edge
    pr = 2.6;
    // Downtown anchor: north half of the city footprint
    ax = Math.max(5, Math.min(CW - 5, 11 + ((rnd() * 3) | 0) - 1));
    ay = Math.max(4, Math.min(9, 5 + ((rnd() * 3) | 0)));
    ar = 5.5;

    disc(px, py, 2.4);                                   // admin plaza paving
    disc(ax, ay, 1.6);                                   // downtown plaza paving
    line(px, py, ax, ay, true);                          // ceremonial avenue

    // Entry from west edge → admin plaza (home↔city connector hits col 0..1)
    const gy = Math.max(2, Math.min(CH - 2, Math.round(py)));
    line(0, gy, Math.round(px), gy);
    buildings.push({ x: CX + 1, y: CY + gy, type: 'city_gate' }); occ.add('1,' + gy);
    carRoutes.push([V(1.5, gy + .5), V(px + .5, gy + .5), V(ax + .5, ay + .5), V(px + .5, gy + .5)]);

    // Admin exclusion: nothing tall may enter this zone (world occlusion + playability)
    const adminClear = (x, y, rExtra) => Math.hypot(x - px, y - py) < (pr + (rExtra || 5.5));
    // Also block skyline south of admin (in front of hall toward camera)
    const blocksAdminView = (x, y) => (y >= py - 1) && Math.abs(x - px) < pr + 6;

    // ── CITY HALL DISTRICT — interactive buildings only, ringed around plaza ─
    const mx = Math.round(px), my = Math.round(py);
    buildings.push({ x: CX + mx, y: CY + my, type: MON }); occ.add(mx + ',' + my);
    // Fixed compass slots around plaza so halls aren't buried under spiral chaos
    const civicSlots = [
      [0, -2], [2, -1], [-2, -1], [2, 1], [-2, 1], [0, 2], [3, 0], [-3, 0],
      [1, -2], [-1, -2], [1, 2], [-1, 2],
    ];
    const CIVIC = ['city_hall', 'hotel', 'cantina', 'traders_guild', 'city_market'];
    for (let ci = 0; ci < CIVIC.length; ci++) {
      let done = false;
      for (const [dx, dy] of civicSlots) {
        if (put(mx + dx, my + dy, CIVIC[ci], 1)) { done = true; break; }
      }
      if (!done) {
        for (let rr = 2; rr <= 8 && !done; rr++)
          for (let dy = -rr; dy <= rr && !done; dy++)
            for (let dx = -rr; dx <= rr && !done; dx++) {
              if (Math.abs(dx) !== rr && Math.abs(dy) !== rr) continue;
              // keep civic south of downtown (local y >= py-3)
              if (my + dy < py - 3) continue;
              done = put(mx + dx, my + dy, CIVIC[ci], 1);
            }
      }
    }

    // ── DOWNTOWN — tall skyline only around north anchor ────────────────────
    let talls = 0;
    for (let t = 0; t < 160 && talls < 12; t++) {
      const a = rnd() * Math.PI * 2, d = rnd() * ar * 1.35;
      const x = Math.round(ax + Math.cos(a) * d), y = Math.round(ay + Math.sin(a) * d);
      if (y > (ay + ar * 0.85)) continue;              // stay in north district
      if (adminClear(x, y, 6.5) || blocksAdminView(x, y)) continue;
      if (!nearRoad(x, y, 2)) continue;
      if (put(x, y, SKY[talls % SKY.length], 2)) talls++;
    }
    let mids = 0;
    for (let t = 0; t < 150 && mids < 10; t++) {
      const a = rnd() * Math.PI * 2, d = ar * 0.6 + rnd() * ar * 1.1;
      const x = Math.round(ax + Math.cos(a) * d), y = Math.round(ay + Math.sin(a) * d);
      if (adminClear(x, y, 5) || blocksAdminView(x, y)) continue;
      if (!nearRoad(x, y, 2)) continue;
      if (put(x, y, rnd() < 0.55 ? 'apartment' : 'sky_med', 1)) mids++;
    }

    // ── residential scatter — low buildings, never in admin clear zone ──────
    let homes = 0;
    for (let t = 0; t < 460 && homes < 40; t++) {
      const x = 2 + ((rnd() * (CW - 3)) | 0), y = 1 + ((rnd() * (CH - 1)) | 0);
      if (adminClear(x, y, 4)) continue;
      if (!nearRoad(x, y, homes < 28 ? 1 : 2)) continue;
      if (put(x, y, SMALL[(rnd() * SMALL.length) | 0], 1)) homes++;
    }
    let utils = 0;
    for (let t = 0; t < 60 && utils < 6; t++) {
      const x = 2 + ((rnd() * (CW - 3)) | 0), y = 1 + ((rnd() * (CH - 1)) | 0);
      if (adminClear(x, y, 4) || Math.hypot(x - ax, y - ay) < ar * 0.5) continue;
      if (!nearRoad(x, y, 2)) continue;
      if (put(x, y, UTIL[(rnd() * UTIL.length) | 0], 1)) utils++;
    }

    // ── pedestrian routes — foot traffic thickest around the plaza ───────────
    const roadArr = [...roadSet].map(k => k.split(',').map(Number));
    const nearPlaza = roadArr.filter(([x,y]) => Math.hypot(x-px,y-py) < 6);
    const pick = (arr) => arr[(rnd()*arr.length)|0];
    for (let i=0;i<8;i++){
      const pool = (i<4 && nearPlaza.length>4) ? nearPlaza : roadArr;
      const a2 = pick(pool);
      const aligned = pool.filter(q => (q[0]===a2[0]) !== (q[1]===a2[1]) &&
        Math.abs(q[0]-a2[0]) + Math.abs(q[1]-a2[1]) >= 3);
      const b2 = aligned.length ? pick(aligned) : pick(pool);
      pedRoutes.push([V(a2[0]+.5,a2[1]+.5), V(b2[0]+.5,b2[1]+.5)]);
    }

    return { buildings, carRoutes, pedRoutes, plaza:{ x:CX+px, y:CY+py, r:pr }, downtown:{ x:CX+ax, y:CY+ay, r:ar } };
  }

  function genWorld(seed, def) {
    def = def || PLANET_DEFS.mira;
    // Always normalize so ad-hoc / test defs get locked proc knobs
    if (CWE && (!def.proc || def._engineVersion !== CWE.VERSION)) {
      try { def = CWE.normalizeRecipe(def); } catch (_) { /* keep raw */ }
    }
    rngSeed(seed);
    const I  = (x, y) => y * MAP_W + x;
    const ok = (x, y) => x >= 0 && x < MAP_W && y >= 0 && y < MAP_H;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const tiles   = new Uint8Array(MAP_W * MAP_H);
    const biomeA  = new Uint8Array(MAP_W * MAP_H);
    const elevA   = new Uint8Array(MAP_W * MAP_H);

    // Home pad — SW corner with room for farm plots between pad and city road
    const HX = 14, HY = MAP_H - 16;

    // ─ 1. island heightmap — larger continent, less ocean fringe ────────────
    const hN = makeNoise(12);
    const cx = MAP_W/2, cy = MAP_H/2;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const dx = (x-cx)/(MAP_W*0.48), dy = (y-cy)/(MAP_H*0.46);
      // Soft continent + coastal noise — more walkable interior
      const h = hN(x*0.55, y*0.55)*0.55 + hN(x*1.1, y*1.1)*0.25
              - Math.sqrt(dx*dx+dy*dy)*0.78 + 0.42;
      tiles[I(x,y)] = h > 0.14 ? T_GRASS : T_WATER;
    }
    // Solid land bubble around pad + homestead farm belt (NE of pad toward city)
    const HOME_LAND_R = 14;
    for (let y = HY-HOME_LAND_R; y <= HY+HOME_LAND_R; y++) for (let x = HX-HOME_LAND_R; x <= HX+HOME_LAND_R; x++) {
      if (!ok(x,y)) continue;
      const dx=x-HX, dy=y-HY;
      if (Math.sqrt(dx*dx+dy*dy)<=HOME_LAND_R) tiles[I(x,y)]=T_GRASS;
    }
    // Homestead rectangle: flat farmable land between pad and road (playability)
    const FARM_X0 = HX - 2, FARM_X1 = HX + 18, FARM_Y0 = HY - 14, FARM_Y1 = HY + 2;
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (ok(x,y)) tiles[I(x,y)] = T_GRASS;
    }

    // ─ 2. winding river — steers clear of homestead + pad ─────────────────
    {
      let rx = Math.floor(MAP_W*0.42 + rnd()*MAP_W*0.22);
      for (let ry = 0; ry < MAP_H; ry++) {
        // Push river east if too close to pad/farm
        if (rx < FARM_X1 + 6) rx = FARM_X1 + 6 + ((rnd()*4)|0);
        for (let w = -1; w <= 1; w++) {
          const wx = rx + w;
          if (!ok(wx, ry)) continue;
          // never carve through homestead or pad ring
          if (Math.hypot(wx-HX, ry-HY) < 11) continue;
          if (wx >= FARM_X0-1 && wx <= FARM_X1+1 && ry >= FARM_Y0-1 && ry <= FARM_Y1+1) continue;
          tiles[I(wx, ry)] = T_WATER;
        }
        if (rnd() < 0.42) rx += Math.floor(rnd()*3) - 1;
        rx = Math.max(FARM_X1 + 5, Math.min(MAP_W-5, rx));
      }
    }

    // ─ 3. lake (inland, away from pad) ────────────────────────────────────
    {
      const lx = Math.floor(MAP_W*0.58 + rnd()*12);
      const ly = Math.floor(MAP_H*0.22 + rnd()*10);
      const lr = 3 + Math.floor(rnd()*3);
      for (let y = ly-lr; y <= ly+lr; y++) for (let x = lx-lr; x <= lx+lr; x++) {
        if (!ok(x,y)) continue;
        if (Math.hypot(x-HX, y-HY) < 16) continue;
        if ((x-lx)*(x-lx)/(lr*lr*1.2) + (y-ly)*(y-ly)/(lr*lr*0.8) < 1)
          tiles[I(x,y)] = T_WATER;
      }
    }

    // ─ 4. Voronoi biome regions ────────────────────────────────────────────
    // Moon: mostly highland/mare rock (desert/mountain), almost no "jungle"
    const isMoon = def.worldType === 'moon';
    const BIOME_CYCLE = isMoon
      ? [B_DESERT, B_MOUNTAIN, B_DESERT, B_MOUNTAIN, B_GRASS, B_DESERT, B_MOUNTAIN, B_DESERT]
      : [B_GRASS, B_JUNGLE, B_DESERT, B_MOUNTAIN, B_JUNGLE, B_GRASS, B_MOUNTAIN, B_DESERT];
    const regionPts = [{ x: HX, y: HY, b: isMoon ? B_DESERT : B_GRASS }];
    for (let i = 1; i < 8; i++) {
      regionPts.push({ x: 8 + Math.floor(rnd()*(MAP_W-16)), y: 8 + Math.floor(rnd()*(MAP_H-16)), b: BIOME_CYCLE[i] });
    }
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let best = 0, bd = 1e9;
      for (let i = 0; i < regionPts.length; i++) {
        const dx = x-regionPts[i].x, dy = y-regionPts[i].y;
        const d = dx*dx + dy*dy;
        if (d < bd) { bd = d; best = i; }
      }
      biomeA[I(x,y)] = regionPts[best].b;
    }
    // Homestead: meadow on planets; flat mare dust on moons (still farmable)
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (ok(x,y)) biomeA[I(x,y)] = isMoon ? B_DESERT : B_GRASS;
    }

    // Moon: punch circular impact craters (shadow pits = T_WATER, deep black)
    if (isMoon) {
      const nCraters = 14 + ((rnd() * 8) | 0);
      for (let c = 0; c < nCraters; c++) {
        const cx = 8 + ((rnd() * (MAP_W - 16)) | 0);
        const cy = 8 + ((rnd() * (MAP_H - 16)) | 0);
        if (Math.hypot(cx - HX, cy - HY) < 14) continue;
        if (cx >= FARM_X0 - 2 && cx <= FARM_X1 + 2 && cy >= FARM_Y0 - 2 && cy <= FARM_Y1 + 2) continue;
        const R = 2 + ((rnd() * 4) | 0); // 2–5 tile radius
        for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
          if (!ok(x, y)) continue;
          const d = Math.hypot(x - cx, (y - cy) * 1.15);
          if (d < R * 0.55) {
            tiles[I(x, y)] = T_WATER; // deep void floor
            elevA[I(x, y)] = 0;
          } else if (d < R && tiles[I(x, y)] === T_GRASS) {
            // raised rim
            biomeA[I(x, y)] = B_MOUNTAIN;
          }
        }
      }
    }

    // ─ 5. elevation (chunky plateaus) — knobs from ClayWorldEngine.proc ────
    const isL = (x, y) => ok(x,y) && tiles[I(x,y)] === T_GRASS;
    const eN = makeNoise(6);
    const proc = (def.proc) || (CWE && CWE.DEFAULT_PROC) || {};
    const diorama = CWE ? CWE.isDiorama(def) : def.ground === 'diorama';
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (!isL(x,y)) { elevA[I(x,y)] = 0; continue; }
      const noise = eN(x*0.65, y*0.65);
      if (CWE && diorama) {
        elevA[I(x,y)] = CWE.elevTier(noise, biomeA[I(x,y)], proc);
      } else {
        let e = noise;
        if (biomeA[I(x,y)] === B_MOUNTAIN) e += 0.22;
        else if (biomeA[I(x,y)] === B_JUNGLE) e -= 0.10;
        elevA[I(x,y)] = e > 0.88 ? 4 : e > 0.72 ? 3 : e > 0.56 ? 2 : 1;
      }
    }
    // Flatten homestead for easy tilling (no cliff farms)
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (ok(x,y) && tiles[I(x,y)]===T_GRASS) elevA[I(x,y)] = 1;
    }
    // majority-vote smoothing → no single-tile spires
    for (let pass = 0; pass < 2; pass++) {
      const nx = new Uint8Array(elevA);
      for (let y = 1; y < MAP_H-1; y++) for (let x = 1; x < MAP_W-1; x++) {
        if (!isL(x,y)) continue;
        const cnt = [0,0,0,0,0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
          if (isL(x+dx,y+dy)) cnt[elevA[I(x+dx,y+dy)]]++;
        let best = 1, bc = -1;
        for (let e = 1; e <= MAX_ELEV; e++) if (cnt[e] > bc) { bc=cnt[e]; best=e; }
        nx[I(x,y)] = best;
      }
      elevA.set(nx);
    }
    // flatten home zone so no cliff cuts the start area
    const hElev = elevA[I(HX, HY)] || 1;
    for (let y = HY-6; y <= HY+6; y++) for (let x = HX-6; x <= HX+6; x++) {
      if (!ok(x,y) || !isL(x,y)) continue;
      const dx = x-HX, dy = y-HY;
      if (Math.sqrt(dx*dx+dy*dy) <= 6) elevA[I(x,y)] = hElev;
    }

    // ─ 6. per-tile colours (B&B tileCol algorithm) ────────────────────────
    // BFS to get distance-to-land (for water depth gradient)
    const ldist = new Int16Array(MAP_W*MAP_H).fill(99);
    const bfsQ = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (tiles[I(x,y)] === T_GRASS) { ldist[I(x,y)] = 0; bfsQ.push(x | (y<<16)); }
    }
    let qh = 0;
    while (qh < bfsQ.length) {
      const v = bfsQ[qh++];
      const px = v & 0xffff, py = v >> 16;
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = px+dx, ny = py+dy;
        if (ok(nx,ny) && ldist[I(nx,ny)] > ldist[I(px,py)]+1) {
          ldist[I(nx,ny)] = ldist[I(px,py)]+1; bfsQ.push(nx|(ny<<16));
        }
      }
    }

    const h2rgb = h => { const p = parseInt(h.slice(1),16); return [(p>>16)&255,(p>>8)&255,p&255]; };
    // Per-planet biome palette [GRASS, JUNGLE, DESERT, MOUNTAIN] from the def.
    // LO = shaded/low patches, HI = sunlit patches; the renderer noise-blends them.
    const LO = def.biomeLO.map(h2rgb);
    const HI = def.biomeHI.map(h2rgb);
    const WSH = h2rgb(def.water[0]), WDP = h2rgb(def.water[1]);   // shallow → deep (lava on Cinder)
    const mix = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];

    const cN1 = makeNoise(9), cN2 = makeNoise(21);
    const tileColors = new Array(MAP_W*MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let c;
      if (tiles[I(x,y)] === T_WATER) {
        const t = clamp((ldist[I(x,y)]-1)/5 + (cN1(x,y)-0.5)*0.14, 0, 1);
        c = mix(WSH, WDP, t);
      } else {
        const bio = biomeA[I(x,y)];
        const t = clamp(0.55*cN1(x,y) + 0.45*cN2(x*1.7+9, y*1.7+4), 0, 1);
        c = [...mix(LO[bio], HI[bio], t)];
        // shore tint
        if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => ok(x+dx,y+dy) && tiles[I(x+dx,y+dy)]===T_WATER))
          c = [c[0]*0.93, c[1]*0.93, c[2]*0.94];
        // biome blending at boundaries
        let bn = 1;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          if (!isL(x+dx,y+dy)) continue;
          const ob = biomeA[I(x+dx,y+dy)];
          if (ob !== bio) {
            const ot = clamp(0.55*cN1(x,y)+0.45*cN2(x*1.7+9, y*1.7+4), 0, 1);
            const oc = mix(LO[ob], HI[ob], ot);
            c = [c[0]+oc[0], c[1]+oc[1], c[2]+oc[2]]; bn++;
          }
        }
        if (bn > 1) c = [c[0]/bn, c[1]/bn, c[2]/bn];
      }
      tileColors[I(x,y)] = `rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
    }

    // ─ 7. resource nodes (clustered, B&B growClump) ───────────────────────
    const nodes = [];
    const nodeSet = new Set();
    const nk = (x,y) => `${x},${y}`;
    const nodeOn = (x,y) => nodeSet.has(nk(x,y));

    const inFarm = (x, y) => x >= FARM_X0 && x <= FARM_X1 && y >= FARM_Y0 && y <= FARM_Y1;
    const addNode = (x, y, type) => {
      if (!ok(x,y)||!isL(x,y)||nodeOn(x,y)) return null;
      if (inFarm(x,y)) return null;   // homestead plots stay clear for tilling
      // Per-node size from ClayWorldEngine (rocks can be huge boulders).
      const scale = CWE
        ? CWE.nodeScale(type, x, y, proc)
        : (0.85 + hash2(x * 3 + 1, y * 7 + 2) * 0.45);
      const n = { x, y, type, id: nk(x,y), biome: biomeA[I(x,y)], scale };
      nodes.push(n); nodeSet.add(nk(x,y)); return n;
    };

    const growClump = (sx, sy, type, minN, maxN) => {
      if (!ok(sx,sy)||!isL(sx,sy)||nodeOn(sx,sy)) return;
      const target = minN + Math.floor(rnd()*(maxN-minN+1));
      let placed = 0;
      const frontier = [[sx,sy]], seen = new Set([nk(sx,sy)]);
      while (placed < target && frontier.length) {
        const fi = Math.floor(rnd()*frontier.length);
        const [x,y] = frontier.splice(fi,1)[0];
        if (!isL(x,y)||nodeOn(x,y)) continue;
        addNode(x,y,type); placed++;
        const spread = type==="tree" ? 0.55 : 0.88;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx=x+dx, ny=y+dy; if (!ok(nx,ny)) continue;
          const k=nk(nx,ny);
          if (!seen.has(k)&&!nodeOn(nx,ny)&&rnd()<spread) { seen.add(k); frontier.push([nx,ny]); }
        }
      }
    };

    const fN = makeNoise(7), rN = makeNoise(8), bN = makeNoise(9);
    const allowTree = !def.noTrees;
    const treeChance = def.sparseTrees ? 0.04 : 0.09;
    for (let y = 2; y < MAP_H-2; y++) for (let x = 2; x < MAP_W-2; x++) {
      if (!isL(x,y)||nodeOn(x,y)) continue;
      const bio = biomeA[I(x,y)];
      const f=fN(x,y), r=rN(x+40,y+40), b=bN(x+80,y+80);
      if (def.landOnlyRocks) {
        // Cinder-style: basalt/rock and sparse berries only — no forests
        if (r>0.62&&rnd()<0.14) growClump(x,y,"rock",3,6);
        else if (b>0.78&&rnd()<0.07) growClump(x,y,"berry",2,4);
        continue;
      }
      if (bio===B_JUNGLE) {
        if (b>0.62&&rnd()<0.12) growClump(x,y,"berry",3,5);
        else if (allowTree && f>0.66&&rnd()<0.10) growClump(x,y,"tree",2,4);
        else if (r>0.80&&rnd()<0.09) growClump(x,y,"rock",3,5);
      } else if (bio===B_DESERT) {
        if (r>0.72&&rnd()<0.11) growClump(x,y,"rock",3,5);
        else if (b>0.82&&rnd()<0.09) growClump(x,y,"berry",3,4);
        else if (allowTree && f>0.84&&rnd()<treeChance) growClump(x,y,"tree",2,3);
      } else if (bio===B_MOUNTAIN) {
        if (r>0.66&&rnd()<0.12) growClump(x,y,"rock",4,5);
        else if (b>0.78&&rnd()<0.08) growClump(x,y,"berry",3,4);
        else if (allowTree && f>0.76&&rnd()<0.07) growClump(x,y,"tree",2,4);
      } else {
        if (b>0.68&&rnd()<0.12) growClump(x,y,"berry",3,5);
        else if (allowTree && f>0.68&&rnd()<treeChance) growClump(x,y,"tree",2,4);
        else if (r>0.74&&rnd()<0.09) growClump(x,y,"rock",3,5);
      }
    }

    // clear home plaza + entire homestead farm belt of nodes
    const PLAZA = 7;
    const clearNodeAt = (x, y) => {
      const k = nk(x,y);
      if (!nodeSet.has(k)) return;
      const ni = nodes.findIndex(n => n.id === k);
      if (ni >= 0) nodes.splice(ni, 1);
      nodeSet.delete(k);
    };
    for (let y = HY-PLAZA-1; y <= HY+PLAZA+1; y++) for (let x = HX-PLAZA-1; x <= HX+PLAZA+1; x++) {
      if (!ok(x,y)) continue;
      if (Math.hypot(x-HX, y-HY) <= PLAZA) clearNodeAt(x, y);
    }
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (ok(x,y)) clearNodeAt(x, y);
    }

    // Starter resource grove WEST of pad (not in farm) — wood/stone/berry walkable in 1 minute
    const starterPack = def.noTrees || def.landOnlyRocks
      ? [["rock", 7, -8, -2], ["rock", 5, -5, 3], ["berry", 5, -9, 1]]
      : [["tree", 6, -8, -2], ["rock", 5, -6, 3], ["berry", 5, -9, 1]];
    for (const [type, cnt, ox0, oy0] of starterPack) {
      let placed = 0;
      for (let att = 0; att < 200 && placed < cnt; att++) {
        const x = HX + ox0 + ((rnd() * 5) | 0) - 2;
        const y = HY + oy0 + ((rnd() * 5) | 0) - 2;
        if (addNode(x, y, type)) placed++;
      }
    }
    // Second grove along the road toward city (gathers while traveling)
    for (const [type, cnt] of [["tree", 4], ["rock", 3], ["berry", 3]]) {
      let placed = 0;
      for (let att = 0; att < 180 && placed < cnt; att++) {
        const x = HX + 8 + ((rnd() * 14) | 0);
        const y = HY - 18 + ((rnd() * 8) | 0);
        if (inFarm(x, y)) continue;
        if (addNode(x, y, type)) placed++;
      }
    }

    // guarantee minimum resource counts on the full map (still skip farm)
    const minNodes = def.noTrees || def.landOnlyRocks
      ? [["rock", 40], ["berry", 22]]
      : [["tree", 32], ["rock", 26], ["berry", 28]];
    for (const [type, min] of minNodes) {
      let have = nodes.filter(n => n.type === type).length;
      for (let att = 0; att < 600 && have < min; att++) {
        const x = 2 + Math.floor(rnd() * (MAP_W - 4)), y = 2 + Math.floor(rnd() * (MAP_H - 4));
        if (Math.hypot(x - HX, y - HY) < PLAZA + 1) continue;
        if (addNode(x, y, type)) have++;
      }
    }

    // Homestead soil tint — warm farm-plot color so plots read as "till here"
    const FARM_SOIL = def.farmSoil || (def.name==='Cinder' ? '#6A4A38'
      : def.name==='Dusk' ? '#B8C8D8'
      : def.name==='Sorn' ? '#C8A060'
      : def.name==='Vesper' ? '#7A7088' : '#7A9A48');
    const FARM_ALT = def.farmSoilAlt || (def.name==='Cinder' ? '#5A3A2C'
      : def.name==='Dusk' ? '#A0B4C8'
      : def.name==='Sorn' ? '#B89050'
      : def.name==='Vesper' ? '#6A6080' : '#6E8E3C');
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (!ok(x, y) || tiles[I(x, y)] !== T_GRASS) continue;
      const hv = ((x + y) & 1) ? 1 : 0;
      tileColors[I(x, y)] = hv ? FARM_SOIL : FARM_ALT;
    }

    // ─ 9. city (pre-built settlement) + 9b. spaceport at the landing zone ──
    // Located in the upper-right quadrant, reachable by road from home base.
    // City position comes from the planet def — each world puts its town in a
    // different direction from the landing pad (NE on Mira, S on Cinder, N on
    // Dusk…), so every planet walks differently.
    const CX = def.cityXY[0], CY = def.cityXY[1], CW = 22, CH = 22;

    // Clear city footprint to flat land. tileColors was already painted per-biome
    // (incl. water blues) before the city existed, so tiles that used to be shore/
    // ocean must get a fresh ground color here too — otherwise houses end up
    // sitting on leftover ocean-blue tiles once tiles[] flips to T_GRASS.
    const CITY_GROUND = '#8C8478';
    for (let y = CY-1; y <= CY+CH+1; y++) for (let x = CX-1; x <= CX+CW+1; x++) {
      if (!ok(x,y)) continue;
      tiles[I(x,y)]  = T_GRASS;
      elevA[I(x,y)]  = 1;
      tileColors[I(x,y)] = CITY_GROUND;
      // remove any resource nodes inside city
      const k = `${x},${y}`;
      const ni = nodes.findIndex(n=>n.id===k);
      if (ni>=0) { nodes.splice(ni,1); nodeSet.delete(k); }
    }

    // ─ 9b. SPACEPORT — paved apron at the landing zone, apart from town ────
    // The player's touchdown pad IS the port: control tower, hangars, fuel,
    // freight, parked vessels. Ships land here, on the far side of the map
    // from the residents.
    const PORT_X0 = HX-5, PORT_X1 = HX+5, PORT_Y0 = HY-1, PORT_Y1 = HY+6;
    for (let y = PORT_Y0-1; y <= PORT_Y1+1; y++) for (let x = PORT_X0-1; x <= PORT_X1+1; x++) {
      if (!ok(x,y)) continue;
      // clear nodes on/next to the apron (same treatment as the city footprint)
      const k = `${x},${y}`;
      const ni = nodes.findIndex(n=>n.id===k);
      if (ni>=0) { nodes.splice(ni,1); nodeSet.delete(k); }
      if (tiles[I(x,y)] === T_WATER) continue;
      elevA[I(x,y)] = 1;   // flat apron, level with the connecting road
      tiles[I(x,y)] = (x>=PORT_X0 && x<=PORT_X1 && y>=PORT_Y0 && y<=PORT_Y1) ? T_ROAD : T_GRASS;
    }

    // ── PROCEDURAL CITY — streets, districts, buildings, routes ─────────────
    // buildCity lays the whole town from the planet's street culture
    // (def.city.pattern) + this world's seed: civic plaza with every
    // interactive building grouped around the monument, downtown skyline,
    // street-facing residential, utilities, gate. See buildCity above.
    const _cg = buildCity(rnd, def, { tiles, ok, I, CX, CY, CW, CH });
    const cityBuildings = _cg.buildings;

    // ══ SPACEPORT structures (at the landing zone, apart from town) ═════════
    // Per-planet variant via def.port: `flip` mirrors the whole port across the
    // pad's column (so it faces its town), `hangars` sets the bay count, and
    // `extra` adds one signature structure (ore cargo bay on Vesper, guard
    // tower on Cinder, comms relay on Dusk, water tower on Sorn).
    const PV   = def.port || {};
    const psgn = PV.flip ? -1 : 1;
    const PXm  = (o) => HX - o*psgn;              // mirror an x-offset when flipped
    cityBuildings.push({ x:PXm(4), y:HY-1, type:'ctrl_tower' });
    const hangarSlots = [[PXm(1),HY-1],[PXm(-2),HY-1],[PXm(4),HY+2]];
    for (let i=0; i<Math.min(PV.hangars ?? 3, hangarSlots.length); i++)
      cityBuildings.push({ x:hangarSlots[i][0], y:hangarSlots[i][1], type:'hangar' });
    cityBuildings.push({ x:PXm(4),  y:HY+5, type:'fuel_depot' });
    cityBuildings.push({ x:PXm(-3), y:HY+6, type:'cargo_bay'  });
    if (PV.extra) cityBuildings.push({ x:PXm(-4), y:HY+4, type:PV.extra });

    // ─ NPC cars — autonomous vehicles looping the generated street network ────
    const NPC_COLORS = ['#FF0066','#00FFCC','#FF6600','#00AAFF','#FF00FF','#00FF88','#FFEE00','#FF4488'];
    const npcCars = [];
    for (let i = 0; i < 8; i++) {
      const route = _cg.carRoutes[i % _cg.carRoutes.length];
      // Stagger start positions around the route
      const startIdx = Math.floor((i % 2) * route.length / 2) % route.length;
      const sp = route[startIdx], np = route[(startIdx + 1) % route.length];
      const frac = ((i * 3) % 7) / 7;
      npcCars.push({
        tx: sp.tx + (np.tx - sp.tx) * frac,
        ty: sp.ty + (np.ty - sp.ty) * frac,
        heading: 0,
        pathIdx: (startIdx + 1) % route.length,
        color: NPC_COLORS[i],
        speed: 0.55 + (i % 4) * 0.14,
        route,
      });
    }

    // ── NPC pedestrians — foot traffic on the generated streets, thickest
    //    around the civic plaza ───────────────────────────────────────────────
    const PED_COLS = ['#FF88CC','#66FFEE','#FFBB55','#BB88FF','#55FFBB','#FF6688','#88CCFF','#FFFFAA','#FF99DD','#99EEFF'];
    const npcPeds = [];
    for (let i = 0; i < 15; i++) {
      const route = _cg.pedRoutes[i % _cg.pedRoutes.length];
      const startIdx = i % route.length;
      const sp = route[startIdx], np = route[(startIdx + 1) % route.length];
      const frac = rnd();
      npcPeds.push({
        tx: sp.tx + (np.tx - sp.tx) * frac,
        ty: sp.ty + (np.ty - sp.ty) * frac,
        pathIdx: (startIdx + 1) % route.length,
        color: PED_COLS[i % PED_COLS.length],
        speed: 0.10 + rnd() * 0.06,
        route,
        legPhase: rnd() * Math.PI * 2,
      });
    }

    // ─ 10. connecting road pad → city (2-wide), keeps a grass farm strip free ─
    const ROAD_Y = Math.min(HY - 3, FARM_Y0 - 1);
    const hx0 = Math.min(HX+3, CX), hx1 = Math.max(HX+3, CX+1);
    for (let x = hx0; x <= hx1; x++) {
      if (ok(x, ROAD_Y))   { tiles[I(x, ROAD_Y)]   = T_ROAD; elevA[I(x, ROAD_Y)]   = 1; }
      if (ok(x, ROAD_Y+1)) { tiles[I(x, ROAD_Y+1)] = T_ROAD; elevA[I(x, ROAD_Y+1)] = 1; }
    }
    const vy0 = Math.min(ROAD_Y+1, CY+CH), vy1 = Math.max(ROAD_Y, CY);
    for (let y = vy0; y <= vy1; y++) {
      if (ok(CX,   y)) { tiles[I(CX,   y)] = T_ROAD; elevA[I(CX,   y)] = 1; }
      if (ok(CX+1, y)) { tiles[I(CX+1, y)] = T_ROAD; elevA[I(CX+1, y)] = 1; }
    }
    // Re-stamp farm grass where road overwrote the homestead (road runs above farm)
    for (let y = FARM_Y0; y <= FARM_Y1; y++) for (let x = FARM_X0; x <= FARM_X1; x++) {
      if (!ok(x,y)) continue;
      if (tiles[I(x,y)] === T_ROAD && y > ROAD_Y+1) { tiles[I(x,y)] = T_GRASS; elevA[I(x,y)] = 1; }
    }

    // ─ 11. road tile colors + runway markings + perimeter trees + parking ──────
    // Assign road color in tileColors so markup overrides work through the renderer
    for (let y2 = 0; y2 < MAP_H; y2++) for (let x2 = 0; x2 < MAP_W; x2++) {
      if (tiles[I(x2,y2)] === T_ROAD) tileColors[I(x2,y2)] = def.road;
    }
    // Space port apron centerline stripes (lighter stone) — at the landing zone
    for (let ty = PORT_Y0; ty <= PORT_Y1; ty++) {
      if ((ty - PORT_Y0) % 4 < 2 && ok(HX, ty)) tileColors[I(HX, ty)] = '#D8CDB2';
    }
    // Threshold markings at the apron's south edge — painted yellow
    for (let tx = HX-2; tx <= HX+2; tx++) {
      if (ok(tx, PORT_Y1) && tiles[I(tx, PORT_Y1)]===T_ROAD) tileColors[I(tx, PORT_Y1)] = '#E6C24A';
    }
    // Civic plaza gets a warmer flagstone tint than the streets
    for (let ty = CY+3; ty <= CY+8; ty++) for (let tx = CX+6; tx <= CX+12; tx++) {
      if (ok(tx, ty) && tiles[I(tx,ty)]===T_ROAD) tileColors[I(tx,ty)] = '#C9BC9E';
    }
    // Perimeter tree ring around city (top + bottom rows, spaced every 3 tiles)
    for (let tx = CX-2; tx <= CX+CW+2; tx += 3) {
      addNode(tx, CY-1, 'tree');
      addNode(tx, CY+CH+1, 'tree');
    }
    // Car spawn parking spot marker
    if (ok(CX+3, CY+CH+3)) tileColors[I(CX+3, CY+CH+3)] = '#C0A868';

    // ─ 12. scenery props — per-planet emoji set pieces (volcanos, snowmen, camels…)
    // Pure decoration: drawn in the entity pass, never block movement or actions.
    const props = [];
    for (const p of (def.props || [])) {
      for (let i = 0; i < p.n; i++) {
        for (let att = 0; att < 60; att++) {
          const x = 3 + Math.floor(rnd()*(MAP_W-6)), y = 3 + Math.floor(rnd()*(MAP_H-6));
          if (!isL(x,y) || nodeOn(x,y)) continue;
          if (x >= CX-2 && x <= CX+CW+2 && y >= CY-2 && y <= CY+CH+2) continue;    // keep out of town
          if (Math.hypot(x-HX, y-HY) < 10) continue;                               // and the landing zone
          if (props.some(q => Math.abs(q.x-x)<2 && Math.abs(q.y-y)<2)) continue;
          props.push({ x, y, e:p.e, big:!!p.big, phase:rnd()*6 });
          break;
        }
      }
    }

    // ─ 13. clay deco scatter (ground:'clay' | 'diorama') ──────────────────
    // Small 3D-clay prop billboards (grass tufts, flowers, pebbles, reeds…)
    // hash-scattered by biome over open land. Deterministic per seed (hash2 of
    // tile coords, not rnd(), so density tweaks never reshuffle the world).
    // Excluded: water/roads, the city + port footprints, the home plaza,
    // resource-node and emoji-prop tiles. One deco per tile, with sub-tile
    // jitter + size jitter so the meadow never reads as a grid.
    const deco = [];
    // Sprite carpet: on diorama + carpetAll, EVERY open grass tile gets a
    // full-tile grass/flower prop so no bare ground diamonds show through.
    // City apron / farm / pad stay clearer for readability.
    if (def.ground === 'clay' || def.ground === 'diorama') {
      const carpetAll = diorama && (proc.carpetAll !== false);
      const dense = diorama ? (proc.decoDense || 2.0) : 1.0;
      for (let y = 1; y < MAP_H-1; y++) for (let x = 1; x < MAP_W-1; x++) {
        if (tiles[I(x,y)] !== T_GRASS) continue;
        if (x >= CX-1 && x <= CX+CW+1 && y >= CY-1 && y <= CY+CH+1) continue;
        if (x >= PORT_X0-1 && x <= PORT_X1+1 && y >= PORT_Y0-1 && y <= PORT_Y1+1) continue;
        if (Math.hypot(x-HX, y-HY) < PLAZA+1) continue;
        if (x >= FARM_X0 && x <= FARM_X1 && y >= FARM_Y0 && y <= FARM_Y1) continue;
        if (nodeSet.has(`${x},${y}`)) continue;
        if (props.some(p => p.x===x && p.y===y)) continue;
        const bio = biomeA[I(x,y)];
        const h1 = hash2(x*13, y*7), h2 = hash2(x*29+5, y*17+3);
        let key = null;
        const nearWater = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) =>
          ok(x+dx,y+dy) && tiles[I(x+dx,y+dy)]===T_WATER);

        if (carpetAll) {
          if (isMoon) {
            // Lunar dust & rock only — no vegetation carpet
            if (nearWater) key = h2 < 0.5 ? 'stone_mossy' : 'pebble_cluster';
            else if (h1 < 0.22) key = 'pebble_cluster';
            else if (h1 < 0.38) key = 'stone_mossy';
            else if (h1 < 0.48) key = h2 < 0.5 ? 'stump_small' : 'bush_round'; // debris
            else key = h2 < 0.5 ? 'grass_tuft_a' : 'grass_tuft_b'; // dust ridges
          } else if (nearWater) key = h2 < 0.55 ? 'reed_clump' : 'grass_tuft_a';
          else if (bio === B_JUNGLE) key = h2 < 0.4 ? 'bush_round' : (h2 < 0.7 ? 'grass_tuft_a' : 'grass_tuft_b');
          else if (bio === B_DESERT) key = h2 < 0.35 ? 'pebble_cluster' : (h2 < 0.55 ? 'stone_mossy' : 'grass_tuft_b');
          else if (bio === B_MOUNTAIN) key = h2 < 0.45 ? 'stone_mossy' : (h2 < 0.7 ? 'pebble_cluster' : 'grass_tuft_b');
          else {
            if (h1 < 0.18) key = h2 < 0.5 ? 'flower_white' : 'flower_pink';
            else if (h1 < 0.28) key = 'bush_round';
            else if (h1 < 0.34) key = h2 < 0.5 ? 'pebble_cluster' : 'stump_small';
            else key = h2 < 0.5 ? 'grass_tuft_a' : 'grass_tuft_b';
          }
        } else {
          if (nearWater) { if (h1 < 0.30 * dense) key = 'reed_clump'; }
          else if (bio === B_GRASS) {
            if      (h1 < 0.16 * dense) key = h2 < 0.5 ? 'grass_tuft_a' : 'grass_tuft_b';
            else if (h1 < 0.21 * dense) key = h2 < 0.5 ? 'flower_white' : 'flower_pink';
            else if (h1 < 0.24 * dense) key = h2 < 0.5 ? 'pebble_cluster' : 'stone_mossy';
            else if (h1 < 0.25 * dense) key = h2 < 0.5 ? 'bush_round' : 'stump_small';
          } else if (bio === B_JUNGLE) {
            if (h1 < 0.18 * dense) key = h2 < 0.5 ? 'grass_tuft_a' : 'bush_round';
          } else if (bio === B_DESERT) {
            if (h1 < 0.08 * dense) key = 'pebble_cluster';
          } else {
            if (h1 < 0.07 * dense) key = h2 < 0.5 ? 'stone_mossy' : 'pebble_cluster';
          }
        }
        if (key) {
          const full = diorama && proc.decoFullTile &&
            (key.startsWith('grass') || key.startsWith('flower') || key === 'reed_clump' || key === 'bush_round');
          deco.push({
            x, y, key,
            ox: full ? 0 : (hash2(x*3+1, y*5+2) - 0.5) * 0.25,
            oy: full ? 0 : (hash2(x*7+3, y*3+1) - 0.5) * 0.25,
            s: diorama && CWE ? CWE.decoSize(x, y, proc)
               : (0.85 + hash2(x*11+7, y*13+5) * 0.30),
            fullTile: !!full,
            flip: CWE ? CWE.decoFlip(x, y, proc) : (hash2(x, y) > 0.5),
          });
        }
      }
    }

    // ─ 14. MULTI-TILE collidable landmarks (mountain ranges, mesas, ridges) ─
    // Mountains are 6–11 tile massifs, often clustered 2–4 together, with
    // real collision ellipses so the player must walk around the range.
    const landmarks = [];
    const nClusters = def.landmarkN != null ? def.landmarkN : (proc.landmarkN || 5);
    const lmKeys = def.landmarks || ['mesa', 'boulder', 'ridge'];
    const minSep = proc.landmarkMinSep || 10;
    const cMin = proc.landmarkClusterMin || 2;
    const cMax = proc.landmarkClusterMax || 4;

    const siteClear = (x, y, rad) => {
      if (!isL(x, y)) return false;
      if (inFarm(x, y)) return false;
      if (Math.hypot(x - HX, y - HY) < 14 + rad) return false;
      if (x >= CX - 2 - rad && x <= CX + CW + 2 + rad &&
          y >= CY - 2 - rad && y <= CY + CH + 2 + rad) return false;
      for (const L of landmarks) {
        if (Math.hypot(L.x - x, L.y - y) < minSep + (L.w || 4) * 0.35) return false;
      }
      return true;
    };

    const claimFootprint = (cx, cy, w, h) => {
      const hw = w * 0.5, hh = h * 0.5;
      for (let dy = -Math.ceil(hh) - 1; dy <= Math.ceil(hh) + 1; dy++) {
        for (let dx = -Math.ceil(hw) - 1; dx <= Math.ceil(hw) + 1; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (!ok(tx, ty)) continue;
          if ((dx / Math.max(0.5, hw)) ** 2 + (dy / Math.max(0.5, hh)) ** 2 > 1.05) continue;
          // Raise terrain under the massif so cliffs read around it
          if (tiles[I(tx, ty)] === T_GRASS) {
            elevA[I(tx, ty)] = Math.max(elevA[I(tx, ty)] || 1, dx * dx + dy * dy < 0.25 ? 4 : 3);
          }
          // Keep resource nodes out of the rock
          nodeSet.add(nk(tx, ty));
          clearNodeAt(tx, ty);
        }
      }
    };

    for (let ci = 0; ci < nClusters; ci++) {
      let cx = 0, cy = 0, found = false;
      for (let att = 0; att < 100; att++) {
        cx = 6 + ((rnd() * (MAP_W - 12)) | 0);
        cy = 6 + ((rnd() * (MAP_H - 12)) | 0);
        if (siteClear(cx, cy, 5)) { found = true; break; }
      }
      if (!found) continue;

      // Prefer mountain/ridge keys for big ranges; boulders stay smaller satellites
      const clusterN = cMin + ((rnd() * (cMax - cMin + 1)) | 0);
      const primaryKey = lmKeys.find(k => k === 'mountain' || k === 'volcano' || k === 'ridge' || k === 'mesa')
        || lmKeys[0];

      for (let m = 0; m < clusterN; m++) {
        let x = cx, y = cy;
        if (m > 0) {
          // Satellite peaks offset 3–6 tiles from cluster center
          const ang = rnd() * Math.PI * 2;
          const dist = 3 + rnd() * 4;
          x = Math.round(cx + Math.cos(ang) * dist);
          y = Math.round(cy + Math.sin(ang) * dist);
          if (!ok(x, y) || !isL(x, y) || inFarm(x, y)) continue;
          if (Math.hypot(x - HX, y - HY) < 14) continue;
        }
        const key = m === 0 ? primaryKey : lmKeys[(rnd() * lmKeys.length) | 0];
        const tiles = CWE
          ? CWE.landmarkFootprintTiles(key, rnd, proc)
          : (key === 'boulder' ? 3 : 7);
        const w = tiles;
        const h = Math.max(2, Math.round(tiles * (0.75 + rnd() * 0.35)));
        const sizeMul = CWE ? CWE.landmarkSizeMul(rnd, proc) : (1 + rnd() * 0.4);
        // Collision radius ≈ half the long axis
        const r = Math.max(w, h) * 0.48;
        landmarks.push({
          x, y, key, w, h, r, collide: true, sizeMul,
          cluster: ci,
          e: def.landmarkEmoji ? (def.landmarkEmoji[key] || '🪨') : '🪨',
          big: true,
        });
        claimFootprint(x, y, w, h);
      }
    }

    // ─ 15. Large landscape overlays (vista mountains — decorative, no collision)
    // Big sprite / clay massifs on the horizon to sell depth without blocking.
    const landscapes = [];
    const nVista = proc.landscapeN != null ? proc.landscapeN : 3;
    for (let i = 0; i < nVista; i++) {
      for (let att = 0; att < 60; att++) {
        const x = 5 + ((rnd() * (MAP_W - 10)) | 0);
        const y = 4 + ((rnd() * (MAP_H * 0.45)) | 0); // prefer north / deeper map
        if (!isL(x, y)) continue;
        if (Math.hypot(x - HX, y - HY) < 18) continue;
        if (x >= CX - 4 && x <= CX + CW + 4 && y >= CY - 4 && y <= CY + CH + 4) continue;
        if (landscapes.some(V => Math.hypot(V.x - x, V.y - y) < 12)) continue;
        if (landmarks.some(L => Math.hypot(L.x - x, L.y - y) < 8)) continue;
        const w = 10 + ((rnd() * 6) | 0); // 10–15 tiles wide
        const h = 5 + ((rnd() * 4) | 0);
        landscapes.push({
          x, y, key: lmKeys[(rnd() * lmKeys.length) | 0],
          w, h, sizeMul: 1.1 + rnd() * 0.5,
          collide: false, vista: true,
          // Prefer directional peak / cliff art when available
          feat: rnd() > 0.45 ? 'peak' : ('cliff_' + ['s','e','n','w'][(rnd()*4)|0]),
          e: '⛰️',
        });
        break;
      }
    }

    // ─ 16. Oriented world FEATURES (10-asset packs × 4 angles for cliffs)
    // feat_cliff_{s,e,n,w} + peak/boulder/outcrop/plant/accent — WORLD_TYPES.md
    const features = [];
    const FEAT_PLANT = ['plant_a', 'plant_b', 'accent'];
    const FEAT_ROCK = ['boulder', 'outcrop', 'peak'];
    const FEAT_CLIFF = ['cliff_s', 'cliff_e', 'cliff_n', 'cliff_w'];
    const nFeat = proc.featureN != null ? proc.featureN : 28;
    // isMoon already set in biome step
    for (let i = 0; i < nFeat; i++) {
      for (let att = 0; att < 50; att++) {
        const x = 3 + ((rnd() * (MAP_W - 6)) | 0);
        const y = 3 + ((rnd() * (MAP_H - 6)) | 0);
        if (!isL(x, y)) continue;
        if (inFarm(x, y)) continue;
        if (Math.hypot(x - HX, y - HY) < 12) continue;
        if (x >= CX - 2 && x <= CX + CW + 2 && y >= CY - 2 && y <= CY + CH + 2) continue;
        if (nodeOn(x, y)) continue;
        if (features.some(F => Math.hypot(F.x - x, F.y - y) < 2.5)) continue;
        // Prefer cliff facing that matches local elevation drop (looks correct)
        let key;
        const eHere = elevA[I(x, y)] || 0;
        const eS = (y + 1 < MAP_H) ? (elevA[I(x, y + 1)] || 0) : eHere;
        const eE = (x + 1 < MAP_W) ? (elevA[I(x + 1, y)] || 0) : eHere;
        const eN = (y > 0) ? (elevA[I(x, y - 1)] || 0) : eHere;
        const eW = (x > 0) ? (elevA[I(x - 1, y)] || 0) : eHere;
        // Moon base: sprinkle dish beacons among rocks/cliffs
        if (isMoon && rnd() < 0.12) key = 'dish';
        else if (eHere > eS + 0 && rnd() < 0.55) key = 'cliff_s';
        else if (eHere > eE && rnd() < 0.5) key = 'cliff_e';
        else if (eHere > eW && rnd() < 0.5) key = 'cliff_w';
        else if (eHere > eN && rnd() < 0.4) key = 'cliff_n';
        else if (rnd() < 0.35) key = FEAT_ROCK[(rnd() * FEAT_ROCK.length) | 0];
        else key = FEAT_PLANT[(rnd() * FEAT_PLANT.length) | 0];

        const isCliff = key.startsWith('cliff');
        const isRock = key === 'boulder' || key === 'outcrop' || key === 'peak';
        const sizeMul = isCliff ? (1.1 + rnd() * 0.6)
          : isRock ? (0.9 + rnd() * 0.8)
          : (0.7 + rnd() * 0.5);
        // Hard-body radius (tile units) — cliffs/rocks block, plants don't
        const r = isCliff ? (1.4 + sizeMul * 0.5) : isRock ? (0.9 + sizeMul * 0.4) : 0;
        features.push({
          x, y, key, sizeMul, r,
          collide: r > 0.4,
          angle: isCliff ? key.slice(-1) : null, // s/e/n/w
        });
        if (r > 0.4) {
          // claim footprint for nodes
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (ok(x + dx, y + dy) && Math.hypot(dx, dy) <= r * 0.7)
              nodeSet.add(nk(x + dx, y + dy));
          }
        }
        break;
      }
    }

    // ─ 17. Large lunar plates (crater bowls + regolith fields + cliff walls) ─
    // These are multi-tile SPRITES (not cell stamps) so the moon reads as
    // rocky grey-on-black terrain rather than a grass grid.
    const plates = [];
    if (isMoon) {
      const nCraters = 10 + ((rnd() * 6) | 0);
      for (let i = 0; i < nCraters; i++) {
        for (let att = 0; att < 40; att++) {
          const x = 6 + ((rnd() * (MAP_W - 12)) | 0);
          const y = 6 + ((rnd() * (MAP_H - 12)) | 0);
          if (Math.hypot(x - HX, y - HY) < 12) continue;
          if (x >= FARM_X0 - 1 && x <= FARM_X1 + 1 && y >= FARM_Y0 - 1 && y <= FARM_Y1 + 1) continue;
          if (x >= CX - 2 && x <= CX + CW + 2 && y >= CY - 2 && y <= CY + CH + 2) continue;
          if (plates.some(P => Math.hypot(P.x - x, P.y - y) < 6)) continue;
          plates.push({
            x, y,
            key: 'plate_selene_crater_' + ((rnd() * 4) | 0),
            w: 5 + ((rnd() * 4) | 0),
            sizeMul: 1.0 + rnd() * 0.7,
            kind: 'crater',
          });
          break;
        }
      }
      // Regolith field plates between base and wilds
      for (let i = 0; i < 8; i++) {
        for (let att = 0; att < 30; att++) {
          const x = 5 + ((rnd() * (MAP_W - 10)) | 0);
          const y = 5 + ((rnd() * (MAP_H - 10)) | 0);
          if (Math.hypot(x - HX, y - HY) < 8) continue;
          if (plates.some(P => Math.hypot(P.x - x, P.y - y) < 5)) continue;
          plates.push({
            x, y,
            key: 'plate_selene_regolith_' + ((rnd() * 4) | 0),
            w: 4 + ((rnd() * 3) | 0),
            sizeMul: 0.9 + rnd() * 0.5,
            kind: 'regolith',
          });
          break;
        }
      }
      // Cliff wall plates along high→low elevation edges
      for (let y = 2; y < MAP_H - 2; y += 2) for (let x = 2; x < MAP_W - 2; x += 2) {
        if (tiles[I(x, y)] !== T_GRASS) continue;
        const e = elevA[I(x, y)] || 0;
        if (e < 2) continue;
        let face = null;
        if ((elevA[I(x, y + 1)] || 0) < e - 0) face = 's';
        else if ((elevA[I(x + 1, y)] || 0) < e) face = 'e';
        else if ((elevA[I(x - 1, y)] || 0) < e) face = 'w';
        else if ((elevA[I(x, y - 1)] || 0) < e) face = 'n';
        if (!face || rnd() > 0.22) continue;
        if (Math.hypot(x - HX, y - HY) < 10) continue;
        plates.push({
          x, y,
          key: 'plate_selene_cliff_' + face,
          w: 3,
          sizeMul: 0.95 + rnd() * 0.4,
          kind: 'cliff',
          face,
        });
      }
    }

    return {
      tiles, biomeA, elevA, tileColors, nodes, cityBuildings, npcCars, npcPeds, props, deco, def,
      landmarks, landscapes, features, plates,
      HX, HY, CX, CY,
      farm: { x0: FARM_X0, x1: FARM_X1, y0: FARM_Y0, y1: FARM_Y1 },
    };
  }

  // ── cache access ────────────────────────────────────────────────────────────
  // Each planet has a distinct worldSeed (derived from its name), so the single-
  // slot cache naturally regenerates when you land somewhere new.
  function getWorld(seed, pKey) {
    if (_worldCache && _worldCache.seed === seed) return _worldCache;
    const def = planetDef(pKey || 'mira');
    // Always run full genWorld (pure math) — needed for headless playability tests
    // and ensures farm/pad layout is identical in Node and browser.
    _worldCache = { seed, ...genWorld(seed, def) };
    return _worldCache;
  }

  // ── collision: water + multi-tile landmark massifs + oriented features ─────
  function blocked(px, py, world) {
    const tx = Math.floor(px), ty = Math.floor(py);
    if (tx < 0||tx >= MAP_W||ty < 0||ty >= MAP_H) return true;
    if (world.tiles[ty*MAP_W + tx] === T_WATER) return true;
    // Multi-tile mountain / mesa ranges (elliptical footprint)
    for (const L of (world.landmarks || [])) {
      if (!L.collide) continue;
      if (CWE && CWE.landmarkBlocks(L, px, py)) return true;
      if (!CWE && Math.hypot(px - L.x, py - L.y) < (L.r || 1.2)) return true;
    }
    // Oriented feature hard-bodies (cliffs / boulders) — circle approx
    for (const F of (world.features || [])) {
      if (!F.collide || !(F.r > 0)) continue;
      if (Math.hypot(px - F.x, py - F.y) < F.r) return true;
    }
    return false;
  }

  // ── progress state ──────────────────────────────────────────────────────────
  function toKey(name) { return name.toLowerCase().replace(/\s+/g,'_'); }

  function getProgress(s, pKey) {
    if (!s.planetProgress) s.planetProgress = {};
    if (!s.planetProgress[pKey]) {
      s.planetProgress[pKey] = {
        // Rolled ONCE on first visit, then persisted (planetProgress is
        // save-whitelisted): each player's worlds and towns are their own,
        // stable across every landing and reload — like the space field,
        // unique per save, not per session.
        worldSeed: 1 + ((Math.random()*0x7ffffffe)|0),
        px: 12.5, py: 42.5,
        pDir: 0,
        inv: { wood:0, stone:0, berry:0, credits:0 },
        harvested: {},       // nodeId → true
        cooldowns: {},       // nodeId → secondsRemaining
        buildings: [],       // [{ x, y, type, level }]  — one of each type
        buildMode: false,
        selBuild: 0,
        fadeAlpha: 1, fadeDir: -1,
        fadeMsg: "Mira Surface",
        _launching: false,
        car: { x: 12, y: 40, vx: 0, vy: 0, heading: 0 },  // spaceport apron, facing the clear road east into town
        inCar: false,
        // ── farming + mobile tools ──────────────────────────────────────────
        tool: 'action',          // 'action'|'till'|'plant'|'water'|'build'
        tilled: {},              // "x,y" → true  (soil ready to plant)
        crops: {},               // "x,y" → { type, stage, watered }
        water: { fill: 3, max: 5 },
        seeds: {},               // seedKey → count
        selSeed: 'carrot',       // seed chosen for planting
        selBuildKey: null,       // building type armed for placement
        upgrades: { berry: 0 },  // berry-yield upgrade level (bought at market)
        speed: { wood:0, stone:0, berry:0 },   // harvest-speed upgrade levels (fewer hits)
        nodeHits: {},            // nodeId → hits remaining (multi-hit harvest in progress)
      };
    }
    const p = s.planetProgress[pKey];
    // migration guards
    if (!p.inv) p.inv = { wood:0, stone:0, berry:0, credits:0 };
    if (!p.harvested) p.harvested = {};
    if (!p.cooldowns) p.cooldowns = {};
    if (!p.buildings) p.buildings = [];
    if (p.worldSeed===undefined) p.worldSeed = 42 + (pKey.charCodeAt(0)||0)*1337;
    if (!p.car) p.car = { x: 12, y: 40, vx: 0, vy: 0, heading: 0 };
    if (p.inCar === undefined) p.inCar = false;
    if (!p.tool) p.tool = 'action';
    if (!p.tilled) p.tilled = {};
    if (!p.crops) p.crops = {};
    if (!p.water) p.water = { fill: 3, max: 5 };
    if (!p.seeds) p.seeds = {};
    if (!p.selSeed) p.selSeed = 'carrot';
    if (p.selBuildKey === undefined) p.selBuildKey = null;
    if (!p.upgrades) p.upgrades = { berry: 0 };
    if (!p.speed) p.speed = { wood:0, stone:0, berry:0 };
    if (!p.nodeHits) p.nodeHits = {};
    // migrate old buildings to carry a level, and drop the retired "tower"
    p.buildings = p.buildings.filter(b => b.type !== 'tower');
    for (const b of p.buildings) if (b.level === undefined) b.level = 1;
    return p;
  }

  // ── ship-wide state (credits / seed bag / cargo hold / quests) ───────────────
  // Credits and seeds live on the SHIP, not the planet — they travel with you.
  // Harvested goods stay planet-side until you transfer them at a Shelter; the
  // cargo hold is what makes interplanetary trade runs possible.
  function ensureShipState(s){
    if (!s.seedBag)     s.seedBag = {};
    if (!s.planetCargo) s.planetCargo = {};
    if (!s.questState)  s.questState = { nextId: 1, active: [], offers: {} };
    if (typeof s.credits !== 'number') s.credits = 0;
  }
  // One-time fold of the old per-planet credits/seeds into the ship pools.
  function migrateEconomy(s, prog){
    ensureShipState(s);
    if (prog.inv && prog.inv.credits) { s.credits += prog.inv.credits; prog.inv.credits = 0; }
    if (prog.seeds) for (const k of Object.keys(prog.seeds)) {
      if (prog.seeds[k] > 0) { s.seedBag[k] = (s.seedBag[k]||0) + prog.seeds[k]; prog.seeds[k] = 0; }
    }
  }

  // ── player building catalogue ────────────────────────────────────────────────
  // Buildings are limited to one of each. Levelled buildings (sawmill/quarry) list
  // an `up` upgrade cost and `maxLvl`; their yield multiplier is (level+1) → L1=2×,
  // L2=3×. `emoji` labels the mobile build/menu buttons.
  const BTYPES = [
    { key:"sawmill",  name:"Sawmill",  emoji:"🪚", cost:{wood:8},          up:{wood:14,stone:6}, maxLvl:2, hw:0.80, bh:20, colT:"#C89060", colL:"#9A6838", colR:"#7A5028", desc:"Wood harvest ×(lvl+1)" },
    { key:"quarry",   name:"Quarry",   emoji:"⛏", cost:{wood:5,stone:5},  up:{wood:6,stone:14}, maxLvl:2, hw:0.85, bh:15, colT:"#B0A890", colL:"#888070", colR:"#686050", desc:"Stone harvest ×(lvl+1)" },
    { key:"barn",     name:"Barn",     emoji:"🚜", cost:{wood:18,stone:8},                        hw:1.00, bh:22, colT:"#A83828", colL:"#802818", colR:"#601C10", desc:"Farm hub — livestock +8–14₡ per sleep" },
    { key:"well",     name:"Well",     emoji:"🪣", cost:{wood:6,stone:12},                        hw:0.45, bh:12, colT:"#8090A0", colL:"#586878", colR:"#404E5C", desc:"Refill the watering can here" },
    { key:"shelter",  name:"Shelter",  emoji:"⛺", cost:{wood:15,stone:5},                        hw:0.78, bh:18, colT:"#E8D890", colL:"#B0A858", colR:"#908840", desc:"Sleep → next turn, resources regrow" },
    { key:"market",   name:"Market",   emoji:"🏪", cost:{wood:20,stone:15},                       hw:0.88, bh:20, colT:"#80C880", colL:"#50A050", colR:"#388038", desc:"Buy & sell — trade goods and seeds" },
  ];
  const BT_BY = {}; for (const b of BTYPES) BT_BY[b.key] = b;

  // ── crops / seeds ─────────────────────────────────────────────────────────────
  // grow = sleeps from seed to ripe (watering advances 2 stages/sleep instead of 1).
  // yield = crops harvested; sellEach = credits per crop; seedCost = credits per seed.
  // Every crop is NATIVE to one planet (`home`). Its seeds are only sold at that
  // planet's Trade Guild, and it only fetches the ×3 EXPORT price when sold at a
  // DIFFERENT planet — that's the interplanetary trade-run loop: grow at home,
  // transfer to the ship at a Shelter, fly, sell abroad.
  const EXPORT_MULT = 3;
  // Hotel room rate — lets you sleep in town before you can afford a Shelter.
  const ROOM_COST = 10;
  const SEED_TYPES = [
    // Mira — temperate breadbasket
    { key:"carrot",    name:"Carrot",     emoji:"🥕", grow:2, yield:3, sellEach:3,  seedCost:5,  home:'mira' },
    { key:"grain",     name:"Grain",      emoji:"🌾", grow:2, yield:5, sellEach:2,  seedCost:4,  home:'mira' },
    { key:"tomato",    name:"Tomato",     emoji:"🍅", grow:3, yield:4, sellEach:4,  seedCost:8,  home:'mira' },
    // Vesper — cave-fungus farms under the crystal mines
    { key:"glowcap",   name:"Glowcap",    emoji:"🍄", grow:3, yield:3, sellEach:6,  seedCost:10, home:'vesper' },
    { key:"stonetuber",name:"Stonetuber", emoji:"🥔", grow:2, yield:4, sellEach:4,  seedCost:7,  home:'vesper' },
    // Cinder — volcanic spice terraces
    { key:"emberchili",name:"Emberchili", emoji:"🌶️", grow:3, yield:3, sellEach:8,  seedCost:12, home:'cinder' },
    { key:"ashyam",    name:"Ash Yam",    emoji:"🍠", grow:2, yield:4, sellEach:5,  seedCost:8,  home:'cinder' },
    // Dusk — ice gardens
    { key:"frostleaf", name:"Frostleaf",  emoji:"🥬", grow:2, yield:4, sellEach:5,  seedCost:8,  home:'dusk' },
    { key:"icegrape",  name:"Ice Grape",  emoji:"🍇", grow:3, yield:3, sellEach:7,  seedCost:11, home:'dusk' },
    // Sorn — desert oasis plots
    { key:"suncorn",   name:"Sun Corn",   emoji:"🌽", grow:2, yield:4, sellEach:5,  seedCost:8,  home:'sorn' },
    { key:"cactifruit",name:"Cactifruit", emoji:"🍈", grow:3, yield:3, sellEach:7,  seedCost:11, home:'sorn' },
    // Selene — Mira moon base (hydroponics under domes)
    { key:"moongrain", name:"Moongrain",  emoji:"🌑", grow:2, yield:4, sellEach:6,  seedCost:10, home:'selene' },
    { key:"voidberry", name:"Voidberry",  emoji:"🫐", grow:3, yield:3, sellEach:8,  seedCost:12, home:'selene' },
  ];
  const SEED_BY = {}; for (const c of SEED_TYPES) SEED_BY[c.key] = c;

  // ════════════════════════════════════════════════════════════════════════════
  //  PLANET DEFS — recipes for ClayWorldEngine. One engine, many worlds.
  //  ground:'diorama' → locked procedural clay (preferred for new worlds)
  //  ground:'clay'    → legacy slab PNGs (kept for A/B)
  //  theme + proc knobs: see CLAY_WORLD_ENGINE.md / ClayWorldEngine.THEMES
  // ════════════════════════════════════════════════════════════════════════════
  // worldType: earth | ice | lava | desert | barren — drives art pack + lore (see WORLD_TYPES.md)
  const PLANET_DEFS_RAW = {
    mira: {
      name:'Mira', tag:'temperate homeworld', worldType:'earth', cityXY:[48,10],
      sky:null,
      biomeLO:["#5E9E3C","#2E6B3A","#CDB06A","#7C7568"], biomeHI:["#8FCB5C","#4C9B54","#E8D492","#A59C8C"],
      water:["#4FA9D8","#2C6FA6"], glint:'#E8F6FF', road:'#B9AE97',
      crops:['carrot','grain','tomato'],
      flora:{[B_GRASS]:'🌳',[B_JUNGLE]:'🌴',[B_DESERT]:'🌵',[B_MOUNTAIN]:'🌲'}, rock:'🪨', berry:'🫐',
      props:[{e:'🌻',n:9},{e:'🦋',n:5}],
      port:{ flip:false, hangars:3 },
      city:{ pattern:'grid', monument:'obelisk', skyline:'towers' },
      ground:'diorama', theme:'temperate', propset:'mira', nodeset:'mira', bldgset:'mira', tileset:'mira',
      landmarks:['mountain','mesa','ridge','boulder'], landmarkN:5,
      landmarkEmoji:{ mountain:'⛰️', mesa:'🪨', ridge:'⛰️', boulder:'🪨' },
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.4, groundJitter:true,
        decoDense:2.0, decoFullTile:true, decoTileFill:1.0, decoMirror:true,
        decoSizeMin:0.45, decoSizeMax:0.72, decoHeroChance:0.16,
        elevDramatic:true, fleckGrass:false, landscapeN:3,
        landmarkClusterMin:2, landmarkClusterMax:4,
        // Trees: modest vs player (~34px); rocks keep engine defaults
        treeScale:[0.95, 1.45], treeGiantChance:0.05, treeGiantScale:[1.6, 2.0],
      },
    },
    vesper: {
      name:'Vesper', tag:'bare-rock mining world', worldType:'barren', cityXY:[52,24],
      sky:{top:'#8A7FA8',hor:'#D8CDE8',cloud:'#C8C0D8'},
      biomeLO:["#8A8494","#6E6880","#5C566C","#4A4458"], biomeHI:["#ABA4B8","#8E88A0","#7A7490","#686278"],
      water:["#6FA0B8","#42708C"], glint:'#D8E8F0', road:'#9A94A8',
      crops:['glowcap','stonetuber'],
      flora:{[B_GRASS]:'🍄',[B_JUNGLE]:'🍄',[B_DESERT]:'🗿',[B_MOUNTAIN]:'⛰️'}, rock:'💎', berry:'🌰',
      props:[{e:'⛏️',n:5},{e:'🗿',n:5},{e:'💎',n:7}],
      noTrees:true,
      port:{ flip:true, hangars:2, extra:'cargo_bay' },
      city:{ pattern:'organic', monument:'water_tower', skyline:'industrial' },
      ground:'diorama', theme:'barren', propset:'vesper', nodeset:'vesper', bldgset:'vesper', tileset:'vesper',
      landmarks:['mesa','boulder','ridge','mountain'], landmarkN:5,
      landmarkEmoji:{ mesa:'🗿', boulder:'💎', ridge:'⛰️', mountain:'⛰️' },
      slabTint:{ grass:'#9A94A8', dirt:'#6E6880', water:'#6FA0B8', path:'#9A94A8' },
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.35, groundJitter:true,
        decoDense:1.4, decoFullTile:true, decoMirror:true,
        decoSizeMin:0.4, decoSizeMax:0.65, decoHeroChance:0.12,
        fleckGrass:false, elevDramatic:true, landscapeN:3,
        landmarkClusterMin:2, landmarkClusterMax:4,
      },
    },
    cinder: {
      name:'Cinder', tag:'volcanic spice world', worldType:'lava', cityXY:[48,34],
      sky:{top:'#C86A48',hor:'#F2C494',cloud:'#B8988A'},
      biomeLO:["#5A4038","#4A3028","#6E5A46","#3E3430"], biomeHI:["#7A5A4C","#684A3C","#8E765C","#5A4C44"],
      water:["#E8752A","#B8481A"], glint:'#FFE0A0', road:'#6E6258',
      crops:['emberchili','ashyam'],
      flora:{[B_GRASS]:'🪨',[B_JUNGLE]:'🪨',[B_DESERT]:'🪨',[B_MOUNTAIN]:'🪨'}, rock:'🪨', berry:'🍒',
      props:[{e:'🌋',n:6,big:true},{e:'🔥',n:10},{e:'💨',n:5}],
      noTrees:true, landOnlyRocks:true,
      port:{ flip:false, hangars:2, extra:'round_guard' },
      city:{ pattern:'radial', monument:'stepped_temple', skyline:'frontier' },
      ground:'diorama', theme:'volcanic', propset:'cinder', nodeset:'cinder', bldgset:'cinder', tileset:'cinder',
      landmarks:['volcano','mesa','boulder','mountain'], landmarkN:5,
      landmarkEmoji:{ volcano:'🌋', mesa:'🪨', boulder:'🪨', mountain:'⛰️' },
      slabTint:{ grass:'#8A6A58', dirt:'#5A4038', water:'#E8752A', path:'#6E6258' },
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.35, groundJitter:true,
        waterIsLava:true, fleckGrass:false, elevDramatic:true,
        decoDense:1.6, decoFullTile:true, decoMirror:true,
        decoSizeMin:0.42, decoSizeMax:0.7, decoHeroChance:0.14,
        landscapeN:4, landmarkClusterMin:2, landmarkClusterMax:5,
        rockScale:[1.0, 2.8],
      },
    },
    dusk: {
      name:'Dusk', tag:'ice-field world', worldType:'ice', cityXY:[16,4],
      sky:{top:'#9FC4E8',hor:'#EAF4FC',cloud:'#FFFFFF'},
      biomeLO:["#C2D4E4","#A8C0D8","#B0C8D0","#98A8C0"], biomeHI:["#EAF4FC","#CCE0F0","#D8E8EC","#B8C8DC"],
      water:["#7FD0E0","#4FA0C0"], glint:'#FFFFFF', road:'#A8B4C4',
      crops:['frostleaf','icegrape'],
      flora:{[B_GRASS]:'🌲',[B_JUNGLE]:'🌲',[B_DESERT]:'🧊',[B_MOUNTAIN]:'🏔️'}, rock:'🧊', berry:'🫐',
      props:[{e:'⛄',n:5},{e:'🏔️',n:5,big:true},{e:'❄️',n:8}],
      port:{ flip:true, hangars:3, extra:'comms_tower' },
      city:{ pattern:'radial', compact:true, monument:'obelisk', skyline:'low' },
      ground:'diorama', theme:'ice', propset:'dusk', nodeset:'dusk', bldgset:'dusk', tileset:'dusk',
      landmarks:['mountain','ridge','boulder','mesa'], landmarkN:5,
      landmarkEmoji:{ mountain:'🏔️', ridge:'🧊', boulder:'🧊', mesa:'🏔️' },
      slabTint:{ grass:'#D0E0F0', dirt:'#B0C8D8', water:'#7FD0E0', path:'#A8B4C4' },
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.35, groundJitter:true,
        fleckGrass:false, elevDramatic:true, decoDense:1.7, decoFullTile:true, decoMirror:true,
        decoSizeMin:0.45, decoSizeMax:0.7, decoHeroChance:0.15,
        landscapeN:4, landmarkClusterMin:2, landmarkClusterMax:4,
        treeScale:[1.0, 1.5], treeGiantChance:0.06, treeGiantScale:[1.65, 2.05],
      },
    },
    sorn: {
      name:'Sorn', tag:'desert caravan world', worldType:'desert', cityXY:[30,8],
      sky:{top:'#E0AE5C',hor:'#F8E4B8',cloud:'#F0E0C0'},
      biomeLO:["#D0A860","#C09850","#B08840","#987838"], biomeHI:["#E8CC88","#D8BC70","#C8AC60","#B09850"],
      water:["#4FC0B0","#2C8A80"], glint:'#E8FFF8', road:'#B89868',
      crops:['suncorn','cactifruit'],
      flora:{[B_GRASS]:'🌵',[B_JUNGLE]:'🌴',[B_DESERT]:'🌵',[B_MOUNTAIN]:'🌵'}, rock:'🪨', berry:'🍑',
      props:[{e:'🐫',n:4},{e:'🌵',n:10},{e:'⛺',n:3}],
      sparseTrees:true,
      port:{ flip:false, hangars:2, extra:'water_tower' },
      city:{ pattern:'strip', monument:'pyramid', skyline:'market' },
      ground:'diorama', theme:'desert', propset:'sorn', nodeset:'sorn', bldgset:'sorn', tileset:'sorn',
      landmarks:['mesa','dune','boulder','mountain'], landmarkN:5,
      landmarkEmoji:{ mesa:'🏜️', dune:'🌵', boulder:'🪨', mountain:'⛰️' },
      slabTint:{ grass:'#E0B870', dirt:'#C09850', water:'#4FC0B0', path:'#B89868' },
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.35, groundJitter:true,
        fleckGrass:false, elevDramatic:false, decoDense:1.5, decoFullTile:true, decoMirror:true,
        decoSizeMin:0.42, decoSizeMax:0.68, decoHeroChance:0.12,
        landscapeN:3, landmarkClusterMin:2, landmarkClusterMax:3,
        treeScale:[0.9, 1.35], treeGiantChance:0.04, treeGiantScale:[1.5, 1.9],
      },
    },
    // ── SELENE — Mira's moon base (same ClayWorldEngine pipeline as Mira/etc.) ──
    // Access: approach Mira's named moon "Selene" in space and press L.
    // Dual districts + port via genWorld; grey regolith diorama + selene sprite pack.
    selene: {
      name:'Selene', tag:"Mira's moon — grey craters, basalt cliffs, station base",
      worldType:'moon', parentPlanet:'mira', cityXY:[46,12],
      sky:{top:'#000000',hor:'#12141A',cloud:'#1A1C22'},
      biomeLO:["#5A5856","#3A3836","#4A4846","#2A2826"],
      biomeHI:["#9A9894","#6A6864","#7A7874","#4A4844"],
      water:["#0A0A0E","#050508"], glint:'#C8D0D8',
      road:'#7A828C',
      crops:['moongrain','voidberry'],
      flora:{[B_GRASS]:'🪨',[B_JUNGLE]:'🪨',[B_DESERT]:'🪨',[B_MOUNTAIN]:'🌑'}, rock:'🪨', berry:'💎',
      props:[{e:'🪨',n:8},{e:'🌑',n:4,big:true},{e:'📡',n:5}],
      noTrees:true, landOnlyRocks:true,
      port:{ flip:false, hangars:3, extra:'comms_tower' },
      city:{ pattern:'grid', monument:'obelisk', skyline:'industrial',
             districts:['command','habitat'] },
      ground:'diorama', theme:'barren', propset:'selene', nodeset:'selene',
      bldgset:'selene', tileset:'selene',
      landmarks:['mountain','mesa','ridge','boulder'], landmarkN:6,
      landmarkEmoji:{ mountain:'🌑', mesa:'🪨', ridge:'🪨', boulder:'🪨' },
      slabTint:{ grass:'#6A6864', dirt:'#3A3836', water:'#0A0A0E', path:'#7A828C' },
      farmSoil:'#5A5248', farmSoilAlt:'#4A443C',
      proc:{
        seamlessSprite:true, carpetAll:true, groundOverlap:1.55, groundJitter:true,
        fleckGrass:false, elevDramatic:true, elevMountainBoost:0.36,
        decoDense:1.35, decoFullTile:true, decoMirror:true,
        decoSizeMin:0.4, decoSizeMax:0.65, decoHeroChance:0.1,
        landscapeN:4, featureN:32,
        landmarkClusterMin:2, landmarkClusterMax:4,
        rockScale:[1.1, 2.8],
        waterIsLava:false,
      },
    },
  };
  // Normalize every recipe through the locked engine (stamps proc + validates).
  const PLANET_DEFS = {};
  for (const k of Object.keys(PLANET_DEFS_RAW)) {
    PLANET_DEFS[k] = CWE
      ? CWE.normalizeRecipe(PLANET_DEFS_RAW[k])
      : PLANET_DEFS_RAW[k];
  }
  function planetDef(pKey){ return PLANET_DEFS[pKey] || PLANET_DEFS.mira; }
  // the def whose world is currently being drawn (set by draw/drawScene)
  let _pdef = PLANET_DEFS.mira;

  // ── city / pre-built building catalogue ─────────────────────────────────────
  // bh = box height in px (before zoom); hw = half-width multiplier (vs ISO_HW)
  // neon = glow color applied as shadowColor around the building
  const CITY_BTYPES = [
    { key:"ctrl_tower",    name:"Control Tower", colT:"#0A1A2A", colL:"#060E18", colR:"#030810", bh:52,  hw:0.65, neon:"#00EEFF" },
    { key:"hangar",        name:"Hangar",        colT:"#1A1210", colL:"#0E0A08", colR:"#080604", bh:18,  hw:1.0,  neon:"#FF6600" },
    { key:"city_inn",      name:"Inn",           colT:"#150A22", colL:"#0D0614", colR:"#07030D", bh:20,  hw:0.8,  neon:"#AA00FF" },
    { key:"hotel",         name:"Hotel",         colT:"#1A1024", colL:"#100A16", colR:"#08050E", bh:26,  hw:0.85, neon:"#FF66AA" },
    { key:"city_market",   name:"Market Hall",   colT:"#220812", colL:"#15050C", colR:"#0C0307", bh:18,  hw:0.9,  neon:"#FF0088" },
    { key:"city_shop",     name:"Shop",          colT:"#1C0E06", colL:"#110804", colR:"#0A0503", bh:16,  hw:0.75, neon:"#FF8800" },
    { key:"blacksmith",    name:"Blacksmith",    colT:"#150806", colL:"#0C0504", colR:"#070303", bh:18,  hw:0.75, neon:"#FF3300" },
    { key:"city_gate",     name:"City Gate",     colT:"#1A1800", colL:"#100E00", colR:"#080800", bh:36,  hw:0.55, neon:"#FFD700" },
    // ── Cyberpunk skyscrapers ──────────────────────────────────────────────
    { key:"sky_deco",   name:"Empire Tower",  colT:"#0E0E1E", colL:"#090914", colR:"#06060E", bh:110, hw:0.92, neon:"#00FFEE",
      sections:[{hw:0.92,bh:38,colT:"#0E0E1E",colL:"#090914",colR:"#06060E"},
                {hw:0.70,bh:38,colT:"#0A0A18",colL:"#070710",colR:"#04040A"},
                {hw:0.48,bh:28,colT:"#070714",colL:"#05050E",colR:"#030309"}] },
    { key:"sky_glass",  name:"Glass Tower",   colT:"#041622", colL:"#020E16", colR:"#01070D", bh:130, hw:0.80, neon:"#00CCFF" },
    { key:"sky_rect",   name:"City Tower",    colT:"#0C0C1E", colL:"#080812", colR:"#05050B", bh:100, hw:0.88, neon:"#8800FF" },
    { key:"sky_cyl",    name:"Round Tower",   colT:"#0A1220", colL:"#060C14", colR:"#04070D", bh:110, hw:0.72, neon:"#00AAFF" },
    { key:"sky_med",    name:"Office Tower",  colT:"#14100A", colL:"#0C0A06", colR:"#080604", bh:75,  hw:0.82, neon:"#FF6600" },
    // ── Street-level specialty buildings ─────────────────────────────────────
    { key:"cantina",       name:"Cantina",       colT:"#200C00", colL:"#140800", colR:"#0A0500", bh:22,  hw:0.88, neon:"#FF8800" },
    { key:"repair_shop",   name:"Repair Shop",   colT:"#080E16", colL:"#060A10", colR:"#04070A", bh:20,  hw:1.10, neon:"#0099FF" },
    { key:"fuel_depot",    name:"Fuel Depot",    colT:"#1C0600", colL:"#120400", colR:"#0A0300", bh:28,  hw:0.78, neon:"#FF2200" },
    { key:"comms_tower",   name:"Comms Tower",   colT:"#081620", colL:"#061018", colR:"#04070D", bh:72,  hw:0.38, neon:"#00FFCC" },
    { key:"med_bay",       name:"Med Bay",       colT:"#080C18", colL:"#06080E", colR:"#03050A", bh:22,  hw:0.85, neon:"#00AAFF" },
    { key:"power_station", name:"Power Station", colT:"#121000", colL:"#0A0A00", colR:"#060600", bh:32,  hw:0.82, neon:"#FFEE00" },
    { key:"traders_guild", name:"Traders Guild", colT:"#141000", colL:"#0C0A00", colR:"#080600", bh:30,  hw:0.90, neon:"#00FF88" },
    { key:"cargo_bay",     name:"Cargo Bay",     colT:"#0C1018", colL:"#080A10", colR:"#05060A", bh:14,  hw:1.28, neon:"#4488AA" },
    { key:"barracks",      name:"Barracks",      colT:"#080E06", colL:"#060A04", colR:"#040602", bh:20,  hw:0.95, neon:"#005500" },
    { key:"observatory",   name:"Observatory",   colT:"#050A14", colL:"#04080E", colR:"#020408", bh:28,  hw:0.72, neon:"#0044FF" },
    { key:"city_hall",     name:"City Hall",     colT:"#EDE4CE", colL:"#C6BCA4", colR:"#A89E86", bh:26,  hw:0.92, neon:"#E8D06A" },
    // ── Cylinder + pyramid shapes ─────────────────────────────────────────────
    { key:"silo",          name:"Grain Silo",    colT:"#141008", colL:"#0C0B05", colR:"#080703", bh:45,  hw:0.35, neon:"#884400" },
    { key:"water_tower",   name:"Water Tower",   colT:"#08101A", colL:"#060C12", colR:"#04080A", bh:42,  hw:0.55, neon:"#0066AA" },
    { key:"pyramid",       name:"Pyramid",       colT:"#181400", colL:"#0E0C00", colR:"#080700", bh:55,  hw:0.90, neon:"#FFD700" },
    { key:"stepped_temple",name:"Mayan Temple",  colT:"#120E00", colL:"#0C0A00", colR:"#080600", bh:48,  hw:1.00, neon:"#AAAA00" },
    { key:"obelisk",       name:"Obelisk",       colT:"#120E00", colL:"#0A0800", colR:"#060500", bh:60,  hw:0.26, neon:"#DDBB00" },
    { key:"round_guard",   name:"Guard Tower",   colT:"#08100A", colL:"#060C07", colR:"#040804", bh:26,  hw:0.65, neon:"#006600" },
    // ── Residential filler ────────────────────────────────────────────────────
    { key:"apartment",     name:"Apartments",    colT:"#0C1018", colL:"#08090E", colR:"#05060A", bh:36,  hw:0.78, neon:"#004455" },
    { key:"town_house",    name:"Town House",    colT:"#0E0C08", colL:"#0A0806", colR:"#060504", bh:22,  hw:0.72, neon:"#2A3322" },
    // housing variety + Krag civilization pieces (landmarks sprite sheet)
    { key:"town_house_b",  name:"Cottage",       colT:"#0E0C08", colL:"#0A0806", colR:"#060504", bh:20,  hw:0.70, neon:"#C08040" },
    { key:"town_house_c",  name:"Row House",     colT:"#0E0C08", colL:"#0A0806", colR:"#060504", bh:24,  hw:0.68, neon:"#C08040" },
    { key:"apartment_b",   name:"Tenement",      colT:"#0C1018", colL:"#08090E", colR:"#05060A", bh:34,  hw:0.76, neon:"#446655" },
    { key:"ore_depot",     name:"Ore Depot",     colT:"#4A3A2A", colL:"#382C20", colR:"#2A2018", bh:16,  hw:1.05, neon:"#FF8800" },
  ];

  // key → def lookup maps, so the per-tile draw loop doesn't linear-scan these
  // arrays several times per building per frame (pure CPU win in the dense town).
  const CITY_BY_KEY = {}; for (const b of CITY_BTYPES) CITY_BY_KEY[b.key] = b;
  const BT_BY_KEY   = {}; for (const b of BTYPES)      BT_BY_KEY[b.key]   = b;

  // Daytime lift — the city towers were authored near-black for a night skyline;
  // mix them toward warm concrete so they read as real buildings under a blue sky.
  (function dayLiftCity(){
    const T=0.52, TR=205, TG=199, TB=186;
    const lift = (hex)=>{
      if (!hex || hex[0]!=='#') return hex;
      const p=parseInt(hex.slice(1),16), r=(p>>16)&255, g=(p>>8)&255, b=p&255;
      const mx=(c,tc)=>Math.round(c*(1-T)+tc*T);
      return '#'+[mx(r,TR),mx(g,TG),mx(b,TB)].map(v=>v.toString(16).padStart(2,'0')).join('');
    };
    for (const d of CITY_BTYPES){
      d.colT=lift(d.colT); d.colL=lift(d.colL); d.colR=lift(d.colR);
      if (d.sections) for (const s of d.sections){ s.colT=lift(s.colT); s.colL=lift(s.colL); s.colR=lift(s.colR); }
    }
  })();

  // ── proximity card catalog (keyed by building type) ─────────────────────────
  // e=emoji  t=title  a=action line  ac=accent/neon color  key=key badge text ('' hides badge)
  const BUILDING_CARDS = {
    // Interactive: it LOOKS like the market, so it IS the market (clicks on a
    // pretty but dead "Market Hall" fell through to whatever stood nearby —
    // usually City Hall — the click-precision complaint's second half).
    city_market:   { e:'🏪', t:'Market Hall',     a:'Buy seeds • sell your harvest',              ac:'#C08040', key:'E' },
    city_inn:      { e:'🏨', t:'The Inn',          a:'Rest at your own Shelter',                   ac:'#C08040', key:''  },
    ctrl_tower:    { e:'📡', t:'Control Tower',    a:'Port Mira Spaceport — operational',          ac:'#00EEFF', key:''  },
    hangar:        { e:'🚀', t:'Hangar',           a:'NPC vessel bay',                             ac:'#FF6600', key:''  },
    city_gate:     { e:'🏰', t:'City Gate',        a:'Welcome to Port Mira',                       ac:'#FFD700', key:''  },
    cantina:       { e:'🍺', t:'Cantina',          a:'Trade gossip & rumors',                      ac:'#FF8800', key:'E' },
    city_hall:     { e:'🏛', t:'City Hall',        a:'Jobs board — quests & bounties',             ac:'#E8D06A', key:'E' },
    hotel:         { e:'🛏', t:'Hotel',            a:'Rent a room — sleep to next turn',           ac:'#FF66AA', key:'E' },
    repair_shop:   { e:'🔧', t:'Repair Shop',      a:'Rover systems check',                        ac:'#0099FF', key:''  },
    med_bay:       { e:'⚕',  t:'Med Bay',          a:'Town clinic',                                ac:'#00AAFF', key:''  },
    fuel_depot:    { e:'⛽', t:'Fuel Depot',       a:'Fuel and consumables',                       ac:'#FF2200', key:''  },
    power_station: { e:'⚡', t:'Power Station',    a:'City grid — running at capacity',            ac:'#FFEE00', key:''  },
    traders_guild: { e:'🌱', t:'Trade Guild',      a:'Buy seeds • sell your harvest',              ac:'#3CA03C', key:'E' },
    observatory:   { e:'🔭', t:'Observatory',      a:'Star charts & navigation data',              ac:'#0044FF', key:''  },
    comms_tower:   { e:'📶', t:'Comms Tower',      a:'City-wide communications hub',               ac:'#00FFCC', key:''  },
    pyramid:       { e:'🔺', t:'Pyramid',          a:'Ancient monument — do not enter',            ac:'#FFD700', key:''  },
    stepped_temple:{ e:'🏛',  t:'Mayan Temple',    a:'Sacred ancient site',                        ac:'#AAAA00', key:''  },
    obelisk:       { e:'🗿', t:'Obelisk',          a:'Ancient landmark',                           ac:'#DDBB00', key:''  },
    round_guard:   { e:'🛡',  t:'Guard Tower',     a:'City watch — secure perimeter',              ac:'#005500', key:''  },
    cargo_bay:     { e:'📦', t:'Cargo Bay',        a:'Freight docking & storage',                  ac:'#4488AA', key:''  },
    barracks:      { e:'⚔',  t:'Barracks',         a:'Military garrison',                          ac:'#005500', key:''  },
    blacksmith:    { e:'🔨', t:'Blacksmith',       a:'Metalwork & equipment repairs',              ac:'#FF3300', key:''  },
    city_shop:     { e:'🛒', t:'Shop',             a:'General goods',                              ac:'#FF8800', key:''  },
    silo:          { e:'🌾', t:'Grain Silo',       a:'Agricultural storage',                       ac:'#884400', key:''  },
    water_tower:   { e:'💧', t:'Water Tower',      a:'City water supply',                          ac:'#0066AA', key:''  },
    apartment:     { e:'🏢', t:'Apartments',       a:'Residential block',                          ac:'#004455', key:''  },
    town_house:    { e:'🏠', t:'Town House',       a:'Private residence',                          ac:'#2A3322', key:''  },
    town_house_b:  { e:'🏠', t:'Cottage',          a:'Private residence',                          ac:'#C08040', key:''  },
    town_house_c:  { e:'🏠', t:'Row House',        a:'Private residence',                          ac:'#C08040', key:''  },
    apartment_b:   { e:'🏢', t:'Tenement',         a:'Residential block',                          ac:'#446655', key:''  },
    ore_depot:     { e:'⛏',  t:'Ore Depot',        a:'Krag heritage line — the carts still run',   ac:'#FF8800', key:''  },
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  EMOJI SPRITES — placeholder art for the organic layer (trees, rocks, food,
  //  crops, people, cars, farm animals). Rendered as flat billboards anchored on
  //  the tile; the iso GROUND and BUILDINGS stay geometric so the world keeps its
  //  depth. Each glyph is rasterised once to an offscreen canvas at EMOJI_PX and
  //  scaled with drawImage (cheap; avoids re-shaping the glyph every frame).
  //  NOTE: system emoji look different per OS (iOS/Android/Windows) — fine as a
  //  placeholder; swap to bundled Twemoji later for a locked cross-device look.
  // ════════════════════════════════════════════════════════════════════════════
  const USE_EMOJI = true;
  const EMOJI_PX  = 72;
  const EMOJI_FONT = `${EMOJI_PX}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
  const _emojiCache = {};
  function emojiSprite(ch){
    if (HEADLESS || typeof document === 'undefined') return null;
    if (_emojiCache[ch]) return _emojiCache[ch];
    const pad = Math.ceil(EMOJI_PX*0.18);
    const cv = document.createElement('canvas');
    cv.width = EMOJI_PX + pad*2; cv.height = EMOJI_PX + pad*2;
    const cx = cv.getContext('2d');
    cx.font = EMOJI_FONT; cx.textAlign='center'; cx.textBaseline='middle';
    cx.fillText(ch, cv.width/2, cv.height/2);
    _emojiCache[ch] = cv; return cv;
  }
  // Draw an emoji bottom-anchored at (sx,sy). h = on-screen height in px.
  function drawEmoji(g, ch, sx, sy, h, shakeX){
    const spr = emojiSprite(ch); if (!spr) return;
    const scale = h / EMOJI_PX;
    const w = spr.width*scale, hh = spr.height*scale;
    // grounded shadow
    g.save(); g.globalAlpha=0.20; g.fillStyle=C.ink;
    g.beginPath(); g.ellipse(sx, sy+2, h*0.32, h*0.12, 0, 0, Math.PI*2); g.fill(); g.restore();
    g.drawImage(spr, sx - w/2 + (shakeX||0), sy - hh + h*0.12, w, hh);
  }

  const TREE_EMOJI  = { [B_GRASS]:'🌳', [B_JUNGLE]:'🌴', [B_DESERT]:'🌵', [B_MOUNTAIN]:'🌲' };
  const BERRY_EMOJI = { [B_DESERT]:'🍑' };
  const PED_EMOJI   = ['🚶','🧑','👩','👨','🧍','👷','💃','🕺','🧕','🧑‍🌾'];
  const CAR_EMOJI   = ['🚗','🚕','🚙','🚚','🏎️','🛻','🚐','🚓'];
  const ANIMAL_EMOJI= ['🐄','🐖','🐔','🐑','🐐','🐴','🦆','🐇'];
  const CROP_EMOJI  = { carrot:'🥕', grain:'🌾', tomato:'🍅' };

  // per-node hit shake fx: nodeId → seconds remaining
  let _hitFx = {};

  // ── multi-hit harvesting + speed upgrades + crit/dud ────────────────────────
  const BASE_HITS   = { tree:3, rock:3, berry:2 };   // taps to harvest at speed 0
  const SPEED_MAX   = { wood:2, stone:2, berry:1 };  // max speed-upgrade levels
  const SPEED_COST  = { wood:[40,90], stone:[45,100], berry:[35] };  // credits per level
  const CRIT_CHANCE = 0.14, DUD_CHANCE = 0.10;       // lucky double / unlucky nothing
  function resOf(type){ return type==='tree'?'wood': type==='rock'?'stone':'berry'; }
  function requiredHits(prog, type){ return Math.max(1, (BASE_HITS[type]||1) - ((prog.speed&&prog.speed[resOf(type)])||0)); }

  // ── barnyard animals — a few emoji critters wander near the player's Barn ────
  let _animals = [];
  let _animalsKey = '';
  function syncAnimals(prog){
    const barn = prog.buildings.find(b=>b.type==='barn');
    const key = barn ? `${barn.x},${barn.y}` : '';
    if (key===_animalsKey) return;
    _animalsKey = key; _animals = [];
    if (!barn) return;
    for (let i=0;i<5;i++){
      const ax = barn.x + (Math.random()*4-2), ay = barn.y + 1.5 + (Math.random()*3);
      _animals.push({ emoji:ANIMAL_EMOJI[i%ANIMAL_EMOJI.length], x:ax, y:ay, tx:ax, ty:ay,
        cx:barn.x, cy:barn.y+1.5, spd:0.14+Math.random()*0.10, phase:Math.random()*6 });
    }
  }
  function tickAnimals(dt){
    for (const a of _animals){
      const dx=a.tx-a.x, dy=a.ty-a.y, d=Math.hypot(dx,dy);
      if (d<0.12){ a.tx=a.cx+(Math.random()*5-2.5); a.ty=a.cy+(Math.random()*3.5-0.5); }
      else { a.x += dx/d*a.spd*dt; a.y += dy/d*a.spd*dt; }
    }
  }

  // ── node drawing ─────────────────────────────────────────────────────────────
  // Ground shadow shared by the clay node sprites (same grounding trick as
  // drawEmoji's, sized to the sprite width).
  function nodeShadow(g, sx, sy, w, z) {
    g.save(); g.globalAlpha = 0.15; g.fillStyle = '#1E2A16';
    g.beginPath(); g.ellipse(sx, sy + 2*z, w*0.34, w*0.15, 0, 0, Math.PI*2); g.fill();
    g.restore();
  }

  function drawTree(g, sx, sy, bio, z, fx) {
    const s = ((fx&&fx.scale)||1) * ((fx&&fx.nodeScale)||1), shk = (fx&&fx.shake)||0;
    // Clay sprite first (nodeset planets) — biome picks the species, a stable
    // per-node hash picks the oak silhouette so the forest isn't clones.
    if (_pdef.nodeset) {
      let key;
      if (_pdef.noTrees || _pdef.landOnlyRocks) key = 'rock_basalt';
      else if (_pdef.name === 'Vesper') key = 'tree_crystal';
      else if (_pdef.name === 'Dusk') key = 'tree_pine';
      else if (_pdef.name === 'Sorn') key = 'tree_cactus';
      else key = bio===B_JUNGLE ? 'tree_palm' : bio===B_DESERT ? 'tree_cactus'
                : bio===B_MOUNTAIN ? 'tree_pine'
                : (hash2((fx&&fx.hx)||0, (fx&&fx.hy)||0) > 0.5 ? 'tree_oak_a' : 'tree_oak_b');
      const base = (CWE ? CWE.nodeBaseW('tree', _pdef.proc) : 70);
      const w = base*z*s;
      nodeShadow(g, sx, sy, w, z);
      const set = _pdef.nodeset;
      if (ART.drawProp(g, 'node_'+set+'_'+key, sx+shk, sy+2*z, w, 256)) return;
      if (set !== 'mira' && ART.drawProp(g, 'node_mira_'+key, sx+shk, sy+2*z, w, 256)) return;
    }
    if (USE_EMOJI) { drawEmoji(g, (_pdef.flora&&_pdef.flora[bio])||TREE_EMOJI[bio]||'🌳', sx, sy, 42*z*s, shk); return; }
    const tH = 11*z, tW = 5*z;
    // shadow
    g.save(); g.globalAlpha=0.16; g.fillStyle=C.ink;
    g.beginPath(); g.ellipse(sx+3*z, sy+2*z, 11*z, 5*z, 0, 0, Math.PI*2); g.fill(); g.restore();
    // trunk
    g.fillStyle = bio===B_DESERT ? '#9A7050' : '#7A5230';
    g.fillRect(sx-tW/2, sy-tH, tW, tH);

    if (bio===B_DESERT) {
      // cactus
      g.fillStyle='#70A850';
      g.fillRect(sx-3*z, sy-tH-14*z, 6*z, 14*z);
      g.fillRect(sx-9*z, sy-tH-5*z, 6*z, 6*z);
      g.fillRect(sx+3*z, sy-tH-7*z, 6*z, 6*z);
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z); g.strokeRect(sx-3*z, sy-tH-14*z, 6*z, 14*z);
    } else if (bio===B_MOUNTAIN) {
      // pine — stacked triangles
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z);
      for (let tier=0; tier<3; tier++) {
        const ty2=sy-tH-(4+tier*6)*z, tw=(14-tier*3)*z;
        g.fillStyle = tier===0 ? '#4A8828' : tier===1 ? '#5A9E38' : '#70B848';
        g.beginPath(); g.moveTo(sx, ty2-8*z); g.lineTo(sx+tw, ty2); g.lineTo(sx-tw, ty2); g.closePath();
        g.fill(); g.stroke();
      }
    } else if (bio===B_JUNGLE) {
      // big lush canopy
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z);
      const layers = [{r:13*z,ox:-3*z,oy:-8*z,c:'#2A7040'},{r:11*z,ox:3*z,oy:-13*z,c:'#3A9050'},{r:9*z,ox:0,oy:-17*z,c:'#50A860'}];
      for (const l of layers) { g.fillStyle=l.c; g.beginPath(); g.arc(sx+l.ox, sy+l.oy, l.r, 0, Math.PI*2); g.fill(); g.stroke(); }
    } else {
      // oak
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z);
      const layers = [{r:11*z,ox:0,oy:-6*z,c:'#386820'},{r:9*z,ox:-3*z,oy:-12*z,c:'#488030'},{r:8*z,ox:3*z,oy:-15*z,c:'#5A9E3A'}];
      for (const l of layers) { g.fillStyle=l.c; g.beginPath(); g.arc(sx+l.ox, sy+l.oy, l.r, 0, Math.PI*2); g.fill(); g.stroke(); }
    }
  }

  function drawRock(g, sx, sy, bio, z, fx) {
    const s = ((fx&&fx.scale)||1) * ((fx&&fx.nodeScale)||1), shk = (fx&&fx.shake)||0;
    if (_pdef.nodeset) {
      let key = hash2((fx&&fx.hx)||0, (fx&&fx.hy)||0) > 0.5 ? 'rock_a' : 'rock_b';
      if (_pdef.name === 'Cinder') key = 'rock_basalt';
      else if (_pdef.name === 'Dusk') key = 'rock_ice';
      else if (_pdef.name === 'Vesper') key = hash2((fx&&fx.hx)||1,(fx&&fx.hy)||1)>0.5 ? 'rock_crystal' : 'rock_a';
      const base = (CWE ? CWE.nodeBaseW('rock', _pdef.proc) : 58);
      const w = base*z*s;
      nodeShadow(g, sx, sy, w, z);
      const set = _pdef.nodeset;
      if (ART.drawProp(g, 'node_'+set+'_'+key, sx+shk, sy+2*z, w, 256)) return;
      if (set !== 'mira' && ART.drawProp(g, 'node_mira_'+key, sx+shk, sy+2*z, w, 256)) return;
    }
    if (USE_EMOJI) { drawEmoji(g, _pdef.rock||'🪨', sx, sy, 22*z*s, shk); return; }
    const rs = 8*z*s;
    g.save(); g.globalAlpha=0.14; g.fillStyle=C.ink;
    g.beginPath(); g.ellipse(sx+2*z, sy+1*z, rs*1.2, rs*0.5, 0, 0, Math.PI*2); g.fill(); g.restore();
    const topC = bio===B_MOUNTAIN ? '#B8B8C8' : bio===B_DESERT ? '#C8B888' : '#A8A090';
    const lC   = bio===B_MOUNTAIN ? '#808090' : bio===B_DESERT ? '#A09060' : '#787068';
    const rC   = bio===B_MOUNTAIN ? '#606070' : bio===B_DESERT ? '#887848' : '#585048';
    isoBox(g, sx, sy, rs*0.85, rs*0.42, rs*0.9, topC, lC, rC, C.ink);
  }

  function drawBerry(g, sx, sy, bio, z, fx) {
    const s = ((fx&&fx.scale)||1) * ((fx&&fx.nodeScale)||1), shk = (fx&&fx.shake)||0;
    if (_pdef.nodeset) {
      let bkey = 'berry_bush';
      if (_pdef.name === 'Vesper') bkey = 'berry_glow';
      else if (_pdef.name === 'Sorn' || _pdef.name === 'Cinder') bkey = 'berry_cactus';
      const base = (CWE ? CWE.nodeBaseW('berry', _pdef.proc) : 48);
      const w = base*z*s;
      nodeShadow(g, sx, sy, w, z);
      const set = _pdef.nodeset;
      if (ART.drawProp(g, 'node_'+set+'_'+bkey, sx+shk, sy+2*z, w, 256)) return;
      if (set !== 'mira' && ART.drawProp(g, 'node_mira_'+bkey, sx+shk, sy+2*z, w, 256)) return;
      if (ART.drawProp(g, 'node_mira_berry_bush', sx+shk, sy+2*z, w, 256)) return;
    }
    if (USE_EMOJI) { drawEmoji(g, _pdef.berry||BERRY_EMOJI[bio]||'🫐', sx, sy, 20*z*s, shk); return; }
    // bush base
    const bushC = bio===B_JUNGLE ? '#2A8040' : bio===B_DESERT ? '#7A9040' : '#48A848';
    g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z);
    g.fillStyle=bushC;
    g.beginPath(); g.arc(sx, sy-7*z, 8*z, 0, Math.PI*2); g.fill(); g.stroke();
    // berries
    const dotC = bio===B_DESERT ? ['#D09028','#C07820'] : ['#D04050','#E06070','#B83040'];
    for (let i=0; i<4; i++) {
      g.fillStyle=dotC[i%dotC.length];
      g.beginPath(); g.arc(sx+(i-1.5)*4.5*z, sy-(5+i%2*5)*z, 3*z, 0, Math.PI*2); g.fill();
    }
  }

  // ── farm crop — sprout that grows taller by stage; ripe crops bob + show fruit ─
  function drawCrop(g, sx, sy, crop, z) {
    if (HEADLESS) return;
    const def = SEED_BY[crop.type]; if (!def) return;
    const ripe = crop.stage >= def.grow;
    const t = Math.max(0.15, Math.min(1, crop.stage / def.grow));   // growth fraction

    if (USE_EMOJI) {
      // watered soil sheen
      if (crop.watered){ g.save(); g.globalAlpha=0.30; g.fillStyle='#2b6fb0'; g.beginPath(); g.ellipse(sx, sy+2*z, 8*z, 3.4*z, 0,0,Math.PI*2); g.fill(); g.restore(); }
      const bob = ripe ? Math.sin(_frame*3 + sx*0.3)*1.5*z : 0;
      if (ripe) {
        drawEmoji(g, CROP_EMOJI[crop.type]||'🌱', sx, sy - bob, 20*z);
        g.fillStyle='#a0ffa0'; g.font=`bold ${Math.max(7,9*z)|0}px sans-serif`; g.textAlign='center';
        g.fillText('✓', sx, sy-24*z+bob);
      } else {
        drawEmoji(g, t<0.6 ? '🌱' : '🌿', sx, sy, (10 + 8*t)*z);
      }
      return;
    }

    const h = (4 + 12*t) * z;
    // little soil mound + shadow
    g.save(); g.globalAlpha=0.18; g.fillStyle=C.ink;
    g.beginPath(); g.ellipse(sx, sy+2*z, 7*z, 3*z, 0, 0, Math.PI*2); g.fill(); g.restore();
    // watered soil sheen
    if (crop.watered){ g.save(); g.globalAlpha=0.35; g.fillStyle='#2b6fb0'; g.beginPath(); g.ellipse(sx, sy+2*z, 8*z, 3.4*z, 0,0,Math.PI*2); g.fill(); g.restore(); }
    const bob = ripe ? Math.sin(_frame*3 + sx*0.3)*1.2*z : 0;
    // stems
    g.strokeStyle='#3d8b2e'; g.lineWidth=Math.max(1,1.6*z);
    for (const dx of [-2.2, 0, 2.2]){
      g.beginPath(); g.moveTo(sx+dx*z, sy); g.lineTo(sx+dx*z*0.5, sy-h+bob); g.stroke();
    }
    // leaves
    g.fillStyle='#5ab84a';
    g.beginPath(); g.ellipse(sx, sy-h*0.6+bob, 4*z*t, 2*z*t, 0.5, 0, Math.PI*2); g.fill();
    // fruit when ripe (colored dots at the top)
    if (ripe){
      g.save(); g.fillStyle=def.top;
      for (const dx of [-2.2, 0, 2.2]){ g.beginPath(); g.arc(sx+dx*z*0.5, sy-h+bob, 2.6*z, 0, Math.PI*2); g.fill(); }
      g.restore();
      // ready glyph
      g.fillStyle='#a0ffa0'; g.font=`${Math.max(7,9*z)|0}px sans-serif`; g.textAlign='center';
      g.fillText('✓', sx, sy-h-6*z+bob);
    }
  }

  // ── window grid on iso left + right faces ────────────────────────────────
  // Each window gets a stable color + its own flicker rate, giving buildings
  // the look of a living Night City skyline with people inside.
  function drawWinGrid(g, sx, sy, hw, hh, bh, z, winCol) {
    const rows = Math.max(3, Math.floor(bh / (7.5*z)));
    const cols = 2;
    const wW = Math.max(1.5, 1.8*z), wH = Math.max(1.5, 2.4*z);
    // Daytime glass — muted sky reflections, not hot neon
    const WIN_COLS = [
      'rgba(150,190,215,0.55)',  // cool glass
      'rgba(175,205,225,0.50)',  // pale sky
      'rgba(120,165,195,0.50)',  // steel blue
      'rgba(200,210,215,0.45)',  // light grey
      'rgba(140,180,200,0.50)',  // slate
    ];
    g.save();
    for (let face = 0; face < 2; face++) {
      for (let r = 0; r < rows; r++) {
        const tr = (r + 0.5) / rows;
        const baseY = sy + hh - tr * bh;
        for (let c = 0; c < cols; c++) {
          const tc = (c + 0.5) / cols;
          // Stable hash for this window — same color/flicker every frame
          const h = Math.abs((sx*7.3+sy*13.7+r*31+c*17+face*53)|0);
          // ~18% of windows always off (dark rooms)
          if (h % 6 === 0) continue;
          // Summer carnival: all windows pulse bright white together
          const carniPulse = (_festival.active && _season.idx === 1);
          // Winter Ice Gala: all windows shift to icy blue
          const iceGalaWin = (_festival.active && _season.idx === 3);
          const col = iceGalaWin ? 'rgba(100,200,255,0.70)' : winCol || WIN_COLS[h % WIN_COLS.length];
          // Slow flicker — each window at its own rate (unified pulse during carnival)
          const flickFreq = 0.18 + (h % 12) * 0.09;
          const flicker = carniPulse
            ? (0.80 + 0.20 * Math.sin(_frame * 0.18))
            : (0.72 + 0.28 * Math.sin(_frame * flickFreq + h * 0.63));
          g.globalAlpha = flicker;
          g.fillStyle = col;
          let wx, wy, rot;
          if (face === 0) {
            wx = sx - hw + tc*hw*0.85; wy = baseY + tc*hh*0.85; rot = -0.24;
          } else {
            wx = sx + tc*hw*0.85; wy = baseY - tc*hh*0.85; rot = 0.24;
          }
          g.save(); g.translate(wx, wy); g.rotate(rot);
          g.fillRect(-wW/2, -wH/2, wW, wH); g.restore();
        }
      }
    }
    g.restore();
  }

  // ── isometric cylinder ────────────────────────────────────────────────────
  function drawCylinder(g, sx, sy, def, z, showName) {
    const _nm = (showName===false) ? '' : def.name;
    const hw = ISO_HW*z*def.hw, hh = ISO_HH*z*def.hw*0.5, bh = def.bh*z;
    // Left body face (parallelogram)
    g.beginPath();
    g.moveTo(sx-hw, sy); g.lineTo(sx, sy+hh);
    g.lineTo(sx, sy+hh-bh); g.lineTo(sx-hw, sy-bh);
    g.closePath(); g.fillStyle=def.colL; g.fill();
    g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
    // Right body face
    g.beginPath();
    g.moveTo(sx+hw, sy); g.lineTo(sx, sy+hh);
    g.lineTo(sx, sy+hh-bh); g.lineTo(sx+hw, sy-bh);
    g.closePath(); g.fillStyle=def.colR; g.fill();
    g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
    // Horizontal ring bands on the body
    const bands = Math.max(3, Math.floor(bh/(9*z)));
    g.save(); g.globalAlpha=0.18; g.strokeStyle=C.ink; g.lineWidth=Math.max(0.3,0.5*z);
    for (let b=1; b<bands; b++) {
      const by = sy - bh*(b/bands);
      g.beginPath(); g.ellipse(sx, by, hw, hh, 0, 0, Math.PI*2); g.stroke();
    }
    g.restore();
    // Top cap ellipse
    g.beginPath(); g.ellipse(sx, sy-bh, hw, hh, 0, 0, Math.PI*2);
    g.fillStyle=def.colT; g.fill();
    g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
    // Window dots on front face (left and right panels)
    drawWinGrid(g, sx, sy, hw, hh, bh, z, 'rgba(255,245,160,0.75)');
    // Antenna
    const aH = 16*z;
    g.strokeStyle=def.colT; g.lineWidth=Math.max(0.8, 1.2*z);
    g.beginPath(); g.moveTo(sx, sy-bh); g.lineTo(sx, sy-bh-aH); g.stroke();
    g.save(); g.globalAlpha=0.6+0.4*Math.sin(_frame*3);
    g.fillStyle='#FF3030';
    g.beginPath(); g.arc(sx, sy-bh-aH, 2.5*z, 0, Math.PI*2); g.fill();
    g.restore();
    // Label
    if (z > 0.55) {
      g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center';
      g.fillText(_nm, sx, sy-bh-aH-5*z);
    }
  }

  // ── isometric pyramid (4 triangular faces) ───────────────────────────────
  function drawIsoPyramid(g, sx, sy, hw, hh, bh, colT, colL, colR, z) {
    // apex is bh above the base diamond's visual centre
    const apx = sx, apy = sy + hh - bh;
    g.strokeStyle = '#101010'; g.lineWidth = Math.max(0.4, 0.6*z);
    // back-left face (medium)
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx-hw, sy+hh); g.lineTo(apx, apy);
    g.closePath(); g.fillStyle=colL; g.fill(); g.stroke();
    // back-right face (darkest)
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx+hw, sy+hh); g.lineTo(apx, apy);
    g.closePath(); g.fillStyle=colR; g.fill(); g.stroke();
    // front-left face (lightest — catches overhead light like a top face)
    g.beginPath(); g.moveTo(sx-hw, sy+hh); g.lineTo(sx, sy+2*hh); g.lineTo(apx, apy);
    g.closePath(); g.fillStyle=colT; g.fill(); g.stroke();
    // front-right face (medium)
    g.beginPath(); g.moveTo(sx+hw, sy+hh); g.lineTo(sx, sy+2*hh); g.lineTo(apx, apy);
    g.closePath(); g.fillStyle=colL; g.fill(); g.stroke();
  }

  function drawBuilding(g, sx, sy, type, z, isCity, level, showName) {
    const def = (isCity ? CITY_BY_KEY[type] : null)
             || BT_BY_KEY[type]
             || CITY_BY_KEY[type]
             || BTYPES[0];
    const _nm = (showName===false) ? '' : def.name;

    // Soft ground contact shadow — D2/AoE buildings sit ON the ground, not float
    {
      const _gs0 = BLDG_SCALE[type] || 1.1;
      const shw = ISO_HW * z * (def.hw || 0.85) * _gs0 * 0.95;
      const shh = ISO_HH * z * (def.hw || 0.85) * _gs0 * 0.55;
      g.save();
      g.globalAlpha = (_pdef && _pdef.worldType === 'moon') ? 0.38 : 0.26;
      g.fillStyle = '#0A0A10';
      g.beginPath();
      g.ellipse(sx, sy + 2 * z, shw, shh, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // ── Sprite-first: cute 3D PNG art when the Mira building pack covers this
    //    type. Every procedural branch below stays as the fallback (headless,
    //    art still loading, or a type the pack doesn't have).
    {
      const _gs = BLDG_SCALE[type] || 1.1;
      const phw = ISO_HW*z*def.hw*_gs, phh = ISO_HH*z*def.hw*0.5;
      const artH = ART.drawMiraBldg(g, type, sx, sy, phw, phh, (def.bh+30)*z*1.35*_gs, _pdef.bldgset);
      if (artH) {
        if (_nm && z > 0.55) {
          g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center';
          g.fillText(_nm, sx, sy+phh-artH-5*z);
        }
        return;
      }
    }

    // ── Cylinder skyscraper ─────────────────────────────────────────────
    if (type === 'sky_cyl') { drawCylinder(g, sx, sy, def, z, showName); return; }

    // ── Art Deco skyscraper (stepped setbacks) ──────────────────────────
    if (type === 'sky_deco') {
      const sections = def.sections || [];
      let curY = sy, accH = 0;
      for (let i = sections.length-1; i >= 0; i--) {
        const sec = sections[i];
        const shw = ISO_HW*z*sec.hw, shh = ISO_HH*z*sec.hw*0.5, sbh = sec.bh*z;
        isoBox(g, sx, curY-accH, shw, shh, sbh, sec.colT, sec.colL, sec.colR, C.ink);
        drawWinGrid(g, sx, curY-accH, shw, shh, sbh, z);
        accH += sbh;
      }
      // Metal spire
      const totalH = accH;
      const spH = 22*z;
      g.fillStyle='#B8BEC6';
      g.beginPath(); g.moveTo(sx, sy-totalH-spH); g.lineTo(sx+7*z, sy-totalH+spH*0.08); g.lineTo(sx-7*z, sy-totalH+spH*0.08); g.closePath(); g.fill();
      // Concrete setback ledges
      g.save(); g.globalAlpha=0.5;
      for (let i = 1; i < sections.length; i++) {
        const hw2 = ISO_HW*z*(sections[i-1].hw+0.04);
        const hh2 = ISO_HH*z*(sections[i-1].hw+0.04)*0.5;
        let ah2 = 0; for(let k=i; k<sections.length; k++) ah2+=sections[k].bh*z;
        isoBox(g, sx, sy-ah2, hw2, hh2, 2*z, '#C4C0B4', '#9A968A', '#78746A', null);
      }
      g.restore();
      // Aircraft-warning beacon (small red blink)
      g.save(); g.globalAlpha=0.6+0.3*Math.sin(_frame*3);
      g.fillStyle='#E04040'; g.beginPath(); g.arc(sx, sy-totalH-spH, 2*z, 0, Math.PI*2); g.fill(); g.restore();
      if (z > 0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm, sx, sy-totalH-spH-5*z); }
      return;
    }

    // ── Glass tower (horizontal floor lines) ────────────────────────────
    if (type === 'sky_glass') {
      const hwM=def.hw, hw2=ISO_HW*z*hwM, hh2=ISO_HH*z*hwM*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Horizontal floor lines (subtle)
      const floors = Math.floor(bh2/(6*z));
      g.save(); g.globalAlpha=0.22; g.strokeStyle='#8FB4C8'; g.lineWidth=Math.max(0.4,0.55*z);
      for (let f=1; f<=floors; f++) {
        const fy = sy+hh2 - f*(bh2/(floors+1));
        g.beginPath(); g.moveTo(sx-hw2, fy-hh2); g.lineTo(sx, fy); g.stroke();
        g.beginPath(); g.moveTo(sx+hw2, fy-hh2); g.lineTo(sx, fy); g.stroke();
      }
      g.restore();
      drawWinGrid(g, sx, sy, hw2, hh2, bh2, z, 'rgba(150,190,215,0.55)');
      // Flat rooftop equipment box
      const rh=5*z, rhw=hw2*0.25, rhh=hh2*0.25;
      isoBox(g, sx, sy-bh2, rhw, rhh, rh, '#8A8E96', '#6C7078', '#54585E', C.ink);
      if (z > 0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm, sx, sy-bh2-rh-5*z); }
      return;
    }

    // ── Standard rect / medium towers ───────────────────────────────────
    if (type === 'sky_rect' || type === 'sky_med') {
      const hwM=def.hw, bh2=def.bh*z;
      // Two-section (base + upper) for sky_rect; single for sky_med
      if (type === 'sky_rect') {
        const baseH=30*z, upperH=bh2-baseH;
        const hw2=ISO_HW*z*hwM, hh2=ISO_HH*z*hwM*0.5;
        const uhw=hw2*0.88, uhh=hh2*0.88;
        isoBox(g, sx, sy, hw2, hh2, baseH, def.colT, def.colL, def.colR, C.ink);
        isoBox(g, sx, sy-baseH, uhw, uhh, upperH, def.colT, def.colL, def.colR, C.ink);
        drawWinGrid(g, sx, sy-baseH, uhw, uhh, upperH, z);
        // Water tower on top
        const wt=8*z, wthw=uhw*0.28, wthh=uhh*0.28;
        isoBox(g, sx-uhw*0.4, sy-bh2, wthw, wthh, wt, '#A0A8B0', '#707880', '#506070', C.ink);
        if (z > 0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm, sx, sy-bh2-wt-5*z); }
      } else {
        const hw2=ISO_HW*z*hwM, hh2=ISO_HH*z*hwM*0.5;
        isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
        drawWinGrid(g, sx, sy, hw2, hh2, bh2, z, 'rgba(255,235,130,0.75)');
        if (z > 0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm, sx, sy-bh2-5*z); }
      }
      return;
    }

    // ── Silo — narrow cylinder + red cone cap ────────────────────────────
    if (type === 'silo') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      // Cylinder body
      g.beginPath(); g.moveTo(sx-hw2,sy); g.lineTo(sx,sy+hh2); g.lineTo(sx,sy+hh2-bh2); g.lineTo(sx-hw2,sy-bh2); g.closePath();
      g.fillStyle=def.colL; g.fill(); g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
      g.beginPath(); g.moveTo(sx+hw2,sy); g.lineTo(sx,sy+hh2); g.lineTo(sx,sy+hh2-bh2); g.lineTo(sx+hw2,sy-bh2); g.closePath();
      g.fillStyle=def.colR; g.fill(); g.stroke();
      // Ring bands
      const bands=Math.max(4,Math.floor(bh2/(8*z)));
      g.save(); g.globalAlpha=0.15; g.strokeStyle=C.ink; g.lineWidth=Math.max(0.3,0.5*z);
      for (let b2=1; b2<bands; b2++) { const by=sy-bh2*(b2/bands); g.beginPath(); g.ellipse(sx,by,hw2,hh2,0,0,Math.PI*2); g.stroke(); }
      g.restore();
      // Cone cap (two pyramid triangles + cylinder ellipse base)
      const capH=15*z;
      g.beginPath(); g.moveTo(sx-hw2,sy-bh2); g.lineTo(sx,sy-bh2-capH); g.lineTo(sx,sy-bh2+hh2); g.closePath();
      g.fillStyle='#B84030'; g.fill(); g.strokeStyle=C.ink; g.stroke();
      g.beginPath(); g.moveTo(sx+hw2,sy-bh2); g.lineTo(sx,sy-bh2-capH); g.lineTo(sx,sy-bh2+hh2); g.closePath();
      g.fillStyle='#882820'; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(sx,sy-bh2,hw2,hh2,0,0,Math.PI*2); g.fillStyle=def.colT; g.fill(); g.stroke();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-capH-5*z); }
      return;
    }

    // ── Water Tower — legs + elevated cylinder tank ──────────────────────
    if (type === 'water_tower') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      const legH=bh2*0.44, thw=hw2*0.78, thh=hh2*0.78, tankBh=bh2*0.42;
      // Legs (two V-shapes — front visible pair)
      g.strokeStyle=def.colL; g.lineWidth=Math.max(1.5,2*z);
      g.beginPath(); g.moveTo(sx-thw*0.6,sy-legH+thh*0.4); g.lineTo(sx-hw2*0.45,sy+hh2*0.7); g.stroke();
      g.beginPath(); g.moveTo(sx+thw*0.6,sy-legH+thh*0.4); g.lineTo(sx+hw2*0.45,sy+hh2*0.7); g.stroke();
      g.save(); g.globalAlpha=0.38;
      g.beginPath(); g.moveTo(sx-thw*0.2,sy-legH+thh*0.7); g.lineTo(sx,sy+hh2*1.2); g.stroke();
      g.beginPath(); g.moveTo(sx+thw*0.2,sy-legH+thh*0.7); g.lineTo(sx,sy+hh2*1.2); g.stroke();
      g.restore();
      // Cross brace
      g.save(); g.globalAlpha=0.4; g.lineWidth=Math.max(0.6,z);
      g.beginPath(); g.moveTo(sx-thw*0.58,sy-legH*0.55); g.lineTo(sx+thw*0.58,sy-legH*0.55); g.stroke();
      g.restore();
      // Tank cylinder (elevated)
      const ty2=sy-legH;
      g.beginPath(); g.moveTo(sx-thw,ty2); g.lineTo(sx,ty2+thh); g.lineTo(sx,ty2+thh-tankBh); g.lineTo(sx-thw,ty2-tankBh); g.closePath();
      g.fillStyle=def.colL; g.fill(); g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
      g.beginPath(); g.moveTo(sx+thw,ty2); g.lineTo(sx,ty2+thh); g.lineTo(sx,ty2+thh-tankBh); g.lineTo(sx+thw,ty2-tankBh); g.closePath();
      g.fillStyle=def.colR; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(sx,ty2-tankBh,thw,thh,0,0,Math.PI*2); g.fillStyle=def.colT; g.fill(); g.stroke();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,ty2-tankBh-thh-5*z); }
      return;
    }

    // ── Pyramid — Egyptian stone pyramid ─────────────────────────────────
    if (type === 'pyramid') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      drawIsoPyramid(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, z);
      // Gilded capstone
      const apx=sx, apy=sy+hh2-bh2;
      g.beginPath(); g.moveTo(apx,apy-5*z); g.lineTo(apx+4*z,apy+2*z); g.lineTo(apx-4*z,apy+2*z); g.closePath();
      g.fillStyle='#F0C840'; g.fill(); g.strokeStyle=C.ink; g.lineWidth=0.5*z; g.stroke();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,apy-9*z); }
      return;
    }

    // ── Stepped Temple — 3-tier Mayan pyramid ────────────────────────────
    if (type === 'stepped_temple') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      const stepH=bh2*0.30;
      // Draw bottom-to-top; each step's sy is the previous step's top-back-corner
      isoBox(g, sx, sy,          hw2,      hh2,      stepH, def.colT, def.colL, def.colR, C.ink);
      isoBox(g, sx, sy-stepH,   hw2*0.70, hh2*0.70, stepH, def.colT, def.colL, def.colR, C.ink);
      isoBox(g, sx, sy-2*stepH, hw2*0.42, hh2*0.42, stepH, def.colT, def.colL, def.colR, C.ink);
      // Small altar cap
      const altarY=sy-3*stepH, aHw=hw2*0.18, aHh=hh2*0.18;
      isoBox(g, sx, altarY, aHw, aHh, 5*z, '#E8D0A0','#C0A870','#A08050', C.ink);
      // Flame on altar
      g.save(); g.globalAlpha=0.70+0.30*Math.sin(_frame*4);
      g.fillStyle='#FF8820';
      g.beginPath(); g.moveTo(sx,altarY-5*z-9*z); g.lineTo(sx+4*z,altarY-5*z); g.lineTo(sx-4*z,altarY-5*z); g.closePath(); g.fill();
      g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,altarY-16*z); }
      return;
    }

    // ── Obelisk — thin shaft + pyramid spire ─────────────────────────────
    if (type === 'obelisk') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      // Wider base plinth
      isoBox(g, sx, sy, hw2*1.6, hh2*1.6, 7*z, def.colT, def.colL, def.colR, C.ink);
      // Shaft (slight taper — draw two slightly different widths)
      isoBox(g, sx, sy-7*z, hw2, hh2, bh2-7*z, def.colT, def.colL, def.colR, C.ink);
      // Gold hieroglyph band
      g.save(); g.globalAlpha=0.55; g.fillStyle='#D0A030';
      g.fillRect(sx-hw2*0.35, sy-bh2*0.55, hw2*0.7, Math.max(1.5, 2*z));
      g.restore();
      // Pyramid tip
      drawIsoPyramid(g, sx, sy-bh2, hw2*1.1, hh2*1.1, 18*z, '#F0E0B0', def.colL, def.colR, z);
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-18*z-hh2-5*z); }
      return;
    }

    // ── Round Guard — cylinder with crenellated battlements ───────────────
    if (type === 'round_guard') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      // Cylinder body
      g.beginPath(); g.moveTo(sx-hw2,sy); g.lineTo(sx,sy+hh2); g.lineTo(sx,sy+hh2-bh2); g.lineTo(sx-hw2,sy-bh2); g.closePath();
      g.fillStyle=def.colL; g.fill(); g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
      g.beginPath(); g.moveTo(sx+hw2,sy); g.lineTo(sx,sy+hh2); g.lineTo(sx,sy+hh2-bh2); g.lineTo(sx+hw2,sy-bh2); g.closePath();
      g.fillStyle=def.colR; g.fill(); g.stroke();
      // Top rim ellipse
      g.beginPath(); g.ellipse(sx,sy-bh2,hw2,hh2,0,0,Math.PI*2); g.fillStyle=def.colT; g.fill(); g.stroke();
      // Battlements (merlons) around the rim
      const numM=6, mW=hw2*0.24, mH=5*z;
      g.fillStyle=def.colT; g.strokeStyle=C.ink; g.lineWidth=Math.max(0.3,0.5*z);
      for (let m=0; m<numM; m++) {
        const angle=(m/numM)*Math.PI*2;
        const mx=sx+Math.cos(angle)*hw2*0.78, my=sy-bh2+Math.sin(angle)*hh2*0.78;
        g.save(); g.translate(mx,my); g.rotate(angle);
        g.fillRect(-mW/2,-mH,mW,mH); g.strokeRect(-mW/2,-mH,mW,mH); g.restore();
      }
      // Arrow slit
      g.save(); g.globalAlpha=0.65; g.fillStyle='#0A1520';
      g.fillRect(sx-hw2*0.28, sy-bh2*0.58, Math.max(2,2.5*z), Math.max(5,7*z)); g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-mH-5*z); }
      return;
    }

    // ── Cantina — warm neon sign strip ──────────────────────────────────
    if (type === 'cantina') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Awning overhang (thin flat ledge)
      isoBox(g, sx, sy, hw2*1.08, hh2*1.08, 2*z, '#E8A050', '#C07830', '#A05810', null);
      // Neon sign strip — hot orange pulse
      const signY = sy - bh2*0.62;
      g.save(); g.globalAlpha=0.80+0.20*Math.sin(_frame*4);
      g.shadowColor='#FF8800'; g.shadowBlur=10*z;
      g.fillStyle='#FF8800';
      g.fillRect(sx-hw2*0.88, signY, hw2*0.86, Math.max(2, 3*z));
      g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-hh2-5*z); }
      return;
    }

    // ── Repair Shop — wide garage with loading door ──────────────────────
    if (type === 'repair_shop') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Garage door on left face
      const dh=bh2*0.62, dw=hw2*0.7;
      g.fillStyle='#1E2830';
      g.beginPath(); g.moveTo(sx-dw,sy+hh2-dh); g.lineTo(sx,sy+hh2-dh*0.7); g.lineTo(sx,sy+hh2); g.lineTo(sx-hw2,sy+hh2); g.closePath(); g.fill();
      // Door panels
      g.save(); g.globalAlpha=0.28; g.strokeStyle='#5080A0'; g.lineWidth=Math.max(0.5,0.8*z);
      for (let d=1; d<4; d++) {
        const dy=sy+hh2-dh*(d/4);
        g.beginPath(); g.moveTo(sx-dw*0.92,dy+hh2*0.06*d); g.lineTo(sx-2*z,dy); g.stroke();
      }
      g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-hh2-5*z); }
      return;
    }

    // ── Fuel Depot — tanks on roof ───────────────────────────────────────
    if (type === 'fuel_depot') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Horizontal pipe band
      g.save(); g.globalAlpha=0.55; g.strokeStyle='#C08040'; g.lineWidth=Math.max(1.5,2.2*z);
      g.beginPath(); g.moveTo(sx-hw2,sy-bh2*0.4-hh2*0.4); g.lineTo(sx+hw2,sy-bh2*0.4-hh2*0.4); g.stroke();
      g.restore();
      // Two small cylindrical tanks on top
      for (let i=-1; i<=1; i+=2) {
        const tx2=sx+i*hw2*0.36, ty2=sy-bh2;
        const thw=hw2*0.24, thh=hh2*0.24, tbh=16*z;
        g.beginPath(); g.moveTo(tx2-thw,ty2); g.lineTo(tx2,ty2+thh); g.lineTo(tx2,ty2+thh-tbh); g.lineTo(tx2-thw,ty2-tbh); g.closePath();
        g.fillStyle='#888070'; g.fill(); g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
        g.beginPath(); g.moveTo(tx2+thw,ty2); g.lineTo(tx2,ty2+thh); g.lineTo(tx2,ty2+thh-tbh); g.lineTo(tx2+thw,ty2-tbh); g.closePath();
        g.fillStyle='#686060'; g.fill(); g.stroke();
        g.beginPath(); g.ellipse(tx2,ty2-tbh,thw,thh,0,0,Math.PI*2); g.fillStyle='#B0A890'; g.fill(); g.stroke();
      }
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-18*z-5*z); }
      return;
    }

    // ── Comms Tower — tall thin mast with dish ───────────────────────────
    if (type === 'comms_tower') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Cross-brace lattice lines
      g.save(); g.globalAlpha=0.35; g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z);
      for (let b2=0; b2<4; b2++) {
        const by=sy-bh2*(b2+0.5)/4;
        g.beginPath(); g.moveTo(sx-hw2,by-hh2*0.5); g.lineTo(sx+hw2,by+hh2*0.5); g.stroke();
      }
      g.restore();
      // Satellite dish
      const dsy=sy-bh2-4*z;
      g.save(); g.strokeStyle='#A0B0C0'; g.lineWidth=Math.max(0.8,1.2*z);
      g.beginPath(); g.moveTo(sx,dsy); g.lineTo(sx+10*z,dsy-6*z); g.stroke();
      g.beginPath(); g.ellipse(sx+11*z,dsy-7*z,8*z,5*z,0.6,0,Math.PI*2);
      g.strokeStyle=def.colT; g.stroke();
      g.restore();
      // Blinking beacon
      g.save(); g.globalAlpha=0.55+0.45*Math.sin(_frame*3);
      g.fillStyle='#FF4040'; g.beginPath(); g.arc(sx,sy-bh2,3*z,0,Math.PI*2); g.fill(); g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-20*z); }
      return;
    }

    // ── Med Bay — white with roof cross ─────────────────────────────────
    if (type === 'med_bay') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Blue cross on left face upper area
      const cW=Math.max(2,3.5*z), cL=Math.max(5,9*z);
      g.fillStyle='#2060C0';
      g.fillRect(sx-hw2*0.5-cL/2, sy-bh2*0.68, cL, cW);   // horizontal bar
      g.fillRect(sx-hw2*0.5-cW/2, sy-bh2*0.68-cL*0.5+cW/2, cW, cL*0.9);  // vertical bar
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-hh2-5*z); }
      return;
    }

    // ── Power Station — glowing vents + exhaust ──────────────────────────
    if (type === 'power_station') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Glowing vent slits on left face — electric yellow neon
      const glow = 0.55+0.45*Math.sin(_frame*2.5);
      g.save(); g.globalAlpha=glow*0.90; g.shadowColor='#FFEE00'; g.shadowBlur=8*z;
      g.fillStyle='#FFEE00';
      for (let v=0; v<3; v++) {
        const vy=sy-bh2*(0.25+v*0.22);
        g.fillRect(sx-hw2*0.75, vy, hw2*0.55, Math.max(1.5,2*z));
      }
      g.restore();
      // Exhaust chimney
      const chw=hw2*0.22, chh=hh2*0.22, ch=18*z;
      isoBox(g, sx+hw2*0.28, sy-bh2, chw, chh, ch, '#505860','#303840','#202830', C.ink);
      // Smoke puff (animated)
      g.save(); g.globalAlpha=0.18+0.12*Math.sin(_frame*1.8);
      g.fillStyle='#B0B8C0';
      g.beginPath(); g.arc(sx+hw2*0.28, sy-bh2-ch-8*z, 6*z, 0, Math.PI*2); g.fill(); g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-ch-14*z); }
      return;
    }

    // ── Traders Guild — gold merchant hall + flag ─────────────────────────
    if (type === 'traders_guild') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Neon green trim ledge
      g.save(); g.shadowColor='#00FF88'; g.shadowBlur=8*z;
      isoBox(g, sx, sy-bh2*0.55, hw2*1.04, hh2*1.04, 2.5*z, '#00FF88','#00AA55','#007733', null);
      g.restore();
      // Flag pole
      const fh=18*z;
      g.strokeStyle='#00FF88'; g.lineWidth=Math.max(0.8,1.2*z);
      g.beginPath(); g.moveTo(sx,sy-bh2); g.lineTo(sx,sy-bh2-fh); g.stroke();
      // Flag (waves with _frame)
      const wave=Math.sin(_frame*3)*1.5*z;
      g.fillStyle='#00FF44';
      g.beginPath(); g.moveTo(sx,sy-bh2-fh); g.lineTo(sx+9*z+wave,sy-bh2-fh+3*z); g.lineTo(sx+9*z-wave,sy-bh2-fh+7*z); g.lineTo(sx,sy-bh2-fh+6*z); g.closePath(); g.fill();
      drawWinGrid(g, sx, sy, hw2, hh2, bh2, z, 'rgba(0,255,136,0.55)');
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-fh-5*z); }
      return;
    }

    // ── Cargo Bay — wide warehouse with loading door ─────────────────────
    if (type === 'cargo_bay') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Wide loading door
      const dh=bh2*0.72, dw=hw2*0.82;
      g.fillStyle='#1A2530';
      g.beginPath(); g.moveTo(sx-dw,sy+hh2-dh); g.lineTo(sx,sy+hh2-dh*0.65); g.lineTo(sx,sy+hh2); g.lineTo(sx-hw2,sy+hh2); g.closePath(); g.fill();
      // Horizontal roll-up door lines
      g.save(); g.globalAlpha=0.22; g.strokeStyle='#5888A8'; g.lineWidth=Math.max(0.4,0.7*z);
      for (let d=1; d<5; d++) {
        const dy=sy+hh2-dh*(d/5);
        g.beginPath(); g.moveTo(sx-dw*0.9,dy+hh2*0.06*d); g.lineTo(sx-1*z,dy); g.stroke();
      }
      g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-hh2-5*z); }
      return;
    }

    // ── Barracks — military uniform windows ──────────────────────────────
    if (type === 'barracks') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Tight uniform windows — 2 rows, 3 cols each face
      const wW=Math.max(1.5,2*z), wH=Math.max(2,3*z);
      g.fillStyle='rgba(180,220,255,0.68)';
      for (let r=0; r<2; r++) {
        const tr=(r+0.5)/2; const baseY=sy+hh2-tr*bh2;
        for (let c=0; c<3; c++) {
          const tc=(c+0.5)/3;
          // left face
          const wx=sx-hw2+tc*hw2*0.85, wy=baseY+tc*hh2*0.85;
          g.save(); g.translate(wx,wy); g.rotate(-0.24); g.fillRect(-wW/2,-wH/2,wW,wH); g.restore();
          // right face
          const wx2=sx+tc*hw2*0.85, wy2=baseY-tc*hh2*0.85;
          g.save(); g.translate(wx2,wy2); g.rotate(0.24); g.fillRect(-wW/2,-wH/2,wW,wH); g.restore();
        }
      }
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-hh2-5*z); }
      return;
    }

    // ── Observatory — dome roof + telescope slot ──────────────────────────
    if (type === 'observatory') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=def.bh*z;
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Dome (upper-half ellipse) on top
      const domeH=hh2*2.8;
      g.beginPath(); g.ellipse(sx, sy-bh2, hw2*0.88, domeH, 0, Math.PI, 0);
      g.fillStyle=def.colT; g.fill(); g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z); g.stroke();
      // Dome shading left side
      g.save(); g.globalAlpha=0.18;
      g.fillStyle=C.ink;
      g.beginPath(); g.ellipse(sx-hw2*0.22, sy-bh2, hw2*0.44, domeH*0.88, 0, Math.PI, 0);
      g.fill(); g.restore();
      // Telescope slit
      g.save(); g.globalAlpha=0.55; g.strokeStyle='#1A2840'; g.lineWidth=Math.max(1.5,2.2*z);
      g.beginPath(); g.moveTo(sx, sy-bh2); g.lineTo(sx, sy-bh2-domeH*0.9); g.stroke();
      g.restore();
      // Stars twinkle
      g.save(); g.globalAlpha=0.45+0.4*Math.sin(_frame*2.2);
      g.fillStyle='#F0F8FF';
      g.beginPath(); g.arc(sx+5*z, sy-bh2-domeH*0.55, 1.5*z, 0, Math.PI*2); g.fill(); g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm,sx,sy-bh2-domeH-5*z); }
      return;
    }

    // ── Hangar — barrel-vault roof + glowing bay door (spaceport) ─────────
    if (type === 'hangar') {
      const hw2=ISO_HW*z*def.hw, hh2=ISO_HH*z*def.hw*0.5, bh2=(def.bh*z)*0.85;
      const topY=sy-bh2;
      const Tl=[sx-hw2, topY], Tr=[sx+hw2, topY], Tf=[sx, topY+hh2];
      // Lower steel walls
      isoBox(g, sx, sy, hw2, hh2, bh2, def.colT, def.colL, def.colR, C.ink);
      // Barrel-vault roof — arched crown over the front top-face triangle
      const archH=14*z, peakY=topY-archH*1.4;
      g.beginPath();
      g.moveTo(Tl[0],Tl[1]);
      g.quadraticCurveTo(sx, peakY, Tr[0],Tr[1]);
      g.lineTo(Tf[0],Tf[1]); g.closePath();
      g.fillStyle=def.colT; g.fill();
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.4,0.6*z); g.stroke();
      // Corrugation ribs fanning from the front point to the arched ridge
      g.save(); g.globalAlpha=0.28; g.strokeStyle=darker(def.colT,0.55); g.lineWidth=Math.max(0.4,0.7*z);
      for (let i=1;i<=4;i++){
        const t=i/5, rx=Tl[0]+(Tr[0]-Tl[0])*t, ry=topY-Math.sin(Math.PI*t)*archH*1.4;
        g.beginPath(); g.moveTo(Tf[0],Tf[1]); g.lineTo(rx,ry); g.stroke();
      }
      g.restore();
      // Ridge highlight
      g.save(); g.globalAlpha=0.22; g.strokeStyle='#FFFFFF'; g.lineWidth=Math.max(0.6,1*z);
      g.beginPath(); g.moveTo(Tl[0],Tl[1]); g.quadraticCurveTo(sx, peakY, Tr[0],Tr[1]); g.stroke();
      g.restore();
      // Big glowing bay door on the front-left (colL) face
      const P=(u,v)=>[sx-hw2+u*hw2, sy+u*hh2-v*bh2];
      const d0=P(0.18,0), d1=P(0.82,0), dTL=P(0.18,0.60), dTR=P(0.82,0.60), dArc=P(0.5,0.90);
      g.beginPath();
      g.moveTo(d0[0],d0[1]); g.lineTo(dTL[0],dTL[1]);
      g.quadraticCurveTo(dArc[0],dArc[1], dTR[0],dTR[1]);
      g.lineTo(d1[0],d1[1]); g.closePath();
      g.fillStyle='#100E0A'; g.fill();                    // dark interior
      // warm interior glow
      const gc=P(0.5,0.26);
      g.save(); g.globalAlpha=0.45+0.1*Math.sin(_frame*1.5); g.fillStyle='#FF8A32';
      g.beginPath(); g.ellipse(gc[0],gc[1], hw2*0.30, bh2*0.34, 0,0,Math.PI*2); g.fill(); g.restore();
      // lit door frame (warm neon accent)
      g.save(); g.globalAlpha=0.8; g.strokeStyle=def.neon||'#FF6600'; g.lineWidth=Math.max(0.8,1.2*z);
      g.beginPath();
      g.moveTo(d0[0],d0[1]); g.lineTo(dTL[0],dTL[1]);
      g.quadraticCurveTo(dArc[0],dArc[1], dTR[0],dTR[1]);
      g.lineTo(d1[0],d1[1]); g.stroke(); g.restore();
      // roof warning beacon
      g.save(); g.globalAlpha=0.5+0.4*Math.sin(_frame*3); g.fillStyle='#FF4040';
      g.beginPath(); g.arc(sx, peakY-2*z, 2*z, 0, Math.PI*2); g.fill(); g.restore();
      if (z>0.55) { g.fillStyle=C.ink; g.font=`bold ${Math.max(7,10*z)|0}px sans-serif`; g.textAlign='center'; g.fillText(_nm, sx, peakY-7*z); }
      return;
    }

    // ── Default / small city buildings ──────────────────────────────────
    const hwMult = def.hw ?? 0.7;
    const hw = ISO_HW*z*hwMult, hh = ISO_HH*z*hwMult*0.5;
    const bh = (def.bh ?? 22)*z;
    isoBox(g, sx, sy, hw, hh, bh, def.colT, def.colL, def.colR, C.ink);
    if (type==='apartment')  drawWinGrid(g, sx, sy, hw, hh, bh, z, 'rgba(0,200,255,0.50)');
    if (type==='town_house') drawWinGrid(g, sx, sy, hw, hh, bh, z, 'rgba(255,160,0,0.45)');
    if (type==='hotel')      drawWinGrid(g, sx, sy, hw, hh, bh, z, 'rgba(255,150,190,0.60)');

    // tower spire (player tower OR control tower)
    if (type==="tower" || type==="ctrl_tower") {
      // Glazed observation deck near the top (control room) — a wider lit ring
      if (type==="ctrl_tower") {
        const deckY = sy - bh*0.82, deckHw = hw*1.18, deckHh = hh*1.18, deckH = 9*z;
        isoBox(g, sx, deckY, deckHw, deckHh, deckH, '#0E2735', '#0A1C28', '#06121A', C.ink);
        // cyan glazing band — slanted lit strips on both visible faces
        g.save();
        for (let f=0; f<2; f++){
          for (let w=0; w<3; w++){
            const tc=(w+0.5)/3;
            g.globalAlpha=0.55+0.35*Math.sin(_frame*(0.4+w*0.3)+f*2+sx*0.1);
            g.fillStyle= def.neon || '#00EEFF';
            let wx,wy,rot;
            const wy0 = deckY - deckH*0.55;
            if (f===0){ wx=sx-deckHw+tc*deckHw*0.9; wy=wy0+tc*deckHh*0.9; rot=-0.24; }
            else       { wx=sx+tc*deckHw*0.9;        wy=wy0-tc*deckHh*0.9; rot=0.24; }
            g.save(); g.translate(wx,wy); g.rotate(rot);
            g.fillRect(-1.6*z, -2*z, 3.2*z, 4*z); g.restore();
          }
        }
        g.restore();
        // deck rim highlight
        g.save(); g.globalAlpha=0.4; g.strokeStyle=def.neon||'#00EEFF'; g.lineWidth=Math.max(0.6,1*z);
        g.beginPath(); g.ellipse(sx, deckY-deckH, deckHw, deckHh, 0, 0, Math.PI*2); g.stroke(); g.restore();
      }
      const sh = (type==="ctrl_tower" ? 18 : 10)*z;
      g.fillStyle=def.colT;
      g.beginPath(); g.moveTo(sx,sy-hh-bh-sh); g.lineTo(sx+7*z,sy-hh-bh+sh*0.05); g.lineTo(sx-7*z,sy-hh-bh+sh*0.05); g.closePath(); g.fill();
      g.strokeStyle=C.ink; g.lineWidth=0.8*z; g.stroke();
      // antenna blink (ctrl_tower only)
      if (type==="ctrl_tower") {
        g.save(); g.globalAlpha=0.55+0.45*Math.sin(_frame*3);
        g.fillStyle="#FF4040";
        g.beginPath(); g.arc(sx, sy-hh-bh-sh, 3*z, 0, Math.PI*2); g.fill();
        g.restore();
      }
    }


    // city gate arch
    if (type==="city_gate") {
      g.save();
      g.strokeStyle=def.colT; g.lineWidth=3*z;
      g.beginPath();
      g.arc(sx, sy-hh-bh*0.5, hw*0.6, Math.PI, 0);
      g.stroke();
      g.strokeStyle=C.ink; g.lineWidth=0.8*z; g.stroke();
      g.restore();
    }

    // city hall — civic dome + gold banner
    if (type==="city_hall") {
      g.fillStyle='#D8CCAE';
      g.beginPath(); g.ellipse(sx, sy-bh, hw*0.55, hh*1.9, 0, Math.PI, 0); g.fill();
      g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z); g.stroke();
      g.strokeStyle='#B8A86A'; g.lineWidth=Math.max(1,1.4*z);
      g.beginPath(); g.moveTo(sx, sy-bh-hh*1.9); g.lineTo(sx, sy-bh-hh*1.9-10*z); g.stroke();
      const bw2 = Math.sin(_frame*2.5)*1.5*z;
      g.fillStyle='#E8C84A';
      g.beginPath(); g.moveTo(sx, sy-bh-hh*1.9-10*z); g.lineTo(sx+8*z+bw2, sy-bh-hh*1.9-7*z); g.lineTo(sx, sy-bh-hh*1.9-4*z); g.closePath(); g.fill();
      // columned entrance hint
      g.save(); g.globalAlpha=0.5; g.strokeStyle='#8A8068'; g.lineWidth=Math.max(0.8,1.1*z);
      for (const dx of [-0.45,-0.15,0.15,0.45]){ g.beginPath(); g.moveTo(sx+dx*hw, sy+hh*0.4-bh*0.55); g.lineTo(sx+dx*hw*0.85, sy+hh*0.75); g.stroke(); }
      g.restore();
    }

    // barn — pitched roof + hayloft door
    if (type==="barn") {
      g.fillStyle='#7A2418'; g.strokeStyle=C.ink; g.lineWidth=Math.max(0.5,0.7*z);
      g.beginPath(); g.moveTo(sx-hw, sy-bh); g.lineTo(sx, sy-bh-hh*1.6); g.lineTo(sx+hw, sy-bh); g.closePath(); g.fill(); g.stroke();
      g.fillStyle='#E8C070';
      g.fillRect(sx-2*z, sy-bh-hh*0.9, 4*z, hh*0.8);   // hayloft hatch
    }
    // well — stone ring + little roof on posts + dark water
    if (type==="well") {
      g.fillStyle='#0A1420';
      g.beginPath(); g.ellipse(sx, sy-bh, hw*0.7, hh*0.7, 0, 0, Math.PI*2); g.fill();
      g.strokeStyle='#B0C0D0'; g.lineWidth=Math.max(0.8,1.2*z); g.stroke();
      g.strokeStyle='#8A5A32'; g.lineWidth=Math.max(1,1.4*z);
      g.beginPath(); g.moveTo(sx-hw*0.7, sy-bh); g.lineTo(sx-hw*0.5, sy-bh-14*z); g.stroke();
      g.beginPath(); g.moveTo(sx+hw*0.7, sy-bh); g.lineTo(sx+hw*0.5, sy-bh-14*z); g.stroke();
      g.fillStyle='#7A2418';
      g.beginPath(); g.moveTo(sx-hw*0.8, sy-bh-13*z); g.lineTo(sx, sy-bh-20*z); g.lineTo(sx+hw*0.8, sy-bh-13*z); g.closePath(); g.fill();
    }

    // level pips (levelled buildings: one ◆ per level over the roof)
    if (level && def.maxLvl && z>0.5) {
      g.fillStyle='#00FFEE';
      for (let i=0;i<level;i++){ g.beginPath(); g.arc(sx-(level-1)*3*z + i*6*z, sy-hh-bh-3*z, 1.6*z, 0, Math.PI*2); g.fill(); }
    }

    if (z > 0.55) {
      g.fillStyle=C.ink; g.font=`bold ${Math.max(7, (isCity?10:9)*z)|0}px sans-serif`; g.textAlign="center";
      g.fillText(_nm, sx, sy-hh-bh-9*z);
    }
  }

  function strHash(s){ let h=0; for (let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))|0; return Math.abs(h); }

  function drawNPCCar(g, sx, sy, z, color, heading) {
    if (HEADLESS) return;
    if (USE_EMOJI) {
      const cHh = ISO_HH*z*0.42;
      // keep the neon underglow so cars still pop on the dark street
      g.save(); g.globalAlpha=0.30; g.fillStyle=color;
      g.beginPath(); g.ellipse(sx, sy+cHh*0.7, 16*z, 5*z, 0, 0, Math.PI*2); g.fill(); g.restore();
      drawEmoji(g, CAR_EMOJI[strHash(color)%CAR_EMOJI.length], sx, sy+cHh, 22*z);
      return;
    }
    const cHw = ISO_HW*z*0.42, cHh = ISO_HH*z*0.42, cBh = 5*z;
    // Neon underglow — two stacked translucent ellipses fake the bloom without a
    // shadowBlur (shadowBlur is the dominant mobile-GPU cost; ~8 cars × several
    // blurred fills each would saturate the raster on a high-DPR phone).
    g.save();
    g.globalAlpha=0.22; g.fillStyle=color;
    g.beginPath(); g.ellipse(sx, sy+cHh*0.6, cHw*1.6, cHh*0.75, 0, 0, Math.PI*2); g.fill();
    g.globalAlpha=0.45;
    g.beginPath(); g.ellipse(sx, sy+cHh*0.6, cHw*1.1, cHh*0.5, 0, 0, Math.PI*2); g.fill();
    g.restore();
    // Derive darker face colors from the base color
    const r=parseInt(color.slice(1,3),16), gv=parseInt(color.slice(3,5),16), bv=parseInt(color.slice(5,7),16);
    const colL=`rgb(${(r*0.45)|0},${(gv*0.45)|0},${(bv*0.45)|0})`;
    const colR=`rgb(${(r*0.30)|0},${(gv*0.30)|0},${(bv*0.30)|0})`;
    // Car body (crisp — the bright top face already reads as neon)
    isoBox(g, sx, sy, cHw, cHh, cBh, color, colL, colR, C.ink);
    // Dark windshield
    g.save(); g.globalAlpha=0.75; g.fillStyle='#04141E';
    g.fillRect(sx-cHw*0.50, sy-cBh-cHh*0.30, cHw*1.0, Math.max(1.5, 1.8*z));
    g.restore();
    // Bright neon headlights (crisp white dots)
    g.save(); g.globalAlpha=0.90; g.fillStyle='#FFFFFF';
    g.beginPath(); g.arc(sx-cHw*0.42, sy+cHh*1.18, 1.4*z, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(sx+cHw*0.42, sy+cHh*0.68, 1.4*z, 0, Math.PI*2); g.fill();
    g.restore();
  }

  // ── NPC pedestrian — emoji person that bobs as it walks ─────────────────────
  function drawNPCPed(g, sx, sy, z, color, legPhase, opts) {
    if (HEADLESS) return;
    const wt = _weather.type;
    const fog = (wt === 'FOG');
    const rain = (wt === 'RAIN' || wt === 'STORM');
    const snow = (wt === 'SNOW' || wt === 'BLIZZARD');

    if (USE_EMOJI) {
      g.save();
      if (fog) g.globalAlpha = 0.6;
      const bob = Math.abs(Math.sin(_frame*4.5 + legPhase))*1.6*z;   // walk bounce
      drawEmoji(g, PED_EMOJI[strHash(color)%PED_EMOJI.length], sx, sy-bob, 16*z);
      if (rain) drawEmoji(g, '☂️', sx, sy-14*z-bob, 12*z);           // umbrella in the rain
      g.restore();
      return;
    }

    g.save();
    if (fog) g.globalAlpha = 0.6;

    // Snow footprint trail
    if (snow && opts && opts.trail) {
      g.globalAlpha = 0.35;
      g.fillStyle = '#DDEEFF';
      for (let t = 0; t < 3; t++) {
        const tf = (t + 1) * 0.4;
        g.beginPath(); g.arc(sx - tf * 2*z, sy + tf * 1.5*z, 1*z, 0, Math.PI*2); g.fill();
      }
      g.globalAlpha = fog ? 0.6 : 1;
    }

    const ph = 7*z, pw = 1.8*z;
    // No shadowBlur — at pedestrian scale the glow is invisible anyway, but 12
    // peds × several blurred fills each is real cost on a mobile GPU.
    g.fillStyle = color;
    // Head
    g.beginPath(); g.arc(sx, sy - ph, pw*0.75, 0, Math.PI*2); g.fill();
    // Body
    g.fillRect(sx - pw*0.4, sy - ph + pw*0.7, pw*0.8, ph*0.48);
    // Walking legs
    const lk = (_frame * 4.5 + legPhase) % (Math.PI * 2);
    const ls = Math.sin(lk) * 2.2*z;
    g.fillRect(sx - pw*0.55, sy - ph*0.44 + ls,   pw*0.38, ph*0.44);
    g.fillRect(sx + pw*0.17, sy - ph*0.44 - ls,   pw*0.38, ph*0.44);

    // Umbrella arc in rain/storm
    if (rain) {
      g.shadowBlur = 0;
      g.strokeStyle = color; g.lineWidth = Math.max(0.8, 1.2*z);
      g.globalAlpha = 0.80;
      g.beginPath();
      g.arc(sx, sy - ph - pw*0.75 - 2*z, pw*2.0, Math.PI, 0);
      g.stroke();
      // handle
      g.beginPath(); g.moveTo(sx + pw*2.0, sy - ph - pw*0.75 - 2*z);
      g.lineTo(sx + pw*2.0, sy - ph + pw*0.5); g.stroke();
    }

    g.restore();
  }

  // ── Season / weather helpers ───────────────────────────────────────────────
  // Roll the next weather type from the current season's weighted table.
  function rollWeather() {
    const weights = WEATHER_WEIGHTS[_season.idx];
    let r = Math.random(), cumul = 0, chosen = 'CLEAR';
    for (let i = 0; i < weights.length; i++) {
      cumul += weights[i];
      if (r < cumul) { chosen = WEATHER_TYPES[i]; break; }
    }
    return chosen;
  }

  // Advance one sleep/turn. Called when the player rests (Inn / Shelter). Rolls
  // fresh weather; every SLEEPS_PER_SEASON sleeps rolls the season over and swaps
  // the festival. This is the ONLY thing that moves seasons/weather forward now.
  function advanceSleep(prog, s) {
    _season.tick += 1;
    let seasonChanged = false;
    if (_season.tick >= SLEEPS_PER_SEASON) {
      _season.tick = 0;
      _season.idx = (_season.idx + 1) % 4;
      seasonChanged = true;
    }
    // ── crops grow one turn (two stages if watered); watering is consumed ──
    if (prog && prog.crops) {
      for (const k of Object.keys(prog.crops)) {
        const c = prog.crops[k];
        const def = SEED_BY[c.type]; if (!def) continue;
        c.stage = Math.min(def.grow, c.stage + (c.watered ? 2 : 1));
        c.watered = false;
        c.dayBoost = false;
      }
    }
    // Barn micro-income while sleeping
    if (prog && s && (prog.buildings || []).some(b => b.type === 'barn')) {
      ensureShipState(s);
      const bonus = 8 + ((Math.random() * 7) | 0);
      s.credits += bonus;
      if (typeof toast === 'function') toast('🚜 Barn livestock +' + bonus + '₡ overnight', '#a0ffa0', 2);
    }
    // City Hall: refill empty offer board if quest slots free
    if (s && s.questState && s.currentPlanetName) {
      const pKey = s.currentPlanetName;
      const qs = s.questState;
      const free = QUEST_MAX_ACTIVE - (qs.active || []).length;
      if (free > 0 && (!(qs.offers[pKey]) || !qs.offers[pKey].length)) {
        delete qs.offers[pKey];
        genQuestOffers(s, pKey);
        if (typeof toast === 'function') toast('🏛 City Hall posted new jobs overnight', '#E8D06A', 2.2);
      }
    }
    _festival.active = true;
    _festival.name   = FESTIVAL_NAMES[_season.idx];
    _weather.type = rollWeather();
    if (seasonChanged) {
      _weather.notifText  = `// ${SEASON_NAMES[_season.idx]} · ${_festival.name} //`;
      _weather.notifAlpha = 2.5;
    } else {
      _weather.notifText  = `// SLEEP ${_season.tick}/${SLEEPS_PER_SEASON} · ${_weather.type} //`;
      _weather.notifAlpha = 1.8;
    }
    return { season: SEASON_NAMES[_season.idx], sleep: _season.tick, weather: _weather.type, seasonChanged };
  }

  function getCurrentSeason() {
    return { name: SEASON_NAMES[_season.idx], idx: _season.idx, progress: _season.tick / SLEEPS_PER_SEASON };
  }

  // World-space particle pool
  function spawnParticle(wx, wy, vx, vy, life, col, size) {
    _particles.push({ wx, wy, vx, vy, life, maxLife: life, col, size });
  }

  function tickParticles(dt) {
    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.wx += p.vx * dt * 60; p.wy += p.vy * dt * 60; p.life -= dt * 60;
      if (p.life <= 0) _particles.splice(i, 1);
    }
  }

  function drawParticles(g, W, H) {
    if (HEADLESS || _particles.length === 0) return;
    // NO shadowBlur here — ~120 blurred fills/frame intermittently hit the
    // browser's pathological shadow rasterizer (stack-traced 0.8-3.8s single
    // fills — the residual "game is choppy" hitch). Glow is faked with a
    // second faint larger disc, the same trick as car underglow.
    g.save();
    for (const p of _particles) {
      const { x, y } = tileScreen(p.wx, p.wy, W, H);
      if (x < -20 || x > W+20 || y < -20 || y > H+20) continue;   // off-screen
      const a = Math.max(0, p.life / p.maxLife);
      const r = p.size * _cam.z;
      g.fillStyle = p.col;
      g.globalAlpha = a * 0.30;
      g.beginPath(); g.arc(x, y, r * 1.9, 0, Math.PI * 2); g.fill();
      g.globalAlpha = a * 0.85;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  // Weather and festival tick — call inside tick(). Seasons & weather no longer
  // advance here (that's sleep-driven via advanceSleep()); this only fades the
  // notification banner and emits the current festival's ambient particles.
  function tickSeasonWeather(dt, world) {
    // Keep the festival pinned to the current season (it's always live on-planet)
    _festival.active = true;
    _festival.name   = FESTIVAL_NAMES[_season.idx];

    if (_weather.notifAlpha > 0) _weather.notifAlpha -= dt * 60 * 0.02;

    // ── Festival particles ────────────────────────────────────────────────────
    if (_festival.active && world && _particles.length < 120) {
      const CX = world.CX, CY = world.CY, CW = 22, CH = 22;
      const rndCity = () => ({
        wx: CX + Math.random() * CW,
        wy: CY + Math.random() * CH,
      });
      const si = _season.idx;
      if (si === 0) {                        // Spring: pink blossom shower
        for (let i = 0; i < 2; i++) {
          const p = rndCity();
          spawnParticle(p.wx, p.wy, (Math.random()-0.5)*0.003, -0.012 - Math.random()*0.008, 120, '#FFB3D9', 1.4);
        }
      } else if (si === 2) {                 // Autumn: orange upward lanterns
        for (let i = 0; i < 2; i++) {
          const p = rndCity();
          spawnParticle(p.wx, p.wy, (Math.random()-0.5)*0.004, -0.015 - Math.random()*0.005, 100, '#FF9933', 1.6);
        }
      } else if (si === 3) {                 // Winter: blue-white sparkles
        for (let i = 0; i < 3; i++) {
          const p = rndCity();
          spawnParticle(p.wx, p.wy, (Math.random()-0.5)*0.010, (Math.random()-0.5)*0.010, 40, '#AAEEFF', 1.0);
        }
      }
      // Summer carnival effect is purely visual (window pulse) — no particles needed
    }
  }

  // Snow/blizzard screen-space particles (like _rain but white)
  function drawSnow(g, W, H) {
    if (HEADLESS) return;
    if (!_snow) {
      _snow = [];
      for (let i = 0; i < 200; i++) {
        _snow.push([
          Math.random(),                   // x 0-1
          Math.random(),                   // y 0-1
          0.003 + Math.random()*0.006,     // fall speed
          (Math.random()-0.5)*0.004,       // horizontal drift
          1.5 + Math.random()*2.5,         // radius px
          0.15 + Math.random()*0.35,       // opacity
        ]);
      }
    }
    const blizzard = _weather.type === 'BLIZZARD';
    const windX = blizzard ? 0.35 : 0.08;
    g.save();
    g.fillStyle = '#E8F4FF';
    for (const sp of _snow) {
      sp[1] += sp[2] * (blizzard ? 1.8 : 1.0);
      sp[0] += windX * sp[2] + sp[3];
      if (sp[1] > 1.08) { sp[1] = -0.04; sp[0] = Math.random(); }
      if (sp[0] > 1.05) sp[0] -= 1.05;
      g.globalAlpha = sp[5] * (blizzard ? 1.6 : 1.0);
      g.beginPath(); g.arc(sp[0]*W, sp[1]*H, sp[4] * _cam.z, 0, Math.PI*2); g.fill();
    }
    // (blizzard "wind streak" lines removed — they read as horizontal static
    //  streaks across the screen; the falling snow alone looks cleaner.)
    g.globalAlpha = 1;
    g.restore();
  }

  // pDir: 0=S (camera), 1=W, 2=E, 3=N  — matches movement assignment
  function drawPlayer(g, sx, sy, z, pDir, moving) {
    const dirKey = ({ 0: 's', 1: 'w', 2: 'e', 3: 'n' })[pDir|0] || 's';
    // Walk cycle when moving; idle frame 0 when still
    const frame = moving ? ((_frame * 8) | 0) % 4 : 0;
    const key = 'player_explorer_' + dirKey + '_' + frame;
    const im = (typeof ART !== 'undefined' && ART.get) ? ART.get(key) : null;

    // Locator ring + shadow (always)
    const ringPulse = (_frame * 0.9) % 1;
    g.save();
    g.globalAlpha = 0.40 * (1 - ringPulse);
    g.strokeStyle = '#FFFFFF'; g.lineWidth = Math.max(1, 2 * z);
    g.beginPath();
    g.ellipse(sx, sy + 2 * z, (10 + ringPulse * 10) * z, (5 + ringPulse * 5) * z, 0, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.55; g.strokeStyle = '#FFF4CC';
    g.beginPath(); g.ellipse(sx, sy + 2 * z, 10 * z, 5 * z, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    g.save(); g.globalAlpha = 0.22; g.fillStyle = '#2a2a1a';
    g.beginPath(); g.ellipse(sx + 1 * z, sy + 2 * z, 10 * z, 4.5 * z, 0, 0, Math.PI * 2); g.fill(); g.restore();

    if (im && im.naturalWidth) {
      // Bottom-center anchor on tile; height scales with zoom
      const h = 34 * z, w = h * (im.naturalWidth / im.naturalHeight);
      const bob = moving ? Math.sin(_frame * 10) * 0.8 * z : Math.sin(_frame * 2.2) * 0.6 * z;
      g.drawImage(im, sx - w / 2, sy - h + bob + 2 * z, w, h);
    } else {
      // Procedural fallback (headless / art still loading)
      const bob = Math.sin(_frame * 2.6) * 1.6 * z;
      const sby = sy + bob;
      const bH = 16 * z, bHW = 6.5 * z, hR = 7 * z;
      isoBox(g, sx, sby, bHW, bHW * 0.5, bH, C.playerTop, C.playerL, C.playerR, C.ink);
      g.fillStyle = '#EDE7D8';
      g.beginPath(); g.arc(sx, sby - bH - hR * 0.52, hR, 0, Math.PI * 2); g.fill();
    }

    // Gold chevron marker above head
    const markBob = Math.sin(_frame * 3.0) * 2 * z;
    const markY = sy - 36 * z + markBob;
    const cw = 5 * z, chH = 5 * z;
    g.save();
    g.globalAlpha = 0.92;
    g.fillStyle = '#FFC83D';
    g.strokeStyle = 'rgba(120,80,0,0.5)'; g.lineWidth = Math.max(0.5, 0.7 * z);
    g.beginPath();
    g.moveTo(sx - cw, markY); g.lineTo(sx + cw, markY); g.lineTo(sx, markY + chH); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  // Painted landing bullseye on the apron floor (ground decal, drawn in pass 1).
  function drawPadRing(g, sx, sy, z) {
    const hw=ISO_HW*z, hh=ISO_HH*z;
    g.save();
    // scorched touchdown disc
    g.globalAlpha=0.34; g.fillStyle='#2C2A26';
    g.beginPath(); g.ellipse(sx, sy, hw*0.84, hh*0.84, 0, 0, Math.PI*2); g.fill();
    // bright hazard-yellow ring
    g.globalAlpha=0.82; g.strokeStyle='#E6C22A'; g.lineWidth=Math.max(1.2,2*z);
    g.beginPath(); g.ellipse(sx, sy, hw*0.72, hh*0.72, 0, 0, Math.PI*2); g.stroke();
    // inner target ring
    g.globalAlpha=0.5; g.strokeStyle='#D8D2C4'; g.lineWidth=Math.max(0.6,1*z);
    g.beginPath(); g.ellipse(sx, sy, hw*0.44, hh*0.44, 0, 0, Math.PI*2); g.stroke();
    // four radial guide ticks (N/S/E/W in screen space)
    g.globalAlpha=0.6; g.strokeStyle='#E6C22A'; g.lineWidth=Math.max(0.7,1.2*z);
    for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      g.beginPath();
      g.moveTo(sx+dx*hw*0.50, sy+dy*hh*0.50);
      g.lineTo(sx+dx*hw*0.66, sy+dy*hh*0.66);
      g.stroke();
    }
    g.restore();
  }

  // Active player hull on the apron — ALWAYS draws a solid iso lander (never depends
  // on beauty/hero PNGs). Space beauty shots are side-view hero art and look wrong
  // (or vanish) on the 2.5:1 pad; procedural clay matches the surface language.
  function drawPlayerShip(g, sx, sy, z, s) {
    const hullKey = (s && s.ships && s.activeShipId != null)
      ? ((s.ships.find(sh => sh.id === s.activeShipId) || {}).hullKey || 'vulture')
      : 'vulture';
    // Slightly larger than a tile so the lander reads at default zoom
    const hw = ISO_HW * z * 1.15, hh = ISO_HH * z * 1.15;
    const topC = C.shipTop || '#C8D0DC', sideC = C.shipSide || '#7A8494', dkC = C.shipDk || '#3A4050';
    const baseY = sy;

    // Grounded shadow (wide so pad ring stays readable under feet)
    g.save(); g.globalAlpha = 0.32; g.fillStyle = '#101018';
    g.beginPath(); g.ellipse(sx, sy + 4 * z, hw * 1.15, hh * 1.15, 0, 0, Math.PI * 2); g.fill();
    g.restore();

    // Landing gear
    g.strokeStyle = dkC; g.lineWidth = Math.max(1.2, 1.8 * z);
    for (const dx of [-0.62, 0.62, 0]) {
      const footX = sx + dx * hw * 0.82, footY = baseY + (dx === 0 ? hh * 0.58 : hh * 0.20);
      g.beginPath(); g.moveTo(sx + dx * hw * 0.28, baseY - 10 * z); g.lineTo(footX, footY); g.stroke();
      g.fillStyle = dkC; g.beginPath(); g.ellipse(footX, footY, 2.6 * z, 1.5 * z, 0, 0, Math.PI * 2); g.fill();
    }
    // Wings
    for (const s2 of [-1, 1]) {
      g.fillStyle = sideC; g.strokeStyle = C.ink || '#1a1a22'; g.lineWidth = 0.6 * z;
      g.beginPath();
      g.moveTo(sx + s2 * hw * 0.36, baseY - 18 * z);
      g.lineTo(sx + s2 * hw * 0.78, baseY - 0 * z);
      g.lineTo(sx + s2 * hw * 0.28, baseY - 2 * z);
      g.closePath(); g.fill(); g.stroke();
    }
    // Hull body + cabin
    isoBox(g, sx, baseY, hw * 0.62, hh * 0.62, 22 * z, topC, sideC, dkC, C.ink || '#1a1a22');
    isoBox(g, sx, baseY - 22 * z, hw * 0.42, hh * 0.42, 14 * z, topC, sideC, dkC, C.ink || '#1a1a22');
    // Faction stripe
    g.save(); g.globalAlpha = 0.95; g.fillStyle = '#E8552E';
    g.fillRect(sx - hw * 0.44, baseY - 16 * z, hw * 0.88, Math.max(1.8, 2.8 * z)); g.restore();
    // Nose cone
    g.fillStyle = topC; g.strokeStyle = C.ink || '#1a1a22'; g.lineWidth = 0.7 * z;
    g.beginPath();
    g.moveTo(sx, baseY - 36 * z - 10 * z);
    g.lineTo(sx + hw * 0.42, baseY - 36 * z + hh * 0.24);
    g.lineTo(sx - hw * 0.42, baseY - 36 * z + hh * 0.24);
    g.closePath(); g.fill(); g.stroke();
    // Cockpit canopy
    g.fillStyle = '#8EC4E8';
    g.beginPath(); g.arc(sx, baseY - 32 * z, 6.5 * z, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C.ink || '#1a1a22'; g.lineWidth = 0.8 * z; g.stroke();

    // Hull name plate so player can confirm which ship landed
    const label = (typeof CONFIG !== 'undefined' && CONFIG.hulls && CONFIG.hulls[hullKey])
      ? CONFIG.hulls[hullKey].name : hullKey;
    g.save();
    g.font = `bold ${Math.max(9, 10 * z) | 0}px monospace`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(8,12,20,0.82)';
    const tw = g.measureText(label).width + 10 * z;
    g.fillRect(sx - tw / 2, sy + 12 * z, tw, 13 * z);
    g.fillStyle = '#9fd8ff';
    g.fillText(label, sx, sy + 13 * z);
    g.restore();

    // Warm idle thruster glow
    g.save();
    g.globalAlpha = 0.28 + 0.14 * Math.sin(_frame * 1.6);
    g.fillStyle = '#FF9A3C';
    g.beginPath(); g.ellipse(sx, sy + 6 * z, ISO_HW * z * 0.36, ISO_HH * z * 0.30, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  function drawShip(g, sx, sy, z, opts) { drawPlayerShip(g, sx, sy, z, null); }

  function drawCar(g, sx, sy, heading, z, occupied) {
    const hw = ISO_HW*z*0.85, hh = ISO_HH*z*0.85;
    const bh = 8*z;
    isoBox(g, sx, sy, hw, hh, bh, '#D04820', '#903218', '#A03A1E', C.ink);
    // Heading arrow on top face — project heading direction into iso screen space
    const hcos = Math.cos(heading), hsin = Math.sin(heading);
    const adx = (hcos - hsin) * hw * 0.50;
    const ady = (hcos + hsin) * hh * 0.50;
    const norm = Math.hypot(adx, ady) || 1;
    // Perpendicular for arrow base width
    const px2 = -ady/norm * 4.5*z, py2 = adx/norm * 4.5*z;
    const topY = sy - bh;
    g.save();
    g.globalAlpha = 0.88;
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(sx + adx, topY + ady);
    g.lineTo(sx - adx*0.35 + px2, topY - ady*0.35 + py2);
    g.lineTo(sx - adx*0.35 - px2, topY - ady*0.35 - py2);
    g.closePath();
    g.fill();
    g.restore();
    // Small player icon on top when someone is driving
    if (occupied) {
      g.fillStyle = C.playerHd;
      g.beginPath();
      g.arc(sx, topY - 4*z, 3.5*z, 0, Math.PI*2);
      g.fill();
      g.strokeStyle = C.ink;
      g.lineWidth = Math.max(0.4, 0.55*z);
      g.stroke();
    }
  }

  // ── far-zoom ground bake (clay planets) ─────────────────────────────────────
  // Below the live-slab zoom threshold we used to drop to flat "map mode" —
  // 4800 per-tile slab blits measured ~79ms. Instead: bake the ENTIRE static
  // ground (grout, slabs, biome tints, cliffs, AND deco props) into one
  // offscreen canvas at FAR_Z0, built progressively (~500 tiles/frame, no
  // hitch), then far zoom is a single scaled drawImage. Dynamic bits (farmed
  // tiles, landing-pad rings) draw on top per frame. Keyed on world.seed —
  // regenerates per landing; farming never mutates it (soil overlays are live).
  const FAR_Z0 = 0.5;
  const FAR_BANDS_PER_TICK = 10;
  let _farBake = null;   // { seed, canvas, ctx, z0, minWx, minWy, depth, deco, done }

  function _tickFarBake(world) {
    const set = (world.def && world.def.propset) || 'mira';
    if (!ART.get('slab_' + set + '_grass_a')) return null;     // art not loaded yet
    if (_farBake && _farBake.seed === world.seed) {
      if (_farBake.done) return _farBake;
    } else {
      // world-space bounds of the whole map, with margin for elevation lifts,
      // slab thickness and cliff drops
      const minWx = -MAP_H * ISO_HW, maxWx = MAP_W * ISO_HW;
      const minWy = -ISO_HH - MAX_ELEV*CLIFF_PX - 8;
      const maxWy = (MAP_W + MAP_H - 2) * ISO_HH + ISO_HH + MAX_ELEV*CLIFF_PX + ISO_HW*0.6;
      const bw = Math.ceil((maxWx - minWx) * FAR_Z0), bh = Math.ceil((maxWy - minWy) * FAR_Z0);
      const canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(bw, bh)
        : (() => { const c = document.createElement('canvas'); c.width = bw; c.height = bh; return c; })();
      _farBake = { seed: world.seed, canvas, ctx: canvas.getContext('2d'),
                   z0: FAR_Z0, minWx, minWy, depth: 0, deco: 0, done: false };
    }
    const fb = _farBake;
    const { tiles, elevA, tileColors, biomeA, def } = world;
    const b = fb.ctx;
    const z0 = fb.z0, hw0 = ISO_HW*z0, hh0 = ISO_HH*z0;
    const camZSave = _cam.z; _cam.z = z0;      // flatTile sizes off _cam.z
    const BX = (tx,ty) => ((tx-ty)*ISO_HW - fb.minWx) * z0;
    const BY = (tx,ty,e) => ((tx+ty)*ISO_HH - fb.minWy - e*CLIFF_PX) * z0;

    // phase 1 — ground, in painter (depth) order
    const maxDepth = MAP_W + MAP_H - 2;
    for (let band = 0; band < FAR_BANDS_PER_TICK && fb.depth <= maxDepth; band++, fb.depth++) {
      const d0 = fb.depth;
      for (let tx = Math.max(0, d0-(MAP_H-1)); tx <= Math.min(MAP_W-1, d0); tx++) {
        const ty = d0 - tx;
        const e = elevA[ty*MAP_W+tx] || 0;
        const bx = BX(tx,ty), by = BY(tx,ty,e);
        const ttype = tiles[ty*MAP_W+tx];
        const col = tileColors[ty*MAP_W+tx] || (ttype===T_ROAD ? '#B9AE97' : '#6EA843');
        let slabKey;
        if (ttype === T_WATER) slabKey = 'water';
        else if (ttype === T_ROAD) slabKey = 'stone_path';
        else {
          const bio0 = biomeA[ty*MAP_W+tx];
          if (bio0 === B_DESERT || bio0 === B_MOUNTAIN) slabKey = 'dirt';
          else {
            const hv = hash2(tx, ty);
            slabKey = hv > 0.93 ? 'grass_flowers' : hv > 0.76 ? 'grass_b' : 'grass_a';
          }
        }
        flatTile(b, bx, by, darker(col, 0.74), null);
        const bio1 = biomeA[ty*MAP_W+tx];
        const st = def.slabTint || null;
        let tint =
          (bio1 === B_JUNGLE && slabKey.startsWith('grass')) ? (def.biomeHI ? def.biomeHI[B_JUNGLE] : null)
        : (bio1 === B_MOUNTAIN && slabKey === 'dirt')        ? (def.biomeHI ? def.biomeHI[B_MOUNTAIN] : null)
        : null;
        let fbk = 'slab_' + set + '_' + slabKey;
        if (!ART.slabReady(fbk)) fbk = 'slab_mira_' + slabKey;
        const usingMiraFallback = fbk.indexOf('slab_mira_') === 0 && set !== 'mira';
        if (st && usingMiraFallback) {
          if (slabKey.startsWith('grass') && st.grass) tint = st.grass;
          else if ((slabKey === 'dirt' || slabKey === 'dirt_b') && st.dirt) tint = st.dirt;
          else if (slabKey === 'water' && st.water) tint = st.water;
          else if (slabKey === 'stone_path' && st.path) tint = st.path;
          else if (slabKey.startsWith('soil') && st.dirt) tint = st.dirt;
        }
        ART.drawSlab(b, fbk, bx, by, hw0, hh0, tint);
        if (ttype === T_ROAD && col !== def.road) {
          b.save(); b.globalAlpha = 0.42; flatTile(b, bx, by, col, null); b.restore();
        }
        // cliff faces (south + east), same shading as the live path
        if (ty+1 < MAP_H && tiles[ty*MAP_W+tx]===T_GRASS && e > (elevA[(ty+1)*MAP_W+tx]||0)) {
          const ch = (e-(elevA[(ty+1)*MAP_W+tx]||0))*CLIFF_PX*z0;
          b.beginPath(); b.moveTo(bx-hw0,by); b.lineTo(bx,by+hh0); b.lineTo(bx,by+hh0+ch); b.lineTo(bx-hw0,by+ch); b.closePath();
          b.fillStyle=darker(col,0.72); b.fill();
          b.beginPath(); b.moveTo(bx+hw0,by); b.lineTo(bx,by+hh0); b.lineTo(bx,by+hh0+ch); b.lineTo(bx+hw0,by+ch); b.closePath();
          b.fillStyle=darker(col,0.60); b.fill();
        }
        if (tx+1 < MAP_W && tiles[ty*MAP_W+tx]===T_GRASS && e > (elevA[ty*MAP_W+tx+1]||0)) {
          const ch = (e-(elevA[ty*MAP_W+tx+1]||0))*CLIFF_PX*z0;
          b.beginPath(); b.moveTo(bx+hw0,by); b.lineTo(bx,by+hh0); b.lineTo(bx,by+hh0+ch); b.lineTo(bx+hw0,by+ch); b.closePath();
          b.fillStyle=darker(col,0.58); b.fill();
        }
      }
    }

    // phase 2 — deco props on top of the finished ground
    if (fb.depth > maxDepth) {
      const deco = world.deco || [];
      const perTick = 220;
      for (let n = 0; n < perTick && fb.deco < deco.length; n++, fb.deco++) {
        const d = deco[fb.deco];
        const e = elevA[d.y*MAP_W+d.x] || 0;
        const pw = (DECO_W[d.key] || 16) * d.s * z0;
        ART.drawProp(b, 'prop_' + set + '_' + d.key,
          BX(d.x,d.y) + d.ox*ISO_HW*z0, BY(d.x,d.y,e) + 2*z0 + d.oy*ISO_HH*z0, pw);
      }
      if (fb.deco >= deco.length) fb.done = true;
    }
    _cam.z = camZSave;
    return fb;
  }

  // Multi-tile landmark / vista: spans `L.w`×`L.h` tiles, bottom-anchored at
  // the center cell. Prefer feat_* (oriented) then landmark PNGs; else clay mass.
  // `soft` = vista overlay (slightly transparent, no hard contact shadow).
  function drawMultiTileLandmark(g, L, W, H, elevA, soft) {
    if (!L) return;
    const z = _cam.z;
    const I = (x, y) => y * MAP_W + x;
    const { x: lsx, y: lsy0 } = tileScreen(L.x + 0.5, L.y + 0.5, W, H);
    const le = (elevA[I(Math.max(0, Math.min(MAP_W - 1, L.x | 0)), Math.max(0, Math.min(MAP_H - 1, L.y | 0)))] || 0) * CLIFF_PX * z;
    const lsy = lsy0 - le;
    const tiles = Math.max(L.w || 4, L.h || 4);
    const sm = L.sizeMul || 1;
    const lh = tiles * ISO_HW * z * 0.72 * sm;
    const pack = _pdef.propset || 'mira';
    // Prefer oriented feature art (peak / cliff_*) when present
    let lim = null;
    if (typeof ART !== 'undefined' && ART.get) {
      if (L.feat) lim = ART.get('feat_' + pack + '_' + L.feat);
      if (!lim && L.key === 'mountain') lim = ART.get('feat_' + pack + '_peak');
      if (!lim && L.key === 'volcano') lim = ART.get('feat_' + pack + '_peak') || ART.get('landmark_' + pack + '_volcano');
      if (!lim) lim = ART.get('landmark_' + pack + '_' + (L.key || 'mesa'));
    }

    g.save();
    if (soft) g.globalAlpha = 0.82;

    if (lim && lim.naturalWidth) {
      const lw = lh * (lim.naturalWidth / Math.max(1, lim.naturalHeight));
      if (!soft) {
        g.save(); g.globalAlpha = 0.20; g.fillStyle = '#101018';
        g.beginPath();
        g.ellipse(lsx, lsy + 4 * z, lw * 0.42, ISO_HH * z * tiles * 0.22, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(lim, lsx - lw / 2, lsy - lh + 6 * z, lw, lh);
    } else if (CWE) {
      CWE.drawLandmarkMass({
        g, sx: lsx, sy: lsy, z, ISO_HW, ISO_HH, L,
        ink: C.ink, isoBox,
      });
    } else {
      const hwL = ISO_HW * z * tiles * 0.35 * sm;
      const hhL = ISO_HH * z * tiles * 0.35 * sm;
      const bhL = tiles * 6 * z * sm;
      isoBox(g, lsx, lsy, hwL, hhL, bhL, '#B8B0A4', '#8A8478', '#5C564C', C.ink);
    }
    g.restore();
  }

  // Large multi-tile ground/cliff PLATES (lunar crater bowls, regolith fields)
  function drawWorldPlate(g, P, W, H, elevA) {
    if (!P || HEADLESS) return;
    const z = _cam.z;
    const I = (x, y) => y * MAP_W + x;
    const { x: sx, y: sy0 } = tileScreen(P.x + 0.5, P.y + 0.5, W, H);
    const e = (elevA[I(Math.max(0, Math.min(MAP_W - 1, P.x | 0)), Math.max(0, Math.min(MAP_H - 1, P.y | 0)))] || 0) * CLIFF_PX * z;
    const sy = sy0 - e;
    const im = (typeof ART !== 'undefined' && ART.get) ? ART.get(P.key) : null;
    const sm = P.sizeMul || 1;
    const tiles = P.w || 4;
    const hPx = tiles * ISO_HW * z * 0.55 * sm;
    if (im && im.naturalWidth) {
      const wPx = hPx * (im.naturalWidth / Math.max(1, im.naturalHeight));
      g.save();
      g.globalAlpha = P.kind === 'regolith' ? 0.88 : 0.95;
      g.imageSmoothingEnabled = true;
      g.drawImage(im, sx - wPx / 2, sy - hPx * 0.72, wPx, hPx);
      g.restore();
    }
  }

  // Oriented world feature (cliff_s/e/n/w, peak, boulder, plants…)
  function drawWorldFeature(g, F, W, H, elevA) {
    if (!F) return;
    const z = _cam.z;
    const I = (x, y) => y * MAP_W + x;
    const { x: sx, y: sy0 } = tileScreen(F.x + 0.5, F.y + 0.5, W, H);
    const e = (elevA[I(Math.max(0, Math.min(MAP_W - 1, F.x | 0)), Math.max(0, Math.min(MAP_H - 1, F.y | 0)))] || 0) * CLIFF_PX * z;
    const sy = sy0 - e;
    const pack = _pdef.propset || 'mira';
    const key = 'feat_' + pack + '_' + F.key;
    const im = (typeof ART !== 'undefined' && ART.get) ? ART.get(key) : null;
    const sm = F.sizeMul || 1;
    // Size: cliffs/peaks large; plants mid so player still reads
    const isBig = F.key.startsWith('cliff') || F.key === 'peak' || F.key === 'outcrop';
    const hPx = (isBig ? 52 : 36) * z * sm;
    if (im && im.naturalWidth) {
      const wPx = hPx * (im.naturalWidth / Math.max(1, im.naturalHeight));
      // contact shadow (hard-body stand-in visual)
      if (F.collide) {
        g.save(); g.globalAlpha = 0.18; g.fillStyle = '#101018';
        g.beginPath();
        g.ellipse(sx, sy + 3 * z, wPx * 0.38, ISO_HH * z * 0.55, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(im, sx - wPx / 2, sy - hPx + 4 * z, wPx, hPx);
    } else {
      // fallback: emoji / box
      drawEmoji(g, F.key.startsWith('plant') ? '🌿' : '🪨', sx, sy, hPx * 0.7);
    }
  }

  // ── main world draw ─────────────────────────────────────────────────────────
  // `s` = live game state (ships / active hull) — required for the pad lander.
  function drawScene(g, W, H, prog, world, s) {
    const { tiles, biomeA, elevA, tileColors, nodes, cityBuildings, npcCars, npcPeds, HX, HY, CX, CY } = world;
    const I = (x,y) => y*MAP_W+x;
    _pdef = world.def || PLANET_DEFS.mira;   // planet skin for flora/rock/glint lookups

    // camera clamp
    const pW = isoWorld(prog.px, prog.py);
    _cam.x += (pW.x - _cam.x) * 0.12;
    _cam.y += (pW.y - _cam.y) * 0.12;

    // viewport tile range
    const margin = Math.ceil(20 / _cam.z) + 2;
    const ptx = Math.floor(prog.px), pty = Math.floor(prog.py);
    const x0 = Math.max(0, ptx-margin), x1 = Math.min(MAP_W-1, ptx+margin);
    const y0 = Math.max(0, pty-margin), y1 = Math.min(MAP_H-1, pty+margin);

    // index active nodes
    const activeNodeAt = {};
    for (const n of nodes) {
      if (!prog.harvested[n.id]) activeNodeAt[n.id] = n;
    }
    const nodeAtPos = {};
    for (const n of nodes) {
      if (!prog.harvested[n.id]) nodeAtPos[`${n.x},${n.y}`] = n;
    }
    const buildAtPos = {};
    for (const b of prog.buildings) buildAtPos[`${Math.floor(b.x)},${Math.floor(b.y)}`] = b;
    // city pre-built structures
    const cityBuildAtPos = {};
    for (const b of (cityBuildings||[])) cityBuildAtPos[`${b.x},${b.y}`] = b;

    // The landing pad IS the spaceport — only the player's ACTIVE hull parks here.
    // (Legacy second docking bay / NPC parked vessels removed.)
    const shipX = HX, shipY = HY + 2;
    const padDecals = {};
    padDecals[`${shipX},${shipY}`] = 1;
    // Apron approach lights — blinking amber guide dots up the centre lane.
    const apronLightCol = HX;

    // ── TWO-PASS RENDER ───────────────────────────────────────────────────────
    // Pass 1 lays down the entire ground plane (tiles + cliffs + water/puddle FX);
    // pass 2 then draws every object (resources, buildings, cars, people, the
    // player) on top, depth-sorted. Previously ground and objects were interleaved
    // in one loop, so a tile drawn later (a road/grass diamond one step in front)
    // could paint over the base of a car or building from the row behind — making
    // cars look like they were driving *under* the road and buildings look sunk
    // *into* the ground. Separating the passes guarantees objects sit ON the world.
    const z = _cam.z;
    const _snowTrail = (_weather.type==='SNOW'||_weather.type==='BLIZZARD');

    // Rebuild tile texture cache when zoom changes (hw/hh are zoom-dependent).
    // ONLY once the zoom has settled (_cam.z snapped to _zoomTgt): rebuilding
    // rasterizes 18 hi-res PNGs into ~36 OffscreenCanvases (~50-150ms, seconds
    // on first decode), so doing it mid-lerp meant a rebuild EVERY FRAME. While
    // the zoom animates, drawFlatTexture blits the previous cache scaled — a
    // touch soft for a beat, never janky. First build (no cache yet) runs
    // regardless so landing isn't textureless.
    // Ground modes (ClayWorldEngine):
    //   diorama — locked 100% procedural ISO clay
    //   clay    — legacy slab PNGs
    //   other   — flat PNG terrain stamps
    const _diorama = CWE ? CWE.isDiorama(_pdef) : (_pdef.ground === 'diorama');
    const _clay = (_pdef.ground === 'clay');
    const _softGround = CWE ? CWE.isSoftGround(_pdef) : (_clay || _diorama);
    const _thw = ISO_HW*z, _thh = ISO_HH*z;
    const _zoomSettled = (_cam.z === _zoomTgt);
    if (!_softGround && (_zoomSettled || ART._lastCacheHw < 0) &&
        (ART._lastCacheHw !== _thw || ART._lastCacheHh !== _thh)) {
      const count = ART.buildTileCache(_thw, _thh);
      if (count > 0) { ART._lastCacheHw = _thw; ART._lastCacheHh = _thh; }
    }
    // deco lookup map, built lazily once per world
    if (!world._decoAt) {
      world._decoAt = {};
      for (const d of (world.deco||[])) world._decoAt[`${d.x},${d.y}`] = d;
    }
    const _decoAt = world._decoAt;

    // ── FAR MODE (slab-clay only; diorama fills are cheap enough live) ───────
    // Below the live-slab threshold (tile face < 16px), blit the pre-baked
    // whole-map ground canvas in ONE drawImage — clay slabs and deco props stay
    // visible at every zoom. Farmed tiles and landing-pad rings are dynamic, so
    // they overlay live. While the bake is still building (first ~1s on a
    // fresh world), the per-tile loop below runs with its flat fallback.
    const _far = _clay && _thh < 8;
    let _farDrawn = false;
    if (_far) {
      const fb = _tickFarBake(world);
      if (fb && fb.done) {
        const sc = z / fb.z0;
        g.drawImage(fb.canvas,
          W/2 + (fb.minWx - _cam.x)*z, H/2 + (fb.minWy - _cam.y)*z,
          fb.canvas.width*sc, fb.canvas.height*sc);
        _farDrawn = true;
        // farmed soil overlays (few tiles — cheap at any zoom)
        for (const k in (prog.tilled||{})) {
          const ci = k.indexOf(','), ktx = +k.slice(0,ci), kty = +k.slice(ci+1);
          if (ktx<x0||ktx>x1||kty<y0||kty>y1) continue;
          const et = (elevA[I(ktx,kty)]||0)*CLIFF_PX*z;
          const p2 = tileScreen(ktx, kty, W, H);
          const cr0 = prog.crops && prog.crops[k];
          const cd0 = cr0 && SEED_BY[cr0.type];
          const sk = (cr0 && cd0 && cr0.stage >= cd0.grow) ? 'soil_harvest'
                   : cr0 ? 'soil_seedling' : 'soil_tilled';
          let fk = 'slab_'+(_pdef.propset||'mira')+'_'+sk;
          if (!ART.slabReady(fk)) fk = 'slab_mira_'+sk;
          ART.drawSlab(g, fk, p2.x, p2.y-et, ISO_HW*z, ISO_HH*z);
        }
        // landing-pad bullseyes stay visible on the apron
        for (const k in padDecals) {
          const ci = k.indexOf(','), ktx = +k.slice(0,ci), kty = +k.slice(ci+1);
          const et = (elevA[I(ktx,kty)]||0)*CLIFF_PX*z;
          const p2 = tileScreen(ktx, kty, W, H);
          drawPadRing(g, p2.x, p2.y-et, z);
        }
      }
    }

    // ─ Pass 1: ground, cliffs, water shimmer, puddles ─
    if (!_farDrawn)
    for (let depth = x0+y0; depth <= x1+y1; depth++) {
      for (let tx = Math.max(x0, depth-y1); tx <= Math.min(x1, depth-y0); tx++) {
        const ty = depth - tx;
        if (ty < y0||ty > y1) continue;

        const e = elevA[I(tx,ty)] || 0;
        const elPx = e * CLIFF_PX * _cam.z;    // elevation in screen-px
        const { x:sx, y:sy0 } = tileScreen(tx, ty, W, H);
        const sy = sy0 - elPx;                 // tile drawn higher

        const ttype = tiles[I(tx,ty)];
        // tileColors is authoritative for all tiles; sensible earthy fallbacks
        const col = tileColors[I(tx,ty)] || (ttype===T_ROAD ? '#B9AE97' : '#6EA843');
        const thw = ISO_HW*z, thh = ISO_HH*z;
        const tilledHere = prog.tilled && prog.tilled[`${tx},${ty}`];
        const crHere = prog.crops && prog.crops[`${tx},${ty}`];
        const cdHere = crHere && SEED_BY[crHere.type];
        const bioHere = biomeA[I(tx,ty)];

        if (_diorama) {
          // ── DIORAMA: 100% procedural ISO clay (no slab/tileset PNGs) ──────
          const cropInfo = crHere ? {
            ripe: !!(cdHere && crHere.stage >= cdHere.grow),
            watered: !!crHere.watered,
          } : null;
          drawDioramaCell(g, sx, sy, z, col, ttype, tilledHere, cropInfo, bioHere, tx, ty, e);
          // painted road markings wash (port threshold / centerline)
          if (ttype === T_ROAD && col !== _pdef.road) {
            g.save(); g.globalAlpha = 0.38; flatTile(g, sx, sy, col, null); g.restore();
          }
        } else if (_clay) {
          // CLAY SLAB GROUND (CLAY_GROUND_SPEC.md v2) — kept for A/B / other worlds
          let slabKey;
          if (ttype === T_WATER) slabKey = 'water';
          else if (ttype === T_ROAD) slabKey = 'stone_path';
          else if (tilledHere) {
            slabKey = (crHere && cdHere && crHere.stage >= cdHere.grow) ? 'soil_harvest'
                    : crHere ? 'soil_seedling' : 'soil_tilled';
          } else {
            if (bioHere === B_DESERT || bioHere === B_MOUNTAIN) slabKey = hash2(tx+3,ty+9) > 0.55 ? 'dirt_b' : 'dirt';
            else {
              const hv = hash2(tx, ty);
              slabKey = hv > 0.94 ? 'grass_flowers'
                     : hv > 0.86 ? 'grass_c'
                     : hv > 0.68 ? 'grass_b' : 'grass_a';
            }
          }
          let fullKey = 'slab_' + (_pdef.propset || 'mira') + '_' + slabKey;
          if (!ART.slabReady(fullKey)) fullKey = 'slab_mira_' + slabKey;
          const has = thh >= 8 && ART.slabReady(fullKey);
          flatTile(g, sx, sy, has ? darker(col, 0.74) : col, null);
          if (has) {
            const st = _pdef.slabTint || null;
            let tint =
              (bioHere === B_JUNGLE && slabKey.startsWith('grass')) ? (_pdef.biomeHI ? _pdef.biomeHI[B_JUNGLE] : null)
            : (bioHere === B_MOUNTAIN && slabKey === 'dirt')        ? (_pdef.biomeHI ? _pdef.biomeHI[B_MOUNTAIN] : null)
            : null;
            const usingMiraFallback = fullKey.indexOf('slab_mira_') === 0 && (_pdef.propset || 'mira') !== 'mira';
            if (st && usingMiraFallback) {
              if (slabKey.startsWith('grass') && st.grass) tint = st.grass;
              else if ((slabKey === 'dirt' || slabKey === 'dirt_b') && st.dirt) tint = st.dirt;
              else if (slabKey === 'water' && st.water) tint = st.water;
              else if (slabKey === 'stone_path' && st.path) tint = st.path;
              else if (slabKey.startsWith('soil') && st.dirt) tint = st.dirt;
            }
            ART.drawSlab(g, fullKey, sx, sy, thw, thh, tint);
            if (ttype === T_ROAD && col !== _pdef.road) {
              g.save(); g.globalAlpha = 0.42; flatTile(g, sx, sy, col, null); g.restore();
            }
          }
        } else {
          // PNG tile path (non-clay / non-diorama planets)
          const TS = (_pdef.tileset || 'mira') + '_flat_';
          let terrainKey;
          if (ttype === T_WATER) {
            terrainKey = TS + 'water_stream';
          } else if (ttype === T_ROAD) {
            terrainKey = hash2(tx*3, ty*5) > 0.4 ? TS + 'path_stone' : TS + 'road_dirt';
          } else {
            const h1 = hash2(tx, ty), h2 = hash2(tx+37, ty+13);
            terrainKey = h2 > 0.88 ? TS + 'wildflowers' : h1 > 0.75 ? TS + 'grass_pebbles' : TS + 'grass_base';
          }
          if (!terrainKey.endsWith('path_stone') && hash2(tx*7, ty*11) > 0.5)
            terrainKey += '#r';
          if (thh < 8 || !ART.drawFlatTexture(g, terrainKey, sx, sy, thw, thh)) {
            flatTile(g, sx, sy, col, ttype===T_ROAD ? 'rgba(80,60,30,0.10)' : 'rgba(40,70,20,0.10)');
          } else if (ttype !== T_WATER && ttype !== T_ROAD) {
            const mv = hash2((tx>>2)+53, (ty>>2)+101);
            if (mv > 0.45) {
              g.save();
              g.globalAlpha = (mv - 0.45) * 0.13;
              flatTile(g, sx, sy, mv > 0.72 ? '#33701E' : '#E8F5A8', null);
              g.restore();
            }
          }
        }

        // Tilled soil — PNG overlay on tile-art planets only (diorama/clay
        // already painted farm state in their ground pass).
        if (!_softGround && prog.tilled && prog.tilled[`${tx},${ty}`]) {
          const hw=ISO_HW*z, hh=ISO_HH*z;
          const cr = prog.crops && prog.crops[`${tx},${ty}`];
          const crDef = cr && SEED_BY[cr.type];
          const TS2 = (_pdef.tileset || 'mira') + '_flat_';
          const soilKey = (cr && crDef && cr.stage >= crDef.grow) ? TS2 + 'crop_harvest'
                        : cr ? TS2 + 'soil_seedling'
                        : TS2 + 'soil_tilled';
          if (!ART.drawFlatTexture(g, soilKey, sx, sy, hw, hh)) {
            flatTile(g, sx, sy, '#6E4A2C', 'rgba(50,30,15,0.35)');
            g.save(); g.globalAlpha=0.45; g.strokeStyle='#4A3018'; g.lineWidth=Math.max(0.5,0.8*_cam.z);
            for (let f=-1; f<=1; f++){ g.beginPath(); g.moveTo(sx-hw*0.6, sy+f*hh*0.4); g.lineTo(sx+hw*0.6, sy+f*hh*0.4); g.stroke(); }
            g.restore();
          }
        }
        // South / east cliff faces (the two camera-visible sides of an iso diamond).
        // Elbow corner = this tile drops BOTH south and east → both quads drawn.
        // Sandbox uses tall steps (rim→floor or floor→void) so walls read clearly.
        const isLavaCliff = CWE ? CWE.isLavaWorld(_pdef)
          : ((_pdef.name || '') === 'Cinder' || ((_pdef.tag || '').indexOf('volcan') >= 0));
        const solidHere = tiles[I(tx, ty)] !== T_WATER;
        let cliffS = false, cliffE = false;
        if (ty + 1 < MAP_H) {
          const eS = elevA[I(tx, ty + 1)] || 0;
          if (solidHere && e > eS) {
            cliffS = true;
            const ch = (e - eS) * CLIFF_PX * _cam.z;
            const fall = tiles[I(tx, ty + 1)] === T_WATER && ch > 5;
            if (_diorama) {
              drawDioramaCliff(g, sx, sy, z, col, ch, 'S', fall, isLavaCliff);
            } else {
              const hw = ISO_HW * _cam.z, hh = ISO_HH * _cam.z;
              const lc = darker(col, 0.72), rc = darker(col, 0.60);
              g.beginPath(); g.moveTo(sx - hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx - hw, sy + ch); g.closePath();
              g.fillStyle = lc; g.fill(); g.strokeStyle = 'rgba(61,43,31,0.25)'; g.lineWidth = 0.5; g.stroke();
              g.beginPath(); g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch); g.closePath();
              g.fillStyle = rc; g.fill(); g.stroke();
              g.save(); g.globalAlpha = 0.22; g.strokeStyle = darker(col, 0.45); g.lineWidth = Math.max(0.6, 0.9 * z);
              for (let k = 1; k < 4; k++) {
                const yy = sy + hh + ch * (k / 4);
                g.beginPath(); g.moveTo(sx - hw * (1 - k * 0.08), yy); g.lineTo(sx + hw * (1 - k * 0.08), yy); g.stroke();
              }
              g.restore();
              if (fall && ch > 6) {
                g.save();
                g.globalAlpha = 0.35 + 0.15 * Math.sin(_frame * 4 + tx);
                g.fillStyle = isLavaCliff ? '#FF8C2A' : '#A8E0FF';
                const fw = hw * 0.22;
                g.fillRect(sx - fw * 0.5, sy + hh * 0.3, fw, ch + hh * 0.4);
                g.globalAlpha = 0.5;
                g.fillStyle = isLavaCliff ? '#FFE080' : '#FFFFFF';
                g.fillRect(sx - fw * 0.2, sy + hh * 0.3, fw * 0.4, ch + hh * 0.4);
                g.restore();
              }
            }
          }
        }
        if (tx + 1 < MAP_W) {
          const eE = elevA[I(tx + 1, ty)] || 0;
          if (solidHere && e > eE) {
            cliffE = true;
            const ch = (e - eE) * CLIFF_PX * _cam.z;
            const fall = tiles[I(tx + 1, ty)] === T_WATER && ch > 5;
            if (_diorama) {
              drawDioramaCliff(g, sx, sy, z, col, ch, 'E', fall, isLavaCliff);
            } else {
              const hw = ISO_HW * _cam.z, hh = ISO_HH * _cam.z;
              const rc = darker(col, 0.58);
              g.beginPath(); g.moveTo(sx + hw, sy); g.lineTo(sx, sy + hh); g.lineTo(sx, sy + hh + ch); g.lineTo(sx + hw, sy + ch); g.closePath();
              g.fillStyle = rc; g.fill(); g.strokeStyle = 'rgba(61,43,31,0.2)'; g.lineWidth = 0.5; g.stroke();
              if (fall && ch > 6) {
                g.save();
                g.globalAlpha = 0.3 + 0.12 * Math.sin(_frame * 3.5 + ty);
                g.fillStyle = isLavaCliff ? '#FF8C2A' : '#A8E0FF';
                g.fillRect(sx + hw * 0.15, sy + hh * 0.2, hw * 0.18, ch + hh * 0.3);
                g.restore();
              }
            }
          }
        }
        // Elbow accent: outer corner where both faces meet (classic cliff corner tile)
        if (cliffS && cliffE && e > 0) {
          const hw = ISO_HW * z, hh = ISO_HH * z;
          const ch = Math.min(
            ty + 1 < MAP_H ? (e - (elevA[I(tx, ty + 1)] || 0)) * CLIFF_PX * z : 0,
            tx + 1 < MAP_W ? (e - (elevA[I(tx + 1, ty)] || 0)) * CLIFF_PX * z : 0
          );
          if (ch > 4) {
            g.save();
            g.globalAlpha = 0.35;
            g.strokeStyle = (_pdef.worldType === 'moon') ? '#C8C4BE' : '#D0B898';
            g.lineWidth = Math.max(1, 1.4 * z);
            g.beginPath();
            g.moveTo(sx, sy + hh);
            g.lineTo(sx, sy + hh + ch);
            g.stroke();
            g.restore();
          }
        }

        // water shimmer (extra on non-diorama; diorama already animates water body)
        if (!_diorama && tiles[I(tx,ty)]===T_WATER) {
          const t2=(_frame*0.6+tx*0.31+ty*0.73) % (Math.PI*2);
          g.save(); g.globalAlpha=0.10+0.07*Math.sin(t2); g.fillStyle=_pdef.glint||'#E8F6FF';
          g.beginPath(); g.ellipse(sx, sy, ISO_HW*_cam.z*0.35, ISO_HH*_cam.z*0.35, 0, 0, Math.PI*2); g.fill(); g.restore();
        }
        // shore foam on diorama land adjacent to water
        if (_diorama && ttype === T_GRASS) {
          const nearW = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => {
            const nx = tx+dx, ny = ty+dy;
            return nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H && tiles[I(nx,ny)]===T_WATER;
          });
          if (nearW && CWE) {
            CWE.drawShoreFoam({ g, sx, sy, z, ISO_HW, ISO_HH, tx, frame: _frame });
          }
        }

        // Painted landing bullseye under each ship (ground decal).
        if (padDecals[`${tx},${ty}`]) drawPadRing(g, sx, sy, z);

        // Apron approach lights — blinking amber dots leading toward the pad.
        if (tx===apronLightCol && ty>=HY+3 && ty<=HY+5 && tiles[I(tx,ty)]===T_ROAD) {
          const ph=(_frame*2 - (ty-HY))%3;
          g.save(); g.globalAlpha=0.35+0.5*Math.max(0,1-Math.abs(ph));
          g.fillStyle='#FFB020';
          g.beginPath(); g.ellipse(sx, sy, 2.2*z, 1.2*z, 0, 0, Math.PI*2); g.fill();
          g.restore();
        }
      }
    }

    // ─ Pass 2: objects on top of the ground, depth-sorted ─
    for (let depth = x0+y0; depth <= x1+y1; depth++) {
      for (let tx = Math.max(x0, depth-y1); tx <= Math.min(x1, depth-y0); tx++) {
        const ty = depth - tx;
        if (ty < y0||ty > y1) continue;

        const e = elevA[I(tx,ty)] || 0;
        const elPx = e * CLIFF_PX * _cam.z;
        const { x:sx, y:sy0 } = tileScreen(tx, ty, W, H);
        const sy = sy0 - elPx;
        const key = `${tx},${ty}`;

        // clay deco props (clay + diorama) — suppressed on farmed/built tiles.
        // Slab-clay far-bake embeds props below thh<8; diorama draws live always
        // (fills are cheap) but skips tiny props at very low zoom.
        // clay deco props (clay + diorama)
        if (_softGround && (_diorama ? _thh >= 5 : _thh >= 8)) {
          const d = _decoAt[key];
          if (d && !(prog.tilled && prog.tilled[key]) && !buildAtPos[key]) {
            const proc = _pdef.proc;
            const pw = (CWE && _diorama)
              ? CWE.decoDisplayW(d.key, d.s, ISO_HW, proc) * z
              : (DECO_W[d.key] || 16) * d.s * z;
            const ox = d.fullTile ? 0 : d.ox * ISO_HW * z;
            const oy = d.fullTile ? 2 * z : (2 * z + d.oy * ISO_HH * z);
            const flip = d.flip != null ? d.flip
              : (CWE ? CWE.decoFlip(d.x, d.y, proc) : false);
            ART.drawProp(g, 'prop_'+(_pdef.propset||'mira')+'_'+d.key,
              sx + ox, sy + oy, pw, 220, flip);
          }
        }

        // resource node — with hit shake + "chipped" shrink while being harvested
        // nodeScale = per-node natural size (big boulders, small pebbles, etc.)
        if (nodeAtPos[key]) {
          const n = nodeAtPos[key];
          const ttl = _hitFx[n.id]||0;
          const shake = ttl>0 ? Math.sin(_frame*50)*3*_cam.z*(ttl/0.22) : 0;
          const rem = prog.nodeHits ? prog.nodeHits[n.id] : undefined;
          const need = requiredHits(prog, n.type);
          const scale = (rem!==undefined) ? (0.62 + 0.38*(rem/need)) : 1;
          const fx = { shake, scale, nodeScale: n.scale || 1, hx: n.x, hy: n.y };
          if (n.type==="tree")   drawTree(g, sx, sy, n.biome, z, fx);
          else if (n.type==="rock")  drawRock(g, sx, sy, n.biome, z, fx);
          else if (n.type==="berry") drawBerry(g, sx, sy, n.biome, z, fx);
        }

        // crop growing on tilled soil
        if (prog.crops && prog.crops[key]) drawCrop(g, sx, sy, prog.crops[key], z);

        // player-placed building (with level pips)
        if (buildAtPos[key]) drawBuilding(g, sx, sy, buildAtPos[key].type, z, false, buildAtPos[key].level);

        // city pre-built structure
        if (cityBuildAtPos[key]) {
          const _cbDef = CITY_BY_KEY[cityBuildAtPos[key].type];
          const _cbNear = Math.hypot(prog.px-tx, prog.py-ty) < 3.5;
          drawBuilding(g, sx, sy, cityBuildAtPos[key].type, z, true, undefined, _cbNear);
          const _bCard = BUILDING_CARDS[cityBuildAtPos[key].type];
          if (_cbDef && _bCard && _bCard.key === 'E' && z > 0.6 &&
              Math.hypot(prog.px-tx, prog.py-ty) < 3.2) {
            const _signBob = Math.sin(_frame * 1.1 + tx * 0.7 + ty * 0.5) * 3 * z;
            const _signY = sy - _cbDef.bh * z - 14 * z + _signBob;
            const _nCol = _cbDef.neon || '#00FFEE';
            const _label = _bCard.e + ' ' + _bCard.t;
            g.save();
            g.font = `bold ${Math.max(8, 9*z)|0}px monospace`;
            g.textAlign = 'center';
            g.shadowColor = _nCol; g.shadowBlur = 10 * z;
            g.fillStyle = _nCol;
            g.fillText(_label, sx, _signY);
            g.shadowBlur = 0; g.globalAlpha = 0.85; g.fillStyle = '#fff';
            g.fillText(_label, sx, _signY);
            g.restore();
          }
        }

        // NPC city cars — rendered at their sub-tile position, depth-keyed by floor tile
        for (const npc of (npcCars || [])) {
          if (Math.floor(npc.tx) === tx && Math.floor(npc.ty) === ty) {
            const { x:ncsx, y:ncsy0 } = tileScreen(npc.tx, npc.ty, W, H);
            const nce = (elevA[I(Math.floor(npc.tx), Math.floor(npc.ty))]||0)*CLIFF_PX*_cam.z;
            drawNPCCar(g, ncsx, ncsy0 - nce, _cam.z, npc.color, npc.heading);
          }
        }

        // NPC pedestrians — depth-keyed at their tile position
        for (const ped of (npcPeds || [])) {
          if (Math.floor(ped.tx) === tx && Math.floor(ped.ty) === ty) {
            const { x:psx, y:psy0 } = tileScreen(ped.tx, ped.ty, W, H);
            const pe2 = (elevA[I(Math.floor(ped.tx), Math.floor(ped.ty))]||0)*CLIFF_PX*_cam.z;
            drawNPCPed(g, psx, psy0 - pe2, _cam.z, ped.color, ped.legPhase, { trail: _snowTrail });
          }
        }
        // Planet scenery props (volcanos, snowmen, camels, crystals…) — larger
        for (const p of (world.props||[])) {
          if (p.x === tx && p.y === ty) {
            const { x:psx2, y:psy2 } = tileScreen(p.x, p.y, W, H);
            const pe4 = (elevA[I(p.x,p.y)]||0)*CLIFF_PX*_cam.z;
            const bob2 = p.big ? 0 : Math.sin(_frame*1.2 + p.phase)*0.8*_cam.z;
            drawEmoji(g, p.e, psx2, psy2 - pe4 - bob2, (p.big ? 72 : 32)*_cam.z);
          }
        }

        // Lunar ground plates first (behind buildings) — craters / regolith / walls
        for (const P of (world.plates || [])) {
          if (P.x === tx && P.y === ty) {
            drawWorldPlate(g, P, W, H, elevA);
          }
        }

        // Large vista landscape overlays (no collision) — multi-tile backdrops
        for (const V of (world.landscapes || [])) {
          if (V.x === tx && V.y === ty) {
            drawMultiTileLandmark(g, V, W, H, elevA, true);
          }
        }

        // Collidable multi-tile mountain ranges / mesas (6–11 tile footprints)
        for (const L of (world.landmarks || [])) {
          if (L.x === tx && L.y === ty) {
            drawMultiTileLandmark(g, L, W, H, elevA, false);
          }
        }

        // Oriented features (4-angle cliffs, peaks, boulders, plants) — sprite
        // overlay on optional hard-body radius (WORLD_TYPES.md feature packs)
        for (const F of (world.features || [])) {
          if (F.x === tx && F.y === ty) {
            drawWorldFeature(g, F, W, H, elevA);
          }
        }

        // Barnyard animals — size varies a bit so the flock isn't clones
        for (const a of _animals) {
          if (Math.floor(a.x) === tx && Math.floor(a.y) === ty) {
            const { x:asx, y:asy0 } = tileScreen(a.x, a.y, W, H);
            const ae = (elevA[I(Math.max(0,Math.min(MAP_W-1,Math.floor(a.x))), Math.max(0,Math.min(MAP_H-1,Math.floor(a.y))))]||0)*CLIFF_PX*_cam.z;
            const abob = Math.abs(Math.sin(_frame*3 + a.phase))*1.2*_cam.z;
            const aSz = (14 + (a.phase % 1) * 8) * _cam.z;
            drawEmoji(g, a.emoji, asx, asy0 - ae - abob, aSz);
          }
        }
        // Summer carnival: draw circular extra NPC glow near city center
        if (_festival.active && _season.idx === 1) {
          const cityMidX = (world.CX||48) + 11, cityMidY = (world.CY||10) + 11;
          if (Math.abs(tx - cityMidX) < 3 && Math.abs(ty - cityMidY) < 3) {
            const ang = _frame * 0.4;
            const { x: csx, y: csy } = tileScreen(
              cityMidX + Math.cos(ang) * 2.5,
              cityMidY + Math.sin(ang) * 2.5,
              W, H
            );
            g.save(); g.globalAlpha = 0.55; g.fillStyle = '#FFFF44';
            g.shadowColor = '#FFFF44'; g.shadowBlur = 12*_cam.z;
            g.beginPath(); g.arc(csx, csy, 2.5*_cam.z, 0, Math.PI*2); g.fill();
            g.restore();
          }
        }

        // Rover (car) — depth-sorted at its tile position
        if (Math.floor(prog.car.x)===tx && Math.floor(prog.car.y)===ty) {
          const { x:csx, y:csy0 } = tileScreen(prog.car.x, prog.car.y, W, H);
          const ce = (elevA[I(Math.floor(prog.car.x), Math.floor(prog.car.y))]||0)*CLIFF_PX*_cam.z;
          drawCar(g, csx, csy0 - ce, prog.car.heading, z, prog.inCar);
        }

        // player (drawn at sub-tile position; suppressed when riding the Rover)
        if (!prog.inCar && Math.floor(prog.px)===tx && Math.floor(prog.py)===ty) {
          const { x:psx, y:psy0 } = tileScreen(prog.px, prog.py, W, H);
          const pe = (elevA[I(Math.floor(prog.px), Math.floor(prog.py))] || 0)*CLIFF_PX*_cam.z;
          const moving = !!(prog.moveTarget) || Math.hypot(input.ax||0, input.ay||0) > 0.15;
          drawPlayer(g, psx, psy0-pe, z, prog.pDir||0, moving);
        }
      }
    }

    // ── Landed player ship (always on top of pad, not depth-culled) ────────────
    {
      const se = (elevA[I(shipX, shipY)] || 0) * CLIFF_PX * z;
      const { x: ssx, y: ssy0 } = tileScreen(shipX + 0.5, shipY + 0.5, W, H);
      drawPlayerShip(g, ssx, ssy0 - se, z, s);
    }

    // ── Tap-to-move destination marker ──────────────────────────────────────────
    // Highlights the EXACT target tile, colour-coded by intent — a full diamond
    // fill so you can clearly see which tile you're about to till / plant / etc.
    if (prog.moveTarget) {
      const mt = prog.moveTarget;
      const ACT_COL = { till:'#8A5A2C', plant:'#4CBB4C', water:'#3FA9E0', refill:'#3FA9E0', build:'#5AA0FF', destroy:'#E0603C' };
      const col = ACT_COL[mt.action] || (mt.interact ? '#F0B429' : '#FFFFFF');
      const { x:mx, y:my0 } = tileScreen(mt.x, mt.y, W, H);
      const me = (elevA[I(Math.max(0,Math.min(MAP_W-1,Math.floor(mt.x))), Math.max(0,Math.min(MAP_H-1,Math.floor(mt.y))))]||0)*CLIFF_PX*_cam.z;
      const my = my0 - me;
      const hw = ISO_HW*_cam.z, hh = ISO_HH*_cam.z;
      const pulse = 0.5 + 0.5*Math.sin(_frame*4);
      g.save();
      // soft filled tile
      g.globalAlpha = 0.18 + 0.12*pulse;
      g.fillStyle = col;
      g.beginPath(); g.moveTo(mx,my-hh); g.lineTo(mx+hw,my); g.lineTo(mx,my+hh); g.lineTo(mx-hw,my); g.closePath(); g.fill();
      // bright outline
      g.globalAlpha = 0.85;
      g.strokeStyle = col; g.lineWidth = Math.max(1.2, 2*_cam.z);
      g.stroke();
      g.restore();
    }

    // NPC role labels — only the one you're right next to (was every ped in 4 tiles)
    {
      const PED_ROLES = ['Netrunner','Fixer','Corpo','Street Kid','Nomad','Merc','Techie','Medic','Dealer','Runner'];
      let _nearPed = -1, _nearPedD = 2.2;
      for (let pi = 0; pi < (npcPeds||[]).length; pi++) {
        const d = Math.hypot(prog.px - npcPeds[pi].tx, prog.py - npcPeds[pi].ty);
        if (d < _nearPedD) { _nearPedD = d; _nearPed = pi; }
      }
      for (let pi = 0; pi < (npcPeds||[]).length; pi++) {
        if (pi !== _nearPed) continue;
        const ped = npcPeds[pi];
        const dist = Math.hypot(prog.px - ped.tx, prog.py - ped.ty);
        if (dist < 2.2) {
          const la = Math.max(0, Math.min(1, (2.2 - dist) / 1.2));
          const { x: lx, y: ly0 } = tileScreen(ped.tx, ped.ty, W, H);
          const pe3 = (elevA[I(Math.floor(ped.tx), Math.floor(ped.ty))]||0)*CLIFF_PX*_cam.z;
          const ly = ly0 - pe3 - 14*_cam.z;
          const role = PED_ROLES[pi % PED_ROLES.length];
          g.save();
          g.globalAlpha = la;
          g.font = `bold ${Math.max(7, 8*_cam.z)|0}px monospace`;
          g.textAlign = 'center';
          const tw2 = g.measureText(role).width + 6;
          g.fillStyle = 'rgba(0,0,0,0.75)';
          g.fillRect(lx - tw2/2, ly - 9, tw2, 11);
          g.fillStyle = ped.color;
          g.fillText(role, lx, ly);
          g.restore();
        }
      }
    }

  }

  // ── Proximity nameplate ──────────────────────────────────────────────────────
  // A small, unobtrusive chip above the building you're next to: emoji + name (+ a
  // tap dot if interactive). The full action detail lives in the bottom hint bar,
  // so this stays tiny and never covers the play area.
  function drawProximityCard(g, cx, cy, card, alpha) {
    if (HEADLESS || alpha <= 0) return;
    const a = Math.min(0.95, alpha);
    g.save();
    g.font = 'bold 11px sans-serif'; g.textAlign = 'left';
    const label = card.e + '  ' + card.t;
    const tw = g.measureText(label).width;
    const pad = 9, dot = card.key ? 12 : 0;
    const PW = tw + pad*2 + dot, PH = 22, R = 6;
    const px = Math.max(6, Math.min(CONFIG.W - PW - 6, cx - PW/2));
    const py = Math.max(4, cy - PH - 8);

    g.globalAlpha = a;
    g.fillStyle = 'rgba(2,4,18,0.86)';
    if (g.roundRect){ g.beginPath(); g.roundRect(px, py, PW, PH, R);} else { g.beginPath(); g.rect(px,py,PW,PH);} g.fill();
    g.strokeStyle = card.ac; g.lineWidth = 0.8;
    if (g.roundRect){ g.beginPath(); g.roundRect(px, py, PW, PH, R);} else { g.beginPath(); g.rect(px,py,PW,PH);} g.stroke();
    // label
    g.fillStyle = '#eef4ff';
    g.fillText(label, px + pad, py + 15);
    // interactive tap dot (pulses)
    if (card.key) {
      g.globalAlpha = a * (0.6 + 0.4*Math.sin(_frame*4));
      g.fillStyle = card.ac;
      g.beginPath(); g.arc(px + PW - pad - 2, py + PH/2, 3, 0, Math.PI*2); g.fill();
    }
    g.restore();
  }

  // ── HUD draw ────────────────────────────────────────────────────────────────
  // SAVE chip: right-aligned on the second row, clear of the resource bar and
  // biome pill (row 1 left) and the jobs chip (row 1 right). Shared by drawHUD
  // and hitUI so the drawn box and the tap box can never drift apart.
  function saveBtnRect(W) { return { x: (W || CONFIG.W) - 66, y: 52, w: 56, h: 28 }; }

  function drawHUD(g, W, H, prog, world, s) {
    // resource bar (top-left) — cyberpunk dark panel
    const inv = prog.inv;
    g.fillStyle='rgba(2,4,16,0.88)';
    g.beginPath(); if (g.roundRect) g.roundRect(10,10,220,36,4); else g.rect(10,10,220,36); g.fill();
    g.strokeStyle='rgba(0,220,255,0.25)'; g.lineWidth=0.8;
    g.beginPath(); if (g.roundRect) g.roundRect(10,10,220,36,4); else g.rect(10,10,220,36); g.stroke();
    const items=[
      {t:"🪵",v:inv.wood||0,c:"#FF8800"},
      {t:"⛏",v:inv.stone||0,c:"#AACCFF"},
      {t:"🫐",v:inv.berry||0,c:"#FF44AA"},
      {t:"💰",v:(s&&s.credits)||0,c:"#FFEE00"},
    ];
    g.font='bold 12px sans-serif'; g.textAlign='left';
    let ix=18;
    for (const it of items) { g.fillStyle=it.c; g.fillText(`${it.t}${it.v}`, ix, 33); ix+=54; }

    // SAVE chip — a planet surface is a valid berth (game/save.js saveBerth)
    const sb = saveBtnRect(W);
    g.fillStyle='rgba(2,4,16,0.88)';
    g.beginPath(); if (g.roundRect) g.roundRect(sb.x,sb.y,sb.w,sb.h,4); else g.rect(sb.x,sb.y,sb.w,sb.h); g.fill();
    g.strokeStyle='rgba(123,216,143,0.45)'; g.lineWidth=0.8;
    g.beginPath(); if (g.roundRect) g.roundRect(sb.x,sb.y,sb.w,sb.h,4); else g.rect(sb.x,sb.y,sb.w,sb.h); g.stroke();
    g.fillStyle='#7bd88f'; g.font='bold 9px monospace'; g.textAlign='center';
    g.fillText('SAVE', sb.x+sb.w/2, sb.y+18);
    g.textAlign='left';

    // Homestead / city wayfinding (when world has farm rect)
    if (s && world && world.farm && world.HX != null) {
      const dxF = ((world.farm.x0 + world.farm.x1) / 2) - prog.px;
      const dyF = ((world.farm.y0 + world.farm.y1) / 2) - prog.py;
      const dF = Math.hypot(dxF, dyF);
      const dxC = (world.CX + 11) - prog.px, dyC = (world.CY + 11) - prog.py;
      const dC = Math.hypot(dxC, dyC);
      g.fillStyle = 'rgba(2,4,16,0.82)';
      g.beginPath(); if (g.roundRect) g.roundRect(10, 52, 168, 28, 4); else g.rect(10, 52, 168, 28); g.fill();
      g.fillStyle = '#9fd36a'; g.font = 'bold 8px monospace'; g.textAlign = 'left';
      let hallU = dC;
      if (world.plaza) {
        const dxH = world.plaza.x - prog.px, dyH = world.plaza.y - prog.py;
        hallU = Math.hypot(dxH, dyH);
      }
      g.fillText(`🌾 plots ${dF < 3 ? 'HERE' : Math.round(dF) + 'u'}  ·  🏛 hall ${Math.round(hallU)}u`, 18, 70);
    }

    // Active City Hall quests chip (top-right)
    if (s && s.questState && (s.questState.active||[]).length) {
      const act = s.questState.active;
      const q0 = act[0];
      let ptxt = q0.title || 'Job';
      if (q0.type==='export') ptxt = `${q0.progress||0}/${q0.qty} export`;
      else if (q0.type==='seeds') ptxt = `seeds ${(s.seedBag||{})[q0.crop]||0}/${q0.qty}`;
      else if (q0.type==='gather') ptxt = `${prog.inv[q0.res]||0}/${q0.qty} ${q0.res}`;
      const qw = 150, qx = W - qw - 10, qy = 10;
      g.fillStyle='rgba(2,4,16,0.88)';
      g.beginPath(); if (g.roundRect) g.roundRect(qx,qy,qw,36,4); else g.rect(qx,qy,qw,36); g.fill();
      g.strokeStyle='rgba(232,208,106,0.45)'; g.lineWidth=0.8;
      g.beginPath(); if (g.roundRect) g.roundRect(qx,qy,qw,36,4); else g.rect(qx,qy,qw,36); g.stroke();
      g.fillStyle='#E8D06A'; g.font='bold 9px monospace'; g.textAlign='left';
      g.fillText(`📜 ${act.length}/${QUEST_MAX_ACTIVE} JOBS`, qx+8, qy+14);
      g.fillStyle='#c8d0dc'; g.font='8px monospace';
      const clip = ptxt.length>22 ? ptxt.slice(0,21)+'…' : ptxt;
      g.fillText(clip, qx+8, qy+28);
    }

    // ── Season / Weather / Festival HUD block (below resource bar) ───────────────
    {
      const sx3 = 10, sy3 = 52;
      const sn = getCurrentSeason();
      const prog3 = Math.min(8, Math.round(sn.progress * 8));
      const bar3 = '[' + '█'.repeat(prog3) + '░'.repeat(8 - prog3) + ']';
      const sleepLbl = `${_season.tick}/${SLEEPS_PER_SEASON} 😴`;   // sleeps into the season
      const SEASON_COLS = ['#FF88CC','#44DDFF','#FF8833','#88AAFF'];
      const scol = SEASON_COLS[sn.idx];

      // Weather icon
      const WT_ICONS = { CLEAR:'☀', RAIN:'⚡', STORM:'⛈', FOG:'🌫', HAZE:'〰', SNOW:'❄', BLIZZARD:'❄❄' };
      const wIcon = WT_ICONS[_weather.type] || '☀';

      const panH = _festival.active ? 46 : 32;
      g.fillStyle = 'rgba(2,4,16,0.80)';
      g.beginPath();
      if (g.roundRect) g.roundRect(sx3, sy3, 192, panH, 4); else g.rect(sx3, sy3, 192, panH);
      g.fill();
      g.strokeStyle = scol + '44'; g.lineWidth = 0.8;
      g.beginPath();
      if (g.roundRect) g.roundRect(sx3, sy3, 192, panH, 4); else g.rect(sx3, sy3, 192, panH);
      g.stroke();

      g.font = 'bold 10px monospace'; g.textAlign = 'left';
      g.fillStyle = scol; g.shadowColor = scol; g.shadowBlur = 6;
      g.fillText(`▶ ${sn.name} ${bar3} ${sleepLbl}`, sx3+8, sy3+14);
      g.shadowBlur = 0;

      g.font = '9px monospace'; g.fillStyle = '#AACCFF';
      let wtLine = `  ${wIcon} ${_weather.type}`;
      if (_festival.active) {
        const FEST_COLS = ['#FF88CC','#FFFF44','#FF8833','#88CCFF'];
        g.fillText(wtLine, sx3+8, sy3+26);
        g.fillStyle = FEST_COLS[sn.idx]; g.shadowColor = FEST_COLS[sn.idx]; g.shadowBlur = 8;
        g.fillText(`  ✦ ${_festival.name}`, sx3+8, sy3+40);
        g.shadowBlur = 0;
      } else {
        g.fillText(wtLine, sx3+8, sy3+26);
      }
    }

    // biome label (top-center) — neon
    const bNames=["Grassland","Jungle","Desert","Mountains"];
    const btx=Math.floor(prog.px), bty=Math.floor(prog.py);
    if (btx>=0&&btx<MAP_W&&bty>=0&&bty<MAP_H) {
      const bio = world.biomeA[bty*MAP_W+btx];
      g.fillStyle='rgba(2,4,16,0.80)';
      g.beginPath(); if (g.roundRect) g.roundRect(W/2-52,10,104,24,4); else g.rect(W/2-52,10,104,24); g.fill();
      g.strokeStyle='rgba(0,220,255,0.25)'; g.lineWidth=0.8;
      g.beginPath(); if (g.roundRect) g.roundRect(W/2-52,10,104,24,4); else g.rect(W/2-52,10,104,24); g.stroke();
      g.fillStyle='#00FFEE'; g.font='11px sans-serif'; g.textAlign='center';
      g.fillText(bNames[bio]||"Grassland", W/2, 27);
    }

    // (build selection is now the bottom toolbar's Build strip — no top-right panel)

    // ── Proximity cards (float above nearest interactable) ────────────────────
    if (!prog._marketOpen) {
      const I2 = (x,y) => y*MAP_W+x;
      const CARD_FAR  = 3.4;  // tiles — only surfaces when you're basically adjacent
      const CARD_FULL = INTERACT_R;  // tiles — fully opaque within this
      let nearDist = CARD_FAR;
      let nearCard = null;
      let nearAnchorX = 0, nearAnchorY = 0;

      // Helper: compute screen anchor above a tile position
      const cardAnchor = (tx, ty, bh_px) => {
        const { x: asx, y: asy0 } = tileScreen(tx, ty, W, H);
        const ae = (world.elevA[I2(Math.max(0,Math.floor(tx)), Math.max(0,Math.floor(ty)))]||0)*CLIFF_PX*_cam.z;
        return { x: asx, y: asy0 - ae - bh_px - 10 };
      };

      // 1. Ship
      if (!prog.inCar) {
        const { HX, HY } = world;
        const shipX = HX, shipY = HY + 2;
        const d = Math.hypot(prog.px - shipX, prog.py - shipY);
        if (d < nearDist) {
          const a = cardAnchor(shipX, shipY, 58 * _cam.z);
          nearDist = d; nearCard = { e:'🚀', t:'Your Ship', a:'Ready to launch back to space', ac:'#3878C8', key:'E' };
          nearAnchorX = a.x; nearAnchorY = a.y;
        }
      }

      // 2. Rover
      if (!prog.inCar && prog.car) {
        const d = Math.hypot(prog.px - prog.car.x, prog.py - prog.car.y);
        if (d < Math.min(2.6, nearDist)) {
          const a = cardAnchor(prog.car.x, prog.car.y, 22 * _cam.z);
          nearDist = d; nearCard = { e:'🚗', t:'The Rover', a:'Explore Port Mira in style', ac:'#C04020', key:'E' };
          nearAnchorX = a.x; nearAnchorY = a.y;
        }
      }

      // 3. City buildings — only the interactive one (Trade Guild) gets a nameplate
      for (const b of (world.cityBuildings || [])) {
        const d = Math.hypot(prog.px - b.x, prog.py - b.y);
        if (d >= nearDist) continue;
        const info = BUILDING_CARDS[b.type];
        if (!info || info.key !== 'E') continue;
        const def = CITY_BY_KEY[b.type];
        const bh_px = (def ? def.bh : 20) * _cam.z;
        const a = cardAnchor(b.x, b.y, bh_px);
        nearDist = d; nearCard = info;
        nearAnchorX = a.x; nearAnchorY = a.y;
      }

      // 4. Player buildings (market, shelter)
      for (const b of prog.buildings) {
        const d = Math.hypot(prog.px - b.x, prog.py - b.y);
        if (d >= nearDist) continue;
        const def = BT_BY_KEY[b.type];
        const bh_px = (def ? 22 : 20) * _cam.z;
        const a = cardAnchor(b.x, b.y, bh_px);
        nearDist = d;
        if (b.type==='market')  nearCard = { e:'🏪', t:'Your Market', a:'Sell resources (wood×5  stone×8  berry×3)', ac:'#40A848', key:'E' };
        else if (b.type==='shelter') nearCard = { e:'🏕', t:'Shelter', a:'Rest here — all resources respawn', ac:'#7848B8', key:'E' };
        else nearCard = { e:'🏗', t:def?.name||b.type, a:'Your building', ac:'#707070', key:'' };
        nearAnchorX = a.x; nearAnchorY = a.y;
      }

      // Draw the card for the nearest target
      if (nearCard) {
        const alpha = nearDist < CARD_FULL
          ? 0.96
          : (CARD_FAR - nearDist) / (CARD_FAR - CARD_FULL) * 0.96;
        drawProximityCard(g, nearAnchorX, nearAnchorY, nearCard, alpha);
      }
    }

    // ── Cyberpunk mini-map (bottom-right, above the tool bar) ────────────────
    if (!prog._marketOpen) {
      const { tiles, nodes, CX: MCX, CY: MCY, HX, HY } = world;
      const MW = 92, MH = 68;
      const MX = W - MW - 6, MY = H - HINT_H - TB_H - MH - 8;   // sits above the toolbar
      const SX = MW / MAP_W, SY = MH / MAP_H;

      // Tile layer (clipped)
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(MX, MY, MW, MH, 3); else g.rect(MX, MY, MW, MH);
      g.clip();
      g.fillStyle = '#02040C'; g.fillRect(MX, MY, MW, MH);
      // Draw road + water tiles (sample every 2 tiles for perf)
      for (let ty2 = 0; ty2 < MAP_H; ty2 += 2) {
        for (let tx2 = 0; tx2 < MAP_W; tx2 += 2) {
          const tt = tiles[ty2 * MAP_W + tx2];
          if (tt === T_WATER) { g.fillStyle = '#060C1E'; g.fillRect(MX+tx2*SX, MY+ty2*SY, SX*2+0.5, SY*2+0.5); }
          else if (tt === T_ROAD) { g.fillStyle = '#161628'; g.fillRect(MX+tx2*SX, MY+ty2*SY, SX*2+0.5, SY*2+0.5); }
        }
      }
      // City zone tint
      g.fillStyle = 'rgba(80,0,160,0.18)';
      g.fillRect(MX+MCX*SX, MY+MCY*SY, 22*SX, 22*SY);
      g.restore();

      // Border + "RADAR" label
      g.save();
      g.strokeStyle = 'rgba(0,200,255,0.55)'; g.lineWidth = 0.8;
      g.shadowColor = '#00CCFF'; g.shadowBlur = 5;
      g.beginPath();
      if (g.roundRect) g.roundRect(MX, MY, MW, MH, 3); else g.rect(MX, MY, MW, MH);
      g.stroke(); g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,180,255,0.40)'; g.font = '6px monospace'; g.textAlign = 'left';
      g.fillText('RADAR', MX + 3, MY + 8);

      // Ship dot — neon blue
      g.fillStyle = '#00AAFF'; g.shadowColor = '#00AAFF'; g.shadowBlur = 6;
      g.beginPath(); g.arc(MX + HX*SX, MY + HY*SY, 2, 0, Math.PI*2); g.fill();

      // Rover dot — orange
      if (prog.car) {
        g.fillStyle = prog.inCar ? '#FFEE00' : '#FF6600';
        g.shadowColor = g.fillStyle; g.shadowBlur = 5;
        g.beginPath(); g.arc(MX + prog.car.x*SX, MY + prog.car.y*SY, 2, 0, Math.PI*2); g.fill();
      }

      // Interactive city buildings — tiny colored squares
      for (const b of (world.cityBuildings||[])) {
        const card = BUILDING_CARDS[b.type];
        if (!card || card.key !== 'E') continue;
        g.fillStyle = card.ac; g.shadowColor = card.ac; g.shadowBlur = 3;
        g.fillRect(MX + b.x*SX - 1, MY + b.y*SY - 1, 2.5, 2.5);
      }
      g.shadowBlur = 0;

      // Resource nodes — dim yellow (uncollected only)
      g.shadowColor = '#FFFF44'; g.shadowBlur = 3; g.fillStyle = 'rgba(255,240,60,0.50)';
      for (const n of nodes) {
        if (!prog.harvested[n.id]) {
          g.beginPath(); g.arc(MX + n.x*SX, MY + n.y*SY, 1.2, 0, Math.PI*2); g.fill();
        }
      }

      // Player dot — pulsing cyan
      const mpulse = 0.72 + 0.28 * Math.sin(_frame * 3.2);
      g.globalAlpha = mpulse; g.fillStyle = '#00FFEE';
      g.shadowColor = '#00FFEE'; g.shadowBlur = 10;
      g.beginPath(); g.arc(MX + prog.px*SX, MY + prog.py*SY, 2.5, 0, Math.PI*2); g.fill();
      g.globalAlpha = 1; g.shadowBlur = 0;
      g.restore();
    }

    // interaction hint (bottom bar) — cyberpunk dark
    g.fillStyle='rgba(2,4,16,0.85)';
    g.fillRect(0, H-28, W, 28);
    g.strokeStyle='rgba(0,220,255,0.20)'; g.lineWidth=0.8;
    g.beginPath(); g.moveTo(0,H-28); g.lineTo(W,H-28); g.stroke();
    g.fillStyle='#00CCEE'; g.font='10px sans-serif'; g.textAlign='center';
    const hint = getHint(prog, world);
    g.fillText(hint, W/2, H-11);

    // compact, non-obstructive action feedback
    drawPlanetToasts(g, W, H);
  }

  // ── compact toast line — 2 most-recent messages as small top-centre pills ────
  // Replaces the old full-screen flash / big transaction panel. Small, fades in
  // and out, never covers the play area.
  function drawPlanetToasts(g, W, H){
    if (HEADLESS || typeof toasts === 'undefined' || !toasts.length) return;
    const show = toasts.slice(-2);
    g.save();
    g.textAlign = 'center';
    g.font = 'bold 11px sans-serif';
    let y = 104;   // below the resource + season panels, clear of the world centre
    for (const t of show){
      const life = t.life || 3;
      let a = 1;
      if (t.age < 0.15) a = t.age/0.15;
      else if (t.age > life-0.5) a = Math.max(0, (life-t.age)/0.5);
      if (a <= 0) continue;
      const txt = t.text.length>46 ? t.text.slice(0,45)+'…' : t.text;
      const tw = g.measureText(txt).width, pw = tw+26, ph = 19, px = W/2-pw/2;
      g.globalAlpha = a*0.85;
      g.fillStyle = 'rgba(2,4,16,0.82)';
      if (g.roundRect){ g.beginPath(); g.roundRect(px,y,pw,ph,9); } else { g.beginPath(); g.rect(px,y,pw,ph); }
      g.fill();
      g.fillStyle = t.col || '#cfe4ff';
      g.beginPath(); g.arc(px+11, y+ph/2, 2.5, 0, Math.PI*2); g.fill();   // colour dot
      g.globalAlpha = a;
      g.fillStyle = t.col || '#e8f0ff';
      g.fillText(txt, W/2+7, y+13);
      y += ph+5;
    }
    g.restore();
  }

  function getHint(prog, world) {
    const { HX, HY, cityBuildings } = world;
    const shipX=HX, shipY=HY+2;
    // Rover hints take high priority (when in car, always show drive controls)
    if (prog.inCar) return "Arrow keys: drive  •  E or tap EXIT below to park";
    if (prog.car && Math.hypot(prog.px-prog.car.x, prog.py-prog.car.y) < 2) return "Press E to get in the Rover";
    if (Math.hypot(prog.px-shipX, prog.py-shipY) < SHIP_R) return "E: Launch back to space";
    // the three interactive city buildings
    for (const b of (cityBuildings||[])) {
      const d = Math.hypot(prog.px-b.x, prog.py-b.y);
      if (d >= INTERACT_R+0.7) continue;
      if (b.type==="traders_guild") return "Tap the Trade Guild — buy seeds & sell your harvest";
      if (b.type==="city_market")   return "Tap the Market Hall — buy seeds & sell your harvest";
      if (b.type==="city_hall")     return "Tap City Hall — jobs board: quests & rewards";
      if (b.type==="cantina")       return "Tap the Cantina — trade gossip (and free seeds?)";
      if (b.type==="hotel")         return `Tap the Hotel — rent a room (${ROOM_COST}cr) & sleep to next turn`;
    }
    for (const b of prog.buildings) {
      if (Math.hypot(prog.px-b.x, prog.py-b.y) < INTERACT_R) {
        if (b.type==="market")  return "Tap your Market — sell the harvest";
        if (b.type==="shelter") return "Tap the Shelter — stores · transfer to ship · sleep";
      }
    }
    for (const n of world.nodes) {
      if (prog.harvested[n.id]) continue;
      if (Math.hypot(prog.px-n.x, prog.py-n.y) < INTERACT_R) {
        const res = n.type==="tree"?"wood":n.type==="rock"?"stone":"berry";
        const bonus = (n.type==="tree"&&prog.buildings.some(b=>b.type==="sawmill"))||
                      (n.type==="rock"&&prog.buildings.some(b=>b.type==="quarry")) ? " (+bonus)" : "";
        return `E: Harvest ${res}${bonus}`;
      }
    }
    if (prog.tool==='till')  return "TILL: tap grass to prepare soil";
    if (prog.tool==='plant') return `PLANT ${SEED_BY[prog.selSeed]?.emoji||''}: tap tilled soil (pick a seed below)`;
    if (prog.tool==='water') return "WATER: tap a crop to water · tap water/well to refill can";
    if (prog.tool==='build') return prog.selBuildKey ? `BUILD: tap a spot to place ${BT_BY[prog.selBuildKey]?.name}` : "BUILD: pick a building below · tap yours to destroy";
    return "Tap to walk · tap to harvest/use · use the tools below";
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  MOBILE TOOL UI  — bottom toolbar + contextual strips + market menu.
  //  Layout is computed once (computeUI) and shared by draw + hit-test so the
  //  tap targets always match what's drawn.
  // ════════════════════════════════════════════════════════════════════════════
  const TOOLS = [
    { key:'action', name:'Action', emoji:'✋' },
    { key:'till',   name:'Till',   emoji:'🪏' },
    { key:'plant',  name:'Plant',  emoji:'🌱' },
    { key:'water',  name:'Water',  emoji:'💧' },
    { key:'build',  name:'Build',  emoji:'🔨' },
  ];
  const SELL_PRICE   = { wood:6, stone:9, berry:5 };
  const BERRY_UP_COST = [50, 120];   // berry-upgrade cost for level 0→1, 1→2

  const HINT_H = 28, TB_H = 54, SUB_H = 46;

  // yield multipliers from levelled buildings / upgrades
  function bLevel(prog, key){ const b=prog.buildings.find(x=>x.type===key); return b?(b.level||1):0; }
  function woodMult(prog){ const l=bLevel(prog,'sawmill'); return l?l+1:1; }   // L1→2×, L2→3×
  function stoneMult(prog){ const l=bLevel(prog,'quarry');  return l?l+1:1; }
  function berryMult(prog){ return 1 + (prog.upgrades?.berry||0); }
  function hasBuilding(prog, key){ return prog.buildings.some(b=>b.type===key); }
  function canAfford(inv, cost){ return Object.entries(cost).every(([k,v])=>(inv[k]||0)>=v); }
  function payCost(inv, cost){ for (const [k,v] of Object.entries(cost)) inv[k]=(inv[k]||0)-v; }
  function costStr(cost){ return Object.entries(cost).map(([k,v])=>`${v}${k[0].toUpperCase()}`).join('+'); }

  // is (tx,ty) a bare grass tile with nothing on it? (for till / build placement)
  function tileFree(prog, world, tx, ty){
    if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) return false;
    if (world.tiles[ty*MAP_W+tx] !== T_GRASS) return false;
    const key=`${tx},${ty}`;
    if (prog.buildings.some(b=>Math.floor(b.x)===tx&&Math.floor(b.y)===ty)) return false;
    if ((world.cityBuildings||[]).some(b=>b.x===tx&&b.y===ty)) return false;
    if (world.nodes.some(n=>!prog.harvested[n.id]&&n.x===tx&&n.y===ty)) return false;
    return true;
  }

  // Build the interactive-UI layout for the current tool/menu state.
  function computeUI(s, prog, pKey, W, H){
    const pdef = planetDef(pKey);
    const tbY = H - HINT_H - TB_H;
    // Riding the Rover: swap the farming toolbar for one big tap-to-exit button
    // (mobile has no "E" key — this is the only way off-keyboard players can park).
    if (prog.inCar) {
      const toolbar = [{ key:'exit_car', name:'Exit Rover', emoji:'🚪', x:0, y:tbY, w:W, h:TB_H }];
      return { toolbar, sub:null, subKind:null, market:null, tbY };
    }
    const bw = W / TOOLS.length;
    const toolbar = TOOLS.map((t,i)=>({ ...t, x:i*bw, y:tbY, w:bw, h:TB_H }));
    let sub = null, subKind = null;
    if (prog.tool==='build') {
      subKind='build';
      const iw = W / BTYPES.length;
      sub = BTYPES.map((b,i)=>({ key:b.key, def:b, x:i*iw, y:tbY-SUB_H, w:iw, h:SUB_H }));
    } else if (prog.tool==='plant') {
      // seed strip shows only crops that GROW here (native to this planet)
      subKind='seed';
      const native = SEED_TYPES.filter(c=>pdef.crops.includes(c.key));
      const iw = W / Math.max(1, native.length);
      sub = native.map((c,i)=>({ key:c.key, def:c, x:i*iw, y:tbY-SUB_H, w:iw, h:SUB_H }));
    }
    const market = prog._marketOpen ? computeMarketUI(s, prog, pKey, W, H) : null;
    return { toolbar, sub, subKind, market, tbY };
  }

  function computeMarketUI(s, prog, pKey, W, H){
    const pdef = planetDef(pKey);
    const pw = Math.min(330, W-16), ph = Math.min(460, H-70);
    const px = (W-pw)/2, py = (H-ph)/2 - 6;
    const tabsKeys = [['sell','SELL'],['seeds','SEEDS'],['upgrades','UPGRADES']];
    const tabs = tabsKeys.map(([k,l],i)=>({ key:k, label:l, x:px+i*(pw/3), y:py+34, w:pw/3, h:30 }));
    const close = { x:px+pw-34, y:py+6, w:28, h:24 };
    const rows = [];
    const rowY0 = py+78, rh = 42, btnW = 96;
    const tab = prog._marketTab || 'sell';
    let items = [];
    if (tab==='sell') {
      // planet goods + native harvest from the local stores…
      items = [
        { key:'wood',  label:'🪵 Wood',   price:SELL_PRICE.wood,  src:'inv' },
        { key:'stone', label:'⛏ Stone',  price:SELL_PRICE.stone, src:'inv' },
        { key:'berry', label:`${pdef.berry||'🫐'} Berry`, price:SELL_PRICE.berry, src:'inv' },
        ...SEED_TYPES.filter(c=>(prog.inv[c.key]||0)>0).map(c=>({
          key:c.key, label:`${c.emoji} ${c.name}`, price:c.sellEach, src:'inv' })),
        // …plus SHIP CARGO — foreign crops fetch the ×3 EXPORT price here
        ...SEED_TYPES.filter(c=>((s.planetCargo||{})[c.key]||0)>0).map(c=>{
          const exp = c.home !== pKey;
          return { key:c.key, label:`${c.emoji} ${c.name} 🚀`, src:'cargo', exp,
                   price: c.sellEach * (exp ? EXPORT_MULT : 1) };
        }),
        // bulk materials from shelter load (low value, anywhere)
        ...['wood','stone','berry'].filter(k=>((s.planetCargo||{})[k]||0)>0).map(k=>({
          key:k, label:(k==='wood'?'🪵 Wood':k==='stone'?'⛏ Stone':'🫐 Berry')+' 🚀',
          src:'cargo', exp:false, price: Math.max(1, (SELL_PRICE[k]||1)), bulk:true,
        })),
      ].slice(0, 10);
    } else if (tab==='seeds') {
      // a guild only sells its OWN planet's seeds — fly to find the rest
      items = SEED_TYPES.filter(c=>pdef.crops.includes(c.key))
        .map(c=>({ key:c.key, label:`${c.emoji} ${c.name} seed`, price:c.seedCost }));
    } else {
      items = [
        { key:'berryyield', label:`${pdef.berry||'🫐'} Berry Cultivation` },
        { key:'berryspeed', label:'🧺 Faster Picking' },
      ];
    }
    items.forEach((it,i)=>{
      const y = rowY0 + i*rh;
      rows.push({ ...it, tab, x:px+12, y, w:pw-24, h:rh-6,
        btn:{ x:px+pw-12-btnW, y:y+4, w:btnW, h:rh-14 } });
    });
    return { panel:{x:px,y:py,w:pw,h:ph}, tabs, close, rows, pKey };
  }

  // Draw the whole mobile UI (called at the end of draw()).
  function drawUI(g, s, prog, pKey, W, H){
    if (HEADLESS) return;
    const ui = computeUI(s, prog, pKey, W, H);
    const rr = (x,y,w,h,r)=>{ if (g.roundRect){ g.beginPath(); g.roundRect(x,y,w,h,r);} else { g.beginPath(); g.rect(x,y,w,h);} };

    // ── contextual strip (seed picker / build list) ─────────────────────────
    if (ui.sub) {
      g.fillStyle='rgba(2,4,16,0.92)'; rr(ui.sub[0].x, ui.sub[0].y, W, SUB_H, 0); g.fill();
      for (const it of ui.sub) {
        const owned = ui.subKind==='build' ? hasBuilding(prog, it.key) : false;
        const armed = ui.subKind==='build' ? prog.selBuildKey===it.key : prog.selSeed===it.key;
        const cnt   = ui.subKind==='seed' ? ((s.seedBag||{})[it.key]||0) : 0;
        g.save();
        if (armed){ g.fillStyle='rgba(0,255,238,0.14)'; g.fillRect(it.x+2,it.y+2,it.w-4,it.h-4); }
        g.textAlign='center';
        g.font='16px sans-serif';
        g.globalAlpha = (ui.subKind==='seed' && cnt<=0) ? 0.4 : 1;
        g.fillStyle='#fff';
        g.fillText(it.def.emoji, it.x+it.w/2, it.y+20);
        g.font='bold 8px monospace';
        g.fillStyle = armed ? '#00FFEE' : (owned ? '#FFB000' : '#9fb4c8');
        const label = ui.subKind==='build'
          ? (owned ? (it.def.up ? 'OWNED·UPG' : 'OWNED') : costStr(it.def.cost))
          : `${it.def.name} ×${cnt}`;
        g.fillText(label, it.x+it.w/2, it.y+34);
        g.restore();
        g.strokeStyle='rgba(0,180,255,0.12)'; g.lineWidth=0.6; g.strokeRect(it.x, it.y, it.w, it.h);
      }
    }

    // ── toolbar ─────────────────────────────────────────────────────────────
    g.fillStyle='rgba(2,4,16,0.94)'; g.fillRect(0, ui.tbY, W, TB_H);
    g.strokeStyle='rgba(0,220,255,0.25)'; g.lineWidth=0.8;
    g.beginPath(); g.moveTo(0,ui.tbY); g.lineTo(W,ui.tbY); g.stroke();
    for (const b of ui.toolbar) {
      const isExit = b.key==='exit_car';
      const active = prog.tool===b.key;
      if (isExit){ g.fillStyle='rgba(255,120,40,0.20)'; g.fillRect(b.x+2, b.y+2, b.w-4, b.h-4);
        g.strokeStyle='#FF7828'; g.lineWidth=1.2; g.strokeRect(b.x+2, b.y+2, b.w-4, b.h-4); }
      else if (active){ g.fillStyle='rgba(0,255,238,0.16)'; g.fillRect(b.x+2, b.y+2, b.w-4, b.h-4);
        g.strokeStyle='#00FFEE'; g.lineWidth=1.2; g.strokeRect(b.x+2, b.y+2, b.w-4, b.h-4); }
      g.textAlign='center';
      g.font='19px sans-serif'; g.fillStyle='#fff';
      g.fillText(b.emoji, b.x+b.w/2, b.y+26);
      g.font='bold 8.5px monospace'; g.fillStyle = isExit ? '#FF9955' : active ? '#00FFEE' : '#8fa6ba';
      g.fillText(b.name.toUpperCase(), b.x+b.w/2, b.y+42);
      // water tool shows the can fill level
      if (b.key==='water'){
        g.font='7px monospace'; g.fillStyle='#3ec6ff';
        g.fillText(`${prog.water.fill}/${prog.water.max}`, b.x+b.w/2, b.y+51);
      }
    }

    // ── menu overlays ────────────────────────────────────────────────────────
    if (ui.market) drawMarket(g, s, prog, ui.market, W, H);
    if (prog._bldgOpen) drawBldg(g, s, prog, computeBldgUI(prog, prog._bldgOpen, W, H), W, H);
    if (prog._shelterOpen) drawShelter(g, s, prog, computeShelterUI(s, prog, pKey, W, H), W, H);
    if (prog._hallOpen) drawHall(g, s, prog, computeHallUI(s, prog, pKey, W, H), W, H);
  }

  function drawMarket(g, s, prog, m, W, H){
    const rr = (x,y,w,h,r)=>{ if (g.roundRect){ g.beginPath(); g.roundRect(x,y,w,h,r);} else { g.beginPath(); g.rect(x,y,w,h);} };
    // dim behind
    g.fillStyle='rgba(0,0,6,0.6)'; g.fillRect(0,0,W,H);
    // panel
    g.save(); g.shadowColor='#3CA03C'; g.shadowBlur=16;
    g.fillStyle='rgba(8,10,6,0.98)'; rr(m.panel.x,m.panel.y,m.panel.w,m.panel.h,6); g.fill();
    g.restore();
    g.strokeStyle='#3CA03C'; g.lineWidth=1; rr(m.panel.x,m.panel.y,m.panel.w,m.panel.h,6); g.stroke();
    // title — this guild, this planet
    g.fillStyle='#8FDC6A'; g.font='bold 13px monospace'; g.textAlign='left';
    g.fillText(`◈ ${planetDef(m.pKey).name.toUpperCase()} TRADE GUILD`, m.panel.x+14, m.panel.y+22);
    g.fillStyle='#FFEE00'; g.font='bold 11px monospace'; g.textAlign='right';
    g.fillText(`${s.credits||0} ₡`, m.panel.x+m.panel.w-44, m.panel.y+22);
    // close
    g.fillStyle='rgba(255,80,120,0.25)'; rr(m.close.x,m.close.y,m.close.w,m.close.h,4); g.fill();
    g.fillStyle='#fff'; g.font='bold 13px monospace'; g.textAlign='center';
    g.fillText('✕', m.close.x+m.close.w/2, m.close.y+m.close.h/2+5);
    // tabs
    for (const t of m.tabs) {
      const on = (prog._marketTab||'sell')===t.key;
      g.fillStyle = on ? 'rgba(255,0,136,0.22)' : 'rgba(255,255,255,0.05)';
      rr(t.x+2,t.y,t.w-4,t.h,4); g.fill();
      g.fillStyle = on ? '#FF66AA' : '#8fa6ba'; g.font='bold 10px monospace'; g.textAlign='center';
      g.fillText(t.label, t.x+t.w/2, t.y+t.h/2+4);
    }
    // rows
    for (const row of m.rows) {
      g.fillStyle='rgba(255,255,255,0.04)'; rr(row.x,row.y,row.w,row.h,4); g.fill();
      g.fillStyle='#dce8f4'; g.font='11px sans-serif'; g.textAlign='left';
      g.fillText(row.label, row.x+10, row.y+row.h/2+1);
      // qty / detail
      let detail='', btnLabel='', enabled=true;
      if (row.tab==='sell'){
        const have = row.src==='cargo' ? ((s.planetCargo||{})[row.key]||0) : (prog.inv[row.key]||0);
        detail = row.src==='cargo'
          ? (row.exp ? `×${have} in ship · EXPORT ×${EXPORT_MULT}!` : `×${have} in ship`)
          : `×${have}`;
        btnLabel=`SELL +${row.price*Math.max(1,have)}`; enabled=have>0;
      }
      else if (row.tab==='seeds'){ detail=`${(s.seedBag||{})[row.key]||0} owned`; btnLabel=`BUY×3 ${row.price*3}₡`; enabled=(s.credits||0)>=row.price*3; }
      else if (row.key==='berryyield'){ const lvl=prog.upgrades.berry||0; const maxed=lvl>=BERRY_UP_COST.length; detail=`Lv ${lvl} → berries ×${lvl+1}`; btnLabel = maxed?'MAX':`BUY ${BERRY_UP_COST[lvl]}₡`; enabled=!maxed && (s.credits||0)>=BERRY_UP_COST[lvl]; }
      else { const lvl=prog.speed.berry||0; const mx=SPEED_MAX.berry; const maxed=lvl>=mx; const cost=SPEED_COST.berry[lvl]; detail=`Lv ${lvl} → ${Math.max(1,BASE_HITS.berry-lvl)} taps`; btnLabel = maxed?'MAX':`BUY ${cost}₡`; enabled=!maxed && (s.credits||0)>=cost; }
      g.fillStyle = row.exp ? '#FFD24A' : '#7f93a6'; g.font='9px monospace'; g.textAlign='left';
      g.fillText(detail, row.x+10, row.y+row.h-4);
      // button
      g.fillStyle = enabled ? 'rgba(0,255,136,0.22)' : 'rgba(120,120,140,0.14)';
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.fill();
      g.strokeStyle = enabled ? '#00FF88' : 'rgba(140,140,160,0.3)'; g.lineWidth=0.8;
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.stroke();
      g.fillStyle = enabled ? '#aaffcc' : '#788'; g.font='bold 9px monospace'; g.textAlign='center';
      g.fillText(btnLabel, row.btn.x+row.btn.w/2, row.btn.y+row.btn.h/2+3);
    }
  }

  // Handle a tap on the UI. Returns true if the tap was consumed by the UI.
  function hitUI(sx, sy, prog, world, s, pKey){
    const W=CONFIG.W, H=CONFIG.H;
    const inRect = (r)=> r && sx>=r.x && sx<=r.x+r.w && sy>=r.y && sy<=r.y+r.h;
    const ui = computeUI(s, prog, pKey, W, H);

    if (inRect(saveBtnRect(W))){ GAME.saveAtBerth(); return true; }

    // Sawmill / Quarry upgrade menu eats all taps while open
    if (prog._bldgOpen){
      const b = computeBldgUI(prog, prog._bldgOpen, W, H);
      if (inRect(b.close)){ prog._bldgOpen=null; sfx('drop'); return true; }
      for (const row of b.rows) if (inRect(row.btn)){ bldgTransact(s, prog, b.kind, row.kind); return true; }
      return true;
    }

    // Shelter management menu (inventory / transfer / sleep)
    if (prog._shelterOpen){
      const sh = computeShelterUI(s, prog, pKey, W, H);
      if (inRect(sh.close)){ prog._shelterOpen=false; sfx('drop'); return true; }
      for (const row of sh.rows) if (row.btn && inRect(row.btn)){ shelterTransact(s, prog, pKey, row); return true; }
      return true;
    }

    // City Hall jobs board
    if (prog._hallOpen){
      const hl = computeHallUI(s, prog, pKey, W, H);
      if (inRect(hl.close)){ prog._hallOpen=false; sfx('drop'); return true; }
      for (const row of hl.rows) if (row.btn && inRect(row.btn)){ hallTransact(s, prog, pKey, row); return true; }
      return true;
    }

    // Market menu eats all taps while open
    if (ui.market){
      const m = ui.market;
      if (inRect(m.close)){ prog._marketOpen=false; sfx('drop'); return true; }
      for (const t of m.tabs) if (inRect(t)){ prog._marketTab=t.key; sfx('drop'); return true; }
      for (const row of m.rows) if (inRect(row.btn)){ marketTransact(s, prog, pKey, row); return true; }
      return true;   // tap inside/around the panel — swallow so world isn't tapped
    }

    // Contextual strip
    if (ui.sub){
      for (const it of ui.sub){
        if (inRect(it)){
          if (ui.subKind==='seed'){ prog.selSeed=it.key; sfx('drop'); }
          else { // build list
            if (hasBuilding(prog, it.key)){ toast(`${it.def.name} already built — tap it in the world to ${it.def.up?'upgrade':'use'} / destroy`, '#ffcf5a'); }
            else { prog.selBuildKey = (prog.selBuildKey===it.key? null : it.key); sfx('drop'); }
          }
          return true;
        }
      }
    }

    // Toolbar
    for (const b of ui.toolbar){
      if (inRect(b)){
        if (b.key==='exit_car'){ input.dock = true; sfx('drop'); return true; }
        prog.tool = b.key;
        if (b.key!=='build') prog.selBuildKey=null;
        sfx('drop');
        return true;
      }
    }
    return false;
  }

  function marketTransact(s, prog, pKey, row){
    ensureShipState(s);
    const inv = prog.inv;
    if (row.tab==='sell'){
      if (row.src==='cargo'){
        // selling from the SHIP hold — foreign crops earn the export premium
        const have = s.planetCargo[row.key]||0;
        if (have<=0){ toast('Cargo hold is empty of those', '#888'); return; }
        const earn = row.price*have; s.planetCargo[row.key]=0; s.credits+=earn;
        if (row.exp) questOnExport(s, pKey, row.key, have);
        const nm = SEED_BY[row.key] ? SEED_BY[row.key].name
          : (row.key==='wood'?'Wood':row.key==='stone'?'Stone':row.key==='berry'?'Berry':row.key);
        toast(row.exp ? `EXPORT! Sold ${have} ${nm} → +${earn}₡ (×${EXPORT_MULT})`
                      : `Sold ${have} ${nm} → +${earn}₡`,
              row.exp ? '#FFD24A' : '#ffd060');
        sfx('buy'); return;
      }
      const have = inv[row.key]||0;
      if (have<=0){ toast('Nothing to sell', '#888'); return; }
      const earn = row.price*have; inv[row.key]=0; s.credits+=earn;
      toast(`Sold ${have} ${SEED_BY[row.key]?SEED_BY[row.key].name:row.key} → +${earn}₡`, '#ffd060'); sfx('buy');
    } else if (row.tab==='seeds'){
      const cost = row.price*3;
      if (s.credits<cost){ toast('Not enough credits', '#ff9a3c'); return; }
      s.credits-=cost; s.seedBag[row.key]=(s.seedBag[row.key]||0)+3;
      toast(`Bought 3 ${SEED_BY[row.key].name} seeds — they travel with your ship`, '#80ff80'); sfx('buy');
    } else if (row.key==='berryyield'){
      const lvl = prog.upgrades.berry||0;
      if (lvl>=BERRY_UP_COST.length){ toast('Berry cultivation maxed', '#888'); return; }
      const cost = BERRY_UP_COST[lvl];
      if (s.credits<cost){ toast('Not enough credits', '#ff9a3c'); return; }
      s.credits-=cost; prog.upgrades.berry=lvl+1;
      toast(`Berry Cultivation Lv ${lvl+1} — berries ×${lvl+2}`, '#FF44AA'); sfx('buy');
    } else {   // berryspeed
      const lvl = prog.speed.berry||0;
      if (lvl>=SPEED_MAX.berry){ toast('Berry picking maxed', '#888'); return; }
      const cost = SPEED_COST.berry[lvl];
      if (s.credits<cost){ toast('Not enough credits', '#ff9a3c'); return; }
      s.credits-=cost; prog.speed.berry=lvl+1;
      toast(`Faster Picking — berries now ${Math.max(1,BASE_HITS.berry-prog.speed.berry)} taps`, '#3ec6ff'); sfx('buy');
    }
  }

  // ── sawmill / quarry upgrade menu (yield via resources, speed via credits) ──
  function computeBldgUI(prog, kind, W, H){
    const res = kind==='sawmill' ? 'wood' : 'stone';
    const pw = Math.min(320, W-16), ph = 214;
    const px = (W-pw)/2, py = (H-ph)/2 - 6;
    const close = { x:px+pw-34, y:py+6, w:28, h:24 };
    const rowY0 = py+56, rh = 58, btnW = 96;
    const rows = [
      { kind:'yield', res, x:px+12, y:rowY0,      w:pw-24, h:rh-8, btn:{ x:px+pw-12-btnW, y:rowY0+14,      w:btnW, h:30 } },
      { kind:'speed', res, x:px+12, y:rowY0+rh,   w:pw-24, h:rh-8, btn:{ x:px+pw-12-btnW, y:rowY0+rh+14,   w:btnW, h:30 } },
    ];
    return { kind, res, panel:{x:px,y:py,w:pw,h:ph}, close, rows,
             title: kind==='sawmill' ? '🪚 SAWMILL' : '⛏ QUARRY' };
  }

  function drawBldg(g, s, prog, b, W, H){
    const rr = (x,y,w,h,r)=>{ if (g.roundRect){ g.beginPath(); g.roundRect(x,y,w,h,r);} else { g.beginPath(); g.rect(x,y,w,h);} };
    g.fillStyle='rgba(0,0,6,0.6)'; g.fillRect(0,0,W,H);
    g.fillStyle='rgba(4,6,14,0.98)'; rr(b.panel.x,b.panel.y,b.panel.w,b.panel.h,6); g.fill();
    g.strokeStyle='#00FFAA'; g.lineWidth=1; rr(b.panel.x,b.panel.y,b.panel.w,b.panel.h,6); g.stroke();
    g.fillStyle='#00FFAA'; g.font='bold 13px monospace'; g.textAlign='left';
    g.fillText(b.title, b.panel.x+14, b.panel.y+24);
    g.fillStyle='#FFEE00'; g.font='bold 11px monospace'; g.textAlign='right';
    g.fillText(`${s.credits||0} ₡`, b.panel.x+b.panel.w-44, b.panel.y+24);
    g.fillStyle='rgba(255,80,120,0.25)'; rr(b.close.x,b.close.y,b.close.w,b.close.h,4); g.fill();
    g.fillStyle='#fff'; g.font='bold 13px monospace'; g.textAlign='center';
    g.fillText('✕', b.close.x+b.close.w/2, b.close.y+b.close.h/2+5);

    const bld = prog.buildings.find(x=>x.type===b.kind), def=BT_BY[b.kind];
    for (const row of b.rows){
      g.fillStyle='rgba(255,255,255,0.04)'; rr(row.x,row.y,row.w,row.h,4); g.fill();
      let title2='', detail='', btnLabel='', enabled=true;
      if (row.kind==='yield'){
        const lvl=bld?bld.level:1, maxed=lvl>=def.maxLvl;
        title2 = `Yield  ·  ${b.res} ×${lvl+1}`;
        detail = maxed ? 'maxed' : `→ Lv ${lvl+1}: ${b.res} ×${lvl+2}  (${costStr(def.up)})`;
        btnLabel = maxed ? 'MAX' : 'UPGRADE';
        enabled = !maxed && canAfford(prog.inv, def.up);
      } else {
        const lvl=prog.speed[b.res]||0, mx=SPEED_MAX[b.res], maxed=lvl>=mx, cost=SPEED_COST[b.res][lvl];
        title2 = `Speed  ·  ${Math.max(1,BASE_HITS[b.kind==='sawmill'?'tree':'rock']-lvl)} taps to harvest`;
        detail = maxed ? 'maxed' : `→ ${Math.max(1,BASE_HITS[b.kind==='sawmill'?'tree':'rock']-lvl-1)} taps  (${cost}₡)`;
        btnLabel = maxed ? 'MAX' : 'BUY';
        enabled = !maxed && (s.credits||0)>=cost;
      }
      g.fillStyle='#dce8f4'; g.font='bold 11px sans-serif'; g.textAlign='left';
      g.fillText(title2, row.x+10, row.y+20);
      g.fillStyle='#7f93a6'; g.font='9px monospace';
      g.fillText(detail, row.x+10, row.y+38);
      g.fillStyle = enabled ? 'rgba(0,255,136,0.22)' : 'rgba(120,120,140,0.14)';
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.fill();
      g.strokeStyle = enabled ? '#00FF88' : 'rgba(140,140,160,0.3)'; g.lineWidth=0.8;
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.stroke();
      g.fillStyle = enabled ? '#aaffcc' : '#788'; g.font='bold 9px monospace'; g.textAlign='center';
      g.fillText(btnLabel, row.btn.x+row.btn.w/2, row.btn.y+row.btn.h/2+3);
    }
  }

  function bldgTransact(s, prog, kind, rowKind){
    const def = BT_BY[kind], res = kind==='sawmill'?'wood':'stone';
    if (rowKind==='yield'){
      const bld = prog.buildings.find(x=>x.type===kind); if (!bld) return;
      if (bld.level>=def.maxLvl){ toast('Already max level', '#888'); return; }
      if (!canAfford(prog.inv, def.up)){ toast('Upgrade needs '+costStr(def.up), '#ff9a3c'); return; }
      payCost(prog.inv, def.up); bld.level++;
      toast(`${def.name} → Lv ${bld.level}: ${res} ×${bld.level+1}`, '#80ff80'); sfx('buy');
    } else {
      const lvl = prog.speed[res]||0;
      if (lvl>=SPEED_MAX[res]){ toast('Already max speed', '#888'); return; }
      const cost = SPEED_COST[res][lvl];
      if ((s.credits||0)<cost){ toast('Not enough credits', '#ff9a3c'); return; }
      s.credits-=cost; prog.speed[res]=lvl+1;
      const hitType = kind==='sawmill'?'tree':'rock';
      toast(`Faster — ${res} now ${Math.max(1,BASE_HITS[hitType]-prog.speed[res])} taps`, '#3ec6ff'); sfx('buy');
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SHELTER — on-planet player management. Your homestead HQ: review the planet
  //  stores, TRANSFER harvest to the ship's cargo hold (that's how goods leave a
  //  planet), and SLEEP to advance the turn.
  // ════════════════════════════════════════════════════════════════════════════
  function computeShelterUI(s, prog, pKey, W, H){
    ensureShipState(s);
    const pdef = planetDef(pKey);
    const items = [];
    // planet-side stores: resources are info-only, crops are transferable
    for (const [k,lab] of [['wood','🪵 Wood'],['stone','⛏ Stone'],['berry',`${pdef.berry||'🫐'} Berry`]])
      if ((prog.inv[k]||0)>0) items.push({ key:k, label:lab, qty:prog.inv[k], kind:'res', loadable:true });
    for (const c of SEED_TYPES) if ((prog.inv[c.key]||0)>0)
      items.push({ key:c.key, label:`${c.emoji} ${c.name}`, qty:prog.inv[c.key], kind:'crop' });
    const pw = Math.min(330, W-16);
    const rh = 40, listH = Math.max(1,items.length)*rh;
    const ph = Math.min(H-70, 148 + listH);
    const px = (W-pw)/2, py = (H-ph)/2 - 6;
    const close = { x:px+pw-34, y:py+6, w:28, h:24 };
    const rows = [];
    let y = py+62;
    if (!items.length) rows.push({ kind:'empty', x:px+12, y, w:pw-24, h:rh-6 });
    for (const it of items){
      rows.push({ ...it, x:px+12, y, w:pw-24, h:rh-6,
        btn: (it.kind==='crop' || it.kind==='res') ? { x:px+pw-12-96, y:y+5, w:96, h:26 } : null });
      y += rh;
    }
    // sleep is the big button at the bottom
    rows.push({ kind:'sleep', x:px+12, y:py+ph-56, w:pw-24, h:44,
      btn:{ x:px+12, y:py+ph-56, w:pw-24, h:44 } });
    return { panel:{x:px,y:py,w:pw,h:ph}, close, rows, pKey };
  }

  function drawShelter(g, s, prog, sh, W, H){
    const rr = (x,y,w,h,r)=>{ if (g.roundRect){ g.beginPath(); g.roundRect(x,y,w,h,r);} else { g.beginPath(); g.rect(x,y,w,h);} };
    g.fillStyle='rgba(0,0,6,0.6)'; g.fillRect(0,0,W,H);
    g.fillStyle='rgba(10,8,4,0.98)'; rr(sh.panel.x,sh.panel.y,sh.panel.w,sh.panel.h,6); g.fill();
    g.strokeStyle='#D8A44A'; g.lineWidth=1; rr(sh.panel.x,sh.panel.y,sh.panel.w,sh.panel.h,6); g.stroke();
    g.fillStyle='#F0C878'; g.font='bold 13px monospace'; g.textAlign='left';
    g.fillText('⛺ SHELTER — HOMESTEAD', sh.panel.x+14, sh.panel.y+22);
    // cargo-hold summary line
    const cargoN = SEED_TYPES.reduce((n,c)=>n+((s.planetCargo||{})[c.key]||0),0);
    g.fillStyle='#9fb4c8'; g.font='9px monospace';
    g.fillText(`Ship hold: ${cargoN} crops aboard 🚀`, sh.panel.x+14, sh.panel.y+40);
    g.fillStyle='rgba(255,80,120,0.25)'; rr(sh.close.x,sh.close.y,sh.close.w,sh.close.h,4); g.fill();
    g.fillStyle='#fff'; g.font='bold 13px monospace'; g.textAlign='center';
    g.fillText('✕', sh.close.x+sh.close.w/2, sh.close.y+sh.close.h/2+5);
    for (const row of sh.rows){
      if (row.kind==='sleep'){
        g.save(); g.fillStyle='rgba(150,110,255,0.22)'; rr(row.x,row.y,row.w,row.h,6); g.fill();
        g.strokeStyle='#AA88FF'; g.lineWidth=1; rr(row.x,row.y,row.w,row.h,6); g.stroke();
        g.fillStyle='#D8C8FF'; g.font='bold 12px monospace'; g.textAlign='center';
        g.fillText(`😴 SLEEP  ·  next turn (${_season.tick}/${SLEEPS_PER_SEASON} ${SEASON_NAMES[_season.idx]})`, row.x+row.w/2, row.y+row.h/2+4);
        g.restore(); continue;
      }
      if (row.kind==='empty'){
        g.fillStyle='#7f93a6'; g.font='10px sans-serif'; g.textAlign='left';
        g.fillText('Stores are empty — harvest resources and crops first.', row.x+4, row.y+18);
        continue;
      }
      g.fillStyle='rgba(255,255,255,0.04)'; rr(row.x,row.y,row.w,row.h,4); g.fill();
      g.fillStyle='#dce8f4'; g.font='11px sans-serif'; g.textAlign='left';
      g.fillText(`${row.label}  ×${row.qty}`, row.x+10, row.y+row.h/2+4);
      if (row.btn){
        g.fillStyle='rgba(80,160,255,0.22)'; rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.fill();
        g.strokeStyle='#5AA0FF'; g.lineWidth=0.8; rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.stroke();
        g.fillStyle='#BBD8FF'; g.font='bold 9px monospace'; g.textAlign='center';
        g.fillText('→ SHIP 🚀', row.btn.x+row.btn.w/2, row.btn.y+row.btn.h/2+3);
      } else {
        g.fillStyle='#66788a'; g.font='8px monospace'; g.textAlign='right';
        g.fillText('planet stores', row.x+row.w-8, row.y+row.h/2+3);
      }
    }
  }

  function shelterTransact(s, prog, pKey, row){
    ensureShipState(s);
    if (row.kind==='sleep'){
      prog.harvested={}; prog.cooldowns={};
      const r = advanceSleep(prog, s);
      prog._shelterOpen = false;
      toast(`Slept — ${r.season} (sleep ${r.sleep}/${SLEEPS_PER_SEASON}), ${r.weather}. Resources regrown.`, "#c0e0ff");
      sfx('buy'); return;
    }
    if (row.kind==='crop'){
      const n = prog.inv[row.key]||0;
      if (n<=0) return;
      prog.inv[row.key]=0;
      s.planetCargo[row.key]=(s.planetCargo[row.key]||0)+n;
      const c = SEED_BY[row.key];
      toast(`Loaded ${n} ${c.name} ${c.emoji} into the ship — sell off-world for ×${EXPORT_MULT}!`, '#BBD8FF');
      sfx('buy');
    }
    if (row.kind==='res'){
      // bulk materials can board as ship cargo (sell at guild as low-value bulk)
      const n = prog.inv[row.key]||0;
      if (n<=0) return;
      prog.inv[row.key]=0;
      s.planetCargo[row.key]=(s.planetCargo[row.key]||0)+n;
      const lab = row.key==='wood'?'🪵 Wood':row.key==='stone'?'⛏ Stone':'🫐 Berry';
      toast(`Loaded ${n} ${lab} as bulk cargo`, '#BBD8FF');
      sfx('buy');
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  QUESTS — City Hall jobs board. Three shapes:
  //   export : sell N of a native crop at another planet's guild, come back
  //   seeds  : fetch N foreign seeds from their home guild, deliver them here
  //   gather : collect N wood/stone/berry on this planet
  // ════════════════════════════════════════════════════════════════════════════
  const QUEST_MAX_ACTIVE = 3;
  function otherPlanets(pKey){ return Object.keys(PLANET_DEFS).filter(k=>k!==pKey); }

  function genQuestOffers(s, pKey){
    ensureShipState(s);
    const qs = s.questState;
    if (!qs.offers[pKey] || !qs.offers[pKey].length){
      const pdef = planetDef(pKey), offers = [];
      // 1) export run: our produce → a random neighbour
      {
        const crop = SEED_BY[pdef.crops[Math.floor(Math.random()*pdef.crops.length)]];
        const dest = otherPlanets(pKey)[Math.floor(Math.random()*4)];
        const qty = 4 + Math.floor(Math.random()*4);
        offers.push({ id:'q'+(qs.nextId++), from:pKey, type:'export', crop:crop.key, qty, dest,
          reward:{ credits: qty*crop.sellEach*4 }, progress:0,
          title:`Export ${qty} ${crop.emoji} ${crop.name}`,
          desc:`Sell ${qty} ${crop.name} at the ${planetDef(dest).name} guild, then report back.` });
      }
      // 2) seed fetch: bring back foreign seeds
      {
        const fKey = otherPlanets(pKey)[Math.floor(Math.random()*4)];
        const fdef = planetDef(fKey);
        const crop = SEED_BY[fdef.crops[Math.floor(Math.random()*fdef.crops.length)]];
        const qty = 3;
        offers.push({ id:'q'+(qs.nextId++), from:pKey, type:'seeds', crop:crop.key, qty,
          reward:{ credits: 90 + crop.seedCost*qty*2 }, progress:0,
          title:`Fetch ${qty} ${crop.emoji} ${crop.name} seeds`,
          desc:`Buy ${qty} ${crop.name} seeds on ${fdef.name} and deliver them here.` });
      }
      // 3) gather: local labour
      {
        const res = ['wood','stone','berry'][Math.floor(Math.random()*3)];
        const qty = 8 + Math.floor(Math.random()*6);
        offers.push({ id:'q'+(qs.nextId++), from:pKey, type:'gather', res, qty,
          reward:{ credits: qty*SELL_PRICE[res]*2 }, progress:0,
          title:`Gather ${qty} ${res==='wood'?'🪵':res==='stone'?'⛏':'🫐'} ${res}`,
          desc:`Deliver ${qty} ${res} from ${pdef.name}'s wilds to City Hall.` });
      }
      qs.offers[pKey] = offers;
    }
    return qs.offers[pKey];
  }

  // called when foreign crops are export-sold at pKey's guild
  function questOnExport(s, pKey, cropKey, qty){
    for (const q of (s.questState?.active||[])){
      if (q.type==='export' && q.dest===pKey && q.crop===cropKey && q.progress < q.qty){
        q.progress = Math.min(q.qty, q.progress + qty);
        toast(q.progress>=q.qty
          ? `📜 Quest goods delivered! Report to ${planetDef(q.from).name} City Hall`
          : `📜 Quest: ${q.progress}/${q.qty} ${SEED_BY[cropKey].name} delivered`, '#FFD24A');
      }
    }
  }

  function questReady(s, prog, pKey, q){
    if (q.type==='export') return q.progress >= q.qty;
    if (q.type==='seeds')  return ((s.seedBag||{})[q.crop]||0) >= q.qty;
    if (q.type==='gather') return (prog.inv[q.res]||0) >= q.qty;
    return false;
  }

  function computeHallUI(s, prog, pKey, W, H){
    ensureShipState(s);
    const qs = s.questState;
    const offers = genQuestOffers(s, pKey).filter(o=>!qs.active.some(a=>a.id===o.id));
    const mine = qs.active.filter(q=>q.from===pKey);
    const pw = Math.min(334, W-14);
    const rh = 58;
    const n = Math.max(1, offers.length + mine.length);
    const ph = Math.min(H-70, 86 + n*rh);
    const px = (W-pw)/2, py = (H-ph)/2 - 6;
    const close = { x:px+pw-34, y:py+6, w:28, h:24 };
    const rows = []; let y = py+56;
    for (const q of mine){
      rows.push({ kind:'active', q, x:px+10, y, w:pw-20, h:rh-8,
        btn:{ x:px+pw-10-92, y:y+14, w:92, h:28 } });
      y += rh;
    }
    for (const q of offers){
      rows.push({ kind:'offer', q, x:px+10, y, w:pw-20, h:rh-8,
        btn:{ x:px+pw-10-92, y:y+14, w:92, h:28 } });
      y += rh;
    }
    return { panel:{x:px,y:py,w:pw,h:ph}, close, rows, pKey };
  }

  function drawHall(g, s, prog, hl, W, H){
    const rr = (x,y,w,h,r)=>{ if (g.roundRect){ g.beginPath(); g.roundRect(x,y,w,h,r);} else { g.beginPath(); g.rect(x,y,w,h);} };
    g.fillStyle='rgba(0,0,6,0.6)'; g.fillRect(0,0,W,H);
    g.fillStyle='rgba(6,8,12,0.98)'; rr(hl.panel.x,hl.panel.y,hl.panel.w,hl.panel.h,6); g.fill();
    g.strokeStyle='#E8D06A'; g.lineWidth=1; rr(hl.panel.x,hl.panel.y,hl.panel.w,hl.panel.h,6); g.stroke();
    g.fillStyle='#F0DC8A'; g.font='bold 13px monospace'; g.textAlign='left';
    g.fillText(`🏛 ${planetDef(hl.pKey).name.toUpperCase()} CITY HALL — JOBS`, hl.panel.x+14, hl.panel.y+22);
    g.fillStyle='#9fb4c8'; g.font='9px monospace';
    g.fillText(`${(s.questState?.active||[]).length}/${QUEST_MAX_ACTIVE} quests active`, hl.panel.x+14, hl.panel.y+38);
    g.fillStyle='rgba(255,80,120,0.25)'; rr(hl.close.x,hl.close.y,hl.close.w,hl.close.h,4); g.fill();
    g.fillStyle='#fff'; g.font='bold 13px monospace'; g.textAlign='center';
    g.fillText('✕', hl.close.x+hl.close.w/2, hl.close.y+hl.close.h/2+5);
    for (const row of hl.rows){
      const q = row.q;
      g.fillStyle = row.kind==='active' ? 'rgba(232,208,106,0.08)' : 'rgba(255,255,255,0.04)';
      rr(row.x,row.y,row.w,row.h,4); g.fill();
      g.fillStyle='#eef4ff'; g.font='bold 11px sans-serif'; g.textAlign='left';
      g.fillText(q.title, row.x+10, row.y+17);
      g.fillStyle='#8fa6ba'; g.font='8.5px sans-serif';
      const desc = q.desc.length>52 ? q.desc.slice(0,51)+'…' : q.desc;
      g.fillText(desc, row.x+10, row.y+31);
      // progress + reward line
      let ptxt = '';
      if (row.kind==='active'){
        if (q.type==='export') ptxt = `${q.progress}/${q.qty} delivered`;
        else if (q.type==='seeds') ptxt = `${(s.seedBag||{})[q.crop]||0}/${q.qty} seeds aboard`;
        else ptxt = `${prog.inv[q.res]||0}/${q.qty} gathered`;
      }
      g.fillStyle='#FFD24A'; g.font='8.5px monospace';
      g.fillText(`⛁ ${q.reward.credits}₡${ptxt?'   ·   '+ptxt:''}`, row.x+10, row.y+45);
      // button
      const ready = row.kind==='active' && questReady(s, prog, hl.pKey, q);
      const canAccept = row.kind==='offer' && (s.questState.active.length < QUEST_MAX_ACTIVE);
      const enabled = row.kind==='offer' ? canAccept : ready;
      const label = row.kind==='offer' ? 'ACCEPT' : (ready ? 'TURN IN' : 'ACTIVE');
      g.fillStyle = enabled ? 'rgba(0,255,136,0.22)' : 'rgba(120,120,140,0.14)';
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.fill();
      g.strokeStyle = enabled ? '#00FF88' : 'rgba(140,140,160,0.3)'; g.lineWidth=0.8;
      rr(row.btn.x,row.btn.y,row.btn.w,row.btn.h,4); g.stroke();
      g.fillStyle = enabled ? '#aaffcc' : '#788'; g.font='bold 9px monospace'; g.textAlign='center';
      g.fillText(label, row.btn.x+row.btn.w/2, row.btn.y+row.btn.h/2+3);
    }
  }

  function hallTransact(s, prog, pKey, row){
    ensureShipState(s);
    const qs = s.questState, q = row.q;
    if (row.kind==='offer'){
      if (qs.active.length >= QUEST_MAX_ACTIVE){ toast('Quest log full — finish one first', '#ff9a3c'); return; }
      qs.active.push(q);
      qs.offers[pKey] = (qs.offers[pKey]||[]).filter(o=>o.id!==q.id);
      toast(`📜 Accepted: ${q.title}`, '#F0DC8A'); sfx('buy'); return;
    }
    // turn-in
    if (!questReady(s, prog, pKey, q)){ toast('Not finished yet — check the job details', '#888'); return; }
    if (q.type==='seeds')  s.seedBag[q.crop] -= q.qty;          // hand the seeds over
    if (q.type==='gather') prog.inv[q.res]   -= q.qty;          // hand the goods over
    s.credits += q.reward.credits;
    qs.active = qs.active.filter(a=>a.id!==q.id);
    toast(`✅ ${q.title} — reward +${q.reward.credits}₡`, '#a0ffa0'); sfx('buy');
    // refresh offers if board empty so the hall always has work
    if (!(qs.offers[pKey]||[]).length) {
      delete qs.offers[pKey];
      genQuestOffers(s, pKey);
      toast('🏛 New jobs posted on the board', '#E8D06A', 2);
    }
  }

  // ── Cantina — paid drink for a rumor menu (3 picks), once per sleep day.
  //    Trade tips, free seed, or local color. Cooldown on prog.cantinaDay.
  const CANTINA_DRINK = 8;
  function cantinaTalk(s, pKey, prog){
    ensureShipState(s);
    const pdef = planetDef(pKey);
    // once-per-day: use season tick as day id
    const dayId = (_season.idx * 10) + _season.tick;
    if (prog.cantinaDay === dayId) {
      toast("Barkeep: 'You've had enough for today. Sleep it off.'", '#FF8800');
      return;
    }
    if (s.credits < CANTINA_DRINK) {
      toast(`Need ${CANTINA_DRINK}₡ for a drink and a story`, '#ff9a3c');
      return;
    }
    s.credits -= CANTINA_DRINK;
    prog.cantinaDay = dayId;
    // Always roll three rumor types; pick strongest payoff randomly weighted
    const r = Math.random();
    if (r < 0.40){
      const fKey = otherPlanets(pKey)[Math.floor(Math.random()*4)];
      const crop = SEED_BY[planetDef(fKey).crops[Math.floor(Math.random()*planetDef(fKey).crops.length)]];
      toast(`🍺 Barkeep: '${crop.emoji} ${crop.name} from ${planetDef(fKey).name} — sell off-world for ×${EXPORT_MULT}.'`, '#FFB86A', 3.5);
    } else if (r < 0.62){
      const seed = pdef.crops[Math.floor(Math.random()*pdef.crops.length)];
      s.seedBag[seed] = (s.seedBag[seed]||0)+1;
      toast(`🍺 Barkeep slides a free ${SEED_BY[seed].name} seed ${SEED_BY[seed].emoji} under the glass.`, '#a0ffa0', 3);
    } else if (r < 0.78){
      // quest hint
      const offers = (s.questState && s.questState.offers && s.questState.offers[pKey]) || [];
      if (offers.length) {
        const o = offers[Math.floor(Math.random()*offers.length)];
        toast(`🍺 Barkeep: 'City Hall wants "${o.title}". Honest pay.'`, '#E8D06A', 3.2);
      } else {
        toast(`🍺 Barkeep: 'Hall's quiet. Sleep and new jobs will post.'`, '#E8D06A', 2.5);
      }
    } else {
      const LINES = {
        mira:   ["'Best soil in the system, and the Guild knows it.'","'Build a barn — livestock pays while you sleep.'","'Water once a day. Crops feel it before the next rest.'"],
        vesper: ["'Everything down the mineshafts glows. EVERYTHING.'","'Glowcaps only sprout in Vesper dark — export them.'","'The Vex left claim markers older than the colony.'"],
        cinder: ["'Mind the lava fields.'","'Emberchili only takes in warm ash. Ours.'","'Ash yams ship well — Guild abroad pays triple.'"],
        dusk:   ["'Cold keeps icegrapes sweet.'","'Frostleaf is the quiet money crop.'","'The rigs never sleep. You should, sometimes.'"],
        sorn:   ["'Caravans cross at dusk.'","'Sun corn drinks light itself.'","'Oasis wells run deeper than any drill.'"],
      };
      const pool = LINES[pKey] || LINES.mira;
      toast(`🍺 Barkeep: ${pool[Math.floor(Math.random()*pool.length)]}`, '#FF8800', 3);
    }
    sfx('buy');
  }

  // Execute a tool action once the player has walked to the target tile.
  function doToolAction(prog, world, act, tx, ty, s){
    const key = `${tx},${ty}`;
    if (act==='till'){
      if (prog.tilled[key]){ toast('Already tilled', '#888'); return; }
      if (!tileFree(prog, world, tx, ty)){ toast("Can't till here", '#ff9a3c'); return; }
      prog.tilled[key]=true; toast('Tilled soil — ready to plant', '#C89060'); sfx('drop');
    } else if (act==='plant'){
      ensureShipState(s);
      if (!prog.tilled[key]){ toast('Till the soil first', '#ff9a3c'); return; }
      if (prog.crops[key]){ toast('Something already growing here', '#888'); return; }
      const sk = prog.selSeed, sdef = SEED_BY[sk];
      const pKey = s.currentPlanetName || 'mira';
      // crops only grow on their HOME soil — that's what makes exports valuable
      if (sdef && sdef.home !== pKey){
        toast(`${sdef.name} only grows on ${planetDef(sdef.home).name} — fly there to farm it`, '#ff9a3c'); return;
      }
      if ((s.seedBag[sk]||0)<=0){ toast(`No ${sdef?.name||'seed'} seeds — buy some at the Trade Guild`, '#ff9a3c'); return; }
      s.seedBag[sk]--; prog.crops[key]={ type:sk, stage:0, watered:false };
      toast(`Planted ${sdef.name} — sleep to grow`, '#80ff80'); sfx('drop');
    } else if (act==='water'){
      const c = prog.crops[key];
      if (!c){ toast('No crop here to water', '#888'); return; }
      if (c.watered){ toast('Already watered', '#888'); return; }
      if (prog.water.fill<=0){ toast('Watering can empty — refill at water or a Well', '#ff9a3c'); return; }
      prog.water.fill--; c.watered=true; c.bonus=true;   // watered = faster growth + bigger harvest
      // Day boost: first water also pushes +1 growth stage so farms feel responsive
      const def = SEED_BY[c.type];
      if (def && !c.dayBoost && c.stage < def.grow) {
        c.stage = Math.min(def.grow, c.stage + 1);
        c.dayBoost = true;
        toast(c.stage >= def.grow
          ? 'Watered — ripe! Harvest when ready'
          : `Watered — grew to stage ${c.stage}/${def.grow} (+sleep bonus pending)`, '#3ec6ff');
      } else {
        toast('Watered — grows faster on sleep & yields +1', '#3ec6ff');
      }
      sfx('drop');
    } else if (act==='refill'){
      prog.water.fill = prog.water.max; toast('Filled the watering can', '#3ec6ff'); sfx('buy');
    } else if (act==='build'){
      placeBuilding(prog, world, tx, ty);
    } else if (act==='destroy'){
      destroyBuilding(prog, tx, ty);
    }
  }

  function destroyBuilding(prog, tx, ty){
    const i = prog.buildings.findIndex(b=>Math.floor(b.x)===tx && Math.floor(b.y)===ty);
    if (i<0){ toast('No building of yours here', '#888'); return; }
    const b = prog.buildings[i], def = BT_BY[b.type];
    // refund 50% of everything invested (base cost + each upgrade level)
    const refund = {};
    const add = (cost)=>{ for (const [k,v] of Object.entries(cost)) refund[k]=(refund[k]||0)+v; };
    add(def.cost);
    for (let l=2; l<=(b.level||1); l++) if (def.up) add(def.up);
    let msg=[];
    for (const [k,v] of Object.entries(refund)){ const back=Math.floor(v*0.5); if (back>0){ prog.inv[k]=(prog.inv[k]||0)+back; msg.push(`${back} ${k}`); } }
    prog.buildings.splice(i,1);
    toast(`Demolished ${def.name} — recovered ${msg.join(', ')||'nothing'}`, '#ffcf5a'); sfx('drop');
  }

  function placeBuilding(prog, world, tx, ty){
    const k = prog.selBuildKey; if (!k) return;
    const def = BT_BY[k];
    if (hasBuilding(prog, k)){ toast(`You already have a ${def.name} (one of each)`, '#ff9a3c'); return; }
    if (!tileFree(prog, world, tx, ty) || prog.tilled[`${tx},${ty}`]){ toast("Can't build there", '#ff9a3c'); return; }
    if (!canAfford(prog.inv, def.cost)){ toast('Need: '+costStr(def.cost), '#ff9a3c'); return; }
    payCost(prog.inv, def.cost);
    prog.buildings.push({ x:tx, y:ty, type:k, level:1 });
    prog.selBuildKey = null;
    toast(`${def.name} built!`, '#80ff80'); sfx('buy');
  }

  // ── zoom listeners ───────────────────────────────────────────────────────────
  if (typeof window !== "undefined" && !HEADLESS) {
    window.addEventListener("wheel", e => {
      if (!_camActive) return; e.preventDefault();
      _zoomTgt = Math.max(0.38, Math.min(2.6, _zoomTgt + (e.deltaY>0?-0.09:0.09)));
    }, { passive:false });
    let _pd0=0, _pz0=1;
    window.addEventListener("touchstart", e => {
      if (!_camActive||e.touches.length!==2) return;
      _pd0=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      _pz0=_zoomTgt;
    }, { passive:true });
    window.addEventListener("touchmove", e => {
      if (!_camActive||e.touches.length!==2||!_pd0) return;
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      _zoomTgt=Math.max(0.38,Math.min(2.6,_pz0*(d/_pd0)));
    }, { passive:true });
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────────
  return {

    // Locked clay diorama engine (null only if build order broke).
    engine: CWE,
    engineLayoutV: ENGINE_LAYOUT_V,

    /** Register or replace a world recipe. Preferred path for new clay worlds. */
    registerWorld(key, recipe) {
      if (!key) throw new Error("PLANET.registerWorld: key required");
      const raw = Object.assign({}, recipe);
      PLANET_DEFS[key] = CWE ? CWE.normalizeRecipe(raw) : raw;
      return PLANET_DEFS[key];
    },
    /** List registered world keys. */
    worldKeys() { return Object.keys(PLANET_DEFS); },
    /** Read a normalized recipe (do not mutate). */
    getRecipe(key) { return PLANET_DEFS[key] || null; },

    // Read-only accessor for the generated world — playtest/debug harnesses use
    // this for state-level asserts (tiles/buildings/elev) when pixels can't be
    // trusted (see the automated-pane rasterizer gotcha).
    _debugWorld() { return _worldCache; },
    _debugCam() { return { z: _cam.z, tgt: _zoomTgt, x: _cam.x, y: _cam.y }; },

    // Headless farm → sleep → trade → quest smoke test
    selfTest() {
      const fails = [];
      const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
      try {
        // Locked clay world engine must be present and green
        check(!!CWE, "ClayWorldEngine loaded");
        if (CWE) {
          const ef = CWE.selfTest();
          for (const f of ef) fails.push(f);
          check(PLANET_DEFS.mira && PLANET_DEFS.mira.ground === "diorama", "mira is diorama");
          check(PLANET_DEFS.mira.proc && PLANET_DEFS.mira._engine === CWE.ENGINE_ID, "mira recipe stamped");
          check(CWE.isDiorama(PLANET_DEFS.mira), "isDiorama(mira)");
        }
        const s = {
          onPlanet: false, currentPlanetName: null, credits: 200,
          seedBag: { carrot: 5, grain: 3 }, planetCargo: {},
          questState: { nextId: 1, active: [], offers: {} },
          planetProgress: {},
          hp: { shield: 10, shieldMax: 10, armor: 10, armorMax: 10, hull: 10, hullMax: 10 },
          fuel: 100, fuelMax: 100,
        };
        // Moon base world registered
        check(!!PLANET_DEFS.selene, "selene recipe exists");
        check(PLANET_DEFS.selene.worldType === "moon", "selene is moon type");
        check(PLANET_DEFS.selene.ground === "diorama", "selene diorama ground");
        check(PLANET_DEFS.selene.parentPlanet === "mira", "selene orbits mira");

        this.land(s, "mira");
        check(s.onPlanet === true, "land mira");
        check(s.currentPlanetName === "mira", "planet key");
        const prog = s.planetProgress.mira;
        check(!!prog, "progress created");
        check(prog._welcomed === true, "first-land welcome");
        check((s.seedBag.carrot || 0) >= 2, "starter seeds granted");
        check((prog.layoutV | 0) >= ENGINE_LAYOUT_V, "layoutV engine-locked");
        const world = this._debugWorld();
        check(!!world && world.HX != null, "world gen");
        check(!!world.farm, "farm rect on world");
        // Variable node scales present (engine quality bar)
        if (world && world.nodes && world.nodes.length) {
          const scales = world.nodes.map(n => n.scale || 1);
          const lo = Math.min(...scales), hi = Math.max(...scales);
          check(hi > lo + 0.15, "node scale variety");
        }
        // Multi-tile collidable mountain ranges
        if (world && world.landmarks && world.landmarks.length) {
          const big = world.landmarks.filter(L => (L.w || 0) >= 6);
          check(big.length >= 1, "has multi-tile landmarks (≥6 tiles)");
          const L0 = big[0] || world.landmarks[0];
          check(L0.collide === true, "landmark collides");
          check(CWE.landmarkBlocks(L0, L0.x, L0.y) === true, "blocks center of massif");
          check(CWE.landmarkBlocks(L0, L0.x + 50, L0.y + 50) === false, "clear far from massif");
        }
        check(world && world.landscapes && world.landscapes.length >= 1, "vista landscapes present");
        // Sprite carpet: most open grass should have deco props
        if (world && world.deco) {
          check(world.deco.length > 500, "dense deco carpet got " + world.deco.length);
          const full = world.deco.filter(d => d.fullTile).length;
          check(full > 300, "full-tile props got " + full);
        }
        check(PLANET_DEFS.mira.proc.seamlessSprite === true, "mira seamlessSprite");
        // Oriented feature packs (cliffs at 4 angles)
        if (world && world.features) {
          check(world.features.length >= 8, "features placed got " + world.features.length);
          const cliffs = world.features.filter(F => (F.key || "").startsWith("cliff_"));
          check(cliffs.length >= 1, "oriented cliffs present");
          const angles = new Set(cliffs.map(F => F.angle).filter(Boolean));
          check(angles.size >= 1, "cliff angles tagged");
        }

        // Selene moon-base surface smoke
        s.onPlanet = false;
        this.land(s, "selene");
        check(s.onPlanet === true, "land selene");
        check(s.currentPlanetName === "selene", "selene key");
        const wS = this._debugWorld();
        check(!!wS && wS.HX != null, "selene world gen");
        check(!!wS.farm, "selene farm belt");
        check((wS.cityBuildings || []).length >= 8, "selene dual-district city has buildings");
        check((wS.landmarks || []).length >= 1, "selene landmarks");
        const hotTypes = new Set((wS.cityBuildings || []).map(b => b.type));
        check(hotTypes.has("city_market") || hotTypes.has("city_hall") || hotTypes.has("hangar"),
          "selene has port/city structures");
        s.onPlanet = false;
        if (world.farm) {
          const f = world.farm;
          const farmNodes = (world.nodes || []).filter(n =>
            n.x >= f.x0 && n.x <= f.x1 && n.y >= f.y0 && n.y <= f.y1);
          check(farmNodes.length === 0, "no resource nodes in farm belt");
          let grass = 0, water = 0;
          for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
            const tt = world.tiles[y * MAP_W + x];
            if (tt === T_GRASS) grass++;
            if (tt === T_WATER) water++;
          }
          check(grass > 20, "farm belt mostly grass, grass=" + grass);
          check(water === 0, "farm belt has no water");
        }
        const tilledN = Object.keys(prog.tilled || {}).length;
        check(tilledN >= 4, "pre-tilled starter plots, got " + tilledN);
        check(Array.isArray(world.landmarks) && world.landmarks.length >= 3,
          "landmarks spawned, got " + ((world.landmarks && world.landmarks.length) || 0));
        // free seeds, till+plant near pad
        const tx = (world.HX + 2) | 0, ty = (world.HY + 2) | 0;
        // force tilled/planted via direct state (tool path needs free tile)
        prog.tilled[`${tx},${ty}`] = true;
        prog.crops[`${tx},${ty}`] = { type: "carrot", stage: 0, watered: false };
        prog.water = prog.water || { fill: 8, max: 8 };
        prog.water.fill = 8;
        // water day boost
        doToolAction(prog, world, "water", tx, ty, s);
        const c0 = prog.crops[`${tx},${ty}`];
        check(c0 && c0.watered, "watered");
        check(c0.stage >= 1, "dayBoost stage >= 1, got " + (c0 && c0.stage));
        // sleep to ripen
        advanceSleep(prog, s);
        advanceSleep(prog, s);
        check(prog.crops[`${tx},${ty}`].stage >= SEED_BY.carrot.grow, "ripe after sleep");
        // harvest manually
        const def = SEED_BY.carrot;
        const yld = def.yield + (prog.crops[`${tx},${ty}`].bonus ? 1 : 0);
        delete prog.crops[`${tx},${ty}`];
        prog.inv.carrot = (prog.inv.carrot || 0) + yld;
        check(prog.inv.carrot > 0, "harvest to inv");
        // load ship
        shelterTransact(s, prog, "mira", { kind: "crop", key: "carrot" });
        check((s.planetCargo.carrot || 0) > 0, "cargo loaded");
        // export sell on vesper
        this.launch(s);
        // force leave
        s.onPlanet = false; s.currentPlanetName = null;
        this.land(s, "vesper");
        const pV = s.planetProgress.vesper;
        const have = s.planetCargo.carrot;
        marketTransact(s, pV, "vesper", {
          tab: "sell", src: "cargo", key: "carrot", price: SEED_BY.carrot.sellEach * EXPORT_MULT, exp: true,
        });
        check((s.planetCargo.carrot || 0) === 0, "cargo sold");
        check(s.credits > 200, "export credits earned");
        // quests
        this.land(s, "mira"); // re-land
        const offers = genQuestOffers(s, "mira");
        check(offers.length >= 3, "hall offers");
        // barn income
        const pM = s.planetProgress.mira;
        pM.buildings = pM.buildings || [];
        pM.buildings.push({ x: 10, y: 10, type: "barn", level: 0 });
        const cr0 = s.credits;
        advanceSleep(pM, s);
        check(s.credits > cr0, "barn income on sleep");
        s.onPlanet = false;
      } catch (e) {
        fails.push("FAIL: PLANET.selfTest threw: " + (e && e.message));
      }
      return fails;
    },


    land(s, planetName) {
      const pKey = toKey(planetName);
      // Landable = has a PLANET_DEF (Mira, Vesper, Cinder, Dusk, Sorn).
      // Gas giants + Nox Prime stay blocked with their story stubs.
      if (!PLANET_DEFS[pKey]) {
        const stubKey = Object.keys(PLANET_DATA.STUBS).find(k => pKey.startsWith(k)||k===pKey);
        const stub = stubKey ? PLANET_DATA.STUBS[stubKey] : null;
        toast("LANDING BLOCKED: " + (stub ? stub.msg : planetName+" — no landing zone."), "#ff9a3c");
        return;
      }
      s.onPlanet = true;
      s.currentPlanetName = pKey;
      const prog = getProgress(s, pKey);
      // Layout version: bump when pad/city/slab rules change so existing saves
      // reseed once and pick up the fixed landing experience.
      // Reseed when ClayWorldEngine.LAYOUT_V advances (locked gen shape changes).
      if ((prog.layoutV | 0) < ENGINE_LAYOUT_V) {
        prog.worldSeed = 1 + ((Math.random() * 0x7ffffffe) | 0);
        prog.layoutV = ENGINE_LAYOUT_V;
        _worldCache = null;
        _farBake = null;
      }
      // one-time migration: fold old per-planet credits/seeds into the ship-wide pools
      migrateEconomy(s, prog);
      // Always touch down standing beside the ship, facing out, ready to launch
      // again. Derive the spot from the world's real home tile (not a hardcoded
      // constant that could drift off-map if MAP_H/home ever changes) so the
      // player never spawns in the void. Landing = arriving in your ship, so it's
      // right that every touchdown puts you back at the pad.
      const w = getWorld(prog.worldSeed, pKey);
      prog.px = w.HX + 0.5;          // ship sits at (HX, HY+2); stand 1.5 tiles north of it
      prog.py = w.HY + 0.5;
      prog.pDir = 0;                 // face south, toward the camera / the ship
      prog.inCar = false;
      prog.moveTarget = null;
      // default the seed picker to something that actually grows here
      const _pd = planetDef(pKey);
      if (!_pd.crops.includes(prog.selSeed)) prog.selSeed = _pd.crops[0];
      prog.fadeAlpha=1; prog.fadeDir=-1; prog.fadeMsg=planetDef(pKey).name+" Surface"; prog._launching=false;
      _cam.init = false;  // re-snap camera on entry
      _camActive = false;
      // full repair + refuel on landing — breathable atmo, crew patches the ship
      if (s.hp) { s.hp.shield = s.hp.shieldMax; s.hp.armor = s.hp.armorMax; s.hp.hull = s.hp.hullMax; }
      if (s.fuelMax) s.fuel = s.fuelMax;
      // First visit: free native seeds + pre-tilled starter plots in the homestead
      ensureShipState(s);
      if (!prog._welcomed) {
        prog._welcomed = true;
        const native = _pd.crops || [];
        for (const sk of native) {
          if ((s.seedBag[sk] || 0) < 2) s.seedBag[sk] = (s.seedBag[sk] || 0) + 2;
        }
        // Pre-till a small 3×2 bed near pad (farm belt center-ish)
        const w0 = getWorld(prog.worldSeed, pKey);
        const fx0 = (w0.farm ? w0.farm.x0 + 4 : (w0.HX || 14) + 2);
        const fy0 = (w0.farm ? Math.floor((w0.farm.y0 + w0.farm.y1) / 2) : (w0.HY || 56) - 6);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 3; dx++) {
          const tx = fx0 + dx, ty = fy0 + dy;
          if (tileFree(prog, w0, tx, ty)) prog.tilled[`${tx},${ty}`] = true;
        }
        if (typeof toast === 'function') {
          toast('◎ Homestead ready — tilled beds N of the pad. Seeds in your bag.', '#9fd36a', 3.5);
          setTimeout(() => {
            if (typeof toast === 'function')
              toast('Plant → Water → Sleep at Shelter/Hotel → Harvest → load ship for export', '#57e6ff', 4);
          }, 1200);
        }
      }
    },

    launch(s) {
      const prog = getProgress(s, s.currentPlanetName||"mira");
      if (prog._launching) return;
      prog._launching=true; prog.fadeAlpha=0; prog.fadeDir=1; prog.fadeMsg="Launching…";
    },

    // Tap / click on the surface (sx,sy in LOGICAL CONFIG.W/H screen coords) →
    // drop a walk destination. If the tap lands on/near an interactable, it's
    // flagged so we auto-interact the instant the player arrives. This is the
    // primary mobile control: tap ground to walk, tap a building to go use it.
    tap(sx, sy, s) {
      const pKey  = s.currentPlanetName||"mira";
      const prog  = getProgress(s, pKey);
      const world = getWorld(prog.worldSeed, pKey);
      if (HEADLESS) return true;
      if (prog.fadeAlpha > 0) return true;   // ignore during transitions

      // 1) UI first — toolbar / seed strip / build list / market menu.
      if (hitUI(sx, sy, prog, world, s, pKey)) return true;

      // 2) Invert the iso projection: screen → tile. CRITICAL: tiles are drawn
      //    shifted UP by their elevation (e*CLIFF_PX*z), so a naive ground-plane
      //    inversion resolves the tap to the tile ~1 step forward — that's the
      //    "tilled the wrong tile" bug. We iterate: guess the tile, look up its
      //    elevation, add that screen offset back, and re-solve until stable.
      const z = _cam.z;
      const wx = (sx - CONFIG.W/2)/z + _cam.x;
      let tx = 0, ty = 0, syAdj = sy;
      for (let it = 0; it < 6; it++) {     // 6 iterations: converges for 4 elevation tiers
        const wy = (syAdj - CONFIG.H/2)/z + _cam.y;
        tx = (wx/ISO_HW + wy/ISO_HH) / 2;
        ty = (wy/ISO_HH - wx/ISO_HW) / 2;
        const rtx = Math.max(0, Math.min(MAP_W-1, Math.round(tx)));
        const rty = Math.max(0, Math.min(MAP_H-1, Math.round(ty)));
        const e = world.elevA[rty*MAP_W + rtx] || 0;
        syAdj = sy + e*CLIFF_PX*z;       // ground-plane screen-y for that elevation
      }
      tx = Math.max(1.5, Math.min(MAP_W-2.5, tx));
      ty = Math.max(1.5, Math.min(MAP_H-2.5, ty));
      const txi = Math.round(tx), tyi = Math.round(ty);
      const tool = prog.tool || 'action';

      // 3) Tool-specific taps set a walk target carrying an action to run on arrival.
      if (tool==='till'){  prog.moveTarget={ x:txi, y:tyi, action:'till'  }; return true; }
      if (tool==='plant'){ prog.moveTarget={ x:txi, y:tyi, action:'plant' }; return true; }
      if (tool==='build'){
        // tapping one of your own buildings → walk over and destroy it (partial refund)
        let hit=null, hd=INTERACT_R;
        for (const b of prog.buildings){ const d=Math.hypot(tx-b.x, ty-b.y); if (d<hd){ hd=d; hit=b; } }
        if (hit){ prog.moveTarget={ x:hit.x, y:hit.y, action:'destroy' }; return true; }
        if (!prog.selBuildKey){ toast('Pick a building below, or tap one of yours to destroy', '#ffcf5a'); return true; }
        prog.moveTarget={ x:txi, y:tyi, action:'build' }; return true;
      }
      if (tool==='water'){
        const isWater = world.tiles[tyi*MAP_W+txi]===T_WATER;
        const well = prog.buildings.find(b=>b.type==='well');
        const nearWell = well && Math.hypot(tx-well.x, ty-well.y)<=1.8;
        if (isWater || nearWell){
          // walk to a land tile beside the water/well, then refill
          let dst = { x:txi, y:tyi };
          if (isWater){
            for (const [dx,dy] of [[0,-1],[-1,0],[1,0],[0,1],[1,1],[-1,-1],[1,-1],[-1,1]]){
              const nx=txi+dx, ny=tyi+dy;
              if (nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H && world.tiles[ny*MAP_W+nx]!==T_WATER){ dst={x:nx,y:ny}; break; }
            }
          } else { dst={ x:well.x, y:well.y }; }
          prog.moveTarget={ x:dst.x, y:dst.y, action:'refill' }; return true;
        }
        prog.moveTarget={ x:txi, y:tyi, action:'water' }; return true;
      }

      // 4) ACTION tool — pick what was VISUALLY tapped, then walk to it and
      //    interact. Two passes:
      //    a) SCREEN-SPACE sprite pick: test the tap against each
      //       interactable's sprite box (bottom-anchored at its tile, sized
      //       the way the draw code sizes it, elevation included). Among the
      //       boxes containing the tap, the FRONT-most (highest tile depth)
      //       wins — that's the sprite whose pixels are visibly on top. This
      //       fixes "clicked the Market, got City Hall" (clustered civic
      //       sprites whose ground tiles sit behind their tall art) and
      //       tree-canopy taps resolving to the tile behind the trunk.
      //    b) fallback: nearest anchor in TILE space within a TIGHT radius
      //       (the old 2.4-tile radius let neighbours hijack ground taps).
      let interact=false, ix=tx, iy=ty;
      const { HX, HY } = world;
      // Pick metric: NORMALIZED distance to each sprite's centre (its box
      // treated as an ellipse — canopies, hulls and building bodies are all
      // rounded, so rect-corner hits are usually transparent pixels). The
      // smallest nd wins; overlapping sprites resolve to whichever one the
      // tap is deepest inside, which tracks visible pixel ownership far
      // better than plain front-most-box.
      let bestNd = 1.05;   // must actually be (nearly) inside a sprite
      const shoot = (ox, oy, w, h, yOff) => {
        const rox = Math.max(0, Math.min(MAP_W-1, Math.round(ox)));
        const roy = Math.max(0, Math.min(MAP_H-1, Math.round(oy)));
        const e2 = world.elevA[roy*MAP_W + rox] || 0;
        const p2 = tileScreen(ox, oy, CONFIG.W, CONFIG.H);
        const ax2 = p2.x, ay2 = p2.y - e2*CLIFF_PX*z + (yOff||0);   // sprite bottom
        const nd = Math.hypot((sx-ax2)/(w/2), (sy-(ay2-h/2))/(h/2));
        if (nd < bestNd) { bestNd=nd; ix=ox; iy=oy; interact=true; }
      };
      shoot(HX, HY+2, 92*z, 110*z, 4*z);                              // the ship
      if (prog.car) shoot(prog.car.x, prog.car.y, 60*z, 42*z, 8*z);   // the Rover
      for (const b of (world.cityBuildings||[])){
        const card = BUILDING_CARDS[b.type];
        if (!card || card.key!=='E') continue;                        // interactive only
        const bd = CITY_BY_KEY[b.type]; if (!bd) continue;
        const gs = BLDG_SCALE[b.type] || 1.1;
        shoot(b.x, b.y, ISO_HW*2*bd.hw*gs*1.15*z, (bd.bh+34)*1.35*gs*z, ISO_HH*bd.hw*0.5*z);
      }
      for (const b of prog.buildings){
        const bd = BT_BY_KEY[b.type] || {};
        shoot(b.x, b.y, ISO_HW*2*(bd.hw||0.7)*1.15*z, ((bd.bh||20)+26)*z, ISO_HH*(bd.hw||0.7)*0.5*z);
      }
      for (const n of world.nodes){
        if (prog.harvested[n.id]) continue;
        const w2 = n.type==='tree'?50*z : n.type==='rock'?34*z : 36*z;
        const h2 = n.type==='tree'?66*z : n.type==='rock'?30*z : 32*z;
        shoot(n.x, n.y, w2, h2, 2*z);
      }
      for (const ck of Object.keys(prog.crops)){
        const [cx,cy]=ck.split(',').map(Number);
        shoot(cx, cy, 34*z, 34*z, 2*z);
      }

      if (!interact){
        // b) tile-space fallback — tight radii so ground taps stay ground taps
        let bestD=1e9;
        const consider = (ox, oy, r) => {
          const d = Math.hypot(tx-ox, ty-oy);
          if (d <= r && d < bestD) { bestD=d; ix=ox; iy=oy; interact=true; }
        };
        consider(HX, HY+2, 2.5);                          // pad is a big target
        if (prog.car) consider(prog.car.x, prog.car.y, 1.6);
        for (const b of (world.cityBuildings||[])){ const card=BUILDING_CARDS[b.type]; if (card&&card.key==='E') consider(b.x,b.y,1.4); }
        for (const b of prog.buildings) consider(b.x, b.y, 1.4);
        for (const n of world.nodes) if (!prog.harvested[n.id]) consider(n.x, n.y, 1.2);
        for (const ck of Object.keys(prog.crops)){ const [cx,cy]=ck.split(',').map(Number); consider(cx, cy, 1.2); }
      }

      prog.moveTarget = interact ? { x:ix, y:iy, interact:true } : { x:tx, y:ty, interact:false };
      return true;
    },

    tick(dt, s) {
      // NOTE: tick() is pure state mutation — no canvas calls.
      // getWorld() handles HEADLESS internally. Safe to run headlessly.
      const pKey = s.currentPlanetName||"mira";
      const prog  = getProgress(s, pKey);
      const world = getWorld(prog.worldSeed, pKey);
      ensureShipState(s);

      // ── fade ────────────────────────────────────────────────────────────
      if (prog.fadeAlpha > 0 || prog.fadeDir !== 0) {
        prog.fadeAlpha = Math.max(0, Math.min(1, prog.fadeAlpha + prog.fadeDir*dt*1.5));
        if (prog.fadeDir < 0 && prog.fadeAlpha <= 0) prog.fadeDir = 0;
        if (prog.fadeDir > 0 && prog.fadeAlpha >= 1 && prog._launching) {
          prog.fadeDir=0; prog._launching=false; s.onPlanet=false;
          input.ax=input.ay=0; prog.moveTarget=null;   // don't leak walk intent into flight
          return;
        }
        input.dock=input.refuel=input.closeMenu=input.mapToggle=false; return;
      }


      // ── lightning ticker ─────────────────────────────────────────────────
      if (_lightning.alpha > 0) {
        _lightning.alpha = Math.max(0, _lightning.alpha - dt * 7);
      } else if (Math.random() < 0.0008) {
        // ~0.08% per frame = roughly once every 20 seconds at 60fps
        _lightning.alpha = 0.55 + Math.random() * 0.30;
        _lightning.ttl = 0.12;
      }

      // (screen-glitch effect removed — it read as random static streaks across
      //  the screen, which the surface world doesn't want.)

      // ── node respawn timers ──────────────────────────────────────────────
      for (const id of Object.keys(prog.cooldowns)) {
        prog.cooldowns[id] -= dt;
        if (prog.cooldowns[id] <= 0) { delete prog.cooldowns[id]; delete prog.harvested[id]; delete prog.nodeHits[id]; }
      }
      // hit-shake fx decay
      for (const id of Object.keys(_hitFx)) { _hitFx[id] -= dt; if (_hitFx[id] <= 0) delete _hitFx[id]; }

      // ── launch (M) ───────────────────────────────────────────────────────
      if (input.mapToggle) { input.mapToggle=false; this.launch(s); return; }

      // ── freeze the world while any menu is open ─────────────────────────
      if (prog._marketOpen || prog._bldgOpen || prog._shelterOpen || prog._hallOpen) {
        if (input.returnToBase || input.closeMenu || input.mapToggle || input.dock) {
          prog._marketOpen = false; prog._bldgOpen = null;
          prog._shelterOpen = false; prog._hallOpen = false;
        }
        input.returnToBase = input.closeMenu = input.mapToggle = input.dock = false;
        input.skillTap = null; input.ax = input.ay = 0; prog.moveTarget = null;
        return;
      }

      // ── B: toggle Build tool (desktop shortcut) ──────────────────────────
      if (input.returnToBase) {
        input.returnToBase=false;
        prog.tool = (prog.tool==='build') ? 'action' : 'build';
        if (prog.tool!=='build') prog.selBuildKey=null;
        toast(prog.tool==='build' ? "Build tool — pick a building, tap a spot" : "Action tool");
      }

      // ── 1-5: pick a tool (desktop shortcut) ──────────────────────────────
      if (input.skillTap != null) {
        if (input.skillTap < TOOLS.length) {
          prog.tool = TOOLS[input.skillTap].key;
          if (prog.tool!=='build') prog.selBuildKey=null;
        }
        input.skillTap = null;
      }

      // ── tap-to-move: turn a tapped destination into movement intent ───────
      // Mobile-first navigation: PLANET.tap() drops a world-space target; here we
      // steer toward it every tick until we arrive. IMPORTANT: the synthesized
      // movement lives in LOCAL vars — we never write it back into input.ax/ay.
      // input.ax/ay is the *manual* mailbox (keyboard/keyup-cleared); clobbering it
      // would make the next tick read our own synthetic axes as "manual input",
      // cancel the walk, and leave stale motion running. Reading it clean lets a
      // real key press (or a second tap) take over instantly.
      const manAx = input.ax||0, manAy = input.ay||0;
      const manual = manAx!==0 || manAy!==0;
      let walkAx = manAx, walkAy = manAy;     // player walk axes
      let carSteer = manAx, carThrust = -manAy; // rover: steer / forward-thrust
      if (manual) {
        prog.moveTarget = null;               // any manual axis cancels auto-walk
      } else if (prog.moveTarget) {
        const tgt = prog.moveTarget;
        const dx = tgt.x - prog.px, dy = tgt.y - prog.py;
        const d  = Math.hypot(dx, dy);
        const arriveR = prog.inCar ? 0.9 : 0.28;
        if (d <= arriveR) {
          if (prog.inCar) { prog.car.vx *= 0.3; prog.car.vy *= 0.3; carThrust = 0; carSteer = 0; }
          else { walkAx = 0; walkAy = 0; }
          if (!prog.inCar) {
            if (tgt.action) doToolAction(prog, world, tgt.action, Math.round(tgt.x), Math.round(tgt.y), s);
            else if (tgt.interact) {
              // Remember WHICH object the tap picked (moveTarget.x/y is its
              // anchor) so the interact handler opens exactly that one, not
              // whatever happens to be nearest once we've walked over.
              prog._intent = { x: tgt.x, y: tgt.y };
              input.dock = true;   // auto-interact on arrival
            }
          }
          prog.moveTarget = null;
        } else if (prog.inCar) {
          // steer the Rover toward the target, thrust forward
          const desired = Math.atan2(dy, dx);
          let da = desired - prog.car.heading;
          while (da >  Math.PI) da -= Math.PI*2;
          while (da < -Math.PI) da += Math.PI*2;
          carSteer  = Math.max(-1, Math.min(1, da * 2.5));
          carThrust = 1;
        } else {
          // walk straight toward the target (normalized direction vector)
          walkAx = dx / d; walkAy = dy / d;
        }
      }

      // ── move: Rover physics OR player walk ───────────────────────────────
      if (prog.inCar) {
        const car = prog.car;
        const thrustInput = carThrust;     // forward(+)/reverse(-); up-arrow or tap-drive
        const turnInput   = carSteer;      // steer left(-)/right(+)
        const z60 = dt * 60;               // scale factor: 1.0 at 60 fps

        // Pre-step longitudinal velocity (for steering-direction sign)
        const hcos0 = Math.cos(car.heading), hsin0 = Math.sin(car.heading);
        const vLong0 = car.vx*hcos0 + car.vy*hsin0;

        // 1. Steer: reverse when going backward (sign(vLong))
        const steerSign = vLong0 > 0 ? 1 : vLong0 < 0 ? -1 : 0;
        car.heading += turnInput * CAR_TURN_SPEED * steerSign * z60;

        // 2. Thrust in (updated) heading direction
        const hcos = Math.cos(car.heading), hsin = Math.sin(car.heading);
        const thrustAmt = thrustInput > 0 ? CAR_THRUST : thrustInput < 0 ? -CAR_REVERSE : 0;
        car.vx += thrustAmt * hcos * z60;
        car.vy += thrustAmt * hsin * z60;

        // 3. Decompose velocity into longitudinal + lateral components
        const vLong = car.vx*hcos + car.vy*hsin;
        const vLat  = -car.vx*hsin + car.vy*hcos;

        // 4. Apply drag separately (framerate-independent via exponent)
        const ld = Math.pow(LONG_DRAG, z60), latd = Math.pow(LAT_DRAG, z60);
        const vLong2 = vLong * ld, vLat2 = vLat * latd;

        // 5. Recompose, then clamp to max speed
        car.vx = vLong2*hcos - vLat2*hsin;
        car.vy = vLong2*hsin + vLat2*hcos;
        const spd = Math.hypot(car.vx, car.vy);
        if (spd > CAR_MAX_SPEED) { car.vx *= CAR_MAX_SPEED/spd; car.vy *= CAR_MAX_SPEED/spd; }

        // 6. Move car (velocity is tiles/frame; scale by z60 → tiles/tick)
        const nx = car.x + car.vx*z60, ny = car.y + car.vy*z60;
        const rx = Math.round(nx), ry = Math.round(ny);
        const waterHit = rx>=0 && rx<MAP_W && ry>=0 && ry<MAP_H &&
                         world.tiles[ry*MAP_W+rx] === T_WATER;
        if (waterHit) {
          car.vx *= -0.4; car.vy *= -0.4;          // bounce off water
        } else {
          car.x = Math.max(1, Math.min(MAP_W-2, nx));
          car.y = Math.max(1, Math.min(MAP_H-2, ny));
        }
        // Player position tracks car
        prog.px = car.x; prog.py = car.y;
      } else {
        // Normal walk — axes come from keyboard (manual) OR tap-to-move (synthesized)
        const ax = walkAx, ay = walkAy;
        if (ax!==0||ay!==0) {
          const len = Math.hypot(ax,ay)||1;
          const step = PLAYER_SPEED*dt;
          const mx = ax/len*step, my = ay/len*step;
          const nx = prog.px+mx, ny = prog.py+my;
          if (!blocked(nx, prog.py, world)) prog.px = Math.max(1.5, Math.min(MAP_W-2.5, nx));
          if (!blocked(prog.px, ny, world)) prog.py = Math.max(1.5, Math.min(MAP_H-2.5, ny));
          if (Math.abs(ax)>Math.abs(ay)) prog.pDir=ax>0?2:1;
          else prog.pDir=ay>0?0:3;
        }
      }

      // ── NPC city cars ────────────────────────────────────────────────────
      for (const npc of (world.npcCars || [])) {
        const route = npc.route;
        if (!route || route.length < 2) continue;
        const target = route[npc.pathIdx % route.length];
        const dx = target.tx - npc.tx, dy = target.ty - npc.ty;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 0.10) {
          npc.tx = target.tx; npc.ty = target.ty;
          npc.pathIdx = (npc.pathIdx + 1) % route.length;
        } else {
          const spd = npc.speed * dt;
          npc.heading = Math.atan2(dy, dx);
          npc.tx += (dx / dist) * spd;
          npc.ty += (dy / dist) * spd;
        }
      }

      // ── NPC pedestrians ───────────────────────────────────────────────────
      const wt2 = _weather.type;
      const pedSpeedMult = (wt2==='RAIN'||wt2==='STORM') ? 1.5 :
                           (wt2==='SNOW'||wt2==='BLIZZARD') ? 0.55 :
                           (_festival.active && _season.idx===3) ? 0.70 : 1.0;
      for (const ped of (world.npcPeds || [])) {
        const route = ped.route;
        if (!route || route.length < 2) continue;
        const target = route[ped.pathIdx % route.length];
        const dx = target.tx - ped.tx, dy = target.ty - ped.ty;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 0.08) {
          ped.tx = target.tx; ped.ty = target.ty;
          ped.pathIdx = (ped.pathIdx + 1) % route.length;
        } else {
          ped.tx += (dx / dist) * ped.speed * pedSpeedMult * dt;
          ped.ty += (dy / dist) * ped.speed * pedSpeedMult * dt;
        }
      }

      // ── E: interact ──────────────────────────────────────────────────────
      if (input.dock) {
        input.dock = false;

        // ── Rover enter / exit ───────────────────────────────────────────
        if (prog.inCar) {
          // Exit: offset player 1 tile perpendicular to heading
          const hc = Math.cos(prog.car.heading), hs = Math.sin(prog.car.heading);
          let epx = prog.car.x - hs, epy = prog.car.y + hc;
          if (blocked(epx, epy, world)) { epx = prog.car.x + hs; epy = prog.car.y - hc; }
          if (blocked(epx, epy, world)) { epx = prog.car.x; epy = prog.car.y; }
          prog.px = Math.max(1.5, Math.min(MAP_W-2.5, epx));
          prog.py = Math.max(1.5, Math.min(MAP_H-2.5, epy));
          prog.car.vx = 0; prog.car.vy = 0;
          prog.inCar = false;
          toast("Exited Rover");
          return;
        }
        // (Rover ENTER moved below — it must not pre-empt the tap's intent:
        //  standing near the parked Rover while tapping a building should
        //  open the building, not board the car.)

        const { HX, HY } = world;

        // The tap that started this walk recorded WHICH object it picked
        // (sprite-aware, see tap() step 4). Dispatch to exactly that object
        // first; keyboard-E presses (no intent) and stale intents fall back
        // to nearest-in-range scans. This kills the "clicked the Market, got
        // City Hall" class of bug for good: proximity never overrides intent.
        const intent = prog._intent || null; prog._intent = null;
        const IA = (ox, oy) => intent && Math.hypot(intent.x-ox, intent.y-oy) < 0.6;

        // ── dispatchers (shared by the intent-first and nearest paths) ──────
        const openCity = (b) => {
          if (b.type==="traders_guild"){ prog._marketOpen = true; prog._marketTab = 'seeds'; sfx("buy"); return; }
          if (b.type==="city_market"){ prog._marketOpen = true; prog._marketTab = 'sell'; sfx("buy"); return; }
          if (b.type==="city_hall"){ prog._hallOpen = true; sfx("buy"); return; }
          if (b.type==="cantina"){ cantinaTalk(s, pKey, prog); return; }
          if (b.type==="hotel"){
            ensureShipState(s);
            if ((s.credits|0) < ROOM_COST){ toast(`Hotel: a room is ${ROOM_COST}cr — you're short`, '#ff9a3c'); sfx('drop'); return; }
            s.credits -= ROOM_COST;
            prog.harvested={}; prog.cooldowns={};                 // same night-passes reset as the Shelter
            const r = advanceSleep(prog, s);
            toast(`Rented a room (${ROOM_COST}cr) — ${r.season} (sleep ${r.sleep}/${SLEEPS_PER_SEASON}), ${r.weather}. Resources regrown.`, '#c0e0ff');
            sfx('buy');
          }
        };
        const usePlayerB = (pb) => {
          if (pb.type==='market'){ prog._marketOpen=true; prog._marketTab='sell'; sfx('buy'); return; }
          if (pb.type==='shelter'){ prog._shelterOpen = true; sfx('buy'); return; }
          if (pb.type==='well'){ prog.water.fill=prog.water.max; toast('Filled the watering can at the Well', '#3ec6ff'); sfx('buy'); return; }
          if (pb.type==='barn'){
            const seedsHeld = SEED_TYPES.reduce((n,c)=>n+(prog.inv[c.key]||0),0);
            toast(`Barn stores: 🪵${prog.inv.wood||0} ⛏${prog.inv.stone||0} 🫐${prog.inv.berry||0} 🥕${seedsHeld} crops`, '#FFB000'); return;
          }
          if (pb.type==='sawmill'||pb.type==='quarry'){ prog._bldgOpen = pb.type; sfx('buy'); }
        };
        const harvestCrop = (bestK) => {
          const c=prog.crops[bestK], def=SEED_BY[c.type];
          if (c.stage>=def.grow){
            const amt=def.yield + (c.bonus?1:0);
            prog.inv[c.type]=(prog.inv[c.type]||0)+amt;
            delete prog.crops[bestK]; delete prog.tilled[bestK];   // soil spent — re-till to replant
            toast(`Harvested ${amt} ${def.name} ${def.emoji}`, '#a0ffa0'); sfx('drop'); return;
          }
          toast(`${def.name} ${def.emoji} still growing (${c.stage}/${def.grow}) — sleep to grow`, '#888');
        };
        const hitNode = (best) => {
          const resK = resOf(best.type);
          // one tap = one hit. Init the hit counter on the first swing.
          if (prog.nodeHits[best.id]===undefined) prog.nodeHits[best.id] = requiredHits(prog, best.type);
          prog.nodeHits[best.id]--;
          _hitFx[best.id] = 0.22;   // wobble

          // chip particles fly off in the node's colour
          const chipCol = best.type==='tree'?'#6a3b1e': best.type==='rock'?'#9aa0aa':'#c04060';
          for (let i=0;i<5;i++){
            const a=Math.random()*Math.PI*2, sp=0.02+Math.random()*0.03;
            spawnParticle(best.x, best.y-0.3, Math.cos(a)*sp, -0.02-Math.random()*0.03, 22, chipCol, 1.1);
          }

          if (prog.nodeHits[best.id] > 0) {
            sfx('drop');   // thunk — not done yet
            return;
          }

          // final hit — resolve yield with multiplier + crit/dud
          delete prog.nodeHits[best.id];
          const mult = resK==='wood'?woodMult(prog): resK==='stone'?stoneMult(prog): berryMult(prog);
          let amt = 1*mult;
          if (_festival.active && _season.idx === 2) amt = Math.ceil(amt * 1.5);   // Harvest Market +50%
          const roll = Math.random();
          let surprise = '';
          if (roll < DUD_CHANCE) { amt = 0; surprise = ' — rotten, nothing!'; }
          else if (roll < DUD_CHANCE + CRIT_CHANCE) { amt *= 2; surprise = ' ⭐ CRITICAL ×2!'; }
          if (amt > 0) prog.inv[resK] = (prog.inv[resK]||0) + amt;
          prog.harvested[best.id]=true;
          prog.cooldowns[best.id]=NODE_RESPAWN;
          // burst of reward particles (gold on a crit)
          const burstCol = surprise.includes('CRIT') ? '#FFE24A' : chipCol;
          for (let i=0;i<(surprise.includes('CRIT')?12:6);i++){
            const a=Math.random()*Math.PI*2, sp=0.02+Math.random()*0.05;
            spawnParticle(best.x, best.y-0.4, Math.cos(a)*sp, -0.03-Math.random()*0.04, 30, burstCol, 1.3);
          }
          const mtag = mult>1 ? ` ×${mult}` : '';
          const col = surprise.includes('CRIT') ? '#FFE24A' : surprise.includes('nothing') ? '#ff9a3c' : '#ffffa0';
          toast(amt>0 ? `+${amt} ${resK}${mtag}${surprise}` : `${resK}${surprise}`, col);
          sfx(amt>0 ? 'buy' : 'warn');
        };
        const isCityInteractive = (t) => t==='traders_guild' || t==='city_market' || t==='city_hall' || t==='cantina' || t==='hotel';

        // ── intent-first: open exactly what was tapped ───────────────────────
        if (intent) {
          if (IA(prog.car.x, prog.car.y) && Math.hypot(prog.px-prog.car.x, prog.py-prog.car.y) < 1.5) {
            prog.inCar = true; prog.px = prog.car.x; prog.py = prog.car.y;
            toast("In the Rover — Arrow keys: drive  E: exit"); return;
          }
          if (IA(HX, HY+2) && Math.hypot(prog.px-HX, prog.py-(HY+2)) < SHIP_R) { this.launch(s); return; }
          const cb = (world.cityBuildings||[]).find(b => isCityInteractive(b.type) && IA(b.x,b.y) &&
            Math.hypot(prog.px-b.x, prog.py-b.y) < INTERACT_R+0.7);
          if (cb) { openCity(cb); return; }
          const pb = prog.buildings.find(b => IA(b.x,b.y) && Math.hypot(prog.px-b.x, prog.py-b.y) < INTERACT_R+0.4);
          if (pb) { usePlayerB(pb); return; }
          const ck = Object.keys(prog.crops).find(k => { const [cx,cy]=k.split(',').map(Number);
            return IA(cx,cy) && Math.hypot(prog.px-cx, prog.py-cy) < INTERACT_R; });
          if (ck) { harvestCrop(ck); return; }
          const nd = world.nodes.find(n => !prog.harvested[n.id] && IA(n.x,n.y) &&
            Math.hypot(prog.px-n.x, prog.py-n.y) < INTERACT_R);
          if (nd) { hitNode(nd); return; }
          // intended object gone or out of reach — fall through to nearest
        }

        // ── nearest fallback (keyboard E, or a stale intent) ─────────────────
        if (Math.hypot(prog.px-prog.car.x, prog.py-prog.car.y) < 1.5) {
          prog.inCar = true; prog.px = prog.car.x; prog.py = prog.car.y;
          toast("In the Rover — Arrow keys: drive  E: exit"); return;
        }
        if (Math.hypot(prog.px-HX, prog.py-(HY+2)) < SHIP_R) { this.launch(s); return; }
        {
          // NEAREST interactive city building — was first-in-array, which let
          // City Hall (listed first) steal clicks meant for its plaza
          // neighbours even without sprite mis-picks.
          let cb=null, cbd=INTERACT_R+0.7;
          for (const b of (world.cityBuildings||[])) {
            if (!isCityInteractive(b.type)) continue;
            const d = Math.hypot(prog.px-b.x, prog.py-b.y);
            if (d < cbd) { cbd=d; cb=b; }
          }
          if (cb) { openCity(cb); return; }
        }
        {
          let pb=null, pbd=INTERACT_R;
          for (const b of prog.buildings){ const d=Math.hypot(prog.px-b.x, prog.py-b.y); if (d<pbd){ pbd=d; pb=b; } }
          if (pb) { usePlayerB(pb); return; }
        }
        {
          let bestK=null, bd=INTERACT_R;
          for (const ck of Object.keys(prog.crops)){ const [cx,cy]=ck.split(',').map(Number); const d=Math.hypot(prog.px-cx, prog.py-cy); if (d<bd){ bd=d; bestK=ck; } }
          if (bestK) { harvestCrop(bestK); return; }
        }
        {
          let best=null, bd=INTERACT_R;
          for (const n of world.nodes) {
            if (prog.harvested[n.id]) continue;
            const d=Math.hypot(prog.px-n.x, prog.py-n.y);
            if (d<bd) { bd=d; best=n; }
          }
          if (best) { hitNode(best); return; }
        }

        toast("Nothing here — tap a resource, crop, or building with the Action tool", "#aaa");
      }

      // ── F: quick-sell at market ──────────────────────────────────────────
      if (input.refuel) {
        input.refuel=false;
        for (const b of prog.buildings) {
          if (b.type!=="market") continue;
          if (Math.hypot(prog.px-b.x, prog.py-b.y) < INTERACT_R) {
            const inv=prog.inv;
            const earned=(inv.wood||0)*5+(inv.stone||0)*8+(inv.berry||0)*3;
            if (earned>0) { inv.credits=(inv.credits||0)+earned; inv.wood=0; inv.stone=0; inv.berry=0;
              toast(`Sold for ${earned} credits!`, "#ffd060"); }
            return;
          }
        }
      }

      if (input.closeMenu) input.closeMenu=false;

      // ── camera ───────────────────────────────────────────────────────────
      _zoomTgt=Math.max(0.38,Math.min(2.6,_zoomTgt));
      // SNAP when close: an asymptotic lerp never exactly converges, which left
      // _cam.z jittering by float-epsilons forever — and anything keyed on "zoom
      // changed" (the terrain tile cache) rebuilt EVERY FRAME. That was the
      // 30fps choppiness after any zoom/pinch.
      if (Math.abs(_zoomTgt-_cam.z) < 0.0015) _cam.z = _zoomTgt;
      else _cam.z += (_zoomTgt-_cam.z)*Math.min(1,dt*8);
      if (!_cam.init) {
        const {x,y}=isoWorld(prog.px,prog.py); _cam.x=x; _cam.y=y; _cam.init=true;
      }
      _camActive=true;
      _frame += dt;
      tickSeasonWeather(dt, world);
      tickParticles(dt);
      syncAnimals(prog);
      tickAnimals(dt);
    },

    draw(g, s) {
      if (HEADLESS) return;
      // Draw in LOGICAL units (CONFIG.W/H) — the frame loop applies a renderScale
      // transform that maps these onto the physical backing buffer. Using the raw
      // g.canvas.width/height here (device px, e.g. 750×1624 on a dpr-2 phone)
      // double-scaled the whole surface, off-centred the camera and pushed the
      // player sprite off-screen. This one line is why the character was invisible.
      const W=CONFIG.W, H=CONFIG.H;
      const pKey=s.currentPlanetName||"mira";
      const prog=getProgress(s,pKey);
      const world=getWorld(prog.worldSeed, pKey);

      // ── Sky — per-planet colours; Mira keeps its gentle seasonal shift ─────
      const pdef2 = world.def || PLANET_DEFS.mira;
      const si2 = _season.idx;
      let skyTop, skyHor;
      if (pdef2.sky){ skyTop = pdef2.sky.top; skyHor = pdef2.sky.hor; }
      else {
        const SKY_TOP = ['#7AC0EE','#6FB7F0','#88B7D6','#A2C4DD'];   // spring/summer/autumn/winter
        const SKY_HOR = ['#DCEFF3','#CFEAF7','#ECE5D0','#E3ECF3'];
        skyTop = SKY_TOP[si2]; skyHor = SKY_HOR[si2];
      }
      const sky=g.createLinearGradient(0,0,0,H*0.8);
      sky.addColorStop(0, skyTop);
      sky.addColorStop(1, skyHor);
      g.fillStyle=sky; g.fillRect(0,0,W,H);

      const isMoonSky = pdef2.worldType === 'moon';
      if (isMoonSky) {
        // Harsh vacuum: black sky, hard stars, tiny harsh sun, no clouds
        g.fillStyle = '#000000'; g.fillRect(0, 0, W, H);
        g.save();
        for (let i = 0; i < 90; i++) {
          const sx = ((i * 97 + 13) % 1000) / 1000 * W;
          const sy = ((i * 53 + 29) % 1000) / 1000 * H * 0.72;
          const a = 0.35 + ((i * 17) % 50) / 100;
          g.globalAlpha = a;
          g.fillStyle = '#E8ECF0';
          const r = (i % 7 === 0) ? 1.4 : 0.7;
          g.fillRect(sx, sy, r, r);
        }
        g.restore();
        // Tiny harsh sun (no warm bloom)
        g.save(); g.globalAlpha = 0.95; g.fillStyle = '#FFFFFF';
        g.beginPath(); g.arc(W * 0.18, H * 0.1, 6, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 0.25; g.beginPath(); g.arc(W * 0.18, H * 0.1, 14, 0, Math.PI * 2); g.fill();
        g.restore();
      } else {
        // Warm sun + glow (upper-left)
        const sunX=W*0.20, sunY=H*0.12;
        const sunG = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, H*0.45);
        sunG.addColorStop(0, 'rgba(255,247,214,0.55)');
        sunG.addColorStop(0.35, 'rgba(255,242,196,0.15)');
        sunG.addColorStop(1, 'rgba(255,242,196,0)');
        g.fillStyle=sunG; g.fillRect(0,0,W,H);
        g.save(); g.globalAlpha=0.92; g.fillStyle='#FFF7DC';
        g.beginPath(); g.arc(sunX, sunY, 15, 0, Math.PI*2); g.fill(); g.restore();

        // Drifting clouds
        if (!_clouds){ _clouds=[]; for(let i=0;i<6;i++) _clouds.push([Math.random()*1.2, 0.05+Math.random()*0.20, 0.6+Math.random()*0.9, 0.4+Math.random()*0.6]); }
        g.save(); g.fillStyle=(pdef2.sky&&pdef2.sky.cloud)||'#ffffff';
        for (const cl of _clouds){
          const cx = (((cl[0] + _frame*0.004*cl[3]) % 1.2) - 0.1)*W, cy = cl[1]*H, s = cl[2];
          g.globalAlpha = 0.30 + 0.28*cl[3];
          for (const [ox,oy,r] of [[0,0,26],[22,4,20],[-20,5,18],[8,-9,15]]){
            g.beginPath(); g.ellipse(cx+ox*s, cy+oy*s, r*s, r*s*0.58, 0,0,Math.PI*2); g.fill();
          }
        }
        g.restore(); g.globalAlpha=1;
      }

      // world tiles, nodes, buildings, player, landed ship
      drawScene(g, W, H, prog, world, s);

      // Lightning flash — brief white-blue-white full-screen illuminate
      if (_lightning.alpha > 0) {
        g.save();
        g.globalAlpha = _lightning.alpha * 0.45;
        // Blue-white core
        g.fillStyle = '#DDEEFF';
        g.fillRect(0, 0, W, H);
        // Edge stays darker — centre brightest
        const lgrad = g.createRadialGradient(W*0.5, H*0.38, 0, W*0.5, H*0.38, H*0.70);
        lgrad.addColorStop(0, `rgba(255,255,255,${_lightning.alpha * 0.4})`);
        lgrad.addColorStop(1, 'rgba(0,0,40,0)');
        g.globalAlpha = 1;
        g.fillStyle = lgrad;
        g.fillRect(0, 0, W, H);
        g.restore();
      }

      // Weather overlays
      const wtNow = _weather.type;

      // FOG — grey semi-transparent fill
      if (wtNow === 'FOG') {
        g.save(); g.globalAlpha = 0.12;
        g.fillStyle = '#8899AA'; g.fillRect(0, 0, W, H);
        // subtle fog wisps
        for (let fi = 0; fi < 4; fi++) {
          const fx = (Math.sin(_frame * 0.08 + fi * 1.8) * 0.5 + 0.5) * W;
          const fy = (0.3 + fi * 0.12) * H;
          const fg = g.createRadialGradient(fx, fy, 0, fx, fy, W * 0.35);
          fg.addColorStop(0, 'rgba(140,160,180,0.12)');
          fg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = fg; g.fillRect(0, 0, W, H);
        }
        g.globalAlpha = 1; g.restore();
      }

      // HAZE — neon pink smog
      if (wtNow === 'HAZE') {
        g.save(); g.globalAlpha = 0.05;
        g.fillStyle = '#FF22BB'; g.fillRect(0, 0, W, H);
        g.globalAlpha = 0.04;
        g.fillStyle = '#AA00FF'; g.fillRect(0, H*0.4, W, H*0.6);
        g.globalAlpha = 1; g.restore();
      }

      // RAIN / STORM — acid rain drops
      if (wtNow === 'RAIN' || wtNow === 'STORM') {
        if (!_rain) {
          _rain = [];
          for (let i = 0; i < 180; i++) {
            _rain.push([
              Math.random(),
              Math.random(),
              0.005 + Math.random() * 0.009,
              10 + Math.random() * 18,
              0.10 + Math.random() * 0.22,
            ]);
          }
        }
        const stormMult = wtNow === 'STORM' ? 2.0 : 1.0;
        const dropCol = wtNow === 'STORM' ? '#44FF88' : '#00CCFF';
        const tipCol  = wtNow === 'STORM' ? '#88FFBB' : '#AAEEFF';
        g.save(); g.lineWidth = 0.65;
        const maxDrop = Math.floor(180 * stormMult);
        for (let di = 0; di < Math.min(_rain.length, maxDrop); di++) {
          const rd = _rain[di];
          rd[1] += rd[2] * stormMult;
          if (rd[1] > 1.08) { rd[1] = -0.08; rd[0] = Math.random(); }
          const rx = rd[0] * W, ry = rd[1] * H;
          const dlen = rd[3], angle = 0.30;
          g.globalAlpha = rd[4];
          g.strokeStyle = dropCol;
          g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + dlen * angle, ry + dlen); g.stroke();
          g.globalAlpha = rd[4] * 2.2;
          g.strokeStyle = tipCol;
          g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + 2 * angle, ry + 2); g.stroke();
        }
        g.globalAlpha = 1; g.restore();
      }

      // SNOW / BLIZZARD
      if (wtNow === 'SNOW' || wtNow === 'BLIZZARD') drawSnow(g, W, H);

      // World-space festival particles
      drawParticles(g, W, H);

      // Weather notification overlay
      if (_weather.notifAlpha > 0) {
        const na = Math.min(1, _weather.notifAlpha);
        g.save();
        g.globalAlpha = na;
        g.font = 'bold 11px monospace'; g.textAlign = 'center';
        g.fillStyle = si2 === 0 ? '#FF88CC' : si2 === 1 ? '#FFFF44' : si2 === 2 ? '#FF8833' : '#88CCFF';
        g.shadowColor = g.fillStyle; g.shadowBlur = 12;
        g.fillText(_weather.notifText, W/2, H * 0.20);
        g.shadowBlur = 0;
        g.restore();
      }

      // HUD
      drawHUD(g, W, H, prog, world, s);

      // (removed: purple smog horizon band — this is a clear-sky daytime planet)

      // (screen-glitch "torn signal" overlay removed — it was the random static
      //  streaks across the screen the player was seeing during weather changes.)

      // (removed: full-screen neon interaction flash + big TRANSACTION panel —
      //  they washed out / covered the world. Feedback is now the compact toast
      //  line drawn by drawPlanetToasts() inside drawHUD.)

      // Soft warm vignette — gentle, keeps the daytime brightness
      const vig = g.createRadialGradient(W/2, H*0.45, H*0.34, W/2, H*0.5, H*0.85);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(40,30,10,0.22)');
      g.fillStyle = vig; g.fillRect(0, 0, W, H);

      // Mobile tool UI (toolbar / seed+build strips / market menu) — on top of world
      drawUI(g, s, prog, pKey, W, H);

      // fade overlay — cyberpunk boot sequence on landing, neon title on launch
      if (prog.fadeAlpha>0) {
        g.save();
        g.globalAlpha = prog.fadeAlpha;
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);

        if (prog.fadeDir < 0) {
          // Landing boot sequence — lines appear as the black fades away
          const bp = 1 - prog.fadeAlpha; // 0→1 as screen fades in
          const _bd = world.def || PLANET_DEFS.mira;
          const BOOT = [
            { at:0.04, t:`PORT ${_bd.name.toUpperCase()} // SURFACE SYS v4.0`, c:'#00FFEE' },
            { at:0.14, t:'ATMOSPHERE ......... NOMINAL',     c:'#00FF88' },
            { at:0.24, t:'BIOME SCAN .......... COMPLETE',   c:'#00FF88' },
            { at:0.34, t:'NPC GRID ............ ONLINE',     c:'#FFEE00' },
            { at:0.44, t:'LIFE SIGNS .......... DETECTED',   c:'#FFEE00' },
            { at:0.60, t:`> WELCOME TO ${_bd.name.toUpperCase()} — ${_bd.tag.toUpperCase()}`, c:'#FF0088' },
          ];
          g.textAlign = 'left';
          g.font = `bold 11px monospace`;
          let ly = H * 0.36;
          for (const ln of BOOT) {
            if (bp > ln.at) {
              const la = Math.min(1, (bp - ln.at) * 12) * Math.min(prog.fadeAlpha * 3, 1);
              g.globalAlpha = la;
              g.shadowColor = ln.c; g.shadowBlur = 10;
              g.fillStyle = ln.c;
              g.fillText(ln.t, W * 0.10, ly);
              ly += 18;
            }
          }
          g.shadowBlur = 0;
        } else if (prog.fadeAlpha > 0.4 && prog.fadeMsg) {
          // Launch — neon cyan title
          g.globalAlpha = (prog.fadeAlpha - 0.4) / 0.6;
          g.fillStyle = '#00FFEE'; g.font = 'bold 16px monospace'; g.textAlign = 'center';
          g.shadowColor = '#00FFEE'; g.shadowBlur = 14;
          g.fillText(prog.fadeMsg, W/2, H/2);
          g.shadowBlur = 0;
        }
        g.restore();
      }

    },
  };
})();
// Expose for headless harness (Node eval does not hoist top-level const)
if (typeof globalThis !== "undefined") globalThis.PLANET = PLANET;
