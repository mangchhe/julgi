import { tr } from "./i18n";

export type SessionInfo = {
  id: string;
  cwd: string;
  branch: string;
  title: string;
  recap: string;
  tokens: number;
  links: string[];
  mtime: number;
  size: number;
  /** 폴더가 속한 git 레포 이름. 폴더가 이미 없으면 비어 있다 */
  repo?: string;
};
export type Work = { key: string; title: string; repo: string; branches: string[] };
export type Ledger = { sessions: SessionInfo[]; works: Work[] };

/** 장부의 세션에 프로젝트 이름과 속한 작업을 붙인 것 */
/** auto: 같은 첫 글로 여러 번 돈 세션. 스크립트가 찍어 낸 것이라 목록과 보낼 곳에서 뺀다 */
/** said: 세션을 열 때 내가 처음 한 말. title은 Julgi가 요약에서 지은 이름으로 바뀔 수 있어서, 찾을 때는 이것도 본다 */
export type Session = SessionInfo & { repo: string; work?: Work; group: string; auto: boolean; said: string };

/** 같은 제목이 이만큼 되면 사람이 연 세션이 아니라고 본다 */
const AUTO_REPEATS = 4;

/** 줄기: 기능 하나의 긴 흐름. 갈아탈 때마다 세션이 뒤에 이어 달린다 */
/** 일 하나가 어디까지 왔는지: 목표, 한 것, 남은 것, 막힌 것. 열쇠는 줄기 id이고, 줄기가 아닌 세션은 세션 id다 */
export type Progress = { goal: string; done: string; left: string; blocked: string; at: number };
export type Thread = { id: string; name: string; sessions: string[]; created: number; /** 내가 직접 지은 이름. Julgi가 바꾸지 않는다 */ named?: boolean; /** 끝난 줄기. 목록에서 내려가고 ⌘K로는 계속 찾는다 */ done?: boolean };

/** 목록의 한 줄. 줄기면 가장 최근 세션이 대표로 나오고, 줄기가 아니면 세션 하나다 */
export type Item = { session: Session; name: string; thread?: Thread; memory: string };

export function buildItems(sessions: Session[], threads: Thread[], memories: Record<string, string>): Item[] {
  const owner = new Map<string, Thread>();
  for (const t of threads) for (const id of t.sessions) owner.set(id, t);
  const seen = new Set<string>();
  const items: Item[] = [];
  // sessions는 최근 순이라, 줄기마다 처음 만나는 세션이 가장 최근 것이다
  for (const session of sessions) {
    const thread = owner.get(session.id);
    if (!thread) {
      if (!session.auto) items.push({ session, name: session.title, memory: memories[session.id] ?? "" });
    } else if (!seen.has(thread.id)) {
      seen.add(thread.id);
      // 줄기 기억(인계 글, 세션이 적은 것) 뒤에 가장 최근 세션의 요약을 붙인다
      items.push({ session, name: thread.name, thread, memory: [memories[thread.id], memories[session.id]].filter(Boolean).join("\n\n") });
    }
  }
  return items;
}

/** 새 줄기를 열 수 있는 곳. 레포마다 가장 최근에 쓴 폴더 하나 */
export type Folder = { repo: string; cwd: string; text: string };

export function buildFolders(sessions: Session[]): Folder[] {
  const byRepo = new Map<string, Folder & { count: number }>();
  // sessions는 최근 순이라 레포마다 처음 만나는 폴더가 가장 최근에 쓴 곳이다
  for (const s of sessions) {
    const known = byRepo.get(s.repo);
    if (!known) byRepo.set(s.repo, { repo: s.repo, cwd: s.cwd, text: `${s.title} ${s.branch}`, count: 1 });
    else if (known.count++ < 20) known.text += ` ${s.title} ${s.branch}`;
  }
  return [...byRepo.values()].map(({ repo, cwd, text }) => ({ repo, cwd, text }));
}

/** 같은 일일지도 모르는 두 줄기와, 그렇게 볼 단서 */
export type Merge = { a: Item; b: Item; evidence: string };

