// node scripts/check-pr.mjs — PR 형편이 바뀐 것을 "내 차례"로 올릴지 정하는 판정(src/pr.ts)을 본다
import assert from "node:assert";
import { newsOf, prNo, prOf, prUrl, repoName } from "../src/pr.ts";

const base = { state: "OPEN", ci: "SUCCESS", decision: "REVIEW_REQUIRED", others: 1 };
assert.equal(newsOf(base, base), "");
assert.equal(newsOf(base, { ...base, ci: "FAILURE" }), "CI 실패");
assert.equal(newsOf({ ...base, ci: "FAILURE" }, { ...base, ci: "FAILURE" }), ""); // 계속 깨져 있으면 또 알리지 않는다
assert.equal(newsOf(base, { ...base, ci: "PENDING" }), "");
assert.equal(newsOf(base, { ...base, decision: "CHANGES_REQUESTED" }), "수정 요청");
assert.equal(newsOf(base, { ...base, others: 3 }), "새 코멘트 2");
assert.equal(newsOf(base, { ...base, state: "MERGED" }), "머지됨");
assert.equal(newsOf(base, { ...base, state: "CLOSED", actor: "stale-bot" }), "닫힘 · stale-bot");
assert.equal(newsOf(base, { ...base, state: "CLOSED", actor: "" }), ""); // 내가 닫았다
assert.equal(newsOf({ ...base, state: "CLOSED" }, { ...base, actor: "lead" }), "다시 열림 · lead");
assert.deepEqual(prOf("https://github.com/a/b-c/pull/12/files"), { repo: "a/b-c", number: 12 });
assert.equal(prOf("https://github.com/a/b/issues/12"), null);
// GitLab MR: 그룹이 여럿이어도, 자체 호스트여도
const lab = prOf("https://gitlab.example.com/g/sub/proj/-/merge_requests/31/diffs");
assert.deepEqual(lab, { repo: "gitlab:gitlab.example.com/g/sub/proj", number: 31 });
assert.equal(repoName(lab.repo), "proj");
assert.equal(prNo(lab), "!31");
assert.equal(prUrl(lab), "https://gitlab.example.com/g/sub/proj/-/merge_requests/31");
assert.equal(prNo({ repo: "a/b", number: 5 }), "#5");
console.log("pr ok");
