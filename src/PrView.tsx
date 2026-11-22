import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { langOf, paint, parse, Line } from "./CodeReview";
import { md } from "./md";
import { ago, config } from "./model";
import { openPr, prOf, PrTarget } from "./pr";

type Who = { login: string };
type Check = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string; state?: string };
type View = {
  number: number;
  title: string;
  body: string;
  author: Who;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  url: string;
  reviewDecision: string;
  statusCheckRollup: Check[];
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: { author: Who; body: string; createdAt: string }[];
  reviews: { author: Who; body: string; submittedAt: string; state: string }[];
  mergeable: string;
  createdAt: string;
};
/** 코드 줄에 단 코멘트 (GitHub REST). line이 없으면 그 뒤로 코드가 바뀌어 지금 diff에 자리가 없는 것이다 */
type LineComment = { id: number; path: string; line: number | null; side: "LEFT" | "RIGHT"; in_reply_to_id?: number; user: Who; body: string; created_at: string };
/** 쓰는 중인 것: 코드 줄에 새 코멘트, 또는 스레드에 답글 */
type Draft = { kind: "line"; path: string; line: number; side: "LEFT" | "RIGHT" } | { kind: "reply"; id: number };

const STATE: Record<string, string> = { OPEN: "열림", CLOSED: "닫힘", MERGED: "머지됨" };
const DECISION: Record<string, string> = { APPROVED: "승인됨", CHANGES_REQUESTED: "수정 요청", REVIEW_REQUIRED: "리뷰 필요" };
const REVIEW: Record<string, string> = { APPROVED: "승인", CHANGES_REQUESTED: "수정 요청", COMMENTED: "리뷰", DISMISSED: "철회됨" };
const METHODS: [string, string][] = [
  ["squash", "스쿼시"],
  ["merge", "머지 커밋"],
  ["rebase", "리베이스"],
];
const when = (iso: string) => (iso ? ago(Date.parse(iso) / 1000) : "");

/** CI 검사들을 실패·도는 중·통과로 센다. CheckRun은 status/conclusion, 옛 상태 API는 state로 온다 */
export function tally(checks: Check[]) {
  const n = { fail: 0, run: 0, ok: 0 };
  for (const c of checks) {
    const s = (c.conclusion || c.state || "").toUpperCase();
    if (c.__typename === "CheckRun" ? c.status !== "COMPLETED" : s === "PENDING" || s === "EXPECTED") n.run += 1;
    else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s)) n.fail += 1;
    else n.ok += 1;
  }
  return n;
}

/** 줄에 붙을 코멘트인가. 오른쪽(바뀐 뒤) 코멘트는 새 줄 번호, 왼쪽(바뀌기 전)은 옛 줄 번호로 맞춘다 */
const onLine = (c: LineComment, l: Line) => (c.side === "LEFT" ? l.kind !== "add" && l.oldNo === c.line : l.kind !== "del" && l.newNo === c.line);

/** 마크다운 글. 안의 링크는 웹뷰가 따라가지 않게 가로채서 PR이면 PR 화면, 아니면 브라우저로 연다 */
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
        if (pr) openPr(pr);
        else void openUrl(a.href);
      }}
    />
  );
}

/** inline: 작업 페이지의 오른쪽 칸에 끼워 넣는다(창 전체를 덮지 않는다). autoFocus: 열리자마자 키를 받을지 */
type Props = { target: PrTarget; onClose: () => void; inline?: boolean; autoFocus?: boolean };

