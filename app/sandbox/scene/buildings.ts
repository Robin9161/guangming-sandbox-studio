import * as THREE from "three/webgpu";
import { abs, attribute, materialColor, vertexColor, clamp, dot, float, floor, fract, fwidth, max, mix, normalize, normalWorld, positionLocal, positionWorld, select, sin, smoothstep, step, uniform, vec2, vec3 } from "three/tsl";
import { addColorMod, addEmissive, setPosition } from "./nodes";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { nightUniform, windowGainUniform, windowLitUniform } from "./atmosphere";
import { activityAt, cityLightUniforms, lampAt } from "./nightLight";
import { buildingColors } from "./palette";
import { Raster, type Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

const FLOOR_HEIGHT = 3.3;

/**
 * 建筑生长（见 growthPlan.ts）：每栋建筑带两个延迟 aGrow = (西岸老城, 光明大道)，单位秒。
 * 两个时钟 uGrowTime / uGrowTime2 走过各自的延迟，建筑就从地面升起；取两者较大的进度。
 * 两个时钟都很大时（默认）全部建筑已长成。所有建筑材质共享这组 uniform。
 */
export const growUniforms = {
  uGrowTime: uniform(1e8),
  uGrowTime2: uniform(1e8),
};
const BAY_WIDTH = 4.2;

/**
 * 建筑材质：在墙面上程序化画窗户网格。
 * 白天窗户是偏蓝的玻璃色；夜里约一半窗户亮起暖光。
 * 窗格小于约一个像素时平滑退化为平均值，避免远景摩尔纹。
 */
function windowMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
  const info = attribute("aInfo", "vec3"); // 底面高度、随机种子、楼高
  const growAttr = attribute("aGrow", "vec2");
  // 生长：两个阶段各自的时钟走过本栋的延迟后升起；高度从底面按比例升起
  const g = max(clamp(growUniforms.uGrowTime.sub(growAttr.x).div(1.1), 0, 1), clamp(growUniforms.uGrowTime2.sub(growAttr.y).div(1.1), 0, 1));
  const growK = g.mul(g).mul(float(3).sub(g.mul(2)));
  setPosition(material, vec3(positionLocal.x, info.x.add(positionLocal.y.sub(info.x).mul(max(growK, 0.002))), positionLocal.z));

  const wallMask = float(1).sub(step(0.5, abs(normalWorld.y)));
  const side = normalize(normalWorld.xz.add(vec2(1e-5)));
  const wu = dot(positionWorld.xz, vec2(side.y.negate(), side.x)).div(BAY_WIDTH);
  const wv = positionWorld.y.sub(info.x).sub(2.5).div(FLOOR_HEIGHT);
  const cell = floor(vec2(wu, wv));
  const f = fract(vec2(wu, wv));
  const pane = step(0.2, f.x).mul(step(f.x, 0.8)).mul(step(0.22, f.y)).mul(step(f.y, 0.78)).mul(step(0.0, wv));
  const sharp = clamp(float(1).sub(max(fwidth(wu), fwidth(wv)).mul(1.3)), 0, 1);
  const windowAmount = mix(0.3, pane, sharp).mul(wallMask);
  const hash = fract(sin(dot(cell.add(info.y), vec2(12.9898, 78.233))).mul(43758.5453));
  // 夜景（参考：深蓝城市剪影 + 少数高楼亮灯）：
  // 只有高楼亮灯，约 35 m 以下基本全暗；商业片区的高楼亮得多一些，每栋楼各有差异
  const activity = smoothstep(0.04, 0.55, activityAt());
  const building = fract(sin(info.y.mul(91.7).add(3.1)).mul(43758.5453));
  const tall = smoothstep(32.0, 70.0, info.z);
  const share = windowLitUniform.mul(0.75).mul(tall).mul(mix(0.6, 1.3, activity)).mul(select(building.lessThan(0.3), float(0.15), mix(0.7, 1.5, building)));
  // 成排亮：先按楼层（每个立面各自）决定这一层亮不亮，层内大多数窗一起亮
  const rowHash = fract(sin(cell.y.add(info.y.mul(13.1)).mul(78.233).add(dot(side, vec2(3.1, 7.7)))).mul(43758.5453));
  const rowOn = step(rowHash, share);
  // 近处一扇扇窗；远处窗格小于像素时只留很淡的平均光，避免整面墙均匀发光像灯箱
  const lit = mix(share.mul(0.22), rowOn.mul(step(hash, 0.6)), sharp);
  // 楼体换成夜间剪影要比天色变暗更快：蓝调时刻（夜间系数约 0.8）就已经完全是剪影
  const nightK = smoothstep(0.1, 0.55, nightUniform);
  // 夜里楼体是竖向渐变的剪影（楼脚偏亮的蓝，楼顶近乎黑的藏青）；不同朝向的墙略有深浅
  const rel = clamp(positionWorld.y.sub(info.x).div(max(info.z, 24.0)), 0, 1);
  const silhouette = mix(vec3(0.02, 0.035, 0.12), vec3(0.004, 0.006, 0.022), smoothstep(0.0, 1.0, rel)).mul(mix(1.0, abs(side.x).mul(0.3).add(0.78), wallMask));
  // 白天的底色（材质色 × 顶点色），路灯照楼脚用
  const albedo = materialColor.rgb.mul(vertexColor().rgb);
  addColorMod(material, (rgb) => {
    const glass = rgb.mul(0.55).add(vec3(0.16, 0.22, 0.3));
    const day = mix(rgb, glass, windowAmount.mul(0.55).mul(float(1).sub(nightK)));
    return mix(day, silhouette.mul(0.2), nightK) as unknown as typeof rgb;
  });
  // 灯色单一：柔和的暖黄白；推近时没亮的窗是暗蓝玻璃；路灯只剩一丝微光照到楼脚
  const lampHere = lampAt().mul(float(1).sub(smoothstep(3.0, 26.0, positionWorld.y.sub(info.x))));
  addEmissive(material, silhouette.mul(nightK)
    .add(vec3(1.0, 0.8, 0.48).mul(windowAmount).mul(lit).mul(nightUniform).mul(windowGainUniform.mul(2.4)))
    .add(vec3(0.02, 0.04, 0.1).mul(pane).mul(sharp).mul(wallMask).mul(float(1).sub(rowOn)).mul(nightK).mul(0.5))
    .add(albedo.mul(cityLightUniforms.uLampColor).mul(lampHere).mul(cityLightUniforms.uLampNight).mul(cityLightUniforms.uLampGain).mul(0.15)), "bld");
  return material;
}

