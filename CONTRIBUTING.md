# 기여하기

## 띄워 보기

```sh
npm install
npm run tauri dev
npx tsc --noEmit        # 타입 검사
```

Tauri 없이 화면만 볼 때는 `npm run dev`로 띄우고 `http://localhost:1420/?open&two&threads`처럼 연다. 가짜 뒷단(`src/mock.ts`)이 붙는다.

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

모델이나 세션에 보내는 프롬프트, 저장하거나 견주는 값은 번역하지 않는다. 그런 줄에는 `// i18n-ok`를 달거나 `// i18n-off` … `// i18n-on`으로 감싼다. 영어로 띄워 보려면 `?open&lang=en`.
