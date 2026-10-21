import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Region } from "../core/region";

/** 云：低多边形的云团，慢慢飘，在地面投下移动的影子；阴雨天逐朵长出更多的云 */
export function createClouds(region: Region) {
  const { full, cx, cz, HX, HZ, baseY } = region;
  const material = new THREE.MeshStandardNodeMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.18 });
  const group = new THREE.Group();
  group.name = "clouds";
  const clouds: THREE.Mesh[] = [];
  const BASE_CLOUDS = full ? 24 : 9;
  const spread = full ? 2.4 : 5;
  let seed = 42;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const scale = full ? 2.2 : 1;
  for (let n = 0; n < (full ? 70 : 26); n += 1) {
    const puffs: THREE.BufferGeometry[] = [];
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.IcosahedronGeometry((40 + rand() * 45) * scale, 1);
      puff.translate(((i - count / 2) * 58 + rand() * 20) * scale, rand() * 30 * scale, (rand() - 0.5) * 55 * scale);
      puffs.push(puff);
    }
    const cloud = new THREE.Mesh(mergeGeometries(puffs, false)!, material);
    cloud.position.set(cx + (rand() - 0.5) * HX * spread, baseY + (520 + rand() * 300) * (full ? 3 : 1) - (n >= BASE_CLOUDS ? 100 : 0), cz + (rand() - 0.5) * HZ * spread);
    cloud.userData = { speed: 8 + rand() * 8, size: n < BASE_CLOUDS ? 1 : 0.9 + rand() * 0.5 };
    cloud.castShadow = true;
    clouds.push(cloud);
    group.add(cloud);
  }
  /** cover：云量 0–1（天气） */
  const update = (delta: number, cover: number) => {
    const extra = clouds.length - BASE_CLOUDS;
    const span = HX * spread;
    clouds.forEach((cloud, i) => {
      cloud.position.x += cloud.userData.speed * delta;
      if (cloud.position.x > cx + span / 2) cloud.position.x -= span;
      const grow = i < BASE_CLOUDS ? 1 + 0.3 * cover : THREE.MathUtils.clamp(cover * extra - (i - BASE_CLOUDS), 0, 1);
      const sz = grow * cloud.userData.size;
      cloud.visible = sz > 0.01;
      cloud.scale.set(sz, 0.75 * sz, sz);
    });
  };
  return { group, material, update };
}
