import * as THREE from "three/webgpu";
import { attribute } from "three/tsl";
import { Raster } from "../geo/terrain";
import { trees as treeStyle } from "../style/palette";
import { pairs } from "../geo/types";
import type { Region } from "../core/region";
import type { WithSnow } from "../look/uniforms";

/** 树：绿地按网格种（避开建筑和水面）。全区和原版一样的密度和上限（网格 52 m、最多约 2.25 万棵） */
export function buildTreeLayer(region: Region, footprint: Raster, withSnow: WithSnow) {
  const { full, terrain, local, cx, cz, HX, HZ } = region;
  const waterRaster = new Raster(1024, terrain.bounds);
  waterRaster.fill(local.water.areas.map((a) => pairs(a.p)));
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const spots: [number, number, number][] = [];
  const grid = full ? 52 : 24;
  for (let z = cz - HZ + 10; z < cz + HZ - 10; z += grid) for (let x = cx - HX + 10; x < cx + HX - 10; x += grid) {
    if (spots.length > (full ? 22500 : 150000)) break;
    const px = x + (rand() - 0.5) * grid * 0.85, pz = z + (rand() - 0.5) * grid * 0.85;
    if (full && !terrain.inside(px, pz) && rand() < 0.6) continue; // 区界外的树稀疏一些
    if (rand() < (full ? 0.62 : 0.68) && terrain.isGreen(px, pz) && !footprint.test(px, pz) && !waterRaster.test(px, pz)) spots.push([px, pz, 0.8 + rand() * 0.6]);
  }
  const crownGeo = new THREE.IcosahedronGeometry(11, 0);
  crownGeo.scale(1, 1.15, 1);
  crownGeo.translate(0, 19, 0);
  const trunkGeo = new THREE.CylinderGeometry(1.6, 2.2, 10, 5);
  trunkGeo.translate(0, 5, 0);
  // 树冠颜色放在每棵树的属性里（不用 instanceColor：它会在最后再乘一次，积雪就会被染绿）
  const crownColors = new Float32Array(spots.length * 3);
  crownGeo.setAttribute("aCrown", new THREE.InstancedBufferAttribute(crownColors, 3));
  const crownMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, flatShading: true });
  crownMaterial.colorNode = withSnow(attribute("aCrown", "vec3"));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMaterial, spots.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardNodeMaterial({ color: treeStyle.trunk, roughness: 0.9 }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  spots.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, terrain.heightAt(x, z) - 1, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
    crowns.setMatrixAt(i, m4);
    trunks.setMatrixAt(i, m4);
    c.set(treeStyle.crowns[Math.floor(rand() * treeStyle.crowns.length)]);
    crownColors.set([c.r, c.g, c.b], i * 3);
  });
  crowns.castShadow = trunks.castShadow = true;
  crowns.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "trees";
  group.add(crowns, trunks);
  return group;
}
