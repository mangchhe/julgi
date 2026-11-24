// Argo CD 앱을 레포에 잇는 규칙과 배포 판정을 확인한다: node scripts/check-argo.mjs
import assert from "node:assert/strict";
import { historyRows, pickImage, sourceImages, argoHost, argoLoginCommand, argoLineOf, argoMark, argoNews, deployedRef, imageParts, imageSegments, linkApp, parseRules, repoPath, withEnv } from "../src/argo.ts";

const app = (over) => ({ context: "c", name: "x", project: "", sync: "Synced", health: "Healthy", env: "staging", namespace: "", cluster: "", repos: [], path: "", target: "", revision: "", images: [], syncedAt: "", phase: "Succeeded", message: "", ...over });
const repos = [
  { slug: "example/acme-api", name: "acme-api", cwd: "/w/acme-api" },
  { slug: "gitlab:gitlab.example.com/team/acme-shop", name: "acme-shop", cwd: "/w/acme-shop" },
  { slug: "example/api", name: "api", cwd: "/w/api" },
];

// 원격 주소는 모양이 달라도 같은 것으로 본다
assert.equal(repoPath("https://github.com/example/acme-api.git"), "github.com/example/acme-api");
assert.equal(repoPath("git@github.com:example/acme-api.git"), "github.com/example/acme-api");
assert.equal(repoPath("ssh://git@gitlab.example.com:2222/team/acme-shop"), "gitlab.example.com:2222/team/acme-shop");

// 이미지: 이름과 태그
assert.deepEqual(imageParts("registry.example.com:5000/acme/acme-api:1a2b3c4"), { name: "acme-api", tag: "1a2b3c4" });
assert.deepEqual(imageParts("acme-api@sha256:abc"), { name: "acme-api", tag: "" });
assert.deepEqual(imageParts("nginx:1.27"), { name: "nginx", tag: "1.27" });

// 1. 소스로 잇기 (GitHub, GitLab)
assert.equal(linkApp(app({ repos: ["https://github.com/example/acme-api.git"] }), repos, [])?.how, "source");
assert.equal(linkApp(app({ repos: ["git@gitlab.example.com:team/acme-shop.git"] }), repos, [])?.repo, "acme-shop");
// 2. 이미지로 잇기: 설정 레포를 따로 둔 구조. 이미지 경로의 조각이 레포 이름과 "같아야" 한다
const gitops = "https://github.com/example/acme-gitops";
const viaImage = linkApp(app({ repos: [gitops], images: ["registry.example.com/acme/acme-api:240101.1a2b3c4d", "redis:7"] }), repos, []);
assert.equal(viaImage?.how, "image");
assert.equal(viaImage?.repo, "acme-api");
assert.deepEqual(imageSegments("registry.example.com:5000/acme/acme-api:1.2@sha256:abc"), ["registry.example.com:5000", "acme", "acme-api"]);
// 이름이 짧아도 조각이 같으면 잇는다. 일부만 겹치면 잇지 않는다
assert.equal(linkApp(app({ images: ["registry.example.com/team/api:1"] }), repos, [])?.repo, "api");
assert.equal(linkApp(app({ images: ["registry.example.com/x/rapid-api:1"] }), repos, []), undefined);
assert.equal(linkApp(app({ images: ["registry.example.com/x/acme-api-worker:1"] }), repos, []), undefined);
// 이미지 하나가 앱 여러 개에 쓰인다: 레포 하나에 앱 셋이 이어진다
const image = "registry.example.com/acme/acme-api:240101.1a2b3c4d";
const three = ["acme-api-a", "acme-api-b", "acme-batch"].map((name) => linkApp(app({ name, repos: [gitops], images: [image, "registry.example.com/mesh/proxy:1.9"] }), repos, []));
assert.deepEqual(three.map((a) => a?.repo), ["acme-api", "acme-api", "acme-api"]);
// 곁에 붙은 남의 이미지(사이드카)만 있는 앱은 잇지 않는다
assert.equal(linkApp(app({ repos: [gitops], images: ["registry.example.com/mesh/proxy:1.9"] }), repos, []), undefined);
// 0. 사용자 규칙: 글로브와 정규식. 틀린 정규식은 버린다
const rules = parseRules("api=legacy-*, acme-shop=/^shop-(dev|prod)$/, broken=/(/");
assert.equal(rules.length, 2);
assert.equal(linkApp(app({ name: "legacy-backend" }), repos, rules)?.repo, "api");
assert.equal(linkApp(app({ name: "shop-prod" }), repos, rules)?.how, "rule");
assert.equal(linkApp(app({ name: "unrelated" }), repos, rules), undefined);
// 규칙은 기본 판정보다 먼저다: 이미지로는 acme-api에 이어질 앱을 규칙이 acme-shop으로 돌린다
const forced = linkApp(app({ name: "shop-dev", repos: [gitops], images: [image] }), repos, rules);
assert.equal(forced?.repo, "acme-shop");
assert.equal(forced?.how, "rule");

