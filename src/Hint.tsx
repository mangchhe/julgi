// 창 아래의 키 안내. "↑↓ 고르기 · Enter 그 세션으로 · Esc" 같은 한 줄을 받아, 키는 단추 모양으로, 설명은 글로 나눠 그린다.
// 안내 글은 번역된 한 문장이라 여기서 모양만 가른다: " · "로 나눈 조각의 맨 앞이 키처럼 생겼으면 키로 본다.
const TOKEN = String.raw`(?:[⌘⌥⇧^]+)?(?:Enter|Esc|Tab|Space|↑↓|←→|[↑↓←→⏎↳]|\d[–-][⌘]?\d|[A-Za-z0-9]|[\[\]/,])`;
const KEYS = new RegExp(String.raw`^(${TOKEN}(?:[·/ ]${TOKEN})*)(?=\s|$)`);

export default function Hint({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={"pal-foot hint " + className}>
      {text.split(" · ").map((part, i) => {
        const hit = part.match(KEYS);
        return (
          <span key={i} className="hint-item">
            {hit ? (
              <>
                {hit[1].split(/(?<=[^ ]) (?=[^ ])/).map((k, n) => (
                  <kbd key={n}>{k}</kbd>
                ))}
                {part.slice(hit[1].length)}
              </>
            ) : (
              part
            )}
          </span>
        );
      })}
    </div>
  );
}
