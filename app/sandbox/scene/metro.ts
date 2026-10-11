import * as THREE from "three";
import { glowColor, glowFromVertexColor } from "./atmosphere";
import { addReveal, RevealAnimation } from "./grow";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

type Pt = [number, number];

/**
 * 地铁：按方向的有序路由（sandbox.json 的 metroRoutes）。
 * 每条路由共享一条高度剖面：高架段在桥面高度，地下段贴着地面（半透明），模式切换处平滑成坡道。
 * 列车按"区间行驶 + 停站"的时刻表循环运行；在地下段变成半透明的"透视"列车。
 */

const DECK_HEIGHT = 20; // 高架轨面离地高度（米，沙盘比例略抬高）
const SPEED = 22; // 巡航速度 m/s（约 80km/h）
const DWELL = 14; // 停站秒数
const HEADWAY = 150; // 发车间隔秒数（沙盘里加密一些，近景更容易看到列车）
const TURNAROUND = 40;
// 沙盘比例：列车约放大 1.5 倍（真实车厢约 19m × 3m）
const CAR = { length: 30, width: 6.5, height: 6.4, gap: 1.6, count: 6 };
const TRACK_OFFSET = 3.5; // 每个方向的轨道向行车右侧外移，放大后的列车交会时不重叠

type Route = {
  line: string;
  points: Pt[];
  cum: number[]; // 累计里程
  ys: number[]; // 轨面高度
  modes: number[]; // 0 隧道 / 1 地面 / 2 高架
  nodes: { s: number; dwell: number }[];
  schedule: { t0: number; t1: number; s0: number; s1: number; easeIn: boolean; easeOut: boolean; dwellAfter: number }[];
  cycle: number;
  trains: number;
};

function smooth(values: number[], radius: number) {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k += 1) { sum += values[k]; count += 1; }
    out[i] = sum / count;
  }
  return out;
}

