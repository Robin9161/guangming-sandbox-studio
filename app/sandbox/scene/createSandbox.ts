import * as THREE from "three/webgpu";
import { abs, cameraFar, cameraNear, clamp, perspectiveDepthToViewZ, smoothstep, unpackRGBToNormal, packNormalToRGB, dot, float, mix, mrt, normalView, output, pass, sample, screenUV, uniform, vec2, vec3, vec4 } from "three/tsl";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { bloom as bloomNode } from "three/examples/jsm/tsl/display/BloomNode.js";
import { gaussianBlur } from "three/examples/jsm/tsl/display/GaussianBlurNode.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { createAtmosphere, createGrade, glowColor, glowFromVertexColor } from "./atmosphere";
import { createVolumeFog } from "./volumeFog";
import { upgradeWater } from "./waterGpu";
import { createFloodSim } from "./floodSim";
import { buildBuildings } from "./buildings";
import { buildClouds, buildTrees } from "./decor";
import { buildBoundaryLine, buildExpressways, buildRoads, buildWater, expresswayGrowth, roadGrowth } from "./features";
import { growUniforms } from "./buildings";
import { hsrGrowth } from "./highSpeed";
import { buildHighSpeed } from "./highSpeed";
import { createHongqiaoBridge, type HongqiaoData } from "../../terrain/hongqiao-bridge";
import { projectLngLat } from "./landmarks";
import { buildLandmarkModules } from "./landmarkModules";
import { buildStory, type BuildingStage, type StoryPlaces, type StoryStep } from "./story";
import { AVENUE_ALONG_SPEED, buildGrowthPlan, cumulative, pointAt } from "./growthPlan";
import { buildShenzhenContext, type ShenzhenContextData } from "../context/shenzhenContext";
import { buildShenzhenTerrain, type ShenzhenTerrainMeta } from "../context/shenzhenTerrain";
import { buildShenzhenOverlay } from "../context/shenzhenOverlay";
import { createHeshuikouAnim } from "./anim/heshuikou";
import { buildWatershedView, type WatershedData } from "./watershed";
import { createAlluvialPlainAnim, createFarmAnim, createFloodAnim, createMigrationAnim, createRiverFlowAnim, createWindAnim, type HistoryContext } from "../anim/history";
import { createStageLight } from "./stageLight";
import { nightUniform } from "./atmosphere";
import { buildMetro } from "./metro";
import { exaggerate, night, water as waterStyle } from "./palette";
import { buildTerrain } from "./terrain";
import { buildCityLight, litByStreetLamps } from "./nightLight";
import { buildCityDots } from "./cityDots";
import { createWeather, weatherState, type WeatherKind } from "./weather";
import { addWeatherShading, weatherShadingUniforms } from "./weatherShading";
import { pairs, type LayerKey, type SandboxData, type ViewKey } from "./types";

export type LabelClasses = { landmark: string; station: string; water: string; poi: string; story: string; roadName: string; roadEnd: string; lit: string };

export type SandboxHandle = {
  setLayer: (layer: LayerKey, visible: boolean) => void;
  setEffects: (enabled: boolean) => void;
  setNight: (on: boolean) => void;
  /** 光影模式（借鉴《无尽动画》的配色系统）：连续的一天、太阳移动、雾 = 地平线色、全局调色 */
  setArt: (on: boolean) => void;
  setHour: (hour: number) => void;
  getHour: () => number;
  setPlaying: (on: boolean) => void;
  /** 日出日落氛围：artPalette.MOODS 的下标，null = 每天随机 */
  setMood: (index: number | null) => void;
  /** 天气（光影模式）："auto" 为自动 */
  setWeather: (kind: "auto" | WeatherKind) => void;
  getWeather: () => { mode: "auto" | WeatherKind; name: string };
  getMood: () => number;
  isArtNight: () => boolean;
  /** 讲解剧本：步骤元数据，以及切换到某一步（null 退出讲解） */
  story: (Pick<StoryStep, "id" | "title" | "question" | "body" | "source" | "layers" | "act"> & { seconds: number })[];
  setStoryStep: (index: number | null) => void;
  /** 自动演示时让镜头缓慢环绕 */
  setAutoOrbit: (on: boolean) => void;
  setView: (view: ViewKey) => void;
  flyToLandmark: (name: string) => void;
  stats: { buildings: number; buildingsWithHeight: number; fillBuildings: number; buildingSources: Record<string, number>; trees: number; trains: number; elevatedKm: number; undergroundKm: number };
  landmarks: string[];
  /** 主干道脉络（scripts/analysis/arterials.mjs 的结果） */
  arterials: { id: string; name: string; lengthKm?: number; found: boolean; group: string }[];
  /** 显示主干道：all = 全部；某条 id = 只看这一条（标出起止）；null = 关闭 */
  showArterials: (id: string | null) => void;
  /** 地势视图：按原始海拔分色，标出老村落海拔和洪涝范围 */
  showTerrainView: (on: boolean) => void;
  /** 西岸时间线：玉律 → 合水口 → 麦氏大宗祠 → 公明墟（合水口与上村之间），按年代编号、标海拔和离河高差 */
  showWestTimeline: (on: boolean) => void;
  /** 茅洲河流域视图：从羊台山到沙井入海口的整块地形 + 地形推算的河网（首次打开时加载数据） */
  showWatershed: (on: boolean) => Promise<void>;
  dispose: () => void;
};

type ArterialRoad = { id: string; name: string; given: string; group: string; found: boolean; lengthKm?: number; endRoads?: string[][]; line?: [number, number][]; touchesNanguang?: boolean; touchesLongda?: boolean };
/** 主干道配色：光明大道用最醒目的红橙，其余按色相错开 */
const ARTERIAL_COLORS: Record<string, string> = {
  guangming: "#e8553b", guangqiao: "#2f7fd8", "gm-north": "#8a5cc8", "gm-east": "#b66ab0", "gm-south": "#c27ba0", "gm-west": "#9d7fd6",
  shuangming: "#d39a2a", zhoujia: "#3aa58c", dongming: "#5fb34a", kexue: "#e0a020", gongyuan: "#999999", guanghui: "#1fa6b8",
};

const STATION_LABEL_DISTANCE = 9000;
const WATER_LABEL_DISTANCE = 16000;

/** 全深圳叠加层里高亮的区名（以 shenzhen-context.json 为准）；前海不在该文件的区列表里 */
const DISTRICT_NAMES: Record<string, string> = { guangming: "光明区", nanshan: "南山区", futian: "福田区", luohu: "罗湖区", yantian: "盐田区", baoan: "宝安区", longhua: "龙华区", longgang: "龙岗区", pingshan: "坪山区", dapeng: "大鹏新区", qianhai: "前海" };

