#!/usr/bin/env python3
"""
Assemble mobile/www/ — the web root Capacitor packages into the iOS app.

    python3 build.py && python3 scripts/build_mobile.py

Re-run after every build.py: mobile/www/index.html is a COPY of game.html, not a
link, so it goes stale otherwise. (`npm run bundle` does both.)

WHY WE COPY THE WHOLE sprites/ TREE
-----------------------------------
An earlier version of this script regex-scraped "sprites/....png" literals out of
game.html and copied only those. That silently shipped a broken app: most of
ART_MANIFEST is assembled at RUNTIME from template strings —

    ART_MANIFEST[k] = `sprites/${set}/${k}.png`            (game/sprites.js)
    src: "sprites/player_portraits/" + p.id + ".png"       (game/player_portraits.js)

— so a static scrape found ~197 of the ~940 real assets and every pilot portrait
rendered as a broken-image icon in the simulator. There is no reliable static
list, so we copy everything and exclude only what is provably not game art.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game.html")
SPRITES = os.path.join(ROOT, "sprites")
WWW = os.path.join(ROOT, "mobile", "www")

# Directory names excluded anywhere in the tree. _debug holds QA contact sheets
# (58MB of them under sprites/mira) that the game never loads.
EXCLUDE_DIRS = {"_debug"}
ASSET_EXT = (".png", ".jpg", ".jpeg", ".webp")


def main():
    if not os.path.isfile(GAME):
        sys.exit("game.html not found — run `python3 build.py` first")
    if not os.path.isdir(SPRITES):
        sys.exit("sprites/ not found")

    # rebuild from scratch so deleted assets don't linger in the bundle
    if os.path.isdir(WWW):
        shutil.rmtree(WWW)
    os.makedirs(WWW)

    # Capacitor serves index.html as the entry point; game.html would 404.
    shutil.copy2(GAME, os.path.join(WWW, "index.html"))

    copied = skipped = total = 0
    for dirpath, dirnames, filenames in os.walk(SPRITES):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            src = os.path.join(dirpath, fn)
            if not fn.lower().endswith(ASSET_EXT):
                skipped += 1
                continue
            dst = os.path.join(WWW, os.path.relpath(src, ROOT))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            total += os.path.getsize(src)
            copied += 1

    idx = os.path.getsize(os.path.join(WWW, "index.html"))
    print("mobile/www: index.html (%.1f MB) + %d assets (%.0f MB) — %.0f MB total"
          % (idx / 1048576, copied, total / 1048576, (idx + total) / 1048576))
    if skipped:
        print("  skipped %d non-image files" % skipped)


if __name__ == "__main__":
    main()
