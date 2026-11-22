import * as terms from "./terms";
import { tr } from "./i18n";

/** 화면 색 한 벌. 주황(wait)은 어느 테마에서든 "내 답을 기다린다"에만 쓴다 */
export type Theme = {
  id: string;
  name: string;
  note: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentSoft: string;
  ok: string;
  wait: string;
  waitSoft: string;
  /** 칸에 떠 있는 세션의 줄 바탕 */
  vis: string;
  /** 터미널에서 끌어 고른 글자의 바탕 */
  selection: string;
  /** 밝은 테마는 터미널 기본 16색도 바꿔야 글자가 보인다 */
  ansi?: Record<string, string>;
};

export const THEMES: Theme[] = [
  { id: "navy", name: tr("남색"), note: tr("푸른 기가 도는 어두운 바탕"), bg: "#0b1620", surface: "#101e2b", ink: "#dbe7f1", muted: "#8499ab", line: "#1b2c3c", accent: "#6cb4ee", accentSoft: "#16324a", ok: "#6fd19c", wait: "#f0906a", waitSoft: "#3d2014", vis: "#132433", selection: "#24506f" },
  { id: "ink", name: tr("먹"), note: tr("기본. 색 기운이 없는 검정. 터미널 본래 느낌"), bg: "#0c0c0e", surface: "#151518", ink: "#e4e4e7", muted: "#8c8c96", line: "#26262b", accent: "#8ab4f8", accentSoft: "#1f2a3d", ok: "#7bd8a0", wait: "#f2a65a", waitSoft: "#3a2a14", vis: "#1b1b20", selection: "#3a4a66" },
  { id: "forest", name: tr("숲"), note: tr("짙은 녹색. 눈이 편한 쪽"), bg: "#0c1411", surface: "#121c18", ink: "#dbe8e0", muted: "#86998f", line: "#1e2c26", accent: "#6fcf97", accentSoft: "#173426", ok: "#8fd6b0", wait: "#f0a35e", waitSoft: "#3b2713", vis: "#16241e", selection: "#285741" },
  { id: "plum", name: tr("자두"), note: tr("보랏빛 어두운 바탕"), bg: "#14101b", surface: "#1b1625", ink: "#e6e0f0", muted: "#9a8fab", line: "#2a2338", accent: "#b79cf2", accentSoft: "#2c2247", ok: "#7fd3a6", wait: "#f29a76", waitSoft: "#3e2118", vis: "#221b30", selection: "#4a3a78" },
  { id: "sand", name: tr("모래"), note: tr("따뜻한 갈색 바탕에 청록"), bg: "#191613", surface: "#211d19", ink: "#ebe1d3", muted: "#a39584", line: "#322c25", accent: "#7fc4b4", accentSoft: "#1e3833", ok: "#a6c97a", wait: "#ef7f5a", waitSoft: "#40201a", vis: "#2a251f", selection: "#4d4336" },
  {
    id: "paper", name: tr("종이"), note: tr("밝은 바탕. Claude Code에서도 /theme을 밝은 것으로 바꿔야 글자가 잘 보인다"), bg: "#f6f4ef", surface: "#ffffff", ink: "#22262b", muted: "#6b7280", line: "#dedad2", accent: "#1f6fb5", accentSoft: "#dbe9f6", ok: "#1f8a55", wait: "#c2501f", waitSoft: "#fbe3d6", vis: "#edf1f5", selection: "#bcd6ee",
    ansi: { black: "#22262b", red: "#b3261e", green: "#1f8a55", yellow: "#946200", blue: "#1f6fb5", magenta: "#8b3fa8", cyan: "#0f7b8a", white: "#6b7280", brightBlack: "#6b7280", brightRed: "#c2362d", brightGreen: "#237a4f", brightYellow: "#7d5300", brightBlue: "#1a5f9c", brightMagenta: "#7a3594", brightCyan: "#0c6976", brightWhite: "#22262b" },
  },
];

export const themeOf = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** 화면과 열려 있는 터미널 전부에 색을 입힌다 */
export function applyTheme(id: string) {
  const t = themeOf(id);
  const root = document.documentElement.style;
  const vars: Record<string, string> = { bg: t.bg, surface: t.surface, ink: t.ink, muted: t.muted, line: t.line, accent: t.accent, "accent-soft": t.accentSoft, ok: t.ok, wait: t.wait, "wait-soft": t.waitSoft, vis: t.vis };
  for (const [name, value] of Object.entries(vars)) root.setProperty("--" + name, value);
  terms.setTheme({ background: t.bg, foreground: t.ink, cursor: t.accent, cursorAccent: t.bg, selectionBackground: t.selection, ...t.ansi });
}
