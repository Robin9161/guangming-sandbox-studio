import * as THREE from "three/webgpu";
import { getProject, types, val, type IProject, type ISheet } from "@theatre/core";
import studioImport from "@theatre/studio";
import { store } from "./store";
import { MOODS } from "../scene/artPalette";
import { WEATHER_NAMES, type WeatherKind } from "../scene/weather";
import { assignParams, PARAMS, type ParamDef, type ParamKey } from "./params";
import { applyRig, EASES, MOVE_TYPES, rigFromCamera, type MoveValues, type RigValues } from "./moves";
import { PATHS, type Paths } from "./paths";
import type { LookControl } from "./presets";

/**
 * 时间线（Theatre.js）：镜头、运镜模板、时刻与天气、全部美术参数都能打关键帧。
 *
 * - 编辑：页面上的 Theatre 编辑器（右侧面板「打开时间线编辑器」）。在属性名上右键 →「Sequence」就能给它打关键帧
 * - 存档：工程里 timelines/<名字>.json，改动后自动保存，跟着 git 给团队共享；地址栏 ?timeline=名字 打开另一条
 * - 三个"跟随"开关决定哪些东西听时间线的：镜头、时刻与天气、画面参数。关掉就回到手动控制
 * - 渲染成片时按时间逐帧取值（evaluate(t)），和播放快慢无关，可以逐帧复现
 *
 * Theatre.js 只在本模块里出现：以后要换别的时间线工具，只需要重写这个文件。
 * 每个区一个工程（光明沿用「光明沙盘」），不同区的关键帧互不干扰。
 */
const district = new URLSearchParams(location.search).get("district") ?? "guangming";
export const PROJECT_ID = district === "guangming" ? "光明沙盘" : `沙盘·${district}`;
// @theatre/studio 是 CommonJS 包，经 Vite 转换后默认导出有时还包着一层 default
const studio = ((studioImport as unknown as { default?: typeof studioImport }).default ?? studioImport) as typeof studioImport;
// 一导入就初始化（Theatre 要求尽早初始化，否则会在控制台报警告）。
// 不用浏览器本地存储：时间线只以工程里的文件为准（否则两边不一致时 Theatre 会弹窗让人选）
studio.initialize({ usePersistentStorage: false });
studio.ui.hide();
const SHEET_ID = "镜头";

/** 时间线文件（timelines/*.json）的内容 */
export type TimelineFile = {
  savedAt: string;
  /** Theatre.js 的工程状态（关键帧都在这里） */
  theatre: Record<string, unknown> | null;
  /** 哪些东西跟随时间线 */
  links: TimelineLinks;
};
export type TimelineLinks = { camera: boolean; look: boolean; params: boolean };

const num = (def: number, label: string, range: [number, number], nudge = 1) => types.number(def, { label, range, nudgeMultiplier: nudge });
const pick = (def: string, options: Record<string, string>, label: string) => types.stringLiteral(def, options, { label, as: "menu" });

/** 改代码热更新时场景会重建、再定义一次这些对象（默认值跟着镜头变）：允许覆盖，否则 Theatre 会报错 */
const RECONFIGURE = { reconfigure: true } as const;

