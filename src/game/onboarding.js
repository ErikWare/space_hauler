/*=== HARNESS:ONBOARDING =====================================================*/
// The Q1-Q10 onboarding ladder — one quest per core mechanic, each opened by a
// one-scene VN briefing from the faction contact, ending in a scripted
// catastrophe and a soft reset. Full design lives in storyline/QUEST_DESIGN.md.
//
// Flow this module owns:
//   new game (_beginRun) → startOnboarding() → Q1 briefing + quest
//   Q1 turned in → onboardQuestTurnedIn → Q2 briefing + quest
//   ...Q2 → Q3 → Q4 → Q5, one rung per turn-in
//   Q6 turned in → THE SEAM → outro scene → showOpeningScene() (Act 0, the
//                  promotion) → _vnGrantFirstQuest() (first story quest)
//                  → Q7 (granted at the seam; its briefing plays after Act 0)
//   Q7 → Q8 → Q9 → Q10, one rung per turn-in
//   Q10 turned in → the trap briefing → ambush → wreck → WREN
//                 → _mercenaryRestart() (holdings wiped, starter hull, s.mercenary)
//
// Two halves, split at ONBOARD_ACT0_AT. Q1-Q6 are DELIVERY rungs, counted by
// the depositTows tap (questTutorDeposit). Q7-Q10 are STATE rungs, polled from
// the world — see the QUEST_TUTOR table in game/quests.js for why polling
// rather than ticking is what makes them work at a dock.
//
// Note there is ONE scene per rung, not a briefing/completion pair: a rung's
// completion beat is the opening line of the NEXT rung's briefing, since both
// fire at the same moment (turn-in). Q6 has no next briefing, so its completion
// beat lives in the outro scene instead.
//
// So Act 0 is no longer the opening beat — it is the promotion scene between
// the two halves, which is why its copy counts "six jobs". Everything below it
// (Act 1's acceptQuest trigger, the first-job grant) is unchanged and still
// keys off seen["<fac>_act0"].
//
// Progress lives in the s.vn.seen blob that save.js already whitelists and
// sanitizes, keyed "onb_<step>" — one less field to thread through the save
// whitelist, and it is genuinely story progress. The quests themselves are
// ordinary held quests (kind "tutor", game/quests.js) and serialize normally.
//
// MUST load after game/visual_novel.js: the briefing scenes are registered into
// that module's VN_SCENES table at file scope.

// Q1-Q6 — order IS the ladder. Q3-Q6 are the graded-ore rungs (copper → silver
// → gold → platinum); there is no `bronze` ore in this engine and heavy bodies
// are not towable, so the four-step escalation rides CONFIG.rings instead. See
// QUEST_DESIGN.md §7.1 for that call.
const ONBOARD_STEPS = ["haul_junk", "haul_rock",
                       "haul_copper", "haul_silver", "haul_gold", "haul_platinum",
                       "refine_drone", "wing_two", "take_outpost", "garrison_outpost"];

// The ladder has a seam, not just an end. Turning in the rung at this index
// (Q6, the last haul job) closes the tutorial half and hands to the ladder
// outro → Act 0 → Q7; the Act 0 prologue is now the PROMOTION scene between the
// two halves, which is why its opening copy counts "six jobs". Everything from
// Q7 on is the operative half and ends in the Q10 catastrophe.
const ONBOARD_ACT0_AT = 5;

// Per-faction onboarding VN. Each quest is a mini chain:
//   splash plate (mission visual) → contact briefing on the dock.
// Hire plays once after the cold open, before Q1: pilot looking for work →
// contact takes them on → first job. Gender tokens {he}/{his}/… expand at
// runtime; hire scenes also carry m/f alt lines where the contact sizes them up.
//
// Mission plates: onboard_* in sprites/intro/ (shared art, faction voice differs).
const ONBOARD_MISSION_BG = {
  haul_junk: "onboard_debris",
  haul_rock: "onboard_ore_ring",
  haul_copper: "onboard_ore_ring",
  haul_silver: "onboard_ore_ring",
  haul_gold: "onboard_ore_rich",
  haul_platinum: "onboard_ore_rich",
  refine_drone: "onboard_refinery",
  wing_two: "onboard_drone_wing",
  take_outpost: "onboard_outpost",
  garrison_outpost: "onboard_garrison",
};

