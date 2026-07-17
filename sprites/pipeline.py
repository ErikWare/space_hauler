#!/usr/bin/env python3
"""
Mira sprite pipeline — generate, parse, and install game-ready art in one pass.

    python3 sprites/pipeline.py tiles [planet]     # 9 terrain slots → sprites/<planet>/<planet>_flat_*.png
                                                   # planets: mira|vesper|cinder|dusk|sorn (PLANET_TILES)
    python3 sprites/pipeline.py buildings          # 4 sheets → sprites/mira/bldg_*.png (32 sprites)
    python3 sprites/pipeline.py buildings port     # just one sheet (port|city|towers|farm)
    python3 sprites/pipeline.py all

WHY THE POST-PROCESSING EXISTS (learned the hard way):
  * Terrain tiles must be lit perfectly FLAT. Any baked vignette / center glow
    repeats per-tile in game and strobes like a checkerboard — headache city.
    The prompt forbids it AND flatten_lighting() removes what sneaks through.
  * Tiles must WRAP seamlessly (left edge continues into right edge) because
    adjacent iso diamonds sample opposite texture edges. seamless() enforces it
    with the classic half-roll + radial-mask blend.
  * Variant families (grass base/pebbles/wildflowers, soil tilled/seedling)
    must share one base palette or the per-tile hash mix reads as noise.
    harmonize() matches channel means within each family.
  * Building sheets come back on near-black; flood-fill from the borders (NOT a
    global threshold) so dark windows/doors inside a building survive.

Debug output (view over the dev http server):
  sprites/mira/_debug/<sheet>_sheet.png       raw generation
  sprites/mira/_debug/tile_<key>_2x2.png      seamlessness check (tiled 2x2)
"""
import io
import json
import os
import pathlib
import sys

import numpy as np
import requests
from PIL import Image, ImageFilter

HERE = pathlib.Path(__file__).parent
OUT = HERE / "mira"
DEBUG = OUT / "_debug"

# ───────────────────────────── auth + generation ─────────────────────────────

def get_token():
    """Token lives in ~/.grok/auth.json under a namespaced key, JWT under 'key'
    (NOT 'token'/'access_token'). ~6h expiry — re-auth the grok CLI on 401."""
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def generate(prompt, tries=2):
    token = get_token()
    for attempt in range(tries):
        r = requests.post(
            "https://api.x.ai/v1/images/generations",
            headers={"Authorization": f"Bearer {token}"},
            json={"model": "grok-imagine-image", "prompt": prompt,
                  "response_format": "b64_json", "n": 1},
            timeout=180,
        )
        if r.status_code == 200:
            import base64
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
            return Image.open(io.BytesIO(raw)).convert("RGB")
        if r.status_code == 403 and "spending-limit" in r.text:
            sys.exit("xAI account out of credits (403 spending-limit) — add credits "
                     "at grok.com/?_s=usage. Retries won't help.")
        print(f"  attempt {attempt+1}: HTTP {r.status_code} {r.text[:200]}")
    sys.exit("generation failed")


# ───────────────────────────── shared image ops ──────────────────────────────

def grid_cells(img, cols, rows, inset):
    """Split a sheet into cells, insetting each to stay clear of grid lines."""
    w, h = img.size
    cw, ch = w // cols, h // rows
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw + inset, r * ch + inset
            yield img.crop((x0, y0, x0 + cw - 2 * inset, y0 + ch - 2 * inset))


def flatten_lighting(arr):
    """Remove low-frequency lighting (vignette/center glow): divide by a heavy
    blur of the luminance, renormalized to the tile mean."""
    img = Image.fromarray(arr.astype(np.uint8))
    lum = np.asarray(img.convert("L"), dtype=np.float32) + 1.0
    blur = np.asarray(
        Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(48)),
        dtype=np.float32) + 1.0
    gain = (blur.mean() / blur)[..., None]          # >1 where the tile is dark
    gain = np.clip(gain, 0.55, 1.8)                 # keep texture, kill gradient
    return np.clip(arr * gain, 0, 255)


def seamless(arr, band=0.30):
    """Half-roll + radial-mask blend: the rolled copy's outer edges are wrap-
    continuous by construction; blend it in near the borders only."""
    h, w = arr.shape[:2]
    rolled = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)
    yy = np.abs(np.linspace(-1, 1, h))[:, None]
    xx = np.abs(np.linspace(-1, 1, w))[None, :]
    d = np.maximum(yy, xx)                           # 0 center → 1 border
    t = np.clip((d - (1 - band)) / band, 0, 1)
    mask = (t * t * (3 - 2 * t))[..., None]          # smoothstep
    return arr * (1 - mask) + rolled * mask


def match_mean(arr, target_mean, strength=0.85):
    """Shift channel means toward a target — keeps variant families cohesive."""
    return np.clip(arr + (target_mean - arr.mean(axis=(0, 1))) * strength, 0, 255)


