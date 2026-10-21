import * as THREE from "three/webgpu";
import { vertexColor } from "three/tsl";
import { ground } from "../style/palette";
import type { Region } from "../core/region";
import type { WithSnow } from "../look/uniforms";

/** 地形：带泥土侧壁的微缩切块（全区时区界外的周边环境逐渐褪成底板色） */
export function buildTerrainMesh(region: Region, withSnow: WithSnow) {
  const { full, terrain, cx, cz, HX, HZ, baseY, groundAt } = region;
  const group = new THREE.Group();
  group.name = "terrain";
  const step = full ? 30 : 25;
  const geo = new THREE.PlaneGeometry(HX * 2, HZ * 2, Math.round((HX * 2) / step), Math.round((HZ * 2) / step));
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const fade = new THREE.Color("#ebe6da");
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundAt(x, z));
    if (terrain.isGreen(x, z)) {
      const e = terrain.elevationAt(x, z);
      let hill = ground.slopeGreen;
      for (const level of ground.hills) if (e > level.above) hill = level.color;
      c.set(hill);
    } else c.set(ground.urban);
    if (full && !terrain.inside(x, z)) c.lerp(fade, Math.min(0.8, 0.35 + terrain.distanceOutside(x, z) / 1500));
    c.offsetHSL(0, 0, (Math.sin(x * 0.013) * Math.cos(z * 0.017)) * 0.015);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const topMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, flatShading: true });
  topMaterial.colorNode = withSnow(vertexColor().xyz);
  const top = new THREE.Mesh(geo, topMaterial);
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  // 侧壁：沿四条边从地面拉到底座
  const bottom = baseY - 120;
  const wall = (xs: number[], zs: number[]) => {
    const v: number[] = [];
    for (let i = 0; i < xs.length - 1; i += 1) {
      const a = [xs[i], terrain.heightAt(xs[i], zs[i]), zs[i]], b = [xs[i + 1], terrain.heightAt(xs[i + 1], zs[i + 1]), zs[i + 1]];
      v.push(...a, xs[i], bottom, zs[i], ...b, ...b, xs[i], bottom, zs[i], xs[i + 1], bottom, zs[i + 1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  };
  const line = (fixed: number, horizontal: boolean) => {
    const xs: number[] = [], zs: number[] = [];
    const half = horizontal ? HX : HZ;
    for (let t = -half; t <= half; t += step) { xs.push(horizontal ? cx + t : fixed); zs.push(horizontal ? fixed : cz + t); }
    return { xs, zs };
  };
  const soil = new THREE.MeshStandardNodeMaterial({ color: "#cdb994", roughness: 1, side: THREE.DoubleSide });
  for (const [fixed, horizontal] of [[cz - HZ, true], [cz + HZ, true], [cx - HX, false], [cx + HX, false]] as const) {
    const { xs, zs } = line(fixed, horizontal);
    group.add(new THREE.Mesh(wall(xs, zs), soil));
  }
  return group;
}
