import * as THREE from "three";
import { addReveal, RevealAnimation } from "./grow";
import { hsr } from "./palette";
import type { Terrain } from "./terrain";
import { pairs, type SandboxData } from "./types";

type Pt = [number, number];

/**
 * 高铁：先把 OSM 零碎的路段按端点拼成连续线路，再为整条线设计一条平顺的轨面高度：
 * 大半径平滑 + 最大坡度约 2.5%（沙盘高程已夸张）。
 * 结果：车站和高架段基本水平；山体高出轨面的地方自动进入隧道（被地形遮住），两端放洞门。
 * OSM 标为隧道的点强制在地面以下。
 */
const CLEARANCE = 18; // 高架段轨面离地（沙盘比例）
const MAX_GRADE = 0.025;
const SMOOTH_RADIUS_M = 600;
const STEP = 15;

/** 高铁"延伸"动画 */
export const hsrGrowth = new RevealAnimation();

function chainSegments(segments: { pts: Pt[]; mode: string }[]) {
  const remaining = segments.map((s) => ({ ...s }));
  const chains: { pts: Pt[]; modes: string[] }[] = [];
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  while (remaining.length) {
    const first = remaining.shift()!;
    let pts = [...first.pts];
    let modes = first.pts.map(() => first.mode);
    let extended = true;
    while (extended) {
      extended = false;
      let best: { index: number; d: number; atEnd: boolean; reverse: boolean } | null = null;
      remaining.forEach((seg, index) => {
        const head = pts[0];
        const tail = pts[pts.length - 1];
        const s0 = seg.pts[0];
        const s1 = seg.pts[seg.pts.length - 1];
        for (const [d, atEnd, reverse] of [[dist(tail, s0), true, false], [dist(tail, s1), true, true], [dist(head, s1), false, false], [dist(head, s0), false, true]] as [number, boolean, boolean][]) {
          if (!best || d < best.d) best = { index, d, atEnd, reverse };
        }
      });
      if (best && (best as { d: number }).d < 30) {
        const { index, atEnd, reverse } = best as { index: number; atEnd: boolean; reverse: boolean };
        const seg = remaining.splice(index, 1)[0];
        const segPts = reverse ? [...seg.pts].reverse() : seg.pts;
        const segModes = segPts.map(() => seg.mode);
        if (atEnd) { pts = pts.concat(segPts.slice(1)); modes = modes.concat(segModes.slice(1)); }
        else { pts = segPts.slice(0, -1).concat(pts); modes = segModes.slice(0, -1).concat(modes); }
        extended = true;
      }
    }
    chains.push({ pts, modes });
  }
  return chains;
}

function densify(pts: Pt[], modes: string[]) {
  const out: Pt[] = [];
  const outModes: string[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
    for (let k = 0; k < steps; k += 1) { out.push([ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps]); outModes.push(modes[i]); }
  }
  out.push(pts[pts.length - 1]);
  outModes.push(modes[modes.length - 1]);
  return { pts: out, modes: outModes };
}

function smooth(values: number[], radius: number) {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, i) => {
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length - 1, i + radius);
    return (prefix[b + 1] - prefix[a]) / (b - a + 1);
  });
}

function gradeLimit(values: number[], step: number, grade: number) {
  const out = [...values];
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 1; i < out.length; i += 1) out[i] = Math.min(Math.max(out[i], out[i - 1] - grade * step), out[i - 1] + grade * step);
    for (let i = out.length - 2; i >= 0; i -= 1) out[i] = Math.min(Math.max(out[i], out[i + 1] - grade * step), out[i + 1] + grade * step);
  }
  return out;
}