def flood_bg(arr, dark_max=34):
    """Background mask by flood fill from the borders through near-black pixels.
    Enclosed dark pixels (windows, doors) are NOT background."""
    dark = arr.max(axis=2) < dark_max
    mask = np.zeros_like(dark)
    mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1] = dark[0, :], dark[-1, :], dark[:, 0], dark[:, -1]
    while True:
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        grown &= dark
        if (grown == mask).all():
            return mask
        mask = grown


def largest_component(fg):
    """Keep only the largest 4-connected foreground blob. The model sometimes
    renders caption text under a building despite the no-text instruction —
    captions are detached from the structure, so they (and any stray noise)
    drop out here."""
    from collections import deque
    h, w = fg.shape
    seen = np.zeros_like(fg)
    best = None
    for sy in range(h):
        for sx in range(w):
            if fg[sy, sx] and not seen[sy, sx]:
                q = deque([(sy, sx)])
                seen[sy, sx] = True
                comp = []
                while q:
                    y, x = q.popleft()
                    comp.append((y, x))
                    for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                if best is None or len(comp) > len(best):
                    best = comp
    out = np.zeros_like(fg)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def cut_out(cell, min_alpha=10, pad=3, max_dim=360):
    """Cell → tight-cropped RGBA sprite: flood-fill bg, despeckle, feather."""
    arr = np.asarray(cell, dtype=np.float32)
    bg = flood_bg(arr)
    fg = ~bg
    # despeckle: drop foreground pixels with ≤2 foreground neighbours (8-way)
    n = np.zeros(fg.shape, dtype=np.int16)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                n += np.roll(np.roll(fg, dy, axis=0), dx, axis=1)
    fg &= n > 2
    fg = largest_component(fg)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
    rgba = np.dstack([arr.astype(np.uint8), np.asarray(alpha)])
    a = rgba[..., 3]
    ys, xs = np.where(a > min_alpha)
    if len(xs) == 0:
        return None
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    out = Image.fromarray(rgba[y0:y1, x0:x1])
    if max(out.size) > max_dim:
        s = max_dim / max(out.size)
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    return out


# ───────────────────────────────── terrain ────────────────────────────────────

TILE_KEYS = [  # row-major, matches the prompt cell order; fixed engine slots
    "grass_base", "grass_pebbles", "soil_tilled",
    "soil_seedling", "crop_harvest", "road_dirt",
    "path_stone", "water_stream", "wildflowers",
]
# families whose members must share a base palette (first member is the anchor)
TILE_FAMILIES = [["grass_base", "grass_pebbles", "wildflowers"],
                 ["soil_tilled", "soil_seedling"]]

# THE STYLE BLOCK THAT MATCHES THE BUILDINGS. The building sheets read as soft
# 3D clay-render miniatures; tiles must speak the same material language —
# per-element relief + ambient occlusion, NOT flat cartoon linework. The
# uniform-exposure rule stays absolute: depth comes only from tiny per-element
# shading, never from tile-scale gradients (those strobe per-tile in game).
TILE_STYLE = """Nine square ground-material swatches for a cute 3D isometric diorama game, arranged in a 3x3 grid separated by thin solid black lines.

Render style: soft matte 3D clay-render — the exact same miniature-diorama material language as stylized 3D game buildings. Chunky rounded micro-relief, soft ambient occlusion nestled between elements, gentle matte highlights on top of each element. NO outlines, NO flat cartoon linework, NOT photorealistic.

CRITICAL EXPOSURE RULE: overall brightness is perfectly uniform across each swatch, edge to edge — depth comes ONLY from tiny per-element shading (each pebble, tuft, ripple shades itself). NO large-scale gradients, NO vignette, NO glow spots, NO dark corners. Every pattern continues past its cell edges (wraps seamlessly).

Detail is LARGE and chunky so it stays readable when shrunk very small. All nine swatches share one cozy palette and identical exposure under one soft overhead studio light: {palette}.

{cells}

Strictly flat top-down view of each material, zero perspective. Uniform exposure everywhere."""

