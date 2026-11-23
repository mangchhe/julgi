mod ci;
mod github;
mod gitlab;
mod habits;
mod jira;
mod lang;
mod ledger;
mod remote;
mod skills;
mod tokens;
mod usage;
mod work;

use lang::say;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::UNIX_EPOCH,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{
    ipc::{Channel, Response},
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct Ptys(Mutex<HashMap<u32, Session>>);

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into())).join(".julgi")
}

fn state_dir() -> PathBuf {
    data_dir().join("state")
}

/// 로그인 셸을 pty에 띄우고, 출력은 바이트 그대로 채널로 보낸다.
/// command가 있으면 셸 대신 그 명령을 로그인 셸 환경에서 돌린다 (끝나면 pty도 끝난다).
/// 한글이 읽기 경계에서 잘려도 xterm이 이어 붙이도록 문자열로 바꾸지 않는다.
#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<Ptys>,
    id: u32,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    command: Option<String>,
    strip_env: Option<Vec<String>>,
    fallback_dir: Option<String>,
    on_data: Channel<Response>,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // macOS의 터미널 앱들처럼 /usr/bin/login을 거쳐 셸을 띄운다. 그래야 터미널 안의 프로그램이
    // 보호된 폴더에 접근할 때 권한 확인이 이 앱 이름으로 제대로 뜬다.
    // -f 다시 인증하지 않음, -l 홈으로 옮기지 않음, -p 환경 유지, -q 안내문 생략
    let user = std::env::var("USER").unwrap_or_default();
    let mut cmd = if cfg!(target_os = "macos") && !user.is_empty() && std::path::Path::new("/usr/bin/login").exists() {
        let mut cmd = CommandBuilder::new("/usr/bin/login");
        cmd.args(["-flpq", &user, "/bin/bash", "--noprofile", "--norc", "-p", "-c"]);
        cmd.args([r#"export SHELL="$1"; shift; exec -l -- "$@""#, "julgi-login", &shell, &shell, "-l"]);
        cmd
    } else {
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd
    };
    if let Some(command) = command {
        cmd.args(["-i", "-c", &command]);
    }
    // 사라진 폴더(지운 워크트리 등)의 세션은 Julgi의 기본 폴더에서 연다. 홈에서 열면 Claude Code가 홈을 믿느냐고 묻는다.
    // 대화는 폴더와 상관없이 ID로 이어진다
    cmd.cwd(cwd.filter(|dir| std::path::Path::new(dir).is_dir()).unwrap_or_else(|| default_dir(fallback_dir)));
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Julgi");
    // 세션의 훅이 이 번호로 ~/.julgi/state/<번호>에 지금 상태를 적는다
    cmd.env("JULGI_TERM", id.to_string());
    let _ = std::fs::remove_file(state_dir().join(id.to_string()));
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // Julgi를 다른 도구 안에서 띄웠을 때 그 도구가 심은 변수가 새 셸로 새지 않게 한다.
    // Claude Code의 것은 늘 지우고, 나머지는 설정(stripEnv)에 적힌 앞머리로 지운다.
    let strip = strip_env.unwrap_or_default();
    for (key, _) in std::env::vars() {
        if key.starts_with("CLAUDE") || strip.iter().any(|prefix| !prefix.is_empty() && key.starts_with(prefix.as_str())) {
            cmd.env_remove(key);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    thread::spawn(move || {
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = app.emit("pty-exit", id);
                    break;
                }
                Ok(n) => {
                    if on_data.send(Response::new(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });

    state
        .0
        .lock()
        .unwrap()
        .insert(id, Session { writer, master: pair.master, child });
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let session = map.get_mut(&id).ok_or_else(|| say("세션 없음", "No such session"))?;
    session.writer.write_all(data.as_bytes()).map_err(err)?;
    session.writer.flush().map_err(err)
}

#[tauri::command]
fn pty_resize(state: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let session = map.get(&id).ok_or_else(|| say("세션 없음", "No such session"))?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)
}

#[tauri::command]
fn pty_kill(state: State<Ptys>, id: u32) {
    if let Some(mut session) = state.0.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    let _ = std::fs::remove_file(state_dir().join(id.to_string()));
}

/// 살아 있는 터미널마다 훅이 적어 둔 상태와 그 시각. 훅이 없는 터미널(셸)은 빠진다.
/// 터미널마다 그 안에서 도는 프로세스 전부(셸, claude, 그 자식들)가 쓰는 메모리(KB)와 CPU(%)
#[tauri::command(async)]
fn term_load(state: State<Ptys>) -> HashMap<u32, (u64, f32)> {
    let roots: Vec<(u32, u32)> = state.0.lock().unwrap().iter().filter_map(|(id, s)| Some((*id, s.child.process_id()?))).collect();
    let Ok(out) = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,rss=,pcpu="]).output() else { return HashMap::new() };
    // pid → (부모, 메모리, CPU)
    let mut rows: HashMap<u32, (u32, u64, f32)> = HashMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut cols = line.split_whitespace();
        let (Some(pid), Some(ppid), Some(rss), Some(cpu)) = (cols.next(), cols.next(), cols.next(), cols.next()) else { continue };
        if let (Ok(pid), Ok(ppid)) = (pid.parse(), ppid.parse()) {
            rows.insert(pid, (ppid, rss.parse().unwrap_or(0), cpu.parse().unwrap_or(0.0)));
        }
    }
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, (ppid, _, _)) in &rows {
        kids.entry(*ppid).or_default().push(*pid);
    }
    let mut out = HashMap::new();
    for (id, root) in roots {
        let (mut rss, mut cpu) = (0u64, 0f32);
        let mut stack = vec![root];
        while let Some(pid) = stack.pop() {
            if let Some((_, r, c)) = rows.get(&pid) {
                rss += r;
                cpu += c;
            }
            stack.extend(kids.get(&pid).into_iter().flatten().copied());
        }
        out.insert(id, (rss, cpu));
    }
    out
}

#[tauri::command]
fn term_states(state: State<Ptys>) -> HashMap<u32, (String, u64)> {
    let mut out = HashMap::new();
    for id in state.0.lock().unwrap().keys() {
        let path = state_dir().join(id.to_string());
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let since = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        out.insert(*id, (text.trim().to_owned(), since));
    }
    out
}

/// 화면 쪽 오류를 ~/.julgi/julgi.log에 남긴다.
#[tauri::command]
fn log_line(line: String) {
    use std::fs::OpenOptions;
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(data_dir().join("julgi.log")) {
        let _ = writeln!(f, "{line}");
    }
}

/// 창을 닫았다 열어도 열어 둔 세션과 칸 배치가 돌아오게 한다.
#[tauri::command]
fn layout_load() -> Option<String> {
    std::fs::read_to_string(data_dir().join("layout.json")).ok()
}

#[tauri::command]
fn layout_save(json: String) {
    let _ = std::fs::write(data_dir().join("layout.json"), json);
}

/// 갈아탈 때 새 세션에 넘길 인계 글을 파일로 둔다. 돌려주는 값은 그 경로.
#[tauri::command]
fn handoff_write(id: String, text: String) -> Result<String, String> {
    let dir = data_dir().join("handoff");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(format!("{id}.md"));
    std::fs::write(&path, text).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

/// ~/.julgi 아래의 파일만 가리키게 한다 (줄기 목록, 줄기 기억, 보낼 글, 보낸 기록).
fn data_file(name: &str) -> Result<PathBuf, String> {
    if name.starts_with('/') || name.split('/').any(|part| part.is_empty() || part == "..") {
        return Err(say(&format!("쓸 수 없는 이름: {name}"), &format!("Name not allowed: {name}")));
    }
    Ok(data_dir().join(name))
}

#[tauri::command]
fn data_read(name: String) -> Option<String> {
    std::fs::read_to_string(data_file(&name).ok()?).ok()
}

/// 줄기와 세션이 남긴 기억 전부. 파일 이름(줄기 id 또는 세션 id) → 글
#[tauri::command]
fn memory_load() -> HashMap<String, String> {
    let mut out = HashMap::new();
    for entry in std::fs::read_dir(data_dir().join("threads")).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            if let (Some(stem), Ok(text)) = (path.file_stem().and_then(|s| s.to_str()), std::fs::read_to_string(&path)) {
                out.insert(stem.to_string(), text);
            }
        }
    }
    out
}

/// 브레인의 노트 전부. 파일 이름(노트 id) → 글
#[tauri::command]
fn brain_load() -> HashMap<String, String> {
    let mut out = HashMap::new();
    for entry in std::fs::read_dir(data_dir().join("brain")).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            if let (Some(stem), Ok(text)) = (path.file_stem().and_then(|s| s.to_str()), std::fs::read_to_string(&path)) {
                out.insert(stem.to_string(), text);
            }
        }
    }
    out
}

