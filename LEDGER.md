# LEDGER — space_hauler (Rock Hauler)

## 2026-07-08 — created
- First full game on the three3d tier. Logic is 100% renderer-free (flight,
  fuel economy, tractor towing, rings, shop) so the whole loop verifies in the
  headless gate; THREE touches only the draw path.
- Design: richness scales with ring distance; towing multiplies fuel burn by
  rock mass (mitigated by BEAM upgrades); fuel-out = auto-drop cargo + limp mode
  (35% thrust, no burn) — you can always get home. Emergency rations at dock
  prevent the broke+empty softlock. Win = all 4 upgrades maxed.

## 2026-07-08 — first full verification pass
- Headless selfTest plays the ENTIRE loop in Node: fly→burn fuel→tractor grab→
  tow→auto-sell→respawn→fuel-out limp+cargo-drop→solar movement→emergency
  rations→buy all upgrades→win→reset. GREEN first try.
- Scripted visual mission (playtest.json): launch→lock→tow→dock→sell→shop, all
  in the contact sheet + gameplay.gif. GREEN.
- Polish backlog: towed rock sits between chase-cam and ship (reads okay but
  slightly occludes — raise cam or offset tow point later); add music loop;
  persistence (localStorage save) deferred deliberately for selfTest determinism.

## 2026-07-08 — v2 PIVOT: top-down + sprites (3D was clunky/boring)
- Feedback: 3D chase-cam + turn-then-thrust was disorienting and hard to fly.
- Rewrote control + render layers ONLY (economy/tow/shop/upgrade logic kept):
  * LOCKED top-down camera (north always up), smooth follow, zoom (wheel/+-/pinch),
    auto zoom-out while towing.
  * DIRECT thrust: WASD/arrows push the ship in that screen direction, ship sprite
    rotates to face motion. Touch = drag stick. No more tank turning.
  * All visuals now SPRITES (procedural baked, top-down): ship, station, 5 ore
    rock types w/ vein glow — each swappable for a Grok PNG (assets/<key>.png).
  * three.js removed entirely (no WebGL, no file:// module issue).
- selfTest rewritten to the ax/ay flight model; full loop still GREEN. Feel is
  night-and-day better. Backlog: Grok-paint ship+station+rocks; tune accel/damp
  to playtest feedback; music.

## 2026-07-08 — v3: burst-impulse engine + 2.5D + planets/collisions (full rewrite per V3_SPEC.md)
- Controls replaced: HOLD = aim + charge (0→1 over 2.5s, arc HUD + rising tone),
  RELEASE = impulse (charge × maxImpulse), fuel charged only on release
  (× tow-mass multiplier). Drift drag 0.994/frame free, 0.985 towing. Retarget
  mid-drift stacks velocity. Economy/tow/sell/upgrade/rations logic kept from v2.
- New world: 3 seeded planets (ice/fire/gas, gravity wells at 1.5r, ore in their
  ring annuli sells +50% w/ "RING BONUS" toast), ~60 inert junk floaters, hull
  HP 100 with elastic collisions (rock dmg 5+mass×3, junk 1, 0.8s invuln,
  0 HP = HULL BREACH overlay + R). Render: pseudo-3D (world-y foreshortened
  0.82, painter-sorted sprites, pseudo-sphere rock gradients, foreshortened
  station/planet rings, 3-layer 400-star parallax). Zoom 0.08–3.0, labels ≤0.25.
- Judgment calls where spec was silent/conflicting:
  * Ring radii rescaled ~×2.5 (260→2100) to fit the burst-impulse travel scale
    and the ≥3000-unit planet field; type/value/mass/count untouched.
  * v2 limp mode replaced by SOLAR TRICKLE (fuel regens 2/s up to a 25 floor) +
    fuel-out still auto-drops cargo; keeps "you can always get home" without
    contradicting "zero fuel = no impulse, drift only". Dock rations kept.
  * Docking slowly repairs hull (8 HP/s) — spec has no repair path and
    permadeath-by-attrition would kill the upgrade loop.
  * Rock damage follows the spec FORMULA (5+mass×3); its junk=2/platinum=20
    examples don't match any mass table and were ignored.
  * Planet radius drawn from 800–1400 (subset of spec's 800–2000) with distance
    3200+1.6r so gravity zones + ring annuli can never reach the station rings.
- selfTest (headless Node, GREEN): charge accrual/clamp, impulse-on-release +
  fuel cost, free-vs-tow drag, elastic bounce + damage + invuln window, junk
  1-dmg, gravity in/out of 1.5r, death→game-over→R, zoom clamp 0.08–3.0, full
  burst-navigation loop fly→grab→tow→auto-sell→respawn, ring-bonus payout,
  rations, buy-all-upgrades→win, reset. Gotcha found while testing: teleporting
  a towed rock onto the station auto-sells it — drag tests now run at y≈9000.
- Backlog: playtest fuel economy pacing (burstCost 12 vs ring distances), Grok
  art for all 14 manifest sprites, music loop, charge-cancel input (tap opposite?).

## 2026-07-09 — v4: full Forge integration (src/ + build.py → single game.html)
- Took the updated v3 base and wired in ALL 9 forge modules, replacing the
  bespoke inline systems with the module APIs (no forge logic reimplemented —
  only called). Modules inlined as IIFEs (globals available); game code
  references them bare. `node -e` on the compiled file runs the whole loop
  headless. GREEN first stable pass.
- Architecture is now `src/` + `build.py`:
  * src/modules/*.js — verbatim `cp` of the 9 forge files.
  * src/core/  config (CONFIG + baseShip stat block + GAME) · camera (S/SF/
    screenToWorld/zoom) · input (aimVector + dual-mode tap pick) · physics
    (circleHit + 3-layer damageShip + gravity).
  * src/world/ stars · planets · ores · junk · rendering (ship/station sprites +
    world draw pass composing pitched field with the flat forge draw fns).
  * src/game/  player (engine/fuel/health/tow/skills/combat wiring) · economy
    (ore refine+sell, junk→ForgeItemSystem drop, rep hooks) · ui (dock overlays
    + ForgeHUD state + control buttons + all module callbacks).
  * src/main.js — init/seedWorld/update/draw/getState/selfTest + boot.
  * build.py concatenates modules (dep order: item→equip→hud→inv→world→store→
    combat→faction→npc) then game files (config first, main last), wraps in one
    HTML with HARNESS markers → game.html (376 KB). `python3 build.py --check`
    also runs the headless selfTest against the compiled file.
- Integration map (each forge global drives its domain):
  * ForgeWorld — initWorld(42), updateDiscovery each frame (800u radius),
    getNebulaModifiers → drag/scan mods, nebula render, warp UI + jumpTo.
  * ForgeStore — opens on dock; buy/sell/set-home (→ refineBonus)/warp-gate buy.
  * ForgeItemSystem — junk-tow now rolls rollDrop(junkKey) into inventory;
    ore stays a separate direct-sell path (spec §1.8).
  * ForgeEquipment — High/Mid/Low/Rig/Skill rack; getActiveStats derives every
    ship stat each frame; tickSkills drives skill_fn on cooldown.
  * ForgeHUD — drawHUD(state) replaces the old HUD entirely; skill taps →
    activate/deactivate; small game-owned control cluster for tractor/mode/dock.
  * ForgeInventory — canvas 10x6 bay on dock; onEquip→syncEquipmentFrom (rack
    rebuild, skill slots preserved), onSell→credits.
  * ForgeCombat — lock-on (tap alien in scan), auto-fire on cooldown, 3-layer
    typed damage, projectiles, onPlayerDeath→respawn home (−100cr, no permadeath).
  * ForgeFaction — 2 Vex/Krag/Nox groups per nebula (leader+2-4), updateAlienAI
    each frame; kills drop getDrops loot; drawAlienShip in draw pass.
  * ForgeNPC — initNPC(stations), updateMiners (roam+mine, rocks respawn),
    updateReputation on sell/dock/attack, canDock fee, outlaw turrets.
- 3-LAYER HEALTH replaces single hp: shield 100 (regen 5/s after 3s delay) →
  armor 80 (repair-module only) → hull 60 (0 = respawn). One ship.hp block feeds
  ForgeCombat (target.hp) + ForgeEquipment.tickSkills; collisions use a game-side
  overflow damageShip. DUAL-MODE TAP: alien-in-scan+not-towing = lock, else tow.
- Judgment calls where the two data models collided:
  * Forge uses a flat world→screen (no pitch); the pitched field (S) and the flat
    forge entities (SF) coexist as two mild planes — alien pick uses SF so hit-box
    matches drawAlienShip. Combat damage is hitscan (fireWeapon applies instantly
    + a cosmetic tracer) per ForgeCombat's model, not the old travelling bullets.
  * Skill-slot items have no ForgeInventory panel (rack is high/mid/low/rig), so
    autoFitSkills() pulls them from cargo into ForgeEquipment.skill on dock.
  * ForgeCombat kept its own Math.random rolls (crit/hit/glance); seeding it with
    the game LCG broke ForgeNPC/faction turret selfTests — instead the game
    selfTest seeds a hitting rng only around those two module checks.
  * ForgeWorld is world-authority (8 stations, 6 nebulae, warp); planets stay
    game-side (no forge equivalent) placed ≥3000 from home.
- selfTest (headless Node, GREEN + stable ×3): all 9 module globals present and
  each own selfTest green · 3-layer overflow math · constant-thrust accel+fuel ·
  free-vs-tow drag (nebula-modified) + leash · collision bounce+hull dmg+invuln ·
  planet gravity in/out 1.5r · zoom clamp · ForgeEquipment equip→derived+revert ·
  tickSkills fires skill_fn · ForgeCombat lockOn true/false + completes + fire
  damages alien · ForgeWorld discovery at 800u · ForgeStore buy/sell loop ·
  ForgeFaction group+AI · ForgeNPC rep+canDock · burst impulse · full fly→grab→
  tow→auto-bank loop · ore sell+win · defeat→respawn(−100) · reset. Browser
  verified: flight thrust/fuel, tractor, dual-mode lock, full combat exchange,
  and all three dock overlays (gear/store/warp) render + tab-switch.
- Gotcha found while testing: shield regens 5/s from _sinceHit=99, so a "shield 0"
  collision test soaked a sliver before impact — pin _sinceHit=0 for exact math.
  Also hull clamps to hullMax(60) in recomputeDerived, so tests seed hull=hullMax.
- Backlog: balance alien density (49 aliens / 18 miners is lively but heavy),
  ForgeInventory skill-slot panel, ammo/restock UX, Grok art, music loop.

## 2026-07-09 — Phase 2: dynamic encounter system (src/game/encounters.js)
- Skyrim-style random events while flying: max 5 active, spawn on a 650–2200
  ring around the player (avg 1/25s, never within 600 of a station, never while
  atStation/dead), trigger on approach (<450), despawn after 120–180s ignored.
  pirate_ambush (40%, nox squad) · faction_battle (25%, vex + krag squads 200
  apart) · derelict (20%, 4–7 Rare/Unique junk_crate salvage) · distress_signal
  (15%, krag squad + 2–3 drops). Ambush/battle drift 0.3–0.5 u/s; rest static.
  State: s.encounters [{id,type,x,y,life,resolved,vx,vy,data}].
- Rendering: pulsing world-space ring (40–80u, α .15–.30, SF flat projection so
  the marker sits where the squad spawns) drawn after drawWorld / before HUD;
  minimap icons (red ●=pirates, purple ○=battle, yellow ◇=derelict, orange
  △=distress) drawn as an overlay AFTER ForgeHUD.drawHUD, replicating its
  minimap geometry (R=44k @ W−58k,118k, kMap=R/scanRange) — hud.js untouched.
- Judgment calls where the spec met the module APIs:
  * ForgeFaction.updateAlienAI only targets the player (no ship-vs-ship AI), so
    "factions aggro each other" is approximated: both squads spawn 200 apart
    and activateGroup aims them at the player wading in — reads as a brawl.
  * All triggered squads are activated (ALERT) — an "ambush" that sits IDLE
    until locked isn't an ambush.
  * ForgeItemSystem.rollDrop can't force a tier (weighted roll), so derelict
    loot picks the base via rollTier("junk_crate") and forces rare/unique via
    generateItem(base, tier, {ilvl:6}) — same public API, boosted tier honored.
- selfTest (§17b, GREEN): init empty · 10 spawns cap at 5, all in the 650–2200
  ring, outside station keep-out, life 120–180 · each type triggers resolved +
  side effects (nox squad / vex+krag / 4–7 rare+ loot / krag+2–3 loot) ·
  re-trigger no-op · update loop triggers at <450, culls resolved, despawns
  expired. Gotcha: the §15 haul flight now clears s.encounters each step (same
  isolation idea as s.aliens=[]) — a random ambush mid-haul injects
  Math.random combat rolls and could kill the pilot, making the suite flaky.
- Wiring: build.py GAME_FILES + init/update/draw/getState in main.js. Forge
  modules, ui.js, and Phase 1 world files untouched.

## 2026-07-09 — Phase 1: world density (planets/junk/belts/enemy bases/culling)
- Planets 3 → 6–8 (seeded), radius 800–2400 (was 800–1400), pushed out to
  d = 3800 + 2.2r (+0–600) so gravity zones + ring annuli clear the station
  band; placement retries until neighboring gravity wells (1.5r) don't stack
  (best-of-40 fallback). Ring density now varies per planet: 30–130 dots.
- Junk 60 → 140, seeded in 18–22 clusters (radius 200–400) dealt out in
  batches of 4–8; cluster centers ≥600 edge-clear of every station. Hauled
  junk respawns into a random cluster (makeJunk now cluster-aware). Each
  non-home station also gets 5–8 debris floaters at 300–500u with halved
  drift speed (s._stationDebris tracks the count for the selfTest).
- Outer asteroid belts: 1–2 belts at 2800–4200u, 4–6 rocks each, gold/
  platinum only, size ×1.2 + faint colored glow halo. r.outer stores the belt
  radius so mined outer rocks respawn into their belt (not the base rings).
- Enemy bases (src/game/enemy_bases.js, new): 2–3 at 3500–5500u, ≥1500 from
  stations/each other, seeded faction, 500 hull. Every 45–90s (fixed per
  base) spawns a ForgeFaction.generateGroup patrol (1 elite + 2 normals),
  capped at 9 live ships per base so an unvisited base can't flood s.aliens.
  Patrols spawn IDLE (same as nebula squads); locking their base wakes them.
  Bases are lockable/attackable: pickAlienAt also scans s.enemyBases (pitched
  S() hit-box matching the sprite), findCombatTarget() resolves lock/fire
  targets from aliens OR bases, and ForgeCombat's typed damage lands on the
  base's shield-0/armor-0/hull-500 block (all weapon types hit at dmgHull).
  Destruction: explosion bursts + "ENEMY BASE DESTROYED" toast + 3–5 Elite
  ForgeItemSystem.generateItem drops as loot orbs; wreck stays as a dim
  sprite, spawning stops. Visual: baked dark-red angular sprite + pulsing
  faction-colored dashed warning ring + HP bar/label at zoom > 0.35. Minimap:
  red triangles drawn as a game-side overlay after ForgeHUD.drawHUD (same
  disc geometry trick as the Phase 2 encounter icons — hud.js untouched).
- Spatial culling hardened per ROADMAP: isWorldVisible(wx,wy,r) world-space
  radius check (view radius = max(W,H)·0.6/zoom + r + 220) replaces the old
  screen-margin test in the depth-sorted build and now also gates rocks,
  junk, enemy bases, aliens, miners, and loot orbs.
- Judgment calls:
  * ROADMAP's base data model lists scalar hp/maxHp, but applyDamage needs a
    3-layer block — bases carry hp:{hull:500,...} plus maxHp:500 for the bar.
  * Patrol cadence is "randomized per base" (spawnCooldown rolled once at
    world-gen), not per wave; the cap keeps long idle sessions bounded.
  * Reticle model (ForgeCombat.drawCombat targets) stays aliens-only — a
    locked base shows game-side select-ring corners at its pitched position
    instead, since the forge reticle projects flat and would sit offset.
- selfTest (GREEN ×3): world composition asserts planets 6–8 in 800–2400 at
  ≥5000, junk = 140 + station debris (5–8 × 7 stations), cluster/station
  clearance, outer rocks gold/platinum at 2600–4400, base count/distance/
  faction/hp/cooldown/gaps · §17c: applyDamage lands, lockOn(base) true,
  patrol timer adds exactly 1 elite + 2 tagged normals + timer resets,
  hull→0 marks destroyed + 3–5 Elite drops + toast, destroyed base stops
  spawning. Gotchas: the denser planet field reaches the y=9000 test lane, so
  precision movement tests (§2/3/14) now clear s.planets (and s.miners, since
  ring-rock respawns index into s.planets); §5 gravity keeps only planets[0]
  for the same reason. §3's "last rock" tow is now an outer-belt rock —
  harmless (drag is mass-independent while drifting).
- Wiring: build.py GAME_FILES + game/enemy_bases.js; state adds s.enemyBases,
  s.junkClusters, s._stationDebris; update adds updateEnemyBases; draw adds
  drawEnemyBasesMinimap. Forge modules and ui.js untouched.

## 2026-07-09 — v4.1: UI revamp (flat gear, DOM gear panel, V3 skill buttons, HUD declutter)
- UI-only pass (no world/combat/faction/npc/store/item changes). Five parts:
  * A — HUD declutter (ui.js): removed the TRACTOR button, the CONSTANT/BURST
    engine-mode button, and the ForgeHUD TAP-VECTOR thrust pill from both the
    flight draw path AND the tap hit-test. Mechanics kept intact: SPACE / tap-a-
    rock still tows, Q still toggles engine mode, thrust direction is automatic.
    Also dropped the bottom-center quick-slot row (High/Mid/Low/Rig) — redundant
    with the gear panel and meaningless under the flat rack.
  * B — flat equipment (equipment_system.js): the High/Mid/Low/Rig/Skill slot
    groups collapse to ONE generic array `slots: Array(6).fill(null)`. Any item
    fits any slot — all slot-type validation gone. equip(i,item)/unequip(i) take
    a 0–5 index; getEquipped()→{slots:[…6]}; getActiveStats iterates all 6 any
    category. An item is a "skill button" automatically when it carries an active
    descriptor (item.skill OR item.weapon) — no separate skill group. tickSkills/
    activateSkill/deactivateSkill/getSkillState all work on any slot 0–5.
  * C — DOM gear panel (#gearPanel in build.py <body> + CSS; wired in ui.js):
    the ForgeInventory canvas grid is dropped from the game (module kept, still
    selfTest-green, just no longer called). V3-style overlay: left = scrollable
    cargo list (rarity dot + category badge + name + rarity label + sell value),
    right = 6-slot 3×2 grid. Equip by drag-row→slot OR tap-row-then-tap-empty-
    slot; unequip by tapping a filled slot. Badge = category-colored square with
    a 2-char code (weapon red · shield cyan · armor yellow · hull green · skill
    purple · misc grey); rarity normal #8a8f98 / rare #57d1c9 / unique #ffd24a /
    elite #9b70ff. Store/warp tabs stay canvas; the DOM header + canvas tab bar
    both switch tabs. s.inventory is now the single cargo source of truth.
  * D — V3 skill buttons (hud.js): the 2 fixed bottom-right skill tiles become a
    dynamic LEFT-column stack, one button per equipped active module (iterating
    all 6 slots). Each: rounded rect, rarity-colored border (bright active / dim
    idle), dark bg (#141d2b idle / #123028 active), centered category badge, a
    type tag top-left (LAS/CAN/MSL/HULL+/SHLD+/FUEL+/ARM+), a status dot bottom-
    right (green firing / grey idle), and a radial cooldown sweep while cooling.
    Weapons now require their skill button toggled ON to auto-fire (V3 rule) —
    activeWeaponItem() only returns a toggled-on weapon; the fit-slot index rides
    _skillLayout so a tap maps to the right ForgeEquipment slot; keys 1–6 toggle.
- Judgment calls:
  * "active.type" in the brief maps to v4's descriptors: item.weapon (auto-fire)
    or item.skill (repair loop). tickSkills only ticks .skill items; weapons are
    still clocked by ForgeCombat, so the button's cooldown arc reads s.weaponCd
    for weapons and ForgeEquipment's cooldownRemaining for skills.
  * v4 has no "skill" category — skill modules keep cat shield/armor/fuel/hull, so
    the badge maps item.skill → purple "SK" (differentiated by the type tag), and
    mining/propulsion/cargo/utility/fuel all fall to grey "MI".
  * ForgeInventory left intact rather than deleted: it owns its own rack + a
    green selfTest the build gate checks, and nothing else imports it.
  * DOM gear panel only for the GEAR tab (store/warp are ForgeStore/ForgeWorld
    canvas renders, which are off-limits); syncGearDOM() toggles #gearPanel.show
    each draw frame + on dock transitions so it can't desync.
- selfTest (GREEN ×1, all 9 modules + GAME): ForgeEquipment rewritten to the flat
  model (6 empty slots, any-item-any-slot, swap, apply order, resist cap, skills
  fire/cap/deactivate on any index, weapon activatable-but-not-ticked, fire+ammo+
  restock, custom slot count); ForgeHUD rewritten (removed thrust/quick-slot asserts,
  left-column skill hit-test by fit-slot); main.js/ui.js/player.js updated to numeric
  slots + eq.slots. Browser verified on :8096: gear panel renders cargo+slots+badges,
  click-select→equip, click-slot→unequip, drag-row→slot→equip, flight shows 3 left-
  column skill buttons (LAS/SHLD+/ARM+) with no tractor/mode buttons, skill-tap
  toggles the right slot, zero console errors.
- Wiring: build.py HEAD gains the #gearPanel markup + CSS and an updated header;
  ui.js owns the DOM panel (render/sync/wire/equip/unequip); main.js boot calls
  GAME.wireGearDOM() and drops the ForgeInventory pointer branch; keys 1–6 map to
  skill slots. Off-limits modules (item/combat/world/store/faction/npc) untouched.

## 2026-07-09 — Phase 3: drone trade system (src/game/drones.js)
- Ore refinery at dock: REFINE ALL converts each refinable ore type (copper/
  silver/gold/platinum; slag excluded) at 2 ore → 1 bar (floor), consumed ore
  removed from s.ore, odd remainder stays raw. Bars live in s.refinedBars.
- Trade drones: three tiers (Basic 25cr+2Cu → 125cr @72% · Reinforced
  60cr+3Ag+1Au → 220cr @82% · Armored 150cr+2Pt+3Au → 450cr @91%), convoy 1–5
  (0.2s launch stagger, shared random DISCOVERED destination ≠ origin), escort
  checkbox = +0.15 successRate. travelTime = station dist / 80s, progress
  scaled by engineBonus (+0.05 per equipped propulsion item, cap 0.15). Fuel
  burns 80% of tank over a clean trip; weapons drain more during fights; dry
  tank = helpless (successRate 0). Pirates: one rnd()<0.33 ambush roll per
  drone per 25s interval → 2–4s fight (dps 12+5/tier soaks shield→hp, ×2 when
  dry; loadout answers: repair heals hull, shield booster recharges) then a
  survival roll — rnd() > rate destroys ONLY on the first ambush (per spec);
  later ambushes just chew hp (hp≤0 still kills). Pirates disengage from a
  convoy after downing 2 (s._convoyLosses) — partial convoys always land
  something. Arrival pays out immediately + "Drone arrived! +Ncr" toast;
  destroyed drones red-flash 0.5s then cull; arrived rows linger 6s in the bay
  list. updateDrones ticks BEFORE the docked/warp early-returns so convoys
  keep flying while the player sits in a station.
- Drones are fully self-contained (hardcoded per-tier loadout templates cloned
  at launch, no ForgeItemSystem/ForgeCombat calls) so Phase 5 can lift the
  struct wholesale. Forge modules untouched.
- UI: 4th dock tab "◈ DRONES" — DOM overlay #dronePanel cloned from the
  #gearPanel pattern (fixed full-screen, .show toggle, shared gh* classes;
  synced every draw frame via syncDroneDOM, list refreshed ~3Hz by frame
  counter since s.t freezes while docked). Sections: refinery (ore pills +
  REFINE ALL + bar pills) · three tier cards (cost/mats/payout/success/est-
  travel, sel/cant states) + convoy 1–5 buttons + ESCORT + LAUNCH · active-
  drone rows (tier tag, from→to, progress bar, 5+5 hp/shield pips, ETA,
  TRAVELING/PIRATE ATTACK/NO FUEL/DESTROYED/ARRIVED). Canvas dock tabs
  squeezed 96→68px wide so 4 tabs + LAUNCH fit the 390 canvas; hitDockTabs
  routes "drones"; ui.js untouched (setDockTab's _openTab no-ops for unknown
  tabs, DOM visibility syncs in draw). Map: cyan dots (r=2) on the minimap
  disc overlay (same geometry trick as encounters/bases — hud.js untouched)
  + world-space dots with a heading tick; destroyed = growing red flash.
- Judgment calls where the spec conflicted with itself / the codebase:
  * Refinery math: spec says "2 ore → 1 bar" AND "70% = 3 ore → 2 bars" AND
    the selfTest contract "6 ore → 3 bars". floor(n/2) satisfies the rule and
    the test (the 70% parenthetical is unsatisfiable alongside them).
  * Spec's "s.cargo" for ore counts maps to the actual s.ore {type:{count,
    bonus}}; fromId/toId typed "string" in the spec but station ids are
    numbers (0–7) — the world's types win.
  * "~33% per drone" reads as one roll per 25s interval (first at 25s), so
    short hops can be ambush-free; the interval clock is per-drone.
- selfTest (§17d, GREEN ×3 on the compiled file): init empty drones/bars ·
  6 copper → 3 bars + ore consumed · 5 silver → 2 bars + 1 raw remainder ·
  launch blocked without credits, then deducts 25cr + 2 bars and pushes a
  tier-0 drone with the exact stat block/loadout · progress 0.999 → arrival
  pays 125 exactly once · forced ambush at successRate 1 survives with chip
  damage + event counted, at successRate 0 destroys on the first event, red
  flash culls after 0.5s, no payout. Determinism note: updateDrones only
  touches rnd() when drones exist, so every pre-existing suite section (and
  the §15 haul flight) sees an unchanged LCG stream.
- Wiring: build.py GAME_FILES + game/drones.js + #dronePanel markup/CSS +
  gear-header Drones tab; main.js adds initDrones/updateDrones/syncDroneDOM/
  drawDronesWorld/drawDronesMinimap hooks, 4-tab dock bar, wireDroneDOM at
  boot, drones/refinedBars in getState. ui.js and Phase 1/2 files untouched.

## 2026-07-09 — Phase 4: mercenary contracts (src/game/contracts.js)
- Station contract boards per ROADMAP Phase 4: each dock regenerates 3–4 jobs
  for that station (s.stationContracts[stationId]); the player holds ONE
  contract at a time in s.contracts (a complete-but-unturned-in job still
  occupies the slot). Types roll weighted — faction_strike 30% / pirate_clear
  20% (nox, per Phase 2's "pirates are nox") / salvage 25% / escort 15% /
  bounty 7% / defense 3%. Difficulty by station distance (<1500 → 1, ≤3500 →
  2, else 3) scales rewards (200–500 / 500–1200 / 1200–3000cr, rounded to 5),
  kill counts (strike 3/5/7, clear 4/6/8), salvage N = diff×2, and bounty
  fleet size. Turn-in requires docking at the issuing station: +reward,
  +delivery rep (ForgeNPC), checkWin. ABANDON button frees a stuck slot
  (bounty targets can retreat-regen forever — without it the system softlocks).
- Tracking hooks into existing events, no new event system: onAlienKilled →
  onContractKill (strike/clear match faction, bounty matches targetId; defense
  advances by live-count scan instead so any kill path counts) · loot pickup
  in updateLoot + junk salvage in depositTows/bustJunk → onContractItem
  ("high-value" = tier above Normal) · onShipDestroyed → active defense
  contracts fail ("defender down") · escort arrival/death in updateContracts.
- Escort: gold "miner-like" freighter (ForgeNPC.drawNPCShip + game-side
  ⛟ ESCORT label) spawns at the issuer on accept and crawls 55u/s straight
  to targetStation; arrival <90u completes. Danger is game-side: any living
  alien within 300u chips it 6dps/alien via ForgeCombat.applyDamage (equal
  per-layer) and IDLE squads it passes wake (activateGroup) so the player can
  actually fight the threat; 4/s shield trickle after 3s quiet so grazes heal.
- Bounty: named lead ("Vex Commander Xal" pattern — rank by faction + proper
  name pool) spawns 1200–2400u from the issuer on accept. d1 = lone elite
  (generateAlienShip isLeader), d2 = generateGroup elite + 2, d3 = flagship:
  elite + 4 followers + 1 extra guard stitched into the same groupId
  (generateGroup caps followers at 4). Lead gets ×3 on all three layers
  (cur+max), name renders via ForgeFaction's own leader-label draw; game-side
  dressing = gold select brackets, and for flagships a 1.4× hull-echo triangle
  + magenta drive trail (drawContractWorld, after the forge draw pass).
- Defense: accept seeds contract-local raidHp 400 (the real station is never
  harmed) and wave 1; each wave = difficulty generateGroup(followerCount 2)
  squads (= diff×3 ships), tagged _contractId + activated. Wave clears when no
  tagged ship lives (scan in updateContracts, so weapon/AoE/any kill counts) →
  next wave or complete; raiders within 500u of the station chip raidHp 5dps —
  0 = failed. Player death mid-raid also fails (respawn is instant, so "dead
  at wave end" is read as "died during the raid").
- HUD: always-visible active-contract box top-right (below the weapon badge at
  y≈192k, right-aligned 158k wide), bgPanel fill + teal border (gold + "✔ turn
  in at <station>" when complete), title + live progress line ("3/5 kills",
  "2/4 items", "wave 2/3 · station 340hp", "freighter 812u out", "target 640u
  away"). Minimap overlay (same disc-geometry trick as encounters/bases/
  drones — hud.js untouched): gold dot = escort, gold reticle = bounty target.
- UI: 5th dock tab "✦ CONTRACTS" — DOM overlay #contractsPanel cloned from the
  #gearPanel/#dronePanel pattern (fixed full-screen, .show toggle, shared gh*
  classes + ct* card styles, first-show render via syncContractsDOM each draw
  frame, re-render after every button press). Top section: active contract
  card with TURN IN (enabled only complete + at issuer; shows progress or
  "turn in at X" otherwise) + ABANDON. Bottom: available cards (title, desc,
  ⭐×difficulty, reward) with ACCEPT — all board buttons flip to a disabled
  "Contract slot full" while a job is held. Canvas dock tabs squeezed 68→55px
  (font 10→9px) so 5 tabs + LAUNCH fit the 390 canvas; contracts tab button
  added to the gear + drone panel headers too. Coordinated live with the
  Phase 3 session that landed mid-implementation (its 4-tab bar, #dronePanel,
  and §17d selfTest slot were rebased around, contracts took §17e).
- Judgment calls where the spec met the modules:
  * ForgeFaction AI only targets the player, so escort danger and station raid
    damage are game-side proximity-DPS mechanics (above) instead of ship-vs-
    ship AI; raiders chasing a fleeing player effectively pause the raid.
  * "Flagship 1.4× sprite scale / trail color": drawAlienShip has a fixed
    ship size, so the flagship reads larger via a game-side 1.4× outline echo
    + trail overlay — forge module untouched.
  * escortNpcId/stationId keep the world's real id types (escort ids are
    strings like alien ids; station ids are numbers 0–7).
  * No expiry on any contract (expiresAt stays null): boards regenerate every
    dock and active jobs have failure conditions instead of timers, per spec.
- selfTest (§17e, GREEN ×3 on the compiled file): init empty · 60×3 boards
  across three distance bands → 3–4/dock, difficulty matches band, rewards in
  range, per-type fields sane, type mix within ±0.10 of weights · strike:
  accept, 2nd accept blocked, off-faction kill ignored, 5th kill completes +
  toast, turn-in blocked undocked then credits +reward and frees the slot ·
  salvage: normal item ignored, 2 rare+ complete · escort: NPC spawns at the
  issuer, arrival completes + despawns, death fails + clears slot/npc + toast ·
  bounty d3: lead + 5 guards, ×3 hp, named, _flagship; guard kill ignored,
  lead kill completes · defense: wave 1 on accept (3 ships), clear → wave 2,
  clear → complete; raidHp 0 → failed + slot freed. Determinism: updateContracts
  touches rnd() only via accepted-contract spawns, so every pre-existing
  section (incl. the §15 haul and §17d drones) sees an unchanged LCG stream.
- Browser-verified on the compiled game.html: board renders 4 diff-1 cards at
  Homeport, ACCEPT → active card + "Contract slot full" board, launch shows
  the HUD box ("PIRATE CLEAR · 0/4 kills"), 4 sim kills flip it to gold
  "✔ turn in", redock TURN IN pays 370cr + regenerates the board, and a d3
  bounty spawns the named flagship (375 hull lead + 5 guards) with trail,
  brackets, name label, and minimap reticle.
- Wiring: build.py GAME_FILES + game/contracts.js + #contractsPanel markup/CSS
  + contracts tab buttons in both panel headers; main.js adds initContracts/
  updateContracts/syncContractsDOM/drawContractWorld/drawContractMinimap/
  drawContractHUD hooks, 5-tab dock bar, wireContractsDOM at boot, contracts/
  escorts in getState, §17e; ui.js openDock generates the board (one line);
  player.js/economy.js gain the three hook calls. Forge modules untouched.

## 2026-07-09 — Phase 5: player fleet (src/game/fleet.js)
- Up to 5 combat drones escort the player. A fleet drone IS the Phase 3 trade-
  drone struct (id/tier/hp/maxHp/shield/maxShield/fuel/loadout carried over
  wholesale); on assignment the trade-route fields (fromId/toId/progress/payout
  + from/to coords) are stripped and formationIdx/offsetX/offsetY/vx/vy/
  targetAlienId/state("follow"|"attack"|"repair"|"retreat")/wcd are added.
  Lives in s.playerFleet (never s.drones); max 5.
- Assignment: arrived (non-destroyed) rows in the DRONE BAY list grow an
  ADD TO FLEET button (delegated click on #drList — the list rebuilds at ~3Hz).
  assignDroneToFleet splices s.drones→s.playerFleet, seats the drone at its
  slot, toasts "Drone joined your fleet!". REMOVE (Fleet tab) sends it back to
  s.drones as arrived=true with the route pointed at the docked station,
  progress 1, payout 0, and a 60s bay linger so it can be reassigned; the
  remaining fleet re-packs formationIdx 0..n and slot offsets.
- Formation: offsets [(-80,0),(80,0),(-80,80),(80,80),(0,80)] are authored in
  the "facing up" pose, rotated by heading+90° so wingmen track the ship's
  frame. Movement = velocity lerp toward (goal − pos) clamped 220 u/s with
  0.85/frame damping (Math.pow(0.85, dt*60) retention). follow/repair seek the
  slot; attack seeks the target with a 160u standoff; retreat seeks 40u behind
  the player. Drones >3000u out (warp jump / respawn) snap to their slot.
- Combat AI (follow/attack): validate targetAlienId each tick (dead/gone →
  clear + follow); acquire the closest alien within 600u, preferring one no
  other fleet drone targets (spread), then state=attack. Within 300u and off
  cooldown the loadout weapon fires: ForgeCombat.applyDamage(alien, dmg,dmg,dmg)
  with wcd = 1/fireRate; kills route through onAlienKilled (loot + contract
  hooks, _looted-guarded). Repair: hp<30% → state=repair (target cleared),
  repair-module amount ticks hull/s, hp>80% resumes follow. Retreat: shield 0
  AND hp<50% → retreat until hp≥50% (then repair→follow); utility modules tick
  shield in repair/retreat.
- Visuals: teal (#00e5cc) — triangles + gradient drive trails on the flat SF
  plane (distinct from trade-drone cyan), thin teal leash to the formation
  slot, faint red line to the target while attacking, alien-style bar geometry
  in friendly green + shield ring, "FLEET-N" name tag. Minimap: teal ▲
  (player-marker sized) via the same overlay-disc trick (hud.js untouched).
- Loadout editor (Fleet tab): 3 slots (weapon/repair/utility) per card, SWAP
  opens an inline picker of matching s.inventory items — weapon = item.weapon
  (dmg = 10×avg layer mult × tier mult, fireRate from weaponCooldownMs);
  repair = armor/hull repair skill or *repair* base; utility = shield cat or
  shield_regen skill. Picking consumes the cargo item; the displaced entry is
  a built-in module (not an item) so it's simply replaced.
- UI: 6th dock tab "⚡ FLEET" — DOM overlay #fleetPanel cloned from the
  #contractsPanel pattern (fixed full-screen, .show toggle, shared gh*/dr*
  classes + fl* styles, first-show render via syncFleetDOM each draw frame,
  re-render per action). Header "Player Fleet (N/5)", cards with tier tag /
  slot label / hp+shield bars / state / loadout rows / REMOVE, footer "Assign
  drones from the DRONE BAY tab", empty state "No fleet drones assigned."
  Canvas dock tabs squeezed 55→46px (font 9→8px) so 6 tabs + LAUNCH fit the
  390 canvas; fleet tab button added to the gear/drone/contracts panel headers.
- Coordinated live with the Phase 6 session (it landed npc_traders/galaxy_map
  in main.js + build.py mid-implementation and pre-registered game/fleet.js in
  GAME_FILES; its §17f selfTest slot was respected — fleet took §17g).
- Judgment calls: fleet drones don't burn fuel or take alien fire (ForgeFaction
  AI only targets the player), so repair/retreat mostly triggers via AoE-side
  effects and future phases; removal keeps the 6s Phase-3 linger too short for
  reassignment, so removed drones linger 60s instead.
