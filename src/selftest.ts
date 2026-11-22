// 개발 중 점검: JULGI_SELFTEST를 주고 띄우면 화면이 실제로 도는지 몇 가지를 해 보고
// 결과를 ~/.julgi/julgi.log에 적는다. 사람이 화면을 못 볼 때 쓰려고 둔다.
import { invoke } from "@tauri-apps/api/core";
import type { RefObject } from "react";
import * as terms from "./terms";
import { buildFolders, config, newCommand } from "./model";
import { rankFolders } from "./route";
import type { Open, Session, TermState, Thread } from "./model";
import type { RouteNote, Target } from "./Send";

const log = (label: string, value: unknown) =>
  invoke("log_line", { line: `[selftest] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}` });
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Actions = RefObject<{
  openTerm: (o: Open, command?: string) => void;
  close: (key: string) => void;
  handoff: (key: string) => void;
  dispatch: (target: Target, message: string, note: RouteNote, viaHandoff?: boolean) => Promise<string | void>;
  show: (key: string) => void;
  split: () => void;
  finishThread: (sessionId: string) => void;
}>;
type Live = RefObject<{ open: Open[]; states: Record<string, TermState>; panes: (string | null)[]; sessions: Session[]; threads: Thread[] }>;

const until = async (check: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await wait(1000);
  }
  return false;
};

// 갈아타기를 진짜 Claude로 끝까지 돌려 본다 (호출 세 번쯤 든다)
async function handoffTest(actions: Actions, live: Live) {
  // 이미 믿는다고 해 둔 폴더에서 돌린다 (새 폴더는 확인 창에서 멈춘다)
  const home = await invoke<string>("default_dir", { path: null });
  const id = crypto.randomUUID();
  const first = "c:" + id;
  const isWaiting = (key: string) => ["wait", "ask"].includes(live.current!.states[key]?.state ?? "");
  actions.current!.openTerm({ key: first, label: "점검 갈아타기", cwd: home, sessionId: id }, `${newCommand(id)} "점검 중이다. 숫자 42를 기억하고 '기억함'이라고만 답해."`);
  await log("handoff first id", id);
  await wait(6000);
  await log("handoff debug", { panes: live.current!.panes, has: terms.has(first), pty: terms.idOf(first) ?? null, bodies: [...document.querySelectorAll(".pane-body")].map((b) => b.children.length) });
  await log("handoff early screen", terms.text(first).slice(0, 500).replace(/\n+/g, " | "));
  await log("handoff first ready", await until(() => isWaiting(first), 120_000));
  actions.current!.handoff(first);
  const next = () => live.current!.open.find((o) => o.key !== first && o.key.startsWith("c:"));
  await log("handoff new session opened", await until(() => !!next(), 200_000));
  const second = next();
  if (second) {
    await log("handoff second id", second.sessionId ?? "");
    await log("handoff second ready", await until(() => isWaiting(second.key), 150_000));
    await log("handoff second screen", terms.text(second.key).slice(-700).replace(/\n+/g, " | "));
    await log("handoff shown in pane", live.current!.panes.includes(second.key));
    await log("handoff threads", live.current!.threads.map((t) => ({ name: t.name, sessions: t.sessions.length })));
    await log("handoff memory", ((await invoke<string | null>("data_read", { name: `threads/${live.current!.threads[0]?.id}.md` })) ?? "없음").slice(0, 120));
    actions.current!.close(second.key);
  } else {
    await log("handoff first screen", terms.text(first).slice(-700).replace(/\n+/g, " | "));
  }
  actions.current!.close(first);
}

