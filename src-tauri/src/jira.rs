//! Jira 티켓을 Julgi 안에서 본다. Jira REST를 직접 부른다(Cloud는 v3, Server/Data Center는 v2).
//! 토큰은 macOS 키체인에만 둔다. 명령줄 인자에 실리지 않게 키체인에는 `security -i`의 표준 입력으로,
//! HTTP에는 curl 설정을 표준 입력으로 넘긴다. 화면에는 토큰을 돌려주지 않는다.

use crate::lang::say;
use std::{
    io::Write,
    process::{Command, Stdio},
};

use serde::Deserialize;
use serde_json::{json, Value};

const SERVICE: &str = "julgi-jira";

/// 화면이 매번 넘기는 연결 정보 (비밀이 아닌 것만). 토큰은 사이트 주소로 키체인에서 꺼낸다
#[derive(Deserialize)]
pub struct Conn {
    site: String,
    email: String,
    /// "cloud" 또는 "server"
    kind: String,
}

fn check_site(site: &str) -> Result<(), String> {
    let ok = site.starts_with("https://") && site.len() > 8 && !site.chars().any(|c| c.is_whitespace() || "\"'\\<>".contains(c));
    if ok { Ok(()) } else { Err(say("사이트 주소는 https://로 시작해야 한다", "The site address must start with https://")) }
}

fn check_key(key: &str) -> Result<(), String> {
    let (p, n) = key.split_once('-').ok_or_else(|| say("티켓 키가 이상하다", "Invalid ticket key"))?;
    let ok = !p.is_empty() && p.chars().next().is_some_and(|c| c.is_ascii_uppercase()) && p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') && !n.is_empty() && n.chars().all(|c| c.is_ascii_digit());
    if ok { Ok(()) } else { Err(say(&format!("티켓 키가 이상하다: {key}"), &format!("Invalid ticket key: {key}"))) }
}

fn token(site: &str) -> Option<String> {
    let out = Command::new("security").args(["find-generic-password", "-s", SERVICE, "-a", site, "-w"]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned()).filter(|t| !t.is_empty())
}

/// 키체인에 넣는다. `security -i`가 표준 입력에서 명령을 읽으므로 토큰이 프로세스 목록에 보이지 않는다
fn save_token(site: &str, token: &str) -> Result<(), String> {
    if token.chars().any(|c| c == '"' || c == '\\' || c.is_whitespace()) {
        return Err(say("토큰에 쓸 수 없는 글자가 있다", "The token contains a character that is not allowed"));
    }
    let mut child = Command::new("security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        writeln!(stdin, "add-generic-password -U -s {SERVICE} -a \"{site}\" -w \"{token}\"").map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err({ let why = String::from_utf8_lossy(&out.stderr); let why = why.trim(); say(&format!("키체인에 넣지 못했다: {why}"), &format!("Could not save to the keychain: {why}")) }) }
}

