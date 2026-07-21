#!/usr/bin/env python3
"""Generate 10 station fixer portraits + 4 global merc NPC portraits."""
import base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "intro"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"
TALL = "Vertical portrait composition, tall 3:4 aspect ratio, subject centred."
STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of rust orange, soot charcoal, pale amber, deep navy and violet, "
    "dramatic single key light. Painterly sci-fi comic panel. No text, no speech bubbles, "
    "no captions, no lettering, no logos, no borders, no panel gutters."
)

FIXERS = [
  ("fixer_brek", "BREK, a thick-set HUMAN male dock foreman, late 50s, sun-darkened tan-brown skin, iron-grey stubble, heavy brow, scarred knuckles. Always wears a grease-stained charcoal work jacket over a rust-orange undershirt, no helmet. Unimpressed, solid, patient."),
  ("fixer_june", "JUNE, a lean HUMAN woman, early 40s, ash-dusted skin, short copper hair, sharp green eyes. Always wears a scorched leather apron over slate flight gear. Dry smile, ash-broker bearing."),
  ("fixer_sol", "SOL, a HUMAN man, mid 30s, freckled sun-burnt skin, short black hair, amber eyes. Always wears heat-reflective grey coveralls with a red neck scarf. Hot temper held in check."),
  ("fixer_kith", "KITH, a tall gaunt HUMAN man, late 40s, pale skin, silver-streaked black hair, cold grey eyes. Always wears a high-collared navy clerk coat with chrome tabs. Precise, faintly disappointed."),
  ("fixer_yara", "YARA, a HUMAN woman, early 30s, cool pale skin, white-blonde hair in a tight braid, ice-blue eyes. Always wears a frost-lined white and blue warden coat. Soft voice, hard eyes."),
  ("fixer_toll", "TOLL, a HUMAN man, late 40s, desert-tan skin, shaved head, gold tooth, cunning brown eyes. Always wears a patched sand-coloured duster. Claim agent swagger."),
  ("fixer_niv", "NIV, an ageless HUMAN-appearing broker, androgynous, cool grey-violet undertone skin, short dark hair, violet-tinted eyes. Always wears a midnight shawl with thin constellation thread. Soft, expensive patience."),
  ("fixer_qen", "QEN, a HUMAN woman, unreadable age, porcelain-pale skin, black hair in a severe knot, dark eyes. Always wears a hooded charcoal vault coat. Cold vault liaison calm."),
  ("fixer_gash", "GASH, a HUMAN man, mid 40s, scarred jaw, freckled skin, messy brown hair with grey, green eyes. Always wears mismatched salvage plating over a green work shirt. Scrap-broker grin."),
  ("fixer_sil", "SIL, a HUMAN woman, late 30s, cool brown skin, silver-white hair short, calm dark eyes. Always wears a pale violet shrine mantle over practical blacks. Quiet shrine-keeper gravity."),
  ("harlan", "HARLAN, a HUMAN man, late 60s, deep weathered tan-brown skin, white stubble, heavy lids, amber eyes. Always wears a battered belt-gold coat. Old salvage broker."),
  ("zera", "ZERA, a HUMAN woman, mid 40s, cool pale skin, short ash hair, analytical blue-grey eyes. Always wears a clean instrument-blue data coat. Clinical curiosity."),
  ("pell", "PELL, a HUMAN woman, mid 30s, cool olive-brown skin, dark hair under a half-hood, knowing eyes. Always wears soft violet fringe gear. Oblique fixer."),
  ("oryn", "ORYN, a HUMAN man, early 50s, scarred cheek, close-cropped iron hair, hard brown eyes. Always wears orange-trimmed security kit. Ex-militia contractor."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def gen(pid, lock):
    path = OUT / f"{pid}.png"
    if path.exists():
        print("skip", pid); return True
    scene = "Chest-up portrait, facing viewer three-quarters, neutral professional expression, plain dark bulkhead."
    prompt = "\n\n".join([lock, scene, TALL, STYLE])
    tok = token()
    for _ in range(3):
        try:
            r = requests.post(API, headers={"Authorization": f"Bearer {tok}"},
                json={"model": MODEL, "prompt": prompt, "response_format": "b64_json", "n": 1},
                timeout=180)
        except Exception as e:
            print(e); time.sleep(5); continue
        if r.status_code == 200:
            path.write_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]))
            print("ok", pid); return True
        if r.status_code == 429:
            time.sleep(30); continue
        print("fail", r.status_code, r.text[:80]); time.sleep(2)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ok = sum(1 for pid, lock in FIXERS if gen(pid, lock))
    print("done", ok, "/", len(FIXERS))


if __name__ == "__main__":
    main()
