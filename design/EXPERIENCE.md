# Time Machine experience principles

Status: planning. Nothing is implemented yet. Distilled from the round 4 research (psychology, 36 app teardowns, pricing, two experiences). Full reports live in `.private/research/30` to `33`.

## 1. The one idea

People keep a utility because it gives **reliable relief**, not because it is a slot machine. Time Machine earns attachment in four ways, strongest first:

1. **Relief at the rescue.** The peak moment is the verdict turning to Works. The end is an honest summary that also lists what did not come back (peak-end rule).
2. **A history that grows.** Verified save points, pinned "known good" versions and custom checks exist only here. They get more valuable with use (investment, endowment, IKEA effect). They stay exportable, never held hostage.
3. **Trust that is earned.** Show the real check running, step by step, with real timings (labor illusion, operational transparency). A false Works is the worst possible bug. When unsure, say Couldn't check.
4. **Identity.** "Build with a way back." Not "fearless," which implies nothing can go wrong.

Our closest model is Flighty: shine when things go wrong, be boringly obvious the rest of the time.

## 2. The habit loop

| Stage | Developers | Builders |
|---|---|---|
| Trigger | Agent turn starts or ends, a red build, the morning report, the menu bar dot | The app looks broken, an agent session starts, the morning report |
| Action | Read the verdict, `tm find-good`, one click Rewind | One button: Go back to the last working version |
| Reward | Works stamp with evidence and a measured time. The same honest reward every time | The app works again, explained in plain words |
| Investment | Verified history, custom checks, labels, hooks | Named save points, a simple check, versions that worked |

**Aha moment:** you watch your project break and watch Time Machine bring back a version it proved works.

- Demo path: under 2 minutes. A bundled sample app gets broken on purpose, then rewound by the real engine.
- Your own project: first verified save point in under 10 minutes.

## 3. What we measure

| Measure | Track |
|---|---|
| Weekly projects protected (at least one verified save point that week) | Yes, the main number |
| Verified rescues per active user per month | Yes |
| Time to first verified save point | Yes |
| False Works rate | Yes, target zero |
| Notification mute rate | Yes, as a warning light |
| Daily opens, session length, streak length, notification clicks | No |

Telemetry is opt-in. Secret values never appear in it.

## 4. Moments to build (all planned)

- First-run "break it, then rewind" demo on a sample app.
- Three-step setup with real progress. No check yet means "Saved, not checked", never Works.
- Auto-detected check from `package.json`, editable in plain words.
- Verdict stamp: shape and word, not color alone. Never Works without a run.
- Live check log of real steps, with no padding.
- Preview before rewind in a safe copy, then "Use this version" on a new branch, then "Undo this rewind".
- Rescue summary that always lists what was not brought back.
- Monday safety report, opt-in, sent even in quiet weeks, no guilt.
- Morning report for overnight agent runs, one notification.
- Agent track record ("104 of 120 sessions ended passing"), never a single score.
- Pin and name "known good" save points.
- Menu bar glance: one calm dot, no badges.
- "Agent said" next to "Time Machine ran" so a claim and a check are never confused.
- A skippable "Save point first?" card before risky agent commands.
- A plain-format promise: "If Time Machine disappears, your save points are still plain Git."
- "Rewound": an opt-in, local, free yearly recap with no code, paths or secrets.
- A share card the user starts on purpose: "My agent broke it. Time Machine brought back a working version in 11 s." Measured times only, no code or paths.
- A "first rescue" call with the first 100 paid users, plus the "very disappointed" survey at day 21.

## 5. What we never do

- Streak counters that can break. A broken streak drops engagement below having no streak at all. Use counts that only grow.
- Random rewards, suspense delays, fake or padded progress.
- Celebrations on rewinds or destructive actions (Robinhood confetti).
- Fear marketing, invented statistics, "at risk" alerts without a failing check.
- Guilt copy, confirmshaming, engagement notifications.
- A hard cancel flow or exit-intent discounts. Cancel takes the same steps as sign-up.
- Paywalling a restore, or the user's own history or recap.
- Repricing existing users mid-relationship.
- "Universal undo", "guaranteed", "zero setup".

