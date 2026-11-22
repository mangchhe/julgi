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
  "⏺ PR을 올렸습니다. https://github.com/example/api-server/pull/1852",
  "",
  "\x1b[1m>\x1b[0m ",
].join("\r\n");

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "ledger_scan": {
      const sessions = await fetch("/mock-ledger.json").then((r) => r.json());
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
      return JSON.stringify({ ...(flags.has("theme") ? { theme: flags.get("theme") } : {}), usage: flags.has("usage"), remote: flags.has("remote") });
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
      if (args.name === "changes.json" && flags.has("review")) {
        // 코드 검토 화면을 보려고 넣는 가짜 값: 첫 세션의 폴더에 브리핑과 답 두 판
        const first = (await fetch("/mock-ledger.json").then((r) => r.json()))[0];
        const now = Date.now();
        return JSON.stringify({
          [first.cwd]: {
            files: 2, adds: 14, dels: 2, sig: "s", briefSig: "s", by: first.id, at: now,
            turns: [
              { at: now - 40 * 60_000, from: "aaaaaaa1", to: "aaaaaaa2", session: first.id },
              { at: now - 3 * 60_000, from: "aaaaaaa2", to: "aaaaaaa3", session: first.id },
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
      if (args.name === "activity.jsonl" && flags.has("hist")) return `{"at": 1795184436364, "kind": "보냄", "text": "쿠폰 중복 환불 ← \\"환불 테스트도 돌려줘\\" (모델이 고름)", "sessionId": "x"}\n{"at": 1795184441364, "kind": "갈아탐", "text": "알림 스펙 정리 · 인계 글만 들고 새 세션으로, 이어서 보냄. 이전 세션은 재움", "sessionId": "x"}\n{"at": 1795261841364, "kind": "배움", "text": "\\"알림 스펙 정리\\"에서 브레인에 3개: 푸시는 10초 배치로 판정된다 / 하루 1회 제한은 상태 알림에만 적용된다 / 품절 임박 푸시는 찜한 고객만 받는다", "sessionId": "x"}\n{"at": 1795263641364, "kind": "지도", "text": "레포 5개의 지도를 그림 · 최신으로 당긴 것 2개(web-admin, shop-app) · 작업 중이라 그대로 둔 것: api-server(4커밋)"}\n{"at": 1795263741364, "kind": "지도", "text": "레포 5개의 지도를 그림 · 작업 중이라 그대로 둔 것: api-server(4커밋)"}\n{"at": 1795267241364, "kind": "점검", "text": "2판(매주): 손댄 것 13개, 눈에 띈 것 2개. ⌘G의 통계에서 본다"}\n{"at": 1795269041364, "kind": "확인 필요", "text": "\\"배포 상태 확인\\" 세션이 시작하지 못하고 있다", "sessionId": "x"}\n{"at": 1795270241364, "kind": "칸", "text": "칸을 하나 늘려 기다리던 \\"JDK 교체\\"을 올림", "sessionId": "x"}\n{"at": 1795270781364, "kind": "보냄", "text": "새 줄기 · api-server ← \\"쿠폰 기능 넣으려면 어디부터 봐야 해?\\" (이어 갈 줄기가 없어서)", "sessionId": "x"}`;
      if (args.name !== "threads.json" || !flags.has("threads")) return null;
      const sessions = await fetch("/mock-ledger.json").then((r) => r.json());
      const ids = sessions.slice(8, 12).map((x: { id: string }) => x.id);
      return JSON.stringify([
        { id: "t1", name: "주문 취소 환불 정책", sessions: ids.slice(0, 2), created: 0 },
        { id: "t2", name: "알림 스펙 정리", sessions: ids.slice(2, 3), created: 0 },
        ...(flags.has("stems") ? [{ id: "t3", name: "쿠폰 중복 환불", sessions: [sessions[2].id, sessions[1].id], created: 0 }, { id: "t4", name: "JDK 교체", sessions: [sessions[4].id], created: 0, done: true }] : []),
      ]);
    }
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
  if (flags.has("stems")) press("KeyG");
  if (flags.has("review")) press("KeyE");
  if (flags.has("hist")) press("KeyY");
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

export {};
