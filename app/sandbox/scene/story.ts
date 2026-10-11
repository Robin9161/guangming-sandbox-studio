import plan from "../../../data/spatial/planning/guangming-plan-foundation-v0.1.json";
import type { GrowthPlan } from "./growthPlan";
import { projectLngLat } from "./landmarks";
import { pairs, type LayerKey, type SandboxData } from "./types";

/**
 * 沙盘讲解剧本（文案依据 reports/R0-光明脉络与讲解文案-V0.2-2026-10-05.md）。
 * 讲法：娓娓道来，先山水、再两个起点、再路和轨道、最后往东走。
 * 镜头：始终北在上（azimuth = 0），只推拉、平移，不大角度旋转，避免迷失方向。
 * 生长：建筑先只有西岸老城；龙大、南光讲完，沿光明大道长出其余的城市（见 growthPlan.ts）。
 * 规划色块来自 data/spatial/planning/guangming-plan-foundation-v0.1.json（C 级示意配准，不作宗地依据）。
 */

type Pt = [number, number];
type Paint = (context: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, metersToPixels: number) => void;
type Feature = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };

/**
 * 建筑处在哪个阶段：none 还没有城市；west-grow 西岸老城长出来；west 只有西岸老城；
 * avenue-grow 沿光明大道长出其余部分（道路同步）；缺省 = 全部长成。
 */
export type BuildingStage = "none" | "west-grow" | "west" | "avenue-grow";

export type StoryStep = {
  id: string;
  title: string;
  question: string;
  body: string;
  source: string;
  layers: Partial<Record<LayerKey, boolean>>;
  paint: Paint | null;
  camera: { x: number; z: number; distance: number; elevation: number; azimuth: number };
  labels: { text: string; x: number; z: number }[];
  /** 舞台光照射的主体板块（可选） */
  focus?: { x: number; z: number; radius: number };
  /** 地铁按线路显隐（讲解按开通年份逐条出现）；缺省时随 metro 图层全部显示 */
  metroLines?: Record<string, boolean>;
  /**
   * 运镜（到位后）：push 推拉；track 沿路径平移（不转向）；
   * fly 从深圳全图飞入到本拍镜头（只用于开场）。
   */
  motion?: { kind: "push"; toDistance: number; seconds: number } | { kind: "track"; path: Pt[]; seconds: number } | { kind: "fly"; seconds: number };
  /** 所属幕，用于说明卡 */
  act: string;
  /** 开场显示深圳全图（飞入过程中淡出） */
  context?: boolean;
  buildings?: BuildingStage;
  /** 生长：expressways / hsr / metro 指定哪条线从起点长出来（秒）；hidden 里的高速隐藏（还没建） */
  grow?: {
    hsr?: number;
    expressways?: { longda?: number; nanguang?: number };
    metro?: { line: string; seconds: number }[];
  };
  hidden?: { expressways?: ("longda" | "nanguang")[] };
  /** 路名沿路浮现：起点地名先出现，路长到哪里路名的字就出现到哪里，到头浮现下一个地名 */
  roadCaption?: { road: "longda" | "nanguang" | "avenue"; name: string; from: string; to: string };
  /** 这一拍的地铁站名：全景下也显示，列车到站时点亮 */
  stationFocus?: string[];
  /** 这一拍切到茅洲河流域视图并播放水库时间线（scene/watershed.ts），镜头由时间线控制 */
  watershed?: boolean;
  /** 这一拍播放的讲解动画（scene/anim/），动画自带镜头落点 */
  anim?: "heshuikou" | "river" | "alluvial" | "migration" | "wind" | "flood" | "farm";
};

/** 其他 AI 交付的讲解地点（public/sandbox/story/story-places.json），可缺省 */
export type StoryPlaces = Record<string, { name: string; x: number; z: number; verified?: boolean }>;

const ALL_ON: Partial<Record<LayerKey, boolean>> = { buildings: true, landmarks: true, fill: true, trees: true, water: true, roads: true, expressways: true, metro: true, hsr: true, labels: true, clouds: true, planned: false };
const BARE: Partial<Record<LayerKey, boolean>> = { buildings: false, landmarks: false, planned: false, fill: false, trees: false, water: true, roads: false, expressways: false, metro: false, hsr: false, labels: false, clouds: true };
/** 只有西岸老城的那段时间 */
const OLD_TOWN: Partial<Record<LayerKey, boolean>> = { ...BARE, buildings: true, fill: true };

