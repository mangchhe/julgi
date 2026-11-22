//! 스킬이 실제로 얼마나 쓰이는지 센다. 판단의 바탕은 숫자여야 한다.
//! 쓰임은 Claude Code의 대화 기록에서 Skill 도구를 부른 줄을 찾아 세고, 파일마다 결과를 적어 둬 다시 읽지 않는다.
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// 스킬을 한 번 부른 기록
#[derive(Serialize, Deserialize, Clone)]
pub struct Use {
    skill: String,
    session: String,
    /// 부른 때 (대화 기록의 timestamp 그대로)
    at: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    mtime: u64,
    size: u64,
    uses: Vec<Use>,
}

/// 줄에서 `"key":"` 뒤의 값을 꺼낸다
fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let at = line.find(key)? + key.len();
    let rest = &line[at..];
    Some(&rest[..rest.find('"')?])
}

fn scan(path: &Path, session: &str) -> Vec<Use> {
    let Ok(text) = fs::read_to_string(path) else { return Vec::new() };
    let mut out = Vec::new();
    for line in text.lines() {
        // 도구를 부른 줄만 본다. 도구 결과나 사용자가 붙여 넣은 글에도 같은 글자가 있을 수 있다
        if !line.contains("\"type\":\"assistant\"") || !line.contains("\"name\":\"Skill\"") {
            continue;
        }
        let Some(tool) = line.find("\"name\":\"Skill\"") else { continue };
        let Some(skill) = field(&line[tool..], "\"skill\":\"") else { continue };
        out.push(Use { skill: skill.to_owned(), session: session.to_owned(), at: field(line, "\"timestamp\":\"").unwrap_or("").to_owned() });
    }
    out
}

/// 최근 `days`일 안에 바뀐 대화 기록에서 스킬을 부른 기록 전부
#[tauri::command(async)]
pub fn skill_usage(days: u64) -> Vec<Use> {
    let cache_path = home().join(".julgi/skill-usage.json");
    let mut cache: HashMap<String, Seen> = fs::read_to_string(&cache_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let cutoff = SystemTime::now() - Duration::from_secs(days * 86400);
    let mut next: HashMap<String, Seen> = HashMap::new();
    let mut out = Vec::new();
    for project in fs::read_dir(home().join(".claude/projects")).into_iter().flatten().flatten() {
        for entry in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let Ok(modified) = meta.modified() else { continue };
            if modified < cutoff {
                continue;
            }
            let mtime = modified.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let key = path.to_string_lossy().into_owned();
            let session = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_owned();
            let seen = match cache.remove(&key) {
                Some(seen) if seen.mtime == mtime && seen.size == meta.len() => seen,
                _ => Seen { mtime, size: meta.len(), uses: scan(&path, &session) },
            };
            out.extend(seen.uses.iter().cloned());
            next.insert(key, seen);
        }
    }
    if let Ok(json) = serde_json::to_string(&next) {
        let _ = fs::write(cache_path, json);
    }
    out
}

/// 깔려 있는 스킬 하나
#[derive(Serialize)]
pub struct Skill {
    name: String,
    /// 어디에 있는 스킬인가: "내 스킬"(~/.claude/skills), "Julgi"(Julgi가 얹는 것), "Julgi가 만듦"(~/.julgi/skills)
    source: String,
    description: String,
    /// SKILL.md를 마지막으로 고친 때 (초)
    modified: u64,
    path: String,
    /// 다른 곳의 폴더를 링크로 건 것인가. 주인이 따로 있으니 고치지 않는다
    linked: bool,
}

#[tauri::command(async)]
pub fn skills_list() -> Vec<Skill> {
    let mut out = Vec::new();
    for (dir, source) in [(".claude/skills", "내 스킬"), (".julgi/plugin/skills", "Julgi"), (".julgi/grown/skills", "Julgi가 만듦")] {
        for entry in fs::read_dir(home().join(dir)).into_iter().flatten().flatten() {
            let file = entry.path().join("SKILL.md");
            let Ok(text) = fs::read_to_string(&file) else { continue };
            let description = text.lines().find_map(|l| l.strip_prefix("description:")).unwrap_or("").trim().trim_matches('"').to_owned();
            let modified = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            out.push(Skill {
                name: entry.file_name().to_string_lossy().into_owned(),
                source: source.to_owned(),
                description,
                modified,
                path: file.to_string_lossy().into_owned(),
                linked: fs::symlink_metadata(entry.path()).map_or(false, |m| m.file_type().is_symlink()),
            });
        }
    }
    out
}

fn stamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn plain(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 다듬기 세션이 ~/.julgi/grown/revised/<이름>/SKILL.md 에 써 둔 글을 진짜 스킬 자리에 넣는다.
/// 옛 글은 ~/.julgi/skill-history/<이름>/<때>.md 에 남긴다. 돌려주는 값: 옛 글을 둔 곳.
/// 손대는 것은 Julgi가 만든 스킬과 ~/.claude/skills 의 진짜 폴더뿐이다 (링크로 건 것은 주인이 따로 있다)
#[tauri::command(async)]
pub fn skill_apply(name: String) -> Result<String, String> {
    if !plain(&name) {
        return Err("스킬 이름이 이상하다".into());
    }
    let revised = home().join(".julgi/grown/revised").join(&name).join("SKILL.md");
    let text = fs::read_to_string(&revised).map_err(|_| "고친 글이 없다".to_string())?;
    if !text.starts_with("---") || !text.contains(&format!("name: {name}")) {
        return Err("고친 글에 frontmatter(name)가 없다".into());
    }
    let dir = [".julgi/grown/skills", ".claude/skills"].iter().map(|d| home().join(d).join(&name)).find(|d| d.join("SKILL.md").is_file()).ok_or("그런 스킬이 없다")?;
    if fs::symlink_metadata(&dir).map_or(true, |m| m.file_type().is_symlink()) {
        return Err("링크로 건 스킬은 고치지 않는다".into());
    }
    let keep = home().join(".julgi/skill-history").join(&name);
    fs::create_dir_all(&keep).map_err(|e| e.to_string())?;
    let old = keep.join(format!("{}.md", stamp()));
    fs::copy(dir.join("SKILL.md"), &old).map_err(|e| e.to_string())?;
    fs::write(dir.join("SKILL.md"), text).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(revised.parent().unwrap_or(Path::new("")));
    Ok(old.to_string_lossy().into_owned())
}

/// Julgi가 만든 스킬을 내린다: ~/.julgi/grown/retired 로 옮긴다. 지우지 않으니 되돌릴 수 있다
#[tauri::command(async)]
pub fn skill_retire(name: String) -> Result<String, String> {
    if !plain(&name) {
        return Err("스킬 이름이 이상하다".into());
    }
    let from = home().join(".julgi/grown/skills").join(&name);
    if !from.join("SKILL.md").is_file() {
        return Err("Julgi가 만든 스킬이 아니다".into());
    }
    let to = home().join(".julgi/grown/retired");
    fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    let to = to.join(format!("{name}-{}", stamp()));
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}
