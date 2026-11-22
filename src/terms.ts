// 터미널 풀. 터미널은 칸과 따로 산다. 칸에는 보이는 것만 끼우고,
// 안 보이는 터미널은 화면 밖에 세워 둔 채 계속 돌린다. 그래서 전환이 즉시다.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ITheme, Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { config } from "./model";

export type TermSpec = { key: string; cwd?: string; command?: string };

type Entry = {
  spec: TermSpec;
  id: number;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  el: HTMLDivElement;
  opened: boolean;
  /** pty를 띄운 시각. 뜨자마자 죽은 터미널을 가려내는 데 쓴다 */
  startedAt: number;
  /** 내가 마지막으로 이 터미널에 친 때 */
  typedAt: number;
  /** 치고 아직 보내지 않은 글자 수(어림). 남이 보낸 글이 내 글 뒤에 붙지 않게 하는 데 쓴다 */
  draft: number;
  /** 프로그램이 마지막으로 화면에 뭔가 쓴 때 */
  outAt: number;
  observer: ResizeObserver;
};

const pool = new Map<string, Entry>();
let nextId = 1;
let fontSize = 13;
let theme: ITheme = { background: "#0b1620", foreground: "#dbe7f1", cursor: "#6cb4ee", selectionBackground: "#24506f" };
let lot: HTMLDivElement | null = null;

export const handlers = {
  onFocus: (_key: string) => {},
  onExit: (_key: string) => {},
};

void listen<number>("pty-exit", (e) => {
  for (const [key, entry] of pool) if (entry.id === e.payload) handlers.onExit(key);
});

function parking(): HTMLDivElement {
  if (!lot) {
    lot = document.createElement("div");
    lot.className = "parking";
    document.body.append(lot);
  }
  return lot;
}

const visible = (entry: Entry) => entry.el.clientWidth > 50 && entry.el.clientHeight > 50;

export const has = (key: string) => pool.has(key);
export const idOf = (key: string) => pool.get(key)?.id;

