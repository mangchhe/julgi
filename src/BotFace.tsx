import go from "./assets/art/bot-go.png";
import check from "./assets/art/bot-check.png";
import calm from "./assets/art/bot-calm.png";
import sleepy from "./assets/art/bot-sleepy.png";
import type { Bot } from "./triageAsk.ts";

/** 앱에 들어 있는 얼굴 그림들 */
export const ARTS: Record<string, string> = { go, check, calm, sleepy };
/** 처음 봇이 쓰는 그림 */
const OWN: Record<string, string> = { go: "go", verify: "check" };
const artOf = (b: Bot) => b.art ?? OWN[b.id] ?? "";
/** 봇의 얼굴: 내가 고른 그림, 없으면 들어 있는 그림, 그것도 없으면 그려 주는 얼굴 */
export const faceOf = (b: Bot) => ({ seed: b.face ?? faceSeed(b.id), image: b.image ?? ARTS[artOf(b)] });
/** 얼굴을 누를 때마다: 들어 있는 그림들을 차례로, 끝에는 그려 주는 얼굴 */
export const nextFace = (b: Bot): Partial<Bot> => {
  const order = [...Object.keys(ARTS), ""];
  const art = order[(order.indexOf(b.image ? "" : artOf(b)) + 1) % order.length];
  return { image: undefined, art, face: art ? b.face : Math.floor(Math.random() * 1e6) };
};

/** 봇의 얼굴. 그림 파일 없이 씨앗 숫자 하나로 색, 눈, 입, 더듬이를 정해 그린다. 같은 씨앗이면 늘 같은 얼굴이다 */
export const faceSeed = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** 고른 그림을 가운데 정사각형으로 잘라 128px로 줄인다. 봇 목록 파일에 그대로 담을 만큼 작아진다 */
export const shrinkImage = (file: File) =>
  new Promise<string>((done, fail) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = Object.assign(document.createElement("canvas"), { width: 128, height: 128 });
      canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
      URL.revokeObjectURL(img.src);
      done(canvas.toDataURL("image/png"));
    };
    img.onerror = fail;
    img.src = URL.createObjectURL(file);
  });

export default function BotFace({ seed, size = 28, image }: { seed: number; size?: number; image?: string }) {
  if (image) return <img src={image} width={size} height={size} alt="" style={{ borderRadius: size / 4, objectFit: "cover", display: "block" }} />;
  const [hue, eyes, mouth, top] = [(seed * 47) % 360, seed % 4, (seed >>> 2) % 4, (seed >>> 4) % 3];
  const ink = "rgba(8, 14, 20, 0.82)";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-hidden="true">
      {top === 0 && <path d="M16 6V2" stroke={`hsl(${hue} 55% 60%)`} strokeWidth="2" strokeLinecap="round" />}
      {top === 0 && <circle cx="16" cy="2.5" r="1.8" fill={`hsl(${(hue + 150) % 360} 70% 65%)`} />}
      {top === 1 && <path d="M10 6V3M22 6V3" stroke={`hsl(${hue} 55% 60%)`} strokeWidth="2" strokeLinecap="round" />}
      {top === 2 && <rect x="12" y="2.5" width="8" height="3.5" rx="1.5" fill={`hsl(${hue} 55% 48%)`} />}
      <rect x="3" y="6" width="26" height="23" rx="7" fill={`hsl(${hue} 55% 60%)`} />
      {eyes === 0 && <path d="M11 15v3M21 15v3" stroke={ink} strokeWidth="3" strokeLinecap="round" />}
      {eyes === 1 && <g fill={ink}><circle cx="11" cy="16" r="2.4" /><circle cx="21" cy="16" r="2.4" /></g>}
      {eyes === 2 && <g fill={ink}><rect x="8.5" y="14" width="5" height="4" rx="1" /><rect x="18.5" y="14" width="5" height="4" rx="1" /></g>}
      {eyes === 3 && <path d="M8.5 17q2.5-3 5 0M18.5 17q2.5-3 5 0" stroke={ink} strokeWidth="2.2" strokeLinecap="round" fill="none" />}
      {mouth === 0 && <path d="M12 23h8" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />}
      {mouth === 1 && <path d="M11.5 22q4.5 4 9 0" stroke={ink} strokeWidth="2.2" strokeLinecap="round" fill="none" />}
      {mouth === 2 && <rect x="12" y="21" width="8" height="4" rx="2" fill={ink} />}
      {mouth === 3 && <path d="M11 23h2.5M14.8 23h2.5M18.6 23h2.5" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}
