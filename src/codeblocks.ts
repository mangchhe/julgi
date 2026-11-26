/** 마크다운에서 ``` 또는 ~~~ 로 감싼 코드 블록을 꺼낸다. 닫히지 않은 블록은 끝까지로 본다 */
export type Block = { lang: string; text: string };

export function codeBlocks(md: string): Block[] {
  const out: Block[] = [];
  let open: { fence: string; indent: number; lang: string; lines: string[] } | null = null;
  for (const line of md.split("\n")) {
    const m = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)/.exec(line);
    if (!open) {
      if (m) open = { fence: m[2], indent: m[1].length, lang: m[3], lines: [] };
    } else if (m && m[2][0] === open.fence[0] && m[2].length >= open.fence.length && !line.trim().slice(m[2].length)) {
      out.push({ lang: open.lang, text: open.lines.join("\n") });
      open = null;
    } else open.lines.push(open.indent ? line.replace(new RegExp(`^ {0,${open.indent}}`), "") : line);
  }
  if (open && open.lines.length) out.push({ lang: open.lang, text: open.lines.join("\n") });
  return out.filter((b) => b.text.trim());
}
