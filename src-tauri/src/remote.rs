//! 폰에서 보기. Julgi가 작은 웹 화면을 띄워, 밖에서도 내 차례인 세션에 답하고 새 일을 던질 수 있게 한다.
//! 터미널을 통째로 옮기지는 않는다. 폰에서 하는 일은 셋이다: 무엇이 도는지 보기, 묻는 말에 답하기, 새 일 던지기.
//! 받는 곳은 Tailscale 망(100.64.0.0/10)과 이 맥 자신뿐이고, 그 안에서도 주소에 든 토큰이 맞아야 한다.
//! 화면에 보일 상태는 앱이 주기적으로 넘겨 주고(remote_publish), 폰이 시킨 일은 세션들이 쓰는 것과 같은 inbox에 적어 앱이 처리한다.
use std::{
    fs,
    io::Read,
    net::IpAddr,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

use tiny_http::{Header, Method, Response, Server};

static STATE: Mutex<String> = Mutex::new(String::new());
static ON: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<u16> = OnceLock::new();

fn root() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".julgi")
}

/// 주소에 넣는 토큰. 처음 켤 때 한 번 만들어 ~/.julgi/remote-token 에 둔다. 지우면 새로 만든다
fn token() -> String {
    let path = root().join("remote-token");
    if let Ok(text) = fs::read_to_string(&path) {
        if text.trim().len() >= 24 {
            return text.trim().to_owned();
        }
    }
    let mut bytes = [0u8; 16];
    if let Ok(mut file) = fs::File::open("/dev/urandom") {
        let _ = file.read_exact(&mut bytes);
    }
    let made: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = fs::write(&path, &made);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    made
}

/// 이 맥의 Tailscale 주소. Tailscale이 꺼져 있거나 없으면 None
fn tailnet_ip() -> Option<String> {
    for bin in ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"] {
        let Ok(out) = Command::new(bin).args(["ip", "-4"]).output() else { continue };
        let text = String::from_utf8_lossy(&out.stdout);
        if let Some(ip) = text.lines().map(str::trim).find(|l| l.starts_with("100.") && l.parse::<IpAddr>().is_ok()) {
            return Some(ip.to_owned());
        }
    }
    None
}

/// 이 맥의 Tailscale 이름(예: macbook.tail1234.ts.net). 이름으로 찾기(MagicDNS)가 켜져 있을 때만 준다.
/// 숫자 주소보다 알아보기 쉽고, 주소가 바뀌어도 그대로다
fn tailnet_name() -> Option<String> {
    for bin in ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"] {
        let Ok(out) = Command::new(bin).args(["status", "--json"]).output() else { continue };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else { continue };
        if value.get("CurrentTailnet").and_then(|t| t.get("MagicDNSEnabled")).and_then(|v| v.as_bool()) != Some(true) {
            return None;
        }
        let name = value.get("Self")?.get("DNSName")?.as_str()?.trim_end_matches('.').to_owned();
        return (!name.is_empty()).then_some(name);
    }
    None
}

/// Tailscale 망(100.64.0.0/10)이나 이 맥 자신에게서 온 것인가
fn trusted(peer: Option<IpAddr>) -> bool {
    match peer {
        Some(IpAddr::V4(ip)) => ip.is_loopback() || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1])),
        Some(IpAddr::V6(ip)) => ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback() || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))),
        None => false,
    }
}

fn param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    url.split_once('?')?.1.split('&').find_map(|pair| pair.strip_prefix(key)?.strip_prefix('='))
}

fn json(body: String, code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body).with_status_code(code).with_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap()).with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
}

/// 폰이 시킨 일을 inbox에 적는다. 앱이 세션들의 요청과 같은 길로 처리한다
fn ask(cmd: &str, target: &str, body: &str) -> bool {
    let dir = root().join("inbox");
    let _ = fs::create_dir_all(&dir);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let file = dir.join(format!("{stamp}-phone"));
    let text = format!("{cmd}\nphone\n{}\n{body}\n", target.replace('\n', " "));
    fs::write(file.with_extension("tmp"), text).and_then(|_| fs::rename(file.with_extension("tmp"), file.with_extension("req"))).is_ok()
}

