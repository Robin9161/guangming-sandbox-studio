import * as THREE from "three";
import { addReveal, RevealAnimation } from "./grow";
import { avenueMedian, boundaryLine, expressways, motherRiver, roadClass, exaggerate, hsr, roadStyle, water, waterLineWidth } from "./palette";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

type Pt = [number, number];

function densify(points: Pt[], maxSegment = 18) {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxSegment));
    for (let s = 0; s < steps; s += 1) out.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** 合并多条带状几何到一个 BufferGeometry */
class RibbonBuilder {
  positions: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  dists: number[] = [];
  private color = new THREE.Color();

  /** 沿折线生成宽度为 width 的带；ys 为每个点的高度 */
  add(points: Pt[], ys: number[], width: number, hex: string, thickness = 0, distOf?: (x: number, z: number, cum: number) => number) {
    if (points.length < 2) return;
    this.color.set(hex);
    const half = width / 2;
    const sides: [number, number][] = points.map((_, i) => {
      const [px, pz] = points[Math.max(0, i - 1)];
      const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
      const dx = nx - px;
      const dz = nz - pz;
      const len = Math.hypot(dx, dz) || 1;
      return [-dz / len, dx / len];
    });
    const rows = thickness > 0 ? [[-half, 0], [half, 0], [half, -thickness], [-half, -thickness]] : [[-half, 0], [half, 0]];
    const base = this.positions.length / 3;
    // 沿线里程（米），用于"道路延伸"动画
    const cum = [0];
    for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    points.forEach(([x, z], i) => {
      const [sx, sz] = sides[i];
      for (const [offset, dy] of rows) {
        this.dists.push(distOf ? distOf(x, z, cum[i]) : cum[i]);
        this.positions.push(x + sx * offset, ys[i] + dy, z + sz * offset);
        const shade = dy < 0 ? 0.86 : 1;
        this.colors.push(this.color.r * shade, this.color.g * shade, this.color.b * shade);
      }
    });
    const stride = rows.length;
    const faces = thickness > 0 ? [[0, 1], [1, 2], [2, 3], [3, 0]] : [[0, 1]];
    for (let i = 0; i < points.length - 1; i += 1) {
      for (const [l, r] of faces) {
        const a = base + i * stride + l;
        const b = base + i * stride + r;
        const c = base + (i + 1) * stride + r;
        const d = base + (i + 1) * stride + l;
        this.indices.push(a, d, b, b, d, c);
      }
    }
  }

  build(material: THREE.Material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("aDist", new THREE.Float32BufferAttribute(this.dists, 1));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material);
  }
}

/** 道路、重点高速的"延伸"动画（讲解时由 createSandbox 驱动） */
export const roadGrowth = new RevealAnimation();
export const expresswayGrowth = { longda: new RevealAnimation(), nanguang: new RevealAnimation() };
type ExpressKey = keyof typeof expresswayGrowth;
const expressKeyOf = (name: string | null | undefined): ExpressKey => (name && /龙大/.test(name) ? "longda" : "nanguang");

const drapedMaterial = (offset: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  polygonOffset: true,
  polygonOffsetFactor: -offset,
  polygonOffsetUnits: -offset * 4,
  side: THREE.DoubleSide,
  ...extra,
});

function smooth(values: number[], radius: number) {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k += 1) { sum += values[k]; count += 1; }
    return sum / count;
  });
}

/** 沿线平滑的贴地高度：去掉地形小起伏，但不低于地面 */
function followGround(points: Pt[], terrain: Terrain, radius = 4) {
  const ground = points.map(([x, z]) => terrain.heightAt(x, z));
  return smooth(ground, radius).map((y, i) => Math.max(y, ground[i]));
}

/**
 * 道路。roadDist 给出"延伸"动画用的里程（缺省为每段自己的里程）：
 * 讲解里传入光明大道的生长延迟 × 1000，于是光明大道先从南光一端往东长，周边道路随建筑一起铺开。
 */