const ONBOARD_VN = {
  krag: { bg: "bg_krag_dock", portrait: "krag_voss", pos: "right", speaker: "VOSS",
    // hire: after cold open, before any quest — introduce pilot + contact
    hire: {
      splash: "onboard_dock_crowd",
      // player alone — looking for work (gender narration)
      arrive: [
        { speaker: null, text: "The cradle is still warm from the pod. {His} boots hit Combine steel with nothing behind them but debt." },
        { speaker: "YOU", text: "I'm looking for work. Anything that pays berth and fuel." },
        { speaker: null, text: "Longshoremen do not look twice. Pilots who walk in without a ship are either desperate or already dead — and dead men do not ask." },
      ],
      // gender-specific sizing-up from Voss (picked at runtime)
      meet_m: [
        { speaker: null, text: "A shadow falls across the ramp. Dockmaster Voss — bone plate, furnace eyes, the patience of a man who has already survived everything once." },
        { speaker: "VOSS", text: "Pod crash. Empty hands. You still walked in under your own power." },
        { speaker: "VOSS", text: "The Combine wastes nothing, hauler. That includes stubborn men who refuse to die on the approach." },
        { speaker: "YOU", text: "Then put me to work." },
      ],
      meet_f: [
        { speaker: null, text: "A shadow falls across the ramp. Dockmaster Voss — bone plate, furnace eyes, the patience of a man who has already survived everything once." },
        { speaker: "VOSS", text: "Pod crash. Empty hands. You still walked in under your own power." },
        { speaker: "VOSS", text: "The Combine wastes nothing, hauler. That includes stubborn women who refuse to die on the approach." },
        { speaker: "YOU", text: "Then put me to work." },
      ],
      offer: [
        { speaker: "VOSS", text: "Berth that does not leak. Fuel at Combine rates. Work that will not care who you were before the pod." },
        { speaker: "VOSS", text: "You are on my ledger now. First job is waiting on the board." },
        { speaker: "VOSS", text: "It is not glamorous. Neither are you. Stay on your feet." },
      ],
    },
    lines: {
      haul_junk: [
        "North approach. Ten pieces of debris. Tractor and tow.",
        "Berths are not free and neither am I. Bring the scrap home.",
        "It is not glamorous. Go.",
      ],
      haul_rock: [
        "Junk pays for fuel. Rock pays for everything else.",
        "Ten ore rocks. Same beam, better cargo. Try not to look pleased about it.",
      ],
      haul_copper: [
        "Copper ore now. Three rocks. It is everywhere, which is rather the point.",
        "If you cannot move copper you cannot move anything. Go.",
      ],
      haul_silver: [
        "Good. Silver next. Worth more, moves the same way.",
        "Three rocks, further out. Scrape my dock again and I bill you for the paint.",
      ],
      haul_gold: [
        "Someone ran a survey on this belt before I filed. Old claim, probably nothing.",
        "Three gold rocks. The rings that carry it also carry people who want it. Do not advertise.",
      ],
      haul_platinum: [
        "Platinum. Top of the common ladder. Three rocks.",
        "Deep enough that I am mildly concerned, which is not a thing I say. Bring them back.",
      ],
      refine_drone: [
        "Ore is not money. Bars are money. Put it through the refinery.",
        "And fit a drone while you are docked. Flying naked out there is a choice, and a stupid one.",
      ],
      wing_two: [
        "That tug only flies one wing drone. Build a second for the hangar.",
        "Garrison, trade, the next hull's bigger deck — reserve is how you stop scraping by.",
      ],
      take_outpost: [
        "Different kind of job. An outpost with somebody else's flag on it.",
        "Clear the garrison and take the platform. You stopped being a pure hauler around the gold — I am only the first to say it.",
      ],
      garrison_outpost: [
        "Now station a drone on it. An outpost you cannot hold is a gift to whoever comes next.",
        "That platform works for you now. That is how this works.",
      ],
    },
    // short mission-splash narration before the contact speaks (visual UX)
    splashLines: {
      haul_junk: ["Debris drifts the north approach like the system never learned to clean up after itself."],
      haul_rock: ["Ore rocks tumble in the inner rings — ugly, heavy, and worth more than pride."],
      haul_copper: ["Copper glints everywhere once you know how to look. That is why it pays so little."],
      haul_silver: ["Silver sits further out. The neighbours get less polite with the distance."],
      haul_gold: ["Gold rings shine like a dare. Someone is always watching the ones that shine."],
      haul_platinum: ["Platinum country. Thin traffic, thick silence, and rocks that can clear a debt."],
      refine_drone: ["The refinery bay never sleeps. Ore goes in guessing. Bars come out decided."],
      wing_two: ["One on the wing. One in the bay. That is a plan."],
      take_outpost: ["Someone else's flag on a platform that should not be theirs."],
      garrison_outpost: ["Taking is loud. Holding is the quiet work that keeps it yours."],
    },
    outro: [
      "You know how to haul now. Time to learn the other half of this job.",
      "Come inside. I am done shouting at you across a dock.",
    ],
    trap: [
      "Last thing today. Milk run — manifest pickup off the old relay line, two jumps out.",
      "No garrison, no politics, nothing that shoots. You have earned a boring afternoon.",
    ] },
  vex: { bg: "bg_vex_hangar", portrait: "vex_dren", pos: "right", speaker: "DREN",
    hire: {
      splash: "act_vex_hangar_crowd",
      arrive: [
        { speaker: null, text: "The hangar accepts the pod with machine politeness. {His} civilian tags still smoke from the trial grid." },
        { speaker: "YOU", text: "Emergency berth. I need work that is not target practice." },
        { speaker: null, text: "Technicians count damage. Nobody counts the pilot until an officer decides {he} is still inventory." },
      ],
      meet_m: [
        { speaker: null, text: "Commodore Dren steps out of a side hatch without saluting anyone — patched jacket, easy crease of a smile that never looks entirely worry-free." },
        { speaker: "DREN", text: "You walked out of a live-fire corridor in a can. That is either skill or an unpaid debt to luck." },
        { speaker: "DREN", text: "The Dominion contains multitudes. Today it contains one more stubborn man who still wants a posting." },
        { speaker: "YOU", text: "Give me the posting." },
      ],
      meet_f: [
        { speaker: null, text: "Commodore Dren steps out of a side hatch without saluting anyone — patched jacket, easy crease of a smile that never looks entirely worry-free." },
        { speaker: "DREN", text: "You walked out of a live-fire corridor in a can. That is either skill or an unpaid debt to luck." },
        { speaker: "DREN", text: "The Dominion contains multitudes. Today it contains one more stubborn woman who still wants a posting." },
        { speaker: "YOU", text: "Give me the posting." },
      ],
      offer: [
        { speaker: "DREN", text: "Civilian berth. Fuel on a work order. You are posted under my directorate until the paperwork finds a better idea." },
        { speaker: "DREN", text: "You were an escort once. Today you are still breathing. That is enough to start." },
        { speaker: "DREN", text: "First assignment is on the board. File every ton." },
      ],
    },
    lines: {
      haul_junk: [
        "Debris retrieval off the approach. Ten pieces, tractored and docked.",
        "You were an escort commander. Now you are a broom. The Dominion contains multitudes.",
        "File the tonnage when you come back.",
      ],
      haul_rock: [
        "Ore rocks now. Ten. Same procedure, better category.",
        "Somebody genuinely reads those filings, which is its own small tragedy.",
      ],
      haul_copper: [
        "Copper ore, three units. Resource class three — the floor.",
        "Every grade above it assumes you can already do this one.",
      ],
      haul_silver: [
        "Silver next. Higher grade, identical procedure. Three units.",
        "There is a recertification review on VD-77 units this quarter. I have filed the objection. It does not concern you.",
      ],
      haul_gold: [
        "Gold. Three units. Contested rings — and a form I refuse to file twice.",
        "Do not advertise what you are hauling.",
      ],
      haul_platinum: [
        "Platinum. Locate it, haul it, do not lose it. Three units.",
        "Rare cargo draws attention from parties who do not file anything at all.",
      ],
      refine_drone: [
        "Refine the ore into bars. Same tonnage, new category entirely.",
        "Fit a drone. Unescorted assets get written off, and I dislike writing things off.",
      ],
      wing_two: [
        "Your tug fields one escort. Build a second and park it in the hangar.",
        "The filings will notice reserve capacity. So will the next platform you hold.",
      ],
      take_outpost: [
        "New classification. An enemy outpost is in the register. Correct the register.",
        "Clear it and hold the platform. You are not a hauler on my books any more.",
      ],
      garrison_outpost: [
        "Station a drone on it. An unheld position is a position you merely visited.",
        "That outpost files under your name now.",
      ],
    },
    splashLines: {
      haul_junk: ["Debris on a Dominion approach is not trash. It is an unfinished filing."],
      haul_rock: ["Ore rocks in the lane. Tonnage waiting for a name."],
      haul_copper: ["Class-three copper. The floor every other grade stands on."],
      haul_silver: ["Silver margin. Stricter filings. Same beam."],
      haul_gold: ["Gold rings on the board. Contested. Logged. Owed."],
      haul_platinum: ["Platinum. Rare enough that silence is part of the procedure."],
      refine_drone: ["Refinery bay. Ballast becomes decision."],
      wing_two: ["One escort. One hangar reserve. Capacity is a filing category."],
      take_outpost: ["A platform flying the wrong flag. The register will not fix itself."],
      garrison_outpost: ["Hold what you took. Visiting is not victory."],
    },
    outro: [
      "You know how to haul. Time to learn the other half of the job.",
      "The paperwork gets more interesting from here. Marginally.",
    ],
    trap: [
      "One more item. Routine collection at a relay picket, filed under maintenance.",
      "Nothing on the threat board. Go, sign for it, come back. I have a tribunal to be late for.",
    ] },
  nox: { bg: "bg_nox_cryo", portrait: "nox_sive", pos: "center", speaker: "SIVE",
    hire: {
      splash: "act_nox_dock_haze",
      arrive: [
        { speaker: null, text: "The mooring air tastes of frost and patience. {He} has nothing left but a request and a pulse." },
        { speaker: "YOU", text: "I need work. And a hull that keeps the vacuum on the correct side." },
        { speaker: null, text: "Nobody rushes {him}. In Covenant space, hurry is a kind of rudeness." },
      ],
      meet_m: [
        { speaker: null, text: "A hooded figure waits in the haze as if {he} were expected. Handler Sive. Glass and galaxy for a face." },
        { speaker: "SIVE", text: "You arrived in a pod. That is inefficient, and yet you arrived." },
        { speaker: "SIVE", text: "The Covenant does not employ. It invests. A man who refuses to write himself off is… interesting data." },
        { speaker: "YOU", text: "Invest, then. Tell me what to haul." },
      ],
      meet_f: [
        { speaker: null, text: "A hooded figure waits in the haze as if {he} were expected. Handler Sive. Glass and galaxy for a face." },
        { speaker: "SIVE", text: "You arrived in a pod. That is inefficient, and yet you arrived." },
        { speaker: "SIVE", text: "The Covenant does not employ. It invests. A woman who refuses to write herself off is… interesting data." },
        { speaker: "YOU", text: "Invest, then. Tell me what to haul." },
      ],
      offer: [
        { speaker: "SIVE", text: "Berth. Fuel. A hull that is not on fire. In exchange: work." },
        { speaker: "SIVE", text: "You are an investment. My investment. I intend to see you appreciate." },
        { speaker: "SIVE", text: "The first task is already waiting. You will find it beneath you. That is part of it." },
      ],
    },
    lines: {
      haul_junk: [
        "Ten pieces of debris. Bring them in.",
        "You will find this beneath you. That is part of it.",
      ],
      haul_rock: [
        "Now ten rocks. They feel identical to the debris. They are not.",
        "The difference is written on a ledger somewhere, and the ledger is what matters.",
      ],
      haul_copper: [
        "Copper. Three. We find it where we expect to find it.",
        "That is what makes it the starter ore, and what makes it worth so little.",
      ],
      haul_silver: [
        "Silver next. Worth more, moves the same way. Three.",
        "You are being measured against yesterday, not against anyone else.",
      ],
      haul_gold: [
        "Gold. Three. You will go further out than is sensible.",
        "Do not advertise what you are carrying.",
      ],
      haul_platinum: [
        "Platinum. Three. Rare enough that others will notice.",
        "I would prefer they noticed later rather than sooner.",
        "LIRA has been assigned to your watch rotation. Routine.",
      ],
      refine_drone: [
        "Ore is potential. Bars are decision. Refine it.",
        "Fit a drone. The Covenant does not send its investments out alone — it looks careless.",
      ],
      wing_two: [
        "Your tug flies one. Build a second for the hangar.",
        "Reserve is how holding becomes possible — and how you stop scraping by.",
      ],
      take_outpost: [
        "This is the first thing I have asked you to take rather than carry.",
        "Clear it, hold it. You have not been a hauler for some time.",
      ],
      garrison_outpost: [
        "Station a drone. Holding is harder than taking, and far less satisfying.",
        "That outpost works for you now.",
      ],
    },
    splashLines: {
      haul_junk: ["Debris. Beneath you. That is the first measurement."],
      haul_rock: ["Rocks that look like junk until a ledger says otherwise."],
      haul_copper: ["Copper where copper is expected. The floor of every later grade."],
      haul_silver: ["Silver. Yesterday's measure. Today's margin."],
      haul_gold: ["Gold further out than is sensible. Attention follows."],
      haul_platinum: ["Platinum. Rarity is just delayed attention."],
      refine_drone: ["The refinery turns maybes into decisions."],
      wing_two: ["One on the wing. One waiting. Care, from a certain angle."],
      take_outpost: ["Taking, not carrying. Notice how little the difference troubles you."],
      garrison_outpost: ["Holding. The unsatisfying half of ownership."],
    },
    outro: [
      "You know how to haul now. Time to learn the other half of this job.",
      "Come and see me. There are things I have not told you yet.",
    ],
    trap: [
      "One more errand before we settle your classification. A quiet pickup at the old relay.",
      "Nothing will happen there. I have modelled it carefully.",
    ] },
};

