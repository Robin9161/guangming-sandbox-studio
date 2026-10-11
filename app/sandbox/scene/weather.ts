import * as THREE from "three/webgpu";
import { abs, float, fract, hash, instanceIndex, length, sin, smoothstep, step, uniform, uv, vec2, vec3 } from "three/tsl";
import type { Look } from "./artPalette";

/**
 * 天气系统（照搬《无尽动画》的机制）：
 * - 天气强度 level 0–1 慢慢起、慢慢收（约半分钟），不会突变
 * - 自动模式：每隔一两分钟随机换一种天气，中间穿插晴天
 * - 手动切换：快速收掉当前天气、再快速起新的；之后 4 分钟不自动换
 * - 天气改整帧配色（变灰、变冷、雾变浓），雷暴夜里的闪电瞬间照亮整帧
 * 只在「光影」模式下生效。
 */

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow";
export const WEATHER_NAMES: Record<WeatherKind, string> = { clear: "晴", cloudy: "多云", rain: "雨", storm: "雷暴", fog: "雾", snow: "雪" };
export const WEATHER_ORDER: WeatherKind[] = ["clear", "cloudy", "rain", "storm", "fog", "snow"];

/** 全场景共享的天气状态（atmosphere、材质、粒子都读这里） */
export const weatherState = {
  kind: "clear" as WeatherKind,
  /** 当前强度 0–1 */
  level: 0,
  /** 闪电亮度 0–1（瞬间到 1，很快衰减） */
  flash: 0,
  /** 地面湿度 0–1：比雨慢，停雨后慢慢变干 */
  wet: 0,
  /** 积雪 0–1：下雪时约 45 秒积满，停雪后约 2 分钟化完 */
  snow: 0,
};

/** 各天气的目标强度和自动模式下出现的权重 */
const TARGET: Record<Exclude<WeatherKind, "clear">, number> = { cloudy: 0.8, rain: 0.8, storm: 0.97, fog: 0.85, snow: 0.85 };
const AUTO_WEIGHTS: [Exclude<WeatherKind, "clear">, number][] = [["cloudy", 0.35], ["rain", 0.25], ["storm", 0.12], ["fog", 0.16], ["snow", 0.12]];
const RAMP_SECONDS = 30;
const MANUAL_LOCK = 240;

// ---------- 配色：往同亮度的灰蓝上拉（白天、夜里都成立），雷暴更暗 ----------
const GRAY_TINT = new THREE.Color(0.9, 0.96, 1.1);
const FLASH = new THREE.Color("#dcd8ff");
const tmp = new THREE.Color();
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
function toward(c: THREE.Color, k: number, dark: number) {
  tmp.copy(GRAY_TINT).multiplyScalar(lum(c) * dark);
  c.lerp(tmp, k);
}

/** 把天气叠到一天的配色上（atmosphere 每帧调用） */
export function applyWeatherToLook(look: Look) {
  const { kind, level, flash } = weatherState;
  if (level > 0.001 && (kind === "snow" || kind === "fog")) {
    // 雪：整帧变亮变冷、阳光变弱；雾：变灰、阳光很弱、空气感重
    const snow = kind === "snow";
    const k = level * (snow ? 0.7 : 0.75);
    for (const key of ["top", "mid", "horizon", "fog", "sky", "ground", "shadow", "high"] as const) toward(look.colors[key], k, snow ? 1.08 : 1.0);
    look.colors.sun.lerp(tmp.set(snow ? "#e6eef8" : "#e0e2e4"), k);
    look.sunI *= 1 - level * (snow ? 0.55 : 0.65);
    look.hemiI *= 1 + level * (snow ? 0.15 : 0);
    look.haze *= 1 + level * (snow ? 1.2 : 0.6);
    look.grade *= 1 - 0.6 * k;
    look.sat *= 1 - (snow ? 0.4 : 0.45) * k;
    look.glow *= 1 - k;
    look.sunUp *= 1 - 0.85 * k;
  } else if (level > 0.001 && kind !== "clear") {
    const wet = kind === "rain" || kind === "storm";
    const k = level * (kind === "cloudy" ? 0.55 : kind === "rain" ? 0.85 : 0.95);
    const dark = kind === "storm" ? 0.55 : kind === "rain" ? 0.72 : 0.92;
    for (const key of ["top", "mid", "horizon", "fog", "sky", "ground", "shadow", "high"] as const) toward(look.colors[key], k, dark);
    look.colors.sun.lerp(tmp.set("#c8d0dc"), k);
    look.sunI *= 1 - level * (kind === "cloudy" ? 0.55 : kind === "rain" ? 0.85 : 0.92);
    look.hemiI *= 1 - level * (wet ? 0.28 : 0.1);
    look.haze *= 1 + level * (kind === "cloudy" ? 0.5 : kind === "rain" ? 1.6 : 2.0);
    look.grade *= 1 - 0.6 * k;
    look.sat *= 1 - 0.35 * k;
    look.glow *= 1 - k;
    look.sunUp *= 1 - 0.9 * k;
  }
  if (flash > 0.01) {
    for (const key of ["top", "mid", "horizon", "fog", "sky"] as const) look.colors[key].lerp(FLASH, flash * 0.7);
    look.hemiI += flash * 3;
  }
}

