import { useEffect, useMemo, useRef, useState } from "react";
import Numbers from "./Numbers";
import { Act } from "./History";
import { Review } from "./review";
import MapGraph from "./MapGraph";
import Repos from "./Repos";
import { Candidate, mapDomains, mapEdges, mapItems, Note, stale, statOf, Stats, usedCount } from "./brain";
import { Job, Progress, ago, elsewhere, SkillInfo, SkillUse, kilo, Open, Session, STATE_LABEL, TermState, Thread, waiting } from "./model";
import { tr } from "./i18n";

type Props = {
  /** 브레인 노트. Tab으로 넘겨 본다 */
  notes: Note[];
  stats: Stats;
  /** 깔려 있는 스킬, 대화 기록에서 센 쓰임, 되풀이해서 시킨 일(스킬 후보) */
  skills: SkillInfo[];
  skillUses: SkillUse[];
  candidates: Candidate[];
  /** 깃 탭이 보여 줄 레포들과, 세션으로 가는 길 */
  repos: { repo: string; cwd: string }[];
  nameOf: (key: string) => string;
  onShow: (key: string) => void;
  /** 레포 지도(마크다운)와 다시 그리기 */
  map: string;
  drawing: boolean;
  onRedraw: () => void;
  /** 숫자 탭이 세는 것 */
  acts: Act[];
  /** 조율 세션이 맡긴 일감들. 줄기 아래에 보여 준다 */
  tasks: Job[];
  reviews: Review[];
  sessions: Session[];
  named: number;
  onForget: (id: string) => void;
  threads: Thread[];
  byId: Map<string, Session>;
  memories: Record<string, string>;
  /** 줄기마다 어디까지 왔는지 */
  progress: Record<string, Progress>;
  open: Open[];
  states: Record<string, TermState>;
  /** 세션 하나로 간다. 열려 있으면 그 칸으로, 잠들어 있으면 깨운다 */
  onPick: (sessionId: string) => void;
  onClose: () => void;
};

type Cell = { id: string; name: string; repo: string; tokens: number; mtime: number; state: string; label: string };
type Row = { thread: Thread; cells: Cell[]; about: string; mtime: number; group: string; repos: number };

