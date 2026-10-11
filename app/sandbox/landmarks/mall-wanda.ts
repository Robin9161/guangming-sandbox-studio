import {architecturalColors} from "./_architectural-colors";
import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/mall-wanda.json";
import {landmarkKit,scaled,rounded,mean,tower,facade,blockSign,type LandmarkContext,type LL,type P} from "./_landmark-kit";
/** 乐府广场四塔一裙房；地理轮廓和135°主轴有依据，层高、立面分格与塔高为估算。 */
export function buildMallWanda(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"深圳光明万达广场","#b85c59",architecturalColors.wanda);
 const mall=data.features[0],y=k.yAt(mall.center)+.4;
 // 卫星图显示中央为连续商业裙房；矢量只覆盖外缘，按真实足迹外包络简化补全（估算）。
 const points=data.features.flatMap(f=>f.ring.map(k.local)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a:P,b:P,c:P)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const lo:P[]=[],hi:P[]=[];
 for(const p of points){while(lo.length>1&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
 for(const p of [...points].reverse()){while(hi.length>1&&cross(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p);}
 const p=[...lo.slice(0,-1),...hi.slice(0,-1)];
 k.slab("glass",p,y,27);k.slab("stone",scaled(p,1.006),y+7,18.5);
 facade(k,scaled(p,1.013),y+.5,6,3.2,6);
 for(const h of [12.5,20])k.ribbon("silver",scaled(p,1.013),y+h,.13);
 // 石材竖缝以稀疏细线表达，非玻璃条带。
 for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/7);for(let j=1;j<n;j++){const t=j/n,c=mean(p),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;k.box("silver",c[0]+(x-c[0])*1.013,y+7,c[1]+(z-c[1])*1.013,.08,18,.08);}}
 k.slab("white",scaled(p,1.012),y+26.5,.8);
 for(const f of data.features.slice(1))tower(k,f.ring.map(k.local),k.yAt(f.center)+27,f.height-27,f.kind==="apartment");
 // 折面金属入口立面；依实景表达浅金板与斜切玻璃的交替，分格为估算。
 let edge:P[]=[p[0],p[1]],score=-Infinity;
 for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),s=-(a[0]+b[0])+(a[1]+b[1])+len*2;if(len>35&&s>score){score=s;edge=[a,b];}}
 const [a,b]=edge,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),center=mean(p),sgn=(dz*((a[0]+b[0])/2-center[0])-dx*((a[1]+b[1])/2-center[1]))>0?1:-1,nx=sgn*dz/len,nz=-sgn*dx/len;
 const at=(t:number,h:number,offset=1)=>new THREE.Vector3(a[0]+dx*t+nx*offset,y+h,a[1]+dz*t+nz*offset);
 const pos:number[]=[];
 for(const [lo,hi] of [[.18,.35],[.52,.71]]){const v=[at(lo,5),at(hi,5),at(hi-.05,26),at(lo+.04,26)];pos.push(...v[0].toArray(),...v[1].toArray(),...v[2].toArray(),...v[0].toArray(),...v[2].toArray(),...v[3].toArray());k.beam("silver",v[0],v[3],.8);k.beam("silver",v[1],v[2],.8);}
 k.triangles("glazing",pos);
 // 斜切幕墙内部保留顺着折边的细分格。
 for(const [lo,hi] of [[.18,.35],[.52,.71]]){
  for(let j=1;j<7;j++){const t=j/7;k.beam("silver",at(lo+(hi-lo)*t,5,1.08),at(lo+.04+(hi-lo-.09)*t,26,1.08),.1);}
  for(let h=9;h<26;h+=4.2){const t=(h-5)/21;k.beam("silver",at(lo+.04*t,h,1.08),at(hi-.05*t,h,1.08),.12);}
 }
 const sign=at(sgn===1?.65:.3,29,1.5);blockSign(k,"WANDA",sign.x,sign.y,sign.z,.9,Math.atan2(-dz,dx)+(sgn===1?Math.PI:0));
 const canopy=at(.45,5,7);k.box("silver",canopy.x,y+5,canopy.z,28,.8,9,Math.atan2(-dz,dx));
 for(const [x,z,w,d] of [[39,29,43,15],[38,79,23,14]]){k.box("glass",x,y+27.5,z,w,2,d,Math.PI/4);k.box("green",x+18,y+27.4,z+12,13,.2,8,Math.PI/4);}
 for(let i=0;i<10;i++){const t=(i+.5)/10,v=at(t,0,18);k.tree(v.x,v.z,y,2.8);}
 k.group.userData={id:"mall-wanda",scale:1,bearingDeg:data.bearingDeg,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
