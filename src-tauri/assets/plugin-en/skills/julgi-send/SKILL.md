---
name: julgi-send
description: Hand work that does not belong to this session to another piece of work (stem) or to a new stem. Use when the user says "pass this to the other session", "run this separately", "the other repo needs changing too", or when work comes up that is outside this session's scope. Hand it over and do not wait.
---

# Handing work to another stem

Several sessions run inside Julgi. If this session takes on another repo's work or a different job as well, its context only grows. Hand that work to the stem it belongs to.

## Steps

1. Find where to send it.
   ```sh
   ~/.julgi/bin/julgi threads "app"      # search names, repos, summaries
   ```
2. Hand it over. The receiving session cannot see this conversation. Write the message so it can do the work from that text alone.
   ```sh
   ~/.julgi/bin/julgi send "app order screen" "The /orders response in the server repo now has a refundable field (branch feature/refund-flag). Update the app's parser to accept it. Treat it as false when missing."
   ```
3. If no stem fits, hand it to a new one. Julgi picks the repo to open it in from the text. Put the repo name in the text and it opens in that repo.
   ```sh
   ~/.julgi/bin/julgi send new "notifier repo: add order-cancelled wording to the notification templates. ..."
   ```

## What to put in the message

- What you want done (one sentence)
- Why it is needed and what changed on this side (branch, files, interface)
- What counts as done

## Good to know

- Once handed over, do not wait for a reply. The reply stays in that session and the user reads it there.
- A sent message cannot be taken back. Check the target with `julgi threads` first.
- Do not split work across several stems unless the user asked. Use this only when work falls outside this session's scope.
- It is recorded in Julgi's "What Julgi did" (⌘Y) as "Passed on by a session".
