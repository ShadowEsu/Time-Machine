# Time Machine: marketing website spec (round 3)

Prepared 14 October 2026. Historical round 3 proposal below. The built Editorial site and the October cinematic update in section 9.0 supersede conflicting layout, type, color and motion proposals.

Sources: `docs/BUILD_BRIEF.md` (sections 1 to 7), `.private/research/03-website-design.md` (Monolith brand, type, budgets), `.private/research/04-repos-skills-kit.md` section 1 (scroll-beat-kit v1.1.0), `.private/research/13-pricing-launch-naming.md` (pricing, positioning, launch scripts).

Ground rules this spec follows:

- The name stays "Time Machine" (founder decision). The site never uses Apple's clock with a counterclockwise arrow, star fields, a "history" galaxy, SF Pro, Apple's exact tokens (#f5f5f7 plus #0071e3), or a "9:41" timestamp.
- Monolith brand: black on white. Color appears only when something has been checked. Nothing gets color before a verdict.
- Fonts: Inter Display (wordmark and headlines), Inter (body and UI), Geist Mono (code, timestamps, labels).
- Honesty: never "guaranteed", "replays any app", "undo anything", "zero setup", "enterprise ready", or "universal undo". Every capability carries a real status label. Every number on the site is measured or clearly marked as illustrative.
- Nothing is implemented yet. Every "Now" label in this spec means "ships in the first public CLI release". The site must not go live with a "Now" label on anything that has not shipped. Treat status labels as data that comes from one file (see section 4.1).

---

## 1. Narrative arc

The homepage is a short film in three acts. Act one, **The break**: a small app works at 10:42, an agent takes 47 steps to "clean things up", the app stops running, and every familiar escape hatch (undo, Git, asking the agent) fails at once. Act two, **The rewind**: the visitor scrolls and time literally runs backwards, the 47 steps unwind, and we reveal that every step quietly left a save point holding far more than code (files, config without secrets, dependencies, environments, test setups), each of which can be rebuilt in a safe copy that never touches your real project. Act three, **The proof**: three save points are rebuilt and checked, and the first color on the entire page appears as verdicts (Broken, Broken, Works); the visitor chooses "Use this version", gets a new branch they can undo, reads an honest report of what could not come back, and sees the same check now watching every future agent turn, so the next break gets caught at step one. Then the page drops the film and becomes a calm, honest product page: what we can rewind now and later, the Mac app, the CLI and agent setup, what we can never undo, how we compare, security, pricing, the founder, FAQ, and one last call to action.

The emotional line: calm, then dread, then helplessness, then relief, then trust. The trust beat (the honest report) is deliberately placed after the relief beat, not before. Relief makes people listen; honesty makes them believe.

Visual rhymes, on purpose, so the film feels authored:

| Act one | Act three | Rhyme |
|---|---|---|
| Beat 3, the app **spins** out of control | Beat 12, the card **backflips** in celebration | Loss of control, then control |
| Beat 4, **three** useless escape hatches fan out | Beat 9, **three** checked copies fan out | Three guesses become three answers |
| Beat 1, a grey dot at 10:42 | Beat 9, the same dot turns green | The memory "it worked" becomes proof |
| Beat 5, three panes **fold** into one | Beat 10, three copies **fold** into one | Chaos collapses into one choice |

---

## 2. The beat sheet

### 2.0 Page order and global deck settings

```
[Nav, hidden until first scroll]
[Hero: static, outside every deck]
"Skip the story" link (visible on focus, and as a small text link under the hero CTAs)
[Deck 1: The break]     layout split          story vh 560 (460 at 820px and under)
[Deck 2: The rewind]    layout stack-below    story vh 640 (520 at 820px and under)
[Deck 3: The proof]     layout split-reverse  story vh 560 (460 at 820px and under)
"Replay the story" button + illustrative label
[Normal sections, section 4 of this spec]
```

- **The demo project** is synthetic: **Marigold**, a small TypeScript recipe app (Vite, Vitest). Its history comes from the real demo fixture in `fixtures/`. Every time, count, and test number shown in the decks must be copied from a recorded `tm` run on that fixture before launch. The values below (47 steps, 38 tests, 9 failing) are the target script, not measurements.
- **Illustrative label** sits under the last deck, in Geist Mono 12 px, ink 3: "Dramatized demo on a synthetic project. Times, counts and verdicts come from a recorded run of Time Machine on it."
- **The story clock.** All three decks share one pure function `scene(t)` where `t` is a story timestamp from 10:42:00 to 12:40:00. Each beat maps its local progress to `t`. Because every visual is a function of `t`, scrolling up replays anything exactly in reverse.
- **The spine.** The hairline drawn in the hero becomes a horizontal timeline that sits at the bottom of every deck stage (1 px, `--hairline`). Save points are dots on it. It is the one object that never leaves the screen during the film.
- **Save points in the story** (one agent turn of 47 steps, hooks fire before the turn and before destructive commands, per C15):

| Time | Save point | Why it was made | Verdict revealed in beat 9 |
|---|---|---|---|
| 10:42 | cp-0003 "Added dark mode" | Before the agent turn | Works (38 passed) |
| 11:21 | cp-0004 | Before `rm -rf src/theme` | Broken (1 failing, `formatCookTime`, broken by the lint "fix" at step 12) |
| 11:46 | cp-0005 | Before editing `app.config.json` | Broken (9 failing, missing `./theme/dark`) |
| 11:58 | cp-0006 | After the turn ended | Not rechecked. It is the state you are leaving, so `find-good` starts one save point back. Its dot stays grey (seen broken in beat 3, never checked) |

- **Tabs.** Each deck shows the kit's chip row. Labels are reader-facing (section 2.1 to 2.3 headers list them). Tabs seek to the beat midpoint.
- **Copy.** Headlines and subcopy are `.bs-line` blocks driven by `BeatScroll.rows` (relay hand-off, never two blocks at once). Headline: Inter Display 600, `clamp(40px, 6vw, 80px)`, tracking -0.03em. Subcopy: Inter 400, 21 px desktop, 17 px phone, ink 2, max 34ch.
- **Color rule inside the film.** Agent claims ("Done! All lint errors fixed."), console errors, and progress ticks are always ink. Only a check that Time Machine actually ran gets color. The first chromatic pixel on the whole page appears in beat 9.

### 2.1 Deck 1: The break

Layout `split` (copy left at 36 percent, stage right). Spans `[0,.25] [.25,.5] [.5,.75] [.75,1]`. Tabs: **10:42 · 47 steps · Broken · Stuck**.

#### Beat 1. "It worked at 10:42."

- **Subcopy:** "Marigold, a little recipe app. Dark mode just landed. It looks right. You move on." (15 words)
- **Visual:** a neutral browser window (component A07) holding Marigold: a header with the wordmark "Marigold", a search field, a grid of six recipe cards (title, cook time in mono, a grey image block), and a sun/moon toggle in the header. A Geist Mono readout above the window's top right corner: `10:42:07`. Under the stage, the hero hairline arrives from the left and a **hollow grey dot** drops onto it with a two-line label: "10:42 · Added dark mode" and, smaller, "Save point · not checked yet".
- **Move: assemble.** The window frame, then the header, then the six cards dock in from small offsets. It reads as "built": the thing worked because the pieces fit. It is also the gentlest move, right for a calm opening.
- **On scroll (beat 0 to 1):** 0.00 to 0.15 frame rises 24 px and fades in. 0.15 to 0.55 header and cards dock, staggered by 0.05. 0.55 to 0.70 the toggle slides and the app inside the window crossfades to its own dark theme (greys only). 0.70 to 0.78 the dot drops 12 px onto the hairline. 0.78 to 1.00 rest.
- **Color:** none. The dot is hollow because nothing has been checked. This is the setup for the payoff in beat 9.
- **Reduced motion still (Fig 1.1):** the assembled window in dark theme, `10:42:07` above it, hollow dot on the hairline with its label.

#### Beat 2. "Then the agent took 47 steps."

- **Subcopy:** "You asked it to fix one lint error. It fixed that, then kept going. Files moved. Packages changed. Config edited." (20 words)
- **Visual:** the stage splits in two. Left: the Marigold window, still looking fine (nobody has reloaded). Right: an agent panel (component A05): a user bubble "Fix the lint error in RecipeCard.tsx", then agent bubbles streaming, and under them a compact step log in Geist Mono:
  ```
  12  edit   src/utils/time.ts            formatCookTime: "simplified"
  23  run    rm -rf src/theme             "looks unused"
  31  run    npm install date-fns@4
  44  edit   app.config.json              theme → themes
  47  done   All lint errors fixed.
  ```
  A step counter `Step 31 of 47` and the clock (10:42 rolling to 11:58) sit in the panel header. On the timeline, 47 short ticks grow to the right of the 10:42 dot, and hollow dots appear at 11:21, 11:46 and 11:58.
- **Move: split ×2.** Cause and effect side by side: the agent works on the right, the app sits on the left, apparently unharmed. The calm left pane is what makes the next beat land.
- **On scroll:** 0.00 to 0.12 the window slides left and the agent panel slides in from the right. 0.12 to 0.78 the step counter maps linearly from 1 to 47; each log line appears when its step is reached (lines between the five shown are summarized as a faint `… 9 more edits` row); the clock and ticks advance with it. At 0.78 the agent's last bubble reads "Done! All lint errors fixed." Rest.
- **Color:** none. The agent's "Done!" carries an ink check glyph, never green. An agent's word is not a verdict.
- **Reduced motion still (Fig 1.2):** both panes, full log, counter at `Step 47 of 47`, clock `11:58`, 47 ticks and four hollow dots.

#### Beat 3. "Now nothing runs."

- **Subcopy:** "You reload. A blank page, and one line in the console you don't understand." (14 words)
- **Visual:** the agent panel leaves. The Marigold window spins and lands on its back face: an empty white page with a Geist Mono error block in ink: `Error: Cannot find module './theme/dark' imported from src/App.tsx`. A terminal strip below it: `npm test  ·  9 failing`. The 11:58 dot gets a small "now" label.
- **Move: spin** (+540° on Y, landing on the back face). The world spins out of control, and the back face is literally the other side of the same project. Spin is used exactly once on the site, here.
- **On scroll:** 0.00 to 0.10 the agent panel exits right (presence). 0.10 to 0.60 the spin, ease in-out. 0.60 to 0.78 the error text types in, tied to `inner()` so it holds once typed. Rest.
- **Color:** none. The error is ink on paper. Design note for the team: a crash you saw is not a check we ran, so it stays monochrome.
- **Reduced motion still (Fig 1.3):** the broken window with the error and the failing count.

#### Beat 4. "Undo goes back one step."

- **Subcopy:** "The agent took 47. Git only knows your last commit, three days ago. And the agent says it can't put it back." (21 words)
- **Visual:** three panes fan out like a hand of cards:
  1. **Editor:** a menu with "Undo" highlighted, a toast "Undid: Rename variable". One step.
  2. **Terminal:** `git status` printing `63 files changed, 4 untracked` and `last commit: 3 days ago`. A hovering suggestion `git checkout -- .` with a note in ink 3: "This also throws away three days of your work."
  3. **Agent chat:** user "Can you put it back how it was at 10:42?" Agent: "I don't have a record of the earlier state, so I can't restore it reliably."
- **Move: split ×3.** Three escape hatches, three dead ends. It rhymes with beat 9, where three panes come back with answers. On stages under 640 px the kit re-choreographs this into a fan automatically.
- **On scroll:** 0.00 to 0.50 the panes fan out and settle one at a time at 0.20, 0.35 and 0.50. 0.50 to 0.78 each pane's text color steps down from ink to ink 3 (color change, not opacity, so 3D is never flattened). Rest.
- **Color:** none.
- **Reduced motion still (Fig 1.4):** the three panes side by side, full text visible.

### 2.2 Deck 2: The rewind

Layout `stack-below` (centered stage, copy underneath, the most Apple of the layouts). Spans `[0,.34] [.34,.56] [.56,.78] [.78,1]`: beat 5 gets a third of the deck because it is the signature moment. Tabs: **Rewind · Save points · More than code · Safe copy**.

#### Beat 5. "Rewind."

- **Subcopy:** "Keep scrolling. Every step the agent took, taken back in order, all the way to 10:42." (16 words)
- **Visual:** the three panes from beat 4 fold back into the single broken window. The lights go down: a full-bleed ink layer behind the pin fades in, and copy, hairline and frame flip to paper on ink. Above the window, a large Geist Mono clock with tabular figures reads `11:58:31`. Beside the window, the 47-step log from beat 2 and a small file tree (`src/`, `theme/`, `utils/`, `package.json`, `app.config.json`). On the timeline, the **playhead** (1 px vertical line with a small left-pointing triangle head, component A03) appears at "now" and travels left. Each tick it passes undoes its step:
  - the log line un-types from right to left, then collapses;
  - `src/theme/dark.ts` slides back into the file tree, playing its delete animation in reverse;
  - the `package.json` diff line `+ "date-fns": "^4.1.0"` retracts;
  - `themes` in `app.config.json` renames back to `theme`;
  - the clock counts down, its digits rolling downward (the opposite direction to the forward roll in beat 2).
  A small readout under the clock shows the real rewind speed computed from the visitor's scroll velocity: `◀◀ 1,240×` (story seconds per real second, rounded to 10). When scrolling stops it reads `❚❚ paused`. At the end the playhead parks on the 10:42 dot and the window face crossfades to the working Marigold with a label: "Preview of 10:42 · not checked yet". The lights come back up.
- **Move: fold**, then a custom `draw()` for the reverse playback. Fold collapses the three dead ends from beat 4 into one action. The reverse playback is not a kit pose: it is `scene(t)` with `t` mapped backwards, which the kit's pure-function model makes exactly reversible.
- **On scroll:** 0.00 to 0.12 fold into one window. 0.12 to 0.20 lights down, playhead appears. 0.20 to 0.90 reverse playback, `step = 47 × (1 − x)` on a near-linear curve with a short ease at each end, like tape spinning up and down. 0.90 to 1.00 lights up and the preview label settles. (This beat sets its own rest point to 0.92 instead of the kit's 0.78.) If the visitor scrolls back up mid-beat, a mono hint appears for two seconds under the clock: "Forward again. Same 47 steps."
- **Color:** none, even in the dark. The preview is explicitly "not checked yet", so the 10:42 dot stays hollow.
- **Reduced motion still (Fig 2.1):** on paper, not ink: the timeline with the playhead parked at 10:42, all 47 ticks marked visited, the clock at `10:42:07`, the file tree restored, and the caption "Scrolling here plays the 47 steps backwards."

#### Beat 6. "Save points along the way."

- **Subcopy:** "Before each agent turn and each risky command, Time Machine saved one. Each says plainly what it holds, and what it doesn't." (22 words)
- **Visual:** the 10:42 preview window flips to its back: a save point card (component A11). Header: `Save point · 10:42 · Added dark mode`, sub-header `cp-0003 · made before an agent turn`. Two columns:
  - **What's saved:** Code (commit `a1b2c3d` plus 2 uncommitted changes) · Project files (4 untracked) · Config (12 key names, secret values never stored) · Dependencies (`pnpm-lock.yaml` digest) · Environment (Node 24, Dockerfile digest).
  - **What's not saved:** Database contents · Secret values · Anything already sent to other services.
  - Footer: a hollow badge "Not checked yet".
  On the timeline below, the four save point dots (10:42, 11:21, 11:46, 11:58) each grow a tiny label with the reason it was made: "before agent turn", "before rm -rf", "before config edit", "after turn".
- **Move: flip.** Turning the window over shows what was behind it the whole time. It also teaches the visitor that a save point has a front (your app) and a back (the facts).
- **On scroll:** 0.00 to 0.40 flip. 0.40 to 0.78 rows reveal in reading order, saved first, then not saved; timeline labels appear left to right. Rest.
- **Color:** none. The "Not checked yet" badge is a hollow outline.
- **Reduced motion still (Fig 2.2):** the save point card fully written, and the four labeled dots.

#### Beat 7. "Not just code. Everything around it."

This is the "rewind everything" beat. The headline is deliberately bounded: everything around your code, not everything in the world.

- **Subcopy:** "Files Git ignores. Config without the secrets. Dependencies. The environment it ran in. The tests that prove it. Experiments are next." (21 words)
- **Visual:** the save point card tilts into an isometric view and separates into stacked plates, each a thin white slab with a hairline edge, a mono label, and one line of detail:
  1. **Code:** commit plus uncommitted changes
  2. **Files:** the untracked and ignored files you chose
  3. **Config:** key names and fingerprints, never secret values
  4. **Dependencies:** lockfile and exact versions
  5. **Environment:** runtime, Dockerfile, environment definition
  6. **Tests:** your check command and how it ran
  7. A seventh plate with a dashed outline and ghosted text: **Experiments:** runs, parameters, datasets. Tagged `Coming soon`.
  Each plate has a small status tag on its right edge: `Now` on plates 1 to 6, `Coming soon` on plate 7. (Statuses come from the capability data file, section 4.1.)
- **Move: 3D parts** (isometric tilt, layers lifted in Z). A save point is literally layers, and the exploded view is how premium hardware pages show depth. Nothing inside the 3D subtree uses opacity below 1, clip-path or filter (the kit's flattening traps); the ghost plate uses a dashed border and ink 3 text instead of transparency.
- **On scroll:** 0.00 to 0.30 tilt to isometric (rx 55°, rz −40°). 0.30 to 0.70 plates lift one at a time, 28 px apart in Z, labels slide in from the right. 0.70 to 0.78 the dashed seventh plate draws its outline. Rest.
- **Color:** none. Status tags are monochrome: `Now` is ink on mist, `Coming soon` is ink 3 with a dashed border.
- **Reduced motion still (Fig 2.3):** the exploded isometric stack with all seven labeled plates.

#### Beat 8. "Tried in a safe copy."

- **Subcopy:** "Time Machine rebuilds the save point in a separate copy, network off, and runs your check. Your project folder is never touched." (22 words)
- **Visual:** the plates collapse flat and become one card. It splits in two:
  - **Left, stays put:** `Your project · ~/code/marigold` with the label "Untouched". Its current state still shows `11:58 · now`.
  - **Right, slides out:** `Safe copy · separate worktree · network off`. A step list in mono with ink checks:
    `✓ Rebuild code and files` · `✓ Install from lockfile (cached)` · `✓ Restore config keys` · `◌ Running npm test…`
  A small mono tag on the right card reads `host mode`, with a tooltip on the site version: "Uses Docker or Apple's container tool when present, and labels it as stronger isolation."
- **Move: split ×2.** Separation shown literally: two things, and one never moves. This is the whole safety story in one picture.
- **On scroll:** 0.00 to 0.25 plates fold flat into one card. 0.25 to 0.50 the copy slides out to the right. 0.50 to 0.78 steps tick in order, ending on the spinner, which holds. The cliffhanger hands off to Deck 3.
- **Color:** none. Progress checks are ink. Only the result of the check will get color.
- **Reduced motion still (Fig 2.4):** both cards, the step list, and the last row reading "Running your check".

### 2.3 Deck 3: The proof

Layout `split-reverse` (stage left, copy right). Spans `[0,.25] [.25,.5] [.5,.75] [.75,1]`. Tabs: **Check · Use it · Report · Never again**.

#### Beat 9. "Broken. Broken. Works."

- **Subcopy:** "It checks your save points newest first and stops at the first one that passes. That's your last working version." (20 words)
- **Visual:** three safe copy cards fan out, labeled `11:46`, `11:21`, `10:42`. Each shows a thin ink progress bar, then a verdict badge (component A04) stamps onto it:
  - `11:46` **Broken** · "9 tests failing"
  - `11:21` **Broken** · "1 test failing: formatCookTime"
  - `10:42` **Works** · "38 tests passed"
  At the same moment, the matching dots on the timeline fill: red, red, and finally the hollow 10:42 dot from beat 1 fills green. A mono footer under the cards: `find-good · 3 checks · newest passing: cp-0003 (10:42) · host mode · [measured] s`.
- **Move: split ×3.** It rhymes with beat 4. The same three-pane fan that showed three dead ends now shows three answers.
- **On scroll:** 0.00 to 0.20 fan out. 0.20 to 0.40 card 1 checks and stamps. 0.40 to 0.60 card 2. 0.60 to 0.78 card 3 stamps Works. The stamp is a precomputed spring curve (stiffness 400, damping 30) sampled by local progress, not by wall clock, so it still scrubs backwards exactly. Rest.
- **Color:** **the first color on the page.** Red, red, then green, on badges and dots only. Nothing else on screen changes color.
- **Reduced motion still (Fig 3.1):** all three cards with their verdicts, and the colored dots.

#### Beat 10. "Use this version."

- **Subcopy:** "One click makes a new branch from 10:42. Your broken state is saved first, so even the rewind can be undone." (21 words)
- **Visual:** the three cards fold into the single Works card. Beneath it, a black pill button "Use this version" presses (scale 0.97, 120 ms equivalent in story time). A branch diagram (component A15) draws in ink: the main line ending at `11:58` with a tag `saved before rewind`, and a new branch `tm/recover/cp-0003` leaving the 10:42 dot. The card turns back into the Marigold window, running again for real, with a chip `on tm/recover/cp-0003`. A quiet text link under the button: "Undo rewind". A mono caption for developers: `or: tm recover cp-0003`. A final line in ink 3: "Never pushes, merges or deploys."
- **Move: fold.** It rhymes with beat 5: chaos collapsed into one action then, and three answers collapse into one choice now.
- **On scroll:** 0.00 to 0.30 fold. 0.30 to 0.45 button press. 0.45 to 0.70 branch lines draw (stroke offset driven by progress). 0.70 to 0.78 the window face returns, working. Rest.
- **Color:** only the Works badge on the card stays green. Branch lines are ink.
- **Reduced motion still (Fig 3.2):** the working window, the branch diagram, the button and the undo link.

#### Beat 11. "Honest about the rest."

- **Subcopy:** "Every rewind ends with a report. What came back, what didn't, and what to do by hand. No fine print." (20 words)
- **Visual:** the working window flips to its back: the recovery report (component A12).
  ```
  Recovery report · cp-0003 · 10:42 Added dark mode
  Check        npm test · Works · 38 passed · host mode

  Restored     Code · 4 project files · 12 config keys
               Dependencies from lockfile · Environment (Node 24)
  Not restored Database contents (not captured)
               Secret values (never stored)
               Anything sent to other services after 10:42
  Do by hand   Re-enter 2 secret values: API_TOKEN, DATABASE_URL
               Redeploy if you shipped after 10:42
  Undo         Your 11:58 state is saved before this rewind
  ```
- **Move: flip.** The back of the card is the fine print, and we turn it over for you instead of hiding it.
- **On scroll:** 0.00 to 0.35 flip. 0.35 to 0.78 the four sections reveal in order. "Not restored" rows get a hollow ring marker. Rest.
- **Color:** the Works badge in the header only. "Not restored" is a fact, not a verdict, so it stays ink. No amber warnings.
- **Reduced motion still (Fig 3.3):** the full report.

#### Beat 12. "Next time, you'll know first."

Tab label: **Never again**.

- **Subcopy:** "After every agent turn, Time Machine checks the latest save point in the background. If Works turns to Broken, a small card tells you." (24 words)
- **Visual:** the report card does a full backflip and shrinks into the top right corner of the stage, where it becomes an overlay card (component A09). The stage becomes a desktop scene: a slim menu bar mock across the top (component A10) with the Time Machine status dot, the Marigold window, and the agent panel back with a new prompt, "Add a shopping list". The dot is green. The turn ends, the background check runs, the dot turns red, and the overlay card slides in without taking focus:
  > **Something broke after the agent's last change.**
  > Last working version: 12:31, Added shopping list.
  > [Rewind to 12:31] [Show what changed]
  A cursor clicks "Rewind to 12:31". The dot returns to green and the card collapses to one line: "Back to 12:31 · Works".
- **Move: backflip.** The kit's celebration move, used once on the whole site, here at the end of the film.
- **On scroll:** 0.00 to 0.25 backflip and shrink into the corner position. 0.25 to 0.45 desktop scene assembles, agent turn runs. 0.45 to 0.60 dot turns red, card slides in. 0.60 to 0.78 click, dot returns to green, card collapses. Rest.
- **Color:** the menu bar dot (green, red, green) and the small verdict words inside the card. The dot is never green without a real check behind it.
- **Reduced motion still (Fig 3.4):** the overlay card fully shown over the app, with the dot red and both buttons visible. Caption: "The card that appears when a check fails after an agent turn."

### 2.4 After the film

- **"Replay the story"** (text button with a small left triangle). It scrolls to the top of Deck 1, instantly under reduced motion.
- The illustrative label (2.0).
- Kit quality gates before launch: `beat-capture` at 390, 768 and 1440; `sweep-beats` at all 8 widths; `scroll-perf` in WebKit and Chromium; manual scroll backwards through every beat; Tab through the page to confirm focus never lands behind a pinned stage.
- Engineering notes from the kit audit: patch in a `destroy()` before client-side navigation, load the engine client-only, add `bs-nojs` to `<html>`, reserve deck heights in CSS, use `overflow-x: clip` (never `hidden`) on wrappers, and extend the harness, which assumes one `window.deck`, to run per deck. Reduced motion must use the custom per-beat stills above, not the kit's single end frame.

---

## 3. The hero

### 3.1 Layout

One full viewport (`min-height: 100svh`), pure white, everything centered on one vertical axis. Nothing else: no screenshot, no logo wall, no badge, no video.

```
                                  (nav hidden)

                              Time Machine            ← wordmark, the LCP element
                          Back to what worked.        ← tagline
     Saves every step you and your agents take, checks which versions
       actually work, and rewinds to the last good one. On a branch.  ← subline

             [ Download for Mac ]   [ Install the CLI ]
                     Copy agent setup prompt
                 Free CLI · Mac app · Skip the story ↓

  ─────────────────────────────────────────────────────────────────  ← hairline (drawn on scroll)
```

Vertical rhythm on desktop (1440 × 900): wordmark optical center at 42 percent of viewport height; tagline 28 px below the wordmark's baseline; subline 16 px below; CTAs 40 px below; tertiary links 20 px below. On a 390 px phone the wordmark wraps to two lines ("Time" / "Machine"), left edge and right edge each 16 px from the screen.

### 3.2 Wordmark spec

- **Source:** Inter Display, variable weight 640, set as live HTML text (not an image, not SVG) so it is the LCP element and paints before any JavaScript.
- **Size:** `clamp(72px, 17vw, 260px)`; line height 0.9; tracking −0.05em at 200 px and above, −0.045em around 140 px (use `font-size`-relative tracking via a small `clamp` on `letter-spacing`).
- **Color:** `--ink` #0A0A0A on `--paper` #FFFFFF.
- **Features:** `font-feature-settings: "ss01", "cv11"` only if they improve the `a` and `t` at display size; test both. Kerning on. Hand-tune the pairs `T·i`, `i·m`, `M·a`, `c·h` with per-letter spans only in the hero (the nav uses an outlined SVG of the final kerning).
- **The ownable detail:** the dot of the `i` in "Time" is a small **left-pointing triangle**, the rewind mark. Implementation that keeps LCP text-based and accessible:
  ```html
  <h1 class="wordmark">
    <span class="sr-only">Time Machine</span>
    <span aria-hidden="true">T<span class="i">ı<b class="tri"></b></span>me Machine</span>
  </h1>
  ```
  The dotless `ı` (U+0131) carries the stem; `.tri` is an absolutely positioned CSS triangle (border trick or `clip-path` on a 0.16em square), sitting where the tittle would be, optically centered on the stem. Test at 16, 44, 120 and 260 px.
- **Never:** a clock face, a counterclockwise arrow, stars, a "TM" monogram, a ® on our own name, or any Apple-style product icon.
- **Derived marks:** nav logo (outlined SVG of the hero, 17 px cap height); favicon and app icon (the triangle alone, paper on an ink rounded square); social card (wordmark at 120 px plus tagline, on paper).

### 3.3 Tagline options

| # | Tagline | Notes |
|---|---|---|
| 1 | **Back to what worked.** | Four words and a period. Plain, warm, true. It names the outcome, not the mechanism. |
| 2 | Rewind to the last version that works. | Clear and literal. Longer, less memorable. |
| 3 | Every save point. Checked. | Strong for developers, cold for non-technical builders. |
| 4 | Your agent broke it. We'll find what worked. | Sharp hook for social, too narrow and too loud for a hero. |
| 5 | Mistakes, undone. Proof included. | Nice rhythm, but "undone" edges toward universal undo. |

**Recommendation: "Back to what worked."** It works for both audiences, it echoes the beat 1 headline ("It worked at 10:42"), and it promises a return to a known good state instead of a magic undo. It also makes a perfect final CTA headline.

**Subline (Inter 21 px, ink 2, max 46ch):** "Saves every step you and your agents take, checks which versions actually work, and rewinds to the last good one. On a branch you can undo." (27 words; trim "you can undo" on phones.)

### 3.4 Calls to action

| Role | Label | Style | Behavior |
|---|---|---|---|
| Primary | **Download for Mac** | Black pill, white Inter 17 px / 500, 44 px tall, 22 px side padding, radius 999 px | Links to `/download`. Shown as primary only on macOS. **Before a signed, notarized build exists, the label is "Get the Mac app early"** and it opens the waitlist form. Never show "Download" for something that cannot be downloaded. |
| Secondary | **Install the CLI** | Outlined pill, 1 px ink border, ink text | Opens a small popover (not a page) with the install line in a copy block: `npx @scope/tm init` and a "Copy" button, plus a link "Read the CLI docs ›". On Windows and Linux this becomes the primary button and the Mac button turns into a text link "Mac app ›". |
| Tertiary | **Copy agent setup prompt** | Text button, Geist Mono 13 px, ink 2, with a small copy glyph | Copies the agent prompt (section 4.3) to the clipboard. The label changes to "Copied. Paste it into your agent." for 2 seconds (`aria-live="polite"`). |

`@scope` is a placeholder until the npm scope is registered (the bare names `tm`, `timemachine` and `time-machine` are taken).

Under the CTAs, one quiet line in Inter 13 px ink 3: "Free and open source CLI · Mac app coming soon · Skip the story ↓". Swap "coming soon" for the macOS version requirement once the app ships.

### 3.5 What moves on first scroll

Nothing moves on load. Motion starts with the visitor's first scroll and is fully scrubbed, so scrolling back up restores the hero exactly.

| Scroll from 0 to 60 percent of the hero height | What happens |
|---|---|
| 0 to 60% | The wordmark scales from hero size to the nav logo size (about 0.066×) and translates to the nav's left slot, via `transform` only. At the end, the HTML wordmark hides (`visibility: hidden`) and the SVG nav logo takes its place in the same pixel position, so there is no visible swap. |
| 0 to 25% | Tagline, subline, CTAs and tertiary line fade and rise 12 px (opacity and transform). |
| 10 to 60% | The hairline draws from the wordmark's baseline at left to the right edge of the viewport (`scaleX` from 0 to 1, transform origin left). It continues as the timeline spine into Deck 1, where the 10:42 dot will drop onto it. |
| 30 to 60% | The nav scrim fades in: `rgba(255,255,255,.78)` with `backdrop-filter: saturate(180%) blur(20px)`, fallback `rgba(255,255,255,.94)`. Nav height 48 px. |
| Once, at 5% | The triangle dot in the `i` nudges 3 px left and back (a single "rewind" tick). Disabled under reduced motion. |

Implementation: CSS scroll-driven animations (`animation-timeline: scroll(root)` with `animation-range`) behind `@supports`, and a 1 KB rAF fallback that sets one custom property per frame for browsers without support. No kit involvement: the kit's first narrator block is invisible at p = 0, which is exactly why the hero lives outside every deck.

**Nav after the morph:** logo left; center links `How it works`, `Agents`, `Pricing`, `Changelog`, `Docs`; right side a small black pill "Download" (or "Install" on non-Mac) and a GitHub star count only once it is a real, non-trivial number.

**Reduced motion:** the hero renders statically. The nav with its logo is simply present after the hero leaves the viewport (an IntersectionObserver toggles a class, no transition). The hairline is drawn full width from the start.

### 3.6 LCP and performance

- LCP element: the wordmark text. Target LCP 2.0 s or less at p75 on mid-range mobile; CLS 0.05 or less; INP 150 ms or less.
- Fonts through `next/font` (self-hosted, no third-party request). Preload only Inter Display at the one variable file used by the wordmark, subset to Latin. Body Inter and Geist Mono are not preloaded. `adjustFontFallback` on so the fallback metrics match and the swap does not shift layout. `font-display: swap`.
- The hero is server-rendered HTML and CSS only. The deck engine, Motion and any component JavaScript load after the hero paints (`next/script` client-only, deferred). Decks reserve their height in CSS so hydration shifts nothing.
- No images, video, canvas or WebGL above the fold. The OS detection for CTA ordering happens server-side from the `User-Agent` hint, with a CSS-only default (Mac first), so the buttons never reorder after paint.
- Home page budgets: motion JavaScript 60 KB gzip or less, total first view about 600 KB or less.

---

## 4. After the decks: normal sections

The film is over, so the page relaxes. No pinning, no scrubbing. Sections alternate paper and mist (`#F5F5F3`). Each section enters with one Motion `whileInView` reveal (opacity 0 to 1, translateY 16 px to 0, 320 ms, ease out), once. Section padding 160 px desktop, 96 px phone. Text column max 980 px, wide grids max 1200 px. Eyebrows are Geist Mono 12 px uppercase, +0.06em, ink 3.

### 4.1 "More than code" (the rewind everything grid)

- **Eyebrow:** WHAT A SAVE POINT HOLDS
- **Headline (H2):** More than code.
- **Lead:** "Your app is code plus everything around it. A save point keeps as much of that as it safely can, and tells you exactly what it left out."
- **Layout:** a 3-column grid of tiles on desktop, 2 on tablet, 1 on phone. Each tile: a 20 px line icon, a title (Inter Display 22 px / 600), one sentence (Inter 15 px, ink 2), and a status tag (component A17) in the top right corner. Tiles are grouped under three small subheads, in this order.

**Now** (ships in the first CLI release)

| Tile | Sentence |
|---|---|
| Code | Commits, branches and uncommitted changes. Each save point is pinned so Git cleanup can't delete it. |
| Project files | The untracked and ignored files you choose, kept outside your project folder. |
| Config | The settings you allow. Secret values are never stored, only their names and a fingerprint that shows when they change. |
| Dependencies | Your lockfile and exact versions, reinstalled in the safe copy. |
| Environments | Runtime versions and your environment definition, such as a Dockerfile. |
| Test environments | Your check, run in a clean copy with a time limit and the network off. The verdict and how it ran are saved with the save point. |
| A small local backup | Save points live outside the project. Delete the folder by accident and they're still there. |
| A full record | An append-only log of every save, check and rewind. |

**Coming soon** (on the roadmap, no dates promised)

| Tile | Sentence |
|---|---|
| The Mac app | Save now, Check it works, and Rewind, as big buttons. |
| Overlay cards and the menu bar dot | A quiet signal when a change breaks something. |
| More agents | Hook kits for Cursor, Codex and Gemini CLI. (MCP already works with any MCP client.) |
| ML experiments | Runs, parameters, datasets and metrics, saved and compared like code. |
| Screenshots per save point | See what the app looked like at each one. |
| Plain English summaries | "What changed" in a sentence, written on your machine first. |

**Not restored** (said out loud so nobody assumes)

| Tile | Sentence |
|---|---|
| Database contents | Not captured today. Every report lists it. |
| Secret values | Never stored, by design. You re-enter them. |
| Deployed versions | Rolling back a deploy is your host's job. We remind you to check. |
| Things already sent | Emails, payments, messages, webhooks. Time can't take those back. |

Data rule: every tile and its status come from one file, `content/capabilities.json` (`{ id, title, sentence, status: "now" | "soon" | "not-restored", since?: version }`). The homepage grid, `/how-it-works`, `/llms.txt` and the changelog all read it, so a status can never disagree between pages. A tile may only be `now` if a released version number is attached.

### 4.2 The app showcase

- **Eyebrow:** THE MAC APP · COMING SOON
- **Headline:** One button for the scary moment.
- **Lead:** "For anyone who builds with AI and never wants to see a terminal. Big buttons, plain words, and a small dot that only turns green when it means it."
- **Layout:** one wide app window (component A08) centered, with three numbered callouts that can also be browsed as tabs (Inter 15 px, ink 2). On phones the callouts become a horizontal snap carousel of three cards.

1. **The menu bar dot.** A tiny dot in your menu bar (component A10). Green means the last check passed. Red means it failed. Grey means not checked yet. "It is never green without a real check."
2. **Overlay cards.** Small cards in the corner that never steal focus (component A09). Example on screen: "Something broke after Claude's last change. Last working version: 10:42, Added dark mode." Buttons: Rewind to 10:42 · Show what changed. A second, optional element: the timeline strip across the bottom of the screen on a hotkey, every save point a dot colored by its verdict.
3. **The rewind view.** The app's History screen in Rewind mode (component A13): the list of save points with verdict badges, a big "Find the last working version" button, then "Try this version", then "Use this version", then "Undo". Labels on screen use the app's plain words: Save point, History, Compare, Check it works, Works, Broken, Couldn't check, Needs something, Check crashed.

- **Below the window, a three-step strip:** "1. Pick a project. 2. Choose the check. 3. Choose when to save." (the D01 onboarding, in its own words).
- **CTA:** "Get the Mac app early" (waitlist) until a signed build exists, then "Download for Mac".
- **Honesty:** the window is built in HTML from the real design, with the small mono label "Design preview. The app is in development." until the app ships, then "Screens from version x.y."

### 4.3 For developers

- **Eyebrow:** FOR DEVELOPERS AND THEIR AGENTS
- **Headline:** Built for your terminal. And your agent.
- **Lead:** "A free, open source CLI. Human output and JSON that always agree. Hooks that save before your agent acts, and an MCP server so it can rewind itself."
- **Layout:** left, a terminal (component A06) at 560 px wide; right, three stacked feature rows with mono titles.

Terminal content (sync with the real `--help` before launch; flags here are placeholders):

```
$ npx @scope/tm init
  ✓ Wrote timemachine.yml   check: npm test
$ tm hook install
  ✓ Save points before each agent turn and each risky command
$ tm find-good
  cp-0005  11:46  Broken   9 failing
  cp-0004  11:21  Broken   1 failing
  cp-0003  10:42  Works    38 passed   host mode
$ tm recover cp-0003
  ✓ Saved your current state first
  ✓ Created branch tm/recover/cp-0003
  Not restored: database contents, 2 secret values
```

The verdict words in the terminal are the only colored text in it (green Works, red Broken), matching what a real terminal shows.

Feature rows:

1. **`tm hook install`** · Hooks for Claude Code: before each prompt, before destructive shell commands, after each turn, with a background check that flags Works turning into Broken. Cursor, Codex and Gemini CLI kits: Coming soon.
2. **`tm mcp`** · The same actions as tools for any MCP client: save, timeline, check, find the last working version, recover. Add it to Claude Code with `claude mcp add timemachine -- npx @scope/tm mcp`.
3. **`--json` everywhere** · Every command prints the same facts for people and for programs. Verdicts use fixed exit meanings, so scripts and CI can trust them.

- **Agent setup prompt** (a copy block under the terminal, with the button "Copy agent setup prompt"):
  > Set up Time Machine in this repository. Fetch https://[domain]/SKILL.md and follow it. Run the init step, show me the generated timemachine.yml before saving it, and ask me before installing any hooks. Never push, delete branches, or change my working copy.
- **Links:** "Read the CLI docs ›" (`/cli`), "Agent setup ›" (`/agents`), "View on GitHub ›".

### 4.4 For teams and agencies

- **Eyebrow:** FOR TEAMS AND AGENCIES · COMING SOON
- **Headline:** You fix other people's projects.
- **Lead:** "Agencies ship client apps with agents every day, and eat the cost when one breaks. Time Machine gives every client project a checked history and a report you can send."
- **Three columns:**
  1. **One history per client.** Every project, every agent change, every check, in one place.
  2. **Handoff save points.** Mark the version you delivered. If the client's next agent breaks it, you know exactly what worked when it left your hands.
  3. **Reports you can forward.** The recovery report is written for humans: what came back, what didn't, what to do next.
- **CTA:** "Talk to the founder" (opens a short form or a calendar embed) and "Team pricing ›".
- Status: labeled Coming soon until Team ships. No logos, quotes or counts until they are real and permitted.

### 4.5 What we can't undo

The honesty section. Mist background, generous whitespace, no illustration except the verdict legend.

- **Eyebrow:** THE FINE PRINT, IN LARGE PRINT
- **Headline:** What we can't undo.
- **Lead:** "Rewinding your project doesn't rewind the world. Here is what stays done, so you never have to find out the hard way."
- **List** (each a short row with a hollow ring marker, Inter 19 px):
  - **Database changes.** We don't capture database contents today. If an agent dropped a table, the report says so.
  - **Payments, emails and messages.** Anything another service already did stays done.
  - **Deployments.** A rewind changes your local branch, not what's live. Redeploy when you're ready.
  - **Secret values.** We never store them, so we can't put them back. The report names which ones to re-enter.
  - **Files you didn't choose to keep.** Large files and paths outside your capture list are listed as missing.
- **Closing line (Inter Display 28 px):** "If we're not sure, we say so."
- **Verdict legend** (component A04, all six states in a row, each with its plain meaning):
  - **Works:** your check passed in a safe copy.
  - **Broken:** your check failed.
  - **Couldn't check:** something the check needed was missing, so we won't call it working.
  - **Needs something:** the check tried to reach the network or a secret it isn't allowed to use.
  - **Check crashed:** the check itself errored or ran out of time.
  - **Not checked yet:** a save point we haven't checked. Never shown as working.
- Footnote in ink 3: "Under the hood these are PASS, FAIL, INCOMPLETE, BLOCKED and ERROR, with fixed exit codes."

### 4.6 Comparison: built-in rewind, Git, Time Machine

- **Eyebrow:** HOW IT COMPARES
- **Headline:** Use all three. Know what each one does.
- **Lead:** "Built-in rewind is great for undoing one turn. Git is the backbone. Time Machine adds what neither does: it checks which version actually works."
- **Table** (component A18). Sticky first column on phones, horizontal scroll inside the table only (never the page). Cells use words plus a glyph, never color alone: `Yes`, `No`, `Partly`, `By hand`. Our column is not highlighted in color; it simply sits last, with a 1 px ink top border.

| | Built-in agent rewind (Claude Code, Cursor) | Git on its own | Time Machine |
|---|---|---|---|
| Changes made by shell commands (`rm`, `mv`, installs) | No. Claude Code's docs say Bash changes are not tracked. Cursor tracks agent edits only | Only what you committed | Yes. A save point records the project's state, whatever changed it |
| Your own manual edits | No, in both tools' docs | Only what you committed | Yes |
| Uncommitted work | Agent edits only | No | Yes |
| Ignored and untracked files you care about | No | No | Yes, the ones you choose |
| Config and environment definition | Only files the agent edited | Tracked files only | Allowlisted keys and the environment definition. Never secret values |
| Works across agents | One tool each | Yes | Yes. Claude Code hooks first, MCP for any MCP client, more kits coming |
| Checks that an old version actually runs | No | By hand (`git bisect run`) | Yes, in a safe copy with your check |
| Finds the last working version for you | No | By hand | Yes |
| Recovers without overwriting your current state | No, it restores files in place | Depends on the command | Yes. New branch, current state saved first |
| Tells you what it couldn't restore | No | No | Yes, every time |
| Survives deleting the project folder | Varies | Only if pushed | Yes, save points live outside the project |
| How long history lasts | Claude Code: about 30 days by default, configurable | Forever, for commits | Until you clean up. The newest working save point and pinned ones are never thinned |

- **Footnote (Inter 13 px, ink 3):** "Based on each vendor's public documentation as of October 2026: Claude Code checkpointing docs (Bash changes, subagent edits and outside edits are not tracked; snapshots are cleaned up after about 30 days by default) and Cursor's checkpoint docs (agent changes only, not version control). Tools change fast. Tell us if this is out of date." Link "Tell us" to a GitHub issue template. Re-verify on every release and print the check date.
- **Tone rule:** never mock a competitor. The table states facts with sources and recommends using built-in rewind alongside Time Machine.

### 4.7 Security and privacy

- **Eyebrow:** SECURITY AND PRIVACY
- **Headline:** Local first. Secrets never stored.
- **Lead:** "Your projects stay on your machine. There is no account to make and nothing to upload."
- **Six short points** in a 3 × 2 grid, each a mono title and one sentence:
  1. **On your machine.** Save points live in `~/.timemachine` (CLI) or the app's own folder. No cloud.
  2. **Secret values never stored.** Only key names and a keyed fingerprint to notice changes. Not in the store, the logs, or the reports.
  3. **Network off during checks.** Checks run with the network blocked by policy. If a check needs the network, it ends as "Needs something", never as "Works".
  4. **Never pushes or deletes.** No push, no merge, no deploy, no branch deletion. Your working copy is never touched while checking.
  5. **Tamper evident.** Save points are content addressed and integrity checked. A changed save point is rejected.
  6. **Open source and opt-in.** Read the CLI's code. Telemetry is off unless you turn it on.
- **Link:** "Read the security details ›" (`/security`).
- **Never** show compliance badges, "bank grade", "military grade", or certifications we don't hold.

### 4.8 Pricing teaser

- **Eyebrow:** PRICING
- **Headline:** Free to rescue. Always.
- **Lead:** "The CLI is free and open source. Restores are never behind a paywall. Paid plans are for more history, more projects, and teams."
- **Four cards** (component A19), equal height, one row on desktop, stacked on phone:

| Card | Price line | Three lines | Status |
|---|---|---|---|
| CLI | Free, open source | Every local feature · Hooks and MCP · No limits on local use | Now (first release) |
| App | Free | 3 projects · 30 days of history · Rewind always included | Coming soon |
| Pro | $9 a month, or $79 a year | Unlimited projects · 1 year of history | Coming soon |
| Team | $20 per seat a month | Shared projects · Team history of agent changes · Alerts on risky changes | Coming soon |

- Footer line under the cards: "Prices we plan to launch with. They may change before paid plans exist, and we'll say so in the changelog." Link "See pricing ›".
- No "Popular" tag until there is data behind it.

### 4.9 Founder story

- **Eyebrow:** WHY THIS EXISTS
- **Layout:** a narrow text column (620 px), a small square photo of the founder at their desk (real, optional), a handwritten-free signature line in Inter.
- **Draft copy** (bracketed parts must be filled with true details by the founder; nothing invented):
  >
  > [One true sentence about the moment it went wrong: what the agent did, what it cost.]
  >
  > The agent said it couldn't undo it. Git couldn't either, because I hadn't committed. I didn't need a smarter agent. I needed a record of every step and an honest answer to one question: which version actually worked?
  >
  > So that's what I'm building. It's early. The CLI comes first and the Mac app after. Everything on this page says whether it's ready yet, and I'll keep it that way.
  >
  > I read every email. [first name]
- **Links:** "Read the full story ›" (`/story`) and "Email the founder".
- Rules: publish the age only with the founder's and a parent's consent. No location unless the founder wants it. No invented incident, users or numbers.

### 4.10 FAQ

Ten questions as an accessible accordion (component A20: `button` plus `aria-expanded`, all answers present in the HTML for search and agents).

1. **Is this the same as Git?**
   No. It uses Git and adds what Git doesn't keep: uncommitted work, files you chose outside Git, config key names, dependencies and the environment. Then it checks which versions actually work.
2. **My agent already has a rewind. Why would I need this?**
   Keep using it. Built-in rewinds undo a turn inside one tool, and most don't track shell commands or your own edits. Time Machine covers those, works across agents, and checks the result before you use it.
3. **What does "Works" actually mean?**
   Your own check (for example `npm test`, a build, or "the home page loads") passed in a separate copy of that save point. It doesn't mean bug free. It means your check passed, and the report says how it was run.
4. **Will it change my project while it checks?**
   No. Checks run in a separate copy. Your folder and your current branch are left alone. Using a version creates a new branch and saves your current state first.
5. **Does it store my passwords or API keys?**
   No. It stores the names of your settings and a fingerprint that shows when a value changed. Never the value itself.
6. **Can it undo database changes or a deploy?**
   Not today. A rewind restores your project, not other systems. Every report lists what wasn't restored, including databases, deploys and anything sent to other services.
7. **Which agents does it work with?**
   Claude Code hooks are first. Any agent that speaks MCP can use the MCP server. Kits for Cursor, Codex and Gemini CLI are coming soon. Git and file changes are captured no matter which tool made them.
8. **Do I need to be a developer?**
   For the CLI, a little. The Mac app is for everyone: pick a project, choose a check, and press Rewind when something breaks. The app is coming soon.
9. **Where is my data stored, and how much space does it use?**
   On your computer, outside your project folder. Files are deduplicated and compressed. You set a size budget and older save points thin out, but the newest working one and any you pin are kept.
10. **Is this related to Apple's Time Machine?**
    No. This is an independent project, not affiliated with or endorsed by Apple. Apple's Time Machine backs up your Mac. This checks and rewinds your projects. You can use both.

Note for the founder: question 10 exists because people will ask. It does not resolve the trademark risk recorded in the brief.

### 4.11 Final CTA

- Full viewport, paper, centered, the hairline reappears above the headline with a single green dot at its right end (the only color in the section, and a true one: it is the 10:42 save point from the film).
- **Headline (Inter Display, hero H1 size):** Back to what worked.
- **Sub:** "Free CLI today. The Mac app is coming soon."
- **CTAs:** the same three as the hero (Download for Mac or Get the Mac app early, Install the CLI, Copy agent setup prompt), plus a fourth text link "Talk to the founder ›".
- Under it, small: "◀ Replay the story".

### 4.12 Footer

- **Four columns** (Inter 13 px, ink 2, links ink on hover):
  - **Product:** How it works · Download · Pricing · Changelog · Roadmap
  - **Developers:** CLI docs · Agents · MCP · SKILL.md · llms.txt · GitHub
  - **Company:** Story · Security · Brand · Contact
  - **Legal:** Privacy · Terms · Open source licenses
- **Bottom row:** the nav logo at 15 px · a status dot linked to `/status` reading "Site and updates: normal" (the status page covers what we actually host: website, docs, download and update endpoints, npm package availability) · "© 2026 Time Machine" · "Not affiliated with Apple Inc." · a tiny "Reading this as an agent? Start at /llms.txt".
- The status dot follows the same color rule: green only when the status check is actually green.

---

## 5. Other pages

All pages share the nav, the footer, the type scale and the color rule. Every page has a `.md` twin at the same path plus `.md` (for example `/how-it-works.md`) for agents. No page uses a scroll deck except home. Every page carries an "Updated [date]" line in ink 3 at the bottom.

### /download

The page that turns intent into an installed app. Before the app ships it is honest about that and becomes a waitlist; after, it is one big button. **Sections:** (1) Hero: the app icon (rewind triangle on ink), "Time Machine for Mac", a black pill "Download for Mac" with file size and version in mono under it (`Version x.y · 48 MB · macOS 14 or later`, real values only), and "Apple silicon and Intel" only if both are true. Pre-launch: "Get the Mac app early" email form with one question, "What tool broke your project last?" (segments developers, vibe coders and teams). (2) Three steps after download: open the DMG, drag to Applications, pick your first project. (3) "Signed and notarized" line only once true. (4) "Not on a Mac?" block with the CLI install line. (5) System requirements and release notes link to `/changelog`. (6) Uninstall instructions, including where save points live and how to delete them.

### /cli (docs landing)

The developer front door, quiet and fast, written to get someone to their first save point in under five minutes (measure it, then print the measured time). **Sections:** (1) Hero: "The Time Machine CLI." with the one-line install and a "Copy" button. (2) Quickstart in four commands: `init`, `checkpoint`, `find-good`, `recover`, each with real output. (3) Command reference grid, one card per command from the brief (`init`, `checkpoint`, `hook install`, `timeline`, `diff`, `open`, `verify`, `find-good`, `recover`, `log`, `mcp`), each with a one-line description and a link. (4) `timemachine.yml` annotated, like a technical figure ("Fig. 1, a project manifest"), line by line. (5) Verdicts and exit codes table: PASS 0, FAIL 1, INCOMPLETE 2, BLOCKED 3, ERROR 4, with the app's plain words next to each. (6) JSON output example. (7) Isolation modes: host mode by default and labeled, Docker or Apple `container` when present. (8) Links: GitHub, license, `/agents`, `llms.txt`.

### /agents

For people setting up agents and for the agents themselves. It opens with the line Supabase made standard: "Reading this as an agent? This page describes Time Machine as it works today. Start with /SKILL.md." **Sections:** (1) Hero: "Give your agent a way back." with the "Copy agent setup prompt" button. (2) Per-agent tabs: Claude Code (plugin install, hooks, MCP, status Now), Cursor, Codex, Gemini CLI (status Coming soon until the kits ship), "Any MCP client" (config snippet). (3) What the hooks do, as a timeline figure: before prompt, before a destructive shell command, after the turn, background check. (4) MCP tool list with inputs and outputs. (5) Safety rules the agent follows: never push, never delete branches, ask before installing hooks, report verdicts verbatim. (6) Downloadable `SKILL.md` and the plugin marketplace line.

### /how-it-works

The mechanism, explained like an engineering paper with a friendly voice. Includes the full "What we can't undo" section. **Sections:** (1) Hero: "How a rewind works." (2) The five questions every save point answers (captured, references, restorable, missing, verified) as a table with the brief's examples. (3) **The diagram** (component A21, inline SVG, 1100 × 520, paper and ink only, verdict colors only on the verdict node):
  - Three horizontal lanes labeled at left in mono: **Your project**, **Time Machine store**, **Safe copy**.
  - Lane 1: a folder node `~/code/marigold` and a branch line. Hook ticks on the line labeled "before turn", "before rm -rf", "after turn".
  - Arrows down from each tick into lane 2, the store, drawn as a stack of save point cards with a label "outside your project · content addressed · append-only log". A small pin icon on the repo notes `refs/tm/<id>` so Git cleanup can't prune.
  - An arrow from a save point down into lane 3: a dashed box "separate worktree · captured files · lockfile install · clean env · network off · time limit", ending at a verdict node that shows the five states.
  - A "find-good" arrow that walks right to left across the save points in lane 2, with small numbered steps 1, 2, 3.
  - An arrow from the passing save point back up to lane 1 creating a new branch `tm/recover/cp-0003`, with a small "saved first" node on the old line.
  - One arrow drawn from lane 3 to lane 1 and crossed out, labeled "never": checks never write to your project.
  - The report node at the far right: "Restored · Not restored · Do by hand".
  Hovering a node (or focusing it) highlights its lane and shows a one-sentence explanation; the cursor becomes the playhead over the branch line. (4) What is captured, with the capability data from 4.1. (5) Isolation: host mode versus container, and how each is labeled. (6) Verdicts and what they mean. (7) What we can't undo. (8) Limits and known gaps, updated per release.

### /changelog

Proof that the project ships. Dated entries, newest first, weekly cadence as the target and honest gaps if a week is missed. **Sections:** (1) Header "Changelog" with RSS and an email subscribe field. (2) Entries: date in mono, version, a one-line headline in Inter Display 28 px, a short paragraph, an optional HTML or image figure, and labels `CLI`, `App`, `Agents`, `Site`. (3) Each entry lists capability status changes ("Config capture: Coming soon → Now in 0.3.0"), generated from `capabilities.json` diffs. (4) "Known issues" list at the top when there are any.

### /security

Concrete controls, no badges. **Sections:** (1) Hero: "Local first. Secrets never stored." (2) Data flow: what stays on your machine (everything today), what leaves (nothing, unless you opt into telemetry, which is listed field by field). (3) Secrets: how key names and keyed fingerprints work, and the test that proves values never reach the store, logs or reports. (4) Isolation: network blocking during checks using Anthropic's open source sandbox runtime (`srt`, a research preview) plus the engine's own fail-closed logic; host mode versus container, labeled. (5) Integrity: content addressing, tamper rejection, append-only audit log. (6) Supply chain: npm trusted publishing with provenance, signed and notarized app once true. (7) Responsible disclosure: an email address and a `security.txt`. (8) Compliance: "We don't hold any certifications yet. We'll list them here when we do."

### /pricing

Plain, four columns, no tricks. **Sections:** (1) Hero: "Free to rescue. Always." (2) The four cards from 4.8 with full feature lists and status labels. (3) "Never paywalled" box: local save points, local restores, the CLI, and every report. (4) Comparison matrix by feature, with Coming soon labels. (5) Pricing FAQ: what happens when a trial ends (your history stays; you can always restore), refunds, annual billing. (6) Line: "Paid plans aren't available yet. These are the prices we plan to launch with." until billing exists.

### /story

The founder's page, longer and more personal than the homepage section, in the same honest voice. **Sections:** (1) Hero: a large quote from the founder, in their words. (2) The night it broke (true account, synthetic or redacted details). (3) Why verification matters more than undo. (4) Principles, as five short lines: Check, don't guess. Say what you can't do. Never touch the user's work. Free to rescue. Ship weekly. (5) What's built and what isn't, linked to the changelog. (6) How to reach the founder. (7) Optional: a short "built in public" log with dated posts.

### /404

See 6.6.

---

## 6. Motion system

### 6.1 Principles

1. **Scroll is the clock.** In the film, nothing autoplays. Every frame is a pure function of scroll position, so scrolling up reverses it exactly.
2. **One move per beat.** A beat does one kit move and one supporting change. Then it rests.
3. **Arrivals ease out, exits ease in.** Things decelerate into place and accelerate away.
4. **Springs only for verdicts.** A verdict stamp is the only thing allowed to bounce, because it is the only moment of truth.
5. **Stillness is part of the motion.** Every beat holds from 0.78 to 1.00 so it can be read.
6. **Motion never carries meaning alone.** Every state reached by motion is also stated in text.

### 6.2 Tokens

```css
:root {
  --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);   /* arrivals */
  --ease-in:     cubic-bezier(0.64, 0, 0.78, 0);   /* exits */
  --ease-inout:  cubic-bezier(0.65, 0, 0.35, 1);   /* kit moves: flip, spin, fold */
  --ease-tape:   cubic-bezier(0.45, 0, 0.55, 1);   /* rewind spin-up and spin-down */

  --dur-instant: 80ms;    /* hover color, focus ring */
  --dur-fast:    140ms;   /* button press, copy confirmation */
  --dur-base:    240ms;   /* UI transitions, nav scrim, tabs */
  --dur-enter:   320ms;   /* section reveals, overlay card enter */
  --dur-slow:    480ms;   /* large layout changes outside the decks */
}
```

- **Springs (Motion):** verdict stamp `{ stiffness: 400, damping: 30, mass: 1 }`, scale from 1.25 to 1 with a 2° rotation settling to 0. Overlay card `{ stiffness: 300, damping: 32 }`, from 12 px right and 0.98 scale.
- **Inside decks:** springs are precomputed as curves over local progress (sampled once into a 64-point lookup table), so they scrub backwards exactly.
- **Scroll per beat:** about 120 to 150 vh of scroll per beat on desktop, set through each deck's `story.vh`. Beat 5 gets about 210 vh.
- **Narrator relay:** kit defaults (`--bs-row-dur` 0.5, `--bs-rise` 0.55em, `--bs-lift` 0.32em, `--bs-relay` 0.032).
- **Button press:** scale 0.97 over `--dur-fast`, `--ease-out`; release back over `--dur-base`.
- **Hover on links:** underline grows from left over `--dur-base`.

### 6.3 The "time runs backwards" effect (beat 5)

Idea: do not animate a reversal. Render the past as a function of time and run time backwards.

1. **One event log.** The demo fixture's real run is exported once to `scene.json`: 47 steps, each `{ step, t, kind: "edit" | "run" | "done", path, before, after, line }`.
2. **One pure render.** `scene(t)` returns the full visible state for any timestamp: which log lines exist and how many characters are typed, the file tree, the diff lines, the config key name, the clock digits. No state is carried between frames.
3. **Map scroll to time.** Beat 2 maps progress forward (10:42 to 11:58). Beat 5 maps progress backward with `t = lerp(11:58:31, 10:42:07, tape(x))`, where `tape` is near-linear with a short ease at each end (`--ease-tape`), like a reel spinning up and down.
4. **Reverse-specific details** (computed from the sign of `dt`, not from a separate animation):
   - Text un-types from the right end, at the same character rate it typed.
   - Removed files re-enter using their exit motion played backwards (they rise from below and un-fade), so it reads as rewind, not as a new add.
   - Clock digits roll downward when `dt < 0` and upward when `dt > 0`.
   - Ghost trails: two copies of the playhead at 8 percent and 4 percent ink, offset 6 px and 12 px in the direction of travel, only while `|dt|` is high. No CSS blur or filter (both are expensive and flatten 3D).
   - The speed readout `◀◀ 1,240×` is `|dt| / real elapsed seconds`, smoothed over 200 ms and rounded to the nearest 10. Below a threshold it shows `❚❚ paused`. It is a real number, computed live.
5. **Lights down.** A fixed ink layer behind the pin goes from opacity 0 to 1 (composited, cheap), and text tokens swap to paper through a class toggled at the threshold. Never animate `background-color` on large surfaces per frame.
6. **Draw only on change.** `draw()` compares the current step index and character counts with the last frame and writes only what changed, inside the kit's read then write split.
7. **Reduced motion:** a single still (Fig 2.1) and the caption. No ink layer.

### 6.4 Cursor as playhead

- Applies to any element with `data-timeline` (the deck spine after the film, the how-it-works diagram, the changelog's release line, the 404 timeline) on devices with `(pointer: fine)` only.
- Over the timeline, the system cursor hides and a playhead follows the pointer's x: a 1 px ink vertical line the height of the timeline area, with a 7 px left-pointing triangle head at the top. It snaps to the nearest save point within 12 px and shows a small tooltip: `10:42 · Added dark mode · Works`.
- Movement follows the pointer exactly (no easing lag). Snapping animates over `--dur-fast`.
- Keyboard: the timeline is one focusable element; Left and Right move between save points; the tooltip is announced through `aria-live`. Touch: tapping a dot shows the same tooltip. No custom cursor anywhere else on the site.
- Reduced motion: the playhead still appears (it is information, not decoration) but snapping is instant.

### 6.5 Section reveals and UI motion outside decks

- Reveal once on entering view: opacity 0 to 1 and translateY 16 px to 0, `--dur-enter`, `--ease-out`. Children stagger by 40 ms, at most 5 children.
- Copy buttons: icon swaps to a check glyph and the label changes, `--dur-fast`, no bounce.
- Tabs and accordions: height animates with Motion layout, `--dur-base`.
- Nothing on the site moves on its own for more than 5 seconds. Nothing loops.

### 6.6 The 404 page: "This page hasn't happened yet."

- **Layout:** the hero layout, smaller. Headline in Inter Display at H1 size: "This page hasn't happened yet."
- **Sub:** "Maybe it will. For now, here's the last page that worked."
- **Visual:** a hairline timeline across the page. On the left, a solid dot labeled with the visitor's previous page on this site (from `document.referrer` when same origin, otherwise "Home"), with a small green `Works` badge (true: that page loaded). In the middle, the playhead at "now". To the right of the playhead, ahead in time, a dashed hollow dot labeled with the requested path in mono, `/pricng`, and the tag "Not checked yet". The cursor works as a playhead here too.
- **Buttons:** black pill "Rewind to [previous page]" (or "Rewind to home") and a text link "See the changelog ›".
- **Fun, bounded:** if the path is close to a real one (edit distance 2 or less), add "Did you mean /pricing?" No other jokes.
- Status code 404, `noindex`, and a `.md` twin that just lists the main pages.

---

## 7. Copy deck: 30 lines in the brand voice

Voice: calm, confident, a little fun. Short sentences. Periods, not exclamation marks. No em dashes. Never "guaranteed", "undo anything", "any app", "zero setup", "enterprise ready". Numbers only when measured.

1. Back to what worked.
2. Every save point. Checked.
3. Undo goes back one step. Your agent took 47.
4. Looking fixed and working are different things.
5. Color means it's been checked.
6. Never green without a real check.
7. Broken. Broken. Works.
8. Tried in a safe copy first.
9. Your folder stays exactly where you left it.
10. A new branch, not a new problem.
11. Even the rewind can be undone.
12. What came back. What didn't. What to do next.
13. If we're not sure, we say so.
14. Rewinding your project doesn't rewind the world.
15. We keep the names of your secrets. Never the secrets.
16. Save points live outside your project. On purpose.
17. Free to rescue. Always.
18. Built for your terminal. And your agent.
19. Give your agent a way back.
20. Let your agent move fast. Keep the receipts.
21. The agent said it couldn't be undone. Check again.
22. Know which version works before you need it.
23. Every agent turn, quietly checked.
24. Find out after one turn, not after midnight.
25. One button for the scary moment.
26. Not just code. Everything around it.
27. Proof, not hope.
28. A save point that says what it's missing.
29. This page hasn't happened yet.
30. Break things. We kept the version that worked.

Usage notes: lines 3 and 24 depend on the recorded demo (replace 47 with the real step count if it differs). Line 21 is for social posts about agents that claim recovery is impossible, never aimed at a named vendor.

---

## 8. What makes it feel like the newest a16z company: checklist

Each item has a "done when" test. The site does not launch until every item in groups A to C is done.

**A. Agent-readable from day one**

- [ ] `/llms.txt` and `/llms-full.txt`. Done when: an index of every page with one-line descriptions, plus the full docs as one markdown file, both generated at build time from the same sources as the pages.
- [ ] `.md` twin of every page (`/how-it-works.md`). Done when: content matches the HTML page, generated, not hand-copied.
- [ ] `/SKILL.md`. Done when: an agent following only this file can install the CLI, write `timemachine.yml` after asking the user, install hooks after asking, and report verdicts verbatim. Tested with Claude Code on the demo fixture.
- [ ] "Copy agent setup prompt" on home, `/agents` and `/cli`. Done when: one source string, tested by pasting into a fresh agent session.
- [ ] "Reading this as an agent?" line on home and `/agents`. Done when: it points to `/llms.txt` and `/SKILL.md`.
- [ ] MCP server published to the official MCP Registry and the Claude Code plugin in a self-hosted marketplace. Done when: install commands on `/agents` work from a clean machine.
- [ ] Brand page `/brand` with logo SVGs, the triangle mark, color tokens, type specs, and a `DESIGN.md` agents can read. Done when: an agent can build an on-brand page from it.

**B. Honest by construction**

- [ ] Status labels (Now, Coming soon, Not restored) everywhere, from `content/capabilities.json`. Done when: a CI check fails the build if any page hardcodes a status, or if a `now` item has no released version.
- [ ] Real numbers only. Done when: every number on the site lives in `content/facts.json` with a source, method and date, and a CI check fails on unregistered numerals in marketing copy (allowlist for prices and dates).
- [ ] Illustrative labels on every demo and design preview. Done when: the deck, the app showcase and the terminal all carry one.
- [ ] Banned words check. Done when: CI fails on "guaranteed", "undo anything", "any app", "zero setup", "enterprise ready", "military grade", and on the em dash character in site copy.
- [ ] Comparison table with sources and a check date. Done when: every competitor claim links to the vendor's own documentation.
- [ ] "What we can't undo" on home and `/how-it-works`. Done when: the list matches the report's "Not restored" categories in the engine.
- [ ] No fake social proof. Done when: zero logos, quotes, star counts or user counts until real and permitted.
- [ ] "Not affiliated with Apple Inc." in the footer and FAQ.

**C. Proof of life**

- [ ] `/changelog` with dated entries and RSS. Done when: at least four weekly entries exist before launch, each tied to a real release or commit.
- [ ] Public `/status` page for what we host (site, docs, downloads, update feed). Done when: the footer dot reads from it.
- [ ] `/security` with concrete controls and `/.well-known/security.txt`. Done when: the disclosure email is monitored.
- [ ] Open source repo with a README that shows a 20 second recording of the real demo. Done when: a stranger can install from the README alone.
- [ ] Docs time to first save point measured. Done when: five people did it unaided and the median is printed on `/cli`.
- [ ] Public roadmap that matches the capability file.

**D. Craft signals**

- [ ] Performance budgets enforced in CI (Lighthouse CI on every pull request): LCP 2.0 s or less, CLS 0.05 or less, INP 150 ms or less on mobile, motion JavaScript 60 KB gzip or less.
- [ ] Kit quality gates in CI: `beat-capture`, `sweep-beats` at 8 widths, `scroll-perf` in WebKit and Chromium.
- [ ] WCAG 2.2 AA: contrast, focus order, keyboard timeline, reduced motion stills, "Skip the story".
- [ ] Open Graph image per page generated from one template (component A29).
- [ ] Technical-paper framing in reduced motion and on `/how-it-works` (Fig 1.1, Fig 2.3).
- [ ] One typeface system, one accent rule (verdict colors plus one ink blue, see 9.0), no stock imagery, no illustrations of people, no gradients.
- [ ] Founder-written story with a real way to reach them.
- [ ] Legal: privacy, terms, open source licenses (including scroll-beat-kit's MIT notice and font licenses).
- [ ] No dark patterns: no countdowns, no fake scarcity, no pre-checked boxes, waitlist asks one question only.

---

## 9. Asset list

Every visual is built as live HTML, CSS and inline SVG (no screenshots, videos or image sequences), so it is sharp at any size, tiny, and reversible on scroll. All components read tokens from one file. Each component ships with a reduced motion state and a story in a component gallery page (`/brand/components`, not indexed).

### 9.0 Tokens

```css
:root {
  /* Monolith */
  --ink: #0A0A0A; --ink-2: #3D3D3D; --ink-3: #6B6B6B;
  --paper: #FFFFFF; --mist: #F5F5F3; --hairline: #E6E6E3;

  /* Verdicts: the only color on the site. fg on bg passes AA. */
  --works-fg: #0F7A3D;    --works-bg: #E8F7EE;    --works-dot: #12A150;   /* PASS */
  --broken-fg: #B42318;   --broken-bg: #FDECEC;   --broken-dot: #E5484D;  /* FAIL */
  --couldnt-fg: #8A5A00;  --couldnt-bg: #FFF4DC;  --couldnt-dot: #EAAA08; /* INCOMPLETE */
  --needs-fg: #3F3A9E;    --needs-bg: #EEEDFB;    --needs-dot: #6E66E0;   /* BLOCKED */
  --crashed-fg: #3D3D3D;  --crashed-bg: #EDEDEA;  --crashed-dot: #6B6B6B; /* ERROR, dashed border */
  /* Not checked yet: hollow, 1.5px --ink-3 ring, no fill */

  --radius-pill: 999px; --radius-card: 20px; --radius-window: 14px; --radius-chip: 8px;
  --shadow-window: 0 1px 2px rgba(10,10,10,.06), 0 12px 32px rgba(10,10,10,.08); /* low blur, phone safe */
  --font-display: "Inter Display", "Inter", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}
```

Rules: color never appears without a glyph and a word. Verdict text is dark on tint, never colored text on white.

**Decision, 16 October 2026 (site v3, founder's choice of concept A "Editorial"):** the site may use **one ink-blue accent** beyond the verdict colors. Tokens in `site/assets/site.css`: `--accent: #1D3BB8` on warm paper `#F3EFE5` (`--accent-ink: #142A86`, `--accent-tint: #E3E7F6`; dark theme `--accent: #9FB0FF`, button `#3651D6`). Blue is used rarely: the primary button, the italic half of a headline, section numbers, the Time Machine bar in the comparison, the Built tag and the focus ring (2 px). Blue never sits next to green or red in a way that reads as a verdict, and green still appears only after a real PASS. Display type is Newsreader (self hosted, SIL OFL 1.1) instead of Inter Display. See `design/SITE_V3_DIRECTION.md`. This replaces the earlier rule that links, focus rings and buttons are ink only.

**Decision, 17 October 2026 (Editorial + cinematic + orange, built in `site/`):**

- Home opens on ink `#100F0D` with the oversized Newsreader regular/italic Time Machine wordmark. The physical product device emerges below it. There is no car, video download, loading bar, overlay or scroll lock.
- The first-visit opening lasts 2.9 seconds. Skip, Enter and Escape end it immediately. The optional localStorage flag `tm-intro-seen` skips repeat visits. Reduced motion starts awake. Touch and low-tier devices get a 1.2 second version with no dial sweep. If JavaScript fails, the page stays visible and usable.
- A second upper-page ink transition uses the same oversized serif: "It worked at 10:42." It leads into the problem rather than repeating instructions.
- Orange `#FF791F` marks the dial pointer and selected warm buttons, with dark `#211307` button text. The Ladder track is `#D14E0B`; hardware focus rings are `#B83E08` on aluminium. Editorial blue remains for information, other primary buttons and links. Green and red remain recorded verdicts only.
- Home section padding and repeated instructions are shorter. The home spec sheet section was removed because the hero ledger, Agents and The Mac app already state built and planned status; the full spec sheet stays on the story and company pages. The optional nine-act story has shorter native-scroll runways (about 24% shorter at 1440 and 390 wide). No wheel or touch scroll interception is introduced. Watch the story targets `#story-start` with a header offset. On phones, the story device hides during the rewind act when it would cover the clock or copy, including under reduced motion.
- Sound is off on every load. A labelled, keyboard-accessible Sound button is available on phones too. Shared `sound.js` makes original detent, failure, rewind and success cues with WebAudio oscillators. Optional quiet ambience is exposed only after sound is enabled. There are no music files. Mute and a hidden tab stop all voices and suspend the context. Returning to a tab does not resume sound.
- Home's Play break + rewind replays the synthetic demo: cp-0006 fails, the screen dims once, then the orange dial scrubs to recorded working cp-0003. No camera shake or repeated flashes. Reduced motion jumps directly to the working still. The synthetic label remains beside the controls.
- Keep reduced motion, core/memory/Save-Data detection and the short frame probe. Fine-pointer tilt stops offscreen or hidden. The low tier removes soft shadows and extra 3D surfaces (home hero peak surfaces 34 to 17 in the forced weak trace). Real low-end GPU and physical phone performance still require device testing: the measurements are Chromium CPU throttling with a software renderer.


### 9.1 Components

| ID | Component | Spec |
|---|---|---|
| A01 | **Wordmark** | Live text in the hero (3.2); outlined SVG for nav (17 px cap height), footer (15 px) and social card. Triangle tittle on the `i` of "Time". Ships as `wordmark.svg`, `wordmark-paper.svg`, plus the triangle mark alone. |
| A02 | **Timeline (hairline spine)** | Full-width 1 px `--hairline` line, `data-timeline`. Props: `points[] { t, label, reason, verdict? }`, `ticks` (count), `range [t0, t1]`. Dots are 10 px: hollow ring for unverified, filled `--*-dot` with a 2 px paper halo for verdicts. Labels in Geist Mono 11 px above, reasons in ink 3 below. Keyboard navigable (Left and Right). Draw-in via `scaleX`. |
| A03 | **Playhead** | 1 px ink vertical line plus a 7 px left-pointing triangle head. Optional ghost trails (8 and 4 percent ink). Used by the rewind beat, the cursor, the 404 and the how-it-works diagram. |
| A04 | **Verdict badge** | Pill, 24 px tall (compact 20 px), radius pill, 10 px side padding, Geist Mono 12 px / 500. Glyph plus word: ✓ Works, ✕ Broken, ? Couldn't check, ⊘ Needs something, ! Check crashed, ○ Not checked yet. Variants: `app` (plain words) and `cli` (PASS, FAIL, INCOMPLETE, BLOCKED, ERROR). Stamp animation: Motion spring 400/30, scale 1.25 to 1, rotate 2° to 0. Optional detail line ("38 tests passed") in Inter 13 px. |
| A05 | **Agent panel and chat bubble** | Panel 380 px wide, `--paper` with 1 px hairline border, radius 14 px. Header: neutral "Agent" chip (no vendor logo), step counter `Step 31 of 47` and clock in mono. User bubble: ink on mist, right aligned, radius 16 px with a 4 px corner on the speaker side. Agent bubble: ink on paper with hairline border, left aligned. Streaming text is driven by a character count prop so it scrubs. Agent claims use an ink check glyph only. |
| A06 | **Terminal** | Neutral window (no vendor chrome), ink background `#0E0E0E`, text `#EDEDEA`, Geist Mono 14 px / 1.6, 20 px padding, radius 14 px. Prompt `$` in ink 3. Props: `lines[] { kind: cmd | out | ok | verdict, text }`, `typed` (character count for scrubbing). Verdict words use verdict dot colors (the only color in it). Copy button top right for the commands only. |
| A07 | **Browser window frame** | For the demo app (Marigold). Neutral chrome: 36 px bar, three 10 px grey circles (`#D9D9D6`, not macOS colors), a centered URL pill `localhost:5173` in mono. Two faces (front and back) for flip and spin moves. Content area fixed at 16:10, scaled by the kit camera. Includes the **Marigold demo UI** (header, search, 6 recipe cards, theme toggle, light and dark greys only) and the **error face** (blank page plus mono error block and a `npm test · 9 failing` strip). |
| A08 | **App window frame** | For the Mac app showcase. 1040 × 660 at 1×, radius 14 px, sidebar 220 px (Projects list), toolbar with "Save now", "Check it works" and the big black "Rewind" button. Neutral, not a pixel copy of macOS. Carries the "Design preview" label until the app ships. |
| A09 | **Overlay card** | 340 px wide, paper, radius 16 px, `--shadow-window`, 16 px padding. Title Inter 15 px / 600, body Inter 13 px ink 2, two buttons (primary small black pill, secondary text). Small verdict badge in the corner. Enter: spring 300/32 from 12 px right. Never shown taking focus in demos (no focus ring on it). Collapsed state: one line "Back to 12:31 · Works". |
| A10 | **Menu bar mock and status dot** | 28 px strip, translucent paper, a few neutral grey placeholder glyphs (no real app icons, no Apple logo), and the Time Machine item: the triangle mark plus an 8 px status dot (green, red or grey). Dropdown variant: last check, last save point, "Rewind…" item. |
| A11 | **Save point card** | 520 px wide, paper, radius 20 px, hairline border. Header in mono (`Save point · 10:42 · Added dark mode`, `cp-0003 · made before an agent turn`), two columns "What's saved" and "What's not saved" with rows of icon plus label plus detail, footer badge (A04). Front and back faces available. |
| A12 | **Recovery report** | Same card size as A11. Four sections (Restored, Not restored, Do by hand, Undo) in a two-column grid, labels in mono ink 3, values in Inter 15 px. Header verdict badge. Not restored rows use a hollow ring marker, never color. Also renders as plain text for `.md` pages and the CLI. |
| A13 | **Rewind view (app screen)** | History list: rows of time, label, reason, verdict badge; a "Find the last working version" primary button; a progress row per check; then "Try this version", "Use this version", "Undo". Lives inside A08. |
| A14 | **Diff view** | Two modes: unified (mono 13 px, `+` and `−` gutters in ink 3, changed text on mist, removed text struck through in ink 3) and **project diff** (rows for Code, Files, Config keys, Dependencies, Environment, each with a change count). No red and green for diffs: color is reserved for verdicts. |
| A15 | **Branch diagram** | Inline SVG. Main line ink 1.5 px, new branch ink 1.5 px with a 90° rounded elbow, node dots reuse A02. Labels in mono. Lines draw via `stroke-dashoffset` driven by progress. |
| A16 | **Command copy block** | One-line mono block on mist, radius 10 px, copy button with confirmation text, `aria-live`. Variants: install line, MCP add line, agent setup prompt (multi-line). |
| A17 | **Status tag** | `Now` (ink on mist), `Coming soon` (ink 3, dashed 1 px border), `Not restored` (ink 3, hollow ring). Geist Mono 11 px uppercase, +0.04em. Reads from `capabilities.json`. |
| A18 | **Comparison table** | Sticky header and first column, rows 56 px, words plus glyphs, footnote markers linking to sources. Scrolls inside its own container on phones. |
| A19 | **Pricing card** | Radius 20 px, hairline border, plan name in Inter Display 24 px, price in Inter Display 40 px with tabular figures, three lines, status tag, one button. |
| A20 | **FAQ accordion** | `button` plus `aria-expanded`, plus and minus glyph rotating 90°, answers in the HTML. |
| A21 | **How-it-works diagram** | Inline SVG, three lanes, nodes, arrows, the crossed-out "never" arrow, hover and focus explanations, cursor playhead on the branch line (5, /how-it-works). |
| A22 | **Step log** | Mono rows `step · kind · path · note`, 13 px, driven by `scene(t)`. Supports forward typing and reverse un-typing. Collapsed summary row (`… 9 more edits`). |
| A23 | **File tree** | Mono 13 px, 16 px indent, folder and file glyphs, rows enter and exit with reversible motion. |
| A24 | **Clock readout** | Digital only, never a clock face. Geist Mono with `tnum`, sizes 14 px (inline) and 64 px (rewind beat). Per-digit rolling (up when time moves forward, down when it moves back). Plus the speed readout `◀◀ 1,240×` and `❚❚ paused`. |
| A25 | **Plate stack (3D parts)** | Seven plates, 420 × 72 px each, paper with hairline edge, mono label and one line of detail, status tag on the right. The seventh plate is dashed. Built to the kit's 3D rules (no opacity below 1, overflow, filter or clip-path inside the turning subtree). |
| A26 | **Safe copy card pair** | Two cards for the split ×2 move: "Your project · Untouched" and "Safe copy · separate worktree · network off" with a step list and a `host mode` tag. |
| A27 | **Nav** | 48 px, translucent paper scrim, logo left, five links, one black pill right. Mobile: logo plus a menu button opening a full-screen sheet. |
| A28 | **404 timeline** | A02 plus A03 with a past dot (with a Works badge), a "now" playhead, and a dashed future dot labeled with the requested path. |
| A29 | **Social card template** | 1200 × 630, paper, wordmark 120 px, page title in Inter Display 56 px, hairline with one dot. Generated per page at build. |
| A30 | **Favicon and app icon** | The triangle mark in paper on an ink rounded square. Sizes 16, 32, 180, 512, plus a monochrome SVG favicon. |
| A31 | **Capability tile** | Icon, title, sentence, status tag (A17). Used in the 4.1 grid and on `/how-it-works`. |
| A32 | **Illustrative label** | Geist Mono 12 px ink 3 line: "Dramatized demo on a synthetic project…" or "Design preview…". Required on A07, A08 and the decks. |
| A33 | **Waitlist form** | One email field, one optional question, one black pill. Inline success text, no redirect, no pre-checked boxes. |

### 9.2 Build order for the visuals (suggested)

1. Tokens, A01, A02, A03, A04 (the brand in four parts).
2. A07, A05, A06, A22, A24 (Deck 1).
3. A11, A23, A25, A26, A14 (Deck 2).
4. A12, A15, A09, A10 (Deck 3).
5. Everything else for the normal sections and pages.
