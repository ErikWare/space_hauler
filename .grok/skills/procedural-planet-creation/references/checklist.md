# Procedural planet checklist

Copy per world. Mark items done before shipping.

## Spec

- [ ] `key` (lowercase id)
- [ ] Display `name` + `tag`
- [ ] `worldType` (earth|ice|lava|desert|barren|moon)
- [ ] Access: planet orbit **or** parent moon `landKey`
- [ ] Palette (biomeLO/HI, water, road, sky, accent)
- [ ] Crops (native seed keys)
- [ ] Fantasy: districts, port hangars, hazards

## Art pack `sprites/<pack>/`

- [ ] 11 slabs (grass×4 styles, dirt×2, path, water, soil×3)
- [ ] 9 props + 9 `_m` mirrors
- [ ] Nodes (type-appropriate)
- [ ] Landmarks (mesa/boulder/ridge/mountain as needed)
- [ ] Features: cliff_s/e/n/w, peak, boulder, outcrop, plant_a/b, accent
- [ ] Buildings: full `bldg_<pack>_*` set
- [ ] Optional signature piece (e.g. `feat_dish`)

## Code registration

- [ ] `sprites.js`: TERRAIN, PROP, SLAB, LANDMARK, NODE, FEAT, BLDG sets
- [ ] `SEED_TYPES` + `home: key`
- [ ] `PLANET_DEFS_RAW[key]` recipe, `ground:'diorama'`
- [ ] Space: `CONFIG.solarPlanets` and/or `moonNames`
- [ ] `main.js` moon proximity if moon
- [ ] `qa_land` allowlist

## QA

- [ ] `python3 build.py --check` ALL GREEN
- [ ] `PLANET.selfTest` covers land(key) if new
- [ ] `node scripts/landing_qa_shot.mjs <key>`
- [ ] Ship visible on pad
- [ ] Palette correct (no wrong-world grass)
- [ ] City + port + farm present
- [ ] Space L-land works

## Docs

- [ ] `WORLD_TYPES.md` row / access blurb
