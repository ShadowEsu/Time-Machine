# Time Machine for Mac: App Design Spec (R3)

Date: 14 October 2026. Design and research only. Nothing here is built.
Builds on: `docs/BUILD_BRIEF.md` (sections 3 and 4 Phase B), `.private/research/12-app-overlay-npm-tech.md` (overlay tech, screens, labels, Electron, permissions), `.private/research/03-website-design.md` section 7 (Monolith brand).

"Time Machine" is a working name only (Apple holds the mark for this exact kind of software, see brief section 9). Every visual idea below is designed so it survives a rename: no clock, no clock with arrow, no star field, no Apple tokens. Where the product name appears in copy, read it as `{App}`.

Scope note: the desktop app is Phase B (D01 to D08). Everything marked v1.5 or v2 is beyond the current scope and needs the founder to change scope first.

Status of this file: complete. Sections 0 to 12 plus sources.

---

## 0. The idea in one paragraph

Most tools let you go back. This app tells you **which version actually works**, proves it by rebuilding it in a safe copy, and then hands it to you on a new branch with your broken version saved too. The design has one job: make that proof visible and that rewind feel effortless. Time runs left to right on a ruler. A playhead marks where you are. Ticks turn green only when a real check passed. Everything else is quiet.

The single memorable moment is the **Rewind**: the screen pulls back into a depth view of your project's past, the playhead slides to the last green tick, the old version rebuilds live in front of you, a verdict stamps down, and one keypress forks a new branch from that point. It should take about one second when the answer is already known, and it should still feel like magic when it is not.

---

## 1. Design principles

Eight principles, each with the rule it produces. When two conflict, the earlier one wins.

| # | Principle | What it means | The rule it produces |
|---|---|---|---|
| 1 | **Green is earned** | Color is a verdict, never decoration. The whole interface is ink on paper until a check speaks. | No green pixel anywhere without a recorded PASS for that exact save point. No interpolated color between ticks. Unchecked is a hollow grey ring, always. |
| 2 | **Honest edges** | Every promise has a visible boundary. What did not come back is as prominent as what did. | Every result screen, card and report has a "Not brought back" list in the same type size as the "Brought back" list. It is never folded away. |
| 3 | **Rehearse, then commit** | Nothing touches the real folder until the user has seen the old version work in a safe copy. Committing is reversible. | Try comes before Use. Use always saves the current state first and always makes a new branch. Undo is one keypress. The app never pushes, merges, deploys or deletes. |
| 4 | **The playhead is the product** | One spatial model everywhere: past on the left, now on the right, a playhead marking where you are looking. | Every surface that shows history (History screen, Time View, timeline strip, menu bar mini ruler, Compare header) uses the same horizontal ruler and the same playhead glyph. |
| 5 | **Quiet until it matters** | The app lives next to your agent and your editor. It speaks only when a verdict changes, when something risky happens, or when you ask. | Overlays never take focus. One card on screen at a time. Repeat news is folded into the menu bar dot, not shown again. |
| 6 | **Plain first, precise on demand** | A sentence for everyone, the evidence for anyone who wants it, one click apart. | Every plain statement has a "Details" disclosure with the exact commit, command, log and file list. A global "Show technical details" setting opens them by default for developers. |
| 7 | **Fast as a thought** | Speed is a feature of trust. A slow restore tool feels risky. | Every common action reachable in two keystrokes. Lists render from local data in under 100 ms. Animations never block input: pressing Enter mid animation completes the action. |
| 8 | **Your code stays home** | The app reads source code, so privacy is the default, not a setting to find. | AI features run from local facts first and an on device model second. Cloud is opt in, per project, with a "Preview what we send" button. Secret values are never read into the UI at all. |

Two anti principles (things this app is not):

- **Not a dashboard.** No charts for their own sake. The activity graph exists only to point at the break.
- **Not a slot machine.** Fun lives in the Rewind moment and the verdict stamp. It never lives in notifications, streaks or badges.

---

## 2. Reference study

What to take from each product, how it changes for this app, and what to avoid. "Steal" means steal the pattern, never the visual assets.

