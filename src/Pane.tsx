import { useEffect, useRef, useState } from "react";
import Info, { Member, ThreadOps } from "./Info";
import Review from "./CodeReview";
import { tr } from "./i18n";
import { Change, hot, kilo, repoOf, Session, STATE_LABEL, Thread } from "./model";
import * as terms from "./terms";

type Props = {
  /** 이 세션의 티켓이 끝났으면 그 사실("티켓 끝남 · 거부"). 누르면 세션을 끝낸다 */
  ticketEnded?: string;
  termKey: string | null;
  focused: boolean;
  /** 찾기 상자가 떠 있는 동안은 터미널이 포커스를 가져가지 않는다 */
  active: boolean;
  label: string;
  cwd: string;
  session?: Session;
  thread?: Thread;
  memory: string;
  state: string;
  members: Member[];
  thread_ops: ThreadOps;
  info: boolean;
  /** 화면 글자 찾기 줄이 열려 있는가 */
  finding: boolean;
  /** 갈아타는 중인가 */
  handing: boolean;
  /** 이 세션에 이어진 티켓에 새 소식이 있다. 누르면 티켓 화면을 연다 */
  ticketNote?: { text: string; mention: boolean; open: () => void };
  /** 방금 갈아타서 이어받은 세션이다 */
  handed?: boolean;
  /** 고정한 세션은 Julgi가 다른 세션으로 바꿔 끼우지 않는다 */
  pinned: boolean;
  /** 이 세션의 폴더에서 바뀐 것 */
  change?: Change;
  /** 있으면 터미널 자리에 코드 검토를 편다 */
  review?: React.ComponentProps<typeof Review>;
  onPin: () => void;
  onFindClose: () => void;
  onFocus: () => void;
};

export default function Pane({ termKey, focused, active, label, cwd, session, thread, memory, state, members, thread_ops, info, finding, handing, handed, ticketNote, pinned, change, review, ticketEnded, onPin, onFindClose, onFocus }: Props) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (termKey) terms.attach(termKey, body.current!);
    else terms.park(body.current!);
  }, [termKey]);

  useEffect(() => {
    // 코드 검토를 펴 둔 동안에는 터미널이 포커스를 가져가지 않는다
    if (focused && active && termKey && !review) terms.focus(termKey);
  }, [focused, active, termKey, !!review]);

  const [query, setQuery] = useState("");
  // 찾은 개수와 지금 몇 번째인지. at이 -1이면 아직 어느 것도 고르지 않았다
  const [found, setFound] = useState<{ at: number; count: number } | null>(null);
  useEffect(() => {
    if (!finding || !termKey) return;
    const off = terms.onFound(termKey, (at, count) => setFound({ at, count }));
    return () => {
      off();
      terms.findEnd(termKey);
      setFound(null);
    };
  }, [finding, termKey]);
  const tokens = session?.tokens ?? 0;
  return (
    <div className={"pane" + (focused ? " focused" : "")} onMouseDown={onFocus}>
      <div className="pane-head">
        {termKey ? (
          <>
            <span className={"dot " + state} />
            <b>{thread?.name ?? session?.title ?? label}</b>
            {thread && <span>{tr`줄기`} {thread.sessions.length}</span>}
            {[session?.work?.key, session?.repo ?? repoOf(cwd), session?.branch].filter(Boolean).map((m) => (
              <span key={m}>{m}</span>
            ))}
            <span className="pane-right">
              <button type="button" className={"pin" + (pinned ? " on" : "")} title={tr`고정하면 이 세션을 재우지 않고, 이 칸을 다른 세션으로 바꾸지도 않는다 (⌘⇧P)`} onClick={onPin}>
                {pinned ? tr`고정됨` : tr`고정`}
              </button>
              {ticketNote && (
                <span className={"tk-note" + (ticketNote.mention ? " mention" : "")} title={tr`티켓 화면 열기`} onClick={(e) => (e.stopPropagation(), ticketNote.open())}>
                  {ticketNote.text}
                </span>
              )}
              {handing && <span className="wait">{tr`갈아타는 중`}</span>}
              {handed && !handing && <span className="ok" title={tr`세션이 커져서 인계 글만 들고 새 세션으로 옮겼다. 일은 그대로 이어진다`}>{tr`이어받음`}</span>}
              {ticketEnded && (
                <span className="wait ended" title={tr`세션 끝내기`} onClick={(e) => (e.stopPropagation(), thread_ops.finish())}>
                  {ticketEnded} ✕
                </span>
              )}
              {!handing && STATE_LABEL[state] && <span className={state}>{STATE_LABEL[state]}</span>}
              {tokens > 0 && <span className={"tok" + (hot(tokens) ? " hot" : "")}>{kilo(tokens)}</span>}
            </span>
          </>
        ) : (
          <span>{tr`빈 칸`}</span>
        )}
      </div>
      <div className="pane-body" ref={body} />
      {review && termKey && <Review {...review} />}
      {!termKey && (
        <div className="pane-empty">
          <p className="pane-empty-main">
            <kbd>⌘L</kbd> {tr`할 말을 치면 Julgi가 맞는 세션을 찾아 보낸다`}
          </p>
          <p>{tr`내 차례인 세션이 생기면 이 칸에 알아서 올라온다. 비어 있으면 잠시 뒤 칸이 없어진다.`}</p>
        </div>
      )}
      {info && termKey && !finding && <Info session={session} cwd={cwd} thread={thread} memory={memory} members={members} ops={thread_ops} change={change} />}
      {finding && termKey && (
        <div className="find">
          <input
            autoFocus
            value={query}
            placeholder={tr`화면에서 찾기`}
            // 입력기에 따라 조합 중의 Esc는 누를 때 다른 키로 보이기도 한다. 뗄 때는 제대로 보인다
            onKeyUp={(e) => e.key === "Escape" && onFindClose()}
            onChange={(e) => {
              setQuery(e.target.value);
              // 치는 대로 찾는다. 다 치고 Enter를 누를 때까지 기다리지 않는다
              terms.find(termKey, e.target.value, true, true);
              if (!e.target.value) setFound(null);
            }}
            onKeyDown={(e) => {
              // Esc는 한글을 조합하는 중이어도 바로 닫는다. 조합 중인 키라고 넘겨 버리면 한 번 더 눌러야 닫힌다
              if (e.key === "Escape") {
                e.preventDefault();
                return onFindClose();
              }
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") terms.find(termKey, query, !e.shiftKey);
              else return;
              e.preventDefault();
            }}
          />
          <b className={"find-count" + (query && found?.count === 0 ? " none" : "")}>{!query ? "" : !found ? "…" : found.count === 0 ? tr`없음` : `${found.at + 1} / ${found.count}`}</b>
          <button type="button" tabIndex={-1} title={tr`위쪽(이전) 것 · Enter`} onClick={() => terms.find(termKey, query, true)}>
            ↑
          </button>
          <button type="button" tabIndex={-1} title={tr`아래쪽(다음) 것 · Shift+Enter`} onClick={() => terms.find(termKey, query, false)}>
            ↓
          </button>
          <span>{tr`⏎ 위로 · ⇧⏎ 아래로 · Esc`}</span>
        </div>
      )}
    </div>
  );
}
