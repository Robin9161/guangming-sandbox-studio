import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildingColors } from "../style/palette";
import { Raster, type Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

/**
 * 建筑体块：按轮廓和高度挤出，合并成两个网格（真实建筑 / 示意补全的体块）。
 * 每个顶点带 aInfo = (底面高度, 随机种子, 楼高)，供 world/city.ts 的城市材质画窗户和夜间剪影。
 * 这里只生成几何体，材质由 world/city.ts 设置。
 */

function extrude(ring: [number, number][], height: number, terrain: Terrain, color: THREE.Color, seed: number) {
  const base = Math.min(...ring.map(([x, z]) => terrain.heightAt(x, z))) - 2;
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height + 2, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  const roof = color.clone().offsetHSL(0, -0.04, 0.08);
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(normals.count * 3);
  const info = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i += 1) {
    const c = normals.getY(i) > 0.5 ? roof : color;
    colors.set([c.r, c.g, c.b], i * 3);
    info.set([base, seed, height], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aInfo", new THREE.BufferAttribute(info, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

function insideRing(x: number, z: number, ring: [number, number][]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

export function buildBuildings(data: SandboxData, terrain: Terrain, exclusions: { x: number; z: number; r: number; ring?: [number, number][] }[] = [], occupied?: Raster) {
  const real: THREE.BufferGeometry[] = [];
  const filled: THREE.BufferGeometry[] = [];
  const footprint = new Raster(2048, terrain.bounds);
  const color = new THREE.Color();
  data.buildings.forEach((building, index) => {
    const ring = pairs(building.p);
    const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    // 精细地标所在位置让出来，避免与普通体块重叠
    if (exclusions.some((zone) => (zone.ring ? insideRing(cx, cz, zone.ring) : Math.hypot(cx - zone.x, cz - zone.z) < zone.r))) return;
    // 精细地标的屋顶占用栅格：中心落在地标屋顶下，或一半以上角点被占用，就让给地标
    if (occupied && (occupied.test(cx, cz) || ring.filter(([x, z]) => occupied.test(x, z)).length * 2 > ring.length)) return;
    footprint.fill([ring]);
    const palette = buildingColors[building.t] ?? buildingColors.other;
    color.set(palette[(index * 7 + Math.floor(building.h)) % palette.length]);
    // 示意补全的体块：降低饱和度、提亮，与真实建筑区分
    if (building.f) color.offsetHSL(0, 0, -0.06);
    const seed = (index % 997) * 0.37;
    (building.f ? filled : real).push(extrude(ring, building.h, terrain, color, seed));
  });
  const toMesh = (geometries: THREE.BufferGeometry[], name: string) => {
    const merged = geometries.length ? mergeGeometries(geometries, false) : new THREE.BufferGeometry();
    geometries.forEach((geometry) => geometry.dispose());
    const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    return mesh;
  };
  return { mesh: toMesh(real, "buildings"), fillMesh: toMesh(filled, "buildings-fill"), footprint };
}
