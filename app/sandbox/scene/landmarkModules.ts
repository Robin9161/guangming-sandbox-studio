import * as THREE from "three";
import { buildDadinglingBridges } from "../landmarks/dadingling-bridges";
import { buildFenghuangTownStation } from "../landmarks/fenghuang-town-station";
import { buildGongmingOldMarket } from "../landmarks/gongming-old-market";
import { buildGongmingSquare } from "../landmarks/gongming-square";
import { buildGuangmingEquestrianCenter } from "../landmarks/guangming-equestrian-center";
import { buildGuangmingHighSchools } from "../landmarks/guangming-high-schools";
import { buildGuangmingLake } from "../landmarks/guangming-lake";
import { buildGuangmingMassSportsCenter } from "../landmarks/guangming-mass-sports-center";
import { buildGuangmingMiddleSchools } from "../landmarks/guangming-middle-schools";
import { buildGuangmingPrimarySchools } from "../landmarks/guangming-primary-schools";
import { buildHappyFarmland } from "../landmarks/happy-farmland";
import { buildHonghuashanPark } from "../landmarks/honghuashan-park";
import { buildMallBluewhale } from "../landmarks/mall-bluewhale";
import { buildMallCocoCity } from "../landmarks/mall-coco-city";
import { buildMallWanda } from "../landmarks/mall-wanda";
import { buildNantaiInnoValley } from "../landmarks/nantai-inno-valley";
import { buildNiushanPark } from "../landmarks/niushan-park";
import { buildGuangmingCultureArtCenter } from "../landmarks/guangming-culture-art-center";
import { buildGuangmingchengStation } from "../landmarks/guangmingcheng-station";
import { buildGuangmingding } from "../landmarks/guangmingding";
import { buildScienceFacilities } from "../landmarks/science-facilities";
import { buildScienceParkDetails } from "../landmarks/science-park-details";
import { buildShenzhenInternationalArtMuseum } from "../landmarks/shenzhen-international-art-museum";
import { buildShenzhenScienceTechnologyMuseum } from "../landmarks/sz-sci-tech-museum";
import { buildUniversitySysuShenzhen } from "../landmarks/university-sysu-shenzhen";
import { buildChunsun, CHUNSUN_ANCHOR } from "../landmarks/nanshan/chunsun";
import { buildRencaiPark, RENCAI_PARK_ANCHOR } from "../landmarks/nanshan/rencai-park";
import { AIRPORT_ANCHOR, buildAirport } from "../landmarks/qianhai/airport";
import { buildPinganIfc, PINGAN_IFC_ANCHOR } from "../landmarks/futian/pingan-ifc";
import { buildFutianCivic, FUTIAN_CIVIC_ANCHOR } from "../landmarks/futian/futian-civic";
import { buildShenzhenNorthStation, SZ_NORTH_ANCHOR } from "../landmarks/longhua/shenzhen-north-station";
import { buildUniversiadeCenter, UNIVERSIADE_ANCHOR } from "../landmarks/longgang/universiade-center";
import { buildChunjian, CHUNJIAN_ANCHOR } from "../landmarks/nanshan/chunjian";
import { buildLuohuCore, LUOHU_CORE_ANCHOR } from "../landmarks/luohu/diwang-sz-station";
import { buildSzWorldExhibition, SZ_WORLD_EXPO_ANCHOR } from "../landmarks/qianhai/sz-world-exhibition";
import { buildTencentSeafront, TENCENT_SEAFRONT_ANCHOR } from "../landmarks/nanshan/tencent-seafront";
import { BAY_LIGHT_WHEEL_ANCHOR, buildBayLightWheel } from "../landmarks/qianhai/bay-light-wheel";
import { projectLngLat } from "./landmarks";
import { Raster, type Terrain } from "./terrain";
import type { SandboxData } from "./types";

type LngLat = [number, number];
type Ctx = { project: (lngLat: LngLat) => THREE.Vector3; groundAt: (lngLat: LngLat) => number };

/**
 * 精细地标注册表：app/sandbox/landmarks/ 下各模块（统一接口 build(ctx) → Group）。
 * planned = true 表示规划效果图重建、不是现状，标签会注明"规划示意"。
 * 中山大学有两个版本，使用较新的 university-sysu-shenzhen（sysu-shenzhen 不再接入）。
 * 红花山公园自带明和塔（已放大），不再单独接入 honghuashan-minghe-tower。
 * label = false：不出标签、不进地标列表（学校分布全区，没有单一位置；光明湖已有片区标签）。
 * chip = false：地图上有标签，但不放进面板的片区按钮（商场、场馆等次要地点，避免按钮过多）。
 */
