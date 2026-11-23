import Hint from "./Hint";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import go from "highlight.js/lib/languages/go";
import groovy from "highlight.js/lib/languages/groovy";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { ago, Change, turnStart } from "./model";
import { tr } from "./i18n";
import { openPr, prOf } from "./pr";

// 자주 보는 언어만 싣는다. 확장자로 고르고, 모르는 것은 색 없이 보여 준다
const LANGS = { bash, css, dart, go, groovy, java, javascript, json, kotlin, markdown, protobuf, python, ruby, rust, sql, swift, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
const BY_EXT: Record<string, keyof typeof LANGS> = {
  sh: "bash", zsh: "bash", css: "css", scss: "css", dart: "dart", go: "go", gradle: "groovy", groovy: "groovy", java: "java",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json", kt: "kotlin", kts: "kotlin", md: "markdown",
  proto: "protobuf", py: "python", rb: "ruby", rs: "rust", sql: "sql", swift: "swift", ts: "typescript", tsx: "typescript",
  html: "xml", xml: "xml", svg: "xml", vue: "xml", yml: "yaml", yaml: "yaml", toml: "yaml",
};
export const langOf = (path: string) => BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""];
/** 한 줄을 색칠한 HTML로. 줄 단위로 칠하므로 여러 줄에 걸친 주석이나 문자열은 가운데 줄의 색이 어긋날 수 있다 */
export const paint = (text: string, lang?: string) => {
  if (!lang || text.length > 600) return undefined;
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
};

/** 저장된 수준 이름 → 색을 고르는 이름 */
const levelClass = (level: string) => (level === "버그" ? "bug" : level === "위험" ? "risk" : level ? "ask" : "see"); // i18n-ok

/** 살펴볼 작업 폴더. 지금 세션의 폴더이거나, 이 세션이 맡긴 일감의 워크트리다 */
export type Place = { label: string; cwd: string };
type Props = {
  places: Place[];
  /** 폴더마다 Julgi가 세어 둔 것: 브리핑과, 답마다 찍어 둔 상태 */
  known: Record<string, Change>;
  /** 이 세션(과 같은 줄기의 세션들). 같은 폴더에서 다른 세션이 고친 것을 섞지 않으려고 받는다 */
  sessions?: string[];
  /** 이 낱말(티켓 키, 브랜치 이름)이 브랜치에 든 워크트리를 앞에 세운다 */
  prefer?: string[];
  /** 세션에 말을 보낸다 */
  onSay: (text: string) => void;
  onClose: () => void;
};

export type Line = { kind: "add" | "del" | "same"; text: string; oldNo?: number; newNo?: number };
export type Hunk = { head: string; lines: Line[] };
/** 커밋, 부모들(빈칸으로 나눔), 제목, 언제(초), 붙은 브랜치·태그 이름들 */
type Commit = [string, string, string, number, string];
/** 이력 그래프의 한 줄. col: 이 커밋의 줄(레인), pass: 그냥 지나가는 줄들, top: 위에서 이 커밋의 줄로 내려오는 선이 있는가, into: 위에서 이 커밋으로 모이는 줄들, out: 이 커밋에서 부모로 내려가는 줄들 */
type GraphRow = { commit: Commit; col: number; top: boolean; pass: number[]; into: number[]; out: number[]; width: number; merge: boolean };
const ROW = 28;
const HUES = ["var(--accent)", "var(--ok)", "var(--wait)", "#c9b8f5", "#7fc4b4", "#e0b060"];
const hue = (lane: number) => HUES[lane % HUES.length];

/**
 * 커밋들을 줄(레인)에 세운다. 위가 최근이다.
 * 줄마다 "다음에 올 커밋"을 들고 내려가다가, 그 커밋을 만나면 그 줄에 점을 찍고 부모에게 줄을 넘긴다.
 * 부모가 둘이면(머지) 줄이 하나 더 갈라져 나가고, 여러 줄이 같은 커밋을 기다리고 있었으면 거기서 모인다
 */
