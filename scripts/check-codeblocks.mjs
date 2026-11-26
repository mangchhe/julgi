// node scripts/check-codeblocks.mjs — 답에서 코드 블록을 제대로 꺼내는지(src/codeblocks.ts) 본다
import assert from "node:assert";
import { codeBlocks } from "../src/codeblocks.ts";

const md = 'Run this:\n\n```sql\nINSERT INTO t (a, b)\nVALUES (1, \'{"x":null}\');\n```\n\nand\n\n~~~\nls -la\n~~~\n';
assert.deepEqual(codeBlocks(md), [
  { lang: "sql", text: "INSERT INTO t (a, b)\nVALUES (1, '{\"x\":null}');" },
  { lang: "", text: "ls -la" },
]);
// 안쪽의 짧은 펜스는 닫는 줄이 아니다
assert.deepEqual(codeBlocks("````md\n```js\nx\n```\n````"), [{ lang: "md", text: "```js\nx\n```" }]);
// 목록 안 들여쓴 블록은 들여쓰기를 걷는다
assert.deepEqual(codeBlocks("1. do\n   ```\n   echo hi\n   ```"), [{ lang: "", text: "echo hi" }]);
// 블록이 없거나 비었으면 없다
assert.deepEqual(codeBlocks("no code\n```\n\n```"), []);
console.log("codeblocks ok");