// 배포된 것을 무엇으로 볼까: 태그의 형식은 정해 두지 않는다. 16진수 조각을 모두 후보로 내고 git이 가린다
assert.deepEqual(deployedRef({ ...app({ revision: "0123456789abcdef" }), how: "source", repo: "acme-api" }), { tag: "01234567", refs: ["0123456789abcdef"] });
// "날짜.커밋" 꼴: 날짜(240101)는 여섯 자리라 후보가 아니고, 커밋 조각과 태그 그대로가 후보다
assert.deepEqual(deployedRef(viaImage), { tag: "240101.1a2b3c4d", refs: ["1a2b3c4d", "240101.1a2b3c4d"] });
// 여덟 자리 날짜는 16진수로도 읽히니 후보에 든다. 실제 커밋인지는 git이 가린다. 긴 조각을 먼저 묻는다
assert.deepEqual(deployedRef({ ...app({ images: ["r/acme-api:20260101-1a2b3c4d5e"] }), how: "image", repo: "acme-api" }).refs, ["1a2b3c4d5e", "20260101", "20260101-1a2b3c4d5e"]);
assert.deepEqual(deployedRef({ ...app({ images: ["r/acme-api:v1.4.0"] }), how: "image", repo: "acme-api" }), { tag: "v1.4.0", refs: ["v1.4.0"] });
assert.deepEqual(deployedRef({ ...app({ images: ["r/acme-api@sha256:abc"] }), how: "image", repo: "acme-api" }), { tag: "", refs: [] });
// 사이드카가 섞여 있어도 이 레포의 이미지 태그만 쓴다
assert.equal(deployedRef({ ...app({ images: ["registry.example.com/mesh/proxy:9f9f9f9f", image] }), how: "image", repo: "acme-api" }).tag, "240101.1a2b3c4d");
// 덮어쓰기: 정규식의 캡처 그룹 1이 커밋이다. 맞으면 그것만 쓰고, 안 맞거나 틀린 정규식이면 기본 판정이다
assert.deepEqual(deployedRef(viaImage, "^[0-9]+\\.([0-9a-f]+)$").refs, ["1a2b3c4d"]);
assert.deepEqual(deployedRef(viaImage, "^build-(.+)$").refs, ["1a2b3c4d", "240101.1a2b3c4d"]);
assert.deepEqual(deployedRef(viaImage, "(").refs, ["1a2b3c4d", "240101.1a2b3c4d"]);

// 환경 이름: 라벨 키를 정해 두면 그 라벨이 먼저다. 그 라벨이 없는 앱은 기본값 그대로
assert.equal(withEnv(app({ env: "staging", labels: { tier: "canary" } }), "tier").env, "canary");
assert.equal(withEnv(app({ env: "staging", labels: { other: "x" } }), "tier").env, "staging");
assert.equal(withEnv(app({ env: "staging", labels: { tier: "canary" } }), "").env, "staging");

// 한 줄 표시
assert.equal(argoMark(app({})), "✓");
assert.equal(argoMark(app({ health: "Degraded" })), "!");
assert.equal(argoMark(app({ sync: "OutOfSync" })), "≠");
assert.equal(argoLineOf([app({ env: "staging" }), app({ env: "prod", health: "Progressing" })]), "staging ✓ Healthy · prod … Progressing");

