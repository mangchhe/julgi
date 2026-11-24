// 터미널 풀. 터미널은 칸과 따로 산다. 칸에는 보이는 것만 끼우고,
// 안 보이는 터미널은 화면 밖에 세워 둔 채 계속 돌린다. 그래서 전환이 즉시다.
import { Channel, invoke } from "@tauri-apps/api/core";
import { findPaths, resolvePath } from "./paths.ts";
import { listen } from "@tauri-apps/api/event";
import { ITheme, Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { tr } from "./i18n";
import { config } from "./model";
import { openPr, prOf } from "./pr";
import { findKeys, keyOfUrl, openTicket } from "./jira";

export type TermSpec = { key: string; cwd?: string; command?: string };

type Entry = {
  spec: TermSpec;
  /** 그래픽 가속. 자리를 잃으면 비워 두었다가 다시 칸에 올릴 때 얻는다 */
  gl?: WebglAddon;
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
  /** 무슨 키든 마지막으로 누른 때 (화살표와 Esc도 센다) */
  keyAt: number;
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

/** ⌘를 누른 채 누른 링크를 연다. 파일 링크(file://)는 그 파일을 기본 앱으로 연다 */
function openLink(e: MouseEvent, uri: string) {
  if (!e.metaKey) return;
  if (uri.startsWith("file://")) {
    // file://host/path 형식이면 host를 버린다. 뒤에 붙은 :줄번호는 파일 이름이 아니다
    const path = decodeURIComponent(new URL(uri).pathname).replace(/:\d+(:\d+)?$/, "");
    void openPath(path).catch(() => {});
  } else {
    const pr = prOf(uri);
    // 연결한 Jira 사이트의 티켓 주소면 티켓 화면으로
    const ticket = config.jiraSite && uri.startsWith(config.jiraSite) ? keyOfUrl(uri) : undefined;
    if (pr) openPr(pr);
    else if (ticket) openTicket(ticket);
    else void openUrl(uri).catch(() => {});
  }
}

// 홈 폴더. ~/로 시작하는 경로를 여는 데 쓴다
let home = "";
void invoke<string>("home_dir").then((h) => (home = h), () => {});

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
    // Claude Code는 PR·파일 경로를 터미널 하이퍼링크(OSC 8)로 보낸다. 기본 처리는 file://을 버리고 http도 웹뷰에서 못 연다
    linkHandler: { activate: openLink, allowNonHttpProtocols: true },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  // 링크는 ⌘를 누른 채 눌러야 열린다. 그냥 누르면 글자 선택과 헷갈린다.
  term.loadAddon(new WebLinksAddon(openLink));
  // 파일 경로는 Claude Code가 링크로 보내지 않는다. 화면에서 찾아 ⌘를 누른 채 누르면 세션 폴더 기준으로 연다
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return callback(undefined);
      // 한글은 두 칸을 차지해서 글자 위치와 화면 칸이 다르다. 글자마다 시작 칸을 적어 둔다
      let text = "";
      const col: number[] = [];
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        for (const _ of chars) col.push(x);
        text += chars;
      }
      // 티켓 키(아는 프로젝트 키만): ⌘ 클릭하면 티켓 화면
      const tickets = findKeys(text).map(({ start, end, key }) => ({
        range: { start: { x: col[start] + 1, y }, end: { x: col[end - 1] + 1, y } },
        text: key,
        activate: (e: MouseEvent) => e.metaKey && openTicket(key),
      }));
      const links = findPaths(text.trimEnd()).map(({ start, end, path }) => ({
        range: { start: { x: col[start] + 1, y }, end: { x: col[end - 1] + 1, y } },
        text: path,
        activate: (e: MouseEvent) => {
          if (!e.metaKey) return;
          // 파일이면 기본 앱으로, 폴더면 Finder로 열린다
          void openPath(resolvePath(path, spec.cwd ?? "", home)).catch(() => {});
        },
      }));
      const all = [...tickets, ...links];
      callback(all.length ? all : undefined);
    },
  });
  const search = new SearchAddon();
  term.loadAddon(search);
  const el = document.createElement("div");
  el.className = "term";
  const entry: Entry = { spec, id: nextId++, term, fit, search, el, opened: false, startedAt: 0, typedAt: 0, keyAt: 0, draft: 0, outAt: Date.now(), observer: new ResizeObserver(() => {}) };
  entry.observer = new ResizeObserver(() => {
    if (entry.opened && visible(entry)) fit.fit();
  });
  pool.set(spec.key, entry);
}

/**
 * 갈아탈 때: 이전 터미널에 보이던 글의 끝부분을 새 터미널 맨 위에 흐리게 옮겨 적고 경계선을 긋는다.
 * 보던 화면이 통째로 사라지지 않고, 한 세션이 이어지는 것처럼 보인다. 새 세션이 띄워지기 전에 부른다
 */
