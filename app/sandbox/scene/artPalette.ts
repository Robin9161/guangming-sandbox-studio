import * as THREE from "three";

/**
 * 「光影」模式的配色系统（借鉴《无尽动画》/ ALTO 的做法，颜色为本项目重新调的）：
 * - 整帧颜色只由少数几条随时间变化的关键色派生：天顶、天中、地平线（= 雾色）、阳光、天光、地光
 * - 远处的东西没有自己的颜色，按距离溶进地平线色
 * - 关键帧之间在 OKLCH 里插值，冷暖之间绕品红走（青 → 蓝紫 → 粉 → 橙），日落不发灰
 * - 日出日落叠一层随机"氛围"（玫瑰 / 余烬 / 紫暮 / 金）
 */

type Key = {
  h: number; // 小时
  top: string; mid: string; horizon: string; // 天空三段，地平线色同时是雾色
  sun: string; sunI: number; // 阳光（夜里是月光）
  sky: string; ground: string; hemiI: number; // 半球光
  shadow: string; high: string; grade: number; sat: number; // 全局调色：暗部色、亮部色、强度、饱和度
  fog?: string; // 雾色（远山、远景溶进去的颜色），默认 = 地平线色
  haze: number; // 空气感（雾浓度系数）
  night: number; // 夜间系数：路灯、星星、泛光
};

const KEYS: Key[] = [
  { h: 0, top: "#070d26", mid: "#121c44", horizon: "#25325f", sun: "#9fb4ff", sunI: 0.38, sky: "#36488a", ground: "#141a30", hemiI: 0.42, shadow: "#26306c", high: "#9aaee6", grade: 0.3, sat: 0.85, haze: 0.9, night: 1 },
  { h: 4.6, top: "#141f4e", mid: "#3a427a", horizon: "#7a6c9c", sun: "#b4b0ff", sunI: 0.5, sky: "#5f64a6", ground: "#252440", hemiI: 0.58, shadow: "#36367a", high: "#c8b2d8", grade: 0.32, sat: 0.9, haze: 1.1, night: 0.8 },
  { h: 6.0, top: "#5574b4", mid: "#c497b4", horizon: "#f6b89a", sun: "#ff9c60", sunI: 2.0, sky: "#e2b2ba", ground: "#8a6a6c", hemiI: 0.8, shadow: "#55488a", high: "#ffc49a", grade: 0.3, sat: 1.02, haze: 1.05, night: 0.25 },
  { h: 7.6, top: "#76b2e2", mid: "#b8d6ec", horizon: "#f4e2cf", sun: "#ffd8a6", sunI: 2.6, sky: "#d6e6f4", ground: "#e8cdab", hemiI: 1.3, shadow: "#6a84b8", high: "#ffe4c0", grade: 0.3, sat: 1.0, haze: 1.1, night: 0 },
  { h: 12, top: "#6cb0e6", mid: "#a6d3f0", horizon: "#e0eff4", sun: "#fff0d6", sunI: 3.1, sky: "#cfe6fc", ground: "#f2d8b0", hemiI: 1.5, shadow: "#6e8ec0", high: "#fff2dc", grade: 0.2, sat: 1.0, haze: 0.8, night: 0 },
  { h: 15.8, top: "#68a4da", mid: "#b2d0e6", horizon: "#f0e0c4", sun: "#ffdea6", sunI: 2.85, sky: "#d8e2ee", ground: "#f0cd9e", hemiI: 1.35, shadow: "#687eb6", high: "#ffe0ac", grade: 0.3, sat: 1.02, haze: 1.0, night: 0 },
  { h: 17.5, top: "#6c8cc6", mid: "#dcb6a0", horizon: "#ffc88a", sun: "#ffae5e", sunI: 3.2, sky: "#f0c6a8", ground: "#c09070", hemiI: 0.85, shadow: "#584e94", high: "#ffc078", grade: 0.45, sat: 1.08, haze: 1.1, night: 0 },
  { h: 18.5, top: "#47579a", mid: "#c88a9c", horizon: "#ffa874", sun: "#ff7c4a", sunI: 2.4, sky: "#dca08e", ground: "#7a5a5a", hemiI: 0.7, shadow: "#483a86", high: "#ff9c72", grade: 0.42, sat: 1.02, haze: 1.0, night: 0.3 },
  { h: 19.4, top: "#1e2c80", mid: "#5a4aa0", horizon: "#e07aa8", fog: "#3c4aa0", sun: "#a89cff", sunI: 0.62, sky: "#6862a0", ground: "#2a2440", hemiI: 0.56, shadow: "#2e2e70", high: "#c6a0c8", grade: 0.45, sat: 0.95, haze: 1.1, night: 0.78 },
  { h: 21, top: "#0a1230", mid: "#18244e", horizon: "#2e3a68", sun: "#9fb4ff", sunI: 0.4, sky: "#3a4c8c", ground: "#161b32", hemiI: 0.44, shadow: "#28326e", high: "#9eb0e6", grade: 0.3, sat: 0.86, haze: 0.95, night: 1 },
];

