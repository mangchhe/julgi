import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { adfToMd, JiraConn, openTicket, TicketFull } from "./jira";
import { tr } from "./i18n";
import { md } from "./md";
import { ago } from "./model";
import { openPr, prOf } from "./pr";

type Transition = { id: string; name: string; to: string; category: string };

type Props = {
  ticketKey: string;
  conn: JiraConn;
  onClose: () => void;
  /** 이 티켓으로 시작 (워크트리 + 새 세션) */
  onStart: (t: TicketFull) => void;
  /** 이 티켓과 이어진 세션들. 누르면 그 세션을 연다 */
  sessions: { id: string; name: string }[];
  onOpenSession: (id: string) => void;
  inline?: boolean;
  autoFocus?: boolean;
};

const when = (iso: string) => (iso ? ago(Date.parse(iso) / 1000) : "");

/** 마크다운 글. 안의 링크는 PR이면 PR 화면, 티켓이면 티켓 화면, 아니면 브라우저로 */
function Md({ text }: { text: string }) {
  return (
    <div
      className="pr-text md"
      dangerouslySetInnerHTML={{ __html: md(text) }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        e.preventDefault();
        const pr = prOf(a.href);
        const key = a.href.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1];
        if (pr) openPr(pr);
        else if (key) openTicket(key);
        else void openUrl(a.href);
      }}
    />
  );
}

