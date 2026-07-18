/*=== HARNESS:REGIONS ========================================================*/
// Static sector grid + Region Event Manager. The disc is tiled by a fixed square
// grid (CONFIG.sectorSize); every in-disc cell is a numbered REGION guaranteed at
// least one resource field. Anchors (belt / planet ring / moon / nebula / base /
// station) claim their region's field type; the rest get a distance-tiered
// background field. Rich regions roll 2–3 fields with mixed ore.
//
// Regions and the map are STATIC (seed-deterministic), so "fly to region 178 at
// x,y, do something, fly home" is a stable navigation contract quests can lean on.
// updateRegions() is the manager: it tracks the ship's region, fires enter hooks,
// and exposes a content-scaling seam for quest-driven tuning (regionContentLevel).
Object.assign(GAME, {
  _regionInCell(region, x, y) {
    const h = CONFIG.sectorSize / 2;
    return Math.abs(x - region.cx) <= h && Math.abs(y - region.cy) <= h;
  },
  regionByColRow(col, row) {
    const g = this.state.regionGrid; if (!g) return null;
    if (col < -g.N || col > g.N || row < -g.N || row > g.N) return null;
    return this.state.regionById.get((row + g.N) * g.GW + (col + g.N)) || null;
  },
  regionAt(x, y) {
    const g = this.state.regionGrid; if (!g) return null;
    return this.regionByColRow(Math.round(x / g.size), Math.round(y / g.size));
  },
  regionGet(id) { return this.state.regionById ? this.state.regionById.get(id) || null : null; },
  regionLabel(region) { return region ? "R-" + region.id : "—"; },
  // faction territory: the system divides like a PIE — each faction owns a
  // 120° wedge from the sun to the rim (Vex 0–120° · Krag 120–240° · Nox
  // 240–360°). game/regions.js subdivides the wedges into the political
  // sub-regions; the sector grid and outpost seeding inherit these wedges.
  // (CONFIG.factionZones remains only for the legacy planet faction tags.)
  factionForPos(x, y) {
    let a = Math.atan2(y, x) * 180 / Math.PI;
    if (a < 0) a += 360;
    return a < 120 ? "vex" : a < 240 ? "krag" : "nox";
  },

  // Which anchors intersect a region (drives its guaranteed field type[s]).
  _regionAnchors(region) {
    const s = this.state, C = CONFIG, d = region.dist, half = C.sectorSize / 2, anchors = [];
    if (d >= C.asteroidBelt.innerR - half && d <= C.asteroidBelt.outerR + half) anchors.push("belt");
    for (const p of s.planets) if (Math.abs(d - p.orbit) < half) { anchors.push("ring"); break; }
    for (const m of (s._moonList || [])) if (this._regionInCell(region, m.x, m.y)) { anchors.push("moon"); break; }
    for (const nb of ForgeWorld.getNebulas()) if (this._regionInCell(region, nb.pos.x, nb.pos.y)) { anchors.push("nebula"); break; }
    for (const b of (s.enemyBases || [])) if (this._regionInCell(region, b.x, b.y)) { anchors.push("base"); break; }
    return anchors;
  },

  // Give a region its event marker (station) + at least one resource field.
  populateRegion(region) {
    const s = this.state, C = CONFIG;
    // station event (a region can hold the station AND still carry ore)
    for (const st of ForgeWorld.getStations())
      if (this._regionInCell(region, st.pos.x, st.pos.y)) { region.event = { type: "station", id: st.id }; region.name = st.name; break; }

    const anchors = this._regionAnchors(region);
    const kinds = anchors.length ? anchors.slice() : ["bg"];
    // richness: multi-anchor regions are naturally rich; plain regions roll extras
    let extra = 0;
    if (anchors.length >= 2) extra = 1;
    else { const roll = rnd(); if (roll < C.regionRich3Chance) extra = 2; else if (roll < C.regionRich2Chance) extra = 1; }
    for (let e = 0; e < extra; e++) kinds.push("rich");
    // exotic vein roll: never in a station's sector; chance from the distance
    // band (config.exoticOres — deeper bands hold rarer ore at lower odds).
    // region.exotic makes seedOutposts skip this sector, so a vein never shares
    // a sector with a station OR an outpost. Skips already-busy 3-field regions
    // to keep the ≤3 fields/region invariant.
    const isStationRegion = region.event && region.event.type === "station";
    if (!isStationRegion && kinds.length < 3 && region.dist >= C.exoticMinDist) {
      const band = C.exoticOres.find(b => region.dist <= b.maxDist) || C.exoticOres[C.exoticOres.length - 1];
      if (rnd() < band.chance) { kinds.push("exotic"); region.exotic = true; }
    }

    for (let i = 0; i < kinds.length; i++) {
      // anchor fields stay centered on their anchor; extras/bg jitter for variety
      const jitter = !(kinds[i] === "belt" || kinds[i] === "ring") || i > 0;
      const f = this.makeRegionField(region, kinds[i], jitter);
      region.fields.push(f.id);
      if (region.resources.indexOf(f.oreType) < 0) region.resources.push(f.oreType);
      s.fields.push(f);
    }
    region.tier = this.regionContentLevel(region);
  },

  // Build the static grid + every region's content. Called from seedWorld AFTER
  // planets / moons / enemy bases / nebulas exist (anchors need them).
  seedRegions() {
    const s = this.state, C = CONFIG, size = C.sectorSize;
    const N = Math.ceil(C.WORLD_RADIUS / size), GW = 2 * N + 1;
    s.regionGrid = { size, N, GW };
    s.regions = []; s.regionById = new Map();
    s.fields = []; s.nextFieldId = 1; s.rockFree = [];
    for (let row = -N; row <= N; row++) for (let col = -N; col <= N; col++) {
      const cx = col * size, cy = row * size, dist = Math.hypot(cx, cy);
      if (dist > C.WORLD_RADIUS) continue;   // cell center outside the disc
      const faction = this.factionForPos(cx, cy);
      const region = { id: (row + N) * GW + (col + N), col, row, cx, cy, dist,
        faction, owner: faction, outpostId: null,
        fields: [], resources: [], event: null, name: null, tier: 1, visited: false, static: false };
      s.regions.push(region);
      s.regionById.set(region.id, region);
    }
    for (const region of s.regions) this.populateRegion(region);
  },

  // ---- Region Event Manager ------------------------------------------------
  // Content-scaling seam: today a simple distance tier; later this folds in quest
  // progress so a region's field capacity/ore can scale as the player advances.
  regionContentLevel(region) {
    return region.dist < 20000 ? 1 : region.dist < 45000 ? 2 : 3;
  },
  onEnterRegion(region) {
    region.visited = true;
    // future: activate region-specific events, scale content by quest state,
    // fire contract "reached region N" triggers. Kept a no-op-ish hook for now.
  },
  updateRegions() {
    const s = this.state;
    if (!s.regions || !s.regions.length) return;
    const cur = this.regionAt(s.x, s.y), curId = cur ? cur.id : null;
    if (curId !== s.currentRegionId) {
      s.currentRegionId = curId; if (cur) this.onEnterRegion(cur);
      const dl = getDangerLevel(s.x, s.y);   // lifetime high-water SEC mark (unlock stat)
      if (dl > (s.maxDangerReached || 1)) s.maxDangerReached = dl;
    }
  },
});
