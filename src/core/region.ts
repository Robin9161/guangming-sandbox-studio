import { buildTerrain, type Terrain } from "../geo/terrain";
import { projectLngLat } from "../geo/projection";
import { exaggerate } from "../style/palette";
import { pairs, type SandboxData } from "../geo/types";
import type { HongqiaoData } from "../geo/hongqiao-bridge";

export type ProjectData = { data: SandboxData; dem: Int16Array; hongqiao: HongqiaoData };

/** 读取沙盘数据：建筑、道路、水系等（sandbox.json）、高程（dem.bin）、虹桥 */
export async function loadData(): Promise<ProjectData> {
  const [data, demBuffer, hongqiao] = await Promise.all([
    fetch("./sandbox/sandbox.json").then((r) => r.json() as Promise<SandboxData>),
    fetch("./sandbox/dem.bin").then((r) => r.arrayBuffer()),
    fetch("./terrain/hongqiao-bridge.json").then((r) => r.json() as Promise<HongqiaoData>),
  ]);
  return { data, dem: new Int16Array(demBuffer), hongqiao };
}

/** 虹桥公园中心（经纬度）：切块模式的中心 */
const HONGQIAO_LNGLAT: [number, number] = [113.9552, 22.7486];

/**
 * 渲染范围：
 * - full = true：全区（地形的完整范围）
 * - full = false：虹桥公园一带约 3.2 km 见方的切块
 * 同时处理水位：鱼塘、湖压到岸边最低点以下，地形在水面范围内挖低，岸边是缓坡而不是竖墙。
 */
export function buildRegion({ data, dem }: ProjectData, full: boolean) {
  // 地形查询（高度、用地）；网格由 world/terrain.ts 按渲染范围生成
  const terrain: Terrain = buildTerrain(data, dem);
  const [hqx, hqz] = projectLngLat(data, HONGQIAO_LNGLAT[0], HONGQIAO_LNGLAT[1]);
  const ext = terrain.extent;
  const cx = full ? (ext.minX + ext.maxX) / 2 : hqx, cz = full ? (ext.minZ + ext.maxZ) / 2 : hqz;
  const HX = full ? (ext.maxX - ext.minX) / 2 : 1600, HZ = full ? (ext.maxZ - ext.minZ) / 2 : 1600;
  const HMAX = Math.max(HX, HZ);
  const inBox = (x: number, z: number, pad = 0) => Math.abs(x - cx) < HX + pad && Math.abs(z - cz) < HZ + pad;
  const anyIn = (flat: number[], pad = 0) => pairs(flat).some(([x, z]) => inBox(x, z, pad));
  const local: SandboxData = {
    ...data,
    buildings: data.buildings.filter((b) => { const ring = pairs(b.p); const x = ring.reduce((s, p) => s + p[0], 0) / ring.length, z = ring.reduce((s, p) => s + p[1], 0) / ring.length; return inBox(x, z, -20); }),
    roads: data.roads.filter((r) => anyIn(r.p, -10)),
    // 水面复制一份：下面会改水位，不影响原始数据
    water: { ...data.water, areas: data.water.areas.filter((a) => anyIn(a.p)).map((a) => ({ ...a })), lines: data.water.lines.filter((l) => anyIn(l.p)) },
  };
  const baseY = terrain.heightAt(cx, cz);

  // ---------- 水位 ----------
  // 数据里有的水面高程比周围地形高，原版会补一圈竖直的"堤岸"挡住，看起来很假
  const inPoly = (x: number, z: number, ring: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const levelForY = (y: number) => { let lo = -100, hi = 2000; for (let i = 0; i < 48; i += 1) { const mid = (lo + hi) / 2; if (exaggerate(mid) + 0.8 < y) lo = mid; else hi = mid; } return lo; };
  const carve: { ring: [number, number][]; y: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (const a of local.water.areas) {
    if (a.level === undefined) continue;
    const ring = pairs(a.p);
    let y = exaggerate(a.level) + 0.8;
    // 鱼塘、湖：压到岸边最低点以下；水库：压到岸边最低的 15% 以下，只有最低那一小段（坝体）保留竖面
    const shore = ring.map(([x, z]) => terrain.heightAt(x, z)).sort((p, q) => p - q);
    const bank = a.c === "reservoir" ? shore[Math.floor(shore.length * 0.15)] : shore[0];
    y = Math.min(y, bank - 0.4);
    a.level = levelForY(y);
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    carve.push({ ring, y, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
  /** 挖过水面之后的地面高度 */
  const groundAt = (x: number, z: number) => {
    let h = terrain.heightAt(x, z);
    for (const c of carve) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && inPoly(x, z, c.ring)) h = Math.min(h, c.y - 1.5);
    return h;
  };

  return { full, terrain, cx, cz, HX, HZ, HMAX, inBox, local, baseY, groundAt };
}

export type Region = ReturnType<typeof buildRegion>;
