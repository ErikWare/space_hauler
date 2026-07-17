#!/usr/bin/env python3
"""Batch-generate all Space Hauler sprites via the xAI grok-imagine-image API.

Every prompt gets the shared STYLE anchor appended for a consistent look.
Resumable: files that already exist (>10 KB) are skipped, so a re-run only
fills in whatever failed last time.
"""
import time
import pathlib
from gen import generate

STYLE = "space hauler game art, dark space background, vibrant color, clean digital illustration style"

HERE = pathlib.Path(__file__).parent

# (filename, prompt) — STYLE is appended to each at generation time.
SPRITES = [
    # ---- SHIPS (top-down, square composition) ----
    ("vulture_tug.png", "top-down view of a small battered asymmetric cargo hauler spaceship, salvage hooks, dented hull, rust and scorch marks, dark space background, game art"),
    ("atlas_freighter.png", "top-down view of a wide industrial mid-tier freighter spaceship with cargo pods on sides, solid and dependable, dark space, game art"),
    ("aegis_battlecruiser.png", "top-down view of a sleek heavily-armed battlecruiser spaceship, imposing silhouette, glowing weapon ports, dark space, game art"),
    ("vex_fighter.png", "top-down view of an angular crystalline alien fighter ship, geometric facets, blue-white energy glow, dark space, game art"),
    ("krag_raider.png", "top-down view of a brutal bulky spiked alien raider ship, jury-rigged armor plates, orange-red energy, dark space, game art"),
    ("nox_phantom.png", "top-down view of a translucent void-cloaked alien phantom ship, shadowy ethereal, purple-black energy tendrils, dark space, game art"),
    ("companion_drone.png", "top-down view of a small utility drone spaceship, sleek compact, teal glow, dark space, game art"),

    # ---- STORY CHARACTERS (portrait, head and shoulders) ----
    ("commander_portrait.png", "portrait of a weathered space hauler captain, gruff scarred face, worn flight suit, helmet under arm, space station background, cinematic lighting, game art"),
    ("vex_leader.png", "portrait of a sleek technocratic alien faction leader, angular features, blue bioluminescent markings, cold intelligent eyes, game art"),
    ("krag_leader.png", "portrait of a brutal warlord alien faction leader, heavily scarred, bone armor, fierce orange eyes, intimidating, game art"),
    ("nox_leader.png", "portrait of a mysterious void-cloaked alien faction leader, partially translucent face, purple energy eyes, enigmatic smile, game art"),
    ("station_commander.png", "portrait of a friendly station commander NPC, warm face, worn uniform with rank pins, space station interior background, game art"),

    # ---- STORY SCENES (widescreen cinematic) ----
    ("opening_scene.png", "cinematic widescreen space scene: lone battered cargo ship drifting through a dense asteroid field, distant stars, solitary and atmospheric, game art"),
    ("first_contact.png", "cinematic widescreen space scene: a small cargo ship facing a wall of sleek alien warships blocking its path, tense standoff, blue faction fleet, game art"),
    ("outpost_siege.png", "cinematic widescreen space scene: a player ship attacking an enemy space outpost, laser beams firing, explosions, dramatic action, game art"),
    ("faction_warning.png", "cinematic widescreen: alien warlord's face on a ship viewscreen, threatening posture, warning the player to leave their territory, dramatic, game art"),
    ("victory_scene.png", "cinematic widescreen space scene: a fleet of ships in formation before a conquered solar system, triumphant atmosphere, epic scale, empire established, game art"),

    # ---- WORLD OBJECTS ----
    ("station_vex.png", "space station exterior, crystalline geometric architecture, blue energy conduits, Vex faction aesthetic, floating in space, game art"),
    ("station_krag.png", "space station exterior, industrial brutal architecture, orange-lit, weapon emplacements, Krag warlord faction, floating in space, game art"),
    ("station_nox.png", "space station exterior, dark shadowy architecture, purple void energy, partially cloaked, Nox phantom faction, floating in space, game art"),
    ("outpost_player.png", "small space outpost, teal glow, player-owned fortification, turrets visible, dark space, game art"),
    ("outpost_enemy.png", "small enemy space outpost, red warning lights, gun turrets, imposing, dark space, game art"),
    ("asteroid_ore.png", "large irregular space asteroid with visible mineral veins, silver and gold ore deposits, floating in space, game art"),
    ("warp_gate.png", "space warp gate, glowing ring portal, energy field shimmering, dark space background, game art"),
    ("nebula_blue.png", "beautiful blue space nebula cloud, swirling gas and stars, ambient space environment, game art"),
    ("nebula_red.png", "dramatic red space nebula, warning atmosphere, swirling gas and stars, game art"),
    ("nebula_green.png", "mysterious green space nebula, alien atmosphere, swirling gas and stars, game art"),

    # ---- UI / ICONS (clean, clear, small) ----
    ("icon_vex.png", "faction logo icon, Vex faction, crystalline geometric hexagon symbol, blue, clean vector style on dark background"),
    ("icon_krag.png", "faction logo icon, Krag faction, brutal skull-and-spike symbol, orange, clean vector style on dark background"),
    ("icon_nox.png", "faction logo icon, Nox faction, void eye symbol, purple, clean vector style on dark background"),
    ("icon_victory.png", "victory achievement badge icon, golden empire crest, stars and laurels, game art"),
]


def main():
    total = len(SPRITES)
    ok, skipped, failed = [], [], []
    for i, (fname, prompt) in enumerate(SPRITES, 1):
        out = HERE / fname
        if out.exists() and out.stat().st_size > 10_000:
            print(f"[{i}/{total}] ⏭  skip {fname} (already exists, {out.stat().st_size} bytes)")
            skipped.append(fname)
            continue
        full_prompt = f"{prompt}, {STYLE}"
        print(f"[{i}/{total}] 🎨 {fname}")
        success = generate(full_prompt, str(out))
        (ok if success else failed).append(fname)
        if i < total:
            time.sleep(2)  # rate-limit courtesy delay

    print("\n" + "=" * 50)
    print("BATCH COMPLETE")
    print(f"  generated: {len(ok)}")
    print(f"  skipped (already existed): {len(skipped)}")
    print(f"  failed: {len(failed)}")
    if failed:
        print("  FAILED FILES:", ", ".join(failed))
    print("=" * 50)


if __name__ == "__main__":
    main()