export function buildRoads(data: SandboxData, terrain: Terrain, skip: Set<SandboxData["roads"][number]> = new Set(), roadDist?: (x: number, z: number) => number) {
  const builder = new RibbonBuilder();
  const order = ["tertiary", "secondary", "primary", "avenue", "trunk", "motorway"];
  const classOf = (road: SandboxData["roads"][number]) => roadClass(road.c, road.n);
  // 南光、龙大由 buildExpressways 单独表现（抬高的高架 / 路堤），这里不再重复铺地面路面
  const sorted = [...data.roads].filter((road) => !skip.has(road) && !(road.c === "motorway" && road.n && expressways.names.test(road.n))).sort((a, b) => order.indexOf(classOf(a)) - order.indexOf(classOf(b)));
  const median = new RibbonBuilder();
  sorted.forEach((road, index) => {
    const cls = classOf(road);
    const style = roadStyle[cls];
    if (!style) return;
    const points = densify(pairs(road.p));
    const lift = 1.5 + order.indexOf(cls) * 0.3 + index * 0.00002;
    const ys = followGround(points, terrain).map((y) => y + lift);
    const distOf = roadDist ? (x: number, z: number) => roadDist(x, z) : undefined;
    builder.add(points, ys, road.l ? Math.min(style.width, 12) : style.width, style.color, 0, distOf); // 匝道按 12m
    if (cls === "avenue") median.add(points, ys.map((y) => y + 0.4), avenueMedian.width, avenueMedian.color, 0, distOf);
  });
  const roadMaterial = drapedMaterial(2);
  addReveal(roadMaterial, roadGrowth.uniform);
  const mesh = builder.build(roadMaterial);
  mesh.receiveShadow = true;
  mesh.name = "roads";
  const medianMaterial = drapedMaterial(3, { roughness: 0.95 });
  addReveal(medianMaterial, roadGrowth.uniform);
  const medianMesh = median.build(medianMaterial);
  medianMesh.receiveShadow = true;
  mesh.add(medianMesh);
  return mesh;
}

export function buildWater(data: SandboxData, terrain: Terrain) {
  const group = new THREE.Group();
  group.name = "water";
  const embankmentMaterial = new THREE.MeshStandardMaterial({ color: "#d8d0bf", roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  embankmentMaterial.name = "embankment";
  const areaMaterial = new THREE.MeshStandardMaterial({ color: water.area, roughness: 0.18, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 });
  for (const area of data.water.areas) {
    const outer = pairs(area.p);
    const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const hole of area.h) shape.holes.push(new THREE.Path(pairs(hole).map(([x, z]) => new THREE.Vector2(x, -z))));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, areaMaterial);
    if (area.level !== undefined) {
      const waterY = exaggerate(area.level) + 0.8;
      mesh.position.y = waterY;
      // 岸边地面低于水面的地方（坝体、下游）补一圈堤岸，避免水面边缘悬空
      const shore = densify([...outer, outer[0]], 12);
      const wall: number[] = [];
      for (let i = 0; i < shore.length - 1; i += 1) {
        const [ax, az] = shore[i];
        const [bx, bz] = shore[i + 1];
        const ga = terrain.heightAt(ax, az) - 2;
        const gb = terrain.heightAt(bx, bz) - 2;
        if (ga >= waterY - 0.5 && gb >= waterY - 0.5) continue;
        wall.push(ax, waterY, az, bx, waterY, bz, bx, Math.min(gb, waterY), bz, ax, waterY, az, bx, Math.min(gb, waterY), bz, ax, Math.min(ga, waterY), az);
      }
      if (wall.length) {
        const wallGeometry = new THREE.BufferGeometry();
        wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
        wallGeometry.computeVertexNormals();
        const embankment = new THREE.Mesh(wallGeometry, embankmentMaterial);
        embankment.castShadow = true;
        embankment.receiveShadow = true;
        group.add(embankment);
      }
    } else {
      // 河道面：逐顶点贴地
      const position = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 1) position.setY(i, terrain.heightAt(position.getX(i), position.getZ(i)) + 1.2);
      geometry.computeVertexNormals();
    }
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const builder = new RibbonBuilder();
  const greenway = new RibbonBuilder();
  for (const line of data.water.lines) {
    const points = densify(pairs(line.p));
    const ys = followGround(points, terrain, 3);
    const isMother = line.n === motherRiver.name;
    if (isMother) greenway.add(points, ys.map((y) => y + 0.7), motherRiver.greenway, motherRiver.greenwayColor);
    builder.add(points, ys.map((y) => y + 1.1), isMother ? motherRiver.width : waterLineWidth[line.c] ?? 6, water.line);
  }
  const greenwayMesh = greenway.build(drapedMaterial(2, { roughness: 0.95 }));
  greenwayMesh.receiveShadow = true;
  greenwayMesh.name = "greenway";
  group.add(greenwayMesh);
  const lines = builder.build(drapedMaterial(3, { roughness: 0.25 }));
  lines.receiveShadow = true;
  group.add(lines);
  return group;
}

