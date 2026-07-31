/*=== HARNESS:BATTLE_UI ======================================================*/
// Title BATTLE entry + dock #battlePanel (match browser / results / AI tier).
// Flow: Title → Sandbox|Career → slot → HUB (fit/store/hangar) → Matches → fight.
// Sandbox: 3 profile slots, store, all ships unlocked, 100k start.
// Career: snapshot of campaign save, loadout/hangar free, no store, no writeback.
Object.assign(GAME, {
  _battleDOM() {
    if (HEADLESS || typeof document === "undefined") return null;
    if (this._bt) return this._bt;
    const $ = id => document.getElementById(id);
    const panel = $("battlePanel");
    if (!panel) return null;
    this._bt = {
      panel,
      body: $("btBody"),
      title: $("btTitle"),
      _shown: false,
    };
    return this._bt;
  },

  syncBattleDOM() {
    const dm = this._battleDOM(); if (!dm) return;
    const s = this.state;
    const show = !!(this.isBattle() && s.docked && s.dockTab === "battle");
    dm.panel.classList.toggle("show", show);
    if (!show) { dm._shown = false; return; }
    this._syncDockTabs(dm.panel);
    if (!dm._shown) { dm._shown = true; this.renderBattlePanel(); }
  },

  renderBattlePanel() {
    const dm = this._battleDOM(); if (!dm || !dm.body) return;
    const s = this.state, b = s.battle;
    dm.body.innerHTML = "";
    if (!b) {
      dm.body.innerHTML = '<div class="ghNote">No battle session.</div>';
      return;
    }
    const isSb = b.lane === "sandbox" || (b.sandboxSlot != null && b.sourceSlot == null);
    const isCr = b.lane === "career" || b.sourceSlot != null;

    if (dm.title) {
      dm.title.textContent = b.phase === "result" ? "MATCH RESULT"
        : b.phase === "hub"
          ? (isSb ? "SANDBOX HUB" : "LADDER HUB")
          : "BATTLE";
    }

    // ---- RESULT ----
    if (b.phase === "result" && b.result) {
      const r = b.result;
      const box = document.createElement("div");
      box.className = "btResult " + (r.won ? "win" : "loss");
      const diff = b.aiDifficulty ? ((this.battleAiProfile(b.aiDifficulty) || {}).label || b.aiDifficulty) : "";
      box.innerHTML = "<h3>" + (r.won ? "★ VICTORY" : "✖ DEFEAT") + "</h3>"
        + "<p>" + (r.summary || "") + "</p>"
        + "<p class='btMeta'>" + (r.winner ? ("Winner " + r.winner + " · ") : "")
        + (r.hullKey ? r.hullKey + " · " : "")
        + (diff ? "AI " + diff + " · " : "")
        + "EHP " + (r.p1Ehp || 0) + " vs " + (r.p2Ehp || 0) + "</p>";
      dm.body.appendChild(box);
      const row = document.createElement("div");
      row.className = "btRow";
      const again = document.createElement("button");
      again.className = "ghBtn go";
      again.textContent = "BACK TO HUB";
      again.addEventListener("click", () => this.battleBackFromResult());
      row.appendChild(again);
      const rematch = document.createElement("button");
      rematch.className = "ghBtn";
      rematch.textContent = "REMATCH";
      rematch.addEventListener("click", () => {
        const kind = b.kind || "dm_1x1";
        this.startBattleMatch(kind, {
          economy: "session",
          aiDifficulty: b.aiDifficulty || "normal",
        });
        this.syncBattleDOM();
      });
      row.appendChild(rematch);
      dm.body.appendChild(row);
      return;
    }

    // ---- HUB HEADER ----
    const laneNote = document.createElement("div");
    laneNote.className = "ghNote";
    if (isSb) {
      laneNote.textContent = "SANDBOX · slot " + (b.sandboxSlot || "?")
        + " · " + Math.round(s.credits || 0).toLocaleString() + " cr"
        + " · all ships unlocked · store open · profile auto-saves";
    } else if (isCr) {
      laneNote.textContent = "LADDER · career slot " + (b.sourceSlot || "?")
        + " snapshot · refit freely · no store · changes never write the campaign save";
    } else {
      laneNote.textContent = "Battle session.";
    }
    dm.body.appendChild(laneNote);

    // Sandbox: save / wipe
    if (isSb && b.phase === "hub") {
      const sbRow = document.createElement("div");
      sbRow.className = "btRow";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "ghBtn go";
      saveBtn.textContent = "SAVE PROFILE";
      saveBtn.addEventListener("click", () => {
        if (this.saveSandboxSession) this.saveSandboxSession({});
      });
      sbRow.appendChild(saveBtn);
      const wipeBtn = document.createElement("button");
      wipeBtn.type = "button";
      wipeBtn.className = "ghBtn";
      wipeBtn.textContent = "RESET 100k";
      wipeBtn.title = "Wipe this sandbox slot and start fresh with 100k credits";
      wipeBtn.addEventListener("click", () => {
        if (!confirm("Reset sandbox slot " + b.sandboxSlot + " to a fresh 100k profile?")) return;
        const n = b.sandboxSlot;
        if (this.clearSandboxSlot) this.clearSandboxSlot(n);
        this.enterBattleSandboxHub(n, { fresh: true });
      });
      sbRow.appendChild(wipeBtn);
      dm.body.appendChild(sbRow);
    }

    // ---- AI difficulty ----
    const diffHead = document.createElement("div");
    diffHead.className = "flDestHead";
    diffHead.style.marginTop = "10px";
    diffHead.textContent = "P2 AI DIFFICULTY";
    dm.body.appendChild(diffHead);
    const diffRow = document.createElement("div");
    diffRow.className = "btRow";
    const cur = b.aiDifficulty || "normal";
    for (const key of (this.battleAiKeys ? this.battleAiKeys() : ["easy", "normal", "hard", "boss"])) {
      const prof = this.battleAiProfile(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghBtn" + (cur === key ? " go" : "");
      btn.textContent = prof.label || key;
      btn.title = key;
      btn.addEventListener("click", () => {
        this.setBattleAiDifficulty(key);
        this.renderBattlePanel();
      });
      diffRow.appendChild(btn);
    }
    dm.body.appendChild(diffRow);

    // ---- Career opponent (ladder hub) ----
    if (isCr) {
      const cvHead = document.createElement("div");
      cvHead.className = "flDestHead";
      cvHead.style.marginTop = "10px";
      cvHead.textContent = "OPPONENT LOADOUT";
      dm.body.appendChild(cvHead);
      const note2 = document.createElement("div");
      note2.className = "ghNote";
      note2.textContent = b.p2SourceSlot != null
        ? ("P2 = career slot " + b.p2SourceSlot + (b.p2SourceSlot === b.sourceSlot ? " (ghost — same fit)" : ""))
        : "Default: P2 clones your hub fit (even match). Pick another career slot to fight that loadout.";
      dm.body.appendChild(note2);
      const slotRow = document.createElement("div");
      slotRow.className = "btRow";
      for (let n = 1; n <= (typeof SAVE_SLOTS !== "undefined" ? SAVE_SLOTS : 3); n++) {
        if (!this.slotUsed(n)) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ghBtn" + (b.p2SourceSlot === n ? " go" : "");
        btn.textContent = (n === b.sourceSlot ? "GHOST " : "SLOT ") + n;
        btn.addEventListener("click", () => {
          b.p2SourceSlot = n;
          b.careerVsCareer = true;
          this.renderBattlePanel();
        });
        slotRow.appendChild(btn);
      }
      const cloneBtn = document.createElement("button");
      cloneBtn.type = "button";
      cloneBtn.className = "ghBtn" + (b.p2SourceSlot == null ? " go" : "");
      cloneBtn.textContent = "EVEN CLONE";
      cloneBtn.addEventListener("click", () => {
        b.p2SourceSlot = null;
        b.careerVsCareer = false;
        this.renderBattlePanel();
      });
      slotRow.appendChild(cloneBtn);
      dm.body.appendChild(slotRow);
    }

    // ---- Match cards (identical for both lanes) ----
    const matchHead = document.createElement("div");
    matchHead.className = "flDestHead";
    matchHead.style.marginTop = "12px";
    matchHead.textContent = "MATCHES — pick one to launch";
    dm.body.appendChild(matchHead);
    const fitHint = document.createElement("div");
    fitHint.className = "ghNote";
    fitHint.textContent = isSb
      ? "Use Loadout · Store · Ships · Hangar tabs first, then launch."
      : "Use Loadout · Ships · Hangar tabs to tune the snapshot, then launch.";
    dm.body.appendChild(fitHint);

    const mk = (kind, label, blurb) => {
      const card = document.createElement("button");
      card.className = "btMatchCard";
      card.type = "button";
      card.innerHTML = "<div class='btMatchName'>" + label + "</div>"
        + "<div class='btMatchBlurb'>" + blurb + "</div>";
      card.addEventListener("click", () => {
        this.startBattleMatch(kind, {
          economy: "session",
          aiDifficulty: b.aiDifficulty || "normal",
        });
        this.syncBattleDOM();
      });
      dm.body.appendChild(card);
    };
    mk("dm_1x1", "DEATHMATCH 1×1", "Pure duel · arm skills · radar pings · kill P2 · 10 min");
    mk("ctrl_2x2", "CONTROL 2×2 · QUICK", "Capture · fortify · hunting drones · vision · 10 min");
    mk("ctrl_3x3", "CONTROL 3×3 · LONG", "Big DOTA map · more outposts · strategy · 20 min");

    const online = document.createElement("button");
    online.className = "btMatchCard dim";
    online.type = "button";
    online.innerHTML = "<div class='btMatchName'>ONLINE 1v1</div>"
      + "<div class='btMatchBlurb'>Game Center PVP — coming later</div>";
    online.addEventListener("click", () => this.startOnlineBattle());
    dm.body.appendChild(online);

    const row = document.createElement("div");
    row.className = "btRow";
    const back = document.createElement("button");
    back.className = "ghBtn";
    back.textContent = "EXIT TO TITLE";
    back.addEventListener("click", () => this.exitBattleToTitle());
    row.appendChild(back);
    dm.body.appendChild(row);
  },

  wireBattleDOM() {
    if (HEADLESS || typeof document === "undefined") return;
    const dm = this._battleDOM(); if (!dm) return;
    dm.panel.querySelectorAll(".ghTab").forEach(btn => {
      btn.addEventListener("click", () => this.setDockTab(btn.dataset.tab));
    });
    const undock = document.getElementById("btUndock");
    if (undock) undock.addEventListener("click", () => {
      if (this.isBattleHub() || (this.state.battle && this.state.battle.phase === "result")) {
        // Stay in hub menu — "Close" just keeps you docked on Matches
        this.state.dockTab = "battle";
        this.renderBattlePanel();
      } else {
        input.closeMenu = true;
      }
    });
    const exit = document.getElementById("btExit");
    if (exit) exit.addEventListener("click", () => this.exitBattleToTitle());
  },
});
