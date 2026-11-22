// 화면 글의 언어. 코드에는 한국어 글을 그대로 쓰고 tr`…`로 감싼다. 영어는 src/i18n/en/의 사전에서 찾는다.
// 사전의 열쇠는 한국어 글이고, 끼워 넣는 값의 자리는 {0}, {1}로 적는다:  tr`세션 ${n}개` → "세션 {0}개"
// 사전은 여기서 읽지 않고 main.tsx가 넣어 준다. 그래야 Node로 도는 검사 스크립트가 이 파일을 그대로 읽을 수 있다
let EN: Record<string, string> = {};
export const setDict = (dict: Record<string, string>) => void (EN = dict);

export type Lang = "en" | "ko";
// 사전을 넣기 전(검사 스크립트)에는 한국어 그대로 돌려준다
let lang: Lang = "ko";
const missed = new Set<string>();

/** 설정값("auto" | "en" | "ko")에서 실제 언어를 정한다. auto는 시스템이 한국어일 때만 한국어 */
export const resolveLang = (want: unknown): Lang => (want === "ko" || want === "en" ? want : /^ko\b/i.test(navigator.language || "") ? "ko" : "en");
export const setLang = (next: Lang) => void ((lang = next), typeof document !== "undefined" && (document.documentElement.lang = next));
export const getLang = () => lang;

const fill = (text: string, vals: unknown[]) => text.replace(/\{(\d+)\}/g, (_, i) => String(vals[Number(i)] ?? ""));

/** 한국어 글을 지금 언어로. 태그로도(tr`…${x}…`), 함수로도(tr("…")) 쓴다. 사전에 없으면 한국어 그대로 */
export function tr(strings: TemplateStringsArray | string, ...vals: unknown[]): string {
  const key = typeof strings === "string" ? strings : strings.reduce((acc, part, i) => acc + (i ? `{${i - 1}}` : "") + part, "");
  if (lang === "ko") return fill(key, vals);
  const hit = EN[key];
  if (hit === undefined && import.meta.env?.DEV && !missed.has(key)) (missed.add(key), console.warn("[i18n] 영어 없음:", key));
  return fill(hit ?? key, vals);
}
