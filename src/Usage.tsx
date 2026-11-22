import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ago } from "./model";

/** Rust token_usage가 주는 한 줄: 세션 · 날짜 · 모델마다 */
type Row = { session: string; cwd: string; day: number; model: string; input: number; output: number; cache_read: number; cache_write: number; turns: number; last: number };
type Sum = { input: number; output: number; cache_read: number; cache_write: number; turns: number };

const zero = (): Sum => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0 });
const add = <T extends Sum>(a: T, r: Sum): T => ((a.input += r.input), (a.output += r.output), (a.cache_read += r.cache_read), (a.cache_write += r.cache_write), (a.turns += r.turns), a);
const total = (s: Sum) => s.input + s.output + s.cache_read + s.cache_write;
/** 1234567 → 1.2M */
const big = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** 막대가 보여 줄 값. 캐시 읽기가 대부분이라 쌓으면 나머지가 안 보여서, 한 번에 하나를 고른다 */
const METRICS: { id: string; label: string; of: (s: Sum) => number }[] = [
  { id: "all", label: "전체", of: total },
  { id: "io", label: "입력+출력", of: (s) => s.input + s.output },
  { id: "out", label: "출력", of: (s) => s.output },
  { id: "read", label: "캐시 읽기", of: (s) => s.cache_read },
];
const RANGES = [7, 14, 30];

type Props = {
  /** 세션 ID → 레포 이름과 세션 이름. 워크트리도 원래 레포로 묶으려고 Julgi가 아는 값을 쓴다 */
  sessionInfo: (id: string, cwd: string) => { repo: string; name: string };
  onOpenSession: (id: string) => void;
  onClose: () => void;
};

