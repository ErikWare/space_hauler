#!/usr/bin/env python3
"""Mission plates for onboarding quest briefings (wide, no lettering)."""
import base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"
ASPECT = "Wide cinematic composition, 16:9 landscape aspect ratio."
STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of rust orange, soot charcoal, pale amber, deep navy and cold "
    "cyan, dramatic single key light. Painterly sci-fi comic panel. No text, no speech "
    "bubbles, no captions, no lettering, no logos, no borders, no panel gutters."
)

PLATES = [
  ("onboard_debris",
   "Space debris field near an industrial station approach: tumbling junk crates, "
   "torn hull panels, canisters, a small tug silhouette tractoring scrap, stars and "
   "dock lights distant, gritty salvage work."),
  ("onboard_ore_ring",
   "Asteroid ore ring: rough copper-brown and silver rock clusters floating in a belt, "
   "a small freighter tractor beam glowing amber on a rock, industrial mining sci-fi, "
   "dangerous beauty."),
  ("onboard_ore_rich",
   "Richer outer ore ring: gold and platinum-tinted asteroids catching hard light, "
   "deeper space, a lone tug tiny against the field, high-value cargo atmosphere, "
   "contested quiet."),
  ("onboard_refinery",
   "Station refinery bay interior: molten amber pours, ore hoppers, refined metal bars "
   "on racks, industrial heat glow, drones on racks in background, no readable labels."),
  ("onboard_drone_wing",
   "Two escort drones flying wing on a battered freighter in deep space, formation "
   "lights cyan, industrial combat-utility drones, protective escort mood."),
  ("onboard_outpost",
   "Enemy outpost platform in space under assault: gun emplacements, hostile faction "
   "markings abstract not text, explosions and shield flare, a player freighter closing "
   "in, capture mission energy."),
  ("onboard_garrison",
   "Captured outpost platform with a friendly drone stationed on a pad, calm after "
   "battle, dock lights steady, ownership and holding the ground mood, industrial sci-fi."),
  ("onboard_dock_crowd",
   "Busy industrial spaceport dock floor: longshore workers, cargo sleds, berth numbers "
   "as abstract shapes not letters, a pilot standing small among the chaos looking for "
   "work, warm amber station light."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def gen_one(pid, scene):
    out = OUT / f"{pid}.png"
    if out.exists():
        print(f"  skip {pid}"); return True
    prompt = "\n\n".join([scene, ASPECT, STYLE])
    tok = token()
    for _ in range(3):
        try:
            r = requests.post(API, headers={"Authorization": f"Bearer {tok}"},
                json={"model": MODEL, "prompt": prompt, "response_format": "b64_json", "n": 1},
                timeout=180)
        except requests.RequestException as e:
            print(f"  err {pid}: {e}"); time.sleep(5); continue
        if r.status_code == 200:
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
            out.write_bytes(raw); print(f"  ok  {pid} ({len(raw)//1024}KB)"); return True
        if r.status_code == 429:
            print("  429 sleep"); time.sleep(30); continue
        if r.status_code in (401, 403) and "unauthenticated" in r.text:
            sys.exit("login needed")
        print(f"  fail {pid} {r.status_code} {r.text[:100]}"); time.sleep(2)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = sum(1 for pid, sc in PLATES if gen_one(pid, sc))
    print(f"done {ok}/{len(PLATES)}")
    if ok < len(PLATES): sys.exit(1)


if __name__ == "__main__":
    main()
