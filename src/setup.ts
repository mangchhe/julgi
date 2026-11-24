// 설정을 남과 나눌 수 있는 한 파일로 내보내고, 그런 파일을 읽어 지금 설정과 다른 것을 가려낸다.
// 다른 모듈을 읽지 않는다: Node가 이 파일을 그대로 읽어 scripts/check-setup.mjs 에서 시험한다.

/** 봇에서 나누는 것: 얼굴 사진(image)과 답한 횟수는 뺀다 */
type SharedBot = { name: string; job: string; when: string; say: string; art?: string; model?: string };
type LocalBot = SharedBot & { id: string; on: boolean; runs: number; image?: string };
type Value = string | number | boolean;

/**
 * 내보내지도 가져오지도 않는 설정.
 * 내 컴퓨터와 회사에 딸린 것(폴더, 연결, 티켓과 배포), 그리고 허락을 푸는 것(남의 파일 하나로 내 세션의 허락이 풀리면 안 된다)
 */
const PRIVATE = /^(jira|argo|map|remote)|^(defaultDir|autoTrust|repoPatterns|worksCommand|stripEnv|pluginDirs|repos|hotkey|usage|lang|memoryLimitGb|skipPermissions|autoAllow|allowRules|models)$/;
const shareable = (key: string, value: unknown): value is Value => !PRIVATE.test(key) && ["string", "number", "boolean"].includes(typeof value);

/** 나눌 수 있는 것만 모은 파일의 내용 */
export function setupOf(config: Record<string, unknown>, bots: LocalBot[]) {
  return {
    julgi: 1,
    config: Object.fromEntries(Object.entries(config).filter(([key, value]) => shareable(key, value))),
    bots: bots.filter((b) => b.when.trim() && b.say.trim()).map(({ name, job, when, say, art, model }): SharedBot => ({ name, job, when, say, art, model })),
  };
}

/**
 * 가져온 글에서 지금 설정과 다른 값과 아직 없는 봇을 고른다. Julgi 설정 파일이 아니면 null.
 * 모르는 열쇠, 종류가 다른 값, 나누지 않는 열쇠는 버린다. 봇은 꺼진 채로 들인다
 */
export function setupDiff(text: string, config: Record<string, unknown>, bots: LocalBot[]): { values: [never, Value][]; bots: LocalBot[] } | null {
  let file: { julgi?: unknown; config?: unknown; bots?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!file || typeof file !== "object" || file.julgi !== 1) return null;
  const values = Object.entries((file.config ?? {}) as Record<string, unknown>).filter(
    ([key, value]) => key in config && shareable(key, value) && typeof value === typeof config[key] && value !== config[key],
  ) as [never, Value][];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const fresh = (Array.isArray(file.bots) ? file.bots : [])
    .slice(0, 30)
    .map((b: Record<string, unknown>) => ({ name: str(b?.name, 40), job: str(b?.job, 80), when: str(b?.when, 600), say: str(b?.say, 600), art: str(b?.art, 20) || undefined, model: str(b?.model, 60) || undefined }))
    .filter((b) => b.when.trim() && b.say.trim() && !bots.some((mine) => mine.when.trim() === b.when.trim() && mine.say.trim() === b.say.trim()))
    .map((b, i): LocalBot => ({ ...b, id: `in${Date.now().toString(36)}${i}`, on: false, runs: 0 }));
  return { values, bots: fresh };
}
