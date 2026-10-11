/**
 * 光明区中小学地标构件库（小学 / 初中 / 高中共用）
 *
 * 数据来自 public/sandbox/landmarks/guangming-schools.json
 * （生成脚本 scripts/landmarks/guangming-schools.mjs，来源与检索日期写在 JSON 的 meta 里）。
 *
 * ── 有真实依据的部分 ──────────────────────────────────────────────
 *   · 校园范围：OSM amenity=school 真实多边形；没有的校区由锚点周边真实建筑足迹
 *     单链聚类凸包外扩 8m 推得，JSON 里标为 derived-from-real-footprints。
 *   · 校舍平面：沙盘建筑底盘（Overture Maps + OSM）的真实足迹。
 *   · 运动场：OSM leisure=pitch / track 真实多边形；OSM 没测绘的校区用
 *     scripts/landmarks/guangming-school-sports.py 从 Esri World Imagery z18 判读
 *     （status=esri-imagery），矩形位置来自影像，环形跑道按矩形外扩属示意。
 *   · 地理锚点：高德 POI（已转 WGS84），坐标与 data/hero-landmarks.json 同源。
 *
 * ── 估算 / 示意的部分 ────────────────────────────────────────────
 *   · 建筑高度：底盘按轮廓面积估算，再按「校区内没有单层教学楼」抬到最低 7.5m。
 *   · 逐层窗带、外廊挑板、屋顶设备与楼梯间、入口雨棚、跑道分道线与看台、球场划线、
 *     校门、门卫室、旗杆、校园路缘、屋面挑檐、校园绿化、校名牌。
 *   · 操场按运动类型配色（足球/田径绿、跑道砖红、篮球蓝、网球绿、排球沙黄、其他浅蓝灰）
 *     是配色约定，不是影像取色。
 *   · 学段特征色（小学蜜橘 / 初中湖蓝 / 高中藕紫）是风格选择。
 *
 * ── 唯一用到贴图的地方 ──────────────────────────────────────────
 *   校名牌。中文校名用几何体做笔画代价过大，这里把一个学段所有校名画进一张
 *   2048×2048 图集，用 1 个 Mesh 呈现（labels:false 可整体关掉）。
 *
 * 每个学段模块合并后 ≤13 个 Mesh（实测小学 11 / 初中 12 / 高中 13）。
 * 三角面预算是「单个校区 ≤2 万面」，不是全学段合计：单校中位 2.5k、最大 12.5k 面。
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";
import type { LandmarkContext } from "./_landmark-kit";
import rawData from "../../../public/sandbox/landmarks/guangming-schools.json";

export type Pt = [number, number];
export type SchoolTier = "小学" | "初中" | "高中";

export type SchoolBuilding = { ring: Pt[]; h: number; area: number; heightStatus: string };
export type SchoolSport = {
  kind: "field" | "court";
  sport: string | null;
  ring: Pt[];
  area: number;
  status: string;
  length: number;
  width: number;
  rect: { w: number; h: number; angleDeg: number };
  hasTrack?: boolean;
  trackRect?: { cx: number; cz: number; long: number; short: number; angleDeg: number };
};
export type SchoolCampus = {
  id: string;
  name: string;
  aliases: string[];
  tier: SchoolTier;
  stages: SchoolTier[];
  anchor: Pt;
  /** 高德 POI 点（通常落在校门口） */
  poiAnchor: Pt;
  /** 实际用来定校门的点：有 POI 就是 POI，只有 OSM 轮廓时是离道路最近的轮廓顶点 */
  gateAnchor?: Pt;
  gateNote?: string;
  osmId: number | null;
  osmName: string | null;
  matchHow: string;
  outline: Pt[];
  outlineStatus: string;
  outlineNote?: string;
  buildings: SchoolBuilding[];
  buildingsNote?: string;
  sports: SchoolSport[];
  track: { outer: Pt[]; inner: Pt[]; status: string } | null;
};
export type SchoolData = { meta: Record<string, unknown>; campuses: SchoolCampus[] };

export const SCHOOL_DATA = rawData as unknown as SchoolData;
export const SCHOOL_CAMPUSES: SchoolCampus[] = SCHOOL_DATA.campuses;

/** 学段特征色：小学蜜橘、初中湖蓝、高中藕紫（风格选择，不是建筑实测色） */
export const TIER_ACCENT: Record<SchoolTier, string> = {
  小学: "#f0b183",
  初中: "#93bcd8",
  高中: "#a99ccb",
};

