import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { exaggerate } from "./palette";
import { pairs, type SandboxData } from "./types";

/**
 * 茅洲河流域视图（数据：scripts/sandbox/build-watershed.mjs → public/sandbox/watershed/）。
 * 一块独立的低多边形地形，范围从羊台山到沙井入海口；与光明版共用同一投影，可直接叠放。
 * - 地形：原始海拔（SRTM 2000），所以公明水库处是原来的山谷，石岩水库已是水面
 * - 河网：按地形汇流推算，越往下游越粗；流域内深蓝，流域外浅蓝
 * - 线：茅洲河流域边界（白）、光明区界（珊瑚色）
 */
export type WatershedData = {
  meta: { dem: { x0: number; z0: number; nx: number; nz: number; spacing: number; scale: number }; basinKm2: number; caveats: string[] };
  boundary: number[];
  streams: { basin: boolean; p: number[]; a: number[]; d?: number[]; u?: number[] }[];
  reservoirs?: { id: string; name: string; built: number; filled?: number; ring: number[]; dam: [number, number]; floor: number; level: number; cutKm2: number; preDamTerrain: boolean }[];
  places: { id: string; name: string; x: number; z: number; h: number }[];
};

const STEP = 2; // 每 2 格（120 m）一个顶点，约 10 万顶点

