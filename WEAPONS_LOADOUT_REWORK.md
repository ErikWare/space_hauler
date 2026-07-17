# Weapons & Loadout Rework — Change Instructions (v2)

Target: `src/**/*.js` (the live game; `build.py` concatenates it into `game.html`).
Status: **specification only, no code changed.**
Revision: v2 — incorporates all five design answers.

---

## 0. Read This First — the target isn't V3

The live game is `src/` → `build.py` → `game.html`, which its own header calls **v4**. V3 (`game_v3_updated.html`) is a dead artifact. v4 has already implemented most of the weapon design you described:

| Your requirement | v4 today | Verdict |
|---|---|---|
| Three layers: shield / armor / hull | shield 100, armor 80, hull 60 ([config.js:29](src/core/config.js:29)) | **already done** |
| Laser: +shield, −armor, =hull | `1.6 / 0.6 / 1.0` ([item_system.js:64](src/modules/item_system.js:64)) | **already done** |
| Cannon: +armor, −shield, =hull | `0.6 / 1.6 / 1.0` ([item_system.js:65](src/modules/item_system.js:65)) | **already done** |
| Missile: AOE, equal vs all | `1.0/1.0/1.0`, `aoe: 120` ([item_system.js:66](src/modules/item_system.js:66)) | **already done** |
| Laser most fuel → missile least | `fuelPerShot` 8 / 5 / 3 | **already done** |
| Weapons burn shared fuel | [combat.js:242](src/modules/combat.js:242) | **already done** |
| Shield/armor resistance stats | `shield_resist`, `armor_resist` → `res.*`, cap 0.75 | **already done** |
| Laser fast / cannon medium / missile slow | all share `DEFAULT_FIRE_MS = 1200` | **missing** |
| Repair costs fuel | skills are free ([equipment_system.js:323](src/modules/equipment_system.js:323)) | **missing** |
| Unidentified ore + salvage at base | **no identify system exists anywhere in v4** | **missing** |
| Refine ore → bars → sell bars | half-built, and economically a no-op | **broken** |
| No gain from shooting rocks | `fireAtRock` → `mineRock` grants ore | **must remove** |
| No gain from shooting junk | `bustJunk` grants a salvage item | **must remove** |
| No cargo hold | `cargoMax` / `cargoWeightK` exist but nothing reads them | **must remove** |
| The module catalogue | 32 item bases exist | **must prune to 16** |

The bulk of this is **subtraction**. The genuinely new work is fire rates, fuel-cost repairs, the identify gate, and fixing refining.

---

## 1. Decisions Locked In

1. **Towed bodies are immune to all damage.** Your haul cannot be destroyed by your own missile splash, by enemy fire, or by collision.
2. **Defense splits three ways, and this is the core build-crafting axis:**
   - **Boost** modules raise max shield / max armor. Passive, no fuel, equipped at the station.
   - **Repair** modules restore shield / armor in flight. Active, **consume fuel**.
   - **Hardener** modules add resistance (damage reduction) to shield / armor. Passive, no fuel. Also appears as a stacked affix on rare+ gear.
   - A player can be a shield tank (boost + repair + hardener on shield), an armor tank, or split — gear permitting.
3. **Refining is a station service, not a module.** Dock with raw rocks → sell them raw, or refine into bars → sell bars for more. No ship-side refinery.
4. **Hull stays at 60.** No hull modules, no hull regen, station repair only. Taking hull damage means disengage. Stronger hulls arrive later as *ships*, not modules.
5. **Alien kills drop modules with auto-pickup.** Inventory is unlimited. The cargo-bay system is deleted entirely. Modules are earned by towing or fighting, and can only be equipped at the station hangar — that's limit enough.

---

## 2. Three Corrections to the Mental Model

**a) Shooting a rock isn't a roll.** It's deterministic: rock to 0 HP → `mineRock()` grants one guaranteed unit of ore ([economy.js:31](src/game/economy.js:31)). The *random-roll* drop is the separate path where shooting **junk debris** calls `bustJunk()` → `rollJunkDrop()` → a full random item ([economy.js:38](src/game/economy.js:38)). Both die.

**b) There is no cargo hold to delete.** `cargoMax: 20` and `cargoWeightK: 1` are defined and derived, but **nothing ever reads them**. No capacity check, no weight accounting. Same for `oreYield` and `miningSpeed` — modeled as stats, read by nothing. Deleting cargo is a zero-impact cleanup. Your carry limit has always been tow slots, which is exactly the design you want. Unlimited inventory is already the de-facto behavior.

