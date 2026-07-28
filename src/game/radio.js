/*=== HARNESS:RADIO ===========================================================*/
// Fallout-style cockpit radio: always available, toggle on/off, cycle channels.
// Context chatter prints as a bottom-right scrolling log while you fly — companion
// VO, job dispatch, local berth traffic, and ambient lane noise. Gameplay toasts
// (tractor full, DPS, pickups) also stream here so they don't paint over vitals.
//
// Controls: T toggle · Y cycle channel · speaker/CH/expand on the radio footer.
// Expand opens a scrollable history panel (#radioLogPanel).
// Persist: radioOn + radioChannel only (log is session).

const RADIO = {
  logMax: 12,              // compact HUD shows the newest few (drawn upward)
  archiveMax: 120,         // scrollable history in the expand panel
  lineLife: 22,            // seconds before a line fades from the compact HUD
  ambientCd: 18,
  channels: [
    { id: "all",       name: "ALL BAND",   col: "#9fd36a", short: "ALL" },
    { id: "companion", name: "COMPANION",  col: "#ffb45e", short: "CMP" },
    { id: "dispatch",  name: "DISPATCH",   col: "#57e6ff", short: "DSP" },
    { id: "local",     name: "LOCAL NET",  col: "#c8a96e", short: "LOC" },
    { id: "traffic",   name: "TRAFFIC",    col: "#b48aff", short: "TRF" },
  ],
};

