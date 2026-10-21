import * as THREE from "three/webgpu";
import { abs, attribute, clamp, dot, float, floor, fract, fwidth, max, mix, normalize, normalWorld, positionWorld, select, sin, smoothstep, step, vec2, vec3, vertexColor } from "three/tsl";
import { buildBuildings } from "../geo/buildings";
import type { Region } from "../core/region";
import type { LookUniforms, WithSnow } from "../look/uniforms";

const BAY_WIDTH = 3.6, FLOOR_HEIGHT = 3.4;

/** 统一城市材质：白天配色、夜间渐变剪影、高楼成排亮窗、积雪，一个材质搞定 */
function cityMaterial(U: LookUniforms, withSnow: WithSnow) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, flatShading: true });
  const info = attribute("aInfo", "vec3"); // 底面高度、随机种子、楼高
  const wall = float(1).sub(step(0.5, abs(normalWorld.y)));
  const side = normalize(normalWorld.xz.add(vec2(1e-5)));
  const wu = dot(positionWorld.xz, vec2(side.y.negate(), side.x)).div(BAY_WIDTH);
  const wv = positionWorld.y.sub(info.x).sub(2.5).div(FLOOR_HEIGHT);
  const cell = floor(vec2(wu, wv));
  const f = fract(vec2(wu, wv));
  const pane = step(0.2, f.x).mul(step(f.x, 0.8)).mul(step(0.22, f.y)).mul(step(f.y, 0.78)).mul(step(0.0, wv));
  const sharp = clamp(float(1).sub(max(fwidth(wu), fwidth(wv)).mul(1.3)), 0, 1);
  const windowAmount = mix(0.3, pane, sharp).mul(wall);
  const hash = fract(sin(dot(cell.add(info.y), vec2(12.9898, 78.233))).mul(43758.5453));
  const building = fract(sin(info.y.mul(91.7).add(3.1)).mul(43758.5453));
  // 只有高楼亮灯（约 35 m 以下基本全暗），按楼层成排亮
  const tall = smoothstep(32.0, 70.0, info.z);
  const share = U.lit.mul(0.75).mul(tall).mul(select(building.lessThan(0.3), float(0.15), mix(0.7, 1.5, building)));
  const rowHash = fract(sin(cell.y.add(info.y.mul(13.1)).mul(78.233).add(dot(side, vec2(3.1, 7.7)))).mul(43758.5453));
  const rowOn = step(rowHash, share);
  const lit = mix(share.mul(0.22), rowOn.mul(step(hash, 0.6)), sharp);
  // 夜里楼体是竖向渐变的剪影：楼脚偏蓝，楼顶近黑
  const nightK = smoothstep(0.1, 0.55, U.night);
  const rel = clamp(positionWorld.y.sub(info.x).div(max(info.z, 24.0)), 0, 1);
  const silhouette = mix(vec3(0.02, 0.035, 0.12), vec3(0.004, 0.006, 0.022), smoothstep(0.0, 1.0, rel)).mul(mix(1.0, abs(side.x).mul(0.3).add(0.78), wall));
  const day = vertexColor();
  const glass = day.mul(0.55).add(vec3(0.16, 0.22, 0.3));
  const dayColor = mix(day, glass, windowAmount.mul(0.55));
  m.colorNode = withSnow(mix(dayColor, silhouette.mul(0.2), nightK));
  m.emissiveNode = silhouette.mul(nightK)
    .add(vec3(1.0, 0.8, 0.48).mul(windowAmount).mul(lit).mul(U.night).mul(2.4))
    .add(vec3(0.02, 0.04, 0.1).mul(pane).mul(sharp).mul(wall).mul(float(1).sub(rowOn)).mul(nightK).mul(0.5));
  return m;
}

/** 建筑：原版的建筑拉伸（真实轮廓 + 示意补全），换成统一城市材质 */
export function buildCity(region: Region, U: LookUniforms, withSnow: WithSnow) {
  const { mesh, fillMesh, footprint } = buildBuildings(region.local, region.terrain);
  const group = new THREE.Group();
  group.name = "buildings";
  for (const m of [mesh, fillMesh] as THREE.Mesh[]) {
    m.material = cityMaterial(U, withSnow);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, footprint };
}
