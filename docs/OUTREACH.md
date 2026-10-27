# Talking to the first 5 builders

Status: plan and drafts, 15 October 2026. No one has been contacted yet. A person sends every message by hand. No agent or tool sends them.

Goal by 31 October: five 30 minute think aloud sessions with people who use coding agents. We want to learn two things. Do they hit this problem? And can a stranger get from a broken project to a working one with `tm`, without help?

## Who to look for

People who build with Claude Code, Cursor, Codex or Gemini CLI at least a few times a week. Best of all: someone who lost work to an agent in the last 90 days.

Aim for a mix:

- 2 developers who use Git and a terminal every day.
- 2 people who build with agents but rarely use Git.
- 1 person at a small agency or freelance shop that manages client repos.

## Where to find them

Start with people you already know. Then go to places where people have already talked about this problem in public.

1. **People you know.** Friends from SF Hacks, Mega Hackathon and Code The Change. Ask them to point you to one friend who uses agents.
2. **People who wrote about a break.** Cursor forum threads about agents deleting files. Claude Code GitHub issues about `git reset --hard` or lost work. Posts on X or Bluesky about an agent wiping a project. Reply to their public post, or message them if their profile invites it.
3. **Communities, with permission.** r/ClaudeCode and r/vibecoding: read the rules, and ask a moderator before posting. Lovable and Cursor Discord servers: only in channels meant for feedback or show and tell.
4. **Unvibe users.** Only people who agreed to hear from you. **[CONFIRM]** whether any did.

## Rules

- One message. One follow up at most, 5 to 7 days later. If there is no reply after that, stop.
- No bulk messages, no scraped lists, no bought lists, no copy and paste to dozens of people. Write each message to one person and mention what they posted.
- Never say "undo anything", "guaranteed" or "zero setup". Say what is built and what is planned.
- Never ask for access to their code. They pick the project. The demo project is fine.
- Ask before you record. If they say no, take notes by hand.
- No real customer data in notes you keep or share. Write "user 3", not a name, in anything that goes in this repo.
- Say thank you, and send them what changed because of them.

## Message drafts

Three drafts. All are drafts only. Whoever sends them edits and sends each one by hand. Change the first line for each person and keep it short.

### 1. Think aloud invite (to a builder you know, or who posted about losing work)

> Hi [name], I saw your post about [the agent deleting your folder / losing a working version]. That sounds rough.
>
> I'm [your name], and I'm building Time Machine. Your agent can break things. Time Machine proves which version still passes your tests and gets you back to it. It's a free command line tool, early, and not on npm yet.
>
> Would you try it for 30 minutes on a call and think out loud? I want to find what's confusing, not hear compliments. You can use our demo project. I never need access to your code. If it's not for you, no worries.
>
> [your name], [your email]

**Follow up (once, 5 to 7 days later):**

> Hi [name], bumping this once in case it got buried. If now's not a good time, no reply needed. Thanks either way.

### 2. Post for X or LinkedIn

Post only after the demo video is recorded. Attach the video. Link the docs page so readers can check the quote.

> Claude Code's own docs say it: "Checkpointing does not track files modified by Bash commands."
>
> So if your agent runs rm or git reset, rewind can't bring it back.
>
> I'm building Time Machine. It saves a point before each prompt and before risky shell commands. When something breaks, it runs your tests on each save point in a separate copy and finds the newest one that works. Then it makes a recovery branch. Your folder is not touched. It also tells you what it could not bring back.
>
> 60 second demo below. Free command line tool, early, not on npm yet.
>
> Looking for 5 people who build with agents to try it and tell me what's confusing.
>
> code.claude.com/docs/en/checkpointing

### 3. Cold DM to a developer who runs agents a lot

Only if their profile invites messages. Mention something specific they posted.

> Hi [name], your post on [running Claude Code overnight / agents on auto approve] stuck with me.
>
> Quick question: when an agent breaks something mid run, how do you find the last version that worked?
>
> I'm building a small tool for exactly that. It tests each save point in a separate copy and makes a recovery branch without touching your folder. Happy to send the 60 second demo if useful. No pitch beyond that.
>
> [your name]

## Think aloud session (30 minutes)

Before the call: have the repo built (`pnpm install && pnpm build`) or the npm package ready if published. Have a fresh store ready: `export TM_HOME="$(mktemp -d)"`. Share nothing else on screen.

### 1. Start (3 minutes)

Read this out:

> Thanks for doing this. I'm testing the tool, not you. There are no wrong answers. Please say out loud what you're thinking, what you expect, and anything that's confusing. I'll mostly stay quiet. Is it OK if I record the screen and audio? I'll only use it to take notes, and I'll delete it after.

### 2. Their story (5 minutes)

- Tell me about the last time an agent broke something in your project. What happened?
- How did you get back? How long did it take?
- What do you use today to stay safe? (Git, commits, the agent's rewind, nothing)

Do not mention Time Machine yet. Do not suggest answers.

### 3. Tasks (15 minutes)

Give one task at a time. Don't explain how. If they're stuck for 2 minutes, give one hint and note it.

1. "Here's the README. Tell me in your own words what this does." Note what they get wrong.
2. "Run the demo." (`tm demo`, or `npx timetm demo` if published.) Then: "What just happened? Which version works? Is your folder changed?"
3. "Find the part of the output that says what was not brought back. What would you do next?"
4. Optional, if they want: "Try it on a project of yours. Make a save point, break something on purpose, then get back to a working version." Let them pick the project. Stop if they hesitate.

### 4. Questions (5 minutes)

- What was the most confusing moment?
- What did you expect to happen that didn't?
- Would you use this on your own projects? Why or why not?
- What would stop you from installing it?
- If it went away tomorrow, how would you feel? (Very disappointed, somewhat, not at all.) Why?
- Who else do you know who should try it?

Do not ask "Would you pay for this?" People are polite. Watch what they do instead.

### 5. Close (2 minutes)

Thank them. Tell them what happens next and when you'll share what changed. Ask if you can follow up once after you ship.

## What to write down after each session

Use the evidence record from `design/EXPERIENCE.md` section 8. For each problem:

| Field | Write |
|---|---|
| Screen | The command or page, date, which user (by number), task |
| Observation | The exact moment they got stuck, their words, how bad, how sure you are |
| Change | What you would change, before and after |
| Measure | How you'll know the change worked |

Also keep a tally across all five:

- How many finished the demo without a hint.
- How many could say which version works and that their folder was not changed.
- How many said "very disappointed".
- The words they used for the problem. Use their words on the site.

A problem that 2 or more people hit gets fixed before the next session. Every fix to the tool starts with a failing test.
