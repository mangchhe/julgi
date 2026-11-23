//! GitLab의 MR을 GitHub PR과 같은 모양으로 들여온다. glab(GitLab CLI)의 `glab api`로 REST를 부른다.
//! 로그인과 토큰은 glab이 갖고 있다. 화면은 GitHub인지 GitLab인지 모르고 같은 모양만 받는다.
//! 레포는 "호스트/그룹/.../프로젝트"로 받는다(github.rs가 "gitlab:" 꼬리표를 떼고 넘긴다).

use crate::lang::say;
use std::{path::Path, process::Command};

use serde_json::{json, Value};

fn glab_bin() -> &'static str {
    ["/opt/homebrew/bin/glab", "/usr/local/bin/glab"].into_iter().find(|p| Path::new(p).exists()).unwrap_or("glab")
}

/// "gitlab.com/group/sub/proj" → ("gitlab.com", "group/sub/proj"). 모양이 이상하면 거절한다
pub fn split(repo: &str) -> Result<(&str, &str), String> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let (host, path) = repo.split_once('/').ok_or_else(|| say(&format!("GitLab 프로젝트 이름이 이상하다: {repo}"), &format!("Invalid GitLab project name: {repo}")))?;
    if ok(host) && host.contains('.') && path.split('/').count() >= 2 && path.split('/').all(ok) {
        Ok((host, path))
    } else {
        Err(say(&format!("GitLab 프로젝트 이름이 이상하다: {repo}"), &format!("Invalid GitLab project name: {repo}")))
    }
}

/// glab api. fields는 문자열 필드(-f)다
/// glab api의 답을 글 그대로 받는다 (job 로그처럼 JSON이 아닌 것)
pub(crate) fn raw(host: &str, endpoint: &str) -> Result<String, String> {
    let mut cmd = Command::new(glab_bin());
    cmd.arg("api");
    if !host.is_empty() {
        cmd.args(["--hostname", host]);
    }
    let out = cmd.arg(endpoint).env("NO_COLOR", "1").env("GLAB_NO_PROMPT", "1").output().map_err(|_| say("glab이 없다. brew install glab", "glab is not installed. brew install glab"))?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_owned()) }
}

