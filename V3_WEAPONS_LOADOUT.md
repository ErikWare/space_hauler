# V3 Weapons & Loadout — How It Actually Works

Reference extracted from `game_v3_updated.html` (2675 lines). No code changed. Line numbers are that file.

---

## 1. The One Big Idea

**There is no separate weapon system.** Weapons are just salvage modules that happen to carry an `active` block. The ship has no innate gun — at level 0 you are unarmed, and you stay unarmed until you find, identify, and equip an active module. Everything (player weapons, alien weapons, repair drones, tractor-range perks) flows through the same `CONFIG.modules` table and the same 6 equip slots.

```
debris/alien/store  →  salvage item  →  identify  →  equip into 1 of 6 slots
                                                          │
                                        ┌─────────────────┴─────────────────┐
                                   has `primary`                       has `active`
                                   (PASSIVE)                           (ACTIVE)
                                        │                                   │
                                 affixes feed                        becomes a toggleable
                                 recomputeEff()                      SKILL SLOT on the HUD
```

Consequence worth naming up front: **the 6 slots are a shared budget between combat and hauling.** Every weapon or repair drone you carry is a fuel tank, tractor coil, or tow-slot clamp you gave up. That tension is the whole build-crafting game in V3.

---

## 2. Module Catalogue (`CONFIG.modules`, line 272)

14 archetypes. Nine passive, five active.

**Passive — each has one `primary` affix stat:**

| key | name | primary stat | base value |
|---|---|---|---|
| `coil` | Tractor Coil | BEAM | 22 |
| `cell` | Fuel Cell | FUEL | 22 |
| `servo` | Tow Servo | TOW | 26 |
| `ion` | Ion Thruster | THRUST | 26 |
| `scanner` | Deep Scanner | SCAN | 18 |
| `plate` | Ablative Plate | ARMOR | 24 |
| `wing` | Solar Wing | SOLAR | 20 |
| `clamp` | Grav Clamp | SLOT | 40 |
| `assay` | Assay Chip | VALUE | 20 |

**Active — each has an `active` block instead of a primary:**

| key | name | type | cooldown | damage / heal | speed | homing |
|---|---|---|---|---|---|---|
| `laser` | Laser Array | weapon | 0.45s | 6 | 900 | no |
| `cannon` | Rail Cannon | weapon | 1.30s | 24 | 560 | no |
| `missile` | Missile Pod | weapon | 2.00s | 40 | 340 | **yes** |
| `hulldrone` | Hull Repair Drone | repairHull | 3.0s | +12 HP | — | — |
| `shieldcell` | Shield Charger | repairShield | 2.0s | +16 shield | — | — |

Sustained DPS before crits: laser 13.3, cannon 18.5, missile 20.0. The missile is strictly the best sustained damage *and* it homes — its only real cost is that a 340-speed projectile with a 1.4s life travels a short distance (see §6).

---

## 3. Rarity — and the Trap Inside It

`CONFIG.rarities` (line 249):

| rarity | drop weight | affix magnitude | sell mult | extra affixes |
|---|---|---|---|---|
| Normal | 58 | ×1.0 | ×1.0 | 0 |
| Rare | 27 | ×1.6 | ×2.5 | 1 |
| Unique | 12 | ×2.4 | ×6.0 | 2 |
| Elite | 3 | ×3.6 | ×16.0 | 3 |

`makeSalvage()` (line 876) branches:

- **Passive** gets its primary affix at full magnitude (`base × mag`), *plus* `extra` secondary affixes.
- **Active** gets `dmg` (or heal `amount`) scaled by `mag`, and cooldown shortened by `cd × (1 − 0.06 × rarityIndex)`. It gets **no primary affix.**
- **Both** then roll `extra` secondary affixes from `secondaryStats` (the 8 non-SLOT stats), each at **half** magnitude, summed on collision.

Two things fall out of this that are easy to miss:

