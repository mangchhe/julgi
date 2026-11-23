# Contributing

English · [한국어](docs/CONTRIBUTING.ko.md)

## Running it

```sh
npm install
npm run tauri dev
npx tsc --noEmit        # type check
```

To look at screens without Tauri, run `npm run dev` and open something like `http://localhost:1420/?open&two&threads`. A mock backend (`src/mock.ts`) is attached. Add `&lang=en` or `&lang=ko` to pick the language.

Checks to run before a commit:

```sh
npx tsc --noEmit
node scripts/check-i18n.mjs
node scripts/check-pr.mjs && node scripts/check-jira.mjs && node scripts/check-md.mjs
(cd src-tauri && cargo test)
```

## Measuring where messages go

Sending a message to the right session (`⌘L`) is the part that has to be right. Two things measure it:

```sh
node scripts/eval-route.mjs --only fixtures   # made-up cases in scripts/route-cases.json
node scripts/eval-route.mjs                   # plus your own history in ~/.julgi
node scripts/eval-route.mjs --model haiku     # with another model
```

- Every send is logged to `~/.julgi/routes.jsonl` with who decided (you, the model, a text match) and, when the model was asked, the exact prompt and its answer. Moving a message to another stem afterwards (`⌘⇧L`) is logged to `misroutes.jsonl` as the correct answer.
- The script asks the model the same questions again and compares with those answers. It prints accuracy, splits the mistakes into "joined a new job to old work", "opened a new stem for a follow-up" and "sent to another stem", and compares with the last run for the same model. Results are kept in `~/.julgi/eval/`.
- It calls the model once per case, so it uses your Claude usage.

The same goes for deciding whether a finished reply needs you: `node scripts/eval-triage.mjs` runs the cases in `scripts/triage-cases.json` against the prompt in `src/triageAsk.ts`. A miss (you were needed but not called) is worse than a false call, so it counts them separately and fails on any miss.

Change the prompt in `src/routeAsk.ts`, run it before and after, and add a case to `route-cases.json` for every mistake you see in real use.

## Commit messages

Write commit messages in English with a [Conventional Commits](https://www.conventionalcommits.org/) prefix.

```
<type>: <summary in imperative mood, lower case, no period>

- optional bullet points for what changed and why
```

| Prefix | When |
|---|---|
| `feat` | A new feature or a change in behavior the user can see |
| `fix` | A bug fix |
| `refactor` | Code changes that leave behavior as it was |
| `docs` | Documentation only, such as the README |
| `chore` | Build, dependencies, configuration |
| `test` | Tests only |

One commit does one thing. Keep the subject under 72 characters.

## Interface text and translation

Text shown on screen is written in Korean in the code and wrapped in ``tr`…` `` (`src/i18n.ts`). The English goes in `src/i18n/en/<file name>.ts`, keyed by the Korean text. Interpolated values are written `{0}`, `{1}` in the key.

```ts
tr`세션 ${n}개`            // key: "세션 {0}개"
// src/i18n/en/Threads.ts
"세션 {0}개": "{0} sessions",
```

```sh
node scripts/check-i18n.mjs     # finds missing translations and unwrapped Korean text
```

Do not translate prompts sent to a model or a session, or values that are stored or compared. Mark those lines with `// i18n-ok`, or wrap a block in `// i18n-off` … `// i18n-on`.

Code comments are in Korean. You are welcome to write new ones in English.