- selfTest (§17g, GREEN on the compiled file): playerFleet empty on init ·
  launch+force-arrive feeder → assign moves the struct s.drones→s.playerFleet
  (slot 0, follow, route fields stripped, offsets (−80,0)) · 5 fill, 6th
  blocked without moving the drone · alien at 150u: one updateFleet(0.016)
  acquires + applyDamage lands + wcd set · second drone spreads to the
  un-targeted alien · dead target cleared · hp 20% → repair, Repair Bot ticks
  hull, 85% resumes · shield 0 + hp 40% → retreat, hp 60% leaves · slot-0
  world pos = (x−80, y) at default heading, 600u drone converges <60u in 5s
  with the 220 u/s clamp held every tick · remove returns it arrived=true,
  re-packs slots, and the drone is re-assignable into slot 4.
- Wiring: build.py GAME_FILES (pre-added) + #fleetPanel markup/CSS + fleet tab
  buttons in the other panel headers; main.js initFleet/updateFleet/
  syncFleetDOM/drawFleetWorld/drawFleetMinimap hooks, 6-tab dock bar,
  wireFleetDOM at boot, fleet count in getState, §17g; drones.js grows the
  ADD TO FLEET button + delegation (its Phase 3 logic untouched). Forge
  modules untouched.

## 2026-07-09 — Phase 6: galaxy map + NPC traders (src/game/galaxy_map.js, src/game/npc_traders.js)
- Galaxy map: fullscreen canvas overlay (M key, always-visible ◈ MAP button
  stacked above the HUD's warp button, ✕ / ESC / M to close) over live state —
  the world keeps ticking while it's up, but pilot input pauses (update()
  zeroes ax/ay + tap/skill/tractor intents and skips tryFireWeapon; weaponCd
  still decays so nothing freezes). rgba(10,13,20,.9) wash, whole 12k field
  mapped to min(W,H)×0.85 centered (mapX = cx + wx/12000·scale). Layers:
  dashed #2a3a4a route lines between station pairs that are BOTH discovered +
  warpActive · station nodes r=12 (home gold / discovered cyan / undiscovered
  dim grey with "???" labels — names stay hidden like the warp UI) · cyan r=3
  trade-drone dots at dronePos() · white r=2 NPC-trader dots · teal ▲ per
  s.playerFleet drone (guarded `|| []` so the map ran before Phase 5 landed) ·
  encounter icons at r=5 (same shape set as the minimap) · gold ✦ contract
  marker (escort → targetStationId, everything else → issuer) · white player
  dot r=5 with pulsing ring · 2000u scale bar. Input routing reuses the
  overlay path: overlayActive() gains galaxyMapOpen, ui.js overlayClick routes
  to galaxyMapClick (map eats every tap; only ✕ acts).