// Register hire chains + multi-scene quest briefs:
//   <fac>_hire_01/02/03  — dock crowd → contact meet → first offer
//   <fac>_onb_<nn>a      — mission splash plate
//   <fac>_onb_<nn>       — contact briefing (terminal; grants already landed)
// trap / outro unchanged (single dock scene).
(function () {
  for (const fac in ONBOARD_VN) {
    const v = ONBOARD_VN[fac];
    const add = (sc) => { VN_SCENES[sc.id] = sc; };
    const contact = (expr) =>
      ({ portrait: v.portrait, expression: expr || "neutral", position: v.pos });
    const you = (expr) =>
      ({ portrait: "player_hauler", expression: expr || "weary", position: "left" });

    // ---- hire (gender meet line swapped at runtime in startHire) ----
    if (v.hire) {
      add({ id: fac + "_hire_01", background: v.hire.splash || "onboard_dock_crowd",
        character: you("weary"),
        dialogue: v.hire.arrive,
        choices: null, next: fac + "_hire_02", autoAdvance: null });
      // placeholder meet — overwritten per gender when hire starts
      add({ id: fac + "_hire_02", background: v.bg,
        character: contact("neutral"),
        dialogue: v.hire.meet_m || v.hire.meet_f,
        choices: null, next: fac + "_hire_03", autoAdvance: null });
      add({ id: fac + "_hire_03", background: v.bg,
        character: contact("neutral"),
        dialogue: (v.hire.offer || []).map(text =>
          typeof text === "string" ? { speaker: v.speaker, text } : text),
        choices: null, next: null, autoAdvance: null });
    }

    // ---- per-quest: splash → briefing ----
    ONBOARD_STEPS.forEach((key, i) => {
      const n = String(i + 1).padStart(2, "0");
      const briefId = fac + "_onb_" + n;
      const splashId = briefId + "a";
      const mBg = ONBOARD_MISSION_BG[key] || v.bg;
      const sLines = (v.splashLines && v.splashLines[key]) || [];
      add({ id: splashId, background: mBg, character: null,
        dialogue: (sLines.length ? sLines : ["The job is waiting."]).map(text =>
          ({ speaker: null, text })),
        choices: null, next: briefId, autoAdvance: null });
      add({ id: briefId, background: v.bg,
        character: contact("neutral"),
        dialogue: (v.lines[key] || []).map(text => ({ speaker: v.speaker, text })),
        choices: null, next: null, autoAdvance: null });
    });

    // trap + outro (dock, contact voice only)
    add({ id: fac + "_onb_trap", background: v.bg,
      character: contact("neutral"),
      dialogue: (v.trap || []).map(text => ({ speaker: v.speaker, text })),
      choices: null, next: "merc_ambush_01", autoAdvance: null });
    add({ id: fac + "_onb_outro", background: v.bg,
      character: contact("neutral"),
      dialogue: (v.outro || []).map(text => ({ speaker: v.speaker, text })),
      choices: null, next: null, autoAdvance: null });
  }

  // ---- cold open (pre-Q1) — THREE unique paths, one per faction ----
  // Structure is shared (title → system → ship → cockpit → hazard → fail →
  // impact → eject → approach → ramp); art + copy are faction-specific so
  // Krag / Vex / Nox each feel like a different campaign door. Path keys off
  // playerFaction (the board you signed with / home dock), not face species —
  // the chosen pilot portrait still shows on YOU cards.
  // Plates: sprites/intro/  ·  gender tokens via GAME.genderText.
  if (typeof VN_SCENES !== "undefined") {
    const add = (sc) => { VN_SCENES[sc.id] = sc; };
    const you = (expr, pos) =>
      ({ portrait: "player_hauler", expression: expr || "neutral", position: pos || "left" });

    // Per-faction beat tables. ids are cold_<fac>_01 … _10.
    const PATHS = {
      krag: {
        dock: "bg_krag_dock",
        beats: [
          { bg: "intro_starfield", face: null, auto: 4500, lines: [
            { speaker: null, text: "SPACE HAULER" },
            { speaker: null, text: "In the Mara system, nothing moves unless someone tows it." },
          ]},
          { bg: "intro_solar_system", face: null, lines: [
            { speaker: null, text: "Eight worlds. Three flags. One war chewing the belt for two hundred cycles." },
            { speaker: null, text: "You signed with the Krag Combine — the machine that wastes nothing, and is always hungry." },
            { speaker: null, text: "Today that hunger has a berth number. Yours." },
          ]},
          { bg: "intro_krag_ship", face: null, lines: [
            { speaker: null, text: "A Vulture-class tug. Three hundred thousand klicks on the drive. Name painted over twice." },
            { speaker: null, text: "Empty hold. Thin fuel. One last corridor between you and a Combine dock that still takes cash." },
          ]},
          { bg: "intro_krag_cockpit", face: "neutral", lines: [
            { speaker: null, text: "The cockpit smells of ozone and old coffee. Every warning light has been silenced once already." },
            { speaker: "YOU", text: "Just make Homeport. Then we argue about the rest." },
            { speaker: null, text: "The scopes paint a purple wall ahead — a nebula finger nobody charts because the charts that do end mid-sentence." },
          ]},
          { bg: "intro_krag_hazard", face: null, lines: [
            { speaker: null, text: "You cut the edge of the cloud to shave six hours off the run. Combine math: risk is cheaper than fuel." },
            { speaker: null, text: "Beauty first. Then the static. Then the instruments start lying with confidence." },
          ]},
          { bg: "intro_krag_systems", face: "weary", lines: [
            { speaker: null, text: "Life support drops a tone you only hear in training holos." },
            { speaker: "YOU", text: "No. No — stay with me —" },
            { speaker: null, text: "Cabin pressure bleeds. The nav core reboots into pure spite. Somewhere in the cloud, rock is moving." },
          ]},
          { bg: "intro_krag_impact", face: null, auto: 5500, lines: [
            { speaker: null, text: "The rock does not hail. It does not care about Combine manifests." },
            { speaker: null, text: "It hits the port thruster hard enough to teach the hull a new shape." },
            { speaker: null, text: "Alarms. Foam. A sound no ship should make twice." },
          ]},
          { bg: "intro_krag_escape", face: "weary", lines: [
            { speaker: null, text: "The pod jettisons with a kick that empties the lungs." },
            { speaker: "YOU", text: "Beacon on. Nearest Combine dock. Anything with air." },
            { speaker: null, text: "Behind {him}, the tug tumbles into the purple dark, still trying to be a ship." },
            { speaker: null, text: "Ahead: Homeport lights. Or close enough to die trying." },
          ]},
          { bg: "intro_krag_station", face: null, lines: [
            { speaker: null, text: "The docking ring grows from a spark to a door of bone-plate and steel." },
            { speaker: null, text: "No contract. No guild patch. No ship. Just a pilot in a can and a debt that survived the crash." },
          ]},
          // Arrival only — hire VN introduces the contact next.
          { bg: "bg_krag_dock", face: "weary", lines: [
            { speaker: null, text: "The pod hits the cradle hard enough to rattle teeth. Longshoremen count the dents the way bankers count debt." },
            { speaker: "YOU", text: "Still breathing. Still broke. Still here." },
            { speaker: null, text: "No ship. No contract. A spaceport full of work that does not yet know {his} name." },
          ]},
        ],
      },

      vex: {
        dock: "bg_vex_hangar",
        beats: [
          { bg: "intro_starfield", face: null, auto: 4500, lines: [
            { speaker: null, text: "SPACE HAULER" },
            { speaker: null, text: "In the Mara system, nothing moves unless someone tows it." },
          ]},
          { bg: "intro_solar_system", face: null, lines: [
            { speaker: null, text: "Eight worlds. Three flags. One war logged, numbered, and owed." },
            { speaker: null, text: "You signed with the Vex Dominion — sunward order that fortifies first and asks second." },
            { speaker: null, text: "Today that order has a civilian tag on your hull. Temporary. Allegedly." },
          ]},
          { bg: "intro_vex_ship", face: null, lines: [
            { speaker: null, text: "A Vulture-class tug on a sunward lane. Civilian paint over a frame that still remembers formation flying." },
            { speaker: null, text: "Empty hold. Thin fuel. One filed corridor between you and a Dominion hangar that still processes work orders." },
          ]},
          { bg: "intro_vex_cockpit", face: "neutral", lines: [
            { speaker: null, text: "The cockpit is cleaner than the ship deserves. Someone taught you to log every warning before silencing it." },
            { speaker: "YOU", text: "Stay in the lane. Make the hangar. File the rest later." },
            { speaker: null, text: "Scopes paint a picket wall ahead — Dominion hulls, lance arrays warm, a gap just wide enough for a freighter that files correctly." },
          ]},
          { bg: "intro_vex_hazard", face: null, lines: [
            { speaker: null, text: "You transmit the civilian codes on the scheduled frequency." },
            { speaker: null, text: "The picket does not answer. Live-fire trials do not always check the registry twice." },
          ]},
          { bg: "intro_vex_systems", face: "weary", lines: [
            { speaker: null, text: "Proximity alarms stack until the board is one red note." },
            { speaker: "YOU", text: "I am filed. I am filed —" },
            { speaker: null, text: "Something in the trial grid mistakes your tug for a target drone. Doctrine is perfect. The targeting solution is not." },
          ]},
          { bg: "intro_vex_impact", face: null, auto: 5500, lines: [
            { speaker: null, text: "The near-miss is not a miss." },
            { speaker: null, text: "Debris and lance wash strip the port thruster like a lesson in humility." },
            { speaker: null, text: "Alarms. Foam. A scar the Dominion will log — if you live to be a number." },
          ]},
          { bg: "intro_vex_escape", face: "weary", lines: [
            { speaker: null, text: "The pod jettisons clean. Even the ejector still believes in procedure." },
            { speaker: "YOU", text: "Mayday. Civilian. Nearest Dominion hangar. Request emergency berth." },
            { speaker: null, text: "Behind {him}, the tug becomes a training footnote. Ahead: cold blue hangar lights that do not care who you were." },
          ]},
          { bg: "intro_vex_station", face: null, lines: [
            { speaker: null, text: "The hangar mouth opens with machine precision." },
            { speaker: null, text: "No insignia. No ship. No file that still matches a living pilot. Just a can on a cradle and work still needing hands." },
          ]},
          { bg: "bg_vex_hangar", face: "weary", lines: [
            { speaker: null, text: "The cradle locks. Technicians count damage the way tribunals count scars." },
            { speaker: "YOU", text: "Still breathing. Still broke. Still here." },
            { speaker: null, text: "No ship. No posting. A hangar full of work orders that have not found {him} yet." },
          ]},
        ],
      },

      nox: {
        dock: "bg_nox_cryo",
        beats: [
          { bg: "intro_starfield", face: null, auto: 4500, lines: [
            { speaker: null, text: "SPACE HAULER" },
            { speaker: null, text: "In the Mara system, nothing moves unless someone tows it." },
          ]},
          { bg: "intro_solar_system", face: null, lines: [
            { speaker: null, text: "Eight worlds. Three flags. One war older than any honest chart." },
            { speaker: null, text: "You signed with the Nox Covenant — patient, outer-dark, already reading the ending." },
            { speaker: null, text: "Today that patience has an investment. You." },
          ]},
          { bg: "intro_nox_ship", face: null, lines: [
            { speaker: null, text: "A Vulture-class tug on the outer rim. The sun is a rumor. Traffic is a theory." },
            { speaker: null, text: "Empty hold. Thin fuel. One quiet heading toward a Covenant mooring that does not advertise." },
          ]},
          { bg: "intro_nox_cockpit", face: "neutral", lines: [
            { speaker: null, text: "The cockpit frost never quite clears. Instruments glow violet-cyan, as if the ship is thinking in a language you only half speak." },
            { speaker: "YOU", text: "Make the mooring. Keep the signal noise out of the cabin." },
            { speaker: null, text: "Scopes paint a bloom in the dark — rhythmic, mathematical, wrong for any rock." },
          ]},
          { bg: "intro_nox_hazard", face: null, lines: [
            { speaker: null, text: "You alter course a fraction to skirt the bloom. The bloom alters with you." },
            { speaker: null, text: "Not pursuit. Attention. As if something out there is taking notes." },
          ]},
          { bg: "intro_nox_systems", face: "weary", lines: [
            { speaker: null, text: "Life support does not fail loudly. It fails politely, one degree at a time." },
            { speaker: "YOU", text: "I did not ask for a demonstration —" },
            { speaker: null, text: "Frost crawls the glass from the inside. The nav core fills with star-static that is not stars." },
          ]},
          { bg: "intro_nox_impact", face: null, auto: 5500, lines: [
            { speaker: null, text: "There is no flash. No rock. Only a seam opening in the hull as if the dark decided the pressure differential was interesting." },
            { speaker: null, text: "Atmosphere leaves in glittering ice. The ship stops pretending to be sealed." },
            { speaker: null, text: "Silence. Then the ejector, which does not ask permission." },
          ]},
          { bg: "intro_nox_escape", face: "weary", lines: [
            { speaker: null, text: "The pod drifts more than it flies. Covenant beacons do not shout; they wait to be found." },
            { speaker: "YOU", text: "Beacon on. Outer mooring. Anyone still collecting strays." },
            { speaker: null, text: "Behind {him}, the tug becomes a quiet lesson. Ahead: frost-haze windows that have already counted {his} arrival." },
          ]},
          { bg: "intro_nox_station", face: null, lines: [
            { speaker: null, text: "The mooring ring does not hurry. It simply is there when you need it, which is worse." },
            { speaker: null, text: "No contract you remember signing. No ship. Just a pilot in a can and an investment that refuses to write itself off." },
          ]},
          { bg: "bg_nox_cryo", face: "weary", lines: [
            { speaker: null, text: "The cradle accepts the pod without comment. The air tastes of frost and patience." },
            { speaker: "YOU", text: "Still breathing. Still broke. Still here." },
            { speaker: null, text: "No ship. No classification. A mooring that already knows {he} will ask for work." },
          ]},
        ],
      },
    };

    for (const fac of Object.keys(PATHS)) {
      const path = PATHS[fac];
      const beats = path.beats;
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        const id = "cold_" + fac + "_" + String(i + 1).padStart(2, "0");
        const next = i + 1 < beats.length
          ? "cold_" + fac + "_" + String(i + 2).padStart(2, "0")
          : null;
        // Last beat uses the live faction dock plate (may match b.bg already).
        const bg = (i === beats.length - 1) ? (path.dock || b.bg) : b.bg;
        add({
          id, background: bg,
          character: b.face ? you(b.face, "left") : null,
          dialogue: b.lines,
          choices: null, next, autoAdvance: b.auto || null,
        });
      }
    }
  }

  // ---- the catastrophe, shared by all three factions ----------------------
  // Deliberately NOT faction-prefixed: from the moment the trap closes, whose
  // errand it was stops mattering, and the player is going to spend the rest of
  // the game as nobody's asset. These sit outside the act CHAINS vnSelfTest
  // walks (same as the briefings) — they are a one-shot, not an act.
  //
  // The three explosion beats all carry autoAdvance: this stretch is the one
  // place in the game the player is NOT allowed to tap through at their own
  // pace. Timings are long on purpose (QUEST_DESIGN.md §5.3 uses the same
  // ~7s beat for the companion death).
  const splash = (id, bg, dialogue, next, autoAdvance) => {
    VN_SCENES[id] = { id, background: bg, character: null, dialogue,
      choices: null, next: next || null, autoAdvance: autoAdvance || null };
  };

  splash("merc_ambush_01", "explosion_cockpit_impact", [
    { speaker: null, text: "The relay is exactly where the manifest said it would be. So is everything else." },
    { speaker: null, text: "They do not hail. They do not close to board. Nine hulls fan into a firing arc that was drawn before you arrived — and you understand, all at once and far too late, that the pickup was never the job." },
    { speaker: "YOU", text: "...I was the delivery." },
  ], "merc_ambush_02", 7000);

  splash("merc_ambush_02", "explosion_debris_field", [
    { speaker: null, text: "The shields go in four seconds. The armour takes eleven. Something structural lets go behind the cockpit and makes a sound you have never heard a ship make." },
    { speaker: null, text: "You are still hauling the nose around when the drive dies." },
  ], "merc_wreck", 7000);

  // No dialogue is the intent here (QUEST_DESIGN.md §5.3: "do not put words on
  // it"), but vnSelfTest rejects an empty dialogue array — so it carries the
  // shortest line that can stand in for silence, and the autoAdvance does the
  // actual work of holding the player in it.
  splash("merc_wreck", "explosion_silent_wreck", [
    { speaker: null, text: "Then nothing at all. A hull tumbling end over end through its own debris, venting what is left of you into the dark." },
  ], "merc_wake_01", 7000);

  // WREN has no portrait art and there is nothing safe to fall back to — every
  // shipped painting is already a named character, so a fallback would put
  // somebody else's face on her (QUEST_DESIGN.md §5.5). Character-less splash
  // until a real portrait is generated; the engine renders that full-bleed.
  splash("merc_wake_01", "bg_wreckers_anchorage", [
    { speaker: null, text: "You wake on a bunk that smells of coolant and rust, in a station that is not yours, wearing a jacket that is not yours either." },
    { speaker: "WREN", text: "I pulled you out of that debris field. Technically that makes you salvage, and technically that makes you mine." },
    { speaker: "WREN", text: "Fortunately for you, I prefer employees to property." },
  ], "merc_wake_02");

  splash("merc_wake_02", "bg_wreckers_anchorage", [
    { speaker: "WREN", text: "Your ship is gone. Your credits went to the medic and the tow. Your cargo is somebody's countertop by now." },
    { speaker: "WREN", text: "And your faction has not asked after you once. Draw whatever conclusion you like from that — I have drawn mine." },
    { speaker: "YOU", text: "So what do you want?" },
    { speaker: "WREN", text: "Work. Yours. There is a hull in bay four — it is bad, and it is yours. Welcome to the business." },
  ], null);
})();

