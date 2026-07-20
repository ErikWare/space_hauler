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


def recenter_pivot(spr):
    """Pad a TURRET sprite so its rotation pivot lands at the image centre.

    cut_out crops to the content bounding box, which for a turret puts the image
    centre somewhere out along the barrel — rotating about that makes the base
    plate (which is bolted to a rock and must not move) swing in a circle. The
    round base plate is the TALLEST part of the silhouette and the barrel only a
    narrow sliver, so the columns standing at >=85% of max height are the base;
    their midpoint is the pivot. Pad the opposite side until the pivot is centred.
    """
    a = np.asarray(spr)[:, :, 3]
    solid = a > 8
    if not solid.any():
        return spr
    def band_center(counts):
        m = counts.max()
        idx = np.where(counts >= m * 0.85)[0]
        return (idx[0] + idx[-1]) / 2.0
    px = band_center(solid.sum(axis=0))     # columns → pivot x
    py = band_center(solid.sum(axis=1))     # rows    → pivot y
    w, h = spr.size
    dx, dy = int(round(w - 1 - 2 * px)), int(round(h - 1 - 2 * py))
    left, right = max(0, dx), max(0, -dx)
    top, bottom = max(0, dy), max(0, -dy)
    if not (left or right or top or bottom):
        return spr
    out = Image.new("RGBA", (w + left + right, h + top + bottom), (0, 0, 0, 0))
    out.paste(spr, (left, top))
    return out


def cut_out(cell, min_alpha=10, pad=3, max_dim=360, dark_max=34):
    """Cell → tight-cropped RGBA sprite: flood-fill bg, despeckle, feather.
    dark_max: raise (~60) when a sheet came back on textured dark-grey instead
    of pure black and background chunks survive the default flood."""
    arr = np.asarray(cell, dtype=np.float32)
    bg = flood_bg(arr, dark_max=dark_max)
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

CRITICAL: absolutely NO text, NO labels, NO captions, NO letters or numbers anywhere in the image. Each swatch is ONE uniform material filling its entire cell edge to edge — never a scene, never a landscape, no horizon, no perspective objects.

Detail is LARGE and chunky so it stays readable when shrunk very small. All nine swatches share one cozy palette and identical exposure under one soft overhead studio light: {palette}.

{cells}

