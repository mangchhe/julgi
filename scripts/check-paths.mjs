// 화면 글에서 경로를 찾는 규칙을 확인한다: node scripts/check-paths.mjs
import assert from "node:assert/strict";
import { findPaths, resolvePath } from "../src/paths.ts";

const paths = (text) => findPaths(text).map((p) => p.path);

// 홈 경로, 한글 이름, 확장자
assert.deepEqual(paths("- 위치: ~/.lore/acme-api/환불-정책-변경분-기획서-원문-2026-11-23.md"), ["~/.lore/acme-api/환불-정책-변경분-기획서-원문-2026-11-23.md"]);
// 폴더(확장자 없음)
assert.deepEqual(paths("폴더는 ~/prj/julgi/src 이다"), ["~/prj/julgi/src"]);
assert.deepEqual(paths("see /usr/local/bin and ./scripts/install.sh"), ["/usr/local/bin", "./scripts/install.sh"]);
// 뒤에 붙은 조사와 마침표는 뗀다
assert.deepEqual(paths("~/notes/a.md에 저장했다."), ["~/notes/a.md"]);
assert.deepEqual(paths("src/App.tsx:120:4 를 고쳤다."), ["src/App.tsx"]);
// 줄 번호는 경로에서 빼지만 밑줄 범위에는 든다
assert.equal(findPaths("src/App.tsx:120")[0].end, "src/App.tsx:120".length);
// 경로가 아닌 것
assert.deepEqual(paths("turn off auto-copy in /config"), []);
assert.deepEqual(paths("https://example.com/a/b.js and v1.2 and e.g and 2.1.330"), []);
assert.deepEqual(paths("and/or, 3/4"), []);
// 이름만 있는 파일
assert.deepEqual(paths("README.md 와 package.json"), ["README.md", "package.json"]);

assert.equal(resolvePath("~/a/b.md", "/work", "/Users/me"), "/Users/me/a/b.md");
assert.equal(resolvePath("/abs/x", "/work", "/Users/me"), "/abs/x");
assert.equal(resolvePath("./src/a.ts", "/work/", "/Users/me"), "/work/src/a.ts");
assert.equal(resolvePath("src/a.ts", "/work", "/Users/me"), "/work/src/a.ts");
console.log("paths ok");
