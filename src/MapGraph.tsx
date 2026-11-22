import { useMemo, useState } from "react";
import { Edge } from "./brain";

/** focus: 밝혀 볼 레포들(영역 하나를 골랐을 때). 비어 있으면 전부 보인다 */
type Props = { repos: { name: string; role: string }[]; edges: Edge[]; focus?: string[] };

/** 왼쪽에서 오른쪽으로: 사람이 쓰는 쪽 → 받아 주는 쪽 → 서버 → 서버들이 기대는 것 → 그 밖 */
const COLUMNS = ["앱", "웹 화면", "게이트웨이", "백엔드 서버", "공용 모듈·계약", "배포 설정", "문서·지식", "도구"];
/** 이어진 방식마다 색과 선 모양을 달리한다. 색만으로 가르지 않게 점선도 다르다 */
const KINDS: Record<string, { color: string; dash: string }> = {
  "API 호출": { color: "var(--accent)", dash: "" },
  메시지: { color: "var(--wait)", dash: "6 3" },
  "생성된 코드": { color: "var(--ok)", dash: "2 3" },
  의존성: { color: "var(--ink)", dash: "8 3 2 3" },
  "배포 설정": { color: "var(--muted)", dash: "3 5" },
  기타: { color: "var(--muted)", dash: "1 4" },
};
const H = 30;
const GAP_Y = 46;
/** 화살촉의 길이. 선의 마지막 이만큼은 곧게 긋는다 */
const TIP = 13;
/** 세로줄을 건너뛰는 선이 상자를 피해 지나가는 띠의 높이. 맨 위와 맨 아래에 하나씩 둔다 */
const LANE = 34;

