import { openFile } from "./FileView";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ago, Change, hot, kilo, linkLabel, Session, Thread } from "./model";
import { tr } from "./i18n";

/** 지금 세션이 뭘 하던 것인지와 산출물. ⌘I로 여닫는다. */
export type Member = { id: string; title: string; here: boolean };
export type ThreadOps = { name: (name: string) => void; leave: (sessionId: string) => void; drop: () => void; finish: () => void; changes: () => void };
type Props = { session?: Session; cwd: string; thread?: Thread; memory: string; members: Member[]; ops: ThreadOps; change?: Change; onClose?: () => void };

/** 인계 글의 마크다운을 읽기 좋게 줄 단위로 푼다. 제목 줄은 굵게, 나머지는 기호만 걷는다 */
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => ({ head: /^#{1,6}\s/.test(line), text: line.replace(/^#{1,6}\s+/, "").replace(/\*\*|`/g, "") }))
    .filter((line, i, all) => line.text.trim() || (i > 0 && all[i - 1].text.trim()));

export default function Info({ session, cwd, thread, memory, members, ops, change, onClose }: Props) {
  const [full, setFull] = useState(false);
  const short = (path: string) => path.replace(/^\/Users\/[^/]+/, "~");
  if (!session)
    return (
      <div className="info">
        <div className="info-v mono">{short(cwd)}</div>
        <div className="info-none">{tr("아직 대화 기록이 없다")}</div>
      </div>
    );
  // 최근 것부터, 같은 대상을 가리키는 링크는 하나만
  const seen = new Set<string>();
  const links = [...session.links].reverse().filter((url) => {
    const label = linkLabel(url);
    return seen.has(label) ? false : (seen.add(label), true);
  });
  const files = [...(session.files ?? [])].reverse();
  const name = thread?.name ?? session.title;
  return (
    // 초점이 패널 안에 있을 때만 Esc로 닫는다. 터미널에 초점이 있을 때의 Esc는 Claude Code의 것이라 건드리지 않는다
    <div className="info" tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose?.())}>
      <button type="button" className="info-x" tabIndex={-1} title={tr("닫기 (⌘I)")} onClick={onClose}>
        ×
      </button>
      <input
        key={(thread?.id ?? session.id) + name}
        className="info-name"
        defaultValue={name}
        title={tr("이름을 고치고 Enter. 고친 이름은 Julgi가 바꾸지 않는다")}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          ops.name(e.currentTarget.value);
          e.currentTarget.blur();
        }}
      />
      <div className="info-meta">
        {[session.work?.key, session.repo, session.branch, ago(session.mtime)].filter(Boolean).join(" · ")}
        {session.tokens > 0 && <span className={hot(session.tokens) ? "hot" : ""}> · {kilo(session.tokens)}</span>}
      </div>
      {hot(session.tokens) && <div className="info-note">{tr("세션이 크다. 다음에 ⌘L로 보낼 때 Julgi가 알아서 갈아탄다.")}</div>}

      <div className="info-h">{tr("지금")}</div>
      <div className="info-v">{session.recap || (!thread && memory.trim()) || tr("요약이 아직 없다. 세션이 쉬면 Julgi가 만든다")}</div>

      {change && change.files > 0 && (
        <>
          <div className="info-h">
            {tr`바뀐 것 · 파일 ${change.files}`} <span className="delta"><b>+{change.adds}</b> <i>−{change.dels}</i></span>
          </div>
          {change.brief ? (
            <button type="button" className="info-brief" onClick={ops.changes}>
              <span>{change.brief.line}</span>
              {change.brief.watch.length > 0 && <em>{tr`눈여겨볼 곳 ${change.brief.watch.length}`}</em>}
              {(change.brief.found?.length ?? 0) > 0 && <em>{tr`짚은 곳 ${change.brief.found!.length}`}</em>}
              {change.brief.unverified && <small>{change.brief.unverified}</small>}
            </button>
          ) : (
            <div className="info-v dim">{tr("브리핑을 만드는 중이거나 꺼져 있다")}</div>
          )}
        </>
      )}
      {session.said && session.said !== name && (
        <>
          <div className="info-h">{tr("처음 한 말")}</div>
          <div className="info-v dim">{session.said}</div>
        </>
      )}

      {thread && thread.sessions.length > 1 && (
        <>
          <div className="info-h">{tr`이어 온 세션 ${thread.sessions.length}개`}</div>
          {members.map((m, i) => (
            <div key={m.id} className={"info-member" + (m.here ? " here" : "")}>
              <span>
                {i + 1}. {m.title}
                {m.here && tr(" · 지금")}
              </span>
              <button type="button" title={tr("이 세션을 줄기에서 뺀다. 세션은 남는다")} onClick={() => ops.leave(m.id)}>
                {tr("빼기")}
              </button>
            </div>
          ))}
        </>
      )}

      {links.length + files.length > 0 && (
        <>
          <div className="info-h">{tr("산출물")}</div>
          {links.slice(0, 8).map((url) => (
            <button type="button" key={url} className="info-link" title={url} onClick={() => void openUrl(url)}>
              {linkLabel(url)}
            </button>
          ))}
          {/* 세션이 새로 만든 파일. 누르면 Julgi 안에서 편다 */}
          {files.slice(0, 8).map((path) => (
            <button type="button" key={path} className="info-link file" title={path} onClick={() => openFile({ path })}>
              {path.split("/").slice(-2).join("/")}
            </button>
          ))}
        </>
      )}

      {thread && memory.trim() && (
        <>
          <button type="button" className="info-fold" aria-expanded={full} onClick={() => setFull(!full)}>
            {full ? "▾" : "▸"} {tr("줄기 기억 (인계 글과 메모)")}
          </button>
          {full && (
            <div className="info-memo">
              {lines(memory.trim().slice(0, 6000)).map((line, i) => (
                <div key={i} className={line.head ? "head" : ""}>
                  {line.text || "\u00a0"}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="info-foot">
        <span className="mono">{short(session.cwd)}</span>
        <span className="info-acts">
          <button type="button" title={tr("이 세션과 맡긴 일감들이 고친 파일과 변경 내용")} onClick={ops.changes}>
            {tr("코드 검토 (⌘E)")}
          </button>
          {thread && (
            <button type="button" title={tr("묶음만 푼다. 세션은 그대로 남는다")} onClick={ops.drop}>
              {tr("줄기 풀기")}
            </button>
          )}
          <button type="button" title={tr("목록에서 내린다. ⌘K로는 계속 찾는다")} onClick={ops.finish}>
            {thread?.done ? tr("다시 살리기") : tr("이 일 끝내기")}
          </button>
        </span>
      </div>
    </div>
  );
}