# Per-planet culture specs (content per MARA_PLANET_LORE_SPEC.md — Krag worlds
# warm/industrial, Vex worlds cold/military; the lore doc's pixel-art style
# notes are SUPERSEDED by the clay-render winning formula). Each planet fills
# the same nine engine slots; keep the family-consistency phrasing ("the exact
# same …") so harmonize() has coherent inputs.
#
# MATERIAL-ECONOMY RULE (matches the buildings): mostly SMOOTH plain clay with
# SPARSE chunky elements. Dense all-over detail reads as noise next to the
# buildings' calm surfaces and mushes at in-game diamond size (~80px wide).
PLANET_TILES = {
    "mira": dict(   # Krag life world — lush north, warm and lived-in
        palette="fresh spring greens, warm chocolate browns, golden amber, warm tan, jewel blue",
        cells="""Row 1: [1] MEADOW — a smooth soft clay meadow surface in uniform bright spring green, mostly PLAIN smooth clay (at least 70% plain), with small low rounded grass-tuft clusters scattered sparsely and a few tiny lighter-green dots between them. NO dense coverage, NO tall blades. [2] PEBBLED MEADOW — the exact same smooth bright spring-green clay meadow with a few smooth rounded grey-brown pebbles pressed in sparsely. [3] TILLED SOIL — warm chocolate clay soil combed into straight vertical furrows, soft occlusion in the grooves.
Row 2: [4] SEEDLINGS — the exact same furrowed chocolate soil with small bright-green clay sprouts spaced out in neat vertical rows, soil clearly visible between sprouts. [5] HARVEST — golden clay wheat-stubble in vertical rows with warm brown soil clearly visible between the rows. [6] DIRT ROAD — smooth packed warm-tan clay, mostly plain, with faint pressed wheel tracks and only two or three tiny pebbles.
Row 3: [7] COBBLES — rounded pale warm-grey clay cobblestones with soft green moss seams, gentle occlusion between stones. [8] WATER — calm smooth jewel-blue clay water, mostly plain, with a few small soft rounded wavelets scattered sparsely, two close blue tones, subtle gloss, NO ripple rings, NO sparkles. [9] FLOWER MEADOW — the exact same smooth spring-green clay meadow sparsely dotted with tiny clay flowers in soft yellow, pink and white."""),
    "vesper": dict(   # Vex fortress world — grey cratered rock, red tactical accents
        palette="grey rock, dark crater shadow, cold chrome, Vex red accents, floodlight white",
        cells="""Row 1: [1] REGOLITH — smooth soft grey clay rock surface, mostly plain, with sparse small rounded impact pocks and fine dust patches. [2] CRATERED REGOLITH — the exact same smooth grey clay rock with a few sharper dark crater pits pressed in sparsely. [3] TILLED REGOLITH — dark grey processed soil combed into straight vertical furrows, precise and uniform.
Row 2: [4] HYDRO SPROUTS — the exact same dark furrowed regolith with small pale-green clay sprouts in exact vertical rows under thin red marker lines. [5] HYDRO HARVEST — rows of pale grey-green crop stubble over dark regolith, precise spacing. [6] SERVICE ROAD — smooth dark asphalt-grey clay, mostly plain, with one thin red guidance line and faint tread marks.
Row 3: [7] ARMOR PLATING — large smooth black clay deck plates with narrow seams and small recessed bolts, a thin red light line in one seam. [8] COOLANT POOL — still dark steel-blue liquid, mostly plain, with a few small soft wavelets, two close cold tones, NO ripple rings. [9] MARKED REGOLITH — the exact same smooth grey clay rock sparsely dotted with small red-and-white survey markers."""),
    "cinder": dict(   # Vex forge world — basalt islands over lava
        palette="dark basalt, ash grey, molten orange-red lava, terracotta, Vex red trim",
        cells="""Row 1: [1] BASALT FLATS — smooth soft dark-basalt clay surface, mostly plain, with sparse rounded ash-grey dust patches. [2] CLINKER FIELD — the exact same dark basalt clay with a few rounded charcoal clinker stones pressed in sparsely. [3] TILLED ASH — dark umber volcanic soil combed into straight vertical furrows with faint ember-orange warmth deep in the grooves.
Row 2: [4] SPICE SPROUTS — the exact same furrowed ash soil with small red-orange clay chili sprouts spaced out in neat rows. [5] EMBER HARVEST — rows of warm terracotta spice-pod stubble with dark ash soil visible between rows. [6] FORGE ROAD — smooth packed charcoal clay, mostly plain, with faint pressed tracks and a thin Vex-red edge line.
Row 3: [7] BASALT PAVERS — rounded dark basalt clay pavers with warm umber seams, gentle occlusion between stones. [8] LAVA — slow molten lava, deep orange-red, mostly smooth glow, with a few small rounded dark crust islands scattered sparsely, soft inner glow, NO flames, NO sparks. [9] VENT FLATS — the exact same dark basalt clay sparsely dotted with tiny glowing ember-orange vent cracks."""),
    "dusk": dict(   # Krag ice world — brutal outside, amber-warm settlements
        palette="soft snow whites, pale ice blues, silver greys, warm timber brown, amber lamplight",
        cells="""Row 1: [1] SNOWFIELD — smooth soft snow-white clay surface, mostly plain, with sparse low rounded drift mounds and pale blue shadows between them. [2] FROSTED ROCKS — the exact same smooth snowfield with a few smooth silver-grey stones pressed in sparsely, frost on their tops. [3] TILLED FROST-SOIL — cold grey-brown soil combed into straight vertical furrows dusted with snow along the ridge tops.
Row 2: [4] FROSTLEAF SPROUTS — the exact same cold furrowed soil with small mint-green clay sprouts spaced out in neat rows. [5] ICE-GRAPE HARVEST — rows of small frosted blue-violet berry clusters with cold soil visible between rows. [6] PACKED SNOW ROAD — smooth packed pale snow clay, mostly plain, with faint blue pressed sled tracks.
Row 3: [7] ICE PAVERS — rounded pale-blue ice flagstones with deep blue seams, gentle occlusion, soft frost sheen. [8] FROZEN LAKE — smooth deep-blue ice surface, mostly plain, with a few thin pale crack lines, two close blue tones, NO ripple rings. [9] FROST FLOWERS — the exact same smooth snowfield sparsely dotted with tiny pale-teal ice crystal blossoms."""),
    "sorn": dict(   # Krag salvage desert — dust bowl, rusted bones of industry
        palette="pale sand gold, ochre, rust brown, old iron grey, oasis turquoise",
        cells="""Row 1: [1] DUST FLATS — smooth soft pale-gold sand clay surface, mostly plain, with sparse low rounded dune ripples and warm ochre shadows. [2] SALVAGE FIELD — the exact same pale sand with a few small half-buried rusted metal scraps and sienna pebbles pressed in sparsely. [3] TILLED SAND-SOIL — warm ochre irrigated soil combed into straight vertical furrows, darker moisture deep in the grooves.
Row 2: [4] SUNCORN SPROUTS — the exact same ochre furrowed soil with small bright yellow-green clay sprouts spaced out in neat rows. [5] SUNCORN HARVEST — rows of golden corn stubble with warm ochre soil visible between rows. [6] CARAVAN ROAD — smooth hard-packed pale sand clay, mostly plain, with faint pressed cart tracks, sun-bleached.
Row 3: [7] SANDSTONE PAVERS — rounded sun-bleached sandstone clay pavers with warm sand seams, gentle occlusion between stones. [8] OASIS WATER — calm smooth turquoise clay water, mostly plain, with a few small soft wavelets scattered sparsely, two close turquoise tones, NO ripple rings. [9] BLOOM FLATS — the exact same pale sand sparsely dotted with tiny clay desert blooms in coral and white."""),
}


