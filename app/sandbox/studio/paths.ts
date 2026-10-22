import * as THREE from "three/webgpu";
import { pairs, type SandboxData } from "../scene/types";
import type { Terrain } from "../scene/terrain";

/**
 * 运镜路径：沿河、沿路、沿地铁飞行用的平滑中心线（取自 sandbox.json）。
 * 河和路在数据里是很多段（路还分上下行两条），这里沿主方向每 200 m 取一次平均，得到一条平滑的中心线；
 * 地铁用完整的线路走向。航拍镜头要的就是平滑的大走向，不需要贴着每个弯。
 */
export const PATHS = {
  maozhou: "茅洲河",
  guangmingAve: "光明大道",
  guangqiao: "光侨路",
  guanguang: "观光路",
  metro6: "6号线",
  metro6b: "6号线支线",
  metro13: "13号线",
} as const;
export type PathKey = keyof typeof PATHS;

type Pt = [number, number];

/** 沿主方向分段平均，得到中心线 */
function centerline(points: Pt[], bin = 200): Pt[] {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n, mz = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of points) { sxx += (x - mx) ** 2; sxz += (x - mx) * (z - mz); szz += (z - mz) ** 2; }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz); // 主方向
  const ax = Math.cos(angle), az = Math.sin(angle);
  const bins = new Map<number, { x: number; z: number; n: number }>();
  for (const [x, z] of points) {
    const k = Math.floor(((x - mx) * ax + (z - mz) * az) / bin);
    const b = bins.get(k) ?? { x: 0, z: 0, n: 0 };
    b.x += x; b.z += z; b.n += 1;
    bins.set(k, b);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => [b.x / b.n, b.z / b.n] as Pt);
}

/** 每隔 step 米重新取点（去掉原数据里疏密不均的点） */
function resample(points: Pt[], step: number): Pt[] {
  const out: Pt[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) { out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]); d += step; }
    carry = (carry + len) % step;
  }
  return out;
}

export function buildPaths(data: SandboxData, terrain: Terrain) {
  const { minX, maxX, minZ, maxZ } = terrain.extent;
  const inRange = (x: number, z: number) => x > minX + 400 && x < maxX - 400 && z > minZ + 400 && z < maxZ - 400;
  const cache = new Map<PathKey, THREE.CatmullRomCurve3 | null>();
  const densify = (flat: number[][]) => flat.flatMap((p) => resample(pairs(p), 40));
  const raw = (key: PathKey): Pt[] => {
    const name = PATHS[key];
    if (key === "maozhou") return centerline(densify(data.water.lines.filter((l) => l.n === name).map((l) => l.p)));
    if (key.startsWith("metro")) {
      const line = key === "metro6" ? "6" : key === "metro6b" ? "6b" : "13";
      const route = data.metroRoutes.find((r) => r.line === line);
      return route ? resample(pairs(route.p), 200) : [];
    }
    return centerline(densify(data.roads.filter((r) => r.n === name).map((r) => r.p)));
  };
  /** 路径曲线（高度贴地，镜头高度在运镜里另加）；数据里没有这条线时返回 null */
  const get = (key: PathKey) => {
    if (cache.has(key)) return cache.get(key)!;
    // 只取地形范围以内（留 400 m 边），镜头不会飞出沙盘；线路出去又进来时，取范围内最长的连续一段
    const runs: Pt[][] = [[]];
    for (const p of raw(key)) { if (inRange(p[0], p[1])) runs[runs.length - 1].push(p); else if (runs[runs.length - 1].length) runs.push([]); }
    const pts = runs.reduce((a, b) => (b.length > a.length ? b : a), [] as Pt[]);
    const curve = pts.length >= 2 ? new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, terrain.heightAt(x, z), z)), false, "centripetal") : null;
    cache.set(key, curve);
    return curve;
  };
  return { get };
}

export type Paths = ReturnType<typeof buildPaths>;
