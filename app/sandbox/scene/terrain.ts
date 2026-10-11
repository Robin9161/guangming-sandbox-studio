import * as THREE from "three";
import { basePlate, basePlateEdge, context, exaggerate, ground, TERRAIN_SPACING } from "./palette";
import { pairs, type SandboxData } from "./types";

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

export type Terrain = {
  group: THREE.Group;
  /** 与低多边形网格三角面完全一致的地表高度（已含高程夸张和边缘压低） */
  heightAt: (x: number, z: number) => number;
  /** 原始高程（米，未夸张） */
  elevationAt: (x: number, z: number) => number;
  /** 是否在光明区界内 */
  inside: (x: number, z: number) => boolean;
  /** 是否在沙盘模型范围内（含区界外的周边环境） */
  inModel: (x: number, z: number) => boolean;
  /** 区界外的褪色程度 0–1 */
  fadeAt: (x: number, z: number) => number;
  isGreen: (x: number, z: number) => boolean;
  /** 光明区范围（外扩 400m），用于相机、云、建筑栅格 */
  bounds: Box;
  /** 整个沙盘模型范围 */
  extent: Box;
  baseY: number;
  /**
   * 在地表上叠加一张"贴地"的示意图层（规划色块、控制线等）：在 2D 画布上绘制，着色器按地表坐标采样后混合，
   * 因此完全贴合低多边形地形。传 null 清除。
   */
  setOverlay: (paint: ((context: CanvasRenderingContext2D, toPixel: (x: number, z: number) => [number, number], metersToPixels: number) => void) | null) => void;
  /** 叠加图层的整体透明度（0–1），用于淡入淡出 */
  setOverlayOpacity: (opacity: number) => void;
  /** 到区界外的距离（区内为 0），米 */
  distanceOutside: (x: number, z: number) => number;
  /** 无缝模式：给其他图层的材质套上"区界外扩一圈"的遮罩（超出不画）；非无缝模式为空操作 */
  maskMaterial: (material: THREE.Material) => void;
  seamless: boolean;
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

function roundedRectShape(box: Box, radius: number) {
  // Shape 在 XY 平面，y 对应世界 z；之后 rotateX(+90°) 放平（y→-z 方向挤出向下）
  const shape = new THREE.Shape();
  const { minX, maxX, minZ, maxZ } = box;
  shape.moveTo(minX + radius, minZ);
  shape.lineTo(maxX - radius, minZ);
  shape.quadraticCurveTo(maxX, minZ, maxX, minZ + radius);
  shape.lineTo(maxX, maxZ - radius);
  shape.quadraticCurveTo(maxX, maxZ, maxX - radius, maxZ);
  shape.lineTo(minX + radius, maxZ);
  shape.quadraticCurveTo(minX, maxZ, minX, maxZ - radius);
  shape.lineTo(minX, minZ + radius);
  shape.quadraticCurveTo(minX, minZ, minX + radius, minZ);
  return shape;
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

/** 与全深圳地形（context/shenzhenTerrain.ts）相同的按海拔色阶：无缝模式下区界外渐变到它 */
const OUTER_RAMP: [number, string][] = [[3, "#e9dcc0"], [15, "#e3dcb2"], [40, "#cfd9a4"], [120, "#a9c98f"], [300, "#86b27c"], [600, "#6f9a70"]];
const outerColor = (h: number, out: THREE.Color) => {
  const idx = OUTER_RAMP.findIndex(([top]) => h < top);
  if (idx <= 0) return out.set(OUTER_RAMP[0][1]);
  const [hi, ch] = OUTER_RAMP[idx < 0 ? OUTER_RAMP.length - 1 : idx];
  const [lo, cl] = OUTER_RAMP[(idx < 0 ? OUTER_RAMP.length : idx) - 1];
  return out.set(cl).lerp(new THREE.Color(ch), Math.max(0, Math.min(1, (h - lo) / Math.max(1, hi - lo))));
};

/**
 * seamless：四周有全深圳地形时用——不压边缘、不要圆角底座，只铺到区界外 margin 米，
 * 区界外颜色渐变到全深圳地形的色阶，其他图层用 maskMaterial 裁到同一范围。
 */
export function buildTerrain(data: SandboxData, dem: Int16Array, opts: { seamless?: boolean; margin?: number } = {}): Terrain {
  const seamless = !!opts.seamless;
  const margin = opts.margin ?? 300;
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
  const inModel = (x: number, z: number) => (seamless ? inside(x, z) || distanceToRing(x, z, boundary) < margin - 40 : rimSdf(x, z) < -40);

  // 盆地底部高度：区内低洼处的典型高程，模型边缘压到这个高度
  const rimLevel = exaggerate(6);

  // ---------- 网格高度（含边缘压低）与区界外距离 ----------
  const heights = new Float32Array(gx * gz);
  const outside = new Float32Array(gx * gz);
  for (let j = 0; j < gz; j += 1) {
    for (let i = 0; i < gx; i += 1) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const raw = exaggerate(demAt(x, z));
      const taper = seamless ? 1 : smoothstep(0, context.rimTaper, -rimSdf(x, z));
      heights[j * gx + i] = rimLevel + (raw - rimLevel) * taper;
      outside[j * gx + i] = inside(x, z) ? 0 : distanceToRing(x, z, boundary);
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
    // 与下方三角剖分一致：(a,b,d) 覆盖 fx+fz<=1，(b,c,d) 覆盖其余
    if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  };
  const fadeFromDistance = (distance: number) => smoothstep(0, context.fadeDistance, distance) * context.maxFade;
  const fadeAt = (x: number, z: number) => (inside(x, z) ? 0 : fadeFromDistance(distanceToRing(x, z, boundary)));

  // ---------- 地面着色 ----------
  const greenRaster = new Raster(1024, bounds);
  greenRaster.fill(data.parks.map((park) => pairs(park.p)));
  const greenLanduse = new Set(["forest", "wood", "scrub", "grass", "meadow", "park", "golf_course", "recreation_ground", "pitch"]);
  const landuseGreen = data.landuse.filter((item) => greenLanduse.has(item.c)).map((item) => pairs(item.p));
  if (landuseGreen.length) greenRaster.fill(landuseGreen);
  const landuseRasters = Object.entries(ground.landuse).map(([kind, hex]) => {
    const raster = new Raster(1024, bounds);
    raster.fill(data.landuse.filter((item) => item.c === kind).map((item) => pairs(item.p)));
    return { raster, hex };
  });

  const slopeOf = (x: number, z: number) => Math.hypot(demAt(x + 30, z) - demAt(x - 30, z), demAt(x, z + 30) - demAt(x, z - 30)) / 60;
  const groundColor = (elevation: number, x: number, z: number) => {
    let color = ground.urban;
    for (const band of ground.hills) if (elevation >= band.above) color = band.color;
    if (color === ground.urban && elevation > 30 && slopeOf(x, z) > 0.12) color = ground.slopeGreen;
    if (color === ground.urban && greenRaster.test(x, z)) color = ground.park;
    if (color === ground.urban) for (const { raster, hex } of landuseRasters) if (raster.test(x, z)) { color = hex; break; }
    return color;
  };
  const isGreen = (x: number, z: number) => {
    const elevation = demAt(x, z);
    if (greenRaster.test(x, z)) return true;
    if (elevation >= ground.hills[0].above) return true;
    return elevation > 30 && slopeOf(x, z) > 0.12;
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const fade = new THREE.Color(context.fadeColor);
  const outer = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const pushTriangle = (ia: number, ja: number, ib: number, jb: number, ic: number, jc: number) => {
    a.set(x0 + ia * step, heights[ja * gx + ia], z0 + ja * step);
    b.set(x0 + ib * step, heights[jb * gx + ib], z0 + jb * step);
    c.set(x0 + ic * step, heights[jc * gx + ic], z0 + jc * step);
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    if (!seamless && rimSdf(cx, cz) > step) return;
    const distance = (outside[ja * gx + ia] + outside[jb * gx + ib] + outside[jc * gx + ic]) / 3;
    if (seamless && Math.min(outside[ja * gx + ia], outside[jb * gx + ib], outside[jc * gx + ic]) > margin + step) return;
    color.set(groundColor(demAt(cx, cz), cx, cz));
    color.offsetHSL(0, 0, (random() - 0.5) * 0.035);
    if (seamless) color.lerp(outerColor(demAt(cx, cz), outer), smoothstep(0, margin * 0.8, distance));
    else color.lerp(fade, fadeFromDistance(distance));
    for (const v of [a, b, c]) {
      positions.push(v.x, v.y, v.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let j = 0; j < gz - 1; j += 1) {
    for (let i = 0; i < gx - 1; i += 1) {
      pushTriangle(i, j, i, j + 1, i + 1, j);
      pushTriangle(i, j + 1, i + 1, j + 1, i + 1, j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  // 圆角矩形遮罩：片元超出模型边缘时丢弃
  const maskRaster = new Raster(2048, extent);
  maskRaster.draw((ctx, toPixel) => {
    const [ax, ay] = toPixel(extent.minX, extent.minZ);
    const [bx, by] = toPixel(extent.maxX, extent.maxZ);
    const r = (cornerRadius / (extent.maxX - extent.minX)) * 2048;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    if (seamless) {
      // 区界 + 外扩 margin：填充区界，再用 2×margin 宽的线描一圈
      boundary.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = ((2 * margin) / (extent.maxX - extent.minX)) * 2048;
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      ctx.roundRect(ax, ay, bx - ax, by - ay, r);
      ctx.fill();
    }
  });
  const maskTexture = new THREE.CanvasTexture(maskRaster.canvas);
  maskTexture.generateMipmaps = false;
  maskTexture.minFilter = THREE.LinearFilter;
  // 遮罩 UV 与遮罩画布用的是同一套映射（画布第 0 行 = minZ，和上面的 overlay 一致），
  // 所以必须关掉默认的 flipY；否则遮罩会在 z 方向镜像：光明（DEM extent 关于 z=0 对称）看不出来，
  // 南山只差一点，前海这种"长条 + 北窄南宽"的区就会把大部分建筑判定在区外而 discard 掉。
  maskTexture.flipY = false;
  // 贴地叠加图层：2048² 画布覆盖整个模型范围（约 11m/像素），默认透明
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = 2048;
  overlayCanvas.height = 2048;
  const overlayContext = overlayCanvas.getContext("2d")!;
  const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
  overlayTexture.colorSpace = THREE.SRGBColorSpace;
  overlayTexture.flipY = false; // 画布第 0 行对应 minZ（北），与 vMaskUv 的 z→v 映射一致；默认翻转会让叠加图南北颠倒
  const overlayOpacity = { value: 0 };
  const maskUniforms = {
    uOverlay: { value: overlayTexture },
    uOverlayOpacity: overlayOpacity,
    uMask: { value: maskTexture },
    uMaskScale: { value: new THREE.Vector2(1 / (extent.maxX - extent.minX), 1 / (extent.maxZ - extent.minZ)) },
    uMaskOffset: { value: new THREE.Vector2(extent.minX, extent.minZ) },
  };
  // 无缝模式：与全深圳地形在接缝处有一圈重叠，主地形在深度上让一点，避免闪烁
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, polygonOffset: seamless, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, maskUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uMaskScale;\nuniform vec2 uMaskOffset;\nvarying vec2 vMaskUv;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvMaskUv = ((modelMatrix * vec4(transformed, 1.0)).xz - uMaskOffset) * uMaskScale;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uMask;\nuniform sampler2D uOverlay;\nuniform float uOverlayOpacity;\nvarying vec2 vMaskUv;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (texture2D(uMask, vMaskUv).r < 0.5) discard;")
      .replace("#include <color_fragment>", "#include <color_fragment>\nvec4 overlay = texture2D(uOverlay, vMaskUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, overlay.rgb, overlay.a * uOverlayOpacity);");
  };
  const surface = new THREE.Mesh(geometry, material);
  surface.receiveShadow = true;
  surface.castShadow = true;
  surface.name = "terrain";

  // ---------- 底座：比地形略大的圆角台面，顶面与压低后的边缘齐平 ----------
  const lip = 90;
  const plateBox = { minX: extent.minX - lip, maxX: extent.maxX + lip, minZ: extent.minZ - lip, maxZ: extent.maxZ + lip };
  const plateDepth = 220;
  const plateGeometry = new THREE.ExtrudeGeometry(roundedRectShape(plateBox, cornerRadius + lip), { depth: plateDepth, bevelEnabled: true, bevelSize: 40, bevelThickness: 30, bevelSegments: 2, curveSegments: 10 });
  plateGeometry.rotateX(Math.PI / 2);
  const plate = new THREE.Mesh(plateGeometry, [
    new THREE.MeshStandardMaterial({ color: basePlate, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: basePlateEdge, roughness: 0.9, flatShading: true }),
  ]);
  // 旋转后几何体在 y∈[-depth, 0]（上方再加 bevel），顶面放在边缘高度略低处
  plate.position.y = rimLevel - 31;
  plate.receiveShadow = true;
  const baseY = rimLevel - 31 - plateDepth;

  const group = new THREE.Group();
  group.name = "terrain-group";
  group.add(surface);
  if (!seamless) group.add(plate);
  const overlayToPixel = (x: number, z: number): [number, number] => [
    ((x - extent.minX) / (extent.maxX - extent.minX)) * overlayCanvas.width,
    ((z - extent.minZ) / (extent.maxZ - extent.minZ)) * overlayCanvas.height,
  ];
  const setOverlay: Terrain["setOverlay"] = (paint) => {
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (paint) paint(overlayContext, overlayToPixel, overlayCanvas.width / (extent.maxX - extent.minX));
    overlayTexture.needsUpdate = true;
  };
  const setOverlayOpacity = (opacity: number) => { overlayOpacity.value = opacity; };

  // 其他图层套用同一张区界遮罩（只在无缝模式下）
  let maskCounter = 0;
  const maskMaterial = (target: THREE.Material) => {
    if (!seamless || (target as THREE.Material & { userData: Record<string, unknown> }).userData.districtMasked) return;
    target.userData.districtMasked = true;
    const previous = target.onBeforeCompile;
    const key = `district-mask-${(maskCounter += 1)}`;
    target.onBeforeCompile = (shader, renderer) => {
      previous.call(target, shader, renderer);
      shader.uniforms.uDMask = { value: maskTexture };
      shader.uniforms.uDMaskScale = maskUniforms.uMaskScale;
      shader.uniforms.uDMaskOffset = maskUniforms.uMaskOffset;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec2 uDMaskScale;\nuniform vec2 uDMaskOffset;\nvarying vec2 vDMaskUv;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvDMaskUv = ((modelMatrix * vec4(transformed, 1.0)).xz - uDMaskOffset) * uDMaskScale;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uDMask;\nvarying vec2 vDMaskUv;")
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (texture2D(uDMask, vDMaskUv).r < 0.5) discard;");
    };
    const previousKey = target.customProgramCacheKey.bind(target);
    target.customProgramCacheKey = () => `${previousKey()}|${key}`;
    target.needsUpdate = true;
  };
  const distanceOutside = (x: number, z: number) => (inside(x, z) ? 0 : distanceToRing(x, z, boundary));
  return { group, heightAt, elevationAt: demAt, inside, inModel, fadeAt, isGreen, bounds, extent, baseY, setOverlay, setOverlayOpacity, distanceOutside, maskMaterial, seamless };
}
