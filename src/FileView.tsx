import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { config } from "./model";
import { md } from "./md";
import { tr } from "./i18n";

export type FileTarget = { path: string; line?: number };

/** Julgi 안에서 파일을 펴 본다. 터미널에서 ⌘ 클릭한 경로와 스킬 목록이 이 이벤트로 연다 */
export const openFile = (target: FileTarget) => window.dispatchEvent(new CustomEvent<FileTarget>("julgi:file", { detail: target }));

/** 밖의 앱으로 연다: 설정에 정해 둔 편집기, 없으면 macOS가 정한 앱 */
export async function openOutside(path: string) {
  const app = config.editor.trim();
  if (app && (await invoke<boolean>("path_open_with", { path, app }).catch(() => false))) return;
  await openPath(path).catch(() => {});
}

/**
 * 파일 하나를 읽기만 하는 창. 마크다운은 그려서, 나머지는 줄 번호와 함께 보여 준다.
 * 글이 아니거나(그림, 폴더) 너무 크면 읽지 않고 밖의 앱으로 넘긴다
 */
export default function FileView({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const [text, setText] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  const isMd = /\.(md|markdown)$/i.test(target.path);
  const [raw, setRaw] = useState(!isMd || !!target.line);
  useEffect(() => {
    void invoke<string>("file_read", { path: target.path }).then(setText, () => (void openOutside(target.path), onClose()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.path]);
  useEffect(() => {
    box.current?.focus();
    if (text !== undefined && target.line) box.current?.querySelector(`[data-n="${target.line}"]`)?.scrollIntoView({ block: "center" });
  }, [text, target.line, raw]);
  // 맨 위의 머리말(--- 사이)은 그리지 않고 글 그대로 둔다
  const [front, body] = useMemo(() => {
    const m = text?.match(/^---\n([\s\S]*?)\n---\n?/);
    return m ? [m[1], text!.slice(m[0].length)] : ["", text ?? ""];
  }, [text]);
  const name = target.path.split("/").pop();
  return (
    <div className="pal-back wide fv-back" onMouseDown={onClose}>
      <div
        className="fv"
        ref={box}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          else if (e.key === "o" && !e.metaKey) void openOutside(target.path), onClose();
        }}
      >
        <div className="fv-head">
          <b>{name}</b>
          <small title={target.path}>{target.path}</small>
          {isMd && (
            <button type="button" tabIndex={-1} onClick={() => setRaw(!raw)}>
              {raw ? tr`그려서 보기` : tr`글 그대로 보기`}
            </button>
          )}
          <button type="button" tabIndex={-1} onClick={() => (void openOutside(target.path), onClose())}>
            {tr`밖에서 열기`} <kbd>O</kbd>
          </button>
        </div>
        <div className="fv-body">
          {text === undefined ? (
            <small className="fv-wait">{tr`읽는 중`}</small>
          ) : raw ? (
            <div className="fv-code">
              {text.split("\n").map((l, i) => (
                <div key={i} data-n={i + 1} className={i + 1 === target.line ? "hit" : ""}>
                  <i>{i + 1}</i>
                  <span>{l || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              {front && <pre className="fv-front">{front}</pre>}
              <div
                className="md fv-md"
                dangerouslySetInnerHTML={{ __html: md(body) }}
                onClick={(e) => {
                  const a = (e.target as HTMLElement).closest("a");
                  if (a) e.preventDefault(), void import("@tauri-apps/plugin-opener").then((o) => o.openUrl(a.href));
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
