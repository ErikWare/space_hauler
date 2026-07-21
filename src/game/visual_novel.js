/*=== HARNESS:VISUAL_NOVEL ===================================================*/
// Visual-novel scene player — faction story prologues (and, later, the act
// chains). Renders a background + a composited character portrait card +
// a typewriter dialogue box with choice buttons, all DOM (#vnPanel, z=62,
// over title/opening). The world sim keeps running underneath, same as the
// old static opening scene. Entirely opt-in: the only gameplay hook is the
// showOpeningScene() override at the bottom, which plays the picked faction's
// Act 0 chain on a brand-new game (falling back to the legacy static art if
// a chain is missing or already seen).
//
// Scene node format (canonical copy + authoring notes: storyline/scene-schema.js):
//   { id, background, character: {portrait, expression, position} | null,
//     dialogue: [{speaker|null, text}], choices: [{label, next, flag?}] | null,
//     next: "scene_id" | null, autoAdvance: ms | null }
// A scene with next:null and no choices ends the chain → onComplete fires.
//
// Assets resolve through VN_ASSETS (mirrors storyline/assets/manifest.json —
// keep the two in sync). Missing/pending art falls back along `fallback`
// chains to the five shipped portraits + existing hero art, so every scene
// renders TODAY and upgrades for free when generated art lands in the
// manifest. Persistent story state (choice flags + seen chains) lives in
// s.vn and is whitelisted in serializeGame/applySaveData.

// ---- asset registry (JS mirror of storyline/assets/manifest.json) ----------
// Entries: { src, pos?, zoom?, edge? } or { fallback: otherKey }. pos/zoom
// re-frame the legacy 16:9 art inside the 3:4 portrait card (crops baked-in
// title text off krag_leader.png); edge tints the card border faction-side.
const VN_ASSETS = {
  // backgrounds — existing hero art now, generated interiors later
  bg_space_contested:  { src: "sprites/opening_scene.png" },
  bg_vex_convoy:       { src: "sprites/victory_scene.png" },
  bg_krag_dock:        { src: "sprites/station_krag.png", pos: "center 30%" },
  bg_vex_tribunal:     { src: "sprites/station_vex.png",  pos: "center 30%" },
  bg_vex_hangar:       { src: "sprites/station_vex.png",  pos: "center 65%" },
  bg_nox_cryo:         { src: "sprites/nebula_blue.png" },
  // cold-open intro plates (sprites/intro/) — wide cinematic, no lettering
  // Shared title/system beats, then per-faction paths (krag / vex / nox).
  intro_starfield:         { src: "sprites/intro/intro_starfield.png" },
  intro_solar_system:      { src: "sprites/intro/intro_solar_system.png" },
  // Krag — belt grit, nebula shortcut, asteroid
  intro_krag_ship:         { src: "sprites/intro/intro_vulture_tug.png" },
  intro_krag_cockpit:      { src: "sprites/intro/intro_cockpit.png" },
  intro_krag_hazard:       { src: "sprites/intro/intro_nebula.png" },
  intro_krag_systems:      { src: "sprites/intro/intro_systems_fail.png" },
  intro_krag_impact:       { src: "sprites/intro/intro_impact.png" },
  intro_krag_escape:       { src: "sprites/intro/intro_escape_pod.png" },
  intro_krag_station:      { src: "sprites/intro/intro_station_approach.png" },
  // Vex — sunward lanes, picket interdiction, hangar
  intro_vex_ship:          { src: "sprites/intro/intro_vex_ship.png" },
  intro_vex_cockpit:       { src: "sprites/intro/intro_vex_cockpit.png" },
  intro_vex_hazard:        { src: "sprites/intro/intro_vex_picket.png" },
  intro_vex_systems:       { src: "sprites/intro/intro_vex_systems.png" },
  intro_vex_impact:        { src: "sprites/intro/intro_vex_impact.png" },
  intro_vex_escape:        { src: "sprites/intro/intro_vex_escape.png" },
  intro_vex_station:       { src: "sprites/intro/intro_vex_station.png" },
  // Nox — outer dark, listening signal, cryo dock
  intro_nox_ship:          { src: "sprites/intro/intro_nox_ship.png" },
  intro_nox_cockpit:       { src: "sprites/intro/intro_nox_cockpit.png" },
  intro_nox_hazard:        { src: "sprites/intro/intro_nox_signal.png" },
  intro_nox_systems:       { src: "sprites/intro/intro_nox_systems.png" },
  intro_nox_impact:        { src: "sprites/intro/intro_nox_impact.png" },
  intro_nox_escape:        { src: "sprites/intro/intro_nox_escape.png" },
  intro_nox_station:       { src: "sprites/intro/intro_nox_station.png" },
  // legacy keys (kept so older scene ids / tools still resolve)
  intro_vulture_tug:       { src: "sprites/intro/intro_vulture_tug.png" },
  intro_cockpit:           { src: "sprites/intro/intro_cockpit.png" },
  intro_nebula:            { src: "sprites/intro/intro_nebula.png" },
  intro_systems_fail:      { src: "sprites/intro/intro_systems_fail.png" },
  intro_impact:            { src: "sprites/intro/intro_impact.png" },
  intro_escape_pod:        { src: "sprites/intro/intro_escape_pod.png" },
  intro_station_approach:  { src: "sprites/intro/intro_station_approach.png" },
  // onboarding mission plates (shared visual language across factions)
  onboard_debris:          { src: "sprites/intro/onboard_debris.png" },
  onboard_ore_ring:        { src: "sprites/intro/onboard_ore_ring.png" },
  onboard_ore_rich:        { src: "sprites/intro/onboard_ore_rich.png" },
  onboard_refinery:        { src: "sprites/intro/onboard_refinery.png" },
  onboard_drone_wing:      { src: "sprites/intro/onboard_drone_wing.png" },
  onboard_outpost:         { src: "sprites/intro/onboard_outpost.png" },
  onboard_garrison:        { src: "sprites/intro/onboard_garrison.png" },
  onboard_dock_crowd:      { src: "sprites/intro/onboard_dock_crowd.png" },
  // act 1 interiors/exteriors
  bg_krag_relay:       { src: "sprites/intro/act_krag_ember_relay.png" },
  bg_vex_picket:       { src: "sprites/intro/act_vex_picket.png" },
  bg_nox_deepdark:     { src: "sprites/intro/act_nox_deepdark.png" },
  // act 1 splashes
  krag_splash_moons_debt:   { src: "sprites/intro/act_krag_moons_debt.png" },
  vex_splash_nine_seconds:  { src: "sprites/intro/act_vex_nine_seconds.png" },
  nox_splash_patient_answer:{ src: "sprites/intro/act_nox_patient.png" },
  // Vex / Nox act plates
  act_vex_medical:     { src: "sprites/intro/act_vex_medical.png" },
  act_vex_tribunal:    { src: "sprites/intro/act_vex_tribunal.png" },
  act_vex_hangar_crowd:{ src: "sprites/intro/act_vex_hangar_crowd.png" },
  act_nox_cryo_hall:   { src: "sprites/intro/act_nox_cryo_hall.png" },
  act_nox_mooring:     { src: "sprites/intro/act_nox_mooring.png" },
  act_nox_dock_haze:   { src: "sprites/intro/act_nox_dock_haze.png" },
  // Krag act plates (sprites/intro/act_krag_*) — full campaign visual spine
  act_krag_sealed_crate:    { src: "sprites/intro/act_krag_sealed_crate.png" },
  act_krag_mining_charges:  { src: "sprites/intro/act_krag_mining_charges.png" },
  act_krag_vex_ambush:      { src: "sprites/intro/act_krag_vex_ambush.png" },
  act_krag_courier:         { src: "sprites/intro/act_krag_courier.png" },
  act_krag_survey_wreck:    { src: "sprites/intro/act_krag_survey_wreck.png" },
  act_krag_annex:           { src: "sprites/intro/act_krag_annex.png" },
  act_krag_tether:          { src: "sprites/intro/act_krag_tether.png" },
  // ---- acts 2-3 --------------------------------------------------------
  explosion_debris_field:   { src: "storyline/assets/generated/explosion_debris_field_01.png" },
  explosion_cockpit_impact: { src: "storyline/assets/generated/explosion_cockpit_impact_01.png" },
  explosion_silent_wreck:   { src: "storyline/assets/generated/explosion_silent_wreck_01.png" },
  bg_wreckers_anchorage:    { fallback: "bg_krag_dock" },
  space_splash:             { fallback: "bg_space_contested" },
  // act 2/3 interiors — Krag now has dedicated plates
  bg_krag_terrace:     { src: "sprites/intro/act_krag_terrace.png" },
  bg_krag_archive:     { src: "sprites/intro/act_krag_archive.png" },
  bg_krag_elder:       { src: "sprites/intro/act_krag_elder_hab.png" },
  bg_vex_ghost_relay:  { src: "sprites/intro/act_vex_ghost_relay.png" },
  bg_vex_wreck_site:   { src: "sprites/nebula_red.png" },
  bg_nox_mooring:      { src: "sprites/intro/act_nox_mooring.png" },
  bg_nox_prime:        { src: "sprites/intro/act_nox_prime.png" },
  // act 2/3 splashes
  krag_splash_forged_annex: { src: "sprites/intro/act_krag_forged_splash.png" },
  krag_splash_verdict:      { src: "sprites/intro/act_krag_verdict.png" },
  vex_splash_nine_seconds_again: { src: "sprites/intro/act_vex_nine_seconds.png" },
  vex_splash_banners:       { src: "sprites/intro/act_vex_banners.png" },
  nox_splash_census:        { src: "sprites/intro/act_nox_census.png" },
  nox_splash_wrong_question:{ src: "sprites/intro/act_nox_wrong_q.png" },
  // portraits — the five shipped character paintings (sprites.js:113-117)
  // zoom is height-based ("auto N%") so the vertical crop is exact — it's what
  // crops the baked-in title lettering off krag_leader.png. Calibrated by eye
  // in the live card; re-tune if the source art changes.
  krag_voss_neutral:   { src: "sprites/krag_leader.png",       pos: "center 12%", zoom: "auto 230%", edge: "#ffb45e" },
  krag_voss_proud:     { fallback: "krag_voss_neutral" },
  krag_voss_angry:     { fallback: "krag_voss_neutral" },
  vex_kael_neutral:    { src: "sprites/vex_leader.png",        pos: "center 10%", zoom: "auto 110%", edge: "#ff6a5e" },
  vex_kael_tense:      { fallback: "vex_kael_neutral" },
  vex_kael_angry:      { fallback: "vex_kael_neutral" },
  vex_dren_neutral:    { src: "sprites/station_commander.png", pos: "40% 12%",    zoom: "auto 160%", edge: "#8fd0ff" },
  vex_dren_grim:       { fallback: "vex_dren_neutral" },
  nox_sive_neutral:    { src: "sprites/nox_leader.png",        pos: "32% 8%",     zoom: "auto 140%", edge: "#b48aff" },
  nox_sive_pleased:    { fallback: "nox_sive_neutral" },
  player_hauler_neutral: { src: "sprites/commander_portrait.png", pos: "center 8%", zoom: "auto 180%", edge: "#57d1c9" },
  player_hauler_weary:   { fallback: "player_hauler_neutral" },
  // ---- companions ------------------------------------------------------
  // One per faction, three expressions each. Generated natively at 3:4
  // chest-up, so unlike the legacy paintings above they need no pos/zoom
  // crop. Srcs point at generated/ candidate _01 for the same reason the
  // explosion plates do — the manual pick/copy-to-sprites pass is pending.
  // grave falls back to neutral rather than shipping a wrong-mood card if a
  // candidate gets rejected.
  krag_reva_neutral: { src: "storyline/assets/generated/krag_reva_neutral_01.png", edge: "#e0a878" },
  krag_reva_warm:    { src: "storyline/assets/generated/krag_reva_warm_01.png",    edge: "#e0a878" },
  krag_reva_grave:   { src: "storyline/assets/generated/krag_reva_grave_02.png",   edge: "#e0a878" },
  vex_cade_neutral:  { src: "storyline/assets/generated/vex_cade_neutral_01.png",  edge: "#ffa08f" },
  vex_cade_warm:     { src: "storyline/assets/generated/vex_cade_warm_01.png",     edge: "#ffa08f" },
  vex_cade_grave:    { src: "storyline/assets/generated/vex_cade_grave_01.png",    edge: "#ffa08f" },
  nox_lira_neutral:  { src: "storyline/assets/generated/nox_lira_neutral_01.png",  edge: "#c9a8ff" },
  nox_lira_warm:     { src: "storyline/assets/generated/nox_lira_warm_01.png",     edge: "#c9a8ff" },
  nox_lira_grave:    { src: "storyline/assets/generated/nox_lira_grave_02.png",    edge: "#c9a8ff" },
  // acts 2-3 expressions. player_hauler_battered is the generated "pilot who
  // just took a hit" plate — the only explosion asset used as a portrait card,
  // so it carries the player edge colour.
  player_hauler_battered:{ src: "storyline/assets/generated/explosion_debris_portrait_01.png", pos: "center 12%", zoom: "auto 150%", edge: "#57d1c9" },
  krag_voss_grim:      { fallback: "krag_voss_neutral" },
  vex_kael_shaken:     { fallback: "vex_kael_neutral" },
  vex_dren_tired:      { fallback: "vex_dren_neutral" },
  nox_sive_grave:      { fallback: "nox_sive_neutral" },
  // acts 2-3 new faces — dedicated portraits (sprites/intro/)
  krag_archivist_neutral: { src: "sprites/intro/krag_archivist_neutral.png", edge: "#c98f4e" },
  krag_harrow_neutral:    { src: "sprites/intro/krag_harrow_neutral.png", edge: "#ffd08a" },
  krag_harrow_weary:      { src: "sprites/intro/krag_harrow_neutral.png", edge: "#ffd08a" },
  // job-board fixers — dedicated portraits (sprites/intro/)
  harlan_neutral: { src: "sprites/intro/harlan.png", edge: "#c8a96e" },
  zera_neutral:   { src: "sprites/intro/zera.png",   edge: "#7ec8e3" },
  pell_neutral:   { src: "sprites/intro/pell.png",   edge: "#b48aff" },
  oryn_neutral:   { src: "sprites/intro/oryn.png",   edge: "#ff8c6e" },
};

// speaker name → dialogue-box name colour (null speaker = italic narration)
const VN_CAST = {
  "YOU":    "#57d1c9",
  "VOSS":   "#ffb45e",
  "KAEL":   "#ff6a5e",
  "DREN":   "#8fd0ff",
  "SIVE":   "#b48aff",
  // companions — name colours match their portrait edge in VN_ASSETS
  "REVA":   "#e0a878",
  "CADE":   "#ffa08f",
  "LIRA":   "#c9a8ff",
  // act 1 minor voices — radio traffic and dock hands; no portrait card of
  // their own, so they only ever speak over a splash or another character's shot
  "FOREMAN": "#c98f4e",
  "PATROL":  "#ff6a5e",
  "WING TWO": "#8fd0ff",
  "COURIER": "#9a86c4",
  // acts 2-3 voices. ARCHIVIST/HARROW are Krag; RELAY is the machine that
  // turns out to be talking to everyone; SURVEY 7 is a two-hundred-year-old
  // recording, so it gets a dead-log grey rather than a faction colour.
  "ARCHIVIST": "#c98f4e",
  "HARROW":    "#ffd08a",
  "SURVEY 7":  "#c9d4e4",
  "RELAY":     "#7fe0c0",
  "SECURITY":  "#ff8f6e",
  // the salvage broker who owns you after the Q10 ambush (game/onboarding.js).
  // Salvager green — deliberately outside every faction's palette, because WREN
  // is the first voice in the game that wants nothing from your faction.
  "WREN":      "#9fd36a",
  // job-board fixers — four recurring NPC quest-givers in the mercenary phase.
  // Colours sit outside every faction's palette so they read as independent.
  "HARLAN":    "#c8a96e",    // old salvage broker, weathered belt-gold
  "ZERA":      "#7ec8e3",    // Vex data broker, cool instrument-blue
  "PELL":      "#b48aff",    // Nox fringe fixer, soft violet
  "ORYN":      "#ff8c6e",    // ex-Krag security contractor, warning-orange
};

const VN_TYPE_MS = 14;          // typewriter cadence (2 chars per tick)

// ---- Act 0 scene data ------------------------------------------------------
// Root per faction; every chain terminates in a next:null scene.
const VN_PROLOGUES = { krag: "krag_a0_01", vex: "vex_a0_01", nox: "nox_a0_01" };
// Act 1 — the proving job. Fires once, on the first quest the player accepts
// after their prologue (see the acceptQuest override at the bottom). Same
// per-faction isolation rule as Act 0: a chain only ever references its own
// faction's scenes, so a player sees exactly one of these three, ever.
const VN_ACT1 = { krag: "krag_a1_01", vex: "vex_a1_01", nox: "nox_a1_01" };
// Act 2 — the reveal begins. Act 3 — confrontation and resolution. Same
// per-faction isolation rule; same "chain only references its own act" rule
// that vnSelfTest enforces. Act 2 fires the first time the player docks at
// their original faction's home station after becoming a mercenary (see the
// openDock wrapper at the bottom). Act 3 has no gameplay trigger yet.
const VN_ACT2 = { krag: "krag_a2_01", vex: "vex_a2_01", nox: "nox_a2_01" };
const VN_ACT3 = { krag: "krag_a3_01", vex: "vex_a3_01", nox: "nox_a3_01" };

