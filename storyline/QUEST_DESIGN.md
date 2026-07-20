# SPACE HAULER — Quest & Story Design

Two arcs, in campaign order:

- **The onboarding ladder** (§2–§4) — the first ~10 quests, replacing "new game →
  VN prologue → dumped into an open world" with a mechanic-per-quest tutorial
  that ends in a scripted catastrophe and a soft reset into the faction story.
- **The companion arc** (§5) — the partner who joins after that reset, flies the
  middle of the campaign with the player, and dies in Act 3.

Status: **partly built** — see [§8 Build status](#8-build-status) for exactly what
is wired today versus designed.

---

## 1. Why this shape

The game teaches six systems (tow, mine, heavy bodies, refine, drones,
outposts) that currently all arrive at once, behind a 6-tip coach-mark overlay
(`src/game/tutorial.js`). The arc below hands them over one at a time, each as a
**paid quest with a one-scene VN briefing**, so the tutorial *is* the story's
first hour rather than a thing you skip before the story.

Three load-bearing ideas:

1. **Zero stakes, full coverage.** Q1–Q10 are unmissable and unfailable. Nothing
   the player does in this stretch can soft-lock them or lose them progress.
2. **The catastrophe lands on a player who has something to lose.** The wipe at
   Q10 only works emotionally because the player spent ten quests accumulating a
   ship, drones, refined bars, and an outpost. Wiping a fresh save costs nothing;
   wiping *this* save costs an hour of investment the player chose to make.
3. **The world does not wait.** The ambush is not a punishment for playing badly
   — it is scripted and unwinnable. The enemy faction had its own agenda and the
   player was in the way. That is the tonal promise of the whole campaign.

---

## 2. The ladder (Q1–Q10)

Each quest teaches exactly one mechanic and assumes everything below it.

| # | Quest key | Objective | Mechanic taught | Gate |
|---|---|---|---|---|
| Q1 | `onb_q1_junk` | Tow 10 junk/debris pieces to the home station | tow beam + dock delivery | — |
| Q2 | `onb_q2_rocks` | Tow 10 ore rocks in | resource gathering vs. junk | Q1 done |
| Q3 | `onb_q3_copper` | Tow in 3 **copper** ore rocks | ore tiers exist; rarity ladder starts | Q2 done |
| Q4 | `onb_q4_silver` | Tow in 3 **silver** ore rocks | rarer ore sits in richer rings | Q3 done |
| Q5 | `onb_q5_gold` | Tow in 3 **gold** ore rocks | value vs. danger — richer rings bite | Q4 done |
| Q6 | `onb_q6_platinum` | Tow in 3 **platinum** ore rocks | the top of the common ladder | Q5 done |
| Q7 | `refine_drone` | Refine ore into bars **and** have 1 drone escorting | refinery + first drone | Q6 done, Act 0 seen |
| Q8 | `wing_two` | Have 2 escort drones at once | multi-drone management | Q7 done |
| Q9 | `take_outpost` | Capture 1 enemy outpost | outpost capture | Q8 done |
| Q10 | `garrison_outpost` | Station ≥1 drone on the captured outpost | outpost management | Q9 done |

> **As built, Q8 and Q9 dropped their second clauses.** Q8 was "equip 2 drones
> *and* deposit 20 ore in one run"; Q9 was "equip 3 drones *and* capture an
> outpost". Both are single-clause now: Q8 is a gear check by design (400cr, the
> smallest reward on the ladder) and Q9 is the tonal escalation, which a drone
> count in front of it only muddies. The escort-count lesson is fully carried by
> Q7→Q8; gating Q9 on a third drone would also collide with `FLEET.max = 3`
> against a hull that has no `escortSlots` bonus.

