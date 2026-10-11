import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";

/**
 * 深圳科学技术馆（光明新馆）· 公开资料精修 2026-10-11
 * 来源编号对应 reports/landmark-sz-sci-tech-museum-v2/sources.md。
 * 真实依据：
 * - [S0] 保留 OSM/Overture 主、副馆轮廓和既有锚点 113.938781,22.775097；
 *   坐标为 x 东 z 南的绝对米制坐标，不再旋转或平移。135°为既有方位元数据。
 * - [S1,S2] ZHA 建成版：U形体量、面向公园的退台与通高玻璃墙、屋面光伏。
 * - [S2-D12] 长剖面标高 0 / 7.50 / 17.50 / 26 / 34.50 / 43 / 57m；
 *   顶部观景平台；[S4] 中建官方独立确认总高约57m，替代旧地图33m。
 * - [S2-D00,D07] 总平面/屋顶图：中央圆角矩形观景平台开口、两侧窄带、
 *   北西侧独立IMAX绿屋顶、南北入口、东侧地铁接入、外围弧形园路。
 * - [S3] 工务署确认38m通高中庭、2–5层常设展厅；六层见[S2-D06]。
 * 估算（非测绘）：在保留地图轮廓条件下，按图纸比例拟合各层退台、壳体收分、
 * 屋顶开口40×16m与位置、玻璃带宽高、入口雨棚/铺装/园路宽度、副馆14m及屋面坡度。
 * 不模拟室内展厅、完整地形与无法确认的门禁设施。暖白/浅蓝灰为沙盘风格覆盖，
 * 不是实物INCO金属颜色；无贴图、无帧更新，按4种材质合并。
 */

type Pt = [number, number];
type Ctx = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };

const ANCHOR: [number, number] = [113.938781, 22.775097];
const BEARING_DEG = 135;

// 主馆真实轮廓（旧OSM h=33m已被[S2,S4]的57m替代，沙盘本地米制绝对坐标，x 东 z 南）——生成自 scripts/landmarks/sz-sci-tech-museum.mjs
const MAIN_RING: Pt[] = [
  [939.57, -1462.62], [912.17, -1462.82], [907.37, -1459.12], [906.87, -1451.82],
  [918.47, -1435.92], [939.07, -1418.42], [967.77, -1400.32], [998.07, -1384.92],
  [1029.97, -1374.72], [1048.37, -1371.62], [1062.77, -1372.22], [1082.97, -1379.72],
  [1093.27, -1388.62], [1100.17, -1399.82], [1103.17, -1410.32], [1103.67, -1428.82],
  [1100.57, -1440.62], [1091.57, -1456.62], [1072.47, -1473.92], [1053.17, -1487.12],
  [1028.17, -1501.22], [1003.37, -1512.32], [971.57, -1521.12], [959.37, -1521.62],
  [952.57, -1519.62], [949.77, -1515.62], [950.37, -1509.32], [966.57, -1484.12],
  [967.57, -1476.42], [963.47, -1469.42], [957.97, -1466.02],
];
// 副馆真实轮廓（OSM h=14m，绿屋顶副馆，保持与主馆相对位置）
const ANNEX_RING: Pt[] = [
  [889.27, -1530.12], [908.77, -1517.52], [910.97, -1537.42], [915.97, -1545.32],
  [926.87, -1551.02], [949.17, -1551.62], [894.07, -1576.72], [880.67, -1578.72],
  [871.87, -1576.62], [868.37, -1574.02], [864.17, -1566.22], [864.87, -1553.22],
  [874.47, -1541.22],
];

const centroidOf = (ring: Pt[]): Pt => [
  ring.reduce((s, p) => s + p[0], 0) / ring.length,
  ring.reduce((s, p) => s + p[1], 0) / ring.length,
];
const scaleAbout = (ring: Pt[], c: Pt, s: number): Pt[] =>
  ring.map(([x, z]) => [c[0] + (x - c[0]) * s, c[1] + (z - c[1]) * s]);

