# Clay Ground Pivot — Design Spec (v2, 2026-07-16)

> **v2 (IMPLEMENTED, Mira):** flat color alone read as empty — the floor is
> now made of 3D-clay SLAB TILES: each ground tile is a diamond clay slab
> OBJECT (top face + rounded edges + thickness) blitted in the iso grid, with
> the grout line between slabs as an intentional board-game-diorama feature.
> `pipeline.py slabs mira` generates the 9-slab sheet (plain grass ≥70% of the
> field — material-economy rule; tuft/flower variants sparse; dirt, cobbles,
> water, and the 3 farm-soil states). Engine: `ART.drawSlab` (160px cached
> raster per key|tint, Y squashed 0.8× to map the 2:1 art onto the 2.5:1
> engine diamond, top face anchored to the grid diamond, thickness hangs into
> the row below — self-occluded except at cliffs/shores where it reads as
> depth). Slabs are lit objects: variants are hash-picked, NEVER rotated.
> Jungle/mountain reuse grass/dirt slabs via baked multiply tints. Farm soil
> states replace the procedural furrows. Painted road markings wash over the
> cobbles at 0.42 alpha. Far-zoom guard: below thh<8 (z≈0.5) fall back to the
> v1 flat fill ("map mode") — 4800 scaled blits at min zoom measured 79ms,
> flat is 6.7ms. Two bugs fixed en route: `darker()` now parses hex (invalid
> fillStyle silently reused the previous color → green grout lines), and the
> deco/prop layer (v1) stays on top as the sparse detail pass.
> Layer-1 "flat ground" below remains as the fallback + far-zoom mode.

## Goal

Make the planet surface read as one hand-crafted 3D-clay miniature diorama —
matching the (loved) clay building sprites — by **moving the art budget off the
floor and onto things standing on it**:

- **Layer 1 (base):** flat procedural color tiles. Seamless *by construction* —
  no texture stamps, no seams, no per-tile strobing, near-zero draw cost.
- **Layer 2 (richness):** 3D-clay **prop sprites** (grass tufts, wildflowers,
  pebbles, reeds…) procedurally scattered by biome + seed, drawn as
  bottom-anchored billboards in the existing depth-sorted entity pass — the
  exact mechanism the clay buildings and emoji flora already use.

Pilot on **Mira only** (per-planet opt-in flag). Other planets keep the PNG
tile path untouched until the pilot is approved.

## Why (recap of the decision)

The per-tile PNG texture stamps are the thing that reads "broken": every tile
is an independent image, so edges/repeats/variant-checkerboards are visible.
A fully pre-rendered 3D map was rejected: kills per-save procedural worlds,
can't absorb runtime ground mutation (tilling/crops/buildings), no 3D runtime,
tens of MB per planet. The diorama look lives in the *objects*; the floor's job
is to be calm.

## Layer 1 — flat clay ground

`PLANET_DEFS.mira.ground = 'clay'` (absent = current PNG tile path; zero change
to other planets).

When active, the ground pass (`drawScene` pass 1):

1. **Skips `ART.drawFlatTexture` entirely** — terrain AND the tilled/seedling/
   harvest soil overlays. Tilled soil uses the existing procedural furrow draw
   (dark diamond + plough lines), which reads correctly on flat ground.
2. **Draws `flatTile(tileColors[i])`** — the already-good generator colors:
   smooth dual-noise LO→HI biome mix, shore tint, 4-neighbor biome blending
   (planet_surface.js §6). This layer already exists under the PNGs.
3. **Drops the grass outline stroke** (roads keep a faint one for structure).
   Adjacent flat tiles differ by ≤ a few RGB steps; edges must come from color,
   not strokes, or the diamond lattice reappears.
4. Water: existing flat color + animated glint. Shore reads via the existing
   shore tint + Layer-2 reed props.

Cost: one `fill()` per tile — cheaper than the current cached-PNG blit.
The zoom-settle cache machinery stays (other planets still use it).

## Layer 2 — clay prop scatter

### Art (new `props` mode in sprites/pipeline.py)

One 3×3 sheet, **buildings-style parsing** (pure-black bg → flood removal →
despeckle → tight crop → `sprites/mira/prop_<key>.png`), using the validated
clay formula (chunky rounded, per-element AO, soft upper-left daylight, NO
ground plane / cast shadow / text):

| key | content |
|---|---|
| grass_tuft_a  | small rounded clay grass clump, spring green |
| grass_tuft_b  | same family, slightly different silhouette |
| flower_white  | tiny white/cream clay flower cluster |
| flower_pink   | tiny pink clay flower cluster (blossom festival vibe) |
| pebble_cluster| 3-4 rounded grey-brown clay pebbles |
| bush_round    | single chunky rounded clay bush |
| reed_clump    | short clay reeds/cattails (waterline) |
| stone_mossy   | one rounded mossy clay stone |
| stump_small   | tiny clay tree stump (meadow detail) |

