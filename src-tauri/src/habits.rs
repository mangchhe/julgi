//! 나와 세션 사이를 센다: 세션이 얼마나 자주 묻고 끝나는지, 내가 승인만 하는 답이 얼마나 되는지,
//! 답이 나온 뒤 내가 돌아오기까지 얼마나 걸리는지, 얼마나 자주 끊는지.
//! Julgi가 손을 덜어 주는지를 판단하는 바탕이다. 대화 기록을 읽어 세고, 파일마다 결과를 적어 둬 다시 읽지 않는다.
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// 내가 한 번 말한 것. (때(초), 종류 0: 답 1: 끊음, 앞선 답이 나온 뒤 걸린 시간(초, 모르면 0), 앞선 답이 질문으로 끝났나, 승인만 한 말인가)
type Event = (u64, u8, u32, bool, bool);

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    mtime: u64,
    size: u64,
    events: Vec<Event>,
}

/// "2026-11-22T08:09:33.123Z" → 초
fn seconds(stamp: &str) -> Option<u64> {
    let num = |range: std::ops::Range<usize>| stamp.get(range)?.parse::<i64>().ok();
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, min, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    // 날짜를 1970-01-01부터의 날 수로 (Howard Hinnant의 days_from_civil)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    u64::try_from(days * 86_400 + h * 3600 + min * 60 + s).ok()
}

/// 승인만 한 말인가: 짧고, "ㅇㅇ", "ㄱㄱ", "continue" 같은 말로 시작한다
fn approval(text: &str) -> bool {
    const STARTS: [&str; 16] = ["ㅇㅇ", "ㅇㅋ", "ㄱㄱ", "ㄱ", "continue", "계속", "진행", "네", "넵", "응", "좋아", "굳", "yes", "ok", "go", "y"];
    let text = text.trim().to_lowercase();
    text.chars().count() <= 14 && STARTS.iter().any(|s| text.starts_with(s))
}

fn scan(path: &Path) -> Vec<Event> {
    let Ok(text) = fs::read_to_string(path) else { return Vec::new() };
    let mut out = Vec::new();
    // 마지막으로 끝난 답: (때, 질문으로 끝났나)
    let mut answer: Option<(u64, bool)> = None;
    let mut first = true;
    for line in text.lines() {
        let user = line.contains("\"type\":\"user\"");
        if !user && !line.contains("\"type\":\"assistant\"") {
            continue;
        }
        let Ok(row) = serde_json::from_str::<Value>(line) else { continue };
        if row.get("isSidechain").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let Some(at) = row.get("timestamp").and_then(Value::as_str).and_then(seconds) else { continue };
        let content = row.get("message").and_then(|m| m.get("content"));
        let parts = content.and_then(Value::as_array);
        let has = |kind: &str| parts.is_some_and(|list| list.iter().any(|p| p.get("type").and_then(Value::as_str) == Some(kind)));
        let said = match (content.and_then(Value::as_str), parts) {
            (Some(s), _) => s.to_owned(),
            (_, Some(list)) => list.iter().filter(|p| p.get("type").and_then(Value::as_str) == Some("text")).filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" "),
            _ => String::new(),
        };
        let said = said.trim();
        match row.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                // 도구를 부르지 않고 글로 끝난 것이 답이다
                if !said.is_empty() && !has("tool_use") {
                    let tail: String = said.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect();
                    answer = Some((at, said.ends_with('?') || tail.contains("할까요") || tail.contains("까요?")));
                }
            }
            Some("user") => {
                if has("tool_result") || said.is_empty() {
                    continue;
                }
                if said.starts_with("[Request interrupted") {
                    out.push((at, 1, 0, false, false));
                    continue;
                }
                // 명령이나 시스템이 넣은 글은 내 말이 아니다
                if said.starts_with('<') {
                    continue;
                }
                // Julgi가 띄운 세션(일감, 스킬 만들기 같은 것)은 내 손이 아니다
                if first && said.starts_with("[Julgi") {
                    return Vec::new();
                }
                first = false;
                let (wait, asked) = match answer.take() {
                    Some((then, asked)) if at > then && at - then < 8 * 3600 => ((at - then) as u32, asked),
                    _ => (0, false),
                };
                out.push((at, 0, wait, asked, approval(said)));
            }
            _ => {}
        }
    }
    out
}

/// 최근 `days`일 안에 바뀐 대화 기록에서 내가 말한 것 전부
#[tauri::command(async)]
pub fn habits(days: u64) -> Vec<Event> {
    let cache_path = home().join(".julgi/habits.json");
    let mut cache: HashMap<String, Seen> = fs::read_to_string(&cache_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let cutoff = SystemTime::now() - Duration::from_secs(days * 86400);
    let since = cutoff.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
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
            let seen = match cache.remove(&key) {
                Some(seen) if seen.mtime == mtime && seen.size == meta.len() => seen,
                _ => Seen { mtime, size: meta.len(), events: scan(&path) },
            };
            out.extend(seen.events.iter().filter(|e| e.0 >= since).copied());
            next.insert(key, seen);
        }
    }
    if let Ok(json) = serde_json::to_string(&next) {
        let _ = fs::write(cache_path, json);
    }
    // 갈아탄 세션은 앞 대화를 통째로 물려받아 같은 말이 여러 파일에 있다. 같은 때의 같은 말은 한 번만 센다
    out.sort_unstable();
    out.dedup();
    out
}

