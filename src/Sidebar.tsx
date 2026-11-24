import { openPr, prParts, PrStatus, PrTarget } from "./pr";
import { openTicket } from "./jira";
import { useState } from "react";
import { tr } from "./i18n";
import { Change, Job, ago, config, elsewhere, hot, Item, kilo, Open, Session, STATE_LABEL, TermState, Thread, waiting } from "./model";

/** 이름을 붙였거나 세션이 이어진 줄기는 폴더와 상관없이 이 묶음으로 맨 위에 모은다 */
const THREADS = "줄기"; // 묶음의 열쇠다. 보여 줄 때만 옮긴다 i18n-ok

const PER_GROUP = 6;

type Props = {
  open: Open[];
  items: Item[];
  threads: Thread[];
  byId: Map<string, Session>;
  states: Record<string, TermState>;
  /** 조율 세션이 맡긴 일감. 맡은 세션을 조율 세션 아래에 들여서 보여 준다 */
  tasks: Job[];
  /** 작업 폴더마다 바뀐 양. 코드를 고친 세션에 표시한다 */
  changes: Record<string, Change>;
  /** 고정한 세션. 알아서 재우지 않는다 */
  pinned: string[];
  dead: string[];
  loading: boolean;
  current: string | null;
  shown: (string | null)[];
  /** 목록을 접는다 (⌘B) */
  onShow: (key: string) => void;
  onClose: (key: string) => void;
  onOpenSession: (s: Session) => void;
  /** 찾기 상자를 연다 (⌘K) */
  onSearch: () => void;
  /** 이 세션이 올린 PR과 그 형편. news는 새로 생긴 일(CI 실패, 새 코멘트 등) */
  prOf: (key: string) => { target: PrTarget; status: PrStatus; news?: string } | undefined;
  /** PR에 일이 생긴 세션. 내 차례로 올린다 */
  prNews: Record<string, string>;
  /** 잠든 세션 가운데 PR에 일이 생긴 것: 세션 ID → 까닭과 PR */
  sleepNews: Record<string, { news: string; pr: PrTarget }>;
  /** 이 세션의 티켓과 그 상태 (Jira가 연결돼 있을 때) */
  ticketOf: (key: string) => { key: string; status: string; news?: string; quiet?: boolean; who?: string; mention?: boolean } | undefined;
  /** 작업 페이지 줄에 보일 숫자: 내 PR, 리뷰 요청, 새 소식 */
  work: { prs: number; asks: number; news: number };
  onWork: () => void;
  /** 스크립트가 돌린 세션. 맨 아래 한 묶음으로 접어 둔다 */
  scripts: Session[];
};

