---
name: procedural-planet-creation
description: >
  End-to-end pipeline to create a full Space Hauler planet/moon surface experience:
  ClayWorldEngine recipe, sprite pack (slabs/props/nodes/landmarks/features/buildings),
  dual city districts, spaceport + ship pad, crops, space access (planet or named moon),
  QA screenshots and selftests. Use when the user asks to "build a planet", "new world",
  "moon base", "procedural planet", "add a surface", "/procedural-planet-creation",
  or wants another Selene/Mira-quality landable experience.
metadata:
  short-description: "Build complete procedural planet/moon experiences"
---

# Procedural Planet Creation

Build **complete, landable planet (or moon) experiences** for Space Hauler using the
**locked** clay diorama pipeline. Do **not** invent a new ground renderer. New worlds
are **recipes + art packs + access wiring**.

**Gold-standard reference:** **Selene** (Mira moon base) — dual districts, custom
`sprites/selene/` pack, named moon landing from space.

**Repo docs (read when needed):**
- `CLAY_WORLD_ENGINE.md` — engine API / proc knobs
- `WORLD_TYPES.md` — earth / ice / lava / desert / moon art contracts
- `.grok/skills/procedural-planet-creation/references/checklist.md` — copy-paste checklist

---

## Architecture (do not fork)

```
CONFIG / solar system (orbit, moons, landKey)
        │
        ▼
main.js proximity → PLANET.land(key)
        │
        ▼
PLANET_DEFS recipe (planet_surface.js) ── normalizeRecipe (ClayWorldEngine)
        │
        ▼
genWorld → farm, port, dual city, nodes, landmarks, features, deco carpet
        │
        ▼
drawScene → seamless sprite carpet + props + buildings + ship + features
        │
        ▼
sprites/<pack>/  + ART_MANIFEST registration (sprites.js)
```

| Layer | Owns |
|-------|------|
| `ClayWorldEngine` | paint, size ratios, elev, collision helpers, recipe normalize |
| `planet_surface.js` | genWorld layout, city/port/farm, gameplay, `PLANET_DEFS` |
| `sprites.js` | ART_MANIFEST keys + load gates (`SLAB_SETS`, `PROP_SETS`, `FEAT_KEYS`, …) |
| `config.js` / `planets.js` / `main.js` | space access (planet near zone or moon `landKey`) |

**Look contract:** `ground: 'diorama'` — seamless overlapping slab sprites + prop carpet;
no visible iso tile grid. Logical grid still drives till/plant/collision.

---

## Step 0 — Spec the world (before code)

Collect (or invent with the user):

1. **Key** — lowercase id (`selene`, `ember`, `nexus`) — becomes `PLANET_DEFS` key + land key  
2. **Display name** + one-line **tag**  
3. **worldType** — `earth` | `ice` | `lava` | `desert` | `barren` | `moon`  
4. **Access**  
   - Planet body in `CONFIG.solarPlanets`, **or**  
   - Named moon: `moonNames: [{ name, landKey }]` on a parent planet  
5. **Fantasy** — station/port feel, dual districts names, crops, hazards  
6. **Art pack id** — usually same as key (`sprites/<pack>/`)  
7. **Palette** — 6–8 hex colors: regolith/grass, dark, metal/path, water (or lava), accent, sky top/horizon  

Write these into the checklist before generating files.

---

## Step 1 — Art pack on disk

Create `sprites/<pack>/` with **at minimum**:

### Required files

| Class | Pattern | Notes |
|-------|---------|--------|
| Slabs | `slab_grass_a/b/c`, `grass_flowers`, `dirt`, `dirt_b`, `stone_path`, `water`, `soil_tilled/seedling/harvest` | Seamless carpet; overlap hides grid |
| Props | `prop_<variant>.png` + `prop_<variant>_m.png` mirrors | Variants: grass_tuft_a/b, flower_*, bush_round, reed_clump, pebble_cluster, stone_mossy, stump_small |
| Nodes | trees/rocks/berries for type | moon: rocks + glow berries, no trees |
| Landmarks | `landmark_mesa/boulder/ridge/mountain/...` | Multi-tile massifs |
| Features | `feat_cliff_s/e/n/w`, `peak`, `boulder`, `outcrop`, `plant_a/b`, `accent` | 4 cliff angles; optional extras (`feat_dish`) |
| Buildings | `bldg_<pack>_<type>.png` | All types in `MIRA_BLDG_KEYS` (ctrl_tower, hangar, city_hall, …) |
| Flats (optional) | `<pack>_flat_<variant>.png` | Only if using non-diorama fallback |

