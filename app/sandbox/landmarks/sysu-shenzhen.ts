import * as THREE from "three";
import { glowColor } from "../scene/atmosphere";

/**
 * 中山大学深圳校区（核心组团）
 *
 * 真实依据：
 * - 位置与朝向：data/landmark-production.json 锚点 113.948192, 22.80366，bearingDeg 130
 *  （核心建筑群主轴西北→东南，中山大学官方规划资料 + Esri World Imagery z18 复核）。
 * - 图书馆：OSM 真实轮廓（19 边形近八边形，72m 跨，public/sandbox/landmarks/sysu-shenzhen.json，
 *   scripts/landmarks/sysu-shenzhen.mjs 生成），与 Esri 卫星图上的八边形图书馆平台一致；
 *   红砖外墙、顶部拱廊、蓝色玻璃坡屋顶按官方航拍（photo-library-aerial.jpeg）建模。
 * - 西侧圆形体量：OSM 轮廓与卫星图上的圆楼一致，按红砖穹顶演绎。
 * - 南侧 104×102m 公共建筑：OSM 真实轮廓（t=public），作红砖教学科研楼。
 *
 * 估算：校区整体约 3km 跨度的山林校园，模型只取锚点 240m 内核心组团；建筑层数按 OSM 高度、
 * 细部（拱廊、窗带、穹顶）为示意。整体以图书馆中心为基准放大 1.3 倍。
 */

type Pt = [number, number];
type Ctx = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };

// 图书馆真实轮廓（OSM，本地米制）——生成自 scripts/landmarks/sysu-shenzhen.mjs
const LIBRARY_RING: Pt[] = [
  [1986.9, -4591.3], [1997.9, -4593.8], [2007.6, -4599.5], [2015.0, -4608.0], [2019.4, -4618.4],
  [2020.4, -4629.6], [2017.9, -4640.6], [2012.1, -4650.3], [2002.6, -4658.2], [1990.9, -4662.5],
  [1978.5, -4662.5], [1966.8, -4658.3], [1957.2, -4650.3], [1951.0, -4639.6], [1948.7, -4627.4],
  [1950.8, -4615.1], [1956.9, -4604.3], [1965.4, -4596.8], [1975.7, -4592.4],
];
// 南侧大型公共建筑真实轮廓（OSM，t=public，h=18）
const SOUTH_RING: Pt[] = [
  [2071.2, -4711.4], [2038.7, -4677.7], [2038.0, -4670.4], [2051.8, -4626.4], [2057.2, -4621.1],
  [2102.3, -4611.1], [2109.8, -4612.8], [2141.2, -4647.8], [2142.5, -4655.6], [2129.4, -4697.5],
  [2123.4, -4703.2], [2077.2, -4713.2],
];
// 西侧圆楼真实轮廓（OSM 片段，约 20m 跨）
const ROTUNDA_RING: Pt[] = [
  [1904.5, -4560.7], [1894.4, -4547.6], [1901.5, -4542.1], [1914.4, -4558.7], [1909.7, -4562.4], [1906.9, -4558.9],
];
const ANCHOR: [number, number] = [113.948192, 22.80366];
const SCALE = 1.3;

const centroidOf = (ring: Pt[]): Pt => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const scaleAbout = (ring: Pt[], c: Pt, s: number): Pt[] => ring.map(([x, z]) => [c[0] + (x - c[0]) * s, c[1] + (z - c[1]) * s]);

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

