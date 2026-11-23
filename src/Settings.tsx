import qrcode from "qrcode-generator";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { config, kilo } from "./model";
import { THEMES } from "./themes";
import { CORE, MORE } from "./Help";
import { getLang, resolveLang, tr } from "./i18n";

type Key = keyof typeof config;
type Props = {
  onChange: (key: Key, value: string | number | boolean) => void;
  onClose: () => void;
  /** 폰에서 열 주소. 폰에서 보기를 켰을 때만 온다 */
  remoteUrl?: string;
  /** GitHub 연결: 셸 칸에서 gh auth login을 돌린다 */
  onConnect: () => void;
  /** GitLab 연결: 셸 칸에서 glab auth login을 돌린다 */
  onConnectLab: () => void;
  /** 처음 열 묶음 이름 (예: "연결"). 없으면 첫 묶음 */
  startAt?: string;
};

type Row =
  | { kind: "theme"; label: string; note: string }
  | { kind: "number"; key: Key; label: string; note: string; step: number; min: number; max: number; show: (n: number) => string }
  | { kind: "toggle"; key: Key; label: string; note: string }
  | { kind: "pick"; key: Key; label: string; note: string; options: [string, string][] }
  | { kind: "key"; key: Key; label: string; note: string }
  | { kind: "text"; key: Key; label: string; note: string; hint: string; /** Jira에서 읽은 상태 이름에서 고르게 한다 */ statuses?: boolean }
  | { kind: "github"; label: string; note: string }
  | { kind: "gitlab"; label: string; note: string }
  | { kind: "jira"; label: string; note: string }
  | { kind: "keys"; label: string; note: string };