function prepareRoute(route: SandboxData["metroRoutes"][number], terrain: Terrain): Route {
  const raw = pairs(route.p);
  // 右侧行车：沿行进方向右侧（x 东、z 南坐标下为 (-dz, dx)）平移
  const points: Pt[] = raw.map(([x, z], i) => {
    const [px, pz] = raw[Math.max(0, i - 1)];
    const [nx, nz] = raw[Math.min(raw.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    return [x - ((nz - pz) / len) * TRACK_OFFSET, z + ((nx - px) / len) * TRACK_OFFSET];
  });
  const modes = route.m;
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const ground = points.map(([x, z]) => terrain.heightAt(x, z));
  const groundSmooth = smooth(ground, 5).map((y, i) => Math.max(y, ground[i]));
  const target = modes.map((mode, i) => (mode === 2 ? Math.max(...ground.slice(Math.max(0, i - 3), i + 4)) + DECK_HEIGHT : groundSmooth[i] + (mode === 1 ? 1.6 : 1.0)));
  // 模式切换处平滑成约 150m 的坡道；高架段不低于地面 + 6m
  // 隧道段：轨面坡度不超过约 3%。城区地面平缓时贴着地面（半透明"透视"显示），
  // 遇到山体时坡度跟不上地面，轨道留在山体下方，被地形遮住，看起来就是"进了山洞"。
  const MAX_GRADE = 0.03;
  for (let i = 1; i < target.length; i += 1) {
    if (modes[i] === 0) target[i] = Math.min(target[i], target[i - 1] + MAX_GRADE * (cum[i] - cum[i - 1]));
  }
  for (let i = target.length - 2; i >= 0; i -= 1) {
    if (modes[i] === 0) target[i] = Math.min(target[i], target[i + 1] + MAX_GRADE * (cum[i + 1] - cum[i]));
  }
  const ys = smooth(target, 10).map((y, i) => {
    if (modes[i] === 2) return Math.max(y, ground[i] + 6);
    if (modes[i] === 1) return Math.max(y, groundSmooth[i] + 0.8);
    return Math.min(y, groundSmooth[i] + 1.0); // 隧道：不高于地面，可以低于地面
  });

  // 时刻表：起点 → 各站 → 终点（区界处不停车）
  const total = cum[cum.length - 1];
  const nodes = [{ s: 0, dwell: 0 }, ...route.stops.map((stop) => ({ s: cum[stop.i], dwell: DWELL })), { s: total, dwell: 0 }]
    .filter((node, i, list) => i === 0 || node.s - list[i - 1].s > 30);
  const schedule: Route["schedule"] = [];
  let t = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const easeIn = a.dwell > 0;
    const easeOut = b.dwell > 0;
    const duration = ((b.s - a.s) / SPEED) * (1 + (easeIn ? 0.25 : 0) + (easeOut ? 0.25 : 0));
    schedule.push({ t0: t, t1: t + duration, s0: a.s, s1: b.s, easeIn, easeOut, dwellAfter: b.dwell });
    t += duration + b.dwell;
  }
  const cycle = t + TURNAROUND;
  return { line: route.line, points, cum, ys, modes, nodes, schedule, cycle, trains: Math.max(1, Math.ceil(cycle / HEADWAY)) };
}

/** 0–1 的进度映射：两端停站时缓入缓出 */
function ease(u: number, easeIn: boolean, easeOut: boolean) {
  if (easeIn && easeOut) return u * u * (3 - 2 * u);
  if (easeIn) return u * u;
  if (easeOut) return 1 - (1 - u) * (1 - u);
  return u;
}

function positionAt(route: Route, time: number): number | null {
  const local = ((time % route.cycle) + route.cycle) % route.cycle;
  for (const leg of route.schedule) {
    if (local < leg.t0) return leg.s0;
    if (local <= leg.t1) return leg.s0 + (leg.s1 - leg.s0) * ease((local - leg.t0) / (leg.t1 - leg.t0), leg.easeIn, leg.easeOut);
    if (local <= leg.t1 + leg.dwellAfter) return leg.s1;
  }
  return null; // 折返中，不显示
}

function sample(route: Route, s: number) {
  const { cum, points, ys, modes } = route;
  const clamped = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid; else hi = mid;
  }
  const t = cum[hi] > cum[lo] ? (clamped - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return {
    x: points[lo][0] + (points[hi][0] - points[lo][0]) * t,
    z: points[lo][1] + (points[hi][1] - points[lo][1]) * t,
    y: ys[lo] + (ys[hi] - ys[lo]) * t,
    mode: t < 0.5 ? modes[lo] : modes[hi],
  };
}

/** 沿路由生成一段带厚度的带状几何 */
function ribbon(points: Pt[], ys: number[], width: number, thickness: number, color: THREE.Color, target: { positions: number[]; colors: number[]; indices: number[]; dists: number[] }, dists: number[]) {
  if (points.length < 2) return;
  const half = width / 2;
  const base = target.positions.length / 3;
  const rows = thickness > 0 ? [[-half, 0], [half, 0], [half, -thickness], [-half, -thickness]] : [[-half, 0], [half, 0]];
  points.forEach(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(nx - px, nz - pz) || 1;
    const sx = -(nz - pz) / len;
    const sz = (nx - px) / len;
    for (const [offset, dy] of rows) {
      target.dists.push(dists[i]);
      target.positions.push(x + sx * offset, ys[i] + dy, z + sz * offset);
      const shade = dy < 0 ? 0.82 : 1;
      target.colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
  });
  const stride = rows.length;
  const faces = thickness > 0 ? [[0, 1], [1, 2], [2, 3], [3, 0]] : [[0, 1]];
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const [l, r] of faces) {
      const a = base + i * stride + l;
      const b = base + i * stride + r;
      const c = base + (i + 1) * stride + r;
      const d = base + (i + 1) * stride + l;
      target.indices.push(a, d, b, b, d, c);
    }
  }
}

