import { tr } from "./i18n.ts";

/** Argo CD 앱 하나 (Rust argo_apps가 준다). repo: Julgi가 이은 레포 이름, cwd: 그 레포의 폴더, how: 어떻게 이었는가 */
export type ArgoApp = {
  context: string;
  name: string;
  project: string;
  sync: string;
  health: string;
  env: string;
  namespace: string;
  cluster: string;
  repos: string[];
  path: string;
  target: string;
  revision: string;
  images: string[];
  /** 앱에 붙은 라벨. 환경 이름을 어느 라벨에서 읽을지 설정으로 바꿀 때 쓴다 */
  labels?: Record<string, string>;
  syncedAt: string;
  phase: string;
  message: string;
  repo?: string;
  cwd?: string;
  how?: "source" | "image" | "rule";
};
/** 앱 하나의 상세: 배포 이력(최근 것부터)과 리소스별 상태 */
export type ArgoDetail = ArgoApp & {
  history: { id: number; revision: string; at: string }[];
  resources: { kind: string; name: string; namespace: string; sync: string; health: string; message: string }[];
};
/** 이을 레포 하나. slug: "소유자/레포" 또는 "gitlab:호스트/경로", name: 레포 이름 */
export type ArgoRepo = { slug: string; name: string; cwd: string };

export const argoId = (a: { context: string; name: string }) => `${a.context}/${a.name}`;

/** 원격 주소를 견줄 수 있는 모양으로: 앞머리(https://, git@)와 .git을 떼고 "호스트/경로"만 남긴다 */
export const repoPath = (url: string) =>
  url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:(?!\d+\/)/, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/** 이미지 글에서 이름(레지스트리 경로의 마지막 마디)과 태그를 나눈다. "reg.example.com:5000/a/api:1.2@sha256:…" → api, 1.2 */
export function imageParts(image: string): { name: string; tag: string } {
  const bare = image.split("@")[0];
  const last = bare.slice(bare.lastIndexOf("/") + 1);
  const at = last.indexOf(":");
  return at < 0 ? { name: last, tag: "" } : { name: last.slice(0, at), tag: last.slice(at + 1) };
}

