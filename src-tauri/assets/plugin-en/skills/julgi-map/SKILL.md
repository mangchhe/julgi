---
name: julgi-map
description: Use when you need to look at code outside the current repo. For work you can only answer by reading another repo (how another server or app repo calls this API, where this value comes from, what the client-side implementation looks like), or when the user says "check the app repo", "look at the server side". Always use this before answering "I can't see that repo" or "I don't know where it is".
---

# Repo map

The map records where this person's repos are, what each one does, and how they connect.

```sh
~/.julgi/bin/julgi map            # the whole map: for each repo its path, what it does, what to look for there, and how repos relate
~/.julgi/bin/julgi map "app"      # only repos with the text in their name or description
```

For each repo the map gives its role (backend server, app, web UI, gateway, shared modules and contracts, deploy config, and so on), its connections (who calls whom and what depends on what), and **what else to check when changing it**.

- When you can only answer by reading another repo, find that repo in the map and go there.
- Before changing something used from outside (an API response, a message format, a contract file), read "what else to check when changing it", then actually read the relevant part of the repos listed there to see whether they are affected. Tell the user what you found.

Julgi writes the map's labels and headings in Korean whatever the interface language. The ones to recognize: `경로` path · `역할` role · `하는 일` what it does · `여기를 본다` what to look for here · `들어가는 곳` where to start · `이어진 곳` connections · `바꿀 때 같이 볼 곳` what else to check when changing it · `## 레포끼리의 관계` how the repos relate · `## 도메인` domains · `## 연결` links.

The "## 도메인" (domains) section groups pieces by area. When the user says "the admin side", "the seller side", "the customer app side", look there for which folder of which repo holds the pieces of that area (screens, server modules, contracts). One repo can contain several areas, so do not guess from the repo name alone.

## How to use it

1. Pick the repo to look at from the map. Its path is listed.
2. Read that path directly (Read, Grep, Glob). Repos in the map are open for reading from this session.
3. If the repo is not in the map, or the path does not match reality, then ask the user.

Only read other repos. If one needs changing, hand it to that repo's stem with `julgi send`.
