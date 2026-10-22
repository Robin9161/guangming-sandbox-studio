import { store } from "./store";
import { MOVE_TYPES, type MoveValues, type RigValues } from "./moves";
import { PATHS } from "./paths";
import type { Timeline, TimelineLinks } from "./timeline";
import { ASPECTS, view, type Aspect } from "./view";

type Shot = { name: string; savedAt: string; rig: RigValues };

/**
 * 右侧面板「运镜与时间线」：
 * - 打开 / 关闭时间线编辑器；三个"跟随时间线"开关
 * - 把当前视角写入时间线；镜头库（存在工程 shots/ 里）
 * - 画幅（预览和成片一致）、安全框
 * - 导入配音 / 音乐（播放时间线时同步播放，渲染时可写进成片）
 * - 时间线文件：打开另一条、另存为
 */
export function bindTimelinePanel(timeline: Timeline, hooks: { freeCamera: () => RigValues; setCamera: (rig: RigValues) => void; relayout: () => void; hasPath: (key: MoveValues["path"]) => boolean }) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $("tl-status");
  const say = (text: string) => { status.textContent = text; };
  $("tl-name").textContent = timeline.name;

  // ---- 编辑器 ----
  const editorButton = $<HTMLButtonElement>("tl-editor");
  const setEditor = (open: boolean) => {
    if (open) timeline.ui.restore(); else timeline.ui.hide();
    document.body.classList.toggle("tl-open", open);
    editorButton.textContent = open ? "关闭时间线编辑器" : "打开时间线编辑器";
  };
  editorButton.addEventListener("click", () => setEditor(timeline.ui.isHidden));
  $("tl-close").addEventListener("click", () => setEditor(false));

  const playButton = $<HTMLButtonElement>("tl-play");
  playButton.addEventListener("click", () => timeline.togglePlay());

  // ---- 跟随开关 ----
  const linkButtons = document.querySelectorAll<HTMLButtonElement>("[data-link]");
  const syncLinks = () => linkButtons.forEach((b) => b.classList.toggle("on", timeline.links[b.dataset.link as keyof TimelineLinks]));
  linkButtons.forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.link as keyof TimelineLinks;
    timeline.links[key] = !timeline.links[key];
    if (key === "camera" && !timeline.links.camera) say("镜头回到手动：用鼠标调好后，点「写入当前视角」再交给时间线");
    syncLinks();
  }));
  syncLinks();

  // ---- 写入视角 ----
  $("tl-write-cam").addEventListener("click", () => {
    timeline.writeCamera(hooks.freeCamera());
    timeline.links.camera = true;
    syncLinks();
    say(`已写入 ${timeline.position().toFixed(2)} 秒处的镜头（属性打了关键帧时，这里会多一个关键帧）`);
  });

  // ---- 运镜模板 ----
  const moveType = $<HTMLSelectElement>("move-type"), movePath = $<HTMLSelectElement>("move-path");
  const moveStart = $<HTMLInputElement>("move-start"), moveDuration = $<HTMLInputElement>("move-duration"), moveAmount = $<HTMLInputElement>("move-amount");
  const AMOUNT_LABELS: Record<MoveValues["type"], string> = { none: "幅度", orbit: "转多少度", dolly: "推近 %（负数拉远）", crane: "抬高多少度", truck: "右移多少米", path: "离地高度（米）" };
  moveType.replaceChildren(...Object.entries(MOVE_TYPES).map(([k, v]) => new Option(v, k)));
  movePath.replaceChildren(...Object.entries(PATHS).map(([k, v]) => new Option(v, k)));
  const syncMoveForm = () => {
    const type = moveType.value as MoveValues["type"];
    movePath.style.display = type === "path" ? "" : "none";
    $("move-amount-label").textContent = AMOUNT_LABELS[type];
  };
  const current = timeline.moveValues();
  moveType.value = current.type; movePath.value = current.path;
  moveStart.value = String(current.start); moveDuration.value = String(current.duration);
  moveAmount.value = String(current.type === "path" ? current.height : current.amount);
  syncMoveForm();
  moveType.addEventListener("change", () => {
    if (moveType.value === "path") moveAmount.value = "450";
    if (moveType.value === "dolly") moveAmount.value = "40";
    if (moveType.value === "orbit") moveAmount.value = "60";
    syncMoveForm();
  });
  $("move-apply").addEventListener("click", () => {
    const type = moveType.value as MoveValues["type"];
    const amount = Number(moveAmount.value) || 0;
    if (type === "path" && !hooks.hasPath(movePath.value as MoveValues["path"])) return say(`「${PATHS[movePath.value as MoveValues["path"]]}」不在当前这个区的地形范围里`);
    timeline.writeMove({ type, path: movePath.value as MoveValues["path"], start: Number(moveStart.value) || 0, duration: Math.max(0.1, Number(moveDuration.value) || 8), ...(type === "path" ? { height: amount } : { amount }) });
    if (type !== "none") { timeline.links.camera = true; syncLinks(); }
    say(type === "none" ? "已取消运镜模板" : `已应用「${MOVE_TYPES[type]}」：在时间线 ${moveStart.value}–${Number(moveStart.value) + Number(moveDuration.value)} 秒播放（时间线编辑器里按空格播放）`);
  });

  // ---- 镜头库 ----
  const shotSelect = $<HTMLSelectElement>("shot-select"), shotName = $<HTMLInputElement>("shot-name");
  const refreshShots = async (select?: string) => {
    let names: string[] = [];
    try { names = (await store.list("shots")).map((s) => s.name); } catch { /* 服务没开 */ }
    shotSelect.replaceChildren(...names.map((n) => new Option(n, n, false, n === select)));
  };
  void refreshShots();
  $("shot-save").addEventListener("click", async () => {
    const name = shotName.value.trim();
    if (!name) return say("先给镜头起个名字");
    await store.save("shots", name, { name, savedAt: new Date().toISOString(), rig: hooks.freeCamera() } satisfies Shot);
    say(`已存入镜头库：「${name}」`);
    await refreshShots(name);
  });
  $("shot-load").addEventListener("click", async () => {
    if (!shotSelect.value) return say("镜头库是空的");
    const shot = await store.get<Shot>("shots", shotSelect.value);
    if (timeline.links.camera) { timeline.writeCamera(shot.rig); say(`已把「${shot.name}」写入时间线 ${timeline.position().toFixed(2)} 秒处`); }
    else { hooks.setCamera(shot.rig); say(`镜头切到「${shot.name}」`); }
  });

  // ---- 画幅、安全框 ----
  const aspectButtons = document.querySelectorAll<HTMLButtonElement>("[data-aspect]");
  aspectButtons.forEach((b) => b.addEventListener("click", () => {
    view.aspect = b.dataset.aspect as Aspect;
    aspectButtons.forEach((x) => x.classList.toggle("on", x === b));
    hooks.relayout();
    const [w, h] = ASPECTS[view.aspect].size4k;
    say(`画幅 ${view.aspect}：成片 ${w}×${h}`);
  }));
  const safeButton = $<HTMLButtonElement>("safe-toggle");
  safeButton.addEventListener("click", () => { view.safeFrame = !view.safeFrame; safeButton.classList.toggle("on", view.safeFrame); hooks.relayout(); });

  // ---- 音频 ----
  const audioFile = $<HTMLInputElement>("audio-file");
  $("audio-import").addEventListener("click", () => audioFile.click());
  audioFile.addEventListener("change", async () => {
    const file = audioFile.files?.[0];
    if (!file) return;
    try {
      await timeline.attachAudio(URL.createObjectURL(file));
      view.audio = file;
      $("audio-name").textContent = file.name;
      say("音频已接到时间线：播放时间线时会同步播放");
    } catch (e) { say(`音频导入失败：${(e as Error).message}`); }
    audioFile.value = "";
  });

  // ---- 时间线文件 ----
  const tlSelect = $<HTMLSelectElement>("tl-select");
  void timeline.list().then((items) => {
    const names = items.map((i) => i.name);
    if (!names.includes(timeline.name)) names.unshift(timeline.name);
    tlSelect.replaceChildren(...names.map((n) => new Option(n, n, false, n === timeline.name)));
  }).catch(() => undefined);
  $("tl-open").addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("timeline", tlSelect.value);
    location.href = url.toString(); // 换时间线需要重新打开页面（改动已自动保存）
  });
  $("tl-saveas").addEventListener("click", async () => {
    const name = $<HTMLInputElement>("tl-saveas-name").value.trim();
    if (!name) return say("先填新时间线的名字");
    await timeline.saveAs(name);
    say(`已另存为「${name}」，在上面的列表里选它再点「打开」`);
  });

  /** 定时刷新：保存状态、跟随开关（开关也可能被别处改掉，比如在画面上拖动会把镜头切回手动） */
  const refresh = () => {
    syncLinks();
    $("tl-autosave").textContent = `${timeline.position().toFixed(1)} / ${timeline.length().toFixed(1)} 秒 · ${timeline.status()}`;
    playButton.textContent = timeline.playing() ? "❚❚ 暂停时间线" : "▶ 播放时间线";
  };
  return { refresh, say };
}
