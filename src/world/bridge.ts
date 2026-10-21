import * as THREE from "three/webgpu";
import { projectLngLat } from "../geo/projection";
import { createHongqiaoBridge } from "../geo/hongqiao-bridge";
import type { ProjectData, Region } from "../core/region";

/** 虹桥：复用原版模型（桥面加宽到 12 m）；夜里发红光（返回需要随夜间系数调亮的材质） */
export function buildBridge({ data, hongqiao }: ProjectData, region: Region) {
  const toLocal = (p: [number, number]) => projectLngLat(data, p[0], p[1]);
  const group = createHongqiaoBridge(
    { ...hongqiao, meta: { ...hongqiao.meta, widthMeters: 12, nominalClearanceMeters: 9.6 } },
    (p) => { const [x, z] = toLocal(p); return new THREE.Vector3(x, 0, z); },
    (p) => { const [x, z] = toLocal(p); return region.terrain.heightAt(x, z); },
    (p) => { const [x, z] = toLocal(p); return region.inBox(x, z); },
  );
  const glowMaterials: THREE.MeshStandardMaterial[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat.color && ["c3372d", "e27669", "bc4c3c"].includes(mat.color.getHexString())) { mat.emissive = new THREE.Color("#ff3a2c"); glowMaterials.push(mat); }
  });
  return { group, glowMaterials };
}
