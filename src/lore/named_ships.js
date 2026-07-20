/*=== HARNESS:NAMED_SHIPS ====================================================*/
// Registry of historically significant vessels. Each entry is specific enough
// that NPCs can reference them by name in briefings. The site_lore.js pools
// draw from this registry; so do story_quests briefings and faction dialogue.
//
// Shape: NAMED_SHIPS — array of { name, class, faction_or_owner, status,
//   fate, year_lost?, notes }
// status: "active" | "decommissioned" | "destroyed" | "missing" | "unknown"
// faction_or_owner: faction key ("krag"|"vex"|"nox") or "independent"

const NAMED_SHIPS = [

  // ---- Historically significant: referenced in UNIVERSE_HISTORY.events ------

  {
    name: "Ardent Claim",
    class: "survey vessel",
    faction_or_owner: "krag",
    status: "decommissioned",
    fate:
      "Decommissioned Year 6 and stripped for parts at Homeport Mira. " +
      "The frame was sold as scrap after the Meridian Incident file was sealed. " +
      "Whatever was left aboard when the salvagers arrived was not logged.",
    year_lost: 6,
    notes:
      "Central to the Meridian Incident (Year 4) — filed a platinum strike on " +
      "a rock the Vex had already flagged. Three workers died in a pressurisation " +
      "accident during the standoff. Sister ship: Deep Meridian.",
  },

  {
    name: "Deep Meridian",
    class: "survey vessel",
    faction_or_owner: "krag",
    status: "unknown",
    fate:
      "Pulled from the Meridian Incident site before the investigation concluded. " +
      "No formal deposition was ever filed by the crew. Current status unknown; " +
      "the vessel does not appear in any subsequent Krag registry.",
    year_lost: 4,
    notes:
      "Sister ship to the Ardent Claim. The fact that it was moved before the " +
      "investigation is the closest thing to evidence either faction has produced. " +
      "Neither faction has claimed it.",
  },

  {
    name: "VX-Mira",
    class: "independent freighter",
    faction_or_owner: "independent",
    status: "missing",
    fate:
      "Went dark Year 20 six hours after departing a Krag inner-belt waypoint. " +
      "Insurance claim filed and settled before any official recovery team " +
      "mobilised. Independent salvagers reached the search area first. " +
      "The cargo manifest was never recovered.",
    year_lost: 20,
    notes:
      "The fast settlement and missing manifest are the details everyone notes. " +
      "What the salvagers found — and whether they kept it — is unrecorded.",
  },

  {
    name: "Iron Covenant",
    class: "long-haul freighter",
    faction_or_owner: "nox",
    status: "missing",
    fate:
      "Departed on a scheduled resupply run to the outer observatories, Year 18. " +
      "Last confirmed position: near the outer boundary, inside Covenant-controlled " +
      "space. No distress signal. No wreckage found. The Covenant's only public " +
      "statement was that all assigned personnel are 'accounted for.'",
    year_lost: 18,
    notes:
      "A ship vanishing inside territory the Covenant controls, with no wreckage " +
      "and no distress signal, is either a recall, a crew transfer before a " +
      "deliberate loss, or a specific kind of lie. Possibly all three.",
  },

  {
    name: "Hendricks Array",
    class: "mobile data station",
    faction_or_owner: "vex",
    status: "destroyed",
    fate:
      "Destroyed in the Picket Incident, Year 11. Drifted into a stable debris " +
      "orbit following the engagement. Still listed as a navigation hazard in " +
      "the transit corridor. The drive arrays were built to survive combat damage; " +
      "they may still be readable.",
    year_lost: 11,
    notes:
      "The Picket Incident was officially 'disputed' by both factions. The " +
      "Hendricks Array's logs, if recoverable, would resolve the dispute. " +
      "Neither faction has filed to recover them.",
  },

  {
    name: "Salvager's Promise",
    class: "independent survey vessel",
    faction_or_owner: "independent",
    status: "decommissioned",
    fate:
      "Sold for scrap Year 19 following the death of its owner on a routine run. " +
      "Cause of death: decompression accident. No mechanical fault identified. " +
      "The owner had declined Krag charter and Vex escort contract offers for " +
      "three decades running.",
    year_lost: 19,
    notes:
      "She had done that run two hundred times. Belt workers who knew her say " +
      "she would not have made that kind of mistake. The decompression was not " +
      "explained by any identified equipment failure.",
  },

  {
    name: "The Patient Ledger",
    class: "bulk carrier",
    faction_or_owner: "krag",
    status: "missing",
    fate:
      "Vanished Year 16 during a routine platinum run. No distress signal. " +
      "No debris. Cargo manifest included twelve tons of unprocessed platinum " +
      "and one registered passenger — name sealed under Combine charter privacy " +
      "provisions. Insurance claim settled privately and quickly.",
    year_lost: 16,
    notes:
      "Charter privacy provisions require a sitting Elder to authorise a passenger " +
      "name seal. That is unusual for a cargo run. The settlement speed is also " +
      "unusual. No one believes this was a navigation accident.",
  },

  {
    name: "Covenant's Reach",
    class: "deep survey vessel",
    faction_or_owner: "nox",
    status: "decommissioned",
    fate:
      "Led the Year 7 Nox Expansion fleet past the outer boundary. Returned " +
      "intact. Now a museum piece at the Covenant outer observatory — closed " +
      "to outside visitors. The Covenant describes it as a 'heritage vessel.'",
    year_lost: null,
    notes:
      "The only ship from the Year 7 expansion fleet that came back. Its logs " +
      "are part of the sealed Nox expansion file. The museum display has no " +
      "information about what the expansion found.",
  },

  {
    name: "Pale Reckoning",
    class: "escort vessel",
    faction_or_owner: "nox",
    status: "missing",
    fate:
      "Assigned to the Year 7 expansion fleet as escort to Covenant's Reach. " +
      "Did not return with the fleet. Outer Covenant stations list it as " +
      "'on extended survey patrol.' No position updates have been filed since Year 7.",
    year_lost: 7,
    notes:
      "Fourteen years of 'extended survey patrol' with no position updates. " +
      "Either the Covenant considers this normal or they prefer this story to " +
      "the accurate one.",
  },

  {
    name: "Harrow's Margin",
    class: "independent survey vessel",
    faction_or_owner: "independent",
    status: "unknown",
    fate:
      "Registered to a T. Harrow, Year 18. No subsequent survey filings. " +
      "Last logged position corresponds to the outer sector associated with " +
      "the Rift Survey (Year 19). Current status unknown.",
    year_lost: null,
    notes:
      "The registration predates the Rift Survey by one year, which means " +
      "Harrow had been running the outer sector solo before the Covenant " +
      "assigned a team. Whatever she found the first time brought the team.",
  },

  {
    name: "Quorum-14 Tender",
    class: "maintenance shuttle",
    faction_or_owner: "vex",
    status: "abandoned",
    fate:
      "Assigned to service the QUORUM-14 joint relay under the Vex-Krag " +
      "operational agreement. When the relay went dark (Year 14), the tender " +
      "was left docked at the structure. It has not been moved or recovered. " +
      "The relay and the tender are both intact.",
    year_lost: 14,
    notes:
      "The tender was abandoned with fuel in the tanks and consumables aboard. " +
      "Nobody went to retrieve it. The same people who decided not to explain " +
      "the relay's shutdown also decided not to recover the shuttle. The " +
      "locks on the relay dock still respond — from the inside.",
  },

  {
    name: "Survey 7",
    class: "pre-Accord survey vessel",
    faction_or_owner: "independent",
    status: "unknown",
    fate:
      "The oldest vessel in the belt's historical record — predating the " +
      "Cartography Accord by at least a decade. Its logs were cited in the " +
      "Accord negotiations but have never been made public. Current location " +
      "unknown; the vessel may no longer exist.",
    year_lost: null,
    notes:
      "Every faction claims Survey 7's logs support their interpretation of " +
      "the Accord's outer boundary clause. No faction has produced the logs. " +
      "The Nox Covenant references them most often, and most specifically.",
  },

  {
    name: "Vex Indemnity",
    class: "security contractor",
    faction_or_owner: "vex",
    status: "destroyed",
    fate:
      "One of three Vex Security ships destroyed in the Picket Incident, Year 11. " +
      "Wreckage is part of the Picket Field debris corridor. Crew remains contested " +
      "— Vex lists all crew as 'recovered,' Krag claims this is inaccurate.",
    year_lost: 11,
    notes:
      "The crew accounting dispute is one of the reasons the Picket Incident " +
      "remains 'disputed.' Both factions have reasons to prefer the numbers " +
      "they filed. Neither has opened the wreck to independent inspection.",
  },

  {
    name: "Cold Meridian",
    class: "independent survey vessel",
    faction_or_owner: "independent",
    status: "active",
    fate:
      "Still operational as of Year 21. Bought at Krag surplus auction, Year 8. " +
      "Specialises in contested-claim sectors. Owner has sold survey data to all " +
      "three factions at various points; has no exclusive contracts with any.",
    year_lost: null,
    notes:
      "The Cold Meridian's anomalous readings from Year 13 — sold to Vex " +
      "Analytics — have never been publicly characterised. The owner reportedly " +
      "said she sold 'because the alternative was being bought.' What the " +
      "alternative was, she has not elaborated.",
  },

  {
    name: "VD-77 Handler",
    class: "drone operations shuttle",
    faction_or_owner: "vex",
    status: "decommissioned",
    fate:
      "Assigned to escort duty for VD-77 drone maintenance platforms. " +
      "Crew filed the initial cascade failure report in Year 17. " +
      "Crew transferred to a different posting before the platform was sealed. " +
      "The shuttle was decommissioned six months after the incident.",
    year_lost: 17,
    notes:
      "The crew that reported the VD-77 cascade failure was moved before they " +
      "could be formally deposed in any investigation. That is not standard " +
      "procedure. The shuttle's own incident logs were included in the classified " +
      "report; they have not been seen since.",
  },

  {
    name: "Relay Ghost",
    class: "unregistered",
    faction_or_owner: "unknown",
    status: "unknown",
    fate:
      "An unregistered vessel reported near the QUORUM-14 relay site after " +
      "Year 14. Multiple independent sightings, no confirmed identification. " +
      "Never filed a transponder signal. Never confirmed by any faction. " +
      "Sightings continue intermittently.",
    year_lost: null,
    notes:
      "Three independent pilots reported the same vessel profile within one " +
      "year of the relay shutdown. All three described a medium-class ship " +
      "with no visible faction markings. None of them filed a formal report " +
      "because there was no protocol for reporting a ghost.",
  },

  {
    name: "Wren's Last Bet",
    class: "independent salvager",
    faction_or_owner: "independent",
    status: "decommissioned",
    fate:
      "Operated for twelve years before being sold for parts Year 18. " +
      "Recovered more Picket Field debris than any other single vessel — " +
      "a record that still stands. The owner went on to operate a salvage " +
      "brokerage from a neutral deep-space station.",
    year_lost: null,
    notes:
      "The Picket Field work generated a detailed record of what was aboard " +
      "each destroyed ship — including Hendricks Array components. Whether " +
      "the owner kept copies of those records is between her and whoever she " +
      "sold them to.",
  },

  {
    name: "Rift Approach",
    class: "long-range survey vessel",
    faction_or_owner: "nox",
    status: "decommissioned",
    fate:
      "Part of the Year 19 Rift Survey team. Returned with two crew members " +
      "missing. Decommissioned and placed in sealed storage at the Covenant " +
      "inner waypoint station within three months of the team's return. " +
      "Not publicly displayed. Not publicly accessible.",
    year_lost: null,
    notes:
      "A functioning vessel placed in sealed storage immediately after a " +
      "classified incident. The Covenant does not decommission functional " +
      "ships. Whatever the Rift Approach recorded on that run, the Covenant " +
      "does not want it accessible.",
  },

  {
    name: "Object 7-Echo",
    class: "unknown — wreck",
    faction_or_owner: "unknown",
    status: "unknown",
    fate:
      "Appears in survey logs as 'Object 7-Echo.' Krag filed a preliminary " +
      "claim on it Year 3, then abandoned the claim Year 4 without explanation. " +
      "No other faction has filed. No designation beyond the survey log entry " +
      "has been assigned. The structure is intact, apparently.",
    year_lost: null,
    notes:
      "A claim abandoned in the same year as the Meridian Incident. Krag " +
      "Combine was dealing with a great deal that year and may have simply " +
      "deprioritised a marginal find. Or the abandoned claim is connected to " +
      "the incident in a way nobody has put in writing.",
  },

  {
    name: "The Opened Account",
    class: "lease freighter",
    faction_or_owner: "krag",
    status: "decommissioned",
    fate:
      "Krag lease vessel, last cargo run Year 15. Returned to port with fewer " +
      "crew than it departed with and no cargo in the hold. The captain filed " +
      "the incident as a 'navigational emergency.' No further details were " +
      "entered into any record. The vessel was immediately placed in dry dock " +
      "and decommissioned six months later.",
    year_lost: null,
    notes:
      "The charter definition of 'navigational emergency' does not cover missing " +
      "crew. Whatever category that incident actually belonged to, both the " +
      "captain and the Combine agreed not to use it.",
  },

  {
    name: "Accord Survey One",
    class: "joint survey vessel",
    faction_or_owner: "krag",
    status: "decommissioned",
    fate:
      "The first Krag vessel to file a claim under the new Accord framework, " +
      "Year 0. Used as the administrative flagship for the initial inner-belt " +
      "survey. Decommissioned Year 9 and donated to the Combine historical " +
      "archive. Now on static display at the Krag inner-belt administrative " +
      "station. Accessible.",
    year_lost: null,
    notes:
      "The one famous ship in the belt that is exactly what it says it is. " +
      "Everything else in this registry has a sealed file, a missing manifest, " +
      "or a gap in the record. Accord Survey One just got old and retired.",
  },

  // ---- Quick lookup helpers -------------------------------------------------

];

// Index for fast name lookups from site lore and briefing generators.
const NAMED_SHIPS_INDEX = Object.fromEntries(
  NAMED_SHIPS.map(s => [s.name, s])
);
