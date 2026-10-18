# App v3: two directions for a tool worth keeping

Date: 16 October 2026. Status: concept study, not a product release.

The two HTML files are self-contained, interactive design mockups. Every project, agent event, check, duration and deployment in them is synthetic demo data. They do not run checks, save files, call a model or deploy anything. Nothing here changes `apps/desktop` or the website. A feature shown here is not a claim that it ships today.

## The decision

The current app has the right nouns. It needs a stronger point of view. A serif heading alone does not make a calm, premium tool. The history needs to feel like a useful record of *your* work. The rescue needs to feel clear before it feels impressive.

Explore two distinct answers:

- **A, Notebook.** A project journal. Warm paper, editorial type, human notes and cited explanations. The app remembers what happened so you do not have to.
- **B, Instrument.** A precise object. Aluminium, a dark display, a tactile dial and one cobalt key. The app gives you a physical-feeling way back through time.

Recommendation, still a hypothesis: use Notebook as the everyday home. Test Instrument as an alternative, not a second mode that rearranges the app. Keep its dial only if people understand it faster than a ruler and list. The website's device can share materials and the playhead without forcing a hardware metaphor onto every app task.

No implementation or scope decision is made by this study.

## What the references actually teach

Research used public product material, official design posts and one founder interview. There was no access to logged-in competitor apps. Fonts below are reported by their teams, not measured from a running native app. Motion timings in our systems are proposals, not copied competitor measurements. Claims about why people return or pay are design hypotheses, not causal findings from these sources.

### Granola: a familiar artifact, quietly made better