export async function createSandbox(mount: HTMLElement, labelClasses: LabelClasses, onFlyTo?: (name: string) => void, district = "guangming"): Promise<SandboxHandle> {
  // 一次只讲一个区：光明走原路径，其他区数据在 /sandbox/districts/<id>/；光明专属资源（地标、虹桥、讲解、主干道）其他区不加载
  const isGM = district === "guangming";
  const base = isGM ? "/sandbox" : `/sandbox/districts/${district}`;
  const gmOnly = <T,>(load: () => Promise<T>) => (isGM ? load() : Promise.resolve(null));
  const [data, demBuffer, hongqiaoData, placesFile, contextData, arterialFile, storyAreas, szTerrain] = await Promise.all([
    fetch(`${base}/sandbox.json`).then((response) => response.json() as Promise<SandboxData>),
    fetch(`${base}/dem.bin`).then((response) => response.arrayBuffer()),
    // 虹桥：复用 /terrain 页已有的红桥模型与 OSM 走向数据（scripts/build-hongqiao-bridge.mjs）
    gmOnly(() => fetch("/terrain/hongqiao-bridge.json").then((response) => (response.ok ? (response.json() as Promise<HongqiaoData>) : null)).catch(() => null)),
    // 讲解地点（其他 AI 交付，可缺省）
    gmOnly(() => fetch("/sandbox/story/story-places.json").then((response) => (response.ok ? response.json() : null)).catch(() => null) as Promise<{ places?: { id: string; name: string; x: number; z: number; verified?: boolean; era?: string; clan?: string }[] } | null>),
    // 深圳全图（开场用，其他 AI 交付，可缺省）
    fetch("/sandbox/shenzhen/shenzhen-context.json").then((response) => (response.ok ? (response.json() as Promise<ShenzhenContextData>) : null)).catch(() => null),
    // 主干道脉络分析结果（可缺省）
    gmOnly(() => fetch("/sandbox/arterials.json").then((response) => (response.ok ? response.json() : null)).catch(() => null) as Promise<{ roads: ArterialRoad[] } | null>),
    // 讲解用的历史范围（农场、洪涝等，其他 AI 交付，可缺省）
    gmOnly(() => fetch("/sandbox/story/story-areas.geojson").then((response) => (response.ok ? response.json() : null)).catch(() => null) as Promise<HistoryContext["areas"] | null>),
    // 全深圳地形（开场用，scripts/sandbox/build-shenzhen-terrain.mjs，可缺省）
    Promise.all([
      fetch("/sandbox/shenzhen/terrain/terrain.json").then((r) => (r.ok ? (r.json() as Promise<ShenzhenTerrainMeta>) : null)),
      fetch("/sandbox/shenzhen/terrain/dem.bin").then((r) => (r.ok ? r.arrayBuffer() : null)),
      fetch("/sandbox/shenzhen/terrain/sea.bin").then((r) => (r.ok ? r.arrayBuffer() : null)),
    ]).then(([meta, dem, sea]) => (meta && dem && sea ? { meta, dem, sea } : null)).catch(() => null),
  ]);
  const dem = new Int16Array(demBuffer);

  // ---------- 渲染器 ----------
  // WebGPU 优先；不支持的浏览器（或 ?webgl=1）自动用 WebGL2 后端，同一套节点材质
  const forceWebGL = new URLSearchParams(window.location.search).has("webgl");
  const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: "high-performance", forceWebGL });
  await renderer.init();
  const isSmall = mount.clientWidth < 768;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  mount.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  mount.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();

  // ---------- 场景内容 ----------
  // 有全深圳地形时：光明主地形走无缝模式（不要圆角底座，四周交给全深圳地形）
  const SEAM_MARGIN = 300;
  const terrain = buildTerrain(data, dem, { seamless: !!szTerrain, margin: SEAM_MARGIN });
  // 夜景灯光分布：路灯图（按道路等级）+ 活跃度图（按建筑类型），路面、地面、树、建筑共用
  const cityLight = buildCityLight(data, terrain.bounds);
  const { minX, maxX, minZ, maxZ } = terrain.bounds;
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  // 精细地标（app/sandbox/landmarks/ 各模块）先建，用它们的实际占地移除下方的普通白模
  const landmarks = buildLandmarkModules(data, terrain, district);
  // 生长计划：讲解里城市长出来的顺序（西岸老城 → 光明大道），建筑、道路、高速、地铁共用
  const growth = buildGrowthPlan(data);
  const { mesh: buildings, fillMesh, footprint } = buildBuildings(data, terrain, [], landmarks.occupied, growth.buildingDelays);
  /** 夜里亮起的彩色地标灯光（点睛用，少而真实）：材质的自发光强度跟着夜间系数走 */
  const landmarkGlows: { material: THREE.MeshStandardMaterial; strength: number }[] = [];
  if (hongqiaoData) {
    const toLocal = (p: [number, number]) => projectLngLat(data, p[0], p[1]);
    // 沙盘比例：桥面 5m → 12m（加宽），净空 8m → 9.6m（降到上一版的 80%），远看能认出这条红色长桥
    const bridge = createHongqiaoBridge(
      { ...hongqiaoData, meta: { ...hongqiaoData.meta, widthMeters: 12, nominalClearanceMeters: 9.6 } },
      (p) => { const [x, z] = toLocal(p); return new THREE.Vector3(x, 0, z); },
      (p) => { const [x, z] = toLocal(p); return terrain.heightAt(x, z); },
      (p) => { const [x, z] = toLocal(p); return terrain.inside(x, z); },
    );
    landmarks.group.add(bridge);
    // 虹桥夜里是一道红光：栏杆边缘最亮（勾出整条红飘带），桥面和桥墩微微透红
    const glowOf: Record<string, [string, number]> = { c3372d: ["#ff3a2c", 2.4], e27669: ["#ff4a3a", 0.4], bc4c3c: ["#d0362a", 0.22] };
    bridge.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      const glow = material?.color && glowOf[material.color.getHexString()];
      if (!material || !glow) return;
      material.emissive.set(glow[0]);
      material.emissiveIntensity = 0;
      landmarkGlows.push({ material, strength: glow[1] });
    });
    const [hx, hz] = toLocal([113.9552, 22.7486]);
    landmarks.placed.push({ name: "虹桥公园", position: new THREE.Vector3(hx, terrain.heightAt(hx, hz), hz), top: terrain.heightAt(hx, hz) + 20 });
  }
  const boundary = buildBoundaryLine(data, terrain);
  const metroSystem = buildMetro(data, terrain, growth.metroStarts);
  // 不种树的走廊：地铁两侧各约 20m；南光、龙大（加宽后的路堤/高架）两侧各约 35m
  const expresswayLines = data.roads.filter((road) => road.c === "motorway" && road.n && /南光|龙大/.test(road.n)).map((road) => pairs(road.p));
  // 虹桥桥面下方不种树（树冠会从桥面穿出来）
  const bridgeLines = hongqiaoData ? [...hongqiaoData.spans, ...(hongqiaoData.connections ?? [])].map((route) => route.coordinates.map((p) => projectLngLat(data, p[0], p[1]))) : [];
  const trees = buildTrees(data, terrain, footprint, landmarks.covered, [{ lines: bridgeLines, width: 28 }, { lines: metroSystem.corridors, width: 40 }, { lines: expresswayLines, width: 70 }]);
  const clouds = buildClouds(terrain);
  // 南光、龙大（含接入的匝道）单独表现，作为道路图层的一部分，跟随"道路"开关
