// 영어 사전. 파일마다 조각을 두고 여기서 합친다. 열쇠는 코드에 쓴 한국어 글 그대로다.
const parts = import.meta.glob<Record<string, string>>("./*.ts", { eager: true, import: "default" });
export const EN: Record<string, string> = Object.assign({}, ...Object.entries(parts).filter(([path]) => path !== "./index.ts").map(([, dict]) => dict));
