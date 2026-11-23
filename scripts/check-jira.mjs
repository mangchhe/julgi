// node scripts/check-jira.mjs — Jira 화면 쪽 도우미(src/jira.ts)를 본다: ADF → 마크다운, 티켓 키 찾기, 새 소식 판정
import assert from "node:assert";
import { adfToMd, findKeys, keyOfUrl, setKnownKeys, slugOf, ticketNews, quietNews } from "../src/jira.ts";

const doc = { type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "배경" }] },
  { type: "paragraph", content: [{ type: "text", text: "쿠폰이 " }, { type: "text", text: "사라진다", marks: [{ type: "strong" }] }, { type: "text", text: " ", }, { type: "text", text: "문서", marks: [{ type: "link", attrs: { href: "https://e.com" } }] }] },
  { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "전체 취소" }] }] }] },
  { type: "codeBlock", content: [{ type: "text", text: "a < b" }] },
  { type: "mediaSingle", content: [{ type: "media" }] },
] };
assert.equal(adfToMd(doc), "## 배경\n\n쿠폰이 **사라진다** [문서](https://e.com)\n\n- 전체 취소\n\n```\na < b\n```\n\n[첨부]");
assert.equal(adfToMd("h2. 제목\n* 하나\n{code}x{code}"), "## 제목\n- 하나\n```\nx\n```");
assert.equal(adfToMd(null), "");

setKnownKeys(["ABC", "OPS"]);
assert.deepEqual(findKeys("ABC-123 고침, UTF-8 아님, OPS-7").map((k) => k.key), ["ABC-123", "OPS-7"]);
assert.equal(keyOfUrl("https://x.atlassian.net/browse/ABC-12?focused=1"), "ABC-12");
assert.equal(keyOfUrl("https://x.atlassian.net/browse/ABC"), undefined);

const t = { key: "ABC-1", status: "In Progress", others: 2 };
assert.equal(ticketNews(undefined, t, true), "");
assert.equal(ticketNews(undefined, t, false), "새로 배정됨");
assert.equal(ticketNews({ status: "To Do", others: 2, assigned: true }, t, false), "상태 → In Progress");
assert.equal(ticketNews({ status: "In Progress", others: 1, assigned: true }, t, false), "새 코멘트 1");
// 작성자를 알면 이름을 붙인다. 봇이나 조용히 받기로 한 사람의 댓글뿐이면 조용하다
const was = { status: "In Progress", others: 1, assigned: true };
const bot = { name: "Deploy Bot", id: "b1", app: true };
const kim = { name: "Kim", id: "u1", app: false };
const lee = { name: "Lee", id: "u2", app: false };
assert.equal(ticketNews(was, { ...t, by: [kim, lee] }, false), "새 코멘트 1 · Lee");
assert.equal(ticketNews(was, { ...t, others: 3, by: [kim, lee, bot] }, false), "새 코멘트 2 · Lee 외 1명");
assert.equal(quietNews(was, { ...t, by: [kim, bot] }, ""), true);
assert.equal(quietNews(was, { ...t, by: [kim, lee] }, ""), false);
assert.equal(quietNews(was, { ...t, by: [kim, lee] }, "someone, lee"), true);
assert.equal(quietNews(was, { ...t, by: [kim, lee] }, "U2"), true);
assert.equal(quietNews(was, { ...t, others: 3, by: [kim, bot, lee] }, ""), false);
assert.equal(quietNews({ ...was, status: "To Do" }, { ...t, by: [kim, bot] }, ""), false);
assert.equal(slugOf("Restore coupon on cancel!"), "restore-coupon-on-cancel");
assert.equal(slugOf("주문 취소"), "");
console.log("jira ok");
