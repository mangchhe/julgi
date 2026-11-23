//! 세션이 코드를 고치는 자리를 안전하게 마련하고, 무엇을 고쳤는지 보여 준다.
//! 일감을 맡은 세션은 레포의 작업 폴더가 아니라 따로 딴 워크트리에서 일한다.
//! 기본 브랜치가 더럽혀지지 않고, 같은 레포의 일감 여럿이 서로 덮어쓰지 않는다.
use crate::lang::say;
use std::{path::PathBuf, process::Command};

use serde::Serialize;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

fn git(dir: &str, args: &[&str]) -> Option<String> {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim_end().to_owned())
}

/// 레포에 `julgi/<name>` 브랜치의 워크트리를 만든다. 지금 체크아웃된 커밋에서 갈라진다.
/// 돌려주는 값은 워크트리 폴더. git 레포가 아니면 오류
#[tauri::command(async)]
/// branch를 주면 그 이름으로, 원격 기본 브랜치(origin/HEAD)에서 딴다(티켓으로 시작할 때). 없으면 julgi/이름으로 지금 HEAD에서 딴다(일감)
pub fn worktree_add(repo: String, name: String, branch: Option<String>) -> Result<String, String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || name.is_empty() {
        return Err(say(&format!("쓸 수 없는 이름: {name}"), &format!("Name not allowed: {name}")));
    }
    if let Some(b) = &branch {
        if b.is_empty() || b.starts_with('-') || !b.chars().all(|c| c.is_ascii_alphanumeric() || "-_/.".contains(c)) || b.contains("..") {
            return Err(say(&format!("쓸 수 없는 브랜치 이름: {b}"), &format!("Branch name not allowed: {b}")));
        }
    }
    let top = git(&repo, &["rev-parse", "--show-toplevel"]).ok_or_else(|| say("git 레포가 아니다", "Not a git repository"))?;
    let folder = PathBuf::from(&top).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = home().join(".julgi/worktrees").join(folder).join(&name);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let path = dir.to_string_lossy().into_owned();
    let base = if branch.is_some() { git(&top, &["rev-parse", "--abbrev-ref", "origin/HEAD"]).unwrap_or_else(|| "HEAD".into()) } else { "HEAD".into() };
    let out = Command::new("git")
        .args(["-C", &top, "worktree", "add", "-b", &branch.clone().unwrap_or_else(|| format!("julgi/{name}")), &path, &base])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(path)
}

/// 워크트리를 치운다. 고친 것이 하나도 없을 때만(파일도 커밋도) 폴더와 브랜치를 지운다.
/// 고친 것이 있으면 그대로 두고 false를 돌려준다
#[tauri::command(async)]
pub fn worktree_drop(path: String) -> bool {
    // Julgi가 만든 워크트리만 건드린다
    if !path.starts_with(&home().join(".julgi/worktrees").to_string_lossy().into_owned()) {
        return false;
    }
    let clean = git(&path, &["status", "--porcelain"]).is_some_and(|s| s.is_empty());
    let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    // 갈라진 뒤에 쌓은 커밋이 있는가: 이 브랜치에만 있는 커밋을 센다
    let ahead = git(&path, &["rev-list", "--count", "HEAD", "--not", "--exclude", &format!("refs/heads/{branch}"), "--branches", "--remotes"])
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(1);
    if !clean || ahead > 0 || !branch.starts_with("julgi/") {
        return false;
    }
    let Some(common) = git(&path, &["rev-parse", "--path-format=absolute", "--git-common-dir"]) else { return false };
    let main = PathBuf::from(common).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    git(&main, &["worktree", "remove", &path]).is_some() && git(&main, &["branch", "-D", &branch]).is_some()
}

/// 작업 폴더 하나에서 바뀐 것
#[derive(Serialize)]
pub struct Changes {
    branch: String,
    /// "상태 경로" 줄들 (git status --porcelain)
    files: Vec<String>,
    /// 기본 브랜치에서 갈라진 뒤 쌓은 커밋 제목들
    commits: Vec<String>,
    /// 갈라진 곳부터 지금 작업 폴더까지의 변경 (길면 자른다)
    diff: String,
    cut: bool,
}