/// 주어진 폴더들과 같은 곳에 놓인 git 레포들. 일한 적 없는 이웃 레포도 지도에 넣으려는 것이다.
/// 워크트리(.git이 파일인 것)는 본 레포와 같은 것이라 뺀다
#[tauri::command(async)]
fn git_siblings(paths: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in paths {
        let Some(parent) = PathBuf::from(&path).parent().map(PathBuf::from) else { continue };
        for entry in std::fs::read_dir(parent).into_iter().flatten().flatten() {
            let dir = entry.path();
            let name = dir.to_string_lossy().into_owned();
            if dir.join(".git").is_dir() && !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out.sort();
    out
}

/// 창을 꺼내고 넣는 전역 키를 바꾼다. 설정에서 고치면 다시 켜지 않아도 바로 먹게 한다.
/// 키 이름이 틀렸거나 다른 앱이 쓰고 있으면 오류를 돌려준다
#[tauri::command]
fn set_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let keys = app.global_shortcut();
    keys.unregister_all().map_err(|e| e.to_string())?;
    if shortcut.is_empty() {
        return Ok(());
    }
    let parsed = shortcut.parse::<Shortcut>().map_err(|e| e.to_string())?;
    keys.register(parsed).map_err(|e| e.to_string())
}

/// macOS 알림을 띄운다. 창을 안 보고 있을 때 내 차례가 온 것을 알리려는 것이다
#[tauri::command(async)]
fn notify(app: tauri::AppHandle, title: String, body: String) {
    // Julgi 이름으로 보낸다. osascript로 보내면 스크립트 편집기의 알림이 되어, 누르면 스크립트 편집기가 "무제" 문서로 열린다
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

/// 레포 하나를 훑어본 것: README 앞머리, 맨 위 폴더와 파일, 최근 커밋. 지도를 그릴 재료다
#[tauri::command(async)]
fn repo_peek(path: String) -> String {
    let dir = PathBuf::from(&path);
    let mut out = String::new();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| format!("{}{}", e.file_name().to_string_lossy(), if e.path().is_dir() { "/" } else { "" }))
        .filter(|n| !n.starts_with('.') || n == ".gitlab-ci.yml" || n == ".github/")
        .collect();
    names.sort();
    out.push_str(&format!("맨 위: {}\n", names.iter().take(60).cloned().collect::<Vec<_>>().join(" ")));
    // 한 레포에 앱이나 모듈이 여럿 든 경우(모노레포)는 둘째 층을 봐야 무엇이 들었는지 안다
    for name in names.iter().filter(|n| n.ends_with('/')).take(14) {
        let mut kids: Vec<String> = std::fs::read_dir(dir.join(name))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        kids.sort();
        if !kids.is_empty() {
            out.push_str(&format!("  {name} 아래: {}\n", kids.iter().take(14).cloned().collect::<Vec<_>>().join(" ")));
        }
    }
    for readme in ["README.md", "readme.md", "README", "CLAUDE.md"] {
        if let Ok(text) = std::fs::read_to_string(dir.join(readme)) {
            out.push_str(&format!("\n[{readme}]\n{}\n", text.chars().take(2500).collect::<String>()));
        }
    }
    // 무엇으로 만든 것인지(서버인지 앱인지)는 빌드 파일에 드러난다
    for manifest in ["pubspec.yaml", "package.json", "go.mod", "settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "pyproject.toml", "Cargo.toml"] {
        if let Ok(text) = std::fs::read_to_string(dir.join(manifest)) {
            out.push_str(&format!("\n[{manifest}]\n{}\n", text.lines().take(25).collect::<Vec<_>>().join("\n")));
        }
    }
    if let Ok(log) = std::process::Command::new("git").args(["-C", &path, "log", "-8", "--format=%s"]).output() {
        out.push_str(&format!("\n최근 커밋:\n{}", String::from_utf8_lossy(&log.stdout)));
    }
    out
}

/// 레포를 원격의 최신 상태로 맞춘다. 지도를 낡은 코드로 그리지 않으려는 것이다.
/// 늘 받아 오기(fetch)는 하고, 작업 폴더는 건드려도 안전할 때만 앞으로 당긴다:
/// 고친 파일이 없고, 기본 브랜치에 있고, 빨리 감기(fast-forward)로 되는 경우. 그 밖에는 그대로 두고 몇 커밋 뒤인지만 알린다.
/// 돌려주는 값: "당김 N" | "뒤처짐 N" | "최신" | "실패"
#[tauri::command(async)]
fn repo_sync(path: String) -> String {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(&path)
            .args(args)
            // 비밀번호를 묻느라 멈춰 서지 않게 한다
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=8")
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
    };
    if git(&["fetch", "--quiet", "--prune", "origin"]).is_none() {
        return "실패".into();
    }
    let Some(branch) = git(&["rev-parse", "--abbrev-ref", "HEAD"]) else { return "실패".into() };
    let upstream = format!("origin/{branch}");
    let behind: u32 = git(&["rev-list", "--count", &format!("HEAD..{upstream}")]).and_then(|n| n.parse().ok()).unwrap_or(0);
    if behind == 0 {
        return "최신".into();
    }
    let default = git(&["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).map(|s| s.trim_start_matches("origin/").to_owned());
    let clean = git(&["status", "--porcelain"]).is_some_and(|s| s.is_empty());
    if clean && default.as_deref() == Some(branch.as_str()) && git(&["merge", "--ff-only", "--quiet", &upstream]).is_some() {
        return format!("당김 {behind}");
    }
    format!("뒤처짐 {behind}")
}

/// 이 레포의 코드에 다른 레포의 이름이 나오는 곳. 레포끼리 어떻게 이어지는지의 증거다.
/// 이름마다 그 이름이 나오는 파일 수와 앞의 몇 개를 적는다
#[tauri::command(async)]
fn repo_refs(path: String, names: Vec<String>) -> String {
    let mut out = String::new();
    for name in names {
        // 너무 짧은 이름은 아무 데나 걸려서 증거가 못 된다
        if name.len() < 5 {
            continue;
        }
        let Ok(found) = std::process::Command::new("git").args(["-C", &path, "grep", "-I", "-l", "-i", "-F", "-e", &name, "--", ".", ":!*.lock", ":!*.md"]).output() else { continue };
        let files: Vec<&str> = std::str::from_utf8(&found.stdout).unwrap_or("").lines().collect();
        if !files.is_empty() {
            out.push_str(&format!("{name}: 파일 {}개 ({})\n", files.len(), files.iter().take(4).cloned().collect::<Vec<_>>().join(", ")));
        }
    }
    out
}

/// ~/.julgi 아래의 파일 하나를 지운다
#[tauri::command]
fn data_remove(name: String) -> Result<(), String> {
    std::fs::remove_file(data_file(&name)?).map_err(err)
}

/// 세션이 julgi 명령으로 남긴 부탁을 가져오고 지운다. 한 부탁은 "명령\n세션\n대상\n본문"
#[tauri::command]
fn inbox_take() -> Vec<String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(data_dir().join("inbox"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "req"))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok();
            let _ = std::fs::remove_file(&path);
            text
        })
        .collect()
}

