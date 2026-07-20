#!/usr/bin/env python3
"""Generate graphic-novel panels with a locked character description.

The whole point: the character lock string and the style block are pasted
BYTE-IDENTICAL into every prompt, and only the scene block varies. See
grok-character-template.md for the measurements behind that rule.

    # generate a manifest asset (portrait / background / splash) by key —
    # lock + scene + faction + aspect all come from ../assets/manifest.json;
    # candidates land in ../assets/generated/<key>_NN.png
    python3 generate.py --key krag_voss_angry --n 3

    # validate a new character (3 identical + 1 off-scene)
    python3 generate.py --lock ../character-bible/krag-protagonist.md --validate

    # generate panel candidates from a bible + free scene text
    python3 generate.py --lock ../character-bible/krag-protagonist.md \
        --scene "Medium shot, standing on a station gantry, looking down at the docks." \
        --n 3 --out ../krag/panels --name krag_a1_04

The bible lock string is read from the fenced code block under the
"## 6. Prompt Lock String" heading of the bible file; manifest entries carry
their lock inline (or inherit a base character's via lock_from).
"""
import argparse, asyncio, base64, json, pathlib, re, sys
import aiohttp

MANIFEST = pathlib.Path(__file__).resolve().parent.parent / "assets" / "manifest.json"
GENERATED = pathlib.Path(__file__).resolve().parent.parent / "assets" / "generated"

API   = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"

# Identical for every panel in the project. Swap only the palette clause per
# faction; change nothing else. Negatives live here in prose because the
# `negative_prompt` API argument does not work.
STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of {palette}, dramatic single key light. Painterly sci-fi "
    "comic panel. No text, no speech bubbles, no captions, no lettering, no borders, "
    "no panel gutters."
)
PALETTES = {   # MARA_PLANET_LORE_SPEC.md:16-39
    "krag": "rust orange, soot charcoal and pale amber",
    "vex":  "crimson red, deep navy and gunmetal slate",
    "nox":  "deep violet, dark cyan and cold black",
}

# `size` is not a supported API argument — aspect ratio has to be steered in the
# prompt text. This phrasing produced 864x1152 on 3 of 3 attempts.
ASPECTS = {
    "tall":   "Vertical portrait composition, tall 3:4 aspect ratio, subject centred.",
    "wide":   "Wide cinematic composition, 16:9 landscape aspect ratio.",
    "square": "Square 1:1 composition, subject centred.",
}

VALIDATE_SCENES = [
    ("portrait_1", "Chest-up portrait, facing the viewer three-quarters, neutral expression, plain dark industrial bulkhead background."),
    ("portrait_2", "Chest-up portrait, facing the viewer three-quarters, neutral expression, plain dark industrial bulkhead background."),
    ("portrait_3", "Chest-up portrait, facing the viewer three-quarters, neutral expression, plain dark industrial bulkhead background."),
    ("offscene",   "Medium shot, seated at a cluttered mess-hall table cradling a dented metal cup, shoulders slumped, weary half-smile, warm lamp light from above."),
]


def token():
    """JWT lives in ~/.grok/auth.json under a namespaced key, under 'key'
    (NOT 'token'/'access_token'). ~6h expiry — re-run `grok login` on 403."""
    p = pathlib.Path.home() / ".grok" / "auth.json"
    if not p.exists():
        sys.exit("no ~/.grok/auth.json — run `grok login`")
    first = list(json.loads(p.read_text()).values())[0]
    return first.get("token") or first["key"]


def read_lock(bible_path):
    """Pull the fenced lock string out of section 6 of a character bible."""
    text = pathlib.Path(bible_path).read_text()
    m = re.search(r"##\s*6\.[^\n]*\n(.*?)(?=\n##\s|\Z)", text, re.S)
    if not m:
        sys.exit(f"{bible_path}: no '## 6. Prompt Lock String' section")
    blocks = re.findall(r"```[a-z]*\n(.*?)```", m.group(1), re.S)
    for b in blocks:
        b = b.strip()
        if b and not b.startswith("<PASTE"):
            return b
    sys.exit(f"{bible_path}: section 6 has no filled lock string (still the template placeholder?)")


def compose(lock, scene, faction, aspect):
    palette = PALETTES.get(faction, PALETTES["krag"])
    blocks = [lock, scene, ASPECTS[aspect], STYLE.format(palette=palette)]
    return "\n\n".join(b for b in blocks if b)   # backgrounds/splashes have no lock


def manifest_entry(key):
    """Find a key in the manifest (portraits/backgrounds/splashes) and resolve
    it to (lock, scene, faction, aspect). Portrait variants inherit their base
    character's lock via lock_from; backgrounds/splashes are scene-only."""
    if not MANIFEST.exists():
        sys.exit(f"no manifest at {MANIFEST}")
    man = json.loads(MANIFEST.read_text())
    section = entry = None
    for sec in ("portraits", "backgrounds", "splashes"):
        entries = man.get(sec, {})
        if isinstance(entries, dict) and key in entries:
            section, entry = sec, entries[key]
            break
    if entry is None:
        sys.exit(f"{key}: not in manifest (checked portraits/backgrounds/splashes)")
    if entry.get("status") == "planned":
        sys.exit(f"{key}: status is 'planned' — write its scene prompt in the manifest first")
    scene = entry.get("scene")
    if not scene:
        sys.exit(f"{key}: manifest entry has no scene prompt")
    lock = entry.get("lock")
    src  = entry.get("lock_from")
    hops = 0
    while not lock and src and hops < 5:   # follow lock_from to the base character
        base = man.get("portraits", {}).get(src)
        if not base:
            sys.exit(f"{key}: lock_from -> {src} not in portraits")
        lock, src, hops = base.get("lock"), base.get("lock_from"), hops + 1
    if section == "portraits" and not lock:
        sys.exit(f"{key}: portrait with no lock (and no lock_from chain) — see grok-character-template.md")
    faction = entry.get("faction", "krag")
    aspect  = entry.get("aspect", "tall" if section == "portraits" else "wide")
    return lock, scene, faction, aspect


