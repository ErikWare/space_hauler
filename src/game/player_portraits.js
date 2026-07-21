/*=== HARNESS:PLAYER_PORTRAITS ===============================================*/
// Playable pilot faces — 12 options (3 races × 2 male × 2 female). Picked on
// the title screen after faction; implies gender without a separate control.
// Race here is SPECIES (Krag / Vex / Nox physiology), independent of which
// faction board you signed with — freelancers of every kind work every dock.
//
// Art: sprites/player_portraits/<id>.png — graphic-novel locks match
// storyline/prompts/grok-character-template.md. VN resolves player_hauler_*
// to the chosen id via GAME._vnPortraitEntry.

const PLAYER_PORTRAIT_EDGE = "#57d1c9";

// Stable catalog. id is the save key and the file stem.
const PLAYER_PORTRAITS = [
  // ---- KRAG (slate ridged skin, bone-plate kit, ember eyes) ----
  { id: "pc_krag_m1", race: "krag", gender: "m", label: "BREN",
    blurb: "Ridge-scarred hauler · bone pauldron",
    lock: "BREN, a male HUMANOID Krag Combine hauler pilot in his early 40s. Slate-grey ridged skin webbed with faint crimson veins, hairless ridged scalp, small ember-orange eyes. Heavy brow ridges, strong jaw. Always wears a scuffed charcoal flight jacket with one pale bone shoulder plate strapped by brown leather, never a helmet. Stocky, pragmatic, bone-tired but unbroken." },
  { id: "pc_krag_m2", race: "krag", gender: "m", label: "TORR",
    blurb: "Younger ridge-kin · cracked staple plate",
    lock: "TORR, a male HUMANOID Krag Combine hauler pilot in his late 20s. Slate-grey ridged skin with fine crimson vein lines, hairless domed ridged head, bright ember-orange eyes. One bone pauldron cracked and mended with a riveted iron staple over a dark oil-stained flight jacket. Leaner build, restless posture, jaw set hard." },
  { id: "pc_krag_f1", race: "krag", gender: "f", label: "SKARA",
    blurb: "Dock-hardened · iron-staple pauldron",
    lock: "SKARA, a female HUMANOID Krag Combine hauler pilot in her mid 30s. Slate-grey ridged skin with faint crimson veins, hairless ridged scalp, small ember-orange eyes, sharp cheek ridges. Always wears a worn charcoal flight jacket with a pale bone chest plate and brown leather harness straps, never a helmet. Compact powerful build, unimpressed default expression." },
  { id: "pc_krag_f2", race: "krag", gender: "f", label: "VEXA",
    blurb: "Quiet ridge-kin · mended bone harness",
    lock: "VEXA, a female HUMANOID Krag Combine hauler pilot in her late 40s. Deep slate-grey heavily ridged skin, hairless scalp with deep brow ridges, dim ember-orange eyes, weathered face. Always wears a frayed soot-dark flight jacket under pale bone shoulder plates strapped with patched leather. Broad shoulders, patient menace, calm mouth." },

  // ---- VEX (ash-grey skin, cobalt temple circuits, silver eyes) ----
  { id: "pc_vex_m1", race: "vex", gender: "m", label: "RYNN",
    blurb: "Ex-patrol · scraped Dominion collar",
    lock: "RYNN, a male HUMANOID Vex Dominion hauler pilot in his mid 30s. Smooth ash-grey skin, high hairless crown, sharp cheekbones, pale silver eyes with no visible pupil. Thin luminous cobalt-blue circuit-like markings sweep from his temples across his brow. Always wears a high-collared charcoal flight jacket with dull chrome collar tabs, posture still military. Severe, precise, faintly disappointed." },
  { id: "pc_vex_m2", race: "vex", gender: "m", label: "SEV",
    blurb: "Tribunal washout · half-scraped tabs",
    lock: "SEV, a male HUMANOID Vex Dominion hauler pilot in his early 40s. Smooth ash-grey skin, hairless crown, gaunt face, pale silver eyes without pupils. Cobalt-blue circuit markings along the temples, slightly dimmer on one side. Always wears a worn navy-black flight jacket with one chrome shoulder guard polished and one deliberately scraped bare. Rigid posture, jaw tight." },
  { id: "pc_vex_f1", race: "vex", gender: "f", label: "NYRA",
    blurb: "Form-file pilot · chrome collar",
    lock: "NYRA, a female HUMANOID Vex Dominion hauler pilot in her early 30s. Smooth ash-grey skin, high hairless crown, sharp cheekbones, pale silver eyes with no visible pupil. Luminous cobalt-blue circuit markings from temples across brow and scalp. Always wears a high-collared dark navy flight jacket with polished chrome collar ring, perfect posture. Court-martial calm, severe, precise." },
  { id: "pc_vex_f2", race: "vex", gender: "f", label: "KESS",
    blurb: "Quiet enforcer · dimmed brow marks",
    lock: "KESS, a female HUMANOID Vex Dominion hauler pilot in her late 30s. Smooth cool ash-grey skin, hairless crown, angular face, pale silver pupil-less eyes. Cobalt-blue circuit markings at the temples, deliberately underlit. Always wears a scuffed charcoal-navy flight jacket with thin chrome collar tabs, sleeves rolled once. Controlled, formal, idealistic under the ice." },

  // ---- NOX (frosted-glass skin, violet eyes, constellation threads) ----
  { id: "pc_nox_m1", race: "nox", gender: "m", label: "ORIN",
    blurb: "Outer-dark runner · hood half-up",
    lock: "ORIN, a male HUMANOID Nox Covenant hauler pilot of unreadable age. Skin like translucent frosted glass with faint star-fields drifting beneath, softly glowing violet eyes, thin knowing smile. Always wears a dark charcoal flight jacket under a midnight hooded shawl embroidered with thin violet circuit lines and constellation threads, hood often half-up. Courteous unhurried menace." },
  { id: "pc_nox_m2", race: "nox", gender: "m", label: "THAL",
    blurb: "Patient courier · violet underglow",
    lock: "THAL, a male HUMANOID Nox Covenant hauler pilot, ageless bearing. Translucent frosted-glass skin with slow star-field motes under the surface, glowing violet eyes, almost no brows. Always wears a plain dark flight jacket with a thin violet-line mantle across the shoulders, no letters or insignia text. Still posture, thin closed-mouth smile, patient." },
  { id: "pc_nox_f1", race: "nox", gender: "f", label: "SAEL",
    blurb: "Asset runner · constellation shawl",
    lock: "SAEL, a female HUMANOID Nox Covenant hauler pilot of unreadable age. Skin like translucent frosted glass with faint drifting star-fields beneath, softly glowing violet eyes, thin knowing smile. Always wears a hooded midnight-black flight mantle with iridescent constellation thread embroidery and thin violet circuit lines, hood up. Courteous, unhurried, already reading the ending." },
  { id: "pc_nox_f2", race: "nox", gender: "f", label: "MIRA-N",
    blurb: "Quiet ledger-hand · frost-haze eyes",
    lock: "ELEN, a female HUMANOID Nox Covenant hauler pilot, mid-appearing 30s but ageless. Cool frosted-glass skin with faint star motes under the surface, glowing violet eyes, composed mouth. Always wears a charcoal civilian flight jacket with a thin wordless violet geometric chevron pin — no letters, words, or writing — and a dark mantle. Precise, dry, taking careful mental notes." },
];

