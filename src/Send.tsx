import Hint from "./Hint";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { aboutOf, ago, config, Folder, hot, Item, kilo, modelFor, repoOf } from "./model";
import { Candidate, confident, rank, rankFolders } from "./route";
import { ASK_SYSTEM, askPrompt, candidateLine, parseAnswer, RouteCase } from "./routeAsk.ts";
import { indexLine, Note, shortlist, Stats } from "./brain";
import { tr } from "./i18n";

/** join이 있으면 새 세션을 그 줄기에 더한다 (같은 일인데 레포가 다를 때) */
export type Target = { kind: "item"; item: Item } | { kind: "new"; cwd: string; join?: Item };
/** 보낼 때 같이 남기는 것. 나중에 적중률을 본다 */
/** by: 누가 골랐나. 한 일 목록에 남긴다 */
/** brain: 새 세션에 붙여 줄 브레인 노트 */
/** span: 이 일이 걸친 레포들. 둘이 넘으면 새 세션을 조율자로 세운다 */
/** ask: 모델에게 물었다면 그 물음과 답. 평가 때 다시 돌린다 */
export type RouteNote = { top?: string; rank: number; asked?: string; by?: string; brain?: Note[]; span?: string[]; big?: boolean; ask?: RouteCase };

type Props = {
  items: Item[];
  openIds: Set<string>;
  /** 지금 칸의 폴더 */
  cwd: string;
  /** 새 줄기를 열 수 있는 레포들 */
  folders: Folder[];
  /** 레포가 드러나지 않는 일을 여는 기본 폴더 */
  base: string;
  /** 브레인 노트. 모델이 보낼 곳을 정할 때 관련된 것도 같이 고른다 */
  notes: Note[];
  /** 전에 보낼 곳을 틀려서 내가 옮긴 사례들. 같은 실수를 되풀이하지 않게 모델에게 보여 준다 */
  misses: string;
  stats: Stats;
  /** 지도의 영역별 묶음을 줄여 적은 글. 일이 어느 레포들에 걸치는지 모델이 보는 데 쓴다 */
  areas: string;
  /** 상자에 미리 넣어 둘 글 (다른 세션에서 옮겨 온 말) */
  initial?: string;
  /** handoff면 먼저 갈아탄 뒤 새 세션에 보낸다 */
  /** late면 상자를 먼저 닫고 뒤에서 정해 보내는 것이다. 그 사이 다시 연 상자를 닫지 않는다 */
  onSend: (target: Target, message: string, note: RouteNote, handoff: boolean, late?: boolean) => void;
  /** 모델에게 묻는 동안 기다리지 않게, 상자를 닫으면서 알린다 */
  onLater: (message: string) => void;
  onClose: () => void;
};

const MAX = 6;
// ponytail: "새 프로젝트" 이야기인지는 낱말로만 가린다(한국어, 영어). 다른 말로 쓰면 줄이 안 뜬다. 자주 놓치면 보낼 곳을 묻는 모델에게 같이 묻는다
const NEW_PROJECT = /(새|신규)\s*(프로젝트|레포|리포|저장소)|new\s+(project|repo)/i;
// 모델에 보내는 글 i18n-off
const NAME_SYSTEM = '사용자가 새로 시작하려는 프로젝트의 폴더 이름을 정한다. 글에 이름이 적혀 있으면 그 이름을 쓰고, 없으면 내용에 맞는 짧은 영어 이름을 짓는다. 영어 소문자, 숫자, 하이픈만 쓰고 한 낱말에서 세 낱말 사이로 한다. JSON으로만 답한다: {"name": "..."}';
// i18n-on
/** 폴더 이름으로 쓸 수 있게 다듬는다 */
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 48);
/** 치다가 닫은 글. 다시 열면 그대로 있고, 보내면 비운다 */
let draft = "";