function lanes(commits: Commit[]): GraphRow[] {
  const want: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const [sha, parentText] = commit;
    const parents = parentText.split(" ").filter(Boolean);
    let col = want.indexOf(sha);
    const top = col >= 0;
    if (col < 0) {
      col = want.indexOf(null);
      if (col < 0) col = want.push(null) - 1;
    }
    // 이 커밋을 기다리던 다른 줄들은 여기서 모이고 끝난다
    const into = want.map((w, i) => (w === sha && i !== col ? i : -1)).filter((i) => i >= 0);
    const pass = want.map((w, i) => (w && w !== sha ? i : -1)).filter((i) => i >= 0);
    for (const i of into) want[i] = null;
    want[col] = null;
    const out: number[] = [];
    parents.forEach((parent, n) => {
      let at = want.indexOf(parent);
      if (at < 0) {
        // 첫 부모는 같은 줄을 이어받고, 나머지 부모는 빈 줄로 갈라져 나간다
        at = n === 0 ? col : want.indexOf(null);
        if (at < 0) at = want.push(null) - 1;
        want[at] = parent;
      }
      out.push(at);
    });
    rows.push({ commit, col, top, pass, into, out, width: 0, merge: parents.length > 1 });
    while (want.length && want[want.length - 1] === null) want.pop();
  }
  // 줄 수는 그 줄과 위아래를 통틀어 가장 넓은 곳에 맞춘다. 글이 들쭉날쭉 밀리지 않게
  const width = Math.min(8, Math.max(1, ...rows.map((r) => Math.max(r.col, ...r.pass, ...r.into, ...r.out) + 1)));
  for (const r of rows) r.width = width;
  return rows;
}

/**
 * 커밋에 붙은 이름들 가운데 이력에서 눈에 띄어야 할 것만 고른다: 지금 브랜치, 태그, 오래 사는 브랜치(develop, main, release/…).
 * 머지되고 남은 feature/fix 브랜치 이름은 제목을 가리기만 해서 뺀다 (줄에 마우스를 올리면 전부 나온다)
 */