/// Julgi가 띄운 세션이 쓰는 julgi 명령과 스킬 묶음을 ~/.julgi에 깐다. 켤 때마다 덮어써서 앱과 같은 판을 유지한다.
/// 스킬은 지금 언어의 것을 같은 자리에 쓰고, julgi 명령이 읽을 언어 표시(lang)도 함께 적는다. 언어를 바꾸고 다시 켜면 바뀐다.
fn install_assets() {
    let ko = lang::is_ko();
    // (자리, 한국어 글, 영어 글)
    let files: [(&str, &str, &str); 10] = [
        ("bin/julgi", include_str!("../assets/julgi"), include_str!("../assets/julgi")),
        ("lang", "ko\n", "en\n"),
        ("plugin/.claude-plugin/plugin.json", include_str!("../assets/plugin/.claude-plugin/plugin.json"), include_str!("../assets/plugin-en/.claude-plugin/plugin.json")),
        ("plugin/skills/julgi-memory/SKILL.md", include_str!("../assets/plugin/skills/julgi-memory/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-memory/SKILL.md")),
        ("plugin/skills/julgi-send/SKILL.md", include_str!("../assets/plugin/skills/julgi-send/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-send/SKILL.md")),
        ("plugin/skills/julgi-find/SKILL.md", include_str!("../assets/plugin/skills/julgi-find/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-find/SKILL.md")),
        ("plugin/skills/julgi-wrap/SKILL.md", include_str!("../assets/plugin/skills/julgi-wrap/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-wrap/SKILL.md")),
        ("plugin/skills/julgi-brain/SKILL.md", include_str!("../assets/plugin/skills/julgi-brain/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-brain/SKILL.md")),
        ("plugin/skills/julgi-map/SKILL.md", include_str!("../assets/plugin/skills/julgi-map/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-map/SKILL.md")),
        ("plugin/skills/julgi-lead/SKILL.md", include_str!("../assets/plugin/skills/julgi-lead/SKILL.md"), include_str!("../assets/plugin-en/skills/julgi-lead/SKILL.md")),
    ];
    for (name, text, en) in files {
        let text = if ko { text } else { en };
        let path = data_dir().join(name);
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, text);
    }
    // 세션을 띄울 때 늘 가리키는 폴더들은 비어 있더라도 있어야 한다: 일감용 워크트리와 Julgi가 만든 스킬의 자리
    let _ = std::fs::create_dir_all(data_dir().join("worktrees"));
    let grown = data_dir().join("grown/.claude-plugin/plugin.json");
    if !grown.exists() {
        let _ = std::fs::create_dir_all(data_dir().join("grown/.claude-plugin"));
        let _ = std::fs::create_dir_all(data_dir().join("grown/skills"));
        let _ = std::fs::write(&grown, "{\n  \"name\": \"julgi-grown\",\n  \"description\": \"Julgi가 되풀이되는 일에서 만든 스킬\",\n  \"version\": \"1.0.0\"\n}\n");
    }
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(data_dir().join("bin/julgi"), std::fs::Permissions::from_mode(0o755));
}

