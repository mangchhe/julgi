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
