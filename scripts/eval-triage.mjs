// 답을 끝낸 세션이 나를 불러야 하는지 판정하는 것의 정확도를 잰다. 앱과 같은 지시문을 쓴다.
//   node scripts/eval-triage.mjs [--model haiku]
// 놓친 것(불러야 하는데 안 부름)이 잘못 부른 것보다 훨씬 나쁘다. 그래서 둘을 따로 센다.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BOTS, TRIAGE_SYSTEM, parseTriage, triagePrompt } from "../src/triageAsk.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "haiku";
if (!/^[A-Za-z0-9._\-[\]]+$/.test(model)) throw new Error("모델 이름이 이상하다: " + model);
const { cases } = JSON.parse(readFileSync(new URL("./triage-cases.json", import.meta.url), "utf8"));
const cwd = mkdtempSync(join(tmpdir(), "julgi-eval-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));
const ask = (prompt) => new Promise((done) => {
  const child = spawn("claude", ["-p", "--model", model, "--no-session-persistence", "--setting-sources", "", "--tools", "", "--system-prompt", TRIAGE_SYSTEM], { cwd, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.on("close", () => done(out));
  child.on("error", () => done(""));
  child.stdin.end(prompt);
});
let next = 0;
const results = new Array(cases.length);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < cases.length) {
    const i = next++;
    const raw = await ask(triagePrompt(cases[i].said, cases[i].reply, DEFAULT_BOTS.map((b) => b.when)));
    results[i] = { ...cases[i], got: parseTriage(raw), empty: !raw.trim() };
  }
}));
const ok = results.filter((r) => r.got.need === r.need);
const missed = results.filter((r) => r.need && !r.got.need);
const extra = results.filter((r) => !r.need && r.got.need);
console.log(`할 일이 있는지 판정 · 모델 ${model} · 사례 ${results.length}개\n`);
console.log(`  맞음                    ${ok.length}/${results.length}`);
console.log(`  놓침(불러야 하는데 조용)  ${missed.length}   ← 이것이 0이어야 한다`);
console.log(`  잘못 부름(보고인데 부름)  ${extra.length}`);
for (const r of [...missed, ...extra]) console.log(`\n  [${r.need ? "놓침" : "잘못 부름"}] ${r.name}\n      모델의 이유: ${r.got.why || (r.empty ? "답이 없었다" : "")}`);
// 봇: 처음에 넣어 두는 봇 둘을 켠 것으로 보고 판정한다. 답하면 안 되는 답에 봇이 붙는 일이 없어야 한다.
// 붙어도 되는데 안 붙은 것은 내 차례가 한 번 느는 것뿐이다
const wrongGo = results.filter((r) => !(r.bot ?? 0) && r.got.bot);
const otherBot = results.filter((r) => (r.bot ?? 0) && r.got.bot && r.got.bot !== r.bot);
const shyGo = results.filter((r) => (r.bot ?? 0) && !r.got.bot);
console.log(`\n  봇이 답하면 안 되는데 답함  ${wrongGo.length}   ← 이것이 0이어야 한다`);
console.log(`  다른 봇이 답함            ${otherBot.length}   ← 이것이 0이어야 한다`);
console.log(`  답해도 되는데 안 함        ${shyGo.length}/${results.filter((r) => r.bot).length}`);
for (const r of [...wrongGo, ...otherBot, ...shyGo]) console.log(`\n  [${!r.bot ? "잘못 답함" : r.got.bot ? "다른 봇" : "안 함"}] ${r.name} (봇 ${r.got.bot})\n      모델의 이유: ${r.got.why}`);
process.exit(missed.length || wrongGo.length || otherBot.length ? 1 : 0);
