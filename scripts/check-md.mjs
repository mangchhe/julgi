// node scripts/check-md.mjs — PR 본문용 마크다운(src/md.ts)이 HTML을 새지 않고 기본 꾸밈을 하는지 본다
import assert from "node:assert";
import { md } from "../src/md.ts";

assert.equal(md("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
assert.equal(md('[x](javascript:alert(1))'), "<p>[x](javascript:alert(1))</p>");
assert.equal(md("## 무엇을\n쿠폰마다 **따로** 반올림"), "<h4>무엇을</h4><p>쿠폰마다 <b>따로</b> 반올림</p>");
assert.equal(md("- a\n- [x] b"), '<ul><li>a</li><li><input type="checkbox" disabled checked> b</li></ul>');
assert.equal(md("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
assert.equal(md("```\n<b>x</b>\n```"), "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
assert.equal(md("see https://example.com/a and `a*b*c`"), '<p>see <a href="https://example.com/a">https://example.com/a</a> and <code>a*b*c</code></p>');
assert.equal(md('[문서](https://e.com/x") onclick="a)'), '<p>[문서](https://e.com/x&quot;) onclick=&quot;a)</p>'.replace('[문서](https://e.com/x&quot;)', '<a href="https://e.com/x&quot;">문서</a>'));
console.log("md ok");
