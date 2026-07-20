# Grok image generation — the locked prompt system

Measured findings from the character-consistency tests run on **2026-07-18**.
All 13 test images are in `test-outputs/`, raw API logs in
`test-outputs/_run_log.json`, `_seed_test.json`, `_v2_sizes.json`.

Test subject: **KORR VESK**, a throwaway Krag Combine salvage captain invented
purely to stress the system. Not canon — do not build story on them.

---

## TL;DR

| Question | Answer |
|---|---|
| Can Grok hold a character across panels? | **Yes** — with a ~150-token lock string, reliably. |
| Does a short description work? | **No.** It produces a different person every time. |
| Is there a seed? | The API accepts `seed` and **silently ignores it.** No determinism. |
| Image-to-image / reference image? | **No.** `image` is accepted and ignored. |
| Can I control the aspect ratio? | Not via `size` (rejected). **Yes via prompt text** — worked 3/3. |
| Can I control the output size in pixels? | No. Crop in post. |
| Does it obey "no text"? | **Yes** — zero lettering artifacts across all 13 images. |

**The system works.** The cost is that you cannot reproduce an image exactly, so
every panel needs 2–3 candidates and a human pick.

---

## The API surface

Same endpoint the sprite pipeline uses (`sprites/pipeline.py:52`):

```
POST https://api.x.ai/v1/images/generations
{ "model": "grok-imagine-image", "prompt": "...", "response_format": "b64_json", "n": 1 }
Authorization: Bearer <JWT from ~/.grok/auth.json, key `key`>
```

Parameter probe results — note the API **does** reject unknown arguments, so a
`200` on a param means it deserialized, *not* that it did anything:

| Param | Result | Verdict |
|---|---|---|
| `n` | 200, returns N images | Works. Siblings in one call are **not** more alike than separate calls. |
| `quality` | 422 on `"hd"`, error names the enum: `low` \| `medium` \| `high` | Real parameter. Effect untested — worth trying `high`. |
| `size` | **400 `Argument not supported: size`** | Not available. |
| `seed` | 200 — but two calls with `seed: 777` returned **different images** (sha `457af0dc…` vs `0ff69473…`) | Accepted and ignored. |
| `image` | 200 — even with a bogus URL that could never be fetched | Accepted and ignored. No img2img. |
| `negative_prompt` | 200 | Accepted; no evidence it does anything. Put negatives in the prompt text — that demonstrably works. |
| `style` | 200 | Accepted; effect unverified. |

**Auth:** the JWT lasts ~6h. On `403 unauthenticated:bad-credentials`, run
`grok login`. A refresh-token grant also works and is what the CLI does:
`POST https://auth.x.ai/oauth2/token` with `grant_type=refresh_token`,
the `refresh_token` and `oidc_client_id` from `~/.grok/auth.json`.

---

## Prompt structure

Four blocks, **always in this order**, joined by blank lines:

```
[1] CHARACTER LOCK   ← verbatim from the character bible §6. Never edited.
[2] SCENE            ← shot, pose, expression, setting, light. The only block that varies.
[3] ASPECT           ← "Vertical portrait composition, tall 3:4 aspect ratio, subject centred."
[4] STYLE            ← verbatim, identical for every panel in the project.
```

Keeping [1] and [4] byte-identical is the whole trick. If a writer paraphrases
the lock for one panel, that panel drifts.

### The project style block (use verbatim)

```
Graphic-novel illustration, bold inked linework, cel-shaded flats with hard shadow
edges, limited palette of rust orange, soot charcoal and pale amber, dramatic single
key light. Painterly sci-fi comic panel. No text, no speech bubbles, no captions,
no lettering, no borders, no panel gutters.
```

Swap the palette clause per faction (Krag rust-orange, Vex crimson-on-navy,
Nox violet-cyan — see `MARA_PLANET_LORE_SPEC.md:16-39`) but change nothing else.

---

## What the tests actually showed

### A — same full lock, 3× (`A1`, `A2`, `A3`)

Held: face structure, iron-grey buzzcut shaved at the temples, heavy brows,
amber eyes, the jaw-to-neck scar, rust-orange jacket, charcoal shoulder plates,
brass cog-and-chain insignia, steel forearm gauntlet. Recognisably one person.

Drifted: framing and crop, apparent age (A3 reads ~10 years older), undersuit vs.
t-shirt, and **which side** the scar and gauntlet are on.

### B — same lock, different scene (`B1`, cargo bay, full body, lit from below)

Identity survived a full change of shot, pose, setting and lighting. This is the
result that makes a graphic novel viable.

### C — one-line description, 2× (`C1`, `C2`)

A **different person** from A/B — pale skin, blue-grey eyes, longer hair, no
shoulder plates, no insignia, no gauntlet — and different from *each other*.

> **This is the core finding.** The detail in the lock string is not flavour;
> it is the entire consistency mechanism. Anything you leave out gets reinvented.

### V — corrected lock (`V1`, `V2`, `V3`)

Round 1 rendered the character with **literally green skin** across all four
images. Cause: `"deep olive-tan skin"` — "olive" read as the colour, and with no
species stated the sci-fi context finished the job and made him an alien.

Two edits — `a HUMAN Krag Combine salvage captain` and
`sun-darkened tan-brown human skin, ruddy and weathered` — fixed it completely,
and identity still held across a brand-new scene (`V3`: seated in a mess hall,
cradling a cup, warm overhead light, weary half-smile).

Note the failure was *consistently* wrong — all four round-1 images agreed on
green. **The model is much better at being consistent than at being correct.**
Consistency will not save you from a bad lock string; validate a new character
with 3 generations before writing panels against them.

### Aspect ratio

Without an aspect instruction, output size was unpredictable even for identical
prompts — `864×1152`, `1248×832`, and `1280×720` all appeared. Adding
`"Vertical portrait composition, tall 3:4 aspect ratio, subject centred."`
produced `864×1152` on **3 of 3**. Steer it in text, then crop to the panel box.

---

## Rules for writing a lock string

1. Open with `NAME, a <species> <role>` — anchor identity before detail.
2. **State the species.** Omitting it is what produced the green skin.
3. No colour word that doubles as a material or species cue. Not "olive".
4. Height as a number **and** a build word.
5. One or two **large, simply-described** distinguishing marks. Subtle ones do
   not survive panel-size downscaling.
6. Never depend on left/right — the model mirrors freely. Write side-agnostic
   ("on one forearm") and never make it a plot point.
7. Always-on wardrobe only; situational gear goes in the scene block.
8. Name exact colours and condition: "scuffed rust-orange", "battered brass".
9. Close with the one-sentence personality — it measurably changes pose and light.
10. ≤150 tokens. Longer starts diluting; shorter stops holding.
11. Negatives ("no text, no lettering") belong in the **style** block, in prose.
    They work there. `negative_prompt` does not.

## Production workflow

1. Write the bible; write the lock string.
2. **Validate:** 3 identical portraits + 1 off-scene. Same person? If not, fix
   the lock, not the scene.
3. Record the approved image as the canonical reference in the bible.
4. Generate panels: 2–3 candidates each, human picks one. There is no seed, so
   this selection pass is not optional.
5. Log every drift in the bible's §7 drift table and patch the lock string.

## Generating

`generate.py` in this folder wraps all of the above — it reads a bible's lock
string, composes the four blocks, and writes candidates to a target folder.

```sh
python3 storyline/prompts/generate.py --lock <bible.md> --scene "..." --n 3 --out <dir>
```
</content>
