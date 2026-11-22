import { useEffect, useMemo, useRef, useState } from "react";
import { ago, linkLabel, Open, repoOf, Session } from "./model";
import { prOf } from "./pr";

export type Pick =
  | { kind: "open"; key: string }
  | { kind: "session"; session: Session }
  | { kind: "new"; cwd: string }
  | { kind: "link"; url: string }
  /** 지금 칸의 레포에서 이 번호의 PR을 연다 */
  | { kind: "pr"; number: number };

type Row = { pick: Pick; title: string; meta: string; isNew?: boolean; isLink?: boolean; session?: Session };

/** 이 낱말을 치면 세션이 아니라 세션이 남긴 산출물(링크)을 찾는다 */
const LINK_WORDS: [RegExp, RegExp][] = [
  [/아티팩트|artifact/i, /claude\.ai\/artifact\//],
  [/\b(mr|pr)\b|머지|merge|풀리퀘/i, /\/(pull|merge_requests)\/\d+/],
  [/이슈|issue|티켓|ticket|jira|지라/i, /\/issues\/\d+|\/browse\/[A-Z][A-Z0-9]+-\d+/],
  [/링크|산출물|link/i, /./],
];

type Props = {
  open: Open[];
  sessions: Session[];
  byId: Map<string, Session>;
  /** 지금 칸의 폴더. 새 세션의 기본 위치 */
  cwd: string;
  onPick: (pick: Pick) => void;
  /** 고른 세션의 요약만 지금 세션에 붙인다 */
  onAttach: (session: Session) => void;
  /** 고른 세션을 지금 세션과 한 줄기로 묶는다 */
  onJoin: (sessionId: string) => void;
  onClose: () => void;
};

const MAX_SESSIONS = 40;

export default function Palette({ open, sessions, byId, cwd, onPick, onAttach, onJoin, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  // 찾기와 새 세션은 같은 상자다. 하던 세션이 먼저 나오고, 새로 열기는 맨 아래다.
  const rows = useMemo<Row[]>(() => {
    // "아티팩트 환불"처럼 치면 산출물만 찾는다: 종류를 가리키는 낱말은 떼고 나머지로 세션을 찾아, 그 세션이 남긴 링크를 낸다
    const wanted = LINK_WORDS.filter(([word]) => word.test(query));
    const q = wanted.reduce((text, [word]) => text.replace(new RegExp(word.source, "gi"), " "), query).replace(/\s+/g, " ").trim().toLowerCase();
    if (wanted.length) {
      const links: Row[] = [];
      for (const s of sessions) {
        if (links.length >= 40) break;
        if (q && !`${s.title} ${s.said} ${s.group} ${s.repo} ${s.branch} ${s.recap}`.toLowerCase().includes(q)) continue;
        for (const url of s.links) if (wanted.some(([, kind]) => kind.test(url))) links.push({ pick: { kind: "link", url }, title: linkLabel(url), meta: `${s.title.slice(0, 44)} · ${s.repo} · ${ago(s.mtime)}`, isLink: true, session: s });
      }
      return links;
    }
    const has = (...parts: (string | undefined)[]) => parts.join(" ").toLowerCase().includes(q);
    const out: Row[] = [];
    // "#1465"를 치면 맨 위에 그 PR 보기를 낸다 (지금 칸의 레포에서)
    const prNo = query.trim().match(/^#(\d+)$/)?.[1];
    if (prNo) out.push({ pick: { kind: "pr", number: Number(prNo) }, title: `PR #${prNo} 보기`, meta: `${repoOf(cwd)} · Julgi 안에서`, isLink: true });
    const weak: Row[] = []; // 제목이 아니라 요약에서만 걸린 것은 뒤로 보낸다
    const openIds = new Set<string>();
    for (const o of open) {
      const s = o.sessionId ? byId.get(o.sessionId) : undefined;
      if (o.sessionId) openIds.add(o.sessionId);
      const row: Row = { pick: { kind: "open", key: o.key }, title: s?.title ?? o.label, meta: `열림 · ${s?.repo ?? repoOf(o.cwd)}`, session: s };
      if (!q || has(s?.title ?? o.label, s?.said, s?.group, s?.repo, s?.branch)) out.push(row);
      else if (has(s?.recap)) weak.push(row);
    }
    let count = 0;
    for (const s of sessions) {
      if (count >= MAX_SESSIONS) break;
      if (openIds.has(s.id)) continue;
      const strong = !q || has(s.title, s.said, s.group, s.repo, s.branch);
      if (!strong && !has(s.recap)) continue;
      count++;
      (strong ? out : weak).push({
        pick: { kind: "session", session: s },
        title: s.title,
        meta: [s.work ? s.work.key : "", s.repo, s.branch, ago(s.mtime)].filter(Boolean).join(" · "),
        session: s,
      });
      // 찾는 말이 있으면 그 세션이 남긴 산출물도 바로 아래에 낸다. 세션을 열지 않고 링크로 간다
      if (q && strong) for (const url of s.links.slice(-3)) out.push({ pick: { kind: "link", url }, title: `↳ ${linkLabel(url)}`, meta: prOf(url) ? "PR 보기" : "브라우저로 열기", isLink: true, session: s });
    }
    out.push(...weak);
    // 새 세션을 열 위치: 이름이 맞는 프로젝트가 있으면 그 폴더들, 없으면 지금 폴더
    const folders: string[] = [];
    if (q) {
      for (const s of sessions) {
        if (folders.length >= 3) break;
        if (s.repo.toLowerCase().includes(q) && !folders.includes(s.cwd)) folders.push(s.cwd);
      }
    }
    if (!folders.length) folders.push(cwd);
    for (const folder of folders)
      out.push({ pick: { kind: "new", cwd: folder }, title: `+ 새 세션 · ${repoOf(folder)}`, meta: folder.replace(/^\/Users\/[^/]+/, "~"), isNew: true });
    return out;
  }, [query, open, sessions, byId, cwd]);

  const at = Math.min(sel, rows.length - 1);
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") onClose();
    // 맨 위에서 위로 가면 맨 아래의 새 세션으로 넘어간다
    else if (e.key === "ArrowDown") setSel((at + 1) % rows.length);
    else if (e.key === "ArrowUp") setSel((at - 1 + rows.length) % rows.length);
    else if (e.key === "Enter" && e.altKey) {
      const pick = rows[at]?.pick;
      const id = pick?.kind === "session" ? pick.session.id : pick?.kind === "open" && pick.key.startsWith("c:") ? pick.key.slice(2) : "";
      if (id) onJoin(id);
    } else if (e.key === "Enter" && rows[at]) onPick(rows[at].pick);
    else if (e.key === "Tab") {
      const pick = rows[at]?.pick;
      const session = pick?.kind === "session" ? pick.session : pick?.kind === "open" ? byId.get(pick.key.slice(2)) : undefined;
      if (session) onAttach(session);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          placeholder={'이름을 친다. 하던 세션이 먼저 나온다 · "아티팩트", "MR"을 넣으면 산출물을 찾는다'}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        <div className="pal-list" ref={list}>
          {rows.map((row, i) => (
            <div key={i} className={"pal-item" + (i === at ? " on" : "")} onMouseEnter={() => setSel(i)} onClick={() => onPick(row.pick)}>
              <span className={row.isNew ? "pal-new" : row.isLink ? "pal-link" : ""}>{row.title}</span>
              <span className="pal-meta">{row.meta}</span>
            </div>
          ))}
        </div>
        {rows[at]?.session && (
          <div className="pal-peek">
            {rows[at].session!.recap || "요약이 아직 없다"}
            {rows[at].session!.links.length > 0 && <span> · 링크 {rows[at].session!.links.length}개</span>}
          </div>
        )}
        <div className="pal-foot">Enter 열기 (↳ 산출물은 브라우저로) · Tab 요약만 붙이기 · ⌥Enter 지금 세션과 한 줄기로 · ↑ 새 세션 · Esc</div>
      </div>
    </div>
  );
}
