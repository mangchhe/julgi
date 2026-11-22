/**
 * PR 본문과 코멘트에 쓰는 작은 마크다운. 제목, 목록, 인용, 코드 묶음, 표 없는 문단, 굵게·기울임·코드·링크·체크박스만 한다.
 * 남이 쓴 글을 HTML로 넣으므로 먼저 전부 이스케이프하고, 그 뒤에 우리가 만든 태그만 넣는다. 그래서 글 속 HTML은 글자로 보인다.
 * ponytail: 표, 각주, 중첩 목록은 글 그대로 둔다. 자주 보이면 marked + 소독기로 바꾼다
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 한 줄 안의 꾸밈. 코드 조각 안은 건드리지 않는다 */
function inline(text: string): string {
  return esc(text)
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 1
        ? `<code>${part.slice(1, -1)}</code>`
        : part
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
            .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<i>$2</i>")
            .replace(/~~([^~]+)~~/g, "<s>$1</s>"),
    )
    .join("");
}

export function md(src: string): string {
  const out: string[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```/);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (head) {
      flush();
      const level = Math.min(6, head[1].length + 2); // 제목이 화면을 다 먹지 않게 두 단계 낮춘다
      out.push(`<h${level}>${inline(head[2])}</h${level}>`);
    } else if (bullet || num) {
      if (para.length) flush();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flush();
      list ??= { tag, items: [] };
      const text = (bullet ?? num)![1];
      const box = text.match(/^\[([ xX])\]\s+(.*)$/);
      list.items.push(box ? `<input type="checkbox" disabled${box[1] === " " ? "" : " checked"}> ${inline(box[2])}` : inline(text));
    } else if (quote) {
      flush();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else if (!line.trim()) flush();
    else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("");
}
