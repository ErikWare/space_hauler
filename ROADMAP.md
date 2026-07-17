# Space Hauler — Game Roadmap

This is the Space Hauler game roadmap. It is separate from the forge engine.
Forge = reusable LLM-built modules. Space Hauler = the game that uses them.
Do not couple them. Game-specific logic stays in space_hauler/, engine stays in forge/.

---

## V1 — Ship (current integration)

The v4 integration wires all 9 forge modules into the game:
- 3-layer Shield / Armor / Hull health system
- Tap-to-thrust vector control (ship orients toward tap, hold to charge)
- Full HUD: damage bars, skill buttons, weapon indicator, warp button, rep pip
- Station store: random stock, buy/sell, home switching
- Item system: 20 base types, 4 tiers (Normal/Rare/Unique/Elite), 26 affixes
- Weapons: Laser (high shield dmg), Cannon (high armor dmg), Missile (balanced AoE)
- Skill slots: Shield Regen, Armor Repair, Fuel Cell — activatable loops with cooldown
- 8 stations across 12k×12k world, discovery system
- Warp gate network: buy gates (1k→64k), jump UI, warp tunnel animation
- 6 nebula clouds: boosted loot tier, reduced scan range
- Three alien factions with group AI: Vex (laser/shield), Krag (cannon/armor), Nox (missile/hull)
- NPC miners: auto-collect ore, sell at nearest station
- Reputation system per station: sell = +rep, attack miners = −rep, outlaw = turrets fire
- Death/respawn: −100 credits, teleport to home station

This is a complete shippable game loop.

---

## V2 — World Feels Alive

### Phase 1 — World Density
*Can run in parallel with Phase 2.*

- Planets: increase 3 → 6–8, spread further, vary size and ring density
- Debris clusters: junk spawned near outer stations at world gen
- Outer asteroid belts: 1–2 extra belts far from origin, higher rarity ore, more alien activity
- Junk count: 60 → 120–160, spawned in clusters not uniform grid
- Enemy bases: 2–4 permanent hostile stations in distant sectors
  - Spawn patrol groups on a timer
  - Can be attacked and destroyed (large reward, temporary local pirate reduction)
  - Data: `{ id, x, y, faction, hp, maxHp, spawnCooldown }`
- Spatial culling: harden `isWorldVisible()` check to support higher object density without frame drops

### Phase 2 — Dynamic Encounter System (Skyrim-style)
*Can run in parallel with Phase 1.*

Random events that spawn near the player while flying. Makes dead space feel populated.

- Max 5–6 active encounters at a time
- Spawn at random angle, 650–2200 units from player
- Trigger on player approach (~450 units)
- Despawn after lifetime expires if not triggered

Encounter types:
- `pirate_ambush` — spawn a pirate group near player
- `faction_battle` — two factions spawn near each other and immediately aggro
- `derelict` — scatter several high-value junk items (great loot, no fight)
- `distress_signal` — enemies + small loot drop

Minimap: distinct icons per type (red circle = pirates, purple ring = faction battle, etc.)

Data model:
```js
{ id, type, x, y, life, resolved, vx?, vy?, data? }
```

---

## V3 — Economy Depth

### Phase 3 — Drone Trade System ✅ SHIPPED 2026-07-09
*Must precede Phase 5 (shared drone struct).*

Automated trade convoys launched from stations. Passive income with risk.

Drone tiers:
| Tier | Name       | Cost    | Materials          | Payout | Success | Fuel |
|------|------------|---------|--------------------|--------|---------|------|
| 0    | Basic      | 25cr    | 2 Copper           | 125cr  | 72%     | 80   |
| 1    | Reinforced | 60cr    | 3 Silver + 1 Gold  | 220cr  | 82%     | 120  |
| 2    | Armored    | 150cr   | 2 Platinum + 3 Gold| 450cr  | 91%     | 180  |

Mechanics:
- Convoy size: 1–5 drones launched together
- Escort bonus: player can fly with convoy for combat/speed boost
- Travel over time: `progress` 0→1 based on station distance + engineBonus
- Pirate encounters: each drone ~33% chance of attack during travel
- Partial loss: pirates disengage after destroying 2–3 drones (you almost always profit something)
- Fuel-based combat: if drone fuel reaches 0 it becomes helpless
- Loadout per drone: Weapon / Repair / Utility (3 slots, tier determines quality)

Drone data model:
```js
{ id, fromId, toId, progress, tier, payout, engineBonus,
  hp, maxHp, shield, maxShield, fuel, maxFuel,
  loadout: [{type, name, dmg, amount, fuelCost, fireRate}],
  wcd, rcd }
```

