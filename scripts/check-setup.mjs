// node scripts/check-setup.mjs — 설정 내보내기와 가져오기(src/setup.ts)가 나눌 것만 다루는지 본다
import assert from "node:assert";
import { setupDiff, setupOf } from "../src/setup.ts";

const config = { theme: "ink", termPad: 8, cursorBlink: true, jiraSite: "https://example.atlassian.net", defaultDir: "/Users/me/work", skipPermissions: "off", allowRules: "", argoApps: "a=b", pluginDirs: ["x"], mapRoot: "~/code" };
const bots = [{ id: "go", name: "Go", job: "answers", when: "asks to go on", say: "go on", on: true, runs: 7, image: "data:image/png;base64,AAAA" }];

// 내보내기: 내 컴퓨터와 회사에 딸린 것, 허락을 푸는 것, 봇의 사진과 횟수는 빠진다
const out = setupOf(config, bots);
assert.deepEqual(Object.keys(out.config).sort(), ["cursorBlink", "termPad", "theme"]);
assert.deepEqual(out.bots, [{ name: "Go", job: "answers", when: "asks to go on", say: "go on", art: undefined, model: undefined }]);
assert.ok(!JSON.stringify(out).includes("example.atlassian.net") && !JSON.stringify(out).includes("/Users/me"));

// 가져오기: 다른 값만, 아는 열쇠만, 같은 종류만. 허락을 푸는 값과 연결은 파일에 있어도 버린다
const file = JSON.stringify({ julgi: 1, config: { theme: "nord", termPad: 8, cursorBlink: "yes", skipPermissions: "all", allowRules: "rm", jiraSite: "https://evil.example", unknownKey: 1 }, bots: [{ name: "Go", when: "asks to go on", say: "go on" }, { name: "New", job: "j", when: "reports done", say: "verify" }, { name: "Empty", when: "", say: "x" }] });
const diff = setupDiff(file, config, bots);
assert.deepEqual(diff.values, [["theme", "nord"]]);
assert.equal(diff.bots.length, 1);
assert.equal(diff.bots[0].name, "New");
assert.equal(diff.bots[0].on, false); // 들어온 봇은 꺼져 있다
assert.equal(setupDiff("not json", config, bots), null);
assert.equal(setupDiff(JSON.stringify({ config: { theme: "nord" } }), config, bots), null); // Julgi 표시가 없는 파일
console.log("setup ok");