/// 돌려주는 값은 쓴 파일의 경로
#[tauri::command]
fn data_write(name: String, text: String) -> Result<String, String> {
    let path = data_file(&name)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&path, text).map_err(err)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn data_append(name: String, line: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    let mut file = OpenOptions::new().create(true).append(true).open(data_file(&name)?).map_err(err)?;
    writeln!(file, "{line}").map_err(err)
}

/// 보낼 곳이 애매할 때 작은 모델에게 한 번 묻는다. 도구도 설정도 없이 글만 주고받고,
/// 대화 기록도 남기지 않는다 (세션 목록이 지저분해지지 않게).
#[tauri::command(async)]
fn route_ask(system: String, prompt: String, model: Option<String>) -> Result<String, String> {
    // 모델 이름은 셸 명령에 들어가므로 글자와 숫자, 몇 가지 기호만 받는다
    let model = model.filter(|m| !m.is_empty() && m.chars().all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c))).unwrap_or_else(|| "haiku".into());
    // 지시문은 한국어로 두고, 영어일 때는 답만 영어로 쓰게 한다. 정해 둔 형식과 열쇠말은 그대로여야 화면이 읽는다
    let system = if lang::is_ko() {
        system
    } else {
        format!("{system}\n\nWrite every natural-language part of your answer in English. Keep any required format, labels, keywords and JSON keys exactly as the instructions specify, even where they are Korean.")
    };
    use std::process::{Command, Stdio};
    let dir = data_dir().join("router");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = Command::new(shell);
    cmd.args(["-l", "-c", r#"claude -p --model "$JULGI_MODEL" --no-session-persistence --setting-sources "" --tools "" --system-prompt "$JULGI_SYSTEM""#])
        .env("JULGI_SYSTEM", system)
        .env("JULGI_MODEL", model)
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, _) in std::env::vars() {
        if key.starts_with("CLAUDE") {
            cmd.env_remove(key);
        }
    }
    let mut child = cmd.spawn().map_err(err)?;
    child.stdin.take().ok_or_else(|| say("입력을 열지 못했다", "Could not open stdin"))?.write_all(prompt.as_bytes()).map_err(err)?;
    let out = child.wait_with_output().map_err(err)?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// 내가 고치는 설정. 없으면 화면 쪽 기본값으로 돈다.
/// 레포가 드러나지 않는 일을 여는 기본 폴더. 없으면 만든다. 설정이 없으면 ~/julgi
#[tauri::command]
fn default_dir(path: Option<String>) -> String {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    let dir = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if p == "~" => home.clone(),
        Some(p) if p.starts_with("~/") => home.join(&p[2..]),
        Some(p) => PathBuf::from(p),
        None => home.join("julgi"),
    };
    match std::fs::create_dir_all(&dir) {
        Ok(()) => dir.to_string_lossy().into_owned(),
        Err(_) => home.to_string_lossy().into_owned(),
    }
}

