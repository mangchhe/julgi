//! Argo CD의 배포 상태를 읽는다. 공식 argocd CLI를 부른다 (gh, glab과 같은 방식).
//! 로그인은 사용자가 `argocd login <서버>`로 미리 한다. 토큰과 서버는 argocd가 갖고 있고, Julgi는 설정 파일을 읽지 않는다.
//! 읽기만 한다. sync, rollback, 삭제는 부르지 않는다.
//! 어느 Argo CD에서나 같게 돈다: 환경 이름이나 앱 이름 규칙을 여기서 정하지 않는다.

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::{json, Value};

use crate::lang::say;

fn bin() -> Option<&'static str> {
    if let Some(p) = ["/opt/homebrew/bin/argocd", "/usr/local/bin/argocd"].into_iter().find(|p| Path::new(p).exists()) {
        return Some(p);
    }
    Command::new("argocd").arg("version").arg("--client").arg("--short").stdout(Stdio::null()).stderr(Stdio::null()).status().ok().map(|_| "argocd")
}

/// argocd를 돌리고 표준 출력을 받는다. 서버에 닿지 못하면(VPN이 꺼져 있을 때 등) 한없이 기다리지 않게 시간을 정해 끊는다.
/// 로그인이 풀렸으면 "LOGIN"으로 시작하는 까닭을 돌려준다. 화면이 그걸 보고 다시 로그인하라고 안내한다
fn run(args: &[&str], secs: u64) -> Result<String, String> {
    let bin = bin().ok_or_else(|| say("argocd가 없다. brew install argocd", "argocd is not installed. brew install argocd"))?;
    let mut child = Command::new(bin).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    // 출력이 크면 파이프가 차서 멈춘다. 따로 읽으면서 기다린다
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = out.read_to_string(&mut text);
        text
    });
    let errs = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = err.read_to_string(&mut text);
        text
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() > Duration::from_secs(secs) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(say("Argo CD가 답하지 않는다 (서버에 닿지 못했다)", "Argo CD did not answer (could not reach the server)"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(60)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let text = reader.join().unwrap_or_default();
    let why = errs.join().unwrap_or_default();
    if status.success() {
        return Ok(text);
    }
    Err(if needs_login(&why) { format!("LOGIN {}", why.trim().lines().last().unwrap_or("")) } else { why.trim().lines().last().unwrap_or("argocd failed").to_owned() })
}

/// 오류 글이 "로그인이 풀렸다"는 뜻인가
fn needs_login(text: &str) -> bool {
    let t = text.to_lowercase();
    ["unauthenticated", "token is expired", "token has expired", "invalid session", "not logged in", "please login", "argocd login", "no session information"].iter().any(|w| t.contains(w))
}

fn ok_name(s: &str) -> bool {
    !s.is_empty() && s.len() < 200 && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-:/".contains(c)) && !s.starts_with('-')
}

fn s(v: &Value, p: &str) -> String {
    v.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_owned()
}

/// `argocd context`가 찍는 표에서 이름과 서버를 뽑는다. 맨 앞의 *는 지금 고른 것이다
fn contexts_of(table: &str) -> Vec<Value> {
    table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let current = line.trim_start().starts_with('*');
            let mut cols = line.trim_start().trim_start_matches('*').split_whitespace();
            let name = cols.next()?;
            Some(json!({ "name": name, "server": cols.next().unwrap_or(""), "current": current }))
        })
        .collect()
}

/// argocd가 깔려 있는가, 로그인해 둔 서버(context)들은 무엇인가
#[tauri::command(async)]
pub fn argo_status() -> Value {
    if bin().is_none() {
        return json!({ "installed": false, "contexts": [] });
    }
    let contexts = run(&["context"], 6).map(|t| contexts_of(&t)).unwrap_or_default();
    json!({ "installed": true, "contexts": contexts })
}

