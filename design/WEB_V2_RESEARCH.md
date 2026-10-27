# Website v2 research: an animated, story-led landing page

Status: research for the next site build. Nothing here is implemented. October 2026.

## 0. Sources and limits

- **supaste.com, fixaplan.com, unvibe.site, apple.com** were blocked by the session proxy: no live browser, screenshots or computed styles. Page text came via Exa. Fonts, styles and builders came from A1 Gallery, One Page Love, Framer Gallery, DesignMD, Contra and Behance.
- **anthropic.com** values are measured from its real stylesheet (fetched via Exa). **Apple** notes are from memory.
- **Not measured** on Supaste or Fixa: px type scale, animation timing, easing. Numbers below are our recommendation.
- **Fixa's colour is unverified.** DesignMD lists `#0000ee`, which is the browser default link colour (our unstyled fetch of anthropic.com showed the same `rgb(0,0,238)`). Treat it as a scrape artifact.

## 1. What the reference sites do

### Supaste (Solt Wagner, Framer)

- **Look:** Instrument Serif display, Inter body. White and black with blue and light-blue gradients, glass, parallax, big type, looping product demos.
- **Beats:** serif hero "Copy once. / Reuse anytime." · one sentence · "Download for macOS" · three trust lines ("One-time purchase", "Fully offline and privacy", "macOS Sonoma 14.0 or later") · Mac notch mockup · award badges · 12 feature chips · feature blocks, each with a looping demo, named testimonials between · 6 persona grid · one pricing card · 15 question FAQ · footer listing the maker's other apps.
- **Take:** serif headline with sans body, product as hero, a short loop per feature, plain trust lines under the CTA.
- **Skip:** "5 spots left" and a $29 price struck through to $15. Scarcity and anchoring are banned by EXPERIENCE 8.

### Fixa (Midu Studio, Framer, built 24 to 30 Jan 2026)

- **Look:** Switzer (Fontshare, not on Google Fonts), white, black, a blue accent.
- **Beats:** intro words "Now is the time." then "Fixa." · hero "Plan your day, without overwhelm" · "Join the waitlist" · problem chart vs "Fixa is designed differently" · three benefit cards · four tab feature switcher · AI chat demo with next step chips · honest FAQ ("Does Fixa replace therapy? No.") · giant "Fixa." footer wordmark.
- **Take:** calm copy, one next step, the "Does it replace X? No." FAQ, the tab switcher.
- **Skip:** unsourced "Anxiety 80%" figures and a streak next to "Zero guilt" (research 31, section 34).

### Anthropic (measured). Three things to borrow

1. **Serif for reading, sans for display.** Paragraphs in Anthropic Serif, 18 to 20 px, line height 1.4 to 1.5. Display in Anthropic Sans 500 to 600, tracking -0.02em, line height 1 to 1.1, fluid sizes such as `clamp(3rem, 2.39rem + 2.61vw, 5rem)`.
2. **Warm neutrals.** Ivory `#faf9f5`, `#f0eee6`, slate `#141413`, muted `#5e5d59`, borders at slate 10 percent. Clay `#d97757` used sparingly.
3. **Strict grid.** Max width 89.5rem, 12 columns, margin `clamp(2rem, ..., 5rem)`, leading trim per font.

### Apple (from memory). Three things to borrow

1. **One idea per pinned scene.** Scroll scrubs one object while a short headline sits beside it.
2. **Sticky local nav** with the product name and one CTA.
3. **Every claim footnoted**, collected at the page bottom. Fits our "say what's not captured" rule.

## 2. Design tokens

**Fonts, all on Google Fonts:**