Refined materials economy:
- Ore → refined bars at station (70% efficiency)
- Bars required for Tier 1 and Tier 2 drones
- Creates loop: haul ore → refine → build better drones → earn passive income

UI: Drone Bay tab in station — tier cards with costs/payout, convoy size selector, escort checkbox, Launch button. Active drones shown on galaxy map as moving dots.

### Phase 4 — Mercenary Contracts
*Can run alongside Phase 3.*

Station contract boards. Gives the player goals and ties combat to reward.

Contract types:
- `faction_strike` — kill N ships of a specific faction
- `pirate_clear` — clear pirates from a sector
- `escort` — escort an NPC trader to a destination station
- `salvage` — collect N high-value junk items
- `bounty` — kill a specific named target
- `defense` — defend a station from a raid

Generation:
- 3–4 contracts per station dock
- Higher-tier/distant stations offer harder contracts and higher rewards
- Bounties difficulty 1–3: single elite / elite + support / Carrier Group (flagship + fleet)

HUD: small active contract box top-right — title + live progress. Visible every frame.

UI: Contracts tab in station bay — active contract at top with Turn In button, available contracts below with Accept buttons.

Data model:
```js
{ id, type, title, description, reward, stationId,
  targetFaction?, killsNeeded?, killsDone?,
  targetStationId?, amountNeeded?, amountDone?,
  difficulty?, targetKilled? }
```

---

## V4 — Fleet Command

### Phase 5 — Player Fleet ✅ SHIPPED 2026-07-09
*Requires Phase 3 drone struct.*

Up to 5 combat drones follow the player and fight alongside them.

- Assign/remove drones from `activeDrones` into `playerFleet`
- Formation offsets per index, lerp-based following with damping
- Combat AI: scan for nearby enemies, spread targets across fleet, prioritize elites/high HP
- Use weapon when in range + off cooldown
- Use repair module when HP low, back off while repairing
- Loadout editor: swap weapon/repair/utility modules from inventory or station stock
- Fleet tab in station UI: current fleet + HP bars + remove buttons + quick-assign

Visual distinction: fleet drones get different color trail vs trade drones.

### Phase 6 — Galaxy Map + NPC Traders ✅ SHIPPED 2026-07-09
*Pure visualization, starts after Phase 3 data exists.*

Galaxy map overlay:
- Faint trade route lines between all gated stations
- Moving dots: active trade drones + NPC traders
- Encounter icons on map
- Active contract markers

NPC Traders:
- Spawn from gated stations, travel trade routes (same data shape as miners)
- Attackable by player (piracy) and pirates (dynamic "save the convoy" moments)
- Drop credits or refined materials on death

---

### Phase 7 — Loadout Screen · Multi-Ship · Fleet Roles ✅ SHIPPED 2026-07-10
*Overhauls how modules are built, managed, and applied to ships.*

- LOADOUT screen replaces the gear tab: ship-portrait carousel over all owned
  ships AND fleet drones, 6 flat slots around the portrait, tap-for-detail with
  stat DELTA previews ("if equipped" / "if unequipped"), full stat readout.
- Multi-ship: `CONFIG.hulls` (Vulture starter / Atlas Freighter / Aegis
  Warhauler) bought at the hangar for credits + refined bars; per-ship loadouts
  persist; SET ACTIVE swaps the live rack (docked only).
- Fleet roles: own 5 drones, 3 fly as escorts, the rest idle in the hangar or
  run trade routes. FLEET tab is the role command board; drone module refits
  (now reversible) live on the loadout screen.
- Hangar = build & buy (shipyard + drone works + refinery).

---

## Parallel Execution Notes

| Phase | Depends On | Can Run With |
|-------|-----------|--------------|
| 1 World Density | v4 complete | Phase 2 |
| 2 Encounters | v4 complete | Phase 1 |
| 3 Drone Trade | v4 complete | Phase 4 |
| 4 Contracts | v4 complete | Phase 3 |
| 5 Player Fleet | Phase 3 (drone struct) | Phase 6 |
| 6 Galaxy Map | Phase 3 (data) | Phase 5 |

---

## Source Documents

- `uploads/FUTURE_ENHANCEMENTS_DETAILED.md` — encounters, contracts, fleet, bounties
- `uploads/ENHANCEMENTS_DRONE_TRADE_AND_WORLD.md` — drone trade system, world density

---

*Keep this file updated as features ship. Architecture decisions go in LEDGER.md.*