const GROUPS = ["내 차례", "일하는 중", "쉬는 중", "끝냄"]; // i18n-ok
/** 요약에 섞인 마크다운 기호를 걷어 한 문단으로 만든다 */
const plain = (text: string) => text.replace(/[#*`>|]/g, " ").replace(/\s+/g, " ").trim();

/** 줄기 보기 (⌘G). 일마다 어떤 세션들로 이어져 왔고 어디까지 했는지를 한 화면에 편다. */
/** 일 하나가 어디까지 왔는지 네 줄. 빈 줄은 내지 않고, 막힌 것은 눈에 띄게 */
export function ProgressLines({ p }: { p: Progress }) {
  const rows: [string, string, string][] = [
    [tr("목표"), p.goal, ""],
    [tr("한 것"), p.done, ""],
    [tr("남은 것"), p.left, ""],
    [tr("막힌 것"), p.blocked, " stuck"],
  ];
  return (
    <div className="pg">
      {rows
        .filter(([, text]) => text)
        .map(([label, text, cls]) => (
          <div key={label} className={"pg-row" + cls}>
            <span className="pg-k">{label}</span>
            <span className="pg-v">{text}</span>
          </div>
        ))}
    </div>
  );
}

export default function Threads({ repos, nameOf, onShow, map, drawing, onRedraw, notes, stats, skills, skillUses, candidates, acts, tasks, reviews, sessions, named, onForget, threads, byId, progress, memories, open, states, onPick, onClose }: Props) {
  const [tab, setTab] = useState<"stems" | "brain" | "skills" | "nums" | "map" | "git">("stems");
  const [noteAt, setNoteAt] = useState(0);
  const [armed, setArmed] = useState(""); // 지우려고 한 번 누른 노트
  const note = notes[Math.min(noteAt, notes.length - 1)];
  const rows = useMemo(() => {
    const out: Row[] = threads.map((thread) => {
      const cells: Cell[] = thread.sessions.map((id) => {
        const s = byId.get(id);
        const key = "c:" + id;
        const isOpen = open.some((o) => o.key === key);
        const state = isOpen ? (states[key]?.state ?? "open") : s && elsewhere(s) ? "away" : "sleep";
        const label = state === "open" ? tr("열림") : state === "sleep" ? tr("잠듦") : state === "away" ? tr("다른 곳에서 열림") : STATE_LABEL[state] ?? state;
        return { id, name: s?.title ?? tr("기록 없는 세션"), repo: s?.repo ?? tr("기록 없음"), tokens: s?.tokens ?? 0, mtime: s?.mtime ?? 0, state, label };
      });
      // 먼저 쓴 세션이 왼쪽, 가장 최근에 쓴 세션이 오른쪽
      cells.sort((a, b) => a.mtime - b.mtime);
      const last = cells[cells.length - 1];
      const lastSession = last && byId.get(last.id);
      // 가장 최근 세션의 요약이 "지금 어디까지"에 가장 가깝다. 없으면 줄기 기억(인계 글)의 앞머리
      const about = plain((last && memories[last.id]) || lastSession?.recap || memories[thread.id] || "");
      const group = thread.done ? "끝냄" : cells.some((c) => waiting({ state: c.state, since: 0 })) ? "내 차례" : cells.some((c) => c.state === "run") ? "일하는 중" : "쉬는 중"; // i18n-ok
      return { thread, cells, about, mtime: Math.max(0, ...cells.map((c) => c.mtime)), group, repos: new Set(cells.map((c) => c.repo)).size };
    });
    return out.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || b.mtime - a.mtime);
  }, [threads, byId, memories, open, states]);

  // 스킬마다 최근 30일의 쓰임을 센다. 상태는 이 숫자로만 정한다
  const skillRows = useMemo(() => {
    const since = Date.now() - 30 * 86_400_000;
    const base = (name: string) => name.slice(name.lastIndexOf(":") + 1);
    const by = new Map<string, { uses: number; sessions: Set<string>; last: number; repos: Set<string> }>();
    for (const u of skillUses) {
      const at = Date.parse(u.at) || 0;
      if (at < since) continue;
      const row = by.get(base(u.skill)) ?? { uses: 0, sessions: new Set<string>(), last: 0, repos: new Set<string>() };
      row.uses += 1;
      row.sessions.add(u.session);
      const repo = byId.get(u.session)?.repo;
      if (repo) row.repos.add(repo);
      row.last = Math.max(row.last, at / 1000);
      by.set(base(u.skill), row);
    }
    const now = Date.now() / 1000;
    const known = skills.map((k) => {
      const u = by.get(k.name);
      by.delete(k.name);
      const status = u ? "쓰는 중" : now - k.modified > 90 * 86400 ? "낡음" : "안 쓰임"; // i18n-ok
      return { name: k.name, source: k.source, description: k.description, modified: k.modified, uses: u?.uses ?? 0, sessions: u?.sessions.size ?? 0, last: u?.last ?? 0, status, repos: [...(u?.repos ?? [])] };
    });
    // 목록에 없는데 쓰인 것(Claude Code에 딸린 것, 다른 플러그인의 것)
    const others = [...by].map(([name, u]) => ({ name, source: tr("다른 곳"), description: "", modified: 0, uses: u.uses, sessions: u.sessions.size, last: u.last, status: "쓰는 중", repos: [...u.repos] })); // i18n-ok
    // 범위는 쓰인 곳으로 정한다: 레포 두 곳 넘게 쓰였으면 공용, 한 곳에서만 쓰였으면 그 레포 전용
    const scope = (r: { uses: number; repos: string[] }) => (!r.uses ? 2 : r.repos.length >= 2 ? 0 : 1);
    return [...known, ...others].map((r) => ({ ...r, scope: scope(r) })).sort((a, b) => a.scope - b.scope || b.uses - a.uses || b.last - a.last || a.name.localeCompare(b.name));
  }, [skills, skillUses, byId]);
  // 지도 글을 레포별 카드와 관계 줄로 나눈다
  const [area, setArea] = useState(""); // 그림에서 밝혀 볼 영역
  const [peek, setPeek] = useState(""); // 마우스를 올린 영역. 고정한 것보다 먼저다
  const { mapAreas, mapLines, mapRepos, mapLinks, mapStamp } = useMemo(() => {
    const repos: { name: string; role: string; rows: [string, string][] }[] = [];
    let links: string[] = [];
    for (const part of `\n${map}`.split(/\n## /).slice(1)) {
      const name = part.split("\n")[0].trim();
      if (name === "연결" || name === "도메인") continue; // 선과 영역은 따로 읽는다 · i18n-ok
      const rows = mapItems(part);
      if (name.includes("관계")) links = rows.map(([label, text]) => (label ? `${label}: ${text}` : text)); // i18n-ok
      else repos.push({ name, role: rows.find(([label]) => label === "역할")?.[1] ?? "", rows: rows.filter(([label]) => label !== "역할") }); // i18n-ok
    }
    // 같은 역할끼리 모아 보여 준다
    repos.sort((a, b) => a.role.localeCompare(b.role));
    return { mapAreas: mapDomains(map), mapLines: mapEdges(map), mapRepos: repos, mapLinks: links, mapStamp: map.match(/\((\d{4}-\d{2}-\d{2})/)?.[1] ?? "" };
  }, [map]);
  const shownArea = mapAreas.find((d) => d.name === (peek || area));
  const usedNotes = notes.filter((n) => usedCount(statOf(stats, n.id)) > 0).length;
  const staleNotes = notes.filter((n) => stale(n, statOf(stats, n.id))).length;

  const [sel, setSel] = useState(0);
  const [cell, setCell] = useState(-1); // -1: 그 줄기의 지금(맨 뒤) 세션
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void box.current?.querySelector(".th-row.on")?.scrollIntoView({ block: "nearest" }), [sel]);
  const at = Math.min(sel, rows.length - 1);
  const row = rows[at];
  const cellAt = row ? (cell < 0 ? row.cells.length - 1 : Math.min(cell, row.cells.length - 1)) : 0;

  const onKey = (e: React.KeyboardEvent) => {
    const TABS = ["stems", "brain", "skills", "nums", "map", "git"] as const;
    if (e.metaKey && /^Digit[1-6]$/.test(e.code)) {
      setTab(TABS[Number(e.code.slice(5)) - 1]);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Escape") onClose();
    else if (e.key === "Tab") setTab(tab === "stems" ? "brain" : tab === "brain" ? "skills" : tab === "skills" ? "nums" : tab === "nums" ? "map" : tab === "map" ? "git" : "stems");
    else if (tab === "skills" || tab === "nums" || tab === "map" || tab === "git") return;
    else if (tab === "brain") {
      if (e.key === "ArrowDown") setNoteAt(Math.min(noteAt + 1, notes.length - 1));
      else if (e.key === "ArrowUp") setNoteAt(Math.max(noteAt - 1, 0));
      else if ((e.key === "Backspace" || e.key === "Delete") && note) {
        // 한 번 누르면 묻고, 한 번 더 누르면 지운다
        if (armed === note.id) (onForget(note.id), setArmed(""));
        else setArmed(note.id);
      } else return;
      if (e.key.startsWith("Arrow")) setArmed("");
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setSel((at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % Math.max(1, rows.length));
      setCell(-1);
    } else if (e.key === "ArrowLeft") setCell(Math.max(0, cellAt - 1));
    else if (e.key === "ArrowRight") setCell(Math.min((row?.cells.length ?? 1) - 1, cellAt + 1));
    else if (e.key === "Enter" && row?.cells[cellAt]) onPick(row.cells[cellAt].id);
    else return;
    e.preventDefault();
  };

  const count = (group: string) => rows.filter((r) => r.group === group).length;
  const mine = count("내 차례"), busy = count("일하는 중"); // i18n-ok
  return (
    <div className="pal-back wide" onMouseDown={onClose}>
      <div className="threads" ref={box} tabIndex={-1} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
        <div className="th-head">
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "stems" ? " on" : "")} onClick={() => setTab("stems")}>
            <kbd>⌘1</kbd> {tr`줄기 ${rows.length}`}
          </button>
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "brain" ? " on" : "")} onClick={() => setTab("brain")}>
            <kbd>⌘2</kbd> {tr`브레인 ${notes.length}`}
          </button>
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "skills" ? " on" : "")} onClick={() => setTab("skills")}>
            <kbd>⌘3</kbd> {tr`스킬 ${skillRows.length}`}
          </button>
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "nums" ? " on" : "")} onClick={() => setTab("nums")}>
            <kbd>⌘4</kbd> {tr("통계")}
          </button>
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "map" ? " on" : "")} onClick={() => setTab("map")}>
            <kbd>⌘5</kbd> {tr`지도 ${mapRepos.length}`}
          </button>
          <button type="button" tabIndex={-1} className={"th-tab" + (tab === "git" ? " on" : "")} onClick={() => setTab("git")}>
            <kbd>⌘6</kbd> {tr("깃")}
          </button>
          {mine > 0 && <span className="waitcount">{tr`내 차례 ${mine}`}</span>}
          {busy > 0 && <span className="th-run">{tr`일하는 중 ${busy}`}</span>}
          <span className="th-dim th-hint">{tab === "stems" ? tr("상자 하나가 세션 하나. 왼쪽이 먼저 한 것, 오른쪽이 지금 하는 것") : tab === "brain" ? tr`한 번이라도 쓰인 노트 ${usedNotes} / ${notes.length} · 석 달 넘게 안 쓰인 것 ${staleNotes}` : tab === "git" ? tr("레포마다 어느 브랜치에 있고 무엇이 안 올라갔는지. 줄을 누르면 브랜치와 MR이 펴진다") : tab === "map" ? tr("세션이 다른 레포를 봐야 할 때 이 지도를 보고 찾아간다") : tab === "nums" ? tr("매일과 매주 점검하고 판마다 기록을 남긴다") : tr`최근 30일 · 쓰인 스킬 ${skillRows.filter((r) => r.uses > 0).length} / ${skillRows.length} · 부른 횟수 ${skillRows.reduce((a, r) => a + r.uses, 0)}`}</span>
        </div>
        {tab === "brain" && (
          <div className="br">
            <div className="br-list">
              {notes.length === 0 && <div className="side-none">{tr("아직 없다. 큰 세션을 갈아타거나 세션이 메모를 남기면 Julgi가 거기서 추려 담는다.")}</div>}
              {notes.map((n, i) => (
                <div key={n.id} className={"br-row" + (n === note ? " on" : "")} onClick={() => (setNoteAt(i), setArmed(""))}>
                  <span className={"br-kind k-" + n.kind}>{tr(n.kind)}</span>
                  <span className="br-title">{n.title}</span>
                  <span className="br-repo">
                    {n.repo}
                    {usedCount(statOf(stats, n.id)) > 0 && <b> · {tr`${usedCount(statOf(stats, n.id))}번`}</b>}
                  </span>
                </div>
              ))}
            </div>
            {note && (
              <div className="br-body">
                <div className="br-head">
                  <span className={"br-kind k-" + note.kind}>{tr(note.kind)}</span>
                  <b>{note.title}</b>
                </div>
                <p>{note.body}</p>
                <div className="br-from">
                  {[note.repo, note.from && tr`"${note.from}"에서`, note.created].filter(Boolean).join(" · ")}
                </div>
                <div className="br-nums">
                  <span>
                    <b>{statOf(stats, note.id).out}</b> {tr("새 세션에 붙임")}
                  </span>
                  <span>
                    <b>{statOf(stats, note.id).read}</b> {tr("세션이 찾아봄")}
                  </span>
                  <span>
                    <b>{statOf(stats, note.id).fixed}</b> {tr("고침")}
                  </span>
                  <span>{statOf(stats, note.id).last ? tr`마지막 ${ago(statOf(stats, note.id).last / 1000)}` : stale(note, statOf(stats, note.id)) ? tr("석 달 넘게 안 쓰임") : tr("아직 안 쓰임")}</span>
                </div>
                <button type="button" tabIndex={-1} className="br-del" onClick={() => (armed === note.id ? (onForget(note.id), setArmed("")) : setArmed(note.id))}>
                  {armed === note.id ? tr("한 번 더 누르면 지운다") : tr("틀렸거나 쓸모없으면 지우기")}
                </button>
              </div>
            )}
          </div>
        )}
        {tab === "git" && <Repos repos={repos} open={open} nameOf={nameOf} onShow={onShow} />}
        {tab === "map" && (
          <div className="mp">
            <div className="mp-bar">
              <span>{mapRepos.length ? tr`레포 ${mapRepos.length}개 · 이어진 선 ${mapLines.length}개 · ${mapStamp}` : tr("아직 지도가 없다. 켜고 1분쯤 뒤 Julgi가 그린다")}</span>
              <button type="button" tabIndex={-1} onClick={onRedraw} disabled={drawing}>
                {drawing ? tr("그리는 중… 1~2분 걸린다") : tr("지금 다시 그리기")}
              </button>
            </div>
            {mapRepos.length > 1 && <MapGraph repos={mapRepos} edges={mapLines} focus={shownArea ? shownArea.pieces.map((piece) => piece.repo) : []} />}
            {mapAreas.length > 0 && (
              <div className="ar">
                <div className="ar-chips">
                  <b>{tr("영역")}</b>
                  {mapAreas.map((d) => (
                    <button
                      key={d.name}
                      type="button"
                      tabIndex={-1}
                      className={"ar-chip" + (area === d.name ? " on" : "")}
                      onMouseEnter={() => setPeek(d.name)}
                      onMouseLeave={() => setPeek("")}
                      onClick={() => setArea(area === d.name ? "" : d.name)}
                    >
                      {d.name}
                    </button>
                  ))}
                  <span>{tr("올리면 위 그림에서 그 영역만 밝아진다. 누르면 고정된다")}</span>
                </div>
                {shownArea && (
                  <div className="ar-detail">
                    {shownArea.pieces.map((piece, i) => (
                      <span key={i}>
                        <i>{piece.repo}</i>
                        {piece.path && `/${piece.path}`}
                        {piece.what && <small> · {piece.what}</small>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mapLinks.length > 0 && (
              <div className="mp-links">
                <b>{tr("레포끼리의 관계")}</b>
                {mapLinks.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
            <div className="mp-grid">
              {mapRepos.map((r) => (
                <div key={r.name} className="mp-card">
                  <b>{r.name}</b>
                  {r.role && <span className="mp-role">{r.role}</span>}
                  {r.rows.map(([label, text]) => (
                    <p key={label}>
                      <i>{label}</i>
                      {text}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "nums" && <Numbers acts={acts} tasks={tasks} reviews={reviews} sessions={sessions} threads={threads} open={open} notes={notes} stats={stats} skills={skills} skillUses={skillUses} candidates={candidates} named={named} />}
        {tab === "skills" && (
          <div className="sk">
            <div className="sk-row sk-head">
              <span>{tr("스킬")}</span>
              <span>{tr("부른 횟수")}</span>
              <span>{tr("세션")}</span>
              <span>{tr("마지막으로 씀")}</span>
              <span>{tr("마지막으로 고침")}</span>
              <span>{tr("상태")}</span>
              <span>{tr("쓰인 레포")}</span>
            </div>
            {skillRows.map((r, i) => (
              <div key={r.name + r.source}>
                {(i === 0 || skillRows[i - 1].scope !== r.scope) && <div className="th-group">{[tr("공용 · 레포 두 곳 넘게 쓰임"), tr("레포 전용 · 한 곳에서만 쓰임"), tr("최근 30일 동안 안 쓰임")][r.scope]}</div>}
              <div className={"sk-row s-" + r.status} title={r.description}>
                <span className="sk-name">
                  {r.name}
                  <small>{r.source}</small>
                </span>
                <span className="sk-num">{r.uses || "–"}</span>
                <span className="sk-num">{r.sessions || "–"}</span>
                <span>{r.last ? ago(r.last) : "–"}</span>
                <span>{r.modified ? ago(r.modified) : "–"}</span>
                <span className="sk-status">{tr(r.status)}</span>
                <span className="sk-repos">{r.repos.join(", ")}</span>
              </div>
              </div>
            ))}
            <div className="th-group">{tr`되풀이해서 시킨 일 · 스킬 후보 ${candidates.length}`}</div>
            {candidates.length === 0 && <div className="side-none">{tr("아직 없다. 하루에 한 번, 최근 30일 동안 같은 종류의 일을 세 번 넘게 시켰는지 본다.")}</div>}
            {candidates.map((c) => (
              <div key={c.name} className="sk-cand">
                <b>{c.name}</b>
                <span className="sk-num">{tr`${c.count}번`}</span>
                <span>{c.what}</span>
                <small>{tr`${c.found}에 찾음`}</small>
              </div>
            ))}
          </div>
        )}
        <div className="th-list" hidden={tab !== "stems"}>
          {rows.length === 0 && <div className="side-none">{tr("아직 줄기가 없다. ⌘I에서 이름을 붙이거나, 큰 세션을 갈아타면 생긴다.")}</div>}
          {rows.map((r, i) => (
            <div key={r.thread.id}>
              {(i === 0 || rows[i - 1].group !== r.group) && <div className={"th-group g" + GROUPS.indexOf(r.group)}>{tr(r.group)}</div>}
              <div className={"th-row" + (i === at ? " on" : "") + (r.thread.done ? " done" : "")} onClick={() => (setSel(i), setCell(-1))} onDoubleClick={() => onPick(r.cells[r.cells.length - 1].id)}>
                <div className="th-what">
                  <div className="th-name">{r.thread.name}</div>
                  <div className="th-meta">
                    {[...new Set(r.cells.map((c) => c.repo))].join(" + ")} · {tr`세션 ${r.cells.length}개`}
                  </div>
                  {progress[r.thread.id] ? (
                    <ProgressLines p={progress[r.thread.id]} />
                  ) : (
                    <div className="th-about">{r.about.slice(0, 190) || tr("요약이 아직 없다")}</div>
                  )}
                  {tasks.some((t) => r.thread.sessions.includes(t.lead)) && (
                    <div className="th-tasks">
                      {tasks
                        .filter((t) => r.thread.sessions.includes(t.lead))
                        .slice(-6)
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            tabIndex={-1}
                            className={"th-task k-" + t.status.replace(" ", "")}
                            title={t.result ? t.result.slice(0, 400) : t.ask}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (t.session) onPick(t.session);
                            }}
                          >
                            <b>{tr(t.status)}</b>
                            <span>
                              {t.repo} · {t.ask.split("\n")[0].slice(0, 46)}
                              {t.redo > 0 && " · " + tr`다시 ${t.redo}번`}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="th-cells">
                  {r.cells.map((c, j) => (
                    <span key={c.id} className="th-step">
                      {j > 0 && (
                        <span className="th-arrow" aria-hidden="true">
                          →
                        </span>
                      )}
                      <button
                        type="button"
                        tabIndex={-1}
                        className={"th-cell s-" + c.state + (i === at && j === cellAt ? " picked" : "")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (i === at && j === cellAt) return onPick(c.id);
                          setSel(i);
                          setCell(j);
                        }}
                      >
                        <span className="th-cname">
                          {r.cells.length > 1 && <i>{j === r.cells.length - 1 ? tr("지금") : j + 1}</i>}
                          {c.name}
                        </span>
                        <span className="th-state">{[c.label, kilo(c.tokens), c.mtime ? ago(c.mtime) : "", r.repos > 1 ? c.repo : ""].filter(Boolean).join(" · ")}</span>
                      </button>
                    </span>
                  ))}
                  
                </div>
                <div className="th-when">{r.mtime ? ago(r.mtime) : ""}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="pal-foot">{tab === "stems" ? tr("↑↓ 줄기 고르기 · ←→ 줄기 안의 세션 고르기 · Enter 그 세션으로 · ⌘1–⌘4 또는 Tab으로 탭 바꾸기 · Esc") : tab === "brain" ? tr("↑↓ 노트 고르기 · ⌫ 지우기 · Tab 스킬 · Esc") : tab === "git" ? tr("보기만 한다. 브랜치를 바꾸거나 올리는 것은 세션에게 시킨다 · ⌘1–⌘6 · Esc") : tab === "map" ? tr("레포를 넣고 빼는 것은 ⌘, 설정의 \"레포가 모여 있는 폴더\" · ⌘1–⌘5 · Esc") : tab === "nums" ? tr("⌘1–⌘5 또는 Tab으로 탭 바꾸기 · Esc") : tr("상태는 숫자로 정한다: 30일 안에 쓰였으면 쓰는 중, 안 쓰였으면 안 쓰임, 안 쓰이고 석 달 넘게 안 고쳤으면 낡음 · Tab 통계 · Esc")}</div>
      </div>
    </div>
  );
}
