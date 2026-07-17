/*=== HARNESS:TUTORIAL =======================================================*/
// First-run onboarding — six contextual coach marks (small fixed-position DOM
// tooltips anchored near the UI element they explain), shown one at a time on
// a brand-new game only. Never blocks play: the world keeps running under the
// tip, NEXT walks the sequence, SKIP dismisses the lot. Tip 1 auto-advances
// the moment the ship actually moves. Dismissal sets s.tutorialDone and saves;
// applySaveData treats any loaded save as "seen", so the tips never return.
const TUTORIAL_TIPS = [
  { tag: "MOVEMENT", anchor: "thrust",
    text: "Hold anywhere on the screen to thrust toward that point — or steer with WASD / arrow keys. The THRUST buttons below set your engine power (25% to 100%)." },
  { tag: "TRACTOR BEAM", anchor: "beam",
    text: "Fly near ore rocks or salvage and tap them (or press SPACE) to tractor-tow them. Collected ore refines into bars at space stations — your main income." },
  { tag: "SPACE STATIONS", anchor: "minimap",
    text: "Dock at a space station (the large structures) to repair, buy modules, sell cargo, and upgrade your equipment. Stations appear on your minimap." },
  { tag: "COMBAT", anchor: "bars",
    text: "Enemy ships patrol by faction. Tap a target to lock on — your weapon auto-fires while its skill button is toggled on (tap it, or keys 1–6). Your shield regenerates; armor and hull repair at stations." },
  { tag: "OUTPOSTS", anchor: "center",
    text: "Hundreds of outposts dot the solar system. Attack and capture them to build your empire. Each region is controlled by whoever owns the most outposts." },
  { tag: "DANGER ZONES", anchor: "sec",
    text: "The SEC badge shows your current danger level (1–9). Deeper zones have tougher enemies but better loot. Check the galaxy map (◈ MAP) to see faction territory and plan your expansion." },
];

Object.assign(GAME, {
  // Intro cutscene: fade the scene_opening hero shot over the whole screen for
  // ~3s at the start of a brand-new game (before the coach marks). Pure DOM +
  // timers — decoupled from the sim, so the world keeps running underneath and
  // the headless selfTest never touches it. Called from boot once ART is ready.
  showOpeningScene() {
    if (HEADLESS || typeof document === "undefined") return;
    const el = document.getElementById("openingScene"); if (!el) return;
    const img = document.getElementById("openingSceneImg");
    if (img && !img.getAttribute("src")) img.src = ART_MANIFEST.scene_opening;
    el.classList.remove("fade"); el.classList.add("show");   // fade in (CSS opacity 0→1)
    setTimeout(() => el.classList.add("fade"), 2400);        // begin fade out
    setTimeout(() => el.classList.remove("show", "fade"), 3100);
  },

  // arm the coach marks on a brand-new game. Call AFTER loadGame — a restored
  // save carries tutorialDone=true, so a returning player never sees them.
  initTutorial(s) {
    s.tutorialActive = !s.tutorialDone;
    s.tutorialStep = 0;
  },

  // per-frame: tip 1 auto-advances once the ship actually moves; every other
  // tip waits for NEXT (reading pace is the player's).
  updateTutorial(s) {
    if (!s.tutorialActive) return;
    if (s.tutorialStep === 0 && Math.hypot(s.vx, s.vy) > 2) this.advanceTutorial();
  },

  advanceTutorial() {
    const s = this.state;
    if (!s.tutorialActive) return;
    if (s.tutorialStep >= TUTORIAL_TIPS.length - 1) { this._finishTutorial(); return; }
    s.tutorialStep++;
  },
  skipTutorial() { this._finishTutorial(); },
  _finishTutorial() {
    const s = this.state;
    s.tutorialActive = false;
    s.tutorialDone = true;
    this.saveGame();   // dismissal is permanent — survives reloads (no-op headless)
  },

  // ---- DOM (fixed tooltip over the canvas; hidden while any overlay is up) ----
  _tutorialDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._tutEls) return this._tutEls;
    const panel = document.getElementById("tutPanel");
    if (!panel) return null;
    this._tutEls = { panel,
      arrow: document.getElementById("tutArrow"),
      tag: document.getElementById("tutTag"),
      text: document.getElementById("tutText"),
      next: document.getElementById("tutNext"),
      skip: document.getElementById("tutSkip") };
    return this._tutEls;
  },

  // called each draw frame (same idiom as the dock panels): show/hide from
  // game state, re-render only when the step or the viewport changes
  syncTutorialDOM() {
    const els = this._tutorialDOM(); if (!els) return;
    const s = this.state;
    const show = s.tutorialActive && !s.docked && !s.warpOverlay && !s.galaxyMapOpen && !s.victoryOpen && !s.dead;
    els.panel.classList.toggle("show", show);
    if (!show) { this._tutRendered = -1; return; }
    const vp = innerWidth * 100000 + innerHeight;   // cheap viewport fingerprint (re-place on resize/rotate)
    if (this._tutRendered !== s.tutorialStep || this._tutViewport !== vp) {
      this._tutRendered = s.tutorialStep; this._tutViewport = vp;
      this.renderTutorialDOM();
    }
  },

  renderTutorialDOM() {
    const els = this._tutorialDOM(); if (!els) return;
    const s = this.state, tip = TUTORIAL_TIPS[s.tutorialStep] || TUTORIAL_TIPS[0];
    els.tag.textContent = "TIP " + (s.tutorialStep + 1) + "/" + TUTORIAL_TIPS.length + " · " + tip.tag;
    els.text.textContent = tip.text;
    els.next.textContent = s.tutorialStep >= TUTORIAL_TIPS.length - 1 ? "FINISH ✓" : "NEXT ▸";
    // position: logical HUD units → CSS px, the same mapping as boot's fit()
    // (short viewport axis = 390 logical units) and the corner HUD glyph scale
    // k = min(W/390, H/700) used by the minimap / SEC badge / top bars.
    const scale = Math.min(innerWidth, innerHeight) / 390;
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const st = els.panel.style;
    st.left = st.right = st.top = st.bottom = "auto"; st.transform = "none";
    const px = (v) => Math.round(v) + "px";
    let arrow = "";
    switch (tip.anchor) {
      case "thrust":   // 25/50/75/100% thrust cluster, bottom-right corner
        st.right = px(10 * scale); st.bottom = px(48 * scale);
        arrow = "down edge-right"; break;
      case "beam":     // tow targets float in the world — sit low, centered
        st.left = "50%"; st.transform = "translateX(-50%)"; st.bottom = px(64 * scale);
        arrow = "down edge-center"; break;
      case "minimap":  // minimap disc: R=44k at (W−58k, 118k) → just below it
        st.right = px(10 * scale); st.top = px(168 * k * scale);
        arrow = "up edge-right"; break;
      case "bars":     // shield/armor/hull/fuel strip spans the top (58k tall)
        st.left = px(10 * scale); st.top = px(64 * k * scale);
        arrow = "up edge-left"; break;
      case "sec":      // SEC badge + speaker stack under the minimap's right edge
        st.right = px(10 * scale); st.top = px(206 * k * scale);
        arrow = "up edge-right"; break;
      default:         // "center" — no specific UI target
        st.left = "50%"; st.top = "42%"; st.transform = "translate(-50%,-50%)";
    }
    els.arrow.className = arrow;
  },

  wireTutorialDOM() {
    const els = this._tutorialDOM(); if (!els) return;
    els.next.addEventListener("click", () => this.advanceTutorial());
    els.skip.addEventListener("click", () => this.skipTutorial());
  },
});
