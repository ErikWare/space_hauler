#!/usr/bin/env python3
"""Vex + Nox act plates (wide, no lettering) for graphic-novel polish."""
import base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"
WIDE = "Wide cinematic composition, 16:9 landscape aspect ratio."
STYLES = {
  "vex": "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow edges, limited palette of crimson red, deep navy and gunmetal slate, dramatic single key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions, no lettering, no logos, no borders, no panel gutters.",
  "nox": "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow edges, limited palette of deep violet, dark cyan and cold black, dramatic single key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions, no lettering, no logos, no borders, no panel gutters.",
}

PLATES = [
  ("act_vex_picket", "vex", "Dominion border picket line in deep space, angular warships in formation, cold blue sensor beams, a small freighter on the line, tense doctrine atmosphere."),
  ("act_vex_medical", "vex", "Damaged civilian medical tender freighter running dark, reactor glow leaking, escort freighter close alongside, emergency lights, ninety souls vibe, no readable hull numbers."),
  ("act_vex_tribunal", "vex", "Austere Vex tribunal chamber, chrome and navy banners as abstract shapes no text, high ceiling, cold light, judgmental architecture."),
  ("act_vex_ghost_relay", "vex", "Ghost relay station on no chart, two centuries old, dim green-cyan lights, empty corridors of machinery that still runs, uncanny."),
  ("act_vex_nine_seconds", "vex", "Symbolic splash: nine-second clock of war, convoy silhouettes dying in order, crimson lance light, Dominion grief and doctrine."),
  ("act_vex_banners", "vex", "Dominion hangar with abstract banners, officers as silhouettes, a lone freighter pilot small in the space, order cracking."),
  ("act_nox_cryo_hall", "nox", "Nox cryo bay hall, frost haze, constellation embroidery light, rows of cold-storage pods as abstract shapes, patient violet light."),
  ("act_nox_deepdark", "nox", "Outer dark void with faint violet-cyan dust, lone freighter tiny, patient listening silence, cold beauty."),
  ("act_nox_mooring", "nox", "Outer Nox mooring ring, frost docking lights, dark spires, a freighter approaching, courteous cold menace."),
  ("act_nox_prime", "nox", "Nox Prime dressed ruin interior, load-bearing collapses that look intentional, empty assembly seats, gas-layer light through cracks."),
  ("act_nox_census", "nox", "Symbolic splash: violet data-light census stream over dark space, two warring fleets as tiny dots being measured, patient machine."),
  ("act_nox_wrong_q", "nox", "Symbolic splash: ruined world that is not ruined, costume scorch marks, a question mark made of light without letters, wrong question mood."),
  ("act_vex_hangar_crowd", "vex", "Busy Dominion hangar floor, technicians, a pilot looking for posting, cold order and chrome."),
  ("act_nox_dock_haze", "nox", "Busy but quiet Covenant dock floor in frost haze, a pilot alone among cargo, violet windows."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def gen(path, prompt):
    if path.exists():
        print(f"  skip {path.name}"); return True
    tok = token()
    for _ in range(3):
        try:
            r = requests.post(API, headers={"Authorization": f"Bearer {tok}"},
                json={"model": MODEL, "prompt": prompt, "response_format": "b64_json", "n": 1},
                timeout=180)
        except requests.RequestException as e:
            print(f"  err {e}"); time.sleep(5); continue
        if r.status_code == 200:
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
            path.write_bytes(raw); print(f"  ok  {path.name}"); return True
        if r.status_code == 429:
            time.sleep(30); continue
        if r.status_code in (401, 403):
            sys.exit("login")
        print(f"  fail {r.status_code}"); time.sleep(2)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = 0
    for pid, fac, scene in PLATES:
        if gen(OUT / f"{pid}.png", "\n\n".join([scene, WIDE, STYLES[fac]])):
            ok += 1
    # copy existing generated if present
    g = ROOT / "storyline" / "assets" / "generated"
    for src, dst in [
        ("vex_splash_nine_seconds_01.png", "act_vex_nine_seconds.png"),
        ("nox_splash_patient_answer_01.png", "act_nox_patient.png"),
        ("bg_vex_picket_01.png", "act_vex_picket_alt.png"),
        ("bg_nox_deepdark_01.png", "act_nox_deepdark_alt.png"),
    ]:
        s, d = g / src, OUT / dst
        if s.exists() and not d.exists():
            d.write_bytes(s.read_bytes()); print(f"  copy {dst}"); ok += 1
    print(f"done {ok}")


if __name__ == "__main__":
    main()
