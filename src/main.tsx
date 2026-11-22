import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";

// 화면 쪽 오류는 ~/.julgi/julgi.log에 남긴다
const report = (kind: string, detail: unknown) => void invoke("log_line", { line: `[${new Date().toISOString()}] ${kind}: ${String(detail)}` }).catch(() => {});
window.addEventListener("error", (e) => report("error", e.message));
window.addEventListener("unhandledrejection", (e) => report("rejection", e.reason));

async function start() {
  // 브라우저에서 바로 열면(화면 확인용) 가짜 뒷단을 붙인다
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./mock");
  const { default: App } = await import("./App");
  // StrictMode는 쓰지 않는다. 개발 중 이중 마운트가 셸을 두 번 띄운다.
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}
void start();
