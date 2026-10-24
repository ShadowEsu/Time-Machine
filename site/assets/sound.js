/* Original procedural sound. No downloads, no audio context before a gesture, no stored consent. */
(() => {
  "use strict";
  const buttons = [...document.querySelectorAll("[data-sound]")];
  const ambience = [...document.querySelectorAll("[data-ambient]")];
  let context = null, enabled = false, ambient = false, last = 0, pending = false, activation = 0;
  const voices = new Set(), drones = new Set();
  function update() {
    buttons.forEach(b => { b.setAttribute("aria-pressed", String(enabled)); (b.querySelector(".snd-l") || b).textContent = enabled ? "Sound on" : "Sound off"; });
    ambience.forEach(b => { b.setAttribute("aria-pressed", String(ambient)); b.textContent = ambient ? "Ambience on" : "Ambience off"; b.hidden = !enabled; });
  }
  function stop(set) { for (const voice of set) { try { voice.stop(); } catch (_) {} voice.disconnect(); } set.clear(); }
  function mute() { activation++; pending = false; enabled = false; ambient = false; stop(voices); stop(drones); if (context && context.state === "running") context.suspend(); update(); }
  function tone(from, to, length, volume, type = "sine", delay = 0, group = voices) {
    if (!enabled || !context || context.state !== "running" || document.hidden) return;
    const osc = context.createOscillator(), gain = context.createGain(), now = context.currentTime + delay;
    osc.type = type; osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(to, now + length);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + Math.min(.015, length / 4)); gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.connect(gain).connect(context.destination); group.add(osc);
    osc.onended = () => { group.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(now); osc.stop(now + length + .02);
  }
  function cue(kind) {
    if (!enabled || document.hidden || performance.now() - last < 45) return;
    last = performance.now();
    if (kind === "failure") tone(150, 65, .23, .045, "triangle");
    else if (kind === "rewind") tone(880, 95, .55, .035, "triangle");
    else if (kind === "success") { tone(392, 392, .2, .035); tone(587.33, 587.33, .3, .025, "sine", .12); }
    else tone(1600, 400, .025, .025, "triangle");
  }
  buttons.forEach(b => b.addEventListener("click", async () => {
    if (enabled || pending) { mute(); return; }
    pending = true; const token = ++activation;
    try {
      if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
      await context.resume();
      if (token !== activation) return;
      pending = false;
      if (document.hidden) { mute(); return; }
      enabled = context.state === "running"; update(); cue("detent");
    } catch (_) { mute(); b.textContent = "Sound unavailable"; }
  }));
  ambience.forEach(b => b.addEventListener("click", () => {
    if (!enabled) return;
    ambient = !ambient; stop(drones);
    if (ambient) {
      // Oscillators are the loop. Mute and visibility changes stop and disconnect them.
      for (const [frequency, volume] of [[98, .008], [146.83, .005]]) {
        const osc = context.createOscillator(), gain = context.createGain();
        osc.frequency.value = frequency; gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(volume, context.currentTime + 1);
        osc.connect(gain).connect(context.destination); drones.add(osc);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        osc.start();
      }
    }
    update();
  }));
  document.addEventListener("visibilitychange", () => { if (document.hidden) mute(); });
  addEventListener("pagehide", mute);
  window.TMSound = { cue, mute };
  update();
})();

/* Home music: generative ambient made with Web Audio oscillator, gain, filter and convolver nodes (no audio files,
   no worklet). Off by default. Only a press on the music button (or the intro's "Enter with sound") creates or
   resumes the AudioContext; a remembered "on" just waits for that press. Fades in over 1 s and out over 0.6 s,
   pauses when the tab is hidden, and remembers the volume and the on/off choice in localStorage. */