export function carry(from: string, to: string, note: string) {
  const a = pool.get(from);
  const b = pool.get(to);
  if (!a || !b) return;
  const buf = a.term.buffer.active;
  const lines: string[] = [];
  for (let y = Math.max(0, buf.length - 400); y < buf.length; y++) lines.push(buf.getLine(y)?.translateToString(true) ?? "");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // 같은 칸에 들어가니 폭을 맞춰 둔다. 줄이 다시 접히지 않는다
  b.term.resize(a.term.cols, a.term.rows);
  b.term.write(`\x1b[2m${lines.join("\r\n")}\x1b[0m\r\n\r\n\x1b[2m── ${note} ──\x1b[0m\r\n\r\n`);
}

/**
 * 내가 한 말(프롬프트 줄)을 찾아 그 줄이 화면 맨 위에 오게 옮긴다. 긴 답을 처음부터 읽을 때 끌어 올리지 않아도 된다.
 * dir -1: 지금 화면보다 위에 있는 가장 가까운 내 말(= 보고 있는 답의 시작), +1: 아래의 다음 내 말. 더 없으면 맨 위/맨 아래로 간다
 */
export function jumpTurn(key: string, dir: -1 | 1) {
  const entry = pool.get(key);
  if (!entry?.opened) return;
  const t = entry.term;
  const buf = t.buffer.active;
  // Claude Code는 내가 한 말을 "> 말" 한 줄로 되적는다. 맨 아래의 입력칸(커서가 있는 줄 언저리)은 뺀다
  const asked = (y: number) => {
    const line = buf.getLine(y);
    return !!line && !line.isWrapped && /^[>❯›]\s+\S/.test(line.translateToString(true));
  };
  const input = buf.baseY + buf.cursorY - 1;
  if (dir < 0) {
    for (let y = buf.viewportY - 1; y >= 0; y--) if (asked(y)) return t.scrollToLine(y);
    t.scrollToTop();
  } else {
    for (let y = buf.viewportY + 1; y < input; y++) if (asked(y)) return t.scrollToLine(y);
    t.scrollToBottom();
  }
}

/** 칸에 있던 터미널을 화면 밖으로 내보낸다 */
export function park(container: HTMLElement) {
  parking().append(...container.children);
}

/**
 * 그래픽 가속(WebGL)으로 그리게 한다. 가속이 없으면 스크롤이 눈에 띄게 느리다.
 * 브라우저는 한 창에서 쓸 수 있는 가속 자리가 정해져 있어서(열여섯쯤), 터미널을 많이 열어 두면 오래된 것부터 자리를 잃는다.
 * 잃으면 느린 기본 그리기로 내려가는데, 그대로 두지 않고 그 터미널을 다시 칸에 올릴 때 자리를 다시 얻는다
 */
function accelerate(entry: Entry) {
  if (entry.gl) return;
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => {
      gl.dispose();
      entry.gl = undefined;
    });
    entry.term.loadAddon(gl);
    entry.gl = gl;
  } catch {
    // 가속이 안 되면 기본 그리기로 돈다
  }
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
    accelerate(entry);
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
/** 그 칸에 마지막으로 키를 누른 때 */
export const keyAt = (key: string) => pool.get(key)?.keyAt ?? 0;
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
/**
 * 터미널에 찍힌 글. tail을 주면 끝의 그만큼만 읽는다.
 * 기록 전체는 2만 줄까지 쌓이고, 전부 글로 바꾸는 데 수십 밀리초가 걸린다. 그동안 화면이 멈춘다.
 * 물음이 떠 있는지 주기적으로 보는 쪽은 끝부분만 읽으면 된다(물음은 늘 맨 아래에 뜬다)
 */
export function text(key: string, tail?: number): string {
  const buffer = pool.get(key)?.term.buffer.active;
  if (!buffer) return "";
  const lines: string[] = [];
  for (let i = tail ? Math.max(0, buffer.length - tail) : 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
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
  accelerate(entry);
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
  // xterm이 키 이벤트로 막 보낸 글자. 웹뷰는 Space 같은 키에 같은 글자를 input으로 한 번 더 준다(그대로 보내면 두 칸이 된다)
  let keySent = { data: "", at: 0 };
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
        if (e.data === keySent.data && performance.now() - keySent.at < 100) return;
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
  void invoke("pty_spawn", { id, cols: t.cols, rows: t.rows, cwd: spec.cwd, command: spec.command, stripEnv: config.stripEnv, fallbackDir: config.defaultDir || null, onData: channel }).catch(
    (e) => t.write(`\r\n${tr`터미널을 띄우지 못했다: ${e}`}\r\n`),
  );
  t.onData((data) => {
    // 창 포커스가 오갈 때 터미널이 알아서 보내는 것은 내가 친 게 아니다
    // 내가 친 것만 센다. 터미널이 프로그램의 물음에 알아서 답하는 것(커서 위치, 장치 정보)과 방향키는 \x1b로 시작한다
    entry.keyAt = Date.now();
    if (!data.startsWith("\x1b")) entry.typedAt = Date.now();
    keySent = { data, at: performance.now() };
    send(data);
  });
  t.onResize(({ cols, rows }) => void invoke("pty_resize", { id, cols, rows }));
}
