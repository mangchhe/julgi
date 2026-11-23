import Hint from "./Hint";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import Help from "./Help";
import Queue from "./Queue";
import Status from "./Status";
import History, { Act } from "./History";
import Morning from "./Morning";
import { TRIAGE_SYSTEM, triagePrompt, parseTriage } from "./triageAsk.ts";
import Pane from "./Pane";
import Palette, { Pick } from "./Palette";
import Send, { RouteNote, Target } from "./Send";
import Settings from "./Settings";
import { findings, measure, Review, Route } from "./review";
import Threads from "./Threads";
import { applyTheme } from "./themes";
import { CHECK_SYSTEM, CORRECT_SYSTEM, prefsText, CAND_SYSTEM, Candidate as SkillCandidate, formatNote, indexLine, indexText, LEARN_SYSTEM, Note, parseNote, BRIEF_SYSTEM, MAP_SYSTEM, mapDomains, mapItems, recallText, stale, Stats, statOf, SWEEP_SYSTEM, TIDY_SYSTEM } from "./brain";
import Sidebar from "./Sidebar";
import PrView from "./PrView";
import Work, { WorkGroup, WorkRow } from "./Work";
import Usage from "./Usage";
import TicketView from "./TicketView";
import StartTicket, { promptOf } from "./StartTicket";
import { parse as parseDiff } from "./CodeReview";
import { TicketWork, firstKey, JiraConn, keyOfUrl, setKnownKeys, Ticket, TicketFull, TicketSeen, ticketNews, quietNews, BugJob, slugOf } from "./jira";
import { prNo, isLab, newsOf, openPr, prOf, PrStatus, PrTarget, prUrl, repoName, ReviewAsk } from "./pr";
import * as terms from "./terms";
import { rank } from "./route";
import { Brief, Change, Job, Progress, MAX_PARALLEL, setMapDirs, setPrefs, markAuto, isAuto, autoList, STATE_LABEL, replied, ago, Item, modelFor, SkillInfo, SkillUse, aboutOf, buildFolders, buildItems, aliveElsewhere, config, elsewhere, enrich, markSlept, setAlive, handoffCommand, Ledger, Merge, mergeCandidates, mergeKey, newCommand, Open, repoOf, resumeCommand, Session, TermState, Thread, waiting, withPrompt } from "./model";
import { selftest } from "./selftest";
import { tr } from "./i18n";
import "./App.css";

const MAX_PANES = 12;
/** 작업 페이지의 티켓 묶음 (JQL) */
const TICKET_GROUPS = [
  { id: "doing", title: tr("진행 중"), hint: tr("내게 배정된 진행 중 티켓"), jql: 'assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC' },
  { id: "todo", title: tr("할 일"), hint: tr("내게 배정된 아직 시작 안 한 티켓"), jql: 'assignee = currentUser() AND statusCategory = "To Do" ORDER BY priority DESC, updated DESC' },
  { id: "sprint", title: tr("이번 스프린트"), hint: tr("열린 스프린트의 내 티켓 (Jira Software)"), jql: "sprint in openSprints() AND assignee = currentUser() ORDER BY updated DESC" },
  { id: "reported", title: tr("내가 보고한 것"), hint: tr("내가 만든 안 끝난 티켓"), jql: "reporter = currentUser() AND statusCategory != Done ORDER BY updated DESC" },
];
const MIN_PANE_PX = 120;
/** 이보다 빨리 끝난 터미널은 닫지 않고 남겨서 왜 끝났는지 보이게 한다 */
const QUICK_EXIT_MS = 5000;
/** 답을 보낸 칸은 이만큼 손을 뗀 뒤에야 다음 기다리는 세션으로 바꾼다 */
/** 일하는 중이라는데 화면에 이만큼 아무것도 안 나오면 멈춘 것으로 본다 */
const QUIET_MS = 8000;
const SWAP_IDLE_MS = 4000;
/** 칸을 알아서 늘릴 때 칸 하나가 최소한 가져야 할 너비 */
const AUTO_PANE_PX = 520;
/** 빈 칸이 이만큼 비어 있으면 알아서 없앤다 */
const EMPTY_PANE_MS = 45_000;
/** 요약이 없는 최근 세션을 뒤에서 하나씩 요약한다. 한 번 켜 있는 동안 이만큼까지, 이 간격으로 */
const BACKFILL_MAX = 60;
const BACKFILL_EVERY_MS = 6000;
/** 한 번 켜 있는 동안 모델에게 판정을 맡기는 합치기 후보 수 */
const MAX_JUDGE = 8;
/** 한 일 목록에 두는 줄 수 */
const MAX_ACTS = 200;
/** 답을 받고 이만큼 쉰 세션은 요약을 남겨 둔다 */
const NOTE_AFTER_MS = 10 * 60_000;
// i18n-off
const NOTE_SYSTEM =
  "너는 작업 세션 요약기다. 첫 줄에 이 세션이 하는 일의 이름을 \"이름: \" 뒤에 적는다. 이름은 20자 안쪽의 명사구로, 무엇을 만들거나 고치는 일인지가 드러나야 한다(예: 이름: 재고 초과 주문 거절 처리). 사용자가 처음 한 말을 그대로 옮기지 않는다. 둘째 줄부터는 주어진 정보만으로 세 문장 이내로 요약한다: 무엇을 하는 세션인지, 어디까지 됐는지, 다음에 할 일. 레포·브랜치·티켓·PR 번호처럼 나중에 이 세션을 찾을 단서는 그대로 적는다. 다른 머리말이나 꾸밈은 쓰지 않는다.";
const PROGRESS_SYSTEM =
  "너는 작업 진행 정리기다. 한 가지 일을 이어 온 세션들의 요약을 시간 순서로 받는다. 그 일이 지금 어디까지 왔는지를 아래 네 줄로만 답한다. 줄마다 한 문장, 60자 안쪽으로 쓴다. 요약에 없는 것은 지어내지 않고, 해당하는 것이 없으면 그 줄에 \"없음\"이라고 적는다. 다른 머리말이나 꾸밈은 쓰지 않는다.\n목표: 이 일로 이루려는 것\n한 것: 지금까지 끝낸 것\n남은 것: 다음에 해야 할 것\n막힌 것: 사용자의 결정이나 확인을 기다리는 것, 또는 풀리지 않은 문제";
const JUDGE_SYSTEM =
  '두 Claude Code 세션이 같은 작업인지 판정한다. 같은 작업이란 목표가 같고, 한쪽이 다른 쪽의 연속이거나 같은 변경을 다루는 것이다. 같은 레포, 같은 브랜치, 같은 티켓이나 PR을 언급했다는 것만으로는 같다고 하지 않는다. 내용이 모자라 확실하지 않으면 same을 false로 한다. JSON 한 줄만 답한다: {"same": true 또는 false, "why": "판단 근거 한 문장"}';
// i18n-on
type Verdict = { same: boolean; why: string };
/** 인계 글을 이만큼 기다려도 안 오면 갈아타기를 그만둔다 */
const HANDOFF_TIMEOUT_MS = 5 * 60_000;