async def async_generate(session, prompt, tok, sem, tries=3):
    """Fetch one image. 429 → sleep 30 s and retry (up to `tries` times total).
    Exported for use by batch_generate.py."""
    async with sem:
        for attempt in range(tries):
            try:
                async with session.post(
                    API,
                    headers={"Authorization": f"Bearer {tok}"},
                    json={"model": MODEL, "prompt": prompt,
                          "response_format": "b64_json", "n": 1},
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as r:
                    if r.status == 200:
                        data = await r.json()
                        return base64.b64decode(data["data"][0]["b64_json"])
                    text = await r.text()
                    if r.status == 429:
                        print(f"    429 rate-limit — sleeping 30s "
                              f"(attempt {attempt+1}/{tries})", file=sys.stderr)
                        await asyncio.sleep(30)
                        continue
                    if r.status in (401, 403) and "unauthenticated" in text:
                        sys.exit("token expired (403 unauthenticated) — run `grok login`")
                    if r.status == 403 and "spending-limit" in text:
                        sys.exit("xAI account out of credits — add credits at grok.com/?_s=usage")
                    print(f"    attempt {attempt+1}: HTTP {r.status} {text[:160]}",
                          file=sys.stderr)
            except asyncio.TimeoutError:
                print(f"    attempt {attempt+1}: request timed out", file=sys.stderr)
        return None


async def _amain(a, lock, jobs, out):
    """Async core — runs all jobs concurrently (≤ 3 in flight at once)."""
    if a.dry_run:
        print(compose(lock, jobs[0][1], a.faction, a.aspect))
        return

    tok = token()
    sem = asyncio.Semaphore(3)
    manifest = []

    async def do_job(i, stem, scene):
        prompt = compose(lock, scene, a.faction, a.aspect)
        fname = f"{stem}.png" if a.validate else f"{a.name}_{i:02d}.png"
        print(f"[{i}/{len(jobs)}] {fname}")
        if (out / fname).exists():
            print(f"    -> exists, skipping")
            return
        async with aiohttp.ClientSession() as session:
            raw = await async_generate(session, prompt, tok, sem)
        if raw is None:
            print(f"    FAILED", file=sys.stderr)
            return
        (out / fname).write_bytes(raw)
        print(f"    -> {out/fname} ({len(raw)//1024}KB)")
        manifest.append({"file": fname, "scene": scene,
                         "lock_chars": len(lock) if lock else 0})

    await asyncio.gather(*[
        do_job(i, stem, scene) for i, (stem, scene) in enumerate(jobs, 1)
    ])

    (out / f"_{a.name}_manifest.json").write_text(json.dumps({
        "bible":   str(a.lock) if a.lock else None,
        "key":     a.key or None,
        "faction": a.faction,
        "aspect":  a.aspect,
        "style":   STYLE.format(palette=PALETTES[a.faction]),
        "images":  manifest,
    }, indent=2))
    if a.validate:
        print("\nNow LOOK at all four. Same person? If not, fix the lock string, not the scene.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--key",      help="manifest key (../assets/manifest.json) — pulls lock/scene/faction/aspect")
    ap.add_argument("--lock",     help="path to a character bible .md")
    ap.add_argument("--scene",    help="the scene/shot/pose block")
    ap.add_argument("--validate", action="store_true",
                    help="run the 3-identical + 1-off-scene consistency check instead")
    ap.add_argument("--faction",  default=None, choices=sorted(PALETTES))
    ap.add_argument("--aspect",   default=None, choices=sorted(ASPECTS))
    ap.add_argument("--n",        type=int, default=3,
                    help="candidates per scene (no seed exists, so pick by hand)")
    ap.add_argument("--out",      default=None, help="output directory")
    ap.add_argument("--name",     default=None, help="filename stem")
    ap.add_argument("--dry-run",  action="store_true",
                    help="print the composed prompt and exit")
    a = ap.parse_args()

    if a.key:   # manifest mode: the entry is the whole spec; flags only override
        lock, scene, faction, aspect = manifest_entry(a.key)
        a.scene   = a.scene   or scene
        a.faction = a.faction or faction
        a.aspect  = a.aspect  or aspect
        a.name    = a.name    or a.key
        a.out     = a.out     or str(GENERATED)
    elif a.lock:
        if not a.validate and not a.scene:
            ap.error("need --scene, or --validate")
        lock = read_lock(a.lock)
    else:
        ap.error("need --key (manifest asset) or --lock (character bible)")

    a.faction = a.faction or "krag"
    a.aspect  = a.aspect  or "tall"
    a.name    = a.name    or "panel"
    out = pathlib.Path(a.out or "."); out.mkdir(parents=True, exist_ok=True)
    jobs = VALIDATE_SCENES if a.validate else [(a.name, a.scene)] * a.n

    asyncio.run(_amain(a, lock, jobs, out))


if __name__ == "__main__":
    main()
