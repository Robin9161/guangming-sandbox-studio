import * as THREE from "three";
import { night as nightStyle, sky, water as waterStyle } from "./palette";
import { createLook, evalLook, MOODS, RESTRAINT } from "./artPalette";
import { applyWeatherToLook, weatherState } from "./weather";
import { weatherShadingUniforms } from "./weatherShading";

/** 全场景共享的昼夜系数：0 = 白天，1 = 夜晚。着色器直接读这个 uniform。 */
export const nightUniform = { value: 0 };
/** 夜里亮灯窗户的比例（0–1）。光影模式下随时间变化：黄昏逐渐亮起，深夜熄掉一部分 */
export const windowLitUniform = { value: 0.24 };

/** 让带顶点色的材质在夜里按自身颜色发光（地铁桥面、站点等） */
export function glowFromVertexColor(material: THREE.MeshStandardMaterial, strength: number, dayStrength = 0) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uNight = nightUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (${dayStrength.toFixed(3)} * (1.0 - uNight) + uNight * ${strength.toFixed(3)});`);
  };
  material.needsUpdate = true;
}

/** 让材质在夜里发出固定颜色的光（道路路灯光等） */
export function glowColor(material: THREE.MeshStandardMaterial, hex: string, strength: number) {
  const color = new THREE.Color(hex);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uNight = nightUniform;
    shader.uniforms.uGlow = { value: color };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uGlow;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * uNight * ${strength.toFixed(3)};`);
  };
  material.needsUpdate = true;
}

type Refs = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  bloom: { enabled: boolean; strength: number };
  vignette: { uniforms: Record<string, THREE.IUniform> };
  tinted: { material: THREE.MeshStandardMaterial; day: string; night: string }[];
  clouds: THREE.MeshStandardMaterial;
  radius: number;
  /** 光影模式：太阳绕着沙盘中心转 */
  center: THREE.Vector3;
  sunDistance: number;
  /** 全局调色 pass 的 uniforms（光影模式用） */
  grade: { uniforms: Record<string, THREE.IUniform> };
};