/// 그 서버에서 로그아웃한다. argocd가 갖고 있던 그 서버의 토큰을 지운다 (이 맥의 설정만 바뀐다)
#[tauri::command(async)]
pub fn argo_logout(context: String) -> Result<(), String> {
    if !ok_name(&context) {
        return Err("bad context".into());
    }
    run(&["logout", &context], 10).map(|_| ())
}

/// 앱이 어느 환경의 것인가. 정해 둔 이름은 없다: 라벨(env, environment, stage)이 있으면 그것, 없으면 네임스페이스, 그것도 없으면 클러스터 이름
fn env_of(app: &Value) -> String {
    for key in ["env", "environment", "stage", "app.kubernetes.io/environment"] {
        if let Some(v) = app["metadata"]["labels"][key].as_str().filter(|v| !v.is_empty()) {
            return v.to_owned();
        }
    }
    let ns = s(app, "/spec/destination/namespace");
    if !ns.is_empty() {
        return ns;
    }
    let name = s(app, "/spec/destination/name");
    if !name.is_empty() { name } else { s(app, "/spec/destination/server") }
}

/// 목록의 한 줄: 화면이 쓰는 것만 추린다
fn row(context: &str, app: &Value) -> Value {
    // 소스는 하나(source)일 수도 여럿(sources)일 수도 있다
    let sources: Vec<&Value> = app["spec"]["sources"].as_array().map(|a| a.iter().collect()).unwrap_or_else(|| if app["spec"]["source"].is_object() { vec![&app["spec"]["source"]] } else { vec![] });
    let op = &app["status"]["operationState"];
    let or = |a: String, b: String| if a.is_empty() { b } else { a };
    let cluster = or(s(app, "/spec/destination/name"), s(app, "/spec/destination/server"));
    // 지금 맞춰진 커밋. 소스가 여럿이면 revisions의 첫째
    let revision = or(s(app, "/status/sync/revision"), s(app, "/status/sync/revisions/0"));
    let synced = or(s(op, "/finishedAt"), s(op, "/startedAt"));
    json!({
        "context": context,
        "name": s(app, "/metadata/name"),
        "project": s(app, "/spec/project"),
        "sync": s(app, "/status/sync/status"),
        "health": s(app, "/status/health/status"),
        "env": env_of(app),
        "namespace": s(app, "/spec/destination/namespace"),
        "cluster": cluster,
        "repos": sources.iter().map(|x| s(x, "/repoURL")).filter(|u| !u.is_empty()).collect::<Vec<_>>(),
        "path": sources.first().map(|x| s(x, "/path")).unwrap_or_default(),
        "target": sources.first().map(|x| s(x, "/targetRevision")).unwrap_or_default(),
        "revision": revision,
        "images": app["status"]["summary"]["images"].as_array().cloned().unwrap_or_default(),
        "labels": app["metadata"]["labels"].as_object().cloned().unwrap_or_default(),
        "syncedAt": synced,
        "phase": s(op, "/phase"),
        "message": s(op, "/message").chars().take(240).collect::<String>(),
    })
}

/// 그 서버의 앱 전부. 로그인이 풀렸으면 "LOGIN …"으로 시작하는 오류가 난다
#[tauri::command(async)]
pub fn argo_apps(context: String) -> Result<Vec<Value>, String> {
    if !ok_name(&context) {
        return Err("bad context".into());
    }
    let text = run(&["app", "list", "-o", "json", "--argocd-context", &context], 25)?;
    let list: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(list.as_array().into_iter().flatten().map(|app| row(&context, app)).collect())
}