(() => {
  "use strict";
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !document.body || !document.body.classList.contains("home")) return;
  const KEY = "tm-music";
  let pref = { on: false, vol: .5 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s.vol === "number") pref = { on: !!s.on, vol: Math.min(1, Math.max(0, s.vol)) };
  } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (_) {} };

  const dock = document.createElement("aside");
  dock.className = "mus";
  dock.setAttribute("aria-label", "Music");
  dock.innerHTML =
    '<div class="mus-pop" id="mus-pop" hidden>' +
      '<p class="mus-h">Ambient music</p>' +
      '<button type="button" class="mus-tog"><span class="mus-sw" aria-hidden="true"><i></i></span><span class="mus-tl">Play music</span></button>' +
      '<div class="mus-vol"><label for="mus-range">Volume</label><output for="mus-range"></output></div>' +
      '<input class="mus-range" id="mus-range" type="range" min="0" max="100" step="5">' +
    "</div>" +
    '<button type="button" class="mus-btn" aria-expanded="false" aria-controls="mus-pop" aria-label="Music and volume">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/><path d="M13 7a4 4 0 0 1 0 6M15.2 4.8a7 7 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '<span class="mus-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
    "</button>";
  const skip = document.querySelector("body > a.skip");
  if (skip) skip.after(dock); else document.body.prepend(dock);   // early in the Tab order, with the header
  const pop = dock.querySelector(".mus-pop"), btn = dock.querySelector(".mus-btn"), tog = dock.querySelector(".mus-tog");
  const label = dock.querySelector(".mus-tl"), range = dock.querySelector(".mus-range"), out = dock.querySelector("output");

  // ---- the music ----
  const BEAT = 60 / 64;
  const CHORDS = [[50, 54, 57, 61, 64], [47, 50, 54, 57, 61], [43, 47, 50, 54, 57], [45, 52, 57, 59, 61]]; // Dmaj9 Bm9 Gmaj9 A6/9
  const BELLS = [74, 76, 78, 81, 83, 86];                                                                  // D major pentatonic
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let ctx = null, master, bus, verb, padFilter, timer = 0, next = 0, beat = 0, playing = false, stopTimer = 0;
  const level = () => pref.vol * pref.vol * .8;

  function build() {
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    // A long, dark room: a decaying noise impulse computed here, fed to a convolver.
    const len = Math.round(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = .5; verb.connect(wet).connect(master);
    bus = ctx.createGain(); bus.gain.value = .8; bus.connect(master); bus.connect(verb);
    // Pads breathe through one low-pass whose cutoff drifts slowly.
    padFilter = ctx.createBiquadFilter(); padFilter.type = "lowpass"; padFilter.frequency.value = 900; padFilter.Q.value = .6; padFilter.connect(bus);
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = .045; depth.gain.value = 520;
    lfo.connect(depth).connect(padFilter.frequency); lfo.start();
    ctx.onstatechange = render;
  }
  function voice(type, freq, detune, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.connect(g).connect(dest);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    return [o, g];
  }
  function pad(chord, t, dur) {
    for (const m of chord) for (const d of [-7, 7]) {
      const [o, g] = voice("sawtooth", hz(m), d + Math.random() * 4 - 2, padFilter);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.016, t + 2.6);
      g.gain.setValueAtTime(.016, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 3);
      o.start(t); o.stop(t + dur + 3.05);
    }
  }
  function pluck(type, m, t, v, decay, dest) {
    const [o, g] = voice(type, hz(m), 0, dest);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + decay);
    o.start(t); o.stop(t + decay + .05);
  }
  function schedule() {
    while (next < ctx.currentTime + .5) {
      const chord = CHORDS[Math.floor(beat / 8) % CHORDS.length], step = beat % 8;
      if (step === 0) pad(chord, next, 8 * BEAT);
      pluck("sine", chord[0] - 12, next, step % 2 ? .07 : .12, 1.1, bus);               // the gentle pulse
      if (Math.random() < .3) pluck("sine", BELLS[Math.floor(Math.random() * BELLS.length)], next + (Math.random() < .5 ? 0 : BEAT / 2), .035, 2.6, verb);
      next += BEAT; beat++;
    }
  }
  // A soft tick when the pinned hero reaches each save-point beat (machine.js marks the subtitle .on).
  function tick() {
    if (!playing || !ctx || ctx.state !== "running") return;
    const [o, g] = voice("triangle", 1760, 0, bus), t = ctx.currentTime;
    o.frequency.exponentialRampToValueAtTime(880, t + .08);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.03, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
    o.start(t); o.stop(t + .14);
  }
  if ("MutationObserver" in window) {
    const mo = new MutationObserver((list) => { for (const m of list) if (m.target.classList.contains("on") && !(m.oldValue || "").split(" ").includes("on")) tick(); });
    document.querySelectorAll("[data-sub]").forEach((s) => mo.observe(s, { attributes: true, attributeFilter: ["class"], attributeOldValue: true }));
  }

  function ramp(to, secs) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(to, now + secs);
  }
  // Called only from click handlers, so the AudioContext is created and resumed inside a user gesture.
  function play() {
    clearTimeout(stopTimer);
    if (!ctx) build();
    playing = true; pref.on = true; save();
    ctx.resume().then(() => {
      if (!playing || ctx.state !== "running") return render();
      ramp(level(), 1);
      if (!timer) { beat = Math.ceil(beat / 8) * 8; next = ctx.currentTime + .08; schedule(); timer = setInterval(schedule, 200); }
      render();
    }, () => { playing = false; render(); });
    render();
  }
  function pause(remember) {
    playing = false;
    if (remember) { pref.on = false; save(); }
    clearInterval(timer); timer = 0;
    if (ctx) {
      ramp(0, .6);
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (!playing && ctx.state === "running") ctx.suspend(); }, 700);
    }
    render();
  }

  // ---- the controls ----
  function render() {
    const on = playing && !!ctx && ctx.state === "running";   // the label follows the real context state
    dock.classList.toggle("is-on", on);
    label.textContent = on ? "Pause music" : "Play music";
  }
  function showVol() {
    const v = Math.round(pref.vol * 100);
    range.value = String(v); out.textContent = v + "%"; range.setAttribute("aria-valuetext", v + "%");
  }
  function setOpen(open, focusBtn) {
    pop.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (!open && focusBtn) btn.focus();
  }
  btn.addEventListener("click", () => setOpen(pop.hidden));
  tog.addEventListener("click", () => { if (playing) pause(true); else play(); });
  range.addEventListener("input", () => {
    pref.vol = Number(range.value) / 100; save(); showVol();
    if (playing && ctx) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(level(), ctx.currentTime, .05); }
  });
  dock.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { e.preventDefault(); setOpen(false, true); } });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !dock.contains(e.target)) setOpen(false); });
  dock.addEventListener("focusout", (e) => { if (e.relatedTarget && !dock.contains(e.relatedTarget)) setOpen(false); });
  const enter = document.querySelector("[data-intro-sound]");
  if (enter) { enter.hidden = false; enter.addEventListener("click", play); }
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) pause(false); });
  addEventListener("pagehide", () => { if (playing) pause(false); });
  showVol(); render();
})();
