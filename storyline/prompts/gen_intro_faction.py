#!/usr/bin/env python3
"""Generate Vex + Nox unique cold-open plates (Krag already in sprites/intro/).

    python3 storyline/prompts/gen_intro_faction.py
"""
import base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"
ASPECT = "Wide cinematic composition, 16:9 landscape aspect ratio."

STYLES = {
    "vex": (
        "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
        "edges, limited palette of crimson red, deep navy and gunmetal slate, dramatic single "
        "key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions, "
        "no lettering, no logos, no borders, no panel gutters."
    ),
    "nox": (
        "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
        "edges, limited palette of deep violet, dark cyan and cold black, dramatic single "
        "key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions, "
        "no lettering, no logos, no borders, no panel gutters."
    ),
}

# Krag path reuses existing intro_*.png. Only Vex + Nox need new plates.
PLATES = [
  # ---- VEX — militarist corridor, interdiction, tribunal-adjacent dock ----
  ("intro_vex_ship", "vex",
   "A small civilian Vulture-class tug freighter on a sunward trade lane, Dominion "
   "patrol silhouettes far in the distance, crimson and navy lighting, orderly shipping "
   "lanes, tense calm, industrial sci-fi freighter three-quarter view."),
  ("intro_vex_cockpit", "vex",
   "Cramped hauler cockpit interior, navy and chrome consoles with cold cyan and red "
   "status glow, cracked viewport showing a sunward starfield and distant patrol lights, "
   "military-clean instruments mixed with civilian repairs, empty pilot seat."),
  ("intro_vex_picket", "vex",
   "Wide shot of a Vex Dominion picket line: sharp angular warships with crimson-navy "
   "markings forming a wall across a shipping corridor, lance arrays warm, a tiny "
   "civilian freighter approaching the gap, intimidation and doctrine."),
  ("intro_vex_systems", "vex",
   "Hauler cockpit in emergency red lighting, sparking console, smoke, viewport filled "
   "with lance-flare and debris, alarm atmosphere, no readable screens or letters."),
  ("intro_vex_impact", "vex",
   "Civilian freighter clipped by a near-miss lance bolt and debris from a live-fire "
   "zone, hull venting, thrusters stuttering, crimson afterglow on the plating, violent "
   "frozen moment, stars behind."),
  ("intro_vex_escape", "vex",
   "Tiny emergency escape pod streaking away from a crippled freighter, Dominion "
   "warship silhouettes distant, pod amber lights, desperate flight toward a hangar "
   "cluster of cold blue station lights ahead."),
  ("intro_vex_station", "vex",
   "Vex Dominion orbital hangar docking approach, austere chrome and navy architecture, "
   "precision docking rings, cold blue window lights, small escape pod on final approach, "
   "military order, wide cinematic."),

  # ---- NOX — outer dark, patient void, cryo-adjacent station ----
  ("intro_nox_ship", "nox",
   "A lone Vulture-class tug freighter drifting the outer dark far from the sun, cold "
   "violet nebula wisps, almost no traffic, patient silence, charcoal hull with thin "
   "cyan running lights, lonely three-quarter view."),
  ("intro_nox_cockpit", "nox",
   "Cramped hauler cockpit interior lit by soft violet and cyan instrument glow, frosted "
   "viewport edges, deep black space beyond with faint constellation-like dust, quiet "
   "unsettling calm, empty pilot seat, no readable screens."),
  ("intro_nox_signal", "nox",
   "Wide void scene: a freighter silhouette against a deep violet-cyan signal bloom in "
   "the dark, rhythmic geometric light patterns in the dust as if something is listening, "
   "beautiful and wrong, cosmic horror lite sci-fi comic panel."),
  ("intro_nox_systems", "nox",
   "Hauler cockpit failing under violet emergency light, consoles glitching with "
   "star-field static, frost forming inside the glass, life support vents frosting, "
   "unsettling calm rather than panic, no readable text."),
  ("intro_nox_impact", "nox",
   "Freighter hull cracked open by an unseen force, silent venting of atmosphere into "
   "violet dark, no explosion flash only cold rupture and glittering ice crystals, "
   "patient disaster, stars like watching eyes."),
  ("intro_nox_escape", "nox",
   "Tiny escape pod drifting toward a distant cryo-station, pod lights dim amber, "
   "behind it a dead freighter silhouette, ahead frosted docking lights in violet-cyan, "
   "lonely desperate approach."),
  ("intro_nox_station", "nox",
   "Nox Covenant outer station approach, dark spires and frost-haze docking ring, "
   "soft violet window glow, constellation-thread architecture, small escape pod on "
   "final approach, courteous cold menace, wide cinematic."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def gen_one(pid, fac, scene):
    out = OUT / f"{pid}.png"
    if out.exists():
        print(f"  skip {pid}")
        return True
    prompt = "\n\n".join([scene, ASPECT, STYLES[fac]])
    tok = token()
    for _ in range(3):
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
            print(f"  429  {pid} sleep 30s"); time.sleep(30); continue
        if r.status_code in (401, 403) and "unauthenticated" in r.text:
            sys.exit("token expired — run `grok login`")
        print(f"  fail {pid} HTTP {r.status_code} {r.text[:120]}")
        time.sleep(2)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = 0
    for pid, fac, scene in PLATES:
        if gen_one(pid, fac, scene):
            ok += 1
    print(f"done {ok}/{len(PLATES)} → {OUT}")
    if ok < len(PLATES):
        sys.exit(1)


if __name__ == "__main__":
    main()