/** 轨道：高架做成有厚度的桥面 + 桥墩，地面段贴地，隧道段画虚线 */
export function buildRail(data: SandboxData, terrain: Terrain, filter: (line: string) => boolean) {
  const group = new THREE.Group();
  const deck = new RibbonBuilder();
  const surface = new RibbonBuilder();
  const tunnel = new RibbonBuilder();
  const piers: { x: number; y: number; z: number; top: number }[] = [];
  const portals: { x: number; y: number; z: number; angle: number; width: number }[] = [];
  const colors = data.meta.lineColors;
  for (const segment of data.rail) {
    if (!filter(segment.line)) continue;
    const isHsr = segment.line === "hsr";
    const color = isHsr ? hsr.deck : colors[segment.line];
    const points = densify(pairs(segment.p), 15);
    const groundYs = segment.mode === "elevated" ? points.map(([x, z]) => terrain.heightAt(x, z)) : followGround(points, terrain, 5);
    if (segment.mode === "elevated") {
      const deckHeight = isHsr ? 24 : 18;
      const ys = smooth(groundYs, 6).map((y, i) => Math.max(y, groundYs[i]) + deckHeight);
      deck.add(points, ys, isHsr ? 16 : 11, color, 4);
      let walked = 0;
      for (let i = 1; i < points.length; i += 1) {
        walked += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (walked >= (isHsr ? 70 : 55)) { walked = 0; piers.push({ x: points[i][0], y: groundYs[i], z: points[i][1], top: ys[i] - 4 }); }
      }
    } else if (segment.mode === "surface") {
      surface.add(points, groundYs.map((y) => y + 2.2), isHsr ? 14 : 10, color, 2);
    } else {
      // 隧道：轨面在两端洞口之间直线过渡，且不高于地面——穿山时埋入山体、被地形遮住；
      // 在平地上则贴地显示为 40m 实 / 30m 空的虚线。
      const cum = [0];
      for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
      const total = cum[cum.length - 1] || 1;
      const startY = groundYs[0];
      const endY = groundYs[groundYs.length - 1];
      const tunnelYs = groundYs.map((g, i) => Math.min(g + 2, startY + ((endY - startY) * cum[i]) / total + 2));
      // 洞口：从两端向内找到"埋深超过 4m"的第一个点，放置洞口
      for (const dir of [1, -1]) {
        const start = dir === 1 ? 0 : points.length - 1;
        for (let i = start; i >= 0 && i < points.length; i += dir) {
          if (groundYs[i] - tunnelYs[i] > 4) {
            const j = Math.max(0, Math.min(points.length - 1, i - dir));
            portals.push({ x: points[i][0], y: tunnelYs[i] - 2, z: points[i][1], angle: Math.atan2(points[i][1] - points[j][1], points[i][0] - points[j][0]), width: isHsr ? 22 : 14 });
            break;
          }
        }
      }
      let run: Pt[] = [];
      let runYs: number[] = [];
      let walked = 0;
      for (let i = 0; i < points.length; i += 1) {
        if (i > 0) walked += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        const on = walked % 70 < 40;
        if (on) { run.push(points[i]); runYs.push(tunnelYs[i]); }
        else if (run.length) {
          tunnel.add(run, runYs, isHsr ? 9 : 8, isHsr ? hsr.tunnel : color);
          run = [];
          runYs = [];
        }
      }
      if (run.length > 1) tunnel.add(run, runYs, isHsr ? 9 : 8, isHsr ? hsr.tunnel : color);
    }
  }
  const deckMesh = deck.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true }));
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  const surfaceMesh = surface.build(drapedMaterial(4, { roughness: 0.55 }));
  const tunnelMesh = tunnel.build(drapedMaterial(4, { transparent: true, opacity: 0.6 }));
  group.add(deckMesh, surfaceMesh, tunnelMesh);
  // 隧道洞口：混凝土洞门 + 深色拱形洞口
  const portalMaterial = new THREE.MeshStandardMaterial({ color: "#d9d5cc", roughness: 0.85, flatShading: true });
  const holeMaterial = new THREE.MeshStandardMaterial({ color: "#2b3038", roughness: 1 });
  for (const portal of portals) {
    // 洞门厚 6m（沿轨道方向），宽度横跨轨道；洞口为略突出的深色矩形
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6, portal.width * 0.8, portal.width + 10), portalMaterial);
    frame.position.y = portal.width * 0.4;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(6.6, portal.width * 0.55, portal.width * 0.7), holeMaterial);
    hole.position.y = portal.width * 0.275;
    const assembly = new THREE.Group();
    assembly.add(frame, hole);
    assembly.position.set(portal.x, portal.y, portal.z);
    assembly.rotation.y = -portal.angle; // 局部 x 轴对齐轨道方向
    frame.castShadow = true;
    group.add(assembly);
  }

  if (piers.length) {
    const pierGeometry = new THREE.CylinderGeometry(3.2, 4, 1, 6);
    pierGeometry.translate(0, 0.5, 0);
    const pierMesh = new THREE.InstancedMesh(pierGeometry, new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.8, flatShading: true }), piers.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    piers.forEach((pier, i) => {
      matrix.compose(new THREE.Vector3(pier.x, pier.y, pier.z), quaternion, new THREE.Vector3(1, Math.max(2, pier.top - pier.y), 1));
      pierMesh.setMatrixAt(i, matrix);
    });
    pierMesh.castShadow = true;
    group.add(pierMesh);
  }
  return group;
}

