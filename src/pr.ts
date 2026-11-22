/** GitHub PR 하나를 가리키는 것: "소유자/레포"와 번호 */
export type PrTarget = { repo: string; number: number };

/** https://github.com/소유자/레포/pull/123(/files 등) → { repo, number } */
export function prOf(url: string): PrTarget | null {
  const m = url.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** PR 링크를 Julgi 안의 PR 화면으로 연다. 터미널, 찾기, 코드 검토 어디서든 이것만 부른다. App이 받아서 연다 */
export const openPr = (target: PrTarget) => window.dispatchEvent(new CustomEvent<PrTarget>("julgi:pr", { detail: target }));

/** 나한테 온 리뷰 요청 하나 (gh search prs) */
export type ReviewAsk = { number: number; title: string; repository: { nameWithOwner: string }; author: { login: string }; updatedAt: string; url: string; isDraft: boolean };

/** 세션 줄에 달 PR의 형편 (Rust pr_status) */
export type PrStatus = { state: string; ci: string; decision: string; others: number };

const failed = (ci: string) => ci === "FAILURE" || ci === "ERROR";

/**
 * 지난번 형편과 견줘 내가 봐야 할 일이 생겼으면 그 까닭을, 아니면 빈 글을 준다.
 * CI가 새로 깨졌거나, 남이 코멘트를 달았거나, 승인·수정 요청을 받았거나, 머지됐을 때다
 */
export function newsOf(before: PrStatus, now: PrStatus): string {
  if (now.state === "MERGED" && before.state !== "MERGED") return "머지됨";
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
