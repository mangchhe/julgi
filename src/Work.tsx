import Hint from "./Hint";
import { tr } from "./i18n";
import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY, Ticket, TicketWork } from "./jira";
import PrView from "./PrView";
import { ago } from "./model";
import { openUrl } from "@tauri-apps/plugin-opener";
import { prNo, prParts, PrStatus, PrTarget, prUrl, repoName, ReviewAsk } from "./pr";

/** 작업 페이지의 한 줄. PR 하나다 */
export type WorkRow = {
  target: PrTarget;
  title: string;
  /** 줄 아래 작은 글: 작성자, 세션 이름 등 */
  by: string;
  at?: string;
  status?: PrStatus;
  /** 새로 생긴 일 (CI 실패, 새 코멘트 등) */
  news?: string;
  /** 이 PR을 올린 세션. 있으면 s로 그 세션을 연다(잠들었으면 깨운다) */
  sessionId?: string;
  sleeping?: boolean;
  /** 리뷰 요청이면 원래 요청. ⌘Enter로 세션에 맡긴다 */
  ask?: ReviewAsk;
};
export type WorkGroup = { id: string; title: string; hint: string; rows: WorkRow[] };

/** 티켓 묶음: JQL 하나 */
/** Jira의 종류 이름으로 버그인지 본다. 이름은 Jira 언어를 따른다 */
const isBug = (t: Ticket) => /bug|defect|버그|결함|오류|バグ|缺陷/i.test(t.type); // i18n-ok
export type TicketGroup = { id: string; title: string; hint: string; jql: string };

type Props = {
  groups: WorkGroup[];
  /** Jira가 연결돼 있으면 티켓 묶음. 고르면 그 JQL로 읽고, 오른쪽에 ticketPane을 편다 */
  ticketGroups?: TicketGroup[];
  loadTickets?: (jql: string) => Promise<Ticket[]>;
  /** 티켓에 이어진 세션과 PR, 지금 할 일 */
  ticketWork?: (t: Ticket) => TicketWork;
  ticketPane?: (key: string) => ReactNode;
  ticketNews?: Record<string, string>;
  /** 소식이 봇 댓글뿐이라 흐리게 보일 티켓 */
  ticketQuiet?: Set<string>;
  onStartTicket?: (key: string) => void;
  /** 티켓에 이어진 세션으로 간다 (칸의 열쇠) */
  onShowSession?: (key: string) => void;
  /** Jira가 연결돼 있지 않을 때 설정의 연결 묶음을 연다 */
  onConnectJira?: () => void;
  onClose: () => void;
  /** PR과 리뷰 요청을 바로 다시 읽는다 */
  onRefresh: () => void;
  onOpenSession: (sessionId: string) => void;
  onHand: (ask: ReviewAsk) => void;
};

const idOf = (t: PrTarget) => `${t.repo}#${t.number}`;

/**
 * 작업 (⌘U). PR을 묶음별로 한 화면에서 둘러본다: 왼쪽 묶음, 가운데 목록, 오른쪽 PR 화면.
 * ⌘J가 "지금 손댈 것"만 모은다면, 여기는 "전부 둘러보기"다. Jira를 붙이면 티켓 묶음이 같은 자리에 들어온다
 */
