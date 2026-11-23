import Hint from "./Hint";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, linkLabel, Open, repoOf, Session } from "./model";
import { invoke } from "@tauri-apps/api/core";
import { prNo, prOf, repoName, ReviewAsk } from "./pr";
import { CATEGORY, JiraConn, Ticket } from "./jira";
import { tr } from "./i18n";

export type Pick =
  | { kind: "open"; key: string }
  | { kind: "session"; session: Session }
  | { kind: "new"; cwd: string }
  /** 그 폴더에서 셸(터미널)을 연다 */
  | { kind: "shell"; cwd: string }
  | { kind: "link"; url: string }
  /** 이 번호의 PR을 연다. repo가 없으면 지금 칸의 레포에서 */
  | { kind: "pr"; number: number; repo?: string }
  /** 티켓 화면을 연다 */
  | { kind: "ticket"; key: string };

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
  /** 지도에 있는 레포들. 세션이 한 번도 없던 레포에서도 새 세션과 셸을 열 수 있게 한다 */
  repos?: { repo: string; cwd: string }[];
  onPick: (pick: Pick) => void;
  /** 고른 세션의 요약만 지금 세션에 붙인다 */
  onAttach: (session: Session) => void;
  /** 고른 세션을 지금 세션과 한 줄기로 묶는다 */
  onJoin: (sessionId: string) => void;
  onClose: () => void;
  /** 나한테 온 리뷰 요청과 내 PR. "pr"을 치면 지금 칸 레포의 열린 PR과 함께 고를 거리로 낸다 */
  asks: ReviewAsk[];
  mine: ReviewAsk[];
  /** Jira 연결 (없으면 null)과 내 티켓. "jira"를 치면 고를 거리가 된다 */
  jira: JiraConn | null;
  tickets: Ticket[];
};

/** ⌘K에서 고를 PR 하나 */
type PrRow = { repo: string; number: number; title: string; author: string; branch: string; tag: string; draft: boolean; at: string };

const MAX_SESSIONS = 40;

