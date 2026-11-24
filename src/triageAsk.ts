// 세션이 답을 끝냈을 때 "내가 할 일이 있나"를 모델에게 묻는 글. 앱(App.tsx)과 평가 스크립트(scripts/eval-triage.mjs)가 같이 쓴다.
// 다른 모듈을 읽지 않는다: Node가 이 파일을 그대로 읽을 수 있어야 한다.

// 모델에 보내는 글 i18n-off
export const TRIAGE_SYSTEM =
  '너는 분류기다. 코딩 에이전트가 사용자에게 한 마지막 답을 읽고, 사용자가 지금 무엇인가 해야 하는지 판정한다. need가 true인 경우: 사용자에게 질문했다, 선택지를 주고 고르라고 했다, 허락이나 확인을 구했다, 계속할지 물었다, 사용자가 줄 정보나 조치(로그인, 값, 파일, 권한)를 기다린다, 실패나 오류를 알리며 어떻게 할지 사용자의 결정이 필요하다, 시킨 일을 다 하지 못하고 멈췄다. need가 false인 경우: 시킨 일을 끝냈다고 보고만 했다, 결과나 조사한 내용을 알려 주기만 했다, 끝낸 뒤 다음에 해 볼 만한 일을 가볍게 덧붙였다("원하면 ~도 하겠다"). 확실하지 않으면 true로 한다. go는 need가 true일 때만 정한다. go가 true인 경우: 에이전트가 스스로 내놓은 다음 단계나 방금 설명한 계획을 그대로 진행해도 되는지만 묻고 있어서 "응, 진행해" 한마디면 충분한 답이 된다. go가 false인 경우: 둘 이상의 안 가운데 고르라고 한다, 사용자만 아는 정보나 조치를 기다린다, 실패나 오류를 알리며 어떻게 할지 묻는다, 되돌리기 어렵거나 밖으로 나가는 일(푸시, 머지, 배포, 삭제, 운영 데이터 변경, 메시지나 메일 보내기, 결제)을 해도 되는지 묻는다, 묻는 것이 여럿이다, 확실하지 않다. JSON 한 줄만 답한다: {"need": true 또는 false, "go": true 또는 false, "why": "need가 true면 사용자가 해야 할 일, false면 무엇을 보고했는지를 한 문장으로"}';

/** 물음은 대개 답의 끝에 있어서 끝부분을 보낸다 */
export const triagePrompt = (said: string, reply: string) => `사용자가 시킨 말:\n${said.slice(0, 600)}\n\n에이전트의 마지막 답(끝부분):\n${reply.slice(-2800)}\n`;
// i18n-on

/** 답을 읽지 못하면 할 일이 있는 것으로 둔다. 놓치는 것보다 한 번 더 부르는 편이 낫다 */
export const parseTriage = (raw: string): { need: boolean; go: boolean; why: string } => {
  try {
    const got = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { need?: boolean; go?: boolean; why?: string };
    return { need: got.need !== false, go: got.need !== false && got.go === true, why: String(got.why ?? "").slice(0, 160) };
  } catch {
    return { need: true, go: false, why: "" };
  }
};
