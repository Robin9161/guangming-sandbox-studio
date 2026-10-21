import * as THREE from "three/webgpu";
import { float, mix, vertexColor } from "three/tsl";
import { buildRoads } from "../geo/features";
import type { Region } from "../core/region";
import type { LookUniforms, WithSnow } from "../look/uniforms";

/** 道路：原版的路网条带，换成节点材质：路面积雪少一些；雨后变暗、变光滑（反光） */
export function buildRoadLayer(region: Region, U: LookUniforms, withSnow: WithSnow) {
  const roads = buildRoads(region.local, region.terrain);
  roads.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
    const old = mesh.material as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: old.polygonOffsetFactor, polygonOffsetUnits: old.polygonOffsetUnits });
    m.colorNode = withSnow(vertexColor().xyz.mul(float(1).sub(U.wet.mul(0.3))), 0.5);
    m.roughnessNode = mix(float(0.9), float(0.3), U.wet);
    mesh.material = m;
  });
  return roads;
}
