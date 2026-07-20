/*=== HARNESS:TITLE ==========================================================*/
// Title screen — the boot landing (no more autoload). Three DOM pages inside
// #titlePanel over the opening_scene hero art: HOME (NEW GAME / LOAD GAME),
// FACTIONS (Krag / Vex / Nox cards → pick spawns the run at that faction's
// home port), and SLOTS (the 3 save-slot cards, doubling as the overwrite
// picker when a new game finds every slot full). The world sim idles while
// s.titleOpen is up (update() early-outs, saveGame refuses). All DOM access is
// HEADLESS-guarded; the state helpers (_spawnAtStation, factionHomeStation)
// are pure and selfTest-covered.
const TITLE_FACTIONS = [
  { key: "krag", name: "KRAG COMBINE", icon: "sprites/icon_krag.png", color: "#ffb45e",
    blurb: "Industrial scavengers of the strip-mined moons — the Krag machine wastes nothing, and it is always hungry." },
  { key: "vex", name: "VEX DOMINION", icon: "sprites/icon_vex.png", color: "#ff6a5e",
    blurb: "Sunward militarists forged in live-fire trials; every scar on their bulkheads is logged, numbered, and owed." },
  { key: "nox", name: "NOX COVENANT", icon: "sprites/icon_nox.png", color: "#b48aff",
    blurb: "Cold, ancient, calculating — the Nox drift the outer dark in patterns older than any charted war." },
];

