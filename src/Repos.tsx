import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Open } from "./model";
import { tr } from "./i18n";

type Branch = { name: string; ahead: number; behind: number; last: string; when: string };
/** 원격의 오래 사는 브랜치. wait: 기준 브랜치에는 있는데 여기에는 아직 없는 커밋 수, own: 여기에만 있는 커밋 수 */
// kind는 git을 읽는 쪽이 주는 값이다 i18n-ok
type Line = { name: string; kind: "개발" | "배포" | "릴리스"; wait: number; own: number; when: string };
type Tag = { name: string; when: string; wait: number; stable: boolean };
type State = { branch: string; default: string; dirty: number; ahead: number; behind: number; branches: Branch[]; worktrees: [string, string][]; forge: string; lines: Line[]; tags: Tag[] };
/** 브랜치, 제목, 주소, 상태, CI 결과 */
type Mr = [string, string, string, string, string];
type Props = {
  repos: { repo: string; cwd: string }[];
  open: Open[];
  /** 세션의 이름. 그 레포에서 열려 있는 세션을 보여 주는 데 쓴다 */
  nameOf: (key: string) => string;
  onShow: (key: string) => void;
};

const CI: Record<string, string> = { success: tr`통과`, failed: tr`실패`, running: tr`도는 중`, pending: tr`대기`, canceled: tr`취소됨`, skipped: tr`건너뜀`, manual: tr`손으로 돌림` };
const MR_STATE: Record<string, string> = { opened: tr`열림`, open: tr`열림`, merged: tr`머지됨`, closed: tr`닫힘` };

/**
 * 깃 (⌘G의 여섯째 탭). 레포마다 브랜치가 어떻게 굴러가는지: 기준 브랜치가 무엇이고, 개발·배포 브랜치가 거기서 얼마나 벌어져 있고, 마지막 태그가 무엇인지.
 * 펴면 내 쪽 사정(지금 브랜치, 안 올린 것, 내 브랜치와 MR·PR)이 나온다.
 * 브랜치와 커밋은 git으로 읽고, MR·PR은 glab이나 gh가 깔려 있을 때만 읽는다. 여기서 고치는 것은 없다
 */