- **Instrument Serif** 400 and italic, for headlines. This is Supaste's own font.
- **Inter** 400 to 600 with optical sizing, for body and UI.
- **Geist Mono** 400 to 500, for commands, IDs and labels.
- Closest free match to Fixa's Switzer: **Inter Tight** 500.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:opsz,wght@14..32,400..600&family=Geist+Mono:wght@400..500&display=swap">
```

```css
:root {
  --font-display: "Instrument Serif", Georgia, serif;
  --font-body: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, Menlo, monospace;

  /* type scale: size / line height / tracking */
  --fs-hero: clamp(52px, 4rem + 4.5vw, 112px);  --lh-hero: 0.98; --ls-hero: -0.02em;   /* serif 400 */
  --fs-h2:   clamp(38px, 2rem + 3.2vw, 72px);   --lh-h2: 1.02;   --ls-h2: -0.015em;    /* serif 400 */
  --fs-h3:   clamp(20px, 1rem + 0.8vw, 26px);   --lh-h3: 1.2;    --ls-h3: -0.01em;     /* Inter 600 */
  --fs-lead: clamp(18px, 1rem + 0.4vw, 22px);   --lh-lead: 1.45; --ls-lead: -0.005em;  /* Inter 400 */
  --fs-body: 17px;  --lh-body: 1.55;
  --fs-small: 14px; --lh-small: 1.45;
  --fs-label: 12px; --ls-label: 0.08em;  /* Geist Mono 500, uppercase eyebrow */

  /* space: 4px base */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px; --s8: 32px; --s12: 48px; --s16: 64px; --s24: 96px;
  --section: clamp(96px, 12vw, 176px);
  --gutter: clamp(16px, 4vw, 64px);
  --max-page: 1200px; --max-text: 640px; --max-headline: 16ch;

  /* light */
  --paper: #fafaf7;  --card: #ffffff;  --mist: #f2f1ec;  --hairline: #e6e4dd;
  --ink: #0a0a0a;    --ink-2: #3d3d3a; --ink-3: #6b6a65;
  --glass: rgba(255,255,255,.72);  --glass-line: rgba(10,10,10,.08);
  /* atmosphere: hero and final CTA backgrounds only. Never on controls or verdicts. Needs team OK */
  --dawn-1: #eef4ff; --dawn-2: #d9e6ff;

  /* verdicts: unchanged from WEBSITE_SPEC 9.0, the only meaningful colour */
  --works-fg: #0f7a3d;   --works-bg: #e8f7ee;   --works-dot: #12a150;
  --broken-fg: #b42318;  --broken-bg: #fdecec;  --broken-dot: #e5484d;
  --couldnt-fg: #8a5a00; --couldnt-bg: #fff4dc; --couldnt-dot: #eaaa08;
  --needs-fg: #3f3a9e;   --needs-bg: #eeedfb;   --needs-dot: #6e66e0;
  --crashed-fg: #3d3d3d; --crashed-bg: #ededea; --crashed-dot: #6b6b6b;

  --r-chip: 8px; --r-btn: 999px; --r-card: 20px; --r-window: 14px;
  --shadow-window: 0 1px 2px rgba(10,10,10,.06), 0 24px 64px -16px rgba(10,10,10,.22);
}

