/** 브레인: 일이 끝나도 남아야 하는 것. 노트 하나가 ~/.julgi/brain/<id>.md 하나다 */
export type Note = { id: string; title: string; kind: string; repo: string; from: string; created: string; body: string };

export const KINDS = ["결정", "함정", "사실", "선호"]; // 노트 파일에 적히는 값. 보여 주는 곳에서 tr(kind)로 옮긴다 i18n-ok

/** 파일 글 → 노트. 머리말이 없거나 깨졌으면 null */
export function parseNote(id: string, text: string): Note | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const head: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) head[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!head.title) return null;
  return { id, title: head.title, kind: KINDS.includes(head.type) ? head.type : "사실", repo: head.repo ?? "", from: head.from ?? "", created: head.created ?? "", body: m[2].trim() }; // i18n-ok
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export const formatNote = (n: Note) => `---\ntitle: ${oneLine(n.title)}\ntype: ${n.kind}\nrepo: ${oneLine(n.repo)}\nfrom: ${oneLine(n.from)}\ncreated: ${n.created}\n---\n\n${n.body.trim()}\n`;

/** 모델에게 보여 줄 목차 한 줄 */
export const indexLine = (n: Note, i: number) => `b${i}. [${n.kind}] ${n.title}${n.repo ? ` (${n.repo})` : ""}`;

/** 새 세션의 첫 글 앞에 붙이는 글 */
export const recallText = (notes: Note[]) => // 세션에 붙이는 글 i18n-ok
  `[Julgi 브레인: 전에 다른 일을 하며 알게 된 것이다. 참고만 하고, 지금 코드와 다르면 코드가 맞다]\n${notes.map((n) => `- (${n.kind}) ${n.title}: ${oneLine(n.body).slice(0, 600)}`).join("\n")}`;

/** 내가 세션의 방식을 바로잡은 말에서 "선호" 노트를 뽑는다 */
export const CORRECT_SYSTEM = // i18n-ok
  '너는 한 사람이 AI 코딩 세션에게 한 말 가운데, 세션을 중간에 끊고 한 말과 "앞으로", "하지 마", "왜 자꾸"처럼 방식을 바로잡는 것으로 보이는 말들을 본다. 여기서 다음 세션들도 지켜야 할 "일하는 방식"만 골라 노트로 만든다. 고르는 것: 같은 종류의 바로잡기가 두 번 넘게 나온 것, 또는 한 번이라도 "항상", "앞으로", "하지 마"처럼 규칙으로 말한 것. 고르지 않는 것: 그 일에만 해당하는 지시(이 파일 말고 저 파일, 이 값으로 바꿔), 마음이 바뀌어 다른 일을 시킨 것, 단순히 멈춘 것, 하던 말을 이어서 한 것, 스크립트가 찍어 낸 시험용 지시문, 무슨 뜻인지 알 수 없는 것. 노트는 세션에게 하는 지시문으로 쓴다: title은 한 줄 규칙("~한다", "~하지 않는다"), body는 왜 그런지와 어떤 때 해당하는지 한두 문장. repo는 특정 레포에서만 해당하면 그 이름, 어디서나면 빈 글자. count는 근거가 된 말의 수. 이미 있는 선호 목록과 같은 내용이면 새로 만들지 말고 그 번호를 update에 적는다. 확실한 것만. 없으면 빈 배열. 많아도 4개. JSON 한 줄만 답한다: {"notes":[{"title":"","body":"","repo":"","count":2,"update":null}]}';

/** 선호 노트를 세션의 시스템 프롬프트에 덧붙일 글로. 모든 Julgi 세션이 시작할 때 읽는다 */
export function prefsText(notes: Note[]): string {
  const prefs = notes.filter((n) => n.kind === "선호").slice(0, 12); // i18n-ok
  if (!prefs.length) return ""; // 아래는 시스템 프롬프트에 붙는 글 i18n-ok
  return `# 이 사용자가 일하는 방식 (Julgi가 지난 세션들에서 사용자가 바로잡은 말로 정리했다)\n\n${prefs.map((n) => `- ${n.repo ? `[${n.repo}에서] ` : ""}${n.title}. ${n.body}`).join("\n")}\n\n사용자의 지금 지시가 이것과 다르면 지금 지시를 따른다.\n`.slice(0, 3000);
}

