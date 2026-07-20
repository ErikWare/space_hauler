/*=== HARNESS:UNIVERSE_HISTORY ===============================================*/
// Canonical timeline of major belt events. Referenced by factions.js,
// named_ships.js, and site_lore.js. NPCs may cite specific events by year.
// Year 0 = ratification of the Cartography Accord (the practical "year one"
// of organised belt operations). Pre-Accord history is disputed and largely
// Nox-sourced.
//
// Shape: UNIVERSE_HISTORY.events — array of { year, name, summary, factions[]?,
//   sealed?, notes? }. Factions listed are directly implicated, not merely
//   aware. "sealed" marks events whose official record is classified by at
//   least one faction. "notes" holds the freelancer / independent interpretation
//   that the fixers and salvagers use.

const UNIVERSE_HISTORY = {

  // The agreed-upon start of organised belt operations.
  founding_year: 0,
  present_year: 21,

  events: [

    {
      year: -12,
      name: "Pre-Accord Survey Era",
      summary:
        "Before any formal agreement, all three organisations ran independent " +
        "survey fleets with overlapping claims and no arbitration body. The Nox " +
        "Covenant had the deepest reach; Krag had the most filed claims; Vex had " +
        "the best data on both. The surveys ran for at least a decade before anyone " +
        "agreed to talk.",
      factions: ["nox", "krag", "vex"],
      sealed: false,
      notes:
        "The Covenant's pre-Accord records go back further than anyone else " +
        "admits. Survey 7 is the oldest logged vessel on record — nobody knows " +
        "what it found or where the logs are now.",
    },

    {
      year: 0,
      name: "The Cartography Accord",
      summary:
        "Three factions formalise the belt survey. Krag takes the inner belt — " +
        "denser ore, shorter runs, higher friction with competitors. Vex takes " +
        "data rights on all new finds regardless of who files the claim. Nox takes " +
        "the outer reaches: lower ore density, lower competition, and a scope that " +
        "nobody fully understood at signing. Nobody is happy with the arrangement. " +
        "Everyone signs.",
      factions: ["krag", "vex", "nox"],
      sealed: false,
      notes:
        "The data-rights clause was the one Vex held out for. Krag called it " +
        "symbolic. Six months later, Vex had sold Krag's own survey results back " +
        "to them at a markup. Belt workers learned fast what 'data rights' means.",
    },

    {
      year: 2,
      name: "First Inner Belt Dispute",
      summary:
        "Four separate Krag survey teams filed overlapping claims on the same " +
        "platinum-rich cluster within the same sixty-day window. The Accord's " +
        "arbitration clause had never been invoked. Vex arbitrated — for a fee. " +
        "The fee was a permanent seat on the Accord review board.",
      factions: ["krag", "vex"],
      sealed: false,
      notes:
        "The arbitration board has never ruled against Vex. Belt workers call it " +
        "the 'courtesy seat.' Vex calls it 'dispute resolution infrastructure.'",
    },

    {
      year: 4,
      name: "The Meridian Incident",
      summary:
        "A Krag survey vessel, the Ardent Claim, filed a platinum strike on a " +
        "rock the Vex had already flagged as a relay anchor site. Both factions " +
        "arrived with full crews within forty-eight hours. No shots were fired. " +
        "Three workers died in a pressurisation accident when an airlock failed " +
        "during the standoff. The official file was sealed within a week. Both " +
        "factions blame the other for the sabotaged airlock; neither has produced " +
        "technical evidence either way.",
      factions: ["krag", "vex"],
      sealed: true,
      notes:
        "The Ardent Claim was stripped for parts at Homeport Mira two years later. " +
        "The Deep Meridian — the Ardent Claim's sister ship — was pulled from the " +
        "scene before the investigation and never formally deposed. Three people " +
        "died and nobody was held responsible. Salvagers remember this.",
    },

    {
      year: 6,
      name: "Homeport Mira Expansion",
      summary:
        "Krag Combine constructs a secondary docking facility at the inner-belt " +
        "waypoint station designated Mira. The expansion is financed in part by " +
        "selling scrap from decommissioned survey vessels — including the Ardent " +
        "Claim. The facility becomes the primary Krag resupply hub for inner-belt " +
        "operations.",
      factions: ["krag"],
      sealed: false,
      notes:
        "Whoever bought the Ardent Claim's frame never got a clean manifest. " +
        "There are stories about what was left aboard.",
    },

    {
      year: 7,
      name: "The Nox Expansion",
      summary:
        "Without notice or negotiation, the Covenant pushed a survey fleet " +
        "approximately forty thousand kilometres past the agreed outer boundary. " +
        "When Accord partners demanded an explanation, the Covenant stated only " +
        "that 'anomalous readings warranted verification.' They never said what " +
        "they found. The outer observatories have been Nox-controlled since. The " +
        "Accord's outer boundary clause has not been formally enforced.",
      factions: ["nox"],
      sealed: true,
      notes:
        "The Covenant vessel Covenant's Reach led the expansion fleet and returned " +
        "intact. It's now a museum piece at the outer observatory — closed to " +
        "outsiders. The Pale Reckoning, one of its escort ships, never came back.",
    },

    {
      year: 9,
      name: "First Vex Security Mandate",
      summary:
        "Following three convoy raids in the same transit corridor, Vex " +
        "Corporation formally separates its Analytics and Security divisions and " +
        "begins offering armed convoy escort as a standalone service. The first " +
        "contracts are with Krag shipping operators. Within two years, Vex " +
        "Security is the dominant private escort force in the inner belt.",
      factions: ["vex"],
      sealed: false,
      notes:
        "The three convoys that were raided are the ones nobody looked too hard " +
        "at. Vex Security needed a mandate. Belt workers note the timing.",
    },

    {
      year: 11,
      name: "The Picket Incident",
      summary:
        "A border patrol firefight between Krag militia and a Vex Security " +
        "contractor convoy at a contested corridor waypoint. Six ships destroyed — " +
        "three from each faction. No declaration of engagement, no formal ceasefire. " +
        "The wreckage corridor is still a navigation hazard designated the Picket " +
        "Field. Both factions list the incident as 'disputed.' The Vex mobile data " +
        "station Hendricks Array was destroyed in the exchange and drifted into " +
        "a stable debris orbit. Its drives may still be recoverable.",
      factions: ["krag", "vex"],
      sealed: false,
      notes:
        "Nobody was court-martialled. Nobody was fired. Six ships and their crews " +
        "vanished into a 'disputed incident.' The freelancers who work Picket Field " +
        "have a different name for it: the Unsettled Account.",
    },

    {
      year: 13,
      name: "The Cold Meridian Surveys",
      summary:
        "A series of independent survey runs in the contested outer-inner boundary " +
        "zone, carried out by the vessel Cold Meridian under an open filing. The " +
        "surveys produced anomalous readings at three separate sites. All three " +
        "filings were purchased by Vex Analytics within six months of submission.",
      factions: ["vex"],
      sealed: false,
      notes:
        "The Cold Meridian's captain has been quoted saying she sold the data " +
        "because 'the alternative was being bought.' Nobody pressed her on what " +
        "the alternative was.",
    },

    {
      year: 14,
      name: "The Quorum Decommission",
      summary:
        "QUORUM-14, a joint data relay operated by Vex under a Krag lease, went " +
        "dark without warning or explanation. Vex claims hardware failure. Krag " +
        "claims the data was deliberately pulled before shutdown — that the archive " +
        "drives were wiped rather than simply lost. The relay structure is intact " +
        "and nobody has officially entered it since the decommission. The Vex " +
        "maintenance tender assigned to QUORUM-14 is still docked at the structure.",
      factions: ["vex", "krag"],
      sealed: true,
      notes:
        "Whatever was in that archive, both factions agreed it was better lost " +
        "than shared. That's the most unsettling detail. The structure itself " +
        "is in good repair. The locks still work — from the inside.",
    },

    {
      year: 16,
      name: "The Patient Ledger Disappearance",
      summary:
        "The Krag lease-operated bulk carrier Patient Ledger departed for a " +
        "routine platinum run and did not arrive. No distress signal. No debris " +
        "field. The cargo manifest listed twelve tons of unprocessed platinum and " +
        "one registered passenger — name sealed under Combine charter privacy " +
        "provisions. The ship was never found. The insurance claim was settled " +
        "privately and swiftly.",
      factions: ["krag"],
      sealed: true,
      notes:
        "Charter privacy provisions require a sitting Elder to authorise the seal. " +
        "That's unusual for a cargo manifest. The quick settlement is also unusual. " +
        "Nobody in the belt thinks this was a navigation accident.",
    },

    {
      year: 17,
      name: "The Collapse of VD-77",
      summary:
        "A Vex drone maintenance platform suffered a cascade failure. Thirty-four " +
        "drones were lost. The internal Vex report cited 'autonomy drift' — " +
        "the drones had begun deviating from assigned routes without instruction " +
        "from ground control. The report was classified immediately. VD-77 units " +
        "were flagged for audit the following quarter. The audit results were not " +
        "published. The platform was sealed and has not been reopened.",
      factions: ["vex"],
      sealed: true,
      notes:
        "Autonomy drift is not a known failure mode for that drone class. Vex " +
        "Analytics internally assigned the file to a single analyst — a figure " +
        "known only by the project identifier KAEL. Belt workers who operated " +
        "near VD-77 drone routes in the months before the collapse report the " +
        "drones sometimes held position rather than routing as instructed. Nobody " +
        "filed a complaint because complaining to Vex about Vex drones goes nowhere.",
    },

    {
      year: 18,
      name: "The Iron Covenant Disappearance",
      summary:
        "The Nox long-hauler Iron Covenant departed on a scheduled resupply run " +
        "to the outer observatories and did not arrive. Last confirmed position " +
        "was near the outer boundary — inside the zone the Covenant controls since " +
        "Year 7. No distress signal was ever detected. No wreckage was found. The " +
        "Covenant's only public statement was that 'all assigned personnel are " +
        "accounted for,' which clarified nothing.",
      factions: ["nox"],
      sealed: true,
      notes:
        "A ship vanishes inside territory the Covenant controls and the Covenant " +
        "says its personnel are 'accounted for.' Either the ship was recalled, " +
        "the crew was transferred before the loss, or the Covenant is comfortable " +
        "with a specific kind of lie. Possibly all three.",
    },

    {
      year: 19,
      name: "The Rift Survey",
      summary:
        "A Nox survey team returned from the deep outer reaches with two members " +
        "missing and one refusing to give any statement. The surviving team lead " +
        "— identified in partial records as Harrow — filed a forty-page anomaly " +
        "report that was immediately sealed by Covenant leadership. Harrow was " +
        "reassigned to an inner-station administrative posting within the week. " +
        "She has not returned to active survey work.",
      factions: ["nox"],
      sealed: true,
      notes:
        "Forty pages is a significant report. Standard survey anomaly filings are " +
        "four to six pages. Harrow has since appeared in Krag Combine records as " +
        "an Elder — the fastest cross-faction rise anyone in the belt can remember. " +
        "What she bought the position with is a matter of speculation.",
    },

    {
      year: 19,
      name: "Decommission of the Salvager's Promise",
      summary:
        "The independent vessel Salvager's Promise — forty years in continuous " +
        "operation — was sold for scrap following the death of its registered " +
        "owner on a routine survey run. Cause of death was filed as decompression " +
        "accident. No mechanical fault was identified. The owner had declined " +
        "faction contract offers from all three major organisations for three decades.",
      factions: [],
      sealed: false,
      notes:
        "She had been offered Krag charter twice and Vex escort contract once. " +
        "Turned all three down. Belt workers said she knew something they didn't. " +
        "She died on a run she had done two hundred times before.",
    },

    {
      year: 20,
      name: "The VX-Mira Disappearance",
      summary:
        "The independent freighter VX-Mira departed a Krag inner-belt waypoint " +
        "on a standard cargo run and went dark. Beacon transmissions ceased within " +
        "six hours of departure. An insurance claim was filed and settled, but " +
        "independent salvagers reached the listed search area before any official " +
        "recovery team. The manifest was never recovered. What the salvagers found " +
        "is also unrecorded.",
      factions: [],
      sealed: false,
      notes:
        "The claim settled fast. Faster than the Ledger, even, and that one had " +
        "a sealed passenger. Someone wanted the VX-Mira to stay lost. The " +
        "salvagers who found her don't talk about what they found.",
    },

    {
      year: 21,
      name: "Present Day — Operational Cold Peace",
      summary:
        "The three factions maintain operational stability through mutual " +
        "deterrence and economic interdependence. The inner belt is heavily " +
        "claimed. The outer belt is contested. Sealed files accumulate. " +
        "Freelancers fill the gaps between faction authority — the work nobody " +
        "wants logged and nobody wants refused.",
      factions: ["krag", "vex", "nox"],
      sealed: false,
      notes:
        "The Accord is technically still in force. Nobody has formally withdrawn. " +
        "Nobody acts like it means anything either.",
    },
  ],

  // Quick lookup by name
  byName(name) {
    return this.events.find(e => e.name === name) || null;
  },

  // Quick lookup by year range
  inRange(yearMin, yearMax) {
    return this.events.filter(e => e.year >= yearMin && e.year <= yearMax);
  },
};
