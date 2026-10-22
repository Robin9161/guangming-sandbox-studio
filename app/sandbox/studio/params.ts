/**
 * 统一参数表：画面上所有可调的美术参数都在这里登记（名字、分组、范围、默认值）。
 *
 * - 实时调参面板（studio/paramsPanel.ts）、预设（studio/presets.ts）、时间线关键帧（studio/timeline.ts）都从这张表生成
 * - 大多数参数是"倍数"：在一天的自动配色（scene/artPalette.ts、scene/atmosphere.ts）算出来的值上再乘，默认 1 = 不改变
 * - 改默认值之前先读 docs/美术风格与设计规范.md：默认值就是规范认可的画面
 * - 图层显隐（建筑、树、道路……）仍由右侧面板「图层」控制，不在这张表里
 */

export type ParamGroup = "time" | "light" | "fog" | "water" | "night" | "weather" | "post" | "labels";

/** 分组和它们在面板里的顺序（常用的在前） */
export const GROUP_LABELS: Record<ParamGroup, string> = {
  light: "太阳与灯光",
  fog: "雾",
  night: "夜景",
  weather: "天气",
  water: "水",
  time: "时间与天空",
  post: "后期与镜头效果",
  labels: "画面里的地名标签",
};

type NumberDef = { kind: "number"; label: string; group: ParamGroup; min: number; max: number; step: number; default: number; hint?: string };
type BoolDef = { kind: "boolean"; label: string; group: ParamGroup; default: boolean; hint?: string };
export type ParamDef = NumberDef | BoolDef;

const num = (group: ParamGroup, label: string, def: number, min: number, max: number, step = 0.01, hint?: string): NumberDef => ({ kind: "number", group, label, default: def, min, max, step, hint });
const bool = (group: ParamGroup, label: string, def: boolean, hint?: string): BoolDef => ({ kind: "boolean", group, label, default: def, hint });

