//! 장부: Claude Code 대화 기록을 훑어 세션 목록을 만든다.
//! 결과는 ~/.julgi/ledger.json에 두고, 크기와 수정 시각이 그대로인 파일은 다시 읽지 않는다.
//! 장부는 지워도 된다. 대화 기록에서 다시 만들어진다.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const TAIL_BYTES: u64 = 600_000;
const HEAD_BYTES: u64 = 200_000;
/// 작업 목록을 알려 주는 바깥 명령은 이보다 자주 돌리지 않는다
const WORKS_EVERY: Duration = Duration::from_secs(300);

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SessionInfo {
    pub id: String,
    pub cwd: String,
    pub branch: String,
    pub title: String,
    /// 자리를 비운 사이 Claude Code가 남긴 요약
    pub recap: String,
    /// 마지막 턴에 실린 컨텍스트 크기(토큰)
    pub tokens: u64,
    /// 대화에 나온 산출물 링크 (아티팩트, PR·MR, 티켓). 최근 것이 뒤에 온다
    #[serde(default)]
    pub links: Vec<String>,
    /// 세션이 새로 만든 파일(Write 도구로 통째로 쓴 것)의 경로. 최근 것이 뒤에 온다. 임시 폴더의 것은 뺀다
    #[serde(default)]
    pub files: Vec<String>,
    pub mtime: u64,
    pub size: u64,
    /// 폴더가 속한 git 레포 이름. 훑을 때마다 다시 채운다
    #[serde(default)]
    pub repo: String,
    /// Claude Code가 적어 둔 세션을 연 길(entrypoint). 터미널에서 열면 "cli", 스크립트나 SDK가 돌리면 "sdk-cli" 같은 값.
    /// 가장 최근 줄의 값이다. 스크립트가 시작한 세션을 사람이 이어받으면 "cli"로 바뀐다
    #[serde(default)]
    pub entry: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Work {
    pub key: String,
    pub title: String,
    pub repo: String,
    pub branches: Vec<String>,
}

#[derive(Serialize)]
pub struct Ledger {
    pub sessions: Vec<SessionInfo>,
    pub works: Vec<Work>,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

fn read_range(path: &Path, from: u64, len: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    file.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = Vec::new();
    file.take(len).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

const LINK_MARKS: [&str; 5] = ["claude.ai/artifact/", "/pull/", "/merge_requests/", "atlassian.net/browse/", "/issues/"];
const MAX_LINKS: usize = 12;

/// 글에서 산출물로 볼 만한 링크만 뽑는다. 순서를 지키고 중복은 뒤쪽 것을 남긴다.
fn collect_links(text: &str, links: &mut Vec<String>) {
    let mut rest = text;
    while let Some(at) = rest.find("https://") {
        let tail = &rest[at..];
        let end = tail
            .find(|c: char| c.is_whitespace() || "\"\\<>()[]{}'`|,".contains(c) || !c.is_ascii())
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ':', ';', '!', '?']);
        // 표시 뒤에 번호나 키가 실제로 붙어 있어야 한다. "…/browse/<키>"처럼 자리만 잡아 둔 예시 주소는 링크가 아니다
        let real = |mark: &&str| url.find(*mark).is_some_and(|i| url[i + mark.len()..].chars().next().is_some_and(|c| c.is_ascii_alphanumeric()));
        if LINK_MARKS.iter().any(|mark| real(&mark)) {
            links.retain(|known| known != url);
            links.push(url.to_owned());
        }
        rest = &tail[end.max(8)..];
    }
}

/// Claude가 Write 도구로 쓴 파일을 모은다. 고치기(Edit)는 코드 변경이라 검토 화면이 보여 주고, 여기는 새로 만든 것만 둔다.
fn collect_files(v: &Value, files: &mut Vec<String>) {
    for part in v["message"]["content"].as_array().into_iter().flatten() {
        if part["type"] != "tool_use" || part["name"] != "Write" {
            continue;
        }
        let Some(path) = part["input"]["file_path"].as_str() else { continue };
        if ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/"].iter().any(|t| path.starts_with(t)) {
            continue;
        }
        files.retain(|known| known != path);
        files.push(path.to_owned());
    }
    if files.len() > MAX_LINKS {
        files.drain(..files.len() - MAX_LINKS);
    }
}

fn first_text(message: &Value) -> Option<String> {
    let content = &message["content"];
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().find_map(|p| p["text"].as_str().map(str::to_owned))?,
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') {
        return None;
    }
    // 제목으로 쓸 것이라 첨부 표시와 링크는 뺀다
    let line: String = text
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .filter(|word| !word.starts_with("http") && !word.starts_with("[Image") && !(word.starts_with('#') && word.ends_with(']')))
        .collect::<Vec<_>>()
        .join(" ");
    if line.is_empty() {
        return None;
    }
    Some(line.chars().take(60).collect())
}

