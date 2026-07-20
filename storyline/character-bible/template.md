# Character Bible — TEMPLATE

Copy this file to `character-bible/<name>.md` and fill **every** field. A blank
field is a drift bug waiting to happen: whatever you leave out, the model
invents fresh on every generation.

The one field that actually enforces consistency is the **Prompt Lock String**
at the bottom. Everything above it exists to make writing that string possible
and to keep writers and artists agreeing on the same person.

> Measured basis for the rules below: `../prompts/grok-character-template.md`.
> A ~150-token lock string held one face across 3 identical generations *and* a
> completely different scene, pose and lighting. A one-line description produced
> a different person every time.

---

## 1. Identity

| Field | Value |
|---|---|
| **Full name** | |
| **Known as** | (nickname / rank / what NPCs call them) |
| **Faction** | Krag Combine \| Vex Dominion \| Nox Covenant \| unaligned |
| **Role in story** | protagonist \| antagonist \| mentor \| foil \| one-scene |
| **First appears** | act + node, e.g. `krag/act1.md` node 03 |
| **Pronouns** | |
| **Species** | Human unless stated. **Always state this in the lock string** — see §6. |
| **Voice in one line** | how they talk: clipped? formal? evasive? |

## 2. Physical appearance

Be specific and *visual*. "Tall" is not a descriptor; "6'4\" and rangy, stoops
in doorways" is.

| Field | Value | Notes |
|---|---|---|
| **Age / apparent age** | | |
| **Height + build** | | Give a number *and* a shape word (stocky / rangy / slight). |
| **Skin tone** | | Name a specific shade. **Avoid words that are also materials or colours of things** — "olive" reliably produced literally green skin. Prefer "sun-darkened tan-brown", "cool pale grey-pink", "deep umber-brown". |
| **Hair** | | Colour + length + cut + how it's worn. |
| **Eyes** | | Colour, and shape/set if distinctive. |
| **Face** | | Nose, jaw, brows, lines — the structure that reads at panel size. |
| **Distinguishing marks** | | Scars, tattoos, cybernetics, burns, brands. **One or two, big and simple.** A subtle mark will not survive downscaling to a panel. |
| **Posture / how they hold themselves** | | |

## 3. Wardrobe

Split what is *always* on them from what is situational. Only the always-on
items belong in the lock string.

| Field | Value |
|---|---|
| **Always wearing (goes in the lock)** | |
| **Exact colours** | Name them concretely — "rust-orange", "charcoal", "brass". |
| **Materials / condition** | canvas, plate, membrane, ceramic; new, scuffed, frayed, scorched |
| **Insignia** | What, where, what it's made of |
| **Signature prop / gear** | The one object they're never without |
| **Situational gear (NOT in the lock)** | vac suit, dress uniform, restraints, etc. — add to the *scene* block instead |

## 4. Personality — one sentence

> _One sentence._ This is not backstory; it is a lighting and posing
> instruction. "Blunt, stubborn, bone-tired but unbroken" tells the model to
> light them hard from one side and set their shoulders. Write it so it does
> that job.

## 5. Story function

- **Wants:** 
- **Actually needs:** 
- **Stands in the way of:** 
- **Arc across acts 1→3:** 
- **Relationship to the player character:** 
- **Canon hooks:** which existing NPC / region / planet lore do they touch?
  (see `MARA_PLANET_LORE_SPEC.md`, `src/game/regions.js:25-79`)

## 6. Prompt Lock String  ← the consistency anchor

**≤150 tokens (~600–750 characters). Pasted VERBATIM into every single image
prompt for this character. Never paraphrased, never trimmed for a "small"
panel, never reordered.**

Rules, each one learned from a failed generation:

1. **State the species explicitly** (`a HUMAN …`). Omit it and heavy sci-fi
   context plus one ambiguous colour word turns the character into an alien.
2. **No colour word that doubles as a material or a species cue.** "olive" →
   green skin. Say "sun-darkened tan-brown" instead.
3. **Open with `NAME, a <species> <role>`** so the identity anchors before the
   detail list.
4. **One or two large distinguishing marks**, described by shape and path
   ("a pale raised burn scar from the left jawline down the neck"), not by name.
5. **Left/right does not survive** — the model mirrors freely between
   generations. Either accept the mirror or write it side-agnostic ("on one
   forearm"). Never make a plot point of which side something is on.
6. **Always-on wardrobe only.** Situational gear belongs in the scene block, or
   it will bleed into panels where the character shouldn't be wearing it.
7. **End with the personality sentence** — it measurably changes pose and light.
8. **Do not put the scene, the shot, the mood, or the art style in here.** Those
   are separate blocks so the lock stays byte-identical across every panel.

```
<PASTE THE LOCK STRING HERE — this exact text goes in every prompt>
```

**Token count:** ___ (keep ≤150)

### Reference images
Once a generation is approved as this character's canonical look, record it —
it is the tie-breaker when a later panel drifts and a human has to judge.

| File | What it establishes |
|---|---|
| `../prompts/test-outputs/…` | canonical face |

---

## 7. Drift log

Append a row every time a generation comes back wrong. This is how the lock
string gets better; it is not busywork.

| Date | Panel | What drifted | Lock-string fix |
|---|---|---|---|
| | | | |
</content>
