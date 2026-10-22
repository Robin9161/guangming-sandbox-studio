import * as THREE from "three/webgpu";
import { abs, color, dot, float, Fn, instancedBufferAttribute, luminance, max, mix, normalize, positionLocal, pow, smoothstep, uniform, vec3, vertexColor } from "three/tsl";
import { addEmissive } from "./nodes";
import { night as nightStyle, sky, water as waterStyle } from "./palette";
import { createLook, evalLook, MOODS, RESTRAINT } from "./artPalette";
import { applyWeatherToLook, weatherState } from "./weather";
import { weatherShadingUniforms } from "./weatherShading";
import { rng } from "../studio/clock";
import { params } from "../studio/params";

/** 全场景共享的昼夜系数：0 = 白天，1 = 夜晚。着色器直接读这个 uniform。 */
export const nightUniform = uniform(0);
/** 夜里亮灯窗户的比例（0–1）。光影模式下随时间变化：黄昏逐渐亮起，深夜熄掉一部分 */
export const windowLitUniform = uniform(0.24);
/** 窗灯亮度倍数（参数「窗灯亮度」） */
export const windowGainUniform = uniform(1);

/** 让带顶点色的材质在夜里按自身颜色发光（地铁桥面、站点等） */
export function glowFromVertexColor(material: THREE.MeshStandardMaterial, strength: number, dayStrength = 0) {
  // 白天 dayStrength、夜里 strength：day·(1−n) + n·strength = day + n·(strength − day)
  addEmissive(material, vec3(vertexColor()).mul(nightUniform.mul(strength - dayStrength).add(dayStrength)));
}

/** 让材质在夜里发出固定颜色的光（道路路灯光等） */
export function glowColor(material: THREE.MeshStandardMaterial, hex: string, strength: number) {
  addEmissive(material, color(hex).mul(nightUniform).mul(strength), "gc");
}

type Refs = {
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  bloom: { enabled: boolean; strength: number };
  vignette: { uniforms: { darkness: { value: number } } };
  tinted: { material: THREE.MeshStandardMaterial; day: string; night: string }[];
  clouds: THREE.MeshStandardMaterial;
  radius: number;
  /** 光影模式：太阳绕着沙盘中心转 */
  center: THREE.Vector3;
  sunDistance: number;
  /** 全局调色 pass 的 uniforms（光影模式用） */
  grade: { uniforms: ReturnType<typeof createGrade>["uniforms"] };
};

/** 全局调色：按亮度在暗部色和亮部色之间着色，再调饱和度。整帧统一到同一个色调里（光影模式） */
export function createGrade() {
  const uniforms = { uShadow: uniform(new THREE.Color(1, 1, 1)), uHigh: uniform(new THREE.Color(1, 1, 1)), uAmount: uniform(0), uSat: uniform(1) };
  // 暗部偏暗部色、亮部偏亮部色；两种色都已归一到亮度 1，只改色相不改明暗。
  // 以相乘为主（保留绿地、水、建筑之间的色相差），再少量往同一色调上拉
  const apply = (input: unknown) => Fn(() => {
    const c = vec3(input as ReturnType<typeof vec3>).toVar();
    const l = luminance(c);
    const tint = mix(uniforms.uShadow, uniforms.uHigh, smoothstep(0.02, 0.55, l));
    c.assign(mix(c, c.mul(tint), uniforms.uAmount));
    c.assign(mix(c, tint.mul(l), uniforms.uAmount.mul(0.2)));
    const l2 = luminance(c);
    return max(vec3(0), mix(vec3(l2), c, uniforms.uSat));
  })();
  return { uniforms, apply };
}

