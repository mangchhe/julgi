// 보낼 곳 판정(⌘L)의 정확도를 잰다. 앱이 쓰는 것과 같은 지시문과 글로 모델에게 다시 물어 정답과 견준다.
//
//   node scripts/eval-route.mjs                  지어낸 사례(scripts/route-cases.json) + 내 기록(~/.julgi/routes.jsonl)
//   node scripts/eval-route.mjs --only fixtures  지어낸 사례만      --only logs  내 기록만
//   node scripts/eval-route.mjs --model haiku    다른 모델로        --limit 30   기록은 최근 것 30개만
//
// 내 기록의 정답: 보낸 뒤 다른 줄기로 옮겼으면(misroutes.jsonl) 옮긴 곳, 내가 직접 골랐으면 고른 곳,
// 그 밖에는 그대로 둔 곳(틀렸는데 그냥 둔 것일 수 있어 약한 정답이다).
// 결과는 ~/.julgi/eval/에 남기고, 같은 모델로 잰 지난 결과와 견준다. 모델을 부르므로 사례 수만큼 사용량이 든다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_SYSTEM, askPrompt, candidateLine, parseAnswer } from "../src/routeAsk.ts";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const model = opt("--model", "sonnet");
const only = opt("--only", "");
const limit = Number(opt("--limit", "60"));
if (!/^[A-Za-z0-9._\-[\]]+$/.test(model)) throw new Error("모델 이름이 이상하다: " + model);
const HOME = join(homedir(), ".julgi");
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

// 사례: { name, kind, prompt, expect: 후보 번호 | "new", repo?: 새로 열 레포 }
const cases = [];
if (only !== "logs") {
  const fx = JSON.parse(readFileSync(new URL("./route-cases.json", import.meta.url), "utf8"));
  const cand = fx.candidates.map((c, i) => candidateLine(i, c));
  for (const c of fx.cases) cases.push({ name: c.name, kind: "지어낸 사례", prompt: askPrompt({ lines: cand, repos: fx.repos.join(", "), text: c.text }), expect: c.expect, repo: c.repo, text: c.text });
}
if (only !== "fixtures") {
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const misses = lines(join(HOME, "misroutes.jsonl")).filter((m) => m.rightId);
  for (const r of lines(join(HOME, "routes.jsonl")).filter((r) => r.ask?.prompt).slice(-limit)) {
    const fixed = misses.find((m) => m.at > Date.parse(r.at) && norm(m.said) === norm(r.message));
    const id = fixed ? fixed.rightId : r.chosen;
    const at = id === "new" ? "new" : r.ask.pool.indexOf(id);
    if (at === -1) continue; // 정답이 후보에 없던 사례는 모델이 맞힐 수 없다
    cases.push({ name: r.message.slice(0, 50), kind: fixed ? "내 기록 · 옮겨서 바로잡음" : r.how === "me" ? "내 기록 · 내가 고름" : "내 기록 · 그대로 둠", prompt: r.ask.prompt, expect: at, repo: id === "new" ? (fixed ? fixed.rightRepo : r.repo) : undefined, text: r.message });
  }
}
// 실제로 쓴 기록에서 바로 나오는 수: 보낸 것 가운데 내가 옮겨서 바로잡은 비율. 모델을 부르지 않는다
if (only !== "fixtures") {
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const misses = lines(join(HOME, "misroutes.jsonl"));
  const routes = lines(join(HOME, "routes.jsonl"));
  const HOW = { me: "내가 고름", model: "모델이 고름", text: "글자로 맞음", none: "이어 갈 곳이 없어 새로", session: "다른 세션이 넘김" };
  const tally = {};
  for (const r of routes) {
    const how = HOW[r.how] ?? "예전 기록";
    const t = (tally[how] ??= { sent: 0, moved: 0 });
    t.sent++;
    if (misses.some((m) => m.at > Date.parse(r.at) && norm(m.said) === norm(r.message))) t.moved++;
  }
  console.log(`실제 기록 · 보낸 말 ${routes.length}개 가운데 옮겨서 바로잡은 것`);
  for (const [how, t] of Object.entries(tally)) console.log(`  ${how.padEnd(14)}  ${t.moved}/${t.sent}${t.sent ? ` (${Math.round((100 * t.moved) / t.sent)}%)` : ""}`);
  console.log("");
}
if (!cases.length) { console.log("잴 사례가 없다. ⌘L로 보낸 기록이 쌓이면 다시 돌린다."); process.exit(0); }

