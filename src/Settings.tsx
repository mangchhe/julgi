import { useEffect, useRef, useState } from "react";
import { config, kilo } from "./model";
import { THEMES } from "./themes";

type Key = keyof typeof config;
type Props = { onChange: (key: Key, value: string | number | boolean) => void; onClose: () => void; /** 폰에서 열 주소. 폰에서 보기를 켰을 때만 온다 */ remoteUrl?: string };

type Row =
  | { kind: "theme"; label: string; note: string }
  | { kind: "number"; key: Key; label: string; note: string; step: number; min: number; max: number; show: (n: number) => string }
  | { kind: "toggle"; key: Key; label: string; note: string }
  | { kind: "pick"; key: Key; label: string; note: string; options: [string, string][] }
  | { kind: "key"; key: Key; label: string; note: string }
  | { kind: "text"; key: Key; label: string; note: string; hint: string };

/** 묶음마다 줄 몇 개. 왼쪽에서 묶음을 고르면 오른쪽에 그 줄들만 나온다 */
const SECTIONS: { title: string; hint: string; rows: Row[] }[] = [
  {
    title: "화면",
    hint: "보이는 것과 창",
    rows: [
    { kind: "theme", label: "테마", note: "화면과 터미널의 색" },
    { kind: "number", key: "recentDays", label: "목록에 보이는 기간", note: "이보다 오래 안 쓴 잠든 세션은 목록에서 빼고 ⌘K로만 찾는다", step: 1, min: 1, max: 90, show: (n) => `${n}일` },
    { kind: "toggle", key: "usage", label: "Claude 사용량 보기", note: "아래 상태 줄에 5시간 창과 주간 한도를 얼마나 썼는지 보여 준다. 켜면 Claude Code의 로그인 토큰을 키체인에서 읽어 Anthropic의 사용량 주소에만 보낸다(처음에 키체인이 허락을 묻는다). 문서에 없는 주소라 어느 날 안 나올 수 있다" },
      { kind: "toggle", key: "notify", label: "알림", note: "Julgi 창을 안 보고 있을 때 세션이 답을 끝내거나 확인을 물으면 macOS 알림을 띄운다" },
    { kind: "toggle", key: "confirmClose", label: "닫기 전에 묻기", note: "⌘W나 ×로 세션을 닫을 때 한 번 묻는다" },
    { kind: "key", key: "hotkey", label: "창 꺼내기 키", note: "어느 앱에서든 Julgi 창을 꺼내고 다시 넣는 키. Enter를 누른 뒤 쓸 키 조합을 누른다. Backspace면 쓰지 않는다" },
    ],
  },
  {
    title: "세션",
    hint: "열고, 재우고, 넘기기",
    rows: [
    { kind: "number", key: "hotTokens", label: "갈아타는 크기", note: "이보다 큰 세션에 보낼 때는 인계 글만 들고 새 세션으로 넘어간 뒤 보낸다. 대화 한도가 200k면 150k, 1M이면 500k쯤이 맞다", step: 50_000, min: 50_000, max: 2_000_000, show: (n) => kilo(n) },
    { kind: "number", key: "sleepHours", label: "알아서 재우기", note: "답까지 본 뒤 이 시간 넘게 쉰 세션을 재운다", step: 1, min: 0, max: 48, show: (n) => (n ? `${n}시간` : "안 재움") },
    { kind: "number", key: "memoryLimitGb", label: "메모리 한도", note: "세션들이 쓰는 메모리 합계가 이만큼을 넘으면, 답까지 보고 10분 넘게 쉰 세션을 오래 쉰 것부터 재운다. 칸에 떠 있는 세션, 고정한 세션, 일하는 중인 세션은 건드리지 않는다", step: 1, min: 0, max: 64, show: (n) => (n ? `${n}GB` : "안 씀") },
      { kind: "toggle", key: "autoFill", label: "칸 알아서 관리", note: "내 차례인 세션을 칸에 올리고, 자리가 있으면 칸을 늘리고, 빈 칸은 없앤다" },
    { kind: "pick", key: "skipPermissions", label: "허락 묻지 않기", note: "세션이 파일을 고치거나 명령을 돌릴 때 허락을 묻지 않게 띄운다(--dangerously-skip-permissions). \"내가 연 세션만\"은 Julgi가 알아서 띄운 세션(일감, 스킬 만들기, 폰이나 다른 세션이 던진 일)은 그대로 묻게 둔다. 이미 떠 있는 세션은 다시 열어야 바뀐다", options: [["off", "묻는다"], ["mine", "내가 연 세션만"], ["all", "전부"]] },
    { kind: "text", key: "defaultDir", label: "기본 폴더", note: "레포가 드러나지 않는 일을 여는 폴더", hint: "비우면 ~/julgi" },
    { kind: "text", key: "saveCommand", label: "⌘S가 보내는 말", note: "⌘S를 누르면 지금 세션에 이 말을 보낸다", hint: "예: /commit" },
    ],
  },
  {
    title: "알아서 하는 일",
    hint: "끄면 그 일만 멈춘다",
    rows: [
    { kind: "toggle", key: "summarize", label: "요약과 이름 짓기", note: "쉬는 세션을 작은 모델로 요약하고 알아볼 이름을 붙인다. 보낼 곳을 고를 때 이 요약을 읽는다" },
    { kind: "toggle", key: "judgeMerges", label: "같은 일 알아서 합치기", note: "두 세션이 같은 일이라고 모델이 판정하면 묻지 않고 한 줄기로 묶는다" },
    { kind: "toggle", key: "brain", label: "브레인", note: "줄기 기억에서 일이 끝나도 남길 것(결정, 함정, 사실)을 추려 담고, 새 일을 열 때 관련된 것을 붙인다. ⌘G에서 본다" },
    { kind: "toggle", key: "autoLead", label: "알아서 조율하기", note: "⌘L로 던진 일이 레포 두 곳 넘게 걸치면 새 세션을 조율자로 세운다. 조율자는 일감으로 나눠 레포마다 다른 세션에 맡기고 결과를 모은다" },
    { kind: "toggle", key: "taskWorktree", label: "일감은 따로 딴 폴더에서", note: "일감을 맡은 세션은 레포의 작업 폴더가 아니라 Julgi가 만든 워크트리(브랜치 julgi/일감번호)에서 일한다. 고친 것이 없으면 끝난 뒤 지운다" },
    { kind: "toggle", key: "growSkills", label: "스킬 알아서 만들고 가꾸기", note: "되풀이해서 시킨 일은 스킬로 만들고(한 주에 하나), 자주 쓰는 내 스킬은 쓰인 기록에 비추어 다듬는다(한 주에 하나, 옛 글은 ~/.julgi/skill-history에 남는다). 링크로 건 스킬과 레포의 스킬은 건드리지 않는다" },
    ],
  },
  {
    title: "코드 검토",
    hint: "세션이 고친 코드를 읽어 주는 것",
    rows: [
    { kind: "toggle", key: "brief", label: "바뀐 것 브리핑", note: "세션이 코드를 고치면 무엇을 왜 바꿨는지, 파일별로 한 줄, 눈여겨볼 곳을 요약해 둔다. ⌘I와 \"바뀐 것 보기\"에 나온다" },
    { kind: "toggle", key: "check", label: "내가 보기 전에 걸러 읽기", note: "브리핑 뒤에 더 큰 모델이 세션의 설명 없이 변경만 읽고, 틀렸거나 틀릴 수 있는 곳을 짚는다(버그·위험·의문). ⌘E 위쪽에 나오고 한 번에 세션에 넘겨 확인시킬 수 있다. 15줄이 안 되는 변경에는 하지 않는다" },
    ],
  },
  {
    title: "점검과 모델",
    hint: "언제 정리하고, 판단에 무엇을 쓰나",
    rows: [
    { kind: "number", key: "reviewHour", label: "점검 시각", note: "매일 이 시각에 세션 정리와 스킬 후보 찾기를 한다. 그때 Julgi나 맥이 꺼져 있었으면 다음에 켰을 때 돈다", step: 1, min: 0, max: 23, show: (n) => (n < 12 ? `오전 ${n}시` : n === 12 ? "낮 12시" : `오후 ${n - 12}시`) },
    { kind: "number", key: "reviewDay", label: "매주 점검 요일", note: "이 요일의 점검은 세션 전부를 보고 브레인 정리, 스킬 다듬기, 지도 다시 그리기까지 한다", step: 1, min: 0, max: 6, show: (n) => "일월화수목금토"[n] + "요일" },
    { kind: "pick", key: "thinking", label: "판단 모델", note: "가볍게: 전부 Haiku. 맞춰서: 요약은 Haiku, 보낼 곳·합치기·브레인 담기는 Sonnet, 주간 점검은 Opus. 깊게: 한 단계씩 더 큰 모델", options: [["light", "가볍게"], ["balanced", "맞춰서"], ["deep", "깊게"]] },
    ],
  },
  {
    title: "지도",
    hint: "레포를 찾아가게 하는 것",
    rows: [
    { kind: "text", key: "mapRoot", label: "레포가 모여 있는 폴더", note: "그 바로 아래의 git 레포를 전부 지도에 넣고, 세션이 읽을 수 있게 연다. 쉼표로 여럿. 바꾼 뒤 ⌘G의 지도 탭에서 다시 그린다", hint: "예: ~/code · 비우면 Julgi가 고른다" },
    { kind: "toggle", key: "mapFetch", label: "지도 그릴 때 최신으로 받기", note: "지도를 그리기 전에 레포마다 원격에서 받아 온다. 고친 파일이 없고 기본 브랜치에 있는 레포만 앞으로 당기고, 작업 중인 레포는 건드리지 않는다" },
    ],
  },
  {
    title: "밖에서",
    hint: "폰으로 보기",
    rows: [
    { kind: "toggle", key: "remote", label: "폰에서 보기", note: "Tailscale 망 안에서만 열리는 작은 웹 화면을 띄운다. 폰에서 내 차례인 세션에 답하고 새 일을 던진다. 켜면 아래에 주소가 나온다(누르면 복사). 주소에 든 토큰을 아는 기기만 들어온다" },
    ],
  },
];
const ROWS: Row[] = SECTIONS.flatMap((sec) => sec.rows);
/** 줄 번호 → 그 줄이 든 묶음 번호 */
const SECTION_OF: number[] = SECTIONS.flatMap((sec, n) => sec.rows.map(() => n));
/** 묶음 번호 → 그 묶음의 첫 줄 번호 */
const FIRST_OF: number[] = SECTIONS.map((_, n) => SECTION_OF.indexOf(n));

