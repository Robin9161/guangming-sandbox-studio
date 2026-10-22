import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type ColorKey, type P } from "../_landmark-kit";
import evidence from "../../../../public/sandbox/landmarks/sz-world-exhibition.json";

/**
 * 深圳国际会展中心 · 宝安福海 / 前海会展片区。
 * 真实依据：qianhai/sandbox.json buildings[17448] 的完整 217 点真实轮廓，758532.825㎡；
 * 提取来源、哈希、投影和原始 p 均存 public/sandbox/landmarks/sz-world-exhibition.json。
 * OSM 场馆标识 https://www.openstreetmap.org/way/1005694758 。轮廓数据经 Overture 汇入本项目；
 * 原数据 h=24,e=1 是估算高度，不冒充测绘。锚点用多边形面积形心反投影，非任务概略点。
 * 官方：16 个标准厅（1–16，210×108m，净高16m）+17号超大展厅（210×249m，净高18m）
 * +18号会议中心、20号活动中心，总计19厅，没有19号厅。
 * https://www.shenzhen-world.com/overview/ex-facilities/index.html
 * 官方展厅布置 https://www.shenzhen-world.com/upload/overview-ex-facilities-map.png
 * 1.75km双层中央廊道、南北登录大厅： https://www.chtf.com/canzhanzhiyin/zhnaguanjieshao/
 * 估算：内部厅界据官方图与轮廓缺口配准；波峰、屋面厚度、采光缝、幕墙分格、分叉柱及标号位置。
 * 实际蓝紫色海浪屋面统一转译为沙盘白/暖白，仅以浅蓝灰采光带区分波纹，不是写实复原。
 * 全部真实外轮廓保留；建筑绕形心地面等比放大1.25×，无大矩形场地板覆盖周边白模。
 * 按颜色合批、无贴图；夜景使用 kit glazing/glazingLight 原有 glowColor。
 */
type Ctx = LandmarkContext;
type V = [number, number, number];
export const SZ_WORLD_EXPO_ANCHOR: [number, number] = [113.76936214619373, 22.701064550375037];
const SCALE = 1.25;
// 建筑长轴向南偏东约8°；用于屋面分区，原始世界轮廓并未旋正或矩形化。
const C = 1 / Math.sqrt(1 + .141 ** 2), S = .141 * C;
const REF: P = [-16390, 6780];
const RING: P[] = Array.from({ length: evidence.p.length / 2 }, (_, i) => {
 const x = evidence.p[i * 2] - REF[0], z = evidence.p[i * 2 + 1] - REF[1];
 return [C * x - S * z, S * x + C * z];
});