/// 앱 하나: 목록의 줄에 배포 이력과 리소스별 상태를 더한다
#[tauri::command(async)]
pub fn argo_app(context: String, name: String) -> Result<Value, String> {
    if !ok_name(&context) || !ok_name(&name) {
        return Err("bad name".into());
    }
    let text = run(&["app", "get", &name, "-o", "json", "--argocd-context", &context], 25)?;
    let app: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut out = row(&context, &app);
    // 이력은 오래된 것부터 온다. 최근 것이 위로 오게 뒤집고 스무 개까지
    let mut history: Vec<Value> = app["status"]["history"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|h| {
            let revision = s(h, "/revision");
            // 그 배포의 소스. 이미지 태그를 앱 파라미터로 넣는 구조에서는 revision이 배포마다 같고, 달라지는 것은 여기에 적힌 이미지다
            let sources: Vec<Value> = h["sources"].as_array().cloned().unwrap_or_else(|| if h["source"].is_object() { vec![h["source"].clone()] } else { vec![] });
            json!({ "id": h["id"].as_i64().unwrap_or(0), "revision": if revision.is_empty() { s(h, "/revisions/0") } else { revision }, "at": s(h, "/deployedAt"), "sources": sources })
        })
        .collect();
    history.reverse();
    history.truncate(20);
    let resources: Vec<Value> = app["status"]["resources"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| json!({ "kind": s(r, "/kind"), "name": s(r, "/name"), "namespace": s(r, "/namespace"), "sync": s(r, "/status"), "health": s(r, "/health/status"), "message": s(r, "/health/message").chars().take(200).collect::<String>() }))
        .collect();
    out["history"] = json!(history);
    out["resources"] = json!(resources);
    Ok(out)
}

/// 배포 이력의 줄마다, 그 줄의 후보들 가운데 이 레포의 커밋으로 풀리는 것을 찾는다. 줄은 최근 것부터 온다.
/// 돌려주는 것: 줄마다 (그 배포의 커밋, 바로 앞 배포에서 이 배포까지 쌓인 커밋 수). 커밋을 못 찾은 줄은 빈 글과 -1
#[tauri::command(async)]
pub fn argo_trail(path: String, rows: Vec<Vec<String>>) -> Vec<(String, i64)> {
    let ok = |r: &str| !r.is_empty() && r.len() < 120 && !r.starts_with('-') && r.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c));
    let resolve = |rev: &str| -> Option<String> {
        let out = Command::new("git").args(["-C", &path, "rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
    };
    let commits: Vec<String> = rows.iter().take(40).map(|refs| refs.iter().filter(|r| ok(r)).take(8).find_map(|r| resolve(r).or_else(|| resolve(&format!("v{r}")))).unwrap_or_default()).collect();
    commits
        .iter()
        .enumerate()
        .map(|(i, commit)| {
            // 바로 앞 배포: 이 줄보다 아래(더 오래된) 줄 가운데 커밋이 풀린 첫 줄
            let before = commits[i + 1..].iter().find(|c| !c.is_empty());
            let count = match (commit.is_empty(), before) {
                (false, Some(prev)) if prev != commit => Command::new("git")
                    .args(["-C", &path, "rev-list", "--count", &format!("{prev}..{commit}")])
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<i64>().ok())
                    .unwrap_or(-1),
                (false, Some(_)) => 0,
                _ => -1,
            };
            (commit.clone(), count)
        })
        .collect()
}

