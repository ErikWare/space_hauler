# Clay World Engine — Locked Procedural Generator

**Status:** LOCKED (v1)  
**Module:** `src/game/clay_world_engine.js` → global `ClayWorldEngine`  
**Consumer:** `src/game/planet_surface.js` (gameplay, city, farm, ship)

This is the **single** procedural generation + paint path for high-quality
ISO clay diorama planets. New worlds are **recipes**, not forks.

```
Recipe (palette + port/city + proc knobs)
        │
        ▼
ClayWorldEngine.normalizeRecipe / makeRecipe
        │
        ▼
genWorld (planet_surface) ── uses engine elev / nodeScale / deco / landmarks
        │
        ▼
drawScene pass 1 ── ClayWorldEngine.drawCell / drawCliff / drawShoreFoam
        │
        ▼
drawScene pass 2 ── buildings, nodes, ship, crops (interaction layer)
```

---

## Why locked

| Do | Don't |
|----|--------|
| Add a recipe with palettes + `proc` knobs | Copy-paste paint code per planet |
| Set `ground:'diorama'` for new clay worlds | Invent a new tileset for floor identity |
| Tune `theme` / `proc` for drama & density | Hard-code sizes in drawTree |
| Keep slab path for A/B on old worlds | Break farm/port/city contracts |

Gameplay (till / plant / harvest / livestock / ship pad / city interact) stays
in `planet_surface.js`. The engine only owns **look + gen knobs**.

---

## Versions

| Symbol | Meaning |
|--------|---------|
| `ClayWorldEngine.VERSION` | Public API / recipe schema. Bump on breaking changes. |
| `ClayWorldEngine.LAYOUT_V` | Generated layout shape. `PLANET.land` reseeds saves when this advances. |

Current: **VERSION = 3**, **LAYOUT_V = 10**.

---

## Ground modes

| `ground` | Paint path |
|----------|------------|
| **`diorama`** | Locked engine — 100% procedural ISO clay (preferred) |
| `clay` | Legacy slab PNGs + prop scatter |
| *(absent)* | Flat PNG terrain stamps |

Mira ships on **`diorama`**. Other planets keep `clay` until flipped.

---

## Authoring a new world

### Minimum recipe

```js
PLANET.registerWorld("ember", {
  name: "Ember",
  tag: "volcanic forge world",
  theme: "volcanic",            // temperate | volcanic | ice | desert | barren
  ground: "diorama",
  biomeLO: ["#…", "#…", "#…", "#…"],  // grass, jungle, desert, mountain
  biomeHI: ["#…", "#…", "#…", "#…"],
  water: ["#mid", "#deep"],           // lava: warm oranges
  road: "#…",
  glint: "#FFE0A0",
  crops: ["emberchili", "ashyam"],    // must exist in SEED_TYPES
  propset: "cinder",
  nodeset: "cinder",
  bldgset: "cinder",
  port: { flip: false, hangars: 2, extra: "round_guard" },
  city: { pattern: "radial", monument: "stepped_temple", skyline: "frontier" },
  landmarks: ["volcano", "mesa", "boulder"],
  landmarkN: 9,
  landmarkEmoji: { volcano: "🌋", mesa: "🪨", boulder: "🪨" },
  // optional overrides:
  proc: {
    waterIsLava: true,
    decoDense: 0.9,
    rockScale: [0.9, 2.5],
    elevDramatic: true,
  },
  noTrees: true,
  landOnlyRocks: true,
  cityXY: [48, 34],
});
```

Or build offline then assign:

```js
const recipe = ClayWorldEngine.makeRecipe({ name: "Ember", theme: "volcanic", … });
```

### Required fields

`name`, `biomeLO` (4), `biomeHI` (4), `water` (2), `road`, `crops` (≥1)

### Themes (`ClayWorldEngine.THEMES`)

| Theme | Intent |
|-------|--------|
| `temperate` | Meadows, grass flecks, lively deco (Mira) |
| `volcanic` | Lava water, big rocks, dramatic elev |
| `ice` | Sparse deco, tall pines, cold cliffs |
| `desert` | Calm elev, sparse deco, wide mesas |
| `barren` | Mining rock, low flora |

### `proc` knobs (defaults in `DEFAULT_PROC`)

