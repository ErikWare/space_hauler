/*=== HARNESS:LINEAGE ========================================================*/
// Territory lineage — the canonical territory → content lookup. Joins the 10
// political territories (the named wedges in game/regions.js) to everything
// that lives inside them: their station (quest hub), their R-#### sector-grid
// cells (world/regions.js), and the ownable entity per cell. Quests,
// objectives, and the galaxy map consume these three queries in later phases;
// nothing here runs per frame — the index builds lazily on the first query and
// rebuilds only when the underlying world arrays are replaced (a new init /
// new game), detected by array identity.
//
// Terminology: TERRITORY = one of the 10 big political wedges ("The Crucible"
// … "Pale March"); REGION = an R-#### 4000u grid cell. Queries take the
// territory's display name as used in game/regions.js (the political id like
// "vex_crucible" is accepted too). Region ids returned are the NUMERIC grid
// ids (format for display with GAME.regionLabel → "R-####").
//
// Ownables: one entry per region cell — { regionId, type, entity } where type
// is "outpost" (entity = the live outpost), "site" (entity = the game/sites.js
// landmark record — Phase 4 replaced the old drifting-obstacle "largeBody"
// placeholder with these), or null (nothing ownable there yet, entity = null).
const LINEAGE = { cache: null };

function _territoryDef(territoryName) {
  return REGIONS.find(t => t.name === territoryName || t.id === territoryName) || null;
}

// Build (or reuse) the full index: territory id → { station, regionIds, ownables }.
function _lineageIndex() {
  const s = GAME.state;
  if (!s || !s.regions || !s.regions.length) return null;   // world not seeded yet
  const stations = ForgeWorld.getStations();
  const c = LINEAGE.cache;
  if (c && c.regions === s.regions && c.stations === stations && c.stationN === stations.length &&
      c.outposts === s.outposts && c.sites === s.sites) return c;

  const byTerritory = new Map();
  for (const t of REGIONS) byTerritory.set(t.id, { station: null, regionIds: [], ownables: [] });
  const entryAt = (x, y) => { const t = politicalRegionAt(x, y); return t ? byTerritory.get(t.id) : null; };

  // stations claim their wedge (first one wins — the world holds one per wedge)
  for (const st of stations) {
    const e = entryAt(st.pos.x, st.pos.y);
    if (e && !e.station) e.station = st;
  }
  // ownable entities keyed by grid cell: outposts and sites both carry their
  // regionId (regions hold one or the other, never both — see game/sites.js)
  const outpostByRegion = new Map(), siteByRegion = new Map();
  for (const o of (s.outposts || [])) if (!outpostByRegion.has(o.regionId)) outpostByRegion.set(o.regionId, o);
  for (const t of (s.sites || [])) if (!siteByRegion.has(t.regionId)) siteByRegion.set(t.regionId, t);
  // every grid cell falls in exactly one wedge (cell-centre angle test)
  for (const cell of s.regions) {
    const e = entryAt(cell.cx, cell.cy);
    if (!e) continue;
    e.regionIds.push(cell.id);
    const op = outpostByRegion.get(cell.id), st = siteByRegion.get(cell.id);
    e.ownables.push(op ? { regionId: cell.id, type: "outpost", entity: op }
                  : st ? { regionId: cell.id, type: "site", entity: st }
                       : { regionId: cell.id, type: null, entity: null });
  }
  LINEAGE.cache = { regions: s.regions, stations, stationN: stations.length,
    outposts: s.outposts, sites: s.sites, byTerritory };
  return LINEAGE.cache;
}

// Given a territory name (as used in game/regions.js), its station object.
function stationOfTerritory(territoryName) {
  const t = _territoryDef(territoryName), idx = _lineageIndex();
  return (t && idx) ? idx.byTerritory.get(t.id).station : null;
}
// Given a territory name, all R-#### region ids inside its wedge (numeric ids).
function regionsOfTerritory(territoryName) {
  const t = _territoryDef(territoryName), idx = _lineageIndex();
  return (t && idx) ? idx.byTerritory.get(t.id).regionIds.slice() : [];
}
// Given a territory name, the ownable entry for every region cell inside it.
function ownablesOfTerritory(territoryName) {
  const t = _territoryDef(territoryName), idx = _lineageIndex();
  return (t && idx) ? idx.byTerritory.get(t.id).ownables.slice() : [];
}

