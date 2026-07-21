#!/usr/bin/env python3
"""Generate the 12 playable pilot portraits (3 races × 2m × 2f).

    python3 storyline/prompts/gen_player_portraits.py
    python3 storyline/prompts/gen_player_portraits.py --id pc_krag_m1
"""
import argparse, base64, json, os, pathlib, sys, time
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "sprites" / "player_portraits"
API = "https://api.x.ai/v1/images/generations"
MODEL = "grok-imagine-image"

STYLE = (
    "Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow "
    "edges, limited palette of {palette}, dramatic single key light. Painterly sci-fi "
    "comic panel. No text, no speech bubbles, no captions, no lettering, no borders, "
    "no panel gutters, no logos."
)
PALETTES = {
    "krag": "rust orange, soot charcoal and pale amber",
    "vex":  "crimson red, deep navy and gunmetal slate",
    "nox":  "deep violet, dark cyan and cold black",
}
ASPECT = "Vertical portrait composition, tall 3:4 aspect ratio, subject centred."
SCENE = (
    "Chest-up portrait, facing the viewer three-quarters, neutral professional "
    "expression suitable for a pilot ID card, plain dark industrial bulkhead "
    "background with soft single key light, no other characters."
)

PORTRAITS = [
  ("pc_krag_m1", "krag", "BREN, a male HUMANOID Krag Combine hauler pilot in his early 40s. Slate-grey ridged skin webbed with faint crimson veins, hairless ridged scalp, small ember-orange eyes. Heavy brow ridges, strong jaw. Always wears a scuffed charcoal flight jacket with one pale bone shoulder plate strapped by brown leather, never a helmet. Stocky, pragmatic, bone-tired but unbroken."),
  ("pc_krag_m2", "krag", "TORR, a male HUMANOID Krag Combine hauler pilot in his late 20s. Slate-grey ridged skin with fine crimson vein lines, hairless domed ridged head, bright ember-orange eyes. One bone pauldron cracked and mended with a riveted iron staple over a dark oil-stained flight jacket. Leaner build, restless posture, jaw set hard."),
  ("pc_krag_f1", "krag", "SKARA, a female HUMANOID Krag Combine hauler pilot in her mid 30s. Slate-grey ridged skin with faint crimson veins, hairless ridged scalp, small ember-orange eyes, sharp cheek ridges. Always wears a worn charcoal flight jacket with a pale bone chest plate and brown leather harness straps, never a helmet. Compact powerful build, unimpressed default expression."),
  ("pc_krag_f2", "krag", "VEXA, a female HUMANOID Krag Combine hauler pilot in her late 40s. Deep slate-grey heavily ridged skin, hairless scalp with deep brow ridges, dim ember-orange eyes, weathered face. Always wears a frayed soot-dark flight jacket under pale bone shoulder plates strapped with patched leather. Broad shoulders, patient menace, calm mouth."),
  ("pc_vex_m1", "vex", "RYNN, a male HUMANOID Vex Dominion hauler pilot in his mid 30s. Smooth ash-grey skin, high hairless crown, sharp cheekbones, pale silver eyes with no visible pupil. Thin luminous cobalt-blue circuit-like markings sweep from his temples across his brow. Always wears a high-collared charcoal flight jacket with dull chrome collar tabs, posture still military. Severe, precise, faintly disappointed."),
  ("pc_vex_m2", "vex", "SEV, a male HUMANOID Vex Dominion hauler pilot in his early 40s. Smooth ash-grey skin, hairless crown, gaunt face, pale silver eyes without pupils. Cobalt-blue circuit markings along the temples, slightly dimmer on one side. Always wears a worn navy-black flight jacket with one chrome shoulder guard polished and one deliberately scraped bare. Rigid posture, jaw tight."),
  ("pc_vex_f1", "vex", "NYRA, a female HUMANOID Vex Dominion hauler pilot in her early 30s. Smooth ash-grey skin, high hairless crown, sharp cheekbones, pale silver eyes with no visible pupil. Luminous cobalt-blue circuit markings from temples across brow and scalp. Always wears a high-collared dark navy flight jacket with polished chrome collar ring, perfect posture. Court-martial calm, severe, precise."),
  ("pc_vex_f2", "vex", "KESS, a female HUMANOID Vex Dominion hauler pilot in her late 30s. Smooth cool ash-grey skin, hairless crown, angular face, pale silver pupil-less eyes. Cobalt-blue circuit markings at the temples, deliberately underlit. Always wears a scuffed charcoal-navy flight jacket with thin chrome collar tabs, sleeves rolled once. Controlled, formal, idealistic under the ice."),
  ("pc_nox_m1", "nox", "ORIN, a male HUMANOID Nox Covenant hauler pilot of unreadable age. Skin like translucent frosted glass with faint star-fields drifting beneath, softly glowing violet eyes, thin knowing smile. Always wears a dark charcoal flight jacket under a midnight hooded shawl embroidered with thin violet circuit lines and constellation threads, hood often half-up. Courteous unhurried menace."),
  ("pc_nox_m2", "nox", "THAL, a male HUMANOID Nox Covenant hauler pilot, ageless bearing. Translucent frosted-glass skin with slow star-field motes under the surface, glowing violet eyes, almost no brows. Always wears a plain dark flight jacket with a thin violet-line mantle across the shoulders, no letters or insignia text. Still posture, thin closed-mouth smile, patient."),
  ("pc_nox_f1", "nox", "SAEL, a female HUMANOID Nox Covenant hauler pilot of unreadable age. Skin like translucent frosted glass with faint drifting star-fields beneath, softly glowing violet eyes, thin knowing smile. Always wears a hooded midnight-black flight mantle with iridescent constellation thread embroidery and thin violet circuit lines, hood up. Courteous, unhurried, already reading the ending."),
  ("pc_nox_f2", "nox", "ELEN, a female HUMANOID Nox Covenant hauler pilot, mid-appearing 30s but ageless. Cool frosted-glass skin with faint star motes under the surface, glowing violet eyes, composed mouth. Always wears a charcoal civilian flight jacket with a thin wordless violet geometric chevron pin — no letters, words, or writing — and a dark mantle. Precise, dry, taking careful mental notes."),
]


def token():
    data = json.load(open(os.path.expanduser("~/.grok/auth.json")))
    first = list(data.values())[0]
    return first.get("token") or first["key"]


def compose(lock, faction):
    return "\n\n".join([lock, SCENE, ASPECT, STYLE.format(palette=PALETTES[faction])])


def gen_one(pid, faction, lock):
    out = OUT / f"{pid}.png"
    if out.exists():
        print(f"  skip {pid} (exists)")
        return True
    prompt = compose(lock, faction)
    tok = token()
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
    jobs = [p for p in PORTRAITS if a.id is None or p[0] == a.id]
    if not jobs:
        sys.exit(f"unknown id {a.id}")
    ok = 0
    for pid, fac, lock in jobs:
        if gen_one(pid, fac, lock):
            ok += 1
    print(f"done {ok}/{len(jobs)} → {OUT}")
    if ok < len(jobs):
        sys.exit(1)


if __name__ == "__main__":
    main()
