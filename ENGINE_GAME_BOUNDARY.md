# Engine / Game Boundary — Audit and Cleanup Instructions

Status: **specification only, no code changed.**
Companion to `WEAPONS_LOADOUT_REWORK.md`. Read this one first — it changes WI-16 of that doc.

---

## 0. Two Findings Up Front

**The runtime coupling is already clean.** I grepped every engine module in `src/modules/` for references to game globals (`CONFIG`, `GAME`, `DRONES`, `toast()`, `sfx()`, `SPRITES`). **Zero runtime hits.** The only matches are three stale *comments*:

- [equipment_system.js:64](src/modules/equipment_system.js:64) — "games normally pass their own CONFIG.baseShip"
- [station_store.js:66,69,71](src/modules/station_store.js:66) — "see DRONES.orePerBar", "2× its ore's value (CONFIG.rings)", "runs headless without CONFIG"

Dependencies flow one way — game → engine, via the nine `Forge*` globals. That is the correct direction, and it's already how the code works. **There is no back-bleed of calls.**

**The 10-slot inventory is dead code.** `inventory_ui.js` (682 lines) defines `GROUPS = ["high","mid","low","rig"]` with 10 typed slots and enforces slot-type matching on drop. It is **never initialized** — `initInventory()` has zero callers. Its only appearance outside itself is in a selfTest module registry at [main.js:364](src/main.js:364). The live game already uses a flat 6-slot rack: [ui.js:47](src/game/ui.js:47) says so explicitly — *"the gear tab is now a DOM overlay instead of the ForgeInventory canvas grid; equipment is the flat 6-slot ForgeEquipment rack."*

So the "blocking contradiction" I flagged in the previous spec is a phantom. **You already have 6 slots.** The 10-slot model exists only in a module nobody runs, whose selfTest keeps passing and keeps it looking alive.

---

## 1. The Real Bleed: Content, Not Calls

The engine doesn't *call* the game. It *contains* it. Every engine module ships with Space Hauler's nouns hardcoded as defaults. Build a second game on this engine tomorrow and you inherit copper ore, Vex Commanders, and a cargo bar.

| engine module | baked-in game content | injection seam? |
|---|---|---|
| `item_system.js` | `var DB` — 32 item bases, ore table, `drop_map`, `paths`, `_meta.fit_budget_default` ([:25](src/modules/item_system.js:25)) | **`loadDB(json)` exists at [:362](src/modules/item_system.js:362) — and is never called** |
| `equipment_system.js` | `ATTRS` names `oreYield`, `miningSpeed`, `cargoMax`, `cargoWeightK`, `refineYield`, `tractorRange`, `tractorStr`. `DEFAULTS` is a Space Hauler ship. | `initEquipment(slotCount)` — takes slot count only |
| `combat.js` | `PROJ_SPEED = {laser, cannon, missile}` ([:53](src/modules/combat.js:53)), `COLORS` keyed the same ([:40](src/modules/combat.js:40)) | `initCombat(opts)` — doesn't accept these |
| `faction.js` | Vex / Krag / Nox, their rank names, their weapon keys ([:51-64](src/modules/faction.js:51)) | `initFactions()` — no args |
| `world.js` | station names ([:117](src/modules/world.js:117)) | `initWorld(seed, opts)` |
| `station_store.js` | `BAR_BASE_VALUE`, `BAR_STOCK_RANGE`, `MARKUP` ([:73](src/modules/station_store.js:73)) | `initStore(opts)` |
| `hud.js` | a hardcoded **cargo bar** ([:242](src/modules/hud.js:242)), fuel/ore labels | `initHUD(canvas, ctx, opts)` |
| `inventory_ui.js` | 10 typed slots | **dead module** |

The seams mostly exist. They just aren't used — the game boots the engine and lets every default stand.

**The principle to enforce: no engine default may name a game noun.** If a symbol in `src/modules/` contains the string `laser`, `copper`, `Vex`, `cargo`, or `ore`, it's game content in the wrong file. An engine fallback should be neutral (`1000` units/sec) or it should throw — never a plausible-looking Space Hauler value that silently works and hides the missing injection.

---

## 2. Work Items — Slots

### SL-1 — Delete `inventory_ui.js`

682 lines of dead code that is the *only* source of the 10-slot model, kept alive by a green selfTest.

- Delete `src/modules/inventory_ui.js`.
- Remove `"inventory_ui"` from `MODULES` in [build.py:26-29](build.py:26).
- Remove `ForgeInventory` from the selfTest registry at [main.js:364](src/main.js:364).
- Remove the `ForgeInventory` mention from the comment at [config.js:5](src/core/config.js:5).
- Remove the stale reference at [ui.js:47](src/game/ui.js:47).

This deletes, in one move: the typed-slot rack, the drop-rejection logic, and the three selfTests that assert behavior contradicting the live engine ([inventory_ui.js:576](src/modules/inventory_ui.js:576), [:542-546](src/modules/inventory_ui.js:542), [:631-633](src/modules/inventory_ui.js:631)).