export function buildSysuShenzhen(ctx: Ctx): THREE.Group {
  const group = new THREE.Group();
  group.name = "landmark-sysu-shenzhen";

  const brick = mat("#8d4e3c", 0.75); // 红砖（特征色，.palette.brick）
  const stone = mat("#ede4d3", 0.8); // 石材基座/拱廊
  const roofBlue = mat("#3d5a80", 0.35, 0.15); // 蓝色玻璃坡屋顶（特征色）
  glowColor(roofBlue, "#bcd4ff", 0.7);
  const glass = mat("#33475c", 0.25, 0.1);
  glowColor(glass, "#ffe2b0", 0.8);
  const white = mat("#fbfbf9", 0.55);

  const libCenter = centroidOf(LIBRARY_RING);
  const base = ctx.groundAt(ANCHOR) - 0.5;

  // 整体放大 1.3：以图书馆中心为基准缩放各轮廓
  const libraryRing = scaleAbout(LIBRARY_RING, libCenter, SCALE);
  const southRing = scaleAbout(SOUTH_RING, libCenter, SCALE);
  const rotundaCenter = centroidOf(ROTUNDA_RING);
  const rotundaC: Pt = [libCenter[0] + (rotundaCenter[0] - libCenter[0]) * SCALE, libCenter[1] + (rotundaCenter[1] - libCenter[1]) * SCALE];

  // —— 图书馆：石材基座 + 红砖鼓座 + 拱廊带 + 收分上层 + 蓝色玻璃坡屋顶 ——
  group.add(slab(scaleAbout(libraryRing, libCenter, 1.06), base, 2.5, stone)); // 基座平台
  group.add(slab(libraryRing, base + 2.5, 13, brick, 0.6)); // 主体鼓座（估算层高，总高对齐 OSM 16.7m）
  group.add(slab(scaleAbout(libraryRing, libCenter, 0.99), base + 15.5, 2.6, stone)); // 顶部拱廊带（示意）
  group.add(slab(scaleAbout(libraryRing, libCenter, 0.82), base + 18.1, 7, brick, 0.5)); // 收分上层
  const roofBase = base + 25.1;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(33 * SCALE, 14, 8), roofBlue);
  roof.position.set(libCenter[0], roofBase + 7, libCenter[1]);
  roof.rotation.y = Math.PI / 8; // 让棱线与八边形对齐
  roof.castShadow = true;
  group.add(roof);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 4, 8), white);
  lantern.position.set(libCenter[0], roofBase + 15, libCenter[1]);
  lantern.castShadow = true;
  group.add(lantern);

  // —— 西侧圆楼：红砖鼓座 + 石材檐口 + 深蓝穹顶（按卫星图与 OSM 轮廓演绎） ——
  const rotundaR = 11 * SCALE;
  const rotunda = new THREE.Mesh(new THREE.CylinderGeometry(rotundaR, rotundaR, 12, 20), brick);
  rotunda.position.set(rotundaC[0], base + 6, rotundaC[1]);
  rotunda.castShadow = rotunda.receiveShadow = true;
  group.add(rotunda);
  const rotundaCornice = new THREE.Mesh(new THREE.CylinderGeometry(rotundaR + 1.2, rotundaR + 1.2, 1.8, 20), stone);
  rotundaCornice.position.set(rotundaC[0], base + 12.6, rotundaC[1]);
  rotundaCornice.castShadow = true;
  group.add(rotundaCornice);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(rotundaR * 0.82, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), roofBlue);
  dome.position.set(rotundaC[0], base + 13.5, rotundaC[1]);
  dome.castShadow = true;
  group.add(dome);

  // —— 南侧教学科研楼：红砖体量 + 石材基座 + 窗带（OSM 真实轮廓） ——
  group.add(slab(scaleAbout(southRing, centroidOf(southRing), 1.02), base, 2.2, stone));
  group.add(slab(southRing, base + 2.2, 15.8, brick, 0.5));
  const southCenter = centroidOf(southRing);
  const windowBand = new THREE.Mesh(new THREE.BoxGeometry(56 * SCALE, 3.4, 56 * SCALE), glass);
  windowBand.position.set(southCenter[0], base + 10.5, southCenter[1]);
  windowBand.rotation.y = Math.atan2(-(-14), 82); // 沿建筑长轴（西北—东南）
  windowBand.castShadow = false;
  group.add(windowBand);

  // —— 组团之间的连廊（示意：图书馆 → 圆楼/南楼的风雨连廊） ——
  const walk = (to: Pt) => {
    const from = new THREE.Vector3(libCenter[0], base + 4.5, libCenter[1]);
    const target = new THREE.Vector3(to[0], base + 4.5, to[1]);
    const lengthWalk = from.distanceTo(target);
    const geo = new THREE.BoxGeometry(lengthWalk, 1.6, 4.5);
    const mesh = new THREE.Mesh(geo, white);
    mesh.position.copy(from).lerp(target, 0.5);
    mesh.rotation.y = Math.atan2(-(target.z - from.z), target.x - from.x);
    mesh.castShadow = true;
    group.add(mesh);
  };
  walk(rotundaC);
  walk(southCenter);

  return group;
}
