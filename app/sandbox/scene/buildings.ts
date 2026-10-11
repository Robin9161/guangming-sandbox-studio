import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { nightUniform, windowLitUniform } from "./atmosphere";
import { cityLightUniforms, cityUniformsGlsl, cityUvGlsl } from "./nightLight";
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
  uGrowTime: { value: 1e8 },
  uGrowTime2: { value: 1e8 },
};
const BAY_WIDTH = 4.2;

/**
 * 建筑材质：在墙面上程序化画窗户网格。
 * 白天窗户是偏蓝的玻璃色；夜里约一半窗户亮起暖光。
 * 窗格小于约一个像素时平滑退化为平均值，避免远景摩尔纹。
 */
function windowMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.uniforms.uLit = windowLitUniform;
    Object.assign(shader.uniforms, cityLightUniforms);
    Object.assign(shader.uniforms, growUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aInfo;\nvarying vec3 vInfo;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nattribute vec2 aGrow;\nuniform float uGrowTime;\nuniform float uGrowTime2;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        // 生长：两个阶段各自的时钟走过本栋的延迟后升起；高度从底面按比例升起
        float growK = max(clamp((uGrowTime - aGrow.x) / 1.1, 0.0, 1.0), clamp((uGrowTime2 - aGrow.y) / 1.1, 0.0, 1.0));
        growK = growK * growK * (3.0 - 2.0 * growK);
        transformed.y = aInfo.x + (transformed.y - aInfo.x) * max(growK, 0.002);`)
      .replace("#include <project_vertex>", "#include <project_vertex>\nvInfo = aInfo;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${cityUniformsGlsl}\nuniform float uNight;\nuniform float uLit;\nvarying vec3 vInfo;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float wallMask = 1.0 - step(0.5, abs(vWNormal.y));
        vec2 side = normalize(vWNormal.xz + vec2(1e-5));
        float wu = dot(vWPos.xz, vec2(-side.y, side.x)) / ${BAY_WIDTH.toFixed(2)};
        float wv = (vWPos.y - vInfo.x - 2.5) / ${FLOOR_HEIGHT.toFixed(2)};
        vec2 cell = floor(vec2(wu, wv));
        vec2 f = fract(vec2(wu, wv));
        float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78) * step(0.0, wv);
        float sharp = clamp(1.0 - max(fwidth(wu), fwidth(wv)) * 1.3, 0.0, 1.0);
        float windowAmount = mix(0.3, pane, sharp) * wallMask;
        float hash = fract(sin(dot(cell + vInfo.y, vec2(12.9898, 78.233))) * 43758.5453);
        // 夜景（参考：深蓝城市剪影 + 少数高楼亮灯）：
        // 只有高楼亮灯，约 35 m 以下基本全暗；商业片区的高楼亮得多一些，每栋楼各有差异
        vec2 cityUv = ${cityUvGlsl.replace("%XZ%", "vWPos.xz")};
        float activity = smoothstep(0.04, 0.55, texture2D(uActivityMap, cityUv).r);
        float building = fract(sin(vInfo.y * 91.7 + 3.1) * 43758.5453);
        float tall = smoothstep(32.0, 70.0, vInfo.z);
        float share = uLit * 0.75 * tall * mix(0.6, 1.3, activity) * (building < 0.3 ? 0.15 : mix(0.7, 1.5, building));
        // 成排亮：先按楼层（每个立面各自）决定这一层亮不亮，层内大多数窗一起亮
        float rowHash = fract(sin((cell.y + vInfo.y * 13.1) * 78.233 + dot(side, vec2(3.1, 7.7))) * 43758.5453);
        float rowOn = step(rowHash, share);
        // 近处一扇扇窗；远处窗格小于像素时只留很淡的平均光，避免整面墙均匀发光像灯箱
        float lit = mix(share * 0.22, rowOn * step(hash, 0.6), sharp);
        vec3 albedo = diffuseColor.rgb;
        // 楼体换成夜间剪影要比天色变暗更快：蓝调时刻（夜间系数约 0.8）就已经完全是剪影，
        // 否则残留的白天浅色会让墙发灰、暗窗发白，整栋楼像蒙了一层雾
        float nightK = smoothstep(0.1, 0.55, uNight);
        vec3 glass = diffuseColor.rgb * 0.55 + vec3(0.16, 0.22, 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, windowAmount * 0.55 * (1.0 - nightK));
        // 夜里楼体是竖向渐变的剪影（参考水粉画：楼脚偏亮的蓝，楼顶近乎黑的藏青），基本不靠灯光照明；
        // 不同朝向的墙略有深浅，体块不糊在一起。远近层次交给雾
        float rel = clamp((vWPos.y - vInfo.x) / max(vInfo.z, 24.0), 0.0, 1.0);
        vec3 silhouette = mix(vec3(0.02, 0.035, 0.12), vec3(0.004, 0.006, 0.022), smoothstep(0.0, 1.0, rel));
        silhouette *= mix(1.0, 0.78 + 0.3 * abs(side.x), wallMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, silhouette * 0.2, nightK);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += silhouette * nightK;
        // 灯色单一：柔和的暖黄白
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.48) * windowAmount * lit * uNight * 2.4;
        // 推近时：没亮的窗是暗蓝玻璃，立面有质感而不是一块死黑（远看不生效）
        totalEmissiveRadiance += vec3(0.02, 0.04, 0.1) * pane * sharp * wallMask * (1.0 - rowOn) * nightK * 0.5;
        // 路灯只剩一丝微光照到楼脚
        float lampHere = texture2D(uLampMap, cityUv).r * (1.0 - smoothstep(3.0, 26.0, vWPos.y - vInfo.x));
        totalEmissiveRadiance += albedo * uLampColor * lampHere * uLampNight * 0.15;`);
  };
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
