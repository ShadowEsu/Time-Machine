// Turns a record-demo.mjs take into the site's video, poster and captions (needs ffmpeg).
// Frames keep their real timing, except stretches marked with a speed > 1 (waiting for a check),
// which play faster. Captions come from the recorder's cue markers on the same remapped clock.
// TAKE is the recorder's OUT folder; DEST defaults to site/assets/demo. Run demo-chapters.mjs after.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const TAKE = process.env.TAKE || join(tmpdir(), "tm-demo-take");
const DEST = process.env.DEST || join(repo, "site/assets/demo");
mkdirSync(DEST, { recursive: true });
const { frames, markers } = JSON.parse(readFileSync(join(TAKE, "markers.json"), "utf8"));
if (frames.length < 10) throw new Error(`Too few frames: ${frames.length}`);

// The wall clock (markers) and the screencast clock (frames) are both seconds since the epoch.
const t0 = frames[0].t;
const end = markers.find((m) => m.kind === "end")?.t ?? frames.at(-1).t + 1;
const speeds = markers.filter((m) => m.kind === "speed").map((m) => ({ t: m.t, v: m.value }));
const speedAt = (t) => speeds.filter((s) => s.t <= t).at(-1)?.v ?? 1;
// Video time for a wall time: integrate 1/speed from the first frame.
function vt(t) {
  const cuts = [t0, ...speeds.map((s) => s.t).filter((x) => x > t0 && x < t), t];
  let out = 0;
  for (let i = 0; i < cuts.length - 1; i++) out += (cuts[i + 1] - cuts[i]) / speedAt(cuts[i]);
  return out;
}
const duration = vt(end);

// Concat list: each frame holds until the next one (or the end marker).
const lines = ["ffconcat version 1.0"];
for (let i = 0; i < frames.length; i++) {
  if (frames[i].t > end) break;
  const next = Math.min(frames[i + 1]?.t ?? end, end);
  const d = vt(next) - vt(frames[i].t);
  if (d <= 0) continue;
  lines.push(`file '${join(TAKE, "frames", frames[i].n + ".jpg")}'`, `duration ${d.toFixed(4)}`);
}
// The concat demuxer needs the last file repeated for its duration to count.
lines.push(lines.at(-2));
writeFileSync(join(TAKE, "frames.ffconcat"), lines.join("\n") + "\n");

const enc = (width, crf, name) => execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(TAKE, "frames.ffconcat"),
  "-vf", `scale=${width}:-2:flags=lanczos,fps=30,format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
  "-profile:v", "high", "-tune", "stillimage", "-movflags", "+faststart", "-t", duration.toFixed(3), join(DEST, name)], { stdio: "inherit" });
enc(1920, Number(process.env.CRF || 24), "recovery.mp4");
enc(1280, Number(process.env.CRF_SMALL || 25), "recovery-1280.mp4");

// Captions: one cue per marker, until the next cue.
const cues = markers.filter((m) => m.kind === "cue").map((m) => ({ start: vt(m.t), text: m.value }));
const stamp = (s) => { const ms = Math.max(0, Math.round(s * 1000)); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; };
const vtt = "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(cues[i + 1]?.start ?? duration)}\n${c.text}\n`).join("\n");
writeFileSync(join(DEST, "recovery.en.vtt"), vtt);

// Poster: shortly after the app says Broken, while the camera is on the headline.
const posterCue = markers.find((m) => m.kind === "cue" && /^Broken/.test(m.value));
const posterT = (posterCue ? vt(posterCue.t) : duration * 0.3) + 2.2;
execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", posterT.toFixed(2), "-i", join(DEST, "recovery.mp4"), "-frames:v", "1", "-vf", "scale=1600:-2:flags=lanczos", "-q:v", "4", join(DEST, "recovery-poster.jpg")], { stdio: "inherit" });

const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration,size", "-of", "json", join(DEST, f)], { encoding: "utf8" }));
const result = { duration, cues: cues.map((c) => ({ start: +c.start.toFixed(3), text: c.text })), main: probe("recovery.mp4"), small: probe("recovery-1280.mp4"), posterAt: posterT };
writeFileSync(join(TAKE, "encode-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ duration: +duration.toFixed(2), cues: cues.length, mainBytes: result.main.format.size, smallBytes: result.small.format.size, main: `${result.main.streams[0].width}x${result.main.streams[0].height}` }));
