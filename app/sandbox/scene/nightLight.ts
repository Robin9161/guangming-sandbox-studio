import * as THREE from "three";
import { nightUniform } from "./atmosphere";
import { roadClass } from "./palette";
import { pairs, type SandboxData } from "./types";

/**
 * 城市夜景的灯光分布（借鉴 ALTO：大面积是暗的，光少而集中、有含义）：
 * - 路灯图：主干道最亮、次干道弱、支路不亮；冷白 LED 光照亮路面、路边的树和楼的底部
 * - 活跃度图：商业区亮灯多、住宅稀疏、工业区基本黑着，窗户灯光据此分布
 * 两张图都是覆盖整个沙盘的低分辨率贴图，着色器按世界坐标采样。
 */

const SIZE = 2048;
/** 路灯：每级道路的光带宽度（米）和亮度 */
const LAMP_ROADS: Record<string, { width: number; strength: number }> = {
  motorway: { width: 50, strength: 1 },
  trunk: { width: 50, strength: 1 },
  avenue: { width: 52, strength: 1 },
  primary: { width: 36, strength: 0.5 },
  secondary: { width: 24, strength: 0.2 },
};
/** 各类建筑的夜间活跃度 */
const ACTIVITY: Record<string, number> = { commercial: 1, retail: 1, public: 0.6, residential: 0.5, other: 0.3, industrial: 0.05 };
/** 路灯颜色：偏冷的 LED 白 */
export const LAMP_COLOR = "#cfe0ff";

const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
blank.needsUpdate = true;

export const cityLightUniforms = {
  uLampMap: { value: blank as THREE.Texture },
  uActivityMap: { value: blank as THREE.Texture },
  uCityOffset: { value: new THREE.Vector2() },
  uCityScale: { value: new THREE.Vector2(1, 1) },
  uLampColor: { value: new THREE.Color(LAMP_COLOR) },
  uLampNight: nightUniform,
};

export function buildCityLight(data: SandboxData, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxZ - bounds.minZ;
  const px = SIZE / Math.max(w, h);
  const canvas = (draw: (c: CanvasRenderingContext2D) => void, blurMeters: number) => {
    const raw = document.createElement("canvas");
    raw.width = raw.height = SIZE;
    const c = raw.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, SIZE, SIZE);
    c.globalCompositeOperation = "lighten";
    c.lineCap = "round";
    c.lineJoin = "round";
    draw(c);
    const out = document.createElement("canvas");
    out.width = out.height = SIZE;
    const o = out.getContext("2d")!;
    o.filter = `blur(${Math.max(0.5, blurMeters * px)}px)`;
    o.drawImage(raw, 0, 0);
    const texture = new THREE.CanvasTexture(out);
    texture.flipY = false;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  };
  const toPx = ([x, z]: [number, number]) => [(x - bounds.minX) * px, (z - bounds.minZ) * px] as const;
  const gray = (v: number) => { const k = Math.round(v * 255); return `rgb(${k},${k},${k})`; };

  const lamp = canvas((c) => {
    for (const road of data.roads) {
      const style = LAMP_ROADS[roadClass(road.c, road.n)];
      if (!style) continue;
      const points = pairs(road.p);
      if (points.length < 2) continue;
      c.strokeStyle = gray(style.strength);
      c.lineWidth = style.width * px;
      c.beginPath();
      points.forEach((p, i) => { const [x, y] = toPx(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke();
    }
  }, 9);
  const activity = canvas((c) => {
    for (const building of data.buildings) {
      const value = ACTIVITY[building.t] ?? ACTIVITY.other;
      const ring = pairs(building.p);
      if (ring.length < 3) continue;
      c.fillStyle = gray(value);
      c.beginPath();
      ring.forEach((p, i) => { const [x, y] = toPx(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.closePath();
      c.fill();
      // 让同一片区连成一团：在楼周围再铺一圈同值的光斑
      const [cx, cy] = toPx(ring[0]);
      c.beginPath();
      c.arc(cx, cy, 90 * px, 0, Math.PI * 2);
      c.fill();
    }
  }, 120);

  cityLightUniforms.uLampMap.value = lamp;
  cityLightUniforms.uActivityMap.value = activity;
  cityLightUniforms.uCityOffset.value.set(bounds.minX, bounds.minZ);
  cityLightUniforms.uCityScale.value.set(px / SIZE, px / SIZE);
  return { dispose: () => { lamp.dispose(); activity.dispose(); } };
}

/** 着色器片段：按世界坐标 xz 取贴图坐标 */
export const cityUvGlsl = "((%XZ% - uCityOffset) * uCityScale)";
export const cityUniformsGlsl = "uniform sampler2D uLampMap;\nuniform sampler2D uActivityMap;\nuniform vec2 uCityOffset;\nuniform vec2 uCityScale;\nuniform vec3 uLampColor;\nuniform float uLampNight;";

let counter = 0;
/**
 * 路灯照亮这个材质（路面、地面、树）：夜里按路灯图把表面自身的颜色用冷白光提亮。
 * strength 控制被照亮的程度。
 */
export function litByStreetLamps(material: THREE.MeshStandardMaterial, strength: number) {
  const previous = material.onBeforeCompile;
  const key = `street-lamps-${(counter += 1)}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, cityLightUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uCityOffset;\nuniform vec2 uCityScale;\nvarying vec2 vLampUv;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 lampWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        lampWorld = instanceMatrix * lampWorld;
        #endif
        lampWorld = modelMatrix * lampWorld;
        vLampUv = ${cityUvGlsl.replace("%XZ%", "lampWorld.xz")};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${cityUniformsGlsl}\nvarying vec2 vLampUv;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uLampColor * texture2D(uLampMap, vLampUv).r * uLampNight * ${strength.toFixed(3)};`);
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|${key}`;
  material.needsUpdate = true;
}