/** 时间线上的四个对象（属性的名字、范围、默认值） */
function defineObjects(sheet: ISheet, rig: RigValues) {
  const rigObj = sheet.object("镜头装置", {
    targetX: num(rig.targetX, "焦点 东西 m", [-30000, 30000], 10),
    targetY: num(rig.targetY, "焦点 高度 m", [-200, 2000], 1),
    targetZ: num(rig.targetZ, "焦点 南北 m", [-30000, 30000], 10),
    distance: num(rig.distance, "距离 m", [50, 80000], 10),
    azimuth: num(rig.azimuth, "方位°", [-720, 720], 1),
    elevation: num(rig.elevation, "俯角°", [1, 89.9], 0.5),
    fov: num(rig.fov, "视角°", [8, 90], 0.5),
  }, RECONFIGURE);
  const moveObj = sheet.object("运镜模板", {
    type: pick("none", MOVE_TYPES, "运动"),
    start: num(0, "开始 秒", [0, 600], 0.1),
    duration: num(5, "时长 秒", [0.1, 600], 0.1),
    amount: num(45, "幅度", [-5000, 5000], 1),
    ease: pick("inOut", EASES, "缓动"),
    path: pick("maozhou", PATHS, "路径"),
    height: num(450, "路径 高度 m", [20, 5000], 5),
    lookAhead: num(900, "路径 前看 m", [50, 6000], 10),
    offset: num(0, "路径 偏右 m", [-3000, 3000], 5),
  }, RECONFIGURE);
  const moodOptions = Object.fromEntries([["auto", "每天随机"], ...MOODS.map((m, i) => [String(i), m.name])]) as Record<string, string>;
  const weatherOptions = { auto: "自动", ...WEATHER_NAMES } as Record<"auto" | WeatherKind, string>;
  const lookObj = sheet.object("时刻与天气", {
    mode: pick("art", { art: "光影（连续的一天）", day: "白天", night: "夜晚" }, "画面模式"),
    hour: num(17.4, "时刻", [0, 24], 0.05),
    mood: pick("auto", moodOptions, "日出日落氛围"),
    weather: pick("clear", weatherOptions, "天气"),
  }, RECONFIGURE);
  const paramProps = Object.fromEntries((Object.entries(PARAMS) as [ParamKey, ParamDef][]).map(([key, d]) => [
    key,
    d.kind === "number" ? types.number(d.default, { label: d.label, range: [d.min, d.max], nudgeMultiplier: d.step }) : types.boolean(d.default, { label: d.label }),
  ]));
  const paramsObj = sheet.object("画面参数", paramProps, RECONFIGURE);
  return { rigObj, moveObj, lookObj, paramsObj };
}
type Objects = ReturnType<typeof defineObjects>;

type Refs = {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  look: LookControl;
  paths: Paths;
};

