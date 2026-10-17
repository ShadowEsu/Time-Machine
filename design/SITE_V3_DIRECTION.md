# Site v3 direction

Status: the founder chose concept A, "Editorial", which settles open decisions 1 and 3 below (concept A, ink blue). It is built in `site/` (October 2026). The home page is the editorial page with the hero device (`site/assets/device.js`, `device.css`). For decision 2, the 9 act scroll story moved to its own page, `site/story.html` (`story.js`, `story.css`), linked as "Watch the story", as section 4 suggests. The founder can still move it back. Decision 4, the FAQ wording, is still open, so the FAQ is labelled Draft.

Concepts: `design/concepts/site-v3-a.html` (editorial) and `design/concepts/site-v3-b.html` (instrument). Shared parts are in `design/concepts/site-v3-assets/`. Screenshots at 1440x900 and 390x844 are in `design/concepts/shots/site-v3-*`.

## 1. The founder's brief

- The site is "so far so good" but "a bit basic".
- Keep the launch feel: the power on intro and the 3D device you can hover and turn.
- Add a little colour and a more striking, more serious display face.
- Add more information.
- It must be excellent on phones.
- Animations must not lag on weaker laptops.

## 2. What the best sites do

Read for this pass on 16 October 2026. Fonts come from each site's own CSS or HTML unless marked otherwise.