export const LEARN_SYSTEM = // i18n-ok
  '너는 작업 기록에서 나중에 다른 일을 할 때도 쓸모 있는 지식만 골라 노트로 만든다. 고르는 기준: 코드만 읽어서는 알 수 없는 것. 종류는 셋이다. "결정"(무엇을 정했고 왜 그랬는지), "함정"(겪어 봐야 아는 것, 하면 안 되는 것과 그 이유), "사실"(업무 규칙, 히스토리, 누가 아는지, 환경의 특성). 고르지 않는 것: 이 작업의 진행 상황, 다음 할 일, 파일 목록, 코드에 그대로 적힌 것, 일반 상식. 노트 하나에는 한 가지만 담고, 이 기록을 못 본 사람도 이해하게 대상의 이름을 풀어서 쓴다. 본문은 두세 문장. 이미 있는 노트 목록과 같은 내용이면 새로 만들지 말고 그 번호를 update에 적어 본문을 더 정확하게 고친다. 고를 것이 없으면 빈 배열을 낸다. 많아도 5개. JSON 한 줄만 답한다: {"notes": [{"title": "한 줄 제목", "kind": "결정|함정|사실", "body": "본문", "update": 번호 또는 null}]}';

/** 노트가 얼마나 쓰였나. out: 새 세션에 붙인 횟수, read: 세션이 찾아본 횟수, fixed: 고친 횟수, last: 마지막으로 쓰인 때(ms) */
export type Stat = { out: number; read: number; fixed: number; last: number };
export type Stats = Record<string, Stat>;
export const statOf = (stats: Stats, id: string): Stat => stats[id] ?? { out: 0, read: 0, fixed: 0, last: 0 };
export const usedCount = (s: Stat) => s.out + s.read;
/** 담은 지 석 달이 넘었는데 그동안 한 번도 안 쓰인 노트. 고르는 후보에서 뒤로 민다 */
const STALE_DAYS = 90;
export const stale = (n: Note, s: Stat) => !usedCount(s) && Date.now() - new Date(n.created).getTime() > STALE_DAYS * 86_400_000;

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length >= 2));
/**
 * 모델에게 보여 줄 후보를 추린다. 노트가 많아지면 전부 보여 줄 수 없어서, 글자가 겹치는 것과 많이 쓰인 것을 앞에 세운다.
 * 추리기만 하고, 무엇이 관련 있는지는 모델이 정한다.
 */
export function shortlist(message: string, notes: Note[], stats: Stats, max = 60): Note[] {
  const q = words(message);
  const score = (n: Note) => {
    const text = words(`${n.title} ${n.repo} ${n.body}`);
    let hit = 0;
    for (const w of q) if (text.has(w)) hit += 1;
    const s = statOf(stats, n.id);
    return hit * 3 + Math.min(usedCount(s), 5) - (stale(n, s) ? 4 : 0);
  };
  return notes
    .map((n) => ({ n, score: score(n) }))
    .sort((a, b) => b.score - a.score || b.n.created.localeCompare(a.n.created))
    .slice(0, max)
    .map((x) => x.n);
}

/** 세션과 사람이 읽는 목차. 노트마다 한 줄 */
export const indexText = (notes: Note[], stats: Stats) => // 세션이 읽는 파일 i18n-ok
  `# 브레인 목차\n\n노트 ${notes.length}개. 형식: [id] (종류) 제목 · 레포 · 쓰인 횟수\n\n${notes.map((n) => `- [${n.id}] (${n.kind}) ${n.title} · ${n.repo || "공통"} · ${usedCount(statOf(stats, n.id))}`).join("\n")}\n`;

