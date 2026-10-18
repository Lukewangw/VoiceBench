# VoiceBench · Job board

A simple board for everything the team needs to do. Admins post jobs, anyone can propose one, and people pick
things up themselves.

**Open the board: https://lukewangw.github.io/VoiceBench/**

## Using it

- **Jobs** lists everything that's approved and not done yet, sorted by priority (P0 urgent → P3 low), then by
  due date. Click a job to see the details, who's on it, and its activity.
- **Others** is where anyone can propose a job. An admin approves it (it moves to Jobs) or declines it.
- **Done** keeps what's been finished.
- **Pick up** a job to put yourself on it; several people can work on one job. **Mark done** when it's finished,
  or **Drop** it if you can't get to it. Jobs you're on are marked with a green bar.
- **Up for grabs** and **Mine**, above the list, narrow Jobs to what nobody has picked up yet and to what you're
  on. Search (press `/`) matches titles, people (`@name`) and numbers (`#12`); `n` adds a job.

Admins' changes apply right away. Everyone else's go through the board bot and land within a minute; the page
shows "Picking up…" and similar until they do.

Looking needs no account. To make changes from the board, click **Sign in** and paste a GitHub token (the dialog
links to a token page with the right scope already ticked). The token stays in your browser and is only sent to
api.github.com.

### Who can do what

|                                   | Everyone with a GitHub account |    Admins     |
| --------------------------------- | :----------------------------: | :-----------: |
| See the board                     |     ✓ (no sign-in needed)      |       ✓       |
| Propose a job in Others           |               ✓                |       ✓       |
| Pick up, drop, mark done, comment |               ✓                |       ✓       |
| Edit priority and due date        |      their own proposals       |       ✓       |
| Add jobs straight to the board    |                                |       ✓       |
| Approve or decline proposals      |                                |       ✓       |
| See and add private jobs          |                                | ✓ (see below) |

**Admins are the people with write access to this repository.** To make someone an admin, add them under
Settings → Collaborators. Everyone else doesn't need to be added at all.

The repository is public, so the jobs on the board are public too, except private jobs.

### Private jobs (admins only)

When adding a job, admins can choose **Admins only**. Private jobs are kept in a separate private repository,
`VoiceBench-private`, so they never appear in this public repository or on the published site. On the board they
show with a 🔒, only to admins who can access that repository; everyone else's browser never loads them.

One-time setup:

1. Create a **private** repository named `VoiceBench-private` under the same account (it can stay empty).
2. Add every admin as a collaborator there as well.
3. Admins sign in with a token that has the `repo` scope (the sign-in dialog links to one), because a
   `public_repo` token can't read private repositories. The board's account menu says whether you can see them.

A private job stays private: GitHub doesn't move issues from a private repository to a public one. Private jobs
skip the bot, since only admins see them and admins' changes apply directly.

## Doing it on GitHub instead

Every job is an issue in this repository, so everything also works from GitHub:

- New job or proposal: open an issue with the **New job** form. Admins' issues go straight to Jobs; everyone
  else's land in Others.
- Everything else: comment a command on the issue. The board bot applies it within a minute and reacts with 👍
  (or 😕 plus a reply saying why it couldn't).

| Comment                        | What it does                                       | Who                     |
| ------------------------------ | -------------------------------------------------- | ----------------------- |
| `/take`                        | Put yourself on the job (also `/pickup`, `/claim`) | anyone                  |
| `/drop`                        | Take yourself off                                  | anyone                  |
| `/done`                        | Mark the job done                                  | people on it, admins    |
| `/reopen`                      | Reopen a finished job                              | people on it, admins    |
| `/approve`                     | Approve a proposal into Jobs                       | admins                  |
| `/reject <reason>`             | Decline a proposal or cancel a job                 | admins                  |
| `/priority P1` (or `/p1`)      | Set the priority, P0 to P3                         | admins, proposal author |
| `/due 2026-10-31`, `/due none` | Set or clear the due date                          | admins, proposal author |
| `/take @name`, `/drop @name`   | Assign or unassign someone else                    | admins                  |

## How it's built

- **Data**: GitHub Issues. The `job` label means approved, `proposal` means waiting in Others, and `P0`–`P3`
  is the priority. The due date lives in the issue body, under "Due date"; the board and the bot only ever
  change that answer (or drop the form's Priority answer once it is a label) and leave all other text as written.
- **Bot**: [`.github/workflows/board.yml`](.github/workflows/board.yml) runs on every issue and comment event,
  with the newest commit whose tests passed (so does publishing).
  [`.github/scripts/triage.js`](.github/scripts/triage.js) files new issues and applies commands, then the site
  is rebuilt and published to GitHub Pages with a fresh snapshot of all issues
  ([`snapshot.js`](.github/scripts/snapshot.js)), so the page loads instantly for everyone.
- **Site**: a small React app in [`src/`](src). People who sign in read GitHub directly, so their changes show up
  right away. Rules shared by the site and the bot live in [`shared/board.js`](shared/board.js).
- **Activity**: every change made from the board is also left as a command comment, so the activity (and GitHub's
  notifications) show who did what. When an admin's change was already made directly, the comment carries a hidden
  note and the bot only acknowledges it. The bot handles each issue's commands one run at a time, oldest first.

### One-time setup

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Actions → **Board** → **Run workflow** (or open any issue) to publish the first version.
3. Add your admins as collaborators.

### Development

```sh
npm install
npm run dev           # local site, reading live issues from GitHub
npm test              # unit tests: board rules, the bot, the snapshot
npm run e2e           # end-to-end: the built site in Chromium against a fake GitHub API that runs the real bot
npm run typecheck
npm run format        # Prettier
npm run build
```

`npm run e2e` needs a Playwright Chromium (`npx playwright install chromium`). It covers members' and admins'
flows, private jobs, search, filters and keyboard use, hostile comment HTML, phone-sized screens and an axe
accessibility audit in light and dark mode.

Every push and pull request runs formatting, type, unit and end-to-end checks; the site is only published when they
pass. Dependabot opens one grouped update a month per ecosystem, checked the same way.

## Security and privacy

- **Tokens** stay in the browser that pasted them (localStorage for this site) and are only sent to
  api.github.com. Anything on the same `<user>.github.io` origin could read them, so don't host untrusted pages
  there. Signing out removes the token (in every open tab of the board), and so does GitHub rejecting it
  (expired or revoked): the board then says so instead of quietly going stale.
- **Content Security Policy**: the published page runs only its own scripts, connects only to api.github.com and
  shows images only from GitHub.
- **Issue text is untrusted**: it is rendered from Markdown and sanitized; it can't run scripts, add form fields
  (other than read-only task-list boxes), styles, classes or ids.
- **Private jobs** live only in the private repository. The published site and its `data.json` contain public
  issues only; private jobs are fetched by an admin's browser with the admin's own token, and only when that
  repository reports itself as private.
- **The bot** runs with the workflow's `GITHUB_TOKEN` (issues: write), checks write access before admin-only
  commands, and never executes anything from issue text.
