import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Candidate, KINDS, Note, stale, statOf, Stats, usedCount } from "./brain";
import { Act } from "./History";
import { Metrics, Review } from "./review";
import { Job, hot, Open, Session, SkillInfo, SkillUse, Thread } from "./model";

type Props = { acts: Act[]; tasks: Job[]; reviews: Review[]; sessions: Session[]; threads: Thread[]; open: Open[]; notes: Note[]; stats: Stats; skills: SkillInfo[]; skillUses: SkillUse[]; candidates: Candidate[]; named: number };
type Said = [number, number, number, boolean, boolean];
type Route = { at: string; top: string | null; asked: string | null; chosen: string; rank: number };

const DAY = 86_400_000;
/** 점검 기록 표에 판마다 나란히 놓는 값 */
const COLS: [string, (m: Metrics) => number][] = [
  ["보냄", (m) => m.sends],
  ["1등 맞음 %", (m) => (m.judged ? Math.round((100 * m.hit) / m.judged) : 0)],
  ["옮김", (m) => m.moved],
  ["노트", (m) => m.notes],
  ["쓰인 노트", (m) => m.usedNotes],
  ["스킬 부름", (m) => m.uses30],
  ["쓰인 스킬", (m) => m.usedSkills],
  ["낡은 스킬", (m) => m.oldSkills],
];
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");

/** 큰 숫자 하나와 그 뜻 */
const Tile = ({ n, label, sub }: { n: string | number; label: string; sub?: string }) => (
  <div className="nm-tile">
    <b>{n}</b>
    <span>{label}</span>
    {sub && <small>{sub}</small>}
  </div>
);
/** 이름 붙은 가로 막대들. 가장 큰 값이 끝까지 찬다 */
const Bars = ({ rows }: { rows: [string, number][] }) => {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="nm-bars">
      {rows.map(([label, n]) => (
        <div key={label} className="nm-bar">
          <span>{label}</span>
          <i style={{ width: `${(100 * n) / max}%` }} />
          <b>{n}</b>
        </div>
      ))}
    </div>
  );
};
/** 날마다의 개수. 막대 하나가 하루 */
const Days = ({ counts, label }: { counts: number[]; label: string }) => {
  const max = Math.max(1, ...counts);
  return (
    <div className="nm-days" role="img" aria-label={`${label}: 최근 ${counts.length}일, 합 ${counts.reduce((a, b) => a + b, 0)}`}>
      {counts.map((n, i) => (
        <i key={i} title={`${counts.length - 1 - i}일 전: ${n}`} style={{ height: `${Math.max(4, (100 * n) / max)}%`, opacity: n ? 1 : 0.25 }} />
      ))}
    </div>
  );
};

/** 날마다 몇 번인지. 맨 끝이 오늘 */
const perDay = (times: number[], days = 14) => {
  const now = Date.now();
  const out = new Array<number>(days).fill(0);
  for (const t of times) {
    const ago = Math.floor((now - t) / DAY);
    if (ago >= 0 && ago < days) out[days - 1 - ago] += 1;
  }
  return out;
};
/** 초를 읽기 좋게 */
const clock = (s: number) => (s < 60 ? `${Math.round(s)}초` : s < 3600 ? `${Math.round(s / 60)}분` : `${(s / 3600).toFixed(1)}시간`);
/** 최근 7일과 그 앞 7일의 비율을 견준다 */
const trend = (a: number, an: number, b: number, bn: number) => (an && bn ? `최근 7일 ${Math.round((100 * a) / an)}% ← 그 앞 ${Math.round((100 * b) / bn)}%` : "견줄 만큼 쌓이지 않음");

