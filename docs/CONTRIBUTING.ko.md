# 기여하기

[English](../CONTRIBUTING.md) · 한국어

## 띄워 보기

```sh
npm install
npm run tauri dev
npx tsc --noEmit        # 타입 검사
```

Tauri 없이 화면만 볼 때는 `npm run dev`로 띄우고 `http://localhost:1420/?open&two&threads`처럼 연다. 가짜 뒷단(`src/mock.ts`)이 붙는다. 언어는 `&lang=en`이나 `&lang=ko`로 고른다.

## 보낼 곳이 맞는지 재기

말을 맞는 세션에 보내는 것(`⌘L`)이 가장 틀리면 안 되는 부분이다. 두 가지로 잰다.

```sh
node scripts/eval-route.mjs --only fixtures   # scripts/route-cases.json의 지어낸 사례
node scripts/eval-route.mjs                   # 거기에 ~/.julgi에 쌓인 내 기록까지
node scripts/eval-route.mjs --model haiku     # 다른 모델로
```

- 보낼 때마다 `~/.julgi/routes.jsonl`에 누가 정했는지(나, 모델, 글자 맞춤)와, 모델에게 물었다면 물은 글과 답을 그대로 남긴다. 보낸 뒤 다른 줄기로 옮기면(`⌘⇧L`) `misroutes.jsonl`에 정답으로 남는다.
- 스크립트는 같은 물음을 모델에게 다시 던져 그 정답과 견준다. 정확도를 내고, 틀린 것을 "새 일을 하던 일에 보냄", "이어 할 일을 새로 엶", "다른 줄기에 보냄"으로 가르고, 같은 모델로 잰 지난 결과와 견준다. 결과는 `~/.julgi/eval/`에 남는다.
- 사례마다 모델을 한 번 부르므로 Claude 사용량이 든다.

지시문은 `src/routeAsk.ts`에 있다. 고치기 전과 뒤에 돌려 보고, 실제로 쓰다가 틀린 것을 볼 때마다 `route-cases.json`에 사례를 더한다.

## 커밋 메시지

커밋 메시지는 영어로, [Conventional Commits](https://www.conventionalcommits.org/) 머리말을 붙여 쓴다.

```
<type>: <summary in imperative mood, lower case, no period>

- optional bullet points for what changed and why
```

| 머리말 | 쓰는 때 |
|---|---|
| `feat` | 쓰는 사람에게 보이는 새 기능이나 동작 변화 |
| `fix` | 버그 고침 |
| `refactor` | 동작은 그대로 두고 코드만 고침 |
| `docs` | README 같은 문서만 |
| `chore` | 빌드, 의존성, 설정 |
| `test` | 시험만 |

한 커밋에는 한 가지 일만 담는다. 제목은 72자 안쪽으로 쓴다.

## 화면 글과 번역

화면에 보이는 글은 코드에 한국어로 쓰고 ``tr`…` ``로 감싼다(`src/i18n.ts`). 영어는 `src/i18n/en/<파일 이름>.ts`에 한국어 글을 열쇠로 적는다. 끼워 넣는 값의 자리는 `{0}`, `{1}`이다.

```sh
node scripts/check-i18n.mjs     # 빠진 번역과 감싸지 않은 한글을 찾는다
```

모델이나 세션에 보내는 프롬프트, 저장하거나 견주는 값은 번역하지 않는다. 그런 줄에는 `// i18n-ok`를 달거나 `// i18n-off` … `// i18n-on`으로 감싼다.