**c) `mining_laser` is not a mining laser.** Its `cat` is `utility`, its display name is literally `"Deep Scanner"`, and its only stat is `scan_range_pct: 35` ([item_system.js:45](src/modules/item_system.js:45)). It's a duplicate scanner with a misleading key. Deleting it is right, for the wrong reason.

---

## 3. The Refining Contradiction (needs a number from you)

Refining is already half-built, and the halves disagree.

- [drones.js:51-54](src/game/drones.js:51) — `orePerBar: 2`. Two ore become one bar, stored in `s.refinedBars`.
- [station_store.js:73](src/modules/station_store.js:73) — `BAR_BASE_VALUE = { copper: 60, silver: 180, gold: 480, platinum: 1200 }`, i.e. **exactly 2× the raw ore value** in `CONFIG.rings`.
- [station_store.js:66](src/modules/station_store.js:66) — comment: *"Stations trade in refined bars only — never raw ore."*
- [economy.js:52](src/game/economy.js:52) — `sellOre()` sells raw ore directly, at full ring value.

Two problems fall out:

**Refining is currently pointless.** 2 copper ore (30 + 30 = 60cr raw) → 1 copper bar (60cr). Break-even, minus your time. Nobody would ever refine.

**Bars exist only to feed drone construction.** There is a `buyBar()` but **no `sellBar()`**. You cannot sell a bar today.

The fix is sitting unused in the ore DB: `raw_sell_penalty: 0.35` ([item_system.js:116](src/modules/item_system.js:116)). Apply it and the loop works:

| | raw sale | refine → bar sale |
|---|---|---|
| 2× copper ore | 2 × (30 × 0.35) = **21cr** | 1 bar = **60cr** |
| 2× platinum ore | 2 × (600 × 0.35) = **420cr** | 1 bar = **1200cr** |

Refining becomes a ~2.9× multiplier, paid for with the `refine_cost` and `refine_time` already in the DB. Selling raw becomes the impatient player's option — which is exactly the "sell them or refine them" choice you described.

**→ Open Question: confirm 0.35 as the raw-ore penalty, or give me a different number.** Everything else in WI-14 follows from it.

---

## 4. Work Items

### WI-1 — Sever rock mining *(headline change)*

Shooting a rock deals damage and produces nothing.

- **[player.js:150-172](src/game/player.js:150)** `fireAtRock()` — delete the `if (rock.hp <= 0) this.mineRock(idx)` branch. Rock at 0 HP: particle burst, sfx, `respawnRock(idx)`, no yield. Destroying a rock is a pure loss.
- **[economy.js:31-37](src/game/economy.js:31)** — delete `mineRock()`. Verify no other callers.
- **[input.js:54-65](src/core/input.js:54)** `pickRockAt()` — keep manual rock lock (you asked for it), but it must stay below alien and grabbable in the tap-resolve order so it never auto-acquires. The current fall-through already does this; confirm it survives.
- **HUD** — a locked rock's reticle should read `NO YIELD`. The player must learn the rule from the UI, not from wasted fuel.

### WI-2 — Sever junk salvage-by-shooting

- **[economy.js:38-42](src/game/economy.js:38)** — delete `bustJunk()`. Verify no other callers.
- The only junk → salvage path becomes `depositTows()` → `rollJunkDrop()` ([economy.js:15-18](src/game/economy.js:15)). That path is already correct.

### WI-3 — Towed bodies are immune to all damage

Per your decision. Applies to rocks and junk currently in `s.tows`.

- Add `GAME.isTowed(arr, i)` guard (V3 had one — port the pattern).
- Gate: missile AOE target collection ([combat.js:283-291](src/modules/combat.js:283)), `fireAtRock`, alien fire, and the rock↔ship / rock↔rock collision passes in [physics.js](src/core/physics.js).
- Towed bodies should also not collide with the player's own hull — hauling your cargo must never hurt you.

### WI-4 — Add per-weapon fire rate

All three weapons currently fire at 1200ms. `combat.js:159-164` already falls back to `DEFAULT_FIRE_MS` when `fireRate_ms` is absent, so the plumbing exists — the field just was never authored.

Add `fireRate_ms` at [item_system.js:64-66](src/modules/item_system.js:64). Proposed (`weaponDmg` base = 10):

