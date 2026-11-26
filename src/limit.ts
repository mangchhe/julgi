// 사용 한도에 걸려 멈춘 답에서 한도가 풀리는 시각을 읽는다.
// 다른 모듈을 읽지 않는다: Node가 이 파일을 그대로 읽어 scripts/check-limit.mjs 에서 시험한다.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HOUR = 3600_000;

/**
 * "You've hit your Fable limit · resets Nov 30 at 1am (Asia/Seoul)", "… resets 3:30pm" 같은 답이면 풀리는 시각(ms), 아니면 0.
 * 시각은 이 맥의 시간대로 본다(Claude Code가 이 맥의 시간대로 적는다).
 * 날짜가 없으면 지금에서 가장 가까운 그 시각으로 친다: 5시간 창이라 12시간 안쪽이다. 이미 지났으면 지난 시각을 준다(바로 이어 간다)
 */
export function resetAt(reply: string, now: Date): number {
  const text = reply.slice(-600);
  if (!/hit your .{0,40}limit|usage limit|limit reached/i.test(text)) return 0;
  const m = /reset[s]?(?:\s+at)?\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!m) return 0;
  const hour = (+m[3] % 12) + (m[5].toLowerCase() === "pm" ? 12 : 0);
  const minute = +(m[4] ?? 0);
  if (m[1] && m[2]) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return 0;
    const at = new Date(now.getFullYear(), month, +m[2], hour, minute);
    // 12월에 "Jan 2"를 읽으면 내년이다
    if (at.getTime() < now.getTime() - 180 * 24 * HOUR) at.setFullYear(at.getFullYear() + 1);
    return at.getTime();
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
  return [today - 24 * HOUR, today, today + 24 * HOUR].reduce((best, at) => (Math.abs(at - now.getTime()) < Math.abs(best - now.getTime()) ? at : best));
}