export default function Sidebar({ open, items, threads, byId, states, tasks, changes, pinned, dead, loading, current, shown, onShow, onClose, onOpenSession, onSearch, prOf, prNews, sleepNews, ticketOf, work, onWork, scripts }: Props) {
  const openIds = new Set(open.map((o) => o.sessionId));
  const cutoff = Date.now() / 1000 - config.recentDays * 86400;
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const scripted = scripts.filter((s) => s.mtime >= cutoff && !openIds.has(s.id));

  // 잠든 것: 줄기는 맨 위에 따로, 나머지는 작업이 있으면 작업으로, 없으면 프로젝트로 묶는다. 묶음은 최근에 쓴 순서.
  const threadOf = (id?: string) => (id ? threads.find((t) => t.sessions.includes(id)) : undefined);
  const groups = new Map<string, Item[]>([[THREADS, []]]);
  for (const item of items) {
    const s = item.session;
    // 줄기의 세션이 하나라도 열려 있으면 그 줄기는 위의 "열림"에 있다
    const ids = item.thread?.sessions ?? [s.id];
    if (item.thread?.done || s.mtime < cutoff || ids.some((id) => openIds.has(id))) continue;
    const group = item.thread ? THREADS : s.group;
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  if (!groups.get(THREADS)!.length) groups.delete(THREADS);

  // 열린 세션은 연 순서(번호 순서) 그대로 둔다. 상태가 바뀔 때마다 줄이 위아래로 옮겨 다니면 찾기 어렵다.
  // 상태는 점의 색으로 보이고, 묶음 제목에 내 차례와 일하는 중이 몇 개인지 적는다
  // 일감을 맡은 세션은 맡긴 세션(조율 세션)이 열려 있으면 그 아래에 든다. 따로 줄을 세우지 않는다
  const jobOf = new Map<string, Job>();
  for (const t of tasks) if (t.session && open.some((o) => o.sessionId === t.lead)) jobOf.set(t.session, t);
  // 일감을 기다리는 조율 세션은 일하는 중으로 본다(그 아래에서 일이 돌고 있다)
  // PR에 일이 생긴 세션도 일하는 중이 아니면 내 차례로 본다
  const rankOf = (key: string) => (dead.includes(key) ? 2 : waiting(states[key]) || (prNews[key] && states[key]?.state !== "run") ? 0 : states[key]?.state === "run" || states[key]?.state === "hold" ? 1 : 2);
  // 번호(⌘1–⌘9)는 일감을 맡은 세션을 빼고 매긴다
  const tops = open.filter((o) => !jobOf.has(o.sessionId ?? "")).map((o, i) => ({ o, i, rank: rankOf(o.key) }));
  const counts = [0, 1].map((rank) => tops.filter((r) => r.rank === rank).length);
  const ranked: { o: Open; i: number; rank: number; job?: Job; head: boolean }[] = [];
  tops.forEach((top, n) => {
    ranked.push({ ...top, head: n === 0 });
    open.forEach((o, i) => {
      const job = jobOf.get(o.sessionId ?? "");
      if (job && job.lead === top.o.sessionId) ranked.push({ o, i, rank: top.rank, job, head: false });
    });
  });

  return (
    <aside className="side">
      <div className="side-head">
        {/* 숫자는 아래 묶음 제목에 있다. 여기는 찾기 하나만 둔다 */}
        <button type="button" className="side-search" onClick={onSearch} aria-label={tr`세션·줄기·산출물 찾기, 새로 열기`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
          <span>{tr`찾기`}</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
      {/* 작업 페이지(⌘U): PR을 묶음별로 둘러본다 */}
      <button type="button" className={"side-work" + (work.news ? " hot" : "")} onClick={onWork} title={tr`작업: PR을 묶음별로 둘러본다 (⌘U)`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="4" r="2" /><circle cx="4" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><path d="M4 6v4M12 10V7a3 3 0 0 0-3-3H7" /></svg>
        <span>{tr`작업`}</span>
        <small>{[work.prs ? `PR ${work.prs}` : "", work.asks ? tr`리뷰 ${work.asks}` : "", work.news ? tr`새 소식 ${work.news}` : ""].filter(Boolean).join(" · ") || "⌘U"}</small>
      </button>
      <div className="side-list">
        {open.length === 0 && (
          <>
            <div className="grp">{tr`열림`}</div>
            <div className="side-none">{tr`열린 세션이 없다`}</div>
          </>
        )}
        {ranked.map(({ o, i, job, head }) => {
          const s = o.sessionId ? byId.get(o.sessionId) : undefined;
          const st = dead.includes(o.key) ? { state: "dead", since: 0 } : states[o.key];
          const pane = shown.indexOf(o.key);
          return (
            <div key={o.key}>
              {head && (
                <div className="grp">
                  <span>
                    {tr`열려 있음`}
                    {counts[0] > 0 && <em className="g0"> · {tr`내 차례`} {counts[0]}</em>}
                    {counts[1] > 0 && <em className="g1"> · {tr`일하는 중`} {counts[1]}</em>}
                  </span>
                  <span className="n">{tops.length}</span>
                </div>
              )}
            <div
              className={"row" + (job ? " child" : "") + (o.key === current ? " on" : pane >= 0 ? " vis" : "")}
              title={job ? job.ask.split("\n")[0] : (threadOf(o.sessionId)?.name ?? s?.title ?? o.label)}
              onClick={() => onShow(o.key)}
            >
              <span className="slot">{job ? "└" : i < 9 ? i + 1 : ""}</span>
              <span className={"dot " + (st?.state ?? "")} />
              <div className="row-body">
                <div className="row-head">
                  <div className="row-title">{job ? `${job.repo} · ${job.ask.split("\n")[0].replace(/^배경:\s*/, "").slice(0, 40)}` : (threadOf(o.sessionId)?.name ?? s?.title ?? o.label)}</div>
                  {/* 이어진 티켓에 새 소식이 있으면 제목 옆에 배지를 단다. 아랫줄은 길면 잘려서 놓치기 쉽다 */}
                  {(() => {
                    const tk = job ? undefined : ticketOf(o.key);
                    if (!tk?.news || tk.quiet) return null;
                    return (
                      <span className={"tk-badge" + (tk.mention ? " mention" : "")} title={`${tk.key} · ${tk.news}`}>
                        {tk.mention ? "@" : "💬"}
                        {tk.who ? ` ${tk.who.split(",")[0].slice(0, 8)}` : ""}
                      </span>
                    );
                  })()}
                  {/* 고정한 세션은 제목 오른쪽 끝에 핀을 단다 */}
                  {pinned.includes(o.key) && (
                    <svg className="pin-mark" viewBox="0 0 16 16" aria-label={tr`고정`}>
                      <title>{tr`고정됨. 재우지 않고, 이 칸을 다른 세션으로 바꾸지도 않는다 (⌘⇧P)`}</title>
                      <path d="M10 1.5 14.5 6l-2 .6-2.2 2.2.4 3.4-1 1-3-3L3 13.9l-.9.1.1-.9 3.7-3.7-3-3 1-1 3.4.4 2.2-2.2z" />
                    </svg>
                  )}
                </div>
                {/* 아래 한 줄에 다 넣는다: 레포, 상태, PR, 티켓, 고친 양. 브랜치와 자세한 것은 칸 머리와 툴팁에 있다 */}
                <div className={"row-meta" + (!job && st?.state === "ask" ? " wait" : "")}>
                  {job // 일감의 상태는 저장된 값이다 i18n-ok
                    ? [tr`일감 ${tr(job.status)}`, job.redo ? tr`다시 ${job.redo}번` : ""].filter(Boolean).join(" · ") // i18n-ok
                    : [st?.state === "hold" ? tr`일감 기다리는 중 · ${tasks.filter((t) => t.lead === o.sessionId && (t.status === "대기" || t.status === "하는 중")).length}개` : st?.state === "ask" || st?.state === "dead" ? STATE_LABEL[st.state] : "", s?.repo ?? ""].filter(Boolean).join(" · ") /* i18n-ok */}
                  {(() => {
                    const pr = job ? undefined : prOf(o.key);
                    if (!pr) return null;
                    const parts = prParts(pr.status);
                    // 눈에 띄어야 할 것(CI 실패, 수정 요청 등)이 있으면 그것, 없으면 첫 마디(머지됨, 열림)
                    const [text, loud] = parts.find(([, l]) => l) ?? parts[0] ?? ["", false];
                    const comment = pr.news?.startsWith(tr("새 코멘트 {0}", "")) ? pr.news : "";
                    return (
                      <span
                        className={"chip" + (pr.news ? " news" : "")}
                        title={[`PR #${pr.target.number}`, ...parts.map(([t]) => t), comment].filter(Boolean).join(" · ") + "\n" + tr`PR 화면 열기`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openPr(pr.target);
                        }}
                      >
                        {" · "}#{pr.target.number}
                        {(comment || text) && <span className={comment || loud ? "loud" : ""}> {comment || text}</span>}
                      </span>
                    );
                  })()}
                  {(() => {
                    const tk = job ? undefined : ticketOf(o.key);
                    if (!tk) return null;
                    return (
                      <span
                        className={"chip" + (tk.news && !tk.quiet ? " news" : "")}
                        title={[tk.key, tk.status, tk.news].filter(Boolean).join(" · ") + "\n" + tr`티켓 화면 열기`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openTicket(tk.key);
                        }}
                      >
                        {" · "}
                        {tk.key}
                        {tk.news && <span className={tk.quiet ? "faint" : "loud"}> {tk.news}</span>}
                      </span>
                    );
                  })()}
                  {changes[o.cwd]?.files > 0 && changes[o.cwd].by === o.sessionId && (
                    <span
                      className="delta"
                      title={[changes[o.cwd].brief?.line ?? tr`이 세션이 고친 것`, tr`파일 ${changes[o.cwd].files}`, changes[o.cwd].brief?.watch.length ? tr`볼 곳 ${changes[o.cwd].brief!.watch.length}` : "", changes[o.cwd].brief?.found?.length ? tr`짚은 곳 ${changes[o.cwd].brief!.found!.length}` : ""].filter(Boolean).join(" · ")}
                    >
                      {" · "}
                      <b>+{changes[o.cwd].adds}</b> <i>−{changes[o.cwd].dels}</i>
                      {(changes[o.cwd].brief?.found?.length ?? 0) > 0 && <em> !{changes[o.cwd].brief!.found!.length}</em>}
                    </span>
                  )}
                  {s && hot(s.tokens) && <span className="hot" title={tr`세션이 크다. 다음에 보낼 때 갈아탄다`}> · {kilo(s.tokens)}</span>}
                </div>
              </div>
              <button
                type="button"
                className="row-x"
                title={tr`재우기`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(o.key);
                }}
              >
                ×
              </button>
            </div>
            </div>
          );
        })}

        {loading && <div className="side-none">{tr`대화 기록을 읽는 중`}</div>}
        {!loading && groups.size === 0 && <div className="side-none">{tr`최근 세션이 없다`}</div>}
        {[...groups].map(([group, list]) => (
          <div key={group}>
            <div className={"grp" + (group === THREADS ? "" : " repo")}>
              <span>{group === THREADS ? tr`줄기` : group}</span>
              <span className="n">{list.length}</span>
            </div>
            {list.slice(0, group === THREADS ? PER_GROUP * 2 : PER_GROUP).map(({ session: s, name, thread }) => (
              <div key={s.id} className={"row sleep" + (elsewhere(s) ? " away" : "")} onClick={() => onOpenSession(s)} title={[s.recap || s.title, [s.repo, s.branch, thread && thread.sessions.length > 1 ? tr`세션 ${thread.sessions.length}` : "", ago(s.mtime)].filter(Boolean).join(" · ")].join("\n")}>
                <div className="row-body">
                  <div className="row-one">
                    <span className="row-title">{name}</span>
                    {elsewhere(s) && <span className="away-mark" title={tr`다른 곳에서 열림`}>↗</span>}
                    {hot(s.tokens) && <span className="hot">{kilo(s.tokens)}</span>}
                    <small>{ago(s.mtime).replace(/ 전$| ago$/, "")}</small>
                  </div>
                  {sleepNews[s.id] && (
                    <div className="row-meta pr-line news" title={tr`눌러서 깨운다. PR 화면은 ⌘J에서 ⌥Enter`}>
                      PR #{sleepNews[s.id].pr.number} · <span className="loud">{sleepNews[s.id].news}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {list.length > (group === THREADS ? PER_GROUP * 2 : PER_GROUP) && <div className="side-more">{tr`외 ${list.length - (group === THREADS ? PER_GROUP * 2 : PER_GROUP)}개 · ⌘K로 찾기`}</div>}
          </div>
        ))}
        {scripted.length > 0 && (
          <div>
            <div className="grp repo fold" onClick={() => setScriptsOpen(!scriptsOpen)} title={tr`사람이 연 것이 아니라 스크립트나 SDK가 돌린 세션. 설정의 "화면"에서 숨기거나 섞을 수 있다`}>
              <span>{scriptsOpen ? "▾" : "▸"} {tr`스크립트가 돌린 세션`}</span>
              <span className="n">{scripted.length}</span>
            </div>
            {scriptsOpen &&
              scripted.slice(0, PER_GROUP * 2).map((s) => (
                <div key={s.id} className="row sleep" onClick={() => onOpenSession(s)} title={[s.title, [s.repo, ago(s.mtime)].filter(Boolean).join(" · ")].join("\n")}>
                  <div className="row-body">
                    <div className="row-one">
                      <span className="row-title">{s.title}</span>
                      <small>{ago(s.mtime).replace(/ 전$| ago$/, "")}</small>
                    </div>
                  </div>
                </div>
              ))}
            {scriptsOpen && scripted.length > PER_GROUP * 2 && <div className="side-more">{tr`외 ${scripted.length - PER_GROUP * 2}개 · ⌘K로 찾기`}</div>}
          </div>
        )}
      </div>
    </aside>
  );
}