| weapon | fireRate_ms | fuel/shot | fuel/sec | dmg vs strong layer | DPS strong | dmg per fuel |
|---|---|---|---|---|---|---|
| laser | **400** | 8 | 20.0 | 16 (shield) | 40.0 | 0.80 |
| cannon | **1000** | 5 | 5.0 | 16 (armor) | 16.0 | 3.20 |
| missile | **2200** | 3 | 1.4 | 22 (all) | 10.0 | 7.33 |

**Missile multipliers must rise from `1.0/1.0/1.0` to `2.2/2.2/2.2`.** "Equal against all three" constrains the *ratio*, not the magnitude. At 2200ms and 10 damage the missile is strictly worse than everything and nobody equips it. At 2.2 with `AOE_FACTOR 0.40` splash across 3 targets it lands near 18 DPS — the intended "slow, cheap, hits the group" identity.

The result reads cleanly: **laser is the fuel-hungry shield-shredder, cannon is the efficient armor-breaker, missile is the cheap patient crowd weapon.**

### WI-5 — Fix weapon ranges

Currently `laser 600, cannon 1000, missile 400`. The slow standoff splash weapon has the **shortest** reach in the game.

Proposed: **laser 600, cannon 900, missile 1400.**

### WI-6 — Remove missile ammo

`ammo: 20` ([item_system.js:66](src/modules/item_system.js:66)), consumed at [combat.js:238](src/modules/combat.js:238). You never mentioned ammo, and low fuel cost is already the missile's economic lever. Two limiters on one weapon is one too many.

- Set `ammo: null`. Leave the `ammoLimited` branch in `combat.js` — harmless, and useful later for mines.
- **Breaks [item_system.js:483](src/modules/item_system.js:483)** (`missile.ammo === 20`). Update.

### WI-7 — Repair modules consume fuel

Today `tickSkills` fires `skill_fn` on cooldown with **no cost at all** ([equipment_system.js:323-335](src/modules/equipment_system.js:323)). Free infinite healing.

- Add `fuel_cost` to the skill descriptor on `shield_regen_module` and `armor_repair_module`.
- In `tickSkills`, gate the fire: if `ship.fuel < fuel_cost * ship.fuelCostK`, skip the tick (do **not** re-arm the cooldown) and surface a `reason: "insufficient fuel"` so the HUD can flash the skill button.
- Deduct `fuel_cost * ship.fuelCostK` on a successful fire, mirroring `fireWeapon` at [combat.js:242-247](src/modules/combat.js:242).
- `fuel_eff_pct` (Usage Reduction) therefore discounts repairs *and* weapons — one stat, two jobs. Good.

Proposed: **Shield Repair** 25 shield / 6s / 10 fuel. **Armor Repair** 20 armor / 8s / 14 fuel. Armor is slower and dearer to fix than shield — it should be.

### WI-8 — Passive regen: keep shield's, deny armor's

This is the mechanical heart of the tank identities you described, so it needs stating explicitly.

- `baseShip.shieldRegen: 5` with `shieldDelay: 3.0` ([config.js:30](src/core/config.js:30)) — **keep.** Shields regenerating for free, slowly, once you break contact, is what makes a shield a shield. The Shield Repair module is the *fast, fuel-priced* version you use mid-fight.
- `baseShip.armorRepair: 0` ([config.js:31](src/core/config.js:31)) — **keep at zero.** Armor never regenerates on its own. The only way to restore it is the Armor Repair module, paying fuel.

Consequence, and it's the right one: **the shield tank is self-sustaining but soft; the armor tank is durable but must pay fuel to stay that way.** That is precisely the split you asked for, and it falls out of two existing constants.

- **Delete** the passive-regen items `shield_booster` (`shield_regen: 6`) and `armor_repairer` (`armor_repair: 4`) — they'd hand out for free what the repair modules charge fuel for.
- Keep `shield_regen` / `armor_repair` as **affixes** so rare+ gear can grant a trickle. That's a perk, not a module.

### WI-9 — Hardeners

Both resist stats already exist and are wired: `shield_resist` → `res.shield`, `armor_resist` → `res.armor`, additive fractions capped at `RESIST_CAP = 0.75` ([equipment_system.js:36,40,61](src/modules/equipment_system.js:36)). Two items already carry them.

