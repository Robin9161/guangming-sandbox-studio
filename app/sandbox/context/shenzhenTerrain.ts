import * as THREE from "three";
import { exaggerate as defaultExaggerate } from "../scene/palette";

/**
 * 深圳全市低多边形地形（开场用，数据：scripts/sandbox/build-shenzhen-terrain.mjs →
 * public/sandbox/shenzhen/terrain/）。风格与 app/sandbox/scene/watershed.ts 一致：
 * 每格一个顶点、flatShading、按海拔的马卡龙色阶、海面压平并统一海色、底下垫一块底座盒子。
 *
 * - 高程：原始海拔（SRTM 系），用 palette.exaggerate 与光明主地形同一高度尺度
 * - 海面：**只按 sea.bin 掩膜判定**（1 = 海 → 压平到 y = -2 并用海色）。不用 h ≤ 0.5 m 判定，
 *   否则沿岸城区（宝安/南山/福田/前海）那些 SRTM 接近 0 m 的陆地格子会变成蓝色斑点。
 *   掩膜为 0 的格子一律当陆地：height = exaggerate(max(0, h))，颜色用色阶里最低的陆地色。
 * - 挖空：terrain.json 的 hole（光明主地形所在矩形）内不生成三角形，边缘做一圈底座色裙边，
 *   看起来像"沙盘嵌在地图里"；真正的光明地形由接入方放在那里
 * - 不逐帧动画、不贴图；用 BufferGeometry + toNonIndexed + computeVertexNormals
 */
export type ShenzhenTerrainMeta = {
  /** 网格原点（本地坐标，米），行优先：k = j * nx + i */
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  spacing: number;
  /** dem.bin 的换算：米 = Int16 * scale */
  scale: number;
  /** 光明主地形所在矩形，这里不生成三角形 */
  hole?: { x0: number; z0: number; x1: number; z1: number };
  source?: string;
  generated?: string;
  [key: string]: unknown;
};

export type ShenzhenTerrainView = {
  group: THREE.Group;
  /** 0 时整个 group 隐藏；其余值同步到所有材质（含底座、裙边） */
  setOpacity: (t: number) => void;
  /** 地表高度（含高程夸张），与网格三角面一致 */
  heightAt: (x: number, z: number) => number;
  dispose: () => void;
  /** 画幅范围（本地坐标，米），供镜头取景 */
  frame: { x0: number; z0: number; x1: number; z1: number };
  /** 网格顶点数（未索引时的一个顶点对应一格） */
  vertices: number;
  triangles: number;
};

/** 没有 sea.bin 掩膜时的兜底阈值（米）：只有这时才用 h ≤ 0.5 m 判海（正式用法是传 opts.sea） */
const SEA_LEVEL = 0.5;
const SEA_Y = -2;
/** 底座顶面：比海面低一截，避免和海面（y = SEA_Y）共面产生 z-fighting 横条纹 */
const BASE_TOP = -20;
/** 底座与裙边颜色，取自 watershed.ts 的底座 */
const BASE_COLOR = "#e6dccb";
const BASE_HEIGHT = 120;

/** 与 watershed.ts 完全相同的按海拔色阶（米，未夸张） */
const RAMP: [number, THREE.Color][] = [
  [-1, new THREE.Color("#9cc6d6")], // 海
  [3, new THREE.Color("#e9dcc0")],
  [15, new THREE.Color("#e3dcb2")],
  [40, new THREE.Color("#cfd9a4")],
  [120, new THREE.Color("#a9c98f")],
  [300, new THREE.Color("#86b27c")],
  [600, new THREE.Color("#6f9a70")],
];

