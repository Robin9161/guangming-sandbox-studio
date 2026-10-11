import { projectLngLat } from "./landmarks";
import { pairs, type SandboxData } from "./types";

type Pt = [number, number];

/**
 * 生长计划：讲解里"城市怎么一点点长出来"的顺序，建筑、道路、高速、地铁共用。
 *
 * 1. 西岸老城：从公明老墟向外扩散，只长茅洲河西岸（东岸那时还是农场）。
 * 2. 光明大道：从南光高速一端往东延伸，建筑沿着大道两侧长起来，再向两边铺开。
 * 3. 高速、地铁都从"外面"往光明里长：龙大从龙华一端，南光从南山西丽一端，地铁从南端（深圳主城方向）。
 *
 * 建筑的两个延迟（秒）写进顶点属性 aGrow，着色器按两个时钟决定长到多高。
 */

/** 公明老墟（地标模块锚点） */
const GONGMING_OLD_MARKET: Pt = [113.881356, 22.787551];
export const WEST_SPEED = 650; // 米/秒
export const AVENUE_ALONG_SPEED = 900; // 沿大道推进（米/秒）
export const AVENUE_SIDE_SPEED = 650; // 向两侧铺开（米/秒）
/** 西岸之外的建筑：第一阶段永不生长 */
export const NOT_WEST = 1e7;

export type GrowthPlan = ReturnType<typeof buildGrowthPlan>;

