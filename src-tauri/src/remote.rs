//! 폰에서 보기. Julgi가 작은 웹 화면을 띄워, 밖에서도 내 차례인 세션에 답하고 새 일을 던질 수 있게 한다.
//! 폰에서 하는 일은 넷이다: 무엇이 도는지 보기, 묻는 말에 답하기, 새 일 던지기, 세션의 터미널을 실시간으로 보고 키 누르기.
//! 받는 곳은 Tailscale 망(100.64.0.0/10)과 이 맥 자신뿐이고, 그 안에서도 주소에 든 토큰이 맞아야 한다.
//! 화면에 보일 상태는 앱이 주기적으로 넘겨 주고(remote_publish), 폰이 시킨 일은 세션들이 쓰는 것과 같은 inbox에 적어 앱이 처리한다.
use crate::lang::say;
use tauri::Emitter;

use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::IpAddr,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{sync_channel, RecvTimeoutError, SyncSender},
        LazyLock, Mutex, OnceLock,
    },
    time::Duration,
};

use tiny_http::{Header, Method, Response, Server};

static STATE: Mutex<String> = Mutex::new(String::new());
static ON: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<u16> = OnceLock::new();

/// 터미널 하나를 폰으로 흘려보내는 자리: 지금 보고 있는 폰들
#[derive(Default)]
struct Tap {
    viewers: Vec<(u64, SyncSender<Vec<u8>>)>,
}

static TAPS: LazyLock<Mutex<HashMap<u32, Tap>>> = LazyLock::new(Default::default);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);