### Generation methods (prefer in order)

1. **Recolor + cyan/metal accents** from Mira masters (fast, clay-consistent) — see `scripts/recolor_pack_template.py`  
2. **PIL procedural** for cliffs/peaks (4 angles)  
3. **Imagine tools** only when a signature piece needs new silhouettes (keep transparent BG, upper-left light, no baked ground)

### Register in `src/game/sprites.js`

Add pack id to **every** relevant set:

- `TERRAIN_TILESETS`
- `PROP_SETS`
- `SLAB_SETS`
- `LANDMARK_SETS`
- `NODE_SETS`
- `FEAT_SETS`
- `BLDG_SETS`

Building paths: `sprites/<pack>/bldg_<pack>_<type>.png`  
Feature keys: `feat_<pack>_<name>`

**Never** fall back to Mira green slabs for non-earth packs mid-load (engine skips mira fallback when `propset !== 'mira'`).

---

## Step 2 — Recipe in `PLANET_DEFS`

Add under `PLANET_DEFS_RAW` in `planet_surface.js` (auto-normalized by `ClayWorldEngine`).

### Minimum recipe skeleton

```js
myworld: {
  name: 'Display Name',
  tag: 'one-line fantasy',
  worldType: 'moon',           // earth|ice|lava|desert|barren|moon
  parentPlanet: 'mira',        // optional: lore + moon access
  cityXY: [46, 12],
  sky: { top: '#0A1020', hor: '#1A2840', cloud: '#2A3858' },
  biomeLO: ['#…','#…','#…','#…'],  // grass, jungle, desert, mountain
  biomeHI: ['#…','#…','#…','#…'],
  water: ['#mid', '#deep'],        // lava = warm oranges
  glint: '#A8D8FF',
  road: '#8A9AAC',
  crops: ['seed_a', 'seed_b'],     // must exist in SEED_TYPES
  flora: { /* biome → emoji fallback */ },
  rock: '🪨', berry: '💎',
  props: [{ e: '📡', n: 6, big: true }],
  noTrees: true,                   // moon/lava often true
  landOnlyRocks: true,
  port: { flip: false, hangars: 3, extra: 'comms_tower' },
  city: {
    pattern: 'grid',               // grid|radial|strip|organic
    monument: 'obelisk',
    skyline: 'industrial',         // towers|industrial|frontier|low|market
    districts: ['command', 'habitat'], // documentation; engine always dual-district
  },
  ground: 'diorama',
  theme: 'barren',                 // ClayWorldEngine.THEMES key
  propset: 'myworld',
  nodeset: 'myworld',
  bldgset: 'myworld',
  tileset: 'myworld',
  landmarks: ['mountain', 'mesa', 'ridge', 'boulder'],
  landmarkN: 4,
  landmarkEmoji: { /* … */ },
  proc: {
    seamlessSprite: true,
    carpetAll: true,
    groundOverlap: 1.35,
    groundJitter: true,
    decoDense: 1.8,
    decoFullTile: true,
    decoMirror: true,
    decoSizeMin: 0.42,
    decoSizeMax: 0.72,
    decoHeroChance: 0.14,
    elevDramatic: true,
    landscapeN: 3,
    featureN: 28,
    landmarkClusterMin: 2,
    landmarkClusterMax: 4,
    // trees only if not noTrees:
    // treeScale: [1.7, 3.4], treeGiantChance: 0.09, treeGiantScale: [4.0, 5.2],
  },
},
```

### Crops

Add to `SEED_TYPES` in `planet_surface.js` with `home: '<key>'`:

```js
{ key: 'moongrain', name: 'Moongrain', emoji: '🌑', grow: 2, yield: 4, sellEach: 6, seedCost: 10, home: 'selene' },
```

