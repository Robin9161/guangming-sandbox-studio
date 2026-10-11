import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type LL, type P } from "../_landmark-kit";
import { trail } from "../_park-details";

/**
 * 深圳人才公园 · 南山后海
 *
 * 真实依据：
 * - nanshan/sandbox.json parks[308] 为「深圳人才公园」边界，water.areas[349]
 *   为「深圳湾内湖」轮廓（数据面积 335111 m²）。取内湖顶点均值
 *   (1516.0, 27713.5) 米，按 meta.projection / projectLngLat 反算锚点。
 * - 2017-11-01 开放，公园约 77 万 m²、水体约 30 万 m²；湖东侧有
 *   跨湖人才星光桥及 30 根星光柱，见深圳市水务局与新华社资料。
 *   https://swj.sz.gov.cn/ztzl/swhjs/bdfc/content/post_11740850.html
 *   https://www.xinhuanet.com/politics/2017-10/20/c_1121832369.htm
 * - 设计团队资料记载约 2.7 km 塑胶环湖慢跑道与滨海相接的岸线。
 *   https://www.archiposition.com/items/20180525114053
 *
 * 估算：桥的具体线位、弧度、起伏、桥宽和柱高，跑道与滨海栈道的
 * 精确路径，以及人才功勋墙的定位均为沙盘示意。星光桥约 220 m 的
 * 跨距取湖东侧真实轮廓的跨水段；桥面宽放大约 2.2 倍至 6.6 m，
 * 栏杆/星光柱加粗约 1.5–2 倍，保证 1–3 km 微缩视角可辨。
 */

type Ctx = LandmarkContext;
export const RENCAI_PARK_ANCHOR: [number, number] = [113.94377565, 22.5128891];

// 与 nanshan/sandbox.json 的米制投影互逆，便于直接按已存在的轮廓落点。
const ORIGIN: LL = [113.929007, 22.76207];
const K = 0.9221194861972872;
const R = 6378137;
const mx0 = R * ORIGIN[0] * Math.PI / 180;
const my0 = R * Math.log(Math.tan(Math.PI / 4 + ORIGIN[1] * Math.PI / 360));
function ll(x: number, z: number): LL {
  const lng = (mx0 + x / K) * 180 / (R * Math.PI);
  const lat = (2 * Math.atan(Math.exp((my0 - z / K) / R)) - Math.PI / 2) * 180 / Math.PI;
  return [lng, lat];
}

