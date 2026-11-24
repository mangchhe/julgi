/** Jira 연동의 화면 쪽 도우미: 연결 정보, 티켓 모양, ADF → 마크다운, 티켓 키 찾기, 새 소식 판정 */
import { tr } from "./i18n.ts";

export type JiraConn = { site: string; email: string; kind: string };
/** 목록 한 줄 (Rust row) */
export type Ticket = { key: string; url: string; title: string; status: string; statusCategory: string; type: string; priority: string; assignee: string; updated: string; others: number; by?: { name: string; id: string; app: boolean; mention?: boolean }[] };
/** 티켓 한 건 (Rust jira_view). description·comments.body는 Cloud면 ADF, Server면 글 */
export type TicketFull = {
  key: string;
  url: string;
  title: string;
  status: string;
  statusCategory: string;
  type: string;
  priority: string;
  assignee: string;
  reporter: string;
  sprint: string;
  parent: string;
  description: unknown;
  /** 첨부된 그림들. 내용은 jira_image로 받는다 */
  images?: { id: string; name: string }[];
  subtasks: { key: string; title: string; status: string; statusCategory: string }[];
  comments: { who: string; at: string; body: unknown }[];
  updated: string;
};

/** 볼 수 있는 프로젝트 키. 이 키로 시작하는 것만 티켓으로 본다 (UTF-8, SHA-256 같은 오탐을 막는다) */
let known = new Set<string>();
export const setKnownKeys = (keys: string[]) => void (known = new Set(keys));
const KEY = /\b([A-Z][A-Z0-9_]+)-(\d+)\b/g;
/** 글에서 티켓 키를 찾는다: 위치와 키 */
export function findKeys(text: string): { start: number; end: number; key: string }[] {
  const out: { start: number; end: number; key: string }[] = [];
  for (const m of text.matchAll(KEY)) if (known.has(m[1])) out.push({ start: m.index!, end: m.index! + m[0].length, key: m[0] });
  return out;
}
export const firstKey = (text: string) => findKeys(text)[0]?.key;

/** https://사이트/browse/ABC-123 → ABC-123 */
export const keyOfUrl = (url: string) => url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[?#/]|$)/)?.[1];

/** 티켓을 Julgi 안의 티켓 화면으로 연다. App이 받는다 */
export const openTicket = (key: string) => window.dispatchEvent(new CustomEvent<string>("julgi:ticket", { detail: key }));

/** 상태 범주 → 묶음 이름 */
/**
 * 티켓 하나에 Julgi가 아는 일을 붙인 것: 이어진 세션과 PR, 그리고 지금 누가 무엇을 할 차례인지.
 * rank가 작을수록 내가 먼저 봐야 한다. 0 내가 할 일, 1 돌아가는 중, 2 남을 기다림, 3 하다 만 일, 4 시작 안 함, 5 끝남
 */
export type TicketWork = { rank: number; step: string; detail?: string; /** 고르면 갈 세션(칸의 열쇠) */ session?: string; sessionName?: string; pr?: { repo: string; number: number } };

export const CATEGORY: Record<string, string> = { new: "할 일", indeterminate: "진행 중", done: "끝남" }; // i18n-ok

/**
 * Jira 본문(ADF 또는 Server의 위키 글)을 마크다운으로. 문단·제목·목록·코드·인용·링크·굵게·기울임·코드 조각·멘션을 옮기고,
 * 표는 칸을 " | "로 잇고, 첨부 그림은 [첨부]로 둔다. ponytail: 패널 색, 표 머리, 중첩 목록 들여쓰기는 버린다
 */
export function adfToMd(doc: unknown): string {
  if (typeof doc === "string") return wikiToMd(doc);
  if (!doc || typeof doc !== "object") return "";
  type Node = { type?: string; text?: string; content?: Node[]; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] };
  const inline = (n: Node): string => {
    if (n.type === "text") {
      let t = n.text ?? "";
      for (const m of n.marks ?? []) {
        if (m.type === "strong") t = `**${t}**`;
        else if (m.type === "em") t = `*${t}*`;
        else if (m.type === "code") t = "`" + t + "`";
        else if (m.type === "strike") t = `~~${t}~~`;
        else if (m.type === "link" && typeof m.attrs?.href === "string") t = `[${t}](${m.attrs.href})`;
      }
      return t;
    }
    if (n.type === "hardBreak") return "\n";
    if (n.type === "mention") return `@${String(n.attrs?.text ?? "").replace(/^@/, "")}`;
    if (n.type === "emoji") return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    if (n.type === "inlineCard" || n.type === "blockCard") return String(n.attrs?.url ?? "");
    if (n.type === "status") return `[${String(n.attrs?.text ?? "")}]`;
    return (n.content ?? []).map(inline).join("");
  };
  const block = (n: Node, depth = 0): string => {
    const kids = n.content ?? [];
    switch (n.type) {
      case "doc":
        return kids.map((k) => block(k, depth)).filter(Boolean).join("\n\n");
      case "paragraph":
        return kids.map(inline).join("");
      case "heading":
        return `${"#".repeat(Number(n.attrs?.level ?? 2))} ${kids.map(inline).join("")}`;
      case "bulletList":
      case "orderedList":
        return kids.map((li, i) => `${"  ".repeat(depth)}${n.type === "orderedList" ? `${i + 1}.` : "-"} ${(li.content ?? []).map((c) => block(c, depth + 1)).join("\n")}`).join("\n");
      case "taskList":
        return kids.map((t) => `- [${t.attrs?.state === "DONE" ? "x" : " "}] ${(t.content ?? []).map(inline).join("")}`).join("\n");
      case "codeBlock":
        return "```\n" + kids.map(inline).join("") + "\n```";
      case "blockquote":
      case "panel":
        return kids.map((k) => `> ${block(k, depth)}`).join("\n");
      case "rule":
        return "---";
      case "table":
        return kids.map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c, depth)).join(" ")).join(" | ")).join("\n");
      case "mediaSingle":
      case "mediaGroup":
      case "media":
        return "[첨부]"; // i18n-ok
      default:
        return kids.length ? kids.map((k) => block(k, depth)).join("\n") : inline(n);
    }
  };
  return block(doc as Node);
}

