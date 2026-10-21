import * as THREE from "three/webgpu";
import { abs, clamp, color, exp, Fn, screenCoordinate, smoothstep, texture3D, time, uniform, vec3 } from "three/tsl";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import type { Region } from "../core/region";

export const LAYER_FOG = 10;
export const LAYER_SUNFOG = 11;

/**
 * 体积雾：一个雾体沿视线步进采样 3D 噪声（流动、厚薄起伏、沉在低处）。两层：
 * - 第一层：雾有多浓（灰度），合成时统一上雾色（post/pipeline.ts），避免浓雾处发暗发脏
 * - 第二层：被太阳照亮的雾。Three.js 的体积材质不支持平行光，所以用一盏远处的聚光灯扮演太阳，只照雾、读阴影
 * 全区时雾体跟着镜头焦点走（一个雾体盖满全区步进精度不够），见 look/driver.ts
 */
export function createFog(scene: THREE.Scene, region: Region, noise3D: THREE.Data3DTexture, hemi: THREE.HemisphereLight) {
  const { full, cx, cz, baseY } = region;
  const U = {
    amount: uniform(0.6),
    height: uniform(140),
    color: uniform(color("#dfe6ee")),
    center: uniform(new THREE.Vector2(cx, cz)),
    half: uniform(full ? 3000 : 1600),
    /** 太阳照雾的强度 */
    sunFog: uniform(1.0),
  };
  const fogDensity = (positionRay: THREE.Node) => {
    const p = positionRay as unknown as ReturnType<typeof vec3>;
    const wind = vec3(time.mul(18.0), 0, time.mul(7.0));
    const n1 = texture3D(noise3D, p.add(wind).div(1400.0).mod(1.0), 0).r;
    const n2 = texture3D(noise3D, p.add(wind.mul(1.7)).div(520.0).mod(1.0), 0).r;
    const heightFall = exp(p.y.sub(baseY).div(U.height).negate());
    // 离雾体边缘 500 m 内逐渐变淡，雾不会被齐刷刷切断
    const edge = smoothstep(U.half, U.half.sub(500), abs(p.x.sub(U.center.x))).mul(smoothstep(U.half, U.half.sub(500), abs(p.z.sub(U.center.y))));
    return clamp(n1.mul(1.4).sub(0.35).mul(n2.mul(0.8).add(0.6)), 0, 1).mul(heightFall).mul(U.amount).mul(edge);
  };

  const fogMaterial = new THREE.VolumeNodeMaterial();
  fogMaterial.steps = 24;
  fogMaterial.offsetNode = bayer16(screenCoordinate);
  // scatteringEmissiveNode：雾自身的散射（运行时支持，类型定义里还没有）
  (fogMaterial as unknown as { scatteringEmissiveNode: unknown }).scatteringEmissiveNode = Fn(({ positionRay }: { positionRay: THREE.Node }) => vec3(fogDensity(positionRay).mul(0.05)));
  const fogBox = new THREE.Mesh(new THREE.BoxGeometry(2, 700, 2), fogMaterial);
  fogBox.scale.set(U.half.value, 1, U.half.value);
  fogBox.position.set(cx, baseY + 330, cz);
  fogBox.layers.disableAll();
  fogBox.layers.enable(LAYER_FOG);
  scene.add(fogBox);

  const sunFogMaterial = new THREE.VolumeNodeMaterial();
  sunFogMaterial.steps = 20;
  sunFogMaterial.offsetNode = bayer16(screenCoordinate);
  sunFogMaterial.scatteringNode = Fn(({ positionRay }: { positionRay: THREE.Node }) => fogDensity(positionRay).mul(U.sunFog).mul(0.12));
  const sunFogBox = new THREE.Mesh(fogBox.geometry, sunFogMaterial);
  sunFogBox.position.copy(fogBox.position);
  sunFogBox.scale.copy(fogBox.scale);
  sunFogBox.layers.disableAll();
  sunFogBox.layers.enable(LAYER_SUNFOG);
  scene.add(sunFogBox);
  const fogSun = new THREE.SpotLight("#ffe2b8", 3, 0, Math.atan((U.half.value * 1.6) / 8000), 0.25, 0);
  fogSun.castShadow = true;
  fogSun.shadow.mapSize.set(2048, 2048);
  fogSun.shadow.camera.near = 3000;
  fogSun.shadow.camera.far = 14000;
  fogSun.shadow.bias = -0.0005;
  fogSun.layers.disableAll();
  fogSun.layers.enable(LAYER_SUNFOG);
  // 阴影相机照常拍普通物体层（灯本身只在雾层）；否则阴影图会把雾体也画进去，和场景深度图冲突
  fogSun.shadow.camera.layers.set(0);
  fogSun.target.position.set(cx, baseY, cz);
  scene.add(fogSun, fogSun.target);
  // 雾的图层里必须有灯光，光照计算才会执行（雾的自发光散射挂在光照计算里）；半球光不算直射光，不会额外照亮雾
  hemi.layers.enable(LAYER_FOG);

  /** 全区：雾体、太阳照雾跟着镜头焦点（halfSize 随镜头距离变） */
  const follow = (target: THREE.Vector3, halfSize: number) => {
    U.half.value = halfSize;
    U.center.value.set(target.x, target.z);
    fogBox.position.set(target.x, baseY + 330, target.z);
    fogBox.scale.set(halfSize, 1, halfSize);
    sunFogBox.position.copy(fogBox.position);
    sunFogBox.scale.copy(fogBox.scale);
    fogSun.target.position.set(target.x, baseY, target.z);
    fogSun.angle = Math.atan((halfSize * 1.6) / 8000);
  };

  return { U, fogMaterial, sunFogMaterial, fogSun, follow };
}

export type Fog = ReturnType<typeof createFog>;