/** 꺾이는 곳을 둥글린 꺾은선 */
function rounded(points: [number, number][], r = 7): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 0.5) {
      d += ` L ${x} ${y}`;
      continue;
    }
    d += ` L ${x - ((x - px) / inLen) * k} ${y - ((y - py) / inLen) * k} Q ${x} ${y} ${x + ((nx - x) / outLen) * k} ${y + ((ny - y) / outLen) * k}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/** 레포 지도를 그림으로. 상자가 레포, 화살표가 "기댄다"의 방향이다. 상자에 올리면 그 레포의 선만 남는다 */
export default function MapGraph({ repos, edges: all, focus = [] }: Props) {
  const [over, setOver] = useState(""); // 마우스를 올린 레포
  const [held, setHeld] = useState(""); // 눌러서 고정한 레포. 다시 누르거나 빈 곳을 누르면 풀린다
  const hot = over || held;
  // 무엇으로 이어지는지 확인되지 않은 선("기타")은 처음에는 감춘다. 범례를 눌러 켜고 끈다
  const [off, setOff] = useState<string[]>(["기타"]);
  const edges = useMemo(() => all.filter((e) => !off.includes(e.kind)), [all, off]);
  const layout = useMemo(() => {
    const degree = (name: string) => edges.filter((e) => e.from === name || e.to === name).length;
    // 역할이 같은 것끼리 한 세로줄에. 선이 많은 레포를 위에 둔다
    const cols = COLUMNS.map((role) => repos.filter((r) => r.role === role).sort((a, b) => degree(b.name) - degree(a.name))).filter((c) => c.length);
    const rest = repos.filter((r) => !COLUMNS.includes(r.role));
    if (rest.length) cols.push(rest);
    // 창 너비 안에 세로줄이 다 들어오게 상자 너비와 줄 사이를 맞춘다
    const avail = Math.min(1500, window.innerWidth * 0.96) - 70;
    const W = Math.max(104, Math.min(176, Math.floor(avail / cols.length) - 34));
    const gapX = cols.length > 1 ? Math.min(W + 150, (avail - W) / (cols.length - 1)) : 0;
    const height = Math.max(...cols.map((c) => c.length)) * GAP_Y + 76 + LANE * 2;
    const at = new Map<string, { x: number; y: number; col: number }>();
    cols.forEach((col, ci) => col.forEach((r, ri) => at.set(r.name, { x: 8 + ci * gapX, y: 54 + LANE + ri * GAP_Y + (height - 76 - LANE * 2 - col.length * GAP_Y) / 2, col: ci })));
    // 선이 상자의 한 점에 몰리지 않게, 같은 옆면에 닿는 선들을 상대 쪽 높이 순으로 위아래에 벌려 놓는다
    const ports = new Map<string, { key: string; other: number }[]>();
    const side = (e: Edge, end: "from" | "to") => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      if (a.col === b.col) return "R";
      return (a.x < b.x) === (end === "from") ? "R" : "L";
    };
    for (const e of edges) {
      const a = at.get(e.from);
      const b = at.get(e.to);
      if (!a || !b) continue;
      for (const end of ["from", "to"] as const) {
        const slot = `${end === "from" ? e.from : e.to}:${side(e, end)}`;
        const list = ports.get(slot) ?? [];
        list.push({ key: `${e.from}>${e.to}:${end}`, other: end === "from" ? b.y : a.y });
        ports.set(slot, list);
      }
    }
    const shift = new Map<string, number>();
    for (const list of ports.values()) {
      list.sort((x, y) => x.other - y.other);
      const step = Math.min(6, 22 / Math.max(1, list.length - 1));
      list.forEach((item, i) => shift.set(item.key, (i - (list.length - 1) / 2) * step));
    }
    // 세로줄을 건너뛰는 선마다 띠 안의 자기 줄을 준다. 같은 줄을 여럿이 쓰면 한 선으로 보인다
    const lane = new Map<string, number>();
    let up = 0;
    let down = 0;
    for (const e of edges) {
      const a = at.get(e.from);
      const b = at.get(e.to);
      if (!a || !b || Math.abs(a.col - b.col) < 2) continue;
      const top = a.y + b.y < height - H;
      lane.set(`${e.from}>${e.to}`, top ? 30 + (up++ % 6) * 5 : height - 6 - (down++ % 6) * 5);
    }
    return { cols, at, width: 16 + (cols.length - 1) * gapX + W + 70, height, gapX, W, shift, lane };
  }, [repos, edges]);

  const W = layout.W;
  const cut = Math.floor(W / 7.4);
  const path = (e: Edge) => {
    const a = layout.at.get(e.from);
    const b = layout.at.get(e.to);
    if (!a || !b) return "";
    const ay = a.y + H / 2 + (layout.shift.get(`${e.from}>${e.to}:from`) ?? 0);
    const by = b.y + H / 2 + (layout.shift.get(`${e.from}>${e.to}:to`) ?? 0);
    if (a.col === b.col) {
      // 같은 줄 안에서는 오른쪽으로 불룩하게 돌아간다
      const x = a.x + W;
      const bulge = 18 + Math.min(64, Math.abs(by - ay) / 3.2);
      return `M ${x} ${ay} C ${x + bulge} ${ay}, ${x + bulge} ${by}, ${x + TIP + 2} ${by} L ${x + 2} ${by}`;
    }
    const forward = a.x < b.x;
    const x1 = forward ? a.x + W : a.x;
    // 선은 상자 2px 앞에서 끝난다. 화살촉이 상자에 가려지지 않고, 마지막 구간이 반듯해서 화살촉이 선과 한 줄로 선다
    const x2 = forward ? b.x - 2 : b.x + W + 2;
    const lead = forward ? -TIP : TIP;
    const laneY = layout.lane.get(`${e.from}>${e.to}`);
    if (laneY !== undefined) {
      // 건너뛰는 선: 옆으로 조금 나와 → 위나 아래의 빈 띠로 올라가 → 띠를 따라 가서 → 내려와 들어간다. 사이의 상자를 지나지 않는다
      const out = forward ? 20 : -20;
      return rounded([
        [x1, ay],
        [x1 + out, ay],
        [x1 + out, laneY],
        [x2 - out, laneY],
        [x2 - out, by],
        [x2, by],
      ]);
    }
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${x2 + lead} ${by} L ${x2} ${by}`;
  };

  const near = new Set(hot ? edges.filter((e) => e.from === hot || e.to === hot).flatMap((e) => [e.from, e.to]) : []);
  const used = Object.keys(KINDS).filter((kind) => all.some((e) => e.kind === kind));
  return (
    <div className="mg">
      <div className="mg-legend">
        <span>화살표는 "기댄다"의 방향: A → B는 A가 B를 부르거나 B에 기댄다</span>
        {used.map((kind) => (
          <button key={kind} type="button" tabIndex={-1} className={"mg-key" + (off.includes(kind) ? " off" : "")} title="눌러서 이 선을 켜고 끈다" onClick={() => setOff(off.includes(kind) ? off.filter((k) => k !== kind) : [...off, kind])}>
            <svg width="30" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="30" y2="4" stroke={KINDS[kind]?.color} strokeWidth="2" strokeDasharray={KINDS[kind]?.dash} />
            </svg>
            {kind} {all.filter((e) => e.kind === kind).length}
          </button>
        ))}
      </div>
      <div className="mg-scroll">
        <svg width={layout.width} height={layout.height} onClick={() => setHeld("")} role="img" aria-label={`레포 ${repos.length}개와 연결 ${edges.length}개`}>
          <defs>
            {Object.entries(KINDS).map(([kind, k], i) => (
              <marker key={kind} id={`mg-arrow-${i}`} viewBox="0 0 10 8" refX="9.6" refY="4" markerWidth="15" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M 0 0.6 L 10 4 L 0 7.4 z" fill={k.color} />
              </marker>
            ))}
          </defs>
          {layout.cols.map((col, ci) => (
            <text key={ci} x={8 + ci * layout.gapX} y={22} className="mg-col">
              {col[0].role || "그 밖"}
            </text>
          ))}
          {edges.map((e) => {
            const k = KINDS[e.kind] ?? KINDS["기타"];
            const on = hot ? e.from === hot || e.to === hot : !focus.length || (focus.includes(e.from) && focus.includes(e.to));
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={path(e)}
                fill="none"
                stroke={k.color}
                strokeWidth={(hot || focus.length) && on ? 2.2 : 1.4}
                strokeDasharray={k.dash}
                opacity={on ? 0.9 : 0.08}
                markerEnd={`url(#mg-arrow-${Object.keys(KINDS).indexOf(KINDS[e.kind] ? e.kind : "기타")})`}
              />
            );
          })}
          {repos.map((r) => {
            const p = layout.at.get(r.name);
            if (!p) return null;
            const dim = hot ? hot !== r.name && !near.has(r.name) : focus.length > 0 && !focus.includes(r.name);
            return (
              <g key={r.name} transform={`translate(${p.x}, ${p.y})`} opacity={dim ? 0.25 : 1} onMouseEnter={() => setOver(r.name)} onMouseLeave={() => setOver("")} onClick={(e) => (e.stopPropagation(), setHeld(held === r.name ? "" : r.name))} className="mg-node">
                <rect width={W} height={H} rx="6" className={(hot === r.name || (!hot && focus.includes(r.name)) ? "on" : "") + (held === r.name ? " held" : "")} />
                <title>{r.name}</title>
                <text x={W / 2} y={H / 2 + 4} textAnchor="middle">
                  {r.name.length > cut ? r.name.slice(0, cut - 1) + "…" : r.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mg-detail">
        {hot ? (
          edges
            .filter((e) => e.from === hot || e.to === hot)
            .map((e) => (
              <span key={`${e.from}>${e.to}`}>
                {e.from === hot ? `→ ${e.to}` : `← ${e.from}`} · {e.kind}
                {e.how && ` · ${e.how}`}
              </span>
            ))
        ) : (
          <span>상자에 마우스를 올리면 그 레포와 이어진 것만 남는다. 누르면 그대로 고정되고, 다시 누르거나 빈 곳을 누르면 풀린다. 위의 선 이름을 누르면 그 종류를 켜고 끈다{off.includes("기타") ? ". 무엇으로 이어지는지 확인되지 않은 선은 감춰져 있다" : ""}</span>
        )}
      </div>
    </div>
  );
}