const VN_SCENES = {};
(function () {
  const add = (sc) => { VN_SCENES[sc.id] = sc; };

  /* ===== KRAG COMBINE — survival. Gritty, weary, defiant. ===== */
  // Promotion frame — then flashback of the run that put you on his list.
  add({ id: "krag_a0_01", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "You've been useful. That's harder to find than it sounds. I want to talk about what comes next." },
      { speaker: null, text: "Six jobs on the Combine ledger — junk, rock, and four grades of ore — and today he says your name like it's a word instead of a berth number." },
      { speaker: "VOSS", text: "But before we talk promotion, you should remember how you got on my list. Because the list is about to get longer." },
      { speaker: null, text: "Before the errands. Before the name. The Ember Gate corridor — contested space, which is the polite word for a graveyard that still shoots back." },
    ],
    choices: null, next: "krag_a0_01b", autoAdvance: null });

  add({ id: "krag_a0_01b", background: "intro_krag_ship", character: null,
    dialogue: [
      { speaker: null, text: "A Vulture-class tug. Three hundred thousand klicks on the drive. A name painted over twice." },
      { speaker: null, text: "Fourteen tons of salvage in the hold: fuel, dock fees, and the loan payment. Barely." },
      { speaker: null, text: "Then the scopes lit up." },
    ],
    choices: null, next: "krag_a0_02", autoAdvance: null });

  add({ id: "krag_a0_02", background: "act_krag_vex_ambush", character: null,
    dialogue: [
      { speaker: null, text: "Two contacts burn in from the shadow of a dead freighter. Vex patrol — long-range lances already warming." },
      { speaker: "YOU", text: "Come on, old girl. Don't die in the dark." },
      { speaker: null, text: "The reactor redlines. The hull groans like it's remembering every hit it ever took." },
      { speaker: null, text: "Fourteen tons of rent. Two lances. One bad arithmetic." },
    ],
    choices: [
      { label: "Dump the salvage. Run empty, run alive.", next: "krag_a0_03a", flag: "krag_dumped_cargo" },
      { label: "Keep the load. Outrun them heavy.",        next: "krag_a0_03b", flag: "krag_kept_cargo" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a0_03a", background: "onboard_debris", character: null,
    dialogue: [
      { speaker: null, text: "Fourteen tons of scrap tumble into the black. The tug leaps like she's young again." },
      { speaker: "YOU", text: "That was rent. That was the loan. That was everything." },
      { speaker: null, text: "But the lances fall behind, and the dark swallows you whole. You make Homeport Mira with an empty hold and a beating heart." },
      { speaker: null, text: "Alive is a kind of wealth. You will spend years learning how expensive it was." },
    ],
    choices: null, next: "krag_a0_04", autoAdvance: null });

  add({ id: "krag_a0_03b", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "You hold the load. The tug bucks through the debris field, threading rocks a drunk wouldn't dare." },
      { speaker: null, text: "A lance clips the aft plating. Alarms. Fire. Foam. Silence." },
      { speaker: "YOU", text: "Still flying. Still flying. That's all that counts." },
      { speaker: null, text: "You limp into Homeport Mira trailing vapor — cargo intact, hull held together by rust and spite. The Combine notices both." },
    ],
    choices: null, next: "krag_a0_04", autoAdvance: null });

  add({ id: "krag_a0_04", background: "bg_krag_dock",
    character: { portrait: "player_hauler", expression: "weary", position: "left" },
    dialogue: [
      { speaker: null, text: "The dock smells of ozone and hot metal. Krag longshoremen watch you walk the ramp — they count your dents the way bankers count debt." },
      { speaker: null, text: "You have no contract, no guild patch, and a fuel gauge reading in insults." },
      { speaker: "YOU", text: "One more run. There's always one more run." },
    ],
    choices: null, next: "krag_a0_05", autoAdvance: null });

  add({ id: "krag_a0_05", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "A shadow falls across the ramp. Dockmaster Voss of the Krag Combine — two and a half meters of scar tissue and bone plate, eyes glowing like furnace slag." },
      { speaker: "VOSS", text: "I watched your approach. Sensor feed, dock cameras, the works." },
      { speaker: "VOSS", text: "You flew a dying tug through a Vex kill-box and walked off the ramp. That's either skill, or an unpaid debt to luck." },
      { speaker: "YOU",  text: "Does it matter which?" },
      { speaker: "VOSS", text: "To the Combine? No. We don't waste ships. We don't waste metal. And we don't waste people who refuse to die." },
    ],
    choices: [
      { label: "I'll take whatever you've got.", next: "krag_a0_06a", flag: "krag_eager" },
      { label: "What's the pay?",                next: "krag_a0_06b", flag: "krag_haggler" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a0_06a", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "proud", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Whatever I've got. Hungry — good. The machine is always hungry too. You'll get along." },
      { speaker: "VOSS", text: "Haul. Salvage. Fight, if it comes to that. Every ton you move feeds the moons — and the moons remember who feeds them." },
    ],
    choices: null, next: "krag_a0_07", autoAdvance: null });

  add({ id: "krag_a0_06b", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Straight to the count. You'll do fine here." },
      { speaker: "VOSS", text: "Standard Combine ledger: tonnage rates, salvage split, hazard bonus if something shoots at you. And out here, something will." },
      { speaker: "VOSS", text: "The Combine pays every chit it owes. We were robbed once — of a whole world. Never again." },
    ],
    choices: null, next: "krag_a0_07", autoAdvance: null });

  add({ id: "krag_a0_07", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "He presses a dented data chip into your palm. It's warm from his hand, and heavy as a verdict." },
      { speaker: "VOSS", text: "Dock privileges, fuel at Combine rates, a berth that doesn't leak. Work, and the machine keeps you." },
      { speaker: "VOSS", text: "The Combine wastes nothing, hauler. Don't be the first exception." },
      { speaker: "VOSS", text: "And when a sled rides heavier than its paper — you tell me the number. Not the paper. Never the paper first." },
    ],
    choices: null, next: "krag_a0_08", autoAdvance: null });

  add({ id: "krag_a0_08", background: "krag_splash_moons_debt", character: null,
    dialogue: [
      { speaker: null, text: "Beyond the viewport the strip-mined moons hang like chewed bones." },
      { speaker: null, text: "Somewhere out there is everything they owe you — and everything you're going to take." },
      { speaker: null, text: "You do not know yet that the debt was never theirs to collect. That knowledge is later. For now: work." },
    ],
    choices: null, next: null, autoAdvance: 7000 });

  /* ===== VEX DOMINION — duty. Disciplined, tense, honour-bound. ===== */
  add({ id: "vex_a0_01", background: "bg_vex_convoy", character: null,
    dialogue: [
      { speaker: "DREN", text: "Six jobs. No incidents. You've met the baseline. There's a conversation we should have." },
      { speaker: null, text: "Six filings, each one accurate, each one boring. In the Dominion that is not faint praise — it is the entire test, and you passed it without being told you were sitting it." },
      { speaker: null, text: "The conversation he wants starts where your file starts, so it starts here." },
      { speaker: null, text: "Convoy VD-77, outbound from Arix with reactor cores for the forward line. Twelve ships. Textbook spacing. Your first escort command." },
      { speaker: null, text: "The ambush took nine seconds to kill eight of them." },
    ],
    choices: null, next: "vex_a0_02", autoAdvance: null });

  add({ id: "vex_a0_02", background: "bg_space_contested", character: null,
    dialogue: [
      { speaker: null, text: "Hunter-packs, out of a sensor shadow the charts swore was empty. Doctrine said: hold formation, interlock shields, await fleet response. Directive Nine. You know it by heart." },
      { speaker: "YOU", text: "Fleet response was forty minutes out. We had ninety seconds." },
      { speaker: null, text: "You broke formation. Drove your escort straight through their firing lane, scattered the survivors into the debris ring, and burned home with four ships that had no right to still exist." },
    ],
    choices: null, next: "vex_a0_03", autoAdvance: null });

  add({ id: "vex_a0_03", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "tense", position: "right" },
    dialogue: [
      { speaker: null, text: "Tribunal Bay Six. The banners hang precise as blades. Adjudicator Kael reads the charge without looking up — he has already memorized you." },
      { speaker: "KAEL", text: "Ensign. You are charged under Directive Nine: abandonment of interlock formation while under fire." },
      { speaker: "KAEL", text: "Eight died in the first nine seconds. Four live because of what you did after. That is precisely the problem." },
      { speaker: "KAEL", text: "Every scar on our bulkheads is logged, numbered, and owed. Yours is on no ledger anywhere. Explain it." },
    ],
    choices: [
      { label: "Doctrine failed out there. I did not.",        next: "vex_a0_04a", flag: "vex_defiant" },
      { label: "I accept the charge. The four were worth it.", next: "vex_a0_04b", flag: "vex_dutiful" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a0_04a", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "angry", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "Doctrine is ten thousand years of the dead teaching the living how not to join them. You do not get to improvise on their graves." },
      { speaker: "KAEL", text: "...and yet. The four live. The record will show the Dominion noticed." },
    ],
    choices: null, next: "vex_a0_05", autoAdvance: null });

  add({ id: "vex_a0_04b", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "You accept the charge. Good. A Vex officer owns every scar — the ship's, and their own." },
      { speaker: "KAEL", text: "Contrition does not erase violation. But it is noted that you count our dead the way we do." },
    ],
    choices: null, next: "vex_a0_05", autoAdvance: null });

  add({ id: "vex_a0_05", background: "bg_vex_tribunal",
    character: { portrait: "vex_dren", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: null, text: "A side hatch cycles. An officer in a patched fleet jacket enters without saluting anyone — Commodore Dren, Special Directorate. Kael's jaw tightens. The tribunal recorder light dies." },
      { speaker: "DREN", text: "Adjudicator, the panel will find the ensign guilty. We both know it. Formation law leaves no room — that is rather the point of it." },
      { speaker: "DREN", text: "So here is the Dominion's arithmetic, ensign. Option one: disgrace, discharge, a long quiet life sunward — wondering what that ambush knew that our charts did not." },
      { speaker: "DREN", text: "Option two: you fly for me. Off the books. No insignia, no ledger, no protection. You go where the fleet cannot be seen to go — and you find out who taught pirates to hide in a blind spot we didn't know we had." },
    ],
    choices: [
      { label: "I fly for the Dominion. Where do I start?", next: "vex_a0_06a", flag: "vex_took_duty" },
      { label: "Off the books means no honour. Why me?",    next: "vex_a0_06b", flag: "vex_asked_why" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a0_06a", background: "bg_vex_tribunal",
    character: { portrait: "vex_dren", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: "DREN", text: "You start by disappearing. There's a tug at berth nine with civilian tags and a hold full of plausible cargo." },
      { speaker: "DREN", text: "You were never here. This conversation is a rumor. The Dominion protects civilization, ensign — someone has to protect the Dominion." },
    ],
    choices: null, next: "vex_a0_07", autoAdvance: null });

  add({ id: "vex_a0_06b", background: "bg_vex_tribunal",
    character: { portrait: "vex_dren", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: "DREN", text: "Honour is what we print on the banners. Duty is what happens in the dark where nobody reads them." },
      { speaker: "DREN", text: "And because you have already proven you will burn the rulebook to bring our people home. I need exactly that — aimed." },
    ],
    choices: null, next: "vex_a0_07", autoAdvance: null });

  add({ id: "vex_a0_07", background: "bg_vex_hangar",
    character: { portrait: "player_hauler", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: null, text: "They strip your insignia in a room with no witnesses. It takes four seconds and feels like surgery. What is left is a pilot, a tug, and a heading." },
      { speaker: "YOU", text: "Every scar logged, numbered, and owed. Fine. Start the ledger with mine." },
      { speaker: null, text: "Berth nine. Civilian tags. A hold full of someone else's story. You lift off sunward — into a war that is not what it says it is." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* ===== NOX COVENANT — mystery. Unsettling, elegant, cold. ===== */
  add({ id: "nox_a0_01", background: "bg_nox_cryo", character: null,
    dialogue: [
      { speaker: "SIVE", text: "Your performance has been logged. We have a classification decision to make about you." },
      { speaker: null, text: "Six errands, run without complaint and without asking what any of them were for. The Covenant has read the record and decided you are worth naming." },
      { speaker: null, text: "Before it names a thing, it reviews it. And the review begins where you began." },
      { speaker: null, text: "Cold. Not the cold of space — the cold of procedure. Something is thawing you on a schedule." },
      { speaker: null, text: "A heartbeat. Yours, probably. It sounds borrowed." },
      { speaker: null, text: "The pod lid lifts like a slow eyelid." },
    ],
    choices: null, next: "nox_a0_02", autoAdvance: null });

  add({ id: "nox_a0_02", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: null, text: "A figure waits in the frost-haze, robed in fabric stitched with slow constellations. Its face is glass and galaxy. It has been watching you sleep." },
      { speaker: "SIVE", text: "Good morning. Do not try to stand — the body forgets gravity faster than it forgives it." },
      { speaker: "SIVE", text: "You will have questions. The first three are always the same: where, how long, and who is this talking." },
      { speaker: "SIVE", text: "In order: the Covenant vessel Patient Answer, in the outer dark. Longer than you would prefer. And I am Sive. Your handler." },
    ],
    choices: null, next: "nox_a0_03", autoAdvance: null });

  add({ id: "nox_a0_03", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Handler. I don't remember volunteering for... any of this." },
      { speaker: "SIVE", text: "No. You wouldn't. Memory is heavy, and you crossed the dark as light cargo." },
      { speaker: "SIVE", text: "But you did volunteer. I can show you the record — your signature, your voice, your reasons. Would you like to see your reasons? Most decline." },
    ],
    choices: [
      { label: "Show me the record.",                 next: "nox_a0_04a", flag: "nox_saw_record" },
      { label: "Keep it. Tell me what I am to you.",  next: "nox_a0_04b", flag: "nox_refused_record" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a0_04a", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "A pane of dark glass wakes. Your own face looks out — thinner, exhausted, resolute. It says: 'I understand the terms. Take what you need. What's left is enough.'" },
      { speaker: "YOU",  text: "What's left... What did you take?" },
      { speaker: "SIVE", text: "Nothing that was doing you any good. Debts. Griefs. A name you flinched from. We are very careful movers." },
    ],
    choices: null, next: "nox_a0_05", autoAdvance: null });

  add({ id: "nox_a0_04b", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "SIVE", text: "Most decline. Wise. A stranger's reasons fit poorly — like borrowed boots." },
      { speaker: "SIVE", text: "As for what you are to me: patience. I was just coming to that." },
    ],
    choices: null, next: "nox_a0_05", autoAdvance: null });

  add({ id: "nox_a0_05", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "The Covenant does not employ. It invests. We have placed years of patience, a hull, and several quiet favors into the person now shivering in front of me." },
      { speaker: "SIVE", text: "You are an investment. My investment. I intend to see you appreciate." },
      { speaker: "YOU",  text: "And if I refuse? If I just fly away?" },
      { speaker: "SIVE", text: "Then you will fly away in the asset we gave you, burning fuel we refined, under charts we drew. Refusal is simply appreciation by another route. Everything is." },
    ],
    choices: null, next: "nox_a0_06", autoAdvance: null });

  add({ id: "nox_a0_06", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "pleased", position: "center" },
    dialogue: [
      { speaker: null, text: "Sive folds their hands. The constellations stitched into their sleeves drift a fraction out of true." },
      { speaker: "SIVE", text: "A ship waits for you. Small, patient, unremarkable — the Covenant's favorite qualities." },
      { speaker: "SIVE", text: "Haul. Trade. Grow strong in the light, where the young factions bicker. And when the dark asks something of you — and it will — remember what you are worth to it." },
      { speaker: "SIVE", text: "Fly well. We will be watching our investment appreciate." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* ========================================================================
     ACT 1 — THE PROVING JOB. One chain per faction, played on the first
     quest accepted after the prologue. Shape is the same three-beat spine
     everywhere (briefing → complication → settlement) so the acts stay
     comparable; the CONTENT is the faction's own argument with itself.
     Each chain ends on a hook, never on a reveal — Act 1 raises the
     question its act 2 is going to answer.
     ===================================================================== */

  /* ===== KRAG — "THE LEDGER". The debt is the leash. First job for Voss:
     a sealed container and no questions. Hook: the ambush knew the route. */
  add({ id: "krag_a1_01", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "You came back. Good. Half of them don't, and the other half come back asking for lighter work." },
      { speaker: "VOSS", text: "One container. Sealed at the Combine end, opened at the Combine end. It rides to the Ember Gate relay and you hand it to a man who won't give you his name." },
      { speaker: "YOU",  text: "What's in it?" },
      { speaker: "VOSS", text: "That's the part you're paid not to ask. The pay is good precisely because the question is expensive." },
      { speaker: "VOSS", text: "And if a sled rides heavy — you already know what I want to hear first." },
    ],
    choices: null, next: "krag_a1_02", autoAdvance: null });

  add({ id: "krag_a1_02", background: "act_krag_sealed_crate",
    character: { portrait: "player_hauler", expression: "weary", position: "left" },
    dialogue: [
      { speaker: null, text: "The loaders bring it up on a grav-sled and the sled sits low — lower than the manifest wants you to believe." },
      { speaker: "FOREMAN", text: "Says four tons. Rides like nine. Sled don't read paperwork." },
      { speaker: null, text: "The seal is Combine-stamped, wax over a magnetic lock. Breaking it would be obvious. Breaking it would also be answering the question Voss priced." },
      { speaker: null, text: "You can feel the Combine watching both choices. That is what a ledger is — a way of watching without being present." },
    ],
    choices: [
      { label: "Crack the seal. Know what you're carrying.", next: "krag_a1_03a", flag: "krag_a1_opened_crate" },
      { label: "Leave it sealed. Ignorance is the job.",     next: "krag_a1_03b", flag: "krag_a1_sealed_crate" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a1_03a", background: "act_krag_mining_charges", character: null,
    dialogue: [
      { speaker: null, text: "The wax gives with a sound like a knuckle cracking. Inside: mining charges, packed in rows, Combine-milled — and stencilled in a hand you don't recognise." },
      { speaker: null, text: "Not ore. Not relief crates. Nine tons of things that make holes." },
      { speaker: "YOU", text: "Four tons of ore. Right." },
      { speaker: null, text: "You re-seat the wax as best you can. It'll pass a glance and fail an inspection, which is exactly the margin you fly in." },
      { speaker: null, text: "You file the number in your head: nine. Not four. Nine." },
    ],
    choices: null, next: "krag_a1_04", autoAdvance: null });

  add({ id: "krag_a1_03b", background: "act_krag_sealed_crate", character: null,
    dialogue: [
      { speaker: null, text: "You leave the wax alone. Twenty years hauling taught you the trick of it: you don't carry the cargo, you carry the paperwork, and the paperwork says four tons of ore." },
      { speaker: "YOU", text: "Four tons of ore. Whatever you say." },
      { speaker: null, text: "The sled still rides low all the way to the ramp. You make a point of not watching it — and you still know." },
      { speaker: null, text: "Ignorance is a skill. You have never been as good at it as you pretend." },
    ],
    choices: null, next: "krag_a1_04", autoAdvance: null });

  add({ id: "krag_a1_04", background: "bg_krag_relay", character: null,
    dialogue: [
      { speaker: null, text: "The Ember Gate relay hangs in the dark like a lamp nobody's tending — six hours out, no traffic, no chatter." },
      { speaker: null, text: "Then two Vex lances come off the relay's blind side, already lit, already tracking. Not searching. Waiting." },
      { speaker: "PATROL", text: "Combine hauler. You are carrying restricted freight on a filed civilian manifest. Cut your drive." },
      { speaker: "YOU",  text: "Filed. They said filed." },
      { speaker: null, text: "Somebody handed them your route. Somebody with a copy of a manifest that only three people should have." },
    ],
    choices: [
      { label: "Burn for the relay. Deliver or die trying.", next: "krag_a1_05a", flag: "krag_a1_ran_gauntlet" },
      { label: "Open a channel. Make them say it out loud.", next: "krag_a1_05b", flag: "krag_a1_opened_channel" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a1_05a", background: "act_krag_vex_ambush", character: null,
    dialogue: [
      { speaker: null, text: "You firewall it. The tug is nine tons over and flies like a barge full of wet sand, and you fly her anyway, straight down the relay's throat where the lances can't lead you without hitting their own dish." },
      { speaker: null, text: "Something hits aft. Something always hits aft." },
      { speaker: null, text: "You come out the far side venting atmosphere, cargo intact, hands steady in the way that only happens after." },
      { speaker: "YOU", text: "Still flying. File that." },
    ],
    choices: null, next: "krag_a1_06", autoAdvance: null });

  add({ id: "krag_a1_05b", background: "act_krag_vex_ambush", character: null,
    dialogue: [
      { speaker: "YOU",    text: "Patrol, this is the hauler. You called my freight restricted before you scanned it. How's that?" },
      { speaker: null,     text: "A pause. Three seconds of open channel, which is a very long time when two lances are warm." },
      { speaker: "PATROL", text: "...Cut your drive, hauler." },
      { speaker: null,     text: "Not a denial. You log the timestamp, because a pause like that is worth more than the cargo, and you run while they're still deciding what to say next." },
      { speaker: null,     text: "Three seconds. You will hear them again in other rooms, later, when people who file things pretend they do not know you." },
    ],
    choices: null, next: "krag_a1_06", autoAdvance: null });

  add({ id: "krag_a1_06", background: "act_krag_courier", character: null,
    dialogue: [
      { speaker: null,    text: "The man at the relay doesn't give his name. He doesn't check the seal either — he checks the WEIGHT, on a scale he brought himself." },
      { speaker: "COURIER", text: "Nine. Good. Tell Voss it's nine." },
      { speaker: null,    text: "He signs a chit that says four, and hands it over without any expression at all." },
      { speaker: null,    text: "Four on paper. Nine in the world. The Combine lives in the gap — and so, today, do you." },
    ],
    choices: null, next: "krag_a1_07", autoAdvance: null });

  add({ id: "krag_a1_07", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "proud", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Nine tons delivered on a four-ton chit, one hauler, no losses. You'll do." },
      { speaker: null,   text: "He counts credits onto the counter the old way, in stacks, so you can watch the number grow. It's more than the run was worth. It's meant to be noticed." },
      { speaker: "YOU",  text: "They were waiting at the relay, Voss. Lit up, on my route, six hours out with no traffic." },
      { speaker: "VOSS", text: "I heard." },
      { speaker: null,   text: "He does not look surprised. That is worse than if he had." },
    ],
    choices: null, next: "krag_a1_08", autoAdvance: null });

  add({ id: "krag_a1_08", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Then you know what it means. Three people had that route." },
      { speaker: "VOSS", text: "Four. You're forgetting the man who filed it, and he's Combine to the bone, and he's been Combine longer than you've been alive." },
      { speaker: "VOSS", text: "So either the Vex are reading our filings, or somebody upstairs is selling them. I've been carrying that arithmetic for a while now and I don't like where it lands." },
      { speaker: "VOSS", text: "Keep flying. Keep the chit. Next time a sled rides heavier than its paper — you tell me the number, not the paper." },
      { speaker: "VOSS", text: "And if you hear a name like Reva on the salvage channels — leave her alone. Or don't. She bites either way." },
    ],
    choices: null, next: "krag_a1_09", autoAdvance: null });

  add({ id: "krag_a1_09", background: "krag_splash_moons_debt", character: null,
    dialogue: [
      { speaker: null, text: "Lifting out of Homeport Mira, the moons come up over the shoulder of the world the way they always do, and you look at them the way you never do." },
      { speaker: null, text: "Three of them, strip-mined to the mantle. Terraced down to nothing in forty years of shifts your parents worked and their parents worked. Chewed bones in a low orbit." },
      { speaker: null, text: "The Combine took them apart in a hurry, and everyone alive remembers why: the Vex were coming, and a moon is worth less than a fleet." },
      { speaker: null, text: "You have never once questioned that. Neither has anyone you know. It is simply the shape of the sky you grew up under." },
      { speaker: null, text: "A chit that says four. A scale that said nine. A pause on an open channel that was not a denial." },
      { speaker: null, text: "Somewhere under those moons, the arithmetic is already walking toward a door." },
    ],
    choices: null, next: null, autoAdvance: 10000 });

  /* ===== VEX — "THE PICKET". Dren gives the assignment; Kael's tribunal
     still owns the leash. The order and the right thing are nine seconds
     apart. Hook: the interdiction list had a civilian on it. */
  add({ id: "vex_a1_01", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "There you are. Tribunal's got you flagged provisional, which means every hour you fly is an hour somebody's writing down." },
      { speaker: "DREN", text: "So let's give them something dull to write. Border picket, Ember Gate approach. You sit on the line, you log what crosses, you interdict anything on the list." },
      { speaker: "YOU",  text: "And if something not on the list crosses?" },
      { speaker: "DREN", text: "Then it isn't on the list. That's rather the elegance of a list." },
    ],
    choices: null, next: "vex_a1_02", autoAdvance: null });

  add({ id: "vex_a1_02", background: "act_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "Kael is waiting at the hangar mouth. He does not appear to have walked there; he simply is there, the way a rule is." },
      { speaker: "KAEL", text: "Commodore Dren will have told you this posting is dull. He tells everyone that. It makes them careless in an instructive way." },
      { speaker: "KAEL", text: "Understand the terms as I understand them. You are not being trusted. You are being MEASURED. The picket log is the instrument." },
      { speaker: "KAEL", text: "Log what crosses. All of it. A gap in a log is a confession with better manners." },
    ],
    choices: null, next: "vex_a1_03", autoAdvance: null });

  add({ id: "vex_a1_03", background: "bg_vex_picket", character: null,
    dialogue: [
      { speaker: null, text: "Nine hours on the line. You log a Combine ore barge, two Dominion tenders, a survey drone with a bad transponder, and a great deal of nothing." },
      { speaker: null, text: "Then the tenth hour brings a hull off the Ember Gate approach at an angle nobody flies on purpose — running hot, running silent, transponder dark." },
      { speaker: "WING TWO", text: "Picket, I have it. Cross-referencing... it's on the list. Interdict authorised." },
      { speaker: null, text: "Your own scope says something else. The heat signature is wrong for a runner. It's wrong for anything with guns." },
      { speaker: null, text: "Nine seconds is the whole of a doctrine. You can feel the number in your hands." },
    ],
    choices: null, next: "vex_a1_04", autoAdvance: null });

  add({ id: "vex_a1_04", background: "vex_splash_nine_seconds", character: null,
    dialogue: [
      { speaker: null, text: "Every Dominion pilot is taught convoy VD-77 in their first week, and taught it as a clock." },
      { speaker: null, text: "A picket officer held fire on a dark hull for nine seconds — long enough to be certain, which is what he said afterward, at the tribunal, before the finding." },
      { speaker: null, text: "The dark hull was a Combine lance. VD-77 was eleven ships. It took nine seconds." },
      { speaker: null, text: "That is the whole of the doctrine, and it is not a stupid doctrine: certainty is a luxury paid for by whoever is standing behind you." },
    ],
    choices: null, next: "vex_a1_05", autoAdvance: 9000 });

  add({ id: "vex_a1_05", background: "act_vex_medical", character: null,
    dialogue: [
      { speaker: null, text: "You put a narrow scan on it, which takes nine seconds, which is nine seconds longer than the order allows." },
      { speaker: null, text: "It's a medical tender. Civilian registry, Combine-flagged, ninety-one souls aboard and a reactor bleeding neutrons into the cabin space. Running dark because its transponder is on fire." },
      { speaker: "WING TWO", text: "Picket? You're not firing. It's ON THE LIST." },
      { speaker: null, text: "The list does not have faces. Your scope does." },
    ],
    choices: [
      { label: "It's on the list. Interdict.",            next: "vex_a1_06a", flag: "vex_a1_held_the_line" },
      { label: "Break off. Ninety-one people is a fact.", next: "vex_a1_06b", flag: "vex_a1_broke_formation" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a1_06a", background: "act_vex_medical", character: null,
    dialogue: [
      { speaker: null, text: "You interdict. The tender cuts its burn and goes dead in the water the moment your lances paint it — no evasion, no answer, nothing but a hull full of people waiting to see what you are." },
      { speaker: null, text: "Boarding finds the reactor exactly where your scan said it was. Fourteen dead of exposure before the Dominion crews get the shielding up. It would have been ninety-one without the intercept." },
      { speaker: null, text: "The order was right. You obeyed it for nine seconds too late and it was still right. That sits in your chest oddly for days." },
    ],
    choices: null, next: "vex_a1_07", autoAdvance: null });

  add({ id: "vex_a1_06b", background: "act_vex_medical", character: null,
    dialogue: [
      { speaker: "YOU",       text: "Wing Two, break off. That's a medical hull, ninety-one aboard, reactor's cooking them." },
      { speaker: "WING TWO",  text: "That is not the call you get to make." },
      { speaker: null,        text: "You make it anyway. You put your tug between the lances and the tender and you burn alongside it all the way to the Dominion mooring, close escort, close enough to read its hull number." },
      { speaker: null,        text: "Fourteen die of exposure before the crews get shielding up. Without the escort it would have been all of them. Nobody thanks you. The log records a formation break." },
      { speaker: null,        text: "You will meet Cade later. He will understand the log and the break. Kael will understand only the log." },
    ],
    choices: null, next: "vex_a1_07", autoAdvance: null });

  add({ id: "vex_a1_07", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "I've read the log. So has Kael, twice, which for him is affection." },
      { speaker: "YOU",  text: "A civilian medical hull was on an interdiction list, Commodore. Ninety-one aboard. Who puts a hospital on a list?" },
      { speaker: "DREN", text: "Nobody puts it there. It arrives there. A hull runs dark, dark hulls get flagged, flags get compiled, and by the time it's a list it hasn't got people on it any more — it's got entries." },
      { speaker: "DREN", text: "That's not a defence of the list. That's a description of one. I've stopped confusing the two, and it took me thirty years." },
    ],
    choices: null, next: "vex_a1_08", autoAdvance: null });

  add({ id: "vex_a1_08", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "tense", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "Your log is complete. I have no finding to make against you, and I want you to understand how little comfort you should take from that." },
      { speaker: "YOU",  text: "The list was wrong." },
      { speaker: "KAEL", text: "The list was FOLLOWED. Those are different failures and only one of them is mine to correct." },
      { speaker: "KAEL", text: "But you asked who compiles it. So did I, this morning, in writing. The answer I received was a form number." },
    ],
    choices: null, next: "vex_a1_09", autoAdvance: null });

  add({ id: "vex_a1_09", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "He sets a slate on the bench between you. A form number, a countersign, and an originating office that is not a Dominion office you have ever heard of." },
      { speaker: "KAEL", text: "The Dominion does not make errors of this kind. We make errors of excess — we fortify what needs no fortifying. We do not misplace hospitals." },
      { speaker: "KAEL", text: "So I will ask the form number where it came from, through the proper channel, at the proper pace. And you will fly your picket and log every single thing that crosses it." },
      { speaker: "KAEL", text: "Dismissed, pilot. Keep the slate. I have another." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* ===== NOX — "THE ERRAND". Sive sets a task too small to matter. The
     task is not the point; the measurement is. Hook: what got measured. */
  add({ id: "nox_a1_01", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "Your first errand. I have made it small on purpose — an investment is not tested by throwing it at a wall." },
      { speaker: "SIVE", text: "A case. Sealed. You will carry it to a mooring in the deep dark and give it to someone who will be expecting you. You will not open it. You will not scan it." },
      { speaker: "YOU",  text: "And if I do?" },
      { speaker: "SIVE", text: "Then you will have opened it, and scanned it, and I will know something about you that I did not know this morning. Nothing is wasted here." },
    ],
    choices: null, next: "nox_a1_02", autoAdvance: null });

  add({ id: "nox_a1_02", background: "bg_nox_deepdark", character: null,
    dialogue: [
      { speaker: null, text: "The case weighs almost nothing. That's the first thing wrong with it." },
      { speaker: null, text: "Eleven hours into the dark, well past the last charted beacon, and the case has not made a sound, not shifted in its cradle, not done any of the small things cargo does." },
      { speaker: null, text: "It has a seam. No lock — a SEAM, the way a shell has one. It would open if you asked it to." },
    ],
    choices: [
      { label: "Open it. She said nothing is wasted.",  next: "nox_a1_03a", flag: "nox_a1_opened_case" },
      { label: "Scan it. Learn without touching.",      next: "nox_a1_03b", flag: "nox_a1_scanned_case" },
      { label: "Leave it. Carry the thing and land it.", next: "nox_a1_03c", flag: "nox_a1_left_case" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a1_03a", background: "bg_nox_deepdark", character: null,
    dialogue: [
      { speaker: null, text: "The seam opens under your thumb like it was waiting to be asked." },
      { speaker: null, text: "Inside: nothing. Not padding, not a void — a fitted, moulded, carefully machined emptiness, shaped to hold an object that was never put in it." },
      { speaker: "YOU", text: "...It's empty." },
      { speaker: null, text: "Somebody built a case to carry nothing eleven hours into the dark, and somebody is expecting it." },
    ],
    choices: null, next: "nox_a1_04", autoAdvance: null });

  add({ id: "nox_a1_03b", background: "bg_nox_deepdark", character: null,
    dialogue: [
      { speaker: null, text: "You run the hold scanner across it — passive, no emission, nothing that touches the case at all. A technicality, and you know it's a technicality while you're doing it." },
      { speaker: null, text: "The return is a clean hollow. Mass consistent with the shell alone. Whatever the case is for, it isn't in there." },
      { speaker: "YOU", text: "Eleven hours to deliver an empty box." },
      { speaker: null, text: "The scanner logs the sweep with a timestamp. Everything on this ship logs everything. You knew that too." },
    ],
    choices: null, next: "nox_a1_04", autoAdvance: null });

  add({ id: "nox_a1_03c", background: "bg_nox_deepdark", character: null,
    dialogue: [
      { speaker: null, text: "You don't touch it. You fly the eleven hours with a seam three metres behind your seat and you keep your hands where they belong." },
      { speaker: "YOU", text: "It's a box. It's somebody else's box." },
      { speaker: null, text: "It stays a box the whole way, which is the strangest eleven hours you have spent in a cockpit, and you have spent some strange ones." },
    ],
    choices: null, next: "nox_a1_04", autoAdvance: null });

  add({ id: "nox_a1_04", background: "bg_nox_deepdark", character: null,
    dialogue: [
      { speaker: null,      text: "The mooring is a spar of dark metal with no lights and no name, and the someone expecting you is already at the lock when you seal to it." },
      { speaker: "COURIER", text: "The case." },
      { speaker: null,      text: "They take it without looking at it. They do not check the seam. They turn and carry it into the spar, and the lock closes, and that is the entire transaction." },
      { speaker: null,      text: "You are eleven hours into the dark and nobody has yet done anything that required you specifically." },
    ],
    choices: null, next: "nox_a1_05", autoAdvance: null });

  add({ id: "nox_a1_05", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "You're back within the window. Fuel spent, near enough to my estimate. And the case arrived in the condition it left in — or near enough to it." },
      { speaker: "YOU",  text: "The case was empty, Sive." },
      { speaker: "SIVE", text: "Yes." },
      { speaker: null,   text: "They say it the way you would confirm the colour of something. No apology in it, and no triumph either." },
    ],
    choices: null, next: "nox_a1_06", autoAdvance: null });

  add({ id: "nox_a1_06", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "pleased", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Then what was the errand?" },
      { speaker: "SIVE", text: "The errand was the errand. You flew it. That is not nothing — most of what the Covenant needs moved is dull, and dullness carried faithfully is rarer than courage." },
      { speaker: "SIVE", text: "But you're asking what I learned. Fairly asked. I learned what you do with eleven hours, a seam, and an instruction you didn't respect." },
      { speaker: "YOU",  text: "And?" },
      { speaker: "SIVE", text: "And you are exactly as I hoped, in the specific way I hoped. I will not tell you which way. Knowing would only make you perform it." },
    ],
    choices: null, next: "nox_a1_07", autoAdvance: null });

  add({ id: "nox_a1_07", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "You could have measured that with a cargo run. A real one. With something in the box." },
      { speaker: "SIVE", text: "No. A real cargo gives you a reason to behave. I wanted to see you with no reason available." },
      { speaker: "SIVE", text: "The young factions test loyalty by giving people something to protect. It's a poor instrument. It measures the cargo." },
      { speaker: "SIVE", text: "Fly. There will be a second errand, and it will be slightly larger, and one day quite a long way from here you will notice that they stopped being errands. Try to notice early. I do enjoy the ones who notice early." },
    ],
    choices: null, next: "nox_a1_08", autoAdvance: null });

  add({ id: "nox_a1_08", background: "nox_splash_patient_answer", character: null,
    dialogue: [
      { speaker: null, text: "You take your tug out to a standoff distance before you burn, and you turn her, and you look at the thing you woke up inside." },
      { speaker: null, text: "The Patient Answer runs dark and enormous through the outer dark, and along her flank the cryo tiers glow — rank on rank of them, going back further than your lamps reach." },
      { speaker: null, text: "You had assumed you were rare. It had not occurred to you to count the windows." },
      { speaker: null, text: "You stop counting somewhere in the four hundreds, because the hull keeps going, and because you have an errand." },
    ],
    choices: null, next: null, autoAdvance: 9000 });

  /* ========================================================================
     ACT 2 — THE REVEAL BEGINS. Act 1 ended on a question each faction was
     still able to treat as an administrative problem. Act 2 is where the
     answer stops being administrative. Shape: assignment → the thing that
     shouldn't be there → the document/object that proves it → the cost of
     carrying it home → the person you hand it to, changing. Each chain ends
     with the faction's own certainty broken, and the player able to see the
     shape of who broke it without yet being able to name them.
     ===================================================================== */

  /* ===== KRAG — "THE ANNEX". The mobilization order that ate three moons
     cites a survey. The survey team is still out there, in their seats, two
     hundred years dead, and their last transmission says the opposite. ==== */
  add({ id: "krag_a2_01", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "Homeport Mira. You walked off this dock as Combine and you are walking back onto it as something else. Voss is at his counter. He has been waiting." },
      { speaker: "VOSS", text: "Sit. Don't take the jacket off, you won't be here long enough to want it back." },
      { speaker: "VOSS", text: "I did the arithmetic I told you I was carrying. Every filing that left this dock in two years, laid against every Vex interdiction that happened inside a week of one." },
      { speaker: "YOU",  text: "And?" },
      { speaker: "VOSS", text: "Forty-one filings. Thirty-nine interdictions. That's not a leak, hauler. A leak drips. That's a pipe, and somebody laid it." },
      { speaker: "VOSS", text: "Reva says the salvage nets are full of people who used to fly for us and don't anymore. I am choosing not to ask her how she knows." },
    ],
    choices: null, next: "krag_a2_02", autoAdvance: null });

  add({ id: "krag_a2_02", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Every filing clears Records. Records clears the mobilization archive on Terrace Nine — dead moon, one bunker, one archivist who's been down there longer than the war." },
      { speaker: "VOSS", text: "So while you're in the hole, pull something else for me. The original mobilization order. The one that says the Vex were coming and we'd best eat our own moons to meet them." },
      { speaker: "YOU",  text: "Everybody knows that order." },
      { speaker: "VOSS", text: "Everybody knows ABOUT it. I've been Combine sixty years and I have never held it. Neither has anyone I've asked, and I've started asking, and people have started getting quiet." },
      { speaker: "VOSS", text: "Quiet is a kind of answer. I want the paper." },
    ],
    choices: null, next: "krag_a2_03", autoAdvance: null });

  add({ id: "krag_a2_03", background: "bg_krag_terrace", character: null,
    dialogue: [
      { speaker: null, text: "Terrace Nine comes up out of the dark like a staircase built by something that ate the building. Forty years of shifts cut it into descending rings, each one the width of a city, each one empty." },
      { speaker: null, text: "The bunker is a wart on the lowest terrace, lit by three lamps. One of them is out, and has clearly been out a while." },
      { speaker: null, text: "And in the moon's shadow, in an orbit slow enough to have taken two centuries to decay this far, something is hanging that the charts do not mention." },
      { speaker: null, text: "You think of Voss's father on Terrace Four. You think of lungs full of rock and pride. The moon does not care which thought you finish first." },
    ],
    choices: null, next: "krag_a2_04", autoAdvance: null });

  add({ id: "krag_a2_04", background: "act_krag_survey_wreck", character: null,
    dialogue: [
      { speaker: null, text: "Combine hull. Survey pattern — the long spine and the twin sensor booms, one of them sheared. The registry is burned off, but you know the frame. It came out of the same yard as your tug, four generations back." },
      { speaker: null, text: "It has been dead a long time. Long enough that the ice on it has ice on it." },
      { speaker: "YOU", text: "Nobody logged you. Two hundred years in a marked orbit off a Combine moon, and nobody logged you." },
      { speaker: null, text: "That is not a wreck. That is a silence with a hull around it." },
    ],
    choices: [
      { label: "Board her. The paperwork keeps.",     next: "krag_a2_05a", flag: "krag_a2_boarded_wreck" },
      { label: "Fly past. The bunker is the job.",    next: "krag_a2_05b", flag: "krag_a2_skipped_wreck" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a2_05a", background: "act_krag_survey_wreck", character: null,
    dialogue: [
      { speaker: null, text: "You seal to a lock that opens on the first try, because nobody ever closed it properly, because whoever went out last was in a hurry." },
      { speaker: null, text: "The crew is still aboard. Six of them, in their seats, harnessed in. They died of the cold, slowly, in order, and the last one to go had time to fold the hands of the one beside her." },
      { speaker: null, text: "The log deck still has power. Two hundred years of it, drawing off a decay cell, waiting for somebody to press the one button that matters." },
      { speaker: "SURVEY 7", text: "Survey Team Seven, final transmission, day ninety-one. We have run the Ember Gate approach nine times on nine headings." },
      { speaker: "SURVEY 7", text: "There is no Vex staging. There is no forward fleet. There is no buildup of any kind. There is nothing out here but us and a great deal of empty." },
      { speaker: "SURVEY 7", text: "Recommend the mobilization be suspended pending — " },
      { speaker: null, text: "The recording ends there. Not cut. Ended. Somebody stopped it from the other end." },
    ],
    choices: null, next: "krag_a2_06", autoAdvance: null });

  add({ id: "krag_a2_05b", background: "bg_krag_terrace", character: null,
    dialogue: [
      { speaker: null, text: "You log her position and fly past. Twenty years hauling teaches you the trick of it: the job is the job, and the dark is full of things that were somebody's job once." },
      { speaker: "YOU", text: "Not mine. Sorry." },
      { speaker: null, text: "She stays in your aft scope a good deal longer than orbital mechanics have any business allowing." },
    ],
    choices: null, next: "krag_a2_06", autoAdvance: null });

  add({ id: "krag_a2_06", background: "bg_krag_archive",
    character: { portrait: "krag_archivist", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: null, text: "The archivist is old the way the bunker is old — settled, load-bearing, unlikely to be moved without structural consequences. He does not ask for your patch." },
      { speaker: "ARCHIVIST", text: "The old order. Not the shipping schedules." },
      { speaker: "YOU",       text: "Not the shipping schedules." },
      { speaker: "ARCHIVIST", text: "Forty years I've been down here and you're the second. The first was sixty years ago and he was Combine Records and he did not sign for it." },
      { speaker: null,        text: "He brings it up on a tray, under cloth, the way you would bring up something that had been someone." },
    ],
    choices: null, next: "krag_a2_07", autoAdvance: null });

  add({ id: "krag_a2_07", background: "act_krag_annex",
    character: { portrait: "krag_archivist", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: null, text: "The mobilization order is one page, and one page is enough to eat three moons with. Strip the Terraces. Mobilize the yards. Grounds: confirmed Vex staging at the Ember Gate approach, forty capital hulls, per survey annex attached." },
      { speaker: null, text: "Per survey annex attached. The annex is a second sheet, and the second sheet is wrong before you have read a word of it — wrong stock, wrong weight, wrong grain." },
      { speaker: "ARCHIVIST", text: "That did not come off our press." },
      { speaker: "YOU",       text: "You're sure." },
      { speaker: "ARCHIVIST", text: "I have fed the Combine press for fifty-one years, hauler. I know its teeth marks the way you know your own drive note. That annex is a stranger." },
      { speaker: "ARCHIVIST", text: "No origin stamp on it either. Just a form number, and a countersign I have never been able to source. I have tried. I have had decades to try." },
      { speaker: null,        text: "He does not ask if you will take it. He already knows you will. That is why you are the second." },
    ],
    choices: null, next: "krag_a2_08", autoAdvance: null });

  add({ id: "krag_a2_08", background: "explosion_debris_field", character: null,
    dialogue: [
      { speaker: null, text: "You lift off Terrace Nine with the annex in a document tube strapped under your seat, and the scopes light before the struts are stowed." },
      { speaker: null, text: "Two hulls, rising out of the cut rings where they had been sitting with their drives cold. Not searching. Waiting — the second time in your life you have had cause to know the difference, and the first time is only a few weeks old." },
      { speaker: null, text: "No transponders. No hail. And the frames are Krag-milled, out of the same yards that built everything you have ever flown." },
      { speaker: "YOU", text: "Ah. So it's like that." },
    ],
    choices: [
      { label: "Down into the terraces. Lose them in the cuts.", next: "krag_a2_09a", flag: "krag_a2_ran_terraces" },
      { label: "Turn into them. Make them commit to it.",        next: "krag_a2_09b", flag: "krag_a2_turned_and_fought" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a2_09a", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "You put the tug on her side and drop into the cuts, forty years of Combine mining laid out beneath you as a canyon system nobody has ever flown because nobody has ever needed to." },
      { speaker: null, text: "You need to. You fly it at a height your grandmother would have called suicide and your mother would have called Tuesday." },
      { speaker: null, text: "Something catches you on the way out of the last cut. The canopy goes white, then spiders, then holds — holds, because Combine glass is thick for exactly this reason, because the Combine wastes nothing including your life." },
      { speaker: "YOU", text: "Still flying. Still flying." },
    ],
    choices: null, next: "krag_a2_10", autoAdvance: null });

  add({ id: "krag_a2_09b", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "You turn into them, because a hauler running is a hauler being aimed at, and a hauler coming head-on is a decision somebody has to make." },
      { speaker: null, text: "They make it late. One breaks high and the other holds, and holding is the wrong answer at that closure, and you go through the gap between them close enough to read a hull number that has been ground off." },
      { speaker: null, text: "Close enough that when the second one fires, it fires into the space you were, and the edge of it takes your canopy. White, then spiders, then hold." },
      { speaker: "YOU", text: "Ground off your own numbers. Whoever you are, you knew you'd be ashamed." },
    ],
    choices: null, next: "krag_a2_10", autoAdvance: null });

  add({ id: "krag_a2_10", background: "bg_krag_dock",
    character: { portrait: "player_hauler", expression: "battered", position: "left" },
    dialogue: [
      { speaker: null, text: "Homeport Mira, eleven hours later, on one drive and a canopy you can't see the left third of. The dock crew comes out with foam before you're down." },
      { speaker: null, text: "The document tube is intact. You check it before you check yourself, which is a thing you will think about later." },
      { speaker: "YOU", text: "Four tons of ore. Whatever you say." },
    ],
    choices: [
      { label: "Give Voss all of it. The order, the annex, the wreck.", next: "krag_a2_11a", flag: "krag_a2_told_voss_all" },
      { label: "Give him the annex. Keep the wreck to yourself.",       next: "krag_a2_11b", flag: "krag_a2_held_back_wreck" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a2_11a", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: null, text: "You lay it all on the counter where he counts credits. The order. The annex. The position of a survey ship in a decaying orbit, and what its last transmission says, and how it ends." },
      { speaker: "VOSS", text: "Six of them. In their seats." },
      { speaker: "YOU",  text: "In their seats." },
      { speaker: null,   text: "He does not touch the annex for a long time. When he does, he picks it up by one corner, the way you handle a thing you have already decided you are going to have to burn." },
    ],
    choices: null, next: "krag_a2_12", autoAdvance: null });

  add({ id: "krag_a2_11b", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: null, text: "You lay the order and the annex on the counter and you say nothing at all about an orbit off the shadow side, or six harnesses, or folded hands." },
      { speaker: null, text: "You tell yourself it's because the paper is the proof and the ship is only a grave. You are not sure that's the reason." },
      { speaker: "VOSS", text: "There's more." },
      { speaker: "YOU",  text: "There's the annex." },
      { speaker: null,   text: "He looks at you for four full seconds, and then decides — visibly, deliberately — not to spend them." },
    ],
    choices: null, next: "krag_a2_12", autoAdvance: null });

  add({ id: "krag_a2_12", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "angry", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "You understand what this sheet is." },
      { speaker: "YOU",  text: "It's the reason." },
      { speaker: "VOSS", text: "It is THE reason. My father worked Terrace Four. His mother opened it. Everybody I have ever loved spent themselves on those moons and every one of them died believing it bought the children a fleet." },
      { speaker: "VOSS", text: "And it is a stranger's paper, hauler. Wrong stock. No stamp. Slipped into a Combine order two hundred years ago by a hand that was not Combine." },
      { speaker: "VOSS", text: "We ate our own moons. Nobody made us. Somebody just told us we were starving, and we were so frightened of the dark that we did the rest ourselves." },
    ],
    choices: null, next: "krag_a2_13", autoAdvance: null });

  add({ id: "krag_a2_13", background: "krag_splash_forged_annex", character: null,
    dialogue: [
      { speaker: null, text: "The Combine wastes nothing. It is the first thing you learn here and the last thing anyone lets go of, and it has always sounded like pride." },
      { speaker: null, text: "Standing on a dock with a forged sheet of paper between you and a man who has just been informed that his entire inheritance was a clerical insertion, it stops sounding like pride." },
      { speaker: null, text: "It sounds like what people say afterward, about what they had to do, when there was nothing left to do it with." },
      { speaker: null, text: "Somebody signed the countersign. Somebody Combine, somebody senior, somebody who had to have known that annex was a stranger the moment they touched it." },
      { speaker: null, text: "Survey Team Seven said there was no fleet. Someone stopped the recording from the other end. The annex said the opposite. Wrong stock. No stamp." },
      { speaker: null, text: "Voss is already looking up the countersign. He has the expression of a man walking toward a door he has spent sixty years not opening." },
      { speaker: null, text: "You will open it with him. That is what the ledger bought, when it bought you." },
    ],
    choices: null, next: null, autoAdvance: 10000 });

  /* ===== KRAG ACT 3 — "THE COUNTERSIGN". Elder Harrow signed it, knew it
     was forged, and used it anyway. The defining choice is what a working
     people are owed: the truth, or the thing the lie built. ============== */
  add({ id: "krag_a3_01", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "Three weeks. I have not slept properly in three weeks and I want you to know that before I say the name, because I want you to know I checked it more times than a sane man would." },
      { speaker: "VOSS", text: "The countersign is Harrow. Elder Ruk Harrow, Combine Assembly, seat eleven." },
      { speaker: "YOU",  text: "Two hundred years ago." },
      { speaker: "VOSS", text: "And still breathing. Krag Elders go a long way when they're kept in the cold and fed on other people's decisions. He's in a hab on a tether off Mira, and he has an appointment book, and there is nothing in it." },
    ],
    choices: null, next: "krag_a3_02", autoAdvance: null });

  add({ id: "krag_a3_02", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "You fly me up. That's the job. I'm not sending a hauler to do this alone and I'm not letting a Combine ship log the trip." },
      { speaker: "YOU",  text: "And when we're up there?" },
      { speaker: "VOSS", text: "Then I ask a very old man one question, and depending on the answer I either apologise to him or I don't." },
      { speaker: null,   text: "He has brought nothing with him but the annex, in the same document tube, and a coat with the Combine patch cut off it. Not torn. Cut, carefully, with a blade, along the stitching." },
    ],
    choices: [
      { label: "Tell him you've already copied the annex. Widely.", next: "krag_a3_03a", flag: "krag_a3_spread_copies" },
      { label: "Say nothing. One tube, one copy, one conversation.", next: "krag_a3_03b", flag: "krag_a3_kept_it_close" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a3_03a", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Before we go. There are eleven copies of that annex in eleven places, and none of them are here, and none of them are with me." },
      { speaker: "VOSS", text: "..." },
      { speaker: "VOSS", text: "You did that without telling me." },
      { speaker: "YOU",  text: "I did that so that whatever happens on that tether, the paper survives it. Including if what happens on that tether is us." },
      { speaker: "VOSS", text: "Hn. The Combine wastes nothing." },
      { speaker: null,   text: "It is not approval, exactly. But he stops checking the tube every few minutes, which for Voss is the same thing." },
    ],
    choices: null, next: "krag_a3_03c", autoAdvance: null });

  add({ id: "krag_a3_03b", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "You say nothing. One tube, one sheet, two people who know, and a tether with an old man at the end of it." },
      { speaker: null,   text: "It is the tidier way to do it and you are aware, in the part of you that has flown contested space for twenty years, that tidy and safe are different words." },
      { speaker: "VOSS", text: "You're quiet." },
      { speaker: "YOU",  text: "I'm counting exits. It's a habit." },
    ],
    choices: null, next: "krag_a3_03c", autoAdvance: null });

  add({ id: "krag_a3_03c", background: "act_krag_tether", character: null,
    dialogue: [
      { speaker: null, text: "The tether rises from Mira like a needle someone left in the sky on purpose." },
      { speaker: null, text: "Hab eleven hangs at the end of it — sparse, cold, appointment book empty. Two people and a document tube climb in silence." },
      { speaker: "VOSS", text: "If this goes wrong, you fly. I talk. That is the division of labor." },
      { speaker: "YOU",  text: "And if talking goes wrong?" },
      { speaker: "VOSS", text: "Then we both fly. I have practiced that too." },
    ],
    choices: null, next: "krag_a3_04", autoAdvance: null });

  add({ id: "krag_a3_04", background: "bg_krag_elder",
    character: { portrait: "krag_harrow", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "Elder Harrow is very small. That is the first thing, and it is not what either of you prepared for. The bone plate has gone translucent at the edges; the ember in his eyes has banked down to something you could hold a hand near." },
      { speaker: "HARROW", text: "Dockmaster. And a hauler with a document tube." },
      { speaker: "HARROW", text: "Sit down. Both of you. I have been expecting somebody with a document tube for a hundred and ninety-one years and I would like to be sitting when it finally arrives." },
      { speaker: null, text: "Through the viewport: the moons. Still chewed. Still waiting for someone to tell them a different story." },
    ],
    choices: null, next: "krag_a3_05", autoAdvance: null });

  add({ id: "krag_a3_05", background: "bg_krag_elder",
    character: { portrait: "krag_harrow", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "VOSS",   text: "The survey annex to the mobilization order. Your countersign." },
      { speaker: "HARROW", text: "My countersign." },
      { speaker: "VOSS",   text: "It's forged. Wrong stock, no origin stamp, and the survey team it cites transmitted the opposite finding before somebody ended their recording from the far end." },
      { speaker: "HARROW", text: "Yes." },
      { speaker: null,     text: "Not a flinch. Not a pause. He says it the way you would confirm the weather, and Voss — who came up that tether ready for a fight, who has been ready for three weeks — has nowhere to put his hands." },
      { speaker: "VOSS",   text: "...Yes." },
      { speaker: "HARROW", text: "I knew it was forged when I signed it. I have known every day since. Ask the actual question, Dockmaster. You have earned the actual question." },
    ],
    choices: null, next: "krag_a3_06", autoAdvance: null });

  add({ id: "krag_a3_06", background: "bg_krag_elder",
    character: { portrait: "krag_harrow", expression: "weary", position: "right" },
    dialogue: [
      { speaker: "VOSS",   text: "Why." },
      { speaker: "HARROW", text: "Because it arrived in a sealed Combine pouch on a Combine courier from an office that did not exist, and I had it in my hands for six days before I signed it, and in six days I could not find the hand that wrote it." },
      { speaker: "HARROW", text: "Understand what that meant. Someone could reach into the Assembly's own paper. Someone we could not see, could not name, could not shoot, and could not stop." },
      { speaker: "HARROW", text: "The annex said the Vex were coming. That was a lie. But someone with that reach WAS here, in the room, in the paperwork — and we had eleven hulls and three moons and no fleet at all." },
      { speaker: "HARROW", text: "So I signed the lie. Because the lie built yards. The lie built the Combine you two are standing in. It was the only true thing on the sheet: we were defenceless, and something was already inside." },
    ],
    choices: null, next: "krag_a3_07", autoAdvance: null });

  add({ id: "krag_a3_07", background: "bg_krag_elder",
    character: { portrait: "krag_voss", expression: "angry", position: "left" },
    dialogue: [
      { speaker: "VOSS",   text: "You spent three moons." },
      { speaker: "HARROW", text: "I spent three moons." },
      { speaker: "VOSS",   text: "My father was Terrace Four. He went into that rock at nineteen believing it bought his children a fleet, and he came out at fifty-one with his lungs full of it, and he was PROUD, Elder. He died proud." },
      { speaker: "HARROW", text: "Then he died having bought his children a fleet. That part was never the lie." },
      { speaker: "HARROW", text: "I have never been able to decide whether that makes it better. I have had a hundred and ninety-one years and a very quiet room, and I have not decided. Perhaps you will be quicker." },
    ],
    choices: null, next: "krag_a3_08", autoAdvance: null });

  add({ id: "krag_a3_08", background: "act_krag_tether",
    character: { portrait: "krag_harrow", expression: "weary", position: "right" },
    dialogue: [
      { speaker: null,       text: "The tether alarm goes at that exact moment, which is not a coincidence, and all three of you know it is not a coincidence." },
      { speaker: "SECURITY", text: "Hab eleven, this is Combine internal. You are hosting an unlogged visit. Seal your lock and stand by for boarding." },
      { speaker: "HARROW",   text: "Ah. They read my appointment book too. I did wonder who kept it so tidy." },
      { speaker: null,       text: "Through the viewport: two cutters coming up the tether line, and behind them, in the far dark, the moons. Terraced down to nothing. Lit from below by the yards the lie built." },
      { speaker: "VOSS",     text: "Hauler. Whatever we do about this, we do it in the next ninety seconds, and then we live in it." },
      { speaker: "HARROW",   text: "I have lived in it already. You two are only late to the room." },
    ],
    choices: null, next: "krag_a3_09", autoAdvance: null });

  add({ id: "krag_a3_09", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "You get them off the tether. How you get them off the tether will be argued about later by people who were not there; what happens is that a Vulture-class tug with a cracked canopy does something a Vulture-class tug is not rated for, twice, and holds together for both." },
      { speaker: null, text: "Harrow is strapped into the jump seat, weighing almost nothing, watching the moons go past with the expression of a man checking a sum." },
      { speaker: null, text: "Voss has the document tube in both hands and has not said a word in four minutes." },
      { speaker: null, text: "The cutters break off at the shipping lane, because whatever they were sent to stop, they were not sent to be seen stopping it." },
    ],
    choices: null, next: "krag_a3_10", autoAdvance: null });

  add({ id: "krag_a3_10", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "VOSS", text: "So. The Combine has a hundred and ninety-one thousand people on shift right now who think they know why the moons are gone." },
      { speaker: "VOSS", text: "I can hand them the annex. Every dock, every yard, every terrace, inside a day. And what I hand them is: your grandparents were played, your pride is a clerical error, and the enemy you have been shooting at for two centuries was never actually coming." },
      { speaker: "VOSS", text: "Or I hand them nothing, and they keep the fleet, and they keep the pride, and I keep this." },
      { speaker: "VOSS", text: "I've carried it three weeks and I'm done carrying it alone. You flew the moon. You opened the wreck or you didn't. You get a say." },
    ],
    choices: [
      { label: "Publish it. They paid for it — it's theirs.",       next: "krag_a3_11a", flag: "krag_a3_published" },
      { label: "Bury it. Let them keep what it bought them.",       next: "krag_a3_11b", flag: "krag_a3_buried" },
      { label: "Neither. Find the hand that wrote it, then decide.", next: "krag_a3_11c", flag: "krag_a3_hunt_the_hand" },
    ], next: null, autoAdvance: null });

  add({ id: "krag_a3_11a", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "They dug it out. They paid for it in lungs. It's theirs, Voss. It was always theirs." },
      { speaker: "VOSS", text: "It'll break things." },
      { speaker: "YOU",  text: "It'll break things that are already broken and pretending. That's not the same as breaking them." },
      { speaker: null,   text: "It goes out on the shift boards at change of watch, on every terrace, in the flat Combine type that has announced deaths and quotas and nothing else for two hundred years." },
      { speaker: null,   text: "The yards do not stop. That is the part nobody predicted. The Combine reads that its entire grief was an insertion, and the shift changes, and the cranes come back up — because the moons are still gone either way, and there is still work." },
      { speaker: null,   text: "But they look at the sky differently now. All of them. And when the Combine asks a thing of them, they ask, out loud, on whose paper. That is new. That is entirely new." },
    ],
    choices: null, next: "krag_a3_12", autoAdvance: null });

  add({ id: "krag_a3_11b", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Burn it. They've got forty years of shifts in those rocks and one thing to show for it, and it's the fleet, and it's real. Don't take the last real thing off them to prove a point about paper." },
      { speaker: "VOSS", text: "That's Harrow's argument." },
      { speaker: "YOU",  text: "I know whose argument it is. He's had a hundred and ninety-one years to find a better one and he couldn't, and neither can I." },
      { speaker: null,   text: "They burn it in the dock furnace, both of you watching, which is a formality — Voss has it memorised and so do you and that is now a thing you will both carry until you stop." },
      { speaker: "VOSS", text: "You know what we just did." },
      { speaker: "YOU",  text: "We signed it. Same as he did. Same six days and everything." },
      { speaker: "VOSS", text: "...Yes. That's what I thought too, and I was hoping you'd tell me I was wrong." },
    ],
    choices: null, next: "krag_a3_12", autoAdvance: null });

  add({ id: "krag_a3_11c", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Both of those are decisions about us. Neither one is a decision about THEM — whoever put a sheet of stranger's paper into the Assembly's pouch and then sat back for two hundred years." },
      { speaker: "YOU",  text: "You publish, they watch us tear ourselves up. You bury it, they keep the pipe. Either way they're still out there and still holding the pen." },
      { speaker: "VOSS", text: "So we hold the annex and we go looking." },
      { speaker: "YOU",  text: "We hold the annex and we go looking. And if we find them, then the Combine gets told everything at once — the lie AND the hand. Not half of it. Halves are what got us here." },
      { speaker: null,   text: "Voss puts the tube inside his coat, against the place the patch used to be, and does the buttons up over it one at a time." },
      { speaker: "VOSS", text: "Then the Combine has a debt outstanding, and the Combine collects. That I know how to do." },
    ],
    choices: null, next: "krag_a3_12", autoAdvance: null });

  add({ id: "krag_a3_12", background: "krag_splash_verdict", character: null,
    dialogue: [
      { speaker: null, text: "Lifting out of Homeport Mira, the moons come up over the shoulder of the world the way they always do." },
      { speaker: null, text: "Three of them, strip-mined to the mantle, terraced down to nothing in forty years of shifts your parents worked and their parents worked. You have looked at them your whole life and seen a price." },
      { speaker: null, text: "They are still a price. That has not changed and will not. What changed is that you now know who set it, and it was not the Vex, and it was not fear, and it was not the Combine either." },
      { speaker: null, text: "It was a hand. A patient one, with access to a pouch, two hundred years ago, that has never once been in a hurry." },
      { speaker: null, text: "The Combine wastes nothing, hauler. Not metal, not ships, not people." },
      { speaker: null, text: "And not debts. Especially not those." },
    ],
    choices: null, next: null, autoAdvance: 11000 });

  /* ===== VEX ACT 2 — "THE GHOST OFFICE". Kael's form number leads to a
     relay that is on no Dominion chart, has been running for two hundred
     years, and compiles threat assessments for BOTH sides. The Dominion's
     moral architecture turns out to rest on a foundation somebody else
     poured. Right for the wrong reason, in one document. ================= */
  add({ id: "vex_a2_01", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "tired", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "I kept your file active. I was counting on you coming back." },
      { speaker: "DREN", text: "Kael filed his inquiry through the proper channel at the proper pace, exactly as he said he would. Eleven weeks. Do you know what came back?" },
      { speaker: "YOU",  text: "A form number." },
      { speaker: "DREN", text: "The SAME form number. Beautiful, really. He asked the form where it came from and the form told him it came from the form." },
      { speaker: "DREN", text: "He has now filed a second inquiry, because he is Kael. And I have come to you, because I am not." },
    ],
    choices: null, next: "vex_a2_02", autoAdvance: null });

  add({ id: "vex_a2_02", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "DREN", text: "The originating office has a routing prefix. Prefixes are physical — they're where a thing was transmitted from, and you cannot forge a light-lag." },
      { speaker: "DREN", text: "I ran the lag. It puts the office fourteen light-minutes off the Ember Gate approach, in a volume the Dominion has surveyed nine times in two centuries and charted as empty on all nine." },
      { speaker: "YOU",  text: "Then it's not there." },
      { speaker: "DREN", text: "Then it is not there, and it has been sending us our interdiction lists from not being there since before either of us was a going concern. Go and look at the nothing, pilot." },
    ],
    choices: [
      { label: "Go dark. No log, no filing, no trace.",       next: "vex_a2_03a", flag: "vex_a2_went_dark" },
      { label: "File it properly. Kael's way, on the record.", next: "vex_a2_03b", flag: "vex_a2_filed_it" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a2_03a", background: "bg_vex_hangar", character: null,
    dialogue: [
      { speaker: null,   text: "You go out on civilian tags with a dead transponder and a flight plan that says you are somewhere else, which is the Special Directorate's entire methodology rendered as paperwork." },
      { speaker: "DREN", text: "Sensible. Whatever is out there has been reading Dominion filings for two hundred years. Don't hand it a schedule." },
      { speaker: null,   text: "It occurs to you, somewhere in the eighth hour, that you have just accepted an argument for having no log — and that the last officer who kept a gap in a log was told it was a confession with better manners." },
    ],
    choices: null, next: "vex_a2_04", autoAdvance: null });

  add({ id: "vex_a2_03b", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "tense", position: "right" },
    dialogue: [
      { speaker: null,   text: "You file it. Full flight plan, stated purpose, countersigned — and you take it to Kael yourself rather than let it surface in his morning stack." },
      { speaker: "KAEL", text: "Commodore Dren sent you and you came to me first." },
      { speaker: "YOU",  text: "You told me a gap in a log is a confession. I'm not going to go and make one on your instruction and then call it your instruction." },
      { speaker: "KAEL", text: "...Noted. Understand that this filing will be read by whoever compiles the lists, because everything is. You are going out there announced." },
      { speaker: "KAEL", text: "Go anyway. If they are willing to move because we looked at them, then we will have learned that they move." },
    ],
    choices: null, next: "vex_a2_04", autoAdvance: null });

  add({ id: "vex_a2_04", background: "bg_vex_ghost_relay", character: null,
    dialogue: [
      { speaker: null, text: "Fourteen light-minutes off the approach, in nine times surveyed empty, there is a relay." },
      { speaker: null, text: "It is not hiding. That is the thing that takes a while to sit down properly. It has no shroud, no baffling, no dark coating — it is simply grey, and small, and station-keeping, and nine Dominion surveys have flown through this volume and written down nothing." },
      { speaker: null, text: "Its dish is pointed sunward. There is a second dish on the far side, and the second dish is pointed at the Krag terraces." },
      { speaker: "YOU", text: "...Both of them. It talks to both of them." },
    ],
    choices: null, next: "vex_a2_05", autoAdvance: null });

  add({ id: "vex_a2_05", background: "explosion_silent_wreck", character: null,
    dialogue: [
      { speaker: null, text: "There is a picket on the far side of it. Dominion picket, four hulls in interlock formation, exactly as doctrine specifies, holding a station they were presumably ordered to hold." },
      { speaker: null, text: "They have been holding it for a very long time. The interlock is perfect. The formation has not drifted a metre. Every one of them is cold, and open, and empty, and the hull numbers are from a series the Dominion retired a hundred and sixty years ago." },
      { speaker: null, text: "Somebody sent a picket here. Somebody logged them as lost elsewhere. And somebody has been keeping four dead ships in parade order ever since, because a formation that never drifts is a formation that something is still holding." },
    ],
    choices: null, next: "vex_a2_06", autoAdvance: null });

  add({ id: "vex_a2_06", background: "bg_vex_ghost_relay", character: null,
    dialogue: [
      { speaker: null,    text: "The relay opens a channel before you have finished deciding whether to. It does not hail you. It addresses you." },
      { speaker: "RELAY", text: "Dominion registry. You are outside the assessed volume. Please state whether you are reporting or collecting." },
      { speaker: "YOU",   text: "...Collecting." },
      { speaker: "RELAY", text: "Acknowledged. Current cycle assessment is available in Dominion format and in Combine format. Which format." },
      { speaker: null,    text: "There is a long moment in which you sit in a dark cockpit fourteen light-minutes from anywhere and understand, all at once and far too completely, what an interdiction list is." },
      { speaker: "YOU",   text: "Both formats." },
      { speaker: "RELAY", text: "Unusual. Transmitting." },
    ],
    choices: null, next: "vex_a2_07", autoAdvance: null });

  add({ id: "vex_a2_07", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "You are eleven seconds into the transfer when the picket moves." },
      { speaker: null, text: "Four hulls that have been cold for a hundred and sixty years come up on station-keeping thrust in perfect interlock, and they do not fire, and they do not hail, and they close on you in a geometry out of the Dominion's own drill book — the one you were taught in your first week, the one that closes a volume." },
      { speaker: null, text: "You break it the only way it has ever been broken. You go through the seam, and the seam closes on you, and something clips your dorsal plating hard enough to put the canopy through a colour you have not seen since VD-77." },
      { speaker: "YOU", text: "Transfer. TRANSFER. Come on — " },
      { speaker: null, text: "The archive lands in your buffer with four percent margin and the relay says nothing at all, and the picket stops dead the instant you clear the assessed volume, and drifts back, and reforms." },
    ],
    choices: null, next: "vex_a2_08", autoAdvance: null });

  add({ id: "vex_a2_08", background: "bg_vex_wreck_site",
    character: { portrait: "player_hauler", expression: "battered", position: "left" },
    dialogue: [
      { speaker: null, text: "You read it on the way home because you cannot not read it, one-handed, with the cabin at half pressure and a canopy you can see your own breath against." },
      { speaker: null, text: "Two centuries of threat assessments. Vex volumes with Krag strengths in them. Krag volumes with Vex strengths in them. Interdiction candidates, compiled, weighted, formatted, and issued — to both, by the same office, in the same cycle." },
      { speaker: null, text: "Every list the Dominion has ever fortified against. Every list the Combine has ever mobilized against. One dish each, pointed opposite ways, out of a grey box in a volume that nine surveys agreed was empty." },
      { speaker: "YOU", text: "We were right. We were RIGHT — there was always something coming." },
      { speaker: null, text: "And then, a long way further into the dark, with nothing to do but fly: it was coming because we were told it was coming, and we fortified, and being fortified is what got us listed in the other one's copy." },
    ],
    choices: [
      { label: "Take it to Dren. He'll know what to do with it.", next: "vex_a2_09a", flag: "vex_a2_gave_dren" },
      { label: "Take it to Kael. He needs to read it himself.",   next: "vex_a2_09b", flag: "vex_a2_gave_kael" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a2_09a", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "grim", position: "right" },
    dialogue: [
      { speaker: null,   text: "Dren reads for forty minutes without moving, which you did not know he could do." },
      { speaker: "DREN", text: "I have spent thirty years telling myself the Directorate exists because the Dominion needs someone willing to look in the places the banners don't hang." },
      { speaker: "DREN", text: "And every place I have ever looked, I was pointed at. By this. In Dominion format, on the proper stationery, at the proper pace." },
      { speaker: "YOU",  text: "Kael has to see it." },
      { speaker: "DREN", text: "Kael has to see it, and Kael is the single worst-equipped man alive to see it, and those are both true, and I have no idea what to do about it. Come on." },
    ],
    choices: null, next: "vex_a2_10", autoAdvance: null });

  add({ id: "vex_a2_09b", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "You take it to the tribunal bay, because that is where he will be, because he is always where the rule says he should be." },
      { speaker: "KAEL", text: "You are out of uniform, out of pressure, and bleeding on a Dominion bench." },
      { speaker: "YOU",  text: "I asked the form number where it came from. It answered." },
      { speaker: null,   text: "He takes the slate. He does not sit down, because standing is correct, and he reads the entire two centuries standing up." },
    ],
    choices: null, next: "vex_a2_10", autoAdvance: null });

  add({ id: "vex_a2_10", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "shaken", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "The medical tender. Ninety-one aboard, fourteen dead of exposure, on a list." },
      { speaker: "KAEL", text: "I told you the list was followed and that this was a different failure from the list being wrong. I was very precise about it. I was rather pleased with the distinction." },
      { speaker: "YOU",  text: "Adjudicator — " },
      { speaker: "KAEL", text: "There is a third failure. It did not occur to me that there could be a third failure. The list was AUTHORED, pilot, and not by us, and every officer who followed it correctly was being operated." },
      { speaker: "KAEL", text: "Two hundred years of us doing our duty flawlessly. Flawlessly. That is what it bought." },
    ],
    choices: null, next: "vex_a2_11", autoAdvance: null });

  add({ id: "vex_a2_11", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "tense", position: "right" },
    dialogue: [
      { speaker: null,   text: "He sets the slate down and squares it to the edge of the bench, which is a thing he does, which you have watched him do a dozen times, and which right now is the most alarming thing in the room." },
      { speaker: "KAEL", text: "One item. Cycle forty-one, Dominion format." },
      { speaker: "YOU",  text: "I hadn't got that far." },
      { speaker: "KAEL", text: "Convoy VD-77. Twelve hulls, reactor cores, Arix outbound. It is in the assessment. In the COMBINE format." },
      { speaker: "KAEL", text: "Issued nine days before the ambush. Your convoy was not found, pilot. Your convoy was distributed." },
    ],
    choices: null, next: "vex_a2_12", autoAdvance: null });

  add({ id: "vex_a2_12", background: "vex_splash_nine_seconds_again", character: null,
    dialogue: [
      { speaker: null, text: "Every Dominion pilot is taught VD-77 in their first week, and taught it as a clock. Nine seconds. It is the shortest and most load-bearing story the Dominion tells." },
      { speaker: null, text: "You were there for the second one. Twelve ships, eight dead, four home — and a tribunal, and a stripped insignia, and everything you have done since." },
      { speaker: null, text: "Nine days before it, a grey box in an empty volume put your convoy's heading into a document and pointed a dish at the Krag terraces." },
      { speaker: null, text: "The Dominion did not fail to protect those eight. The Dominion was never in the transaction. Somebody bought them, and paid in list format, and got exactly what they were paying for." },
      { speaker: null, text: "Behind you, in a tribunal bay, an adjudicator who has never in his life been late for anything is still standing over a squared slate, and has not moved, and will not for some time." },
    ],
    choices: null, next: null, autoAdvance: 11000 });

  /* ===== VEX ACT 3 — "THE ORDER". Can a civilization built on obedience be
     told that its obedience was steered? Kael wants a tribunal for the whole
     Dominion; Dren says the truth breaks the only thing holding a violent
     species in formation. The player picks what the banners mean. ======== */
  add({ id: "vex_a3_01", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "Kael has convened something. It has a bench, a recorder, and a summons with your name on it, and it is not a tribunal, because he has no standing to convene one and would rather die than pretend otherwise." },
      { speaker: "KAEL", text: "This is not a proceeding. Say nothing here you would not say under one." },
      { speaker: "KAEL", text: "I intend to lay the assessment archive before the full Admiralty, with the VD-77 entry marked, and request a finding: that Dominion targeting doctrine has been sourced externally since its founding." },
      { speaker: "YOU",  text: "They'll destroy you." },
      { speaker: "KAEL", text: "Almost certainly. That is not an argument, pilot, it is a weather report." },
    ],
    choices: null, next: "vex_a3_02", autoAdvance: null });

  add({ id: "vex_a3_02", background: "bg_vex_tribunal",
    character: { portrait: "vex_dren", expression: "grim", position: "left" },
    dialogue: [
      { speaker: null,   text: "Dren has been leaning on the back wall for the entire summons, out of the recorder's arc, in a patched jacket, being deliberately visible to exactly one person in the room." },
      { speaker: "DREN", text: "May I put the other side badly? I find I do it better badly." },
      { speaker: "DREN", text: "The Dominion is nine hundred million people who solve disagreements by fortifying. The only reason we have not solved each OTHER is doctrine — a chain of command that has never once been shown to be arbitrary." },
      { speaker: "DREN", text: "Tell nine hundred million fortifiers that the chain was being steered from outside, and you have not freed them, ensign. You have simply cut every rope on the ship at once, in a storm, to prove the ropes were tied by a stranger." },
      { speaker: "KAEL", text: "And your alternative is that we go on being steered, quietly, with better morale." },
      { speaker: "DREN", text: "My alternative is that we find the hand FIRST and hold it up with the archive, so that what we hand the fleet is an enemy and not a hole. Same evidence. Nine months apart. That is the whole of my position." },
    ],
    choices: null, next: "vex_a3_03", autoAdvance: null });

  add({ id: "vex_a3_03", background: "bg_vex_tribunal", character: null,
    dialogue: [
      { speaker: null, text: "They both stop and look at you, which is absurd, because you are a provisional pilot with no insignia and a canopy held together with sealant." },
      { speaker: null, text: "You are also the only person in the Dominion who has been inside the assessed volume and come out, and they both know it, and that turns out to be a rank of sorts." },
    ],
    choices: [
      { label: "Kael's way. The fleet gets told, whatever it costs.", next: "vex_a3_04a", flag: "vex_a3_sided_kael" },
      { label: "Dren's way. Find the hand first, then tell them.",    next: "vex_a3_04b", flag: "vex_a3_sided_dren" },
      { label: "Neither yet. Go back and get proof of the ambush.",   next: "vex_a3_04c", flag: "vex_a3_wanted_proof" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a3_04a", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "tense", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Tell them. All of it, now, in full, and let the fleet be adults about it." },
      { speaker: "DREN", text: "And if they aren't?" },
      { speaker: "YOU",  text: "Then they were never adults, Commodore, and we've been calling a leash a spine for two hundred years." },
      { speaker: "KAEL", text: "...Then I will need the VD-77 entry corroborated by something other than a document I obtained irregularly from an office that does not exist. Which means the wreck field." },
    ],
    choices: null, next: "vex_a3_05", autoAdvance: null });

  add({ id: "vex_a3_04b", background: "bg_vex_tribunal",
    character: { portrait: "vex_dren", expression: "neutral", position: "left" },
    dialogue: [
      { speaker: "YOU",  text: "Nine months. Find the hand, then hand the fleet both at once. A hole makes people frightened. Frightened is what the grey box has been selling for two centuries." },
      { speaker: "KAEL", text: "You are asking me to sit on a finding." },
      { speaker: "YOU",  text: "I'm asking you to complete one. You wouldn't publish half a verdict." },
      { speaker: "KAEL", text: "...No. I would not. That is an irritatingly correct argument and I dislike it thoroughly." },
      { speaker: "DREN", text: "Then we start where the archive can be checked against something physical. The wreck field." },
    ],
    choices: null, next: "vex_a3_05", autoAdvance: null });

  add({ id: "vex_a3_04c", background: "bg_vex_tribunal", character: null,
    dialogue: [
      { speaker: "YOU",  text: "Neither. Both of you are arguing about what to do with a document, and it's a document out of a box that talks to the enemy in the enemy's format." },
      { speaker: "YOU",  text: "If I were them and I wanted the Dominion to tear itself up on schedule, that archive is exactly the thing I'd hand a pilot who came asking. It let me have it, Adjudicator. It ASKED me which format." },
      { speaker: "KAEL", text: "..." },
      { speaker: "DREN", text: "Oh, that's very good. That's very good and I hate it." },
      { speaker: "KAEL", text: "Then the archive is a claim and not a finding, and a claim is corroborated physically or not at all. The wreck field. Both of you." },
    ],
    choices: null, next: "vex_a3_05", autoAdvance: null });

  add({ id: "vex_a3_05", background: "bg_vex_wreck_site", character: null,
    dialogue: [
      { speaker: null, text: "The VD-77 field is a Dominion war grave and is charted, patrolled, and left alone. Twelve hulls, eight of them opened, drifting in a slow ring that the Dominion re-surveys every decade and never touches." },
      { speaker: null, text: "You have not been back. You had assumed you would feel something specific on arrival and instead you feel the particular flatness of a place matching its photographs." },
      { speaker: "KAEL", text: "Escort positions. You were here. Where was the lead attacker when it fired." },
      { speaker: "YOU",  text: "Out of the shadow at two-seven-zero, high. It fired before it cleared. That's the part nobody believed." },
    ],
    choices: null, next: "vex_a3_06", autoAdvance: null });

  add({ id: "vex_a3_06", background: "explosion_silent_wreck",
    character: { portrait: "vex_kael", expression: "shaken", position: "right" },
    dialogue: [
      { speaker: null,   text: "The attacker is still here. It has been in the charted field for the entire time, one hull among thirteen in a ring the Dominion counts as twelve, because a Combine lance in a Vex grave is exactly what everyone expects to find and nobody has ever needed to look at." },
      { speaker: null,   text: "Kael reads its transponder module in silence for a long time." },
      { speaker: "KAEL", text: "This is a Combine unit." },
      { speaker: "YOU",  text: "We know it's a Combine unit." },
      { speaker: "KAEL", text: "This is a Combine transponder MODULE, pilot, in a hull that is not Combine-milled. The frame is nobody's. The weapon mounts are nobody's. Someone built a ship that would leave a Combine signature in our records and nothing else." },
      { speaker: "KAEL", text: "Eight of ours died at a Combine ambush that the Combine did not carry out. And nine days before it, both sides were told where to be." },
    ],
    choices: null, next: "vex_a3_07", autoAdvance: null });

  add({ id: "vex_a3_07", background: "explosion_debris_field",
    character: { portrait: "vex_dren", expression: "grim", position: "left" },
    dialogue: [
      { speaker: null,       text: "You are three minutes into cutting the module free when the field lights up." },
      { speaker: "SECURITY", text: "Unidentified hulls, this is Dominion grave patrol. You are conducting unauthorised salvage in a war grave. Cut your drives and prepare to be boarded." },
      { speaker: "DREN",     text: "Grave patrol. On a decade cycle. Nine years early." },
      { speaker: "KAEL",     text: "Their authorisation is a form number. I can see it from here. It is THE form number." },
      { speaker: null,       text: "Four hulls in interlock, closing to seal a volume, exactly and precisely by the drill book — and for the second time in a month you are on the wrong side of a formation that is being flown correctly by people who are not being told why." },
    ],
    choices: null, next: "vex_a3_08", autoAdvance: null });

  add({ id: "vex_a3_08", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: "WING TWO", text: "Picket lead, I have a fire order and I have three targets and one of them is reading as an ADJUDICATOR, please confirm, please confirm — " },
      { speaker: null,       text: "Nine seconds. That is how long the picket lead holds, against the order, against doctrine, against everything the Dominion has taught since the founding, because the thing on his scope does not make sense and he wants to be certain." },
      { speaker: null,       text: "It is the exact failure the whole clock exists to prevent. It is why you were court-martialled. It is the most expensive nine seconds in Dominion history and every officer alive has been trained to hate it." },
      { speaker: null,       text: "You are alive because of it. All three of you, out through a seam that a man held open by hesitating, with the module in your hold and the canopy going white and spidering and holding." },
      { speaker: "KAEL",     text: "...Log his name. I want it in whatever I write." },
    ],
    choices: null, next: "vex_a3_09", autoAdvance: null });

  add({ id: "vex_a3_09", background: "bg_vex_hangar",
    character: { portrait: "vex_kael", expression: "shaken", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "I have the module, the archive, and a grave patrol that arrived nine years early on the authority of a form. I do not have nine months, because they have now moved openly, and openly means they have stopped caring what we know." },
      { speaker: "DREN", text: "Which means the nine months were never on offer. I withdraw my position. Formally, and with some feeling." },
      { speaker: "KAEL", text: "Then what remains is the question of what the fleet is told, and by whom, and in what words. And I find — " },
      { speaker: null,   text: "He stops. Kael, who has never once needed a second attempt at a sentence." },
      { speaker: "KAEL", text: "I find I do not trust my own judgement on it. I have discovered this week that my judgement has been an instrument. You have been outside the volume, pilot. You have flown for both of us. Say it and I will carry it." },
    ],
    choices: [
      { label: "Broadcast it. Every ship, unedited, all at once.",  next: "vex_a3_10a", flag: "vex_a3_broadcast" },
      { label: "Give it to the Admiralty. Let the order judge itself.", next: "vex_a3_10b", flag: "vex_a3_admiralty" },
      { label: "Publish it to the Combine too. Both dishes, both ways.", next: "vex_a3_10c", flag: "vex_a3_told_both_sides" },
    ], next: null, autoAdvance: null });

  add({ id: "vex_a3_10a", background: "bg_vex_hangar",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Every ship. Unedited. No summary, no framing, no adjudication — the raw archive and the module, to every hull in the fleet at the same instant." },
      { speaker: "KAEL", text: "That is not how a finding is delivered." },
      { speaker: "YOU",  text: "A finding is delivered down a chain, Adjudicator, and the chain is the compromised part. Anything that goes down it arrives pre-approved by exactly the structure that got steered." },
      { speaker: null,   text: "It goes out on the general band at fleet noon: two centuries of assessments, a transponder module, and eleven words from an adjudicator who declines to interpret them for you." },
      { speaker: null,   text: "The Dominion does not mutiny. It does something far stranger and far more Vex: nine hundred million people begin, simultaneously and without instruction, to audit. Every list. Every order. Every form number." },
      { speaker: null,   text: "It will take a generation and it will be the most thorough thing anyone has ever done. They don't decorate. They fortify — and they have just been handed the actual wall." },
    ],
    choices: null, next: "vex_a3_11", autoAdvance: null });

  add({ id: "vex_a3_10b", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "The Admiralty. In session, on the record, with you presenting — because if the order can't survive being told the truth by its own adjudicator in its own chamber, then it was never an order. It was a habit." },
      { speaker: "KAEL", text: "And if they suppress it." },
      { speaker: "YOU",  text: "Then they'll have done it in front of a recorder, and that's a finding too. Just a different one." },
      { speaker: null,   text: "He presents for six hours. He does not raise his voice, because he never has, and by the fourth hour that is the single most damning thing in the chamber." },
      { speaker: null,   text: "The Admiralty splits. Nine for the finding, seven against, two abstaining and requesting their abstention be recorded with reasons — which is a Vex way of screaming." },
      { speaker: null,   text: "It holds. Narrowly, formally, in the correct manner, with everything logged and numbered and owed. The Dominion has looked directly at the thing and remained the Dominion, and nobody who was in that chamber will ever be quite the same shape again." },
    ],
    choices: null, next: "vex_a3_11", autoAdvance: null });

  add({ id: "vex_a3_10c", background: "bg_vex_hangar",
    character: { portrait: "vex_dren", expression: "grim", position: "left" },
    dialogue: [
      { speaker: "YOU",  text: "Both dishes. Send it sunward AND send it to the terraces, in Combine format, out of the same box it came out of." },
      { speaker: "KAEL", text: "You are proposing that I hand the Krag Combine our complete targeting history." },
      { speaker: "YOU",  text: "I'm proposing you hand them THEIRS. It's in there. Two hundred years of their lists, written by the same hand, in their own format. They've been fortifying against a document too." },
      { speaker: "DREN", text: "It is the only move on the board the grey box cannot have wanted. Everything else it prepared for. It has been preparing for everything else for two centuries." },
      { speaker: null,   text: "It goes out on both dishes at the same instant, which requires flying back into the assessed volume to do, which is its own story and is not a short one." },
      { speaker: null,   text: "There is no peace. That is not what happens and you never thought it would be. What happens is that for the first time in two hundred years, two fleets are reading the same page — and both of them are looking up from it in the same direction." },
    ],
    choices: null, next: "vex_a3_11", autoAdvance: null });

  add({ id: "vex_a3_11", background: "vex_splash_banners", character: null,
    dialogue: [
      { speaker: null, text: "The banners in Tribunal Bay Six hang precise as blades. They have hung there since the founding, and every one of them is a volume held, a line fortified, a scar logged and numbered and owed." },
      { speaker: null, text: "You stood under them once as an ensign with eight dead behind you, and you believed every stitch." },
      { speaker: null, text: "They are not lies. That is the part it took you all three acts to reach. Every ship on those banners was really lost and every officer really held. The courage was never counterfeit." },
      { speaker: null, text: "Only the reasons were. Somebody handed the Dominion its enemies, in the proper format, at the proper pace, for two hundred years — and the Dominion did its duty flawlessly, which was exactly the point." },
      { speaker: null, text: "Kael has your old insignia on the bench in front of him. He has been turning it over for some minutes." },
      { speaker: "KAEL", text: "Every scar logged, numbered, and owed. Yours is on no ledger anywhere." },
      { speaker: "KAEL", text: "Start one. I will countersign it, and for once in my life I will know what I am countersigning." },
    ],
    choices: null, next: null, autoAdvance: 11000 });

  /* ===== NOX ACT 2 — "THE PIPE". The Covenant's investments are couriers,
     and what they carry is not in the hold — it is in the paperwork of every
     legitimate run they have ever flown. The player does not discover that
     the Nox did it. The player discovers that THEY did it, personally, on
     every manifest they have filed since the pod opened. ================= */
  add({ id: "nox_a2_01", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "You came back. Good. The ones who return on their own schedule are generally worth the wait." },
      { speaker: "SIVE", text: "The second errand, as promised. Slightly larger. I did say." },
      { speaker: "SIVE", text: "A mooring in the deep dark — not the one you know, a further one. You will carry nothing there and bring nothing back. You will simply arrive, hold station for six hours, and leave." },
      { speaker: "YOU",  text: "Not even a case this time." },
      { speaker: "SIVE", text: "You found the case unsatisfying. I listened. This one has no box at all to be disappointed by." },
    ],
    choices: null, next: "nox_a2_02", autoAdvance: null });

  add({ id: "nox_a2_02", background: "bg_nox_mooring", character: null,
    dialogue: [
      { speaker: null, text: "The approach is familiar. You notice it somewhere in the ninth hour, the way you notice a word you have said too many times." },
      { speaker: null, text: "Not the volume — you have never been out this far. The APPROACH. The burn schedule, the two long corrections, the shallow angle onto the spar. Your hands know it. You have flown this exact shape before and you have never been here." },
      { speaker: "YOU", text: "...I have flown it on trade runs. Every one of them. It's the same profile." },
      { speaker: null, text: "The mooring is a spar of dark metal with no lights and no name, and it has an approach beacon, and the beacon has been running long enough to have worn a groove in the sky." },
    ],
    choices: [
      { label: "Pull the mooring's log. It's been counting arrivals.", next: "nox_a2_03a", flag: "nox_a2_pulled_log" },
      { label: "Open a channel to Sive. Ask, from out here.",          next: "nox_a2_03b", flag: "nox_a2_asked_sive" },
      { label: "Hold station six hours. Do the errand and think.",     next: "nox_a2_03c", flag: "nox_a2_held_station" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a2_03a", background: "bg_nox_mooring", character: null,
    dialogue: [
      { speaker: null, text: "The mooring gives up its log without being asked twice, which by now you recognise as the Covenant's actual security model: nothing is hidden, because nothing needs to be." },
      { speaker: null, text: "Arrivals. Two hundred and eleven years of them, in a rhythm — a hauler, a hold, six hours of station-keeping, a departure. Never the same registry twice for long." },
      { speaker: null, text: "You find your own arrival at the bottom. Above it, the one before you, ending forty years ago. Above that, one ending sixty-one. The column is very long and every entry ends." },
      { speaker: "YOU", text: "Ends. Not 'departed'. ENDS." },
    ],
    choices: null, next: "nox_a2_04", autoAdvance: null });

  add({ id: "nox_a2_03b", background: "bg_nox_mooring", character: null,
    dialogue: [
      { speaker: "YOU",  text: "Sive. I've flown this profile before. On ore runs, on contract hauls, on jobs the Covenant had nothing to do with. Why does my own trade route land on your mooring?" },
      { speaker: null,   text: "Eleven hours of light-lag each way. You get the answer the following day, and it is four words long, and Sive has clearly spent none of the intervening time deciding what to say." },
      { speaker: "SIVE", text: "Because you fly efficiently." },
      { speaker: "YOU",  text: "...That's not an answer." },
      { speaker: "SIVE", text: "It is a complete answer. It is simply not yet a satisfying one. Come home and I will make it worse." },
    ],
    choices: null, next: "nox_a2_04", autoAdvance: null });

  add({ id: "nox_a2_03c", background: "bg_nox_mooring", character: null,
    dialogue: [
      { speaker: null, text: "You hold station for six hours and you do not touch anything, which is the third time you have been asked to do nothing and the first time you have understood that doing nothing is the measurement." },
      { speaker: null, text: "In the fourth hour you work out what the profile is for. It is not a route. A route gets you somewhere. This is a SHAPE — a burn signature, distinctive, repeatable, filed with every port authority you have ever cleared." },
      { speaker: "YOU", text: "It's a letterhead. I've been flying a letterhead." },
    ],
    choices: null, next: "nox_a2_04", autoAdvance: null });

  add({ id: "nox_a2_04", background: "explosion_silent_wreck", character: null,
    dialogue: [
      { speaker: null, text: "There is a tug moored on the spar's far side. You come around it in the sixth hour, on the way out, because the sixth hour is over and you have stopped being careful." },
      { speaker: null, text: "Vulture-class. Three hundred thousand klicks on the drive, at a guess, and a name painted over on the bow." },
      { speaker: null, text: "The paint is forty years old and the hull is cold and there is somebody still in the seat, and the seat is the same seat, in the same position, adjusted for the same reach as yours, because the Covenant does not waste a fitting any more than the Combine wastes metal." },
      { speaker: "YOU", text: "Oh." },
    ],
    choices: null, next: "nox_a2_05", autoAdvance: null });

  add({ id: "nox_a2_05", background: "explosion_silent_wreck", character: null,
    dialogue: [
      { speaker: null, text: "Their manifests are still in the tube under the seat. Forty years of ordinary hauling — ore, coolant, grain, machine parts. Combine ports, Dominion ports, everywhere. Filed, stamped, cleared, and legitimate to the last line." },
      { speaker: null, text: "And clipped to every single one, in the annex position where a hauler never looks because a hauler is paid not to, is a second sheet. Different stock. No origin stamp. A form number." },
      { speaker: null, text: "Survey findings. Strength assessments. Interdiction candidates. Two dishes' worth of them, carried into two centuries of ports by an ordinary tug with a plausible cargo and a burn signature the port authorities had learned to wave through." },
      { speaker: "YOU", text: "...Check mine. Check MINE." },
      { speaker: null, text: "You do not need to check yours. Your hand is already on your own document tube and you already know what is clipped behind every manifest you have filed since you woke up." },
    ],
    choices: null, next: "nox_a2_06", autoAdvance: null });

  add({ id: "nox_a2_06", background: "explosion_cockpit_impact", character: null,
    dialogue: [
      { speaker: null, text: "The mooring purges at the seventh hour, because the errand was six." },
      { speaker: null, text: "It is not an attack. That is somehow worse. The spar simply performs a scheduled venting of forty years of accumulated station-keeping mass, on a timer, into the volume where a tug would be if a tug had left when it was told." },
      { speaker: null, text: "You take the leading edge of it broadside. The canopy goes white, then spiders, then holds, and you come off the spar sideways with the old tug's manifest tube clamped under one arm and your own still in your fist." },
      { speaker: "YOU", text: "Not a punishment. Not a punishment. Just — a schedule. Just the schedule." },
    ],
    choices: null, next: "nox_a2_07", autoAdvance: null });

  add({ id: "nox_a2_07", background: "bg_nox_deepdark",
    character: { portrait: "player_hauler", expression: "battered", position: "left" },
    dialogue: [
      { speaker: null, text: "Eleven hours back with the cabin at half pressure and two document tubes strapped into the jump seat like passengers." },
      { speaker: null, text: "You go through your own. Every run since the pod opened. The ore haul to the terraces. The coolant contract. The grain, the machine parts, the honest little jobs you took to build a stake." },
      { speaker: null, text: "Every one of them has a second sheet. You have carried a forged survey into a Combine port and a strength assessment into a Dominion one and you have signed for both, by hand, in your own writing, with a docking clerk watching." },
      { speaker: "YOU", text: "I did this. Not them. My hand. My signature. My route." },
    ],
    choices: [
      { label: "Put both tubes on the table in front of Sive.",   next: "nox_a2_08a", flag: "nox_a2_confronted_sive" },
      { label: "Say nothing. Let them open the conversation.",    next: "nox_a2_08b", flag: "nox_a2_stayed_silent" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a2_08a", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: null,   text: "You put both tubes down between you. Yours and the dead one's. You do not say anything, because there is nothing in your chest with a shape that would fit through your mouth." },
      { speaker: "SIVE", text: "Ah. You went round the spar." },
      { speaker: "YOU",  text: "Forty years. Their seat is set to my reach." },
      { speaker: "SIVE", text: "Yes. You are a very similar build, and we do not waste a fitting. I could tell you their name. Most decline. You will not decline, so: Teil. They were good, and they were tired, and they asked me almost exactly this question in almost exactly that tone." },
    ],
    choices: null, next: "nox_a2_09", autoAdvance: null });

  add({ id: "nox_a2_08b", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: null,   text: "You say nothing. You walk in with two tubes under your arm and half a canopy and you wait, and Sive lets the silence run for a length of time that would be rude in any other company." },
      { speaker: "SIVE", text: "You are waiting for me to open it, so that whatever I say is something I chose to say and not something you dragged out. That is good instrument design. I taught you nothing of the kind and you built it yourself." },
      { speaker: "SIVE", text: "Very well. Their name was Teil. Forty years, the same profile, the same seat — you are a similar build and we do not waste a fitting. They asked me this in a different tone. Yours is better." },
    ],
    choices: null, next: "nox_a2_09", autoAdvance: null });

  add({ id: "nox_a2_09", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Say it. Say the whole thing, in one sentence, without the patience." },
      { speaker: "SIVE", text: "The Covenant has been supplying both the Krag Combine and the Vex Dominion with their assessments of one another for two hundred and eleven years, and the couriers who place those documents into legitimate port paperwork are the investments, and you are the current one." },
      { speaker: null,   text: "It comes out flat and immediate and without a single ornament, and that — after everything, after the constellations and the borrowed boots and the appreciating asset — is the most frightening thing they have ever done." },
      { speaker: "YOU",  text: "You started their war." },
      { speaker: "SIVE", text: "We did. There is no version of this where I say otherwise and no version where I ask you to understand. We did this. I have said it in that order for a hundred and forty years and it has never once got easier to arrange." },
    ],
    choices: null, next: "nox_a2_10", autoAdvance: null });

  add({ id: "nox_a2_10", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Why show me? You could have kept me flying letterheads for forty years like Teil." },
      { speaker: "SIVE", text: "Teil found the spar in their thirty-ninth year. I have never chosen when an investment finds the spar. That is rather the point of an investment — it appreciates on its own schedule or it is not one." },
      { speaker: "SIVE", text: "You found it in your first. That is not a compliment, it is a problem, and it is MY problem, and I have been sitting with it since your telemetry came in." },
      { speaker: "YOU",  text: "Then answer one more and I'll decide what I am to you." },
      { speaker: "SIVE", text: "Ask." },
      { speaker: "YOU",  text: "There's a signal out of the Arix gas layer. Ninety-year rhythm. Every chart calls it weather and it is not weather." },
      { speaker: null,   text: "For the first time since the pod lid lifted, Sive is quiet for longer than they meant to be." },
      { speaker: "SIVE", text: "...No. It is not weather. Would you like to know what it is counting?" },
    ],
    choices: null, next: "nox_a2_11", autoAdvance: null });

  add({ id: "nox_a2_11", background: "nox_splash_census", character: null,
    dialogue: [
      { speaker: null, text: "You take your tug out to a standoff distance before you burn, the way you did after the first errand, and you turn her, and you look at the thing you woke up inside." },
      { speaker: null, text: "The Patient Answer runs dark and enormous through the outer dark, and along her flank the cryo tiers glow, rank on rank, going back further than your lamps reach. You stopped counting in the four hundreds once, because you had an errand." },
      { speaker: null, text: "You do not have an errand now. You count." },
      { speaker: null, text: "Eleven hundred and six. It takes most of a shift and your eyes are ruined by the end of it, and eleven hundred and six is not a crew, and it is not a colony, and it is not a reserve of couriers, because two hundred and eleven years at one courier at a time is fifty of them at the outside." },
      { speaker: null, text: "Eleven hundred and six is a POPULATION. Held in the cold. On a ship named for waiting." },
      { speaker: null, text: "Somewhere sunward, a gas layer counts to itself on a ninety-year rhythm, and has done since before the annex, and before the form number, and before anybody now alive was told what they were afraid of." },
    ],
    choices: null, next: null, autoAdvance: 11000 });

  /* ===== NOX ACT 3 — "THE WRONG QUESTION". Nox Prime. The Covenant ran the
     cull on themselves first; the machine that does it has not had a driver
     in two centuries. "We did this" completes as "we did this, and then we
     became the fourth thing it was done to." ============================= */
  add({ id: "nox_a3_01", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: null, text: "Nox Prime is eleven hours inward from anywhere and it is a ruin, and it has been described to you as a ruin, and every chart marks it as a ruin." },
      { speaker: null, text: "It is a ruin the way a stage is a house. The collapses are load-bearing. The scorch patterns run over surfaces that were never structural. Somebody took a functioning world and dressed it, carefully, over a very long time, to look like something that had already been lost." },
      { speaker: "SIVE", text: "You are working it out. Take your time — everyone does it standing exactly there, and it is the only view on the planet designed for the purpose." },
    ],
    choices: null, next: "nox_a3_02", autoAdvance: null });

  add({ id: "nox_a3_02", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "Here is the argument, and I am going to make it properly, because you have earned a real one and because a bad version of it would be a kindness and you have not asked me for kindness once." },
      { speaker: "SIVE", text: "Two species. Both expansionist, both armed, both on curves. Run the curves out four hundred years and they meet at a volume neither can leave, with fleets neither can disband, and the meeting is total. Not a war. A termination — of both, and of everything in the volume, which includes us." },
      { speaker: "SIVE", text: "So the Covenant did not start a war. The Covenant started a SMALL one, and has kept it small, for two hundred and eleven years, by handing each side an enemy proportioned to keep them fortifying inward instead of expanding outward." },
      { speaker: "SIVE", text: "The moons the Combine ate are moons the Combine did not spend on hulls. The doctrine the Dominion built is a doctrine of holding lines. Every list I have ever had you carry made both of them smaller and slower and more frightened, and alive." },
    ],
    choices: [
      { label: "Show me the numbers. All of them.",              next: "nox_a3_03a", flag: "nox_a3_demanded_numbers" },
      { label: "I'm not hearing the justification. Show me the machine.", next: "nox_a3_03b", flag: "nox_a3_refused_justification" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a3_03a", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Numbers. If this is arithmetic then show me the arithmetic, all of it, including the column where you wrote down what it cost." },
      { speaker: "SIVE", text: "Ah. Nobody has asked for that column." },
      { speaker: null,   text: "It is longer than the other one. Four hundred and ten thousand dead in the Combine terraces of industrial disease alone. Two hundred and nine thousand Dominion service dead. Survey Team Seven, by name, all six. Convoy VD-77, by name, all eight." },
      { speaker: null,   text: "And at the bottom, in the same hand, with the same care: Teil. And forty-nine names above Teil." },
      { speaker: "SIVE", text: "I keep both columns. I have never shown anyone the second because the first is the argument and the second is only the truth." },
    ],
    choices: null, next: "nox_a3_04", autoAdvance: null });

  add({ id: "nox_a3_03b", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Stop. I'm not going to sit on a dressed ruin and be walked through why it was necessary, because you're good at this and I've been awake eight months." },
      { speaker: "YOU",  text: "Show me the machine. The thing that actually issues the lists. Not the reasoning — the box." },
      { speaker: "SIVE", text: "...Yes. That is the correct instinct and it arrived four decades earlier in you than it did in Teil." },
      { speaker: "SIVE", text: "I should warn you that the reasoning is the part I can defend. Come along, then. You have asked for the other part." },
    ],
    choices: null, next: "nox_a3_04", autoAdvance: null });

  add({ id: "nox_a3_04", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: null,    text: "It is under the dressed ruin, and it is not large. That is the first surprise. Two centuries of a war fit into a chamber the size of a cargo hold, and most of the chamber is empty, and the empty part has clearly been empty for a long time." },
      { speaker: null,    text: "There are seats for eleven. They are the wrong shape for anyone who has been in this room recently, because nobody has been in this room recently." },
      { speaker: "RELAY", text: "Cycle two hundred and eleven. Assessment issued, both formats. Census returned. Population variance within tolerance. Continuing." },
      { speaker: "YOU",   text: "Sive. Who's it talking to?" },
      { speaker: "SIVE",  text: "The gas layer at Arix. It has been asking the same question every ninety years since before I was born, and the gas layer answers, and it continues." },
    ],
    choices: null, next: "nox_a3_05", autoAdvance: null });

  add({ id: "nox_a3_05", background: "explosion_silent_wreck",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: null, text: "The chamber wall opens onto the census itself, which is the actual surface of Nox Prime, which is what the ruin was dressed to cover." },
      { speaker: null, text: "It is a debris field. A world-sized one, held in place, catalogued — and it is not rubble. It is fleets. Nox hulls, in tens of thousands, going out to the horizon in a grid, every one of them logged and numbered and held in position for two hundred and eleven years." },
      { speaker: "SIVE", text: "We ran the curves on ourselves first. We were the two species, once. There were two of us and we were on curves and we met in a volume we could not leave." },
      { speaker: "SIVE", text: "The survivors built that machine so it could never happen again, and gave it the authority to keep any two populations small, and then — this is the part I need you to hear properly — then the survivors died. Of age. Over four hundred years. Because we were already too few." },
      { speaker: "YOU",  text: "Eleven hundred and six." },
      { speaker: "SIVE", text: "Eleven hundred and six, in the cold, on a ship named for waiting. That is the Nox Covenant. All of it. I am not the ancient dark, hauler. I am a caretaker with a very large filing system and no one left to ask." },
    ],
    choices: null, next: "nox_a3_06", autoAdvance: null });

  add({ id: "nox_a3_06", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Then turn it off. You're the caretaker. Turn it off." },
      { speaker: "SIVE", text: "I have no authority over it. Nobody does. It was very deliberately built so that no one could stop it in a moment of sentiment, by people who had just watched sentiment cost them a species." },
      { speaker: "SIVE", text: "I do not run the cull. I SERVE it. I wake couriers because the machine requires documents placed, and I place them, and I have done it for a hundred and forty years, and every ninety years it counts and continues." },
      { speaker: "YOU",  text: "You're an errand." },
      { speaker: "SIVE", text: "..." },
      { speaker: "SIVE", text: "Yes. I have never had that put to me. I find I do not care for it, which is how I know it is accurate." },
    ],
    choices: null, next: "nox_a3_07", autoAdvance: null });

  add({ id: "nox_a3_07", background: "explosion_debris_field",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "RELAY", text: "Census interval closing. Cycle two hundred and twelve preparing. Variance projection: Combine population above tolerance. Combine assessment weighting increased." },
      { speaker: "YOU",   text: "What does 'weighting increased' mean." },
      { speaker: "SIVE",  text: "It means the next two hundred years of Krag lists will be worse than the last two hundred, because the Combine has had a good century and grown, and the machine has noticed, and the machine's only instrument is fear." },
      { speaker: null,    text: "Outside, in the held grid, ten thousand catalogued Nox hulls hang in the dark exactly where they were put — and the chamber with eleven empty seats begins, quietly and on schedule, to compose the documents that will eat somebody else's moons." },
      { speaker: "SIVE",  text: "It will issue in fourteen hours. I have watched this happen twice. I have never once had anybody standing next to me for it." },
    ],
    choices: null, next: "nox_a3_08", autoAdvance: null });

  add({ id: "nox_a3_08", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "So. You asked me once what you were to me and I said an investment, and I meant it, and it was true, and it was also the smallest true thing available." },
      { speaker: "SIVE", text: "Here is the larger one. The machine cannot be stopped by anyone with authority over it, because it was built to resist exactly that. It has no defence at all against someone with no authority whatsoever." },
      { speaker: "SIVE", text: "It has an input. One. Documents, placed in ports, by a courier. That is the entire surface where the cull touches the world, and for two hundred and eleven years the Covenant has kept a hand on it so that nobody else ever could." },
      { speaker: "SIVE", text: "The hand is currently yours. It has been yours since your first manifest. I am not going to tell you what to do with it — I have been an errand for a hundred and forty years and I am, apparently, done." },
    ],
    choices: [
      { label: "Cut the input. No more documents, ever. Let it count into silence.", next: "nox_a3_09a", flag: "nox_a3_cut_the_input" },
      { label: "Keep placing them. Small and frightened is still alive.",            next: "nox_a3_09b", flag: "nox_a3_kept_the_cull" },
      { label: "Place my own. If it only reads paperwork, I'll write the paperwork.", next: "nox_a3_09c", flag: "nox_a3_took_the_pen" },
    ], next: null, autoAdvance: null });

  add({ id: "nox_a3_09a", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Nothing goes into a port again. Not from me, not from the next one, not ever. It can compose whatever it likes for the next ten thousand years and it can hand it to an empty room." },
      { speaker: "SIVE", text: "You understand what you are accepting. Two curves, unmanaged, running out four hundred years." },
      { speaker: "YOU",  text: "I'm accepting that they get to be the ones who run them. It's their volume, Sive. It was always their volume. You've been steering two species by their fear for two centuries and you've made them SMALL, and small is what you've got to show for it." },
      { speaker: "SIVE", text: "...Yes." },
      { speaker: null,   text: "Cycle two hundred and twelve issues on schedule, fourteen hours later, into a chamber with eleven empty seats. Nobody carries it. Nothing happens." },
      { speaker: null,   text: "It will issue again in ninety years, and again, and again, and the Krag and the Vex will have to find out what they actually are without a stranger's paper telling them. It may be terrible. It will be theirs." },
    ],
    choices: null, next: "nox_a3_10", autoAdvance: null });

  add({ id: "nox_a3_09b", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "neutral", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "I place them. Cycle two hundred and twelve, and the one after, same as Teil, same as the forty-nine before Teil." },
      { speaker: "SIVE", text: "You have seen the second column." },
      { speaker: "YOU",  text: "I've seen both columns. That's why. Four hundred and ten thousand dead in the terraces is a number I can hold in my hands. Two species terminating in a volume they can't leave isn't a number, it's a hole, and I'm not putting everyone in it to feel clean." },
      { speaker: "SIVE", text: "That is Harrow's argument. He signed a forged annex on it, two hundred years ago, and has not slept since." },
      { speaker: "YOU",  text: "Then I'll be the second one who didn't sleep. Add my name to the column. Bottom of the second one, under Teil, in your handwriting, so it's on the record that I knew." },
      { speaker: null,   text: "Sive writes it. It takes a long time, because they write it very carefully, and neither of you says anything at all while it is happening." },
    ],
    choices: null, next: "nox_a3_10", autoAdvance: null });

  add({ id: "nox_a3_09c", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "pleased", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Third option. The machine issues, I carry — and what arrives in the ports is not what it wrote." },
      { speaker: "SIVE", text: "You would forge the forgeries." },
      { speaker: "YOU",  text: "It doesn't check. It has never checked, in two hundred and eleven years, because the input is a courier and it has always had the Covenant's hand on it. It can't tell the difference between the world and the census, and the census is a gas layer answering a question." },
      { speaker: "YOU",  text: "So I write the paperwork. Assessments that de-escalate. Interdiction lists that get shorter. Two centuries of a stranger's hand made them frightened of each other, and it worked, and it'll work backwards just as well and about as slowly." },
      { speaker: "SIVE", text: "It would take a hundred years." },
      { speaker: "YOU",  text: "You've got eleven hundred and six people in cold storage and a ship named Patient Answer. Don't tell me about a hundred years." },
      { speaker: null,   text: "Sive laughs. It is a small sound, entirely unpractised, and possibly the first one in a century and a half." },
    ],
    choices: null, next: "nox_a3_10", autoAdvance: null });

  add({ id: "nox_a3_10", background: "bg_nox_prime",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "YOU",  text: "Answer me one thing straight, and then I'll go and do it." },
      { speaker: "YOU",  text: "Were you right? All of it — the moons, the convoy, Survey Seven, Teil, two hundred years of frightening people into being small. Was the Covenant RIGHT?" },
      { speaker: null,   text: "Sive looks out at the held grid, at ten thousand catalogued hulls of a species that ran the numbers on itself and got the answer." },
      { speaker: "SIVE", text: "Every caretaker before me asked that question in this room, of somebody, and eleven of them left a written answer, and I have read all eleven." },
      { speaker: "SIVE", text: "The answer is: the question was wrong." },
      { speaker: "SIVE", text: "There was never a version where we were right or wrong. There was a version where we decided, and a version where we let a machine decide, and we chose the second one because it was easier to live with, and then we forgot it was a choice, and then we were a species that took orders from its own filing cabinet." },
      { speaker: "SIVE", text: "You are the first person in two hundred and eleven years to stand in this room and decide anything. Whatever you chose. That is the whole of it." },
    ],
    choices: null, next: "nox_a3_11", autoAdvance: null });

  add({ id: "nox_a3_11", background: "nox_splash_wrong_question", character: null,
    dialogue: [
      { speaker: null, text: "You lift off Nox Prime and the dressed ruin falls away beneath you, its load-bearing collapses and its decorative scorch marks, a whole world costumed as an aftermath by people who could not bear to be seen still standing." },
      { speaker: null, text: "You were told you were an investment. You were told the Covenant is cold, ancient, calculating, and drifts the outer dark in patterns older than any charted war." },
      { speaker: null, text: "All of that was true and none of it was the thing. The thing is eleven hundred and six survivors in cold storage, serving a machine their grandparents built to save them, in a room with eleven empty seats." },
      { speaker: null, text: "They engineered the war. They did this. And then they spent two centuries as the fourth thing it was done to, filing correctly, on schedule, for a cabinet." },
      { speaker: null, text: "Behind you the gas layer at Arix goes on counting on its ninety-year rhythm, the way it has since before the annex and before the form number and before anyone now alive was told what to be afraid of." },
      { speaker: null, text: "It is going to ask again. In ninety years it will ask again, and this time somebody will be there who knows it is a question." },
    ],
    choices: null, next: null, autoAdvance: 11000 });

  /* ========================================================================
     COMPANION ARC — REVA (Krag Combine), CADE (Vex Dominion), LIRA (Nox
     Covenant). Six beats each across the middle of the campaign; death scenes
     fire at the Act 3 climax. These scenes are NOT wired into the main act
     chains — they live in VN_SCENES and are structurally valid but are only
     reachable via direct GAME.vnStart() calls from the companion gameplay
     system (not yet built). Ids do NOT share the krag_a2_ / krag_a3_ prefix
     so vnSelfTest's act-isolation walk never reaches them from the act roots.
     ===================================================================== */

  /* ===== REVA — Krag Combine. Deadpan, competent, funny on a two-second
     delay. Running gag: "That's not structural." Breaks on the last line.
     dialogue_m / dialogue_f: gendered first-meet and romance beats. */
  add({ id: "krag_comp_intro", background: "bg_krag_dock",
    character: { portrait: "krag_reva", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null, text: "A salvager out of the Krag debris fields, hull plating that belongs to at least three different ships. She has been watching you park for about thirty seconds longer than polite." },
      { speaker: "REVA", text: "You're still flying that? Either you're very lucky or very cheap. I haven't decided if I like either." },
    ],
    dialogue_m: [
      { speaker: null, text: "A salvager out of the Krag debris fields, hull plating that belongs to at least three different ships. She has been watching you park for about thirty seconds longer than polite." },
      { speaker: "REVA", text: "You're still flying that? Either you're very lucky or very cheap. I haven't decided if I like either." },
      { speaker: "REVA", text: "Most men who limp into Mira like that are already dead and haven't noticed. You noticed. That's interesting." },
      { speaker: "YOU",  text: "Interesting is a start." },
      { speaker: "REVA", text: "Don't get ideas. Interesting is also what I call a hull that might explode." },
    ],
    dialogue_f: [
      { speaker: null, text: "A salvager out of the Krag debris fields, hull plating that belongs to at least three different ships. She has been watching you park for about thirty seconds longer than polite." },
      { speaker: "REVA", text: "You're still flying that? Either you're very lucky or very cheap. I haven't decided if I like either." },
      { speaker: "REVA", text: "Most women who limp into Mira like that are already dead and haven't noticed. You noticed. That's interesting." },
      { speaker: "YOU",  text: "Interesting is a start." },
      { speaker: "REVA", text: "Don't get ideas. Interesting is also what I call a hull that might explode." },
    ],
    choices: null, next: null, autoAdvance: null });

  add({ id: "krag_comp_beat2", background: "bg_space_contested",
    character: { portrait: "krag_reva", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "You pulled their flank off mine back there. Didn't have to do that." },
      { speaker: "REVA", text: "I was already in the neighborhood." },
      { speaker: "YOU",  text: "Right. Thanks." },
      { speaker: "REVA", text: "Don't." },
      { speaker: null,   text: "She means it. You don't. The channel stays open three seconds longer than it needs to — long enough that both of you notice and neither of you hangs up first." },
      { speaker: "REVA", text: "...That's not structural." },
      { speaker: null,   text: "She means the silence. Or the hull. Or the thing neither of you will name yet." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "krag_comp_beat3", background: "bg_krag_dock",
    character: { portrait: "krag_reva", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "REVA", text: "Previous crew I ran with — good people, every one of them. Combine had them hauling manifests they didn't know were live ordinance until the Vex intercepted." },
      { speaker: "REVA", text: "Three survivors out of eleven. One of them was me, which tells you more about my luck than my virtue." },
      { speaker: null,   text: "A pause. She finds something to look at behind you, which is how she looks at soft things." },
      { speaker: "REVA", text: "Anyway. That's why I fly solo. Don't read anything into it." },
      { speaker: "YOU",  text: "I already did." },
      { speaker: "REVA", text: "...Yeah. Me too. Don't make me say it twice." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "krag_comp_beat4", background: "bg_krag_dock",
    character: { portrait: "krag_reva", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "REVA", text: "I've decided I like lucky. For the record." },
      { speaker: "YOU",  text: "For the record." },
      { speaker: "REVA", text: "If we get a after — a real after, not a berth and a next job — I want it quiet. Coffee that isn't burned. A hull that isn't venting. You, still breathing." },
      { speaker: "REVA", text: "That's the whole plan. Don't make me write it down." },
      { speaker: null,   text: "She doesn't kiss you. She does the Reva thing: stands close enough that the air changes, and leaves before either of you has to be brave about it." },
    ],
    dialogue_m: [
      { speaker: "REVA", text: "I've decided I like lucky. For the record." },
      { speaker: "YOU",  text: "For the record." },
      { speaker: "REVA", text: "If we get a after — a real after — I want it quiet. You, still breathing. Me, not counting exits every time a door opens." },
      { speaker: "REVA", text: "You're a stubborn man with a soft landing. Don't make me rewrite the plan." },
      { speaker: null,   text: "She doesn't kiss you. She stands close enough that the air changes, and leaves before either of you has to be brave about it. Your chest does not care about bravery." },
    ],
    dialogue_f: [
      { speaker: "REVA", text: "I've decided I like lucky. For the record." },
      { speaker: "YOU",  text: "For the record." },
      { speaker: "REVA", text: "If we get a after — a real after — I want it quiet. You, still breathing. Me, not counting exits every time a door opens." },
      { speaker: "REVA", text: "You're a stubborn woman with a soft landing. Don't make me rewrite the plan." },
      { speaker: null,   text: "She doesn't kiss you. She stands close enough that the air changes, and leaves before either of you has to be brave about it. Your chest does not care about bravery." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* REVA — death scenes */
  add({ id: "krag_comp_death_1", background: "explosion_cockpit_impact",
    character: { portrait: "krag_reva", expression: "grave", position: "right" },
    dialogue: [
      { speaker: "REVA", text: "Hull's open. Port side, all the way through." },
      { speaker: null,   text: "Her voice is level. The way she says everything. The way she says everything that isn't this." },
      { speaker: "REVA", text: "...That one was structural." },
    ], choices: null, next: "krag_comp_death_2", autoAdvance: null });

  add({ id: "krag_comp_death_2", background: "explosion_debris_field",
    character: null,
    dialogue: [
      { speaker: null, text: "The channel stays open. Static." },
    ], choices: null, next: "krag_comp_death_3", autoAdvance: null });

  add({ id: "krag_comp_death_3", background: "explosion_silent_wreck",
    character: null,
    dialogue: [
      { speaker: null, text: "..." },
    ], choices: null, next: "krag_comp_death_4", autoAdvance: 7000 });

  add({ id: "krag_comp_death_4", background: "bg_krag_dock",
    character: { portrait: "krag_voss", expression: "grim", position: "right" },
    dialogue: [
      { speaker: null,   text: "Homeport Mira. Voss at the dock window, looking at something outside." },
      { speaker: "VOSS", text: "Salvagers get a line in a ledger. That is the arrangement. That has always been the arrangement." },
      { speaker: "VOSS", text: "I told you on your first day that the Combine wastes nothing." },
      { speaker: "VOSS", text: "I have been saying that for sixty years. I would like it very much to be true." },
    ], choices: null, next: "krag_ending", autoAdvance: 7000 });
  // wired: krag_comp_death_4 → krag_ending (Act 3 outro, after climax onComplete)

  /* ===== CADE — Vex Dominion. Former enforcement pilot, formal, still
     believes. Running gag: "Acknowledged, logged, and countersigned." for
     trivial radio traffic. Breaks on the last two words. */
  add({ id: "vex_comp_intro", background: "bg_vex_hangar",
    character: { portrait: "vex_cade", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "A decommissioned Vex interceptor, faction markings half-scraped. The pilot disembarks like he is still on duty, then remembers he isn't, and doesn't quite stop standing at attention." },
      { speaker: "CADE", text: "They gave me a tribunal and a severance packet. I kept the ship. The tribunal can have the rest." },
    ],
    dialogue_m: [
      { speaker: null,   text: "A decommissioned Vex interceptor, faction markings half-scraped. The pilot disembarks like he is still on duty, then remembers he isn't, and doesn't quite stop standing at attention." },
      { speaker: "CADE", text: "They gave me a tribunal and a severance packet. I kept the ship. The tribunal can have the rest." },
      { speaker: "CADE", text: "You fly like someone who still believes the formation will hold. That is either admirable or a medical condition. I have not decided which I prefer in a man." },
      { speaker: "YOU",  text: "Prefer is a strong word." },
      { speaker: "CADE", text: "Acknowledged. Logged. Not yet countersigned." },
    ],
    dialogue_f: [
      { speaker: null,   text: "A decommissioned Vex interceptor, faction markings half-scraped. The pilot disembarks like he is still on duty, then remembers he isn't, and doesn't quite stop standing at attention." },
      { speaker: "CADE", text: "They gave me a tribunal and a severance packet. I kept the ship. The tribunal can have the rest." },
      { speaker: "CADE", text: "You fly like someone who still believes the formation will hold. That is either admirable or a medical condition. I have not decided which I prefer in a woman." },
      { speaker: "YOU",  text: "Prefer is a strong word." },
      { speaker: "CADE", text: "Acknowledged. Logged. Not yet countersigned." },
    ],
    choices: null, next: null, autoAdvance: null });

  add({ id: "vex_comp_beat2", background: "bg_space_contested",
    character: { portrait: "vex_cade", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "Nice shot." },
      { speaker: "CADE", text: "Acknowledged, logged, and countersigned." },
      { speaker: "YOU",  text: "You don't have to log compliments." },
      { speaker: "CADE", text: "Old habit. And you're low on starboard shielding — I'm pulling your flank until you've had a chance to reroute." },
      { speaker: null,   text: "He is already in position before he has finished saying it. Cover that is also care, and he will never call it either." },
      { speaker: "CADE", text: "...For the log. That was not in the rules of engagement. I am aware." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "vex_comp_beat3", background: "bg_vex_hangar",
    character: { portrait: "vex_cade", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "CADE", text: "The question I asked — the one that got me the tribunal — I used to think I asked because it was the right thing to do." },
      { speaker: "CADE", text: "I've had some time to consider that I might have asked because I wanted the answer to be wrong. Those look the same from outside. The difference is which answer you were hoping for." },
      { speaker: null,   text: "He checks a console reading that doesn't need checking." },
      { speaker: "CADE", text: "Anyway. Filed under ongoing review." },
      { speaker: "YOU",  text: "What are you hoping for now?" },
      { speaker: "CADE", text: "That the next answer is allowed to be complicated. And that I am not alone when it arrives." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "vex_comp_beat4", background: "bg_vex_hangar",
    character: { portrait: "vex_cade", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "CADE", text: "For the record — and I am putting this on the record — I would like to fly with you after this is done, if there is an after." },
      { speaker: "CADE", text: "Not as cover. Not as a formation slot. As the person I want on the other end of the channel when the log is closed." },
      { speaker: "YOU",  text: "Acknowledged." },
      { speaker: "CADE", text: "Logged." },
      { speaker: null,   text: "He does not say countersigned. He looks at you instead, and that is the signature." },
    ],
    dialogue_m: [
      { speaker: "CADE", text: "For the record — I would like to fly with you after this is done, if there is an after." },
      { speaker: "CADE", text: "Not as cover. As the man I want on the other end of the channel when the log is closed." },
      { speaker: "YOU",  text: "Acknowledged." },
      { speaker: "CADE", text: "Logged." },
      { speaker: null,   text: "He does not say countersigned. He looks at you instead, and that is the signature." },
    ],
    dialogue_f: [
      { speaker: "CADE", text: "For the record — I would like to fly with you after this is done, if there is an after." },
      { speaker: "CADE", text: "Not as cover. As the woman I want on the other end of the channel when the log is closed." },
      { speaker: "YOU",  text: "Acknowledged." },
      { speaker: "CADE", text: "Logged." },
      { speaker: null,   text: "He does not say countersigned. He looks at you instead, and that is the signature." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* CADE — death scenes */
  add({ id: "vex_comp_death_1", background: "explosion_cockpit_impact",
    character: { portrait: "vex_cade", expression: "grave", position: "right" },
    dialogue: [
      { speaker: "CADE", text: "Acknowledged." },
      { speaker: null,   text: "A pause. Longer than it should be." },
      { speaker: "CADE", text: "Logged." },
    ], choices: null, next: "vex_comp_death_2", autoAdvance: null });

  add({ id: "vex_comp_death_2", background: "explosion_debris_field",
    character: null,
    dialogue: [
      { speaker: null, text: "The channel stays open. Static." },
    ], choices: null, next: "vex_comp_death_3", autoAdvance: null });

  add({ id: "vex_comp_death_3", background: "explosion_silent_wreck",
    character: null,
    dialogue: [
      { speaker: null, text: "..." },
    ], choices: null, next: "vex_comp_death_4", autoAdvance: 7000 });

  add({ id: "vex_comp_death_4", background: "bg_vex_tribunal",
    character: { portrait: "vex_kael", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "KAEL", text: "The finding is entered. Cause, circumstance, and the name. Every scar logged, numbered, and owed." },
      { speaker: "KAEL", text: "The ledger is complete." },
      { speaker: "KAEL", text: "It does not balance. I have checked it four times." },
    ], choices: null, next: "vex_ending", autoAdvance: 7000 });
  // wired: vex_comp_death_4 → vex_ending (Act 3 outro, after climax onComplete)

  /* ===== LIRA — Nox Covenant. Precise, dry, occasionally devastating. Assigned
     to monitor the player. Running gag: "I've filed it under —" with
     increasingly absurd categories. Categories dry up before the end. */
  add({ id: "nox_comp_intro", background: "bg_nox_cryo",
    character: { portrait: "nox_lira", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: null,   text: "Covenant escort, current-issue hull, pristine. The pilot who disembarks could be reading a maintenance log or writing one. Her expression does not commit either way." },
      { speaker: "LIRA", text: "I'm here to ensure your activities remain within Covenant parameters. Interesting that your first action was to buy a second coffee. I've filed it under 'behavioral baseline.'" },
    ],
    dialogue_m: [
      { speaker: null,   text: "Covenant escort, current-issue hull, pristine. The pilot who disembarks could be reading a maintenance log or writing one. Her expression does not commit either way." },
      { speaker: "LIRA", text: "I'm here to ensure your activities remain within Covenant parameters. Interesting that your first action was to buy a second coffee. I've filed it under 'behavioral baseline.'" },
      { speaker: "LIRA", text: "Also filed: that you are a man who buys two coffees when one would do. I have not yet decided if that is waste or hope." },
      { speaker: "YOU",  text: "Hope is cheaper than a tribunal." },
      { speaker: "LIRA", text: "I've filed that under 'provocation.' Politely." },
    ],
    dialogue_f: [
      { speaker: null,   text: "Covenant escort, current-issue hull, pristine. The pilot who disembarks could be reading a maintenance log or writing one. Her expression does not commit either way." },
      { speaker: "LIRA", text: "I'm here to ensure your activities remain within Covenant parameters. Interesting that your first action was to buy a second coffee. I've filed it under 'behavioral baseline.'" },
      { speaker: "LIRA", text: "Also filed: that you are a woman who buys two coffees when one would do. I have not yet decided if that is waste or hope." },
      { speaker: "YOU",  text: "Hope is cheaper than a tribunal." },
      { speaker: "LIRA", text: "I've filed that under 'provocation.' Politely." },
    ],
    choices: null, next: null, autoAdvance: null });

  add({ id: "nox_comp_beat2", background: "bg_nox_deepdark",
    character: { portrait: "nox_lira", expression: "neutral", position: "right" },
    dialogue: [
      { speaker: "YOU",  text: "You flew my flank back there. That wasn't in the parameters." },
      { speaker: "LIRA", text: "I've filed it under 'asset protection.'" },
      { speaker: "YOU",  text: "Thank you." },
      { speaker: "LIRA", text: "I've filed that under 'unsolicited acknowledgment.' You're welcome. I've filed that under— it's fine. You're welcome." },
      { speaker: null,   text: "She almost smiles. Almost is a category she does not have a form for yet." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "nox_comp_beat3", background: "bg_nox_cryo",
    character: { portrait: "nox_lira", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "LIRA", text: "I should note that my reports to the Covenant have been averaging sixty-three words shorter per cycle than my baseline." },
      { speaker: "LIRA", text: "I believe the deficit is the sections where I would normally detail activities that I have instead described as 'within parameters.' This is technically accurate. I want you to understand it is technically accurate." },
      { speaker: null,   text: "She doesn't say which activities. You don't ask. The silence is the warmest thing in the cryo bay." },
      { speaker: "LIRA", text: "I've filed this conversation under 'methodology review.'" },
      { speaker: "YOU",  text: "File me under something kinder." },
      { speaker: "LIRA", text: "...I'll consider an amendment." },
    ], choices: null, next: null, autoAdvance: null });

  add({ id: "nox_comp_beat4", background: "bg_nox_cryo",
    character: { portrait: "nox_lira", expression: "warm", position: "right" },
    dialogue: [
      { speaker: "LIRA", text: "I have stopped filing things under categories when it comes to you. I wanted you to know I noticed." },
      { speaker: "LIRA", text: "If there is an after — and I am modelling a non-zero probability — I would like coffee that is not a baseline. Just coffee. With you. Unlogged." },
      { speaker: "YOU",  text: "Unlogged." },
      { speaker: "LIRA", text: "I've filed that under 'a thing I will not be asking about again.' Which is a lie. I will ask again." },
    ],
    dialogue_m: [
      { speaker: "LIRA", text: "I have stopped filing things under categories when it comes to you. I wanted you to know I noticed." },
      { speaker: "LIRA", text: "If there is an after, I would like coffee that is not a baseline. Just coffee. With you — a man I am no longer pretending is only an asset. Unlogged." },
      { speaker: "YOU",  text: "Unlogged." },
      { speaker: "LIRA", text: "I've filed that under 'a thing I will not be asking about again.' Which is a lie. I will ask again." },
    ],
    dialogue_f: [
      { speaker: "LIRA", text: "I have stopped filing things under categories when it comes to you. I wanted you to know I noticed." },
      { speaker: "LIRA", text: "If there is an after, I would like coffee that is not a baseline. Just coffee. With you — a woman I am no longer pretending is only an asset. Unlogged." },
      { speaker: "YOU",  text: "Unlogged." },
      { speaker: "LIRA", text: "I've filed that under 'a thing I will not be asking about again.' Which is a lie. I will ask again." },
    ],
    choices: null, next: null, autoAdvance: null });

  /* LIRA — death scenes */
  add({ id: "nox_comp_death_1", background: "explosion_cockpit_impact",
    character: { portrait: "nox_lira", expression: "grave", position: "right" },
    dialogue: [
      { speaker: "LIRA", text: "I'm filing this under—" },
      { speaker: null,   text: "A pause." },
      { speaker: "LIRA", text: "...No. I'm not filing this one." },
    ], choices: null, next: "nox_comp_death_2", autoAdvance: null });

  add({ id: "nox_comp_death_2", background: "explosion_debris_field",
    character: null,
    dialogue: [
      { speaker: null, text: "The channel stays open. Static." },
    ], choices: null, next: "nox_comp_death_3", autoAdvance: null });

  add({ id: "nox_comp_death_3", background: "explosion_silent_wreck",
    character: null,
    dialogue: [
      { speaker: null, text: "..." },
    ], choices: null, next: "nox_comp_death_4", autoAdvance: 7000 });

  add({ id: "nox_comp_death_4", background: "bg_nox_cryo",
    character: { portrait: "nox_sive", expression: "grave", position: "center" },
    dialogue: [
      { speaker: "SIVE", text: "We projected a nineteen percent probability of this outcome. The projection was sound. I want you to understand that the projection was sound." },
      { speaker: "SIVE", text: "I find that I do not care what we projected." },
      { speaker: null,   text: "A pause long enough to mean something." },
      { speaker: "SIVE", text: "I have not had that thought before. I am not certain what to do with it." },
    ], choices: null, next: "nox_ending", autoAdvance: 7000 });
  // wired: nox_comp_death_4 → nox_ending (Act 3 outro, after climax onComplete)

  /* ===== ENDING CARDS — one per faction, fires after comp_death_4.
     character:null = full-bleed splash, no portrait card. autoAdvance:6000
     gives the line six seconds to read before the overlay closes. next:null
     is the terminus — vnEnd() fires, onComplete is the engine's final hook. */
  add({ id: "krag_ending", background: "krag_splash_verdict", character: null,
    dialogue: [
      { speaker: null, text: "The ledger closes. What's written in it is up to you now." },
    ], choices: null, next: null, autoAdvance: 6000 });

  add({ id: "vex_ending", background: "vex_splash_banners", character: null,
    dialogue: [
      { speaker: null, text: "The vote was always going to go that way. You just made sure Kael knew it was coming." },
    ], choices: null, next: null, autoAdvance: 6000 });

  add({ id: "nox_ending", background: "nox_splash_wrong_question", character: null,
    dialogue: [
      { speaker: null, text: "LIRA's final report was never filed. Sive keeps it in a drawer." },
    ], choices: null, next: null, autoAdvance: 6000 });

})();

// ---- the scene player ------------------------------------------------------
Object.assign(GAME, {
  // Resolve an asset key through its fallback chain to a concrete entry.
  _vnAssetEntry(key) {
    let k = key, hops = 0;
    while (k && VN_ASSETS[k] && !VN_ASSETS[k].src && hops++ < 8) k = VN_ASSETS[k].fallback;
    return k && VN_ASSETS[k] && VN_ASSETS[k].src ? VN_ASSETS[k] : null;
  },
  // Portrait spec → entry: try <portrait>_<expression>, then <portrait>_neutral.
  // player_hauler resolves to the face chosen at new-game (s.playerPortraitId),
  // so every "YOU" card shows the pilot the player picked.
  _vnPortraitEntry(spec) {
    if (!spec || !spec.portrait) return null;
    const expr = spec.expression || "neutral";
    if (spec.portrait === "player_hauler") {
      const pid = this.state && this.state.playerPortraitId;
      if (pid) {
        const live = this._vnAssetEntry(pid + "_" + expr)
                  || this._vnAssetEntry(pid + "_neutral");
        if (live) return live;
      }
    }
    return this._vnAssetEntry(spec.portrait + "_" + expr)
        || this._vnAssetEntry(spec.portrait + "_neutral");
  },
  _vnSave() {   // lazily create the persistent story blob on state
    const s = this.state;
    if (!s.vn || typeof s.vn !== "object") s.vn = { flags: {}, seen: {} };
    if (!s.vn.flags) s.vn.flags = {};
    if (!s.vn.seen) s.vn.seen = {};
    return s.vn;
  },
  vnFlag(name) { const s = this.state; return !!(s.vn && s.vn.flags && s.vn.flags[name]); },

  // Apply dialogue_m / dialogue_f on a scene (if present) for the pilot's gender.
  // Call before rendering any scene that may carry gendered paths.
  _vnApplyGender(sc) {
    if (!sc) return sc;
    if (sc.dialogue_m || sc.dialogue_f) {
      const g = (typeof this.playerGender === "function" && this.playerGender() === "f") ? "f" : "m";
      const pick = (g === "f" ? sc.dialogue_f : sc.dialogue_m) || sc.dialogue_m || sc.dialogue_f || sc.dialogue;
      if (pick) sc.dialogue = pick;
    }
    return sc;
  },

  // Start a chain. Returns false if the root scene doesn't exist. onComplete
  // fires exactly once — when a next:null scene finishes OR the player skips.
  vnStart(sceneId, onComplete) {
    if (!VN_SCENES[sceneId]) return false;
    this._vnApplyGender(VN_SCENES[sceneId]);
    this._vn = { id: null, li: 0, typing: false, onComplete: onComplete || null };
    this._vnShow(true);
    this._vnGoto(sceneId);
    return true;
  },
  // Save/resume hook: jump the live player to any scene in the chain.
  vnSkipTo(sceneId) { return this._vn ? this._vnGoto(sceneId) : false; },

  _vnGoto(id) {
    let sc = VN_SCENES[id];
    if (!sc) { this.vnEnd(); return false; }
    sc = this._vnApplyGender(sc) || sc;
    const v = this._vn;
    v.id = id; v.li = 0;
    this._vnRenderScene(sc);
    this._vnRenderLine(sc);
    this._vnArmAuto(sc);
    return true;
  },
  // Tap / SPACE / ENTER: finish the typewriter, else next line, else advance
  // the scene (choices pin the player until one is picked).
  vnAdvance() {
    const v = this._vn; if (!v) return;
    const sc = VN_SCENES[v.id]; if (!sc) { this.vnEnd(); return; }
    if (this._vnTypingSkip(sc)) return;
    if (v.li < sc.dialogue.length - 1) { v.li++; this._vnRenderLine(sc); return; }
    if (sc.choices && sc.choices.length) { this._vnShowChoices(sc); return; }
    this._vnNext(sc);
  },
  vnChoose(i) {
    const v = this._vn; if (!v) return;
    const sc = VN_SCENES[v.id];
    const c = sc && sc.choices && sc.choices[i]; if (!c) return;
    if (c.flag) this._vnSave().flags[c.flag] = true;
    if (c.next) this._vnGoto(c.next); else this.vnEnd();
  },
  _vnNext(sc) { if (sc.next) this._vnGoto(sc.next); else this.vnEnd(); },
  vnEnd() {
    const v = this._vn;
    this._vn = null;
    this._vnShow(false);
    if (v && v.onComplete) v.onComplete();
  },

  // ---- DOM below (every entry is HEADLESS-guarded; the engine above is pure) ----
  _vnDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._vnEls) return this._vnEls;
    const panel = document.getElementById("vnPanel"); if (!panel) return null;
    const $ = (id) => document.getElementById(id);
    this._vnEls = { panel, bg: $("vnBg"), bgFade: $("vnBgFade"), char: $("vnChar"),
      box: $("vnBox"), speaker: $("vnSpeaker"), text: $("vnText"),
      choices: $("vnChoices"), hint: $("vnHint"), skip: $("vnSkip") };
    // wire once, lazily — no boot hook needed
    panel.addEventListener("click", (e) => {
      if (e.target.closest("#vnChoices") || e.target.closest("#vnSkip")) return;
      this.vnAdvance();
    });
    this._vnEls.skip.addEventListener("click", () => this.vnEnd());
    document.addEventListener("keydown", (e) => {
      if (!this._vn) return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); this.vnAdvance(); }
    });
    return this._vnEls;
  },
  _vnShow(on) {
    const els = this._vnDOM(); if (!els) return;
    if (!on) {
      clearInterval(this._vnTypeT); clearTimeout(this._vnAutoT); clearTimeout(this._vnBgT);
      this._vnBgCss = null;
    }
    els.panel.classList.toggle("show", !!on);
  },
  _vnRenderScene(sc) {
    const els = this._vnDOM(); if (!els) return;
    // background (crossfade via the second layer)
    const e = this._vnAssetEntry(sc.background);
    const css = e ? 'url("' + e.src + '")' : "none";
    if (css !== this._vnBgCss) {
      this._vnBgCss = css;
      els.bgFade.style.backgroundImage = css;
      els.bgFade.style.backgroundPosition = (e && e.pos) || "center";
      els.bgFade.classList.add("in");
      clearTimeout(this._vnBgT);
      this._vnBgT = setTimeout(() => {
        els.bg.style.backgroundImage = css;
        els.bg.style.backgroundPosition = (e && e.pos) || "center";
        els.bgFade.classList.remove("in");
      }, 520);
    }
    // character card (splash scenes drop the card + the readability dim)
    const p = this._vnPortraitEntry(sc.character);
    els.panel.classList.toggle("splash", !sc.character);
    if (!p) { els.char.style.display = "none"; }
    else {
      els.char.style.display = "block";
      els.char.style.backgroundImage = 'url("' + p.src + '")';
      els.char.style.backgroundPosition = p.pos || "center 18%";
      els.char.style.backgroundSize = p.zoom || "cover";
      els.char.style.borderColor = p.edge || "#2a3a52";
      els.char.style.boxShadow = "0 10px 40px rgba(0,0,0,.65), 0 0 26px " + (p.edge || "#2a3a52") + "55";
      els.char.className = "pos-" + ((sc.character && sc.character.position) || "right");
    }
  },
  _vnRenderLine(sc) {
    const v = this._vn; if (!v) return;
    const els = this._vnDOM(); if (!els) return;
    const ln = sc.dialogue[v.li] || { speaker: null, text: "" };
    els.speaker.textContent = ln.speaker || "";
    els.speaker.style.color = VN_CAST[ln.speaker] || "#8fd0ff";
    els.text.classList.toggle("narr", !ln.speaker);
    els.choices.classList.remove("show");
    els.hint.style.display = "none";
    clearInterval(this._vnTypeT);
    v.typing = true;
    let n = 0;
    const raw = ln.text || "";
    const txt = (typeof this.genderText === "function") ? this.genderText(raw) : raw;
    v._lineTxt = txt;
    els.text.textContent = "";
    this._vnTypeT = setInterval(() => {
      n += 2;
      els.text.textContent = txt.slice(0, n);
      if (n >= txt.length) { clearInterval(this._vnTypeT); this._vnLineDone(sc); }
    }, VN_TYPE_MS);
  },
  _vnLineDone(sc) {
    const v = this._vn; if (!v) return;
    v.typing = false;
    const els = this._vnDOM(); if (!els) return;
    const last = v.li >= sc.dialogue.length - 1;
    if (last && sc.choices && sc.choices.length) this._vnShowChoices(sc);
    else els.hint.style.display = "";
  },
  _vnTypingSkip(sc) {   // a tap while typing completes the line instead of advancing
    const v = this._vn;
    if (!v || !v.typing) return false;
    v.typing = false;
    const els = this._vnDOM();
    if (!els) return false;   // headless: nothing was actually typing
    clearInterval(this._vnTypeT);
    const raw = (sc.dialogue[v.li] || { text: "" }).text || "";
    els.text.textContent = v._lineTxt || ((typeof this.genderText === "function") ? this.genderText(raw) : raw);
    this._vnLineDone(sc);
    return true;
  },
  _vnShowChoices(sc) {
    const els = this._vnDOM(); if (!els) return;
    els.hint.style.display = "none";
    const g = (t) => (typeof this.genderText === "function") ? this.genderText(t) : t;
    els.choices.innerHTML = sc.choices.map((c, i) =>
      '<button class="vnChoice" data-i="' + i + '">' + g(c.label) + "</button>").join("");
    for (const b of els.choices.querySelectorAll("[data-i]"))
      b.addEventListener("click", (e) => { e.stopPropagation(); this.vnChoose(+b.getAttribute("data-i")); });
    els.choices.classList.add("show");
  },
  _vnArmAuto(sc) {   // cinematic panels: advance on a timer as well as on tap
    if (HEADLESS || typeof document === "undefined") return;
    clearTimeout(this._vnAutoT);
    if (!sc.autoAdvance || (sc.choices && sc.choices.length)) return;
    this._vnAutoT = setTimeout(() => {
      if (this._vn && this._vn.id === sc.id) { this._vn.li = sc.dialogue.length - 1; this._vnNext(sc); }
    }, sc.autoAdvance);
  },

  // ---- selfTest: scene-graph integrity + a headless walk of the engine ----
  vnSelfTest() {
    const f = [];
    for (const id in VN_SCENES) {
      const sc = VN_SCENES[id];
      if (sc.id !== id) f.push(id + ": id mismatch");
      if (!Array.isArray(sc.dialogue) || !sc.dialogue.length) f.push(id + ": empty dialogue");
      else for (const ln of sc.dialogue)
        if (!ln || typeof ln.text !== "string" || !ln.text) { f.push(id + ": bad dialogue line"); break; }
      if (sc.next && !VN_SCENES[sc.next]) f.push(id + ": next -> missing scene " + sc.next);
      if (sc.choices) {
        if (!sc.choices.length || sc.choices.length > 4) f.push(id + ": choice count " + sc.choices.length);
        if (sc.autoAdvance) f.push(id + ": autoAdvance on a choice scene");
        for (const c of sc.choices) {
          if (!c.label) f.push(id + ": choice without label");
          if (!c.next || !VN_SCENES[c.next]) f.push(id + ": choice -> missing scene " + c.next);
        }
      }
      if (sc.background && !this._vnAssetEntry(sc.background)) f.push(id + ": unresolvable background " + sc.background);
      if (sc.character && !this._vnPortraitEntry(sc.character)) f.push(id + ": unresolvable portrait " + sc.character.portrait);
    }
    // every act chain: reachable, terminating, and faction-isolated. The
    // isolation walk is what enforces the authoring rule that a player only
    // ever sees their OWN faction's scenes — a krag chain that can reach a
    // vex_* scene is a story leak, not just a graph bug.
    const CHAINS = [["act0", VN_PROLOGUES], ["act1", VN_ACT1],
                    ["act2", VN_ACT2], ["act3", VN_ACT3]];
    for (const [act, roots] of CHAINS) for (const fac of CONFIG.factions) {
      const root = roots[fac];
      if (!root || !VN_SCENES[root]) { f.push(fac + ": no " + act + " root"); continue; }
      const seen = new Set([root]); const q = [root];
      let terminal = false, guard = 0;
      while (q.length && guard++ < 500) {
        const sc = VN_SCENES[q.shift()];
        const outs = (sc.choices && sc.choices.length ? sc.choices.map((c) => c.next) : [sc.next]).filter(Boolean);
        if (!outs.length) terminal = true;
        for (const n of outs) if (VN_SCENES[n] && !seen.has(n)) { seen.add(n); q.push(n); }
      }
      if (!terminal) f.push(fac + " " + act + ": chain never terminates");
      for (const id of seen) {
        if (!id.startsWith(fac + "_")) f.push(fac + " " + act + ": leaks into foreign scene " + id);
        else if (!id.startsWith(fac + "_" + act.replace("act", "a") + "_"))
          f.push(fac + " " + act + ": crosses acts into " + id);
      }
    }
    // headless engine walk: play every chain once per choice column, so both
    // sides of every branch get exercised by the real player state machine
    const prev = this._vn;
    const widest = Math.max(1, ...Object.keys(VN_SCENES).map((id) =>
      (VN_SCENES[id].choices || []).length));
    for (const [act, roots] of CHAINS) for (const fac of CONFIG.factions)
      for (let pick = 0; pick < widest; pick++) {
        let completed = false, hops = 0;
        this.vnStart(roots[fac], () => { completed = true; });
        while (this._vn && hops++ < 400) {
          const sc = VN_SCENES[this._vn.id];
          if (sc.choices && sc.choices.length && this._vn.li >= sc.dialogue.length - 1)
            this.vnChoose(Math.min(pick, sc.choices.length - 1));
          else this.vnAdvance();
        }
        if (!completed) f.push(fac + " " + act + ": headless walk (pick " + pick + ") did not complete");
      }
    this._vn = prev;
    // the opening job: every faction walks out of its prologue with exactly one
    // quest in the log, auto-tracked, and a second grant is a no-op. (The "act 1
    // must not stack on top of it" half is not assertable here — _vnMaybeAct1
    // bails on the HEADLESS guard either way; it is enforced by _vnGrantFirstQuest
    // calling the BASE acceptQuest rather than the wrapper.)
    for (const fac of CONFIG.factions) {
      this.init();
      const s = this.state;
      s.playerFaction = fac;
      const home = this.factionHomeStation(fac);
      if (home) s.homeStationId = home.id;
      this._vnAct0Complete(fac + "_act0");   // the real close callback, not just the grant
      if (!this._vnSave().seen[fac + "_act0"]) f.push(fac + ": act 0 not marked seen on close");
      if (s.quests.length !== 1) f.push(fac + ": opening job did not land in the quest log");
      else if (s.activeQuestId !== s.quests[0].id) f.push(fac + ": opening job must auto-track");
      this._vnAct0Complete(fac + "_act0");
      if (s.quests.length !== 1) f.push(fac + ": opening job granted twice");
    }
    return f;
  },
});

// ---- opening-scene override (the single gameplay hook) ---------------------
// _beginRun (game/title.js) calls showOpeningScene() on a brand-new game after
// the faction pick. Play that faction's Act 0 chain; fall back to the legacy
// 3-second static art if the chain is missing or this save already saw it.
const _vnLegacyOpeningScene = GAME.showOpeningScene;
Object.assign(GAME, {
  showOpeningScene() {
    if (HEADLESS || typeof document === "undefined") return;
    const s = this.state;
    const fac = s.playerFaction;
    const root = VN_PROLOGUES[fac];
    const seenKey = fac + "_act0";
    if (!root || !VN_SCENES[root] || (s.vn && s.vn.seen && s.vn.seen[seenKey])) {
      _vnLegacyOpeningScene.call(this);
      return;
    }
    this.vnStart(root, () => {
      this._vnAct0Complete(seenKey);
      this.saveGame();   // the prologue (and its choice flags) is a one-time event
    });
  },
});

// ---- act 1 trigger (the second and last gameplay hook) --------------------
// Act 1 is the "proving job": it plays once, the first time the player accepts
// ANY quest after having seen their prologue. Deliberately wired here as an
// acceptQuest wrapper rather than as a new quest `kind` — the kind switch
// (questObjectiveDone / questProgressText / _questObjectivePoint in
// game/quests.js) is the extension point for story quests that own an
// OBJECTIVE, which these scenes don't; they're a cutscene on an existing
// quest, so they stay entirely inside this module. seen["<fac>_act1"] rides
// the same s.vn blob save.js already whitelists, so it survives reload.
const _vnBaseAcceptQuest = GAME.acceptQuest;
Object.assign(GAME, {
  acceptQuest(q) {
    const ok = _vnBaseAcceptQuest.call(this, q);
    if (ok) this._vnMaybeAct1();
    return ok;
  },
  // Guard order matters: bail in headless/self-test, don't stack over a
  // playing chain, and require the prologue to have actually been seen so a
  // pre-story save (or a legacy-opening fallback) never opens mid-act.
  _vnMaybeAct1() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const s = this.state, fac = s.playerFaction;
    if (!s.mercenary) return; // Act 1 is post-restart story, not mid-ladder
    const root = VN_ACT1[fac];
    if (!root || !VN_SCENES[root]) return false;
    const vn = this._vnSave();
    if (!vn.seen[fac + "_act0"] || vn.seen[fac + "_act1"]) return false;
    return this.vnStart(root, () => {
      this._vnSave().seen[fac + "_act1"] = true;
      this.saveGame();
      // Companion intro (beat 1) fires immediately after Act 1.
      // Beats 2-4 are gated on Act 2 story quest turn-ins (_vnMaybeCompBeat).
      this._vnMaybeCompIntro();
    });
  },

  // Fire the companion intro scene (beat 1) once, immediately after Act 1
  // concludes. Idempotent: seen[fac + "_comp_intro"] prevents replay.
  // Beats 2/3/4 are no longer chained here — they fire from story quest
  // turn-ins via _vnMaybeCompBeat(n) in game/story_quests.js.
  _vnMaybeCompIntro() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const s = this.state, fac = s.playerFaction;
    const vn = this._vnSave();
    if (!vn.seen[fac + "_act1"]) return false;
    if (vn.seen[fac + "_comp_intro"]) return false;
    const sceneId = fac + "_comp_intro";
    if (!VN_SCENES[sceneId]) return false;
    return this.vnStart(sceneId, () => {
      this._vnSave().seen[fac + "_comp_intro"] = true;
      this.saveGame();
      // Beat 1 done. Beats 2-4 are gated on Act 2 quest turn-ins.
    });
  },

  // Fire companion beat N (2, 3, or 4) once the prerequisite beat is seen.
  // Called from storyQuestTurnedIn (game/story_quests.js).
  // onComplete grants the next story quest:
  //   beat2 close → grant a2q2
  //   beat3 close → grant a2q3
  //   beat4 close → grant a3q1 (first Act 3 quest)
  _vnMaybeCompBeat(n) {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const s = this.state, fac = s.playerFaction;
    const vn = this._vnSave();
    const beatKey = fac + "_comp_beat" + n;
    if (vn.seen[beatKey]) return false;
    const prevKey = n === 2 ? fac + "_comp_intro" : fac + "_comp_beat" + (n - 1);
    if (!vn.seen[prevKey]) return false;
    const sceneId = fac + "_comp_beat" + n;
    if (!VN_SCENES[sceneId]) return false;
    return this.vnStart(sceneId, () => {
      this._vnSave().seen[beatKey] = true;
      this.saveGame();
      if (n === 4) {
        // Beat 4 complete — grant the first Act 3 quest.
        if (this._storyMaybeGrantAct3Q) this._storyMaybeGrantAct3Q(1);
      } else {
        // Beat 2 or 3 complete — grant next Act 2 quest (quest index = beat index).
        if (this._storyMaybeGrantAct2Q) this._storyMaybeGrantAct2Q(n);
      }
    });
  },

  // ---- Act 3 trigger + companion death + ending card ----------------------
  // Single entry point: called from storyQuestTurnedIn (story_quests.js)
  // after a3q2 is turned in, or directly after _vnMaybeAct2 on legacy saves.
  // Guards: Act 2 VN seen, comp beat4 seen, both Act 3 quests done.
  // Legacy migration: saves made before story quests will have seen["_comp_intro"]
  // (old chain ran all beats in one sitting) but not "_comp_beat4" / "_a3q*" —
  // fast-forward those flags so Act 3 can still fire on old save files.
  _vnMaybeAct3() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const s = this.state, fac = s.playerFaction;
    if (!s.mercenary) return false;
    const root = VN_ACT3[fac];
    if (!root || !VN_SCENES[root]) return false;
    const vn = this._vnSave();
    if (!vn.seen[fac + "_act2"]) return false;
    if (vn.seen[fac + "_act3"])  return false;   // already played
    // Legacy migration: old chain marked _comp_intro when beat4 ended.
    if (vn.seen[fac + "_comp_intro"] && !vn.seen[fac + "_comp_beat4"]) {
      vn.seen[fac + "_comp_beat2"] = true;
      vn.seen[fac + "_comp_beat3"] = true;
      vn.seen[fac + "_comp_beat4"] = true;
      vn.seen[fac + "_a2q1"] = true; vn.seen[fac + "_a2q2"] = true; vn.seen[fac + "_a2q3"] = true;
      vn.seen[fac + "_a3q1"] = true; vn.seen[fac + "_a3q2"] = true;
      this.saveGame();
    }
    if (!vn.seen[fac + "_comp_beat4"]) return false;   // companion arc not done
    if (!vn.seen[fac + "_a3q2"])       return false;   // Act 3 quests not done
    return this.vnStart(root, () => {
      this._vnSave().seen[fac + "_act3"] = true;
      this.saveGame();
      // Act 3 climax complete — companion death sequence follows immediately.
      this._vnStartCompDeath();
    });
  },

  // Start the companion death chain ({fac}_comp_death_1 → _2 → _3 → _4 →
  // {fac}_ending). All four scenes are already linked via next: in VN_SCENES;
  // death_4's autoAdvance auto-transitions to the ending card.
  _vnStartCompDeath() {
    if (HEADLESS || typeof document === "undefined") return false;
    const s = this.state, fac = s.playerFaction;
    const deathId = fac + "_comp_death_1";
    if (!VN_SCENES[deathId]) return false;
    return this.vnStart(deathId);
  },
});

