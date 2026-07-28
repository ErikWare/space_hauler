# Procedural Clay Worlds — Four World Types

**Status:** active contract for planet surface art + gen  
**Engine:** `ClayWorldEngine` (`src/game/clay_world_engine.js`)  
**Recipes:** `PLANET_DEFS` in `planet_surface.js`  
**Look:** seamless **sprite carpet** diorama (no visible tile grid)

When we build or re-skin a world, pick **one world type**, attach its art pack,
and tune `proc` knobs. Do **not** invent a fifth paint path.

---

## The four types

| Type | Feel | Planet(s) | Art pack (`propset` / `nodeset` / `bldgset`) | Theme |
|------|------|-----------|-----------------------------------------------|--------|
| **earth** | Forest meadows, rocky mountains, soft cliffs, rivers | **Mira** | `mira` | `temperate` |
| **ice** | Snow fields, ice ridges, pine forests, glacial water | **Dusk** | `dusk` | `ice` |
| **lava** | Ash plains, basalt, volcanoes, lava “water” | **Cinder** | `cinder` | `volcanic` |
| **desert** | Sand, dunes, cacti, sandstone mesas, oasis water | **Sorn** | `sorn` | `desert` |
| **moon** | Regolith, metal pads, station modules, craters | **Selene** (Mira moon) | `selene` | `barren` |

**Bonus / hybrid:** **Vesper** uses `worldType: 'barren'` (crystal rock mining) with pack `vesper` — same diorama engine, fewer trees, more rock props.

### Selene (Mira moon base)

- **Access:** Fly near Mira → approach the moon **Selene** → press **L**.  
- **Pipeline:** Same as Mira / Vesper / etc. — `ground: 'diorama'` + `PLANET_DEFS` recipe + `genWorld` (farm, dual city, port, landmarks, deco carpet, nodes).  
- **Art:** `sprites/selene/` slabs, props, nodes, landmarks, features, `bldg_selene_*`.  
- **Fantasy:** grey regolith, metal roads, industrial dual districts, hydroponic crops `moongrain` / `voidberry`.  
- **Note:** Experimental sandbox / megatile / hand-mesa paths were retired; do not reintroduce a forked moon renderer.

Recipe field:

```js
worldType: 'earth' | 'ice' | 'lava' | 'desert' | 'barren' | 'moon'
```

**Agent skill:** `.grok/skills/procedural-planet-creation/` — full pipeline to mint new worlds.


---

## What each type must have on disk

Paths: `sprites/<pack>/…`

| Asset class | Files (minimum) | Notes |
|-------------|-----------------|--------|
| **Slabs** (ground carpet) | `slab_grass_a/b/c`, `grass_flowers`, `dirt`, `dirt_b`, `stone_path`, `water`, `soil_*` | Overlapping seamless carpet |
| **Props** | `prop_grass_tuft_a/b`, `flower_*`, `bush_round`, `reed_clump`, `pebble_*`, `stone_mossy`, `stump_small` | Plus **`_m` mirror** variants |
| **Nodes** | Trees, rocks, berries appropriate to type | See table below |
| **Landmarks** | Multi-tile massifs | mountain / mesa / ridge / volcano / dune as fits type |
| **Buildings** | `bldg_<pack>_*` | Existing city/port packs |

### Nodes by type

| Type | Trees | Rocks | Berries |
|------|-------|-------|---------|
| earth | oak_a, oak_b, pine, palm | rock_a/b | berry_bush |
| ice | pine, oak (snow-tinted) | rock_ice, rock_a/b | berry_bush |
| lava | *(none / dead)* | rock_basalt, rock_a/b | berry_cactus |
| desert | cactus, palm | rock_a/b | berry_cactus |
| barren | crystal | rock_crystal, rock_a/b | berry_glow |

### Landmarks by type

| Type | Preferred landmarks |
|------|---------------------|
| earth | mountain, mesa, ridge, boulder |
| ice | mountain, ridge, boulder, mesa |
| lava | volcano, mesa, boulder, mountain |
| desert | mesa, dune, boulder, mountain |

---

## Scale & density (player readability)

These are **defaults** in `ClayWorldEngine.DEFAULT_PROC` — override per recipe.

