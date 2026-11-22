//! GitHub의 PR을 Julgi 안에서 보려고 gh(GitHub CLI)를 부른다.
//! 로그인과 토큰은 gh가 키체인에 갖고 있다. Julgi는 토큰을 보지도 적지도 않는다.
//! 셸을 거치지 않고 gh를 바로 띄운다. 레포 이름과 번호는 모양을 확인한 뒤에만 넘긴다.

use std::{path::Path, process::Command};

/// 맥에서 앱으로 띄우면 PATH에 Homebrew가 없다. 흔한 자리를 먼저 본다
fn gh_bin() -> &'static str {
    ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].into_iter().find(|p| Path::new(p).exists()).unwrap_or("gh")
}

fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new(gh_bin())
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .output()
        .map_err(|_| "gh가 없다. brew install gh".to_owned())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}

/// "소유자/레포" 모양인가. 그 밖의 글이 gh 인자로 섞여 들지 않게 한다
fn check_repo(repo: &str) -> Result<(), String> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    match repo.split_once('/') {
        Some((owner, name)) if ok(owner) && ok(name) => Ok(()),
        _ => Err(format!("레포 이름이 이상하다: {repo}")),
    }
}

/// gh가 깔려 있는가, 로그인한 계정은 누구인가 (로그인 안 했으면 빈 글)
#[tauri::command(async)]
pub fn gh_status() -> (bool, String) {
    if run(&["--version"]).is_err() {
        return (false, String::new());
    }
    (true, run(&["api", "user", "--jq", ".login"]).map(|s| s.trim().to_owned()).unwrap_or_default())
}

/// PR 한 건의 머리: 제목, 상태, 브랜치, CI, 리뷰, 대화. gh가 준 JSON 그대로
#[tauri::command(async)]
pub fn pr_view(repo: String, number: u64) -> Result<String, String> {
    check_repo(&repo)?;
    let fields = "number,title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,url,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,comments,reviews,mergeable,createdAt";
    run(&["pr", "view", &number.to_string(), "-R", &repo, "--json", fields])
}

/// PR의 변경 (git diff 글)
#[tauri::command(async)]
pub fn pr_diff(repo: String, number: u64) -> Result<String, String> {
    check_repo(&repo)?;
    run(&["pr", "diff", &number.to_string(), "-R", &repo])
}

/// 코드 줄에 단 리뷰 코멘트들. 100개까지
#[tauri::command(async)]
pub fn pr_comments(repo: String, number: u64) -> Result<String, String> {
    check_repo(&repo)?;
    run(&["api", &format!("repos/{repo}/pulls/{number}/comments?per_page=100")])
}

// ── 쓰기: GitHub에 글이 올라가고 머지된다. 화면에서 내가 누른 것만 부른다 ──

fn check_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty() { Err("쓸 말이 비었다".into()) } else { Ok(()) }
}

/// PR에 코멘트 하나 (대화에)
#[tauri::command(async)]
pub fn pr_comment(repo: String, number: u64, body: String) -> Result<(), String> {
    check_repo(&repo)?;
    check_body(&body)?;
    run(&["pr", "comment", &number.to_string(), "-R", &repo, "--body", &body]).map(|_| ())
}

/// 코드 줄에 코멘트 하나. side는 RIGHT(바뀐 뒤 줄) 또는 LEFT(바뀌기 전 줄), commit은 PR의 지금 머리 커밋
#[tauri::command(async)]
pub fn pr_line_comment(repo: String, number: u64, commit: String, path: String, line: u64, side: String, body: String) -> Result<(), String> {
    check_repo(&repo)?;
    check_body(&body)?;
    if commit.is_empty() || !commit.chars().all(|c| c.is_ascii_hexdigit()) || path.is_empty() || path.contains('\n') || !(side == "RIGHT" || side == "LEFT") {
        return Err("줄 코멘트를 달 자리가 이상하다".into());
    }
    let api = format!("repos/{repo}/pulls/{number}/comments");
    let fields = [format!("body={body}"), format!("commit_id={commit}"), format!("path={path}"), format!("side={side}")];
    let line = format!("line={line}");
    run(&["api", "-X", "POST", &api, "-f", &fields[0], "-f", &fields[1], "-f", &fields[2], "-f", &fields[3], "-F", &line]).map(|_| ())
}

/// 줄 코멘트 스레드에 답글
#[tauri::command(async)]
pub fn pr_reply(repo: String, number: u64, id: u64, body: String) -> Result<(), String> {
    check_repo(&repo)?;
    check_body(&body)?;
    let field = format!("body={body}");
    run(&["api", "-X", "POST", &format!("repos/{repo}/pulls/{number}/comments/{id}/replies"), "-f", &field]).map(|_| ())
}

/// 리뷰를 낸다. kind: approve(승인), request-changes(수정 요청), comment(의견만)
#[tauri::command(async)]
pub fn pr_review(repo: String, number: u64, kind: String, body: String) -> Result<(), String> {
    check_repo(&repo)?;
    let flag = match kind.as_str() {
        "approve" => "--approve",
        "request-changes" => "--request-changes",
        "comment" => "--comment",
        _ => return Err(format!("모르는 리뷰: {kind}")),
    };
    // 수정 요청과 의견에는 글이 있어야 한다. 승인은 글 없이도 된다
    if kind != "approve" {
        check_body(&body)?;
    }
    let n = number.to_string();
    let mut args = vec!["pr", "review", &n, "-R", &repo, flag];
    if !body.trim().is_empty() {
        args.extend(["--body", &body]);
    }
    run(&args).map(|_| ())
}

/// 머지한다. method: squash, merge, rebase
#[tauri::command(async)]
pub fn pr_merge(repo: String, number: u64, method: String, delete_branch: bool) -> Result<(), String> {
    check_repo(&repo)?;
    let flag = match method.as_str() {
        "squash" => "--squash",
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => return Err(format!("모르는 머지 방식: {method}")),
    };
    let n = number.to_string();
    let mut args = vec!["pr", "merge", &n, "-R", &repo, flag];
    if delete_branch {
        args.push("--delete-branch");
    }
    run(&args).map(|_| ())
}

/// 폴더의 원격이 GitHub이면 "소유자/레포"
#[tauri::command(async)]
pub fn repo_slug(path: String) -> Option<String> {
    let out = Command::new("git").args(["-C", &path, "remote", "get-url", "origin"]).output().ok()?;
    slug_of(String::from_utf8_lossy(&out.stdout).trim())
}

/// git@github.com:a/b.git, https://github.com/a/b → a/b
fn slug_of(url: &str) -> Option<String> {
    let rest = url.split_once("github.com").map(|(_, r)| r.trim_start_matches([':', '/']))?;
    let slug = rest.trim_end_matches('/').trim_end_matches(".git");
    check_repo(slug).ok().map(|_| slug.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(slug_of("git@github.com:owner/repo.git").as_deref(), Some("owner/repo"));
        assert_eq!(slug_of("https://github.com/a-b/c.d/").as_deref(), Some("a-b/c.d"));
        assert_eq!(slug_of("git@gitlab.com:a/b.git"), None);
        assert!(check_repo("a/b").is_ok());
        assert!(check_repo("a/b --jq x").is_err());
        assert!(check_repo("a/b/c").is_err());
    }
}
