import * as THREE from "three/webgpu";
import { abs, clamp, exp, float, Fn, pass, screenCoordinate, smoothstep, texture3D, time, uniform, vec3 } from "three/tsl";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import { bayer16 } from "three/examples/jsm/tsl/math/Bayer.js";
import { gaussianBlur } from "three/examples/jsm/tsl/display/GaussianBlurNode.js";
import { weatherShadingUniforms } from "./weatherShading";

/**
 * 体积雾（来自 WebGPU MVP）：一个盖住镜头焦点一带的雾体，沿视线步进采样 3D 噪声——
 * 雾有厚薄、会随风流动、沉在低处，边缘柔和淡出。替代原来"每个材质按高度混雾色"的平雾。
 *
 * 浓度、雾层厚度、雾色都读 weatherShadingUniforms（atmosphere 每帧按晨雾时间表和「雾」天气写入），
 * 所以晨雾、雾天、雨雪天的雾都由同一套时间表驱动。
 * 雾在 1/3 分辨率下计算再模糊，最后在后期里按浓度把画面混向雾色。
 */
const LAYER_FOG = 10;

export function createVolumeFog(scene: THREE.Scene, camera: THREE.Camera, sceneDepth: unknown, baseY: number) {
  const u = weatherShadingUniforms;
  const center = uniform(new THREE.Vector2());
  const half = uniform(3000);

  // 96³ 的 3D 噪声（两层 Perlin 叠加），循环平铺
  const noise = (() => {
    const size = 96, data = new Uint8Array(size * size * size), perlin = new ImprovedNoise();
    let i = 0;
    for (let z = 0; z < size; z += 1) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const v = perlin.noise((x / size) * 6, (y / size) * 6, (z / size) * 6) * 0.6 + perlin.noise((x / size) * 14, (y / size) * 14, (z / size) * 14) * 0.4;
      data[i++] = 128 + 127 * Math.max(-1, Math.min(1, v * 1.6));
    }
    const t = new THREE.Data3DTexture(data, size, size, size);
    t.format = THREE.RedFormat;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  })();

  const material = new THREE.VolumeNodeMaterial();
  material.steps = 24;
  material.offsetNode = bayer16(screenCoordinate);
  material.depthNode = sceneDepth as never;
  const density = (positionRay: unknown) => {
    const p = positionRay as ReturnType<typeof vec3>;
    const wind = vec3(time.mul(18.0), 0, time.mul(7.0));
    const n1 = texture3D(noise, p.add(wind).div(1400.0).mod(1.0), 0).r;
    const n2 = texture3D(noise, p.add(wind.mul(1.7)).div(520.0).mod(1.0), 0).r;
    // 原来的贴地雾参数换算到体积雾：雾层略厚一些（贴地雾 55 m 的晨雾 → 约 90 m），浓度放大到 MVP 的量级
    const heightFall = exp(p.y.sub(u.uGFBase).div(u.uGFHeight.mul(1.6).max(90)).negate());
    // 离雾体边缘 500 m 内逐渐变淡，雾不会被齐刷刷切断
    const edge = smoothstep(half, half.sub(500), abs(p.x.sub(center.x))).mul(smoothstep(half, half.sub(500), abs(p.z.sub(center.y))));
    return clamp(n1.mul(1.4).sub(0.35).mul(n2.mul(0.8).add(0.6)), 0, 1).mul(heightFall).mul(u.uGFAmount.mul(2.4)).mul(edge);
  };
  // 只记录"雾有多浓"（灰度），合成时统一上雾色，避免浓雾处发暗发脏
  (material as unknown as { scatteringEmissiveNode: unknown }).scatteringEmissiveNode = Fn(({ positionRay }: { positionRay: unknown }) => vec3(density(positionRay).mul(0.05)));
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 900, 2), material);
  box.position.y = baseY + 430;
  box.layers.disableAll();
  box.layers.enable(LAYER_FOG);
  box.frustumCulled = false;
  scene.add(box);
  // 体积材质的散射挂在光照计算里：雾的图层里要有一盏灯（只放这一盏，雾不会被额外照亮）
  const light = new THREE.AmbientLight("#ffffff", 0.0001);
  light.layers.disableAll();
  light.layers.enable(LAYER_FOG);
  scene.add(light);

  const layers = new THREE.Layers();
  layers.disableAll();
  layers.enable(LAYER_FOG);
  const fogPass = pass(scene, camera, { depthBuffer: false });
  fogPass.setLayers(layers);
  fogPass.setResolutionScale(0.35);
  const blurred = gaussianBlur(fogPass, uniform(0.8));
  /** 0–0.95：画面上这一点被雾遮住多少 */
  const veil = clamp(float(1).sub(exp(blurred.r.negate())), 0, 0.95);

  return {
    veil,
    color: u.uGFColor,
    /** 雾体跟着镜头焦点走：近看雾体小、步进细，远看盖得更大 */
    update: (target: THREE.Vector3, cameraDistance: number, maxHalf: number) => {
      const h = THREE.MathUtils.clamp(cameraDistance * 1.2, 2500, maxHalf);
      half.value = h;
      center.value.set(target.x, target.z);
      box.position.x = target.x;
      box.position.z = target.z;
      box.scale.set(h, 1, h);
    },
    dispose: () => { noise.dispose(); material.dispose(); box.geometry.dispose(); },
  };
}