/** 操场配色：按 OSM sport 标签 / 判读结果分色，保留操场的颜色信息 */
export const SPORT_COLOR: Record<string, { color: string; roughness: number }> = {
  field: { color: "#a9cf8e", roughness: 0.85 }, // 足球场 / 田径内场 草绿
  track: { color: "#d98f74", roughness: 0.8 }, // 塑胶跑道 砖红
  line: { color: "#fbfbf9", roughness: 0.7 }, // 场地白线
  courtBasketball: { color: "#6fa8c8", roughness: 0.78 }, // 篮球 蓝
  courtTennis: { color: "#8fbf8a", roughness: 0.78 }, // 网球 绿
  courtVolleyball: { color: "#e2b86a", roughness: 0.78 }, // 排球 沙黄
  courtBadminton: { color: "#9fc9c0", roughness: 0.78 }, // 羽毛球 青
  courtPlain: { color: "#c3d5e6", roughness: 0.8 }, // 未标注 浅蓝灰
};

/** 与沙盘统一的主色，全部来自 app/sandbox/scene/palette.ts 的 landmarkStyle */
type Key =
  | "white" | "silver" | "stone" | "glass" | "accent" | "leaf" | "wood"
  | "flagRed" | "flagYellow"
  | "field" | "track" | "line"
  | "courtBasketball" | "courtTennis" | "courtVolleyball" | "courtBadminton" | "courtPlain";
const BASE: Record<Key, { color: string; roughness: number; metalness?: number }> = {
  white: { color: "#fbfbf9", roughness: 0.72 },
  silver: { color: "#dde2e8", roughness: 0.55 },
  stone: { color: "#ede4d3", roughness: 0.8 },
  glass: { color: "#33475c", roughness: 0.4, metalness: 0.15 },
  accent: { color: "#f0b183", roughness: 0.6 },
  leaf: { color: "#85ad91", roughness: 0.85 },
  // 五星红旗：按 GB 12982 标准色
  flagRed: { color: "#de2910", roughness: 0.75 },
  flagYellow: { color: "#ffde00", roughness: 0.7 },
  wood: { color: "#bc9266", roughness: 0.75 },
  field: SPORT_COLOR.field,
  track: SPORT_COLOR.track,
  line: SPORT_COLOR.line,
  courtBasketball: SPORT_COLOR.courtBasketball,
  courtTennis: SPORT_COLOR.courtTennis,
  courtVolleyball: SPORT_COLOR.courtVolleyball,
  courtBadminton: SPORT_COLOR.courtBadminton,
  courtPlain: SPORT_COLOR.courtPlain,
};
const KEYS = Object.keys(BASE) as Key[];

/** 按 sport 标签挑球场材质 */
function courtKey(sport: string | null): Key {
  const s = (sport ?? "").toLowerCase();
  if (s.includes("basket")) return "courtBasketball";
  if (s.includes("tennis")) return "courtTennis";
  if (s.includes("volley")) return "courtVolleyball";
  if (s.includes("badminton") || s.includes("table_tennis")) return "courtBadminton";
  return "courtPlain";
}

function makeMaterials(tier: SchoolTier) {
  const materials = {} as Record<Key, THREE.MeshStandardMaterial>;
  for (const key of KEYS) {
    const spec = key === "accent" ? { ...BASE.accent, color: TIER_ACCENT[tier] } : BASE[key];
    materials[key] = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0,
      side: THREE.DoubleSide,
    });
  }
  glowColor(materials.glass, "#ffe2b0", 1.0);
  return materials;
}

type Batches = Record<Key, THREE.BufferGeometry[]>;
const emptyBatches = (): Batches => {
  const out = {} as Batches;
  for (const key of KEYS) out[key] = [];
  return out;
};

function push(batches: Batches, key: Key, geometry: THREE.BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute("uv");
  batches[key].push(flat);
}

/** 环 → 实体板（从 y 挤出 height），holes 用于跑道内圈 / 路缘内圈 */
function slab(ring: Pt[], y: number, height: number, holes: Pt[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 })
    .rotateX(-Math.PI / 2)
    .translate(0, y, 0);
}

/** 环带面（只有水平面，没有侧壁）：用于场地白线，2 个三角形 / 边 */
function flatBand(outer: Pt[], inner: Pt[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < outer.length; i += 1) {
    const j = (i + 1) % outer.length;
    const a = outer[i];
    const b = outer[j];
    const c = inner[j];
    const d = inner[i];
    pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    pos.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** 竖直墙带（只有侧壁）：用于校园路缘，省掉上下底面 */
function wallBand(ring: Pt[], y: number, height: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    pos.push(a[0], y, a[1], b[0], y, b[1], b[0], y + height, b[1]);
    pos.push(a[0], y, a[1], b[0], y + height, b[1], a[0], y + height, a[1]);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).rotateY(rotY).translate(x, y, z);
}

function cylinder(r: number, h: number, x: number, y: number, z: number, sides = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, sides).translate(x, y + h / 2, z);
}