export function buildShenzhenTerrain(
  meta: ShenzhenTerrainMeta,
  buffer: ArrayBuffer,
  opts?: {
    exaggerate?: (h: number) => number;
    sea?: ArrayBuffer;
    /** 自定义挖空（按顶点判断）：沙盘无缝模式用"光明区界外扩一圈"代替矩形 hole，此时不生成矩形裙边 */
    holeTest?: (x: number, z: number) => boolean;
  },
): ShenzhenTerrainView {
  const { x0, z0, nx, nz, spacing, scale } = meta;
  const exagg = opts?.exaggerate ?? defaultExaggerate;
  const cells = nx * nz;
  if (!Number.isFinite(cells) || nx < 2 || nz < 2) throw new Error("buildShenzhenTerrain: 网格参数不合法");
  const available = Math.floor(buffer.byteLength / 2);
  if (available < cells) throw new Error(`buildShenzhenTerrain: dem.bin 太短（需要 ${cells} 个 Int16，只有 ${available} 个）`);
  const raw = new Int16Array(buffer, 0, cells);
  // 海面掩膜（sea.bin，Uint8，1 = 海）：唯一的海面判据
  let seaMask: Uint8Array | null = null;
  if (opts?.sea) {
    if (opts.sea.byteLength < cells) throw new Error(`buildShenzhenTerrain: sea.bin 太短（需要 ${cells} 字节，只有 ${opts.sea.byteLength} 字节）`);
    seaMask = new Uint8Array(opts.sea, 0, cells);
  }
  const elev = (i: number, j: number) => raw[Math.min(nz - 1, j) * nx + Math.min(nx - 1, i)] * scale;
  const isSeaCell = (i: number, j: number) => {
    const k = Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i));
    return seaMask ? seaMask[k] === 1 : raw[k] * scale <= SEA_LEVEL;
  };
  /** 地表高度：海面格压平到 SEA_Y，陆地格用 exaggerate(max(0, h)) */
  const surfaceY = (i: number, j: number) => (isSeaCell(i, j) ? SEA_Y : exagg(Math.max(0, elev(i, j))));
  const elevAt = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(nx - 1.001, (x - x0) / spacing));
    const fj = Math.max(0, Math.min(nz - 1.001, (z - z0) / spacing));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const tx = fi - i;
    const tz = fj - j;
    return elev(i, j) * (1 - tx) * (1 - tz) + elev(i + 1, j) * tx * (1 - tz) + elev(i, j + 1) * (1 - tx) * tz + elev(i + 1, j + 1) * tx * tz;
  };
  const heightAt = (x: number, z: number) => {
    if (isSeaCell(Math.round((x - x0) / spacing), Math.round((z - z0) / spacing))) return SEA_Y;
    return exagg(Math.max(0, elevAt(x, z)));
  };

  const group = new THREE.Group();
  group.name = "shenzhen-terrain";

  // ---- 挖空：只要一个角落在 hole 里，这个格子就不生成（洞比 hole 略大，保证不压到光明主地形）----
  const holeTest = opts?.holeTest;
  const hole = holeTest ? undefined : meta.hole;
  const holeIndex = hole
    ? {
        i0: Math.max(0, Math.ceil((hole.x0 - x0) / spacing)),
        i1: Math.min(nx - 1, Math.floor((hole.x1 - x0) / spacing)),
        j0: Math.max(0, Math.ceil((hole.z0 - z0) / spacing)),
        j1: Math.min(nz - 1, Math.floor((hole.z1 - z0) / spacing)),
      }
    : null;
  const omitted = holeIndex
    ? (i: number, j: number) => i >= holeIndex.i0 && i < holeIndex.i1 && j >= holeIndex.j0 && j < holeIndex.j1
    : () => false;
  const vertexInHole = hole
    ? (i: number, j: number) => {
        const x = x0 + i * spacing;
        const z = z0 + j * spacing;
        return x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1;
      }
    : () => false;
  // 自定义挖空：四个角都在洞里才不生成（与光明主地形略有重叠，避免露缝）
  const customHole = holeTest ? (i: number, j: number) => holeTest(x0 + i * spacing, z0 + j * spacing) : null;
  const quadOmitted = customHole
    ? (i: number, j: number) => customHole(i, j) && customHole(i + 1, j) && customHole(i, j + 1) && customHole(i + 1, j + 1)
    : (i: number, j: number) =>
        omitted(i, j) || vertexInHole(i, j) || vertexInHole(i + 1, j) || vertexInHole(i, j + 1) || vertexInHole(i + 1, j + 1);

  // ---- 地形：每格一个顶点，按海拔分色 ----
  const positions = new Float32Array(cells * 3);
  const colors = new Float32Array(cells * 3);
  const color = new THREE.Color();
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      const h = elev(i, j);
      const sea = isSeaCell(i, j);
      positions[k * 3] = x0 + i * spacing;
      positions[k * 3 + 1] = sea ? SEA_Y : exagg(Math.max(0, h));
      positions[k * 3 + 2] = z0 + j * spacing;
      if (sea) {
        color.copy(RAMP[0][1]);
      } else {
        let idx = RAMP.findIndex(([top]) => h < top);
        if (idx < 0) idx = RAMP.length - 1;
        if (idx <= 1) {
          color.copy(RAMP[1][1]); // 陆地最低色：沿岸 0–3 m 的低地也用这个，不掺海色
        } else {
          const [hi, ch] = RAMP[idx];
          const [lo, cl] = RAMP[idx - 1];
          color.copy(cl).lerp(ch, Math.max(0, Math.min(1, (h - lo) / Math.max(1, hi - lo))));
        }
      }
      colors[k * 3] = color.r;
      colors[k * 3 + 1] = color.g;
      colors[k * 3 + 2] = color.b;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < nz - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      if (quadOmitted(i, j)) continue;
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  indexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  geometry.computeVertexNormals();
  indexed.dispose();
  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  terrain.name = "shenzhen-terrain-surface";
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- 裙边：挖空边缘从地表垂到海面高度，配底座盒子，像沙盘嵌在地图里 ----
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  const vert = (i: number, j: number, y: number) => [x0 + i * spacing, y, z0 + j * spacing] as const;
  const pushWall = (i1: number, j1: number, i2: number, j2: number) => {
    const y1 = surfaceY(i1, j1);
    const y2 = surfaceY(i2, j2);
    const base = wallPositions.length / 3;
    const a = vert(i1, j1, y1);
    const b = vert(i2, j2, y2);
    wallPositions.push(a[0], a[1], a[2], b[0], b[1], b[2], b[0], BASE_TOP, b[2], a[0], BASE_TOP, a[2]);
    wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  if (holeIndex) {
    for (let j = 0; j < nz - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        if (quadOmitted(i, j)) continue;
        if (quadOmitted(i - 1, j) && i > 0) pushWall(i, j, i, j + 1);
        if (quadOmitted(i + 1, j) && i + 1 < nx - 1) pushWall(i + 1, j + 1, i + 1, j);
        if (quadOmitted(i, j - 1) && j > 0) pushWall(i + 1, j, i, j);
        if (quadOmitted(i, j + 1) && j + 1 < nz - 1) pushWall(i, j + 1, i + 1, j + 1);
      }
    }
  }
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: BASE_COLOR,
    roughness: 1,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  if (wallPositions.length) {
    const wallGeometry = new THREE.BufferGeometry();
    wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions, 3));
    wallGeometry.setIndex(wallIndices);
    wallGeometry.computeVertexNormals();
    const skirt = new THREE.Mesh(wallGeometry, wallMaterial);
    skirt.name = "shenzhen-terrain-skirt";
    group.add(skirt);
  } else {
    wallMaterial.dispose();
  }

  // ---- 底座盒子（与 watershed.ts 同色、同厚度）----
  const width = (nx - 1) * spacing;
  const depth = (nz - 1) * spacing;
  const baseMaterial = new THREE.MeshStandardMaterial({ color: BASE_COLOR, roughness: 1, transparent: true, opacity: 1, depthWrite: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, BASE_HEIGHT, depth), baseMaterial);
  base.name = "shenzhen-terrain-base";
  base.position.set(x0 + width / 2, BASE_TOP - BASE_HEIGHT / 2, z0 + depth / 2);
  group.add(base);

  const materials: THREE.Material[] = [terrainMaterial, wallMaterial, baseMaterial];
  let triangles = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });

  return {
    group,
    frame: { x0, z0, x1: x0 + width, z1: z0 + depth },
    vertices: cells,
    triangles,
    heightAt,
    setOpacity(t: number) {
      const opacity = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
      group.visible = opacity > 0;
      for (const material of materials) {
        material.opacity = opacity;
        material.depthWrite = opacity >= 0.999;
        // 不透明时按不透明物体渲染：常驻场景时排序和深度都更稳
        const transparent = opacity < 0.999;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      }
    },
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
