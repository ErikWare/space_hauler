/*=== HARNESS:AUDIO ==========================================================*/
// Procedural sound engine (Web Audio API — no asset files, everything is
// synthesized). AUDIO.play(name) fires a one-shot; the tractor hum is a loop
// (play() starts it, stop() ends it). The AudioContext unlocks lazily on the
// first user gesture (browser autoplay policy — wired in main.js boot).
// Every entry point fails silently: headless Node has no AudioContext, so the
// whole engine no-ops under the selfTest gate.
const AUDIO = {
  ctx: null, master: null,
  _loops: {},   // name → {osc, gain} for looping sounds (tractor hum)
  _last: {},    // name → last trigger time (guards same-frame stacking)

  // selfTest guard: no AudioContext (headless Node) → every call must no-op
  _available() { return typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined"; },
  // create + resume the context — only ever effective inside a user gesture
  unlock() {
    if (!this._available()) return;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) { this.ctx = null; }
  },
  _ready() {
    if (!this.ctx || this.ctx.state !== "running") return null;   // locked / suspended → silent
    if (typeof GAME !== "undefined" && GAME.state && GAME.state.audioMuted) return null;
    return this.ctx;
  },

  play(name) {
    if (name === "tractor") { this._startLoop("tractor"); return; }
    const ctx = this._ready(); if (!ctx) return;
    const fn = this.SOUNDS[name]; if (!fn) return;
    const t0 = ctx.currentTime;
    if (t0 - (this._last[name] || -1) < 0.05) return;   // multi-hit frames collapse to one trigger
    this._last[name] = t0;
    try { fn(this, t0); } catch (e) {}
  },
  stop(name) {
    const l = this._loops[name]; if (!l) return;
    delete this._loops[name];
    try {
      l.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      l.osc.stop(this.ctx.currentTime + 0.3);
    } catch (e) {}
  },
  stopAll() { for (const k in this._loops) this.stop(k); },
  _startLoop(name) {
    if (this._loops[name]) return;
    const ctx = this._ready(); if (!ctx) return;
    try {
      const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = 180;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.08);   // soft attack, no click
      osc.connect(gain); gain.connect(this.master);
      osc.start();
      this._loops[name] = { osc, gain };
    } catch (e) {}
  },

  // ---- synth building blocks ----
  _env(t0, dur, vol) {   // gain with exponential decay to silence
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(this.master);
    return g;
  },
  _tone(t0, o) {   // {type, f0, f1?, dur, vol} — oscillator with optional pitch sweep
    const osc = this.ctx.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    osc.connect(this._env(t0, o.dur, o.vol));
    osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  },
  _noise(t0, o) {   // {dur, vol, fType?, fr0, fr1?} — white noise through a swept filter
    const len = Math.max(1, (this.ctx.sampleRate * o.dur) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = o.fType || "lowpass";
    f.frequency.setValueAtTime(o.fr0, t0);
    if (o.fr1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.fr1), t0 + o.dur);
    src.connect(f); f.connect(this._env(t0, o.dur, o.vol));
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  },
  _notes(t0, freqs, noteDur, vol, type) {   // sequential melody, notes ring past their slot
    freqs.forEach((f, i) => this._tone(t0 + i * noteDur, { type, f0: f, dur: noteDur * 1.6, vol }));
  },

  // C5 523.25 · E5 659.25 · G5 783.99 · B5 987.77 · C6 1046.50
  SOUNDS: {
    shoot(a, t0)      { a._tone(t0, { type: "sawtooth", f0: 440, f1: 220, dur: 0.05, vol: 0.12 }); },
    hit_shield(a, t0) { a._tone(t0, { type: "sine", f0: 800, dur: 0.10, vol: 0.14 }); },
    hit_armor(a, t0)  { a._noise(t0, { dur: 0.12, vol: 0.16, fr0: 900, fr1: 120 });
                        a._tone(t0, { type: "sine", f0: 200, f1: 90, dur: 0.12, vol: 0.16 }); },
    explosion(a, t0)  { a._noise(t0, { dur: 0.4, vol: 0.30, fr0: 800, fr1: 40 });
                        a._tone(t0, { type: "sine", f0: 120, f1: 35, dur: 0.4, vol: 0.22 }); },
    credits(a, t0)    { a._notes(t0, [523.25, 659.25, 783.99], 0.06, 0.10, "triangle"); },
    dock(a, t0)       { a._tone(t0, { type: "sine", f0: 140, f1: 55, dur: 0.2, vol: 0.18 });
                        a._noise(t0, { dur: 0.2, vol: 0.05, fType: "highpass", fr0: 3000 }); },
    capture(a, t0)    { a._notes(t0, [523.25, 659.25, 783.99, 1046.5], 0.12, 0.09, "square"); },
    warning(a, t0)    { a._tone(t0, { type: "square", f0: 300, dur: 0.10, vol: 0.10 });
                        a._tone(t0 + 0.2, { type: "square", f0: 300, dur: 0.10, vol: 0.10 }); },
    victory(a, t0)    { const arp = [523.25, 659.25, 783.99, 987.77, 1046.5];
                        a._notes(t0, arp, 0.15, 0.11, "triangle");
                        a._notes(t0 + 0.06, arp, 0.15, 0.06, "sine"); },   // delayed 2nd voice ≈ cheap reverb
  },
};

Object.assign(GAME, {
  // Per-frame audio watches — one hook in update() (same pattern as the
  // creditsEarned delta) instead of chasing every damage/tow site. Safe in the
  // headless selfTest: AUDIO no-ops without an AudioContext, and nothing here
  // touches rnd() or state the suite asserts on.
  updateAudio(dt) {
    const s = this.state, h = s.hp;
    // player hit sounds: a layer DECREASING since last frame means damage
    // landed (weapon fire, outpost shots, collisions, rams — regen only adds)
    if (s._auShield == null || s.dead) { s._auShield = h.shield; s._auArmor = h.armor; }
    if (h.shield < s._auShield - 0.5) AUDIO.play("hit_shield");
    else if (h.armor < s._auArmor - 0.5) AUDIO.play("hit_armor");
    s._auShield = h.shield; s._auArmor = h.armor;
    // tractor hum: on while the beam holds anything, off the moment it doesn't
    // (covers grab, release, drop-all, fuel-out auto-drop, and dock deposit)
    if (s.tows.length > 0 && !s.docked && !s.dead) AUDIO.play("tractor");
    else AUDIO.stop("tractor");
    // low-shield alarm, at most once every 5s (timePlayed = monotonic clock)
    if (!s.dead && !s.docked && h.shield < h.shieldMax * 0.2) {
      if (s._auWarnT == null || s.timePlayed - s._auWarnT >= 5) {
        s._auWarnT = s.timePlayed;
        AUDIO.play("warning");
      }
    }
  },
  // HUD speaker toggle — s.audioMuted rides the save blob (save.js whitelist)
  // and also silences the legacy sfx() one-shots in config.js.
  toggleMute() {
    const s = this.state;
    s.audioMuted = !s.audioMuted;
    if (s.audioMuted) AUDIO.stopAll();
    toast(s.audioMuted ? "audio muted" : "audio on");
    if (this.saveGame) this.saveGame();
  },
});
