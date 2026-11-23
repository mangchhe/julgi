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

/** CI 실행 하나: job마다 상태와 걸린 시간, 실패한 job은 로그 끝부분. 도는 동안에는 몇 초마다 다시 읽는다 */
export default function RunView({ run, onFix }: Props) {
  const [jobs, setJobs] = useState<CiJob[] | string | undefined>(undefined);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [, tick] = useState(0);
  useEffect(() => {
    let timer = 0;
    let gone = false;
    const read = () =>
      void invoke<CiJob[]>("ci_jobs", { repo: run.repo, id: run.id }).then(
        (list) => {
          if (gone) return;
          setJobs(list);
          // job이 하나라도 안 끝났으면 계속 읽는다. 다 끝났으면 멈춘다
          if (!list.length || list.some((j) => ciLive(j.state))) timer = window.setTimeout(read, 5000);
        },
        (e) => !gone && setJobs(String(e)),
      );
    read();
    // 도는 job의 걸린 시간이 흐르게 한다
    const clock = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => ((gone = true), clearTimeout(timer), clearInterval(clock));
  }, [run.repo, run.id]);
  const list = Array.isArray(jobs) ? jobs : [];
  // 실패한 job의 로그는 저절로 읽어 온다
  useEffect(() => {
    for (const j of list)
      if (j.state === "fail" && logs[j.id] === undefined) {
        setLogs((old) => ({ ...old, [j.id]: "" }));
        void invoke<string>("ci_log", { repo: run.repo, id: run.id, job: j.id }).then(
          (text) => setLogs((old) => ({ ...old, [j.id]: text || tr`로그가 비어 있다` })),
          (e) => setLogs((old) => ({ ...old, [j.id]: String(e) })),
        );
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
  const state = list.length ? (list.some((j) => ciLive(j.state)) ? (list.some((j) => j.state === "run") ? "run" : "queued") : list.some((j) => j.state === "fail") ? "fail" : run.state === "cancel" ? "cancel" : "ok") : run.state;
  const done = list.filter((j) => !ciLive(j.state)).length;
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
        <button type="button" tabIndex={-1} onClick={() => void openUrl(run.url)}>
          {tr`웹에서 열기`}
        </button>
      </div>
      <div className="ci-jobs">
        {jobs === undefined && <div className="side-none">{tr`읽는 중`}</div>}
        {typeof jobs === "string" && <div className="side-none">{jobs}</div>}
        {Array.isArray(jobs) && !jobs.length && <div className="side-none">{tr`아직 job이 없다`}</div>}
        {list.map((j) => (
          <div key={j.id} className="ci-job">
            <div className="ci-job-line">
              <i className={"ci-dot s-" + j.state} aria-hidden="true" />
              <b>{j.name}</b>
              {j.stage && <small>{j.state === "fail" && !run.repo.startsWith("gitlab:") ? tr`실패한 단계: ${j.stage}` : j.stage}</small>}
              <span className={"ci-state s-" + j.state}>{ciLabel(j.state)}</span>
              <small className="ci-took">{ciTook(j.started, j.finished)}</small>
            </div>
            {j.state === "fail" && (
              <div className="ci-log">
                <pre>{logs[j.id] || tr`로그를 읽는 중`}</pre>
                <button type="button" tabIndex={-1} className="primary" disabled={!logs[j.id]} onClick={() => onFix(run, j, logs[j.id] ?? "")}>
                  {tr`세션에 고치라고 하기`}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
