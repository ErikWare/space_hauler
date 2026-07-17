#!/usr/bin/env python3
"""Generate Earth-like planet surface sprites via xAI grok-imagine-image.

Run from the sprites/ directory:
    python3 planet_gen.py

All sprites are isometric 2.5D cartoon style — cute, warm, cozy farm-game aesthetic.
Background removal is done by planet_remove_bg.py after generation.
"""
import time
import pathlib
from gen import generate

HERE = pathlib.Path(__file__).parent

STYLE = (
    "isometric 2.5D cartoon game sprite, cute and friendly cozy farm aesthetic, "
    "thick dark outlines, warm earthy colors, centered on pure black background, "
    "viewed from 45-degree angle slightly above, clean illustration style, "
    "vibrant but soft palette, no text no UI"
)

SPRITES = [
    # Vegetation
    ("planet_tree.png",
     "a single cute oak tree with a fluffy round green canopy in 3 shades, "
     "short brown trunk, grass shadows underneath, charming cozy style"),

    ("planet_bush.png",
     "a small round cute green bush, puffy organic shape, 2-3 leafy clumps, "
     "bright green, tiny shadow underneath, cheerful"),

    ("planet_pine.png",
     "a cute pine/fir tree, triangular green silhouette with layered branches, "
     "narrow pointed top, short brown trunk, cozy forest feel"),

    # Terrain features
    ("planet_rock.png",
     "a cluster of 3 smooth rounded boulders, grey with warm highlights, "
     "mossy patches of green, cozy earthy feel"),

    ("planet_mountain.png",
     "a cute small mountain peak with snow cap, rocky grey sides, "
     "warm stone colors, cozy nature aesthetic, compact composition"),

    # Buildings
    ("planet_barn.png",
     "a cute red wooden barn with white trim, hay loft window with an X shape, "
     "wide double doors, thatched or orange roof, warm farm feel"),

    ("planet_market.png",
     "a cute small market stall building, colorful striped yellow-and-white awning, "
     "wooden sign, shelves with colorful goods visible, cozy village shop"),

    ("planet_house.png",
     "a cute cozy cottage with orange tile roof, white plaster walls, "
     "round window, flower boxes under windows, chimney with smoke puff, warm home"),

    ("planet_windmill.png",
     "a cute Dutch-style windmill with large spinning sails/blades, "
     "round white stone tower with red cap, cozy countryside feel"),

    ("planet_well.png",
     "a cute stone well with a wooden roof canopy and rope and bucket, "
     "mossy stones, cozy village aesthetic, compact"),

    # Launch pad & rocket
    ("planet_launchpad.png",
     "a cute isometric rocket launch pad base, concrete slab with painted markings "
     "and small guide lights around the edge, flat industrial platform"),

    ("planet_rocket.png",
     "a cute cartoon rocket ship sitting upright on a launch pad, "
     "white body with red nose cone and red swept fins, "
     "round porthole window, small exhaust nozzle at bottom, charming space-farm aesthetic"),

    # Characters
    ("planet_player.png",
     "a cute small space captain character in an orange flight suit and round helmet, "
     "waving or walking pose, big friendly eyes visible through visor, "
     "backpack, boots, compact sprite"),

    ("planet_farmer.png",
     "a cute small farmer NPC character in blue denim overalls and straw hat, "
     "friendly round face, holding a rake or pitchfork, compact sprite, warm style"),

    ("planet_merchant.png",
     "a cute small shopkeeper NPC character in an apron and cap, "
     "carrying a basket of goods, round cheerful face, compact sprite"),

    # Environment details
    ("planet_flower_patch.png",
     "a small patch of colorful wildflowers, pink yellow and white blooms, "
     "green stems and leaves, cute garden aesthetic, top cluster of blooms visible"),

    ("planet_crop_row.png",
     "a row of growing crops, green leafy vegetable plants in a neat garden row, "
     "rich brown soil visible, bright healthy green leaves, cozy farm aesthetic"),

    ("planet_fence.png",
     "a section of cute wooden picket fence, white painted wooden posts and rails, "
     "slightly weathered, warm wood tones, cozy farm boundary"),
]


def main():
    total = len(SPRITES)
    ok, skipped, failed = [], [], []

    for i, (fname, prompt) in enumerate(SPRITES, 1):
        out = HERE / fname
        if out.exists() and out.stat().st_size > 10_000:
            print(f"[{i}/{total}] ⏭  skip {fname} (exists, {out.stat().st_size:,} bytes)")
            skipped.append(fname)
            continue

        full_prompt = f"{prompt}, {STYLE}"
        print(f"[{i}/{total}] 🎨 Generating {fname}…")
        print(f"        prompt: {full_prompt[:120]}…")
        success = generate(full_prompt, str(out))
        (ok if success else failed).append(fname)
        if i < total:
            time.sleep(3)  # courtesy rate-limit delay

    print("\n" + "=" * 60)
    print("PLANET SPRITES BATCH COMPLETE")
    print(f"  ✅ generated : {len(ok)}")
    print(f"  ⏭  skipped   : {len(skipped)}")
    print(f"  ❌ failed    : {len(failed)}")
    if failed:
        print("  FAILED:", ", ".join(failed))
    print("=" * 60)
    if ok:
        print("\nNext step: run  python3 planet_remove_bg.py  to strip black backgrounds")


if __name__ == "__main__":
    main()
