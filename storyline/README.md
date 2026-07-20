# SPACE HAULER — Storyline

Interactive graphic-novel campaign. One storyline per playable faction
(**Krag Combine**, **Vex Dominion**, **Nox Covenant**), ~8–10 hours each,
~30 hours total. This replaces the single static derelict hero image that
`GAME.showOpeningScene()` flashes for 3 seconds on a new game today
(`src/game/tutorial.js:28`, art `sprites/opening_scene.png`).

Status: **visual-novel engine + Act 0 shipped.** The scene player
(`src/game/visual_novel.js`) replaces the static opening: picking a faction at
the title screen now plays that faction's Act 0 prologue (5–8 scenes, choices,
persisted flags), composited from the five shipped portraits + existing hero
art. Acts 1–3 beats and generated art are still to come — the manifest below
tracks what needs generating.

## Layout

| Path | What it is |
|---|---|
| `scene-schema.js` | The scene-node format all faction arcs use (doc; live data in `src/game/visual_novel.js`). |
| `assets/manifest.json` | Every portrait/background/splash key: status, art file or fallback, Grok lock + scene prompts. |
| `assets/generated/` | Raw generation candidates from `prompts/generate.py --key <manifest_key>`. |
| `character-bible/template.md` | The anti-drift contract. Every character that appears in art fills one out. |
| `character-bible/<faction>-protagonist.md` | One filled bible per protagonist. |
| `<faction>/lore.md` | Faction history, culture, values, path to power. |
| `<faction>/act{1,2,3}.md` | Story beats — 15–20 quest nodes per act. |
| `prompts/grok-character-template.md` | The locked prompt system + measured findings from the consistency tests. |
| `prompts/test-outputs/` | Raw test images + run logs from those tests. |

Faction folders are named for the real in-game factions (`krag`, `vex`, `nox`),
not `faction-a/b/c`.

## Source of truth for lore

Existing canon lives outside this folder and **outranks anything written here**:

- `MARA_PLANET_LORE_SPEC.md` — the world bible. Three-faction premise, 8 planets,
  the -10,000-cycle Nox timeline, the engineered Krag–Vex war.
- `src/game/regions.js:25-79` — a `lore` string on each of the 10 territories.
- `src/game/politics.js:25-127` — ~60 newsline templates; the in-game voice.
- `src/content/planet_data.js:165-238` — the only named characters that exist
  today (Elder Mira, Watcher Kel, Scout Vane, Foreman Brek, …), all on Mira.
- `src/core/config.js:51-293` — 12 player hulls in 4 lines, with flavour text.

⚠️ Known canon conflict to resolve before writing lore: `src/game/victory.js:16-20`
calls them "Vex Collective / Krag Dominion / Nox Conclave", contradicting
`src/game/title.js:11-16` ("KRAG COMBINE / VEX DOMINION / NOX COVENANT") and
moving "Dominion" from Vex to Krag. Pick one and fix the other.

## How assets are generated

Art comes from the xAI image API — the same endpoint and auth the sprite
pipeline already uses (`sprites/pipeline.py:52`):

```
POST https://api.x.ai/v1/images/generations
model: grok-imagine-image
auth:  bearer JWT from ~/.grok/auth.json  (key `key`, NOT `token`/`access_token`)
```

The token expires every ~6h, but the CLI refreshes it on its own — running any
`grok` command heals a stale `auth.json`. If a call still returns
`403 unauthenticated:bad-credentials` after that, re-run `grok login`.

**Every character image must be generated from that character's bible lock
string, pasted verbatim.** See `prompts/grok-character-template.md` for the
measured reasons — a short description does not hold a face across panels.

## Conventions

- No text in generated images, ever. Dialogue is DOM text over the panel, so
  it stays translatable, restyleable, and free of AI lettering artifacts.
- Panels are generated at whatever the model returns (~864×1152 or ~1248×832)
  and cropped in post. `size` is not a supported API argument.
- Filenames: `<faction>_<act>_<node>_<shot>.png`, e.g. `krag_a1_04_korr_closeup.png`.
</content>