### Size / readability defaults (do not abandon)

| Element | Target |
|---------|--------|
| Common grass/shrubs | ~45–75% of full-tile (player readable) |
| Hero props (~15%) | still large |
| Trees | 2–3.5× typical; giants ~4–5× rare |
| Mountains | multi-tile 6–12, clustered, collidable |

---

## Step 3 — Space access

### Full planet

Add/edit `CONFIG.solarPlanets` entry (`name` must match land key after `toKey`, usually Title Case → lowercase).

### Named moon (Selene pattern)

In `CONFIG.solarPlanets` parent:

```js
{
  name: 'Mira', moons: 2, /* … */,
  moonNames: [
    { name: 'Selene', landKey: 'selene' },
    { name: 'Mira Minor', landKey: null },
  ],
}
```

`src/world/planets.js` must push `name`, `landKey`, `parent` onto each moon.

`src/main.js` proximity must:

1. Detect moons with `landKey` within ~`max(r*3.5, 220)`  
2. Set `nearLandKey`, `nearPlanetName`, `nearBodyLabel`  
3. Call `PLANET.land(s, nearLandKey)` on **L**  
4. HUD: `Near Selene (Mira moon)  [L] Land`

### QA harness

Add key to `allowed` in `wireLandingQA` (`game.html?qa_land=<key>`).

---

## Step 4 — Engine / gen behavior to preserve

Already in `genWorld` — do **not** reimplement:

- Home pad + farm belt clear of nodes  
- Port hangars + ship pad + `drawPlayerShip`  
- Dual city: admin plaza south + downtown north  
- Deco carpet (`carpetAll`) with mirrors  
- Multi-tile landmarks + oriented `features` (cliffs S/E/N/W from elevation)  
- `blocked()` for water + landmarks + feature hard-bodies  

Optional moon extras: place `feat_<pack>_dish` when `worldType === 'moon'`.

---

## Step 5 — Versioning

| When | Action |
|------|--------|
| Recipe-only / art swap | usually no `LAYOUT_V` bump |
| genWorld shape / feature placement rules change | bump `ClayWorldEngine.LAYOUT_V` |
| Engine API break | bump `ClayWorldEngine.VERSION` |

`PLANET.land` reseeds when `prog.layoutV < ENGINE_LAYOUT_V`.

---

## Step 6 — Verify (mandatory)

```bash
python3 build.py --check
```

Must stay **ALL GREEN**. Extend `PLANET.selfTest` for new world:

- recipe exists, `ground === 'diorama'`, worldType set  
- `land(key)` creates world with farm, city buildings, landmarks  

Visual QA:

```bash
# serve repo root, then:
node scripts/landing_qa_shot.mjs <key>
# open sprites/mira/_debug/landing_<key>.png
```

Check:

- [ ] Ship + hull name on pad  
- [ ] No wrong-world green grass flash  
- [ ] Explorer readable among props  
- [ ] Dual districts + hangars present  
- [ ] Sky/palette matches fantasy  
- [ ] L from space works (planet or moon)

---

## Step 7 — Docs

Update:

1. `WORLD_TYPES.md` — new type or planet row + access line  
2. Recipe comment in `planet_surface.js`  
3. This skill’s checklist if a new required file class appears  

---

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| New ground renderer | `ground: 'diorama'` + pack |
| Fork `drawCell` per planet | `proc` knobs + palette |
| Mira slab fallback for moon/lava | Soft underpaint until pack loads |
| One-tile mountains | Multi-tile landmarks + features |
| Skip selftest | `build.py --check` + land smoke |
| Forget `sprites.js` sets | Pack never loads |

---

## Order of work (agent checklist)

1. Spec (key, type, access, palette)  
2. Generate `sprites/<pack>/`  
3. Register pack in `sprites.js`  
4. `SEED_TYPES` + `PLANET_DEFS_RAW` recipe  
5. Space access (planet and/or moonNames + main.js)  
6. `qa_land` allowlist  
7. `build.py --check`  
8. Screenshot `landing_qa_shot.mjs`  
9. Update `WORLD_TYPES.md`  

**Example completed world:** Selene — use as the template for the next one.
