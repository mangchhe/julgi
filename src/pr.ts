/** GitHub PR 하나를 가리키는 것: "소유자/레포"와 번호 */
export type PrTarget = { repo: string; number: number };

/** https://github.com/소유자/레포/pull/123(/files 등) → { repo, number } */
export function prOf(url: string): PrTarget | null {
  const m = url.match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** PR 링크를 Julgi 안의 PR 화면으로 연다. 터미널, 찾기, 코드 검토 어디서든 이것만 부른다. App이 받아서 연다 */
export const openPr = (target: PrTarget) => window.dispatchEvent(new CustomEvent<PrTarget>("julgi:pr", { detail: target }));
