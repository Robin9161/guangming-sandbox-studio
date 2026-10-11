import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { projectLngLat } from "../landmarks";
import type { Terrain } from "../terrain";
import { pairs, type SandboxData } from "../types";

type Pt = [number, number];

/**
 * 讲解动画「合水口」：
 * 水从村子四周的高处，沿真实地形的坡往下走（地形坡降追踪），在村前汇到一起；
 * 汇合处浮出"合""水""口"三个字；合在一起的水再顺着合水口河流进茅洲河，从西口出去。
 * 全部由时间 t 决定（seek），可暂停、回放、拖动。
 */

const DURATION = 16;
/** 公明老墟（合水口与上村交界处）：用来在合水口河上找"村前"那一点 */
const GONGMING_MARKET: [number, number] = [113.881356, 22.787551];

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cumulative = (path: Pt[]) => { const c = [0]; for (let i = 1; i < path.length; i += 1) c.push(c[i - 1] + dist(path[i], path[i - 1])); return c; };

/** 把同名的零碎线段按端点拼成一条线 */
function chain(segments: Pt[][]): Pt[] {
  const rest = segments.map((s) => [...s]);
  let line = rest.shift() ?? [];
  let grown = true;
  while (grown && rest.length) {
    grown = false;
    for (let i = 0; i < rest.length; i += 1) {
      const s = rest[i];
      const head = line[0];
      const tail = line[line.length - 1];
      if (dist(tail, s[0]) < 30) line = line.concat(s.slice(1));
      else if (dist(tail, s[s.length - 1]) < 30) line = line.concat([...s].reverse().slice(1));
      else if (dist(head, s[s.length - 1]) < 30) line = s.slice(0, -1).concat(line);
      else if (dist(head, s[0]) < 30) line = [...s].reverse().slice(0, -1).concat(line);
      else continue;
      rest.splice(i, 1);
      grown = true;
      break;
    }
  }
  return line;
}

function nearestOn(path: Pt[], p: Pt) {
  let best = { d: Infinity, i: 0, q: path[0] as Pt };
  for (let i = 0; i < path.length - 1; i += 1) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1)));
    const q: Pt = [ax + dx * t, az + dz * t];
    const d = dist(p, q);
    if (d < best.d) best = { d, i, q };
  }
  return best;
}

/** 从 seed 沿地形最陡下降方向走向汇合点（越靠近越受汇合点牵引，避免在平地上停住） */
function trace(terrain: Terrain, seed: Pt, target: Pt): Pt[] {
  const path: Pt[] = [seed];
  const d0 = dist(seed, target);
  let [x, z] = seed;
  let vx = 0;
  let vz = 0;
  const e = 60;
  for (let step = 0; step < 400; step += 1) {
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz) || 1e-6;
    const d = dist([x, z], target);
    const pull = 0.12 + 1.5 * (1 - d / d0) ** 3;
    let dx = -gx / g * Math.min(1, g * 25) + ((target[0] - x) / d) * pull;
    let dz = -gz / g * Math.min(1, g * 25) + ((target[1] - z) / d) * pull;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // 一点惯性，线条更像水流
    vx = vx * 0.55 + dx * 0.45;
    vz = vz * 0.55 + dz * 0.45;
    const v = Math.hypot(vx, vz) || 1;
    x += (vx / v) * 35;
    z += (vz / v) * 35;
    path.push([x, z]);
    if (d < 70) break;
  }
  path.push(target);
  // 平滑后加一点蜿蜒（两端不动），像溪而不像直线
  const smoothed = path.map((p, i) => {
    if (i === 0 || i === path.length - 1) return p;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(path.length - 1, i + 3); k += 1) { sx += path[k][0]; sz += path[k][1]; n += 1; }
    return [sx / n, sz / n] as Pt;
  });
  const cum = cumulative(smoothed);
  const total = cum[cum.length - 1] || 1;
  const phase = (seed[0] * 0.013 + seed[1] * 0.007) % (Math.PI * 2);
  return smoothed.map((p, i) => {
    if (i === 0 || i === smoothed.length - 1) return p;
    const a = smoothed[Math.max(0, i - 1)];
    const b = smoothed[Math.min(smoothed.length - 1, i + 1)];
    const len = dist(a, b) || 1;
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const off = (170 * Math.sin(cum[i] / 420 + phase) + 60 * Math.sin(cum[i] / 150 + phase * 2.3)) * Math.sin((Math.PI * cum[i]) / total);
    return [p[0] + nx * off, p[1] + nz * off] as Pt;
  });
}