fn b64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for i in 0..4 {
            out.push(if i <= chunk.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn auth(conn: &Conn, token: &str) -> String {
    if conn.kind == "server" { format!("Bearer {token}") } else { format!("Basic {}", b64(format!("{}:{token}", conn.email).as_bytes())) }
}

fn base(conn: &Conn) -> String {
    format!("{}/rest/api/{}", conn.site.trim_end_matches('/'), if conn.kind == "server" { 2 } else { 3 })
}

/// HTTP 한 번. 헤더(토큰 포함)와 본문은 curl 설정으로 표준 입력에 싣는다
fn call_with(conn: &Conn, token: &str, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    check_site(&conn.site)?;
    let url = format!("{}{path}", base(conn));
    let mut child = Command::new("curl")
        .args(["-sS", "-m", "20", "-K", "-", "-w", "\n%{http_code}"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let quote = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        let mut cfg = format!(
            "url = \"{}\"\nrequest = \"{method}\"\nheader = \"Authorization: {}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/json\"\n",
            quote(&url),
            auth(conn, token)
        );
        if let Some(b) = body {
            cfg.push_str(&format!("data-binary = \"{}\"\n", quote(&b.to_string())));
        }
        stdin.write_all(cfg.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (body, code) = text.rsplit_once('\n').unwrap_or(("", &text));
    let code: u16 = code.trim().parse().unwrap_or(0);
    if code == 0 {
        return Err({ let why = String::from_utf8_lossy(&out.stderr); let why = why.trim(); say(&format!("Jira에 닿지 못했다: {why}"), &format!("Could not reach Jira: {why}")) });
    }
    let v: Value = if body.trim().is_empty() { Value::Null } else { serde_json::from_str(body).unwrap_or_else(|_| json!({ "raw": body })) };
    if code >= 400 {
        let msg = v["errorMessages"].as_array().and_then(|a| a.first()).and_then(|m| m.as_str()).map(str::to_owned).or_else(|| v["message"].as_str().map(str::to_owned)).unwrap_or_default();
        return Err(match code {
            401 => say("Jira 토큰이 맞지 않거나 만료됐다 (401)", "The Jira token is wrong or expired (401)"),
            403 => say(&format!("권한이 없다 (403) {msg}"), &format!("Permission denied (403) {msg}")),
            404 => say(&format!("찾지 못했다 (404) {msg}"), &format!("Not found (404) {msg}")),
            _ => say(&format!("Jira 오류 {code} {msg}"), &format!("Jira error {code} {msg}")),
        });
    }
    Ok(v)
}

fn call(conn: &Conn, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let t = token(&conn.site).ok_or_else(|| say("Jira에 연결돼 있지 않다", "Jira is not connected"))?;
    call_with(conn, &t, method, path, body)
}

fn s(v: &Value, p: &str) -> String {
    v.pointer(p).and_then(|x| x.as_str()).unwrap_or("").to_owned()
}

/// 나를 가리키는 값: Cloud는 accountId, Server는 name
fn me_id(me: &Value) -> String {
    me["accountId"].as_str().or_else(|| me["name"].as_str()).unwrap_or("").to_owned()
}
fn author_id(a: &Value) -> String {
    a["accountId"].as_str().or_else(|| a["name"].as_str()).unwrap_or("").to_owned()
}

/// 연결: 받은 토큰으로 /myself가 되는지 본 뒤에만 키체인에 넣는다. 돌려주는 값은 표시 이름
#[tauri::command(async)]
pub fn jira_connect(site: String, email: String, token: String, kind: String) -> Result<String, String> {
    check_site(&site)?;
    let conn = Conn { site: site.trim_end_matches('/').to_owned(), email, kind };
    let me = call_with(&conn, token.trim(), "GET", "/myself", None)?;
    save_token(&conn.site, token.trim())?;
    Ok(s(&me, "/displayName"))
}

#[tauri::command(async)]
pub fn jira_disconnect(site: String) -> bool {
    Command::new("security").args(["delete-generic-password", "-s", SERVICE, "-a", site.trim_end_matches('/')]).output().is_ok_and(|o| o.status.success())
}

/// 연결 상태: 표시 이름 (연결이 안 됐거나 토큰이 틀리면 Err)
#[tauri::command(async)]
pub fn jira_me(conn: Conn) -> Result<String, String> {
    call(&conn, "GET", "/myself", None).map(|me| s(&me, "/displayName"))
}

fn issue_url(conn: &Conn, key: &str) -> String {
    format!("{}/browse/{key}", conn.site.trim_end_matches('/'))
}

/// 목록 한 줄 모양
fn row(conn: &Conn, it: &Value, me: &str) -> Value {
    let f = &it["fields"];
    let others = f["comment"]["comments"].as_array().map_or(0, |c| c.iter().filter(|c| author_id(&c["author"]) != me).count());
    json!({
        "key": s(it, "/key"),
        "url": issue_url(conn, &s(it, "/key")),
        "title": s(f, "/summary"),
        "status": s(f, "/status/name"),
        "statusCategory": s(f, "/status/statusCategory/key"),
        "type": s(f, "/issuetype/name"),
        "priority": s(f, "/priority/name"),
        "assignee": s(f, "/assignee/displayName"),
        "assigneeId": author_id(&f["assignee"]),
        "updated": s(f, "/updated"),
        "others": others,
    })
}

fn search_raw(conn: &Conn, jql: &str, limit: u32, comments: bool) -> Result<Vec<Value>, String> {
    let mut fields = vec!["summary", "status", "issuetype", "priority", "assignee", "updated"];
    if comments {
        fields.push("comment");
    }
    let body = json!({ "jql": jql, "maxResults": limit.min(100), "fields": fields });
    let path = if conn.kind == "server" { "/search" } else { "/search/jql" };
    let v = call(conn, "POST", path, Some(&body))?;
    Ok(v["issues"].as_array().cloned().unwrap_or_default())
}

/// JQL 검색
#[tauri::command(async)]
pub fn jira_search(conn: Conn, jql: String, limit: u32) -> Result<Vec<Value>, String> {
    Ok(search_raw(&conn, &jql, limit, false)?.iter().map(|it| row(&conn, it, "")).collect())
}

/// 나한테 배정된 안 끝난 티켓. 감시용이라 남이 쓴 코멘트 수를 같이 센다
#[tauri::command(async)]
pub fn jira_mine(conn: Conn) -> Result<Vec<Value>, String> {
    let me = me_id(&call(&conn, "GET", "/myself", None)?);
    let list = search_raw(&conn, "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", 50, true)?;
    Ok(list.iter().map(|it| row(&conn, it, &me)).collect())
}

/// 볼 수 있는 프로젝트 키. 터미널에서 티켓 키를 알아볼 때 쓴다(UTF-8 같은 오탐을 막는다)
#[tauri::command(async)]
pub fn jira_projects(conn: Conn) -> Result<Vec<String>, String> {
    let v = if conn.kind == "server" { call(&conn, "GET", "/project", None)? } else { call(&conn, "GET", "/project/search?maxResults=100", None)?["values"].clone() };
    Ok(v.as_array().into_iter().flatten().filter_map(|p| p["key"].as_str().map(str::to_owned)).collect())
}

/// 이 Jira에 있는 상태 이름들. 설정에서 "옮길 상태"를 글로 치지 않고 고르게 하려고 읽는다
#[tauri::command(async)]
pub fn jira_statuses(conn: Conn) -> Result<Vec<String>, String> {
    let v = call(&conn, "GET", "/status", None)?;
    let mut names: Vec<String> = v.as_array().into_iter().flatten().filter_map(|s| s["name"].as_str().map(str::to_owned)).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// 티켓 한 건. 설명과 코멘트 본문은 Cloud면 ADF(JSON), Server면 위키 글 그대로 넘긴다(화면에서 마크다운으로 바꾼다)
#[tauri::command(async)]
pub fn jira_view(conn: Conn, key: String) -> Result<Value, String> {
    check_key(&key)?;
    let v = call(&conn, "GET", &format!("/issue/{key}?expand=names"), None)?;
    let f = &v["fields"];
    // 스프린트 필드는 사이트마다 id가 달라 이름표(names)에서 찾는다
    let sprint_field = v["names"].as_object().and_then(|m| m.iter().find(|(_, n)| n.as_str() == Some("Sprint")).map(|(k, _)| k.clone()));
    let sprint = sprint_field.and_then(|k| f[&k].as_array().and_then(|a| a.last()).map(|sp| sp["name"].as_str().map(str::to_owned).unwrap_or_else(|| sp.as_str().unwrap_or("").to_owned()))).unwrap_or_default();
    let comments: Vec<Value> = f["comment"]["comments"].as_array().into_iter().flatten().map(|c| json!({ "who": s(c, "/author/displayName"), "at": s(c, "/created"), "body": c["body"] })).collect();
    let subtasks: Vec<Value> = f["subtasks"].as_array().into_iter().flatten().map(|t| json!({ "key": s(t, "/key"), "title": s(t, "/fields/summary"), "status": s(t, "/fields/status/name"), "statusCategory": s(t, "/fields/status/statusCategory/key") })).collect();
    Ok(json!({
        "key": key,
        "url": issue_url(&conn, &key),
        "title": s(f, "/summary"),
        "status": s(f, "/status/name"),
        "statusCategory": s(f, "/status/statusCategory/key"),
        "type": s(f, "/issuetype/name"),
        "priority": s(f, "/priority/name"),
        "assignee": s(f, "/assignee/displayName"),
        "reporter": s(f, "/reporter/displayName"),
        "sprint": sprint,
        "parent": s(f, "/parent/key"),
        "description": f["description"],
        "subtasks": subtasks,
        "comments": comments,
        "updated": s(f, "/updated"),
    }))
}

/// 지금 고를 수 있는 전환
#[tauri::command(async)]
pub fn jira_transitions(conn: Conn, key: String) -> Result<Vec<Value>, String> {
    check_key(&key)?;
    let v = call(&conn, "GET", &format!("/issue/{key}/transitions"), None)?;
    Ok(v["transitions"].as_array().into_iter().flatten().map(|t| json!({ "id": s(t, "/id"), "name": s(t, "/name"), "to": s(t, "/to/name"), "category": s(t, "/to/statusCategory/key") })).collect())
}

/// 글을 Jira 본문으로: Cloud는 ADF(줄마다 문단), Server는 글 그대로
fn body_of(conn: &Conn, text: &str) -> Value {
    if conn.kind == "server" {
        return json!(text);
    }
    let paras: Vec<Value> = text.split('\n').map(|line| if line.is_empty() { json!({ "type": "paragraph", "content": [] }) } else { json!({ "type": "paragraph", "content": [{ "type": "text", "text": line }] }) }).collect();
    json!({ "type": "doc", "version": 1, "content": paras })
}

#[tauri::command(async)]
pub fn jira_transition(conn: Conn, key: String, id: String, comment: String) -> Result<(), String> {
    check_key(&key)?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(say("전환 id가 이상하다", "Invalid transition id"));
    }
    let mut body = json!({ "transition": { "id": id } });
    if !comment.trim().is_empty() {
        body["update"] = json!({ "comment": [{ "add": { "body": body_of(&conn, comment.trim()) } }] });
    }
    call(&conn, "POST", &format!("/issue/{key}/transitions"), Some(&body)).map(|_| ())
}

#[tauri::command(async)]
pub fn jira_comment(conn: Conn, key: String, body: String) -> Result<(), String> {
    check_key(&key)?;
    if body.trim().is_empty() {
        return Err(say("쓸 말이 비었다", "Nothing to post: the text is empty"));
    }
    call(&conn, "POST", &format!("/issue/{key}/comment"), Some(&json!({ "body": body_of(&conn, body.trim()) }))).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches() {
        assert_eq!(b64(b"me@example.com:tok"), "bWVAZXhhbXBsZS5jb206dG9r");
        assert_eq!(b64(b"a"), "YQ==");
        assert_eq!(b64(b"ab"), "YWI=");
    }

    #[test]
    fn keys_and_sites() {
        assert!(check_key("ABC-123").is_ok());
        assert!(check_key("A1_B-9").is_ok());
        assert!(check_key("abc-1").is_err());
        assert!(check_key("ABC-1; rm").is_err());
        assert!(check_site("https://x.atlassian.net").is_ok());
        assert!(check_site("http://x").is_err());
        assert!(check_site("https://x\" -o /tmp/y").is_err());
    }

    #[test]
    fn row_counts_others() {
        let conn = Conn { site: "https://x.atlassian.net".into(), email: "e".into(), kind: "cloud".into() };
        let it = json!({ "key": "ABC-1", "fields": { "summary": "t", "status": { "name": "In Progress", "statusCategory": { "key": "indeterminate" } },
            "comment": { "comments": [{ "author": { "accountId": "me" } }, { "author": { "accountId": "qa" } }] } } });
        let r = row(&conn, &it, "me");
        assert_eq!(r["others"], 1);
        assert_eq!(r["url"], "https://x.atlassian.net/browse/ABC-1");
        assert_eq!(r["statusCategory"], "indeterminate");
    }

    #[test]
    fn adf_body() {
        let conn = Conn { site: "https://x".into(), email: "e".into(), kind: "cloud".into() };
        let b = body_of(&conn, "a\n\nb");
        assert_eq!(b["content"].as_array().unwrap().len(), 3);
        let srv = Conn { site: "https://x".into(), email: "e".into(), kind: "server".into() };
        assert_eq!(body_of(&srv, "a"), json!("a"));
    }
}
