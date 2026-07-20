# Storyline planning — findings

2026-07-18. Planning pass only; **no game code was changed.** Everything added
lives under `storyline/`.

---

## 1. The three factions, as the code actually has them

Canonical names come from `src/game/title.js:11-16`:

| Faction | In-game blurb | Lore identity (`MARA_PLANET_LORE_SPEC.md:16-39`) | Combat kit (`src/modules/faction.js:54-73`) |
|---|---|---|---|
| **KRAG COMBINE** `#ffb45e` | "Industrial scavengers of the strip-mined moons — the Krag machine wastes nothing, and it is always hungry." | Working-class survivors. Strip-mined their own worlds **out of fear, not greed** — they were told the Vex were coming. | Cannon, heavy armour, slow, advances |
| **VEX DOMINION** `#ff6a5e` | "Sunward militarists forged in live-fire trials; every scar on their bulkheads is logged, numbered, and owed." | Military order built on obedience. **Genuinely believe they are protecting civilization.** "They don't decorate. They fortify." | Laser, big shields, fast, kites |
| **NOX COVENANT** `#b48aff` | "Cold, ancient, calculating — the Nox drift the outer dark in patterns older than any charted war." | Ancient, patient, neither good nor evil. **Engineered the Krag–Vex war** to cull both populations. "Never hostile unless cornered — but never honest." | Missile, balanced, holds, retreats at 30% hull |

### The arc the existing lore already implies