pub fn attach(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

/// 터미널이 찍은 글자를 보고 있는 폰들에 넘긴다. 받는 쪽이 밀리면(느린 망) 그 폰은 끊고, 폰이 다시 붙어 새로 그린다
pub fn feed(id: u32, bytes: &[u8]) {
    if let Ok(mut taps) = TAPS.lock() {
        if let Some(tap) = taps.get_mut(&id).filter(|tap| !tap.viewers.is_empty()) {
            tap.viewers.retain(|(_, to)| to.try_send(bytes.to_vec()).is_ok());
        }
    }
}

/// 터미널이 떴거나 맥에서 크기를 바꾸려 한다. 돌려주는 값: 그 크기를 적용해도 되는가 (폰이 보는 중이면 아니다)
pub fn sized(id: u32) -> bool {
    TAPS.lock().map_or(true, |mut taps| taps.entry(id).or_default().viewers.is_empty())
}

/// 터미널이 끝났다. 보던 폰에 알리고 끊는다
pub fn gone(id: u32) {
    if let Some(tap) = TAPS.lock().ok().and_then(|mut taps| taps.remove(&id)) {
        for (_, to) in tap.viewers {
            let _ = to.try_send(b"\x1b]7777;gone\x07".to_vec());
        }
    }
}

/// 맥에서 Julgi를 다시 쓰기 시작했다. 보던 폰을 모두 끊어 터미널 크기를 맥에 돌려준다
#[tauri::command]
pub fn remote_reclaim() {
    if let Ok(mut taps) = TAPS.lock() {
        for tap in taps.values_mut() {
            for (_, to) in tap.viewers.drain(..) {
                let _ = to.try_send(b"\x1b]7777;mac\x07".to_vec());
            }
        }
    }
}

/// 폰 하나에 터미널을 흘려보낸다. 터미널 크기를 폰에 맞추면 Claude Code가 그 폭으로 화면을 새로 그리고, 그것이 폰의 첫 화면이 된다.
/// 폰이 나가면(끊김, 맥이 되찾음, 터미널 끝) 마지막 폰일 때 맥 크기로 되돌린다
fn stream(request: tiny_http::Request, id: u32, cols: u16, rows: u16) {
    let (to, from) = sync_channel::<Vec<u8>>(512);
    let me = NEXT.fetch_add(1, Ordering::Relaxed);
    let known = TAPS.lock().ok().is_some_and(|mut taps| taps.get_mut(&id).map(|tap| tap.viewers.push((me, to))).is_some());
    if !known {
        let _ = request.respond(json("{\"error\":\"no terminal\"}".into(), 404));
        return;
    }
    let mut out = request.into_writer();
    let mut alive = out.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nCache-Control: no-store\r\nX-Accel-Buffering: no\r\nConnection: close\r\n\r\n").and_then(|_| out.flush()).is_ok();
    if let Some(app) = APP.get() {
        // 맥의 터미널이 먼저 같은 폭이 되어야 한다. 폭이 다른 채로 프로그램이 다시 그리면 맥 화면의 글자가 겹친다
        let _ = app.emit("pty-held", (id, cols, rows));
        std::thread::sleep(Duration::from_millis(250));
        // 크기가 같으면 새로 그리지 않으니 한 줄 줄였다 맞춘다
        crate::pty_size(app, id, cols, rows.saturating_sub(1).max(2));
        crate::pty_size(app, id, cols, rows);
    }
    while alive {
        alive = match from.recv_timeout(Duration::from_secs(5)) {
            Ok(mut bytes) => {
                while let Ok(more) = from.try_recv() {
                    bytes.extend(more);
                }
                out.write_all(&bytes).and_then(|_| out.flush()).is_ok()
            }
            // 조용할 때도 폰이 살아 있는지 알아야 크기를 되돌릴 수 있다
            Err(RecvTimeoutError::Timeout) => out.write_all(b"\x1b]7777;ok\x07").and_then(|_| out.flush()).is_ok(),
            Err(RecvTimeoutError::Disconnected) => false,
        };
    }
    let last = TAPS.lock().ok().is_some_and(|mut taps| {
        taps.get_mut(&id).is_some_and(|tap| {
            tap.viewers.retain(|(who, _)| *who != me);
            tap.viewers.is_empty()
        })
    });
    // 마지막 폰이 나갔다. 맥의 터미널이 제 크기로 돌아가며 프로그램의 크기도 되돌린다 (terms.free)
    if let (true, Some(app)) = (last, APP.get()) {
        let _ = app.emit("pty-freed", id);
    }
}

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
        // 앱 아이콘과 빈 화면의 그림. 정보가 없어 토큰 없이 준다 (홈 화면에 추가할 때 폰이 토큰 없이 받아 간다)
        if path == "/icon.png" || path == "/mascot.png" {
            let bytes: &[u8] = if path == "/icon.png" { include_bytes!("../assets/remote-icon.png") } else { include_bytes!("../assets/remote-mascot.png") };
            let _ = request.respond(Response::from_data(bytes).with_header(Header::from_bytes("Content-Type", "image/png").unwrap()).with_header(Header::from_bytes("Cache-Control", "max-age=86400").unwrap()));
            continue;
        }
        let given = request.headers().iter().find(|h| h.field.equiv("x-julgi-token")).map(|h| h.value.as_str().to_owned()).or_else(|| param(&url, "t").map(str::to_owned));
        if given.as_deref() != Some(token.as_str()) {
            let _ = request.respond(json("{\"error\":\"token\"}".into(), 401));
            continue;
        }
        // 터미널 보기는 연결을 붙든 채 계속 보내니 따로 돌린다
        if path == "/api/term" {
            let num = |key: &str| param(&url, key).and_then(|v| v.parse::<u32>().ok());
            match (num("pty"), num("cols"), num("rows")) {
                (Some(id), Some(cols @ 20..=300), Some(rows @ 5..=200)) => drop(std::thread::spawn(move || stream(request, id, cols as u16, rows as u16))),
                _ => drop(request.respond(json("{\"error\":\"size\"}".into(), 400))),
            }
            continue;
        }
        if path == "/xterm.js" || path == "/xterm.css" || path == "/unicode11.js" {
            let (body, kind) = match path {
                "/xterm.js" => (include_str!("../../node_modules/@xterm/xterm/lib/xterm.js"), "text/javascript"),
                "/unicode11.js" => (include_str!("../../node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js"), "text/javascript"),
                _ => (include_str!("../../node_modules/@xterm/xterm/css/xterm.css"), "text/css"),
            };
            let _ = request.respond(Response::from_string(body).with_header(Header::from_bytes("Content-Type", kind).unwrap()).with_header(Header::from_bytes("Cache-Control", "max-age=86400").unwrap()));
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
            (Method::Get, "/api/steps") => {
                let id = param(&url, "id").unwrap_or("");
                let steps = if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { crate::ledger::steps(id) } else { Vec::new() };
                json(serde_json::json!({ "steps": steps }).to_string(), 200)
            }
            // 폰에서 누른 키. 지금 폰이 보고 있는 터미널에만 넣는다
            (Method::Post, "/api/keys") => {
                let mut body = String::new();
                let _ = request.as_reader().take(40_000).read_to_string(&mut body);
                let value: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                let id = value["pty"].as_u64().unwrap_or(0) as u32;
                let watched = TAPS.lock().ok().is_some_and(|taps| taps.get(&id).is_some_and(|tap| !tap.viewers.is_empty()));
                let ok = watched && APP.get().is_some_and(|app| crate::pty_type(app, id, value["data"].as_str().unwrap_or("").as_bytes()));
                json(format!("{{\"ok\":{ok}}}"), if ok { 200 } else { 409 })
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
        let server = Server::http(("0.0.0.0", port)).map_err(|e| say(&format!("{port}번 포트를 열지 못했다: {e}"), &format!("Could not open port {port}: {e}")))?;
        let _ = STARTED.set(port);
        let held = token.clone();
        std::thread::spawn(move || serve(server, held));
    }
    ON.store(true, Ordering::Relaxed);
    let port = *STARTED.get().unwrap_or(&port);
    Ok(match tailnet_ip() {
        Some(ip) => format!("http://{}:{port}/?t={token}", tailnet_name().unwrap_or(ip)),
        None => say(&format!("Tailscale이 꺼져 있다. 켜면 여기에 주소가 나온다 (이 맥에서는 http://127.0.0.1:{port}/?t={token})"), &format!("Tailscale is off. Turn it on and the address appears here (on this Mac: http://127.0.0.1:{port}/?t={token})")),
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
