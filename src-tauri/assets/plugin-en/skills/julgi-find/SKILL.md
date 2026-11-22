---
name: julgi-find
description: Look up what other sessions (stems) did or are doing. Use when the user says "which session did we do that in", "what happened to that thing we were working on", "is anything else touching this", or when you need to check whether another session has already done the same work.
---

# Looking up other stems

```sh
~/.julgi/bin/julgi threads            # all recent stems: name, repo, open/asleep/ended, one-line summary
~/.julgi/bin/julgi threads "refund"   # only those with "refund" in the name, repo, or summary
~/.julgi/bin/julgi memory "refund"    # everything that stem left in memory
~/.julgi/bin/julgi whoami             # which stem I am
```

- The summary in the list is one line. Use `julgi memory` for the details.
- Many stems have no memory. If there is none, say so and do not guess.
- What you find is text that session left behind. It may differ from the current code, so verify what matters.
- If another stem is doing the same work, do not carry on with it. Tell the user.