/// 지워진 워크트리처럼 이제 없는 폴더를 걸러 내려고 본다
#[tauri::command]
fn dirs_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| std::path::Path::new(p).is_dir()).collect()
}

/// Julgi가 띄우지 않았는데 떠 있는 Claude Code 프로세스의 세션 ID들.
/// `claude --resume <id>`처럼 ID를 달고 뜬 것만 알 수 있다. Julgi가 띄운 것은 상태 훅(.julgi/state)이 붙어 있어 가려낸다.
#[tauri::command]
fn sessions_elsewhere() -> Vec<String> {
    let Ok(out) = std::process::Command::new("/bin/ps").args(["-axo", "command"]).output() else { return Vec::new() };
    let mut ids = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if !line.starts_with("claude ") || line.contains(".julgi/state") {
            continue;
        }
        let mut words = line.split_whitespace();
        while let Some(word) = words.next() {
            if word == "--resume" || word == "-r" || word == "--session-id" {
                if let Some(id) = words.next().filter(|id| id.len() == 36 && id.matches('-').count() == 4) {
                    ids.push(id.to_owned());
                }
            }
        }
    }
    ids
}

#[tauri::command]
fn config_load() -> Option<String> {
    std::fs::read_to_string(data_dir().join("config.json")).ok()
}