// 소식: 처음 보는 것은 알리지 않고, 나빠지면 알리고, 어긋난 채 오래 가면 한 번 알리고, 좋아지면 내린다
const t0 = 1_000_000;
const born = argoNews(undefined, app({ health: "Degraded" }), t0, 10);
assert.equal(born.news, undefined);
// 처음 봤을 때부터 나빴던 앱은 다음에 봐도 알리지 않는다. 좋아졌다가 다시 나빠지면 그때 알린다
assert.equal(argoNews(born.seen, app({ health: "Degraded" }), t0, 10).news, undefined);
const healed = argoNews(born.seen, app({}), t0, 10);
assert.equal(healed.news, "");
const broke = argoNews(healed.seen, app({ health: "Degraded" }), t0, 10);
assert.equal(broke.news, "배포 상태 Degraded");
assert.equal(argoNews(broke.seen, app({ health: "Degraded" }), t0, 10).news, "배포 상태 Degraded", "나빠진 채면 소식을 그대로 둔다");
assert.equal(argoNews({ health: "Healthy", sync: "Synced" }, app({ health: "Degraded" }), t0, 10).news, "배포 상태 Degraded");
const first = argoNews({ health: "Healthy", sync: "Synced" }, app({ sync: "OutOfSync" }), t0, 10);
assert.equal(first.news, "");
assert.equal(first.seen.since, t0);
const later = argoNews(first.seen, app({ sync: "OutOfSync" }), t0 + 11 * 60_000, 10);
assert.equal(later.news, "11분째 OutOfSync");
assert.equal(argoNews(later.seen, app({}), t0 + 12 * 60_000, 10).news, "");
assert.equal(argoNews(first.seen, app({ sync: "OutOfSync" }), t0 + 11 * 60_000, 0).news, "", "0이면 어긋남을 알리지 않는다");
// ── 배포 이력: 배포마다 달라지는 것은 revision이 아니라 그 배포의 소스에 적힌 이미지다 ──
// Helm 파라미터: image.tag와 그 짝 image.repository
const helm = (tag, extra = []) => ({ repoURL: gitops, helm: { parameters: [{ name: "app.image.repository", value: "registry.example.com/acme/acme-api" }, { name: "app.image.tag", value: tag }, ...extra] } });
assert.deepEqual(sourceImages([helm("240101.1a2b3c4d")]), [{ repo: "registry.example.com/acme/acme-api", tag: "240101.1a2b3c4d" }]);
// 마지막 마디가 tag인 이름이면 된다. replicas 같은 다른 파라미터는 건너뛴다
assert.deepEqual(sourceImages([{ helm: { parameters: [{ name: "tag", value: "v2" }, { name: "replicas", value: "3" }] } }]), [{ repo: "", tag: "v2" }]);
// 값이 그대로 "경로:태그"인 파라미터
assert.deepEqual(sourceImages([{ helm: { parameters: [{ name: "image", value: "registry.example.com/acme/acme-api:9f8e7d6" }] } }]), [{ repo: "registry.example.com/acme/acme-api", tag: "9f8e7d6" }]);
// Kustomize images: "이름=새경로:태그"와 "경로:태그"
assert.deepEqual(sourceImages([{ kustomize: { images: ["acme-api=registry.example.com/acme/acme-api:1a2b3c4", "registry.example.com/mesh/proxy:1.9"] } }]), [
  { repo: "registry.example.com/acme/acme-api", tag: "1a2b3c4" },
  { repo: "registry.example.com/mesh/proxy", tag: "1.9" },
]);
// Helm values: 객체와 YAML 글
assert.deepEqual(sourceImages([{ helm: { valuesObject: { app: { image: { repository: "registry.example.com/acme/acme-api", tag: "7c6b5a4" } } } } }]), [{ repo: "registry.example.com/acme/acme-api", tag: "7c6b5a4" }]);
assert.deepEqual(sourceImages([{ helm: { values: "replicas: 2\nimage:\n  repository: registry.example.com/acme/acme-api\n  tag: \"5a49382\"  # 배포 태그\n" } }]), [{ repo: "registry.example.com/acme/acme-api", tag: "5a49382" }]);
// 소스가 여럿이면 다 본다. 이미지가 없는 소스(설정 파일에 이미지가 든 앱)는 빈 목록이다
assert.equal(sourceImages([{ repoURL: gitops, path: "apps/x" }, helm("240102.2b3c4d5e")]).length, 1);
assert.deepEqual(sourceImages([{ repoURL: gitops, path: "apps/x" }]), []);
// 덮어쓰기: 태그 파라미터 이름을 정규식으로. 기본 규칙에 안 맞는 이름도 잡는다
assert.deepEqual(sourceImages([{ helm: { parameters: [{ name: "build.version", value: "240103.3c4d5e6f" }] } }]), []);
assert.deepEqual(sourceImages([{ helm: { parameters: [{ name: "build.version", value: "240103.3c4d5e6f" }] } }], "version$"), [{ repo: "", tag: "240103.3c4d5e6f" }]);
// 이 레포의 이미지 고르기: 사이드카가 섞여 있어도 레포 이름과 맞는 것. 하나뿐이면 그것
assert.equal(pickImage([{ repo: "registry.example.com/mesh/proxy", tag: "1.9" }, { repo: "registry.example.com/acme/acme-api", tag: "1a2b3c4" }], "acme-api")?.tag, "1a2b3c4");
assert.equal(pickImage([{ repo: "", tag: "v2" }], "acme-api")?.tag, "v2");
assert.equal(pickImage([{ repo: "a/x", tag: "1" }, { repo: "a/y", tag: "2" }], "acme-api"), undefined);

