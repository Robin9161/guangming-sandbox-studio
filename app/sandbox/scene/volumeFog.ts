import * as THREE from "three/webgpu";
import { abs, clamp, exp, float, floor, Fn, fract, instancedArray, instanceIndex, int, max, mix, pass, screenCoordinate, select, smoothstep, texture, texture3D, time, uniform, vec2, vec3 } from "three/tsl";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import { bayer16 } from "three/examples/jsm/tsl/math/Bayer.js";
import { gaussianBlur } from "three/examples/jsm/tsl/display/GaussianBlurNode.js";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";
import { weatherShadingUniforms } from "./weatherShading";

/**
 * 体积雾（在 WebGPU MVP 的基础上改成"跟着山水走"）：
 * - 雾体盖住镜头焦点一带，沿视线步进采样 3D 噪声：有厚薄、随风流动、边缘柔和淡出
 * - 雾的多少由一张"雾源图"决定：水面和水边最多，山谷里积雾，林地、山坡次之，城区最少
 * - 雾按"离本地地面的高度"衰减：贴着山坡、河谷走，山头从雾里露出来；另有一层沉在盆地底部的雾
 * - 第二层：被太阳照亮的雾（清晨、黄昏逆光时雾被照透）。体积材质不支持平行光，用一盏远处的聚光灯扮演太阳
 *
 * 浓度、雾层厚度、雾色读 weatherShadingUniforms（atmosphere 按晨雾时间表、天气每帧写入）。
 * 两层都在 1/3 分辨率下计算再模糊，在后期里合成。
 */
const LAYER_FOG = 10;
const LAYER_SUNFOG = 11;
const MAP = 256;

