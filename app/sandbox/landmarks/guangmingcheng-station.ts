import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";

/**
 * 光明城站（精细版 v2：站房 / 站台雨棚分区建模）
 *
 * 真实依据：
 * - 平面轮廓：OSM 真实站房轮廓（public/sandbox/landmarks/guangmingcheng-station.json，
 *   由 scripts/landmarks/guangmingcheng-station.mjs 从 sandbox.json 提取），460m × 119m，
 *   长轴方位角约 4°，与 data/hero-landmarks.json 锚点 113.9499, 22.73558 一致。
 * - 平面分区：Esri z18 卫星图（assets/landmark-work/guangmingcheng-station/refs/esri-satellite-corrected.png）
 *   显示站房是一个偏西侧的独立矩形体量，主站台雨棚在其东侧、沿轨道向南北两端
 *   远远伸出站房范围；屋面均有纵向采光带。
 * - 造型：官方航拍（official-station-front.jpg / eyeshenzhen-aerial.jpg）——
 *   站房为玻璃幕墙 + 竖向石材柱列 + 白色檐口；站台雨棚为白色空间桁架拱顶，
 *   由一排 Y 形分叉柱支撑；红色"光明城"大字立在站房屋面前缘；站前为广场与下客雨棚；
 *   两端接高架桥。
 *
 * 估算：层高（站房 20m / 站台层 +11m / 雨棚起拱 +21.5m）、拱顶半径、Y 柱间距与分叉角、
 * 高架桥延伸长度、采光带宽度均无公开数据，按照片比例估算。红色站名用体量字块示意。
 *
 * station 本体已有 460m 长，不做整体放大（scale = 1）。
 */

type Pt = [number, number];
type Ctx = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };

// 站房真实轮廓（OSM，本地米制坐标，x 东 z 南），生成自 scripts/landmarks/guangmingcheng-station.mjs
const STATION_RING: Pt[] = [
  [2193.2, 2798.5], [2194.1, 2775.5], [2146.9, 2773.8], [2143.6, 2866.9], [2138.2, 2866.8],
  [2141.6, 2773.6], [2098.7, 2772.0], [2095.3, 2864.2], [2090.1, 2864.0], [2085.6, 2988.8],
  [2090.8, 2989.0], [2082.1, 3227.3], [2124.4, 3228.8], [2133.1, 2989.9], [2139.1, 2990.1],
  [2130.5, 3229.0], [2177.5, 3230.8], [2185.4, 3013.0], [2193.2, 3013.3], [2200.9, 2798.8],
];
const ANCHOR: [number, number] = [113.9499, 22.73558];

/** 最小外接矩形主轴（与 scene/landmarks.ts 同一算法） */
function principalAxis(ring: Pt[]) {
  let best = { area: Infinity, angle: 0, length: 0, width: 0 };
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const angle = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s;
      const v = -x * s + z * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) best = { area, angle, length: maxU - minU, width: maxV - minV };
  }
  const angle = best.length >= best.width ? best.angle : best.angle + Math.PI / 2;
  return { dir: [Math.cos(angle), Math.sin(angle)] as Pt, length: Math.max(best.length, best.width), width: Math.min(best.length, best.width) };
}

const centroidOf = (ring: Pt[]): Pt => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const scaleRing = (ring: Pt[], [cx, cz]: Pt, s: number): Pt[] => ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]);

/** 轮廓挤出成体量（与 scene/landmarks.ts 的 slab 一致） */
function slab(ring: Pt[], bottom: number, height: number, material: THREE.Material, bevel = 0) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.5, height - bevel * 2),
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

