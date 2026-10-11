import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/gongming-square.json";
import {landmarkKit,circle,type LandmarkContext,type LL,type P} from "./_landmark-kit";
/** 卫星平面+实景牌坊、塔形喷泉与长廊；高宽、开间和装饰为估算。 */
export function buildGongmingSquare(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"公明广场","#ad6159");
 const boundary=data.boundary.map(k.local),gate=k.local(data.gate),fountain=k.local(data.fountain);
 k.slab("stone",boundary,.1,.22);
 const axis=new THREE.Vector3(fountain[0]-gate[0],0,fountain[1]-gate[1]).normalize();
 const right=new THREE.Vector3(-axis.z,0,axis.x),angle=Math.atan2(-right.z,right.x);
 const at=(x:number,z:number,y:number)=>new THREE.Vector3(gate[0]+right.x*x+axis.x*z,y,gate[1]+right.z*x+axis.z*z);
 // 三开间浅色石柱与红色横匾，依据实景的现代牌坊形态。
 for(const x of [-30,-12,12,30]){
  const p=at(x,0,0);k.box("stone",p.x,.4,p.z,2.6,13,2.6,angle);k.box("white",p.x,13.4,p.z,4,.7,4,angle);
 }
 for(const [x,w,h] of [[0,27,15.5],[-21,19,12.8],[21,19,12.8]]){
  const p=at(x,0,h);k.box("accent",p.x,h,p.z,w,3,2.4,angle);k.box("stone",p.x,h+3,p.z,w+2,.7,3.8,angle);
 }
 // 浅蓝色塔形水景：保持几支向上舒展的构件，省略复杂雕刻。
 const fy=k.yAt(data.fountain)+.4,x=fountain[0],z=fountain[1];
 k.cylinder("white",x,z,fy,19,.7);k.cylinder("water",x,z,fy+.72,17,.1);
 for(let i=0;i<5;i++){
  const a=i*Math.PI*2/5,rx=Math.cos(a),rz=Math.sin(a);
  const positions=[x+rx*6,fy+1,z+rz*6,x-rz*.65,fy+23-i*.8,z+rx*.65,x+rz*.65,fy+23-i*.8,z-rx*.65,x+rx*6,fy+1,z+rz*6,x+rz*.65,fy+23-i*.8,z-rx*.65,x+rx*3,fy+1,z+rz*3];
  k.triangles("water",positions);
 }
 k.cylinder("white",x,z,fy+8,4,.6);
 // 九根旗杆。旗帜只作小幅色块，不编造旗面细节。
 for(let i=0;i<9;i++){const p=at((i-4)*6,66,.4);k.cylinder("silver",p.x,p.z,.4,.14,13,.1,6);k.box("accent",p.x+1,10.7,p.z,1.8,1.15,.05);}
 const arc=data.arc.map(k.local);
 for(let i=0;i<arc.length;i++){
  const a=arc[i],b=arc[(i+1)%arc.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5.5);
  k.beam("silver",new THREE.Vector3(a[0],5.2,a[1]),new THREE.Vector3(b[0],5.2,b[1]),4.5,.65);
  for(let j=0;j<n;j++){const t=j/n,xx=a[0]+(b[0]-a[0])*t,zz=a[1]+(b[1]-a[1])*t;k.box("white",xx,.4,zz,.65,4.5,.65);
   const arch:THREE.Vector3[]=[];
   for(let q=0;q<=8;q++){const u=(j+q/8)/n;arch.push(new THREE.Vector3(a[0]+(b[0]-a[0])*u,3.15+Math.sin(q*Math.PI/8)*1.65,a[1]+(b[1]-a[1])*u));}
   k.path("white",arch,.26,.3);}
 }
 // 外围长廊、树阵与可识别的铺装轴线。
 for(const side of [-1,1]){
  const pts=[at(side*47,10,.5),at(side*47,56,.5)];k.path("silver",pts.map(p=>p.clone().setY(4.8)),4.4,.6);
  for(let i=0;i<9;i++){const p=at(side*47,10+i*5.7,0);k.box("white",p.x,.4,p.z,.65,4.2,.65);}
  for(let i=0;i<10;i++){const p=at(side*38,12+i*7,0);k.tree(p.x,p.z,.4,3);}
 }
 for(let i=0;i<boundary.length;i++){
  const a=boundary[i],b=boundary[(i+1)%boundary.length],n=Math.floor(Math.hypot(b[0]-a[0],b[1]-a[1])/15);
  for(let j=0;j<n;j++){const t=(j+.5)/n;k.tree(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.4,3.6);}
 }
 for(let i=1;i<7;i++){const a=at(-36,i*11,.43),b=at(36,i*11,.43);k.beam("silver",a,b,.3,.05);}
 k.group.userData={id:"gongming-square",scale:1,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