**A normal-rarity weapon is a statless brick.** It has zero affixes — the `else` branch that pushes the primary is skipped, and `extra` is 0. It does damage and nothing else. A normal Fuel Cell, by contrast, gives +40 max fuel.

**Rarity scales weapon damage 3.6× but cooldown only 18%.** Elite cd multiplier is `1 − 0.06×3 = 0.82`. So an Elite Missile Pod is 40→144 damage on a 2.00→1.64s cycle: 20 DPS → 87.8 DPS. That is a 4.4× power swing on a 3-in-100 drop. Rarity on weapons is *enormously* more impactful than rarity on passives, which top out around ×3.6 on a linear stat.

---

## 4. Effective Stats (`recomputeEff`, line 836)

Base ship (line 232): `beamR 170, tank 100, towK 0.50, thrust 1.0, accel 1100, impulse 560, scanR 700, tows 3, solar 2, damageMul 1, shield 50`. Hull max is a separate constant, `hpMax: 100`.

Recompute walks every equipped **identified** item's affixes and applies:

- `BEAM`, `FUEL`, `SCAN`, `SOLAR`, `SLOT` — additive
- `TOW` — `towK *= (1 − val/100)`, floored at 0.05 (multiplicative, so it stacks with diminishing returns)
- `THRUST` — `thrust += val/100`
- `ARMOR` — `damageMul *= (1 − val/100)` (also multiplicative — never reaches zero)
- `VALUE` — `valueMul += val/100`

It's called on equip, unequip, identify, and identifyAll. Shrinking the tank by unequipping a Fuel Cell clamps current fuel; same for shield.

Three dead-code notes:

- **`case "SHIELD"` (line 851) is unreachable.** There is no `SHIELD` entry in `affixDefs` and it isn't in `secondaryStats`, so no item can ever roll it. Max shield is hardcoded at 50 forever. If we want shield to be buildable, this is the hook that's already waiting.
- **`CONFIG.junkHp: 14` (line 235) is never read.** Debris dies to any single projectile hit — `bustJunk()` is called unconditionally on contact.
- **`CONFIG.weaponRange` (line 341) is only consulted by alien AI** (line 1211). The player's weapons have *no range gate* at all.

---

## 5. Skill Slots — the HUD Layer

An equipped module with `active` automatically becomes a skill slot. `skillSlots()` (line 961) returns the equip-slot indices holding actives, in slot order. `skillButtons()` (line 1843) lays them out as a left column of 48px squares starting at y=156.

**Keys 1–6 index the skill list, not the equip slot.** Line 2329: `GAME.skillButtons()[+e.key - 1]`. So if your only weapon is in equip slot 5, it's key `1`.

Toggle semantics (`toggleSkill`, line 964):

- **ON** → fires/heals *immediately*, then sets `cd` to full. `updateSkills()` (line 996) decrements `cd` each frame and re-executes whenever it hits zero, carrying the overshoot forward (`cd += active.cd`).
- **OFF** → `cd = 0`, loop stops.

So a skill is a latch, not a trigger. Tap once, it runs forever.

**Nothing is spent.** Firing costs no fuel, no ammo, no heat, no charge. Repairing costs nothing either. The only limiter on an active module is its cooldown and the slot it occupies. Two consequences we should have an opinion on:

1. **Hull Repair Drone + Shield Charger = 4 HP/s + 8 shield/s, permanently, for free.** Two slots buys near-immortality against minions.
2. **A toggled-on laser is an item printer.** Debris has no HP, dies to one hit, respawns immediately (`respawnJunk`), and yields a fresh `makeSalvage()` roll. A 0.45s-cooldown laser pointed at a debris field mints a salvage module every 0.45 seconds, forever, with a 3% Elite chance each.

Also note `executeSkill` heals hull to `CONFIG.hpMax` (100) but shield to `s.eff.shield` — hull cap ignores any future scaling.

---

## 6. Firing (`fireWeapon`, line 979)

Targeting priority:

