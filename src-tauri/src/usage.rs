//! Claude 구독 사용량. Claude Code가 로그인하며 받아 둔 토큰으로 Anthropic의 사용량 주소를 불러, 5시간 창과 주간 한도를 얼마나 썼는지 받아 온다.
//! 토큰은 읽어서 Anthropic에만 보내고 어디에도 적지 않는다. 문서에 없는 주소라 언제든 바뀔 수 있으니, 안 되면 조용히 빈 값을 낸다.
//! 설정에서 켠 사람에게만 돈다.
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

use serde::Serialize;
use serde_json::Value;

/// 한도 하나: 이름("5시간", "주간", "주간 Fable"), 쓴 비율(%), 다시 차는 때(초, 모르면 0)
#[derive(Serialize)]
pub struct Limit {
    name: String,
    used: f64,
    resets: u64,
}

/// Claude Code의 로그인 토큰. macOS는 키체인에, 그 밖에는 ~/.claude/.credentials.json 에 있다
fn token() -> Option<String> {
    let text = Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .or_else(|| std::fs::read_to_string(PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".claude/.credentials.json")).ok())?;
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    value.get("claudeAiOauth")?.get("accessToken")?.as_str().map(str::to_owned)
}

#[tauri::command(async)]
pub fn claude_usage() -> Result<Vec<Limit>, String> {
    let token = token().ok_or("Claude Code의 로그인 정보를 읽지 못했다")?;
    // 토큰이 프로세스 목록에 보이지 않게 명령줄이 아니라 표준 입력으로 넘긴다
    let mut child = Command::new("curl")
        .args(["-s", "-m", "12", "-K", "-", "https://api.anthropic.com/api/oauth/usage"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = write!(stdin, "header = \"Authorization: Bearer {token}\"\nheader = \"anthropic-beta: oauth-2025-04-20\"\nheader = \"Accept: application/json\"\n");
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&out.stdout).map_err(|_| "사용량 답을 읽지 못했다".to_string())?;
    let Some(map) = value.as_object() else { return Err("사용량 답의 모양이 다르다".into()) };
    let mut limits = Vec::new();
    // 새 모양: limits 목록에 한도가 하나씩 들어 있다 (세션 창, 주간 전체, 모델별 주간)
    for item in map.get("limits").and_then(Value::as_array).into_iter().flatten() {
        let Some(used) = item.get("percent").and_then(Value::as_f64) else { continue };
        let scoped = item.get("scope").and_then(|s| s.get("model")).and_then(|m| m.get("display_name")).and_then(Value::as_str);
        let name = match (item.get("kind").and_then(Value::as_str).unwrap_or(""), scoped) {
            ("session", _) => "5시간".to_owned(),
            ("weekly_all", _) => "주간".to_owned(),
            (_, Some(model)) => format!("주간 {model}"),
            (kind, None) => kind.to_owned(),
        };
        let resets = item.get("resets_at").and_then(Value::as_str).and_then(crate::habits::seconds).unwrap_or(0);
        limits.push(Limit { name, used, resets });
    }
    if !limits.is_empty() {
        return Ok(limits);
    }
    // 옛 모양: five_hour, seven_day, seven_day_<모델> 순으로. 값이 없는 한도(null)는 건너뛴다
    let mut keys: Vec<&String> = map.keys().filter(|k| k.as_str() == "five_hour" || k.starts_with("seven_day")).collect();
    keys.sort_by_key(|k| (k.as_str() != "five_hour", k.len(), k.to_string()));
    for key in keys {
        let Some(used) = map[key].get("utilization").and_then(Value::as_f64) else { continue };
        let name = match key.as_str() {
            "five_hour" => "5시간".to_owned(),
            "seven_day" => "주간".to_owned(),
            other => {
                let model = other.trim_start_matches("seven_day_");
                let mut chars = model.chars();
                format!("주간 {}", chars.next().map_or(String::new(), |c| c.to_uppercase().collect::<String>() + chars.as_str()))
            }
        };
        let resets = map[key].get("resets_at").and_then(Value::as_str).and_then(crate::habits::seconds).unwrap_or(0);
        limits.push(Limit { name, used, resets });
    }
    if limits.is_empty() {
        return Err(value.get("error").map_or("사용량이 비어 있다".to_owned(), |e| e.to_string().chars().take(120).collect()));
    }
    Ok(limits)
}