// 보내기를 진짜 Claude로 돌려 본다: 새 세션으로, 열린 세션으로, 잠든 세션으로 (호출 세 번)
async function sendTest(actions: Actions, live: Live) {
  const cwd = await invoke<string>("default_dir", { path: null });
  const isWaiting = (key: string) => ["wait", "ask"].includes(live.current!.states[key]?.state ?? "");
  const tail = (key: string) => terms.text(key).slice(-260).replace(/\n+/g, " | ");
  await actions.current!.dispatch({ kind: "new", cwd }, "점검 중이다. '받음 1'이라고만 답해.", { rank: -1 });
  const mine = () => live.current!.open.find((o) => o.label.startsWith("점검 중"));
  await until(() => !!mine(), 5000);
  await log("send new: opened hidden", !!mine() && !live.current!.panes.includes(mine()!.key));
  await log("send new: answered", await until(() => !!mine() && isWaiting(mine()!.key), 120_000));
  const key = mine()!.key;
  const id = mine()!.sessionId!;
  await log("send new: screen", tail(key));
  await log("send id", id);

  window.dispatchEvent(new Event("focus")); // 장부를 다시 읽게 한다
  await log("send: in ledger", await until(() => live.current!.sessions.some((s) => s.id === id), 60_000));
  const session = live.current!.sessions.find((s) => s.id === id);
  if (!session) return;
  const item = { session, name: session.title, memory: "" };

  await actions.current!.dispatch({ kind: "item", item }, "'받음 2'라고만 답해.", { rank: 0 });
  await until(() => live.current!.states[key]?.state === "run", 20_000);
  await log("send open: answered", await until(() => isWaiting(key), 120_000));
  await log("send open: screen", tail(key));

  actions.current!.close(key);
  await wait(1500);
  await actions.current!.dispatch({ kind: "item", item }, "'받음 3'이라고만 답해.", { rank: 0 });
  await log("send asleep: answered", await until(() => isWaiting(key), 150_000));
  await log("send asleep: screen", tail(key));
  await log("send asleep: stayed hidden", !live.current!.panes.includes(key));
  actions.current!.close(key);

  // 모델에게 묻기
  const asked = await invoke<string>("route_ask", {
    system: '너는 분류기다. JSON 한 줄만 답한다: {"pick": 번호 또는 "new", "why": "짧은 한 문장"}',
    prompt: "후보:\n0. 환불 금액 계산 (acme-api)\n1. 주문 목록 지연 (acme-admin)\n\n글: 쿠폰 겹치면 음수 나오는 거 봐줘\n",
  }).catch((e) => "실패: " + String(e));
  await log("route ask", asked.trim().slice(0, 200));

  // 잠든 세션을 갈아탄 뒤 보내기
  await wait(1500);
  await actions.current!.dispatch({ kind: "item", item }, "'받음 4'라고만 답해.", { rank: 0 }, true);
  const fresh = () => live.current!.open.find((o) => o.key !== key && o.key.startsWith("c:"));
  await log("handoff-send: new session", await until(() => !!fresh(), 240_000));
  const born = fresh();
  if (born) {
    await log("handoff-send: answered", await until(() => isWaiting(born.key), 150_000));
    await wait(1500);
    await log("handoff-send: reply", ((await invoke<string | null>("last_reply", { sessionId: born.sessionId })) ?? "").slice(0, 120));
    await log("handoff-send: thread", live.current!.threads.map((t) => ({ name: t.name, sessions: t.sessions })));
    await log("handoff-send: hidden", !live.current!.panes.includes(born.key));
    actions.current!.close(born.key);
  }
  actions.current!.close(key);
}

/** 칸 채우기, 기본 폴더, 폴더 고르기, 끝내기. Claude를 부르지 않고 셸과 상태 파일로만 본다 */
async function tendTest(actions: Actions, live: Live) {
  const a = actions.current!;
  const panes = () => live.current!.panes;
  const state = (s: string) => `printf ${s} > ~/.julgi/state/$JULGI_TERM`;
  const [A, B, C] = ["s:tend-a", "s:tend-b", "s:tend-c"];
  for (const o of [...live.current!.open]) a.close(o.key);
  await wait(500);

  // 1. 가려진 채 기다리는 세션은 빈 칸이 생기면 올라온다
  a.openTerm({ key: A, label: "A", cwd: "/tmp" }, `sleep 2; ${state("wait")}; sleep 90`);
  await wait(1500);
  a.openTerm({ key: B, label: "B", cwd: "/tmp" }, `${state("wait")}; sleep 14; ${state("run")}; sleep 90`);
  await wait(4500);
  await log("tend: A hidden and waiting", !panes().includes(A) && live.current!.states[A]?.state === "wait");
  a.split();
  await log("tend: A filled the new pane", await until(() => panes().includes(A), 6000));

  // 2. 답을 보낸(다시 일하기 시작한) 칸은 다음 기다리는 세션으로 넘어간다
  a.openTerm({ key: C, label: "C", cwd: "/tmp" }, "sleep 90"); // A가 있던 칸을 차지해 A를 다시 가린다
  await wait(1000);
  const at = panes().indexOf(B);
  await log("tend: A hidden again, B shown", at >= 0 && !panes().includes(A));
  await log("tend: B's pane moved on to A", await until(() => panes()[at] === A, 25000));
  await log("tend: panes", panes());
  for (const key of [A, B, C]) a.close(key);

  // 3. 기본 폴더와 새 줄기를 열 레포 고르기
  const base = await invoke<string>("default_dir", { path: null });
  await log("default dir", base);
  await log("default dir exists", await invoke("dirs_exist", { paths: [base, "/no/such/dir"] }));
  const folders = buildFolders(live.current!.sessions);
  await log("folders", folders.length);
  const pick = folders[Math.min(2, folders.length - 1)];
  if (pick) await log(`folder for "${pick.repo} 오류 좀 봐줘"`, rankFolders(`${pick.repo} 오류 좀 봐줘`, folders)[0]?.folder.repo === pick.repo);

  // 4. 마지막으로 주고받은 말 읽기, 끝내기와 되살리기
  const s = live.current!.sessions[0];
  if (s) {
    const pair = await invoke<[string, string] | null>("last_exchange", { sessionId: s.id });
    await log("last exchange", pair ? [pair[0].slice(0, 60), pair[1].length] : "없음");
    a.finishThread(s.id);
    await wait(300);
    await log("finish: done", live.current!.threads.find((t) => t.sessions.includes(s.id))?.done === true);
    await log("finish: gone from list", !(document.querySelector<HTMLElement>(".side-list")?.innerText ?? "").includes(s.title.slice(0, 20)));
    a.finishThread(s.id);
    await wait(300);
    await log("finish: revived", live.current!.threads.find((t) => t.sessions.includes(s.id))?.done === false);
  }
}

