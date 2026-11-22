import { useEffect, useMemo, useRef, useState } from "react";
import { Job } from "./model";

/** Julgi가 알아서 한 일 한 줄. sessionId가 있으면 그 세션으로 갈 수 있다 */
export type Act = { at: number; kind: string; text: string; sessionId?: string };

/** tasks: 조율 세션이 맡긴 일감. 일감마다 흩어진 줄을 조율 하나로 모아 보여 주는 데 쓴다 */
type Props = { acts: Act[]; tasks: Job[]; onPick: (sessionId: string) => void; onClose: () => void };
/** 화면의 한 줄. 연달아 같은 일이 되풀이됐으면 하나로 접고 times에 횟수를 둔다 */
/** open: 고르지 않아도 딸린 줄을 다 편다 (조율 묶음의 일감들) */
type Row = Act & { head: string; rest: string[]; times: number; open?: boolean };

/** 종류를 색으로 나눈다: 내가 봐야 하는 것, 세션을 움직인 것, 지식을 다룬 것 */
const TONE: Record<string, string> = { "확인 필요": "warn", 보냄: "move", 옮김: "move", 칸: "move", 갈아탐: "move", 재움: "move", 끝냄: "move", 합침: "move", 일감: "move", 조율: "move", 배움: "know", 꺼냄: "know", 기억: "know", 지도: "know", 스킬: "know", 점검: "know", 허용: "move" };

