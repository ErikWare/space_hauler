/*=== HARNESS:PLANET_DATA =====================================================*/
// Static data for all 8 planet surfaces: tile maps, crops, buildings, NPCs.
// All planet systems read from this one global — no circular deps, no canvas.

const PLANET_DATA = (() => {
  // ── tile type IDs ──────────────────────────────────────────────────────────
  const T = {
    GRASS: 0,
    DIRT:  1,
    TREE:  2,
    STONE: 3,
    WATER: 4,
    CROP:  5,
    ROAD:  6,
  };

  // ── display colours (placeholder; real sprites swap in later) ──────────────
  const TILE_COLORS = {
    [T.GRASS]: "#3a8a4a",
    [T.DIRT]:  "#8a6a42",
    [T.TREE]:  "#1a5a2a",
    [T.STONE]: "#6a6870",
    [T.WATER]: "#3070b8",
    [T.CROP]:  "#7a5a30",
    [T.ROAD]:  "#9a8070",
  };

  // ── Mira tile map (80 × 60) — built procedurally ──────────────────────────
  // Layout:
  //   Cols  0– 1  : tree border W
  //   Cols  2–26  : FARM ZONE (dirt + crop grid, house area, launch pad)
  //   Cols 27–28  : tree divider, road break at rows 24–28
  //   Cols 29–77  : TOWN ZONE (grass, market square, pond, industrial SE)
  //   Cols 78–79  : tree border E
  //   Rows  0– 1  : tree border N
  //   Rows 58–59  : tree border S
  function buildMiraMap() {
    const W = 80, H = 60;
    const m = new Uint8Array(W * H);
    const set = (x, y, t) => { if (x >= 0 && x < W && y >= 0 && y < H) m[y * W + x] = t; };
    const fill = (x1, y1, x2, y2, t) => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) set(x, y, t);
    };

    // base: grass everywhere
    m.fill(T.GRASS);

    // map borders (impassable tree walls)
    fill(0, 0, W - 1, 1, T.TREE);
    fill(0, H - 2, W - 1, H - 1, T.TREE);
    fill(0, 0, 1, H - 1, T.TREE);
    fill(W - 2, 0, W - 1, H - 1, T.TREE);

    // dense wilderness strip at north
    fill(2, 2, W - 3, 3, T.TREE);

    // ── FARM ZONE: cols 2–26, rows 4–57 ──
    fill(2, 4, 26, 57, T.DIRT);

    // house / village green near spawn (rows 4–11)
    fill(2, 4, 26, 11, T.GRASS);

    // launch pad: stone slab (cols 5–11, rows 35–43)
    fill(5, 35, 11, 43, T.STONE);
    // landing marker (darker center of pad)
    fill(7, 37, 9, 41, T.ROAD);

    // well: two stone tiles at (18-19, 9)
    fill(18, 9, 19, 9, T.STONE);

    // crop grid: every 4 rows, pairs of CROP tiles (rows 13–50, cols 3–24)
    for (let row = 13; row <= 50; row += 4) {
      for (let col = 3; col <= 24; col += 3) {
        fill(col, row, col + 1, row + 2, T.CROP);
      }
    }

    // dirt road running N–S through farm (col 25–26) up to the tree divider
    fill(25, 4, 26, 57, T.ROAD);

    // ── TREE DIVIDER: cols 27–28 ──
    fill(27, 4, 28, 57, T.TREE);
    // road break through the divider at rows 24–28
    fill(27, 24, 28, 28, T.ROAD);

    // ── TOWN ZONE: cols 29–77, rows 4–57 ──
    // base is grass
    fill(29, 4, 77, 57, T.GRASS);

    // market square paved in stone (cols 38–60, rows 10–32)
    fill(38, 10, 60, 32, T.STONE);
    // seedseller stall: dirt highlight at (48–53, 10–15)
    fill(48, 10, 53, 15, T.DIRT);

    // pond / water feature (cols 62–68, rows 14–21)
    fill(62, 14, 68, 21, T.WATER);

    // main E–W road through town at rows 24–25 (connects farm road to town)
    fill(29, 24, 77, 25, T.ROAD);

    // N–S road through town at cols 50–51 (connects market to industrial)
    fill(50, 4, 51, 57, T.ROAD);

    // industrial district SE: stone (cols 29–77, rows 44–57)
    fill(29, 44, 77, 57, T.STONE);
    // machinery terminals: darker road tiles
    fill(32, 47, 52, 55, T.ROAD);

    // ── RACE TRACK: small oval in west town zone (cols 29-37, rows 27-42) ──
    fill(29, 27, 37, 27, T.ROAD);           // north straight
    fill(29, 42, 37, 42, T.ROAD);           // south straight / start-finish
    fill(29, 28, 29, 41, T.ROAD);           // west side
    fill(37, 28, 37, 41, T.ROAD);           // east side
    fill(30, 43, 36, 43, T.STONE);          // start/finish marker

    // southern wilderness (extra tree band above border)
    fill(2, 56, 26, 57, T.TREE);
    fill(29, 56, 77, 57, T.TREE);

    return m;
  }

  // ── Race track constants ────────────────────────────────────────────────────
  const RACE_TRACK = {
    startX: 33, startY: 43,   // car teleports here at race start
    waypoints: [
      { tx: 29, ty: 27 }, // NW corner
      { tx: 33, ty: 27 }, // N mid
      { tx: 37, ty: 27 }, // NE corner
      { tx: 37, ty: 34 }, // E mid
      { tx: 37, ty: 42 }, // SE corner
      { tx: 33, ty: 42 }, // S mid = lap complete
      { tx: 29, ty: 42 }, // SW corner
      { tx: 29, ty: 34 }, // W mid
    ],
    lapWpIdx: 5,
    lapZone: { x1: 29, x2: 37, y1: 41.5, y2: 44 },
    aiSpeed: 6.5,
    totalLaps: 3,
  };

  // ── crop definitions ───────────────────────────────────────────────────────
  // baseTurns: sleep turns until harvest at full growth (watering removes 1/water)
  const CROPS = {
    potato:   { name: "Potato",    baseTurns: 4, sellValue: 40,  seedCost: 8,  dotColor: "#d4a047" },
    wheat:    { name: "Wheat",     baseTurns: 3, sellValue: 30,  seedCost: 6,  dotColor: "#e8c840" },
    beet:     { name: "Mira Beet", baseTurns: 5, sellValue: 70,  seedCost: 12, dotColor: "#c0304a" },
    starfern: { name: "Starfern",  baseTurns: 6, sellValue: 120, seedCost: 20, dotColor: "#40d8a0" },
    sunbloom: { name: "Sunbloom",  baseTurns: 8, sellValue: 200, seedCost: 35, dotColor: "#ffd060" },
  };

  // ── building definitions ───────────────────────────────────────────────────
  // creditsPerSleep: passive income awarded each time the player sleeps
  const BUILDINGS = {
    windmill:    { name: "Windmill",    cost: 500,  creditsPerSleep: 20, size: 2, color: "#e8e8c0" },
    barn:        { name: "Barn",        cost: 800,  creditsPerSleep: 35, size: 3, color: "#c06030" },
    solar_array: { name: "Solar Array", cost: 1200, creditsPerSleep: 50, size: 2, color: "#60a8d0" },
    relay_post:  { name: "Relay Post",  cost: 600,  creditsPerSleep: 25, size: 1, color: "#d0c070" },
    water_tank:  { name: "Water Tank",  cost: 400,  creditsPerSleep: 15, size: 2, color: "#70c0d8" },
  };

  // ── NPC definitions for Mira ───────────────────────────────────────────────
  // tx/ty: tile coords; interact radius 2 tiles
  // greeting: first line; dialogue: subsequent lines (cycle through with E)
  const NPCS_MIRA = [
    {
      id: "dox", name: "Seedseller Dox", tx: 52, ty: 15, isShop: true,
      portrait: "#ffd060",
      greeting: "Welcome, Hauler. Mira's soil is the richest this side of the belt.",
      dialogue: [
        "Seeds, seeds, and more seeds. What'll it be?",
        "The Krag let us farm in peace. Mostly. Don't ask about the eastern towers.",
        "That starfern takes a while — but off-world buyers pay triple. Trust me.",
      ],
    },
    {
      id: "brek", name: "Foreman Brek", tx: 55, ty: 20, isShop: false, isRepair: true,
      portrait: "#ff8040",
      greeting: "Back again? The relay tower's still offline. Don't ask.",
      dialogue: [
        "Krag HQ wants a production report every moon cycle. I send them the same one each time.",
        "Three scouts went into the wilderness last month. Two came back. One found religion.",
        "You ever wonder why the Nox never attack Mira? I do. Every night.",
      ],
    },
    {
      id: "kel", name: "Watcher Kel", tx: 70, ty: 8, isShop: false,
      portrait: "#80d0ff",
      greeting: "I watch the sky. Mostly I see the Nox watching back.",
      dialogue: [
        "Before the war, the Nox were teachers. They shared star charts freely.",
        "Something changed them. Or something showed them what was coming.",
        "The Vex got their war because someone whispered the right lies. I know who did it.",
      ],
    },
    {
      id: "elder", name: "Elder Mira", tx: 10, ty: 8, isShop: false,
      portrait: "#90e890",
      greeting: "You must be the pilot they're talking about. This planet shares my name, you know.",
      dialogue: [
        "My grandmother was on the first colony ship. She said the Nox waved from orbit.",
        "The war started when a Vex patrol was ambushed — but no Nox ship fired the shot.",
        "I have star charts from before. The fleet signatures don't match. Someone forged the attack.",
        "The Nox were framed. The war was engineered. By whom? I think you already suspect.",
      ],
    },
    {
      id: "fen", name: "Rancher Fen", tx: 42, ty: 20, isShop: false, isLivestock: true,
      portrait: "#80c860",
      greeting: "Animals, fences, barns. That's the holy trinity of Mira ranching.",
      dialogue: [
        "Fence your animals. An unfenced grubhen is a wandering grubhen.",
        "Mira Ox produce well but they'll walk off a cliff if you let them.",
        "A barn keeps them calm overnight. Worth every credit.",
      ],
    },
    {
      id: "vane", name: "Scout Vane", tx: 65, ty: 40, isShop: false,
      portrait: "#d880ff",
      greeting: "Just got back from the southern edge. Don't go there.",
      dialogue: [
        "Deep craters down south. Too uniform. Not natural formation.",
        "The Nox built something here, long before us. We're farming on top of their archive.",
        "When you get to the outer system — stay away from Halveth's fourth moon. I mean it.",
      ],
    },
    {
      id: "krag_agent", name: "Krag Agent", tx: 73, ty: 50, isShop: false, isKrag: true,
      portrait: "#a06040",
      greeting: "Toll: 50cr. Our eastern buyers pay half again what Dox offers. Your choice.",
      dialogue: [
        "Premium crops, starfern especially, fetch twice the rate in the eastern depots.",
        "The Krag don't ask questions about provenance. That's worth something.",
        "Come back when you have product worth moving.",
      ],
    },
  ];

  // ── animal definitions ────────────────────────────────────────────────────
  // creditsPerSleep: income per non-escaped animal each time the player sleeps
  // (×1.5 if a barn exists; animals escape if they reach the map border unfenced)
  const ANIMALS = {
    grubhen:   { name: "Grubhen",    cost: 100, creditsPerSleep: 12, dotColor: "#e8c870", desc: "Lays eggs. Cheap and reliable." },
    woolbeast: { name: "Woolbeast",  cost: 250, creditsPerSleep: 28, dotColor: "#d0c8ff", desc: "Thick fibrous coat. Steady yield." },
    mira_ox:   { name: "Mira Ox",   cost: 500, creditsPerSleep: 55, dotColor: "#c08040", desc: "Heavy producer. Escape-prone." },
  };

  // ── planet stub data (7 other worlds — no surface yet) ────────────────────
  const STUBS = {
    vesper:    { name: "Vesper",    msg: "Bare rock, Vex mining claims. No landing zone cleared." },
    cinder:    { name: "Cinder",    msg: "Lava plains. No landing without heat shielding." },
    arix:      { name: "Arix",      msg: "Gas giant — no surface to land on." },
    dusk:      { name: "Dusk",      msg: "Ice fields, Krag ice-drilling rigs. Pad not yet cleared." },
    sorn:      { name: "Sorn",      msg: "Desert heat. Krag sand-caravan hub. Landing zone coming soon." },
    halveth:   { name: "Halveth",   msg: "Gas giant — no surface. The moons are another matter." },
    nox_prime: { name: "Nox Prime", msg: "Silence. The beacon on approach reads only static." },
  };

  // ── special tile positions on Mira ─────────────────────────────────────────
  const SPECIAL_MIRA = {
    bed:  { tx: 5,  ty: 7  },   // sleep interaction
    ship: { tx: 8,  ty: 39 },   // launch interaction (center of pad)
    car:  { tx: 8,  ty: 31 },   // car start position
    well: { tx: 18, ty: 9  },   // decorative
  };

  return { T, TILE_COLORS, buildMiraMap, CROPS, BUILDINGS, ANIMALS, NPCS_MIRA, STUBS, SPECIAL_MIRA, RACE_TRACK };
})();