/** Server/Data Center의 위키 글을 마크다운에 가깝게. 제목·굵게·코드 묶음·목록만 */
function wikiToMd(text: string): string {
  return text
    .replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g, "```\n$1\n```")
    .replace(/^h([1-6])\.\s+/gm, (_, n) => "#".repeat(Number(n)) + " ")
    .replace(/^\*\s+/gm, "- ")
    .replace(/^#\s+/gm, "1. ")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1**$2**")
    .replace(/\{\{([^}]+)\}\}/g, "`$1`");
}

/**
 * 한꺼번에 맡긴 버그 한 건. queued 대기 → diag 진단 중 → decide 내가 정할 차례 → done 고치라고 함 / held 보류.
 * heldSince: 보류한 순간의 답. 그 답 그대로면 내 차례에 다시 올리지 않는다
 */
export type BugJob = { key: string; title: string; repo: string; cwd: string; state: "queued" | "diag" | "decide" | "done" | "held"; sessionId?: string; why?: string; heldSince?: number };

/** 지난번 감시 기록 한 건 */
export type TicketSeen = { status: string; others: number; assigned: boolean };

/** 내 티켓의 새 소식: 새로 배정됨, 상태가 바뀜, 남이 코멘트를 닮. 처음 보는 감시(기록이 비었음)는 알리지 않는다 */
export function ticketNews(before: TicketSeen | undefined, now: Ticket, firstRun: boolean): string {
  if (!before) return firstRun ? "" : tr`새로 배정됨`;
  if (now.status !== before.status) return tr`상태 → ${now.status}`;
  if (now.others > before.others) {
    const n = now.others - before.others;
    const fresh = (now.by ?? []).slice(before.others);
    const names = [...new Set(fresh.map((a) => a.name).filter(Boolean))];
    if (!names.length) return tr`새 코멘트 ${n}`;
    const who = names.length > 1 ? tr`${names[0]} 외 ${names.length - 1}명` : names[0];
    // 나를 @로 부른 댓글은 따로 적는다. 그냥 달린 댓글보다 먼저 봐야 한다
    return fresh.some((a) => a.mention) ? tr`@나 · ${who}` : tr`새 코멘트 ${n} · ${who}`;
  }
  return "";
}

/**
 * 소식의 속 내용. 글(ticketNews)만으로는 알 수 없는 것을 담는다: 어떤 종류인지, 새 댓글이 몇 개인지와 누가 달았는지,
 * 상태가 무엇에서 바뀌었는지, 나를 @로 불렀는지. title은 티켓이 목록에서 빠진 뒤에도 키 대신 보여 주려고 같이 둔다
 */
export type TicketNewsMeta = { title: string; kind: "assigned" | "status" | "comment"; count?: number; who?: string; was?: string; mention?: boolean };
export function ticketNewsMeta(before: TicketSeen | undefined, now: Ticket): TicketNewsMeta {
  if (!before) return { title: now.title, kind: "assigned" };
  if (now.status !== before.status) return { title: now.title, kind: "status", was: before.status };
  const fresh = (now.by ?? []).slice(before.others);
  return { title: now.title, kind: "comment", count: Math.max(1, now.others - before.others), who: [...new Set(fresh.map((a) => a.name).filter(Boolean))].join(", "), mention: fresh.some((a) => a.mention) };
}

/**
 * 이 소식을 조용히 받을 것인가: 새 댓글뿐이고, 그 댓글이 모두 봇(app 계정)이거나 조용히 받기로 한 작성자의 것일 때.
 * quiet: 쉼표로 나눈 표시 이름이나 accountId. 사람 댓글이 하나라도 섞이면 조용하지 않다
 */
export function quietNews(before: TicketSeen | undefined, now: Ticket, quiet: string): boolean {
  if (!before || now.status !== before.status || now.others <= before.others) return false;
  const fresh = (now.by ?? []).slice(before.others);
  const list = quiet.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return fresh.length > 0 && fresh.every((a) => a.app || list.includes(a.name.toLowerCase()) || list.includes(a.id.toLowerCase()));
}

/** "주문 취소 시 쿠폰 복구" → 브랜치에 쓸 영문 꼬리. 한글뿐이면 비운다 */
export const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