| Knob | Role |
|------|------|
| `elevDramatic` | Lower thresholds → more cliffs |
| `elevMountainBoost` | Extra height in mountain biome |
| `elevThresholds` | `[t2, t3, t4]` noise cuts |
| `decoDense` | Prop spawn density multiplier |
| `decoSizeMin/Max` | Prop billboard scale range |
| `rockScale` / `treeScale` / `berryScale` | `[min,max]` natural node size |
| `landmarkN` / `landmarkSizeMin/Max` | Big collidable set pieces |
| `waterIsLava` | Cliff falls use lava palette |
| `clayInset` / `thickMul` | Grout seams + lip thickness |
| `fleckGrass` | Procedural grass strokes on meadow |

---

## Paint contract (do not reimplement)

```js
ClayWorldEngine.drawCell({
  g, sx, sy, z, ISO_HW, ISO_HH,
  col, ttype, tilled, crop, bio, tx, ty, elev,
  def, frame,
});
ClayWorldEngine.drawCliff({ g, sx, sy, z, ISO_HW, ISO_HH, col, ch, face, waterfall, lava, frame });
ClayWorldEngine.drawShoreFoam({ g, sx, sy, z, ISO_HW, ISO_HH, tx, frame });
```

`ttype`: `0` water · `1` grass · `2` road  
`bio`: `0` grass · `1` jungle · `2` desert · `3` mountain  
`crop`: `{ ripe, watered } | null`

---

## Quality bar (enforced in selfTest)

1. Recipes normalize without throw; incomplete recipes throw.
2. Mira is `ground:'diorama'` and stamped `_engine` / `_engineVersion`.
3. Node scales vary (rocks not all the same size).
4. Elev tiers respond to mountain biome.
5. `PLANET.selfTest` includes `ClayWorldEngine.selfTest()`.
6. Layout version tracks `ClayWorldEngine.LAYOUT_V`.

```bash
python3 build.py --check   # must print GREEN PLANET.selfTest
```

---

## Interaction layer (unchanged)

Still fully playable on diorama worlds:

- Till / plant / water / harvest  
- Mine trees / rocks / berries (variable sizes)  
- Spaceport pad + **player ship**  
- City buildings + NPCs  
- Barn livestock  
- Collidable landmarks  

Logical grid (`tiles`, `tilled`, `crops`) is independent of paint path.

---

## Flipping an existing planet to diorama

1. In its recipe: `ground: 'diorama'`, pick a `theme`, tune `proc`.
2. Bump nothing if only look changes; bump `LAYOUT_V` only if gen shape changes.
3. Land, hard-refresh; save reseeds if `LAYOUT_V` advanced.
4. QA: `game.html?qa_land=<key>` + screenshot harness.

---

## Rollback

- Mira → slabs: set `ground:'clay'` on the mira recipe and rebuild.  
- Engine off: remove `clay_world_engine.js` from `build.py` — planet_surface falls back to flat fills (degraded). **Not supported for shipping.**

---


## Seamless sprite carpet (v3)

The logical grid still drives till/plant/collision, but **nothing paints as a visible tile grid**:

| Layer | What you see |
|-------|----------------|
| Soft underpaint | Overlapping **ellipses** (not diamonds) of biome color |
| Ground carpet | Clay **slab sprites** (`slab_*`) at 1.3–1.4× with jitter |
| Prop carpet | Full-tile grass/flower sprites on every open grass cell |
| Massifs / vistas | Multi-tile landmark sprites / clay masses |

`proc.seamlessSprite`, `carpetAll`, `groundOverlap`, `groundJitter` control this.

## Multi-tile landmarks & full-tile cover (v2)

| Feature | Behavior |
|---------|----------|
| Mountain / ridge / mesa | **6–12 tile** elliptical footprint, collidable |
| Clusters | 2–4 peaks grouped into ranges |
| Vista landscapes | 10–15 tile decorative overlays (no collision) |
| Grass / flowers | **Full-tile** props (`decoFullTile`, width ≈ 2×ISO_HW) |
| Trees / rocks | Larger base widths (`nodeBaseTree` 70, rock 58) |

Collision uses `ClayWorldEngine.landmarkBlocks(L, px, py)` (ellipse).

## File map

| File | Role |
|------|------|
| `src/game/clay_world_engine.js` | Locked engine (gen knobs + paint) |
| `src/game/planet_surface.js` | Gameplay, genWorld structure, city/port, UI |
| `CLAY_WORLD_ENGINE.md` | This contract |
| `CLAY_GROUND_SPEC.md` | Legacy slab pilot notes |
