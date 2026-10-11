/**
 * 罗湖核心：地王大厦、深圳站、罗湖口岸。
 * 真实依据：public/sandbox/districts/luohu/sandbox.json buildings[1687/5533/5478]
 * 的米制轮廓；名称由本地 Overture 的 OSM w64601041@20 / w174194694@19 /
 * w189787553@14 交叉核对，提取证据见 public/sandbox/landmarks/diwang-sz-station.json。
 * 地王 384m（含桅杆）、双塔与方圆并置：https://www.sz.gov.cn/szstory/202302/content/post_10421146.html
 * 屋顶 324.8m：https://pnr.sz.gov.cn/attachment/1/1285/1285348/10537364.pdf
 * 口岸与河、桥关系：https://ka.sz.gov.cn/bmfw/katgfw/lhkazt/
 * 深圳站：https://www.szlh.gov.cn/zwfw/ztzq/gylhlcdbdaysdtx2026ngjdarxszl/sncq/content/post_12804588.html
 * 估算：冠部曲率、桅杆截面、柱距、站房屋面层级/门厅、铺装、树池与河段。
 * 数据中地王 h=69.5/e=1 不作真实塔高使用。站房 h=19.2、口岸 h=35.2 为数据高度，非测绘承诺。
 * 给定约略坐标与具名 OSM 轮廓不重合，采用轮廓形心反投影；不擅自认定坐标系。
 * 各建筑绕自身地面放大 1.25×，不放大地标之间距离；河道保持原比例。
 * 白/暖白框、浅蓝灰玻璃；kit glazing/glazingLight 保留昼夜发光；无纹理，按颜色合批。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type P, type LL, type ColorKey } from "../_landmark-kit";
import evidence from "../../../../public/sandbox/landmarks/diwang-sz-station.json";
type Ctx = LandmarkContext;
type V = [number, number, number];
const SCALE = 1.25;
const { origin, k: pk } = evidence.meta.projection;
function lngLat(x: number, z: number): LL {
  const r = 6378137, rad = Math.PI / 180;
  return [origin[0] + x / (r * rad * pk), (2 * Math.atan(Math.exp(Math.log(Math.tan(Math.PI / 4 + origin[1] * rad / 2)) - z / (r * pk))) - Math.PI / 2) / rad];
}
function centroid(p: P[]): P {
  let a = 0, x = 0, z = 0;
  p.forEach((v, i) => { const q = p[(i + 1) % p.length], t = v[0] * q[1] - q[0] * v[1]; a += t; x += (v[0] + q[0]) * t; z += (v[1] + q[1]) * t; });
  return [x / (3 * a), z / (3 * a)];
}
const rings: P[][] = evidence.features.map(f => Array.from({ length: f.ring.length / 2 }, (_, i): P => [f.ring[i * 2], f.ring[i * 2 + 1]]));
const centers = rings.map(centroid);
export const LUOHU_CORE_ANCHOR: [number, number] = lngLat(...centers[0]);

export function buildLuohuCore(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, LUOHU_CORE_ANCHOR, "地王大厦 · 深圳站", "#d3b49c", {
    silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc", glazingLight: "#cfdde4", roof: "#d5dce0",
  });
  // 小构件直接写三角面；避免数百个临时 BufferGeometry。
  const faces: Partial<Record<ColorKey, number[]>> = {};
  const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => {
    const out = faces[key] ?? (faces[key] = []); out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const part = (index: number, angle: number) => {
    const ll = lngLat(...centers[index]), c = k.local(ll), y = k.yAt(ll), ca = Math.cos(angle), sa = Math.sin(angle);
    const at = (x: number, h: number, z: number): V => [c[0] + SCALE * (x * ca - z * sa), y + h * SCALE, c[1] + SCALE * (x * sa + z * ca)];
    const box = (key: ColorKey, x: number, h: number, z: number, w: number, height: number, depth: number) => {
      const p = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => at(x+u*w/2,h,z+v*depth/2));
      const q = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => at(x+u*w/2,h+height,z+v*depth/2));
      quad(key,p[0],p[1],p[2],p[3]);quad(key,q[3],q[2],q[1],q[0]);
      for(let i=0;i<4;i++)quad(key,p[i],q[i],q[(i+1)%4],p[(i+1)%4]);
    };
    const ring = rings[index].map(([x,z]) => {const p=k.local(lngLat(x,z));return [c[0]+(p[0]-c[0])*SCALE,c[1]+(p[1]-c[1])*SCALE] as P;});
    const slab = (key: ColorKey, h: number, height: number) => k.slab(key,ring,y+h*SCALE,height*SCALE);
    return {at,box,slab,ring,y,c};
  };
  // 地王长轴略偏北西；真实轮廓包含两端圆弧和中部矩形的凹凸。
  const t = part(0, -0.342), towerRing=t.ring;
  t.slab("glazing",0,298.3);
  t.slab("silver",0,5.2);
  // 每约两层一道浅白分格，竖肋沿真实轮廓插值，不以圆柱替代塔身。
  for(let i=0;i<towerRing.length;i++){
    const a=towerRing[i],b=towerRing[(i+1)%towerRing.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/4.8));
    for(let j=0;j<n;j++){
      const f=j/n,ff=Math.min(1,f+.48*SCALE/len),a0:P=[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],b0:P=[a[0]+(b[0]-a[0])*ff,a[1]+(b[1]-a[1])*ff];
      const expand=(p:P):P=>[t.c[0]+(p[0]-t.c[0])*1.003,t.c[1]+(p[1]-t.c[1])*1.003];const u=expand(a0),v=expand(b0);
      quad("silver",[u[0],t.y+5*SCALE,u[1]],[u[0],t.y+298.3*SCALE,u[1]],[v[0],t.y+298.3*SCALE,v[1]],[v[0],t.y+5*SCALE,v[1]]);
    }
  }
  for(let y=9;y<298;y+=8.5)k.ribbon("silver",towerRing.map(([x,z])=>[t.c[0]+(x-t.c[0])*1.004,t.c[1]+(z-t.c[1])*1.004]),t.y+y*SCALE,.32*SCALE);
  // 弧形拱冠：分段椭圆剖面，双端圆鼓托起两根独立桅杆。
  for(let i=0;i<16;i++){
    const a=-Math.PI/2+i*Math.PI/16,b=a+Math.PI/16;
    const x0=16*Math.sin(a),x1=16*Math.sin(b),y0=299+25.8*Math.cos(a),y1=299+25.8*Math.cos(b);
    quad(i%4===0?"glazingLight":"silver",t.at(x0,y0,-22),t.at(x0,y0,22),t.at(x1,y1,22),t.at(x1,y1,-22));
    for(const z of [-22,22])quad("glazingLight",t.at(x0,298.3,z),t.at(x0,y0,z),t.at(x1,y1,z),t.at(x1,298.3,z));
  }
  for(const z of [-23.7,23.7]){
    const p=t.at(0,0,z);k.cylinder("glazingLight",p[0],p[2],t.y+293*SCALE,9*SCALE,30*SCALE,8*SCALE,16);
    k.cylinder("silver",p[0],p[2],t.y+322*SCALE,8.8*SCALE,2.8*SCALE,8.8*SCALE,16);
    k.cylinder("silver",p[0],p[2],t.y+324.8*SCALE,2.3*SCALE,39.2*SCALE,.9*SCALE,10);
    k.cylinder("white",p[0],p[2],t.y+364*SCALE,.9*SCALE,20*SCALE,.18*SCALE,8);
    for(const y of [333,346,359])k.cylinder("white",p[0],p[2],t.y+y*SCALE,2.6*SCALE,.7*SCALE,2.6*SCALE,10);
  }
  t.box("stone",0,-.4,0,49,.4,82);
  t.box("glazingLight",0,0,36,24,6,9);t.box("white",0,6,37,29,.8,11);
  // 深圳站：数据轮廓长轴近南北；低矮宽站房、东向门厅、层叠檐口、纵向采光带。
  const s=part(1,-.137);
  s.slab("white",0,19.2);s.slab("silver",19.2,.9);
  s.box("glazing",64,3,0,1.2,13,175);
  for(let z=-84;z<=84;z+=12)s.box("white",65,2.5,z,2.3,16,2);
  s.box("white",70,14,0,14,1.5,194);
  s.box("glazingLight",0,20,-8,81,7,138);s.box("white",0,27,-8,86,1.1,146);
  for(const x of [-24,24])s.box("glazingLight",x,28.1,-8,8,.45,134);
  s.box("white",70,0,0,20,3,60);s.box("glazing",71,3,0,8,11,47);
  // 入口中央弧形雨棚，宽边朝向东广场；不套用高铁站整体拱顶。
  for(let j=0;j<12;j++){
    const z0=-32+j*64/12,z1=z0+64/12,y0=16+5*Math.cos(z0/32*Math.PI/2),y1=16+5*Math.cos(z1/32*Math.PI/2);
    quad("white",s.at(65,y0,z0),s.at(85,y0,z0),s.at(85,y1,z1),s.at(65,y1,z1));
  }
  // 红色几何站名“深圳”（7×7点阵，非纹理，非书法复刻）。
  const words=[['1001010','0011111','1000000','0010101','1011111','1010101','1101001'],['1001010','1001010','1111010','1001010','1001010','1011010','1101010']];
  words.forEach((rows,g)=>rows.forEach((row,i)=>[...row].forEach((v,j)=>{if(v==='1')s.box("red",68,29+(6-i)*.85,(g*9+j-8)*.85,1,.72,.72);} )));
  s.box("stone",106,-.45,0,62,.45,194);
  for(let z=-88;z<=88;z+=22)s.box("white",108,.03,z,57,.045,.22);
  for(const z of [-76,-38,38,76]){s.box("white",128,0,z,8,.6,8);s.box("green",128,.6,z,7,.2,7);const p=s.at(128,.8,z);k.tree(p[0],p[2],p[1],3.3);}
  // 西侧窄站台雨棚暗示铁路属性，限制在近身范围，避免覆盖周边街区。
  for(const x of [-53,-30]){
    s.box("roof",x,20.2,0,16,.5,200);s.box("white",x,21,0,19,1.2,200);
    s.box("glazingLight",x,22.2,0,3,.25,192);
  }
  // 联检楼独立地高/锚点；阶梯裙房、上层窗口及出入境连廊为简化。
  const p=part(2,-.16);p.slab("white",0,35.2);p.slab("silver",35.2,1);
  for(let y=7;y<34;y+=6)k.ribbon("glazingLight",p.ring.map(([x,z])=>[p.c[0]+(x-p.c[0])*1.003,p.c[1]+(z-p.c[1])*1.003]),p.y+y*SCALE,2.5*SCALE);
  p.box("white",0,36.2,-8,57,2,46);p.box("stone",0,-.4,0,97,.4,113);
  p.box("white",2,8,72,12,1.6,44);p.box("glazingLight",2,9.6,72,10,3.8,44);p.box("white",2,13.4,72,13,.7,44);
  // 河段示意：窄带独立地理坐标，无跨地王—车站的大底板。
  k.geoPath("water",[[114.11245,22.53001],[114.11305,22.5299],[114.11365,22.52992],[114.11415,22.53016]],25,.15);
  for(const key of Object.keys(faces) as ColorKey[])k.triangles(key,faces[key]!);
  const group=k.finish();
  group.userData.evidence={district:"luohu",scale:SCALE,height:384,roofHeight:324.8,anchors:centers.map(c=>lngLat(...c)),sourceIndices:evidence.features.map(f=>f.sourceIndex),estimated:"屋顶细分、立面、广场、河段、连廊；见文件头与报告"};
  return group;
}
