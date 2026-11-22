import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { langOf, paint, parse, Line } from "./CodeReview";
import { ago } from "./model";
import { PrTarget } from "./pr";

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
  url: string;
  reviewDecision: string;
  statusCheckRollup: Check[];
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: { author: Who; body: string; createdAt: string }[];
  reviews: { author: Who; body: string; submittedAt: string; state: string }[];
  createdAt: string;
};
/** 코드 줄에 단 코멘트 (GitHub REST). line이 없으면 그 뒤로 코드가 바뀌어 지금 diff에 자리가 없는 것이다 */
type LineComment = { id: number; path: string; line: number | null; side: "LEFT" | "RIGHT"; in_reply_to_id?: number; user: Who; body: string; created_at: string };

const STATE: Record<string, string> = { OPEN: "열림", CLOSED: "닫힘", MERGED: "머지됨" };
const DECISION: Record<string, string> = { APPROVED: "승인됨", CHANGES_REQUESTED: "수정 요청", REVIEW_REQUIRED: "리뷰 필요" };
const REVIEW: Record<string, string> = { APPROVED: "승인", CHANGES_REQUESTED: "수정 요청", COMMENTED: "리뷰", DISMISSED: "철회됨" };
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

type Props = { target: PrTarget; onClose: () => void };

/** PR 화면. 변경과 줄 코멘트, CI, 리뷰, 대화를 한 화면에 편다. 아직 읽기만 한다 */
export default function PrView({ target, onClose }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [notes, setNotes] = useState<LineComment[]>([]);
  const [error, setError] = useState("");
  const [fileAt, setFileAt] = useState(0);
  const [talk, setTalk] = useState(true); // 오른쪽 대화 칸
  const [loads, setLoads] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);

  useEffect(() => {
    const args = { repo: target.repo, number: target.number };
    setError("");
    void invoke<string>("pr_view", args).then((t) => setView(JSON.parse(t)), (e) => setError(String(e)));
    void invoke<string>("pr_diff", args).then(setDiff, (e) => setError(String(e)));
    void invoke<string>("pr_comments", args).then((t) => setNotes(JSON.parse(t)), () => setNotes([]));
  }, [target.repo, target.number, loads]);

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
    if (e.key === "Escape") onClose();
    else if ((e.key === "ArrowDown" || e.key === "j") && files.length) setFileAt((fileAt + 1) % files.length);
    else if ((e.key === "ArrowUp" || e.key === "k") && files.length) setFileAt((fileAt - 1 + files.length) % files.length);
    else if (e.key === "h") setTalk(!talk);
    else if (e.key === "o" && view) void openUrl(view.url);
    else if (e.key === "r") setLoads(loads + 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const thread = (c: LineComment) => (
    <div key={c.id} className="pr-thread">
      {[c, ...replies(c.id)].map((x) => (
        <div key={x.id} className="pr-note">
          <b>{x.user.login}</b> <small>{when(x.created_at)}</small>
          <div className="pr-text">{x.body}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="pr-wrap">
      <div className="rv pr" ref={box} tabIndex={-1} onKeyDown={onKey}>
        <div className="rv-top pr-top">
          <div className="pr-title">
            <span className="pr-no">
              {target.repo.split("/")[1]} #{target.number}
            </span>
            <b>{view?.title ?? (error ? "" : "읽는 중")}</b>
          </div>
          {error && <div className="pr-error">{error.includes("auth") || error.includes("login") ? "GitHub에 연결돼 있지 않다. ⌘,의 연결에서 연결한다." : error}</div>}
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
              <button type="button" tabIndex={-1} onClick={() => void openUrl(view.url)}>
                웹에서 열기
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
                      return (
                        <div key={li}>
                          <div className={"rv-line " + l.kind} style={{ cursor: "auto" }}>
                            <span className="no">{l.oldNo ?? ""}</span>
                            <span className="no">{l.newNo ?? ""}</span>
                            <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                            {html !== undefined ? <code dangerouslySetInnerHTML={{ __html: html || " " }} /> : <code>{l.text || " "}</code>}
                          </div>
                          {here.map(thread)}
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
                  {t.text ? <div className="pr-text">{t.text}</div> : <div className="pr-text muted">(글 없음)</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pal-foot">↑↓ 파일 · h 대화 · o 웹에서 열기 · r 새로 읽기 · Esc</div>
      </div>
    </div>
  );
}