| Site | Type | Colour | What we take |
|---|---|---|---|
| [Linear](https://linear.app) | Inter Variable. Its CSS also loads Tiempos Headline and Berkeley Mono ([CSS](https://static.linear.app/web/_next/static/css/layout.TfwOB7lY.css)) | Dark, four grey levels, mono uppercase labels | The hero shows real product UI built in HTML, not a screenshot. A script turns on richer effects only on machines with more than 4 CPU cores. Numbered "Fig" sections. |
| [Vercel](https://vercel.com) | Geist, Geist Mono, Geist Pixel as an accent | Greys on `#FAFAFA` or black | A number at the top of every section. A setup guide written for agents. Shimmer effects switch off with reduced motion. |
| [Arc](https://www.arc.net/) | Marlin 800 display, Marlin Soft and Inter ([CSS](https://arc.net/_next/static/css/df28c1bc1b1a6c7d.css)) | One blue, `rgb(49,57,251)` | One idea per section, each with one large visual. |
| [teenage engineering](https://teenage.engineering) | te-20 at weights 100 and 300 (from the HTML). Uppercase display, per [tastekit](https://tastekit.dev/gallery/apps/teenage-engineering) | Black and `#f1f2f2`. Colour only as solid coded blocks, never tints, per tastekit | Rules instead of shadows. Colour as a signal, used in blocks. A device is the brand. |
| [Granola](https://www.granola.ai) | melange body, quadrant loaded ([CSS](https://www.granola.ai/_next/static/css/220e1c6756c5d977.css)) | Warm "oats" neutrals with a green and a yellow | Calm warm paper. Real content inside the mockups. A before, during and after "how it works". A pricing teaser. |
| [Rauno](https://rauno.me) | A custom face, JetBrains Mono, Georgia italics ([CSS](https://rauno.me/_next/static/css/e621362aa87785a2.css)) | Greys plus small yellow, orange, red, blue accents | Headline lines slide up into view with `cubic-bezier(.2,.8,.2,1)`. A minimap of where you are. |
| [Family](https://family.co) | A custom "Family" face for H1, Inter body | White, ink, one link blue. Colour lives in illustrations | The repeated section shape: eyebrow, heading, chips, demo. An FAQ near the end. |

Two patterns recur on every one of these sites:

1. **One display face with character, a quiet body face, and a mono for labels.**
2. **Colour is rare and means something.** It is either one accent or coded blocks, never a gradient wash.

## 3. What to keep

- **The device.** The aluminium instrument with its screen, dial, keys and verdict LED is the brand. Both concepts reuse its geometry and markup from `site/assets/home.css` and `site/index.html` unchanged.
- **Power on.** On load the device rises, the four key lamps test left to right, the screen wakes with "6 save points found", the timeline dots light one by one, and the dial settles. It plays once and takes about 1.3 seconds.
- **Hands on.** The dial turns with a drag or the arrow keys. Rewind steps back one save point. Check replays the recorded verdict and lights the LED. Save and Recover give honest screen messages. Recover only offers a branch after a Works verdict.
- **The pointer tilt** of `site/assets/pages.js`, now on the hero device with a moving sheen across the face.
- **The honest copy.** Every claim in both concepts already appears on the current site or in the README. Nothing new is promised.
- **Verdict colours.** Green and red still mean Works and Broken, and nothing else.

## 4. What to add

### Colour: one accent, used rarely

- **A: ink blue `#1d3bb8`** on warm paper `#f3efe5`. It is used for the primary button, the italic half of the headline, section numbers, the Time Machine bar in the comparison, and the focus ring. Blue cannot be mistaken for a verdict.
- **B: signal orange `#ff6a13`**, taken from the device. It is used for the primary button, the dial pointer, the status LED dot, step numbers and the full stop in the headline. It sits on dark `#0b0b0a` panels with one light aluminium section for the proof.
- **Rule for both:** the accent never sits next to green or red in a way that reads as a verdict. Orange is not a warning. If testing shows people read it as "something is wrong", B should move to the LED amber instead.

### Type: a display face with a point of view

| | Display | Body | Labels | Licence |
|---|---|---|---|---|
| A, editorial | Newsreader, optical size 72, weight 300 to 340, italic for the accent phrase | Inter | Geist Mono | SIL OFL 1.1 |
| B, instrument | Archivo at 62% width and weight 800, uppercase | Archivo at 100% width | Geist Mono | SIL OFL 1.1 |

All fonts are self hosted in `design/concepts/site-v3-assets/fonts/` with their licence files. There are no network font requests. Newsreader and Archivo came from the Fontsource npm packages `@fontsource-variable/newsreader` and `@fontsource-variable/archivo`, version 5.3.0.

- Newsreader has a real optical size axis, so the 150 px headline is sharp and high contrast and the 24 px dek is sturdy.
- Archivo has a width axis, so one 90 KB file covers the condensed display and the normal body.

### Information: the full page order

The concepts build the hero and the next two sections. The full page should run in this order. Each section is one idea with one visual, the pattern shared by Arc and Family.

1. **Hero.** Headline, one sentence, the waitlist button, the Bash gap with its source, the live device, and a strip of four facts.
2. **The problem.** It worked at 10:42, then the agent kept going. Quote the Claude Code docs and show the morning log. (Concept A, section 01.)
3. **The proof.** Broken, Broken, Broken, Works, with the four check cards and the real `tm find-good` output. (Concept B, section 02.)
4. **How it works.** Save, Check, Bring back, each with its real command. (Concept A, section 02.)
5. **Agents supported.** Claude Code hooks and the MCP server are Built. The Mac app is In development. Hook kits for Cursor, Codex and Gemini CLI are Planned. (Concept A, under section 02.)
6. **Spec sheet.** Built, In development, Planned, plus the 128 tests. (Concept B, section 03.)
7. **The receipt.** What came back and what did not. Kept from the current site.
8. **Pricing preview, The Ladder.** Labelled "Planned. Nothing is for sale yet." $9 a month, then $8 from month 7, $7 from month 13, a $6 floor from month 25. Restores are never paywalled. The CLI is free. Students pay half of every step. The current fader stays.
9. **FAQ.** About 8 plain questions, each with a short answer. Proposed questions: Does it replace Git? No. Does it undo database changes? No. Does it store my secrets? No, only key names. Does it push or deploy? No. Does it work without Claude Code? Yes, through the MCP server or by hand. Is it on npm? Not yet. Is the Mac app out? Not yet. What does it cost? Nothing yet. The plan is The Ladder.
10. **Founder and waitlist.** Kept from the current site.

The 9 act scroll story on the current home page can stay as a "Watch the story" page or a section further down. The new hero is no longer pinned, so the page reads fast on a phone.

## 5. Mobile-first rules

The concepts are written phone first. Desktop rules sit in `min-width` media queries.

- **Order on phones:** headline, one sentence, buttons, then the device, then the details. The waitlist button must show on the first screen at 390x844.
- **Text sizes:** 16.5 px body, 11.5 px minimum for mono fine print. The display size scales with the viewport width and never wraps one word per line.
- **Tap targets:** every button and link is at least 44 px tall. The device keys are real buttons with labels, and the Rewind and Check buttons under the device repeat them at full size.
- **No horizontal scroll.** `overflow-x: clip` on the page, the device scales to its box with a `ResizeObserver`, terminal blocks scroll inside themselves. Checked at 390 px in both concepts.
- **Safe areas:** gutters use `env(safe-area-inset-left)`.
- **The device fits its box.** On phones it uses a flatter angle (less Y rotation) so the screen and the dial stay readable.
- **No hover-only information.** Hover adds polish but never hides content.

## 6. Motion budget

Rules from WEB_V2_RESEARCH section 4 still apply: transform and opacity only, native scroll, reveals once.

| Effect | Desktop, fine pointer | Phones and touch | Lite devices | Reduced motion |
|---|---|---|---|---|
| Power on (rise, lamp test, screen wake, dial settle) | 1.2 s, once | Same, once | 0.7 s, once | Off. The device starts awake |
| Pointer tilt and sheen | On. Runs only while the pointer moves, then stops | Off (no hover) | Off | Off |
| Dial drag, key press | On | On | On | On, without the spring |
| Dial hint ring spin | Only while hovering the dial | Off | Off | Off |
| Section reveals | 0.6 s rise of 14 px, once at 15% into view | Same | Same | Shown at once |
| Verdict stamps (B) | Stagger 160 ms, one spring | Same | Same | Shown at once |
| Background effects | None | None | None | None |

- **Lite devices** are detected as `hardwareConcurrency <= 4`, `deviceMemory <= 4`, or Save-Data on. The same idea as Linear's more-than-4-cores check. The class `lite` is set on `<html>`.
- **No scroll handler and no per frame work at rest.** The only animation loop is the tilt, and it ends once the device settles.
- **No `filter: blur()` and no `backdrop-filter`.** The device's table shadow in `site/assets/home.css` used a 28 px blur on a 3D layer. The concepts swap it for a radial gradient, which costs nothing per frame.
- **No infinite animation by default.** The current dial hint spins forever. In v3 it spins only on hover.
- **Budget to hold the live build to:** one 3D object on screen, at most one running loop, and at most two fonts over 50 KB on first paint.

## 7. How the two concepts differ

| | A, editorial | B, instrument |
|---|---|---|
| Feel | A serious paper. Calm, like Granola and a good newspaper | A piece of hardware under a spotlight, like teenage engineering |
| Base | Warm paper, ink rules | Near black panels, one aluminium proof section |
| Headline | "Rewind to *what worked.*" with the second half in blue italic | "REWIND TO WHAT WORKED" condensed, with an orange full stop |
| Section 2 | The problem: the docs quote, the morning log, the comparison bars | The proof: Broken, Broken, Broken, Works, the cards and the real output |
| Section 3 | How it works, and the agents supported | The spec sheet, with the 128 test counter as an LCD |
| Risk | Can read as quiet. Needs the device to carry the energy | Dark can feel heavy for non technical builders. Orange must not read as a warning |

**Recommendation:** A's light paper and serif for the page, with B's proof section, signal orange LED and LCD counter used as moments on the device. If the founder wants one concept as is, A carries the "calm, premium, worth paying for" brief better. B is the stronger launch film.

## 8. Checks run on the concepts

Run with Playwright on Chromium against a local static server, at 1440x900 and 390x844, with and without reduced motion:

- Both concepts render with their self hosted fonts loaded (Newsreader, Inter, Geist Mono for A; Archivo, Geist Mono for B).
- No horizontal overflow at any scroll position, at either width.
- No console errors, page errors or failed requests.
- Pressing Rewind three times then Check moves the screen to cp-0003 and lights the LED for Works, in both concepts.

Not checked yet: Safari and Firefox, a real phone, and frame timing on a real low-end laptop.

## 9. Open decisions for the founder

1. A, B, or the mix in section 7.
2. Whether the 9 act scroll story stays on the home page or moves to its own page.
3. The accent colour. It changes WEBSITE_SPEC 9.0, which says colour is for verdicts only.
4. The FAQ wording. Every answer needs a person to approve it before it goes live.