export async function createTimeline(refs: Refs) {
  const name = new URLSearchParams(location.search).get("timeline") || (district === "guangming" ? "默认" : `${district}·默认`);
  let file: TimelineFile | null = null;
  try { file = await store.get<TimelineFile>("timelines", name); } catch { /* 新的时间线 */ }
  const project = getProject(PROJECT_ID, file?.theatre ? { state: file.theatre } : {});
  await project.ready;
  const sheet = project.sheet(SHEET_ID);
  const objects = defineObjects(sheet, rigFromCamera(refs.camera, refs.target));
  const links: TimelineLinks = file?.links ?? { camera: false, look: false, params: false };

  // ---- 自动保存：状态有变化就写回 timelines/<名字>.json ----
  // 判断"有没有改动"只看关键帧、属性值和跟随开关，不看 Theatre 的编辑历史 ID：
  // 编辑历史每个页面各不相同，比它的话几个打开着的页面会以为有改动、轮流覆盖保存
  const changeKey = (c: { theatre: Record<string, unknown> | null; links: TimelineLinks } | null) => JSON.stringify(c ? { sheets: c.theatre?.sheetsById ?? null, links: c.links } : null);
  let lastSaved = changeKey(file ? { theatre: file.theatre, links: file.links } : null);
  let saveStatus = file ? `已载入时间线「${name}」` : `新时间线「${name}」（有改动后自动保存）`;
  const contentNow = () => ({ theatre: studio.createContentOfSaveFile(PROJECT_ID), links: { ...links } });
  const saveIfChanged = async () => {
    const content = contentNow();
    const text = changeKey(content);
    if (text === lastSaved) return;
    lastSaved = text;
    try { await store.save("timelines", name, { savedAt: new Date().toISOString(), ...content }); saveStatus = `已自动保存 ${new Date().toLocaleTimeString()}`; } catch (e) { saveStatus = (e as Error).message === "HTTP 404" ? "没有存档服务，时间线不会保存（双击启动的离线包只能看；保存请用 npm run dev 打开）" : `保存失败：${(e as Error).message}`; }
  };
  window.setInterval(saveIfChanged, 2000);

  /** 用某一组时间线对象，在时间 t 时把值写进镜头、时刻与天气、参数 */
  const applyFrom = (objs: Objects, sheetRef: ISheet, t: number | null, l: TimelineLinks) => {
    if (t !== null) sheetRef.sequence.position = t;
    const time = t ?? sheetRef.sequence.position;
    if (l.camera) applyRig(refs.camera, objs.rigObj.value as RigValues, objs.moveObj.value as unknown as MoveValues, time, refs.paths, refs.target);
    if (l.look) {
      const v = objs.lookObj.value;
      // 时刻由时间线决定（playing = false）
      refs.look.set({ art: v.mode === "art", night: v.mode === "night", hour: v.hour, moodChoice: v.mood === "auto" ? null : Number(v.mood), playing: false });
      if (refs.look.getWeather() !== v.weather) refs.look.setWeather(v.weather as "auto" | WeatherKind);
    }
    if (l.params) assignParams(objs.paramsObj.value as Record<string, unknown>);
  };

  /**
   * 渲染旧任务时，任务里记的时间线和当前的不一样：另建一个只用来取值的工程（在编辑器的大纲里会多一项，可以忽略）。
   * 只比较关键帧和属性值（sheetsById），不比较编辑历史。同样的内容只建一次。
   */
  const keyOf = (theatre: Record<string, unknown> | null) => JSON.stringify(theatre?.sheetsById ?? null);
  const temps = new Map<string, { objs: Objects; sheet: ISheet }>();
  const evaluatorFor = async (content: { theatre: Record<string, unknown> | null; links: TimelineLinks }) => {
    const key = keyOf(content.theatre);
    if (key === keyOf(contentNow().theatre)) return (t: number) => applyFrom(objects, sheet, t, content.links);
    let temp = temps.get(key);
    if (!temp) {
      const p = getProject(`${PROJECT_ID}·渲染用${temps.size + 1}`, content.theatre ? { state: content.theatre } : {});
      await p.ready;
      const tempSheet = p.sheet(SHEET_ID);
      temp = { objs: defineObjects(tempSheet, rigFromCamera(refs.camera, refs.target)), sheet: tempSheet };
      temps.set(key, temp);
    }
    const { objs, sheet: tempSheet } = temp;
    return (t: number) => applyFrom(objs, tempSheet, t, content.links);
  };

  /** 把参数面板、右侧面板上的手动改动写进时间线（跟随时间线时，否则下一帧会被时间线的值盖掉） */
  const writeParam = (key: ParamKey, value: number | boolean) => {
    if (!links.params) return;
    studio.transaction(({ set }) => set((objects.paramsObj.props as unknown as Record<string, never>)[key], value as never));
  };
  const writeLook = () => {
    if (!links.look) return;
    const s = refs.look.get();
    studio.transaction(({ set }) => set(objects.lookObj.props, { mode: s.art ? "art" : s.night ? "night" : "day", hour: s.hour, mood: s.moodChoice === null ? "auto" : String(s.moodChoice), weather: refs.look.getWeather() }));
  };
  /** 把当前视角写进镜头装置（属性已打关键帧时，就在播放头位置记一个关键帧） */
  const writeCamera = (rig?: RigValues) => {
    const values = rig ?? rigFromCamera(refs.camera, refs.target);
    studio.transaction(({ set }) => set(objects.rigObj.props, values));
  };

  /** 设置运镜模板（不打关键帧，模板自己按开始时间、时长播放） */
  const writeMove = (values: Partial<MoveValues>) => {
    // 整个对象一起写时 Theatre 要求所有属性都给全，所以和当前值合并
    studio.transaction(({ set }) => set(objects.moveObj.props, { ...(objects.moveObj.value as object), ...values } as never));
  };

  return {
    name,
    project: project as IProject,
    sheet,
    objects,
    links,
    status: () => saveStatus,
    /** 每帧（实时预览）：按当前播放头取值 */
    apply: () => applyFrom(objects, sheet, null, links),
    evaluatorFor,
    content: contentNow,
    length: () => val(sheet.sequence.pointer.length),
    position: () => sheet.sequence.position,
    writeParam,
    writeLook,
    writeCamera,
    writeMove,
    /** 播放 / 暂停时间线（从当前位置播到结尾）；返回是否在播 */
    togglePlay: () => {
      if (val(sheet.sequence.pointer.playing)) { sheet.sequence.pause(); return false; }
      if (sheet.sequence.position >= val(sheet.sequence.pointer.length) - 1e-3) sheet.sequence.position = 0;
      void sheet.sequence.play();
      return true;
    },
    playing: () => val(sheet.sequence.pointer.playing),
    moveValues: () => objects.moveObj.value as unknown as MoveValues,
    saveAs: async (newName: string) => { await store.save("timelines", newName, { savedAt: new Date().toISOString(), ...contentNow() }); },
    list: () => store.list("timelines"),
    ui: studio.ui,
    attachAudio: (url: string) => sheet.sequence.attachAudio({ source: url }),
  };
}

export type Timeline = Awaited<ReturnType<typeof createTimeline>>;