Sources: [new visual identity, by cofounder Sam Stephenson](https://www.granola.ai/blog/a-new-look-for-granola), [how to use Granola, including note provenance and citations](https://www.granola.ai/blog/get-the-best-from-granola), [Chris Pedregal interview with Peter Yang](https://creatoreconomy.so/p/the-hidden-rules-behind-successful-ai-products-chris-pedregal).

**Layout.** It starts as a notepad, not an AI dashboard. People can type, close it and get on with the meeting. Pedregal attributes return to this simplicity and convenience. The product's familiar shape lowers the cost of learning a new tool. Borrow the journal, not a generic chat-first landing screen.

**Type and color.** The 2026 identity pairs Quadrant, a mechanical slab serif for display, with Melange for UI. The team kept green but gave it a system. The intended feeling is calm with energy underneath. These are proprietary faces. Our concepts use licensed alternatives, not copies. Do not copy Granola's green: in Time Machine, green belongs to an actual PASS for a specific save point. Warm neutrals and one non-verdict accent can provide character instead.

**The enhance-notes moment.** Your rough notes remain in black. Added detail appears in grey. The familiar artifact becomes more useful without erasing your authorship. You can edit everything. A magnifier exposes the underlying note or transcript. Chat answers cite sources. The useful surprise is not a fireworks animation. It is finding your intent intact, with the mechanical work done around it.

**Our equivalent.** An agent turn becomes a readable entry: what you asked, what changed, what the agent claimed, what Time Machine actually ran, and the limits. Your title stays in ink. Generated interpretation stays secondary and marked AI. A click goes to a save point or check log. Do not turn accepted AI prose into a fact just by darkening it. Provenance remains available even after editing.

**Why it is loved, with limits.** The founder describes a calming, trusty-notebook relationship. In the interview, he reports strong return and credits a narrow, convenient product that removes work. That is testimony from the founder, not independent evidence that warm paper causes retention. The transferable idea is relief plus useful context, not the reported retention figure. We should not put that figure in Time Machine copy.

**Motion.** The sources explain the before/after artifact and the feeling, but do not establish native animation timings. We propose a brief arrival of the finished entry. No fake typing or padded progress in the real app.

### Linear: density without equal visual weight

Sources: [2024 UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [2026 calmer-interface refresh](https://linear.app/now/behind-the-latest-design-refresh).

- Linear reports Inter Display for headings and Inter for other text. Expression comes from a clear hierarchy, not many fonts.
- Its 2024 system moved from 98 theme variables to base, accent and contrast inputs in LCH. The goal was more consistent light, dark and high-contrast themes.
- In 2026, the team dimmed navigation, reduced icon treatments and softened unnecessary separators. Important work earns attention. Chrome does not.
- Rich density remains. Calm is not the same as leaving an empty dashboard around a large title.
- Borrow stable header positions, aligned metadata and keyboard hints. Do not borrow low contrast or hide the only route behind a shortcut.

For Time Machine: one dominant status, one primary action, 44 to 64 px history rows when compact, a quiet sidebar and an inspector only when needed. The record itself should carry the product's value.

### Things 3: power unfolds inside a piece of paper

Source: [Cultured Code's feature and design explanation](https://culturedcode.com/things/features/).

- Opening a to-do transforms it into a clear piece of paper. Optional fields stay out of the way until needed.
- Magic Plus puts an item exactly where you drop it. The delight teaches a useful spatial rule.
- Quick Find, keyboard access and sidebar collapse make depth available without forcing it onto the first screen.
- The page includes reviewer praise for purposeful unfolding motion and a list that does not feel overbearing. It is curated product-site testimony, not a representative user study.
- The source does not identify a typeface. We take the hierarchy and space, not an unverified font claim.

For Time Machine: expand the selected entry in place. Keep the timestamp and source visible so people do not lose their place. An empty history says what to do next, not what they have failed to do.

### Raycast: speed, context and one learned doorway

Source: [Raycast's fresh look and feel](https://www.raycast.com/blog/a-fresh-look-and-feel).

- Its stated principles are fast, simple and delightful.
- A larger search bar expresses the product's core action. A unified bottom action bar exposes contextual commands with shortcuts.
- Consistent stroke and radius rules make small icons feel like one family.
- The keycap icon makes keyboard use a physical-feeling brand idea.
- The source does not give a verified native font family. Do not infer one from the marketing site.

For Time Machine: an Ask field can be a learned doorway into history. Results must resolve to inspectable save points, not an unbounded chatbot that competes with rescue. Every shortcut needs a visible route too.

### Two supporting references

[Superhuman on its 100 ms rule](https://blog.superhuman.com/superhuman-is-built-for-speed/) describes local storage, caching, preloading, minimal animation and shortcut hints. Borrow the performance discipline. A local row selection should respond promptly. A real check can take time and must show its real work. Do not borrow unsupported time-saving claims.

[Apple's Flighty design interview](https://developer.apple.com/news/?id=970ncww4) describes a tool that is “boringly obvious” in normal use and shines when things go wrong. Its familiar airport conventions and always-available facts are a useful model for a rescue app. We should reduce the need to reopen Time Machine, not manufacture reasons to open it.

For Instrument's material language, the [OP-1 field manual](https://teenage.engineering/_img/63bfeac1a9917e66c8ba8bd6_original.pdf) describes natural anodised aluminium and colored encoders on a precision tool. Borrow readable indexing and tactile hierarchy. Do not copy the object, artwork, controls or logos.

## Why return, why pay: the honest psychology

| Reason | Honest product behavior | What we must not do |
|---|---|---|
| Relief | Show which saved version passed, what ran and what comes back. End with a usable recovery copy and an honest report. | Confetti, a fake success, padded suspense, or green before PASS. |
| Reduced mental load | A journal answers “what changed while I was away?” A glance gives one current status. | Activity for its own sake, a stream of every keystroke, or a notification per file. |
| Competence and agency | The user chooses the project and check. The app shows the new branch, separate copy and undo limits. | Imply that a rewind silently switches their folder or repairs the deployed site. |
| Stored value | Named save points, check evidence and personal notes grow into a useful project memory. Ask can retrieve facts from that record. | Lock history or restores behind payment. Hide export. Create a penalty for leaving. |
| Craft | Alignment, readable type, predictable controls and fast local feedback suggest care. Then the engine has to earn that trust. | Treat visual polish as evidence of correctness. |
| Worth paying for | Less repeated digging, useful automation, reliable checks, quiet assistance and maintained software. | Sell anxiety or invent savings. A beautiful shell alone is not recurring value. |

The [aesthetic-usability effect](https://www.nngroup.com/articles/aesthetic-usability-effect/) is a warning as well as an opportunity. Attractive products can feel easier even when they are not. In testing, watch task completion, wrong restores and whether users can name the limits. Do not score a design on compliments alone.

The existing [pricing ADR](../docs/adr/0002-pricing-ladder.md) remains the commercial rule: pricing is planned, restores are never paywalled, the CLI is free, earned steps stay, and grace and pause protect users. Nothing in these concepts introduces a paywall or pricing mechanism.

Natural return triggers are an agent turn ending, a real failed check, or a user's question about their history. A quiet week is a good outcome. No streaks, badges, guilt, fake urgency, random rewards or engagement reminders. Useful history stays exportable. The success measure is informed task completion, not time in app.

## Shared behavior, regardless of direction

1. One plain status statement leads. One filled primary action leads from it. Other actions are quiet.
2. Fixed vocabulary: **Works**, **Broken**, **Couldn't check**, **Needs something**, **Check crashed**, **Not checked yet**. The concept data exercises Works, Broken and Not checked yet. The other verdicts are unchanged, not renamed.
3. A shape and word carry a verdict. Color confirms it. An unchecked version is a hollow ring, never a green interpolation.
4. Every green mark in a product implementation requires recorded PASS evidence for that exact save point. Mockup green is labeled demo data and is not evidence that the real engine passed.
5. Agent claims and Time Machine checks remain separate. “Agent said tests passed” is not Works.
6. The broken state offers two-click rescue only for an already checked target. First choose the last working version. Then review what happens and press Do it. If no target has passed, show that plainly and offer to check older points. Never infer Works from recency.
7. Recovery saves the current version, prepares a local branch and a separate recovery copy. It does not switch the working folder. Opening or switching is a separate user action. The Done state says the copy is ready, not that the working folder moved.
8. What does not come back is visible: database contents, secret values, anything already deployed and later changes that need doing by hand. Store key names only. External emails, payments and messages cannot be reversed either. A production report must list the full project-specific coverage, not just the example categories.
9. Secret values never enter the UI, store, logs or model context. A cited explanation does not get to read more than the product is allowed to capture.
10. No navigation reordering by skill level. Keyboard and pointer users get the same layout. A summoned overlay may take focus. An automatic one may not.

## Direction A: Notebook

### The screen

A quiet project rail sits at the left. The center is one document column, not a table plus permanent inspector. The project history reads like a journal of agent turns. Time is in the margin. Each entry has a title, author, verdict, check evidence and at most two sentences of generated summary. Autosaves fold between meaningful entries. Pinned versions get a small mulberry ribbon, not a reward badge.

The same horizontal playhead ruler stays above the journal. Past is left, now is right. A live Now section is compact and finite. The right-edge Ask panel is calm, narrower than the document and clearly secondary. Citations bring the relevant entry into view. A question is a small tinted note. Answers are readable prose, with facts in ink and generated interpretation in secondary ink plus an AI label.

### Visual system

| Role | Light | Dark |
|---|---|---|
| Paper | `#F7F3EA` | `#151311` |
| Raised sheet | `#FCFAF5` | `#1B1916` |
| Rail | `#F0EBE0` | `#121110` |
| Ink | `#1D1B17` | `#F2EDE3` |
| Secondary ink | `#45413A` | `#CFC7B9` |
| Caption / generated ink | `#6B6458` | `#9D9487` |
| Hairline | `#E2DACA` | `#2D2924` |
| Mulberry accent | `#7B3B63` | `#D9A3C5` |
| Mulberry ground | `#F4E7EF` | `#2C1E27` |
| Works text | `#0F7A3D` | `#4ADE80` |
| Broken text | `#B42318` | `#F87171` |

The accent is a warm ribbon, not another verdict. Use it for a personal pin, a question tint, focus and active agent presence. Primary buttons stay ink. Green and red remain local to verdicts. The other existing verdict tokens carry forward unchanged.

**Type.** Newsreader 400 and italic for the 44 px status, 21 px day headings and 18 px entry titles. Newsreader 500 for entry emphasis. Inter 400/500/600 at 12 to 14 px for controls, facts and metadata. Geist Mono 400/500 at 10.5 to 12 px for timestamps and commands. The pairing is more editorial than the current condensed Instrument Serif heading. Italic is an accent, not a whole paragraph. Body prose stays roomy enough to read.

**Space.** A 4 px base. A 600 px maximum journal column, 28 px top padding, 22 px glyph lane and 62 px timestamp margin. A 212 px project rail and 340 px Ask panel at the 1280 px reference size. Entry height follows its content. Optional details expand inline. When space is narrow, Ask becomes a summoned drawer, not a compressed third column. That responsive adaptation is a design proposal, not implemented in these desktop-size mockups.

**Motion.** Entry arrival: 8 px rise with opacity, 220 to 420 ms ease-out. Citation navigation: a short scroll and 1.4 s temporary tint. Playhead: 320 ms ease-in-out. Agent presence: 2.4 s opacity breath only while active. The real feed appends actual events and can be paused. Never simulate its cadence in the product. Reduced motion removes movement and breathing. The mockup's event timer is demo-only and is disabled in screenshot mode.

**Empty state and first value.** A blank journal reads “Your first save point goes here.” One action: Save and check this project. Explain safe-copy isolation and what is not captured before starting. If the check cannot run, use the exact verdict and next step. Do not call the empty state unprotected or at risk. First value is one verified save point, not completion of a setup checklist.

**Useful delight.** A finished agent turn resolves into a legible, sourced journal entry. The user's note stays intact. A pin makes a meaningful version easier to find. The rescue ends in a quiet report. No celebration on destructive actions.

**Risk to test.** A document can become too tall. The useful history must not disappear below a large hero and a feed. Test with 60 save points and long titles, not only this demo. The serif should not make reading code or commands harder. Use the mono face there.

## Direction B: Instrument

### The screen

The app becomes the face of the website's device. A dark display carries one status and a horizontal ruler. A knurled dial on the right selects save points with detents. It changes selection only. It never starts a restore. One raised cobalt key performs the state-appropriate primary action. A quiet alternative sits below it.

The display names the playhead's time, title, author, verdict and check evidence. The current project status stays separate from the historical selection. In Broken, the dial parks on the last version that passed. The red Now tick stays visible. A dim veil marks later history without implying it is deleted.

Agent channels are below the display. A small Ask module prints a cited answer on a paper-like inset. After a rewind, that space becomes the report. No gauges, scores or meters of “safety”. The demo's small channel bars mean activity only, never correctness.

### Visual system

| Role | Light | Dark |
|---|---|---|
| Chassis | `#E6E4DE` | `#1D1D1C` |
| Faceplate highlight | `#EFEEEA` | `#252524` |
| Recess | `#D6D3CB` | `#141413` |
| Silkscreen | `#57544D` | `#B4B0A6` |
| Display | `#0E100F` | `#080908` |
| Display ink | `#ECEAE2` | `#ECEAE2` |
| Display secondary | `#8E8B83` | `#8E8B83` |
| Cobalt | `#2F54EB` | `#7088FF` |
| Cobalt key ink | `#FFFFFF` | `#0B0F24` |
| Report paper | `#FBFAF6` | `#2A2925` |
| Works on display | `#4ADE80` | `#4ADE80` |
| Broken on display | `#F87171` | `#F87171` |

The screen stays dark in light mode. That is the material contrast. Cobalt belongs to the control, index and focus, never to a check result. Light mode is aluminium, not white plastic. Dark mode is graphite, not a flat inversion. Use static gradients and inset edges sparingly. No real-time 3D renderer is needed in the app.

**Type.** Geist 400/500/600 for UI and status, 40/42 px for the display headline. Geist Mono 400/500 for 10 to 12 px indexing, timestamps and readouts. A sharper, mechanical contrast to Notebook's Newsreader. Small technical labels support orientation but never replace plain words. Tabular numerals hold their position as the playhead changes.

**Space.** A 4 px base. An 18 px outer gutter, 14 px module gaps, a 316 px control module and a 424 px top deck at 1280 by 800. A 180 px knob gives the hero a deliberate physical scale. A 58 px primary key is easy to locate. The lower deck is for context, not more equally weighted actions.

**Motion.** Power-on is a single 550 ms transform/opacity scan, not a long intro that blocks use. The dial snaps to a selected save point in 160 ms. The playhead travels in 300 ms. Key press moves down 4 px for 120 ms. Agent channel bars use transform only and stop when idle. Reduced motion removes scans, printing, spring effects and activity loops. No per-frame lighting, animated blur, canvas, WebGL or scroll listener. The tactile appearance is static CSS.

**Empty state and first value.** A display with no timeline says “Not checked yet.” The one key says Save and check. The dial has no false green detents. A short caption explains that the first tick appears after a save. The initial demo uses a bundled sample project with a real check, not an animated fake verdict.

**Useful delight.** Turning a detent moves a real selection with a visible timestamp. A rewind's end prints the facts that came back and the facts that did not. This is a receipt, not a trophy.

**Risk to test.** A knob can be slower than clicking a row. Do not ship it as the only path. The mockup supports wheel, drag, J/L and left/right keys, plus clicking ruler ticks. Labels must survive magnification and grayscale. The very dark display must stay legible in bright rooms. Hardware styling must not consume the room needed for a long title or a serious failure reason.

## Founder-hinted feature surface

Every item below is **concept only in this study**. The static interactions do not establish an implementation or change MVP scope. Existing code may evolve independently. Check the build brief and actual code before making a public capability claim.

### Ask about a project's history: concept only

- A right-edge panel in Notebook. A compact printout in Instrument.
- Questions: “When did checkout break?”, “What did Codex change today?”, “Which save points touched the cart?”, “Is it safe to go back to 3:49?”
- Every factual answer links to save points, file lists or check logs. It states what it used and where uncertainty remains.
- Example: the first checked failure is at 5:02. Two earlier points were not checked. Say it may have broken earlier, not that the exact change is proven.
- Local facts first. Any cloud model needs per-project opt-in, a preview of what leaves the Mac and secret filtering. Do not silently send history to a model. The concept itself sends nothing.
- Ask never runs a command or starts a rewind from generated prose. An explicit, reviewable action must stay separate.
- A generic chat subscription is not the proposition. Finding the relevant evidence in accumulated project history is.

### Multiple agent activity channels: concept only

- Claude Code, Cursor, Codex and Gemini CLI are named in plain text. No third-party logos are required.
- Show connected, idle, working or not connected. An integration name is not proof that a hook exists for it. The current brief identifies Claude Code first.
- Read actual hook/session events. Distinguish agent, project, session and worktree when several run at once. Do not infer attribution from who last edited a file.
- Collapse noisy commands into a turn summary. Keep the actual log available. Show “Agent said” beside “We ran”. Never turn agent-reported tests into PASS evidence.
- No leaderboard, single agent score, blame language or fake streaming. The synthetic feed in these files is labeled concept.

### Richer overlays: concept only

These extend the existing overlay patterns, not permission to create more interruptions.

| Surface | Proposed form | Attention rule |
|---|---|---|
| Agent pill | Small text pill, expands to “Codex is working · marigold-tips”. A multiple-agent case says “2 agents working” and opens the local session list on request. | Only exists while an agent is active. No green unless it refers to a specific recorded PASS. Never steals focus. User can hide it. |
| Break card | “Something broke after the last change.” Name the last working save point, exact failed check and two-click rescue. | One card. No repeated identical FAIL. Respect Focus and full-screen apps. Keep it reachable after dismissing. No alarm animation. |
| Timeline strip | The same left-to-right ruler and ink playhead as the main app, with an agent-session lane and a small evidence popover. | Summoned by the user. Keyboard focus is then expected. Escape returns to the previous app. It never auto-opens. |

Notebook uses paper, a hairline and the ribbon accent. Instrument uses the inset display, cobalt index and a raised key. Automatic pill and card never appear together. No stack of overlapping notifications. These overlay variants are described here, not wired to the operating system in the mockups.

### Per-save-point deploy chip: possibility, concept only

“Deployed to Vercel preview” could be a read-only reference attached to a specific save point. It would need an explicit provider connection, an exact commit/deployment match and a timestamp. Unknown or stale mappings stay unknown. A chip cannot imply that the current deployed site is healthy, or that restoring code rolls a deployment back.

The mockups show a dashed **Vercel preview · read only** chip on the 3:49 save point. It is synthetic. No API is called. Time Machine does not deploy, replace production or reverse an external deployment. A provider integration requires a separate scope decision. It is not included by this design study.

## What these files demonstrate

- `concepts/app-v3-a.html`: Notebook main screen, Broken state, confirmation sheet and Rewind done report. The main screen includes a synthetic live multi-agent feed and a cited Ask panel.
- `concepts/app-v3-b.html`: Instrument main screen, Broken state, confirmation strip and Rewind done report. The dial works as a selection control. Ask citations move the playhead.
- URL parameters: `?state=works|broken|done&theme=light|dark`. Add `&shot=1` to hide the concept state switcher and stop demo event timers. Reduced motion also stops animations and live timers.
- Each HTML contains its CSS, JS, font bytes and full OFL notice. It can be opened from disk with the network disconnected. No runtime package or font request is needed.
- Font sources: [Newsreader](https://github.com/productiontype/Newsreader), [Inter](https://github.com/rsms/inter), [Geist and Geist Mono](https://github.com/vercel/geist-font), distributed as Latin WOFF2 subsets by [Fontsource](https://fontsource.org/). All are OFL 1.1. Notices are embedded in each HTML file.
- Main and secondary actions are illustrative unless covered by the interactions above. The files never touch a real project. Only the suggested Ask questions have canned answers. Unrecognized questions say so. This is not a working AI assistant.

## Evidence and decision gate

The reference task is a Mac desktop project screen at 1280 by 800. The audience is a builder who has let an agent work and needs to understand what happened, then rescue a checked version without changing the working folder by accident.

Observation: the existing preview has plain save-point rows and a large status, but the founder wants more perceived craft and useful depth. That founder feedback is the evidence for exploring a new direction. It is not evidence that a journal or a dial improves task success.

Proposed change: make provenance, named versions and recovery limits structural. Test a journal against a hardware-like selector. A keyboard route, fixed words, visible limits and reduced-motion treatment are guardrails in both.

Before production approval, run five moderated sessions as required by `EXPERIENCE.md`. Ask each person to:

1. Explain the status and what “Works” proves.
2. Find what changed after the last checked version.
3. Explain whether the exact breaking change is known.
4. Prepare the 3:49 version and explain where it now exists.
5. Name at least two things that did not come back.
6. Find an unchecked version without calling it working.

Primary measure: a correct, informed rescue. Guardrails: wrong target, mistaken belief that the working folder or deployment changed, failure to notice missing data, keyboard traps and unreadable captions. Segment by Git familiarity and input method. Compliments, time in app and clicks are not the decision rule. Reject a direction that improves visual preference while worsening comprehension or recovery errors. A person approves the actual interface and any public claims.

## Screenshots and exercised checks

The `concepts/shots/` PNGs are 1280 by 800, device scale 1. Each concept has Works, Broken and Rewind done in both themes. They are static captures of demo data, not real verification results. All twelve are below 400 KB and are committed.

Naming: `app-v3-{a|b}-{works|broken|done}-{light|dark}.png`.

Playwright opened each HTML from `file://`, waited for embedded fonts, and captured each state. It listened for page errors, console warnings/errors, failed requests and network requests. The two-click Broken → confirmation → Rewind done flow was also exercised. No whole test suite, app build or website change is part of this assignment. The concepts do not establish real engine correctness, integration readiness or accessibility conformance.
