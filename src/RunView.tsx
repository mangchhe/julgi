import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CiJob, CiRun, ciLabel, ciLive, ciTook } from "./ci";
import { repoName } from "./pr";
import { tr } from "./i18n";

type Props = {
  run: CiRun;
  /** 실패한 job을 세션에 고치라고 넘긴다. 보낼 곳은 보내기 상자에서 정한다 */
  onFix: (run: CiRun, job: CiJob, log: string) => void;
};

// 한 번 받은 job 목록과 로그는 기억해 둔다(키: 레포#실행). 다시 고르면 기다리지 않고 바로 그린다.
// 끝난 실행은 바뀌지 않으니 다시 읽지 않고, 도는 실행은 기억한 것을 먼저 그린 뒤 새로 읽는다
const jobCache = new Map<string, CiJob[]>();
const logCache = new Map<string, string>();
const pending = new Map<string, Promise<CiJob[]>>();
const idOf = (run: CiRun) => `${run.repo}#${run.id}`;
const settled = (list: CiJob[]) => list.length > 0 && !list.some((j) => ciLive(j.state));
const fetchJobs = (run: CiRun) => {
  const key = idOf(run);
  const going = pending.get(key);
  if (going) return going;
  const p = invoke<CiJob[]>("ci_jobs", { repo: run.repo, id: run.id })
    .then((list) => (jobCache.set(key, list), list))
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
};
/** 곧 볼 것 같은 실행의 job을 미리 받아 둔다 (목록에서 위아래 것, 탭을 열 때 맨 위 것) */
export const prefetchRun = (run?: CiRun) => {
  if (run && !jobCache.has(idOf(run))) void fetchJobs(run).catch(() => {});
};

/** job들을 단계별로 묶는다. 단계는 job이 처음 나온 순서대로, 곧 GitLab의 단계 순서다 */
export function stagesOf(jobs: CiJob[]): { name: string; jobs: CiJob[] }[] {
  const out: { name: string; jobs: CiJob[] }[] = [];
  for (const j of jobs) {
    const hit = out.find((s) => s.name === j.stage);
    if (hit) hit.jobs.push(j);
    else out.push({ name: j.stage, jobs: [j] });
  }
  return out;
}

