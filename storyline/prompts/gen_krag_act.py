#!/usr/bin/env python3
"""Krag act-chain plates + Harrow / Archivist portraits (graphic-novel, no text)."""
import base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"
STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of rust orange, soot charcoal and pale amber, dramatic single "
    "key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions, "
    "no lettering, no logos, no borders, no panel gutters."
)
WIDE = "Wide cinematic composition, 16:9 landscape aspect ratio."
TALL = "Vertical portrait composition, tall 3:4 aspect ratio, subject centred."

PLATES = [
  ("act_krag_sealed_crate", WIDE,
   "Cargo bay of a freighter, a heavy sealed Combine cargo container on a grav-sled, "
   "wax-and-magnetic seal, industrial amber lamps, the sled sitting suspiciously low, "
   "gritty hauler work atmosphere."),
  ("act_krag_mining_charges", WIDE,
   "Open cargo crate packed with mining demolition charges in neat rows, industrial "
   "amber light, dangerous cargo, no readable labels or stencils, tense reveal moment."),
  ("act_krag_ember_relay", WIDE,
   "Abandoned Ember Gate space relay station hanging in dark, dish and antennae, "
   "cold amber running lights, lonely deep-space navigation beacon, two distant warship "
   "silhouettes approaching, ominous."),
  ("act_krag_vex_ambush", WIDE,
   "Vex Dominion lance ships ambushing a small freighter near a relay, crimson-navy "
   "warships, lance beams warming, freighter trying to run, contested corridor combat."),
  ("act_krag_courier", WIDE,
   "Dim relay interior corridor, a hooded courier figure with a hand scale weighing a "
   "crate, no face detail, Combine industrial steel, shady handoff atmosphere."),
  ("act_krag_terrace", WIDE,
   "Strip-mined moon terrace: vast empty concentric rings cut into grey rock, "
   "city-wide empty platforms, one small bunker with three lamps far below, epic scale, "
   "Krag industrial grief."),
  ("act_krag_survey_wreck", WIDE,
   "Ancient Combine survey ship wreck in decaying orbit, ice-crusted hull, twin sensor "
   "booms one sheared, silent grave, stars, two centuries dead."),
  ("act_krag_archive", WIDE,
   "Underground archive bunker on a dead moon, stacked document trays under cloth, "
   "single amber lamp, old archivist silhouette, dust and load-bearing silence."),
  ("act_krag_annex", WIDE,
   "Close shot of an old paper document tube and a single sheet of wrong-grain paper "
   "on a metal tray, dramatic key light, forged annex mood, no readable writing."),
  ("act_krag_elder_hab", WIDE,
   "Elder hab interior on a station tether, sparse cold room, viewport showing "
   "strip-mined moons, a small aged figure in a chair, patient quiet menace and regret."),
  ("act_krag_tether", WIDE,
   "Habitation module on a long tether off a planet, two security cutters climbing "
   "the tether line, moons strip-mined in background, tense escape setup."),
  ("act_krag_forged_splash", WIDE,
   "Symbolic splash: strip-mined moons over a Combine dock, a single sheet of paper "
   "burning or glowing between, epic grief and revelation, no readable text."),
  ("act_krag_verdict", WIDE,
   "Hauler lifting from Homeport Mira, three strip-mined moons rising over the "
   "planet shoulder, amber dock light below, debt and resolve, wide epic close."),
]

PORTRAITS = [
  ("krag_harrow_neutral",
   "HARROW, an extremely elderly male HUMANOID Krag Elder, small and frail under "
   "translucent-edged bone plate that has gone pale and thin. Slate-grey ridged skin "
   "webbed with faded crimson veins, dim banked ember-orange eyes, hairless ridged "
   "scalp deeply wrinkled. Wears a simple dark robe under residual bone collar pieces, "
   "no helmet. Patient, ancient, quietly devastating. Chest-up portrait, three-quarters, "
   "neutral weary expression, sparse cold hab bulkhead behind him."),
  ("krag_archivist_neutral",
   "A male HUMANOID Krag archivist, late 70s, stooped and load-bearing. Slate-grey "
   "ridged skin, dim amber eyes, thin residual hair tufts on a ridged scalp. Always "
   "wears a soot-dark archival smock over bone-plate shoulder straps, ink-stained "
   "gloves, never a helmet. Settled, unlikely to be moved. Chest-up portrait, "
   "three-quarters, neutral expression, bunker archive shelves behind him."),
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
            print(f"  err {path.name}: {e}"); time.sleep(5); continue
        if r.status_code == 200:
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
            path.write_bytes(raw); print(f"  ok  {path.name} ({len(raw)//1024}KB)"); return True
        if r.status_code == 429:
            print("  429"); time.sleep(30); continue
        if r.status_code in (401, 403) and "unauthenticated" in r.text:
            sys.exit("login")
        print(f"  fail {path.name} {r.status_code}"); time.sleep(2)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = n = 0
    for pid, aspect, scene in PLATES:
        n += 1
        if gen(OUT / f"{pid}.png", "\n\n".join([scene, aspect, STYLE])):
            ok += 1
    for pid, lock in PORTRAITS:
        n += 1
        scene = "Chest-up portrait, facing the viewer three-quarters, plain dark industrial bulkhead."
        if gen(OUT / f"{pid}.png", "\n\n".join([lock, scene, TALL, STYLE])):
            ok += 1
    # promote existing generated candidates into sprites/intro if present
    gen_dir = ROOT / "storyline" / "assets" / "generated"
    copies = [
        ("bg_krag_relay_01.png", "act_krag_relay_existing.png"),
        ("krag_splash_moons_debt_01.png", "act_krag_moons_debt.png"),
        ("bg_krag_dock_01.png", "act_krag_dock_alt.png"),
    ]
    for src, dst in copies:
        s, d = gen_dir / src, OUT / dst
        if s.exists() and not d.exists():
            d.write_bytes(s.read_bytes()); print(f"  copy {dst}"); ok += 1
        n += 1
    print(f"done {ok}/{n}")
    if ok < n - 3:  # allow some skips
        pass


if __name__ == "__main__":
    main()