/// 이 폴더의 세션이 무엇을 고쳤는지: 커밋하지 않은 것과, 기본 브랜치에서 갈라진 뒤 커밋한 것을 합쳐서
#[tauri::command(async)]
pub fn repo_changes(path: String) -> Option<Changes> {
    let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let files: Vec<String> = git(&path, &["status", "--porcelain"]).unwrap_or_default().lines().map(str::to_owned).collect();
    // 갈라진 곳: 원격의 기본 브랜치와의 공통 조상. 없으면 지금 커밋(커밋하지 않은 것만 보인다)
    let base = git(&path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .and_then(|head| git(&path, &["merge-base", "HEAD", &head]))
        .unwrap_or_else(|| "HEAD".into());
    let commits: Vec<String> = git(&path, &["log", "--format=%s", &format!("{base}..HEAD")]).unwrap_or_default().lines().take(30).map(str::to_owned).collect();
    let full = git(&path, &["diff", &base]).unwrap_or_default();
    const MAX: usize = 120_000;
    let cut = full.len() > MAX;
    let diff = if cut { full.chars().take(MAX).collect() } else { full };
    Some(Changes { branch, files, commits, diff, cut })
}

/// 낱말들이 이 레포의 코드에 아직 있는가. 브레인 노트가 가리키는 이름이 사라졌는지 보는 데 쓴다
#[tauri::command(async)]
pub fn repo_has(path: String, words: Vec<String>) -> Vec<bool> {
    words
        .iter()
        .map(|word| Command::new("git").args(["-C", &path, "grep", "-q", "-I", "-F", "-e", word]).status().is_ok_and(|s| s.success()))
        .collect()
}

/// 이 폴더에서 바뀐 양: 파일 수, 더한 줄, 뺀 줄, 그리고 변경이 달라졌는지 알아보는 표시.
/// 답이 끝날 때마다 부르는 것이라 변경 내용은 읽지 않고 세기만 한다
#[tauri::command(async)]
pub fn repo_stat(path: String) -> Option<(u32, u32, u32, String, u32)> {
    git(&path, &["rev-parse", "--is-inside-work-tree"])?;
    let base = git(&path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .and_then(|head| git(&path, &["merge-base", "HEAD", &head]))
        .unwrap_or_else(|| "HEAD".into());
    let numstat = git(&path, &["diff", "--numstat", &base]).unwrap_or_default();
    let untracked = git(&path, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();
    let (mut files, mut adds, mut dels) = (0u32, 0u32, 0u32);
    for line in numstat.lines() {
        let mut cols = line.split('\t');
        adds += cols.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
        dels += cols.next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
        files += 1;
    }
    // git이 모르는 파일은 따로 센다. 세션이 오기 전부터 있던 것일 수 있어서 부르는 쪽이 가린다
    let extra = untracked.lines().count() as u32;
    // 내용이 바뀌면 달라지는 값. 줄 수가 같아도 내용이 다를 수 있어 변경의 해시를 쓴다
    let sig = git(&path, &["diff", &base]).map(|d| {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        d.hash(&mut h);
        untracked.hash(&mut h);
        format!("{:x}", h.finish())
    })?;
    Some((files, adds, dels, sig, extra))
}

/// 지금 작업 폴더의 상태를 찍어 둔다. 작업 폴더와 색인은 건드리지 않고, git에 커밋 객체 하나만 남긴다.
/// 세션이 답을 시작할 때와 끝낼 때 찍어 두면 "이번 답에서 바뀐 것"만 따로 볼 수 있다.
/// 돌려주는 값은 그 커밋. 고친 것이 없으면 지금 커밋(HEAD)이다. git이 모르는 새 파일은 담기지 않는다
#[tauri::command(async)]
pub fn repo_snapshot(path: String, name: String) -> Option<String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || name.is_empty() {
        return None;
    }
    let made = git(&path, &["stash", "create"]).filter(|sha| !sha.is_empty());
    let sha = match made {
        Some(sha) => sha,
        None => git(&path, &["rev-parse", "HEAD"])?,
    };
    // 가리키는 이름이 없으면 git이 언젠가 치운다. Julgi의 이름 아래에 걸어 둔다
    git(&path, &["update-ref", &format!("refs/julgi/{name}"), &sha]);
    Some(sha)
}

/// 찍어 둔 상태(from) 뒤로 이 폴더에 세션이 만들지 않은 이력이 들어왔는가.
/// 다른 터미널에서 브랜치를 바꾸거나 pull·merge를 하면 그렇게 된다. 그러면 from에서 지금까지의 차이에는
/// 남의 커밋이 섞여 있어 "이 세션이 고친 것"이라고 볼 수 없다. 두 가지로 가린다:
/// - from(그때의 커밋, 또는 그 위에 얹은 임시 커밋)이 지금 커밋의 조상이 아니다 → 다른 이력으로 옮겨 갔다
/// - 그 뒤로 쌓인 커밋 가운데 세션이 일을 시작하기(since, 초) 전에 만들어진 것이 있다 → 밖에서 들어온 커밋이다
#[tauri::command(async)]
pub fn repo_moved(path: String, from: String, since: i64) -> bool {
    if !(from.chars().all(|c| c.is_ascii_hexdigit()) && from.len() >= 7) {
        return false;
    }
    // 찍어 둔 커밋을 git이 모르면(치워졌으면) 판단하지 않는다
    if git(&path, &["cat-file", "-t", &from]).is_none() {
        return false;
    }
    let ancestor = |rev: &str| Command::new("git").args(["-C", &path, "merge-base", "--is-ancestor", rev, "HEAD"]).status().is_ok_and(|s| s.success());
    let parent = format!("{from}^");
    let base = if ancestor(&from) { from.clone() } else if ancestor(&parent) { parent } else { return true };
    git(&path, &["log", "--format=%ct", &format!("{base}..HEAD")]).unwrap_or_default().lines().filter_map(|l| l.trim().parse::<i64>().ok()).any(|at| at < since)
}

/// 두 상태 사이의 변경. from이 없으면 기본 브랜치에서 갈라진 곳부터, to가 없으면 지금 작업 폴더까지
#[tauri::command(async)]
pub fn repo_diff(path: String, from: Option<String>, to: Option<String>, file: Option<String>) -> Option<String> {
    // 커밋 이름이거나 HEAD(지금 커밋)만 받는다
    let ok = |s: &String| s == "HEAD" || (s.chars().all(|c| c.is_ascii_hexdigit()) && s.len() >= 7);
    if from.as_ref().is_some_and(|s| !ok(s)) || to.as_ref().is_some_and(|s| !ok(s)) {
        return None;
    }
    let base = match from {
        Some(sha) => sha,
        None => git(&path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
            .and_then(|head| git(&path, &["merge-base", "HEAD", &head]))
            .unwrap_or_else(|| "HEAD".into()),
    };
    // 파일 하나를 짚으면 그 파일을 처음부터 끝까지 보여 준다: 바뀐 줄 앞뒤로 파일 전체를 맥락으로 달라고 한다
    let mut args = vec!["diff", "--no-color", if file.is_some() { "-U100000" } else { "-U4" }, base.as_str()];
    if let Some(sha) = to.as_ref() {
        args.push(sha.as_str());
    }
    if let Some(one) = file.as_ref() {
        args.push("--");
        args.push(one.as_str());
    }
    let full = git(&path, &args)?;
    const MAX: usize = 400_000;
    Some(if full.len() > MAX { full.chars().take(MAX).collect() } else { full })
}

/// 브랜치 하나: 기본 브랜치보다 앞선/뒤처진 커밋 수, 마지막 커밋, 그리고 연 MR·PR이 있으면 그것
#[derive(Serialize, Default)]
pub struct Branch {
    name: String,
    ahead: u32,
    behind: u32,
    last: String,
    when: String,
    /// 이 브랜치로 연 MR·PR의 제목, 주소, 상태(열림/머지됨…), CI 결과. 없으면 빈 글자
    mr_title: String,
    mr_url: String,
    mr_state: String,
    ci: String,
}

/// 원격의 오래 사는 브랜치 하나. 이름으로 쓰임새를 짐작한다
#[derive(Serialize, Default)]
pub struct Line {
    name: String,
    /// "개발" | "배포" | "릴리스"
    kind: String,
    /// 기준 브랜치에는 있는데 여기에는 아직 없는 커밋 수
    wait: u32,
    /// 여기에만 있는 커밋 수
    own: u32,
    when: String,
}

/// 태그 하나. wait: 이 태그 뒤로 기준 브랜치에 쌓인 커밋 수
#[derive(Serialize, Default)]
pub struct Tag {
    name: String,
    when: String,
    wait: u32,
    /// rc·alpha·beta 같은 시험판이 아닌가
    stable: bool,
}

/// 브랜치 이름으로 쓰임새를 짐작한다. 회사마다 다르니 흔한 이름만 안다
fn line_kind(name: &str) -> &'static str {
    const DEV: [&str; 3] = ["develop", "dev", "development"];
    const DEPLOY: [&str; 12] = ["main", "master", "release", "stage", "staging", "real", "prod", "production", "int", "qa", "live", "preview"];
    if DEV.contains(&name) {
        "개발"
    } else if DEPLOY.contains(&name) || name.starts_with("deploy/") {
        "배포"
    } else if name.starts_with("release/") || name.starts_with("release-") {
        "릴리스"
    } else {
        ""
    }
}

/// 레포 하나의 지금 상태. 어느 브랜치에 있고, 무엇이 안 올라갔고, 어떤 브랜치와 MR이 살아 있는지
#[derive(Serialize, Default)]
pub struct RepoState {
    branch: String,
    default: String,
    /// 커밋하지 않은 파일 수
    dirty: u32,
    /// 원격의 같은 브랜치보다 앞선/뒤처진 커밋 수 (원격에 없으면 -1)
    ahead: i32,
    behind: i32,
    branches: Vec<Branch>,
    /// 이 레포에서 딴 워크트리들: (폴더, 브랜치)
    worktrees: Vec<(String, String)>,
    /// 원격이 어디인가: "gitlab" | "github" | ""
    forge: String,
    /// 기준 브랜치에서 갈라져 굴러가는 줄기들: 개발·배포·릴리스 브랜치
    lines: Vec<Line>,
    /// 최근 태그와 최근 정식 태그 (같으면 하나)
    tags: Vec<Tag>,
    /// 지금 브랜치가 기준 브랜치에서 갈라져 나온 커밋. 기준 브랜치 위에 있으면 빈 글자
    fork: String,
}

/// 레포의 지금 상태를 git으로 읽는다. 빠르다. MR·PR은 여기서 읽지 않는다(repo_mrs)
#[tauri::command(async)]
pub fn repo_state(path: String) -> Option<RepoState> {
    let branch = git(&path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let default = git(&path, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).unwrap_or_default();
    let dirty = git(&path, &["status", "--porcelain"]).map_or(0, |s| s.lines().filter(|l| !l.starts_with("??")).count() as u32);
    let pair = |range: &str| -> Option<(u32, u32)> {
        let out = git(&path, &["rev-list", "--left-right", "--count", range])?;
        let mut cols = out.split_whitespace();
        Some((cols.next()?.parse().ok()?, cols.next()?.parse().ok()?))
    };
    let (ahead, behind) = pair(&format!("HEAD...origin/{branch}")).map_or((-1, -1), |(a, b)| (a as i32, b as i32));
    let mut branches = Vec::new();
    // 최근에 손댄 순으로 열두 개까지. 기본 브랜치와 견줘 얼마나 벌어졌는지 센다
    let listing = git(&path, &["for-each-ref", "--sort=-committerdate", "--count=12", "--format=%(refname:short)\t%(subject)\t%(committerdate:relative)", "refs/heads"]).unwrap_or_default();
    for line in listing.lines() {
        let mut cols = line.splitn(3, '\t');
        let name = cols.next().unwrap_or("").to_owned();
        let last = cols.next().unwrap_or("").chars().take(70).collect();
        let when = cols.next().unwrap_or("").to_owned();
        let (a, b) = if default.is_empty() { (0, 0) } else { pair(&format!("{name}...{default}")).unwrap_or((0, 0)) };
        branches.push(Branch { name, ahead: a, behind: b, last, when, ..Default::default() });
    }
    let mut worktrees = Vec::new();
    let mut at = String::new();
    for line in git(&path, &["worktree", "list", "--porcelain"]).unwrap_or_default().lines() {
        if let Some(dir) = line.strip_prefix("worktree ") {
            at = dir.to_owned();
        } else if let Some(name) = line.strip_prefix("branch refs/heads/") {
            worktrees.push((at.clone(), name.to_owned()));
        }
    }
    let mut lines: Vec<Line> = Vec::new();
    let mut tags: Vec<Tag> = Vec::new();
    if !default.is_empty() {
        // 최근에 손댄 순이라, 릴리스 브랜치는 맨 처음 나온 것 하나(가장 최근 것)만 남긴다
        let remotes = git(&path, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:relative)", "refs/remotes/origin"]).unwrap_or_default();
        for line in remotes.lines() {
            let Some((full, when)) = line.split_once('\t') else { continue };
            let name = full.trim_start_matches("origin/");
            let kind = line_kind(name);
            if kind.is_empty() || full == default || (kind == "릴리스" && lines.iter().any(|l| l.kind == "릴리스")) || lines.len() >= 12 {
                continue;
            }
            let (wait, own) = pair(&format!("{default}...{full}")).unwrap_or((0, 0));
            lines.push(Line { name: name.to_owned(), kind: kind.to_owned(), wait, own, when: when.to_owned() });
        }
        let listing = git(&path, &["for-each-ref", "--sort=-creatordate", "--count=40", "--format=%(refname:short)\t%(creatordate:relative)", "refs/tags"]).unwrap_or_default();
        let unstable = |name: &str| ["rc", "alpha", "beta", "snapshot", "dev"].iter().any(|w| name.to_lowercase().contains(w));
        let mut rows = listing.lines().filter_map(|l| l.split_once('\t'));
        let newest = rows.next();
        let stable = newest.filter(|(name, _)| !unstable(name)).or_else(|| rows.find(|(name, _)| !unstable(name)));
        for (name, when) in newest.into_iter().chain(stable.filter(|s| Some(s.0) != newest.map(|n| n.0))) {
            let wait = git(&path, &["rev-list", "--count", &format!("{name}..{default}")]).and_then(|n| n.parse().ok()).unwrap_or(0);
            tags.push(Tag { name: name.to_owned(), when: when.to_owned(), wait, stable: !unstable(name) });
        }
    }
    let fork = if default.is_empty() || default.trim_start_matches("origin/") == branch { String::new() } else { git(&path, &["merge-base", "HEAD", &default]).unwrap_or_default() };
    let remote = git(&path, &["remote", "get-url", "origin"]).unwrap_or_default();
    let forge = if remote.contains("gitlab") { "gitlab" } else if remote.contains("github") { "github" } else { "" };
    Some(RepoState { branch, default: default.trim_start_matches("origin/").to_owned(), dirty, ahead, behind, branches, worktrees, forge: forge.to_owned(), lines, tags, fork })
}

/// 내가 이 레포에 열어 둔 MR·PR. glab이나 gh가 깔려 있고 로그인돼 있을 때만 나온다. 없으면 빈 목록.
/// 돌려주는 값: (브랜치, 제목, 주소, 상태, CI 결과)
#[tauri::command(async)]
pub fn repo_mrs(path: String, forge: String) -> Vec<(String, String, String, String, String)> {
    let cmd = match forge.as_str() {
        "gitlab" => "glab mr list --author=@me -F json 2>/dev/null",
        "github" => "gh pr list --author @me --json title,url,headRefName,state,statusCheckRollup 2>/dev/null",
        _ => return Vec::new(),
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Ok(out) = Command::new(shell).args(["-l", "-c", cmd]).current_dir(&path).env("GLAB_NO_PROMPT", "1").output() else { return Vec::new() };
    let Ok(rows) = serde_json::from_slice::<Vec<serde_json::Value>>(&out.stdout) else { return Vec::new() };
    let text = |v: &serde_json::Value, key: &str| v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_owned();
    rows.iter()
        .map(|r| {
            if forge == "gitlab" {
                let ci = r.get("head_pipeline").or_else(|| r.get("pipeline")).map_or(String::new(), |p| text(p, "status"));
                (text(r, "source_branch"), text(r, "title"), text(r, "web_url"), text(r, "state"), ci)
            } else {
                // 검사 여럿 가운데 하나라도 실패면 실패, 도는 것이 있으면 도는 중
                let checks: Vec<String> = r.get("statusCheckRollup").and_then(|c| c.as_array()).map_or(Vec::new(), |list| list.iter().map(|c| text(c, "conclusion")).collect());
                let ci = if checks.iter().any(|c| c == "FAILURE") { "failed" } else if checks.iter().any(|c| c.is_empty()) && !checks.is_empty() { "running" } else if checks.is_empty() { "" } else { "success" };
                (text(r, "headRefName"), text(r, "title"), text(r, "url"), text(r, "state").to_lowercase(), ci.to_owned())
            }
        })
        .collect()
}

/// 커밋 하나의 작성자와 메시지 전체(제목과 본문). 이력에서는 제목만 잘려 보여서 고르면 이것을 위에 편다
#[tauri::command(async)]
pub fn commit_message(path: String, sha: String) -> Option<(String, String)> {
    if sha.is_empty() || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let out = git(&path, &["show", "-s", "--format=%an%x00%B", &sha])?;
    let (author, body) = out.split_once('\0')?;
    Some((author.to_owned(), body.trim().to_owned()))
}

/// 지금 커밋에서 거슬러 올라간 이력. 최근 것부터, 갈라지고 합쳐진 모양을 그릴 수 있게 부모를 전부 준다.
/// 돌려주는 값: (커밋, 부모들(빈칸으로 나눔), 제목, 언제(초), 그 커밋에 붙은 브랜치·태그 이름들)
#[tauri::command(async)]
pub fn repo_commits(path: String) -> Vec<(String, String, String, u64, String)> {
    git(&path, &["log", "--topo-order", "-n", "60", "--format=%H\t%P\t%s\t%ct\t%D"])
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut cols = line.splitn(5, '\t');
            let sha = cols.next()?.to_owned();
            let parents = cols.next()?.to_owned();
            let subject = cols.next()?.to_owned();
            let when = cols.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            Some((sha, parents, subject, when, cols.next().unwrap_or("").to_owned()))
        })
        .collect()
}

#[cfg(test)]
mod moved_tests {
    use super::*;

    fn sh(dir: &std::path::Path, args: &[&str]) -> String {
        let out = Command::new("git").current_dir(dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    /// 세션이 같은 브랜치에서 커밋한 것은 "옮겨 감"이 아니고, 밖에서 들어온 커밋(브랜치 바꿈, 옛 커밋 합침)은 "옮겨 감"이다
    #[test]
    fn tells_foreign_history_from_session_commits() {
        let dir = std::env::temp_dir().join(format!("julgi-moved-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().into_owned();
        sh(&dir, &["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("f"), "a\n").unwrap();
        sh(&dir, &["add", "f"]);
        sh(&dir, &["commit", "-qm", "A", "--date", "2020-01-01T00:00:00"]);
        // 다른 브랜치에 옛 커밋 하나 (세션이 시작하기 전에 만들어진 것)
        sh(&dir, &["checkout", "-q", "-b", "other"]);
        std::fs::write(dir.join("g"), "o\n").unwrap();
        sh(&dir, &["add", "g"]);
        let old = Command::new("git").current_dir(&dir).args(["commit", "-qm", "O"]).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").env("GIT_COMMITTER_DATE", "2020-01-02T00:00:00").status().unwrap();
        assert!(old.success());
        sh(&dir, &["checkout", "-q", "main"]);
        // 세션이 일을 시작한다: 고치던 중의 상태를 찍는다
        let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64 - 5;
        std::fs::write(dir.join("f"), "a\nb\n").unwrap();
        let from = sh(&dir, &["stash", "create"]);
        assert!(from.len() >= 7);
        assert!(!repo_moved(path.clone(), from.clone(), since), "고치기만 했으면 옮겨 간 것이 아니다");
        sh(&dir, &["commit", "-qam", "B"]);
        assert!(!repo_moved(path.clone(), from.clone(), since), "세션이 같은 브랜치에 커밋한 것은 옮겨 간 것이 아니다");
        // 밖에서 옛 커밋을 합친다 (pull·merge)
        sh(&dir, &["merge", "-q", "--no-edit", "other"]);
        assert!(repo_moved(path.clone(), from.clone(), since), "세션이 시작하기 전의 커밋이 들어왔으면 옮겨 간 것이다");
        // 아예 다른 브랜치로 바꾼다
        sh(&dir, &["checkout", "-q", "other"]);
        assert!(repo_moved(path.clone(), from.clone(), since), "다른 브랜치로 바꿨으면 옮겨 간 것이다");
        assert!(!repo_moved(path, "zzz".into(), since), "이상한 이름은 판단하지 않는다");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