/** 통계 (⌘G의 넷째 탭). Julgi가 알아서 한 일이 제대로 돌고 있는지를 세어서 보여 준다 */
export default function Numbers({ acts, tasks, reviews, sessions, threads, open, notes, stats, skills, skillUses, candidates, named }: Props) {
  const [routes, setRoutes] = useState<Route[]>([]);
  // 내가 세션에 한 말 하나하나: (때(초), 0 답 · 1 끊음, 답이 나온 뒤 걸린 초, 앞선 답이 질문으로 끝났나, 승인만 한 말인가)
  const [said, setSaid] = useState<Said[] | null>(null);
  useEffect(() => void invoke<Said[]>("habits", { days: 30 }).then(setSaid, () => setSaid([])), []);
  const hands = useMemo(() => {
    const now = Date.now() / 1000;
    const span = (from: number, to: number) => {
      const rows = (said ?? []).filter((e) => now - e[0] < from * 86400 && now - e[0] >= to * 86400);
      const replies = rows.filter((e) => e[1] === 0);
      const after = replies.filter((e) => e[2] > 0);
      const waits = after.map((e) => e[2]).sort((a, b) => a - b);
      return {
        replies: replies.length,
        after: after.length,
        asked: after.filter((e) => e[3]).length,
        ok: replies.filter((e) => e[4]).length,
        cuts: rows.filter((e) => e[1] === 1).length,
        median: waits[Math.floor(waits.length / 2)] ?? 0,
        slow: waits.filter((w) => w > 300).length,
        gone: waits.filter((w) => w > 1800).length,
      };
    };
    const hours = Array.from({ length: 24 }, () => 0);
    for (const e of said ?? []) if (e[1] === 0) hours[new Date(e[0] * 1000).getHours()] += 1;
    return { all: span(30, 0), week: span(7, 0), before: span(14, 7), hours, days: perDay((said ?? []).filter((e) => e[1] === 0).map((e) => e[0] * 1000), 30) };
  }, [said]);
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "routes.jsonl" }).then((text) => {
      const rows: Route[] = [];
      for (const line of (text ?? "").split("\n")) {
        try {
          if (line) rows.push(JSON.parse(line));
        } catch {
          // 깨진 줄은 건너뛴다
        }
      }
      setRoutes(rows);
    });
  }, []);

  const v = useMemo(() => {
    const now = Date.now();
    const week = acts.filter((a) => now - a.at < 7 * DAY);
    const kinds = new Map<string, number>();
    for (const a of week) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
    const sent = acts.filter((a) => a.kind === "보냄");
    const by = (word: string) => sent.filter((a) => a.text.includes(word)).length;
    const judged = routes.filter((r) => r.top);
    const recent = sessions.filter((s) => !s.auto && now / 1000 - s.mtime < 14 * 86400);
    const uses30 = skillUses.filter((u) => now - (Date.parse(u.at) || 0) < 30 * DAY);
    const usedSkills = new Set(uses30.map((u) => u.skill.slice(u.skill.lastIndexOf(":") + 1)));
    return {
      sendDays: perDay(routes.map((r) => Date.parse(r.at) || 0)),
      sendTotal: routes.length,
      hit: judged.filter((r) => r.rank === 0).length,
      judged: judged.length,
      newStem: routes.filter((r) => r.chosen === "new").length,
      who: [
        ["모델이 고름", by("모델이 고름")],
        ["글자로 맞음", by("글자로 맞음")],
        ["내가 고름", by("내가 고름")],
        ["이어 갈 줄기가 없어서 새로", by("이어 갈 줄기가 없어서")],
        ["세션이 넘김", by("이 넘김")],
      ] as [string, number][],
      kinds: [...kinds].sort((a, b) => b[1] - a[1]),
      weekTotal: week.length,
      needCheck: week.filter((a) => a.kind === "확인 필요").length,
      recent: recent.length,
      big: recent.filter((s) => hot(s.tokens)).length,
      noteKinds: KINDS.map((k) => [k, notes.filter((n) => n.kind === k).length]) as [string, number][],
      usedNotes: notes.filter((n) => usedCount(statOf(stats, n.id)) > 0).length,
      staleNotes: notes.filter((n) => stale(n, statOf(stats, n.id))).length,
      out: notes.reduce((a, n) => a + statOf(stats, n.id).out, 0),
      read: notes.reduce((a, n) => a + statOf(stats, n.id).read, 0),
      fixed: notes.reduce((a, n) => a + statOf(stats, n.id).fixed, 0),
      skillDays: perDay(skillUses.map((u) => Date.parse(u.at) || 0), 30),
      uses30: uses30.length,
      usedSkills: skills.filter((k) => usedSkills.has(k.name)).length,
      oldSkills: skills.filter((k) => !usedSkills.has(k.name) && now / 1000 - k.modified > 90 * 86400).length,
    };
  }, [acts, routes, sessions, notes, stats, skills, skillUses]);

  const last = reviews[reviews.length - 1];
  return (
    <div className="nm">
      <section>
        <h3>점검 기록 · 무엇을 내리고 고쳤는가</h3>
        {reviews.length === 0 && <small>아직 없다. 매일 낮 12시 뒤에 한 번, 월요일 낮에는 전부를 보는 점검을 한다.</small>}
        {last && (
          <div className="nm-review now">
            <div className="nm-rv-head">
              <b>
                {last.v}판 · {last.kind ?? "매주"} 점검
              </b>
              <span>{new Date(last.at).toLocaleDateString("ko-KR")}</span>
              <span>매일 낮 12시 뒤에 최근 일주일의 세션을, 월요일 낮에 전부를 본다</span>
            </div>
            <div className="nm-rv-cols">
              <div>
                <small>눈에 띈 것 · 손봐야 할 곳</small>
                {last.seen.length === 0 && <p className="ok">문턱을 넘은 문제가 없다</p>}
                {last.seen.map((line) => (
                  <p key={line} className="warn">
                    {line}
                  </p>
                ))}
              </div>
              <div>
                <small>Julgi가 손댄 것</small>
                {last.did.length === 0 && <p>손댈 것이 없었다</p>}
                {last.did.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          </div>
        )}
        {reviews.length > 0 && (
          <div className="nm-table">
            <div className="nm-tr head">
              <span>판</span>
              <span>종류</span>
              <span>날짜</span>
              {COLS.map(([label]) => (
                <span key={label}>{label}</span>
              ))}
              <span>손댄 것</span>
              <span>눈에 띈 것</span>
            </div>
            {[...reviews].reverse().slice(0, 12).map((r, i, all) => (
              <div key={r.v} className="nm-tr">
                <span>{r.v}</span>
                <span>{r.kind ?? "매주"}</span>
                <span>{new Date(r.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</span>
                {COLS.map(([label, get]) => {
                  const now = get(r.metrics);
                  const prev = all[i + 1] ? get(all[i + 1].metrics) : now;
                  return (
                    <span key={label}>
                      {now}
                      {now !== prev && <i className={now > prev ? "up" : "down"}> {now > prev ? "+" : ""}{now - prev}</i>}
                    </span>
                  );
                })}
                <span>{r.did.length}</span>
                <span>{r.seen.length}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3>내 손 · 세션이 나를 얼마나 붙잡는가</h3>
        {said === null && <small>대화 기록을 세는 중. 처음에는 조금 걸린다.</small>}
        {said !== null && (
          <>
            <div className="nm-tiles">
              <Tile n={pct(hands.all.asked, hands.all.after)} label="질문으로 끝난 답" sub={`${hands.all.asked} / ${hands.all.after} · ${trend(hands.week.asked, hands.week.after, hands.before.asked, hands.before.after)}`} />
              <Tile n={pct(hands.all.ok, hands.all.replies)} label="승인만 한 내 말" sub={`${hands.all.ok} / ${hands.all.replies} · "ㅇㅇ", "ㄱㄱ", "continue" · ${trend(hands.week.ok, hands.week.replies, hands.before.ok, hands.before.replies)}`} />
              <Tile n={hands.all.cuts} label="중간에 끊음" sub={`Esc · 최근 7일 ${hands.week.cuts}, 그 앞 7일 ${hands.before.cuts}`} />
              <Tile n={clock(hands.all.median)} label="답 뒤 돌아오기까지" sub={`중간값 · 5분 넘김 ${pct(hands.all.slow, hands.all.after)} · 30분 넘김 ${pct(hands.all.gone, hands.all.after)}`} />
            </div>
            <div className="nm-split">
              <div>
                <small>하루에 내가 한 말 · 최근 30일 {hands.all.replies}번</small>
                <Days counts={hands.days} label="하루에 내가 한 말" />
              </div>
              <div>
                <small>몇 시에 말하는가</small>
                <Days counts={hands.hours} label="시각별로 내가 한 말" />
              </div>
            </div>
            <small>최근 30일의 대화 기록에서 센다. Julgi가 띄운 세션(일감, 스킬 만들기)과 갈아타며 물려받은 앞 대화는 뺀다. 질문으로 끝났는지는 답의 끝 글자로 본다.</small>
          </>
        )}
      </section>
      <section>
        <h3>보내기 · 던진 말이 맞는 곳으로 가는가</h3>
        <div className="nm-tiles">
          <Tile n={v.sendTotal} label="보낸 횟수" sub="지금까지" />
          <Tile n={pct(v.hit, v.judged)} label="1등이 맞은 비율" sub={`${v.hit} / ${v.judged} · 글자로 꼽은 1등으로 실제로 간 것`} />
          <Tile n={v.newStem} label="새 줄기로 연 것" sub={pct(v.newStem, v.sendTotal)} />
        </div>
        <div className="nm-split">
          <div>
            <small>최근 14일, 하루에 보낸 수</small>
            <Days counts={v.sendDays} label="하루에 보낸 수" />
          </div>
          <div>
            <small>누가 골랐나</small>
            <Bars rows={v.who} />
          </div>
        </div>
      </section>
      <section>
        <h3>Julgi가 알아서 한 일 · 최근 7일</h3>
        <div className="nm-tiles">
          <Tile n={v.weekTotal} label="한 일" sub="⌘Y에 남은 것" />
          <Tile n={v.needCheck} label="확인 필요" sub="Julgi가 혼자 못 푼 것" />
          <Tile n={`${open.length} / ${v.recent}`} label="열린 세션 / 최근 14일 세션" />
          <Tile n={pct(named, v.recent)} label="이름을 붙인 세션" sub={`${named}개 · 요약에서 지은 이름`} />
          <Tile n={v.big} label="갈아탈 만큼 큰 세션" sub={`줄기 ${threads.length}개`} />
        </div>
        <Bars rows={v.kinds} />
      </section>
      <section>
        <h3>조율 · 맡긴 일감이 한 번에 끝나는가</h3>
        <div className="nm-tiles">
          <Tile n={tasks.length} label="맡긴 일감" sub="최근 2주" />
          <Tile n={pct(tasks.filter((t) => t.status === "끝남").length, tasks.length)} label="끝난 비율" sub={`${tasks.filter((t) => t.status === "끝남").length} / ${tasks.length}`} />
          <Tile n={tasks.filter((t) => t.status === "실패").length} label="실패" />
          <Tile n={tasks.reduce((a, t) => a + t.redo, 0)} label="다시 시킨 횟수" sub="결과가 모자라 이어서 시킨 것" />
          <Tile n={tasks.filter((t) => t.status === "대기" || t.status === "하는 중").length} label="지금 도는 것" />
        </div>
      </section>
      <section>
        <h3>브레인 · 담은 것이 쓰이는가</h3>
        <div className="nm-tiles">
          <Tile n={notes.length} label="노트" />
          <Tile n={pct(v.usedNotes, notes.length)} label="한 번이라도 쓰인 노트" sub={`${v.usedNotes} / ${notes.length}`} />
          <Tile n={v.out} label="새 세션에 붙인 횟수" />
          <Tile n={v.read} label="세션이 찾아본 횟수" />
          <Tile n={v.fixed} label="고친 횟수" />
          <Tile n={v.staleNotes} label="석 달 넘게 안 쓰인 노트" />
        </div>
        <Bars rows={v.noteKinds} />
      </section>
      <section>
        <h3>스킬 · 있는 것이 쓰이는가</h3>
        <div className="nm-tiles">
          <Tile n={v.uses30} label="부른 횟수" sub="최근 30일" />
          <Tile n={pct(v.usedSkills, skills.length)} label="쓰인 스킬" sub={`${v.usedSkills} / ${skills.length} · 깔린 것 가운데`} />
          <Tile n={v.oldSkills} label="낡은 스킬" sub="안 쓰이고 석 달 넘게 안 고침" />
          <Tile n={candidates.length} label="스킬 후보" sub="세 번 넘게 되풀이한 일" />
        </div>
        <small>최근 30일, 하루에 부른 수</small>
        <Days counts={v.skillDays} label="하루에 스킬을 부른 수" />
      </section>
    </div>
  );
}