### SL-2 — Remove the vestigial `slot` field from items

With typed slots gone, `slot: "high"|"mid"|"low"|"rig"|"skill"` on every item base means nothing. The engine already discriminates by data shape: a weapon has `item.weapon`, a skill has `item.skill`, a passive has neither.

- Strip `slot` from all bases in the item catalogue.
- Delete `_meta.fit_budget_default` ([item_system.js:28](src/modules/item_system.js:28)).
- Audit for readers. **Note:** [fleet.js:376-413](src/game/fleet.js:376) uses `dataset.slot` for *drone loadout* slots — a separate concept that happens to share the word. Leave it alone.

### SL-3 — Make 6 the game's number, not the engine's

`SLOT_COUNT = 6` currently lives in [equipment_system.js:28](src/modules/equipment_system.js:28) as an engine default. Six is a Space Hauler balance decision.

- Add `equipSlots: 6` to `CONFIG` in `src/core/config.js`.
- Boot with `ForgeEquipment.initEquipment(CONFIG.equipSlots)`.
- In the engine, keep `SLOT_COUNT` as an internal fallback but make it neutral, and stop exporting it as if it were meaningful ([equipment_system.js:619](src/modules/equipment_system.js:619)).

---

## 3. Work Items — Engine Decontamination

### EN-1 — Move the item catalogue out of the engine

The single biggest offender. `var DB = {...}` at [item_system.js:25-120](src/modules/item_system.js:25) is Space Hauler's entire item and ore economy, living inside a reusable engine.

- Create `src/content/items.js` exporting the catalogue (the pruned 16 bases from the rework spec, plus attributes, drop_map, paths).
- Create `src/content/ore.js` for the ore table.
- In the engine, initialize `DB` to **empty**, and make every accessor throw a clear error if `loadDB()` hasn't run. Do not ship a fallback catalogue.
- Game boot calls `ForgeItemSystem.loadDB(CONTENT.items)`.

The seam already exists and is already tested — it has simply never been used.

### EN-2 — Inject the stat schema into `equipment_system`

`ATTRS` ([equipment_system.js:32-59](src/modules/equipment_system.js:32)) is a table of *this game's* stat names. `oreYield` and `miningSpeed` are the giveaway: they're Space Hauler concepts, they're in the engine, and **nothing reads them anywhere.**

- Move `ATTRS` and `DEFAULTS` (the base ship) into `src/content/stats.js`.
- Change the signature to `initEquipment({ slotCount, attrs, baseStats })`.
- Engine keeps only the *mechanics*: flat → perSec → resist → pct apply order, the resist cap, unknown-key tolerance.
- `RESIST_CAP = 0.75` ([:61](src/modules/equipment_system.js:61)) is a balance number, not a mechanic. Inject it.

### EN-3 — Move projectile speed and color onto the weapon data

`PROJ_SPEED` and `COLORS` in `combat.js` are lookup tables keyed on `"laser" | "cannon" | "missile"`. The weapon profile is *already* data on the item (`dmgShield`, `range`, `fuelPerShot`, `aoe`). Speed and color belong there too.

- Add `projSpeed` and `color` to each weapon's `weapon` block in the content catalogue.
- Delete `PROJ_SPEED` and `COLORS` from [combat.js:40,53](src/modules/combat.js:40). Read from `w.projSpeed` / `w.color`.

This is the cleanest of the fixes: it **deletes** two tables rather than adding an injection parameter, and it means adding a fourth weapon type requires no engine change at all. That's the test of whether the boundary is real.

Note `DEFAULT_FIRE_MS = 1200` ([:52](src/modules/combat.js:52)) becomes irrelevant once every weapon authors `fireRate_ms` (WI-4 of the rework spec). Keep it as a neutral fallback or drop it.

`AOE_FACTOR = 0.40`, `HIT_CHANCE = 0.85`, `CRIT_CHANCE`, `CRIT_MULT`, `GLANCE_CHANCE`, `GLANCE_MULT` ([:47-51](src/modules/combat.js:47)) are all balance knobs sitting in the engine. Inject them through `initCombat(opts)` — the function already exists and already takes an options bag.

### EN-4 — Inject factions

Vex, Krag, and Nox — names, colors, rank titles, weapon keys — are content ([faction.js:51-64](src/modules/faction.js:51)). `initFactions()` currently takes no arguments.

- Move to `src/content/factions.js`.
- Change to `initFactions(defs)`.
- Note the faction defs reference weapon keys (`"laser"`, `"cannon"`) — after EN-1 those live in the game's item catalogue, so this coupling resolves itself once both are content.

### EN-5 — Inject station names

[world.js:117,132](src/modules/world.js:117) reads from a `names` array. Confirm it's a parameter of `initWorld(seed, opts)` and not a module-level constant; if the latter, move it to content.

### EN-6 — Inject bar economics into `station_store`