// 天空穹顶（光影模式）：按视线方向的高度角取天顶 / 天中 / 地平线色，太阳方向加光晕。
// 地平线以下全是地平线色（= 雾色），沙盘边缘溶进同一片空气里。穹顶跟着镜头走，局部坐标方向即视线方向。
function domeMaterial() {
  const u = { uTop: uniform(new THREE.Color()), uMid: uniform(new THREE.Color()), uHorizon: uniform(new THREE.Color()), uFog: uniform(new THREE.Color()), uSun: uniform(new THREE.Color()), uSunDir: uniform(new THREE.Vector3(0, 1, 0)), uGlow: uniform(0), uSunUp: uniform(0) };
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const y = dir.y;
    const col = mix(u.uFog, u.uHorizon, smoothstep(-0.04, 0.0, y)).toVar();
    col.assign(mix(col, u.uMid, smoothstep(0.0, 0.2, y)));
    col.assign(mix(col, u.uTop, smoothstep(0.2, 0.8, y)));
    const s = max(dot(dir, normalize(u.uSunDir)), 0.0);
    // 宽光晕（日出日落时更大更亮）+ 窄光晕 + 日盘
    const halo = pow(s, 6.0).mul(u.uGlow.mul(0.45).add(0.1)).add(pow(s, 48.0).mul(0.35));
    const disc = smoothstep(0.99955, 0.9998, s);
    // 地平线附近的空气被阳光染色
    const band = float(1).sub(smoothstep(0.0, 0.25, abs(y))).mul(pow(s, 2.0)).mul(0.35).mul(u.uGlow);
    col.addAssign(u.uSun.mul(halo.mul(mix(0.35, 1.0, u.uSunUp)).add(band)).add(u.uSun.mul(disc).mul(mix(0.6, 2.2, u.uSunUp))));
    return col;
  })();
  return { material, uniforms: u };
}

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
  // WebGPU 不支持大于 1 像素的点：用实例化的小方片，每颗星 2.2 像素
  const starMaterial = new THREE.PointsNodeMaterial({ color: "#ffffff", sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  starMaterial.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(starPositions, 3), "vec3") as unknown as ReturnType<typeof vec3>;
  starMaterial.sizeNode = float(2.2);
  const stars = new THREE.Sprite(starMaterial);
  stars.count = starCount;
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
  // 参数（studio/params.ts）乘在这些"基础值"上，每帧在 finalize() 里统一写进灯光、后期
  let bloomBase = 0;
  let satBase = 1;
  let gradeBase = 0;
  let windowLitBase = 0.24;
  let starBase = 0;
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
    bloomBase = t > 0.02 ? 0.18 * t : 0;
    refs.vignette.uniforms.darkness.value = THREE.MathUtils.lerp(0.9, 1.25, t);
    refs.clouds.emissiveIntensity = THREE.MathUtils.lerp(0.18, 0.0, t);
    refs.clouds.color.copy(tmp.set("#ffffff").lerp(new THREE.Color("#5b6a99"), t));
    for (const item of tinted) item.material.color.copy(mix(item.colors, t));
    starBase = Math.max(0, t * 1.2 - 0.2);
    stars.visible = t > 0.05;
    nightUniform.value = t;
  };

  // ---------- 光影模式 ----------
  const domeParts = domeMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(refs.radius * 0.95, 48, 24), domeParts.material);
  dome.name = "sky-dome";
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.visible = false;
  scene.add(dome);
  const domeU = domeParts.uniforms;
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
  const randomMood = () => 1 + Math.floor(rng() * (MOODS.length - 1));
  // 正午 = 原来的「白天」马卡龙风格：10:30–14:00 整段用经典白天的天色、阳光、天光、无调色、无远雾，
  // 前后各约一小时渐入渐出。先混配色再叠天气，所以下雨的正午照样变灰。
  const classic = {
    top: new THREE.Color(sky.top), bottom: new THREE.Color(sky.bottom), mid: new THREE.Color(sky.top).lerp(new THREE.Color(sky.bottom), 0.5),
    sun: c.sun[0].clone(), hemiSky: c.hemiSky[0].clone(), hemiGround: c.hemiGround[0].clone(),
  };
  const classicSunDir = legacySunPosition.clone().sub(refs.center).normalize();
  let macaron = 0; // 当前正午马卡龙的权重（含天气折减），fogBase 用
  const applyClassicNoon = () => {
    const m = THREE.MathUtils.smoothstep(hour, 9.5, 10.5) * (1 - THREE.MathUtils.smoothstep(hour, 14, 15.2));
    if (m <= 0) return 0;
    const k = look.colors;
    k.top.lerp(classic.top, m); k.mid.lerp(classic.mid, m); k.horizon.lerp(classic.bottom, m); k.fog.lerp(classic.bottom, m);
    k.sun.lerp(classic.sun, m); k.sky.lerp(classic.hemiSky, m); k.ground.lerp(classic.hemiGround, m);
    look.sunI += (3.1 - look.sunI) * m;
    look.hemiI += (1.5 - look.hemiI) * m;
    look.grade *= 1 - m;
    look.sat += (1 - look.sat) * m;
    look.sunDir.lerp(classicSunDir, m).normalize();
    return m;
  };
  const fogLight = { morning: 0 };
  const lumOf = (col: THREE.Color) => Math.max(1e-4, col.r * W.x + col.g * W.y + col.b * W.z);
  const applyArt = () => {
    evalLook(hour, moodChoice ?? moodAuto, look);
    const noon = applyClassicNoon();
    applyWeatherToLook(look);
    macaron = noon * (weatherState.kind === "clear" ? 1 : 1 - weatherState.level);
    const k = look.colors;
    // 参数：天空彩度（天空和远雾往同亮度的灰靠或更浓）、太阳方向手动
    for (const col of [k.top, k.mid, k.horizon, k.fog]) {
      const l = lumOf(col);
      col.setRGB(Math.max(0, l + (col.r - l) * params.skyChroma), Math.max(0, l + (col.g - l) * params.skyChroma), Math.max(0, l + (col.b - l) * params.skyChroma));
    }
    if (params.sunManual) {
      look.sunDir.copy(manualSunDir());
      look.sunUp = Math.max(look.sunUp, THREE.MathUtils.smoothstep(params.sunElevation, 0, 6));
    }
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
    bloomBase = 0.18 * look.night + 0.15 * look.glow + 0.6 * weatherState.flash;
    refs.vignette.uniforms.darkness.value = THREE.MathUtils.lerp(0.9, 1.25, look.night);
    refs.clouds.emissiveIntensity = 0.18 * (1 - look.night);
    refs.clouds.color.copy(white).lerp(k.horizon, 0.35 * (1 - macaron)).lerp(cloudNight, look.night * 0.8);
    // 阴雨天的云：变灰变暗（雷暴最暗），云底不再发亮
    if (weatherState.kind !== "clear") {
      const storm = weatherState.kind === "storm", rainy = storm || weatherState.kind === "rain";
      refs.clouds.color.lerp(cloudGray.set(storm ? "#3e4450" : rainy ? "#7a828e" : "#b8bec8").multiplyScalar(1 - 0.75 * look.night), weatherState.level * 0.85);
      refs.clouds.emissiveIntensity *= 1 - weatherState.level;
    }
    for (const item of tinted) item.material.color.copy(waterDay).lerp(k.horizon, 0.3 * (1 - macaron)).lerp(waterNight, look.night);
    starBase = Math.max(0, look.night * 1.2 - 0.2);
    stars.visible = look.night > 0.05;
    nightUniform.value = look.night;
    normalized(gradeU.uShadow.value, k.shadow);
    normalized(gradeU.uHigh.value, k.high);
    gradeBase = look.grade * RESTRAINT.grade;
    // 亮灯：18:30 起逐渐亮到约 3 成，22:00 后慢慢熄到 1 成多，天亮前全熄
    const h = hour < 12 ? hour + 24 : hour;
    windowLitBase = THREE.MathUtils.smoothstep(h, 18.3, 20) * (0.3 - 0.17 * THREE.MathUtils.smoothstep(h, 22, 26)) * (1 - THREE.MathUtils.smoothstep(h, 28.5, 30));
    satBase = look.sat;
    haze = look.haze * Math.max(0.01, params.hazeAmount);
    // 贴地雾：清晨 5 点起雾、6 点半最浓、9 点散尽；「雾」天气更浓更厚。雾色取雾和天边色之间，清晨带一点暖
    const morning = dayFog * THREE.MathUtils.smoothstep(hour, 4.6, 6.2) * (1 - THREE.MathUtils.smoothstep(hour, 6.8, 9.0));
    const weatherFog = weatherState.kind === "fog" ? weatherState.level : 0;
    // 雨雪天空气湿，山谷水边起雾；日出日落有一层薄霭；正午马卡龙时几乎没有
    const wetAir = weatherState.kind === "rain" || weatherState.kind === "storm" || weatherState.kind === "snow" ? weatherState.level : 0;
    const mist = (0.06 + 0.22 * look.glow) * (1 - macaron) * (1 - look.night * 0.5);
    // 雾平时不出现（画面会脏）：只在讲解演示风（volumeFog.forceFog）或手动选「雾」天气时才有
    void mist; void wetAir;
    gfU.uGFAmount.value = weatherFog;
    gfU.uGFHeight.value = THREE.MathUtils.lerp(55, 170, Math.max(weatherFog, wetAir * 0.6));
    fogLight.morning = morning;
    gfU.uGFColor.value.copy(k.fog).lerp(k.horizon, 0.5).multiplyScalar(1.1);
    gfU.uSnow.value = weatherState.snow;
  };

  /** 参数「太阳方向手动」：方位 0 = 北、90 = 东（x 向东，z 向南） */
  const manualDir = new THREE.Vector3();
  const manualSunDir = () => {
    const az = THREE.MathUtils.degToRad(params.sunAzimuth), el = THREE.MathUtils.degToRad(params.sunElevation);
    return manualDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  };
  /** 每帧最后：把参数乘到基础值上，写进灯光、曝光、泛光、调色、亮灯比例 */
  const finalize = () => {
    sun.intensity = sunBase * (1 - 0.62 * dim) * params.sunIntensity;
    hemi.intensity = hemiBase * (1 - 0.5 * dim) * params.skyLight;
    if (!art) sun.position.copy(params.sunManual ? manualSunDir().clone().multiplyScalar(refs.sunDistance).add(refs.center) : legacySunPosition);
    renderer.toneMappingExposure = exposure * params.exposure;
    const bloomStrength = bloomBase * params.bloom;
    refs.bloom.enabled = bloomStrength > 0.02;
    refs.bloom.strength = bloomStrength;
    gradeU.uAmount.value = art ? gradeBase * params.grade : 0;
    gradeU.uSat.value = (art ? satBase : 1) * params.saturation;
    windowLitUniform.value = (art ? windowLitBase : 0.24) * params.windowShare;
    windowGainUniform.value = params.windowBrightness;
    starMaterial.opacity = starBase * params.stars;
  };
  const setArt = (on: boolean) => {
    art = on;
    dome.visible = on;
    scene.background = on ? null : background;
    if (!on) {
      sun.position.copy(legacySunPosition);
      current = -1; // 下一帧立即回到白天 / 夜晚的配色
      gfU.uGFAmount.value = 0;
      gfU.uSnow.value = 0;
    }
  };

  return {
    /** 光影模式开关：连续的一天、太阳移动、天空穹顶、雾 = 地平线色、全局调色 */
    setArt,
    /** 记下 / 恢复画面模式和一天的状态（渲染成片时从同一个状态开始） */
    getState: () => ({ art, target, current, hour, playing, moodChoice, moodAuto, dayFog }),
    setState: (s: { art: boolean; target: number; current: number; hour: number; playing: boolean; moodChoice: number | null; moodAuto: number; dayFog: number }) => {
      if (s.art !== art) setArt(s.art);
      ({ target, hour, playing, moodChoice, moodAuto, dayFog } = s);
      if (!art) { current = s.current; if (current >= 0) apply(current); }
    },
    /** 经典模式下是不是夜晚（目标） */
    isNightTarget: () => target === 1,
    isPlaying: () => playing,
    setHour: (value: number) => { hour = ((value % 24) + 24) % 24; },
    getHour: () => hour,
    setPlaying: (on: boolean) => { playing = on; },
    /** null = 每天随机 */
    setMood: (index: number | null) => { moodChoice = index; },
    getMood: () => moodChoice ?? moodAuto,
    isArtNight: () => art && look.night > 0.5,
    isArt: () => art,
    /** 体积雾的"太阳照雾"层要用：当前配色、晨雾强度 */
    fogLight: () => ({ look, morning: fogLight.morning }),
    /** 雾的基础范围：光影模式按镜头距离推远近（远处溶进地平线色），否则沿用原来的远雾 */
    fogBase: (cameraDistance: number) => {
      if (!art) return { near: 70000, far: 160000 };
      // 夜里雾从更远处起：近处的楼保持清晰，只让远景溶进夜空
      const k = 1 + 0.8 * look.night;
      // 远雾保留原来的距离：远山一层层溶进天色（空气透视）是这套美术的关键；日出日落的对比靠加强阳光、减弱天光
      const near = (cameraDistance * 1.0 * k) / haze + 1500 * look.night, far = (cameraDistance * 4.2 * k) / haze + 8000;
      // 正午马卡龙：远雾退回经典白天的 70–160 km（几乎无雾）
      return { near: THREE.MathUtils.lerp(near, 70000, macaron), far: THREE.MathUtils.lerp(far, 160000, macaron) };
    },
    followCamera: (position: THREE.Vector3) => { dome.position.copy(position); },
    setNight: (on: boolean) => { target = on ? 1 : 0; },
    /** 当前昼夜对应的基础曝光（舞台光在此基础上压暗） */
    exposure: () => exposure,
    /** 舞台光：压低太阳光和天空光（不动曝光），让主体之外真正暗下来 */
    setDim: (value: number) => {
      dim = value;
      sun.intensity = sunBase * (1 - 0.62 * dim) * params.sunIntensity;
      hemi.intensity = hemiBase * (1 - 0.5 * dim) * params.skyLight;
    },
    update: (delta: number) => {
      if (art) {
        if (playing) {
          // 一天约 4 分钟（参数「时间流速」可调）；夜里（20:30–4:30）走 3 倍速
          const before = hour;
          const nightish = hour > 20.5 || hour < 4.5;
          hour = (hour + delta * 0.1 * params.timeSpeed * (nightish ? 3 : 1)) % 24;
          if ((before < 12 && hour >= 12) || hour < before) moodAuto = randomMood();
          if (hour < before) dayFog = rng() < 0.6 ? 0.6 + 0.35 * rng() : 0;
        }
        applyArt();
      } else if (current !== target) {
        current = current < 0 ? target : current + Math.sign(target - current) * Math.min(Math.abs(target - current), delta / 1.5);
        apply(current);
      }
      finalize();
    },
    dispose: () => {
      background.dispose();
      dome.geometry.dispose();
      (dome.material as THREE.Material).dispose();
      starMaterial.dispose();
    },
  };
}