/** 묶음마다 줄 몇 개. 왼쪽에서 묶음을 고르면 오른쪽에 그 줄들만 나온다 */
const SECTIONS: { id: string; title: string; hint: string; rows: Row[] }[] = [
  {
    id: "화면", // i18n-ok
    title: tr("화면"),
    hint: tr("보이는 것과 창"),
    rows: [
    { kind: "theme", label: tr("테마"), note: tr("화면과 터미널의 색") },
    { kind: "pick", key: "lang", label: tr("언어"), note: tr("화면 글의 언어. 바꾸면 옆에 뜨는 단추로 Julgi를 다시 켜서 적용한다. 열려 있던 세션은 그대로 이어진다"), options: [["auto", tr("시스템 따름")], ["en", "English"], ["ko", "한국어"]] }, // i18n-ok
    { kind: "number", key: "recentDays", label: tr("목록에 보이는 기간"), note: tr("이보다 오래 안 쓴 잠든 세션은 목록에서 빼고 ⌘K로만 찾는다"), step: 1, min: 1, max: 90, show: (n) => tr`${n}일` },
    { kind: "toggle", key: "usage", label: tr("Claude 사용량 보기"), note: tr("아래 상태 줄에 5시간 창과 주간 한도를 얼마나 썼는지 보여 준다. 켜면 Claude Code의 로그인 토큰을 키체인에서 읽어 Anthropic의 사용량 주소에만 보낸다(처음에 키체인이 허락을 묻는다). 문서에 없는 주소라 어느 날 안 나올 수 있다") },
      { kind: "toggle", key: "triage", label: tr("할 일이 있을 때만 부르기"), note: tr("세션이 답을 끝내면 작은 모델이 마지막 답을 읽는다. 내가 정하거나 답할 것이 있으면 내 차례로 올리고 알린다. 끝냈다고 보고만 한 것은 \"보고함\"으로 조용히 두고 브리핑(⌘⇧B)에서 모아 보여 준다. 판정하지 못하면 내 차례로 올린다") },
      { kind: "number", key: "longRunMin", label: tr("오래 도는 일 알리기"), note: tr("한 번 시킨 일이 이만큼 넘게 돌고 있으면 한 번 알린다. 0이면 알리지 않는다"), step: 10, min: 0, max: 240, show: (n) => (n ? tr`${n}분` : tr("끔")) },
      { kind: "toggle", key: "morning", label: tr("돌아오면 브리핑"), note: tr("한동안 Julgi를 안 보다가 돌아오면 나를 기다리는 것, PR과 티켓에 생긴 일, 하던 일이 어디까지 왔는지, 그동안 Julgi가 한 일을 한 화면으로 보여 준다. ⌘⇧B로 언제든 연다") },
      { kind: "number", key: "morningHours", label: tr("브리핑을 띄우는 간격"), note: tr("이만큼 넘게 안 봤을 때만 띄운다"), step: 1, min: 1, max: 72, show: (n) => tr`${n}시간` },
      { kind: "toggle", key: "notify", label: tr("알림"), note: tr("Julgi 창을 안 보고 있을 때 세션이 답을 끝내거나 확인을 물으면 macOS 알림을 띄운다") },
    { kind: "toggle", key: "confirmClose", label: tr("닫기 전에 묻기"), note: tr("⌘W나 ×로 세션을 닫을 때 한 번 묻는다") },
    { kind: "key", key: "hotkey", label: tr("창 꺼내기 키"), note: tr("어느 앱에서든 Julgi 창을 꺼내고 다시 넣는 키. Enter를 누른 뒤 쓸 키 조합을 누른다. Backspace면 쓰지 않는다") },
    ],
  },
  {
    id: "세션", // i18n-ok
    title: tr("세션"),
    hint: tr("열고, 재우고, 넘기기"),
    rows: [
    { kind: "number", key: "hotTokens", label: tr("갈아타는 크기"), note: tr("이보다 큰 세션에 보낼 때는 인계 글만 들고 새 세션으로 넘어간 뒤 보낸다. 대화 한도가 200k면 150k, 1M이면 500k쯤이 맞다"), step: 50_000, min: 50_000, max: 2_000_000, show: (n) => kilo(n) },
    { kind: "number", key: "sleepHours", label: tr("알아서 재우기"), note: tr("답까지 본 뒤 이 시간 넘게 쉰 세션을 재운다"), step: 1, min: 0, max: 48, show: (n) => (n ? tr`${n}시간` : tr("안 재움")) },
    { kind: "number", key: "memoryLimitGb", label: tr("메모리 한도"), note: tr("세션들이 쓰는 메모리 합계가 이만큼을 넘으면, 답까지 보고 10분 넘게 쉰 세션을 오래 쉰 것부터 재운다. 칸에 떠 있는 세션, 고정한 세션, 일하는 중인 세션은 건드리지 않는다"), step: 1, min: 0, max: 64, show: (n) => (n ? `${n}GB` : tr("안 씀")) },
      { kind: "toggle", key: "autoFill", label: tr("칸 알아서 관리"), note: tr("내 차례인 세션을 칸에 올리고, 자리가 있으면 칸을 늘리고, 빈 칸은 없앤다") },
    { kind: "pick", key: "skipPermissions", label: tr("허락 묻지 않기"), note: tr("세션이 파일을 고치거나 명령을 돌릴 때 허락을 묻지 않게 띄운다(--dangerously-skip-permissions). \"내가 연 세션만\"은 Julgi가 알아서 띄운 세션(일감, 스킬 만들기, 폰이나 다른 세션이 던진 일)은 그대로 묻게 둔다. 이미 떠 있는 세션은 다시 열어야 바뀐다"), options: [["off", tr("묻는다")], ["mine", tr("내가 연 세션만")], ["all", tr("전부")]] },
    { kind: "pick", key: "autoAllow", label: tr("간단한 허락은 대신 답하기"), note: tr("늘 허락하는 종류의 명령은 묻지 않고 넘겨서 내 차례에 올라오는 일을 줄인다. \"살펴보기\"는 아무것도 바꾸지 않는 명령(git status, git diff, ls, gh pr view 같은 것)이고, \"시험과 빌드까지\"는 거기에 npm test, cargo test, pytest 같은 것을 더한다. 파일을 고치거나 지우는 일은 그대로 묻는다. 새로 여는 세션부터 적용된다"), options: [["off", tr("끔")], ["look", tr("살펴보기")], ["check", tr("시험과 빌드까지")]] },
    { kind: "text", key: "allowRules", label: tr("더 묻지 않을 명령"), note: tr("위 목록에 없는 명령을 쉼표로 적는다. 적은 글로 시작하는 명령은 묻지 않는다. 규칙 모양(Bash(…), Read(…))으로 적어도 된다"), hint: "docker ps, make lint" },
    { kind: "text", key: "defaultDir", label: tr("기본 폴더"), note: tr("레포가 드러나지 않는 일을 여는 폴더"), hint: tr("비우면 ~/julgi") },
    { kind: "text", key: "saveCommand", label: tr("⌘S가 보내는 말"), note: tr("⌘S를 누르면 지금 세션에 이 말을 보낸다"), hint: tr("예: /commit") },
    ],
  },
  {
    id: "알아서 하는 일", // i18n-ok
    title: tr("알아서 하는 일"),
    hint: tr("끄면 그 일만 멈춘다"),
    rows: [
    { kind: "toggle", key: "summarize", label: tr("요약과 이름 짓기"), note: tr("쉬는 세션을 작은 모델로 요약하고 알아볼 이름을 붙인다. 보낼 곳을 고를 때 이 요약을 읽는다") },
    { kind: "toggle", key: "judgeMerges", label: tr("같은 일 알아서 합치기"), note: tr("두 세션이 같은 일이라고 모델이 판정하면 묻지 않고 한 줄기로 묶는다") },
    { kind: "toggle", key: "brain", label: tr("브레인"), note: tr("줄기 기억에서 일이 끝나도 남길 것(결정, 함정, 사실)을 추려 담고, 새 일을 열 때 관련된 것을 붙인다. ⌘G에서 본다") },
    { kind: "toggle", key: "autoLead", label: tr("알아서 조율하기"), note: tr("⌘L로 던진 일이 레포 두 곳 넘게 걸치면 새 세션을 조율자로 세운다. 조율자는 일감으로 나눠 레포마다 다른 세션에 맡기고 결과를 모은다") },
    { kind: "toggle", key: "taskWorktree", label: tr("일감은 따로 딴 폴더에서"), note: tr("일감을 맡은 세션은 레포의 작업 폴더가 아니라 Julgi가 만든 워크트리(브랜치 julgi/일감번호)에서 일한다. 고친 것이 없으면 끝난 뒤 지운다") },
    { kind: "toggle", key: "growSkills", label: tr("스킬 알아서 만들고 가꾸기"), note: tr("되풀이해서 시킨 일은 스킬로 만들고(한 주에 하나), 자주 쓰는 내 스킬은 쓰인 기록에 비추어 다듬는다(한 주에 하나, 옛 글은 ~/.julgi/skill-history에 남는다). 링크로 건 스킬과 레포의 스킬은 건드리지 않는다") },
    ],
  },
  {
    id: "코드 검토", // i18n-ok
    title: tr("코드 검토"),
    hint: tr("세션이 고친 코드를 읽어 주는 것"),
    rows: [
    { kind: "toggle", key: "brief", label: tr("바뀐 것 브리핑"), note: tr("세션이 코드를 고치면 무엇을 왜 바꿨는지, 파일별로 한 줄, 눈여겨볼 곳을 요약해 둔다. ⌘I와 \"바뀐 것 보기\"에 나온다") },
    { kind: "toggle", key: "check", label: tr("내가 보기 전에 걸러 읽기"), note: tr("브리핑 뒤에 더 큰 모델이 세션의 설명 없이 변경만 읽고, 틀렸거나 틀릴 수 있는 곳을 짚는다(버그·위험·의문). ⌘E 위쪽에 나오고 한 번에 세션에 넘겨 확인시킬 수 있다. 15줄이 안 되는 변경에는 하지 않는다") },
    ],
  },
  {
    id: "점검과 모델", // i18n-ok
    title: tr("점검과 모델"),
    hint: tr("언제 정리하고, 판단에 무엇을 쓰나"),
    rows: [
    { kind: "number", key: "reviewHour", label: tr("점검 시각"), note: tr("매일 이 시각에 세션 정리와 스킬 후보 찾기를 한다. 그때 Julgi나 맥이 꺼져 있었으면 다음에 켰을 때 돈다"), step: 1, min: 0, max: 23, show: (n) => (n < 12 ? tr`오전 ${n}시` : n === 12 ? tr("낮 12시") : tr`오후 ${n - 12}시`) },
    { kind: "number", key: "reviewDay", label: tr("매주 점검 요일"), note: tr("이 요일의 점검은 세션 전부를 보고 브레인 정리, 스킬 다듬기, 지도 다시 그리기까지 한다"), step: 1, min: 0, max: 6, show: (n) => [tr("일요일"), tr("월요일"), tr("화요일"), tr("수요일"), tr("목요일"), tr("금요일"), tr("토요일")][n] },
    { kind: "pick", key: "thinking", label: tr("판단 모델"), note: tr("가볍게: 전부 Haiku. 맞춰서: 요약은 Haiku, 보낼 곳·합치기·브레인 담기는 Sonnet, 주간 점검은 Opus. 깊게: 한 단계씩 더 큰 모델"), options: [["light", tr("가볍게")], ["balanced", tr("맞춰서")], ["deep", tr("깊게")]] },
    ],
  },
  {
    id: "지도", // i18n-ok
    title: tr("지도"),
    hint: tr("레포를 찾아가게 하는 것"),
    rows: [
    { kind: "text", key: "mapRoot", label: tr("레포가 모여 있는 폴더"), note: tr("그 바로 아래의 git 레포를 전부 지도에 넣고, 세션이 읽을 수 있게 연다. 쉼표로 여럿. 바꾼 뒤 ⌘G의 지도 탭에서 다시 그린다"), hint: tr("예: ~/code · 비우면 Julgi가 고른다") },
    { kind: "toggle", key: "mapFetch", label: tr("지도 그릴 때 최신으로 받기"), note: tr("지도를 그리기 전에 레포마다 원격에서 받아 온다. 고친 파일이 없고 기본 브랜치에 있는 레포만 앞으로 당기고, 작업 중인 레포는 건드리지 않는다") },
    ],
  },
  {
    id: "연결", // i18n-ok
    title: tr("연결"),
    hint: "GitHub · GitLab · Jira",
    rows: [
      { kind: "github", label: "GitHub", note: tr("연결하면 PR을 Julgi 안에서 본다. 터미널의 PR 링크를 ⌘ 클릭하거나 ⌘K에서 #번호를 친다. 로그인은 gh(GitHub CLI)가 하고 토큰도 gh가 키체인에 둔다. Julgi는 토큰을 보지 않는다") },
      { kind: "gitlab", label: "GitLab", note: tr("연결하면 MR도 PR과 똑같이 본다(PR 화면, 작업 페이지, 알림). 로그인은 glab(GitLab CLI)이 하고 토큰도 glab이 둔다. 회사 GitLab이면 glab auth login에서 그 호스트를 고른다") },
      { kind: "jira", label: "Jira", note: tr("연결하면 티켓을 Julgi 안에서 보고, 티켓으로 일을 시작하고, 상태를 옮긴다. 토큰은 macOS 키체인에만 둔다(Cloud는 id.atlassian.com에서 만든 API 토큰, Server/DC는 개인 액세스 토큰)") },
      { kind: "pick", key: "jiraWatch", label: tr("챙길 티켓"), note: tr("정한 주기마다 내게 배정된 티켓을 보고 새로 배정되거나 상태가 바뀌거나 남이 코멘트를 달면 알리고 ⌘J에 넣는다"), options: [["mine", tr("내게 배정된 것")], ["off", tr("끔")]] },
      { kind: "number", key: "jiraEveryMin", label: tr("티켓 확인 주기"), note: tr("내 티켓을 이만큼마다 본다"), step: 1, min: 1, max: 60, show: (n) => tr`${n}분` },
      { kind: "text", key: "jiraStartTransition", label: tr("시작할 때 옮길 상태"), note: tr("이 티켓으로 시작할 때 이 상태로 옮길지 묻는다. 비우면 묻지 않는다. Jira가 연결돼 있으면 그 Jira의 상태 이름에서 고른다"), hint: "In Progress", statuses: true },
      { kind: "text", key: "jiraPrTransition", label: tr("PR 올리면 옮길 상태"), note: tr("티켓과 이어진 세션이 PR을 올리면 이 상태로 옮길지 묻는다"), hint: "In Review", statuses: true },
      { kind: "text", key: "jiraMergeTransition", label: tr("머지되면 옮길 상태"), note: tr("그 PR이 머지되면 이 상태로 옮길지 묻는다"), hint: "Done", statuses: true },
      { kind: "text", key: "jiraRepos", label: tr("프로젝트 키 → 레포"), note: tr("이 티켓으로 시작할 때 고를 레포. 시작 창에서 고르면 저절로 채운다"), hint: "ABC=acme-api, OPS=acme-infra" },
      { kind: "pick", key: "prWatch", label: tr("챙길 PR"), note: tr("정한 주기마다 PR을 보고 CI가 깨지거나 남이 코멘트를 달거나 리뷰를 받거나 머지되면 알린다. 세션이 올린 PR은 그 세션을 내 차례로 올리고, 나머지 내 PR은 ⌘J의 \"내 PR\"에 넣는다"), options: [["mine", tr("내 PR 전부")], ["session", tr("세션이 올린 PR만")], ["off", tr("끔")]] },
      { kind: "number", key: "prEveryMin", label: tr("PR 확인 주기"), note: tr("세션 줄의 PR과 내 PR을 이만큼마다 본다. 짧을수록 알림이 빨리 온다"), step: 1, min: 1, max: 30, show: (n) => tr`${n}분` },
      { kind: "number", key: "askEveryMin", label: tr("리뷰 요청 확인 주기"), note: tr("나한테 온 리뷰 요청을 이만큼마다 본다"), step: 1, min: 1, max: 60, show: (n) => tr`${n}분` },
      { kind: "toggle", key: "refreshOnFocus", label: tr("돌아오면 바로 보기"), note: tr("다른 앱에 있다 Julgi 창으로 돌아오면 PR과 리뷰 요청을 기다리지 않고 바로 다시 본다") },
      { kind: "number", key: "prViewRefreshSec", label: tr("PR 화면 새로 읽기"), note: tr("PR 화면을 열어 둔 동안 이만큼마다 새로 읽어 남이 단 코멘트와 CI를 들인다. 끄면 r을 누를 때만 읽는다"), step: 10, min: 0, max: 300, show: (n) => (n ? tr`${n}초` : tr("끔")) },
      { kind: "toggle", key: "wakeOnPr", label: tr("잠든 세션 깨우기"), note: tr("최근 세션이 남긴 PR은 세션이 잠들어 있어도 챙긴다. 켜면 그 PR에 일이 생길 때 세션을 바로 깨워 둔다(세션 하나가 메모리를 0.3–1GB 쓴다). 끄면 알리고 ⌘J의 내 차례에 올려 두기만 하고, 고르면 그때 깨운다") },
      { kind: "toggle", key: "reviewAsks", label: tr("리뷰 요청"), note: tr("정한 주기마다 나한테 리뷰를 부탁한 PR을 보고 ⌘J의 \"리뷰 요청\"에 넣는다. 새로 오면 알린다") },
    ],
  },
  {
    id: "밖에서", // i18n-ok
    title: tr("밖에서"),
    hint: tr("폰으로 보기"),
    rows: [
    { kind: "toggle", key: "remote", label: tr("폰에서 보기"), note: tr("Tailscale 망 안에서만 열리는 작은 웹 화면을 띄운다. 폰에서 내 차례인 세션에 답하고 새 일을 던진다. 켜면 아래에 주소가 나온다(누르면 복사). 주소에 든 토큰을 아는 기기만 들어온다") },
    ],
  },
];
// 단축키는 고칠 값이 아니라 보는 것이다. 도움말(⌘/)과 같은 목록을 쓴다
SECTIONS.push({ id: "keys", title: tr("단축키"), hint: tr("⌘/로도 본다"), rows: [...CORE, ...MORE].map(([label, note]) => ({ kind: "keys" as const, label, note })) });
const ROWS: Row[] = SECTIONS.flatMap((sec) => sec.rows);
/** 줄 번호 → 그 줄이 든 묶음 번호 */
const SECTION_OF: number[] = SECTIONS.flatMap((sec, n) => sec.rows.map(() => n));
/** 묶음 번호 → 그 묶음의 첫 줄 번호 */
const FIRST_OF: number[] = SECTIONS.map((_, n) => SECTION_OF.indexOf(n));

