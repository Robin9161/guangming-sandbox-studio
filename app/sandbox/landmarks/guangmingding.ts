import * as THREE from "three";
import { glowColor } from "../scene/atmosphere";

/**
 * 光明顶（科学公园"科学顶" · 360° 环廊观景台）
 *
 * 真实依据：
 * - 平面轮廓：OSM 真实环廊外沿（public/sandbox/landmarks/guangmingding.json，
 *   scripts/landmarks/guangmingding.mjs 生成），51m × 60m 圆角三角环，
 *   外沿周长约 181m；位置与朝向经 Esri z18 卫星图复核（柴山山顶白色圆角三角环）。
 *   建模时用 Catmull-Rom 把 14 边形光顺成连续曲线，还原真实的光滑环形。
 * - 环廊周长 156.1m（与光明区面积 156.1km² 对应）出自公开报道（南方+ 2024-07-13），
 *   与 OSM 外沿换算的廊道中心线周长吻合。
 * - 造型：深圳微时光航拍/近景（2024-07-10）——
 *   ① 细柱把环廊架在树冠之上；② 步道外沿玻璃栏板 + 金属扶手；
 *   ③ 步道与屋顶之间是玻璃围合的展廊层，带竖向白色框柱；
 *   ④ 碟形屋顶大幅出挑、向檐口收薄、剖面有阶梯感；
 *   ⑤ 内院露天，航拍可见一棵树；⑥ 步道上有"天空之镜"镜面打卡区；
 *   ⑦ 东侧有登山步道接上环廊（卫星图可见路径）。
 *
 * 估算：架空高度（约 7m）、各层层高、屋面收分尺寸、柱位与柱距均无公开数据，
 * 按照片比例估算；"天空之镜"以一块镜面面板示意；内院树木为示意。
 *
 * 环廊约 60m 跨，以轮廓中心为基准放大 1.25 倍。
 */

type Pt = [number, number];
type Ctx = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };

// 环廊真实外沿轮廓（OSM，本地米制）——生成自 scripts/landmarks/guangmingding.mjs
const RING: Pt[] = [
  [1137.4, -2466.0], [1126.1, -2457.8], [1117.0, -2445.8], [1112.6, -2437.0], [1111.7, -2422.3],
  [1116.3, -2414.9], [1129.5, -2408.9], [1150.4, -2409.5], [1159.6, -2413.5], [1163.1, -2418.9],
  [1160.8, -2448.5], [1158.5, -2458.1], [1154.0, -2466.6], [1148.8, -2468.8],
];
const ANCHOR: [number, number] = [113.940103, 22.783972];
const SCALE = 1.25;

/** Catmull-Rom 光顺：把稀疏多边形变成光滑闭环（真实环廊是连续曲线，不是折线） */
function smoothRing(ring: Pt[], samples = 72): Pt[] {
  const curve = new THREE.CatmullRomCurve3(
    ring.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal",
  );
  return curve.getPoints(samples).map((p) => [p.x, p.z] as Pt);
}

const centroidOf = (ring: Pt[]): Pt => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const scaleAbout = (ring: Pt[], c: Pt, s: number): Pt[] => ring.map(([x, z]) => [c[0] + (x - c[0]) * s, c[1] + (z - c[1]) * s]);

/** 沿多边形周长均匀采样 n 个点 */
function sampleRing(ring: Pt[], n: number): Pt[] {
  const pts: Pt[] = [];
  const edges = ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const total = edges.reduce((s, e) => s + e.len, 0);
  let acc = 0;
  let ei = 0;
  for (let i = 0; i < n; i += 1) {
    const target = (i / n) * total;
    while (ei < edges.length - 1 && acc + edges[ei].len < target) {
      acc += edges[ei].len;
      ei += 1;
    }
    const e = edges[ei];
    const t = Math.min(1, Math.max(0, (target - acc) / e.len));
    pts.push([e.p[0] + (e.q[0] - e.p[0]) * t, e.p[1] + (e.q[1] - e.p[1]) * t]);
  }
  return pts;
}

