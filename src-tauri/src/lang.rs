//! 뒷단이 내는 글의 언어. 기본은 영어이고, 화면이 정한 언어를 set_lang으로 넘겨받는다.

use std::sync::atomic::{AtomicBool, Ordering};

static KO: AtomicBool = AtomicBool::new(false);

pub fn is_ko() -> bool {
    KO.load(Ordering::Relaxed)
}

/// 지금 언어의 글을 고른다. 한국어 글이 원문이다
pub fn say(ko: &str, en: &str) -> String {
    if is_ko() { ko } else { en }.to_owned()
}

#[tauri::command]
pub fn set_lang(lang: String) {
    KO.store(lang == "ko", Ordering::Relaxed);
}

/// 화면이 뜨기 전에 만드는 글(메뉴)을 위해 설정에서 먼저 읽는다. 화면의 resolveLang과 같은 규칙:
/// "ko"/"en"이면 그대로, 아니면(auto) 시스템의 첫 언어가 한국어일 때만 한국어
pub fn init(config: Option<String>) {
    let want = config.and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok()).and_then(|v| v["lang"].as_str().map(str::to_owned));
    let ko = match want.as_deref() {
        Some("ko") => true,
        Some("en") => false,
        _ => std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLanguages"])
            .output()
            .is_ok_and(|out| String::from_utf8_lossy(&out.stdout).split('"').nth(1).is_some_and(|first| first.starts_with("ko"))),
    };
    KO.store(ko, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_language() {
        assert_eq!(say("세션 없음", "No such session"), "No such session");
        set_lang("ko".into());
        assert_eq!(say("세션 없음", "No such session"), "세션 없음");
        set_lang("en".into());
        assert!(!is_ko());
    }
}
