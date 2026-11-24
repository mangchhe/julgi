import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArgoApp, ArgoDetail, argoId, argoMark, deployedRef, historyRows } from "./argo";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ago, config } from "./model";
import { tr } from "./i18n";

const when = (iso: string) => (iso ? ago(Date.parse(iso) / 1000) : "");
/** 상태 이름 → 색을 고르는 이름 */
export const argoTone = (a: { health: string; sync: string; phase?: string }) => (a.health === "Degraded" || a.health === "Missing" || a.phase === "Failed" || a.phase === "Error" ? "fail" : a.health === "Progressing" || a.phase === "Running" ? "run" : a.sync === "OutOfSync" ? "queued" : a.health === "Healthy" ? "ok" : "skip");

/**
 * Argo CD 앱 하나: 지금 상태, 배포된 것과 내 커밋이 거기 들어 있는지, 배포 이력, 리소스별 상태.
 * 읽기만 한다. 맞추는 중(Progressing)이면 몇 초마다 다시 읽는다
 */
export default function DeployView({ app }: { app: ArgoApp }) {
  const [detail, setDetail] = useState<ArgoDetail | string | undefined>(undefined);
  // 이 레포 폴더의 지금 커밋이 배포된 것 안에 들어 있는가. undefined 보는 중, null 판단 못 함
  const [reach, setReach] = useState<[boolean, string] | null | undefined>(undefined);
  useEffect(() => {
    let timer = 0;
    let gone = false;
    const read = () =>
      void invoke<ArgoDetail>("argo_app", { context: app.context, name: app.name }).then(
        (d) => {
          if (gone) return;
          setDetail({ ...d, repo: app.repo, cwd: app.cwd, how: app.how });
          if (d.health === "Progressing" || d.phase === "Running") timer = window.setTimeout(read, 8000);
        },
        (e) => !gone && setDetail(String(e)),
      );
    setDetail(undefined);
    read();
    return () => ((gone = true), clearTimeout(timer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argoId(app)]);
  const now = typeof detail === "object" ? detail : app;
  const shipped = deployedRef(now, config.argoTagCommit);
  useEffect(() => {
    setReach(undefined);
    if (!app.cwd || !shipped.refs.length) return setReach(null);
    void invoke<[boolean, string] | null>("argo_reach", { path: app.cwd, mine: "HEAD", deployed: shipped.refs }).then(setReach, () => setReach(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.cwd, shipped.refs.join(" ")]);
  // 이력: 배포마다의 이미지 태그와, 그 태그가 가리키는 이 레포의 커밋(줄마다 git에 물어 가린다)
  const rows = typeof detail === "object" ? historyRows(detail.history, app.repo, app.how, config.argoTagParam, config.argoTagCommit) : [];
  const [trail, setTrail] = useState<[string, number][]>([]);
  const [slug, setSlug] = useState("");
  const trailKey = rows.map((r) => r.refs.join(",")).join("|");
  useEffect(() => {
    setTrail([]);
    if (!app.cwd || !rows.some((r) => r.refs.length)) return;
    void invoke<[string, number][]>("argo_trail", { path: app.cwd, rows: rows.map((r) => r.refs) }).then(setTrail, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.cwd, trailKey]);
  useEffect(() => {
    setSlug("");
    if (app.cwd) void invoke<string | null>("repo_slug", { path: app.cwd }).then((v) => setSlug(v ?? ""), () => {});
  }, [app.cwd]);
  /** 앞 배포에서 이 배포까지의 변경을 웹의 비교 화면으로 연다. 원격을 모르면 커밋 하나를 연다 */
  const openRange = (from: string, to: string) => {
    if (!slug) return;
    const lab = slug.startsWith("gitlab:");
    const base = lab ? `https://${slug.slice(7)}` : `https://github.com/${slug}`;
    void openUrl(from ? `${base}${lab ? "/-" : ""}/compare/${from}...${to}` : `${base}${lab ? "/-" : ""}/commit/${to}`);
  };
  const login = typeof detail === "string" && detail.startsWith("LOGIN");
  const resources = typeof detail === "object" ? [...detail.resources].sort((a, b) => Number(b.health !== "Healthy" && b.health !== "") - Number(a.health !== "Healthy" && a.health !== "")) : [];
  return (
    <div className="ci dp">
      <div className="ci-head">
        <div>
          <b>{app.name}</b>
          <small>
            {[app.repo, now.env, now.cluster, now.namespace && now.namespace !== now.env ? now.namespace : "", now.project].filter(Boolean).join(" · ")}
          </small>
        </div>
        <span className={"ci-state s-" + argoTone(now)}>
          {argoMark(now)} {now.health || "?"}
        </span>
        <span className={"ci-state s-" + (now.sync === "Synced" ? "ok" : "queued")}>{now.sync || "?"}</span>
        {now.syncedAt && <small>{tr`마지막 sync ${when(now.syncedAt)}`}</small>}
      </div>
      <div className="ci-jobs">
        {login && <div className="rv-warn">{tr`Argo CD에 다시 로그인해야 한다. 터미널에서: argocd login ${app.context} --grpc-web --skip-test-tls (SSO면 --sso, 포트가 없으면 :443)`}</div>}
        {typeof detail === "string" && !login && <div className="side-none">{detail}</div>}
        {/* 내 커밋이 어디까지 갔나. 판단할 수 없으면 배포된 것만 보여 주고 단정하지 않는다 */}
        <div className="dp-ship">
          {shipped.tag ? (
            <>
              <span>
                {now.how === "source" ? tr`맞춰진 커밋` : tr`배포 이미지`} <b>{shipped.tag}</b>
              </span>
              {reach && <small>{tr`배포된 커밋 ${reach[1].slice(0, 8)}`}</small>}
              {reach?.[0] === true && <em className="ok">{tr`이 폴더의 지금 커밋이 여기 들어 있다 (배포됨)`}</em>}
              {reach?.[0] === false && <em className="wait">{tr`이 폴더의 지금 커밋은 아직 들어 있지 않다`}</em>}
              {reach === null && <small>{tr`이 레포에서 그 커밋을 찾지 못해, 내 커밋이 들어 있는지는 알 수 없다`}</small>}
            </>
          ) : (
            <small>{tr`배포된 이미지의 태그를 알 수 없다`}</small>
          )}
          <small>{now.how === "source" ? tr`앱의 소스가 이 레포라서 이었다` : now.how === "image" ? tr`배포된 이미지 이름에 레포 이름이 있어서 이었다` : now.how === "rule" ? tr`설정에 적은 규칙으로 이었다` : ""}</small>
        </div>
        {now.message && argoTone(now) === "fail" && <pre className="dp-msg">{now.message}</pre>}
        {detail === undefined && (
          <div className="ci-bones" aria-label={tr`읽는 중`}>
            <i />
            <i />
          </div>
        )}
        {typeof detail === "object" && (
          <div className="dp-cols">
            <div>
              <div className="rv-hist-head">{tr`배포 이력`}</div>
              {rows.length === 0 && <div className="side-none">{tr`이력이 없다`}</div>}
              {rows.map((h, i) => {
                const [commit, count] = trail[i] ?? ["", -1];
                // 앞 배포의 커밋: 이 줄보다 오래된 줄 가운데 커밋이 풀린 첫 줄
                const before = trail.slice(i + 1).find(([c]) => c)?.[0] ?? "";
                return (
                  <div key={h.id} className={"dp-hist" + (i === 0 ? " now" : "") + (h.same ? " same" : "")}>
                    <div>
                      {/* 이미지 태그가 있으면 그것, 없으면(설정 파일에 이미지가 든 앱) revision */}
                      <code>{h.tag || h.revision.slice(0, 8) || "?"}</code>
                      <small>{when(h.at)}</small>
                    </div>
                    <div className="dp-hist-sub">
                      {commit && (
                        <button type="button" tabIndex={-1} disabled={!slug} title={before && before !== commit ? `${before.slice(0, 8)}..${commit.slice(0, 8)}` : commit} onClick={() => openRange(before !== commit ? before : "", commit)}>
                          {tr`커밋 ${commit.slice(0, 8)}`}
                          {count > 0 && ` · ${tr`앞 배포 뒤 ${count}개`}`}
                        </button>
                      )}
                      {h.tag && h.moved && <span>{tr`차트·설정 변경 ${h.revision.slice(0, 8)}`}</span>}
                      {h.same && <span>{tr`다시 sync`}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <div className="rv-hist-head">{tr`리소스 ${resources.length}`}</div>
              {resources.map((r) => (
                <div key={`${r.kind}/${r.namespace}/${r.name}`} className="dp-row" title={r.message}>
                  <i className={"ci-dot s-" + argoTone({ health: r.health || "Healthy", sync: r.sync })} aria-hidden="true" />
                  <span>
                    {r.kind} <b>{r.name}</b>
                  </span>
                  <small>{[r.health, r.sync !== "Synced" ? r.sync : ""].filter(Boolean).join(" · ")}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