export function buildGuangmingchengStation(ctx: Ctx): THREE.Group {
  const group = new THREE.Group();
  group.name = "landmark-guangmingcheng-station";

  const center = centroidOf(STATION_RING);
  const { dir, length, width } = principalAxis(STATION_RING);
  const normal: Pt = [-dir[1], dir[0]];
  const yawX = Math.atan2(-dir[1], dir[0]); // 让局部 +X 对齐轨道方向（BoxGeometry 用）
  const yawZ = Math.atan2(dir[0], dir[1]); // 让局部 +Z 对齐轨道方向（拱顶 / 字块用）
  const base = ctx.groundAt(ANCHOR) - 0.5;
  const halfW = width / 2;
  // normal 的哪一侧朝西（站房与广场在轨道西侧，卫星图与航拍一致）
  const w = normal[0] < 0 ? 1 : -1;
  /** 轨道向 u、横向 v（v>0 朝西）→ 世界坐标 */
  const at = (u: number, v: number): Pt => [
    center[0] + dir[0] * u + normal[0] * w * v,
    center[1] + dir[1] * u + normal[1] * w * v,
  ];
  const box = (size: [number, number, number], material: THREE.Material, u: number, v: number, y: number, yaw = yawX) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    const [x, z] = at(u, v);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const white = mat("#fbfbf9", 0.5);
  const silver = mat("#dde2e8", 0.45, 0.12);
  const glass = mat("#33475c", 0.22, 0.1);
  glowColor(glass, "#ffe2b0", 1.0);
  const red = mat("#c9402f", 0.55); // 屋面"光明城"红字（特征色）
  const stone = mat("#ede4d3", 0.8);

  // —— 基座平台：460m 站房落在微坡地形上（估算） ——
  group.add(slab(scaleRing(STATION_RING, center, 1.04), base - 2.5, 2.5, stone));

  // —— 站房（轨道西侧，长约 150m × 深 56m × 高 20m，卫星图量取平面，高度估算） ——
  const hallLen = 150;
  const hallV = halfW - 30; // 站房中心横向位置（v 朝西为正）
  // 玻璃幕墙主体
  box([hallLen, 18, 54], glass, 0, hallV, base + 1.5 + 9);
  // 竖向石材柱列（西立面，航拍可见的柱式节奏，估算柱距 7.9m）
  const pierGeo = new THREE.BoxGeometry(1.6, 18, 1.4);
  const pierCount = 19;
  const piers = new THREE.InstancedMesh(pierGeo, stone, pierCount);
  const pm = new THREE.Matrix4();
  const pierYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawX);
  for (let i = 0; i < pierCount; i += 1) {
    const u = -71 + (142 / (pierCount - 1)) * i;
    const [x, z] = at(u, hallV + 27.2);
    pm.compose(new THREE.Vector3(x, base + 1.5 + 9, z), pierYaw, new THREE.Vector3(1, 1, 1));
    piers.setMatrixAt(i, pm);
  }
  piers.castShadow = piers.receiveShadow = true;
  group.add(piers);
  // 白色檐口 + 屋面 + 屋面纵向采光带（卫星图可见）
  box([hallLen + 1.5, 1.6, 56.5], white, 0, hallV, base + 20.3);
  box([hallLen - 3, 1.2, 52], silver, 0, hallV, base + 21.7);
  box([118, 0.5, 4], glass, 0, hallV + 12, base + 22.5);
  box([118, 0.5, 4], glass, 0, hallV - 12, base + 22.5);
  // 中央入口（石材门框，估算）
  box([26, 12, 3], stone, 0, hallV + 28.2, base + 7.5);

  // —— 红色"光明城"大字：立在站房屋面西缘（三块字块 + 支架腿，示意） ——
  const legGeo = new THREE.CylinderGeometry(0.28, 0.28, 2.5, 6);
  const legs = new THREE.InstancedMesh(legGeo, silver, 6);
  let li = 0;
  for (const i of [-1, 0, 1]) {
    const u = i * 16;
    const [sx, sz] = at(u, hallV + 21);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(6.2, 6, 1.4), red);
    sign.position.set(sx, base + 24.7 + 3, sz);
    sign.rotation.y = yawZ; // 字面朝西（站前广场方向）
    sign.castShadow = true;
    group.add(sign);
    for (const du of [-1.8, 1.8]) {
      const [lx, lz] = at(u + du, hallV + 21);
      pm.compose(new THREE.Vector3(lx, base + 22.3 + 1.25, lz), pierYaw, new THREE.Vector3(1, 1, 1));
      legs.setMatrixAt(li, pm);
      li += 1;
    }
  }
  legs.castShadow = true;
  group.add(legs);

  // —— 站台层（轨道东侧，+11m 架空，估算） ——
  const canopyLen = length * 1.02;
  const canopyV = -(halfW - 27); // 雨棚中心横向位置（站房东侧）
  const deckY = base + 11;
  box([canopyLen, 2, 50], silver, 0, canopyV, deckY + 1);
  // 站房与雨棚之间的到发线槽（深色轨床，贯通雨棚与两端高架，估算）
  const trackBed = mat("#4a4f57", 0.85);
  box([canopyLen + 250, 1.2, 12], trackBed, 0, -2.5, deckY + 1.6);

  // —— 站台雨棚：白色空间桁架拱顶（圆柱壳截面，拱高约 4m，估算；整体抬到站房屋面之上，与航拍比例一致） ——
  const springY = deckY + 12.5; // 起拱线
  const archRise = 4;
  const halfSpan = 25;
  const R = (archRise * archRise + halfSpan * halfSpan) / (2 * archRise); // ≈ 80
  const theta = Math.asin(halfSpan / R);
  const archGeo = new THREE.CylinderGeometry(R, R, canopyLen, 14, 1, true, -theta, theta * 2);
  archGeo.rotateX(-Math.PI / 2); // 拱起朝上，长度沿局部 Z
  const archMat = mat("#fbfbf9", 0.45, 0.05);
  archMat.side = THREE.DoubleSide;
  const arch = new THREE.Mesh(archGeo, archMat);
  const [ax, az] = at(0, canopyV);
  arch.position.set(ax, springY + archRise - R, az);
  arch.rotation.y = yawZ;
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);
  // 檐口封边（包住壳体切口）
  box([canopyLen, 2.4, 1.2], white, 0, canopyV + halfSpan, springY + 0.4);
  box([canopyLen, 2.4, 1.2], white, 0, canopyV - halfSpan, springY + 0.4);
  // 雨棚顶面两道纵向采光带（卫星图可见，估算位置）
  for (const dv of [-9, 9]) {
    const y = springY + archRise - (R - Math.sqrt(R * R - dv * dv));
    box([canopyLen * 0.97, 0.5, 4.5], glass, 0, canopyV + dv, y + 0.2);
  }

  // —— Y 形分叉柱（航拍特征：一排 Y 柱撑起雨棚，估算柱距 30m、分叉角约 40°） ——
  const trunk = new THREE.CylinderGeometry(0.9, 1.3, 7, 6);
  trunk.translate(0, 3.5, 0);
  const branchLen = 5.4;
  const branchA = new THREE.CylinderGeometry(0.55, 0.75, branchLen, 6);
  branchA.translate(0, branchLen / 2, 0);
  branchA.rotateX(0.86);
  branchA.translate(0, 6.8, 0);
  const branchB = new THREE.CylinderGeometry(0.55, 0.75, branchLen, 6);
  branchB.translate(0, branchLen / 2, 0);
  branchB.rotateX(-0.86);
  branchB.translate(0, 6.8, 0);
  const yColumnGeo = mergeGeometries([trunk, branchA, branchB]);
  const columnUs: number[] = [];
  for (let u = -225; u <= 225; u += 30) columnUs.push(u);
  const yColumns = new THREE.InstancedMesh(yColumnGeo, white, columnUs.length * 2);
  let ci = 0;
  for (const side of [-1, 1]) {
    for (const u of columnUs) {
      const [x, z] = at(u, canopyV + side * (halfSpan - 2.5));
      pm.compose(new THREE.Vector3(x, deckY + 2, z), pierYaw, new THREE.Vector3(1, 1, 1));
      yColumns.setMatrixAt(ci, pm);
      ci += 1;
    }
  }
  yColumns.castShadow = true;
  group.add(yColumns);

  // —— 两端高架桥延伸（估算伸出 130m，箱梁 + 桥墩 + 挡板） ——
  const pierGeoV = new THREE.CylinderGeometry(2.2, 2.6, deckY - base, 8);
  const viaductPiers = new THREE.InstancedMesh(pierGeoV, silver, 8);
  let pi = 0;
  for (const end of [-1, 1]) {
    const uc = end * (canopyLen / 2 + 60);
    box([130, 3.2, 12], mat("#f5f2ec", 0.6), uc, canopyV, deckY + 1.6);
    box([130, 1.1, 0.6], silver, uc, canopyV + 5.8, deckY + 3.7);
    box([130, 1.1, 0.6], silver, uc, canopyV - 5.8, deckY + 3.7);
    for (let i = 0; i < 4; i += 1) {
      const u = end * (canopyLen / 2 + 20 + i * 32);
      const [x, z] = at(u, canopyV);
      pm.compose(new THREE.Vector3(x, base + (deckY - base) / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      viaductPiers.setMatrixAt(pi, pm);
      pi += 1;
    }
  }
  viaductPiers.castShadow = true;
  group.add(viaductPiers);

  // —— 站前广场与下客雨棚（轨道西侧，估算） ——
  box([170, 1.2, 40], stone, 0, halfW + 21, base + 0.6);
  box([150, 1, 9], silver, 0, halfW + 4.5, base + 6.5);
  const postGeo = new THREE.CylinderGeometry(0.3, 0.3, 6.5, 6);
  const posts = new THREE.InstancedMesh(postGeo, silver, 10);
  for (let i = 0; i < 10; i += 1) {
    const u = -67.5 + i * 15;
    const [x, z] = at(u, halfW + 7.5);
    pm.compose(new THREE.Vector3(x, base + 3.25, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, pm);
  }
  posts.castShadow = true;
  group.add(posts);

  return group;
}
