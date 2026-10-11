import * as THREE from 'three';
import data from '../../../public/sandbox/landmarks/happy-farmland.json';
import {landmarkKit,circle,type LandmarkContext,type LL,type P,type ColorKey} from './_landmark-kit';
import {parkSurface,trail,inRing} from './_park-details';
/** 欢乐田园核心：810度螺旋依据建筑师资料；塔尺寸、作物花色及坡顶位置为估算。 */
export function buildHappyFarmland(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'欢乐田园','#dfbc41',{green:'#a8bd55',leaf:'#7ea36d',red:'#cf897c',wood:'#db744c',water:'#68afb4',stone:'#e4d6b4',white:'#fbf9ed'});
 data.fields.forEach((field,i)=>{
  const colors:ColorKey[]=['accent','green','green','accent','red'];parkSurface(k,field as LL[],colors[i%colors.length],24,.13);
  // 稀疏而明确的种植垄，按照真实田块裁切；花株为沙盘概括。
  const p=field.map(k.local),xs=p.map(q=>q[0]),zs=p.map(q=>q[1]);
  for(let z=Math.min(...zs)+4;z<Math.max(...zs);z+=9){let start:P|null=null;
   for(let x=Math.min(...xs);x<=Math.max(...xs);x+=4){const inside=inRing([x,z],p);if(inside&&!start)start=[x,z];if((!inside||x+4>Math.max(...xs))&&start){const end:P=[x-4,z];if(end[0]>start[0]){const at=(q:P)=>{const ll:LL=[data.anchor[0]+q[0]/103000,data.anchor[1]-q[1]/111000];return new THREE.Vector3(q[0],k.yAt(ll)+.28,q[1]);};k.beam(i%3===0?'white':'leaf',at(start),at(end),.35,.12);}start=null;}}
  }
 });
 // 环绕坡顶的等形田埂与花垄：依据实景保留环形节奏，具体分带为示意。
 const core=data.fields[0];
 for(let j=1;j<=7;j++){const f=j/8,ring=core.map(p=>[data.tower[0]+(p[0]-data.tower[0])*f,data.tower[1]+(p[1]-data.tower[1])*f]);trail(k,[...ring,ring[0]],j%2?1.15:1.7,j%2?'leaf':'stone',.36);}
 let seed=971;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 const ringLocal=core.map(k.local);
 for(let i=0;i<300;i++){
  const ll:LL=[data.tower[0]+(rand()-.5)*.0026,data.tower[1]+(rand()-.5)*.003],p=k.local(ll);
  if(!inRing(p,ringLocal)||Math.hypot(...p)<20)continue;
  const h=k.yAt(ll)+.6,r=1.0+rand(),verts:number[]=[];for(let j=0;j<6;j++){const a=j*Math.PI/3,b=(j+1)*Math.PI/3;verts.push(p[0],h,p[1],p[0]+Math.cos(a)*r,h,p[1]+Math.sin(a)*r,p[0]+Math.cos(b)*r,h,p[1]+Math.sin(b)*r);}k.triangles(i%3?'white':'red',verts);
 }
 for(const route of data.paths)trail(k,route,3.1,'stone',.3);
 const c=k.local(data.tower),base=k.yAt(data.tower),r=10.5;
 k.slab('stone',circle(...c,14,64),base,.3);k.slab('water',circle(...c,4,48),base+.31,.04);
 const pt=(t:number,rad:number,h:number)=>new THREE.Vector3(c[0]+Math.cos(t)*rad,base+h,c[1]+Math.sin(t)*rad);
 const quad=(key:ColorKey,a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>k.triangles(key,[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()]);
 const turns=Math.PI*4.5,n=180;
 // 连续810度上升步道；橙色底面结构、白色外带与通透栏网。
 for(let i=0;i<n;i++){
  const t=i/n*turns,u=(i+1)/n*turns,h=.4+i/n*13.5,hh=.4+(i+1)/n*13.5,rad=r+.9*Math.sin(t*.7),rr=r+.9*Math.sin(u*.7);
  quad('stone',pt(t,rad-3,h),pt(t,rad,h),pt(u,rr,hh),pt(u,rr-3,hh));
  quad('wood',pt(t,rad-3,h-.2),pt(t,rad,h-.2),pt(u,rr,hh-.2),pt(u,rr-3,hh-.2));
  quad('white',pt(t,rad,h),pt(u,rr,hh),pt(u,rr-2,hh+1.8),pt(t,rad-2,h+1.8));
  k.beam('white',pt(t,rad-3,h+1.2),pt(u,rr-3,hh+1.2),.09);
  if(i%2===0){k.beam('wood',pt(t,rad-3,h-.25),pt(t,rad,h-.25),.13);k.beam('wood',pt(t,rad-3,h),pt(t,rad-3,h+1.2),.075);}
  // 外围橙色网状斜撑留出大面积空隙。
  if(i<n-80&&i%4===0){const rise=6; k.beam('wood',pt(t,rad,h+1.3),pt(t+.25,rad-.2,h+rise-.2),.11);}
 }
 for(let i=0;i<12;i++){const t=i*Math.PI/6; k.beam('wood',pt(t,7.5,.3),pt(t,7.5,14),.22);}
 // 顶部观景平台与中心圆孔，仍可看见下方灌溉水池。
 k.slab('stone',circle(...c,10.6,64),base+13.9,.3,[circle(...c,7.3,64)]);k.ribbon('white',circle(...c,10.6,64),base+14.2,1.2);
 for(let j=0;j<22;j++){const a=j*2.39996,rad=34+(j%4)*7,ll:LL=[data.tower[0]+Math.cos(a)*rad/103000,data.tower[1]+Math.sin(a)*rad/111000],p=k.local(ll);if(j%3===0)k.tree(...p,k.yAt(ll),2.5);}
 k.group.userData={id:'happy-farmland',previewFocus:{lngLat:data.tower,distance:44,direction:[1,.6,1]},sources:data.meta.sources,estimates:data.meta.limitations};return k.finish();
}