These rules also keep us inside the law: the FTC Amazon Prime order (2025), California's automatic renewal law (AB 2863), the EU withdrawal button (June 2026), the UK DMCC subscription rules (2027), and Apple guideline 5.6.

## 6. Two experiences, one engine

**Decision:** no global "Simple" vs "Pro" switch. Home Assistant removed exactly that in 2026, and "Pro" collides with the paid plan name. No interface that rearranges itself either.

- **Two surfaces on one engine.** The CLI is home for developers and agents. The Mac app is for everyone. They never disagree.
- **One app layout for everyone.** Buttons never move. Nothing is locked to a mode.
- **One narrow setting: "Show Git details."** It adds commit IDs, commands and logs next to plain words. It never replaces them and never changes a verdict.
- **Inspector drawer (⌘I) on every screen**, Stripe Workbench style: the manifest JSON, the exact command, the log, and the `tm` equivalent with Copy.
- **Ramps, not cliffs.** Every app action has a shortcut and "Copy as command". Every CLI result ends with a Next hint. `tm app` opens the same save point in the app.
- **Onboarding asks about tools, not skill:** "Do you use Git or a terminal for this project?" It never says Simple, Basic, Beginner, Advanced, Expert or Pro.
- **Never changes between experiences:** verdict words and colors, "What's saved / What's not saved", the isolation label, "Nothing was pushed or deleted".

**Verdict words**

| Engine and CLI | App |
|---|---|
| PASS | Works |
| FAIL | Broken |
| INCOMPLETE | Couldn't check |
| BLOCKED | Needs something |
| ERROR | Check crashed |
| unverified | Not checked yet |

The full vocabulary table, CLI style rules and sample terminal output are in `.private/research/33-two-experiences.md`. The vocabulary will live as data in `packages/core`.

**Website:** one story for everyone. After the film, a visual fork leads to `/builders` and `/developers`, plus `/agents`.

## 7. Decisions recorded here

- Recovery never switches the user's folder. It creates the branch and a recovery copy. Switching is a separate button the user presses.
- Checkpoint IDs look like `cp-0003`.
- Install line: `npx timetm init`. Command: `tm`.
- Usage errors exit with 64 so they never collide with INCOMPLETE (2). See ADR 0005.

## 8. Ethical attention rules

Source: the founder's "Ethical attention design" guide (October 2026). Attention is borrowed. People must be able to understand, choose, pause and leave without penalty. Each rule below is a design hypothesis to test with real users, not a law.

| Study | What it found | Our rule |
|---|---|---|
| Iyengar and Lepper 2000, choice overload | Smaller choice sets led to more follow through | One primary action per screen: "Go back to the last working version". One quiet alternative: "See all save points". The full list is always one click away. |
| Fogg 2009, behavior model | An action needs motivation, ability and a prompt at the same moment | Make the step easier before adding a prompt. Prompts are relevant, dismissible and user controlled. Never prompt during a rewind or a check. |
| Salganik, Dodds and Watts 2006, social influence | Popularity signals made outcomes more unequal and less predictable | Only real numbers with a source and a time range ("104 of 120 sessions, last 30 days"). No invented counts or testimonials. Popularity is never shown as proof of quality. |
| Kivetz, Urminsky and Zheng 2006, goal gradient | People push harder near a goal they can see | Show honest progress on goals the user chose, with the math visible ("Month 5 of 6 to $8"). No fake head starts, hidden resets, or punishment for stopping. Grace and pause keep earned steps. |

**What we optimize:** task success (a verified rescue), informed return, trust and accessibility. Never raw time in app.

**Human gate.** An AI may inspect approved screens and propose changes. A person approves any public copy, experiment, notification, pricing change, or interface change with real user impact.

**Evidence record** for every proposed UX change:

| Field | What to write |
|---|---|
| Screen | URL or screen ID, date, audience, task, device |
| Observation | The exact friction, the evidence, severity, uncertainty |
| Research link | Paper, finding, mechanism, limits |
| Change | Component, before and after, copy, accessibility impact |
| Measure | Primary metric, guardrail, segment, decision rule, rollback path |

**Testing order:** moderated think-aloud sessions with 5 real users first, then a bounded A/B test only if needed. A higher click rate is not success if comprehension, wrong purchases or support contacts get worse.
