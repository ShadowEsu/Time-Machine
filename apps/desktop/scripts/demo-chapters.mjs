// Rewrites the home page chapter list from the recording's caption file, so chapters and captions
// can never disagree. Also sets the duration in the recording intro ("N seconds").
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const site = process.env.SITE || resolve(dirname(fileURLToPath(import.meta.url)), "../../../site");
const vtt = readFileSync(`${site}/assets/demo/recovery.en.vtt`, "utf8");
const sec = (s) => { const [h, m, rest] = s.split(":"); return +h * 3600 + +m * 60 + +rest; };
const cues = [...vtt.matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})\n(.+)/g)].map((m) => ({ start: sec(m[1]), end: sec(m[2]), text: m[3].trim() }));
if (cues.length < 3) throw new Error(`Only ${cues.length} cues`);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const items = cues.map((c) => `            <li><button type="button" data-seek="${c.start.toFixed(3)}" data-end="${c.end.toFixed(3)}"><span class="ch-t"><span class="sr-only">Play from </span>${clock(c.start)}</span><span class="ch-x">${esc(c.text)}</span></button></li>`).join("\n");
const file = `${site}/index.html`;
let html = readFileSync(file, "utf8");
const list = /(<ol aria-labelledby="chapters-h" data-chapters>\n)[\s\S]*?(\n\s*<\/ol>)/;
const length = /\b\d+ seconds, captions, no sound\./;
if (!list.test(html) || !length.test(html)) throw new Error("index.html no longer has the chapter list or the length sentence");
const total = Math.round(cues.at(-1).end);
html = html.replace(list, `$1${items}$2`).replace(length, `${total} seconds, captions, no sound.`);
writeFileSync(file, html);
console.log(JSON.stringify({ chapters: cues.length, seconds: total }));
