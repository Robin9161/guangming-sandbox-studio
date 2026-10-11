import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { context, motherRiver, roadClass, roadStyle, trees as treeStyle } from "./palette";
import { Raster, type Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

const MAX_GREEN_TREES = 16000;
const MAX_STREET_TREES = 6500;

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

/** 低多边形树：二十面体树冠 + 六棱柱树干，InstancedMesh 撒在绿地、山体和道路两侧 */
export function buildTrees(data: SandboxData, terrain: Terrain, footprint: Raster, landmarkCover: Raster | null, corridors: { lines: [number, number][][]; width: number }[] = []) {
  const random = rng(7);
  const waterRaster = new Raster(2048, terrain.bounds);
  waterRaster.fill(data.water.areas.map((area) => pairs(area.p)));
  // 地铁走廊：轨道两侧各约 20m 不种树（高架常在道路中央，路边树会落到桥面上）
  const corridorRaster = new Raster(4096, terrain.bounds);
  for (const corridor of corridors) corridorRaster.strokeLines(corridor.lines, corridor.width);
  const blocked = (x: number, z: number) => !terrain.inModel(x, z) || footprint.test(x, z) || !!landmarkCover?.test(x, z) || waterRaster.test(x, z) || corridorRaster.test(x, z);

  const spots: { x: number; z: number; s: number; fade: number }[] = [];
  const { minX, maxX, minZ, maxZ } = terrain.extent;
  const grid = 52;
  for (let z = minZ; z < maxZ && spots.length < MAX_GREEN_TREES; z += grid) {
    for (let x = minX; x < maxX && spots.length < MAX_GREEN_TREES; x += grid) {
      const px = x + (random() - 0.5) * grid * 0.9;
      const pz = z + (random() - 0.5) * grid * 0.9;
      const fade = terrain.fadeAt(px, pz);
      // 区界外的树逐渐稀疏，与褪色的周边环境一致
      if (random() > 0.62 * (1 - fade) || blocked(px, pz) || !terrain.isGreen(px, pz)) continue;
      spots.push({ x: px, z: pz, s: 0.8 + random() * 0.6, fade });
    }
  }
  let street = 0;
  const streetOrder = ["avenue", "primary", "secondary", "tertiary"];
  const streetRoads = [...data.roads].sort((a, b) => streetOrder.indexOf(roadClass(a.c, a.n)) - streetOrder.indexOf(roadClass(b.c, b.n)));
  for (const road of streetRoads) {
    const cls = roadClass(road.c, road.n);
    if (!["avenue", "primary", "secondary", "tertiary"].includes(cls) || street >= MAX_STREET_TREES) continue;
    const points = pairs(road.p);
    const offset = roadStyle[cls].width / 2 + 9;
    // 林荫大道：中央分隔带也种一排树（offset 0）
    const sides = cls === "avenue" ? [-1, 0, 1] : [-1, 1];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let d = 30; d < len; d += 75) {
        const t = d / len;
        for (const side of sides) {
          const x = ax + (bx - ax) * t + nx * offset * side;
          const z = az + (bz - az) * t + nz * offset * side;
          if (blocked(x, z)) continue;
          spots.push({ x, z, s: 0.6 + random() * 0.25, fade: 0 });
          street += 1;
        }
      }
    }
  }

  // 茅洲河两岸碧道：沿河各一排树
  for (const line of data.water.lines) {
    if (line.n !== motherRiver.name) continue;
    const points = pairs(line.p);
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (let d = 15; d < len; d += 34) {
        for (const side of [-1, 1]) {
          const x = ax + ((bx - ax) * d) / len + nx * motherRiver.bankTreeOffset * side;
          const z = az + ((bz - az) * d) / len + nz * motherRiver.bankTreeOffset * side;
          if (blocked(x, z)) continue;
          spots.push({ x, z, s: 0.75 + random() * 0.3, fade: 0 });
        }
      }
    }
  }

  const crownGeometry = new THREE.IcosahedronGeometry(11, 0);
  const position = crownGeometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) position.setY(i, position.getY(i) * 1.15);
  crownGeometry.translate(0, 19, 0);
  crownGeometry.computeVertexNormals();
  const trunkGeometry = new THREE.CylinderGeometry(1.6, 2.2, 10, 5);
  trunkGeometry.translate(0, 5, 0);

  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), spots.length);
  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: treeStyle.trunk, roughness: 0.9, flatShading: true }), spots.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const fadeColor = new THREE.Color(context.fadeColor);
  spots.forEach((spot, i) => {
    quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
    const scale = new THREE.Vector3(spot.s, spot.s * (0.9 + random() * 0.3), spot.s);
    matrix.compose(new THREE.Vector3(spot.x, terrain.heightAt(spot.x, spot.z) - 1, spot.z), quaternion, scale);
    crowns.setMatrixAt(i, matrix);
    trunks.setMatrixAt(i, matrix);
    color.set(treeStyle.crowns[Math.floor(random() * treeStyle.crowns.length)]).offsetHSL(0, 0, (random() - 0.5) * 0.05).lerp(fadeColor, spot.fade);
    crowns.setColorAt(i, color);
  });
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  trunks.castShadow = true;
  const group = new THREE.Group();
  group.name = "trees";
  group.add(crowns, trunks);
  return { group, count: spots.length };
}

/** 低多边形云：几个二十面体拼成一朵，缓慢漂移 */
export function buildClouds(terrain: Terrain) {
  const random = rng(42);
  const group = new THREE.Group();
  group.name = "clouds";
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#ffffff", emissiveIntensity: 0.18 });
  const { minX, maxX, minZ, maxZ } = terrain.bounds;
  // 前 10 朵常驻；其余是阴雨天的云，按云量从小长到正常大小
  const BASE_CLOUDS = 10;
  for (let n = 0; n < 30; n += 1) {
    const puffs: THREE.BufferGeometry[] = [];
    const count = 3 + Math.floor(random() * 4);
    for (let i = 0; i < count; i += 1) {
      const puff = new THREE.IcosahedronGeometry(180 + random() * 160, 1);
      puff.translate((i - count / 2) * 230 + random() * 80, random() * 120, (random() - 0.5) * 220);
      puffs.push(puff);
    }
    const cloud = new THREE.Mesh(mergeGeometries(puffs, false)!, material);
    cloud.scale.y = 0.75;
    cloud.position.set(minX + random() * (maxX - minX), 2600 + random() * 1400, minZ + random() * (maxZ - minZ));
    cloud.userData.speed = 25 + random() * 35;
    cloud.userData.size = n < BASE_CLOUDS ? 1 : 0.9 + random() * 0.5;
    if (n >= BASE_CLOUDS) { cloud.position.y -= 500; cloud.visible = false; }
    group.add(cloud);
  }
  const span = maxX - minX;
  const update = (delta: number) => {
    for (const cloud of group.children) {
      cloud.position.x += (cloud.userData.speed as number) * delta;
      if (cloud.position.x > maxX + 2500) cloud.position.x -= span + 5000;
    }
  };
  /** 云量 0–1（天气）：多出来的云逐朵长出来，常驻的云也变大一些 */
  const setCover = (cover: number) => {
    const extra = group.children.length - BASE_CLOUDS;
    group.children.forEach((cloud, i) => {
      const grow = i < BASE_CLOUDS ? 1 + 0.3 * cover : THREE.MathUtils.clamp(cover * extra - (i - BASE_CLOUDS), 0, 1);
      const s = grow * (cloud.userData.size as number);
      cloud.visible = s > 0.01;
      cloud.scale.set(s, 0.75 * s, s);
    });
  };
  return { group, update, setCover };
}