/** Sutherland–Hodgman：细分后的凸轮廓三角形逐格裁切，正确保留凹口与多片交集。 */
function clip(ring: P[], axis: 0 | 1, bound: number, above: boolean): P[] {
 const out: P[] = [];
 for (let i = 0; i < ring.length; i++) {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const ia = above ? a[axis] >= bound : a[axis] <= bound;
  const ib = above ? b[axis] >= bound : b[axis] <= bound;
  if (ia) out.push(a);
  if (ia !== ib) {
   const t = (bound - a[axis]) / (b[axis] - a[axis]);
   out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
 }
 return out;
}
// 静态轮廓三角化只在模块初始化一次；构建不依赖 ctx 的绝对投影原点。
const FOOTPRINT_TRIANGLES = THREE.ShapeUtils.triangulateShape(RING.map(p => new THREE.Vector2(...p)), [])
 .map(indices => indices.map(i => RING[i]));

export function buildSzWorldExhibition(ctx: Ctx): THREE.Group {
 const k = landmarkKit(ctx, SZ_WORLD_EXPO_ANCHOR, "深圳国际会展中心", "#c3ae96", {
  silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc", glazingLight: "#cfdde4",
 });
 const faces: Partial<Record<ColorKey, number[]>> = {};
 const point = (u: number, y: number, v: number): V => [
  (REF[0] + C * u + S * v - evidence.center[0]) * SCALE, y * SCALE,
  (REF[1] - S * u + C * v - evidence.center[1]) * SCALE,
 ];
 const tri = (key: ColorKey, a: V, b: V, c: V) => {
  const target = faces[key] ?? (faces[key] = []); target.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
 };
 const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => { tri(key, a, b, c); tri(key, a, c, d); };
 // 低成本棱柱，用于柱、檐口、数字标号；不逐构件分配 BufferGeometry。
 const box = (key: ColorKey, u: number, y: number, v: number, w: number, h: number, d: number) => {
  const a = point(u-w/2,y,v-d/2), b = point(u+w/2,y,v-d/2), c = point(u+w/2,y,v+d/2), f = point(u-w/2,y,v+d/2);
  const A = point(u-w/2,y+h,v-d/2), B = point(u+w/2,y+h,v-d/2), D = point(u+w/2,y+h,v+d/2), F = point(u-w/2,y+h,v+d/2);
  quad(key,a,b,B,A); quad(key,b,c,D,B); quad(key,c,f,F,D); quad(key,f,a,A,F); quad(key,A,B,D,F); quad(key,f,c,b,a);
 };
 // 直接复用已三角化的真实轮廓，免去大多边形 ExtrudeGeometry 的冷启动开销。
 for(const t of FOOTPRINT_TRIANGLES){
  tri("stone",point(t[0][0],0,t[0][1]),point(t[2][0],0,t[2][1]),point(t[1][0],0,t[1][1]));
  tri("white",...t.map(p=>point(p[0],14,p[1])) as [V,V,V]);
 }
 for(let i=0;i<RING.length;i++){
  const a=RING[i],b=RING[(i+1)%RING.length];
  for(const [lo,hi,key] of [[0,.6,"stone"],[.6,10.2,"white"],[13.5,14,"white"]] as [number,number,ColorKey][])
   quad(key,point(a[0],lo,a[1]),point(b[0],lo,b[1]),point(b[0],hi,b[1]),point(a[0],hi,a[1]));
 }
 // 连续的浅蓝灰高侧窗 + 白色薄横框；完整外墙依循真实折线。
 for (let i=0;i<RING.length;i++) {
  const a=RING[i],b=RING[(i+1)%RING.length];
  quad("glazingLight",point(a[0],10.2,a[1]),point(b[0],10.2,b[1]),point(b[0],13.5,b[1]),point(a[0],13.5,a[1]));
  const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/15);
  for(let j=0;j<n;j++){const t=(j+.5)/n;box("silver",a[0]+(b[0]-a[0])*t,10,a[1]+(b[1]-a[1])*t,.45,3.8,.45);}
 }

 /** 屋面按格裁切原轮廓三角形；边界不跨凹口，每格的色带也是实几何。 */
 const roof = (u0: number,u1: number,v0: number,v1: number,height:(u:number,v:number)=>number, lobby=false) => {
  const nu=Math.ceil((u1-u0)/(lobby?28:42)),nv=Math.ceil((v1-v0)/26);
  // 先裁整分区，减少重复测试数。
  const parts=FOOTPRINT_TRIANGLES.map(t=>clip(clip(clip(clip(t,0,u0,true),0,u1,false),1,v0,true),1,v1,false)).filter(t=>t.length>=3).map(p=>({p,minU:Math.min(...p.map(v=>v[0])),maxU:Math.max(...p.map(v=>v[0])),minV:Math.min(...p.map(v=>v[1])),maxV:Math.max(...p.map(v=>v[1]))}));
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
   const a=u0+(u1-u0)*i/nu,b=u0+(u1-u0)*(i+1)/nu,c=v0+(v1-v0)*j/nv,d=v0+(v1-v0)*(j+1)/nv;
   const key:ColorKey=lobby?(i%6===2?"glazingLight":"white"):(i===2||i===nu-3?"glazingLight":j%3===0?"silver":"white");
   for(const part of parts){
    if(part.maxU<a||part.minU>b||part.maxV<c||part.minV>d)continue;
    const poly=clip(clip(clip(clip(part.p,0,a,true),0,b,false),1,c,true),1,d,false);
    if(poly.length<3)continue;
    for(let t=1;t<poly.length-1;t++){
     const p=poly[0],q=poly[t],r=poly[t+1];
     if(Math.abs((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))<.001)continue;
     tri(key,point(p[0],height(...p),p[1]),point(q[0],height(...q),q[1]),point(r[0],height(...r),r[1]));
    }
   }
  }
  // 真实周界的屋檐竖面，不在内部三角化边上产生多余墙片。
  const boundary=RING.map((p,i)=>[p,RING[(i+1)%RING.length]]);
  for(let idx=0;idx<RING.length;idx++){
   const [a,b]=boundary[idx];
   const seg=clip(clip(clip(clip([a,b],0,u0,true),0,u1,false),1,v0,true),1,v1,false);
   if(seg.length<2)continue;
   const p=seg[0],q=seg[1],n=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/12));
   for(let j=0;j<n;j++){
    const x:P=[p[0]+(q[0]-p[0])*j/n,p[1]+(q[1]-p[1])*j/n],z:P=[p[0]+(q[0]-p[0])*(j+1)/n,p[1]+(q[1]-p[1])*(j+1)/n];
    quad("silver",point(x[0],height(...x)-1.5,x[1]),point(z[0],height(...z)-1.5,z[1]),point(z[0],height(...z),z[1]),point(x[0],height(...x),x[1]));
    quad(lobby?"glazing":"white",point(x[0],14,x[1]),point(z[0],14,z[1]),point(z[0],height(...z)-1.5,z[1]),point(x[0],height(...x)-1.5,x[1]));
   }
  }
 };
 // 官方编号：西奇东偶，南→北；四组双厅，南北登录大厅从组间横穿。
 const groups: [number,number][]=[[587,848],[304,558],[-95,159],[-380,-124]];
 const hallSpecs:{id:number;side:number;lo:number;hi:number}[]=[];
 groups.forEach(([lo,hi],g)=>{
  const mid=(lo+hi)/2;
  for(const side of [-1,1])for(let j=0;j<2;j++)hallSpecs.push({id:g*4+j*2+(side<0?1:2),side,lo:j===0?mid:lo,hi:j===0?hi:mid});
 });
 hallSpecs.push({id:17,side:-1,lo:-878,hi:-614},{id:18,side:1,lo:-745,hi:-614},{id:20,side:1,lo:-878,hi:-745});
 const digits=["111101101101111","010110010010111","111001111100111","111001111001111","101101111001001","111100111001111","111100111101111","111001001001001","111101111101111","111101111001111"];
 for(const hall of hallSpecs){
  const {side,lo,hi,id}=hall,u0=side<0?-270:22,u1=side<0?-22:270;
  const wave=(u:number,v:number)=>20+8*Math.sin(Math.PI*(v-lo)/(hi-lo))+.9*Math.sin((Math.abs(u)-22)/220*Math.PI);
  roof(u0,u1,lo,hi,wave);
  // 交界处的薄白色封檐和物流门均有体积，数字采用浅灰几何块，不使用贴图。
  for(const v of [lo+1,hi-1])box("silver",side*132,17,v,214,3,1.1);
  for(let j=0;j<6;j++)box("glazing",side*240,1.1,lo+(hi-lo)*(j+.5)/6,1.1,5.8,7.5);
  const chars=String(id).split("");
  chars.forEach((ch,ci)=>[...digits[Number(ch)]].forEach((bit,i)=>{
   if(bit==='1'){const u=side*66+(ci*4+i%3)*1.7,v=(lo+hi)/2+(Math.floor(i/3)-2)*1.7;box("glazing",u,wave(u,v)+.08,v,1.4,.22,1.4);}
  }));
 }
 // 1.75km长中央双层廊道：南入口至北厅尽端，波峰屋面+两条连续天窗。
 roof(-22,22,-902,880,(u,v)=>26.5+3.8*Math.cos(u/22*Math.PI/2)+.8*Math.sin(v/110),true);
 for(const u of [-18,18])box("silver",u,8,-5,1,1,1750);
 // 南、北登录大厅分别位于 v≈233、-540；玻璃裙墙和分叉柱强调独立空间。
 for(const [lo,hi] of [[168,298],[-605,-475]]){
  const h=(u:number,v:number)=>25+7*Math.sin((v-lo)/(hi-lo)*Math.PI)+2*Math.cos(u/270*Math.PI*2);
  roof(-270,270,lo,hi,h,true);
  for(const side of [-1,1]){
   const u=side*250;
   for(let j=0;j<5;j++){
    const v=lo+15+j*25;box("silver",u,1,v,1.2,16,1.2);
    for(const d of [-7,7]) k.beam("silver",new THREE.Vector3(...point(u,14,v)),new THREE.Vector3(...point(u-5*side,25,v+d)),1.1*SCALE);
   }
  }
 }
 // 南端迎宾波冠，直接裁切原始南缘弧形轮廓，不添加场外巨型基座。
 roof(-242,244,848,902,(u,v)=>25+11*Math.exp(-((u/73)**2))-.03*(v-848),true);
 // 中央廊道原轮廓北端的小穹顶终点。
 roof(-24,24,-910,-902,()=>26,true);
 for(const [key,data] of Object.entries(faces) as [string,number[]][])if(data.length)k.triangles(key as ColorKey,data);
 const group=k.finish();
 group.userData={district:"qianhai",hallCount:19,standardHalls:16,hallNumbers:hallSpecs.map(h=>h.id).sort((a,b)=>a-b),scale:SCALE,sourceBuildingIndex:evidence.sourceBuildingIndex};
 return group;
}
