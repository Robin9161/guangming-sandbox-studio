import * as THREE from "three";
import { glowColor } from "../scene/atmosphere";

/**
 * 大科学装置（光明科学城启动区 · 光明生命科学园）
 *
 * 真实依据：
 * - 位置：合成生物研究重大科技基础设施 113.9605,22.8118 与脑解析与脑模拟重大科技基础设施
 *   113.9578,22.8132（data/guangming-resources.json，verified，来源：中科院深圳先进院/光明区科创资源页）。
 * - 造型依据：公开报道——两大设施由"一条长长的环形走廊连接五座独立的大楼"
 *  （中国科学报 2023-04-28《走进深圳光明科学城启动区》），地上各 14 层、总建筑面积约 8.5 万㎡；
 *   深圳新闻网 2025-08 报道形容为"极富科技感的五栋蓝白建筑"，两栋主楼由连廊相连。
 *
 * 估算：OSM/sandbox.json 在该处没有两大设施的可靠单体轮廓，两栋主楼的平面尺寸（约 76m×34m）、
 * 环形连廊的椭圆走向、三栋配楼的位置与体量均为按报道演绎的示意布局；层数（14F≈58m）与蓝白色彩有据。
 *
 * 整体以组团中心为基准放大 1.2 倍。
 */

type Ctx = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };

const SITES: { id: string; name: string; lngLat: [number, number] }[] = [
  { id: "synbio", name: "合成生物研究重大科技基础设施", lngLat: [113.9605, 22.8118] },
  { id: "brain", name: "脑解析与脑模拟重大科技基础设施", lngLat: [113.9578, 22.8132] },
];
const SCALE = 1.2;