export function buildShenzhenScienceTechnologyMuseum(ctx: Ctx): THREE.Group {
  const group = new THREE.Group();
  group.name = "深圳科学技术馆（新馆）";

  const materials = {
    silver: new THREE.MeshStandardMaterial({ color: "#f7f5ef", roughness: 0.65, metalness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: "#a8bfcc", roughness: 0.42, metalness: 0.12 }),
    stone: new THREE.MeshStandardMaterial({ color: "#ede4d3", roughness: 0.85 }),
    green: new THREE.MeshStandardMaterial({ color: "#a6b98c", roughness: 0.85 }),
  };
  glowColor(materials.glass, "#ffe2b0", 1.0);
  type Key = keyof typeof materials;
  const batches: Record<Key, THREE.BufferGeometry[]> = { silver: [], glass: [], stone: [], green: [] };
  const add = (key: Key, g: THREE.BufferGeometry) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    batches[key].push(geometry);
  };
  const shape = (ring: Pt[]) => new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const cap = (key: Key, ring: Pt[], y: number, holes: Pt[][] = []) => {
    const outline = shape(ring);
    holes.forEach(h => outline.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z)))));
    const g = new THREE.ShapeGeometry(outline);
    g.rotateX(-Math.PI / 2).translate(0, y, 0);
    add(key, g);
  };
  // 环间只生成侧面，无每层不可见的重复底盖；形状顺序与OSM环保持一致。
  const skin = (key: Key, a: Pt[], b: Pt[], ya: number, yb: number, skip: number[] = []) => {
    const vertices: number[] = [];
    const vertex = (p: Pt, y: number) => vertices.push(p[0], y, p[1]);
    for (let i = 0; i < a.length; i++) {
      if (skip.includes(i)) continue;
      const j = (i + 1) % a.length;
      vertex(a[i], ya); vertex(a[j], ya); vertex(b[j], yb);
      vertex(a[i], ya); vertex(b[j], yb); vertex(b[i], yb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.computeVertexNormals(); add(key, g);
  };
  const slab = (key: Key, ring: Pt[], y: number, h: number) => {
    skin(key, ring, ring, y, y + h); cap(key, ring, y + h);
  };
  const center = centroidOf(MAIN_RING);
  const u: Pt = [Math.SQRT1_2, Math.SQRT1_2];
  const v: Pt = [Math.SQRT1_2, -Math.SQRT1_2];
  const local = (a: number, b: number): Pt => [center[0] + a*u[0] + b*v[0], center[1] + a*u[1] + b*v[1]];
  const rect = (a: number, b: number, length: number, width: number): Pt[] =>
    [[-1,-1],[-1,1],[1,1],[1,-1]].map(([i,j])=>local(a+i*length/2,b+j*width/2));
  const roundedRect = (a: number, b: number, length: number, width: number, radius: number): Pt[] => {
    const ring: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const ca = a + (i < 2 ? 1 : -1) * (length/2-radius);
      const cb = b + (i === 0 || i === 3 ? 1 : -1) * (width/2-radius);
      for (let j=0;j<=2;j++) {
        const t = angle + j*Math.PI/4;
        ring.push(local(ca+radius*Math.sin(t),cb+radius*Math.cos(t)));
      }
    }
    return ring;
  };
  // 图纸比例拟合：保留两翼，取消原来的横向硬裁切；圆头上、下收分。
  const ringAt = (retreat: number, scale: number): Pt[] => MAIN_RING.map(([x,z],i) => {
    const axial=(x-center[0])*u[0]+(z-center[1])*u[1];
    const tail=Math.min(1,Math.max(0,(25-axial)/100));
    const bay=(i>=27 || i===0) ? 12 : 0;
    return [center[0]+(x-center[0])*scale+(retreat*tail+bay)*u[0],
      center[1]+(z-center[1])*scale+(retreat*tail+bay)*u[1]];
  });
  // 主馆基座与内湾前厅铺装；位置为图纸对照估算，地形仍由调用方提供。
  slab("stone", scaleAbout(MAIN_RING, center, 1.055), 0, 1.4);
  slab("stone", [local(-112,-27),local(-105,29),local(-45,33),local(-28,0),local(-50,-35)], 0, 1.35);
  // [S2-D12] 每个level是图纸标高，不把所有层高平均化。
  const levels = [1.4, 7.5, 17.5, 26, 34.5, 43];
  const retreats = [0, 2, 5, 9, 14, 20];
  const scales = [0.91, 0.96, 1, 1, 0.985, 0.96];
  const rings = levels.map((_,i)=>ringAt(retreats[i], scales[i]));
  for (let i=0;i<levels.length-1;i++) {
    const bottom=levels[i], top=levels[i+1];
    const inset=scaleAbout(rings[i],center,0.987);
    const lip=scaleAbout(rings[i+1],center,0.986);
    // 窄玻璃腰线；内湾端部留给贯通中庭玻璃，避免横板封死入口。
    const windows = [
      [5,6,19,20,26,30], [4,5,6,7,18,19,20,21,26,30],
      [6,7,8,15,16,17,18,26,30], [4,5,13,14,19,20,26,30],
      [4,5,6,7,18,19,20,21,26,30],
    ][i];
    const solid = MAIN_RING.map((_,j)=>j).filter(j=>!windows.includes(j));
    skin("glass", inset, inset, bottom, bottom+(i===0?3.2:2.0), solid);
    skin("silver", inset, inset, bottom, bottom+(i===0?3.2:2.0), [...windows,27,28,29]);
    skin("silver", inset, rings[i+1], bottom+(i===0?3.2:2.0), top-0.65, [27,28,29]);
    skin("silver", rings[i+1], lip, top-0.65, top, [27,28,29]);
    skin("silver", rings[i+1], lip, top, top, [27,28,29]);
  }
  // 中庭公园侧通高玻璃墙 [S1,S3]，几何宽度按现有内湾拟合。
  const portal = [rings[0][27], rings[0][30]];
  const portalTop = [rings[5][27], rings[5][30]];
  // 开放的二点条带，显式双面四三角面，不增加封闭玻璃实体。
  const panel = (a: Pt,b: Pt,c: Pt,d: Pt,lo:number,hi:number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute([
      ...[a[0],lo,a[1],b[0],lo,b[1],d[0],hi,d[1],a[0],lo,a[1],d[0],hi,d[1],c[0],hi,c[1]],
      ...[b[0],lo,b[1],a[0],lo,a[1],c[0],hi,c[1],b[0],lo,b[1],c[0],hi,c[1],d[0],hi,d[1]],
    ],3));g.computeVertexNormals();add("glass",g);
  };
  panel(portal[0],portal[1],portalTop[0],portalTop[1],1.4,39.4);
  // [S2-D06,D12,D13] 屋顶开口下为43m观景平台，不再误画为浅玻璃天窗。
  const roofMid=ringAt(25,0.935), roofTop=ringAt(29,0.86);
  skin("glass",rings[5],rings[5],43,44.2);
  skin("silver",rings[5],roofMid,44.2,50);
  skin("silver",roofMid,roofTop,50,57);
  const lightWell=roundedRect(34,-1,40,16,3);
  cap("silver",roofTop,57,[lightWell]);
  skin("silver",lightWell,lightWell,43,57);
  cap("stone",lightWell,43);
  // 屋顶图的两条平行设备/采光窄带，具体用途未确认，浅色示意。
  for(const offset of [-15,13]) slab("glass",rect(34,offset,51,1.5),57.02,0.45);
  // 光伏区只用三块低面数浅蓝灰面域表示，避免把摄影斑纹当成随机孔洞。
  for(const [a,b,l,w] of [[25,-30,62,11],[25,28,62,11],[69,0,11,34]])
    cap("glass",roundedRect(a,b,l,w,3),57.04);

  // IMAX副馆：地图14m尚无独立测高，绿屋顶内退露出白色女儿墙。
  const annexC=centroidOf(ANNEX_RING), annexTop=scaleAbout(ANNEX_RING,annexC,0.96);
  slab("stone",scaleAbout(ANNEX_RING,annexC,1.04),0,1.2);
  skin("silver",ANNEX_RING,annexTop,1.2,14);
  cap("silver",annexTop,14);
  cap("green",scaleAbout(annexTop,annexC,0.90),14.04);
  // 副馆内凹侧与主馆之间的低平台，避免旧版孤立的直盒连接。
  slab("stone",[[908,-1534],[928,-1537],[966,-1511],[951,-1492],[928,-1512]],0,1.35);

  // [S2-D00] 南侧入口白色薄雨棚与两侧翼片；具体构件尺寸估算。
  const canopy=rect(24,-70,28,10);
  slab("silver",canopy,5.8,0.7);
  for(const a of [10,38]) {
    const strip=[local(a-1,-75),local(a+1,-75),local(a+1,-64),local(a-1,-64)];
    skin("silver",strip,strip.map(([x,z])=>[x+7*u[0],z+7*u[1]]),0.6,5.8);
  }
  slab("stone",rect(24,-70,34,20),0,0.5);
  // 南北入口铺装与外围园路：只画馆边近场，不延伸覆盖相邻区数据。
  slab("stone",rect(4,61,24,14),0,0.4);
  const path=(points:Pt[],width:number,key:Key="stone",y=0.12)=>{
    const left:Pt[]=[],right:Pt[]=[];
    points.forEach((p,i)=>{
      const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
      const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const nx=-(b[1]-a[1])/len*width/2,nz=(b[0]-a[0])/len*width/2;
      left.push([p[0]+nx,p[1]+nz]);right.push([p[0]-nx,p[1]-nz]);
    });
    cap(key,[...left,...right.reverse()],y);
  };
  const southRoute=[local(-140,-30),local(-115,-48),local(-65,-66),local(-10,-76),local(48,-70),local(90,-45),local(110,-8),local(106,25)];
  path(southRoute,6);
  path(southRoute.map(([x,z])=>[x-4*v[0],z-4*v[1]]),2,"green",0.18);
  path([local(-105,-43),local(-93,-26),local(-82,-18),local(-55,-10)],5);
  path([local(-120,34),local(-68,56),local(-10,66),local(55,63),local(100,35)],4.5);

  for (const key of Object.keys(materials) as Key[]) {
    if (!batches[key].length) { materials[key].dispose(); continue; }
    const geometry = mergeGeometries(batches[key], false)!;
    batches[key].forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[key]);
    mesh.name = `深圳科技馆/${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 轮廓为沙盘绝对米制坐标，整体落到地面高度（锚点权威）
  group.position.y = ctx.groundAt(ANCHOR);
  group.userData.evidence = {
    bearingDeg: BEARING_DEG,
    anchor: ANCHOR,
    scale: 1,
    referenceDate: "2026-10-11",
    outline: "OSM/Overture 真实轮廓（public/sandbox/landmarks/sz-sci-tech-museum.json）",
    heights: "主馆57m（S2-D12剖面/S4中建）；副馆14m（旧地图，待测）",
    estimated: "退台插值、屋顶开口尺寸定位、窗带/雨棚/园路/副馆高度待测；详见v2报告",
  };
  return group;
}
