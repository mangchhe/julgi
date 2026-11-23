# Julgi 참고 문서

[README](readme/README.ko.md)에 다 싣기에는 긴 것들이다: 세션에 주는 권한, 붙여 쓰는 자리, 설정, 파일, 아직 안 된 것.

[English](reference.md) · 한국어

## Julgi가 세션에 주는 권한

오픈소스로 쓰기 전에 알아 둘 것들이다. 전부 설정으로 끄거나 좁힐 수 있다.

- **간단한 허락은 대신 답하게 할 수 있다**(`autoAllow`, 기본은 꺼짐). `look`은 아무것도 바꾸지 않는 명령(git status/diff/log, ls, gh와 glab의 보기)을, `check`는 거기에 시험과 빌드를 더한다. 시험과 빌드는 프로젝트의 스크립트를 돌린다. 세션을 띄울 때 Claude Code의 허락 규칙으로 넘긴다. 파일 내용을 읽는 명령(cat, grep)은 들어 있지 않다. 원하면 `allowRules`에 적는다.
- **`julgi` 명령은 묻지 않고 실행된다.** Julgi의 스킬이 전부 이 명령 하나를 부르기 때문이다.
- **`~/.julgi/grown`에 쓰는 것과 대화 기록(`~/.claude/projects`)·스킬 폴더를 읽는 것도 묻지 않는다.** 스킬을 만들고 다듬는 세션이 쓴다.
- **선호 노트가 세션의 시스템 프롬프트에 붙는다**(`--append-system-prompt-file`). `brain`을 끄면 붙지 않는다.
- **사용량 보기를 켜면 Claude Code의 로그인 토큰을 읽는다.** 키체인(맥 밖에서는 `~/.claude/.credentials.json`)에서 읽어 `api.anthropic.com/api/oauth/usage`에만 보내고, 어디에도 적지 않는다. 문서에 없는 주소라 어느 날 안 나올 수 있다. 기본은 꺼짐이다.
- **폰에서 보기를 켜면 포트 하나가 열린다**(기본 4747). Tailscale 망(100.64.0.0/10)과 이 맥에서 온 것만 받고, 주소에 든 토큰(`~/.julgi/remote-token`)이 맞아야 한다. 기본은 꺼짐이다.
- **지도에 든 레포는 세션이 묻지 않고 읽을 수 있다**(`--settings`의 `Read` 허락). 고치려면 평소처럼 허락을 묻는다.
- **"이 폴더를 믿느냐"는 물음을 대신 넘기는 폴더가 있다.** 기본 폴더, `autoTrust`에 적은 폴더, 그리고 `mapRoot`나 `repos`로 직접 정해 둔 레포들.
- **지도를 그릴 때 레포를 원격에서 받아 온다.** 고친 파일이 없고 기본 브랜치에 있는 레포만 앞으로 당긴다(`mapFetch`).
- **판단에 쓰는 모델 호출**은 `claude -p`로 나간다. 도구 없이 글만 주고받고 대화 기록을 남기지 않는다. 브리핑과 걸러 읽기에는 변경 내용(diff)이, 선호를 뽑을 때는 내가 한 말이 들어간다.

## 붙여 쓰는 자리

본체는 Claude Code와 git만 안다. 회사나 개인의 것은 설정으로 붙인다.

- `pluginDirs`: 팀이나 개인의 스킬 폴더를 세션에 같이 얹는다.
- `saveCommand`: `⌘S`로 지금 세션에 보낼 말.
- `worksCommand`: 세션을 "작업"으로 묶을 때 쓸 작업 목록을 JSON으로 내놓는 명령.
- `repoPatterns`: 폴더가 지워져 git으로 레포를 알 수 없을 때 경로에서 레포 이름을 뽑는 정규식.
- `stripEnv`: Julgi가 띄우는 셸에 넘기지 않을 환경 변수 앞머리.
- `models`: 판단마다 쓸 모델을 직접 정한다.

## 설정

`⌘,`에서 바꾸면 바로 적용되고 `~/.julgi/config.json`에 남는다. 화면에 없는 값은 파일을 직접 고친다.