export const PARAMS = {
  // ---- 时间与天空 ----
  timeSpeed: num("time", "时间流速 ×", 1, 0, 10, 0.1, "光影模式播放时一天走多快（1 = 约 4 分钟一天）"),
  skyChroma: num("time", "天空彩度 ×", 1, 0, 2, 0.01, "光影模式下天空和远雾的颜色浓淡（规范 P3：浓烈只给天空）"),
  stars: num("time", "星星 ×", 1, 0, 3),

  // ---- 太阳与灯光 ----
  sunIntensity: num("light", "阳光强度 ×", 1, 0, 3),
  skyLight: num("light", "天光强度 ×", 1, 0, 3, 0.01, "半球光：天空和地面反光"),
  sunManual: bool("light", "太阳方向手动", false, "打开后太阳方向不再跟着时刻走"),
  sunAzimuth: num("light", "太阳方位°", 225, 0, 360, 1, "0 = 北，90 = 东，180 = 南，270 = 西"),
  sunElevation: num("light", "太阳高度°", 35, 1, 89, 1),
  fillLight: num("light", "补光强度", 0, 0, 3, 0.01, "从太阳对面打来的柔和补光，照亮阴影面"),
  rimLight: num("light", "轮廓光强度", 0, 0, 5, 0.01, "从镜头对面打来的逆光，勾出楼和山的边缘"),
  spotIntensity: num("light", "聚光灯强度", 0, 0, 10, 0.01, "从高处照亮镜头焦点一带（重点区域），有雾时能看到光柱"),
  spotRadius: num("light", "聚光灯范围 m", 600, 50, 4000, 10),
  spotHeight: num("light", "聚光灯高度 m", 2500, 300, 8000, 10),
  spotWarmth: num("light", "聚光灯冷暖", 0.3, -1, 1, 0.01, "-1 冷蓝，0 白，1 暖黄"),

  // ---- 雾 ----
  fogAmount: num("fog", "体积雾浓度 ×", 1, 0, 4, 0.01, "规范：雾平时不出现，只在讲风的那一拍和手动选「雾」天气时出现"),
  fogHeight: num("fog", "雾层高度 ×", 1, 0.3, 4),
  hazeAmount: num("fog", "远景雾 ×", 1, 0, 3, 0.01, "光影模式下远处溶进地平线色的程度（规范 P2）"),
  sunFog: num("fog", "太阳照雾 ×", 1, 0, 4, 0.01, "逆光时雾被照透的亮度"),

  // ---- 水 ----
  waterWave: num("water", "水波 ×", 1, 0, 4),
  waterReflection: num("water", "倒影 ×", 1, 0, 2),
  waterDepth: num("water", "深浅对比 ×", 1, 0, 2, 0.01, "塘 / 湖 / 水库的深浅差（规范 P11）"),

  // ---- 夜景 ----
  windowShare: num("night", "亮灯比例 ×", 1, 0, 3, 0.01, "规范 P6：只有高楼成排亮，不要亮成一片"),
  windowBrightness: num("night", "窗灯亮度 ×", 1, 0, 3),
  landmarkGlow: num("night", "地标夜光 ×", 1, 0, 3),
  streetLights: num("night", "路灯 ×", 1, 0, 3, 0.01, "路面的冷白路灯光和道路上的暖色光点"),
  showStreetLights: bool("night", "近处路灯光点", true, "镜头近时主干道两侧的暖色小光点（远处的城市光点一直都有）"),

  // ---- 天气 ----
  rainAmount: num("weather", "雨量 ×", 1, 0, 3, 0.01, "规范 P9：雨要克制"),
  snowAmount: num("weather", "雪量 ×", 1, 0, 3),
  lightning: bool("weather", "雷暴闪电", true, "只在夜里的雷暴中出现"),

  // ---- 后期 ----
  exposure: num("post", "曝光", 1, 0.3, 2.5),
  grade: num("post", "调色强度 ×", 1, 0, 2, 0.01, "光影模式的全局调色"),
  saturation: num("post", "饱和度 ×", 1, 0, 2),
  ao: num("post", "环境光遮蔽 ×", 1, 0, 2, 0.01, "楼与地面接缝处的柔和暗部（微缩质感）"),
  tilt: num("post", "移轴虚化 ×", 1, 0, 3),
  tiltCenter: num("post", "移轴清晰带位置", 0.52, 0.2, 0.8, 0.01, "0 = 画面底部，1 = 顶部；默认略高于画面中心"),
  tiltWidth: num("post", "移轴清晰带宽度 ×", 1, 0.3, 3),
  vignette: num("post", "暗角 ×", 1, 0, 3),
  bloom: num("post", "泛光 ×", 1, 0, 4),
  dofAmount: num("post", "景深强度", 0, 0, 4, 0.01, "0 = 关。真实的镜头虚化：离对焦距离越远越虚（和移轴虚化可以叠加）"),
  dofFocusOffset: num("post", "对焦偏移 m", 0, -5000, 5000, 1, "默认对在镜头焦点上；打关键帧可以做对焦转移"),
  dofRange: num("post", "清晰范围 m", 600, 20, 8000, 1, "对焦距离前后多远以内保持清楚"),
  lutAmount: num("post", "LUT 强度", 1, 0, 1, 0.01, "导入 3D LUT（.cube）后生效"),

  // ---- 画面里的地名标签 ----
  showLabels: bool("labels", "显示地名标签", true, "画在画面里的地名（成片里也有）；出成片不想要就关掉"),
  showLabelDistricts: bool("labels", "片区", true),
  showLabelLandmarks: bool("labels", "地标", true),
  showLabelRoutes: bool("labels", "河湖道路", true),
  showLabelStations: bool("labels", "地铁 / 高铁站", false),
  labelSize: num("labels", "大小 ×", 1, 0.4, 2.5),
} satisfies Record<string, ParamDef>;

export type ParamKey = keyof typeof PARAMS;
export type ParamValues = { [K in ParamKey]: (typeof PARAMS)[K]["default"] };

export const defaultParams = (): ParamValues => Object.fromEntries(Object.entries(PARAMS).map(([k, d]) => [k, d.default])) as ParamValues;

/** 所有参数的当前值（全局唯一一份；面板、预设、时间线都改它，场景每帧读它） */
export const params: ParamValues = defaultParams();

/** 用一份（可能不完整、可能来自旧版本的）参数覆盖当前值：只接受表里有的键和类型对得上的值 */
export function assignParams(values: Partial<Record<string, unknown>>) {
  for (const [key, def] of Object.entries(PARAMS) as [ParamKey, ParamDef][]) {
    const v = values[key];
    if (def.kind === "number" && typeof v === "number" && Number.isFinite(v)) (params as Record<string, unknown>)[key] = Math.min(def.max, Math.max(def.min, v));
    if (def.kind === "boolean" && typeof v === "boolean") (params as Record<string, unknown>)[key] = v;
  }
}
