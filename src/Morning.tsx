// 브리핑: 한동안 자리를 비웠다 돌아왔을 때 한 화면으로 보는 것.
// 지금 나를 기다리는 것, 그동안 PR과 티켓에 생긴 일, 하던 일들이 어디까지 왔는지, 그동안 Julgi가 알아서 한 일.
import { useEffect, useRef, useState } from "react";
import { tr } from "./i18n";
import { Progress, ago as agoSec } from "./model";

// 여기서 다루는 때는 전부 밀리초다
const ago = (ms: number) => agoSec(Math.floor(ms / 1000));
import { ProgressLines } from "./Threads";

export type MorningWait = { key: string; name: string; repo: string; ask: boolean; since: number; blocked?: string };
export type MorningNews = { key: string; kind: string; title: string; news: string; open: () => void };
export type MorningStem = { key: string; name: string; repo: string; progress: Progress; show?: string };
type Act = { at: number; kind: string; text: string };

type Props = {
  /** 마지막으로 Julgi를 본 때. 0이면 모른다 */
  since: number;
  waits: MorningWait[];
  news: MorningNews[];
  stems: MorningStem[];
  acts: Act[];
  onShow: (key: string) => void;
  onQueue: () => void;
  onHistory: () => void;
  onClose: () => void;
};

export default function Morning({ since, waits, news, stems, acts, onShow, onQueue, onHistory, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // 위아래로 고를 수 있는 줄: 기다리는 세션, 소식, 하던 일 순서
  const picks: (() => void)[] = [...waits.map((w) => () => onShow(w.key)), ...news.map((n) => n.open), ...stems.map((s) => () => s.show && onShow(s.show))];
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void box.current?.querySelector(".mo-row.on")?.scrollIntoView({ block: "nearest" }), [at]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(picks.length - 1, i + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(0, i - 1)));
    else if (e.key === "Enter") (e.preventDefault(), picks[at] ? picks[at]() : onClose());
    else if (e.key === "j" && !e.metaKey) (e.preventDefault(), onQueue());
    else if (e.key === "y" && !e.metaKey) (e.preventDefault(), onHistory());
  };
  // 그동안 한 일은 종류별로 몇 번인지만 먼저 보이고, 최근 것 몇 줄을 아래에 둔다
  const kinds = new Map<string, number>();
  for (const a of acts) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  let n = 0;
  const cls = () => "mo-row" + (n++ === at ? " on" : "");
  const quiet = !waits.length && !news.length && !stems.length && !acts.length;
  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mo" ref={box} tabIndex={-1} onKeyDown={onKey}>
        <div className="mo-head">
          <b>{tr`브리핑`}</b>
          <span>{since ? tr`${ago(since)}에 마지막으로 본 뒤` : tr`지금 형편`}</span>
        </div>
        <div className="mo-body">
          {quiet && <div className="side-none">{tr`기다리는 것도, 새로 생긴 일도 없다`}</div>}
          {waits.length > 0 && (
            <section>
              <h3 className="wait">
                {tr`나를 기다리는 세션`} <i>{waits.length}</i>
              </h3>
              {waits.map((w) => (
                <div key={w.key} className={cls()} onClick={() => onShow(w.key)}>
                  <div className="mo-name">{w.name}</div>
                  <div className="mo-meta">
                    {w.ask && <em>{tr`확인이 필요함`} · </em>}
                    {w.repo}
                    {w.since ? ` · ${ago(w.since)}` : ""}
                  </div>
                  {w.blocked && <div className="mo-stuck">{w.blocked}</div>}
                </div>
              ))}
            </section>
          )}
          {news.length > 0 && (
            <section>
              <h3 className="wait">
                {tr`PR과 티켓에 생긴 일`} <i>{news.length}</i>
              </h3>
              {news.map((x) => (
                <div key={x.key} className={cls()} onClick={x.open}>
                  <div className="mo-name">
                    <span className="mo-kind">{x.kind}</span>
                    {x.title}
                  </div>
                  <div className="mo-meta">
                    <em>{x.news}</em>
                  </div>
                </div>
              ))}
            </section>
          )}
          {stems.length > 0 && (
            <section>
              <h3>
                {tr`하던 일`} <i>{stems.length}</i>
              </h3>
              {stems.map((s) => (
                <div key={s.key} className={cls()} onClick={() => s.show && onShow(s.show)}>
                  <div className="mo-name">{s.name}</div>
                  <div className="mo-meta">{s.repo}</div>
                  <ProgressLines p={s.progress} />
                </div>
              ))}
            </section>
          )}
          {acts.length > 0 && (
            <section>
              <h3>
                {tr`그동안 Julgi가 한 일`} <i>{acts.length}</i>
              </h3>
              <div className="mo-kinds">
                {[...kinds].map(([kind, count]) => (
                  <span key={kind}>
                    {tr(kind)} <b>{count}</b>
                  </span>
                ))}
              </div>
              {acts.slice(0, 5).map((a, i) => (
                <div key={i} className="mo-act">
                  <span className="mo-kind">{tr(a.kind)}</span>
                  {a.text}
                  <i> · {ago(a.at)}</i>
                </div>
              ))}
            </section>
          )}
        </div>
        <div className="pal-foot">{tr`↑↓ 고르기 · Enter 그 세션으로 · j 내 차례(⌘J)에서 한꺼번에 답하기 · y 한 일 전부 · Esc 닫기`}</div>
      </div>
    </div>
  );
}