- `shield_hardener` (`shield_resist: 12`) — **keep**, it's exactly your Shield Hardener.
- `armor_coating` (`armor_resist: 10`) — **keep, rename to `armor_hardener`** for symmetry.
- Per your "stacked perk" note: put `shield_resist` / `armor_resist` in the affix pools of defensive gear so **rare+ rolls can grant resistance on top of their base stat**. The tier system already supports this — normal gets 0 specials, rare 1-2, unique 2-3, elite 4-5 ([item_system.js:29-34](src/modules/item_system.js:29)) — so resistance naturally concentrates on unique/elite drops without any new machinery. **No special-casing by rarity is needed; just seed the pools.**
- Watch the 0.75 cap: hardener + two resist affixes could floor incoming damage at a quarter. That's probably fine as a chase build, but it's worth a playtest note.

### WI-10 — Prune the catalogue: 32 bases → 16

**KEEP (16):**

*Weapons (3)*
| module | key | change |
|---|---|---|
| Laser | `laser` | + `fireRate_ms: 400`, range 600 |
| Cannon | `cannon` | + `fireRate_ms: 1000`, range 900 |
| Missile | `missile` | + `fireRate_ms: 2200`, dmg ×2.2, range 1400, `ammo: null` |

*Defense (6)*
| module | key | stat | fuel? |
|---|---|---|---|
| Shield Boost | `shield_extender` | `shield_cap_pct: 20` | no |
| Armor Boost | `armor_plate` | `armor_hp: 40` | no |
| Shield Hardener | `shield_hardener` | `shield_resist: 12` | no |
| Armor Hardener | `armor_hardener` *(renamed from `armor_coating`)* | `armor_resist: 10` | no |
| Shield Repair | `shield_regen_module` | 25 shield / 6s | **10 fuel** |
| Armor Repair | `armor_repair_module` | 20 armor / 8s | **14 fuel** |

*Utility (5)*
| module | key | stat |
|---|---|---|
| Tractor Beam Range | `tractor_range` | `tractor_range_pct: 25` |
| Scan Range | `ore_scanner` → rename **"Survey Scanner"**, recat `mining`→`utility` | `scan_range_pct: 40` |
| Engine Enhancement | `engine_booster` | `thrust_pct: 20` |
| Usage Reduction | **NEW** `fuel_regulator` | `fuel_eff_pct: 20` |
| Additional Tow Slots | `tractor_slots` | `tractor_slots_flat: 1` — **broken, see WI-11** |

*Propulsion (2)*
| module | key | stat |
|---|---|---|
| Fuel Cell | `fuel_cell` | `fuel_cap_pct: 25` — strip `cargo_weight_pct` from pool |
| Solar Wing | **NEW** `solar_wing` | `solar_regen: 1.5/s` — **stat doesn't exist, see WI-12** |

**DELETE (18):**
- *Cargo / mining:* `cargo_expander`, `ore_refinery`, `mining_laser`, `tractor_beam_upgrade`
- *Free regen (superseded by fuel-cost repairs):* `shield_booster`, `armor_repairer`
- *Redundant duplicates:* `survey_scanner`, `afterburner`
- *Hull gear (no hull modules by decision 4):* `hull_plating`, `hull_repair_kit`, `hull_repair_module`
- *Unwired tractor stats:* `tractor_lock`, `tractor_drag`, `tractor_capacity`
- *Out of scope:* `turret`, `mine_layer`, `nav_computer`, `fuel_cell_module`

Sixteen modules, six slots. You cannot have everything — which is the point.

### WI-11 — Wire up `tractor_slots_flat` (it is currently dead)

"Additional Tow Slots" is in your list, the item exists — and **equipping it does nothing.** `tractor_slots_flat` is not in the engine's `ATTRS` table ([equipment_system.js:32-59](src/modules/equipment_system.js:32)), and `applyItemsToStats` silently ignores unknown keys ([equipment_system.js:258](src/modules/equipment_system.js:258)).

- Add `tractor_slots_flat: { affects: "tractorSlots", unit: "flat", dir: 1 }` to `ATTRS`.
- Add `tractorSlots: 3` to `baseShip`; the current base tow count lives at `CONFIG.baseTows: 3`.
- Make the tow-grab code read `derived.tractorSlots` instead of `CONFIG.baseTows`.

### WI-12 — Add the `solar_regen` stat

`CONFIG.solarRegen: 2` / `solarMax: 25` exist ([config.js:18](src/core/config.js:18)) and drive the dry-tank trickle at [player.js:85](src/game/player.js:85), but they are **global constants, not ship stats.** No module can touch them.

- Add `solarRegen: 2` to `baseShip`; add `solar_regen: { affects: "solarRegen", unit: "perSec", dir: 1 }` to `ATTRS`.
- Change [player.js:85](src/game/player.js:85) to read `s.derived.solarRegen`.