/** 环形带挤出：外轮廓挖内孔（innerScale ≤ 0 时实心），bevel 收边 */
function band(outer: Pt[], innerScale: number, bottom: number, height: number, material: THREE.Material, center: Pt, bevel = 0) {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  if (innerScale > 0) {
    const hole = new THREE.Path(scaleAbout(outer, center, innerScale).map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.3, height - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom + bevel, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function buildGuangmingding(ctx: Ctx): THREE.Group {
  const group = new THREE.Group();
  group.name = "landmark-guangmingding";

  const white = mat("#fbfbf9", 0.45);
  const silver = mat("#dde2e8", 0.4, 0.15);
  const soffit = mat("#c9cfd8", 0.55, 0.05); // 檐底/底板背光面（银色系深色）
  const glass = mat("#33475c", 0.2, 0.1);
  glowColor(glass, "#cfe6ff", 1.0);
  const mirror = mat("#eef4f8", 0.08, 0.85); // 天空之镜（特征材质：镜面）
  const stone = mat("#ede4d3", 0.8);

  const center = centroidOf(RING);
  const smooth = smoothRing(RING);
  const outer = scaleAbout(smooth, center, SCALE);
  const ground = ctx.groundAt(ANCHOR);
  const deckBottom = ground + 7; // 架空层（估算 7m，照片：环廊浮在树冠之上）

  // —— 山顶平台（石材圆盘，把柱脚收在一个基面上，估算） ——
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(11 * SCALE, 12.5 * SCALE, 2.2, 32), stone);
  plaza.position.set(center[0], ground + 0.2, center[1]);
  plaza.receiveShadow = true;
  group.add(plaza);

  // —— 支撑：外圈 14 根直柱 + 内圈 7 对 V 形斜撑（近景照可见成对的斜向支撑，估算柱位） ——
  const columnGeo = new THREE.CylinderGeometry(0.5, 0.7, 22, 8);
  const columns = new THREE.InstancedMesh(columnGeo, silver, 14);
  const cm = new THREE.Matrix4();
  sampleRing(scaleAbout(outer, center, 0.9), 14).forEach(([x, z], i) => {
    cm.makeTranslation(x, deckBottom - 11, z);
    columns.setMatrixAt(i, cm);
  });
  columns.castShadow = true;
  group.add(columns);
  const strutGeo = new THREE.CylinderGeometry(0.35, 0.5, 16, 6);
  strutGeo.translate(0, -8, 0);
  strutGeo.rotateZ(0.32);
  const struts = new THREE.InstancedMesh(strutGeo, silver, 14);
  const qA = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  sampleRing(scaleAbout(outer, center, 0.76), 7).forEach(([x, z], i) => {
    const yaw = Math.atan2(x - center[0], z - center[1]); // 朝内倾
    qA.setFromAxisAngle(up, yaw);
    cm.compose(new THREE.Vector3(x, deckBottom - 0.2, z), qA, new THREE.Vector3(1, 1, 1));
    struts.setMatrixAt(i * 2, cm);
    qA.setFromAxisAngle(up, yaw + Math.PI);
    cm.compose(new THREE.Vector3(x, deckBottom - 0.2, z), qA, new THREE.Vector3(1, 1, 1));
    struts.setMatrixAt(i * 2 + 1, cm);
  });
  struts.castShadow = true;
  group.add(struts);

  // —— 360° 观景步道：白色面板 + 灰色底板（内孔 0.72，板厚 1.4m，估算） ——
  group.add(band(outer, 0.72, deckBottom, 1.0, white, center));
  group.add(band(scaleAbout(outer, center, 0.985), 0.735, deckBottom - 0.5, 0.5, soffit, center));

  // —— 步道外沿：玻璃栏板 + 金属扶手 + 立柱（近景照的层次） ——
  const railing = band(outer, 0.968, deckBottom + 1.0, 1.0, glass, center);
  railing.castShadow = false;
  group.add(railing);
  group.add(band(scaleAbout(outer, center, 1.004), 0.962, deckBottom + 2.0, 0.14, silver, center)); // 扶手
  const postGeo = new THREE.BoxGeometry(0.14, 1.15, 0.14);
  const railPosts = new THREE.InstancedMesh(postGeo, silver, 36);
  sampleRing(scaleAbout(outer, center, 0.986), 36).forEach(([x, z], i) => {
    cm.makeTranslation(x, deckBottom + 1.58, z);
    railPosts.setMatrixAt(i, cm);
  });
  group.add(railPosts);

  // —— 展廊玻璃层 + 竖向白框柱（步道与屋顶之间，高 3.4m，估算） ——
  const galleryBottom = deckBottom + 1.4;
  group.add(band(scaleAbout(outer, center, 0.94), 0.755, galleryBottom, 3.4, glass, center));
  const mullionGeo = new THREE.BoxGeometry(0.85, 3.4, 0.85);
  const mullions = new THREE.InstancedMesh(mullionGeo, white, 14);
  sampleRing(scaleAbout(outer, center, 0.94), 14).forEach(([x, z], i) => {
    cm.makeTranslation(x, galleryBottom + 1.7, z);
    mullions.setMatrixAt(i, cm);
  });
  mullions.castShadow = true;
  group.add(mullions);

  // —— 碟形屋顶（三段收分：深檐底带 → 出挑斜边 → 顶面步道缝，均估算） ——
  const roofBottom = galleryBottom + 3.4;
  group.add(band(scaleAbout(outer, center, 1.05), 0.686, roofBottom, 1.7, white, center)); // 深檐底带
  group.add(band(scaleAbout(outer, center, 1.13), 0.637, roofBottom + 1.7, 1.0, white, center, 0.45)); // 出挑斜边
  // 顶面接缝线（抬离斜边顶面 2cm，避免共面 z-fighting）
  group.add(band(scaleAbout(outer, center, 1.04), 0.68, roofBottom + 2.72, 0.22, silver, center));
  // 檐底阴影带（让剖面更挺）
  group.add(band(scaleAbout(outer, center, 1.02), 0.7, roofBottom - 0.35, 0.35, soffit, center));

  // —— 天空之镜（步道内侧的镜面打卡区，示意一块镜面板） ——
  const mirrorPanel = new THREE.Mesh(new THREE.BoxGeometry(9, 0.15, 5), mirror);
  const mirrorAt = scaleAbout(outer, center, 0.86)[Math.round(outer.length * 0.14)];
  mirrorPanel.position.set(mirrorAt[0], deckBottom + 1.12, mirrorAt[1]);
  group.add(mirrorPanel);

  // —— 内院一棵树（航拍可见，示意） ——
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 6), mat("#8a6f56", 0.8));
  trunk.position.set(center[0] + 3, ground + 2.6, center[1] + 2);
  trunk.castShadow = true;
  const crownMat = mat("#9dbb8e", 0.85);
  const crownA = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), crownMat);
  crownA.position.set(center[0] + 3, ground + 6.2, center[1] + 2);
  crownA.castShadow = true;
  const crownB = new THREE.Mesh(new THREE.SphereGeometry(2.3, 9, 7), crownMat);
  crownB.position.set(center[0] + 1.2, ground + 8.0, center[1] + 3.4);
  crownB.castShadow = true;
  group.add(trunk, crownA, crownB);

  // —— 东侧登山步道接桥（卫星图可见东侧路径，估算：缓坡接地） ——
  const eastPt = scaleAbout(outer, center, 1.0).reduce((a, b) => (b[0] > a[0] ? b : a));
  const bridgeLen = 42;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(bridgeLen, 1.1, 3.6), white);
  bridge.position.set(eastPt[0] + bridgeLen / 2 - 1, deckBottom + 0.3, eastPt[1]);
  bridge.rotation.z = -0.12; // 向东缓降
  bridge.castShadow = true;
  bridge.receiveShadow = true;
  group.add(bridge);
  const bridgePostGeo = new THREE.CylinderGeometry(0.4, 0.5, 14, 6);
  const bridgePosts = new THREE.InstancedMesh(bridgePostGeo, silver, 3);
  for (let i = 0; i < 3; i += 1) {
    cm.makeTranslation(eastPt[0] + 10 + i * 13, deckBottom - 6 - i * 1.5, eastPt[1]);
    bridgePosts.setMatrixAt(i, cm);
  }
  bridgePosts.castShadow = true;
  group.add(bridgePosts);

  return group;
}