/** 글로브(* ?)를 정규식으로. /…/로 감싸면 정규식 그대로 */
const pattern = (p: string) => (p.length > 2 && p.startsWith("/") && p.endsWith("/") ? new RegExp(p.slice(1, -1), "i") : new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i"));

/** 설정의 "레포=앱 이름 패턴, …"을 읽는다 */
export function parseRules(text: string): { repo: string; test: RegExp }[] {
  const out: { repo: string; test: RegExp }[] = [];
  for (const part of text.split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    try {
      out.push({ repo: part.slice(0, at).trim().toLowerCase(), test: pattern(part.slice(at + 1).trim()) });
    } catch {
      // 틀린 정규식은 건너뛴다
    }
  }
  return out;
}

/** 이미지 글의 경로 조각들(태그와 다이제스트는 뗀다). "reg.example.com:5000/team/api:1.2" → reg.example.com:5000, team, api */
export const imageSegments = (image: string) => {
  const bare = image.split("@")[0];
  const parts = bare.split("/");
  const last = parts.pop() ?? "";
  return [...parts, last.includes(":") ? last.slice(0, last.indexOf(":")) : last].map((p) => p.toLowerCase());
};
/** 이 이미지가 그 레포의 것인가: 이미지 경로의 조각 하나가 레포 이름과 같다. 곁에 붙는 남의 이미지(사이드카)는 여기서 걸러진다 */
const imageOf = (image: string, repo: string) => imageSegments(image).includes(repo.toLowerCase());

/**
 * 앱을 레포에 잇는다. 이름 규칙을 여기서 정하지 않는다. 차례로 본다:
 * 0. 사용자가 적어 둔 규칙(레포 → 앱 이름 패턴). 있으면 아래 기본 판정보다 먼저다
 * 1. 소스: 앱의 repoURL이 그 레포의 원격과 같다
 * 2. 이미지: 배포된 이미지의 경로 조각이 레포 이름과 같다 (설정 레포를 따로 두고 CI가 태그를 올리는 구조).
 *    이미지 하나가 앱 여러 개에 쓰여도 된다. 앱마다 따로 잇기 때문에 레포 하나에 앱이 여럿 이어진다
 * 어디에도 안 걸리면 잇지 않는다
 */
export function linkApp(app: ArgoApp, repos: ArgoRepo[], rules: { repo: string; test: RegExp }[]): ArgoApp | undefined {
  const rule = rules.find((x) => x.test.test(app.name) && repos.some((r) => r.name.toLowerCase() === x.repo));
  const byRule = rule && repos.find((r) => r.name.toLowerCase() === rule.repo);
  if (byRule) return { ...app, repo: byRule.name, cwd: byRule.cwd, how: "rule" };
  const bySource = repos.find((r) => {
    const mine = r.slug.replace(/^gitlab:/, "").toLowerCase();
    return app.repos.some((u) => {
      const theirs = repoPath(u);
      return theirs === mine || theirs.endsWith("/" + mine);
    });
  });
  if (bySource) return { ...app, repo: bySource.name, cwd: bySource.cwd, how: "source" };
  const byImage = repos.find((r) => app.images.some((img) => imageOf(img, r.name)));
  return byImage ? { ...app, repo: byImage.name, cwd: byImage.cwd, how: "image" } : undefined;
}

/**
 * 이 앱에 배포된 것을 이 레포의 무엇으로 볼 것인가. tag: 화면에 보여 줄 글, refs: git에게 "이게 커밋이냐"고 물어볼 후보들(앞의 것부터).
 * - 소스로 이은 앱: Argo가 맞춘 커밋(revision)이 곧 이 레포의 커밋이다
 * - 그 밖: 이 레포의 이미지(사이드카는 뺀다)의 태그. 태그 형식은 정해 두지 않는다. 태그 안의 7~40자리 16진수 조각을 모두 후보로 내고,
 *   실제 커밋인지는 git이 가린다("20260101" 같은 날짜도 16진수라 후보에 들지만 git이 걸러 낸다). 태그 그대로도 후보다(git 태그일 수 있다)
 * - custom: 사용자가 적은 정규식. 캡처 그룹 1이 커밋이다. 맞으면 그것만 쓴다
 */
export function deployedRef(app: ArgoApp, custom = ""): { tag: string; refs: string[] } {
  // 규칙으로 이은 앱도 소스가 이 레포면 맞춰진 커밋을 쓴다
  if (app.how === "source") return { tag: app.revision.slice(0, 8), refs: app.revision ? [app.revision] : [] };
  const mine = app.repo ? app.images.filter((img) => imageOf(img, app.repo!)) : [];
  const image = (mine.length ? mine : app.images.length === 1 ? app.images : []).map(imageParts)[0];
  if (!image?.tag) return { tag: "", refs: [] };
  if (custom) {
    try {
      const hit = image.tag.match(new RegExp(custom))?.[1];
      if (hit) return { tag: image.tag, refs: [hit] };
    } catch {
      // 틀린 정규식이면 기본 판정으로 간다
    }
  }
  const hex = [...image.tag.matchAll(/[0-9a-f]{7,40}/gi)].map((m) => m[0]);
  // 긴 조각이 커밋일 가능성이 크다. 길이순으로 물어본다
  return { tag: image.tag, refs: [...new Set([...hex.sort((x, y) => y.length - x.length), image.tag])] };
}

/** 환경 이름. 사용자가 라벨 키를 정해 두었고 앱에 그 라벨이 있으면 그 값이 먼저다. 없으면 Rust가 정한 기본값(env → environment → 네임스페이스 → 클러스터) */
export const withEnv = (app: ArgoApp, label: string): ArgoApp => (label && app.labels?.[label] ? { ...app, env: app.labels[label] } : app);

/** 화면에 한 줄로: 환경 이름과 상태. 좋으면 ✓, 맞추는 중이면 …, 어긋났거나 나쁘면 ! */
export const argoMark = (a: ArgoApp) => (a.health === "Degraded" || a.health === "Missing" ? "!" : a.health === "Progressing" || a.phase === "Running" ? "…" : a.sync === "OutOfSync" ? "≠" : a.health === "Healthy" ? "✓" : "?");
export const argoBad = (a: ArgoApp) => a.health === "Degraded" || a.health === "Missing" || a.phase === "Failed" || a.phase === "Error";
export const argoLineOf = (apps: ArgoApp[]) => apps.map((a) => `${a.env} ${argoMark(a)} ${a.health || a.sync}`).join(" · ");

/**
 * 지난번에 본 것과 견줘 알릴 일. 처음 보는 앱은 알리지 않는다.
 * - 나빠졌다(Degraded, Missing, sync 실패): 바로 알린다
 * - 어긋난 채(OutOfSync)로 정한 시간이 넘었다: 한 번 알린다
 * - 다시 좋아졌다: ""를 돌려줘 소식을 내린다
 * since: 어긋난 것을 처음 본 때(ms). 돌려주는 seen을 다음에 그대로 넘긴다
 */
export type ArgoSeen = { health: string; sync: string; since?: number; told?: boolean; bad?: boolean };
export function argoNews(before: ArgoSeen | undefined, now: ArgoApp, at: number, lagMin: number): { seen: ArgoSeen; news?: string } {
  const out = now.sync === "OutOfSync";
  const bad = argoBad(now);
  const since = out ? (before?.sync === "OutOfSync" ? (before.since ?? at) : at) : undefined;
  const seen: ArgoSeen = { health: now.health, sync: now.sync, since, bad, told: bad || out ? before?.told : false };
  if (!before) return { seen };
  if (bad) {
    // 좋다가 나빠졌을 때만 알린다. Julgi가 처음 봤을 때부터 나빴던 앱은 내가 방금 배포해서 생긴 일이 아니다
    if (before.bad && !before.told) return { seen };
    return { seen: { ...seen, told: true }, news: now.health === "Degraded" || now.health === "Missing" ? tr`배포 상태 ${now.health}` : tr`sync 실패` };
  }
  if (out && lagMin > 0 && since !== undefined && at - since > lagMin * 60_000) return { seen: { ...seen, told: true }, news: tr`${Math.round((at - since) / 60_000)}분째 OutOfSync` };
  return { seen: { ...seen, told: false }, news: "" };
}

/** 서버 주소에서 호스트(와 포트)만: 앞의 https://와 뒤의 경로를 뗀다. 이상한 글자가 있으면 빈 글 */
export const argoHost = (text: string) => {
  const host = text.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9.-]+(:\d+)?$/.test(host) ? host : "";
};
/**
 * 로그인 명령. 포트가 없으면 :443을 붙인다. 로드밸런서 뒤의 서버는 --grpc-web이 있어야 하고, --skip-test-tls가 없으면 로그인 창이 뜨기도 전에 시간이 다 돼 실패하기도 한다.
 * SSO면 브라우저가 뜨고, 아니면 argocd가 터미널에서 아이디와 비밀번호를 묻는다. 어느 쪽이든 Julgi는 토큰과 비밀번호를 보지 않는다
 */
export const argoLoginCommand = (server: string, sso: boolean, name = "") => {
  const host = argoHost(server);
  const label = (name && /^[A-Za-z0-9._:-]+$/.test(name) ? name : host).replace(/:\d+$/, "");
  return `argocd login ${/:\d+$/.test(host) ? host : host + ":443"} --grpc-web --skip-test-tls${sso ? " --sso" : ""} --name ${label}`;
};

// PR 화면처럼 App 밖에 있는 화면이 레포의 배포 한 줄을 읽을 수 있게 둔다 (jira.ts의 setKnownKeys와 같은 방식)
let linked: ArgoApp[] = [];
export const setArgoApps = (apps: ArgoApp[]) => void (linked = apps);
/** 그 레포(이름 또는 "소유자/레포")에 이어진 앱들의 한 줄. 없으면 빈 글 */
export const argoLineFor = (repo: string) => argoLineOf(linked.filter((a) => a.repo && (a.repo === repo || repo.endsWith("/" + a.repo))));
