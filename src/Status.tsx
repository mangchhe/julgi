import { useEffect, useRef } from "react";
import { tr } from "./i18n";

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
  /** 사용량 화면(모델·프로젝트·세션별 토큰)을 연다 */
  onUsage: () => void;
};

const size = (kb: number) => (kb >= 1_048_576 ? `${(kb / 1_048_576).toFixed(1)}GB` : `${Math.round(kb / 1024)}MB`);
/** 한도 이름은 뒷단이 한국어로 준다("5시간", "주간", "주간 Fable"). 보여 줄 때만 옮긴다 */
const limitName = (name: string) => (name.startsWith("주간 ") ? tr`주간 ${name.slice(3)}` : tr(name)); // i18n-ok
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
export default function Status({ rows, limit, usage, usageWhy, open, onToggle, onShow, onRefresh, onHelp, onUsage }: Props) {
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
            <b>{tr("세션이 쓰는 자원")}</b>
            <span>{limit ? tr`합계가 ${limit}GB를 넘으면 쉬는 세션부터 재운다` : tr("메모리 한도 없음")}</span>
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
          {live.length === 0 && <div className="side-none">{tr("떠 있는 세션이 없다")}</div>}
        </div>
      )}
      {/* 한도 막대들은 한 묶음이다. 어디를 눌러도 사용량 화면이 열린다 */}
      {usage && usage.length > 0 && (
      <span className="status-usegrp" title={tr("누르면 모델·프로젝트·세션별 사용량 (⌘⇧U)")} onClick={onUsage}>
      {usage.map((l) => (
        <span key={l.name} className={"status-use" + (l.used >= 90 ? " high" : l.used >= 70 ? " mid" : "")} title={left(l.resets) ? tr`${limitName(l.name)} 한도의 ${l.used.toFixed(0)}%를 썼다 · ${left(l.resets)} 뒤에 다시 찬다` : tr`${limitName(l.name)} 한도의 ${l.used.toFixed(0)}%를 썼다`}>
          <small>{limitName(l.name)}</small>
          <i>
            <u style={{ width: `${Math.min(100, l.used)}%` }} />
          </i>
          <b>{l.used.toFixed(0)}%</b>
          {left(l.resets) && <small>{left(l.resets)}</small>}
        </span>
      ))}
      </span>
      )}
      {usageWhy && !usage && <span className="status-why" title={usageWhy}>{tr("사용량을 못 받았다")}</span>}
      {(usage || usageWhy) && (
        <button type="button" tabIndex={-1} className="status-refresh" title={tr("사용량 다시 받기")} onClick={onRefresh}>
          ⟳
        </button>
      )}
      <span className="status-gap" />
      <button type="button" tabIndex={-1} className={"status-load" + (over ? " over" : "")} title={tr("Julgi가 띄운 세션들이 쓰는 메모리와 CPU. 누르면 세션별로 본다")} onClick={onToggle}>
        {tr`세션 ${live.length}`} · <b>{size(total)}</b>
        {limit > 0 && <small> / {limit}GB</small>}
        {cpu >= 1 && <span> · CPU {cpu.toFixed(0)}%</span>}
      </button>
      <button type="button" tabIndex={-1} className="status-keys" title={tr("모델·프로젝트·세션별 토큰 사용량 (⌘⇧U)")} onClick={onUsage}>
        {tr("토큰")}
      </button>
      <button type="button" tabIndex={-1} className="status-keys" title={tr("단축키 보기")} onClick={onHelp}>
        <kbd>⌘/</kbd> {tr("키")}
      </button>
    </div>
  );
}
