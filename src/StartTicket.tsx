import { useEffect, useRef, useState } from "react";
import { adfToMd, slugOf, TicketFull } from "./jira";

type Props = {
  ticket: TicketFull;
  /** 고를 수 있는 레포 (지도의 레포) */
  repos: { repo: string; cwd: string }[];
  /** 이 프로젝트 키로 지난번에 고른 레포 */
  remembered?: string;
  /** 시작할 때 제안할 전환 이름 (빈 글이면 묻지 않는다) */
  startTransition: string;
  onStart: (o: { cwd: string; repo: string; branch: string; prompt: string; transition: boolean }) => void;
  onClose: () => void;
};

/** 첫 지시: 티켓 내용 + PR 제목에 키를 넣으라는 말 */
export function promptOf(t: TicketFull) {
  const desc = adfToMd(t.description).trim();
  const subs = t.subtasks.filter((s) => s.statusCategory !== "done").map((s) => `- ${s.key} ${s.title} (${s.status})`);
  return [
    `[${t.key}] ${t.title}`,
    `티켓: ${t.url}`,
    "",
    desc ? `티켓 설명:\n${desc.slice(0, 6000)}` : "(티켓에 설명이 없다)",
    subs.length ? `\n남은 하위 작업:\n${subs.join("\n")}` : "",
    "",
    `이 티켓을 이 워크트리에서 진행한다. 커밋 메시지와 PR 제목에 ${t.key}를 넣는다. 수용 조건이 분명하지 않으면 시작하기 전에 묻는다.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/** 이 티켓으로 시작: 레포·브랜치·첫 지시를 한 번 보고 띄운다 */
export default function StartTicket({ ticket, repos, remembered, startTransition, onStart, onClose }: Props) {
  const [repo, setRepo] = useState(remembered && repos.some((r) => r.repo === remembered) ? remembered : repos[0]?.repo ?? "");
  const slug = slugOf(ticket.title);
  const [branch, setBranch] = useState(slug ? `${ticket.key}-${slug}` : ticket.key);
  const [prompt, setPrompt] = useState(() => promptOf(ticket));
  const [move, setMove] = useState(!!startTransition && ticket.statusCategory === "new");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const target = repos.find((r) => r.repo === repo);
  const ok = !!target && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) && !branch.includes("..");

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div
        className="pal st"
        ref={box}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.stopPropagation(), onClose());
          else if (e.key === "Enter" && e.metaKey && ok && target) onStart({ cwd: target.cwd, repo, branch, prompt, transition: move });
        }}
      >
        <div className="st-head">
          <b>이 티켓으로 시작</b> <span className="sub">{ticket.key} · {ticket.title}</span>
        </div>
        <div className="st-body">
          <label className="st-field">
            <span>레포</span>
            <select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((r) => (
                <option key={r.cwd} value={r.repo}>
                  {r.repo}
                </option>
              ))}
            </select>
            {remembered === repo && <small>{ticket.key.split("-")[0]} → {repo} 기억함</small>}
          </label>
          {!repos.length && <div className="pr-error">지도에 레포가 없다. ⌘,의 지도에서 레포가 모인 폴더를 정한다.</div>}
          <label className="st-field">
            <span>브랜치</span>
            <input value={branch} spellCheck={false} onChange={(e) => setBranch(e.target.value.trim())} />
            <small>원격 기본 브랜치에서 딴다</small>
          </label>
          <label className="st-field top">
            <span>첫 지시</span>
            <textarea rows={12} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          {startTransition && (
            <label className="st-check">
              <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> 시작하면 {startTransition}로 옮기기 (지금 {ticket.status})
            </label>
          )}
        </div>
        <div className="st-foot">
          <button type="button" className="primary" disabled={!ok} onClick={() => target && onStart({ cwd: target.cwd, repo, branch, prompt, transition: move })}>
            시작 ⌘Enter
          </button>
          <button type="button" onClick={onClose}>
            그만
          </button>
        </div>
      </div>
    </div>
  );
}