/** "ctrl+super+KeyJ"를 ⌃⌘J로 보여 준다 */
const showKey = (combo: string) =>
  combo
    .split("+")
    .filter(Boolean)
    .map((part) => ({ ctrl: "⌃", alt: "⌥", shift: "⇧", super: "⌘", cmd: "⌘" })[part.toLowerCase()] ?? part.replace(/^Key|^Digit/, ""))
    .join("");

/** 설정 (⌘,). 바꾸는 즉시 적용되고 ~/.julgi/config.json에 남는다 */
export default function Settings({ onChange, onClose, remoteUrl }: Props) {
  const [at, setAt] = useState(0);
  const [taking, setTaking] = useState(false); // 키 조합을 받는 중
  const [, redraw] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => box.current?.querySelector(".set-row.on")?.scrollIntoView({ block: "nearest" }), [at]);

  const set = (key: Key, value: string | number | boolean) => {
    onChange(key, value);
    redraw((n) => n + 1);
  };
  /** ←→: 테마는 옆 것으로, 숫자는 한 칸씩, 켜고 끄는 것은 뒤집는다 */
  const nudge = (row: Row, dir: number) => {
    if (row.kind === "theme") {
      const i = Math.max(0, THEMES.findIndex((t) => t.id === config.theme));
      set("theme", THEMES[(i + dir + THEMES.length) % THEMES.length].id);
    } else if (row.kind === "number") set(row.key, Math.min(row.max, Math.max(row.min, (config[row.key] as number) + dir * row.step)));
    else if (row.kind === "toggle") set(row.key, !config[row.key]);
    else if (row.kind === "pick") {
      const i = Math.max(0, row.options.findIndex(([value]) => value === config[row.key]));
      set(row.key, row.options[(i + dir + row.options.length) % row.options.length][0]);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement;
    const row = ROWS[at];
    // Tab: 다음 묶음의 첫 줄로 (⇧Tab은 앞 묶음)
    if (e.key === "Tab" && !taking) {
      e.preventDefault();
      box.current?.focus();
      return setAt(FIRST_OF[(SECTION_OF[at] + (e.shiftKey ? SECTIONS.length - 1 : 1)) % SECTIONS.length]);
    }
    if (taking && row.kind === "key") {
      // 조합 키만 누른 동안은 기다린다. 글자 키가 같이 눌리면 그 조합으로 정한다
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setTaking(false);
      if (e.key === "Backspace") return setTaking(false), set(row.key, "");
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
      const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "super"].filter(Boolean);
      // 조합 키 없이 글자만으로는 정하지 않는다. 평소 타자가 전부 걸린다
      if (!mods.length) return;
      setTaking(false);
      return set(row.key, [...mods, e.code].join("+"));
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setAt((at + (e.key === "ArrowDown" ? 1 : -1) + ROWS.length) % ROWS.length);
      if (typing) box.current?.focus();
    } else if (typing) {
      if (e.key === "Enter") box.current?.focus();
      else return;
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") nudge(row, e.key === "ArrowRight" ? 1 : -1);
    else if (e.key === "Enter" || e.key === " ") {
      if (row.kind === "key") setTaking(true);
      else if (row.kind === "text") box.current?.querySelector<HTMLInputElement>(".set-row.on input")?.focus();
      else if (row.kind === "toggle") nudge(row, 1);
      else onClose();
    } else return;
    e.preventDefault();
  };

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal settings" ref={box} tabIndex={-1} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-body">
          <nav className="set-nav">
            <div className="set-title">설정</div>
            {SECTIONS.map((sec, n) => (
              <button key={sec.title} type="button" tabIndex={-1} className={n === SECTION_OF[at] ? "on" : ""} onClick={() => setAt(FIRST_OF[n])}>
                <b>{sec.title}</b>
                <small>{sec.hint}</small>
              </button>
            ))}
          </nav>
          <div className="set-page">
            <div className="set-head">
              <b>{SECTIONS[SECTION_OF[at]].title}</b>
              <span>{SECTIONS[SECTION_OF[at]].hint}</span>
            </div>
            <div className="set-card">
              {ROWS.map((row, i) =>
                SECTION_OF[i] !== SECTION_OF[at] ? null : (
                <div key={row.label} className={"set-row" + (i === at ? " on" : "")} onClick={() => setAt(i)}>
                  <div className="set-label">
                    {row.label}
                    <div className="set-note">{row.note}</div>
                    {row.kind === "toggle" && row.key === "remote" && config.remote && remoteUrl && (
                      <button type="button" tabIndex={-1} className="set-url" title="누르면 복사한다" onClick={() => void navigator.clipboard.writeText(remoteUrl.match(/https?:\S+/)?.[0]?.replace(/\)$/, "") ?? remoteUrl).catch(() => {})}>
                        {remoteUrl}
                      </button>
                    )}
                  </div>
                  <div className="set-value">
                    {row.kind === "theme" &&
                      THEMES.map((t) => (
                        <button key={t.id} type="button" tabIndex={-1} className={"swatch" + (t.id === config.theme ? " picked" : "")} style={{ background: t.bg }} title={t.note} onClick={() => set("theme", t.id)}>
                          <i style={{ background: t.accent }} />
                          <i style={{ background: t.wait }} />
                          <span style={{ color: t.ink }}>{t.name}</span>
                        </button>
                      ))}
                    {row.kind === "number" && (
                      <span className="set-stepper">
                        <button type="button" tabIndex={-1} className="set-step" onClick={() => nudge(row, -1)}>
                          −
                        </button>
                        <span className="set-num">{row.show(config[row.key] as number)}</span>
                        <button type="button" tabIndex={-1} className="set-step" onClick={() => nudge(row, 1)}>
                          +
                        </button>
                      </span>
                    )}
                    {row.kind === "pick" && (
                      <span className="set-seg">
                        {row.options.map(([value, label]) => (
                          <button key={value} type="button" tabIndex={-1} className={config[row.key] === value ? "yes" : ""} onClick={() => set(row.key, value)}>
                            {label}
                          </button>
                        ))}
                      </span>
                    )}
                    {row.kind === "key" && (
                      <button type="button" tabIndex={-1} className={"set-toggle" + (taking && i === at ? " yes" : "")} onClick={() => (setAt(i), setTaking(true))}>
                        {taking && i === at ? "쓸 키를 누른다…" : showKey(String(config[row.key])) || "안 씀"}
                      </button>
                    )}
                    {row.kind === "toggle" && (
                      <button type="button" tabIndex={-1} role="switch" aria-checked={!!config[row.key]} className={"set-switch" + (config[row.key] ? " yes" : "")} onClick={() => nudge(row, 1)}>
                        <i />
                        <span>{config[row.key] ? "켜짐" : "꺼짐"}</span>
                      </button>
                    )}
                    {row.kind === "text" && <input tabIndex={-1} value={config[row.key] as string} placeholder={row.hint} spellCheck={false} onFocus={() => setAt(i)} onChange={(e) => set(row.key, e.target.value)} />}
                  </div>
                </div>
                ),
              )}
            </div>
          </div>
        </div>
        <div className="pal-foot">Tab 묶음 넘기기 · ↑↓ 고르기 · ←→ 바꾸기 · Enter 켜고 끄기, 글 고치기 · 바로 적용된다 · Esc · 나머지 값은 ~/.julgi/config.json</div>
      </div>
    </div>
  );
}
