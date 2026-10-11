import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glowColor } from "./atmosphere";
import { landmarkStyle as style } from "./palette";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

type Pt = [number, number];

/** 地标坐标与项目 data/hero-landmarks.json 一致（高德 POI / Esri 卫星图校准） */
export const LANDMARKS = [
  { id: "tech", name: "深圳科学技术馆", lng: 113.938781, lat: 22.775097 },
  { id: "art", name: "深圳国际美术馆", lng: 113.934026, lat: 22.774474 },
  { id: "culture", name: "光明文化艺术中心", lng: 113.932078, lat: 22.749634 },
  // data/landmark-production.json：站房、雨棚与高铁线路平行，长轴近南北（约 4°）
  { id: "hsr", name: "光明城站", lng: 113.9499, lat: 22.73558, scale: 1 }, // 本身已有 460m 长，不再放大
] as { id: "tech" | "art" | "culture" | "hsr"; name: string; lng: number; lat: number; scale?: number }[];

export function projectLngLat(data: SandboxData, lng: number, lat: number): Pt {
  const R = 6378137;
  const [lng0, lat0] = data.meta.projection.origin;
  const k = data.meta.projection.k;
  const mx = (value: number) => (R * value * Math.PI) / 180;
  const my = (value: number) => R * Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360));
  return [(mx(lng) - mx(lng0)) * k, -(my(lat) - my(lat0)) * k];
}

const centroidOf = (ring: Pt[]): Pt => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

/** 找到离地标点最近的真实建筑轮廓 */
function footprintNear(data: SandboxData, [x, z]: Pt) {
  let best: { ring: Pt[]; h: number; d: number } | null = null;
  for (const building of data.buildings) {
    if (building.f) continue;
    const ring = pairs(building.p);
    const [cx, cz] = centroidOf(ring);
    const d = Math.hypot(cx - x, cz - z);
    if (d < 70 && (!best || d < best.d)) best = { ring, h: building.h, d };
  }
  return best;
}

/** 最小外接矩形的主轴（单位向量）与长宽 */
function principalAxis(ring: Pt[]) {
  let best = { area: Infinity, angle: 0, length: 0, width: 0 };
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const angle = Math.atan2(bz - az, bx - ax);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s;
      const v = -x * s + z * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) best = { area, angle, length: maxU - minU, width: maxV - minV };
  }
  const angle = best.length >= best.width ? best.angle : best.angle + Math.PI / 2;
  return { dir: [Math.cos(angle), Math.sin(angle)] as Pt, length: Math.max(best.length, best.width), width: Math.min(best.length, best.width) };
}

const scaleRing = (ring: Pt[], [cx, cz]: Pt, s: number): Pt[] => ring.map(([x, z]) => [cx + (x - cx) * s, cz + (z - cz) * s]);

/** Sutherland–Hodgman：保留 f(p) >= 0 的部分 */
function clip(ring: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function slab(ring: Pt[], bottom: number, height: number, material: THREE.Material, bevel = 0) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.5, height - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom + bevel, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: false });

/** 深圳科学技术馆：层叠的银色"卵石"，层间是深绿玻璃带，西北侧有绿顶小馆 */
function buildTech(ring: Pt[], base: number) {
  const group = new THREE.Group();
  const center = centroidOf(ring);
  const { dir, length } = principalAxis(ring);
  const silver = mat(style.silver, 0.38, 0.18);
  const glass = mat(style.greenGlass, 0.25, 0.1);
  glowColor(glass, "#79f2c6", 1.5);
  const slabScales = [0.9, 0.97, 1.0, 0.98, 0.93];
  const slabHeight = 7;
  const band = 1.8;
  let y = base;
  slabScales.forEach((s, i) => {
    group.add(slab(scaleRing(ring, center, s), y, slabHeight, silver, 2.2));
    y += slabHeight;
    if (i < slabScales.length - 1) {
      group.add(slab(scaleRing(ring, center, Math.min(s, slabScales[i + 1]) * 0.955), y, band, glass));
      y += band;
    }
  });
  group.add(slab(scaleRing(ring, center, 0.84), y, 2.4, silver, 1.2));
  // 屋顶天窗
  const skylight = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 12), glass);
  skylight.position.set(center[0], y + 2.6, center[1]);
  skylight.rotation.y = Math.atan2(-dir[1], dir[0]);
  group.add(skylight);
  // 西北端的绿顶小馆 + 连桥
  const toNW: Pt = dir[0] + dir[1] < 0 ? dir : [-dir[0], -dir[1]];
  const podDistance = length / 2 + 34;
  const pod: Pt = [center[0] + toNW[0] * podDistance, center[1] + toNW[1] * podDistance];
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 10, 10), silver);
  stem.position.set(pod[0], base + 5, pod[1]);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 5, 28), silver);
  disc.scale.set(1.5, 1, 1);
  disc.position.set(pod[0], base + 12, pod[1]);
  disc.rotation.y = Math.atan2(-toNW[1], toNW[0]);
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 28), mat("#a7c94f", 0.8));
  lawn.scale.set(1.5, 1, 1);
  lawn.position.set(pod[0], base + 15, pod[1]);
  lawn.rotation.y = disc.rotation.y;
  const bridgeLength = 34;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(bridgeLength + 10, 2.5, 5), silver);
  bridge.position.set(center[0] + toNW[0] * (length / 2 + 12), base + 10, center[1] + toNW[1] * (length / 2 + 12));
  bridge.rotation.y = Math.atan2(-toNW[1], toNW[0]);
  for (const mesh of [stem, disc, lawn, bridge, skylight]) { mesh.castShadow = true; group.add(mesh); }
  return group;
}