fn scan_file(path: &Path, mtime: u64, size: u64) -> Option<SessionInfo> {
    let mut info = SessionInfo {
        id: path.file_stem()?.to_string_lossy().into_owned(),
        mtime,
        size,
        ..Default::default()
    };

    // 제목, 요약, 크기는 턴마다 다시 적히므로 파일 끝만 읽어도 최신 값이 나온다.
    let from = size.saturating_sub(TAIL_BYTES);
    let tail = read_range(path, from, TAIL_BYTES)?;
    let mut lines = tail.lines();
    if from > 0 {
        lines.next(); // 중간에서 잘린 첫 줄
    }
    for line in lines {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        // 링크는 사람과 Claude가 주고받은 말에서만 모은다 (도구 설정 같은 기록은 뺀다)
        if matches!(v["type"].as_str(), Some("user" | "assistant")) && v["isSidechain"] != true {
            collect_links(line, &mut info.links);
            collect_files(&v, &mut info.files);
        }
        if let Some(cwd) = v["cwd"].as_str() {
            info.cwd = cwd.to_owned();
            if let Some(branch) = v["gitBranch"].as_str() {
                info.branch = branch.to_owned();
            }
        }
        if let Some(entry) = v["entrypoint"].as_str() {
            info.entry = entry.to_owned();
        }
        match v["type"].as_str() {
            Some("ai-title") => {
                if let Some(t) = v["aiTitle"].as_str() {
                    info.title = t.to_owned();
                }
            }
            Some("custom-title") => {
                if let Some(t) = v["customTitle"].as_str() {
                    info.title = t.to_owned();
                }
            }
            Some("system") if v["subtype"] == "away_summary" => {
                if let Some(t) = v["content"].as_str() {
                    info.recap = t.to_owned();
                }
            }
            Some("assistant") if v["isSidechain"] != true => {
                let usage = &v["message"]["usage"];
                let sum: u64 = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]
                    .iter()
                    .filter_map(|k| usage[*k].as_u64())
                    .sum();
                if sum > 0 {
                    info.tokens = sum;
                }
            }
            _ => {}
        }
    }

    if info.title.is_empty() || info.cwd.is_empty() {
        let head = read_range(path, 0, HEAD_BYTES)?;
        for line in head.lines() {
            let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
            if info.cwd.is_empty() {
                if let Some(cwd) = v["cwd"].as_str() {
                    info.cwd = cwd.to_owned();
                    info.branch = v["gitBranch"].as_str().unwrap_or("").to_owned();
                }
            }
            if info.title.is_empty() && v["type"] == "user" && v["isSidechain"] != true {
                if let Some(text) = first_text(&v["message"]) {
                    info.title = text;
                }
            }
            if !info.title.is_empty() && !info.cwd.is_empty() {
                break;
            }
        }
    }

    if info.links.len() > MAX_LINKS {
        info.links.drain(..info.links.len() - MAX_LINKS);
    }

    // 대화가 한 번도 없었던 파일은 세션으로 치지 않는다
    if info.cwd.is_empty() || info.title.is_empty() {
        return None;
    }
    Some(info)
}

fn scan_sessions() -> Vec<SessionInfo> {
    let cache_path = home().join(".julgi/ledger-v6.json");
    let cache: HashMap<String, Option<SessionInfo>> = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut next: HashMap<String, Option<SessionInfo>> = HashMap::new();
    let mut changed = false;

    let projects = home().join(".claude/projects");
    for project in fs::read_dir(projects).into_iter().flatten().flatten() {
        for entry in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            let key = path.to_string_lossy().into_owned();
            let cached = cache.get(&key).filter(|hit| match hit {
                Some(info) => info.mtime == mtime && info.size == meta.len(),
                None => false, // 세션이 아니라고 봤던 파일은 싸니까 다시 본다
            });
            let info = match cached {
                Some(hit) => hit.clone(),
                None => {
                    changed = true;
                    scan_file(&path, mtime, meta.len())
                }
            };
            next.insert(key, info);
        }
    }

    if changed || next.len() != cache.len() {
        let _ = fs::create_dir_all(home().join(".julgi"));
        if let Ok(json) = serde_json::to_string(&next) {
            let _ = fs::write(&cache_path, json);
        }
    }
    let mut sessions: Vec<SessionInfo> = next.into_values().flatten().collect();
    sessions.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    sessions
}