export default function Palette({ open, sessions, byId, cwd, repos = [], onPick, onAttach, onJoin, onClose, asks, mine, jira, tickets }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);
  // 지금 칸의 레포가 GitHub에 있으면 열린 PR을 미리 받아 둔다. pr을 쳤을 때 번호를 몰라도 고를 수 있게
  const [repoPrs, setRepoPrs] = useState<PrRow[]>([]);
  useEffect(() => {
    void invoke<string | null>("repo_slug", { path: cwd }).then(async (repo) => {
      if (!repo) return;
      const text = await invoke<string>("pr_list", { repo }).catch(() => "");
      const list = text ? (JSON.parse(text) as { number: number; title: string; author: { login: string }; headRefName: string; isDraft: boolean; updatedAt: string }[]) : [];
      setRepoPrs(list.map((p) => ({ repo, number: p.number, title: p.title, author: p.author.login, branch: p.headRefName, tag: "", draft: p.isDraft, at: p.updatedAt })));
    });
  }, [cwd]);
  // "jira 글"을 치면 Jira 전체에서도 찾는다 (치는 동안은 기다렸다가)
  const jiraQuery = query.trim().match(/^(?:jira|티켓)\b\s*(.*)$/i);
  const jiraText = jiraQuery?.[1].trim() ?? "";
  const [hits, setHits] = useState<Ticket[]>([]);
  useEffect(() => {
    setHits([]);
    if (!jira || jiraText.length < 2 || /^[A-Z][A-Z0-9_]+-\d+$/i.test(jiraText)) return;
    const timer = setTimeout(() => {
      const safe = jiraText.replace(/["\\]/g, " ");
      void invoke<Ticket[]>("jira_search", { conn: jira, jql: `text ~ "${safe}" ORDER BY updated DESC`, limit: 20 }).then(setHits, () => setHits([]));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jiraText, !!jira]);
  // 리뷰 요청 → 내 PR → 이 레포의 나머지. 같은 PR은 한 번만
  const prs = useMemo(() => {
    const out: PrRow[] = [];
    const add = (p: PrRow) => out.some((x) => x.repo === p.repo && x.number === p.number) || out.push(p);
    for (const a of asks) add({ repo: a.repository.nameWithOwner, number: a.number, title: a.title, author: a.author.login, branch: "", tag: "리뷰 요청", draft: a.isDraft, at: a.updatedAt }); // i18n-ok
    for (const m of mine) add({ repo: m.repository.nameWithOwner, number: m.number, title: m.title, author: m.author.login, branch: "", tag: "내 PR", draft: m.isDraft, at: m.updatedAt }); // i18n-ok
    for (const p of repoPrs) add(p);
    return out;
  }, [asks, mine, repoPrs]);

  // 찾기와 새 세션은 같은 상자다. 하던 세션이 먼저 나오고, 새로 열기는 맨 아래다.
  const rows = useMemo<Row[]>(() => {
    // "jira" 또는 "티켓"으로 시작하면 티켓만 찾는다: 키를 쳤으면 그 티켓, 내 티켓(진행 중 → 할 일), Jira 전체 검색 결과
    if (jiraQuery) {
      if (!jira) return [{ pick: { kind: "ticket", key: "" }, title: tr`Jira에 연결돼 있지 않다`, meta: tr`⌘,의 연결에서 연결한다`, isLink: true }];
      const out: Row[] = [];
      const key = jiraText.toUpperCase();
      if (/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) out.push({ pick: { kind: "ticket", key }, title: tr`${key} 보기`, meta: tr`티켓 화면`, isLink: true });
      const low = jiraText.toLowerCase();
      const fit = (t: Ticket) => !low || t.key.toLowerCase().startsWith(low) || t.title.toLowerCase().includes(low);
      const rank = (t: Ticket) => (t.statusCategory === "indeterminate" ? 0 : t.statusCategory === "new" ? 1 : 2);
      const seen = new Set<string>();
      for (const t of tickets.filter(fit).sort((a, b) => rank(a) - rank(b))) {
        seen.add(t.key);
        out.push({ pick: { kind: "ticket", key: t.key }, title: `${t.key} ${t.title}`, meta: [CATEGORY[t.statusCategory] ? tr(CATEGORY[t.statusCategory]) : t.status, t.status, t.type, t.priority].filter(Boolean).join(" · "), isLink: true });
      }
      for (const t of hits.filter((h) => !seen.has(h.key))) out.push({ pick: { kind: "ticket", key: t.key }, title: `${t.key} ${t.title}`, meta: [tr`검색`, t.status, t.assignee || tr`담당 없음`].join(" · "), isLink: true });
      if (!out.length) out.push({ pick: { kind: "ticket", key: "" }, title: jiraText.length >= 2 ? tr`찾는 중이거나 맞는 티켓이 없다` : tr`내게 배정된 티켓이 없다`, meta: tr`jira 뒤에 키나 낱말을 친다`, isLink: true });
      return out;
    }
    // "pr"이나 "#"으로 시작하면 PR만 찾는다. 뒤에 붙인 글로 번호 앞자리나 제목·브랜치를 거른다
    const prQuery = query.trim().match(/^(?:pr\b|#)\s*(.*)$/i);
    if (prQuery) {
      const prRows: Row[] = [];
      const rest = prQuery[1].replace(/^#/, "").trim().toLowerCase();
      const numeric = /^\d+$/.test(rest);
      const fits = (number: number, text: string) => !rest || (numeric ? String(number).startsWith(rest) : text.toLowerCase().includes(rest));
      // 열린 PR: 리뷰 요청 → 내 PR → 이 레포의 나머지, 묶음 안에서는 번호가 큰(최근) 것부터
      const group = (p: PrRow) => (p.tag === "리뷰 요청" ? 0 : p.tag === "내 PR" ? 1 : 2); // i18n-ok
      const hits = prs.filter((p) => fits(p.number, `${p.title} ${p.branch} ${p.author}`)).sort((a, b) => group(a) - group(b) || b.number - a.number);
      for (const p of hits.slice(0, 30))
        prRows.push({
          pick: { kind: "pr", number: p.number, repo: p.repo },
          title: `${prNo({ repo: p.repo, number: p.number })} ${p.title}`,
          meta: [p.tag && tr(p.tag), p.draft ? tr`초안` : "", repoName(p.repo), p.author, p.branch].filter(Boolean).join(" · "),
          isLink: true,
        });
      // 목록에 없는 번호(닫힌 옛 PR 등)를 정확히 쳤으면 그 번호로 바로 연다
      if (/^\d+$/.test(rest) && !hits.some((p) => String(p.number) === rest)) prRows.push({ pick: { kind: "pr", number: Number(rest) }, title: tr`PR #${rest} 보기`, meta: `${repoOf(cwd)} · ${tr`열린 PR 목록에 없는 번호`}`, isLink: true });
      // 세션이 남긴 PR 링크 (닫히거나 머지된 것도). 열린 목록에 이미 있는 것은 빼고, 같은 PR은 한 번, 번호가 큰 것부터
      const seen = new Set(hits.map((p) => `${p.repo}#${p.number}`));
      const left: { url: string; repo: string; number: number; s: Session }[] = [];
      for (const s of sessions)
        for (const url of s.links) {
          const pr = prOf(url);
          const id = pr && `${pr.repo}#${pr.number}`;
          if (!pr || seen.has(id!) || !fits(pr.number, `${s.title} ${s.repo}`)) continue;
          seen.add(id!);
          left.push({ url, ...pr, s });
        }
      left.sort((a, b) => b.number - a.number);
      for (const l of left.slice(0, 30)) prRows.push({ pick: { kind: "pr", number: l.number, repo: l.repo }, title: `${repoName(l.repo)} PR ${prNo(l)}`, meta: `${tr`세션이 남긴 PR`} · ${l.s.title.slice(0, 40)} · ${ago(l.s.mtime)}`, isLink: true, session: l.s });
      if (!prRows.length) prRows.push({ pick: { kind: "pr", number: 0 }, title: prs.length ? tr`맞는 PR이 없다` : tr`열린 PR이 없거나 아직 읽는 중`, meta: tr`pr 뒤에 번호나 제목을 친다`, isLink: true });
      return prRows;
    }
    // "sh 이름"(또는 셸, 터미널)으로 시작하면 레포만 찾아 그 폴더의 셸을 연다. 이름을 안 치면 지금 폴더가 맨 위다
    const shQuery = query.match(/^(?:sh|셸|쉘|터미널)(?:\s+(.*))?$/i);
    if (shQuery) {
      const want = (shQuery[1] ?? "").trim().toLowerCase();
      const dirs = new Map<string, string>(); // 레포 이름 → 폴더. 지도의 본 폴더가 먼저고, 세션의 워크트리는 그다음이다
      if (!want) dirs.set(repoOf(cwd), cwd);
      for (const r of repos) if (!dirs.has(r.repo)) dirs.set(r.repo, r.cwd);
      for (const s of sessions) if (!dirs.has(s.repo)) dirs.set(s.repo, s.cwd);
      const hit = [...dirs].filter(([name]) => !want || name.toLowerCase().includes(want));
      // 이름이 찾는 말로 시작하는 것을 앞에
      hit.sort((a, b) => Number(b[0].toLowerCase().startsWith(want)) - Number(a[0].toLowerCase().startsWith(want)));
      const rows: Row[] = hit.slice(0, 30).map(([name, dir]) => ({ pick: { kind: "shell", cwd: dir }, title: tr`+ 셸 · ${name}`, meta: dir.replace(/^\/Users\/[^/]+/, "~"), isNew: true }));
      if (!rows.length) rows.push({ pick: { kind: "shell", cwd }, title: tr`맞는 레포가 없다. Enter를 누르면 지금 폴더에서 연다`, meta: cwd.replace(/^\/Users\/[^/]+/, "~"), isNew: true });
      return rows;
    }
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
    const weak: Row[] = []; // 제목이 아니라 요약에서만 걸린 것은 뒤로 보낸다
    const openIds = new Set<string>();
    for (const o of open) {
      const s = o.sessionId ? byId.get(o.sessionId) : undefined;
      if (o.sessionId) openIds.add(o.sessionId);
      const row: Row = { pick: { kind: "open", key: o.key }, title: s?.title ?? o.label, meta: `${tr`열림`} · ${s?.repo ?? repoOf(o.cwd)}`, session: s };
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
      if (q && strong) for (const url of s.links.slice(-3)) out.push({ pick: { kind: "link", url }, title: `↳ ${linkLabel(url)}`, meta: prOf(url) ? tr`PR 보기` : tr`브라우저로 열기`, isLink: true, session: s });
    }
    out.push(...weak);
    // 새 세션을 열 위치: 이름이 맞는 프로젝트가 있으면 그 폴더들, 없으면 지금 폴더
    const folders: string[] = [];
    // 지도의 본 폴더가 먼저다. 같은 레포의 워크트리가 여러 줄로 나오지 않게 레포마다 하나만 둔다
    if (q) for (const r of repos) if (folders.length < 3 && r.repo.toLowerCase().includes(q) && !folders.some((f) => repoOf(f) === r.repo)) folders.push(r.cwd);
    if (q) for (const s of sessions) if (folders.length < 3 && s.repo.toLowerCase().includes(q) && !folders.some((f) => repoOf(f) === s.repo)) folders.push(s.cwd);
    if (!folders.length) folders.push(cwd);
    // 셸도 같은 자리에서 연다. 레포 이름을 치면 그 레포의 터미널이 바로 열린다
    for (const folder of folders) out.push({ pick: { kind: "shell", cwd: folder }, title: tr`+ 셸 · ${repoOf(folder)}`, meta: folder.replace(/^\/Users\/[^/]+/, "~"), isNew: true });
    for (const folder of folders)
      out.push({ pick: { kind: "new", cwd: folder }, title: tr`+ 새 세션 · ${repoOf(folder)}`, meta: folder.replace(/^\/Users\/[^/]+/, "~"), isNew: true });
    return out;
  }, [query, open, sessions, byId, cwd, prs, tickets, hits, !!jira]);

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
          placeholder={tr`이름을 친다. 하던 세션이 먼저 나온다 · "sh 레포"는 그 레포의 셸 · "pr", "jira"는 PR과 티켓`}
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
            {rows[at].session!.recap || tr`요약이 아직 없다`}
            {rows[at].session!.links.length > 0 && <span> · {tr`링크 ${rows[at].session!.links.length}개`}</span>}
          </div>
        )}
        <Hint text={tr`Enter 열기 (↳ 산출물은 브라우저로) · Tab 요약만 붙이기 · ⌥Enter 지금 세션과 한 줄기로 · ↑ 새 세션 · Esc`} />
      </div>
    </div>
  );
}
