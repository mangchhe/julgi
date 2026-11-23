# Julgi reference

The long parts that do not fit the [README](../README.md): what Julgi grants its sessions, extension points, settings, files, and known gaps.

English · [한국어](reference.ko.md)

## What Julgi grants its sessions

Read this before you run it. Everything here can be turned off or narrowed in settings.

- **The `julgi` command runs without asking.** Every Julgi skill calls this one command.
- **Writes to `~/.julgi/grown`, and reads of transcripts (`~/.claude/projects`) and skill folders, do not ask either.** Sessions that create and refine skills need them.
- **A preference note is appended to each session's system prompt** (`--append-system-prompt-file`). Turn `brain` off and it is not attached.
- **Usage display reads Claude Code's login token.** It reads it from the keychain and sends it only to `api.anthropic.com/api/oauth/usage`. This endpoint is undocumented and may stop working. Off by default.
- **Simple permission prompts can be answered for you** (`autoAllow`, off by default). `look` lets read-only commands through (git status/diff/log, ls, gh and glab views); `check` adds test and build runners, which run scripts from the project. They are passed to Claude Code as permission rules at launch. Commands that read file contents (cat, grep) are not included; add them in `allowRules` if you want them.
- **Phone view opens one port** (default 4747). It accepts only the Tailscale range (100.64.0.0/10) and this Mac, and the token in the URL (`~/.julgi/remote-token`) must match. Off by default.
- **Sessions can read the repos on the map without asking** (a `Read` permission passed through `--settings`). Editing another repo still asks.
- **Julgi answers the "do you trust this folder" prompt for some folders**: the default folder, folders in `autoTrust`, and repos you named through `mapRoot` or `repos`.
- **Drawing the map fetches from remotes.** Only clean repos on their default branch are fast-forwarded (`mapFetch`).
- **Finished replies are read by a small model** (`triage`) to decide whether you are needed. The end of the reply and your last message are sent through `claude -p`.
- **Judgment calls go out through `claude -p`**, text only, no tools, no transcript kept. Briefings and second reads include the diff; preference extraction includes what you said.

## Extension points

The core knows only Claude Code and git. Company or personal pieces attach through settings.

- `pluginDirs`: extra skill folders loaded into every session.
- `saveCommand`: what `⌘S` sends to the current session.
- `worksCommand`: a command that prints a JSON list of work items used to group sessions.
- `repoPatterns`: regexes that pull a repo name out of a path when the folder is gone.
- `stripEnv`: environment variable prefixes not passed to Julgi's shells.
- `models`: which model each kind of judgment uses.

## Settings

Change them in `⌘,`; they apply at once and are saved to `~/.julgi/config.json`. Values not on screen are edited in the file.

| Key | Default | Meaning |
|---|---|---|
| `lang` | `auto` | Interface language. `auto` follows the system (Korean if the system is Korean, otherwise English), or `en`, `ko`. Applies after restart |
| `theme` | `ink` | Colors. `navy`, `graphite`, `forest`, `plum`, `sand`, `tokyo-night`, `catppuccin`, `dracula`, `nord`, `paper` |
| `thinking` | `balanced` | Level of the judgment models. `light` (all Haiku), `balanced`, `deep` |
| `hotTokens` | 150000 | Sessions larger than this are handed off to a fresh session before sending |
| `sleepHours` | 3 | Put sessions idle this long to sleep. 0 disables |
| `autoFill` | on | Bring sessions waiting on you into panes and fit the pane count |
| `summarize` | on | Summarize and name sessions |
| `judgeMerges` | on | Join sessions doing the same work into one stem without asking |
| `brain` | on | Store to and recall from the brain |
| `autoLead` | on | Make a coordinator for large work that spans repos |
| `taskWorktree` | on | Tasks run in their own worktree |
| `growSkills` | on | Turn repeated work into skills and refine used ones, one of each per week |
| `brief` | on | Summarize what a session changed and why |
| `check` | on | A larger model rereads the change after the briefing |
| `reviewHour`, `reviewDay` | 12, 1 | When the daily and weekly housekeeping runs (0 is Sunday) |
| `remote`, `remotePort` | off, 4747 | Phone view |
| `usage` | off | Show Claude subscription limits in the status bar |
| `memoryLimitGb` | 8 | Sleep idle sessions when total memory passes this. 0 disables |
| `skipPermissions` | `off` | Launch without permission prompts. `mine` (sessions I opened), `all` |
| `triage` | on | Read each finished reply and bring the session to My turn only when there is something to decide or answer |
| `longRunMin` | 30 | Notify once when one request has been running this many minutes. 0 disables |
| `morning`, `morningHours` | on, 6 | Show the briefing when you come back after this many hours away |
| `autoAllow`, `allowRules` | `off`, none | Commands let through without asking: `look`, `check`, plus your own prefixes or rules |
| `notify` | on | Notify when it becomes my turn and the window is not focused |
| `mapRoot` | none | Folder holding your repos; git repos under it go on the map |
| `mapFetch` | on | Fetch before drawing the map |
| `defaultDir` | `~/julgi` | Folder for work with no obvious repo |
| `hotkey` | `ctrl+super+KeyJ` | Global key to show and hide the window |

