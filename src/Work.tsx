import { useEffect, useMemo, useRef, useState } from "react";
import PrView from "./PrView";
import { ago } from "./model";
import { prParts, PrStatus, PrTarget, ReviewAsk } from "./pr";

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

type Props = {
  groups: WorkGroup[];
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
export default function Work({ groups, onClose, onRefresh, onOpenSession, onHand }: Props) {
  // 새 소식이 있는 묶음부터 연다
  const [groupAt, setGroupAt] = useState(() => Math.max(0, groups.findIndex((g) => g.rows.some((r) => r.news))));
  const group = groups[Math.min(groupAt, groups.length - 1)];
  const [picked, setPicked] = useState<string | null>(null);
  const rows = group?.rows ?? [];
  const at = Math.max(0, rows.findIndex((r) => idOf(r.target) === picked));
  const row = rows[at];
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void list.current?.querySelector(".wk-row.on")?.scrollIntoView({ block: "nearest" }), [at, groupAt]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);

  const pick = (i: number) => rows[i] && setPicked(idOf(rows[i].target));
  const switchGroup = (n: number) => {
    setGroupAt(n);
    setPicked(groups[n]?.rows[0] ? idOf(groups[n].rows[0].target) : null);
  };
  /** 오른쪽 PR 화면으로 키를 넘긴다 */
  const enterPr = () => (document.querySelector<HTMLElement>(".pr-inline .rv") ?? null)?.focus();

  const onKey = (e: React.KeyboardEvent) => {
    // 오른쪽 PR 화면 안의 키는 그 화면이 받는다. Esc만 목록으로 돌아오게 PrView가 onClose를 부른다
    if ((e.target as Element).closest(".pr-inline")) return;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "j") pick(Math.min(rows.length - 1, at + 1));
    else if (e.key === "ArrowUp" || e.key === "k") pick(Math.max(0, at - 1));
    else if (e.key === "Tab") switchGroup((groupAt + (e.shiftKey ? groups.length - 1 : 1)) % groups.length);
    else if (e.key === "Enter" && e.metaKey && row?.ask) onHand(row.ask);
    else if (e.key === "Enter" || e.key === "ArrowRight") enterPr();
    else if (e.key === "s" && row?.sessionId) onOpenSession(row.sessionId);
    else if (e.key === "r") onRefresh();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="wk" ref={box} tabIndex={-1} onKeyDown={onKey}>
      <nav className="wk-nav">
        <div className="wk-title">작업</div>
        <div className="wk-sec">PR</div>
        {groups.map((g, n) => (
          <button key={g.id} type="button" tabIndex={-1} className={"wk-grp" + (n === groupAt ? " on" : "") + (g.rows.some((r) => r.news) ? " hot" : "")} onClick={() => switchGroup(n)} title={g.hint}>
            <span>{g.title}</span>
            <b>{g.rows.length}</b>
          </button>
        ))}
        <div className="wk-sec">티켓</div>
        <div className="wk-soon">Jira를 붙이면 내 티켓, 진행 중, 스프린트가 여기 온다</div>
        <div className="wk-navfoot">
          <button type="button" tabIndex={-1} onClick={onRefresh} title="PR과 리뷰 요청을 바로 다시 읽는다 (r)">
            새로 읽기
          </button>
        </div>
      </nav>
      <div className="wk-list" ref={list}>
        <div className="wk-head">
          <b>{group?.title}</b>
          <small>{group?.hint}</small>
        </div>
        {!rows.length && <div className="side-none">{total ? "이 묶음은 비었다" : "챙기는 PR이 없다. ⌘,의 연결에서 GitHub를 연결하고 챙길 범위를 고른다"}</div>}
        {rows.map((r, i) => (
          <button key={idOf(r.target)} type="button" tabIndex={-1} className={"wk-row" + (i === at ? " on" : "")} onClick={() => pick(i)} onDoubleClick={enterPr}>
            <span className="wk-row-title">
              <em>#{r.target.number}</em> {r.title}
            </span>
            <span className="wk-row-meta">
              {r.news && <b className="loud">{r.news} · </b>}
              {r.status &&
                prParts(r.status).map(([text, loud]) => (
                  <span key={text} className={loud ? "loud" : ""}>
                    {text} ·{" "}
                  </span>
                ))}
              {r.target.repo.split("/")[1]}
              {r.by && ` · ${r.by}`}
              {r.sleeping && " · 잠듦"}
              {r.at && ` · ${ago(Date.parse(r.at) / 1000)}`}
            </span>
          </button>
        ))}
      </div>
      <div className="wk-main">
        {row ? (
          <PrView key={idOf(row.target)} target={row.target} inline autoFocus={false} onClose={() => box.current?.focus()} />
        ) : (
          <div className="wk-empty">왼쪽에서 PR을 고른다</div>
        )}
      </div>
      <div className="wk-foot">
        Tab 묶음 · ↑↓ PR · Enter·→ PR 화면으로 (Esc로 목록에 돌아옴) · {row?.sessionId ? "s 세션 열기 · " : ""}
        {row?.ask ? "⌘Enter 세션에 리뷰 맡기기 · " : ""}r 새로 읽기 · Esc 닫기
      </div>
    </div>
  );
}