/// 내 커밋(mine)이 배포된 것 안에 들어 있는가. deployed: 배포된 커밋일 수 있는 후보들(커밋 앞자리, 태그 이름).
/// 배포된 것을 이 레포에서 찾지 못하면(다른 레포의 커밋이거나, 태그가 커밋을 가리키지 않는 이름이면) 판단하지 않는다(None).
/// 찾았으면 (내 커밋이 들어 있는가, 배포된 커밋)을 돌려준다
#[tauri::command(async)]
pub fn argo_reach(path: String, mine: String, deployed: Vec<String>) -> Option<(bool, String)> {
    let ok = |r: &str| !r.is_empty() && r.len() < 120 && !r.starts_with('-') && r.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c));
    if !ok(&mine) {
        return None;
    }
    let resolve = |rev: &str| -> Option<String> {
        let out = Command::new("git").args(["-C", &path, "rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
    };
    let mine = resolve(&mine)?;
    // 후보를 앞에서부터 물어본다. 태그의 형식은 모른다: 실제 커밋으로 풀리는 첫 후보가 배포된 커밋이다.
    // 후보가 태그 이름이면 그대로, 또는 v를 붙여서도 찾아본다 ("1.2.3" ↔ "v1.2.3")
    let deployed = deployed.iter().filter(|r| ok(r)).take(8).find_map(|r| resolve(r).or_else(|| resolve(&format!("v{r}"))))?;
    let within = Command::new("git").args(["-C", &path, "merge-base", "--is-ancestor", &mine, &deployed]).status().is_ok_and(|s| s.success());
    Some((within, deployed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_context_table() {
        let table = "CURRENT  NAME                 SERVER\n*        argocd.example.com   argocd.example.com\n         staging              argo.staging.example.com:443\n";
        let list = contexts_of(table);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["name"], "argocd.example.com");
        assert_eq!(list[0]["current"], true);
        assert_eq!(list[1]["name"], "staging");
        assert_eq!(list[1]["server"], "argo.staging.example.com:443");
        assert_eq!(list[1]["current"], false);
    }

    #[test]
    fn tells_a_lost_login_from_other_errors() {
        assert!(needs_login("FATA[0000] rpc error: code = Unauthenticated desc = invalid session: token is expired"));
        assert!(needs_login("Argo CD server address unspecified. Please login using 'argocd login'"));
        assert!(!needs_login("FATA[0000] rpc error: code = PermissionDenied desc = permission denied"));
        assert!(!needs_login("dial tcp: lookup argocd.example.com: no such host"));
    }

    #[test]
    fn makes_a_row_from_an_application() {
        let app = json!({
            "metadata": { "name": "acme-api-staging", "labels": { "environment": "staging" } },
            "spec": { "project": "default", "destination": { "name": "in-cluster", "namespace": "acme" }, "source": { "repoURL": "https://github.com/example/acme-gitops.git", "path": "apps/acme-api/staging", "targetRevision": "main" } },
            "status": { "sync": { "status": "Synced", "revision": "0123456789abcdef" }, "health": { "status": "Healthy" }, "summary": { "images": ["registry.example.com/acme/acme-api:1a2b3c4"] }, "operationState": { "phase": "Succeeded", "finishedAt": "2026-01-02T03:04:05Z" } }
        });
        let r = row("ctx", &app);
        assert_eq!(r["name"], "acme-api-staging");
        assert_eq!(r["env"], "staging");
        assert_eq!(r["sync"], "Synced");
        assert_eq!(r["health"], "Healthy");
        assert_eq!(r["repos"][0], "https://github.com/example/acme-gitops.git");
        assert_eq!(r["images"][0], "registry.example.com/acme/acme-api:1a2b3c4");
        assert_eq!(r["syncedAt"], "2026-01-02T03:04:05Z");
        // 라벨이 없으면 네임스페이스, 그것도 없으면 클러스터 이름
        let bare = json!({ "spec": { "destination": { "name": "prod-cluster", "namespace": "shop" } } });
        assert_eq!(env_of(&bare), "shop");
        assert_eq!(env_of(&json!({ "spec": { "destination": { "name": "prod-cluster" } } })), "prod-cluster");
        // 소스가 여럿인 앱
        let multi = json!({ "spec": { "sources": [{ "repoURL": "a" }, { "repoURL": "b" }] }, "status": { "sync": { "revisions": ["r1", "r2"] } } });
        assert_eq!(row("c", &multi)["repos"], json!(["a", "b"]));
        assert_eq!(row("c", &multi)["revision"], "r1");
    }

    /// 태그의 형식을 모른 채로: 후보들 가운데 실제 커밋으로 풀리는 것을 찾아, 내 커밋이 그 안에 드는지 본다
    #[test]
    fn finds_the_deployed_commit_among_candidates() {
        let dir = std::env::temp_dir().join(format!("julgi-argo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let out = Command::new("git").current_dir(&dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_owned()
        };
        git(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("f"), "a").unwrap();
        git(&["add", "f"]);
        git(&["commit", "-qm", "first"]);
        let first = git(&["rev-parse", "HEAD"]);
        git(&["tag", "v1.0.0"]);
        std::fs::write(dir.join("f"), "b").unwrap();
        git(&["commit", "-qam", "second"]);
        let second = git(&["rev-parse", "HEAD"]);
        let path = dir.to_string_lossy().into_owned();
        let short = |sha: &str| sha[..8].to_owned();
        // 날짜처럼 생긴 후보는 커밋이 아니라 넘어가고, 그다음 후보(커밋 앞자리)가 맞는다. 둘째 커밋이 배포됐으니 지금 커밋(HEAD)이 들어 있다
        assert_eq!(argo_reach(path.clone(), "HEAD".into(), vec!["20260101".into(), short(&second)]), Some((true, second.clone())));
        // 첫 커밋이 배포돼 있으면 지금 커밋은 아직 안 들어 있다
        assert_eq!(argo_reach(path.clone(), "HEAD".into(), vec![short(&first)]), Some((false, first.clone())));
        // 태그 이름도 후보다. v가 빠진 이름도 찾아 준다
        assert_eq!(argo_reach(path.clone(), "HEAD".into(), vec!["1.0.0".into()]), Some((false, first.clone())));
        // 풀리는 후보가 없으면 판단하지 않는다
        assert_eq!(argo_reach(path.clone(), "HEAD".into(), vec!["20260101".into(), "release-7".into()]), None);
        assert_eq!(argo_reach(path, "HEAD".into(), vec![]), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 이력의 줄마다 커밋을 찾고, 앞 배포에서 이 배포까지 커밋이 몇 개 쌓였는지 센다. 커밋을 못 찾은 줄은 건너뛰어 그다음 줄과 견준다
    #[test]
    fn walks_the_deploy_history() {
        let dir = std::env::temp_dir().join(format!("julgi-trail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let out = Command::new("git").current_dir(&dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_owned()
        };
        git(&["init", "-q", "-b", "main"]);
        let mut shas = Vec::new();
        for n in 0..4 {
            std::fs::write(dir.join("f"), format!("{n}")).unwrap();
            git(&["add", "f"]);
            git(&["commit", "-qm", &format!("c{n}")]);
            shas.push(git(&["rev-parse", "HEAD"]));
        }
        let short = |i: usize| shas[i][..8].to_owned();
        // 최근 것부터: 넷째 커밋, (커밋이 아닌 태그), 둘째 커밋, 둘째 커밋(다시 sync), 첫 커밋
        let rows = vec![vec!["20260105".into(), short(3)], vec!["release-7".into()], vec![short(1)], vec![short(1)], vec![short(0)]];
        let got = argo_trail(dir.to_string_lossy().into_owned(), rows);
        assert_eq!(got[0], (shas[3].clone(), 2), "둘째 커밋에서 넷째 커밋까지 둘");
        assert_eq!(got[1], (String::new(), -1), "커밋이 아닌 태그는 판단하지 않는다");
        assert_eq!(got[2], (shas[1].clone(), 0), "앞 배포와 같은 커밋이면 0");
        assert_eq!(got[3], (shas[1].clone(), 1), "첫 커밋에서 둘째 커밋까지 하나");
        assert_eq!(got[4], (shas[0].clone(), -1), "가장 오래된 줄은 견줄 앞 배포가 없다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_odd_names() {
        assert!(ok_name("acme-api-staging") && ok_name("argocd.example.com:443"));
        assert!(!ok_name("--server") && !ok_name("a b") && !ok_name("") && !ok_name("x;y"));
    }
}