Object.assign(GAME, {
  initRadio(s) {
    s = s || this.state;
    s.radioOn = s.radioOn !== false;
    s.radioChannel = s.radioChannel | 0;
    if (s.radioChannel < 0 || s.radioChannel >= RADIO.channels.length) s.radioChannel = 0;
    s._radioLog = [];
    s._radioArchive = [];
    s._radioCd = {};
    s._radioAmbientT = 4;
    s._radioLastRegion = null;
    s._radioLastDanger = null;
    s.radioExpanded = false;
  },

  radioChannelMeta(idx) {
    return RADIO.channels[idx | 0] || RADIO.channels[0];
  },

  toggleRadio() {
    const s = this.state;
    s.radioOn = !s.radioOn;
    if (typeof toast === "function")
      toast(s.radioOn ? "◎ RADIO ON — " + this.radioChannelMeta(s.radioChannel).name : "◎ RADIO OFF",
        s.radioOn ? "#9fd36a" : "#7f8ea6", 1.6, { hud: true });
    if (typeof sfx === "function") sfx(s.radioOn ? "buy" : "drop");
    if (this.saveGame) this.saveGame();
  },

  cycleRadioChannel(dir) {
    const s = this.state;
    const n = RADIO.channels.length;
    s.radioChannel = ((s.radioChannel | 0) + (dir || 1) + n * 8) % n;
    const ch = this.radioChannelMeta(s.radioChannel);
    if (typeof toast === "function") toast("◎ CH · " + ch.name, ch.col, 1.4, { hud: true });
    if (typeof sfx === "function") sfx("grab");
    this.radioPush("system", "— tuned " + ch.name + " —", ch.col, true);
    if (this.saveGame) this.saveGame();
  },

  // Push a line if radio is on and channel filter allows it.
  radioPush(channelId, text, col, forceShow) {
    const s = this.state;
    if (!s || !text) return false;
    if (!s.radioOn && !forceShow) return false;
    const chMeta = RADIO.channels.find(c => c.id === channelId) || RADIO.channels[0];
    const active = this.radioChannelMeta(s.radioChannel);
    if (active.id !== "all" && channelId !== "system" && channelId !== active.id) return false;
    if (!s._radioLog) s._radioLog = [];
    if (!s._radioArchive) s._radioArchive = [];
    const tag = channelId === "system" ? "SYS" : (chMeta.short || channelId.slice(0, 3).toUpperCase());
    const entry = {
      tag, text: String(text),
      col: col || chMeta.col || "#e8edf4",
      age: 0,
      t: Date.now(),
    };
    s._radioLog.push(entry);
    while (s._radioLog.length > RADIO.logMax) s._radioLog.shift();
    s._radioArchive.push({ tag: entry.tag, text: entry.text, col: entry.col, t: entry.t });
    while (s._radioArchive.length > RADIO.archiveMax) s._radioArchive.shift();
    return true;
  },

  radioSay(channelId, text, col) {
    return this.radioPush(channelId, text, col, false);
  },

  // Gameplay feed (toast mirror) — always archives; shows when radio is on.
  radioFeed(text, col) {
    const s = this.state;
    if (!s || text == null || text === "") return false;
    if (!s._radioLog) this.initRadio(s);
    const bright = col || "#e8edf4";
    if (!s.radioOn) {
      // Still archive so expand history is complete when they open radio later
      if (!s._radioArchive) s._radioArchive = [];
      s._radioArchive.push({ tag: "SYS", text: String(text), col: bright, t: Date.now() });
      while (s._radioArchive.length > RADIO.archiveMax) s._radioArchive.shift();
      s._radioLog.push({ tag: "SYS", text: String(text), col: bright, age: 0 });
      while (s._radioLog.length > RADIO.logMax) s._radioLog.shift();
      return true;
    }
    return this.radioPush("traffic", String(text), bright, false)
        || this.radioPush("system", String(text), bright, true);
  },

  radioSayCd(key, channelId, text, col, cdSec) {
    const s = this.state;
    if (!s) return false;
    s._radioCd = s._radioCd || {};
    if ((s._radioCd[key] || 0) > 0) return false;
    if (!this.radioSay(channelId, text, col)) return false;
    s._radioCd[key] = cdSec != null ? cdSec : RADIO.ambientCd;
    return true;
  },

  companionRadioName() {
    const fac = (this.state && this.state.playerFaction) || "krag";
    return ({ krag: "REVA", vex: "CADE", nox: "LIRA" })[fac] || "COMPANION";
  },

  companionRadioAlive() {
    const s = this.state;
    if (!s || !s.playerFaction) return false;
    const vn = this._vnSave ? this._vnSave() : null;
    if (!vn || !vn.seen) return false;
    const fac = s.playerFaction;
    if (!vn.seen[fac + "_comp_intro"]) return false;
    if (vn.seen[fac + "_comp_death"] || vn.seen[fac + "_ending"]) return false;
    return true;
  },

  _companionLine(kind) {
    const fac = (this.state && this.state.playerFaction) || "krag";
    const name = this.companionRadioName();
    const packs = {
      krag: {
        idle: [name + " — Scopes clean. For now.", name + " — Keep the bow into the black."],
        approach: [name + " — On the mark. Hold your vector."],
        clear: [name + " — Hostiles down. Extract clean."],
        fight: [name + " — They're on us. Break left."],
        hull: [name + " — Hull's singing. Don't make it a solo."],
        tow: [name + " — Mass locked. Short leash."],
        story: [name + " — Voss wants results, not excuses."],
      },
      vex: {
        idle: [name + " — Formation holds. Continue.", name + " — File every burn."],
        approach: [name + " — Mark acquired. Hold."],
        clear: [name + " — Contacts eliminated. Report."],
        fight: [name + " — Weapons free. Do not waste shots."],
        hull: [name + " — Integrity yellow. Correct."],
        tow: [name + " — Tow vector clean."],
        story: [name + " — Dren is listening. Fly like it."],
      },
      nox: {
        idle: [name + " — Quiet is data.", name + " — The void measures patience."],
        approach: [name + " — The mark is patient. So are we."],
        clear: [name + " — Silence returns. Good."],
        fight: [name + " — Hostility exceeds model. Adapt."],
        hull: [name + " — Pain is information. Do not discard it."],
        tow: [name + " — Mass accepted."],
        story: [name + " — Sive already knows the ending. Surprise her."],
      },
    };
    const p = packs[fac] || packs.krag;
    const list = p[kind] || p.idle;
    return list[(Math.random() * list.length) | 0];
  },

  updateRadio(dt) {
    const s = this.state;
    if (!s || !s._radioLog) return;
    for (let i = s._radioLog.length - 1; i >= 0; i--) {
      s._radioLog[i].age += dt;
      if (s._radioLog[i].age > RADIO.lineLife) s._radioLog.splice(i, 1);
    }
    if (s._radioCd) {
      for (const k of Object.keys(s._radioCd)) {
        s._radioCd[k] -= dt;
        if (s._radioCd[k] <= 0) delete s._radioCd[k];
      }
    }
    if (!s.radioOn || s.radioExpanded || s.docked || s.onPlanet || s.titleOpen) return;

    // Context one-shots (region enter, danger band, fuel, combat)
    const rid = s.currentRegionId;
    if (rid != null && rid !== s._radioLastRegion) {
      s._radioLastRegion = rid;
      const lbl = this.regionLabel ? this.regionLabel(this.regionGet(rid)) : ("R-" + rid);
      this.radioSayCd("enter_" + rid, "local", "Local net — entering " + lbl + ".", "#c8a96e", 25);
    }
    if (typeof getDangerLevel === "function") {
      const dl = getDangerLevel(s.x, s.y);
      if (dl !== s._radioLastDanger && dl >= 4) {
        s._radioLastDanger = dl;
        this.radioSayCd("danger_" + dl, "traffic",
          "Traffic — SEC " + dl + " corridor. Expect teeth.", "#ff8a8a", 40);
      }
    }
    if (s.fuel < s.fuelMax * 0.18)
      this.radioSayCd("lowfuel", "dispatch", "Dispatch — fuel thin. Find a berth.", "#ffd27a", 30);
    if ((s.tows || []).length >= 3)
      this.radioSayCd("towheavy", "traffic", "Traffic — heavy tow signature on scan.", "#b48aff", 22);
    if (typeof ForgeCombat !== "undefined" && ForgeCombat.isLocked && ForgeCombat.isLocked())
      this.radioSayCd("lock", "traffic", "Traffic — weapons lock painted.", "#ff6b6b", 12);
    const hostiles = (s.aliens || []).filter(a => a && a.state !== "DEAD").length;
    if (hostiles >= 4)
      this.radioSayCd("swarm", "traffic", "Traffic — multiple bogeys in the bubble.", "#ff8a8a", 16);

    if (this.companionRadioAlive && this.companionRadioAlive()) {
      if (s.hp && s.hp.hull < s.hp.hullMax * 0.45)
        this.radioSayCd("comp_hull", "companion", this._companionLine("hull"), "#ffb45e", 20);
      else if (hostiles >= 2)
        this.radioSayCd("comp_fight", "companion", this._companionLine("fight"), "#ffb45e", 18);
      else if ((s.tows || []).length)
        this.radioSayCd("comp_tow", "companion", this._companionLine("tow"), "#ffb45e", 28);
    }

    s._radioAmbientT = (s._radioAmbientT || 0) - dt;
    if (s._radioAmbientT > 0) return;
    s._radioAmbientT = RADIO.ambientCd + Math.random() * 12;
    // Soft ambient line on current channel
    const ch = this.radioChannelMeta(s.radioChannel).id;
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];
    if (ch === "companion" && this.companionRadioAlive && this.companionRadioAlive())
      this.radioSay("companion", this._companionLine("idle"), "#ffb45e");
    else if (ch === "dispatch")
      this.radioSay("dispatch", pick([
        "Dispatch — traffic advisory: watch the belt edge.",
        "Dispatch — unregistered burn signatures on the outer ring.",
        "Dispatch — all units, file tonnage before shift end.",
      ]), "#57e6ff");
    else if (ch === "local")
      this.radioSay("local", pick([
        "Local net — berth fees are up again. Surprise.",
        "Local net — someone sold a sealed crate labeled ore. It wasn't.",
        "Local net — Combine clerks gossip, Dominion clerks file.",
      ]), "#c8a96e");
    else if (ch === "traffic")
      this.radioSay("traffic", pick([
        "Traffic — freighter convoy two sectors coreward.",
        "Traffic — debris field drifting. Reduce relative.",
        "Traffic — quiet band. Don't trust quiet.",
      ]), "#b48aff");
    else if (this.companionRadioAlive && this.companionRadioAlive() && Math.random() < 0.35)
      this.radioSay("companion", this._companionLine("idle"), "#ffb45e");
  },

  radioQuestApproach(q) {
    if (!q) return;
    if (q.kind === "story" && this.companionRadioAlive()) {
      this.radioSay("companion", this._companionLine("approach"), "#ffb45e");
    } else if (q.kind === "merc" && q.mercStationId != null) {
      const f = (typeof STATION_FIXERS !== "undefined" && STATION_FIXERS[q.mercStationId]) || null;
      this.radioSay("dispatch", (f ? f.name : "FIXER") + " — On the mark. Make it count.", "#57e6ff");
    } else if (q.kind === "merc") {
      this.radioSay("dispatch", "Dispatch — Site live. Work clean.", "#57e6ff");
    } else {
      this.radioSay("dispatch", "Dispatch — Objective range. Complete the work.", "#57e6ff");
    }
  },

  radioQuestClear(q) {
    if (this.companionRadioAlive())
      this.radioSay("companion", this._companionLine("clear"), "#ffb45e");
    else
      this.radioSay("dispatch", "Dispatch — Hostiles down. Extract or hold.", "#7bd88f");
  },

  // ---- Expand panel (DOM scroll history) ----------------------------------
  openRadioLog() {
    if (HEADLESS || typeof document === "undefined") return false;
    const panel = document.getElementById("radioLogPanel");
    const body = document.getElementById("radioLogBody");
    if (!panel || !body) return false;
    const s = this.state;
    if (!s._radioArchive) s._radioArchive = [];
    const lines = s._radioArchive.slice().reverse(); // newest first
    body.innerHTML = lines.length
      ? lines.map(ln =>
          '<div class="rlLine"><span class="rlTag">[' + (ln.tag || "SYS") + ']</span>' +
          String(ln.text || "").replace(/</g, "&lt;") + "</div>").join("")
      : '<div class="rlLine" style="color:#7f8ea6">— no traffic yet —</div>';
    panel.classList.add("show");
    s.radioExpanded = true;
    body.scrollTop = 0;
    return true;
  },
  closeRadioLog() {
    if (HEADLESS || typeof document === "undefined") return;
    const panel = document.getElementById("radioLogPanel");
    if (panel) panel.classList.remove("show");
    if (this.state) this.state.radioExpanded = false;
  },
  wireRadioLogDOM() {
    if (HEADLESS || typeof document === "undefined") return;
    const close = document.getElementById("radioLogClose");
    const panel = document.getElementById("radioLogPanel");
    if (close) close.addEventListener("click", () => this.closeRadioLog());
    if (panel) panel.addEventListener("click", (e) => {
      if (e.target === panel) this.closeRadioLog();
    });
  },

  // ---- HUD ----------------------------------------------------------------
  // Compact feed: messages fill most of the box; footer has 🔊 / CH / ▣ expand.
  // History draws upward (brighter) so more lines are visible on-screen.
  _radioGeom() {
    const k = Math.min(CONFIG.W / 390, CONFIG.H / 700);
    const gb = this.gameButtons();
    // Taller radio panel so more lines fit
    const anchor = (gb && gb.radio) || { x: CONFIG.W - 186, y: CONFIG.H - 118, w: 176, h: 108 };
    const btn = 20;
    const footerH = btn + 6;
    return {
      x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h, k,
      // footer controls along the bottom of the panel
      power:  { x: anchor.x + 4, y: anchor.y + anchor.h - footerH, w: btn, h: btn },
      cycle:  { x: anchor.x + 4 + btn + 3, y: anchor.y + anchor.h - footerH, w: 34, h: btn },
      expand: { x: anchor.x + anchor.w - 4 - btn, y: anchor.y + anchor.h - footerH, w: btn, h: btn },
      logX: anchor.x + 5,
      logW: anchor.w - 10,
      logBottom: anchor.y + anchor.h - footerH - 4,
      logTop: anchor.y + 4,
      footerH,
    };
  },

  _radioWrap(g, text, maxW) {
    const words = String(text || "").split(/\s+/);
    const out = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  },

  drawRadioHUD(g) {
    if (HEADLESS) return;
    const s = this.state;
    if (!s || s.docked || s.onPlanet || s.galaxyMapOpen || s.titleOpen || s.radioExpanded) return;
    if (!s._radioLog) this.initRadio(s);
    const ch = this.radioChannelMeta(s.radioChannel);
    const geo = this._radioGeom();
    const { x, y, w, h, k, power, cycle, expand, logX, logW, logBottom, logTop } = geo;

    // Outer panel (no nested boxes around controls)
    g.fillStyle = "rgba(8,12,20,0.9)";
    g.strokeStyle = s.radioOn ? "rgba(87,230,255,0.45)" : "#3a4558";
    g.lineWidth = 1.2;
    g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill(); g.stroke();

    // ---- Message stack (newest at bottom of message area) ----
    g.font = `${Math.max(8, 9 * k) | 0}px monospace`;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    const maxTextW = logW - 2;
    const lineH = 11 * k;
    const entries = (s._radioLog || []).slice();
    let ty = logBottom;
    // Draw newest first upward; allow climbing well above the panel for history
    const absTop = Math.max(CONFIG.H * 0.22, logTop - 220 * k);
    for (let i = entries.length - 1; i >= 0; i--) {
      const ln = entries[i];
      const fade = Math.max(0.45, 1 - (ln.age || 0) / RADIO.lineLife);
      const wrapped = this._radioWrap(g, ln.text, maxTextW);
      const blockH = wrapped.length * lineH + 2;
      ty -= blockH;
      if (ty < absTop) break;
      g.globalAlpha = fade;
      // soft plate only when above the main box
      if (ty < logTop) {
        g.fillStyle = "rgba(8,12,20,0.82)";
        g.fillRect(logX - 2, ty, logW + 4, blockH);
      }
      let c = ln.col || "#f0f4fa";
      if (c === "#c8d0dc" || c === "#9aa7b8" || c === "#5a6578" || c === "#7f8ea6") c = "#f0f4fa";
      g.fillStyle = c;
      for (let li = 0; li < wrapped.length; li++)
        g.fillText(wrapped[li], logX, ty + 9 + li * lineH);
    }
    g.globalAlpha = 1;

    // ---- Footer controls (no extra framing boxes — icons on the panel) ----
    g.font = `${Math.max(11, 12 * k) | 0}px monospace`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = s.radioOn ? "#e8edf4" : "#5a6578";
    g.fillText(s.radioOn ? "🔊" : "🔇", power.x + power.w / 2, power.y + power.h / 2 + 1);

    g.font = `bold ${Math.max(7, 8 * k) | 0}px monospace`;
    g.fillStyle = s.radioOn ? ch.col : "#5a6578";
    g.fillText(ch.short, cycle.x + cycle.w / 2, cycle.y + cycle.h / 2);

    g.font = `${Math.max(10, 11 * k) | 0}px monospace`;
    g.fillStyle = "#8fd0ff";
    g.fillText("▣", expand.x + expand.w / 2, expand.y + expand.h / 2 + 1);

    g.textAlign = "left"; g.textBaseline = "alphabetic";
  },

  radioHitBoxes() {
    const geo = this._radioGeom();
    return { power: geo.power, cycle: geo.cycle, expand: geo.expand };
  },

  hitRadioHUD(px, py) {
    const hb = this.radioHitBoxes();
    const hit = r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (hit(hb.power)) { this.toggleRadio(); return true; }
    if (hit(hb.cycle)) { this.cycleRadioChannel(1); return true; }
    if (hit(hb.expand)) { this.openRadioLog(); return true; }
    return false;
  },

  // ---- self-test ----------------------------------------------------------
  radioSelfTest() {
    const fails = [];
    const check = (c, m) => { if (!c) fails.push("FAIL: " + m); };
    try {
      this.init();
      const s = this.state;
      this.initRadio(s);
      check(s.radioOn === true, "radio defaults on");
      check(RADIO.channels.length >= 4, "enough channels");

      s.radioChannel = 0;
      check(this.radioSay("dispatch", "test dispatch"), "all hears dispatch");
      check((s._radioLog || []).some(l => l.text === "test dispatch"), "log has line");
      check((s._radioArchive || []).some(l => l.text === "test dispatch"), "archive has line");

      s.radioChannel = 1;
      s._radioLog = [];
      check(!this.radioSay("dispatch", "blocked"), "companion channel filters dispatch");
      check(this.radioSay("companion", "hey"), "companion channel hears companion");

      this.toggleRadio();
      check(s.radioOn === false, "toggle off");
      s._radioLog = [];
      check(this.radioFeed("feed while off"), "feed logs while off");
      check((s._radioArchive || []).some(l => l.text === "feed while off"), "archive keeps feed while off");

      this.toggleRadio();
      check(s.radioOn === true, "toggle back on");
    } catch (e) {
      fails.push("FAIL: radioSelfTest threw: " + (e && e.message));
    }
    return fails;
  },
});