// 앱(src-tauri/src/lib.rs의 route_ask)과 같은 방식으로 부른다: 도구 없음, 설정 없음, 기록 남기지 않음
const cwd = mkdtempSync(join(tmpdir(), "julgi-eval-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE")));
const ask = (prompt) => new Promise((done) => {
  const child = spawn("claude", ["-p", "--model", model, "--no-session-persistence", "--setting-sources", "", "--tools", "", "--system-prompt", ASK_SYSTEM], { cwd, env });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("close", () => { try { done({ answer: parseAnswer(out) }); } catch { done({ error: (err || out).trim().slice(0, 160) || "답을 읽지 못했다" }); } });
  child.on("error", (e) => done({ error: String(e) }));
  child.stdin.end(prompt);
});
let next = 0, finished = 0;
const results = new Array(cases.length);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < cases.length) {
    const i = next++;
    const c = cases[i];
    const got = await ask(c.prompt);
    const pick = got.answer ? (typeof got.answer.pick === "number" ? got.answer.pick : "new") : null;
    results[i] = { ...c, pick, pickRepo: got.answer?.repo ?? "", why: got.answer?.why ?? got.error ?? "", ok: pick === c.expect, repoOk: c.expect === "new" && c.repo ? pick === "new" && got.answer?.repo === c.repo : null };
    process.stderr.write(`\r${++finished}/${cases.length}`);
  }
}));
process.stderr.write("\r");

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : "없음");
const rate = (list, key = "ok") => { const use = list.filter((r) => r[key] !== null); return { n: use.filter((r) => r[key]).length, d: use.length }; };
const groups = [...new Set(results.map((r) => r.kind))];
const cont = results.filter((r) => r.expect !== "new"), fresh = results.filter((r) => r.expect === "new");
const summary = {
  at: new Date().toISOString(), model, total: rate(results),
  byKind: Object.fromEntries(groups.map((g) => [g, rate(results.filter((r) => r.kind === g))])),
  continue: rate(cont), fresh: rate(fresh), repo: rate(results, "repoOk"),
  // 틀린 쪽을 가른다: 새 일인데 하던 일에 보냄(다른 일에 섞인다), 이어 할 일인데 새로 엶(맥락을 잃는다), 다른 줄기에 보냄
  wrongJoin: fresh.filter((r) => r.pick !== null && r.pick !== "new").length,
  wrongNew: cont.filter((r) => r.pick === "new").length,
  wrongOther: cont.filter((r) => r.pick !== null && r.pick !== "new" && r.pick !== r.expect).length,
  failed: results.filter((r) => r.pick === null).length,
};
console.log(`보낼 곳 판정 · 모델 ${model} · 사례 ${results.length}개\n`);
console.log(`  전체            ${pct(summary.total.n, summary.total.d)}`);
for (const g of groups) console.log(`  ${g.padEnd(14)}  ${pct(summary.byKind[g].n, summary.byKind[g].d)}`);
console.log(`\n  이어 할 일을 맞는 줄기로   ${pct(summary.continue.n, summary.continue.d)}`);
console.log(`  새 일을 새 줄기로          ${pct(summary.fresh.n, summary.fresh.d)}`);
console.log(`  새 줄기를 맞는 레포에      ${pct(summary.repo.n, summary.repo.d)}`);
console.log(`\n  틀린 것: 새 일을 하던 일에 보냄 ${summary.wrongJoin} · 이어 할 일을 새로 엶 ${summary.wrongNew} · 다른 줄기에 보냄 ${summary.wrongOther} · 답을 못 받음 ${summary.failed}`);
const bad = results.filter((r) => !r.ok || r.repoOk === false);
if (bad.length) {
  console.log(`\n틀린 사례`);
  for (const r of bad) console.log(`  [${r.kind}] ${r.name}\n      글: ${String(r.text).slice(0, 90)}\n      정답 ${r.expect}${r.repo ? ` (${r.repo})` : ""} · 모델 ${r.pick ?? "답 없음"}${r.pick === "new" && r.pickRepo ? ` (${r.pickRepo})` : ""} · ${String(r.why).slice(0, 110)}`);
}
// 지난 결과와 견준다
const dir = join(HOME, "eval");
mkdirSync(dir, { recursive: true });
const before = readdirSync(dir).filter((f) => f.startsWith("route-")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))).filter((s) => s.model === model && s.only === only).pop();
if (before) console.log(`\n지난번(${before.at.slice(0, 16).replace("T", " ")}) 전체 ${pct(before.total.n, before.total.d)} → 이번 ${pct(summary.total.n, summary.total.d)}`);
writeFileSync(join(dir, `route-${summary.at.replace(/[:.]/g, "-")}.json`), JSON.stringify({ ...summary, only, cases: results.map(({ prompt, ...r }) => r) }, null, 1));
process.exit(0);