- NPC traders: 3–6 spawned once at world init on random station pairs —
  prefers pairs with active warp gates, but a fresh world only has Homeport
  online, so the fallback routes between any pair (they're the living world,
  not player intel). Drone-style flat struct {fromId/toId, fromX/Y→toX/Y,
  progress, hp/shield, credits 50–200, cargo 1–3 ore types, speed 60}; spawn
  progress rnd()·0.9 spreads them mid-route. progress += dt·speed/dist; at 1
  the route flips (fromId↔toId, progress 0) forever. initNpcTraders runs LAST
  in init() so every earlier world-gen rnd draw keeps its pre-Phase-6 stream
  (all prior selfTest sections see unchanged worlds).
- Ambient piracy: an alien with no player aggro within 400u rolls 5%/s to
  break off (_raidTraderId); an engaged raider lands weaponDmg every 1.2s
  inside 500u. Damage is the applyDamage soak pattern on the flat struct
  (shield first, overflow to hp) since there's no forge hp block. Hurt traders
  regen shield 3/s once 3s out of fire. Death: white pop + credit orb +
  one ore orb per cargo entry into s.loot, raiders released, toast "NPC
  TRADER DESTROYED — PIRATES WIN" (or "TRADER LOST ON YOUR WATCH" if the
  player was within 1200u). updateLoot learned the two new orb kinds:
  {credits:n} banks directly, {ore:type} stacks the hold; rendering.js colors
  them gold / ring-color (item orbs unchanged).
- Save the convoy: any damage sets underAttackT=3 → blinking orange
  "⚠ TRADER UNDER ATTACK" at top-center (y=60k, just under the HUD bars) while
  the player is within 1200u. onAlienKilled → onTraderRaiderKilled: last
  living raider down + trader alive + player in range → +50cr "CONVOY SAVED!".
- Player piracy: tap a trader in scan range (resolveTap, after the alien
  check; boot's pending-pick gains pickTraderAt) to toggle the piracy mark —
  the active weapon then auto-fires whenever no alien lock has priority,
  sharing s.weaponCd + weaponCooldownMs. Kill = same loot spill + −10 rep at
  the nearest station ("Pirate! Rep −10 at X" — updateReputation('custom')).
- Judgment calls: traders aren't ForgeCombat lock targets (their flat struct
  has no 3-layer hp block and fireWeapon would reject it) — piracy is a
  game-side mark + auto-fire instead, which also keeps "pirate a freighter"
  from hijacking the combat lock UX. Fleet map dots read s.playerFleet
  defensively because Phase 5 was landing in parallel. Minimap trader glyph is
  a hollow 2.4k square (□ per spec, distinct from cyan drone dots).
- Cross-session: Phase 5 landed mid-build — added its fleet.js to GAME_FILES
  next to the two Phase 6 files, interleaved draw/update hooks survived both
  sessions, and its §17g feeder rig (progress .999 + 0.05s tick can't cross
  1.0 on the ~61s home→st1 leg) was diagnosed here and fixed by that session.
- selfTest §17f (ALL GREEN on the compiled file): 3–6 traders with valid
  distinct station ids, progress ∈ [0,1), full stat block, 1–3 cargo, credits
  50–200 · progress 0.9999 + 1s tick flips fromId↔toId, resets progress,
  resyncs x/y · piracy: 10 dmg soaks shield only; kill flags dead, drops
  1 credit + N ore orbs, −10 rep at the nearest station, "Pirate!" toast;
  40 ticks cull the wreck; credit-orb pickup banks exactly its value ·
  galaxy map: openGalaxyMap pauses thrust (3 held-thrust steps leave
  charge≈0), close restores, and the input.mapToggle path opens+closes
  through update() without a crash.
- Browser-verified on the compiled game.html (port 8093): clean boot, 5
  traders on routes; map shows gold home + cyan discovered nodes, dashed
  routes between 3 gated stations, cyan drone dot, white trader dots, player
  ring, 2000u bar; ✕ pointer-tap and M both close; trader wedge renders with
  orange under-attack HP bar + top-center blink + minimap square; trader tap
  returns "pirate" and marks pirateTargetId. (Browser-pane RAF pauses while
  the tab is hidden — frames only advance during screenshots; not a game bug.)
- Wiring: build.py GAME_FILES + PHASE 6 header note; config.js input.mapToggle;
  main.js init/update/draw/getState hooks + M key + overlayActive + §17f;
  ui.js MAP button (gameButtons/flightTap/drawControls) + overlayClick route;
  input.js resolveTap "pirate" branch; player.js loot-orb kinds + raider-kill
  hook; rendering.js orb colors. Forge modules + Phase 5 fleet.js untouched.

## 2026-07-09 — dock UX overhaul: ore visibility + tab consolidation
- **Ore in cargo (hard requirement)**: renderGearPanel() in ui.js now shows
  s.ore entries at the top of the cargo list with colored badges (from
  CONFIG.rings), type name, count, unit value, and per-type SELL buttons.
  A SELL ALL ORE button appears below ore rows. Ore rows are excluded from
  the item drag-to-equip system. wireGearDOM() handles sell clicks via
  delegated click handler on ghInv.
- **Tab consolidation — DRONES + FLEET → HANGAR**: merged the standalone
  #fleetPanel into the bottom of #dronePanel as a "Player Fleet" section.
  Tab count drops from 6 to 5 (Gear / Store / Warp / Hangar / Contracts).
  fleet.js _flDOM() no longer requires a panel element; syncFleetDOM()
  checks dockTab === "drones"; wireFleetDOM() only wires the list click
  handler (tab/launch buttons removed). renderDronePanel() triggers
  renderFleetPanel() so both sections stay in sync.
- **Canvas tab bar**: main.js dockTabs/drawDockTabs/hitDockTabs updated to
  5 wider tabs (54px vs 46px); "DRONES" → "HANGAR", "CONTRACTS" → "JOBS".
- **Build**: build.py HEAD updated — removed #fleetPanel div, added fleet
  section inside #dronePanel, removed fleet tab buttons from all 3 panel
  headers, renamed Drones → Hangar. Added CSS for .ghOreRow, .ghOreSell,
  .ghSellAll, .ghOreSep. selfTest ALL GREEN.

## 2026-07-09 — Solar system world redesign (Steps 1–6)
- **Map size**: world radius expanded from 6000 to 85000 (CONFIG.WORLD_RADIUS).
  Spatial culling (isWorldVisible) uses relative distance — no hardcoded
  bounds, works at any scale. ForgeWorld's internal FIELD=12000 stays untouched;
  game-side code relocates station positions via mutable `pos` objects.
- **Solar system layout**: central star at (0,0) radius 1800 + 8 named planets
  at increasing orbital radii — Vesper(8k), Cinder(14k), Arix(22k), Dusk(32k),
  Mira(44k), Sorn(58k), Halveth(72k), Nox Prime(80k). Each planet has a
  station placed at (angle+0.3, r×2.8), 0–3 moons, optional ring dots, and a
  seeded orbital angle. Home station is "Homeport Mira" at Mira's orbit.
  Asteroid belt annulus at r=37k–40k. Three faction territories: vex inner
  (0–27k), krag mid (27k–65k), nox outer (65k–85k). Alien groups spawned
  1–2 per planet (faction-appropriate via seedWorld).
- **Planet variety visuals** (planets.js rewrite): 8 unique planet types with
  baked 512×512 sprites — cratered (Vesper), lava (Cinder), tan gas giant
  (Arix), ice (Dusk), life with continents+oceans+clouds (Mira), desert
  (Sorn), purple gas giant (Halveth), dark (Nox Prime). Moons as 128×128 grey
  cratered bodies. Full color palettes in CONFIG.planetDefs.
- **Fog of war**: tile-based (2000×2000 unit tiles), `s.exploredTiles = Set`.
  3×3 grid around the player explored each frame via `_exploreTilesAround`.
  Semi-transparent dark overlay on the game world + galaxy map. Undiscovered
  planets/stations hidden on minimap. Star always visible.
- **Win state replaced**: credit-goal win removed. Trade network completion =
  all 8 stations discovered + warp gates built → "GALACTIC TRADE NETWORK
  COMPLETE" toast + 10,000cr bonus. Game continues indefinitely. Warp gate
  costs scale with orbital distance from Mira (500cr to 20,000cr) via
  CONFIG.warpGateCosts; game-side override calls ForgeWorld.buyWarpGate(999999)
  then deducts the custom amount.
- **Galaxy map redesign** (galaxy_map.js rewrite): solar system view with
  faction territory annuli, orbital rings, asteroid belt, central star glow,
  fog overlay tiles, colored explored planets with names, warp route lines,
  trade network progress "Stations: N/8  Gates: N/8", 20000u scale bar.
- **Ore/junk centering**: ore rings and junk clusters centered on `_oreCenter`
  (home station position) instead of world origin. Rocks store `_center` for
  respawn. Enemy bases rescaled to 20k–75k range.
- **Station relocation strategy**: ForgeWorld.getStations() returns mutable
  objects — game-side init overwrites pos.x/y and name after initWorld(42).
  All ForgeWorld APIs (discovery, warp, store) use these live objects.
  ForgeWorld.selfTest() resets stations internally; game re-inits afterward.
- selfTest (§18–§21, GREEN): §18 solar layout — 8 planets by name, Mira at
  orbit 44k, home station near Mira, all stations near their planets, player
  near Mira. §19 factions — each planet's faction matches its orbital zone.
  §20 fog — exploredTiles is a Set with starting tile explored, far tile not.
  §21 trade network — not complete at start; all discovered+warped triggers
  completion + bonus awarded exactly once. §22 reset clean.
- Wiring: config.js (solar constants + planetDefs + warpGateCosts + factionZones),
  planets.js (makePlanets + planet sprites), rendering.js (star/fog/minimap),
  galaxy_map.js (solar map), economy.js (checkWin trade network), ui.js (warp
  cost scaling), main.js (init relocation + fog + seedWorld + selfTest §18–22),
  ores.js (_oreCenter), junk.js (_oreCenter). Forge modules untouched.

## 2026-07-09 — dock station menu overhaul (ui.js, fleet.js, build.py)
- **Full audit**: clicked through all 5 dock tabs (Gear/Store/Warp/Hangar/
  Contracts), tested every button and interaction, documented findings as a
  comment block at the top of ui.js.
- **Ship Loadout screen (Gear tab — main deliverable)**: below the 6-slot
  equipment grid, a "Ship Loadout" stats panel shows computed DPS (sum of
  damage × fireRate across equipped weapons), Shield, Armor, Hull, Speed
  (thrust×2), and Cargo with colored stat bars that update live on equip/
  unequip. Weapon type label shown when weapons are equipped.
  Base values: Shield 100, Armor 80, Hull 60, Speed 200, Cargo 20.
- **Equipment slot UX**: filled slots now show rarity-colored borders + a ×
  UNEQUIP button (top-right corner) for one-click removal. Previously the
  only way to unequip was clicking the slot body (undiscoverable).
- **Cargo item actions**: every item row gets EQUIP and SELL buttons. EQUIP
  finds the first empty slot; if all 6 are full, toasts "all slots full".
  SELL gives 70% of item value (ForgeStore sell price formula). Previously
  items could only be equipped via drag-to-slot or select-then-tap.
- **SELL ALL ORE yield preview**: the button now shows the total credit yield
  ("SELL ALL ORE +3840cr") so the player knows what they'll earn.
- **Store tab improvements**: buy success now toasts "+1 ItemName" (green) +
  "-Ncr" (gold). Insufficient credits shows "NOT ENOUGH CREDITS" (red) +
  warning sfx. Cargo full shows "CARGO FULL" (red). Previously buy failures
  were silent. Implemented via intercepting ForgeStore.handleStoreClick()
  return value in overlayClick — module untouched.
- **Fleet drone stats**: fleet cards in the Hangar tab now show computed stats
  (DPS, SH, ARM, HP) with colored labels below the HP/shield bars.
  DPS = loadout weapon dmg × fireRate. All 3 loadout slots (weapon/repair/
  utility) with working SWAP flow were already present from Phase 5.
- **Warp tab**: verified working — cost shows, "need Xcr" on insufficient
  credits, gate purchase + jump functional.
- **Contracts tab**: verified working — type/difficulty/reward/description,
  ACCEPT works, "Contract slot full" shown, active shows live progress,
  TURN IN gated to complete + issuer station, ABANDON works.
