#!/usr/bin/env python3
"""Generate cold-open intro plates (wide cinematic, no lettering).

    python3 storyline/prompts/gen_intro_plates.py
    python3 storyline/prompts/gen_intro_plates.py --id intro_solar_system
"""
import argparse, base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"

STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of deep navy, cold cyan, soot charcoal, pale amber and "
    "rust orange, dramatic single key light. Painterly sci-fi comic panel. No text, "
    "no speech bubbles, no captions, no lettering, no logos, no borders, no panel gutters."
)
ASPECT = "Wide cinematic composition, 16:9 landscape aspect ratio."

# (id, scene_prompt) — no character locks; environment / vehicle only
PLATES = [
  ("intro_starfield",
   "Empty deep space starfield, dense cold stars, a faint dust band, pure black void, "
   "quiet and vast, no ships, no stations, no planets close, mood of a title card plate."),
  ("intro_solar_system",
   "Wide establishing shot of a living solar system: a hard white sun, several planets "
   "and strip-mined moons on different orbits, thin trade lanes of tiny lights between "
   "them, distant nebula haze at the rim, epic scale, no readable labels."),
  ("intro_vulture_tug",
   "A battered Vulture-class space tug freighter flying alone in deep space, blocky "
   "industrial hull, three tow winches, scuffed charcoal plating, small cockpit canopy "
   "glowing amber, trailing a thin thruster wake, stars behind, three-quarter side view."),
  ("intro_cockpit",
   "Interior of a cramped hauler cockpit, worn consoles with amber and cyan instrument "
   "glow, cracked viewport showing stars ahead, pilot seat empty, cables and tape repairs, "
   "lived-in industrial sci-fi, chest-height camera looking forward out the glass."),
  ("intro_nebula",
   "A small freighter silhouetted entering a vast purple-cyan nebula, glowing dust "
   "clouds and ion static arcs, beauty turning ominous, wide cinematic scale."),
  ("intro_systems_fail",
   "Same cramped hauler cockpit interior, now emergency red lighting, sparking console, "
   "smoke near the ceiling, viewport flooded with nebula glow and static, alarm "
   "atmosphere, no readable screens or letters."),
  ("intro_impact",
   "Exterior of the battered tug clipped by a tumbling asteroid chunk, impact flash on "
   "the hull, debris and venting gas, thrusters stuttering, violent moment frozen, "
   "stars and nebula wash behind."),
  ("intro_escape_pod",
   "A tiny one-person emergency escape pod / lifeboat streaking away from a damaged "
   "tug venting atmosphere in the distance, pod running lights amber, station lights "
   "barely visible far ahead as a cluster of warm windows, desperate flight."),
  ("intro_station_approach",
   "Damaged industrial space station docking ring ahead, warm amber windows, Krag-style "
   "bone and steel architecture, a small escape pod on final approach, debris still "
   "drifting, hope and grit, wide shot."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def compose(scene):
    return "\n\n".join([scene, ASPECT, STYLE])


def gen_one(pid, scene):
    out = OUT / f"{pid}.png"
    if out.exists():
        print(f"  skip {pid}")
        return True
    tok = token()
    prompt = compose(scene)
    for attempt in range(3):
        try:
            r = requests.post(
                API,
                headers={"Authorization": f"Bearer {tok}"},
                json={"model": MODEL, "prompt": prompt,
                      "response_format": "b64_json", "n": 1},
                timeout=180,
            )
        except requests.RequestException as e:
            print(f"  err  {pid}: {e}")
            time.sleep(5)
            continue
        if r.status_code == 200:
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
            out.write_bytes(raw)
            print(f"  ok   {pid} ({len(raw)//1024}KB)")
            return True
        if r.status_code == 429:
            print(f"  429  {pid} sleep 30s")
            time.sleep(30)
            continue
        if r.status_code in (401, 403) and "unauthenticated" in r.text:
            sys.exit("token expired — run `grok login`")
        print(f"  fail {pid} HTTP {r.status_code} {r.text[:140]}")
        time.sleep(2)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default=None)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [p for p in PLATES if a.id is None or p[0] == a.id]
    if not jobs:
        sys.exit(f"unknown id {a.id}")
    ok = 0
    for pid, scene in jobs:
        if gen_one(pid, scene):
            ok += 1
    print(f"done {ok}/{len(jobs)} → {OUT}")
    if ok < len(jobs):
        sys.exit(1)


if __name__ == "__main__":
    main()
