---
name: julgi-brain
description: Search the brain for things learned during earlier work (why something was decided, pitfalls, business rules), save what you newly learn, and correct notes that are wrong. Use when starting work in unfamiliar code or an area you have not touched before, when you wonder "why is it done this way" or "how did we decide this before", when you find out a fact the code alone cannot tell you, or when something you read in the brain differs from the current code.
---

# The brain: what remains after the work ends

The brain holds notes on things you cannot learn from reading the code. One thing per note: a **decision** (what was decided and why), a **pitfall** (something you only know after hitting it), or a **fact** (a business rule, history, who knows about it).

```sh
~/.julgi/bin/julgi brain "refund coupon"      # find notes containing the text (with several words, any one match is enough)
~/.julgi/bin/julgi brain                      # everything (titles only)
~/.julgi/bin/julgi learn pitfall "one-line title" "body of two or three sentences"   # kind: decision, pitfall, or fact
~/.julgi/bin/julgi fix <note id> "corrected body"
~/.julgi/bin/julgi forget <note id> "why it is wrong"
```

## When to do what

- **Starting work**: search once with the words of that area. Treat the notes you get as reference only. If they differ from the current code, the code is right.
- **Finding something out**: if the next person who does not know this would get lost in the same place, save it with `learn`. Do not save progress, next steps, or what is written plainly in the code (that is what `julgi note` is for). Spell out the name of the thing in the title, so the title alone says what the note is about.
- **A note is wrong**: fix it while you are there. If the content has changed, use `fix`; if it no longer holds at all, use `forget`. Do not just pass it by.

Julgi counts what is looked up and what is saved. Notes used often come up first, and notes unused for a long time drop back.