export default function Repos({ repos, open, nameOf, onShow }: Props) {
  const [states, setStates] = useState<Record<string, State | null>>({});
  const [mrs, setMrs] = useState<Record<string, Mr[]>>({});
  const [at, setAt] = useState("");

  useEffect(() => {
    for (const r of repos)
      void invoke<State | null>("repo_state", { path: r.cwd }).then(
        (st) => {
          setStates((old) => ({ ...old, [r.cwd]: st ?? null }));
          // MR·PR은 느리다. 기본 브랜치가 아닌 곳에 있거나 다른 브랜치가 있는 레포만 물어본다
          if (st?.forge && st.branches.some((b) => b.name !== st.default)) void invoke<Mr[]>("repo_mrs", { path: r.cwd, forge: st.forge }).then((list) => setMrs((old) => ({ ...old, [r.cwd]: list })), () => {});
        },
        () => setStates((old) => ({ ...old, [r.cwd]: null })),
      );
    // 탭을 열 때 한 번 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 손볼 것이 있는 레포를 위로: 고친 파일이 있거나, 기본 브랜치가 아니거나, 안 올린 커밋이 있는 것
  const rows = useMemo(() => {
    const weight = (cwd: string) => {
      const st = states[cwd];
      if (!st) return 0;
      return (st.dirty ? 4 : 0) + (st.branch !== st.default ? 2 : 0) + (st.ahead > 0 ? 1 : 0);
    };
    return [...repos].sort((a, b) => weight(b.cwd) - weight(a.cwd));
  }, [repos, states]);

  return (
    <div className="gt">
      <div className="gt-row gt-head">
        <span>{tr`레포`}</span>
        <span>{tr`기준`}</span>
        <span>{tr`개발 · 배포 (기준보다 뒤처진 커밋)`}</span>
        <span>{tr`태그`}</span>
        <span>{tr`내 쪽`}</span>
      </div>
      {repos.length === 0 && <div className="side-none">{tr`지도에 레포가 없다. ⌘, 설정의 "레포가 모여 있는 폴더"를 정하면 여기에 나온다.`}</div>}
      {rows.map((r) => {
        const st = states[r.cwd];
        const here = open.filter((o) => o.cwd === r.cwd || st?.worktrees.some(([dir]) => dir === o.cwd));
        const mine = mrs[r.cwd] ?? [];
        const on = at === r.cwd;
        const tag = st?.tags[0];
        return (
          <div key={r.cwd} className={"gt-repo" + (on ? " on" : "")}>
            <div className="gt-row" onClick={() => setAt(on ? "" : r.cwd)}>
              <b>{r.repo}</b>
              {st === undefined && <span className="gt-dim">{tr`읽는 중`}</span>}
              {st === null && <span className="gt-dim">{tr`git 레포가 아니다`}</span>}
              {st && (
                <>
                  <span className="gt-branch">{st.default || "–"}</span>
                  <span className="gt-lines">
                    {st.lines.length === 0 && <span className="gt-dim">{tr`기준 브랜치 하나로 굴러간다`}</span>}
                    {st.lines.slice(0, 4).map((l) => ( // i18n-ok
                      <span key={l.name} className={"gt-line k-" + (l.kind === "개발" ? "dev" : "out") + (l.wait ? " late" : "")} title={`${tr`${tr(l.kind)} 브랜치`} · ${tr`마지막 커밋 ${l.when}`}${l.own ? ` · ${tr`여기에만 있는 커밋 ${l.own}`}` : ""}`}>
                        {l.name}
                        <i>{l.wait ? `−${l.wait}` : "="}</i>
                      </span>
                    ))}
                    {st.lines.length > 4 && <span className="gt-dim">+{st.lines.length - 4}</span>}
                  </span>
                  <span className="gt-dim" title={tag ? `${tag.when} · ${tr`그 뒤로 기준 브랜치에 커밋 ${tag.wait}`}` : ""}>
                    {tag ? tag.name : "–"}
                    {tag && tag.wait > 0 && <small> +{tag.wait}</small>}
                  </span>
                  <span className="gt-dim">
                    {st.branch !== st.default && <span className="gt-branch off">{st.branch} </span>}
                    {st.dirty > 0 && <em>{tr`고침 ${st.dirty}`} </em>}
                    {st.ahead > 0 && <em>{tr`안 올림 ${st.ahead}`} </em>}
                    {mine.length > 0 && <span>MR {mine.length} </span>}
                    {here.length > 0 && <span>{tr`세션 ${here.length}`}</span>}
                  </span>
                </>
              )}
            </div>
            {on && st && (
              <div className="gt-more">
                <div className="gt-flow">
                  <div className="gt-f">
                    <b>{tr`기준`}</b>
                    <span className="gt-branch">{st.default}</span>
                    <span className="gt-dim">{tr`새 브랜치를 따고 MR·PR을 보내는 곳`}</span>
                  </div>
                  {st.lines.map((l) => (
                    <div key={l.name} className="gt-f">
                      <b>{tr(l.kind)}</b>
                      <span className="gt-branch">{l.name}</span>
                      <span className="gt-dim">
                        {l.wait ? <em>{tr`기준의 커밋 ${l.wait}개가 아직 안 들어갔다`}</em> : tr`기준의 것이 다 들어가 있다`}
                        {l.own > 0 && ` · ${tr`여기에만 있는 커밋 ${l.own}`}`} · {tr`마지막 커밋 ${l.when}`}
                      </span>
                    </div>
                  ))}
                  {st.tags.map((t) => (
                    <div key={t.name} className="gt-f">
                      <b>{t.stable ? tr`정식 태그` : tr`최근 태그`}</b>
                      <span className="gt-branch">{t.name}</span>
                      <span className="gt-dim">
                        {t.when} · {tr`그 뒤로 기준 브랜치에 커밋 ${t.wait}`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="gt-sub">
                  {tr`내 쪽 · 지금 ${st.branch}`}
                  {st.dirty > 0 && ` · ${tr`고친 파일 ${st.dirty}`}`}
                  {st.ahead > 0 && ` · ${tr`안 올린 커밋 ${st.ahead}`}`}
                  {st.behind > 0 && ` · ${tr`뒤처짐 ${st.behind}`}`}
                  {st.ahead < 0 && ` · ${tr`원격에 없는 브랜치`}`}
                </div>
                {st.branches.map((b) => {
                  const mr = mine.find((m) => m[0] === b.name);
                  const tree = st.worktrees.find(([, name]) => name === b.name);
                  return (
                    <div key={b.name} className="gt-b">
                      <span className={"gt-branch" + (b.name === st.default ? "" : " off") + (b.name === st.branch ? " cur" : "")}>{b.name}</span>
                      <span className="gt-dim">{b.name === st.default ? tr`기본 브랜치` : tr`기본보다 앞 ${b.ahead} · 뒤 ${b.behind}`}</span>
                      <span className="gt-last">
                        {b.last} <small>{b.when}</small>
                        {tree && tree[0] !== r.cwd && <small> · {tr`워크트리 ${tree[0].replace(/^\/Users\/[^/]+/, "~")}`}</small>}
                      </span>
                      {mr ? (
                        <button type="button" tabIndex={-1} className={"gt-mr ci-" + mr[4]} title={mr[2]} onClick={() => void openUrl(mr[2])}>
                          {mr[1].slice(0, 46)} · {MR_STATE[mr[3]] ?? mr[3]}
                          {mr[4] && ` · CI ${CI[mr[4]] ?? mr[4]}`}
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
                {here.length > 0 && (
                  <div className="gt-sessions">
                    <small>{tr`여기서 열려 있는 세션`}</small>
                    {here.map((o) => (
                      <button key={o.key} type="button" tabIndex={-1} onClick={() => onShow(o.key)}>
                        {nameOf(o.key).slice(0, 50)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
