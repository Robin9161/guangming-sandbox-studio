import * as THREE from "three";
import { landmarkKit, type ColorKey, type LandmarkContext } from "../_landmark-kit";

/**
 * 春笋 · 深圳湾华润大厦（独立对比模型，仅本体与近身广场）。
 *
 * 真实依据：
 * - public/sandbox/districts/nanshan/sandbox.json buildings[18211]：16 点近圆轮廓，
 *   t=commercial、e=0、h=320，输入约略坐标周围 600m 内最高建筑；不采用其偏低高度。
 *   用多边形面积形心 (1293.852752006883, 27169.42030052516) 反投影定位，
 *   非顶点平均；meta.projection origin=[113.929007,22.76207], k=0.9221194861972872。
 * - KPF：冬笋形、圆形平面、56 外柱在上下两端归并为 28 柱、三角玻璃冠与入口门洞。
 *   https://www.kpf.com/project/china-resources-tower
 * - WSP 工程资料高 392.5m（其楼层口径为 67）；Lichtvision 标注 66 层、2018 竣工。
 *   https://www.wsp.com/en-my/projects/shenzhen-china-resources-headquarters-tower
 *   https://lichtvision.com/en/project/china-resources-tower
 *   KPF 于 2019-01-03 公布竣工，故采用“2018 竣工 / 2019 年初公告”。
 *
 * 估算：逐高半径、转接节点标高、柱宽与进深、冠部斜网格、入口退距、广场铺装与花池。
 * 平面尺度以轮廓等面积圆半径 36.1553m 约束；不是施工图复原。水平线仅暗示楼层。
 * 绕形心地面等比放大 1.25×（含高度），塔高 490.625m，另加广场厚度 0.625m。
 * 使用 kit 原色 white/silver/stone/glazing/glazingLight，暖光由 kit 的 glowColor 管理。
 * 无贴图、无透明、无额外反射环境；所有构件按颜色合批，一个材质一个 Mesh。
 */
type Ctx = LandmarkContext;
type V = [number, number, number];
type Section = [height: number, radius: number];

export const CHUNSUN_ANCHOR: [number, number] = [113.94161152381633, 22.51778544083094];
const SCALE = 1.25;
const HEIGHT = 392.5;
const BASE = 0.5;
const N = 56;
const TAU = Math.PI * 2;
const RADIUS = 36.155265309370556;

// 原始轮廓留作证据和复算；运行时不加载全区 JSON，也不把绝对坐标再次叠加到 anchor。
const FOOTPRINT = [
  1314.8, 27199.5, 1327, 27185, 1330.3, 27172.7, 1329.2, 27160,
  1323.9, 27148.5, 1314.9, 27139.4, 1303.3, 27134, 1284.3, 27134,
  1272.8, 27139.4, 1263.8, 27148.4, 1258.4, 27159.9, 1258.3, 27178.9,
  1263.7, 27190.4, 1278.2, 27202.7, 1290.5, 27206, 1303.2, 27204.9,
];

// 纵剖面：底层内退；办公层轻微鼓腹；上部渐收；末端尖冠，不以天线代替笋尖。
const PROFILE: Section[] = [
  [18, 29.8], [27, 33.4], [38, 35.25], [60, 35.95], [90, RADIUS],
  [120, 35.8], [150, 35.05], [180, 34], [210, 32.6], [240, 30.8],
  [270, 28.5], [295, 26], [318, 23], [337, 19.9], [354, 16.25],
  [367, 12.35], [378, 7.9], [386, 3.95], [391.8, 0.36], [HEIGHT, 0],
];

function radiusAt(y: number): number {
  for (let i = 1; i < PROFILE.length; i++) {
    const [hi, r1] = PROFILE[i], [lo, r0] = PROFILE[i - 1];
    if (y <= hi) return THREE.MathUtils.lerp(r0, r1, (y - lo) / (hi - lo));
  }
  return 0;
}