/** 티켓 화면. 설명·하위 작업·코멘트를 보고, 코멘트를 달고, 상태를 옮기고, 이 티켓으로 일을 시작한다 */
export default function TicketView({ ticketKey, conn, onClose, onStart, sessions, onOpenSession, inline = false, autoFocus = true }: Props) {
  const [t, setT] = useState<TicketFull | null>(null);
  const [error, setError] = useState("");
  const [loads, setLoads] = useState(0);
  const [moves, setMoves] = useState<Transition[] | null>(null); // 펼친 전환 목록
  const [moveNote, setMoveNote] = useState("");
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    setError("");
    void invoke<TicketFull>("jira_view", { conn, key: ticketKey }).then(setT, (e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketKey, loads]);

  const send = async (label: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(label);
    setError("");
    try {
      await invoke(cmd, { conn, key: ticketKey, ...args });
      setLoads((n) => n + 1);
      return true;
    } catch (e) {
      setError(tr`${label} 실패: ${String(e)}`);
      return false;
    } finally {
      setBusy("");
    }
  };
  const openMoves = () => {
    if (moves) return setMoves(null);
    void invoke<Transition[]>("jira_transitions", { conn, key: ticketKey }).then(setMoves, (e) => setError(String(e)));
  };
  const move = async (step: Transition) => {
    if (await send(tr`${step.to}로 옮기기`, "jira_transition", { id: step.id, comment: moveNote })) (setMoves(null), setMoveNote(""));
  };
  const comment = async () => {
    if (say.trim() && (await send(tr`코멘트`, "jira_comment", { body: say }))) setSay("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type === "text")) {
      if (e.key === "Escape") (setMoves(null), box.current?.focus());
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target instanceof HTMLTextAreaElement) (e.preventDefault(), void comment());
      return;
    }
    if (e.key === "Escape") {
      if (moves) setMoves(null);
      else onClose();
    } else if (e.key === "s") openMoves();
    else if (e.key === "c") box.current?.querySelector<HTMLTextAreaElement>(".tk-say textarea")?.focus();
    else if (e.key === "Enter" && t) onStart(t);
    else if (e.key === "o" && t) void openUrl(t.url);
    else if (e.key === "r") setLoads(loads + 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const cat = t?.statusCategory;
  return (
    <div className={inline ? "pr-inline" : "pr-wrap"}>
      <div className="rv tk" ref={box} tabIndex={-1} onKeyDown={onKey}>
        <div className="rv-top pr-top">
          <div className="pr-title">
            <span className="pr-no">{ticketKey}</span>
            <b>{t?.title ?? (error ? "" : tr`읽는 중`)}</b>
          </div>
          {error && <div className="pr-error">{/401|연결돼 있지/.test(error) ? tr`Jira에 연결돼 있지 않거나 토큰이 만료됐다. ⌘,의 연결에서 다시 연결한다.` : error}</div>}
          {t && (
            <div className="rv-git">
              <button type="button" tabIndex={-1} className={"tk-status c-" + cat} onClick={openMoves} title={tr`상태 옮기기 (s)`}>
                {t.status} ▾
              </button>
              {t.type && <span>{t.type}</span>}
              {t.priority && <span>{t.priority}</span>}
              {t.sprint && <span>{t.sprint}</span>}
              <span>{t.assignee ? tr`담당 ${t.assignee}` : tr`담당 없음`}</span>
              {t.reporter && <span>{tr`보고 ${t.reporter}`}</span>}
              {t.parent && (
                <button type="button" tabIndex={-1} onClick={() => openTicket(t.parent)}>
                  {tr`상위 ${t.parent}`}
                </button>
              )}
              <span>{tr`${when(t.updated)} 수정`}</span>
              {sessions.map((s) => (
                <button key={s.id} type="button" tabIndex={-1} onClick={() => onOpenSession(s.id)} title={tr`이 티켓과 이어진 세션 열기`}>
                  {tr`세션 "${s.name.slice(0, 24)}"`}
                </button>
              ))}
              <button type="button" tabIndex={-1} className="pr-merge-btn" onClick={() => onStart(t)} title={tr`워크트리를 따고 이 티켓을 첫 지시로 새 세션을 연다 (Enter)`}>
                {tr`이 티켓으로 시작`}
              </button>
              <button type="button" tabIndex={-1} onClick={() => void openUrl(t.url)}>
                {tr`웹에서 열기`}
              </button>
            </div>
          )}
          {moves && (
            <div className="pr-merge">
              <span className="sub">{tr`지금 고를 수 있는 전환`}</span>
              {moves.length === 0 && <span className="sub">{tr`없다 (권한이나 워크플로를 확인한다)`}</span>}
              {moves.map((m) => (
                <button key={m.id} type="button" tabIndex={-1} disabled={!!busy} onClick={() => void move(m)}>
                  → {m.to || m.name}
                </button>
              ))}
              <input className="pr-close-note" value={moveNote} placeholder={tr`같이 남길 코멘트 (선택)`} onChange={(e) => setMoveNote(e.target.value)} />
            </div>
          )}
        </div>
        <div className="tk-main">
          <div className="tk-desc">
            <div className="rv-hist-head">{tr`설명`}</div>
            {t ? t.description ? <Md text={adfToMd(t.description)} /> : <div className="pr-text muted">{tr`(설명 없음)`}</div> : null}
            {t && t.subtasks.length > 0 && (
              <>
                <div className="rv-hist-head" style={{ marginTop: 16 }}>
                  {tr`하위 작업 ${t.subtasks.filter((s) => s.statusCategory === "done").length} / ${t.subtasks.length}`}
                </div>
                {t.subtasks.map((s) => (
                  <button key={s.key} type="button" tabIndex={-1} className="tk-sub" onClick={() => openTicket(s.key)}>
                    <em>{s.key}</em> {s.title} <span className={"c-" + s.statusCategory}>{s.status}</span>
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="rv-hist pr-talk">
            <div className="rv-hist-head">{tr`코멘트 ${t?.comments.length ?? ""}`}</div>
            {t?.comments.map((c, i) => (
              <div key={i} className="pr-item">
                <div>
                  <b>{c.who}</b> <small>{when(c.at)}</small>
                </div>
                <Md text={adfToMd(c.body)} />
              </div>
            ))}
            {t && (
              <div className="pr-say tk-say">
                <textarea rows={3} value={say} placeholder={tr`코멘트 · ⌘Enter로 올린다`} onChange={(e) => setSay(e.target.value)} />
                <div className="pr-acts">
                  <button type="button" tabIndex={-1} disabled={!say.trim() || !!busy} onClick={() => void comment()}>
                    {busy || tr`코멘트`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="pal-foot">{tr`s 상태 옮기기 · c 코멘트 · Enter 이 티켓으로 시작 · o 웹에서 열기 · r 새로 읽기 · Esc`}</div>
      </div>
    </div>
  );
}
