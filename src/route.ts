// 보내기: 친 글이 어느 줄기 이야기인지 글자로 맞춰 본다. 모델을 쓰지 않아 즉시 끝난다.
import { Folder, Item, linkLabel } from "./model";

/** strong: 글에 그 줄기를 콕 집는 것(티켓·PR 번호, 줄기 이름 그대로)이 들어 있다. 낱말이 겹친 것과는 다르다 */
export type Candidate = { item: Item; score: number; reasons: string[]; strong?: boolean };

/** 글을 낱말로 쪼갠다. 한글 낱말은 조사가 붙으므로 끝을 한두 글자 뗀 것도 약하게 쳐 준다 */
function words(text: string): { word: string; origin: string; strength: number }[] {
  const out = new Map<string, { word: string; origin: string; strength: number }>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    if (raw.length < 2) continue;
    out.set(raw, { word: raw, origin: raw, strength: 1 });
    if (/[가-힣]/.test(raw)) {
      for (const cut of [1, 2]) {
        const stem = raw.slice(0, raw.length - cut);
        if (stem.length >= 2 && !out.has(stem)) out.set(stem, { word: stem, origin: raw, strength: 0.6 });
      }
    }
  }
  return [...out.values()];
}

/** 줄기에서 글자를 찾아볼 곳과 그 무게. 이름과 브랜치에서 맞으면 요약에서 맞은 것보다 세다 */
function fields(item: Item): [string, number][] {
  const s = item.session;
  return [
    [`${item.name} ${s.title} ${s.topic ?? ""} ${s.said}`, 3],
    [`${s.branch} ${s.work?.key ?? ""} ${s.links.map(linkLabel).join(" ")}`, 3],
    [s.repo, 2],
    [s.recap, 1],
    [item.memory, 1],
  ].map(([text, weight]) => [(text as string).toLowerCase(), weight as number]);
}

export function rank(message: string, items: Item[], openIds: Set<string>): Candidate[] {
  const query = words(message);
  const haystacks = items.map(fields);
  // 어디에나 나오는 낱말은 가릴 힘이 없으니 덜 쳐 준다
  const rarity = new Map<string, number>();
  for (const { word } of query) {
    const found = haystacks.filter((hay) => hay.some(([text]) => text.includes(word))).length;
    rarity.set(word, found ? Math.log(1 + items.length / found) : 0);
  }
  const newest = items[0]?.session.mtime ?? 0;
  return items
    .map((item, i) => {
      const hits = new Map<string, number>();
      for (const { word, origin, strength } of query) {
        let best = 0;
        for (const [text, weight] of haystacks[i]) if (text.includes(word)) best = Math.max(best, weight);
        if (best) hits.set(origin, Math.max(hits.get(origin) ?? 0, best * strength * rarity.get(word)!));
      }
      let score = [...hits.values()].reduce((a, b) => a + b, 0);
      // 같은 점수면 열려 있는 것, 최근 것이 먼저
      const fresh = Math.max(0, 1 - (newest - item.session.mtime) / (14 * 86400));
      if (score > 0 || !query.length) score += (openIds.has(item.session.id) ? 0.3 : 0) + fresh * 0.3;
      const reasons = [...hits].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word);
      // 번호가 든 낱말(PROJ-123, 1852)이 이름·브랜치·링크에 있거나, 글에 줄기 이름이 통째로 들어 있을 때만 콕 집은 것으로 본다
      const [title, refs] = haystacks[i];
      const byNumber = query.some(({ word, strength }) => strength === 1 && word.length >= 4 && /\d/.test(word) && (title[0].includes(word) || refs[0].includes(word)));
      const name = item.name.toLowerCase().trim();
      const strong = byNumber || (name.length >= 4 && message.toLowerCase().includes(name));
      return { item, score, reasons, strong };
    })
    .filter((c) => c.score > 0)
    // 콕 집힌 것이 먼저, 그다음 점수 순
    .sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.score - a.score);
}

/** 새 줄기를 어느 레포에서 열지 글자로 맞춘다. 레포 이름에서 맞으면 그 레포의 세션 제목에서 맞은 것보다 세다 */
export function rankFolders(message: string, folders: Folder[]): { folder: Folder; score: number }[] {
  const query = words(message);
  const hays = folders.map((f) => [f.repo.toLowerCase(), f.text.toLowerCase()] as const);
  return folders
    .map((folder, i) => {
      const hits = new Map<string, number>();
      for (const { word, origin, strength } of query) {
        const inName = hays[i][0].includes(word);
        if (!inName && !hays[i][1].includes(word)) continue;
        const found = hays.filter(([name, text]) => name.includes(word) || text.includes(word)).length;
        const value = (inName ? 3 : 1) * strength * Math.log(1 + folders.length / found);
        hits.set(origin, Math.max(hits.get(origin) ?? 0, value));
      }
      return { folder, score: [...hits.values()].reduce((a, b) => a + b, 0) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * 모델에게 묻지 않고 1등으로 보내도 되는가. 낱말이 겹쳤다는 것만으로는 안 된다("오늘" 하나가 요약에 있다고 그 일은 아니다).
 * 글이 그 줄기를 콕 집었고, 그렇게 집힌 것이 하나뿐일 때만 그렇다. 나머지는 모델이 내용을 읽고 정한다.
 */
export const confident = (list: Candidate[]) => !!list[0]?.strong && list.filter((c) => c.strong).length === 1;
