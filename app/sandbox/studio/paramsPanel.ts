import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import { LUTCubeLoader } from "three/examples/jsm/loaders/LUTCubeLoader.js";
import type * as THREE from "three/webgpu";
import { defaultParams, GROUP_LABELS, PARAMS, params, assignParams, type ParamDef, type ParamGroup, type ParamKey } from "./params";
import type { Presets } from "./presets";

/**
 * 左侧「画面参数」面板：
 * - 上面是预设：选一个 → 载入；A/B 和载入前对比；另存为；删除；全部恢复默认
 * - 下面按参数表（params/schema.ts）自动生成分组，常用的在前，默认都折叠；
 *   组标题上显示"改了几项"，改过的参数左边有一道橙色标记，每组最后有「本组恢复默认」
 * 面板只改 params，画面由 scene/createSandbox.ts 每帧读 params 更新；时间线、载入预设改了参数，面板会自动跟着刷新。
 */

/** lil-gui 控件里本工程用到的部分（它自带的泛型类型对"按键名循环添加"太严格） */
type Ctl = { name(n: string): Ctl; listen(): Ctl; enable(on?: boolean): Ctl; disable(): Ctl; onChange(f: () => void): Ctl; domElement: HTMLElement };
const add = (folder: GUI, obj: object, key: string, ...args: unknown[]) => (folder.add as unknown as (...a: unknown[]) => Ctl)(obj, key, ...args);

type LutSetter = (lut: { texture3D: THREE.Data3DTexture; size: number } | null) => void;