const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function buildScienceFacilities(ctx: Ctx): THREE.Group {
  const group = new THREE.Group();
  group.name = "landmark-science-facilities";

  const white = mat("#fbfbf9", 0.55);
  const silver = mat("#dde2e8", 0.45, 0.1);
  const glass = mat("#33475c", 0.25, 0.1);
  glowColor(glass, "#cfe6ff", 1.0);
  const scienceBlue = mat("#4f8fd0", 0.5, 0.05); // 特征色：科学蓝（"蓝白建筑"的蓝色端）

  // 两设施锚点（本地米制）与组团中心
  const anchors = SITES.map((s) => ctx.project(s.lngLat));
  const mid = new THREE.Vector3().addVectors(anchors[0], anchors[1]).multiplyScalar(0.5);
  const axis = new THREE.Vector3().subVectors(anchors[0], anchors[1]);
  const along = axis.clone().setY(0).normalize(); // 两主楼连线方向
  const across = new THREE.Vector3(-along.z, 0, along.x);
  const base = ctx.groundAt([113.95915, 22.8125]) - 0.5; // 两设施连线中点（内插经纬度）
  const place = (p: THREE.Vector3) => {
    const q = p.clone().sub(mid).multiplyScalar(SCALE).add(mid);
    return new THREE.Vector3(q.x, 0, q.z);
  };

  // —— 两栋 14 层主楼（估算平面 76×34m，蓝白相间：白铝板 + 深蓝玻璃带 + 蓝色基座） ——
  const towerSize: [number, number, number][] = [[76, 58, 34], [70, 58, 32]];
  anchors.forEach((anchor, i) => {
    const p = place(anchor);
    const ground = ctx.groundAt(SITES[i].lngLat) - 0.5;
    const [len, height, wid] = towerSize[i];
    const yaw = Math.atan2(-along.z, along.x) + Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, height, wid), white);
    body.position.set(p.x, ground + height / 2, p.z);
    body.rotation.y = yaw;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    // 楼层间深蓝玻璃带（3 道，把体量切成"蓝白相间"的层叠感）
    for (const t of [-0.22, 0.08, 0.38]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(len + 0.6, 3.2, wid + 0.6), glass);
      band.position.set(p.x, ground + height * (0.5 + t), p.z);
      band.rotation.y = yaw;
      group.add(band);
    }
    // 蓝色基座 + 屋顶设备体量
    const podium = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, 4.5, wid * 1.15), scienceBlue);
    podium.position.set(p.x, ground + 2.25, p.z);
    podium.rotation.y = yaw;
    podium.castShadow = true;
    group.add(podium);
    const plant = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, 3.5, wid * 0.5), silver);
    plant.position.set(p.x, ground + height + 1.75, p.z);
    plant.rotation.y = yaw;
    plant.castShadow = true;
    group.add(plant);
  });

  // —— 环形连廊（按"环形走廊连接五座大楼"演绎：椭圆环 + 短柱，估算）。
  // 半径收在两条主楼之间，让两栋 14 层主楼立在环外、配楼挂在环上。
  const ringA = 105 * SCALE;
  const ringB = 65 * SCALE;
  const ringShape = new THREE.Shape();
  ringShape.absellipse(0, 0, ringA, ringB, 0, Math.PI * 2);
  const ringHole = new THREE.Path();
  ringHole.absellipse(0, 0, ringA - 7, ringB - 7, 0, Math.PI * 2);
  ringShape.holes.push(ringHole);
  const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 3.5, bevelEnabled: false, curveSegments: 40 });
  ringGeo.rotateX(-Math.PI / 2);
  const corridorY = base + 15;
  const corridor = new THREE.Mesh(ringGeo, white);
  corridor.position.set(mid.x, corridorY, mid.z);
  corridor.rotation.y = Math.atan2(-along.z, along.x);
  corridor.castShadow = true;
  group.add(corridor);
  // 环廊立柱（估算 16 根）
  const postGeo = new THREE.CylinderGeometry(0.9, 0.9, corridorY - base, 6);
  const posts = new THREE.InstancedMesh(postGeo, silver, 16);
  const pm = new THREE.Matrix4();
  for (let i = 0; i < 16; i += 1) {
    const t = (i / 16) * Math.PI * 2;
    const lx = Math.cos(t) * (ringA - 3.5);
    const lz = Math.sin(t) * (ringB - 3.5);
    const rx = lx * Math.cos(corridor.rotation.y) + lz * Math.sin(corridor.rotation.y);
    const rz = -lx * Math.sin(corridor.rotation.y) + lz * Math.cos(corridor.rotation.y);
    pm.makeTranslation(mid.x + rx, base + (corridorY - base) / 2, mid.z + rz);
    posts.setMatrixAt(i, pm);
  }
  posts.castShadow = true;
  group.add(posts);

  // —— 三栋配楼（示意：环形走廊上的"另外三座独立大楼"，估算） ——
  const pods = [
    { t: 0.62, len: 46, wid: 26, h: 30 },
    { t: 1.55, len: 40, wid: 24, h: 24 },
    { t: 2.5, len: 42, wid: 24, h: 27 },
  ];
  for (const pod of pods) {
    const lx = Math.cos(pod.t) * ringA;
    const lz = Math.sin(pod.t) * ringB;
    const rx = lx * Math.cos(corridor.rotation.y) + lz * Math.sin(corridor.rotation.y);
    const rz = -lx * Math.sin(corridor.rotation.y) + lz * Math.cos(corridor.rotation.y);
    const px = mid.x + rx;
    const pz = mid.z + rz;
    const ground = base;
    const bodyPod = new THREE.Mesh(new THREE.BoxGeometry(pod.len, pod.h, pod.wid), white);
    bodyPod.position.set(px, ground + pod.h / 2, pz);
    bodyPod.rotation.y = corridor.rotation.y + (pod.t % 1) * 0.6;
    bodyPod.castShadow = bodyPod.receiveShadow = true;
    group.add(bodyPod);
    const bandPod = new THREE.Mesh(new THREE.BoxGeometry(pod.len + 0.5, 2.6, pod.wid + 0.5), scienceBlue);
    bandPod.position.set(px, ground + pod.h * 0.62, pz);
    bandPod.rotation.y = bodyPod.rotation.y;
    group.add(bandPod);
  }

  return group;
}
