import * as THREE from "three";
import { nightUniform, windowLitUniform } from "./atmosphere";
import { roadClass } from "./palette";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

/**
 * 远处的城市灯光（参考水粉画：远处看不清楼，只剩一片暖色光点；近处是冷色剪影）。
 * 远处的窗户小于一个像素，只会变成一层淡雾，变不成"点" → 单独铺一层固定屏幕大小的暖色光点：
 * 每栋楼屋顶一个（商业、住宅多，工业少），主干道沿线每隔几十米一盏。离镜头近的自动隐去，交给窗户和剪影。
 */

/** 各类建筑亮灯的概率 */
const ON_CHANCE: Record<string, number> = { commercial: 0.95, retail: 0.95, residential: 0.8, public: 0.6, other: 0.5, industrial: 0.2 };
/** 路灯间距（米） */
const LAMP_SPACING: Record<string, number> = { motorway: 70, trunk: 70, avenue: 60, primary: 80 };

const vertex = `
  attribute float aSeed;
  attribute float aChance;
  uniform float uNight;
  uniform float uLit;
  uniform float uPixel;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = -mv.z;
    // 近处隐去（交给窗户和剪影），远处才是光点
    float far = smoothstep(2200.0, 5200.0, dist);
    // 亮灯比例随时间（黄昏渐亮、深夜熄掉一部分）；aChance 为负表示路灯，整夜常亮
    float on = aChance < 0.0 ? 1.0 : step(aSeed, aChance * clamp(uLit * 3.2, 0.0, 1.0));
    vAlpha = smoothstep(0.15, 0.6, uNight) * far * on;
    vSeed = aSeed;
    gl_PointSize = uPixel * mix(1.6, 2.6, fract(aSeed * 13.7)) * clamp(14000.0 / dist, 0.7, 1.0);
    gl_Position = projectionMatrix * mv;
    if (vAlpha < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const fragment = `
  varying float vAlpha;
  varying float vSeed;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a < 0.01) discard;
    // 暖色：橙到暖黄，偶尔一点粉
    float t = fract(vSeed * 7.31);
    vec3 color = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.82, 0.42), t);
    color = mix(color, vec3(1.0, 0.5, 0.45), step(0.93, fract(vSeed * 3.17)));
    gl_FragColor = vec4(color * 1.6, a);
  }
`;

export function buildCityDots(data: SandboxData, terrain: Terrain) {
  const positions: number[] = [];
  const seeds: number[] = [];
  const chances: number[] = [];
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  for (const building of data.buildings) {
    if (building.f) continue; // 示意补全的体块不放
    const ring = pairs(building.p);
    if (!ring.length) continue;
    const x = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const z = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    if (!terrain.inside(x, z)) continue;
    positions.push(x, terrain.heightAt(x, z) + building.h + 3, z);
    seeds.push(random());
    chances.push(ON_CHANCE[building.t] ?? ON_CHANCE.other);
  }
  for (const road of data.roads) {
    const spacing = LAMP_SPACING[roadClass(road.c, road.n)];
    if (!spacing) continue;
    const points = pairs(road.p);
    let next = random() * spacing; // 沿线到下一盏灯的距离
    for (let i = 1; i < points.length; i += 1) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const length = Math.hypot(bx - ax, bz - az);
      for (; next < length; next += spacing) {
        const x = ax + ((bx - ax) * next) / length, z = az + ((bz - az) * next) / length;
        if (!terrain.inside(x, z)) continue;
        positions.push(x, terrain.heightAt(x, z) + 9, z);
        seeds.push(random());
        chances.push(-1);
      }
      next -= length;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute("aChance", new THREE.Float32BufferAttribute(chances, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uNight: nightUniform, uLit: windowLitUniform, uPixel: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "city-dots";
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}
