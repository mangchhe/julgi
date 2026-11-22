//! Claude Code 대화 기록(~/.claude/projects)에서 토큰 사용량을 모은다. 사용량 화면이 쓴다.
//! 기록은 수 GB라 매번 다 읽지 않는다. 파일마다 어디까지 읽었는지 기억해 두고 새로 붙은 줄만 읽는다.
//! 한 답이 여러 줄로 나뉘어 적히므로(같은 message.id) 마지막 줄의 사용량 하나만 센다.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Default)]
struct Rec {
    at: i64,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

#[derive(Default)]
struct FileState {
    offset: u64,
    cwd: String,
    /// message.id → 그 답의 사용량 (같은 답의 뒤 줄이 앞 줄을 덮는다)
    recs: HashMap<String, Rec>,
}

static CACHE: Mutex<Option<HashMap<PathBuf, FileState>>> = Mutex::new(None);

/// 세션 · 날짜 · 모델마다 한 줄
#[derive(Serialize)]
pub struct UsageRow {
    session: String,
    cwd: String,
    /// 이 맥의 시간대로 센 날짜 (1970-01-01부터의 날 수)
    day: i64,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    /// 답 수
    turns: u32,
    /// 마지막 답 시각 (초)
    last: i64,
}

/// "2026-11-22T11:20:03.123Z" → 초. 기록의 시각은 늘 UTC(Z)다
fn epoch(ts: &str) -> Option<i64> {
    let b = ts.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |s: &str| s.parse::<i64>().ok();
    let (y, m, d) = (n(&ts[0..4])?, n(&ts[5..7])?, n(&ts[8..10])?);
    let (hh, mm, ss) = (n(&ts[11..13])?, n(&ts[14..16])?, n(&ts[17..19])?);
    // 날짜 → 1970년부터의 날 수 (Howard Hinnant의 days_from_civil)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hh * 3600 + mm * 60 + ss)
}

/// 한 줄을 읽어 답 하나면 (message.id, 사용량)을 준다
fn parse_line(line: &str, state: &mut FileState) {
    if state.cwd.is_empty() && line.contains("\"cwd\"") {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(cwd) = v["cwd"].as_str() {
                state.cwd = cwd.to_owned();
            }
        }
    }
    if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    if v["type"] != "assistant" {
        return;
    }
    let msg = &v["message"];
    let model = msg["model"].as_str().unwrap_or("");
    let Some(id) = msg["id"].as_str() else { return };
    if model.is_empty() || model.starts_with('<') {
        return; // <synthetic> 같은 것은 실제 호출이 아니다
    }
    let u = &msg["usage"];
    let num = |k: &str| u[k].as_u64().unwrap_or(0);
    let at = v["timestamp"].as_str().and_then(epoch).unwrap_or(0);
    state.recs.insert(
        id.to_owned(),
        Rec { at, model: model.to_owned(), input: num("input_tokens"), output: num("output_tokens"), cache_read: num("cache_read_input_tokens"), cache_write: num("cache_creation_input_tokens") },
    );
}

/// 파일에서 지난번 뒤로 붙은 완성된 줄만 읽는다. 쓰는 중인 마지막 줄은 다음번에 읽는다
fn read_new(path: &Path, state: &mut FileState) {
    let Ok(mut f) = fs::File::open(path) else { return };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < state.offset {
        *state = FileState::default(); // 파일이 줄었다(다시 쓰였다): 처음부터
    }
    if len == state.offset || f.seek(SeekFrom::Start(state.offset)).is_err() {
        return;
    }
    let mut buf = Vec::with_capacity((len - state.offset) as usize);
    if f.take(len - state.offset).read_to_end(&mut buf).is_err() {
        return;
    }
    let Some(end) = buf.iter().rposition(|&c| c == b'\n') else { return };
    for line in String::from_utf8_lossy(&buf[..=end]).lines() {
        parse_line(line, state);
    }
    state.offset += end as u64 + 1;
}

/// 살펴볼 기록 파일과 그 세션 ID. 서브에이전트 기록(세션/subagents/*.jsonl)은 부모 세션으로 센다
fn files(root: &Path, since: SystemTime) -> Vec<(PathBuf, String)> {
    let fresh = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).is_ok_and(|t| t >= since);
    let mut out = Vec::new();
    for project in fs::read_dir(root).into_iter().flatten().flatten() {
        for entry in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "jsonl") {
                if fresh(&path) {
                    let id = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
                    out.push((path, id));
                }
            } else if path.is_dir() {
                let id = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                for sub in fs::read_dir(path.join("subagents")).into_iter().flatten().flatten() {
                    let p = sub.path();
                    if p.extension().is_some_and(|e| e == "jsonl") && fresh(&p) {
                        out.push((p, id.clone()));
                    }
                }
            }
        }
    }
    out
}

/// 최근 days일의 사용량. tz_offset_min: 이 맥의 시간대(UTC보다 몇 분 빠른가). 날짜를 나눌 때 쓴다
#[tauri::command(async)]
pub fn token_usage(days: u32, tz_offset_min: i32) -> Vec<UsageRow> {
    let root = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude/projects");
    let now = SystemTime::now();
    let since = now - std::time::Duration::from_secs(days as u64 * 86_400);
    let cutoff = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64) - days as i64 * 86_400;
    let shift = tz_offset_min as i64 * 60;

    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    let mut rows: HashMap<(String, i64, String), UsageRow> = HashMap::new();
    for (path, session) in files(&root, since) {
        let state = cache.entry(path.clone()).or_default();
        read_new(&path, state);
        for rec in state.recs.values().filter(|r| r.at >= cutoff) {
            let day = (rec.at + shift).div_euclid(86_400);
            let row = rows.entry((session.clone(), day, rec.model.clone())).or_insert_with(|| UsageRow {
                session: session.clone(),
                cwd: state.cwd.clone(),
                day,
                model: rec.model.clone(),
                input: 0,
                output: 0,
                cache_read: 0,
                cache_write: 0,
                turns: 0,
                last: 0,
            });
            row.input += rec.input;
            row.output += rec.output;
            row.cache_read += rec.cache_read;
            row.cache_write += rec.cache_write;
            row.turns += 1;
            row.last = row.last.max(rec.at);
        }
    }
    rows.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_parses_utc() {
        assert_eq!(epoch("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(epoch("2026-11-22T11:20:03.123Z"), Some(1_795_346_403));
        assert_eq!(epoch("bad"), None);
    }

    #[test]
    fn same_message_counts_once() {
        let mut s = FileState::default();
        let line = |out: u64| format!(r#"{{"type":"assistant","timestamp":"2026-11-22T11:20:03Z","cwd":"/w","message":{{"id":"m1","model":"claude-x","usage":{{"input_tokens":5,"output_tokens":{out},"cache_read_input_tokens":100,"cache_creation_input_tokens":7}}}}}}"#);
        parse_line(&line(1), &mut s);
        parse_line(&line(42), &mut s);
        assert_eq!(s.recs.len(), 1);
        assert_eq!(s.recs["m1"].output, 42);
        assert_eq!(s.cwd, "/w");
    }
}
