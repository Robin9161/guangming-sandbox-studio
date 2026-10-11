import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/guangming-equestrian-center.json";
import {landmarkKit,scaled,facade,type LandmarkContext,type LL,type P} from "./_landmark-kit";
/** 官方实景木构折坡屋面；地理范围按施工期卫星描绘，折数与层高为估算。 */
export function buildGuangmingEquestrianCenter(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"光明国际马术中心","#c09a6d");
 k.slab("green",data.boundary.map(k.local),.12,.18);
 const makeHall=(feature:typeof data.features[number],bays:number,open:boolean)=>{
  const p=feature.ring.map(k.local),y=k.yAt(feature.center)+.5;
  const a=p[0],u:P=[p[1][0]-a[0],p[1][1]-a[1]],v:P=[p[3][0]-a[0],p[3][1]-a[1]];
  const at=(x:number,z:number,h:number)=>new THREE.Vector3(a[0]+u[0]*x+v[0]*z,y+h,a[1]+u[1]*x+v[1]*z);
  const eave=open?19:15,peak=feature.height;
  k.slab("stone",p,y,3.7);
  if(open){
   k.slab("stone",scaled(p,.73),y+3.8,.2);
   // 环场阶梯看台；空出中央沙地。
   for(let i=0;i<4;i++)k.slab("white",scaled(p,.98-i*.035),y+4+i*.8,.65,[scaled(p,.83-i*.035)]);
  }else{
   k.slab("white",p,y+3.7,11);
   for(let i=0;i<3;i++)facade(k,scaled(p,1.004),y+5+i*3.7,1.7,2.5,3.7);
  }
  const pos:number[]=[];
  for(let i=0;i<bays;i++){
   const x0=i/bays,xm=(i+.5)/bays,x1=(i+1)/bays;
   const points=[at(x0,0,eave),at(xm,0,peak),at(x1,0,eave),at(x0,1,eave),at(xm,1,peak),at(x1,1,eave)];
   for(const indices of [[0,3,4],[0,4,1],[1,4,5],[1,5,2]])for(const j of indices)pos.push(...points[j].toArray());
   for(const z of [0,.5,1]){
    k.beam("wood",at(x0,z,eave-.4),at(xm,z,peak-.4),.7);
    k.beam("wood",at(xm,z,peak-.4),at(x1,z,eave-.4),.7);
    k.beam("wood",at(x0,z,eave-.6),at(x1,z,eave-.6),.7);
    k.beam("wood",at(x0,z,3.7),at(x0,z,eave),1.05);
    k.beam("wood",at(x0,z,eave*.62),at(xm,z,eave-.6),.55);
   }
   // 山墙三角玻璃填充、木桁架腹杆与屋面折线，均按实景节奏估算。
   for(const z of [0,1]){
    k.triangles("glazing",[...at(x0,z,eave-.8).toArray(),...at(xm,z,peak-.8).toArray(),...at(x1,z,eave-.8).toArray()]);
    for(const t of [.25,.5,.75]){const xx=x0+(x1-x0)*t,top=eave+(peak-eave)*(1-Math.abs(t*2-1));k.beam("wood",at(xx,z,eave-.5),at(xx,z,top-.5),.28);}
   }
   for(const t of [.2,.4,.6,.8]){const xx=x0+(x1-x0)*t,hh=eave+(peak-eave)*(1-Math.abs(t*2-1))+.06;k.beam("silver",at(xx,0,hh),at(xx,1,hh),.12);}
   // 可见长向木檩和少量深色采光条；均为低面数概括。
   for(const z of [.2,.45,.7])k.beam("wood",at(x0,z,eave-.4),at(x1,z,eave-.4),.35);
   const s0=at(x0+.2/bays,.25,eave+(peak-eave)*.4+.12),s1=at(x0+.36/bays,.25,eave+(peak-eave)*.72+.12),s2=at(x0+.36/bays,.65,eave+(peak-eave)*.72+.12),s3=at(x0+.2/bays,.65,eave+(peak-eave)*.4+.12);
   // 条形天窗分成四组，保留中间不透明屋面。
   for(let panel=0;panel<4;panel++){
    const lo=panel/4,hi=(panel+.78)/4;
    const a=s0.clone().lerp(s3,lo),b=s1.clone().lerp(s2,lo),c=s1.clone().lerp(s2,hi),d=s0.clone().lerp(s3,hi);
    k.triangles("glazing",[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()]);
   }
  }
  k.triangles("silver",pos);
  facade(k,scaled(p,1.002),y+.4,3.1,3.2,4);
  for(const z of [0,1]){k.beam("wood",at(0,z,eave),at(1,z,eave),1.25);k.beam("wood",at(1,z,3.7),at(1,z,eave),1.05);}
  // 两侧低层观赛廊，连续浅色水平檐口。
  for(const z of [0,1])k.beam("white",at(0,z,8),at(1,z,8),6,1.1);
  return {at,y,p};
 };
 const main=makeHall(data.features[0],9,true),training=makeHall(data.features[1],7,false);
 const court=data.features[2],cp=court.ring.map(k.local),cy=k.yAt(court.center)+4;
 k.slab("stone",cp,cy,.3);k.ribbon("white",scaled(cp,1.01),cy+.5,.45);
 // 主赛场内仅放少量障碍杆作为功能提示，不复制赛事布置。
 for(let i=0;i<4;i++){const a=main.at(.25+i*.15,.48,4.2),b=main.at(.25+i*.15,.58,4.2);
  k.box("white",a.x,a.y,a.z,.8,1.5,.8);k.box("white",b.x,b.y,b.z,.8,1.5,.8);
  k.beam("accent",a.clone().add(new THREE.Vector3(0,1.2,0)),b.clone().add(new THREE.Vector3(0,1.2,0)),.24);}
 k.beam("white",main.at(0,0,8),training.at(0,0,8),6,2.3);
 for(let i=0;i<11;i++){const p=main.at(i/10,-.13,0);k.tree(p.x,p.z,main.y,3);}
 k.group.userData={id:"guangming-equestrian-center",scale:1,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