Object.assign(GAME, {
  // Headless lineage + deep-space-station selfTest (build.py --check runs this
  // alongside skillsSelfTest / tradeRoutesSelfTest). Re-inits the world first
  // (it teleports the ship around) and leaves a fresh init behind.
  lineageSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state, stations = ForgeWorld.getStations();

      // 1. 10 stations, and every territory resolves exactly one (10 distinct
      // stations over 10 territories ⇒ pigeonhole: one each).
      check(stations.length === 10, "expected 10 stations (8 planet-bound + 2 deep-space), got " + stations.length);
      const claimed = new Set();
      for (const t of REGIONS) {
        const st = stationOfTerritory(t.name);
        check(!!st, "territory '" + t.name + "' has no station");
        if (st) { check(!claimed.has(st.id), "station id " + st.id + " claimed by two territories"); claimed.add(st.id); }
      }
      check(claimed.size === 10, "each of the 10 territories must own a distinct station, got " + claimed.size);

      // 2. regionsOfTerritory: non-empty, every id resolves to a cell whose
      // centre really sits in the wedge, no cell in two territories, and the
      // union covers the whole grid.
      let cellTotal = 0; const seenCells = new Set();
      for (const t of REGIONS) {
        const rids = regionsOfTerritory(t.name);
        check(Array.isArray(rids) && rids.length > 0, "territory '" + t.name + "' returned an empty region list");
        for (const rid of rids) {
          const cell = this.regionGet(rid);
          check(!!cell, "region id " + rid + " does not resolve via regionGet");
          if (cell) check(politicalRegionAt(cell.cx, cell.cy) === t, "cell R-" + rid + " outside the " + t.name + " wedge");
          check(!seenCells.has(rid), "cell R-" + rid + " listed under two territories");
          seenCells.add(rid);
        }
        cellTotal += rids.length;
      }
      check(cellTotal === s.regions.length, "territory region lists must cover the grid exactly once (" + cellTotal + "/" + s.regions.length + ")");

      // 3. ownablesOfTerritory: valid array, one well-formed entry per cell.
      let sawOutpost = false, sawSite = false;
      for (const t of REGIONS) {
        const own = ownablesOfTerritory(t.name);
        check(Array.isArray(own) && own.length === regionsOfTerritory(t.name).length,
          "ownables of '" + t.name + "' must carry one entry per region cell");
        for (const e of own) {
          check(e && typeof e.regionId === "number", "ownable entry missing a numeric regionId in " + t.name);
          check(e.type === "outpost" || e.type === "site" || e.type === null, "bad ownable type '" + e.type + "'");
          if (e.type === "outpost") { sawOutpost = true; check(!!e.entity && e.entity.regionId === e.regionId, "outpost entity/cell mismatch at R-" + e.regionId); }
          if (e.type === "site") { sawSite = true; check(!!e.entity && e.entity.regionId === e.regionId && !!SITE_DEFS[e.entity.type], "site entity/cell mismatch at R-" + e.regionId); }
          if (e.type === null) check(e.entity === null, "type-null entry must carry a null entity");
        }
      }
      check(sawOutpost, "no outposts surfaced by any territory (seedOutposts ran?)");
      check(sawSite, "no sites surfaced by any territory (seedSites ran?)");

      // 4. the two deep-space stations are full dock hubs: fly-to docks them,
      // the dock menu opens, the store is stocked, the job board fills.
      for (const dsDef of CONFIG.deepSpaceStations) {
        const st = stationOfTerritory(dsDef.territory);
        check(!!st && st.id === dsDef.stationIdx && st.name === dsDef.name,
          dsDef.territory + " must resolve to " + dsDef.name + " (id " + dsDef.stationIdx + ")");
        if (!st) continue;
        check(Array.isArray(st.stock) && Array.isArray(st.npcMiners) && typeof st.reputation === "number",
          st.name + " lacks the genStations station shape");
        st.discovered = true;   // fly-to-once normally flips this
        s.x = st.pos.x; s.y = st.pos.y + 40; s.vx = s.vy = 0;
        this.update(1 / 60);
        check(s.atStation === true && s.dockStationId === st.id, st.name + " must read atStation inside dockR");
        this.openDock(st.id);
        check(s.docked === true && s.dockKind === "station" && s.dockTab === "loadout", st.name + " dock menu must open");
        const board = (s.stationContracts || {})[st.id] || [];
        check(board.length >= CONTRACTS.perStationMin, st.name + " job board empty (got " + board.length + ")");
        ForgeStore.openStore(st, s, {});
        check(st.stock.length > 0, st.name + " store has no stock");
        ForgeStore.closeStore();
        this.closeDock();
      }

      this.init();   // leave a clean world behind (the dock walk moved the ship)
    } catch (e) {
      fails.push("FAIL: lineageSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
