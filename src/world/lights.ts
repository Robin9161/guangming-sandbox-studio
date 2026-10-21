import * as THREE from "three/webgpu";
import type { Region } from "../core/region";

/** 灯光：半球光（天光 + 地面反光）和太阳（带阴影；阴影范围在 look/driver.ts 里跟着镜头调整） */
export function createLights(scene: THREE.Scene, region: Region) {
  const hemi = new THREE.HemisphereLight("#cfe6fc", "#f2d8b0", 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff0d6", 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -2400, right: 2400, top: 2400, bottom: -2400, near: 100, far: 40000 });
  sun.shadow.bias = -0.0004;
  sun.target.position.set(region.cx, region.baseY, region.cz);
  scene.add(sun, sun.target);
  scene.fog = new THREE.Fog("#e0eff4", 6000, 20000);
  return { hemi, sun };
}