| Element | Ratio | Intent |
|---------|-------|--------|
| **Common grass / shrubs** | ~45–75% of prior full-tile bulk | Player avatar stays readable |
| **Hero grass / flowers** (~16–18% of props) | 105–135% tile fill | Occasional “tiny explorer” moments |
| **Typical trees** | **~2–3.5×** older tree size | Forest presence |
| **Giant trees** (~8–10% of trees) | **~4–5.2×** | Memorable specimens |
| **Rocks** | Wide range, some boulder-scale | Collision massifs still separate |
| **Mountain ranges** | **6–12 tile** footprints, clustered 2–4 | Hard body + sprite overlay |

Mirror rule: ~50% of props use horizontal flip (`decoMirror` + `prop_*_m.png` or runtime flip) for free variety.

---

## Recipe checklist (new world)

```js
PLANET.registerWorld("ember", {
  name: "Ember",
  worldType: "lava",          // REQUIRED for lore/art routing
  ground: "diorama",
  theme: "volcanic",
  propset: "cinder",
  nodeset: "cinder",
  bldgset: "cinder",
  tileset: "cinder",
  biomeLO: [/* 4 */], biomeHI: [/* 4 */],
  water: ["#E8752A", "#B8481A"],  // lava colors
  road: "#6E6258",
  crops: ["emberchili"],
  landmarks: ["volcano", "mesa", "boulder"],
  landmarkN: 5,
  port: { … }, city: { … },
  proc: {
    waterIsLava: true,
    seamlessSprite: true,
    carpetAll: true,
    decoMirror: true,
    // size mix inherits engine defaults; override if needed
  },
});
```

---

## Lore notes (short)

- **Earth (Mira):** Breathable homeworld. Forests, farmland, human-scale mountains. Prototype for “cute clay but vast.”  
- **Ice (Dusk):** Krag ice holdings. Pine and snow; cliffs read as ice shelves.  
- **Lava (Cinder):** Vex forge frontier. “Water” is lava; no forests, basalt and flame props.  
- **Desert (Sorn):** Caravan routes, oases, dunes. Sparse canopy, big sky, sandstone massifs.  

Procedural gen always keeps **pad + farm + city clear** of giant props so the player can still till, dock, and walk into town.

---

## Physics note

Landmarks use **elliptical hard-body collision** (`ClayWorldEngine.landmarkBlocks`) sized to the multi-tile footprint. Visuals are sprites (or procedural clay masses) **overlaid** on that collider — mock-collision is intentional until a richer physics layer ships.

---

## Feature packs (40 sprites — 10 × 4 types)

Each world pack ships a **feature set** used for oriented scenery (not the small grass carpet):

| # | Asset | Role |
|---|--------|------|
| 1–4 | `feat_cliff_s/e/n/w` | **4 angles** of the same cliff — pick facing from elevation drop |
| 5 | `feat_peak` | Mountain peak / massif top |
| 6 | `feat_boulder` | Single large rock (collidable) |
| 7 | `feat_outcrop` | Rock cluster (collidable) |
| 8 | `feat_plant_a` | Signature vegetation (tree-like / tall) |
| 9 | `feat_plant_b` | Secondary bush / reed |
| 10 | `feat_accent` | Type signature (flowers / ice spire / lava vent / cactus) |

Paths: `sprites/<pack>/feat_<name>.png`  
Keys: `feat_<pack>_<name>` (registered in `sprites.js` → `FEAT_KEYS`)

| Type | Pack folder |
|------|-------------|
| earth | `mira` |
| ice | `dusk` |
| lava | `cinder` |
| desert | `sorn` |

Placement: `world.features[]` with `{ x, y, key, sizeMul, r, collide, angle }`.  
Cliffs auto-prefer the facing that matches a local elevation step so the world “reads” correctly.

---

## Related docs

| Doc | Role |
|-----|------|
| `CLAY_WORLD_ENGINE.md` | Engine API, knobs, paint contract |
| `CLAY_GROUND_SPEC.md` | Legacy slab pilot notes |
| `MARA_PLANET_LORE_SPEC.md` | Broader planet lore (if present) |
| `WORLD_TYPES.md` | **This file** — four-type art + scale contract |

---

## Asset generation notes

Per-world props currently include:

- Recolored packs from Mira clay props for `vesper` / `cinder` / `dusk` / `sorn`
- Horizontal **`_m` mirrors** for every prop variant
- Extra landmarks (mountain, etc.) derived where a pack was missing a silhouette

To regenerate after new Mira masters:

```sh
# see session scripts / pipeline: recolor mira props → other packs + mirrors
```

When hand-authoring new props: keep **upper-left light**, no ground plane in the PNG, transparent background, and export both normal + `_m` if the silhouette is asymmetric.