1. If there is a **fully-locked live alien** (`lockedAlien()`), aim at it. `seek = "alien"`. **No range check.** A locked alien 5000 units away still gets aimed at; the shot simply expires before arriving.
2. Else, if the weapon is **homing** (missile only), aim at the nearest non-towed rock. `seek = "rock"`.
3. Else, fire straight along `s.heading`.

The projectile spawns at nose offset `shipR + 6` = 22 units, and **inherits ship velocity**: `vx = s.vx + dx * speed`. It lives `projLife = 1.4s`.

That means effective range is `speed × 1.4 ± your own velocity` — laser ≈1260, cannon ≈784, missile ≈476. Compare `CONFIG.weaponRange` which claims laser 620, cannon 520, missile 900. **Those numbers describe alien behavior, not player reality, and they're roughly inverted from it.** The missile — nominally the long-range weapon — has by far the shortest player reach; homing is what saves it. Worth deciding whether that's intent or drift.

Velocity inheritance also means flying backwards while firing shortens your range, and boosting forward extends it. Nice emergent detail, probably unintentional.

---

## 7. Projectile Resolution (`updateProjectiles`, line 1017)

Homing steers each frame: `lerp` current velocity toward the target bearing at `min(1, 4×dt)`, preserving speed magnitude. Hostile homing always seeks the ship.

Collision is checked in strict priority, **first hit wins, projectile despawns** (no pierce, no AoE):

- **Hostile** → only the ship. `hullHit(dmg)` if `invuln <= 0`. Alien shots pass straight through rocks and debris.
- **Player** → aliens, then rocks, then junk.

**Crit and glance only roll against aliens** (line 1042). Rocks and debris always take flat damage.

- 18% crit → ×2.0
- next 22% → glance ×0.5
- remaining 60% → ×1.0
- Expected multiplier: **1.07×**

Hitting an alien also `aggroGroup()`s the whole squad.

Rock HP is `mass × 16 + 8` (junk rock 24, platinum 59). Killing a rock calls `mineRock()` → ore straight into inventory, rock respawns. Killing debris calls `bustJunk()` → salvage straight into inventory, debris respawns.

**This is the economy question.** Weapon-mining bypasses the entire tow loop: no tractor beam, no leash physics, no tow-slot limit, no `towK` fuel penalty, no trip home. An equipped cannon converts the core game verb (haul) into a secondary one (shoot). Whether that's a feature or a bug is the biggest alignment decision on the table.

---

## 8. Aliens Use the Same Loadout System

`makeAlien()` (line 1144) builds a `loadout` array from the exact same `CONFIG.modules` entries.

Three factions (line 343), each = one weapon + one support mod:

| faction | weapon | support mod | tint |
|---|---|---|---|
| Cindren | laser | `shieldcell` | cyan |
| Ferrox | cannon | `plate` | gold |
| Vesper | missile | `hulldrone` | orange |

Two tiers (line 349) scale the *ship*, not the modules:

| tier | hp | shield | dmgMul | armor (`damageMul`) | speed | size | drops |
|---|---|---|---|---|---|---|---|
| minion | 46 | 26 | ×0.85 | 0.9 | 210 | 0.9 | 1 |
| elite | 130 | 80 | ×1.25 | 0.65 | 175 | 1.25 | 2 |

Groups are 1 elite + 2–3 minions (`spawnGroup`, line 1157), 4 groups seeded across the nebulae.

Where alien loadouts *diverge* from the player's:

- Weapon damage is scaled by `T.dmgMul` only — **no rarity roll**, no cooldown scaling.
- Repair mods tick on a **hardcoded 2.4s `rcd`**, ignoring the module's own cd (hulldrone's 3.0s and shieldcell's 2.0s are both discarded).
- **`plate` does nothing.** It's a passive with an ARMOR primary, but alien `damageMul` comes from the tier constant `T.armor`. Ferrox carries the plate purely so it can drop it. Cosmetic in combat, real as loot.
- Aliens *do* respect `CONFIG.weaponRange`; the player doesn't.

