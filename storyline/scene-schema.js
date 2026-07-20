// Scene node schema — the format ALL three faction story arcs use.
// ============================================================================
// This file is DOCUMENTATION (it is not built into game.html). The live data
// lives in src/game/visual_novel.js (VN_SCENES / VN_PROLOGUES / VN_ASSETS);
// the engine is the scene player in the same file. Keep this doc, that data,
// and storyline/assets/manifest.json in sync when adding scenes or assets.
//
// A scene = one background + one (optional) character portrait + a stack of
// dialogue lines, then either choice buttons or an advance to `next`.
// Chains terminate at a scene with next:null and no choices — the player
// closes and the onComplete callback passed to GAME.vnStart() fires.

const EXAMPLE_SCENE = {
  id: "krag_a0_05",                 // unique key; MUST equal its VN_SCENES key.
                                    // Convention: <faction>_a<act>_<nn>[branch]
                                    // e.g. krag_a0_03a / krag_a0_03b re-converge on krag_a0_04.

  background: "bg_krag_dock",       // key into the background manifest (VN_ASSETS +
                                    // storyline/assets/manifest.json). Missing art
                                    // falls back along `fallback` chains, so scenes
                                    // are writable before their art exists.

  character: {                      // or null → "splash" scene: no portrait card,
                                    // background shown undimmed, narration-forward.
    portrait: "krag_voss",          // BASE character key. The engine resolves
                                    // <portrait>_<expression>, then <portrait>_neutral.
    expression: "neutral",          // neutral | weary | tense | angry | proud | pleased …
                                    // (any suffix that exists in the manifest)
    position: "right",              // "left" | "right" | "center" — where the card sits
  },

  dialogue: [                       // played in order; tap/SPACE advances, first tap
                                    // fast-forwards the typewriter.
    { speaker: "VOSS", text: "I watched your approach." },   // speaker → VN_CAST colour
    { speaker: null,   text: "He slides a chip across the counter." }, // null = narration (italic)
  ],

  choices: [                        // or null → linear scene (uses `next`).
                                    // 1–4 options; shown after the last line types out.
    { label: "I'll take whatever you've got.",  // button text
      next: "krag_a0_06a",                      // scene to jump to (required)
      flag: "krag_eager" },                     // optional: set s.vn.flags[flag] = true
                                                // (persisted; query with GAME.vnFlag(name))
  ],

  next: null,                       // linear advance target when there are no choices.
                                    // null + no choices = END OF CHAIN → onComplete fires.

  autoAdvance: null,                // or ms: cinematic panels also advance themselves
                                    // after this many ms (still tap-skippable).
                                    // Never combine with choices (selfTest enforces).
};

// Engine API (src/game/visual_novel.js) -------------------------------------
//   GAME.vnStart(sceneId, onComplete)  open the overlay and play a chain
//   GAME.vnSkipTo(sceneId)             jump the live player (save/resume hook)
//   GAME.vnAdvance() / GAME.vnChoose(i)  input (wired to tap / SPACE / buttons)
//   GAME.vnEnd()                       close early (SKIP button) — still completes
//   GAME.vnFlag(name)                  read a persisted choice flag
//   GAME.vnSelfTest()                  graph integrity + headless walk (build.py --check)
//
// Persistence: s.vn = { flags:{}, seen:{} } — whitelisted in serializeGame /
// applySaveData (src/game/save.js). Prologue completion sets seen["<fac>_act0"],
// which is what stops a replay on R-restart of the same slot.
//
// Entry point: showOpeningScene() (overridden at the bottom of visual_novel.js)
// plays VN_PROLOGUES[s.playerFaction] on a brand-new game.