export function buildHighSpeed(data: SandboxData, terrain: Terrain) {
  const group = new THREE.Group();
  group.name = "high-speed";
  const byName = new Map<string, { pts: Pt[]; mode: string }[]>();
  for (const seg of data.rail) {
    if (seg.line !== "hsr") continue;
    if (!byName.has(seg.name)) byName.set(seg.name, []);
    byName.get(seg.name)!.push({ pts: pairs(seg.p), mode: seg.mode });
  }

  const deck = { positions: [] as number[], colors: [] as number[], indices: [] as number[], dists: [] as number[] };
  const piers: { x: number; z: number; ground: number; top: number }[] = [];
  const portals: { x: number; y: number; z: number; angle: number }[] = [];
  const deckColor = new THREE.Color(hsr.deck);
  const sideColor = new THREE.Color(hsr.side);
  const stats = { tunnelM: 0, viaductM: 0 };

  for (const segments of byName.values()) {
    for (const chain of chainSegments(segments)) {
      if (chain.pts.length < 2) continue;
      const { pts, modes } = densify(chain.pts, chain.modes);
      // "延伸"从南端（深圳北方向）往北长
      const firstIsNorth = pts[0][1] < pts[pts.length - 1][1];
      const along = (i: number) => (firstIsNorth ? pts.length - 1 - i : i) * STEP;
      const ground = pts.map(([x, z]) => terrain.heightAt(x, z));
      // 设计轨面：地面 + 净空 → 大半径平滑 → OSM 隧道点压到地面以下 → 坡度限制
      let design = smooth(ground.map((g) => g + CLEARANCE), Math.round(SMOOTH_RADIUS_M / STEP));
      design = design.map((y, i) => (modes[i] === "tunnel" ? Math.min(y, ground[i] - 12) : y));
      design = gradeLimit(smooth(design, 8), STEP, MAX_GRADE);

      const state = design.map((y, i) => (y < ground[i] - 4 ? "tunnel" : "above"));
      // 轨道面：只画地面以上的部分；隧道段不画（被山体遮住）
      let run: number[] = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const base = deck.positions.length / 3;
        const rows: [number, number, THREE.Color][] = [[-8, -3.5, sideColor], [-8, 0, sideColor], [-7, 0, deckColor], [7, 0, deckColor], [8, 0, sideColor], [8, -3.5, sideColor]];
        for (const i of run) {
          const [px, pz] = pts[Math.max(0, i - 1)];
          const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
          const len = Math.hypot(nx - px, nz - pz) || 1;
          const sx = -(nz - pz) / len;
          const sz = (nx - px) / len;
          for (const [offset, dy, color] of rows) {
            deck.positions.push(pts[i][0] + sx * offset, design[i] + dy, pts[i][1] + sz * offset);
            deck.colors.push(color.r, color.g, color.b);
            deck.dists.push(along(i));
          }
        }
        for (let k = 0; k < run.length - 1; k += 1) {
          for (let r = 0; r < rows.length - 1; r += 1) {
            const a = base + k * rows.length + r;
            const b = a + 1;
            const c = base + (k + 1) * rows.length + r + 1;
            const d = base + (k + 1) * rows.length + r;
            deck.indices.push(a, d, b, b, d, c);
          }
        }
        run = [];
      };
      let walked = 0;
      for (let i = 0; i < pts.length; i += 1) {
        if (state[i] === "above") {
          run.push(i);
          const clearance = design[i] - ground[i];
          if (i > 0) walked += STEP;
          if (clearance > 6 && walked >= 50) {
            walked = 0;
            piers.push({ x: pts[i][0], z: pts[i][1], ground: ground[i] - 1, top: design[i] - 3.5 });
          }
          if (clearance > 6) stats.viaductM += STEP;
        } else {
          stats.tunnelM += STEP;
          // 进入隧道：在前一个地面以上的点放洞门；离开隧道同理
          if (i > 0 && state[i - 1] === "above") portals.push({ x: pts[i - 1][0], y: design[i - 1], z: pts[i - 1][1], angle: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) });
          if (i < pts.length - 1 && state[i + 1] === "above") portals.push({ x: pts[i + 1][0], y: design[i + 1], z: pts[i + 1][1], angle: Math.atan2(pts[i][1] - pts[i + 1][1], pts[i][0] - pts[i + 1][0]) });
          flush();
        }
      }
      flush();
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(deck.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(deck.colors, 3));
  geometry.setAttribute("aDist", new THREE.Float32BufferAttribute(deck.dists, 1));
  geometry.setIndex(deck.indices);
  geometry.computeVertexNormals();
  const hsrMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, side: THREE.DoubleSide });
  addReveal(hsrMaterial, hsrGrowth.uniform);
  const deckMesh = new THREE.Mesh(geometry, hsrMaterial);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  group.add(deckMesh);

  if (piers.length) {
    const pierGeometry = new THREE.CylinderGeometry(3, 3.8, 1, 8);
    pierGeometry.translate(0, 0.5, 0);
    const pierMesh = new THREE.InstancedMesh(pierGeometry, new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.8, flatShading: true }), piers.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    piers.forEach((pier, i) => {
      matrix.compose(new THREE.Vector3(pier.x, pier.ground, pier.z), quaternion, new THREE.Vector3(1, Math.max(1, pier.top - pier.ground), 1));
      pierMesh.setMatrixAt(i, matrix);
    });
    pierMesh.castShadow = true;
    pierMesh.name = "hsr-piers";
    group.add(pierMesh);
  }

  const frameMaterial = new THREE.MeshStandardMaterial({ color: "#d9d5cc", roughness: 0.85, flatShading: true });
  const holeMaterial = new THREE.MeshStandardMaterial({ color: "#2b3038", roughness: 1 });
  for (const portal of portals) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 18, 28), frameMaterial);
    frame.position.y = 6;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(6.6, 11, 16), holeMaterial);
    hole.position.y = 2.5;
    const assembly = new THREE.Group();
    assembly.add(frame, hole);
    assembly.position.set(portal.x, portal.y - 3, portal.z);
    assembly.rotation.y = -portal.angle;
    frame.castShadow = true;
    assembly.name = "hsr-portal";
    group.add(assembly);
  }
  group.userData = { ...stats, portals: portals.length };
  return group;
}
