import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ShenzhenContextData } from "./shenzhenContext";

/**
 * 深圳全图的区界、海岸、地名，贴在全深圳地形（shenzhenTerrain.ts）上方。
 * 写法取自 terrain-preview/page.tsx（DeepSeek 交付，已验收），抽成模块给沙盘开场复用。
 * 光明区只画轮廓：区内由光明主地形负责。
 */
type XY = [number, number];
type Geometry = { type: string; coordinates: unknown } | null | undefined;
type Frame = { x0: number; z0: number; x1: number; z1: number };

const polygonRings = (g: Geometry): XY[][][] => (g?.type === "Polygon" ? [g.coordinates as XY[][]] : g?.type === "MultiPolygon" ? (g.coordinates as XY[][][]) : []);
const allRings = (g: Geometry): XY[][] => polygonRings(g).flat().filter((r) => r.length > 2);
const lines = (g: Geometry): XY[][] => (g?.type === "LineString" ? [g.coordinates as XY[]] : g?.type === "MultiLineString" ? (g.coordinates as XY[][]) : allRings(g));
const closed = (path: XY[]): XY[] => (path.length > 2 ? [...path, path[0]] : path);
/** 只用画幅内的部分：画幅外的点会被夹到边缘，线会飘在地形外面 */
const clipToFrame = (paths: XY[][], f: Frame): XY[][] => {
  const inside = ([x, z]: XY) => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
  const out: XY[][] = [];
  for (const path of paths) {
    let run: XY[] = [];
    for (const p of path) { if (inside(p)) run.push(p); else { if (run.length > 1) out.push(run); run = []; } }
    if (run.length > 1) out.push(run);
  }
  return out;
};

function ribbon(paths: XY[][], width: number, lift: number, color: string, heightAt: (x: number, z: number) => number, baseOpacity = 1) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const path of paths) {
    if (path.length < 2) continue;
    const dense: XY[] = [];
    for (let i = 1; i < path.length; i += 1) {
      const [ax, az] = path[i - 1];
      const [bx, bz] = path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 150));
      for (let s = 0; s < n; s += 1) dense.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    }
    dense.push(path[path.length - 1]);
    const base = positions.length / 3;
    dense.forEach(([x, z], k) => {
      const [px, pz] = dense[Math.max(0, k - 1)];
      const [qx, qz] = dense[Math.min(dense.length - 1, k + 1)];
      const len = Math.hypot(qx - px, qz - pz) || 1;
      const sx = (-(qz - pz) / len) * (width / 2);
      const sz = ((qx - px) / len) * (width / 2);
      const y = heightAt(x, z) + lift;
      positions.push(x + sx, y, z + sz, x - sx, y, z - sz);
      if (k > 0) { const a = base + (k - 1) * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: baseOpacity, depthWrite: baseOpacity >= 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 }));
  mesh.userData.baseOpacity = baseOpacity;
  return mesh;
}

export function buildShenzhenOverlay(data: ShenzhenContextData, heightAt: (x: number, z: number) => number, frame: Frame, focus = "光明区") {
  const group = new THREE.Group();
  group.name = "shenzhen-overlay";
  const districts = data.districts.filter((d) => d.name !== focus);
  const districtPaths = clipToFrame(districts.flatMap((d) => allRings((d.landGeometry ?? d.localGeometry) as Geometry).map(closed)), frame);
  if (districtPaths.length) group.add(ribbon(districtPaths, 300, 30, "#fffdf7", heightAt));
  group.add(ribbon(clipToFrame(lines(data.cityOutline.localGeometry as Geometry).map(closed), frame), 700, 30, "#f6f1e6", heightAt, 0.95));
  const gm = data.districts.find((d) => d.name === focus);
  if (gm) {
    const gmPaths = lines(gm.localGeometry as Geometry).map(closed);
    group.add(ribbon(gmPaths, 760, 30, "#f2a38a", heightAt));
    group.add(ribbon(gmPaths, 320, 34, "#ffffff", heightAt));
  }
  const coast = clipToFrame((data.water ?? []).filter((w) => w.kind === "coastline").flatMap((w) => lines(w.localGeometry as Geometry)), frame);
  if (coast.length) group.add(ribbon(coast, 260, 26, "#7fb6c9", heightAt, 0.9));

  // 地名：放进 group，跟着显隐
  const labels: HTMLElement[] = [];
  const label = (text: string, x: number, z: number, lift: number, strong = false) => {
    const holder = document.createElement("div");
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, { fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", sans-serif", fontSize: strong ? "15px" : "12px", fontWeight: strong ? "800" : "600", whiteSpace: "nowrap", padding: "3px 10px", borderRadius: "999px", color: strong ? "#fffaf1" : "#3d4a5c", background: strong ? "rgba(61,74,92,0.92)" : "rgba(255,250,241,0.92)", boxShadow: "0 2px 8px rgba(61,74,92,0.18)", pointerEvents: "none" });
    holder.appendChild(el);
    const object = new CSS2DObject(holder);
    object.position.set(x, heightAt(x, z) + lift, z);
    group.add(object);
    labels.push(el);
  };
  for (const d of data.districts) if (d.label) label(d.name, d.label.local[0], d.label.local[1], 520, d.name === focus);
  const offsets: Record<string, XY> = { 福田中心区: [5200, 3400], 福田站: [5000, 7200], 前海: [-6000, 2200], 南山后海: [-5000, 7200], 深圳湾口岸: [4800, 9800], 宝安机场: [-9000, -3000], 深圳北站: [900, 5200], 香港西九龙站: [3000, 10000], 松山湖: [6000, -9000] };
  for (const f of data.places) {
    const g = f.localGeometry as Geometry;
    if (g?.type !== "Point") continue;
    const [x, z] = g.coordinates as XY;
    const [dx, dz] = offsets[f.name] ?? [0, 900];
    label(f.name, x + dx, z + dz, 520);
  }

  const setOpacity = (t: number) => {
    const v = Math.max(0, Math.min(1, t));
    group.visible = v > 0;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { const m = mesh.material as THREE.MeshStandardMaterial; m.opacity = (mesh.userData.baseOpacity as number) * v; m.depthWrite = v >= 0.999; }
    });
    for (const el of labels) el.style.opacity = String(v);
  };
  return { group, setOpacity };
}