| Reference | The specific pattern | How we adapt it | What we avoid |
|---|---|---|---|
| **Apple Time Machine** (restore view) | Entering a separate "time space" where past versions of the current window stack back in depth; a tick ruler on the screen edge; hovering the ruler magnifies ticks like the Dock; faint ticks for backups still loading; one big Restore button; Cancel returns you exactly where you were. | The **Time View** keeps the "enter a separate space" ritual and the depth stack, but the stack recedes to the **left** along the same axis as time, the ruler runs along the **bottom** (horizontal, like a video editor), and ticks carry **verdict color**. Hover magnification on the ruler (Dock style, max 1.6x, falloff over 5 ticks). Loading ticks pulse at 30 percent opacity, exactly like Apple's faint ticks, meaning "checking". Escape always returns you to exactly where you were. | The star field, the vertical right edge ruler, the clock icon, the green and black swirl icon, the word "Restore" (we say "Use this version"), and the idea that restoring overwrites. Ours forks. |
| **Linear** | Speed as identity; single key shortcuts discoverable on hover; Cmd K command menu that can do everything; dense but calm lists; optimistic UI; subtle key feedback when a shortcut fires. | Every action has a single key or Cmd chord shown in its tooltip. When a shortcut fires, the matching button flashes its pressed state for 120 ms so users learn shortcuts by seeing them (Linear's visual key feedback). History rows are 44 px with hover revealed actions. | The all dark, low contrast aesthetic. This app serves non technical users too, so light mode is the default and contrast is AA or better everywhere. |
| **Raycast** (2.0, Tahoe styled) | A hotkey palette that is the whole app in a text field; actions panel (Cmd K inside a result); fuzzy search; results with right aligned accessories; disappears on blur. | **Ask bar** (Option Space by default, user configurable): type "rewind to before Stripe", "check it", "compare 10:42 with now", "what broke". Results show save points with verdict accessories. Cmd K on a result opens its actions. Same palette inside the main window (Cmd K). | Extensions, a store, chat. The palette resolves to actions on save points and nothing else. |
| **Arc** | Peek previews (open a link in a floating preview without leaving the page); Little Arc (a tiny window for a quick task); Spaces with their own color; small moments of delight (onboarding sound, the way things snap). | **Try it first** opens the rebuilt old version in a peek style floating preview of its running local URL, so the user sees the old app working without a browser tab mess. Projects can get a monochrome pattern (not a color) for identity, because color is reserved for verdicts. | Per project color themes (would collide with verdict color). Novelty navigation. |
| **Things 3** | Calm typography; generous whitespace; the Magic Plus button you can drag to the exact spot where a new item should go; satisfying checkbox animation; fully keyboard driven. | **Pin** a save point by parking the playhead on a tick and pressing P, or by dragging any history row up onto the Pinned shelf; it lands exactly where you drop it, Magic Plus style. The verdict stamp animation borrows the checkbox's confident spring. Typography: Things' calm, roomy headers over Linear density for list rows. | Hidden gestures as the only path. Every drag has a button and a shortcut too. |
| **CleanShot X** (Quick Access Overlay) | A small card in a screen corner after an event, 2 to 4 actions, auto close after N seconds, pause on hover, configurable corner, "restore recently closed", swipe to dismiss. | The **corner event card** is this pattern exactly: bottom right by default, max 2 buttons plus dismiss, auto hide after 8 s (FAIL cards do not auto hide), hover pauses, two finger swipe right dismisses, menu bar keeps "Recent cards" so nothing is lost. | Stacking many cards. We show one and fold the rest into a count ("+2 more"). |
| **Wispr Flow** (Flow Bar) | A tiny persistent pill at bottom center that expands while active; draggable to screen edges; can be hidden in full screen apps. | **Agent pill**: appears only while a connected agent is running a turn. Resting it is a 44 x 10 px capsule with a slow pulse; on hover it expands to "Claude Code is working · 3 save points this session". It docks to any edge, remembers its spot per display, and hides itself in full screen apps. | Always on presence. When no agent is running, the pill does not exist. Complaints about Wispr's bubble covering content are the warning. |
| **Granola** | Your own typing is black, AI additions are grey, so provenance is always visible; the AI enhances a human artifact instead of replacing it. | **AI text is grey ink with a small AI tag; facts are black.** A save point title written by the user or taken from the agent's prompt is black. A generated summary is grey until the user edits or accepts it, then it turns black. In "What broke?", every AI sentence links to the fact it rests on. | Long AI prose. Summaries cap at two sentences. |
| **Figma version history** | Autosaves collapse into groups between named versions; named versions have a title, description, author and avatar; non destructive restore. | Auto save points collapse between "important" ones (named, pinned, agent turn ends, verdict changes). The default filter is **Important**. A collapsed group reads "12 autosaves · 2:10 to 2:55 pm" and expands inline. | Figma's lack of filters (a known forum complaint). We ship the Important / Everything toggle from day one. |
| **Google Docs history** | Right side panel grouped by day; author colors; "Only show named versions"; Restore at the top of the preview; changes highlighted in the preview. | Day grouping ("Today", "Yesterday", "Mon 12 Oct"). Author is an icon and a word (You, Claude Code, Cursor, Codex, Scheduled, Safety save) rather than a color, because color is reserved. "Use this version" sits at the top of the detail view, never at the bottom. | Author colors. |
| **Lovable history** | Every change is a version; History and Bookmarks tabs; a read only preview; **Back to latest**; revert creates a new entry so it is undoable; a Published badge; docs say plainly that revert restores code, not database data. | Rewind creates a new branch and a new entry, never erases later history. A persistent **Back to now** button appears whenever you are looking at the past. We copy Lovable's honesty ("does not roll back your database") and make it structural with the "Not brought back" list. | Hiding the limits in docs. Ours are on the screen. |
| **Dropbox Rewind** | An activity graph where you pick the day just before the spike; a fine tune list where everything after your pick greys out to show what will be undone. | The **activity band** above the ruler shows files changed per save point as thin bars. Verdict ticks sit under it, so a spike of changes followed by a red tick is easy to read. When the playhead moves into the past, everything to its right **greys to 35 percent** to show "this is what you are stepping back from", exactly like Dropbox's blue line. | Implying those later changes will be deleted. The copy says "These stay saved. You can come back." |
| **Video editors** (Final Cut, Premiere, DaVinci, Descript) | A playhead you scrub; hover skimming shows the frame under the cursor; markers; J K L keys for back, pause, forward; clips grouped on tracks; snapping with a tactile click. | The playhead glyph is the brand. **Skimming**: moving the pointer over the ruler shows that save point's screenshot in the Time View stage without committing. J and L step one save point, Shift J and Shift L jump to the previous or next verdict change, K stops. Agent sessions appear as **clips** (a rounded band spanning their save points) on a lane above the ruler. Snapping to ticks with an alignment haptic. | Pro editor complexity: no zoom levels beyond three (Hour, Day, All), no multiple tracks in v1. |
| **Apple's own HUDs** (volume, Focus) | Shows state briefly, no buttons, no focus steal. | Used for tiny confirmations only: "Saved" after Cmd S, a 1.2 s HUD with a tick mark that fills. | |

Sources consulted for this pass are listed at the end of the file.

---

## 3. Signature interaction: the Rewind

### 3.1 The Time View

The Time View is a full window scene (and optionally full screen, Ctrl Cmd F) that the user enters from the Rewind button, the red corner card, the Ask bar, or Cmd Shift R. It is the "enter Time Machine" ritual, modernized: horizontal, verdict colored, and live.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●   acme-shop                        1 Find ─── 2 Try ─── 3 Use ─── 4 Done   Esc │
│                                                                                      │
│      ░░░                                                                             │
│     ░░░░░  ▒▒▒▒▒                                                                     │
│    ░ 9:58 ░ ▒ 10:20 ▒  ┌──────────────────────────────────────────┐                  │
│     ░░░░░  ▒▒▒▒▒▒▒▒▒   │                                          │   ┌───────────┐   │
│      ░░░    ▒▒▒▒▒▒▒    │      [ screenshot of the app at 10:42 ]  │   │  NOW      │   │
│                        │                                          │   │  3:14 pm  │   │
│                        │                                          │   │  ◆ Broken │   │
│                        └──────────────────────────────────────────┘   └───────────┘   │
│                          10:42 am · Added dark mode · Claude Code                      │
│                          ● WORKS   Tests passed in 41 s · safe copy                    │
│                                                                                      │
│      Comes back                          Does not come back                          │
│      ✓ Code (commit 3f9a1c2)             ◌ Database contents                         │
│      ✓ 4 files outside Git               ◌ Secret values (3 names kept)              │
│      ✓ Settings: 6 config keys           ◌ Anything already deployed                 │
│      ✓ Packages and Node 24              ◌ Emails or payments already sent           │
│                                                                                      │
│      [ Try it first  T ]   [ Compare with now  C ]   [ Use this version  ↵ ]          │
│                                                                                      │
│  Claude Code session ▕████████████████████████████████████████▏                       │
│  ▁ ▂ ▁ ▃ ▁ ▂ ▅ ▁ ▂ ▁ ▁ ▂ ▃ ▇ █ ▆ ▂ ▁                                                 │
│  ●─●─○─●─●─●─●─●─▼─◆─◆─○─◆─◆─◆─◆─◆─◆                                                 │
│  9:30          10:00          10:42  11:00          12:00     2:00     3:14 NOW       │
│                                 ▲ playhead                                            │
└──────────────────────────────────────────────────────────────────────────────────────┘
 ● works   ◆ broken   ○ not checked   (dimmed to the right of the playhead)
```

Anatomy:

1. **The stage (center).** The selected save point as a large card: a live screenshot of the app's home page at that save point (taken during the check, research 12 section 9.3 phase 11) or, for projects with no screen, a **fingerprint card** (title, two line summary, a mosaic of changed files as small grey squares grouped by area: pages, components, packages, settings, tests).
2. **The depth corridor (left).** Older save points stack behind the stage, receding up and to the left along a gentle vanishing line. Each step back is 8 percent smaller, 14 px higher, 40 px further left, and 18 percent lower opacity, so about five cards are visible before they fade into the paper. No stars, no space, no clock. Just paper and depth. In dark mode, the corridor fades into ink.
3. **The Now card (right).** A smaller, fixed card that always shows the current state and its verdict. It is the anchor that says "you are still here, nothing has changed yet". Clicking it or pressing Esc returns to the present.
4. **The verdict line.** Under the stage: time, title, author, then the verdict badge and evidence line ("Tests passed in 41 s · safe copy"). The isolation mode is always named (rule V14: a host mode PASS is always labeled).
5. **Comes back / Does not come back.** Two equal columns, from the coverage report. Never folded.
6. **The ruler (bottom).** Three stacked rows that share one x axis:
   - **Session lane:** agent sessions as rounded clips ("Claude Code session"), manual work as an empty lane.
   - **Activity band:** thin bars, height = files changed in that save point (log scaled, max 24 px). Grey only.
   - **Tick row:** one tick per save point with its verdict glyph. Important save points are tall ticks, autosaves short. Time labels under it with tabular numbers.
7. **The playhead.** An ink vertical line with the rewind triangle as its head. It sits on the selected tick. Everything to its right dims to 35 percent (the Dropbox Rewind blue line idea) with the label "These stay saved".
8. **The step bar (top).** Find, Try, Use, Done. It is the accessible wizard (D04) living inside the scene. The same steps exist as a plain sheet when reduced motion or "Simple rewind" is on.

### 3.2 The choreography

The Rewind has two speeds. **Known answer:** the newest PASS is already recorded and nothing changed since. **Unknown answer:** the app must run `find-good` live.

**A. Known answer (target: ready to commit in 1.2 s)**

| t (ms) | What happens | Motion |
|---|---|---|
| 0 | User presses Cmd Shift R or clicks Rewind. Input is immediately live: Enter at any point skips to step "Use". | |
| 0 to 280 | The current window content scales to 0.62 and slides right to become the **Now card**. Background shifts from paper to mist. | `scene` 280 ms, ease out (0.22, 1, 0.36, 1) |
| 80 to 360 | The ruler rises from the bottom edge (24 px travel, fade in). | `base` 220 ms, ease out, 80 ms delay |
| 120 to 520 | Older cards fan into the corridor from behind the Now card, staggered 24 ms each, newest first. | `slow` 320 ms each, ease out |
| 360 to 780 | The playhead **glides left** from Now to the newest green tick. It passes over red ticks, and each one it crosses gives a tiny 1 px bump (the ticks "flick" as it passes, like a fingertip over piano keys). | 420 ms, ease in out (0.65, 0, 0.35, 1), with a 6 percent overshoot spring settle (stiffness 380, damping 30) |
| 780 to 1000 | The matching card moves to the stage. Its verdict badge **stamps**: scale 0.7 to 1.06 to 1, opacity 0 to 1. A green hairline traces once around the card (300 ms) and then rests as a 1 px green frame. | stamp spring: stiffness 400, damping 28, mass 1 |
| 1000 to 1200 | Comes back / Does not come back lists fade up, 30 ms stagger per line. The primary button gains focus. | `quick` 140 ms each |

Sound: a soft two note rise (perfect fifth, under 250 ms total, -18 LUFS) on the stamp. Haptic: one `levelChange` on the stamp on Force Touch trackpads.

**B. Unknown answer (live find-good)**

The same entry, then the playhead walks left **one candidate at a time**, and the stage shows the rebuild happening.

```
 stage card while checking 11:20
 ┌──────────────────────────────────────────────┐
 │  [ screenshot of 11:20 at 30% opacity ]      │
 │                                              │
 │   ✓ Made a safe copy                 0.4 s   │
 │   ✓ Put back 4 files outside Git     0.1 s   │
 │   ◌ Installing packages (cached)     2.1 s   │
 │   · Running your check: npm test             │
 │                                              │
 │   > vitest run  ·  12 passed  ·  running...  │  ← one line live log, Geist Mono, expandable
 └──────────────────────────────────────────────┘
   Checking 11:20 · 2 of up to 6 · about 40 s left
```

- The tick under the playhead **breathes** (opacity 30 to 70 percent, 1.2 s loop) while it is checked. This is the one place we keep Apple's "faint tick" idea.
- When a check ends, the verdict stamps onto the tick. A FAIL stamp is deliberately smaller and quieter than a PASS stamp (no frame trace, no sound, a 1 px horizontal nudge of 4 px like a head shake, 180 ms). Then the playhead steps left to the next candidate (240 ms ease in out).
- When a PASS lands, the full known answer finale plays (stamp, frame trace, sound, lists).
- If the check returns **INCOMPLETE, BLOCKED or ERROR**, the tick takes that glyph, the stage says why in one sentence, and the walk continues automatically. The final screen lists every skipped save point and why ("2 could not be checked: missing value for DATABASE_URL"). We never present a skipped save point as working.
- The user can stop the walk at any time (Space or K). The stage then offers "Check this one" for the save point under the playhead.
- Long waits are honest: an ETA from the last check duration, and a "Keep going in the background" button that collapses the scene into the menu bar and sends a card when done.

**C. Use this version (the fork)**

When the user presses Enter on "Use this version", an inline confirmation replaces the button row (no modal alert):

```
  We will:
   1. Save your current version first (so this is undoable)
   2. Make a new branch  tm/recover/2026-10-14-1042  from 10:42
   3. Switch your project folder to that branch
  We will not push, merge, deploy or delete anything.

  [ Cancel  Esc ]                                  [ Do it  ↵ ]
```

Then the signature visual: **the timeline forks.**

| t (ms) | What happens |
|---|---|
| 0 to 200 | The Now card gets a "Saved" stamp (it becomes a save point titled "Before rewind" and drops onto the ruler as a new tick at the far right). |
| 200 to 600 | From the 10:42 tick, a new lane **branches upward** above the ruler: a hairline curve (like a railway switch) that draws left to right in 400 ms. The old lane to the right of the fork stays visible, dimmed, labeled "Your other version (saved)". |
| 600 to 960 | The stage card lifts, scales to fill the window, and the scene dissolves back into the History screen, now showing the new branch as the current line. |
| 960 | A recovery report toast slides in at the top of History: "You are on the 10:42 version. Nothing was pushed or deleted." with **Undo (Cmd Z)** and **See report**. |

Sound: a single low, soft "settle" (a damped wooden knock, 120 ms). Haptic: `alignment` once when the fork line completes.

**Undo** plays the fork in reverse (the branch line retracts, the "Before rewind" save point moves back to Now) in 480 ms, and the report records both actions in the audit log.

### 3.3 Scrubbing and skimming

- **Drag the playhead** or click any tick to select a save point. The stage updates in under 50 ms from the cached screenshot (thumbnails pre-decoded for the visible range).
- **Skim:** hovering the ruler without clicking shows that save point's screenshot as a ghost on the stage (60 percent opacity) and a tooltip "10:20 · Fixed lint errors · Not checked". Moving away restores the selection. This is the video editor skimming idea and is the fastest way for a non technical user to recognize "the version where the button was still blue".
- **Snapping:** the playhead snaps to ticks with a 6 px magnet. On Force Touch trackpads each snap gives an `alignment` haptic. Holding Option disables snapping (for free scrubbing across a dense day).
- **Zoom:** three levels only: Hour, Day, All (keys 1, 2, 3, or pinch). Zoom anchors on the playhead.
- **Keyboard:** J and L step one save point, Shift J and Shift L jump to the previous or next verdict change (the most useful jump: "where did it go red?"), Home jumps to the first save point, End to Now.

### 3.4 Motion, sound and haptics rules for the Rewind

- Total entrance under 1.2 s. Nothing loops except the "checking" breath and the agent pill.
- Arrivals ease out, exits ease in, travel along the ruler uses ease in out.
- Springs are reserved for two things: the verdict stamp and the playhead settle.
- Reduced motion: no depth corridor movement, no glide. Cards cross fade (120 ms), the playhead jumps, the fork line appears without drawing. All information is identical.
- Sounds are **off by default in overlays**, on by default in the Time View at low volume, and always follow the macOS "Play user interface sound effects" setting. Three sounds total in the whole app: stamp (PASS), settle (fork done), tick (scrub snap, off by default). FAIL has **no sound**. A tool that beeps when things break becomes a tool people mute.
- Haptics need a native call (`NSHapticFeedbackManager`). Electron has no haptics API, so this rides on the small signed Swift helper that research 12 already proposes for Apple Foundation Models. If the helper is not in v1, haptics ship in v1.5.

### 3.5 Why this moment works

- It turns an anxious act (going back) into a **visible proof** (the check runs in front of you).
- It turns a destructive mental model (overwrite) into a **constructive one** (a fork you can see, with your other version still there).
- It is fast enough that a developer will use it daily and calm enough that a non technical builder trusts it the first time.

---

## 4. AI features

### 4.1 The rule for AI in this app

**Facts decide. AI phrases.** Every AI output is built on a fact layer the engine already produces (diff stats, package changes, config key changes, coverage report, verdicts, failing test names, the agent's own prompt and last message). The model may summarize, rank and explain those facts. It may never create a verdict, never mark anything as working, and never claim something was restored. If the model fails, times out or is off, the deterministic template text appears instead and the feature still works.

Visual provenance (from Granola): facts in ink, AI wording in ink 3 with a small `AI` tag in Geist Mono. When the user edits or accepts an AI title, it turns ink and the tag disappears. Every AI claim that refers to a fact is a link to that fact (a diff hunk, a log line, a package change).

### 4.2 The five AI features

#### 1. Plain English titles and summaries

- **What:** "Claude added a login page with Google sign in" instead of `a1b2c3d`. Two sentence summary for non programmers, plus risk notes ("Changed the database schema", "Deleted 3 files").
- **Sources in order:** user's own note; agent prompt (UserPromptSubmit) and last message (Stop); deterministic template from file paths and package diffs; on device model; opt in cloud model (research 12 section 4).
- **UI:** titles appear on every row; summary on the detail view. Click the title to edit. A "Regenerate" action exists only when a model is on.

#### 2. "What broke?"

The diagnosis that compares the **last working** save point with **now** (or any FAIL with the PASS before it).

```
┌ What broke? ───────────────────────────────────────────────────────────────┐
│ Last working: 10:42 Added dark mode  ●  ·  Now: 3:14 pm  ◆                 │
│                                                                            │
│ What we know (facts)                                                       │
│   ◆ 3 tests fail now: auth.test.ts › "signs in with Google" and 2 more     │
│   · 14 files changed in 6 save points by Claude Code                       │
│   · New package: next-auth 5.2.0                                           │
│   · Config key changed: NEXTAUTH_URL (value not shown, it changed)         │
│                                                                            │
│ Most likely cause                                                AI  ⓘ     │
│   The failing tests import src/lib/session.ts, which Claude rewrote at     │
│   11:20 while fixing a lint error. The test expects a session object       │
│   and now gets undefined.                     [ See the change → ]         │
│                                                                            │
│ Find the exact save point where it broke                                   │
│   [ Find where it broke ]  checks the 6 save points in between, ~1 min     │
│                                                                            │
│ [ Rewind to 10:42 ]   [ Copy a fix prompt for Claude ]   [ Compare ]       │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Deterministic core:** changed files between the two save points, intersected with the files named in failing test stack traces, ranked by overlap. Package and config changes listed. Works with AI off.
- **"Find where it broke"** is a bisect over the save points in between, using real checks. Its answer is a verdict, not a guess: "It broke at 11:20, Fixed lint errors. 11:05 works, 11:20 is broken." This is the feature that no built in rewind has.
- **"Copy a fix prompt"** puts a short, factual prompt on the clipboard for the user's agent ("Tests passed at save point 10:42 and fail now. Failing: ... Changed since: ... Do not change the tests."). In Claude Code with the hook installed, the async verify already wakes Claude (research 12 section 8.2); the button exists for other agents and for people.
- AI wording is always hedged: "Most likely", "Possibly". Never "The cause is".

#### 3. Natural language rewind

"Go back to before I added Stripe." "The version from yesterday morning that worked." "Before Cursor touched the checkout page."

- **Parsing:** a small local intent grammar handles time ("yesterday morning", "before lunch", "2 hours ago"), actors ("Claude", "Cursor", "I"), and verdicts ("that worked"). Free text terms ("Stripe", "checkout page") are matched against a local index of titles, agent prompts, package names added or removed, file paths and config key names. The on device model is only a fallback for phrasing the grammar cannot parse.
- **Answer UI** (in the Ask bar or Time View):

```
  "before I added Stripe"
  ─────────────────────────────────────────────────────────────
  I matched "Stripe" to:  package stripe 17.2 added at 2:05 pm
  The save point just before it:
    1:52 pm · Cart totals in one place · ○ Not checked yet
  [ Check it and rewind ↵ ]     [ Show 3 other matches ]
```

- **Never jumps silently.** It always shows what it matched and why, and the normal Find, Try, Use flow follows. If the match is uncertain (two candidates within a close score), it shows both.

#### 4. "Is it safe to rewind?"

A plain explanation of what will and will not come back, shown in the Time View and the wizard, generated from the coverage report plus detected side effects between the two save points.

```
  Rewinding to 10:42 brings back your code, 4 files outside Git, 6 settings
  and your packages.

  Things that happened after 10:42 that a rewind cannot undo:
   ◌ A database migration ran at 11:40 (prisma/migrations changed).
     Your database still has the new columns.
   ◌ Claude ran "vercel deploy" at 12:15. That deploy is still live.
   ◌ Secret values are never saved. You may need to re-enter STRIPE_KEY.
  Always true: emails sent, payments taken and messages posted stay sent.
```

- **Detection is deterministic:** migration folders changed; agent tool logs show deploy, publish, push, `db reset`, `curl -X POST` style commands (from PreToolUse records); env key changes. Unknown is said as unknown: the last line ("Always true") is unconditional.
- AI may rephrase for reading level. It may not remove a line.

#### 5. Agent watch

Watches connected agents through hooks (research 12 section 8) and turns their activity into calm, factual signals.

| Signal | Source | How it is shown | Can it say "broken"? |
|---|---|---|---|
| Verdict regression (PASS then FAIL after a turn) | Stop hook, async verify | Red corner card, red menu bar dot | **Yes. The only signal allowed to.** |
| Agent's own test run failed | PostToolUse on the test command | Grey hint line in the agent pill: "Claude's own test run failed. We'll check when it's done." | No, hint only |
| Risky command about to run | PreToolUse pattern match | Safety save card (auto hides) | No |
| Large deletion or lockfile churn | Diff since last save point | A note on that save point row: "Claude deleted 14 files" | No |
| Agent stuck in a loop (5 turns, same failing test) | Verdict history plus prompts | One card per session: "Claude has tried 5 times. Last working: 10:42." | No (it reports, it does not judge) |

Watch mode is per project and per agent. It is on after the user connects an agent in onboarding, and it can be paused from the menu bar for 1 hour, until tomorrow, or indefinitely.

### 4.3 Where AI runs: local versus opt in cloud

| Feature | Always local (no model) | On this Mac (model) | Cloud (opt in) |
|---|---|---|---|
| Titles | Agent prompt, user note, path templates | Apple Foundation Models via the Swift helper (Apple Silicon with Apple Intelligence), or Ollama if installed | Claude Haiku with the user's own API key (v1.5) |
| Summaries and risk notes | Template ("Changed 12 files in pages, added next-auth") | Same as above | Same as above |
| What broke? | Facts, overlap ranking, bisect | Phrasing of the likely cause | Better phrasing on long diffs |
| Natural language rewind | Intent grammar, local index | Fallback parsing | Not offered (not needed) |
| Is it safe to rewind? | All detection | Reading level rewrite | Not offered |
| Agent watch | Everything | Nothing | Nothing |

Defaults:

- **Cloud is off.** Turning it on is per project, needs the user's own key in v1.5 (a hosted proxy needs accounts and billing, out of scope), and shows a **Preview what we send** sheet with the exact payload.
- **Never sent:** captured untracked files, config values, `.env` content, anything the secret scanner flags, screenshots. Sent at most: file paths, diff stats, truncated hunks of tracked source files after redaction, the agent prompt.
- **The on device model is on** where available, because nothing leaves the Mac. Where it is not available, the app says "Summaries use simple templates on this Mac" rather than nagging to enable cloud.
- Privacy copy must not quote Anthropic retention terms until verified on Anthropic's own pages (research 12 section 4.2).

---

## 5. Screens

### 5.0 App frame and navigation

- **Window:** unified title bar, sidebar with system vibrancy (solid fallback when Reduce transparency is on). Minimum 960 x 640, ideal 1280 x 800. Main window can close while the menu bar item and overlays keep running.
- **Sidebar:** Projects (with verdict glyph per project), then a divider, then Backups, Agents, Settings. Collapsible (Cmd 0).
- **Toolbar:** project switcher, the three big buttons on project screens, the Ask field (Cmd K), and the "Back to now" pill whenever the user is viewing the past.
- **Layout rule:** content max width 1080 px, centered; History uses a list plus inspector split at widths over 1180 px.

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ● ● ●  ▤   acme-shop ▾                              ⌕ Ask or jump…  ⌘K              │
├──────────────┬─────────────────────────────────────────────────────────────────────┤
│ PROJECTS     │                                                                     │
│ ◆ acme-shop  │                                                                     │
│ ● blog       │                       (screen content)                              │
│ ○ portfolio  │                                                                     │
│ + Add        │                                                                     │
│              │                                                                     │
│ ──────────── │                                                                     │
│ ▢ Backups    │                                                                     │
│ ⌁ Agents     │                                                                     │
│ ⚙ Settings   │                                                                     │
└──────────────┴─────────────────────────────────────────────────────────────────────┘
```

### 5.1 Onboarding (D01): three steps

A centered 640 px column on paper, one decision per screen, a three dot progress marker at top, Back always available, Esc does nothing destructive. Total target: under 90 seconds to the first verdict.

**Welcome (step 0, one screen, skippable after first launch)**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│              ▼                                               │
│     ●──●──○──◆──◆──◆      (the ruler draws itself, 1.2 s)    │
│                                                              │
│     Save points that know if they work.                      │
│                                                              │
│     Save your project as you go. We check each version in    │
│     a safe copy. When something breaks, go back to the last  │
│     one that works, on a new branch, without losing a thing. │
│                                                              │
│                         [ Get started ↵ ]                    │
│                                                              │
│     Works on this Mac. Your code is not uploaded.            │
└──────────────────────────────────────────────────────────────┘
```

The ruler animation is the only motion: ticks appear left to right, two turn green, three red, the playhead slides back to the last green one, and the green tick gets a tiny fork. It teaches the whole product in 1.2 s without words.

**Step 1 of 3: Pick your project**

```
┌──────────────────────────────────────────────────────────────┐
│  ● ○ ○                                                       │
│  Which project should we look after?                         │
│                                                              │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐      │
│    Drop a project folder here                               │
│  │ or  [ Choose folder… ]                              │      │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─       │
│                                                              │
│  Recent projects we found                                    │
│   ▢ ~/code/acme-shop      Next.js · Git · GitHub             │
│   ▢ ~/code/blog           Astro · Git                        │
│                                                              │
│  macOS may ask to let us see your Documents folder.          │
│  We only read the folder you pick.                           │
│                                              [ Continue ↵ ]  │
└──────────────────────────────────────────────────────────────┘
```

Notes:
- "Recent projects we found" scans only obvious places that need no permission (the home folder's `code`, `dev`, `projects`, `Developer`), and only after the user clicks "Find my projects". No silent disk scans.
- If the folder has no Git: a calm inline panel: "This folder doesn't have history turned on yet. We can turn it on for you. It adds a hidden .git folder and saves everything as it is now. [Turn on history] [Not now]". The command and diff are in Details.
- If the folder is huge or has no package file: still allowed, with a note that checks will need a custom command.
- TCC prompt explanation appears before the system prompt, not after.

**Step 2 of 3: How do we check it works?**

```
┌──────────────────────────────────────────────────────────────┐
│  ● ● ○                                                       │
│  How should we check that acme-shop works?                   │
│                                                              │
│  ◉ Run the tests                 npm test        recommended │
│  ○ Build it                      npm run build               │
│  ○ Open the home page            starts the app, checks it   │
│                                  loads, takes a picture      │
│  ○ My own command   [                           ]            │
│                                                              │
│  Checks run in a safe copy, never in your folder.            │
│  The internet is off during checks.  Details ▸               │
│                                                              │
│  [ Try it now ]   ◌ Checking…  ● Works in 38 s               │
│                                              [ Continue ↵ ]  │
└──────────────────────────────────────────────────────────────┘
```

Notes:
- Prefilled from `package.json` scripts. "Open the home page" is the best choice for vibe coders (it also produces the screenshot that powers the Time View).
- **Try it now** runs the first real check. This is the aha moment: the first verdict appears inside onboarding. If it fails, the copy is kind and useful: "Your project doesn't pass this check right now. That's OK. We'll save it as Broken, and the next version that passes becomes your first green save point." If it is INCOMPLETE or BLOCKED, it explains exactly what is needed (see 5.13) and lets the user continue anyway.
- Developers can pick two commands: a fast one for automatic checks and a full one for Find the last working version (research 12 section 8.3).

**Step 3 of 3: When should we save?**

```
┌──────────────────────────────────────────────────────────────┐
│  ● ● ●                                                       │
│  When should we save?                                        │
│                                                              │
│  ☑ Before and after each AI agent turn        recommended    │
│  ☑ Before risky commands (like deleting files)               │
│  ☐ Every hour while files are changing                       │
│  ☑ When I press Save now  (always on)                        │
│                                                              │
│  Connect your AI tools                                       │
│   Claude Code   found   [ Connect ]                          │
│   Cursor        found   [ Connect ]                          │
│   Codex         not found                                    │
│                                                              │
│  We'll show you exactly what we add before we add it.        │
│                                              [ Finish ↵ ]    │
└──────────────────────────────────────────────────────────────┘
```

Notes:
- **Connect** opens a sheet showing the exact file and lines that will be added (prefers `.claude/settings.local.json`, git ignored), with Add and Cancel. Codex shows the extra step "Codex will ask you to trust this hook in /hooks".
- **Finish** creates the first save point and lands on History with a three line coach mark on the ruler: "Each tick is a save point. Green means it passed a check. Press ⌃⌥T anytime to see this from any app." Coach marks never come back after dismissal.

### 5.2 Projects home (D02)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Projects                                               [ + Add project  ⌘N ] │
│                                                                              │
│ NEEDS A LOOK                                                                 │
│ ┌────────────────────────────┐                                               │
│ │ [ screenshot ]             │                                               │
│ │ acme-shop        ◆ Broken  │                                               │
│ │ Broke after Claude's last  │                                               │
│ │ change. Last working 10:42 │                                               │
│ │ [ Rewind to 10:42 ]        │                                               │
│ └────────────────────────────┘                                               │
│                                                                              │
│ ALL PROJECTS                                                                 │
│ ┌────────────────────────────┐ ┌────────────────────────────┐ ┌───────────┐  │
│ │ [ screenshot ]             │ │ [ fingerprint card ]       │ │           │  │
│ │ blog             ● Works   │ │ portfolio   ○ Not checked  │ │  + Add    │  │
│ │ Saved 12 min ago · You     │ │ Saved 3 days ago           │ │  project  │  │
│ │ ●─●─●─○─●                  │ │ ○─○─○                      │ │           │  │
│ └────────────────────────────┘ └────────────────────────────┘ └───────────┘  │
│                                                                              │
│ 2 of 3 free projects · 214 MB used                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:
- Cards are 280 px wide with a 16:10 thumbnail, the project name, verdict badge, one line status, and a **mini ruler** of the last eight save points (principle 4).
- "Needs a look" appears only when a project's newest check is Broken, Needs something or Check crashed. It disappears when resolved. It never shows Works projects.
- Projects with no screenshot use the fingerprint card (monochrome pattern seeded from the project name).
- Plan limit copy is factual and lives at the bottom, never as a modal. "Never paywall a restore" (brief section 6): a free user over the history limit can still rewind to anything still stored.
- Keyboard: arrow keys move between cards, Enter opens, R on a card starts Rewind, Cmd N adds.

### 5.3 Project History (D02, the hero screen)

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ acme-shop  ◆ Broken since 11:20               [ Save now ⌘S ] [ Check it works ⌘↵ ]   │
│ main · ~/code/acme-shop                       [ ⟲ Rewind ⌘⇧R ]                        │
├───────────────────────────────────────────────────────────────────────────────────────┤
│  Claude Code ▕██████████████████▏      Cursor ▕█████▏                                 │
│  ▁ ▂ ▁ ▃ ▁ ▂ ▅ ▁ ▂ ▁ ▁ ▂ ▃ ▇ █ ▆ ▂ ▁                                                  │
│  ●─●─○─●─●─●─●─●─●─◆─◆─○─◆─◆─◆─◆─◆─▼                                    Hour Day All  │
│  9:30          10:00          10:42  11:20          12:00     2:00   NOW               │
├────────────────────────────────────────────────────┬──────────────────────────────────┤
│ Important ▾   Everything        ⌕ Filter            │ 10:42 am · Added dark mode        │
│                                                    │ ● WORKS  tests passed · 41 s      │
│ TODAY                                              │ safe copy (basic isolation)       │
│ ◆ 3:14 pm  Claude: make checkout faster      ⌁ CC  │                                   │
│   ▸ 9 autosaves · 12:05 to 3:10 pm                 │ [ screenshot ]                    │
│ ◆ 11:20    Fixed lint errors                 ⌁ CC  │                                   │
│            Claude deleted 2 files                  │ Claude switched the theme to use  │
│ ● 10:42    Added dark mode             📌    ⌁ CC  │ system colors and added a toggle  │
│ ● 10:05    Cart totals in one place          ⌁ CC  │ in settings.                  AI  │
│ ○ 9:58     Saved by you                      You   │                                   │
│ ● 9:30     Before Claude session        Safety     │ Saved          Not saved          │
│                                                    │ ✓ Code         ◌ Database         │
│ YESTERDAY                                          │ ✓ 4 files      ◌ Secret values    │
│ ● 6:40 pm  Login page works                  You   │ ✓ 6 settings   ◌ Deployed site    │
│ …                                                  │ ✓ Packages                        │
│                                                    │                                   │
│                                                    │ [ Use this version ]              │
│                                                    │ [ Try it ] [ Compare ] [ Pin ]    │
└────────────────────────────────────────────────────┴──────────────────────────────────┘
```

Notes:
- **Header:** project name, overall status sentence ("Broken since 11:20", "Works · checked 4 min ago", "Not checked yet"), branch and path in ink 3. The three big buttons are the D02 promise: **Save now**, **Check it works**, **Rewind**. Rewind is visually primary only when the project is Broken; otherwise Save now is primary.
- **Ruler band:** the same ruler as the Time View at 96 px tall (sessions lane, activity band, ticks). Clicking a tick selects that row. Double click or Space opens the Time View on it.
- **List rows (44 px):** verdict glyph, time (tabular), title (ink, or ink 3 with AI tag when generated), one line of hints in ink 3 ("Claude deleted 2 files"), author chip on the right (You, ⌁ CC for Claude Code, Cursor, Codex, Scheduled, Safety). Pinned rows show a pin. Hover reveals Try, Compare, Pin.
- **Grouping:** by day; autosaves collapse between important save points (Figma). Agent sessions can be collapsed into one row "Claude Code session · 14 turns · 10:02 to 3:14 pm" via the filter menu.
- **Filter:** Important (default) or Everything, plus text filter that searches titles, prompts, packages and file names.
- **Inspector (right):** the selected save point detail in compact form. At narrow widths it becomes a full page (5.4).
- **Verdict change markers:** the first red row after a green row gets a thin red rule above it with "Broke here" in ink 3, but only when bisect or adjacent checks prove it. Otherwise the rule reads "Broke somewhere after 10:42" with a [Find where] link.

### 5.4 Save point detail (D03)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← History                                         Back to now  ⌘↑            │
│                                                                              │
│ Added dark mode                                         ✎ edit   📌 Pin      │
│ Today 10:42 am · Claude Code · after the prompt "add a dark mode toggle"     │
│                                                                              │
│ ┌──────────────────────────────┐   ● WORKS                                   │
│ │                              │   Tests passed (24 of 24) in 41 s           │
│ │      [ screenshot ]          │   Checked in a safe copy · basic isolation  │
│ │                              │   Internet was off during the check         │
│ └──────────────────────────────┘   [ Check again ]   Details ▸               │
│                                                                              │
│ What changed                                                                 │
│   Claude switched the theme to use system colors and added a toggle    AI    │
│   in settings.                                                               │
│   · 2 pages changed · 3 components changed · 1 new setting key               │
│   · No packages changed                              [ Compare with before ] │
│                                                                              │
│ What's saved                          What's not saved                       │
│   ✓ Code, commit 3f9a1c2                ◌ Database contents                  │
│   ✓ 4 files outside Git (.env.example,  ◌ Secret values. We kept the names:  │
│     public/og.png, 2 more)                STRIPE_KEY, DATABASE_URL, NEXTAUTH_ │
│   ✓ 6 settings (names and fingerprints)   SECRET                             │
│   ✓ Packages (lockfile), Node 24.9      ◌ big-video.mp4 (over 25 MB)         │
│   ✓ How to build it (Dockerfile)        ◌ Anything outside this folder       │
│                                                                              │
│ [ Use this version ]   [ Try it ]   [ Compare with now ]                     │
│                                                                              │
│ Details ▸  commit, refs/tm/cp_0007, manifest hash, check log, audit entries  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:
- The title is editable inline (Enter saves, Esc cancels). Editing removes the AI tag.
- The verdict block always names: result, evidence count, duration, isolation mode, network policy. A verdict older than the last change to the check command shows "Checked with an older check" in ink 3.
- What's saved and What's not saved come straight from the coverage report (C06). Same type size, side by side. On narrow widths they stack (Saved first), and both stay expanded.
- Details opens a mono panel: commit, ref, manifest hash, integrity status ("Verified, 0 problems"), full check log, audit entries for this save point. Copy buttons on each.

### 5.5 Compare (D05)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Compare   [ 10:42 Added dark mode ● ▾ ]   →   [ Now 3:14 pm ◆ ▾ ]   ⇄ swap   │
│ ●─●─○─●─●─●─●─●─[●═════════════════════◆]                                     │
│                                                                              │
│ Between these two, Claude Code made 6 save points, changed 14 files, added   │
│ the next-auth package and changed 1 setting.                           AI    │
│                                                                              │
│ ┌──────────────────────────┐  ┌──────────────────────────┐                   │
│ │ [ 10:42 screenshot ]     │  │ [ now screenshot ]       │   ◐ overlay slider │
│ └──────────────────────────┘  └──────────────────────────┘                   │
│                                                                              │
│ ▸ Code            14 files · +412 −88 · pages 3, components 7, lib 4         │
│ ▸ Packages        + next-auth 5.2.0   ↑ react 19.1 → 19.2                     │
│ ▸ Settings        ~ NEXTAUTH_URL changed (value hidden)  + AUTH_SECRET added  │
│ ▸ Environment     Node 24.9 → 24.9 (same) · Dockerfile same                   │
│ ▸ Files outside Git   + public/logo-dark.svg                                 │
│ ▸ Check result    ● 24 passed  →  ◆ 21 passed, 3 failed                      │
│                                                                              │
│ [ What broke? ]                                   [ Rewind to 10:42 ]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:
- The range is drawn on a mini ruler: both ends draggable, so comparing is scrubbing (principle 4).
- Screenshots side by side, with an overlay mode (one image over the other with a wipe slider, the classic before and after) for visual changes.
- Each section has a one line plain summary and expands to a real diff (unified by default, split toggle, syntax highlighted, Geist Mono 12). Packages show added, removed, upgraded. Settings show key names and "changed" only; values never appear, because they were never stored.
- "What broke?" appears only when the left side is Works and the right side is Broken.

### 5.6 Check it works (live rebuild)

Opens as a sheet over History (or inline in the Time View stage). Each step is a row with a state glyph and duration.

```
┌ Checking acme-shop · now ─────────────────────────────────────────────┐
│                                                                       │
│  ✓ Made a safe copy of your project              0.4 s                │
│  ✓ Put back 4 files outside Git                  0.1 s                │
│  ✓ Set up 6 settings (3 secret values from your Keychain)   0.0 s     │
│  ◌ Installing packages                           12.3 s               │
│     ▕██████████████░░░░░░▏ from cache                                 │
│  · Running your check  npm test                                       │
│  · Taking a picture of the home page                                  │
│                                                                       │
│  > added 812 packages in 12s                                          │  ← live log, 1 line,
│                                                                       │    ⌘L expands
│  Your project folder is not touched.  Internet is off for the check.  │
│                                                                       │
│  [ Run in background ]                               [ Stop  ⌘. ]     │
└───────────────────────────────────────────────────────────────────────┘
```

Result states (the sheet morphs in place, 220 ms):

| Result | Header | Body | Buttons |
|---|---|---|---|
| Works | ● **It works.** | "Tests passed (24 of 24) in 41 s. Checked in a safe copy with the internet off." | Done · See the picture |
| Broken | ◆ **It's broken.** | "3 of 24 tests failed. The last version that worked is 10:42, Added dark mode." Failing test names listed. | Rewind to 10:42 · What broke? · Show log |
| Couldn't check | ◑ **We couldn't finish the check.** | Reason in one sentence (see 5.13). | Fix and retry · Try an older one |
| Needs something | ◒ **The check needs something first.** | "It needs a value for DATABASE_URL. Add it once and we'll keep it in your Keychain." | Add value · Skip this check |
| Check crashed | ⊘ **The check itself crashed.** | "This is a problem with the check, not necessarily your project." | Show log · Report it |

Notes:
- The isolation label is shown on every result. If stronger isolation is available but not used, a quiet line: "Stronger isolation is available with Docker or OrbStack. Learn more".
- Run in background collapses into the menu bar spinner and finishes with a corner card.

### 5.7 Rewind wizard (D04)

The Time View (section 3) is the wizard in its rich form. The **Simple rewind** sheet is the same four steps for reduced motion, VoiceOver users, small windows, and anyone who prefers it (Settings > Rewind style).

```
┌ Rewind acme-shop ─────────────────────────────────────────────────────┐
│  1 Find ●───── 2 Try ○───── 3 Use ○───── 4 Done ○                     │
│                                                                       │
│  Finding the last version that works                                  │
│   ◆ 3:14 pm   Claude: make checkout faster     broken (known)         │
│   ◆ 11:20     Fixed lint errors                broken  · checked 38 s │
│   ● 10:42     Added dark mode                  works   · checked 41 s │
│                                                                       │
│  ● 10:42 works.                                                       │
│                                                                       │
│  [ Pick a different one ]                       [ Next: Try it ↵ ]    │
└───────────────────────────────────────────────────────────────────────┘
```

- **Step 2 Try:** "We started the 10:42 version in a safe copy. [Open it] opens it in a small preview window. Click around. Your real folder hasn't changed." For non web projects: "Try it in Terminal" opens a shell in the safe copy (developer) or skips with "Nothing to open for this project".
- **Step 3 Use:** the fork confirmation from section 3.2 C, plus the Is it safe to rewind? list.
- **Step 4 Done:** the recovery report (5.8) with Undo.

### 5.8 Recovery report

Shown after Use, saved as a file in the store, and always reachable from the save point and the audit log.

```
┌ You're on the 10:42 version ──────────────────────────────────────────┐
│                                                                       │
│  ● Works · checked in a safe copy at 3:16 pm                          │
│  New branch  tm/recover/2026-10-14-1042  (local only)                 │
│  Your other version is saved as "Before rewind, 3:15 pm".             │
│                                                                       │
│  Brought back                    Not brought back                     │
│   ✓ Code                          ◌ Database contents (a migration    │
│   ✓ 4 files outside Git             ran at 11:40 and is still there)  │
│   ✓ 6 settings (names)            ◌ The deploy from 12:15 is still    │
│   ✓ Packages, Node 24.9             live                              │
│                                   ◌ Secret values (re-enter if asked) │
│                                                                       │
│  Things to do by hand                                                 │
│   ☐ Check your database still matches this version                    │
│   ☐ Redeploy when you're ready (we never deploy for you)              │
│                                                                       │
│  Nothing was pushed, merged, deployed or deleted.                     │
│                                                                       │
│  [ Undo ⌘Z ]   [ Copy report ]   [ Show in Finder ]       [ Done ↵ ]  │
└───────────────────────────────────────────────────────────────────────┘
```

Notes:
- The manual steps are checkboxes the user can tick (stored locally), so the report doubles as a recovery checklist.
- Copy report gives Markdown suitable for a PR description or a message to a client (agencies are the first payers, brief section 6).

### 5.9 Backups and storage (D07)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Backups                                                                      │
│                                                                              │
│ Save points use 340 MB of 2 GB                                               │
│ ▕████████░░░░░░░░░░░░░░░░░░░░░░░░▏                                           │
│ Stored on this Mac, outside your project folders, so deleting a project      │
│ doesn't delete its history.                          Show in Finder          │
│                                                                              │
│ acme-shop     212 MB   148 save points   kept: all from 24 h, hourly 30 days │
│ blog           96 MB    61 save points                                       │
│ portfolio      32 MB    12 save points                                       │
│                                                                              │
│ Always kept: pinned save points, the newest one that works, and anything     │
│ used in a rewind.                                                            │
│                                                                              │
│ [ Clean up… ]   Limit [ 2 GB ▾ ]   Keep files up to [ 25 MB ▾ ]              │
│                                                                              │
│ Check backup health  ✓ Last checked today · all 221 save points intact       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Clean up** opens a preview: "This removes 84 older autosaves and frees 140 MB. Pinned and working save points stay." Confirm required. Never deletes the newest PASS (brief section 5 thinning rules).
- **Check backup health** runs the integrity check (C07) and shows tampered or missing items plainly.
- The word "Backups" is used for the storage screen because that's what users call it. The product never claims to be a full Mac backup. A one line note: "This is not a replacement for a full Mac backup."

### 5.10 Agent connections (D07)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agents                                                                       │
│                                                                              │
│ ⌁ Claude Code    Connected in 2 projects     Watching ●     [ Manage ]       │
│   Saves before each prompt, before risky commands, after each turn.          │
│   Checks after each turn and tells Claude if it broke something.             │
│                                                                              │
│ ⌁ Cursor         Connected in 1 project      Watching ●     [ Manage ]       │
│ ⌁ Codex          Not connected   needs trust in /hooks      [ Connect ]      │
│ ⌁ Gemini CLI     Not connected   hooks are experimental     [ Connect ]      │
│ ⌁ Git            Saves on commit, checkout and merge         [ Connect ]     │
│                                                                              │
│ MCP server   Let agents ask for save points, checks and rewinds.  [ Set up ] │
│ Command line tool  tm is installed at ~/.local/bin/tm             ✓          │
│                                                                              │
│ Recent agent activity                                                        │
│  3:14 pm  Claude Code turn ended · checked · ◆ broken (was ● works)          │
│  12:15    Claude Code ran "vercel deploy" · safety save made                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Manage** shows per project switches (save before prompt, safety saves, check after turn, wake the agent on break), the exact hook files and lines installed, and **Disconnect** (removes only our lines, shows the diff).
- Wording is factual about each tool's own limits (Codex trust step, Gemini experimental flag).

### 5.11 Settings (D07)

Tabs: General, Checks, Rewind, Overlays, AI and privacy, Storage (links to Backups), Advanced.

```
┌ Settings ────────────────────────────────────────────────────────────────────┐
│ General  Checks  Rewind  Overlays  AI & privacy  Advanced                    │
│                                                                              │
│ Checks                                                                       │
│  Safe copy method       ◉ Basic (works everywhere)                           │
│                         ○ Sealed (Docker or OrbStack found)    stronger      │
│  Time limit per check   [ 5 min ▾ ]                                          │
│  Internet during checks ◉ Off (recommended)  ○ Allow these hosts…            │
│  Secret values          Stored in your Keychain only when you add them.      │
│                         We save secret names, never values.  Manage…         │
│                                                                              │
│ Overlays                                                                     │
│  Corner cards           [ On ▾ ]  Corner [ bottom right ▾ ]                  │
│  Agent pill             [ While an agent works ▾ ]                           │
│  Timeline strip key     [ ⌃⌥T ]     Ask key  [ ⌥Space ]                      │
│  Sounds                 ☐ in cards   ☑ in Rewind   follows system setting    │
│                                                                              │
│ AI & privacy                                                                 │
│  Titles and summaries   ◉ On this Mac   ○ Simple templates only              │
│  Cloud AI               Off · per project · your own key   [ Preview… ]      │
│                                                                              │
│ Advanced                                                                     │
│  ☐ Show technical details by default    ☐ Strict mode for risky commands     │
└──────────────────────────────────────────────────────────────────────────────┘
```

General also holds: launch at login, menu bar only mode (no Dock icon), text size (S, M, L), appearance (System, Light, Dark), updates.

### 5.12 Empty states

| Where | Visual | Copy | Action |
|---|---|---|---|
| No projects | An empty ruler with the playhead waiting at the left | "Nothing to look after yet. Add a project and we'll make its first save point." | Add project |
| Project with one save point | One tick | "Your first save point. Make a change and we'll save the next one. Or press ⌘S anytime." | Save now |
| No save point has passed yet | Ticks all hollow or red | "No version has passed a check yet. When one does, it becomes your safety net." | Check it works |
| Filter finds nothing | Ruler with no highlights | "No save points match "stripe". Try a package or file name." | Clear filter |
| No agents connected | Agent icons in outline | "Connect Claude Code, Cursor or Codex and we'll save before and after every turn." | Connect |
| No screenshot for this save point | Fingerprint card | "No picture for this one. Pictures are taken when the check opens your home page." | Change check |
| Search in Ask bar with no match | | "Couldn't find that. Try a time ("yesterday 4 pm"), a package, or a file." | |

### 5.13 Error states in plain language

Verdicts are results, not app errors. Each has a fixed label, glyph and color family, and every message follows: **what happened, why it matters, what you can do.**

| Engine | App label | Glyph | Typical cause | Plain message | Actions |
|---|---|---|---|---|---|
| PASS (0) | Works | ● green | | "It works. Tests passed in 41 s in a safe copy." | |
| FAIL (1) | Broken | ◆ red | Tests fail, build fails, page doesn't load | "It's broken. 3 tests failed: auth.test.ts and 2 more. The last version that works is 10:42." | Rewind · What broke? |
| INCOMPLETE (2) | Couldn't check | ◑ amber | A captured file is missing; a fixture is missing; the save point is partial | "We couldn't check this version because a saved file is missing: public/og.png. We won't call it working until we can check it." | Try an older one · Show details |
| BLOCKED (3) | Needs something | ◒ amber | Missing secret value; check needs the internet; port blocked by policy | "This check needs the internet to reach api.stripe.com, and checks run offline to keep you safe. You can allow this host for checks." / "It needs a value for DATABASE_URL." | Allow host · Add value · Skip |
| ERROR (4) | Check crashed | ⊘ grey | Timeout; out of disk; the check command itself crashed | "The check ran longer than 5 minutes and we stopped it. This doesn't mean your project is broken." | Raise time limit · Show log · Retry |
| (none) | Not checked yet | ○ hollow | No check run | "Not checked yet. Saved, but we don't know if it works." | Check it works |

App level errors (not verdicts):

| Situation | Message | Action |
|---|---|---|
| Git not found | "We need Git to save versions, and it isn't on this Mac yet. macOS can install it for you in about a minute." | Install Git (runs `xcode-select --install`) |
| Project folder moved or deleted | "We can't find acme-shop at ~/code/acme-shop. Its history is safe with us." | Locate folder · Restore it to a new folder |
| Disk nearly full | "Your Mac is almost out of space, so we paused new save points. Nothing was deleted." | Clean up · Change limit |
| Save point failed integrity check | "This save point doesn't match what we stored. We won't use it to rewind." | Show details · Check backup health |
| Hook stopped working (agent updated its config) | "Claude Code stopped telling us about turns in acme-shop. Its settings may have changed." | Reconnect |
| Working folder has uncommitted changes at Use time | "You have changes that aren't in a save point yet. We'll save them first, as always." | Continue |
| Rewind target branch name exists | "A branch with that name already exists. We'll use tm/recover/2026-10-14-1042-2." | Continue |

---

## 6. Overlays

Four surfaces, built on the tech in research 12 section 2 (Electron `type: 'panel'`, `showInactive()`, `setAlwaysOnTop(true, 'floating')`, `hiddenInMissionControl`, no special permissions). Shared rules first, then each surface.

### 6.1 Shared rules (the "never annoying" contract)

1. **Never steal focus.** Every overlay shows with `showInactive()` and is a non activating panel. Typing in the terminal or editor continues uninterrupted. A card only takes keyboard focus if the user clicks into it.
2. **Never cover full screen apps.** Window level `floating`, not `screenSaver`. Cards queue while a full screen app is frontmost and show when the user leaves it (FAIL cards only; other cards are dropped into the menu bar's Recent list).
3. **Respect Focus.** When a macOS Focus or Do Not Disturb is on, cards do not appear; the menu bar dot still updates and Recent keeps them. FAIL cards can optionally break through (off by default).
4. **One at a time.** A new card replaces the old one with a vertical slide. Unread older cards fold into a "+2 more" link that opens the menu bar list.
5. **Frequency limits per project:**
   - At most **one card per agent turn**. If a safety save and a check result happen in the same turn, only the more important one shows.
   - **"Still works" is shown once per session**, then only as a silent dot update.
   - No more than **4 cards in 10 minutes** across all projects. Over the limit, cards go to Recent and the menu bar icon shows a small count.
   - The same FAIL is never shown twice. A second card appears only if the verdict changes (fixed, or broke in a new way).
6. **Calm timing.** Info cards auto hide after 8 s, success after 5 s, FAIL cards stay until dismissed or acted on, but they shrink to a compact chip after 30 s so they don't hover over work.
7. **Hover pauses** every timer. Two finger swipe right or Esc (when the card has focus) dismisses. A dismissed card is always recoverable from Recent for 24 hours.
8. **Position:** bottom right by default, 16 px from the edges, configurable to any corner, remembered per display. Cards avoid the Dock and stay inside the visible frame.
9. **Content protection:** off by default (so demo recordings show cards), with a setting "Hide cards when sharing my screen" that uses `setContentProtection(true)`.
10. **Accessibility:** every card is also posted as a VoiceOver announcement and stays reachable from the menu bar Recent list with the keyboard.

### 6.2 Menu bar status item

The status item is a **template image**: the playhead glyph (a vertical bar with a small triangle head) with a 5 px verdict dot at its lower right. Monochrome glyph so it follows the menu bar's light or dark appearance and Tahoe's transparent bar; only the dot carries color.

| State | Dot | Meaning | Tooltip |
|---|---|---|---|
| Works | green filled | Newest save point of the active project passed | "acme-shop works · checked 4 min ago" |
| Broken | red filled | Newest check failed | "acme-shop is broken · last working 10:42" |
| Not checked | hollow ring | Newest save point has no verdict | "Saved 2 min ago · not checked yet" |
| Couldn't check / Needs something | amber ring | INCOMPLETE or BLOCKED | "Couldn't check the newest save point" |
| Check crashed | grey slash | ERROR | "The last check crashed" |
| Checking | rotating 270 degree arc around the dot, 1.2 s per turn | A check is running | "Checking acme-shop…" |
| Agent working | playhead glyph gently pulses opacity 60 to 100 percent | A connected agent is in a turn | "Claude Code is working in acme-shop" |
| Paused | dot replaced by a short dash | Watching paused | "Paused until 4:30 pm" |

"Active project" means the most recently changed project. If any project is Broken, the dot is red and the tooltip names it (worst state wins, so a broken project is never hidden behind a green one).

**Menu (click):** a panel, not a plain NSMenu, 320 px wide.

```
┌──────────────────────────────────────────┐
│ acme-shop                     ◆ Broken   │
│ ●─●─○─●─●─●─●─◆─◆─◆           3:14 pm   │  ← mini ruler, last 10, clickable
│ Broke after Claude's last change.        │
│ [ Rewind to 10:42 ]   [ What broke? ]    │
│──────────────────────────────────────────│
│ Save now                         ⌘S      │
│ Check it works                   ⌘↵      │
│ Show timeline                    ⌃⌥T     │
│ Ask…                             ⌥Space  │
│──────────────────────────────────────────│
│ Other projects                           │
│  ● blog          saved 12 min ago        │
│  ○ portfolio     saved 3 days ago        │
│──────────────────────────────────────────│
│ Recent cards (3)                       ▸ │
│ Pause watching                         ▸ │
│ Open {App}…                      ⌘O      │
│ Settings…                        ⌘,      │
│ Quit                             ⌘Q      │
└──────────────────────────────────────────┘
```

The top block changes with state: Works shows "Works · checked 4 min ago" with [Check again]; Not checked shows [Check it works]; Checking shows the live step ("Installing packages… 12 s") with [Stop].

### 6.3 Corner event cards

Size 360 x auto (max 148 px), radius 16, material: HUD vibrancy with a 1 px hairline border; solid paper or ink when Reduce transparency is on. Layout: verdict glyph or event icon, a bold first line, one ink 3 line, up to two buttons, a close x on hover. Project name in small caps at top when more than one project is watched.

All variants with copy:

| # | Trigger | First line | Second line | Buttons | Timing |
|---|---|---|---|---|---|
| C1 | Agent turn ended, save point made (only if checks are off for auto) | "Saved: Claude added a login page" | "12 files changed · not checked yet" | **Check it** · Show | 8 s |
| C2 | Check passed after an agent turn (first time this session) | "Still works ●" | "Checked Claude's last change in 41 s." | Dismiss | 5 s |
| C3 | **Verdict regression**: PASS before, FAIL now | "Something broke after Claude's last change" | "Last working version: 10:42, Added dark mode." | **Rewind to 10:42** · Show what changed | stays, chip after 30 s |
| C4 | Broken, and no earlier version has passed | "This version doesn't pass its check" | "No earlier save point has passed yet, so there's nothing proven to go back to." | Show what failed · Check older ones | stays |
| C5 | Safety save before a risky command | "Saved first, just in case" | "Claude is about to run git reset --hard." | Dismiss | 6 s |
| C6 | Couldn't check (INCOMPLETE) | "Couldn't check Claude's last change" | "A saved file is missing: public/og.png." | Show details | 8 s |
| C7 | Needs something (BLOCKED) | "The check needs something first" | "Add a value for DATABASE_URL once and we'll remember it." | **Add value** · Later | 8 s |
| C8 | Check crashed (ERROR) | "The check crashed, not your project" | "It ran past the 5 minute limit." | Show log | 8 s |
| C9 | Fixed: FAIL then PASS | "Fixed. It works again ●" | "Claude's latest change passes. You're back on solid ground." | Dismiss | 5 s |
| C10 | Rewind progress (from C3, in place) | "Rebuilding 10:42 in a safe copy…" | step line with progress | Stop | until done |
| C11 | Rewind result PASS | "10:42 works ●" | "Use it on a new branch? Your current version gets saved first." | **Use this version** · Look first | stays |
| C12 | Rewind result not PASS | "Couldn't confirm 10:42" | Reason in one line. | **Try an older one** · Open | stays |
| C13 | Rewind done | "You're on the 10:42 version" | "Nothing was pushed or deleted. Database and deploys were not changed." | **Undo** · See report | 10 s |
| C14 | Agent stuck | "Claude has tried 5 times" | "The same 3 tests still fail. Last working: 10:42." | Rewind · Show | 10 s |
| C15 | Background find-good finished | "Found it: 10:42 works" | "Checked 3 save points in 1 min 52 s." | **Rewind** · Show | stays |
| C16 | Storage limit reached | "Save points are paused" | "You've reached the 2 GB limit. Nothing was deleted." | Clean up | 10 s, once per day |

Card motion: enter from the screen edge 24 px with fade, 220 ms ease out; exit 160 ms ease in, toward the edge. Replacement slides the old card down 8 px and fades while the new one rises. The verdict glyph on C2, C9, C11 stamps (same spring as the Time View, scaled down). No sound unless enabled.

Hard rules for card copy: a card may say "Broke" only for C3 and C4, which rest on a real FAIL verdict. A green glyph appears only on C2, C9, C11 and C15, which rest on a real PASS.

### 6.4 Hotkey timeline strip

Summoned with ⌃⌥T (configurable) from any app. A 64 px tall strip across the bottom of the active display, 24 px above the Dock, 85 percent display width, radius 16, HUD material.

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ acme-shop ▾   ●──●──○──●──●──●──●──●──▼──◆──◆──○──◆──◆──◆   NOW ◆   ⟲ Rewind ↵   │
 │               9:30      10:00       10:42    11:20     12:00      3:14            │
 └──────────────────────────────────────────────────────────────────────────────────┘
                                      ┌──────────────────────┐
                                      │ [ thumbnail ]        │  ← hover popover
                                      │ 10:42 Added dark mode│
                                      │ ● Works · 41 s       │
                                      └──────────────────────┘
```

- Opens with a 180 ms rise. The playhead starts on Now.
- **Keyboard:** this is the one overlay that takes keyboard focus, because the user summoned it on purpose. ← → or J L move the playhead, Shift ← → jump to verdict changes, Enter opens the Time View on that save point in the main window, R rewinds to it, C compares it with now, Tab switches project, Esc closes and returns focus to the previous app.
- Hover shows the thumbnail popover. Click opens the main window on that save point.
- Closes on Esc, on click outside, or when the previous app is reactivated. Never auto opens.

### 6.5 "Agent is working" pill

Exists only while a connected agent is in a turn. Wispr Flow style, but smaller and opt out.

```
 resting (44 x 10)        hover / expanded (260 x 36)
   ▕▔▔▔▔▔▔▔▏               ┌───────────────────────────────────────────┐
   (soft pulse)             │ ⌁ Claude Code is working · acme-shop      │
                            │   2 save points this turn · last ● 10:42  │
                            └───────────────────────────────────────────┘
```

- Bottom center by default, draggable to any edge, remembered per display. Hidden in full screen apps.
- Resting: a capsule in ink at 70 percent opacity with a slow opacity breath (2.4 s). When a safety save happens, a tiny tick drops into the capsule (120 ms).
- On turn end, the pill morphs into the result: a 1 s flash of the verdict glyph (only if a check finished), then shrinks away, or hands off to a corner card if the result deserves one (C3, C9). The pill and a card never show at the same time.
- Hint line (grey, never red): "Claude's own test run failed. We'll check when the turn ends."
- Click: opens the History screen at the current session. Settings: While an agent works (default), Never.

---

## 7. Visual system

Base: the website's **Monolith** direction (black on white, color only for verdicts, Inter Display, Inter, Geist Mono) with **Playhead** borrowed as the single motion signature (research 03 section 7 recommendation). The app adds a dark mode, a full five state verdict set, and native macOS materials.

### 7.1 Color tokens

Neutrals (ink and paper):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | #FFFFFF | #0B0B0C | Window background |
| `--mist` | #F5F5F3 | #141415 | Sidebar fallback, Time View background, alternate rows |
| `--mist-2` | #EDEDEA | #1C1C1E | Selected row, pressed buttons |
| `--surface` | #FFFFFF | #161618 | Cards, inspector, sheets |
| `--hairline` | #E6E6E3 | #2A2A2C | Borders, ruler baseline, dividers |
| `--hairline-strong` | #D4D4CF | #3A3A3D | Input borders, ticks for autosaves |
| `--ink` | #0A0A0A | #F5F5F3 | Titles, facts, primary button fill, playhead |
| `--ink-2` | #3D3D3D | #C8C8C4 | Body text |
| `--ink-3` | #6B6B6B | #8E8E8A | Captions, AI text, timestamps (AA on paper in both modes) |
| `--ink-4` | #9A9A96 | #5E5E5B | Disabled, placeholder only (never body text) |
| `--dim` | paper at 65 percent | paper at 65 percent | The veil to the right of the playhead |
| `--focus` | #0A0A0A ring 2 px + 2 px paper gap | #F5F5F3 ring 2 px + 2 px paper gap | Keyboard focus (no blue: color is for verdicts) |

Verdict tokens (the only hues in the app):

| Verdict | Label | `fg` light / dark | `bg` light / dark | `solid` (ticks, dots) light / dark | Glyph |
|---|---|---|---|---|---|
| PASS | Works | #0F7A3D / #4ADE80 | #E8F7EE / #0F2A1A | #16A34A / #22C55E | ● filled circle (with ✓ at 12 px and up) |
| FAIL | Broken | #B42318 / #F87171 | #FDECEC / #2C1212 | #DC2626 / #EF4444 | ◆ filled diamond (with × at 12 px and up) |
| INCOMPLETE | Couldn't check | #8A5A00 / #FBBF24 | #FFF4DC / #2A2108 | #D97706 / #F59E0B | ◑ half filled circle |
| BLOCKED | Needs something | #8A5A00 / #FBBF24 | #FFF4DC / #2A2108 | #D97706 / #F59E0B | ◒ ring with a notch (a keyhole cut) |
| ERROR | Check crashed | ink 2 / ink 2 | mist 2 / mist 2 | ink 3 / ink 3 | ⊘ ring with a slash |
| none | Not checked yet | ink 3 | none | hairline strong ring | ○ hollow ring |
| running | Checking | ink 3 | none | ink 3 arc | ◌ rotating arc |

Rules:

- **Shape carries meaning, color confirms.** Every verdict is identifiable in grayscale (circle, diamond, half circle, notched ring, slashed ring, hollow ring). This covers color blindness and Increase contrast.
- **ERROR is neutral on purpose.** A crashed check says nothing about the code, so it must not look like a red FAIL or an amber warning.
- **INCOMPLETE and BLOCKED share amber** because both mean "we could not decide". The glyph and label separate them.
- **Solid tick colors** are for graphics only and meet 3:1 against paper (Tailwind 600 values: green about 3.3:1, amber about 3.2:1, red about 4.8:1 on white). Text uses the `fg` tokens, which meet 4.5:1 on both paper and their `bg`. Verify every pair with a contrast checker before shipping; the values above are starting points.
- **No green gradients, glows or confetti.** A PASS is a quiet fact.
- **Increase contrast mode:** hairlines become `--ink-3`, `--ink-3` text becomes `--ink-2`, verdict bgs gain a 1 px fg border.

### 7.2 Type scale

Fonts bundled with the app (all OFL): Inter Display for titles, Inter for UI, Geist Mono for commits, commands, logs, time labels on the ruler and verdict eyebrow labels. Tabular numbers (`tnum`) everywhere a time or count appears. Base size follows macOS (13 px), not the website (17 px).

| Token | Font | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display` | Inter Display | 40 / 44 | 600 | -0.03em | Time View verdict line ("10:42 works."), onboarding headline |
| `title-1` | Inter Display | 28 / 34 | 600 | -0.02em | Screen titles, save point title |
| `title-2` | Inter Display | 20 / 26 | 600 | -0.01em | Section headers, sheet titles |
| `headline` | Inter | 15 / 20 | 600 | -0.005em | Card first lines, row titles in Time View |
| `body` | Inter | 13 / 18 | 400 | 0 | Default UI text, row titles |
| `body-strong` | Inter | 13 / 18 | 550 | 0 | Buttons, labels |
| `callout` | Inter | 12 / 16 | 400 | 0 | Card second lines, hints |
| `caption` | Inter | 11 / 14 | 450 | +0.005em | Timestamps, metadata |
| `mono` | Geist Mono | 12 / 16 | 450 | 0 | Commits, commands, logs, diffs |
| `eyebrow` | Geist Mono | 10.5 / 14 | 550 uppercase | +0.06em | Verdict labels (WORKS, BROKEN), section labels |

Text size setting (S, M, L) scales the whole scale by 0.92, 1, 1.15.

### 7.3 Spacing, radii, elevation

- **Spacing (4 pt grid):** 2, 4, 8, 12, 16, 20, 24, 32, 40, 56, 80. Rows 44 px; compact rows 32 px; toolbar 52 px; sidebar 220 px; inspector 340 px.
- **Radii:** 4 (badges, ticks caps), 6 (buttons, inputs), 10 (rows on hover, small cards), 14 (cards, sheets), 16 (overlay cards, timeline strip, Time View stage), 999 (pills, agent pill). Corner radii lean round to sit naturally next to macOS Tahoe's rounder windows.
- **Elevation:** three levels only. `e1` hairline border, no shadow (cards in the window). `e2` 0 4 16 rgba(0,0,0,0.08) plus hairline (sheets, popovers). `e3` 0 12 40 rgba(0,0,0,0.16) plus hairline (overlays, Time View stage). Dark mode replaces shadows with a 1 px lighter top border.
- **Materials:** sidebar uses Electron `vibrancy: 'sidebar'`; overlays use `vibrancy: 'hud'`. Both fall back to solid `--mist` or `--surface` when Reduce transparency is on. The app does not imitate Liquid Glass inside content; it lets the system materials do that at the edges.

### 7.4 Iconography

- **Library:** Lucide (ISC license) at 1.5 px stroke on a 16 and 20 px grid, plus a small custom set. SF Symbols are not used in the web rendered UI (their license targets native Apple platform use; avoid the question entirely).
- **Custom glyphs:** playhead (vertical bar with triangle head), save point (a notch on a line), rewind triangle (the Monolith "i" dot), fork (a line that splits), safe copy (a dashed rounded box), sealed copy (a solid rounded box), not saved (a dashed outline file), agent (⌁, a small spark line, never a robot face), pin.
- **Banned:** clock with arrow, clock faces, hourglasses, swirls, rocket ships, magic wands, sparkles for AI. AI is marked with the text tag `AI`.
- **Agent marks:** text chips ("Claude Code", "Cursor", "Codex") rather than third party logos, which avoids trademark use questions. Logos only if the owners' brand rules allow it.

### 7.5 Verdict badges

Three sizes, same anatomy: glyph plus eyebrow label on the verdict `bg`, radius 4.

```
 large (Time View, detail)      medium (rows, cards)    small (ruler ticks, menu)
 ┌───────────────────┐          ┌──────────┐            ●  ◆  ◑  ◒  ⊘  ○
 │ ●  WORKS          │          │ ● Works  │            6 to 8 px, glyph only
 │ tests passed 41 s │          └──────────┘
 └───────────────────┘
```

The large badge always carries evidence (what ran, how long, isolation). A badge is never shown without the save point it belongs to.

### 7.6 Motion tokens

| Token | Duration | Easing | Use |
|---|---|---|---|
| `instant` | 80 ms | linear | Hover states, pressed states |
| `quick` | 140 ms | ease out (0.22, 1, 0.36, 1) | List fades, key feedback, tooltips |
| `base` | 220 ms | ease out | Sheets, cards entering, ruler rising |
| `exit` | 160 ms | ease in (0.64, 0, 0.78, 0) | Anything leaving |
| `slow` | 320 ms | ease out | Corridor cards, stage changes |
| `scene` | 280 to 480 ms | ease out | Entering and leaving the Time View, fork |
| `travel` | 240 to 420 ms | ease in out (0.65, 0, 0.35, 1) | Playhead moving along the ruler |
| `spring-stamp` | about 360 ms | spring stiffness 400, damping 28, mass 1 | Verdict stamp only |
| `spring-settle` | about 300 ms | spring stiffness 380, damping 30 | Playhead settle only |
| `breath` | 1.2 s loop | sine | Checking tick, agent pill (2.4 s) |

Rules: one move per moment; arrivals ease out, exits ease in; nothing autoplays except the two breaths; all motion is interruptible; reduced motion swaps to 120 ms cross fades.

### 7.7 The playhead motif

The playhead is the brand mark inside the product.

- **Form:** a 2 px ink line with an 8 px equilateral triangle head pointing down, the same triangle as the rewind dot in the wordmark.
- **Where it appears:** the ruler in History, Time View, Compare, timeline strip, menu bar mini ruler, the menu bar icon, the app icon, the onboarding animation, the loading indicator (a playhead sweeping over three ticks), and the cursor over rulers (a custom playhead cursor, Direction B's hidden delight).
- **What it means:** "you are looking here". It never means "now" by itself; Now is always labeled.
- **It is always ink.** It never takes a verdict color; the tick under it does.

### 7.8 Sound design notes

- Three sounds total, all short, soft and dry, recorded or synthesized from real materials (wood, felt, glass), mastered around -18 LUFS: **stamp** (PASS, two note rise, under 250 ms), **settle** (fork done, damped knock, 120 ms), **tick** (scrub snap, 20 ms, off by default).
- No sound for FAIL, errors, cards or the agent pill by default. Overlays are silent unless the user turns sounds on for cards.
- Follow the macOS "Play user interface sound effects" setting and the system alert volume.
- No tape rewinds, no whooshes, no sci fi. The sound should feel like a well made physical object, not a game.

### 7.9 App icon concepts

All three use the macOS 26 icon grid with layered Liquid Glass and ship light, dark, clear and tinted variants. None uses a clock, an arrow circling a clock, a swirl, or Apple's green and black.

**A. Playhead (recommended).** A black squircle. Across the lower third, a thin white ruler of seven ticks. A white playhead stands on the fifth tick, triangle head at the top. That one tick is a small green dot. Layers: background ink, ruler on a middle glass layer, playhead on the top layer so it catches light. Tinted mode: the green dot becomes the tint color but keeps its shape. Why: it is ownable, matches the website, reads at 16 px as "a line with a marker", and survives a rename.

**B. Fork.** A white squircle. A black line runs left to right and splits at a green dot into two lines: the upper one continues bright, the lower one continues at 30 percent. Why: it tells the product's unique idea (rewind as a new branch, nothing lost). Risk: it reads as a generic Git icon at small sizes.

**C. Stack.** Three rounded rectangles receding in depth on a mist background, each a glass layer. The front one has a small green dot in its corner. Why: it echoes the Time View corridor and Tahoe's layered icons beautifully. Risk: it is closer to generic "versions" or "layers" icons and to Apple's own depth metaphor.

Recommendation: **A** for the app and menu bar, with B's fork used as the in app illustration for the recovery report.

---

## 8. Microcopy deck

### 8.1 Voice

**Calm friend who knows Git.** Short, plain sentences. Warm, a little wry when things are fine, never cute when things are broken. Lead with the outcome. Say what we did and what we did not do. Name the agent without blaming it. No em dashes, no exclamation marks in errors, no "Oops", no "Uh oh", no "magic".

| Do | Don't |
|---|---|
| "It broke after Claude's last change." | "Claude broke your app!" |
| "10:42 works. Tests passed in 41 s." | "Success! Everything is perfect!" |
| "We couldn't check this version." | "Error 2: INCOMPLETE" |
| "Nothing was pushed or deleted." | "Don't worry, it's totally safe!" |
| "Your database was not rolled back." | (saying nothing) |
| "Use this version" | "Restore", "Revert", "Roll back" |

Banned words in the product: guaranteed, undo anything, any app, zero setup, enterprise ready, bulletproof, magic, instantly (unless measured), backup of your Mac.

Times use the user's locale format ("10:42", "3:14 pm"), with the day added when it isn't today ("Mon 10:42").

### 8.2 Core vocabulary

| Engine term | App term | Notes |
|---|---|---|
| checkpoint | save point | "a save point", plural "save points" |
| timeline | History | screen name |
| diff | Compare | verb and screen |
| open | Try this version / Try it | |
| verify | Check it works / check | "Checking…", "checked" |
| find-good | Find the last working version | |
| recover | Use this version | |
| coverage report | What's saved / What's not saved | after a rewind: Brought back / Not brought back |
| PASS / FAIL / INCOMPLETE / BLOCKED / ERROR | Works / Broken / Couldn't check / Needs something / Check crashed | fixed, never changed |
| unverified | Not checked yet | never "unknown" |
| host mode | safe copy (basic isolation) | |
| container mode | sealed copy (stronger isolation) | |
| recovery branch | new branch | name shown in Details |
| safety checkpoint | safety save | |

### 8.3 Buttons and menu items

| Context | Label | Shortcut |
|---|---|---|
| Primary actions | Save now | ⌘S |
| | Check it works | ⌘↵ |
| | Rewind | ⌘⇧R |
| | Use this version | ↵ (in Rewind) |
| | Try it / Try it first | T |
| | Compare with now | C |
| | Find the last working version | ⌘⇧F |
| | What broke? | ⌘⇧W |
| | Find where it broke | B |
| | Back to now | ⌘↑ |
| | Pin / Unpin | P |
| | Undo rewind | ⌘Z |
| Secondary | Show what changed · Show details · Show log · Copy report · Show in Finder · Check again · Try an older one · Pick a different one · Add value · Allow this host · Raise time limit · Clean up… · Connect · Disconnect · Pause watching |
| Dismissive | Not now · Later · Dismiss · Done |

Button rules: verbs first, two to four words, no "OK" or "Yes" (say the action: "Do it", "Clean up", "Disconnect").

### 8.4 Confirmations

| Action | Title | Body | Confirm | Cancel |
|---|---|---|---|---|
| Use this version | "Use the 10:42 version?" | "We'll save your current version first, then put 10:42 on a new branch. Nothing is pushed, merged, deployed or deleted." | Do it | Cancel |
| Undo rewind | "Go back to how it was at 3:15 pm?" | "You'll return to your previous branch. The 10:42 branch stays, in case you want it again." | Go back | Keep 10:42 |
| Clean up | "Free up 140 MB?" | "This removes 84 older autosaves. Pinned save points and the newest working one stay." | Clean up | Cancel |
| Disconnect agent | "Disconnect Claude Code from acme-shop?" | "We'll remove only the lines we added. Your save points stay." | Disconnect | Cancel |
| Turn on history | "Turn on history for this folder?" | "This adds a hidden .git folder and saves everything as it is now. Nothing else changes." | Turn on history | Not now |
| Allow a host during checks | "Let checks reach api.stripe.com?" | "Checks run offline to keep your accounts safe. Allowing this host means checks can call it. Real charges or emails could happen if your code does that." | Allow for this project | Keep offline |
| Remove project | "Stop looking after acme-shop?" | "We'll stop saving. Its save points stay for 30 days in case you change your mind." | Stop | Cancel |
| Cloud AI on | "Send change summaries to Claude for this project?" | "We send file names, change counts and short code snippets with secrets removed. Never your settings, secret values or files outside Git. You can preview it first." | Turn on | Preview… |

### 8.5 Status sentences (headers, menu bar, tooltips)

- "Works · checked 4 min ago"
- "Broken since 11:20 · last working 10:42"
- "Saved 2 min ago · not checked yet"
- "Checking… installing packages (12 s)"
- "Couldn't check the newest save point"
- "Needs something before it can be checked"
- "The last check crashed"
- "Claude Code is working"
- "Paused until 4:30 pm"

### 8.6 Cards

See section 6.3 for the full set (C1 to C16). Pattern: line 1 is the outcome in under 8 words, line 2 is the evidence or the next step in under 14 words.

### 8.7 Onboarding

| Screen | Headline | Body |
|---|---|---|
| Welcome | "Save points that know if they work." | "Save your project as you go. We check each version in a safe copy. When something breaks, go back to the last one that works, on a new branch, without losing a thing." |
| Footer | | "Works on this Mac. Your code is not uploaded." |
| Step 1 | "Which project should we look after?" | "macOS may ask to let us see your Documents folder. We only read the folder you pick." |
| Step 2 | "How should we check that acme-shop works?" | "Checks run in a safe copy, never in your folder. The internet is off during checks." |
| Step 2 fail | "It doesn't pass right now. That's OK." | "We'll save it as Broken. The next version that passes becomes your first green save point." |
| Step 3 | "When should we save?" | "We'll show you exactly what we add before we add it." |
| Done | "You're set." | "Each tick is a save point. Green means it passed a check. Press ⌃⌥T anytime to see this from any app." |

### 8.8 Empty states and errors

See 5.12 and 5.13 for the full tables. Additional microcopy:

- Loading History: "Reading your history…" (only after 400 ms; before that, show nothing).
- Find the last working version, nothing found: "None of the last 12 save points passed. The oldest one we checked is from Mon 9:10. [Check older ones] [Show what failed]"
- Find, all skipped: "We couldn't check any of these. They all need a value for DATABASE_URL. [Add value]"
- Try it, no web page: "Nothing to open for this project. It passed its check, which is the proof."
- Try it, port busy: "Another app is using port 3000. We started this version on port 3417 instead."
- Offline: no message. The app never needs the internet, except to install packages, where it says: "Installing packages needs the internet. We'll use the cache if it has everything."
- Update ready: "A new version is ready. It installs when you quit."

### 8.9 What's not saved: standard lines

Used everywhere the coverage report appears. Fixed wording so users learn it.

- "Database contents"
- "Secret values. We kept the names: {names}"
- "Anything already deployed"
- "Emails, payments and messages already sent"
- "Files over {limit} MB: {names}"
- "Files outside this project folder"
- "Global tools and system packages"
- "Services running on this Mac (like a local database)"

### 8.10 Fun, in the right places

Light touches only where the user is calm (never on Broken, Needs something or Check crashed screens):

- Save now HUD: "Saved." (with the tick filling)
- Third PASS in a row on a day: the status reads "Works · on a roll" for that session. Once.
- Empty History footer after a long green streak: "Nothing broke today. Rare. Enjoy it."
- Recovery report footer after a successful rewind: "Back on solid ground."
- Easter egg: in the Time View, pressing the Konami code scrubs the playhead to the very first save point with the label "Where it all began." Harmless and skippable.

---

## 9. Accessibility and keyboard

### 9.1 Shortcut map

Global (work in any app, all configurable, none require Accessibility or Input Monitoring permissions because they use hotkey registration, not event taps):

| Shortcut | Action |
|---|---|
| ⌃⌥T | Show timeline strip |
| ⌥Space | Ask bar |
| ⌃⌥S | Save now (active project) |
| ⌃⌥C | Check it works (active project) |

In app:

| Area | Shortcut | Action |
|---|---|---|
| Everywhere | ⌘K | Ask or jump (command palette) |
| | ⌘S | Save now |
| | ⌘↵ | Check it works |
| | ⌘⇧R | Rewind (opens the Time View) |
| | ⌘⇧F | Find the last working version |
| | ⌘⇧W | What broke? |
| | ⌘↑ | Back to now |
| | ⌘Z | Undo the last rewind |
| | ⌘N | Add project |
| | ⌘1 to ⌘9 | Switch project |
| | ⌘0 | Toggle sidebar |
| | ⌘, | Settings |
| | ⌘L | Expand or collapse the live log |
| | ⌘. | Stop the running check |
| | ? | Show all shortcuts |
| History and Time View | ↑ ↓ | Previous or next save point in the list |
| | J / L or ← → | Step one save point on the ruler |
| | ⇧J / ⇧L | Jump to previous or next verdict change |
| | K or Space | Stop the find walk; in History, Space opens the Time View |
| | Home / End | First save point / Now |
| | 1 2 3 | Zoom Hour, Day, All |
| | T | Try it |
| | C | Compare with now |
| | P | Pin or unpin |
| | B | Find where it broke (between selection and the next PASS) |
| | E | Edit title |
| | ↵ | Use this version (in Time View), open detail (in History) |
| | Esc | Leave the Time View or close a sheet, with no change |
| Compare | [ ] | Move the left end of the range |
| | { } | Move the right end of the range |
| | O | Toggle screenshot overlay |
| | U | Toggle unified or split diff |
| Cards (when focused) | ↵ | Primary button |
| | Esc | Dismiss |

Shortcut hints appear in every tooltip and in the Ask bar. When a shortcut fires, its button shows a pressed state for 120 ms (key feedback).

### 9.2 VoiceOver

The renderer is web content, so it uses ARIA, which VoiceOver reads in Electron.

- **The ruler is a slider** (`role="slider"`) with `aria-valuetext` such as "Save point 9 of 18. 10:42 am, Added dark mode, by Claude Code. Works, tests passed." Arrow keys move one save point; Page Up and Page Down jump to verdict changes. Ticks are not individually focusable (too many stops).
- **The verdict is always in text.** Glyphs have `aria-hidden` and the label ("Works", "Broken") is read. Never color alone, never glyph alone.
- **Live regions:** check progress is a polite live region announcing step changes ("Installing packages"), and the verdict is an assertive announcement once ("Check finished. Broken. 3 tests failed.").
- **The Time View** has a logical reading order: step bar, stage title and verdict, comes back list, does not come back list, buttons, ruler. The corridor cards are decorative (`aria-hidden`); the same content is available in the ruler and the list.
- **Overlays:** non activating panels are hard for VoiceOver to reach, so every card also triggers a VoiceOver announcement (via the macOS accessibility announcement API from the native helper, or the Electron main process) and is listed in the menu bar Recent list, which is fully keyboard and VoiceOver navigable. A global "Read last card" shortcut (⌃⌥R, off by default, on automatically when VoiceOver is running) reads it again.
- **Simple rewind** is offered automatically when VoiceOver is running (with a choice to switch back).
- **Labels:** icon only buttons all have labels ("Pin save point", "Close card").

### 9.3 Reduced motion, transparency and contrast

| System setting | What changes |
|---|---|
| Reduce motion | No corridor motion, no playhead glide, no fork drawing, no stamp spring, no breathing (checking shows a static ring with "Checking…" text). 120 ms cross fades replace movement. The agent pill is static. Onboarding ruler appears whole. |
| Reduce transparency | All vibrancy replaced with solid `--mist` and `--surface`. |
| Increase contrast | Hairlines darken, `ink-3` text promotes to `ink-2`, verdict badges gain borders, focus ring thickens to 3 px. |
| Differentiate without color | Already the default: every verdict has a unique shape and a text label. |
| Larger text (app setting S, M, L) | Whole type scale scales; rows grow; the ruler keeps tick spacing and adds horizontal scroll. |

### 9.4 Contrast targets

| Pair | Target | Notes |
|---|---|---|
| Body text on paper | 7:1 or more | ink 2 on paper |
| Caption and AI text on paper | 4.5:1 or more | ink 3 on paper in both modes |
| Verdict text on verdict bg | 4.5:1 or more | fg on bg tokens |
| Ticks, dots, glyphs on paper | 3:1 or more | solid tokens |
| Focus ring on any surface | 3:1 or more | ink ring with paper gap |
| Dimmed future (right of playhead) | Text stays 4.5:1 | the veil dims the graphics more than the text |

Verify all values with a checker in both modes before shipping; section 7.1 values are starting points.

### 9.5 Other inclusive details

- Every drag has a click and keyboard alternative.
- Click targets at least 28 x 28 px, ticks get an invisible 24 px tall hit area.
- Time is never the only cue: "Broken since 11:20" always also says what broke.
- Plain language reading level aimed at about grade 6 to 8 for default copy; technical detail sits behind Details.
- Localization ready: no text in images, room for 30 percent longer strings, 24 hour clock support.

---

## 10. Capability showcase: how this is different

The table compares the **planned** app (nothing is built yet) with tools people already use. "Partial" means the tool does part of it or only in some cases. Competitor facts come from the brief section 6, research 12 section 3.1, and the official docs listed in the sources; they should be rechecked before any public use, because these tools change often.

| Capability | **{App} (planned v1)** | Claude Code rewind | Cursor checkpoints | Lovable history | Git GUIs (GitHub Desktop, Tower, GitButler) | Apple Time Machine |
|---|---|---|---|---|---|---|
| Saves before and after each agent turn, automatically | Yes, through hooks | Yes, per prompt | Yes, per agent step | Yes, every change | No (manual commits; GitButler records its own operations) | No (hourly whole disk) |
| Covers shell side effects (`rm`, `mv`, scripts) | Yes, captures the project state, not just tool edits | No, bash changes are not tracked | No, terminal changes not tracked | n/a (hosted) | Only what you commit | Yes, at hourly granularity |
| Covers manual edits and other tools | Yes | No, current session only | No, agent changes only | Only edits inside Lovable | Yes, if committed | Yes |
| Works across Claude Code, Cursor, Codex, Gemini and people | Yes | Claude Code only | Cursor only | Lovable only | Tool agnostic, but no agent awareness | Tool agnostic, no project awareness |
| Saves files Git ignores or doesn't track (selected) | Yes, outside the project | Partial (edited files only) | Partial | n/a | No | Yes |
| Records config keys, packages, runtime, build definition | Yes, key names only, never secret values | No | No | No | Partial (lockfile if committed) | Files only |
| **Checks that a version actually works, in a clean copy** | **Yes, with a recorded verdict and isolation mode** | No | No | No | No (CI is separate and remote) | No |
| **Finds the last working version automatically** | **Yes, walks back and checks** | No | No | No | No (manual `git bisect` exists) | No |
| **Finds the exact save point where it broke** | **Yes, bisect with real checks** | No | No | No | Manual `git bisect` | No |
| Rewind as a new branch, current state saved first, undoable | Yes | Partial (restores edited files in place; can also rewind the conversation) | Partial (in place) | Yes (revert adds a new version) | Yes for experts | Restores files in place or as copies |
| **Says what was not brought back, every time** | **Yes, structurally** | No | No | In docs (database not restored) | No | No |
| Survives `rm -rf` of the project folder | Yes, store lives outside the project | Partial | No | n/a | No if `.git` is deleted | Yes |
| Plain language for non technical users | Yes, with details on demand | No | No | Yes | No | Yes |
| Tells you when an agent turn broke things, without asking | Yes, verdict regression card and agent wake up | No | No | No | No | No |
| Picture of the app at each version | Yes, for web apps that pass the "open the home page" check | No | No | Yes (preview) | No | No |
| Never pushes, merges or deploys | Yes | Yes | Yes | Revert redeploys edge functions | User driven | n/a |
| Runs locally, no account | Yes | Yes | Yes | No (hosted) | Yes | Yes |
| History length | User set budget with thinning; pinned and newest working never thinned | About 30 days (reported) | Session based | Project lifetime | Forever (Git) | Until the disk fills |

The three bold rows are the moat. Plain undo is a commodity (brief section 6). **Proof that it works, the exact point it broke, and honesty about what did not come back** are what nobody else combines.

How the app makes these visible (so people feel the difference in the first five minutes):

1. **Onboarding gives a verdict.** The first screen after setup already shows a green or red tick. No other tool shows that.
2. **The Rewind shows the check running.** Proof is a scene, not a claim.
3. **"Not brought back" is on every result.** Users notice what other tools never told them.
4. **The red card arrives before you notice.** Agent watch catches the break while you are still in the terminal.
5. **"Find where it broke"** answers the question developers otherwise spend an hour on.

---

## 11. Phased design roadmap

Scope reminder: the brief's current scope is Phase A (CLI) then Phase B (desktop, D01 to D08). Items in v1.5 and v2 need the founder to widen scope first, and several (ML experiments, test environments with data) touch areas the brief lists as out of scope today (Python, database snapshots, cloud). They are design direction, not commitments.

### v1: ships with Phase B (about 8 to 10 weeks after the CLI demo works)

| Area | Design deliverables | Maps to |
|---|---|---|
| Onboarding | Welcome with ruler animation, three steps, first real check inside onboarding, hook install diff sheet | D01 |
| Projects and History | Projects home with mini rulers, History with ruler band, day grouping, Important filter, inspector | D02 |
| Save point detail | Title, verdict block with evidence and isolation, What's saved / not saved, Details panel | D03 |
| Rewind | Simple rewind sheet (four steps) **and** the Time View with known answer and live find choreography, fork animation, Undo | D04 |
| Compare | Range ruler, section summaries, unified and split diff, screenshots side by side (when available) | D05 |
| Overlays | Menu bar item with all states, corner cards C1 to C16, frequency limits, timeline strip, agent pill | D06 |
| Settings and Backups | Storage meter, Clean up preview, isolation choice, agents, hotkeys, sounds, AI and privacy | D07 |
| Polish | Light and dark tokens, verdict glyph set, type scale, motion tokens, icon A, three sounds, DMG background, update prompt | D08 |
| AI (local only) | Agent prompt titles, template summaries, "What broke?" facts and overlap ranking, "Find where it broke", "Is it safe to rewind?" detection, agent watch | |
| Accessibility | VoiceOver ruler slider, live regions, reduced motion paths, Simple rewind auto offer | |

Cut line if time is short (in this order): screenshots in the Time View corridor (fingerprint cards instead), haptics, sounds, the agent pill, the overlay mode in Compare. Never cut: verdict honesty, Not brought back lists, Undo, the menu bar dot.

### v1.5: the "it knows" release

- **On device model** via the signed Swift helper: better titles and two sentence summaries, "What broke?" phrasing, haptics on the same helper.
- **Natural language rewind** in the Ask bar ("before I added Stripe").
- **Opt in cloud AI** with the user's own key and the Preview what we send sheet.
- **Screenshots everywhere**: per save point for web apps, skimming on all rulers, overlay wipe in Compare.
- **Sessions view**: agent sessions as first class clips with a session summary ("Claude worked 47 minutes, made 14 save points, broke it once at 11:20, fixed it at 12:05").
- **Pinned shelf and named milestones** ("Before the demo") with drag to pin.
- **Cursor, Codex and Gemini kits** surfaced in the Agents screen with their own status and limits.
- **Shareable recovery report** as a static Markdown or HTML file the user can attach to a PR or send to a client (local file, no hosting).
- **Agency mode**: a projects home tuned for many client repos (sort by Needs a look, bulk Check all).

### v2: beyond code

All three views reuse the same ruler, playhead, verdict system and Time View. Only what a "save point" contains and what "works" means change.

**ML experiments view.** A save point records code, config and hyperparameters, data snapshot digests, seed, environment, and metrics. "Works" becomes a user defined check over metrics ("val accuracy at least 0.91 and loss decreasing"). The activity band becomes a metric sparkline per save point, and verdict ticks still decide color. Rewind gives back the exact run setup on a new branch with "Not brought back: the trained weights (over size limit)" style honesty. RL runs show episodes as a lane under the ruler. Requires Python support and large file handling, both out of scope today.

**Test environments view.** A save point records the full test environment definition (compose file, service versions, seed data recipe, fixtures), and "works" is the test suite against it. The Time View stage shows service health tiles instead of a screenshot. This is where database snapshots would live if the founder later approves them; until then the view only records definitions and says "Database contents not saved".

**Cross tool timeline.** One ruler, many lanes, like a multitrack editor: Claude Code, Cursor, Codex, manual edits, Git commits, CI results (read only), deploys (read only markers from the deploy log, never actions). The playhead cuts across all lanes, so a user can see "Cursor changed the checkout at 11:05, Claude fixed lint at 11:20, the deploy at 12:15 shipped the broken one". Rewind still only ever creates a local branch. Team sharing of this timeline needs accounts and sync, which are out of scope today.

---

## 12. Open design questions for the founder

1. **Name.** The icon, wordmark and copy are built to survive a rename. The Time View should get its own name only after the product name is settled (candidates: "Time View", "Rewind view", "the Reel").
2. **Default Rewind style.** Time View for everyone, or Simple rewind for non technical users with the Time View one click away? Recommendation: Time View by default, because it is the product's signature, with Simple rewind auto offered for VoiceOver and reduced motion.
3. **Check after every agent turn by default?** It is the source of the red card, but it costs CPU and time. Recommendation: on, with the fast smoke command, and cancel on a new turn (research 12 section 8.3).
4. **Wake the agent on break.** On by default in Claude Code (it is the killer loop) or ask during onboarding? Recommendation: ask once, in step 3, defaulting to on.
5. **Sounds on by default in the Time View?** Recommendation: on, low, following the system setting. Test with beta users.
6. **The Swift helper in v1.** It unlocks haptics, on device AI and better VoiceOver announcements, but it adds a signed binary to notarize. Recommendation: v1 if the Apple Developer enrollment is sorted early (brief section 9.2).

---

## Sources for this pass

Context files: `docs/BUILD_BRIEF.md`, `.private/research/12-app-overlay-npm-tech.md`, `.private/research/03-website-design.md` section 7.

Reference research (14 October 2026):

- Apple Time Machine restore interface: [Apple support, restore files](https://support.apple.com/guide/mac-help/mh11422/mac), [Micro Center, What is Time Machine](https://www.microcenter.com/tech_center/article/6605/what-is-time-machine)
- Linear: [Blake Crosley, Linear design guide](https://blakecrosley.com/guides/design/linear), [925 Studios, Linear design breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026), [Unsung, Linear's visual key feedback](https://unsung.aresluna.org/linears-visual-key-feedback)
- Raycast 2.0: [Raycast changelog, macOS 2.0](https://www.raycast.com/changelog/macos/2-0), [AlternativeTo, Raycast 2.0 out of beta](https://alternativeto.net/news/2026/8/raycast-2-0-is-officially-out-of-beta-with-a-new-interface-and-cross-platform-support/)
- Figma version history: [Figma help](https://help.figma.com/hc/en-us/articles/360038006754), [Figma blog, named versions](https://www.figma.com/blog/now-you-can-name-and-annotate-your-figma-version-history/), [Figma forum, filtering autosaves](https://forum.figma.com/share-your-feedback-26/figma-design-version-history-issues-50320)
- Granola: [Product Salon, Granola](https://productsalon.substack.com/p/piece-no-3-granola), [Silicon Canals, Granola introduction](https://siliconcanals.com/introducing-granola-the-ai-notepad-that-enhances-not-replaces-your-thinking-in-meetings), [TechCrunch](https://techcrunch.com/2024/05/22/granola-debuts-an-ai-notepad-for-meetings)
- Things 3 Magic Plus: [Cultured Code features](https://culturedcode.com/things/features/), [Cultured Code support](https://www.culturedcode.com/things/support/articles/2803582)
- macOS Tahoe design: [MacStories Tahoe preview](https://www.macstories.net/stories/macos-tahoe-the-macstories-public-beta-preview/), [MacRumors Tahoe review](https://www.macrumors.com/2025/08/01/macos-tahoe-review)
- Lovable history: [Lovable docs, history](https://docs.lovable.dev/features/projects/history)
- Cursor checkpoints: [Cursor forum, UX confusion on restoring checkpoints](https://forum.cursor.com/t/ux-ui-confusion-on-restoring-checkpoints/67614), [Cursor forum, checkpoints still broken](https://forum.cursor.com/t/checkpoints-are-still-broken/169425)
- Claude Code checkpointing: [Claude Code docs, checkpointing](https://code.claude.com/docs/en/checkpointing), [Eon, Claude Code rewind and bash](https://www.eon.io/blog/claude-code-rewind-bash)
- Wispr Flow bar, CleanShot X, Dropbox Rewind, overlay APIs: as cited in research 12 sections 2.4 and 3.1.

Caveats: Arc, video editor and Apple HUD patterns are from general product knowledge, not re verified in this pass. Several Linear and Granola details come from third party write ups. Competitor rows in section 10 must be rechecked against official docs before any public comparison.