/// 세션의 폴더가 속한 git 레포의 이름. 하위 폴더에서 열었어도, 워크트리에서 열었어도 원래 레포 이름이 나온다.
/// 폴더가 이미 없거나 git 레포가 아니면 빈 문자열이고, 그때는 화면 쪽이 폴더 이름으로 대신한다.
fn repo_name(cwd: &str) -> String {
    let mut dir = Path::new(cwd);
    loop {
        let git = dir.join(".git");
        if git.is_dir() {
            return name_of(dir);
        }
        if git.is_file() {
            // 워크트리의 .git은 "gitdir: <원래 레포>/.git/worktrees/<이름>" 한 줄짜리 파일이다
            let pointer = fs::read_to_string(&git).unwrap_or_default();
            let target = Path::new(pointer.trim().trim_start_matches("gitdir:").trim());
            let main = target.ancestors().find(|p| p.file_name().is_some_and(|n| n == ".git")).and_then(Path::parent);
            return name_of(main.unwrap_or(dir));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => return String::new(),
        }
    }
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 바깥 도구가 알려 주는 "작업" 목록. Julgi는 작업이 어디서 오는지 모른다.
/// 설정의 worksCommand가 있으면 그 명령의 출력을, 없으면 ~/.julgi/works.json을 읽는다.
/// 형식: [{"key": "PROJ-123", "title": "…", "repo": "…", "branches": ["feature/…"]}]
fn load_works(command: Option<String>) -> Vec<Work> {
    static CACHE: Mutex<Option<(Instant, String, Vec<Work>)>> = Mutex::new(None);
    let Some(command) = command.filter(|c| !c.trim().is_empty()) else {
        return fs::read_to_string(home().join(".julgi/works.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    };
    let mut cache = CACHE.lock().unwrap();
    if let Some((at, asked, works)) = cache.as_ref() {
        if *asked == command && at.elapsed() < WORKS_EVERY {
            return works.clone();
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let works: Vec<Work> = std::process::Command::new(shell)
        .args(["-l", "-c", &command])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()
        .and_then(|out| serde_json::from_slice(&out.stdout).ok())
        .unwrap_or_default();
    *cache = Some((Instant::now(), command, works.clone()));
    works
}

/// 세션의 마지막 Claude 답변 글. 갈아탈 때 인계 요약을 꺼내는 데 쓴다.
#[tauri::command(async)]
pub fn last_reply(session_id: String) -> Option<String> {
    let projects = home().join(".claude/projects");
    let path = fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|project| project.path().join(format!("{session_id}.jsonl")))
        .find(|path| path.is_file())?;
    let size = fs::metadata(&path).ok()?.len();
    let tail = read_range(&path, size.saturating_sub(TAIL_BYTES), TAIL_BYTES)?;
    let mut reply = None;
    for line in tail.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" || v["isSidechain"] == true {
            continue;
        }
        let text: Vec<&str> = v["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|part| part["text"].as_str())
            .collect();
        if !text.is_empty() {
            reply = Some(text.join("\n"));
        }
    }
    reply
}

/// 세션에서 내가 마지막으로 한 말과 그 답. 엉뚱한 세션에 친 말을 다른 줄기로 옮길 때 쓴다.
#[tauri::command(async)]
pub fn last_exchange(session_id: String) -> Option<(String, String)> {
    let projects = home().join(".claude/projects");
    let path = fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|project| project.path().join(format!("{session_id}.jsonl")))
        .find(|path| path.is_file())?;
    let size = fs::metadata(&path).ok()?.len();
    let tail = read_range(&path, size.saturating_sub(TAIL_BYTES), TAIL_BYTES)?;
    let mut asked: Option<String> = None;
    let mut reply = String::new();
    for line in tail.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        // 컨텍스트를 줄이며 끼워 넣은 요약도 내 말이 아니다
        if v["isSidechain"] == true || v["isMeta"] == true || v["isCompactSummary"] == true {
            continue;
        }
        let content = &v["message"]["content"];
        let text = match content.as_str() {
            Some(text) => text.to_string(),
            None => content.as_array().into_iter().flatten().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n"),
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        if v["type"] == "user" {
            // 도구 결과나 시스템이 끼워 넣은 글은 내 말이 아니다
            if !text.starts_with('<') {
                asked = Some(text.to_string());
                reply.clear();
            }
        } else if v["type"] == "assistant" && asked.is_some() {
            reply = text.to_string();
        }
    }
    asked.map(|asked| (asked, reply))
}

#[tauri::command(async)]
pub fn ledger_scan(works_command: Option<String>) -> Ledger {
    let mut sessions = scan_sessions();
    let mut repos: HashMap<String, String> = HashMap::new();
    for s in &mut sessions {
        s.repo = repos.entry(s.cwd.clone()).or_insert_with(|| repo_name(&s.cwd)).clone();
    }
    Ledger { sessions, works: load_works(works_command) }
}

/// 글 안에서 이 폴더를 가리키는 곳이 있는가. "/a/repo"가 "/a/repo-t75"에도 걸리지 않게 뒤 글자를 본다
fn mentions(text: &str, dir: &str) -> bool {
    let mut from = 0;
    while let Some(at) = text[from..].find(dir) {
        let end = from + at + dir.len();
        let next = text[end..].chars().next();
        if !next.is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return true;
        }
        from = end;
    }
    false
}

/// 최근 도구 호출들이 가리킨 폴더들(dirs의 번호)에서, 세션이 지금 일하는 폴더를 고른다.
/// 최근 것 열두 번 가운데 과반이 한 폴더를 가리키면 그 폴더다. 근거가 셋도 안 되면 정하지 않는다
fn pick_workdir(refs: &[usize], count: usize) -> Option<usize> {
    let recent = &refs[refs.len().saturating_sub(12)..];
    if recent.len() < 3 {
        return None;
    }
    (0..count).map(|i| (i, recent.iter().filter(|r| **r == i).count())).max_by_key(|(_, n)| *n).filter(|(_, n)| n * 2 > recent.len()).map(|(i, _)| i)
}

/// 세션이 실제로 일하는 폴더와 그 브랜치. 세션을 연 폴더(cwd)와 다를 때만 돌려준다.
/// 세션이 중간에 같은 레포의 다른 워크트리로 옮겨 일하는 일이 있다(메인 폴더의 브랜치가 밖에서 바뀌었을 때 등).
/// 대화 기록 끝의 도구 호출(파일 경로, 명령)이 어느 워크트리를 가리키는지 세어서 정한다
#[tauri::command(async)]
pub fn session_workdir(session_id: String, cwd: String) -> Option<(String, String)> {
    let listing = std::process::Command::new("git").args(["-C", &cwd, "worktree", "list", "--porcelain"]).output().ok()?;
    let mut trees: Vec<(String, String)> = Vec::new();
    let mut at = String::new();
    for line in String::from_utf8_lossy(&listing.stdout).lines() {
        if let Some(dir) = line.strip_prefix("worktree ") {
            at = dir.to_owned();
        } else if let Some(name) = line.strip_prefix("branch refs/heads/") {
            trees.push((at.clone(), name.to_owned()));
        }
    }
    if trees.len() < 2 {
        return None;
    }
    let projects = home().join(".claude/projects");
    let path = fs::read_dir(projects).ok()?.flatten().map(|project| project.path().join(format!("{session_id}.jsonl"))).find(|path| path.is_file())?;
    let size = fs::metadata(&path).ok()?.len();
    let tail = read_range(&path, size.saturating_sub(TAIL_BYTES), TAIL_BYTES)?;
    let mut refs: Vec<usize> = Vec::new();
    for line in tail.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" || v["isSidechain"] == true {
            continue;
        }
        for part in v["message"]["content"].as_array().into_iter().flatten().filter(|p| p["type"] == "tool_use") {
            let input = &part["input"];
            let text = ["file_path", "path", "notebook_path", "command"].iter().filter_map(|k| input[*k].as_str()).collect::<Vec<_>>().join("\n");
            // 가장 긴 경로가 맞는 폴더가 그 호출이 가리킨 곳이다
            if let Some((i, _)) = trees.iter().enumerate().filter(|(_, (dir, _))| mentions(&text, dir)).max_by_key(|(_, (dir, _))| dir.len()) {
                refs.push(i);
            }
        }
    }
    let (dir, branch) = &trees[pick_workdir(&refs, trees.len())?];
    if dir.trim_end_matches('/') == cwd.trim_end_matches('/') { None } else { Some((dir.clone(), branch.clone())) }
}

#[cfg(test)]
mod workdir_tests {
    use super::*;

    #[test]
    fn mentions_respects_folder_boundaries() {
        assert!(mentions("git -C /a/repo-t75 status", "/a/repo-t75"));
        assert!(mentions("/a/repo-t75/src/x.kt", "/a/repo-t75"));
        assert!(!mentions("/a/repo-t75/src/x.kt", "/a/repo"), "앞부분만 같은 다른 폴더는 아니다");
        assert!(mentions("cd /a/repo && ls", "/a/repo"));
    }

    #[test]
    fn picks_the_folder_most_recent_calls_point_at() {
        assert_eq!(pick_workdir(&[0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 2), Some(1), "최근 호출이 워크트리를 가리킨다");
        assert_eq!(pick_workdir(&[1, 0, 1, 0], 2), None, "반반이면 정하지 않는다");
        assert_eq!(pick_workdir(&[1, 1], 2), None, "근거가 적으면 정하지 않는다");
    }
}
