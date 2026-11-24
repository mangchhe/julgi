// 개발용: Tauri 없이 브라우저에서 화면만 띄워 볼 때 쓰는 가짜 뒷단.
// http://localhost:1420/?open&palette 처럼 열면 그 상태의 화면이 나온다.
type Callback = (payload: unknown) => void;

const callbacks = new Map<number, Callback>();
let nextCallback = 1;
const flags = new URLSearchParams(location.search);

const SCREEN = [
  "\x1b[2m$ claude --resume 7f3c…\x1b[0m",
  "",
  "\x1b[1m>\x1b[0m 쿠폰 두 개 겹칠 때 재현해봐",
  "",
  "⏺ RefundCalculator.kt:88 에서 쿠폰별로 따로 반올림합니다.",
  "  \x1b[2m테스트 추가: RefundCalculatorTest.kt\x1b[0m",
  "",
  "⏺ PR을 올렸습니다. https://github.com/example/acme-api/pull/1852 · ABC-123",
  "  기록: \x1b]8;;https://example.com/notes/refund\x1b\\환불 반올림 메모\x1b]8;;\x1b\\",
  "",
  "\x1b[1m>\x1b[0m ",
].join("\r\n");

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "ledger_scan": {
      const sessions = await fetch("/mock-ledger.json").then((r) => r.json());
      // big 깃발: 세션을 600개쯤으로 불린다. 세션이 많을 때 화면이 얼마나 무거운지 잴 때 쓴다 (앞의 것들은 그대로 두어 열린 세션과 맞는다)
      if (flags.has("big")) {
        const more = [];
        for (let n = 1; n < 38; n++) for (const x of sessions) more.push({ ...x, id: x.id.replace(/^.{8}/, String(n).padStart(8, "9")), title: `${x.title} ${n}`, mtime: x.mtime - n * 3600, branch: n % 3 ? x.branch : `feature/ABC-${100 + n}-work` });
        return { sessions: [...sessions, ...more], works: [] };
      }
      return { sessions, works: [] };
    }
    case "repo_state":
      return flags.has("review") ? { branch: "feature/refund-rounding", default: "develop", dirty: 2, ahead: 2, behind: 0, branches: [], worktrees: [], forge: "", lines: [], tags: [], fork: "3333333a" }
        : flags.has("threads")
          ? {
              branch: "develop", default: "develop", dirty: 0, ahead: 0, behind: 0, branches: [], worktrees: [], forge: "",
              lines: [
                { name: "stage", kind: "배포", wait: 4, own: 0, when: "2일 전" },
                { name: "release", kind: "배포", wait: 31, own: 2, when: "9일 전" },
                { name: "release/v2.21.0", kind: "릴리스", wait: 0, own: 0, when: "3시간 전" },
              ],
              tags: [
                { name: "v2.21.0-rc6", when: "어제", wait: 3, stable: false },
                { name: "v2.20.1", when: "2주 전", wait: 58, stable: true },
              ],
            }
          : null;
    case "remote_start":
      return "http://macbook.tail1a2b3c.ts.net:4747/?t=0123456789abcdef0123456789abcdef";
    case "term_load":
      return Object.fromEntries([1, 2, 3, 4, 5, 6].map((id) => [id, [260_000 + id * 61_000, id === 1 ? 14.2 : 0.1]]));
    case "claude_models":
      return [["claude-opus-5-5", "Claude Opus 5.5"], ["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5"]];
    case "claude_usage":
      return [
        { name: "5시간", used: 24, resets: Math.floor(Date.now() / 1000) + 8820 },
        { name: "주간", used: 64, resets: Math.floor(Date.now() / 1000) + 65_000 },
        { name: "주간 Fable", used: 99, resets: Math.floor(Date.now() / 1000) + 65_000 },
      ];
    case "last_reply":
      return "주문 다수 삭제 요청의 관련 테이블을 확인했습니다.\n\n- orders: 대상 132건\n- stock_count: 상품·옵션별 재고 카운터 41행이 같이 줄어야 합니다\n- 이력 테이블은 FK가 없어 그대로 둬도 됩니다\n\n삭제는 한 트랜잭션으로 묶었고, 실행 전에 같은 조건의 SELECT로 건수를 다시 확인하게 했습니다.\n\n이력 테이블의 행도 같이 지울까요, 아니면 감사용으로 남겨둘까요? 남기면 취소 사유 컬럼에 \"일괄 삭제\"를 적어 두겠습니다.";
    case "repo_commits":
      return flags.has("review")
        ? [
            ["4444444a", "3333333a 2222222b", "Merge branch 'fix/refund-rounding'", Math.floor(Date.now() / 1000) - 1800, "HEAD -> develop, origin/develop"],
            ["2222222b", "1111111b", "환불액이 음수면 예외를 던지게", Math.floor(Date.now() / 1000) - 7200, "fix/refund-rounding"],
            ["3333333a", "0000000a", "정산 배치 재시도 간격을 설정으로", Math.floor(Date.now() / 1000) - 9000, ""],
            ["1111111b", "0000000a", "환불 계산에서 쿠폰별 반올림을 따로 하게", Math.floor(Date.now() / 1000) - 10800, ""],
            ["0000000a", "", "결제 모듈 뼈대", Math.floor(Date.now() / 1000) - 86400 * 3, "tag: v1.4.0"],
          ]
        : [];
    case "repo_diff":
      return flags.has("review") ? 'diff --git a/src/refund/RefundCalculator.kt b/src/refund/RefundCalculator.kt\nindex 1a2b3c4..5d6e7f8 100644\n--- a/src/refund/RefundCalculator.kt\n+++ b/src/refund/RefundCalculator.kt\n@@ -84,9 +84,12 @@ class RefundCalculator(private val policy: RefundPolicy) {\n     fun refund(order: Order): Money {\n         val paid = order.paidAmount\n-        val discount = order.coupons.sumOf { it.amount }\n-        return (paid - discount).roundToWon()\n+        // 쿠폰마다 따로 반올림한 뒤 더한다. 한꺼번에 반올림하면 1원이 어긋난다\n+        val discount = order.coupons.sumOf { it.amount.roundToWon() }\n+        val refund = paid - discount\n+        require(refund >= Money.ZERO) { "환불액이 음수다: $refund" }\n+        return refund\n     }\n \n     private fun Money.roundToWon(): Money = Money(amount.setScale(0, RoundingMode.HALF_UP))\ndiff --git a/src/refund/RefundCalculatorTest.kt b/src/refund/RefundCalculatorTest.kt\nnew file mode 100644\nindex 0000000..9f8e7d6\n--- /dev/null\n+++ b/src/refund/RefundCalculatorTest.kt\n@@ -0,0 +1,9 @@\n+class RefundCalculatorTest {\n+    @Test\n+    fun `쿠폰 두 개가 겹쳐도 1원이 어긋나지 않는다`() {\n+        val order = orderWith(paid = 10_000, coupons = listOf(333.3, 333.3))\n+\n+        assertEquals(Money(9_334), RefundCalculator(policy).refund(order))\n+    }\n+}\n+' : null;
    case "config_load":
      return JSON.stringify({ ...(flags.has("lang") ? { lang: flags.get("lang") } : {}), ...(flags.has("theme") ? { theme: flags.get("theme") } : {}), usage: flags.has("usage"), remote: flags.has("remote"), ...(flags.has("jira") ? { jiraSite: "https://example.atlassian.net", jiraEmail: "me@example.com" } : {}) });
    case "layout_load": {
      if (!flags.has("open")) return null;
      const sessions = await fetch("/mock-ledger.json").then((r) => r.json());
      const open = sessions.slice(0, 5).map((s: { id: string; title: string; cwd: string }) => ({
        key: "c:" + s.id,
        label: s.title,
        cwd: s.cwd,
        sessionId: s.id,
      }));
      if (flags.has("many"))
        return JSON.stringify({ open, panes: [open[0].key, open[1].key, open[2].key, null, null, null], widths: [3, 3, 3, 1, 1, 1], focus: 1, fontSize: 13, sidebar: true });
      return JSON.stringify({ open, panes: [open[0].key, open[1].key, flags.has("two") ? null : open[2].key], focus: 0, fontSize: 13, sidebar: true });
    }
    case "term_states":
      return { 1: ["run", Date.now()], 2: ["wait", Date.now() - 60000], 4: ["ask", Date.now() - 5000] };
    case "pty_spawn": {
      const channel = args.onData as { id: number };
      callbacks.get(channel.id)?.({ index: 0, message: Array.from(new TextEncoder().encode(SCREEN)) });
      return null;
    }
    case "home_dir":
      return "/Users/me";
    case "default_dir":
      return "/Users/me/julgi";
    case "data_read": {
      // 브리핑 화면을 보려고 넣는 가짜 값: 줄기 둘, 그 진행 정리, 아홉 시간 전에 마지막으로 봄
      if (flags.has("morning")) {
        const ids = (await fetch("/mock-ledger.json").then((r) => r.json())).map((x: { id: string }) => x.id);
        const now = Date.now();
        if (args.name === "seen.json") return JSON.stringify({ at: now - 9 * 3600_000 });
        if (args.name === "threads.json") return JSON.stringify([{ id: "t1", name: "쿠폰 중복 환불 수정", sessions: [ids[5], ids[0]], created: now - 86400_000 }, { id: "t2", name: "주문 목록 지연 원인", sessions: [ids[2]], created: now - 2 * 86400_000 }]);
        if (args.name === "progress.json")
          return JSON.stringify({
            t1: { goal: "쿠폰이 여러 장일 때 환불액이 1원 어긋나는 것을 고친다", done: "쿠폰별 반올림으로 바꾸고 시험 3개를 더했다", left: "PR #1852의 CI 실패와 리뷰 의견 반영", blocked: "음수 환불을 예외로 둘지 0으로 막을지 결정이 필요하다", at: now - 3 * 60_000 },
            t2: { goal: "주문 목록이 느려진 원인을 찾는다", done: "인덱스를 타지 않는 쿼리 두 개를 찾았다", left: "인덱스를 더한 뒤 응답 시간을 다시 잰다", blocked: "", at: now - 3 * 3600_000 },
          });
      }
      if (args.name === "changes.json" && flags.has("review")) {
        // 코드 검토 화면을 보려고 넣는 가짜 값: 첫 세션의 폴더에 브리핑과 답 두 판
        const first = (await fetch("/mock-ledger.json").then((r) => r.json()))[0];
        const now = Date.now();
        return JSON.stringify({
          [first.cwd]: {
            files: 2, adds: 14, dels: 2, sig: "s", briefSig: "s", by: first.id, at: now,
            turns: [
              { at: now - 40 * 60_000, from: "aaaaaaa1", to: "aaaaaaa2", session: first.id, said: "쿠폰 여러 장일 때 환불액 1원 어긋나는 것 고쳐줘", files: 1 },
              { at: now - 3 * 60_000, from: "aaaaaaa2", to: "aaaaaaa3", session: first.id, said: "테스트도 추가해 줘", files: 2 },
            ],
            brief: {
              line: "쿠폰이 여러 장일 때 환불액이 1원 어긋나던 것을 쿠폰별 반올림으로 고치고, 환불액이 음수면 예외를 던지게 했다.",
              files: [],
              watch: [{ where: "src/refund/RefundCalculator.kt:89", why: "음수 환불액에서 예외를 던지도록 바뀌었다. 호출하는 쪽이 이 예외를 받는지 봐야 한다." }],
              unverified: "세션의 답에 시험을 돌렸다는 말이 없다.",
            },
          },
        });
      }
      // PR 형편을 지난번과 견주는 기록: 첫 PR은 그새 코멘트가 둘 늘고 CI가 깨진 것으로 보이게
      // Jira 감시 기록: ABC-123은 그새 코멘트가 하나 늘어난 것으로
      // 티켓과 세션을 이어 둔다: 작업 페이지에서 티켓마다 "지금 할 일"이 나오는 것을 본다
      if (args.name === "tickets.json" && flags.has("jira")) return JSON.stringify({ "00000000-0000-4000-8000-000000000000": "ABC-123", "00000006-0000-4000-8000-000000000000": "ABC-130", "00000001-0000-4000-8000-000000000000": "ABC-132", "00000002-0000-4000-8000-000000000000": "ABC-133" });
      if (args.name === "jira-news.json" && flags.has("jira")) return JSON.stringify({ news: { "ABC-123": "@나 · Kim", "ABC-130": "상태 → In Review" }, meta: { "ABC-123": { title: "주문 취소 시 쿠폰 복구", kind: "comment", count: 1, who: "Kim", mention: true }, "ABC-130": { title: "결제 실패 재시도 간격 조정", kind: "status", was: "In Progress" } } });
      if (args.name === "jira-seen.json" && flags.has("jira")) return JSON.stringify({ "ABC-123": { status: "In Progress", others: 1, assigned: true }, "ABC-130": { status: "To Do", others: 0, assigned: true }, "ABC-131": { status: "To Do", others: 0, assigned: true } });
      if (args.name === "pr-seen.json") return JSON.stringify({ "example/acme-api#1852": { state: "OPEN", ci: "SUCCESS", decision: "REVIEW_REQUIRED", others: 1 }, "example/acme-api#1700": { state: "OPEN", ci: "SUCCESS", decision: "APPROVED", others: -1 }, "example/acme-api#1830": { state: "OPEN", ci: "SUCCESS", decision: "REVIEW_REQUIRED", others: 0 } });
      if (args.name === "activity.jsonl" && (flags.has("hist") || flags.has("morning"))) return `{"at": 1795184436364, "kind": "보냄", "text": "쿠폰 중복 환불 ← \\"환불 테스트도 돌려줘\\" (모델이 고름)", "sessionId": "x"}\n{"at": 1795184441364, "kind": "갈아탐", "text": "알림 스펙 정리 · 인계 글만 들고 새 세션으로, 이어서 보냄. 이전 세션은 재움", "sessionId": "x"}\n{"at": 1795261841364, "kind": "배움", "text": "\\"알림 스펙 정리\\"에서 브레인에 3개: 푸시는 10초 배치로 판정된다 / 하루 1회 제한은 상태 알림에만 적용된다 / 품절 임박 푸시는 찜한 고객만 받는다", "sessionId": "x"}\n{"at": 1795263641364, "kind": "지도", "text": "레포 5개의 지도를 그림 · 최신으로 당긴 것 2개(acme-admin, acme-shop) · 작업 중이라 그대로 둔 것: acme-api(4커밋)"}\n{"at": 1795263741364, "kind": "지도", "text": "레포 5개의 지도를 그림 · 작업 중이라 그대로 둔 것: acme-api(4커밋)"}\n{"at": 1795267241364, "kind": "점검", "text": "2판(매주): 손댄 것 13개, 눈에 띈 것 2개. ⌘G의 통계에서 본다"}\n{"at": 1795269041364, "kind": "확인 필요", "text": "\\"배포 상태 확인\\" 세션이 시작하지 못하고 있다", "sessionId": "x"}\n{"at": 1795270241364, "kind": "칸", "text": "칸을 하나 늘려 기다리던 \\"JDK 교체\\"을 올림", "sessionId": "x"}\n{"at": 1795270781364, "kind": "보냄", "text": "새 줄기 · acme-api ← \\"쿠폰 기능 넣으려면 어디부터 봐야 해?\\" (이어 갈 줄기가 없어서)", "sessionId": "x"}`;
      // donestem 깃발: 열려 있던 셋째 세션의 줄기를 끝낸 것으로 한다. 켤 때 그 칸이 열리지 않는지 볼 때 쓴다
      if (args.name === "threads.json" && flags.has("donestem")) {
        const all = await fetch("/mock-ledger.json").then((r) => r.json());
        return JSON.stringify([{ id: "td", name: all[2].title, sessions: [all[2].id], created: Date.now() - 86400_000, done: true }]);
      }
      if (args.name !== "threads.json" || !flags.has("threads")) return null;
      const sessions = await fetch("/mock-ledger.json").then((r) => r.json());
      const ids = sessions.slice(8, 12).map((x: { id: string }) => x.id);
      return JSON.stringify([
        { id: "t1", name: "주문 취소 환불 정책", sessions: ids.slice(0, 2), created: 0 },
        { id: "t2", name: "알림 스펙 정리", sessions: ids.slice(2, 3), created: 0 },
        ...(flags.has("stems") ? [{ id: "t3", name: "쿠폰 중복 환불", sessions: [sessions[2].id, sessions[1].id], created: 0 }, { id: "t4", name: "JDK 교체", sessions: [sessions[4].id], created: 0, done: true }] : []),
      ]);
    }
    case "gh_status":
      return [true, "me"];
    case "glab_status":
      return [true, ""];
    case "repo_slug":
      return flags.has("lab") ? "gitlab:gitlab.com/acme/acme-api" : "example/acme-api";
    case "pr_view":
      return JSON.stringify({
        number: 1852, title: "쿠폰 여러 장일 때 환불액 1원 어긋남 수정", body: "## 무엇을\n쿠폰마다 따로 반올림한 뒤 더한다.\n\n## 확인\n- RefundCalculatorTest 추가", author: { login: "me" },
        state: "OPEN", isDraft: false, baseRefName: "develop", headRefName: "fix/refund-rounding", headRefOid: "5d6e7f8", mergeable: "MERGEABLE", url: "https://github.com/example/acme-api/pull/1852",
        reviewDecision: "CHANGES_REQUESTED", additions: 14, deletions: 2, changedFiles: 2, createdAt: new Date(Date.now() - 7200_000).toISOString(),
        statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" }],
        comments: [{ author: { login: "teammate" }, body: "배포 전에 스테이지에서 한 번 돌려 볼게요.", createdAt: new Date(Date.now() - 3600_000).toISOString() }],
        reviews: [{ author: { login: "reviewer" }, body: "음수 환불은 예외 말고 0으로 막는 게 맞지 않을까요?", submittedAt: new Date(Date.now() - 1800_000).toISOString(), state: "CHANGES_REQUESTED" }],
      });
    case "pr_list":
      return JSON.stringify([
        { number: 1852, title: "쿠폰 여러 장일 때 환불액 1원 어긋남 수정", author: { login: "me" }, headRefName: "fix/refund-rounding", isDraft: false, updatedAt: new Date().toISOString() },
        { number: 1849, title: "알림 묶음 발송 간격 설정", author: { login: "teammate" }, headRefName: "feat/noti-batch", isDraft: true, updatedAt: new Date().toISOString() },
        { number: 1840, title: "정산 배치 재시도 간격을 설정으로", author: { login: "teammate" }, headRefName: "fix/settle-retry", isDraft: false, updatedAt: new Date().toISOString() },
      ]);
    case "pr_mine":
      return JSON.stringify([{ number: 1852, title: "쿠폰 여러 장일 때 환불액 1원 어긋남 수정", repository: { nameWithOwner: "example/acme-api" }, author: { login: "me" }, updatedAt: new Date().toISOString(), url: "https://github.com/example/acme-api/pull/1852", isDraft: false }, { number: 1700, title: "주문 내보내기 CSV 열 순서 고정", repository: { nameWithOwner: "example/acme-api" }, author: { login: "me" }, updatedAt: new Date().toISOString(), url: "https://github.com/example/acme-api/pull/1700", isDraft: false }, { number: 31, title: "배송지 검증 규칙 정리", repository: { nameWithOwner: "gitlab:gitlab.example.com/shop/backend" }, author: { login: "me" }, updatedAt: new Date().toISOString(), url: "https://gitlab.example.com/shop/backend/-/merge_requests/31", isDraft: false }]);
    case "token_usage": {
      // 사용량 화면 확인용: 가짜 세션들에 날짜·모델별 토큰을 흩어 둔다
      const sessions = (await fetch("/mock-ledger.json").then((r) => r.json())) as { id: string; cwd: string }[];
      const today = Math.floor((Date.now() / 1000 - new Date().getTimezoneOffset() * 60) / 86400);
      const models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
      const out = [];
      for (let d = 0; d < Number(args.days); d++)
        for (const [i, s] of sessions.slice(0, 8).entries()) {
          if ((d + i) % 3 === 0) continue;
          const turns = 20 + ((d * 7 + i * 13) % 90);
          out.push({ session: s.id, cwd: s.cwd, day: today - d, model: models[i % 3], input: turns * 40, output: turns * 900, cache_read: turns * 52000, cache_write: turns * 1800, turns, last: Date.now() / 1000 - d * 86400 - i * 3600 });
        }
      return out;
    }
    // Jira 화면 확인용
    case "jira_me":
      return "Me";
    case "jira_statuses":
      // lang 깃발 없이 statusko를 주면 상태 이름이 한국어인 Jira를 흉내 낸다
      return flags.has("statusko")
        ? [{ name: "할 일", category: "new" }, { name: "진행 중", category: "indeterminate" }, { name: "리뷰 중", category: "indeterminate" }, { name: "완료", category: "done" }, { name: "반려", category: "done" }]
        : [{ name: "Done", category: "done" }, { name: "In Progress", category: "indeterminate" }, { name: "In Review", category: "indeterminate" }, { name: "To Do", category: "new" }];
    case "jira_projects":
      return ["ABC", "OPS"];
    case "jira_mine":
    case "jira_search": {
      const t = (key: string, title: string, status: string, cat: string, type: string, others = 0) => ({ key, url: `https://example.atlassian.net/browse/${key}`, title, status, statusCategory: cat, type, priority: "High", assignee: "Me", updated: new Date(Date.now() - 3600_000).toISOString(), others });
      return [{ ...t("ABC-123", "주문 취소 시 쿠폰 복구", "In Progress", "indeterminate", "Story", 2), by: [{ name: "Lee", id: "u2", app: false }, { name: "Kim", id: "u1", app: false, mention: true }] }, t("ABC-130", "결제 실패 재시도 간격 조정", "To Do", "new", "Bug"), t("ABC-131", "관리자 환불 내역 CSV", "To Do", "new", "Task"), t("ABC-132", "알림 종류와 발송 조건 정리", "In Progress", "indeterminate", "Task"), t("ABC-133", "주문 목록 응답 지연", "In Progress", "indeterminate", "Bug"), t("ABC-134", "쿠폰 만료일이 하루 일찍 표시됨", "To Do", "new", "Bug"), t("ABC-135", "CSV 내보내기에서 한글이 깨짐", "To Do", "new", "Bug"), t("ABC-136", "알림이 두 번 발송됨", "To Do", "new", "Bug"), t("ABC-137", "검색 결과 정렬이 뒤집힘", "To Do", "new", "Bug")];
    }
    case "ci_runs": {
      if (!flags.has("ci")) return [];
      const run = (id: string, title: string, name: string, branch: string, state: string, min: number) => ({ repo: args.repo, id, title, name, branch, state, started: new Date(Date.now() - (min + 4) * 60_000).toISOString(), at: new Date(Date.now() - min * 60_000).toISOString(), url: `https://github.com/${args.repo}/actions/runs/${id}` });
      return String(args.repo).endsWith("acme-api") ? [run("9001", "쿠폰 여러 장일 때 환불액 1원 어긋남 수정", "Deploy", "main", "run", 0), run("9000", "쿠폰 여러 장일 때 환불액 1원 어긋남 수정", "CI", "main", flags.has("cifail") && ciReads++ < 1 ? "run" : "fail", 6), run("8990", "정산 배치 재시도 간격을 설정으로", "Deploy", "main", "ok", 190)] : [];
    }
    case "ci_jobs": {
      // 읽는 데 걸리는 시간을 흉내 낸다. 기억해 둔 것은 이 기다림 없이 바로 뜬다
      await new Promise((r) => setTimeout(r, 900));
      if (flags.has("lab")) {
        const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
        const j = (id: string, name: string, stage: string, state: string, from: number, to: number) => ({ id, name, stage, state, started: from ? ago(from) : "", finished: to ? ago(to) : "" });
        return args.id === "9000"
          ? [j("1", "lint", "check", "ok", 600, 560), j("2", "typecheck", "check", "ok", 600, 540), j("3", "unit-test", "test", "fail", 540, 380), j("4", "integration-test", "test", "ok", 540, 330), j("5", "build-image", "build", "skip", 0, 0), j("6", "deploy-staging", "deploy", "skip", 0, 0), j("7", "deploy-production", "deploy", "skip", 0, 0)]
          : [j("1", "lint", "check", "ok", 400, 360), j("2", "typecheck", "check", "ok", 400, 350), j("3", "unit-test", "test", "ok", 350, 250), j("4", "integration-test", "test", "ok", 350, 200), j("5", "build-image", "build", "ok", 200, 140), j("6", "deploy-staging", "deploy", args.id === "9001" ? "run" : "ok", 140, args.id === "9001" ? 0 : 60), j("7", "deploy-production", "deploy", args.id === "9001" ? "queued" : "ok", args.id === "9001" ? 0 : 60, args.id === "9001" ? 0 : 20)];
      }
      return args.id === "9000"
        ? [{ id: "1", name: "lint", stage: "", state: "ok", started: new Date(Date.now() - 600_000).toISOString(), finished: new Date(Date.now() - 560_000).toISOString() }, { id: "2", name: "test", stage: "Run tests", state: "fail", started: new Date(Date.now() - 560_000).toISOString(), finished: new Date(Date.now() - 380_000).toISOString() }, { id: "3", name: "build", stage: "", state: "skip", started: "", finished: "" }]
        : [{ id: "1", name: "build", stage: "", state: "ok", started: new Date(Date.now() - 240_000).toISOString(), finished: new Date(Date.now() - 150_000).toISOString() }, { id: "2", name: "deploy-staging", stage: "", state: "run", started: new Date(Date.now() - 140_000).toISOString(), finished: "" }, { id: "3", name: "deploy-production", stage: "", state: "queued", started: "", finished: "" }];
    }
    case "ci_log":
      return "RefundCalculatorTest > 쿠폰 두 개가 겹쳐도 1원이 어긋나지 않는다 FAILED\n    org.opentest4j.AssertionFailedError: expected: <9334> but was: <9333>\n        at RefundCalculatorTest.kt:14\n\n42 tests completed, 1 failed\n\nFAILURE: Build failed with an exception.\n* What went wrong:\nExecution failed for task ':test'.\n##[error]Process completed with exit code 1.";
    case "argo_status":
      return flags.has("argo") ? { installed: true, contexts: [{ name: "argocd.example.com", server: "argocd.example.com", current: true }, { name: "argo-old", server: "argo-old.example.com", current: false }] } : { installed: false, contexts: [] };
    case "argo_apps": {
      // 둘째 서버는 로그인이 풀린 것으로 한다
      if (args.context === "argo-old") throw "LOGIN token is expired";
      const mk = (name: string, env: string, sync: string, health: string, image: string, min: number, over = {}) => ({ context: args.context, name, project: "default", sync, health, env, namespace: env, cluster: "in-cluster", repos: ["https://github.com/example/acme-gitops.git"], path: `apps/${name}`, target: "main", revision: "9f8e7d6c5b4a3210", images: [image], syncedAt: new Date(Date.now() - min * 60_000).toISOString(), phase: "Succeeded", message: "", ...over });
      return [
        mk("acme-api-staging", "staging", "Synced", "Healthy", "registry.example.com/acme/acme-api:1a2b3c4", 12),
        mk("acme-api-prod", "prod", "OutOfSync", "Degraded", "registry.example.com/acme/acme-api:0f9e8d7", 190, { phase: "Failed", message: "one or more objects failed to apply: Deployment acme-api: progress deadline exceeded" }),
        mk("unrelated-tool", "tools", "Synced", "Healthy", "registry.example.com/other/tool:3", 500),
      ];
    }
    case "argo_app":
      return {
        context: args.context, name: args.name, project: "default", sync: String(args.name).endsWith("prod") ? "OutOfSync" : "Synced", health: String(args.name).endsWith("prod") ? "Degraded" : "Healthy", env: String(args.name).endsWith("prod") ? "prod" : "staging", namespace: "acme", cluster: "in-cluster", repos: ["https://github.com/example/acme-gitops.git"], path: "apps/x", target: "main", revision: "9f8e7d6c5b4a3210",
        images: [String(args.name).endsWith("prod") ? "registry.example.com/acme/acme-api:0f9e8d7" : "registry.example.com/acme/acme-api:1a2b3c4"], syncedAt: new Date(Date.now() - 12 * 60_000).toISOString(), phase: String(args.name).endsWith("prod") ? "Failed" : "Succeeded", message: String(args.name).endsWith("prod") ? "one or more objects failed to apply: Deployment acme-api: progress deadline exceeded" : "",
        // 이미지 태그를 앱 파라미터로 넣는 구조: revision은 거의 그대로고 배포마다 태그가 다르다
        history: [["240105.1a2b3c4d", 12 * 60_000, "9f8e7d6c5b4a3210"], ["240105.1a2b3c4d", 3 * 3600_000, "9f8e7d6c5b4a3210"], ["240104.0f9e8d7c", 26 * 3600_000, "9f8e7d6c5b4a3210"], ["240103.7c6b5a49", 2 * 86400_000, "5a49382716051f2e"], ["240102.5a493827", 4 * 86400_000, "5a49382716051f2e"]].map(([tag, ago, revision], i) => ({
          id: 42 - i, revision, at: new Date(Date.now() - (ago as number)).toISOString(),
          sources: [{ repoURL: "https://github.com/example/acme-gitops.git", helm: { parameters: [{ name: "app.image.repository", value: "registry.example.com/acme/acme-api" }, { name: "app.image.tag", value: tag }] } }],
        })),
        resources: [{ kind: "Deployment", name: "acme-api", namespace: "acme", sync: "Synced", health: String(args.name).endsWith("prod") ? "Degraded" : "Healthy", message: String(args.name).endsWith("prod") ? "Deployment exceeded its progress deadline" : "" }, { kind: "Service", name: "acme-api", namespace: "acme", sync: "Synced", health: "Healthy", message: "" }, { kind: "ConfigMap", name: "acme-api-env", namespace: "acme", sync: String(args.name).endsWith("prod") ? "OutOfSync" : "Synced", health: "", message: "" }],
      };
    case "argo_trail": {
      // 태그 뒤쪽의 16진수 조각을 커밋으로 보고, 앞 배포와의 사이에 커밋이 몇 개인지 지어낸다
      const commits = (args.rows as string[][]).map((refs) => (refs[0] ? refs[0].padEnd(16, "0") : ""));
      return commits.map((c, i) => [c, c && commits[i + 1] && commits[i + 1] !== c ? 3 + i : c ? 0 : -1]);
    }
    case "argo_reach":
      return String(args.deployed).startsWith("1a2b") ? [true, "1a2b3c4d5e6f7081"] : String(args.deployed).startsWith("0f9e") ? [false, "0f9e8d7c6b5a4938"] : null;
    case "worktree_add":
      return `/Users/me/.julgi/worktrees/${args.name}`;
    case "jira_image":
      return { path: "/tmp/shot.png", data: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="300"><rect width="440" height="300" fill="#22384c"/><rect x="30" y="40" width="380" height="36" rx="6" fill="#3d5a75"/><rect x="30" y="100" width="240" height="18" rx="4" fill="#567b9c"/><rect x="30" y="134" width="300" height="18" rx="4" fill="#567b9c"/></svg>') };
    case "jira_view":
      return {
        images: [{ id: "10001", name: "screen.png" }, { id: "10002", name: "error.png" }],
        key: args.key, url: `https://example.atlassian.net/browse/${args.key}`, title: "주문 취소 시 쿠폰 복구", status: "In Progress", statusCategory: "indeterminate", type: "Story", priority: "High", assignee: "Me", reporter: "pm", sprint: "Sprint 42", parent: "",
        description: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "배경" }] }, { type: "paragraph", content: [{ type: "text", text: "주문을 취소하면 쓴 쿠폰이 " }, { type: "text", text: "사라진다", marks: [{ type: "strong" }] }, { type: "text", text: ". 고객 문의가 주 10건." }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "수용 조건" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "전체 취소 시 쿠폰을 되돌린다" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "부분 취소는 남은 금액 기준으로 판단" }] }] }] }] },
        subtasks: [{ key: "ABC-124", title: "쿠폰 복구 API", status: "Done", statusCategory: "done" }, { key: "ABC-125", title: "관리자 화면 표시", status: "To Do", statusCategory: "new" }],
        comments: [{ who: "qa", at: new Date(Date.now() - 86400_000).toISOString(), body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "부분 취소 후 재취소 케이스도 봐 주세요." }] }] } }],
        updated: new Date(Date.now() - 7200_000).toISOString(),
      };
    case "jira_transitions":
      return [{ id: "31", name: "Review", to: "In Review", category: "indeterminate" }, { id: "41", name: "Done", to: "Done", category: "done" }];
    case "pr_review_requests":
      return JSON.stringify([
        { number: 215, title: "결제 취소 API에 부분 취소 추가", repository: { nameWithOwner: "example/acme-api" }, author: { login: "teammate" }, updatedAt: new Date(Date.now() - 7200_000).toISOString(), url: "https://github.com/example/acme-api/pull/215", isDraft: false },
        { number: 88, title: "검색 필터에 기간 추가", repository: { nameWithOwner: "example/acme-admin" }, author: { login: "designer" }, updatedAt: new Date(Date.now() - 86400_000).toISOString(), url: "https://github.com/example/acme-admin/pull/88", isDraft: false },
      ]);
    case "pr_status":
      return args.number === 1852 ? { state: "OPEN", ci: "FAILURE", decision: "CHANGES_REQUESTED", others: 3 } : { state: "OPEN", ci: "SUCCESS", decision: "APPROVED", others: 0 };
    case "route_ask":
      // 보낼 곳을 묻는 글에만 답한다: 새 일이고 첫 레포의 일이라고 한다
      return String(args.prompt ?? "").startsWith("후보:") ? '{"pick": "new", "repo": "acme-api", "why": "후보 가운데 이어지는 일이 없다"}' : null;
    case "pr_diff":
      return (await invoke("repo_diff", {})) ?? "";
    case "pr_comments":
      return JSON.stringify([
        { id: 1, path: "src/refund/RefundCalculator.kt", line: 90, side: "RIGHT", user: { login: "reviewer" }, body: "여기서 예외를 던지면 호출하는 배치가 멈춰요.", created_at: new Date(Date.now() - 1700_000).toISOString() },
        { id: 2, path: "src/refund/RefundCalculator.kt", line: 90, side: "RIGHT", in_reply_to_id: 1, user: { login: "me" }, body: "배치 쪽에서 잡고 넘기게 할게요.", created_at: new Date(Date.now() - 1500_000).toISOString() },
        { id: 3, path: "src/refund/RefundCalculator.kt", line: null, side: "RIGHT", user: { login: "teammate" }, body: "이전 버전에 단 코멘트", created_at: new Date(Date.now() - 5000_000).toISOString() },
      ]);
    case "dirs_exist":
      return (args.paths as string[]).map(() => true);
    case "env_flag":
      return false;
    case "plugin:event|listen":
      return args.handler;
    default:
      return null;
  }
}