/** CI 실행 하나: job마다 상태와 걸린 시간, 실패한 job은 로그 끝부분. 도는 동안에는 몇 초마다 다시 읽는다 */
export default function RunView({ run, onFix }: Props) {
  const [jobs, setJobs] = useState<CiJob[] | string | undefined>(() => jobCache.get(idOf(run)));
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [, tick] = useState(0);
  // GitLab은 단계가 있어 그림으로 그린다. GitHub Actions는 단계가 없어 목록 그대로다
  const lab = run.repo.startsWith("gitlab:");
  const [graph, setGraph] = useState(() => {
    try {
      return localStorage.getItem("ci-graph") !== "0";
    } catch {
      return true;
    }
  });
  const [picked, setPicked] = useState("");
  useEffect(() => {
    let timer = 0;
    let gone = false;
    const known = jobCache.get(idOf(run));
    // 끝난 실행을 이미 받아 두었으면 다시 읽지 않는다
    if (known && settled(known) && !ciLive(run.state)) return;
    const read = () =>
      void fetchJobs(run).then(
        (list) => {
          if (gone) return;
          setJobs(list);
          // job이 하나라도 안 끝났으면 계속 읽는다. 다 끝났으면 멈춘다
          if (!settled(list)) timer = window.setTimeout(read, 5000);
        },
        (e) => !gone && setJobs((old) => (Array.isArray(old) ? old : String(e))),
      );
    read();
    // 도는 job의 걸린 시간이 흐르게 한다
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => ((gone = true), clearTimeout(timer), clearInterval(clock));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.repo, run.id]);
  const list = Array.isArray(jobs) ? jobs : [];
  const logKey = (j: CiJob) => `${idOf(run)}#${j.id}`;
  const logOf = (j: CiJob) => logs[j.id] ?? logCache.get(logKey(j));
  // 실패한 job의 로그는 저절로 읽어 온다
  useEffect(() => {
    for (const j of list)
      if (j.state === "fail" && logOf(j) === undefined) {
        setLogs((old) => ({ ...old, [j.id]: "" }));
        void invoke<string>("ci_log", { repo: run.repo, id: run.id, job: j.id }).then(
          (text) => {
            const got = text || tr`로그가 비어 있다`;
            logCache.set(logKey(j), got);
            setLogs((old) => ({ ...old, [j.id]: got }));
          },
          (e) => setLogs((old) => ({ ...old, [j.id]: String(e) })),
        );
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
  const state = list.length ? (list.some((j) => ciLive(j.state)) ? (list.some((j) => j.state === "run") ? "run" : "queued") : list.some((j) => j.state === "fail") ? "fail" : run.state === "cancel" ? "cancel" : "ok") : run.state;
  const done = list.filter((j) => !ciLive(j.state)).length;
  const stages = lab ? stagesOf(list) : [];
  const drawn = lab && graph && stages.length > 0;
  // 그림에서는 고른 job의 로그를 아래에 편다. 안 골랐으면 처음 실패한 job이다
  const shown = list.find((j) => j.id === picked) ?? list.find((j) => j.state === "fail");
  const logBox = (j: CiJob) => (
    <div className="ci-log">
      <pre>{logOf(j) || tr`로그를 읽는 중`}</pre>
      <button type="button" tabIndex={-1} className="primary" disabled={!logOf(j)} onClick={() => onFix(run, j, logOf(j) ?? "")}>
        {tr`세션에 고치라고 하기`}
      </button>
    </div>
  );
  return (
    <div className="ci">
      <div className="ci-head">
        <div>
          <b>{run.title || run.name}</b>
          <small>
            {repoName(run.repo)} · {run.name} · {run.branch}
          </small>
        </div>
        <span className={"ci-state s-" + state}>{ciLabel(state)}</span>
        {list.length > 0 && <small>{tr`job ${done} / ${list.length}`} · {ciTook(run.started, ciLive(state) ? "" : run.at)}</small>}
        {lab && (
          <button
            type="button"
            tabIndex={-1}
            title={tr`단계별 그림과 목록을 오간다`}
            onClick={() => {
              setGraph(!graph);
              try {
                localStorage.setItem("ci-graph", graph ? "0" : "1");
              } catch {
                // 저장이 막혀 있으면 이번에만 유지된다
              }
            }}
          >
            {graph ? tr`목록으로` : tr`그림으로`}
          </button>
        )}
        <button type="button" tabIndex={-1} onClick={() => void openUrl(run.url)}>
          {tr`웹에서 열기`}
        </button>
      </div>
      <div className="ci-jobs">
        {/* 처음 받는 동안에는 글자 대신 자리만 잡아 둔다. 머리는 목록의 정보로 이미 그려져 있다 */}
        {jobs === undefined && (
          <div className="ci-bones" aria-label={tr`읽는 중`}>
            <i />
            <i />
            <i />
          </div>
        )}
        {typeof jobs === "string" && <div className="side-none">{jobs}</div>}
        {Array.isArray(jobs) && !jobs.length && <div className="side-none">{tr`아직 job이 없다`}</div>}
        {drawn && (
          <>
            <div className="ci-graph">
              {stages.map((s, n) => (
                <div key={s.name + n} className="ci-stage">
                  <div className="ci-stage-name">{s.name || tr`단계`}</div>
                  {s.jobs.map((j) => (
                    <button key={j.id} type="button" tabIndex={-1} className={"ci-cell s-" + j.state + (shown?.id === j.id ? " on" : "")} onClick={() => setPicked(j.id)} title={`${j.name} · ${ciLabel(j.state)}`}>
                      <i className={"ci-dot s-" + j.state} aria-hidden="true" />
                      <b>{j.name}</b>
                      <small>{ciTook(j.started, j.finished)}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {shown && (
              <div className="ci-job">
                <div className="ci-job-line">
                  <i className={"ci-dot s-" + shown.state} aria-hidden="true" />
                  <b>{shown.name}</b>
                  <small>{shown.stage}</small>
                  <span className={"ci-state s-" + shown.state}>{ciLabel(shown.state)}</span>
                  <small className="ci-took">{ciTook(shown.started, shown.finished)}</small>
                </div>
                {shown.state === "fail" && logBox(shown)}
              </div>
            )}
          </>
        )}
        {!drawn &&
          list.map((j) => (
            <div key={j.id} className="ci-job">
              <div className="ci-job-line">
                <i className={"ci-dot s-" + j.state} aria-hidden="true" />
                <b>{j.name}</b>
                {j.stage && <small>{j.state === "fail" && !lab ? tr`실패한 단계: ${j.stage}` : j.stage}</small>}
                <span className={"ci-state s-" + j.state}>{ciLabel(j.state)}</span>
                <small className="ci-took">{ciTook(j.started, j.finished)}</small>
              </div>
              {j.state === "fail" && logBox(j)}
            </div>
          ))}
      </div>
    </div>
  );
}
