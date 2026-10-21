import * as THREE from "three/webgpu";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

/** 3D 噪声纹理（96³，可平铺）：体积雾的厚薄起伏、水面微波共用 */
export function createNoise3D() {
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
}