/**
 * 합치기 후보를 고른다. 브랜치의 티켓 번호나 주고받은 PR·MR이 같다는 것은 "볼 만하다"는 단서일 뿐이고,
 * 같은 일인지는 여기서 정하지 않는다. 판정은 두 세션의 내용을 읽은 모델이 한다 (App의 판정 효과).
 */
export function mergeCandidates(items: Item[]): Merge[] {
  const cutoff = Date.now() / 1000 - 30 * 86400;
  const bySignal = new Map<string, Item[]>();
  for (const item of items) {
    if (item.thread?.done || item.session.mtime < cutoff) continue;
    const s = item.session;
    const signals = new Set<string>();
    const ticket = s.branch.match(/[A-Z][A-Z0-9]+-\d+/);
    if (ticket) signals.add(ticket[0]);
    for (const url of s.links) if (/\/(pull|merge_requests)\/\d+/.test(url)) signals.add(linkLabel(url));
    for (const signal of signals) bySignal.set(signal, [...(bySignal.get(signal) ?? []), item]);
  }
  const out: Merge[] = [];
  const seen = new Set<string>();
  for (const [evidence, list] of bySignal) {
    // 여럿이 같은 것을 가리키면 가장 최근 둘만 본다
    if (list.length < 2) continue;
    const [a, b] = list;
    const pair = mergeKey(a, b);
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({ a, b, evidence });
  }
  return out;
}
export const mergeKey = (a: Item, b: Item) => [a.session.id, b.session.id].sort().join("|");

/** 줄기가 무슨 일인지 알려 주는 글: 줄기·세션이 남긴 기억과 Claude Code가 남긴 요약 */
export const aboutOf = (item: Item) => [item.memory, item.session.recap].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/**
 * 판단하는 일들. 무게에 따라 모델을 달리 쓴다.
 * 자주 돌고 틀려도 다시 하면 되는 일은 작은 모델로, 드물게 돌고 틀리면 되돌리기 어렵거나 오래 남는 일은 큰 모델로.
 */
export type Task = "brief" | "check" | "map" | "route" | "note" | "judge" | "learn" | "tidy" | "cands" | "sweep" | "sweepAll";
const TIERS: Record<string, Record<Task, string>> = {
  light: { brief: "haiku", check: "sonnet", map: "sonnet", route: "haiku", note: "haiku", judge: "haiku", learn: "haiku", tidy: "haiku", cands: "haiku", sweep: "haiku", sweepAll: "sonnet" },
  // route: 보낸 말은 못 되돌린다. judge: 잘못 합치면 기억이 섞인다. learn·tidy: 브레인에 오래 남는다
  // sweep: 세션을 묶고 끝내고 치운다. 매주 것은 전부를 보므로 가장 큰 모델로
  balanced: { brief: "sonnet", check: "opus", map: "opus", route: "sonnet", note: "haiku", judge: "sonnet", learn: "sonnet", tidy: "opus", cands: "sonnet", sweep: "sonnet", sweepAll: "opus" },
  deep: { brief: "opus", check: "opus", map: "opus", route: "opus", note: "sonnet", judge: "opus", learn: "opus", tidy: "opus", cands: "opus", sweep: "opus", sweepAll: "opus" },
};
export const modelFor = (task: Task) => config.models[task] || (TIERS[config.thinking] ?? TIERS.balanced)[task];

/**
 * 일감: 조율하는 세션이 다른 세션에 맡긴 일 하나. Julgi가 세션을 띄우고, 끝난 것을 알아채고, 결과를 맡긴 쪽에 돌려준다.
 * lead: 맡긴 세션. session: 맡은 세션. redo: 다시 시킨 횟수
 */
/** work: 이 일감만을 위해 딴 워크트리 폴더. 없으면 레포의 작업 폴더에서 일한다 */
export type Job = { id: string; lead: string; repo: string; cwd: string; work?: string; ask: string; status: "대기" | "하는 중" | "끝남" | "실패" | "멈춤"; session?: string; result?: string; created: number; started?: number; finished?: number; redo: number }; // i18n-ok
/** 조율 하나가 동시에 돌리는 일감 수 */
export const MAX_PARALLEL = 3;