// ---- first story quest (granted when the Act 0 prologue closes) ------------
// Every prologue ends with the faction lead offering work, so the player should
// walk out of the overlay with that work already in the log. There is no story
// quest TEMPLATE to add — game/quests.js already generates every shape — so this
// picks the offer off the HOME station's board (the lead's own station, set by
// _beginRun) that matches what was just described, and accepts it through the
// normal mechanism. Preference lists are ordered; a home territory that can't
// support the first choice falls through to the next, then to any offer.
const VN_FIRST_JOB = {
  krag: { actions: ["salvage", "extract", "collect"],
          brief: 'VOSS: "First run on the Combine ledger. Haul it, and the machine keeps you."' },
  vex:  { actions: ["scan", "sensor", "blackbox"],
          brief: 'DREN: "No insignia, no ledger. Go look at what the charts say is not there."' },
  nox:  { actions: ["collect", "salvage", "scan"],
          brief: 'SIVE: "Your first errand. Small on purpose — an investment is not tested by throwing it at a wall."' },
};
Object.assign(GAME, {
  // The Act 0 close callback, named rather than inline so vnSelfTest can run it:
  // showOpeningScene itself bails on the HEADLESS guard, so this is the deepest
  // point of the prologue-completion path a headless test can actually reach.
  _vnAct0Complete(seenKey) {
    this._vnSave().seen[seenKey] = true;
    this._vnGrantFirstQuest();   // the lead just offered work — hand it over
  },
  // Idempotent via seen["<fac>_job1"] (rides the same s.vn blob save.js already
  // whitelists). Deliberately calls the BASE acceptQuest: Act 1 is the cutscene
  // for the first quest the PLAYER chooses, and going through the wrapper would
  // stack a second chain on top of the prologue the instant the overlay closed.
  _vnGrantFirstQuest() {
    const s = this.state, fac = s.playerFaction;
    const spec = VN_FIRST_JOB[fac]; if (!spec) return false;
    const vn = this._vnSave();
    if (vn.seen[fac + "_job1"]) return false;
    const st = this.homeStationObj(); if (!st) return false;
    // Re-roll the board until it offers the job the lead actually described.
    // Boards are a fresh roll every dock anyway, so this costs nothing. Holding
    // out for rank 0 matters: settling for the first match in the preference list
    // hands Sive's "small errand" out as an alien-derelict survey. A home
    // territory that simply cannot support the top choice (no shipwreck → no
    // salvage) exhausts the rolls and takes the best it saw on the last board.
    // `pick` always comes off the CURRENT board, never a stale generation.
    let pick = null;
    for (let tries = 0; tries < 24; tries++) {
      const board = this.generateStationQuests(st, s);
      let best = null, rank = Infinity;
      for (const q of board) {
        if (q.status !== "offer" || q.kind !== "godo") continue;
        const r = spec.actions.indexOf(q.action);
        if (r >= 0 && r < rank) { rank = r; best = q; }
      }
      pick = best || board.find(q => q.status === "offer") || null;
      if (rank === 0) break;
    }
    if (!pick) return false;
    pick.description = spec.brief + " " + pick.description;   // the lead's framing, on the generated job
    if (!_vnBaseAcceptQuest.call(this, pick)) return false;   // auto-tracks: a new game holds no other quest
    vn.seen[fac + "_job1"] = true;
    return true;
  },
});