def run_tiles(planet="mira", from_sheet=None):
    if planet not in PLANET_TILES:
        sys.exit(f"unknown planet '{planet}' — choose from {list(PLANET_TILES)}")
    spec = PLANET_TILES[planet]
    out_dir = HERE / planet
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    if from_sheet:                     # re-cut a saved sheet, no API call
        sheet = Image.open(from_sheet).convert("RGB")
        print(f"reprocessing {from_sheet}…")
    else:
        prompt = TILE_STYLE.format(palette=spec["palette"], cells=spec["cells"])
        print(f"generating '{planet}' terrain sheet…")
        sheet = generate(prompt)
        sheet.save(DEBUG / f"tiles_{planet}_sheet.png")
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")

    # inset scales with cell size: square sheets render swatches with rounded
    # "cookie" corners + edge shading that must be cropped away, and grid lines
    # bleed on all sheet shapes
    cell_w = sheet.size[0] // 3
    inset = max(8, cell_w // 20)

    tiles = {}
    for key, cell in zip(TILE_KEYS, grid_cells(sheet, 3, 3, inset=inset)):
        arr = np.asarray(cell, dtype=np.float32)
        arr = flatten_lighting(arr)
        arr = seamless(arr)
        tiles[key] = arr

    for family in TILE_FAMILIES:
        anchor = tiles[family[0]].mean(axis=(0, 1))
        for k in family[1:]:
            tiles[k] = match_mean(tiles[k], anchor)

    for key, arr in tiles.items():
        img = Image.fromarray(arr.astype(np.uint8))
        img = img.filter(ImageFilter.GaussianBlur(0.4))       # kill shimmer
        # preserve the SOURCE aspect — the iso diamond mapping treats texture
        # x/y as the two diamond edges, so squashing square art to 16:9 would
        # pre-distort every element
        s = 320 / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
        img.save(out_dir / f"{planet}_flat_{key}.png")
        tiled = Image.new("RGB", (img.width * 2, img.height * 2))
        for dy in (0, img.height):
            for dx in (0, img.width):
                tiled.paste(img, (dx, dy))
        tiled.save(DEBUG / f"tile_{planet}_{key}_2x2.png")
        print(f"  {planet}_flat_{key}.png  {img.width}x{img.height}  "
              f"({(out_dir/f'{planet}_flat_{key}.png').stat().st_size:,} B)")

    if planet != "mira":
        print(f"\nINTEGRATION — new tileset '{planet}':")
        print(f"  1. src/game/sprites.js: add '{planet}' to TERRAIN_TILESETS")
        print(f"  2. src/game/planet_surface.js: set tileset:'{planet}' in PLANET_DEFS.{planet}")
        print(f"  3. python3 build.py --check")


# ──────────────────────────────── buildings ───────────────────────────────────

BLDG_STYLE = """Cute stylized 3D isometric game buildings, chunky rounded proportions, hand-painted textures, soft warm saturated colors, one soft daylight from the upper left, gentle ambient occlusion, cozy miniature diorama feel like a cartoon city-builder. Classic 2:1 isometric three-quarter view seen from the south-east — the SAME camera angle for every building. Each building floats on a PURE BLACK background: no ground plane, no grass, no cast shadow on the ground, no text, no labels, no borders."""

SHEETS = {
    "port": dict(cols=3, rows=3, keys=[
        "ctrl_tower", "hangar", "cargo_bay",
        "fuel_depot", "comms_tower", "repair_shop",
        "power_station", "med_bay", "round_guard"],
        prompt=BLDG_STYLE + """

A 3x3 grid, one spaceport building per cell, generous black margin around each:
Row 1: [1] CONTROL TOWER — tall slender spaceport tower with a glass observation ring near the top, glowing cyan accent lights. [2] HANGAR — wide half-cylinder hangar with a big segmented front door, warm orange accent stripes. [3] CARGO BAY — long low warehouse with stacked shipping crates by the wall, blue-grey panels.
Row 2: [4] FUEL DEPOT — two round fuel tanks with pipes and hazard stripes, red accents. [5] COMMS TOWER — thin lattice mast carrying two small dishes, teal accent lights. [6] REPAIR SHOP — open garage workshop with a small crane arm over the bay, blue accents.
Row 3: [7] POWER STATION — compact reactor block with glowing warm-yellow coils and vents. [8] MED BAY — clean white clinic with rounded roof and a glowing blue cross sign. [9] GUARD TOWER — small round stone watchtower with a conical roof and a little flag."""),
    "city": dict(cols=3, rows=3, keys=[
        "city_hall", "city_market", "traders_guild",
        "cantina", "hotel", "blacksmith",
        "city_shop", "apartment", "town_house"],
        prompt=BLDG_STYLE + """

A 3x3 grid, one town building per cell, generous black margin around each:
Row 1: [1] CITY HALL — grand cream-stone civic hall with columned entrance and a small gold dome. [2] MARKET HALL — covered market with red-white striped awnings over produce stalls. [3] TRADERS GUILD — timber-framed guild house with a green banner and hanging wooden sign.
Row 2: [4] CANTINA — cozy tavern with warm glowing windows, a barrel by the door, orange lantern sign. [5] HOTEL — narrow three-story hotel with a pink glowing sign and striped entrance awning. [6] BLACKSMITH — stone forge with a chunky chimney, glowing orange furnace mouth, anvil out front.
Row 3: [7] SHOP — small store with one big display window and a cheerful awning. [8] APARTMENTS — chunky four-story apartment block with little balconies and varied windows. [9] TOWN HOUSE — cute half-timbered cottage with a steep tiled roof and flower box."""),
    "towers": dict(cols=5, rows=1, keys=[
        "sky_deco", "sky_glass", "sky_rect", "sky_cyl", "sky_med"],
        prompt=BLDG_STYLE + """

Five cute stylized 3D isometric sci-fi skyscrapers standing in one horizontal row, each tower tall and slim filling most of the image height, clearly separated by wide black gaps, none touching:
[1] ART-DECO TOWER — stepped setbacks narrowing to a metal spire, glowing cyan window bands. [2] GLASS TOWER — sleek smooth glass slab, soft blue reflections, thin floor lines. [3] CITY TOWER — blocky modern tower with purple accent lights. [4] ROUND TOWER — smooth cylindrical tower with a rounded cap and light-blue windows. [5] OFFICE TOWER — mid-rise beveled office tower with warm orange windows."""),
    "landmarks": dict(cols=3, rows=3, keys=[
        "obelisk", "pyramid", "stepped_temple",
        "water_tower", "barracks", "ore_depot",
        "town_house_b", "town_house_c", "apartment_b"],
        prompt=BLDG_STYLE + """

A 3x3 grid, one structure per cell, generous black margin around each. Faction styling per cell: KRAG structures are industrial working-class — riveted iron, rust-orange weathering, warm amber lamplight, salvaged materials; VEX structures are military — smooth black basalt, sharp geometry, thin glowing red tactical lights:
Row 1: [1] KRAG MEMORIAL OBELISK — tall slender riveted iron obelisk on a stone base, rust-orange weathering, engraved plates, one small amber lantern at the tip. [2] SALVAGE PYRAMID — stepped pyramid stacked from sun-bleached sandstone blocks and salvaged rusted metal plates, desert-worn. [3] VEX ZIGGURAT — sharp black basalt stepped ziggurat, smooth stone tiers, thin glowing red light lines along each tier, small flame brazier at the summit.
Row 2: [4] KRAG WATER TOWER — riveted iron water tank on four sturdy legs, rust-red patches, short side ladder, one small amber valve light. [5] KRAG BARRACKS — squat riveted iron bunker with a sandbag entrance, narrow amber slit windows, small flag on a short pole. [6] ORE DEPOT — open-sided riveted iron shed sheltering two small ore carts and a short conveyor arm, warm lamplight inside.
Row 3: [7] WORKER COTTAGE — small cozy cottage with a stone base, timber upper floor, corrugated rust-patched roof, warm amber windows, little chimney. [8] ROW HOUSE — narrow two-story row house with a metal-patched roof, small covered porch, warm windows. [9] TENEMENT — compact three-story brick-and-riveted-iron tenement with a laundry line between windows, warm glowing windows."""),
    "farm": dict(cols=3, rows=3, keys=[
        "sawmill", "quarry", "barn",
        "well", "shelter", "market",
        "city_inn", "city_gate", "silo"],
        prompt=BLDG_STYLE + """

A 3x3 grid, one village building per cell, generous black margin around each:
Row 1: [1] SAWMILL — small timber mill with a big circular saw blade and a log pile. [2] QUARRY RIG — wooden derrick over cut stone blocks. [3] BARN — classic chunky red barn with white trim and gambrel roof.
Row 2: [4] WELL — round stone well with a little wooden roof and bucket on a rope. [5] SHELTER — cozy canvas camping tent with a lantern by the flap. [6] MARKET STALL — village market stand with a green-white striped awning and crates of produce.
Row 3: [7] INN — friendly two-story inn with a hanging sign and window flower boxes. [8] CITY GATE — stone gate arch between two small round towers, gold banner. [9] GRAIN SILO — round grain silo with a domed cap and side ladder."""),
}


# ──────────────────────────────── nodes ───────────────────────────────────────
# Minable resource nodes (trees / rocks / berry bushes) — the interactive layer,
# replacing the emoji placeholders. Larger and more sculptural than the deco
# props; same clay language as the buildings. Buildings-style parsing →
# sprites/<planet>/node_<key>.png

NODE_SHEETS = {
    "mira": dict(cols=3, rows=3, keys=[
        "tree_oak_a", "tree_oak_b", "tree_palm",
        "tree_pine", "tree_cactus", "rock_a",
        "rock_b", "berry_bush", "tree_dead"],
        prompt="""Cute stylized 3D game objects in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft warm saturated colors, one soft daylight from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel like a cartoon city-builder. Each object is ONE connected shape floating on a PURE BLACK background: no ground plane, no grass base, no cast shadow, no text, no borders.

A 3x3 grid, one nature object per cell, generous black margin around each:
Row 1: [1] OAK TREE — chunky clay tree with a fat rounded leafy green canopy on a short thick brown trunk. [2] OAK TREE variant — same clay tree family, slightly different canopy silhouette with two lobes. [3] PALM TREE — cute clay palm with a curved trunk and fat rounded fronds.
Row 2: [4] PINE TREE — plump clay conifer of three stacked rounded green tiers on a stubby trunk. [5] CACTUS — chunky rounded clay saguaro cactus with two arms and tiny pink flower on top. [6] BOULDER — one big smooth rounded grey clay boulder with two smaller ones attached at the base.
Row 3: [7] ROCK variant — a cracked rounded grey-brown clay rock with one visible pale quartz vein. [8] BERRY BUSH — fat rounded clay bush loaded with big glossy blueberries. [9] DEAD TREE — bare twisted clay tree with a few stubby branches, warm grey-brown."""),
}


def run_nodes(planet="mira", from_sheet=None):
    spec = NODE_SHEETS.get(planet)
    if not spec:
        print(f"no NODE_SHEETS spec for '{planet}' — add one first"); return
    out_dir = HERE / planet
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    if from_sheet:
        sheet = Image.open(from_sheet).convert("RGB")
        print(f"reprocessing nodes '{planet}' from {from_sheet}…")
    else:
        print(f"generating nodes '{planet}' sheet…")
        sheet = generate(spec["prompt"])
        sheet.save(DEBUG / f"nodes_{planet}_sheet.png")
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
    for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
        spr = cut_out(cell, max_dim=320)
        if spr is None:
            print(f"  !! {key}: nothing found in cell — regenerate this sheet")
            continue
        spr.save(out_dir / f"node_{key}.png")
        print(f"  node_{key}.png  {spr.size[0]}x{spr.size[1]}  "
              f"({(out_dir/f'node_{key}.png').stat().st_size:,} B)")
    print(f"\nINTEGRATION — node set '{planet}':")
    print(f"  1. src/game/sprites.js: NODE_KEYS registers node_<key> manifest entries")
    print(f"  2. src/game/planet_surface.js: nodeset:'{planet}' in PLANET_DEFS.{planet}")
    print(f"  3. python3 build.py --check")


# ──────────────────────────────── props ───────────────────────────────────────
# Tiny decorative ground-scatter props for the clay-ground pivot (see
# CLAY_GROUND_SPEC.md): flat procedural ground + rich clay props on top.
# Parsed with the buildings parser (black-bg flood removal + tight crop) →
# sprites/<planet>/prop_<key>.png. Rules: every prop ONE connected shape
# (parser drops detached blobs), LOW profile (wider than tall) so the iso
# billboard doesn't loom over the tile.

PROP_SHEETS = {
    "mira": dict(cols=3, rows=3, keys=[
        "grass_tuft_a", "grass_tuft_b", "flower_white",
        "flower_pink", "pebble_cluster", "bush_round",
        "reed_clump", "stone_mossy", "stump_small"],
        prompt="""Cute stylized 3D game props in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft warm saturated colors, one soft daylight from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel. Every prop is small and LOW — wider than it is tall, sitting flat like a game decoration. Each prop is ONE connected shape floating on a PURE BLACK background: no ground plane, no grass base, no cast shadow, no text, no borders.

A 3x3 grid, one tiny meadow prop per cell, generous black margin around each:
Row 1: [1] GRASS TUFT — small rounded clump of short fat clay grass blades, uniform bright spring green, low and wide. [2] GRASS TUFT variant — same clay grass family, slightly different silhouette with one tiny seed head. [3] WHITE FLOWERS — three tiny cream-white clay daisies in one low clump with green leaves.
Row 2: [4] PINK FLOWERS — a low clump of tiny pink clay blossoms with green leaves. [5] PEBBLES — four smooth rounded grey-brown clay pebbles clustered together, very low. [6] ROUND BUSH — one chunky rounded clay bush, bright leafy green, squat and wide.
Row 3: [7] REEDS — a short clump of fat clay cattail reeds with two brown seed heads, low and chunky. [8] MOSSY STONE — one smooth rounded grey clay boulder with a soft green moss cap, low and wide. [9] TREE STUMP — one tiny cut clay tree stump with visible rings and a leaf sprout, low."""),
}


# ──────────────────────────────── clay slabs ──────────────────────────────────
# 3D-clay ISOMETRIC FLOOR TILES — each cell is ONE diamond slab OBJECT (top
# face + softly rounded edges + slight thickness), not a square texture. The
# engine blits them per tile in the iso grid; the visible grout line between
# slabs is intentional (board-game diorama floor). Because slabs are lit
# objects, variants are NEVER rotated/flipped in-engine — lighting stays
# upper-left everywhere. Parsed buildings-style → sprites/<planet>/slab_<key>.png

SLAB_SHEETS = {
    "mira": dict(cols=3, rows=3, keys=[
        "grass_a", "grass_b", "grass_flowers",
        "dirt", "stone_path", "water",
        "soil_tilled", "soil_seedling", "soil_harvest"],
        prompt="""Nine isometric floor tiles for a cute 3D clay miniature diorama game, arranged in a 3x3 grid, each cell ONE single flat diamond-shaped floor tile floating on a PURE BLACK background with generous black margin around each — no ground plane, no cast shadow, no text, no borders.

Every tile is the SAME shape: a classic 2:1 isometric diamond slab (twice as wide as tall), lying flat, with a slight clay thickness visible along the two lower edges and softly rounded corners, soft matte clay-render style, hand-painted feel, one soft daylight from the upper left, gentle per-element ambient occlusion, NO gradients or vignettes across the tile — uniform exposure. The top surface is mostly SMOOTH plain clay with only SPARSE small details.

Row 1: [1] MEADOW TILE — completely smooth plain bright spring-green clay top with NO details at all, just clean clay. [2] MEADOW TILE variant — the exact same green clay with only TWO tiny rounded grass tufts near one corner. [3] FLOWER MEADOW TILE — the exact same green clay with two tiny pink and white clay flowers and one tuft.
Row 2: [4] DIRT TILE — completely smooth plain warm brown packed-earth clay top, no details. [5] COBBLE TILE — the same warm brown clay with big smooth rounded grey clay cobblestones set into the top. [6] WATER TILE — glossy light-blue clay top with one gentle rounded wave bump near a corner, otherwise smooth.
Row 3: [7] TILLED SOIL TILE — rich dark-brown clay top with three neat rounded furrow ridges running parallel. [8] SEEDLING TILE — the exact same dark furrowed clay with three tiny bright-green clay sprouts on the ridges. [9] HARVEST TILE — the exact same dark furrowed clay with three fat leafy green clay plants on the ridges."""),
}


def run_slabs(planet="mira", from_sheet=None):
    spec = SLAB_SHEETS.get(planet)
    if not spec:
        print(f"no SLAB_SHEETS spec for '{planet}' — add one first"); return
    out_dir = HERE / planet
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    if from_sheet:
        sheet = Image.open(from_sheet).convert("RGB")
        print(f"reprocessing slabs '{planet}' from {from_sheet}…")
    else:
        print(f"generating slabs '{planet}' sheet…")
        sheet = generate(spec["prompt"])
        sheet.save(DEBUG / f"slabs_{planet}_sheet.png")
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
    for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
        spr = cut_out(cell, max_dim=320)
        if spr is None:
            print(f"  !! {key}: nothing found in cell — regenerate this sheet")
            continue
        spr.save(out_dir / f"slab_{key}.png")
        print(f"  slab_{key}.png  {spr.size[0]}x{spr.size[1]}  "
              f"({(out_dir/f'slab_{key}.png').stat().st_size:,} B)")
    print(f"\nINTEGRATION — slab set '{planet}':")
    print(f"  1. src/game/sprites.js: SLAB_SETS registers slab_<key> manifest entries")
    print(f"  2. src/game/planet_surface.js: ground:'clay' planets blit slabs in pass 1")
    print(f"  3. python3 build.py --check")


def run_props(planet="mira", from_sheet=None):
    spec = PROP_SHEETS.get(planet)
    if not spec:
        print(f"no PROP_SHEETS spec for '{planet}' — add one first"); return
    out_dir = HERE / planet
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    if from_sheet:
        sheet = Image.open(from_sheet).convert("RGB")
        print(f"reprocessing props '{planet}' from {from_sheet}…")
    else:
        print(f"generating props '{planet}' sheet…")
        sheet = generate(spec["prompt"])
        sheet.save(DEBUG / f"props_{planet}_sheet.png")
    print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
    for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
        spr = cut_out(cell, max_dim=240)          # props are small — cap raster size
        if spr is None:
            print(f"  !! {key}: nothing found in cell — regenerate this sheet")
            continue
        spr.save(out_dir / f"prop_{key}.png")
        print(f"  prop_{key}.png  {spr.size[0]}x{spr.size[1]}  "
              f"({(out_dir/f'prop_{key}.png').stat().st_size:,} B)")
    print(f"\nINTEGRATION — prop set '{planet}':")
    print(f"  1. src/game/sprites.js: PROP_KEYS registers prop_<key> manifest entries")
    print(f"  2. src/game/planet_surface.js: ground:'clay' + deco scatter use them")
    print(f"  3. python3 build.py --check")


# Per-faction accents for future per-planet building packs (lore doc:
# MARA_PLANET_LORE_SPEC.md). Generate with `buildings <sheet> <planet>` →
# sprites/<planet>/bldg_<planet>_<key>.png; drawMiraBldg tries the planet set
# first, then the shared pool, then the procedural fallback.
FACTION_ACCENTS = {
    "krag": "Faction accent: KRAG industrial working-class — riveted iron plating, rust-orange weathering, stack chimneys, salvaged materials, warm amber lamplight in every window.",
    "vex":  "Faction accent: VEX military order — smooth black basalt and chrome, sharp geometric edges, sealed surfaces, thin glowing red tactical lights, cold white floodlights, no warmth, no decoration.",
    "nox":  "Faction accent: NOX ancient organic — grown crystalline structures, no straight lines, curved membrane and dark crystal surfaces, bioluminescent teal and violet glow, sourceless ambient light.",
}
PLANET_FACTION = {"mira": "krag", "dusk": "krag", "sorn": "krag",
                  "vesper": "vex", "cinder": "vex",
                  "halveth": "nox", "nox_prime": "nox"}


def run_buildings(only=None, set_name=None, from_sheet=None):
    out_dir = HERE / (set_name or "mira")
    prefix = f"bldg_{set_name}_" if set_name else "bldg_"
    accent = "\n\n" + FACTION_ACCENTS[PLANET_FACTION[set_name]] if set_name else ""
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    for name, spec in SHEETS.items():
        if only and name != only:
            continue
        tag = f"{name}" + (f" [{set_name}]" if set_name else "")
        if from_sheet:                 # re-cut a saved sheet, no API call
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing '{tag}' from {from_sheet}…")
        else:
            print(f"generating '{tag}' sheet…")
            sheet = generate(spec["prompt"] + accent)
            sheet.save(DEBUG / f"{name}{'_'+set_name if set_name else ''}_sheet.png")
        print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
        for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
            spr = cut_out(cell)
            if spr is None:
                print(f"  !! {key}: nothing found in cell — regenerate this sheet")
                continue
            spr.save(out_dir / f"{prefix}{key}.png")
            print(f"  {prefix}{key}.png  {spr.size[0]}x{spr.size[1]}  "
                  f"({(out_dir/f'{prefix}{key}.png').stat().st_size:,} B)")
    if set_name:
        print(f"\nINTEGRATION — building set '{set_name}':")
        print(f"  1. src/game/sprites.js: add '{set_name}' to BLDG_SETS")
        print(f"  2. src/game/planet_surface.js: set bldgset:'{set_name}' in PLANET_DEFS.{set_name}")
        print(f"  3. python3 build.py --check")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    if cmd in ("tiles", "all"):
        # optional 3rd arg: re-cut a saved sheet (no API call), e.g.
        #   pipeline.py tiles mira sprites/mira/_debug/tiles_mira_sheet.png
        run_tiles(planet=arg or "mira",
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None)
    if cmd == "nodes":
        run_nodes(planet=arg or "mira",
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None)
    if cmd == "slabs":
        # optional 3rd arg: re-cut a saved sheet (no API call)
        run_slabs(planet=arg or "mira",
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None)
    if cmd == "props":
        # optional 3rd arg: re-cut a saved sheet (no API call), e.g.
        #   pipeline.py props mira sprites/mira/_debug/props_mira_sheet.png
        run_props(planet=arg or "mira",
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None)
    if cmd in ("buildings", "all"):
        # optional 3rd arg: planet building set (faction-accented, namespaced
        # keys), e.g. `buildings city vesper`. Optional 4th arg: re-cut a
        # saved sheet (no API call), e.g. `buildings landmarks '' <sheet.png>`
        run_buildings(only=arg,
                      set_name=(sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None),
                      from_sheet=sys.argv[4] if len(sys.argv) > 4 else None)