/** 地面高度图 + 雾源图（覆盖整个地形范围，着色器按世界 xz 采样） */
function buildFogMaps(terrain: Terrain, data: SandboxData) {
  const { minX, maxX, minZ, maxZ } = terrain.extent;
  const w = maxX - minX, h = maxZ - minZ;
  const at = (i: number, j: number) => [minX + ((i + 0.5) / MAP) * w, minZ + ((j + 0.5) / MAP) * h] as const;
  const ground = new Float32Array(MAP * MAP);
  for (let j = 0; j < MAP; j += 1) for (let i = 0; i < MAP; i += 1) { const [x, z] = at(i, j); ground[j * MAP + i] = terrain.heightAt(x, z); }
  // 盒式模糊（可分离），用于"周围平均高度"和"离水远近"
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let j = 0; j < MAP; j += 1) for (let i = 0; i < MAP; i += 1) { let s = 0, n = 0; for (let k = -r; k <= r; k += 1) { const ii = i + k; if (ii >= 0 && ii < MAP) { s += src[j * MAP + ii]; n += 1; } } tmp[j * MAP + i] = s / n; }
    for (let j = 0; j < MAP; j += 1) for (let i = 0; i < MAP; i += 1) { let s = 0, n = 0; for (let k = -r; k <= r; k += 1) { const jj = j + k; if (jj >= 0 && jj < MAP) { s += tmp[jj * MAP + i]; n += 1; } } out[j * MAP + i] = s / n; }
    return out;
  };
  // 水面：画成白色再模糊，得到"离水远近"
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MAP;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, MAP, MAP); g.fillStyle = "#fff"; g.strokeStyle = "#fff";
  const px = (x: number, z: number) => [((x - minX) / w) * MAP, ((z - minZ) / h) * MAP] as const;
  for (const a of data.water.areas) { g.beginPath(); pairs(a.p).forEach(([x, z], i) => { const [u, v] = px(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.fill(); }
  g.lineWidth = Math.max(1, (60 / w) * MAP);
  for (const l of data.water.lines) { g.beginPath(); pairs(l.p).forEach(([x, z], i) => { const [u, v] = px(x, z); if (i) g.lineTo(u, v); else g.moveTo(u, v); }); g.stroke(); }
  const pixels = g.getImageData(0, 0, MAP, MAP).data;
  const water = new Float32Array(MAP * MAP);
  for (let k = 0; k < water.length; k += 1) water[k] = pixels[k * 4] / 255;
  const nearWater = blur(water, 3), wideWater = blur(water, 9);
  const meanGround = blur(ground, 10);
  const source = new Float32Array(MAP * MAP);
  for (let j = 0; j < MAP; j += 1) for (let i = 0; i < MAP; i += 1) {
    const k = j * MAP + i, [x, z] = at(i, j);
    const valley = THREE.MathUtils.clamp((meanGround[k] - ground[k]) / 40, 0, 1); // 比周围低 40 m 以上就是谷
    const ridge = THREE.MathUtils.clamp((ground[k] - meanGround[k]) / 60, 0, 1);
    const green = terrain.isGreen(x, z) ? 1 : 0;
    const city = terrain.inside(x, z) && !green ? 1 : 0;
    // 水边最浓，谷底积雾，林地山坡次之；城区（热岛、灯火）最薄；山脊少一点，让山头露出来
    const v = 0.18 + 1.6 * Math.min(1, nearWater[k] * 2.2) + 0.6 * wideWater[k] + 0.9 * valley + 0.35 * green - 0.25 * city - 0.35 * ridge;
    source[k] = THREE.MathUtils.clamp(v, 0.05, 2.2);
  }
  const tex = (arr: Float32Array) => {
    const t = new THREE.DataTexture(arr, MAP, MAP, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  // 风场（风吹雾用）：夏季西南风从西边山口吹进来；遇到上坡减速、把上坡分量削掉，于是绕山、顺河谷走
  const cell = Math.max(w, h) / MAP;
  const base = new THREE.Vector2(1, -0.35).normalize(); // +x 东、−z 北：从西南往东北
  const velocity = new Float32Array(MAP * MAP * 2);
  for (let j = 0; j < MAP; j += 1) for (let i = 0; i < MAP; i += 1) {
    const k = j * MAP + i;
    const gx = (ground[j * MAP + Math.min(MAP - 1, i + 1)] - ground[j * MAP + Math.max(0, i - 1)]) / (2 * cell);
    const gz = (ground[Math.min(MAP - 1, j + 1) * MAP + i] - ground[Math.max(0, j - 1) * MAP + i]) / (2 * cell);
    let vx = base.x, vz = base.y;
    const g2 = gx * gx + gz * gz, up = vx * gx + vz * gz;
    if (up > 0 && g2 > 1e-8) { const k2 = Math.min(1, Math.sqrt(g2) * 25); vx -= (gx * up / g2) * k2; vz -= (gz * up / g2) * k2; }
    // 高处风弱一点（风贴着谷底走），上坡更慢
    const slow = 1 / (1 + Math.max(0, up) * 40) * THREE.MathUtils.clamp(1 - Math.max(0, ground[k] - meanGround[k]) / 150, 0.35, 1);
    velocity[k * 2] = vx * slow; velocity[k * 2 + 1] = vz * slow;
  }
  return { groundTex: tex(ground), sourceTex: tex(source), source, velocity, cell, offset: new THREE.Vector2(minX, minZ), scale: new THREE.Vector2(1 / w, 1 / h) };
}

export function createVolumeFog(scene: THREE.Scene, camera: THREE.Camera, sceneDepth: unknown, baseY: number, terrain: Terrain, data: SandboxData, renderer: THREE.WebGPURenderer) {
  const u = weatherShadingUniforms;
  const center = uniform(new THREE.Vector2());
  const half = uniform(3000);
  const maps = buildFogMaps(terrain, data);
  const mapOffset = uniform(maps.offset), mapScale = uniform(maps.scale);

  // ---- 风吹雾（计算着色器）：一张 256² 的"雾量场"每帧被风场平流，上风处吹进来的是干净空气；
  // 没风时按雾源图慢慢长回来。体积雾的浓度乘这张场，所以雾会被风从山口一路推开、在山后留住 ----
  const N = MAP * MAP;
  const fieldA = instancedArray(new Float32Array(maps.source), "float");
  const fieldB = instancedArray(new Float32Array(maps.source), "float");
  const sourceBuf = instancedArray(new Float32Array(maps.source), "float");
  const velocityBuf = instancedArray(maps.velocity, "vec2");
  const uWind = uniform(0); // 0 无风，1 满风
  const uFill = uniform(0); // 讲解时先把整个盆地灌满雾（雾量至少到这个值），再让风吹开
  const uDt = uniform(0.016);
  const uSpeed = uniform(6000 / maps.cell); // 每秒走多少格（讲解用，比真实风快得多：约 6 秒吹过半个盆地）
  type Buf = { element: (i: never) => unknown };
  const fetch = (buf: Buf, i: unknown, j: unknown) => {
    const ii = int(i as never), jj = int(j as never);
    const inside = ii.greaterThanEqual(0).and(ii.lessThan(MAP)).and(jj.greaterThanEqual(0)).and(jj.lessThan(MAP));
    // 网格外：有风时是吹进来的干净空气（0），没风时按边缘值延续
    return select(inside, buf.element(clamp(jj as never, 0, MAP - 1).mul(MAP).add(clamp(ii as never, 0, MAP - 1)) as never) as never, float(0)) as unknown as ReturnType<typeof float>;
  };
  const bilinear = (buf: Buf, p: ReturnType<typeof vec2>) => {
    const p0 = floor(p), f = fract(p);
    const a = fetch(buf, p0.x, p0.y), b = fetch(buf, p0.x.add(1), p0.y), c = fetch(buf, p0.x, p0.y.add(1)), d = fetch(buf, p0.x.add(1), p0.y.add(1));
    return mix(mix(a, b, f.x) as never, mix(c, d, f.x) as never, f.y) as unknown as ReturnType<typeof float>;
  };
  const step = (from: Buf, to: { element: (i: never) => { assign: (v: never) => void } }) => Fn(() => {
    const i = instanceIndex.mod(MAP), j = instanceIndex.div(MAP);
    const v = velocityBuf.element(instanceIndex);
    const back = vec2(float(i), float(j)).sub(v.mul(uSpeed.mul(uWind).mul(uDt)));
    const carried = bilinear(from, back as never);
    const src = max(sourceBuf.element(instanceIndex) as never, uFill);
    // 没风时 2 秒左右长回来；有风时几乎不长，雾被一路吹走
    const regen = mix(float(0.6), float(0), uWind);
    to.element(instanceIndex as never).assign(carried.add((src as unknown as ReturnType<typeof float>).sub(carried).mul(regen.mul(uDt)).clamp(-1, 1)).max(0) as never);
  })().compute(N);
  const stepAB = step(fieldA as never, fieldB as never), stepBA = step(fieldB as never, fieldA as never);
  let flip = false;
  // 体积雾里读当前场（双线性，世界坐标 → 格）
  const fieldAt = (p: unknown) => {
    const g = (p as ReturnType<typeof vec2>).sub(mapOffset).mul(mapScale).mul(MAP).sub(0.5);
    return bilinear(fieldA as never, g as never);
  };

  // 96³ 的 3D 噪声（两层 Perlin 叠加），循环平铺
  const noise = (() => {
    const size = 96, arr = new Uint8Array(size * size * size), perlin = new ImprovedNoise();
    let i = 0;
    for (let z = 0; z < size; z += 1) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const v = perlin.noise((x / size) * 6, (y / size) * 6, (z / size) * 6) * 0.6 + perlin.noise((x / size) * 14, (y / size) * 14, (z / size) * 14) * 0.4;
      arr[i++] = 128 + 127 * Math.max(-1, Math.min(1, v * 1.6));
    }
    const t = new THREE.Data3DTexture(arr, size, size, size);
    t.format = THREE.RedFormat;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  })();

  const density = (positionRay: unknown) => {
    const p = positionRay as ReturnType<typeof vec3>;
    const wind = vec3(time.mul(18.0), 0, time.mul(7.0));
    const n1 = texture3D(noise, p.add(wind).div(1400.0).mod(1.0), 0).r;
    const n2 = texture3D(noise, p.add(wind.mul(1.7)).div(520.0).mod(1.0), 0).r;
    const uv = p.xz.sub(mapOffset).mul(mapScale);
    const ground = texture(maps.groundTex, uv).r;
    const source = fieldAt(p.xz); // 风吹过后的雾源（没风时就等于雾源图）
    const layer = max(u.uGFHeight.mul(1.6), 90);
    // 贴着本地地面的雾（沿山坡、河谷走）+ 沉在盆地底部的雾
    const above = max(p.y.sub(ground), 0);
    const hug = exp(above.div(layer).negate());
    const pool = exp(max(p.y.sub(u.uGFBase), 0).div(layer.mul(0.7)).negate()).mul(0.5);
    // 离雾体边缘 500 m 内逐渐变淡，雾不会被齐刷刷切断
    const edge = smoothstep(half, half.sub(500), abs(p.x.sub(center.x))).mul(smoothstep(half, half.sub(500), abs(p.z.sub(center.y))));
    // 雾源越多，噪声里能"冒出雾"的部分越多：水边、谷底成团，城区只剩零星
    // 噪声对比度放低：是连续的一片薄雾里有浓淡，而不是一团团棉花中间夹着空洞
    const lumps = clamp(n1.mul(0.9).sub(float(0.42).sub(source.mul(0.18))).mul(n2.mul(0.6).add(0.7)), 0, 1).add(0.12);
    return lumps.mul(max(hug, pool)).mul(source).mul(u.uGFAmount.mul(1.7)).mul(edge);
  };

  // ---- 第一层：雾有多浓（灰度），合成时统一上雾色，避免浓雾处发暗发脏 ----
  const material = new THREE.VolumeNodeMaterial();
  material.steps = 28;
  material.offsetNode = bayer16(screenCoordinate);
  material.depthNode = sceneDepth as never;
  (material as unknown as { scatteringEmissiveNode: unknown }).scatteringEmissiveNode = Fn(({ positionRay }: { positionRay: unknown }) => vec3(density(positionRay).mul(0.05)));
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1600, 2), material);
  box.layers.disableAll();
  box.layers.enable(LAYER_FOG);
  box.frustumCulled = false;
  scene.add(box);
  // 体积材质的散射挂在光照计算里：雾的图层里要有一盏灯（只放这一盏，雾不会被额外照亮）
  const ambient = new THREE.AmbientLight("#ffffff", 0.0001);
  ambient.layers.disableAll();
  ambient.layers.enable(LAYER_FOG);
  scene.add(ambient);

  // ---- 第二层：被太阳照亮的雾（读阴影：山体、楼在雾里投下光影） ----
  const uSunFog = uniform(1);
  const sunMaterial = new THREE.VolumeNodeMaterial();
  sunMaterial.steps = 20;
  sunMaterial.offsetNode = bayer16(screenCoordinate);
  sunMaterial.depthNode = sceneDepth as never;
  sunMaterial.scatteringNode = Fn(({ positionRay }: { positionRay: unknown }) => density(positionRay).mul(uSunFog).mul(0.12));
  const sunBox = new THREE.Mesh(box.geometry, sunMaterial);
  sunBox.layers.disableAll();
  sunBox.layers.enable(LAYER_SUNFOG);
  sunBox.frustumCulled = false;
  scene.add(sunBox);
  const fogSun = new THREE.SpotLight("#ffe2b8", 3, 0, 0.5, 0.25, 0);
  fogSun.castShadow = true;
  fogSun.shadow.mapSize.set(2048, 2048);
  fogSun.shadow.camera.near = 3000;
  fogSun.shadow.camera.far = 16000;
  fogSun.shadow.bias = -0.0005;
  fogSun.layers.disableAll();
  fogSun.layers.enable(LAYER_SUNFOG);
  // 阴影相机照常拍普通物体层（灯本身只在雾层）
  fogSun.shadow.camera.layers.set(0);
  scene.add(fogSun, fogSun.target);

  const layerOf = (n: number) => { const l = new THREE.Layers(); l.disableAll(); l.enable(n); return l; };
  const fogPass = pass(scene, camera, { depthBuffer: false });
  fogPass.setLayers(layerOf(LAYER_FOG));
  fogPass.setResolutionScale(0.35);
  const fogBlur = gaussianBlur(fogPass, uniform(0.8));
  const sunPass = pass(scene, camera, { depthBuffer: false });
  sunPass.setLayers(layerOf(LAYER_SUNFOG));
  sunPass.setResolutionScale(0.35);
  const sunBlur = gaussianBlur(sunPass, uniform(0.8));
  /** 0–0.95：画面上这一点被雾遮住多少 */
  const veil = clamp(float(1).sub(exp(fogBlur.r.negate())), 0, 0.95);
  /** 合成：按雾的浓度把画面混向雾色，再加上被太阳照亮的那部分 */
  let windTarget = 0;
  let forced = 0;
  const apply = (c: unknown) => mix(c as ReturnType<typeof vec3>, u.uGFColor, veil).add(sunBlur.rgb);

  return {
    apply,
    /** 风吹雾：on = 起风（从西边山口吹进来）；off = 风停，雾慢慢长回来 */
    setWind: (on: boolean) => { windTarget = on ? 1 : 0; },
    /** 讲解时强制起雾（0 = 不强制，按时间表和天气） */
    forceFog: (amount: number) => { forced = amount; uFill.value = amount > 0 ? 1 : 0; },
    debug: () => ({ forced, wind: uWind.value, amount: u.uGFAmount.value, height: u.uGFHeight.value, half: half.value }),
    /** 雾体跟着镜头焦点走；太阳照雾按当天配色（清晨、黄昏逆光最强，夜里没有） */
    update: (target: THREE.Vector3, cameraDistance: number, maxHalf: number, sun: { dir: THREE.Vector3; color: THREE.Color; up: number; glow: number; morning: number }, delta = 0.016) => {
      // 风吹雾：风慢慢起、慢慢停；场每帧平流一次（A→B 后再 B→A，保证读的总是 A）
      uWind.value += THREE.MathUtils.clamp(windTarget - uWind.value, -delta / 2, delta / 2);
      uDt.value = Math.min(delta, 0.05) / 2;
      renderer.compute(stepAB);
      renderer.compute(stepBA);
      flip = !flip;
      if (forced > 0) { u.uGFAmount.value = Math.max(u.uGFAmount.value, forced); u.uGFHeight.value = Math.max(u.uGFHeight.value, 220); } // 讲解多是俯视，雾层要厚，视线才穿得过足够多的雾
      const h = THREE.MathUtils.clamp(cameraDistance * 1.2, 2500, maxHalf);
      half.value = h;
      center.value.set(target.x, target.z);
      box.position.set(target.x, baseY + 700, target.z);
      box.scale.set(h, 1, h);
      sunBox.position.copy(box.position);
      sunBox.scale.copy(box.scale);
      fogSun.target.position.set(target.x, baseY, target.z);
      fogSun.position.copy(fogSun.target.position).addScaledVector(sun.dir, 9000);
      fogSun.angle = Math.atan((h * 1.6) / 9000);
      fogSun.color.copy(sun.color);
      fogSun.intensity = 3 * sun.up;
      uSunFog.value = 0.8 + 1.0 * sun.glow + 0.6 * sun.morning;
      fogSun.visible = sun.up > 0.02 && weatherShadingUniforms.uGFAmount.value > 0.01;
    },
    dispose: () => { noise.dispose(); maps.groundTex.dispose(); maps.sourceTex.dispose(); material.dispose(); sunMaterial.dispose(); box.geometry.dispose(); },
  };
}
