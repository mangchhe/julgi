//! GitHub의 PR을 Julgi 안에서 보려고 gh(GitHub CLI)를 부른다.
//! 로그인과 토큰은 gh가 키체인에 갖고 있다. Julgi는 토큰을 보지도 적지도 않는다.
//! 셸을 거치지 않고 gh를 바로 띄운다. 레포 이름과 번호는 모양을 확인한 뒤에만 넘긴다.

use crate::lang::say;
use std::{path::Path, process::Command};

use crate::gitlab;

/// "gitlab:호스트/경로"면 GitLab 쪽 이름을 준다
pub(crate) fn gl(repo: &str) -> Option<&str> {
    repo.strip_prefix("gitlab:")
}

/// 맥에서 앱으로 띄우면 PATH에 Homebrew가 없다. 흔한 자리를 먼저 본다
fn gh_bin() -> &'static str {
    ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].into_iter().find(|p| Path::new(p).exists()).unwrap_or("gh")
}

pub(crate) fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new(gh_bin())
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .output()
        .map_err(|_| say("gh가 없다. brew install gh", "gh is not installed. brew install gh"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}

/// "소유자/레포" 모양인가. 그 밖의 글이 gh 인자로 섞여 들지 않게 한다
pub(crate) fn check_repo(repo: &str) -> Result<(), String> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    match repo.split_once('/') {
        Some((owner, name)) if ok(owner) && ok(name) => Ok(()),
        _ => Err(say(&format!("레포 이름이 이상하다: {repo}"), &format!("Invalid repo name: {repo}"))),
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
    if let Some(r) = gl(&repo) {
        return gitlab::view(r, number);
    }
    check_repo(&repo)?;
    let fields = "number,title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,url,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,comments,reviews,mergeable,createdAt";
    run(&["pr", "view", &number.to_string(), "-R", &repo, "--json", fields])
}

/// PR의 변경 (git diff 글)
#[tauri::command(async)]
pub fn pr_diff(repo: String, number: u64) -> Result<String, String> {
    if let Some(r) = gl(&repo) {
        return gitlab::diff(r, number);
    }
    check_repo(&repo)?;
    run(&["pr", "diff", &number.to_string(), "-R", &repo])
}

/// 코드 줄에 단 리뷰 코멘트들. 100개까지
#[tauri::command(async)]
pub fn pr_comments(repo: String, number: u64) -> Result<String, String> {
    if let Some(r) = gl(&repo) {
        return gitlab::comments(r, number);
    }
    check_repo(&repo)?;
    run(&["api", &format!("repos/{repo}/pulls/{number}/comments?per_page=100")])
}

/// 세션 줄에 달 PR의 지금 형편. 2분마다 열린 세션의 PR마다 한 번씩 부른다
#[derive(serde::Serialize)]
pub struct PrStatus {
    /// OPEN, CLOSED, MERGED
    state: String,
    /// SUCCESS, FAILURE, ERROR, PENDING, EXPECTED, 또는 검사 없음이면 빈 글
    ci: String,
    /// APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, 또는 빈 글
    decision: String,
    /// 나 말고 다른 사람이 쓴 코멘트·리뷰·줄 코멘트 수. 늘면 새 코멘트가 온 것이다
    others: u32,
    /// 마지막으로 닫거나 다시 연 사람이 내가 아니면 그 사람(봇 포함). 나거나 없으면 빈 글
    actor: String,
}

#[tauri::command(async)]
pub fn pr_status(repo: String, number: u64) -> Result<PrStatus, String> {
    if let Some(r) = gl(&repo) {
        let (state, ci, decision, others, actor) = gitlab::status_of_mr(r, number)?;
        return Ok(PrStatus { state, ci, decision, others, actor });
    }
    check_repo(&repo)?;
    let (owner, name) = repo.split_once('/').unwrap_or_default();
    let query = "query($owner:String!,$name:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$number){state reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}} comments(last:100){nodes{author{login}}} reviews(last:100){nodes{author{login}}} reviewThreads(last:100){nodes{comments(last:100){nodes{author{login}}}}} timelineItems(last:1,itemTypes:[CLOSED_EVENT,REOPENED_EVENT]){nodes{... on ClosedEvent{actor{login}} ... on ReopenedEvent{actor{login}}}}}}}";
    let out = run(&["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("owner={owner}"), "-f", &format!("name={name}"), "-F", &format!("number={number}")])?;
    let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    status_of(&v).ok_or_else(|| say("PR을 찾지 못했다", "PR not found"))
}

fn status_of(v: &serde_json::Value) -> Option<PrStatus> {
    let me = v.pointer("/data/viewer/login")?.as_str()?;
    let pr = v.pointer("/data/repository/pullRequest")?;
    let text = |p: &str| pr.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_owned();
    let not_me = |list: Option<&serde_json::Value>| {
        list.and_then(|l| l.as_array()).map_or(0, |l| l.iter().filter(|n| n.pointer("/author/login").and_then(|x| x.as_str()).is_some_and(|who| who != me)).count() as u32)
    };
    let actor = pr.pointer("/timelineItems/nodes/0/actor/login").and_then(|x| x.as_str()).filter(|who| *who != me).unwrap_or("").to_owned();
    let threads = pr.pointer("/reviewThreads/nodes").and_then(|t| t.as_array()).map_or(0, |t| t.iter().map(|th| not_me(th.pointer("/comments/nodes"))).sum());
    Some(PrStatus {
        state: text("/state"),
        ci: text("/commits/nodes/0/commit/statusCheckRollup/state"),
        decision: text("/reviewDecision"),
        others: not_me(pr.pointer("/comments/nodes")) + not_me(pr.pointer("/reviews/nodes")) + threads,
        actor,
    })
}

/// 한 레포의 열린 PR들. ⌘K에서 pr을 치면 고를 거리로 보여 준다. gh가 준 JSON 그대로
#[tauri::command(async)]
pub fn pr_list(repo: String) -> Result<String, String> {
    if let Some(r) = gl(&repo) {
        return gitlab::list(r);
    }
    check_repo(&repo)?;
    run(&["pr", "list", "-R", &repo, "--state", "open", "--limit", "50", "--json", "number,title,author,headRefName,isDraft,updatedAt"])
}

/// 내가 연 열린 PR들. gh가 준 JSON 그대로
#[tauri::command(async)]
pub fn pr_mine() -> Result<String, String> {
    let gh = run(&["search", "prs", "--author=@me", "--state=open", "--limit", "50", "--json", "number,title,repository,author,updatedAt,url,isDraft"]);
    merge_lists(gh, gitlab::mine())
}

/// GitHub 목록(JSON 글)에 GitLab 목록을 이어 붙인다. 한쪽만 연결돼 있어도 된다
fn merge_lists(gh: Result<String, String>, lab: Vec<serde_json::Value>) -> Result<String, String> {
    let mut list: Vec<serde_json::Value> = match &gh {
        Ok(text) => serde_json::from_str(text).unwrap_or_default(),
        Err(_) if !lab.is_empty() => Vec::new(),
        Err(e) => return Err(e.clone()),
    };
    list.extend(lab);
    Ok(serde_json::Value::from(list).to_string())
}

/// 나한테 리뷰를 부탁한 열린 PR들. gh가 준 JSON 그대로
#[tauri::command(async)]
pub fn pr_review_requests() -> Result<String, String> {
    let gh = run(&["search", "prs", "--review-requested=@me", "--state=open", "--limit", "30", "--json", "number,title,repository,author,updatedAt,url,isDraft"]);
    merge_lists(gh, gitlab::review_requests())
}

/// glab이 깔려 있나, 로그인한 계정
#[tauri::command(async)]
pub fn glab_status() -> (bool, String) {
    gitlab::status()
}

// ── 쓰기: GitHub에 글이 올라가고 머지된다. 화면에서 내가 누른 것만 부른다 ──

fn check_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty() { Err(say("쓸 말이 비었다", "Nothing to post: the text is empty")) } else { Ok(()) }
}

/// PR에 코멘트 하나 (대화에)
#[tauri::command(async)]
pub fn pr_comment(repo: String, number: u64, body: String) -> Result<(), String> {
    check_body(&body)?;
    if let Some(r) = gl(&repo) {
        return gitlab::comment(r, number, &body);
    }
    check_repo(&repo)?;
    run(&["pr", "comment", &number.to_string(), "-R", &repo, "--body", &body]).map(|_| ())
}

/// 코드 줄에 코멘트 하나. side는 RIGHT(바뀐 뒤 줄) 또는 LEFT(바뀌기 전 줄), commit은 PR의 지금 머리 커밋
#[tauri::command(async)]
pub fn pr_line_comment(repo: String, number: u64, commit: String, path: String, line: u64, side: String, body: String) -> Result<(), String> {
    check_body(&body)?;
    if let Some(r) = gl(&repo) {
        return gitlab::line_comment(r, number, &path, line, &side, &body);
    }
    check_repo(&repo)?;
    if commit.is_empty() || !commit.chars().all(|c| c.is_ascii_hexdigit()) || path.is_empty() || path.contains('\n') || !(side == "RIGHT" || side == "LEFT") {
        return Err(say("줄 코멘트를 달 자리가 이상하다", "Invalid position for a line comment"));
    }
    let api = format!("repos/{repo}/pulls/{number}/comments");
    let fields = [format!("body={body}"), format!("commit_id={commit}"), format!("path={path}"), format!("side={side}")];
    let line = format!("line={line}");
    run(&["api", "-X", "POST", &api, "-f", &fields[0], "-f", &fields[1], "-f", &fields[2], "-f", &fields[3], "-F", &line]).map(|_| ())
}

/// 줄 코멘트 스레드에 답글
#[tauri::command(async)]
pub fn pr_reply(repo: String, number: u64, id: String, body: String) -> Result<(), String> {
    check_body(&body)?;
    if let Some(r) = gl(&repo) {
        return gitlab::reply(r, number, &id, &body);
    }
    check_repo(&repo)?;
    let id: u64 = id.parse().map_err(|_| say("코멘트 id가 이상하다", "Invalid comment id"))?;
    let field = format!("body={body}");
    run(&["api", "-X", "POST", &format!("repos/{repo}/pulls/{number}/comments/{id}/replies"), "-f", &field]).map(|_| ())
}

/// 리뷰를 낸다. kind: approve(승인), request-changes(수정 요청), comment(의견만)
#[tauri::command(async)]
pub fn pr_review(repo: String, number: u64, kind: String, body: String) -> Result<(), String> {
    if let Some(r) = gl(&repo) {
        return gitlab::review(r, number, &kind, &body);
    }
    check_repo(&repo)?;
    let flag = match kind.as_str() {
        "approve" => "--approve",
        "request-changes" => "--request-changes",
        "comment" => "--comment",
        _ => return Err(say(&format!("모르는 리뷰: {kind}"), &format!("Unknown review kind: {kind}"))),
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

/// 닫는다. 코멘트를 같이 남기고 브랜치를 지울 수 있다
#[tauri::command(async)]
pub fn pr_close(repo: String, number: u64, comment: String, delete_branch: bool) -> Result<(), String> {
    if let Some(r) = gl(&repo) {
        return gitlab::set_state(r, number, true, &comment);
    }
    check_repo(&repo)?;
    let n = number.to_string();
    let mut args = vec!["pr", "close", &n, "-R", &repo];
    if !comment.trim().is_empty() {
        args.extend(["--comment", &comment]);
    }
    if delete_branch {
        args.push("--delete-branch");
    }
    run(&args).map(|_| ())
}

/// 닫힌 PR을 다시 연다
#[tauri::command(async)]
pub fn pr_reopen(repo: String, number: u64, comment: String) -> Result<(), String> {
    if let Some(r) = gl(&repo) {
        return gitlab::set_state(r, number, false, &comment);
    }
    check_repo(&repo)?;
    let n = number.to_string();
    let mut args = vec!["pr", "reopen", &n, "-R", &repo];
    if !comment.trim().is_empty() {
        args.extend(["--comment", &comment]);
    }
    run(&args).map(|_| ())
}

/// 머지한다. method: squash, merge, rebase
#[tauri::command(async)]
pub fn pr_merge(repo: String, number: u64, method: String, delete_branch: bool) -> Result<(), String> {
    if let Some(r) = gl(&repo) {
        return gitlab::merge(r, number, &method, delete_branch);
    }
    check_repo(&repo)?;
    let flag = match method.as_str() {
        "squash" => "--squash",
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => return Err(say(&format!("모르는 머지 방식: {method}"), &format!("Unknown merge method: {method}"))),
    };
    let n = number.to_string();
    let mut args = vec!["pr", "merge", &n, "-R", &repo, flag];
    if delete_branch {
        args.push("--delete-branch");
    }
    run(&args).map(|_| ())
}

/// 폴더의 원격이 GitHub이면 "소유자/레포", GitLab이면 "gitlab:호스트/경로"
#[tauri::command(async)]
pub fn repo_slug(path: String) -> Option<String> {
    let out = Command::new("git").args(["-C", &path, "remote", "get-url", "origin"]).output().ok()?;
    let url = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    slug_of(&url).or_else(|| lab_slug_of(&url))
}

/// git@gitlab.com:g/s/p.git, https://gitlab.example.com/g/p → gitlab:호스트/경로. 호스트에 gitlab이 든 것만 GitLab으로 본다
fn lab_slug_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("git@").map(|r| r.replacen(':', "/", 1)).or_else(|| url.split_once("://").map(|(_, r)| r.split_once('@').map_or(r, |(_, h)| h).to_owned()))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let host = rest.split('/').next()?;
    if !host.contains("gitlab") {
        return None;
    }
    gitlab::split(rest).ok().map(|_| format!("gitlab:{rest}"))
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
        assert_eq!(lab_slug_of("git@gitlab.com:g/sub/p.git").as_deref(), Some("gitlab:gitlab.com/g/sub/p"));
        assert_eq!(lab_slug_of("https://gitlab.example.com/g/p").as_deref(), Some("gitlab:gitlab.example.com/g/p"));
        assert_eq!(lab_slug_of("git@github.com:a/b.git"), None);
    }

    #[test]
    fn status() {
        let v: serde_json::Value = serde_json::from_str(r#"{"data":{"viewer":{"login":"me"},"repository":{"pullRequest":{"state":"OPEN","reviewDecision":"CHANGES_REQUESTED",
            "commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"FAILURE"}}}]},
            "comments":{"nodes":[{"author":{"login":"me"}},{"author":{"login":"you"}}]},
            "reviews":{"nodes":[{"author":{"login":"you"}}]},
            "reviewThreads":{"nodes":[{"comments":{"nodes":[{"author":{"login":"you"}},{"author":{"login":"me"}}]}}]}}}}}"#).unwrap();
        let s = status_of(&v).unwrap();
        assert_eq!((s.state.as_str(), s.ci.as_str(), s.decision.as_str(), s.others), ("OPEN", "FAILURE", "CHANGES_REQUESTED", 3));
        assert_eq!(s.actor, "");
        let closed: serde_json::Value = serde_json::from_str(r#"{"data":{"viewer":{"login":"me"},"repository":{"pullRequest":{"state":"CLOSED","timelineItems":{"nodes":[{"actor":{"login":"stale-bot"}}]}}}}}"#).unwrap();
        assert_eq!(status_of(&closed).unwrap().actor, "stale-bot");
        let mine: serde_json::Value = serde_json::from_str(r#"{"data":{"viewer":{"login":"me"},"repository":{"pullRequest":{"state":"CLOSED","timelineItems":{"nodes":[{"actor":{"login":"me"}}]}}}}}"#).unwrap();
        assert_eq!(status_of(&mine).unwrap().actor, "");
    }
}
