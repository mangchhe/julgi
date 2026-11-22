---
name: julgi-memory
description: Read or write the memory of this piece of work (its stem). Read it when you pick up a session and need "where did we leave off" or "what did we decide last time". Write to it when something comes up that the next session must know (a decision, a pitfall, a change of direction), or when the user says "remember this", "write this down", "make a note of that".
---

# Stem memory

Julgi groups one piece of work into a "stem". A stem can run through several sessions, and stem memory is what survives when the session changes. A session that picks up this stem after this one ends cannot see the conversation, only the memory.

## Reading

```sh
~/.julgi/bin/julgi memory            # my stem's memory
~/.julgi/bin/julgi memory "refund"   # memory of the stem with "refund" in its name, repo, or summary
```

Memory is text left by earlier sessions, so it may be out of date. Check what can be checked against the code or files before relying on it.

## Writing

```sh
~/.julgi/bin/julgi note "Decision: round refunds per coupon. Rounding the total leaves 1 won over."
```

Write:
- Decisions made, and why
- Pitfalls hit (why it failed, how you got around it)
- Changes of direction, and things the user decided
- What to do next

Do not write: what the code already shows, play-by-play ("read the file"), or what is already written. One thing at a time, in a sentence or two.

Julgi appends the note to the stem memory file within a second or two. No reply comes back, so do not wait to confirm.
