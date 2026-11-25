// 화면 글에서 파일·폴더 경로를 찾는다. 터미널에서 ⌘를 누른 채 누르면 여는 데 쓴다.
// 순수한 함수만 둔다. scripts/check-paths.mjs가 Node에서 바로 불러 확인한다.

const SEG = String.raw`[\p{L}\p{N}_.@+\-]`;
/**
 * 두 가지 모양을 찾는다 (뒤에 :줄:칸이 붙을 수 있다):
 * - 뿌리가 있는 경로: /절대/경로, ~/홈/경로, ./상대, ../상대. 확장자가 없어도 된다(폴더일 수 있다)
 * - 뿌리가 없는 경로: 폴더/파일.확장자, 파일.확장자. 확장자가 있어야 한다
 * 이름에는 한글 같은 글자도 들어간다
 */
const PATH = new RegExp(String.raw`(?:(?:~|\.{1,2})?/(?:${SEG}+/)*${SEG}*|(?:${SEG}+/)*${SEG}+\.[A-Za-z0-9]{1,8})(?::\d+(?::\d+)?)?`, "gu");

export function findPaths(text: string): { start: number; end: number; path: string; line?: number }[] {
  const out: { start: number; end: number; path: string; line?: number }[] = [];
  for (const m of text.matchAll(PATH)) {
    const start = m.index!;
    let found = m[0];
    // URL의 일부(example.com, //host/a.js)나 단어 중간이면 경로가 아니다
    if (start > 0 && /[\p{L}\p{N}_:/.~-]/u.test(text[start - 1])) continue;
    if (text[start + found.length] === "/") continue;
    // "a.md에 저장"처럼 확장자 뒤에 붙은 한글 조사와, 문장 끝의 마침표는 경로가 아니다
    found = found.replace(/(\.[A-Za-z0-9]{1,8})\p{Script=Hangul}+$/u, "$1").replace(/\.+$/, "");
    const path = found.replace(/:\d+(:\d+)?$/, "");
    const rooted = /^(?:~|\.{1,2})?\//.test(path);
    const parts = path.split("/").filter((p) => p && p !== "~" && p !== "." && p !== "..");
    const ext = /\.[A-Za-z0-9]{1,8}$/.test(path);
    if (!parts.length) continue;
    // 뿌리가 있어도 "/config"처럼 한 마디뿐이고 확장자가 없으면 경로로 보지 않는다 (명령 이름일 때가 많다). ~/ 는 한 마디여도 받는다
    if (rooted && !ext && parts.length < 2 && !path.startsWith("~/")) continue;
    // 폴더 없이 이름만 있으면 이름과 확장자가 두 글자 넘을 때만 파일로 본다 (e.g, v1.2, 2.1.330 같은 것을 거른다)
    if (!path.includes("/") && !/^[\p{L}\p{N}_@+-][\p{L}\p{N}_.@+-]+\.[A-Za-z][A-Za-z0-9]+$/u.test(path)) continue;
    out.push({ start, end: start + found.length, path, line: Number(found.match(/:(\d+)(:\d+)?$/)?.[1]) || undefined });
  }
  return out;
}

/** 찾은 경로를 열 수 있는 절대 경로로: ~는 홈으로, 상대 경로는 세션의 폴더 기준으로 */
export function resolvePath(path: string, cwd: string, home: string): string {
  if (path === "~" || path.startsWith("~/")) return home.replace(/\/$/, "") + path.slice(1);
  if (path.startsWith("/")) return path;
  return `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
}
