---
name: julgi-wrap
description: Wrap up the session. Use when the work is finished and the user says "this is done", "let's wrap this up", "close it out", or when the session has grown too long and the user says "let's move to a new session", "hand off", "start fresh".
---

# Wrapping up a session

## When the work is finished

1. Leave the outcome in memory so anyone who looks later can follow it.
   ```sh
   ~/.julgi/bin/julgi note "Done: refund rounding fix merged (PR #1852). Nothing left."
   ```
2. Mark the stem as done. It drops off the list and stays findable by search.
   ```sh
   ~/.julgi/bin/julgi done
   ```

Check before finishing: if there are uncommitted changes, unpushed branches, or a question from the user left unanswered, do not finish. Tell the user first.

## When the session has grown too long

```sh
~/.julgi/bin/julgi handoff
```

When this reply ends, Julgi asks for a handoff note and opens a new session on the same stem carrying only that note. There is no need to write the handoff note in advance. Write it when asked.

Do not do this in the middle of work. Finish the step you are on first.

## If you used a skill Julgi made

If you followed a skill under `~/.julgi/grown/skills/` in this session and its order was wrong, a step was missing, or the user corrected something, fix that `SKILL.md` before wrapping up, so the next run does not get stuck in the same place. After fixing, add one line at the very bottom under "Revision log" with the date and what you changed and why (create that heading if it is missing; if the file already has a "고친 기록" heading, add to that one instead). If the skill worked well, leave it alone.
