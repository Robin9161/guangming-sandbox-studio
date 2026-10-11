import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";

type Context = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };
type Point = [number, number];

/** 锚点：data/hero-landmarks.json 的 gm-culture-art-center（高德 POI 转 WGS84） */
const ANCHOR: [number, number] = [113.932078, 22.749634];
/** 主轴方位角：data/landmark-production.json 该条目 bearingDeg 为 null，改由真实轮廓最小外接矩形解出 */
const BEARING_DEG = 66.1;
/** 地标整体放大倍数（以轮廓形心为基准；局部坐标已含），高度不放大 */
const SCALE = 1.2;

/**
 * 平面轮廓（真实）：OSM way 919126944，即 public/sandbox/sandbox.json 的 buildings[8006]，
 * 已换算为局部米制的 u/v（+u 指向方位角 66.1°、+v 顺时针 90°），并以轮廓形心为基准放大 1.2 倍。
 * 外轮廓 6 角点是"回"字外缘；中庭 13 点是 OSM 向内收进的内院边界。
 * 详见 public/sandbox/landmarks/guangming-culture-art-center.json。
 */
const OUTER: Point[] = [[91.14, -94.59], [-106.51, -94.59], [-55.99, 108.12], [58.25, 81.02], [52.88, 63.81], [88.21, 64.63]];
const COURT: Point[] = [[88.96, -17.07], [34.04, -2.41], [44.02, 36.39], [34.82, 38.49], [22.49, -10.42], [-41.17, -10.39], [-48.33, -12.91], [-55.03, -17.32], [-58.89, -24.02], [-72.04, -69.61], [14.39, -68.86], [22.79, -31.54], [86.55, -26.14]];
/** 中庭内最大内接正交矩形（1m 网格解出）→ 山水庭院水面，示意 */
const POND: Point[] = [[-53.69, -68.23], [14.71, -68.23], [14.71, -15.43], [-53.69, -15.43]];

/**
 * "光明之眼"拱门。落在外墙 1→2（朝向约 241°，即观光路/创投路一侧）上，
 * 位置取中庭形心沿该立面的投影。尺寸全部为示意（公开资料无拱门尺寸）。
 */
const ARCH = {
  origin: [-85.98, -12.2] as Point,     // 拱门中心所在的墙面点（局部 u/v）
  dir: [0.2418, 0.9703] as Point,       // 沿墙方向
  inward: [0.9703, -0.2418] as Point,   // 指入建筑的法线
  width: 24,                            // 洞口宽
  radius: 12,                           // 半圆拱半径 = width/2
  springY: 4,                           // 起拱高（直线段）
  wallDepth: 14.4,                      // 洞深（= 被切开的外墙带厚度）
  headTop: 19,                          // 拱上墙体高度（= H.body，拱门只是整面白墙上开的一个洞）
};

/** 竖向分区（全部为估算：公开资料只有各馆建筑面积，无高度） */
const H = {
  base: 7.5,        // 玻璃基座（"底层架空"）
  body: 19,         // 白色主体
  entrance: 26,     // WSW 入口 / 文化综合翼
  performing: 29,   // SSE 演艺中心翼
  flyTower: 36,     // 大剧院台塔
  library: 33,      // ENE 图书馆翼
  shushan: 38,      // "书山"玻璃圆塔顶（圆塔高 28m 为公开数据，起点示意）
};

/**
 * 光明文化艺术中心（"光明之眼"）
 *
 * 有依据：平面轮廓、地块范围、位置；"回"字形布局围合山水庭院、水面之上的拱形入口、
 *         纯白陶瓷板立面、岭南叠院式方块堆叠、一端似波浪起伏、大跨度连廊、
 *         演艺中心斜线玻璃幕墙、图书馆"书山"玻璃圆塔。
 * 估算/示意：所有高度、拱门尺寸、四翼功能归属、连廊与庭院布置、屋面设备。
 *
 * 按材质合并几何体（≤ 8 个 Mesh），无逐帧计算，全部 castShadow / receiveShadow。
 */