function toMesh(target: { positions: number[]; colors: number[]; indices: number[]; dists: number[] }, material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(target.colors, 3));
  geometry.setAttribute("aDist", new THREE.Float32BufferAttribute(target.dists, 1));
  geometry.setIndex(target.indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/** starts：每条线"生长"的起点（讲解里从南端、深圳主城方向长进光明） */
export function buildMetro(data: SandboxData, terrain: Terrain, starts: Record<string, Pt> = {}) {
  const group = new THREE.Group();
  group.name = "metro";
  const colors = data.meta.lineColors;
  const routes = data.metroRoutes.map((route) => prepareRoute(route, terrain));

  // ---------- 线路：高架桥面 / 地面轨道 / 地下虚线（按线路分组，便于讲解时逐条出现） ----------
  type Buffer = { positions: number[]; colors: number[]; indices: number[]; dists: number[] };
  const newBuffer = (): Buffer => ({ positions: [], colors: [], indices: [], dists: [] });
  // 每条线的"生长"以同一个起点计里程：反方向的路由用 (全长 − 里程)，两条轨道一起从同一端长出来
  const lineStart = new Map<string, Pt>();
  const lineLength = new Map<string, number>();
  const routeDist = (route: Route) => {
    if (!lineStart.has(route.line)) lineStart.set(route.line, starts[route.line] ?? route.points[0]);
    const start = lineStart.get(route.line)!;
    const total = route.cum[route.cum.length - 1];
    lineLength.set(route.line, Math.max(lineLength.get(route.line) ?? 0, total));
    const head = route.points[0];
    const tail = route.points[route.points.length - 1];
    const forward = Math.hypot(head[0] - start[0], head[1] - start[1]) <= Math.hypot(tail[0] - start[0], tail[1] - start[1]);
    // 生长时的领头列车跑在与生长同向的那条轨道上
    if (forward && !leadRoute.has(route.line)) leadRoute.set(route.line, route);
    return route.cum.map((c) => (forward ? c : total - c));
  };
  const routeDists = new Map<Route, number[]>();
  const leadRoute = new Map<string, Route>();
  const perLine = new Map<string, { deck: Buffer; stripe: Buffer; ghost: Buffer; piers: { x: number; y: number; z: number; top: number }[] }>();
  const lineGroups = new Map<string, THREE.Group>();
  const concrete = new THREE.Color("#ebe8e1");
  const soft = new THREE.Color();
  const whiteColor = new THREE.Color("#ffffff");
  const color = new THREE.Color();
  for (const route of routes) {
    if (!perLine.has(route.line)) perLine.set(route.line, { deck: newBuffer(), stripe: newBuffer(), ghost: newBuffer(), piers: [] });
    const { deck, stripe, ghost, piers } = perLine.get(route.line)!;
    const dist = routeDist(route);
    routeDists.set(route, dist);
    color.set(colors[route.line]);
    // 线路本体用浅色：桥面是混凝土色，只在顶面留一条淡化的线路色细带；高饱和度留给列车
    soft.copy(color).lerp(whiteColor, 0.4);
    // 按"地上 / 地下"切段；坡道（离地 > 2.5m 或模式非隧道）都算地上
    let current: number[] = [];
    let currentAbove: boolean | null = null;
    const flush = () => {
      if (current.length < 2) { current = []; return; }
      const pts = current.map((i) => route.points[i]);
      const ys = current.map((i) => route.ys[i]);
      const ds = current.map((i) => dist[i]);
      if (currentAbove) {
        ribbon(pts, ys, 10, 3.6, concrete, deck, ds);
        ribbon(pts, ys.map((y) => y + 0.12), 3.2, 0, soft, stripe, ds);
      }
      else {
        // 地下：40m 实 / 25m 空的虚线
        let run: number[] = [];
        for (const i of current) {
          const on = route.cum[i] % 65 < 40;
          if (on) run.push(i);
          else if (run.length) {
            ribbon(run.map((k) => route.points[k]), run.map((k) => route.ys[k]), 5.5, 0, soft, ghost, run.map((k) => dist[k]));
            run = [];
          }
        }
        if (run.length > 1) ribbon(run.map((k) => route.points[k]), run.map((k) => route.ys[k]), 5.5, 0, soft, ghost, run.map((k) => dist[k]));
      }
      current = [];
    };
    let walked = 0;
    for (let i = 0; i < route.points.length; i += 1) {
      const [x, z] = route.points[i];
      const ground = terrain.heightAt(x, z);
      const above = route.modes[i] !== 0 || route.ys[i] - ground > 2.5;
      if (currentAbove !== null && above !== currentAbove) { const last = current[current.length - 1]; flush(); current = [last]; }
      currentAbove = above;
      current.push(i);
      if (i > 0) walked += route.cum[i] - route.cum[i - 1];
      if (above && route.ys[i] - ground > 5 && walked > 60) { walked = 0; piers.push({ x, y: ground - 1, z, top: route.ys[i] - 3.6 }); }
    }
    flush();
  }
  const deckMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
  const stripeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  glowFromVertexColor(stripeMaterial, 0.8, 0.1);
  const ghostMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });
  glowFromVertexColor(ghostMaterial, 0.6, 0.1);
  const pierGeometry = new THREE.CylinderGeometry(3.6, 4.5, 1, 6);
  pierGeometry.translate(0, 0.5, 0);
  const pierMaterial = new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.8, flatShading: true });
  const growth = new Map<string, RevealAnimation>();
  for (const [line, buffers] of perLine) {
    const lineGroup = new THREE.Group();
    lineGroup.name = `metro-line-${line}`;
    // 每条线一组材质，各自控制"生长"
    const animation = new RevealAnimation();
    growth.set(line, animation);
    const lineDeck = deckMaterial.clone();
    const lineStripe = stripeMaterial.clone();
    const lineGhost = ghostMaterial.clone();
    glowFromVertexColor(lineStripe, 0.8, 0.1);
    glowFromVertexColor(lineGhost, 0.6, 0.1);
    for (const material of [lineDeck, lineStripe, lineGhost]) addReveal(material, animation.uniform);
    const deckMesh = toMesh(buffers.deck, lineDeck);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    lineGroup.add(deckMesh, toMesh(buffers.stripe, lineStripe), toMesh(buffers.ghost, lineGhost));
    if (buffers.piers.length) {
      const pierMesh = new THREE.InstancedMesh(pierGeometry, pierMaterial, buffers.piers.length);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      buffers.piers.forEach((pier, i) => {
        matrix.compose(new THREE.Vector3(pier.x, pier.y, pier.z), quaternion, new THREE.Vector3(1, Math.max(2, pier.top - pier.y), 1));
        pierMesh.setMatrixAt(i, matrix);
      });
      pierMesh.castShadow = true;
      pierMesh.name = "metro-piers";
      lineGroup.add(pierMesh);
    }
    group.add(lineGroup);
    lineGroups.set(line, lineGroup);
  }

  // ---------- 车站：高架站台在桥面上，地下站在地面放出入口亭 ----------
  const stationGroup = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#fbfaf6", roughness: 0.6, flatShading: true });
  const seen = new Set<string>();
  // 换乘站：被两条及以上线路停靠的站
  const linesAt = new Map<string, Set<string>>();
  const pointsAt = new Map<string, { x: number; z: number }[]>();
  routes.forEach((route, r) => {
    for (const stop of data.metroRoutes[r].stops) {
      if (!stop.name) continue;
      if (!linesAt.has(stop.name)) { linesAt.set(stop.name, new Set()); pointsAt.set(stop.name, []); }
      linesAt.get(stop.name)!.add(route.line);
      const [x, z] = route.points[stop.i];
      pointsAt.get(stop.name)!.push({ x, z });
    }
  });
  const isInterchange = (name: string | null) => !!name && (linesAt.get(name)?.size ?? 0) >= 2;
  for (const route of routes) {
    for (const stop of data.metroRoutes[routes.indexOf(route)].stops) {
      const key = `${route.line}:${stop.name ?? stop.i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const i = stop.i;
      const stopDist = routeDists.get(route)?.[i] ?? 0;
      const [x, z] = route.points[i];
      const [px, pz] = route.points[Math.max(0, i - 2)];
      const [nx, nz] = route.points[Math.min(route.points.length - 1, i + 2)];
      const angle = Math.atan2(-(nz - pz), nx - px);
      const roofMaterial = new THREE.MeshStandardMaterial({ color: colors[route.line], roughness: 0.5, flatShading: true });
      const k = isInterchange(stop.name) ? 1.35 : 1;
      if (route.modes[i] === 2) {
        const platform = new THREE.Mesh(new THREE.BoxGeometry(190 * k, 2.5, 34 * k), white);
        platform.position.set(x, route.ys[i] - 1.5, z);
        platform.rotation.y = angle;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(180 * k, 1.8, 36 * k), roofMaterial);
        roof.position.set(x, route.ys[i] + 12, z);
        roof.rotation.y = angle;
        for (const mesh of [platform, roof]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.lines = [route.line]; mesh.userData.dist = stopDist; stationGroup.add(mesh); }
      } else {
        const ground = terrain.heightAt(x, z);
        const kiosk = new THREE.Mesh(new THREE.BoxGeometry(24 * k, 8, 13 * k), white);
        kiosk.position.set(x, ground + 4, z);
        kiosk.rotation.y = angle;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(27 * k, 1.8, 16 * k), roofMaterial);
        cap.position.set(x, ground + 8.9, z);
        cap.rotation.y = angle;
        for (const mesh of [kiosk, cap]) { mesh.castShadow = true; mesh.userData.lines = [route.line]; mesh.userData.dist = stopDist; stationGroup.add(mesh); }
      }
    }
  }
  // 换乘标志塔：白色细柱，顶部按线路色叠几道光环，远看也能认出换乘站
  for (const [name, lines] of linesAt) {
    if (lines.size < 2) continue;
    const spots = pointsAt.get(name)!;
    const x = spots.reduce((sum, p) => sum + p.x, 0) / spots.length;
    const z = spots.reduce((sum, p) => sum + p.z, 0) / spots.length;
    const ground = terrain.heightAt(x, z);
    const towerHeight = 62;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, towerHeight, 10), white);
    tower.position.set(x, ground + towerHeight / 2, z);
    tower.castShadow = true;
    tower.userData.lines = [...lines];
    stationGroup.add(tower);
    [...lines].forEach((line, n) => {
      const ringMaterial = new THREE.MeshStandardMaterial({ color: colors[line], roughness: 0.4 });
      glowColor(ringMaterial, colors[line], 1.6);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 2.2, 10, 28), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, ground + towerHeight - 6 - n * 7, z);
      ring.castShadow = true;
      ring.userData.lines = [line];
      stationGroup.add(ring);
    });
    const top = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 8), white);
    top.position.set(x, ground + towerHeight + 2, z);
    top.userData.lines = [...lines];
    stationGroup.add(top);
  }
  group.add(stationGroup);

  // ---------- 列车 ----------
  const totalCars = routes.reduce((n, route) => n + route.trains * CAR.count, 0);
  const bodyGeometry = new THREE.BoxGeometry(CAR.width, CAR.height, CAR.length);
  const bandGeometry = new THREE.BoxGeometry(CAR.width + 0.25, 1.3, CAR.length - 1.5);
  bandGeometry.translate(0, 0.5, 0);
  const makeFleet = (ghostMode: boolean) => {
    // 车身 = 高饱和线路色（instanceColor），车窗带 = 白色，夜里亮灯
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, flatShading: true, transparent: ghostMode, opacity: ghostMode ? 0.55 : 1, depthWrite: !ghostMode });
    glowFromVertexColor(bodyMaterial, 0.35, ghostMode ? 0.3 : 0.12);
    const bandMaterial = new THREE.MeshStandardMaterial({ color: "#f4f7fa", roughness: 0.3, flatShading: true, transparent: ghostMode, opacity: ghostMode ? 0.65 : 1, depthWrite: !ghostMode });
    glowColor(bandMaterial, "#fff2d2", 1.2);
    const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, totalCars);
    const band = new THREE.InstancedMesh(bandGeometry, bandMaterial, totalCars);
    body.castShadow = !ghostMode;
    band.castShadow = !ghostMode;
    body.frustumCulled = false;
    band.frustumCulled = false;
    if (ghostMode) { body.renderOrder = 2; band.renderOrder = 3; }
    return { body, band };
  };
  const solid = makeFleet(false);
  const ghostFleet = makeFleet(true);
  // 给每节车厢上线路色（两套车队共用顺序）
  let carIndex = 0;
  for (const route of routes) {
    color.set(colors[route.line]).offsetHSL(0, 0.18, 0.02);
    for (let n = 0; n < route.trains * CAR.count; n += 1) {
      solid.body.setColorAt(carIndex, color);
      ghostFleet.body.setColorAt(carIndex, color);
      carIndex += 1;
    }
  }
  group.add(solid.body, solid.band, ghostFleet.body, ghostFleet.band);

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const matrix = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  const rotation = new THREE.Matrix4();

  const hiddenLines = new Set<string>();
  const update = (time: number) => {
    let index = 0;
    for (const route of routes) {
      for (let k = 0; k < route.trains; k += 1) {
        // 生长中：只有一列领头列车，车头就在线路长到的位置；其余列车等长完再出发
        const growing = growth.get(route.line)?.running;
        const head = hiddenLines.has(route.line) ? null
          : growing ? (k === 0 && leadRoute.get(route.line) === route ? Math.max(0, growth.get(route.line)!.uniform.value) : null)
          : positionAt(route, time + k * (route.cycle / route.trains));
        for (let c = 0; c < CAR.count; c += 1) {
          if (head === null) {
            solid.body.setMatrixAt(index, hidden); solid.band.setMatrixAt(index, hidden);
            ghostFleet.body.setMatrixAt(index, hidden); ghostFleet.band.setMatrixAt(index, hidden);
            index += 1;
            continue;
          }
          const center = head - c * (CAR.length + CAR.gap) - CAR.length / 2;
          const a = sample(route, center + CAR.length / 2);
          const b = sample(route, center - CAR.length / 2);
          const m = sample(route, center);
          eye.set(a.x, a.y, a.z);
          look.set(b.x, b.y, b.z);
          rotation.lookAt(eye, look, up);
          quaternion.setFromRotationMatrix(rotation);
          position.set(m.x, m.y + CAR.height / 2 + 0.3, m.z);
          matrix.compose(position, quaternion, unit);
          const underground = m.mode === 0 && m.y - terrain.heightAt(m.x, m.z) < 2.5;
          const on = underground ? ghostFleet : solid;
          const off = underground ? solid : ghostFleet;
          on.body.setMatrixAt(index, matrix); on.band.setMatrixAt(index, matrix);
          off.body.setMatrixAt(index, hidden); off.band.setMatrixAt(index, hidden);
          index += 1;
        }
      }
    }
    for (const mesh of [solid.body, solid.band, ghostFleet.body, ghostFleet.band]) mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  for (const mesh of [solid.body, ghostFleet.body]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const stats = {
    trains: routes.reduce((n, route) => n + route.trains, 0),
    elevatedKm: Math.round(routes.reduce((n, route) => n + route.modes.filter((m) => m === 2).length * 15, 0) / 2 / 100) / 10,
    interchanges: [...linesAt.values()].filter((lines) => lines.size >= 2).length,
    undergroundKm: Math.round(routes.reduce((n, route) => n + route.modes.filter((m) => m === 0).length * 15, 0) / 2 / 100) / 10,
  };
  const corridors = routes.map((route) => route.points);
  /** 讲解时按线路显隐（线路、站点、换乘塔、列车一起） */
  const setLineVisible = (line: string, visible: boolean) => {
    if (visible) hiddenLines.delete(line); else hiddenLines.add(line);
    const lineGroup = lineGroups.get(line);
    if (lineGroup) lineGroup.visible = visible;
    for (const object of stationGroup.children) {
      const lines = object.userData.lines as string[] | undefined;
      if (!lines) continue;
      // 换乘塔：只要有一条线可见就显示；光环按各自线路
      object.visible = lines.some((l) => !hiddenLines.has(l));
    }
  };
  /** 让一条线从起点"长"出来（seconds 秒） */
  const growLine = (line: string, seconds: number) => {
    setLineVisible(line, true);
    growth.get(line)?.start(lineLength.get(line) ?? 0, seconds);
  };
  /** 每帧调用：推进生长，生长中隐藏桥墩，站点随线路到达逐个出现 */
  const updateGrowth = (delta: number) => {
    for (const [line, animation] of growth) {
      if (!animation.running && animation.uniform.value > 1e8) continue;
      const reached = animation.update(delta);
      const lineGroup = lineGroups.get(line);
      lineGroup?.traverse((object) => { if (object.name === "metro-piers") object.visible = !animation.running; });
      for (const object of stationGroup.children) {
        const lines = object.userData.lines as string[] | undefined;
        if (!lines || lines.length !== 1 || lines[0] !== line || hiddenLines.has(line)) continue;
        object.visible = (object.userData.dist as number | undefined) === undefined || (object.userData.dist as number) <= reached;
      }
    }
  };
  /** 正在生长的线路长到的里程；没有在生长时返回 null */
  const growthReached = (line: string) => (growth.get(line)?.running ? growth.get(line)!.uniform.value : null);
  /** 某点（站名标签）在这条线生长里程上的位置 */
  const distanceAlong = (line: string, x: number, z: number) => {
    const route = leadRoute.get(line) ?? routes.find((r) => r.line === line);
    if (!route) return 0;
    const dist = routeDists.get(route)!;
    let best = Infinity;
    let at = 0;
    route.points.forEach(([px, pz], i) => { const d = Math.hypot(px - x, pz - z); if (d < best) { best = d; at = dist[i]; } });
    return at;
  };
  const lines = [...lineGroups.keys()];
  return { group, update, stats, corridors, setLineVisible, lines, growLine, updateGrowth, growthReached, distanceAlong };
}
