//! CI 실행(GitHub Actions의 run, GitLab의 pipeline)을 웹에 가지 않고 본다.
//! PR에 걸린 CI는 PR 화면이 보여 준다. 여기는 머지 뒤의 배포나 손으로 돌린 것처럼 PR 없이 도는 실행까지 본다.
//! GitHub은 gh, GitLab은 glab api. 두 쪽을 같은 모양으로 돌려준다.
//! 상태(state): queued 대기, run 도는 중, ok 통과, fail 실패, cancel 취소, skip 건너뜀

use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::{github, gitlab};

fn s(v: &Value, p: &str) -> String {
    v.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_owned()
}

fn gh_state(status: &str, conclusion: &str) -> &'static str {
    match (status, conclusion) {
        ("completed", "success") => "ok",
        ("completed", "skipped") | ("completed", "neutral") => "skip",
        ("completed", "cancelled") => "cancel",
        ("completed", _) => "fail",
        ("in_progress", _) => "run",
        _ => "queued",
    }
}

fn gl_state(status: &str) -> &'static str {
    match status {
        "success" => "ok",
        "failed" => "fail",
        "canceled" | "canceling" => "cancel",
        "skipped" => "skip",
        "running" => "run",
        _ => "queued",
    }
}

/// gh에 로그인한 계정. 한 번 알아 두고 계속 쓴다
fn gh_login() -> String {
    static LOGIN: OnceLock<String> = OnceLock::new();
    LOGIN.get_or_init(|| github::run(&["api", "user", "--jq", ".login"]).map(|s| s.trim().to_owned()).unwrap_or_default()).clone()
}

/// 이 레포에서 내가 돌린 최근 실행들. 최근 것이 앞에 온다
#[tauri::command(async)]
pub fn ci_runs(repo: String) -> Result<Vec<Value>, String> {
    if let Some(r) = github::gl(&repo) {
        let (host, path) = gitlab::split(r)?;
        let me = gitlab::me(host);
        let user = if me.is_empty() { String::new() } else { format!("&username={me}") };
        let list = gitlab::api(host, "GET", &format!("projects/{}/pipelines?per_page=15{user}", gitlab::enc(path)), &[])?;
        return Ok(list
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| {
                json!({
                    "repo": repo, "id": p["id"].as_u64().unwrap_or(0).to_string(), "title": s(p, "/ref"), "name": s(p, "/source"), "branch": s(p, "/ref"),
                    "state": gl_state(&s(p, "/status")), "started": s(p, "/created_at"), "at": s(p, "/updated_at"), "url": s(p, "/web_url"),
                })
            })
            .collect());
    }
    github::check_repo(&repo)?;
    let login = gh_login();
    let mut args = vec!["run", "list", "-R", repo.as_str(), "--limit", "15", "--json", "databaseId,displayTitle,workflowName,headBranch,event,status,conclusion,createdAt,updatedAt,url"];
    if !login.is_empty() {
        args.extend(["-u", login.as_str()]);
    }
    let list: Value = serde_json::from_str(&github::run(&args)?).map_err(|e| e.to_string())?;
    Ok(list
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            json!({
                "repo": repo, "id": r["databaseId"].as_u64().unwrap_or(0).to_string(), "title": s(r, "/displayTitle"), "name": s(r, "/workflowName"), "branch": s(r, "/headBranch"),
                "state": gh_state(&s(r, "/status"), &s(r, "/conclusion")), "started": s(r, "/createdAt"), "at": s(r, "/updatedAt"), "url": s(r, "/url"),
            })
        })
        .collect())
}

fn check_id(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.len() < 20 && id.chars().all(|c| c.is_ascii_digit()) { Ok(()) } else { Err("bad id".into()) }
}

