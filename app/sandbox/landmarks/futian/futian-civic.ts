/**
 * 福田站与市民中心 · futian 独立模块。
 * 真实依据：public/sandbox/districts/futian/sandbox.json buildings[4741].p，
 * Overture / OSM 混合数据的 12 点市民中心轮廓；h=19,e=1 为估算，不采用。
 * 投影沿用 public/sandbox/sandbox.json：WebMercator × k=0.9221194861972872，
 * origin=[113.929007,22.76207]；锚点为轮廓面积形心反投影。
 * https://www.sznews.com/photo/content/mb/2018-05/28/content_19206231_2.htm
 * 航拍/报道：展翅曲面屋顶，公称486×154m，中区总高84.7m；实际蓝顶、圆/方双塔。
 * https://www.szft.gov.cn/xxgk/zwgk/gzxx/zdjsxm/xmjz/content/post_3965773.html
 * 福田高铁站为全地下三层车站；本模块不造地上站房或站台。
 * 估算：屋面曲率/厚度、裙房院落、柱网、塔楼窗格、北侧广场、出口/天窗位置与数量。
 * 按任务要求白屋顶、双方形塔体，是沙盘艺术简化；不是原建筑色彩/施工图复原。
 * 市民中心本体绕真实形心等比放大1.25×；站亭各自放大1.25×，站点间距不放大。
 * 任务近似市民中心点偏东南约626m，采用真实轮廓，不平移到近似点。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type P, type ColorKey } from "../_landmark-kit";
type Ctx = LandmarkContext;
type V = [number, number, number];
export const FUTIAN_CIVIC_ANCHOR: [number, number] = [114.05452231442206, 22.546317389546665];
const STATION: [number, number] = [114.0513, 22.5395];
const CENTER: P = [12884.130916040116, 23998.57381469036];
const FOOTPRINT: P[] = [[12906.9,24075.7],[12968.7,24075],[12968.5,24055.5],
 [13051.7,24063.6],[13100.8,24072.3],[13132,24080],[13130.2,23923.7],
 [12636.6,23929.4],[12638.3,24085.7],[12722.3,24066.2],[12797.8,24056.7],
 [12798.1,24077]];
const SCALE = 1.25;

export function buildFutianCivic(ctx: Ctx): THREE.Group {
 const k = landmarkKit(ctx, FUTIAN_CIVIC_ANCHOR, "福田站与市民中心", "#d8bcb1", {
  silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc",
  glazingLight: "#cfdde4", stone: "#e9e4d8", green: "#c1d3ae", leaf: "#a3bea3",
 });
 const faces: Partial<Record<ColorKey, number[]>> = {};
 const tri = (key: ColorKey, a: V, b: V, c: V) => {
  (faces[key] ??= []).push(...a, ...b, ...c);
 };
 const quad = (key: ColorKey,a: V,b: V,c: V,d: V) => {tri(key,a,b,c);tri(key,a,c,d);};
 // 直接写盒体面，细柱/窗框无需分配临时Geometry；最后仅按颜色合批。
 const box = (key: ColorKey,x: number,y: number,z: number,w: number,h: number,d: number) => {
  const p: V[] = [[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2],
   [x-w/2,y+h,z-d/2],[x+w/2,y+h,z-d/2],[x+w/2,y+h,z+d/2],[x-w/2,y+h,z+d/2]];
  for(const [a,b,c,d] of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])quad(key,p[a],p[b],p[c],p[d]);
 };
 const civicBox = (key: ColorKey,x: number,y: number,z: number,w: number,h: number,d: number) =>
  box(key,x*SCALE,y*SCALE,z*SCALE,w*SCALE,h*SCALE,d*SCALE);
 const ring = FOOTPRINT.map(([x,z]): P=>[x-CENTER[0],z-CENTER[1]]);
 // 沿实际凹轮廓细分曲面，顶面不跨越凹口；实心曲壳参与逐三角形占地栅格化。
 const roofY = (x: number,z: number) => 40 + 42.7*Math.exp(-((x/100)**2)) + 19*(Math.abs(x)/248)**6 + 2*(z/86)**2;
 const top = ([x,z]: P,lower=0): V => [x*SCALE,(roofY(x,z)-lower)*SCALE,z*SCALE];
 const mid = (a: P,b: P): P=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
 const patch = (a: P,b: P,c: P,n: number) => {
  if(n){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);patch(a,ab,ca,n-1);patch(ab,b,bc,n-1);patch(ca,bc,c,n-1);patch(ab,bc,ca,n-1);return;}
  // x,z二维顺时针产生朝上的法线。
  if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0)[b,c]=[c,b];
  tri("white",top(a),top(b),top(c));tri("silver",top(c,3.2),top(b,3.2),top(a,3.2));
 };
 for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(ring.map(([x,z])=>new THREE.Vector2(x,z)),[]))patch(ring[a],ring[b],ring[c],4);
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],n=16; // 与曲壳四级细分的边界节点一致，封闭檐口
  for(let j=0;j<n;j++){
   const at=(t: number): P=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
   const p=at(j/n),q=at((j+1)/n);quad("silver",top(p),top(p,3.2),top(q,3.2),top(q));
  }
 }
 // 白色基座是实际建筑轮廓，不铺两地之间的巨大包围盒。
 k.slab("stone",ring.map(([x,z]): P=>[x*SCALE,z*SCALE]),-.3,1.1);
 // 两翼院落裙房，中央84米保持贯通，院落上方是整体大屋顶。
 for(const sign of [-1,1]){
  const cx=sign*158;
  civicBox("white",cx,.8,-44,154,27,36);
  civicBox("white",cx,.8,44,154,27,32);
  civicBox("white",sign*225,.8,0,20,27,62);
  civicBox("white",sign*91,.8,0,20,27,62);
  for(const z of [-62.1,60.1]){
   for(let y=5;y<26;y+=5){
    civicBox("glazing",cx,y,z,147,3.2,.2);
    for(let x=cx-72;x<=cx+73;x+=9)civicBox("white",x,y,z+Math.sign(z)*.2,.7,3.2,.5);
   }
  }
  // 近中轴两侧方塔：暖白框架、浅蓝灰窗带、顶部退台。
  const tx=sign*59, tz=-12, height=67;
  civicBox("silver",tx,.8,tz,41,height,42);
  for(let y=6;y<height-3;y+=5.4){
   for(const s of [-1,1]){
    civicBox("glazingLight",tx,y,tz+s*21.1,36,3.9,.25);
    civicBox("glazing",tx+s*20.6,y,tz,.25,3.9,37);
   }
  }
  for(let x=tx-18;x<=tx+19;x+=9)for(const z of [tz-21.4,tz+21.4])civicBox("white",x,1,z,1.1,height,.65);
  civicBox("white",tx,height,tz,43,1.8,44);
  // 翼下柱列与Y形分叉支承：数量/位置为节奏估算。
  for(let x=108;x<231;x+=24)for(const z of [-45,42]){
   const xx=sign*x, y=roofY(xx,z)-4;
   civicBox("white",xx,28,z,1.7,y-28,1.7);
   for(const d of [-1,1])k.beam("silver",new THREE.Vector3(xx*SCALE,(y-5)*SCALE,z*SCALE),
    new THREE.Vector3((xx+d*5)*SCALE,(roofY(xx+d*5,z)-3.2)*SCALE,z*SCALE),1.1*SCALE);
  }
 }
 // 中轴台阶/前场，限制在近身范围，北侧只做中心书城方向简化铺地绿轴。
 civicBox("stone",0,.8,54,82,4.5,42);
 for(let i=0;i<7;i++)civicBox("silver",0,.8,77+i*3,86+i*2,(7-i)*.64,3);
 box("stone",0,-.2,143,270,.9,60);
 for(let z=125;z<170;z+=15)box("silver",0,.72,z,260,.12,.65);
 for(let z=-135;z>=-355;z-=55){
  box("stone",0,-.2,z,106,.7,50);
  for(const sign of [-1,1]){
   box("green",sign*35,.5,z,24,.22,40);
   for(const dz of [-13,13])k.tree(sign*35,z+dz,.7,3.8);
  }
 }
 // 站点地面设施单独取地高；不画地下站房的占地，不虚构高铁地面站台。
 const [sx,sz]=k.local(STATION),sy=k.yAt(STATION);
 for(const dz of [-76,0,76]){
  for(const side of [-1,1]){
   const x=sx+side*23,z=sz+dz;
   box("stone",x,sy-.15,z,23,.6,43);
   box("glazing",x,sy+.45,z-2,12.5,4.5,21);
   for(const xx of [-7,7])box("white",x+xx,sy+.45,z,1.3,5.7,25);
   box("white",x,sy+6.1,z,19,1.15,30);
   box("glazingLight",x,sy+6.5,z-3,10,.9,13);
   for(let j=0;j<5;j++)box("silver",x,sy+.45+j*.24,z+12-j*1.2,12,.25,1.3);
   box("accent",x,sy+4.8,z+15.1,6,.85,.2);
  }
 }
 for(const dz of [-40,40]){
  box("stone",sx,sy-.15,sz+dz,18,.6,22);
  box("white",sx,sy+.45,sz+dz,13,1.1,18);
  box("glazingLight",sx,sy+1.55,sz+dz,10,.7,15);
  for(const dx of [-3,0,3])box("silver",sx+dx,sy+2.25,sz+dz,.24,.12,15);
 }
 for(const [key,positions] of Object.entries(faces) as [string,number[]][])k.triangles(key as ColorKey,positions);
 const group=k.finish();
 group.userData={district:"futian",scale:SCALE,sourceBuildingIndex:4741,stationUnderground:true};
 return group;
}
