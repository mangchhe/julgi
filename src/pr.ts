/** GitHub PR 하나를 가리키는 것: "소유자/레포"와 번호 */
export type PrTarget = { repo: string; number: number };

/**
 * PR·MR 주소 → { repo, number }.
 * GitHub: https://github.com/소유자/레포/pull/123 → repo "소유자/레포"
 * GitLab: https://호스트/그룹/.../프로젝트/-/merge_requests/12 → repo "gitlab:호스트/그룹/.../프로젝트"
 */
export function prOf(url: string): PrTarget | null {
  const gh = url.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (gh) return { repo: gh[1], number: Number(gh[2]) };
  const lab = url.match(/^https?:\/\/([\w.-]+(?:\/[\w.-]+)+)\/-\/merge_requests\/(\d+)/);
  return lab ? { repo: `gitlab:${lab[1]}`, number: Number(lab[2]) } : null;
}

export const isLab = (repo: string) => repo.startsWith("gitlab:");
/** 화면에 보일 레포 이름: 마지막 칸 (GitLab은 그룹이 여럿일 수 있다) */
export const repoName = (repo: string) => repo.split("/").pop() ?? repo;
/** PR 번호 표시: GitHub은 #12, GitLab MR은 !12 */
export const prNo = (t: PrTarget) => `${isLab(t.repo) ? "!" : "#"}${t.number}`;
export const prUrl = (t: PrTarget) => (isLab(t.repo) ? `https://${t.repo.slice(7)}/-/merge_requests/${t.number}` : `https://github.com/${t.repo}/pull/${t.number}`);

/** PR 링크를 Julgi 안의 PR 화면으로 연다. 터미널, 찾기, 코드 검토 어디서든 이것만 부른다. App이 받아서 연다 */
export const openPr = (target: PrTarget) => window.dispatchEvent(new CustomEvent<PrTarget>("julgi:pr", { detail: target }));

/** 나한테 온 리뷰 요청 하나 (gh search prs) */
export type ReviewAsk = { number: number; title: string; repository: { nameWithOwner: string }; author: { login: string }; updatedAt: string; url: string; isDraft: boolean };

/** 세션 줄에 달 PR의 형편 (Rust pr_status) */
/** actor: 마지막으로 닫거나 다시 연 사람이 내가 아니면 그 사람(봇 포함), 아니면 빈 글 */
export type PrStatus = { state: string; ci: string; decision: string; others: number; actor?: string };

const failed = (ci: string) => ci === "FAILURE" || ci === "ERROR";

/**
 * 지난번 형편과 견줘 내가 봐야 할 일이 생겼으면 그 까닭을, 아니면 빈 글을 준다.
 * CI가 새로 깨졌거나, 남이 코멘트를 달았거나, 승인·수정 요청을 받았거나, 머지됐을 때다
 */
export function newsOf(before: PrStatus, now: PrStatus): string {
  if (now.state === "MERGED" && before.state !== "MERGED") return "머지됨";
  // 닫기·다시 열기는 남(봇 포함)이 했을 때만 알린다. 내가 한 것은 내가 안다
  if (now.state === "CLOSED" && before.state === "OPEN" && now.actor) return `닫힘 · ${now.actor}`;
  if (now.state === "OPEN" && before.state === "CLOSED" && now.actor) return `다시 열림 · ${now.actor}`;
  if (failed(now.ci) && !failed(before.ci)) return "CI 실패";
  if (now.decision !== before.decision && now.decision === "CHANGES_REQUESTED") return "수정 요청";
  if (now.decision !== before.decision && now.decision === "APPROVED") return "승인됨";
  if (now.others > before.others) return `새 코멘트 ${now.others - before.others}`;
  return "";
}

/** 세션 줄에 붙일 짧은 글 조각들: [글, 눈에 띄게 할지] */
export function prParts(s: PrStatus): [string, boolean][] {
  const out: [string, boolean][] = [];
  if (s.state === "MERGED") out.push(["머지됨", false]);
  else if (s.state === "CLOSED") out.push(["닫힘", false]);
  else {
    if (failed(s.ci)) out.push(["CI 실패", true]);
    else if (s.ci === "PENDING" || s.ci === "EXPECTED") out.push(["CI 도는 중", false]);
    else if (s.ci === "SUCCESS") out.push(["CI 통과", false]);
    if (s.decision === "CHANGES_REQUESTED") out.push(["수정 요청", true]);
    else if (s.decision === "APPROVED") out.push(["승인됨", false]);
    else if (s.decision === "REVIEW_REQUIRED") out.push(["리뷰 대기", false]);
  }
  return out;
}