Rules: every prop ONE connected shape (parser drops detached blobs);
low height (< ~1.5× width) so the iso billboard doesn't loom; palette-locked
to the mira meadow greens.

### Placement (genWorld, seeded — deterministic per save)

New step after resource nodes: for each **land, grass-type** tile NOT in
{city footprint, port apron+margin, any road, node tile, prop tile,
home plaza radius}: roll `hash(x,y)` against per-biome densities —

- B_GRASS: 16% tuft, 5% flower, 3% pebble/stone, 1% stump/bush
- B_JUNGLE: 22% tuft/bush
- B_DESERT: 8% pebble
- B_MOUNTAIN: 7% stone/pebble
- any land tile 4-adjacent to water: +30% reed_clump (overrides the above)

One deco per tile, with hash-derived sub-tile jitter (±0.28 tile) and size
jitter (0.85–1.15). Stored as `world.deco[]` → `decoAtPos` map in drawScene.

### Draw (drawScene pass 2)

- Right before nodes/crops for the tile: `ART.drawProp(g, key, sx+jx, sy+jy, w)`
  where `w ≈ 15-22px × z × sizeJitter`, bottom-anchored.
- Runtime suppression: skip if tile is tilled, has a crop, or a player building
  (cheap key lookups against existing maps).
- **Zoom guard:** skip decos when `z < 0.55` (sub-8px props alias into noise;
  also caps worst-case count when the viewport is huge).
- `ART.drawProp` pre-rasters each PNG once to a ~96px offscreen (the
  `emojiSprite` pattern) and blits scaled — no hi-res rescale per frame.
- Fallback: if the PNG isn't loaded (headless/404), draw NOTHING (decos are
  pure decoration; no procedural fallback needed — flat ground alone is valid).

## Explicitly deferred (not in this pilot)

- Hero ground decals (flower-meadow patches baked into ground) — needs chunk
  baking to be free; later.
- Chunk-baked ground layer — perf headroom is fine post zoom-fix (2.2ms).
- Swapping interactive nodes (trees/rocks/berries) and crops to clay — separate
  art batch; emoji stay for now.
- Other planets' prop sets — after Mira approval, one sheet each via the same
  pipeline mode.

## Perf budget

- Layer 1: strictly cheaper than today (fill vs cached blit).
- Layer 2: worst case ~300-400 small cached blits at min-gameplay zoom ≈ the
  existing emoji-flora cost class. Target: ≤5ms/frame in the dense meadow at
  z=0.9 in the desktop pane; no regression at the city/port.

## Test plan (Mira, live browser)

1. `build.py` + `node test_planet.js` → ALL GREEN (headless: decos inert).
2. Land on Mira fresh-seed: screenshot meadow, shoreline, city core, admin
   district, spaceport, home farm area.
3. Farming loop: till + plant + water on decorated tiles → furrows/crops
   render, decos suppressed on those tiles.
4. Zoom sweep 0.38 → 2.6: no lattice, no strobing, decos pop in at z≥0.55
   without visual snap, perf stays ≤5ms.
5. Season/weather sanity: snow/rain still draw over flat ground.
6. Console: zero errors; network: all sprites/** 200.
7. Vesper spot-check: PNG tile path untouched (flag off).

## Rollback

Delete `ground:'clay'` from the mira def — everything reverts to the PNG path
(deco scatter is draw-gated by the same flag, so it disappears too).

## Review notes (self-review, pre-implementation)

- ✅ **Concurrent-session safety:** another chat is actively iterating the PNG
  tile art ("winning formula"). This pivot is per-planet opt-in and leaves the
  whole PNG path + cache machinery intact; only mira flips. Re-verify edit
  anchors immediately before building (concurrent-sessions memory rule).
- ✅ **Save compat:** decos derive from worldSeed at genWorld time — nothing new
  persisted; save whitelist untouched.
- ✅ **Headless selfTest:** genWorld runs only in browser (`getWorld` HEADLESS
  stub returns empty world) — deco gen never runs headless; drawProp guards on
  image availability anyway.
- ⚠️ **Density tuning is taste:** ship at the numbers above, expect one
  adjust-pass after screenshots (that's the point of the pilot).
- ⚠️ **xAI API may be out of credits/token expired** (known 403/401 modes). If
  generation fails: implement engine + flat ground anyway (independently
  shippable), report art blocked.
- ⚠️ **Tile-cache interplay:** with mira flagged off the PNG path, ensure the
  zoom-settle rebuild doesn't run pointlessly for mira (skip when ground flag
  active — one-line guard) but still runs on PNG planets.