type Layout = { open: Open[]; panes: (string | null)[]; widths?: number[]; pinned?: string[]; focus: number; fontSize: number; sidebar: boolean };

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [open, setOpen] = useState<Open[]>([]);
  const [panes, setPanes] = useState<(string | null)[]>([null]);
  const [widths, setWidths] = useState([1]); // 칸 너비 비율
  const [focus, setFocus] = useState(0);
  const [states, setStates] = useState<Record<string, TermState>>({});
  const [dead, setDead] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<"palette" | "send" | "help" | "history" | "settings" | "threads" | "queue" | "quit" | "close" | "work" | "usage" | "morning" | null>(null);
  const [awaySince, setAwaySince] = useState(0); // 브리핑이 "그동안"의 기준으로 삼는 때
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tasks, setTasks] = useState<Job[]>([]); // 조율 세션이 맡긴 일감들
  const [memories, setMemories] = useState<Record<string, string>>({});
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const [notes, setNotes] = useState<Note[]>([]); // 브레인
  const [stats, setStats] = useState<Stats>({}); // 노트마다 쓰인 횟수
  const [hidden, setHidden] = useState<string[]>([]); // 점검이 목록에서 치운 세션. 파일은 그대로고 ⌘K로 찾으면 돌아온다
  const [misses, setMisses] = useState<{ at: number; said: string; wrong: string; right: string }[]>([]); // 보낼 곳을 틀렸던 사례
  const [changes, setChanges] = useState<Record<string, Change>>({}); // 작업 폴더 → 거기서 바뀐 것과 브리핑
  // 왼쪽 목록의 너비. 이 맥에서만 기억하면 되는 것이라 브라우저 저장소에 둔다
  const [sideW, setSideW] = useState(() => {
    try {
      return Math.min(600, Math.max(180, Number(localStorage.getItem("side-width")) || 284));
    } catch {
      return 284;
    }
  });
  const saveSideW = (w: number) => {
    setSideW(w);
    try {
      localStorage.setItem("side-width", String(w));
    } catch {
      // 저장이 막혀 있으면 이번에 켜 있는 동안만 유지된다
    }
  };
  /** 목록과 칸 사이 경계를 끌어 목록 너비를 바꾼다 */
  const dragSide = (e: React.MouseEvent) => {
    e.preventDefault();
    let last = sideW;
    const onMove = (ev: MouseEvent) => setSideW((last = Math.min(600, Math.max(180, ev.clientX))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      saveSideW(last);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [reviewing, setReviewing] = useState<string[]>([]); // 코드 검토를 펴 둔 세션들
  const [mapText, setMapText] = useState(""); // 레포 지도 (MAP.md)
  const [drawing, setDrawing] = useState(false);
  const [closing, setClosing] = useState(""); // 닫을지 묻고 있는 세션
  const [prShown, setPrShown] = useState<PrTarget | null>(null); // 펴 둔 PR 화면
  const [settingsAt, setSettingsAt] = useState<string | undefined>(undefined); // 설정을 열 때 먼저 보일 묶음
  // 열린 세션이 올린 PR의 형편. "소유자/레포#번호" → 형편
  const [prs, setPrs] = useState<Record<string, PrStatus>>({});
  // PR에 봐야 할 일이 생긴 세션: 터미널 키 → 까닭. 그 세션을 보면 풀린다
  const [prNews, setPrNews] = useState<Record<string, string>>({});
  // 지난번에 본 PR 형편. 견줘서 새로 생긴 일만 알린다. Julgi를 다시 켜도 이어지게 파일에 둔다
  const prSeen = useRef<Record<string, PrStatus>>({});
  // 작업 페이지의 "새로 읽기": 주기를 기다리지 않고 PR과 리뷰 요청을 바로 다시 읽는다
  const refreshPrs = useRef(() => {});
  // ── Jira ──
  const [ticketShown, setTicketShown] = useState<string | null>(null); // 펴 둔 티켓 화면
  const [startTicket, setStartTicket] = useState<TicketFull | null>(null); // "이 티켓으로 시작" 창
  const [tickets, setTickets] = useState<Ticket[]>([]); // 내게 배정된 안 끝난 티켓
  const [ticketNewsMap, setTicketNews] = useState<Record<string, string>>({}); // 티켓 키 → 새 소식
  const [ticketQuiet, setTicketQuiet] = useState(new Set<string>()); // 소식이 봇이나 조용히 받기로 한 사람의 댓글뿐인 티켓
  const quietRef = useRef(new Set<string>());
  const ticketNewsRef = useRef(ticketNewsMap);
  ticketNewsRef.current = ticketNewsMap;
  // 티켓 소식은 볼 때까지 남는다. 껐다 켜도 ⌘J에서 사라지지 않게 파일에 둔다
  const newsLoaded = useRef(false);
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "jira-news.json" }).then((t) => {
      try {
        if (t) setTicketNews((now) => ({ ...JSON.parse(t), ...now }));
      } catch {}
      newsLoaded.current = true;
    });
  }, []);
  useEffect(() => {
    // 조용히 받은 소식은 남기지 않는다. 다시 켜면 흐린 표시는 사라진다
    if (newsLoaded.current) void invoke("data_write", { name: "jira-news.json", text: JSON.stringify(Object.fromEntries(Object.entries(ticketNewsMap).filter(([k]) => !ticketQuiet.has(k)))) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketNewsMap]);
  const jiraSeen = useRef<Record<string, TicketSeen>>({});
  const [ticketLinks, setTicketLinks] = useState<Record<string, string>>({}); // 세션 ID → 티켓 키
  const [ticketDone, setTicketDone] = useState<Record<string, string>>({}); // 끝난(완료·거부) 티켓 키 → 상태 이름. 한 번 알린 것은 다시 알리지 않는다
  const doneRef = useRef<Record<string, string>>({});
  // 한꺼번에 맡긴 버그들. 다시 켜도 이어지게 bugs.json에 둔다
  const [bugJobs, setBugJobsState] = useState<BugJob[]>([]);
  const [bugStopped, setBugStopped] = useState(false);
  const bugs = useRef<{ jobs: BugJob[]; stopped: boolean; starting: boolean; loadedAt: number }>({ jobs: [], stopped: false, starting: false, loadedAt: 0 });
  const saveBugs = (jobs: BugJob[], stopped = bugs.current.stopped) => {
    bugs.current.jobs = jobs;
    bugs.current.stopped = stopped;
    setBugJobsState(jobs);
    setBugStopped(stopped);
    void invoke("data_write", { name: "bugs.json", text: JSON.stringify({ jobs, stopped }) });
  };
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "bugs.json" }).then((t) => {
      try {
        const v = t ? (JSON.parse(t) as { jobs: BugJob[]; stopped: boolean }) : { jobs: [], stopped: false };
        bugs.current = { jobs: v.jobs ?? [], stopped: !!v.stopped, starting: false, loadedAt: Date.now() };
        setBugJobsState(bugs.current.jobs);
        setBugStopped(bugs.current.stopped);
      } catch {
        bugs.current.loadedAt = Date.now();
      }
    });
  }, []);
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "jira-done.json" }).then((t) => {
      try {
        if (t) (doneRef.current = JSON.parse(t)), setTicketDone(doneRef.current);
      } catch {}
    });
  }, []);
  const endWhenIdle = useRef(new Set<string>()); // 끝낸 줄기의 칸 가운데 아직 답하는 중이라 못 닫은 것
  const refreshTickets = useRef((_keys = false) => {});
  // 화면 아래에 뜨는 한 번 묻기 (예: PR이 올라왔으니 티켓을 In Review로 옮길까?)
  const [offer, setOffer] = useState<{ text: string; yes: string; run: () => void } | null>(null);
  // 나한테 온 리뷰 요청. ⌘J 대기열의 아래 묶음이 된다
  const [asks, setAsks] = useState<ReviewAsk[]>([]);
  // 세션과 이어지지 않은 내 PR 가운데 봐야 할 일이 생긴 것: "소유자/레포#번호" → { PR, 까닭 }. ⌘J의 "내 PR"이 된다
  // 내가 연 열린 PR 전부 (챙길 PR이 "내 PR 전부"일 때). ⌘K에서 pr을 치면 고를 거리가 된다
  const [minePrs, setMinePrs] = useState<ReviewAsk[]>([]);
  const [mineNews, setMineNews] = useState<Record<string, ReviewAsk & { news: string }>>({});
  // 잠든 세션의 PR에 일이 생긴 것: 세션 ID → { 까닭, PR }. ⌘J의 내 차례에 올라오고, 고르면 깨운다
  const [sleepNews, setSleepNews] = useState<Record<string, { news: string; pr: PrTarget }>>({});
  const [reviews, setReviews] = useState<Review[]>([]); // 점검 기록. 판마다 값과 한 일이 남는다
  const [skillUses, setSkillUses] = useState<SkillUse[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillCands, setSkillCands] = useState<SkillCandidate[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); // 세션 ID → Julgi가 지은 이름
  const [progress, setProgress] = useState<Record<string, Progress>>({}); // 줄기 id(없으면 세션 id) → 어디까지 왔나
  // 답을 끝낸 세션마다 "내가 할 일이 있나"를 판정해 둔 것. 열쇠는 세션 id, since가 같을 때만 그 답의 판정이다
  const triaged = useRef<Record<string, { since: number; need: boolean; why: string }>>({});
  const triaging = useRef(new Map<string, number>()); // 판정하는 중인 세션 → 시작한 때
  const longRunTold = useRef<Record<string, number>>({}); // 오래 돈다고 이미 알린 차례(since)
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [finding, setFinding] = useState(false);
  const [handing, setHanding] = useState<string[]>([]);
  const [handed, setHanded] = useState<Record<string, number>>({}); // 방금 갈아타서 이어받은 칸. 잠깐 표시한다
  const [toast, setToast] = useState("");
  const [, setConfigTick] = useState(0);
  const lastCloseTry = useRef(0);
  const [info, setInfo] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [fontSize, setFontSize] = useState(13);
  const [home, setHome] = useState("/");
  const [restored, setRestored] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]); // 알아서 바꿔 끼우지 않을 세션
  const [judged, setJudged] = useState<Record<string, Verdict> | null>(null); // 합치기 후보에 대한 모델의 판정
  const judging = useRef({ busy: false, asked: 0 });
  const noted = useRef<Record<string, number>>({}); // 세션 → 요약을 남긴 때의 대화 기록 시각
  const noting = useRef(new Set<string>());
  const trustedOnce = useRef(new Set<string>()); // 폴더 믿음 물음에 대신 답해 준 터미널
  // 마지막으로 알린 세션. macOS는 어느 알림을 눌렀는지 알려 주지 않아서, 알린 뒤 곧 창이 앞으로 오면 알림을 눌렀다고 보고 그 세션을 띄운다
  const notified = useRef<{ key: string; at: number } | null>(null);
  const wantHandoff = useRef(new Set<string>()); // 세션이 스스로 갈아타 달라고 한 것. 답이 끝나면 한다
  const [acts, setActs] = useState<Act[]>([]); // Julgi가 알아서 한 일
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [base, setBase] = useState(""); // 레포가 드러나지 않는 일을 여는 기본 폴더
  const [moving, setMoving] = useState(""); // 다른 줄기로 옮기려는 말
  const saving = useRef<Promise<void>>(Promise.resolve()); // 설정 파일 쓰기를 한 줄로 세운다
  const learned = useRef<Record<string, number>>({}); // 줄기 id → 브레인에 담을 때 본 기억의 길이
  const learning = useRef(false);
  const tasksRef = useRef<Job[]>([]);
  const changesRef = useRef<Record<string, Change>>({});
  const turnSig = useRef<Record<string, string>>({});
  const turnFrom = useRef<Record<string, string>>({}); // 세션이 일을 시작할 때 찍어 둔 상태 // 세션이 일을 시작할 때의 폴더 변경 상태
  const briefing = useRef(new Set<string>()); // 브리핑을 만드는 중인 폴더
  const movedFrom = useRef({ said: "", name: "" }); // 옮기려는 말이 원래 간 곳
  const collecting = useRef(new Set<string>()); // 결과를 거두는 중인 일감
  const starting = useRef(new Set<string>()); // 세션을 띄우는 중인 일감
  const rawStates = useRef<Record<string, [string, number]>>({}); // 훅이 적은 그대로의 상태. 일감이 끝났는지는 짐작 없이 이것으로 본다
  const mapTried = useRef(false);
  const startedAt = useRef(Date.now()); // 켠 직후에는 값이 덜 모여 있어 점검을 미룬다
  const statsRef = useRef<Stats>({});
  const daily = useRef<{ day?: string; week?: string }>({}); // 매일 점검과 매주 점검을 마지막으로 한 날 (YYYY-MM-DD)
  const hiddenRef = useRef<string[]>([]);
  const mapState = useRef<{ at: number; repos: { repo: string; cwd: string }[] }>({ at: 0, repos: [] });
  const brainReady = useRef(false); // 브레인 파일을 다 읽었는가
  const learnAt = useRef(0);
  const shownAt = useRef<Record<string, number>>({}); // 세션을 마지막으로 칸에 띄워 본 때
  const emptySince = useRef(0); // 빈 칸이 생긴 때
  const backfillAt = useRef(0);
  const backfilled = useRef(0);
  const tried = useRef(new Set<string>()); // 이번에 켜 있는 동안 요약을 시도한 세션
  const warnedAway = useRef<Record<string, number>>({}); // 다른 곳에서 열려 있다고 알린 때
  const seen = useRef<Record<string, number>>({}); // 기다리는 답을 내가 칸에서 본 세션
  const answered = useRef<Record<string, number>>({}); // 내가 답을 보내 다시 일하기 시작한 때
  const lastStates = useRef<Record<string, TermState>>({});
  const previous = useRef<(string | null)[]>([null]); // 칸마다 직전에 보던 것
  const panesEl = useRef<HTMLDivElement>(null);
  const paneEls = useRef<(HTMLDivElement | null)[]>([]);

  // Julgi가 요약하며 지은 이름이 있으면 그것을 제목으로 쓴다. 처음 한 말은 said에 남아 찾을 때 쓰인다
  const sessions = useMemo(() => {
    const gone = new Set(hidden);
    // 치운 세션은 스크립트가 찍어 낸 세션과 같이 다룬다: 목록과 보낼 곳에서 빠지고 ⌘K로는 찾는다
    // 일감을 맡은 세션도 같다. 조율 세션의 일부라 따로 말을 걸 대상이 아니고, 보낼 곳 후보에 끼면 조율 세션으로 갈 말을 가로챈다
    for (const t of tasks) if (t.session) gone.add(t.session);
    return ledger ? enrich(ledger).map((s) => ({ ...s, title: names[s.id] ?? s.title, auto: s.auto || gone.has(s.id) })) : [];
  }, [ledger, names, hidden, tasks]);
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const items = useMemo(() => buildItems(sessions, threads, memories), [sessions, threads, memories]);
  const threadOf = (sessionId?: string) => (sessionId ? threads.find((t) => t.sessions.includes(sessionId)) : undefined);
  const current = panes[focus];
  const cwdOf = (key: string | null) => open.find((o) => o.key === key)?.cwd ?? (base || home);
  const folders = useMemo(() => buildFolders(sessions.filter((s) => exists[s.cwd] !== false)), [sessions, exists]);
  const candidates = useMemo(() => mergeCandidates(items), [items]);
  const waitCount = open.filter((o) => waiting(states[o.key])).length;

  // 키 처리와 이벤트 콜백은 한 번만 걸고, 최신 상태는 여기서 읽는다
  const live = useRef({ open, panes, widths, focus, states, overlay, sessions, home, base, fontSize, handing, byId, threads, memories, pinned, items, folders, names, zoom, notes, skills, reviews, acts, skillUses, closing, dead, mapText, skillCands, reviewing, prNews, asks, mineNews, prShown, sleepNews, ticketShown, ticketLinks, tickets });
  live.current = { open, panes, widths, focus, states, overlay, sessions, home, base, fontSize, handing, byId, threads, memories, pinned, items, folders, names, zoom, notes, skills, reviews, acts, skillUses, closing, dead, mapText, skillCands, reviewing, prNews, asks, mineNews, prShown, sleepNews, ticketShown, ticketLinks, tickets };

  const say = (message: string, ms = 3500) => {
    setToast(message);
    setTimeout(() => setToast((now) => (now === message ? "" : now)), ms);
  };

  /** 알아서 한 일을 남긴다. 화면에서 뭔가 사라졌을 때 ⌘Y로 찾아볼 수 있게 */
  const record = (kind: string, text: string, sessionId?: string) => {
    const act: Act = { at: Date.now(), kind, text, sessionId };
    setActs((list) => [...list, act].slice(-MAX_ACTS));
    void invoke("data_append", { name: "activity.jsonl", line: JSON.stringify(act) });
  };
  /** 열린 터미널을 사람이 알아볼 이름으로 */
  const nameOf = (key: string) => {
    const o = live.current.open.find((x) => x.key === key);
    const thread = live.current.threads.find((t) => o?.sessionId && t.sessions.includes(o.sessionId));
    return (thread?.name ?? (o?.sessionId && live.current.byId.get(o.sessionId)?.title) ?? o?.label ?? key).slice(0, 40);
  };
  const idOfKey = (key: string) => (key.startsWith("c:") ? key.slice(2) : undefined);

  const show = (key: string) => {
    const { panes, focus } = live.current;
    const at = panes.indexOf(key);
    if (at >= 0) return setFocus(at);
    previous.current[focus] = panes[focus];
    setPanes(panes.map((k, i) => (i === focus ? key : k)));
  };
  const openTerm = (o: Open, command?: string) => {
    terms.create({ key: o.key, cwd: o.cwd, command });
    setOpen((list) => (list.some((x) => x.key === o.key) ? list : [...list, o]));
    show(o.key);
  };
  const openSession = (s: Session) => {
    // 다른 터미널이나 앱에서 쓰고 있는 세션을 또 열면 같은 대화에 둘이 붙어 기록이 엉킨다. 한 번은 알린다
    if (elsewhere(s) && !live.current.open.some((o) => o.sessionId === s.id) && Date.now() - (warnedAway.current[s.id] ?? 0) > 6000) {
      warnedAway.current[s.id] = Date.now();
      return say(
        aliveElsewhere(s)
          ? tr`"${s.title.slice(0, 30)}"은 다른 곳에 열려 있다. 여기서만 쓸 거면 한 번 더 누른다. 양쪽에서 번갈아 쓰면 대화가 엉킨다.`
          : tr`"${s.title.slice(0, 30)}"은 방금까지 다른 곳에서 쓰던 세션이다. 거기서 닫았으면 한 번 더 누른다.`,
        7000,
      );
    }
    // 치워 둔 세션을 다시 열면 목록으로 돌아온다
    if (hiddenRef.current.includes(s.id)) saveHidden(hiddenRef.current.filter((id) => id !== s.id));
    openTerm({ key: "c:" + s.id, label: s.title, cwd: s.cwd, sessionId: s.id }, resumeCommand(s.id));
  };
  const newSession = (cwd: string) => {
    const id = crypto.randomUUID();
    openTerm({ key: "c:" + id, label: tr`새 세션 · ${repoOf(cwd)}`, cwd, sessionId: id }, newCommand(id));
  };
  /** ⌘T: 셸은 보던 것 옆에 칸을 하나 더 내서 연다. 지금 칸이 비었거나 칸이 꽉 찼으면 지금 칸에 연다 */
  const newShell = (cwd: string, command?: string, label?: string) => {
    const o: Open = { key: "s:" + crypto.randomUUID(), label: label ?? tr`셸 · ${repoOf(cwd)}`, cwd };
    const { panes, focus } = live.current;
    if (!panes[focus] || panes.length >= MAX_PANES) return openTerm(o, command);
    terms.create({ key: o.key, cwd, command });
    setOpen((list) => [...list, o]);
    split(o.key);
  };
  /** 줄기 기억(인계 글, 메모)에서 일이 끝나도 남길 것을 추려 브레인에 담는다 */
  const learn = async (thread: Thread, memory: string) => {
    learning.current = true;
    const mark = () => {
      learned.current[thread.id] = memory.length;
      void invoke("data_write", { name: "brain-learned.json", text: JSON.stringify(learned.current) });
    };
    try {
      const repo = live.current.byId.get(thread.sessions[thread.sessions.length - 1])?.repo ?? "";
      const shelf = live.current.notes.filter((n) => !n.repo || n.repo === repo).slice(0, 80);
      const prompt = `작업 이름: ${thread.name}\n레포: ${repo}\n\n이미 있는 노트:\n${shelf.map(indexLine).join("\n") || "(없음)"}\n\n작업 기록:\n${memory.slice(0, 9000)}\n`; // i18n-ok
      const raw = (await invoke<string | null>("route_ask", { system: LEARN_SYSTEM, prompt, model: modelFor("learn") })) ?? "";
      const found = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { notes?: { title?: string; kind?: string; body?: string; update?: number | null }[] }).notes ?? [];
      const titles: string[] = [];
      for (const f of found.slice(0, 5)) {
        if (!f.title?.trim() || !f.body?.trim()) continue;
        const old = typeof f.update === "number" ? shelf[f.update] : undefined;
        const note: Note = { id: old?.id ?? crypto.randomUUID().slice(0, 8), title: f.title.trim(), kind: f.kind ?? "사실", repo: old?.repo ?? repo, from: thread.name, created: old?.created ?? new Date().toISOString().slice(0, 10), body: f.body.trim() }; // i18n-ok
        const parsed = putNote(note);
        if (!parsed) continue;
        titles.push((old ? tr("고침: ") : "") + parsed.title);
      }
      if (titles.length) {
        record("배움", tr`"${thread.name.slice(0, 30)}"에서 브레인에 ${titles.length}개: ${titles.join(" / ").slice(0, 160)}`, thread.sessions[thread.sessions.length - 1]); // i18n-ok
      }
      mark();
    } catch {
      mark(); // 답이 깨졌으면 같은 기억으로 다시 묻지 않는다. 기억이 바뀌면 다시 본다
    } finally {
      learning.current = false;
    }
  };
  /**
   * 끊은 데서 배운다. 내가 세션을 끊고(Esc) 바로 한 말을 모아, 다음 세션들도 지켜야 할 "선호" 노트로 만든다.
   * 선호는 ~/.julgi/prefs.md 로 묶여 Julgi가 띄우는 모든 세션의 시스템 프롬프트에 붙는다. 점검 때마다 새로 쌓인 말만 본다
   */
  const learnCorrections = async (log: (text: string) => void) => {
    const seen = await invoke<string | null>("data_read", { name: "corrections-seen.json" }).then((t) => (t ? (JSON.parse(t) as { at: number }).at : 0), () => 0);
    const since = Math.max(seen, Math.floor(Date.now() / 1000) - 30 * 86400);
    const rows = await invoke<[number, string, string, string, string][]>("corrections", { since }).catch(() => []);
    // 모델에게 묻는 값을 하려면 어느 정도는 쌓여야 한다
    if (rows.length < 5) return;
    const shelf = live.current.notes.filter((n) => n.kind === "선호"); // i18n-ok
    // i18n-off
    const prompt = `이미 있는 선호:\n${shelf.map((n, i) => `${i}. ${n.repo ? `[${n.repo}] ` : ""}${n.title}`).join("\n") || "(없음)"}\n\n바로잡은 말들 (${rows.length}개):\n${rows
      .slice(-80)
      .map(([, , cwd, doing, said], i) => `${i}. 레포: ${repoOf(cwd)} | 세션이 하던 것: ${doing.slice(0, 160)} | 내가 한 말: ${said.slice(0, 300)}`)
      .join("\n")}\n`;
    // i18n-on
    try {
      const raw = (await invoke<string | null>("route_ask", { system: CORRECT_SYSTEM, prompt, model: modelFor("learn") })) ?? "";
      const found = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { notes?: { title?: string; body?: string; repo?: string; count?: number; update?: number | null }[] }).notes ?? [];
      const titles: string[] = [];
      for (const f of found.slice(0, 4)) {
        if (!f.title?.trim() || !f.body?.trim()) continue;
        const old = typeof f.update === "number" ? shelf[f.update] : undefined;
        const parsed = putNote({ id: old?.id ?? crypto.randomUUID().slice(0, 8), title: f.title.trim(), kind: "선호", repo: old?.repo ?? (f.repo ?? "").trim(), from: tr`바로잡은 말 ${f.count ?? 1}번`, created: old?.created ?? new Date().toISOString().slice(0, 10), body: f.body.trim() }); // i18n-ok
        if (parsed) titles.push((old ? tr("고침: ") : "") + parsed.title);
      }
      await invoke("data_write", { name: "corrections-seen.json", text: JSON.stringify({ at: rows[rows.length - 1][0] + 1 }) });
      if (titles.length) {
        log(tr`바로잡은 말 ${rows.length}개에서 선호 ${titles.length}개: ${titles.join(" / ").slice(0, 200)}`);
        record("배움", tr`바로잡은 말 ${rows.length}개에서 선호 ${titles.length}개를 담음: ${titles.join(" / ").slice(0, 160)}`); // i18n-ok
      }
    } catch {
      // 답이 깨졌으면 다음 점검 때 같은 말로 다시 본다
    }
  };
  // 선호 노트가 바뀌면 세션이 읽을 글을 다시 쓴다
  useEffect(() => {
    if (!brainReady.current) return;
    const text = config.brain ? prefsText(notes) : "";
    setPrefs(!!text);
    void invoke("data_write", { name: "prefs.md", text });
  }, [notes]);
  // 세션과 사람이 읽는 목차를 노트가 바뀔 때마다 다시 쓴다
  useEffect(() => {
    if (brainReady.current) void invoke("data_write", { name: "brain/INDEX.txt", text: indexText(notes, stats) });
  }, [notes, stats]);
  /** 노트가 쓰인 것을 센다. 무엇이 살아 있는 지식인지는 이 숫자로 가린다 */
  const bump = (ids: string[], field: "out" | "read" | "fixed") => {
    const next = { ...statsRef.current };
    for (const id of ids) {
      const s = { ...statOf(next, id) };
      s[field] += 1;
      s.last = Date.now();
      next[id] = s;
    }
    statsRef.current = next;
    setStats(next);
    void invoke("data_write", { name: "brain-stats.json", text: JSON.stringify(next) });
  };
  const putNote = (note: Note) => {
    const text = formatNote(note);
    const parsed = parseNote(note.id, text);
    if (!parsed) return undefined;
    // 고치기 전 것을 남겨 둔다. 노트가 어떻게 바뀌어 왔는지 되짚고 되돌릴 수 있게
    const before = live.current.notes.find((n) => n.id === note.id);
    if (before && (before.body !== parsed.body || before.title !== parsed.title)) void invoke("data_write", { name: `brain/history/${note.id}-${Date.now()}.md`, text: formatNote(before) });
    void invoke("data_write", { name: `brain/${note.id}.md`, text });
    const all = [parsed, ...live.current.notes.filter((n) => n.id !== note.id)];
    live.current.notes = all;
    setNotes(all);
    return parsed;
  };
  /** 일주일에 한 번: 같은 말을 하는 노트는 합치고, 서로 어긋나는 노트는 알린다 */
  const tidy = async (log: (text: string) => void): Promise<string[]> => {
    learning.current = true;
    const seen: string[] = [];
    try {
      const shelf = live.current.notes.slice(0, 80);
      const prompt = shelf.map((n, i) => `${i}. [${n.kind}] ${n.title} (${n.repo})\n   ${n.body.replace(/\s+/g, " ").slice(0, 500)}`).join("\n");
      const raw = (await invoke<string | null>("route_ask", { system: TIDY_SYSTEM, prompt, model: modelFor("tidy") })) ?? "";
      const answer = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { merge?: { keep: number; drop: number; title: string; body: string }[]; conflict?: { a: number; b: number; why: string }[] };
      const gone = new Set<string>();
      for (const m of answer.merge ?? []) {
        const keep = shelf[m.keep];
        const drop = shelf[m.drop];
        if (!keep || !drop || keep === drop || gone.has(keep.id) || gone.has(drop.id) || !m.body?.trim()) continue;
        gone.add(drop.id);
        putNote({ ...keep, title: m.title?.trim() || keep.title, body: m.body.trim() });
        forget(drop.id);
        log(tr`합침: "${drop.title.slice(0, 40)}" → "${keep.title.slice(0, 40)}"`);
      }
      for (const c of (answer.conflict ?? []).slice(0, 5)) {
        const a = shelf[c.a];
        const b = shelf[c.b];
        if (a && b) seen.push(tr`브레인: 서로 어긋나는 노트 "${a.title.slice(0, 40)}" ↔ "${b.title.slice(0, 40)}" · ${String(c.why).slice(0, 80)}`);
      }
    } catch {
      // 정리는 다음 점검에서 다시 해 본다
    } finally {
      learning.current = false;
    }
    return seen;
  };
  /** 하루에 한 번: 되풀이해서 시키는 일을 찾아 스킬 후보로 올린다 */
  const findCandidates = async () => {
    learning.current = true;
    try {
      const cutoff = Date.now() / 1000 - 30 * 86400;
      const rows = live.current.sessions.filter((s) => !s.auto && s.mtime > cutoff).slice(0, 150);
      if (rows.length < 10) return;
      const have = live.current.skills.map((k) => `- ${k.name}: ${k.description.slice(0, 120)}`).join("\n");
      const prompt = `이미 있는 스킬:\n${have || "(없음)"}\n\n시킨 일 목록:\n${rows.map((s, i) => `${i}. ${s.said.slice(0, 90)} | ${s.title.slice(0, 50)} | ${s.repo}`).join("\n")}\n`; // i18n-ok
      const raw = (await invoke<string | null>("route_ask", { system: CAND_SYSTEM, prompt, model: modelFor("cands") })) ?? "";
      const found = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { candidates?: { name: string; what: string; sessions: number[] }[] }).candidates ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const next: SkillCandidate[] = found
        .map((c) => ({ name: String(c.name), what: String(c.what), sessions: [...new Set(c.sessions ?? [])].map((n) => rows[n]?.id).filter(Boolean), found: today }))
        .map((c) => ({ ...c, count: c.sessions.length }))
        .filter((c) => c.count >= 3)
        .sort((a, b) => b.count - a.count);
      setSkillCands(next);
      void invoke("data_write", { name: "skill-candidates.json", text: JSON.stringify(next, null, 1) });
      if (next.length) record("스킬", tr`되풀이하는 일 ${next.length}가지를 찾음: ${next.map((c) => tr`${c.name}(${c.count}번)`).join(", ").slice(0, 160)}`); // i18n-ok
    } catch {
      // 내일 다시 본다
    } finally {
      learning.current = false;
    }
  };
  /** 노트를 브레인에서 내린다. 지우지 않고 retired 폴더로 옮겨서 다시 꺼낼 수 있다 */
  const forget = (id: string) => {
    const old = live.current.notes.find((n) => n.id === id);
    if (old) void invoke("data_write", { name: `brain/retired/${id}.md`, text: formatNote(old) });
    live.current.notes = live.current.notes.filter((n) => n.id !== id);
    setNotes(live.current.notes);
    void invoke("data_remove", { name: `brain/${id}.md` });
  };
  /**
   * 점검: 일주일에 한 번, 값을 재고 → 손댈 것을 손대고 → 판 번호를 붙여 기록으로 남긴다.
   * 쌓기만 하지 않으려는 것이다. 무엇을 내리고 합치고 고쳤는지가 판마다 남는다
   */
  /**
   * 레포 지도: 일하는 레포들이 어디 있고 무엇을 하며 서로 어떻게 이어지는지.
   * 세션이 다른 레포를 봐야 할 때 묻지 않고 찾아가 읽게 하려는 것이다. 지도에 든 레포는 세션을 띄울 때 읽을 수 있게 열어 준다
   */
  const mapRepos = async (): Promise<{ repo: string; cwd: string }[]> => {
    const { sessions, home, base } = live.current;
    const fixed = config.repos.map((p) => p.replace(/^~(?=\/|$)/, home).replace(/\/$/, ""));
    let picked: { repo: string; cwd: string }[];
    if (fixed.length) picked = fixed.map((cwd) => ({ repo: sessions.find((s) => s.cwd === cwd)?.repo ?? repoOf(cwd), cwd }));
    else {
      // 정해 둔 것이 없으면 최근 30일에 세 번 넘게 일한 레포를 고른다. 레포마다 가장 많이 쓴 폴더가 뿌리다
      const cutoff = Date.now() / 1000 - 30 * 86400;
      const by = new Map<string, Map<string, number>>();
      for (const s of sessions) {
        if (s.auto || s.mtime < cutoff || s.cwd === base || s.cwd === home) continue;
        const dirs = by.get(s.repo) ?? new Map<string, number>();
        dirs.set(s.cwd, (dirs.get(s.cwd) ?? 0) + 1);
        by.set(s.repo, dirs);
      }
      picked = [...by]
        .map(([repo, dirs]) => ({ repo, cwd: [...dirs].sort((a, b) => b[1] - a[1])[0][0], count: [...dirs.values()].reduce((a, b) => a + b, 0) }))
        .filter((r) => r.count >= 3)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
    const there = await invoke<boolean[]>("dirs_exist", { paths: picked.map((r) => r.cwd) }).catch(() => picked.map(() => true));
    // git 레포가 아닌 폴더(메모 폴더 같은 것)는 지도에 넣지 않는다
    const isGit = await invoke<boolean[]>("dirs_exist", { paths: picked.map((r) => r.cwd + "/.git") }).catch(() => picked.map(() => true));
    const worked = picked.filter((_, i) => there[i] && (fixed.length > 0 || isGit[i]));
    if (fixed.length) return worked;
    // 레포가 모여 있는 폴더를 정해 두었으면 그 아래의 레포 전부. 일한 적 있는 것을 앞에 세운다
    const roots = config.mapRoot.split(",").map((p) => p.trim().replace(/^~(?=\/|$)/, home).replace(/\/$/, "")).filter(Boolean);
    if (roots.length) {
      const under = await invoke<string[]>("git_siblings", { paths: roots.map((root) => root + "/_") }).catch(() => []);
      const rows = under.map((cwd) => worked.find((r) => r.cwd === cwd) ?? { repo: repoOf(cwd), cwd });
      return [...rows.filter((r) => worked.includes(r)), ...rows.filter((r) => !worked.includes(r))].slice(0, 30);
    }
    // 일한 레포 옆에 놓인 레포도 넣는다. 일한 적은 없어도 참고하러 가야 할 곳(앱, 다른 서버, 배포 설정)이 거기 있다
    const near = await invoke<string[]>("git_siblings", { paths: worked.map((r) => r.cwd) }).catch(() => []);
    const all = [...worked, ...near.filter((cwd) => !worked.some((r) => r.cwd === cwd || cwd.startsWith(r.cwd + "/"))).map((cwd) => ({ repo: repoOf(cwd), cwd }))];
    return all.filter((r, i) => all.findIndex((x) => x.cwd === r.cwd) === i).slice(0, 24);
  };
  const buildMap = async (repos: { repo: string; cwd: string }[]) => {
    if (!repos.length) return;
    learning.current = true;
    try {
      // 낡은 코드로 지도를 그리지 않게 먼저 원격에서 받아 온다. 작업 중인 레포는 건드리지 않는다
      const synced = config.mapFetch ? await Promise.all(repos.map((r) => invoke<string>("repo_sync", { path: r.cwd }).catch(() => "실패"))) : []; // i18n-ok
      const pulled = repos.filter((_, i) => synced[i]?.startsWith("당김")); // i18n-ok
      const behind = repos.map((r, i) => (synced[i]?.startsWith("뒤처짐") ? tr`${r.repo}(${synced[i].slice(4)}커밋)` : "")).filter(Boolean); // i18n-ok
      const failed = repos.filter((_, i) => synced[i] === "실패").map((r) => r.repo); // i18n-ok
      const parts = await Promise.all(
        repos.map(async (r) => {
          const peek = await invoke<string>("repo_peek", { path: r.cwd });
          // 코드에 다른 레포의 이름이 나오는 곳이 레포끼리 이어져 있다는 증거다
          const refs = await invoke<string>("repo_refs", { path: r.cwd, names: repos.filter((x) => x.repo !== r.repo).map((x) => x.repo) }).catch(() => "");
          const did = live.current.sessions.filter((s) => s.repo === r.repo && !s.auto).slice(0, 8).map((s) => s.title.slice(0, 50)).join(" / ");
          return `### ${r.repo}\n경로: ${r.cwd}\n${peek.slice(0, repos.length > 10 ? 1900 : 3600)}\n여기서 한 일: ${did || "(이 사람이 여기서 일한 적은 없다)"}\n코드에 다른 레포 이름이 나오는 곳:\n${refs || "(없음)"}`; // i18n-ok
        }),
      );
      const text = ((await invoke<string | null>("route_ask", { system: MAP_SYSTEM, prompt: parts.join("\n\n"), model: modelFor("map") })) ?? "").trim();
      if (!text.includes("## ")) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const whole = `# 레포 지도 (${stamp}에 Julgi가 그림)\n\n${text}\n`; // i18n-ok
      await invoke("data_write", { name: "MAP.md", text: whole });
      await invoke("data_write", { name: "map.json", text: JSON.stringify({ at: Date.now(), repos }) });
      mapState.current = { at: Date.now(), repos };
      setMapText(whole); // 파일과 같은 글이어야 화면이 첫 레포를 빠뜨리지 않는다
      setMapDirs(repos.map((r) => r.cwd));
      record("지도", [tr`레포 ${repos.length}개의 지도를 그림`, pulled.length ? tr`최신으로 당긴 것 ${pulled.length}개(${pulled.map((r) => r.repo).join(", ").slice(0, 80)})` : "", behind.length ? tr`작업 중이라 그대로 둔 것: ${behind.join(", ").slice(0, 120)}` : "", failed.length ? tr`받아 오지 못한 것: ${failed.join(", ").slice(0, 80)}` : ""].filter(Boolean).join(" · ")); // i18n-ok
    } catch {
      // 다음 점검에서 다시 그린다
    } finally {
      learning.current = false;
    }
  };
  /** 지도가 없거나, 일하는 레포가 늘거나 줄었거나, 매주 점검 때면 다시 그린다 */
  const refreshMap = async (force: boolean) => {
    const repos = await mapRepos();
    const same = repos.map((r) => r.cwd).sort().join("|") === mapState.current.repos.map((r) => r.cwd).sort().join("|");
    if (force || !same) await buildMap(repos);
  };
  const saveHidden = (ids: string[]) => {
    hiddenRef.current = ids;
    setHidden(ids);
    void invoke("data_write", { name: "hidden.json", text: JSON.stringify(ids) });
  };
  /** 세션 목록을 모델이 읽고: 같은 일은 한 줄기로 묶고, 끝난 일은 내리고, 볼 일 없는 것은 치운다 */
  const sweep = async (scope: Item[], task: "sweep" | "sweepAll", log: (text: string) => void) => {
    const CHUNK = 110;
    for (let from = 0; from < Math.min(scope.length, CHUNK * 3); from += CHUNK) {
      const part = scope.slice(from, from + CHUNK);
      if (part.length < 2) break;
      const line = (item: Item, i: number) => {
        const s = item.session;
        const about = (live.current.memories[s.id] || s.recap || "").replace(/\s+/g, " ").slice(0, 170);
        return `${i}. ${item.name.slice(0, 50)} | 처음 한 말: ${s.said.slice(0, 60)} | ${s.repo} ${s.branch} | ${Math.round(s.tokens / 1000)}k | ${ago(s.mtime)}${item.thread ? ` | 줄기(세션 ${item.thread.sessions.length})` : ""}${about ? ` | ${about}` : ""}`; // i18n-ok
      };
      try {
        const raw = (await invoke<string | null>("route_ask", { system: SWEEP_SYSTEM, prompt: part.map(line).join("\n"), model: modelFor(task) })) ?? "";
        const answer = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { groups?: { sessions: number[]; name?: string; why?: string }[]; done?: { n: number; why?: string }[]; trivial?: { n: number; why?: string }[] };
        const openIds = new Set(live.current.open.map((o) => o.sessionId));
        for (const g of (answer.groups ?? []).slice(0, 10)) {
          const members = [...new Set(g.sessions ?? [])].map((n) => part[n]).filter(Boolean);
          if (members.length < 2) continue;
          for (const m of members.slice(1)) joinThreads(members[0].session.id, m.session.id, true);
          const thread = live.current.threads.find((t) => t.sessions.includes(members[0].session.id));
          if (thread && !thread.named && g.name?.trim()) saveThreads(live.current.threads.map((t) => (t.id === thread.id ? { ...t, name: g.name!.trim().slice(0, 40) } : t)));
          log(tr`묶음: ${members.map((m) => `"${m.name.slice(0, 24)}"`).join(" + ")} → "${(g.name ?? thread?.name ?? "").slice(0, 30)}" · ${String(g.why ?? "").slice(0, 70)}`);
        }
        for (const d of (answer.done ?? []).slice(0, 15)) {
          const item = part[d.n];
          const ids = item?.thread?.sessions ?? (item ? [item.session.id] : []);
          // 열려 있는 일은 내가 보고 있는 것이라 건드리지 않는다
          if (!item || ids.some((id) => openIds.has(id)) || live.current.threads.find((t) => t.sessions.includes(item.session.id))?.done) continue;
          finishThread(item.session.id, true);
          log(tr`끝냄: "${item.name.slice(0, 40)}" · ${String(d.why ?? "").slice(0, 70)}`);
        }
        const gone = (answer.trivial ?? []).slice(0, 20).map((t) => part[t.n]).filter((item) => item && !item.thread && !openIds.has(item.session.id));
        if (gone.length) {
          saveHidden([...new Set([...hiddenRef.current, ...gone.map((item) => item.session.id)])]);
          for (const item of gone) log(tr`치움: "${item.name.slice(0, 40)}"`);
        }
      } catch {
        // 이 묶음은 다음 점검에서 다시 본다
      }
    }
  };
  /**
   * 브레인 노트가 가리키는 코드 이름(클래스, 파일, 설정 키)이 그 레포에 아직 있는지 본다.
   * 노트에 든 이름이 둘 넘게 있는데 하나도 안 남아 있으면 낡았을 가능성이 크다. 모델 없이 git으로 센다
   */
  const staleNotes = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const note of live.current.notes.slice(0, 120)) {
      const cwd = mapState.current.repos.find((r) => r.repo === note.repo)?.cwd;
      if (!cwd) continue;
      // 코드 이름처럼 생긴 것: 낱말 안에 대문자나 밑줄, 점이 섞인 여섯 자 넘는 영문
      const names = [...new Set(`${note.title} ${note.body}`.match(/[A-Za-z][A-Za-z0-9]*(?:[A-Z_.][A-Za-z0-9]+)+/g) ?? [])].filter((w) => w.length >= 6 && !/^https?/.test(w) && !/^v?\d/.test(w)).slice(0, 6);
      if (names.length < 2) continue;
      const found = await invoke<boolean[]>("repo_has", { path: cwd, words: names }).catch(() => []);
      if (found.length && !found.some(Boolean)) out.push(tr`브레인: "${note.title.slice(0, 44)}" 노트가 가리키는 이름(${names.slice(0, 3).join(", ")})이 ${note.repo} 코드에 하나도 없다. 낡았을 수 있다`);
    }
    return out.slice(0, 8);
  };
  /**
   * 되풀이해서 시킨 일(스킬 후보) 가운데 가장 많이 나온 것을 스킬로 만든다. 한 주에 하나까지.
   * 작은 모델이 아니라 세션을 띄워 근거가 된 대화 기록을 직접 읽고 쓰게 한다. 만든 스킬은 Julgi가 띄우는 모든 세션에 붙는다
   */
  const growSkill = async (log: (text: string) => void) => {
    const made = (await invoke<string | null>("data_read", { name: "skills-made.json" }).then((t) => (t ? (JSON.parse(t) as { name: string; at: number }[]) : []))).filter((m) => m.name);
    if (made.some((m) => Date.now() - m.at < 7 * 86_400_000)) return;
    const have = new Set([...live.current.skills.map((k) => k.name), ...made.map((m) => m.name)]);
    const pick = live.current.skillCands.find((c) => c.count >= 3 && /^[a-z0-9][a-z0-9-]{2,40}$/.test(c.name) && !have.has(c.name));
    if (!pick) return;
    const files = pick.sessions.slice(0, 5).map((id) => `~/.claude/projects/*/${id}.jsonl`);
    await invoke("data_write", { name: "grown/.claude-plugin/plugin.json", text: JSON.stringify({ name: "julgi-grown", description: "Julgi가 되풀이되는 일에서 만든 스킬", version: "1.0.0" }, null, 2) }); // i18n-ok
    const text = `[Julgi: 되풀이해서 시킨 일을 스킬로 만든다]\n\n이 사람은 "${pick.what}" 같은 일을 최근 ${pick.count}번 시켰다. 다음부터 어느 세션이든 같은 방법으로 하도록 Claude Code 스킬을 하나 만든다.\n\n1. 근거가 된 대화 기록을 읽는다(JSONL, 길면 필요한 부분만): ${files.join(", ")}\n2. 실제로 어떤 순서로 했는지, 어디서 막혔고 사용자가 무엇을 바로잡았는지 뽑는다. 기록에 없는 절차는 지어내지 않는다.\n3. 이 폴더에 skills/${pick.name}/SKILL.md 를 쓴다. 맨 위에 name: ${pick.name} 과 description(언제 쓰는지, 사용자가 할 법한 말과 함께 한 문단)을 frontmatter로 두고, 본문에 순서, 쓰는 명령, 흔한 함정, 끝났다고 볼 기준을 적는다. 특정한 한 번의 일이 아니라 다음에도 통하게 쓴다.\n4. 머지·푸시·배포·삭제·데이터 변경처럼 되돌리기 어려운 단계는 스킬이 직접 하게 쓰지 않고 "사용자에게 묻는다"고 적는다. 비밀 값(토큰, 비밀번호)은 적지 않는다.\n5. 다 쓰면 무엇을 근거로 무엇을 담았는지 세 줄로 답하고 끝낸다. 다른 파일은 건드리지 않는다.`; // i18n-ok
    const home = live.current.home;
    const session = await dispatch({ kind: "new", cwd: `${home}/.julgi/grown` }, text, { rank: -1, by: "일감 스킬 만들기" }, false, true); // i18n-ok
    if (typeof session !== "string") return;
    await invoke("data_write", { name: "skills-made.json", text: JSON.stringify([...made, { name: pick.name, at: Date.now(), what: pick.what, count: pick.count, session }], null, 1) });
    log(tr`스킬 만들기 시작: ${pick.name} (${pick.count}번 되풀이한 일). 세션이 쓰고 있다`);
    record("스킬", tr`되풀이한 일로 스킬을 만든다: ${pick.name} · ${pick.what.slice(0, 80)}`, session); // i18n-ok
  };
  /**
   * 있는 스킬을 가꾼다. 판단은 숫자로 한다.
   * - 다듬기: 최근 30일에 세션 세 곳 넘게 쓰인 스킬 가운데 가장 많이 쓰인 것 하나를, 쓰인 기록에 비추어 고친다. 한 주에 하나, 같은 스킬은 30일에 한 번.
   *   세션은 고친 글을 revised/에만 쓰고 julgi skill apply를 부른다. 바꿔 넣는 것은 Julgi가 하고 옛 글은 skill-history/에 남긴다.
   * - 내리기: Julgi가 만든 스킬이 만든 지 60일이 넘도록 한 번도 안 쓰였으면 grown/retired/로 옮긴다.
   * 손대는 것은 내 스킬(~/.claude/skills의 진짜 폴더)과 Julgi가 만든 스킬뿐이다. 링크로 걸린 스킬, 레포의 스킬, Julgi 자신의 스킬은 건드리지 않는다
   */
  const tendSkills = async (log: (text: string) => void) => {
    const { skills, skillUses, home } = live.current;
    const now = Date.now();
    const bare = (name: string) => name.split(":").pop() ?? name;
    const usedIn = (name: string, days: number) => [...new Set(skillUses.filter((u) => bare(u.skill) === name && now - Date.parse(u.at) < days * 86_400_000).map((u) => u.session))];
    for (const k of skills.filter((k) => k.source === "Julgi가 만듦" && now / 1000 - k.modified > 60 * 86400 && usedIn(k.name, 45).length === 0)) { // i18n-ok
      const moved = await invoke<string>("skill_retire", { name: k.name }).catch(() => "");
      if (!moved) continue;
      log(tr`스킬 내림: ${k.name} (만든 지 60일이 넘도록 안 쓰임). ~/.julgi/grown/retired에 있다`);
      record("스킬", tr`안 쓰이는 스킬을 내림: ${k.name}`); // i18n-ok
    }
    const tended = await invoke<string | null>("data_read", { name: "skills-tended.json" }).then((t) => (t ? (JSON.parse(t) as { name: string; at: number }[]) : []), () => []);
    if (tended.some((t) => now - t.at < 7 * 86_400_000)) return;
    const pick = skills
      .filter((k) => (k.source === "내 스킬" || k.source === "Julgi가 만듦") && !k.linked && /^[a-z0-9][a-z0-9-]{1,60}$/.test(k.name)) // i18n-ok
      .filter((k) => !tended.some((t) => t.name === k.name && now - t.at < 30 * 86_400_000))
      .map((k) => ({ skill: k, used: usedIn(k.name, 30) }))
      .filter((row) => row.used.length >= 3)
      .sort((a, b) => b.used.length - a.used.length)[0];
    if (!pick) return;
    const { name, path } = pick.skill;
    const files = pick.used.slice(0, 6).map((id) => `~/.claude/projects/*/${id}.jsonl`);
    const text = `[Julgi: 자주 쓰는 스킬을 쓰인 기록에 비추어 다듬는다]\n\n"${name}" 스킬이 최근 30일에 세션 ${pick.used.length}곳에서 쓰였다. 실제로 쓰인 기록을 보고, 스킬 때문에 일이 어긋난 곳이 되풀이되면 그 부분만 고친다.\n\n1. 지금 스킬을 읽는다: ${path}\n2. 쓰인 기록을 읽는다(JSONL이고 길다. 스킬 이름으로 찾아 그 뒤만 본다): ${files.join(", ")}\n3. 세션마다 센다: (가) 스킬대로 했다가 틀려서 사용자가 바로잡은 곳 (나) 스킬에 없어서 매번 헤매거나 다시 찾아야 했던 단계 (다) 스킬에 적혀 있지만 이제 안 맞는 명령·경로·이름.\n4. 같은 문제가 세션 두 곳 넘게 나온 것만 고친다. 한 번뿐인 일은 고치지 않는다. 고칠 것이 없으면 아무 파일도 쓰지 말고 "고칠 것 없음"과 센 숫자만 답하고 끝낸다.\n5. 고칠 것이 있으면 고친 전체 글을 이 폴더의 revised/${name}/SKILL.md 에 쓴다. 원본은 직접 건드리지 않는다. frontmatter의 name은 그대로 두고, 문제가 된 곳만 바꾸고 나머지 글은 글자 그대로 둔다. 되돌리기 어려운 단계(머지·푸시·배포·삭제·데이터 변경)를 스킬이 묻지 않고 하게 바꾸지 않는다. 비밀 값은 적지 않는다.\n6. 그런 다음 ~/.julgi/bin/julgi skill apply ${name} "무엇을 왜 바꿨는지 한 문장 (근거 세션 수)" 를 실행한다. Julgi가 옛 글을 따로 남기고 바꿔 넣는다.\n7. 센 숫자와 바꾼 것을 세 줄로 답하고 끝낸다. 다른 파일은 건드리지 않는다.`; // i18n-ok
    const session = await dispatch({ kind: "new", cwd: `${home}/.julgi/grown` }, text, { rank: -1, by: "일감 스킬 다듬기" }, false, true); // i18n-ok
    if (typeof session !== "string") return;
    await invoke("data_write", { name: "skills-tended.json", text: JSON.stringify([...tended, { name, at: now, uses: pick.used.length, session }], null, 1) });
    log(tr`스킬 다듬기 시작: ${name} (30일에 세션 ${pick.used.length}곳에서 쓰임). 세션이 쓰인 기록을 읽고 있다`);
    record("스킬", tr`자주 쓰는 스킬을 쓰인 기록에 비추어 다듬는다: ${name} · 세션 ${pick.used.length}곳`, session); // i18n-ok
  };
  /** kind: 매일은 최근 일주일에 쓴 세션만, 매주는 전부를 보고 브레인까지 정리한다 */
  const review = async (kind: "매일" | "매주") => { // i18n-ok
    const did: string[] = [];
    const log = (text: string) => void did.push(text);
    learning.current = true;
    const cutoff = Date.now() / 1000 - 7 * 86400;
    const live0 = live.current.items.filter((item) => !item.thread?.done);
    await sweep(kind === "매일" ? live0.filter((item) => item.session.mtime > cutoff) : live0, kind === "매일" ? "sweep" : "sweepAll", log); // i18n-ok
    await findCandidates();
    if (config.brain) await learnCorrections(log);
    learning.current = true;
    if (config.growSkills) await growSkill(log);
    if (config.growSkills && kind === "매주") await tendSkills(log); // i18n-ok
    await refreshMap(kind === "매주"); // i18n-ok
    learning.current = true;
    if (kind === "매주") { // i18n-ok
    // 1. 안 쓰이는 노트를 내린다
    // 선호는 세션마다 늘 붙으니 쓰임을 세지 않는다. 안 쓰였다고 내리지 않는다
    for (const n of live.current.notes.filter((n) => n.kind !== "선호" && stale(n, statOf(statsRef.current, n.id)))) { // i18n-ok
      forget(n.id);
      log(tr`내림: "${n.title.slice(0, 50)}" (석 달 넘게 안 쓰임)`);
    }
    }
    // 2. 겹치는 노트를 합치고 어긋나는 짝을 찾는다 (매주)
    const seen = kind === "매주" && live.current.notes.length >= 6 ? await tidy(log) : []; // i18n-ok
    if (kind === "매주") seen.push(...(await staleNotes())); // i18n-ok
    learning.current = false;
    // 3. 값을 재서 판으로 남긴다
    const text = (await invoke<string | null>("data_read", { name: "routes.jsonl" })) ?? "";
    const routes: Route[] = [];
    for (const line of text.split("\n")) {
      try {
        if (line) routes.push(JSON.parse(line));
      } catch {
        // 깨진 줄은 건너뛴다
      }
    }
    const { notes, skills, sessions, names, acts, skillUses } = live.current;
    const metrics = measure({ routes, moved: acts.filter((a) => a.kind === "옮김").length, notes, stats: statsRef.current, skills, skillUses, sessions, names }); // i18n-ok
    const all = live.current.reviews;
    const next: Review = { v: (all[all.length - 1]?.v ?? 0) + 1, kind, at: Date.now(), metrics, did, seen: [...findings(metrics, skills, skillUses), ...seen] };
    live.current.reviews = [...all, next];
    setReviews(live.current.reviews);
    void invoke("data_write", { name: "reviews.json", text: JSON.stringify(live.current.reviews, null, 1) });
    record("점검", tr`${next.v}판(${tr(kind)}): 손댄 것 ${did.length}개, 눈에 띈 것 ${next.seen.length}개. ⌘G의 통계에서 본다`); // i18n-ok
  };
  /** 답을 끝낸 세션의 마지막 답을 읽고, 내가 할 일이 있는지 판정해 둔다. 판정하지 못하면 할 일이 있는 것으로 둔다 */
  const triage = async (sessionId: string, since: number) => {
    if (triaging.current.has(sessionId)) return;
    triaging.current.set(sessionId, Date.now());
    let verdict = { since, need: true, why: "" };
    try {
      const pair = await invoke<[string, string] | null>("last_exchange", { sessionId });
      if (pair?.[1]) {
        // 물음은 대개 답의 끝에 있다
        const raw = (await invoke<string | null>("route_ask", { system: TRIAGE_SYSTEM, prompt: triagePrompt(pair[0], pair[1]), model: modelFor("note") })) ?? "";
        verdict = { since, ...parseTriage(raw) };
      }
    } catch {
      // 못 읽었으면 내 차례로 둔다. 놓치는 것보다 한 번 더 부르는 편이 낫다
    }
    triaged.current = { ...triaged.current, [sessionId]: verdict };
    triaging.current.delete(sessionId);
    void invoke("data_write", { name: "triage.json", text: JSON.stringify(Object.fromEntries(Object.entries(triaged.current).slice(-200))) });
  };
  /** 요약이 새로 나온 세션이 속한 일(줄기, 아니면 그 세션 하나)이 어디까지 왔는지 네 줄로 정리해 둔다 */
  const trackProgress = async (sessionId: string, latest: string) => {
    const thread = live.current.threads.find((t) => t.sessions.includes(sessionId));
    const key = thread?.id ?? sessionId;
    // 줄기면 이어 온 세션들의 요약을 순서대로, 마지막 여섯 개까지
    const ids = thread ? thread.sessions.slice(-6) : [sessionId];
    const parts = ids.map((id) => (id === sessionId ? latest : memoriesRef.current[id])).filter(Boolean);
    if (!parts.length) return;
    try {
      const prompt = `일의 이름: ${thread?.name ?? live.current.names[sessionId] ?? ""}\n\n${parts.map((p, i) => `세션 ${i + 1} 요약:\n${p.slice(0, 1200)}`).join("\n\n")}\n`; // i18n-ok
      const text = (await invoke<string | null>("route_ask", { system: PROGRESS_SYSTEM, prompt, model: modelFor("note") })) ?? "";
      const pick = (label: string) => (text.match(new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, "m"))?.[1] ?? "").trim().slice(0, 160);
      const none = (v: string) => (/^(없음|none|n\/a|-)\.?$/i.test(v) ? "" : v);
      const made: Progress = { goal: none(pick("목표")), done: none(pick("한 것")), left: none(pick("남은 것")), blocked: none(pick("막힌 것")), at: Date.now() }; // i18n-ok
      if (!made.goal && !made.done && !made.left) return;
      const next = { ...progressRef.current, [key]: made };
      progressRef.current = next;
      setProgress(next);
      void invoke("data_write", { name: "progress.json", text: JSON.stringify(next) });
    } catch {
      // 진행 정리는 없어도 된다. 다음 요약 때 다시 해 본다
    }
  };
  /** 세션의 요약을 작은 모델로 만들어 둔다. 대화 기록이 그대로면 다시 만들지 않는다 */
  const summarize = async (sessionId: string) => {
    const s = live.current.byId.get(sessionId);
    if (!config.summarize || !s || s.auto || noting.current.has(sessionId) || ((noted.current[sessionId] ?? 0) >= s.mtime && live.current.names[sessionId])) return;
    noting.current.add(sessionId);
    try {
      const pair = await invoke<[string, string] | null>("last_exchange", { sessionId });
      if (!pair?.[1]) return;
      const prompt = `처음 한 말: ${s.said}\n레포: ${s.repo} · 브랜치: ${s.branch || "없음"}\n${s.recap ? `앞선 요약: ${s.recap}\n` : ""}\n마지막으로 사용자가 한 말:\n${pair[0].slice(0, 1500)}\n\n마지막 답:\n${pair[1].slice(0, 3000)}\n`; // i18n-ok
      const text = ((await invoke<string | null>("route_ask", { system: NOTE_SYSTEM, prompt, model: modelFor("note") })) ?? "").trim();
      if (!text) return;
      // 첫 줄의 이름은 떼어 세션 제목으로 쓰고, 나머지를 요약으로 둔다
      const named = text.match(/^이름:\s*(.+)\n?/);
      const name = named?.[1].replace(/["'`*]/g, "").trim().slice(0, 40);
      const body = (named ? text.slice(named[0].length) : text).trim();
      if (name) {
        const next = { ...live.current.names, [sessionId]: name };
        live.current.names = next;
        setNames(next);
        void invoke("data_write", { name: "names.json", text: JSON.stringify(next) });
        // 내가 이름을 짓지 않은 줄기는 가장 최근 세션의 이름을 따라간다
        const thread = live.current.threads.find((t) => t.sessions.includes(sessionId));
        if (thread && !thread.named && thread.sessions[thread.sessions.length - 1] === sessionId && thread.name !== name)
          saveThreads(live.current.threads.map((t) => (t.id === thread.id ? { ...t, name } : t)));
      }
      if (!body) return;
      setMemories((old) => ({ ...old, [sessionId]: body }));
      void trackProgress(sessionId, body);
      noted.current[sessionId] = s.mtime;
      void invoke("data_write", { name: `threads/${sessionId}.md`, text: body });
      void invoke("data_write", { name: "notes.json", text: JSON.stringify(noted.current) });
    } catch {
      // 요약은 없어도 된다. 다음에 다시 해 본다
    } finally {
      noting.current.delete(sessionId);
    }
  };
  /**
   * 세션이 답을 끝낸 폴더에서 바뀐 양을 세고, 변경이 달라졌으면 브리핑을 만든다.
   * 세는 것은 git이 하고(매번), 브리핑은 모델이 변경 내용을 읽고 쓴다(변경이 달라졌을 때만)
   */
  const checkChanges = async (cwd: string, sessionId: string, before?: string, from?: string) => {
    const stat = await invoke<[number, number, number, string, number] | null>("repo_stat", { path: cwd }).catch(() => null);
    if (!stat) return;
    const [tracked, adds0, dels0, sig, untracked] = stat;
    let [adds, dels] = [adds0, dels0];
    const old = changesRef.current[cwd];
    // git이 모르는 파일은 처음 봤을 때 있던 만큼을 빼고 센다. 세션이 오기 전부터 놓여 있던 것까지 "바뀐 것"으로 치지 않으려는 것이다
    const untracked0 = old?.untracked0 ?? untracked;
    let files = tracked + Math.max(0, untracked - untracked0);
    // 이 세션이 일하는 동안 변경이 달라졌을 때만 이 세션의 것으로 친다. 같은 폴더의 다른 세션이 답만 한 경우에는 표시를 옮기지 않는다
    const mine = before !== undefined && before !== sig;
    const by = mine ? sessionId : old?.by;
    const save = (next: Change) => {
      changesRef.current = { ...changesRef.current, [cwd]: next };
      setChanges(changesRef.current);
      void invoke("data_write", { name: "changes.json", text: JSON.stringify(changesRef.current) });
    };
    // 이 답에서 변경이 달라졌으면 끝난 순간도 찍어 두고, 시작과 끝을 한 판으로 남긴다
    let turns = old?.turns ?? [];
    if (mine && from) {
      const to = await invoke<string | null>("repo_snapshot", { path: cwd, name: `${sessionId.slice(0, 8)}-${Date.now()}` }).catch(() => null);
      if (to && to !== from) {
        // 이력에서 "몇 번 전 답" 대신 보여 줄 이름: 이 답을 부른 내 말의 첫 줄과, 이 답에서 바뀐 파일 수
        const said = (await invoke<[string, string] | null>("last_exchange", { sessionId }).catch(() => null))?.[0]?.trim().split("\n")[0].slice(0, 80);
        const one = await invoke<string | null>("repo_diff", { path: cwd, from, to, file: null }).catch(() => null);
        turns = [...turns, { at: Date.now(), from, to, session: sessionId, said, files: one ? parseDiff(one).length : undefined }].slice(-12);
      }
    }
    // 세는 범위를 코드 검토의 "이 세션이 고친 것"과 맞춘다: 그 세션의 첫 답 앞에서 지금까지.
    // 기본 브랜치와 견준 값을 그대로 쓰면 세션이 커밋한 것은 빠지고, 세션과 상관없이 남아 있던 변경이 들어간다
    const first = by ? turns.find((t) => t.session === by)?.from : undefined;
    const scope = first ? await invoke<string | null>("repo_diff", { path: cwd, from: first, to: null, file: null }).catch(() => null) : null;
    if (scope !== null) {
      const parts = parseDiff(scope);
      files = parts.length + Math.max(0, untracked - untracked0);
      adds = parts.reduce((n, f) => n + f.adds, 0);
      dels = parts.reduce((n, f) => n + f.dels, 0);
    }
    // 브리핑은 변경이 달라졌거나 답이 하나 더 쌓였을 때 새로 쓴다
    const briefSig = `${sig}|${turns[turns.length - 1]?.to ?? ""}`;
    if (old?.sig !== sig || old.files !== files || old.adds !== adds || old.dels !== dels || old.by !== by || turns !== (old?.turns ?? [])) save({ ...old, files, adds, dels, sig, untracked0, by, turns, at: Date.now() });
    if (!config.brief || !files || changesRef.current[cwd]?.briefSig === briefSig || briefing.current.has(cwd)) return;
    briefing.current.add(cwd);
    try {
      const all = await invoke<{ diff: string; files: string[]; commits: string[] } | null>("repo_changes", { path: cwd });
      // 세션의 범위를 알면 그 변경만 읽힌다. 모르면(Julgi가 지켜보기 전의 세션) 전처럼 기본 브랜치와 견준 것을 읽힌다
      const found = scope !== null && all ? { ...all, diff: scope.slice(0, 120_000), files: parseDiff(scope).map((f) => f.path) } : all;
      if (!found?.diff && !found?.files.length) return;
      const reply = (await invoke<string | null>("last_reply", { sessionId }).catch(() => null)) ?? "";
      const prompt = `세션의 마지막 답:\n${reply.slice(0, 2500)}\n\n${scope !== null ? "이 세션이 바꾼 파일" : "커밋하지 않은 파일"}:\n${found.files.slice(0, 60).join("\n")}\n\n쌓은 커밋:\n${found.commits.slice(0, 20).join("\n") || "(없음)"}\n\n변경 내용:\n${found.diff.slice(0, 60_000)}\n`; // i18n-ok
      const raw = (await invoke<string | null>("route_ask", { system: BRIEF_SYSTEM, prompt, model: modelFor("brief") })) ?? "";
      const brief = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Brief;
      if (!brief.line) return;
      const kept = { line: brief.line, files: brief.files ?? [], watch: brief.watch ?? [], unverified: brief.unverified ?? "" };
      save({ ...changesRef.current[cwd], brief: kept, briefSig, briefBy: scope !== null ? by : undefined });
      // 걸러 읽기: 더 큰 모델이 세션의 설명 없이 변경만 보고 틀린 곳을 짚는다. 몇 줄 안 되는 변경에는 하지 않는다
      if (!config.check || adds + dels < 15 || !found.diff) return;
      const checked = (await invoke<string | null>("route_ask", { system: CHECK_SYSTEM, prompt: `변경 내용:\n${found.diff.slice(0, 60_000)}\n`, model: modelFor("check") })) ?? ""; // i18n-ok
      const spots = ((JSON.parse(checked.slice(checked.indexOf("{"), checked.lastIndexOf("}") + 1)) as { found?: { where?: string; level?: string; what?: string }[] }).found ?? [])
        .filter((f) => f.where && f.what)
        .slice(0, 6)
        .map((f) => ({ where: String(f.where), level: ["버그", "위험", "의문"].includes(f.level ?? "") ? String(f.level) : "의문", what: String(f.what) })); // i18n-ok
      // 그사이 변경이 또 달라졌으면 옛 검토를 붙이지 않는다
      if (changesRef.current[cwd]?.briefSig !== briefSig) return;
      save({ ...changesRef.current[cwd], brief: { ...kept, found: spots } });
      if (spots.length) record("검토", tr`"${nameOf(live.current.open.find((o) => o.sessionId === sessionId)?.key ?? "")}"의 변경에서 ${spots.length}곳을 짚음: ${spots.map((f) => `${f.level} ${f.where}`).join(", ").slice(0, 160)}`, sessionId); // i18n-ok
    } catch {
      // 브리핑은 없어도 된다. 변경이 또 달라지면 다시 해 본다
    } finally {
      briefing.current.delete(cwd);
    }
  };
  /** 일감 목록을 바꾸고 파일에 남긴다. tasks.tsv는 세션의 julgi task 명령이 읽는다 */
  const saveTasks = (all: Job[]) => {
    // 끝난 지 2주가 넘은 일감은 버린다
    const kept = all.filter((t) => !t.finished || Date.now() - t.finished < 14 * 86_400_000);
    tasksRef.current = kept;
    setTasks(kept);
    const one = (text?: string) => (text ?? "").replace(/\s+/g, " ").trim();
    void invoke("data_write", { name: "tasks.json", text: JSON.stringify(kept, null, 1) });
    void invoke("data_write", { name: "tasks.tsv", text: kept.map((t) => [t.id, t.status, t.repo, t.lead, one(t.ask).slice(0, 90), one(t.result).slice(0, 140)].join("\t")).join("\n") + "\n" });
  };
  /** 일감의 결과를 맡긴 세션에 돌려준다. 맡긴 세션이 잠들어 있으면 깨워서 넣는다 */
  const report = async (task: Job) => {
    const lead = live.current.items.find((item) => (item.thread?.sessions ?? [item.session.id]).includes(task.lead));
    const mine = tasksRef.current.filter((t) => t.lead === task.lead);
    const left = `남은 일감: 하는 중 ${mine.filter((t) => t.status === "하는 중").length}, 대기 ${mine.filter((t) => t.status === "대기").length}`; // i18n-ok
    const text = `[Julgi 조율: 일감 ${task.id} (${task.repo}) ${task.status}. ${left}]\n${(task.result ?? "").slice(0, 1800)}\n\n(전체 결과: ~/.julgi/bin/julgi task result ${task.id})`; // i18n-ok
    record("일감", tr`${task.id} (${task.repo}) ${tr(task.status)} · 결과를 맡긴 세션에 돌려줌`, task.session ?? task.lead); // i18n-ok
    if (lead) await dispatch({ kind: "item", item: lead }, text, { rank: -1, by: `일감 ${task.id} 결과` }, false, true); // i18n-ok
  };
  /**
   * 일감을 돌본다: 자리가 나면 대기 중인 일감에 세션을 붙이고, 맡은 세션이 답을 끝내면 결과를 거둬 돌려준다.
   * 모델끼리 알아서 주고받게 두지 않고, Julgi가 세션의 상태를 보고 기계적으로 전한다
   */
  const tendTasks = (now: number) => {
    const all = tasksRef.current;
    const { open } = live.current;
    for (const task of all) {
      if (task.status !== "하는 중" || !task.session || collecting.current.has(task.id)) continue; // i18n-ok
      const key = "c:" + task.session;
      const raw = rawStates.current[key];
      const gone = !open.some((o) => o.key === key) && now - (task.started ?? 0) > 20_000;
      // 띄운 지 한참인데 일을 시작했다는 신호조차 없으면 어딘가에 멈춰 선 것이다. 맡긴 쪽이 마냥 기다리지 않게 알린다
      const stuck = !raw && now - (task.started ?? 0) > 120_000;
      if (stuck) {
        const next: Job = { ...task, status: "실패", result: "맡은 세션이 2분 넘게 일을 시작하지 못했다. 폴더를 믿느냐는 물음이나 로그인에 멈춰 있을 수 있다. 그 세션을 열어 확인하거나 다시 맡긴다", finished: now }; // i18n-ok
        saveTasks(tasksRef.current.map((t) => (t.id === task.id ? next : t)));
        void report(next);
        continue;
      }
      const done = raw?.[0] === "wait" && raw[1] > (task.started ?? 0) + 2000;
      if (!done && !gone) continue;
      collecting.current.add(task.id);
      void (async () => {
        // 답이 대화 기록에 적힐 틈을 준다
        await new Promise((r) => setTimeout(r, 900));
        const reply = done ? await invoke<string | null>("last_reply", { sessionId: task.session }) : null;
        // 고친 것이 하나도 없는 워크트리는 지운다. 고친 것이 있으면 두고, 어디에 있는지 결과에 붙여 조율자가 읽게 한다
        const kept = task.work && reply ? !(await invoke<boolean>("worktree_drop", { path: task.work }).catch(() => false)) : false;
        const where = kept ? `\n\n[Julgi: 이 일감이 고친 것은 워크트리 ${task.work} (브랜치 julgi/${task.id})에 있다. 원래 작업 폴더에는 아직 없다]` : ""; // i18n-ok
        const next: Job = { ...task, work: task.work && !kept && reply ? undefined : task.work, status: reply ? "끝남" : "실패", result: reply ? reply + where : gone ? "맡은 세션이 닫혀서 결과를 받지 못했다" : "결과를 읽지 못했다", finished: Date.now() }; // i18n-ok
        saveTasks(tasksRef.current.map((t) => (t.id === task.id ? next : t)));
        void invoke("data_write", { name: `tasks/${task.id}.md`, text: `# 일감 ${task.id} (${task.repo})\n\n시킨 일:\n${task.ask}\n\n결과:\n${next.result}\n` }); // i18n-ok
        collecting.current.delete(task.id);
        await report(next);
      })();
    }
    // 대기 중인 일감에 세션을 붙인다. 조율 하나에 셋까지, 한 폴더에는 한 번에 하나만
    for (const task of all) {
      if (task.status !== "대기" || starting.current.has(task.id)) continue; // i18n-ok
      const running = tasksRef.current.filter((t) => t.status === "하는 중"); // i18n-ok
      // 워크트리를 쓰면 같은 레포의 일감도 나란히 돌 수 있다. 안 쓰면 한 폴더에 한 번에 하나만
      if (running.filter((t) => t.lead === task.lead).length + [...starting.current].length >= MAX_PARALLEL || (!config.taskWorktree && running.some((t) => t.cwd === task.cwd))) continue;
      starting.current.add(task.id);
      void (async () => {
        const leadName = nameOf("c:" + task.lead).slice(0, 40);
        // 이 일감만을 위한 워크트리를 딴다. git 레포가 아니거나 못 따면 레포의 작업 폴더에서 한다
        const work = config.taskWorktree ? await invoke<string>("worktree_add", { repo: task.cwd, name: task.id, branch: null }).catch(() => undefined) : undefined;
        const where = work ? ` 이 폴더는 이 일감만을 위해 딴 워크트리이고 브랜치는 julgi/${task.id}다. 여기서 고치고 커밋해도 원래 작업 폴더와 기본 브랜치에는 영향이 없다.` : ""; // i18n-ok
        const text = `[Julgi 조율: "${leadName}"이 맡긴 일감 ${task.id}다.${where} 이 대화를 모르는 조율자가 결과를 읽으니, 끝나면 이렇게 답한다: 무엇을 했는지, 바뀐 파일, 확인한 방법, 남은 문제나 정해야 할 것. 머지·푸시·배포·데이터 변경은 하지 않는다. 막히면 짐작으로 밀고 가지 말고 무엇이 막혔는지 적고 끝낸다]\n\n${task.ask}`; // i18n-ok
        const session = await dispatch({ kind: "new", cwd: work ?? task.cwd }, text, { rank: -1, by: `일감 ${task.id}` }, false, true); // i18n-ok
        starting.current.delete(task.id);
        if (typeof session !== "string") return saveTasks(tasksRef.current.map((t) => (t.id === task.id ? { ...t, status: "실패", result: "세션을 띄우지 못했다", finished: Date.now() } : t))); // i18n-ok
        // 목록에서 무엇인지 알아보게 이름을 붙여 둔다
        const named = { ...live.current.names, [session]: tr`일감 ${task.id} · ${task.ask.split("\n")[0].slice(0, 28)}` };
        live.current.names = named;
        setNames(named);
        void invoke("data_write", { name: "names.json", text: JSON.stringify(named) });
        saveTasks(tasksRef.current.map((t) => (t.id === task.id ? { ...t, status: "하는 중", session, work, started: Date.now() } : t))); // i18n-ok
      })();
    }
  };
  /** 세션이 julgi 명령으로 남긴 부탁을 처리한다 */
  const serve = (requests: string[]) => {
    for (const request of requests) {
      const [cmd, sessionId, target, ...rest] = request.split("\n");
      const body = rest.join("\n").trim();
      const key = "c:" + sessionId;
      const from = nameOf(key);
      const { threads, items, open } = live.current;
      const mine = threads.find((t) => t.sessions.includes(sessionId));
      if (cmd === "note" && body) {
        const id = mine?.id ?? sessionId;
        const line = `- (${new Date().toISOString().slice(0, 10)}) ${body}`;
        const text = [live.current.memories[id]?.trim(), line].filter(Boolean).join("\n");
        setMemories((old) => ({ ...old, [id]: text }));
        void invoke("data_write", { name: `threads/${id}.md`, text });
        record("기억", tr`"${from}"이 적음: ${body.slice(0, 70)}`, sessionId); // i18n-ok
      } else if (cmd === "send" && body) {
        const text = `[Julgi의 다른 세션 "${from}"이 넘긴 일이다]\n\n${body}`; // i18n-ok
        const others = items.filter((item) => !(item.thread?.sessions ?? [item.session.id]).includes(sessionId));
        const hit = target === "new" ? undefined : rank(target, others, new Set(open.map((o) => o.sessionId ?? "")))[0];
        if (hit) void dispatch({ kind: "item", item: hit.item }, text, { rank: -1, by: `"${from}"이 넘김` }, false, true); // i18n-ok
        else {
          // 글에 레포 이름이 그대로 나올 때만 그 레포에 연다. 낱말 하나가 겹쳤다고 아무 레포에나 열지 않는다
          const lower = body.toLowerCase();
          const cwd = live.current.folders.find((f) => f.repo.length >= 4 && lower.includes(f.repo.toLowerCase()))?.cwd ?? (live.current.base || live.current.home);
          void dispatch({ kind: "new", cwd }, text, { rank: -1, by: target === "new" ? `"${from}"이 넘김` : `"${from}"이 넘김, "${target}" 줄기를 못 찾아 새로` }, false, true); // i18n-ok
        }
      } else if (cmd === "used" && body) {
        bump(body.split(/\s+/).filter((id) => live.current.notes.some((n) => n.id === id)), "read");
      } else if (cmd === "learn" && body) {
        const [title, ...text] = body.split("\n");
        const repo = live.current.byId.get(sessionId)?.repo ?? "";
        const made = putNote({ id: crypto.randomUUID().slice(0, 8), title: title.trim(), kind: target, repo, from: mine?.name ?? from, created: new Date().toISOString().slice(0, 10), body: text.join("\n").trim() });
        if (made) record("배움", tr`"${from}"이 브레인에 남김: (${made.kind}) ${made.title.slice(0, 80)}`, sessionId); // i18n-ok
      } else if (cmd === "fix" && body) {
        const old = live.current.notes.find((n) => n.id === target);
        if (old && putNote({ ...old, body })) {
          bump([old.id], "fixed");
          record("배움", tr`"${from}"이 브레인 노트를 고침: ${old.title.slice(0, 80)}`, sessionId); // i18n-ok
        }
      } else if (cmd === "answer" && body && sessionId === "phone") {
        // 폰에서 내 차례인 세션에 답했다
        if (open.some((o) => o.key === target)) {
          terms.submitWhenClear(target, body);
          record("답함", tr`폰에서 "${nameOf(target)}"에 답함: ${body.slice(0, 80)}`, open.find((o) => o.key === target)?.sessionId); // i18n-ok
        }
      } else if (cmd === "throw" && body && sessionId === "phone") {
        // 폰에서 새 일을 던졌다. 화면에 보여 준 폴더에서만 연다
        const { folders, base } = live.current;
        if (target === base || folders.some((f) => f.cwd === target)) void dispatch({ kind: "new", cwd: target }, body, { rank: -1, by: "폰에서 던짐" }, false, true); // i18n-ok
      } else if (cmd === "skill" && target) {
        // 다듬기 세션이 고친 글을 다 썼다. 옛 글을 남기고 바꿔 넣는 것은 여기서 한다
        void invoke<string>("skill_apply", { name: target }).then(
          (kept) => {
            record("스킬", body ? tr`스킬을 다듬음: ${target} · ${body.slice(0, 140)} (옛 글: ${kept.replace(live.current.home, "~")})` : tr`스킬을 다듬음: ${target} (옛 글: ${kept.replace(live.current.home, "~")})`, sessionId); // i18n-ok
            void invoke<SkillInfo[] | null>("skills_list").then((k) => setSkills(k ?? []), () => {});
          },
          (why) => record("스킬", tr`스킬을 다듬지 못함: ${target} · ${String(why).slice(0, 120)}`, sessionId), // i18n-ok
        );
      } else if (cmd === "forget") {
        const old = live.current.notes.find((n) => n.id === target);
        if (old) {
          forget(old.id);
          record("배움", tr`"${from}"이 브레인 노트를 지움: ${old.title.slice(0, 60)}` + (body ? " · " + body.slice(0, 80) : ""), sessionId); // i18n-ok
        }
      } else if (cmd === "task" && body) {
        // 조율 세션이 일감을 맡겼다. 여기서는 적어만 두고, 띄우는 것은 돌보미가 자리가 날 때 한다
        const [id, repo] = target.split("|");
        const want = (repo ?? "").toLowerCase();
        const cwd = want === "new" || !want ? live.current.base : (mapState.current.repos.find((r) => r.repo.toLowerCase() === want)?.cwd ?? live.current.folders.find((f) => f.repo.toLowerCase() === want)?.cwd ?? "");
        // 맡긴 세션이 줄기가 아니면 줄기로 만든다. 줄기 보기에서 일감이 그 아래에 모인다
        if (!mine) saveThreads([...live.current.threads, { id: crypto.randomUUID(), name: from.slice(0, 40), sessions: [sessionId], created: Date.now() }]);
        const task: Job = { id, lead: sessionId, repo: repo || "new", cwd, ask: body, status: cwd ? "대기" : "실패", result: cwd ? undefined : `"${repo}"라는 레포를 지도에서 찾지 못했다. julgi map 으로 이름을 확인한다`, created: Date.now(), redo: 0 }; // i18n-ok
        saveTasks([...tasksRef.current.filter((t) => t.id !== id), task]);
        record("일감", `"${from}"이 ${task.repo}에 맡김 (${id}): ${body.split("\n")[0].slice(0, 70)}`, sessionId); // i18n-ok
        if (!cwd) void report(task);
      } else if (cmd === "taskredo" && body) {
        const task = tasksRef.current.find((t) => t.id === target);
        if (task?.session) {
          saveTasks(tasksRef.current.map((t) => (t.id === task.id ? { ...t, status: "하는 중", started: Date.now(), finished: undefined, redo: t.redo + 1 } : t))); // i18n-ok
          const text = `[Julgi 조율: 일감 ${task.id}에 이어서 시키는 일이다. 끝나면 결과를 요약해 답한다]\n\n${body}`; // i18n-ok
          const wkey = "c:" + task.session;
          // 맡았던 세션이 떠 있으면 거기에 바로 넣고, 잠들어 있으면 그 글을 들려 깨운다
          if (terms.opened(wkey)) terms.submitWhenClear(wkey, text);
          else
            void invoke<string>("data_write", { name: `outbox/${crypto.randomUUID()}.md`, text }).then((path) => {
              terms.dispose(wkey);
              terms.create({ key: wkey, cwd: task.work ?? task.cwd, command: withPrompt(resumeCommand(task.session!), path) });
              if (!live.current.open.some((o) => o.key === wkey)) setOpen((list) => [...list, { key: wkey, label: tr`일감 ${task.id}`, cwd: task.work ?? task.cwd, sessionId: task.session }]);
              terms.wake(wkey);
            });
          record("일감", tr`${task.id}를 다시 시킴 (${task.redo + 1}번째): ${body.split("\n")[0].slice(0, 70)}`, task.session); // i18n-ok
        }
      } else if (cmd === "taskcancel") {
        saveTasks(tasksRef.current.map((t) => (t.id === target && (t.status === "대기" || t.status === "하는 중") ? { ...t, status: "멈춤", finished: Date.now() } : t))); // i18n-ok
      } else if (cmd === "handoff") {
        wantHandoff.current.add(key);
      } else if (cmd === "done") {
        if (!mine?.done) finishThread(sessionId);
      }
    }
  };
  /** keepPane: 칸은 그대로 둔다 (갈아탈 때처럼 그 칸에 다른 세션을 막 끼운 경우) */
  const close = (key: string, keepPane = false) => {
    if (key.startsWith("c:")) {
      void summarize(key.slice(2));
      markSlept(key.slice(2));
    }
    terms.dispose(key);
    setOpen((list) => list.filter((o) => o.key !== key));
    setDead((list) => list.filter((k) => k !== key));
    previous.current = previous.current.map((k) => (k === key ? null : k));
    const { panes, widths, open, states, focus } = live.current;
    const at = panes.indexOf(key);
    // 세션을 닫은 칸: 내 차례인 세션이 가려져 있으면 그것을 올리고, 없으면 빈 칸을 남기지 않고 칸째 없앤다
    // 셸은 보던 것 옆에 칸을 내서 연 것이라, 닫으면 칸째 없애서 열기 전 화면으로 돌아간다
    const shell = key.startsWith("s:");
    const next = keepPane || at < 0 || shell ? undefined : open.find((o) => o.key !== key && waiting(states[o.key]) && !panes.includes(o.key));
    if (keepPane || at < 0 || panes.length < 2 || next) return setPanes((list) => list.map((k) => (k === key ? (next?.key ?? null) : k)));
    setPanes(panes.filter((_, i) => i !== at));
    setWidths(widths.filter((_, i) => i !== at));
    previous.current.splice(at, 1);
    setFocus(Math.max(0, focus > at || (shell && focus === at) ? focus - 1 : Math.min(focus, panes.length - 2)));
  };
  /** ⌘D: 지금 칸 오른쪽에 칸을 하나 더 만든다. key를 주면 그 터미널을 새 칸에 올린다 */
  const split = (key: string | null = null) => {
    const { panes, widths, focus } = live.current;
    if (panes.length >= MAX_PANES) return say(tr`칸은 ${MAX_PANES}개까지다.`);
    const at = focus + 1;
    setPanes([...panes.slice(0, at), key, ...panes.slice(at)]);
    setWidths([...widths.slice(0, at), widths[focus], ...widths.slice(at)]);
    previous.current.splice(at, 0, null);
    setZoom(false);
    setFocus(at);
  };
  /** 칸을 없앤다. 그 칸에 있던 세션은 열린 채로 목록에 남는다 */
  const unsplit = (at: number) => {
    const { panes, widths } = live.current;
    if (panes.length < 2) return;
    setPanes(panes.filter((_, i) => i !== at));
    setWidths(widths.filter((_, i) => i !== at));
    previous.current.splice(at, 1);
    setFocus(Math.max(0, at - 1));
  };
  /** 칸 사이 경계를 끌어 왼쪽 칸과 오른쪽 칸의 너비를 나눈다 */
  const drag = (at: number, e: React.MouseEvent) => {
    e.preventDefault();
    const start = live.current.widths;
    const total = start.reduce((a, b) => a + b, 0);
    const perPx = total / (panesEl.current?.clientWidth || 1);
    const pair = start[at - 1] + start[at];
    const least = Math.min(MIN_PANE_PX * perPx, pair / 2);
    const move = (m: MouseEvent) => {
      const left = Math.min(pair - least, Math.max(least, start[at - 1] + (m.clientX - e.clientX) * perPx));
      setWidths(start.map((w, i) => (i === at - 1 ? left : i === at ? pair - left : w)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("dragging");
    };
    document.body.classList.add("dragging");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  /** ⌘W: 지금 세션을 재운다. 일하는 중이면 한 번 더 눌러야 한다 */
  /** 설정 하나를 바꾸고 파일에 남긴다 */
  // 아래 상태 줄: 세션마다 쓰는 메모리와 CPU, 그리고 Claude 구독 사용량
  const [load, setLoad] = useState<Record<string, [number, number]>>({});
  const loadRef = useRef<{ at: number; rows: Record<string, [number, number]>; sleptAt: number }>({ at: 0, rows: {}, sleptAt: 0 });
  const [usage, setUsage] = useState<{ name: string; used: number; resets: number }[] | null>(null);
  const [usageWhy, setUsageWhy] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const readLoad = () =>
    void invoke<Record<string, [number, number]>>("term_load").then((raw) => {
      const rows: Record<string, [number, number]> = {};
      for (const o of live.current.open) {
        const hit = raw[String(terms.idOf(o.key))];
        if (hit) rows[o.key] = hit;
      }
      loadRef.current = { ...loadRef.current, at: Date.now(), rows };
      setLoad(rows);
    }, () => {});
  const readUsage = () => {
    if (!config.usage) return setUsage(null);
    void invoke<{ name: string; used: number; resets: number }[]>("claude_usage").then(
      (list) => (setUsage(list), setUsageWhy("")),
      (why) => setUsageWhy(String(why)),
    );
  };
  useEffect(() => {
    readLoad();
    const fast = setInterval(readLoad, 10_000);
    const slow = setInterval(() => actions.current.readUsage(), 5 * 60_000);
    return () => (clearInterval(fast), clearInterval(slow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 폰용 화면. 켜면 주소를 받아 설정에 보여 주고, 끄면 받지 않게 한다
  const [remoteUrl, setRemoteUrl] = useState("");
  const applyRemote = () => {
    if (!config.remote) return void (setRemoteUrl(""), invoke("remote_stop"));
    void invoke<string>("remote_start", { port: config.remotePort }).then(setRemoteUrl, (why) => setRemoteUrl(String(why)));
  };
  /** 폰에 보여 줄 지금 상태: 열린 세션과 그 상태, 새 세션을 열 수 있는 폴더, Julgi가 방금 한 일 */
  const publishRemote = () => {
    const { open, states, folders, base, acts } = live.current;
    const sessions = open
      .filter((o) => o.sessionId)
      .map((o) => {
        const st = states[o.key];
        const ch = changesRef.current[o.cwd];
        return { key: o.key, id: o.sessionId, name: nameOf(o.key), repo: repoOf(o.cwd), state: st?.state ?? "", label: STATE_LABEL[st?.state ?? ""] ?? tr("열려 있음"), since: st?.since ?? 0, changed: ch && ch.by === o.sessionId && ch.files ? tr`파일 ${ch.files} +${ch.adds} −${ch.dels}` : "" };
      })
      .sort((a, b) => a.since - b.since);
    const places = [...(base ? [{ repo: tr`기본 폴더 · ${repoOf(base)}`, cwd: base }] : []), ...folders.slice(0, 40).map((f) => ({ repo: f.repo, cwd: f.cwd }))];
    void invoke("remote_publish", { state: JSON.stringify({ at: Date.now(), sessions, folders: places, acts: acts.slice(-10).reverse().map((a) => ({ at: a.at, kind: a.kind, text: a.text.slice(0, 140) })) }) });
  };
  const setConfig = (key: keyof typeof config, value: string | number | boolean) => {
    Object.assign(config, { [key]: value });
    if (key === "remote") applyRemote();
    if (key === "usage") readUsage();
    if (key === "theme") applyTheme(String(value));
    // Jira를 연결하거나 끊으면 프로젝트 키와 내 티켓을 바로 다시 받는다
    if (key === "jiraSite") {
      if (!value) (setTickets([]), setTicketNews({}), setKnownKeys([]));
      else refreshTickets.current(true);
    }
    // 창 꺼내기 키는 바꾸는 즉시 다시 건다. 다른 앱이 쓰는 키면 알려 준다
    if (key === "hotkey") void invoke("set_hotkey", { shortcut: String(value) }).catch((e) => say(tr`그 키는 쓸 수 없다: ${String(e).slice(0, 80)}`, 6000));
    if (key === "defaultDir") void invoke<string>("default_dir", { path: String(value) || null }).then((dir) => setBase(dir ?? ""));
    setConfigTick((n) => n + 1);
    // 파일에 있던 다른 값은 건드리지 않고 바꾼 값만 고쳐 쓴다. 연달아 바꿔도 순서대로 쓴다
    saving.current = saving.current.then(async () => {
      const json = await invoke<string | null>("config_load");
      let saved: Record<string, unknown> = {};
      try {
        saved = json ? JSON.parse(json) : {};
      } catch {
        return; // 깨진 설정 파일은 덮어쓰지 않는다
      }
      await invoke("data_write", { name: "config.json", text: JSON.stringify({ ...saved, [key]: value }, null, 2) + "\n" });
    });
  };
  const sleep = (key: string) => {
    const running = live.current.states[key]?.state === "run";
    if (running && Date.now() - lastCloseTry.current > 2500) {
      lastCloseTry.current = Date.now();
      return say(tr("일하는 중이다. 한 번 더 누르면 재운다."));
    }
    // 실수로 닫히지 않게 한 번 묻는다. 셸과 죽은 터미널, 묻지 않기로 한 경우는 바로 닫는다
    if (config.confirmClose && key.startsWith("c:") && !live.current.dead.includes(key)) {
      setClosing(key);
      return setOverlay("close");
    }
    close(key);
  };
  /** 칸을 코드 검토로 바꾸거나 터미널로 되돌린다. 세션은 그대로 돈다 */
  const toggleReview = (key: string) => {
    const on = !live.current.reviewing.includes(key);
    setReviewing((list) => (on ? [...list, key] : list.filter((k) => k !== key)));
    if (on) setZoom(true);
    else terms.focus(key);
  };
  const confirmClose = (never: boolean) => {
    const key = live.current.closing;
    setOverlay(null);
    setClosing("");
    if (never) setConfig("confirmClose", false);
    if (key) close(key);
  };
  const requestQuit = () => {
    const { open, states } = live.current;
    if (open.some((o) => states[o.key]?.state === "run")) setOverlay("quit");
    else void invoke("app_exit");
  };
  /** 갈아타기: 지금 세션에게 인계 글을 받아, 그 글만 들고 새 세션을 같은 칸에 연다 */
  const handoff = (key: string, opts: { open?: Open; after?: string; sent?: boolean } = {}) => {
    // after: 갈아탄 새 세션에 이어서 시킬 말. sent: 인계 부탁을 이미 보냈다(잠든 세션을 깨우며 넣은 경우)
    const o = opts.open ?? live.current.open.find((x) => x.key === key);
    if (!o?.sessionId || live.current.handing.includes(key)) return;
    if (!opts.sent && live.current.states[key]?.state === "run") return say(tr("일하는 중이다. 끝난 뒤에 갈아탄다."));
    const oldId = o.sessionId;
    const known = live.current.threads.find((t) => t.sessions.includes(oldId));
    const title = known?.name ?? live.current.byId.get(oldId)?.title ?? o.label;
    setHanding((list) => [...list, key]);
    if (!opts.sent) terms.submit(key, config.handoffPrompt);

    const startedAt = Date.now();
    const stop = (message: string) => {
      clearInterval(timer);
      setHanding((list) => list.filter((k) => k !== key));
      say(message);
    };
    const timer = setInterval(() => {
      const state = live.current.states[key];
      if (!live.current.open.some((x) => x.key === key)) return stop(tr("세션이 닫혀서 갈아타기를 그만뒀다."));
      // 보낸 뒤에 새로 적힌 "기다림"이어야 끝난 것이다. 중간의 "일하는 중"을 못 봤어도 된다
      // (창이 가려져 타이머가 늦게 돌 수 있다).
      if (!(waiting(state) || replied(state)) || state.since < startedAt) {
        if (Date.now() - startedAt > HANDOFF_TIMEOUT_MS) stop(tr("인계 글이 오지 않아 갈아타기를 그만뒀다."));
        return;
      }
      clearInterval(timer);
      // 답변이 대화 기록에 적힐 틈을 준다
      setTimeout(() => {
        void (async () => {
          const reply = await invoke<string | null>("last_reply", { sessionId: oldId });
          if (!reply) return stop(tr("인계 글을 읽지 못해 갈아타기를 그만뒀다."));
          const id = crypto.randomUUID();
          const todo = opts.after ? `\n---\n\n인계를 읽었으면 바로 이어서 할 일:\n\n${opts.after}\n` : ""; // i18n-ok
          const path = await invoke<string>("handoff_write", { id, text: `# 인계: ${title}\n\n이전 세션(${oldId})에서 넘어왔다. 아래를 읽고 이어서 진행한다.\n\n${reply}\n${todo}` }); // i18n-ok
          // 줄기에 새 세션을 잇고, 인계 글을 줄기의 기억으로 둔다. 줄기가 없었으면 여기서 생긴다.
          const base: Thread = live.current.threads.find((t) => t.sessions.includes(oldId)) ?? { id: crypto.randomUUID(), name: title, sessions: [oldId], created: Date.now() };
          const thread = { ...base, sessions: [...base.sessions, id] };
          saveThreads([...live.current.threads.filter((t) => t.id !== thread.id), thread]);
          setMemories((old) => ({ ...old, [thread.id]: reply }));
          void invoke("data_write", { name: `threads/${thread.id}.md`, text: reply });
          const next: Open = { key: "c:" + id, label: title, cwd: o.cwd, sessionId: id };
          // 알아서 띄운 세션에서 갈아탄 새 세션도 알아서 띄운 것이다
          if (isAuto(oldId)) {
            markAuto(id);
            void invoke("data_write", { name: "auto-sessions.json", text: JSON.stringify(autoList()) });
          }
          terms.create({ key: next.key, cwd: o.cwd, command: handoffCommand(id, path) });
          // 보던 화면을 새 세션 위쪽에 옮겨 적는다. 칸이 비었다가 새로 차지 않고 이어지는 것처럼 보인다
          terms.carry(key, next.key, tr("여기서부터 새 세션 · 위의 대화는 인계 글로 넘겨받았다"));
          setHanded((old) => ({ ...old, [next.key]: Date.now() }));
          setTimeout(() => setHanded(({ [next.key]: _, ...rest }) => rest), 90_000);
          setOpen((list) => [...list, next]);
          // 이전 세션이 보이던 칸에 새 세션을 끼운다.
          // 보내기에서 시작한 갈아타기는 화면을 바꾸지 않고 뒤에서 띄운다.
          if (opts.after && !live.current.panes.includes(key)) terms.wake(next.key);
          else setPanes((list) => (list.includes(key) ? list.map((k) => (k === key ? next.key : k)) : list.map((k, i) => (i === live.current.focus ? next.key : k))));
          // 넘겨준 이전 세션은 재운다. 열어 두면 같은 이름이 둘이 되고, 기다리는 세션으로 잡혀 칸에 다시 올라온다
          close(key, true);
          record("갈아탐", opts.after ? tr`${title.slice(0, 40)} · 인계 글만 들고 새 세션으로, 이어서 보냄. 이전 세션은 재움` : tr`${title.slice(0, 40)} · 인계 글만 들고 새 세션으로. 이전 세션은 재움`, id); // i18n-ok
          stop(opts.after ? tr`갈아탄 뒤 보냈다 → ${title}` : tr("갈아탔다. 이전 세션은 재웠고 줄기에 남아 있다."));
        })();
      }, 800);
    }, 1000);
  };
  /** 화면 밖에서 띄운 세션이 일을 시작하지 못하면(폴더를 믿느냐는 물음 등) 알아챌 길이 없으니, 조용하면 꺼내 보인다 */
  const watch = (key: string, label: string, ms = 12_000) =>
    setTimeout(() => {
      const { open, panes, states } = live.current;
      if (states[key] || panes.includes(key) || !open.some((o) => o.key === key)) return;
      const at = panes.indexOf(null);
      if (at >= 0) setPanes(panes.map((k, i) => (i === at ? key : k)));
      record("확인 필요", tr`"${label.slice(0, 40)}" 세션이 시작하지 못하고 있다`, idOfKey(key)); // i18n-ok
      say(tr`"${label.slice(0, 30)}" 세션이 시작하지 못하고 있다. 내 확인을 기다리는지 열어 본다.`);
    }, ms);
  /** 보내기: 고른 줄기의 가장 최근 세션에 글을 보낸다. 잠들어 있으면 화면 밖에서 깨워 보낸다 */
  const dispatch = async (target: Target, message: string, note: RouteNote, viaHandoff = false, quiet = false): Promise<string | void> => {
    // quiet: 세션이 넘긴 일이다. 내가 열어 둔 상자를 닫지 않는다
    if (!quiet) setOverlay(null);
    // 내가 고른 곳과 Julgi가 1등으로 꼽은 곳을 남겨 두고 나중에 적중률을 본다
    void invoke("data_append", {
      name: "routes.jsonl",
      // how: 누가 정했나(me 내가 골랐다, model 모델, text 글자, none 이어 갈 곳이 없었다, session 다른 세션이 넘겼다). ask: 모델에게 물은 글과 답.
      // scripts/eval-route.mjs가 이 기록으로 같은 물음을 다시 돌려 정확도를 잰다
      line: JSON.stringify({
        at: new Date().toISOString(),
        message: message.slice(0, 200),
        top: note.top ?? null,
        asked: note.asked ?? null,
        chosen: target.kind === "item" ? target.item.session.id : "new",
        repo: target.kind === "item" ? target.item.session.repo : repoOf(target.cwd),
        rank: note.rank,
        how: note.by?.includes("이 넘김") ? "session" : note.by === tr("내가 고름") ? "me" : note.ask ? "model" : target.kind === "item" ? "text" : "none", // i18n-ok
        ask: note.ask,
      }),
    });
    const outbox = (text = message) => invoke<string>("data_write", { name: `outbox/${crypto.randomUUID()}.md`, text });
    if (target.kind === "new") {
      const id = crypto.randomUUID();
      const key = "c:" + id;
      // 줄기에 더하는 세션은 그 줄기가 뭘 하던 것인지부터 듣고 시작한다
      const about = target.join && aboutOf(target.join);
      // 이 레포가 어디와 이어져 있고 바꿀 때 어디를 같이 봐야 하는지를 지도에서 떼어 붙인다
      const here = `\n${live.current.mapText}`.split(/\n## /).find((part) => part.split("\n")[0].trim() === repoOf(target.cwd));
      const ties = mapItems(here ?? "").filter(([label, text]) => (label === "이어진 곳" || label === "바꿀 때 같이 볼 곳") && text && !/^(확인된 것 없음|없음)\.?$/.test(text)); // i18n-ok
      const mapped = ties.length ? `[Julgi 지도: 이 레포(${repoOf(target.cwd)})와 이어진 곳. 참고만 하고, 다른 레포의 경로는 ~/.julgi/bin/julgi map 으로 본다]\n${ties.map(([label, text]) => `${label}:\n${text}`).join("\n").slice(0, 2400)}\n\n---\n\n` : ""; // i18n-ok
      // 일이 레포 여러 곳에 걸치면 이 세션을 조율자로 세운다. 내가 "조율해 줘"라고 말할 필요가 없게
      const spans = config.autoLead && !target.join ? (note.span ?? []) : [];
      // 큰 일만 조율자로 세운다. 작은 일은 한 세션이 레포를 오가며 하는 편이 빠르다. 그 세션도 하다가 커지면 스스로 나눠 맡길 수 있다
      // i18n-off
      const lead =
        spans.length < 2
          ? ""
          : note.big
            ? `[Julgi: 이 일은 레포 여러 곳(${spans.join(", ")})에 걸친 큰 일로 보인다. julgi-lead 스킬을 써서 조율자로 일한다. 직접 고치지 말고 일감으로 나눠 레포마다 맡기고, 돌아온 결과를 확인해 정리한다. 지도를 보고 작은 일이라고 판단되면 그렇게 말하고 직접 한다]\n\n`
            : `[Julgi: 이 일은 레포 여러 곳(${spans.join(", ")})에 걸치지만 작은 일로 보여 이 세션이 직접 한다. 다른 레포는 지도(~/.julgi/bin/julgi map)에서 찾아 직접 읽고 고친다. 고치기 전에 레포마다 작업 브랜치를 따고, 어느 레포의 무엇을 바꿨는지 끝에 정리한다. 하다 보니 레포마다 따로 진행할 덩어리가 커지면 julgi-lead 스킬로 일감을 나눠 맡긴다]\n\n`;
      // i18n-on
      if (lead) record("조율", note.big ? tr`레포 ${spans.length}곳에 걸친 큰 일이라 조율자로 세움: ${spans.join(", ")}` : tr`레포 ${spans.length}곳에 걸치지만 작은 일이라 한 세션이 직접 함: ${spans.join(", ")}`, id); // i18n-ok
      const recalled = lead + mapped + (note.brain?.length ? `${recallText(note.brain)}\n\n---\n\n` : "");
      const text = recalled + (about ? `[이어지는 작업 "${target.join!.name}"의 지금까지 내용. 참고만 한다]\n${about.slice(0, 4000)}\n\n---\n\n${message}` : message); // i18n-ok
      if (note.brain?.length) bump(note.brain.map((n) => n.id), "out");
      if (note.brain?.length) record("꺼냄", tr`브레인에서 ${note.brain.length}개를 새 세션에 붙임: ${note.brain.map((n) => n.title).join(" / ").slice(0, 120)}`, id); // i18n-ok
      // 내가 던진 것이 아니면(세션이나 폰이 넘긴 일, 일감, 스킬) 알아서 띄운 세션으로 적어 둔다. 권한을 따로 준다
      if (quiet) {
        markAuto(id);
        void invoke("data_write", { name: "auto-sessions.json", text: JSON.stringify(autoList()) });
      }
      terms.create({ key, cwd: target.cwd, command: withPrompt(newCommand(id), await outbox(text)) });
      setOpen((list) => [...list, { key, label: message.split("\n")[0].slice(0, 40), cwd: target.cwd, sessionId: id }]);
      // 글에 티켓 키가 있으면 이 세션을 그 티켓에 잇는다. 안 이으면 티켓이 "시작 안 함"으로 남아 세션을 또 만들게 된다
      const ticket = config.jiraSite ? firstKey(message) : undefined;
      if (ticket) {
        const links = { ...live.current.ticketLinks, [id]: ticket };
        setTicketLinks(links);
        void invoke("data_write", { name: "tickets.json", text: JSON.stringify(links) });
      }
      terms.wake(key);
      // 한 번도 안 써 본 폴더면 Claude Code가 폴더를 믿느냐고 물을 것이라, 오래 기다리지 않고 꺼내 보인다
      watch(key, message, live.current.sessions.some((s) => s.cwd === target.cwd) || target.cwd === live.current.base || mapState.current.repos.some((r) => r.cwd === target.cwd) ? 15_000 : 3000);
      if (target.join) joinThreads(target.join.session.id, id, true);
      if (!note.by?.startsWith("일감 ")) record("보냄", `${target.join ? `"${target.join.name.slice(0, 30)}" 줄기에 ` : "새 줄기 · "}${repoOf(target.cwd)} ← "${message.split("\n")[0].slice(0, 50)}" (${note.by ?? "직접"})`, id); // i18n-ok
      say(target.join ? tr`${target.join.name} 줄기에 ${repoOf(target.cwd)} 세션을 더해 보냈다` : tr`새 줄기에 보냈다 · ${repoOf(target.cwd)}`);
      return id; // 새로 띄운 세션. 일감을 맡길 때 누가 맡았는지 적는 데 쓴다
    }
    const { item } = target;
    if (!note.by?.startsWith("일감 ")) record("보냄", `${item.name.slice(0, 40)} ← "${message.split("\n")[0].slice(0, 50)}" (${note.by ?? "직접"}${viaHandoff ? ", 갈아탄 뒤" : ""})`, item.session.id); // i18n-ok
    if (item.thread?.done) saveThreads(live.current.threads.map((t) => (t.id === item.thread!.id ? { ...t, done: false } : t)));
    const ids = item.thread?.sessions ?? [item.session.id];
    const openOne = live.current.open
      .filter((o) => o.sessionId && ids.includes(o.sessionId))
      .sort((a, b) => ids.indexOf(b.sessionId!) - ids.indexOf(a.sessionId!))[0];
    if (viaHandoff) {
      // 큰 세션: 먼저 인계 글을 받아 새 세션으로 넘기고, 그 새 세션에 이 말을 시킨다
      if (openOne && terms.opened(openOne.key)) return handoff(openOne.key, { after: message });
      const sessionId = openOne?.sessionId ?? item.session.id;
      const key = "c:" + sessionId;
      const asleep: Open = openOne ?? { key, label: item.name, cwd: item.session.cwd, sessionId };
      terms.dispose(key);
      terms.create({ key, cwd: item.session.cwd, command: withPrompt(resumeCommand(sessionId), await outbox(config.handoffPrompt)) });
      if (!openOne) setOpen((list) => [...list, asleep]);
      terms.wake(key);
      return handoff(key, { open: asleep, after: message, sent: true });
    }
    if (openOne && terms.opened(openOne.key)) {
      // 그 세션에 내가 치다 만 글이 있으면 뒤에 붙지 않게, 그 글을 보내거나 지울 때까지 기다린다
      const held = terms.submitWhenClear(openOne.key, message, () => say(tr`기다리던 글을 보냈다 → ${item.name}`));
      if (held) return say(tr`"${item.name.slice(0, 30)}"에 치던 글이 있어서 기다린다. 그 글을 보내거나 지우면 이어서 보낸다`, 6000);
    } else {
      const sessionId = openOne?.sessionId ?? item.session.id;
      const key = "c:" + sessionId;
      if (!openOne && elsewhere(item.session)) record("확인 필요", tr`"${item.name.slice(0, 40)}"은 다른 곳에서도 열려 있는 것 같다. Julgi에서 깨워 보냈으니 한쪽은 닫는다`, sessionId); // i18n-ok
      terms.dispose(key); // 목록에만 있고 아직 안 뜬 것은 글을 들려서 다시 만든다
      terms.create({ key, cwd: item.session.cwd, command: withPrompt(resumeCommand(sessionId), await outbox()) });
      if (!openOne) setOpen((list) => [...list, { key, label: item.name, cwd: item.session.cwd, sessionId }]);
      terms.wake(key);
      watch(key, item.name);
    }
    say(tr`보냈다 → ${item.name}`);
  };
  const saveThreads = (all: Thread[]) => {
    live.current.threads = all; // 한 번에 여러 줄기를 손댈 때 앞에서 고친 것이 보이게
    setThreads(all);
    void invoke("data_write", { name: "threads.json", text: JSON.stringify(all, null, 1) });
  };
  /** 줄기 이름을 바꾼다. 줄기가 아니던 세션이면 그 세션 하나짜리 줄기가 된다 */
  const nameThread = (sessionId: string, name: string) => {
    const all = live.current.threads;
    const mine = all.find((t) => t.sessions.includes(sessionId));
    if (!name.trim()) return;
    saveThreads(mine ? all.map((t) => (t === mine ? { ...t, name: name.trim(), named: true } : t)) : [...all, { id: crypto.randomUUID(), name: name.trim(), sessions: [sessionId], created: Date.now(), named: true }]);
  };
  /** 줄기에서 세션 하나를 뺀다. 하나만 남으면 줄기는 그대로 두고(이름과 기억이 있으니) 비면 지운다 */
  const leaveThread = (sessionId: string) => {
    const all = live.current.threads;
    const mine = all.find((t) => t.sessions.includes(sessionId));
    if (!mine) return;
    const rest = mine.sessions.filter((id) => id !== sessionId);
    saveThreads(rest.length ? all.map((t) => (t === mine ? { ...t, sessions: rest } : t)) : all.filter((t) => t !== mine));
    say(tr("줄기에서 뺐다. 세션은 그대로 남아 있다."));
  };
  /** 줄기를 푼다. 세션은 낱개로 돌아가고 기억 파일은 지우지 않는다 */
  const dropThread = (threadId: string) => {
    saveThreads(live.current.threads.filter((t) => t.id !== threadId));
    say(tr("줄기를 풀었다. 세션은 그대로 남아 있다."));
  };
  /** 두 세션(또는 그 줄기)을 한 줄기로 묶는다. 순서는 마지막으로 쓴 때 순 */
  const joinThreads = (a: string, b: string, quiet = false) => {
    if (a === b) return;
    const all = live.current.threads;
    const ta = all.find((t) => t.sessions.includes(a));
    const tb = all.find((t) => t.sessions.includes(b));
    if (ta && ta === tb) return say(tr("이미 같은 줄기다."));
    const when = (id: string) => live.current.byId.get(id)?.mtime ?? Number.MAX_SAFE_INTEGER;
    const sessions = [...new Set([...(ta?.sessions ?? [a]), ...(tb?.sessions ?? [b])])].sort((x, y) => when(x) - when(y));
    const keep = ta ?? tb;
    const name = keep?.name ?? live.current.byId.get(sessions[0])?.title ?? tr("줄기");
    const merged: Thread = { id: keep?.id ?? crypto.randomUUID(), name, sessions, created: keep?.created ?? Date.now() };
    saveThreads([...all.filter((t) => t !== ta && t !== tb), merged]);
    // 두 줄기에 기억이 따로 있었으면 한 파일로 합친다
    const both = ta && tb ? [ta, tb].map((t) => live.current.memories[t.id]?.trim()).filter(Boolean) : [];
    if (both.length === 2) {
      const text = both.join("\n\n---\n\n");
      setMemories((old) => ({ ...old, [merged.id]: text }));
      void invoke("data_write", { name: `threads/${merged.id}.md`, text });
    }
    if (!quiet) say(tr`한 줄기로 묶었다 → ${name} (세션 ${sessions.length}개)`);
  };
  /** 줄기를 끝낸다. 목록에서 내려가고 ⌘K로는 계속 찾는다. 다시 누르거나 보내면 살아난다 */
  const finishThread = (sessionId: string, quiet = false) => {
    const all = live.current.threads;
    const mine = all.find((t) => t.sessions.includes(sessionId));
    const next: Thread = mine
      ? { ...mine, done: !mine.done }
      : { id: crypto.randomUUID(), name: live.current.byId.get(sessionId)?.title ?? tr("줄기"), sessions: [sessionId], created: Date.now(), done: true };
    saveThreads([...all.filter((t) => t !== mine), next]);
    if (!next.done) {
      for (const o of live.current.open) endWhenIdle.current.delete(o.key);
      return say(tr("줄기를 다시 살렸다."));
    }
    for (const o of live.current.open)
      if (o.sessionId && next.sessions.includes(o.sessionId)) {
        // 답하는 중인 칸(julgi done을 부른 세션 자신)은 답이 끝나면 닫는다
        if (live.current.states[o.key]?.state === "run") endWhenIdle.current.add(o.key);
        else close(o.key);
      }
    if (quiet) return; // 점검이 한 것은 점검 기록에 남긴다
    record("끝냄", tr`"${next.name.slice(0, 40)}" · 목록에서 내림`, sessionId); // i18n-ok
    say(tr("줄기를 끝냈다. 목록에서 내렸고 ⌘K로는 계속 찾는다."));
  };
  /** 지금 세션에서 마지막으로 주고받은 말을 다른 줄기로 옮긴다. 보낼 곳은 보내기 상자에서 고른다 */
  const move = async () => {
    const o = live.current.open.find((x) => x.key === live.current.panes[live.current.focus]);
    if (!o?.sessionId) return say(tr("지금 칸에 Claude 세션이 있어야 옮길 수 있다."));
    const pair = await invoke<[string, string] | null>("last_exchange", { sessionId: o.sessionId });
    if (!pair) return say(tr("옮길 말이 아직 없다."));
    const title = live.current.byId.get(o.sessionId)?.title ?? o.label;
    movedFrom.current = { said: pair[0].replace(/\s+/g, " "), name: nameOf(o.key) };
    const reply = pair[1] ? `\n\n받은 답:\n${pair[1].slice(0, 4000)}` : ""; // i18n-ok
    setMoving(`[다른 세션 "${title}"에서 나온 얘기를 여기로 옮긴다. 이어서 봐줘.]\n\n내가 한 말:\n${pair[0].slice(0, 2000)}${reply}`); // i18n-ok
    setOverlay("send");
  };
  const togglePin = (key: string) => setPinned((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  /** 1.5초마다: 기다리는 세션을 빈 칸에 올리고, 답을 보낸 칸은 다음 기다리는 세션으로 넘기고, 오래 쉰 세션은 재운다 */
  const tend = () => {
    const { open, panes, states, pinned, handing, overlay } = live.current;
    const now = Date.now();
    tendBugs();
    for (const key of panes) if (key && waiting(states[key])) seen.current[key] = states[key].since;
    for (const key of panes) if (key) shownAt.current[key] = now;
    for (const o of open) {
      const was = lastStates.current[o.key]?.state;
      const is = states[o.key]?.state;
      if (endWhenIdle.current.has(o.key) && is !== "run") {
        endWhenIdle.current.delete(o.key);
        close(o.key);
        continue;
      }
      // 일하다가 내 차례가 됐는데 내가 Julgi를 안 보고 있으면 알린다. 갈아타는 중의 인계 글은 내가 볼 것이 아니라 뺀다
      if (config.notify && was === "run" && (is === "wait" || is === "ask" || is === "stuck") && !document.hasFocus() && !handing.includes(o.key))
      {
        const why = (o.sessionId && triaged.current[o.sessionId]?.why) || "";
        void invoke("notify", { title: nameOf(o.key).slice(0, 60), body: is === "ask" ? tr("확인이 필요하다") : is === "stuck" ? tr("일하다가 멈춰 있다") : why || tr("답을 끝냈다. 내 차례다") });
        notified.current = { key: o.key, at: now };
      }
      // 답이 끝났으면 그 폴더에서 무엇이 바뀌었는지 센다. 변경이 달라졌으면 브리핑도 새로 만든다
      // 일을 시작할 때 그 폴더의 변경 상태를 적어 둔다. 끝났을 때 달라졌으면 이 세션이 고친 것이다
      if (was !== "run" && is === "run") {
        const key = o.key;
        void invoke<[number, number, number, string, number] | null>("repo_stat", { path: o.cwd }).then((stat) => void (turnSig.current[key] = stat?.[3] ?? ""), () => {});
        // 그리고 그 순간을 찍어 둔다. 끝났을 때의 것과 견주면 이번 답에서 바뀐 것만 나온다
        void invoke<string | null>("repo_snapshot", { path: o.cwd, name: `${(o.sessionId ?? "x").slice(0, 8)}-start` }).then((sha) => void (turnFrom.current[key] = sha ?? ""), () => {});
      }
      // 한 번 시킨 일이 너무 오래 돌고 있으면 한 번 알린다. 걸려 있는데 화면만 돌고 있을 수 있다
      const st = states[o.key];
      if (config.longRunMin > 0 && is === "run" && st && now - st.since > config.longRunMin * 60_000 && longRunTold.current[o.key] !== st.since && !isAuto(o.sessionId ?? "")) {
        longRunTold.current[o.key] = st.since;
        record("확인 필요", tr`"${nameOf(o.key).slice(0, 40)}" 세션이 ${config.longRunMin}분 넘게 한 가지 일을 하고 있다`, o.sessionId); // i18n-ok
        if (config.notify && !document.hasFocus()) void invoke("notify", { title: nameOf(o.key).slice(0, 60), body: tr`${config.longRunMin}분 넘게 일하는 중이다. 걸렸는지 본다` });
      }
      if (was === "run" && (is === "wait" || is === "ask" || is === "told" || is === "stuck") && o.sessionId) void checkChanges(o.cwd, o.sessionId, turnSig.current[o.key], turnFrom.current[o.key]);
      if ((was === "wait" || was === "told" || was === "stuck") && is === "run") answered.current[o.key] = now;
      else if (is !== "run") delete answered.current[o.key];
    }
    lastStates.current = states;
    if (config.autoFill && !overlay) {
      const hidden = open.filter((o) => waiting(states[o.key]) && !panes.includes(o.key)).sort((a, b) => states[a.key].since - states[b.key].since);
      if (hidden.length) {
        let at = panes.indexOf(null);
        // 치고 있는 칸을 바꾸면 글이 엉뚱한 세션으로 들어가니, 손을 뗀 칸만 바꾼다
        if (at < 0) at = panes.findIndex((k) => !!k && !pinned.includes(k) && !!answered.current[k] && now - answered.current[k] > 2000 && terms.idle(k) > SWAP_IDLE_MS);
        if (at >= 0) {
          const old = panes[at];
          if (old) delete answered.current[old];
          previous.current[at] = old;
          setPanes(panes.map((k, i) => (i === at ? hidden[0].key : k)));
          record("칸", old ? tr`칸 ${at + 1}: 답을 보낸 "${nameOf(old)}" 대신 기다리던 "${nameOf(hidden[0].key)}"` : tr`칸 ${at + 1}: 기다리던 "${nameOf(hidden[0].key)}"을 올림`, idOfKey(old ?? hidden[0].key)); // i18n-ok
        } else if (!live.current.zoom && panes.length < MAX_PANES && (panesEl.current?.clientWidth ?? 0) / (panes.length + 1) >= AUTO_PANE_PX) {
          // 바꿔 끼울 칸이 없고 화면에 자리가 있으면 칸을 하나 늘려 올린다. 내가 칸을 나눌 일이 없게
          const { widths } = live.current;
          setPanes([...panes, hidden[0].key]);
          setWidths([...widths, widths.reduce((a, b) => a + b, 0) / widths.length]);
          previous.current.push(null);
          record("칸", tr`칸을 하나 늘려 기다리던 "${nameOf(hidden[0].key)}"을 올림`, idOfKey(hidden[0].key)); // i18n-ok
        }
      }
      // 한참 비어 있는 칸은 없앤다. 지금 보고 있는 칸은 두고, 마지막 한 칸도 둔다
      const empty = panes.findIndex((k, i) => !k && i !== live.current.focus);
      if (empty < 0 || panes.length < 2 || hidden.length) emptySince.current = 0;
      else if (!emptySince.current) emptySince.current = now;
      else if (now - emptySince.current > EMPTY_PANE_MS) {
        emptySince.current = 0;
        const { widths, focus } = live.current;
        setPanes(panes.filter((_, i) => i !== empty));
        setWidths(widths.filter((_, i) => i !== empty));
        previous.current.splice(empty, 1);
        if (focus > empty) setFocus(focus - 1);
      }
    }
    if (tasksRef.current.some((t) => t.status === "대기" || t.status === "하는 중")) tendTasks(now); // i18n-ok
    // 일감을 끝내고 결과까지 돌려준 세션은 재운다. 열어 두면 칸과 목록을 차지한다. 다시 시키면 Julgi가 깨운다
    for (const t of tasksRef.current) {
      const wkey = "c:" + t.session;
      if (t.status !== "끝남" || !t.session || now - (t.finished ?? now) < 8000 || !open.some((o) => o.key === wkey)) continue; // i18n-ok
      // 내가 그 세션에 직접 말을 걸어 다시 일하고 있거나, 지금 글을 치고 있으면 두고 본다
      if (rawStates.current[wkey]?.[0] === "run" || terms.idle(wkey) < 60_000 || terms.drafting(wkey)) continue;
      close(wkey);
    }
    // 줄기 기억이 생기거나 바뀌었으면(갈아탐, 메모, 합침) 거기서 브레인에 담을 것을 추린다
    if (config.brain && brainReady.current && !learning.current && now - learnAt.current > 15_000) {
      const { threads, memories } = live.current;
      const next = threads.find((t) => (memories[t.id]?.length ?? 0) > 400 && learned.current[t.id] !== memories[t.id].length);
      if (next) {
        learnAt.current = now;
        void learn(next, memories[next.id]);
      }
    }
    if (config.brain && brainReady.current && !learning.current && now - learnAt.current > 15_000) {
      // 켜고 나서 한 번 지도를 살핀다
      if (!mapTried.current && live.current.sessions.length && now - startedAt.current > 45_000) {
        mapTried.current = true;
        learnAt.current = now;
        // 지도가 없으면 그리고, 있으면 넣을 레포가 달라졌을 때만 다시 그린다
        void refreshMap(!mapState.current.at);
      }
      // 매일 정한 시각에 한 번, 정한 요일에는 전부를 보는 매주 점검을 한다.
      // 그 시각에 꺼져 있었으면 놓친 것이다: 가장 최근의 "돌았어야 할 때" 뒤로 돈 기록이 없으면 켜진 지금 돈다
      const d = new Date(now);
      const dayOf = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      const day = dayOf(d);
      const hour = Math.min(23, Math.max(0, Math.round(config.reviewHour)));
      // 가장 최근에 돌았어야 할 날: 오늘 그 시각이 지났으면 오늘, 아니면 어제
      const due = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getHours() >= hour ? 0 : 1));
      const dueWeek = new Date(due);
      dueWeek.setDate(due.getDate() - ((due.getDay() - config.reviewDay + 7) % 7));
      const weekDue = (daily.current.week ?? "") < dayOf(dueWeek);
      const dayDue = (daily.current.day ?? "") < dayOf(due);
      if ((weekDue || dayDue) && live.current.sessions.length && now - startedAt.current > 60_000) {
        daily.current = { day, week: weekDue ? day : daily.current.week };
        learnAt.current = now;
        void invoke("data_write", { name: "brain-daily.json", text: JSON.stringify(daily.current) });
        void review(weekDue ? "매주" : "매일"); // i18n-ok
      }
    }
    // 요약과 이름이 없는 최근 세션을 한가할 때 하나씩 채운다. 목록의 이름과 보낼 곳 고르기가 이 요약에 기댄다
    if (config.summarize && !noting.current.size && backfilled.current < BACKFILL_MAX && now - backfillAt.current > BACKFILL_EVERY_MS) {
      const stale = (s: Session) => !live.current.names[s.id] || (noted.current[s.id] ?? 0) < s.mtime;
      // 지금도 바뀌고 있는 세션(여기서든 다른 곳에서든)은 쉴 때까지 둔다
      const next = live.current.items.slice(0, 50).find((item) => !item.session.auto && stale(item.session) && now / 1000 - item.session.mtime > 600 && !tried.current.has(item.session.id));
      if (next) {
        backfillAt.current = now;
        backfilled.current += 1;
        tried.current.add(next.session.id);
        void summarize(next.session.id);
      }
    }
    // 믿기로 정해 둔 폴더에서 Claude Code가 "이 폴더를 믿느냐"에 멈춰 있으면 대신 "믿는다"를 누른다.
    // 훅이 돌기 전이라 상태가 없어서, 그대로 두면 보낸 일이 시작도 못 한 채 가려져 있다.
    // 내가 "레포가 모여 있는 폴더"나 레포를 직접 정해 두었으면 지도의 레포들도 믿는 폴더로 본다.
    // 일감을 맡은 세션이 처음 쓰는 레포에서 "이 폴더를 믿느냐"에 멈춰 서면 조율이 거기서 끊긴다
    const designated = config.mapRoot.trim() || config.repos.length ? mapState.current.repos.map((r) => r.cwd) : [];
    const dirs = [live.current.base, live.current.home + "/.julgi/worktrees", live.current.home + "/.julgi/grown", ...config.autoTrust.map((p) => p.replace(/^~(?=\/|$)/, live.current.home)), ...designated].filter(Boolean);
    for (const o of open) {
      if (!o.sessionId || states[o.key] || trustedOnce.current.has(o.key) || !terms.opened(o.key) || terms.age(o.key) > 40_000) continue;
      if (!dirs.some((dir) => o.cwd === dir || o.cwd.startsWith(dir + "/"))) continue;
      const lines = terms.text(o.key).split("\n");
      const yes = lines.findIndex((line) => /Yes, I trust this folder/.test(line));
      const at = lines.findIndex((line) => /❯/.test(line) && /(Yes, I trust|No, exit)/.test(line));
      if (yes < 0 || at < 0) continue;
      // 화살표가 실제로 "믿는다"에 가 있는 걸 화면에서 본 다음에만 Enter를 누른다.
      // 물음이 막 뜬 때는 키를 못 받기도 해서, 한꺼번에 누르면 "아니오"에서 Enter가 들어간다.
      if (yes !== at) {
        terms.send(o.key, (yes > at ? "\x1b[B" : "\x1b[A").repeat(Math.abs(yes - at)));
        continue;
      }
      trustedOnce.current.add(o.key);
      terms.send(o.key, "\r");
      record("허용", tr`${o.cwd.replace(live.current.home, "~")} 폴더를 믿는다고 대신 답함`, o.sessionId); // i18n-ok
    }
    for (const o of open) {
      if (!o.sessionId) continue;
      const st = states[o.key];
      // 세션이 스스로 갈아타 달라고 했으면 그 답이 끝난 뒤에 한다
      if (wantHandoff.current.has(o.key) && (waiting(st) || replied(st))) {
        wantHandoff.current.delete(o.key);
        handoff(o.key);
      } else if (replied(st) && now - st!.since > NOTE_AFTER_MS) void summarize(o.sessionId);
    }
    // 메모리가 한도를 넘으면 시간을 기다리지 않고 재운다. 잰 값 하나에 하나씩만: 재운 것이 다음 잰 값에 반영된 뒤 다시 본다
    const mem = loadRef.current;
    const total = Object.values(mem.rows).reduce((sum, [rss]) => sum + rss, 0) / 1_048_576;
    if (config.memoryLimitGb > 0 && total > config.memoryLimitGb && mem.at > mem.sleptAt && now - startedAt.current > 120_000) {
      const idle = (o: Open) => Math.min(terms.idle(o.key), now - (shownAt.current[o.key] ?? 0));
      const pick = open
        .filter((o) => o.key.startsWith("c:") && !panes.includes(o.key) && !handing.includes(o.key) && !pinned.includes(o.key))
        // 답까지 본 세션이거나, 켠 뒤로 한 번도 안 띄운 세션만
        .filter((o) => (states[o.key] ? states[o.key].state === "told" || (states[o.key].state === "wait" && seen.current[o.key] === states[o.key].since) : true) && idle(o) > 600_000)
        .sort((a, b) => idle(b) - idle(a))[0];
      if (pick) {
        mem.sleptAt = now;
        record("재움", tr`"${nameOf(pick.key)}" · 세션들의 메모리가 ${total.toFixed(1)}GB로 한도 ${config.memoryLimitGb}GB를 넘어서 (이 세션 ${((mem.rows[pick.key]?.[0] ?? 0) / 1024).toFixed(0)}MB)`, pick.sessionId); // i18n-ok
        close(pick.key);
      }
    }
    if (config.sleepHours > 0)
      for (const o of open) {
        const st = states[o.key];
        const limit = config.sleepHours * 3_600_000;
        // 답을 본 뒤 오래 쉰 세션. 그리고 Julgi를 다시 켠 뒤 한 번도 띄우지 않아 상태조차 없는 세션:
        // 이런 것은 목록에만 올라 있어서, 대화가 마지막으로 바뀐 때로 쉬었는지를 본다. 안 그러면 영영 열림에 남는다
        const last = (live.current.byId.get(o.sessionId ?? "")?.mtime ?? 0) * 1000;
        const never = !st && last > 0 && now - last > limit && now - startedAt.current > 60_000;
        // 칸에 띄워 본 것도 쓴 것으로 친다. 마지막으로 칸에서 본 때부터 다시 센다
        const looked = now - (shownAt.current[o.key] ?? 0) > limit && terms.idle(o.key) > limit;
        // 보고만 한 세션은 내가 답을 봤는지와 상관없이 쉰 시간만 본다
        const rested = looked && (never || (st?.state === "told" && now - st.since > limit) || (st?.state === "wait" && seen.current[o.key] === st.since && now - st.since > limit));
        // 고정한 세션은 재우지 않는다. 며칠씩 이어 가는 주 세션을 그렇게 둔다
        if (rested && o.key.startsWith("c:") && !panes.includes(o.key) && !handing.includes(o.key) && !pinned.includes(o.key)) {
          record("재움", tr`"${nameOf(o.key)}" · 답을 본 뒤 ${config.sleepHours}시간 넘게 쉬어서`, o.sessionId); // i18n-ok
          close(o.key);
        }
      }
  };
  const exited = (key: string) => {
    if (terms.age(key) > QUICK_EXIT_MS) return close(key);
    terms.note(key, tr("바로 끝났다. 위 내용을 확인하고 ⌘W로 닫는다."));
    setDead((list) => [...list, key]);
  };
  const nextWaiting = () => {
    const { open, states, panes, focus, prNews } = live.current;
    // PR에 일이 생긴 세션도 내 차례다. 답을 기다리는 세션 다음에 둔다
    const queue = open
      .filter((o) => (waiting(states[o.key]) || (prNews[o.key] && states[o.key]?.state !== "run")) && o.key !== panes[focus])
      .sort((a, b) => (states[a.key]?.since ?? Infinity) - (states[b.key]?.since ?? Infinity));
    if (queue.length) show(queue[0].key);
  };
  const resize = (size: number) => {
    const next = Math.max(9, Math.min(22, size));
    terms.setFontSize(next);
    setFontSize(next);
  };
  const pick = (p: Pick) => {
    setOverlay(null);
    if (p.kind === "open") show(p.key);
    else if (p.kind === "session") openSession(p.session);
    else if (p.kind === "link") {
      const pr = prOf(p.url);
      if (pr) openPr(pr);
      else void openUrl(p.url);
    } else if (p.kind === "ticket") {
      if (!p.key) return;
      setTicketShown(p.key);
      setTicketNews(({ [p.key]: _, ...rest }) => rest);
    } else if (p.kind === "pr") {
      if (!p.number) return;
      if (p.repo) return openPr({ repo: p.repo, number: p.number });
      // 번호만 쳤으면 지금 칸의 레포에서 연다. GitHub 레포일 때만 된다
      const cwd = cwdOf(current);
      void invoke<string | null>("repo_slug", { path: cwd }).then((repo) => (repo ? openPr({ repo, number: p.number }) : say(tr`${repoOf(cwd)}는 GitHub 레포가 아니다.`)));
    } else newSession(p.cwd);
  };
  const join = (sessionId: string) => {
    setOverlay(null);
    const o = live.current.open.find((x) => x.key === live.current.panes[live.current.focus]);
    if (!o?.sessionId) return say(tr("지금 칸에 Claude 세션이 있어야 묶을 수 있다."));
    joinThreads(o.sessionId, sessionId);
  };
  const attach = (s: Session) => {
    setOverlay(null);
    const key = live.current.panes[live.current.focus];
    if (!key || key === "c:" + s.id) return;
    const summary = (s.recap || s.title).replace(/\s+/g, " ").trim();
    terms.paste(key, `[참고: 다른 세션 "${s.title}" (${s.repo}) 요약] ${summary} `); // i18n-ok
  };

  /** PR에 일이 생겼다: 기록에 남기고, 창을 안 보고 있으면 알린다. 알림을 누르고 돌아오면 그 세션이 뜬다 */
  const prNotice = (key: string, text: string) => {
    const sessionId = live.current.open.find((o) => o.key === key)?.sessionId;
    record("PR", `${nameOf(key)} · ${text}`, sessionId);
    if (!config.notify || document.hasFocus()) return;
    void invoke("notify", { title: nameOf(key).slice(0, 60), body: text });
    notified.current = { key, at: Date.now() };
  };
  /** 잠든 세션의 PR에 일이 생겼다: 내 차례에 올리고 알린다. 설정에 따라 바로 깨운다 */
  const sleepNotice = (sessionId: string, pr: PrTarget, news: string) => {
    const s = live.current.byId.get(sessionId);
    const name = live.current.names[sessionId] || s?.title || tr("세션");
    record("PR", tr`${name.slice(0, 40)} (잠듦) · PR #${pr.number} ${news}`, sessionId);
    if (config.wakeOnPr && s) {
      wakeQuiet(s);
      setPrNews((old) => ({ ...old, ["c:" + sessionId]: news }));
    } else setSleepNews((old) => ({ ...old, [sessionId]: { news, pr } }));
    if (!config.notify || document.hasFocus()) return;
    void invoke("notify", { title: name.slice(0, 60), body: `PR #${pr.number} ${news}` });
    notified.current = { key: "c:" + sessionId, at: Date.now() };
  };
  /** 세션을 깨워 목록에만 올린다. 지금 보는 칸은 건드리지 않는다 */
  const wakeQuiet = (s: Session) => {
    const key = "c:" + s.id;
    if (live.current.open.some((o) => o.key === key)) return;
    terms.create({ key, cwd: s.cwd, command: resumeCommand(s.id) });
    setOpen((list) => [...list, { key, label: s.title, cwd: s.cwd, sessionId: s.id }]);
  };
  /** 잠든 세션을 깨워 칸에 올린다. PR 일 때문에 올라온 것이면 그 표시를 열린 세션 쪽으로 옮긴다 */
  const wake = (sessionId: string) => {
    const s = live.current.byId.get(sessionId);
    if (!s) return;
    const news = live.current.sleepNews[sessionId]?.news;
    setSleepNews(({ [sessionId]: _, ...rest }) => rest);
    if (news) setPrNews((old) => ({ ...old, ["c:" + sessionId]: news }));
    openSession(s);
  };
  // ── Jira 도우미 ──
  const jiraConn = (): JiraConn => ({ site: config.jiraSite, email: config.jiraEmail, kind: config.jiraKind });
  /** 세션의 티켓: 직접 이은 것 → 브랜치 이름의 키 → 세션이 남긴 티켓 주소 */
  const ticketOfSession = (id?: string) => {
    if (!id || !config.jiraSite) return undefined;
    const s = live.current.byId.get(id);
    return live.current.ticketLinks[id] ?? (s && firstKey(s.branch)) ?? s?.links.map(keyOfUrl).find(Boolean);
  };
  const ticketNotice = (t: Ticket, news: string, hush = false) => {
    record("티켓", `${t.key} ${news}: ${t.title.slice(0, 60)}`); // i18n-ok
    if (hush || !config.notify || document.hasFocus()) return;
    void invoke("notify", { title: `${t.key} · ${news}`, body: t.title.slice(0, 80) });
  };
  /** 이름으로 전환한다. 그 이름의 전환이 지금 없으면 알려만 준다 */
  const moveTicket = async (key: string, name: string) => {
    const list = await invoke<{ id: string; name: string; to: string }[]>("jira_transitions", { conn: jiraConn(), key }).catch(() => []);
    const hit = list.find((t) => t.to.toLowerCase() === name.toLowerCase() || t.name.toLowerCase() === name.toLowerCase());
    if (!hit) return say(tr`${key}에는 지금 "${name}"로 가는 전환이 없다. 티켓 화면에서 고른다.`, 6000);
    await invoke("jira_transition", { conn: jiraConn(), key, id: hit.id, comment: "" }).then(
      () => (record("티켓", tr`${key}을 ${hit.to}로 옮김`), say(`${key} → ${hit.to}`), refreshTickets.current()), // i18n-ok
      (e) => say(tr`옮기지 못했다: ${String(e).slice(0, 80)}`, 6000),
    );
  };
  /**
   * 티켓에 Julgi가 아는 일을 붙인다: 이어진 세션과 그 상태, 그 세션의 PR과 그 형편에서 "지금 누가 무엇을 할 차례인지"를 한 줄로 낸다.
   * Jira는 상태 이름만 알고, 그 일이 실제로 어디까지 갔는지는 세션과 PR이 안다
   */
  const ticketWork = (t: Ticket): TicketWork => {
    const { open, states, byId, names } = live.current;
    const ids = [...byId.values()].filter((s) => ticketOfSession(s.id) === t.key).sort((a, b) => b.mtime - a.mtime).map((s) => s.id);
    const shown = open.filter((o) => o.sessionId && ids.includes(o.sessionId));
    const nameOfId = (id: string) => names[id] || byId.get(id)?.title || tr("세션");
    const pr = ids.map((id) => prOfSession(id)).find(Boolean) ?? minePrs.map((a) => (firstKey(a.title) === t.key ? { repo: a.repository.nameWithOwner, number: a.number } : null)).find(Boolean) ?? undefined;
    const seen = pr ? prSeen.current[`${pr.repo}#${pr.number}`] : undefined;
    const base = { pr: pr ?? undefined, session: shown[0]?.key ?? (ids[0] ? "c:" + ids[0] : undefined), sessionName: ids[0] ? nameOfId(ids[0]) : undefined };
    const no = pr ? prNo(pr) : "";
    const done = t.statusCategory === "done";
    // 1. 세션이 나를 기다린다
    const asking = shown.find((o) => waiting(states[o.key]));
    if (asking) {
      const is = states[asking.key]?.state;
      const why = is === "wait" ? (asking.sessionId && triaged.current[asking.sessionId]?.why) || "" : "";
      return { ...base, rank: 0, step: is === "ask" ? tr("세션이 허락을 기다린다") : is === "stuck" ? tr("세션이 일하다 멈춰 있다") : tr("세션이 내 답을 기다린다"), detail: why, session: asking.key, sessionName: nameOf(asking.key) };
    }
    // 2. PR에 내가 손댈 일이 있다
    if (seen?.state === "OPEN" && seen.ci === "FAILURE") return { ...base, rank: 0, step: tr`PR ${no} CI가 깨졌다`, detail: tr("세션에 고치라고 한다") };
    if (seen?.state === "OPEN" && seen.decision === "CHANGES_REQUESTED") return { ...base, rank: 0, step: tr`PR ${no} 수정 요청을 받았다`, detail: tr("리뷰 의견을 반영한다") };
    if (seen?.state === "MERGED" && !done) return { ...base, rank: 0, step: tr`PR ${no}이 머지됐다`, detail: config.jiraMergeTransition ? tr`티켓을 ${config.jiraMergeTransition}로 옮길 차례` : tr("티켓 상태를 옮길 차례") };
    if (seen?.state === "OPEN" && seen.decision === "APPROVED") return { ...base, rank: 0, step: tr`PR ${no} 승인됐다`, detail: tr("머지할 차례") };
    // 3. 돌아가는 중
    const running = shown.find((o) => states[o.key]?.state === "run" || states[o.key]?.state === "hold");
    if (running) return { ...base, rank: 1, step: tr("세션이 일하는 중"), session: running.key, sessionName: nameOf(running.key) };
    // 4. 남을 기다린다
    if (seen?.state === "OPEN") return { ...base, rank: 2, step: tr`PR ${no} 리뷰를 기다리는 중` };
    if (done) return { ...base, rank: 5, step: tr("끝남") };
    if (seen?.state === "CLOSED") return { ...base, rank: 3, step: tr`PR ${no}이 머지 없이 닫혔다`, detail: tr("이어 할지 정한다") };
    // 5. 하다 만 일, 시작 안 한 일
    if (ids.length) return { ...base, rank: 3, step: pr ? tr`PR ${no}을 올린 뒤 멈춰 있다` : tr("하다가 멈춰 있다"), detail: tr("세션을 열어 이어 한다") };
    return { ...base, rank: 4, step: tr("시작 안 함"), detail: tr("⌘Enter로 이 티켓을 시작한다") };
  };
  /** 티켓과 이어진 세션의 PR이 올라오거나 머지되면 상태를 옮길지 한 번 묻는다 */
  const ticketOffer = (sessionId: string | undefined, pr: PrTarget, kind: "pr" | "merge") => {
    const key = ticketOfSession(sessionId);
    const name = kind === "pr" ? config.jiraPrTransition : config.jiraMergeTransition;
    if (!key || !name.trim()) return;
    setOffer({ text: kind === "pr" ? tr`PR이 올라왔다 (#${pr.number}). ${key}을 ${name}로 옮길까?` : tr`PR이 머지됐다 (#${pr.number}). ${key}을 ${name}로 옮길까?`, yes: tr`${name}로 옮기기`, run: () => void moveTicket(key, name) });
  };
  /**
   * 열려 있는 세션에 이어진 티켓이 끝났는지(완료·거부 등 Done 범주) 본다. 내 티켓 목록은 안 끝난 것만 주므로 따로 묻는다.
   * 끝났으면 세션에 표시하고, 한 번 알리고, 세션을 끝낼지 묻는다. alive: 방금 받은 안 끝난 티켓들
   */
  const checkEnded = async (alive: Set<string>) => {
    const { open, threads } = live.current;
    const held = new Map<string, string>(); // 티켓 키 → 세션 ID
    for (const o of open) {
      const key = ticketOfSession(o.sessionId);
      if (!key || !o.sessionId || alive.has(key) || doneRef.current[key] || held.has(key)) continue;
      if (threads.find((t) => t.sessions.includes(o.sessionId!))?.done) continue;
      held.set(key, o.sessionId);
    }
    if (!held.size) return;
    const ended = await invoke<Ticket[]>("jira_search", { conn: jiraConn(), jql: `key in (${[...held.keys()].join(", ")}) AND statusCategory = Done`, limit: 50 }).catch(() => []);
    if (!ended.length) return;
    const next = { ...doneRef.current };
    for (const t of ended) {
      const sessionId = held.get(t.key);
      if (!sessionId) continue;
      next[t.key] = t.status;
      record("티켓", tr`${t.key}이 끝났다 (${t.status}). 이어진 세션이 열려 있다`, sessionId); // i18n-ok
      if (config.notify && !document.hasFocus()) void invoke("notify", { title: tr`${t.key} · 티켓 끝남 · ${t.status}`, body: t.title.slice(0, 80) });
      setOffer({
        text: tr`${t.key}이 끝났다 (${t.status}). 이어진 세션을 끝낼까?`,
        yes: tr`세션 끝내기`,
        run: () => {
          if (!live.current.threads.find((x) => x.sessions.includes(sessionId))?.done) finishThread(sessionId);
        },
      });
    }
    doneRef.current = next;
    setTicketDone(next);
    void invoke("data_write", { name: "jira-done.json", text: JSON.stringify(next) });
  };
  /** "이 티켓으로 시작"을 눌렀다. 이미 이 티켓을 하던 세션이 있으면 그 세션을 보여 주고, 새로 만들지는 한 번 묻는다 */
  const beginTicket = (t: TicketFull) => {
    const had = ticketWork(t as unknown as Ticket);
    if (!had.session) return setStartTicket(t);
    setStartTicket(null);
    setTicketShown(null);
    setOverlay(null);
    // 칸에 열려 있으면 그 칸으로, 닫혀 있으면 다시 연다
    const closed = live.current.open.some((o) => o.key === had.session) ? undefined : live.current.byId.get(had.session.replace(/^c:/, ""));
    if (closed) openSession(closed);
    else show(had.session);
    setOffer({ text: tr`${t.key}을 하던 세션이 있어 그 세션을 열었다 (${had.sessionName ?? ""}). 그래도 새로 시작할까?`, yes: tr`새 세션으로 시작`, run: () => setStartTicket(t) });
  };
  /** 이 티켓으로 시작: 워크트리 + 브랜치를 따고, 첫 지시를 들려 새 세션을 띄우고, 세션과 티켓을 잇는다 */
  const startFromTicket = async (t: TicketFull, o: { cwd: string; repo: string; branch: string; prompt: string; transition: boolean }, quiet = false): Promise<string | undefined> => {
    // quiet: 한꺼번에 맡긴 것이다. 열어 둔 화면을 닫지 않고 칸도 바꾸지 않는다
    if (!quiet) {
      setStartTicket(null);
      setTicketShown(null);
      setOverlay(null);
    }
    setTicketNews(({ [t.key]: _, ...rest }) => rest);
    const name = o.branch.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60);
    const path = await invoke<string>("worktree_add", { repo: o.cwd, name, branch: o.branch }).catch((e) => (say(tr`워크트리를 따지 못했다: ${String(e).slice(0, 100)}`, 8000), ""));
    if (!path) return;
    const id = crypto.randomUUID();
    const key = "c:" + id;
    // 티켓에 붙은 그림은 파일로 받아 경로를 알려 준다. 세션이 읽어 본다
    const shots = (await Promise.all((t.images ?? []).slice(0, 8).map((im) => invoke<{ path: string }>("jira_image", { conn: jiraConn(), id: im.id, name: im.name }).then((r) => r.path, () => "")))).filter(Boolean);
    const text = shots.length ? `${o.prompt}\n\n${tr`티켓에 붙은 그림이다. 시작하기 전에 읽어 본다:`}\n${shots.map((x) => `- ${x}`).join("\n")}` : o.prompt;
    const brief = await invoke<string>("data_write", { name: `outbox/${crypto.randomUUID()}.md`, text });
    terms.create({ key, cwd: path, command: withPrompt(newCommand(id), brief) });
    setOpen((list) => [...list, { key, label: `${t.key} ${t.title}`.slice(0, 40), cwd: path, sessionId: id }]);
    if (!quiet) show(key);
    const links = { ...live.current.ticketLinks, [id]: t.key };
    setTicketLinks(links);
    void invoke("data_write", { name: "tickets.json", text: JSON.stringify(links) });
    // 프로젝트 키 → 레포를 기억한다
    const project = t.key.split("-")[0];
    const pairs = config.jiraRepos.split(",").map((p) => p.trim()).filter((p) => p && !p.startsWith(project + "="));
    setConfig("jiraRepos", [...pairs, `${project}=${o.repo}`].join(", "));
    record("시작", tr`${t.key} "${t.title.slice(0, 40)}"을 ${o.repo}의 ${o.branch}에서 새 세션으로 시작`, id); // i18n-ok
    if (o.transition && config.jiraStartTransition.trim()) void moveTicket(t.key, config.jiraStartTransition);
    return id;
  };
  // ── 버그 한꺼번에 맡기기 ──
  /** 고른 버그들을 대기열에 넣는다. 이미 맡긴 것과 이어진 세션이 있는 것은 넣지 않는다 */
  const handBugs = (list: { key: string; title: string; repo: string; cwd: string }[]) => {
    const have = new Set(bugs.current.jobs.filter((j) => j.state !== "done" && j.state !== "held").map((j) => j.key));
    const fresh = list.filter((b) => !have.has(b.key) && !ticketWork({ key: b.key, statusCategory: "" } as Ticket).session);
    if (!fresh.length) return say(tr("맡길 버그가 없다. 이미 세션이 이어져 있다."));
    const keys = new Set(fresh.map((b) => b.key));
    saveBugs([...bugs.current.jobs.filter((j) => !keys.has(j.key)), ...fresh.map((b) => ({ ...b, state: "queued" as const }))], false);
    record("버그 맡김", tr`버그 ${fresh.length}건을 진단 세션에 맡김: ${fresh.map((b) => b.key).join(", ").slice(0, 80)}`); // i18n-ok
    say(tr`버그 ${fresh.length}건을 맡겼다. ${config.bugParallel}개씩 진단하고, 정할 것이 생기면 ⌘J에 올린다.`, 6000);
  };
  const setBug = (key: string, patch: Partial<BugJob>) => saveBugs(bugs.current.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  /** 세션 ID로 맡긴 버그를 찾는다 */
  const bugOf = (sessionId?: string) => (sessionId ? bugs.current.jobs.find((j) => j.sessionId === sessionId) : undefined);
  /** 진단 전용 첫 지시. 고치지 않고 정리만 하고 멈춘다 */
  const bugPrompt = (t: TicketFull) =>
    `${promptOf(t).split("\n").slice(0, -1).join("\n")}\n${tr`이 버그를 진단만 한다. 코드 수정, 커밋, 푸시, Jira 상태 변경과 댓글은 하지 않는다. 재현 경로와 코드를 읽고 원인을 찾은 뒤 멈춘다. 답의 첫 줄은 반드시 "결론: "으로 시작하는 한 문장으로 쓴다(예: "결론: 재시도 간격 계산이 초 단위와 밀리초 단위를 섞어 쓴다", "결론: 이미 고쳐졌다", "결론: 재현되지 않는다"). 그 아래에 원인, 코드 위치(파일:줄), 수정안, 사람이 정해야 할 것을 차례로 정리한다. 이미 고쳐졌거나 재현되지 않으면 그 근거를 적고 멈춘다. 내가 "고쳐"라고 하기 전에는 아무것도 바꾸지 않는다.`}`;
  /** 1.5초마다: 진단이 끝난 것을 "정할 차례"로 올리고, 자리가 나면 다음 버그를 시작한다 */
  const tendBugs = () => {
    const b = bugs.current;
    if (!b.loadedAt || !b.jobs.length) return;
    const { open, states } = live.current;
    // 다시 켠 직후에는 칸이 아직 안 돌아왔을 수 있다. 조금 기다렸다가 본다
    const settled = Date.now() - b.loadedAt > 15_000;
    let jobs = b.jobs;
    for (const j of jobs) {
      if (j.state !== "diag") continue;
      const o = open.find((x) => x.sessionId === j.sessionId);
      if (!o) {
        if (settled) jobs = jobs.map((x) => (x === j ? { ...x, state: "held" as const, why: tr("세션이 닫혔다") } : x));
        continue;
      }
      if (replied(states[o.key])) jobs = jobs.map((x) => (x === j ? { ...x, state: "decide" as const } : x));
    }
    if (jobs !== b.jobs) saveBugs(jobs);
    const next = jobs.find((j) => j.state === "queued");
    if (b.stopped || b.starting || !next || jobs.filter((j) => j.state === "diag").length >= Math.max(1, config.bugParallel)) return;
    b.starting = true;
    void (async () => {
      try {
        // 그 사이 이어진 세션이 생겼으면 또 만들지 않는다
        const had = ticketWork({ key: next.key, statusCategory: "" } as Ticket);
        if (had.session) return setBug(next.key, { state: "held", why: tr("이미 이어진 세션이 있다") });
        const t = await invoke<TicketFull>("jira_view", { conn: jiraConn(), key: next.key });
        const slug = slugOf(t.title);
        const id = await startFromTicket(t, { cwd: next.cwd, repo: next.repo, branch: slug ? `${t.key}-${slug}` : t.key, prompt: bugPrompt(t), transition: false }, true);
        setBug(next.key, id ? { state: "diag", sessionId: id } : { state: "held", why: tr("세션을 띄우지 못했다") });
      } catch (e) {
        setBug(next.key, { state: "held", why: String(e).slice(0, 100) });
      } finally {
        b.starting = false;
      }
    })();
  };
  /** ⌘J에서 "고쳐": 그 세션에 수정을 진행하라고 보낸다 */
  const fixBug = (key: string) => {
    const j = bugOf(live.current.open.find((o) => o.key === key)?.sessionId);
    if (!j) return;
    terms.submitWhenClear(key, tr("고쳐. 위에 정리한 수정안대로 진행하고, 테스트를 돌린 뒤 커밋한다. 정할 것으로 적은 부분은 가장 안전한 쪽으로 하고 무엇을 골랐는지 적는다."));
    setBug(j.key, { state: "done" });
    record("버그", tr`${j.key} 진단을 보고 고치라고 함`, j.sessionId); // i18n-ok
  };
  /** ⌘J에서 "보류": 세션은 열어 두고 대기열에서만 내린다. 그 답으로는 내 차례에 다시 올리지 않는다 */
  const holdBug = (key: string) => {
    const j = bugOf(live.current.open.find((o) => o.key === key)?.sessionId);
    if (j) setBug(j.key, { state: "held", heldSince: live.current.states[key]?.since });
  };
  /** 세션과 이어지지 않은 내 PR에 일이 생겼다 */
  const mineNotice = (pr: ReviewAsk, news: string) => {
    const repo = repoName(pr.repository.nameWithOwner);
    record("PR", tr`내 PR ${repo} #${pr.number} · ${news}: ${pr.title.slice(0, 60)}`);
    if (!config.notify || document.hasFocus()) return;
    void invoke("notify", { title: `${repo} #${pr.number} · ${news}`, body: pr.title.slice(0, 80) });
  };
  /** 새 리뷰 요청이 왔다 */
  const askNotice = (a: ReviewAsk) => {
    const repo = repoName(a.repository.nameWithOwner);
    record("리뷰 요청", `${a.author.login}: ${repo} #${a.number} ${a.title.slice(0, 60)}`); // i18n-ok
    if (!config.notify || document.hasFocus()) return;
    void invoke("notify", { title: tr`리뷰 요청 · ${repo} #${a.number}`, body: `${a.author.login}: ${a.title.slice(0, 80)}` });
  };
  /** 작업 페이지의 묶음: 세션 PR(열린 세션과 최근 잠든 세션), 내 PR, 리뷰 요청 */
  const workGroups = (): WorkGroup[] => {
    const { open, sessions, names } = live.current;
    const status = (t: PrTarget) => prs[`${t.repo}#${t.number}`];
    const seen = new Set<string>();
    const sessionRows: WorkRow[] = [];
    const cutoff = Date.now() / 1000 - config.recentDays * 86400;
    const openIds = new Set(open.map((o) => o.sessionId));
    // 열린 세션 먼저, 그다음 최근 잠든 세션. 한 PR은 가장 최근 세션 하나에만 붙인다
    const candidates = [...open.map((o) => o.sessionId).filter((id): id is string => !!id), ...sessions.filter((s) => s.mtime >= cutoff && !openIds.has(s.id)).map((s) => s.id)];
    for (const id of candidates) {
      const target = prOfSession(id);
      if (!target || seen.has(`${target.repo}#${target.number}`)) continue;
      seen.add(`${target.repo}#${target.number}`);
      const s = byId.get(id);
      sessionRows.push({ target, title: names[id] || s?.title || tr("세션"), by: tr("세션"), status: status(target), news: prNews["c:" + id] ?? sleepNews[id]?.news, sessionId: id, sleeping: !openIds.has(id) });
    }
    const mineRows: WorkRow[] = minePrs.map((p) => {
      const target = { repo: p.repository.nameWithOwner, number: p.number };
      const id = `${target.repo}#${target.number}`;
      const sessionRow = sessionRows.find((r) => `${r.target.repo}#${r.target.number}` === id);
      return { target, title: p.title, by: sessionRow ? tr`세션 "${sessionRow.title.slice(0, 20)}"` : "", at: p.updatedAt, status: status(target), news: mineNews[id]?.news ?? sessionRow?.news, sessionId: sessionRow?.sessionId, sleeping: sessionRow?.sleeping };
    });
    const askRows: WorkRow[] = asks.map((a) => ({ target: { repo: a.repository.nameWithOwner, number: a.number }, title: a.title, by: a.author.login, at: a.updatedAt, ask: a }));
    return [
      { id: "mine", title: tr("내 PR"), hint: tr("내가 연 열린 PR 전부"), rows: mineRows },
      { id: "review", title: tr("리뷰 요청"), hint: tr("나를 리뷰어로 지정한 PR"), rows: askRows },
      { id: "session", title: tr("세션 PR"), hint: tr("열린 세션과 최근 세션이 올린 PR (머지·닫힌 것 포함)"), rows: sessionRows },
    ];
  };
  /** 리뷰 요청을 새 세션에 맡긴다. 로컬에 그 레포가 있으면 거기서 띄워 코드도 같이 읽게 한다 */
  const handReview = (a: ReviewAsk, extra: string) => {
    const name = repoName(a.repository.nameWithOwner);
    const cwd = mapState.current.repos.find((r) => r.repo === name)?.cwd ?? (live.current.base || live.current.home);
    // i18n-off
    const ask =
      `PR ${a.url} (${a.repository.nameWithOwner} #${a.number} "${a.title}", 작성 ${a.author.login})을 리뷰해 줘.\n\n` +
      (isLab(a.repository.nameWithOwner)
        ? `- \`glab mr view ${a.number} -R ${a.repository.nameWithOwner.slice(7)} --comments\`와 \`glab mr diff ${a.number} -R ${a.repository.nameWithOwner.slice(7)}\`로 읽는다. 필요하면 이 폴더의 코드를 같이 본다.\n`
        : `- \`gh pr view ${a.number} -R ${a.repository.nameWithOwner} --comments\`와 \`gh pr diff ${a.number} -R ${a.repository.nameWithOwner}\`로 읽는다. 필요하면 이 폴더의 코드를 같이 본다.\n`) +
      `- 버그, 위험, 빠진 처리, 확인할 것을 "파일:줄 — 무엇을 왜" 목록으로 정리한다. 중요한 것부터.\n` +
      `- GitHub에 코멘트를 달거나 승인하지 않는다. 올리는 것은 내가 Julgi의 PR 화면에서 한다.` +
      (extra ? `\n\n덧붙여: ${extra}` : "");
    // i18n-on
    void dispatch({ kind: "new", cwd }, ask, { rank: 0, by: "리뷰 요청" }); // i18n-ok
  };
  const actions = useRef({ readUsage, publishRemote, say, dispatch, show, close, sleep, requestQuit, handoff, exited, newSession, newShell, nextWaiting, openTerm, resize, split, unsplit, finishThread, move, togglePin, tend, triage, serve, confirmClose, toggleReview, prNotice, askNotice, mineNotice, sleepNotice, wake, ticketNotice, ticketOffer, checkEnded });
  actions.current = { readUsage, publishRemote, say, dispatch, show, close, sleep, requestQuit, handoff, exited, newSession, newShell, nextWaiting, openTerm, resize, split, unsplit, finishThread, move, togglePin, tend, triage, serve, confirmClose, toggleReview, prNotice, askNotice, mineNotice, sleepNotice, wake, ticketNotice, ticketOffer, checkEnded };

  /** 세션이 남긴 링크 가운데 마지막 PR */
  const prOfSession = (id?: string) => {
    const s = id ? live.current.byId.get(id) : undefined;
    const url = s?.links.slice().reverse().find((u) => prOf(u));
    return url ? prOf(url) : null;
  };
  // 2분마다 열린 세션의 PR을 본다. CI가 깨지거나 남이 코멘트를 달거나 리뷰를 받거나 머지되면 그 세션을 내 차례로 올리고 알린다
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "pr-seen.json" }).then((text) => {
      try {
        prSeen.current = text ? JSON.parse(text) : {};
      } catch {
        prSeen.current = {};
      }
    });
    const poll = async () => {
      if (config.prWatch === "off") return setPrs({});
      // 처음 보는 조회(지난 기록이 없음)에서는 모든 PR이 새로 보이므로 티켓 제안을 하지 않는다
      const firstRun = Object.keys(prSeen.current).length === 0;
      const targets = new Map<string, { target: PrTarget; keys: string[]; sleeper?: string; pr?: ReviewAsk }>();
      for (const o of live.current.open) {
        const target = prOfSession(o.sessionId);
        if (!target) continue;
        const id = `${target.repo}#${target.number}`;
        const entry = targets.get(id) ?? { target, keys: [] };
        entry.keys.push(o.key);
        targets.set(id, entry);
      }
      // 잠든 최근 세션이 남긴 PR도 본다. 이미 머지됐거나 닫힌 PR은 더 바뀔 일이 없어 다시 묻지 않는다
      const cutoff = Date.now() / 1000 - config.recentDays * 86400;
      const openIds = new Set(live.current.open.map((o) => o.sessionId));
      let sleepers = 0;
      for (const s of live.current.sessions) {
        if (sleepers >= 20 || s.mtime < cutoff) break;
        if (openIds.has(s.id)) continue;
        const target = prOfSession(s.id);
        if (!target) continue;
        const id = `${target.repo}#${target.number}`;
        const seen = prSeen.current[id];
        if (targets.has(id) || seen?.state === "MERGED" || seen?.state === "CLOSED") continue;
        targets.set(id, { target, keys: [], sleeper: s.id });
        sleepers += 1;
      }
      // 내 PR 전부를 챙기면 세션과 이어지지 않은 내 PR도 같이 본다
      if (config.prWatch === "mine") {
        const text = await invoke<string>("pr_mine").catch(() => "");
        const list = text ? (JSON.parse(text) as ReviewAsk[]) : [];
        setMinePrs(list);
        for (const pr of list) {
          const id = `${pr.repository.nameWithOwner}#${pr.number}`;
          if (!targets.has(id)) targets.set(id, { target: { repo: pr.repository.nameWithOwner, number: pr.number }, keys: [], pr });
        }
      }
      // 지난번에 열려 있던 PR이 이번 목록에 없으면 닫히거나 머지된 것이다. 한 번 더 봐서 알릴 일인지 가린다
      let gone = 0;
      for (const [id, seen] of Object.entries(prSeen.current)) {
        if (gone >= 10 || seen.state !== "OPEN" || targets.has(id)) continue;
        const [repo, number] = [id.slice(0, id.lastIndexOf("#")), Number(id.slice(id.lastIndexOf("#") + 1))];
        targets.set(id, { target: { repo, number }, keys: [], pr: { number, title: `${repoName(repo)} #${number}`, repository: { nameWithOwner: repo }, author: { login: "" }, updatedAt: "", url: prUrl({ repo, number }), isDraft: false } });
        gone += 1;
      }
      const next: Record<string, PrStatus> = {};
      for (const [id, { target, keys, sleeper, pr }] of targets) {
        const now = await invoke<PrStatus>("pr_status", { repo: target.repo, number: target.number }).catch(() => null);
        if (!now) continue;
        next[id] = now;
        const before = prSeen.current[id];
        const news = before ? newsOf(before, now) : "";
        prSeen.current[id] = now;
        // 티켓과 이어진 세션의 PR이 처음 보이거나 머지되면 티켓 상태를 옮길지 묻는다
        const sid = keys.length ? live.current.open.find((o) => o.key === keys[0])?.sessionId : sleeper;
        if (sid && !before && !firstRun && now.state === "OPEN") actions.current.ticketOffer(sid, target, "pr");
        if (sid && news === tr("머지됨")) actions.current.ticketOffer(sid, target, "merge");
        if (!news) continue;
        if (!keys.length && sleeper) {
          actions.current.sleepNotice(sleeper, target, news);
          continue;
        }
        if (pr) {
          setMineNews((old) => ({ ...old, [id]: { ...pr, news } }));
          actions.current.mineNotice(pr, news);
          continue;
        }
        setPrNews((old) => ({ ...old, ...Object.fromEntries(keys.map((k) => [k, news])) }));
        actions.current.prNotice(keys[0], `PR #${target.number} ${news}`);
      }
      setPrs(next);
      void invoke("data_write", { name: "pr-seen.json", text: JSON.stringify(prSeen.current) });
    };
    // 리뷰 요청은 5분마다. 처음 보는 요청이 오면 알린다(Julgi를 켠 직후에 이미 있던 것은 알리지 않는다)
    let known: Set<string> | null = null;
    const pollAsks = async () => {
      if (!config.reviewAsks) return setAsks([]);
      const text = await invoke<string>("pr_review_requests").catch(() => "");
      if (!text) return;
      const list = (JSON.parse(text) as ReviewAsk[]).filter((a) => !a.isDraft);
      if (known) for (const a of list.filter((x) => !known!.has(x.url))) actions.current.askNotice(a);
      known = new Set(list.map((a) => a.url));
      setAsks(list);
    };
    // 주기는 설정에서 바꿀 수 있어서 매번 다시 읽는다
    let timer = 0;
    let askTimer = 0;
    const loop = () => void poll().finally(() => (timer = window.setTimeout(loop, config.prEveryMin * 60_000)));
    const askLoop = () => void pollAsks().finally(() => (askTimer = window.setTimeout(askLoop, config.askEveryMin * 60_000)));
    timer = window.setTimeout(loop, 8000);
    askTimer = window.setTimeout(askLoop, 12_000);
    refreshPrs.current = () => {
      void poll();
      void pollAsks();
    };
    // 다른 앱에 있다 돌아오면 기다리지 않고 바로 본다. 창을 오가며 너무 자주 묻지 않게 20초에 한 번까지
    let lastFocus = 0;
    const onFocus = () => {
      if (!config.refreshOnFocus || Date.now() - lastFocus < 20_000) return;
      lastFocus = Date.now();
      void poll();
      void pollAsks();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      clearTimeout(askTimer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 정한 주기마다 내 티켓을 본다: 새로 배정됨, 상태가 바뀜, 남이 코멘트를 닮 → 알리고 ⌘J에 넣는다. 프로젝트 키는 하루에 한 번
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "jira-seen.json" }).then((t) => {
      try {
        jiraSeen.current = t ? JSON.parse(t) : {};
      } catch {
        jiraSeen.current = {};
      }
    });
    void invoke<string | null>("data_read", { name: "tickets.json" }).then((t) => {
      try {
        setTicketLinks(t ? JSON.parse(t) : {});
      } catch {
        // 깨졌으면 비운 채로 둔다
      }
    });
    let keysAt = 0;
    let timer = 0;
    let lastFocus = 0;
    const poll = async (keys = false) => {
      if (!config.jiraSite) return;
      if (keys || Date.now() - keysAt > 86_400_000) {
        keysAt = Date.now();
        void invoke<string[]>("jira_projects", { conn: jiraConn() }).then(setKnownKeys, () => {});
      }
      if (config.jiraWatch === "off") return setTickets([]);
      const list = await invoke<Ticket[]>("jira_mine", { conn: jiraConn() }).catch(() => null);
      if (!list) return;
      setTickets(list);
      void actions.current.checkEnded(new Set(list.map((t) => t.key)));
      const first = Object.keys(jiraSeen.current).length === 0;
      const next: Record<string, TicketSeen> = {};
      for (const t of list) {
        const news = ticketNews(jiraSeen.current[t.key], t, first);
        const hush = quietNews(jiraSeen.current[t.key], t, config.jiraQuiet);
        next[t.key] = { status: t.status, others: t.others, assigned: true };
        if (!news) continue;
        // 봇 댓글뿐이면 흐리게 표시만 한다. 이미 큰 소식이 걸려 있으면 그건 덮지 않는다
        if (hush && ticketNewsRef.current[t.key] && !quietRef.current.has(t.key)) continue;
        setTicketQuiet((old) => {
          const set = new Set(old);
          if (hush) set.add(t.key);
          else set.delete(t.key);
          return (quietRef.current = set);
        });
        setTicketNews((old) => ({ ...old, [t.key]: news }));
        actions.current.ticketNotice(t, news, hush);
      }
      jiraSeen.current = next;
      void invoke("data_write", { name: "jira-seen.json", text: JSON.stringify(next) });
    };
    refreshTickets.current = (keys = false) => void poll(keys);
    const loop = () => void poll().finally(() => (timer = window.setTimeout(loop, config.jiraEveryMin * 60_000)));
    timer = window.setTimeout(loop, 2_000);
    const onFocus = () => {
      if (!config.refreshOnFocus || Date.now() - lastFocus < 20_000) return;
      lastFocus = Date.now();
      void poll();
    };
    window.addEventListener("focus", onFocus);
    // 티켓 키·주소는 어디서 눌러도 여기로 와서 티켓 화면으로 열린다
    const onTicket = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (!config.jiraSite) return say(tr("Jira에 연결돼 있지 않다. ⌘,의 연결에서 연결한다."));
      setTicketShown(key);
      setTicketNews(({ [key]: _, ...rest }) => rest);
    };
    window.addEventListener("julgi:ticket", onTicket);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("julgi:ticket", onTicket);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // PR 일이 생긴 세션을 보면 그 표시는 풀린다
  useEffect(() => {
    if (current && prNews[current]) setPrNews(({ [current]: _, ...rest }) => rest);
  }, [current, prNews]);

  useEffect(() => {
    const scan = () =>
      void invoke<string[]>("sessions_elsewhere")
        .then(setAlive, () => {})
        .then(() => invoke<Ledger>("ledger_scan", { worksCommand: config.worksCommand || null }))
        .then(setLedger);
    scan();
    const scanTimer = setInterval(scan, 30_000);
    window.addEventListener("focus", scan);
    const onFocusBack = () => {
      const n = notified.current;
      notified.current = null;
      if (!n || Date.now() - n.at > 10 * 60_000) return;
      // 알린 세션이 열려 있으면 띄우고, 잠들어 있으면 깨워서 띄운다
      if (live.current.open.some((o) => o.key === n.key)) actions.current.show(n.key);
      else if (n.key.startsWith("c:")) actions.current.wake(n.key.slice(2));
    };
    window.addEventListener("focus", onFocusBack);
    // PR 링크는 어디서 눌러도 여기로 와서 Julgi 안의 PR 화면으로 열린다
    const onPr = (e: Event) => setPrShown((e as CustomEvent<PrTarget>).detail);
    window.addEventListener("julgi:pr", onPr);

    const stateTimer = setInterval(() => {
      if (config.remote) actions.current.publishRemote();
      void invoke<Record<string, [string, number]>>("term_states").then((raw) => {
        const next: Record<string, TermState> = {};
        for (const o of live.current.open) {
          const hit = raw[String(terms.idOf(o.key))];
          if (!hit) continue;
          rawStates.current[o.key] = hit;
          // 내가 Esc로 멈추면 Claude Code는 끝났다고 알려 주지 않는다. 일한다면서 화면이 한참 조용하면 멈춘 것으로 본다
          const out = terms.outAt(o.key);
          const stalled = hit[0] === "run" && Date.now() - out > QUIET_MS;
          // 허락 물음에 내가 키를 눌러 답했는데(거절했거나 Esc로 닫았다) 일이 이어지지 않으면, 더는 "확인이 필요함"이 아니다.
          // 허락했다면 도구가 돌면서 곧 "일하는 중"으로 바뀐다. 몇 초 지나도 그대로면 내 말을 기다리는 것이다
          const answered = hit[0] === "ask" && terms.keyAt(o.key) > hit[1] && Date.now() - terms.keyAt(o.key) > 4000;
          const st = stalled ? { state: "stuck", since: Math.max(out, hit[1]) } : answered ? { state: "wait", since: hit[1] } : { state: hit[0], since: hit[1] };
          // 일감을 맡기고 답을 끝낸 조율 세션은 내가 답할 차례가 아니다. 결과가 오면 Julgi가 넣어 준다
          const holding = st.state === "wait" && tasksRef.current.some((t) => t.lead === o.sessionId && (t.status === "대기" || t.status === "하는 중")); // i18n-ok
          // 일감을 맡은 세션이 답을 끝낸 것도 내 차례가 아니다. 결과는 조율 세션으로 간다
          const worker = st.state === "wait" && tasksRef.current.some((t) => t.session === o.sessionId);
          // 답을 끝냈으면 그 답을 읽고 내가 할 일이 있는지 본다. 판정이 나올 때까지(몇 초)는 일하는 중으로 두고,
          // 할 일이 없으면 "보고함"으로 내려 둔다. Julgi가 알아서 띄운 세션과 내가 방금 Esc로 끊은 세션은 판정하지 않는다
          let shown: TermState = st;
          // 맡긴 버그의 진단은 늘 내가 정할 것이다. 판정에 넘기지 않는다. 보류한 것은 그 답 그대로인 동안 조용히 둔다
          const bug = bugs.current.jobs.find((j) => j.sessionId === o.sessionId && (j.state === "diag" || j.state === "decide" || j.state === "held"));
          if (bug) {
            if (bug.state === "held" && st.state === "wait" && bug.heldSince === st.since) shown = { state: "told", since: st.since };
          } else if (config.triage && st.state === "wait" && o.sessionId && !holding && !worker && !isAuto(o.sessionId) && !live.current.handing.includes(o.key)) {
            const known = triaged.current[o.sessionId];
            if (known?.since === st.since) shown = known.need ? st : { state: "told", since: st.since };
            else {
              void actions.current.triage(o.sessionId, st.since);
              // 열두 초 넘게 답이 없으면 기다리지 않고 내 차례로 올린다
              if (Date.now() - (triaging.current.get(o.sessionId) ?? Date.now()) < 12_000) shown = { state: "run", since: live.current.states[o.key]?.state === "run" ? live.current.states[o.key].since : st.since };
            }
          }
          next[o.key] = holding ? { state: "hold", since: st.since } : worker ? { state: "idle", since: st.since } : shown;
        }
        setStates((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
        actions.current.tend();
      });
      void invoke<string[] | null>("inbox_take").then((requests) => requests?.length && actions.current.serve(requests));
    }, 1500);

    terms.handlers.onFocus = (key) => {
      const at = live.current.panes.indexOf(key);
      if (at >= 0) setFocus(at);
    };
    terms.handlers.onExit = (key) => actions.current.exited(key);

    const onKey = (e: KeyboardEvent) => {
      const { open, panes, focus, home, overlay, fontSize } = live.current;
      const a = actions.current;
      const key = panes[focus];
      const cwd = open.find((o) => o.key === key)?.cwd ?? (live.current.base || home);
      const cmd = e.metaKey && !e.altKey && !e.ctrlKey;
      // PR 화면이 떠 있으면 그 화면만 상대한다. ⌘W는 뒤의 세션이 아니라 PR 화면을 닫는다.
      // 포커스가 PR 화면 밖으로 빠졌어도 Esc로 닫히게 여기서도 받는다
      if (live.current.prShown || live.current.ticketShown) {
        const inside = e.target instanceof Element && !!e.target.closest(".pr-wrap");
        if ((cmd && e.code === "KeyW") || (e.key === "Escape" && !inside)) {
          e.preventDefault();
          e.stopPropagation();
          // 위에 떠 있는 것부터 닫는다(티켓 화면이 PR 화면 위에 뜬다)
          if (live.current.ticketShown) setTicketShown(null);
          else setPrShown(null);
        }
        return;
      }
      // 번호와 넘겨 보기는 내가 상대하는 세션만 센다. 일감을 맡은 세션은 조율 세션에 딸린 것이라 뺀다
      const tops = open.filter((o) => !tasksRef.current.some((t) => t.session === o.sessionId && open.some((l) => l.sessionId === t.lead)));
      let handled = true;
      if (cmd && e.code === "KeyK") setOverlay(overlay === "palette" ? null : "palette");
      else if (cmd && e.shiftKey && e.code === "KeyL" && !overlay) void a.move();
      else if (cmd && e.code === "KeyL") {
        setMoving("");
        setOverlay(overlay === "send" ? null : "send");
      }
      else if (cmd && e.code === "Slash") setOverlay(overlay === "help" ? null : "help");
      else if (cmd && e.code === "KeyY") setOverlay(overlay === "history" ? null : "history");
      else if (cmd && e.shiftKey && e.code === "KeyB") setOverlay(overlay === "morning" ? null : "morning");
      else if (cmd && e.code === "Comma") (setSettingsAt(undefined), setOverlay(overlay === "settings" ? null : "settings"));
      else if (cmd && e.code === "KeyG") setOverlay(overlay === "threads" ? null : "threads");
      else if (cmd && e.shiftKey && e.code === "KeyU") setOverlay(overlay === "usage" ? null : "usage");
      else if (cmd && e.code === "KeyU") setOverlay(overlay === "work" ? null : "work");
      else if (overlay) {
        // 작업 페이지는 Esc를 스스로 다룬다(PR 화면 안이면 목록으로, 목록이면 닫기)
        if (overlay === "work" && e.target instanceof Element && e.target.closest(".wk")) return;
        // 사용량도 Esc를 스스로 다룬다(거르기 중이면 거르기부터 푼다)
        if (overlay === "usage" && e.target instanceof Element && e.target.closest(".us")) return;
        if (e.key === "Escape") setOverlay(null);
        else if (overlay === "quit" && e.key === "Enter") void invoke("app_exit");
        else if (overlay === "close" && e.key === "Enter") a.confirmClose(e.altKey);
        else return;
      } else if (e.metaKey && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
        setFocus((focus + (e.key === "ArrowLeft" ? -1 : 1) + panes.length) % panes.length);
      // ⌘⇧[ ⌘⇧]: 열린 세션을 차례로 넘겨 본다(탭을 넘기듯). 왼쪽 "열림" 목록의 위아래로 간다
      else if (cmd && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        if (tops.length) {
          const at = tops.findIndex((o) => o.key === key);
          a.show(tops[(at + (e.code === "BracketLeft" ? -1 : 1) + tops.length) % tops.length].key);
        }
      }
      // ⌘[ ⌘]: 옆 칸으로. 터미널 앱들이 쓰는 키와 같다
      else if (cmd && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        // 코드 검토를 펴 둔 동안에는 칸을 넘기지 않는다. 읽던 코드가 통째로 다른 세션으로 바뀌어 버린다
        if (key && live.current.reviewing.includes(key)) return;
        setFocus((focus + (e.code === "BracketLeft" ? -1 : 1) + panes.length) % panes.length);
      }
      else if (cmd && !e.shiftKey && e.code.startsWith("Digit") && e.code !== "Digit0") {
        const target = tops[Number(e.code.slice(5)) - 1];
        if (target) a.show(target.key);
      } else if (e.ctrlKey && e.key === "Tab") {
        const back = previous.current[focus];
        if (back) a.show(back);
      } else if (cmd && e.code === "KeyJ") {
        // 내 차례인 세션들과 마지막에 물은 말을 편다. 거기서 바로 답한다
        if (overlay === "queue") setOverlay(null);
        else if (live.current.open.some((o) => waiting(live.current.states[o.key]) || live.current.prNews[o.key]) || live.current.asks.length || Object.keys(live.current.mineNews).length || Object.keys(live.current.sleepNews).length || Object.keys(ticketNewsRef.current).length) setOverlay("queue");
        else a.say(tr("내 차례인 세션이 없다"));
      }
      // 창만 닫아 메뉴 막대로 보낸다. 세션은 계속 돈다
      else if (cmd && e.shiftKey && e.code === "KeyW") void getCurrentWindow().hide();
      else if (cmd && e.code === "KeyW") {
        if (key) a.sleep(key);
        else a.unsplit(focus);
      } else if (cmd && e.code === "KeyD") {
        if (e.shiftKey) a.unsplit(focus);
        else a.split();
      } else if (cmd && e.shiftKey && e.code === "KeyS") {
        if (key) a.handoff(key);
      } else if (cmd && e.shiftKey && e.code === "KeyE") {
        const o = open.find((x) => x.key === key);
        if (o?.sessionId) a.finishThread(o.sessionId);
      } else if (cmd && e.shiftKey && e.code === "KeyP") {
        if (key) a.togglePin(key);
      } else if (cmd && !e.shiftKey && e.code === "KeyF") {
        if (key) setFinding(true);
      } else if (cmd && e.key === "Enter") setZoom((z) => !z);
      // ⌘E: 지금 칸을 코드 검토로 바꾼다(다시 누르면 터미널). 코드는 폭이 필요해서 칸을 키운다
      else if (cmd && !e.shiftKey && e.code === "KeyE") {
        if (key) a.toggleReview(key);
      }
      else if (cmd && !e.shiftKey && e.code === "KeyN") a.newSession(cwd);
      else if (cmd && !e.shiftKey && e.code === "KeyT") a.newShell(cwd);
      else if (cmd && !e.shiftKey && e.code === "KeyI") setInfo((v) => !v);
      else if (cmd && !e.shiftKey && e.code === "KeyB") setSidebar((v) => !v);
      else if (cmd && !e.shiftKey && e.code === "KeyS") {
        if (!config.saveCommand) say(tr("~/.julgi/config.json의 saveCommand에 보낼 말을 적어 두면 ⌘S로 보낸다."));
        else if (key?.startsWith("c:")) terms.send(key, config.saveCommand + "\r");
      } else if (cmd && e.code === "Equal") a.resize(fontSize + 1);
      else if (cmd && e.code === "Minus") a.resize(fontSize - 1);
      else if (cmd && e.code === "Digit0") a.resize(13);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);

    // 파일을 끌어다 놓으면 놓인 칸에 경로를 입력한다 (공백 등은 \로 감싼다)
    let offDrop = () => {};
    let gone = false;
    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        const x = e.payload.position.x / window.devicePixelRatio;
        const at = paneEls.current.findIndex((el) => {
          const rect = el?.getBoundingClientRect();
          return rect && rect.width > 0 && x >= rect.left && x < rect.right;
        });
        const key = live.current.panes[at];
        if (!key) return;
        setFocus(at);
        terms.paste(key, e.payload.paths.map((path) => path.replace(/[^\p{L}\p{N}_@%+=:,./-]/gu, "\\$&")).join(" ") + " ");
      })
      .then((off) => (gone ? off() : (offDrop = off)));

    void invoke<string>("home_dir").then(setHome);
    void invoke<string | null>("config_load").then((json) => {
      try {
        if (json) Object.assign(config, JSON.parse(json));
        applyTheme(config.theme);
        applyRemote();
        readUsage();
        setConfigTick((n) => n + 1);
        scan(); // 설정에 따라 달라지는 것(레포 이름 규칙, 작업 목록 명령)을 반영한다
      } catch {
        // 설정 파일이 깨졌으면 기본값으로 돈다
      }
      void invoke<string>("default_dir", { path: config.defaultDir || null }).then((dir) => setBase(dir ?? ""));
    });
    void invoke<string | null>("data_read", { name: "activity.jsonl" }).then((text) => {
      const rows = (text ?? "").split("\n").filter(Boolean).slice(-MAX_ACTS);
      setActs(rows.flatMap((line) => {
        try {
          return [JSON.parse(line) as Act];
        } catch {
          return [];
        }
      }));
    });
    void invoke<string | null>("data_read", { name: "merge-judged.json" }).then((json) => {
      try {
        setJudged(json ? JSON.parse(json) : {});
      } catch {
        setJudged({});
      }
    });
    void invoke<string | null>("data_read", { name: "threads.json" }).then((json) => {
      try {
        if (json) setThreads(JSON.parse(json));
      } catch {
        // 줄기 목록이 깨졌으면 줄기 없이 돈다
      }
    });
    void invoke<Record<string, string> | null>("memory_load").then((all) => setMemories((old) => ({ ...all, ...old })));
    void Promise.all([invoke<Record<string, string> | null>("brain_load"), invoke<string | null>("data_read", { name: "brain-learned.json" })]).then(([files, json]) => {
      const all = Object.entries(files ?? {})
        .map(([id, text]) => parseNote(id, text))
        .filter((n): n is Note => !!n)
        .sort((a, b) => b.created.localeCompare(a.created));
      setNotes(all);
      try {
        if (json) learned.current = JSON.parse(json);
      } catch {
        // 깨졌으면 다시 추린다
      }
      void Promise.all(["brain-stats.json", "brain-daily.json", "skill-candidates.json", "reviews.json", "hidden.json", "map.json", "tasks.json", "misroutes.jsonl", "changes.json"].map((name) => invoke<string | null>("data_read", { name }))).then(([st, dy, cd, rv, hd, mp, tk, ms, ch]) => {
        try {
          if (st) setStats((statsRef.current = JSON.parse(st)));
          if (dy) daily.current = JSON.parse(dy);
          if (cd) setSkillCands(JSON.parse(cd));
          if (rv) setReviews((live.current.reviews = JSON.parse(rv)));
          if (hd) setHidden((hiddenRef.current = JSON.parse(hd)));
          if (tk) setTasks((tasksRef.current = JSON.parse(tk)));
          if (ch) setChanges((changesRef.current = JSON.parse(ch)));
          if (ms) setMisses(ms.split("\n").filter(Boolean).map((line) => JSON.parse(line)).slice(-20));
          void invoke<string | null>("data_read", { name: "MAP.md" }).then((text) => setMapText(text ?? ""));
          if (mp) {
            mapState.current = JSON.parse(mp);
            setMapDirs(mapState.current.repos.map((r) => r.cwd));
          }
        } catch {
          // 숫자 파일이 깨졌으면 0부터 다시 센다
        }
        brainReady.current = true;
        void invoke("data_write", { name: "brain/INDEX.txt", text: indexText(all, statsRef.current) });
      });
    });
    const countSkills = () => {
      void invoke<SkillUse[] | null>("skill_usage", { days: 45 }).then((u) => setSkillUses(u ?? []), () => {});
      void invoke<SkillInfo[] | null>("skills_list").then((k) => setSkills(k ?? []), () => {});
    };
    countSkills();
    const skillTimer = setInterval(countSkills, 10 * 60_000);
    // 마지막으로 Julgi를 본 때를 적어 둔다. 오래 비웠다 돌아오면(켰을 때도) 브리핑을 띄운다
    let seenAt = 0; // 0이면 아직 파일을 못 읽었다
    const markSeen = () => {
      if (!seenAt || document.hidden || !document.hasFocus()) return;
      seenAt = Date.now();
      void invoke("data_write", { name: "seen.json", text: JSON.stringify({ at: seenAt }) });
    };
    const backFromAway = () => {
      const gone = seenAt && Date.now() - seenAt;
      if (config.morning && gone && gone >= config.morningHours * 3600_000) {
        setAwaySince(seenAt);
        // 다른 창이 떠 있으면 덮지 않는다
        setOverlay((cur) => cur ?? "morning");
      }
      seenAt = seenAt || Date.now();
      markSeen();
    };
    void invoke<string | null>("data_read", { name: "seen.json" }).then((json) => {
      try {
        seenAt = (json && JSON.parse(json).at) || 0;
      } catch {
        seenAt = 0;
      }
      // 세션 목록이 뜬 뒤에 보이게 조금 기다린다. 처음 켜는 것이면(기록 없음) 띄우지 않는다
      setTimeout(backFromAway, 2500);
    });
    const seenTimer = setInterval(markSeen, 60_000);
    window.addEventListener("focus", backFromAway);
    void invoke<string | null>("data_read", { name: "triage.json" }).then((json) => {
      try {
        if (json) triaged.current = { ...JSON.parse(json), ...triaged.current };
      } catch {
        // 깨졌으면 다시 판정한다
      }
    });
    void invoke<string | null>("data_read", { name: "progress.json" }).then((json) => {
      try {
        if (json) setProgress(JSON.parse(json));
      } catch {
        // 깨졌으면 다음 요약 때 다시 만든다
      }
    });
    void invoke<string | null>("data_read", { name: "names.json" }).then((json) => {
      try {
        if (json) setNames(JSON.parse(json));
      } catch {
        // 이름 파일이 깨졌으면 다시 짓는다
      }
    });
    void invoke<string | null>("data_read", { name: "notes.json" }).then((json) => {
      try {
        if (json) noted.current = JSON.parse(json);
      } catch {
        // 깨졌으면 요약을 다시 만든다
      }
    });
    // 종료(⌘Q)와 창 닫기는 일하는 세션이 있으면 먼저 묻는다
    const offQuit = listen("quit-requested", () => actions.current.requestQuit());
    // 창 닫기는 끄는 게 아니라 숨기는 것이다. 세션은 뒤에서 계속 돌고 메뉴 막대 아이콘으로 다시 연다.
    const offClose = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void getCurrentWindow().hide();
    });
    if (import.meta.env.DEV) void selftest(actions, live);

    return () => {
      gone = true;
      offDrop();
      void offQuit.then((off) => off());
      void offClose.then((off) => off());
      clearInterval(scanTimer);
      clearInterval(skillTimer);
      clearInterval(stateTimer);
      window.removeEventListener("focus", backFromAway);
      clearInterval(seenTimer);
      window.removeEventListener("focus", scan);
      window.removeEventListener("focus", onFocusBack);
      window.removeEventListener("julgi:pr", onPr);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // 합치기 후보를 하나씩 모델에게 읽혀 판정받고, 같은 짝을 두 번 묻지 않게 적어 둔다.
  // 같은 일이라고 나오면 묻지 않고 합친다. 틀렸으면 ⌘I에서 빼면 된다.
  useEffect(() => {
    const turn = judging.current;
    if (!judged || !config.judgeMerges || turn.busy || turn.asked >= MAX_JUDGE) return;
    const next = candidates.find((m) => !(mergeKey(m.a, m.b) in judged));
    if (!next) return;
    turn.busy = true;
    turn.asked++;
    const tell = (item: Merge["a"]) => {
      const s = item.session;
      const about = (aboutOf(item) || "요약 없음").slice(0, 900); // i18n-ok
      return `제목: ${item.name}\n레포: ${s.repo} · 브랜치: ${s.branch || "없음"}\n내용: ${about}`; // i18n-ok
    };
    void invoke<string | null>("route_ask", { model: modelFor("judge"), system: JUDGE_SYSTEM, prompt: `겹치는 단서: ${next.evidence}\n\n[세션 A]\n${tell(next.a)}\n\n[세션 B]\n${tell(next.b)}\n` }) // i18n-ok
      .then((raw) => JSON.parse((raw ?? "").slice((raw ?? "").indexOf("{"), (raw ?? "").lastIndexOf("}") + 1)) as { same: boolean; why?: string })
      .catch(() => null)
      .then((answer) => {
        turn.busy = false;
        // 묻지 못한 것은 적지 않는다. 다음에 켰을 때 다시 묻는다
        if (!answer) return void (turn.asked = MAX_JUDGE);
        const all = { ...judged, [mergeKey(next.a, next.b)]: { same: answer.same === true, why: answer.why ?? "" } };
        setJudged(all);
        void invoke("data_write", { name: "merge-judged.json", text: JSON.stringify(all, null, 1) });
        // 같은 일이면 묻지 않고 합친다. 판정이 난 그때 한 번만 하므로, 내가 다시 떼어 낸 짝을 또 합치지는 않는다
        if (answer.same === true) {
          joinThreads(next.a.session.id, next.b.session.id, true);
          record("합침", `"${next.a.name.slice(0, 30)}" + "${next.b.name.slice(0, 30)}" · ${answer.why ?? ""}`, next.a.session.id); // i18n-ok
          say(tr`같은 일이라 한 줄기로 합쳤다: ${next.a.name.slice(0, 30)} · ${(answer.why ?? "").slice(0, 80)}`, 9000);
        }
      });
  }, [candidates, judged]);

  // 세션 안의 julgi 명령이 읽는 줄기 목록. 탭으로 나눈 한 줄이 줄기 하나다
  useEffect(() => {
    if (!ledger) return;
    const openIds = new Set(open.map((o) => o.sessionId));
    const clean = (text: string) => text.replace(/\s+/g, " ").trim();
    const rows = items.slice(0, 300).map((item) => {
      const ids = item.thread?.sessions ?? [item.session.id];
      const state = item.thread?.done ? "끝남" : ids.some((id) => openIds.has(id)) ? "열림" : "잠듦"; // i18n-ok
      return [item.thread?.id ?? "-", item.session.id, ids.join(","), item.session.repo, state, clean(item.name), aboutOf(item).slice(0, 240)].join("\t");
    });
    const timer = setTimeout(() => void invoke("data_write", { name: "index.tsv", text: rows.join("\n") + "\n" }), 2000);
    return () => clearTimeout(timer);
  }, [ledger, items, open]);

  // 새 줄기를 열 폴더 후보에서 이제 없는 폴더(지워진 워크트리 등)를 뺀다
  useEffect(() => {
    const unknown = [...new Set(sessions.map((s) => s.cwd))].filter((cwd) => !(cwd in exists));
    if (!unknown.length) return;
    void invoke<boolean[] | null>("dirs_exist", { paths: unknown }).then((found) =>
      setExists((old) => ({ ...old, ...Object.fromEntries(unknown.map((cwd, i) => [cwd, found?.[i] ?? true])) })),
    );
  }, [sessions]);

  // 지난번에 열어 둔 세션과 칸 배치를 되살린다. 터미널은 칸에 보일 때 비로소 뜬다.
  useEffect(() => {
    if (!ledger || restored) return;
    void invoke<string | null>("data_read", { name: "auto-sessions.json" })
      .then((text) => {
        // 다시 띄우기 전에 알아야 한다: 어느 세션이 알아서 띄운 것이었는지에 따라 권한이 달라진다
        try {
          for (const id of JSON.parse(text ?? "[]") as string[]) markAuto(id);
        } catch {
          // 없거나 깨졌으면 전부 내가 연 것으로 본다
        }
      }, () => {})
      .then(() => invoke<string | null>("layout_load"))
      .then((json) => {
      setRestored(true);
      if (!json) return;
      let saved: Layout;
      try {
        saved = JSON.parse(json);
      } catch {
        return;
      }
      const known = new Set(ledger.sessions.map((s) => s.id));
      // 대화가 한 번도 없었던 세션은 이어 열 수 없으니 뺀다
      const list = (saved.open ?? []).filter((o) => !o.sessionId || known.has(o.sessionId));
      for (const o of list) terms.create({ key: o.key, cwd: o.cwd, command: o.sessionId ? resumeCommand(o.sessionId) : undefined });
      const keys = new Set(list.map((o) => o.key));
      setOpen(list);
      const shown = (saved.panes?.length ? saved.panes : [null]).slice(0, MAX_PANES).map((k) => (keys.has(k ?? "") ? k : null));
      previous.current = shown.map(() => null);
      setPanes(shown);
      setWidths(shown.map((_, i) => saved.widths?.[i] || 1));
      setFocus(Math.min(saved.focus ?? 0, shown.length - 1));
      setPinned((saved.pinned ?? []).filter((k) => keys.has(k)));
      setSidebar(saved.sidebar ?? true);
      if (saved.fontSize) resize(saved.fontSize);
    });
  }, [ledger, restored]);

  useEffect(() => {
    if (!restored) return;
    const layout: Layout = { open, panes, widths, pinned, focus, fontSize, sidebar };
    const timer = setTimeout(() => void invoke("layout_save", { json: JSON.stringify(layout) }), 400);
    return () => clearTimeout(timer);
  }, [restored, open, panes, widths, pinned, focus, fontSize, sidebar]);

  // 기다리는 세션 수를 독 아이콘에 띄운다
  useEffect(() => {
    void getCurrentWindow()
      .setBadgeCount(waitCount || undefined)
      .catch(() => {});
  }, [waitCount]);

  return (
    <div className={"app" + (sidebar ? "" : " no-side")} style={sidebar ? { gridTemplateColumns: `${sideW}px minmax(0, 1fr)` } : undefined}>
      {sidebar && <div className="side-grip" style={{ left: sideW - 3 }} title={tr`끌어서 목록 너비 바꾸기 · 두 번 누르면 처음 너비로`} onMouseDown={dragSide} onDoubleClick={() => saveSideW(270)} />}
      {/* 창 맨 윗줄: 신호등 단추 옆에 앱 이름과 왼쪽 목록 단추를, 오른쪽 끝에 오른쪽 칸(정보, 코드 검토의 이력)을 펴고 접는 단추 */}
      <div className="topbar" data-tauri-drag-region>
        <span className="topbar-name" data-tauri-drag-region>
          Julgi
        </span>
        <button type="button" className={"panel-btn" + (sidebar ? " on" : "")} title={tr`왼쪽 목록 펴고 접기 (⌘B)`} aria-label={tr`왼쪽 목록 펴고 접기`} onClick={() => setSidebar((v) => !v)}>
          <svg width="15" height="13" viewBox="0 0 15 13" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="0.65" y="0.65" width="13.7" height="11.7" rx="2.2" /><line x1="5.2" y1="0.8" x2="5.2" y2="12.2" /></svg>
        </button>
        <span className="topbar-fill" data-tauri-drag-region />
        <button
          type="button"
          className="panel-btn"
          title={tr`오른쪽 칸 펴고 접기: 코드 검토에서는 이력(h), 터미널에서는 세션 정보(⌘I)`}
          aria-label={tr`오른쪽 칸 펴고 접기`}
          onClick={() => (current && reviewing.includes(current) ? window.dispatchEvent(new Event("julgi:hist")) : setInfo((v) => !v))}
        >
          <svg width="15" height="13" viewBox="0 0 15 13" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="0.65" y="0.65" width="13.7" height="11.7" rx="2.2" /><line x1="9.8" y1="0.8" x2="9.8" y2="12.2" /></svg>
        </button>
      </div>
      {sidebar && (
        <Sidebar
          open={open}
          items={items}
          threads={threads}
          byId={byId}
          states={states}
          tasks={tasks}
          changes={changes}
          pinned={pinned}
          dead={dead}
          current={current}
          shown={panes}
          loading={!ledger}
          onShow={show}
          onClose={sleep}
          onOpenSession={(s) => (sleepNews[s.id] ? wake(s.id) : openSession(s))}
          onSearch={() => setOverlay("palette")}
          prOf={(key) => {
            const target = prOfSession(open.find((o) => o.key === key)?.sessionId);
            const status = target ? prs[`${target.repo}#${target.number}`] : undefined;
            return target && status ? { target, status, news: prNews[key] } : undefined;
          }}
          prNews={prNews}
          sleepNews={sleepNews}
          ticketOf={(key) => {
            const tk = ticketOfSession(open.find((o) => o.key === key)?.sessionId);
            if (!tk) return undefined;
            if (ticketDone[tk]) return { key: tk, status: "", news: tr`티켓 끝남 · ${ticketDone[tk]}` };
            return { key: tk, status: tickets.find((t) => t.key === tk)?.status ?? "", news: ticketNewsMap[tk], quiet: ticketQuiet.has(tk) };
          }}
          work={{ prs: minePrs.length, asks: asks.length, news: Object.keys(mineNews).length + Object.keys(prNews).length + Object.keys(sleepNews).length }}
          onWork={() => setOverlay("work")}
        />
      )}
      <div
        className={"panes" + (zoom ? " zoom" : "")}
        ref={panesEl}
        style={zoom ? undefined : { gridTemplateColumns: widths.map((w) => `minmax(0, ${w}fr)`).join(" ") }}
      >
        {panes.map((key, i) => {
          const o = open.find((x) => x.key === key);
          return (
            <div key={i} className={"pane-slot" + (zoom && focus !== i ? " hide" : "")} ref={(el) => void (paneEls.current[i] = el)}>
              {i > 0 && !zoom && <div className="grip" onMouseDown={(e) => drag(i, e)} onDoubleClick={() => setWidths(widths.map(() => 1))} />}
              <Pane
                termKey={key}
                focused={focus === i}
                active={!overlay && !(finding && focus === i)}
                label={o?.label ?? ""}
                cwd={o?.cwd ?? home}
                session={o?.sessionId ? byId.get(o.sessionId) : undefined}
                thread={threadOf(o?.sessionId)}
                memory={[memories[threadOf(o?.sessionId)?.id ?? ""], memories[o?.sessionId ?? ""]].filter(Boolean).join("\n\n")}
                members={(threadOf(o?.sessionId)?.sessions ?? []).map((id) => ({ id, title: byId.get(id)?.title ?? tr("아직 기록이 없는 세션"), here: id === o?.sessionId }))}
                thread_ops={{
                  name: (name) => o?.sessionId && nameThread(o.sessionId, name),
                  leave: leaveThread,
                  drop: () => {
                    const t = threadOf(o?.sessionId);
                    if (t) dropThread(t.id);
                  },
                  finish: () => o?.sessionId && finishThread(o.sessionId),
                  changes: () => key && toggleReview(key),
                }}
                state={key && dead.includes(key) ? "dead" : key ? (states[key]?.state ?? "") : ""}
                info={info && focus === i}
                finding={finding && focus === i}
                handing={!!key && handing.includes(key)}
                handed={!!key && !!handed[key]}
                ticketEnded={(() => {
                  const tk = ticketOfSession(o?.sessionId);
                  return tk && ticketDone[tk] && !threadOf(o?.sessionId)?.done ? tr`티켓 끝남 · ${ticketDone[tk]}` : undefined;
                })()}
                pinned={!!key && pinned.includes(key)}
                change={o && changes[o.cwd]?.by === o.sessionId ? changes[o.cwd] : undefined}
                review={
                  key && o && reviewing.includes(key)
                    ? {
                        // 지금 세션의 폴더와, 이 세션(줄기)이 맡긴 일감들의 워크트리
                        places: [
                          { label: tr`${repoOf(o.cwd)} · 이 세션`, cwd: o.cwd },
                          ...tasks.filter((t) => t.work && (threadOf(o.sessionId)?.sessions ?? [o.sessionId]).includes(t.lead)).map((t) => ({ label: tr`${t.repo} · 일감 ${t.id}`, cwd: t.work! })),
                        ],
                        known: changes,
                        sessions: threadOf(o.sessionId)?.sessions ?? (o.sessionId ? [o.sessionId] : []),
                        onSay: (text: string) => {
                          terms.submitWhenClear(key, text);
                          say(tr("세션에 보냈다. 터미널은 ⌘E로 본다"));
                        },
                        onClose: () => toggleReview(key),
                      }
                    : undefined
                }
                onPin={() => key && togglePin(key)}
                onFindClose={() => setFinding(false)}
                onFocus={() => setFocus(i)}
              />
            </div>
          );
        })}
      </div>
      {overlay === "palette" && (
        <Palette open={open} sessions={sessions} byId={byId} cwd={cwdOf(current)} onPick={pick} onAttach={attach} onJoin={join} onClose={() => setOverlay(null)} asks={asks} mine={minePrs} jira={config.jiraSite ? jiraConn() : null} tickets={tickets} />
      )}
      {overlay === "send" && (
        <Send
          // 옮기는 말은 나온 세션의 줄기로 되돌려 보낼 일이 없다
          items={moving ? items.filter((item) => !(item.thread?.sessions ?? [item.session.id]).some((id) => "c:" + id === current)) : items}
          openIds={new Set(open.map((o) => o.sessionId ?? ""))}
          cwd={cwdOf(current)}
          folders={[...folders, ...mapState.current.repos.filter((r) => !folders.some((f) => f.repo === r.repo)).map((r) => ({ repo: r.repo, cwd: r.cwd, text: "" }))]}
          base={base}
          notes={config.brain ? notes : []}
          misses={misses.slice(-6).map((m) => `- "${m.said}" → "${m.wrong}"으로 보냈으나 "${m.right}"이 맞았다`).join("\n")} // i18n-ok
          stats={stats}
          areas={mapDomains(mapText).map((d) => `- ${d.name}: ${[...new Set(d.pieces.map((p) => (p.path ? `${p.repo}/${p.path}` : p.repo)))].slice(0, 6).join(", ")}`).join("\n").slice(0, 2200)}
          initial={moving}
          // 상자가 닫힌 뒤에 불릴 수 있어서 그때의 dispatch를 쓴다
          onSend={(...args) => {
            // 엉뚱한 데 간 말을 옮긴 횟수는 보내기가 틀린 정도를 보여 준다
            if (moving) {
              record("옮김", tr`다른 줄기로 옮김: "${args[1].split("\n").pop()?.slice(0, 50) ?? ""}"`); // i18n-ok
              // 무엇이 어디로 잘못 갔고 어디가 맞았는지 적어 둔다. 다음에 보낼 곳을 정할 때 모델에게 보여 준다
              const right = args[0].kind === "item" ? args[0].item.name : `새 줄기(${repoOf(args[0].cwd)})`; // i18n-ok
              // rightId, rightRepo: 평가가 정답으로 쓴다
              const miss = { at: Date.now(), said: movedFrom.current.said.slice(0, 160), wrong: movedFrom.current.name.slice(0, 50), right: right.slice(0, 50), rightId: args[0].kind === "item" ? args[0].item.session.id : "new", rightRepo: args[0].kind === "item" ? args[0].item.session.repo : repoOf(args[0].cwd) };
              if (miss.said) {
                setMisses((list) => [...list, miss].slice(-20));
                void invoke("data_append", { name: "misroutes.jsonl", line: JSON.stringify(miss) });
              }
            }
            void actions.current.dispatch(...args);
          }}
          onLater={(text) => {
            setOverlay(null);
            say(tr`"${text.split("\n")[0].slice(0, 30)}" 보낼 곳을 정하는 중. 정해지면 알아서 보낸다`, 6000);
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "queue" && (
        <Queue
          rows={open
            .filter((o) => waiting(states[o.key]) || (prNews[o.key] && states[o.key]?.state !== "run"))
            .sort((a, b) => (states[a.key]?.since ?? Infinity) - (states[b.key]?.since ?? Infinity))
            .map((o) => ({ key: o.key, name: nameOf(o.key), repo: repoOf(o.cwd), state: states[o.key]?.state ?? "", since: states[o.key]?.since ?? 0, sessionId: o.sessionId, news: prNews[o.key], pr: prOfSession(o.sessionId) ?? undefined, bug: bugJobs.find((j) => j.sessionId === o.sessionId && j.state === "decide")?.key }))
            // 잠든 세션도 PR에 일이 생겼으면 내 차례다. 고르면 깨운다
            .concat(
              Object.entries(sleepNews).map(([id, { news, pr }]) => {
                const s = byId.get(id);
                return { key: "c:" + id, name: names[id] || s?.title || tr("세션"), repo: s?.repo ?? "", state: "sleep", since: 0, sessionId: id, news, pr, bug: undefined };
              }),
            )}
          asks={asks}
          onFixBug={fixBug}
          onHoldBug={holdBug}
          mine={Object.values(mineNews)}
          tickets={Object.entries(ticketNewsMap).filter(([key]) => !ticketQuiet.has(key)).map(([key, news]) => {
            const t = tickets.find((x) => x.key === key);
            return { key, news, title: t?.title ?? key, url: t?.url ?? `${config.jiraSite}/browse/${key}` };
          })}
          onTicket={(key) => (setTicketShown(key), setTicketNews(({ [key]: _, ...rest }) => rest))}
          onStartTicket={(key) => {
            void invoke<TicketFull>("jira_view", { conn: jiraConn(), key }).then(beginTicket, (e) => say(String(e).slice(0, 100)));
          }}
          onView={(a) => {
            // 내 PR을 열어 봤으면 그 일은 본 것이다
            const id = `${a.repository.nameWithOwner}#${a.number}`;
            setMineNews(({ [id]: _, ...rest }) => rest);
            openPr({ repo: a.repository.nameWithOwner, number: a.number });
          }}
          onHand={(a, extra) => {
            handReview(a, extra);
            record("리뷰 맡김", extra ? tr`${a.repository.nameWithOwner} #${a.number}을 새 세션에 맡김: ${extra.slice(0, 60)}` : tr`${a.repository.nameWithOwner} #${a.number}을 새 세션에 맡김`); // i18n-ok
          }}
          onAnswer={(key, text) => {
            // 잠든 세션에 답하면 그 글을 들고 깨운다
            if (!open.some((o) => o.key === key)) {
              const s = byId.get(key.slice(2));
              const item = items.find((i) => i.session.id === key.slice(2)) ?? (s && { session: s, name: s.title, memory: "" });
              setSleepNews(({ [key.slice(2)]: _, ...rest }) => rest);
              if (item) void dispatch({ kind: "item", item }, text, { rank: 0, by: "내 차례" }); // i18n-ok
              return;
            }
            terms.submitWhenClear(key, text);
            // 맡긴 버그에 내가 직접 답했으면 정한 것이다
            const job = bugOf(open.find((o) => o.key === key)?.sessionId);
            if (job?.state === "decide") setBug(job.key, { state: "done" });
            record("답함", tr`"${nameOf(key)}"에 내 차례 목록에서 답함: ${text.slice(0, 80)}`, open.find((o) => o.key === key)?.sessionId); // i18n-ok
          }}
          onOpen={(key) => (open.some((o) => o.key === key) ? show(key) : wake(key.slice(2)))}
          onPr={(pr) => openPr(pr)}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "help" && <Help onClose={() => setOverlay(null)} />}
      {overlay === "threads" && (
        <Threads
          repos={mapState.current.repos}
          nameOf={nameOf}
          onShow={(key) => {
            setOverlay(null);
            show(key);
          }}
          map={mapText}
          drawing={drawing}
          onRedraw={() => {
            if (drawing || learning.current) return say(tr("다른 정리가 도는 중이다. 잠시 뒤 다시 누른다."));
            setDrawing(true);
            void refreshMap(true).finally(() => setDrawing(false));
          }}
          stats={stats}
          skills={skills}
          skillUses={skillUses}
          candidates={skillCands}
          acts={acts}
          tasks={tasks}
          reviews={reviews}
          sessions={sessions}
          named={sessions.filter((s) => names[s.id] && Date.now() / 1000 - s.mtime < 14 * 86400 && !s.auto).length}
          notes={notes}
          onForget={forget}
          threads={threads}
          byId={byId}
          memories={memories}
          progress={progress}
          open={open}
          states={states}
          onClose={() => setOverlay(null)}
          onPick={(sessionId) => {
            setOverlay(null);
            const o = open.find((x) => x.sessionId === sessionId);
            const s = byId.get(sessionId);
            if (o) show(o.key);
            else if (s) openSession(s);
            else say(tr("그 세션은 아직 대화 기록이 없다."));
          }}
        />
      )}
      {overlay === "settings" && (
        <Settings
          startAt={settingsAt}
          remoteUrl={remoteUrl}
          onConnectLab={() => {
            // glab이 호스트와 로그인 방식(웹 또는 토큰)을 묻는다. 끝나면 셸 칸을 닫으면 된다
            setOverlay(null);
            newShell(cwdOf(current), `glab auth login; echo; echo '${tr("끝났다. ⌘W로 이 칸을 닫는다.")}'; read -r _`, tr("GitLab 연결"));
          }}
          onConnect={() => {
            // gh가 브라우저를 열고 일회용 코드를 보여 준다. 끝나면 셸 칸을 닫으면 된다
            setOverlay(null);
            newShell(cwdOf(current), `gh auth login --web --hostname github.com; echo; echo '${tr("끝났다. ⌘W로 이 칸을 닫는다.")}'; read -r _`, tr("GitHub 연결"));
          }}
          onClose={() => setOverlay(null)}
          onChange={setConfig}
        />
      )}
      {overlay === "usage" && (
        <Usage
          sessionInfo={(id, cwd) => {
            const s = byId.get(id);
            return { repo: s?.repo || cwd.split("/").pop() || "?", name: names[id] || s?.title || tr("기록에서 빠진 세션") };
          }}
          onOpenSession={(id) => {
            const s = byId.get(id);
            if (!s) return say(tr("이 세션은 목록에 없다. 너무 오래됐거나 다른 도구가 만든 세션이다."));
            setOverlay(null);
            if (open.some((o) => o.sessionId === id)) show("c:" + id);
            else openSession(s);
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "work" && (
        <Work
          groups={workGroups()}
          ticketGroups={config.jiraSite ? TICKET_GROUPS : []}
          onConnectJira={() => (setSettingsAt("연결"), setOverlay("settings"))} // i18n-ok
          loadTickets={(jql) => invoke<Ticket[]>("jira_search", { conn: jiraConn(), jql, limit: 50 })}
          ticketNews={ticketNewsMap}
          ticketQuiet={ticketQuiet}
          bugJobs={bugJobs}
          bugStopped={bugStopped}
          bugRepos={mapState.current.repos.length ? mapState.current.repos : folders}
          bugRepoOf={(key) => config.jiraRepos.split(",").map((p) => p.trim().split("=")).find(([k]) => k === key.split("-")[0])?.[1]}
          onHandBugs={handBugs}
          onStopBugs={() => saveBugs(bugs.current.jobs, !bugs.current.stopped)}
          onClearBugs={() => saveBugs(bugs.current.jobs.filter((j) => j.state === "diag" || j.state === "decide"), false)}
          ticketWork={ticketWork}
          onShowSession={(key) => (setOverlay(null), show(key))}
          onStartTicket={(key) => void invoke<TicketFull>("jira_view", { conn: jiraConn(), key }).then(beginTicket, (e) => say(String(e).slice(0, 100)))}
          ticketPane={(key) => (
            <TicketView
              key={key}
              ticketKey={key}
              conn={jiraConn()}
              inline
              autoFocus={false}
              onClose={() => document.querySelector<HTMLElement>(".wk")?.focus()}
              onStart={beginTicket}
              sessions={Object.entries(ticketLinks)
                .filter(([, k]) => k === key)
                .map(([id]) => ({ id, name: names[id] || byId.get(id)?.title || tr("세션") }))}
              onOpenSession={(id) => {
                setOverlay(null);
                if (open.some((o) => o.sessionId === id)) show("c:" + id);
                else wake(id);
              }}
            />
          )}
          onClose={() => setOverlay(null)}
          onRefresh={() => {
            refreshPrs.current();
            say(tr("PR과 리뷰 요청을 다시 읽는 중"));
          }}
          onOpenSession={(id) => {
            setOverlay(null);
            if (open.some((o) => o.sessionId === id)) show("c:" + id);
            else wake(id);
          }}
          onHand={(a) => {
            setOverlay(null);
            handReview(a, "");
            record("리뷰 맡김", tr`${a.repository.nameWithOwner} #${a.number}을 작업 페이지에서 새 세션에 맡김`); // i18n-ok
          }}
        />
      )}
      {prShown && <PrView key={`${prShown.repo}#${prShown.number}`} target={prShown} onClose={() => setPrShown(null)} />}
      {ticketShown && (
        <TicketView
          key={ticketShown}
          ticketKey={ticketShown}
          conn={jiraConn()}
          onClose={() => setTicketShown(null)}
          onStart={beginTicket}
          sessions={Object.entries(ticketLinks)
            .filter(([, k]) => k === ticketShown)
            .map(([id]) => ({ id, name: names[id] || byId.get(id)?.title || tr("세션") }))}
          onOpenSession={(id) => {
            setTicketShown(null);
            if (open.some((o) => o.sessionId === id)) show("c:" + id);
            else wake(id);
          }}
        />
      )}
      {startTicket && (
        <StartTicket
          ticket={startTicket}
          repos={mapState.current.repos}
          remembered={config.jiraRepos.split(",").map((p) => p.trim().split("=")).find(([k]) => k === startTicket.key.split("-")[0])?.[1]}
          startTransition={config.jiraStartTransition}
          onStart={(o) => void startFromTicket(startTicket, o)}
          onClose={() => setStartTicket(null)}
        />
      )}
      {offer && (
        <div className="offer">
          <span>{offer.text}</span>
          <button type="button" className="primary" onClick={() => (offer.run(), setOffer(null))}>
            {offer.yes}
          </button>
          <button type="button" onClick={() => setOffer(null)}>
            {tr`아니`}
          </button>
        </div>
      )}
      {overlay === "morning" && (
        <Morning
          since={awaySince}
          waits={open
            .filter((o) => waiting(states[o.key]))
            .sort((a, b) => (states[a.key]?.since ?? Infinity) - (states[b.key]?.since ?? Infinity))
            .map((o) => {
              const stem = threads.find((t) => o.sessionId && t.sessions.includes(o.sessionId));
              // 왜 내 차례인지: 마지막 답을 읽고 판정한 이유가 있으면 그것을, 없으면 줄기의 막힌 것을
              const why = states[o.key]?.state === "stuck" ? tr("일하다가 멈춰 있다") : (o.sessionId && triaged.current[o.sessionId]?.since === states[o.key]?.since && triaged.current[o.sessionId]?.why) || progress[stem?.id ?? o.sessionId ?? ""]?.blocked;
              return { key: o.key, name: nameOf(o.key), repo: repoOf(o.cwd), ask: states[o.key]?.state === "ask", since: states[o.key]?.since ?? 0, blocked: why || undefined };
            })}
          news={[
            ...Object.entries(sleepNews).map(([id, { news, pr }]) => ({ key: "s" + id, kind: "PR", title: names[id] || byId.get(id)?.title || tr("세션"), news, open: () => (setOverlay(null), openPr(pr)) })),
            ...Object.values(mineNews).map((a) => ({ key: "m" + a.url, kind: "PR", title: `#${a.number} ${a.title}`, news: a.news, open: () => (setOverlay(null), openPr({ repo: a.repository.nameWithOwner, number: a.number })) })),
            ...Object.entries(ticketNewsMap).filter(([key]) => !ticketQuiet.has(key)).map(([key, news]) => ({ key: "t" + key, kind: tr("티켓"), title: `${key} ${tickets.find((x) => x.key === key)?.title ?? ""}`, news, open: () => (setOverlay(null), setTicketShown(key)) })),
            ...asks.map((a) => ({ key: "a" + a.url, kind: tr("리뷰 요청"), title: `#${a.number} ${a.title}`, news: a.author.login, open: () => (setOverlay(null), openPr({ repo: a.repository.nameWithOwner, number: a.number })) })),
          ]}
          told={open
            .filter((o) => states[o.key]?.state === "told")
            .sort((a, b) => states[b.key].since - states[a.key].since)
            .map((o) => ({ key: o.key, name: nameOf(o.key), repo: repoOf(o.cwd), why: (o.sessionId && triaged.current[o.sessionId]?.why) || "", since: states[o.key].since }))}
          stems={threads
            .filter((t) => !t.done && progress[t.id])
            .sort((a, b) => progress[b.id].at - progress[a.id].at)
            .slice(0, 5)
            .map((t) => {
              const last = t.sessions[t.sessions.length - 1];
              const shown = open.find((o) => o.sessionId && t.sessions.includes(o.sessionId));
              return { key: t.id, name: t.name, repo: byId.get(last)?.repo ?? "", progress: progress[t.id], show: shown?.key ?? (last ? "c:" + last : undefined) };
            })}
          acts={acts.filter((a) => a.at > (awaySince || Date.now() - 86400_000)).reverse()}
          onShow={(key) => (setOverlay(null), show(key))}
          onQueue={() => setOverlay("queue")}
          onHistory={() => setOverlay("history")}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "history" && (
        <History
          acts={acts}
          tasks={tasks}
          onClose={() => setOverlay(null)}
          onPick={(sessionId) => {
            setOverlay(null);
            const o = open.find((x) => x.sessionId === sessionId);
            const s = byId.get(sessionId);
            if (o) show(o.key);
            else if (s) openSession(s);
            else say(tr("그 세션은 아직 대화 기록이 없다."));
          }}
        />
      )}
      {overlay === "quit" && (
        <div className="pal-back" onMouseDown={() => setOverlay(null)}>
          <div className="confirm" onMouseDown={(e) => e.stopPropagation()}>
            <b>{tr`일하는 세션이 ${open.filter((o) => states[o.key]?.state === "run").length}개 있다`}</b>
            <p>{tr`지금 끄면 하던 일이 멈춘다. 대화는 남아서 다시 켜면 이어 열 수 있다.`}</p>
            <Hint text={tr`Enter 끄기 · Esc 취소`} />
          </div>
        </div>
      )}
      {overlay === "close" && (
        <div className="pal-back" onMouseDown={() => setOverlay(null)}>
          <div className="confirm" onMouseDown={(e) => e.stopPropagation()}>
            <b>{tr`"${nameOf(closing).slice(0, 40)}" 세션을 닫을까?`}</b>
            <p>{tr`세션을 재운다. 대화는 남아 있어서 ⌘K로 다시 열면 이어진다.`}</p>
            <div className="confirm-acts">
              <button type="button" onClick={() => confirmClose(false)}>
                {tr`닫기`} <kbd>⏎</kbd>
              </button>
              <button type="button" onClick={() => confirmClose(true)}>
                {tr`닫고 다시 묻지 않기`} <kbd>⌥⏎</kbd>
              </button>
              <button type="button" onClick={() => setOverlay(null)}>
                {tr`취소`} <kbd>Esc</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
      <Status
        rows={open.map((o) => ({ key: o.key, name: nameOf(o.key), repo: repoOf(o.cwd), rss: load[o.key]?.[0] ?? 0, cpu: load[o.key]?.[1] ?? 0, state: states[o.key]?.state ?? "" }))}
        limit={config.memoryLimitGb}
        usage={config.usage ? usage : null}
        usageWhy={config.usage ? usageWhy : ""}
        open={loadOpen}
        onToggle={() => setLoadOpen((v) => !v)}
        onShow={(key) => (setLoadOpen(false), show(key))}
        onRefresh={readUsage}
        onHelp={() => setOverlay("help")}
        onUsage={() => setOverlay("usage")}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
