// 답을 끝낸 세션이 나를 불러야 하는지 판정하는 것의 정확도를 잰다. 앱과 같은 지시문을 쓴다.
//   node scripts/eval-triage.mjs [--model haiku]
// 놓친 것(불러야 하는데 안 부름)이 잘못 부른 것보다 훨씬 나쁘다. 그래서 둘을 따로 센다.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRIAGE_SYSTEM, parseTriage, triagePrompt } from "../src/triageAsk.ts";

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
    const raw = await ask(triagePrompt(cases[i].said, cases[i].reply));
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
// 대신 답하기: 답하면 안 되는 물음에 답하는 일이 없어야 한다. 답해도 되는데 안 한 것은 내 차례가 한 번 느는 것뿐이다
const wrongGo = results.filter((r) => !r.go && r.got.go);
const shyGo = results.filter((r) => r.go && !r.got.go);
console.log(`\n  대신 답하면 안 되는데 답함  ${wrongGo.length}   ← 이것이 0이어야 한다`);
console.log(`  답해도 되는데 안 함        ${shyGo.length}/${results.filter((r) => r.go).length}`);
for (const r of [...wrongGo, ...shyGo]) console.log(`\n  [${r.go ? "안 함" : "잘못 답함"}] ${r.name}\n      모델의 이유: ${r.got.why}`);
process.exit(missed.length || wrongGo.length ? 1 : 0);
