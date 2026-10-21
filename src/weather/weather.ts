import * as THREE from "three/webgpu";
import type { Look } from "../style/artPalette";

/**
 * 天气系统（照搬《无尽动画》的机制）：
 * - 天气强度 level 0–1 慢慢起、慢慢收（约半分钟），不会突变
 * - 自动模式：每隔一两分钟随机换一种天气，中间穿插晴天
 * - 手动切换：快速收掉当前天气、再快速起新的；之后 4 分钟不自动换
 * - 天气改整帧配色（变灰、变冷、雾变浓），雷暴夜里的闪电瞬间照亮整帧
 * 这里只有状态机和配色叠加，不负责画：雨丝、雪花见 fx/precipitation.ts，积雪、湿润见各材质，
 * 体积雾见 fx/fog.ts，它们每帧读 weatherState。
 */

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow";
export const WEATHER_NAMES: Record<WeatherKind, string> = { clear: "晴", cloudy: "多云", rain: "雨", storm: "雷暴", fog: "雾", snow: "雪" };
export const WEATHER_ORDER: WeatherKind[] = ["clear", "cloudy", "rain", "storm", "fog", "snow"];

/** 全场景共享的天气状态（光影驱动、材质、粒子都读这里） */
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

/** 把天气叠到一天的配色上（look/driver.ts 每帧调用） */
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

/** 天气状态机（不含任何渲染）：自动 / 手动切换、强度起落、湿润、积雪、闪电 */
export function createWeather() {
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
    /** 每帧推进。night：夜间系数 0–1（闪电只在夜里打） */
    update: (delta: number, night = 0) => {
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
      const stormy = s.kind === "storm" && s.level > 0.5 && night > 0.5;
      if (stormy) {
        nextFlash -= delta;
        if (nextFlash <= 0) { s.flash = 1; flicker = 0.12; nextFlash = 3 + Math.random() * 8; }
        if (flicker > 0) { flicker -= delta; if (flicker <= 0) s.flash = Math.max(s.flash, 0.8); }
      }
      s.flash *= Math.exp(-delta * 9);
      if (s.flash < 0.005) s.flash = 0;
    },
  };
}

export type Weather = ReturnType<typeof createWeather>;
