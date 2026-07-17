/*=== HARNESS:VICTORY ========================================================*/
// Endgame — the player wins by conquering all 10 political regions, each via
// the same ≥60% outpost-majority rule that already flips a region's controller
// (_recalcRegionController). checkEmpireProgress runs from updatePolitics every
// frame: it caches the live player-region count for the HUD chip + galaxy map,
// breaks a faction the moment it holds none of its HOME regions (a one-time
// narrative newsline — its outposts and fleets fight on as unaffiliated
// remnants: nothing despawns and no flags change), and at 10/10 pauses the
// world (s.victoryOpen gates update()) under the full-screen EMPIRE
// ESTABLISHED overlay. CONTINUE EXPLORING resumes the run — s.empireWon stays
// true so the overlay never re-fires, even across saves; NEW GAME wipes the
// save and reloads. timePlayed/creditsEarned/empireWon/factionsDefeated all
// ride the save whitelist (serializeGame/applySaveData).
const VICTORY = {
  totalRegions: 10,
  defeatMsgs: {   // pushed once, when a faction's last home region falls
    vex:  "The Vex Collective has been shattered. Their fleets scatter into the void.",
    krag: "The Krag Dominion falls. Ancient forges go silent across the deep.",
    nox:  "The Nox Conclave is broken. Shadows retreat before your light.",
  },
};

Object.assign(GAME, {
  empireRegionCount() {
    let n = 0;
    for (const r of REGIONS) if (r.controller === "player") n++;
    return n;
  },
  checkEmpireProgress(s) {
    s = s || this.state;
    if (!s || !s.factionsDefeated) return;
    s.empireRegions = this.empireRegionCount();
    for (const f of CONFIG.factions) {
      if (s.factionsDefeated[f]) continue;
      if (REGIONS.some(r => r.faction === f && r.controller === f)) continue;
      s.factionsDefeated[f] = true;   // narrative only — remnant outposts/fleets keep their flags
      this.pushEvent(s, VICTORY.defeatMsgs[f], POLITICS.factionCol[f]);
    }
    if (s.empireRegions >= VICTORY.totalRegions && !s.empireWon) {
      s.empireWon = true;
      this.openVictory();
    }
  },
  openVictory() {
    const s = this.state;
    s.victoryOpen = true;   // update() freezes the world under the overlay
    this.renderVictoryPanel();
    this.saveGame();   // the capture that won auto-saved BEFORE the flag flipped — persist it
    AUDIO.stop("tractor");   // the frozen world skips the per-frame audio watch
    AUDIO.play("victory");
  },
  continueVictory() {
    this.state.victoryOpen = false;   // the game is won and keeps running
  },
  fmtTimePlayed(sec) {
    sec = Math.max(0, sec | 0);
    const p = (n) => String(n).padStart(2, "0");
    return p((sec / 3600) | 0) + ":" + p(((sec % 3600) / 60) | 0) + ":" + p(sec % 60);
  },

  // ---- #victoryPanel DOM overlay (_xxxDOM → sync → render → wire) ----
  _victoryDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (!this._vicEls) {
      const panel = document.getElementById("victoryPanel");
      if (!panel) return null;
      this._vicEls = { panel, stats: document.getElementById("vicStats") };
    }
    return this._vicEls;
  },
  syncVictoryDOM() {
    const els = this._victoryDOM(); if (!els) return;
    els.panel.classList.toggle("show", !!this.state.victoryOpen);
  },
  renderVictoryPanel() {
    const els = this._victoryDOM(); if (!els) return;
    const s = this.state;
    const rows = [
      ["Outposts captured", s.capturedOutpostCount || 0],
      ["Regions controlled", (s.empireRegions || 0) + "/" + VICTORY.totalRegions],
      ["Credits earned", (s.creditsEarned || 0) + "cr"],
      ["Time played", this.fmtTimePlayed(s.timePlayed || 0)],
    ];
    els.stats.innerHTML = rows.map(([l, v]) =>
      `<div class="vicRow"><span class="vicLbl">${l}</span><span class="vicVal">${v}</span></div>`).join("");
  },
  wireVictoryDOM() {
    const els = this._victoryDOM(); if (!els) return;
    document.getElementById("vicContinue").addEventListener("click", () => this.continueVictory());
    document.getElementById("vicNewGame").addEventListener("click", () => {
      if (!confirm("Start over? All progress will be lost.")) return;
      this.clearSave();
      location.reload();
    });
  },
});
