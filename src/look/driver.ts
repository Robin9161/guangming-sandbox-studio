import * as THREE from "three/webgpu";
import { createLook, evalLook, MOODS, RESTRAINT } from "../style/artPalette";
import { night as nightStyle, water as waterStyle } from "../style/palette";
import { applyWeatherToLook, weatherState } from "../weather/weather";
import type { Region } from "../core/region";
import type { Fog } from "../fx/fog";
import type { Precipitation } from "../fx/precipitation";
import type { Pipeline } from "../post/pipeline";
import type { WaterLayer } from "../world/water";
import type { LookUniforms } from "./uniforms";

export type FogLevel = "off" | "light" | "heavy";

type Refs = {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  focus: THREE.Vector3;
  region: Region;
  U: LookUniforms;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: Fog;
  rain: Precipitation;
  water: WaterLayer;
  post: Pipeline;
  cloudMaterial: THREE.MeshStandardNodeMaterial;
  bridgeGlow: THREE.MeshStandardMaterial[];
};

/**
 * 一天的光影驱动：时刻 → 当天配色（style/artPalette.ts）→ 叠加天气（weather/weather.ts）→ 写进灯光、天空、雾、水、后期。
 * 状态（时刻、是否播放、氛围、雾档位）放在 state 里，界面和以后的时间线都只改 state。
 */
