/*=== HARNESS:SITE_LORE ======================================================*/
// Expanded site-type lore pools for mercenary quest briefings.
// Replaces the inline MERC_SITE_LORE definition in merc_quests.js.
//
// Each pool has 10 variants. One is picked at random when a quest is offered
// and becomes the NPC's opening line — the "why is this place notable" before
// the actual job ask (spec.briefLine2).
//
// Variants reference UNIVERSE_HISTORY events, NAMED_SHIPS, and faction politics
// where possible. The NPC is an expert; the lore line should feel like lived
// knowledge, not a historical briefing.

const MERC_SITE_LORE = {

  shipwreck: [
    // 1
    "That's the Patient Ledger. Krag bulk carrier, went dark about five years ago. " +
    "Cargo manifest listed twelve tons of unprocessed platinum and one sealed " +
    "passenger record. Neither the platinum nor the passenger was ever explained. " +
    "The claim settled fast and quietly, which tells you everything.",

    // 2
    "The Salvager's Promise. Forty years in service before the owner died on a " +
    "routine run — decompression, they said. She didn't make mistakes. I knew " +
    "her for twenty years and she didn't make mistakes. The hull was sold for " +
    "scrap before anyone thought to ask questions, which may have been the point.",

    // 3
    "Picket Field debris — the Year 11 border action, Krag militia versus a Vex " +
    "security contractor convoy. Six ships, neither faction admits fault. The " +
    "wreck you want is the Hendricks Array — Vex mobile data station, still has " +
    "drives in it. Both factions want those drives gone. Nobody's gone to get them.",

    // 4
    "No registered name. Shows up in the survey logs as Object 7-Echo. Krag " +
    "filed a claim on it in Year 3, abandoned the claim in Year 4, never said " +
    "why. Same year as the Meridian Incident. I don't know if those are connected. " +
    "I know I haven't filed on it either.",

    // 5
    "The VX-Mira. Independent freighter, went dark two years back. Insurance " +
    "settled before any official recovery team moved, which means somebody " +
    "wanted it found on their schedule, not the Accord's. Salvagers got there " +
    "first. What they found, they didn't log.",

    // 6
    "That's the Ardent Claim — or what's left of her frame after Krag stripped her. " +
    "Survey vessel, involved in the Meridian Incident before I was doing this work. " +
    "Three workers died, both factions blamed each other, the file got sealed. " +
    "They stripped her at Homeport Mira six years later. The frame got sold here. " +
    "Whatever they left behind, nobody went to look.",

    // 7
    "That one has a beacon but it's old — pre-Accord frequency, if you know what " +
    "those sound like. Either the transponder never got updated or someone wants it " +
    "found on a frequency most people aren't scanning. Survey 7 ran this sector " +
    "before the Accord. I have no theory about what that means.",

    // 8
    "Crew reported a hard dock at the outer relay and never undocked. Transponder " +
    "went silent the same hour. That's not a navigation accident — that's a " +
    "choice, or someone made a choice for them. The relay's still there. " +
    "The airlock still shows docked.",

    // 9
    "Deep Meridian — sister ship to the Ardent Claim, pulled from the Meridian " +
    "Incident site before the investigation concluded. Never formally deposed. " +
    "Neither faction claimed her afterward, which means either they couldn't " +
    "agree on who owned the problem or both decided the problem was better unfound.",

    // 10
    "The Opened Account. Krag lease vessel, came back from a run in Year 15 " +
    "with fewer crew than it departed with and nothing in the hold. Captain " +
    "filed it as a navigational emergency. Neither word in that phrase applies " +
    "to missing crew. She was dry-docked and decommissioned six months later. " +
    "The hull ended up out here.",
  ],

  outpost: [
    // 1
    "Used to be a Krag claim site — survey went wrong, crew pulled out fast. " +
    "Left the equipment running. The equipment is still running. That's " +
    "twelve years of unattended operation, which either means the hardware " +
    "is very good or nobody wants to be the one who finds out what it's been doing.",

    // 2
    "Vex built it as a relay station. Stopped transmitting eight months ago " +
    "and nobody went to look, because it wasn't in anyone's active contract. " +
    "That's the thing about Vex infrastructure — somebody built it and somebody " +
    "maintains it, but the two groups don't always talk to each other.",

    // 3
    "The Nox built it as a listening post, which tells you nothing about what " +
    "they were listening for. The outer observatories have been Covenant-controlled " +
    "since the Year 7 expansion. Anything in this sector is probably feeding " +
    "data back to something you won't get to see.",

    // 4
    "Quorum-14 maintenance node. The main relay went dark in Year 14 — Vex says " +
    "hardware failure, Krag says the data was pulled first. This node was part " +
    "of the same network. Whatever killed the relay, it may have killed this too. " +
    "Or the node kept running and nobody noticed.",

    // 5
    "Independent survey outpost, abandoned in a hurry — still has consumables " +
    "in the storage. The operator filed an anomalous reading report before " +
    "going silent. Cold Meridian surveys flagged the same sector, around the same " +
    "time, and sold the data to Vex Analytics. Vex hasn't published what they bought.",

    // 6
    "Vex Security checkpoint — decommissioned after the Picket Incident, Year 11. " +
    "The checkpoint was supposed to prevent exactly the kind of engagement " +
    "that happened anyway. Vex says the crew was reassigned before the incident. " +
    "Nobody asked the crew.",

    // 7
    "Old Krag militia post. Pre-Accord, when the claim disputes were settled by " +
    "whoever had more guns at the site. The charter replaced most of that with " +
    "arbitration. Most. The post sat in a contested zone for three years after " +
    "the Accord and nobody filed the decommission.",

    // 8
    "Nox listening station — officially decommissioned, but the power cells are " +
    "still charging. 'Decommissioned' in Covenant terminology means they stopped " +
    "sending crews there. It does not necessarily mean they stopped listening.",

    // 9
    "This was a Vex VD-77 drone operations node before the cascade failure in " +
    "Year 17. Thirty-four drones lost. The platform was sealed and the node " +
    "was abandoned in the same action. Vex classified the failure report. " +
    "The node hardware still matches active VD-77 spec.",

    // 10
    "Krag assessment post — the kind that gets set up when a survey team files " +
    "something interesting and the Assessors want to verify before the Elders " +
    "are briefed. Post like this appearing means somebody found something. " +
    "Post like this going dark means either the find was wrong or somebody " +
    "found it first.",
  ],

  heavy_body: [
    // 1
    "That rock's been claimed six times and held once. The one time it was held " +
    "was Krag, Year 3. They abandoned the claim the year of the Meridian Incident " +
    "without explanation. Something about the approach discourages tenure, and " +
    "the approach problem predates the claim disputes.",

    // 2
    "Impact crater, maybe forty years back — the strike exposed platinum seams " +
    "that ran deeper than the initial survey suggested. First filed claim was " +
    "last month. Either the field has been invisible for forty years or someone " +
    "kept it off the survey books until now.",

    // 3
    "Mining platform ran an illegal expansion past its licensed zone. Krag shut " +
    "it down hard — equipment's still there, nobody filed for disposal. The " +
    "platform operator went under in the tribunal. The charter is full of " +
    "equipment no one filed to remove.",

    // 4
    "Deep scan came back anomalous. Could be nothing — mineral density variance, " +
    "processing artifact. Could be old Covenant tech under the surface. The " +
    "Nox Expansion in Year 7 went right through this sector. Covenant survey " +
    "teams don't always file what they find.",

    // 5
    "Cold Meridian surveyed this body in Year 13 and sold the results to Vex " +
    "Analytics. Vex hasn't published a summary, which is unusual — they usually " +
    "monetise everything they buy. Whatever the scan found, they found it more " +
    "useful as leverage than as published data.",

    // 6
    "Krag filed a platinum assessment on this body in Year 8. The Assessor's " +
    "report was submitted, reviewed, and then held at Elder level for six months. " +
    "The hold was removed and the claim was granted — but to a different operator " +
    "than the one who filed the original survey. The original surveyor didn't " +
    "contest it. Nobody asks why.",

    // 7
    "This is the body the Rift Survey team was diverted from, before they went " +
    "further out. Nox internal records — the ones that aren't sealed — list it " +
    "as 'preliminary survey completed, follow-up deferred pending resource " +
    "assessment.' The follow-up was never filed. The team went deeper instead.",

    // 8
    "Vex deployed three probe units to this body in Year 15, back when the VD-77 " +
    "platforms were still operational. All three returned corrupted data. That's " +
    "the same anomaly classification that preceded the cascade failure in Year 17. " +
    "Whether those are related, Vex hasn't said.",

    // 9
    "Nox survey flagged it as 'preservation-significant' in Year 6. That " +
    "classification exists in Covenant taxonomy and means nothing specific " +
    "to anyone outside the Covenant. It does mean they will notice if you " +
    "start excavating, and they will have opinions.",

    // 10
    "There's a pre-Accord mining scar on the south face — hand-drilled, " +
    "not machine-bored. That puts it before Year -8 at least. Whoever was " +
    "operating out here that early wasn't Krag or Vex. The Covenant doesn't " +
    "comment on pre-Accord operations. They don't need to.",
  ],

  debris_field: [
    // 1
    "This is Picket Field — what's left of the Year 11 border action. Six ships, " +
    "Krag and Vex both. Neither faction sent a recovery team. Neither faction " +
    "admits who started it. The salvagers who work this field call it the " +
    "Unsettled Account. The name is accurate.",

    // 2
    "Convoy got caught in a vent discharge from a pressure event — scattered " +
    "across eighty klicks. Three ships, all independents, all operating under " +
    "Krag transit permits. The permits carried liability waivers. Nobody was " +
    "compensated. The field is still active navigation hazard.",

    // 3
    "Somebody detonated a loader drone mid-haul. Krag filed it as a maintenance " +
    "accident; Vex filed it as potential sabotage. Both filings were correct " +
    "in what they reported and silent about what they didn't. The drone was " +
    "a VD-77-adjacent unit — same class, earlier generation.",

    // 4
    "Station demolition debris — the operator didn't pay for a licensed disposal " +
    "contractor, so they just pushed the hull off the pad and let physics handle it. " +
    "That is technically illegal under the Accord environmental provisions. " +
    "Nobody has been fined. The field has been here nine years.",

    // 5
    "This is residual from the Quorum-14 shutdown. When the relay went dark, " +
    "a maintenance barge was mid-approach. Without the relay to coordinate, " +
    "the barge lost navigation reference and broke up. The relay tender is " +
    "still docked at the main structure. Nobody retrieved the barge either.",

    // 6
    "Nox survey debris — an outer-reach scout that hit navigational variance " +
    "on the way back from the Year 7 expansion. The Covenant filed the loss " +
    "but not the circumstances. 'Navigation variance' is their standard " +
    "incident code for anything that hit something. This one hit a lot.",

    // 7
    "Vex Security convoy, Year 9. Lost two escort ships and most of a cargo " +
    "freighter to a raider engagement. The raiders were never identified. " +
    "Belt workers note this was six months before Vex Security got the " +
    "inner-belt contract mandate. The timing has been noted before.",

    // 8
    "Old Krag survey debris — pre-Accord, when survey teams ran without " +
    "emergency protocols because there weren't any. Three ships from the same " +
    "survey run, lost in the same week. The survey report was filed. The " +
    "crew list is in the charter archive. Nobody's asked about it since Year 2.",

    // 9
    "This is what's left of the Vex Indemnity and the two Krag ships it went " +
    "down with in the Picket Incident. The wreck accounting is disputed — " +
    "Vex lists all crew as recovered; Krag says the numbers don't match. " +
    "Both filings are sealed. The debris is definitely here.",

    // 10
    "Independent survey debris — three ships from different operators who were " +
    "working the same sector on overlapping schedules and collided during an " +
    "approach correction. Krag filed it as a navigation safety incident. " +
    "All three ships were working claim leads that Krag had passed on. " +
    "That part didn't make the incident report.",
  ],
};