/// 내가 세션의 방식을 바로잡은 말. (때(초), 세션, 폴더, 그 직전에 세션이 하던 것, 내가 한 말)
type Correction = (u64, String, String, String, String);

fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(max).collect()
}

/// 규칙으로 말하는 낱말이 들어 있는가. "앞으로", "하지 마", "왜 자꾸" 같은 말은 그 일만이 아니라 방식을 바로잡는 말일 때가 많다
fn rule_like(said: &str) -> bool {
    const WORDS: [&str; 26] = [
        "항상", "앞으로", "하지 마", "하지마", "하지말", "하지 말", "절대", "매번", "자꾸", "다시는", "말했잖", "했잖", "묻지 말", "묻지말", "되묻지", "물어보지", "넣지 마", "넣지마", "쓰지 마", "쓰지마",
        "always", "never ", "from now on", "stop ", "i told you", "don't ",
    ];
    let low = said.to_lowercase();
    WORDS.iter().any(|w| low.contains(w))
}

/// `since`(초) 뒤에 내가 세션의 방식을 바로잡은 말들: 세션을 끊고(Esc) 10분 안에 한 말과, 규칙으로 말하는 낱말이 든 짧은 말.
/// 어느 것이 정말 다음에도 지킬 것인지는 모델이 가린다. 여기서는 후보만 넓게 모은다
#[tauri::command(async)]
pub fn corrections(since: u64) -> Vec<Correction> {
    let cutoff = UNIX_EPOCH + Duration::from_secs(since);
    let mut out: Vec<Correction> = Vec::new();
    for project in fs::read_dir(home().join(".claude/projects")).into_iter().flatten().flatten() {
        for entry in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") || entry.metadata().and_then(|m| m.modified()).map_or(true, |m| m < cutoff) {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else { continue };
            let session = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_owned();
            let mut doing = String::new();
            let mut cut: Option<u64> = None;
            let mut first = true;
            for line in text.lines() {
                let user = line.contains("\"type\":\"user\"");
                if !user && !line.contains("\"type\":\"assistant\"") {
                    continue;
                }
                let Ok(row) = serde_json::from_str::<Value>(line) else { continue };
                if row.get("isSidechain").and_then(Value::as_bool).unwrap_or(false) {
                    continue;
                }
                let Some(at) = row.get("timestamp").and_then(Value::as_str).and_then(seconds) else { continue };
                let content = row.get("message").and_then(|m| m.get("content"));
                let parts = content.and_then(Value::as_array);
                if !user {
                    // 끊기 직전에 하던 것: 마지막 글이나 마지막으로 부른 도구
                    for part in parts.into_iter().flatten() {
                        match part.get("type").and_then(Value::as_str) {
                            Some("text") => doing = clip(part.get("text").and_then(Value::as_str).unwrap_or(""), 240),
                            Some("tool_use") => doing = format!("{} {}", part.get("name").and_then(Value::as_str).unwrap_or(""), clip(&part.get("input").map(Value::to_string).unwrap_or_default(), 200)),
                            _ => {}
                        }
                    }
                    continue;
                }
                if parts.is_some_and(|list| list.iter().any(|p| p.get("type").and_then(Value::as_str) == Some("tool_result"))) {
                    continue;
                }
                let said = match (content.and_then(Value::as_str), parts) {
                    (Some(s), _) => s.to_owned(),
                    (_, Some(list)) => list.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" "),
                    _ => String::new(),
                };
                let said = said.trim();
                if said.starts_with("[Request interrupted") {
                    cut = Some(at);
                    continue;
                }
                if said.is_empty() || said.starts_with('<') || said.starts_with("This session is being continued") || row.get("isMeta").and_then(Value::as_bool).unwrap_or(false) || row.get("isCompactSummary").and_then(Value::as_bool).unwrap_or(false) {
                    continue;
                }
                if first && said.starts_with("[Julgi") {
                    break;
                }
                first = false;
                let after_cut = cut.take().is_some_and(|then| at - then < 600);
                {
                    if at >= since && (after_cut || (said.chars().count() < 600 && rule_like(said))) {
                        let cwd = row.get("cwd").and_then(Value::as_str).unwrap_or("").to_owned();
                        out.push((at, session.clone(), cwd, doing.clone(), clip(said, 500)));
                    }
                }
            }
        }
    }
    // 갈아탄 세션은 앞 대화를 물려받는다. 같은 때의 같은 말은 한 번만
    out.sort_by(|a, b| (a.0, &a.4).cmp(&(b.0, &b.4)));
    out.dedup_by(|a, b| a.0 == b.0 && a.4 == b.4);
    out
}
