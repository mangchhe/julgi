/** 얼굴을 가진 것: 대신 답하기 규칙과 봇 */
type Faced = { id: string; art?: string; image?: string };

/** 앱에 들어 있는 얼굴 그림들. assets/art 의 bot-*.png 가 전부 선택지가 된다: 파일을 더 넣으면 고를 것이 는다 */
const FILES = import.meta.glob<string>("./assets/art/bot-*.png", { eager: true, query: "?url", import: "default" });
const FIRST = ["go", "check", "calm", "sleepy"];
export const ARTS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES)
    .map(([path, url]) => [path.replace(/^.*bot-|\.png$/g, ""), url] as [string, string])
    .sort((a, b) => (FIRST.indexOf(a[0]) + 1 || 99) - (FIRST.indexOf(b[0]) + 1 || 99) || a[0].localeCompare(b[0])),
);
/** 처음 봇이 쓰는 그림 */
const OWN: Record<string, string> = { go: "go", verify: "check" };
const NAMES = Object.keys(ARTS);
/** 그림을 정해 두지 않은 봇은 id에서 하나를 고른다. 같은 봇은 늘 같은 얼굴이다 */
const artOf = (b: Faced) => (b.art && ARTS[b.art] ? b.art : (OWN[b.id] ?? NAMES[[...b.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NAMES.length]));
/** 봇의 얼굴: 내가 고른 그림, 없으면 들어 있는 그림 */
export const faceOf = (b: Faced) => b.image ?? ARTS[artOf(b)];
/** 새 봇에 줄 그림: 아직 아무도 안 쓰는 것부터 */
export const freeFace = (bots: Faced[]) => NAMES.find((n) => !bots.some((b) => !b.image && artOf(b) === n)) ?? NAMES[bots.length % NAMES.length];

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

export default function BotFace({ image, size = 28 }: { image: string; size?: number }) {
  return <img src={image} width={size} height={size} alt="" style={{ borderRadius: size / 4, objectFit: "cover", display: "block" }} />;
}
