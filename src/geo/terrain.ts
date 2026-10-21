import { context, exaggerate, ground, TERRAIN_SPACING } from "../style/palette";
import { pairs, type SandboxData } from "./types";

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * 地形查询（只算数，不建网格）：高度、原始高程、区界内外、绿地。
 * 网格由 world/terrain.ts 按渲染范围重新生成。
 */
export type Terrain = {
  /** 地表高度（已含高程夸张和模型边缘压低），按 60 m 网格三角插值 */
  heightAt: (x: number, z: number) => number;
  /** 原始高程（米，未夸张） */
  elevationAt: (x: number, z: number) => number;
  /** 是否在光明区界内 */
  inside: (x: number, z: number) => boolean;
  isGreen: (x: number, z: number) => boolean;
  /** 光明区范围（外扩 400m），用于建筑、树的栅格 */
  bounds: Box;
  /** 整个沙盘模型范围（DEM 网格内缩） */
  extent: Box;
  /** 到区界外的距离（区内为 0），米 */
  distanceOutside: (x: number, z: number) => number;
};

function pointInRing(x: number, z: number, ring: [number, number][]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

function distanceToRing(x: number, z: number, ring: [number, number][]) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 圆角矩形的有向距离（内部为负） */
function roundedRectSdf(x: number, z: number, box: Box, radius: number) {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const hx = (box.maxX - box.minX) / 2 - radius;
  const hz = (box.maxZ - box.minZ) / 2 - radius;
  const qx = Math.abs(x - cx) - hx;
  const qz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - radius;
}

/** 把多边形栅格化到 canvas，用于快速的点查询和着色器遮罩 */
export class Raster {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private data: Uint8ClampedArray | null = null;
  constructor(readonly size: number, readonly bounds: Box) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }
  private toPixel(x: number, z: number): [number, number] {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    return [((x - minX) / (maxX - minX)) * this.size, ((z - minZ) / (maxZ - minZ)) * this.size];
  }
  fill(rings: [number, number][][], color = "#fff", rule: CanvasFillRule = "evenodd") {
    this.context.fillStyle = color;
    this.context.beginPath();
    for (const ring of rings) {
      ring.forEach(([x, z], index) => {
        const [px, py] = this.toPixel(x, z);
        if (index === 0) this.context.moveTo(px, py);
        else this.context.lineTo(px, py);
      });
      this.context.closePath();
    }
    this.context.fill(rule);
    this.data = null;
  }
  /** 填充大量三角形（扁平数组 x0,z0,x1,z1,x2,z2,…）：分批成路径，避免单条超大路径填充极慢 */
  fillTriangles(flat: number[], batch = 2000) {
    this.context.fillStyle = "#fff";
    for (let start = 0; start < flat.length; start += batch * 6) {
      this.context.beginPath();
      const end = Math.min(flat.length, start + batch * 6);
      for (let i = start; i < end; i += 6) {
        const [ax, ay] = this.toPixel(flat[i], flat[i + 1]);
        const [bx, by] = this.toPixel(flat[i + 2], flat[i + 3]);
        const [cx, cy] = this.toPixel(flat[i + 4], flat[i + 5]);
        this.context.moveTo(ax, ay);
        this.context.lineTo(bx, by);
        this.context.lineTo(cx, cy);
        this.context.closePath();
      }
      this.context.fill("nonzero");
    }
    this.data = null;
  }
  /** 把折线按给定宽度（米）描到栅格上 */
  strokeLines(lines: [number, number][][], widthMeters: number) {
    const pxPerMeter = this.size / (this.bounds.maxX - this.bounds.minX);
    this.context.strokeStyle = "#fff";
    this.context.lineWidth = Math.max(1, widthMeters * pxPerMeter);
    this.context.lineCap = "round";
    this.context.lineJoin = "round";
    for (const line of lines) {
      this.context.beginPath();
      line.forEach(([x, z], index) => {
        const [px, py] = this.toPixel(x, z);
        if (index === 0) this.context.moveTo(px, py);
        else this.context.lineTo(px, py);
      });
      this.context.stroke();
    }
    this.data = null;
  }
  /** 用 2D 路径直接绘制（圆角矩形等） */
  draw(paint: (context: CanvasRenderingContext2D, toPixel: (x: number, z: number) => [number, number]) => void) {
    paint(this.context, (x, z) => this.toPixel(x, z));
    this.data = null;
  }
  test(x: number, z: number) {
    if (!this.data) this.data = this.context.getImageData(0, 0, this.size, this.size).data;
    const [px, py] = this.toPixel(x, z);
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= this.size || iy >= this.size) return false;
    return this.data[(iy * this.size + ix) * 4] > 127;
  }
}

