// node scripts/check-bots.mjs — 봇이 깨는 조건(src/bots.ts)을 본다: 시간, 종류별 조건, 하루 상한, 같은 일 두 번 안 깨기
import assert from "node:assert";
import { botPrompt, newBot, ran, readBots, settle, timeDue, wakes } from "../src/bots.ts";

// 시간: 그 시각이 지나야 차고, 요일이 맞아야 하고, 열쇠는 날짜와 시각이다
const wed = new Date(2026, 0, 7, 9, 30); // 수요일
assert.equal(timeDue("09:00", wed), "time:2026-01-07 09:00");
assert.equal(timeDue("10:00", wed), "");
assert.equal(timeDue("평일 09:00", wed), "time:2026-01-07 09:00");
assert.equal(timeDue("주말 09:00", wed), "");
assert.equal(timeDue("mon fri 09:00", wed), "");
assert.equal(timeDue("mon wed 9:05", wed), "time:2026-01-07 09:05");
assert.equal(timeDue("언젠가", wed), "");
assert.equal(timeDue("25:00", wed), "");

const bot = { ...newBot("triage"), on: true, role: "새 티켓을 읽고 정리한다", cap: 2, wakes: [{ source: "ticket", when: "assigned mention" }, { source: "event", when: "slack" }] };
const ev = (source, kind, key = source + kind) => ({ source, kind, key, title: `${source} ${kind}`, body: "" });

// 종류별 조건
assert.ok(wakes(bot, ev("ticket", "assigned")));
assert.ok(!wakes(bot, ev("ticket", "status")));
assert.ok(wakes(bot, ev("event", "Slack")));
assert.ok(!wakes(bot, ev("event", "mail")));
assert.ok(!wakes(bot, ev("review", "review")));
// 꺼졌거나 역할이 비었으면 안 깬다
assert.ok(!wakes({ ...bot, on: false }, ev("ticket", "assigned")));
assert.ok(!wakes({ ...bot, role: " " }, ev("ticket", "assigned")));

// 같은 일로는 두 번 안 깨고, 하루 상한을 넘지 않는다
const now = new Date(2026, 0, 7, 10, 0);
const once = ran(bot, ev("ticket", "assigned", "k1"), "s1", now.getTime());
assert.ok(!wakes(once, ev("ticket", "assigned", "k1"), now));
assert.ok(wakes(once, ev("ticket", "assigned", "k2"), now));
const twice = ran(once, ev("ticket", "assigned", "k2"), "s2", now.getTime());
assert.ok(!wakes(twice, ev("ticket", "assigned", "k3"), now));
// 다음 날에는 다시 깬다
assert.ok(wakes(twice, ev("ticket", "assigned", "k3"), new Date(2026, 0, 8, 9, 0)));

// 오후에 "09:00"을 적고 켜도 바로 깨지 않고, 내일은 깬다
const timed = settle({ ...bot, wakes: [{ source: "time", when: "09:00" }] }, now);
const tick = (at) => ({ source: "time", kind: "time", key: timeDue("09:00", at), title: "t", body: "" });
assert.ok(!wakes(timed, tick(now), now));
assert.ok(wakes(timed, tick(new Date(2026, 0, 8, 9, 1)), new Date(2026, 0, 8, 9, 1)));

// 파일 읽기: 모르는 모양은 버리고 빠진 칸은 채운다
assert.deepEqual(readBots("nope"), []);
const read = readBots(JSON.stringify([{ id: "a", name: "A", wakes: [{ source: "time" }] }, { id: "../x" }, 3]));
assert.equal(read.length, 1);
assert.deepEqual(read[0].wakes, [{ source: "time", when: "" }]);
assert.equal(read[0].cap, 5);

// 첫 말에는 역할, 기억, 깨운 일, 기억 파일 자리가 들어간다
const text = botPrompt(bot, { source: "ticket", kind: "assigned", key: "k", title: "ABC-123 로그인 오류", body: "본문" }, "지난번에 원인을 찾았다", "/tmp/MEMORY.md");
for (const part of ["새 티켓을 읽고 정리한다", "지난번에 원인을 찾았다", "ABC-123 로그인 오류", "/tmp/MEMORY.md"]) assert.ok(text.includes(part), part);

console.log("bots ok");