/** 深圳国际美术馆：石材基座；南侧米白石材体块，北侧金属灰 + 红砖体块；东端圆形下沉庭院 */
function buildArt(ring: Pt[], base: number) {
  const group = new THREE.Group();
  const center = centroidOf(ring);
  let { dir } = principalAxis(ring);
  if (dir[0] < 0) dir = [-dir[0], -dir[1]]; // 让 u 指向东
  const normal: Pt = [-dir[1], dir[0]]; // v 指向南（z 正方向）
  const u = ([x, z]: Pt) => (x - center[0]) * dir[0] + (z - center[1]) * dir[1];
  const v = ([x, z]: Pt) => (x - center[0]) * normal[0] + (z - center[1]) * normal[1];
  const us = ring.map(u);
  const minU = Math.min(...us);
  const maxU = Math.max(...us);
  const span = maxU - minU;
  const stone = mat(style.stone, 0.75);
  const grey = mat(style.metalGrey, 0.45, 0.1);
  const brick = mat(style.brick, 0.85);
  const glass = mat(style.darkGlass, 0.2, 0.1);
  glowColor(glass, "#ffd08a", 0.8);

  group.add(slab(ring, base, 4, stone));
  const south = clip(clip(ring, (p) => v(p) - 2), (p) => maxU - span * 0.24 - u(p));
  if (south.length >= 3) group.add(slab(south, base + 4, 18, stone));
  const north = clip(ring, (p) => -v(p) - 2);
  const northWest = clip(north, (p) => minU + span * 0.55 - u(p));
  const northEast = clip(north, (p) => u(p) - (minU + span * 0.55));
  if (northWest.length >= 3) {
    group.add(slab(northWest, base + 4, 12, glass));
    group.add(slab(northWest, base + 16, 11, grey));
  }
  if (northEast.length >= 3) group.add(slab(northEast, base + 4, 21, brick));
  // 东端圆形下沉庭院
  const courtU = maxU - 16;
  const court: Pt = [center[0] + dir[0] * courtU, center[1] + dir[1] * courtU];
  const rim = new THREE.Mesh(new THREE.TorusGeometry(10, 1.6, 8, 32), stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(court[0], base + 4.4, court[1]);
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 1, 32), glass);
  pit.position.set(court[0], base + 4.1, court[1]);
  // 南立面入口门洞
  const entranceV = Math.max(...ring.map(v)) - 1;
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(12, 11, 2), glass);
  entrance.position.set(center[0] - dir[0] * span * 0.12 + normal[0] * entranceV, base + 9.5, center[1] - dir[1] * span * 0.12 + normal[1] * entranceV);
  entrance.rotation.y = Math.atan2(-dir[1], dir[0]);
  for (const mesh of [rim, pit, entrance]) { mesh.castShadow = true; group.add(mesh); }
  return group;
}

/** 光明文化艺术中心：深色玻璃基座上的白色体量，屋面采光带与设备小体块 */
function buildCulture(ring: Pt[], base: number) {
  const group = new THREE.Group();
  const center = centroidOf(ring);
  const { dir, length } = principalAxis(ring);
  const white = mat(style.white, 0.55);
  const glass = mat(style.darkGlass, 0.2, 0.1);
  glowColor(glass, "#ffd9a0", 0.9);
  group.add(slab(scaleRing(ring, center, 0.95), base, 8, glass));
  group.add(slab(ring, base + 8, 24, white, 1.5));
  const angle = Math.atan2(-dir[1], dir[0]);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(length * 0.42, 0.8, 4), glass);
  strip.position.set(center[0], base + 32.4, center[1]);
  strip.rotation.y = angle;
  group.add(strip);
  [[0.12, 10], [0.18, 12], [-0.15, -12]].forEach(([t, offset], i) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(12 + i * 3, 6 + i * 2, 10), white);
    const along = length * t;
    box.position.set(center[0] + dir[0] * along - dir[1] * offset, base + 35 + i, center[1] + dir[1] * along + dir[0] * offset);
    box.rotation.y = angle;
    box.castShadow = true;
    group.add(box);
  });
  return group;
}