Strictly flat top-down view of each material, zero perspective. Uniform exposure everywhere. FINAL RULE, most important: this is a TEXTURE ATLAS — absolutely NO text, NO labels, NO captions, NO names, NO letters anywhere in the image, and every swatch fills its whole cell with one material, never a scene."""

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
Row 2: [4] HYDRO SPROUTS — the exact same dark furrowed regolith with small pale-green clay sprouts in exact vertical rows under thin red marker lines. [5] HYDRO HARVEST — rows of pale grey-green crop stubble over dark regolith, precise spacing. [6] SERVICE ROAD — uniform smooth dark asphalt-grey clay surface filling the whole cell, mostly plain, faint tread marks, one thin straight red guidance line running exactly vertically.
Row 3: [7] ARMOR PLATING — large smooth black clay deck plates with narrow seams and small recessed bolts, a thin red light line in one seam. [8] COOLANT POOL — still dark steel-blue liquid, mostly plain, with a few small soft wavelets, two close cold tones, NO ripple rings. [9] MARKED REGOLITH — the exact same smooth grey clay rock sparsely dotted with small red-and-white survey markers."""),
    "cinder": dict(   # Vex forge world — basalt islands over lava
        palette="dark basalt, ash grey, molten orange-red lava, terracotta, Vex red trim",
        cells="""Row 1: [1] BASALT FLATS — smooth soft dark-basalt clay surface, mostly plain, with sparse rounded ash-grey dust patches. [2] CLINKER FIELD — the exact same dark basalt clay with a few rounded charcoal clinker stones pressed in sparsely. [3] TILLED ASH — dark umber volcanic soil combed into straight vertical furrows with faint ember-orange warmth deep in the grooves.
Row 2: [4] SPICE SPROUTS — the exact same furrowed ash soil with small red-orange clay chili sprouts spaced out in neat rows. [5] EMBER HARVEST — rows of warm terracotta spice-pod stubble with dark ash soil visible between rows. [6] FORGE ROAD — uniform smooth packed charcoal clay surface filling the whole cell edge to edge, mostly plain, faint pressed tracks, one thin straight Vex-red line running exactly vertically. NO band, NO stripe, NO diagonal.
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


def run_tiles(planet="mira", from_sheet=None, strip_bottom=0.0):
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
        if strip_bottom:
            # The model bakes caption text into the bottom band of each cell on
            # ~half of all generations, ignoring every no-text prompt rule.
            # Deterministic salvage (no API cost): crop the band off before the
            # flatten/seamless passes — the material continues behind it.
            cell = cell.crop((0, 0, cell.width, int(cell.height * (1 - strip_bottom))))
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


# ──────────────────────────── space fleet + stations ─────────────────────────
# Per-civilization space sprites: one sheet of warships (battle-group classes
# matching CLASS_BY_TIER in modules/faction.js — fighter/raider/gunship/carrier,
# drawn rotated in top-down space, so STRICT top-down + nose RIGHT is required),
# and one sheet with the civ's orbital station + defense outpost (drawn
# unrotated, so they use the buildings' 3/4 diorama view). Same clay language
# as the building packs. Parsed buildings-style → sprites/space/.

SPACE_SHIP_STYLE = """Four stylized 3D spacecraft in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel like a cartoon fleet game. Arranged in a 2x2 grid, one spacecraft per cell, generous PURE BLACK margin around each — no planet, no stars, no ground, no cast shadow, no text, no labels, no borders.

CRITICAL VIEW RULE: STRICT TOP-DOWN bird's-eye view of every ship, the nose of every ship points to the RIGHT, long axis perfectly horizontal. All four ships share one coherent fleet design language and READ AS THE SAME NAVY at four sizes.

Row 1: [1] ATTACK DRONE — tiny single-seat drone fighter, the smallest and simplest silhouette, compact dart shape, one engine. [2] FRIGATE — small escort warship, slim hull, twin engines, a couple of small gun mounts.
Row 2: [3] DESTROYER — heavy angular warship, wide armored hull, visible side gun pods and turrets, twin heavy engines. [4] CARRIER — the largest ship: long capital hull with a full-length central flight deck, glowing hangar mouth at the stern, bridge tower, running lights along the deck edges."""

SPACE_STATION_STYLE = """Two stylized 3D space structures in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel — the same miniature-model language as stylized 3D game buildings. Arranged in one row of two cells, one structure per cell, generous PURE BLACK margin around each — no planet, no stars, no ground, no cast shadow, no text, no labels, no borders. Classic three-quarter view like a miniature model, the SAME camera angle for both.

[1] ORBITAL SPACE STATION — a large majestic space station: central habitat hub, a docking ring with docking arms, antenna masts, glowing window bands, small docked shuttle. The civilization's flagship home in space. [2] DEFENSE OUTPOST — a much smaller automated weapons platform: compact core module on a short truss, two turret mounts, one stubby solar fin, a small beacon light."""

# Ship-specific accent wording (the building accents talk about lamplit windows
# and basalt walls; ships need hull/engine language in the same palette).
SPACE_ACCENTS = {
    "krag": "Fleet style: KRAG industrial working-class navy — riveted rust-iron hull plating, mismatched salvaged armor panels, exposed pipes and welds, warm amber engine glow and amber running lights, chunky asymmetric industrial silhouettes.",
    "vex":  "Fleet style: VEX military order — smooth black basalt and chrome armor, sharp knife-edge geometry, sealed seamless surfaces, thin glowing red tactical light lines, cold white floodlights, red engine glow, ruthless symmetry.",
    "nox":  "Fleet style: NOX ancient organic — grown crystalline hulls with NO straight lines, curved membrane and dark iridescent crystal surfaces, bioluminescent teal and violet glow from within, engines glow soft violet, silhouettes like deep-sea creatures.",
}


def run_space(civ, only=None, from_sheet=None, dark_max=34):
    if civ not in SPACE_ACCENTS:
        sys.exit(f"unknown civ '{civ}' — choose from {list(SPACE_ACCENTS)}")
    out_dir = HERE / "space"
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    accent = ("\n\n" + SPACE_ACCENTS[civ] +
              " THIS FLEET STYLE OVERRIDES any material or color named above:"
              " keep each cell's craft TYPE and role silhouette, render ALL"
              " materials, colors and lighting in the fleet style. EXACTLY one"
              " craft per grid cell — no extra craft.")
    jobs = {
        "ships":    dict(cols=2, rows=2, style=SPACE_SHIP_STYLE, max_dim=360,
                         keys=["fighter", "raider", "gunship", "carrier"],
                         name=lambda k: f"ship_{civ}_{k}.png"),
        "stations": dict(cols=2, rows=1, style=SPACE_STATION_STYLE, max_dim=480,
                         keys=["station", "outpost"],
                         name=lambda k: f"{k}_{civ}.png"),
    }
    for job, spec in jobs.items():
        if only and job != only:
            continue
        if from_sheet:
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing space {job} [{civ}] from {from_sheet}…")
        else:
            print(f"generating space {job} [{civ}] sheet…")
            sheet = generate(spec["style"] + accent)
            sheet.save(DEBUG / f"space_{job}_{civ}_sheet.png")
        print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
        for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
            spr = cut_out(cell, max_dim=spec["max_dim"], dark_max=dark_max)
            if spr is None:
                print(f"  !! {key}: nothing found in cell — regenerate this sheet")
                continue
            fname = spec["name"](key)
            spr.save(out_dir / fname)
            print(f"  {fname}  {spr.size[0]}x{spr.size[1]}  "
                  f"({(out_dir/fname).stat().st_size:,} B)")
    print(f"\nINTEGRATION — space set '{civ}':")
    print(f"  1. src/game/sprites.js: SPACE_CLAY_KEYS registers ship_/station_/outpost_ {civ} keys")
    print(f"  2. rendering.js drawEnemyShip + outposts.js draw sprite-first")
    print(f"  3. python3 build.py --check")


# ─────────────────────────── player fleet + drones ───────────────────────────
# The player's three hulls (menu progression vulture→atlas→aegis, keys =
# ships.js hullKey) and the three drone quality tiers (drones.js DRONES.tiers,
# colours follow tierCol: steel blue → teal → purple). Same clay language and
# STRICT top-down nose-RIGHT convention as the civ fleets (both rotate in
# space). Quality/coolness escalates left to right in each sheet.

PLAYER_SHIPS_STYLE = """Three stylized 3D spacecraft in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel like a cartoon fleet game. Arranged in one row of three cells, one spacecraft per cell, generous PURE BLACK margin around each — no planet, no stars, no ground, no cast shadow, no text, no labels, no borders.

CRITICAL VIEW RULE: STRICT TOP-DOWN bird's-eye view of every ship, the nose of every ship points to the RIGHT, long axis perfectly horizontal. All three ships are the SAME independent hauler fleet at three quality tiers — friendly bright teal-cyan livery with warm amber windows and subtle rust-orange accent stripes. Quality, polish and size escalate left to right: tier 1 scrappy, tier 2 professional, tier 3 elite flagship.

[1] VULTURE TUG — small scrappy hauler tug: chunky boxy hull, one oversized engine for its size, mismatched salvaged panel patches, a small towing claw at the bow, lovable underdog. [2] ATLAS FREIGHTER — mid-size cargo freighter: long spine hull with two clamped cargo containers, twin engines, the same teal livery grown clean and professional, warm cabin lights. [3] AEGIS BATTLECRUISER — sleek elite battlecruiser: polished armored hull, integrated gun mounts along the sides, triple engine array with bright glow, the teal livery made regal with chrome and gold trim — clearly the pride of the fleet."""

PLAYER_DRONES_STYLE = """Three tiny stylized 3D combat drones in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel. Arranged in one row of three cells, one drone per cell, generous PURE BLACK margin around each — no planet, no stars, no ground, no cast shadow, no text, no labels, no borders.

CRITICAL VIEW RULE: STRICT TOP-DOWN bird's-eye view of every drone, the nose of every drone points to the RIGHT. All three are the SAME drone product line at three quality tiers — small pilotless craft, each with one glowing camera eye at the bow. Quality, armament and coolness escalate left to right.

[1] BASIC DRONE — simple utility drone in STEEL BLUE clay: rounded boxy pod, single small thruster, one thin laser barrel, a little dented and plain. [2] REINFORCED DRONE — sleeker drone in bright TEAL clay: rounded aerodynamic pod, twin thrusters, small folded repair arms at the sides, clean panel lines. [3] ARMORED DRONE — combat drone in dark clay with VIOLET-PURPLE glowing accents: chunky layered armor plates, prominent top-mounted cannon, triple thruster block, two small shield-emitter fins — the meanest little machine in the hangar."""


def run_fleet(only=None, from_sheet=None, dark_max=34):
    # The player hulls moved to run_playerlines (2026-07-18) — they now ship
    # animation frames + showroom shots that this single-sheet job can't make,
    # and its output paths would silently clobber that art.
    if only == "ships" or only is None:
        sys.exit("`fleet ships` is retired — the hauler hulls are generated by\n"
                 "  python3 sprites/pipeline.py playerlines [vulture|atlas|aegis]\n"
                 "Use `fleet drones` for the drone tiers.")
    out_dir = HERE / "space"
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    jobs = {
        "ships":  dict(style=PLAYER_SHIPS_STYLE, max_dim=420,
                       keys=["vulture", "atlas", "aegis"],
                       name=lambda k: f"ship_{k}.png"),
        "drones": dict(style=PLAYER_DRONES_STYLE, max_dim=200,
                       keys=["t0", "t1", "t2"],
                       name=lambda k: f"drone_{k}.png"),
    }
    for job, spec in jobs.items():
        if only and job != only:
            continue
        if from_sheet:
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing fleet {job} from {from_sheet}…")
        else:
            print(f"generating fleet {job} sheet…")
            sheet = generate(spec["style"])
            sheet.save(DEBUG / f"fleet_{job}_sheet.png")
        print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
        for key, cell in zip(spec["keys"], grid_cells(sheet, 3, 1, inset=4)):
            spr = cut_out(cell, max_dim=spec["max_dim"], dark_max=dark_max)
            if spr is None:
                print(f"  !! {key}: nothing found in cell — regenerate this sheet")
                continue
            fname = spec["name"](key)
            spr.save(out_dir / fname)
            print(f"  {fname}  {spr.size[0]}x{spr.size[1]}  "
                  f"({(out_dir/fname).stat().st_size:,} B)")
    print("\nINTEGRATION — player fleet:")
    print("  1. src/game/sprites.js: SPACE_CLAY_KEYS registers ship_vulture/atlas/aegis + drone_t0/t1/t2")
    print("  2. rendering.js player ship + fleet.js/outposts.js drone draw sprite-first")
    print("  3. python3 build.py --check")


# ───────────────────────────── space world bodies ────────────────────────────
# The inert space furniture: junk floaters, ore asteroids (NEUTRAL grey — the
# engine tints per ore via ART.drawTint's baked cache, so variants stay cheap),
# planet globes (one per CONFIG.planetDefs type; rings stay procedural on top),
# moons and large planetoids. All are existing draw calls swapped sprite-first —
# no new entities, so no perf change beyond a handful of cached tints.

_WORLD_BASE = """{count} stylized 3D space objects in soft matte clay-render style, chunky rounded proportions, hand-painted feel, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel. Arranged in a {grid} grid, one object per cell, generous PURE BLACK margin around each — no stars, no ground, no cast shadow, no text, no labels, no borders.

"""

WORLD_SHEETS = {
    "junk": dict(cols=2, rows=2, max_dim=200,
        keys=["junk_can", "junk_panel", "junk_crate", "junk_debris"],
        prompt=_WORLD_BASE.format(count="Four", grid="2x2") +
"""Derelict salvage floating in space, weathered greys and rust with faint teal paint remnants:
Row 1: [1] SUPPLY CANISTER — a dented cylindrical supply can, chipped paint bands, one bent valve. [2] HULL PANEL — a torn-off hull plate, riveted edge, scorch marks, bent corner.
Row 2: [3] CARGO CRATE — a battered cubic cargo crate, strap loops, faded hazard stripe. [4] DEBRIS TANGLE — one connected clump of twisted struts, pipe elbows and a broken thruster bell."""),
    "asteroids": dict(cols=2, rows=2, max_dim=240,
        keys=["asteroid_a", "asteroid_b", "asteroid_c", "asteroid_crystal"],
        prompt=_WORLD_BASE.format(count="Four", grid="2x2") +
"""Asteroids in NEUTRAL matte grey clay (no color cast — the game recolors them), soft crater dents and chunky facets:
Row 1: [1] ROUND ASTEROID — one chunky rounded asteroid, softly cratered. [2] JAGGED ASTEROID — one angular asteroid with chunky facets and a deep notch.
Row 2: [3] LUMPY ASTEROID — one potato-shaped asteroid with two smaller lumps fused on. [4] CRYSTAL ASTEROID — one grey asteroid with big faceted pale crystals jutting from cracks."""),
    # Planet globes are split across five small-grid sheets (4× 2x1 + 1× 1x1)
    # instead of one 3x3: rendering.js draws them at p.r*2.05*z which reaches
    # 1000-2900px on screen for the big CONFIG.solarPlanets, and 3x3 cells of a
    # 1280x720 sheet cap the spheres at ~210px (blurry up close). Two cells per
    # landscape sheet yields ~500-640px spheres. Same nine concepts and keys as
    # the original sheet (sprites/mira/_debug/world_planets_sheet.png).
    "planets_a": dict(cols=2, rows=1, max_dim=700,
        keys=["planet_cratered", "planet_lava"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Planet globes — each cell ONE perfect sphere seen from space, soft clay-render surface detail that stays simple, chunky and rounded like smooth plasticine (NOT photorealistic rock or cloud texture), NO rings, NO moons, NO atmosphere haze beyond the sphere edge, sphere centered in its cell and LARGE, filling about three quarters of the cell height:
Left cell: [1] CRATERED WORLD — grey-beige rocky sphere, heavy soft craters.
Right cell: [2] LAVA WORLD — dark basalt sphere webbed with glowing orange lava cracks."""),
    "planets_b": dict(cols=2, rows=1, max_dim=700,
        keys=["planet_tan_gas", "planet_ice"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Planet globes — each cell ONE perfect sphere seen from space, soft clay-render surface detail that stays simple, chunky and rounded like smooth plasticine (NOT photorealistic rock or cloud texture), NO rings, NO moons, NO atmosphere haze beyond the sphere edge, sphere centered in its cell and LARGE, filling about three quarters of the cell height:
Left cell: [1] TAN GAS GIANT — creamy tan sphere with soft horizontal cloud bands.
Right cell: [2] ICE WORLD — white-blue sphere with pale ice sheets and deep blue frozen seas."""),
    "planets_c": dict(cols=2, rows=1, max_dim=700,
        keys=["planet_life", "planet_desert"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Planet globes — each cell ONE perfect sphere seen from space, soft clay-render surface detail that stays simple, chunky and rounded like smooth plasticine (NOT photorealistic rock or cloud texture), NO rings, NO moons, NO atmosphere haze beyond the sphere edge, sphere centered in its cell and LARGE, filling about three quarters of the cell height:
Left cell: [1] LIVING WORLD — lush green-and-ocean-blue sphere with soft white cloud swirls.
Right cell: [2] DESERT WORLD — warm sand-orange sphere with dune bands and dark canyon lines."""),
    "planets_d": dict(cols=2, rows=1, max_dim=700,
        keys=["planet_purple_gas", "planet_dark"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Planet globes — each cell ONE perfect sphere seen from space, soft clay-render surface detail that stays simple, chunky and rounded like smooth plasticine (NOT photorealistic rock or cloud texture), NO rings, NO moons, NO atmosphere haze beyond the sphere edge, sphere centered in its cell and LARGE, filling about three quarters of the cell height:
Left cell: [1] VIOLET GAS GIANT — soft purple sphere with lavender cloud bands and one pale storm oval.
Right cell: [2] DARK WORLD — near-black ominous sphere with faint violet glow lines, quiet and alien."""),
    "planets_e": dict(cols=1, rows=1, max_dim=700,
        keys=["planet_gas_giant"],
        prompt=_WORLD_BASE.format(count="One", grid="1x1 (a single centered cell)") +
"""Planet globe — ONE perfect sphere seen from space, soft clay-render surface detail that stays simple, chunky and rounded like smooth plasticine (NOT photorealistic rock or cloud texture), NO rings, NO moons, NO atmosphere haze beyond the sphere edge, sphere centered and LARGE, filling about three quarters of the image height:
[1] GAS GIANT — pastel lavender-green sphere with gentle bands."""),
    "moons": dict(cols=3, rows=2, max_dim=300,
        keys=["moon_a", "moon_b", "moon_c",
              "planetoid_a", "planetoid_b", "planetoid_c"],
        prompt=_WORLD_BASE.format(count="Six", grid="3x2") +
"""Row 1 — MOONS, each ONE small perfect sphere centered in its cell: [1] pale grey cratered moon. [2] icy white-blue moon with frost sheen. [3] rusty tan moon with dark mare patches.
Row 2 — PLANETOIDS, each ONE huge irregular rock body, far larger and more massive-looking than an asteroid: [4] heavily cratered grey planetoid, almost round but lumpy. [5] elongated jagged planetoid with deep canyon grooves. [6] planetoid with several big boulders fused onto its surface."""),
}


def run_world(only=None, from_sheet=None, dark_max=34):
    out_dir = HERE / "space"
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    for job, spec in WORLD_SHEETS.items():
        if only and job != only:
            continue
        if from_sheet:
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing world {job} from {from_sheet}…")
        else:
            print(f"generating world {job} sheet…")
            sheet = generate(spec["prompt"])
            sheet.save(DEBUG / f"world_{job}_sheet.png")
        print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
        for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
            spr = cut_out(cell, max_dim=spec["max_dim"], dark_max=dark_max)
            if spr is None:
                print(f"  !! {key}: nothing found in cell — regenerate this sheet")
                continue
            spr.save(out_dir / f"{key}.png")
            print(f"  {key}.png  {spr.size[0]}x{spr.size[1]}  "
                  f"({(out_dir/f'{key}.png').stat().st_size:,} B)")
    print("\nINTEGRATION — space world bodies:")
    print("  1. src/game/sprites.js: SPACE_CLAY_KEYS registers junk/asteroid/planet/moon/planetoid keys")
    print("  2. rendering.js rocks/planets/moons draw sprite-first (junk keys unchanged)")
    print("  3. python3 build.py --check")


# ───────────────────────────── site landmarks ────────────────────────────────
# Phase-4 region sites: asteroid clusters, human shipwrecks, and a derelict
# alien station (two sheets: body + detail). Static space furniture placed at
# region centers by src/game/sites.js. Raw sheets are ALSO kept in
# sprites/space/ under fixed names (game-side placeholder logic keys on the
# cut pieces, but the sheets are part of the deliverable). Same clay language
# and black-bg parse as the other space sets. NOTE for the parser: subjects
# must stay mid-tone — a charcoal rock that drops below the flood threshold
# gets eaten as background, so prompts ask for mid-grey bodies + dark accents.

SITE_SHEETS = {
    "asteroid_cluster": dict(cols=3, rows=2, max_dim=300, sheet="asteroid_cluster_sheet.png",
        keys=["asteroid_chunk_1", "asteroid_chunk_2", "asteroid_chunk_3",
              "asteroid_chunk_4", "asteroid_chunk_5", "asteroid_chunk_6"],
        prompt=_WORLD_BASE.format(count="Six", grid="3x2") +
"""Varied space rocks in matte clay-render style — mid-grey to warm charcoal stone (never near-black, the silhouette must stay clearly brighter than the pure black background), each rock veined with thin glowing mineral seams in warm orange and cool teal, soft crater dents and chunky facets:
Row 1: [1] LARGE JAGGED BOULDER — one big angular boulder, sharp chunky facets, prominent orange mineral veins in the cracks. [2] MEDIUM CRATERED ROCK — one rounded mid-size rock, softly cratered, faint teal vein glints. [3] SMALL TUMBLING FRAGMENT — one small chipped fragment, irregular, a single orange vein.
Row 2: [4] ELONGATED SHARD — one long splinter-shaped rock, tapered ends, teal veins along its length. [5] FLAT DISC ROCK — one flat rounded disc-shaped rock seen at a slight angle, layered strata edges, orange seam glow between layers. [6] SMALL ROUNDED PEBBLE — one small smooth rounded rock, minimal detail, one tiny teal glint."""),
    "shipwreck": dict(cols=2, rows=2, max_dim=340, sheet="shipwreck_sheet.png",
        keys=["wreck_bow", "wreck_hull", "wreck_stern", "wreck_debris"],
        prompt=_WORLD_BASE.format(count="Four", grid="2x2") +
"""Derelict human cargo freighter wreckage drifting in space — rust-brown and burnt scorched metal with cold blue-grey shadowed plating, torn edges, dead dark windows, NO lights, NO glow, clearly long-abandoned:
Row 1: [1] CRUMPLED BOW SECTION — the crushed front nose of a freighter, shattered dark viewport, buckled rusty plating folded like paper. [2] MID-HULL SECTION — a broken mid-body hull segment, torn plating peeled open showing bent ribs and dangling cables, faded hazard stripe remnant.
Row 2: [3] ENGINE STERN — the rear engine block, two dead cold thruster cones, scorched burnt-metal shrouds, ruptured fuel lines. [4] DEBRIS TANGLE — one connected clump of drifting wreck scatter: bent hull plates, pipe segments and a torn girder fused into a single tangle."""),
    "alien_station_a": dict(cols=2, rows=1, max_dim=460, sheet="alien_station_a.png",
        keys=["alien_body", "alien_wing"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Ancient derelict ALIEN space station of an unknown vanished race — organic-geometric hybrid architecture, clearly NON-HUMAN: asymmetric curved spires and tendril-like arms grown rather than built, dark corroded grey-violet shell material pitted with age (mid-tone, never near-black), thin bioluminescent veins of cyan and purple still faintly glowing along the surface seams:
Left cell: [1] MAIN BODY — the large central mass of the derelict station: a lopsided organic hulk with two bent spires and several short broken tendril stumps, faint cyan-purple vein glow tracing its ridges. [2] DETACHED WING — a torn-off arm section drifting separately: one long curved tendril-wing with a frayed broken root end, the same corroded shell and faint purple vein glow."""),
    # Site base emplacements (game/sites.js). TWO looks per weapon type so the
    # ~228 armed sites don't all read identically; the variant is picked off the
    # stable _siteHash. These are drawn ROTATED to track the player, so they MUST
    # come back strict top-down with the muzzle RIGHT — same convention as the civ
    # fleets. First attempt (2026-07-17) came back as 3/4 pedestal views because
    # the prompt described "a weapon assembly ON TOP OF a base": you can only show
    # something on top of something else by tilting the camera. Fixed by leading
    # with a CRITICAL VIEW RULE block (the phrasing that works for the ship
    # sheets) and by demanding the base plate read as a PERFECT CIRCLE — an
    # ellipse is the tell-tale of a tilted camera. Colors are locked to the UI
    # accents in _drawEmplacement (laser #c23bd6 violet, missile #ffae42 amber).
    "emplacements": dict(cols=2, rows=2, max_dim=300, sheet="emplacements_sheet.png", pivot=True,
        keys=["emp_laser_a", "emp_laser_b", "emp_missile_a", "emp_missile_b"],
        prompt=_WORLD_BASE.format(count="Four", grid="2x2") +
"""CRITICAL VIEW RULE: STRICT TOP-DOWN bird's-eye view in EVERY cell — the camera looks straight DOWN at each turret from directly overhead, exactly like a turret unit sprite in a top-down strategy game. ZERO perspective, zero tilt, no horizon: the round armored base plate under each turret must read as a PERFECT CIRCLE, never an oval or an ellipse, and NONE of that base's side wall may be visible. Every barrel, muzzle and launch rail points exactly RIGHT, long axis perfectly horizontal. Each turret sits centred on its round base plate at the exact centre of its own cell.

Four fixed heavy WEAPON EMPLACEMENTS seen from directly above — each one is a round armored base plate with a single weapon assembly lying flat across it aimed right. Only the turret itself: no rock, no asteroid, no ground, no crew, no projectiles, no muzzle flash.
Row 1 — ION BEAM CANNONS, dark violet-grey armor plating with glowing magenta-violet energy parts: [1] SINGLE-LENS ION CANNON — one thick stubby barrel aimed right, ending in a large round glowing magenta lens seen as a perfect circle, two curved capacitor coils lying flat either side of the breech. [2] PRONG EMITTER ION CANNON — three slender parallel emitter prongs aimed right from a central breech block, violet energy arcing between the prong tips, ribbed heat sinks lying flat either side.
Row 2 — MISSILE BATTERIES, gunmetal and warm amber-orange armor plating with hazard striping: [3] TUBE-RACK MISSILE BATTERY — a rectangular launcher block aimed right, its open launch tubes seen as a 3x2 grid of round mouths across the right-hand end, amber missile noses visible inside. [4] DRUM MISSILE LAUNCHER — a round rotary drum seen as a perfect circle from above, launch ports spaced around its rim, one short guide rail projecting right, amber hazard stripes across the drum's flat top face."""),
    "alien_station_b": dict(cols=2, rows=1, max_dim=300, sheet="alien_station_b.png",
        keys=["alien_glyph", "alien_conduit"],
        prompt=_WORLD_BASE.format(count="Two", grid="2x1 (two cells side by side in one row)") +
"""Close-detail fragments of an ancient derelict ALIEN space station — the same vanished-race design language: organic-geometric corroded grey-violet shell material (mid-tone, never near-black) with bioluminescent cyan and purple accents:
Left cell: [1] GLYPH PANEL — one intact curved alien wall panel etched with rows of strange glowing cyan glyph symbols, the only part still fully lit, softly radiant. [2] CRACKED CONDUIT NODE — one bulbous organic energy-conduit pod, split by a deep crack leaking faint purple light, corroded shell flaking around the fracture."""),
}


def run_sites(only=None, from_sheet=None, dark_max=34):
    out_dir = HERE / "space"
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    for job, spec in SITE_SHEETS.items():
        if only and job != only:
            continue
        if from_sheet:
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing site sheet '{job}' from {from_sheet}…")
        else:
            print(f"generating site sheet '{job}'…")
            sheet = generate(spec["prompt"])
        sheet.save(out_dir / spec["sheet"])
        print(f"  {spec['sheet']}  {sheet.size[0]}x{sheet.size[1]}")
        for key, cell in zip(spec["keys"], grid_cells(sheet, spec["cols"], spec["rows"], inset=4)):
            spr = cut_out(cell, max_dim=spec["max_dim"], dark_max=dark_max)
            if spr is None:
                print(f"  !! {key}: nothing found in cell — regenerate this sheet")
                continue
            if spec.get("pivot"):     # turrets are drawn rotated → centre the base plate
                spr = recenter_pivot(spr)
            spr.save(out_dir / f"{key}.png")
            print(f"  {key}.png  {spr.size[0]}x{spr.size[1]}  "
                  f"({(out_dir/f'{key}.png').stat().st_size:,} B)")
    print("\nINTEGRATION — site landmarks:")
    print("  1. src/game/sprites.js: SPACE_CLAY_KEYS registers asteroid_chunk_/wreck_/alien_ keys")
    print("  2. src/game/sites.js places pieces; rendering.js draws sprite-first")
    print("  3. python3 build.py --check")


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

# Per-planet flavor appended AFTER the faction accent so sibling worlds of the
# same faction still read distinct (lore: MARA_PLANET_LORE_SPEC.md).
PLANET_FLAVOR = {
    "dusk":   " Ice-world variant: every roof, ledge and tank top carries a soft dusting of snow, small icicles hang under the eaves, and the amber window glow burns extra warm against the cold — a settlement huddled against a -80C blizzard world.",
    "sorn":   " Salvage-desert variant: sun-bleached and sand-scoured surfaces, pale dust drifted against every wall, structures visibly jury-rigged from salvaged machine parts and canvas — a scavenger town built from the bones of old strip-mining industry.",
    "cinder": " Forge-world variant: ash-smeared surfaces and a faint warm ember underglow reflected from below.",
}


def run_buildings(only=None, set_name=None, from_sheet=None):
    out_dir = HERE / (set_name or "mira")
    prefix = f"bldg_{set_name}_" if set_name else "bldg_"
    # The accent must OVERRIDE the per-cell colors/materials, not just trail
    # them — a bare trailing accent line loses to strong per-cell color words
    # (learned on vesper: city/farm sheets came back cozy-timber mira style).
    accent = ("\n\n" + FACTION_ACCENTS[PLANET_FACTION[set_name]] +
              PLANET_FLAVOR.get(set_name, "") +
              " THIS FACTION STYLE OVERRIDES every material and color named in the"
              " cell descriptions above: keep each cell's building TYPE and"
              " silhouette, but re-imagine ALL its materials, colors and lighting"
              " in the faction language. EXACTLY one building per grid cell —"
              " no extra buildings.") if set_name else ""
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    for name, spec in SHEETS.items():
        if only and name != only:
            continue
        tag = f"{name}" + (f" [{set_name}]" if set_name else "")
        prompt = spec["prompt"]
        if set_name:
            # The landmarks sheet bakes its own per-cell KRAG/VEX styling (for
            # the shared mira pool). For a planet set those cell prefixes beat
            # the appended accent — strip them so the planet's faction rules.
            prompt = (prompt
                      .replace("Faction styling per cell: KRAG structures are industrial working-class — riveted iron, rust-orange weathering, warm amber lamplight, salvaged materials; VEX structures are military — smooth black basalt, sharp geometry, thin glowing red tactical lights:", "One structure per cell:")
                      .replace("KRAG MEMORIAL OBELISK", "MEMORIAL OBELISK")
                      .replace("VEX ZIGGURAT", "STEPPED ZIGGURAT")
                      .replace("KRAG WATER TOWER", "WATER TOWER")
                      .replace("KRAG BARRACKS", "BARRACKS"))
        if from_sheet:                 # re-cut a saved sheet, no API call
            sheet = Image.open(from_sheet).convert("RGB")
            print(f"reprocessing '{tag}' from {from_sheet}…")
        else:
            print(f"generating '{tag}' sheet…")
            sheet = generate(prompt + accent)
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


# ─────────────────────── player faction ship lines ───────────────────────────
# The player-ship overhaul: three buyable faction lines (Krag battlecruisers /
# Vex destroyers / Nox carriers, 3 tiers each — keys match CONFIG.hulls). ONE
# 3x3 sheet per ship: cells 1-5 are strict top-down nose-RIGHT flight frames
# (idle / full burn / laser / cannon / missile fire — rendering.js swaps them
# live), cells 6-9 are glamour beauty shots for the SHIPS market carousel.
# Same clay language as the civ fleets, plus the militaristic-steampunk accent.

PLAYER_LINE_FLIGHT_STYLE = """Six top-down views of ONE single stylized 3D spacecraft in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel like a cartoon fleet game. Arranged in a 3x2 grid (three columns, two rows) separated by thin solid black lines, one view per cell, generous PURE BLACK margin around each view, pure black background — no stars, no planet, no ground, no cast shadow, absolutely NO text, NO labels, NO numbers, NO borders.

CRITICAL VIEW RULE: STRICT TOP-DOWN bird's-eye view in EVERY cell, looking straight down at the spacecraft's dorsal side like a unit sprite in a top-down strategy game — the nose points RIGHT, engine nozzles at the LEFT end, long axis perfectly horizontal, zero perspective. The EXACT SAME spacecraft at IDENTICAL size and IDENTICAL centered position in all six cells; ONLY the engine flames and weapon flashes differ between cells, the hull never changes.

THE SHIP — a spacefaring vessel, NOT a sea boat: no keel, no rudder, no sails, a spacecraft hull with engine nozzles at the stern and any weapons visible on the dorsal deck. Design: {design}

{accent}

Row 1: [1] engines idle — dim cool engine glow, weapons cold. [2] engines at FULL BURN — bright thick flame plumes attached to the engine nozzles. [3] engines at FULL BURN, alternate flicker — the same flame plumes slightly shorter and brighter at the core.
Row 2: [4] FIRING LASERS — short bright cyan-blue muzzle flashes at the gun tips, flashes touching the guns, NO long beams. [5] FIRING CANNONS — orange-yellow muzzle blasts with tiny smoke puffs touching the cannon barrels. [6] FIRING MISSILES — two small missiles with short bright exhaust trails just leaving their rails, still overlapping the hull."""

PLAYER_LINE_BEAUTY_STYLE = """Four dramatic glamour views of ONE single stylized 3D spacecraft in soft matte clay-render style, chunky rounded proportions, hand-painted feel, soft saturated colors, one soft key light from the upper left, gentle per-element ambient occlusion, cozy miniature diorama feel — a shipyard showroom presentation. Arranged in a 2x2 grid separated by thin solid black lines, one view per cell, the ship filling most of each cell, generous PURE BLACK margin, pure black background — no stars, no planet, no ground, no cast shadow, absolutely NO text, NO labels, NO numbers, NO borders.

THE SHIP — the EXACT SAME spacecraft in all four cells, identical design and materials. Design: {design}

ABSOLUTE RULE — THIS IS A SPACECRAFT FLOATING IN EMPTY SPACE, NEVER A NAUTICAL VESSEL: no boat hull, no keel, no waterline, no upswept bow, no open deck, no deck railings, no smokestack funnels, no masts, no rudder, no sails, no anchor. The hull is fully enclosed and plated on every side including the underside, with engine nozzles at the stern. If it could float on water, it is WRONG.

{accent}

Row 1: [1] FRONT THREE-QUARTER — dramatic perspective view from the front-left, showing bow and flank. [2] SIDE PROFILE — full broadside side view, nose pointing right, every deck detail visible.
Row 2: [3] HERO SHOT — dramatic low three-quarter angle from the front, the ship looming overhead with engine glow. [4] REAR QUARTER — view from behind, all engines glowing bright."""

PLAYER_LINE_ACCENTS = {
    "hauler": "Fleet style: INDEPENDENT TRADE GUILD / bounty-hunter freighter — a lived-in working ship with the soul of a smuggler: warm teal-and-cream painted plating gone sun-faded, rust-orange accent stripes, mismatched welded patch panels over old damage, brass steampunk pipework and pressure gauges, exposed cabling, warm amber cockpit and cabin lights, a cargo clamp and tow rig up front. Scruffy, beloved, clearly modified by its owner — not military, never factory-clean. THIS FLEET STYLE OVERRIDES any other material or color: render ALL materials, colors and lighting in this style.",
    "krag": "Fleet style: KRAG industrial steampunk navy — riveted rust-iron slab armor, brass pipes and pressure tanks, exposed gearwork, steam vents, smokestack-style engine funnels, warm amber engine glow and amber running lights, chunky brutal silhouette with a heavy reinforced ram prow. THIS FLEET STYLE OVERRIDES any other material or color: render ALL materials, colors and lighting in this style.",
    "vex":  "Fleet style: VEX military-order steampunk — smooth black basalt and chrome armor with polished brass trim rails, riveted armor seams, sharp knife-edge symmetry, thin glowing red tactical light lines, cold white floodlights, red engine glow — a ruthless precision war machine with a Victorian ironclad edge. THIS FLEET STYLE OVERRIDES any other material or color: render ALL materials, colors and lighting in this style.",
    "nox":  "Fleet style: NOX ancient crystalline steampunk — grown dark iridescent crystal hull with curved organic lines, brass Victorian ribbing and porthole rings like a deep-sea nautilus submarine, bioluminescent teal and violet glow from within, violet engine glow — beautiful, alien, unsettling. THIS FLEET STYLE OVERRIDES any other material or color: render ALL materials, colors and lighting in this style.",
}

# key → (faction, ship design line). Keys ARE the CONFIG.hulls keys.
PLAYER_LINE_SHIPS = {
    # hauler line — the starter progression, re-cut in the faction-line format
    # (trade-guild smuggler/bounty-hunter look; supersedes the old `fleet ships` art)
    "vulture": ("hauler", "a small scrappy SALVAGE HAULER — stubby enclosed boxy spacecraft hull with a heavy tow claw and cargo clamp at the bow, one oversized patched engine slung off the back, an off-center bubble cockpit pod on the right side, mismatched welded hull patches, a single small gun on a dorsal pintle mount. The lovable underdog of the fleet."),
    "atlas":   ("hauler", "a mid-size CARGO FREIGHTER spacecraft — a fully enclosed tubular main fuselage (never an open cargo deck) with two sealed cylindrical cargo pods clamped to its left and right flanks, twin engine nozzles at the stern, an off-center bubble cockpit pod on the right side, a small dorsal turret, brass pipework and pressure tanks bolted along the fuselage, a tow rig at the blunt nose. A working trader that has been everywhere twice."),
    "aegis":   ("hauler", "an armed ESCORT HAULER — the bounty-hunter's ship: armored freighter hull with a reinforced prow, dorsal and ventral gun turrets, missile rack on one flank, three engines in a cluster, an off-center cockpit pod on the right side, one cargo container still clamped amidships. Fast, dangerous, and clearly modified far past legal spec."),
    "krag_ironclad":    ("krag", "a compact IRONCLAD battlecruiser — chunky slab-sided hull, heavy toothed ram prow, two side gun turrets, twin riveted engine funnels."),
    "krag_warbarge":    ("krag", "a heavy WARBARGE battlecruiser — broad layered armor decks, massive ram prow, four side gun pods, triple engine funnels, salvage crane masts."),
    "krag_dreadnought": ("krag", "a colossal DREADNOUGHT battlecruiser — fortress-like stacked armor citadel, enormous toothed ram prow, gun turrets bristling down both flanks, four huge engine funnels."),
    "vex_lance":        ("vex", "a slim LANCE destroyer — narrow knife-blade hull, one long spinal railgun, two swept armor fins, twin engines."),
    "vex_saber":        ("vex", "a heavy SABER destroyer — angular arrowhead hull, twin spinal cannons, four gun pods, swept wing pylons, triple engines."),
    "vex_executor":     ("vex", "a massive EXECUTOR war destroyer — long bladed capital hull, one enormous spinal siege cannon, tiered gun decks down the spine, six engines in two banks."),
    "nox_veil":         ("nox", "a VEIL escort carrier — curved crystal manta hull with one glowing flight-deck slot down the center, two drone launch bays, trailing fin tendrils."),
    "nox_umbra":        ("nox", "an UMBRA fleet carrier — broad manta-ray crystal hull, twin glowing flight decks, four drone launch bays along the flanks, long tail spines."),
    "nox_eclipse":      ("nox", "an ECLIPSE supercarrier — immense cathedral-like crystal hull, full-length glowing central flight deck with hangar mouths, six drone bays along the flanks, a crown of crystal spires."),
}

# per-sheet cell suffixes (installed as ship_<key><suffix>.png)
PLAYER_LINE_JOBS = {
    "flight": dict(style_attr="PLAYER_LINE_FLIGHT_STYLE", cols=3, rows=2, max_dim=420,
                   cells=["", "_thrust", "_thrust_b", "_fire_laser", "_fire_cannon", "_fire_missile"]),
    "beauty": dict(style_attr="PLAYER_LINE_BEAUTY_STYLE", cols=2, rows=2, max_dim=640,
                   cells=["_beauty_front", "_beauty", "_hero", "_beauty_rear"]),
}

def _keep_components(fg, min_px=250):
    """Drop foreground blobs smaller than min_px (stray noise / stray caption
    letters) but KEEP every substantial blob — unlike largest_component, which
    would eat the detached missiles/muzzle puffs in the firing frames."""
    from collections import deque
    h, w = fg.shape
    seen = np.zeros_like(fg)
    out = np.zeros_like(fg)
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
                if len(comp) >= min_px:
                    ys, xs = zip(*comp)
                    out[list(ys), list(xs)] = True
    return out


def cut_out_registered(cells, pad=3, max_dim=420, dark_max=34):
    """Animation-frame cutter: every cell is cropped to the UNION bbox of all
    cells' foreground, so the hull stays pixel-registered across frames — a
    per-cell tight crop would make the ship jump when the game swaps frames.
    Returns a list of RGBA sprites (None where a cell had no foreground)."""
    arrs = [np.asarray(c, dtype=np.float32) for c in cells]
    masks = []
    for arr in arrs:
        bg = flood_bg(arr, dark_max=dark_max)
        fg = ~bg
        n = np.zeros(fg.shape, dtype=np.int16)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    n += np.roll(np.roll(fg, dy, axis=0), dx, axis=1)
        fg &= n > 2
        masks.append(_keep_components(fg))
    boxes = [(ys.min(), ys.max(), xs.min(), xs.max())
             for m in masks for ys, xs in [np.where(m)] if len(ys)]
    if not boxes:
        return [None] * len(cells)
    y0 = max(0, min(b[0] for b in boxes) - pad)
    y1 = min(masks[0].shape[0], max(b[1] for b in boxes) + pad + 1)
    x0 = max(0, min(b[2] for b in boxes) - pad)
    x1 = min(masks[0].shape[1], max(b[3] for b in boxes) + pad + 1)
    scale = min(1.0, max_dim / max(x1 - x0, y1 - y0))
    out = []
    for arr, m in zip(arrs, masks):
        if not m.any():
            out.append(None)
            continue
        alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))
        rgba = np.dstack([arr.astype(np.uint8), np.asarray(alpha)])[y0:y1, x0:x1]
        spr = Image.fromarray(rgba)
        if scale < 1.0:
            spr = spr.resize((round(spr.width * scale), round(spr.height * scale)), Image.LANCZOS)
        out.append(spr)
    return out


def run_playerlines(only=None, job_only=None, from_sheet=None, dark_max=34):
    if only and only not in PLAYER_LINE_SHIPS:
        sys.exit(f"unknown ship '{only}' — one of: {', '.join(PLAYER_LINE_SHIPS)}")
    if job_only and job_only not in PLAYER_LINE_JOBS:
        sys.exit(f"unknown job '{job_only}' — one of: {', '.join(PLAYER_LINE_JOBS)}")
    out_dir = HERE / "space"
    out_dir.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    styles = {"PLAYER_LINE_FLIGHT_STYLE": PLAYER_LINE_FLIGHT_STYLE,
              "PLAYER_LINE_BEAUTY_STYLE": PLAYER_LINE_BEAUTY_STYLE}
    for key, (faction, design) in PLAYER_LINE_SHIPS.items():
        if only and key != only:
            continue
        for job, spec in PLAYER_LINE_JOBS.items():
            if job_only and job != job_only:
                continue
            if from_sheet:
                sheet = Image.open(from_sheet).convert("RGB")
                print(f"reprocessing player line '{key}' {job} from {from_sheet}…")
            else:
                print(f"generating player line '{key}' {job} sheet…")
                sheet = generate(styles[spec["style_attr"]].format(
                    design=design, accent=PLAYER_LINE_ACCENTS[faction]))
                sheet.save(DEBUG / f"playerline_{key}_{job}_sheet.png")
            print(f"  sheet {sheet.size[0]}x{sheet.size[1]}")
            cells = list(grid_cells(sheet, spec["cols"], spec["rows"], inset=4))
            if job == "flight":   # frame-registered union crop (no hull jitter on swap)
                sprs = cut_out_registered(cells, max_dim=spec["max_dim"], dark_max=dark_max)
            else:                 # showroom shots — per-cell tight crop is what we want
                sprs = [cut_out(c, max_dim=spec["max_dim"], dark_max=dark_max) for c in cells]
            for suffix, spr in zip(spec["cells"], sprs):
                if spr is None:
                    print(f"  !! ship_{key}{suffix}: nothing found in cell — regenerate this sheet")
                    continue
                fname = f"ship_{key}{suffix}.png"
                spr.save(out_dir / fname)
                print(f"  {fname}  {spr.size[0]}x{spr.size[1]}  "
                      f"({(out_dir/fname).stat().st_size:,} B)")
    print("\nINTEGRATION — player faction lines:")
    print("  1. src/game/sprites.js: register ship_<key> flight frames in SPACE_CLAY_KEYS")
    print("     + ship_<key>_beauty/_hero in STORY_KEYS (ships market carousel)")
    print("  2. rendering.js frame swap (thrust/fire) + ships.js carousel")
    print("  3. python3 build.py --check")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    if cmd in ("tiles", "all"):
        # optional 3rd arg: re-cut a saved sheet (no API call), e.g.
        #   pipeline.py tiles mira sprites/mira/_debug/tiles_mira_sheet.png
        # optional 4th arg 'strip': crop baked caption text off the bottom of
        # each cell during the re-cut (~22% band)
        run_tiles(planet=arg or "mira",
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None,
                  strip_bottom=0.22 if len(sys.argv) > 4 and sys.argv[4] == "strip" else 0.0)
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
    if cmd == "space":
        # pipeline.py space <civ> [ships|stations] [saved_sheet] [dark_max]
        run_space(arg or "vex",
                  only=(sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] in ("ships", "stations") else None),
                  from_sheet=sys.argv[4] if len(sys.argv) > 4 else None,
                  dark_max=int(sys.argv[5]) if len(sys.argv) > 5 else 34)
    if cmd == "fleet":
        # pipeline.py fleet [ships|drones] [saved_sheet] [dark_max]
        run_fleet(only=(arg if arg in ("ships", "drones") else None),
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None,
                  dark_max=int(sys.argv[4]) if len(sys.argv) > 4 else 34)
    if cmd == "playerlines":
        # pipeline.py playerlines [ship_key] [flight|beauty] [saved_sheet] [dark_max]
        run_playerlines(only=arg,
                        job_only=(sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] in ("flight", "beauty") else None),
                        from_sheet=sys.argv[4] if len(sys.argv) > 4 else None,
                        dark_max=int(sys.argv[5]) if len(sys.argv) > 5 else 34)
    if cmd == "world":
        # pipeline.py world [junk|asteroids|planets_a..planets_e|moons] [saved_sheet] [dark_max]
        if arg and arg not in WORLD_SHEETS:
            sys.exit(f"unknown world sheet '{arg}' — one of: {', '.join(WORLD_SHEETS)}")
        run_world(only=(arg if arg in WORLD_SHEETS else None),
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None,
                  dark_max=int(sys.argv[4]) if len(sys.argv) > 4 else 34)
    if cmd == "sites":
        # pipeline.py sites [asteroid_cluster|shipwreck|alien_station_a|alien_station_b] [saved_sheet] [dark_max]
        if arg and arg not in SITE_SHEETS:
            sys.exit(f"unknown site sheet '{arg}' — one of: {', '.join(SITE_SHEETS)}")
        run_sites(only=arg,
                  from_sheet=sys.argv[3] if len(sys.argv) > 3 else None,
                  dark_max=int(sys.argv[4]) if len(sys.argv) > 4 else 34)
    if cmd in ("buildings", "all"):
        # optional 3rd arg: planet building set (faction-accented, namespaced
        # keys), e.g. `buildings city vesper`. Optional 4th arg: re-cut a
        # saved sheet (no API call), e.g. `buildings landmarks '' <sheet.png>`
        run_buildings(only=arg,
                      set_name=(sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None),
                      from_sheet=sys.argv[4] if len(sys.argv) > 4 else None)