export function buildStory(data: SandboxData, places: StoryPlaces, growth: GrowthPlan): StoryStep[] {
  const toLocal = (lngLat: Pt): Pt => projectLngLat(data, lngLat[0], lngLat[1]);
  const features = (key: keyof typeof plan) => ((plan[key] as { features?: Feature[] }).features ?? []);
  const rings = (feature: Feature): Pt[][] => {
    const g = feature.geometry;
    if (g.type === "Polygon") return [(g.coordinates as Pt[][])[0].map(toLocal)];
    if (g.type === "MultiPolygon") return (g.coordinates as Pt[][][]).map((p) => p[0].map(toLocal));
    return [];
  };
  const line = (feature: Feature): Pt[] => (feature.geometry.type === "LineString" ? (feature.geometry.coordinates as Pt[]).map(toLocal) : []);
  const point = (feature: Feature): Pt => toLocal(feature.geometry.coordinates as Pt);
  const centroid = (ring: Pt[]): Pt => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const bbox = (pts: Pt[]) => {
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) };
  };

  // ---- 绘制工具
  const fill = (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, polygons: Pt[][], color: string) => {
    c.fillStyle = color;
    c.beginPath();
    for (const ring of polygons) {
      ring.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); });
      c.closePath();
    }
    c.fill("evenodd");
  };
  const stroke = (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, path: Pt[], color: string, widthPx: number, dash: number[] = []) => {
    if (path.length < 2) return;
    c.strokeStyle = color;
    c.lineWidth = widthPx;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.setLineDash(dash);
    c.beginPath();
    path.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); });
    c.stroke();
    c.setLineDash([]);
  };
  const arrowHead = (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, path: Pt[], color: string, sizePx: number) => {
    const [ax, ay] = toPixel(...path[path.length - 2]);
    const [bx, by] = toPixel(...path[path.length - 1]);
    const angle = Math.atan2(by - ay, bx - ax);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(bx + Math.cos(angle) * sizePx, by + Math.sin(angle) * sizePx);
    c.lineTo(bx + Math.cos(angle + 2.4) * sizePx, by + Math.sin(angle + 2.4) * sizePx);
    c.lineTo(bx + Math.cos(angle - 2.4) * sizePx, by + Math.sin(angle - 2.4) * sizePx);
    c.closePath();
    c.fill();
  };

  // ---- 茅洲河与东西两岸（与 V1 分析相同的划分，见 growthPlan）
  const { river, trunkSorted, westBank } = growth;
  const riverMid = trunkSorted[Math.floor(trunkSorted.length / 2)] ?? [0, 0];
  const tintBanks = (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => Pt, west: string, east: string) => {
    c.save();
    c.fillStyle = east;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.globalCompositeOperation = "destination-out";
    fill(c, toPixel, [westBank], "rgba(0,0,0,1)");
    c.restore();
    fill(c, toPixel, [westBank], west);
  };

  const centers = features("structureCenters").map((f) => ({ name: String(f.properties.name), p: point(f) }));
  const gongming = centers.find((c) => c.name === "公明")?.p ?? [-3000, -1500];
  const guangming = centers.find((c) => c.name === "光明")?.p ?? [1500, -1500];
  const coreMid: Pt = [(gongming[0] + guangming[0]) / 2, (gongming[1] + guangming[1]) / 2];
  const greenAreas = features("ecologicalSystemAreas");
  const greenNames: Record<string, string> = { "regional-green-north": "巍峨山", "regional-green-east": "大顶岭 · 公明水库", "regional-green-south": "大雁山", "regional-green-west": "五指耙" };
  const structureLabels = features("structureLabels");
  const landmarkPositions = (name: string): Pt | null => { const l = data.landmarks.find((item) => item.name === name); return l ? [l.p[0], l.p[1]] : null; };
  const place = (id: string, fallback: Pt): Pt => (places[id] ? [places[id].x, places[id].z] : fallback);
  const metroPath = (lineId: string): Pt[] => { const r = data.metroRoutes.find((item) => item.line === lineId); return r ? pairs(r.p) : []; };

  // ---- 区界按方向分段（与地形分析相同的分法）
  const boundary = pairs(data.boundary);
  const bc: Pt = centroid(boundary);
  const sideOf = ([x, z]: Pt) => { const a = (Math.atan2(-(z - bc[1]), x - bc[0]) * 180) / Math.PI; return a >= 45 && a < 135 ? "N" : a >= -45 && a < 45 ? "E" : a >= -135 && a < -45 ? "S" : "W"; };
  const sideRuns: Record<string, Pt[][]> = { N: [], E: [], S: [], W: [] };
  {
    let run: Pt[] = [];
    let current = "";
    for (let i = 0; i <= boundary.length; i += 1) {
      const p = boundary[i % boundary.length];
      const side = sideOf(p);
      if (side !== current && run.length) { run.push(p); sideRuns[current].push(run); run = []; }
      current = side;
      run.push(p);
    }
    if (run.length > 1) sideRuns[current].push(run);
  }
  const sideLabel = (side: string, text: string, push = 2600) => {
    const pts = sideRuns[side].flat();
    const [mx, mz] = centroid(pts.length ? pts : [bc]);
    const dx = mx - bc[0];
    const dz = mz - bc[1];
    const len = Math.hypot(dx, dz) || 1;
    return { text, x: mx + (dx / len) * push, z: mz + (dz / len) * push };
  };
  const neighborColors: Record<string, string> = { N: "rgba(120,170,230,0.95)", E: "rgba(150,200,120,0.95)", S: "rgba(240,170,90,0.95)", W: "rgba(200,140,210,0.95)" };

  const fenghuang = landmarkPositions("凤凰城") ?? [0, 1300];
  const guangmingcheng = landmarkPositions("光明城") ?? [2000, 2900];
  const oldMarket = growth.gongmingOld;
  const scienceMuseum = toLocal([113.938781, 22.775097]);
  const csot = places["csot-t1"] ? ([places["csot-t1"].x, places["csot-t1"].z] as Pt) : null;

  // ---- 镜头：一律北在上；全景看整体，近景只推近不转向
  const north = (x: number, z: number, distance: number, elevation = 50) => ({ x, z, distance, elevation, azimuth: 0 });
  const overview = north(0, 600, 30000, 55);
  /**
   * 让一段范围整体入画（北在上）。可见区域约为画面左上 60% 宽 × 50% 高（右侧面板、左下说明卡），
   * 仰角约 55° 时地面可见高度 ≈ 0.65 × 距离，所以距离 ≈ max(1.9 × 宽, 3.1 × 高)。
   */
  const fit = (pts: Pt[], min: number, elevation = 56) => {
    const b = bbox(pts.length ? pts : [[0, 0]]);
    return north(b.cx, b.cz, Math.max(min, b.w * 1.9, b.h * 3.1), elevation);
  };
  const roadView = (path: Pt[]) => fit(path, 18000, 58);
  // 历史画面的取景：按画面内容（村点、来路标签、西岸范围）整体入画
  const placePt = (id: string, fallback: Pt): Pt => (places[id] ? [places[id].x, places[id].z] : fallback);
  const villagePts = ["village-yulu", "village-heshuikou", "village-loucun", "village-dongkeng", "village-jingkou"].map((id) => placePt(id, [0, 0]));
  // 玉律在最南端，说明卡在左下：镜头再拉远一点、往南挪，让南边的村子露出来
  const migrationFit = fit([...villagePts, [-1300, -6800], [3900, -6500]], 22000, 60);
  const migrationView = { ...migrationFit, z: migrationFit.z + 1500, distance: migrationFit.distance * 1.12 };
  const westView = fit([[-7200, -5200], [500, -5200], [500, 4800], [-7200, 4800]], 22000, 60);
  const farmView = fit([[-1500, -5500], [5500, -5500], [5500, 4500], [-1500, 4500]], 22000, 60);
  const longdaView = roadView(growth.expresswayPaths.longda);
  const nanguangView = roadView(growth.expresswayPaths.nanguang);
  // 光明大道：比两条高速的全景稍近一点
  const avenueFit = fit(growth.avenue, 12000, 52);
  const avenueView = { ...avenueFit, distance: avenueFit.distance * 1.2 };
  const lineView = (lineId: string) => fit(metroPath(lineId), 14000, 55);
  const breathe = (distance: number, seconds = 12, factor = 0.92) => ({ kind: "push" as const, toDistance: distance * factor, seconds });
  const allLines = { "6": true, "6b": true, "13": true };
  const transit = { ...ALL_ON, trees: true, labels: true };

  return [
    // ===================== 序 · 光明在哪里 =====================
    {
      id: "where", act: "序 · 光明在哪里", title: "序-1 · 深圳的西北角",
      question: "光明在哪里？",
      body: "先把镜头拉远，看看整个深圳。福田、南山挨着南边的海湾；往西北走，越过石岩的山，有一块被山围起来的平地，这就是光明。它大约 155 平方公里，2018 年才正式设区，是深圳很年轻的一个区。",
      source: "已核实：维基百科·光明区；国务院 2018 年批复。深圳全图：OSM（ODbL）",
      layers: BARE, paint: null, labels: [],
      camera: overview,
      context: true,
      buildings: "none",
      motion: { kind: "fly", seconds: 9 },
    },
    {
      id: "neighbors", act: "序 · 光明在哪里", title: "序-2 · 四邻",
      question: "光明和谁挨着？",
      body: "沿着边界走一圈：北边是东莞黄江，东边是龙华观澜，南边是宝安石岩，西边是宝安松岗。光明并不挨着南山。从南山过来，要先穿过石岩，靠的是南光高速和 13 号线，这两条线后面都会讲到。",
      source: "已核实：维基百科·光明区",
      layers: BARE,
      paint: (c, toPixel, m) => { for (const side of ["N", "E", "S", "W"]) for (const run of sideRuns[side]) stroke(c, toPixel, run, neighborColors[side], Math.max(6, 160 * m)); },
      camera: overview,
      labels: [sideLabel("N", "北 · 东莞黄江"), sideLabel("E", "东 · 龙华观澜"), sideLabel("S", "南 · 宝安石岩（再往南是南山）"), sideLabel("W", "西 · 宝安松岗")],
      buildings: "none",
      motion: breathe(overview.distance),
    },
    // ===================== 第一幕 · 山水定形 =====================
    {
      id: "mountains", act: "第一幕 · 山水定形", title: "1-1 · 三面是山，西面敞开",
      question: "光明的边界是怎么来的？",
      body: "再看地形。北、东、南三面的边界，大多是沿着山脊画的，边界上的高程在八十多到一百三十多米；盆地中间只有二十来米。只有西面是平地，一直敞向松岗。光明就像一只朝西开口的碗。",
      source: "本项目计算：DEM 高程（SRTM 约 30m）沿区界分方向统计（中位数 北 84 / 东 136 / 南 108 / 西 15 米，盆地 21 米）",
      layers: BARE,
      paint: (c, toPixel, m) => {
        for (const side of ["N", "E", "S"]) for (const run of sideRuns[side]) stroke(c, toPixel, run, "rgba(214,120,70,0.95)", Math.max(6, 170 * m));
        for (const run of sideRuns.W) stroke(c, toPixel, run, "rgba(70,150,220,0.95)", Math.max(6, 170 * m), [Math.max(8, 220 * m), Math.max(5, 140 * m)]);
      },
      // 山的起伏要斜着看才明显：仍然北在上，只把仰角放低
      camera: north(0, 900, 24000, 30),
      labels: [sideLabel("N", "北：山脊", 1200), sideLabel("E", "东：大顶岭", 1200), sideLabel("S", "南：山脊", 1200), sideLabel("W", "西：敞开的平地", 1500)],
      buildings: "none",
      motion: breathe(24000),
    },
    {
      id: "green-ring", act: "第一幕 · 山水定形", title: "1-2 · 一圈绿",
      question: "是什么把盆地围起来的？",
      body: "碗沿上是一圈绿：北边巍峨山，东边大顶岭和公明水库，南边大雁山，西南五指耙。规划把它叫作“生态绿环”。城市只能长在这圈绿的里面。",
      source: "规划原文：《分区规划》第24条“一环”；图01、图06",
      layers: BARE,
      paint: (c, toPixel) => fill(c, toPixel, greenAreas.flatMap(rings), "rgba(84,158,92,0.62)"),
      camera: overview,
      labels: greenAreas.map((f) => { const [x, z] = centroid(rings(f)[0] ?? [[0, 0]]); return { text: greenNames[String(f.properties.id)] ?? String(f.properties.name), x, z }; }),
      buildings: "none",
      motion: breathe(overview.distance),
    },
    {
      id: "controls", act: "第一幕 · 山水定形", title: "1-3 · 能盖房子的地",
      question: "盆地里哪些地方不能建？",
      body: "碗里也不是哪儿都能建。深绿的是生态保护红线，约 24.9 平方公里，占全区约 16%；黄色是永久基本农田，不少于 8.82 平方公里；红色虚线圈出的是城镇开发边界，约占全区 56%。能用来盖房子的地，大约一半多一点。",
      source: "规划原文：第18–20条；图02。范围为图集示意配准（C 级）",
      layers: BARE,
      paint: (c, toPixel, m) => {
        const areas = features("constraintAreas");
        const development = areas.filter((f) => f.properties.kind === "development").flatMap(rings);
        fill(c, toPixel, development, "rgba(222,96,82,0.10)");
        fill(c, toPixel, areas.filter((f) => f.properties.kind === "farmland").flatMap(rings), "rgba(240,206,72,0.78)");
        fill(c, toPixel, areas.filter((f) => f.properties.kind === "ecological_redline").flatMap(rings), "rgba(38,118,68,0.80)");
        for (const ring of development) stroke(c, toPixel, [...ring, ring[0]], "rgba(214,82,70,0.95)", Math.max(3, 45 * m), [Math.max(6, 160 * m), Math.max(4, 100 * m)]);
      },
      camera: overview, labels: [],
      buildings: "none",
      motion: breathe(overview.distance),
    },
    {
      id: "river", act: "第一幕 · 山水定形", title: "1-4 · 一条河分开两岸",
      question: "是什么把盆地分成两半？",
      body: "一条河从南往北，穿过盆地正中，这就是茅洲河。它流到北边折向西，从那个敞开的口子流出去。这条河把光明分成两半：西岸是公明，东岸是光明。后面的故事，都和这两岸有关。",
      source: "规划原文：第21条“一脉”；现状：OSM 河道",
      layers: BARE,
      paint: (c, toPixel) => tintBanks(c, toPixel, "rgba(226,120,90,0.16)", "rgba(90,140,220,0.14)"),
      camera: north(riverMid[0], riverMid[1] + 600, 19000, 52),
      labels: [{ text: "西岸 · 公明", x: riverMid[0] - 3500, z: riverMid[1] }, { text: "东岸 · 光明", x: riverMid[0] + 4500, z: riverMid[1] }],
      buildings: "none",
      motion: breathe(19000, 12),
      anim: "river",
    },
    {
      id: "alluvial", act: "第一幕 · 山水定形", title: "1-5 · 水铺出来的平原",
      question: "西岸的平地是怎么来的？",
      body: "河流到碗口就慢了，泥沙一层层落下来，落成一片平原。这片平原就是西岸。它朝着松岗敞开，也朝着东莞和珠江口敞开。",
      source: "示意：沉积范围按沙盘高程与距河远近推绘，不是古地貌复原",
      layers: BARE, paint: null, labels: [],
      camera: westView,
      buildings: "none",
      motion: breathe(westView.distance, 14, 0.96),
      anim: "alluvial",
    },
    {
      id: "watershed", act: "第一幕 · 山水定形", title: "1-6 · 一条没有源头的河",
      question: "茅洲河是怎么变成今天这样的？",
      body: "那时候的茅洲河，水从羊台山下来，一路流过石岩、光明，从沙井入海。1960 年，上游修起了石岩水库，羊台山的水大多留在库里，送进了城市的水管。茅洲河从此成了一条没有源头的河。2016 年，迳口背后的山谷也蓄满了水，成了公明水库。",
      source: "石岩水库截断上游：读特《茅洲河“回来”了！》；公明水库：羊城派。地形 SRTM 2000；流域与河网为地形推算；石岩水库蓄水为示意",
      layers: BARE, paint: null, labels: [],
      camera: overview,
      buildings: "none",
      watershed: true,
    },
    // ===================== 第二幕 · 两个起点 =====================
    {
      id: "migration", act: "第二幕 · 两个起点", title: "2-1 · 人从西口进来",
      question: "最早的人从哪里来？",
      body: "人也是从这个口子进来的。族谱往上翻，多半翻到南雄珠玑巷，再经东莞南下。北宋，莫氏到了玉律；明永乐年间，麦氏到了合水口；正统年间，陈氏到了楼村；明嘉靖年间，钟氏从东莞寮步搬到了东坑。东岸大顶岭脚下的迳口，据记载是黄氏从福建迁来开的。",
      source: "story-places.json（各村来源见 reports/story-data/README.md）；来路为叙事示意，非真实路线",
      layers: BARE, paint: null, labels: [],
      camera: migrationView,
      buildings: "none",
      motion: breathe(migrationView.distance, 18, 0.96),
      anim: "migration",
    },
    {
      id: "heshuikou", act: "第二幕 · 两个起点", title: "2-2 · 合水口",
      question: "老村子为什么落在这里？",
      body: "合水口，是几条溪在村前汇到一起、再一起流进茅洲河的地方。明永乐二十一年，麦氏在这里开村。村前一口塘，村后一丛竹，人家坐在比河滩高出几米的台地上。",
      source: "地名由来、麦氏开村：新浪、搜狐报道（合水口村）；合水口河、茅洲河：OSM；四周汇流线为地形坡降推算的示意",
      layers: BARE, paint: null, labels: [],
      camera: north(placePt("village-heshuikou", oldMarket)[0] + 400, placePt("village-heshuikou", oldMarket)[1] - 300, 13000, 56),
      buildings: "none",
      motion: { kind: "push", toDistance: 11500, seconds: 16 },
      anim: "heshuikou",
    },
    {
      id: "wind", act: "第二幕 · 两个起点", title: "2-3 · 风从口子进来",
      question: "为什么偏偏是这里？",
      body: "村前一口塘，村后一丛竹，人家坐在比河滩高出几米的台地上。夏天的南风从西边的口子吹进来，先到这里。",
      source: "风向：光明科学城气候可行性论证报告（广东省气候中心，2020），夏季以南风、西南风为主；流线为示意，非数值模拟",
      layers: BARE, paint: null, labels: [],
      camera: westView,
      buildings: "none",
      motion: breathe(westView.distance, 12, 0.96),
      anim: "wind",
    },
    {
      id: "flood", act: "第二幕 · 两个起点", title: "2-4 · 水也从这里来",
      question: "老村子为什么都坐在台地上？",
      body: "洪水也从这里来。到今天，公明西部仍是全区最容易被淹的地方之一。老辈人讲风水，讲的其实就是这几米。",
      source: "《光明区国土空间分区规划（2021—2035）》第 9 条（洪涝高风险区）；范围为示意描绘，不作风险判定",
      layers: BARE, paint: null, labels: [],
      camera: westView,
      buildings: "none",
      motion: breathe(westView.distance, 13, 0.96),
      anim: "flood",
    },
    {
      id: "gongming", act: "第二幕 · 两个起点", title: "2-5 · 西岸：老墟和工业镇",
      question: "西岸是从哪里长起来的？",
      body: "先说西岸。公明墟从明清就有了，1931 年定名“公明”，很长时间里都是这一带的中心，深圳现存唯一的骑楼街就在这里。改革开放以后，工厂一家家开进来，厂房和村子连成一片，公明成了一个工业镇。",
      source: "已核实：公明街道·维基百科；光明区政府访谈。规划原文：前言“工业镇”。建筑生长顺序为示意",
      layers: { ...OLD_TOWN, landmarks: true },
      paint: (c, toPixel) => tintBanks(c, toPixel, "rgba(226,120,90,0.16)", "rgba(0,0,0,0)"),
      focus: { x: oldMarket[0], z: oldMarket[1], radius: 1800 },
      camera: north(oldMarket[0] + 600, oldMarket[1] + 900, 11000, 46),
      labels: [{ text: "公明老墟", x: oldMarket[0], z: oldMarket[1] }],
      buildings: "west-grow",
      motion: { kind: "push", toDistance: 8000, seconds: 10 },
    },
    {
      id: "farm", act: "第二幕 · 两个起点", title: "2-6 · 东岸：一座农场",
      question: "河对岸那时候是什么样？",
      body: "东岸在 1958 年拐了弯。省里在这里办了一座农场，专供香港。当地人本想叫它“公明农场”，筹备组取了“光荣任务”的光，配上公明的明，定名“光明”。地是国家的，哪个村也不能拿去盖厂。西岸厂房长满的那些年，东岸还是田和牧场，迳口这样的老村被围在中间，像一座座岛。",
      source: "光明农场命名：深圳新闻网《百年党史·光明足迹》；农场范围为示意（story-areas.geojson），不是 1958 年测绘边界",
      layers: OLD_TOWN,
      paint: null,
      camera: farmView,
      labels: places["farm-hq"] ? [{ text: "光明农场场部（示意位置）", x: places["farm-hq"].x, z: places["farm-hq"].z }] : [],
      buildings: "west",
      motion: breathe(farmView.distance, 12, 0.96),
      anim: "farm",
    },
    {
      id: "district", act: "第二幕 · 两个起点", title: "2-7 · 从镇到区",
      question: "两岸是怎么成了一个区的？",
      body: "2007 年，深圳把公明、光明两个街道从宝安划出来，成立光明新区；2018 年，国务院批复设立光明区。今天它下辖光明、公明、新湖、凤凰、玉塘、马田 6 个街道。有了区，就得有路。接下来看看，路是怎么接进来的。",
      source: "已核实：维基百科·光明区；21 财经",
      layers: OLD_TOWN,
      paint: null,
      camera: overview,
      labels: ["street-guangming", "street-gongming", "street-xinhu", "street-fenghuang", "street-yutang", "street-matian"].filter((id) => places[id]).map((id) => ({ text: places[id].name, x: places[id].x, z: places[id].z })),
      buildings: "west",
      motion: breathe(overview.distance),
    },
    // ===================== 第三幕 · 路到哪里，城长到哪里 =====================
    {
      id: "longda", act: "第三幕 · 路到哪里，城长到哪里", title: "3-1 · 龙大高速（2005）",
      question: "第一条从外面接进来的路是哪条？",
      body: "第一条接进来的，是龙大高速。它从龙华出发，斜着穿过光明的东侧，一路往北，到东莞大岭山。深圳段 2005 年通车，在光明设了出入口，接上城里的光明大道和观光路。",
      source: "已核实：维基百科·龙大高速；深圳政府在线",
      layers: { ...OLD_TOWN, expressways: true },
      paint: null,
      camera: longdaView,
      labels: [],
      buildings: "west",
      motion: breathe(longdaView.distance, 13, 0.97),
      grow: { expressways: { longda: 11 } },
      hidden: { expressways: ["nanguang"] },
      roadCaption: { road: "longda", name: "龙大高速", from: "龙华", to: "东莞大岭山" },
    },
    {
      id: "nanguang", act: "第三幕 · 路到哪里，城长到哪里", title: "3-2 · 南光高速（2008）",
      question: "光明和南山是怎么连上的？",
      body: "三年后，2008 年，南光高速通车。它从南山西丽出发，往北穿过石岩进入光明，沿着西边一直到宝安松岗，全长 31 公里。光明去南山，从此有了一条直通的高速；它在光明境内大约四成是高架。",
      source: "已核实：百度百科·南光高速；本项目计算：OSM 桥梁占比",
      layers: { ...OLD_TOWN, expressways: true },
      paint: null,
      camera: nanguangView,
      labels: [],
      buildings: "west",
      motion: breathe(nanguangView.distance, 13, 0.97),
      grow: { expressways: { nanguang: 11 } },
      roadCaption: { road: "nanguang", name: "南光高速", from: "南山西丽", to: "宝安松岗" },
    },
    {
      id: "avenue", act: "第三幕 · 路到哪里，城长到哪里", title: "3-3 · 光明大道",
      question: "两条高速之间，城市是怎么长起来的？",
      body: "两条高速，一条在西，一条在东。把它们连起来的，是光明大道：西头接南光，东头接上龙大的出入口。路通到哪里，房子就长到哪里。顺着光明大道，东岸的厂房、小区和学校，一片一片长了出来。",
      source: "已核实：龙大高速出入口接光明大道（维基百科·龙大高速）。光明大道建成年份待核实；生长顺序为示意，不代表建成年代",
      layers: { ...OLD_TOWN, expressways: true, roads: true },
      paint: null,
      camera: avenueView,
      labels: [],
      buildings: "avenue-grow",
      // 镜头不动方向，只慢慢推近；整条大道和两侧的生长都在画面里
      motion: breathe(avenueView.distance, growth.avenueSeconds + 12, 0.94),
      roadCaption: { road: "avenue", name: "光明大道", from: "南光高速", to: "龙大高速" },
    },
    {
      id: "csot", act: "第三幕 · 路到哪里，城长到哪里", title: "3-4 · 第一个产业锚点",
      question: "新区靠什么起步？",
      body: "这些新长出来的地方里，有一个关键的起点。2009 年，TCL 和深圳合资成立华星光电，总投资 245 亿元；2011 年，第 8.5 代液晶面板线在凤凰街道投产。新区就是靠这样的大项目起的步。",
      source: "已核实：维基百科·华星光电。（厂区轮廓待接入）",
      layers: { ...ALL_ON, metro: false, hsr: false },
      paint: null,
      focus: csot ? { x: csot[0], z: csot[1], radius: 900 } : undefined,
      camera: north((csot ?? fenghuang)[0], (csot ?? fenghuang)[1] + 400, 7000, 46),
      labels: csot ? [{ text: "华星光电 T1", x: csot[0], z: csot[1] }] : [],
      motion: { kind: "push", toDistance: 5000, seconds: 9 },
    },
    {
      id: "contrast", act: "第三幕 · 路到哪里，城长到哪里", title: "3-5 · 西密东空",
      question: "两个起点留下了什么？",
      body: "现在回头看两岸，差别一眼就能看出来。西岸开发边界内的建筑密度，大约是东岸的 1.7 倍，连续成片；东岸是一个个村子像岛一样散着，还有大约 28% 的格子是空地。也正因为东岸的地块完整，后来的新中心，都放在了东岸。",
      source: "本项目计算：V1 建筑肌理分析（reports/v1-west-east）",
      layers: { ...ALL_ON, metro: false, hsr: false, trees: false, landmarks: false },
      paint: (c, toPixel, m) => { tintBanks(c, toPixel, "rgba(226,120,90,0.14)", "rgba(90,140,220,0.12)"); for (const l of river) stroke(c, toPixel, l, "rgba(40,150,210,0.9)", Math.max(3, 90 * m)); },
      camera: north(riverMid[0], riverMid[1] + 1200, 16000, 52),
      labels: [{ text: "西岸：连续细密", x: riverMid[0] - 3000, z: riverMid[1] }, { text: "东岸：村落岛 + 大地块 + 留白", x: riverMid[0] + 4200, z: riverMid[1] }],
      motion: breathe(16000),
    },
    {
      id: "hsr", act: "第三幕 · 路到哪里，城长到哪里", title: "3-6 · 两条高铁交汇光明城（2011 / 2021）",
      question: "高铁从哪里进入深圳？",
      body: "再往后是高铁。2011 年广深港高铁开通，2021 年赣深高铁接进来，两条线在光明城交汇。从北边来的高铁，进了深圳先到光明城；下一站是深圳北，大约 16 公里，再往南就是福田和香港西九龙。",
      source: "已核实：维基百科·光明城站",
      layers: { ...ALL_ON, metro: false },
      paint: null,
      focus: { x: guangmingcheng[0], z: guangmingcheng[1], radius: 1100 },
      camera: north(guangmingcheng[0] - 1500, guangmingcheng[1] - 1500, 17000, 52),
      labels: [{ text: "↓ 深圳北 · 福田 · 香港西九龙", x: guangmingcheng[0] + 600, z: guangmingcheng[1] + 2600 }, { text: "↑ 东莞", x: guangmingcheng[0] - 2500, z: guangmingcheng[1] - 6000 }],
      motion: breathe(17000, 14),
      grow: { hsr: 12 },
    },
    {
      id: "line6", act: "第三幕 · 路到哪里，城长到哪里", title: "3-7 · 6 号线（2020）",
      question: "第一条地铁是怎么走的？",
      body: "2020 年 8 月，6 号线开通。跟着这列车走：它从龙华方向开过来，进光明的第一站是长圳，然后是凤凰城、光明大街、光明、科学公园，再一路向西，经过楼村、红花山，到公明广场，往松岗去。东西两岸，第一次用轨道连了起来。",
      source: "已核实：维基百科·深圳地铁6号线",
      layers: transit,
      metroLines: { "6": true, "6b": false, "13": false },
      paint: null,
      camera: lineView("6"),
      labels: [],
      motion: breathe(lineView("6").distance, 16),
      grow: { metro: [{ line: "6", seconds: 15 }] },
      stationFocus: ["6"],
    },
    {
      id: "line6b", act: "第三幕 · 路到哪里，城长到哪里", title: "3-8 · 6 号线支线（2022 / 2025）",
      question: "支线连向哪里？",
      body: "6 号线支线分两次开通：2022 年先开了北边一段，2025 年往南接到光明城站，和高铁连上。现在从光明城往北，经过虹桥公园、光明、中大，到深理工。它的北端还预留了和东莞 1 号线直通，将来可以开到松山湖。",
      source: "已核实：维基百科·6号线支线；东莞时间网",
      layers: transit,
      metroLines: { "6": true, "6b": true, "13": false },
      paint: null,
      camera: lineView("6b"),
      labels: metroPath("6b").length ? [{ text: "↑ 东莞 1 号线 · 松山湖（预留直通）", x: metroPath("6b")[0][0], z: metroPath("6b")[0][1] - 1500 }] : [],
      motion: breathe(lineView("6b").distance, 13),
      grow: { metro: [{ line: "6b", seconds: 12 }] },
      stationFocus: ["6b"],
    },
    {
      id: "line13", act: "第三幕 · 路到哪里，城长到哪里", title: "3-9 · 13 号线北延（2026）",
      question: "光明怎么坐地铁直达南山？",
      body: "2026 年 6 月，13 号线北延开通，全程在地下。这列车从南山方向开过来，穿过石岩进入光明，经过光明城、凤凰城、公明广场，一直到李松蓢。贯通以后，从光明到深圳湾口岸大约 45 分钟。规划里，它还要继续往北，对接东莞 5 号线。",
      source: "已核实：澎湃新闻；腾讯新闻",
      layers: transit,
      metroLines: allLines,
      paint: null,
      camera: lineView("13"),
      labels: [{ text: "↓ 南山 · 深圳湾口岸（约 45 分钟）", x: guangmingcheng[0] + 300, z: guangmingcheng[1] + 2800 }],
      motion: breathe(lineView("13").distance, 16),
      grow: { metro: [{ line: "13", seconds: 15 }] },
      stationFocus: ["13"],
    },
    {
      id: "fenghuang", act: "第三幕 · 路到哪里，城长到哪里", title: "3-10 · 交汇处长出中心：凤凰城",
      question: "今天最成熟的中心在哪里？",
      body: "两条地铁、光明大道、观光路，在凤凰城交汇。区政府在这里；凤凰城站两侧，是蓝鲸世界（2021）和万达广场（2022）；旁边是光明文化艺术中心。线路交汇的地方，先长出了中心。凤凰城是新区第一个成熟起来的片区。",
      source: "已核实：经济参考报；深圳新闻网。本项目计算：6 号线与光明大道在凤凰城交汇",
      layers: { ...ALL_ON },
      metroLines: allLines,
      paint: null,
      focus: { x: fenghuang[0], z: fenghuang[1], radius: 1300 },
      camera: north(fenghuang[0], fenghuang[1] + 400, 6500, 44),
      labels: places["district-government"] ? [{ text: "光明区政府", x: places["district-government"].x, z: places["district-government"].z }] : [],
      motion: { kind: "push", toDistance: 4200, seconds: 10 },
    },
    // ===================== 第四幕 · 往东走 =====================
    {
      id: "center", act: "第四幕 · 往东走", title: "4-1 · 一心：跨河的双核",
      question: "规划把下一个中心放在哪里？",
      body: "可规划没有把下一个中心放在凤凰城。规划里的“一心”，以茅洲河中央水岸为锚，把东岸的光明中心区和西岸的公明中心区连在一起。今天最成熟的是凤凰城，规划里的未来核心，是光明中心区。",
      source: "规划原文：第24条“一心”；图01",
      layers: { ...ALL_ON }, metroLines: allLines,
      paint: (c, toPixel, m) => {
        for (const l of river) stroke(c, toPixel, l, "rgba(40,150,210,0.6)", Math.max(3, 80 * m));
        for (const f of features("structureCenterRing")) stroke(c, toPixel, line(f), "rgba(232,92,60,0.95)", Math.max(5, 110 * m), [Math.max(8, 260 * m), Math.max(5, 140 * m)]);
        for (const center of centers) { const [px, py] = toPixel(...center.p); c.fillStyle = "rgba(236,104,62,0.55)"; c.beginPath(); c.arc(px, py, Math.max(10, 650 * m), 0, Math.PI * 2); c.fill(); }
      },
      focus: { x: coreMid[0], z: coreMid[1], radius: 2600 },
      camera: north(coreMid[0], coreMid[1] + 900, 12500, 48),
      labels: [{ text: "公明中心区", x: gongming[0], z: gongming[1] }, { text: "光明中心区", x: guangming[0], z: guangming[1] }, { text: "茅洲河中央水岸", x: coreMid[0], z: coreMid[1] + 900 }, { text: "凤凰城（今天的中心）", x: fenghuang[0], z: fenghuang[1] }],
      motion: breathe(12500),
    },
    {
      id: "science-park", act: "第四幕 · 往东走", title: "4-2 · 围着科学公园的公共投资",
      question: "未来的核心里，正在建什么？",
      body: "光明中心区里，正在发生的事情都围着科学公园。公园约 2 平方公里，北翼 2024 年开放；深圳科学技术馆 2025 年 5 月开馆，深圳国际美术馆 2026 年 5 月开馆。规划还在这里留了一座城际枢纽站。",
      source: "已核实：中建四局；人民网；新华网。规划原文：第81、88条",
      layers: { ...ALL_ON }, metroLines: allLines,
      paint: null,
      focus: { x: scienceMuseum[0] - 300, z: scienceMuseum[1] - 300, radius: 1500 },
      camera: north(scienceMuseum[0] - 300, scienceMuseum[1] + 100, 5600, 44),
      labels: [],
      motion: { kind: "push", toDistance: 3600, seconds: 10 },
    },
    {
      id: "zones", act: "第四幕 · 往东走", title: "4-3 · 北边科学，南边制造",
      question: "其他功能放在哪里？",
      body: "再拉远看功能怎么分。北边是大科学装置引领区，有大科学装置、中山大学深圳校区、深圳理工大学；西边和南边是先进制造业，凤凰、玉塘、马田、公明都在这一片。一条龙大科技创新走廊斜穿东西，一条茅洲河活力走廊南北贯穿。",
      source: "规划原文：第24、57、63条；图01。色块为示意范围",
      layers: { ...BARE, buildings: true, fill: true, landmarks: true },
      paint: (c, toPixel, m) => {
        const colors: Record<string, string> = { science: "rgba(226,96,160,0.42)", manufacturing: "rgba(92,150,226,0.38)", service: "rgba(246,176,62,0.42)" };
        for (const f of features("structureAreas")) fill(c, toPixel, rings(f), colors[String(f.properties.kind)] ?? "rgba(200,200,200,0.3)");
        for (const f of features("structureAxes")) {
          const path = line(f);
          const color = f.properties.kind === "water_axis" ? "rgba(36,160,170,0.92)" : "rgba(222,78,150,0.92)";
          stroke(c, toPixel, path, color, Math.max(6, 220 * m));
          if (path.length >= 2) arrowHead(c, toPixel, path, color, Math.max(12, 420 * m));
        }
      },
      camera: overview,
      labels: structureLabels.filter((f) => f.properties.kind !== "center_ring").map((f) => { const [x, z] = point(f); return { text: String(f.properties.shortName ?? f.properties.name), x, z }; }),
      motion: breathe(overview.distance),
    },
    {
      id: "east", act: "第四幕 · 往东走", title: "4-4 · 人和钱，都在往东走",
      question: "未来往哪里长？",
      body: "规划写得很直白：“引导常住人口向茅洲河以东地区集聚，稳定茅洲河以西地区人口规模”。东岸划了光明中心区、茅洲河中央水岸等 5 个重点片区；轨道还要形成 6、6 支、13、18、26、29 号线“两横四纵”的格局。",
      source: "规划原文：第50、117条；已核实：光明区政府（两横四纵）。“规划示意”图层为效果图重建",
      layers: { ...ALL_ON, planned: true }, metroLines: allLines,
      paint: (c, toPixel, m) => {
        tintBanks(c, toPixel, "rgba(0,0,0,0)", "rgba(90,180,140,0.16)");
        for (const l of river) stroke(c, toPixel, l, "rgba(40,150,210,0.7)", Math.max(3, 80 * m));
        const arrow: Pt[] = [[riverMid[0] - 2600, riverMid[1] - 600], [riverMid[0] + 2600, riverMid[1] - 600]];
        stroke(c, toPixel, arrow, "rgba(60,150,110,0.9)", Math.max(6, 200 * m));
        arrowHead(c, toPixel, arrow, "rgba(60,150,110,0.9)", Math.max(12, 450 * m));
      },
      focus: { x: riverMid[0] + 3800, z: riverMid[1] - 800, radius: 3000 },
      camera: north(riverMid[0] + 2500, riverMid[1] + 1200, 17000, 50),
      labels: [{ text: "人口向东岸集聚（第50条）", x: riverMid[0] + 3000, z: riverMid[1] - 1400 }],
      motion: breathe(17000),
    },
    // ===================== 结语 =====================
    {
      id: "ending", act: "结语", title: "结语",
      question: "光明是怎么长成今天这样的？",
      body: "回头看一遍：山水划定了光明能长在哪里；两个起点，决定了两岸长成什么样；路和轨道交汇的地方，长出了今天的中心；而规划把下一个中心放在了东岸。现有的规划决定了板块，未来的方向，决定了基建往哪里投。",
      source: "综合以上各拍",
      layers: { ...ALL_ON }, metroLines: allLines,
      paint: null, camera: overview, labels: [],
      motion: breathe(overview.distance, 14),
    },
  ];
}