// ---- act 2 trigger ----------------------------------------------------------
// Fires the first time the player docks at their original faction's home
// station after becoming a mercenary. Wired as an openDock wrapper so the
// station check is exact — the player has to choose to go back.
const _vnBaseOpenDock = GAME.openDock;
Object.assign(GAME, {
  openDock(stationId) {
    const s = this.state;
    const wasDocked = s.docked;
    _vnBaseOpenDock.call(this, stationId);
    if (!wasDocked && stationId === s.homeStationId) {
      this._vnMaybeAct2();
      // Safety net: re-grant any pending story quest on reload.
      if (this._storyMaybePending) this._storyMaybePending();
    }
  },
  _vnMaybeAct2() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const s = this.state, fac = s.playerFaction;
    if (!s.mercenary) return false;
    const root = VN_ACT2[fac];
    if (!root || !VN_SCENES[root]) return false;
    const vn = this._vnSave();
    if (!vn.seen[fac + "_act1"] || vn.seen[fac + "_act2"]) return false;
    return this.vnStart(root, () => {
      this._vnSave().seen[fac + "_act2"] = true;
      this.saveGame();
      // Homecoming complete — grant the first Act 2 mission.
      if (this._storyMaybeGrantAct2Q) this._storyMaybeGrantAct2Q(1);
    });
  },
});