export const TIDY_SYSTEM = // i18n-ok
  '너는 지식 노트 묶음을 정리한다. 두 가지만 찾는다. 첫째, 같은 사실을 말하는 노트 짝: keep에 남길 번호, drop에 없앨 번호, 그리고 둘의 내용을 빠짐없이 합친 title과 body를 적는다. 주제가 비슷한 것만으로는 합치지 않는다. 둘째, 서로 어긋나는 말을 하는 노트 짝: a, b와 어디가 어긋나는지 why에 적는다. 어느 쪽이 맞는지는 판단하지 않는다. 없으면 빈 배열. JSON 한 줄만 답한다: {"merge": [{"keep": 번호, "drop": 번호, "title": "...", "body": "..."}], "conflict": [{"a": 번호, "b": 번호, "why": "..."}]}';

/** 지도의 레포 한 칸을 항목별로 나눈다. 들여 쓴 줄은 바로 위 항목에 딸린다 */
export function mapItems(section: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of section.split("\n").slice(1)) {
    if (line.startsWith("- ")) {
      const text = line.slice(2).replace(/`/g, "");
      const at = text.indexOf(":");
      out.push(at > 0 && at < 14 ? [text.slice(0, at).trim(), text.slice(at + 1).trim()] : ["", text.trim()]);
    } else if (line.trim() && out.length) {
      const last = out[out.length - 1];
      last[1] = `${last[1]}\n${line.replace(/`/g, "").replace(/^ {2}/, "")}`.trim();
    }
  }
  return out;
}

/** 레포 사이의 선 하나. from이 to를 부르거나 to에 기댄다. how는 어디서 그렇게 하는지 */
export type Edge = { from: string; to: string; kind: string; how: string };

// 선의 종류와 지도의 제목은 지도 파일에 적힌 값이다
// i18n-off
const edgeKind = (text: string) =>
  /API|호출|Feign/i.test(text) ? "API 호출" : /발행|메시지|publish/i.test(text) ? "메시지" : /생성/.test(text) ? "생성된 코드" : /의존/.test(text) ? "의존성" : /배포|gitops/i.test(text) ? "배포 설정" : "기타";

const KIND_NAMES = ["API 호출", "메시지", "생성된 코드", "의존성", "배포 설정"];
/**
 * 지도 글에서 레포 사이의 선을 뽑는다. 지도 끝의 "## 연결"에 "A -> B | 종류 | 근거"로 적힌 줄을 읽는다.
 * 그 묶음이 없는 옛 지도는 레포마다 "이어진 곳" 아래의 "이름: 무엇으로" 줄에서 짐작한다
 */
export function mapEdges(map: string): Edge[] {
  const parts = `\n${map}`.split(/\n## /).slice(1);
  const names = parts.map((p) => p.split("\n")[0].trim());
  const out = new Map<string, Edge>();
  const strict = parts.find((p) => p.split("\n")[0].trim() === "연결");
  if (strict) {
    for (const raw of strict.split("\n").slice(1)) {
      const m = raw.replace(/`/g, "").match(/^-\s*(\S+)\s*->\s*(\S+)\s*\|\s*([^|]+)\|?(.*)$/);
      if (!m || m[1] === m[2] || !names.includes(m[1]) || !names.includes(m[2])) continue;
      const kind = m[3].trim();
      out.set(`${m[1]}>${m[2]}`, { from: m[1], to: m[2], kind: KIND_NAMES.includes(kind) ? kind : "기타", how: m[4].trim().slice(0, 110) });
    }
    return [...out.values()];
  }
  for (const part of parts) {
    const me = part.split("\n")[0].trim();
    const ties = mapItems(part).find(([label]) => label === "이어진 곳")?.[1] ?? "";
    let outgoing = true;
    let skip = false;
    for (const raw of ties.split("\n")) {
      const line = raw.trim().replace(/^- /, "");
      const at = line.indexOf(":");
      // 묶음의 머리 줄: 방향을 정하거나, 확인되지 않은 것들의 묶음이면 통째로 건너뛴다
      if (at < 0 || at === line.length - 1) {
        if (/이 레포를/.test(line)) outgoing = false;
        else if (/이 레포가/.test(line)) outgoing = true;
        skip = /미확인|확인되지/.test(line);
        continue;
      }
      if (skip || /확인되지 않|확인된 것 없음/.test(line)) continue;
      const how = line.slice(at + 1).trim();
      for (const other of line.slice(0, at).split(",").map((n) => n.trim())) {
        if (other === me || !names.includes(other)) continue;
        const [from, to] = outgoing ? [me, other] : [other, me];
        const key = `${from}>${to}`;
        if (!out.has(key)) out.set(key, { from, to, kind: edgeKind(how), how: how.replace(/\s+/g, " ").slice(0, 110) });
      }
    }
  }
  return [...out.values()];
}

/** 영역(도메인) 하나와 그것을 이루는 조각들. 조각은 레포 전체이거나 레포 안의 폴더다 */
export type Domain = { name: string; pieces: { repo: string; path: string; what: string }[] };

/** 지도의 "## 도메인"에 "영역 | 레포 | 경로 | 맡은 일"로 적힌 줄을 영역별로 모은다 */
export function mapDomains(map: string): Domain[] {
  const part = `\n${map}`.split(/\n## /).find((p) => p.split("\n")[0].trim() === "도메인");
  const out = new Map<string, Domain>();
  for (const raw of (part ?? "").split("\n").slice(1)) {
    const cells = raw.replace(/`/g, "").replace(/^-\s*/, "").split("|").map((c) => c.trim());
    if (cells.length < 3 || !cells[0] || !cells[1]) continue;
    const domain = out.get(cells[0]) ?? { name: cells[0], pieces: [] };
    domain.pieces.push({ repo: cells[1], path: cells[2] === "." ? "" : cells[2], what: cells[3] ?? "" });
    out.set(cells[0], domain);
  }
  return [...out.values()];
}

export const MAP_SYSTEM =
  '너는 한 사람이 일하는 코드 레포들의 지도를 쓴다. 다른 레포에서 일하던 AI 세션이 이 지도만 보고 그걸 알려면 어느 레포의 어디를 읽어야 하는지, 이걸 바꾸면 어디를 같이 봐야 하는지 알 수 있어야 한다. 레포마다 주어진 재료(맨 위 폴더, README와 빌드 파일의 앞부분, 최근 커밋, 그 레포에서 한 일들, 코드에 다른 레포 이름이 나오는 곳)만으로 쓴다. 모르는 것은 지어내지 않는다. 형식은 마크다운이다. 레포마다 "## 레포이름" 아래에 일곱 줄을 이 순서와 이 이름표로 쓴다. "- 경로: ...". "- 역할: " 뒤에는 다음 가운데 하나만 적는다: 백엔드 서버, 앱, 웹 화면, 게이트웨이, 공용 모듈·계약, 배포 설정, 문서·지식, 도구. "- 하는 일: 한두 문장". "- 여기를 본다: 무엇을 찾을 때 이 레포를 읽는지". "- 들어가는 곳: 먼저 볼 폴더나 파일". "- 이어진 곳: 이 레포가 부르거나 기대는 레포와, 이 레포를 부르거나 기대는 레포. 각각 무엇으로 이어지는지(API 호출, 메시지 발행, 생성된 코드, 의존성, 배포 설정)를 적는다. 재료에서 확인되지 않으면 확인된 것 없음". "- 바꿀 때 같이 볼 곳: 이 레포의 무엇을 바꾸면 어느 레포의 무엇을 같이 확인해야 하는지. 예: API 응답을 바꾸면 그것을 부르는 화면 레포, 계약 파일을 바꾸면 거기서 코드를 만드는 레포들. 없으면 없음". 그 뒤에 "## 레포끼리의 관계"를 두고 전체를 가로지르는 흐름을 한 줄씩 적는다(요청이 어느 레포에서 어느 레포로 흐르는지, 계약의 원본이 어디인지, 배포 설정이 어디 있는지). 그다음 "## 도메인"을 두고, 제품의 한 영역을 이루는 조각들을 레포를 가로질러 묶는다. 영역이란 사용자가 "어드민 쪽", "고객 앱 쪽", "판매자 쪽", "콘솔 쪽"이라고 부르는 단위다(예: 고객 앱, 관리자 화면, 결제, 검색, 알림, 실시간 처리, 운영 자동화, 기획·스펙). 한 영역에는 화면 쪽 조각과 그것을 받아 주는 서버 모듈, 둘 사이의 계약이 함께 들어간다. 한 레포에 앱이나 모듈이 여럿이면 폴더 단위로 나눠 각자의 영역에 넣는다. 한 줄에 조각 하나씩 정확히 이 형식으로 적는다: "- 영역 이름 | 레포이름 | 레포 안의 경로(레포 전체면 .) | 그 영역에서 맡은 일". 같은 조각이 두 영역에 걸치면 두 줄로 적는다. 재료에서 확인되지 않는 조각은 적지 않는다. 맨 끝에 "## 연결"을 두고, 위에서 확인된 이어짐을 전부 한 줄에 하나씩 정확히 이 형식으로 적는다: "- 기대는레포 -> 기댐을받는레포 | 종류 | 근거가 되는 파일이나 사실". 화살표는 부르는 쪽에서 불리는 쪽으로, 의존하는 쪽에서 의존받는 쪽으로 긋는다. 레포 이름은 위의 "## " 제목과 글자 그대로 같아야 한다. 종류는 다음 가운데 하나만 쓴다: API 호출, 메시지, 생성된 코드, 의존성, 배포 설정. 이름만 나오고 관계가 확인되지 않은 것은 이 묶음에 적지 않는다. 머리말이나 맺음말은 쓰지 않는다.';

export const BRIEF_SYSTEM =
  '너는 코드 변경을 바쁜 개발자에게 브리핑한다. 읽는 사람은 이 변경을 직접 훑어볼 시간이 없고, 30초 안에 무엇이 왜 바뀌었는지와 어디를 직접 봐야 하는지 알고 싶어 한다. 주어진 변경 내용(diff)과 세션의 마지막 답만으로 쓴다. 변경에 없는 것은 지어내지 않는다. line에는 무엇을 왜 바꿨는지 한 문장. files에는 바뀐 파일마다 그 파일에서 한 일을 한 줄씩(시험 파일과 자동 생성 파일은 묶어서 한 줄로 적어도 된다, 많으면 중요한 것 8개까지). watch에는 사람이 직접 눈으로 봐야 할 곳만 적는다: 지워진 로직, DB 스키마나 마이그레이션, 인증·권한, 설정값이나 비밀 값, 밖에서 쓰는 API의 형식 변경, 예외를 삼키는 곳, 시험 없이 바뀐 분기나 계산. 각각 where에 \"파일경로:줄번호\"(줄을 모르면 파일경로), why에 왜 봐야 하는지 한 문장. 그런 곳이 없으면 빈 배열로 둔다. 형식이나 이름만 바뀐 것은 watch에 넣지 않는다. unverified에는 확인되지 않은 것을 한 문장으로: 세션의 답에 시험을 돌렸다는 말이 없거나, 돌렸다고 했지만 무엇을 돌렸는지 없거나, 변경에 시험이 없는 경우. 다 확인됐으면 빈 문자열. JSON 한 줄만 답한다: {\"line\": \"...\", \"files\": [{\"path\": \"...\", \"what\": \"...\"}], \"watch\": [{\"where\": \"...\", \"why\": \"...\"}], \"unverified\": \"...\"}';

/** 변경을 쓴 세션과 다른 눈으로 읽는 검토 */
export const CHECK_SYSTEM =
  '너는 코드 변경을 검토한다. 이 변경을 쓴 쪽의 설명은 보지 않았고, 변경 내용(diff)만 보고 판단한다. 읽는 사람은 바빠서 네가 짚은 곳만 직접 본다. 그러니 실제로 틀렸거나 틀릴 수 있는 곳만 낸다. level은 셋이다. "버그": 어떤 입력이나 상태에서 잘못 동작하는 것이 diff만으로 분명하다. "위험": 특정 조건(동시 실행, 빈 값, 경계 값, 실패한 호출, 옛 데이터)에서 깨질 수 있다. "의문": 지워졌거나 바뀐 동작이 의도인지 사람에게 확인해야 한다. 내지 않는 것: 취향, 형식, 이름, 주석, 더 나은 구조 제안, diff 밖의 코드를 봐야만 알 수 있는 추측, 시험이 없다는 말. 확신이 없으면 내지 않는다. 문제가 없으면 빈 배열이 옳은 답이다. 각 항목은 where에 "파일경로:줄번호"(새 파일의 줄 번호, 모르면 파일경로), what에 무엇이 어떤 때 어떻게 틀리는지 한두 문장으로 구체적으로. 심한 것부터, 많아도 6개. JSON 한 줄만 답한다: {"found":[{"where":"","level":"버그","what":""}]}';

export const SWEEP_SYSTEM =
  '너는 한 사람이 열어 둔 AI 코딩 세션 목록을 읽고 정리할 것을 찾는다. 세 가지만 찾는다. 첫째 groups: 같은 일을 하는 줄 묶음. 같은 일이란 목표가 같고 한쪽이 다른 쪽의 연속이거나 같은 변경을 다루는 것이다. 같은 레포, 같은 티켓, 비슷한 주제라는 것만으로는 묶지 않는다. 확실하지 않으면 묶지 않는다. name에는 그 일의 이름을 20자 안쪽 명사구로 적는다. 둘째 done: 요약으로 보아 일이 끝났고 남은 일이 없으며 마지막으로 쓴 지 3일이 넘은 줄. 답을 기다리거나 다음 할 일이 적혀 있으면 넣지 않는다. 셋째 trivial: 다시 볼 일이 없는 줄. 인사나 입력 시험, 실수로 연 것, 내용 없이 끝난 것만 해당한다. 조금이라도 일을 한 세션은 넣지 않는다. 각 항목의 why에 근거를 한 문장으로 적는다. 없으면 빈 배열. JSON 한 줄만 답한다: {"groups": [{"sessions": [번호들], "name": "...", "why": "..."}], "done": [{"n": 번호, "why": "..."}], "trivial": [{"n": 번호, "why": "..."}]}';

export type Candidate = { name: string; what: string; count: number; sessions: string[]; found: string };
export const CAND_SYSTEM =
  '너는 한 사람이 AI 코딩 세션에 시킨 일의 목록을 보고, 같은 종류의 일이 되풀이되는 것을 찾는다. 같은 종류란 절차가 같은 일이다(예: 배포 상태 확인, 할 일 정리, 릴리스 태그 따기). 같은 기능을 여러 세션에 걸쳐 만드는 것은 되풀이가 아니라 한 가지 일이니 넣지 않는다. 세 번 넘게 나온 것만 낸다. 이미 있는 스킬이 하는 일이면 내지 않는다. 사람이 일하다가 직접 시킨 일만 센다. 스크립트나 봇이 찍어 낸 지시문("너는 ~다"로 시작하는 역할 부여, "정확히 이 명령 하나만 실행하라" 같은 시험용 문장, 글자 그대로 되풀이되는 문장)은 사람이 되풀이한 일이 아니니 세지 않는다. name은 스킬 이름으로 쓸 짧은 영문 소문자와 하이픈, what은 그 스킬이 무엇을 대신해 줄지 한 문장, sessions는 해당하는 줄 번호들. 없으면 빈 배열. JSON 한 줄만 답한다: {"candidates": [{"name": "...", "what": "...", "sessions": [번호들]}]}';
// i18n-on
