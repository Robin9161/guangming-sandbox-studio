import * as THREE from "three/webgpu";
import { attribute, cameraPosition, color, float, floor, fract, hash, length, max, mix, normalize, positionWorld, pow, reflector, smoothstep, step, texture, texture3D, uniform, vec2, vec3, vec4 } from "three/tsl";
import { simTime as time } from "../studio/clock";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import { nightUniform } from "./atmosphere";
import { night as nightStyle } from "./palette";
import { pairs, type SandboxData } from "./types";
import { weatherState } from "./weather";

/**
 * 水面（来自 WebGPU MVP）：倒影 + 菲涅尔 + 微波 + 雨点涟漪 + 按水体分级的深浅。
 * - 分级：小水塘最浅略浑、湖标准、水库最深倒影如镜、河道倒影弱。同一色相，只改明度、清澈度、倒影强度
 * - 深浅：两张"离岸距离图"（近岸约 16 m、远岸约 125 m 模糊），岸边一圈浅色带，大水面中心变深
 * - 倒影：一个反射平面，取镜头焦点附近最大那片水的水面高度
 * 水的底色跟着原来的昼夜 / 光影配色走（atmosphere 每帧改 tintSource 的颜色），夜里收拢到深色。
 */
export function upgradeWater(water: THREE.Group, data: SandboxData, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, scene: THREE.Scene, tintSource: THREE.MeshStandardMaterial | undefined) {
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const HALF = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;

  const meshes: THREE.Mesh[] = [];
  water.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && (mesh.material as THREE.Material).name !== "embankment") meshes.push(mesh); });
  const areaMeshes = water.children.filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === "ShapeGeometry") as THREE.Mesh[];
  const bodies = meshes.map((mesh) => { const b = new THREE.Box3().setFromObject(mesh); return { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, y: b.max.y, area: (b.max.x - b.min.x) * (b.max.z - b.min.z) }; })
    .filter((b) => Number.isFinite(b.y) && Number.isFinite(b.area));

  // 微波用的 3D 噪声（小一点就够）
  const noise = (() => {
    const size = 48, arr = new Uint8Array(size * size * size), perlin = new ImprovedNoise();
    let i = 0;
    for (let z = 0; z < size; z += 1) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) arr[i++] = 128 + 127 * Math.max(-1, Math.min(1, perlin.noise((x / size) * 6, (y / size) * 6, (z / size) * 6) * 1.6));
    const t = new THREE.Data3DTexture(arr, size, size, size);
    t.format = THREE.RedFormat; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  })();

  // ---- 离岸距离图：水面画白再模糊，岸边约 0.5、离岸远处接近 1 ----
  const SIZE = 2048;
  const metersPerPx = (HALF * 2) / SIZE;
  const raw = document.createElement("canvas");
  raw.width = raw.height = SIZE;
  {
    const g = raw.getContext("2d")!;
    const toPx = (x: number, z: number) => [((x - (cx - HALF)) / (HALF * 2)) * SIZE, ((z - (cz - HALF)) / (HALF * 2)) * SIZE] as const;
    g.fillStyle = "#000"; g.fillRect(0, 0, SIZE, SIZE); g.fillStyle = "#fff";
    for (const area of data.water.areas) {
      g.beginPath();
      for (const ring of [area.p, ...area.h]) pairs(ring).forEach(([x, z], i) => { const [px, pz] = toPx(x, z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.fill("evenodd");
    }
  }
  const blurred = (meters: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d")!;
    g.filter = `blur(${Math.max(0.5, meters / metersPerPx)}px)`;
    g.drawImage(raw, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    return t;
  };
  const nearTex = blurred(16), farTex = blurred(125);
  const shoreUv = positionWorld.xz.sub(vec2(cx - HALF, cz - HALF)).div(HALF * 2);
  const shore = texture(nearTex, shoreUv).r; // 0.5 ≈ 岸线，往里很快到 1
  const center = texture(farTex, shoreUv).r; // 只有大水面的中心才接近 1

  // ---- 每片水的分级：[深度上限, 倒影强度, 往地面色混多少, 岸边浅色边] ----
  const TIERS = { pond: [0.3, 0.35, 0.35, 1.0], lake: [0.7, 0.75, 0.12, 0.6], reservoir: [1.0, 1.0, 0.0, 0.35], river: [0.5, 0.4, 0.2, 0.5] } as const;
  const tierOf = (c: string, area: number) => (c === "river" ? TIERS.river : c === "reservoir" || area > 200000 ? TIERS.reservoir : c === "pond" || area < 10000 ? TIERS.pond : TIERS.lake);
  areaMeshes.forEach((mesh, i) => {
    const a = data.water.areas[i];
    if (!a) return;
    const b = new THREE.Box3().setFromObject(mesh);
    const t = tierOf(a.c, (b.max.x - b.min.x) * (b.max.z - b.min.z) * 0.6);
    const n = mesh.geometry.attributes.position.count;
    const arr = new Float32Array(n * 4);
    for (let k = 0; k < n; k += 1) arr.set(t, k * 4);
    mesh.geometry.setAttribute("aTier", new THREE.BufferAttribute(arr, 4));
  });

  // ---- 倒影 ----
  const reflection = reflector({ resolutionScale: 0.35, bounces: false });
  reflection.target.rotateX(-Math.PI / 2);
  scene.add(reflection.target);
  const wp = positionWorld.xz;
  const waveA = texture3D(noise, vec3(wp.div(160.0), time.mul(0.02)).mod(1.0), 0).r.sub(0.5);
  const waveB = texture3D(noise, vec3(wp.div(70.0).add(17.0), time.mul(0.035)).mod(1.0), 0).r.sub(0.5);
  const uWave = uniform(1);
  const uRain = uniform(0);
  /** 参数（studio/params.ts）：水波、倒影、深浅对比的倍数 */
  const uWaveK = uniform(1), uReflectK = uniform(1), uDepthK = uniform(1);
  const waveOffset = vec2(waveA, waveB).mul(0.014).mul(uWave).mul(uWaveK);
  // 雨点涟漪：按 8 m 的格子，每格随机时刻冒出一圈扩散的波纹；雨越大，冒波纹的格子越多
  const cellP = wp.div(8.0), cellId = floor(cellP), cellF = fract(cellP);
  const seedA = hash(cellId.x.add(cellId.y.mul(157.0))), seedB = hash(cellId.x.mul(1.7).add(cellId.y.mul(91.0)).add(3.0));
  const toDrop = cellF.sub(vec2(seedA, seedB).mul(0.6).add(0.2));
  const age = fract(time.mul(0.9).add(seedA.mul(7.0)));
  const ring = smoothstep(0.07, 0.0, length(toDrop).sub(age.mul(0.42)).abs()).mul(float(1).sub(age)).mul(step(seedB, uRain.mul(1.6)));
  reflection.uvNode = reflection.uvNode!.add(waveOffset).add(normalize(toDrop.add(vec2(1e-4))).mul(ring).mul(0.03));
  // 菲涅尔：从上往下看能看到水的颜色，越斜看越以倒影为主
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(max(viewDir.y, 0.0)), 4.0).mul(0.8).add(0.18);

  // ---- 颜色：从原来的水色派生（跟着昼夜 / 光影配色），夜里收拢到深色 ----
  const baseColor = new THREE.Color("#7fc4d6");
  const base = uniform(baseColor).onFrameUpdate(() => (tintSource ? baseColor.copy(tintSource.color) : baseColor));
  const dayK = float(1).sub(nightUniform);
  // 以原来的马卡龙水色为主：浅处就是原水色，深处只略往深青靠（不往泥土色混，否则河道发灰看不见）
  const shallow = base.mul(1.04);
  const deep = mix(mix(base, color("#2a7f96"), 0.4), color(nightStyle.water).mul(0.7), nightUniform.mul(0.6));
  const rim = mix(shallow, color("#f4f1e6"), dayK.mul(0.45));
  const make = (tier: unknown, mirror: boolean) => {
    const t = tier as ReturnType<typeof vec4>;
    const depth = smoothstep(0.5, 0.95, shore).mul(0.3).add(smoothstep(0.35, 0.95, center).mul(0.7)).mul(t.x).mul(uDepthK).min(1.0);
    const rimK = float(1).sub(smoothstep(0.45, 0.7, shore)).mul(t.w);
    // 雨天深浅差变小
    const body = mix(mix(shallow, mix(deep, shallow, uRain.mul(0.6)), depth), rim, rimK.mul(0.55));
    // 倒影强度打个折：日出日落、蓝调时天空很浓，满倒影会让水面发紫；保持马卡龙水色为主
    const reflectK = fresnel.mul(t.y).mul(0.6).mul(uReflectK).min(1.0);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 });
    m.colorNode = body.mul(float(1).sub(reflectK));
    // 镜面倒影只给湖塘水库（同一张倒影只能给一组水面用）；河道只反射天边色
    const reflected = mirror ? reflection.rgb : base.mul(1.15);
    m.emissiveNode = reflected.mul(reflectK).mul(0.9).add(vec3(ring.mul(0.12)));
    m.roughnessNode = mix(float(0.12), float(0.45), uRain);
    return m;
  };
  const areaMaterial = make(attribute("aTier", "vec4"), true);
  const riverMaterial = make(vec4(0.15, 0.2, 0.0, 0.0), false); // 河道：几乎不加深、倒影弱，保持清楚的青色线
  const materials: THREE.Material[] = [areaMaterial, riverMaterial];
  // 只有湖、塘、水库换成新水面；河道线保留原来鲜亮的马卡龙青色（微缩视角下河是一条清楚的线，倒影反而让它发灰看不见）
  for (const mesh of areaMeshes) if (mesh.geometry.getAttribute("aTier")) mesh.material = areaMaterial;
  void riverMaterial;

  return {
    reflection,
    materials,
    setParams: (wave: number, reflect: number, depth: number) => { uWaveK.value = wave; uReflectK.value = reflect; uDepthK.value = depth; },
    /** 每帧：倒影平面取镜头焦点附近最大的那片水；天气改波纹和雨点 */
    update: (target: THREE.Vector3) => {
      let best = -1, bestY = reflection.target.position.y;
      for (const b of bodies) { const d = Math.hypot(b.x - target.x, b.z - target.z); const score = b.area / (1 + (d / 800) ** 2); if (score > best) { best = score; bestY = b.y; } }
      reflection.target.position.set(target.x, bestY, target.z);
      const wx = weatherState;
      uRain.value = wx.kind === "rain" || wx.kind === "storm" ? wx.level * (wx.kind === "storm" ? 0.7 : 0.55) : 0;
      uWave.value = 1 + (wx.kind === "storm" ? 2.5 : wx.kind === "rain" ? 1 : wx.kind === "cloudy" ? 0.4 : 0) * wx.level;
    },
    dispose: () => { noise.dispose(); nearTex.dispose(); farTex.dispose(); areaMaterial.dispose(); riverMaterial.dispose(); },
  };
}
