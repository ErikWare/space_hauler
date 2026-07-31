/*=== HARNESS:BATTLE_ARENA ===================================================*/
// N×N sector arena builder. Reuses populateRegion / outpost+site helpers for
// campaign look-and-feel, then hard-clamps the playable AABB. Full solar
// seedWorld is never called for matches.

// Battle ore mix: ONLY the four refinable bar ores, weighted so the cheap ones
// are common and platinum is a genuine find. Exotics (iridium/voidium/…) are
// campaign-only — in a match every rock must convert into bars you can spend on
// drones, so an unrefinable exotic is a dead pickup.
const BATTLE_ORES = [
  { type: "copper",   w: 50 },
  { type: "silver",   w: 27 },
  { type: "gold",     w: 15 },
  { type: "platinum", w: 8 },
];
// Real PNG bodies for arena terrain (procedural polygons read as flat grey).
const BATTLE_OBSTACLE_ART = [
  "planetoid_a", "planetoid_b", "planetoid_c",
  "asteroid_chunk_1", "asteroid_chunk_2", "asteroid_chunk_3",
  "asteroid_chunk_4", "asteroid_chunk_5", "asteroid_chunk_6",
  "wreck_bow", "wreck_hull", "wreck_stern", "wreck_debris",
];

Object.assign(GAME, {
  // Weighted draw from BATTLE_ORES → a CONFIG.rings entry.
  _battleOreRing() {
    let total = 0;
    for (const o of BATTLE_ORES) total += o.w;
    let r = rnd() * total;
    for (const o of BATTLE_ORES) {
      r -= o.w;
      if (r < 0) return this.ringByType ? this.ringByType(o.type)
        : (CONFIG.rings || []).find(x => x.type === o.type);
    }
    return this.ringByType ? this.ringByType("copper")
      : (CONFIG.rings || []).find(x => x.type === "copper");
  },
  // Give a terrain body a real sprite (deterministic per body, from the seed rng).
  _battleArtForObstacle(o) {
    if (!o) return o;
    o.art = BATTLE_OBSTACLE_ART[(rnd() * BATTLE_OBSTACLE_ART.length) | 0];
    return o;
  },
  seedBattleArena(kind, seed) {
    const def = BATTLE.kinds[kind] || BATTLE.kinds.sandbox_1x1;
    const cols = def.cols, rows = def.rows;
    if (seed != null && typeof setSeed === "function") setSeed(seed >>> 0);
    const s = this.state, size = CONFIG.sectorSize, half = size / 2;
    const oC = -Math.floor(cols / 2);
    const oR = -Math.floor(rows / 2);
    const maxAbs = Math.max(
      Math.abs(oC), Math.abs(oC + cols - 1),
      Math.abs(oR), Math.abs(oR + rows - 1)
    );
    const N = Math.max(1, maxAbs);
    const GW = 2 * N + 1;
    s.regionGrid = { size, N, GW };
    s.regions = []; s.regionById = new Map();
    s.fields = []; s.nextFieldId = 1; s.rockFree = [];
    // Quiet anchors so populateRegion lays bg fields (no planet/belt claims).
    s.planets = []; s._moonList = []; s.enemyBases = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = oC + c, row = oR + r;
        const cx = col * size, cy = row * size;
        const dist = Math.hypot(cx, cy);
        const faction = this.factionForPos(cx || 1, cy || 0);
        const region = {
          id: (row + N) * GW + (col + N), col, row, cx, cy, dist,
          faction, owner: faction, outpostId: null,
          fields: [], resources: [], event: null, name: null,
          tier: 1, visited: false, static: true, battle: true,
        };
        s.regions.push(region);
        s.regionById.set(region.id, region);
      }
    }
    for (const region of s.regions) this.populateRegion(region);

    const xs = s.regions.map(r => r.cx), ys = s.regions.map(r => r.cy);
    const bounds = {
      minX: Math.min(...xs) - half,
      maxX: Math.max(...xs) + half,
      minY: Math.min(...ys) - half,
      maxY: Math.max(...ys) + half,
    };
    // Inset so ships don't clip the fog wall
    const inset = 40;
    bounds.minX += inset; bounds.maxX -= inset;
    bounds.minY += inset; bounds.maxY -= inset;

    if (s.battle) {
      s.battle.bounds = bounds;
      s.battle.grid = { cols, rows, originCol: oC, originRow: oR, size };
      // Per-map sky identity: pick a nebula plate + tint from the match seed so
      // each arena feels different (no bright central sun in battle).
      const plates = ["nebula_blue", "nebula_red", "nebula_green"];
      const seedN = (seed != null ? seed : ((Math.random() * 1e9) | 0)) >>> 0;
      const plate = plates[seedN % plates.length];
      const hues = {
        nebula_blue:  { fill: "#050816", glow: "rgba(70,120,220,0.22)", star: "#a8c4ff" },
        nebula_red:   { fill: "#0a0508", glow: "rgba(200,70,60,0.20)",  star: "#ffc0b0" },
        nebula_green: { fill: "#040a08", glow: "rgba(60,180,120,0.18)", star: "#b8f0d0" },
      };
      const look = hues[plate] || hues.nebula_blue;
      s.battle.sky = {
        plate,
        fill: look.fill,
        glow: look.glow,
        star: look.star,
        // slight parallax offset so camera motion drifts the plate
        px: ((seedN >> 3) % 40) - 20,
        py: ((seedN >> 7) % 40) - 20,
        scale: 1.15 + ((seedN >> 11) % 20) * 0.01,
      };
    }

    // Content density by map size
    s.outposts = []; s.sites = []; s.nextSiteId = 1; s.obstacles = []; s.nextObstacleId = 1;
    this._battlePlaceOutposts(cols, rows, def);
    this._battlePlaceSites(cols, rows, def);
    this._battlePlaceObstacles(bounds, cols * rows);
    if (def.control) this._battlePlaceTerrainClutter(bounds);
    this._battleAmbientDebris();

    return { bounds, regions: s.regions.length };
  },

  // Control layout fantasy:
  //   • HOME: each pilot starts with a 3-outpost factory cluster in one region
  //   • MID: mixed density — choke (2), prize (2), flanks (1), quiet (0) + terrain
  //   • Dense asteroid belts / wreckage fields in sparse cells for cover & identity
  // Deathmatch: no outposts.
  _battlePlaceOutposts(cols, rows, def) {
    const s = this.state;
    if (def.deathmatch || (!def.control && cols === 1)) return;
    if (!def.control) return;

    const cells = s.regions.slice();
    cells.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy));
    const homeP1 = cells[0];
    const homeP2 = cells[cells.length - 1];
    const contested = cells.filter(r => r !== homeP1 && r !== homeP2);

    // Tag terrain roles on regions (used by clutter + layout HUD)
    for (const r of s.regions) r.battleTerrain = null;
    homeP1.battleTerrain = "home_p1";
    homeP2.battleTerrain = "home_p2";

    let nid = 1;
    const mk = (region, owner, tag, ox, oy) => {
      const dl = Math.max(2, Math.min(8, (s.battle && s.battle.danger) || 4));
      const o = {
        id: "bop" + (nid++), kind: "outpost",
        x: region.cx + ox, y: region.cy + oy, regionId: region.id,
        faction: region.faction,
        owner: owner,
        homeSide: tag || null,
        dangerLevel: dl,
        discovered: owner === "player" || owner === "rival",
        provoked: false, capturable: owner !== "player" && owner !== "rival",
        streamed: false,
        shieldMax: 300, shield: 300, armorMax: 200, armor: 200, hullMax: 150, hull: 150,
        shieldRegen: 5, turretCd: 0, turretFireRate: 3000,
        turretDmg: Math.round(6 * (1 + dl * 0.12) * 10) / 10,
        turretRange: 600 + (dl - 1) * 40,
        guardRecs: [{ frac: 1, alive: true }, { frac: 1, alive: true }, { frac: 1, alive: true }],
        _ships: [], droneGuards: [], underAttack: null,
        modules: [], stationedDrones: [], battle: true,
      };
      if (owner === "player" || owner === "rival") {
        o.capturable = false;
        o.hull = o.hullMax; o.shield = o.shieldMax; o.armor = o.armorMax;
      }
      o._def0 = {
        shieldMax: o.shieldMax, armorMax: o.armorMax, hullMax: o.hullMax,
        shieldRegen: o.shieldRegen, turretDmg: o.turretDmg, turretRange: o.turretRange,
      };
      s.outposts.push(o);
      if (!region.outpostId) {
        region.outpostId = o.id;
        region.event = { type: "outpost", id: o.id };
      }
      if (owner === "player") region.owner = "player";
      else if (owner === "rival") region.owner = "rival";
      return o;
    };

    const homeCluster = (region, owner, tag) => {
      const r = CONFIG.sectorSize * 0.18;
      mk(region, owner, tag, -r * 0.7, -r * 0.4);
      mk(region, owner, tag, r * 0.75, -r * 0.35);
      mk(region, owner, tag, 0, r * 0.65);
    };
    homeCluster(homeP1, "player", "p1");
    homeCluster(homeP2, "rival", "p2");

    // ---- Contested density plan (not uniform) ----
    // Score cells by how "mid-lane" they are (distance to both homes, prefer center).
    const mcx = (homeP1.cx + homeP2.cx) * 0.5;
    const mcy = (homeP1.cy + homeP2.cy) * 0.5;
    const scored = contested.map(reg => {
      const toMid = Math.hypot(reg.cx - mcx, reg.cy - mcy);
      const toP1 = Math.hypot(reg.cx - homeP1.cx, reg.cy - homeP1.cy);
      const toP2 = Math.hypot(reg.cx - homeP2.cx, reg.cy - homeP2.cy);
      const balance = Math.abs(toP1 - toP2); // low = on the diagonal between homes
      return { reg, toMid, balance, score: toMid + balance * 0.35 };
    }).sort((a, b) => a.score - b.score);

    // Assign roles by rank — creates readable variety
    // 3×3 (~7 mid): prize, choke, choke, flank, flank, belt, wreck
    // 2×2 (~2 mid): prize + choke
    const roles3 = ["prize", "choke", "choke", "flank", "flank", "asteroid_belt", "wreck_field"];
    const roles2 = ["prize", "choke"];
    const roles = cols >= 3 ? roles3 : roles2;
    const density = {
      prize: 2,          // important dual node
      choke: 2,          // corridor fights
      flank: 1,          // single take
      asteroid_belt: 0,  // no outpost — pure terrain
      wreck_field: 1,    // one derelict platform in scrap
      sparse: 0,
    };

    for (let i = 0; i < scored.length; i++) {
      const reg = scored[i].reg;
      const role = roles[i] || (i % 2 === 0 ? "flank" : "asteroid_belt");
      reg.battleTerrain = role;
      const n = density[role] != null ? density[role] : 1;
      for (let k = 0; k < n; k++) {
        const a = (k / Math.max(1, n)) * Math.PI * 2 + (reg.id % 5) * 0.4;
        const jd = CONFIG.sectorSize * (0.12 + k * 0.08 + (role === "prize" ? 0.04 : 0));
        mk(reg, reg.faction, "mid", Math.cos(a) * jd, Math.sin(a) * jd);
      }
      // Prize hub: optional third satellite slightly off-center (3×3 only)
      if (role === "prize" && cols >= 3) {
        mk(reg, reg.faction, "mid", CONFIG.sectorSize * 0.02, -CONFIG.sectorSize * 0.12);
      }
    }

    if (s.battle) {
      s.battle.homeRegions = { p1: homeP1.id, p2: homeP2.id };
      const terr = {};
      for (const r of s.regions) if (r.battleTerrain) terr[r.battleTerrain] = (terr[r.battleTerrain] || 0) + 1;
      s.battle.layout = {
        homeP1: homeP1.id, homeP2: homeP2.id,
        p1Outposts: s.outposts.filter(o => o.homeSide === "p1").length,
        p2Outposts: s.outposts.filter(o => o.homeSide === "p2").length,
        midOutposts: s.outposts.filter(o => o.homeSide === "mid").length,
        terrain: terr,
      };
    }
  },

  _battlePlaceSites(cols, rows, def) {
    const s = this.state;
    // Deathmatch: one wreck. Control: wrecks land in wreck_field / flank cells.
    if (def.deathmatch || (!def.control && cols === 1)) {
      if (s.regions[0] && typeof this._makeSite === "function") this._makeSite(s.regions[0], null);
      return;
    }
    if (!def.control || typeof this._makeSite !== "function") return;
    let placed = 0;
    // Prefer terrain-tagged wreck fields, then flanks without heavy outposts
    const order = s.regions.slice().sort((a, b) => {
      const ra = a.battleTerrain === "wreck_field" ? 0 : a.battleTerrain === "flank" ? 1 : 2;
      const rb = b.battleTerrain === "wreck_field" ? 0 : b.battleTerrain === "flank" ? 1 : 2;
      return ra - rb;
    });
    const want = cols >= 3 ? 5 : 2;
    for (const region of order) {
      if (placed >= want) break;
      if (region.battleTerrain === "home_p1" || region.battleTerrain === "home_p2") continue;
      // Don't pile sites on prize hubs
      if (region.battleTerrain === "prize") continue;
      const prev = region.site;
      const site = this._makeSite(region, null);
      if (site) {
        // Offset so multi-outpost regions still read as separate POIs
        const a = rnd() * Math.PI * 2;
        site.x = region.cx + Math.cos(a) * CONFIG.sectorSize * 0.2;
        site.y = region.cy + Math.sin(a) * CONFIG.sectorSize * 0.2;
        site.battle = true;
        placed++;
      }
      // Restore outpost primary if site stole region.event — keep both present
      if (prev) region.site = region.site || prev;
    }
  },

  _battlePlaceObstacles(bounds, cells) {
    const s = this.state;
    // Light ambient rocks everywhere
    const ambient = Math.min(18, 4 + cells * 2);
    this._battleScatterObstacles(bounds, ambient, 320, 40, 90);
  },

  // Dense asteroid belts + wreckage junk fields keyed to region.battleTerrain
  _battlePlaceTerrainClutter(bounds) {
    const s = this.state;
    if (!s.regions || !s.regions.length) return;
    if (!s.junk) s.junk = [];
    if (!s.rocks) s.rocks = [];
    for (const reg of s.regions) {
      const role = reg.battleTerrain;
      if (!role) continue;
      if (role === "asteroid_belt") {
        // The map's ore motherlode — worth fighting over and worth hauling from
        this._battleAsteroidCluster(reg.cx, reg.cy, CONFIG.sectorSize * 0.30, 34 + ((rnd() * 10) | 0));
        this._battleScatterObstaclesAround(reg.cx, reg.cy, CONFIG.sectorSize * 0.26, 8, 50, 110);
        reg.battleLandmark = "ASTEROID BELT";
      } else if (role === "wreck_field") {
        // The fuel depot: junk hauled to an outpost refunds fuel (economy.js)
        this._battleWreckageField(reg.cx, reg.cy, CONFIG.sectorSize * 0.24, 26 + ((rnd() * 9) | 0));
        this._battleScatterObstaclesAround(reg.cx, reg.cy, CONFIG.sectorSize * 0.20, 7, 35, 75);
        reg.battleLandmark = "WRECK YARD";
      } else if (role === "choke") {
        this._battleAsteroidCluster(reg.cx, reg.cy, CONFIG.sectorSize * 0.12, 14);
        this._battleWreckageField(reg.cx, reg.cy, CONFIG.sectorSize * 0.14, 7);
        reg.battleLandmark = "CHOKE";
      } else if (role === "prize") {
        this._battleAsteroidCluster(reg.cx, reg.cy, CONFIG.sectorSize * 0.16, 12);
        reg.battleLandmark = "PRIZE HUB";
      } else if (role === "flank") {
        this._battleAsteroidCluster(reg.cx, reg.cy, CONFIG.sectorSize * 0.10, 10);
        this._battleWreckageField(reg.cx, reg.cy, CONFIG.sectorSize * 0.12, 6);
        reg.battleLandmark = "FLANK";
      }
    }
  },

  _battleAsteroidCluster(cx, cy, radius, count) {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      this._battleAddRock(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
  },

  _battleWreckageField(cx, cy, radius, count) {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      this._battleAddJunk(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 40);
    }
  },

  // Ambient campaign-feel debris: EVERY cell gets a scatter of minable rock +
  // salvage junk so arenas read like lived-in space, not empty geometry.
  // All map kinds (deathmatch included) — spawnBattleDuel strips outposts, not
  // debris. Static (vx/vy 0) so the sim cost is just draw + tow checks.
  _battleAmbientDebris() {
    const s = this.state;
    if (!s.regions || !s.regions.length) return;
    if (!s.rocks) s.rocks = [];
    if (!s.junk) s.junk = [];
    const half = CONFIG.sectorSize * 0.46;
    for (const reg of s.regions) {
      // Dense enough that any cell you fly into has something to haul — ore for
      // bars (→ drones) and junk for fuel. Nothing here respawns, so the map is
      // a finite, contested resource pool both pilots are drawing down.
      const nR = 24 + ((rnd() * 9) | 0);
      const nJ = 13 + ((rnd() * 7) | 0);
      for (let i = 0; i < nR; i++) {
        const x = reg.cx + (rnd() * 2 - 1) * half;
        const y = reg.cy + (rnd() * 2 - 1) * half;
        this._battleAddRock(x, y);
      }
      for (let i = 0; i < nJ; i++) {
        const x = reg.cx + (rnd() * 2 - 1) * half;
        const y = reg.cy + (rnd() * 2 - 1) * half;
        this._battleAddJunk(x, y, 60);
      }
    }
  },

  // One static battle ore rock at (x,y), ore type drawn from BATTLE_ORES.
  _battleAddRock(x, y) {
    const s = this.state;
    if (typeof this.makeRock !== "function") return null;
    const ring = this._battleOreRing();
    if (!ring) return null;
    const rock = this.makeRock(ring, { x, y });
    if (!rock) return null;
    rock.x = x; rock.y = y; rock.vx = 0; rock.vy = 0;
    rock.spinV = (rock.spinV || 0) * 0.2;
    rock.battle = true; rock.fieldId = null;
    s.rocks.push(rock);
    return rock;
  },

  _battleAddJunk(x, y, spread) {
    const s = this.state;
    if (typeof this.makeJunkAt !== "function") return null;
    const j = this.makeJunkAt(x, y, spread || 0, null);
    if (!j) return null;
    j.battle = true; j.vx = 0; j.vy = 0;
    s.junk.push(j);
    return j;
  },

  _battleScatterObstacles(bounds, n, minCenter, rMin, rMax) {
    const s = this.state;
    const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
    let placed = 0, tries = 0;
    while (placed < n && tries < n * 14) {
      tries++;
      const x = bounds.minX + 120 + rnd() * Math.max(1, w - 240);
      const y = bounds.minY + 120 + rnd() * Math.max(1, h - 240);
      if (Math.hypot(x, y) < (minCenter || 280)) continue;
      const r = (rMin || 40) + rnd() * ((rMax || 90) - (rMin || 40));
      if (typeof this.makeObstacle === "function") {
        const o = this.makeObstacle(x, y, r, (rnd() * 3) | 0);
        o.battle = true; o.vx *= 0.35; o.vy *= 0.35;
        this._battleArtForObstacle(o);
        s.obstacles.push(o);
      }
      placed++;
    }
  },

  _battleScatterObstaclesAround(cx, cy, radius, n, rMin, rMax) {
    const s = this.state;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * radius;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const r = (rMin || 40) + rnd() * ((rMax || 90) - (rMin || 40));
      if (typeof this.makeObstacle === "function") {
        const o = this.makeObstacle(x, y, r, (rnd() * 3) | 0);
        o.battle = true; o.vx *= 0.2; o.vy *= 0.2;
        this._battleArtForObstacle(o);
        s.obstacles.push(o);
      }
    }
  },

  // Hard walls for the active match AABB.
  clampBattleBounds() {
    const s = this.state;
    if (!this.isBattleMatch()) return;
    const b = s.battle && s.battle.bounds;
    if (!b) return;
    if (s.x < b.minX) { s.x = b.minX; if (s.vx < 0) s.vx = 0; }
    if (s.x > b.maxX) { s.x = b.maxX; if (s.vx > 0) s.vx = 0; }
    if (s.y < b.minY) { s.y = b.minY; if (s.vy < 0) s.vy = 0; }
    if (s.y > b.maxY) { s.y = b.maxY; if (s.vy > 0) s.vy = 0; }
    // Keep wingmen inside too
    if (s.playerFleet) {
      for (const d of s.playerFleet) {
        if (d.role !== "escort" && d.role !== "tank") continue;
        if (d.x < b.minX) d.x = b.minX;
        if (d.x > b.maxX) d.x = b.maxX;
        if (d.y < b.minY) d.y = b.minY;
        if (d.y > b.maxY) d.y = b.maxY;
      }
    }
  },

  drawBattleBounds(g) {
    if (HEADLESS || !this.isBattleMatch()) return;
    const bat = this.state.battle;
    const b = bat && bat.bounds;
    if (!b || !this.SF) return;
    const p1 = this.SF(b.minX, b.minY), p2 = this.SF(b.maxX, b.maxY);
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
    g.save();
    // Full arena walls (no shrinking zone)
    g.strokeStyle = "rgba(255,180,94,0.45)";
    g.lineWidth = 2;
    g.setLineDash([10, 8]);
    g.strokeRect(x, y, w, h);
    g.setLineDash([]);
    g.fillStyle = "rgba(5,8,16,0.35)";
    g.fillRect(0, 0, CONFIG.W, y);
    g.fillRect(0, y + h, CONFIG.W, CONFIG.H - (y + h));
    g.fillRect(0, y, x, h);
    g.fillRect(x + w, y, CONFIG.W - (x + w), h);
    g.restore();
  },
});