/** 보내기 상자. 할 말을 먼저 치면 어느 줄기 이야기인지 맞춰서 보여 주고, Enter로 거기에 보낸다. */
export default function Send({ items, openIds, cwd, folders, base, notes, misses, stats, areas, initial, onSend, onLater, onClose }: Props) {
  const [message, setMessage] = useState(initial ?? draft);
  useEffect(() => void (draft = message), [message]);
  const [sel, setSel] = useState(0);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<{ item?: Item; why: string; cwd?: string; failed?: boolean } | null>(null);
  const [record, setRecord] = useState("");
  // 내가 후보를 직접 골랐는가. 안 골랐으면 Enter는 "알아서 보내라"는 뜻이다
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const picked4 = useRef<Note[]>([]); // 모델이 고른 브레인 노트
  const asked4 = useRef<RouteCase | undefined>(undefined); // 모델에게 물은 것과 답. 글을 고치면 버린다
  const span = useRef<string[]>([]); // 모델이 본, 이 일이 걸친 레포들
  const big = useRef(false); // 그리고 그 일이 나눠 맡길 만큼 큰가
  useEffect(() => input.current?.focus(), []);
  // 새 프로젝트를 시작하자는 글이면 폴더 이름을 정해 둔다. 폴더는 내가 그 줄을 골라 Enter를 눌러야 만든다
  const wantsProject = NEW_PROJECT.test(message);
  const [proj, setProj] = useState("");
  const projEdited = useRef(false);
  useEffect(() => {
    if (!wantsProject || projEdited.current) return;
    const text = message.trim();
    // 모델이 답하기 전에도 줄이 뜨게, 글에 있는 영어 낱말로 먼저 채운다
    setProj((old) => old || slug((text.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g) ?? []).filter((w) => !/^(new|project|repo)$/i.test(w)).slice(0, 2).join("-")));
    // 무엇을 만들지 적지 않았으면 지어낼 근거가 없다. 이름 칸을 비워 두고 내가 적게 한다
    if (text.replace(NEW_PROJECT, "").replace(/[\s.,!?~]/g, "").length < 4) return;
    const timer = setTimeout(() => {
      void invoke<string | null>("route_ask", { model: modelFor("note"), system: NAME_SYSTEM, prompt: text })
        .then((raw) => {
          const name = slug(String(JSON.parse((raw ?? "").slice((raw ?? "").indexOf("{"), (raw ?? "").lastIndexOf("}") + 1)).name ?? ""));
          if (name && !projEdited.current) setProj(name);
        })
        .catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, wantsProject]);
  // 새 폴더를 둘 곳: 레포가 모여 있는 폴더, 정해 두지 않았으면 기본 폴더
  const root = (config.mapRoot || base).replace(/\/$/, "");

  // 지금까지 Julgi의 1등이 얼마나 맞았는지
  useEffect(() => {
    void invoke<string | null>("data_read", { name: "routes.jsonl" }).then((text) => {
      const rows = (text ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { top: string | null; rank: number })
        .filter((row) => row.top)
        .slice(-50);
      if (rows.length) setRecord(tr`최근 ${rows.length}번 중 ${rows.filter((row) => row.rank === 0).length}번 1등이 맞았다`);
    });
  }, []);

  const ranked = useMemo(() => rank(message, items, openIds), [message, items, openIds]);
  // 모델이 고른 것이 있으면 맨 위에 올린다
  const shown = useMemo(() => {
    const list = ranked.slice(0, MAX);
    if (!asked?.item) return list;
    const pick: Candidate = ranked.find((c) => c.item === asked.item) ?? { item: asked.item, score: 0, reasons: [] };
    return [pick, ...list.filter((c) => c.item !== asked.item)].slice(0, MAX);
  }, [ranked, asked]);
  const sure = confident(ranked);
  // 새로 열 곳: 글에 맞는 레포, 기본 폴더, 지금 칸의 폴더 순. 고르지 않아도 맨 위가 Julgi의 선택이다
  const fresh = useMemo(() => {
    const best = rankFolders(message, folders)[0]?.folder;
    const top = shown[0]?.item;
    const rows: { cwd: string; label: string; join?: Item; make?: boolean }[] = [];
    if (wantsProject && root) rows.push({ cwd: `${root}/${proj}`, label: tr`+ 새 프로젝트 · 폴더를 만들고 연다`, make: true });
    // 줄기는 맞는데 글이 다른 레포를 가리키면, 그 줄기에 그 레포의 세션을 더할 수 있다
    if (best && top && best.repo !== top.session.repo) rows.push({ cwd: best.cwd, label: tr`+ "${top.name}" 줄기에 ${best.repo} 세션 더하기`, join: top });
    const seen = new Set<string>();
    for (const [dir, label] of [
      [best?.cwd, tr`+ 새 줄기 · ${best?.repo}`],
      [base, tr`+ 새 줄기 · 기본 폴더`],
      [cwd, tr`+ 새 줄기 · ${repoOf(cwd)}`],
    ] as [string | undefined, string][]) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      rows.push({ cwd: dir, label });
    }
    return rows;
  }, [message, folders, shown, base, cwd, wantsProject, proj, root]);
  const total = shown.length + fresh.length;
  const at = Math.min(sel, total - 1);
  const picked = at < shown.length ? shown[at] : undefined;
  // 갈 곳이 정해졌을 때만 줄을 밝힌다. 애매한데 맨 위를 밝혀 두면 거기로 가는 것처럼 보인다
  const lit = touched || sure || !!asked;

  const send = (handoff: boolean) => {
    const text = message.trim();
    if (!text) return;
    const note: RouteNote = { top: ranked[0]?.item.session.id, rank: picked ? ranked.indexOf(picked) : -1, asked: asked?.item?.session.id, by: tr`내가 고름`, ask: asked4.current };
    draft = "";
    if (picked) return onSend({ kind: "item", item: picked.item }, text, note, handoff);
    const row = fresh[at - shown.length];
    if (row.make) {
      // 이름이 아직 없으면 만들지 않고 이름 칸으로 보낸다
      if (!proj) return nameBox.current?.focus();
      // 폴더를 만들고 git init까지 한 뒤 그 폴더에서 연다. 이미 있는 이름이면 만들지 않고 알린다
      draft = text;
      return void invoke<string>("project_make", { root, name: proj }).then(
        (made) => ((draft = ""), onSend({ kind: "new", cwd: made }, text, note, false)),
        (e) => setAsked({ why: tr`폴더를 만들지 못했다: ${String(e).slice(0, 80)}`, failed: true }),
      );
    }
    onSend({ kind: "new", cwd: fresh[at - shown.length].cwd, join: fresh[at - shown.length].join }, text, note, false);
  };

  /** 글자로는 애매할 때 작은 모델에게 묻는다. 글자가 안 겹친 최근 줄기도 후보에 넣는다. 묻지 못하면 null */
  const ask = async (): Promise<{ item?: Item; cwd?: string; brain: Note[] } | null> => {
    const text = message.trim();
    if (!text || asking) return null;
    setAsking(true);
    const pool = [...new Set([...ranked.slice(0, 12).map((c) => c.item), ...items.slice(0, 14)])];
    const lines = pool.map((item, i) => candidateLine(i, { name: item.name, repo: item.session.repo, branch: item.session.branch, about: aboutOf(item) }));
    try {
      const repos = folders.slice(0, 40).map((f) => f.repo).join(", ");
      // 노트가 많으면 글자가 겹치는 것과 많이 쓰인 것을 먼저 추려 보여 준다
      const shelf = shortlist(text, notes, stats);
      const prompt = askPrompt({ lines, repos, areas, brain: shelf.map(indexLine), misses, text });
      const raw = await invoke<string>("route_ask", { model: modelFor("route"), system: ASK_SYSTEM, prompt });
      const answer = parseAnswer(raw);
      // 나중에 같은 물음을 다시 돌려 정확도를 재려고, 물은 것과 답을 그대로 남긴다
      asked4.current = { prompt, pool: pool.map((item) => item.session.id), pick: typeof answer.pick === "number" ? (pool[answer.pick]?.session.id ?? "new") : "new", repo: answer.repo ?? "", model: modelFor("route") };
      const item = typeof answer.pick === "number" ? pool[answer.pick] : undefined;
      const cwd = item ? undefined : folders.find((f) => f.repo === answer.repo)?.cwd;
      setAsked({ item, why: answer.why ?? "", cwd });
      setSel(item ? 0 : MAX); // 맞는 게 없다고 하면 새 세션 쪽으로
      setAsking(false);
      const brain = (answer.notes ?? []).map((n) => shelf[n]).filter(Boolean).slice(0, 4);
      picked4.current = brain;
      span.current = item ? [] : (answer.span ?? []).filter((name) => folders.some((f) => f.repo === name));
      big.current = answer.size === "큼"; // 모델의 답에서 읽는 값 i18n-ok
      return { item, cwd, brain };
    } catch (e) {
      setAsked({ why: tr`묻지 못했다: ${String(e).slice(0, 80)}`, failed: true });
      setAsking(false);
      return null;
    }
  };

  /**
   * Enter: 고르지 않고 누르면 Julgi가 정해서 보낸다. 글자로 뚜렷하면 그 줄기로, 애매하면 모델에게 물어서,
   * 맞는 줄기가 없으면 글에 맞는 레포(없으면 기본 폴더)에 새 줄기로. 세션이 너무 크면 갈아탄 뒤 보낸다.
   */
  const auto = async () => {
    const text = message.trim();
    if (!text || asking) return;
    if (touched) return send(false);
    // 새 프로젝트를 시작하자는 글이면 바로 보내지 않고 그 줄을 골라 둔다. Enter를 한 번 더 눌러야 폴더를 만든다
    const makeAt = fresh.findIndex((row) => row.make);
    if (makeAt >= 0 && !sure) return setSel(shown.length + makeAt), setTouched(true), void (!proj && nameBox.current?.focus());
    let item = sure ? ranked[0].item : asked?.item;
    let viaModel = !sure && !!asked?.item;
    let cwd = asked?.cwd;
    let late = false;
    if (!sure && !asked) {
      // 물어보는 몇 초를 기다리게 하지 않는다. 상자를 닫고 뒤에서 정해서 보낸다
      late = true;
      draft = "";
      onLater(text);
      const answer = await ask();
      // 묻지 못했으면 글자로 맞은 1등에게, 그것도 없으면 새 줄기로
      item = answer ? answer.item : ranked[0]?.item;
      viaModel = !!answer?.item;
      cwd = answer?.cwd;
    }
    const note: RouteNote = { top: ranked[0]?.item.session.id, rank: item ? ranked.findIndex((c) => c.item === item) : -1, asked: viaModel ? item?.session.id : undefined, by: viaModel ? tr`모델이 고름` : item ? tr`글자로 맞음` : tr`이어 갈 줄기가 없어서`, brain: picked4.current, span: span.current, big: big.current, ask: asked4.current };
    draft = "";
    if (item) return onSend({ kind: "item", item }, text, note, hot(item.session.tokens), late);
    // 새 줄기를 열 곳: 모델이 짚은 레포, 없으면 글자로 맞은 레포, 그것도 없으면 기본 폴더
    const place = fresh.find((row) => !row.join && !row.make) ?? fresh[0];
    onSend({ kind: "new", cwd: cwd ?? place.cwd }, text, note, false, late);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // 아직 밝혀진 줄이 없으면 첫 ↓는 맨 위, 첫 ↑는 맨 아래에서 시작한다
      if (!lit) setSel(e.key === "ArrowDown" ? 0 : total - 1);
      else setSel((at + (e.key === "ArrowDown" ? 1 : -1) + total) % total);
      setTouched(true);
    } else if (e.key === "Enter" && !e.shiftKey) {
      if (e.metaKey) send(true);
      else void auto();
    }
    else if (e.key === "Tab") void ask();
    else return;
    e.preventDefault();
  };

  const head = !message.trim()
    ? tr`보낼 곳`
    : asking
      ? tr`모델에게 묻는 중…`
      : asked
        ? asked.item
          ? tr`모델이 고름 · ${asked.why}`
          : asked.failed
            ? asked.why
            : tr`모델: 맞는 줄기가 없다 · ${asked.why}`
        : shown.length === 0
          ? tr`글자로 맞는 줄기가 없다. Enter를 누르면 모델에게 물어 보고 보낸다`
          : sure
            ? tr`보낼 곳 · 글이 이 줄기를 콕 집었다. Enter를 누르면 맨 위로 보낸다`
            : tr`글자가 겹친 후보 · Enter를 누르면 상자를 닫고, 모델이 읽고 정해서 보낸다`;

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal send" onMouseDown={(e) => e.stopPropagation()}>
        <textarea
          ref={input}
          value={message}
          rows={Math.min(6, Math.max(2, message.split("\n").length))}
          placeholder={tr`할 말을 그대로 친다. 어느 줄기 이야기인지는 Julgi가 찾는다`}
          onChange={(e) => {
            setMessage(e.target.value);
            setSel(0);
            setAsked(null);
            picked4.current = [];
            asked4.current = undefined;
            span.current = [];
            setTouched(false);
          }}
          onKeyDown={onKey}
          onPaste={(e) => {
            // 그림이면 칸에 붙여넣을 때처럼 임시 파일로 받아 그 경로를 넣는다. 세션이 그 파일을 읽는다
            if (e.clipboardData.getData("text/plain")) return;
            e.preventDefault();
            const el = e.currentTarget;
            void invoke<string>("clipboard_paste")
              .then((clip) => {
                el.setRangeText(clip + " ", el.selectionStart, el.selectionEnd, "end");
                setMessage(el.value);
              })
              .catch(() => {});
          }}
        />
        <div className="send-head">
          <span>{head}</span>
          <span>{record}</span>
        </div>
        <div className="pal-list">
          {shown.map((c, i) => (
            <div key={c.item.session.id} className={"pal-item" + (lit && i === at ? " on" : "")} onClick={() => (setSel(i), setTouched(true))}>
              <span>
                {c.item.name}
                {c.reasons.length > 0 && <span className="send-why"> · {c.reasons.map((r) => `"${r}"`).join(" ")}</span>}
                {asked?.item === c.item && <span className="send-why"> · {tr`모델`}</span>}
              </span>
              <span className="pal-meta">
                {[
                  c.item.thread ? `${tr`줄기`} ${c.item.thread.sessions.length}` : "",
                  c.item.session.repo,
                  openIds.has(c.item.session.id) ? tr`열림` : ago(c.item.session.mtime),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {hot(c.item.session.tokens) && <span className="hot"> · {kilo(c.item.session.tokens)}</span>}
              </span>
            </div>
          ))}
          {fresh.map((row, i) => (
            <div
              // 새 프로젝트 줄은 이름을 치는 동안 경로가 바뀐다. 열쇠가 따라 바뀌면 이름 칸이 새로 만들어져 초점을 잃는다
              key={row.make ? "make" : row.label + row.cwd}
              className={"pal-item" + (lit && shown.length + i === at ? " on" : "")}
              onClick={() => (setSel(shown.length + i), setTouched(true))}
            >
              <span className="pal-new">{row.label}</span>
              {row.make ? (
                <span className="pal-meta send-make">
                  {root.replace(/^\/Users\/[^/]+/, "~")}/
                  <input
                    ref={nameBox}
                    placeholder={tr`이름을 적는다`}
                    value={proj}
                    spellCheck={false}
                    title={tr`폴더 이름. 고칠 수 있다`}
                    onChange={(e) => ((projEdited.current = true), setProj(e.target.value.replace(/[^A-Za-z0-9._-]/g, "")))}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      // 이름을 적고 Enter: 이 줄을 골라 두고 글 칸으로 돌아간다. 거기서 Enter를 누르면 만든다
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault(), setSel(shown.length + i), setTouched(true), input.current?.focus();
                      else if (e.key === "Escape") input.current?.focus();
                    }}
                  />
                </span>
              ) : (
                <span className="pal-meta">{row.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>
              )}
            </div>
          ))}
        </div>
        {!lit && message.trim() && fresh.some((row) => row.make) && <div className="pal-peek">{tr`새 프로젝트를 시작하자는 글로 보인다. Enter를 누르면 "새 프로젝트" 줄을 골라 두고, 한 번 더 누르면 폴더를 만든다. 다른 곳으로 보내려면 ↑↓로 고른다.`}</div>}
        {!lit && message.trim() && !fresh.some((row) => row.make) && <div className="pal-peek">{tr`아직 고른 곳이 없다. Enter를 누르면 상자는 바로 닫히고 Julgi가 뒤에서 모델에게 물어, 이어 갈 줄기가 있으면 거기로, 없으면 새 줄기로 보낸다. 아래는 글자가 겹친 후보일 뿐이다.`}</div>}
        {lit && !picked && fresh[at - shown.length]?.make && <div className="pal-peek">{proj ? tr`Enter를 누르면 ${fresh[at - shown.length].cwd.replace(/^\/Users\/[^/]+/, "~")} 폴더를 만들고 git init을 한 뒤, 거기서 새 세션을 열어 이 글을 보낸다. 이름은 오른쪽 칸에서 고칠 수 있다.` : tr`폴더 이름이 아직 없다. 오른쪽 칸에 이름을 적고 Enter를 누른다. 폴더 이름은 나중에 바꾸면 세션이 끊기므로 먼저 정한다.`}</div>}
        {lit && picked && (
          <div className="pal-peek">
            {picked.item.memory.replace(/\s+/g, " ").slice(0, 220) || picked.item.session.recap || tr`요약이 아직 없다`}
            {hot(picked.item.session.tokens) && <span> · {tr`세션이 크다. ⌘Enter로 갈아탄 뒤 보낼 수 있다`}</span>}
          </div>
        )}
        <Hint text={tr`Enter 알아서 보내기 · ↑↓로 고르면 고른 곳으로 · Tab 모델에게 미리 묻기 · ⌘Enter 갈아탄 뒤 보내기 · ⇧Enter 줄바꿈 · Esc`} />
      </div>
    </div>
  );
}