/** 画一条按 reveal（0–1）显示的线，并在显示出的部分上走流动的虚线 */
function drawFlow(c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, path: Pt[], cum: number[], reveal: number, width: number, color: string, flowColor: string, t: number, m: number) {
  if (reveal <= 0 || path.length < 2) return;
  const total = cum[cum.length - 1];
  const until = total * Math.min(1, reveal);
  const pts: Pt[] = [];
  for (let i = 0; i < path.length; i += 1) {
    if (cum[i] <= until) { pts.push(toPixel(path[i][0], path[i][1])); continue; }
    const k = (until - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    pts.push(toPixel(path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k));
    break;
  }
  const stroke = (w: number, style: string, dash: number[] = [], offset = 0) => {
    c.strokeStyle = style;
    c.lineWidth = w;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.setLineDash(dash);
    c.lineDashOffset = offset;
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.stroke();
  };
  const w = Math.max(2.5, width * m);
  // 溪流从源头细到下游粗：分段描，宽度随里程增加
  const taper = (style: string, scale: number) => {
    c.strokeStyle = style;
    c.lineCap = "round";
    c.setLineDash([]);
    const n = pts.length;
    for (let i = 1; i < n; i += 1) {
      const frac = (cum[Math.min(i, cum.length - 1)] / total);
      c.lineWidth = Math.max(1.5, w * scale * (0.35 + 0.65 * frac));
      c.beginPath();
      c.moveTo(pts[i - 1][0], pts[i - 1][1]);
      c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    }
  };
  taper("rgba(255,255,255,0.6)", 1.8);
  taper(color, 1);
  // 流动：虚线沿下游方向移动
  stroke(Math.max(1.2, w * 0.45), flowColor, [w * 1.6, w * 2.6], -t * w * 9);
  c.setLineDash([]);
}

/** village：合水口旧村位置（story-places.json 的 village-heshuikou）；缺省时用公明老墟推算 */
export function createHeshuikouAnim(data: SandboxData, terrain: Terrain, villageAt?: Pt) {
  const toLocal = (lngLat: [number, number]): Pt => projectLngLat(data, lngLat[0], lngLat[1]);
  const lines = data.water.lines.map((l) => ({ n: l.n ?? "", p: pairs(l.p) as Pt[] }));
  const river = chain(lines.filter((l) => l.n === "合水口河").map((l) => l.p));
  const maozhou = lines.filter((l) => l.n === "茅洲河").map((l) => l.p);
  const maozhouPts = maozhou.flat();
  const nearestMaozhou = (p: Pt) => maozhouPts.reduce((best, q) => (dist(p, q) < dist(p, best) ? q : best), maozhouPts[0]);

  // 合水口河的流向：离茅洲河近的一端是下游
  const head = river[0];
  const tail = river[river.length - 1];
  const downstreamRiver = dist(nearestMaozhou(tail), tail) < dist(nearestMaozhou(head), head) ? river : [...river].reverse();

  // 村前：合水口河上离合水口旧村最近的点
  const market = villageAt ?? toLocal(GONGMING_MARKET);
  const hit = nearestOn(downstreamRiver, market);
  const meet: Pt = hit.q;
  console.info("[合水口] 汇合点（本地坐标）", meet.map(Math.round), "距合水口旧村", Math.round(hit.d), "m");

  // 上游：合水口河本身从上游流到村前
  const upstream: Pt[] = [...downstreamRiver.slice(0, hit.i + 1), meet];
  // 下游：村前 → 合水口河下游 → 茅洲河 → 往西出口
  const outlet = nearestMaozhou(downstreamRiver[downstreamRiver.length - 1]);
  const westmost = maozhouPts.reduce((a, b) => (b[0] < a[0] ? b : a), maozhouPts[0]);
  const downstream: Pt[] = [meet, ...downstreamRiver.slice(hit.i + 1), outlet];
  if (dist(outlet, westmost) > 50) downstream.push(westmost);
  downstream.push([westmost[0] - 900, westmost[1] + 120]);

  // 四周的高处：按方向分扇区，每个扇区取一个比村前高的点，避开下游方向和茅洲河对岸
  const downDir = Math.atan2(downstream[2]?.[1] - meet[1], downstream[2]?.[0] - meet[0]);
  const meetH = terrain.heightAt(meet[0], meet[1]);
  const seeds: Pt[] = [];
  // 只从上游一侧来：与下游方向相背的半圈里取 4 个方向
  for (let k = 0; k < 4; k += 1) {
    const a0 = downDir + Math.PI + (k - 1.5) * 0.62;
    let best: { p: Pt; h: number } | null = null;
    for (let r = 1500; r <= 2700; r += 200) {
      for (const da of [-0.15, 0, 0.15]) {
        const a = a0 + da;
        const p: Pt = [meet[0] + Math.cos(a) * r, meet[1] + Math.sin(a) * r];
        if (!terrain.inModel(p[0], p[1])) continue;
        // 和村前之间隔着茅洲河的不取（那边的水流进茅洲河，不来这里）
        let crosses = false;
        for (let s = 0.1; s < 1; s += 0.1) { const q: Pt = [meet[0] + (p[0] - meet[0]) * s, meet[1] + (p[1] - meet[1]) * s]; if (dist(q, nearestMaozhou(q)) < 150) crosses = true; }
        if (crosses) continue;
        const h = terrain.heightAt(p[0], p[1]);
        if (h - meetH > 6 && (!best || h > best.h)) best = { p, h };
      }
    }
    if (best) seeds.push(best.p);
  }
  const tributaries = seeds.map((s) => trace(terrain, s, meet));
  const flows = [
    { path: upstream, start: 1.0, seconds: 4.2, width: 110 },
    ...tributaries.map((path, i) => ({ path, start: 1.4 + i * 0.45, seconds: 3.2 + (i % 2) * 0.5, width: 90 })),
  ].map((f) => ({ ...f, cum: cumulative(f.path) }));
  const arrive = Math.max(...flows.map((f) => f.start + f.seconds));
  const out = { path: downstream, cum: cumulative(downstream), start: arrive + 0.6, seconds: 4.5, width: 140 };

  // ---- 文字
  const group = new THREE.Group();
  group.name = "anim-heshuikou";
  const ground = terrain.heightAt(meet[0], meet[1]);
  const makeLabel = (html: string, style: Partial<CSSStyleDeclaration>, x: number, y: number, z: number) => {
    const holder = document.createElement("div");
    const inner = document.createElement("div");
    inner.innerHTML = html;
    Object.assign(inner.style, { opacity: "0", transition: "none", whiteSpace: "nowrap", fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", sans-serif" }, style);
    holder.appendChild(inner);
    const object = new CSS2DObject(holder);
    object.position.set(x, y, z);
    group.add(object);
    return inner;
  };
  const charStyle: Partial<CSSStyleDeclaration> = { fontSize: "54px", fontWeight: "900", color: "#fffaf1", textShadow: "0 3px 10px rgba(30,60,80,0.55), 0 0 2px rgba(30,60,80,0.9)", letterSpacing: "0" };
  // 三个字横排在汇合点上方：用世界坐标按屏幕横向错开（北在上的镜头，x 即屏幕横向）
  const chars = ["合", "水", "口"].map((ch, i) => makeLabel(ch, charStyle, meet[0] + (i - 1) * 480, ground + 600, meet[1] - 900));
  const charTimes = [arrive - 0.6, arrive + 0.3, out.start + 1.6];
  const subtitle = makeLabel("几条水，在村前合到一起", { fontSize: "17px", fontWeight: "800", color: "#3d4a5c", background: "rgba(255,250,241,0.94)", padding: "5px 14px", borderRadius: "999px", boxShadow: "0 4px 12px rgba(61,74,92,0.22)" }, meet[0], ground + 300, meet[1] - 380);
  const village = makeLabel("明永乐二十一年 · 麦氏开村", { fontSize: "13px", fontWeight: "800", color: "#fffaf1", background: "rgba(61,74,92,0.86)", padding: "4px 12px", borderRadius: "999px" }, market[0], terrain.heightAt(market[0], market[1]) + 120, market[1] + 900);
  const exitLabel = makeLabel("→ 茅洲河 · 珠江口", { fontSize: "13px", fontWeight: "800", color: "#3d4a5c", background: "rgba(255,250,241,0.94)", padding: "4px 12px", borderRadius: "999px" }, downstream[downstream.length - 1][0], terrain.heightAt(downstream[downstream.length - 1][0], downstream[downstream.length - 1][1]) + 160, downstream[downstream.length - 1][1]);

  let time = 0;
  const seek = (t: number) => {
    time = Math.max(0, Math.min(DURATION, t));
    chars.forEach((el, i) => {
      const k = smoothstep(charTimes[i], charTimes[i] + 0.9, time);
      el.style.opacity = String(k);
      el.style.filter = `blur(${(1 - k) * 6}px)`;
    });
    subtitle.style.opacity = String(smoothstep(arrive + 1.2, arrive + 2.2, time));
    village.style.opacity = String(smoothstep(out.start + 3.2, out.start + 4.2, time));
    exitLabel.style.opacity = String(smoothstep(out.start + out.seconds - 0.6, out.start + out.seconds + 0.4, time));
  };
  seek(0);

  const paint = (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, m: number) => {
    const t = time;
    // 地面先压一层淡淡的冷色，让水更显眼
    c.fillStyle = `rgba(232,240,246,${0.16 * smoothstep(0, 1, t)})`;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    for (const f of flows) {
      const u = (t - f.start) / f.seconds;
      drawFlow(c, toPixel, f.path, f.cum, 1 - (1 - Math.min(1, Math.max(0, u))) ** 2, f.width, "rgba(64,150,214,0.95)", "rgba(225,245,255,0.95)", t, m);
    }
    // 汇合处的水纹
    const [mx, my] = toPixel(meet[0], meet[1]);
    for (let k = 0; k < 3; k += 1) {
      const p = (t - (arrive - 0.4) - k * 0.55) / 1.8;
      if (p <= 0 || p >= 1) continue;
      c.strokeStyle = `rgba(80,160,210,${0.75 * (1 - p)})`;
      c.lineWidth = Math.max(2, 18 * m);
      c.beginPath();
      c.arc(mx, my, (60 + 520 * p) * m, 0, Math.PI * 2);
      c.stroke();
    }
    const uo = (t - out.start) / out.seconds;
    drawFlow(c, toPixel, out.path, out.cum, 1 - (1 - Math.min(1, Math.max(0, uo))) ** 2, out.width, "rgba(40,128,198,0.97)", "rgba(225,245,255,0.95)", t, m);
  };

  return {
    group,
    paint,
    duration: DURATION,
    seek,
    /** 镜头落点（北在上） */
    focus: { x: (meet[0] + market[0]) / 2, z: (meet[1] + market[1]) / 2 },
    dispose: () => { group.clear(); },
  };
}