Object.assign(GAME, {
  // Briefings start on the mission splash (*a), which chains into the contact
  // scene (* without suffix). Terminal node is still the contact brief.
  onboardSceneId(i) {
    const fac = this.state.playerFaction;
    return fac ? fac + "_onb_" + String(i + 1).padStart(2, "0") + "a" : null;
  },
  onboardOutroSceneId() {
    const fac = this.state.playerFaction;
    return fac ? fac + "_onb_outro" : null;
  },
  onboardTrapSceneId() {
    const fac = this.state.playerFaction;
    return fac ? fac + "_onb_trap" : null;
  },
  // Hand over step i (0-based): the quest first, then the briefing. That order
  // is deliberate — the quest must land even when the VN cannot play (headless,
  // no #vnPanel, a chain already on screen), so the briefing is a flourish that
  // can fail without costing the player their objective.
  _onboardGrant(i) {
    const key = ONBOARD_STEPS[i];
    if (!key) return null;
    const vn = this._vnSave();
    if (vn.seen["onb_" + key]) return null;      // already handed out on this save
    const st = this.homeStationObj(); if (!st) return null;
    const q = this.makeTutorQuest(key, st); if (!q) return null;
    if (!this.acceptQuest(q)) return null;
    vn.seen["onb_" + key] = true;
    this._onboardBrief(i);
    return q;
  },
  _onboardBrief(i) {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;                  // never stack over a playing chain
    const id = this.onboardSceneId(i);
    return id && VN_SCENES[id] ? this.vnStart(id) : false;
  },

  // Called by _beginRun (game/title.js) on a brand-new game, in the slot the
  // Act 0 prologue used to occupy. A faction with no ladder falls straight
  // through to the old behaviour rather than starting a run with nothing.
  // Order: hire VN (pilot looking for work → contact) → grant Q1 + first brief.
  startOnboarding() {
    if (!ONBOARD_VN[this.state.playerFaction]) { this.showOpeningScene(); return false; }
    if (this.startHire()) return true;
    return !!this._onboardGrant(0);
  },

  // Hire chain: introduce the pilot at the port and the faction contact before
  // any job is granted. Gender-specific meet lines are swapped onto hire_02.
  startHire() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const fac = this.state.playerFaction;
    if (!fac || !ONBOARD_VN[fac] || !ONBOARD_VN[fac].hire) return false;
    const vn = this._vnSave();
    if (vn.seen && vn.seen.onb_hire) return false;
    const root = fac + "_hire_01";
    if (typeof VN_SCENES === "undefined" || !VN_SCENES[root]) return false;
    // Patch meet scene dialogue for gender before playing.
    const meet = VN_SCENES[fac + "_hire_02"];
    const h = ONBOARD_VN[fac].hire;
    if (meet && h) {
      const g = (typeof this.playerGender === "function" && this.playerGender() === "f") ? "f" : "m";
      const lines = (g === "f" ? h.meet_f : h.meet_m) || h.meet_m || h.meet_f;
      if (lines) meet.dialogue = lines.slice();
    }
    return this.vnStart(root, () => {
      this._vnSave().seen.onb_hire = true;
      this.saveGame();
      this._onboardGrant(0);   // Q1 + splash→brief
    });
  },

  // Cold open — plays once after face pick, before Q1. Shows the pilot's last
  // haul before they walk onto the faction dock. Uses the chosen player
  // portrait. Returns true if the VN started (onComplete → startOnboarding).
  startColdOpen() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const vn = this._vnSave();
    if (vn.seen && vn.seen.cold_open) return false;
    // One unique 10-beat path per faction (cold_krag_01 / cold_vex_01 / cold_nox_01).
    const fac = this.state.playerFaction || "krag";
    const root = "cold_" + fac + "_01";
    if (typeof VN_SCENES === "undefined" || !VN_SCENES[root]) {
      // Fallback if a faction chain is missing — try krag, else skip to Q1.
      if (fac !== "krag" && VN_SCENES.cold_krag_01) {
        return this.vnStart("cold_krag_01", () => {
          this._vnSave().seen.cold_open = true;
          this.saveGame();
          this.startOnboarding();
        });
      }
      return false;
    }
    return this.vnStart(root, () => {
      this._vnSave().seen.cold_open = true;
      this.saveGame();
      this.startOnboarding();
    });
  },

  // Soft hook from turnInQuest (game/quests.js) — fires only for kind "tutor".
  // Two rungs are special: Q6 (the seam) hands to the Act 0 promotion, and Q10
  // (the last) hands to the catastrophe. Everything between is the plain
  // one-rung-per-turn-in ladder.
  onboardQuestTurnedIn(q) {
    const i = ONBOARD_STEPS.indexOf(q.action);
    if (i < 0) return false;
    if (i === ONBOARD_ACT0_AT) { this._onboardAct0Handoff(); this.saveGame(); return true; }
    if (i + 1 < ONBOARD_STEPS.length) return !!this._onboardGrant(i + 1);
    this._vnSave().seen.onb_done = true;
    this._onboardCatastrophe();
    this.saveGame();
    return true;
  },

  // Can the Act 0 prologue actually play right now? Mirrors the guard set inside
  // showOpeningScene (game/visual_novel.js), because the answer decides whether
  // Q7 arrives off the prologue's close callback or has to be handed over here.
  _onboardAct0Playable() {
    if (HEADLESS || typeof document === "undefined") return false;
    if (this._vn) return false;
    const fac = this.state.playerFaction;
    const root = VN_PROLOGUES[fac];
    return !!(root && VN_SCENES[root] && !this._vnSave().seen[fac + "_act0"]);
  },
  // Q6 turned in: ladder outro → Act 0 (the promotion) → Q7. When the prologue
  // can't run — headless, no #vnPanel, or a save that already saw it and falls
  // back to the legacy static opening — Q7 is granted directly, so the ladder
  // can never stall behind a cutscene that was never going to play.
  // Q7 is granted HERE in every branch, before any scene plays — never off the
  // prologue's completion. A player who quits mid-prologue would otherwise come
  // back to a stalled ladder: an empty quest log, Act 0 already marked unseen-
  // but-started, and nothing left to re-trigger the grant. What is deferred to
  // the Act 0 close is only Q7's BRIEFING, which is a flourish (same rule as
  // every other rung) and cannot cost the player their objective.
  _onboardAct0Handoff() {
    this._vnSave().seen.onb_act0_seam = true;
    const next = ONBOARD_ACT0_AT + 1;
    if (this._onboardAct0Playable()) {
      const outro = this.onboardOutroSceneId();
      if (!(outro && VN_SCENES[outro] && this.vnStart(outro, () => this.showOpeningScene())))
        this.showOpeningScene();   // outro missing — go straight to the prologue
      this._onboardGrant(next);    // a chain is up, so this lands the quest silently
      return true;
    }
    this.showOpeningScene();       // no-op headless; legacy static art on a re-seen save
    return !!this._onboardGrant(next);
  },

  // Q10 turned in: the routine job that is not one. Same "the scene is a
  // flourish" rule as everywhere else in this module — if the chain cannot
  // play, the wipe still happens, because the ladder must not end in a state
  // where the player is holding a finished log and nothing follows it.
  _onboardCatastrophe() {
    const trap = this.onboardTrapSceneId();
    if (!HEADLESS && typeof document !== "undefined" && !this._vn
        && trap && VN_SCENES[trap]
        && this.vnStart(trap, () => this._mercenaryRestart())) return true;
    this._mercenaryRestart();
    return false;
  },

  // ---- the mercenary restart ----------------------------------------------
  // Beat 5 of QUEST_DESIGN.md §4: holdings are gone, knowledge is not. The
  // "what survives" list is enumerated explicitly rather than by resetting
  // state wholesale — an over-broad wipe here would silently take the skill
  // tree and the discovered map with it, which the design calls out as reading
  // like cheating.
  // Where the player wakes up: a neutral scrapyard, deliberately not faction
  // space (QUEST_DESIGN.md §4 beat 3). Falls back through the other deep-space
  // station to the current home, so this can never strand the run nowhere.
  _mercenaryHomeStation() {
    const stations = ForgeWorld.getStations();
    const names = CONFIG.deepSpaceStations.map(d => d.name);
    return stations.find(st => st.name === names[0])
        || stations.find(st => names.includes(st.name))
        || this.homeStationObj();
  },

  _mercenaryRestart() {
    const s = this.state;
    if (s.mercenary) return false;              // one catastrophe per save

    // ---- LOST: everything owned as an employee -------------------------
    s.credits = 0;
    s.ore = {}; s.refinedBars = {}; s.inventory = []; s.loot = [];
    // s.drones (dispatched trade convoys) and its loss ledger reset together —
    // that pairing is initDrones' own contract (drones.js:68), and a stale
    // ledger would otherwise outlive every convoy it counted.
    s.playerFleet = []; s.drones = []; s._convoyLosses = {}; s.tows = [];
    // Captured ground goes back to whoever founded it — same revert the
    // reclaim path uses (outposts.js), minus the part where stationed drones
    // escape home, because there is no home left for them to escape to.
    for (const o of s.outposts || []) {
      if (o.owner !== "player") continue;
      o.owner = o.faction; o.droneGuards = []; o.stationedDrones = []; o.modules = [];
      o.underAttack = null; o.capturable = false; o.provoked = false;
      o.guardRecs.forEach(r => { r.alive = true; r.frac = 1; });
      this.recomputeOutpostDefense(o);
      o.shield = o.shieldMax; o.armor = o.armorMax; o.hull = o.hullMax;
      const region = this.regionGet(o.regionId);
      if (region) region.owner = region.faction;
      if (o.streamed) this._streamGuardsOut(o);
    }

    // ---- the hull in bay four: one clean Vulture, nothing fitted --------
    // Rebuilt rather than switched: switchActiveShip refuses undocked and only
    // moves between hulls you already own, and the point here is that you own
    // nothing. Resync order copies switchActiveShip (player.js) exactly.
    const nSlots = this.hullEquipSlots
      ? this.hullEquipSlots(CONFIG.hulls.vulture) : (CONFIG.hulls.vulture.equipSlots || CONFIG.equipSlots);
    ForgeEquipment.initEquipment(nSlots);
    s.ships = [{ id: 1, hullKey: "vulture", name: CONFIG.hulls.vulture.name,
                 slots: new Array(nSlots).fill(null) }];
    s.activeShipId = 1;
    this._nextShipId = 2;
    this.recomputeDerived();
    if (this.enforceEscortCap) this.enforceEscortCap(s);
    s.hp = this.freshHp();
    s.fuel = s.fuelMax;   // Wren fuels it. A broke pilot in a dry hull is a soft-lock, not a story beat.
    s.weaponCd = 0;

    // ---- KEPT: skills, XP, and everything the player learned by hand ----
    // s.xp / s.level / s.skillPoints / s.skills and the discovery sets
    // (s.exploredTiles, per-entity `discovered`) are deliberately untouched —
    // taking those back reads as cheating (QUEST_DESIGN.md §4 beat 2).

    // ---- allegiance ----------------------------------------------------
    // s.playerFaction is NOT cleared: it still selects this save's Act 1-3
    // chains, the faction-tinted station/outpost art (world/rendering.js,
    // outposts.js), and the leaders' later reaction lines. What changes is
    // whether the player is *employed*, which is its own flag.
    s.mercenary = true;

    // ---- the new berth -------------------------------------------------
    const st = this._mercenaryHomeStation();
    if (st) {
      s.homeStationId = st.id;
      st.discovered = true; st.warpActive = true;
      s.x = st.pos.x; s.y = st.pos.y; s.vx = 0; s.vy = 0;
      s.holdT = 0; s.charge = 0; s.thrusting = false;
      if (this._exploreTilesAround) this._exploreTilesAround(s.x, s.y);
    }
    s.docked = false; s.dockStationId = null;

    toast("✖ SHIP LOST — you fly for yourself now", "#9fd36a");
    this.saveGame();
    return true;
  },

  // Affiliation tag under the hull badge (ships.js drawShipBadge, 8k/68k).
  // The only always-on signal that the employee half of the game is over.
  drawMercBadge(g) {
    if (HEADLESS || !this.state.mercenary) return;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    g.font = `bold ${Math.max(8, 9 * k) | 0}px monospace`;
    g.textAlign = "left";
    g.fillStyle = "#9fd36a";
    g.fillText("◆ MERCENARY — NO AFFILIATION", 8 * k, 80 * k);
  },

  // ---- selfTest (build.py --check wires this in) --------------------------
  onboardingSelfTest() {
    const f = [];
    const check = (c, m) => { if (!c) f.push("FAIL: " + m); };
    // A bay drone, minted straight into the hangar rather than through
    // buildDrone: buildDrone charges credits AND refined bars, and Q7 is
    // precisely the rung that cares how many bars are on hand. The role
    // TRANSITION is still driven through the real setDroneRole below — that is
    // the part worth testing; the object shape here is just fleet.js's fields.
    const mkDrone = (s, id) => ({
      id, tier: 0, role: "hangar",
      hp: 100, maxHp: 100, shield: 50, maxShield: 50, fuel: 100, maxFuel: 100,
      loadout: [], formationIdx: null, offsetX: 0, offsetY: 0,
      state: "follow", targetAlienId: null, wcd: 0, vx: 0, vy: 0, x: s.x, y: s.y,
    });
    try {
      for (const fac of CONFIG.factions) {
        this.init();
        const s = this.state;

        // every step has a briefing scene, and it terminates
        for (let i = 0; i < ONBOARD_STEPS.length; i++) {
          const sc = VN_SCENES[fac + "_onb_" + String(i + 1).padStart(2, "0")];
          check(!!sc, fac + " step " + i + ": no briefing scene");
          if (sc) {
            check(sc.dialogue.length > 0 && sc.dialogue.length <= 3,
              fac + " step " + i + ": briefing should be 1-3 lines, got " + sc.dialogue.length);
            check(!sc.next && !sc.choices, fac + " step " + i + ": briefing must terminate");
          }
        }
        // ...and the ladder outro, which carries the last rung's completion beat
        const outro = VN_SCENES[fac + "_onb_outro"];
        check(!!outro, fac + ": no ladder outro scene");
        if (outro) {
          check(outro.dialogue.length > 0 && outro.dialogue.length <= 3,
            fac + " outro: should be 1-3 lines, got " + outro.dialogue.length);
          check(!outro.next && !outro.choices, fac + " outro: must terminate (Act 0 runs off the callback)");
        }
        // ...and the catastrophe chain, which unlike everything else in this
        // module is a MULTI-scene walk: the faction's trap briefing has to reach
        // the shared merc_* beats and terminate, or the wipe callback never
        // fires and the player is left holding a dead overlay.
        const trap = VN_SCENES[fac + "_onb_trap"];
        check(!!trap, fac + ": no ambush trap scene");
        if (trap) {
          check(trap.next === "merc_ambush_01", fac + " trap: must hand off to the shared ambush");
          const walk = new Set([trap.id]);
          let cur = trap, guard = 0, ends = false;
          while (cur && guard++ < 20) {
            if (!cur.next) { ends = true; break; }
            cur = VN_SCENES[cur.next];
            if (cur) walk.add(cur.id);
          }
          check(ends, fac + " trap: ambush chain never terminates");
          check(walk.has("merc_wreck"), fac + " trap: chain must pass through the silent wreck");
          check(walk.has("merc_wake_02"), fac + " trap: chain must reach WREN");
          for (const id of ["merc_ambush_01", "merc_ambush_02", "merc_wreck"])
            check(VN_SCENES[id] && VN_SCENES[id].autoAdvance > 0,
              id + ": the explosion beats must autoAdvance (no tapping past the wipe)");
        }

        // Drive the REAL new-game entry point (game/title.js), not startOnboarding
        // directly — otherwise this suite would still pass if _beginRun stopped
        // calling it. saveGame() no-ops under HEADLESS, so no slot is touched.
        this._beginRun(fac, 1);
        const home = this.homeStationObj();
        check(!!home, fac + ": no home station");
        if (!home) continue;
        check(s.playerFaction === fac, fac + ": _beginRun did not set the faction");
        check(s.quests.length === 1, fac + ": a new game must grant Q1");
        const q1 = s.quests[0];
        check(q1 && q1.kind === "tutor" && q1.action === "haul_junk", fac + ": Q1 wrong shape");
        check(s.activeQuestId === q1.id, fac + ": Q1 must auto-track");
        this.updateQuests(1 / 60);
        const hp = this._questObjectivePoint(q1);
        check(!!hp && hp.x === home.pos.x && hp.y === home.pos.y, fac + ": Q1 waypoint must aim at the issuing dock");
        check(!this.startOnboarding(), fac + ": Q1 granted twice");
        check(s.quests.length === 1, fac + ": re-running onboarding must not stack a second Q1");

        // the deposit tap drives the counter — and counts BODIES, not ore yield
        this.questTutorDeposit({ junk: 4, rocks: 9, types: { copper: 9 } });
        check(q1.have === 4, fac + ": junk deposit should advance Q1 by 4, got " + q1.have);
        check(!this.questObjectiveDone(q1), fac + ": Q1 done too early");
        this.questTutorDeposit({ junk: 99, rocks: 0, types: {} });
        check(q1.have === q1.need, fac + ": Q1 counter must clamp to need, got " + q1.have);
        check(this.questObjectiveDone(q1), fac + ": Q1 should be done at need");
        this.updateQuests(1 / 60);
        check(q1.status === "ready", fac + ": finished Q1 must read ready");

        // counter survives the save whitelist
        const blob = this._serializeQuest(q1);
        check(blob.need === q1.need && blob.have === q1.have, fac + ": tutor counter must serialize");
        check(blob.kind === "tutor" && blob.action === "haul_junk", fac + ": tutor kind must serialize");

        // turn in Q1 → Q2 arrives automatically
        s.docked = true; s.dockStationId = home.id;
        check(this.turnInQuest(q1), fac + ": Q1 turn-in failed");
        check(s.quests.length === 1, fac + ": Q2 should replace Q1 in the log");
        const q2 = s.quests[0];
        check(q2 && q2.action === "haul_rock", fac + ": Q2 not granted on Q1 turn-in");
        check(s.activeQuestId === q2.id, fac + ": Q2 must auto-track once Q1 is gone");

        // junk must NOT advance the rock quest
        this.questTutorDeposit({ junk: 50, rocks: 0, types: {} });
        check(q2.have === 0, fac + ": junk must not advance the ore quest");

        // ...and Q2 completes through the REAL delivery path: build an actual
        // tow chain and run economy.js depositTows. Calling questTutorDeposit
        // directly (as above) would still pass if the economy.js tap were
        // missing entirely, so this is the check that proves the wiring.
        check(s.rocks.length >= q2.need, fac + ": not enough rocks seeded to test the deposit path");
        s.tows = [];
        for (let i = 0; i < q2.need && i < s.rocks.length; i++) s.tows.push({ arr: "rocks", i, dangerLevel: 1 });
        this.depositTows();
        check(s.tows.length === 0, fac + ": depositTows must drain the tow chain");
        check(q2.have === q2.need, fac + ": depositTows must advance the ore quest, got " + q2.have);
        check(this.questObjectiveDone(q2), fac + ": Q2 should be done after enough rocks");

        // Q3-Q6: each turn-in grants the next graded rung, and each rung counts
        // ONLY its own ore type. Driven through the real depositTows path with
        // retyped rocks, which is what proves the hauled.types plumbing reaches
        // the per-type counters — questTutorDeposit alone would not.
        check(s.rocks.length >= 3, fac + ": not enough rocks seeded for the graded rungs");
        let prev = q2;
        for (let i = 2; i <= ONBOARD_ACT0_AT; i++) {
          const key = ONBOARD_STEPS[i], ore = key.slice("haul_".length);
          check(this.turnInQuest(prev), fac + " " + key + ": previous turn-in failed");
          check(s.quests.length === 1, fac + " " + key + ": rung should replace the last in the log");
          const q = s.quests[0];
          check(q && q.action === key, fac + ": expected " + key + ", got " + (q && q.action));
          if (!q) break;
          check(s.activeQuestId === q.id, fac + " " + key + ": rung must auto-track");
          check(CONFIG.rings.some(g => g.type === ore), fac + ": " + ore + " is not a real ore type");

          // a DIFFERENT tier must not advance this rung — the whole point of Q3-Q6
          const other = ore === "copper" ? "gold" : "copper";
          this.questTutorDeposit({ junk: 9, rocks: 9, types: { [other]: 9 } });
          check(q.have === 0, fac + " " + key + ": " + other + " must not advance the " + ore + " rung");

          // ...then the real thing. Retyping the slot is safe: depositTows reads
          // .type before depositRespawnRock tombstones it (world/ores.js).
          s.tows = [];
          for (let k = 0; k < q.need && k < s.rocks.length; k++) {
            s.rocks[k].type = ore;
            s.tows.push({ arr: "rocks", i: k, dangerLevel: 1 });
          }
          this.depositTows();
          check(q.have === q.need, fac + " " + key + ": depositTows must advance the rung, got " + q.have);
          check(this.questObjectiveDone(q), fac + " " + key + ": rung should be done at need");
          const b = this._serializeQuest(q);
          check(b.action === key && b.have === q.have, fac + " " + key + ": rung must serialize");
          prev = q;
        }

        // ---- the seam: Q6 turn-in → (outro → Act 0) → Q7 -------------------
        // Headless the prologue cannot play, so _onboardAct0Handoff takes its
        // direct branch and hands Q7 over itself. That is not a test-only path:
        // it is exactly what a save that already saw Act 0 does, and it is the
        // branch that guarantees the ladder never stalls behind a cutscene.
        check(this.turnInQuest(prev), fac + ": Q6 turn-in failed");
        check(!!this._vnSave().seen.onb_act0_seam, fac + ": the Act 0 seam was not recorded");
        check(s.quests.length === 1, fac + ": Q7 must be granted at the seam");
        const q7 = s.quests[0];
        check(q7 && q7.action === "refine_drone", fac + ": expected refine_drone, got " + (q7 && q7.action));
        if (!q7) continue;
        check(s.activeQuestId === q7.id, fac + ": Q7 must auto-track");

        // ---- Q7: refinery + first escort ----------------------------------
        // State rungs are polled, not counted, so prove the counter CANNOT be
        // moved by the delivery tap that drives Q1-Q6.
        this.questTutorDeposit({ junk: 99, rocks: 99, types: { copper: 99, platinum: 99 } });
        check(!this.questObjectiveDone(q7), fac + ": hauling must not advance a state rung");
        s.ore.copper = { count: DRONES.orePerBar * 2, bonus: false };
        this.refineAllOre();
        check(this._tutorBarsHeld(s) > 0, fac + ": refineAllOre produced no bars");
        check(!!this._vnSave().seen.onb_refined, fac + ": the refinery latch did not set");
        check(!this.questObjectiveDone(q7), fac + ": Q7 must still want the drone half");
        // the real docked-only escort transition (fleet.js setDroneRole)
        s.playerFleet.push(mkDrone(s, 1));
        check(this.setDroneRole(0, "escort").ok, fac + ": setDroneRole(escort) failed");
        check(this.escorts(s).length === 1, fac + ": drone did not enter the escort wing");
        check(this.questObjectiveDone(q7), fac + ": Q7 should be done with the latch + 1 escort");
        // and the latch is what holds it: spending every bar (which is exactly
        // what building a drone does) must NOT un-complete the rung
        s.refinedBars = {};
        check(this.questObjectiveDone(q7), fac + ": spending the bars must not un-complete Q7");
        const b7 = this._serializeQuest(q7);
        check(b7.action === "refine_drone" && b7.have === q7.have, fac + ": Q7 must serialize");

        // ---- Q8: hangar reserve (own 2; starter only escorts 1) ------------
        check(this.turnInQuest(q7), fac + ": Q7 turn-in failed");
        const q8 = s.quests[0];
        check(q8 && q8.action === "wing_two", fac + ": expected wing_two, got " + (q8 && q8.action));
        if (!q8) continue;
        check(!this.questObjectiveDone(q8), fac + ": Q8 must not be done with only one owned drone");
        check(q8.have === 1, fac + ": Q8 should read 1/2 with one owned, got " + q8.have);
        s.playerFleet.push(mkDrone(s, 2));   // second stays hangar — starter wing is 1
        check(this.escortCap() === 1, fac + ": starter escortCap must still be 1");
        check(this.escorts(s).length === 1, fac + ": only one escort on starter after second build");
        check(this.questObjectiveDone(q8), fac + ": Q8 should be done at two owned drones");

        // ---- Q9: take an outpost ------------------------------------------
        check(this.turnInQuest(q8), fac + ": Q8 turn-in failed");
        const q9 = s.quests[0];
        check(q9 && q9.action === "take_outpost", fac + ": expected take_outpost, got " + (q9 && q9.action));
        if (!q9) continue;
        check(!this.questObjectiveDone(q9), fac + ": Q9 must not start complete");
        // Q9 measures a DELTA off the lifetime counter, so a save that already
        // captured something must still be asked to capture one now.
        const q9Base = q9.base;
        s.capturedOutpostCount = (s.capturedOutpostCount || 0) + 0;
        check(q9Base === (s.capturedOutpostCount || 0), fac + ": Q9 baseline not snapshotted at grant");
        const oPost = s.outposts.find(o => CONFIG.factions.includes(o.owner));
        check(!!oPost, fac + ": no enemy outpost in the world to take");
        if (!oPost) continue;
        this.captureOutpost(oPost);
        check(oPost.owner === "player", fac + ": captureOutpost did not flip the owner");
        check(this.questObjectiveDone(q9), fac + ": Q9 should be done after a capture");
        const b9 = this._serializeQuest(q9);
        check(b9.base === q9Base, fac + ": Q9 baseline must serialize");

        // ---- Q10: garrison it ---------------------------------------------
        check(this.turnInQuest(q9), fac + ": Q9 turn-in failed");
        const q10 = s.quests[0];
        check(q10 && q10.action === "garrison_outpost", fac + ": expected garrison_outpost, got " + (q10 && q10.action));
        if (!q10) continue;
        check(!this.questObjectiveDone(q10), fac + ": Q10 must not start complete");
        check(this.assignDroneToOutpost(oPost, 0).ok, fac + ": assignDroneToOutpost failed");
        check(oPost.stationedDrones.length === 1, fac + ": drone did not reach the platform");
        check(this.questObjectiveDone(q10), fac + ": Q10 should be done with a stationed drone");

        // ---- the catastrophe ----------------------------------------------
        // Headless the trap chain cannot play, so _onboardCatastrophe applies
        // the wipe directly — the branch that guarantees the ladder never ends
        // with the player holding a finished log and nothing happening.
        // Stake something first, so the wipe has something to take and the
        // "survives" half is a real assertion rather than a tautology.
        s.credits = 9999; s.inventory.push({ id: "wipe-probe" });
        // Small xp probe on purpose: s.xp is progress WITHIN the level, not a
        // lifetime total, so a large value just cascades level-ups. Level is
        // the durable signal that the tree was not reset.
        s.xp = 10; s.level = 7; s.skillPoints = 3; s.skills = { hauling: 2 };
        s.exploredTiles.add("merc-probe-tile");
        s.maxDangerReached = 5;
        check(this.turnInQuest(q10), fac + ": Q10 turn-in failed");
        check(!!this._vnSave().seen.onb_done, fac + ": ladder completion not recorded");
        check(s.quests.length === 0, fac + ": ladder should end with an empty log");

        // ---- the wipe TAKES the holdings ----------------------------------
        check(s.mercenary === true, fac + ": the restart must flag the player mercenary");
        check(s.credits === 0, fac + ": credits must be wiped, got " + s.credits);
        check(s.inventory.length === 0, fac + ": cargo must be wiped");
        check(this._tutorBarsHeld(s) === 0, fac + ": refined bars must be wiped");
        check(s.playerFleet.length === 0, fac + ": the drone fleet must be lost");
        check(!(s.outposts || []).some(o => o.owner === "player"), fac + ": captured outposts must revert");
        check(oPost.stationedDrones.length === 0, fac + ": the garrison must go with the outpost");
        // ...and hands back the starter hull, flyable
        check(s.ships.length === 1 && s.ships[0].hullKey === "vulture", fac + ": restart must hand over one Vulture");
        check(s.activeShipId === s.ships[0].id, fac + ": the replacement hull must be active");
        check(ForgeEquipment.getEquipped().slots.every(x => x === null), fac + ": the replacement hull must fly empty");
        check(s.hp.hull === s.hp.hullMax, fac + ": the replacement hull must be whole");
        check(s.fuel > 0, fac + ": a broke pilot in a dry hull is a soft-lock");
        check(s.derived.hullMax === CONFIG.hulls.vulture.baseShip.hullMax,
          fac + ": derived stats must follow the vulture, got " + s.derived.hullMax);

        // ---- ...and SPARES what the player earned by hand ------------------
        // Compared with >=, not ==: the Q10 turn-in that TRIGGERS the wipe pays
        // its own reward XP first, so these legitimately move up on the way in.
        // What is being asserted is that nothing RESET them.
        check(s.level >= 7, fac + ": level must survive the wipe, got " + s.level);
        check(s.skillPoints >= 3 && s.skills.hauling === 2, fac + ": the skill tree must survive the wipe");
        check(s.exploredTiles.has("merc-probe-tile"), fac + ": map discovery must survive the wipe");
        check(s.playerFaction === fac, fac + ": playerFaction still drives the story chains and must survive");

        // idempotent: a second catastrophe cannot re-wipe a mercenary
        s.credits = 500;
        check(this._mercenaryRestart() === false, fac + ": the catastrophe must fire once per save");
        check(s.credits === 500, fac + ": a second restart must not touch state");
        s.docked = false;

        // ...and the flag has to clear the save whitelist, or the HUD tells the
        // truth exactly until the first reload. (Safe to end the iteration on a
        // restore: the next one opens with this.init().)
        const mBlob = this.serializeGame();
        check(!!mBlob && mBlob.mercenary === true, fac + ": mercenary must serialize");
        check(this.applySaveData(mBlob), fac + ": mercenary save blob must re-apply");
        check(this.state.mercenary === true, fac + ": mercenary must survive the round trip");
      }
      this.init();   // leave a clean world behind
    } catch (e) {
      f.push("FAIL: onboardingSelfTest threw: " + (e && e.message));
    }
    return f;
  },
});

