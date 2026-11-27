// node scripts/check-choices.mjs — 화면에서 번호 고르기를 제대로 꺼내는지(src/choices.ts) 본다
import assert from "node:assert";
import { choicesOf } from "../src/choices.ts";

const perm = ["Bash command", "  npm test", "Do you want to proceed?", "❯ 1. Yes", "  2. Yes, and don't ask again for npm test commands", "  3. No, and tell Claude what to do differently (esc)", ""].join("\n");
assert.deepEqual(choicesOf(perm).map((c) => [c.n, c.on]), [[1, true], [2, false], [3, false]]);
assert.equal(choicesOf(perm)[1].label, "Yes, and don't ask again for npm test commands");
// 상자 테두리 안, 설명 줄이 끼어 있어도
const boxed = ["│ Which one?                 │", "│ ❯ 1. Fast                  │", "│      Quick but rough       │", "│   2. Careful               │", "│      Slow but right        │"].join("\n");
assert.deepEqual(choicesOf(boxed).map((c) => c.label), ["Fast", "Careful"]);
// 답 본문의 번호 목록은 뒤에 다른 글이 이어지면 고르기가 아니다... 그래도 마지막 덩어리가 고르기면 그것을 고른다
const later = ["1. 첫째 할 일", "2. 둘째 할 일", "", "어떻게 할까요?", "❯ 1. 진행", "  2. 멈춤"].join("\n");
assert.deepEqual(choicesOf(later).map((c) => c.label), ["진행", "멈춤"]);
// 하나뿐이거나 2부터 시작하면 아니다
assert.deepEqual(choicesOf("1. only"), []);
assert.deepEqual(choicesOf("2. a\n3. b"), []);
console.log("choices ok");
