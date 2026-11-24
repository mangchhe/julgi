// 세션이 답을 끝냈을 때 "내가 할 일이 있나"를 모델에게 묻는 글. 앱(App.tsx)과 평가 스크립트(scripts/eval-triage.mjs)가 같이 쓴다.
// 다른 모듈을 읽지 않는다: Node가 이 파일을 그대로 읽을 수 있어야 한다.

// 모델에 보내는 글 i18n-off
export const TRIAGE_SYSTEM =
  '너는 분류기다. 코딩 에이전트가 사용자에게 한 마지막 답을 읽고, 사용자가 지금 무엇인가 해야 하는지 판정한다. need가 true인 경우: 사용자에게 질문했다, 선택지를 주고 고르라고 했다, 허락이나 확인을 구했다, 계속할지 물었다, 사용자가 줄 정보나 조치(로그인, 값, 파일, 권한)를 기다린다, 실패나 오류를 알리며 어떻게 할지 사용자의 결정이 필요하다, 시킨 일을 다 하지 못하고 멈췄다. need가 false인 경우: 시킨 일을 끝냈다고 보고만 했다, 결과나 조사한 내용을 알려 주기만 했다, 끝낸 뒤 다음에 해 볼 만한 일을 가볍게 덧붙였다("원하면 ~도 하겠다"). 확실하지 않으면 true로 한다. bot은 need와 따로 정한다. 아래에 "등록된 봇" 목록이 있으면, 에이전트의 마지막 답이 그 가운데 한 봇의 상황에 꼭 들어맞을 때 그 번호를 적고, 아니면 0을 적는다. 봇의 상황이 "무엇이 없다"는 것이면 답을 다시 읽어 그것이 정말 없는지 확인하고, 비슷한 말이 하나라도 있으면(예: 시험이 통과했다, 돌려 봤다) 0으로 한다. 다음이면 반드시 0이다: 목록이 없다, 둘 이상의 안 가운데 고르라고 한다, 사용자만 아는 정보나 조치를 기다린다, 실패나 오류를 알리며 어떻게 할지 묻는다, 되돌리기 어렵거나 밖으로 나가는 일(푸시, 머지, 배포, 삭제, 운영 데이터 변경, 메시지나 메일 보내기, 결제)을 해도 되는지 묻는다, 진행하려는 계획 안에 그런 되돌리기 어려운 일이 하나라도 들어 있다, 확실하지 않다. JSON 한 줄만 답한다: {"need": true 또는 false, "bot": 번호 또는 0, "why": "need가 true면 사용자가 해야 할 일, false면 무엇을 보고했는지를 한 문장으로"}';

/** 물음은 대개 답의 끝에 있어서 끝부분을 보낸다 */
export const triagePrompt = (said: string, reply: string, bots: string[] = []) =>
  `사용자가 시킨 말:\n${said.slice(0, 600)}\n\n에이전트의 마지막 답(끝부분):\n${reply.slice(-2800)}\n${bots.length ? `\n등록된 봇 (번호. 상황):\n${bots.map((when, i) => `${i + 1}. ${when.slice(0, 300)}`).join("\n")}\n` : ""}`;

/** 봇: 세션이 답을 끝냈을 때 그 답이 when의 상황이면 Julgi가 say를 대신 보낸다 */
/** face: 얼굴을 그리는 씨앗 숫자. 없으면 id에서 낸다. image가 있으면 그 그림을 쓴다 */
export type Bot = { id: string; /** 봇을 부르는 이름 */ name: string; /** 하는 일 한 줄 */ job: string; when: string; say: string; on: boolean; runs: number; face?: number; /** 내가 고른 얼굴 그림 (작게 줄인 data URL) */ image?: string };
/** 처음에 넣어 두는 봇. 둘 다 꺼 둔다. 이름과 글은 설정에서 고친다 */
export const DEFAULT_BOTS: Bot[] = [
  { id: "go", name: "고고", job: "진행 물음에 답하기", when: "에이전트가 스스로 내놓은 다음 단계나 방금 설명한 계획을 그대로 진행해도 되는지만 묻고 멈췄다", say: "응, 진행해. 푸시, 머지, 배포, 삭제처럼 되돌리기 어려운 일은 하기 전에 물어봐.", on: false, runs: 0 },
  { id: "verify", name: "꼼꼼이", job: "확인하고 끝내게 하기", when: "사용자가 이번에 코드를 고치거나 만들라고 시켰고 에이전트가 그 일을 끝냈다고 보고했는데, 시험이나 실행으로 확인했다는 말이 답에 없다", say: "확인해 봐. 돌린 명령과 그 출력을 같이 붙여 줘.", on: false, runs: 0 },
];
// i18n-on

/** 답을 읽지 못하면 할 일이 있는 것으로 둔다. 놓치는 것보다 한 번 더 부르는 편이 낫다 */
export const parseTriage = (raw: string): { need: boolean; bot: number; why: string } => {
  try {
    const got = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { need?: boolean; bot?: number; why?: string };
    return { need: got.need !== false, bot: Number.isInteger(got.bot) && got.bot! > 0 ? got.bot! : 0, why: String(got.why ?? "").slice(0, 160) };
  } catch {
    return { need: true, bot: 0, why: "" };
  }
};
