import Hint from "./Hint";
import doneArt from "./assets/art/done.png";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ago } from "./model";
import { PrTarget, ReviewAsk, prNo, repoName } from "./pr";
import { tr } from "./i18n";
import { adfToMd, TicketFull, TicketNewsMeta } from "./jira";
import { md } from "./md";

/** news: PR에 생긴 일(CI 실패, 새 코멘트 등). 있으면 답을 기다리는 게 아니라 PR 때문에 올라온 것이다 */
/** pr: 이 세션이 올린 PR. ⌥Enter로 PR 화면을 연다. state가 sleep이면 잠든 세션이다(고르면 깨운다) */
export type Waiting = { key: string; name: string; repo: string; state: string; since: number; sessionId?: string; news?: string; pr?: PrTarget; /** 한꺼번에 맡긴 버그의 진단이 끝난 세션이면 그 티켓 키 */ bug?: string };
type Props = {
  /** 지금 일하는 중인 세션 수. 기다리는 것이 없을 때 보여 준다 */
  busy?: number;
  rows: Waiting[];
  /** 나한테 온 리뷰 요청. 세션들 아래에 놓는다 */
  asks: ReviewAsk[];
  /** 세션과 이어지지 않은 내 PR 가운데 일이 생긴 것. 세션과 리뷰 요청 사이에 놓는다 */
  mine: (ReviewAsk & { news: string })[];
  /** 새 소식이 있는 내 티켓. Enter로 티켓 화면, ⌘Enter로 이 티켓으로 시작 */
  /** meta: 소식의 속 내용(종류, 새 댓글 수, 바뀌기 전 상태, 나를 불렀는지). session: 이 티켓에 이어진 세션의 이름 */
  tickets: { key: string; title: string; news: string; url: string; meta?: TicketNewsMeta; session?: string }[];
  /** 고른 티켓의 본문과 댓글을 읽어 온다 (티켓 화면이 쓰는 것과 같다) */
  loadTicket?: (key: string) => Promise<TicketFull>;
  onTicket: (key: string) => void;
  /** 깨진 채 끝난 내 CI 실행. Enter로 실행 화면을 연다 */
  runs?: { url: string; title: string; where: string; news: string }[];
  onRun?: (url: string) => void;
  onStartTicket: (key: string) => void;
  /** 리뷰 요청을 PR 화면으로 연다 */
  onView: (ask: ReviewAsk) => void;
  /** 리뷰 요청을 새 세션에 맡긴다. extra는 덧붙여 시킬 말 */
  onHand: (ask: ReviewAsk, extra: string) => void;
  /** 그 세션에 답을 보낸다 */
  onAnswer: (key: string, text: string) => void;
  /** 맡긴 버그의 진단을 보고: 고치라고 하거나, 보류한다 */
  onFixBug?: (key: string) => void;
  onHoldBug?: (key: string) => void;
  /** 그 세션을 칸에 올린다. 잠든 세션이면 깨운다 */
  onOpen: (key: string) => void;
  /** 그 세션의 PR을 PR 화면으로 연다 */
  onPr: (pr: PrTarget) => void;
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
export default function Queue({ rows, asks, mine, tickets, loadTicket, runs = [], onRun, onTicket, onStartTicket, onView, onHand, onAnswer, onFixBug, onHoldBug, onOpen, onPr, onClose, busy = 0 }: Props) {
  // 답을 보낸 세션과 맡긴 리뷰는 상태가 바뀌기를 기다리지 않고 바로 뺀다
  const [gone, setGone] = useState<string[]>([]);
  const list = useMemo(() => rows.filter((r) => !gone.includes(r.key)), [rows, gone]);
  // 아래 묶음: 내 PR(일이 생긴 것) 다음에 리뷰 요청
  const askList = useMemo(
    () =>
      [
        ...mine.map((m) => ({ ...m, kind: "mine" as const })),
        // 티켓은 PR 모양에 맞춰 넣는다: 키를 레포 자리에
        ...tickets.map((t) => ({ number: 0, title: t.title, repository: { nameWithOwner: t.key }, author: { login: "" }, updatedAt: "", url: t.url, isDraft: false, kind: "ticket" as const, news: t.news })),
        // 실행도 같은 모양으로: 레포·워크플로를 레포 자리에
        ...runs.map((r) => ({ number: 0, title: r.title, repository: { nameWithOwner: r.where }, author: { login: "" }, updatedAt: "", url: r.url, isDraft: false, kind: "run" as const, news: r.news })),
        ...asks.map((a) => ({ ...a, kind: "review" as const, news: "" })),
      ].filter((a) => !gone.includes(a.url)),
    [mine, asks, tickets, runs, gone],
  );
  const total = list.length + askList.length;
  const [at, setAt] = useState(0);
  const pos = Math.min(at, total - 1);
  // 위는 세션, 아래는 리뷰 요청. 고른 자리가 어느 쪽인지에 따라 오른쪽이 바뀐다
  const row = pos < list.length ? list[pos] : undefined;
  const ask = pos >= list.length ? askList[pos - list.length] : undefined;
  const [replies, setReplies] = useState<Record<string, string>>({});
  // 고른 티켓의 상세: 한 번 읽은 것은 기억한다. 글자(string)면 읽지 못한 까닭이다
  const [fulls, setFulls] = useState<Record<string, TicketFull | string>>({});
  const [wide, setWide] = useState<string[]>([]); // 길어서 접어 둔 댓글 가운데 편 것
  const tkKey = ask?.kind === "ticket" ? ask.repository.nameWithOwner : "";
  const tk = tkKey ? tickets.find((t) => t.key === tkKey) : undefined;
  useEffect(() => {
    if (!tkKey || !loadTicket || fulls[tkKey] !== undefined) return;
    void loadTicket(tkKey).then(
      (t) => setFulls((old) => ({ ...old, [tkKey]: t })),
      (e) => setFulls((old) => ({ ...old, [tkKey]: String(e) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tkKey]);
  const full = tkKey ? fulls[tkKey] : undefined;
  const when = (iso: string) => (iso ? ago(Date.parse(iso) / 1000) : "");
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // 입력칸이 없는 줄(내 PR)을 골랐을 때도 키가 이 창으로 오게, 입력칸이 없으면 창 자체에 포커스를 둔다
  useEffect(() => (input.current ?? box.current)?.focus(), [row?.key, ask?.url]);
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
    if (rows.length + asks.length + mine.length + tickets.length + runs.length && !total) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const reply = row ? replies[row.key] : undefined;
  const asked = reply ? question(reply) : "";
  const rest = reply ? (asked ? reply.slice(0, reply.lastIndexOf(asked)).trim() : reply.trim()) : "";
  // 맡긴 버그의 진단은 "결론: "으로 시작하는 한 줄을 맨 위에 올린다
  const verdict = row?.bug && reply ? (reply.match(/^[\s>*#-]*(?:결론|Conclusion)\s*[:：]\s*(.+)$/m)?.[1] ?? "").replace(/\*+/g, "").trim() : ""; // i18n-ok
  const decide = (fix: boolean) => {
    if (!row) return;
    (fix ? onFixBug : onHoldBug)?.(row.key);
    setGone((old) => [...old, row.key]);
    setText("");
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (!total) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt((pos + (e.key === "ArrowDown" ? 1 : total - 1)) % total);
      setText("");
    } else if (ask && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // 티켓: Enter 티켓 화면, ⌘Enter 이 티켓으로 시작
      // 실행은 작업 페이지로 넘어간다. 여기서 닫기까지 부르면 같은 순간에 "작업 페이지 열기"와 "닫기"가 겹쳐 닫기가 이긴다
      if (ask.kind === "run") return onRun?.(ask.url);
      if (ask.kind === "ticket") return (e.metaKey ? onStartTicket(ask.repository.nameWithOwner) : onTicket(ask.repository.nameWithOwner)), onClose();
      // 빈 채로 Enter면 PR 화면, 글을 썼거나 ⌘Enter면 세션에 맡긴다. 내 PR은 늘 PR 화면으로 연다
      if (ask.kind === "mine" || (!text.trim() && !e.metaKey)) return onView(ask), onClose();
      onHand(ask, text.trim());
      setGone((old) => [...old, ask.url]);
      setText("");
    } else if (row?.pr && e.key === "Enter" && e.altKey) {
      // ⌥Enter: 세션 대신 그 PR을 연다
      e.preventDefault();
      return onPr(row.pr), onClose();
    } else if (row && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
      <div className={"qu" + (total === 0 ? " empty" : "")} ref={box} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        {total === 0 && (
          <div className="qu-empty">
            <img src={doneArt} width={140} height={140} alt="" />
            <b>{tr`나를 기다리는 것이 없다`}</b>
            <p>{busy > 0 ? tr`세션 ${busy}개가 일하고 있다. 물음이나 정할 것이 생기면 여기에 올라온다.` : tr`세션이 물음을 남기거나, PR과 티켓에 일이 생기면 여기에 올라온다.`}</p>
            <small>
              <kbd>⌘L</kbd> {tr`일 던지기`} · <kbd>⌘U</kbd> {tr`작업`} · <kbd>Esc</kbd> {tr`닫기`}
            </small>
          </div>
        )}
        <div className="qu-list">
          {list.length > 0 && <div className="qu-head">{tr`내 차례`} {list.length}</div>}
          {list.map((r, i) => (
            <button key={r.key} type="button" tabIndex={-1} className={"qu-row" + (r.key === row?.key ? " on" : "")} onClick={() => (setAt(i), setText(""))}>
              <b>{r.name}</b>
              <small>
                {r.repo} · {r.state === "sleep" ? tr`잠듦` + " · " : ""}
                {r.news ? <em className="qu-news">PR{r.pr ? ` #${r.pr.number}` : ""} · {r.news}</em> : r.state === "ask" ? tr`확인이 필요함` : r.bug ? <em className="qu-news">{r.bug} · {tr`진단 끝남`}</em> : tr`답함`}
                {r.since > 0 && ` · ${ago(r.since / 1000)}`}
              </small>
            </button>
          ))}
          {askList.map((a, i) => (
            <>
            {(i === 0 || askList[i - 1].kind !== a.kind) && (
              <div key={"h-" + a.kind} className="qu-head">
                {a.kind === "mine" ? tr`내 PR` : a.kind === "ticket" ? tr`티켓` : a.kind === "run" ? "CI" : tr`리뷰 요청`} {askList.filter((x) => x.kind === a.kind).length}
              </div>
            )}
            <button key={a.url} type="button" tabIndex={-1} className={"qu-row" + (a.url === ask?.url ? " on" : "")} onClick={() => (setAt(list.length + i), setText(""))}>
              <b>{a.title}</b>
              <small>
                {a.kind === "ticket" || a.kind === "run" ? (
                  <>
                    {a.repository.nameWithOwner} · <em className="qu-news">{a.news}</em>
                  </>
                ) : (
                  <>
                    {repoName(a.repository.nameWithOwner)} {prNo({ repo: a.repository.nameWithOwner, number: a.number })} · {a.kind === "mine" ? <em className="qu-news">{a.news}</em> : a.author.login} · {ago(Date.parse(a.updatedAt) / 1000)}
                  </>
                )}
              </small>
            </button>
            </>
          ))}
        </div>
        <div className="qu-main">
          {ask && ask.kind === "ticket" && (
            <div className="qu-reply qu-ticket">
              <div className="qu-tk-head">
                <b>
                  <em>{tkKey}</em> {typeof full === "object" ? full.title : (tk?.title ?? "")}
                </b>
                <small>
                  {[typeof full === "object" ? full.status : "", typeof full === "object" ? (full.assignee ? tr`담당 ${full.assignee}` : tr`담당 없음`) : "", typeof full === "object" && full.reporter ? tr`보고 ${full.reporter}` : "", tk?.session ? tr`세션 "${tk.session.slice(0, 30)}"` : ""].filter(Boolean).join(" · ")}
                </small>
              </div>
              <div className={"qu-tk-news" + (tk?.meta?.mention ? " mention" : "")}>{ask.news}</div>
              {full === undefined && <small>{tr`읽는 중`}</small>}
              {typeof full === "string" && <small>{full}</small>}
              {typeof full === "object" && tk?.meta?.kind === "status" && (
                <div className="qu-tk-move">
                  {tk.meta.was} → <b>{full.status}</b>
                </div>
              )}
              {typeof full === "object" &&
                (tk?.meta?.kind === "comment" || !tk?.meta) &&
                // 새로 달린 만큼의 댓글을 보여 준다(다섯 개까지). 몇 개인지 모르면 마지막 하나
                full.comments.slice(-Math.min(5, Math.max(1, tk?.meta?.count ?? 1))).map((c, i) => {
                  const id = `${tkKey}#${c.at}#${i}`;
                  const text = adfToMd(c.body);
                  const long = text.length > 700 && !wide.includes(id);
                  return (
                    <div key={id} className="qu-tk-comment">
                      <div>
                        <b>{c.who}</b> <small>{when(c.at)}</small>
                      </div>
                      <div className={"pr-text md" + (long ? " clipped" : "")} dangerouslySetInnerHTML={{ __html: md(long ? text.slice(0, 700) + " …" : text) }} />
                      {long && (
                        <button type="button" tabIndex={-1} className="qu-more" onClick={() => setWide((old) => [...old, id])}>
                          {tr`더 보기`}
                        </button>
                      )}
                    </div>
                  );
                })}
              {typeof full === "object" && tk?.meta?.kind === "assigned" && <div className="pr-text md" dangerouslySetInnerHTML={{ __html: md(adfToMd(full.description).slice(0, 900) || tr`(설명 없음)`) }} />}
              <div className="qu-tk-acts">
                <button type="button" tabIndex={-1} onClick={() => (onTicket(tkKey), onClose())}>
                  {tr`티켓 화면`}
                </button>
                <button type="button" tabIndex={-1} className="primary" onClick={() => (onStartTicket(tkKey), onClose())}>
                  {tk?.session ? tr`세션 열기` : tr`이 티켓으로 시작`}
                </button>
              </div>
            </div>
          )}
          {ask && ask.kind !== "ticket" && (
            <>
              <div className="qu-reply">
                <pre className="qu-asked">
                  {ask.kind === "run" ? ask.repository.nameWithOwner : `${ask.repository.nameWithOwner} #${ask.number}`}
                  {"\n"}
                  {ask.title}
                </pre>
                {ask.kind === "run" ? (
                  <small>{tr`내가 돌린 CI가 깨졌다`}</small>
                ) : ask.kind === "mine" ? (
                  <small>{tr`내 PR에 일이 생겼다: ${ask.news} · Enter로 PR 화면에서 본다`}</small>
                ) : (
                <small>
                  {tr`${ask.author.login}이 리뷰를 부탁했다`}{ask.isDraft ? " · " + tr`초안` : ""} · {tr`빈 채로 Enter면 PR 화면에서 본다. 세션에 맡기면 새 세션이 PR을 읽고 짚을 곳을 정리한다(GitHub에 직접 올리지는 않는다)`}
                </small>
                )}
              </div>
              {ask.kind === "review" && <textarea ref={input} rows={2} value={text} placeholder={tr`세션에 맡길 때 덧붙일 말 (예: 트랜잭션 위주로) · Enter 맡기기 · 빈 채로 Enter면 PR 화면 · ⌘Enter 바로 맡기기`} onChange={(e) => setText(e.target.value)} />}
            </>
          )}
          {row && (
            <>
              {row.bug && (
                <div className="qu-bug">
                  <b>{row.bug}</b> {verdict || (reply === undefined ? tr`읽는 중` : tr`결론 줄을 찾지 못했다. 아래 진단을 읽는다`)}
                  <span>
                    <button type="button" tabIndex={-1} className="primary" onClick={() => decide(true)}>
                      {tr`고쳐`}
                    </button>
                    <button type="button" tabIndex={-1} onClick={() => decide(false)}>
                      {tr`보류`}
                    </button>
                  </span>
                </div>
              )}
              <div className="qu-reply">
                {reply === undefined && <small>{tr`읽는 중`}</small>}
                {reply === "" && <small>{tr`마지막 답을 읽지 못했다. Enter로 세션을 연다.`}</small>}
                {rest && <pre className="qu-rest">{rest.split("\n").slice(-40).join("\n")}</pre>}
                {asked && <pre className="qu-asked">{asked}</pre>}
                {reply && !asked && <small>{tr`묻는 말로 끝나지 않았다. 답을 다 한 것일 수 있다.`}</small>}
              </div>
              <textarea
                ref={input}
                rows={2}
                value={text}
                placeholder={row.state === "ask" ? tr`허락을 묻고 있다. Enter로 세션을 열어 고른다` : (row.state === "sleep" ? tr`잠든 세션이다. 빈 채로 Enter면 깨워서 열고, 답을 치면 그 글을 들고 깨운다` : tr`여기에 답을 치고 Enter · 빈 채로 Enter면 세션을 연다`) + (row.pr ? " · " + tr`⌥Enter PR 보기` : "")}
                onChange={(e) => setText(e.target.value)}
              />
            </>
          )}
          <Hint text={ask?.kind === "ticket" ? [tr`↑↓ 고르기 · Enter 티켓 화면`, tk?.session ? tr`⌘Enter 세션 열기` : tr`⌘Enter 이 티켓으로 시작`, "Esc"].join(" · ") : ask?.kind === "run" ? tr`↑↓ 고르기 · Enter job과 로그 보기 · Esc` : ask?.kind === "mine" ? tr`↑↓ 고르기 · Enter PR 화면 · Esc` : ask ? tr`↑↓ 고르기 · Enter PR 화면 (글이 있으면 세션에 맡기기) · ⌘Enter 세션에 맡기기 · Esc` : tr`↑↓ 고르기 · Enter 답 보내기 (빈 채면 세션 열기) · ⌘Enter 세션 열기 · ⇧Enter 줄바꿈 · Esc`} />
        </div>
      </div>
    </div>
  );
}