/** 사용량. Claude Code 기록에서 모델·프로젝트·세션·날짜별 토큰을 센다. 금액은 구독 과금이라 빼고 토큰만 */
export default function Usage({ sessionInfo, onOpenSession, onClose }: Props) {
  const [days, setDays] = useState(14);
  const [metric, setMetric] = useState("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    setRows(null);
    // 시간대: UTC보다 몇 분 빠른가. 날짜를 이 맥 기준으로 나눈다
    void invoke<Row[]>("token_usage", { days, tzOffsetMin: -new Date().getTimezoneOffset() }).then(setRows, () => setRows([]));
  }, [days]);

  const m = METRICS.find((x) => x.id === metric) ?? METRICS[0];
  const view = useMemo(() => {
    const list = rows ?? [];
    const today = Math.floor((Date.now() / 1000 - new Date().getTimezoneOffset() * 60) / 86400);
    const byDay = new Map<number, Sum>();
    for (let d = today - days + 1; d <= today; d++) byDay.set(d, zero());
    const all = zero();
    const models = new Map<string, Sum & { sessions: Set<string> }>();
    const repos = new Map<string, Sum & { sessions: Set<string> }>();
    const sessions = new Map<string, Sum & { last: number; models: Map<string, number>; cwd: string }>();
    for (const r of list) {
      add(all, r);
      const day = byDay.get(r.day);
      if (day) add(day, r);
      const mm = models.get(r.model) ?? Object.assign(zero(), { sessions: new Set<string>() });
      add(mm, r).sessions.add(r.session);
      models.set(r.model, mm);
      const repo = sessionInfo(r.session, r.cwd).repo;
      const rr = repos.get(repo) ?? Object.assign(zero(), { sessions: new Set<string>() });
      add(rr, r).sessions.add(r.session);
      repos.set(repo, rr);
      const ss = sessions.get(r.session) ?? Object.assign(zero(), { last: 0, models: new Map<string, number>(), cwd: r.cwd });
      add(ss, r);
      ss.last = Math.max(ss.last, r.last);
      ss.models.set(r.model, (ss.models.get(r.model) ?? 0) + r.turns);
      sessions.set(r.session, ss);
    }
    const sorted = <T extends Sum>(map: Map<string, T>) => [...map].sort((a, b) => total(b[1]) - total(a[1]));
    return {
      all,
      days: [...byDay].map(([day, s]) => ({ day, s })),
      models: sorted(models),
      repos: sorted(repos).slice(0, 8),
      recent: [...sessions].sort((a, b) => b[1].last - a[1].last).slice(0, 20),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, days]);

  const reuse = view.all.cache_read / Math.max(1, view.all.input + view.all.cache_read + view.all.cache_write);
  const peak = Math.max(1, ...view.days.map((d) => m.of(d.s)));
  const label = (day: number) => {
    const d = new Date(day * 86400 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  // 날짜별 막대: 한 계열, 바닥에 붙인 둥근 위쪽 끝, 얇게(최대 28px)
  const shown = hover != null ? view.days[hover] : null;

  return (
    <div className="us" ref={box} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <div className="us-top">
        <b className="us-title">사용량</b>
        <span className="set-seg us-seg">
          {RANGES.map((n) => (
            <button key={n} type="button" tabIndex={-1} className={n === days ? "yes" : ""} onClick={() => setDays(n)}>
              {n}일
            </button>
          ))}
        </span>
        <small className="us-note">Claude Code 대화 기록에서 센다 · 토큰만(구독은 토큰당 과금이 아니다) · 서브에이전트 포함</small>
        <button type="button" tabIndex={-1} className="us-close" onClick={onClose} title="닫기 (Esc)">
          ×
        </button>
      </div>
      {rows === null ? (
        <div className="side-none us-wait">기록을 읽는 중 (처음 한 번은 몇 초 걸린다)</div>
      ) : (
        <div className="us-body">
          <div className="us-tiles">
            {[
              ["전체 토큰", big(total(view.all))],
              ["입력", big(view.all.input)],
              ["출력", big(view.all.output)],
              ["캐시 읽기", big(view.all.cache_read)],
              ["캐시 쓰기", big(view.all.cache_write)],
              ["답", view.all.turns.toLocaleString()],
              ["캐시 재사용률", `${(reuse * 100).toFixed(0)}%`],
            ].map(([k, v]) => (
              <div key={k} className="us-tile">
                <b>{v}</b>
                <small>{k}</small>
              </div>
            ))}
          </div>

          <div className="us-card">
            <div className="us-card-head">
              <b>날짜별 · {m.label}</b>
              <span className="set-seg us-seg">
                {METRICS.map((x) => (
                  <button key={x.id} type="button" tabIndex={-1} className={x.id === metric ? "yes" : ""} onClick={() => setMetric(x.id)}>
                    {x.label}
                  </button>
                ))}
              </span>
            </div>
            <div className="us-chart">
              <div className="us-bars" role="img" aria-label={`최근 ${days}일 날짜별 ${m.label} 토큰`} onMouseLeave={() => setHover(null)}>
                {view.days.map(({ day, s: sum }, i) => {
                  const v = m.of(sum);
                  return (
                    // 막대보다 넓은 칸 전체에서 마우스를 받는다
                    <div key={day} className={"us-col" + (hover === i ? " on" : "")} onMouseEnter={() => setHover(i)}>
                      <div className="us-track">{v > 0 && <div className="us-bar" style={{ height: `${Math.max(1, (v / peak) * 100)}%` }} />}</div>
                      <span className="us-axis">{days <= 14 || i % 3 === 0 || i === view.days.length - 1 ? label(day) : ""}</span>
                    </div>
                  );
                })}
              </div>
              {shown && (
                <div className="us-tip" style={{ left: `${(((hover ?? 0) + 0.5) / view.days.length) * 100}%` }}>
                  <b>{label(shown.day)}</b>
                  <span>전체 {big(total(shown.s))}</span>
                  <span>입력 {big(shown.s.input)} · 출력 {big(shown.s.output)}</span>
                  <span>캐시 읽기 {big(shown.s.cache_read)} · 쓰기 {big(shown.s.cache_write)}</span>
                  <span>답 {shown.s.turns.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <div className="us-two">
            {[
              { title: "모델별", list: view.models },
              { title: "프로젝트별", list: view.repos },
            ].map(({ title, list }) => {
              const top = Math.max(1, ...list.map(([, s]) => total(s)));
              return (
                <div key={title} className="us-card">
                  <div className="us-card-head">
                    <b>{title}</b>
                    <small>{list[0] ? `가장 많이: ${list[0][0]}` : ""}</small>
                  </div>
                  {list.map(([name, s]) => (
                    <div key={name} className="us-line" title={`입력 ${big(s.input)} · 출력 ${big(s.output)} · 캐시 읽기 ${big(s.cache_read)} · 캐시 쓰기 ${big(s.cache_write)}`}>
                      <div className="us-line-text">
                        <span>{name}</span>
                        <b>{big(total(s))}</b>
                      </div>
                      <i>
                        <u style={{ width: `${(total(s) / top) * 100}%` }} />
                      </i>
                      <small>
                        세션 {s.sessions.size} · 답 {s.turns.toLocaleString()}
                      </small>
                    </div>
                  ))}
                  {!list.length && <div className="side-none">기록이 없다</div>}
                </div>
              );
            })}
          </div>

          <div className="us-card">
            <div className="us-card-head">
              <b>최근 세션</b>
              <small>누르면 그 세션을 연다</small>
            </div>
            <table className="us-table">
              <thead>
                <tr>
                  <th>마지막 활동</th>
                  <th>세션</th>
                  <th>프로젝트</th>
                  <th>모델</th>
                  <th className="n">답</th>
                  <th className="n">입력</th>
                  <th className="n">출력</th>
                  <th className="n">캐시</th>
                </tr>
              </thead>
              <tbody>
                {view.recent.map(([id, s]) => {
                  const info = sessionInfo(id, s.cwd);
                  const model = [...s.models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
                  return (
                    <tr key={id} onClick={() => onOpenSession(id)}>
                      <td>{ago(s.last)}</td>
                      <td className="us-name">{info.name}</td>
                      <td>{info.repo}</td>
                      <td className="us-mono">{model.replace(/^claude-/, "")}</td>
                      <td className="n">{s.turns.toLocaleString()}</td>
                      <td className="n">{big(s.input)}</td>
                      <td className="n">{big(s.output)}</td>
                      <td className="n">{big(s.cache_read + s.cache_write)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
