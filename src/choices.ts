/** 화면 끝에 뜬 번호 고르기(권한 묻기, 질문 도구)를 꺼낸다. 1부터 차례로 이어진 번호가 둘 이상일 때만 고르기로 본다 */
export type Choice = { n: number; label: string; on: boolean };

export function choicesOf(screen: string): Choice[] {
  const lines = screen.split("\n").slice(-30);
  let best: Choice[] = [];
  let run: Choice[] = [];
  for (const raw of lines) {
    // 상자 테두리는 칸으로 친다. 들여쓰기는 그대로 남는다
    const line = raw.replace(/[│|]/g, " ");
    const m = /^\s*([❯>›])?\s*(\d)[.)]\s+(.+?)\s*$/.exec(line);
    if (m && Number(m[2]) === run.length + 1) run.push({ n: Number(m[2]), label: m[3].trim().slice(0, 80), on: !!m[1] });
    else if (m && m[2] === "1") run = [{ n: 1, label: m[3].trim().slice(0, 80), on: !!m[1] }];
    // 고르기 줄 사이의 설명 줄(들여 쓴 줄)은 건너뛴다. 빈 줄이나 다른 글이 나오면 끊는다
    else if (run.length && /^\s{3,}\S/.test(line)) continue;
    else run = [];
    if (run.length >= 2) best = [...run];
  }
  return best;
}