export async function selftest(actions: Actions, live: Live) {
  if (!(await invoke<boolean>("env_flag", { name: "JULGI_SELFTEST" }))) return;

  await wait(4000);
  if (await invoke<boolean>("env_flag", { name: "JULGI_SELFTEST_TRUST" })) {
    // 믿기로 한 폴더에서 Claude Code의 믿음 물음을 Julgi가 대신 넘기는지 (말은 걸지 않는다)
    const dir = "/tmp/julgi-trust-" + Date.now();
    await invoke("default_dir", { path: dir });
    config.autoTrust = ["/tmp", "/private/tmp"];
    const id = crypto.randomUUID();
    actions.current!.openTerm({ key: "c:" + id, label: "믿음 점검", cwd: dir, sessionId: id }, newCommand(id));
    await wait(5000);
    await log("trust: screen at 5s", terms.text("c:" + id).slice(0, 300).replace(/\n+/g, " | "));
    await wait(9000);
    const screen = terms.text("c:" + id);
    await log("trust: dialog gone", !/Yes, I trust this folder/.test(screen));
    await log("trust: screen at 14s", screen.slice(-300).replace(/\n+/g, " | "));
    actions.current!.close("c:" + id);
    return void log("done", "ok");
  }
  if (await invoke<boolean>("env_flag", { name: "JULGI_SELFTEST_TEND" })) {
    await tendTest(actions, live);
    return void log("done", "ok");
  }
  if (await invoke<boolean>("env_flag", { name: "JULGI_SELFTEST_SEND" })) {
    await sendTest(actions, live);
    return void log("done", "ok");
  }
  if (await invoke<boolean>("env_flag", { name: "JULGI_SELFTEST_HANDOFF" })) {
    await handoffTest(actions, live);
    return void log("done", "ok");
  }
  const side = document.querySelector<HTMLElement>(".side-list");
  await log("sidebar rows", side?.querySelectorAll(".row").length ?? -1);
  await log("sidebar text", (side?.innerText ?? "").slice(0, 500).replace(/\n+/g, " | "));

  const key = "s:selftest";
  actions.current!.openTerm({ key, label: "점검", cwd: "/tmp" }, "echo JULGI_한글_OK; pwd; echo $SHELL $TERM_PROGRAM; printf wait > ~/.julgi/state/$JULGI_TERM; sleep 4");
  await wait(2500);
  await log("term text", terms.text(key));
  await log("term state", live.current!.states[key] ?? "없음");
  await log("open while running", live.current!.open.length);
  await log("pane head", (document.querySelector<HTMLElement>(".pane-head")?.innerText ?? "").replace(/\n+/g, " | "));

  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", metaKey: true }));
  await wait(400);
  await log("palette rows", document.querySelectorAll(".pal-item").length);
  await log("palette last", document.querySelector<HTMLElement>(".pal-item:last-child")?.innerText ?? "");
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", metaKey: true }));

  await wait(3500);
  await log("open after exit", live.current!.open.length);

  // Claude가 Julgi가 얹는 훅 설정으로 실제로 뜨는지 (말은 걸지 않는다)
  const claude = "c:selftest";
  actions.current!.openTerm({ key: claude, label: "점검 Claude", cwd: "/tmp" }, newCommand(crypto.randomUUID()));
  await wait(9000);
  await log("claude screen", terms.text(claude).slice(0, 400).replace(/\n+/g, " | "));
  actions.current!.close(claude);
  actions.current!.close(key);

  // 닫은 칸에 곧바로 다른 것을 열어도 뜨는지
  const again = "s:selftest2";
  actions.current!.openTerm({ key: again, label: "점검 2", cwd: "/tmp" }, "echo JULGI_AGAIN_OK; sleep 8");
  await wait(2500);
  await log("reopen in same pane", terms.text(again));
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", metaKey: true }));
  await wait(500);
  await log("open after cmd-w", live.current!.open.length);

  await log("done", "ok");
}