/** hd：近景高精度模型（glb，本地米制：原点=anchor 地面，+x 东、+y 上、+z 南），镜头靠近时替换低精度模型 */
const MODULES: { name: string; anchor: LngLat; build: (ctx: Ctx) => THREE.Group; planned?: boolean; label?: false; chip?: false; hd?: { url: string; near: number } }[] = [
  { name: "深圳科学技术馆", anchor: [113.938781, 22.775097], build: buildShenzhenScienceTechnologyMuseum, hd: { url: "/sandbox/landmarks/hd/sz-sci-tech-museum.glb", near: 1600 } },
  { name: "深圳国际美术馆", anchor: [113.934026, 22.774474], build: buildShenzhenInternationalArtMuseum },
  { name: "光明文化艺术中心", anchor: [113.932078, 22.749634], build: buildGuangmingCultureArtCenter },
  { name: "光明城站", anchor: [113.9499, 22.73558], build: buildGuangmingchengStation },
  { name: "中山大学深圳校区", anchor: [113.948192, 22.80366], build: buildUniversitySysuShenzhen },
  { name: "大科学装置", anchor: [113.95915, 22.8125], build: buildScienceFacilities },
  { name: "光明顶", anchor: [113.940103, 22.783972], build: buildGuangmingding },
  { name: "红花山公园", anchor: [113.896767, 22.783882], build: buildHonghuashanPark },
  { name: "公明老墟", anchor: [113.881356, 22.787551], build: buildGongmingOldMarket },
  { name: "公明广场", anchor: [113.890456, 22.780552], build: buildGongmingSquare, chip: false },
  { name: "凤凰城站", anchor: [113.928026, 22.75046], build: buildFenghuangTownStation, chip: false },
  { name: "光明湖", anchor: [113.9735, 22.78025], build: buildGuangmingLake, label: false },
  { name: "光明新城公园", anchor: [113.938713, 22.750487], build: buildNiushanPark },
  { name: "大顶岭绿道", anchor: [113.965285, 22.759485], build: buildDadinglingBridges, chip: false },
  { name: "光明马术中心", anchor: [113.959333, 22.760787], build: buildGuangmingEquestrianCenter, chip: false },
  { name: "光明群众体育中心", anchor: [113.943552, 22.751749], build: buildGuangmingMassSportsCenter, chip: false },
  { name: "光明农场·欢乐田园", anchor: [113.9566, 22.77872], build: buildHappyFarmland, chip: false },
  { name: "光明万达", anchor: [113.926781, 22.75161], build: buildMallWanda, chip: false },
  { name: "蓝鲸世界", anchor: [113.929128, 22.749573], build: buildMallBluewhale, chip: false },
  { name: "光明COCO City", anchor: [113.93534, 22.76248], build: buildMallCocoCity, chip: false },
  { name: "南太云创谷", anchor: [113.91522, 22.73948], build: buildNantaiInnoValley, chip: false },
  { name: "高中", anchor: [113.935, 22.765], build: buildGuangmingHighSchools, label: false },
  { name: "初中", anchor: [113.935, 22.765], build: buildGuangmingMiddleSchools, label: false },
  { name: "小学", anchor: [113.935, 22.765], build: buildGuangmingPrimarySchools, label: false },
  { name: "科学公园（规划示意）", anchor: [113.9332592, 22.7778381], build: buildScienceParkDetails, planned: true },
];

export type LandmarkSet = {
  group: THREE.Group;
  /** 规划效果图重建（不是现状），单独成组，默认隐藏 */
  plannedGroup: THREE.Group;
  placed: { name: string; position: THREE.Vector3; top: number; planned?: boolean; chip?: false }[];
  /** 现状地标所有部件的俯视占地栅格化：用于移除下方的普通白模 */
  occupied: Raster;
  /** 地标所有部件（含公园地面）覆盖范围：普通树木不再种在这里，与地标自带的绿化融合 */
  covered: Raster;
  /** 有近景高精度版本的地标：低精度模型 + glb 地址 + 切换距离 */
  hdSlots: { name: string; low: THREE.Group; origin: THREE.Vector3; url: string; near: number }[];
};

const RASTER_SIZE = 2048;