### Connections (GitHub · GitLab · Jira)

| Key | Default | Meaning |
|---|---|---|
| `prWatch` | `mine` | Which PRs to watch. `mine` (all I opened), `session` (only those sessions opened), `off` |
| `prEveryMin`, `askEveryMin` | 2, 5 | Minutes between PR checks and review request checks |
| `refreshOnFocus` | on | Check again as soon as the window regains focus |
| `prViewRefreshSec` | 30 | Seconds between reloads of an open PR view. 0 disables |
| `wakeOnPr` | off | Wake a sleeping session right away when its PR has news |
| `reviewAsks` | on | Put review requests in `⌘J` and notify |
| `jiraSite`, `jiraEmail`, `jiraKind` | none | Jira site URL, email, `cloud` or `server`. The token is not here; it lives only in the macOS keychain |
| `jiraWatch`, `jiraEveryMin` | `mine`, 5 | Whether to watch tickets assigned to me, and how often |
| `jiraStartTransition`, `jiraPrTransition`, `jiraMergeTransition` | `In Progress`, `In Review`, `Done` | Status to offer on start, on PR, on merge. Empty means do not ask |
| `jiraRepos` | none | Project key to repo (`ABC=acme-api, OPS=acme-infra`). Filled in as you start from tickets |
| `jiraQuiet` | none | Comment authors received quietly (display names or account ids, comma separated): no notification, not in `⌘J`. Bot accounts are always quiet |

What the connections use:

- **GitHub**: `gh`. Login and token stay with `gh`.
- **GitLab**: `glab api`. Login and token stay with `glab`.
- **Jira**: REST directly. The API token is kept only in the macOS keychain (`julgi-jira`) and is never passed on a command line.
- All three poll on an interval rather than receive webhooks. Julgi has no server to receive them.

## Files

Everything is a text file under `~/.julgi/`. Conversations are not here; Claude Code keeps them in `~/.claude/`.

| File | Holds |
|---|---|
| `config.json`, `layout.json` | Settings, panes and open sessions |
| `threads.json`, `threads/` | Stems, their memory, session summaries |
| `brain/`, `brain/history/`, `brain/retired/` | Brain notes, earlier versions, retired notes |
| `prefs.md` | Preferences appended to sessions |
| `changes.json` | Per-folder changes, briefings, second reads, per-reply snapshots |
| `MAP.md`, `map.json` | The repo map |
| `tasks.json`, `tasks/` | Tasks and results |
| `reviews.json` | Housekeeping records |
| `activity.jsonl`, `routes.jsonl`, `misroutes.jsonl` | What Julgi did, where it sent things, corrections |
| `plugin/`, `grown/`, `bin/julgi` | Julgi's skills, skills it grew, the session command |
| `pr-seen.json`, `jira-seen.json`, `jira-news.json` | Last known state of PRs and tickets, to tell news from old; ticket news not yet looked at |
| `triage.json` | For each finished reply, whether it needed you and why |
| `progress.json` | Goal, done, left, blocked per stem |
| `seen.json` | When you last looked at Julgi, for the briefing |
| `tickets.json` | Which session belongs to which Jira ticket |
| `jira-files/` | Images attached to tickets you opened, kept so sessions can read them |
| `remote-token` | Token for the phone view. Delete it to get a new one |
| `worktrees/` | Worktrees for tasks and tickets |

## Known gaps

- A sent message cannot be undone.
- Coordination has only been run on reading and small edits.
- Housekeeping runs only while Julgi is open; if it was closed, it runs at next launch.
- Sessions that create and refine skills have not yet run end to end in real use.
- The phone view does not route for you, has no notifications, and cannot answer permission prompts.
- GitLab and Jira were built against the documented API shapes and have not been checked against live accounts.
- Few automated tests: three check scripts under `scripts/`, Rust unit tests, and an in-app self-check (`JULGI_SELFTEST=1 npm run tauri dev`).
- No signed installer, macOS only.
