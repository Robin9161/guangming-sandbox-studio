import * as THREE from "three/webgpu";
import { pairs, type SandboxData } from "../scene/types";
import type { Terrain } from "../scene/terrain";
import { params } from "./params";

/**
 * 画在画面里的地名标签（规范第 9 节：标签直接画进画面，并且能一键关闭）。
 * 原来的网页标签（CSS2D）不会进成片，所以另画一层：显示这层时，同类的网页标签自动隐去，不会重复。
 *
 * - 四类：片区（深色底、最大）、地标（奶油白底）、河湖道路（只有字，没有底）、地铁 / 高铁站（小号，默认关）
 * - 片区、地标、站点下面有一根细线指到地面上的点
 * - 大小按屏幕比例固定（推近拉远都一样大），4K 成片和窗口预览的比例一致
 * - 单独一层，在后期最后叠上去：不被雾、移轴、调色、LUT 影响，永远清楚
 */
type Kind = "district" | "landmark" | "route" | "station";

const ROUTES: { name: string; kind: "water" | "road" }[] = [
  { name: "茅洲河", kind: "water" },
  { name: "光明大道", kind: "road" },
  { name: "光侨路", kind: "road" },
  { name: "观光路", kind: "road" },
];

/** 每类标签的样式：底色、字色、字号（画布像素）、在屏幕上的高度（占画面高度的比例） */
const STYLE: Record<Kind, { font: number; weight: number; bg: string | null; fg: string; screen: number; stem: boolean }> = {
  district: { font: 60, weight: 600, bg: "rgba(61,74,92,0.88)", fg: "#fffaf0", screen: 0.032, stem: true },
  landmark: { font: 48, weight: 500, bg: "rgba(255,252,245,0.93)", fg: "#3d4a5c", screen: 0.025, stem: true },
  route: { font: 46, weight: 600, bg: null, fg: "#fffdf7", screen: 0.022, stem: false },
  station: { font: 38, weight: 500, bg: "rgba(255,252,245,0.9)", fg: "#4a5568", screen: 0.02, stem: true },
};
const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/** 画一张标签贴图：圆角底 + 字 +（可选）指到地面的细线和圆点。返回贴图和宽高比 */
function drawLabel(text: string, kind: Kind) {
  const st = STYLE[kind];
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `${st.weight} ${st.font}px ${FONT_FAMILY}`;
  g.font = font;
  const textW = Math.ceil(g.measureText(text).width);
  const padX = Math.round(st.font * 0.7), pillH = Math.round(st.font * 1.6);
  const stemH = st.stem ? Math.round(st.font * 1.6) : 0, dot = st.stem ? Math.round(st.font * 0.16) : 0;
  c.width = textW + padX * 2 + 8;
  c.height = pillH + stemH + dot * 2 + 4;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = c.width / 2;
  if (st.stem) {
    g.strokeStyle = "rgba(255,250,240,0.9)";
    g.lineWidth = Math.max(2, st.font * 0.06);
    g.beginPath(); g.moveTo(cx, pillH); g.lineTo(cx, pillH + stemH); g.stroke();
    g.fillStyle = "rgba(255,250,240,0.95)";
    g.beginPath(); g.arc(cx, pillH + stemH + dot, dot, 0, Math.PI * 2); g.fill();
  }
  if (st.bg) {
    g.fillStyle = st.bg;
    g.beginPath(); g.roundRect(4, 2, c.width - 8, pillH - 4, (pillH - 4) / 2); g.fill();
    g.fillStyle = st.fg;
    g.fillText(text, cx, pillH / 2 + 1);
  } else {
    // 只有字：深色描边保证在亮、暗背景上都看得清
    g.lineJoin = "round";
    g.strokeStyle = "rgba(35,45,65,0.65)";
    g.lineWidth = st.font * 0.16;
    g.strokeText(text, cx, pillH / 2);
    g.fillStyle = st.fg;
    g.fillText(text, cx, pillH / 2);
  }
  const tex = new THREE.CanvasTexture(c); // 不设色彩空间：贴图里已经是最终显示的颜色，原样叠到成片上
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height, pillFrac: (pillH - 4) / c.height };
}