/** 日出日落的氛围（只在日出、日落前后起作用） */
export const MOODS: { id: string; name: string; colors: Partial<Record<"top" | "mid" | "horizon" | "sun" | "high" | "sky", string>> | null }[] = [
  { id: "plain", name: "素", colors: null },
  { id: "rose", name: "玫瑰", colors: { top: "#9a7cb0", mid: "#d49cbc", horizon: "#ffb4c6", sun: "#ffb0c4", high: "#ffbccc", sky: "#d8a2c0" } },
  { id: "ember", name: "余烬", colors: { top: "#7a4a62", mid: "#c06c5c", horizon: "#ff8e4c", sun: "#ff8a3c", high: "#ffae62", sky: "#d88a6a" } },
  { id: "violet", name: "紫暮", colors: { top: "#3c4888", mid: "#8274ac", horizon: "#eaa6a2", sun: "#ffb8a0", high: "#f4b0a8", sky: "#a08cb8" } },
  { id: "gold", name: "金", colors: { top: "#5c8aa6", mid: "#d0b88a", horizon: "#ffd07a", sun: "#ffcc66", high: "#ffe08e", sky: "#f0d4a0" } },
];

// ---------- OKLCH 插值 ----------
const s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v: number) => Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055));
type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
function toOK([R, G, B]: RGB): RGB {
  const r = s2l(R), g = s2l(G), b = s2l(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
}
function fromOK([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, q = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q), l2s(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q)];
}
const MAGENTA = 5.72;
const angDist = (a: number, b: number) => Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
const isWarm = (h: number) => { const d = (((h * 180) / Math.PI) % 360 + 360) % 360; return d < 95 || d > 340; };
function mixLch(x: RGB, y: RGB, t: number): RGB {
  if (t <= 0) return x;
  if (t >= 1) return y;
  const A = toOK(x), B = toOK(y), ca = Math.hypot(A[1], A[2]), cb = Math.hypot(B[1], B[2]);
  if (ca < 0.02 || cb < 0.02) return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  const ha = Math.atan2(A[2], A[1]), hb = Math.atan2(B[2], B[1]);
  let d = ((((hb - ha) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const alt = d - Math.sign(d) * 2 * Math.PI;
  if (isWarm(ha) !== isWarm(hb) && angDist(ha + alt / 2, MAGENTA) < angDist(ha + d / 2, MAGENTA)) d = alt;
  const h = ha + d * t, C = ca + (cb - ca) * t;
  return fromOK([A[0] + (B[0] - A[0]) * t, C * Math.cos(h), C * Math.sin(h)]);
}
function saturate(c: RGB, k: number): RGB { const [L, a, b] = toOK(c); return fromOK([L, a * k, b * k]); }

/**
 * 克制：浓烈的颜色只给天空和远处的雾；照到地面和建筑上的光只带一点同色调的倾向。
 * - lightChroma：阳光、天光、地光、调色色的彩度保留比例
 * - moodOnLight：日出日落氛围作用到光照上的比例（天空是全量）
 * - grade：全局调色强度的比例
 */
export const RESTRAINT = { lightChroma: 0.55, moodOnLight: 0.25, grade: 0.55 };
const SKY_KEYS = new Set(["top", "mid", "horizon", "fog"]);

const COLOR_KEYS = ["top", "mid", "horizon", "fog", "sun", "sky", "ground", "shadow", "high"] as const;
const NUM_KEYS = ["sunI", "hemiI", "grade", "sat", "haze", "night"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
type NumKey = (typeof NUM_KEYS)[number];
const parsed = KEYS.map((k) => ({ h: k.h, c: Object.fromEntries(COLOR_KEYS.map((key) => [key, hex(k[key] ?? k.horizon)])) as Record<ColorKey, RGB>, n: Object.fromEntries(NUM_KEYS.map((key) => [key, k[key]])) as Record<NumKey, number> }));
const parsedMoods = MOODS.map((m) => (m.colors ? Object.fromEntries(Object.entries(m.colors).map(([k, v]) => [k, hex(v!)])) as Partial<Record<ColorKey, RGB>> : null));

export const SUNRISE = 6.0;
export const SUNSET = 18.6;

export type Look = {
  colors: Record<ColorKey, THREE.Color>;
  sunI: number; hemiI: number; grade: number; sat: number; haze: number; night: number;
  /** 日出日落的强度（0–1），用于太阳光晕和泛光 */
  glow: number;
  /** 指向太阳（夜里指向月亮）的单位向量 */
  sunDir: THREE.Vector3;
  /** 太阳是否在地平线上 */
  sunUp: number;
};

const MOON_DIR = new THREE.Vector3(-0.45, 0.78, 0.42).normalize();
const sunTmp = new THREE.Vector3();
const gauss =(x: number, mu: number, sigma: number) => Math.exp(-(((x - mu) / sigma) ** 2));

export function createLook(): Look {
  return { colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, new THREE.Color()])) as Record<ColorKey, THREE.Color>, sunI: 0, hemiI: 0, grade: 0, sat: 1, haze: 1, night: 0, glow: 0, sunDir: new THREE.Vector3(0, 1, 0), sunUp: 0 };
}

/** 按小时（0–24）和氛围求整帧的配色。mood 为 MOODS 的下标 */
export function evalLook(hour: number, mood: number, out: Look) {
  const h = ((hour % 24) + 24) % 24;
  let i = parsed.length - 1;
  for (let k = 0; k < parsed.length; k += 1) if (parsed[k].h <= h) i = k;
  const a = parsed[i], b = parsed[(i + 1) % parsed.length];
  const span = (b.h - a.h + 24) % 24 || 24;
  const u0 = ((h - a.h + 24) % 24) / span;
  const u = u0 * u0 * (3 - 2 * u0);
  const dusk = gauss(h, 18.3, 0.9), dawn = gauss(h, 6.0, 0.75);
  const glow = Math.max(dusk, dawn);
  const moodColors = parsedMoods[mood] ?? null;
  for (const key of COLOR_KEYS) {
    let c = mixLch(a.c[key], b.c[key], u);
    const m = moodColors?.[key];
    const sky = SKY_KEYS.has(key);
    if (m) c = mixLch(c, m, glow * 0.7 * (sky ? 1 : RESTRAINT.moodOnLight));
    c = sky ? (glow > 0.01 ? saturate(c, 1 + 0.1 * glow) : c) : saturate(c, RESTRAINT.lightChroma);
    out.colors[key].setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  }
  for (const key of NUM_KEYS) out[key] = a.n[key] + (b.n[key] - a.n[key]) * u;
  out.glow = glow;
  // 太阳轨迹：东升（+x）→ 南（+z）→ 西落（−x）；为了阴影好看，最高约 62°
  const dayU = (h - SUNRISE) / (SUNSET - SUNRISE);
  out.sunUp = THREE.MathUtils.smoothstep(Math.sin(Math.PI * dayU), -0.05, 0.08);
  const d = Math.min(1, Math.max(0, dayU));
  const el = THREE.MathUtils.degToRad(5 + 57 * Math.sin(Math.PI * d));
  const az = Math.PI * d; // 0 = 东，π/2 = 南，π = 西
  sunTmp.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.75 + 0.25 * Math.cos(el)).normalize();
  // 夜里：月光从西南高处来，固定方向；日出日落前后在两者之间平滑转过去，阴影不跳
  out.sunDir.copy(MOON_DIR).lerp(sunTmp, out.sunUp).normalize();
  return out;
}

/** 小时 → "17:36" */
export const formatHour = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};