Object.assign(window, {
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(callback: Callback) {
      const id = nextCallback++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    invoke,
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
});

// 왼쪽 목록 너비를 정해 띄운다: ?side=200
if (flags.has("side")) localStorage.setItem("side-width", String(flags.get("side")));
else localStorage.removeItem("side-width");
const press = (code: string, key = "") => window.dispatchEvent(new KeyboardEvent("keydown", { code, key, metaKey: true }));
setTimeout(() => {
  if (flags.has("info")) press("KeyI");
  if (flags.has("zoom")) press("Enter", "Enter");
  if (flags.has("help")) press("Slash");
  if (flags.has("settings")) press("Comma");
  if (flags.has("morning")) window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB", key: "B", metaKey: true, shiftKey: true }));
  if (flags.has("stems")) press("KeyG");
  if (flags.has("review")) press("KeyE");
  if (flags.has("hist")) press("KeyY");
  if (flags.has("pr")) window.dispatchEvent(new CustomEvent("julgi:pr", { detail: { repo: "example/acme-api", number: 1852 } }));
  // 세션 상태가 한 번 읽힌 뒤에 눌러야 내 차례인 세션이 잡힌다
  // 설정의 묶음을 넘긴다: ?settings&sec=6
  for (let i = 0; i < Number(flags.get("sec") ?? 0); i++) setTimeout(() => document.querySelector(".settings")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })), 400 + i * 150);
  if (flags.has("queue")) setTimeout(() => press("KeyJ"), 2500);
  // 줄기 보기의 탭을 넘긴다: ?stems&tab=3 이면 숫자 탭
  const tabs = Number(flags.get("tab") ?? 0);
  for (let i = 0; i < tabs; i++) setTimeout(() => document.querySelector(".threads")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })), 300 + i * 200);
  if (flags.has("send")) {
    press("KeyL");
    setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".send textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, flags.get("send"));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 200);
  }
  if (flags.has("palette")) {
    press("KeyK");
    const query = flags.get("palette");
    if (query)
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(".pal input")!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, 200);
  }
}, 1200);

/** ci_runs를 몇 번 읽었나 (cifail 깃발) */
let ciReads = 0;
export {};
