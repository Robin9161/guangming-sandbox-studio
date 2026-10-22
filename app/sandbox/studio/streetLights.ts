import * as THREE from "three/webgpu";
import { cameraPosition, color, float, instancedBufferAttribute, length, smoothstep, uniform, uv, vec3 } from "three/tsl";
import { pairs, type SandboxData } from "../scene/types";
import { night as nightStyle, roadClass, roadStyle } from "../scene/palette";
import type { Terrain } from "../scene/terrain";

/**
 * 路灯光点：沿主要道路两侧每隔一段一个暖色小光点，只在夜里出现（规范 P6：暖光是点缀，不要亮成一片）。
 * 用实例化的小面片（WebGPU 不支持大于 1 像素的点），尺寸按世界单位（米），远了自然变小。
 * 远处（> 5 km）淡出：远景的路灯由 scene/cityDots.ts 的固定像素光点表现，两层在中景交接。
 */
const CLASSES = new Set(["motorway", "trunk", "avenue", "primary", "secondary"]);
const SPACING: Record<string, number> = { motorway: 70, trunk: 55, avenue: 45, primary: 50, secondary: 65 };

export function buildStreetLights(data: SandboxData, terrain: Terrain) {
  const local = data;
  const points: number[] = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const road of local.roads) {
    const cls = roadClass(road.c, road.n);
    if (!CLASSES.has(cls)) continue;
    const half = (roadStyle[cls]?.width ?? 12) / 2 + 2;
    const pts = pairs(road.p);
    let carry = rand() * SPACING[cls];
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = carry; d < len; d += SPACING[cls]) {
        const x = ax + ((bx - ax) * d) / len, z = az + ((bz - az) * d) / len;
        if (!terrain.inside(x, z)) continue;
        const side = Math.floor(d / SPACING[cls]) % 2 === 0 ? 1 : -1; // 两侧交错
        const px = x + nx * half * side, pz = z + nz * half * side;
        points.push(px, terrain.heightAt(px, pz) + 9, pz);
      }
      carry = (carry - len) % SPACING[cls];
      if (carry < 0) carry += SPACING[cls];
    }
  }
  const count = points.length / 3;
  const U = { level: uniform(0), size: uniform(8) }; // 光点直径约 8 m：远看是一串小亮点，近看也不至于像灯笼
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const offsets = new THREE.InstancedBufferAttribute(new Float32Array(points), 3);
  const position = instancedBufferAttribute(offsets, "vec3") as unknown as ReturnType<typeof vec3>;
  m.positionNode = position;
  m.scaleNode = U.size;
  // 中心亮、往外快速衰减的圆点
  const r = length(uv().sub(0.5)).mul(2.0);
  const glow = smoothstep(1.0, 0.0, r).pow(3.0);
  m.colorNode = color(nightStyle.roadGlow).mul(1.3);
  const near = float(1).sub(smoothstep(3500.0, 5500.0, length(position.sub(cameraPosition))));
  m.opacityNode = glow.mul(U.level).mul(near).mul(float(0.75));
  const sprite = new THREE.Sprite(m);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.name = "street-lights";
  sprite.renderOrder = 5;
  return { object: sprite, U, count };
}

export type StreetLights = ReturnType<typeof buildStreetLights>;
