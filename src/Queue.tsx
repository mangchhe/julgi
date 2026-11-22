import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ago } from "./model";

export type Waiting = { key: string; name: string; repo: string; state: string; since: number; sessionId?: string };
type Props = {
  rows: Waiting[];
  /** 그 세션에 답을 보낸다 */
  onAnswer: (key: string, text: string) => void;
  /** 그 세션을 칸에 올린다 */
  onOpen: (key: string) => void;
  onClose: () => void;
};

/** 답의 끝에서 묻는 말을 꺼낸다: 물음표가 있는 마지막 문단. 없으면 빈 글자 */
const question = (reply: string) => {
  const parts = reply.trim().split(/\n\s*\n/);
  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) if (/[?？]/.test(parts[i])) return parts[i].trim();
  return "";
};

/**
 * 내 차례 (⌘J). 답을 기다리는 세션을 오래 기다린 순으로 놓고, 마지막에 무엇을 물었는지 보여 준다.
 * 여기서 바로 답을 쳐서 보내면 세션을 열어 읽고 돌아오는 왕복이 없다. 더 읽어야 하면 빈 채로 Enter를 눌러 연다
 */
export default function Queue({ rows, onAnswer, onOpen, onClose }: Props) {
  // 답을 보낸 세션은 상태가 바뀌기를 기다리지 않고 바로 뺀다
  const [gone, setGone] = useState<string[]>([]);
  const list = useMemo(() => rows.filter((r) => !gone.includes(r.key)), [rows, gone]);
  const [at, setAt] = useState(0);
  const row = list[Math.min(at, list.length - 1)];
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), [row?.key]);
  useEffect(() => {
    if (!row?.sessionId || replies[row.key] !== undefined) return;
    const key = row.key;
    void invoke<string | null>("last_reply", { sessionId: row.sessionId }).then(
      (reply) => setReplies((old) => ({ ...old, [key]: reply ?? "" })),
      () => setReplies((old) => ({ ...old, [key]: "" })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.key]);
  // 다 답했으면 닫는다
  useEffect(() => {
    if (rows.length && !list.length) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const reply = row ? replies[row.key] : undefined;
  const asked = reply ? question(reply) : "";
  const rest = reply ? (asked ? reply.slice(0, reply.lastIndexOf(asked)).trim() : reply.trim()) : "";
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (!row) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt((Math.min(at, list.length - 1) + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
      setText("");
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // 빈 채로 누르거나 ⌘Enter면 세션을 연다. 확인을 묻는 세션(허락 창)은 글로 답할 수 없어 늘 연다
      if (!text.trim() || e.metaKey || row.state === "ask") return onOpen(row.key), onClose();
      onAnswer(row.key, text.trim());
      setGone((old) => [...old, row.key]);
      setText("");
    }
  };

  return (
    <div className="pal-back wide" onMouseDown={onClose}>
      <div className="qu" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="qu-list">
          <div className="qu-head">내 차례 {list.length}</div>
          {list.map((r, i) => (
            <button key={r.key} type="button" tabIndex={-1} className={"qu-row" + (r.key === row?.key ? " on" : "")} onClick={() => (setAt(i), setText(""))}>
              <b>{r.name}</b>
              <small>
                {r.repo} · {r.state === "ask" ? "확인이 필요함" : "답함"} · {ago(r.since / 1000)}
              </small>
            </button>
          ))}
        </div>
        <div className="qu-main">
          {row && (
            <>
              <div className="qu-reply">
                {reply === undefined && <small>읽는 중</small>}
                {reply === "" && <small>마지막 답을 읽지 못했다. Enter로 세션을 연다.</small>}
                {rest && <pre className="qu-rest">{rest.split("\n").slice(-40).join("\n")}</pre>}
                {asked && <pre className="qu-asked">{asked}</pre>}
                {reply && !asked && <small>묻는 말로 끝나지 않았다. 답을 다 한 것일 수 있다.</small>}
              </div>
              <textarea
                ref={input}
                rows={2}
                value={text}
                placeholder={row.state === "ask" ? "허락을 묻고 있다. Enter로 세션을 열어 고른다" : "여기에 답을 치고 Enter · 빈 채로 Enter면 세션을 연다"}
                onChange={(e) => setText(e.target.value)}
              />
            </>
          )}
          <div className="pal-foot">↑↓ 세션 고르기 · Enter 답 보내기 (빈 채면 세션 열기) · ⌘Enter 세션 열기 · ⇧Enter 줄바꿈 · Esc</div>
        </div>
      </div>
    </div>
  );
}