/** 주소를 QR 그림(SVG)으로. 폰으로 옮길 때 찍는다 */
const qrSvg = (text: string) => {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
};
/** "ctrl+super+KeyJ"를 ⌃⌘J로 보여 준다 */
const showKey = (combo: string) =>
  combo
    .split("+")
    .filter(Boolean)
    .map((part) => ({ ctrl: "⌃", alt: "⌥", shift: "⇧", super: "⌘", cmd: "⌘" })[part.toLowerCase()] ?? part.replace(/^Key|^Digit/, ""))
    .join("");

/** 설정 (⌘,). 바꾸는 즉시 적용되고 ~/.julgi/config.json에 남는다 */
export default function Settings({ onChange, onClose, remoteUrl, onConnect, onConnectLab, startAt }: Props) {
  const [at, setAt] = useState(() => Math.max(0, FIRST_OF[SECTIONS.findIndex((s) => s.id === startAt)] ?? 0));
  // Jira가 연결돼 있으면 그 Jira의 상태 이름을 읽어 "옮길 상태" 칸에서 고르게 한다. 워크플로가 프로젝트마다 달라서
  // 목록은 전체 상태이고, 실제로 옮길 수 있는지는 그 티켓의 지금 상태에 달려 있다
  const [statuses, setStatuses] = useState<string[]>([]);
  useEffect(() => {
    if (!config.jiraSite) return setStatuses([]);
    void invoke<string[]>("jira_statuses", { conn: { site: config.jiraSite, email: config.jiraEmail, kind: config.jiraKind } }).then(setStatuses, () => setStatuses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.jiraSite]);
  // gh가 있는가, 누구로 로그인했는가. undefined면 아직 보는 중
  const [gh, setGh] = useState<[boolean, string] | undefined>(undefined);
  useEffect(() => void invoke<[boolean, string]>("gh_status").then(setGh, () => setGh([false, ""])), []);
  const [lab, setLab] = useState<[boolean, string] | undefined>(undefined);
  // Jira: 연결돼 있으면 표시 이름, 아니면 입력 칸
  const [jira, setJira] = useState<{ name?: string; error?: string; busy?: boolean }>({});
  const [jiraForm, setJiraForm] = useState({ site: config.jiraSite || "https://", email: config.jiraEmail, token: "", kind: config.jiraKind || "cloud" });
  useEffect(() => {
    if (!config.jiraSite) return;
    void invoke<string>("jira_me", { conn: { site: config.jiraSite, email: config.jiraEmail, kind: config.jiraKind } }).then(
      (name) => setJira({ name }),
      (e) => setJira({ error: String(e) }),
    );
  }, []);
  const connectJira = () => {
    setJira({ busy: true });
    const site = jiraForm.site.trim().replace(/\/+$/, "");
    void invoke<string>("jira_connect", { site, email: jiraForm.email.trim(), token: jiraForm.token, kind: jiraForm.kind }).then(
      (name) => {
        set("jiraSite", site);
        set("jiraEmail", jiraForm.email.trim());
        set("jiraKind", jiraForm.kind);
        setJiraForm((f) => ({ ...f, token: "" }));
        setJira({ name });
      },
      (e) => setJira({ error: String(e) }),
    );
  };
  const disconnectJira = () => {
    void invoke("jira_disconnect", { site: config.jiraSite });
    set("jiraSite", "");
    setJira({});
  };
  useEffect(() => void invoke<[boolean, string]>("glab_status").then(setLab, () => setLab([false, ""])), []);
  const [taking, setTaking] = useState(false); // 키 조합을 받는 중
  const [, redraw] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => void box.current?.querySelector(".set-row.on")?.scrollIntoView({ block: "nearest" }), [at]);

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
      else if (row.kind === "github") onConnect();
      else if (row.kind === "gitlab") onConnectLab();
      else onClose();
    } else return;
    e.preventDefault();
  };

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal settings" ref={box} tabIndex={-1} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-body">
          <nav className="set-nav">
            <div className="set-title">{tr("설정")}</div>
            {SECTIONS.map((sec, n) => (
              <button key={sec.id} type="button" tabIndex={-1} className={n === SECTION_OF[at] ? "on" : ""} onClick={() => setAt(FIRST_OF[n])}>
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
                <div key={`${row.label}-${i}`} className={"set-row" + (i === at ? " on" : "") + (row.kind === "keys" ? " keys" : "")} onClick={() => setAt(i)}>
                  {row.kind === "keys" && <kbd className="set-kbd">{row.label}</kbd>}
                  <div className="set-label">
                    {row.kind !== "keys" && row.label}
                    <div className="set-note">{row.note}</div>
                    {row.kind === "toggle" && row.key === "remote" && config.remote && remoteUrl && (
                      <div className="set-remote">
                        {remoteUrl.startsWith("http") && <span className="set-qr" title={tr("폰 카메라로 찍는다")} dangerouslySetInnerHTML={{ __html: qrSvg(remoteUrl) }} />}
                        <div>
                          <button type="button" tabIndex={-1} className="set-url" title={tr("누르면 복사한다")} onClick={() => void navigator.clipboard.writeText(remoteUrl.match(/https?:\S+/)?.[0]?.replace(/\)$/, "") ?? remoteUrl).catch(() => {})}>
                            {remoteUrl}
                          </button>
                          {remoteUrl.startsWith("http") && <div className="set-note">{tr("폰 카메라로 QR을 찍어 연 뒤, 공유 단추에서 \"홈 화면에 추가\"를 누르면 다음부터는 아이콘으로 들어온다. 주소를 외울 일이 없다.")}</div>}
                        </div>
                      </div>
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
                    {row.kind === "pick" && row.key === "lang" && resolveLang(config.lang) !== getLang() && (
                      // 언어는 켤 때 정해진다. 바꿨으면 그 자리에서 다시 켤 수 있게 한다. 단추의 글은 두 언어로 다 적는다: 방금 고른 언어를 못 읽을 수도 있다
                      <button type="button" tabIndex={-1} className="set-restart" onClick={() => void invoke("app_restart")}>
                        {"Restart to apply · 다시 켜서 적용" /* 두 언어로 다 보인다 i18n-ok */}
                      </button>
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
                        {taking && i === at ? tr("쓸 키를 누른다…") : showKey(String(config[row.key])) || tr("안 씀")}
                      </button>
                    )}
                    {row.kind === "toggle" && (
                      <button type="button" tabIndex={-1} role="switch" aria-checked={!!config[row.key]} className={"set-switch" + (config[row.key] ? " yes" : "")} onClick={() => nudge(row, 1)}>
                        <i />
                        <span>{config[row.key] ? tr("켜짐") : tr("꺼짐")}</span>
                      </button>
                    )}
                    {row.kind === "github" && (
                      <span className="set-gh">
                        {gh === undefined ? (
                          <span className="set-note">{tr("보는 중")}</span>
                        ) : !gh[0] ? (
                          <span className="set-note">{tr("gh가 없다 · 터미널에서 brew install gh")}</span>
                        ) : gh[1] ? (
                          <span className="set-on">{tr`● ${gh[1]}로 연결됨`}</span>
                        ) : (
                          <button type="button" tabIndex={-1} className="set-toggle" onClick={onConnect}>
                            {tr("연결하기")}
                          </button>
                        )}
                      </span>
                    )}
                    {row.kind === "jira" &&
                      (config.jiraSite && jira.name ? (
                        <span className="set-gh">
                          <span className="set-on">● {jira.name} · {config.jiraSite.replace(/^https:\/\//, "")}</span>
                          <button type="button" tabIndex={-1} className="set-toggle" onClick={disconnectJira}>
                            {tr("끊기")}
                          </button>
                        </span>
                      ) : (
                        <span className="set-jira" onClick={(e) => e.stopPropagation()}>
                          <input tabIndex={-1} value={jiraForm.site} placeholder={tr("https://회사.atlassian.net")} spellCheck={false} onChange={(e) => setJiraForm({ ...jiraForm, site: e.target.value })} />
                          {jiraForm.kind === "cloud" && <input tabIndex={-1} value={jiraForm.email} placeholder={tr("이메일")} spellCheck={false} onChange={(e) => setJiraForm({ ...jiraForm, email: e.target.value })} />}
                          <input tabIndex={-1} type="password" value={jiraForm.token} placeholder={jiraForm.kind === "cloud" ? tr("API 토큰") : tr("개인 액세스 토큰")} onChange={(e) => setJiraForm({ ...jiraForm, token: e.target.value })} />
                          <span className="set-seg">
                            {[["cloud", "Cloud"], ["server", "Server/DC"]].map(([v, l]) => (
                              <button key={v} type="button" tabIndex={-1} className={jiraForm.kind === v ? "yes" : ""} onClick={() => setJiraForm({ ...jiraForm, kind: v })}>
                                {l}
                              </button>
                            ))}
                          </span>
                          <button type="button" tabIndex={-1} className="set-toggle" disabled={jira.busy || !jiraForm.token || jiraForm.site.length < 10} onClick={connectJira}>
                            {jira.busy ? tr("확인 중") : tr("연결하기")}
                          </button>
                          {jira.error && <span className="set-err">{jira.error}</span>}
                          {jiraForm.kind === "cloud" && (
                            <button type="button" tabIndex={-1} className="set-link" onClick={() => void openUrl("https://id.atlassian.com/manage-profile/security/api-tokens")}>
                              {tr("토큰 만들기 ↗")}
                            </button>
                          )}
                        </span>
                      ))}
                    {row.kind === "gitlab" && (
                      <span className="set-gh">
                        {lab === undefined ? (
                          <span className="set-note">{tr("보는 중")}</span>
                        ) : !lab?.[0] ? (
                          <span className="set-note">{tr("glab이 없다 · 터미널에서 brew install glab")}</span>
                        ) : lab[1] ? (
                          <span className="set-on">{tr`● ${lab[1]}로 연결됨`}</span>
                        ) : (
                          <button type="button" tabIndex={-1} className="set-toggle" onClick={onConnectLab}>
                            {tr("연결하기")}
                          </button>
                        )}
                      </span>
                    )}
                    {row.kind === "text" && <input tabIndex={-1} list={row.statuses && statuses.length ? "jira-statuses" : undefined} value={config[row.key] as string} placeholder={row.hint} spellCheck={false} onFocus={() => setAt(i)} onChange={(e) => set(row.key, e.target.value)} />}
                    {row.kind === "text" && row.statuses && statuses.length > 0 && !!(config[row.key] as string).trim() && !statuses.some((name) => name.toLowerCase() === (config[row.key] as string).trim().toLowerCase()) && (
                      <div className="set-warn">{tr("이 Jira에 없는 상태 이름이다")}</div>
                    )}
                  </div>
                </div>
                ),
              )}
            </div>
          </div>
        </div>
        <datalist id="jira-statuses">
          {statuses.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="pal-foot">{tr("Tab 묶음 넘기기 · ↑↓ 고르기 · ←→ 바꾸기 · Enter 켜고 끄기, 글 고치기 · 바로 적용된다 · Esc · 나머지 값은 ~/.julgi/config.json")}</div>
      </div>
    </div>
  );
}