export default function Work({ groups, ticketGroups = [], loadTickets, ticketPane, ticketNews = {}, ticketQuiet, ticketWork, onStartTicket, onShowSession, onConnectJira, onClose, onRefresh, onOpenSession, onHand }: Props) {
  const allCount = groups.length + ticketGroups.length;
  // 새 소식이 있는 묶음부터 연다
  const [groupAt, setGroupAt] = useState(() => Math.max(0, groups.findIndex((g) => g.rows.some((r) => r.news))));
  const tgroup = groupAt >= groups.length ? ticketGroups[groupAt - groups.length] : undefined;
  const group = tgroup ? undefined : groups[Math.min(groupAt, groups.length - 1)];
  const [picked, setPicked] = useState<string | null>(null);
  // 티켓 묶음은 고를 때 읽는다(묶음마다 한 번, r로 다시)
  const [ticketRows, setTicketRows] = useState<Record<string, Ticket[] | string>>({});
  const [ticketLoads, setTicketLoads] = useState(0);
  useEffect(() => {
    if (!tgroup || !loadTickets || (ticketRows[tgroup.id] && !ticketLoads)) return;
    const id = tgroup.id;
    void loadTickets(tgroup.jql).then(
      (list) => setTicketRows((old) => ({ ...old, [id]: list })),
      (e) => setTicketRows((old) => ({ ...old, [id]: String(e) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tgroup?.id, ticketLoads]);
  // 열자마자 티켓 묶음을 전부 읽어 둔다. 눌러야 읽으면 왼쪽에 개수가 안 보이고, 새 소식이 있는 묶음도 알 수 없다
  useEffect(() => {
    if (!loadTickets) return;
    for (const g of ticketGroups)
      void loadTickets(g.jql).then(
        (list) => setTicketRows((old) => (old[g.id] ? old : { ...old, [g.id]: list })),
        (why) => setTicketRows((old) => (old[g.id] ? old : { ...old, [g.id]: String(why) })),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketGroups.length]);
  const tickets = tgroup ? ticketRows[tgroup.id] : undefined;
  // 티켓마다 지금 할 일을 붙이고, 내가 손댈 것이 위로 오게 세운다. 같은 차례 안에서는 Jira가 준 순서 그대로
  const works = useMemo(() => new Map((Array.isArray(tickets) ? tickets : []).map((t) => [t.key, ticketWork?.(t)])), [tickets, ticketWork]);
  const tlist = useMemo(() => (Array.isArray(tickets) ? tickets.map((t, i) => ({ t, i })).sort((a, b) => Number(isBug(b.t)) - Number(isBug(a.t)) || (works.get(a.t.key)?.rank ?? 9) - (works.get(b.t.key)?.rank ?? 9) || a.i - b.i).map((x) => x.t) : []), [tickets, works]);
  const mixed = tlist.some(isBug) && !tlist.every(isBug);
  const rows = group?.rows ?? [];
  const at = tgroup ? Math.max(0, tlist.findIndex((t) => t.key === picked)) : Math.max(0, rows.findIndex((r) => idOf(r.target) === picked));
  const row = tgroup ? undefined : rows[at];
  const ticket = tgroup ? tlist[at] : undefined;
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void list.current?.querySelector(".wk-row.on")?.scrollIntoView({ block: "nearest" }), [at, groupAt]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);
  const count = tgroup ? tlist.length : rows.length;

  const pick = (i: number) => {
    if (tgroup) return tlist[i] && setPicked(tlist[i].key);
    if (rows[i]) setPicked(idOf(rows[i].target));
  };
  const switchGroup = (n: number) => {
    setGroupAt(n);
    setTicketLoads(0);
    setPicked(n < groups.length && groups[n]?.rows[0] ? idOf(groups[n].rows[0].target) : null);
  };
  /** 오른쪽 PR 화면으로 키를 넘긴다 */
  const enterPr = () => (document.querySelector<HTMLElement>(".pr-inline .rv") ?? null)?.focus();

  const onKey = (e: React.KeyboardEvent) => {
    // 오른쪽 PR 화면 안의 키는 그 화면이 받는다. Esc만 목록으로 돌아오게 PrView가 onClose를 부른다
    if ((e.target as Element).closest(".pr-inline")) return;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "j") pick(Math.min(count - 1, at + 1));
    else if (e.key === "ArrowUp" || e.key === "k") pick(Math.max(0, at - 1));
    else if (e.key === "Tab") switchGroup((groupAt + (e.shiftKey ? allCount - 1 : 1)) % allCount);
    else if (e.key === "Enter" && e.metaKey && row?.ask) onHand(row.ask);
    else if (e.key === "Enter" && e.metaKey && ticket) onStartTicket?.(ticket.key);
    else if (e.key === "Enter" || e.key === "ArrowRight") enterPr();
    else if (e.key === "s" && row?.sessionId) onOpenSession(row.sessionId);
    else if (e.key === "s" && ticket && works.get(ticket.key)?.session) onShowSession?.(works.get(ticket.key)!.session!);
    // 숫자: 왼쪽 묶음으로 바로. o: 브라우저에서 열기
    else if (/^[1-9]$/.test(e.key) && !e.metaKey && Number(e.key) <= allCount) switchGroup(Number(e.key) - 1);
    else if (e.key === "o" && ticket) void openUrl(ticket.url);
    else if (e.key === "o" && row) void openUrl(prUrl(row.target));
    else if (e.key === "r") (tgroup ? setTicketLoads((n) => n + 1) : onRefresh());
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="wk" ref={box} tabIndex={-1} onKeyDown={onKey}>
      <nav className="wk-nav">
        <div className="wk-title">{tr`작업`}</div>
        <div className="wk-sec">PR</div>
        {groups.map((g, n) => (
          <button key={g.id} type="button" tabIndex={-1} className={"wk-grp" + (n === groupAt ? " on" : "") + (g.rows.some((r) => r.news) ? " hot" : "")} onClick={() => switchGroup(n)} title={g.hint}>
            <span>
              <kbd>{n + 1}</kbd>
              {g.title}
            </span>
            <b>{g.rows.length}</b>
          </button>
        ))}
        <div className="wk-sec">{tr`티켓`}</div>
        {!ticketGroups.length && (
          <div className="wk-soon">
            {tr`Jira를 연결하면 진행 중, 할 일, 이번 스프린트, 내가 보고한 것이 여기 온다`}
            {onConnectJira && (
              <button type="button" tabIndex={-1} className="wk-connect" onClick={onConnectJira}>
                {tr`Jira 연결하기`}
              </button>
            )}
          </div>
        )}
        {ticketGroups.map((g, n) => {
          const list = ticketRows[g.id];
          const hot = Array.isArray(list) && list.some((t) => ticketNews[t.key] && !ticketQuiet?.has(t.key));
          return (
            <button key={g.id} type="button" tabIndex={-1} className={"wk-grp" + (groups.length + n === groupAt ? " on" : "") + (hot ? " hot" : "")} onClick={() => switchGroup(groups.length + n)} title={g.jql}>
              <span>
                <kbd>{groups.length + n + 1}</kbd>
                {g.title}
              </span>
              <b>{Array.isArray(list) ? list.length : ""}</b>
            </button>
          );
        })}
        <div className="wk-navfoot">
          <button type="button" tabIndex={-1} onClick={onRefresh} title={tr`PR과 리뷰 요청을 바로 다시 읽는다 (r)`}>
            {tr`새로 읽기`}
          </button>
        </div>
      </nav>
      <div className="wk-list" ref={list}>
        <div className="wk-head">
          <b>{(tgroup ?? group)?.title}</b>
          <small>{(tgroup ?? group)?.hint}</small>
        </div>
        {tgroup && tickets === undefined && <div className="side-none">{tr`읽는 중`}</div>}
        {tgroup && typeof tickets === "string" && <div className="side-none">{tickets}</div>}
        {tgroup && Array.isArray(tickets) && !tickets.length && <div className="side-none">{tr`이 묶음은 비었다`}</div>}
        {tlist.map((t, i) => (
          <Fragment key={t.key}>
          {/* 버그와 나머지를 나눠 세운다. 둘 다 있을 때만 머리글을 단다 */}
          {mixed && (i === 0 || isBug(t) !== isBug(tlist[i - 1])) && <div className="wk-sec">{isBug(t) ? tr`버그` : tr`기능·작업`} <small>{tlist.filter((x) => isBug(x) === isBug(t)).length}</small></div>}
          <button type="button" tabIndex={-1} className={"wk-row" + (i === at ? " on" : "")} onClick={() => pick(i)} onDoubleClick={enterPr}>
            <span className="wk-row-title">
              {t.type && <span className={"wk-type" + (isBug(t) ? " bug" : "")}>{t.type}</span>}
              <em>{t.key}</em> {t.title}
            </span>
            {works.get(t.key) && (
              <span className={"wk-step r" + works.get(t.key)!.rank}>
                <b>{works.get(t.key)!.step}</b>
                {works.get(t.key)!.detail && ` · ${works.get(t.key)!.detail}`}
                {works.get(t.key)!.sessionName && works.get(t.key)!.rank !== 4 && <i> · {works.get(t.key)!.sessionName}</i>}
              </span>
            )}
            <span className="wk-row-meta">
              {ticketNews[t.key] && (ticketQuiet?.has(t.key) ? <span className="faint">{ticketNews[t.key]} · </span> : <b className="loud">{ticketNews[t.key]} · </b>)}
              {CATEGORY[t.statusCategory] ? `${t.status}` : t.status}
              {t.priority && ` · ${t.priority}`}
              {` · ${t.assignee || tr`담당 없음`}`}
              {t.updated && ` · ${ago(Date.parse(t.updated) / 1000)}`}
            </span>
          </button>
          </Fragment>
        ))}
        {!tgroup && !rows.length && <div className="side-none">{total ? tr`이 묶음은 비었다` : tr`챙기는 PR이 없다. ⌘,의 연결에서 GitHub를 연결하고 챙길 범위를 고른다`}</div>}
        {rows.map((r, i) => (
          <button key={idOf(r.target)} type="button" tabIndex={-1} className={"wk-row" + (i === at ? " on" : "")} onClick={() => pick(i)} onDoubleClick={enterPr}>
            <span className="wk-row-title">
              <em>{prNo(r.target)}</em> {r.title}
            </span>
            <span className="wk-row-meta">
              {r.news && <b className="loud">{r.news} · </b>}
              {r.status &&
                prParts(r.status).map(([text, loud]) => (
                  <span key={text} className={loud ? "loud" : ""}>
                    {text} ·{" "}
                  </span>
                ))}
              {repoName(r.target.repo)}
              {r.by && ` · ${r.by}`}
              {r.sleeping && ` · ${tr`잠듦`}`}
              {r.at && ` · ${ago(Date.parse(r.at) / 1000)}`}
            </span>
          </button>
        ))}
      </div>
      <div className="wk-main">
        {row ? (
          <PrView key={idOf(row.target)} target={row.target} inline autoFocus={false} onClose={() => box.current?.focus()} />
        ) : ticket && ticketPane ? (
          ticketPane(ticket.key)
        ) : (
          <div className="wk-empty">{tgroup ? tr`왼쪽에서 티켓을 고른다` : tr`왼쪽에서 PR을 고른다`}</div>
        )}
      </div>
      <Hint
        className="wk-foot"
        text={[
          tgroup ? tr`1–9·Tab 묶음 · ↑↓ 고르기 · Enter·→ 티켓 화면으로 (Esc로 목록에 돌아옴)` : tr`1–9·Tab 묶음 · ↑↓ 고르기 · Enter·→ PR 화면으로 (Esc로 목록에 돌아옴)`,
          row?.sessionId ? tr`s 세션 열기` : "",
          row?.ask ? tr`⌘Enter 세션에 리뷰 맡기기` : "",
          ticket && works.get(ticket.key)?.session ? tr`s 이어진 세션으로` : "",
          ticket ? tr`⌘Enter 이 티켓으로 시작` : "",
          tr`o 브라우저에서 열기 · r 새로 읽기 · Esc 닫기`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    </div>
  );
}
