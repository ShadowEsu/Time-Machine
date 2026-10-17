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