export function buildRencaiPark(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, RENCAI_PARK_ANCHOR, "深圳人才公园", "#d8919b");
  const at = (x: number, z: number, lift = .5): THREE.Vector3 => {
    const geo = ll(x, z), p = k.local(geo);
    return new THREE.Vector3(p[0], k.yAt(geo) + lift, p[1]);
  };

  // 沿原有湖面外缘的彩色细跑道。只画窄带，不重复铺湖与公园地表。
  // 线位取轮廓外侧的概括折线；路面平均抬高 0.55 m。
  const loop: [number, number][] = [
    [1102, 27865], [1115, 27745], [1164, 27645], [1238, 27576],
    [1315, 27480], [1424, 27366], [1542, 27319], [1660, 27336],
    [1770, 27362], [1880, 27435], [1960, 27565], [1999, 27682],
    [1970, 27810], [1886, 27919], [1775, 27992], [1650, 28077],
    [1505, 28088], [1360, 28097], [1230, 28043], [1130, 27965],
    [1102, 27865],
  ];
  const loopGeo = loop.map(([x, z]) => ll(x, z));
  trail(k, loopGeo, 3.6, "accent", .55);
  // 跑道内侧断续的浅色边线，避免远景只剩一根红线。
  for (let i = 0; i < loop.length - 1; i += 2) {
    const a = at(loop[i][0], loop[i][1], .69), b = at(loop[i + 1][0], loop[i + 1][1], .69);
    k.beam("white", a, b, .28, .08);
  }

  // 人才星光桥：湖东侧的白色曲线桥面，30 根柱按新华社/水务局记载。
  // 平面线位与波形为估算；桥面宽 6.6 m（实景步桥约 3 m 的视觉放大）。
  const bridge: THREE.Vector3[] = [];
  const count = 18;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = 1815 + 30 * Math.sin(Math.PI * t);
    const z = 27558 + 223 * t + 5 * Math.sin(2 * Math.PI * t);
    const rise = 3.2 + 4.8 * Math.sin(Math.PI * t) ** 2 + 1.2 * Math.sin(3 * Math.PI * t) ** 2;
    bridge.push(at(x, z, rise));
  }
  for (let i = 1; i < bridge.length; i++) {
    const a = bridge[i - 1], b = bridge[i];
    k.beam("white", a, b, 6.6, .85);
    const tangent = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    const nx = -tangent.y, nz = tangent.x;
    for (const side of [-1, 1]) {
      const offset = (p: THREE.Vector3, y: number) => new THREE.Vector3(p.x + side * 3.5 * nx, p.y + y, p.z + side * 3.5 * nz);
      k.beam("silver", offset(a, 1.55), offset(b, 1.55), .32, .32);
      if (i % 3 === 1) k.beam("silver", offset(a, .1), offset(a, 1.55), .25, .25);
    }
  }
  for (let i = 0; i < 30; i++) {
    const t = (i + .5) / 30, n = Math.min(count - 1, Math.floor(t * count));
    const p = bridge[n].clone().lerp(bridge[n + 1], t * count - n);
    // 星光柱只抽象成白色竖柱、暖色冠部，免用贴图或不可辨的小字。
    k.box("white", p.x - 4.1, p.y + .45, p.z, .62, 2.8, .62);
    k.box("accent", p.x - 4.1, p.y + 3.25, p.z, .85, .34, .85);
  }

  // 南侧面向深圳湾的岸线栈道及栏杆；位于 parks[308] 南缘内侧。
  const coast: [number, number][] = [
    [1075, 28193], [1220, 28193], [1385, 28196], [1550, 28198],
    [1710, 28198], [1750, 28191],
  ];
  for (let i = 1; i < coast.length; i++) {
    const a = at(...coast[i - 1], .58), b = at(...coast[i], .58);
    k.beam("wood", a, b, 7.2, .35);
    for (const side of [-1, 1]) {
      const aa = a.clone().add(new THREE.Vector3(0, 1.25, side * 3.5));
      const bb = b.clone().add(new THREE.Vector3(0, 1.25, side * 3.5));
      k.beam("white", aa, bb, .25, .25);
    }
  }
  for (let x = 1100; x < 1740; x += 32) {
    const p = at(x, 28198, .6);
    k.box("white", p.x, p.y, p.z + 3.5, .28, 1.3, .28);
  }

  // 人才功勋墙：确有此主题小品；平面位置和断面仅作西岸示意。
  const wall = at(1077, 27680, .55);
  k.box("stone", wall.x, wall.y, wall.z, 35, .7, 5);
  k.box("white", wall.x, wall.y + .7, wall.z, 32, 3.2, .8);
  for (let i = 0; i < 9; i++) {
    k.box("silver", wall.x - 13.8 + i * 3.45, wall.y + 1.4, wall.z - .48, .12, 1.8, .08);
  }
  // 岸边留少量 kit 原色树作为构筑物尺度参照，底图已有示意树木。
  for (const [x, z] of [[1190, 27572], [1282, 27476], [1622, 28099], [1740, 28088]] as P[]) {
    const p = at(x, z, .45);
    k.tree(p.x, p.z, p.y, 4.2);
  }

  const group = k.finish();
  group.userData.evidence = {
    anchor: RENCAI_PARK_ANCHOR,
    footprint: "nanshan/sandbox.json parks[308], water.areas[349]",
    bridgePillars: 30,
    bridgeWidthVisualScale: 2.2,
    estimated: "桥线位、跑道、滨海栈道、功勋墙位置与尺寸",
  };
  return group;
}