export function buildChunsun(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, CHUNSUN_ANCHOR, "春笋 · 华润大厦", undefined, {
    // 沙盘统一白模风格：外框柱用暖白，玻璃提亮成浅蓝灰（原色在满屏白模里过黑）
    silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc", glazingLight: "#cfdde4",
  });
  // 直接积累三角形，避免为数千个窗格/杆段创建临时 BoxGeometry 与 Mesh。
  const faces: Partial<Record<ColorKey, number[]>> = {};
  const tri = (key: ColorKey, a: V, b: V, c: V) => {
    const target = faces[key] ?? (faces[key] = []);
    target.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => {
    tri(key, a, b, c); tri(key, a, c, d);
  };
  const polar = (angle: number, y: number, r: number): V => [Math.cos(angle) * r, y + BASE, Math.sin(angle) * r];

  // 与 kit.cylinder 同样的封闭圆台，直接批量写面，避免底座小构件反复去索引。
  const drum = (key: ColorKey, x: number, z: number, y: number, radius: number, height: number, top: number, sides: number) => {
    const point = (a: number, h: number, r: number): V => [x + Math.cos(a) * r, h, z + Math.sin(a) * r];
    for (let i = 0; i < sides; i++) {
      const a = i * TAU / sides, b = (i + 1) * TAU / sides;
      const p = point(a, y, radius), q = point(b, y, radius), u = point(b, y + height, top), v = point(a, y + height, top);
      tri(key, [x, y, z], p, q);
      if (top === 0) tri(key, p, v, q);
      else { quad(key, p, v, u, q); tri(key, [x, y + height, z], u, v); }
    }
  };

  /** 小截面斜撑直接写入合批数组，省去大量 BoxGeometry 的分配、去索引和矩阵变换。 */
  const strut = (a: V, b: V, width: number, depth: number) => {
    const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const u = new THREE.Vector3(-direction.z, 0, direction.x).normalize().multiplyScalar(width / 2);
    const v = new THREE.Vector3().crossVectors(direction, u).normalize().multiplyScalar(depth / 2);
    const corners = (p: V) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]): V => [
      p[0] + u.x * s + v.x * t, p[1] + u.y * s + v.y * t, p[2] + u.z * s + v.z * t,
    ]);
    const p = corners(a), q = corners(b);
    for (let i = 0; i < 4; i++) quad("silver", p[i], p[(i + 1) % 4], q[(i + 1) % 4], q[i]);
    quad("silver", p[3], p[2], p[1], p[0]);
    quad("silver", q[0], q[1], q[2], q[3]);
  };

  /** 连续矩形肋：截面沿径向/切向排列，接头共用截面，白色正面和银色侧面读出厚度。 */
  const rib = (nodes: { angle: number; y: number; r: number; width: number; depth: number }[]) => {
    const sections = nodes.map(({ angle, y, r, width, depth }) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]): V => [
        c * (r + v * depth / 2) - s * u * width / 2,
        y + BASE,
        s * (r + v * depth / 2) + c * u * width / 2,
      ]);
    });
    for (let j = 1; j < sections.length; j++) {
      const a = sections[j - 1], b = sections[j];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        quad(edge === 2 ? "white" : "silver", a[edge], b[edge], b[next], a[next]);
      }
    }
    const first = sections[0], last = sections[sections.length - 1];
    quad("silver", first[3], first[2], first[1], first[0]);
    quad("white", last[0], last[1], last[2], last[3]);
  };

  // ── 广场：近身 49m 半径的薄石材基面，真实三角形顶面参与沙盘占地栅格化 ──
  drum("stone", 0, 0, 0, 49, BASE, 49, 56);
  // 浅色同心嵌条与放射缝，保持入口处平坦；不延伸到相邻商业裙房。
  for (const r of [42.6, 47.3]) {
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N, b = (i + 1) * TAU / N;
      quad("white", polar(a, 0.047, r), polar(b, 0.047, r), polar(b, 0.047, r - 0.16), polar(a, 0.047, r - 0.16));
    }
  }
  for (let i = 0; i < 14; i++) {
    const a = i * TAU / 14;
    strut(polar(a, 0.04, 40.8), polar(a, 0.04, 48.6), 0.1, 0.035);
  }
  // 四组小花池和石凳均为示意，不以整片公园压掉周边建筑。
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * TAU / 4, x = 45.1 * Math.cos(a), z = 45.1 * Math.sin(a);
    drum("white", x, z, BASE, 2.1, 0.6, 2.1, 12);
    drum("green", x, z, BASE + 0.6, 1.82, 0.18, 1.82, 12);
    k.box("stone", x - Math.sin(a) * 3.2, BASE, z + Math.cos(a) * 3.2, 3.4, 0.5, 1.05, -a);
  }

  // ── 内退玻璃大堂：与外张柱脚之间留出 10m 左右的真实几何空隙 ──
  drum("glazing", 0, 0, BASE, 27.6, 18, 29.8, 56);
  drum("silver", 0, 0, BASE + 17.8, 29.8, 0.28, 29.8, 56);
  for (let i = 0; i < 28; i++) {
    const a = (i * 2 + 0.5) * TAU / N;
    strut(polar(a, 0.2, 27.75), polar(a, 17.7, 29.9), 0.16, 0.2);
  }

  // ── 玻璃表皮：56 边圆截面；冠部以交替三角色面提示晶体，不使用透明材质 ──
  for (let j = 1; j < PROFILE.length; j++) {
    const [y0, r0] = PROFILE[j - 1], [y1, r1] = PROFILE[j];
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N, b = (i + 1) * TAU / N;
      const p = polar(a, y0, r0), q = polar(b, y0, r0), u = polar(b, y1, r1), v = polar(a, y1, r1);
      // 顶端只生成单三角，避免半径为零产生退化面。
      const tone: ColorKey = i % 7 < 2 ? "glazingLight" : "glazing";
      if (r1 === 0) tri(tone, p, v, q);
      else {
        tri(tone, p, v, u);
        tri(y0 >= 337 && (i + j) % 3 === 0 ? "glazingLight" : tone, p, u, q);
      }
    }
  }

  // ── 笋根：28 个柱脚分叉为 56 肋，柱脚外张，门洞由柱间空隙形成 ──
  for (let pair = 0; pair < 28; pair++) {
    const middle = (pair * 2 + 0.5) * TAU / N;
    rib([{ angle: middle, y: 0, r: 40, width: 1.35, depth: 1.35 },
      { angle: middle, y: 10, r: 37.9, width: 1.18, depth: 1.15 }]);
    for (let side = 0; side < 2; side++) {
      const a = (pair * 2 + side) * TAU / N;
      rib([{ angle: middle, y: 10, r: 37.9, width: 1.05, depth: 1.1 },
        { angle: (middle + a) / 2, y: 23, r: 36.55, width: 0.94, depth: 1.05 },
        { angle: a, y: 38, r: radiusAt(38) + 0.45, width: 0.85, depth: 1 }]);
    }
  }

  // ── 主体密肋：长向连续、上部逐渐变细；28 对在 354m 冠肩归并 ──
  for (let i = 0; i < N; i++) {
    const a = i * TAU / N, middle = (Math.floor(i / 2) * 2 + 0.5) * TAU / N;
    const nodes = PROFILE.filter(([y]) => y >= 38 && y <= 354).map(([y, r]) => ({
      angle: y > 318 ? THREE.MathUtils.lerp(a, middle, (y - 318) / 36) : a,
      y, r: r + 0.45, width: THREE.MathUtils.lerp(0.85, 0.55, (y - 38) / 316), depth: 0.9,
    }));
    rib(nodes);
  }
  for (let pair = 0; pair < 28; pair++) {
    const angle = (pair * 2 + 0.5) * TAU / N;
    rib(PROFILE.filter(([y]) => y >= 354 && y <= 391.8).map(([y, r]) => ({
      angle, y, r: r + (y < 386 ? 0.4 : 0.12),
      width: THREE.MathUtils.lerp(0.65, 0.045, (y - 354) / 37.8),
      depth: THREE.MathUtils.lerp(0.8, 0.09, (y - 354) / 37.8),
    })));
  }
  drum("silver", 0, 0, BASE + 391.8, 0.54, 0.7, 0, 14);

  // ── 楼层节奏：约每两层一道 0.2m 银线，不生成密集的悬挑楼板 ──
  for (let y = 43; y < 330; y += 10.5) {
    const r0 = radiusAt(y) + 0.045, r1 = radiusAt(y + 0.2) + 0.045;
    for (let i = 0; i < N; i++) {
      const a = i * TAU / N, b = (i + 1) * TAU / N;
      quad("silver", polar(a, y, r0), polar(a, y + 0.2, r1), polar(b, y + 0.2, r1), polar(b, y, r0));
    }
  }
  // 冠部次斜肋：只在顶部构造稀疏菱形网格；节点落在同一表皮外侧。
  for (let i = 0; i < 28; i++) {
    const a = (i * 2 + 0.5) * TAU / N, b = a + TAU / 28;
    for (const [lo, hi] of [[337, 354], [354, 367], [367, 378]] as Section[]) {
      for (const [from, to] of [[a, b], [b, a]]) {
        strut(polar(from, lo, radiusAt(lo) + 0.55), polar(to, hi, radiusAt(hi) + 0.55), 0.2, 0.24);
      }
    }
  }

  for (const key of Object.keys(faces) as ColorKey[]) k.triangles(key, faces[key]!);
  const group = k.finish();
  // 用组变换等比放大；占地栅格化会应用 matrixWorld，不必逐顶点重复缩放。
  group.scale.setScalar(SCALE);
  group.userData.evidence = {
    anchor: [...CHUNSUN_ANCHOR], scale: SCALE, height: HEIGHT, columns: 56, terminalColumns: 28,
    footprintSource: "public/sandbox/districts/nanshan/sandbox.json buildings[18211]",
    footprint: [...FOOTPRINT], footprintHeight: 320, footprintArea: 4106.7,
    footprintCentroid: [1293.852752006883, 27169.42030052516],
    estimated: "纵剖面、柱截面、节点标高、玻璃冠细分、入口退距、广场及花池",
  };
  return group;
}