fn serve(server: Server, token: String) {
    for mut request in server.incoming_requests() {
        let url = request.url().to_owned();
        let path = url.split('?').next().unwrap_or("");
        if !ON.load(Ordering::Relaxed) || !trusted(request.remote_addr().map(|a| a.ip())) {
            let _ = request.respond(Response::from_string("").with_status_code(403));
            continue;
        }
        // 화면 자체에는 아무 정보도 없다. 정보와 명령은 토큰이 맞아야 한다
        if path == "/" {
            let page = Response::from_string(include_str!("../assets/remote.html")).with_header(Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap()).with_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
            let _ = request.respond(page);
            continue;
        }
        let given = request.headers().iter().find(|h| h.field.equiv("x-julgi-token")).map(|h| h.value.as_str().to_owned()).or_else(|| param(&url, "t").map(str::to_owned));
        if given.as_deref() != Some(token.as_str()) {
            let _ = request.respond(json("{\"error\":\"token\"}".into(), 401));
            continue;
        }
        let reply = match (request.method(), path) {
            (Method::Get, "/api/state") => json(STATE.lock().map(|s| if s.is_empty() { "{}".to_owned() } else { s.clone() }).unwrap_or_else(|_| "{}".into()), 200),
            (Method::Get, "/api/reply") => {
                let id = param(&url, "id").unwrap_or("");
                // 세션 id는 글자와 숫자와 하이픈뿐이다. 경로로 쓰이니 다른 글자는 받지 않는다
                let text = if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { crate::ledger::last_reply(id.to_owned()).unwrap_or_default() } else { String::new() };
                json(serde_json::json!({ "text": text }).to_string(), 200)
            }
            (Method::Post, "/api/answer") | (Method::Post, "/api/new") => {
                let mut body = String::new();
                let _ = request.as_reader().take(40_000).read_to_string(&mut body);
                let value: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                let target = value.get("target").and_then(|v| v.as_str()).unwrap_or("");
                let text = value.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
                if target.is_empty() || text.is_empty() {
                    json("{\"error\":\"empty\"}".into(), 400)
                } else {
                    let ok = ask(if path == "/api/answer" { "answer" } else { "throw" }, target, text);
                    json(format!("{{\"ok\":{ok}}}"), if ok { 200 } else { 500 })
                }
            }
            _ => json("{\"error\":\"not found\"}".into(), 404),
        };
        let _ = request.respond(reply);
    }
}

/// 폰용 화면을 켠다. 돌려주는 값: 폰에서 열 주소(토큰 포함). Tailscale이 꺼져 있으면 주소 자리에 안내가 들어간다
#[tauri::command(async)]
pub fn remote_start(port: u16) -> Result<String, String> {
    let token = token();
    if STARTED.get().is_none() {
        let server = Server::http(("0.0.0.0", port)).map_err(|e| format!("{port}번 포트를 열지 못했다: {e}"))?;
        let _ = STARTED.set(port);
        let held = token.clone();
        std::thread::spawn(move || serve(server, held));
    }
    ON.store(true, Ordering::Relaxed);
    let port = *STARTED.get().unwrap_or(&port);
    Ok(match tailnet_ip() {
        Some(ip) => format!("http://{}:{port}/?t={token}", tailnet_name().unwrap_or(ip)),
        None => format!("Tailscale이 꺼져 있다. 켜면 여기에 주소가 나온다 (이 맥에서는 http://127.0.0.1:{port}/?t={token})"),
    })
}

#[tauri::command]
pub fn remote_stop() {
    ON.store(false, Ordering::Relaxed);
}

/// 폰에 보여 줄 지금 상태. 앱이 몇 초마다 넘긴다
#[tauri::command]
pub fn remote_publish(state: String) {
    if let Ok(mut held) = STATE.lock() {
        *held = state;
    }
}