const PLAYER_PORTRAIT_BY_ID = Object.create(null);
for (const p of PLAYER_PORTRAITS) PLAYER_PORTRAIT_BY_ID[p.id] = p;

// Register into VN_ASSETS once visual_novel has loaded. build.py loads this
// file after visual_novel.js so VN_ASSETS exists.
(function registerPlayerPortraitAssets() {
  if (typeof VN_ASSETS === "undefined") return;
  for (const p of PLAYER_PORTRAITS) {
    const key = p.id + "_neutral";
    if (!VN_ASSETS[key]) {
      VN_ASSETS[key] = {
        src: "sprites/player_portraits/" + p.id + ".png",
        edge: PLAYER_PORTRAIT_EDGE,
      };
    }
  }
})();

Object.assign(GAME, {
  playerPortraitDef() {
    const id = this.state && this.state.playerPortraitId;
    return (id && PLAYER_PORTRAIT_BY_ID[id]) || PLAYER_PORTRAITS[0];
  },
  // Implicit gender from the chosen face. Defaults male if unset (old saves).
  playerGender() {
    const g = this.state && this.state.playerGender;
    return g === "f" ? "f" : "m";
  },
  playerRace() {
    const d = this.playerPortraitDef();
    return (d && d.race) || "krag";
  },
  // Pronoun helpers for quest / VN copy. Prefer second-person "you" in new
  // writing; these cover third-person narration hooks.
  playerPronouns() {
    return this.playerGender() === "f"
      ? { subject: "she", object: "her", poss: "her", Poss: "Her", Subject: "She" }
      : { subject: "he", object: "him", poss: "his", Poss: "His", Subject: "He" };
  },
  // Expand {he}/{she}/{him}/{her}/{his}/{He}/… from the active gender.
  // Only braced tokens — never free-word replace (would smash "The", "this").
  genderText(str) {
    if (!str || typeof str !== "string") return str || "";
    if (str.indexOf("{") < 0) return str;
    const p = this.playerPronouns();
    return str
      .replace(/\{he\}/g, p.subject).replace(/\{she\}/g, p.subject)
      .replace(/\{He\}/g, p.Subject).replace(/\{She\}/g, p.Subject)
      .replace(/\{him\}/g, p.object).replace(/\{her\}/g, p.object)
      .replace(/\{his\}/g, p.poss).replace(/\{His\}/g, p.Poss)
      .replace(/\{hers\}/g, p.poss === "her" ? "hers" : "his");
  },
});
