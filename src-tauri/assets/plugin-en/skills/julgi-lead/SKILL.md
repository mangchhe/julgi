---
name: julgi-lead
description: Work as a coordinator - split work that spans several repos or several strands into tasks, hand them to other sessions, take the results, and decide what comes next. Use when the user says "coordinate this feature", "split this up and hand it out", "the server, the app and the admin all need changing", "run these in parallel", or when the work spans more than two repos and is hard to do in one session. Do not use for work that stays inside one repo, or for small work that touches two repos but one session can finish quickly by going back and forth, such as adding one field. If you started doing it yourself and the per-repo chunks have grown large, use it then.
---

# Working as a coordinator

A coordinator does not change code itself. It splits the work, hands it out, checks the results that come back, and decides what comes next. Julgi starts the working sessions, one per repo, and when one finishes **Julgi puts the result into this session as text.** There is no need to check on them while waiting.

```sh
~/.julgi/bin/julgi map                                    # which folder of which repo does what (including the groups by area)
~/.julgi/bin/julgi task add <repo name> "work to do"      # hand out a task. A session starts in that repo and does it
~/.julgi/bin/julgi task list                              # tasks I handed out: waiting / running / ended / failed
~/.julgi/bin/julgi task result <task id>                  # full result of a finished task
~/.julgi/bin/julgi task redo <task id> "what more to do"  # send follow-up work to the same session (when it fell short or got it wrong)
~/.julgi/bin/julgi task cancel <task id>                  # stop waiting
```

## Steps

1. **Read the map.** Use `julgi map` to find which pieces of which repos this work touches. Do not guess.
2. **Split into tasks.** Cut so that one task finishes inside one repo and does not have to wait for another task. Where there is an order (the contract must change before the server can), hand out only the earlier one, and hand out the later one after its result arrives.
3. **Write the ask properly.** The receiving session does not know this conversation. State what to do and why, where to change, what counts as done, and what must not be touched. If another task settled something (a renamed field, a response format), copy it in exactly.
4. **Hand out and stop.** After `julgi task add`, tell the user briefly what you handed out and end your reply. When a result arrives, Julgi puts in text that starts with `[Julgi 조율: 일감 …` (Julgi writes this line in Korean: "Julgi coordination: task …", followed by the task's status). Continue then. Do not wait by running `task list` over and over.
5. **Check the result.** Do not take the result text on trust. Read the changed files yourself (repos in the map are readable) to see that the work was done as asked and does not conflict with other tasks. If it falls short, send follow-up work to the same session with `task redo`.
6. **Decide what comes next.** Hand out the remaining tasks, or if everything is finished, tell the user what changed where and what you verified. Save that summary to stem memory with `julgi note`.

## Rules

- **Three at a time.** No more than three tasks run at once. Julgi queues the rest.
- **One per repo.** Two tasks running in the same repo at once would overwrite each other. Julgi runs them in turn.
- **Ask before anything hard to undo.** Do not hand out merges, pushes, deploys, or data changes as tasks. Ask the user first. Julgi also tells the working sessions not to do them.
- **Do not hide failures.** If a task failed or its result differs from what was asked, tell the user as it is.