// ---------- 雨丝：跟着镜头焦点的一个体积，大小按镜头距离缩放，任何远近都看得到 ----------
const RAIN_COUNT = 7000;
const SNOW_COUNT = 9000;

export function createWeather(scene: THREE.Scene) {
  const rainUniforms = {
    uCenter: uniform(new THREE.Vector3()),
    uSize: uniform(1000),
    uTime: uniform(0),
    uLevel: uniform(0),
    uWind: uniform(new THREE.Vector2(0.18, 0.08)),
    uOpacity: uniform(0.42),
    uColor: uniform(new THREE.Color("#c9d6ea")),
  };
  // 雨丝和雪花（照搬 WebGPU MVP）：实例化的小面片，位置、下落、摆动全在着色器里算
  const fall = (count: number, o: { speed: number; sway: number; w: number; h: number; level: ReturnType<typeof uniform>; color: ReturnType<typeof uniform>; opacity: ReturnType<typeof uniform>; round: boolean; tilt: number }) => {
    const u = rainUniforms;
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    const r = (k: number) => hash(instanceIndex.add(k * 7919));
    const r1 = r(1), r2 = r(2), r3 = r(3), r4 = r(4);
    const height = u.uSize.mul(0.9);
    const y = fract(r2.sub(u.uTime.mul(o.speed).mul(r1.mul(0.3).add(0.85)))).mul(height).sub(height.mul(0.5));
    const sway = sin(u.uTime.mul(r3.add(0.6)).add(r1.mul(6.283))).mul(u.uSize).mul(o.sway);
    m.positionNode = u.uCenter.add(vec3(r1.sub(0.5).mul(u.uSize).add(sway), y, r3.sub(0.5).mul(u.uSize).add(sway.mul(0.6))));
    m.scaleNode = vec2(u.uSize.mul(o.w), u.uSize.mul(o.h));
    m.rotationNode = float(o.tilt);
    const shape = o.round ? smoothstep(0.5, 0.15, length(uv().sub(0.5))) : smoothstep(0.5, 0.0, abs(uv().x.sub(0.5)));
    m.colorNode = o.color as never;
    m.opacityNode = step(r4, o.level as never).mul(shape).mul(o.opacity as never); // 强度决定有多少雨丝 / 雪花出现
    const sprite = new THREE.Sprite(m);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 6;
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, material: m };
  };
  const snowUniforms = { uLevel: uniform(0), uOpacity: uniform(0.9), uColor: uniform(new THREE.Color("#f4f7fb")) };
  const rainParts = fall(RAIN_COUNT, { speed: 0.9, sway: 0, w: 0.0005, h: 0.03, level: rainUniforms.uLevel, color: rainUniforms.uColor, opacity: rainUniforms.uOpacity, round: false, tilt: 0.12 });
  const snowParts = fall(SNOW_COUNT, { speed: 0.06, sway: 0.012, w: 0.0035, h: 0.0035, level: snowUniforms.uLevel, color: snowUniforms.uColor, opacity: snowUniforms.uOpacity, round: true, tilt: 0 });
  const rain = rainParts.sprite;
  const snowflakes = snowParts.sprite;

  // 闪电：从云层到地面的一道折线，只在闪的那一瞬间可见
  const boltPoints = 16;
  const boltGeometry = new THREE.BufferGeometry();
  boltGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(boltPoints * 3), 3));
  const boltMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 3.8, 5), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const bolt = new THREE.Line(boltGeometry, boltMaterial);
  bolt.frustumCulled = false;
  bolt.visible = false;
  scene.add(bolt);
  const strike = (center: THREE.Vector3, size: number, groundAt: (x: number, z: number) => number) => {
    const x = center.x + (Math.random() - 0.5) * size * 0.8, z = center.z + (Math.random() - 0.5) * size * 0.8;
    const top = 2600 + Math.random() * 800, bottom = groundAt(x, z);
    const pos = boltGeometry.attributes.position as THREE.BufferAttribute;
    let px = x + (Math.random() - 0.5) * size * 0.15, pz = z + (Math.random() - 0.5) * size * 0.15;
    for (let i = 0; i < boltPoints; i += 1) {
      const t = i / (boltPoints - 1);
      if (i === boltPoints - 1) { px = x; pz = z; }
      pos.setXYZ(i, px, THREE.MathUtils.lerp(top, bottom, t), pz);
      px += (Math.random() - 0.5) * size * 0.03 + (x - px) * 0.25;
      pz += (Math.random() - 0.5) * size * 0.03 + (z - pz) * 0.25;
    }
    pos.needsUpdate = true;
  };

  let mode: "auto" | WeatherKind = "auto";
  let timer = 40 + Math.random() * 40; // 自动模式：到点就换
  let manualUntil = 0;
  let pending: WeatherKind | null = null;
  let fast = false;
  let target = 0;
  let time = 0;
  let nextFlash = 5;
  let flicker = -1;

  const pickAuto = () => {
    let r = Math.random() * AUTO_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    for (const [kind, w] of AUTO_WEIGHTS) { r -= w; if (r <= 0) return kind; }
    return "cloudy" as const;
  };

  return {
    /** 手动选天气（之后 4 分钟不自动换）；"auto" 回到自动 */
    set: (kind: "auto" | WeatherKind) => {
      mode = kind;
      if (kind === "auto") { manualUntil = 0; timer = 5; return; }
      manualUntil = time + MANUAL_LOCK;
      pending = kind;
      target = 0;
      fast = true;
    },
    getMode: () => mode,
    /** 当前显示的天气名 */
    name: () => (weatherState.level < 0.05 && !pending ? WEATHER_NAMES.clear : WEATHER_NAMES[pending ?? weatherState.kind]),
    /** center：镜头焦点；camera：镜头位置。雨丝放在两者之间偏镜头的一侧，任何远近都看得清 */
    /** night：夜间系数 0–1（闪电只在夜里打） */
    update: (delta: number, enabled: boolean, center: THREE.Vector3, camera: THREE.Vector3, groundAt: (x: number, z: number) => number, night = 0) => {
      const cameraDistance = camera.distanceTo(center);
      time += delta;
      const s = weatherState;
      if (manualUntil > time || (mode !== "auto" && pending)) {
        // 手动：先收掉当前的，再起新的
        if (pending && s.level < 0.03) { s.kind = pending; target = pending === "clear" ? 0 : TARGET[pending]; pending = null; }
      } else {
        if (mode !== "auto") mode = "auto";
        timer -= delta;
        if (timer <= 0) {
          if (target > 0) { target = 0; timer = 50 + Math.random() * 50; } // 转晴一段
          else { s.kind = pickAuto(); target = TARGET[s.kind as Exclude<WeatherKind, "clear">] * (0.75 + Math.random() * 0.25); timer = 70 + Math.random() * 60; }
        }
      }
      const rate = fast ? delta / 1.5 : delta / RAMP_SECONDS;
      s.level += THREE.MathUtils.clamp(target - s.level, -rate, rate);
      if (!pending && Math.abs(target - s.level) < 0.01) fast = false;
      const raining = s.kind === "rain" || s.kind === "storm" ? s.level : 0;
      s.wet += THREE.MathUtils.clamp(raining - s.wet, -delta / 60, delta / 8);
      const snowing = s.kind === "snow" ? s.level : 0;
      s.snow += THREE.MathUtils.clamp(snowing - s.snow, -delta / 120, delta / 45);

      // 闪电（雷暴，只在夜里）：随机间隔，每次闪两下
      const stormy = s.kind === "storm" && s.level > 0.5 && enabled && night > 0.5;
      if (stormy) {
        nextFlash -= delta;
        if (nextFlash <= 0) { s.flash = 1; flicker = 0.12; nextFlash = 3 + Math.random() * 8; strike(center, Math.max(3000, cameraDistance), groundAt); }
        if (flicker > 0) { flicker -= delta; if (flicker <= 0) s.flash = Math.max(s.flash, 0.8); }
      }
      s.flash *= Math.exp(-delta * 9);
      if (s.flash < 0.005) s.flash = 0;
      bolt.visible = enabled && s.flash > 0.05;
      boltMaterial.opacity = s.flash;

      rain.visible = enabled && raining > 0.01;
      snowflakes.visible = enabled && snowing > 0.01;
      snowUniforms.uLevel.value = snowing;
      if (rain.visible || snowflakes.visible) {
        rainUniforms.uCenter.value.copy(camera).lerp(center, 0.4);
        rainUniforms.uSize.value = THREE.MathUtils.clamp(cameraDistance * 0.55, 300, 20000);
        rainUniforms.uTime.value = time;
        rainUniforms.uLevel.value = raining * (s.kind === "storm" ? 0.7 : 0.55);
      }
      if (!enabled) s.flash = 0;
    },
    /** 雨丝颜色跟随天光：白天浅灰白，夜里暗下来 */
    setRainBrightness: (k: number) => {
      rainUniforms.uColor.value.setRGB(0.79, 0.84, 0.92).multiplyScalar(0.25 + 0.75 * k);
      snowUniforms.uColor.value.setRGB(0.96, 0.97, 0.98).multiplyScalar(0.12 + 0.88 * k);
    },
    dispose: () => { snowParts.material.dispose(); rainParts.material.dispose(); boltGeometry.dispose(); boltMaterial.dispose(); },
  };
}