// 其他区的精细地标：按区 id 登记，只在该区加载
const DISTRICT_MODULES: Record<string, typeof MODULES> = {
  qianhai: [{ name: "深圳宝安国际机场", anchor: AIRPORT_ANCHOR, build: buildAirport, chip: false },
    { name: "深圳国际会展中心", anchor: SZ_WORLD_EXPO_ANCHOR, build: buildSzWorldExhibition, chip: false },
    { name: "湾区之光摩天轮", anchor: BAY_LIGHT_WHEEL_ANCHOR, build: buildBayLightWheel },
  ],
  futian: [
    { name: "平安金融中心", anchor: PINGAN_IFC_ANCHOR, build: buildPinganIfc },
    { name: "市民中心·福田站", anchor: FUTIAN_CIVIC_ANCHOR, build: buildFutianCivic },
  ],
  luohu: [{ name: "地王大厦·深圳站", anchor: LUOHU_CORE_ANCHOR, build: buildLuohuCore }],
  longhua: [{ name: "深圳北站", anchor: SZ_NORTH_ANCHOR, build: buildShenzhenNorthStation }],
  longgang: [{ name: "大运中心", anchor: UNIVERSIADE_ANCHOR, build: buildUniversiadeCenter }],
  nanshan: [{ name: "华润大厦·春笋", anchor: CHUNSUN_ANCHOR, build: buildChunsun },
    { name: "深圳人才公园", anchor: RENCAI_PARK_ANCHOR, build: buildRencaiPark },
    { name: "深圳湾体育中心·春茧", anchor: CHUNJIAN_ANCHOR, build: buildChunjian },
    { name: "腾讯滨海大厦", anchor: TENCENT_SEAFRONT_ANCHOR, build: buildTencentSeafront },
  ],
};

export function buildLandmarkModules(data: SandboxData, terrain: Terrain, district = "guangming"): LandmarkSet {
  const ctx: Ctx = {
    project: (lngLat) => {
      const [x, z] = projectLngLat(data, lngLat[0], lngLat[1]);
      return new THREE.Vector3(x, 0, z);
    },
    groundAt: (lngLat) => {
      const [x, z] = projectLngLat(data, lngLat[0], lngLat[1]);
      return terrain.heightAt(x, z);
    },
  };
  const group = new THREE.Group();
  group.name = "landmark-modules";
  const plannedGroup = new THREE.Group();
  plannedGroup.name = "landmark-modules-planned";
  plannedGroup.visible = false;
  const placed: LandmarkSet["placed"] = [];
  const hdSlots: LandmarkSet["hdSlots"] = [];
  const roofs: number[] = [];
  const covers: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const module of district === "guangming" ? MODULES : DISTRICT_MODULES[district] ?? []) {
    let model: THREE.Group;
    try {
      model = module.build(ctx);
    } catch (error) {
      console.warn(`landmark ${module.name} failed`, error);
      continue;
    }
    (module.planned ? plannedGroup : group).add(model);
    model.updateMatrixWorld(true);
    if (module.hd) { const o = ctx.project(module.anchor); hdSlots.push({ name: module.name, low: model, origin: new THREE.Vector3(o.x, ctx.groundAt(module.anchor), o.z), ...module.hd }); }
    // 逐三角形栅格化（不用包围盒：学校等模块把全区几十个校园合并成一个 Mesh，包围盒会覆盖整个区）
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const position = mesh.geometry.getAttribute("position");
      if (!position) return;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const [ia, ib, ic] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
        a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
        // 俯视面积很小的三角形（墙面、细杆）不影响占地，跳过
        const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
        if (Math.abs(normal.y) < 2) continue;
        const cx = (a.x + b.x + c.x) / 3;
        const cz = (a.z + b.z + c.z) / 3;
        const above = (a.y + b.y + c.y) / 3 - terrain.heightAt(cx, cz);
        // 规划示意只挡住它的立体部分，地面铺装下的现状树木保留
        if (!module.planned || above > 2) covers.push(a.x, a.z, b.x, b.z, c.x, c.z);
        // 现状地标的所有部件（屋顶、广场、园路、公园地面）都让普通白模让位，与新模型融合
        if (!module.planned) roofs.push(a.x, a.z, b.x, b.z, c.x, c.z);
      }
    });
    if (module.label === false) continue;
    const anchor = ctx.project(module.anchor);
    const top = new THREE.Box3().setFromObject(model).max.y;
    placed.push({ name: module.name, position: new THREE.Vector3(anchor.x, ctx.groundAt(module.anchor), anchor.z), top: Number.isFinite(top) ? top : ctx.groundAt(module.anchor) + 30, planned: module.planned, chip: module.chip });
  }
  const occupied = new Raster(RASTER_SIZE, terrain.bounds);
  occupied.fillTriangles(roofs);
  const covered = new Raster(RASTER_SIZE, terrain.bounds);
  covered.fillTriangles(covers);
  return { group, plannedGroup, placed, occupied, covered, hdSlots };
}
