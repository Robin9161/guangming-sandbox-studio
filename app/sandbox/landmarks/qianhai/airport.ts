/**
 * 深圳宝安国际机场 · 前海微缩地标（米制原比例，不扩大平面占地）。
 * 真实依据：data/districts/qianhai/airport.json 的 OSM 跑道/滑行道/停机坪/
 * 航站楼/机库；scripts/landmarks/airport.mjs 提取。T3 与卫星厅完整轮廓。
 * Fuksas：https://fuksas.com/zh/shenzen-airport/（蝠鲼与蜂窝双层表皮）。
 * 卫星厅：https://www.caac.gov.cn/PHONE/GLJ_PHONE/ZNGLJ/ZN_XXGK/ZN_HYDT/202112/t20211209_210473.html
 * 估算：屋面起伏、檐高、蜂窝密度、幕墙柱距、滑行道宽 23m、机库高度。
 * 塔台坐标 [113.8073,22.6391] 与造型为估算；T3 北侧/限高90m依据：
 * https://www.sz.gov.cn/szzt2010/wgkzl/jcgk/jcygk/zdzcjc/content/post_12861391.html
 * 公示限高不等于实测高度。未将其当作竣工状态证据。
 * aerodrome 外扩700m仅用于容纳外框遗漏的第三跑道，排除南头直升机场。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type P, type LL, type ColorKey } from "../_landmark-kit";
import airport from "../../../../public/sandbox/landmarks/airport.json";

type Ctx = LandmarkContext;
type Feature = { p: number[][]; sourceIndex: number; name: string | null; ref: string | null };
type Terminal = Feature & { floor: number[]; roof: number[]; hex: number[][] };
export const AIRPORT_ANCHOR: [number, number] = [113.8068242, 22.6301827];
const { origin, k: projectionScale } = airport.meta.projection;
const R = 6378137, RAD = Math.PI / 180;
const mx0 = R * origin[0] * RAD, my0 = R * Math.log(Math.tan(Math.PI / 4 + origin[1] * RAD / 2));
function ll(x: number, z: number): LL {
 return [(mx0 + x / projectionScale) / R / RAD,
  (2 * Math.atan(Math.exp((my0 - z / projectionScale) / R)) - Math.PI / 2) / RAD];
}

export function buildAirport(ctx: Ctx): THREE.Group {
 const k = landmarkKit(ctx, AIRPORT_ANCHOR, "深圳宝安国际机场", "#d6c9ab", {
  roof: "#353b43", stone: "#e3e3dd", silver: "#cbd0d0", accent: "#ffffff",
  wood: "#c6ccca", green: "#929d8b",
 });
 const base = ctx.groundAt(AIRPORT_ANCHOR);
 // 每个采样点只投影/取地高一次；不假定 ctx.project 的原点恰好等于数据原点。
 // 数据与沙盘同为 WebMercator×k：用三个投影点标定线性米制变换，
 // 保留 ctx 的平移/缩放/方向，避免每个网格点重复 Mercator 正反算。
 const o=k.local(ll(0,0)),east=k.local(ll(1000,0)),south=k.local(ll(0,1000));
 const cache = new Map<number, THREE.Vector3>();
 const at = (x: number, z: number): THREE.Vector3 => {
  const key = Math.round(x * 1000) * 100000000 + Math.round(z * 1000);
  let v = cache.get(key);
  if (!v) { const geo = ll(x,z); v = new THREE.Vector3(o[0]+x*(east[0]-o[0])/1000+z*(south[0]-o[0])/1000,ctx.groundAt(geo)-base,o[1]+x*(east[1]-o[1])/1000+z*(south[1]-o[1])/1000);cache.set(key,v); }
  return v;
 };
 const batches: Partial<Record<ColorKey, number[]>> = {};
 const tri = (key: ColorKey, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
  const out = batches[key] ?? (batches[key] = []);
  // 顶面统一朝上，地面可正常受光；kit 为 DoubleSide。
  const up = (b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
  if(up<0)out.push(a.x,a.y,a.z,c.x,c.y,c.z,b.x,b.y,b.z);
  else out.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
 };
 // 幕墙细柱也直接写入白色批次，避免为每根柱分配 BoxGeometry。
 function pillar(x:number,y:number,z:number,h:number) {
  const w=.425,pts=[[x-w,y,z-w],[x+w,y,z-w],[x+w,y,z+w],[x-w,y,z+w],
   [x-w,y+h,z-w],[x+w,y+h,z-w],[x+w,y+h,z+w],[x-w,y+h,z+w]];
  const out=batches.white??(batches.white=[]);
  for(const i of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])out.push(...pts[i]);
 }
 const raised = (x: number,z: number,lift: number) => {const p=at(x,z);return new THREE.Vector3(p.x,p.y+lift,p.z);};
 // 宽带直接写三角面，按不超过60m分段贴地；避免614次路径各自创建BoxGeometry。
 function strip(key: ColorKey, a: number[], b: number[], width: number, lift: number) {
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.01)return;
  const nx=-dz/len*width/2,nz=dx/len*width/2,n=Math.ceil(len/(key==="roof"||key==="accent"?30:60));
  for(let i=0;i<n;i++) {
   const x=a[0]+dx*i/n,z=a[1]+dz*i/n,xx=a[0]+dx*(i+1)/n,zz=a[1]+dz*(i+1)/n;
   const A=raised(x+nx,z+nz,lift),B=raised(xx+nx,zz+nz,lift),C=raised(xx-nx,zz-nz,lift),D=raised(x-nx,z-nz,lift);
   tri(key,A,B,C);tri(key,A,C,D);
  }
 }
 // Exact concave aerodrome, raised 25cm: these ordinary mesh triangles are
 // consumed by landmarkModules' occupied/covered rasters (white models + trees).
 // The landside notch is retained; no rectangle or blanket 700m buffer.
 function groundSurface(key:ColorKey,surface:number[],lift:number) {
  for(let i=0;i<surface.length;i+=6)tri(key,raised(surface[i],surface[i+1],lift),raised(surface[i+2],surface[i+3],lift),raised(surface[i+4],surface[i+5],lift));
 }
 groundSurface("wood",airport.airfield.surface,.25);
 groundSurface("wood",airport.extension.surface,.25);
 for(const f of airport.infields)groundSurface("green",f.surface,.29);
 groundSurface("stone",airport.satelliteApron.surface,.32);
 for(const f of airport.aprons)for(let i=0;i<f.surface.length;i+=6)
  tri("stone",raised(f.surface[i],f.surface[i+1],.32),raised(f.surface[i+2],f.surface[i+3],.32),raised(f.surface[i+4],f.surface[i+5],.32));
 for(const f of airport.taxiways)for(let i=1;i<f.p.length;i++)strip("silver",f.p[i-1],f.p[i],23,.42);
 // 仅绘制宝安三条完整 OSM 轴线；禁止引入南头直升机场 11/29。
 // 第三跑道已于2025年11月29日投运，非施工状态；公称长度3400/3800/3600m。
 // 保留测绘端点（OSM折线长度3411/3812/3622m），不以公称长度裁掉端头。
 const runwaySpecs: Record<string, { length: number; width: number }> = {
  "15/33": { length: 3400, width: 45 },
  "16L/34R": { length: 3800, width: 60 },
  "16R/34L": { length: 3600, width: 45 },
 };
 const runwayEvidence: object[] = [];
 const glyphs: Record<string, string[]> = {
  "1":["010","110","010","010","111"], "3":["111","001","111","001","111"],
  "4":["101","101","111","001","001"], "5":["111","100","111","001","111"],
  "6":["111","100","111","101","111"], L:["100","100","100","100","111"],
  R:["110","101","110","101","101"],
 };
 for(const f of airport.runways) {
  const spec=runwaySpecs[f.ref ?? ""];if(!spec)continue;
  // 用从北向南的完整折线里程放样：东/第三跑道的OSM点序原本相反。
  const path=[...f.p];if(path[0][1]>path[path.length-1][1])path.reverse();
  const cum=[0];for(let i=1;i<path.length;i++)cum.push(cum[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
  const length=cum[cum.length-1];
  const pos=(d:number,off=0):P=>{
   let i=1;while(i<cum.length-1&&cum[i]<d)i++;
   const a=path[i-1],b=path[i],len=cum[i]-cum[i-1],t=(d-cum[i-1])/len;
   return [a[0]+(b[0]-a[0])*t-(b[1]-a[1])/len*off,a[1]+(b[1]-a[1])*t+(b[0]-a[0])/len*off];
  };
  for(let i=1;i<path.length;i++)strip("roof",path[i-1],path[i],spec.width,1.2);
  // 标线是微缩示意：中心线5m宽、45m长；端头/接地/号码适度放大。
  const mark=(a:number,b:number,off:number,w:number)=>strip("accent",pos(a,off),pos(b,off),w,1.65);
  for(let d=220;d<length-220;d+=90)mark(d,Math.min(d+45,length-220),0,5);
  for(const side of [-1,1])mark(0,length,side*(spec.width/2-1.5),2);
  const labels=(f.ref ?? "").split("/");
  for(const end of [0,1]) {
   const sign=end?-1:1;
   const localMark=(start:number,finish:number,off:number,w:number)=>mark(end?length-finish:start,end?length-start:finish,off*sign,w);
   // 每端8条斑马线，保持在45m跑道边界内。
   for(const side of [-1,1])for(let j=0;j<4;j++)localMark(16,70,side*(4+j*4.5),3.2);
   for(const d of [280,440,590])for(const side of [-1,1])localMark(d,d+50,side*spec.width*.29,d===280?7:5);
   // 号码采用地面几何字形而非贴图；北端15/16，南端33/34；阅读方向沿进场方向。
   const label=labels[end],digits=label.slice(0,2),suffix=label.slice(2);
   const paint=(word:string,start:number,height:number)=>{
    const cell=3.5,total=(word.length*4-1)*cell;
    [...word].forEach((letter,k)=>glyphs[letter]?.forEach((row,r)=>[...row].forEach((v,c)=>{
     if(v==="1")localMark(start+(4-r)*height/5,start+(5-r)*height/5,(k*4+c+.5)*cell-total/2,cell);
    })));
   };
   paint(digits,100,60);if(suffix)paint(suffix,172,35);
  }
  runwayEvidence.push({ref:f.ref,nominalLengthM:spec.length,osmLengthM:f.length,drawnLengthM:length,widthM:spec.width,status:"operational",northThreshold:path[0],southThreshold:path[path.length-1]});
 }
 function ring(f: Feature): P[] {return f.p.map(q=>{const p=at(q[0],q[1]);return [p.x,p.z];});}
 // 真实轮廓已离线三角剖分：现场只铺顶面与侧壁，不再执行挤出/三角剖分。
 function deck(key:ColorKey,f:Feature & {floor:number[]},bottom:number,h:number) {
  k.ribbon(key,ring(f),bottom,h);
  const p=f.floor;
  for(let i=0;i<p.length;i+=6){const a=at(p[i],p[i+1]),b=at(p[i+2],p[i+3]),c=at(p[i+4],p[i+5]);
   tri(key,new THREE.Vector3(a.x,bottom+h,a.z),new THREE.Vector3(b.x,bottom+h,b.z),new THREE.Vector3(c.x,bottom+h,c.z));}
 }
 const terminalInfo: {name:string|null; hexagons:number; roofTriangles:number}[]=[];
 for(const t of airport.terminals as Terminal[]) {
  const p=ring(t),sat=t.name==="卫星厅",eave=sat?18:21;
  // 同一航站楼用统一标高，按轮廓最高地面落基础，避免坡地穿屋面。
  const ground=Math.max(...t.p.map(q=>at(q[0],q[1]).y))+.55;
  deck("silver",t,ground-1,2);
  k.ribbon("glazingLight",p,ground+1,eave-1.5);
  k.ribbon("white",p,ground+eave-.5,.5);
  for(let i=0;i<t.roof.length;i+=9) {
   const vertices=[];
   for(let j=0;j<9;j+=3){const v=at(t.roof[i+j],t.roof[i+j+1]);vertices.push(new THREE.Vector3(v.x,ground+t.roof[i+j+2],v.z));}
   tri("white",vertices[0],vertices[1],vertices[2]);
  }
  // 浅色银灰六边形贴片暗示蜂窝；只有少数是暖光玻璃，避免整栋屋面变蓝。
  t.hex.forEach(([x,z,h],i)=>{
   const c=at(x,z),center=new THREE.Vector3(c.x,ground+h,c.z);
   for(let j=0;j<6;j++) {
    const a=at(x+6.5*Math.cos(j*Math.PI/3),z+6.5*Math.sin(j*Math.PI/3));
    const b=at(x+6.5*Math.cos((j+1)*Math.PI/3),z+6.5*Math.sin((j+1)*Math.PI/3));
    tri(i%7===0?"glazingLight":"silver",center,new THREE.Vector3(a.x,center.y,a.z),new THREE.Vector3(b.x,center.y,b.z));
   }
  });
  // 细白幕墙立柱；不另画指廊，真实十字/X形轮廓已包含其体量。
  for(let i=0;i<p.length;i++) {
   const a=p[i],b=p[(i+1)%p.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
   if(len<18)continue;
   for(let d=8;d<len;d+=26)pillar(a[0]+(b[0]-a[0])*d/len,ground+1,a[1]+(b[1]-a[1])*d/len,eave-1);
  }
  terminalInfo.push({name:t.name,hexagons:t.hex.length,roofTriangles:t.roof.length/9});
 }
 // GTC at the south end of T3: estimated elliptical roof, long axis follows
 // the terminal spine. Only its actual footprint masks landside white models.
 const t3=airport.terminals.find(t=>t.name!=="卫星厅")!;
 const axis:P=[.451,.893],cross:P=[.893,-.451];
 const southTip=t3.p.reduce((a,b)=>a[0]*axis[0]+a[1]*axis[1]>b[0]*axis[0]+b[1]*axis[1]?a:b);
 const gc:P=[southTip[0]+axis[0]*68,southTip[1]+axis[1]*68];
 const gp=at(...gc),gy=gp.y;
 const ellipse=(r:number)=>Array.from({length:40},(_,i)=>{
  const angle=i*Math.PI/20;
  const v=at(gc[0]+cross[0]*57*r*Math.cos(angle)+axis[0]*94*r*Math.sin(angle),gc[1]+cross[1]*57*r*Math.cos(angle)+axis[1]*94*r*Math.sin(angle));
  return v;
 });
 const rim=ellipse(1),inner=ellipse(.68);
 k.ribbon("glazingLight",rim.map(v=>[v.x,v.z] as P),gy+1,8);
 for(let i=0;i<40;i++){
  const j=(i+1)%40,a=rim[i].clone().setY(gy+9),b=rim[j].clone().setY(gy+9),c=inner[i].clone().setY(gy+16),d=inner[j].clone().setY(gy+16);
  tri("white",a,b,d);tri("white",a,d,c);tri("white",c,d,new THREE.Vector3(gp.x,gy+19,gp.z));
 }
 // Six short boarding bridges at the northern finger / transverse tips.
 const finger=t3.p.filter(p=>p[0]*axis[0]+p[1]*axis[1]<southTip[0]*axis[0]+southTip[1]*axis[1]-420);
 let bridges=0;
 for(const direction of [cross,[-cross[0],-cross[1]] as P,[-axis[0],-axis[1]] as P]){
  const tip=finger.reduce((a,b)=>a[0]*direction[0]+a[1]*direction[1]>b[0]*direction[0]+b[1]*direction[1]?a:b);
  for(const shift of [-6,6]){
   const x=tip[0]-direction[1]*shift,z=tip[1]+direction[0]*shift,a=raised(x,z,7),b=raised(x+direction[0]*23,z+direction[1]*23,7);
   k.beam("silver",a,b,4,3);k.box("white",b.x,b.y-2,b.z,6,4,6);bridges++;
  }
 }
 // Low-poly parked aircraft: 6-sided fuselage + tapered nose/tail, swept wings,
 // tailplane and fin; 67 triangles each, no textures or per-plane materials.
 const airplaneTriangles=67;
 for(const plane of airport.airplanes){
  const [x,z]=plane.p,ground=at(x,z).y,heading=plane.heading;
  const v=(px:number,py:number,pz:number)=>{
   const p=at(x+px*Math.cos(heading)+pz*Math.sin(heading),z-px*Math.sin(heading)+pz*Math.cos(heading));
   return new THREE.Vector3(p.x,ground+py,p.z);
  };
  const sections=[[-18,.15,3.4],[-12,2,3.6],[11,2,3.6],[20,.1,3.4]];
  for(let i=1;i<sections.length;i++)for(let j=0;j<6;j++){
   const point=(section:number,j:number)=>{const [z,r,y]=sections[section];return v(Math.cos(j*Math.PI/3)*r,y+Math.sin(j*Math.PI/3)*r,z);};
   const a=point(i-1,j),b=point(i-1,(j+1)%6),c=point(i,(j+1)%6),d=point(i,j);tri("white",a,b,c);tri("white",a,c,d);
  }
  for(const side of [-1,1]){
   const wing=[v(side*1.3,3,5),v(side*18,2.7,-5),v(side*18,2.7,-8),v(side*1.3,3,-4)];
   tri("white",wing[0],wing[1],wing[2]);tri("white",wing[0],wing[2],wing[3]);
   tri("white",v(side*1,4,-12),v(side*7,4,-17),v(side*1,4,-17));
  }
  tri("white",v(0,5,-12),v(0,11,-18),v(0,4,-18));
  // The two engine pods add 24 faces; the visible geometry total is 67.
  for(const side of [-1,1]){const a=v(side*6,2,-1),b=v(side*6,2,4);k.beam("white",a,b,2,2);}
 }
 for(const f of airport.hangars) {
  const p=ring(f),g=Math.max(...f.p.map(q=>at(q[0],q[1]).y))+.5;
  deck("silver",f,g,15);deck("white",f,g+15,1.2);
  k.ribbon("glazing",p,g+3,4);
 }
 // 北侧独立塔台：坐标、分层与外形估算，90m仅采用公示限高作展示上限。
 const tower:LL=[113.8073,22.6391],tp=k.local(tower),tg=k.yAt(tower)+.5;
 k.cylinder("silver",tp[0],tp[1],tg,17,4,17,8);
 k.cylinder("white",tp[0],tp[1],tg+4,8,65,5.4,8);
 k.cylinder("silver",tp[0],tp[1],tg+69,5.4,7,14,8);
 k.cylinder("glazing",tp[0],tp[1],tg+76,14,7,15,8);
 k.cylinder("white",tp[0],tp[1],tg+83,16,2,14,8);
 k.cylinder("silver",tp[0],tp[1],tg+85,.6,5,.3,6);
 for(const [key,positions] of Object.entries(batches))if(positions.length)k.triangles(key as ColorKey,positions);
 const group=k.finish();
 // 远距离深度精度不足时，0.1m高度差会让标线与跑道互相闪烁。
 // 专用标线材质做深度偏移；不影响航站楼白色屋面。
 for(const child of group.children)if(child instanceof THREE.Mesh) {
  const mat=child.material as THREE.MeshStandardMaterial;
  const key=child.name.split("/").at(-1) as ColorKey;
  // Ground layers must not cast coarse 8km shadow-map triangles onto each
  // other. Silver also contains the taxiway surface; roofs remain in white.
  if(["wood","green","stone","silver","roof","accent"].includes(key))child.castShadow=false;
  // Decimetre-separated ground layers quantize to the same depth at 6–8km.
  // Draw them in explicit order without writing depth, while still testing
  // against terrain/buildings. This avoids grass/apron speckling and keeps
  // terminal roofs occluding ground; no large depth bias on rooftop silver.
  const layer:Partial<Record<ColorKey,number>>={wood:1,green:2,stone:3,silver:4,roof:5,accent:6};
  if(layer[key])child.renderOrder=layer[key]!;
  if(layer[key]&&key!=="silver"){
   mat.depthWrite=false;mat.polygonOffset=true;
   mat.polygonOffsetFactor=-.1;mat.polygonOffsetUnits=-1;
  }
 }
 group.userData.evidence={source:airport.meta.source,filter:airport.meta.counts,runways:runwayEvidence,markings:{miniatureExaggeration:true,centerlineWidthM:5,numberHeightM:60},runwayStatusSource:"https://www.sz.gov.cn/cn/xxgk/zfxxgj/bmdt/content/post_12527447.html",terminals:terminalInfo,tower:{lngLat:tower,estimated:true},airplanes:airport.airplanes.length,airplaneTriangles,boardingBridges:bridges,gtc:{center:gc,estimated:true},surfaces:airport.meta.surfaceSummary,runwayOperationalSince:"2025-11-29"};
 return group;
}
