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
  /** 터미널 16색. 밝은 테마는 바꿔야 글자가 보이고, 이름난 테마는 그 테마의 색을 쓴다 */
  ansi?: Record<string, string>;
};

export const THEMES: Theme[] = [
  { id: "navy", name: tr("남색"), note: tr("푸른 기가 도는 어두운 바탕"), bg: "#0b1620", surface: "#101e2b", ink: "#dbe7f1", muted: "#8499ab", line: "#1b2c3c", accent: "#6cb4ee", accentSoft: "#16324a", ok: "#6fd19c", wait: "#f0906a", waitSoft: "#3d2014", vis: "#132433", selection: "#24506f" },
  { id: "ink", name: tr("먹"), note: tr("기본. 색 기운이 없는 검정. 터미널 본래 느낌"), bg: "#0c0c0e", surface: "#151518", ink: "#e4e4e7", muted: "#8c8c96", line: "#26262b", accent: "#8ab4f8", accentSoft: "#1f2a3d", ok: "#7bd8a0", wait: "#f2a65a", waitSoft: "#3a2a14", vis: "#1b1b20", selection: "#3a4a66" },
  { id: "graphite", name: tr("흑연"), note: tr("회색조. 바탕은 더 검고 고른 줄은 파랑 대신 회색으로 뜬다"), bg: "#0a0a0a", surface: "#171717", ink: "#f0f0f0", muted: "#a3a3a3", line: "#262626", accent: "#7aa7ff", accentSoft: "#2a2a2a", ok: "#6ed69a", wait: "#f5a35c", waitSoft: "#3a2a14", vis: "#1f1f1f", selection: "#404040" },
  { id: "forest", name: tr("숲"), note: tr("짙은 녹색. 눈이 편한 쪽"), bg: "#0c1411", surface: "#121c18", ink: "#dbe8e0", muted: "#86998f", line: "#1e2c26", accent: "#6fcf97", accentSoft: "#173426", ok: "#8fd6b0", wait: "#f0a35e", waitSoft: "#3b2713", vis: "#16241e", selection: "#285741" },
  { id: "plum", name: tr("자두"), note: tr("보랏빛 어두운 바탕"), bg: "#14101b", surface: "#1b1625", ink: "#e6e0f0", muted: "#9a8fab", line: "#2a2338", accent: "#b79cf2", accentSoft: "#2c2247", ok: "#7fd3a6", wait: "#f29a76", waitSoft: "#3e2118", vis: "#221b30", selection: "#4a3a78" },
  { id: "sand", name: tr("모래"), note: tr("따뜻한 갈색 바탕에 청록"), bg: "#191613", surface: "#211d19", ink: "#ebe1d3", muted: "#a39584", line: "#322c25", accent: "#7fc4b4", accentSoft: "#1e3833", ok: "#a6c97a", wait: "#ef7f5a", waitSoft: "#40201a", vis: "#2a251f", selection: "#4d4336" },
  // 널리 쓰는 터미널 테마. 이름은 고유 이름이라 옮기지 않는다. 터미널 16색도 그 테마의 것을 쓴다
  {
    id: "tokyo-night", name: "Tokyo Night", note: tr("남보라 바탕에 또렷한 파랑"), bg: "#1a1b26", surface: "#1f2335", ink: "#c0caf5", muted: "#737aa2", line: "#292e42", accent: "#7aa2f7", accentSoft: "#283457", ok: "#9ece6a", wait: "#ff9e64", waitSoft: "#3b2a1e", vis: "#24283b", selection: "#33467c",
    ansi: { black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6", brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5" },
  },
  {
    id: "catppuccin", name: "Catppuccin Mocha", note: tr("부드러운 파스텔 색의 어두운 바탕"), bg: "#1e1e2e", surface: "#262637", ink: "#cdd6f4", muted: "#9399b2", line: "#313244", accent: "#89b4fa", accentSoft: "#2e3a5c", ok: "#a6e3a1", wait: "#fab387", waitSoft: "#40291f", vis: "#2a2b3d", selection: "#45475a",
    ansi: { black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de", brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8" },
  },
  {
    id: "dracula", name: "Dracula", note: tr("보라와 분홍이 선명한 어두운 바탕"), bg: "#282a36", surface: "#303341", ink: "#f8f8f2", muted: "#8b93b8", line: "#3b3e50", accent: "#bd93f9", accentSoft: "#3d3560", ok: "#50fa7b", wait: "#ffb86c", waitSoft: "#4a3520", vis: "#343746", selection: "#44475a",
    ansi: { black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2", brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff" },
  },
  {
    id: "nord", name: "Nord", note: tr("차분한 청회색"), bg: "#2e3440", surface: "#353c4a", ink: "#e5e9f0", muted: "#9aa5b8", line: "#434c5e", accent: "#88c0d0", accentSoft: "#3a4f5c", ok: "#a3be8c", wait: "#d08770", waitSoft: "#4a3830", vis: "#3b4252", selection: "#4c566a",
    ansi: { black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0", brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4" },
  },
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
  terms.setTheme({ background: t.bg, foreground: t.ink, cursor: t.accent, cursorAccent: t.bg, selectionBackground: t.selection, ...t.ansi }, { fg: t.accent, bg: t.accentSoft });
}