export function buildTerrain(data: SandboxData, dem: Int16Array): Terrain {
  const { x0, z0, nx, nz, spacing, scale } = data.meta.dem;
  const boundary = pairs(data.boundary);

  const demAt = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(nx - 1.001, (x - x0) / spacing));
    const fj = Math.max(0, Math.min(nz - 1.001, (z - z0) / spacing));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const tx = fi - i;
    const tz = fj - j;
    const v = (a: number, b: number) => dem[(j + b) * nx + i + a] * scale;
    return v(0, 0) * (1 - tx) * (1 - tz) + v(1, 0) * tx * (1 - tz) + v(0, 1) * (1 - tx) * tz + v(1, 1) * tx * tz;
  };

  const xs = boundary.map((p) => p[0]);
  const zs = boundary.map((p) => p[1]);
  const pad = 400;
  const bounds = { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
  const inside = (x: number, z: number) => pointInRing(x, z, boundary);

  // ---------- 模型范围：DEM 网格内缩的圆角矩形 ----------
  const step = TERRAIN_SPACING;
  const gx = Math.floor(((nx - 1) * spacing) / step) + 1;
  const gz = Math.floor(((nz - 1) * spacing) / step) + 1;
  const extent = {
    minX: x0 + context.rimInset,
    maxX: x0 + (gx - 1) * step - context.rimInset,
    minZ: z0 + context.rimInset,
    maxZ: z0 + (gz - 1) * step - context.rimInset,
  };
  const cornerRadius = 1800;
  const rimSdf = (x: number, z: number) => roundedRectSdf(x, z, extent, cornerRadius);

  // 盆地底部高度：区内低洼处的典型高程，模型边缘压到这个高度
  const rimLevel = exaggerate(6);

  // ---------- 网格高度（含边缘压低） ----------
  const heights = new Float32Array(gx * gz);
  for (let j = 0; j < gz; j += 1) {
    for (let i = 0; i < gx; i += 1) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const raw = exaggerate(demAt(x, z));
      const taper = smoothstep(0, context.rimTaper, -rimSdf(x, z));
      heights[j * gx + i] = rimLevel + (raw - rimLevel) * taper;
    }
  }

  const heightAt = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(gx - 1.0001, (x - x0) / step));
    const fj = Math.max(0, Math.min(gz - 1.0001, (z - z0) / step));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const fx = fi - i;
    const fz = fj - j;
    const h00 = heights[j * gx + i];
    const h10 = heights[j * gx + i + 1];
    const h01 = heights[(j + 1) * gx + i];
    const h11 = heights[(j + 1) * gx + i + 1];
    // 按网格三角剖分插值：(a,b,d) 覆盖 fx+fz<=1，(b,c,d) 覆盖其余
    if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  };
  // ---------- 绿地（公园、林地、山坡） ----------
  const greenRaster = new Raster(1024, bounds);
  greenRaster.fill(data.parks.map((park) => pairs(park.p)));
  const greenLanduse = new Set(["forest", "wood", "scrub", "grass", "meadow", "park", "golf_course", "recreation_ground", "pitch"]);
  const landuseGreen = data.landuse.filter((item) => greenLanduse.has(item.c)).map((item) => pairs(item.p));
  if (landuseGreen.length) greenRaster.fill(landuseGreen);
  const slopeOf = (x: number, z: number) => Math.hypot(demAt(x + 30, z) - demAt(x - 30, z), demAt(x, z + 30) - demAt(x, z - 30)) / 60;
  const isGreen = (x: number, z: number) => {
    const elevation = demAt(x, z);
    if (greenRaster.test(x, z)) return true;
    if (elevation >= ground.hills[0].above) return true;
    return elevation > 30 && slopeOf(x, z) > 0.12;
  };

  const distanceOutside = (x: number, z: number) => (inside(x, z) ? 0 : distanceToRing(x, z, boundary));
  return { heightAt, elevationAt: demAt, inside, isGreen, bounds, extent, distanceOutside };
}
