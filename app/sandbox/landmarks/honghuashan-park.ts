import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/honghuashan-park.json";
import {landmarkKit,circle,type LandmarkContext,type LL} from "./_landmark-kit";
import {trail,honghuaGate,bench,lamp,pavilion} from "./_park-details";
const inside=(p:number[],ring:number[][])=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
/** 公园地理边界有据，所有地形高度只取groundAt；自带47米明和塔的低面数版本，不应与独立塔重复叠加。 */
export function buildHonghuashanPark(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"红花山公园","#c896a6");
 const [west,south,east,north]=data.bounds;
 const positions:number[]=[],flowers:number[]=[];
 // 直接三角化真实边界并细分贴地，保留边缘形状，不用格网阶梯近似边界。
 const geo=data.boundary.slice(0,-1) as LL[],flat=geo.map(k.local);
 const faces=THREE.ShapeUtils.triangulateShape(flat.map(p=>new THREE.Vector2(p[0],p[1])),[]);
 const emit=(a:LL,b:LL,c:LL,depth=0):void=>{
  const ps=[a,b,c],local=ps.map(k.local),lengths=local.map((p,i)=>Math.hypot(p[0]-local[(i+1)%3][0],p[1]-local[(i+1)%3][1]));
  const max=Math.max(...lengths),edge=lengths.indexOf(max);
  if(max>34&&depth<12){const u=ps[edge],v=ps[(edge+1)%3],w=ps[(edge+2)%3],mid:LL=[(u[0]+v[0])/2,(u[1]+v[1])/2];emit(u,mid,w,depth+1);emit(mid,v,w,depth+1);return;}
  const center:LL=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3],target=inside(center,data.flower)?flowers:positions;
  for(let i=0;i<3;i++)target.push(local[i][0],k.yAt(ps[i])+.22,local[i][1]);
 };
 for(const [a,b,c] of faces)emit(geo[a],geo[b],geo[c]);
 k.triangles("green",positions);k.triangles("accent",flowers);
 for(const p of data.paths){
  const points=trail(k,p.ring,p===data.paths[0]?7:3.8,"stone",.65);
  if(p===data.paths[0])for(let i=10;i<points.length;i+=10){const q=points[i];lamp(k,q.x+5,q.z,q.y,4);if(i%10===0)bench(k,q.x-6,q.z,q.y);}
 }
 // 沙盘比例：大门与入口广场整体放大 2 倍，远看可辨认
 const GATE_SCALE=2,gateMark=k.mark();
 honghuaGate(k,data.entrance as LL,-Math.PI/4);
 // 林下坐凳、入口花池和导览牌为示意细部，不表示精确设施点位。
 const ep=k.local(data.entrance),base=k.yAt(data.entrance);
 for(const side of [-1,1]){
  for(let i=0;i<3;i++){k.box("stone",ep[0]+side*(21+i*7),base+.3,ep[1]+14,5.5,.6,3);k.box("accent",ep[0]+side*(21+i*7),base+.9,ep[1]+14,5.1,.45,2.6);}
  k.box("roof",ep[0]+side*27,base,ep[1]+3,.22,2.8,.22);k.box("wood",ep[0]+side*27,base+1,ep[1]+3,2,1.4,.18);
 }
 {const e=k.local(data.entrance),ey0=k.yAt(data.entrance);
  k.slab("stone",circle(e[0],e[1],27),ey0+.3,.35);
  for(const r of [20,24]){const ps=circle(e[0],e[1],r,32).map(p=>new THREE.Vector3(p[0],ey0+.7,p[1]));k.path("white",[...ps,ps[0]],.18,.06);}
  k.scaleSince(gateMark,GATE_SCALE,e[0],ey0,e[1]);}
 // 主轴登山段：台阶踏面采样真实地形，台阶数量为低面数示意。
 const axis=data.paths[0].ring;
 for(let i=2;i<axis.length;i++){
  const a=axis[i-1],b=axis[i],pa=k.local(a),pb=k.local(b),len=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]),n=Math.ceil(len/3.5),angle=Math.atan2(pb[0]-pa[0],pb[1]-pa[1]);
  for(let j=0;j<n;j++){const t=j/n,ll=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],p=k.local(ll);k.box("stone",p[0],k.yAt(ll)+.5,p[1],6.8,.25,len/n,angle);}
 }
 pavilion(k,[113.8959,22.7857],4.5);
 // 林地按卫星图概括：北部密、南部疏；确定性采样，不含逐帧计算。
 let seed=1729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 let count=0;
 for(let i=0;i<650&&count<170;i++){
  const ll:LL=[west+(east-west)*random(),south+(north-south)*random()];
  if(!inside(ll,data.boundary)||inside(ll,data.flower))continue;
  const p=k.local(ll);if(Math.hypot(p[0],p[1])<36)continue;
  const ep=k.local(data.entrance),wp=k.local(data.water);if(Math.hypot(p[0]-ep[0],p[1]-ep[1])<75||Math.hypot(p[0]-wp[0],p[1]-wp[1])<25)continue;
  if(ll[1]<22.7828&&random()<.7)continue;
  // 近步道留出视线与行走空间。
  let clear=true;
  for(const path of data.paths)for(let j=1;j<path.ring.length;j++){
   const a=k.local(path.ring[j-1]),b=k.local(path.ring[j]),dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));
   if(Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<7)clear=false;
  }
  if(clear){k.tree(p[0],p[1],k.yAt(ll)+.4,5+random()*3.2);count++;}
 }
 // 南入口蒲葵林与天圆地方水景只做简化形体，尺度估算。
 for(let i=0;i<18;i++){
  const a=data.entrance as LL,ll:LL=[a[0]+(i%6-2.5)*.00013,a[1]+(Math.floor(i/6)+1)*.00012],p=k.local(ll);
  k.tree(p[0],p[1],k.yAt(ll),3,true);
 }
 const water=k.local(data.water),wy=k.yAt(data.water);
 k.box("stone",water[0],wy+.3,water[1],22,.5,22);
 k.cylinder("water",water[0],water[1],wy+.85,8.7,.15);
 k.slab("white",circle(water[0],water[1],9.2,32),wy+.85,.18,[circle(water[0],water[1],8.7,32)]);
 for(let i=0;i<8;i++){const a=i*Math.PI/4;k.cylinder("silver",water[0]+Math.cos(a)*5,water[1]+Math.sin(a)*5,wy+1,.12,.25,.1,6);}
 for(let i=0;i<8;i++){const a=i*Math.PI/4;bench(k,water[0]+Math.cos(a)*16,water[1]+Math.sin(a)*16,wy,Math.PI/2-a);}
 // 明和塔：官方八面九层47m。保留轮廓特征，栏杆和收分比例为估算。
 // 沙盘比例：塔整体放大 1.6 倍（约 75m），作为公明一侧的地标
 const towerMark=k.mark();
 k.cylinder("stone",0,0,.2,13,1.3,13,8);
 const ring=(r:number,y:number)=>Array.from({length:8},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/4+Math.PI/8)*r,y,Math.sin(i*Math.PI/4+Math.PI/8)*r));
 for(let i=0;i<9;i++){
  const y=1.5+i*4.3,r=6.8-i*.35;
  k.cylinder("red",0,0,y,r,3.4,r,8);
  k.cylinder("glass",0,0,y+.7,r+.01,1.8,r+.01,8);
  const out=ring(r+2,y+3.4),inner=ring(r*.65,y+5),pos:number[]=[];
  for(let j=0;j<8;j++){
   const a=out[j],b=out[(j+1)%8],c=inner[(j+1)%8],d=inner[j];a.y+=.25;b.y+=.25;
   pos.push(...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray());
   const p=ring(r,y)[j];k.box("red",p.x,y,p.z,.45,3.4,.45);
   k.beam("stone",new THREE.Vector3(a.x,y+.5,a.z),new THREE.Vector3(b.x,y+.5,b.z),.22);
  }
  k.triangles(i===8?"wood":"roof",pos);
 }
 k.cylinder("wood",0,0,40.9,3.8,3.1,.4,8);
 k.cylinder("wood",0,0,44,.5,3,.04,8);
 k.scaleSince(towerMark,1.6,0,0,0);
 k.group.userData={id:"honghuashan-park",previewFocus:{lngLat:data.entrance,distance:48,direction:[-.7,.45,1]},scale:1,includesMingheTower:true,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