@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* paste the dark block below here, unchanged */ } }
:root[data-theme="dark"] {
  --paper: #0b0b0c;  --card: #131314;  --mist: #18181a;  --hairline: #2a2a2d;
  --ink: #f5f5f2;    --ink-2: #c9c9c4; --ink-3: #8f8f8a;
  --glass: rgba(20,20,22,.66);  --glass-line: rgba(255,255,255,.10);
  --dawn-1: #0d1526; --dawn-2: #142240;
  --works-fg: #4ade80;   --works-bg: #0f2a1a;
  --broken-fg: #f87171;  --broken-bg: #2e1212;
  --couldnt-fg: #facc15; --couldnt-bg: #2b2208;
  --needs-fg: #a5a0ff;   --needs-bg: #1c1a3a;
  --crashed-fg: #c9c9c4; --crashed-bg: #222224;
  --shadow-window: 0 0 0 1px rgba(255,255,255,.08), 0 24px 64px -16px rgba(0,0,0,.8);
}
```

**Usage rules:** serif for headlines, Inter for anything clickable, one italic serif word for emphasis at most, `tabular-nums` for times and counts. The warm paper and the dawn gradient change WEBSITE_SPEC 9.0 ("no other accent"), so the team decides.

## 3. Scroll story: 14 beats

Every number shown comes from a recorded `tm` run on the synthetic Marigold fixture. Beats showing app UI carry a "Mac app: planned" tag. Each plain headline gets one mono caption for developers.

| # | Headline | Copy | Visual | Animation, trigger |
|---|---|---|---|---|
| 1 | Back to what *worked*. | Save points for your project, with proof of which ones still work. | Mac window: Marigold app beside an agent panel, hairline timeline below | Load: words rise from a mask (60 ms stagger), window rises 24 px, timeline draws in 900 ms |
| 2 | It worked at 10:42. | Your app runs. You ask the agent for one more change. | Live app, grey dot on the timeline | Pinned, scroll scrubs the clock |
| 3 | Then the agent kept going. | Step after step, file after file. | Agent log, step counter, file tree flicker | Pinned scrub, typing tied to scroll |
| 4 | Now nothing runs. | The page is blank and the error is long. | Window greys out, error in ink, not red | Scrub: desaturate, 2° tilt |
| 5 | Undo goes back one step. | Git has nothing. The agent says it can't. | Three cards: Undo, Git, Ask the agent, each with its reason | Fan out on enter, 80 ms stagger |
| 6 | Rewind. | Time runs backwards, step by step. | Lights down, clock rolls back, steps un-type | Pinned 210 vh, scroll maps to reverse time (WEBSITE_SPEC 6.3) |
| 7 | Every step left a save point. | Code, new files, config key names, lockfile, environment. | Dots fill the timeline; one opens "What's saved / What's not saved" with a locked `.env` row | Dots pop in, 40 ms stagger; card on hover or tap |
| 8 | Tried in a safe copy. | Your folder and branch are never touched. | A copy slides into a lane labelled "separate worktree" | Scrub: lane draws, copy slides 40 px |
| 9 | Broken. Broken. *Works.* | Time Machine runs your check on each one. | Three copies with real check logs; verdict stamps, the first colour on the page | Logs stream at scaled recorded timings; stamps spring (400/30) |
| 10 | Use this version. | A new branch, and an undo if you change your mind. | Copies fold into one; chip `tm/recover/cp-0003`; "Undo this rewind" | 600 ms fold on enter |
| 11 | Honest about the rest. | What came back, and what you set again by hand. | Report card: "Not brought back: database rows, secret values" | Rows reveal, 70 ms stagger |
| 12 | Next time, you'll know first. | A quiet card when a change breaks your check. | Menu bar dot turns red, corner card slides in | Card spring (300/32) from 12 px right |
| 13 | Works where you build. | One line for the terminal. A Mac app for everyone else. | Fork into builders, developers, agents; terminal types `npx timetm init` with Copy | Path draws on scroll; typing 18 ms per character, once |
| 14 | Built with a way back. | Free to rescue. Here is who is building it. | Team note, one CTA, one quiet link | Plain fade, then nothing moves |

After beat 14 the page goes static: a chip strip of what is captured today (README list), "What it does not do", pricing labelled planned, an FAQ with "Does it replace Git? No.", and a large wordmark footer.

## 4. Motion spec

These tokens extend WEBSITE_SPEC 6.2. Keep its easings and add:

| Token | Value | Use |
|---|---|---|
| `--dur-reveal` | 600 ms | Section and headline reveals |
| `--rise` | 24 px | Reveal distance (12 px on phones) |
| `--stagger-word` | 60 ms | Headline words, total capped at 600 ms |
| `--stagger-item` | 80 ms | Cards, chips, rows |
| `--ease-out` | cubic-bezier(.22,1,.36,1) | All arrivals |
| `--ease-inout` | cubic-bezier(.65,0,.35,1) | Folds and lane moves |
| Spring, verdict | stiffness 400, damping 30 | Only the verdict stamp may overshoot |
| Spring, card | stiffness 300, damping 32 | Overlay card |
| Hover | 200 ms, lift 2 px, shadow grows | Cards and buttons |
| Press | scale .97 for 140 ms | Buttons |
| Marquee | 40 s linear loop | Capture chip strip. Pauses on hover and focus |
| Pinned beat | 120 to 150 vh (beat 6: 210 vh) | GSAP ScrollTrigger with `scrub: true`, or scroll-driven CSS animations where supported |

**Rules:** native scroll, no smooth-scroll hijack. Animate only `transform` and `opacity`, no per-frame blur. Reveals fire once at 15 percent into view. Pinned beats are pure functions of scroll, so scrolling up reverses them.

**Reduced motion:** no pins, each beat becomes a still with a caption. Reveals become a 150 ms fade or nothing. The marquee becomes a wrapped list, typing shows full lines, stamps appear without a spring, videos show a poster and Play. `prefers-reduced-transparency` swaps glass for `--card`.

**Phones:** headline above the visual, pins shortened to 90 to 110 vh, 16 px gutters, no horizontal scroll, 44 px tap targets, "Skip the story" under the hero.

## 5. Team section (facts as written on unvibe.site/about)

**Before publishing:** no age or location (WEBSITE_SPEC 4.9). Never reuse Unvibe numbers as Time Machine traction. Unvibe's pages disagree on startup support ($232,700 vs $267,700), so leave it out.

**Suggested line:** "We build with coding agents, and we kept losing versions that worked. Time Machine is the record we wanted: every step saved, and an honest answer to which one still works."

## 6. Overlay notes for the app team (from Unvibe)

**How Unvibe's overlay works** (unvibe.site, unvibe.live, KrispiTech, vibecoding.app): the user selects code in Cursor, VS Code or a terminal and presses ⌘U. A floating panel, the **Island**, opens beside the editor. No tab switch, no chat window. It holds a depth control (New, Beginner, Intermediate, Advanced, Expert), Got it, Save, Ask a follow-up, a different explanation style, and Test Me (a one question quiz). **After-Agent Review** ranks the real git diff after an agent edits files: sensitive files first, a review checklist, stale notes. It never records the screen, and secrets are scanned on device first.

**What Time Machine takes** (fits APP_DESIGN_SPEC section 6):

1. **A summoned Island.** A hotkey opens the last agent turn: changed files with risky ones first, one verdict, "Rewind to 10:42" and "Show what changed". Summoned, so it may take focus. Automatic corner cards still never do.
2. **"Show Git details" is our depth control.** One toggle, never skill labels (EXPERIENCE 6).
3. **After-agent brief.** When the Stop hook check fails, show "Agent said" next to "Time Machine ran".
4. **Say what was read:** "Read: git diff and your check. Not read: your screen."

## 7. Eight findings that most affect conversion

1. **Show the real work.** Visible real steps raise perceived value. Animate real check lines at real timings, never padded. (Buell and Norton 2011; research 30, 1.15)
2. **Design the peak and the end.** Peak: the verdict turning to Works (beat 9). End: the honest report (beat 11), then the CTA. (Kahneman 1993; Cockburn et al. CHI 2015; research 30, 1.13)
3. **Calibrated trust beats maximal trust.** Show what the check covers and the exact command. One false Works can cause lasting algorithm aversion. (Lee and See 2004; Dietvorst 2015, 2018; research 30, 1.16)
4. **Polish signals reliability**, so the craft pays. Verdicts still stay plain and literal. (Kurosu and Kashimura 1995; Tractinsky 2000; research 30, 1.14)
5. **One primary action per screen**, one quiet alternative. (Iyengar and Lepper 2000; EXPERIENCE 8)
6. **Real social proof only.** No invented counts or testimonials; fake reviews are illegal (FTC 16 CFR 465). Fixa's unsourced figures are the anti-example. Use the team story and the open test suite. (Salganik et al. 2006; research 30, 1.22; research 31, 34)
7. **No fake urgency.** Mild dark patterns roughly doubled sign-ups in experiments, which is why they are banned here. Supaste's "5 spots left" is the pattern to avoid. (Luguri and Strahilevitz 2021; research 30, 3.1)
8. **One promise, then separate doors.** Top developer sites tell one story, then split by nav, pages or docs, with no persona toggle. CTAs are named by tool ("Download for Mac", "Install the CLI"), plus a copyable line for agents. (Stripe, Vercel, Supabase, Clerk; research 33, 3.4)