function labels(refs: string, base: string): { name: string; kind: "head" | "tag" | "branch" | "base" }[] {
  const out: { name: string; kind: "head" | "tag" | "branch" | "base" }[] = [];
  for (const raw of refs.split(", ").filter((r) => r && !r.includes("refs/julgi") && !r.endsWith("/HEAD"))) {
    const head = raw.startsWith("HEAD -> ");
    const tag = raw.startsWith("tag: ");
    const name = raw.replace(/^HEAD -> |^tag: /, "").replace(/^origin\//, "");
    if (out.some((o) => o.name === name)) continue;
    if (head || tag || !name.includes("/") || name.startsWith("release/")) out.push({ name, kind: head ? "head" : tag ? "tag" : name === base ? "base" : "branch" });
  }
  return out.slice(0, 2);
}

/** 볼 수 있는 판 하나. from에서 to까지 바뀐 것을 본다. 둘 다 없으면 기본 브랜치에서 지금 작업 폴더까지 */
/** kind: 이력에서 어떻게 그릴지. all 전부, wip 커밋 안 한 것, turn 답 하나, commit 커밋 하나 */
type Ver = { key: string; from: string | null; to: string | null; label: string; title: string; kind: "all" | "wip" | "turn" | "commit"; when: string };
const NONE: Ver = { key: "all", from: "HEAD", to: null, label: tr`이 세션이 고친 것`, title: "", kind: "all", when: "" };
export type FileDiff = { path: string; adds: number; dels: number; hunks: Hunk[]; note: string };

/** git diff 글을 파일과 묶음, 줄로 나눈다. 줄마다 고치기 전과 뒤의 줄 번호를 붙인다 */
export function parse(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  // diff 글은 줄바꿈으로 끝난다. 마지막 빈 조각을 줄로 세면 파일 끝에 번호만 있는 빈 줄이 붙는다
  const rows = diff.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  for (const raw of rows) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/ b\/(.+)$/);
      file = { path: m?.[1] ?? raw.slice(11), adds: 0, dels: 0, hunks: [], note: "" };
      files.push(file);
      hunk = undefined;
    } else if (!file) continue;
    else if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldNo = Number(m?.[1] ?? 1);
      newNo = Number(m?.[2] ?? 1);
      hunk = { head: (m?.[3] ?? "").trim(), lines: [] };
      file.hunks.push(hunk);
    } else if (!hunk) {
      if (raw.startsWith("new file")) file.note = tr`새 파일`;
      else if (raw.startsWith("deleted file")) file.note = tr`지워짐`;
      else if (raw.startsWith("rename to")) file.note = tr`이름 바뀜`;
      else if (raw.startsWith("Binary")) file.note = tr`글이 아닌 파일`;
    } else if (raw.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
      file.adds += 1;
    } else if (raw.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
      file.dels += 1;
    } else if (raw.startsWith(" ") || raw === "") hunk.lines.push({ kind: "same", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return files;
}

/**
 * 코드 검토 (⌘E). 칸의 터미널 자리에 코드를 편다. 세션은 뒤에서 그대로 살아 있다.
 * 읽기 좋게 문법 색칠은 하지만, 고치기나 파일 탐색 같은 에디터의 일은 하지 않는다. 여기서만 되는 것 두 가지를 한다:
 * 답마다 찍어 둔 상태로 "이번 답에서 바뀐 것"만 보기, 그리고 줄에 대고 세션에게 말하기.
 */
export default function Review({ places: given, known, sessions, prefer = [], onSay, onClose }: Props) {
  const [placeAt, setPlaceAt] = useState(0);
  // 같은 레포의 다른 워크트리도 고를 수 있게 뒤에 붙인다. 세션이 메인 폴더를 두고 워크트리로 옮겨 일하는 일이 있다
  const [trees, setTrees] = useState<Place[]>([]);
  const places = useMemo(() => [...given, ...trees.filter((t) => !given.some((g) => g.cwd === t.cwd))], [given, trees]);
  const place = places[Math.min(placeAt, places.length - 1)];
  // 세션의 폴더가 그 뒤로 다른 브랜치로 옮겨 갔는가. 그러면 찍어 둔 답들과 견준 차이는 믿을 수 없다
  const [moved, setMoved] = useState(false);
  const change = place ? known[place.cwd] : undefined;
  // 세션의 폴더(첫 자리)에서는 이 세션의 답만 센다. 일감의 워크트리는 그 일감 혼자 쓰니 전부 센다
  const turns = moved && placeAt === 0 ? [] : (change?.turns ?? []).filter((t) => placeAt !== 0 || !sessions || sessions.includes(t.session));
  // 이 폴더의 깃 상태와, 브랜치에 쌓인 커밋들
  const [git, setGit] = useState<{ branch: string; default: string; dirty: number; ahead: number; behind: number; forge: string; fork: string; worktrees?: [string, string][] } | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [mr, setMr] = useState<[string, string, string, string, string] | undefined>(undefined);
  useEffect(() => {
    if (!place) return;
    setGit(null);
    setCommits([]);
    setMr(undefined);
    void invoke<typeof git>("repo_state", { path: place.cwd }).then((st) => {
      setGit(st);
      // 세션의 폴더를 볼 때만 워크트리 목록을 채운다. 티켓 키나 브랜치 이름이 맞는 것을 앞에, 여덟 개까지
      if (placeAt === 0 && st?.worktrees) {
        const fits = (branch: string) => prefer.some((p) => branch.toLowerCase().includes(p.toLowerCase()));
        setTrees(
          st.worktrees
            .filter(([dir]) => dir !== place.cwd)
            .sort((a, b) => Number(fits(b[1])) - Number(fits(a[1])))
            .slice(0, 8)
            .map(([dir, branch]) => ({ label: tr`워크트리 · ${branch}`, cwd: dir })),
        );
      }
      if (st?.forge) void invoke<[string, string, string, string, string][]>("repo_mrs", { path: place.cwd, forge: st.forge }).then((list) => setMr(list.find((m) => m[0] === st.branch)), () => {});
    }, () => {});
    void invoke<Commit[]>("repo_commits", { path: place.cwd }).then(setCommits, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.cwd]);
  useEffect(() => {
    setMoved(false);
    const first = placeAt === 0 && given[0] ? known[given[0].cwd]?.turns?.find((t) => !sessions || sessions.includes(t.session)) : undefined;
    if (!first || !given[0]) return;
    void invoke<boolean>("repo_moved", { path: given[0].cwd, from: first.from, since: turnStart(first) }).then(setMoved, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [given[0]?.cwd, placeAt]);
  // 폴더가 옮겨 갔고, 세션의 티켓이나 브랜치 이름이 맞는 워크트리가 있으면 그 워크트리를 바로 편다
  useEffect(() => {
    if (!moved || placeAt !== 0) return;
    const at = places.findIndex((p, i) => i >= given.length && prefer.some((w) => p.label.toLowerCase().includes(w.toLowerCase())));
    if (at > 0) return void (setPlaceAt(at), setVerKey("all"));
    // 이름으로 못 찾으면 세션의 마지막 답을 본다. 세션이 "…워크트리에서 진행한다"고 경로를 적어 두는 일이 많다
    const last = sessions?.[sessions.length - 1];
    if (!last) return;
    void invoke<string | null>("last_reply", { sessionId: last }).then((reply) => {
      const said = places.findIndex((p, i) => i >= given.length && !!reply?.includes(p.cwd));
      if (said > 0) (setPlaceAt(said), setVerKey("all"));
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved, places.length]);
  /**
   * 볼 수 있는 판들: 전부, 브랜치에 쌓인 커밋 하나하나, Julgi가 찍어 둔 답 하나하나.
   * 판을 고르면 그 사이에 바뀐 것만 보인다. 작업 폴더는 건드리지 않는다
   */
  // 위가 최근: 전부 → 아직 커밋 안 한 것 → 그 안의 답들 → 커밋들
  const versions = useMemo<Ver[]>(
    () => [
      // 맨 위는 하나: 이 세션이 고친 것 전부. 답마다 찍어 둔 상태가 있으면 첫 답 앞에서 지금까지,
      // 없으면(Julgi가 지켜보기 전의 세션) 원격의 기본 브랜치에서 갈라진 뒤 전부: 작업 브랜치면 그 브랜치의 것 전부,
      // 기본 브랜치 위라면 안 올린 커밋과 커밋 안 한 것. 브리핑과 사이드바 숫자가 읽는 범위와 같다
      { ...NONE, from: turns.length ? turns[0].from : moved && placeAt === 0 ? "HEAD" : null, title: turns.length ? tr`이 세션의 첫 답 앞에서 지금까지 바뀐 것` : tr`답마다 찍어 둔 기록이 없어, 폴더에 남아 있는 변경을 보여 준다` },
      ...[...turns].reverse().map((t, i) => ({ key: "t:" + t.to, from: t.from, to: t.to, label: t.said || (i === 0 ? tr`방금 답` : tr`${i}번 전 답`), title: t.said ? tr`이 말에 한 답 하나에서 바뀐 것만: ${t.said}` : tr`이 답 하나에서 바뀐 것만`, kind: "turn" as const, when: ago(t.at / 1000) + (t.files ? " · " + tr`파일 ${t.files}` : "") })),
      // 커밋은 그 첫 부모와 견준다 (머지 커밋이면 머지로 들어온 것 전부가 보인다)
      ...commits.map(([sha, parents, subject, at]) => ({ key: "c:" + sha, from: parents.split(" ")[0] || null, to: sha, label: subject, title: `${subject} (${sha.slice(0, 8)})`, kind: "commit" as const, when: at ? ago(at) : "" })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commits, turns.length, git?.branch, moved, placeAt],
  );
  const graph = useMemo(() => lanes(commits), [commits]);
  // 기준에서 갈라진 커밋이 이력의 몇째 줄인가. 목록 밖이면 보이는 커밋 전부가 갈라진 뒤의 것이다
  const forkAt = useMemo(() => {
    const at = commits.findIndex(([sha]) => sha === git?.fork);
    return at < 0 ? commits.length : at;
  }, [commits, git?.fork]);
  // 창 맨 윗줄의 오른쪽 칸 단추가 누르면 이력을 펴고 접는다
  const histToggle = useRef(() => {});
  useEffect(() => {
    const on = () => histToggle.current();
    window.addEventListener("julgi:hist", on);
    return () => window.removeEventListener("julgi:hist", on);
  }, []);
  const [verKey, setVerKey] = useState("all");
  const ver = versions.find((v) => v.key === verKey) ?? NONE;
  const [diff, setDiff] = useState<string | null | undefined>(undefined);
  const [fileAt, setFileAt] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const [noteAt, setNoteAt] = useState<{ path: string; no: number; text: string } | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(0);
  // 오른쪽 이력을 펴 둘지. 이 맥에서만 기억한다
  const [hist, setHist] = useState(() => {
    try {
      return localStorage.getItem("review-hist") !== "0";
    } catch {
      return true;
    }
  });
  const toggleHist = () => {
    setHist(!hist);
    try {
      localStorage.setItem("review-hist", hist ? "0" : "1");
    } catch {
      // 저장이 막혀 있으면 이번에만 유지된다
    }
  };
  histToggle.current = toggleHist;
  const [whole, setWhole] = useState(false); // 바뀐 곳만이 아니라 파일 전체를 본다
  const [wrap, setWrap] = useState(false); // 긴 줄을 접어서 본다
  // 작업 폴더에 남아 있지만 이 세션이 만든 것이 아닌 변경. 파일 목록에는 섞지 않고 한 줄로만 알린다
  const [dirty, setDirty] = useState<string[]>([]);
  useEffect(() => {
    setDirty([]);
    if (!place) return;
    void invoke<{ files: string[] } | null>("repo_changes", { path: place.cwd }).then((c) => setDirty((c?.files ?? []).filter((l) => !l.startsWith("??")).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""))), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.cwd]);
  const [full, setFull] = useState<FileDiff | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);

  useEffect(() => {
    if (!place) return;
    setDiff(undefined);
    void invoke<string | null>("repo_diff", { path: place.cwd, from: ver.from, to: ver.to, file: null }).then(
      (text) => setDiff(text ?? null),
      () => setDiff(null),
    );
    setFileAt(0);
    setNoteAt(null);
    // 폴더나 판을 바꿀 때만 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.cwd, ver.key, ver.from]);

  const files = useMemo(() => (diff ? parse(diff) : []), [diff]);
  const picked = files[Math.min(fileAt, files.length - 1)];
  // 파일 전체 보기: 고른 파일만 처음부터 끝까지 다시 받아 온다. 바뀐 줄은 그대로 색이 칠해져 있다
  useEffect(() => {
    setFull(undefined);
    if (!whole || !picked || !place) return;
    void invoke<string | null>("repo_diff", { path: place.cwd, from: ver.from, to: ver.to, file: picked.path }).then(
      (text) => {
        setFull(text ? parse(text)[0] : undefined);
        // 처음 바뀐 줄이 보이는 데로 간다
        setTimeout(() => body.current?.querySelector(".rv-line.add, .rv-line.del")?.scrollIntoView({ block: "center" }), 60);
      },
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whole, picked?.path, place?.cwd, ver.key]);
  const file = whole && full ? full : picked;
  const lang = file ? langOf(file.path) : undefined;
  useEffect(() => {
    if (file && !seen.includes(file.path)) setSeen((list) => [...list, file.path]);
    body.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  const go = (dir: number) => files.length && setFileAt((fileAt + dir + files.length) % files.length);
  /** 브리핑의 "경로:줄"을 받아 그 파일로 간다 */
  const jump = (where: string) => {
    const path = where.replace(/:\d+.*$/, "").trim();
    const at = files.findIndex((f) => f.path === path || f.path.endsWith(path) || path.endsWith(f.path));
    if (at >= 0) setFileAt(at);
  };
  const say = () => {
    if (!noteAt || !note.trim()) return;
    // 세션에 치는 말은 번역하지 않는다 i18n-ok
    onSay(`[코드 검토] ${noteAt.path}:${noteAt.no}\n> ${noteAt.text.trim().slice(0, 200)}\n\n${note.trim()}`);
    setNote("");
    setNoteAt(null);
    setSent(sent + 1);
    box.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    // 한마디를 쓰는 중에는 글자 키를 가로채지 않는다
    if (e.target instanceof HTMLTextAreaElement) {
      if (e.key === "Escape") (setNoteAt(null), box.current?.focus());
      else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) say();
      else return;
    } else if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "j") go(1);
    else if (e.key === "ArrowUp" || e.key === "k") go(-1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // 이력은 위가 최근이다. →는 더 최근(위), ←는 더 예전(아래)
      const i = versions.findIndex((v) => v.key === ver.key);
      setVerKey(versions[Math.min(versions.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? -1 : 1)))].key);
    }
    else if (e.key === "f") setWhole(!whole);
    else if (e.key === "w") setWrap(!wrap);
    else if (e.key === "h") toggleHist();
    else if (e.key === "n" || e.key === "p") {
      // 파일 전체를 볼 때 바뀐 곳 사이를 건너다닌다: 바뀐 줄 묶음의 첫 줄들 가운데 화면 아래(위)의 것으로
      const rows = [...(body.current?.querySelectorAll<HTMLElement>(".rv-line") ?? [])];
      const starts = rows.filter((el, i) => !el.classList.contains("same") && (i === 0 || rows[i - 1].classList.contains("same")));
      const top = body.current?.getBoundingClientRect().top ?? 0;
      const mid = top + (body.current?.clientHeight ?? 0) / 2;
      const next = e.key === "n" ? starts.find((el) => el.getBoundingClientRect().top > mid + 8) : [...starts].reverse().find((el) => el.getBoundingClientRect().top < mid - 8);
      next?.scrollIntoView({ block: "center" });
    }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // 브리핑은 "이 세션이 고친 것"을 읽고 쓴 것이다. 다른 판(답 하나, 커밋 하나)에는 붙이지 않는다.
  // 다른 세션의 범위로 쓴 브리핑(같은 폴더를 여럿이 쓸 때)도 보여 주지 않는다
  const brief = change?.brief && (placeAt !== 0 || !change.briefBy || !sessions || sessions.includes(change.briefBy)) ? change.brief : undefined;
  // 짚은 곳과 눈여겨볼 곳을 한 목록으로. 같은 파일의 같은 이야기는 한 번만: 수준이 붙은 쪽(검토)을 남긴다
  const spots = useMemo(() => {
    const fileOf = (where: string) => where.replace(/:\d+.*$/, "").trim();
    const out: { level: string; where: string; text: string }[] = [];
    for (const f of brief?.found ?? []) if (!out.some((o) => o.where === f.where && o.text === f.what)) out.push({ level: f.level, where: f.where, text: f.what });
    for (const w of brief?.watch ?? []) if (!out.some((o) => fileOf(o.where) === fileOf(w.where))) out.push({ level: "", where: w.where, text: w.why });
    return out;
  }, [brief]);
  const [briefOpen, setBriefOpen] = useState<boolean | null>(null); // null: 짚은 곳이 있으면 펴고 없으면 접는다
  const opened = briefOpen ?? spots.length > 0;
  const others = ver.key === "all" ? dirty.filter((p) => !files.some((f) => f.path === p)) : [];
  // 커밋을 골랐으면 그 커밋의 메시지 전체를 위에 편다
  const [message, setMessage] = useState<[string, string] | null>(null);
  useEffect(() => {
    setMessage(null);
    if (ver.kind !== "commit" || !ver.to || !place) return;
    void invoke<[string, string] | null>("commit_message", { path: place.cwd, sha: ver.to }).then(setMessage, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver.key, place?.cwd]);
  const chosen = ver.kind === "commit" ? commits.find(([sha]) => sha === ver.to) : undefined;
  return (
    <div className="rv" ref={box} tabIndex={-1} onKeyDown={onKey}>
      <div className="rv-top">
        {git && (
          <div className="rv-git">
            <small className="rv-label">{tr`깃`}</small>
            <span>
              {tr`브랜치`} <b className={git.branch === git.default ? "" : "off"}>{git.branch}</b>
              {git.branch === git.default && <em> · {tr`기본 브랜치에서 바로 고치고 있다`}</em>}
            </span>
            <span>{tr`커밋 안 한 파일 ${git.dirty}`}</span>
            {git.ahead > 0 && <span>{tr`안 올린 커밋 ${git.ahead}`}</span>}
            {git.ahead < 0 && <span>{tr`원격에 아직 없는 브랜치`}</span>}
            {git.behind > 0 && <span>{tr`원격보다 뒤 ${git.behind}`}</span>}
            {mr && (
              <button type="button" tabIndex={-1} onClick={() => { const pr = prOf(mr[2]); if (pr) openPr(pr); else void openUrl(mr[2]); }} title={mr[2]}>
                MR · {mr[1].slice(0, 40)} · {mr[3]}
                {mr[4] && ` · CI ${mr[4]}`}
              </button>
            )}
          </div>
        )}
        <div className="rv-turns">
          {places.length > 1 &&
            places.map((p, i) => (
              <button key={p.cwd} type="button" tabIndex={-1} className={"hs-kind" + (i === placeAt ? " on" : "")} onClick={() => (setPlaceAt(i), setVerKey("all"))}>
                {p.label}
              </button>
            ))}
          <span className="rv-hint">{sent > 0 ? tr`세션에 ${sent}번 말함 · ` : ""}{tr`⌘E 터미널로`}</span>
        </div>
        {chosen && (
          <div className="rv-msg">
            <div>
              <b>{(message?.[1] ?? chosen[2]).split("\n")[0]}</b>
              <small>
                {message?.[0] ? `${message[0]} · ` : ""}
                {chosen[3] ? ago(chosen[3]) : ""} · {chosen[0].slice(0, 8)}
              </small>
            </div>
            {message && message[1].includes("\n") && <div className="rv-msg-body">{message[1].split("\n").slice(1).join("\n").trim()}</div>}
          </div>
        )}
        {brief && ver.key === "all" && !(moved && placeAt === 0) && (
          <div className={"rv-brief2" + (opened ? " open" : "")}>
            <button type="button" tabIndex={-1} className="rv-b-line" onClick={() => setBriefOpen(!opened)} title={opened ? tr`접기` : tr`펴기`}>
              <i aria-hidden="true">{opened ? "▾" : "▸"}</i>
              <span>{brief.line}</span>
              {!opened && spots.length > 0 && <small>{tr`짚은 곳 ${spots.length}`}</small>}
            </button>
            {opened && (
              <>
                {spots.map((s, i) => ( // level은 저장된 값이다 i18n-ok
                  <button key={i} type="button" tabIndex={-1} className="rv-spot" onClick={() => jump(s.where)} title={s.where}>
                    <em className={"l-" + levelClass(s.level)}>{s.level ? tr(s.level) : tr`볼 곳`}</em>
                    <b>{s.where.replace(/^.*\//, "")}</b>
                    <span>{s.text}</span>
                  </button>
                ))}
                {brief.found && brief.found.length === 0 && <span className="rv-b-note">{tr`검토 · 다른 모델이 읽었고 짚은 곳이 없다`}</span>}
                {spots.length > 0 && ( // 세션에 치는 말은 번역하지 않는다 i18n-ok
                  <button type="button" tabIndex={-1} className="rv-hand2" onClick={() => (onSay(`[코드 검토] 다른 모델이 변경을 읽고 짚은 곳이다. 하나씩 맞는지 확인하고, 맞으면 고치고 틀리면 왜 틀린지 말해줘.\n\n${spots.map((s) => `- ${s.level || "볼 곳"} · ${s.where}: ${s.text}`).join("\n")}`), setSent((n) => n + 1))}>
                    {tr`짚은 ${spots.length}곳을 세션에 넘겨 확인시키기`}
                  </button>
                )}
                {brief.unverified && <span className="rv-b-note">{tr`확인 안 된 것`} · {brief.unverified}</span>}
              </>
            )}
          </div>
        )}
        {moved && placeAt === 0 && (
          <div className="rv-warn">
            {tr`이 폴더에는 세션이 일하는 동안 밖에서 다른 커밋이 들어왔다(브랜치를 바꿨거나 pull·merge를 했다). 답마다 찍어 둔 기록과 견주면 남의 변경이 섞여서, 지금 폴더에 남은 변경만 보여 준다.`}
            {trees.length > 0 && " " + tr`세션이 워크트리에서 일했다면 위에서 그 워크트리를 고른다.`}
          </div>
        )}
        {ver.key !== "all" && change?.brief && <div className="rv-b-note">{tr`이 판의 브리핑은 없다. 브리핑은 "이 세션이 고친 것" 전체를 읽고 쓴다`}</div>}
        {others.length > 0 && (
          <div className="rv-b-note" title={others.join("\n")}>
            {tr`작업 폴더에 남은 다른 변경 ${others.length}개`} · {others.slice(0, 3).map((p) => p.replace(/^.*\//, "")).join(", ")}
            {others.length > 3 && " …"} · {tr`이 세션이 고친 것이 아니라 여기에 넣지 않았다`}
          </div>
        )}
      </div>
      <div className={"rv-main" + (hist ? "" : " no-hist")}>
        <div className="rv-files">
          {diff === undefined && <div className="side-none">{tr`읽는 중`}</div>}
          {diff === null && <div className="side-none">{tr`git 레포가 아니거나 읽지 못했다`}</div>}
          {diff !== undefined && diff !== null && files.length === 0 && <div className="side-none">{ver.key === "all" ? tr`이 세션이 고친 것이 없다` : tr`이 판에서는 바뀐 것이 없다`}</div>}
          {files.map((f, i) => (
            <button key={f.path} type="button" tabIndex={-1} className={"rv-file" + (i === fileAt ? " on" : "") + (seen.includes(f.path) ? " seen" : "")} onClick={() => setFileAt(i)} title={f.path}>
              <span className="rv-name">
                {f.path.split("/").pop()}
                <small>{f.path.split("/").slice(0, -1).join("/")}</small>
              </span>
              <span className="delta">
                {f.note && <em>{f.note} </em>}
                <b>+{f.adds}</b> <i>−{f.dels}</i>
              </span>
            </button>
          ))}
        </div>
        <div className={"rv-code" + (wrap ? " wrap" : "")} ref={body}>
          {file && (
            <>
              <div className="rv-path">
                <span>
                  {file.path}
                  {file.note && <em> · {file.note}</em>}
                </span>
                <span className="rv-acts">
                  <button type="button" tabIndex={-1} className={"hs-kind" + (whole ? " on" : "")} title={tr`바뀐 곳만 보기와 파일 전체 보기를 오간다 (f)`} onClick={() => setWhole(!whole)}>
                    {whole ? tr`파일 전체` : tr`바뀐 곳만`}
                  </button>
                  <button type="button" tabIndex={-1} className={"hs-kind" + (wrap ? " on" : "")} title={tr`긴 줄을 접어서 보기와 옆으로 밀어 보기를 오간다 (w)`} onClick={() => setWrap(!wrap)}>
                    {wrap ? tr`줄 접음` : tr`줄 안 접음`}
                  </button>
                </span>
              </div>
              {file.hunks.length === 0 && <div className="side-none">{tr`보여 줄 줄이 없다 (${file.note || tr`내용 변경 없음`})`}</div>}
              {file.hunks.map((h, hi) => (
                <div key={hi} className="rv-hunk">
                  {h.head && <div className="rv-head">{h.head}</div>}
                  {h.lines.map((l, li) => {
                    const no = l.newNo ?? l.oldNo ?? 0;
                    const html = paint(l.text, lang);
                    const open = noteAt?.path === file.path && noteAt.no === no && noteAt.text === l.text;
                    return (
                      <div key={li}>
                        <div className={"rv-line " + l.kind + (open ? " open" : "")} onClick={() => (setNoteAt({ path: file.path, no, text: l.text }), setNote(""))} title={tr`눌러서 이 줄에 대해 세션에게 말하기`}>
                          <span className="no">{l.oldNo ?? ""}</span>
                          <span className="no">{l.newNo ?? ""}</span>
                          <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                          {html !== undefined ? <code dangerouslySetInnerHTML={{ __html: html || " " }} /> : <code>{l.text || " "}</code>}
                        </div>
                        {open && (
                          <div className="rv-note">
                            <textarea autoFocus rows={2} value={note} placeholder={tr`이 줄에 대해 세션에게 할 말. Enter로 보낸다 (⇧Enter 줄바꿈, Esc 닫기)`} onChange={(e) => setNote(e.target.value)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
        {hist && (
        <div className="rv-hist">
          <div className="rv-hist-head">{git ? tr`${git.branch} 이력` : tr`이력`}</div>
          {versions
            .filter((v) => v.kind !== "commit")
            .map((v) => (
              <button key={v.key} type="button" tabIndex={-1} className={"rv-node k-" + v.kind + (v.key === ver.key ? " on" : "") + (ver.kind === "all" && v.kind === "turn" ? " in" : "")} title={v.title} onClick={() => setVerKey(v.key)}>
                <i className="dot" aria-hidden="true" />
                <span className="rv-node-text">
                  <span>{v.label}</span>
                  {v.when && <small>{v.when}</small>}
                  {v.kind === "all" && <small>{turns.length ? tr`답 ${turns.length}번에 걸쳐 · 커밋 안 한 파일 ${git?.dirty ?? 0}` : moved && placeAt === 0 ? tr`커밋 안 한 파일 ${git?.dirty ?? 0}` : git && git.branch !== git.default ? tr`${git.default}에서 갈라진 뒤 전부` : tr`안 올린 커밋과 커밋 안 한 파일 ${git?.dirty ?? 0}`}</small>}
                </span>
              </button>
            ))}
          {graph.map((row, index) => {
            const [sha, , subject, at, refs] = row.commit;
            const on = ver.key === "c:" + sha;
            const x = (lane: number) => 9 + lane * 12;
            // 맨 위(이 세션이 고친 것)를 펴 두었으면 거기에 들어 있는 커밋에 띠를 긋는다: 첫 답 뒤에 생긴 커밋, 기록이 없으면 기준에서 갈라진 뒤의 것
            const within = ver.kind === "all" && (turns.length ? at * 1000 >= turns[0].at : !!git?.fork && index < forkAt);
            const marks = labels(refs, git?.default ?? "");
            // 기준 브랜치의 끝이 이 커밋에 없으면(그 뒤로 기준이 더 나아갔으면) 갈라진 곳이라고 따로 적는다
            const forked = !!git?.fork && git.fork === sha && !marks.some((l) => l.name === git.default);
            // 머지 커밋의 제목은 길기만 하다. 무엇이 들어왔는지만 남긴다
            const merged = row.merge ? subject.match(/^Merge (?:remote-tracking )?(?:branch|pull request) '?([^' ]+)'?/)?.[1] : undefined;
            return (
              <button key={sha} type="button" tabIndex={-1} className={"rv-commit" + (on ? " on" : "") + (row.merge ? " merge" : "") + (git?.fork === sha ? " fork" : "") + (within ? " in" : "")} title={`${subject}\n${sha.slice(0, 8)}${refs ? "\n" + refs : ""}`} onClick={() => setVerKey("c:" + sha)}>
                <svg width={x(row.width - 1) + 9} height={ROW} aria-hidden="true">
                  {row.pass.map((lane) => (
                    <line key={"p" + lane} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW} stroke={hue(lane)} strokeWidth="1.6" />
                  ))}
                  {row.top && <line x1={x(row.col)} y1={0} x2={x(row.col)} y2={ROW / 2} stroke={hue(row.col)} strokeWidth="1.6" />}
                  {row.into.map((lane) => (
                    <path key={"i" + lane} d={`M ${x(lane)} 0 C ${x(lane)} ${ROW / 2}, ${x(row.col)} 0, ${x(row.col)} ${ROW / 2}`} fill="none" stroke={hue(lane)} strokeWidth="1.6" />
                  ))}
                  {row.out.map((lane) =>
                    lane === row.col ? (
                      <line key={"o" + lane} x1={x(lane)} y1={ROW / 2} x2={x(lane)} y2={ROW} stroke={hue(lane)} strokeWidth="1.6" />
                    ) : (
                      <path key={"o" + lane} d={`M ${x(row.col)} ${ROW / 2} C ${x(row.col)} ${ROW}, ${x(lane)} ${ROW / 2}, ${x(lane)} ${ROW}`} fill="none" stroke={hue(lane)} strokeWidth="1.6" />
                    ),
                  )}
                  <circle cx={x(row.col)} cy={ROW / 2} r={row.merge ? 3 : 4} fill={row.merge ? "var(--bg)" : hue(row.col)} stroke={hue(row.col)} strokeWidth="1.6" />
                </svg>
                <span className="rv-c-text">{merged ? tr`머지 · ${merged}` : subject}</span>
                {marks.map((l) => (
                  <em key={l.name} className={"k-" + l.kind} title={l.kind === "base" || l.name === git?.default ? tr`기준 브랜치` : undefined}>
                    {l.name}
                  </em>
                ))}
                {forked && (
                  <em className="k-base" title={tr`기준 브랜치 ${git?.default}에서 이 커밋 뒤로 갈라져 나왔다`}>
                    {tr`갈라진 곳`}
                  </em>
                )}
                <small>{at ? ago(at).replace(/ 전$| ago$/, "") : ""}</small>
              </button>
            );
          })}
        </div>
        )}
      </div>
      <Hint text={tr`↑↓ 파일 · ←→ 이력에서 위아래로 · f 파일 전체 · w 줄 접기 · h 이력 · n p 다음/이전 바뀐 곳 · 줄을 누르면 세션에게 말한다 · Esc`} />
    </div>
  );
}