// 이력 줄: revision은 여섯 번 다 같고 태그만 배포마다 다르다 → 줄마다 다른 태그와 커밋 후보가 나온다
const rev = "0123456789abcdef";
const tags = ["240102.6f5e4d3c", "240102.5e4d3c2b", "240101.4d3c2b1a", "240101.4d3c2b1a", "240101.3c2b1a09"];
const hist = tags.map((tag, i) => ({ id: 50 - i, revision: i === 4 ? "fedcba9876543210" : rev, at: `2026-01-0${5 - i}T00:00:00Z`, sources: [helm(tag)] }));
const rows = historyRows(hist, "acme-api", "image");
assert.deepEqual(rows.map((r) => r.tag), tags);
assert.deepEqual(rows[0].refs, ["6f5e4d3c", "240102.6f5e4d3c"]);
// revision은 앞 배포와 다를 때만 표시한다: 넷째 줄(앞 배포의 revision이 다르다)만 "차트·설정 변경"
assert.deepEqual(rows.map((r) => r.moved), [false, false, false, true, false]);
// 이미지도 revision도 그대로면 다시 sync만 한 것: 셋째 줄(넷째 줄과 태그가 같고 revision도 같다)
assert.deepEqual(rows.map((r) => r.same), [false, false, true, false, false]);
// 이미지가 소스에 없는 앱(설정 파일에 이미지가 든 앱)은 깨지지 않고 revision으로 본다. 소스가 곧 레포인 앱은 revision이 커밋 후보다
const plain = historyRows([{ id: 2, revision: "aaaaaaaa1", at: "", sources: [{ repoURL: gitops, path: "apps/x" }] }, { id: 1, revision: "bbbbbbbb2", at: "", sources: [{ repoURL: gitops, path: "apps/x" }] }], "acme-api", "image");
assert.deepEqual(plain.map((r) => [r.tag, r.refs.length, r.moved]), [["", 0, true], ["", 0, false]]);
assert.deepEqual(historyRows([{ id: 1, revision: "aaaaaaaa1", at: "" }], "acme-api", "source")[0].refs, ["aaaaaaaa1"]);
// 태그 → 커밋 덮어쓰기는 이력에도 같이 적용된다
assert.deepEqual(historyRows(hist, "acme-api", "image", "", "^[0-9]+\\.([0-9a-f]+)$")[0].refs, ["6f5e4d3c"]);

// 로그인 명령: 포트가 없으면 :443을 붙이고, 주소에 섞인 앞머리와 경로는 뗀다. 이상한 글자가 든 주소는 받지 않는다(셸에서 돌리는 명령이다)
assert.equal(argoLoginCommand("argocd.example.com", true), "argocd login argocd.example.com:443 --grpc-web --skip-test-tls --sso --name argocd.example.com");
assert.equal(argoLoginCommand("https://argocd.example.com:8443/applications", false), "argocd login argocd.example.com:8443 --grpc-web --skip-test-tls --name argocd.example.com");
assert.equal(argoLoginCommand("argocd.example.com:443", true, "staging"), "argocd login argocd.example.com:443 --grpc-web --skip-test-tls --sso --name staging");
assert.equal(argoLoginCommand("argocd.example.com", true, "x; rm -rf ~"), "argocd login argocd.example.com:443 --grpc-web --skip-test-tls --sso --name argocd.example.com");
assert.equal(argoHost("argocd.example.com; rm -rf ~"), "");
assert.equal(argoHost("$(whoami).example.com"), "");
console.log("argo ok");
