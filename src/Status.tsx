import { useEffect, useRef } from "react";

type Row = { key: string; name: string; repo: string; rss: number; cpu: number; state: string };
type Limit = { name: string; used: number; resets: number };
type Props = {
  rows: Row[];
  /** 메모리 한도(GB). 0이면 한도가 없다 */
  limit: number;
  /** Claude 구독 사용량. null이면 꺼져 있거나 아직 못 받았다 */
  usage: Limit[] | null;
  usageWhy: string;
  open: boolean;
  onToggle: () => void;
  onShow: (key: string) => void;
  onRefresh: () => void;
  /** 단축키 안내를 연다 */
  onHelp: () => void;
};

const size = (kb: number) => (kb >= 1_048_576 ? `${(kb / 1_048_576).toFixed(1)}GB` : `${Math.round(kb / 1024)}MB`);
/** 다시 찰 때까지: "2h 27m" */
const left = (at: number) => {
  const s = at - Date.now() / 1000;
  if (!at || s <= 0) return "";
  const h = Math.floor(s / 3600);
  return h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.floor(s / 60))}m`;
};

/**
 * 창 맨 아랫줄. 왼쪽은 Claude 구독 사용량, 오른쪽은 Julgi가 띄운 세션들이 쓰는 자원(누르면 세션별로 펴진다).
 * 메모리는 보고 직접 닫으라는 것이 아니다. 한도를 넘으면 Julgi가 쉬는 세션부터 재우고, 여기는 그 형편을 보여 줄 뿐이다
 */
export default function Status({ rows, limit, usage, usageWhy, open, onToggle, onShow, onRefresh, onHelp }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // 펴 둔 동안: Esc나 바깥을 누르면 닫는다. Esc가 터미널로 넘어가 세션을 끊지 않게 여기서 먼저 잡는다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onToggle();
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onToggle();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => (window.removeEventListener("keydown", onKey, true), window.removeEventListener("mousedown", onDown, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const live = rows.filter((r) => r.rss > 0);
  const total = live.reduce((sum, r) => sum + r.rss, 0);
  const cpu = live.reduce((sum, r) => sum + r.cpu, 0);
  const over = limit > 0 && total / 1_048_576 > limit;
  return (
    <div className="status" ref={box}>
      {open && (
        <div className="status-pop">
          <div className="status-pop-head">
            <b>세션이 쓰는 자원</b>
            <span>{limit ? `합계가 ${limit}GB를 넘으면 쉬는 세션부터 재운다` : "메모리 한도 없음"}</span>
          </div>
          {[...live]
            .sort((a, b) => b.rss - a.rss)
            .map((r) => (
              <button key={r.key} type="button" tabIndex={-1} className="status-row" onClick={() => onShow(r.key)}>
                <i className={"dot " + r.state} />
                <span className="status-name">{r.name}</span>
                <small>{r.repo}</small>
                <span className="status-num">{r.cpu >= 0.5 ? `${r.cpu.toFixed(0)}%` : ""}</span>
                <span className="status-num">{size(r.rss)}</span>
              </button>
            ))}
          {live.length === 0 && <div className="side-none">떠 있는 세션이 없다</div>}
        </div>
      )}
      {usage?.map((l) => (
        <span key={l.name} className={"status-use" + (l.used >= 90 ? " high" : l.used >= 70 ? " mid" : "")} title={`${l.name} 한도의 ${l.used.toFixed(0)}%를 썼다${left(l.resets) ? ` · ${left(l.resets)} 뒤에 다시 찬다` : ""}`}>
          <small>{l.name}</small>
          <i>
            <u style={{ width: `${Math.min(100, l.used)}%` }} />
          </i>
          <b>{l.used.toFixed(0)}%</b>
          {left(l.resets) && <small>{left(l.resets)}</small>}
        </span>
      ))}
      {usageWhy && !usage && <span className="status-why" title={usageWhy}>사용량을 못 받았다</span>}
      {(usage || usageWhy) && (
        <button type="button" tabIndex={-1} className="status-refresh" title="사용량 다시 받기" onClick={onRefresh}>
          ⟳
        </button>
      )}
      <span className="status-gap" />
      <button type="button" tabIndex={-1} className={"status-load" + (over ? " over" : "")} title="Julgi가 띄운 세션들이 쓰는 메모리와 CPU. 누르면 세션별로 본다" onClick={onToggle}>
        세션 {live.length} · <b>{size(total)}</b>
        {limit > 0 && <small> / {limit}GB</small>}
        {cpu >= 1 && <span> · CPU {cpu.toFixed(0)}%</span>}
      </button>
      <button type="button" tabIndex={-1} className="status-keys" title="단축키 보기" onClick={onHelp}>
        <kbd>⌘/</kbd> 키
      </button>
    </div>
  );
}