const express = isGM
    ? buildExpressways(data, terrain, growth.expresswayOrigins)
    : buildExpressways(data, terrain, undefined, {
      names: district === "qianhai" ? /高速|西部通道侧接线/ : /高速/,
      replacements: district === "qianhai"
        ? (await import("../landmarks/qianhai/coastal-expressway")).coastalExpressways(data)
        : undefined,
    });
  // 道路"延伸"里程 = 光明大道生长延迟 × 1000：讲到光明大道时，大道先长，周边道路随建筑铺开
  const roads = buildRoads(data, terrain, express.consumed, (x, z) => growth.avenueDelay(x, z) * 1000);
  scene.add(express.group);
  const water = buildWater(data, terrain);
  const metro = metroSystem.group;
  const highSpeed = new THREE.Group();
  // 光明城站改由精细地标表现（landmarks.ts），这里只画高铁线路
  highSpeed.add(buildHighSpeed(data, terrain));
  // 深圳全图：地面在 y = -250，平时隐藏，只在开场显示
  // 有全深圳地形：地形 + 贴地的区界、地名；没有就退回平面全图
  const shenzhen = (() => {
    if (!contextData) return null;
    if (szTerrain) {
      // 全深圳地形常驻：在光明区界外 150 m 以内挖空，与光明主地形（铺到 300 m）重叠一圈，不露缝
      const { minX, maxX, minZ, maxZ } = terrain.extent;
      const holeTest = (x: number, z: number) => x > minX && x < maxX && z > minZ && z < maxZ && terrain.distanceOutside(x, z) < SEAM_MARGIN - 150;
      const terrainView = buildShenzhenTerrain(szTerrain.meta, szTerrain.dem, { sea: szTerrain.sea, holeTest });
      terrainView.setOpacity(1);
      scene.add(terrainView.group);
      // 区界和地名只在开场显示
      const overlay = buildShenzhenOverlay(contextData, terrainView.heightAt, terrainView.frame, isGM ? "光明区" : DISTRICT_NAMES[district] ?? district);
      return { group: overlay.group, setOpacity: overlay.setOpacity };
    }
    return buildShenzhenContext(contextData);
  })();
  if (shenzhen) { shenzhen.setOpacity(0); scene.add(shenzhen.group); }
  // 会动的地标（如摩天轮）：模块在 object.userData.tick(delta, elapsed) 里自己更新，这里只收集
  const landmarkTickers: ((delta: number, elapsed: number) => void)[] = [];
  landmarks.group.traverse((o) => { if (typeof o.userData.tick === "function") landmarkTickers.push(o.userData.tick); });
  let landmarkElapsed = 0;
  // 近景高精度：镜头离地标 < near 时懒加载 glb 并替换低精度模型，远了换回；背景仍是低精度场景
  const hdState = landmarks.hdSlots.map((slot) => ({ slot, model: null as THREE.Object3D | null, loading: false, failed: false }));
  const hdCheck = () => {
    for (const h of hdState) {
      const close = camera.position.distanceTo(h.slot.origin) < h.slot.near;
      if (close && !h.model && !h.loading && !h.failed) {
        h.loading = true;
        import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new GLTFLoader().loadAsync(h.slot.url)).then((gltf) => {
          const model = gltf.scene;
          model.position.copy(h.slot.origin);
          model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
          model.visible = false;
          landmarks.group.add(model);
          h.model = model;
        }).catch((error) => { console.warn(`hd ${h.slot.name} failed`, error); h.failed = true; }).finally(() => { h.loading = false; });
      }
      if (h.model) { h.model.visible = close; h.slot.low.visible = !close; }
    }
  };
  scene.add(terrain.group, boundary, landmarks.group, landmarks.plannedGroup, buildings, fillMesh, trees.group, clouds.group, roads, water, metro, highSpeed);

  // 无缝模式：区界外扩 300 m 以外的道路、水系、建筑、轨道都不画，交给全深圳地形
  for (const layer of [roads, water, express.group, highSpeed, metro, buildings, fillMesh]) {
    layer.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => terrain.maskMaterial(m));
    });
  }

  // 夜间发光：道路像路灯光带，轨道和站点按线路色发光
  const roadMaterial = roads.material as THREE.MeshStandardMaterial;
  const terrainMaterial = (scene.getObjectByName("terrain") as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
  const weather = createWeather(scene);
  // 夜里远处的暖色灯光点（近处隐去，交给窗户和剪影）
  const cityDots = buildCityDots(data, terrain);
  scene.add(cityDots);
  // 夜里：路灯只留一丝微光，隐约看出主干道走向（主干道 > 次干道，支路不亮）；画面主体是深蓝剪影和高楼的灯
  litByStreetLamps(roads.material as THREE.MeshStandardMaterial, 0.35);
  roads.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh !== roads && mesh.isMesh) litByStreetLamps(mesh.material as THREE.MeshStandardMaterial, 0.2); });
  const terrainSurface = scene.getObjectByName("terrain") as THREE.Mesh | undefined;
  if (terrainSurface) litByStreetLamps(terrainSurface.material as THREE.MeshStandardMaterial, 0.1);
  trees.group.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) litByStreetLamps(mesh.material as THREE.MeshStandardMaterial, 0.08); });
  glowColor(boundary.material as THREE.MeshStandardMaterial, "#fff1cf", 0.35);
  for (const [group, strength, dayStrength] of [[highSpeed, 0.12, 0]] as const) {
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mesh.isMesh || !material || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      if (material.vertexColors) glowFromVertexColor(material, strength, dayStrength);
      else if (mesh.name === "station-cap") glowColor(material, `#${material.color.getHexString()}`, 1.4);
    });
  }

  // ---------- 光照 ----------
  const hemi = new THREE.HemisphereLight("#cfe8ff", "#f3d9b0", 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#ffe2b8", 3.1);
  const sunDirection = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  sun.position.copy(center).addScaledVector(sunDirection, 26000);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const halfSpan = Math.max(maxX - minX, maxZ - minZ) * 0.62;
  Object.assign(sun.shadow.camera, { left: -halfSpan, right: halfSpan, top: halfSpan, bottom: -halfSpan, near: 1000, far: 60000 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 2;
  scene.add(sun, sun.target);

  // ---------- 标签 ----------
  const stationLabels: CSS2DObject[] = [];
  const waterLabels: CSS2DObject[] = [];
  const poiLabels: CSS2DObject[] = [];
  const landmarkLabels: CSS2DObject[] = [];
  const labels = new THREE.Group();
  const makeLabel = (text: string, className: string, x: number, y: number, z: number) => {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    const label = new CSS2DObject(element);
    label.position.set(x, y, z);
    labels.add(label);
    return label;
  };
  const landmarkPositions = new Map<string, THREE.Vector3>();
  for (const landmark of data.landmarks) {
    const [x, z] = landmark.p;
    const y = terrain.heightAt(x, z);
    landmarkPositions.set(landmark.name, new THREE.Vector3(x, y, z));
    const label = makeLabel(landmark.name, labelClasses.landmark, x, y + 260, z);
    label.element.style.pointerEvents = "auto";
    label.element.addEventListener("click", () => { flyToLandmark(landmark.name); onFlyTo?.(landmark.name); });
    landmarkLabels.push(label);
  }
  for (const item of landmarks.placed) {
    const label = makeLabel(item.name, labelClasses.poi, item.position.x, item.top + 30, item.position.z);
    label.userData.planned = !!item.planned;
    poiLabels.push(label);
  }
  const seenStations = new Set<string>();
  for (const station of data.stations) {
    if (seenStations.has(station.name)) continue;
    seenStations.add(station.name);
    const [x, z] = station.p;
    const label = makeLabel(station.name, labelClasses.station, x, terrain.heightAt(x, z) + 60, z);
    // 站名跟随线路显隐：讲解到 6 号线时，还没开通的 13 号线站名不显示
    label.userData.lines = data.stations.filter((item) => item.name === station.name).flatMap((item) => item.lines).filter((l) => !l.startsWith("osm-"));
    stationLabels.push(label);
  }
  for (const area of data.water.areas) {
    if (!area.name || area.area < 70000 || area.level === undefined || landmarkPositions.has(area.name)) continue;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < area.p.length; i += 2) { sx += area.p[i]; sz += area.p[i + 1]; }
    const n = area.p.length / 2;
    waterLabels.push(makeLabel(area.name, labelClasses.water, sx / n, exaggerate(area.level) + 40, sz / n));
  }
  scene.add(labels);

  // ---------- 相机与控制 ----------
  const camera = new THREE.PerspectiveCamera(30, 1, 20, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 500;
  controls.maxDistance = 90000;
  controls.maxPolarAngle = 1.41; // 允许压到约 10° 的低机位（天际线视角）
  controls.screenSpacePanning = false;

  const viewPose = (target: THREE.Vector3, distance: number, elevationDeg: number, azimuthDeg: number) => {
    const el = THREE.MathUtils.degToRad(elevationDeg);
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const position = new THREE.Vector3(
      target.x + Math.sin(az) * Math.cos(el) * distance,
      target.y + Math.sin(el) * distance,
      target.z + Math.cos(az) * Math.cos(el) * distance,
    );
    return { position, target: target.clone() };
  };
  const span = Math.max(maxX - minX, maxZ - minZ);
  const poses: Record<ViewKey, () => { position: THREE.Vector3; target: THREE.Vector3 }> = {
    overview: () => viewPose(center, span * 2.05, 55, 8),
    miniature: () => viewPose(center.clone().add(new THREE.Vector3(0, 0, 900)), span * 1.05, 33, 28),
    detail: () => viewPose(landmarkPositions.get("光明中心") ?? center, 3600, 36, 24),
    // 天际线：低机位朝北看光明中心，高楼衬着夜空、后面是层层山体剪影（夜景最好看的角度）
    skyline: () => { const p = viewPose((landmarkPositions.get("光明中心") ?? center).clone().add(new THREE.Vector3(0, 160, 0)), 5200, 10, 24); return p; },
  };

  let tween: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null = null;
  const goTo = (pose: { position: THREE.Vector3; target: THREE.Vector3 }, instant = false) => {
    if (instant) {
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      controls.update();
      return;
    }
    tween = { from: camera.position.clone(), to: pose.position, fromTarget: controls.target.clone(), toTarget: pose.target, t: 0 };
  };
  controls.addEventListener("start", () => { tween = null; });
  for (const item of landmarks.placed) landmarkPositions.set(item.name, item.position);
  const poiNames = new Set(landmarks.placed.map((item) => item.name));
  const flyToLandmark = (name: string) => {
    const target = landmarkPositions.get(name);
    // 精细地标飞得更近
    if (target) goTo(poiNames.has(name) ? viewPose(target, 900, 32, 30) : viewPose(target, 3600, 36, 24));
  };
  goTo(poses.miniature(), true);
  if (process.env.NODE_ENV !== "production") (window as unknown as { __sandbox: unknown }).__sandbox = { scene, camera, controls, metro: metroSystem, terrain, story: () => story, watershed: () => watershedView, renderer, gpu: () => ({ waterGpu, volumeFog, pipeline, gtao, flood: () => flood }) };

  // ---------- 后处理（节点链，等价于原来的 GTAO → 移轴 → 泛光 → 暗角 → 全局调色 → 输出） ----------
  const pipeline = new THREE.RenderPipeline(renderer);
  // 不做多重采样：GTAO 要读普通深度图（原来的 EffectComposer 渲染目标也没有多重采样）
  const scenePass = pass(scene, camera, { samples: 0 });
  // 额外输出法线（给 AO）
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const sceneColor = scenePass.getTextureNode("output");
  const sceneNormal = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode("normal").sample(uv as ReturnType<typeof vec2>)));
  const gtao = ao(scenePass.getTextureNode("depth"), sceneNormal, camera);
  gtao.radius.value = 60;
  gtao.distanceExponent.value = 1.4;
  gtao.thickness.value = 20;
  gtao.scale.value = 1;
  gtao.samples.value = 12;
  gtao.resolutionScale = 1; // 原来的 GTAOPass 是全分辨率
  const uAO = uniform(0.85); // 原 GTAO blendIntensity
  const aoTerm = gtao.getTextureNode().sample(screenUV).r;
  // 远处（全深圳地形、远山远海）不做 AO：大片平坦面在远处深度精度不够，AO 会随镜头跳动闪烁。
  // 天空穹顶不写深度，本来就不参与
  const viewZ = perspectiveDepthToViewZ(scenePass.getTextureNode("depth").sample(screenUV).r, cameraNear, cameraFar);
  const aoMask = float(1).sub(smoothstep(18000, 32000, viewZ.negate()));
  const aoLit = sceneColor.rgb.mul(mix(float(1), aoTerm, uAO.mul(aoMask)));
  // 体积雾（晨雾、雾天、雨雪天）：按雾的浓度把画面混向雾色
  const volumeFog = createVolumeFog(scene, camera, scenePass.getTextureNode("depth").sample(screenUV), terrain.heightAt(center.x, center.z), terrain, data, renderer);
  const lit = volumeFog.apply(aoLit);
  // 移轴：离焦点线（画面 52% 高度处）越远越糊。原来的水平 + 竖直移轴在画面最边缘也只糊约 3 像素，这里保持同样的轻度
  const uTilt = uniform(1);
  const tiltBlur = gaussianBlur(vec4(lit, 1.0), null, 1.2, { resolutionScale: 0.5 });
  const tiltK = clamp(abs(screenUV.y.sub(0.48)).mul(1.9), 0, 1).mul(uTilt);
  const tilted = mix(lit, tiltBlur.rgb, tiltK);
  const uBloom = uniform(0);
  const bloomed = tilted.add(bloomNode(vec4(tilted, 1.0), 1, 0.5, 0.62).rgb.mul(uBloom));
  // 暗角（同 VignetteShader：offset 0.9）
  const vignetteUniforms = { darkness: uniform(0.9) };
  const vuv = screenUV.sub(0.5).mul(0.9);
  const vignetted = mix(bloomed, vec3(float(1).sub(vignetteUniforms.darkness)), dot(vuv, vuv));
  const grade = createGrade();
  const graded = grade.apply(vignetted);
  const fullOutput = vec4(graded, 1.0);
  // 「流畅」画质：不算 AO 和移轴
  const lightOutput = vec4(grade.apply(mix(volumeFog.apply(sceneColor.rgb).add(bloomNode(sceneColor, 1, 0.5, 0.62).rgb.mul(uBloom)), vec3(float(1).sub(vignetteUniforms.darkness)), dot(vuv, vuv))), 1.0);
  pipeline.outputNode = fullOutput;
  // 原来的 bloom / vignette / grade 接口（atmosphere 在用）
  const bloom = { enabled: false, get strength() { return uBloom.value; }, set strength(v: number) { uBloom.value = this.enabled ? v : 0; } };
  const vignette = { uniforms: vignetteUniforms };
  const waterMaterials: { material: THREE.MeshStandardMaterial; day: string; night: string }[] = [];
  water.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material && !material.vertexColors && material.name !== "embankment" && !waterMaterials.some((item) => item.material === material)) waterMaterials.push({ material, day: waterStyle.area, night: night.water });
  });
  const atmosphere = createAtmosphere({
    scene,
    renderer,
    sun,
    hemi,
    bloom,
    vignette,
    tinted: waterMaterials,
    clouds: (clouds.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial,
    radius: 90000,
    center,
    sunDistance: 26000,
    grade,
  });
  atmosphere.update(0);
  // 水面换成 MVP 的分级水面（倒影、深浅、波纹、雨点）；底色仍跟着 atmosphere 改的原水色走
  const waterGpu = upgradeWater(water, data, terrain.extent, scene, waterMaterials[0]?.material);
  for (const m of waterGpu.materials) terrain.maskMaterial(m);


  const setEffects = (enabled: boolean) => {
    pipeline.outputNode = enabled ? fullOutput : lightOutput;
    pipeline.needsUpdate = true;
  };
  if (isSmall) setEffects(false);

  // 夜里画面的内容是一个个小光点：移轴模糊会把它们糊成一团，AO 只会把暗处弄脏 → 随夜间系数减弱
  const fogSunDir = new THREE.Vector3();
  const updateNightEffects = () => {
    const n = nightUniform.value;
    uTilt.value = 1 - 0.85 * n;
    uAO.value = 0.85 * (1 - n);
  };
  const resize = () => {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);

  };
  resize();
  window.addEventListener("resize", resize);

  // ---------- 图层 ----------
  const layers: Record<LayerKey, THREE.Object3D[]> = {
    buildings: [buildings, cityDots],
    fill: [fillMesh],
    landmarks: [landmarks.group],
    planned: [landmarks.plannedGroup],
    trees: [trees.group],
    water: [water],
    roads: [roads],
    expressways: [express.group],
    metro: [metro],
    hsr: [highSpeed],
    labels: [labels],
    clouds: [clouds.group],
  };
  let labelsOn = true;
  const setLayer = (layer: LayerKey, visible: boolean) => {
    layers[layer].forEach((object) => { object.visible = visible; });
    if (layer === "labels") labelsOn = visible;
    if (layer === "metro") stationLabels.forEach((label) => { label.userData.hidden = !visible; });
  };

  // ---------- 舞台光（讲解时照亮主体板块） ----------
  const stage = createStageLight(scene, terrain);

  // ---------- 讲解剧本 ----------
  const visibleMetroLines = new Set<string>(metroSystem.lines);
  const storyPlaces: StoryPlaces = Object.fromEntries((placesFile?.places ?? []).map((p) => [p.id, { name: p.name, x: p.x, z: p.z, verified: p.verified }]));
  const story = isGM ? buildStory(data, storyPlaces, growth) : [];
  // 开场镜头：深圳西半部（光明 → 南山、福田），北在上
  const contextPose = (() => {
    const outline = contextData?.cityOutline as { localGeometry?: { coordinates: unknown } } | undefined;
    const flat: number[][] = [];
    const walk = (a: unknown) => { if (Array.isArray(a) && typeof a[0] === "number") flat.push(a as number[]); else if (Array.isArray(a)) a.forEach(walk); };
    walk(outline?.localGeometry?.coordinates);
    if (!flat.length) return viewPose(center, 70000, 70, 0);
    const xs = flat.map((p) => p[0]);
    const zs = flat.map((p) => p[1]);
    // 光明（原点）与深圳市域中心的中点：画面里同时有光明和南山、福田
    const target = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) * 0.25, 0, (Math.min(...zs) + Math.max(...zs)) * 0.25);
    return viewPose(target, 82000, 70, 0);
  })();
  // 运镜：到位后的镜头运动（用户拖动时中止）
  let motion: StoryStep["motion"] | null = null;
  let motionTime = 0;
  let motionFrom = 0;
  controls.addEventListener("start", () => { motion = null; });
  // 右侧面板约占屏幕 1/3、左下是说明卡：镜头目标往画面右方、下方偏移，让主体落在左上方的可见区域
  const framedPose = (x: number, z: number, distance: number, elevation: number, azimuth: number) => {
    const az = THREE.MathUtils.degToRad(azimuth);
    const shift = distance * 0.12;
    const down = distance * 0.08;
    const tx = x + Math.cos(az) * shift + Math.sin(az) * down;
    const tz = z - Math.sin(az) * shift + Math.cos(az) * down;
    return viewPose(new THREE.Vector3(tx, terrain.heightAt(x, z), tz), distance, elevation, azimuth);
  };
  // ---------- 生长：进入某一拍时触发；没指定的元素直接完整显示 ----------
  // 建筑阶段（见 growthPlan.ts）：两个时钟分别驱动"西岸老城"和"光明大道"两次生长
  let buildingStage: BuildingStage | "all" = "all";
  const setBuildingStage = (stageName: BuildingStage | "all") => {
    buildingStage = stageName;
    const [t1, t2] = { none: [-10, -10], "west-grow": [0, -10], west: [1e6, -10], "avenue-grow": [1e6, 0], all: [1e8, 1e8] }[stageName];
    growUniforms.uGrowTime.value = t1;
    growUniforms.uGrowTime2.value = t2;
    if (stageName === "avenue-grow") { roadGrowth.hideAll(); roadGrowth.uniform.value = 0; } else roadGrowth.showAll();
  };
  const applyGrowth = (step: StoryStep) => {
    const grow = step.grow ?? {};
    setBuildingStage(step.buildings ?? "all");
    if (grow.hsr) hsrGrowth.start(30000, grow.hsr); else hsrGrowth.showAll();
    for (const key of ["longda", "nanguang"] as const) {
      const seconds = grow.expressways?.[key];
      if (seconds) expresswayGrowth[key].start(express.lengths[key], seconds);
      else if (step.hidden?.expressways?.includes(key)) expresswayGrowth[key].hideAll();
      else expresswayGrowth[key].showAll();
    }
    for (const item of grow.metro ?? []) metroSystem.growLine(item.line, item.seconds);
  };
  const showAllGrowth = () => {
    setBuildingStage("all");
    hsrGrowth.showAll();
    expresswayGrowth.longda.showAll();
    expresswayGrowth.nanguang.showAll();
  };
  const updateGrowth = (delta: number) => {
    if (buildingStage === "west-grow") growUniforms.uGrowTime.value += delta;
    if (buildingStage === "avenue-grow") {
      growUniforms.uGrowTime2.value += delta;
      roadGrowth.uniform.value = growUniforms.uGrowTime2.value * 1000;
    }
    hsrGrowth.update(delta);
    expresswayGrowth.longda.update(delta);
    expresswayGrowth.nanguang.update(delta);
    metroSystem.updateGrowth(delta);
    // 生长过程中先不显示桥墩、洞门（避免"桥墩先于桥面出现"）
    const expressBusy = expresswayGrowth.longda.running || expresswayGrowth.nanguang.running;
    express.group.traverse((object) => { if (object.name === "expressway-piers") object.visible = !expressBusy; });
    highSpeed.traverse((object) => { if (object.name === "hsr-piers" || object.name === "hsr-portal") object.visible = !hsrGrowth.running; });
  };

  // ---------- 路名沿路浮现 ----------
  // 起点地名先出现；路长到哪里，路上方的字就出现到哪里；长到头，浮现下一个地名
  const captionGroup = new THREE.Group();
  scene.add(captionGroup);
  // 每个字 / 地名带自己那条路的进度（可以同时讲几条路）
  let captionItems: { element: HTMLElement; at: number; progress: () => number }[] = [];
  // 全景下高速只有一根细线：在地面叠加层上画一条随路延伸的高亮带
  type OverlayStroke = { path: [number, number][]; at: number[]; color: string; width: number; progress: () => number };
  let strokes: OverlayStroke[] = [];
  let strokeDrawn = -1;
  let strokeTimer = 0;
  const clearRoadCaption = () => {
    for (const child of [...captionGroup.children]) captionGroup.remove(child);
    captionItems = [];
    strokes = [];
  };
  type RoadCaption = Extract<NonNullable<StoryStep["roadCaption"]>, { road: string }>;
  const showRoadCaption = (caption: RoadCaption) => {
    const isAvenue = caption.road === "avenue";
    const path = caption.road === "avenue" ? growth.avenue : growth.expresswayPaths[caption.road];
    if (path.length < 2) return;
    const cum = cumulative(path);
    const total = cum[cum.length - 1];
    const origin = path[0];
    // 高速的"延伸"按到起点的直线距离；光明大道按沿线里程
    let captionProgress: () => number = () => Infinity;
    const measure = (p: [number, number], along: number) => (isAvenue ? along : Math.hypot(p[0] - origin[0], p[1] - origin[1]));
    const add = (text: string, className: string, p: [number, number], lift: number, at: number) => {
      const holder = document.createElement("div");
      const element = document.createElement("div");
      element.className = className;
      element.textContent = text;
      holder.appendChild(element);
      const object = new CSS2DObject(holder);
      object.position.set(p[0], terrain.heightAt(p[0], p[1]) + lift, p[1]);
      captionGroup.add(object);
      captionItems.push({ element, at, progress: () => captionProgress() });
    };
    // 起点地名放在路进入光明的地方（真正的起点在区外，常被说明卡挡住）
    const entry = path.find((p) => terrain.inside(p[0], p[1])) ?? origin;
    add(caption.from, labelClasses.roadEnd, entry, 220, -1);
    const end = path[path.length - 1];
    add(caption.to, labelClasses.roadEnd, end, 220, measure(end, total) * 0.96);
    // 字的排列按屏幕阅读方向（北在上：从上到下、从左到右），出现的先后仍跟着路的延伸
    const dx = end[0] - origin[0];
    const dz = end[1] - origin[1];
    const natural = Math.abs(dx) > Math.abs(dz) ? dx > 0 : dz > 0;
    const chars = natural ? [...caption.name] : [...caption.name].reverse();
    chars.forEach((char, i) => {
      const along = total * (0.28 + (0.44 * i) / Math.max(1, chars.length - 1));
      const p = pointAt(path, cum, along);
      add(char, labelClasses.roadName, p, 150, measure(p, along));
    });
    const progress = isAvenue
      ? () => (buildingStage === "avenue-grow" ? growUniforms.uGrowTime2.value * AVENUE_ALONG_SPEED : Infinity)
      : () => expresswayGrowth[caption.road as "longda" | "nanguang"].uniform.value;
    captionProgress = progress;
    strokes.push({ path, at: path.map((p, i) => measure(p, cum[i])), color: isAvenue ? "rgba(244,166,60,0.95)" : "rgba(232,112,72,0.95)", width: isAvenue ? 150 : 200, progress });
    strokeDrawn = -1;
  };
  /** 地铁生长时：线路色的高亮带跟着领头列车延伸（全景下也能看清线路怎么连起来） */
  const showMetroStroke = (lineId: string) => {
    const route = data.metroRoutes.find((item) => item.line === lineId);
    if (!route) return;
    let path = pairs(route.p);
    const start = growth.metroStarts[lineId];
    if (start && Math.hypot(path[0][0] - start[0], path[0][1] - start[1]) > Math.hypot(path[path.length - 1][0] - start[0], path[path.length - 1][1] - start[1])) path = [...path].reverse();
    const color = new THREE.Color(data.meta.lineColors[lineId] ?? "#888");
    strokes.push({ path, at: cumulative(path), color: `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},0.92)`, width: 200, progress: () => metroSystem.growthReached(lineId) ?? 1e9 });
    strokeDrawn = -1;
  };
  const updateRoadCaption = (delta: number) => {
    for (const item of captionItems) if (item.progress() >= item.at && !item.element.classList.contains(labelClasses.lit)) item.element.classList.add(labelClasses.lit);
    drawStrokes(delta);
  };
  const drawStrokes = (delta: number) => {
    // 高亮带每 0.1 秒重画一次（叠加层是 2048 画布，逐帧重画太贵）
    strokeTimer += delta;
    if (!strokes.length || strokeTimer < 0.1 || strokeDrawn >= 1e8) return;
    strokeTimer = 0;
    const shown = strokes.map((stroke) => Math.min(stroke.progress(), 1e8));
    const key = shown.reduce((a, b) => a + b, 0) / shown.length;
    if (key === strokeDrawn) return;
    strokeDrawn = key;
    const base = currentPaint;
    terrain.setOverlay((c, toPixel, m) => {
      base?.(c, toPixel, m);
      strokes.forEach(({ path, at, color, width }, k) => {
        c.strokeStyle = color;
        c.lineWidth = Math.max(4, width * m);
        c.lineCap = "round";
        c.lineJoin = "round";
        c.beginPath();
        let started = false;
        for (let i = 0; i < path.length; i += 1) {
          if (at[i] > shown[k]) {
            // 末端插值到当前长到的位置
            if (started && i > 0) {
              const t = (shown[k] - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]);
              const [px, py] = toPixel(path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t);
              c.lineTo(px, py);
            }
            break;
          }
          const [px, py] = toPixel(path[i][0], path[i][1]);
          if (!started) { c.moveTo(px, py); started = true; } else c.lineTo(px, py);
        }
        c.stroke();
      });
    });
    overlayTarget = 1;
  };

  // ---------- 讲解动画（scene/anim/）：按时间 seek，叠加层每 0.1 秒重画 ----------
  type StoryAnim = { group: THREE.Group; paint?: (c: CanvasRenderingContext2D, toPixel: (x: number, z: number) => [number, number], metersToPixels: number) => void; duration: number; seek: (t: number) => void; dispose: () => void };
  // 历史画面（app/sandbox/anim/history，其他 AI 交付）：点位按 id 索引，带年代和姓氏
  const historyContext: HistoryContext = {
    groundAt: terrain.heightAt,
    data,
    places: Object.fromEntries((placesFile?.places ?? []).map((p) => [p.id, { x: p.x, z: p.z, name: p.name, era: p.era, clan: p.clan }])),
    areas: storyAreas ?? undefined,
  };
  const heshuikouVillage = storyPlaces["village-heshuikou"];
  const animFactories: Record<NonNullable<StoryStep["anim"]>, () => StoryAnim> = {
    heshuikou: () => createHeshuikouAnim(data, terrain, heshuikouVillage ? [heshuikouVillage.x, heshuikouVillage.z] : undefined),
    river: () => createRiverFlowAnim(historyContext),
    alluvial: () => createAlluvialPlainAnim(historyContext),
    migration: () => createMigrationAnim(historyContext),
    wind: () => createWindAnim(historyContext),
    flood: () => createFloodAnim(historyContext),
    farm: () => createFarmAnim(historyContext),
  };
  let activeAnim: StoryAnim | null = null;
  let animTime = 0;
  let animTimer = 0;
  let windTimer = 0;
  // 积水模拟：第一次讲到「水也从这里来」才加载数据
  let flood: Awaited<ReturnType<typeof createFloodSim>> | null = null;
  let floodLoading: Promise<void> | null = null;
  const startFlood = () => {
    if (flood) { flood.start(); return; }
    floodLoading ??= createFloodSim(scene, renderer, terrain).then((sim) => { flood = sim; if (activeAnimName === "flood") sim.start(); }).catch((error) => console.warn("flood sim failed", error));
  };
  let activeAnimName: string | null = null;
  const stopAnim = () => {
    flood?.stop();
    activeAnimName = null;
    // 风吹雾只属于「风从口子进来」这一拍：离开时风停、不再强制起雾
    window.clearTimeout(windTimer);
    volumeFog.setWind(false);
    volumeFog.forceFog(0);
    if (!activeAnim) return;
    scene.remove(activeAnim.group);
    activeAnim.dispose();
    activeAnim = null;
  };
  const startAnim = (name: NonNullable<StoryStep["anim"]>) => {
    stopAnim();
    activeAnim = animFactories[name]();
    scene.add(activeAnim.group);
    animTime = 0;
    animTimer = 1;
    activeAnim.seek(0);
    activeAnimName = name;
    // 积水：按 2019-05-23 光明实测的逐小时雨量下雨，雨水顺地形往低处汇集、涨水、再慢慢退去
    if (name === "flood" && isGM) {
      startFlood();
      // 积水由模拟画；原来那张平面示意图只保留文字，不再铺蓝色色块
      (activeAnim as unknown as { paint?: unknown }).paint = undefined;
    }
    if (name === "wind") {
      // 先让盆地被雾盖住，约 2.5 秒后西南风从西边山口吹进来，沿河谷把雾吹开，露出风廊上的城区
      volumeFog.forceFog(6);
      windTimer = window.setTimeout(() => volumeFog.setWind(true), 3500);
    }
  };
  const updateAnim = (delta: number) => {
    if (!activeAnim) return;
    animTime += delta;
    activeAnim.seek(animTime);
    animTimer += delta;
    if (animTimer < 0.1 || animTime > activeAnim.duration + 0.5) return;
    animTimer = 0;
    const anim = activeAnim;
    const base = currentPaint;
    terrain.setOverlay((c, toPixel, m) => { base?.(c, toPixel, m); anim.paint?.(c, toPixel, m); });
    overlayTarget = 1;
  };

  // ---------- 地铁站名：讲某条线时全景也显示，列车到站时点亮 ----------
  const stationFocus = new Set<string>();

  // ---------- 深圳全图（开场） ----------
  let flyFrom: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let contextOpacity = 0;
  let contextTarget = 0;
  const updateContext = (delta: number) => {
    if (contextOpacity !== contextTarget) {
      contextOpacity += (contextTarget - contextOpacity) * Math.min(1, delta * 3);
      if (Math.abs(contextOpacity - contextTarget) < 0.01) contextOpacity = contextTarget;
      shenzhen?.setOpacity(contextOpacity);
    }
    // 看全深圳时镜头很远：雾往后推，避免全图发白
    const fog = scene.fog as THREE.Fog | null;
    const base = atmosphere.fogBase(camera.position.distanceTo(controls.target));
    if (fog) { fog.near = base.near + 120000 * contextOpacity; fog.far = base.far + 160000 * contextOpacity; }
  };
  const pathPoint = (path: [number, number][], u: number): [number, number] => {
    if (path.length === 1) return path[0];
    const lengths = [0];
    for (let i = 1; i < path.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const target = u * lengths[lengths.length - 1];
    let i = 1;
    while (i < path.length - 1 && lengths[i] < target) i += 1;
    const t = (target - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1]);
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
  };
  const storyLabels = new THREE.Group();
  scene.add(storyLabels);
  let overlayOpacity = 0;
  let currentPaint: StoryStep["paint"] = null;
  let overlayTarget = 0;
  const setStoryStep = (index: number | null) => {
    // 离开流域视图那一拍：先把光明版恢复
    if (watershedView?.group.visible) void showWatershed(false);
    for (const child of [...storyLabels.children]) storyLabels.remove(child);
    clearRoadCaption();
    stopAnim();
    for (const child of [...arterialLabels.children]) arterialLabels.remove(child);
    stationFocus.clear();
    for (const label of stationLabels) { label.element.classList.remove(labelClasses.lit); label.userData.lit = false; }
    if (index === null) {
      contextTarget = 0;
      overlayTarget = 0;
      stage.clear();
      motion = null;
      showAllGrowth();
      for (const line of metroSystem.lines) { metroSystem.setLineVisible(line, true); visibleMetroLines.add(line); }
      return;
    }
    const step = story[index];
    for (const [key, visible] of Object.entries(step.layers)) setLayer(key as LayerKey, !!visible);
    visibleMetroLines.clear();
    for (const line of metroSystem.lines) {
      const visible = step.metroLines ? !!step.metroLines[line] : true;
      metroSystem.setLineVisible(line, visible);
      if (visible) visibleMetroLines.add(line);
    }
    terrain.setOverlay(step.paint);
    currentPaint = step.paint;
    overlayOpacity = 0;
    overlayTarget = step.paint ? 1 : 0;
    for (const label of step.labels) {
      const element = document.createElement("div");
      element.className = labelClasses.story;
      element.textContent = label.text;
      const object = new CSS2DObject(element);
      object.position.set(label.x, terrain.heightAt(label.x, label.z) + 160, label.z);
      storyLabels.add(object);
    }
    if (step.focus) {
      // 镜头位于主体的 azimuth 方向；光从反方向（主体后上方）射来
      const az = THREE.MathUtils.degToRad(step.camera.azimuth);
      stage.focus(step.focus.x, step.focus.z, step.focus.radius, { x: -Math.sin(az), z: -Math.cos(az) });
    }
    else stage.clear();
    const { x, z, distance, elevation, azimuth } = step.camera;
    if (step.motion?.kind === "fly") {
      // 先瞬间切到深圳全图，再由运镜飞入
      goTo(contextPose, true);
      tween = null;
      flyFrom = contextPose;
      contextTarget = 1;
      contextOpacity = 1;
      shenzhen?.setOpacity(1);
    } else {
      goTo(framedPose(x, z, distance, elevation, azimuth));
      flyFrom = null;
      contextTarget = 0;
    }
    motion = step.motion ?? null;
    motionTime = 0;
    motionFrom = distance;
    applyGrowth(step);
    for (const lineId of step.stationFocus ?? []) stationFocus.add(lineId);
    for (const item of step.grow?.metro ?? []) showMetroStroke(item.line);
    for (const caption of [step.roadCaption ?? []].flat()) showRoadCaption(caption);
    if (step.anim) startAnim(step.anim);
    if (step.watershed) void showWatershed(true);
  };

  // ---------- 主干道脉络：在地面叠加层上画路，标出起止 ----------
  const arterials = (arterialFile?.roads ?? []) as ArterialRoad[];
  const arterialLabels = new THREE.Group();
  scene.add(arterialLabels);
  const showArterials = (id: string | null) => {
    for (const child of [...arterialLabels.children]) arterialLabels.remove(child);
    if (id === null) { terrain.setOverlay(null); overlayTarget = 0; return; }
    const shown = arterials.filter((road) => road.found && road.line && (id === "all" || road.id === id));
    if (!shown.length) return;
    const expressLines = data.roads.filter((road) => road.c === "motorway" && road.n && /南光|龙大/.test(road.n) && !road.l).map((road) => pairs(road.p));
    terrain.setOverlay((c, toPixel, m) => {
      const line = (path: [number, number][], color: string, width: number, dash: number[] = []) => {
        c.strokeStyle = color; c.lineWidth = Math.max(3, width * m); c.lineCap = "round"; c.lineJoin = "round"; c.setLineDash(dash);
        c.beginPath();
        path.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); });
        c.stroke(); c.setLineDash([]);
      };
      // 参照：南光、龙大（灰色虚线）
      for (const path of expressLines) line(path, "rgba(90,96,110,0.75)", 70, [Math.max(6, 260 * m), Math.max(4, 160 * m)]);
      // 单看一条时，其余主干道淡淡地留在底下做参照
      if (id !== "all") for (const road of arterials) if (road.found && road.line && road.id !== id) line(road.line, "rgba(120,120,120,0.35)", 70);
      for (const road of shown) {
        line(road.line!, "rgba(255,255,255,0.9)", road.id === "guangming" || id !== "all" ? 260 : 190);
        line(road.line!, ARTERIAL_COLORS[road.id] ?? "#888", road.id === "guangming" || id !== "all" ? 190 : 130);
      }
    });
    overlayTarget = 1;
    const label = (text: string, p: [number, number], lift: number, color: string | null, className: string) => {
      const holder = document.createElement("div");
      const element = document.createElement("div");
      element.className = className;
      element.textContent = text;
      if (color) { element.style.background = color; element.style.color = "#fff"; }
      holder.appendChild(element);
      const object = new CSS2DObject(holder);
      object.position.set(p[0], terrain.heightAt(p[0], p[1]) + lift, p[1]);
      arterialLabels.add(object);
    };
    for (const road of shown) {
      const path = road.line!;
      const mid = path[Math.floor(path.length / 2)];
      label(id === "all" ? road.name : `${road.name} · 约 ${road.lengthKm} km`, mid, 200, ARTERIAL_COLORS[road.id] ?? "#888", labelClasses.story);
      if (id !== "all") {
        // 起止：用户清单里的"起 → 止"与数据端点上接到的路对上号；对不上时按数据端点标注
        const [givenStart, givenEnd] = road.given.split("→").map((t) => t.trim().replace(/（.*?）/g, ""));
        const ends = [path[0], path[path.length - 1]];
        const endRoads = road.endRoads ?? [[], []];
        const startIndex = endRoads[1]?.some((n) => givenStart.includes(n) || n.includes(givenStart)) ? 1 : 0;
        const describe = (i: number, given: string, word: string) => {
          const found = (endRoads[i] ?? []).filter((n) => !given.includes(n)).slice(0, 2);
          return `${word} · ${given}${found.length ? `（接 ${found.join("、")}）` : ""}`;
        };
        label(describe(startIndex, givenStart, "起"), ends[startIndex], 260, null, `${labelClasses.roadEnd} ${labelClasses.lit}`);
        label(describe(1 - startIndex, givenEnd, "止"), ends[1 - startIndex], 260, null, `${labelClasses.roadEnd} ${labelClasses.lit}`);
      }
    }
    // 镜头：北在上；全部 = 全景，单条 = 整条路入画
    if (id === "all") { goTo(framedPose(0, 600, 30000, 55, 0)); return; }
    const pts = shown[0].line!;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    goTo(framedPose((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(9000, w * 1.9, h * 3.1) * 1.15, 55, 0));
  };

  // ---------- 地势视图：原始海拔（SRTM，不是沙盘夸张后的高度）分色 + 老村落海拔 ----------
  const terrainLabels = new THREE.Group();
  scene.add(terrainLabels);
  const terrainLegend = document.createElement("div");
  Object.assign(terrainLegend.style, { display: "none", position: "absolute", left: "24px", top: "92px", maxWidth: "520px", fontFamily: "\"PingFang SC\", sans-serif", fontSize: "12px", color: "#3d4a5c", background: "rgba(255,250,241,0.96)", padding: "8px 12px", borderRadius: "12px", lineHeight: "1.8", boxShadow: "0 4px 14px rgba(61,74,92,0.2)", pointerEvents: "none", zIndex: "5" });
  mount.appendChild(terrainLegend);
  const ELEVATION_BANDS: [number, string, string][] = [
    [4, "rgba(38,112,184,0.78)", "4 m 以下"],
    [8, "rgba(84,156,214,0.72)", "4–8 m"],
    [12, "rgba(150,200,226,0.66)", "8–12 m"],
    [20, "rgba(232,222,170,0.62)", "12–20 m"],
    [40, "rgba(198,214,140,0.62)", "20–40 m"],
    [Infinity, "rgba(120,170,110,0.62)", "40 m 以上"],
  ];
  const showTerrainView = (on: boolean) => {
    for (const child of [...terrainLabels.children]) terrainLabels.remove(child);
    if (!on) { terrain.setOverlay(null); overlayTarget = 0; terrainLegend.style.display = "none"; return; }
    const { minX: ex0, maxX: ex1, minZ: ez0, maxZ: ez1 } = terrain.extent;
    const cell = 80;
    const floodPolys = ((storyAreas?.features ?? []).filter((f) => f.properties?.id === "area-flood-risk")).flatMap((f) => {
      const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
      const polys = g.type === "Polygon" ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
      return polys.map((poly) => poly[0].map(([lng, lat]) => projectLngLat(data, lng, lat)));
    });
    terrain.setOverlay((c, toPixel, m) => {
      for (let x = ex0; x < ex1; x += cell) {
        for (let z = ez0; z < ez1; z += cell) {
          if (!terrain.inside(x + cell / 2, z + cell / 2)) continue;
          const h = terrain.elevationAt(x + cell / 2, z + cell / 2);
          c.fillStyle = ELEVATION_BANDS.find(([top]) => h < top)![1];
          const [px, py] = toPixel(x, z);
          const [qx, qy] = toPixel(x + cell, z + cell);
          c.fillRect(px, py, qx - px + 0.5, qy - py + 0.5);
        }
      }
      // 洪涝高风险区（示意）：深蓝虚线
      c.strokeStyle = "rgba(20,60,120,0.9)";
      c.lineWidth = Math.max(2, 45 * m);
      c.setLineDash([Math.max(6, 180 * m), Math.max(4, 120 * m)]);
      for (const ring of floodPolys) {
        c.beginPath();
        ring.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
        c.closePath();
        c.stroke();
      }
      c.setLineDash([]);
      // 老村落：白点
      for (const p of placesFile?.places ?? []) {
        if (!/^(village|market)-/.test(p.id)) continue;
        const [px, py] = toPixel(p.x, p.z);
        c.fillStyle = "#fffaf0";
        c.strokeStyle = "rgba(40,50,60,0.85)";
        c.lineWidth = Math.max(2, 25 * m);
        c.beginPath();
        c.arc(px, py, Math.max(5, 120 * m), 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    });
    overlayTarget = 1;
    const tag = (text: string, x: number, z: number, lift: number, style: Partial<CSSStyleDeclaration>) => {
      const holder = document.createElement("div");
      const inner = document.createElement("div");
      inner.textContent = text;
      Object.assign(inner.style, { fontFamily: "\"PingFang SC\", \"Microsoft YaHei\", sans-serif", whiteSpace: "nowrap", borderRadius: "999px", padding: "4px 11px", fontSize: "13px", fontWeight: "800", boxShadow: "0 3px 10px rgba(61,74,92,0.2)" }, style);
      holder.appendChild(inner);
      const object = new CSS2DObject(holder);
      object.position.set(x, terrain.heightAt(x, z) + lift, z);
      terrainLabels.add(object);
    };
    for (const p of placesFile?.places ?? []) {
      if (!/^(village|market)-/.test(p.id)) continue;
      const h = Math.round(terrain.elevationAt(p.x, p.z));
      // 合水口与公明墟只隔几百米：合水口的标签抬高，避免叠在一起
      tag(`${p.name.replace(/（.*?）/g, "")} · 海拔 ${h} m`, p.x, p.z, p.id === "village-heshuikou" ? 700 : 180, h < 10 ? { background: "rgba(30,80,150,0.92)", color: "#fff" } : { background: "rgba(255,250,241,0.95)", color: "#3d4a5c" });
    }
    // 图例
    const legend = ELEVATION_BANDS.map(([, color, text]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px"><i style="width:12px;height:12px;border-radius:3px;background:${color};display:inline-block"></i>${text}</span>`).join("") + `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:16px;border-top:2px dashed rgba(20,60,120,0.9);display:inline-block"></i>洪涝高风险区（示意）</span>`;
    // 图例固定在画面左下角（不随镜头移动）
    terrainLegend.innerHTML = `<b>原始海拔（SRTM 约 30 m 精度，城区有误差）</b><br>${legend}`;
    terrainLegend.style.display = "block";
    goTo(framedPose(-1200, -400, 26000, 62, 0));
  };

  // ---------- 西岸时间线 ----------
  let quietLabels = false;
  const showWestTimeline = (on: boolean) => {
    quietLabels = on;
    for (const child of [...terrainLabels.children]) terrainLabels.remove(child);
    if (!on) { terrain.setOverlay(null); overlayTarget = 0; terrainLegend.style.display = "none"; return; }
    const place = (id: string) => (placesFile?.places ?? []).find((p) => p.id === id);
    const shangcun = data.stations.find((st) => st.name === "上村");
    const riverLines = data.water.lines.filter((l) => /^(茅洲河|玉田河|合水口河)$/.test(l.n ?? "")).map((l) => ({ name: l.n as string, pts: pairs(l.p) }));
    const nearestRiver = (x: number, z: number) => {
      let best = { d: Infinity, name: "", h: 0 };
      for (const r of riverLines) for (const [px, pz] of r.pts) { const d = Math.hypot(px - x, pz - z); if (d < best.d) best = { d, name: r.name, h: terrain.elevationAt(px, pz) }; }
      return best;
    };
    type Stop = { n: string; title: string; detail: string; x: number; z: number; precise: boolean; lx?: number; lz?: number };
    const stops: Stop[] = [];
    const add = (n: string, title: string, detail: string, x?: number, z?: number, precise = true) => { if (x !== undefined && z !== undefined) stops.push({ n, title, detail, x, z, precise }); };
    const yulu = place("village-yulu");
    add("①", "北宋 · 玉律旧村（莫氏）", "明清曾氏家塾、曾公祠、老井在村中部", yulu?.x, yulu?.z);
    const hsk = place("village-heshuikou");
    add("②", "明永乐 1423 · 合水口旧村（麦氏）", "几条水在村前汇合", hsk?.x, hsk?.z);
    const mai = place("hall-mai");
    add("③", "明弘治 · 麦氏大宗祠", "全区唯一市级文物", mai ? mai.x + 260 : undefined, mai?.z);
    const market = place("market-gongming");
    add("④", "1929 · 公明墟", "合水口与上村交界", market?.x, market?.z);
    if (shangcun) add("·", "上村（示意：取 13 号线上村站）", "旧村坐标待补", shangcun.p[0], shangcun.p[1], false);
    terrain.setOverlay((c, toPixel, m) => {
      const { minX: ex0, maxX: ex1, minZ: ez0, maxZ: ez1 } = terrain.extent;
      const cell = 80;
      for (let x = ex0; x < ex1; x += cell) for (let z = ez0; z < ez1; z += cell) {
        if (!terrain.inside(x + cell / 2, z + cell / 2)) continue;
        const h = terrain.elevationAt(x + cell / 2, z + cell / 2);
        c.fillStyle = ELEVATION_BANDS.find(([top]) => h < top)![1];
        const [px, py] = toPixel(x, z);
        const [qx, qy] = toPixel(x + cell, z + cell);
        c.fillRect(px, py, qx - px + 0.5, qy - py + 0.5);
      }
      // 河：深蓝
      for (const r of riverLines) {
        c.strokeStyle = "rgba(18,82,160,0.95)";
        c.lineWidth = Math.max(3, (r.name === "茅洲河" ? 90 : 55) * m);
        c.lineCap = "round"; c.lineJoin = "round";
        c.beginPath();
        r.pts.forEach(([x, z], i) => { const [px, py] = toPixel(x, z); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
        c.stroke();
      }
      // 时间顺序：① → ② → ④（虚线箭头）
      const order = stops.filter((s) => ["①", "②", "④"].includes(s.n));
      c.strokeStyle = "rgba(190,90,60,0.95)";
      c.lineWidth = Math.max(2.5, 40 * m);
      c.setLineDash([Math.max(6, 160 * m), Math.max(4, 100 * m)]);
      c.beginPath();
      order.forEach((s, i) => { const [px, py] = toPixel(s.x, s.z); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
      c.stroke();
      c.setLineDash([]);
      for (const s of stops) {
        if (s.lx === undefined || s.lz === undefined) continue;
        const [ax, ay] = toPixel(s.x, s.z);
        const [bx, by] = toPixel(s.lx, s.lz);
        c.strokeStyle = "rgba(61,74,92,0.7)";
        c.lineWidth = Math.max(1.5, 14 * m);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
      }
      for (const s of stops) {
        const [px, py] = toPixel(s.x, s.z);
        c.fillStyle = s.precise ? "#fffaf0" : "rgba(255,250,240,0.6)";
        c.strokeStyle = "rgba(190,90,60,0.95)";
        c.lineWidth = Math.max(2, 28 * m);
        c.beginPath(); c.arc(px, py, Math.max(5, 110 * m), 0, Math.PI * 2); c.fill(); c.stroke();
      }
    });
    overlayTarget = 1;
    // 河名
    for (const r of riverLines) {
      const mid = r.pts[Math.floor(r.pts.length / 2)];
      if (!mid) continue;
      if (terrainLabels.children.some((o) => (o.userData.river as string) === r.name)) continue;
      const holder = document.createElement("div");
      const inner = document.createElement("div");
      inner.textContent = r.name === "茅洲河" ? "茅洲河（公明人叫大陂河）" : r.name;
      Object.assign(inner.style, { fontFamily: "\"PingFang SC\", sans-serif", fontSize: "12px", fontWeight: "800", color: "#1a4f8f", textShadow: "0 0 3px #fff, 0 0 6px #fff" });
      holder.appendChild(inner);
      const obj = new CSS2DObject(holder);
      obj.userData.river = r.name;
      obj.position.set(mid[0], terrain.heightAt(mid[0], mid[1]) + 60, mid[1]);
      terrainLabels.add(obj);
    }
    // 标签锚点：北边四个点挤在 1 km 内，标签往两侧拉开，再用引线连回去
    const offsets: Record<string, [number, number]> = { "①": [-2600, 300], "②": [-3200, -900], "③": [-3200, 900], "④": [2600, -1100], "·": [2600, 700] };
    for (const st of stops) { const [dx, dz] = offsets[st.n] ?? [0, 0]; st.lx = st.x + dx; st.lz = st.z + dz; }
    // 各点：编号、年代、海拔、离最近河道的高差
    stops.forEach((s) => {
      const h = terrain.elevationAt(s.x, s.z);
      const r = nearestRiver(s.x, s.z);
      const holder = document.createElement("div");
      const inner = document.createElement("div");
      inner.innerHTML = `<b>${s.n} ${s.title}</b><br>海拔 ${Math.round(h)} m · 比${r.name} ${(h - r.h) >= 0 ? "高" : "低"} ${Math.abs(h - r.h).toFixed(1)} m（相距 ${Math.round(r.d)} m）<br><span style="opacity:.75">${s.detail}</span>`;
      Object.assign(inner.style, { fontFamily: "\"PingFang SC\", sans-serif", fontSize: "12px", lineHeight: "1.5", color: "#3d4a5c", background: s.precise ? "rgba(255,250,241,0.96)" : "rgba(255,250,241,0.75)", border: s.precise ? "none" : "1px dashed #9aa", padding: "6px 10px", borderRadius: "10px", boxShadow: "0 3px 10px rgba(61,74,92,0.2)", whiteSpace: "nowrap" });
      holder.appendChild(inner);
      const obj = new CSS2DObject(holder);
      obj.position.set(s.lx!, terrain.heightAt(s.lx!, s.lz!) + 120, s.lz!);
      terrainLabels.add(obj);
    });
    const legend = ELEVATION_BANDS.map(([, color, text]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px"><i style="width:12px;height:12px;border-radius:3px;background:${color};display:inline-block"></i>${text}</span>`).join("");
    terrainLegend.innerHTML = `<b>西岸 · 时间线</b>　原始海拔（SRTM 约 30 m，城区误差可达数米）<br>${legend}<br><span style="color:#be5a3c">- - -</span> 先后顺序　·　虚线框的点为示意位置`;
    terrainLegend.style.display = "block";
    const xs = stops.flatMap((s) => [s.x, s.lx ?? s.x]);
    const zs = stops.flatMap((s) => [s.z, s.lz ?? s.z]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...zs) - Math.min(...zs);
    // 俯视；北边的标签别顶到页面标题：取景中心往北挪一点
    const dist = Math.max(9000, w * 1.9, h * 3.1) * 1.05;
    goTo(framedPose((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2 - dist * 0.07, dist, 74, 0));
  };

  // ---------- 茅洲河流域视图 ----------
  let watershedView: ReturnType<typeof buildWatershedView> | null = null;
  let watershedShot = "";
  let hiddenForWatershed: THREE.Object3D[] = [];
  const showWatershed = async (on: boolean) => {
    if (on) {
      if (!watershedView) {
        const [ws, demBin] = await Promise.all([
          fetch("/sandbox/watershed/watershed.json").then((r) => r.json() as Promise<WatershedData>),
          fetch("/sandbox/watershed/dem.bin").then((r) => r.arrayBuffer()),
        ]);
        watershedView = buildWatershedView(ws, demBin, data);
        scene.add(watershedView.group);
      }
      // 收起光明版的一切（灯光除外），只留流域
      hiddenForWatershed = scene.children.filter((o) => o !== watershedView!.group && o.visible && !(o as THREE.Light).isLight);
      hiddenForWatershed.forEach((o) => { o.visible = false; });
      watershedView.group.visible = true;
      watershedView.play();
      watershedShot = "";
      quietLabels = true;
      const { frame } = watershedView;
      goTo(framedPose(frame.x, frame.z - frame.h * 0.05, Math.min(85000, Math.max(frame.w * 1.9, frame.h * 3.1) * 0.95), 62, 0));
    } else {
      if (watershedView) watershedView.group.visible = false;
      terrainLegend.style.display = "none";
      hiddenForWatershed.forEach((o) => { o.visible = true; });
      hiddenForWatershed = [];
      quietLabels = false;
      goTo(poses.miniature());
    }
  };

  // ---------- 渲染循环 ----------
  const clock = new THREE.Clock();
  let frame = 0;
  let simTime = 0;
  const render = () => {
    const delta = Math.min(clock.getDelta(), 0.1);
    landmarkElapsed += delta;
    for (const tick of landmarkTickers) tick(delta, landmarkElapsed);
    if (hdState.length) hdCheck();
    simTime += delta;
    metroSystem.update(simTime);
    if (tween) {
      tween.t = Math.min(1, tween.t + delta / 1.4);
      const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
      camera.position.lerpVectors(tween.from, tween.to, k);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (tween.t >= 1) tween = null;
    }
    // 运镜：镜头飞到位（tween 结束）后再开始运动
    if (motion && !tween) {
      motionTime += delta;
      const step = story.find((s) => s.motion === motion);
      if (motion.kind === "fly" && step && flyFrom) {
        // 开场：从深圳全图飞到光明；后半程深圳全图淡出
        const u = Math.min(1, motionTime / motion.seconds);
        const eased = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
        const to = framedPose(step.camera.x, step.camera.z, step.camera.distance, step.camera.elevation, step.camera.azimuth);
        // 目标点平移、距离按对数插值、方向球面插值：镜头一路下降，不会中途贴近沙盘
        const fromOffset = flyFrom.position.clone().sub(flyFrom.target);
        const toOffset = to.position.clone().sub(to.target);
        const distanceNow = Math.exp(THREE.MathUtils.lerp(Math.log(fromOffset.length()), Math.log(toOffset.length()), eased));
        const direction = new THREE.Quaternion().setFromUnitVectors(fromOffset.clone().normalize(), toOffset.clone().normalize());
        const dirNow = fromOffset.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(direction, eased));
        controls.target.lerpVectors(flyFrom.target, to.target, eased);
        camera.position.copy(controls.target).addScaledVector(dirNow, distanceNow);
        contextTarget = 1 - THREE.MathUtils.smoothstep(u, 0.55, 0.95);
        if (u >= 1) motion = null;
      } else if (motion.kind === "push") {
        const u = Math.min(1, motionTime / motion.seconds);
        const eased = u * u * (3 - 2 * u);
        const distanceNow = motionFrom + (motion.toDistance - motionFrom) * eased;
        const dir = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, distanceNow);
        if (u >= 1) motion = null;
      } else if (motion.kind === "track" && step && motion.path.length > 1) {
        const u = Math.min(1, motionTime / motion.seconds);
        const eased = u * u * (3 - 2 * u);
        const [px, pz] = pathPoint(motion.path, eased);
        const pose = framedPose(px, pz, step.camera.distance, step.camera.elevation, step.camera.azimuth);
        controls.target.lerp(pose.target, 0.08);
        camera.position.lerp(pose.position, 0.08);
        if (u >= 1) motion = null;
      }
    }
    controls.update();
    clouds.update(delta);
    // 天气：先更新天气状态，再让 atmosphere 按它改配色
    const artOn = atmosphere.isArt();
    weather.update(delta, artOn, controls.target, camera.position, terrain.heightAt, nightUniform.value);
    weather.setRainBrightness(1 - 0.8 * nightUniform.value);
    // 云量：阴雨天最多；雾天、雪天云少一些（雾和雪本身已经够满），不挡住沙盘
    clouds.setCover(artOn && weatherState.kind !== "clear" ? weatherState.level * (weatherState.kind === "fog" ? 0.2 : weatherState.kind === "snow" ? 0.5 : 1) : 0);
    // 雨后路面变暗、反光（粗糙度降低），地面也略暗
    const wet = artOn ? weatherState.wet : 0;
    roadMaterial.roughness = THREE.MathUtils.lerp(0.9, 0.3, wet);
    roadMaterial.color.setScalar(1 - 0.3 * wet);
    terrainMaterial?.color.setScalar(1 - 0.15 * wet);
    if (overlayOpacity !== overlayTarget) {
      overlayOpacity += (overlayTarget - overlayOpacity) * Math.min(1, delta * 2.5);
      if (Math.abs(overlayTarget - overlayOpacity) < 0.01) overlayOpacity = overlayTarget;
      terrain.setOverlayOpacity(overlayOpacity);
    }
    atmosphere.update(delta);
    updateGrowth(delta);
    updateRoadCaption(delta);
    updateAnim(delta);
    if (watershedView?.group.visible) {
      // 流域视图的时间线：左下角显示年份和一句说明
      const { year, text, shotKey, target } = watershedView.update(delta);
      if (shotKey !== watershedShot) {
        watershedShot = shotKey;
        const { frame } = watershedView;
        goTo(target ? framedPose(target.x, target.z, target.distance, 58, 0) : framedPose(frame.x, frame.z - frame.h * 0.05, Math.min(85000, Math.max(frame.w * 1.9, frame.h * 3.1) * 0.95), 62, 0));
      }
      const html = `<b style="font-size:16px">${year}</b><br>${text}<br><span style="opacity:.6">地形：SRTM 2000；河网为地形推算；石岩水库蓄水为示意</span>`;
      if (terrainLegend.dataset.html !== html) { terrainLegend.innerHTML = html; terrainLegend.dataset.html = html; }
      terrainLegend.style.display = "block";
    }
    updateContext(delta);
    stage.setNight(nightUniform.value);
    const stageStrength = stage.update(delta, clock.elapsedTime);
    atmosphere.setDim(stageStrength); // 舞台光：压低环境光，主体靠聚光灯保持明亮
    const distance = camera.position.distanceTo(controls.target);
    for (const label of stationLabels) {
      const lines = (label.userData.lines as string[] | undefined) ?? [];
      const focusLine = lines.find((l) => stationFocus.has(l));
      if (focusLine) {
        // 正在讲的线：全景也显示；生长中，列车到站才出现并闪一下
        const reached = metroSystem.growthReached(focusLine);
        const at = ((label.userData.at ??= {}) as Record<string, number>);
        at[focusLine] ??= metroSystem.distanceAlong(focusLine, label.position.x, label.position.z);
        const arrived = reached === null || reached >= at[focusLine] - 40;
        label.visible = labelsOn && arrived;
        if (arrived && reached !== null && !label.userData.lit) { label.userData.lit = true; label.element.classList.add(labelClasses.lit); }
        continue;
      }
      const lineShown = lines.length === 0 || lines.some((l) => visibleMetroLines.has(l));
      label.visible = labelsOn && !label.userData.hidden && lineShown && distance < STATION_LABEL_DISTANCE;
    }
    for (const label of waterLabels) label.visible = labelsOn && distance < WATER_LABEL_DISTANCE;
    for (const label of poiLabels) label.visible = !quietLabels && labelsOn && (label.userData.planned ? layers.planned[0].visible : layers.landmarks[0].visible) && distance < WATER_LABEL_DISTANCE;
    // 讲地铁时隐藏片区名，避免压住站名
    for (const label of landmarkLabels) label.visible = labelsOn && stationFocus.size === 0 && !quietLabels;
    atmosphere.followCamera(camera.position);
    waterGpu.update(controls.target);
    flood?.update();
    {
      const fl = atmosphere.fogLight();
      volumeFog.update(controls.target, distance, Math.max(terrain.extent.maxX - terrain.extent.minX, terrain.extent.maxZ - terrain.extent.minZ) * 0.6,
        { dir: fogSunDir.copy(sun.position).sub(controls.target).normalize(), color: sun.color, up: fl.look.sunUp, glow: fl.look.glow, morning: fl.morning }, delta);
    }
    updateNightEffects();
    for (const { material, strength } of landmarkGlows) material.emissiveIntensity = THREE.MathUtils.smoothstep(nightUniform.value, 0.15, 0.6) * strength;
    pipeline.render();
    labelRenderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  // 贴地雾、积雪注入到所有实体材质（水面不积雪、路面积雪少一些）
  weatherShadingUniforms.uGFBase.value = terrain.heightAt(center.x, center.z);
  const noSnow = new Set<THREE.Material>();
  const lightSnow = new Set<THREE.Material>();
  const materialsOf = (root: THREE.Object3D, into: Set<THREE.Material>) => root.traverse((o) => { const mat = (o as THREE.Mesh).material; (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => into.add(x)); });
  materialsOf(water, noSnow);
  materialsOf(roads, lightSnow);
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mat = (o as THREE.Mesh).material;
    (Array.isArray(mat) ? mat : [mat]).forEach((x) => addWeatherShading(x, noSnow.has(x) ? 0 : lightSnow.has(x) ? 0.5 : 1));
  });

  render();

  return {
    setLayer,
    setEffects,
    setNight: atmosphere.setNight,
    setArt: atmosphere.setArt,
    setHour: atmosphere.setHour,
    getHour: atmosphere.getHour,
    setPlaying: atmosphere.setPlaying,
    setMood: atmosphere.setMood,
    setWeather: (kind) => weather.set(kind),
    getWeather: () => ({ mode: weather.getMode(), name: weather.name() }),
    getMood: atmosphere.getMood,
    isArtNight: atmosphere.isArtNight,
    story: story.map(({ id, title, question, body, source, layers, act, motion, watershed }) => ({ id, title, question, body, source, layers, act, seconds: watershed ? 31 : Math.max(9, (motion && "seconds" in motion ? motion.seconds : 0) + 3, (motion?.kind === "fly" ? motion.seconds : 0) + 6) })),
    setStoryStep,
    setAutoOrbit: (on: boolean) => {
      controls.autoRotate = on;
      controls.autoRotateSpeed = 0.35;
    },
    setView: (view) => goTo(poses[view]()),
    flyToLandmark,
    arterials: arterials.map(({ id, name, lengthKm, found, group }) => ({ id, name, lengthKm, found, group })),
    showArterials,
    showTerrainView,
    showWestTimeline,
    showWatershed,
    stats: {
      buildings: data.meta.stats.buildings,
      buildingsWithHeight: data.meta.stats.buildingsWithHeight,
      fillBuildings: data.meta.stats.fillBuildings ?? 0,
      buildingSources: data.meta.stats.buildingSources ?? {},
      trees: trees.count,
      ...metroSystem.stats,
    },
    landmarks: [...data.landmarks.map((landmark) => landmark.name), ...landmarks.placed.filter((item) => item.chip !== false).map((item) => item.name)],
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      controls.dispose();
      pipeline.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(material) ? material : material ? [material] : []).forEach((item) => item.dispose());
      });
      atmosphere.dispose();
      cityLight.dispose();
      weather.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      mount.removeChild(labelRenderer.domElement);
      terrainLegend.remove();
    },
  };
}