export function create(spec: TermSpec) {
  if (pool.has(spec.key)) return;
  const term = new Terminal({
    fontFamily: 'Menlo, "Apple SD Gothic Neo", monospace',
    fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 20000,
    allowProposedApi: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  // 링크는 ⌘를 누른 채 눌러야 열린다. 그냥 누르면 글자 선택과 헷갈린다.
  term.loadAddon(new WebLinksAddon((e, uri) => e.metaKey && void openUrl(uri)));
  const search = new SearchAddon();
  term.loadAddon(search);
  const el = document.createElement("div");
  el.className = "term";
  const entry: Entry = { spec, id: nextId++, term, fit, search, el, opened: false, startedAt: 0, typedAt: 0, draft: 0, outAt: Date.now(), observer: new ResizeObserver(() => {}) };
  entry.observer = new ResizeObserver(() => {
    if (entry.opened && visible(entry)) fit.fit();
  });
  pool.set(spec.key, entry);
}

/** 칸에 있던 터미널을 화면 밖으로 내보낸다 */
export function park(container: HTMLElement) {
  parking().append(...container.children);
}

export function attach(key: string, container: HTMLElement) {
  const entry = pool.get(key);
  if (!entry) return;
  if (entry.el.parentElement === container) return;
  park(container);
  container.append(entry.el);
  if (!entry.opened) {
    open(entry);
  } else {
    entry.fit.fit();
    entry.term.refresh(0, entry.term.rows - 1);
  }
}

export function focus(key: string) {
  pool.get(key)?.term.focus();
}

export function paste(key: string, text: string) {
  const entry = pool.get(key);
  if (!entry?.opened) return;
  entry.term.focus();
  entry.term.paste(text);
}

/** 칸에 보이지 않는 채로 띄운다. 화면 밖에서 돌다가 고르면 칸으로 온다 */
export function wake(key: string) {
  const entry = pool.get(key);
  if (!entry || entry.opened) return;
  parking().append(entry.el);
  open(entry);
}

export const opened = (key: string) => pool.get(key)?.opened ?? false;

/** 글을 넣고 Enter까지 누른다. 보고 있는 칸을 바꾸지 않는다 */
export function submit(key: string, message: string) {
  const entry = pool.get(key);
  if (!entry?.opened) return;
  entry.term.paste(message);
  setTimeout(() => {
    void invoke("pty_write", { id: entry.id, data: "\r" });
    entry.draft = 0;
  }, 250);
}

/** 입력창에 내가 치다 만 글이 있는가. 시간이 아니라 글이 남아 있는지로 본다(치다가 생각에 잠길 수 있다) */
export const drafting = (key: string) => (pool.get(key)?.draft ?? 0) > 0;

/** 치다 만 글이 있으면 내가 그것을 보내거나 지울 때까지 기다렸다가 보낸다. 기다리게 되면 true */
export function submitWhenClear(key: string, message: string, onSent?: () => void) {
  if (!drafting(key)) return submit(key, message), false;
  const timer = setInterval(() => {
    if (!pool.get(key)?.opened) return clearInterval(timer);
    if (drafting(key)) return;
    clearInterval(timer);
    // 내가 방금 누른 Enter가 먼저 들어가게 조금 둔다
    setTimeout(() => (submit(key, message), onSent?.()), 400);
  }, 500);
  return true;
}

/** 키 입력처럼 그대로 보낸다 */
export function send(key: string, data: string) {
  const entry = pool.get(key);
  if (entry?.opened) void invoke("pty_write", { id: entry.id, data });
}

/** 터미널 화면에만 적는다 (프로그램으로는 가지 않는다) */
export function note(key: string, message: string) {
  pool.get(key)?.term.write(`\r\n\x1b[2m${message}\x1b[0m\r\n`);
}

/** 화면에 지나간 글자에서 찾는다. back이면 위쪽으로 */
export function find(key: string, query: string, back: boolean, typing = false) {
  const search = pool.get(key)?.search;
  if (!search) return;
  if (!query) return search.clearDecorations();
  // 맞는 곳을 전부 칠하고, 지금 보고 있는 것은 더 진하게 칠한다. 스크롤바 옆에도 자리가 찍힌다
  const options = {
    incremental: typing, // 치는 동안에는 지금 자리에서 벗어나지 않고 그 자리부터 다시 맞춘다
    decorations: { matchBackground: "#4a5a2a", matchOverviewRuler: "#8a9a4a", activeMatchBackground: "#c8862c", activeMatchColorOverviewRuler: "#f2a65a" },
  };
  if (back) search.findPrevious(query, options);
  else search.findNext(query, options);
}

/** 찾기를 끝낸다. 칠해 둔 것을 지운다 */
export function findEnd(key: string) {
  pool.get(key)?.search.clearDecorations();
}

/** 찾은 개수와 지금 몇 번째인지가 바뀔 때마다 알려 달라고 건다. 돌려주는 함수를 부르면 그만 듣는다 */
export function onFound(key: string, listener: (at: number, count: number) => void): () => void {
  const search = pool.get(key)?.search;
  if (!search) return () => {};
  const sub = search.onDidChangeResults((r) => listener(r.resultIndex, r.resultCount));
  return () => sub.dispose();
}

/** 마지막으로 친 지 얼마나 됐나. 치는 중인 칸은 바꿔 끼우지 않는다 */
export const idle = (key: string) => Date.now() - (pool.get(key)?.typedAt ?? 0);
/** 화면에 마지막으로 뭔가 나온 때. 일하는 세션은 진행 표시가 계속 움직인다 */
export const outAt = (key: string) => pool.get(key)?.outAt ?? 0;
export const age = (key: string) => Date.now() - (pool.get(key)?.startedAt ?? 0);

/** 열려 있는 터미널과 앞으로 열 터미널의 색을 바꾼다 */
export function setTheme(next: ITheme) {
  theme = next;
  for (const entry of pool.values()) entry.term.options.theme = next;
}

export function setFontSize(size: number) {
  fontSize = size;
  for (const entry of pool.values()) {
    entry.term.options.fontSize = size;
    if (entry.opened && visible(entry)) entry.fit.fit();
  }
}

/** 화면에 보이는 글자 (점검용) */
export function text(key: string): string {
  const buffer = pool.get(key)?.term.buffer.active;
  if (!buffer) return "";
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").trim();
}

export function dispose(key: string) {
  const entry = pool.get(key);
  if (!entry) return;
  pool.delete(key);
  entry.observer.disconnect();
  entry.term.dispose();
  entry.el.remove();
  void invoke("pty_kill", { id: entry.id });
}

function open(entry: Entry) {
  const { term: t, el, id, spec } = entry;
  entry.opened = true;
  entry.startedAt = Date.now();
  t.open(el);
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    t.loadAddon(gl);
  } catch {
    // 가속이 안 되면 기본 그리기로 돈다
  }
  entry.fit.fit();
  entry.observer.observe(el);

  const send = (data: string) => {
    // 보내기(Enter)·취소(Ctrl+C)·줄 지우기(Ctrl+U)면 치던 글이 없어진 것이다. 방향키 같은 것은 세지 않는다
    if (data === "\x1b\r") entry.draft += 1;
    else if (/[\r\x03\x15]/.test(data) && !data.startsWith("\x1b[200~")) entry.draft = 0;
    else if (!data.startsWith("\x1b") || data.startsWith("\x1b[200~"))
      entry.draft = Math.max(0, entry.draft + [...data].reduce((n, ch) => n + (ch === "\x7f" ? -1 : 1), 0));
    void invoke("pty_write", { id, data });
  };

  // macOS 웹뷰의 한글 입력기는 조합 이벤트를 보내지 않는다. 첫 자모는 insertText로,
  // 그 뒤로는 마지막 글자를 통째로 바꾸는 insertReplacementText로 온다 (ㅇ → 아 → 안).
  // xterm은 뒤쪽을 무시하므로 여기서 직접 받아, 앞서 보낸 글자를 지우고 바뀐 글자를 다시 보낸다.
  let pending = ""; // 아직 바뀔 수 있는 마지막 글자
  let lastKeyCode = 0;
  const MODIFIERS = new Set([16, 17, 18, 20, 91, 93]);
  el.addEventListener(
    "keydown",
    (e) => {
      lastKeyCode = e.keyCode;
      if (e.keyCode !== 229 && !MODIFIERS.has(e.keyCode)) pending = "";
    },
    true,
  );
  el.addEventListener(
    "input",
    (ev) => {
      const e = ev as InputEvent;
      if (e.isComposing) return; // 조합 이벤트를 제대로 보내는 입력기는 xterm에 맡긴다
      if (e.inputType === "insertText" && e.data) {
        e.stopPropagation();
        send(e.data);
        pending = [...e.data].pop()!;
      } else if (e.inputType === "insertReplacementText" && e.data != null) {
        e.stopPropagation();
        if (e.data !== pending) {
          send("\x7f".repeat([...pending].length) + e.data);
          pending = [...e.data].pop() ?? "";
        }
      } else if (e.inputType === "deleteContentBackward") {
        if (lastKeyCode === 229) {
          e.stopPropagation();
          send("\x7f");
        }
        pending = "";
      }
    },
    true,
  );
  el.addEventListener("focusout", () => (pending = ""), true);
  el.addEventListener("focusin", () => handlers.onFocus(spec.key));

  // 붙여넣기는 직접 처리한다. 그림이면 임시 파일 경로가, 글자면 글자가 들어간다.
  el.addEventListener(
    "paste",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      void invoke<string>("clipboard_paste")
        .then((clip) => t.paste(clip))
        .catch(() => {});
    },
    true,
  );

  t.attachCustomKeyEventHandler((e) => {
    // Shift+Enter는 줄바꿈으로 보낸다 (Claude Code가 받는 Alt+Enter 형식).
    // keydown에서만 보내고 keypress까지 막는다. keypress를 놔두면 xterm이 Enter를 한 번 더 보낸다.
    if (e.key === "Enter" && e.shiftKey && !e.isComposing) {
      if (e.type === "keydown") send("\x1b\r");
      return false;
    }
    return true;
  });

  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (data) => {
    entry.outAt = Date.now();
    t.write(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));
  };
  void invoke("pty_spawn", { id, cols: t.cols, rows: t.rows, cwd: spec.cwd, command: spec.command, stripEnv: config.stripEnv, onData: channel }).catch(
    (e) => t.write(`\r\n터미널을 띄우지 못했다: ${e}\r\n`),
  );
  t.onData((data) => {
    // 창 포커스가 오갈 때 터미널이 알아서 보내는 것은 내가 친 게 아니다
    // 내가 친 것만 센다. 터미널이 프로그램의 물음에 알아서 답하는 것(커서 위치, 장치 정보)과 방향키는 \x1b로 시작한다
    if (!data.startsWith("\x1b")) entry.typedAt = Date.now();
    send(data);
  });
  t.onResize(({ cols, rows }) => void invoke("pty_resize", { id, cols, rows }));
}