const clock = (at: number) => new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (at: number) => {
  const d = new Date(at);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? "오늘" : days === 1 ? "어제" : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
/** 긴 한 줄을 머리와 딸린 줄로 나눈다. 딸린 줄은 " · "로 이어 붙여 적은 것들이다 */
const split = (text: string) => {
  const [first, ...rest] = text.split(" · ");
  const colon = first.indexOf(": ");
  // "A에서 브레인에 5개: x / y / z"처럼 뒤에 목록이 붙은 것은 목록을 딸린 줄로 내린다
  if (colon > 0 && first.length - colon > 40) return { head: first.slice(0, colon), rest: [...first.slice(colon + 2).split(" / "), ...rest] };
  return { head: first, rest };
};

/** 한 일 (⌘Y). 보내고, 칸을 바꾸고, 합치고, 재운 것을 최근 순으로 보여 준다. 뭔가 사라졌을 때 여기서 찾는다. */
export default function History({ acts, tasks, onPick, onClose }: Props) {
  const [only, setOnly] = useState("");
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void box.current?.querySelector(".hs-row.on")?.scrollIntoView({ block: "nearest" }), [sel]);

  const kinds = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of acts) count.set(a.kind, (count.get(a.kind) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]);
  }, [acts]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const leads = new Set<string>();
    const span = (t: Job) => {
      const sec = Math.round(((t.finished ?? Date.now()) - (t.started ?? t.created)) / 1000);
      return sec < 90 ? `${sec}초` : `${Math.round(sec / 60)}분`;
    };
    for (const act of [...acts].reverse()) {
      // 조율 하나에서 나온 줄들(세움, 일감마다 맡김과 끝남)은 한 줄로 모은다. 일감은 그 아래에 한 줄씩 건다
      const taskId = act.kind === "일감" ? act.text.match(/\bt[a-z0-9]{4}\b/)?.[0] : undefined;
      const lead = taskId ? byId.get(taskId)?.lead : act.kind === "조율" && tasks.some((t) => t.lead === act.sessionId) ? act.sessionId : undefined;
      if (lead) {
        if (leads.has(lead) || (only && only !== "일감" && only !== "조율")) continue;
        leads.add(lead);
        const mine = tasks.filter((t) => t.lead === lead);
        const done = mine.filter((t) => t.status === "끝남").length;
        const name = acts.find((a) => a.kind === "일감" && mine.some((t) => a.text.includes(`(${t.id})`)))?.text.match(/^"(.+?)"이 /)?.[1] ?? "조율";
        out.push({
          at: act.at,
          kind: "조율",
          text: act.text,
          sessionId: lead,
          head: `${name} · 일감 ${mine.length}개 가운데 ${done}개 끝남`,
          rest: mine.map((t) => `${t.status} · ${t.repo} · ${span(t)}${t.redo ? ` · 다시 ${t.redo}번` : ""} · ${t.ask.split("\n")[0].replace(/^\[?배경\]?:?\s*/, "").slice(0, 70)}`),
          times: 1,
          open: true,
        });
        continue;
      }
      if (only && act.kind !== only) continue;
      const last = out[out.length - 1];
      const { head, rest } = split(act.text);
      // 같은 종류에 머리가 같은 일이 연달아 있으면 하나로 접는다 (가장 최근 것을 보여 준다)
      if (last && last.kind === act.kind && last.head === head && dayOf(last.at) === dayOf(act.at)) last.times += 1;
      else out.push({ ...act, head, rest, times: 1 });
    }
    return out;
  }, [acts, only, tasks]);
  const at = Math.min(sel, rows.length - 1);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setSel(Math.min(at + 1, rows.length - 1));
    else if (e.key === "ArrowUp") setSel(Math.max(at - 1, 0));
    else if (e.key === "Enter" && rows[at]?.sessionId) onPick(rows[at].sessionId!);
    else return;
    e.preventDefault();
  };

  return (
    <div className="pal-back wide" onMouseDown={onClose}>
      <div className="pal history" ref={box} tabIndex={-1} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
        <div className="hs-head">
          <b>Julgi가 한 일</b>
          <div className="hs-kinds">
            <button type="button" tabIndex={-1} className={"hs-kind" + (only ? "" : " on")} onClick={() => (setOnly(""), setSel(0))}>
              전부 {acts.length}
            </button>
            {kinds.map(([kind, n]) => (
              <button key={kind} type="button" tabIndex={-1} className={"hs-kind t-" + (TONE[kind] ?? "move") + (only === kind ? " on" : "")} onClick={() => (setOnly(only === kind ? "" : kind), setSel(0))}>
                {kind} {n}
              </button>
            ))}
          </div>
        </div>
        <div className="pal-list">
          {rows.length === 0 && <div className="side-none">아직 없다</div>}
          {rows.map((row, i) => (
            <div key={row.at + row.text}>
              {(i === 0 || dayOf(rows[i - 1].at) !== dayOf(row.at)) && <div className="hs-day">{dayOf(row.at)}</div>}
              <div className={"hs-row" + (i === at ? " on" : "")} onClick={() => (i === at && row.sessionId ? onPick(row.sessionId) : setSel(i))}>
                <span className="hs-time">{clock(row.at)}</span>
                <span className={"hs-tag t-" + (TONE[row.kind] ?? "move")}>{row.kind}</span>
                <div className="hs-body">
                  <div className="hs-main">
                    {row.head}
                    {row.times > 1 && <i> ×{row.times}</i>}
                  </div>
                  {/* 고른 줄만 딸린 내용을 다 펴고, 나머지는 한 줄로 줄여 훑어보기 쉽게 한다 */}
                  {row.rest.length > 0 && (i === at || row.open ? row.rest.map((line) => <div key={line} className={"hs-rest" + (line.startsWith("끝남") ? " ok" : line.startsWith("실패") ? " bad" : line.startsWith("하는 중") ? " run" : "")}>{line}</div>) : <div className="hs-rest one">{row.rest.join(" · ")}</div>)}
                </div>
                <span className="hs-go">{row.sessionId ? (i === at ? "⏎ 세션으로" : "") : ""}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="pal-foot">↑↓ 고르기 (고른 줄은 내용을 다 편다) · Enter 그 세션으로 · 위의 종류를 누르면 그것만 본다 · Esc</div>
      </div>
    </div>
  );
}
