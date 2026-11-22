// 보낼 곳을 모델에게 묻는 글. 앱(Send.tsx)과 평가 스크립트(scripts/eval-route.mjs)가 같은 것을 쓴다.
// 다른 모듈을 읽지 않는다: Node가 이 파일을 그대로 읽을 수 있어야 한다.

/** 모델에게 물은 것과 그 답. pool은 후보 번호 순서의 세션 id다 */
export type RouteCase = { prompt: string; pool: string[]; pick: string; repo: string; model: string };

// 모델에 보내는 글 i18n-off
export const ASK_SYSTEM =
  '너는 분류기다. 사용자가 쓴 글이 아래 후보 작업 가운데 하나를 이어서 하는 이야기인지 판정한다. 그 작업이 하던 일의 연속이거나 같은 대상을 다룰 때만 그 후보를 고른다. 같은 레포이거나 주제가 비슷하다는 것만으로는 고르지 않는다. 새로운 요청이면 pick을 "new"로 하고, 글이 어느 레포의 일인지 드러나면 repo에 아래 레포 목록 가운데 하나를 적는다(드러나지 않으면 빈 문자열). 브레인 노트 목록이 있으면, 이 글의 일을 할 때 알고 시작해야 할 노트의 번호(b 뒤의 숫자)를 notes에 최대 4개 적는다. 확실히 관련된 것만 고르고 없으면 빈 배열로 둔다. 새로운 요청이고, 그 일을 끝내려면 레포 두 곳 넘게를 고치거나 조사해야 하면 span에 그 레포 이름들을 레포 목록에 있는 이름 그대로 적는다(영역별 묶음이 있으면 그것을 보고 고른다). 한 레포 안에서 끝나는 일이거나 확실하지 않으면 span은 빈 배열로 둔다. span이 둘 넘으면 size에 일의 크기를 적는다. "작음"은 한 세션이 레포들을 오가며 금방 끝낼 일이다: 필드 하나 추가, 문구나 값 수정, 읽기만 하는 조사, 한쪽을 조금 고치고 다른 쪽에 반영하는 일. "큼"은 레포마다 따로 설계하고 구현하고 확인해야 하는 덩어리가 둘 넘게 있고, 그 덩어리들을 나란히 진행할 수 있는 일이다: 새 기능을 서버와 앱과 어드민에 걸쳐 만드는 일, 계약을 바꾸고 여러 쪽을 따라 고치는 일. 확실하지 않으면 "작음"으로 한다. JSON 한 줄만 답한다: {"pick": 번호 또는 "new", "repo": "레포 이름 또는 빈 문자열", "span": ["레포 이름들"], "size": "작음 또는 큼", "notes": [숫자들], "why": "짧은 한 문장"}';

/** 후보 한 줄 */
export const candidateLine = (i: number, c: { name: string; repo: string; branch?: string; about?: string }) => {
  const about = (c.about ?? "").slice(0, 220);
  return `${i}. ${c.name} (${[c.repo, c.branch].filter(Boolean).join(", ")})${about ? " — " + about : ""}`;
};

export const askPrompt = (a: { lines: string[]; repos: string; areas?: string; brain?: string[]; misses?: string; text: string }) => {
  const brainPart = a.brain?.length ? `\n\n브레인 노트:\n${a.brain.join("\n")}` : "";
  return `후보:\n${a.lines.join("\n")}\n\n레포 목록: ${a.repos}${a.areas ? `\n\n영역별 묶음:\n${a.areas}` : ""}${brainPart}${a.misses ? `\n\n전에 틀렸던 판단(사용자가 직접 바로잡은 것. 비슷한 글이면 같은 실수를 하지 않는다):\n${a.misses}` : ""}\n\n글: ${a.text}\n`;
};
// i18n-on

export type RouteAnswer = { pick: number | string; repo?: string; why?: string; notes?: number[]; span?: string[]; size?: string };
export const parseAnswer = (raw: string) => JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as RouteAnswer;