// ---- Act 0 close → Q7 ------------------------------------------------------
// The prologue is now the promotion scene at the ladder's midpoint, so the
// operative half opens the moment it closes. Wrapping the named close callback
// (rather than passing another onComplete) piggybacks on the one hook that
// every path into Act 0 goes through — showOpeningScene's terminal callback and
// vnSelfTest's direct call alike. _onboardGrant is idempotent, so the direct
// hand-over in _onboardAct0Handoff and this wrapper cannot double-grant.
const _onbBaseAct0Complete = GAME._vnAct0Complete;
Object.assign(GAME, {
  _vnAct0Complete(seenKey) {
    _onbBaseAct0Complete.call(this, seenKey);
    if (!this._vnSave().seen.onb_act0_seam) return;
    // Normally the quest already landed at the seam and this just plays the
    // briefing that the outro/prologue was covering. _onboardGrant returning a
    // quest means it had NOT landed (a save that reached Act 0 by another
    // route), and it briefs on its own.
    if (!this._onboardGrant(ONBOARD_ACT0_AT + 1)) this._onboardBrief(ONBOARD_ACT0_AT + 1);
  },
});

// ---- refinery latch (Q7) ---------------------------------------------------
// Q7 asks for two things that fight each other: refine ore into bars, and build
// a drone — which spends bars. So "did you refine" is recorded as an EVENT here
// rather than inferred from holdings, and it rides s.vn.seen, which save.js
// already whitelists (same trick the ladder's own progress uses). Loads after
// game/drones.js (build.py), so the base method exists to wrap.
const _onbBaseRefineAllOre = GAME.refineAllOre;
Object.assign(GAME, {
  refineAllOre() {
    const before = this._tutorBarsHeld(this.state);
    const out = _onbBaseRefineAllOre.apply(this, arguments);
    if (this._tutorBarsHeld(this.state) > before) this._vnSave().seen.onb_refined = true;
    return out;
  },
});