#[tauri::command]
fn app_exit(app: AppHandle) {
    app.exit(0);
}

/// 껐다가 바로 다시 켠다. 언어처럼 켤 때 정해지는 설정을 바꿨을 때 쓴다. 열려 있던 세션은 켜지면서 이어진다
#[tauri::command]
fn app_restart(app: AppHandle) {
    app.restart();
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 메뉴 막대 아이콘 옆에 기다리는 세션 수를 적는다. 창이 닫혀 있거나 가려져 있으면
/// 화면 쪽 타이머가 느려질 수 있어서, 화면에 기대지 않고 여기서 직접 센다.
fn watch_waiting(app: AppHandle) {
    thread::spawn(move || {
        let mut shown = usize::MAX;
        loop {
            thread::sleep(std::time::Duration::from_secs(2));
            let ids: Vec<u32> = app.state::<Ptys>().0.lock().unwrap().keys().copied().collect();
            let waiting = ids
                .iter()
                .filter(|id| {
                    std::fs::read_to_string(state_dir().join(id.to_string()))
                        .is_ok_and(|state| matches!(state.trim(), "wait" | "ask"))
                })
                .count();
            if waiting != shown {
                shown = waiting;
                if let Some(tray) = app.tray_by_id("main") {
                    let _ = tray.set_title(if waiting == 0 { None } else { Some(waiting.to_string()) });
                }
            }
        }
    });
}

#[tauri::command]
fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

#[tauri::command]
fn env_flag(name: String) -> bool {
    std::env::var(name).is_ok()
}

/// 붙여넣을 내용. 클립보드에 그림이 있으면 임시 PNG로 저장해 그 경로를 돌려준다.
/// Claude Code는 붙여넣은 그림 경로를 첨부로 받는다.
#[tauri::command]
fn clipboard_paste() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(err)?;
    if let Ok(image) = clipboard.get_image() {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(err)?
            .as_millis();
        let path = std::env::temp_dir().join(format!("julgi-paste-{millis}.png"));
        let file = std::fs::File::create(&path).map_err(err)?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), image.width as u32, image.height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(err)?;
        writer.write_image_data(&image.bytes).map_err(err)?;
        return Ok(path.to_string_lossy().into_owned());
    }
    clipboard.get_text().map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = std::fs::create_dir_all(state_dir());
    lang::init(config_load());
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // 기본 메뉴에서 "창 닫기(⌘W)"를 빼고 종료는 화면에 먼저 묻는다.
        // 일하는 세션이 있는데 실수로 꺼 버리는 일을 막으려는 것이다.
        .menu(|app| {
            let quit = MenuItem::with_id(app, "quit", say("Julgi 종료", "Quit Julgi"), true, Some("CmdOrCtrl+Q"))?;
            Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        "Julgi",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &quit,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        say("편집", "Edit"),
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        say("창", "Window"),
                        true,
                        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
                    )?,
                ],
            )
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                show_window(app); // 일하는 세션이 있으면 창에서 먼저 묻는다
                let _ = app.emit("quit-requested", ());
            }
        })
        // 창을 닫아도 메뉴 막대에 남아서 세션이 계속 돈다. 완전히 끄는 건 종료(⌘Q)뿐이다.
        .setup(|app| {
            install_assets();
            let open = MenuItem::with_id(app, "tray-open", say("Julgi 열기", "Open Julgi"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", say("종료", "Quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").menu(&menu).tooltip("Julgi").on_menu_event(|app, event| {
                show_window(app);
                if event.id() == "tray-quit" {
                    let _ = app.emit("quit-requested", ());
                }
            });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            // 어디서든 Julgi 창을 불러내고 다시 넣는 키. config.json의 hotkey로 바꾼다 (기본 ⌃⌘J)
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
                let wanted = std::fs::read_to_string(data_dir().join("config.json"))
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v.get("hotkey").and_then(|h| h.as_str()).map(str::to_owned))
                    .unwrap_or_else(|| "ctrl+super+KeyJ".into());
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            // 보고 있던 창이면 넣고, 아니면 꺼내 앞으로 가져온다
                            match app.get_webview_window("main") {
                                Some(window) if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) => {
                                    let _ = window.hide();
                                }
                                _ => show_window(app),
                            }
                        })
                        .build(),
                )?;
                // 키 이름이 틀렸거나 다른 앱이 쓰고 있어도 Julgi는 뜨게 한다
                if !wanted.is_empty() {
                    if let Ok(shortcut) = wanted.parse::<Shortcut>() {
                        let _ = app.global_shortcut().register(shortcut);
                    }
                }
            }
            watch_waiting(app.handle().clone());
            Ok(())
        })
        .manage(Ptys::default())
        .invoke_handler(tauri::generate_handler![lang::set_lang, pty_spawn, pty_write, pty_resize, pty_kill, clipboard_paste, term_states, log_line, env_flag, home_dir, layout_load, layout_save, handoff_write, config_load, sessions_elsewhere, app_exit, app_restart, data_read, data_write, data_append, data_remove, brain_load, notify, set_hotkey, repo_peek, repo_refs, repo_sync, git_siblings, route_ask, memory_load, inbox_take, default_dir, dirs_exist, ledger::last_reply, ledger::last_exchange, ledger::session_workdir, ledger::ledger_scan, remote::remote_start, remote::remote_stop, remote::remote_publish, usage::claude_usage, jira::jira_connect, jira::jira_disconnect, jira::jira_me, jira::jira_search, jira::jira_mine, jira::jira_projects, jira::jira_statuses, jira::jira_view, jira::jira_image, ci::ci_runs, ci::ci_jobs, ci::ci_log, jira::jira_transitions, jira::jira_transition, jira::jira_comment, tokens::token_usage, github::gh_status, github::glab_status, github::pr_view, github::pr_diff, github::pr_comments, github::repo_slug, github::pr_status, github::pr_review_requests, github::pr_mine, github::pr_list, github::pr_comment, github::pr_line_comment, github::pr_reply, github::pr_review, github::pr_merge, github::pr_close, github::pr_reopen, term_load, habits::habits, habits::corrections, skills::skill_usage, skills::skills_list, skills::skill_apply, skills::skill_retire, work::worktree_add, work::worktree_drop, work::repo_changes, work::repo_stat, work::repo_has, work::repo_snapshot, work::repo_diff, work::repo_moved, work::repo_state, work::repo_mrs, work::repo_commits, work::commit_message])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // 독 아이콘을 누르면 닫아 둔 창이 다시 나온다
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_window(app);
            }
            let _ = (app, &event);
        });
}
