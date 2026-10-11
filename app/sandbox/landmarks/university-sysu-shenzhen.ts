import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";
import data from "../../../public/sandbox/landmarks/university-sysu-shenzhen.json";
type Context={project:(lngLat:[number,number])=>THREE.Vector3;groundAt:(lngLat:[number,number])=>number};
type Pt=[number,number];
/** 中大深圳校区图书馆核心组团。真实地理轮廓/来源见同名JSON；80m总高及细部均为估算。 */
export function buildUniversitySysuShenzhen(ctx:Context):THREE.Group{
  const root=new THREE.Group();root.name="中山大学深圳校区·图书馆核心组团";
  const anchor=data.anchor as Pt,origin=ctx.project(anchor),ground=ctx.groundAt(anchor);
  root.position.copy(origin);root.position.y=ground;
  const theta=THREE.MathUtils.degToRad(90-data.bearingDeg);root.rotation.y=theta;
  const toLocal=(p:number[])=>{const q=ctx.project(p as Pt).sub(origin);return [Math.cos(theta)*q.x-Math.sin(theta)*q.z,Math.sin(theta)*q.x+Math.cos(theta)*q.z] as Pt;};
  const features=data.features.map(f=>({...f,points:f.ring.map(toLocal)}));
  const center=(p:Pt[]):Pt=>[p.reduce((s,v)=>s+v[0],0)/p.length,p.reduce((s,v)=>s+v[1],0)/p.length];
  const mats={brick:new THREE.MeshStandardMaterial({color:"#a34f52",roughness:.72}),white:new THREE.MeshStandardMaterial({color:"#fbfbf9",roughness:.64}),stone:new THREE.MeshStandardMaterial({color:"#ede4d3",roughness:.78}),roof:new THREE.MeshStandardMaterial({color:"#33475c",roughness:.52,metalness:.12}),glass:new THREE.MeshStandardMaterial({color:"#304958",roughness:.4,metalness:.17}),green:new THREE.MeshStandardMaterial({color:"#a5b88c",roughness:.8}),gold:new THREE.MeshStandardMaterial({color:"#bbaa7d",roughness:.55,metalness:.25})};
  glowColor(mats.glass,"#ffe2b0",1);
  type Key=keyof typeof mats;
  const batch:Record<Key,THREE.BufferGeometry[]>={brick:[],white:[],stone:[],roof:[],glass:[],green:[],gold:[]};
  const add=(k:Key,g:THREE.BufferGeometry)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');batch[k].push(v);};
  const box=(k:Key,x:number,y:number,z:number,w:number,h:number,d:number,angle=0)=>add(k,new THREE.BoxGeometry(w,h,d).rotateY(angle).translate(x,y+h/2,z));
  const poly=(p:Pt[])=>new THREE.Shape(p.map(([x,z])=>new THREE.Vector2(x,-z)));
  const slab=(k:Key,p:Pt[]|THREE.Shape,y:number,h:number)=>add(k,new THREE.ExtrudeGeometry(Array.isArray(p)?poly(p):p,{depth:h,bevelEnabled:false,curveSegments:24}).rotateX(-Math.PI/2).translate(0,y,0));
  const beam=(k:Key,a:THREE.Vector3,b:THREE.Vector3,width:number)=>{const v=b.clone().sub(a);add(k,new THREE.BoxGeometry(width,v.length(),width).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize())).translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2));};
  const arch=(width:number,height:number)=>{const r=width/2,s=new THREE.Shape();s.moveTo(-r,0);s.lineTo(r,0);s.lineTo(r,height-r);s.absarc(0,height-r,r,0,Math.PI,false);s.closePath();return s;};
  const archBand=(width:number,height:number,thick:number)=>{const s=arch(width+2*thick,height+thick);const hole=arch(width,height);s.holes.push(new THREE.Path(hole.getPoints(10)));return s;};
  const faceShape=(k:Key,s:THREE.Shape,x:number,y:number,z:number,angle:number,depth=.18)=>{const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,curveSegments:6});g.rotateY(angle).translate(x,y,z);add(k,g);};
  const library=features.find(f=>f.id==='library')!;
  const [cx,cz]=center(library.points);
  const libLngLat:[number,number]=[library.ring.reduce((s,p)=>s+p[0],0)/library.ring.length,library.ring.reduce((s,p)=>s+p[1],0)/library.ring.length];
  // 坡地建筑：楼面取轮廓内最高地面，低侧用石材基座补到最低地面（沙盘山体有高程夸张，取单点会埋进山里）
  const groundSpan=(ring:number[][])=>{const v=ring.map(p=>ctx.groundAt(p as Pt)-ground);return{min:Math.min(...v),max:Math.max(...v)};};
  const plinth=(p:Pt[],r:{min:number;max:number})=>{if(r.max-r.min>.5)slab('stone',p,r.min-.5,r.max-r.min+.5);};
  const libSpan=groundSpan(library.ring);
  const base=Math.max(ctx.groundAt(libLngLat)-ground,libSpan.max);
  const scaled=(p:Pt[],s:number):Pt[]=>p.map(([x,z])=>[cx+(x-cx)*s,cz+(z-cz)*s]);
  plinth(scaled(library.points,1.17),libSpan);
  // 真实矢量为六条长边加六个短倒角。底层沿原轮廓，上部以六边退台简化照片体量。
  slab('stone',scaled(library.points,1.17),base,2);
  slab('brick',library.points,base+2,27);
  slab('white',scaled(library.points,1.015),base+29,1);
  // 每条真实长边配大竖窗和顶部拱形小窗；开间细节为估算。
  for(let i=0;i<library.points.length;i++){
    const a=library.points[i],b=library.points[(i+1)%library.points.length];const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<20)continue;
    const mid:Pt=[(a[0]+b[0])/2,(a[1]+b[1])/2];let nx=dz/length,nz=-dx/length;if(nx*(mid[0]-cx)+nz*(mid[1]-cz)<0){nx=-nx;nz=-nz;}
    const angle=Math.atan2(nx,nz),w=length*.65,x=mid[0]+nx*.3,z=mid[1]+nz*.3;
    box('glass',x,base+4,z,w,18,.35,angle);
    for(let j=0;j<=7;j++){const off=-w/2+j*w/7;box('brick',x+Math.cos(angle)*off,base+4,z-Math.sin(angle)*off,.5,18,.55,angle);}
    for(let h=0;h<3;h++)box('brick',x,base+4+h*6,z,w,.3,.6,angle);
    for(let j=0;j<7;j++){const off=(j-3)*w/7;faceShape('glass',arch(2.5,3.8),x+Math.cos(angle)*off,base+23,z-Math.sin(angle)*off,angle);}
  }
  const hex=(r:number):Pt[]=>Array.from({length:6},(_,i)=>[cx+Math.cos(Math.PI/6+i*Math.PI/3)*r,cz+Math.sin(Math.PI/6+i*Math.PI/3)*r]);
  for(const [r,y,h] of [[44,30,10],[36,40,10],[29,50,10]]){
    const ring=hex(r);slab('white',hex(r+1),base+y,.65);
    // 真正的拱形立面开洞与内退玻璃，保留屋顶露台厚度。
    for(let i=0;i<6;i++){
      const a=ring[i],b=ring[(i+1)%6],mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
      const nx=(mx-cx)/(r*Math.cos(Math.PI/6)),nz=(mz-cz)/(r*Math.cos(Math.PI/6)),angle=Math.atan2(nx,nz),w=r;
      const wall=new THREE.Shape([new THREE.Vector2(-w/2,0),new THREE.Vector2(w/2,0),new THREE.Vector2(w/2,h),new THREE.Vector2(-w/2,h)]);
      const aw=r*.66,ah=8; // 椭圆拱：圆拱压缩高度，参照实景宽矮的拱窗。
      const cut=arch(aw,aw/2+2);const pts=cut.getPoints(10).map(p=>new THREE.Vector2(p.x,p.y*(ah/(aw/2+2))+1));wall.holes.push(new THREE.Path(pts));
      faceShape('brick',wall,mx,base+y,mz,angle,.7);
      const windowShape=new THREE.Shape(pts);faceShape('glass',windowShape,mx-nx*.18,base+y,mz-nz*.18,angle,.15);
      const trim=archBand(aw,aw/2+2,.55);const tg=new THREE.ExtrudeGeometry(trim,{depth:.35,bevelEnabled:false,curveSegments:6});tg.scale(1,ah/(aw/2+2),1).rotateY(angle).translate(mx+nx*.78,base+y+1,mz+nz*.78);add('stone',tg);
      for(let j=-2;j<=2;j++){const off=j*aw/6;box('white',mx+Math.cos(angle)*off+nx*.04,base+y+1,mz-Math.sin(angle)*off+nz*.04,.18,Math.max(2,ah-2),.18,angle);}
    }
    slab('stone',hex(r),base+y+h-.55,.55);
  }
  // 蓝色六面攒尖屋顶与收束小顶，比例估算；总高度控制为约80m。
  const cone=(rb:number,rt:number,y:number,h:number)=>add('roof',new THREE.CylinderGeometry(rt,rb,h,6,1,false,Math.PI/3).translate(cx,base+y+h/2,cz));
  cone(30.2,7,60,15);cone(9,1.3,75,3);
  slab('stone',hex(9),base+74.85,.2);
  for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;beam('roof',new THREE.Vector3(cx+30.2*Math.cos(a),base+60,cz+30.2*Math.sin(a)),new THREE.Vector3(cx+7*Math.cos(a),base+75,cz+7*Math.sin(a)),.28);}
  add('gold',new THREE.CylinderGeometry(.3,.48,1.55,8).translate(cx,base+78.77,cz));add('gold',new THREE.SphereGeometry(.47,8,6).translate(cx,base+79.53,cz));
  // 前庭是真实圆形范围，半环回廊保留朝教学区的缺口，不把公园/地形打包进模型。
  const court=features.find(f=>f.id==='court')!,[px,pz]=center(court.points);
  const courtSpan=groundSpan(court.ring);
  const courtBase=courtSpan.max;
  plinth(court.points,courtSpan);
  slab('stone',court.points,courtBase,.65);
  const arcShape=(inner:number,outer:number,start:number,end:number)=>{const s=new THREE.Shape();s.absarc(px,-pz,outer,start,end,false);s.absarc(px,-pz,inner,end,start,true);s.closePath();return s;};
  slab('green',arcShape(12,23,.2,Math.PI*1.78),courtBase+.66,.08);
  slab('brick',arcShape(29,32,-.5,Math.PI*1.2),courtBase+.7,6.7);
  slab('stone',arcShape(27.8,33,-.5,Math.PI*1.2),courtBase+7.4,.45);
  // 内侧柱廊沿弧，拱洞以退入的深色半圆窗表现。
  for(let i=0;i<20;i++){const a=-.42+i*(Math.PI*1.2+.5-.15)/20,x=px+28.85*Math.cos(a),z=pz-28.85*Math.sin(a),angle=Math.atan2(-Math.cos(a),Math.sin(a));faceShape('glass',arch(2.5,5.1),x,courtBase+1,z,angle,.12);}
  // 三翼沿已存在的地理轮廓，立面开间按长度重复，16m层高为估算。
  for(const f of features.filter(f=>f.id.endsWith('wing'))){
    const wingSpan=groundSpan(f.ring);const y=wingSpan.max;plinth(f.points,wingSpan);slab('brick',f.points,y,16);slab('stone',f.points,y+16,.7);
    const fc=center(f.points);
    slab('green',f.points.map(([x,z])=>[fc[0]+(x-fc[0])*.9,fc[1]+(z-fc[1])*.9] as Pt),y+16.71,.24);
    for(let i=0;i<f.points.length;i++){
      const a=f.points[i],b=f.points[(i+1)%f.points.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<12)continue;let nx=dz/len,nz=-dx/len;const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;if(nx*(mx-fc[0])+nz*(mz-fc[1])<0){nx=-nx;nz=-nz;}const angle=Math.atan2(nx,nz),count=Math.floor(len/5.5);
      for(let j=0;j<count;j++){const t=(j+.5)/count,x=a[0]+dx*t+nx*.15,z=a[1]+dz*t+nz*.15;box('glass',x,y+4,z,2.8,9.8,.2,angle);box('white',x,y+8.5,z,2.9,.25,.35,angle);}
    }
  }
  // 核心步行轴与主馆前台阶：走向按卫星图，宽度和级数为估算。
  const wings=features.filter(f=>f.id.endsWith('wing'));
  const wc=center(wings.map(f=>center(f.points)));
  const vx=wc[0]-px,vz=wc[1]-pz,vl=Math.hypot(vx,vz),ux=vx/vl,uz=vz/vl;
  const start:Pt=[px+ux*25,pz+uz*25],end:Pt=[px+ux*(vl+24),pz+uz*(vl+24)];
  slab('stone',[[start[0]-uz*12,start[1]+ux*12],[end[0]-uz*12,end[1]+ux*12],[end[0]+uz*12,end[1]-ux*12],[start[0]+uz*12,start[1]-ux*12]],courtBase+.05,.18);
  const dx=cx-px,dz=cz-pz,dist=Math.hypot(dx,dz),sx=dx/dist,sz=dz/dist,span=Math.max(8,dist-30-52);
  for(let i=0;i<10;i++){
    const distance=30+(i+.5)*span/10,t=i/9;
    box('stone',px+sx*distance,courtBase+(base-courtBase+2)*t,pz+sz*distance,22,.25,span/10+.12,Math.atan2(sx,sz));
  }
  for(const k of Object.keys(mats) as Key[]){if(!batch[k].length){mats[k].dispose();continue;}const geometry=mergeGeometries(batch[k],false)!;batch[k].forEach(g=>g.dispose());geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,mats[k]);mesh.name=`中大深圳/${k}`;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
  root.userData={id:'university-sysu-shenzhen',bearingDeg:130,scale:1,scope:'图书馆及前庭与弧形教学翼',heightStatus:'估算',sources:data.meta.sources};
  return root;
}