| 값 | 기본 | 뜻 |
|---|---|---|
| `lang` | `auto` | 화면 글의 언어. `auto`는 시스템이 한국어면 한국어, 아니면 영어. `en`, `ko`. 다시 켜야 적용된다 |
| `theme` | `ink` | 화면 색. `navy`, `graphite`, `forest`, `plum`, `sand`, `tokyo-night`, `catppuccin`, `dracula`, `nord`, `paper` |
| `thinking` | `balanced` | 판단 모델의 수준. `light`(전부 Haiku), `balanced`, `deep` |
| `hotTokens` | 150000 | 이보다 큰 세션에 보낼 때는 갈아탄 뒤 보낸다 |
| `sleepHours` | 3 | 이 시간 넘게 쉰 세션을 재운다. 0이면 안 재운다 |
| `autoFill` | 켜짐 | 내 차례인 세션을 칸에 올리고 칸 수를 맞춘다 |
| `summarize` | 켜짐 | 세션을 요약하고 이름을 붙인다 |
| `judgeMerges` | 켜짐 | 같은 일이면 묻지 않고 줄기로 묶는다 |
| `brain` | 켜짐 | 브레인에 담고 꺼낸다 |
| `autoLead` | 켜짐 | 여러 레포에 걸친 큰 일은 조율자로 세운다 |
| `taskWorktree` | 켜짐 | 일감은 따로 딴 워크트리에서 한다 |
| `growSkills` | 켜짐 | 되풀이한 일을 스킬로 만들고, 자주 쓰는 스킬을 다듬는다. 각각 한 주에 하나까지 |
| `brief` | 켜짐 | 세션이 코드를 고치면 무엇을 왜 바꿨는지 요약한다 |
| `check` | 켜짐 | 브리핑 뒤에 더 큰 모델이 변경을 다시 읽고 틀린 곳을 짚는다 |
| `reviewHour`, `reviewDay` | 12, 1 | 점검을 도는 시각(0–23)과 매주 점검 요일(0이 일요일). 놓쳤으면 다음에 켰을 때 돈다 |
| `remote`, `remotePort` | 꺼짐, 4747 | 폰에서 보기 |
| `usage` | 꺼짐 | 아래 상태 줄에 Claude 구독 사용량(5시간 창, 주간)을 보여 준다 |
| `memoryLimitGb` | 8 | 세션들의 메모리 합계가 이만큼을 넘으면 쉬는 세션부터 재운다. 0이면 안 한다 |
| `skipPermissions` | `off` | 허락을 묻지 않고 띄운다. `mine`(내가 연 세션만), `all` |
| `triage` | 켜짐 | 끝난 답을 읽고, 내가 정하거나 답할 것이 있을 때만 내 차례로 올린다 |
| `longRunMin` | 30 | 한 번 시킨 일이 이만큼(분) 넘게 돌면 한 번 알린다. 0이면 끈다 |
| `morning`, `morningHours` | 켜짐, 6 | 이 시간 넘게 비웠다 돌아오면 브리핑을 띄운다 |
| `autoAllow`, `allowRules` | `off`, 없음 | 묻지 않고 넘길 명령: `look`(살펴보기), `check`(시험과 빌드까지), 그리고 직접 적은 앞머리나 규칙 |
| `notify` | 켜짐 | 창을 안 보고 있을 때 내 차례가 오면 알린다 |
| `mapRoot` | 없음 | 레포가 모여 있는 폴더. 그 아래의 git 레포가 지도에 들어간다 |
| `mapFetch` | 켜짐 | 지도를 그리기 전에 원격에서 받아 온다 |
| `defaultDir` | `~/julgi` | 레포가 드러나지 않는 일을 여는 폴더 |
| `hotkey` | `ctrl+super+KeyJ` | 어느 앱에서든 창을 꺼내고 넣는 키 |

## 연결 설정 (GitHub · GitLab · Jira)

`⌘,`의 "연결" 묶음에 있다.

| 값 | 기본 | 뜻 |
|---|---|---|
| `prWatch` | `mine` | 챙길 PR. `mine`(내가 연 PR 전부), `session`(세션이 올린 PR만), `off` |
| `prEveryMin`, `askEveryMin` | 2, 5 | PR과 리뷰 요청을 보는 주기(분) |
| `refreshOnFocus` | 켜짐 | Julgi 창으로 돌아오면 바로 다시 본다 |
| `prViewRefreshSec` | 30 | PR 화면을 열어 둔 동안 새로 읽는 주기(초). 0이면 끈다 |
| `wakeOnPr` | 꺼짐 | 잠든 세션의 PR에 일이 생기면 그 세션을 바로 깨운다 |
| `reviewAsks` | 켜짐 | 나한테 온 리뷰 요청을 `⌘J`에 넣고 알린다 |
| `jiraSite`, `jiraEmail`, `jiraKind` | 없음 | Jira 사이트 주소, 이메일, `cloud`/`server`. 토큰은 여기 없고 macOS 키체인에만 있다 |
| `jiraWatch`, `jiraEveryMin` | `mine`, 5 | 내게 배정된 티켓을 보는지와 주기(분) |
| `jiraStartTransition`, `jiraPrTransition`, `jiraMergeTransition` | `In Progress`, `In Review`, `Done` | 시작할 때, PR을 올리면, 머지되면 제안할 상태. 비우면 묻지 않는다 |
| `jiraRepos` | 없음 | 프로젝트 키 → 레포 (`ABC=acme-api, OPS=acme-infra`). 티켓으로 시작할 때 저절로 채운다 |
| `jiraQuiet` | 없음 | 조용히 받을 댓글 작성자(표시 이름이나 계정 ID, 쉼표로 구분). 알리지 않고 `⌘J`에도 안 올린다. 봇 계정은 늘 조용히 받는다 |

