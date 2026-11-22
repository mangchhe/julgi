// 화면 글이 빠짐없이 번역됐는지 본다.
//   1) tr`…` / tr("…")의 열쇠가 전부 영어 사전에 있는가
//   2) tr로 감싸지 않은 한글 글자열이나 JSX 글이 남았는가
//      (그 줄이나 윗줄에 i18n-ok 주석이 있거나, i18n-off … i18n-on 사이면 넘어간다)
//   3) 사전에 있는데 코드에서 안 쓰는 열쇠, 조각끼리 값이 다른 열쇠
// 쓰기: node scripts/check-i18n.mjs [--todo] [파일...]   (--todo는 2)를 실패로 치지 않고 개수만 보인다)
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const todo = args.includes("--todo");
const only = args.filter((a) => !a.startsWith("--"));
const SRC = "src";
const SKIP = new Set(["mock.ts", "selftest.ts", "vite-env.d.ts", "i18n.ts"]);
const files = (only.length ? only : readdirSync(SRC).filter((f) => /\.tsx?$/.test(f) && !SKIP.has(f)).map((f) => join(SRC, f)));
const KO = /[가-힣]/;

// 사전 조각을 읽는다: export default { "한국어": "English", … }
const dict = new Map(); const clashes = [];
for (const f of readdirSync(join(SRC, "i18n/en")).filter((f) => f !== "index.ts" && f.endsWith(".ts"))) {
  const sf = ts.createSourceFile(f, readFileSync(join(SRC, "i18n/en", f), "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteralLike(n.name) || ts.isIdentifier(n.name)) && ts.isStringLiteralLike(n.initializer)) {
      const k = n.name.text, v = n.initializer.text;
      if (dict.has(k) && dict.get(k).v !== v) clashes.push(`${k}\n      ${dict.get(k).f}: ${dict.get(k).v}\n      ${f}: ${v}`);
      dict.set(k, { v, f });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const used = new Set(); const missing = []; const bare = []; const badSlots = [];
const slots = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split("\n");
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line;
  // i18n-off … i18n-on 사이의 줄은 통째로 넘어간다 (모델에 보내는 프롬프트처럼 번역하지 않는 긴 글)
  const off = new Set(); { let on = false; lines.forEach((l, i) => { if (/i18n-off/.test(l)) on = true; if (on) off.add(i); if (/i18n-on\b/.test(l)) on = false; }); }
  const end = (n) => sf.getLineAndCharacterOfPosition(n.getEnd()).line;
  const ok = (n) => off.has(at(n)) || /i18n-ok/.test(lines[at(n)]) || /i18n-ok/.test(lines[at(n) - 1] ?? "") || /i18n-ok/.test(lines[end(n)]);
  const key = (k, n) => { used.add(k); const hit = dict.get(k); if (!hit) missing.push(`${file}:${at(n) + 1}  ${k}`); else if (slots(hit.v) !== slots(k) && new Set(slots(hit.v).split(",")).size > new Set(slots(k).split(",")).size) badSlots.push(`${file}:${at(n) + 1}  ${k} → ${hit.v}`); };
  const isTr = (e) => ts.isIdentifier(e) && e.text === "tr";
  const visit = (n) => {
    if (ts.isTaggedTemplateExpression(n) && isTr(n.tag)) {
      const tpl = n.template;
      key(ts.isNoSubstitutionTemplateLiteral(tpl) ? tpl.text : tpl.head.text + tpl.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join(""), n);
      if (!ts.isNoSubstitutionTemplateLiteral(tpl)) tpl.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    if (ts.isCallExpression(n) && isTr(n.expression) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) { key(n.arguments[0].text, n); n.arguments.slice(1).forEach(visit); return; }
    if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) && KO.test(n.text) && !ok(n)) bare.push(`${file}:${at(n) + 1}  ${n.text.trim().slice(0, 70)}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const unused = only.length ? [] : [...dict.keys()].filter((k) => !used.has(k));
const show = (title, list, max = 40) => { if (!list.length) return; console.log(`\n${title} (${list.length})`); for (const l of list.slice(0, max)) console.log("  " + l); if (list.length > max) console.log(`  … ${list.length - max}개 더`); };
show("영어 사전에 없는 열쇠", missing);
show("영어 쪽에만 있는 {자리}", badSlots);
show("조각끼리 값이 다른 열쇠", clashes);
show("코드에서 안 쓰는 열쇠", unused, 15);
if (todo) console.log(`\n감싸지 않은 한글: ${bare.length}곳`); else show("tr로 감싸지 않은 한글 (그 줄에 // i18n-ok를 달면 넘어간다)", bare);
const fail = missing.length + badSlots.length + clashes.length + (todo ? 0 : bare.length);
console.log(fail ? `\ni18n 실패` : `\ni18n ok · 열쇠 ${used.size}개`);
process.exit(fail ? 1 : 0);