/** landmarks：精细地标（名字 + 位置，来自 landmarkModules 和虹桥），planned = 规划示意，不标 */
export function buildFrameLabels(data: SandboxData, terrain: Terrain, landmarks: { name: string; position: THREE.Vector3; planned?: boolean }[]) {
  const local = data;
  const scene = new THREE.Scene();
  const labels: { sprite: THREE.Sprite; kind: Kind; aspect: number; pillFrac: number }[] = [];
  const add = (text: string, kind: Kind, x: number, z: number, lift = 0) => {
    if (!terrain.inside(x, z)) return;
    const { tex, aspect, pillFrac } = drawLabel(text, kind);
    const m = new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(m);
    sprite.center.set(0.5, STYLE[kind].stem ? 0 : 0.5); // 有细线的：底部的圆点对准地面
    sprite.position.set(x, terrain.heightAt(x, z) + lift, z);
    sprite.renderOrder = kind === "district" ? 3 : kind === "landmark" ? 2 : 1;
    scene.add(sprite);
    labels.push({ sprite, kind, aspect, pillFrac });
  };

  // 片区：sandbox.json 的 landmarks（光明中心、公明中心……）
  for (const l of local.landmarks) { const [x, z] = l.p; add(l.name, "district", x, z, 4); }
  const seenLandmarks = new Set<string>();
  for (const l of landmarks) {
    if (l.planned || seenLandmarks.has(l.name)) continue;
    seenLandmarks.add(l.name);
    add(l.name, "landmark", l.position.x, l.position.z, 4);
  }
  // 河流道路：取渲染范围内那一段的中间
  for (const r of ROUTES) {
    const segs = r.kind === "water" ? local.water.lines.filter((l) => l.n === r.name) : local.roads.filter((l) => l.n === r.name);
    const pts = segs.flatMap((s) => pairs(s.p)).filter(([x, z]) => terrain.inside(x, z));
    if (pts.length < 2) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, mz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const near = pts.reduce((a, p) => (Math.hypot(p[0] - mx, p[1] - mz) < Math.hypot(a[0] - mx, a[1] - mz) ? p : a));
    add(r.name.split("").join(" "), "route", near[0], near[1], 30);
  }
  // 大的湖、水库（和原来的网页水体标签同一套筛选：7 万平方米以上、有名字、不和片区重名）
  const districtNames = new Set(local.landmarks.map((l) => l.name));
  for (const area of local.water.areas) {
    if (!area.name || area.area < 70000 || area.level === undefined || districtNames.has(area.name)) continue;
    const ring = pairs(area.p);
    const x = ring.reduce((s, p) => s + p[0], 0) / ring.length, z = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    add(area.name, "route", x, z, 30);
  }
  // 站点（同名的地铁站、高铁站只标一次）
  const seen = new Set<string>();
  for (const s of local.stations) {
    const name = s.mode === "metro" ? `${s.name}站` : `${s.name}站（高铁）`;
    if (seen.has(name)) continue;
    seen.add(name);
    add(name, "station", s.p[0], s.p[1], 3);
  }

  // 重要的先摆：片区 > 地标 > 河流道路 > 站点；和已经摆好的标签挤在一起的就不显示
  const PRIORITY: Record<Kind, number> = { district: 0, landmark: 1, route: 2, station: 3 };
  labels.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const ndc = new THREE.Vector3();
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];

  /**
   * 每帧：按参数显隐；按视角把尺寸换算成"占画面高度的比例"（视角变了大小也不变）；
   * 在屏幕上互相避让（只比较底框部分，细线可以交叉）。
   */
  /** enabled：总开关（参数「显示地名标签」之外，右侧「图层 → 标签」关掉、讲解时也不显示） */
  const update = (camera: THREE.PerspectiveCamera, enabled = true) => {
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * params.labelSize;
    const show: Record<Kind, boolean> = { district: params.showLabelDistricts, landmark: params.showLabelLandmarks, route: params.showLabelRoutes, station: params.showLabelStations };
    placed.length = 0;
    for (const l of labels) {
      const h = (STYLE[l.kind].screen / l.pillFrac) * k; // screen 是底框高度占画面高度的比例；精灵高度 ÷ (2·tan(视角/2)) = 占画面的比例
      l.sprite.scale.set(h * l.aspect, h, 1);
      l.sprite.visible = enabled && params.showLabels && show[l.kind];
      if (!l.sprite.visible) continue;
      ndc.copy(l.sprite.position).project(camera);
      if (ndc.z > 1) continue; // 在镜头背后
      // 屏幕上的底框（坐标范围 -1…1）：高度 = 占画面比例 × 2，宽度再按画面宽高比换算
      // 预览时相机带"取景框外延伸"（setViewOffset），屏幕上的比例要按实际画面算
      const view = camera.view?.enabled ? camera.view : null;
      const frameToScreen = view ? view.fullHeight / view.height : 1; // 取景框高度 / 窗口高度
      const hNdc = (h / k) * params.labelSize * 2 * frameToScreen;
      const screenAspect = view ? view.width / view.height : camera.aspect;
      const wNdc = (hNdc * l.aspect) / screenAspect;
      const bottom = l.sprite.center.y === 0 ? ndc.y : ndc.y - hNdc / 2;
      const box = { x0: ndc.x - wNdc / 2, x1: ndc.x + wNdc / 2, y0: bottom + hNdc * (1 - l.pillFrac), y1: bottom + hNdc };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) { l.sprite.visible = false; continue; }
      placed.push(box);
    }
  };
  const dispose = () => { for (const l of labels) { const m = l.sprite.material as THREE.SpriteNodeMaterial; m.map?.dispose(); m.dispose(); } };
  return { scene, update, dispose, count: labels.length };
}

export type FrameLabels = ReturnType<typeof buildFrameLabels>;