AI (`updateAliens`, line 1191): aggro at 700 units or on being hit, chase to a 260-unit standoff (back off below 0.7×, close above 1.15×), fire when in `weaponRange`, ram for 4 (+4 if elite) on contact.

Death (`alienDeath`, line 1171) drops `tier.drops` items sampled **without replacement** from its loadout, each re-rolled through `makeSalvage(null, arch)` for a fresh random rarity, and pre-`identified`. So an elite Vesper can drop a Missile Pod *and* a Hull Repair Drone, either of which might be Elite. Loot auto-collects within 46 units and expires after 90s.

---

## 9. Lock-On (`updateLock`, line 1224)

Tap an alien inside `eff.scanR` (base 700). Lock builds at:

```
rate = (0.55 + 0.85 × (1 − d/scanR)) / 1.6
```

- Point blank: 0.875/s → **1.14s to lock**
- At scanner edge: 0.344/s → **2.91s to lock**
- Out of range: decays at 0.625/s

Only at `lockProgress >= 1` does `lockedAlien()` return the target and weapons start auto-aiming. Scanner range therefore does double duty: it gates *what you can lock* and *how fast you lock it*. A Deep Scanner is a real combat module even though it has no damage number.

---

## 10. Loadout Lifecycle

**Acquisition** — four routes, one of which hands you identified gear:

| source | identified? |
|---|---|
| Tow debris home → `depositTows()` (line 904) | no |
| Shoot debris → `bustJunk()` (line 1012) | no |
| Alien drop → `alienDeath()` (line 1171) | **yes** |
| Station store, `buyMarkup` ×2.3 | (store stock) |

**Identify** — station bay only. `identifyAll()` reveals every ore stack and every module at once. Unidentified items contribute nothing: `recomputeEff` skips them, and `equipSalvage` refuses them ("identify it first").

**Equip** (`equipSalvage`, line 937) — DOM drag from inventory onto one of 6 slots. Swapping out an occupied slot turns off its skill and returns the old item to salvage. Both paths reset `on = false, cd = 0`, so you cannot preserve a hot cooldown by shuffling gear.

**Unequip** (`unequipSlot`, line 950) — returns to salvage, kills any running skill.

**Sell** — equipped items are unsellable (the `findIndex` at line 1080 only searches `s.salvage`). You must unequip first. Sell price is `arch.value × rarity.valueMul` — an Elite Missile Pod is 46 × 16 = **736 credits**, against a 4000-credit win condition.

---

## 11. Summary of Things That Look Like Drift

Collected for the review, not fixed:

1. **`CONFIG.weaponRange` is player-facing in name only.** Player range is `speed × projLife`, which gives roughly the inverse ordering of the stated ranges.
2. **Missile is the shortest-ranged player weapon** (~476 units) despite a nominal 900.
3. **`case "SHIELD"` in `recomputeEff` is unreachable** — no affix def, not in `secondaryStats`. Max shield is permanently 50.
4. **`CONFIG.junkHp: 14` is never read.** Debris is one-shot by anything.
5. **`plate` on Ferrox has zero combat effect** — alien armor comes from the tier constant.
6. **Alien repair mods ignore their own cooldowns**, using a flat 2.4s.
7. **Normal-rarity actives have no affixes at all** — the primary is skipped and `extra` is 0.
8. **Weapon rarity scales damage 3.6× but cooldown only 1.22×**, making Elite weapons a ~4.4× power spike versus ~3.6× linear for passives.
9. **Actives have no resource cost.** Toggle-on is permanent; free healing and a free salvage printer both follow.
10. **Weapon-mining bypasses the tow economy entirely** — ore and salvage go straight to inventory with no haul, no fuel, no slot limit.
11. **Hull repair caps at `CONFIG.hpMax`, shield at `eff.shield`** — inconsistent if hull ever becomes buildable.
12. **Number keys index the skill list, not the equip slot** — key `1` is your first *active* module wherever it sits.

Items 9 and 10 are the load-bearing ones. Everything else is a knob; those two are the shape of the game.