/** 光明城高铁站：深色玻璃基座 + 白色站房，上方是顺着高铁线路的长雨棚，由两排柱子撑起 */
function buildStation(ring: Pt[], base: number) {
  const group = new THREE.Group();
  const center = centroidOf(ring);
  const { dir, length, width } = principalAxis(ring);
  const white = mat(style.white, 0.5);
  const glass = mat(style.darkGlass, 0.2, 0.1);
  glowColor(glass, "#ffe2b0", 1.0);
  group.add(slab(scaleRing(ring, center, 0.96), base, 9, glass));
  group.add(slab(ring, base + 9, 15, white, 1.2));
  const angle = Math.atan2(-dir[1], dir[0]);
  const canopyLength = length * 1.05;
  const canopyWidth = Math.max(width * 1.25, 70);
  const canopyY = base + 46;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(canopyLength, 3, canopyWidth), mat("#f4f6f8", 0.35, 0.05));
  canopy.position.set(center[0], canopyY, center[1]);
  canopy.rotation.y = angle;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  group.add(canopy);
  // 雨棚顶面的采光带
  const skylight = new THREE.Mesh(new THREE.BoxGeometry(canopyLength * 0.92, 0.6, 5), glass);
  skylight.position.set(center[0], canopyY + 1.8, center[1]);
  skylight.rotation.y = angle;
  group.add(skylight);
  const normal: Pt = [-dir[1], dir[0]];
  const columnGeometry = new THREE.CylinderGeometry(1.6, 1.6, canopyY - base, 8);
  for (const side of [-1, 1]) {
    for (let t = -0.45; t <= 0.45; t += 0.09) {
      const column = new THREE.Mesh(columnGeometry, white);
      column.position.set(
        center[0] + dir[0] * canopyLength * t + normal[0] * side * (canopyWidth / 2 - 4),
        base + (canopyY - base) / 2,
        center[1] + dir[1] * canopyLength * t + normal[1] * side * (canopyWidth / 2 - 4),
      );
      column.castShadow = true;
      group.add(column);
    }
  }
  return group;
}

export function buildLandmarks(data: SandboxData, terrain: Terrain) {
  const group = new THREE.Group();
  group.name = "landmarks";
  const placed: { id?: string; name: string; position: THREE.Vector3; top: number; model?: THREE.Object3D; base?: number; scale?: number }[] = [];
  const builders = { tech: buildTech, art: buildArt, culture: buildCulture, hsr: buildStation };
  for (const landmark of LANDMARKS) {
    const point = projectLngLat(data, landmark.lng, landmark.lat);
    const found = footprintNear(data, point);
    if (!found) continue;
    const scaled = scaleRing(found.ring, centroidOf(found.ring), landmark.scale ?? style.scale);
    const base = Math.min(...scaled.map(([x, z]) => terrain.heightAt(x, z))) - 1;
    const model = builders[landmark.id](scaled, base);
    group.add(model);
    const [cx, cz] = centroidOf(scaled);
    const box = new THREE.Box3().setFromObject(model);
    placed.push({ id: landmark.id, name: landmark.name, position: new THREE.Vector3(cx, base, cz), top: box.max.y, model, base, scale: landmark.scale ?? style.scale });
  }
  return { group, placed };
}

/**
 * 用 Blender 精细模型替换程序化体块（scripts/blender/build_*.py 导出的 glb）。
 * glb 的原点是真实轮廓的中心、底面在 0，所以只需平移到轮廓中心并按地标比例缩放。
 */
const MODELS: Record<string, string> = { tech: "/sandbox/models/science-museum.glb" };

export async function upgradeLandmarkModels(landmarks: ReturnType<typeof buildLandmarks>) {
  const loader = new GLTFLoader();
  await Promise.all(landmarks.placed.map(async (item) => {
    const url = item.id ? MODELS[item.id] : undefined;
    if (!url || !item.model) return;
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material.name === "glass") glowColor(material, "#9ff5d8", 1.2);
        // 沙盘没有环境反射贴图，金属度高会发黑；降低金属度保留"银灰"观感
        if (material.metalness > 0.15) material.metalness = 0.15;
      });
      model.position.set(item.position.x, item.base ?? item.position.y, item.position.z);
      model.scale.setScalar(item.scale ?? 1);
      landmarks.group.remove(item.model);
      landmarks.group.add(model);
      item.model = model;
      item.top = new THREE.Box3().setFromObject(model).max.y;
    } catch (error) {
      console.warn(`landmark model ${url} failed, keeping procedural version`, error);
    }
  }));
}

/** 地标放大后占据的圆形范围，普通建筑在其中的不再渲染 */
export function landmarkExclusions(data: SandboxData): { x: number; z: number; r: number; ring?: Pt[] }[] {
  return LANDMARKS.flatMap((landmark) => {
    const found = footprintNear(data, projectLngLat(data, landmark.lng, landmark.lat));
    if (!found) return [];
    const [x, z] = centroidOf(found.ring);
    const reach = Math.max(...found.ring.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    // 不放大的地标（细长的站房）按真实轮廓排除，避免圆形范围误删两侧建筑
    if ((landmark.scale ?? style.scale) === 1) return [{ x, z, r: 0, ring: found.ring }];
    return [{ x, z, r: reach * (landmark.scale ?? style.scale) + 12 }];
  });
}