/// 실행 하나의 job들: 이름, 상태, 시작과 끝. GitLab은 단계(stage)도 준다
#[tauri::command(async)]
pub fn ci_jobs(repo: String, id: String) -> Result<Vec<Value>, String> {
    check_id(&id)?;
    if let Some(r) = github::gl(&repo) {
        let (host, path) = gitlab::split(r)?;
        let list = gitlab::api(host, "GET", &format!("projects/{}/pipelines/{id}/jobs?per_page=100", gitlab::enc(path)), &[])?;
        let mut jobs: Vec<Value> = list
            .as_array()
            .into_iter()
            .flatten()
            .map(|j| json!({ "id": j["id"].as_u64().unwrap_or(0).to_string(), "name": s(j, "/name"), "stage": s(j, "/stage"), "state": gl_state(&s(j, "/status")), "started": s(j, "/started_at"), "finished": s(j, "/finished_at") }))
            .collect();
        // GitLab은 최근 job부터 준다. 돈 순서로 뒤집는다
        jobs.reverse();
        return Ok(jobs);
    }
    github::check_repo(&repo)?;
    let v: Value = serde_json::from_str(&github::run(&["run", "view", &id, "-R", &repo, "--json", "jobs"])?).map_err(|e| e.to_string())?;
    Ok(v["jobs"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|j| {
            // 실패한 단계의 이름을 같이 준다. 어디서 깨졌는지 로그를 열기 전에 보인다
            let step = j["steps"].as_array().into_iter().flatten().find(|st| s(st, "/conclusion") == "failure").map(|st| s(st, "/name")).unwrap_or_default();
            json!({ "id": j["databaseId"].as_u64().unwrap_or(0).to_string(), "name": s(j, "/name"), "stage": step, "state": gh_state(&s(j, "/status"), &s(j, "/conclusion")), "started": s(j, "/startedAt"), "finished": s(j, "/completedAt") })
        })
        .collect())
}

/// 터미널 색 코드와 줄 앞의 시각을 뗀다
fn clean(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // ESC [ ... 글자 하나로 끝나는 색 코드
            if chars.peek() == Some(&'[') {
                chars.next();
                for d in chars.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out
}

fn tail(text: &str, n: usize) -> String {
    let lines: Vec<String> = text.lines().map(clean).filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// 실패한 job의 로그 끝부분. GitHub은 실패한 단계의 로그만, GitLab은 job 로그의 끝을 준다
#[tauri::command(async)]
pub fn ci_log(repo: String, id: String, job: String) -> Result<String, String> {
    check_id(&id)?;
    check_id(&job)?;
    if let Some(r) = github::gl(&repo) {
        let (host, path) = gitlab::split(r)?;
        return Ok(tail(&gitlab::raw(host, &format!("projects/{}/jobs/{job}/trace", gitlab::enc(path)))?, 80));
    }
    github::check_repo(&repo)?;
    let text = github::run(&["run", "view", &id, "-R", &repo, "--job", &job, "--log-failed"])?;
    // 줄마다 "job 이름<탭>단계 이름<탭>시각 글"이다. 단계 이름과 글만 남긴다
    let lines: String = text
        .lines()
        .map(|l| {
            let mut cols = l.splitn(3, '\t');
            let (_, _, rest) = (cols.next(), cols.next(), cols.next().unwrap_or(l));
            rest.split_once(' ').filter(|(t, _)| t.ends_with('Z') && t.contains('T')).map_or(rest, |(_, body)| body).to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(tail(&lines, 80))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states() {
        assert_eq!(gh_state("completed", "success"), "ok");
        assert_eq!(gh_state("completed", "timed_out"), "fail");
        assert_eq!(gh_state("in_progress", ""), "run");
        assert_eq!(gh_state("queued", ""), "queued");
        assert_eq!(gl_state("running"), "run");
        assert_eq!(gl_state("manual"), "queued");
    }

    #[test]
    fn cleans_and_tails() {
        assert_eq!(clean("\u{1b}[31mFAILED\u{1b}[0m test\r"), "FAILED test");
        assert_eq!(tail("a\n\nb\nc", 2), "b\nc");
        assert!(check_id("123").is_ok() && check_id("1;rm").is_err() && check_id("").is_err());
    }
}