export function buildStations(data: SandboxData, terrain: Terrain, filter: (mode: string) => boolean) {
  const group = new THREE.Group();
  const colors = data.meta.lineColors;
  const baseMaterial = new THREE.MeshStandardMaterial({ color: "#fbf8f2", roughness: 0.6, flatShading: true });
  for (const station of data.stations) {
    if (!filter(station.mode)) continue;
    const [x, z] = station.p;
    const y = terrain.heightAt(x, z);
    const isRail = station.mode !== "metro";
    const lineColor = isRail ? "#c4c9d2" : colors[station.lines[0]] ?? "#8ec5e8";
    if (isRail) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(160, 22, 70), baseMaterial);
      hall.position.set(x, y + 11, z);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 170, 8, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: "#d9e4ef", roughness: 0.4, flatShading: true }));
      roof.rotation.z = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.scale.set(1, 1, 0.45);
      roof.position.set(x, y + 22, z);
      for (const mesh of [hall, roof]) { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
      continue;
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 10, 10), baseMaterial);
    pad.position.set(x, y + 5, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 6, 10), new THREE.MeshStandardMaterial({ color: lineColor, roughness: 0.5, flatShading: true }));
    cap.name = "station-cap";
    cap.position.set(x, y + 13, z);
    for (const mesh of [pad, cap]) { mesh.castShadow = true; group.add(mesh); }
  }
  return group;
}

/** 区界：一条贴地的浅色描边，标出光明区范围（不再做断崖） */
export function buildBoundaryLine(data: SandboxData, terrain: Terrain) {
  const ring = pairs(data.boundary);
  const points = densify([...ring, ring[0]], 15);
  const builder = new RibbonBuilder();
  builder.add(points, points.map(([x, z]) => terrain.heightAt(x, z) + 3), boundaryLine.width, boundaryLine.color);
  const mesh = builder.build(drapedMaterial(5, { roughness: 0.6, transparent: true, opacity: 0.85 }));
  mesh.name = "boundary";
  return mesh;
}

