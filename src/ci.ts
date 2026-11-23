import { tr } from "./i18n.ts";

/** CI 실행 하나 (GitHub Actions의 run, GitLab의 pipeline). Rust ci_runs가 준다 */
export type CiRun = { repo: string; id: string; title: string; name: string; branch: string; state: CiState; started: string; at: string; url: string };
/** 실행 안의 job. stage: GitLab은 단계 이름, GitHub은 실패한 단계 이름 */
export type CiJob = { id: string; name: string; stage: string; state: CiState; started: string; finished: string };
export type CiState = "queued" | "run" | "ok" | "fail" | "cancel" | "skip";

export const ciLabel = (s: CiState) => ({ queued: tr`대기`, run: tr`도는 중`, ok: tr`통과`, fail: tr`실패`, cancel: tr`취소됨`, skip: tr`건너뜀` })[s];
/** 아직 안 끝났는가 */
export const ciLive = (s: CiState) => s === "queued" || s === "run";
/** 실행들의 줄 세우기: 도는 것 → 대기 → 나머지, 그 안에서는 최근 것부터 */
export const ciOrder = (a: CiRun, b: CiRun) => Number(ciLive(b.state)) - Number(ciLive(a.state)) || (b.at || b.started).localeCompare(a.at || a.started);
/** 걸린 시간을 "3분 12초"처럼. 안 끝났으면 지금까지 */
export function ciTook(started: string, finished: string, now = Date.now()): string {
  const from = Date.parse(started);
  if (!from) return "";
  const sec = Math.max(0, Math.round(((Date.parse(finished) || now) - from) / 1000));
  return sec < 60 ? tr`${sec}초` : tr`${Math.floor(sec / 60)}분 ${sec % 60}초`;
}
/** 지난번에 본 상태와 견줘 알릴 일: 돌던 것이 끝났으면 그 결과. 처음 보는 것과 이미 끝나 있던 것은 알리지 않는다 */
export const ciNews = (before: CiState | undefined, now: CiState): CiState | "" => (before && ciLive(before) && !ciLive(now) ? now : "");