export function createLookDriver(r: Refs) {
  const state = {
    hour: 17.4,
    /** 连续的一天：约 4 分钟一天，夜里（20:30–4:30）3 倍速 */
    playing: true,
    /** 日出日落氛围：null = 每天随机（素 / 玫瑰 / 余烬 / 紫暮 / 金） */
    moodChoice: null as number | null,
    moodAuto: 1,
    fogLevel: "light" as FogLevel,
  };
  const randomMood = () => 1 + Math.floor(Math.random() * (MOODS.length - 1));
  state.moodAuto = randomMood();
  const look = createLook();
  const tmp = new THREE.Vector3();
  const nightWater = new THREE.Color(nightStyle.water);
  const lumOf = (c: THREE.Color) => Math.max(1e-4, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
  const { U, sun, hemi, fog, rain, water, post, region } = r;

  /** 推进时间（播放时） */
  const advance = (delta: number) => {
    if (!state.playing) return;
    const before = state.hour;
    state.hour = (state.hour + delta * 0.1 * (state.hour > 20.5 || state.hour < 4.5 ? 3 : 1)) % 24;
    if ((before < 12 && state.hour >= 12) || state.hour < before) state.moodAuto = randomMood(); // 每到正午、午夜换一种氛围
  };

  /** 按当前时刻 + 天气，写进所有 uniform 和灯光 */
  const apply = () => {
    const hour = state.hour;
    evalLook(hour, state.moodChoice ?? state.moodAuto, look);
    applyWeatherToLook(look); // 天气叠到当天配色上：变灰、变冷、雾变浓、阳光变弱、闪电照亮
    const k = look.colors;
    const wx = weatherState;

    // ---- 天空 ----
    U.top.value.copy(k.top); U.mid.value.copy(k.mid); U.horizon.value.copy(k.horizon); U.fog.value.copy(k.fog);
    U.sun.value.copy(k.sun);
    U.sunDir.value.copy(look.sunDir);
    U.glow.value = look.glow;
    U.sunUp.value = look.sunUp;
    U.stars.value = Math.max(0, look.night * 1.2 - 0.2) * (1 - wx.level * (wx.kind === "clear" ? 0 : 0.9));
    U.night.value = look.night;
    const h = hour < 12 ? hour + 24 : hour;
    U.lit.value = THREE.MathUtils.smoothstep(h, 18.3, 20) * (0.3 - 0.17 * THREE.MathUtils.smoothstep(h, 22, 26)) * (1 - THREE.MathUtils.smoothstep(h, 28.5, 30));
    U.snow.value = wx.snow;
    U.wet.value = wx.wet;

    // ---- 后期 ----
    post.U.shadowTint.value.copy(k.shadow).multiplyScalar(1 / lumOf(k.shadow));
    post.U.highTint.value.copy(k.high).multiplyScalar(1 / lumOf(k.high));
    post.U.grade.value = look.grade * RESTRAINT.grade;
    post.U.sat.value = look.sat;
    post.U.ao.value = 0.85 * (1 - look.night);
    post.U.tilt.value = 1 - 0.85 * look.night; // 夜里移轴减弱，小光点不被糊掉
    post.U.vignette.value = 0.3 + 0.25 * look.night;
    post.U.bloom.value = 0.15 + 0.5 * look.night + 0.6 * wx.flash;

    // ---- 灯光 ----
    sun.color.copy(k.sun);
    sun.intensity = look.sunI;
    sun.target.position.copy(r.focus);
    sun.position.copy(r.focus).addScaledVector(tmp.copy(look.sunDir), 15000);
    hemi.color.copy(k.sky); hemi.groundColor.copy(k.ground); hemi.intensity = look.hemiI;
    // 距离雾跟着镜头远近：近处的城市保持清楚，远景按距离溶进地平线色；夜里雾起点再往后推
    const sceneFog = r.scene.fog as THREE.Fog;
    sceneFog.color.copy(k.fog);
    const camDist = r.camera.position.distanceTo(r.focus);
    const nk = 1 + 0.8 * look.night;
    sceneFog.near = (camDist * nk) / look.haze + 1500 * look.night;
    sceneFog.far = (camDist * 4.2 * nk) / look.haze + 8000;

    // ---- 体积雾 ----
    // 雾色：雾和天边色的中间，再往同亮度的白靠一些（雾是亮的、通透的，不是土黄的沙尘）
    fog.U.color.value.copy(k.fog).lerp(k.horizon, 0.5);
    const fogLum = lumOf(fog.U.color.value);
    fog.U.color.value.lerp(new THREE.Color(fogLum, fogLum, fogLum), 0.15).multiplyScalar(1.2);
    const morning = THREE.MathUtils.smoothstep(hour, 4.6, 6.2) * (1 - THREE.MathUtils.smoothstep(hour, 7.5, 10));
    post.U.fogOn.value = state.fogLevel === "off" ? 0 : 1;
    // 雨雪天空气更湿，体积雾也浓一些；「雾」天气直接拉满；晴天正午几乎没有，清晨、黄昏才浓起来
    const wetAir = wx.kind === "rain" || wx.kind === "storm" || wx.kind === "snow" ? wx.level : 0;
    const fogWeather = wx.kind === "fog" ? wx.level : 0;
    const baseFog = state.fogLevel === "heavy" ? 1.6 : 0.12 + 0.8 * morning + 0.35 * look.glow;
    fog.U.amount.value = Math.max(baseFog * (1 + 1.2 * wetAir), 2.2 * fogWeather);
    fog.U.height.value = state.fogLevel === "heavy" || fogWeather > 0.3 ? 200 : 120;
    if (fogWeather > 0.01) post.U.fogOn.value = 1;
    // 太阳照雾：清晨、黄昏逆光最强（雾被照透），正午弱，夜里没有太阳
    fog.U.sunFog.value = 0.8 + 1.0 * look.glow + 0.6 * morning;
    fog.fogSun.color.copy(k.sun);
    fog.fogSun.intensity = 3 * look.sunUp;
    fog.fogSun.position.copy(fog.fogSun.target.position).addScaledVector(look.sunDir, 8000);

    // ---- 雨雪 ----
    rain.U.rainLevel.value = wx.kind === "rain" || wx.kind === "storm" ? wx.level * (wx.kind === "storm" ? 0.7 : 0.55) : 0;
    rain.U.snowLevel.value = wx.kind === "snow" ? wx.level : 0;
    rain.U.light.value = 0.2 + 0.8 * (1 - 0.85 * look.night);

    // ---- 水 ----
    // 水色：白天往天边色靠一点，夜里变深蓝；浅水往泥土的青绿靠，深水更深更冷，岸边浅色边
    const W = water.U;
    W.color.value.set(waterStyle.area).lerp(k.horizon, 0.3).lerp(nightWater, look.night);
    W.shallow.value.copy(W.color.value).lerp(new THREE.Color("#b9c49a"), 0.35 * (1 - look.night)).multiplyScalar(1.06);
    W.deep.value.copy(W.color.value).lerp(new THREE.Color("#22627e"), 0.75).lerp(k.horizon, 0.12 * (1 - look.night)).lerp(nightWater.clone().multiplyScalar(0.7), look.night * 0.6);
    W.rim.value.copy(W.shallow.value).lerp(new THREE.Color("#f4f1e6"), 0.45 * (1 - look.night));
    const rainy = wx.kind === "rain" || wx.kind === "storm" ? wx.level : 0;
    W.deep.value.lerp(W.shallow.value, 0.4 * rainy); // 雨天：深浅差变小
    W.wave.value = 1 + (wx.kind === "storm" ? 2.5 : wx.kind === "rain" ? 1 : wx.kind === "cloudy" ? 0.4 : 0) * wx.level;

    // ---- 全区：阴影、雾体、倒影平面跟着镜头焦点 ----
    if (region.full) {
      const shadowHalf = THREE.MathUtils.clamp(camDist, 1500, region.HMAX * 1.2);
      const sc = sun.shadow.camera;
      if (Math.abs(sc.right - shadowHalf) > shadowHalf * 0.05) { sc.left = sc.bottom = -shadowHalf; sc.right = sc.top = shadowHalf; sc.updateProjectionMatrix(); }
      fog.follow(r.focus, THREE.MathUtils.clamp(camDist * 1.2, 2500, region.HMAX));
      water.followReflection(r.focus);
    }

    // ---- 云、地标夜光 ----
    r.cloudMaterial.color.set("#ffffff").lerp(k.horizon, 0.35).lerp(new THREE.Color("#5b6a99"), look.night * 0.8);
    r.cloudMaterial.emissiveIntensity = 0.18 * (1 - look.night);
    if (wx.kind !== "clear") {
      const gray = new THREE.Color(wx.kind === "storm" ? "#3e4450" : wx.kind === "rain" ? "#7a828e" : "#b8bec8").multiplyScalar(1 - 0.75 * look.night);
      r.cloudMaterial.color.lerp(gray, wx.level * 0.85);
      r.cloudMaterial.emissiveIntensity *= 1 - wx.level;
    }
    for (const m of r.bridgeGlow) m.emissiveIntensity = THREE.MathUtils.smoothstep(look.night, 0.15, 0.6) * 1.6;
    r.renderer.toneMappingExposure = 1.0;
  };

  /** 云量（天气）：阴雨天最多，雾天、雪天少一些 */
  const cloudCover = () => (weatherState.kind !== "clear" ? weatherState.level * (weatherState.kind === "fog" ? 0.2 : weatherState.kind === "snow" ? 0.5 : 1) : 0);

  return { state, look, advance, apply, cloudCover, moodName: () => MOODS[state.moodChoice ?? state.moodAuto].name };
}

export type LookDriver = ReturnType<typeof createLookDriver>;