/**
 * 작업 폴더 하나에서 바뀐 것. 세는 것(files, adds, dels)은 git으로, 브리핑은 모델이 변경 내용을 읽고 쓴다.
 * sig: 변경이 달라졌는지 알아보는 표시. 같으면 브리핑을 다시 만들지 않는다
 */
/** found: 다른 모델이 검토자로 읽고 짚은 곳. level은 버그 | 위험 | 의문 */
export type Brief = { line: string; files: { path: string; what: string }[]; watch: { where: string; why: string }[]; unverified: string; found?: { where: string; level: string; what: string }[] };
/** untracked0: 이 폴더를 처음 봤을 때 git이 모르던 파일 수. 그보다 늘어난 만큼만 새 파일로 센다 */
/** by: 이 폴더에서 마지막으로 답을 끝낸 세션. 같은 폴더를 쓰는 세션이 여럿이어도 표시는 그 세션에만 붙인다 */
/** turns: 답마다 찍어 둔 상태. from은 그 답을 시작할 때, to는 끝냈을 때의 커밋. "이번 답에서 바뀐 것"만 보는 데 쓴다 */
export type Turn = { at: number; from: string; to: string; session: string };
export type Change = { files: number; adds: number; dels: number; sig: string; at: number; by?: string; turns?: Turn[]; untracked0?: number; brief?: Brief; briefSig?: string };

/** 스킬을 한 번 부른 기록과 깔려 있는 스킬 */
export type SkillUse = { skill: string; session: string; at: string };
/** linked: 다른 곳의 폴더를 링크로 건 것. 주인이 따로 있으니 Julgi가 고치지 않는다 */
export type SkillInfo = { name: string; source: string; description: string; modified: number; path: string; linked?: boolean };

/** 열려 있는 터미널 */
export type Open = { key: string; label: string; cwd: string; sessionId?: string };

export type TermState = { state: string; since: number };

/** git으로 레포를 알 수 없을 때(폴더가 지워졌거나 아직 장부에 없을 때) 경로만 보고 이름을 정한다 */
export function repoOf(cwd: string): string {
  for (const pattern of config.repoPatterns) {
    try {
      const hit = cwd.match(new RegExp(pattern));
      if (hit?.[1]) return hit[1];
    } catch {
      // 잘못 적은 정규식은 건너뛴다
    }
  }
  return cwd.split("/").filter(Boolean).pop() ?? "/";
}

