// node scripts/check-limit.mjs — 한도에 걸린 답에서 풀리는 시각을 제대로 읽는지(src/limit.ts) 본다
import assert from "node:assert";
import { resetAt } from "../src/limit.ts";

const now = new Date(2026, 10, 26, 13, 0); // 11월 26일 오후 1시
const at = (y, mo, d, h, mi = 0) => new Date(y, mo, d, h, mi).getTime();
assert.equal(resetAt("You've hit your Fable limit · resets Nov 30 at 1am (Asia/Seoul)", now), at(2026, 10, 30, 1));
assert.equal(resetAt("You've hit your limit · resets 3pm (Asia/Seoul)", now), at(2026, 10, 26, 15));
assert.equal(resetAt("You've hit your limit · resets 3:30pm", now), at(2026, 10, 26, 15, 30));
// 날짜 없이 이미 지난 시각: 오늘 그 시각(지났으니 바로 이어 간다)
assert.equal(resetAt("You've hit your limit · resets 11am", now), at(2026, 10, 26, 11));
// 밤 11시에 "1am": 내일 새벽
assert.equal(resetAt("You've hit your limit · resets 1am", new Date(2026, 10, 26, 23, 0)), at(2026, 10, 27, 1));
// 12월에 1월 날짜: 내년
assert.equal(resetAt("Claude usage limit reached. Your limit will reset Jan 2 at 9am", new Date(2026, 11, 30, 10)), at(2027, 0, 2, 9));
// 한도 이야기가 아니면 0
assert.equal(resetAt("배치는 매일 3pm에 돈다. resets 3pm", now), 0);
assert.equal(resetAt("You've hit your limit", now), 0);
console.log("limit ok");