function extrude(ring: [number, number][], height: number, terrain: Terrain, color: THREE.Color, seed: number, delays: [number, number]) {
  const base = Math.min(...ring.map(([x, z]) => terrain.heightAt(x, z))) - 2;
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height + 2, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, base, 0);
  const roof = color.clone().offsetHSL(0, -0.04, 0.08);
  const normals = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(normals.count * 3);
  const info = new Float32Array(normals.count * 3);
  const grow = new Float32Array(normals.count * 2);
  for (let i = 0; i < normals.count; i += 1) {
    const c = normals.getY(i) > 0.5 ? roof : color;
    colors.set([c.r, c.g, c.b], i * 3);
    info.set([base, seed, height], i * 3);
    grow.set(delays, i * 2);
  }
  geometry.setAttribute("aGrow", new THREE.BufferAttribute(grow, 2));
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

export function buildBuildings(data: SandboxData, terrain: Terrain, exclusions: { x: number; z: number; r: number; ring?: [number, number][] }[] = [], occupied?: Raster, growDelays: (x: number, z: number, seed: number) => [number, number] = () => [0, 0]) {
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
    (building.f ? filled : real).push(extrude(ring, building.h, terrain, color, seed, growDelays(cx, cz, seed)));
  });
  const toMesh = (geometries: THREE.BufferGeometry[], name: string) => {
    const merged = geometries.length ? mergeGeometries(geometries, false) : new THREE.BufferGeometry();
    geometries.forEach((geometry) => geometry.dispose());
    const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), windowMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    return mesh;
  };
  return { mesh: toMesh(real, "buildings"), fillMesh: toMesh(filled, "buildings-fill"), footprint };
}