export function enrich(ledger: Ledger): Session[] {
  const repeats = new Map<string, number>();
  for (const s of ledger.sessions) repeats.set(s.title, (repeats.get(s.title) ?? 0) + 1);
  return ledger.sessions.map((s) => {
    const repo = s.repo || repoOf(s.cwd);
    const branch = s.branch.toLowerCase();
    const work = s.branch
      ? ledger.works.find((w) => w.branches.includes(s.branch) || branch.includes(w.key.toLowerCase()))
      : undefined;
    // 제목 앞의 첨부 표시와 링크, 요약 끝의 안내 문구는 보여 줄 필요가 없다
    const title = s.title.replace(/\[Image #\d+\]\s*/g, "").replace(/https?:\/\/\S+\s*/g, "").trim() || s.title;
    const recap = s.recap.replace(/\s*\(disable recaps in \/config\)\s*$/, "");
    return { ...s, title, said: title, recap, branch: s.branch === "HEAD" ? "" : s.branch, repo, work, group: work ? `${work.key} ${work.title}`.trim() : repo, auto: (repeats.get(s.title) ?? 0) >= AUTO_REPEATS };
  });
}

export function ago(seconds: number): string {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 90) return tr("방금");
  if (diff < 3600) return tr`${Math.round(diff / 60)}분 전`;
  if (diff < 86400) return tr`${Math.round(diff / 3600)}시간 전`;
  return tr`${Math.round(diff / 86400)}일 전`;
}

export const kilo = (tokens: number) => (tokens ? `${Math.round(tokens / 1000)}k` : "");

// stuck: 일한다면서 화면이 멈춰 있다(내가 Esc로 끊었거나 걸렸다). 내가 봐야 하므로 기다리는 것으로 친다.
// told: 답을 끝냈지만 보고만 했다. 내가 할 일이 없어 내 차례로 올리지 않는다
export const waiting = (s?: TermState) => s?.state === "wait" || s?.state === "ask" || s?.state === "stuck";
/** 답을 끝내고 쉬는가. 재우거나 요약할 때는 보고만 한 것도 같이 본다 */
export const replied = (s?: TermState) => s?.state === "wait" || s?.state === "told";

/** Julgi가 재운 때. 그 뒤로 대화 기록이 또 바뀌면 다른 곳에서 쓰고 있다는 뜻이다 */
const sleptAt = new Map<string, number>();
export const markSlept = (sessionId: string) => void sleptAt.set(sessionId, Date.now() / 1000);
/** 이 시간(초) 안에 기록이 바뀐 잠든 세션은 다른 곳(다른 터미널이나 앱)에서 열려 있다고 본다 */
const ELSEWHERE_S = 150;
/** Julgi 밖에서 프로세스가 떠 있는 세션들 (세션 ID를 달고 뜬 것만 안다) */
let alive = new Set<string>();
export const setAlive = (ids: string[]) => void (alive = new Set(ids));
/**
 * Julgi 밖에서 열려 있는 세션인가. Julgi에 열려 있는 세션에는 쓰지 않는다.
 * 프로세스가 떠 있으면 확실하고, 아니면 Julgi가 띄우지 않았는데 방금까지 기록이 바뀐 것으로 짐작한다
 */
export const elsewhere = (s: Session) => alive.has(s.id) || (Date.now() / 1000 - s.mtime < ELSEWHERE_S && s.mtime > (sleptAt.get(s.id) ?? 0) + 5);
/** 프로세스가 떠 있는 것을 직접 본 것인가 */
export const aliveElsewhere = (s: Session) => alive.has(s.id);
export const STATE_LABEL: Record<string, string> = { run: tr("일하는 중"), wait: tr("답함 · 내 차례"), hold: tr("일감 기다리는 중"), idle: tr("일감 끝냄"), ask: tr("확인이 필요함"), dead: tr("끝남"), stuck: tr("멈춰 있음 · 확인 필요"), told: tr("보고함 · 할 일 없음") };

// Julgi가 띄운 Claude 세션만 상태를 적게 한다. 전역 설정은 건드리지 않고 실행할 때만 훅을 얹는다.
// 서브에이전트의 도구 호출도 부모 세션의 훅으로 온다(입력에 agent_id가 붙는다). 메인 답이 끝난 뒤 백그라운드 서브에이전트가
// "일하는 중"으로 덮어쓰면 끝날 때마다 "내 차례" 알림이 또 오고, 들어가 보면 일하는 중이라 나온다. 그래서 그건 세지 않는다
const hook = (state: string, mainOnly = false) => ({
  hooks: [{ type: "command", command: `${mainOnly ? `grep -q agent_id || ` : ""}printf ${state} > ~/.julgi/state/$JULGI_TERM` }],
});
// 지도의 레포와 일감 워크트리(~/.julgi/** 안)는 --add-dir로 붙이지 않고 읽기만 허락한다. --add-dir는 폴더마다 "Adding a new directory"를 묻는다.
// 규칙의 //는 절대 경로라는 뜻이다. 셸의 작은따옴표 안에 들어가니 '가 든 경로는 뺀다
// 묻지 않고 넘길 명령. 전부 무엇을 바꾸지 않는 것들이다. 파일 내용을 읽는 cat, grep 같은 것은 넣지 않았다:
// 그런 명령은 프로젝트 밖의 파일도 읽을 수 있어서, 필요하면 allowRules에 직접 적게 둔다
const LOOK = ["git status", "git diff", "git log", "git show", "git branch", "git blame", "git remote -v", "git stash list", "git rev-parse", "git ls-files", "ls", "pwd", "wc", "which", "tree", "file", "date", "gh pr view", "gh pr list", "gh pr diff", "gh pr checks", "gh pr status", "gh run list", "gh run view", "gh issue view", "gh issue list", "glab mr view", "glab mr list"];
// 시험과 빌드: 프로젝트 안의 스크립트를 돌린다. 그 스크립트가 하는 일까지 허락하는 셈이라 한 단계 위에 둔다
const CHECK = ["npm test", "npm run test", "npm run lint", "npm run build", "npm run typecheck", "npx tsc", "pnpm test", "pnpm run test", "pnpm lint", "pnpm build", "yarn test", "yarn lint", "yarn build", "cargo test", "cargo check", "cargo build", "cargo clippy", "cargo fmt --check", "go test", "go build", "go vet", "pytest", "python -m pytest", "python3 -m pytest", "ruff check", "./gradlew test", "./gradlew build", "./gradlew check", "make test", "make check", "make build"];
/** 설정에 따라 묻지 않고 넘길 규칙. 셸의 작은따옴표 안에 들어가니 '가 든 것은 뺀다 */
const autoAllow = () => {
  const level = config.autoAllow;
  const preset = level === "check" ? [...LOOK, ...CHECK] : level === "look" ? LOOK : [];
  const own = config.allowRules.split(/[,\n]/).map((r) => r.trim()).filter(Boolean);
  // 내가 적은 것은 "Bash(…)"처럼 규칙 모양이면 그대로, 아니면 명령의 앞머리로 본다
  return [...preset.map((cmd) => `Bash(${cmd}:*)`), ...own.map((r) => (/^[A-Za-z]+\(.*\)$/.test(r) ? r : `Bash(${r}:*)`))].filter((r) => !r.includes("'"));
};
const settings = () => JSON.stringify({
  hooks: {
    UserPromptSubmit: [hook("run")],
    PostToolUse: [hook("run", true)],
    Stop: [hook("wait")],
    Notification: [hook("ask")],
  },
  // Julgi의 스킬은 전부 이 명령 하나를 부른다. 부를 때마다 허락을 물으면 알아서 하는 것이 없어진다
  // 스킬을 만들고 다듬는 세션은 Julgi의 폴더 안에만 쓰고, 근거로 대화 기록을 읽는다. 그것도 묻지 않게 한다
  permissions: { allow: ["Bash(~/.julgi/bin/julgi:*)", "Edit(~/.julgi/grown/**)", "Read(~/.julgi/**)", "Read(~/.claude/projects/**)", "Read(~/.claude/skills/**)", ...mapDirs.filter((dir) => !dir.includes("'")).map((dir) => `Read(/${dir}/**)`), ...autoAllow()] },
});
/** 선호 노트가 있어 ~/.julgi/prefs.md 를 써 두었는가. 있으면 세션의 시스템 프롬프트에 덧붙인다 */
let prefs = false;
export const setPrefs = (on: boolean) => void (prefs = on);
/** 지도에 있는 레포 폴더들. 세션을 띄울 때 읽기를 허락한다 */
let mapDirs: string[] = [];
export const setMapDirs = (dirs: string[]) => void (mapDirs = dirs);
/** ~/.julgi/config.json으로 바꿀 수 있는 값 */
export const config = {
  /** 이 크기(토큰)를 넘으면 갈아탈 때라고 표시한다 */
  hotTokens: 150_000,
  /** 왼쪽 목록에 보이는 잠든 세션의 기간(일). 더 오래된 것은 ⌘K로 찾는다 */
  recentDays: 14,
  /** 레포가 드러나지 않는 일을 여는 폴더. 비우면 ~/julgi */
  defaultDir: "",
  /** 답까지 본 뒤 이 시간(시) 넘게 쉰 세션은 재운다. 0이면 안 재운다 */
  sleepHours: 3,
  /** 점검을 도는 시각(0–23시). 매일 이 시각에 돌고, 그때 꺼져 있었으면 다음에 켰을 때 돈다 */
  reviewHour: 12,
  /** 전부를 보는 매주 점검을 도는 요일. 0이 일요일, 1이 월요일 */
  reviewDay: 1,
  /** 내 답을 기다리는 세션을 빈 칸에 알아서 올린다 */
  autoFill: true,
  /** 이 폴더들(과 그 아래)에서는 Claude Code가 "이 폴더를 믿느냐"고 물으면 Julgi가 대신 "믿는다"를 누른다. 기본 폴더는 늘 포함된다 */
  autoTrust: [] as string[],
  /** 폴더가 지워져 git으로 레포를 알 수 없을 때 경로에서 레포 이름을 뽑는 정규식들. 첫 묶음이 이름이다 */
  repoPatterns: [] as string[],
  /** 세션을 "작업"으로 묶을 때 쓸 작업 목록을 JSON으로 내놓는 명령. 비우면 ~/.julgi/works.json을 읽는다 */
  worksCommand: "",
  /** 이 앞머리로 시작하는 환경 변수는 Julgi가 띄우는 셸에 넘기지 않는다. Julgi를 다른 도구의 터미널에서 띄울 때 쓴다 */
  stripEnv: [] as string[],
  /** Julgi의 스킬 말고 더 얹을 Claude Code 플러그인 폴더. 팀이나 개인의 스킬은 여기로 붙인다 */
  pluginDirs: [] as string[],
  /** 세션이 쉬거나 잠들 때 작은 모델로 요약을 남긴다. 보낼 곳 고르기와 합치기 판정이 이 요약을 읽는다 */
  summarize: true,
  /** 합칠 만한 줄기 짝을 작은 모델에게 읽혀, 같은 일이면 묻지 않고 합친다. 끄면 알아서 합치지 않는다 */
  judgeMerges: true,
  /** 브레인: 줄기 기억에서 오래 남길 것을 추려 담고, 새 일을 열 때 관련된 것을 꺼내 붙인다 */
  brain: true,
  /** 판단에 쓰는 모델의 수준. light: 전부 가장 작은 모델, balanced: 일의 무게에 맞춰, deep: 한 단계씩 더 큰 모델 */
  thinking: "balanced",
  /** 일마다 모델을 직접 정한다(thinking보다 먼저). 키: route, note, judge, learn, tidy, cands. 값: haiku, sonnet, opus 또는 모델 ID */
  models: {} as Record<string, string>,
  /** 지도를 그리기 전에 레포를 원격에서 받아 온다. 고친 파일이 없고 기본 브랜치에 있는 레포만 앞으로 당기고, 작업 중인 레포는 그대로 둔다 */
  mapFetch: true,
  /** 레포들이 모여 있는 폴더. 쉼표로 여럿 적는다. 그 바로 아래의 git 레포가 전부 지도에 들어간다. 비우면 일한 레포와 그 이웃을 Julgi가 고른다 */
  mapRoot: "",
  /** 지도에 넣고 세션이 읽을 수 있게 열어 줄 레포 폴더들. 비우면 최근에 일한 레포를 Julgi가 고른다 */
  repos: [] as string[],
  /** 창을 안 보고 있을 때 세션이 답을 끝내거나 확인을 물으면 macOS 알림을 띄운다 */
  notify: true,
  /** 세션이 답을 끝내면 마지막 답을 읽고, 내가 정하거나 답할 것이 있을 때만 내 차례로 올린다. 보고만 한 것은 조용히 둔다 */
  triage: true,
  /** 한 번 시킨 일이 이만큼(분) 넘게 돌고 있으면 알린다. 0이면 알리지 않는다 */
  longRunMin: 30,
  /** 오래 자리를 비웠다 돌아오면 브리핑을 띄운다 */
  morning: true,
  /** 몇 시간 넘게 안 봤으면 브리핑을 띄우나 */
  morningHours: 6,
  /** 어느 앱에서든 Julgi 창을 꺼내고 넣는 키. 비우면 쓰지 않는다. 바꾸면 Julgi를 다시 켜야 한다 */
  hotkey: "ctrl+super+KeyJ",
  /** 던진 일이 레포 여러 곳에 걸치면 새 세션을 조율자로 세운다: 직접 고치지 않고 일감으로 나눠 맡긴다 */
  autoLead: true,
  /** 일감을 맡은 세션은 레포의 작업 폴더가 아니라 따로 딴 워크트리(브랜치 julgi/<일감>)에서 일한다. 기본 브랜치가 더럽혀지지 않고 같은 레포의 일감이 나란히 돈다 */
  taskWorktree: true,
  /** 되풀이해서 시킨 일을 찾으면 Julgi가 세션을 띄워 스킬로 만든다. 한 주에 하나까지 */
  growSkills: true,
  /** 세션이 코드를 고치면 무엇을 왜 바꿨는지와 눈여겨볼 곳을 요약해 둔다 */
  brief: true,
  /** 브리핑 뒤에 더 큰 모델이 검토자로 변경을 다시 읽고, 틀렸거나 틀릴 수 있는 곳을 짚는다. 내가 읽을 곳을 줄이려는 것이다 */
  check: true,
  /** 폰에서 보기: Julgi가 Tailscale 망 안에서만 열리는 작은 웹 화면을 띄운다. 밖에서 내 차례인 세션에 답하고 새 일을 던진다 */
  remote: false,
  /** 폰용 화면의 포트 */
  remotePort: 4747,
  /** 세션이 파일을 고치거나 명령을 돌릴 때 허락을 묻지 않게 띄운다(--dangerously-skip-permissions). off: 묻는다, mine: 내가 연 세션만 안 묻는다, all: Julgi가 알아서 띄운 세션(일감, 스킬, 폰에서 던진 일)까지 전부 */
  skipPermissions: "off",
  /** 늘 허락하는 종류는 묻지 않고 넘긴다. off: 전부 묻는다, look: 살펴보기만 하는 명령(git status, ls, gh pr view…), check: 거기에 시험과 빌드까지 */
  autoAllow: "off",
  /** 더 묻지 않을 명령의 앞머리나 규칙을 쉼표로 (예: "docker ps, Bash(make lint:*)") */
  allowRules: "",
  /** 챙길 PR: mine 내가 연 PR 전부, session 세션이 올린 PR만, off 안 챙김 */
  prWatch: "mine",
  /** 나한테 온 리뷰 요청을 ⌘J에 넣고 알린다 */
  reviewAsks: true,
  /** PR을 몇 분마다 볼까 (세션 줄의 PR, 내 PR) */
  prEveryMin: 2,
  /** 리뷰 요청을 몇 분마다 볼까 */
  askEveryMin: 5,
  /** 다른 앱에 있다 Julgi 창으로 돌아오면 PR과 리뷰 요청을 바로 다시 본다 */
  refreshOnFocus: true,
  /** PR 화면을 열어 둔 동안 몇 초마다 새로 읽을까. 0이면 r을 누를 때만 */
  prViewRefreshSec: 30,
  /** 잠든 세션의 PR에 일이 생기면 그 세션을 바로 깨운다. 끄면 알리고 ⌘J에 올려 두기만 한다(고르면 깨운다) */
  wakeOnPr: false,
  /** Jira 사이트 주소(https://…), 이메일, cloud/server. 토큰은 키체인에만 있다. 사이트가 비면 Jira 기능이 꺼진다 */
  jiraSite: "",
  jiraEmail: "",
  jiraKind: "cloud",
  /** 챙길 티켓: mine 내게 배정된 것, off 안 챙김 */
  jiraWatch: "mine",
  jiraEveryMin: 5,
  /** 시작할 때 / PR을 올리면 / 머지되면 제안할 전환 이름. 비우면 묻지 않는다 */
  jiraStartTransition: "In Progress",
  jiraPrTransition: "In Review",
  jiraMergeTransition: "Done",
  /** 프로젝트 키 → 레포 (이 티켓으로 시작에서 고르면 저절로 채운다). "ABC=acme-api, OPS=acme-infra" */
  jiraRepos: "",
  /** 아래 상태 줄에 Claude 구독 사용량(5시간 창, 주간)을 보여 준다. Claude Code의 로그인 토큰을 읽어 Anthropic의 사용량 주소를 부른다 */
  usage: false,
  /** 세션들이 쓰는 메모리 합계가 이만큼(GB)을 넘으면, 답까지 보고 쉬는 세션을 오래 쉰 것부터 시간을 기다리지 않고 재운다. 0이면 안 한다 */
  memoryLimitGb: 8,
  /** 세션을 닫기 전에 한 번 묻는다 */
  confirmClose: true,
  /** 화면 색. 설정(⌘,)에서 고른다 */
  /** 화면 글의 언어. auto는 시스템이 한국어면 한국어, 아니면 영어. 바꾸면 다시 켜야 적용된다 */
  lang: "auto",
  theme: "ink",
  /** ⌘S를 누르면 지금 세션에 보내는 말. 비우면 아무 일도 없다 */
  saveCommand: "",
  /** 갈아탈 때 이전 세션에 보내는 부탁 */
  // i18n-off
  handoffPrompt:
    "이 세션을 새 세션으로 넘기려고 한다. 새 세션이 이 글만 보고 이어서 일할 수 있게 인계 글을 써줘. 도구는 쓰지 말고 글로만 답해. 포함할 것: 목표, 지금까지 알아낸 것, 내린 결정과 이유, 바뀐 파일과 브랜치, 관련 링크, 다음 할 일(순서대로).",
  // i18n-on
};
export const hot = (tokens: number) => tokens > config.hotTokens;

/** 링크를 짧게: 무엇인지와 번호만 */
export function linkLabel(url: string): string {
  const artifact = url.match(/claude\.ai\/artifact\/(\w{6})/);
  if (artifact) return tr`아티팩트 ${artifact[1]}`;
  const pr = url.match(/\/([^/]+)\/(?:-\/)?(pull|merge_requests|issues)\/(\d+)/);
  if (pr) return `${pr[1]} ${pr[2] === "pull" ? "PR" : pr[2] === "issues" ? tr("이슈") : "MR"} #${pr[3]}`;
  const ticket = url.match(/browse\/([A-Z][A-Z0-9]+-\d+)/);
  if (ticket) return ticket[1];
  return url.replace(/^https:\/\//, "");
}

/** Julgi가 알아서 띄운 세션들(일감, 스킬 만들기, 다른 세션이나 폰이 던진 일). 내가 연 것과 구분해 권한을 다르게 준다 */
const autoIds = new Set<string>();
export const markAuto = (id: string) => void autoIds.add(id);
export const isAuto = (id: string) => autoIds.has(id);
export const autoList = () => [...autoIds].slice(-600);
const skip = (id: string) => (config.skipPermissions === "all" || (config.skipPermissions === "mine" && !autoIds.has(id)) ? " --dangerously-skip-permissions" : "");

// JULGI_SESSION: 세션 안에서 julgi 명령이 자기가 누구인지 아는 데 쓴다. --plugin-dir: Julgi의 스킬을 이 세션에만 얹는다
const launch = (id: string, how: string) =>
  `JULGI_SESSION=${id} claude ${how} ${id}${skip(id)} --settings '${settings()}'${prefs ? " --append-system-prompt-file ~/.julgi/prefs.md" : ""} --plugin-dir ~/.julgi/plugin --plugin-dir ~/.julgi/grown${config.pluginDirs.map((dir) => ` --plugin-dir "${dir.replace(/^~(?=\/|$)/, "$HOME").replace(/["`\\]/g, "")}"`).join("")}`;
export const resumeCommand = (id: string) => launch(id, "--resume");
/** 파일에 적어 둔 글을 첫 입력으로 넣는다 */
export const withPrompt = (command: string, path: string) => `${command} "$(cat '${path}')"`;
export const newCommand = (id: string) => launch(id, "--session-id");
/** 인계 글 파일을 첫 입력으로 넣고 시작한다 */
export const handoffCommand = (id: string, path: string) => withPrompt(newCommand(id), path);
