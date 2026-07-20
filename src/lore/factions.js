/*=== HARNESS:FACTIONS =======================================================*/
// Deep faction data: internal politics, leadership structures, contradictions,
// and notable figures. Used by story quests, VN briefings, and site lore.
// The FACTIONS object is not required for gameplay — it is a reference layer
// for authoring consistent faction voice in briefings and NPC dialogue.
//
// Shape: FACTIONS.krag / .vex / .nox — each has:
//   id, name, shorthand, founding, color (matches VN_CAST / VN_ASSETS)
//   structure — internal hierarchy
//   doctrine — stated public position
//   contradiction — the gap between doctrine and behaviour
//   known_figures — named characters with roles and notes
//   relationships — attitude toward each other faction
//   belt_sayings — worker/freelancer observations about the faction

const FACTIONS = {

  krag: {
    id: "krag",
    name: "Krag Combine",
    shorthand: "the Combine",
    founding:
      "Resource extraction charter, predating the Cartography Accord by at least " +
      "two decades. The original founding families held claim licences before " +
      "there was a licensing body. The Combine formalised around those licences.",
    color: "#ffb45e",

    overview:
      "The Krag Combine was built on extraction and it has never stopped thinking " +
      "like an extraction operation — even now, when it operates more like a city-state. " +
      "Claims are currency. A proven claim is worth more than credits because credits " +
      "can be spent; a claim compounds. The founding families understood this and " +
      "structured the Combine so that claim holders, not managers, hold ultimate power. " +
      "This means the people who run daily operations (Field Directors) are always " +
      "working for people who have never been in the field (Elders), and the tension " +
      "between those two groups drives most of what the Combine actually does.",

    structure: {
      tiers: [
        {
          title: "Elders",
          role:
            "Holders of founding-generation claims or their inheritors. Ultimate " +
            "authority over the Combine's direction. Most have not run active " +
            "operations in decades; many have never been in the outer belt. They " +
            "ratify claims, authorise sealed files, and appoint Field Directors.",
          notes:
            "The Elder tier has nine seats. Four are currently held by direct " +
            "descendants of the charter founders. Three were purchased through " +
            "what the Combine officially calls 'claim consolidation.' Two are " +
            "contested — the disputes are currently before the charter tribunal.",
        },
        {
          title: "Field Directors",
          role:
            "Run active operations: survey fleets, extraction sites, and the " +
            "militia units that protect Combine claims. Report to Elders. Have " +
            "real operational authority but no charter authority — they cannot " +
            "seal files, cannot authorise claim transfers, and cannot override " +
            "Elder decisions. Many consider this arrangement permanently backwards.",
          notes:
            "Field Directors who succeed too visibly get promoted to Elder, which " +
            "removes them from operational work. The ones who stay Field Directors " +
            "the longest are either loyal enough not to threaten the Elders or " +
            "good enough at operations to be more valuable where they are. " +
            "Director Voss is the second kind.",
        },
        {
          title: "Assessors",
          role:
            "Value new finds and certify claims before Elder review. The only " +
            "tier with formal technical expertise requirements. In theory, Assessors " +
            "are neutral; in practice, they know who appointed them.",
          notes:
            "An Assessor who consistently undervalues finds in contested sectors " +
            "gives the Combine deniability on disputed claims. An Assessor who " +
            "overvalues creates justification for militia deployment. The margin " +
            "between the two is the most political number in the Combine.",
        },
        {
          title: "Claim Workers / Contractors",
          role:
            "Survey crews, extraction teams, and the freelancers hired under " +
            "short-term charter. No charter authority. No voice in Elder decisions. " +
            "First to arrive at a site and last to be consulted about it.",
          notes: null,
        },
      ],
    },

    doctrine:
      "The Combine operates by the charter. All claims are formally filed, " +
      "all disputes go to arbitration, and all operations are authorised by " +
      "the appropriate tier of leadership. The charter has governed extraction " +
      "in this belt since before the Accord and will govern it after whatever " +
      "comes next.",

    contradiction:
      "The Meridian Incident file has never been released — not to the Accord " +
      "board, not to the affected parties, not to the workers who were there. " +
      "The charter requires disclosure of any incident resulting in worker death. " +
      "Three workers died. The file is sealed. When belt workers note this, the " +
      "Combine's standard response is that 'the charter process is ongoing.' " +
      "It has been ongoing for seventeen years. The belt has a saying for this: " +
      "'The charter bends where the seams run deep.'",

    known_figures: [
      {
        name: "Elder Harrow",
        role: "Elder, Combine leadership",
        portrait: "krag_harrow_neutral",
        notes:
          "The fastest cross-faction rise in belt history. Harrow appears in " +
          "Nox Covenant records as the lead surveyor on the Year 19 Rift Survey " +
          "team — the run that came back with two crew missing and a forty-page " +
          "sealed anomaly report. Within the year she was registered as a Krag " +
          "Elder. What she traded for that position has never been stated. " +
          "The Combine introduced her as 'bringing unique outer-belt experience.' " +
          "She has not publicly discussed the Rift Survey. She has registered " +
          "the survey vessel Harrow's Margin under her own name and has filed " +
          "no survey results from it.",
      },
      {
        name: "Director Voss",
        role: "Field Director, active operations; faction contact for Krag-aligned players",
        portrait: "krag_voss_neutral",
        notes:
          "Twenty-two years as Field Director, offered Elder promotion three " +
          "times and declined. The Combine considers this eccentric; Voss " +
          "considers the Elder tier to be where operational instincts go to die. " +
          "He runs tighter books than any other Director and loses fewer workers " +
          "per extraction run than the average. He knows where every claim in " +
          "his sector is and has personally assessed fourteen of them. He noticed " +
          "the old survey anomaly that turned out to be Elder Harrow's first " +
          "run, noted it, and filed it as 'probably nothing.' He has not decided " +
          "whether that was a mistake.",
      },
      {
        name: "REVA",
        role: "Independent salvager, potential companion (Krag arc)",
        portrait: "krag_reva_neutral",
        notes:
          "'Reva' is short for Revaluation — a salvager's joke about being written " +
          "down on someone's books. She has seen what the Combine does to crews " +
          "it considers expendable and has been working independent ever since. " +
          "She needs Combine-adjacent work and despises needing it. Her ship is " +
          "welded from three different wrecks; one nacelle is Vex-origin and she " +
          "will not discuss it.",
      },
    ],

    relationships: {
      vex:
        "Transactional contempt. The Combine uses Vex Security because it is " +
        "the most effective option and resents every contract. The Vex data-rights " +
        "clause in the Accord is the specific injury that never heals. Krag calls " +
        "Vex's surveillance network 'administrative overreach.' Vex calls it " +
        "'the service you're already paying for.'",
      nox:
        "Suspicious distance. The Nox Expansion (Year 7) violated the Accord " +
        "and nobody enforced it. Elder Harrow's transit from Nox surveyor to " +
        "Krag Elder is unexplained. The Combine officially considers Nox a " +
        "'stable partner with distinct operational priorities.' Belt workers " +
        "call this 'we don't know what they know and that bothers us.'",
    },

    belt_sayings: [
      "The charter bends where the seams run deep.",
      "File in triplicate. Two copies for Krag, one for the tribunal you'll need later.",
      "A Combine claim is forever. A Combine worker is a fiscal quarter.",
      "Voss knows where you left your shovel. He also knows what you dug up.",
    ],
  },

  // ---------------------------------------------------------------------------

  vex: {
    id: "vex",
    name: "Vex Corporation",
    shorthand: "the Dominion",
    founding:
      "Started as a data-brokering company during the early survey era — before " +
      "the Accord, when information about which rocks had what value was the " +
      "most tradeable commodity in the belt. Pivoted to security contracting " +
      "when it became clear that controlling information could also control access.",
    color: "#ff6a5e",

    overview:
      "Vex is the most legible faction to deal with because it has a price for " +
      "everything and publishes most of them. Every service Vex offers has a " +
      "contract, every contract has terms, and the terms are enforced with a " +
      "thoroughness that the other factions — which rely on authority and " +
      "tradition, respectively — find exhausting and frequently effective. " +
      "The problem is that Vex also has a price for things it does not " +
      "advertise: sealed files, disappeared records, 'hardware failures' that " +
      "resolve disputes. The Analytics and Security divisions do not always " +
      "agree on where that line is, which is the closest thing to an " +
      "internal conscience the Dominion has managed to develop.",

    structure: {
      tiers: [
        {
          title: "Analytics Division",
          role:
            "Data collection, surveillance, modelling, and information sales. " +
            "The original Vex business. Operates the most comprehensive private " +
            "sensor network in the belt. Processes and sells survey data, transit " +
            "records, faction movement analysis, and — for premium clients — " +
            "predictive models of resource availability.",
          notes:
            "Analytics considers itself the legitimate core of Vex. Security " +
            "considers itself the profitable one. Both are correct.",
        },
        {
          title: "Security Division",
          role:
            "Armed convoy escort, claim protection, enforcement contracts, and — " +
            "in grey-market contexts — what the contract terms call 'dispute " +
            "resolution.' The fastest-growing part of Vex since Year 9.",
          notes:
            "The Picket Incident (Year 11) was a Security Division operation " +
            "that the Analytics Division had risk-modelled as 'acceptable losses.' " +
            "The internal fight between the two divisions after the incident was " +
            "the most significant governance crisis in Vex history. Nobody outside " +
            "the Corporation knows the outcome.",
        },
        {
          title: "Tribunal Board",
          role:
            "The Dominion's internal arbitration and judicial body. Processes " +
            "internal disputes, authorises sealed operations, and reviews any " +
            "incident resulting in 'unscheduled asset loss.' Composition is " +
            "classified.",
          notes:
            "The tribunal that processed CADE's discharge for asking about the " +
            "VD-77 interdiction list was convened in forty-eight hours. Standard " +
            "tribunal convening time is three weeks. Something wanted him out fast.",
        },
        {
          title: "Contractors / field staff",
          role:
            "Survey operators, security personnel, data analysts, and the " +
            "freelancers hired under short-term Vex operational contracts. " +
            "Formally employees of Vex subsidiaries rather than the Corporation " +
            "itself — which means the Corporation is not liable for their actions.",
          notes: null,
        },
      ],
    },

    doctrine:
      "The Dominion supports open data principles, transparent operations, " +
      "and fair-market information access. All Vex services are rendered under " +
      "formal contract with clear terms. The Dominion does not engage in " +
      "covert operations or unsanctioned information collection.",

    contradiction:
      "Vex operates the most comprehensive private surveillance network in the " +
      "belt. Every station that uses Vex data infrastructure is logged, indexed, " +
      "and modelled. The belt worker who buys a Vex transit permit is buying " +
      "permission to be tracked. The 'open data principles' Vex publicly endorses " +
      "apply to the data Vex sells, not the data Vex keeps. The Analytics Division " +
      "has files on every independent operator who has worked within sensor range " +
      "of a Vex relay in the past decade. They call this 'operational continuity.'",

    known_figures: [
      {
        name: "KAEL",
        role: "Senior Analytics — VD-77 file; faction leader for Vex-aligned players",
        portrait: "vex_kael_neutral",
        notes:
          "The analytics lead assigned to the VD-77 drone autonomy drift incident. " +
          "His internal designation is the project identifier KAEL; whether this " +
          "is a name, an acronym, or a Vex classification system, belt workers " +
          "disagree. He has been with Vex Analytics through the Quorum " +
          "decommission, the Picket aftermath, and the VD-77 closure. He has " +
          "filed objections to three separate security operations and been " +
          "overruled on all three. He keeps filing anyway, which either means " +
          "he believes in the process or he is building a record.",
      },
      {
        name: "DREN",
        role: "Analytics Division; faction contact for Vex-aligned players",
        portrait: "vex_dren_neutral",
        notes:
          "Analytics operator who has worked under three different Tribunal Board " +
          "compositions without ever being caught between them. He is dry, " +
          "procedural, and funnier than his filing style suggests. He has filed " +
          "an objection to the VD-77 recertification review and noted it as " +
          "'not concerning you' in the briefing where he mentioned it. The " +
          "briefing was months before anyone connected the review to the " +
          "KAEL file. Either Dren did not make the connection or he made it " +
          "first and said nothing.",
      },
      {
        name: "CADE",
        role: "Former Vex enforcement pilot; potential companion (Vex arc)",
        portrait: "vex_cade_neutral",
        notes:
          "Asked who compiled the VD-77 interdiction list. Got a tribunal and a " +
          "severance packet in forty-eight hours. He kept the ship — a decommissioned " +
          "Vex interceptor with the faction markings half-scraped off. He still " +
          "flies like a Dominion officer. He still believes Vex is what it says " +
          "it is, which the player will find alternately admirable and unbearable.",
      },
    ],

    relationships: {
      krag:
        "Profitable tension. Krag needs Vex Security and resents the data rights " +
        "clause in the Accord. Vex Security needs Krag shipping lanes and resents " +
        "being needed rather than chosen. The two factions have the most contact " +
        "and the least trust. The Meridian Incident sealed file is the specific " +
        "injury both sides tend rather than resolve.",
      nox:
        "Wary respect. The Nox Covenant buys very little from Vex and sells " +
        "nothing. It has the deepest outer-belt presence and the most sealed " +
        "records. Analytics has modelled the Covenant's outer operations six " +
        "times and each model has produced a different conclusion. Vex does not " +
        "like things it cannot model.",
    },

    belt_sayings: [
      "Vex Security got the contract because they were the cheapest. Then they wrote the contract.",
      "Open data means open to Vex. Everything else is a premium tier.",
      "Ask Vex for a receipt. They'll give you one. Keep it.",
      "KAEL filed an objection. Security filed it under 'noted.'",
    ],
  },

  // ---------------------------------------------------------------------------

  nox: {
    id: "nox",
    name: "Nox Covenant",
    shorthand: "the Covenant",
    founding:
      "Predates the Cartography Accord. Nobody is certain by how long. The Covenant " +
      "helped draft the Accord's outer boundary clause and then expanded past its " +
      "terms in Year 7. They gave back nothing. The Covenant's founding documents " +
      "are not public.",
    color: "#b48aff",

    overview:
      "The Nox Covenant is the oldest organisation in the belt and the one that " +
      "knows it. Its public face is preservation and continuity — of records, of " +
      "knowledge, of 'the accumulated understanding of the belt.' What exactly " +
      "the Covenant is preserving is not stated. Its inner membership is concentric: " +
      "the workers and contractors who interact with the outer Covenant know almost " +
      "nothing about why they are doing what they are doing. The further in you go, " +
      "the more specific the knowledge gets. What the innermost circle knows, " +
      "nobody is saying. Every person who has tried to find out has either become " +
      "part of the Covenant or stopped asking.",

    structure: {
      tiers: [
        {
          title: "Outer Circle",
          role:
            "Workers, contractors, survey crews, and the Covenant's public-facing " +
            "staff. Carry out assigned operations with no briefing on why they " +
            "are assigned. Standard employment, standard contracts, non-disclosure " +
            "agreements that are technically standard but enforced unusually well.",
          notes:
            "Outer Circle members often genuinely do not know they are in the " +
            "Covenant's outer tier. They think they are working for a survey " +
            "company or a data archive. The Covenant does not correct this impression.",
        },
        {
          title: "Inner Covenant",
          role:
            "Coordinators, analysts, and senior surveyors who know that the " +
            "Covenant has an inner structure and that they are not in it. " +
            "Manage the Outer Circle, receive partial briefings, and are " +
            "trusted to ask fewer questions than they have answers to.",
          notes:
            "SIVE operates at this tier or above — she is consistently described " +
            "as 'inner Covenant' by sources who would know, and she behaves as " +
            "someone who holds significantly more information than she shares.",
        },
        {
          title: "Archivists",
          role:
            "The Covenant's knowledge class. Hold the historical records — " +
            "including the pre-Accord surveys, the Rift Survey anomaly report, " +
            "and whatever Survey 7's logs contain. Their specific function is " +
            "never officially described.",
          notes:
            "The Archivists are the reason the Covenant helps draft international " +
            "agreements: they need access to the information those agreements produce. " +
            "The Accord's outer boundary clause, which the Covenant immediately " +
            "violated, gave the Covenant the legal framework to claim the outer " +
            "reaches as its own territory when it moved.",
        },
        {
          title: "Inner Circle — Elders",
          role:
            "Unknown. The Covenant has never published a leadership structure. " +
            "The term 'Elder' is used by outer workers to describe anyone who " +
            "gives orders no one questions. Whether there is a formal Elder tier " +
            "or just a functional one is unconfirmed.",
          notes:
            "Harrow's anomaly report from the Rift Survey was 'immediately sealed " +
            "by Covenant leadership.' This implies a leadership tier that can act " +
            "quickly enough to seal a forty-page report in under forty-eight hours. " +
            "That is not the action of a committee.",
        },
      ],
    },

    doctrine:
      "The Nox Covenant is committed to the preservation and continuity of the " +
      "belt's accumulated knowledge and history. It operates survey and archive " +
      "functions to ensure that what is known is not lost, and that what is " +
      "discovered is properly understood before it is acted upon.",

    contradiction:
      "The Covenant helped draft the Cartography Accord — specifically the outer " +
      "boundary clause — and then pushed forty thousand kilometres past that " +
      "boundary in Year 7 without explanation and returned nothing. It has sealed " +
      "every anomalous finding its survey teams have produced. It has classified " +
      "the forty-page report from the one team that found something worth forty " +
      "pages. The Covenant's commitment to 'proper understanding before action' " +
      "is real — the Covenant is constantly understanding things. It simply never " +
      "shares what it understands with anyone outside the inner circle.",

    known_figures: [
      {
        name: "SIVE",
        role: "Covenant contact for Nox-aligned players; Outer or Inner tier",
        portrait: "nox_sive_neutral",
        notes:
          "Serene in a way that reads as either profound equanimity or comprehensive " +
          "preparation. She delivers decisions as observations and questions as " +
          "assignments. She uses the word 'routine' to close off questions before " +
          "they form — which means the things she calls routine are the ones she " +
          "most wants unexamined. She assigned LIRA to the player's watch rotation " +
          "and called it administrative trivia. The word 'routine' appeared in that " +
          "sentence.",
      },
      {
        name: "LIRA",
        role:
          "Assigned to player watch rotation; potential companion (Nox arc)",
        portrait: "nox_lira_neutral",
        notes:
          "The Covenant sends LIRA after the Year 10 catastrophe as an 'asset " +
          "handler' — officially to ensure player activities remain within " +
          "Covenant parameters. She is supposed to be an instrument. She is " +
          "beginning to have opinions and notes each one as a deviation from " +
          "her own baseline. She files the player's every action under an " +
          "increasingly specific bureaucratic category. The categories track " +
          "the relationship better than anything either of them says out loud.",
      },
      {
        name: "Harrow",
        role: "Krag Elder (current); former Nox survey lead",
        portrait: "krag_harrow_neutral",
        notes:
          "Led the Rift Survey team in Year 19. Filed a forty-page anomaly " +
          "report that was sealed immediately. Was reassigned to an " +
          "administrative posting within a week. Within a year she was " +
          "a Krag Combine Elder — the fastest cross-faction transition " +
          "anyone in the belt remembers. The Covenant says she 'completed " +
          "her assignment.' The Combine says she 'brought unique outer-belt " +
          "experience.' Nobody has asked her what she found. Those who have " +
          "tried to ask have found that she does not receive those questions.",
      },
    ],

    relationships: {
      krag:
        "Transactional and one-directional. The Covenant rarely needs anything " +
        "the Combine offers. When it does — survey access rights, transit " +
        "permissions, neutral infrastructure — the price it pays is data. " +
        "The Combine takes the deal because Covenant data on the outer belt " +
        "is unavailable anywhere else. The Combine has never noticed that the " +
        "data the Covenant provides is always accurate about what it describes " +
        "and never complete.",
      vex:
        "Distant mutual acknowledgement. The Covenant does not use Vex services. " +
        "It does not sell to Vex. It acknowledges Vex's right to operate under " +
        "the Accord with a formal correctness that Vex Analytics finds more " +
        "unsettling than hostility. The Covenant's sensor network in the outer " +
        "belt is not Vex infrastructure. Vex does not know what it is.",
    },

    belt_sayings: [
      "The Covenant knows. What it knows changes depending on what you ask.",
      "Routine means they've already decided and they don't want questions.",
      "Sive said it was fine. That's the part that worries me.",
      "The outer belt is Nox territory. The outer observatory is closed. Those are two separate facts.",
    ],
  },
};
