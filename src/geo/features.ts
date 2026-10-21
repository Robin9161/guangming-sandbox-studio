import * as THREE from "three/webgpu";
import { avenueMedian, expressways, motherRiver, roadClass, exaggerate, roadStyle, water, waterLineWidth } from "../style/palette";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

/**
 * 道路和水系的几何体（贴地的条带、水面多边形）。
 * 这里的材质只是占位，world/roads.ts 和 world/water.ts 会换成 WebGPU 节点材质。
 */

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
  add(points: Pt[], ys: number[], width: number, hex: string, thickness = 0) {
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
        this.dists.push(cum[i]);
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

/** 道路：按等级从细到粗铺条带；城市主轴大道加绿化中央分隔带 */
export function buildRoads(data: SandboxData, terrain: Terrain, skip: Set<SandboxData["roads"][number]> = new Set()) {
  const builder = new RibbonBuilder();
  const order = ["tertiary", "secondary", "primary", "avenue", "trunk", "motorway"];
  const classOf = (road: SandboxData["roads"][number]) => roadClass(road.c, road.n);
  // 南光、龙大在原版里单独做成高架 / 路堤（尚未移植，见路线图阶段 5），这里先不铺
  const sorted = [...data.roads].filter((road) => !skip.has(road) && !(road.c === "motorway" && road.n && expressways.names.test(road.n))).sort((a, b) => order.indexOf(classOf(a)) - order.indexOf(classOf(b)));
  const median = new RibbonBuilder();
  sorted.forEach((road, index) => {
    const cls = classOf(road);
    const style = roadStyle[cls];
    if (!style) return;
    const points = densify(pairs(road.p));
    const lift = 1.5 + order.indexOf(cls) * 0.3 + index * 0.00002;
    const ys = followGround(points, terrain).map((y) => y + lift);
    builder.add(points, ys, road.l ? Math.min(style.width, 12) : style.width, style.color); // 匝道按 12m
    if (cls === "avenue") median.add(points, ys.map((y) => y + 0.4), avenueMedian.width, avenueMedian.color);
  });
  const roadMaterial = drapedMaterial(2);
  const mesh = builder.build(roadMaterial);
  mesh.receiveShadow = true;
  mesh.name = "roads";
  const medianMaterial = drapedMaterial(3, { roughness: 0.95 });
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