export function buildGuangmingCultureArtCenter(ctx: Context): THREE.Group {
  const group = new THREE.Group();
  group.name = "光明文化艺术中心 · 光明之眼";
  group.position.copy(ctx.project(ANCHOR));
  group.position.y = ctx.groundAt(ANCHOR);
  // 局部 +u（组内 +x）指向方位角 66.1°，+v（组内 +z）顺时针 90°
  group.rotation.y = THREE.MathUtils.degToRad(90 - BEARING_DEG);

  const materials = {
    white: new THREE.MeshStandardMaterial({ color: "#fbfbf9", roughness: 0.62 }),
    silver: new THREE.MeshStandardMaterial({ color: "#dde2e8", roughness: 0.45, metalness: 0.22 }),
    stone: new THREE.MeshStandardMaterial({ color: "#ede4d3", roughness: 0.78 }),
    glass: new THREE.MeshStandardMaterial({ color: "#33475c", roughness: 0.42, metalness: 0.18 }),
    feature: new THREE.MeshStandardMaterial({ color: "#e8c487", roughness: 0.55 }),
    water: new THREE.MeshStandardMaterial({ color: "#7fd3e0", roughness: 0.22, metalness: 0.1 }),
    green: new THREE.MeshStandardMaterial({ color: "#a6b98c", roughness: 0.85 }),
    shadow: new THREE.MeshStandardMaterial({ color: "#6f7d88", roughness: 0.8 }),
  };
  glowColor(materials.glass, "#ffe2b0", 1);

  type Key = keyof typeof materials;
  const batches = Object.fromEntries(Object.keys(materials).map((k) => [k, []])) as unknown as Record<Key, THREE.BufferGeometry[]>;
  const add = (key: Key, g: THREE.BufferGeometry) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    batches[key].push(geometry);
  };
  const box = (key: Key, u: number, y: number, v: number, w: number, h: number, d: number) =>
    add(key, new THREE.BoxGeometry(w, h, d).translate(u, y + h / 2, v));
  /** 长条盒体，局部 +z 对齐 dir 方向（用于沿墙面走向摆放的构件） */
  const bar = (key: Key, u: number, y: number, v: number, w: number, h: number, d: number, dir: Point) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(Math.atan2(dir[0], dir[1]));
    g.translate(u, y + h / 2, v);
    add(key, g);
  };
  const quad = (key: Key, a: number[], b: number[], c: number[], d: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d, ...c, ...b, ...a, ...d, ...c, ...a], 3));
    g.computeVertexNormals();
    add(key, g);
  };
  const shapeOf = (poly: Point[]) => new THREE.Shape(poly.map(([u, v]) => new THREE.Vector2(u, -v)));
  /** 把平面多边形（可选若干洞）拉成水平板。注意 shape 的 y 轴 = -v，所以洞也要同样取负。 */
  const slab = (key: Key, poly: Point[], y: number, h: number, holes: Point[][] = []) => {
    const shape = shapeOf(poly);
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, -v))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 16, steps: 1 });
    g.rotateX(-Math.PI / 2).translate(0, y, 0);
    add(key, g);
  };
  /** Sutherland–Hodgman：保留 f(p) ≥ 0 的部分（f 必须为线性函数，凸带要拆成两次裁剪） */
  const clip = (poly: Point[], f: (p: Point) => number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  const area = (poly: Point[]) => (poly.length < 3 ? 0 : Math.abs(poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2);
  /** 中庭洞口要么整块留下、要么整块去掉：按面积过滤被切碎的洞口残片 */
  const ARM_SOUTH = 38.5;
  const ARM_WEST = -72;
  const ARM_NORTH = -69.6;
  const armShape = (f: (p: Point) => number) => clip(OUTER, f);

  // 外墙带：沿"光明之眼"立面法向切出 0–wallDepth 与更深两部分，得到真正的拱门洞口
  const u1: Point = OUTER[1];
  const along = (p: Point) => (p[0] - u1[0]) * ARCH.dir[0] + (p[1] - u1[1]) * ARCH.dir[1];
  const depth = (p: Point) => (p[0] - u1[0]) * ARCH.inward[0] + (p[1] - u1[1]) * ARCH.inward[1];
  const half = ARCH.width / 2;
  const sA = along(ARCH.origin) - half;
  const sB = along(ARCH.origin) + half;
  const wallBand = (poly: Point[]) => clip(clip(poly, depth), (p) => ARCH.wallDepth - depth(p));

  const corePoly = clip(OUTER, (p) => depth(p) - ARCH.wallDepth);   // 主体（含中庭洞口）
  const wallA = clip(wallBand(OUTER), (p) => sA - along(p));        // 拱门左侧外墙
  const wallB = clip(wallBand(OUTER), (p) => along(p) - sB);        // 拱门右侧外墙

  // ── 主体：玻璃基座 + 白色体量；COURT 作为洞抠出，"回"字围合山水庭院 ──
  slab("glass", corePoly, 0, H.base, [COURT]);
  slab("white", corePoly, H.base, H.body - H.base, [COURT]);
  slab("white", wallA, 0, H.body);
  slab("white", wallB, 0, H.body);

  // ── 光明之眼：真实的半圆拱洞（洞深 14.4m，正面与外墙齐平），洞内是暗玻璃门厅 + 暖金内衬 ──
  // 注意：这里是竖直立面，用 shape 的 y 轴表示标高，不走 shapeOf（那个会把 v 取负，是给平面用的）
  const archFace = new THREE.Shape([
    new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0),
    new THREE.Vector2(half, ARCH.headTop), new THREE.Vector2(-half, ARCH.headTop),
  ]);
  const archHole = new THREE.Path();
  archHole.moveTo(-ARCH.radius, 0);
  archHole.lineTo(-ARCH.radius, ARCH.springY);
  archHole.absarc(0, ARCH.springY, ARCH.radius, Math.PI, 0, true);
  archHole.lineTo(ARCH.radius, 0);
  archHole.closePath();
  archFace.holes.push(archHole);
  const archPrism = new THREE.ExtrudeGeometry(archFace, { depth: ARCH.wallDepth, bevelEnabled: false, curveSegments: 24, steps: 1 });
  // 右手基（-沿墙方向, 上, 内向法线）把立面平面贴到真实外墙上
  archPrism.applyMatrix4(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-ARCH.dir[0], 0, -ARCH.dir[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(ARCH.inward[0], 0, ARCH.inward[1]),
  ).setPosition(ARCH.origin[0], 0, ARCH.origin[1]));
  add("white", archPrism);
  const outward: Point = [-ARCH.inward[0], -ARCH.inward[1]];
  const onFacade = (s: number, d: number): Point => [
    ARCH.origin[0] + ARCH.dir[0] * s + outward[0] * d,
    ARCH.origin[1] + ARCH.dir[1] * s + outward[1] * d,
  ];
  // 洞底的暗玻璃门厅墙面：位于墙体里侧（+inward），四周留出洞口内壁（拱券侧面）的深度感
  const caveL = onFacade(-half + 3, -(ARCH.wallDepth - 1));
  const caveR = onFacade(half - 3, -(ARCH.wallDepth - 1));
  quad("glass", [caveL[0], 0.6, caveL[1]], [caveR[0], 0.6, caveR[1]], [caveR[0], 13, caveR[1]], [caveL[0], 13, caveL[1]]);
  // 拱券的暖金饰带：沿半圆拱外缘凸出墙面一道连续的半环（不是散落的砖块）
  const bandShape = new THREE.Shape();
  bandShape.absarc(0, ARCH.springY, ARCH.radius, Math.PI, 0, true);
  bandShape.absarc(0, ARCH.springY, ARCH.radius + 0.7, 0, Math.PI, false);
  bandShape.closePath();
  const archBand = new THREE.ExtrudeGeometry(bandShape, { depth: 0.6, bevelEnabled: false, curveSegments: 24, steps: 1 });
  archBand.applyMatrix4(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-ARCH.dir[0], 0, -ARCH.dir[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(ARCH.inward[0], 0, ARCH.inward[1]),
  ).setPosition(ARCH.origin[0] + outward[0] * 0.5, 0, ARCH.origin[1] + outward[1] * 0.5));
  add("feature", archBand);

  // ── 四翼分区（示意）：SSE 演艺中心 / WSW 入口·文化综合 / NNW 美术馆·规划馆（波浪顶）/ ENE 图书馆 ──
  const southArm = armShape((p) => p[1] - ARM_SOUTH);
  const westArm = armShape((p) => ARM_WEST - p[0]);
  const northArm = armShape((p) => ARM_NORTH - p[1]);
  slab("white", southArm, H.body, H.performing - H.body);
  slab("silver", southArm, H.performing, 0.7);
  box("white", 0, H.performing, 60, 62, 7, 30);                 // 大剧院台塔（估算）
  box("silver", 0, H.flyTower, 60, 64, 0.9, 32);
  slab("white", westArm, H.body, H.entrance - H.body);
  slab("silver", westArm, H.entrance, 0.7);
  const wave = [4, 8, 12, 7, 13, 6, 2];
  const uStart = -100.3;
  const uStep = 188.8 / wave.length;
  for (let i = 0; i < wave.length; i += 1) {
    const slice = clip(clip(northArm, (p) => p[0] - (uStart + i * uStep)), (p) => uStart + (i + 1) * uStep - p[0]);
    slab("white", slice, H.body, wave[i]);
    slab("silver", slice, H.body + wave[i], 0.7);
  }
  box("white", 74, H.body, -60, 26, H.library - H.body, 40);     // ENE 图书馆体量
  box("silver", 74, H.library, -60, 27, 0.7, 41);

  // 图书馆"书山"玻璃圆塔（塔高 28m 为公开数据；这里做成穿出屋面的圆柱，示意）
  add("glass", new THREE.CylinderGeometry(6, 6, H.shushan - 2, 24, 1, false).translate(74, (H.shushan - 2) / 2 + 2, -60));
  add("feature", new THREE.CylinderGeometry(6.3, 6.3, 0.5, 24).translate(74, H.shushan, -60));

  // 演艺中心立面的斜线玻璃幕墙（报道："斜线延展开来的玻璃幕墙"，位置与角度示意）
  const p2: Point = OUTER[2];
  const p3: Point = OUTER[3];
  const edgeLen = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const edgeDir: Point = [(p3[0] - p2[0]) / edgeLen, (p3[1] - p2[1]) / edgeLen];
  const edgeOut: Point = [-edgeDir[1], edgeDir[0]];
  const southFacade = (s: number, d: number, y: number): number[] => [
    p2[0] + edgeDir[0] * s + edgeOut[0] * d, y, p2[1] + edgeDir[1] * s + edgeOut[1] * d,
  ];
  quad("glass", southFacade(8, 0.3, 5.5), southFacade(edgeLen - 8, 0.3, 5.5), southFacade(edgeLen - 8, 0.3, H.performing - 1), southFacade(8, 0.3, 12.5));
  quad("feature", southFacade(8, 0.55, 12.5), southFacade(edgeLen - 8, 0.55, H.performing - 1), southFacade(edgeLen - 8, 0.55, H.performing - 0.2), southFacade(8, 0.55, 13.3));

  // ── 山水庭院：铺装、水面、绿岛、底层玻璃、跨院连廊 ──
  slab("stone", COURT, 0, 0.8);
  slab("water", [
    [POND[0][0] + 5, POND[0][1] + 5], [POND[1][0] - 5, POND[1][1] + 5],
    [POND[2][0] - 5, POND[2][1] - 5], [POND[3][0] + 5, POND[3][1] - 5],
  ], 0.8, 0.35);
  box("green", -19.5, 1.15, -66.3, 60, 0.5, 3.8);
  box("green", 12.2, 1.15, -40, 4.5, 0.5, 40);
  box("green", -51.4, 1.15, -40, 4.5, 0.5, 40);
  for (let i = 0; i < COURT.length; i += 1) {                    // 庭院四壁底层玻璃带
    const a = COURT[i];
    const b = COURT[(i + 1) % COURT.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = new THREE.BoxGeometry(len, 6, 1.6);
    g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])).translate((a[0] + b[0]) / 2, 3, (a[1] + b[1]) / 2);
    add("glass", g);
  }
  // 跨院连廊（报道："56m 大跨度连廊"，这里做成跨越山水庭院的两层桥，示意）
  box("white", -20, 9, -41.8, 56, 3.4, 8);
  box("feature", -20, 8.4, -41.8, 56.6, 0.7, 8.4);
  box("white", -18.5, 13.4, -40, 8, 3.4, 48);
  box("feature", -18.5, 12.8, -40, 8.4, 0.7, 48);

  // ── 入口广场：拱门外的浅池与层叠涟漪 ──
  const pool = onFacade(0, ARCH.wallDepth / 2 + 20);
  const poolRect = (a: number, b: number): Point[] => [
    [pool[0] + ARCH.dir[0] * a + outward[0] * b, pool[1] + ARCH.dir[1] * a + outward[1] * b],
    [pool[0] + ARCH.dir[0] * a - outward[0] * b, pool[1] + ARCH.dir[1] * a - outward[1] * b],
    [pool[0] - ARCH.dir[0] * a - outward[0] * b, pool[1] - ARCH.dir[1] * a - outward[1] * b],
    [pool[0] - ARCH.dir[0] * a + outward[0] * b, pool[1] - ARCH.dir[1] * a + outward[1] * b],
  ];
  slab("stone", poolRect(42, 17), 0, 0.5);
  slab("water", poolRect(39, 14), 0.5, 0.3);
  for (const d of [1.5, 4.5, 8]) {
    const p = onFacade(0, d);
    bar("stone", p[0], 0.2, p[1], 1.8, 0.6, 62 - d * 2.5, ARCH.dir);
  }

  // ── 屋面设备与采光带（示意分布，公开资料无屋面信息）──
  for (const [u, v, w, d, h] of [[-60, 60, 18, 12, 3], [30, 70, 14, 10, 2.6], [74, -60, 16, 10, 2.8], [56, 12, 12, 8, 2.4]] as number[][]) {
    box("shadow", u, H.body, v, w, h, d);
  }
  for (const v of [-6, 2]) box("silver", -24, H.body, v, 92, 1.1, 3.4);

  for (const key of Object.keys(materials) as Key[]) {
    if (!batches[key].length) {
      materials[key].dispose();
      continue;
    }
    const geometry = mergeGeometries(batches[key], false)!;
    batches[key].forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = `光明文化艺术中心/${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.userData.evidence = {
    anchor: ANCHOR,
    bearingDeg: BEARING_DEG,
    bearingSource: "轮廓最小外接矩形（data/landmark-production.json 该条目 bearingDeg 为 null）",
    scale: SCALE,
    outline: "OSM way 919126944（building=public，19 顶点）→ public/sandbox/sandbox.json buildings[]（按锚点最近轮廓匹配）",
    verifiedAt: "2026-10-05",
    height: "估算",
    detail: "拱门尺寸、四翼分区、连廊与庭院布置为示意",
  };
  return group;
}