Object.assign(GAME, {
  // Home port per faction: the faction's own-wedge station in its LOWEST-danger
  // territory, mirroring Krag's Homeport Mira (Krag Depths, danger 1). Resolved
  // from live geometry so it tracks any station/territory reshuffle — today
  // that lands Vex at Arix Station (Ember Gate) and Nox at Halveth Station.
  // TODO: confirm faction home — lore may prefer The Crucible / Shadow Basin,
  // but those are danger 8/7 wedges (brutal spawns for a fresh pilot).
  factionHomeStation(faction) {
    const stations = ForgeWorld.getStations(), s = this.state;
    if (faction === "krag") return stations[0];   // Homeport Mira — the classic start
    let best = null, bestDanger = 1e9;
    for (const p of s.planets) {
      if (p.faction !== faction) continue;
      const st = stations[p.stationIdx];
      if (!st) continue;
      const r = politicalRegionAt(st.pos.x, st.pos.y);
      if (!r || r.faction !== faction) continue;   // station drifted into a rival wedge — not home
      if (r.dangerLevel < bestDanger) { bestDanger = r.dangerLevel; best = st; }
    }
    return best || stations[0];
  },

  // Teleport the ship (+ camera / fog / region tracking) to a station's berth —
  // used by a fresh faction spawn and by loadGame's wake-up-at-home-port.
  _spawnAtStation(st) {
    const s = this.state;
    if (!st) return;
    s.x = st.pos.x; s.y = st.pos.y + 40; s.vx = s.vy = 0;
    s.cam.x = st.pos.x; s.cam.y = st.pos.y;
    s.dockStationId = st.id;
    this._exploreTilesAround(s.x, s.y);
    this.updateRegions();
    this.tickFields(0);   // stream the fields around the new berth immediately
  },

  // NEW GAME → faction picked. Claims the first empty slot; with all 3 full the
  // slot page re-opens in overwrite mode and _beginRun fires from its cards.
  startNewGame(faction) {
    let slot = 0;
    for (let n = 1; n <= SAVE_SLOTS; n++) if (!this.slotUsed(n)) { slot = n; break; }
    if (!slot) { this._pendingFaction = faction; this.renderTitleSlots("overwrite"); this._titlePage("slots"); return; }
    this._beginRun(faction, slot);
  },
  _beginRun(faction, slot) {
    const s = this.state;
    s.playerFaction = faction;
    const home = this.factionHomeStation(faction);
    if (home) { s.homeStationId = home.id; this._spawnAtStation(home); }
    this._activeSlot = slot;
    s.titleOpen = false;
    this._hideTitle();
    this.initTutorial(s);
    this.saveGame();   // stamp the slot now — its meta card, autosave, and R-restart all key off it
    this.startOnboarding();   // Q1 of the onboarding ladder; Act 0 now plays when it ends
  },
  _loadSlot(n) {
    if (!this.loadGame(n)) { toast("slot unreadable", "#ff5060", 2); return; }
    this.state.titleOpen = false;
    this._hideTitle();
    this.initTutorial(this.state);   // a loaded save carries tutorialDone → coach marks stay off
  },

  // ---- DOM (all render/wire below is browser-only) ----
  showTitleScreen() {
    if (HEADLESS || typeof document === "undefined") return;
    const el = document.getElementById("titlePanel"); if (!el) return;
    this.state.titleOpen = true;
    this.renderTitleHome();
    this._titlePage("home");
    el.classList.add("show");
  },
  _hideTitle() {
    if (HEADLESS || typeof document === "undefined") return;
    const el = document.getElementById("titlePanel");
    if (el) el.classList.remove("show");
  },
  _titlePage(name) {
    for (const p of ["home", "factions", "slots"]) {
      const el = document.getElementById("title" + p[0].toUpperCase() + p.slice(1));
      if (el) el.style.display = p === name ? "" : "none";
    }
  },
  renderTitleHome() {
    let any = false;
    for (let n = 1; n <= SAVE_SLOTS; n++) any = any || this.slotUsed(n);
    const btn = document.getElementById("titleLoad");
    if (btn) { btn.disabled = !any; btn.textContent = any ? "LOAD GAME" : "NO SAVES"; }
  },
  renderTitleFactions() {
    const row = document.getElementById("titleFactionRow"); if (!row) return;
    row.innerHTML = TITLE_FACTIONS.map(f => {
      const home = this.factionHomeStation(f.key);
      const reg = home ? politicalRegionAt(home.pos.x, home.pos.y) : null;
      const homeLine = home ? home.name + (reg ? " · " + reg.name : "") : "";
      return '<div class="titleCard" data-fac="' + f.key + '">' +
        '<img src="' + f.icon + '" alt="">' +
        '<div class="tcName" style="color:' + f.color + '">' + f.name + '</div>' +
        '<div class="tcBlurb">' + f.blurb + '</div>' +
        '<div class="tcHome">HOME: ' + homeLine + '</div></div>';
    }).join("");
    for (const card of row.querySelectorAll("[data-fac]"))
      card.addEventListener("click", () => this.startNewGame(card.getAttribute("data-fac")));
  },
  // mode "load" (click a used slot → resume) or "overwrite" (all slots full on
  // NEW GAME → click any slot to claim it for this._pendingFaction, confirmed)
  renderTitleSlots(mode) {
    this._titleSlotMode = mode;
    const head = document.getElementById("titleSlotsHead");
    if (head) head.textContent = mode === "overwrite" ? "ALL SLOTS FULL — OVERWRITE ONE" : "LOAD GAME";
    const row = document.getElementById("titleSlotRow"); if (!row) return;
    const meta = this.readSlotsMeta();
    let html = "";
    for (let n = 1; n <= SAVE_SLOTS; n++) {
      const used = this.slotUsed(n), m = meta[n];
      if (!used) {
        html += '<div class="titleCard' + (mode === "load" ? " empty" : "") + '" data-slot="' + n + '">' +
          '<div class="tsSlotLbl">SLOT ' + n + '</div><div class="tcBlurb">EMPTY<br>— no pilot on record —</div></div>';
        continue;
      }
      const fac = TITLE_FACTIONS.find(f => m && f.key === m.faction);
      const isMerc = !!(m && m.mercenary);
      html += '<div class="titleCard" data-slot="' + n + '">' +
        '<div class="tsSlotLbl">SLOT ' + n + '</div>' +
        (fac ? '<img src="' + fac.icon + '" alt="">' : "") +
        '<div class="tcName" style="color:' + (isMerc ? "#9fd36a" : (fac ? fac.color : "#c7d2e0")) + '">' +
        (isMerc
          ? (fac ? '<s style="opacity:0.4">' + fac.name + '</s> ' : '') + 'FREELANCE'
          : (fac ? fac.name : "UNALIGNED")) + '</div>' +
        (m ? '<div class="tsRow"><span>CREDITS</span><b>' + (m.credits || 0).toLocaleString() + '</b></div>' +
             '<div class="tsRow"><span>LEVEL</span><b>' + (m.level || 1) + '</b></div>' +
             '<div class="tsRow"><span>OUTPOSTS</span><b>' + (m.outpostsOwned || 0) + '</b></div>' +
             '<div class="tsRow"><span>TERRITORIES</span><b>' + (m.territoriesHeld || 0) + '/' + REGIONS.length + '</b></div>' +
             '<div class="tsRow"><span>TIME</span><b>' + this.fmtTimePlayed(m.timePlayed || 0) + '</b></div>' +
             '<div class="tsDate">' + (m.lastSaved ? new Date(m.lastSaved).toLocaleString() : "") + '</div>'
           : '<div class="tcBlurb">— save data —</div>');
      html += '</div>';
    }
    row.innerHTML = html;
    for (const card of row.querySelectorAll("[data-slot]")) {
      const n = +card.getAttribute("data-slot"), used = this.slotUsed(n);
      if (mode === "load") {
        if (used) card.addEventListener("click", () => this._loadSlot(n));
      } else {
        card.addEventListener("click", () => {
          if (used && !confirm("Overwrite slot " + n + "? Its save will be lost.")) return;
          this._beginRun(this._pendingFaction, n);
        });
      }
    }
  },
  wireTitleDOM() {
    if (HEADLESS || typeof document === "undefined") return;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    on("titleNew", () => { this.renderTitleFactions(); this._titlePage("factions"); });
    on("titleLoad", () => { this.renderTitleSlots("load"); this._titlePage("slots"); });
    on("titleFacBack", () => { this.renderTitleHome(); this._titlePage("home"); });
    on("titleSlotBack", () => {
      if (this._titleSlotMode === "overwrite") { this.renderTitleFactions(); this._titlePage("factions"); }
      else { this.renderTitleHome(); this._titlePage("home"); }
    });
  },
});