/** 全局调色：按亮度在暗部色和亮部色之间着色，再调饱和度。整帧统一到同一个色调里（光影模式） */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uShadow: { value: new THREE.Color(1, 1, 1) },
    uHigh: { value: new THREE.Color(1, 1, 1) },
    uAmount: { value: 0 },
    uSat: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uShadow;
    uniform vec3 uHigh;
    uniform float uAmount;
    uniform float uSat;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      const vec3 W = vec3(0.2126, 0.7152, 0.0722);
      float l = dot(c, W);
      // 暗部偏暗部色、亮部偏亮部色；两种色都已归一到亮度 1，只改色相不改明暗。
      // 以相乘为主（保留绿地、水、建筑之间的色相差），再少量往同一色调上拉
      vec3 tint = mix(uShadow, uHigh, smoothstep(0.02, 0.55, l));
      c = mix(c, c * tint, uAmount);
      c = mix(c, l * tint, uAmount * 0.2);
      float l2 = dot(c, W);
      c = max(vec3(0.0), mix(vec3(l2), c, uSat));
      gl_FragColor = vec4(c, texel.a);
    }
  `,
};

// 天空穹顶（光影模式）：按视线方向的高度角取天顶 / 天中 / 地平线色，太阳方向加光晕。
// 地平线以下全是地平线色（= 雾色），沙盘边缘溶进同一片空气里。
const domeVertex = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const domeFragment = `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uFog;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uGlow;
  uniform float uSunUp;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;
    // 地平线以下是雾色（远山、沙盘边缘溶进去的颜色），地平线上方一窄条是天边色
    vec3 col = mix(uFog, uHorizon, smoothstep(-0.04, 0.0, y));
    col = mix(col, uMid, smoothstep(0.0, 0.2, y));
    col = mix(col, uTop, smoothstep(0.2, 0.8, y));
    float s = max(dot(dir, normalize(uSunDir)), 0.0);
    // 宽光晕（日出日落时更大更亮）+ 窄光晕 + 日盘
    float halo = pow(s, 6.0) * (0.10 + 0.45 * uGlow) + pow(s, 48.0) * 0.35;
    float disc = smoothstep(0.99955, 0.9998, s);
    // 地平线附近的空气被阳光染色
    float band = (1.0 - smoothstep(0.0, 0.25, abs(y))) * pow(s, 2.0) * 0.35 * uGlow;
    col += uSun * (halo * mix(0.35, 1.0, uSunUp) + band) + uSun * disc * mix(0.6, 2.2, uSunUp);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createAtmosphere(refs: Refs) {
  const { scene, renderer, sun, hemi } = refs;

  // 天空渐变：每帧按昼夜系数重绘一张 2x256 的小贴图
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const background = new THREE.CanvasTexture(canvas);
  background.colorSpace = THREE.SRGBColorSpace;
  scene.background = background;
  const fog = new THREE.Fog(sky.fog, 70000, 160000);
  scene.fog = fog;

  // 星星：只在上半球
  const starCount = 1600;
  const starPositions = new Float32Array(starCount * 3);
  let seed = 3;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < starCount; i += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(0.08 + random() * 0.92);
    const r = refs.radius;
    starPositions.set([Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({ color: "#ffffff", size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  scene.add(stars);

  const c = {
    skyTop: [new THREE.Color(sky.top), new THREE.Color(nightStyle.skyTop)],
    skyBottom: [new THREE.Color(sky.bottom), new THREE.Color(nightStyle.skyBottom)],
    sun: [new THREE.Color("#ffe2b8"), new THREE.Color(nightStyle.moon)],
    hemiSky: [new THREE.Color("#cfe8ff"), new THREE.Color(nightStyle.hemiSky)],
    hemiGround: [new THREE.Color("#f3d9b0"), new THREE.Color(nightStyle.hemiGround)],
  };
  const tinted = refs.tinted.map((item) => ({ ...item, colors: [new THREE.Color(item.day), new THREE.Color(item.night)] }));
  const tmp = new THREE.Color();
  const mix = (pair: THREE.Color[], t: number) => tmp.copy(pair[0]).lerp(pair[1], t);

  let target = 0;
  let current = -1;
  let exposure = 1;
  let sunBase = 3.1;
  let hemiBase = 1.5;
  let dim = 0; // 舞台光压暗系数 0–1
  const apply = (t: number) => {
    const top = mix(c.skyTop, t).getStyle();
    const bottom = mix(c.skyBottom, t).getStyle();
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 2, 256);
    background.needsUpdate = true;
    fog.color.copy(mix(c.skyBottom, t));
    sun.color.copy(mix(c.sun, t));
    sunBase = THREE.MathUtils.lerp(3.1, 0.42, t);
    hemi.color.copy(mix(c.hemiSky, t));
    hemi.groundColor.copy(mix(c.hemiGround, t));
    hemiBase = THREE.MathUtils.lerp(1.5, 0.38, t);
    exposure = THREE.MathUtils.lerp(1.0, 1.05, t);
    renderer.toneMappingExposure = exposure;
    refs.bloom.enabled = t > 0.02;
    refs.bloom.strength = 0.18 * t;
    refs.vignette.uniforms.darkness.value = THREE.MathUtils.lerp(0.9, 1.25, t);
    refs.clouds.emissiveIntensity = THREE.MathUtils.lerp(0.18, 0.0, t);
    refs.clouds.color.copy(tmp.set("#ffffff").lerp(new THREE.Color("#5b6a99"), t));
    for (const item of tinted) item.material.color.copy(mix(item.colors, t));
    starMaterial.opacity = Math.max(0, t * 1.2 - 0.2);
    stars.visible = t > 0.05;
    nightUniform.value = t;
  };

  // ---------- 光影模式 ----------
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(refs.radius * 0.95, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: 0 }, uSunUp: { value: 0 } },
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  dome.name = "sky-dome";
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.visible = false;
  scene.add(dome);
  const domeU = (dome.material as THREE.ShaderMaterial).uniforms;
  const legacySunPosition = sun.position.clone();
  const look = createLook();
  const gradeU = refs.grade.uniforms;
  const waterDay = new THREE.Color(waterStyle.area);
  const waterNight = new THREE.Color(nightStyle.water);
  const cloudNight = new THREE.Color("#5b6a99");
  const white = new THREE.Color("#ffffff");
  const cloudGray = new THREE.Color();
  const W = new THREE.Vector3(0.2126, 0.7152, 0.0722);
  const normalized = (out: THREE.Color, c: THREE.Color) => { const l = Math.max(1e-4, c.r * W.x + c.g * W.y + c.b * W.z); return out.setRGB(c.r / l, c.g / l, c.b / l); };
  let art = false;
  let hour = 17.2;
  let playing = true;
  let moodChoice: number | null = null; // null = 每天随机
  let moodAuto = 2;
  let haze = 1;
  // 晨雾：约六成的日子清晨有雾（第一天一定有，方便看到）
  let dayFog = 0.85;
  const gfU = weatherShadingUniforms;
  const randomMood = () => 1 + Math.floor(Math.random() * (MOODS.length - 1));
  const applyArt = () => {
    evalLook(hour, moodChoice ?? moodAuto, look);
    applyWeatherToLook(look);
    const k = look.colors;
    domeU.uTop.value.copy(k.top);
    domeU.uMid.value.copy(k.mid);
    domeU.uHorizon.value.copy(k.horizon);
    domeU.uFog.value.copy(k.fog);
    domeU.uSun.value.copy(k.sun);
    domeU.uSunDir.value.copy(look.sunDir);
    domeU.uGlow.value = look.glow;
    domeU.uSunUp.value = look.sunUp;
    fog.color.copy(k.fog);
    sun.color.copy(k.sun);
    sun.position.copy(refs.center).addScaledVector(look.sunDir, refs.sunDistance);
    sunBase = look.sunI;
    hemi.color.copy(k.sky);
    hemi.groundColor.copy(k.ground);
    hemiBase = look.hemiI;
    exposure = THREE.MathUtils.lerp(1.0, 1.05, look.night);
    renderer.toneMappingExposure = exposure;
    const bloomStrength = 0.18 * look.night + 0.15 * look.glow + 0.6 * weatherState.flash;
    refs.bloom.enabled = bloomStrength > 0.02;
    refs.bloom.strength = bloomStrength;
    refs.vignette.uniforms.darkness.value = THREE.MathUtils.lerp(0.9, 1.25, look.night);
    refs.clouds.emissiveIntensity = 0.18 * (1 - look.night);
    refs.clouds.color.copy(white).lerp(k.horizon, 0.35).lerp(cloudNight, look.night * 0.8);
    // 阴雨天的云：变灰变暗（雷暴最暗），云底不再发亮
    if (weatherState.kind !== "clear") {
      const storm = weatherState.kind === "storm", rainy = storm || weatherState.kind === "rain";
      refs.clouds.color.lerp(cloudGray.set(storm ? "#3e4450" : rainy ? "#7a828e" : "#b8bec8").multiplyScalar(1 - 0.75 * look.night), weatherState.level * 0.85);
      refs.clouds.emissiveIntensity *= 1 - weatherState.level;
    }
    for (const item of tinted) item.material.color.copy(waterDay).lerp(k.horizon, 0.3).lerp(waterNight, look.night);
    starMaterial.opacity = Math.max(0, look.night * 1.2 - 0.2);
    stars.visible = look.night > 0.05;
    nightUniform.value = look.night;
    normalized(gradeU.uShadow.value, k.shadow);
    normalized(gradeU.uHigh.value, k.high);
    gradeU.uAmount.value = look.grade * RESTRAINT.grade;
    // 亮灯：18:30 起逐渐亮到约 3 成，22:00 后慢慢熄到 1 成多，天亮前全熄
    const h = hour < 12 ? hour + 24 : hour;
    windowLitUniform.value = THREE.MathUtils.smoothstep(h, 18.3, 20) * (0.3 - 0.17 * THREE.MathUtils.smoothstep(h, 22, 26)) * (1 - THREE.MathUtils.smoothstep(h, 28.5, 30));
    gradeU.uSat.value = look.sat;
    haze = look.haze;
    // 贴地雾：清晨 5 点起雾、6 点半最浓、9 点散尽；「雾」天气更浓更厚。雾色取雾和天边色之间，清晨带一点暖
    const morning = dayFog * THREE.MathUtils.smoothstep(hour, 4.6, 6.2) * (1 - THREE.MathUtils.smoothstep(hour, 6.8, 9.0));
    const weatherFog = weatherState.kind === "fog" ? weatherState.level : 0;
    gfU.uGFAmount.value = Math.max(morning * 0.75, weatherFog);
    gfU.uGFHeight.value = THREE.MathUtils.lerp(55, 170, weatherFog >= morning * 0.75 ? 1 : 0);
    gfU.uGFColor.value.copy(k.fog).lerp(k.horizon, 0.5).multiplyScalar(1.1);
    gfU.uSnow.value = weatherState.snow;
  };

  return {
    /** 光影模式开关：连续的一天、太阳移动、天空穹顶、雾 = 地平线色、全局调色 */
    setArt: (on: boolean) => {
      art = on;
      dome.visible = on;
      scene.background = on ? null : background;
      if (!on) {
        sun.position.copy(legacySunPosition);
        gradeU.uAmount.value = 0;
        gradeU.uSat.value = 1;
        current = -1; // 下一帧立即回到白天 / 夜晚的配色
        windowLitUniform.value = 0.24;
        gfU.uGFAmount.value = 0;
        gfU.uSnow.value = 0;
      }
    },
    setHour: (value: number) => { hour = ((value % 24) + 24) % 24; },
    getHour: () => hour,
    setPlaying: (on: boolean) => { playing = on; },
    /** null = 每天随机 */
    setMood: (index: number | null) => { moodChoice = index; },
    getMood: () => moodChoice ?? moodAuto,
    isArtNight: () => art && look.night > 0.5,
    isArt: () => art,
    /** 雾的基础范围：光影模式按镜头距离推远近（远处溶进地平线色），否则沿用原来的远雾 */
    fogBase: (cameraDistance: number) => {
      if (!art) return { near: 70000, far: 160000 };
      // 夜里雾从更远处起：近处的楼保持清晰，只让远景溶进夜空
      const k = 1 + 0.8 * look.night;
      return { near: (cameraDistance * 1.0 * k) / haze + 1500 * look.night, far: (cameraDistance * 4.2 * k) / haze + 8000 };
    },
    followCamera: (position: THREE.Vector3) => { dome.position.copy(position); },
    setNight: (on: boolean) => { target = on ? 1 : 0; },
    /** 当前昼夜对应的基础曝光（舞台光在此基础上压暗） */
    exposure: () => exposure,
    /** 舞台光：压低太阳光和天空光（不动曝光），让主体之外真正暗下来 */
    setDim: (value: number) => {
      dim = value;
      sun.intensity = sunBase * (1 - 0.62 * dim);
      hemi.intensity = hemiBase * (1 - 0.5 * dim);
    },
    update: (delta: number) => {
      if (art) {
        if (playing) {
          // 一天约 4 分钟；夜里（20:30–4:30）走 3 倍速
          const before = hour;
          const nightish = hour > 20.5 || hour < 4.5;
          hour = (hour + delta * 0.1 * (nightish ? 3 : 1)) % 24;
          if ((before < 12 && hour >= 12) || hour < before) moodAuto = randomMood();
          if (hour < before) dayFog = Math.random() < 0.6 ? 0.6 + 0.35 * Math.random() : 0;
        }
        applyArt();
        sun.intensity = sunBase * (1 - 0.62 * dim);
        hemi.intensity = hemiBase * (1 - 0.5 * dim);
        return;
      }
      if (current === target) return;
      current = current < 0 ? target : current + Math.sign(target - current) * Math.min(Math.abs(target - current), delta / 1.5);
      apply(current);
      sun.intensity = sunBase * (1 - 0.62 * dim);
      hemi.intensity = hemiBase * (1 - 0.5 * dim);
    },
    dispose: () => {
      background.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      starGeometry.dispose();
      starMaterial.dispose();
    },
  };
}
