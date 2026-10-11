/**
 * 深圳大运中心 · 龙岗龙城，三座独立的折面水晶场馆。
 * 真实依据：OSM stadium relation/3220465（outer way/166214606，inner/238845586）、
 * 体育馆 way/219058187、游泳馆 way/238462822、青春湖 way/238466886。
 * https://www.openstreetmap.org/relation/3220465
 * Overpass 不可用，改从 https://api.openstreetmap.org/api/0.6/map?bbox=114.207,22.695,114.215,22.704
 * 取得同源原始数据；完整 XML 与投影轮廓保存在 public/sandbox/landmarks/universiade-center.json。
 * 未写 data/landmarks/，遵守本任务只允许新增的四个路径。龙岗 sandbox 尚未存在。
 * gmp：三角半透明表皮、折叠钢结构、人工湖串联三馆，容量 60000/18000/3000。
 * https://www.gmp.de/en/projects/531/universiade-2011-sports-center
 * 实景参考：gmp_2001_CG33-06_40568.jpg（Christian Gahl），主场屋面开口与锯齿晶冠。
 * 估算：三馆峰高 52/38/30m、折峰节奏、框杆截面、三层看台、入口和铺装。
 * 真实平面经径向采样作低多边形概括；泳馆保留方形斜置轮廓，非圆形复制。
 * 以三馆群锚点地面整体等比放大 1.25×，含馆间距；不移动到用户提供的东侧约略点。
 * 暖白结构 + 春笋同款浅蓝灰；夜景使用 kit.glazing/glazingLight，无贴图、无透明。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type P, type ColorKey, scaled, mean } from "../_landmark-kit";
import { features, meta } from "../../../../public/sandbox/landmarks/universiade-center.json";

type Ctx = LandmarkContext;
type V = [number, number, number];
export const UNIVERSIADE_ANCHOR: [number, number] = [114.2113, 22.6994];
const SCALE = 1.25;
const TAU = Math.PI * 2;

export function buildUniversiadeCenter(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, UNIVERSIADE_ANCHOR, "深圳大运中心", "#dfb3a7", {
    silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc", glazingLight: "#cfdde4",
    roof: "#b5c7d0", water: "#a0c9cc", green: "#b8cba0", stone: "#ece6d9",
  });
  const batches: Partial<Record<ColorKey, number[]>> = {};
  const tri = (key: ColorKey, a: V, b: V, c: V) => {
    const out = batches[key] ?? (batches[key] = []); out.push(...a, ...b, ...c);
  };
  const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => { tri(key,a,b,c); tri(key,a,c,d); };
  const mix = (a: V, b: V, t: number): V => a.map((x,i)=>x+(b[i]-x)*t) as V;
  // 合批实心方杆，不为每条三角边创建 BufferGeometry。
  const beam = (a: V, b: V, width: number, key: ColorKey = "white") => {
    const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)); if(d.lengthSq()<1e-8)return;
    d.normalize(); const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y)>.95?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)).normalize().multiplyScalar(width/2);
    const v = new THREE.Vector3().crossVectors(d,u).normalize().multiplyScalar(width/2);
    const ends = [a,b].map(p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t]):V=>[p[0]+u.x*s+v.x*t,p[1]+u.y*s+v.y*t,p[2]+u.z*s+v.z*t]));
    for(let i=0;i<4;i++)quad(key,ends[0][i],ends[0][(i+1)%4],ends[1][(i+1)%4],ends[1][i]);
    quad(key,...[ends[0][3],ends[0][2],ends[0][1],ends[0][0]] as [V,V,V,V]);
    quad(key,...ends[1] as [V,V,V,V]);
  };
  // 薄面细分格每段仅 2 面，主结构仍为实体方杆。
  const gridLine=(a:V,b:V,normal:THREE.Vector3)=>{
    const u=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).cross(normal).normalize().multiplyScalar(.13);
    quad("silver",[a[0]+u.x,a[1]+u.y,a[2]+u.z],[b[0]+u.x,b[1]+u.y,b[2]+u.z],[b[0]-u.x,b[1]-u.y,b[2]-u.z],[a[0]-u.x,a[1]-u.y,a[2]-u.z]);
  };
  // 大折面内 4 等分细三角网：浅色不透明玻璃，结构与面板偏移避免共面闪烁。
  const panel = (a: V,b: V,c: V,key: ColorKey,detail=true) => {
    const normal = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a))).normalize();
    const lift=(p:V):V=>[p[0]+normal.x*.15,p[1]+normal.y*.15,p[2]+normal.z*.15];
    tri(key,a,b,c);
    if(detail)for(let j=1;j<4;j++) {
      const t=j/4;gridLine(lift(mix(a,b,t)),lift(mix(a,c,t)),normal);
      gridLine(lift(mix(b,a,t)),lift(mix(b,c,t)),normal);
      gridLine(lift(mix(c,a,t)),lift(mix(c,b,t)),normal);
    }
  };
  const ring = (name:keyof typeof features):P[] => features[name].lngLat.map(ll=>k.local(ll));
  // 从真实多边形向边界发射射线，保留方馆斜边及主场椭圆内孔；不是套用圆柱轮廓。
  const radial = (p:P[],center:P,angle:number):P => {
    const dx=Math.cos(angle),dz=Math.sin(angle); let hit=Infinity;
    for(let i=0;i<p.length;i++) {
      const a=p[i],b=p[(i+1)%p.length],ex=b[0]-a[0],ez=b[1]-a[1],den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-9)continue;
      const ax=a[0]-center[0],az=a[1]-center[1],t=(ax*ez-az*ex)/den,u=(ax*dz-az*dx)/den;
      if(t>0&&u>=0&&u<=1)hit=Math.min(hit,t);
    }
    if(!Number.isFinite(hit))throw new Error("Universiade footprint ray missed");
    return [center[0]+dx*hit,center[1]+dz*hit];
  };
  const lake=ring("lake");
  k.slab("stone",scaled(lake,1.028),.08,.38);
  k.slab("water",lake,.48,.15);
  // 不做整块包围矩形底板：只让真实水面、近身平台和场馆三角形参与占地移除。
  const centers:P[]=[];
  for(const [name,n,height] of [["stadium",40,52],["arena",32,38],["pool",32,30]] as const) {
    const footprint=ring(name),c=mean(footprint);centers.push(c);
    const ground=ctx.groundAt(features[name].lngLat[0] as [number,number])-ctx.groundAt(UNIVERSIADE_ANCHOR);
    const at=(p:P,y:number):V=>[p[0],ground+y,p[1]];
    const contract=(p:P,s:number):P=>[c[0]+(p[0]-c[0])*s,c[1]+(p[1]-c[1])*s];
    const bounds=Array.from({length:n},(_,i)=>radial(footprint,c,i*TAU/n));
    const opening=name==="stadium"?Array.from({length:n},(_,i)=>radial(ring("opening"),c,i*TAU/n)):null;
    k.slab("stone",scaled(footprint,1.065),ground,.65);
    k.slab("silver",scaled(footprint,.92),ground+.66,2.2,opening?[opening]:[]);
    const low=bounds.map((p,i)=>at(contract(p,.87),i%2?8:3));
    const belly=bounds.map((p,i)=>at(p,height*(i%2?.43:.49)));
    const crown=bounds.map((p,i)=>at(contract(p,i%2?.91:.95),height*(i%2?.71:1)));
    const roofInner=bounds.map((p,i)=>at(opening?opening[i]:contract(p,.43),height*(opening?.73:.84)));
    for(let i=0;i<n;i++) {
      const j=(i+1)%n;
      const shade:ColorKey=i%4<2?"glazingLight":"glazing";
      panel(low[i],belly[i],belly[j],shade);
      panel(low[i],belly[j],low[j],"glazingLight",false);
      panel(belly[i],crown[i],belly[j],shade);
      panel(crown[i],crown[j],belly[j],i%2?"white":"glazingLight");
      // 白色山峰向内孔倾折，真正保留露天内场。
      panel(crown[i],roofInner[i],crown[j],i%3?"white":"glazingLight",false);
      panel(crown[j],roofInner[i],roofInner[j],"silver",false);
      for(const [a,b] of [[low[i],belly[i]],[belly[i],belly[j]],[belly[i],crown[i]],[crown[i],belly[j]],[crown[i],crown[j]],[crown[i],roofInner[i]],[roofInner[i],roofInner[j]]] as [V,V][])beam(a,b,.85);
      // 屋面板缝，密度低于外幕墙，不把水晶读成普通密肋场馆。
      beam(mix(crown[i],crown[j],.5),mix(roofInner[i],roofInner[j],.5),.24,"silver");
      beam(at(contract(bounds[i],.84),1),low[i],1.15);
      if(!opening)panel(roofInner[i],at(c,height*.88),roofInner[j],i%4?"white":"glazingLight",false);
    }
    if(opening) {
      // 三层连续浅色看台，逐层向内收低；不逐个复制 6 万座椅。
      for(let tier=0;tier<3;tier++)for(let row=0;row<6;row++) {
        const s0=.80+tier*.15+row*.023,s1=s0+.021,y=4+tier*7+row*.85;
        for(let i=0;i<n;i++) {
          const j=(i+1)%n;
          quad((row+tier)%3?"glazingLight":"white",at(contract(opening[i],s0),y),at(contract(opening[i],s1),y+.6),at(contract(opening[j],s1),y+.6),at(contract(opening[j],s0),y));
        }
      }
      // 标准 105×68m 足球场，随整个地标放大；跑道及通道尺度为示意。
      const oval=Array.from({length:64},(_,i):P=>[c[0]+Math.cos(i*TAU/64)*53,c[1]+Math.sin(i*TAU/64)*83]);
      k.slab("accent",oval,ground+.8,.12);
      k.box("green",c[0],ground+1,c[1],68,.18,105);
      const line=(a:P,b:P)=>beam(at(a,1.24),at(b,1.24),.25);
      for(const w of [-34,34])line([c[0]+w,c[1]-52.5],[c[0]+w,c[1]+52.5]);
      for(const d of [-52.5,0,52.5])line([c[0]-34,c[1]+d],[c[0]+34,c[1]+d]);
      for(let i=0;i<32;i++)line([c[0]+Math.cos(i*TAU/32)*9.15,c[1]+Math.sin(i*TAU/32)*9.15],[c[0]+Math.cos((i+1)*TAU/32)*9.15,c[1]+Math.sin((i+1)*TAU/32)*9.15]);
      for(const sign of [-1,1]) {
        const z=c[1]+sign*52.5;
        line([c[0]-20.16,z],[c[0]-20.16,z-sign*16.5]);line([c[0]+20.16,z],[c[0]+20.16,z-sign*16.5]);line([c[0]-20.16,z-sign*16.5],[c[0]+20.16,z-sign*16.5]);
        beam(at([c[0]-3.66,z],1.25),at([c[0]-3.66,z],3.69),.22);beam(at([c[0]+3.66,z],1.25),at([c[0]+3.66,z],3.69),.22);beam(at([c[0]-3.66,z],3.69),at([c[0]+3.66,z],3.69),.22);
      }
    }
    // 东西南北近身入口台阶与暖光门厅，避免覆盖馆间新商业区。
    for(let e=0;e<4;e++) {
      const p=radial(footprint,c,e*Math.PI/2),q=contract(p,.87);
      beam(at(q,4),at(p,4),7,"stone");
      for(let s=0;s<4;s++) {
        const f=1+s*.015,r=contract(p,f);k.box("white",r[0],ground+.7,r[1],e%2?18:2.2,Math.max(.3,2-s*.45),e%2?2.2:18);
      }
    }
  }
  // 湖岸小尺度树组，点位按湖岸抽样；树种及具体位置为估算。
  const lc=mean(lake);
  for(let i=0;i<lake.length;i+=5) {
    const p=lake[i],dx=p[0]-lc[0],dz=p[1]-lc[1],l=Math.hypot(dx,dz)||1;
    const x=p[0]+dx/l*7,z=p[1]+dz/l*7;
    k.tree(x,z,.6,3.4);k.tree(x+4,z+3,.6,2.8);
  }
  for(const key of Object.keys(batches) as ColorKey[])k.triangles(key,batches[key]!);
  const group=k.finish();group.scale.setScalar(SCALE);
  group.userData.evidence={district:"longgang",scale:SCALE,anchor:UNIVERSIADE_ANCHOR,source:meta.source,osm:[3220465,166214606,238845586,219058187,238462822,238466886],centers,estimatedHeights:[52,38,30],seats:[60000,18000,3000]};
  return group;
}
