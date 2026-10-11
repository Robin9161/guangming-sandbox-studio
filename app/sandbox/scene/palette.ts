// 低多边形马卡龙风格的统一调色板与尺度参数，调风格只改这里。

/**
 * 分段高程夸张（建筑不夸张）：
 * 低处城区约 1.6×，避免把残余小起伏放大；60m 以上逐渐加到约 2.4×（3.2× 时山体过陡）。
 */
export function exaggerate(elevation: number) {
  const k = 15;
  const x = (elevation - 60) / k;
  const softplus = x > 30 ? x : Math.log1p(Math.exp(x));
  return 1.6 * elevation + 0.8 * k * softplus;
}
export const TERRAIN_SPACING = 60; // 低多边形地形网格间距（米）

export const sky = { top: "#8fd0f5", bottom: "#e4f4ff", fog: "#e4f4ff" };

export const ground = {
  urban: "#efe5cf",
  park: "#b5d68e",
  // 按高程分阶的山体绿（米，未夸张）
  hills: [
    { above: 55, color: "#a9cf86" },
    { above: 100, color: "#93c274" },
    { above: 160, color: "#7fb365" },
    { above: 230, color: "#6c9f58" },
  ],
  slopeGreen: "#a9cf86",
  // 土地利用底色（只用于平地）
  landuse: {
    residential: "#f7dccb",
    industrial: "#e2e3df",
    commercial: "#eedff0",
    retail: "#eedff0",
    farmland: "#e2e9ad",
    orchard: "#d6e6a0",
    construction: "#efd9b0",
  } as Record<string, string>,
};

export const basePlate = "#f6eedf";
export const basePlateEdge = "#e8dcc5";

export const buildingColors: Record<string, string[]> = {
  residential: ["#f8f6f1", "#f3f1ec"],
  commercial: ["#f6f5f2", "#eff0f0"],
  industrial: ["#eeece7", "#e9e8e3"],
  public: ["#f8f5ee"],
  other: ["#f1efea"],
};

/** 区界外的周边环境：颜色逐渐褪成底板色，地形向模型边缘压低 */
export const context = { fadeColor: "#ebe6da", fadeDistance: 700, maxFade: 0.8, rimTaper: 1600, rimInset: 250 };
export const boundaryLine = { color: "#fffdf7", width: 38 };

export const landmarkStyle = {
  scale: 1.3,
  silver: "#dde2e8",
  greenGlass: "#2f6f58",
  stone: "#ede4d3",
  metalGrey: "#c9ced4",
  brick: "#8d4e3c",
  darkGlass: "#33475c",
  white: "#fbfbf9",
};

export const water = { area: "#7fd3e0", line: "#86d6e2", deep: "#62c3d4" };

// 沙盘比例：道路按等级放大（真实宽度的约 1.3–1.5 倍），远看时路网骨架才清楚
export const roadStyle: Record<string, { width: number; color: string }> = {
  motorway: { width: 40, color: "#6f7787" },
  trunk: { width: 32, color: "#757d8c" },
  avenue: { width: 30, color: "#7c8493" },
  primary: { width: 22, color: "#8a92a0" },
  secondary: { width: 13, color: "#9aa1ad" },
  tertiary: { width: 8, color: "#a9afb9" },
};

/** 城市主轴大道：加宽并带绿化中央分隔带，形成"林荫大道"的地标感 */
export const avenues = new Set(["光明大道", "光侨路", "观光路", "华夏路", "光明大街", "松白路", "东长路", "公明南环大道", "公明西环大道", "龙澜大道"]);
export const avenueMedian = { width: 6, color: "#8fc46f" };
/**
 * 重点高速（南光、龙大）：沙盘里抬高并加宽。OSM 标为桥梁的路段做成高架（约 12m，带双排桥墩），
 * 其余路段做成约 4m 高的路堤（斜坡侧面）——南光约 43% 是高架，龙大只有约 10%，不给它虚构桥墩。
 */
// OSM 中高速是上下行两条单向路，每条宽 26m，两条合起来约 50m
export const expressways = { names: /南光|龙大/, width: 26, viaduct: 12, embankment: 4, deck: "#5f6776", side: "#dcd8cf", pier: "#e7e3da" };

export const roadClass = (cls: string, name?: string | null) => (name && avenues.has(name) && (cls === "primary" || cls === "trunk") ? "avenue" : cls);

export const waterLineWidth: Record<string, number> = { river: 20, canal: 12, stream: 7, drain: 5 };

/** 茅洲河：光明的母亲河，沙盘里加宽并配两岸碧道绿带，作为贯穿全区的蓝绿轴线 */
export const motherRiver = { name: "茅洲河", width: 55, greenway: 130, greenwayColor: "#a9d48a", bankTreeOffset: 44 };

export const trees = { crowns: ["#7fbf5f", "#94cc6a", "#6aad55", "#a6d477"], trunk: "#9b7652" };

export const hsr = { deck: "#f5f2ec", side: "#cfd3da", tunnel: "#9aa0aa" };

export const lineNames: Record<string, string> = { "6": "6号线", "6b": "6号线支线", "13": "13号线", hsr: "高铁" };

export const night = {
  skyTop: "#060b20",
  skyBottom: "#22335f",
  moon: "#a9bcff",
  hemiSky: "#3b4f8f",
  hemiGround: "#1d2236",
  roadGlow: "#ffb25e",
  water: "#2a5878",
};