/** PR 화면. 변경과 줄 코멘트, CI, 리뷰, 대화를 한 화면에 펴고, 코멘트·답글·리뷰·머지를 여기서 한다 */
export default function PrView({ target, onClose, inline = false, autoFocus = true }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [notes, setNotes] = useState<LineComment[]>([]);
  const [error, setError] = useState("");
  const [fileAt, setFileAt] = useState(0);
  const [talk, setTalk] = useState(true); // 오른쪽 대화 칸
  const [loads, setLoads] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState(""); // 줄 코멘트·답글에 쓰는 글
  const [say, setSay] = useState(""); // 대화 칸 아래에 쓰는 글 (코멘트·리뷰)
  const [busy, setBusy] = useState(""); // 보내는 중인 것
  const busyRef = useRef("");
  busyRef.current = busy;
  const [merging, setMerging] = useState(false);
  const [method, setMethod] = useState("squash");
  const [dropBranch, setDropBranch] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // 작업 페이지에서 목록을 ↑↓로 넘길 때는 포커스를 뺏지 않는다
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const args = { repo: target.repo, number: target.number };
    setError("");
    void invoke<string>("pr_view", args).then((t) => setView(JSON.parse(t)), (e) => setError(String(e)));
    void invoke<string>("pr_diff", args).then(setDiff, (e) => setError(String(e)));
    void invoke<string>("pr_comments", args).then((t) => setNotes(JSON.parse(t)), () => setNotes([]));
  }, [target.repo, target.number, loads]);

  // 열어 둔 동안 설정한 주기로 새로 읽어 남이 단 코멘트와 CI를 들인다. 창을 안 보고 있거나 보내는 중이면 건너뛴다
  useEffect(() => {
    const every = config.prViewRefreshSec;
    if (!every) return;
    const timer = setInterval(() => {
      if (document.hasFocus() && !busyRef.current) setLoads((n) => n + 1);
    }, every * 1000);
    return () => clearInterval(timer);
  }, []);

  const files = useMemo(() => (diff ? parse(diff) : []), [diff]);
  const file = files[Math.min(fileAt, files.length - 1)];
  const lang = file ? langOf(file.path) : undefined;
  // 답글은 첫 코멘트 아래에 모은다
  const roots = notes.filter((c) => !c.in_reply_to_id);
  const replies = (id: number) => notes.filter((c) => c.in_reply_to_id === id);
  const count = (path: string) => notes.filter((c) => c.path === path).length;
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [file?.path]);

  /** GitHub에 보낸다. 끝나면 새로 읽고, 실패하면 위에 까닭을 띄운다 */
  const send = async (label: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(label);
    setError("");
    try {
      await invoke(cmd, { repo: target.repo, number: target.number, ...args });
      setLoads((n) => n + 1);
      return true;
    } catch (e) {
      setError(`${label} 실패: ${String(e)}`);
      return false;
    } finally {
      setBusy("");
    }
  };
  const sendDraft = async () => {
    if (!draft || !text.trim() || busy) return;
    const ok =
      draft.kind === "line"
        ? await send("줄 코멘트", "pr_line_comment", { commit: view?.headRefOid ?? "", path: draft.path, line: draft.line, side: draft.side, body: text })
        : await send("답글", "pr_reply", { id: draft.id, body: text });
    if (ok) (setDraft(null), setText(""), box.current?.focus());
  };
  const review = async (kind: "comment" | "approve" | "request-changes") => {
    if (busy) return;
    const ok = kind === "comment" ? await send("코멘트", "pr_comment", { body: say }) : await send(kind === "approve" ? "승인" : "수정 요청", "pr_review", { kind, body: say });
    if (ok) setSay("");
  };
  const merge = async () => {
    if (await send("머지", "pr_merge", { method, deleteBranch: dropBranch })) setMerging(false);
  };

  const checks = view ? tally(view.statusCheckRollup ?? []) : null;
  // 대화: 본문이 먼저, 그다음 코멘트와 리뷰를 시간 순으로. 글 없는 "리뷰"(줄 코멘트만 단 것)는 뺀다
  const talkItems = view
    ? [
        { who: view.author.login, at: view.createdAt, kind: "본문", text: view.body },
        ...[
          ...view.comments.map((c) => ({ who: c.author.login, at: c.createdAt, kind: "코멘트", text: c.body })),
          ...view.reviews.filter((r) => r.body || r.state !== "COMMENTED").map((r) => ({ who: r.author.login, at: r.submittedAt, kind: REVIEW[r.state] ?? r.state, text: r.body })),
        ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      ]
    : [];

  const onKey = (e: React.KeyboardEvent) => {
    // 글을 쓰는 중에는 글자 키를 가로채지 않는다
    if (e.target instanceof HTMLTextAreaElement) {
      if (e.key === "Escape") (setDraft(null), box.current?.focus());
      else return;
    } else if (e.key === "Escape") {
      if (merging) setMerging(false);
      else onClose();
    } else if ((e.key === "ArrowDown" || e.key === "j") && files.length) setFileAt((fileAt + 1) % files.length);
    else if ((e.key === "ArrowUp" || e.key === "k") && files.length) setFileAt((fileAt - 1 + files.length) % files.length);
    else if (e.key === "h") setTalk(!talk);
    else if (e.key === "o" && view) void openUrl(view.url);
    else if (e.key === "r") setLoads(loads + 1);
    else if (e.key === "m" && view?.state === "OPEN") setMerging(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const editor = (placeholder: string) => (
    <div className="pr-draft">
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) (e.preventDefault(), void sendDraft());
        }}
      />
      <div className="pr-acts">
        <button type="button" tabIndex={-1} className="primary" disabled={!text.trim() || !!busy} onClick={() => void sendDraft()}>
          {busy ? `${busy} 보내는 중` : "올리기 ⌘Enter"}
        </button>
        <button type="button" tabIndex={-1} onClick={() => (setDraft(null), box.current?.focus())}>
          그만
        </button>
      </div>
    </div>
  );

  const thread = (c: LineComment) => (
    <div key={c.id} className="pr-thread">
      {[c, ...replies(c.id)].map((x) => (
        <div key={x.id} className="pr-note">
          <b>{x.user.login}</b> <small>{when(x.created_at)}</small>
          <Md text={x.body} />
        </div>
      ))}
      {draft?.kind === "reply" && draft.id === c.id ? (
        editor("답글. ⌘Enter로 올린다 · Esc 그만")
      ) : (
        <button type="button" tabIndex={-1} className="pr-reply" onClick={() => (setDraft({ kind: "reply", id: c.id }), setText(""))}>
          답글
        </button>
      )}
    </div>
  );

  return (
    <div className={inline ? "pr-inline" : "pr-wrap"}>
      <div className="rv pr" ref={box} tabIndex={-1} onKeyDown={onKey}>
        <div className="rv-top pr-top">
          <div className="pr-title">
            <span className="pr-no">
              {target.repo.split("/")[1]} #{target.number}
            </span>
            <b>{view?.title ?? (error ? "" : "읽는 중")}</b>
          </div>
          {error && <div className="pr-error">{/auth|login|401/i.test(error) ? "GitHub에 연결돼 있지 않다. ⌘,의 연결에서 연결한다." : error}</div>}
          {view && (
            <div className="rv-git">
              <span className={"pr-state s-" + (view.isDraft ? "draft" : view.state.toLowerCase())}>{view.isDraft ? "초안" : STATE[view.state]}</span>
              <span>{view.author.login}</span>
              <span>
                <b>{view.baseRefName}</b> ← <b className="off">{view.headRefName}</b>
              </span>
              <span className="delta">
                파일 {view.changedFiles} <b>+{view.additions}</b> <i>−{view.deletions}</i>
              </span>
              {checks && checks.fail + checks.run + checks.ok > 0 && (
                <span className={checks.fail ? "pr-bad" : checks.run ? "pr-run" : "pr-ok"}>
                  CI {checks.fail ? `실패 ${checks.fail}` : checks.run ? `도는 중 ${checks.run}` : "통과"}
                  {checks.fail + checks.run > 0 && ` / ${checks.fail + checks.run + checks.ok}`}
                </span>
              )}
              {view.reviewDecision && <span className={view.reviewDecision === "APPROVED" ? "pr-ok" : view.reviewDecision === "CHANGES_REQUESTED" ? "pr-bad" : ""}>{DECISION[view.reviewDecision] ?? view.reviewDecision}</span>}
              {notes.length > 0 && <span>줄 코멘트 {notes.length}</span>}
              {busy && <span className="pr-run">{busy} 보내는 중</span>}
              {view.state === "OPEN" && (
                <button type="button" tabIndex={-1} className="pr-merge-btn" onClick={() => setMerging(!merging)}>
                  머지…
                </button>
              )}
              <button type="button" tabIndex={-1} onClick={() => void openUrl(view.url)}>
                웹에서 열기
              </button>
            </div>
          )}
          {merging && view && (
            <div className="pr-merge">
              {view.mergeable === "CONFLICTING" && <b className="pr-bad">충돌이 있어 머지할 수 없다. 브랜치를 먼저 맞춘다.</b>}
              {checks && checks.fail > 0 && <b className="pr-bad">CI가 {checks.fail}개 실패한 상태다.</b>}
              <span className="set-seg">
                {METHODS.map(([value, label]) => (
                  <button key={value} type="button" tabIndex={-1} className={method === value ? "yes" : ""} onClick={() => setMethod(value)}>
                    {label}
                  </button>
                ))}
              </span>
              <label>
                <input type="checkbox" checked={dropBranch} onChange={(e) => setDropBranch(e.target.checked)} /> 머지 뒤 {view.headRefName} 지우기
              </label>
              <button type="button" tabIndex={-1} className="primary" disabled={!!busy || view.mergeable === "CONFLICTING"} onClick={() => void merge()}>
                {view.baseRefName}에 머지하기
              </button>
              <button type="button" tabIndex={-1} onClick={() => setMerging(false)}>
                그만
              </button>
            </div>
          )}
        </div>
        <div className={"rv-main pr-main" + (talk ? "" : " no-talk")}>
          <div className="rv-files">
            {diff === null && !error && <div className="side-none">읽는 중</div>}
            {files.map((f, i) => (
              <button key={f.path} type="button" tabIndex={-1} className={"rv-file" + (i === fileAt ? " on" : "")} onClick={() => setFileAt(i)} title={f.path}>
                <span className="rv-name">
                  {f.path.split("/").pop()}
                  <small>{f.path.split("/").slice(0, -1).join("/")}</small>
                </span>
                <span className="delta">
                  {count(f.path) > 0 && <em className="pr-count">💬 {count(f.path)} </em>}
                  {f.note && <em>{f.note} </em>}
                  <b>+{f.adds}</b> <i>−{f.dels}</i>
                </span>
              </button>
            ))}
          </div>
          <div className="rv-code" ref={body}>
            {file && (
              <>
                <div className="rv-path">
                  <span>
                    {file.path}
                    {file.note && <em> · {file.note}</em>}
                  </span>
                </div>
                {/* 그 뒤로 코드가 바뀌어 지금 diff에 자리가 없는 코멘트는 파일 맨 위에 모은다 */}
                {roots.filter((c) => c.path === file.path && c.line == null).length > 0 && (
                  <div className="pr-outdated">
                    <small>지난 변경에 단 코멘트</small>
                    {roots.filter((c) => c.path === file.path && c.line == null).map(thread)}
                  </div>
                )}
                {file.hunks.map((h, hi) => (
                  <div key={hi} className="rv-hunk">
                    {h.head && <div className="rv-head">{h.head}</div>}
                    {h.lines.map((l, li) => {
                      const html = paint(l.text, lang);
                      const here = roots.filter((c) => c.path === file.path && c.line != null && onLine(c, l));
                      // 지운 줄은 바뀌기 전(LEFT) 줄 번호로, 나머지는 바뀐 뒤(RIGHT) 줄 번호로 코멘트를 단다
                      const side = l.kind === "del" ? "LEFT" : "RIGHT";
                      const no = (l.kind === "del" ? l.oldNo : l.newNo) ?? 0;
                      const open = draft?.kind === "line" && draft.path === file.path && draft.line === no && draft.side === side;
                      return (
                        <div key={li}>
                          <div
                            className={"rv-line " + l.kind + (open ? " open" : "")}
                            title="눌러서 이 줄에 코멘트 달기"
                            onClick={() => view?.state === "OPEN" && (setDraft({ kind: "line", path: file.path, line: no, side }), setText(""))}
                          >
                            <span className="no">{l.oldNo ?? ""}</span>
                            <span className="no">{l.newNo ?? ""}</span>
                            <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                            {html !== undefined ? <code dangerouslySetInnerHTML={{ __html: html || " " }} /> : <code>{l.text || " "}</code>}
                          </div>
                          {here.map(thread)}
                          {open && <div className="pr-thread">{editor(`${file.path}:${no}에 코멘트. ⌘Enter로 올린다 · Esc 그만`)}</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </div>
          {talk && (
            <div className="rv-hist pr-talk">
              <div className="rv-hist-head">대화</div>
              {talkItems.map((t, i) => (
                <div key={i} className="pr-item">
                  <div>
                    <b>{t.who}</b> <em>{t.kind}</em> <small>{when(t.at)}</small>
                  </div>
                  {t.text ? <Md text={t.text} /> : <div className="pr-text muted">(글 없음)</div>}
                </div>
              ))}
              {view && (
                <div className="pr-say">
                  <textarea
                    rows={3}
                    value={say}
                    placeholder="코멘트나 리뷰에 붙일 말 · ⌘Enter 코멘트"
                    onChange={(e) => setSay(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing && say.trim()) (e.preventDefault(), void review("comment"));
                    }}
                  />
                  <div className="pr-acts">
                    <button type="button" tabIndex={-1} disabled={!say.trim() || !!busy} onClick={() => void review("comment")}>
                      코멘트
                    </button>
                    {view.state === "OPEN" && (
                      <>
                        <button type="button" tabIndex={-1} className="ok" disabled={!!busy} onClick={() => void review("approve")} title="글이 있으면 승인과 함께 붙는다">
                          승인
                        </button>
                        <button type="button" tabIndex={-1} className="bad" disabled={!say.trim() || !!busy} onClick={() => void review("request-changes")} title="무엇을 고쳐야 하는지 글로 쓴다">
                          수정 요청
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pal-foot">↑↓ 파일 · 줄을 누르면 코멘트 · h 대화 · m 머지 · o 웹에서 열기 · r 새로 읽기 · Esc</div>
      </div>
    </div>
  );
}