With weapons *and* repairs both drawing the shared fuel pool, solar regen becomes a genuine combat-sustain stat. That's a nice consequence of the one-pool decision.

### WI-13 — Add the identify system *(new feature — none exists)*

I grepped all of `src/`: **zero occurrences of "identif".** V3 had this and it was dropped in the v4 rewrite. Your description — "unidentified junk and space rocks in the base inventory" — requires porting it back.

- Ore stacks (`s.ore[type]`) gain an `identified` flag; salvage items (`s.inventory[]`) gain one too.
- Deposited tows arrive **unidentified**. Alien drops arrive **identified** (they're pulled off a known ship).
- Gate: unidentified ore cannot be sold or refined; unidentified modules cannot be equipped.
- Station bay: `identify(id)` and `identifyAll()`. V3's `identifyAll` ([game_v3_updated.html:926](game_v3_updated.html:926)) is a clean reference.
- Unidentified items render with rarity hidden and stats masked.

**Open question:** V3's identify was free. Should it cost credits, or scale with rarity? A free "Identify All" button is a click-tax with no decision in it.

### WI-14 — Refining as a station service

Per decision 3 and the analysis in §3.

- **No ship module.** Delete `ore_refinery`, delete the `refine_yield_pct` affix, delete `refineYield` from `baseShip` and `ATTRS`, and remove the `refineYield` term from `oreUnitValue` ([economy.js:48](src/game/economy.js:48)).
- **Apply `raw_sell_penalty`.** `sellOre()` multiplies by `0.35` (pending your confirmation). This is what makes refining worth doing.
- **Add `refineOre(type, qty)` as a station action.** Reuse `DRONES.orePerBar: 2` and the `refine_cost` / `refine_time` already in `DB.ore`. Gate on `identified`.
- **Add `sellBar(type, qty)`.** It does not exist. `buyBar` does ([station_store.js:265](src/modules/station_store.js:265)); mirror it. Bars sell at `BAR_BASE_VALUE`, buy at `× MARKUP`.
- Reconcile [station_store.js:66](src/modules/station_store.js:66)'s *"never raw ore"* comment with the fact that we **do** sell raw ore, at a penalty. Update the comment.
- `s.refineBonus` (set when a station is home, [economy.js:49](src/game/economy.js:49)) should now apply to the **refine yield or bar price**, not the raw ore price.

### WI-15 — Delete the cargo system

Pure cleanup; nothing reads any of it.

- **[config.js:37-38](src/core/config.js:37)** — remove `cargoMax`, `cargoWeightK`; **[config.js:36](src/core/config.js:36)** — remove `oreYield`, `miningSpeed`.
- **[equipment_system.js:47-48,52-53,73-74](src/modules/equipment_system.js:47)** — remove `cargo_cap_pct`, `cargo_weight_pct`, `ore_yield_pct`, `mining_speed_pct` from `ATTRS` and the stat defaults.
- **[item_system.js:73-107](src/modules/item_system.js:73)** — remove the same four from `DB.attributes`, plus `refine_yield_pct` (WI-14).
- Strip those affixes from every surviving item's `affix_pool` — they appear in `armor_plate`, `hull_plating`, `fuel_cell`, `tractor_beam_upgrade`, `cargo_expander`, `ore_refinery`.
- **[inventory_ui.js:61](src/modules/inventory_ui.js:61)** — remove the affix display labels.
- Confirm `s.inventory` has no length cap anywhere. (It doesn't today — unlimited is already the behavior.)

### WI-16 — ~~Resolve the slot-model contradiction~~ → superseded

**There is no contradiction. The 10-slot model lives in dead code.**

`inventory_ui.js` defines the typed 10-slot rack, and it is **never initialized** — `initInventory()` has zero callers. The live game already runs a flat 6-slot rack ([ui.js:47](src/game/ui.js:47)). The dead module's selfTest keeps passing, which is why it looked alive.

**This is no longer blocking, and WI-10 can proceed immediately.** See `ENGINE_GAME_BOUNDARY.md` → **SL-1** (delete the module), **SL-2** (strip the vestigial `slot` field from items), **SL-3** (move `equipSlots: 6` from the engine into `CONFIG`).

The catalogue prune (WI-10) should be merged with **EN-1** of that doc — extracting the catalogue to `src/content/` and pruning it to 16 is one edit, not two.

### WI-17 — selfTest updates

These break. Each needs updating in the same change:

| file:line | asserts | broken by |
|---|---|---|
| [item_system.js:469](src/modules/item_system.js:469) | `bases === 32 && attributes === 34` | WI-10, WI-15 |
| [item_system.js:483](src/modules/item_system.js:483) | `missile.ammo === 20` | WI-6 |
| [item_system.js:448](src/modules/item_system.js:448) | `rollDrop("junk_panel")` in pool | pools shrink |
| [equipment_system.js:448-449](src/modules/equipment_system.js:448) | mid-in-slot-5, high-in-slot-3 | SL-2 |
| [equipment_system.js:458](src/modules/equipment_system.js:458) | `fuel_cell` fixture | affix pool changes |
| [equipment_system.js:587](src/modules/equipment_system.js:587) | `mining_laser` non-weapon fire fails | item deleted |
| ~~`inventory_ui.js` (3 tests)~~ | — | **deleted wholesale by SL-1** |

Per `ENGINE_GAME_BOUNDARY.md` → **EN-8**, the surviving engine selfTests should not be *patched* to match the new catalogue. They should be **rewritten against synthetic fixtures** (`test_widget`, not `mining_laser`), so that no engine test asserts on Space Hauler content ever again.

New coverage for the rules being established:

- Shooting a rock to 0 HP grants **no ore**; `s.ore` untouched.
- Shooting junk grants **no item**; `s.inventory` untouched.
- Towing a rock and depositing **does** grant ore, **unidentified**.
- Towing junk and depositing **does** grant a salvage item, **unidentified**.
- A towed body takes **zero damage** from missile splash, enemy fire, and collision.
- Laser fires 2.5× as often as cannon, 5.5× as often as missile.
- Firing with `fuel < fuelPerShot` is refused.
- Shield Repair with `fuel < fuel_cost` **does not fire and does not consume the cooldown**.
- Armor never regenerates passively; shield does, after `shieldDelay`.
- `tractor_slots_flat` raises `derived.tractorSlots`.
- `solar_regen` affix raises `derived.solarRegen`.
- Unidentified ore cannot be sold or refined; unidentified module cannot be equipped.
- 2 ore → 1 bar; bar sells for more than 2 raw ore.
- Resist stacking is capped at 0.75.

### WI-18 — Docs and rebuild

- `HARNESS:HEADER` in `build.py` (~lines 51-52) and the generated `game.html`.
- `ROADMAP.md`, `LEDGER.md` entry. `V3_SPEC.md` should be marked superseded.
- Run `python3 build.py` to regenerate `game.html`.

---

## 5. Sequencing

WI-16 gates the catalogue. Land the safe refactors first, the feel-changing ones last.

1. **WI-16** — settle 6 generic slots vs 10 typed. *Blocking.*
2. **WI-15** — delete cargo stats/affixes. Safe; nothing reads them.
3. **WI-10** — prune catalogue to 16. Depends on 1 and 2.
4. **WI-11, WI-12** — wire `tractor_slots_flat` and `solar_regen`. Makes two of the 16 actually function.
5. **WI-4, WI-5, WI-6** — fire rates, ranges, ammo.
6. **WI-7, WI-8, WI-9** — fuel-cost repairs, regen split, hardeners.
7. **WI-13** — identify system.
8. **WI-14** — refining service, `sellBar`, raw-ore penalty.
9. **WI-3** — towed-body immunity.
10. **WI-1, WI-2** — sever rock mining and junk busting. *The headline change.*
11. **WI-17** — selfTests.
12. **WI-18** — docs + rebuild.

Steps 2-6 are contained refactors. Steps 9-10 change how the game feels and should land once the tests around them exist.

---

## 6. Remaining Open Questions

**1. Raw-ore sell penalty.** Confirm `0.35` (raw ore sells at 35% of value; refining is a ~2.9× multiplier), or supply a different number. Blocks WI-14.

**2. Identify cost.** Free, flat fee, or scaled by rarity? A free "Identify All" button is a click-tax with no decision in it. I'd lean toward a small per-item fee scaling with rarity, so identifying a big haul is itself a budget choice.

**3. Resist cap interaction.** Hardener module + two resist affixes could floor incoming damage at 25% (`RESIST_CAP = 0.75`). Intentional chase build, or should the cap come down to ~0.60?

**4. `shieldDelay` and repair modules.** If Shield Repair fires while `shieldDelay` is still counting down from a hit, does it work? I'd say **yes** — that's the whole point of paying fuel for it, and it cleanly distinguishes the active module from the free passive regen. Confirming.