pub(crate) fn api(host: &str, method: &str, endpoint: &str, fields: &[(&str, String)]) -> Result<Value, String> {
    let mut cmd = Command::new(glab_bin());
    cmd.arg("api");
    // 호스트를 비우면 glab에 로그인한 기본 호스트로 간다(회사 GitLab만 쓰는 경우)
    if !host.is_empty() {
        cmd.args(["--hostname", host]);
    }
    cmd.args(["--method", method, endpoint]).env("NO_COLOR", "1").env("GLAB_NO_PROMPT", "1");
    for (k, v) in fields {
        cmd.arg("-f").arg(format!("{k}={v}"));
    }
    let out = cmd.output().map_err(|_| say("glab이 없다. brew install glab", "glab is not installed. brew install glab"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub(crate) fn enc(path: &str) -> String {
    path.replace('/', "%2F")
}

fn mr_path(path: &str, iid: u64) -> String {
    format!("projects/{}/merge_requests/{iid}", enc(path))
}

/// glab이 깔려 있나, 로그인한 계정 (glab의 기본 호스트)
pub fn status() -> (bool, String) {
    if Command::new(glab_bin()).arg("--version").output().is_err() {
        return (false, String::new());
    }
    let user = api("", "GET", "user", &[]).ok().and_then(|u| u["username"].as_str().map(str::to_owned)).unwrap_or_default();
    (true, user)
}

pub(crate) fn me(host: &str) -> String {
    api(host, "GET", "user", &[]).ok().and_then(|u| u["username"].as_str().map(str::to_owned)).unwrap_or_default()
}

fn text(v: &Value, p: &str) -> String {
    v.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_owned()
}

/// GitLab 상태 → GitHub 상태 이름
fn state_of(s: &str) -> &'static str {
    match s {
        "merged" => "MERGED",
        "closed" | "locked" => "CLOSED",
        _ => "OPEN",
    }
}

/// 파이프라인 상태 → GitHub CheckRun 하나 (화면의 CI 세기가 그대로 먹게)
fn check_of(pipeline: &Value) -> Vec<Value> {
    let Some(st) = pipeline["status"].as_str() else { return vec![] };
    let (status, conclusion) = match st {
        "success" => ("COMPLETED", "SUCCESS"),
        "failed" => ("COMPLETED", "FAILURE"),
        "canceled" | "canceling" => ("COMPLETED", "CANCELLED"),
        "skipped" | "manual" => ("COMPLETED", "SKIPPED"),
        _ => ("IN_PROGRESS", ""),
    };
    vec![json!({ "__typename": "CheckRun", "name": "pipeline", "status": status, "conclusion": conclusion })]
}

/// 파일 diff 목록(/diffs)을 git diff 글 하나로 잇는다. 화면의 diff 파서가 그대로 읽는다
fn diff_text(files: &Value) -> String {
    let mut out = String::new();
    for f in files.as_array().into_iter().flatten() {
        let (old, new) = (text(f, "/old_path"), text(f, "/new_path"));
        out.push_str(&format!("diff --git a/{old} b/{new}\n"));
        if f["new_file"] == true {
            out.push_str("new file mode 100644\n");
        }
        if f["deleted_file"] == true {
            out.push_str("deleted file mode 100644\n");
        }
        if f["renamed_file"] == true {
            out.push_str(&format!("rename from {old}\nrename to {new}\n"));
        }
        out.push_str(&format!("--- a/{old}\n+++ b/{new}\n"));
        let body = text(f, "/diff");
        out.push_str(&body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    out
}

/// 토론(discussions)을 줄 코멘트(GitHub REST 모양)와 일반 코멘트로 나눈다.
/// 줄 코멘트의 첫 노트 id는 토론 id(문자열)로 둔다 — 답글을 달 때 토론 id가 필요하다
fn split_discussions(list: &Value) -> (Vec<Value>, Vec<Value>) {
    let (mut lines, mut general) = (Vec::new(), Vec::new());
    for d in list.as_array().into_iter().flatten() {
        let did = text(d, "/id");
        let notes: Vec<&Value> = d["notes"].as_array().into_iter().flatten().filter(|n| n["system"] != true).collect();
        let Some(first) = notes.first() else { continue };
        let pos = &first["position"];
        if pos.is_object() && (pos["new_line"].is_number() || pos["old_line"].is_number()) {
            let (line, side) = if pos["new_line"].is_number() { (pos["new_line"].clone(), "RIGHT") } else { (pos["old_line"].clone(), "LEFT") };
            let path = if side == "RIGHT" { text(pos, "/new_path") } else { text(pos, "/old_path") };
            for (i, n) in notes.iter().enumerate() {
                lines.push(json!({
                    "id": if i == 0 { json!(did) } else { n["id"].clone() },
                    "path": path,
                    "line": line,
                    "side": side,
                    "in_reply_to_id": if i == 0 { Value::Null } else { json!(did) },
                    "user": { "login": text(n, "/author/username") },
                    "body": text(n, "/body"),
                    "created_at": text(n, "/created_at"),
                }));
            }
        } else {
            for n in notes {
                general.push(json!({ "author": { "login": text(n, "/author/username") }, "body": text(n, "/body"), "createdAt": text(n, "/created_at") }));
            }
        }
    }
    (lines, general)
}

/// MR 한 건을 GitHub `gh pr view --json` 모양으로
pub fn view(repo: &str, iid: u64) -> Result<String, String> {
    let (host, path) = split(repo)?;
    let mr = api(host, "GET", &mr_path(path, iid), &[])?;
    let diffs = api(host, "GET", &format!("{}/diffs?per_page=100", mr_path(path, iid)), &[]).unwrap_or(Value::Null);
    let approvals = api(host, "GET", &format!("{}/approvals", mr_path(path, iid)), &[]).unwrap_or(Value::Null);
    let discussions = api(host, "GET", &format!("{}/discussions?per_page=100", mr_path(path, iid)), &[]).unwrap_or(Value::Null);
    Ok(view_of(&mr, &diffs, &approvals, &discussions).to_string())
}

fn view_of(mr: &Value, diffs: &Value, approvals: &Value, discussions: &Value) -> Value {
    let (adds, dels) = diff_text(diffs).lines().fold((0, 0), |(a, d), l| {
        if l.starts_with('+') && !l.starts_with("+++") {
            (a + 1, d)
        } else if l.starts_with('-') && !l.starts_with("---") {
            (a, d + 1)
        } else {
            (a, d)
        }
    });
    let (_, general) = split_discussions(discussions);
    let reviews: Vec<Value> = approvals["approved_by"].as_array().into_iter().flatten().map(|a| json!({ "author": { "login": text(a, "/user/username") }, "body": "", "submittedAt": "", "state": "APPROVED" })).collect();
    let conflict = mr["has_conflicts"] == true || text(mr, "/detailed_merge_status") == "conflict";
    json!({
        "number": mr["iid"],
        "title": text(mr, "/title"),
        "body": text(mr, "/description"),
        "author": { "login": text(mr, "/author/username") },
        "state": state_of(mr["state"].as_str().unwrap_or("")),
        "isDraft": mr["draft"] == true || mr["work_in_progress"] == true,
        "baseRefName": text(mr, "/target_branch"),
        "headRefName": text(mr, "/source_branch"),
        "headRefOid": text(mr, "/sha"),
        "url": text(mr, "/web_url"),
        "reviewDecision": if approvals["approved"] == true { "APPROVED" } else { "REVIEW_REQUIRED" },
        "statusCheckRollup": check_of(&mr["head_pipeline"]),
        "additions": adds,
        "deletions": dels,
        "changedFiles": diffs.as_array().map_or(0, |a| a.len()),
        "comments": general,
        "reviews": reviews,
        "mergeable": if conflict { "CONFLICTING" } else { "MERGEABLE" },
        "createdAt": text(mr, "/created_at"),
    })
}

pub fn diff(repo: &str, iid: u64) -> Result<String, String> {
    let (host, path) = split(repo)?;
    Ok(diff_text(&api(host, "GET", &format!("{}/diffs?per_page=100", mr_path(path, iid)), &[])?))
}

pub fn comments(repo: &str, iid: u64) -> Result<String, String> {
    let (host, path) = split(repo)?;
    let list = api(host, "GET", &format!("{}/discussions?per_page=100", mr_path(path, iid)), &[])?;
    Ok(Value::from(split_discussions(&list).0).to_string())
}

/// 세션 줄·알림용 형편 (github::PrStatus와 같은 필드)
pub fn status_of_mr(repo: &str, iid: u64) -> Result<(String, String, String, u32, String), String> {
    let (host, path) = split(repo)?;
    let me = me(host);
    let mr = api(host, "GET", &mr_path(path, iid), &[])?;
    let approvals = api(host, "GET", &format!("{}/approvals", mr_path(path, iid)), &[]).unwrap_or(Value::Null);
    let discussions = api(host, "GET", &format!("{}/discussions?per_page=100", mr_path(path, iid)), &[]).unwrap_or(Value::Null);
    let others = discussions.as_array().into_iter().flatten().flat_map(|d| d["notes"].as_array().into_iter().flatten()).filter(|n| n["system"] != true && text(n, "/author/username") != me).count() as u32;
    let ci = check_of(&mr["head_pipeline"]).first().map_or(String::new(), |c| match (c["status"].as_str(), c["conclusion"].as_str()) {
        (Some("COMPLETED"), Some("SUCCESS")) => "SUCCESS".into(),
        (Some("COMPLETED"), Some("FAILURE")) => "FAILURE".into(),
        (Some("IN_PROGRESS"), _) => "PENDING".into(),
        _ => String::new(),
    });
    let state = state_of(mr["state"].as_str().unwrap_or("")).to_owned();
    let closer = text(&mr, "/closed_by/username");
    let actor = if state == "CLOSED" && !closer.is_empty() && closer != me { closer } else { String::new() };
    let decision = if approvals["approved"] == true { "APPROVED" } else { "REVIEW_REQUIRED" }.to_owned();
    Ok((state, ci, decision, others, actor))
}

/// MR 목록 하나를 GitHub `gh search prs` 모양으로. 프로젝트 이름은 web_url에서 뽑아 "gitlab:호스트/경로"로 둔다
fn search_item(mr: &Value) -> Option<Value> {
    let url = mr["web_url"].as_str()?;
    let rest = url.split_once("://")?.1;
    let (proj, _) = rest.split_once("/-/merge_requests/")?;
    Some(json!({
        "number": mr["iid"],
        "title": text(mr, "/title"),
        "repository": { "nameWithOwner": format!("gitlab:{proj}") },
        "author": { "login": text(mr, "/author/username") },
        "updatedAt": text(mr, "/updated_at"),
        "url": url,
        "isDraft": mr["draft"] == true,
    }))
}

/// 내가 연 열린 MR (glab의 기본 호스트)
pub fn mine() -> Vec<Value> {
    api("", "GET", "merge_requests?scope=created_by_me&state=opened&per_page=50", &[]).ok().and_then(|v| v.as_array().map(|a| a.iter().filter_map(search_item).collect())).unwrap_or_default()
}

/// 나를 리뷰어로 지정한 열린 MR (glab의 기본 호스트)
pub fn review_requests() -> Vec<Value> {
    let me = me("");
    if me.is_empty() {
        return vec![];
    }
    api("", "GET", &format!("merge_requests?scope=all&state=opened&reviewer_username={me}&per_page=50"), &[]).ok().and_then(|v| v.as_array().map(|a| a.iter().filter_map(search_item).collect())).unwrap_or_default()
}

/// 한 프로젝트의 열린 MR (⌘K에서 pr을 쳤을 때) — gh pr list 모양
pub fn list(repo: &str) -> Result<String, String> {
    let (host, path) = split(repo)?;
    let v = api(host, "GET", &format!("projects/{}/merge_requests?state=opened&per_page=50", enc(path)), &[])?;
    let rows: Vec<Value> = v.as_array().into_iter().flatten().map(|m| json!({ "number": m["iid"], "title": text(m, "/title"), "author": { "login": text(m, "/author/username") }, "headRefName": text(m, "/source_branch"), "isDraft": m["draft"] == true, "updatedAt": text(m, "/updated_at") })).collect();
    Ok(Value::from(rows).to_string())
}

// ── 쓰기 ──

pub fn comment(repo: &str, iid: u64, body: &str) -> Result<(), String> {
    let (host, path) = split(repo)?;
    api(host, "POST", &format!("{}/notes", mr_path(path, iid)), &[("body", body.to_owned())]).map(|_| ())
}

/// 줄 코멘트. GitLab은 diff의 기준 커밋 셋(diff_refs)이 있어야 해서 MR을 한 번 더 읽는다
pub fn line_comment(repo: &str, iid: u64, file: &str, line: u64, side: &str, body: &str) -> Result<(), String> {
    let (host, path) = split(repo)?;
    let mr = api(host, "GET", &mr_path(path, iid), &[])?;
    let refs = &mr["diff_refs"];
    let mut fields = vec![
        ("body", body.to_owned()),
        ("position[position_type]", "text".to_owned()),
        ("position[base_sha]", text(refs, "/base_sha")),
        ("position[start_sha]", text(refs, "/start_sha")),
        ("position[head_sha]", text(refs, "/head_sha")),
        ("position[new_path]", file.to_owned()),
        ("position[old_path]", file.to_owned()),
    ];
    fields.push(if side == "LEFT" { ("position[old_line]", line.to_string()) } else { ("position[new_line]", line.to_string()) });
    api(host, "POST", &format!("{}/discussions", mr_path(path, iid)), &fields).map(|_| ())
}

pub fn reply(repo: &str, iid: u64, discussion: &str, body: &str) -> Result<(), String> {
    let (host, path) = split(repo)?;
    if !discussion.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(say("토론 id가 이상하다", "Invalid discussion id"));
    }
    api(host, "POST", &format!("{}/discussions/{discussion}/notes", mr_path(path, iid)), &[("body", body.to_owned())]).map(|_| ())
}

/// approve: 승인. GitLab에는 "수정 요청"이 없어서 그 글을 코멘트로 남긴다
pub fn review(repo: &str, iid: u64, kind: &str, body: &str) -> Result<(), String> {
    let (host, path) = split(repo)?;
    match kind {
        "approve" => {
            api(host, "POST", &format!("{}/approve", mr_path(path, iid)), &[])?;
            if !body.trim().is_empty() {
                comment(repo, iid, body)?;
            }
            Ok(())
        }
        "request-changes" => comment(repo, iid, &format!("**수정 요청**\n\n{body}")),
        _ => comment(repo, iid, body),
    }
}

/// method: squash, merge. GitLab의 리베이스는 프로젝트 설정을 따르므로 merge로 머지한다
pub fn merge(repo: &str, iid: u64, method: &str, delete_branch: bool) -> Result<(), String> {
    let (host, path) = split(repo)?;
    let fields = vec![("squash", (method == "squash").to_string()), ("should_remove_source_branch", delete_branch.to_string())];
    api(host, "PUT", &format!("{}/merge", mr_path(path, iid)), &fields).map(|_| ())
}

pub fn set_state(repo: &str, iid: u64, close: bool, note: &str) -> Result<(), String> {
    let (host, path) = split(repo)?;
    if !note.trim().is_empty() {
        comment(repo, iid, note)?;
    }
    api(host, "PUT", &mr_path(path, iid), &[("state_event", if close { "close" } else { "reopen" }.to_owned())]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_repo() {
        assert_eq!(split("gitlab.com/group/sub/proj").unwrap(), ("gitlab.com", "group/sub/proj"));
        assert!(split("gitlab.com/proj").is_err());
        assert!(split("gitlab.com/a/b c").is_err());
    }

    #[test]
    fn view_like_github() {
        let mr = json!({"iid": 12, "title": "t", "description": "d", "author": {"username": "me"}, "state": "opened", "draft": false,
            "target_branch": "main", "source_branch": "fix", "sha": "abc", "web_url": "https://gitlab.com/g/p/-/merge_requests/12",
            "head_pipeline": {"status": "failed"}, "has_conflicts": false, "created_at": "2026-11-20T00:00:00Z"});
        let diffs = json!([{"old_path": "a.kt", "new_path": "a.kt", "diff": "@@ -1,1 +1,2 @@\n x\n+y\n", "new_file": false}]);
        let approvals = json!({"approved": true, "approved_by": [{"user": {"username": "lead"}}]});
        let disc = json!([
            {"id": "d1", "notes": [{"id": 1, "body": "line", "author": {"username": "lead"}, "created_at": "c", "position": {"new_path": "a.kt", "old_path": "a.kt", "new_line": 2}}, {"id": 2, "body": "re", "author": {"username": "me"}, "created_at": "c"}]},
            {"id": "d2", "notes": [{"id": 3, "body": "general", "author": {"username": "qa"}, "created_at": "c"}]},
            {"id": "d3", "notes": [{"id": 4, "body": "added 1 commit", "system": true, "author": {"username": "me"}}]}
        ]);
        let v = view_of(&mr, &diffs, &approvals, &disc);
        assert_eq!(v["state"], "OPEN");
        assert_eq!(v["reviewDecision"], "APPROVED");
        assert_eq!(v["statusCheckRollup"][0]["conclusion"], "FAILURE");
        assert_eq!((v["additions"].as_i64(), v["deletions"].as_i64()), (Some(1), Some(0)));
        assert_eq!(v["comments"].as_array().unwrap().len(), 1);
        let (lines, _) = split_discussions(&disc);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["id"], "d1");
        assert_eq!(lines[1]["in_reply_to_id"], "d1");
        assert_eq!(lines[0]["line"], 2);
        assert!(diff_text(&diffs).starts_with("diff --git a/a.kt b/a.kt\n--- a/a.kt\n+++ b/a.kt\n@@"));
    }

    #[test]
    fn search_item_project() {
        let it = search_item(&json!({"iid": 7, "title": "x", "web_url": "https://gitlab.example.com/g/s/p/-/merge_requests/7", "author": {"username": "u"}, "updated_at": "t"})).unwrap();
        assert_eq!(it["repository"]["nameWithOwner"], "gitlab:gitlab.example.com/g/s/p");
    }
}
