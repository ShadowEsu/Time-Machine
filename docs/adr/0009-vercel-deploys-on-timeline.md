# ADR 0009: Vercel deploys on the timeline

Date: 16 October 2026. Status: accepted. Engine side built in the Mac app. The window views are built (`renderer/deploys.ts` for the chips and the list of deploys from a computer, `renderer/feature-settings.ts` for the token and the link). They show in the app once the new app design mounts them.

## Context

People who ship with Vercel want to see which save point is live. The brief lists "Vercel deploy references" as a later feature. The team approved it as a read only view. Deployment rollback stays out of scope.

## Decision

- **Opt in per project.** The person links one Vercel project from a list of the projects their token can see. The link is stored as `{ teamId, projectId, name }` in `features.vercel` of that project in `projects.json`. Unlinking sets it back to null.
- **The link records what was agreed (added 28 October 2026).** Linking stores `features.vercelConsent = { at, version }`, where `version` is `VERCEL_CONSENT_VERSION` for the read-only note Settings shows above the link (`VERCEL_READ_NOTE` in `shared/api.ts`). `deployments` reads nothing from Vercel unless the record matches the current version (`vercelConsentValid`). A link from before records existed, or from an older note, shows "Deploys are paused" with Link again. Unlinking keeps the record of the last agreement.
- **Read only, enforced in code.** The main process sends only `GET`, and only to three endpoints: `/v2/teams`, `/v10/projects` and `/v7/deployments` on `api.vercel.com`. Any other method or path is refused before a request leaves the Mac. A test covers POST, PATCH, PUT and DELETE. Redirects are refused, so the token is never sent anywhere else.
- **Matching rule.** A deploy is placed next to a save point only when the deploy's Git commit (`githubCommitSha`, `gitlabCommitSha` or `bitbucketCommitSha`) equals the Git HEAD recorded in that save point's manifest. Several save points can share one commit; all are listed. A match is marked exact only when neither side had uncommitted changes. Times are never used to guess.
- **Deploys without a commit** (most deploys from the Vercel CLI) are listed apart as "Deployed from your computer, not linked to a save point". Deploys of a commit no save point recorded are listed apart too.
- **What is read:** the 50 newest deploys of the linked project, with URL, target (production, preview or another environment), state, time, the creator's Vercel username, source, commit, branch and the inspector link. The creator's email is not kept.
- **Token.** The person pastes a Vercel token in Settings. It is stored encrypted with Electron `safeStorage` in its own file in the app's userData folder, never in `projects.json` or `settings.json`. `VERCEL_TOKEN` in the environment wins when set. The token goes only into the `Authorization` header, never into a result, an error message, a log or the window. The window only learns whether a token is set. The app never reads another app's credentials, such as the Vercel CLI login file.
- **Every answer is checked with Zod.** An answer that does not match is rejected with a plain sentence and nothing is shown. Errors are fixed sentences, so no text from Vercel or the network stack reaches the window.
- **Cache.** Answers are kept in memory for 60 seconds per Vercel project, and the project list for 60 seconds. Changing the token or the link clears them. Matching against save points runs fresh every time, so a new save point shows its deploy at once.
- **Links open only on Vercel.** A deploy chip opens the deploy in the browser through the `openExternal` call. The main process accepts only plain `https` links to `*.vercel.app` and `vercel.com` (plus Google's Gemini terms page for ADR 0008), with no login or port in the URL. Anything else is refused before the browser is asked.
- **Network code lives in the Mac app's main process.** `packages/core` gains no network calls. Core only exposes the recorded HEAD (`head`) on each save point.

## What it never does

- No rollback, no promote, no redeploy, no cancel, no delete, no changes to settings, domains or environment variables.
- No guessing which deploy belongs to which save point by time.
- No claim that a deploy matches what a save point holds when either side had uncommitted changes.
- No reading of other apps' credential files.

## Alternatives

- **Vercel CLI login file:** zero setup, but it reads another app's secret and acts with its full scope. Rejected.
- **OAuth integration:** better scoping, but needs a hosted callback and a Vercel integration listing. Later, if people ask.
- **Matching by time:** often right, sometimes wrong, and wrong silently. Rejected.
- **Rollback from the app:** the brief keeps deployment rollback out of scope. Rejected for now.

## Cost

- No hosting cost. Calls go straight from the Mac to Vercel with the person's own token. Deploy lists are cached for a minute per project. The project picker follows pagination across personal projects and teams.
- The person's token may allow writes. Read only is enforced by this app's method and endpoint allow-lists, not by a claim about the token's permissions.
- Only the newest 50 deploys are read. Older deploys do not show. This view does not prove which production alias currently serves traffic after a change made outside the app.

## Migration path

Projects saved before this change load with `features.vercel` set to null. Unlinking turns the feature off. Removing the stored token removes its encrypted entry; an environment token still wins if one is set. Without either token, the link remains but reading it asks for a token.

## API references

- [List deployments (v7)](https://vercel.com/docs/rest-api/deployments/list-deployments)
- [Retrieve projects (v10)](https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects)
- [Find a project (v9)](https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name)
- [List teams (v2)](https://vercel.com/docs/rest-api/teams/list-all-teams)
