import { Change, Job, ago, config, elsewhere, hot, Item, kilo, Open, Session, STATE_LABEL, TermState, Thread, waiting } from "./model";

/** 이름을 붙였거나 세션이 이어진 줄기는 폴더와 상관없이 이 묶음으로 맨 위에 모은다 */
const THREADS = "줄기";

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
  filter: string | null;
  /** 목록을 접는다 (⌘B) */
  onShow: (key: string) => void;
  onClose: (key: string) => void;
  onOpenSession: (s: Session) => void;
};

export default function Sidebar({ open, items, threads, byId, states, tasks, changes, pinned, dead, loading, current, shown, filter, onShow, onClose, onOpenSession }: Props) {
  const waitCount = open.filter((o) => waiting(states[o.key])).length;
  const openIds = new Set(open.map((o) => o.sessionId));
  const cutoff = Date.now() / 1000 - config.recentDays * 86400;

  // 잠든 것: 줄기는 맨 위에 따로, 나머지는 작업이 있으면 작업으로, 없으면 프로젝트로 묶는다. 묶음은 최근에 쓴 순서.
  const threadOf = (id?: string) => (id ? threads.find((t) => t.sessions.includes(id)) : undefined);
  const groups = new Map<string, Item[]>([[THREADS, []]]);
  for (const item of items) {
    const s = item.session;
    // 줄기의 세션이 하나라도 열려 있으면 그 줄기는 위의 "열림"에 있다
    const ids = item.thread?.sessions ?? [s.id];
    if (item.thread?.done || s.mtime < cutoff || ids.some((id) => openIds.has(id))) continue;
    if (filter && s.repo !== filter) continue;
    const group = item.thread ? THREADS : s.group;
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  if (!groups.get(THREADS)!.length) groups.delete(THREADS);

  // 열린 세션은 내가 봐야 할 순서로: 내 차례, 일하는 중, 나머지. 묶음 안에서는 연 순서 그대로
  // 일감을 맡은 세션은 맡긴 세션(조율 세션)이 열려 있으면 그 아래에 든다. 따로 줄을 세우지 않는다
  const jobOf = new Map<string, Job>();
  for (const t of tasks) if (t.session && open.some((o) => o.sessionId === t.lead)) jobOf.set(t.session, t);
  // 일감을 기다리는 조율 세션은 일하는 중으로 본다(그 아래에서 일이 돌고 있다)
  const rankOf = (key: string) => (dead.includes(key) ? 2 : waiting(states[key]) ? 0 : states[key]?.state === "run" || states[key]?.state === "hold" ? 1 : 2);
  // 번호(⌘1–⌘9)는 일감을 맡은 세션을 빼고 매긴다
  const tops = open.filter((o) => !jobOf.has(o.sessionId ?? "")).map((o, i) => ({ o, i, rank: rankOf(o.key) })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const counts = [0, 1].map((rank) => tops.filter((r) => r.rank === rank).length);
  const ranked: { o: Open; i: number; rank: number; job?: Job; head: boolean }[] = [];
  tops.forEach((top, n) => {
    ranked.push({ ...top, head: n === 0 || tops[n - 1].rank !== top.rank });
    open.forEach((o, i) => {
      const job = jobOf.get(o.sessionId ?? "");
      if (job && job.lead === top.o.sessionId) ranked.push({ o, i, rank: top.rank, job, head: false });
    });
  });

  return (
    <aside className="side">
      <div className="side-head">
        {/* 앱 이름은 창 맨 윗줄에 있다. 여기에는 지금 형편을 숫자로 둔다 */}
        <span className={"side-stat wait" + (waitCount ? "" : " zero")} title="내 답을 기다리는 세션 (⌘J)">
          <i className="dot wait" />내 차례 <b>{waitCount}</b>
        </span>
        <span className={"side-stat run" + (counts[1] ? "" : " zero")} title="일하는 중인 세션">
          <i className="dot run" />일하는 중 <b>{counts[1]}</b>
        </span>
        <span className="side-stat zero" title="열려 있는 세션">
          열림 <b>{open.length}</b>
        </span>
        {filter && <span className="side-filter" title="이 프로젝트만 보는 중 (⌘P)">{filter}</span>}
      </div>
      <div className="side-list">
        {open.length === 0 && (
          <>
            <div className="grp">열림</div>
            <div className="side-none">열린 세션이 없다</div>
          </>
        )}
        {ranked.map(({ o, i, rank, job, head }) => {
          const s = o.sessionId ? byId.get(o.sessionId) : undefined;
          const st = dead.includes(o.key) ? { state: "dead", since: 0 } : states[o.key];
          const pane = shown.indexOf(o.key);
          return (
            <div key={o.key}>
              {head && <div className={"grp g" + rank}>{[`내 차례 ${counts[0]}`, `일하는 중 ${counts[1]}`, "열려 있음"][rank]}</div>}
            <div
              className={"row" + (job ? " child" : "") + (o.key === current ? " on" : pane >= 0 ? " vis" : "")}
              onClick={() => onShow(o.key)}
            >
              <span className="slot">{job ? "└" : i < 9 ? i + 1 : ""}</span>
              <span className={"dot " + (st?.state ?? "")} />
              <div className="row-body">
                <div className="row-title">{job ? `${job.repo} · ${job.ask.split("\n")[0].replace(/^배경:\s*/, "").slice(0, 40)}` : (threadOf(o.sessionId)?.name ?? s?.title ?? o.label)}</div>
                <div className={"row-meta" + (!job && waiting(st) ? " wait" : "")}>
                  {job
                    ? [`일감 ${job.status}`, job.redo ? `다시 ${job.redo}번` : "", pane >= 0 ? `칸 ${pane + 1}` : ""].filter(Boolean).join(" · ")
                    : [st?.state === "hold" ? `일감 기다리는 중 · ${tasks.filter((t) => t.lead === o.sessionId && (t.status === "대기" || t.status === "하는 중")).length}개` : st ? STATE_LABEL[st.state] : "", s?.repo ?? "", pane >= 0 ? `칸 ${pane + 1}` : "", pinned.includes(o.key) ? "고정" : ""].filter(Boolean).join(" · ")}
                  {s && hot(s.tokens) && <span className="hot"> · {kilo(s.tokens)}</span>}
                </div>
                {changes[o.cwd]?.files > 0 && changes[o.cwd].by === o.sessionId && (
                  <div className="row-meta delta" title={changes[o.cwd].brief?.line ?? "이 세션이 고친 것"}>
                    고침 · 파일 {changes[o.cwd].files} <b>+{changes[o.cwd].adds}</b> <i>−{changes[o.cwd].dels}</i>
                    {changes[o.cwd].brief && changes[o.cwd].brief!.watch.length > 0 && <em> · 눈여겨볼 곳 {changes[o.cwd].brief!.watch.length}</em>}
                    {(changes[o.cwd].brief?.found?.length ?? 0) > 0 && <em> · 짚은 곳 {changes[o.cwd].brief!.found!.length}</em>}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="row-x"
                title="재우기"
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

        {loading && <div className="side-none">대화 기록을 읽는 중</div>}
        {!loading && groups.size === 0 && <div className="side-none">{filter ? "이 프로젝트의 최근 세션이 없다" : "최근 세션이 없다"}</div>}
        {[...groups].map(([group, list]) => (
          <div key={group}>
            <div className="grp">{group}</div>
            {list.slice(0, group === THREADS ? PER_GROUP * 2 : PER_GROUP).map(({ session: s, name, thread }) => (
              <div key={s.id} className={"row sleep" + (elsewhere(s) ? " away" : "")} onClick={() => onOpenSession(s)} title={s.recap || s.title}>
                <span className="slot" />
                <span className="dot" />
                <div className="row-body">
                  <div className="row-title">{name}</div>
                  <div className="row-meta">
                    {[elsewhere(s) ? "다른 곳에서 열림" : "", thread && thread.sessions.length > 1 ? `세션 ${thread.sessions.length}` : "", ago(s.mtime), s.work || thread ? s.repo : "", s.branch, kilo(s.tokens)].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            ))}
            {list.length > (group === THREADS ? PER_GROUP * 2 : PER_GROUP) && <div className="side-more">외 {list.length - (group === THREADS ? PER_GROUP * 2 : PER_GROUP)}개 · ⌘K로 찾기</div>}
          </div>
        ))}
      </div>
      <div className="side-foot">
        {[["⌘L", "보내기"], ["⌘J", "내 차례"], ["⌘Y", "한 일"], ["⌘G", "줄기"]].map(([key, what]) => (
          <span key={key}>
            <kbd>{key}</kbd>
            {what}
          </span>
        ))}
      </div>
    </aside>
  );
}