const ringArea = (ring: Pt[]) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
};
const ringCentroid = (ring: Pt[]): Pt => {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cz += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cz / (3 * a)];
};
const scaleRing = (ring: Pt[], s: number): Pt[] => {
  const [cx, cz] = ringCentroid(ring);
  return ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]);
};

const pointInRing = (p: Pt, ring: Pt[]) => {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
};
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashSeed = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/** 场地局部框（u 沿长轴、v 沿短轴）→ 世界坐标矩形环 */
const localRect = (cx: number, cz: number, angleDeg: number, u0: number, v0: number, u1: number, v1: number): Pt[] => {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c] as Pt);
};

/** 五角星（外接圆半径 r，从正上方一个角开始），挤出薄片 */
function starGeometry(r: number, depth: number, rotZ = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.382;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }).rotateZ(rotZ);
}

const circleRing = (cx: number, cz: number, r: number, n = 16): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as Pt;
  });

/** Douglas–Peucker：校园轮廓用来做平台 / 路缘时不必逐点还原 */
function simplify(ring: Pt[], tol: number): Pt[] {
  if (ring.length < 5) return ring;
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
  };
  const seq = [...ring, ring[0]];
  const keep = new Array(seq.length).fill(false);
  keep[0] = true;
  keep[seq.length - 1] = true;
  const stack: [number, number][] = [[0, seq.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = segDist(seq[i], seq[s], seq[e]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  const out = seq.filter((_, i) => keep[i]);
  out.pop();
  return out.length >= 4 ? out : ring;
}

/**
 * 整体放大倍数：常规校园 1.3（与沙盘其他地标一致，以轮廓中心为基准）；
 * 超大（占地 >6 万㎡）或细长（长短轴比 >4）的校园不放大，避免压掉周边街区。
 */
export function campusScale(campus: SchoolCampus): number {
  const area = ringArea(campus.outline);
  let longest = 0;
  let shortest = Infinity;
  const c = ringCentroid(campus.outline);
  for (const [x, z] of campus.outline) {
    const dx = Math.abs(x - c[0]);
    const dz = Math.abs(z - c[1]);
    longest = Math.max(longest, dx + dz);
    shortest = Math.min(shortest, Math.max(dx, dz));
  }
  const elongated = shortest > 0 && longest / Math.max(shortest, 1) > 4;
  return area > 60000 || elongated ? 1 : 1.3;
}

/**
 * 反查投影：只靠 ctx.project 在两个方向上各采一个点，就能解出这份沙盘的
 * 投影参数（K、mx0、my0），从而把「相对锚点的沙盘米制偏移」还原成经纬度，
 * 再用 ctx.groundAt 采样地面高度。
 */
function makeOffsetToLngLat(ctx: LandmarkContext, anchor: Pt) {
  const R = 6378137;
  const a = ctx.project(anchor);
  const d = 0.002;
  const east = ctx.project([anchor[0] + d, anchor[1]]);
  const north = ctx.project([anchor[0], anchor[1] + d]);
  const K = (east.x - a.x) / ((R * d * Math.PI) / 180);
  const mx0 = (R * anchor[0] * Math.PI) / 180 - a.x / K;
  const my0 = R * Math.log(Math.tan(Math.PI / 4 + (anchor[1] * Math.PI) / 360)) + a.z / K;
  return (x: number, z: number): Pt => {
    const lng = ((x / K + mx0) * 180) / (R * Math.PI);
    const lat = ((2 * Math.atan(Math.exp((-z / K + my0) / R)) - Math.PI / 2) * 180) / Math.PI;
    return [lng, lat];
  };
}

/** 校名牌的摆放位姿（回给图集层用） */
export type LabelAnchor = { id: string; name: string; x: number; z: number; y: number; rotY: number; scale: number };

/** 单个校区的几何（已换算到沙盘全局坐标），按材质分桶 */
function campusBatches(ctx: LandmarkContext, campus: SchoolCampus, scale: number): { batches: Batches; label: LabelAnchor | null; ground: number; groundSpread: number } {
  const batches = emptyBatches();
  const origin = ctx.project(campus.anchor);
  const ox = origin.x;
  const oz = origin.z;
  // 校园尺度上地面不是平的：单个锚点高度会让操场、场地平台在坡上被地形埋掉。
  // 这里在校园范围内的轮廓 / 运动场 / 校舍中心采样，取最高地面当基准，平台往下做裙边兜住低处。
  const toLngLat = makeOffsetToLngLat(ctx, campus.anchor);
  const samples: Pt[] = [[0, 0]];
  const stride = (list: Pt[]) => list.filter((_, i) => i % Math.max(1, Math.ceil(list.length / 10)) === 0);
  for (const [x, z] of stride(campus.outline)) samples.push([x - ox, z - oz]);
  for (const sport of campus.sports) {
    const [cx, cz] = ringCentroid(sport.ring);
    samples.push([cx - ox, cz - oz]);
  }
  for (const building of stride(campus.buildings.map((b) => ringCentroid(b.ring)))) {
    samples.push([building[0] - ox, building[1] - oz]);
  }
  // 再加一层 7×7 网格密集采样：低多边形地形是 60m 一格的三角网，
  // 校园里可能有一小块地面明显高于轮廓顶点，只按轮廓/建筑采样会把操场埋掉。
  const xsAll = campus.outline.map(([x]) => x);
  const zsAll = campus.outline.map(([, z]) => z);
  for (let i = 0; i <= 6; i += 1) {
    for (let j = 0; j <= 6; j += 1) {
      const gx = Math.min(...xsAll) + ((Math.max(...xsAll) - Math.min(...xsAll)) * i) / 6;
      const gz = Math.min(...zsAll) + ((Math.max(...zsAll) - Math.min(...zsAll)) * j) / 6;
      samples.push([gx - ox, gz - oz]);
    }
  }
  // toLngLat 吃的是沙盘绝对坐标，samples 存的是相对锚点的偏移，这里要加回去
  let ground = -Infinity;
  let groundMin = Infinity;
  for (const [lx, lz] of samples) {
    const h = ctx.groundAt(toLngLat(ox + lx, oz + lz));
    ground = Math.max(ground, h);
    groundMin = Math.min(groundMin, h);
  }
  const groundSpread = ground - groundMin;
  // 以校园轮廓中心为基准整体缩放，但仍然落在沙盘绝对坐标上（减掉锚点后必须加回去，
  // 否则所有校区都会叠在沙盘原点）
  const toLocal = (ring: Pt[]): Pt[] => ring.map(([x, z]) => [(x - ox) * scale + ox, (z - oz) * scale + oz]);
  const plinthTop = ground + 1;
  const campusRing = simplify(toLocal(campus.outline), 2.5);

  // 1) 场地平台：真实校园范围，向下埋 1.6m 防止与地形出现缝隙；路缘用墙带 + 环带面省掉两个底面
  // 平台往下做 16m 裙边：校园内高差有几米时，低处也不会露出悬空的平台底
  push(batches, "stone", slab(campusRing, ground - 16, 17));
  const ringCx = campusRing.reduce((sum, p) => sum + p[0], 0) / campusRing.length;
  const ringCz = campusRing.reduce((sum, p) => sum + p[1], 0) / campusRing.length;
  const inset = campusRing.map(([x, z]) => {
    const d = Math.hypot(x - ringCx, z - ringCz) || 1;
    const t = 2.2 / d;
    return [x - (x - ringCx) * t, z - (z - ringCz) * t] as Pt;
  });
  push(batches, "silver", flatBand(campusRing, inset, plinthTop + 0.32));
  push(batches, "silver", wallBand(campusRing, plinthTop - 0.18, 0.5));
  push(batches, "silver", wallBand(inset, plinthTop - 0.18, 0.5));

  // 2) 运动场：跑道 → 内场 → 球场，逐层抬高 4cm，避免共面 z-fighting
  const hasTrack = Boolean(campus.track);
  if (campus.track) {
    const trackOuter = toLocal(campus.track.outer);
    const trackInner = toLocal(campus.track.inner);
    push(batches, "track", slab(trackOuter, plinthTop - 0.14, 0.34, [trackInner]));
    push(batches, "field", slab(trackInner, plinthTop - 0.06, 0.28));
    // 分道线：跑道环上等距插 3 条白线
    for (let lane = 1; lane <= 3; lane += 1) {
      const t = lane / 4;
      const a = trackOuter.map((q, k) => [q[0] + (trackInner[k][0] - q[0]) * (t - 0.015), q[1] + (trackInner[k][1] - q[1]) * (t - 0.015)] as Pt);
      const b = trackOuter.map((q, k) => [q[0] + (trackInner[k][0] - q[0]) * (t + 0.015), q[1] + (trackInner[k][1] - q[1]) * (t + 0.015)] as Pt);
      push(batches, "line", flatBand(a, b, plinthTop + 0.21));
    }
    // 看台：跑道外侧一排台阶（示意，不是实测看台位置与规模）
    const trackSport = campus.sports.find((sp) => sp.hasTrack);
    if (trackSport?.rect) {
      const [tcx, tcz] = ringCentroid(trackSport.ring);
      const r = trackSport.rect;
      const side = -((r.h + 17) / 2 + 2.5);
      for (let step = 0; step < 5; step += 1) {
        const v = side - step * 1.3;
        push(batches, "silver", slab(localRect(tcx, tcz, r.angleDeg, -r.w / 3, v - 1.3, r.w / 3, v), plinthTop + 0.2, 0.55 * (step + 1)));
      }
    }
  }
  campus.sports.forEach((sport, index) => {
    if (hasTrack && sport.kind === "field" && !sport.hasTrack) return; // 已被跑道内场代替
    const top = plinthTop + 0.26 + index * 0.04;
    const ring = toLocal(sport.ring);
    push(batches, sport.kind === "field" ? "field" : courtKey(sport.sport), slab(ring, top - 0.26, 0.26));
    // 场地白线：贴边一圈 + 中线，2 个三角形 / 边
    if (ring.length >= 3) {
      const rect = sport.rect;
      const halfShort = Math.max(Math.min(rect?.w ?? 20, rect?.h ?? 20) / 2, 4);
      const inner = scaleRing(ring, 1 - 1 / halfShort);
      push(batches, "line", flatBand(ring, inner, top + 0.04));
      const [cx, cz] = ringCentroid(ring);
      if (rect) {
        const a = (rect.angleDeg * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const put = (key: Key, w: number, h: number, d: number, u: number, v: number, y: number) =>
          push(batches, key, box(w, h, d, cx + u * ca - v * sa, y, cz + u * sa + v * ca, -a));
        put("line", Math.max(rect.w - 3, 2), 0.06, 0.22, 0, 0, top + 0.04); // 中线
        if (sport.kind === "field") {
          // 中圈 + 两端禁区 / 球门区（示意，不是实测划线）
          push(batches, "line", flatBand(circleRing(cx, cz, 3.4, 18), circleRing(cx, cz, 3.9, 18), top + 0.05));
          const box = (u0: number, u1: number, v1: number) => {
            const outer = localRect(cx, cz, rect.angleDeg, u0, -v1, u1, v1);
            const inner = localRect(cx, cz, rect.angleDeg, u0 + (u1 > u0 ? 1 : -1) * 1.2, -v1 + 1.2, u1, v1 - 1.2);
            push(batches, "line", flatBand(outer, inner, top + 0.05));
          };
          for (const side of [-1, 1]) {
            const end = (side * rect.w) / 2;
            box(end, end - side * 16.5, Math.min(rect.h * 0.42, 20)); // 罚球区
            box(end, end - side * 5.5, Math.min(rect.h * 0.2, 9)); // 球门区
          }
        } else {
          // 球场两端各一根球柱
          for (const side of [-1, 1]) put("silver", 0.3, 4, 0.3, side * (rect.w / 2 - 1.2), 0, top + 0.02);
        }
      }
    }
  });

  // 3) 校舍：真实足迹挤出，屋面用学段特征色收头
  const bodies = campus.buildings.map((b) => ({ ring: toLocal(b.ring), h: Math.max(b.h * scale, 3) }));
  const SEED = mulberry32(hashSeed(campus.id));
  for (const body of bodies) {
    push(batches, "white", slab(body.ring, plinthTop, body.h));
    // 檐口顶面必须高于楼体顶面 0.35m，否则两块共面会 z-fighting
    const eave = Math.min(1.1, Math.max(0.6, body.h * 0.2));
    push(batches, "accent", slab(scaleRing(body.ring, 1.022), plinthTop + body.h - eave, eave + 0.35));
    // 逐层：深色窗带 + 上方外廊挑板。南方校园教学楼是外廊式，窗带 + 挑板的水平线是最好认的特征
    const floors = Math.max(2, Math.min(14, Math.round(body.h / 3.6)));
    const skin = scaleRing(body.ring, 1.008);
    const ledgeRing = scaleRing(body.ring, 1.055);
    for (let f = 1; f < floors; f += 1) {
      const y = plinthTop + (body.h * f) / floors;
      push(batches, "glass", wallBand(skin, y - 0.3, 0.6));
      push(batches, "white", slab(ledgeRing, y + 0.3, 0.32));
    }
    // 大屋面加设备（水箱）与楼梯间出屋面
    if (ringArea(body.ring) > 420) {
      const [bx, bz] = ringCentroid(body.ring);
      const w = 4 + SEED() * 3;
      push(batches, "silver", box(w, 2.6, w * 0.8, bx + (SEED() - 0.5) * 8, plinthTop + body.h + 1.3, bz + (SEED() - 0.5) * 8));
      push(batches, "white", box(4.4, 3.4, 5.6, body.ring[0][0], plinthTop + body.h + 1.7, body.ring[0][1]));
    }
  }
  // 4) 主楼入口雨棚
  const tallest = [...bodies].sort((a, b) => b.h - a.h)[0];
  if (tallest) {
    const [tx, tz] = ringCentroid(tallest.ring);
    push(batches, "accent", slab(circleRing(tx, tz + 1, 5, 12), plinthTop + 4.4, 0.5));
    push(batches, "silver", cylinder(0.3, 4.4, tx, plinthTop, tz + 5, 6));
  }

  // 5.5) 校园绿化：在轮廓内、避开校舍与运动场的位置种树（用校区 id 播种，结果稳定可复现）
  const treeAvoid = [...bodies.map((b) => scaleRing(b.ring, 1.12)), ...campus.sports.map((sp) => toLocal(sp.ring))];
  const treeXs = campus.outline.map(([x]) => x);
  const treeZs = campus.outline.map(([, z]) => z);
  const planted: Pt[] = [];
  for (let attempt = 0; attempt < 420 && planted.length < 16; attempt += 1) {
    const px = Math.min(...treeXs) + SEED() * (Math.max(...treeXs) - Math.min(...treeXs));
    const pz = Math.min(...treeZs) + SEED() * (Math.max(...treeZs) - Math.min(...treeZs));
    const p: Pt = [(px - ox) * scale + ox, (pz - oz) * scale + oz];
    if (!pointInRing(p, campusRing)) continue;
    if (treeAvoid.some((ring) => pointInRing(p, ring))) continue;
    if (planted.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 9)) continue;
    planted.push(p);
  }
  for (const [px, pz] of planted) {
    push(batches, "wood", cylinder(0.32, 4.2, px, plinthTop + 0.2, pz, 5));
    push(batches, "leaf", new THREE.IcosahedronGeometry(1.9 + SEED() * 0.7, 0).scale(1, 1.15, 1).translate(px, plinthTop + 5.8, pz));
  }

  // 6) 示意校门 + 门卫室 + 旗杆，放在离高德 POI 最近的轮廓顶点（POI 一般落在校门口）
  const outline = toLocal(campus.outline);
  const poi = ctx.project(campus.gateAnchor ?? campus.poiAnchor);
  const poiLocal: Pt = [(poi.x - ox) * scale + ox, (poi.z - oz) * scale + oz];
  let gateIndex = 0;
  let gateDist = Infinity;
  outline.forEach((p, i) => {
    const d = Math.hypot(p[0] - poiLocal[0], p[1] - poiLocal[1]);
    if (d < gateDist) { gateDist = d; gateIndex = i; }
  });
  let label: LabelAnchor | null = null;
  if (outline.length >= 3 && gateDist < 150) {
    const here = outline[gateIndex];
    const prev = outline[(gateIndex + outline.length - 1) % outline.length];
    const next = outline[(gateIndex + 1) % outline.length];
    const tangent = new THREE.Vector2(next[0] - prev[0], next[1] - prev[1]).normalize();
    const angle = Math.atan2(tangent.y, tangent.x);
    // 朝外法线：从轮廓中心指向校门顶点
    const outward = new THREE.Vector2(here[0] - ringCx, here[1] - ringCz).normalize();
    const span = 11;
    for (const side of [-1, 1]) {
      push(batches, "silver", box(1.1, 4.6, 1.1, here[0] + tangent.x * span * 0.5 * side, plinthTop + 2.3, here[1] + tangent.y * span * 0.5 * side, angle));
    }
    push(batches, "silver", box(span + 1.4, 0.8, 1.2, here[0], plinthTop + 4.9, here[1], angle));
    // 门卫室
    push(batches, "white", box(5, 3.6, 4.2, here[0] + tangent.x * 9, plinthTop + 1.8, here[1] + tangent.y * 9, angle));
    push(batches, "accent", box(5.6, 0.8, 4.8, here[0] + tangent.x * 9, plinthTop + 4, here[1] + tangent.y * 9, angle));
    // 旗杆 + 五星红旗，立在门内侧
    const flagX = here[0] - tangent.y * 7;
    const flagZ = here[1] + tangent.x * 7;
    const poleH = 14;
    push(batches, "silver", cylinder(0.22, poleH, flagX, plinthTop, flagZ, 6));
    push(batches, "white", cylinder(1.4, 0.8, flagX, plinthTop, flagZ, 8));
    // 旗面 3:2，长边沿校门切线方向，法线朝校园外
    const flagW = 5.4;
    const flagH = flagW * (2 / 3);
    const flagRot = Math.atan2(tangent.y, tangent.x);
    const flagY = plinthTop + poleH - 0.5 - flagH / 2;
    const flagTopY = plinthTop + poleH - 0.5;
    const fx = flagX + tangent.x * (flagW / 2 + 0.25);
    const fz = flagZ + tangent.y * (flagW / 2 + 0.25);
    push(batches, "flagRed", box(flagW, flagH, 0.12, fx, flagY, fz, -flagRot));
    // 五颗黄星：一颗大星 + 四颗小星，小星各有一个角指向大星中心（GB 12982 布局）
    const U = flagW / 30;
    const bigU = 5 * U;
    const bigV = 5 * U;
    for (const facing of [1, -1]) {
      const zOff = facing * 0.1;
      // u 从旗面左缘起算、v 从旗面上缘起算（GB 12982 用的是旗面十分制坐标）
      const star = (u: number, v: number, radius: number, rot: number) => {
        const g = starGeometry(radius, 0.05, rot);
        const lx = (u - flagW / 2) * facing;
        const ly = flagTopY - v;
        g.rotateY(-flagRot);
        if (facing === -1) g.rotateY(Math.PI);
        g.translate(fx + tangent.x * lx - tangent.y * zOff, ly, fz + tangent.y * lx + tangent.x * zOff);
        return g;
      };
      push(batches, "flagYellow", star(bigU, bigV, 3 * U, 0));
      for (const [u, v] of [[10, 2], [12, 4], [12, 7], [10, 9]]) {
        // 小星各有一个角指向大星中心
        const rot = Math.atan2(-(bigV - v * U), bigU - u * U) + Math.PI / 2;
        push(batches, "flagYellow", star(u * U, v * U, 1 * U, rot));
      }
    }
    // 校名牌：贴在门内侧，正面朝校园外
    label = {
      id: campus.id,
      name: campus.name,
      x: here[0] - outward.x * 2.5,
      z: here[1] - outward.y * 2.5,
      y: plinthTop + 6.4,
      rotY: Math.atan2(outward.x, outward.y),
      scale: 1,
    };
  } else {
    const [cx, cz] = ringCentroid(outline);
    label = { id: campus.id, name: campus.name, x: cx, z: cz, y: plinthTop + 6.4, rotY: 0, scale: 1 };
  }

  return { batches, label, ground, groundSpread };
}

// ---------------------------------------------------------------------------
// 校名牌图集：一个学段所有校名画进一张 2048×2048 图，合并成 1 个 Mesh
// ---------------------------------------------------------------------------
// 每个校名一格 512×64：格子够宽，长校名不用缩得太小也不会串格。
// 画布高度按实际条目数收缩，避免整张 2048×2048 白占显存。
const ATLAS_COLS = 4;
const CELL_W = 512;
const CELL_H = 64;

function buildNameAtlas(labels: LabelAnchor[], plateWidth: number) {
  if (typeof document === "undefined" || !labels.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = Math.max(Math.ceil(labels.length / ATLAS_COLS), 1) * CELL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cellOf = new Map<string, { u0: number; v0: number; u1: number; v1: number }>();
  labels.forEach((label, index) => {
    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    const cx = col * CELL_W + CELL_W / 2;
    const cy = row * CELL_H + CELL_H / 2;
    // 自动缩放字号，让长校名也塞得进一格
    let font = 44;
    ctx.font = `700 ${font}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
    while (ctx.measureText(label.name).width > CELL_W - 24 && font > 14) {
      font -= 2;
      ctx.font = `700 ${font}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(38,52,66,0.85)";
    ctx.strokeText(label.name, cx, cy);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.name, cx, cy);
    cellOf.set(label.id, {
      u0: (col * CELL_W) / canvas.width,
      v0: 1 - ((row + 1) * CELL_H) / canvas.height,
      u1: ((col + 1) * CELL_W) / canvas.width,
      v1: 1 - (row * CELL_H) / canvas.height,
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const planeW = plateWidth;
  const planeH = (planeW * CELL_H) / CELL_W;
  const geometries: THREE.BufferGeometry[] = [];
  for (const label of labels) {
    const cell = cellOf.get(label.id);
    if (!cell) continue;
    for (const flip of [0, Math.PI]) {
      const geometry = new THREE.PlaneGeometry(planeW, planeH);
      const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i += 1) {
        uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
      }
      uv.needsUpdate = true;
      geometry.rotateY(label.rotY + flip).translate(label.x, label.y + planeH / 2, label.z);
      geometries.push(geometry);
    }
  }
  if (!geometries.length) { texture.dispose(); return null; }
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  if (!merged) { texture.dispose(); return null; }
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  return { mesh: new THREE.Mesh(merged, material), texture };
}

function mergeBatches(batches: Batches, materials: Record<Key, THREE.MeshStandardMaterial>, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  for (const key of KEYS) {
    const list = batches[key];
    if (!list.length) { materials[key].dispose(); continue; }
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) { materials[key].dispose(); continue; }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, materials[key]);
    mesh.name = `${name}/${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export type SchoolBuildOptions = { ids?: string[]; labels?: boolean; labelHeight?: number; campusGroups?: boolean };

/** 单个校区：返回一个独立 Group（预览页与按校区接入时用） */
export function buildGuangmingSchoolCampus(ctx: LandmarkContext, campus: SchoolCampus, options: SchoolBuildOptions = {}): THREE.Group {
  const materials = makeMaterials(campus.tier);
  const { batches, label, ground, groundSpread } = campusBatches(ctx, campus, campusScale(campus));
  const group = mergeBatches(batches, materials, campus.name);
  if (label && options.labels !== false) {
    const atlas = buildNameAtlas([label], options.labelHeight ?? 17);
    if (atlas) {
      atlas.mesh.name = `${campus.name}/name`;
      group.add(atlas.mesh);
    }
  }
  group.userData = {
    id: campus.id,
    name: campus.name,
    tier: campus.tier,
    stages: campus.stages,
    scale: campusScale(campus),
    outlineStatus: campus.outlineStatus,
    osmId: campus.osmId,
    ground: Math.round(ground),
    groundSpread: Math.round(groundSpread * 10) / 10,
    sports: campus.sports.map((s) => ({ kind: s.kind, sport: s.sport, status: s.status, area: s.area })),
    sources: (SCHOOL_DATA.meta as { sources?: unknown }).sources,
    limitations: (SCHOOL_DATA.meta as { limitations?: unknown }).limitations,
  };
  return group;
}

/**
 * 一个学段的所有校区：同类部件合并几何体，每材质一个 Mesh（≤13 个 Mesh）。
 * options.ids 只构建指定校区；options.campusGroups=true 改为每校区一个子 Group；
 * options.labels=false 关掉校名牌（唯一的贴图件）。
 */
export function buildGuangmingSchoolTier(ctx: LandmarkContext, tier: SchoolTier, options: SchoolBuildOptions = {}): THREE.Group {
  const list = campusesOfTier(tier).filter((c) => !options.ids || options.ids.includes(c.id));
  const group = new THREE.Group();
  group.name = `光明区${tier}校区`;
  group.userData = {
    tier,
    campusCount: list.length,
    campuses: list.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      stages: c.stages,
      outlineStatus: c.outlineStatus,
      sports: c.sports.length,
    })),
    sources: (SCHOOL_DATA.meta as { sources?: unknown }).sources,
    limitations: (SCHOOL_DATA.meta as { limitations?: unknown }).limitations,
  };

  if (options.campusGroups) {
    for (const campus of list) group.add(buildGuangmingSchoolCampus(ctx, campus, options));
    return group;
  }

  const materials = makeMaterials(tier);
  const total = emptyBatches();
  const labels: LabelAnchor[] = [];
  for (const campus of list) {
    const { batches, label } = campusBatches(ctx, campus, campusScale(campus));
    for (const key of KEYS) if (batches[key].length) total[key].push(...batches[key]);
    if (label) labels.push(label);
  }
  for (const key of KEYS) {
    if (!total[key].length) { materials[key].dispose(); continue; }
    const geo = mergeGeometries(total[key], false);
    total[key].forEach((g) => g.dispose());
    if (!geo) { materials[key].dispose(); continue; }
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[key]);
    mesh.name = `${group.name}/${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (options.labels !== false) {
    const atlas = buildNameAtlas(labels, options.labelHeight ?? 17);
    if (atlas) {
      atlas.mesh.name = `${group.name}/name`;
      group.add(atlas.mesh);
    }
  }
  return group;
}

export function campusesOfTier(tier: SchoolTier): SchoolCampus[] {
  return SCHOOL_CAMPUSES.filter((c) => c.tier === tier);
}

/** 用于验收与调试：模块内的 Mesh 数与三角面数 */
export function countGroup(group: THREE.Group): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const position = mesh.geometry.getAttribute("position");
    triangles += position ? position.count / 3 : 0;
  });
  return { meshes, triangles };
}