`BAR_BASE_VALUE`, `BAR_STOCK_RANGE`, and `MARKUP` ([station_store.js:73-80](src/modules/station_store.js:73)) are Space Hauler's refined-metals market.

- Move to `src/content/economy.js`, pass via `initStore(opts)`.
- **Fix the three stale comments** at [:66,69,71](src/modules/station_store.js:66). They cite `DRONES.orePerBar` and `CONFIG.rings` — game symbols the engine cannot see — and the "duplicated here because this module runs headless without CONFIG" note is the exact rationalization that produced the bleed. The values aren't duplicated because the engine is headless. They're duplicated because nobody injected them.

### EN-7 — Remove the cargo bar from the HUD

[hud.js:242-244](src/modules/hud.js:242) draws `cargo / cargoMax` as a bar. Cargo is being deleted (WI-15 of the rework spec), and a generic HUD shouldn't know what cargo is regardless.

- Delete the cargo bar and `COL.cargo` ([:44](src/modules/hud.js:44)).
- Longer term: `initHUD` should take a **bar spec list** (`[{key, label, color, max}]`) rather than hardcoding fuel and cargo. Optional; flagging it as the same class of problem.

### EN-8 — Engine selfTests must not depend on game content

This is the constraint that makes the boundary stick, and it's the one most likely to be skipped.

Today `item_system.selfTest` asserts `bases === 32 && attributes === 34` ([:469](src/modules/item_system.js:469)), and `equipment_system.selfTest` builds fixtures from `mining_laser` and `cargo_expander` ([:448-449](src/modules/equipment_system.js:448), [:587](src/modules/equipment_system.js:587)). Those tests are asserting on **the game's catalogue from inside the engine.**

- Every engine selfTest must `loadDB()` a **tiny synthetic fixture** (2-3 made-up bases with neutral names like `test_widget`) and assert against that.
- No engine test may reference a Space Hauler item key, ore type, faction name, or stat name.
- This is a good canary: after the cleanup, `grep -riE 'laser|copper|cargo|vex|ore' src/modules/` should return **nothing but incidental prose**. If it returns code, the boundary leaked again.

---

## 4. Sequencing

SL-1 first — deleting the dead module removes the loudest contradiction and shrinks everything downstream.

1. **SL-1** — delete `inventory_ui.js`. Removes ~682 lines and three misleading selfTests.
2. **SL-2, SL-3** — strip `slot` from items; move `equipSlots: 6` to `CONFIG`.
3. **EN-1** — move the item catalogue to `src/content/`. *Biggest single change; unblocks the rest.*
4. **EN-8** — rewrite engine selfTests against synthetic fixtures. **Do this immediately after EN-1**, not at the end — otherwise every subsequent step fights a red test suite.
5. **EN-2, EN-3** — stat schema and weapon data. EN-3 deletes code.
6. **EN-4, EN-5, EN-6, EN-7** — factions, station names, bar economics, HUD cargo bar.
7. Rebuild: `python3 build.py`.

Then the weapons/loadout rework proceeds on a clean boundary. **The two specs interlock:** EN-1 wants the pruned 16-item catalogue, and WI-10 of the rework spec produces it. Doing the catalogue prune *while* extracting it to `src/content/` is one edit, not two.

---

## 5. Impact on `WEAPONS_LOADOUT_REWORK.md`

**WI-16 (resolve the slot-model contradiction) is obsolete.** There is no contradiction — there is a dead module. Replace it with SL-1 above. The "blocking" dependency it created is dissolved: the catalogue prune (WI-10) can proceed immediately, and should be merged with EN-1.

Everything else in that spec stands. Three items get cheaper now that the boundary is explicit:

- **WI-15** (delete cargo) also deletes `hud.js`'s cargo bar — EN-7.
- **WI-4** (per-weapon `fireRate_ms`) is a pure content edit once EN-3 lands. No engine change.
- **WI-17** (selfTest updates) shrinks considerably: the three `inventory_ui` tests vanish with the module, and the `item_system` / `equipment_system` tests get rewritten against fixtures under EN-8 rather than patched.

---

## 6. Open Question

**How far does "engine" go?** `faction.js`, `world.js`, and `station_store.js` are more opinionated than `item_system.js` or `combat.js` — a station store with refined-bar markets and a world with warp gates and nebulae is arguably *a space game's* engine, not *an* engine. Two coherent answers:

**(a) Strict.** Engine = mechanics only (items, stats, combat resolution, HUD primitives). `faction`, `world`, `station_store`, and `npc` move to `src/game/` as Space Hauler systems. Smallest, sharpest engine — four modules.

**(b) Genre.** Engine = "2D space sim toolkit." All nine modules stay, but every one takes its content by injection. Bigger surface, more reuse for the *next space game* specifically.

I'd take **(b)**, since it preserves the work already done and the injection discipline is the same either way — but it's a call about what the next game looks like, and that's yours. The audit above is written for (b); under (a), EN-4/5/6 become "move the file" rather than "inject the content."
