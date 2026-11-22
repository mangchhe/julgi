// node scripts/check-pr.mjs — PR 형편이 바뀐 것을 "내 차례"로 올릴지 정하는 판정(src/pr.ts)을 본다
import assert from "node:assert";
import { newsOf, prOf } from "../src/pr.ts";

const base = { state: "OPEN", ci: "SUCCESS", decision: "REVIEW_REQUIRED", others: 1 };
assert.equal(newsOf(base, base), "");
assert.equal(newsOf(base, { ...base, ci: "FAILURE" }), "CI 실패");
assert.equal(newsOf({ ...base, ci: "FAILURE" }, { ...base, ci: "FAILURE" }), ""); // 계속 깨져 있으면 또 알리지 않는다
assert.equal(newsOf(base, { ...base, ci: "PENDING" }), "");
assert.equal(newsOf(base, { ...base, decision: "CHANGES_REQUESTED" }), "수정 요청");
assert.equal(newsOf(base, { ...base, others: 3 }), "새 코멘트 2");
assert.equal(newsOf(base, { ...base, state: "MERGED" }), "머지됨");
assert.deepEqual(prOf("https://github.com/a/b-c/pull/12/files"), { repo: "a/b-c", number: 12 });
assert.equal(prOf("https://github.com/a/b/issues/12"), null);
console.log("pr ok");