> ⚠️ **Q3–Q6 were redesigned against the engine.** The original plan said "tow in
> 3 bronze / silver / gold / platinum **heavy bodies**". That is not buildable as
> written — see [§7 Design conflicts](#7-design-conflicts-found-in-code). The
> ladder above preserves the intent (a four-step escalation of the same verb)
> using the ore-rarity system, which does exist and does have those names.

**Sequencing rule.** Exactly one onboarding quest is offered at a time, granted
automatically on completion of the previous one — not picked off a station
board. The board (`generateStationQuests`) stays untouched and keeps offering
its normal region quests alongside; the onboarding quest simply always sits at
the top of the log and always holds the nav waypoint.

**Reward curve.** Small and rising (≈150cr → ≈900cr). The point is that by Q10
the player has bought at least one upgrade with money they earned, so the wipe
takes something they chose.

### Tier tuning note

Q3–Q6 are the same verb four times. That is deliberate — it is the *escalation*
that teaches, not the verb — but it is also the most likely stretch to feel like
filler. If playtesting drags here, collapse Q4 and Q5 into a single "tow 3 silver
and 3 gold" quest rather than shortening the counts; the tier ladder reads
better at 3-each than at 1-each.

---

## 3. VN briefings

Every onboarding quest opens with a **single VN scene, 1–3 lines**, from the
faction contact. Scene ids follow the existing convention in
`src/game/visual_novel.js`: `<faction>_onb_<nn>`, e.g. `krag_onb_01`.

Rules for this act's copy:

- **No lore.** Act 0 carries the lore. These are a boss reacting to errands.
- **The contact has opinions about everything**, including junk hauling. That
  is the whole "living world" effect — cheap to write, disproportionately
  effective.
- Portrait + background reuse Act 0 assets; no new art is required to ship this.
- Terminal node (`next: null`) → the quest is granted. Same
  `vnStart(root, onComplete)` contract Act 0 already uses.

### Krag — VOSS (annoyed, transactional, secretly approving)

| # | Lines |
|---|---|
| Q1 | "Debris field off the north dock. Ten pieces. Drag them in." / "It is not glamorous. Neither are you. Go." |
| Q2 | "Rocks now. Ten of them. The difference between rock and junk is that rock is worth something." |
| Q3 | "Copper ore. Three rocks. Real cargo now — try not to look pleased about it." |
| Q4 | "Silver next. Further out, and the neighbours are less friendly. If you scrape the dock again I am billing you for paint." |
| Q5 | "Gold. Three. The rings that carry it also carry people who want it. Plan accordingly." |
| Q6 | "Platinum. Top of the common ladder, and deep enough that I am mildly concerned." / "Bring three back. Then we talk about a better tug." |
| Q7 | "Ore is not money. *Bars* are money. Refine it. And put a drone on your hull — flying naked out there is a choice, and a stupid one." |
| Q8 | "Two drones on your wing, then go fill the hold. They do the not-dying part. You still do the hauling." |
| Q9 | "Three drones and an outpost with somebody else's flag on it. Fix the second thing using the first thing." |
| Q10 | "Now garrison it. An outpost you cannot hold is a gift to whoever comes next." |

### Vex — DREN (dry, procedural, funnier than Kael)

| # | Lines |
|---|---|
| Q1 | "Your first assignment is debris retrieval. Ten pieces." / "You were an escort commander. Now you are a broom. The Dominion contains multitudes." |
| Q2 | "Ore rocks, ten. File the tonnage. Somebody genuinely reads those filings, which is its own tragedy." |
| Q3 | "Copper ore, three units. Graded cargo is logged separately, because of course it is." |
| Q4 | "Silver. Same again. I am told repetition builds character; I am told a great many things." |
| Q5 | "Gold. Three. The rings that hold it are contested; the tribunal has a form for that and I refuse to fill it out twice." |
| Q6 | "Platinum. The last tier worth sending you after in that hull." / "After this the paperwork gets more interesting. Marginally." |
| Q7 | "Refine what you have hauled, and fit a drone. Unescorted assets get written off, and I dislike writing things off." |
| Q8 | "Two drones escorting, then a full hold in one run. Accepting cover is a skill; you have been avoiding it." |
| Q9 | "Three drones, one outpost, other people's flag. Correct the flag." |
| Q10 | "Hold it. A captured position that is not garrisoned is just a position you visited." |

### Nox — SIVE (serene, unsettling, quietly amused)

| # | Lines |
|---|---|
| Q1 | "Ten pieces of debris. Bring them in." / "You will find this beneath you. That is part of it." |
| Q2 | "Now ten rocks. You will notice they feel identical to the debris. They are not. The difference is on a ledger somewhere." |
| Q3 | "Copper. Three. Graded things teach faster than ungraded ones." |
| Q4 | "Silver. Three again. You are being measured against yesterday, not against anyone else." |
| Q5 | "Gold. You will go further out than is sensible. I have already forgiven it." |
| Q6 | "Platinum. Three." / "This is the edge of what that hull can do. Edges are the interesting part of any instrument." |
| Q7 | "Refine the ore. Fit a drone. The Covenant does not send its investments out alone — it looks careless." |
| Q8 | "Two drones now, flying escort while you work. Watch how much less of the danger is yours. Sit with that." |
| Q9 | "Three drones, and an outpost that belongs to someone else. This is the first thing I have asked you to take." |
| Q10 | "Garrison it. Holding is harder than taking, and far less satisfying, which is why so few bother." |

---

## 4. The catastrophe (Q10 completion)

**Trigger:** turning in Q10 at the home station.

**Beat 1 — the ambush.** On undock, an enemy faction fleet arrives in force.
This is **scripted and unwinnable**: the player may fight, flee, or sit still and
the outcome is identical. The fleet is overwhelming by construction (well above
the player's clear DPS ceiling at this stage) and the ship is disabled on a
timer, not on an HP threshold — so a lucky build cannot break the script and an
unlucky one is not punished with a longer death.

Faction flavour for who shows up and why:

- **Krag** — Voss's rivals inside the Combine. The player was bait; the sealed
  manifests from Act 1 were the lure.
- **Vex** — Kael's political enemies. The player is a loose thread in a tribunal
  fight and it is cheaper to remove them than to argue.
- **Nox** — the Covenant itself, framed as "asset recovery". Sive is not
  betraying the player; Sive is *rebalancing a position*, which is worse.

**Beat 2 — the wipe.** Ship, cargo, credits, upgrades, drones, and the captured
outpost are all lost. This is a hard reset of holdings, **not** of knowledge:
skills/XP and map discovery should survive, because the player earned those with
their hands and taking them back reads as cheating.

**Beat 3 — the wake-up.** VN scene at an unfamiliar station — the neutral
scrapyard, ideally one of the two deep-space stations
(`CONFIG.deepSpaceStations`), so the location is visibly *not* faction space.

**Beat 4 — the new contact: WREN.** A salvage broker. Charming, mercenary,
completely unsentimental, and the first person in the game who wants nothing
from the player's faction.

> **WREN:** "I pulled you out of a debris field. Technically that makes you
> salvage, and technically that makes you mine."
> **WREN:** "Fortunately for you I prefer employees to property. Employees fix
> their own ships."
> **WREN:** "There is a hull in bay four. It is bad. It is yours. Welcome to the
> business."

**Beat 5 — the mercenary start.** The player is given the basic starter hull
(`CONFIG.hulls.vulture`, the Vulture Tug — the same hull the Act 0 prologues
already describe them flying) and no money. The faction story resumes from here
with the player as a free agent rather than an employee.

### Faction reaction lines (delivered later, on first re-contact)

- **VOSS:** "I liked that ship more than I like you. Do not do it again."
- **KAEL:** "Technically you remain in custody. Consider this a work-release
  arrangement." *(smug, and bailing you out anyway)*
- **SIVE:** "We modelled a twelve percent chance you would lose the ship. You are
  slightly ahead of projections. Here is your replacement unit."

---

## 5. Companion arc

One companion per faction: a second ship that flies with the player, fights
alongside them, talks on the radio, becomes the closest thing this game has to a
person — and dies in Act 3.

**Placement.** The companion appears **after the mercenary restart**, roughly the
12th–15th quest the player has done (i.e. early Act 1 in story terms, once the
player is a free agent with a beat-up hull and no faction protection). They are
present for the whole middle of the campaign and die at the Act 3 climax. That
span is deliberate: long enough to build a habit, short enough that the loss
lands while the player still has story left to carry it through.

**Why it works structurally.** The catastrophe takes everything the player
*owns*. The companion death takes the one thing they can't re-buy. The two
losses are the same shape at different depths, and the second only works because
the first taught the player that this game will actually take things.

### 5.1 The three companions

#### REVA — Krag Combine

*"Reva" is short for* ***Revaluation*** *— a salvager's joke about being written
down on someone's books. She has never explained it and never will.*

| | |
|---|---|
| **Role** | Independent salvager working the same debris fields as the player |
| **Voice** | Deadpan, economical, funny on a two-second delay |
| **Ship** | A hull welded out of three different wrecks — mismatched plating, one Vex nacelle she refuses to discuss. Sprite: `sprites/space/ship_krag_raider.png` |
| **Wants** | To not be used again |
| **Fears** | That she already has been, and hasn't noticed yet |

She saw what happened to the last crew that got "used" by the Combine and has
been running ever since. She needs Combine work and despises needing it. She
does not trust Voss and says so, cheerfully, to Voss.

> **Intro:** "You're still flying that? Either you're very lucky or very cheap.
> I haven't decided if I like either."

**Running gag — "That's not structural."** Every time something on her ship
tears, sparks, vents, or falls off, she says it isn't structural. She says it
about damage that is obviously structural. It becomes the sound of Reva being
fine.

#### CADE — Vex Dominion

| | |
|---|---|
| **Role** | Former Vex enforcement pilot, drummed out for asking about convoy VD-77 |
| **Voice** | Sharp, formal, idealistic — a true believer the institution spat out |
| **Ship** | A decommissioned Vex interceptor, faction markings half-scraped off. Sprite: `sprites/space/ship_vex_fighter.png` |
| **Wants** | The Dominion to be what it says it is |
| **Fears** | That he was right to ask, which would mean it never was |

He asked who compiled the interdiction list. He got a tribunal and a severance
packet. He still flies like a Dominion officer, still keeps formation, still
believes — which the player will find alternately admirable and unbearable.

> **Intro:** "They gave me a tribunal and a severance packet. I kept the ship.
> The tribunal can have the rest."

**Running gag — "Acknowledged, logged, and countersigned."** He returns the full
tribunal acknowledgment formula for utterly trivial radio traffic. Player says
"nice shot"; Cade says "acknowledged, logged, and countersigned." It is a joke
about a man who cannot stop being an officer for an institution that fired him.

#### LIRA — Nox Covenant

| | |
|---|---|
| **Role** | Covenant asset handler, assigned to monitor the player after the reset |
| **Voice** | Precise, dry, occasionally devastating |
| **Ship** | A clean, current-issue Covenant escort — the only companion whose hull isn't a wreck, which is its own statement. Sprite: `sprites/space/ship_nox_raider.png` |
| **Wants** | To file an accurate report |
| **Fears** | That she has stopped being able to |

The Nox catastrophe is the Covenant seizing the player's assets; Lira is what
the Covenant sends afterward. She is supposed to be an instrument. She is
beginning to have opinions, and she notes each one as a deviation from her own
baseline, which is the most Nox thing imaginable.

> **Intro:** "I'm here to ensure your activities remain within Covenant
> parameters. Interesting that your first action was to buy a second coffee.
> I've filed it under 'behavioral baseline.'"

**Running gag — "I've filed it under—".** She files the player's every act under
an increasingly absurd bureaucratic category. "Filed under 'resource
mismanagement.'" "Filed under 'sentiment.'" "Filed under 'a thing I will not be
asking about again.'" The categories track the relationship better than anything
either of them says out loud.

### 5.2 Relationship beats

Short VN moments at stations, between missions — 2–4 lines each, same one-scene
shape as the onboarding briefings (§3). Roughly six beats across the middle of
the campaign, escalating:

1. **Transactional** — they want something, you're useful. The intro line lands here.
2. **Grudging** — they cover you in a fight without being asked, and are weird about being thanked.
3. **Personal** — one real thing about themselves, delivered as a joke and immediately walked back.
4. **Warm** — they seek the player out for no operational reason at all.
5. **Romantic** — stated plainly, and by *them*, not the player. These three characters have all been circling something for hours; none of them would make the player go first.
6. **Committed** — a shared plan for after. This is the one that makes the death hurt, and it should be the smallest, most domestic scene in the game.

**Tone rule:** funny first, warm second, romantic third — in that order, always.
The moment a beat reaches for sincerity before it has earned a laugh, it reads
as a different game.

### 5.3 The death

**When.** The Act 3 climactic mission, after the confrontation begins and before
the closing reflection splash.

**What happens.** The companion takes fire meant for the player. Their ship is
disabled, not destroyed — there is a window where they are alive and reachable
and the player is burning toward them and will not make it. Then it goes.

**The beat sequence:**

1. `explosion_cockpit_impact` — the hit. Their voice, still level, still them.
2. `explosion_debris_field` — the disabled hull, venting. The last transmission.
   **Funny first**, in character, then quiet.
3. **Silence.** A scene with no dialogue at all — just the wreck on
   `explosion_silent_wreck`, tumbling. Use `autoAdvance` here (~7000ms) so the
   player cannot tap past it. This is the whole scene; do not put words on it.
4. The faction leader's reaction, delivered later, at the station.

**The callback.** Each companion's last line is their running gag, broken:

> **REVA:** "Hull's open. Port side, all the way through."
> **REVA:** "...That one was structural."

> **CADE:** "Acknowledged."
> **CADE:** "Logged."
> *(he does not say countersigned)*

> **LIRA:** "I'm filing this under—"
> **LIRA:** "...No. I'm not filing this one."

Each gag has spent the whole campaign meaning *I am fine / I am an instrument /
I am at a professional distance*. Breaking the formula is the character
admitting the opposite, using the only words they have.

### 5.4 The leaders' reactions

Each leader answers with their own Act 0 line turned against them. That is the
"unexpectedly human" turn — not new warmth, but an old certainty failing.

> **VOSS** *(a long silence, then)*: "Salvagers get a line in a ledger. That is
> the arrangement. That has always been the arrangement."
> **VOSS:** "I told you on your first day that the Combine wastes nothing."
> **VOSS:** "I have been saying that for sixty years. I would like it very much
> to be true."

*(Act 0 callback: "The Combine wastes nothing, hauler. Don't be the first exception.")*

> **KAEL:** "The finding is entered. Cause, circumstance, and the name. Every
> scar logged, numbered, and owed."
> **KAEL:** "The ledger is complete."
> **KAEL:** "It does not balance. I have checked it four times."

*(Act 0 callback: "Every scar on our bulkheads is logged, numbered, and owed.")*

> **SIVE:** "We projected a nineteen percent probability of this outcome. The
> projection was sound. I want you to understand that the projection was sound."
> **SIVE:** "I find that I do not care what we projected."
> **SIVE** *(after a pause)*: "I have not had that thought before. I am not
> certain what to do with it."

*(Act 0 callback: "You are an investment. My investment. I intend to see you appreciate.")*

### 5.5 What this needs from the engine

Story design is locked; **no gameplay is implemented.** Recorded here so the
build task is scoped rather than discovered.

| Need | Notes |
|---|---|
| Companion NPC ship | A persistent friendly ship that follows, fights, and cannot be permanently lost until the scripted death. The escort-drone AI (`updateFleet`, `src/game/fleet.js:95`) is the closest existing behaviour to borrow from, but a companion is a *character*, not a fleet slot — it must not be salvageable, reassignable, or counted against `escortCap()`. |
| Radio chatter | No system exists for in-flight NPC dialogue. Needs a lightweight non-blocking line queue — the VN overlay is full-screen and would stop combat dead. |
| Relationship state | `s.companion = { id, beat, alive }` or similar. **Must be added to the save whitelist** (`serializeGame` / `applySaveData`) or every beat resets on reload. |
| Death trigger | Fires from the Act 3 mission, not from the companion's HP hitting zero — the death is scripted and the player must not be able to prevent it by flying well. |
| VN scenes | Death scenes must be named `<fac>_a3_NN` — `vnSelfTest` enforces that an act chain only reaches its own faction and its own act. Suffixed ids (`krag_a3_07b`) satisfy the prefix check, so the existing Act 3 chains can be spliced without renumbering. |
| `VN_CAST` colours | Three new speakers. Suggested, none colliding with the existing eleven: `REVA #9fd36a` (salvager green), `CADE #5fa8d3` (a washed-out Dominion blue — his markings are half-scraped), `LIRA #d7a3d0` (Covenant violet with something warm in it). |
| Backgrounds | Already exist as `VN_ASSETS` keys: `explosion_cockpit_impact`, `explosion_debris_field`, `explosion_silent_wreck`. No new background art is required for the death. |

**Portrait art is the one real blocker.** All five shipped portraits
(`krag_leader`, `vex_leader`, `station_commander`, `nox_leader`,
`commander_portrait`) are already assigned to named characters, so there is
nothing to fall back to — a `krag_reva_neutral` fallback chain would put Voss's
face on Reva, which is worse than no portrait at all. Two options:

1. **Ship character-less.** Companion scenes use `character: null`, which the
   engine already renders as a full-bleed splash. Works today, costs the
   emotional weight of a face.
2. **Generate three portraits** (plus 2–3 expressions each) through the existing
   `storyline/prompts/generate.py` pipeline, with lock strings added to
   `assets/manifest.json` under `portraits`. This is the intended path and the
   reason the manifest has a `status: "pending"` state.

The death scene in particular wants a face for beat 2 and explicitly wants *no*
face for beat 3.

### 5.6 Dependency

This arc sits downstream of the mercenary restart (§4), which is itself blocked
on the Act 0 placement decision in §8. The companions can be written and their
VN scenes authored at any time; they cannot be *placed* until it is settled
where the mercenary story begins.

---

## 6. Engine hooks

What the arc needs from the existing code. Confirmed identifiers, with the file
that owns each.

### Already exists and is reused as-is

| Need | Hook |
|---|---|
| VN scene player, chains, terminal-node callback | `GAME.vnStart(sceneId, onComplete)` — `src/game/visual_novel.js` |
| Persistent story flags + seen-chain set | `s.vn.flags` / `s.vn.seen` via `GAME._vnSave()`, whitelisted in `save.js` |
| Prologue close callback | `GAME._vnAct0Complete(seenKey)` — `src/game/visual_novel.js` |
| Quest accept / abandon / turn-in | `GAME.acceptQuest` / `abandonQuest` / `turnInQuest` — `src/game/quests.js` |
| Single tracked quest + nav waypoint | `s.activeQuestId`, `GAME.setActiveQuest(id)` |
| Per-frame objective tick | `GAME.updateQuests(dt)`, called from `src/main.js:394` |
| Quest save/restore whitelist | `GAME._serializeQuest(q)` — used in **both** directions by `save.js:62,201` |
| Starter hull for the post-wipe restart | `CONFIG.hulls.vulture` (`baseTows: 3`) |
| Neutral wake-up location | `CONFIG.deepSpaceStations` |

### Must be added

**Built (Q1–Q2):**

| Piece | Where |
|---|---|
| `kind: "tutor"` quest shape + `QUEST_TUTOR` specs | `src/game/quests.js` — branches in `questObjectiveDone`, `questProgressText`, `_questObjectivePoint`, `_serializeQuest` |
| `makeTutorQuest(key, station)` | `src/game/quests.js` |
| Delivery tap `questTutorDeposit(hauled)` | `src/game/quests.js`, called from `depositTows` (`src/game/economy.js`) |
| Sequencer, briefing scenes, self-test | `src/game/onboarding.js` (new module, loads after `visual_novel.js`) |
| New-game entry | `startOnboarding()` from `_beginRun` (`src/game/title.js`) |

**Built (Q7–Q10 + catastrophe):**

| Piece | Where | Notes |
|---|---|---|
| `poll`/`base`/`text` on `QUEST_TUTOR` + `_questTutorPoll` | `src/game/quests.js` | State rungs are polled from `questObjectiveDone`/`questProgressText`, **not** from a tick: `updateQuests` never runs while docked (`main.js:306` returns early), and every Q7–Q10 condition is satisfied at a dock. `q.have` is a display mirror; `q.base` (serialized) snapshots Q9's baseline. |
| Refinery latch (Q7) | `src/game/onboarding.js` | `refineAllOre` is **wrapped**, not polled: building the drone Q7 also asks for *spends* the bars (`drones.js:103`), so a holdings test un-completes itself. The event is latched into `s.vn.seen.onb_refined`, which `save.js` already whitelists. |
| Escort taps (Q7–Q8) | `src/game/fleet.js` | Read `escorts(s).length`; the player-facing verb is `setDroneRole(idx, "escort")` (`fleet.js:56`, docked only). |
| Capture tap (Q9) | `src/game/outposts.js` | Polls `s.capturedOutpostCount` (`outposts.js:182`) as a **delta** off `q.base`, rather than chaining the `onOutpostCaptured` hook — the counter is monotonic, so losing the outpost back cannot un-complete the rung, and `politics.js` keeps sole ownership of the hook. |
| Garrison tap (Q10) | `src/game/outposts.js` | Reads `o.stationedDrones.length` on any player-owned outpost; `assignDroneToOutpost` (`outposts.js:243`) is the verb. |
| Catastrophe VN | `src/game/onboarding.js` | Per-faction `<fac>_onb_trap` → shared `merc_ambush_01` → `merc_ambush_02` → `merc_wreck` → `merc_wake_01/02`. The three explosion beats carry `autoAdvance` so the wipe cannot be tapped past. Registered outside the act `CHAINS` `vnSelfTest` walks, same as the briefings. |
| Holdings wipe | `src/game/onboarding.js` `_mercenaryRestart()` | Enumerated explicitly, never wholesale. **Lost:** credits, ore, bars, inventory, loot, fleet, tows, captured outposts (reverted to founder), all ships → one fresh `vulture` with an empty rack and a full tank. **Kept:** `xp`/`level`/`skillPoints`/`skills`, `exploredTiles` + `discovered` flags, and `playerFaction`. |
| `s.mercenary` | `main.js` (boot) + `save.js` (whitelist) + `onboarding.js` (`drawMercBadge`) | A **separate flag**, not a `playerFaction` value: `playerFaction` still selects the Act 1–3 chains and the faction-tinted station/outpost art (`world/rendering.js:502`, `outposts.js:555`), so overloading it with `"MERCENARY"` would break both. |

**Deliberately not built:** the ambush is a *cutscene*, not a scripted combat
encounter. §4 beat 1 specifies a timer-based disable with a real fleet on the
field; what ships is the VN sequence only, which delivers the same narrative
beat for none of the balance risk. The fightable version is still open.

### 6.5 Foreshadowing seeds

One throwaway line per faction, seeded into the ore-haul briefings (Q4–Q6). Each reads as ambient color at the time and only resolves in Act 1. They live in `ONBOARD_VN` in `src/game/onboarding.js`.

**Vex / DREN — Q4 (haul_silver), scene `vex_onb_04`**
> *"There is a recertification review on VD-77 units this quarter. I have filed the objection. It does not concern you."*

DREN mentions it mid-briefing and immediately closes it off — exactly how he handles every piece of administrative friction. Sounds like routine bureaucratic noise. Pays off in Act 1 when the player learns VD-77 units are being decommissioned: DREN's "objection" was the paper trail around whatever Kael actually told him to do. The line's dismissive close ("it does not concern you") is retroactively ominous because of course it does.

**Krag / VOSS — Q5 (haul_gold), scene `krag_onb_05`**
> *"Someone ran a survey on this belt before I filed. Old claim, probably nothing. Does not change the price."*

Voss opens the gold briefing with this before moving straight to the mission count. It lands as territory talk — claim-jumping is routine in the Combine's belts. Pays off in Act 1 when Elder Harrow's survey authorization surfaces as the betrayal; the "old claim" was Harrow's, and the "probably nothing" was Voss deciding not to follow the thread. The detail that he noticed and dismissed it is what makes the reveal sting.

**Nox / SIVE — Q6 (haul_platinum), scene `nox_onb_06`**
> *"LIRA has been assigned to your watch rotation. Routine."*

Delivered flat at the end of the platinum briefing, after the mission count, as if it is administrative trivia. The word "Routine" is Sive's tell — she uses it to close off questions before they form. Pays off in Act 1 when the player learns the Covenant assigns watchers to anyone who shows pattern-breaking behavior: Sive had already flagged them. The companion LIRA (§5.1) is the same character; her entire arc starts from this line.

---

### Ordering change this arc implies

Today `_beginRun` (`src/game/title.js:62`) goes:

```
new game → _spawnAtStation → initTutorial → saveGame → showOpeningScene (Act 0 VN)
```

The arc requires:

```
new game → _spawnAtStation → saveGame → onboarding Q1 … Q10 → catastrophe
       → Act 0 VN prologue → Act 1 story quests
```

Act 0 stops being the opening and becomes the **act break after the wipe**. That
is a real narrative rewrite, not just a reorder: the Act 0 scripts currently open
with the player as a stranger meeting the faction lead for the first time, but in
the new ordering the player has already run ten jobs for that lead. Either the
Act 0 copy is revised to be a *re-*introduction, or the onboarding arc gets its
own lighter framing scene up front and Act 0 stays where it is. **This decision
is unresolved and blocks Q3–Q10.**

---

## 7. Design conflicts found in code

Things the arc assumed that the engine does not currently support. Recorded here
so they are decided once rather than rediscovered per quest.

### 7.1 "Heavy bodies" cannot be towed, and have no metal tiers — **resolved above**

The plan's Q3–Q6 assumed a tow-able entity class with bronze/silver/gold/platinum
tiers. Neither half exists:

- **Not towable, structurally.** Heavy bodies live in their own `s.obstacles`
  array (`src/world/obstacles.js:51`) which no pick / mine / tow path reads.
  `towBody(t)` (`src/game/player.js:455`) resolves only `s.rocks` and `s.junk`;
  `nearestGrabbable` (`player.js:458`) scans only those two. The module header
  (`src/world/obstacles.js:2-7`) states the intent outright: obstacles "are NOT
  lockable, tappable, towable, or minable". They are collision-only terrain you
  bounce off, with mass ≈ 4400 vs. the ship.
- **No metal tiers.** `CONFIG.obstacleTiers` (`src/core/config.js:503-507`) is
  three anonymous radius bands (`rMin`/`rMax`/`w`, commented small/medium/large)
  with no name field at all.
- **The metal names live somewhere else.** `CONFIG.rings`
  (`src/core/config.js:319-334`) is the **ore** ladder: `junk, copper, silver,
  gold, platinum, iridium, cryonite, solarite, voidium, …`. Note there is **no
  bronze** — the first rung is `copper`.

**Resolution taken:** Q3–Q6 retarget to ore rarity, which is real, already
named, already tiered by ring distance, and already escalates danger as it
escalates value — which is the pedagogy the original ladder wanted. The "teach
heavy mass handling" idea is not lost; it is just not a *tow* lesson, because
heavy bodies exist to be flown around, not collected.

**Alternative, if towing giant masses is the actual goal:** that is a new engine
feature (a fifth tow-able entity class with its own mass/drag handling), not a
quest. It should be scoped as its own task, not smuggled in through onboarding.

### 7.2 "Mining run" does not exist as a concept

Q8's original wording ("equip 2 drones, complete a mining run") assumes a drone
mining mode. There isn't one. `d.role` is only ever `escort` / `hangar` /
`trade` / `stationed` (`src/game/fleet.js:56`, `src/game/outposts.js:251`), and
the only "mining drone" in the codebase is a cosmetic quest prop in `ESCORT:
MINING RIG`. Mining is a *player* verb: fly to a field, tractor rocks, haul them
back — there is no delegation of it.

Q8 is therefore restated as **"equip 2 escort drones, then deposit 20 ore in one
run"**, which teaches the same thing (drones make hauling survivable) using
verbs that exist. Building an actual mining-drone role is a separate feature.

### 7.3 `junk` is both an array *and* an ore type

A live trap for anyone extending Q1–Q6. There are two unrelated "junk"s:

- **`s.junk`** — debris floaters (`CONFIG.junkTypes`: `junk_can`, `junk_panel`,
  `junk_crate`, `junk_debris`). Turn-in rolls a Forge item into `s.inventory`.
  **This is what Q1 counts.**
- **`s.rocks[i].type === "junk"`** — an *ore* type, display name "Slag Ore", the
  innermost ring in `CONFIG.rings` (`src/core/config.js:320`). Turn-in stacks
  into `s.ore.junk`. **This counts toward Q2, not Q1.**

The implemented counters discriminate on `t.arr` (which array the tow came
from), never on `.type`, which is the correct axis. Any Q3–Q6 ore-type counter
must use `hauled.types[...]` and will correctly ignore junk floaters.

Related: the ore tier ladder chosen for Q3–Q6 is not arbitrary — `copper /
silver / gold / platinum` is exactly `DRONES.barTypes` (`src/game/drones.js:37`),
the four ores that refine into bars. So Q3–Q6 also sets up Q7's refinery lesson.

### 7.4 Delivery also fires at outposts

`depositTows()` runs from two call sites: station proximity (`src/main.js:440`,
inside `CONFIG.dockR`) **and** player-owned outpost turn-in
(`_outpostTurnIn`, `src/game/outposts.js:149`). So onboarding counters advance
when hauling to an outpost too, not only the home station. That is harmless and
arguably generous for Q1–Q2, but the briefing copy says "back to the dock" — if
that mismatch ever matters, filter on `q.stationId` inside `questTutorDeposit`
rather than changing the deposit path.

### 7.5 Quest 3–6 count tuning

Ore rocks are far more common than the original "heavy bodies" were imagined to
be, so "3 of tier X" may complete almost incidentally in richer rings. If Q3–Q6
feel like no-ops in playtest, raise counts (5–8) rather than adding steps.

---

## 8. Build status

| Item | State |
|---|---|
| This document | ✅ written |
| `kind: "tutor"` quest shape + counter objectives + save round-trip | ✅ shipped |
| Q1 `haul_junk` — tow 10 junk in, granted on new game | ✅ shipped |
| Q2 `haul_rock` — tow 10 ore rocks in, granted on Q1 turn-in | ✅ shipped |
| Q3–Q6 `haul_copper/silver/gold/platinum` — 3 each, per-type counters | ✅ shipped |
| Per-faction VN briefings for Q1–Q6 (18 scenes) | ✅ shipped |
| Per-faction ladder outro (`<fac>_onb_outro`, 3 scenes) | ✅ shipped |
| Ladder → Act 0 prologue hand-off | ✅ shipped (now via the outro's terminal callback) |
| Act 0 → first story quest grant | ✅ shipped (`_vnGrantFirstQuest`, per-faction opening job) |
| Q7 `refine_drone` — refinery latch + 1 escort drone | ✅ shipped |
| Q8 `wing_two` — 2 escort drones | ✅ shipped |
| Q9 `take_outpost` — capture one, baselined off the lifetime counter | ✅ shipped |
| Q10 `garrison_outpost` — station a drone on it | ✅ shipped |
| Per-faction VN briefings for Q7–Q10 (12 scenes) | ✅ shipped |
| Act 0 reframed as the promotion scene (opening copy only) | ✅ shipped |
| Catastrophe VN — per-faction trap + shared `merc_*` chain (8 scenes) | ✅ shipped |
| Wipe + WREN restart (`_mercenaryRestart`, `s.mercenary`, HUD badge) | ✅ shipped |
| Companion arc (§5) — REVA / CADE / LIRA | ⬜ story locked, no gameplay. Blocked on the companion NPC ship, radio chatter, and portrait art. |

**Live flow today:** new game → Q1 briefing + quest → turn in → Q2 … through Q6,
one briefing per rung → **the seam**: ladder outro → Act 0 promotion prologue →
per-faction first story quest, and Q7 (granted at the seam, briefed once Act 0
closes) → Q8 → Q9 → Q10, one rung per turn-in → the trap briefing → ambush →
silent wreck → WREN → holdings wiped, starter hull, `s.mercenary`. Verified
headless for all three factions, driven through the real engine paths
(`depositTows`, `refineAllOre`, `setDroneRole`, `captureOutpost`,
`assignDroneToOutpost`) rather than by poking counters.

**Why Q7 is granted at the seam rather than off the Act 0 callback.** Quitting
mid-prologue would otherwise strand the run: empty quest log, no rung left to
turn in, and nothing that re-triggers `showOpeningScene`. The quest lands before
any scene plays; only its briefing waits for Act 0 to close. Same rule as every
other rung — the scene is a flourish and may fail; the objective may not.

**Scene shape.** One VN scene per rung, not a briefing/completion pair: a rung's
completion beat is the *opening line* of the next rung's briefing, because both
fire at the same instant (turn-in). Splitting them would mean two overlays
back-to-back on one dock. The last rung has no "next", so its completion beat
and the Q7 segue live in `<fac>_onb_outro`, which then hands to Act 0 through
`vnStart`'s terminal callback.

### Resolved: Act 0 placement — **option 1, the promotion scene**

The open decision above was taken as **option 1**. Act 0 now sits at the seam
between the two halves of the ladder (after Q6, before Q7) and its opening copy
was reframed so the lead is promoting a proven freelancer rather than meeting a
stranger — "six jobs", which is exactly what Q1–Q6 is.

Implemented as a **frame story**, which is what kept it copy-only: the lead's
promotion line opens `<fac>_a0_01`, and the existing prologue then plays as the
recalled origin run. Scene structure, choices, flags, and every downstream act
are untouched.

> ⚠️ **Known residue.** Only the opening scene of each prologue was reframed.
> Deeper beats still carry first-meeting framing — Voss's "I watched your
> approach" (`krag_a0_05`), Kael's tribunal charge (`vex_a0_03`), Sive's
> "you will have questions" (`nox_a0_02`). Under the flashback frame these read
> as the remembered scene and are coherent, but they are not *written* as
> memory. A fuller pass would revise them into recall voice; it was scoped out
> deliberately rather than missed.
