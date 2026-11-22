import { Note, stale, statOf, Stats, usedCount } from "./brain";
import { Session, SkillInfo, SkillUse } from "./model";
import { tr } from "./i18n";

/** 점검 한 번에 재 둔 값. 다음 점검과 견줘 나아졌는지 본다 */
export type Metrics = {
  sends: number;
  hit: number;
  judged: number;
  moved: number;
  notes: number;
  usedNotes: number;
  staleNotes: number;
  out: number;
  read: number;
  fixed: number;
  skills: number;
  usedSkills: number;
  oldSkills: number;
  uses30: number;
  recent: number;
  named: number;
};
/** 점검 기록 한 판. v가 판 번호다. did: Julgi가 손댄 것, seen: 눈에 띈 것(다음에 볼 것) */
/** kind: 매일 점검(최근 일주일에 쓴 세션)인지 매주 점검(전부)인지 */
// 저장되는 값 i18n-ok
export type Review = { v: number; kind?: "매일" | "매주"; at: number; metrics: Metrics; did: string[]; seen: string[] };

export type Route = { at: string; top: string | null; chosen: string; rank: number };

export function measure(a: { routes: Route[]; moved: number; notes: Note[]; stats: Stats; skills: SkillInfo[]; skillUses: SkillUse[]; sessions: Session[]; names: Record<string, string> }): Metrics {
  const now = Date.now();
  const judged = a.routes.filter((r) => r.top);
  const uses30 = a.skillUses.filter((u) => now - (Date.parse(u.at) || 0) < 30 * 86_400_000);
  const used = new Set(uses30.map((u) => u.skill.slice(u.skill.lastIndexOf(":") + 1)));
  const recent = a.sessions.filter((s) => !s.auto && now / 1000 - s.mtime < 14 * 86400);
  return {
    sends: a.routes.length,
    hit: judged.filter((r) => r.rank === 0).length,
    judged: judged.length,
    moved: a.moved,
    notes: a.notes.length,
    usedNotes: a.notes.filter((n) => usedCount(statOf(a.stats, n.id)) > 0).length,
    staleNotes: a.notes.filter((n) => stale(n, statOf(a.stats, n.id))).length,
    out: a.notes.reduce((x, n) => x + statOf(a.stats, n.id).out, 0),
    read: a.notes.reduce((x, n) => x + statOf(a.stats, n.id).read, 0),
    fixed: a.notes.reduce((x, n) => x + statOf(a.stats, n.id).fixed, 0),
    skills: a.skills.length,
    usedSkills: a.skills.filter((k) => used.has(k.name)).length,
    oldSkills: a.skills.filter((k) => !used.has(k.name) && now / 1000 - k.modified > 90 * 86400).length,
    uses30: uses30.length,
    recent: recent.length,
    named: recent.filter((s) => a.names[s.id]).length,
  };
}

const rate = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
/** 값에서 바로 읽히는 문제. 느낌이 아니라 문턱값으로 가린다 */
export function findings(m: Metrics, skills: SkillInfo[], skillUses: SkillUse[]): string[] {
  const out: string[] = [];
  if (m.judged >= 10 && rate(m.hit, m.judged) < 60) out.push(tr`보낼 곳: 글자로 꼽은 1등이 ${rate(m.hit, m.judged)}%만 맞는다. 후보 추리기가 약하다`);
  if (m.sends >= 10 && rate(m.moved, m.sends) >= 15) out.push(tr`보낼 곳: 보낸 말의 ${rate(m.moved, m.sends)}%를 다른 줄기로 다시 옮겼다. 모델의 판단 기준을 손봐야 한다`);
  if (m.notes >= 20 && rate(m.usedNotes, m.notes) < 20) out.push(tr`브레인: 노트 ${m.notes}개 가운데 ${rate(m.usedNotes, m.notes)}%만 쓰였다. 담는 기준이 느슨하거나 꺼내는 기준이 빡빡하다`);
  if (m.staleNotes) out.push(tr`브레인: 석 달 넘게 한 번도 안 쓰인 노트 ${m.staleNotes}개. 이번 점검에서 내렸다`);
  if (m.recent >= 10 && rate(m.named, m.recent) < 50) out.push(tr`이름: 최근 세션의 ${rate(m.named, m.recent)}%에만 이름이 붙었다. 요약이 밀려 있다`);
  const now = Date.now();
  const used = new Set(skillUses.filter((u) => now - (Date.parse(u.at) || 0) < 30 * 86_400_000).map((u) => u.skill.slice(u.skill.lastIndexOf(":") + 1)));
  const old = skills.filter((k) => k.source !== "Julgi" && !used.has(k.name) && now / 1000 - k.modified > 90 * 86400).map((k) => k.name);
  if (old.length) out.push(tr`스킬: 30일 동안 안 쓰였고 석 달 넘게 안 고친 것 ${old.length}개 (${old.slice(0, 6).join(", ")}). 지워도 되는 후보다`);
  return out;
}