/** onUserChange：用户在面板上改了某个参数（跟随时间线时要写进时间线） */
export function bindParamsPanel(presets: Presets, onUserChange: (key: ParamKey, value: number | boolean) => void, setLut: LutSetter) {
  const host = document.createElement("div");
  host.id = "params-panel";
  host.innerHTML = `
    <div class="pp-head"><b>画面参数</b><button class="pp-fold" title="收起 / 展开">−</button></div>
    <div class="pp-body">
      <div class="pp-presets">
        <div class="pp-label">预设（存在工程 presets/ 里，团队共享）</div>
        <div class="pp-row"><select class="pp-select"></select><button data-act="load">载入</button><button data-act="swap" title="和载入前的画面来回切换">A/B</button></div>
        <div class="pp-row"><button data-act="save">另存为…</button><button data-act="remove">删除</button><button data-act="reset">全部恢复默认</button></div>
        <div class="pp-status"></div>
      </div>
      <div class="pp-gui"></div>
    </div>`;
  document.body.appendChild(host);
  const $ = <T extends HTMLElement>(sel: string) => host.querySelector(sel) as T;
  const select = $<HTMLSelectElement>(".pp-select"), statusEl = $<HTMLDivElement>(".pp-status");
  const status = (text: string) => { statusEl.textContent = text; };

  // ---- 收起 / 展开整个面板 ----
  const foldButton = $<HTMLButtonElement>(".pp-fold");
  const setFolded = (folded: boolean) => { host.classList.toggle("folded", folded); foldButton.textContent = folded ? "+" : "−"; };
  foldButton.addEventListener("click", () => setFolded(!host.classList.contains("folded")));
  if (window.innerWidth < 1100) setFolded(true); // 窗口窄时默认收起，不和右侧面板挤在一起

  // ---- 预设 ----
  const allKeys = Object.keys(PARAMS) as ParamKey[];
  const notifyAll = () => { for (const k of allKeys) onUserChange(k, params[k]); };
  const refreshList = async (pick: string) => {
    let names: string[] = [];
    try { names = (await presets.list()).map((p) => p.name); } catch { status("预设服务没有运行：请用 npm run dev 打开（双击启动的离线包只能临时调参，不能存预设）"); }
    select.replaceChildren(...names.map((n) => new Option(n, n, false, n === pick)));
  };
  void refreshList("");
  const actions: Record<string, () => Promise<void> | void> = {
    async load() {
      if (!select.value) return status("还没有预设");
      try { await presets.load(select.value); notifyAll(); status(`已载入「${select.value}」· 点 A/B 可和载入前对比`); } catch (e) { status(`载入失败：${(e as Error).message}`); }
    },
    swap() {
      const shown = presets.swap();
      if (shown) notifyAll();
      status(shown ? `现在显示：${shown === "载入前" ? "A（载入前）" : "B（载入后）"}` : "先载入一个预设，才能和载入前对比");
    },
    async save() {
      const name = prompt("预设名字（同名会覆盖）：", select.value || "")?.trim();
      if (!name) return;
      try { await presets.save(name); status(`已保存「${name}」`); await refreshList(name); } catch (e) { status(`保存失败：${(e as Error).message}`); }
    },
    async remove() {
      if (!select.value || !confirm(`删除预设「${select.value}」？`)) return;
      try { await presets.remove(select.value); status(`已删除「${select.value}」`); await refreshList(""); } catch (e) { status(`删除失败：${(e as Error).message}`); }
    },
    reset() { assignParams(defaultParams()); notifyAll(); status("全部参数已恢复默认（画面模式、时刻、天气不变）"); },
  };
  host.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => b.addEventListener("click", () => void actions[b.dataset.act!]()));

  // ---- 参数分组 ----
  const gui = new GUI({ container: $(".pp-gui"), title: "参数", width: 300 });
  gui.domElement.classList.add("pp-root");
  const defaults = defaultParams();
  const folders = {} as Record<ParamGroup, GUI>;
  const groupKeys = {} as Record<ParamGroup, ParamKey[]>;
  for (const group of Object.keys(GROUP_LABELS) as ParamGroup[]) {
    folders[group] = gui.addFolder(GROUP_LABELS[group]);
    folders[group].close();
    groupKeys[group] = [];
  }
  const controllers: Partial<Record<ParamKey, Ctl>> = {};
  for (const [key, def] of Object.entries(PARAMS) as [ParamKey, ParamDef][]) {
    const folder = folders[def.group];
    const c = def.kind === "number" ? add(folder, params, key, def.min, def.max, def.step) : add(folder, params, key);
    c.name(def.label).listen();
    c.onChange(() => onUserChange(key, params[key]));
    if (def.hint) c.domElement.title = def.hint;
    controllers[key] = c;
    groupKeys[def.group].push(key);
  }

  // ---- 3D LUT（只在本次打开页面期间有效；成片按当时载入的 LUT 渲染） ----
  const lutInput = document.createElement("input");
  lutInput.type = "file";
  lutInput.accept = ".cube";
  lutInput.addEventListener("change", async () => {
    const file = lutInput.files?.[0];
    if (!file) return;
    try {
      setLut(new LUTCubeLoader().parse(await file.text()));
      lutUi.lut = file.name;
      status(`已载入 LUT「${file.name}」（用「LUT 强度」调深浅）`);
    } catch (e) { status(`LUT 读取失败：${(e as Error).message}`); }
    lutInput.value = "";
  });
  const lutUi = { lut: "无", load: () => lutInput.click(), clear: () => { setLut(null); lutUi.lut = "无"; status("已去掉 LUT"); } };
  add(folders.post, lutUi, "lut").name("当前 LUT").listen().disable();
  add(folders.post, lutUi, "load").name("导入 LUT（.cube）");
  add(folders.post, lutUi, "clear").name("去掉 LUT");

  // ---- 每组最后：本组恢复默认 ----
  for (const group of Object.keys(folders) as ParamGroup[]) {
    const reset = { run: () => {
      assignParams(Object.fromEntries(groupKeys[group].map((k) => [k, defaults[k]])));
      for (const k of groupKeys[group]) onUserChange(k, params[k]);
      status(`「${GROUP_LABELS[group]}」已恢复默认`);
    } };
    add(folders[group], reset, "run").name("本组恢复默认").domElement.classList.add("pp-reset");
  }

  /** 定时刷新（约每半秒）：组标题上的"改了几项"、改过的参数标记、太阳方位是否可调 */
  const refresh = () => {
    for (const group of Object.keys(folders) as ParamGroup[]) {
      let changed = 0;
      for (const k of groupKeys[group]) {
        const isChanged = params[k] !== defaults[k];
        if (isChanged) changed += 1;
        controllers[k]?.domElement.classList.toggle("pp-changed", isChanged);
      }
      folders[group].title(changed ? `${GROUP_LABELS[group]} · 改了 ${changed} 项` : GROUP_LABELS[group]);
    }
    // 太阳方位、高度只在"手动"时有意义
    controllers.sunAzimuth?.enable(params.sunManual);
    controllers.sunElevation?.enable(params.sunManual);
  };
  refresh();

  return { gui, folders, refreshPresets: refreshList, refresh };
}