연결이 쓰는 것:

- **GitHub**: `gh`(GitHub CLI). 로그인과 토큰은 `gh`가 갖고 있다.
- **GitLab**: `glab`(GitLab CLI)의 `glab api`. 로그인과 토큰은 `glab`이 갖고 있다.
- **Jira**: REST API를 직접 부른다. API 토큰은 macOS 키체인(`julgi-jira`)에만 두고, 명령줄 인자에 실리지 않게 넘긴다.
- 셋 다 웹훅이 아니라 주기 조회다. Julgi는 받을 서버가 없다.

## 파일

전부 `~/.julgi/` 아래의 글 파일이다. 대화 자체는 여기에 없고 Claude Code가 `~/.claude/`에 갖고 있다.

| 파일 | 담긴 것 |
|---|---|
| `config.json`, `layout.json` | 설정, 칸과 열어 둔 세션 |
| `threads.json`, `threads/` | 줄기와 그 기억, 세션 요약 |
| `brain/`, `brain/history/`, `brain/retired/` | 브레인 노트, 고치기 전 것, 내린 것 |
| `prefs.md` | 선호 노트를 묶어 세션에 붙이는 글 |
| `changes.json` | 폴더마다의 변경, 브리핑, 걸러 읽은 결과, 답마다 찍어 둔 상태 |
| `MAP.md`, `map.json` | 레포 지도 |
| `tasks.json`, `tasks/` | 일감과 결과 |
| `reviews.json` | 점검 기록. 판마다 잰 값과 손댄 것 |
| `activity.jsonl`, `routes.jsonl`, `misroutes.jsonl` | 한 일, 보낸 곳, 틀려서 옮긴 사례 |
| `plugin/`, `grown/`, `bin/julgi` | Julgi의 스킬, Julgi가 만든 스킬, 세션이 쓰는 명령 |
| `skill-history/` | 다듬기 전의 스킬 글 |
| `pr-seen.json`, `jira-seen.json`, `jira-news.json` | PR과 티켓의 지난 형편. 견줘서 새로 생긴 일만 알린다. 아직 안 본 티켓 소식 |
| `triage.json` | 끝난 답마다 내가 필요했는지와 그 이유 |
| `progress.json` | 줄기마다 목표, 한 것, 남은 것, 막힌 것 |
| `seen.json` | 마지막으로 Julgi를 본 때. 브리핑이 쓴다 |
| `tickets.json` | 세션과 Jira 티켓의 연결 |
| `jira-files/` | 열어 본 티켓에 붙은 그림. 세션이 읽을 수 있게 둔다 |
| `remote-token` | 폰용 화면의 토큰. 지우면 새로 만든다 |
| `worktrees/` | 일감용 워크트리 |

## 아직 안 된 것

- 보낸 말은 되돌릴 수 없다.
- 조율은 읽기와 작은 고치기로만 돌려 봤다.
- 점검은 Julgi가 켜져 있을 때만 돈다. 꺼져 있었으면 다음에 켰을 때 돈다.
- 스킬을 만들고 다듬는 세션은 아직 실제로 끝까지 돈 적이 없다.
- 폰 화면은 보낼 곳을 알아서 고르지 않고, 알림이 없고, 허락을 묻는 세션은 풀지 못한다.
- GitLab과 Jira는 문서에 나온 API 모양에 맞춰 만들었고, 실제 계정으로는 아직 확인하지 못했다.
- 자동 테스트가 거의 없다. `scripts/` 아래 검사 스크립트 셋, Rust 단위 시험, 그리고 `JULGI_SELFTEST=1 npm run tauri dev`로 도는 앱 안 점검뿐이다.
- 서명된 설치 파일, macOS 밖의 지원이 없다.