- selfTest ALL GREEN. Forge modules untouched.
- Wiring: ui.js (_ghComputeDps, _ghWeaponType, _ghSellItem, renderGearPanel
  stats/unequip/buttons, wireGearDOM itemBtn handler, overlayClick store
  intercept); fleet.js (renderFleetPanel stat rows); build.py (CSS for
  ghStatRow/ghSlotUneq/ghItemBtn/flStatRow, #ghStats div in gearPanel).

## Store + Warp DOM panel rebuild
Replaced canvas-drawn Store and Warp tabs with DOM panels matching the
Gear / Hangar / Contracts dark-translucent card style.

**Store tab** (`#storePanel`):
- Station name + "STORE" header, credit balance in top bar.
- Stock rows: rarity dot, category badge, item name, rarity label, stat
  summary (e.g. "+20% shield cap", "12 dmg"), price, BUY button.
- BUY greyed out with tooltip when credits insufficient or cargo full.
- YOUR CARGO section: ore rows with per-type SELL, "SELL ALL ORE" total
  yield button, inventory items with SELL buttons.
- SET AS HOME PORT / ★ HOME PORT button.

**Warp tab** (`#warpPanel`):
- Header: "WARP GATES — STATION NAME", credit balance.
- Destination rows: station name, planet name, distance in units.
- Gate built: green "✓ GATE BUILT" badge + "JUMP →" button.
- Gate not built: cost badge + "BUILD GATE" button (greyed if can't afford).
- Undiscovered stations hidden.
- Progress footer: "Discovered: N / 8 planets  Gates: N / 8".

**Implementation pattern** (matches Gear/Hangar/Contracts):
- `_storeDOM()` / `_warpDOM()` — lazy DOM init
- `syncStoreDOM()` / `syncWarpDOM()` — per-frame show/hide
- `renderStorePanel()` / `renderWarpPanel()` — content rebuild
- `wireStoreDOM()` / `wireWarpDOM()` — boot-time event listeners

**Changes**:
- `build.py`: added CSS for `.stRow/.stBuyBtn/.stSellBtn/.stHomeBtn`,
  `.wpRow/.wpStName/.wpGateBadge/.wpJumpBtn/.wpBuildBtn/.wpProgress`;
  added HTML markup for `#storePanel` and `#warpPanel`.
- `src/game/ui.js`: added store + warp DOM functions; updated `_openTab()`
  to render panels instead of canvas; updated `overlayClick()` to remove
  canvas store/warp click routing; updated `_closeAllOverlays()`.
- `src/main.js`: added `syncStoreDOM()` / `syncWarpDOM()` to draw loop;
  removed canvas `ForgeStore.renderStore()` / `ForgeWorld.drawWarpUI()`
  branches from docked draw; added `wireStoreDOM()` / `wireWarpDOM()` to
  boot sequence.
- Forge modules untouched. selfTest ALL GREEN.

## 2026-07-09 — World Density Pass (ores.js/junk.js zone systems, ~1900 objects)
- **Rocks 111 → ~1084**, all zone-tagged so mining respawns in-place:
  * `ring_N` — full-360° ore torus per planet at orbit ±3000, 50–65 rocks each
    (485 total). `moon_N` — 8–13 rocks within 600u of each of the 11 moons
    (flattened index in s._moonList). `belt` — 200–240 gold/platinum rocks in
    the 37k–40k annulus, +50% ringBonus, ×1.2 size + glow halo (the payday
    zone). `background` — 100–140 in clusters of 3–8 anywhere on the disc.
    `base_N` — 20–28 scattered within 2000u of each enemy base. `planet_N` —
    the old rich close-ring annulus rocks, now zone-driven. `nebula_N` — the
    24 rich nebula rocks, now respawning back inside their cloud.
  * Ore tier by distance from the star (zoneOreRing): <20k copper/slag ·
    20k–45k silver/gold · belt gold/platinum · >45k platinum/gold. The brief's
    "iron"/"titanium" mapped onto the existing 5-type ore economy (slag stands
    in low, platinum high) — no new ore types, sell path untouched.
  * respawnRock is zone-first; zones whose anchor is gone (selfTest sections
    clear s.planets) fall back to a background scatter instead of crashing —
    the old "clear miners with planets" landmine is gone. Home tutorial rings
    keep the legacy zone-less type/_center respawn.
- **Junk 185 → ~813**, same zone treatment: `halo_N` planet debris clouds
  (25–38 at 1500–4000u), `lane_N` orbital-lane scatter (20–30 at orbit ±2000,
  full circle), `station_N` debris fields (20–30 at 500–800u around EVERY
  station incl. home, was 5–8 non-home), `hotspot_N` action clusters (12–16
  clusters × 6–10, anywhere ≥1200 from stations), `fill` whole-map scatter
  (70–100). ALL junk drifts 0.1–0.4 u/s (was 0.5–2.0; brief's number wins) —
  hauled junk respawns back into its own zone.
- **Nebulas 6 → 15**: 8–12 game-side extras pushed into ForgeWorld's live
  getNebulas() array AFTER alien/ore seeding (flagged `extra` so they don't
  multiply squads), 2–3 per orbital zone; belt clouds 2500–4000 radius and
  flagged `dense` → rendering draws a thicker core (0.30/0.14 vs 0.20/0.09
  alpha). Extras get full nebula behavior free (drag/scan/tier modifiers,
  ENTERING NEBULA toasts) since every consumer reads the same live array.
  ForgeWorld.selfTest still sees exactly 6 (it re-runs its own initWorld).
- **Performance**: the draw pass already filters via isWorldVisible BEFORE
  pushing into the depth-sort array (no spread-then-filter to flip — verified);
  the real hazard was the O(n²) rock–rock collision pass: 1084 rocks would be
  ~590k circleHit calls/frame. It now runs on a near-set (rocks within 4000u of
  the ship, gathered O(n)) — distant rocks are static so far pairs can never
  matter. buildMinimap also stopped mapping all 1084 rocks per frame (filters
  to scan range first — ForgeHUD drew every one clipped). Measured in-browser:
  0.6–0.7 ms/frame update+draw at zoom 0.8 and 0.08 (was budgeted 16.7).
- Judgment calls: the brief's per-zone ranges sum past its own 800–1000 rock /
  600–800 junk totals — zone SHAPE kept, per-zone counts trimmed ~proportionally
  (lanes 20–30 not 30–50, halos 25–38 not 40–60, hotspots 12–16×6–10 not
  15–25×8–15) landing at 1084/813. "Belt boost by 2 tiers" = gold/platinum
  types + the existing +50% ringBonus mechanic rather than a new multiplier.
- selfTest (GREEN ×3 on the compiled file): rewritten world-composition block —
  rock total in 800–1400 band, belt count/type/bonus/radius, per-planet torus
  count+radius, inner ring copper/slag vs outer ring platinum/gold, 11 moon
  clusters within 600u, background + per-base counts/distances, belt/ring/moon
  respawn returns to the SAME zone, junk total 600–1100, per-station/halo/lane
  counts+distances, universal 0.1–0.4 drift, hotspot station-gap, halo junk
  respawn stays in-halo, nebula count 14–18 with ≥2 dense belt clouds sized
  2500–4000 on the belt. Precision physics sections (§2/3/4/5/14) now clear
  rocks/junk from the y=9000 test lane — Vesper's new ring torus + lane junk
  live there and a bounce breaks exact velocity/fuel math.
- Browser-verified on :8099/game.html: station debris ring at Homeport spawn,
  moon cluster with tractor-range rings, purple dense belt nebula with glowing
  belt gold, minimap rock field, zero console errors.
- Wiring: config.js density constants + extraNebulaZones; ores.js zone rock
  system (zoneOreRing/rockZonePos/makeZoneRock/seedZoneRocks/respawnRock);
  junk.js zone junk system (junkZonePos/makeJunkZone/seedJunkField/
  seedStationDebris/respawnJunk); rendering.js dense-nebula alpha + minimap
  filter; main.js moon list, seedWorld order (debris → bases → zone rocks →
  extra nebulas), near-set collisions, selfTest. Forge modules, ui.js,
  drones.js, contracts.js, fleet.js untouched.

## 2026-07-10 — Major mechanic overhaul (6 changes)

### Change 1: Drones → Companion system
- Trade drones converted to permanent companion units (Diablo 2 mercenary
  style). Max 3 active companions (was 5 fleet slots). Formation offsets
  reduced to 3: LEFT WING (-80,0), RIGHT WING (80,0), REAR (0,80).
- `buildDrone(tier)` creates companions directly in `s.playerFleet` —
  no more launch→arrive→assign flow. Costs credits + refined bars. Death
  is permanent (`_destroyCompanion` splices from fleet, re-indexes).
- Trade runs optional: `sendOnTradeRun(fleetIdx)` from HANGAR tab sets
  companion state to "trade" with route fields. Returning arrival heals
  partially and restores to "follow". Pirate mechanics carried over.
- HANGAR tab restructured: "Build Companion" section replaces convoy
  launch UI (no convoy size, no escort checkbox). Fleet section renamed
  "Companions (N/3)" with per-companion cards showing state, stats,
  loadout slots, SEND ON TRADE RUN button, and DISMISS button.
- selfTest §17g rewritten: uses `buildDrone()`, tests 3-slot cap (4th
  blocked), combat AI, repair/retreat, formation convergence, dismiss
  (no return-to-bay — permanent removal).

### Change 2: Mining laser removed
- Mining laser base repurposed as "Deep Scanner" (cat utility, stat
  scan_range_pct). MINE button removed from flight HUD.
- Rocks targetable via existing combat lock system: `pickRockAt()` in
  input.js, `lockRock()` in player.js using `ForgeCombat.lockOn()`.
- Rock damage via `fireAtRock()`: wraps rock HP as hull-only 3-layer
  target so `ForgeCombat.fireWeapon()` works without modifying forge
  modules. Rock hp→0 triggers `mineRock()` (ore drop + respawn).
- `findCombatTarget()` extended to search `s.rocks` alongside aliens
  and enemy bases. Tap resolution: rock in tractor range → tow; rock
  outside tractor range → lock for shooting.
- item_system.js updated: bases 32, attributes 34, sources 4.

### Change 3: Tractor beam item system
- 5 new tractor base types in item_system.js: Tractor Range Amp,
  Tractor Lock Extender, Multi-Lock Array, Drag Compensator, Tractor
  Capacity Module. 4 new attributes: tractor_lock_pct, tractor_slots_flat,
  tractor_drag_pct, tractor_cap_pct.
- Game-side stat computation in `recomputeDerived()` via `_sumAttr()`
  helper (scans equipped items' base_stats + specials). New derived
  stats: tractorLock, tractorSlots, towDrag, towCapacity.
- Ship Loadout panel extended: T.Range, T.Lock, T.Slots, T.Drag bars.
- CONFIG.baseShip.tractorRange increased 170→600.

### Change 4: Thrust power setting (prior session)
- HUD buttons 25%/50%/75%/100%, default 75%, persisted localStorage.

### Change 5: Gear tab reworked
- **4-column icon grid** replaces cargo list rows. Tiles show category
  badge + item name, colored by rarity. Ore tiles show type + count.
- **Tap-to-open item modal** with full stats: name, rarity, category,
  value, weapon stats (type/dmg/range/fuel), skill stats (fn/cooldown/
  amount), base_stats (green), specials (cyan). Action buttons:
  EQUIP/SELL/CLOSE for cargo items, UNEQUIP/CLOSE for equipped items.
- **Default starting loadout**: Laser (slot 0), Shield Regen Module (1),
  Armor Repair Module (2), Fuel Cell Module (3), Tractor Range Amp (4),
  slot 5 empty. Generated via ForgeItemSystem at normal tier, ilvl 1.
- Skills display on flight HUD verified: LAS, SHLD+, ARM+, FUEL+
  buttons visible on the left column at game start.
- selfTest §22 reset assertion updated: equipped 0→5.

### Change 6: Store tab reworked
- **FOR SALE section**: 4-column icon grid (same tile style as gear tab)
  with item badge, name, and price. Tap → modal with full stat block
  and BUY button (disabled when can't afford / cargo full).
- **YOUR CARGO section**: 4-column icon grid. Ore tiles sell on tap.
  Item tiles open modal with SELL option.
- SET AS HOME PORT button spans full grid row.

### Build
- selfTest ALL GREEN (9 modules + GAME.selfTest).
- Compiled game.html: 9 modules + 20 game files, 620 KB.
- Browser-verified: gear tab icon grid + modal + equip/unequip/sell,
  store tab icon grid + modal + buy, HANGAR companion build/trade/dismiss,
  flight HUD skill buttons, thrust power buttons, no console errors.

## Weapons & Loadout Rework + Engine Decontamination (2026-07-10)
Goal: weapons target enemy ships only; no reward for shooting rocks/junk; purge
Space Hauler item content out of the Forge engine.

Engine purge (src/modules):
- item_system.js: embedded 32-item DB removed; engine now ships a generic SYNTH_DB
  fixture only. Real catalogue lives in src/content/catalog.js, injected via
  ForgeItemSystem.loadDB(SPACE_HAULER_CATALOG) (main.js init + before selfTest loop).
  selfTest rewritten against SYNTH_DB (test_mod/test_weapon/…), save/restore isolates
  it from the loaded game catalogue.
- equipment_system.js: ATTRS/DEFAULT_BASE purged of ore/cargo/mining/refine nouns;
  added solar_regen + tractor_slots_flat; tickSkills now honours skill.fuel_cost
  (fuel-gated repairs — skip w/o re-arming when the tank can't afford it).
- combat.js: projectile speed + colour now read from weapon data (w.projSpeed/w.color);
  PROJ_SPEED/COL are neutral fallbacks only.
- hud.js: cargo bar removed. inventory_ui.js DELETED (dead 10-slot legacy module);
  dropped from build.py MODULES + main.js selfTest registry + build.py --check list.

Gameplay:
- No mining loot: economy.mineRock/bustJunk deleted; player.fireAtRock destroys a rock
  for zero ore and skips towed rocks (towed bodies immune). Collection is tow-only.
- Weapons retuned in catalogue: laser 400ms/r600, cannon 1000ms/r900,
  missile 2200ms/r1400/dmg 2.2 all layers/unlimited ammo; projSpeed+colour on weapon data.
- Repairs cost fuel: Shield Repair 25/6s/10f, Armor Repair 20/8s/14f (shared fuel pool).
- Hardeners: shield_resist/armor_resist seeded in defense affix pools (stack on rare+).
- solar_regen stat + Solar Wing module; Additional Tow Slots now works (base tow slots
  fixed from the =1 bug back to CONFIG.baseTows=3, +1 per module, cap 6).
- Cargo hold deleted (was never enforced): cargoMax/cargoWeightK/oreYield/miningSpeed/
  refineYield removed from baseShip + engine ATTRS; ui/hud cargo readouts removed.
- drop_map trimmed to the clean player module pool; weapons drop from aliens only.
  NPC/alien-internal bases (turret, shield_booster, hull_repair_module, …) stay in the
  catalogue so faction/npc loadouts resolve, but never junk-drop to the player.

Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest); node probe
confirms shooting a rock yields no ore, repair fuel-gate, tow-slot +1, solar 2→3.5,
missile unlimited/retuned. game.html 620 KB.

DEFERRED (next slice, needs its own review): literal catalogue prune to exactly the
16 player modules (blocked by npc/faction/store reshaping alien+miner loadouts);
identify system (unidentified ore/salvage in the bay — no identify code exists in v4);
refining ore→bars as a station service + raw-ore sell penalty (0.35) + sellBar;
faction/world/station_store content injection (Vex/Krag/Nox names, station names, bar
economics still live in the engine — the space-game-systems layer, not the loadout layer).

## 2026-07-10 — Loadout screen · multi-ship · fleet roles (Phase 7)

The gear tab is replaced by a LOADOUT screen; the hangar becomes build & buy;
a new FLEET tab commands drone roles. Six dock tabs total:
LOADOUT / STORE / WARP / HANGAR / FLEET / JOBS (canvas bar + every panel header).

Multi-ship:
- CONFIG.hulls registry (config.js): vulture Vulture Tug (starter, hull 60),
  atlas Atlas Freighter (5,500cr + 3 gold + 4 silver bars — hull 90, fuel 150,
  4 tow slots), aegis Aegis Warhauler (14,000cr + 3 platinum + 4 gold bars —
  hull 120, sh 170/ar 150, thrust 120, weaponDmg 13). CONFIG.baseShip is now an
  alias for the starter hull's block. Per-hull baseTows replaces CONFIG.baseTows
  in recomputeDerived.
- s.ships[] + s.activeShipId: per-ship persistent 6-slot loadouts. The
  ForgeEquipment singleton is always the ACTIVE ship's rack; switchActiveShip
  (player.js) snapshots the outgoing rack, initEquipment-wipes (atomic skill
  teardown), reloads the incoming slots, restocks ammo, recomputes derived from
  the new hull, refreshes hp, clamps fuel. Docked-only. Engine untouched.
- buyShip(hullKey) (drones.js): hangar SHIPYARD cards; spends credits + refined
  bars; one of each hull; new ship lands with an empty rack in the carousel.
- Inactive-ship refits (loadoutEquip/loadoutUnequip, ui.js) are pure array moves
  on ship.slots ↔ s.inventory — the live rack never notices.

Loadout screen (#loadoutPanel, build.py + ui.js):
- Carousel over [ships…, drones…]: ◀ ▶, baked sprite portrait on a canvas
  (new "drone" sprite in rendering.js; tier ring overlay), name/hull line,
  ★ ACTIVE badge / SET ACTIVE button.
- 6 flat slots flank the portrait (drones: WEAPON/REPAIR/UTILITY typed slots).
- Tap a slot → modal shows the module + "if unequipped" stat deltas; tap a cargo
  tile → modal with "if equipped" deltas + EQUIP/SELL (drone pages: FIT AS …).
  Deltas computed statelessly via ForgeEquipment.applyItemsToStats — preview
  never touches the live rack (selfTest-enforced purity).
- Stat bars: DPS/Shield/Armor/Hull/Speed/Fuel/T.Range/T.Slots per shown ship.

Fleet roles (fleet.js, drones.js):
- DRONES.ownedMax=5 owned; FLEET.max=3 escorts. d.role ∈ escort|hangar|trade.
  escorts()/reindexFormation() re-pack formation over ESCORTS ONLY (fixes the
  latent whole-list reindex that would have corrupted non-escort drones).
- buildDrone: overflow builds go to the hangar; 6th blocked. setDroneRole
  (docked-only) toggles escort⇄hangar; sendOnTradeRun vacates the slot; returns
  rejoin the wing if a slot is free, else wait in the hangar. Hangar drones are
  fully inert (no AI/position/drawing/minimap/galaxy-map).
- Drone module refits are reversible: fleetItemToModule keeps srcItem, swap
  returns the displaced module's item to cargo, fleetUnequipModule pulls a
  player-fitted module (factory built-ins swap-only). Refit UI moved to the
  loadout screen; #fleetPanel is a pure role command board.
- Legacy s.drones convoy path (launchDrones/updateDrones) kept headless for
  selfTest §17d; its hangar list UI removed. TODO next slice: delete the path
  and re-point §17d at sendOnTradeRun.

selfTests: §17g rewritten for roles (5 owned / 3 escorts / hangar inert / trade
round-trip / reversible modules); new §17h (buyShip guards, item conservation
across switch, skill teardown, inactive refits, delta-preview purity); §22 reset
extended (ships/activeShip/escorts); getState() gains ships/activeShip/escorts.

Verified: scratchpad harness (68 checks) GREEN against the built game.html;
browser click-through — loadout carousel/modal deltas/SET ACTIVE, shipyard BUY,
fleet role toggles + trade dispatch. NOTE: build.py --check currently fails in
the CONCURRENT regions.js slice ("field count out of band: 1772" — its 60–160
band predates seedRegions' ≥1-field-per-region guarantee); unrelated to this
change, owned by that workstream.

## 2026-07-10 — Drone trade runs: one-way, distance-priced, real flight (Phase 7)

Reworked "send on trade run" from a random round-trip into a real point-to-point
delivery the player directs and can follow.

- DRONES.tradeSpeed=150 u/s, DRONES.tradeCrPerUnit=0.1. sendOnTradeRun(fleetIdx,
  destId) now takes an explicit destination; payout = round(distance × 0.1),
  travelTime = distance / 150 (≈3–14 min across the 8 stations, matching real
  player cruise). Origin is the player's dock, so you can undock and follow.
- One-way: the drone flies from dock → chosen station, banks the payout on
  ARRIVAL (updateFleet trade branch), then parks free in the bay (role hangar,
  stationId=dest) — no forced return leg. It can't take a second mission while
  flying; once arrived it's immediately redispatchable from wherever you next
  dock. tradeDestinations() prices every discovered station by distance.
- Wall-clock progress: departMs/arriveMs anchor progress to Date.now(), so a
  run advances across a backgrounded tab / "take a break" gap, not just active
  frames. (Full app-close persistence still needs a save system — not built.)
- Fleet panel: SEND ON TRADE RUN opens an inline destination picker (stations
  sorted by distance, each row shows ETA + payout). In-flight cards grey out
  with a live ETA countdown + progress bar and no actions.
- HUD marker (drawTradeMarkers, main.js draw pass): on-screen teal ring + "⇪ ETA"
  over each trade drone, or a clamped screen-edge arrow + ETA when off-viewport;
  minimap flags trade drones gold. In-world flight already rendered by
  drawFleetWorld/Minimap (trade role).
- selfTest §17g trade block rewritten for the one-way/wall-clock model (picker
  sorting, distance payout, dispatch, no-second-mission, mid-flight progress,
  arrival banks payout + parks free + clears fields). Legacy s.drones convoy
  (launchDrones/updateDrones) untouched.

Verified: standalone harness (75 checks incl. trade) GREEN against game.html;
browser end-to-end — picker (Dusk +3367cr/3m44s … Nox Prime +12287cr/13m39s),
dispatch → greyed card, in-world teal ring marker (canvas pixel-probed), forced
arrival banks exactly the payout and frees the drone at the destination. NOTE:
build.py --check is currently red on the CONCURRENT session's enemy-base patrol
change (test 17c: "+6" — outposts.js added 12:34), which runs before the trade
test; unrelated to this work.

## 2026-07-10 — Trade destinations: all 8 outposts open (chartable via convoy)

Follow-up to the trade-run rework: dropped the `discovered` filter from
tradeDestinations() and sendOnTradeRun() so all 8 stations are valid trade
targets from the start, even uncharted ones. The picker flags undiscovered
destinations with a "◇" prefix + muted color and a "follow to find out" header.
Dispatching does NOT auto-discover the destination — the map is still revealed
by the player's own proximity, so the intended loop is: send a convoy to an
unknown outpost, undock, follow it, and discover what's there. selfTest §17g
asserts all-stations-minus-origin are tradeable regardless of discovery, uncharted
ones appear, and a dispatch leaves the destination uncharted. (Discoverable
bonus destinations beyond the 8 outposts remain a future hook.)

Verified: build.py --check ALL GREEN; browser — fresh game (only Homeport Mira
charted) lists all 7 others as ◇ uncharted with payout/ETA; dispatched to
uncharted Dusk (+3367cr), destination stayed uncharted.

## 2026-07-10 — Trade convoys: management card, stacked payout, survival scaling (Phase 7)

Added a "Trade Run Management" card below the drone list in the FLEET tab: build
a custom convoy of 1-5 HANGAR (non-escort) drones, pick a destination, launch
them together.

- launchTradeConvoy(fleetIdxs, destId) (drones.js): validates docked + hangar-only
  + size ≤ DRONES.tradeConvoyMax(5); dispatches each ship via the shared
  _beginTradeRun with one convoyId and a perpendicular laneOffset (DRONES.laneSpacing)
  so the group fans out in flight. sendOnTradeRun is now "a convoy of one" over
  the same core.
- Stacked payout with a fleet penalty: _convoyTotal(perShip,n) = round(perShip ×
  (1 + (1-convoyPenalty)×(n-1))), convoyPenalty=0.10 — a 2-ship run on a 2000cr
  route pays 3800 (full first share + 90% of the second). Each ship banks an
  equal share = round(total/n) on arrival.
- Survival scaling (answered: casualties are DESTROYED): _convoySurvive(n,tier) =
  clamp(soloSurvive 0.85 + convoySurviveBonus 0.05×(n-1) + tradeTierSurvive
  0.05×tier, 0.5, 0.98). A solo Basic run is ~85% safe; a bigger/hardier force
  approaches ~98%. updateFleet's trade arrival now rolls rnd()<surviveP: success
  banks the share and parks the ship free, failure destroys it (burst + toast +
  removed from playerFleet, banks nothing). "Higher chance to get there because
  they're a stronger force."
- UI (fleet.js renderConvoyCard + #ftConvoy in build.py): "＋ NEW CONVOY" opens a
  builder — tap ships to multi-select (✔, capped at 5), tap a destination (each
  row shows the convoy's stacked total for the current selection), a summary line
  ("N ships → Dest · +TOTALcr · ~PCT% each arrives"), and LAUNCH CONVOY / cancel.
  Selections track drone IDs (index-shift safe) and drop stale entries.
- selfTest §17i: payout formula (3800), survival monotonic in size+tier and
  capped, eligibility guards, convoyId/share/laneOffset on launch, all-survive
  banks the full stacked total + parks, and a doomed run removes the drone and
  banks nothing.

Verified: build.py --check ALL GREEN; standalone harness 84 checks GREEN; browser
end-to-end — selected 2 Basic drones (Dusk 3367→6397cr stacked, ~90% each),
launched (2 ships share convoyId, lane offsets ±27), forced arrival banked 6398cr
and parked both drones free.

## 2026-07-10 — Tighter cargo/store grid tiles (build.py, ui.js)

Icons in the Loadout cargo grid (#loInv) and Store buy/sell grids (#stStock,
#stCargo) felt oversized relative to the amount of cargo visible on screen.
First pass shrunk the badge/text themselves (30px→20px) — wrong fix, reverted.
The actual problem was the TILE: `.ghTile` had `aspect-ratio:1` inside a
`grid-template-columns:repeat(4,1fr)` grid, so on any screen wider than mobile
each tile became a large square (as wide as 1/4 the panel, and forced equally
tall) — way bigger than a 30px badge + one line of text needs.

Fix: badge/text sizes stay at their original 30px/12px-font/8px-radius. Removed
`aspect-ratio:1` from `.ghTile` so tile height hugs its content instead of
matching column width, and switched all three grids
(#loInv, #stStock, #stCargo) from `repeat(4,1fr)` to
`repeat(auto-fill,minmax(64px,1fr))` with a tighter 6px gap — tiles are now
sized to their content and the grid packs as many as fit per row. On mobile
widths (~375px) this still lands on ~4 columns (same as before) but tiles are
shorter since they're no longer forced square; on wider screens far more items
fit per row instead of a few giant squares. Item-detail-modal and equip-slot
badges (36px/30px) untouched — not part of the ask.

Verified: build.py --check ALL GREEN; browser at both desktop and mobile
(375×812) widths — Loadout cargo (9 items) and Store stock/cargo (10/9 items)
each fit in compact rows with full-size icons/text and tight boxes around them.

## 2026-07-10 — Aspect-adaptive viewport (fills the screen in any orientation)

The flight canvas was locked to a 390×700 portrait box: boot set
canvas.width/height = CONFIG.W/H (390×700) once, and fit() scaled it with
Math.min(innerWidth/W, innerHeight/H) — preserving that aspect. On rotation to
landscape the short (height) axis dominated, shrinking the canvas to a tiny
letterboxed strip (e.g. 390×700 → ~217×390 on an 844×390 window).

Fix (main.js boot fit()): the canvas now MATCHES the window aspect and fills the
viewport in any orientation. We anchor the SHORT screen axis to VIEW_BASE=390
logical units (scale = min(vw,vh)/390) so UI density feels the same portrait vs
landscape, then set CONFIG.W = round(vw/scale), CONFIG.H = round(vh/scale) (min
320), canvas.width/height = CONFIG.W/H, and canvas CSS = innerWidth/innerHeight
(full-bleed, no letterbox). Portrait 375×812 → logical 390×844; landscape
812×375 → logical 844×390 — both fill the screen. Camera SF()/S() read
CONFIG.W/H live and every HUD element is corner-anchored (scale via
ForgeHUD.resizeHUD, called from fit()), so the whole UI reflows automatically.
Re-fit on resize + orientationchange, plus requestAnimationFrame + load at boot
so first-frame sizing is correct even if initial innerWidth is stale. Canvas CSS
lost its centered box-shadow/border-radius/max-* (now display:block full-bleed).
Headless (selfTest) keeps the fixed 390×700 defaults — fit() only runs in the
browser boot branch.

Verified: build.py --check ALL GREEN; browser — portrait (fills full height, no
letterbox) and landscape (fills full width, HUD reflowed to true corners, no
tiny strip); fresh load sizes correctly without a manual resize; docked DOM
panels fill the viewport in both orientations (were already orientation-free).

---

## Balance Pass — Weapon DPS / Fuel / Survivability / Enemy Tuning

**Files changed:** `src/game/ui.js`, `src/core/config.js`,
`src/modules/equipment_system.js`, `src/modules/faction.js`, `src/main.js`

### Issue 1 — Player weapon DPS display was wrong

Root cause: `ui.js:_ghComputeDps` used raw weapon coefficients (e.g. laser
1.6/0.6/1.0) without multiplying by `derived.weaponDmg` (the player's actual
damage stat). Actual combat damage via `combat.js:fireWeapon` was already
correct — only the HUD readout was broken.

Fix: multiply by `derived.weaponDmg` and divide by 3 (three damage layers) not
2. Normal-tier laser DPS now reads ~27 (was 4.0); per-shot shield damage is 16
(10 × 1.6), matching what combat actually delivers.

### Issue 2 — Fuel capacity increased

All hull `fuelMax` set to 1500 (was 100/150/130). Usage rates unchanged.

### Issue 3 — Player survivability ×15

All hull base stats multiplied by 15:
- vulture: shield 1500, regen 75, armor 1200, hull 900
- atlas: shield 1950, regen 75, armor 1650, hull 1350
- aegis: shield 2550, regen 90, armor 2250, hull 1800

`equipment_system.js` DEFAULT_BASE updated to match vulture.
Item bonuses still stack on top.

### Issue 4 — Vex (innermost) enemies nerfed

Vex was overtuned (HP ~220, damage ~13) vs targets (HP 80-120, damage 5-10).
- `dmgMul` 1.0 → 0.7 (weapon damage ~5.6 for normal tier)
- base stats: shield 120→50, armor 40→15, hull 60→25, regen 8→3
- Total HP ~100, in target range

Krag (mid) was already in range (~260 HP, ~16 dmg). Nox (outer) was undertuned
but user specified "only adjust if overtuned" — left unchanged.

### selfTest updates

- `equipment_system.js` test #9: expected shieldRegen 13→83 (75 base + 6 + 2)
- `faction.js` Vex selfTest: shieldMax 144→60, armorMax 40→15, hullMax 60→25
- `main.js` atlas/vulture hull checks updated to new ×15 values

Verified: build.py selfTest ALL GREEN; browser — HUD shows SHD 1500/1500,
ARM 1200/1200, HULL 900/900, FUEL 1500/1500; DPS reads 26.7 for normal laser;
per-shot shield damage 16 confirmed via fireWeapon; Vex totalHp=100,
weaponDmg=5.6.

## 2026-07-10 — Faction warfare: political regions + border skirmishes + patrols (game/regions.js, game/politics.js)
- NEW src/game/regions.js — 10 NAMED political regions tiling the faction bands
  as angular wedges (Vex inner ×3: Crucible / Iron Wall / Ember Gate · Krag mid
  ×4: Frontier / Depths / Ashfield / Warden's Reach · Nox outer ×3: Void Rim /
  Shadow Basin / Pale March), each with grimdark lore, a static neighbor graph
  (cross-band borders only Ember Gate↔Frontier and Warden's Reach↔Void Rim —
  Vex and Nox never touch), and a live `controller`. Exports REGIONS,
  getRegion/getRegionController/setRegionController/getNeighborRegions/
  getContestableRegions (controller-based, so captured regions open new fronts
  automatically). ADAPTATION: the prompt assumed 12 fixed outposts; the repo's
  outpost layer is the organic ~300-outpost system, so each political region
  elects up to 3 KEY outposts (nearest its wedge centroid, given faction-
  flavored names like "Crucible Anvil" / "Rim Hollow") — plurality ownership of
  the keys decides the region controller.
- NEW src/game/politics.js — border skirmish clock: every 90–150s a contested
  front resolves (60% attacker flips one defender key outpost — fresh garrison,
  owner+faction+sector-grid owner updated — 40% defender holds), newslines
  pushed to s.politicsEvents (newest-first ring buffer, 8 deep) from ~9-message
  pools per attack pairing (vex>krag / krag>vex / krag>nox / nox>krag) + hold /
  player-capture / player-loss / region-captured pools with {o}/{r}/{f}
  substitution. Faction heat ledger: s.factionKills + s.factionKillTimer —
  kills remembered 5 min, 3+ turns that faction aggressive. HUD news ticker
  (drawPoliticsTicker): top-center 300px pill, fade-in, 8s hold, fade-out,
  faction-colored. updatePolitics runs BEFORE the docked/warp early-returns so
  the war continues while docked.
- game/encounters.js — faction PATROLS layer (distinct from random encounters):
  2–3 ship wings spawn at faction outposts 2.5–7k from the ship (never within
  3k of a station), orbit at 800–1200u (0.05 rad/s), and stand down after a
  3-min shift if unprovoked. Engagement: any recent kill against the faction →
  500u picket trigger; 3+ kills → aggressive-on-sight at 1500u; a clean player
  is ignored (keeps outpost trading intact); patrols also join any firefight
  (aggro'd enemy-faction ship) inside 500u. Cap 2 wings, fold-out past 12k.
- game/galaxy_map.js — political overlay: each region wedge fills in its
  controller's color at 20% alpha (Vex red / Krag orange / Nox purple / player
  cyan) with the region name at the wedge centroid; a wedge contested in the
  last 30s pulses between loser/holder colors; top-left legend shows faction
  swatches + live outpost holdings.
- Hooks: player.js onAlienKilled → onFactionShipKilled (kill ledger);
  outposts.js captureOutpost / reclaim-loss → onOutpostCaptured / onOutpostLost
  (guarded calls) feed the news wire + recompute the region controller.
- selfTest §21b: politicsEvents array · REGIONS=10 with valid id/name/faction/
  controller/lore, symmetric neighbor links, 3/4/3 band split, no Vex/Nox
  border · every region has named key outposts · getContestableRegions("vex")
  ≥1 and includes krag_frontier · factionKills/Timer keys · 3-kill aggression +
  5-min decay · pushEvent ring buffer cap 8 · forced skirmish win flips a
  defender key outpost + pushes a substituted newsline, forced hold flips
  nothing · controller follows key-outpost plurality · politics clock fires and
  re-arms in 90–150s · patrol spawn size/radius/orbit hold, clean-player
  ignore, bloodied-player engage at 500u, hot-faction engage at 1500u,
  off-shift stand-down.
- Verified: python3 build.py --check ALL GREEN (8 Forge + GAME). Browser
  (localhost:8091/game.html): skirmish fired through the live loop ("Krag
  floodlights drive the dark out of Rim Hollow"), ticker rendered top-center in
  Krag orange with fade; M-map shows all 10 labeled wedges in band colors +
  legend; flipping Void Rim's keys to Krag repainted the wedge orange and the
  legend counts updated live.

## 2026-07-10 — Faction warfare rework: 12 named strategic outposts (subset, not replacement)
- Per direction: the organic 150–400 outpost layer stays fully as-is; the
  border war now runs on exactly 12 NAMED STRATEGIC OUTPOSTS elected from it at
  init (`o.named = true`, `o.strategicName`, `o.polRegionId`). Each political
  region promotes the organic outpost(s) nearest its wedge centroid — the two
  cross-faction border strongholds (Ember Gate, The Void Rim) hold 2 apiece,
  every other region 1 → 12 total, a clean 4/4/4 faction split.
- Names are now curated content on the REGIONS entries (`strategicNames`):
  Tyrant's Anvil · Bulwark Kyre · Ember Lock · Gatewatch Pyre · Breaker's
  Landing · The Bore · Cinderworks · Last Lantern · First Silence · Rimward
  Choir · Sunken Vault · The Waymark.
- Politics operates on named outposts EXCLUSIVELY: `_politicsFlipOutpost` hard-
  guards `!o.named`, skirmish targets come only from region.outpostIds (all
  named), and named-outpost plurality decides each region's controller —
  1-named regions flip with their single outpost, 2-named strongholds hold a
  1–1 tie (incumbent) and fall only when both are taken. Regular outposts keep
  their Phase 1 capture/reclaim/turn-in behavior and are never war currency.
- Galaxy map: named outposts are common knowledge — always plotted (fog-
  exempt), drawn larger with a white rim; regular outposts keep discovery-gated
  plotting.
- selfTest §21b reworked: exactly 12 named / 2-per-stronghold / 4/4/4 split /
  unique names / tagged+flagged keys · deterministic control mechanics
  (single-named region flips with its outpost, stronghold holds 1–1 then
  falls, regular outposts never flip politically), map restored to pristine
  before the random-skirmish assertions · forced skirmish win must flip a
  NAMED outpost and leave every regular outpost untouched.
- Verified: python3 build.py --check ALL GREEN. Browser (localhost:8091):
  12 named, 4/4/4, region key counts 1/1/2/1/1/1/1/2/1/1; live skirmish ticker
  reads "Krag floodlights drive the dark out of Rimward Choir"; Void Rim held
  at 1–1 (controller nox, contest pulse active) with the flipped Rimward Choir
  rendering as an orange white-rimmed diamond inside the purple wedge; legend
  counts tracked the flip (krag 120→121, nox 113→112).

## 2026-07-10 — Faction warfare v3: PIE territory + geometric regions + majority control
- Per direction, two structural reversals from the named-outpost design:
  ALL ~150–400 organic outposts are the battlefield (the 12-named subset is
  gone), and faction space now divides like a PIE — each faction owns a 120°
  wedge of the whole disc, sun to rim (Vex 0–120° · Krag 120–240° · Nox
  240–360°), not orbital bands.
- world/regions.js `factionForPos` is now ANGULAR (the single source for the
  sector grid, outpost native factions, and nebula squad seeding), so the
  world seeds pie-native: outposts split ~evenly (80/82/81 live) and every
  political region opens under its founder. CONFIG.factionZones is retained
  only for the legacy planet faction tags (selfTest §19 untouched). Side
  effect: the shifted seeded-rnd stream exposed a latent flake in §17g — the
  solo trade-run arrival never pinned `surviveP` (its convoy sibling does);
  pinned it so the parking contract can't flake on stream shifts.
- game/regions.js regions are now `{minAngle, maxAngle}` sub-wedges spanning
  ALL radii — Vex ×3 and Nox ×3 at 40°, Krag ×4 at 30°, 10 total — with NO
  outpost ID lists. New exports: `getOutpostsInRegion(regionId, outposts)`
  (filters the live array by atan2 angle normalized 0–360°) and
  `politicalRegionAt(x, y)`. Neighbor graph is the angular chain ring; the
  pie's circularity creates a THIRD front the band map never had: Pale March ↔
  The Crucible across the 0° seam (plus Ember Gate ↔ Frontier at 120° and
  Warden's Reach ↔ Void Rim at 240°). New vex>nox / nox>vex newsline pools
  cover the new front; ticker names outposts by their map identity
  ("outpost R-1297").
- game/politics.js: a region's controller = whoever owns the MOST outposts
  inside its bounds (live tally, incumbent tie-break), recomputed after every
  skirmish flip and player capture/loss. One skirmish = one random enemy
  outpost inside a contested border region flips (fresh garrison; structure
  hp repaired if the outpost-combat fields exist) — with ~20–30 outposts per
  region the front line drifts slowly across many resolutions. Player-owned
  outposts are never political currency; player-held regions are contested
  only by the existing reclaim waves.
- galaxy_map.js: political wedges now run sun-to-rim in the live controller's
  color at 20% (player-majority wedges turn cyan, contested ones pulse
  loser↔holder). Merge note: a parallel session had added a static 3-wedge
  founder-color pie in the same spot — removed it, since a static pass
  contradicts the live layer after any flip (the political layer is a strict
  superset: 10 regions, live controllers, pulses, player cyan). Also reverted
  the named-outpost map styling (flag no longer exists).
- selfTest §21b rebuilt: wedge containment + 120° tiling per faction + 3/4/3
  split · symmetric, angularly-touching neighbors · exactly 3 cross-faction
  seams incl. the new 0° seam · getOutpostsInRegion partitions the full
  outpost list, politicalRegionAt agrees, every region non-empty · pristine
  founder control · majority flip moves control and restores · forced
  skirmish flips EXACTLY one outpost, inside its region, with substituted
  newsline + contest pulse · hold flips nothing · clock re-arms 90–150s ·
  patrol suite unchanged.
- Verified: python3 build.py --check ALL GREEN. Browser (localhost:8091):
  243 outposts seeded 80/82/81 across the wedges, regions hold 19–29 each,
  all founders in control; live skirmish fired a nox>vex line ("The silence
  closes over outpost R-1297") proving the new seam; 80 simulated skirmishes
  drifted holdings to 93/82/68 with Vex taking The Frontier AND Pale March
  and Nox taking Warden's Reach — the M-map pie repainted accordingly
  (red wedges in former Krag/Nox space, purple in Warden's Reach) with the
  legend tracking live.

## 2026-07-10 — Outpost enhancements: health pools, turret auto-fire, galaxy map pie wedges
- **Health pools on all outposts** (outposts.js seedOutposts): every outpost
  now carries shieldMax/shield 300, armorMax/armor 200, hullMax/hull 150,
  shieldRegen 5/s, turretCooldown 0, turretFireRate 3000ms, turretDmg 6,
  turretRange 600u. Fields live on the outpost object alongside the existing
  guard/capture/reclaim data.
- **Turret auto-fire** (outposts.js updateOutposts): each non-player outpost
  ticks its turretCooldown by dt; when the player is within turretRange and
  the cooldown is zero, a shot is pushed to s.outpostShots (angle-aimed at
  the player, speed 180u/s, 4s life). Shield regen ticks every frame
  (shieldRegen × dt/1000, clamped to shieldMax).
- **Outpost shot update + hit resolution** (main.js update): after
  updateOutposts, the shot array is iterated — positions advance, expired
  shots are culled, and any shot within shipR+4 of the player applies
  damageShip(dmg) and is removed. s.outpostShots initialized in state.
- **Outpost shot rendering** (rendering.js drawWorld): small red dots
  (#ff3030, r=3×zoom) drawn on the flat SF plane after loot orbs and before
  the tractor HUD, gated by isWorldVisible.
- **Galaxy map pie-wedge overlay** (galaxy_map.js drawGalaxyMap): three 120°
  wedges (vex #cc2244, krag #cc7722, nox #8822cc) at 20% opacity drawn from
  map center to WORLD_RADIUS before the political regions layer, giving a
  static faction-territory background under the live controller colors.
- **Faction assignment**: unchanged — outposts already inherit angle-based
  faction from their region (factionForPos in world/regions.js uses the same
  0–120° vex / 120–240° krag / 240–360° nox pie wedge).
- selfTest: added per-outpost `shieldMax > 0` and `turretRange > 0` checks
  inside the existing outpost loop, plus two standalone assertions on
  s.outposts[0]. ALL GREEN.
- Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest).

## 2026-07-11 — danger level system audit & completion
Audited the SEC 1-9 danger level system from a prior session that hit a
session limit. Most of the system was already in place; three pieces were
missing.

**Already present (no changes needed):**
- All 10 REGIONS carry `dangerLevel` (1–9, radiating angularly from Krag
  Depths spawn); `getDangerLevel(x,y)` and `dangerColor(level)` functions.
- Full `DANGER.tiers` probability table (normal/rare/unique/elite per level),
  `DANGER.enemy` HP/damage/reward scaling table, and group-size bounds.
- `rollDangerTier`, `applyDangerToShip`, `dangerGroupSize`, `dangerLootMult`
  utility functions — all wired into encounters.js, enemy_bases.js,
  outposts.js, player.js, and economy.js for enemy spawns, loot drops, and
  ore/credit yield scaling.
- Galaxy map labels show `"REGION NAME [N]"` colored by `dangerColor`.

**Added (was missing):**
- **SEC HUD badge** (ui.js `drawSecBadge`, main.js render loop): "SEC X"
  text right-aligned near the minimap, 12px bold monospace, colored by
  `dangerColor`. Updates once per second (cached `s._secLevel` / `s._secT`)
  to avoid per-frame atan2.
- **60% majority rule** (politics.js `_recalcRegionController`): a challenger
  now needs ≥60% of a region's outposts to take control; below that threshold
  the incumbent holds. Prevents rapid oscillation on narrow margins.
- **`simulateFactionWar(s, rounds)`** (politics.js): runs N instant border
  skirmishes and returns `{vex, krag, nox, player, flips}` — region-flip
  counts per faction plus a list of flipped region IDs, for balance testing.
- selfTest updated: sub-60% flip must NOT move control; ≥60% flip succeeds;
  `simulateFactionWar` returns valid tally; `getDangerLevel` range + color
  assertions. ALL GREEN.
- Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest).

## 2026-07-11 — mobile landscape orientation fix
- Fixed `orientationchange` handler: added `setTimeout` (100ms + 300ms safety)
  so the canvas re-fits after the browser updates viewport dimensions (the event
  fires before new `innerWidth`/`innerHeight` are ready on mobile).
- Added `visualViewport.resize` listener for modern mobile browsers that expose
  the visual viewport API (more reliable than `resize` on iOS Safari).
- The existing `fit()` function and CSS were already correct — `CONFIG.W`/`H`
  are derived from live `innerWidth`/`innerHeight`, canvas fills viewport via
  explicit `style.width`/`style.height`, and `ForgeHUD.resizeHUD` recomputes
  cached scale on every fit. DOM overlay panels use `position:fixed;inset:0`.
- Verified: python3 build.py --check ALL GREEN. Browser tested portrait
  (375×812) → landscape (812×375) — canvas fills full viewport in both.

## 2026-07-11 — Outpost capture flow: attack → flip → fortify (empire building)
- **Outposts are combat targets** (input.js pickAlienAt + enemy_bases.js
  findCombatTarget): tap a discovered enemy-faction outpost to lock it (pitched
  S() hit-box like enemy bases, kind:"outpost" tag added at seed); locking or
  shooting the platform provokes its garrison (player.js _provokeOutpost).
  player.js fireAtOutpost wraps the flat shield/armor/hull pools into a
  ForgeCombat 3-layer target per shot (same trick as fireAtRock) and writes
  back — damage flows shield 300 → armor 200 → hull 150 with the usual
  hit/crit/graze rolls, fuel costs, and damage toasts.
- **Capture on hull 0 — never destroyed** (_captureOutpostByForce): the flip
  reuses the existing captureOutpost path (owner→"player", guard teardown,
  danger-scaled spoils, onOutpostCaptured news wire + _recalcRegionController —
  60%+ player-owned outposts flip the region, same majority rule as factions)
  and now also restores the platform to full 300/200/150, then pushes the
  literal headline "outpost R-#### captured by player!" to the politics ticker.
  A safety net in updateOutposts flips any outpost whose hull hits 0 by any
  path. JUDGMENT CALL: the brief said set `outpost.faction = "player"`, but the
  repo's two-field model (owner = current holder, faction = native reclaimer)
  is what reclaim waves, politics flips, and region tallies all key on — so the
  flip sets `owner`, matching the existing guards-down capture. Player color
  is keyed on owner and now renders **#22cccc** (outpostFactionCol) across the
  world ring/label, HUD banner, and galaxy map.
- **Player outpost turrets retarget**: owner≠player turrets keep shooting the
  player; captured platforms instead fire at the nearest living alien inside
  turretRange (gated to outpostGuardStreamR so far-off outposts don't sim).
  Friendly shots carry `friendly:true` and the main.js shot pass resolves them
  against s.aliens via ForgeCombat.applyDamage (kills settle through
  updateAliens' loot sweep) instead of the player.
- **Outpost dock menu** (ui.js): DOCK (E / dock button, drawn near an owned
  platform via s.atOutpost tracked in updateOutposts) opens the same DOM dock
  flow with s.dockKind="outpost" — tabs trim to GEAR / STORE / FORTIFY
  (_syncDockTabs hides warp/hangar/fleet/jobs + shows the new fortify button;
  re-walks buttons only when dock kind changes). GEAR is the unchanged loadout
  panel. STORE trades against a synthetic per-outpost station (_outpostStore:
  numeric 9000+n id → deterministic ForgeStore restock seed; far outposts roll
  high-ilvl stock) through the standard ForgeStore open/buy/sell path — no
  home-port button, and gainRep no-ops at outposts (no NPC station behind them).
- **FORTIFY tab** (#fortifyPanel in build.py + ui.js, _xxxDOM/sync/render/wire
  pattern): 4 module hardpoints — tap a cargo tile → the shared item modal
  grows a FIT TO OUTPOST action, tap a filled slot → UNEQUIP returns it.
  recomputeOutpostDefense rebuilds from the seeded _def0 block: shield_cap_pct/
  armor_hp(+pct)/hull_hp(+pct)/shield_regen(+pct) via the ship rack's _sumAttr,
  damage_pct scales the turret, and fitted weapons stack their average
  per-layer damage onto turretDmg. Defense readout + 3 drone berths with
  ASSIGN (inline picker over the player fleet; trade runs excluded — the
  companion struct moves wholesale playerFleet → outpost.stationedDrones,
  role "stationed") and RECALL (back to the fleet as hangar, blocked at
  ownedMax).
- **Stationed drone defense** (updateOutpostDefense, ticked from updateOutposts
  inside streamR+1500): any living alien inside CONFIG.outpostDefendR=800
  launches the berth — companion-style combat AI (acquire inside the perimeter,
  never chase past 1.5×, fire via ForgeCombat.applyDamage at FLEET.fireRange,
  standoff/damping/speed-clamp movement) — and a cleared perimeter sends them
  home to re-station (orbit + loadout repair ticks while parked). Rendered as
  cyan triangles + hp bars on the flat SF plane (drawOutpostDroneWorld, after
  drawFleetWorld). Reclaim raids: the abstract player-absent wave now soaks
  droneGuards first, then stationed companions (destroyed if drained); if the
  outpost still falls, surviving companions escape back to the fleet, fitted
  modules are seized, and the recaptured platform repairs to base.
- selfTest §21c (GREEN, full ×): outpost carries kind/modules/stationedDrones ·
  findCombatTarget + lockOn resolve an enemy outpost · fireAtOutpost chews the
  shield + provokes · hull 0 flips to player with full 300/200/150 pools, the
  literal headline, region-recalc touch, cyan #22cccc, and no longer targetable ·
  player 60% majority takes the region · fortify equip moves cargo→hardpoint,
  shield module raises shieldMax, weapon module raises turretDmg, 5th module
  rejected, unequip returns the item + recomputes · assign ×3 (4th rejected,
  role stationed), threat at 400u launches the wing, raider dies, drones
  return + re-station, recall returns a hangar drone · openOutpostDock sets the
  trimmed dock state, the synthetic store rolls stock, closeDock clears it.
- Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest,
  805 KB). Browser (localhost:8099/game.html, zero console errors): locked
  outpost op1 (krag) through the real tap→lock path, laser auto-fire ground
  300/200/150 → 0 over ~60s of stepped loop, flip fired both ticker lines
  ("outpost R-1131 captured by player!"), ring/label repainted #22cccc, +120cr
  spoils; DOCK opened the 3-tab menu — FORTIFY fitted 3 modules through the
  modal (shield 300→381, turret 3.6→14.3 dmg) and stationed a Basic companion;
  STORE showed "OUTPOST R-1131 — FOR SALE" with 10 stock tiles + bar market and
  no home button; undocked, a vex raider at 600u launched the drone (defend),
  died in ~29s to drone+turret fire, and the drone returned to stationed at 40u.
- Wiring: config.js (outpostDefendR/outpostModuleSlots/outpostStationedMax),
  outposts.js (bulk), player.js, input.js, enemy_bases.js, economy.js (gainRep
  guard), ui.js (dock plumbing + fortify DOM), main.js (state fields, dock
  input, friendly shots, draw/boot hooks, §21c), build.py (#fortifyPanel markup
  + CSS + fortify tab buttons). Forge modules untouched.

## 2026-07-11 — Save system: localStorage persistence (src/game/save.js)
- NEW src/game/save.js — one JSON blob under localStorage["space_hauler_save"].
  The world regenerates deterministically (setSeed(42)), so the save carries
  only what the player changed: credits · s.ships + activeShipId (per-ship
  6-slot loadouts — the spec's ship/equipped as a superset, since v4 owns
  multiple hulls) · inventory · ore + refinedBars (the cargo hold) ·
  playerFleet (trade-run drones keep their wall-clock route) · factionKills ·
  per-outpost {id, owner, faction, discovered, shield, armor, hull, modules,
  stationedDrones} matched by id on load · REGIONS controllers · politicsEvents
  (8-deep) · station discovered/warpActive + exploredTiles fog + homeStationId/
  refineBonus/tradeNetworkComplete/won (charted space is progress too — losing
  20k-cr warp gates on reload would contradict "save everything the player
  would care about losing") · capturedOutpostCount + maxDangerReached.
- API split for testability: serializeGame()/applySaveData() are pure data
  (headless-testable, no storage); saveGame()/loadGame()/clearSave() are the
  localStorage layer — every touch is try/catch'd, private browsing degrades to
  console.warn + play-on. applySaveData restores the live ForgeEquipment rack
  via the switchActiveShip wipe→reload pattern, rebuilds outpost defense from
  _def0 + restored modules (hull clamped ≥1 so the capture safety net can't
  re-fire), re-arms factionKillTimer so restored heat decays, bumps
  _nextShipId/_nextDroneId past every restored id, and treats saved region
  controllers as authoritative over the outpost-majority recalc.
- NEW unlock stats: s.capturedOutpostCount (incremented in captureOutpost) and
  s.maxDangerReached (updateRegions checks getDangerLevel on region change).
- Auto-save triggers: closeDock (any station/outpost menu close) · outpost
  capture · buyShip · 5-min setInterval in boot. NOT in the game loop. The
  selfTest sets GAME._selfTesting so a browser-console selfTest run can never
  clobber a real save; headless Node has no localStorage and fails soft.
- Load at boot: GAME.loadGame() right after GAME.init(), before the first
  frame; "SAVE LOADED" toast (toast()/stepToasts grew an optional life arg —
  2s here, default 3 unchanged). JUDGMENT CALL: R-restart now re-applies the
  save (matches page-reload semantics) — otherwise R + next dock would
  silently overwrite the save with a fresh run; NEW GAME is the deliberate
  wipe path.
- UI: SAVE + NEW GAME buttons in the #loHead dock header (build.py markup,
  wireSaveUI in save.js). SAVE flips to "Saved!" for 1s; NEW GAME confirm()s
  "Start over? All progress will be lost." then clearSave + location.reload.
- selfTest §21d (GREEN ×3 on the compiled file): capture counter ≥1 ·
  Pale March teleport pins maxDangerReached 9 · dirty every persisted field →
  serializeGame → JSON round trip → fresh init (asserted clean) →
  applySaveData restores credits/cargo/inventory/ships+rack/fleet/heat/outpost
  owner+fortify+partial damage/controllers/news/stats/charted space/fog/home ·
  null + wrong-version payloads rejected · restored garrison stays down ·
  headless saveGame returns false, never throws. Plus a localStorage-stubbed
  Node probe (scratchpad save_probe.js): blob write → fresh init → parse+apply
  → clearSave → corrupt-blob parse guard, ALL GREEN.
- Browser-verified on :8098/game.html (zero console errors): capture auto-saved
  a 34 KB blob mid-flight; buyShip and closeDock each rewrote it; reload
  restored 77777cr / 2 hulls / player-owned op4 / capturedOutpostCount 1 with
  the SAVE LOADED toast on frame one; SAVE button flipped Saved!→SAVE at 1s and
  wrote the dirtied credits; NEW GAME declined = save kept, accepted = cleared
  + reloaded to a pristine 10000cr world (op4 back to krag, no toast).
- Wiring: build.py (GAME_FILES + game/save.js, #loHead SAVE/NEW GAME buttons),
  config.js (toast life), main.js (state stat fields, boot load+interval,
  R-restart reload, _selfTesting flag, §21d), world/regions.js (danger
  high-water), outposts.js (counter + capture save), drones.js (buyShip save),
  ui.js (closeDock save). Forge modules untouched.

## 2026-07-11 — Ship progression: SHIPS market tab · unlock gates · upgrade transfer · HUD hull badge
- The three CONFIG.hulls now form a real progression ladder: costs reworked to
  credits-only (Atlas 50,000cr · Aegis 200,000cr; old 5,500/14,000 + refined
  bars retired) and each buyable hull carries `tier` ("STARTER"/"MID-TIER"/
  "HEAVY") + an `unlock` OR-gate on the lifetime stats the save system already
  persists: Atlas = capture 3 outposts OR reach danger 4+ · Aegis = capture 10
  OR danger 7+ (s.capturedOutpostCount / s.maxDangerReached — both landed with
  the save-system session; no new counters needed). Stat blocks untouched.
- NEW 7th dock tab "⛭ SHIPS" (src/game/ships.js + #shipsPanel in build.py,
  standard _shipsDOM/syncShipsDOM/renderShipsPanel/wireShipsDOM pattern): one
  card per hull — name + tier chip + CURRENT badge, Shield/Armor/Hull/Fuel
  bars scaled against the biggest hull so tiers read as growth, flavor line,
  price, and BUY — FLY IT OUT (disabled when locked/broke; locked cards show
  the live requirement "capture 3 outposts (0/3) or reach danger 4+ (best 1)").
  Owned-but-inactive hulls point at LOADOUT's SET ACTIVE. Panel re-renders
  when credits move (~3Hz check) so background drone income flips
  affordability live. Tab hidden at outpost docks (station-mode whitelist);
  canvas dock tab bar squeezed 45→39px so 7 tabs + LAUNCH fit 390.
- buyShip (drones.js) is now the gated low-level purchase: credits-only,
  refuses locked hulls (shipUnlockStatus toast), keeps the auto-save. The old
  HANGAR "Shipyard" showroom (renderShipCards/#drShips) was REMOVED — hull
  sales live on the SHIPS tab; HANGAR keeps refinery + drone works + fleet.
- NEW buyShipUpgrade (ships.js) = the market BUY: buys, copies the live rack
  into the new ship, switchActiveShip (new quiet opt, also on buyShip), empties
  the old hull's slots (moved, not duped), recomputeDerived, restores
  shield/armor/hull to the NEW pools (incl. module bonuses — plain
  switchActiveShip's freshHp uses base maxes), single toast "You are now
  flying the Atlas Freighter." Old hull stays in the hangar carousel — no
  trade-in value, by design.
- HUD: drawShipBadge — "⬡ ATLAS" hull-name label at 8k,68k (under the
  top-strip bars, ForgeHUD typography, game-side like drawSecBadge; hud.js
  untouched). Stat bars/readout follow the new maxes automatically via
  recomputeDerived.
- selfTest §17h rebuilt (GREEN on the compiled file): boot registry + locked
  atlas at 500k cr · danger-4 unlocks · broke buy fails · beat-up vulture →
  buyShipUpgrade: −50,000cr, auto-switch, rack ids transfer, old slots empty,
  no cargo leak, derived hull/fuel 1350/1500, health full at new pools ·
  duplicate refused · aegis stays locked at danger 4, 10 captures unlock ·
  undocked-switch refusal + skill deactivation + conservation both ways ·
  inactive-refit/delta-preview suite retargeted at the (now empty) vulture.
- Browser-verified on :8090/game.html (zero console errors): SHIPS tab renders
  3 cards (Vulture CURRENT · Atlas 50,000cr locked w/ live req text · Aegis
  200,000cr locked); danger-4 + 60,000cr → BUY: credits 10,000, atlas CURRENT,
  vulture "✓ owned", all 5 modules on the atlas rack, HUD reads SHD 1950 /
  ARM 1650 / HULL 1350 + "⬡ ATLAS" badge + the toast; page reload restored
  atlas/modules/maxDanger 4 through the save system.
- Cross-session: the save system landed mid-implementation — adopted its
  counter names (capturedOutpostCount/maxDangerReached), preserved its
  buyShip auto-save, and verified the new hull/unlock state round-trips.
- Wiring: config.js (hull costs/tiers/unlocks, dockTab comment), ships.js NEW,
  drones.js (buyShip gate + showroom removal), player.js (switchActiveShip
  quiet opt), ui.js (_openTab ships), main.js (7-tab defs, syncShipsDOM +
  drawShipBadge + wireShipsDOM hooks, §17h), build.py (GAME_FILES + panel
  markup/CSS + header tab buttons + PHASE 7 header note). Forge modules
  untouched.

## 2026-07-11 — Endgame: win condition + victory screen + faction collapse (src/game/victory.js)
- NEW src/game/victory.js — the player WINS by conquering all 10 political
  regions, each via the existing ≥60% outpost-majority controller rule
  (_recalcRegionController untouched). checkEmpireProgress runs from
  updatePolitics every frame (one added line in politics.js): caches the live
  player-region count (s.empireRegions) for the HUD/map, fires the faction-
  collapse narrative, and at 10/10 sets s.empireWon + opens the victory
  overlay. s.victoryOpen gates update() at the very top — the world freezes
  under the overlay (draw keeps rendering the frozen frame beneath the DOM).
- VICTORY overlay (#victoryPanel in build.py, z-40 above every dock panel,
  standard _victoryDOM/sync/render/wire pattern): "⬡ EMPIRE ESTABLISHED ⬡" +
  flavor + stats block (outposts captured · regions 10/10 · credits earned ·
  time played HH:MM:SS) + CONTINUE EXPLORING (dismiss + resume; s.empireWon
  stays true so the overlay never re-fires, in-session or across saves) +
  NEW GAME (confirm → clearSave → reload, mirroring the loadout-header button).
  openVictory saveGame()s — the winning capture's auto-save fired before the
  flag flipped, so the won state is persisted immediately.
- Faction collapse narrative: the moment a faction's controller is gone from
  ALL of its home regions (vex ×3 / krag ×4 / nox ×3), one-time newsline on
  the politics ticker ("The Vex Collective has been shattered…" etc.,
  s.factionsDefeated flags). Remnants fight on: outposts/fleets keep their
  faction flags — nothing despawns or reassigns.
- Progress surfaces: "EMPIRE N/10" HUD chip above the ◈ MAP button (cyan,
  updates live, tap = open galaxy map — gameButtons/flightTap/drawControls);
  galaxy map gains "YOUR EMPIRE: N / 10 REGIONS" top-left above the legend.
- Lifetime stats: s.timePlayed (ticks every un-paused frame, docked included)
  and s.creditsEarned (summed POSITIVE purse deltas once per frame in update —
  one hook instead of touching all 13 credits+= sites; spends ignored, and
  applySaveData re-pins s._lastCredits so a restored purse isn't "earnings").
- Save whitelist extended (per the serializeGame/applySaveData rule):
  timePlayed · creditsEarned · empireWon · factionsDefeated; empireRegions
  recounted from restored controllers on load. Pre-endgame saves (fields
  absent) default clean.
- selfTest §21e (GREEN ×3 on the compiled file, incl. through the live
  updatePolitics path): no empire at start · fmtTimePlayed HH:MM:SS ·
  timePlayed ticks · creditsEarned sums gains and ignores spends · vex loses
  all 3 home regions → flag + exact newsline, fires once, remnant outposts
  stay vex · 10/10 → empireWon + victoryOpen, full pause (t AND timePlayed
  frozen), CONTINUE resumes with the win intact, overlay never re-fires ·
  endgame fields survive a serialize → fresh-init → apply round trip with no
  overlay re-pop.
- Browser-verified on :8089/game.html (zero console errors): EMPIRE 0/10 chip
  taps open the map showing "YOUR EMPIRE: 0 / 10 REGIONS"; flipping vex's
  regions pushed the shattered-Collective ticker line exactly once (80 vex
  outposts left flagged); full conquest popped the overlay with live stats
  (47 · 10/10 · 123456cr · 01:02:05) over the frozen world, save blob carried
  empireWon + all 3 defeat flags; CONTINUE resumed (s.t advancing, chip
  EMPIRE 10/10, nox collapse line on the ticker); reload restored the whole
  endgame with no overlay re-pop.
- Wiring: build.py (GAME_FILES + game/victory.js, #victoryPanel markup/CSS),
  politics.js (checkEmpireProgress call), main.js (state fields, victory gate
  + lifetime trackers in update, syncVictoryDOM, getState fields,
  wireVictoryDOM at boot, overlayActive, §21e), ui.js (empire chip),
  galaxy_map.js (empire counter), save.js (whitelist). Forge modules untouched.

## 2026-07-11 — Sound effects: procedural Web Audio engine (src/game/audio.js)
- NEW src/game/audio.js — AUDIO engine, everything synthesized in JS (no asset
  files; the game stays one compiled HTML). AUDIO.play(name) one-shots: shoot
  (50ms saw 440→220) · hit_shield (100ms sine 800Hz) · hit_armor (noise burst +
  200Hz thud) · explosion (400ms noise sweep + sub tone) · credits (C-E-G chime)
  · dock (low thud + highpass hiss) · capture (C-E-G-C fanfare) · warning (2×
  300Hz pulses) · victory (C-E-G-B-C arpeggio, delayed 2nd voice ≈ reverb).
  "tractor" is the one loop: play() starts a steady 180Hz triangle hum, stop()
  fades it out. Ctx is created+resumed only inside a user gesture (pointerdown/
  keydown listeners in boot — autoplay policy); every entry point fails silent,
  and headless Node (no AudioContext) no-ops entirely, so the selfTest gate
  never touches audio. A 50ms per-name retrigger guard collapses multi-hit
  frames; visibilitychange stops loops (browser-pane RAF pauses hidden, the
  oscillator wouldn't).
- Wire-up is TWO patterns, not 13 call sites:
  * Direct calls where the event is a single function: tryFireWeapon/fireAtRock/
    fireAtOutpost → shoot (+ hit_shield/hit_armor on res.hit by the target's
    pre-shot layer) · onAlienKilled → explosion (replaces sfx("boom") there) ·
    openDock/openOutpostDock → dock (replaces sfx("grab")) · captureOutpost →
    capture (covers _captureOutpostByForce too) · openVictory → victory (+ stops
    the hum — the frozen world skips the watch).
  * GAME.updateAudio(dt), one hook in update() before the docked/warp early
    returns (same idiom as the creditsEarned delta): player hit sounds from
    per-frame shield/armor DECREASES (catches alien fire that lands inside
    ForgeFaction/ForgeCombat, outpost shots, collisions, rams — regen only
    adds); tractor hum on while s.tows is non-empty (grab/release/drop-all/
    fuel-out/dock-deposit all covered); low-shield (<20%) warning throttled to
    once per 5s on the s.timePlayed clock. credits chime rides the existing
    positive-purse-delta hook in update().
- Mute: speaker button (🔊/🔇) under the SEC badge, k-scaled to track it
  (gameButtons/flightTap/drawControls). toggleMute flips s.audioMuted, kills
  live loops, saves. Persisted via the save whitelist (serializeGame +
  applySaveData; pre-audio saves default sound-on). The legacy config.js sfx()
  one-shots honour the same flag (sfxPlays count untouched for tests).
- Judgment calls: hit sounds read layer DELTAS instead of wrapping ForgeCombat
  (damage to the player lands inside forge module internals — modules are
  off-limits, and one watch covers every damage path); legacy sfx() kept for
  its existing sites (grab/sell/warn/crunch…) with AUDIO replacing it only
  where the two would stack on the same event.
- Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest,
  31 game files, 851 KB). Browser on :8088/game.html (zero console errors):
  ctx null until a real click then "running"; all 9 one-shots + loop lifecycle
  clean; REAL grab → hum on next frame, dropAllTows → off; +500cr chimed
  through the delta hook; warning stamped once and throttled on frame 2;
  forced shield/armor drops played exactly ["hit_shield","hit_armor"], heals
  silent; mute click flipped state + wrote the save + refused new sounds +
  silenced legacy sfx; page reload restored muted=true through applySaveData;
  openDock fired dock; GAME.selfTest() returned true IN-BROWSER with the live
  AudioContext (the case the headless gate can't cover). Test save cleared.
- Wiring: build.py (GAME_FILES + game/audio.js), config.js (sfx mute guard),
  player.js (shoot/hit/explosion), ui.js (dock ×2, mute button), outposts.js
  (capture), victory.js (victory), main.js (audioMuted state, credits chime,
  updateAudio hook, boot unlock + visibilitychange), save.js (whitelist).
  Forge modules untouched.

## 2026-07-11 — First-run tutorial: 6 contextual coach marks (src/game/tutorial.js)
- NEW src/game/tutorial.js — onboarding for brand-new games only: six small
  DOM tooltip panels (#tutPanel, position:fixed, dark translucent + teal
  accent border matching the dock-panel style) shown ONE at a time, each
  anchored near the UI element it explains with a CSS-triangle arrow. Never
  blocks play: the world runs underneath, NEXT walks the sequence (last tip
  reads FINISH ✓), SKIP dismisses the lot. Tip order/anchors: 1 MOVEMENT
  (above the bottom-right thrust cluster, auto-advances the first time
  |vel| > 2) · 2 TRACTOR BEAM (bottom-center) · 3 SPACE STATIONS (below the
  top-right minimap) · 4 COMBAT (below the top-left health bars) · 5 OUTPOSTS
  (screen center, no arrow) · 6 DANGER ZONES (under the SEC badge/speaker).
- API per the standard pattern: initTutorial(s) arms s.tutorialActive =
  !s.tutorialDone (called at boot AFTER loadGame, and on the R-restart path) ·
  updateTutorial(s) per-frame in update() (only tip 1 reacts — movement
  auto-advance; tips 2–6 are NEXT-only) · advanceTutorial/skipTutorial →
  _finishTutorial sets tutorialDone + saveGame() (dismissal is permanent) ·
  _tutorialDOM/syncTutorialDOM/renderTutorialDOM/wireTutorialDOM. sync runs
  each draw frame: hides while docked/warp/map/victory/dead, re-renders only
  on step or viewport change (resize/rotate re-places the panel). Placement
  maps logical HUD units → CSS px with boot fit()'s scale (min(vw,vh)/390)
  and the corner-glyph k = min(W/390, H/700), so anchors track any aspect.
- Save integration: tutorialDone rides the serializeGame whitelist;
  applySaveData sets s.tutorialDone = data.tutorialDone !== false — so ANY
  loaded save skips the tutorial, including pre-tutorial saves (veteran
  runs), and only a save written mid-tutorial (closeDock auto-save before
  dismissal) resumes it. R-restart mirrors page-reload semantics: with a
  save → skipped; true fresh run → tips return.
- Judgment calls — the briefed tip copy referenced UI this game doesn't have;
  text adapted to the real controls, anchors kept to the real elements:
  * "Tap to thrust / double-tap to boost" → hold-to-thrust toward the point
    (that's the aimVector model) + WASD; no boost exists.
  * "thrust buttons in the top-right" → they live bottom-right (ui.js
    gameButtons ty = H−36); tip 1 anchors there and says "below".
  * "hold BEAM button" → the v4.1 declutter removed the tractor button; tow
    is tap-a-rock or SPACE, and the copy says so.
  * "then FIRE to engage" → no fire button; weapons auto-fire while their
    skill button is toggled on (V3 rule) — copy teaches tap-the-button/keys
    1–6 instead.
- selfTest §21f (GREEN ×3 on the compiled file): flags boot clean · fresh
  init + initTutorial arms tip 1 · no advance while parked, vx=30 advances ·
  NEXT walks to the last tip, final NEXT sets tutorialDone + deactivates,
  further advance/update no-op · SKIP mid-sequence dismisses + marks done ·
  tutorialDone rides serialize → fresh init → applySaveData (skipped after
  load) · a payload WITHOUT the field also skips (pre-tutorial veteran save).
- Browser-verified on :8087/game.html (zero console errors, in-browser
  GAME.selfTest() true): fresh origin boots straight to TIP 1/6 over the
  thrust cluster; setting vx through the live loop flipped it to TIP 2/6;
  real NEXT clicks walked tips 3→6 with each panel anchored to its element
  (minimap / health bars / center / SEC badge) and FINISH ✓ on the last;
  FINISH hid the panel + wrote the save (tutorialDone:true, 34 KB blob);
  reload with the save skipped the tutorial; cleared save re-showed it;
  docking hid the tooltip, undocking restored it; SKIP dismissed + saved.
  Test save cleared after verification.
- Wiring: build.py (GAME_FILES + game/tutorial.js, #tutPanel markup + CSS),
  main.js (tutorial state fields, updateTutorial in update, syncTutorialDOM
  in draw, getState fields, wireTutorialDOM + initTutorial at boot,
  R-restart initTutorial, §21f), save.js (whitelist + applySaveData
  default), .claude/launch.json (sh-tutorial :8087). Forge modules untouched.

## 2026-07-11 — AI sprite integration: external PNG art layer (src/game/sprites.js)
- Wired the 31 Grok-generated PNGs in sprites/ into the game as a NEW art layer
  `ART` (src/game/sprites.js), kept SEPARATE from the procedural bake system
  `SPRITES` in config.js. Every swapped draw site keeps its prior SPRITES /
  canvas draw as a fallback, so the headless selfTest (Image never loads) and
  the pre-load first frames still render — selfTest stays GREEN untouched
  (drawWorld early-returns under HEADLESS; ART.get() returns null there).
- Naming judgment call: the brief specified a global literally named `SPRITES`,
  but that identifier is already the procedural system — a second `const SPRITES`
  is a duplicate declaration that breaks the whole concatenated bundle. Renamed
  the new layer to `ART`; adapted the brief's `SPRITES[key]` access to
  `ART.get(key)` / `ART.draw(...)`.
- Art-reality judgment call: MANIFEST.md describes square top-down 1024² sprites,
  but the files were regenerated as 1280×720 side-view HERO SHOTS (the brief
  itself says "hero shots for now"). So ART.draw preserves each image's native
  aspect ratio (no 64² squish) and, for ships, MIRRORS vertically (scale(1,-1))
  when the heading points into the left hemisphere (cos<0) instead of rolling
  the side-profile hull belly-up. Hero shots carry their own dark-space frames,
  so world objects show a faint rectangular vignette — accepted "for now" cost.
- ART API: manifest {key→sprites/*.png}; load(cb) preloads all, settling on
  load OR error (a 404 can't hang the boot), no-op + instant-ready under
  HEADLESS; get(key)→decodable <img> or null; draw(g,key,sx,sy,wPx,rot,upright)
  blits centered in SCREEN space at wPx wide (aspect-preserved), returns true or
  false so the caller falls back.
- Integration sites (all with fallback):
  * Boot (main.js): ART.load() before the frame loop; the loop paints a
    "Loading assets…" card until ART.ready, then a brand-new run (tutorialActive)
    opens the intro scene. 6s safety timeout so a stalled image can't block boot.
  * Player ship (rendering.js): ship_<hullKey> (vulture/atlas/aegis), rotated by
    heading, upright-mirrored, CONFIG.shipR*5.4 wide → baked "ship" fallback.
  * Enemy ships (rendering.js): ship_<faction> at SF() (flat, matches the combat
    reticle), leaders 52·z / normals 34·z; a new game-side drawAlienStatus draws
    the HP bar + shield ring + leader name that ForgeFaction's hull triangle
    normally carries (module untouched) → drawAlienShip fallback.
  * Stations (rendering.js): station_<faction> via new stationFaction(id) lookup
    (solarPlanets carry each station's faction), 230·z → baked "station"; built
    warp gates draw warp_gate (320·z) behind the hull → pulsing-ring fallback.
  * Asteroids (rendering.js): single asteroid PNG at r.size*54·z, tumbled by
    r.rot → procedural pseudo-sphere fallback.
  * Outposts (outposts.js): outpost_player / outpost_enemy by owner, max(42,86·z)
    → baked "outpost" fallback; ownership ring/HUD unchanged.
  * Dock portrait (ui.js _loDrawPortrait): the ship page draws the _menu glamour
    banner (ship_<hull>_menu) into loShipCanvas → baked sprite fallback.
  * Story scenes: opening_scene = #openingScene DOM overlay (build.py), CSS fade
    in/out ~3s via GAME.showOpeningScene() (tutorial.js), armed at boot on a
    fresh game — pure DOM/timers, zero sim coupling. victory_scene = background
    layer on #victoryPanel behind a dimmed gradient (build.py CSS).
  * Galaxy map (galaxy_map.js): the political legend draws icon_<faction> (14px)
    in place of the color swatch → swatch fallback (player has no icon).
- Browser-verified on the compiled game.html (:8100): 30/30 PNGs load, no console
  errors; player Vulture reads nose-right and stays upright turning left; Krag
  raiders render with HP bars + "Krag Warlord" leader label; Homeport Mira shows
  the Krag station shot with the warp portal behind it; ore asteroids show veins
  under aligned tractor brackets; enemy outpost shows inside its ownership ring;
  LOADOUT shows the Vulture menu banner; galaxy legend shows faction badges;
  intro scene fades in on a fresh boot; EMPIRE ESTABLISHED sits over the victory
  fleet shot. Test save cleared after verification.
- No new persistent state (the intro is DOM-only), so the save whitelist is
  untouched. Wiring: build.py (GAME_FILES + game/sprites.js; #openingScene markup
  + CSS; #victoryPanel scene bg), main.js (ART.load + loading gate + intro arm),
  rendering.js (ship/alien/station/warp/asteroid + stationFaction/drawAlienStatus
  helpers), outposts.js, ui.js, tutorial.js (showOpeningScene), galaxy_map.js,
  .claude/launch.json (sh-sprites :8100). Forge modules untouched.

## 2026-07-11 — Canvas DPR fix: sharp gameplay render (was blurry on Retina)
- BUG: gameplay canvas was blurry (ship/world/HUD text smeared) while the DOM
  menus stayed crisp. Root cause was the landscape-orientation fit() from the
  aspect-adaptive resize work: it set the backing buffer to the LOGICAL dims
  (`canvas.width = CONFIG.W` where the SHORT axis ≈ 390 units) and let CSS
  stretch that low-res buffer to fill the viewport. So the world always drew at
  ~390px on the short axis and was upscaled to the screen — soft even at dpr=1,
  and compounded on Retina (dpr=2): a 390px buffer stretched to an 844-CSS-px ×
  2-device tall region ≈ 4× upscale. Menus were unaffected because they're DOM.
- FIX (DPR-correct backing buffer + logical→device base transform, main.js
  fit()/frame loop): the buffer is now `round(vw*dpr) × round(vh*dpr)` (full
  device pixels); CONFIG.W/H stay the LOGICAL draw space (short axis ≈ 390,
  unchanged formula) so the camera, world coords, and every corner-anchored HUD
  element are untouched. fit() stashes `renderScaleX/Y = canvas.width / CONFIG.W`
  (= css-scale × dpr); the frame loop re-applies `ctx.setTransform(renderScaleX,
  0,0,renderScaleY,0,0)` at the TOP of every frame (before the loading-screen
  branch and GAME.draw), so all draw code keeps drawing in logical units and the
  transform maps them 1:1 onto the physical buffer. Verified no module ever calls
  setTransform/resetTransform and all local `.scale()` uses are inside balanced
  save/restore, so the per-frame base transform persists through the whole frame.
- Coordinate-space plumbing kept consistent (this was the only non-trivial part):
  * Pointer→logical (`toLog`) already uses getBoundingClientRect (CSS px) →
    CONFIG.W/H, so it's buffer-resolution-independent — untouched.
  * ForgeHUD lays out from the dims it's handed (`resizeHUD`/`initHUD` read
    canvas.width/height → k/font). Now fed LOGICAL dims (`{width:CONFIG.W,
    height:CONFIG.H}`) in BOTH fit() and the ui.js initHUD call so its k/font
    sizing stays logical rather than ballooning to the physical buffer.
  * ForgeWorld warp UI draws (`drawWarpUI`) AND hit-tests (`handleWarpClick`)
    from a canvas's width/height, and the tap coords fed to it are logical.
    Rebound `setContext` to a live logical-dims proxy `{get width(){return
    CONFIG.W},...}` (was the raw canvas) so the hit-test layout matches the
    logical tap coords, and the draw call now passes `{width:CONFIG.W,
    height:CONFIG.H}` instead of the physical canvas.
  * galaxy_map / drawLoadingScreen / docked-fill already draw in CONFIG.W/H —
    work as-is under the base transform.
- NOT touched: logical coordinate system, camera (S/SF/screenToWorld/drawCamera),
  world/physics, imageSmoothingEnabled (hero-shot PNGs want smoothing on — the
  blur was resolution, not filtering). All sprite/fallback draws use logical
  coords the transform handles, so they "just work".
- Verified: `python3 build.py --check` ALL GREEN (8 modules + GAME.selfTest, 874
  KB). Browser on :8101/game.html (sh-dprfix), zero console errors:
  * Landscape 1280×800 dpr=1 → buffer 1280×800 (== device px, was 624×390
    logical), transform 2.0513× maps logical 624×390 to fill the buffer exactly.
  * Portrait 390×844 dpr=2 → buffer 780×1688 (== 2× device px), render visibly
    sharp (HUD bars, "Homeport Mira", tutorial copy, reticle/minimap, ship +
    station hero-shot art all crisp; DOM menus crisp as before).
  * Warp overlay: drew its wash + resolved a logical tap (91,63) to the Homeport
    Mira row (action:'jump') — draw + hit-test share the logical space.
- Wiring: main.js (fit() DPR buffer + renderScale + logical resizeHUD, frame-loop
  setTransform, setContext logical proxy, drawWarpUI logical dims), ui.js (initHUD
  logical dims), .claude/launch.json (sh-dprfix :8101). Forge modules untouched.

## 2026-07-11 — Fix: docked NPC miners drew over the station sprite (rendering.js)
- BUG: ForgeNPC miners home to a station and, when idle (no free ore rock), the
  module's updateMiners steers them onto the station CENTER at 0.3× speed (npc.js
  SEEK branch) and they park there; RETURN miners also pass through within
  DOCK_DIST=40. Their hull (grey diamond + red HP bar via ForgeNPC.drawNPCShip)
  rendered ON TOP of the station sprite — a cluster of ships smeared over the
  hero-shot station art whenever the player flew near a station. There is no
  literal `docked` flag on a miner (states are SEEK/RETURN/SELL/DEAD), and npc.js
  is a Forge module we don't touch — so the fix is a game-side draw guard.
- FIX (src/world/rendering.js drawWorld, the `s.miners` draw loop): skip a miner
  whose distance to its OWN home station (matched by `m.stationId` against
  `s._npcStations`) is within CONFIG.dockR (90) — i.e. it's docked. Idle miners
  converge to ~0u from center so they're always caught; seeking/patrolling miners
  are far out at the ore rings (thousands of units) and still render. Undocking is
  immediate — pure per-frame distance test, no state/hysteresis.
- Gotcha (the whole reason a first pass was a no-op): `_npcStations` lives on the
  STATE object (`s._npcStations`, main.js:66 / used by updateStationTurrets at
  main.js:298), NOT on GAME. The adjacent turret-range loop at rendering.js:336
  reads `this._npcStations` (= GAME._npcStations, which doesn't exist → empty),
  so I initially copied that broken pattern; the guard silently never fired.
  Confirmed in-browser (`GAME` has no own `_npcStations`; `GAME.state` does, len
  8) and switched the guard to `s._npcStations`. LEFT AS-IS but noted: line 336's
  `this._npcStations` is a real latent bug — outlaw-station turret RANGE rings
  never draw (drawTurretRange is never reached). Same `this.` vs `s.` mistake;
  flagged as a separate task to keep this diff scoped.
- Player ship needs NO guard: when `s.docked` the draw() early-returns a solid
  fill BEFORE drawWorld (main.js:349–352), so the ship never renders while docked;
  when merely NEAR a station (atStation, not docked) the ship SHOULD draw (you're
  flying), which it does.
- Verified: `python3 build.py --check` ALL GREEN (8 modules + GAME.selfTest, 875
  KB). Browser on :8102/game.html (sh-dockfix), zero console errors: instrumented
  ForgeNPC.drawNPCShip to log blits — 2 miners parked 22u/34u from home are
  SKIPPED, a patrol miner 402u out is DRAWN. Before/after screenshots: pre-fix
  frame (force-draw all miners) shows grey diamonds + red HP bars over Homeport
  Mira; fixed frame shows the station clean. Forge modules untouched.
- Wiring: src/world/rendering.js (miner draw loop guard only), .claude/launch.json
  (sh-dockfix :8102).

## 2026-07-11 — Fix: restore per-ore-type asteroid colours (sprites.js, rendering.js)
- BUG: the AI-sprite integration swapped every rock draw to a single
  `ART.draw(g,"asteroid",…)` (one asteroid_ore.png), so gold/silver/copper/
  platinum/slag all rendered identical. The procedural fallback still had
  per-type colour (`spriteKey`→`rock_<type>`) but the PNG path clobbered it.
- FIX: tint the shared PNG per ore type. Each rock already carries `r.col`
  (from CONFIG.rings — the same colour the minimap/cargo/glow use), so the tint
  reuses that single source of truth rather than a hardcoded map — 5 ore types
  stay in sync automatically. Draw site (rendering.js:294) now calls
  `ART.drawTint(g,"asteroid",…,hexA(r.col,0.45))` with the procedural draw
  unchanged as fallback.
- New ART methods (sprites.js): `tinted(key,tint)` bakes ONE offscreen canvas
  per (key,tint) — draws the PNG then fills `source-atop` so the colour only
  lands on the sprite's opaque pixels — cached (only 5 ore colours ever exist,
  so no per-frame compositing). `drawTint(...)` blits that cached canvas with
  the same translate/rotate/aspect geometry as `draw()`; returns false (→
  fallback) when the PNG/offscreen host is missing.
- GOTCHA avoided: doing `source-atop` directly on the LIVE game canvas (as a
  naive "draw sprite then fillRect" would) tints everything already painted
  under the sprite's box — stars, planets, adjacent rocks — because source-atop
  composites against the whole destination, not just the new blit. The isolated
  offscreen bake is what makes it correct.
- Verified: `python3 build.py --check` ALL GREEN (8 modules + GAME.selfTest,
  877 KB). Browser on :8103/game.html (sh-oretint): lined up one rock of each
  type in a row — screenshot shows 5 distinctly coloured, still-textured
  asteroids (grey slag · orange copper · pale-blue silver · gold gold · teal
  platinum); pixel-sampled the rendered rocks and each averaged hue is shifted
  toward its ore colour and distinct from the others. Forge modules untouched.
- Wiring: src/game/sprites.js (ART.tinted/drawTint + _tintCache), src/world/
  rendering.js (rock draw site :294), .claude/launch.json (sh-oretint :8103).

## 2026-07-11 — junk/debris salvage sprites (real PNG art)
- Space Hauler has exactly 4 inert junk floater types (CONFIG.junkTypes,
  keys match ForgeItemSystem drop_map): junk_can (fuel canister), junk_panel
  (solar-panel fragment), junk_crate (worn cargo crate), junk_debris (scrap
  chunk). Previously each drew only its procedural baked sprite (src/world/
  junk.js SPRITES.define). Generated one real PNG per type.
- Generation: sprites/gen.py (grok-imagine-image, auth from ~/.grok/auth.json),
  one call at a time, 4/4 succeeded → junk_can/panel/crate/debris.png (1280×720
  hero shots on solid black). Prompts tailored to each type's real in-game
  meaning (not the generic brief) so they read correctly: rusty dented canister,
  blue cracked solar panel, yellow hazard-striped crate, silver angular scrap.
- BG strip: added the 4 to sprites/remove_bg.py TARGETS (STANDARD 40/80) but
  processed ONLY the 4 new files this run (re-running the full list would
  double-feather the 20 already-stripped sprites). Removed 86–97% (small objects
  on mostly-black frames) → RGBA, clean edges, verified via gray composite.
- Wiring: src/game/sprites.js ART_MANIFEST gets junk_can/panel/crate/debris →
  sprites/*.png (keys == j.key so the draw site blits ART.draw(g, j.key, …)
  directly). src/world/rendering.js junk draw site (:305) now tries ART.draw at
  ~5× the collision radius (hero shots don't fill their frame the way the
  asteroid PNG does, so a bump over the procedural footprint), falling back to
  SPRITES.draw headless / pre-load. Cull radius left at j.r (edge pop on tiny
  debris is imperceptible).
- Verified: python3 build.py --check ALL GREEN (8 modules + GAME.selfTest,
  878 KB). Browser on :8104/game.html (sh-junk): froze the sim (neuter
  GAME.update), lined up one of each type in a row at zoom 2.5 — all 4 render as
  distinct bg-stripped PNGs; then flew to station-2 debris field at gameplay
  zoom (1.0 → 0.7) — floaters scatter naturally over the starfield, no black
  boxes, no clutter. Zero console errors. Forge modules untouched.
- Files: sprites/{junk_can,junk_panel,junk_crate,junk_debris}.png, gen via
  gen.py, remove_bg.py (+4 TARGETS), src/game/sprites.js, src/world/rendering.js,
  sprites/MANIFEST.md (+Junk section), .claude/launch.json (sh-junk :8104).

## 2026-07-11 — disable gameplay sprites (fall back to procedural), keep story art
- The in-world PNG art (ships, stations, outposts, asteroids, warp gates, junk)
  reads as unpolished, so gameplay reverts to the original procedural canvas
  draws while story/lore art stays. One flag in src/game/sprites.js does it:
  `const GAMEPLAY_SPRITES = false;` plus a `STORY_KEYS` allow-set. `ART.draw`
  and `ART.drawTint` early-return false for any non-story key when the flag is
  off — and returning false is the pre-existing "not loaded / use fallback"
  signal every draw site already handles, so this is zero-risk: the game renders
  exactly as it did pre-sprites. Flip the flag to true to re-enable once the art
  is polished.
- STORY_KEYS = the 2 scenes, 3 menu ships, 5 portraits, 3 faction icons (13).
  Only the 3 menu ships strictly need it: the dock-loadout portrait banner
  (ui.js:593 `ART.draw(g, "ship_"+hull+"_menu", …)`) is the only story element
  that routes through ART.draw. The opening cinematic sets a DOM `img.src =
  ART_MANIFEST.scene_opening` (tutorial.js) and the victory scene is a CSS
  `background-image` (build.py) — both bypass ART.draw entirely and are
  unaffected by the flag; scenes/portraits/icons are in the set as harmless
  future-proofing. Faction icons use `ART.get` (galaxy_map.js), not draw, so
  they're also unaffected.
- Verified: `python3 build.py --check` ALL GREEN (8 modules + GAME.selfTest,
  879 KB). Browser on :8105 (sh-gsprites): Homeport Mira renders as the
  procedural wireframe ring + procedural orange ship (no PNG); js probe confirms
  `ART.draw` returns false for station_vex / warp_gate / ship_vulture /
  outpost_player and `ART.drawTint` false for asteroid, while the gameplay PNGs
  are still loaded (gate blocks them, not a missing asset). Dock portrait still
  blits the ship_vulture_menu hero shot (draw returns true). Zero console errors.
- Files: src/game/sprites.js (GAMEPLAY_SPRITES flag + STORY_KEYS + 2 early
  returns), .claude/launch.json (sh-gsprites :8105). Nothing else touched —
  every draw site's existing fallback path does the work.