export function buildWatershedView(ws: WatershedData, demBuffer: ArrayBuffer, sandbox: SandboxData) {
  const group = new THREE.Group();
  group.name = "watershed-view";
  group.visible = false;
  const { x0, z0, nx, nz, spacing, scale } = ws.meta.dem;
  const raw = new Int16Array(demBuffer);
  const elev = (i: number, j: number) => raw[Math.min(nz - 1, j) * nx + Math.min(nx - 1, i)] * scale;
  const elevAt = (x: number, z: number) => {
    const fi = Math.max(0, Math.min(nx - 1.001, (x - x0) / spacing));
    const fj = Math.max(0, Math.min(nz - 1.001, (z - z0) / spacing));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const tx = fi - i;
    const tz = fj - j;
    return elev(i, j) * (1 - tx) * (1 - tz) + elev(i + 1, j) * tx * (1 - tz) + elev(i, j + 1) * (1 - tx) * tz + elev(i + 1, j + 1) * tx * tz;
  };
  const heightAt = (x: number, z: number) => exaggerate(Math.max(0, elevAt(x, z)));

  // ---- 流域范围（用于给流域外的地形降饱和）
  const basin = pairs(ws.boundary as unknown as number[]) as [number, number][];
  const inBasin = (x: number, z: number) => {
    let hit = false;
    for (let i = 0, j = basin.length - 1; i < basin.length; j = i, i += 1) {
      const [xi, zi] = basin[i];
      const [xj, zj] = basin[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };

  // ---- 地形：低多边形网格，按海拔分色（马卡龙色系）
  const cols = Math.floor((nx - 1) / STEP) + 1;
  const rows = Math.floor((nz - 1) / STEP) + 1;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const ramp: [number, THREE.Color][] = [
    [-1, new THREE.Color("#9cc6d6")], // 海
    [3, new THREE.Color("#e9dcc0")],
    [15, new THREE.Color("#e3dcb2")],
    [40, new THREE.Color("#cfd9a4")],
    [120, new THREE.Color("#a9c98f")],
    [300, new THREE.Color("#86b27c")],
    [600, new THREE.Color("#6f9a70")],
  ];
  const color = new THREE.Color();
  const grey = new THREE.Color("#e8e4da");
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = c * STEP;
      const j = r * STEP;
      const x = x0 + i * spacing;
      const z = z0 + j * spacing;
      const h = elev(i, j);
      const k = r * cols + c;
      positions.set([x, h <= 0.5 ? -2 : exaggerate(h), z], k * 3);
      let idx = ramp.findIndex(([top]) => h < top);
      if (idx < 0) idx = ramp.length - 1;
      const [hi, ch] = ramp[Math.max(0, idx)];
      const [lo, cl] = ramp[Math.max(0, idx - 1)];
      // 海面（≤0.5 m，形状已压平）统一用海的颜色，避免沙/海交替出现横条纹
      if (h <= 0.5) color.copy(ramp[0][1]);
      else color.copy(cl).lerp(ch, idx === 0 ? 1 : Math.max(0, Math.min(1, (h - lo) / Math.max(1, hi - lo))));
      if (h > 0.5 && !inBasin(x, z)) color.lerp(grey, 0.55); // 流域外：淡化
      colors.set([color.r, color.g, color.b], k * 3);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r += 1) for (let c = 0; c < cols - 1; c += 1) {
    const a = r * cols + c;
    const b = a + 1;
    const d = a + cols;
    const e = d + 1;
    indices.push(a, d, b, b, d, e);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const flatGeometry = geometry.toNonIndexed();
  flatGeometry.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(flatGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }));
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);
  // 底座
  const w = (cols - 1) * STEP * spacing;
  const d = (rows - 1) * STEP * spacing;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 120, d), new THREE.MeshStandardMaterial({ color: "#e6dccb", roughness: 1 }));
  base.position.set(x0 + w / 2, -62, z0 + d / 2);
  group.add(base);

  // ---- 贴地的带：河、边界
  const ribbon = (pts: [number, number][], widthAt: (k: number) => number, hex: string, lift: number, opacity = 1): THREE.Mesh | null => {
    if (pts.length < 2) return null;
    const dense: [number, number][] = [];
    const widths: number[] = [];
    for (let k = 0; k < pts.length - 1; k += 1) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 60));
      for (let s = 0; s < n; s += 1) { dense.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]); widths.push(widthAt(k) + ((widthAt(k + 1) - widthAt(k)) * s) / n); }
    }
    dense.push(pts[pts.length - 1]);
    widths.push(widthAt(pts.length - 1));
    const pos: number[] = [];
    const idx: number[] = [];
    dense.forEach(([x, z], k) => {
      const [px, pz] = dense[Math.max(0, k - 1)];
      const [qx, qz] = dense[Math.min(dense.length - 1, k + 1)];
      const len = Math.hypot(qx - px, qz - pz) || 1;
      const sx = -(qz - pz) / len;
      const sz = (qx - px) / len;
      const half = widths[k] / 2;
      const y = heightAt(x, z) + lift;
      pos.push(x + sx * half, y, z + sz * half, x - sx * half, y, z - sz * half);
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.baseOpacity = opacity;
    group.add(mesh);
    return mesh;
  };
  // 水库（用于判断哪些河段被淹进公明水库）
  const reservoirs = (ws.reservoirs ?? []).map((r) => ({ ...r, ringPts: pairs(r.ring) as [number, number][] }));
  const inRing = (x: number, z: number, ring: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const shiyanRes = reservoirs.find((r) => r.id === "shiyan");
  const gongmingRes = reservoirs.find((r) => r.id === "gongming");
  // 随时间变化的河段：before（建库前）/ after（建库后）两套网格交替淡入淡出
  const changing: { before: THREE.Mesh; after: THREE.Mesh | null; year: number }[] = [];
  const widthOf = (area: number) => Math.min(240, 18 + 11 * Math.sqrt(Math.max(0.2, area)));
  for (const stream of ws.streams) {
    const pts = pairs(stream.p) as [number, number][];
    const areaAt = (k: number) => stream.a[Math.min(k, stream.a.length - 1)] ?? 1;
    const hex = stream.basin ? "#3f8fc4" : "#9cc4dc";
    const opacity = stream.basin ? 1 : 0.8;
    const down = stream.d?.some((v) => v === 1);
    const up = stream.u?.some((v) => v === 1);
    const intoGongming = gongmingRes ? pts.some(([x, z]) => inRing(x, z, gongmingRes.ringPts)) : false;
    // 宽度随汇水面积增大：0.6 km² 约 25 m，茅洲河下游约 220 m（沙盘夸张）
    const before = ribbon(pts, (k) => widthOf(areaAt(k)), hex, 3, opacity);
    if (!before) continue;
    if (down && shiyanRes) {
      // 石岩坝下游：少了坝上游的汇水
      const after = ribbon(pts, (k) => widthOf(stream.d![Math.min(k, stream.d!.length - 1)] ? areaAt(k) - shiyanRes.cutKm2 : areaAt(k)), hex, 3.5, opacity);
      changing.push({ before, after, year: shiyanRes.built });
    } else if (up && shiyanRes) {
      changing.push({ before, after: null, year: shiyanRes.built }); // 被拦进石岩水库
    } else if (intoGongming && gongmingRes) {
      changing.push({ before, after: null, year: gongmingRes.filled ?? 2016 });
    }
  }
  ribbon([...basin, basin[0]], () => 70, "#ffffff", 6);
  const district = pairs(sandbox.boundary) as [number, number][];
  ribbon([...district, district[0]], () => 90, "#e8775a", 7);

  // ---- 水库水面与坝
  const waterMaterial = (radial: boolean) => {
    const m = new THREE.MeshStandardMaterial({ color: "#5aa6d0", roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 });
    const uniforms = { uDam: { value: new THREE.Vector2() }, uRadius: { value: 1e9 } };
    if (radial) {
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWXZ;").replace("#include <project_vertex>", "#include <project_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vWXZ;\nuniform vec2 uDam;\nuniform float uRadius;").replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (distance(vWXZ, uDam) > uRadius) discard;");
      };
    }
    return { m, uniforms };
  };
  const reservoirMeshes = reservoirs.map((r) => {
    const shape = new THREE.Shape(r.ringPts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const { m, uniforms } = waterMaterial(!r.preDamTerrain);
    uniforms.uDam.value.set(r.dam[0], r.dam[1]);
    const mesh = new THREE.Mesh(g, m);
    mesh.visible = false;
    group.add(mesh);
    const maxRadius = Math.max(...r.ringPts.map(([x, z]) => Math.hypot(x - r.dam[0], z - r.dam[1])));
    const dam = new THREE.Mesh(new THREE.BoxGeometry(520, 70, 90), new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.7 }));
    dam.position.set(r.dam[0], heightAt(r.dam[0], r.dam[1]) + 30, r.dam[1]);
    dam.visible = false;
    group.add(dam);
    return { r, mesh, uniforms, maxRadius, dam };
  });

  // ---- 时间线（秒）：1959 → 石岩建库蓄水 → 茅洲河变细 → 公明水库开工 → 蓄水 → 今天
  const T = { shiyanDam: 4, shiyanFill: [5, 10] as const, riverThin: [9, 12] as const, gongmingDam: 15, gongmingFill: [17, 25] as const, end: 28 };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const ease = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
  const captions: [number, string, string][] = [
    [0, "1960 年以前", "羊台山的水一路流下来，经石岩、光明，从沙井入海"],
    [T.shiyanDam, "1960 · 石岩水库", "上游筑坝，羊台山下来的水被拦进水库"],
    [T.riverThin[0], "1960 年以后", `坝上游约 ${Math.round(shiyanRes?.cutKm2 ?? 43)} km² 的来水被截走（约占流域的 ${Math.round(((shiyanRes?.cutKm2 ?? 43) / ws.meta.basinKm2) * 100)}%），茅洲河成了"无源之河"`],
    [T.gongmingDam, "2007 · 公明水库开工", "在横江、石头湖、迳口三座小水库的基础上扩建"],
    [T.gongmingFill[0], "2016 · 公明水库蓄水", "水从谷底涨到约 60 m，淹没了迳口背后的山谷"],
    [T.end - 2, "今天", "深圳的大水缸：存的是东江引来的水，不是茅洲河的水"],
  ];
  let time = 0;
  let playing = false;
  const seek = (t: number) => {
    time = Math.max(0, Math.min(T.end, t));
    for (const item of reservoirMeshes) {
      const { r } = item;
      if (r.id === "shiyan") {
        item.dam.visible = time >= T.shiyanDam;
        const u = ease((time - T.shiyanFill[0]) / (T.shiyanFill[1] - T.shiyanFill[0]));
        item.mesh.visible = u > 0;
        item.uniforms.uRadius.value = u * item.maxRadius * 1.05;
        item.mesh.position.y = exaggerate(r.level) + 4;
      } else {
        item.dam.visible = time >= T.gongmingDam;
        const u = ease((time - T.gongmingFill[0]) / (T.gongmingFill[1] - T.gongmingFill[0]));
        item.mesh.visible = u > 0;
        // 真实蓄水：水面从谷底涨到正常水位，被地形挡住的部分自然不显示
        item.mesh.position.y = exaggerate(r.floor + (r.level - r.floor) * u) + 1;
      }
    }
    for (const c of changing) {
      const start = c.year === shiyanRes?.built ? T.riverThin[0] : T.gongmingFill[0] + 3;
      const u = ease((time - start) / 3);
      (c.before.material as THREE.MeshStandardMaterial).opacity = (c.before.userData.baseOpacity as number) * (1 - u);
      c.before.visible = u < 1;
      if (c.after) { (c.after.material as THREE.MeshStandardMaterial).opacity = (c.after.userData.baseOpacity as number) * u; c.after.visible = u > 0; }
    }
  };
  seek(0);
  const caption = () => [...captions].reverse().find(([t]) => time >= t) ?? captions[0];
  // 镜头：讲石岩时推近石岩，变细时拉回全景看整条河，蓄水时推近公明水库，最后回到全景
  const near = (r: typeof reservoirs[number] | undefined, distance: number) => {
    if (!r) return null;
    const xs = r.ringPts.map((p) => p[0]);
    const zs = r.ringPts.map((p) => p[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, distance };
  };
  const shots: [number, string, { x: number; z: number; distance: number } | null][] = [
    [0, "overview", null],
    [T.shiyanDam - 0.5, "shiyan", near(shiyanRes, 16000)],
    [T.riverThin[0] + 0.5, "overview", null],
    [T.gongmingDam - 0.5, "gongming", near(gongmingRes, 14000)],
    [T.end - 2.5, "overview", null],
  ];
  const shot = () => [...shots].reverse().find(([t]) => time >= t) ?? shots[0];

  // ---- 地名
  const label = (text: string, x: number, z: number, lift: number, strong = false) => {
    const holder = document.createElement("div");
    const inner = document.createElement("div");
    inner.textContent = text;
    Object.assign(inner.style, { fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", sans-serif", fontSize: strong ? "14px" : "12px", fontWeight: "800", whiteSpace: "nowrap", padding: "4px 11px", borderRadius: "999px", color: strong ? "#fffaf1" : "#3d4a5c", background: strong ? "rgba(61,74,92,0.9)" : "rgba(255,250,241,0.95)", boxShadow: "0 3px 10px rgba(61,74,92,0.2)" });
    holder.appendChild(inner);
    const object = new CSS2DObject(holder);
    object.position.set(x, heightAt(x, z) + lift, z);
    group.add(object);
  };
  for (const p of ws.places) label(p.name, p.x, p.z, 260, p.id === "yangtai" || p.id === "outlet");
  label("光明区", 600, 0, 500, true);
  label(`茅洲河流域（地形推算约 ${Math.round(ws.meta.basinKm2)} km²）`, -9000, 1500, 300);

  // 镜头：北在上，整个流域入画
  const xs = basin.map((p) => p[0]);
  const zs = basin.map((p) => p[1]);
  const frame = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) };
  return {
    group, frame, heightAt,
    play: () => { time = 0; playing = true; seek(0); },
    /** 调试：直接跳到某一秒并暂停 */
    seek: (t: number) => { playing = false; seek(t); },
    /** 每帧调用；返回当前说明（年份、一句话） */
    update: (delta: number) => { if (playing) { seek(time + delta); if (time >= T.end) playing = false; } const [, year, text] = caption(); const [, shotKey, target] = shot(); return { year, text, shotKey, target }; },
    duration: T.end,
  };
}