`MARA_PLANET_LORE_SPEC.md:8-10` states the premise outright: *the player arrives
believing the war is about resources, and leaves knowing it's about extinction.*
The Nox forged the intel that started it (-200 cycles); Elder Mira on the home
world already knows (`src/content/planet_data.js:197`: "The Nox were framed. The
war was engineered. By whom? I think you already suspect.").

That gives each faction a natural three-act shape — **the same secret, reached
from three angles**:

- **Krag** — *we were used.* Discover the fear that justified strip-mining their
  own moons was manufactured. Tragedy of the working class: the debt was fake.
- **Vex** — *we were right for the wrong reason.* A civilization whose entire
  moral self-image rests on a threat that was invented for them. Their act 3 is
  whether an order built on obedience can survive being told the truth.
- **Nox** — *we did this.* The only faction that starts knowing. Their story is
  played from inside the experiment: the question is not what happened but
  whether they stop it, and Nox Prime is "the answer is: the question was wrong."

Hooks already in the world, free of charge: the 90-year rhythmic signal from
Arix's gas layer, Survey Team 7's bodies on Dusk, the Wind Archive on Sorn,
the Halveth counting ritual, and Nox Prime's ruins "built to look like ruins."

### Two things to fix before writing lore

1. **Naming conflict.** `src/game/victory.js:16-20` says "Vex Collective / Krag
   Dominion / Nox Conclave" — contradicting `title.js` and moving "Dominion"
   from Vex to Krag. Pick one; fix the other.
2. **Faction choice is currently cosmetic.** `playerFaction` changes only the
   spawn station, station/outpost skins, and the save-slot card. Prices,
   reputation, hostility, victory, and all 12 ship hulls are identical, and your
   own faction's patrols shoot you. Three 8–10 hour storylines are about to
   become the *only* real reason to pick a faction — worth deciding whether the
   story also unlocks faction-specific mechanics, or stays narrative-only.

---

## 2. What the Grok consistency tests revealed

13 test images in `prompts/test-outputs/`, full write-up in
`prompts/grok-character-template.md`.

**It works.** A ~150-token lock string held one character across three identical
generations *and* across a completely different scene, pose, and lighting
(`A1`–`A3`, `B1`, then `V1`–`V3`). Face structure, hair, eyes, scar, jacket,
shoulder plates, insignia and gauntlet all persisted.

**The lock string is the entire mechanism.** A one-line description of the same
character (`C1`, `C2`) produced a different person each time — different skin,
eyes, hair, and none of the wardrobe. Detail you omit gets reinvented per image.

**The model is better at being consistent than at being correct.** Round 1
rendered the character with literally green skin in all four images — "deep
olive-tan" read as the colour, and with no species stated, sci-fi context
finished the job. Consistently wrong. Saying `a HUMAN …` and
`sun-darkened tan-brown human skin` fixed it (`V1`–`V3`). **Validate every new
character with 3+ generations before writing panels against them.**

**No seed, no reference image.** The API accepts `seed` and `image` and silently
ignores both — two calls with `seed: 777` returned different images. `size` is
explicitly rejected; aspect ratio has to be steered in prompt text (which works:
3/3 at 864×1152 once instructed, vs. three different sizes without).

Practical consequence: **you cannot reproduce a panel.** Every panel needs 2–3
candidates and a human pick. Budget for it.

Auth note: the JWT in `~/.grok/auth.json` lasts ~6h, and the CLI refreshes it
itself — running any `grok` command heals a stale token. `grok login` is the
fallback, not the routine.

---

## 3. Recommended prompt structure

Four blocks, always this order, blank-line separated. Blocks 1 and 4 are
**byte-identical everywhere**; only block 2 varies.

```
[1] CHARACTER LOCK   verbatim from character bible §6 — never paraphrased
[2] SCENE            shot, pose, expression, setting, light
[3] ASPECT           "Vertical portrait composition, tall 3:4 aspect ratio, subject centred."
[4] STYLE            project style + palette + the "no text/no lettering" negatives in prose
```

Implemented in `prompts/generate.py` (reads the lock out of a bible, composes,
writes candidates). Validate a new character with `--validate`.

Lock-string rules, each learned from a failure: state the species; avoid colour
words that double as materials ("olive" → green); one or two large, simply-shaped
distinguishing marks; never depend on left/right (the model mirrors freely);
always-on wardrobe only; close with the personality sentence; ≤150 tokens.

---

## 4. Proposed story format

### A scene

The smallest unit. One background panel + a stack of dialogue lines, each
attributed to a character and optionally swapping that character's portrait.

```js
{ id: "krag_a1_04_confrontation",
  bg: "storyline/art/bg/krag_dock_night.png",
  lines: [
    { who: "korr",  emote: "weary",   text: "The manifest says forty tons. The hold says thirty-one." },
    { who: "brekt", emote: "angry",   text: "Then the hold is lying." },
    { who: "korr",  emote: "neutral", text: "Holds don't lie. People with quotas do." },
  ],
  choice: {                                  // optional
    prompt: "Press him, or let it go?",
    options: [
      { text: "Press him.",   flag: "krag_pressed_brekt", next: "krag_a1_05a" },
      { text: "Let it go.",   flag: "krag_let_go",        next: "krag_a1_05b" },
    ] } }
```

### A node

A story node = one or more scenes + a gameplay objective + a payoff scene.
Structurally: **scene → play → scene**. Nodes chain into an act; ~15–20 nodes per
act, 3 acts per faction.

### How it hooks the existing game

- **Quests:** `src/game/quests.js` already has a `kind` switch (`godo` / `chain` /
  `multi`) threaded through `questObjectiveDone`, `questProgressText` and
  `_questObjectivePoint`. A story node is a **new `kind`** that bypasses the
  random station board and is handed out by the storyline driver instead.
- **Presentation:** `showOpeningScene()` (`src/game/tutorial.js:28`) is the seed
  of the overlay but is single-image only — hardcoded src, `pointer-events:none`,
  fixed 2.4s/3.1s timers, no completion callback. It needs to become an
  index-driven, click-advanced overlay with a done-callback. The CSS cross-fade
  at `build.py:584-588` already does the transition work.
- **Persistence:** story position, choice flags, and unlocked nodes **must** be
  whitelisted in `serializeGame`/`applySaveData` (`src/game/save.js`) or they
  will not survive a reload.
- **Free assets:** five character portraits already ship and are loaded but
  drawn nowhere — `portrait_commander`, `portrait_vex`, `portrait_krag`,
  `portrait_nox`, `portrait_station` (`src/game/sprites.js:113-117`). Obvious
  anchors for the cast.

### Scale warning — read before commissioning art

3 factions × 3 acts × ~17 nodes ≈ **150 nodes**. At ~4 bespoke panels each and
2–3 candidates per panel (there is no seed, so selection is mandatory), that is
**~1,500 generations, roughly 15–20 hours of wall-clock generation**, plus credit
cost — before a single line of dialogue is written.

**Recommendation: build it visual-novel style, not comic-panel style.** Generate
a reusable library — ~8 expressions × ~12 characters (≈100 portraits) and ~50
backgrounds — and composite portrait-over-background at runtime. Reserve bespoke
full-bleed panels for ~10 splash moments per faction. That is **~250 generations
instead of ~1,500**, it makes dialogue editable without regenerating art, and it
plays to exactly what the tests showed the model is good at: the same character,
the same way, over and over.

---

## 5. Next steps

1. Resolve the faction-name conflict (`victory.js` vs `title.js`).
2. Decide narrative-only vs. story-unlocks-mechanics for faction choice.
3. Decide visual-novel compositing vs. bespoke panels (see scale warning).
4. Write `<faction>/lore.md` for one faction, then its cast.
5. Fill one protagonist bible; run `generate.py --validate`; eyeball all four.
6. Only then write act beats.
</content>