export function buildGrowthPlan(data: SandboxData) {
  const toLocal = (lngLat: Pt): Pt => projectLngLat(data, lngLat[0], lngLat[1]);

  // ---- 茅洲河与西岸范围（与 V1 分析同一划分）
  const river = data.water.lines.filter((l) => l.n === "茅洲河").map((l) => pairs(l.p));
  const trunk = river.reduce((best, l) => (Math.abs(l[0][1] - l[l.length - 1][1]) > Math.abs(best[0][1] - best[best.length - 1][1]) ? l : best), river[0] ?? [[0, 0], [0, 1]]);
  const junction = trunk.reduce((a, b) => (b[1] < a[1] ? b : a));
  const southEnd = trunk.reduce((a, b) => (b[1] > a[1] ? b : a));
  const trunkSorted = [...trunk].sort((a, b) => a[1] - b[1]);
  const westBank: Pt[] = [[junction[0], -40000], junction, ...trunkSorted, [southEnd[0], 40000], [-40000, 40000], [-40000, -40000]];
  const inWest = (x: number, z: number) => insideRing(x, z, westBank);
  const gongmingOld = toLocal(GONGMING_OLD_MARKET);

  // ---- 光明大道中心线：从靠近南光的一端出发，按到起点的距离分桶取平均，得到一条平顺的折线
  const motorwayPoints = (re: RegExp) => data.roads.filter((r) => r.c === "motorway" && !r.l && r.n && re.test(r.n)).flatMap((r) => pairs(r.p));
  const nanguangPts = motorwayPoints(/南光/);
  const longdaPts = motorwayPoints(/龙大/);
  const avenueRaw = data.roads.filter((r) => r.n === "光明大道").flatMap((r) => pairs(r.p));
  const nearest = (p: Pt, set: Pt[]) => set.reduce((best, q) => Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity);
  const avenueStart = avenueRaw.length ? avenueRaw.reduce((a, b) => (nearest(b, nanguangPts) < nearest(a, nanguangPts) ? b : a)) : ([0, 0] as Pt);
  const avenue = centerline(avenueRaw, avenueStart, 300);
  const avenueCum = cumulative(avenue);
  const avenueLength = avenueCum[avenueCum.length - 1] ?? 0;
  /** 点到大道的投影：沿线里程 + 垂直距离 */
  const projectAvenue = (x: number, z: number) => {
    let best = Infinity;
    let along = 0;
    for (let i = 0; i < avenue.length - 1; i += 1) {
      const [ax, az] = avenue[i];
      const [bx, bz] = avenue[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) { best = d; along = avenueCum[i] + (avenueCum[i + 1] - avenueCum[i]) * t; }
    }
    return { along, side: best };
  };
  /** 第二阶段（光明大道）延迟，秒 */
  const avenueDelay = (x: number, z: number) => {
    if (avenue.length < 2) return 0;
    const { along, side } = projectAvenue(x, z);
    return along / AVENUE_ALONG_SPEED + side / AVENUE_SIDE_SPEED;
  };
  /** 建筑的两个延迟：[西岸老城, 光明大道]（秒）；第二个带一点随机，避免整齐划一 */
  const buildingDelays = (x: number, z: number, seed: number): [number, number] => {
    const jitter = (seed * 7.13) % 1 * 0.6;
    const west = inWest(x, z) ? Math.hypot(x - gongmingOld[0], z - gongmingOld[1]) / WEST_SPEED + jitter : NOT_WEST;
    return [west, avenueDelay(x, z) + jitter];
  };

  // ---- 高速：从"外面"进来的那一端（龙大：东南的龙华 / 观澜；南光：南端的南山西丽）
  const endOf = (pts: Pt[], score: (p: Pt) => number): Pt => (pts.length ? pts.reduce((a, b) => (score(b) > score(a) ? b : a)) : [0, 0]);
  const expresswayOrigins = {
    longda: endOf(longdaPts, ([x, z]) => x + z), // 最东南
    nanguang: endOf(nanguangPts, ([, z]) => z), // 最南
  };
  const expresswayEnds = {
    longda: endOf(longdaPts, ([, z]) => -z), // 最北：往东莞大岭山
    nanguang: endOf(nanguangPts, ([, z]) => -z), // 最北：往宝安松岗
  };
  /** 按到起点的距离排好序的中心线，用于在路上方排字 */
  const expresswayPaths = {
    longda: centerline(longdaPts, expresswayOrigins.longda, 300),
    nanguang: centerline(nanguangPts, expresswayOrigins.nanguang, 300),
  };

  // ---- 地铁：从南端（深圳主城方向）长进光明
  const metroStarts: Record<string, Pt> = {};
  for (const route of data.metroRoutes) {
    if (metroStarts[route.line]) continue;
    const pts = pairs(route.p);
    if (!pts.length) continue;
    const a = pts[0];
    const b = pts[pts.length - 1];
    metroStarts[route.line] = a[1] > b[1] ? a : b;
  }

  return {
    river, trunkSorted, westBank, inWest, gongmingOld,
    avenue, avenueLength, avenueDelay, buildingDelays,
    avenueSeconds: avenueLength / AVENUE_ALONG_SPEED,
    expresswayOrigins, expresswayEnds, expresswayPaths,
    metroStarts,
  };
}

export function insideRing(x: number, z: number, ring: Pt[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

export function cumulative(path: Pt[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i += 1) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return cum;
}

/** 一组散点（双向车道、零碎路段）→ 一条从 origin 出发的中心线：按到起点距离分桶取平均 */
export function centerline(points: Pt[], origin: Pt, bucket: number): Pt[] {
  if (!points.length) return [];
  const sums = new Map<number, [number, number, number]>();
  for (const [x, z] of points) {
    const k = Math.floor(Math.hypot(x - origin[0], z - origin[1]) / bucket);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += x; s[1] += z; s[2] += 1;
    sums.set(k, s);
  }
  const line: Pt[] = [origin];
  for (const k of [...sums.keys()].sort((a, b) => a - b)) {
    const [sx, sz, n] = sums.get(k)!;
    line.push([sx / n, sz / n]);
  }
  return line;
}

/** 沿折线按里程取点 */
export function pointAt(path: Pt[], cum: number[], distance: number): Pt {
  if (path.length === 1) return path[0];
  let i = 1;
  while (i < path.length - 1 && cum[i] < distance) i += 1;
  const t = Math.max(0, Math.min(1, (distance - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
  return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
}
