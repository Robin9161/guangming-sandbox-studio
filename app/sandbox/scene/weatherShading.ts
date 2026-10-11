import * as THREE from "three/webgpu";
import { clamp, dot, float, floor, fract, mix, normalWorld, positionWorld, sin, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import { addColorMod } from "./nodes";

/**
 * 天气在材质上的表现，统一叠加到场景里的实体材质（TSL 节点）：
 * - 贴地雾：雾沉在地势低的地方（按世界高度指数衰减），山头和高楼露出来。清晨的晨雾和「雾」天气共用
 * - 积雪：朝上的面（地面、屋顶、树冠）慢慢积白，带一点斑驳
 */
export const weatherShadingUniforms = {
  uGFAmount: uniform(0),
  uGFBase: uniform(0),
  uGFHeight: uniform(80),
  uGFDist: uniform(2500),
  uGFColor: uniform(new THREE.Color("#dfe6ee")),
  uSnow: uniform(0),
};

const u = weatherShadingUniforms;

/** snowScale：这种表面积雪的程度（路面少一些）；0 表示不积雪 */
export function addWeatherShading(material: THREE.Material, snowScale = 1) {
  const m = material as THREE.MeshStandardMaterial;
  if (m.userData.weatherShading || !(m.isMeshStandardMaterial || (m as unknown as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial)) return;
  m.userData.weatherShading = true;
  if (snowScale > 0) {
    addColorMod(m, (rgb) => {
      // 积雪：朝上的面积白，越平越先白；按 25 m 的格子斑驳一点
      const up = smoothstep(float(0.85).sub(u.uSnow.mul(0.55)), float(0.95).sub(u.uSnow.mul(0.25)), normalWorld.y);
      const patch = fract(sin(dot(floor(positionWorld.xz.div(25.0)), vec2(12.9898, 78.233))).mul(43758.5453)).mul(0.3).add(0.7);
      return mix(rgb, vec3(0.9, 0.93, 0.98), clamp(u.uSnow.mul(snowScale).mul(up).mul(patch).mul(1.2), 0, 1)) as unknown as typeof rgb;
    });
  }
  // 贴地雾改由体积雾（volumeFog.ts）在后期里统一画，这里只管积雪
}
