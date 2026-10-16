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
  or **Drop** it if you can't get to it.

Looking needs no account. To make changes from the board, click **Sign in** and paste a GitHub token (the dialog
links to a token page with the right scope already ticked). The token stays in your browser and is only sent to
api.github.com.

### Who can do what

|                                     | Everyone with a GitHub account | Admins |
| ----------------------------------- | :----------------------------: | :----: |
| See the board                       |    ✓ (no sign-in needed)       |   ✓    |
| Propose a job in Others             |               ✓                |   ✓    |
| Pick up, drop, mark done, comment   |               ✓                |   ✓    |
| Edit priority and due date          |    their own proposals         |   ✓    |
| Add jobs straight to the board      |                                |   ✓    |
| Approve or decline proposals        |                                |   ✓    |

**Admins are the people with write access to this repository.** To make someone an admin, add them under
Settings → Collaborators. Everyone else doesn't need to be added at all.

The repository is public, so the jobs on the board are public too.

## Doing it on GitHub instead

Every job is an issue in this repository, so everything also works from GitHub:

- New job or proposal: open an issue with the **New job** form. Admins' issues go straight to Jobs; everyone
  else's land in Others.
- Everything else: comment a command on the issue. The board bot applies it within a minute and reacts with 👍
  (or 😕 plus a reply saying why it couldn't).

| Comment                          | What it does                                       | Who            |
| -------------------------------- | -------------------------------------------------- | -------------- |
| `/take`                          | Put yourself on the job (also `/pickup`, `/claim`) | anyone         |
| `/drop`                          | Take yourself off                                  | anyone         |
| `/done`                          | Mark the job done                                  | people on it, admins |
| `/reopen`                        | Reopen a finished job                              | people on it, admins |
| `/approve`                       | Approve a proposal into Jobs                       | admins         |
| `/reject <reason>`               | Decline a proposal or cancel a job                 | admins         |
| `/priority P1` (or `/p1`)        | Set the priority, P0 to P3                         | admins, proposal author |
| `/due 2026-10-31`, `/due none`   | Set or clear the due date                          | admins, proposal author |
| `/take @name`, `/drop @name`     | Assign or unassign someone else                    | admins         |

## How it's built

- **Data**: GitHub Issues. The `job` label means approved, `proposal` means waiting in Others, and `P0`–`P3`
  is the priority. The due date lives in the issue body.
- **Bot**: [`.github/workflows/board.yml`](.github/workflows/board.yml) runs on every issue and comment event.
  [`.github/scripts/triage.js`](.github/scripts/triage.js) files new issues and applies commands, then the site
  is rebuilt and published to GitHub Pages with a fresh snapshot of all issues
  ([`snapshot.js`](.github/scripts/snapshot.js)), so the page loads instantly for everyone.
- **Site**: a small React app in [`src/`](src). People who sign in read GitHub directly, so their changes show up
  right away. Rules shared by the site and the bot live in [`shared/board.js`](shared/board.js).

### One-time setup

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Actions → **Board** → **Run workflow** (or open any issue) to publish the first version.
3. Add your admins as collaborators.

### Development

```sh
npm install
npm run dev        # local site, reading live issues from GitHub
npm test           # rules and bot tests
npm run typecheck
npm run build
```