/**
 * 南光、龙大高速：桥梁段为高架（桥面 + 双排桥墩），其余为路堤（梯形断面）。
 * 抬升高度用"离最近桥梁点的距离"连续过渡，避免分段数据在接缝处出现台阶。
 */
/**
 * 南光、龙大。origins 为"延伸"动画的起点（龙大从龙华一端、南光从南山西丽一端）：
 * 里程取到起点的直线距离，双向两幅、匝道一起从同一端长出来。
 */
export function buildExpressways(data: SandboxData, terrain: Terrain, origins?: Record<"longda" | "nanguang", Pt>, options?: { names: RegExp; replacements?: SandboxData["roads"] }) {
  const group = new THREE.Group();
  group.name = "expressways";
  // 未传 options 时完整保留光明的筛选、分组与生长动画。
  const names = options?.names ?? expressways.names;
  const selected = data.roads.filter((road) => road.c === "motorway" && road.n && names.test(road.n) && (!options || !road.l));
  const replacements = options?.replacements ?? [];
  const replacedNames = new Set(replacements.map(road => road.n));
  const segments = [...selected.filter(road => !replacedNames.has(road.n)), ...replacements];
  type BufferKey = ExpressKey | "district";
  const keyOf = (name: string | null | undefined): BufferKey => options ? "district" : expressKeyOf(name);
  const bridgePoints: Pt[] = [];
  for (const road of segments) if (road.b) for (const p of densify(pairs(road.p), 30)) bridgePoints.push(p);
  const buckets = new Map<string, Pt[]>();
  const key = (x: number, z: number) => `${Math.floor(x / 200)},${Math.floor(z / 200)}`;
  for (const p of bridgePoints) { const k = key(p[0], p[1]); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k)!.push(p); }
  const bridgeDistance = (x: number, z: number) => {
    let best = Infinity;
    const bx = Math.floor(x / 200);
    const bz = Math.floor(z / 200);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) for (const p of buckets.get(`${bx + dx},${bz + dz}`) ?? []) best = Math.min(best, Math.hypot(p[0] - x, p[1] - z));
    return best;
  };

  const buffers: Record<BufferKey, { positions: number[]; colors: number[]; indices: number[]; dists: number[] }> = {
    longda: { positions: [], colors: [], indices: [], dists: [] },
    nanguang: { positions: [], colors: [], indices: [], dists: [] },
    district: { positions: [], colors: [], indices: [], dists: [] },
  };
  let positions: number[] = [];
  let colors: number[] = [];
  let indices: number[] = [];
  let dists: number[] = [];
  let currentKey: BufferKey = "longda";
  const useBuffer = (key: BufferKey) => { currentKey = key; ({ positions, colors, indices, dists } = buffers[key]); };
  const deckColor = new THREE.Color(expressways.deck);
  const sideColor = new THREE.Color(expressways.side);
  const piers: { x: number; z: number; ground: number; top: number }[] = [];
  const half = expressways.width / 2;
  const deckBuckets = new Map<string, { x: number; z: number; y: number; key: BufferKey }[]>();

  for (const road of segments) {
    const points = densify(pairs(road.p), 15);
    if (points.length < 2) continue;
    useBuffer(keyOf(road.n));
    const ground = followGround(points, terrain, 6);
    const lift = points.map(([x, z]) => {
      const t = Math.max(0, Math.min(1, 1 - bridgeDistance(x, z) / 160));
      return expressways.embankment + (expressways.viaduct - expressways.embankment) * t * t * (3 - 2 * t);
    });
    // 非光明的跨海桥以海平面为最低基准；海底 DEM 不能把桥面拉到海面以下。
    const top = smooth(ground.map((g, i) => (options && road.b ? Math.max(0, g) : g) + lift[i]), 4);
    const roadCum = [0];
    for (let i = 1; i < points.length; i += 1) roadCum.push(roadCum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    points.forEach(([x, z], i) => {
      const k = key(x, z);
      if (!deckBuckets.has(k)) deckBuckets.set(k, []);
      deckBuckets.get(k)!.push({ x, z, y: top[i], key: keyOf(road.n) });
    });
    const sides = points.map((_, i) => {
      const [px, pz] = points[Math.max(0, i - 1)];
      const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
      const len = Math.hypot(nx - px, nz - pz) || 1;
      return [-(nz - pz) / len, (nx - px) / len] as Pt;
    });
    // 断面 6 个点：左坡脚、左路肩、右路肩、右坡脚（路堤），高架段坡脚收到桥面下方 3m
    const base = positions.length / 3;
    points.forEach(([x, z], i) => {
      const [sx, sz] = sides[i];
      const isViaduct = lift[i] > expressways.embankment + 4;
      const bottom = isViaduct ? top[i] - 3 : terrain.heightAt(x, z) - 1;
      const footSpread = isViaduct ? 0 : (top[i] - bottom) * 1.6;
      // 断面（单向一幅）：坡脚 · 浅色路肩 · 路面 · 浅色路肩 · 坡脚
      const ring: [number, number, THREE.Color][] = [
        [-(half + footSpread), bottom, sideColor],
        [-half, top[i], sideColor],
        [-half + 2.5, top[i], sideColor],
        [-half + 2.5, top[i], deckColor],
        [half - 2.5, top[i], deckColor],
        [half - 2.5, top[i], sideColor],
        [half, top[i], sideColor],
        [half + footSpread, bottom, sideColor],
      ];
      for (const [offset, y, c] of ring) {
        positions.push(x + sx * offset, y, z + sz * offset);
        colors.push(c.r, c.g, c.b);
        dists.push(origins && currentKey !== "district" ? Math.hypot(x - origins[currentKey][0], z - origins[currentKey][1]) : roadCum[i]);
      }
    });
    const stride = 8;
    for (let i = 0; i < points.length - 1; i += 1) {
      for (const [l, r] of [[0, 1], [1, 2], [3, 4], [5, 6], [6, 7]]) {
        const a = base + i * stride + l;
        const b = base + i * stride + r;
        const c = base + (i + 1) * stride + r;
        const d = base + (i + 1) * stride + l;
        indices.push(a, d, b, b, d, c);
      }
    }
    // 高架段双排桥墩
    let walked = 0;
    for (let i = 1; i < points.length; i += 1) {
      walked += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      if (lift[i] <= expressways.embankment + 4 || walked < 45) continue;
      walked = 0;
      for (const offset of [0]) { // 单向一幅：每处一根桥墩（两幅并行即为双排）
        const x = points[i][0] + sides[i][0] * offset;
        const z = points[i][1] + sides[i][1] * offset;
        piers.push({ x, z, ground: terrain.heightAt(x, z) - 1, top: top[i] - 3 });
      }
    }
  }
  // ---- 匝道：一端接在南光 / 龙大桥面上，按长度从桥面高度线性降到地面
  const deckNear = (x: number, z: number) => {
    let best: { d: number; y: number; key: BufferKey } | null = null;
    const bx = Math.floor(x / 200);
    const bz = Math.floor(z / 200);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) for (const p of deckBuckets.get(`${bx + dx},${bz + dz}`) ?? []) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.d) best = { d, y: p.y, key: p.key };
    }
    return best && best.d < half + 15 ? best : null;
  };
  const consumed = new Set<SandboxData["roads"][number]>(options ? selected : []);
  const rampHalf = 6;
  for (const road of data.roads) {
    if (!road.l) continue;
    const points = densify(pairs(road.p), 10);
    if (points.length < 2) continue;
    const startHit = deckNear(...points[0]);
    const endHit = deckNear(...points[points.length - 1]);
    if (startHit === null && endHit === null) continue;
    const startDeck = startHit?.y ?? null;
    const endDeck = endHit?.y ?? null;
    useBuffer((startHit ?? endHit)!.key);
    consumed.add(road);
    const ground = followGround(points, terrain, 3);
    const cum = [0];
    for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const y0 = startDeck ?? ground[0] + 1.5;
    const y1 = endDeck ?? ground[ground.length - 1] + 1.5;
    const top = points.map((_, i) => Math.max(ground[i] + 1.5, y0 + ((y1 - y0) * cum[i]) / total));
    const base = positions.length / 3;
    points.forEach(([x, z], i) => {
      const [px, pz] = points[Math.max(0, i - 1)];
      const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
      const len = Math.hypot(nx - px, nz - pz) || 1;
      const sx = -(nz - pz) / len;
      const sz = (nx - px) / len;
      const high = top[i] - ground[i] > 6;
      const bottom = high ? top[i] - 2 : ground[i] - 1;
      for (const [offset, y, c] of [[-rampHalf, bottom, sideColor], [-rampHalf, top[i], sideColor], [-rampHalf + 1, top[i], deckColor], [rampHalf - 1, top[i], deckColor], [rampHalf, top[i], sideColor], [rampHalf, bottom, sideColor]] as [number, number, THREE.Color][]) {
        positions.push(x + sx * offset, y, z + sz * offset);
        colors.push(c.r, c.g, c.b);
        dists.push(origins && currentKey !== "district" ? Math.hypot(x - origins[currentKey][0], z - origins[currentKey][1]) : cum[i]);
      }
    });
    for (let i = 0; i < points.length - 1; i += 1) {
      for (const [l, r] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]) {
        const a = base + i * 6 + l;
        const b = base + i * 6 + r;
        const c = base + (i + 1) * 6 + r;
        const d = base + (i + 1) * 6 + l;
        indices.push(a, d, b, b, d, c);
      }
    }
    let walked = 0;
    for (let i = 1; i < points.length; i += 1) {
      walked += cum[i] - cum[i - 1];
      if (top[i] - ground[i] > 6 && walked >= 30) {
        walked = 0;
        piers.push({ x: points[i][0], z: points[i][1], ground: terrain.heightAt(points[i][0], points[i][1]) - 1, top: top[i] - 2 });
      }
    }
  }

  for (const key of Object.keys(buffers) as BufferKey[]) {
    if (key === "district" ? !options : !!options) continue;
    const b = buffers[key];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(b.colors, 3));
    geometry.setAttribute("aDist", new THREE.Float32BufferAttribute(b.dists, 1));
    geometry.setIndex(b.indices);
    geometry.computeVertexNormals();
    const deckMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true, side: THREE.DoubleSide });
    if (key !== "district") addReveal(deckMaterial, expresswayGrowth[key].uniform);
    else {
      // terrain.maskMaterial 以 districtMasked 标记跳过重复遮罩。
      // 高速数据已有范围裁切；海上桥梁必须跳过陆地区界遮罩，否则桥面消失只剩桥墩。
      deckMaterial.userData.districtMasked = true;
    }
    const deck = new THREE.Mesh(geometry, deckMaterial);
    deck.name = `expressway-${key}`;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
  }
  if (piers.length) {
    const pierGeometry = new THREE.CylinderGeometry(2.6, 3.4, 1, 8);
    pierGeometry.translate(0, 0.5, 0);
    const pierMesh = new THREE.InstancedMesh(pierGeometry, new THREE.MeshStandardMaterial({ color: expressways.pier, roughness: 0.8, flatShading: true }), piers.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    piers.forEach((pier, i) => {
      matrix.compose(new THREE.Vector3(pier.x, pier.ground, pier.z), quaternion, new THREE.Vector3(1, Math.max(1, pier.top - pier.ground), 1));
      pierMesh.setMatrixAt(i, matrix);
    });
    pierMesh.castShadow = true;
    pierMesh.receiveShadow = true;
    pierMesh.name = "expressway-piers";
    group.add(pierMesh);
  }
  const maxOf = (values: number[]) => values.reduce((m, v) => (v > m ? v : m), 0);
  return { group, consumed, lengths: { longda: maxOf(buffers.longda.dists), nanguang: maxOf(buffers.nanguang.dists) } };
}
