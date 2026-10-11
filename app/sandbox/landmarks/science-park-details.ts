import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";
import data from "../../../public/sandbox/landmarks/science-park-details.json";
type Pt=[number,number];
type Context={project:(lngLat:Pt)=>THREE.Vector3;groundAt:(lngLat:Pt)=>number};
/** 科学公园用户参考规划示意。非现状测绘；详细来源、配准及估算范围见同名JSON。 */
export function buildScienceParkDetails(ctx:Context):THREE.Group{
 const root=new THREE.Group();root.name='科学公园·创新中心与博雅园规划示意';const anchor=data.anchor as Pt,origin=ctx.project(anchor),ground=ctx.groundAt(anchor);root.position.copy(origin);root.position.y=ground;
 const local=(p:number[]):Pt=>{const q=ctx.project(p as Pt);return[q.x-origin.x,q.z-origin.z];};
 const mean=(p:number[][]):Pt=>[p.reduce((s,v)=>s+v[0],0)/p.length,p.reduce((s,v)=>s+v[1],0)/p.length];
 const height=(p:number[])=>ctx.groundAt(p as Pt)-ground;
 const mats={white:new THREE.MeshStandardMaterial({color:'#fbfbf9',roughness:.59}),stone:new THREE.MeshStandardMaterial({color:'#ede4d3',roughness:.76}),glass:new THREE.MeshStandardMaterial({color:'#33475c',roughness:.43,metalness:.12}),water:new THREE.MeshStandardMaterial({color:'#719f9c',roughness:.42,metalness:.08}),grass:new THREE.MeshStandardMaterial({color:'#adc789',roughness:.8}),field:new THREE.MeshStandardMaterial({color:'#d5d884',roughness:.8}),pink:new THREE.MeshStandardMaterial({color:'#cf9caf',roughness:.8}),roof:new THREE.MeshStandardMaterial({color:'#687b78',roughness:.7}),wood:new THREE.MeshStandardMaterial({color:'#b58a71',roughness:.75}),leaf:new THREE.MeshStandardMaterial({color:'#91b68d',roughness:.8,flatShading:true})};glowColor(mats.glass,'#ffe2b0',1);
 type Key=keyof typeof mats;const batch:Record<Key,THREE.BufferGeometry[]>={white:[],stone:[],glass:[],water:[],grass:[],field:[],pink:[],roof:[],wood:[],leaf:[]};
 const add=(k:Key,g:THREE.BufferGeometry)=>{const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute('uv');batch[k].push(v);};
 const shape=(p:Pt[])=>new THREE.Shape(p.map(([x,z])=>new THREE.Vector2(x,-z)));
 const slab=(k:Key,p:Pt[]|THREE.Shape,y:number,h:number)=>add(k,new THREE.ExtrudeGeometry(Array.isArray(p)?shape(p):p,{depth:h,bevelEnabled:false,curveSegments:16,steps:1}).rotateX(-Math.PI/2).translate(0,y,0));
 const box=(k:Key,x:number,y:number,z:number,w:number,h:number,d:number,angle=0)=>add(k,new THREE.BoxGeometry(w,h,d).rotateY(angle).translate(x,y+h/2,z));
 const beam=(k:Key,a:THREE.Vector3,b:THREE.Vector3,w:number,h=w)=>{const delta=b.clone().sub(a),len=delta.length();add(k,new THREE.BoxGeometry(w,h,len).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),delta.normalize())).translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2));};
 const strip=(k:Key,points:Pt[],y:number,width:number)=>{for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];beam(k,new THREE.Vector3(a[0],y,a[1]),new THREE.Vector3(b[0],y,b[1]),width,.2);}};
 const ellipse=(x:number,z:number,rx:number,rz:number):Pt[]=>Array.from({length:40},(_,i)=>[x+rx*Math.cos(i*Math.PI/20),z+rz*Math.sin(i*Math.PI/20)]);
 const lake=data.lake.map(local),island=data.island.map(local),waterY=height(mean(data.lake))+.12,islandY=waterY+1.4;
 const lakeShape=shape(lake);lakeShape.holes.push(new THREE.Path(island.map(([x,z])=>new THREE.Vector2(x,-z))));slab('water',lakeShape,waterY,.15);
 slab('stone',island,waterY,.9);slab('grass',island,islandY-.5,.5);
 strip('stone',[...island,island[0]],islandY+.12,2.3);
 // 原楼村水在用户方案中拓宽，沿线与新湖面同属规划示意；整合时与场景水体择一绘制。
 strip('water',data.river.map(local),waterY+.02,24);strip('water',data.tail.map(local),waterY+.02,24);
 for(let i=0;i<data.fields.length;i++){
  const ring=data.fields[i].map(local),y=height(mean(data.fields[i]))+.25;
  slab(i%2?'grass':'field',ring,y,.12);strip('pink',[...ring,ring[0]],y+.15,5.4);
  // 平行浅色田垄裁剪在多边形内部，不穿出边界。
  const minZ=Math.min(...ring.map(p=>p[1])),maxZ=Math.max(...ring.map(p=>p[1]));
  for(let z=minZ+8;z<maxZ;z+=12){const crosses:number[]=[];for(let j=0;j<ring.length;j++){const a=ring[j],b=ring[(j+1)%ring.length];if((a[1]>z)!==(b[1]>z))crosses.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]));}crosses.sort((a,b)=>a-b);for(let j=0;j+1<crosses.length;j+=2)box('grass',(crosses[j]+crosses[j+1])/2,y+.14,z,Math.max(.1,crosses[j+1]-crosses[j]-1),.06,.6);}
 }
 for(let i=0;i<data.paths.length;i++)strip('stone',data.paths[i].map(local),i>=4?islandY+.2:height(mean(data.paths[i]))+.7,i>=4?3.2:5.5);
 // 创新中心：中央弧形馆与两片流线翼。所有形体尺寸和24m总高为按效果图估算。
 const [ix,iz]=local(data.innovation.anchor),iy=height(data.innovation.anchor)+.6;
 const angle=THREE.MathUtils.degToRad(90-data.innovation.bearingDeg);
 const transform=(p:Pt[]):Pt[]=>p.map(([x,z])=>[ix+x*Math.cos(angle)+z*Math.sin(angle),iz-x*Math.sin(angle)+z*Math.cos(angle)]);
 const smooth=(p:Pt[]):Pt[]=>new THREE.CatmullRomCurve3(p.map(([x,z])=>new THREE.Vector3(x,0,z)),true,'catmullrom',.24).getPoints(40).slice(0,-1).map(p=>[p.x,p.z]);
 const lobe=(p:Pt[],top:number)=>{const c=mean(p),ring=transform(smooth(p)),bands=transform(smooth(p.map(([x,z])=>[c[0]+(x-c[0])*1.014,c[1]+(z-c[1])*1.025])));slab('glass',ring,iy+2,top-2);for(const y of [3.5,8.5,13.5,top])slab('white',bands,iy+y,.65);slab('grass',transform(smooth(p.map(([x,z])=>[c[0]+(x-c[0])*.83,c[1]+(z-c[1])*.72]))),iy+top+.7,.35);};
 lobe([[-35,-13],[-63,-35],[-126,-39],[-165,-17],[-150,7],[-99,20],[-46,13]],17);
 lobe([[36,-12],[72,-28],[136,-41],[161,-19],[151,18],[103,36],[54,20]],18);
 const core=transform(ellipse(0,0,43,32));slab('glass',core,iy+1.2,22);
 for(const y of [2,7,12,17,22.6])slab('white',transform(ellipse(0,0,43.5,32.5)),iy+y,.75);
 slab('white',transform(ellipse(0,0,46,34)),iy+23.3,.7);
 slab('grass',transform(ellipse(0,0,39,27)),iy+24,.25);
 // 中央立面的竖向窗梃，沿半圆前缘均匀分布。
 for(let i=0;i<32;i++){const a=i*Math.PI*2/32,p=transform([[43.1*Math.cos(a),32.1*Math.sin(a)]])[0];box('stone',p[0],iy+2,p[1],.42,20,.42);}
 // 前场连廊和柱列，入口平台侧留开口。
 const porch=transform([[-164,27],[-65,49],[63,53],[166,37]]);strip('stone',porch,iy+1.0,7);
 for(let i=0;i<porch.length-1;i++){const a=porch[i],b=porch[i+1],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/10);for(let j=0;j<=n;j++){const t=j/n;box('white',a[0]+(b[0]-a[0])*t,iy+1,b[1]+(b[1]-a[1])*t,.65,4.5,.65);}beam('white',new THREE.Vector3(a[0],iy+5.5,a[1]),new THREE.Vector3(b[0],iy+5.5,b[1]),3,.45);}
 // 岛上楼阁：用户圈出的三重灰瓦屋檐，不擅自赋予历史建筑名称。尺度、窗扇为估算。
 const [px,pz]=local(data.pavilion.anchor);
 slab('stone',ellipse(px,pz,17,15),islandY,.7);
 const hipRoof=(r:number,y:number,h:number)=>{
  const rings=[[r,y+.35],[r*.88,y],[r*.65,y+h*.32],[r*.3,y+h]];const pos:number[]=[];
  const v=(r:number,y:number,s:number,j:number)=>{const t=j/4,a=s*Math.PI/2+Math.PI/4,b=a+Math.PI/2;return new THREE.Vector3(px+r*(Math.cos(a)*(1-t)+Math.cos(b)*t),y+(j===0?.4:0),pz+r*(Math.sin(a)*(1-t)+Math.sin(b)*t));};
  for(let k=0;k<3;k++)for(let s=0;s<4;s++)for(let j=0;j<4;j++){const a=v(rings[k][0],rings[k][1],s,j),b=v(rings[k][0],rings[k][1],s,j+1),c=v(rings[k+1][0],rings[k+1][1],s,j+1),d=v(rings[k+1][0],rings[k+1][1],s,j);pos.push(...a.toArray(),...c.toArray(),...b.toArray(),...a.toArray(),...d.toArray(),...c.toArray());}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();add('roof',g);
 };
 for(let i=0;i<3;i++){
  const y=islandY+1+i*6,w=17-i*3.2;box('stone',px,y,pz,w,4.5,w);box('white',px,y+4.5,pz,w+1,.4,w+1);hipRoof((w+5)*.72,y+4.9,i===2?3:2);
  for(let side=0;side<4;side++){const a=side*Math.PI/2;for(let j=-1;j<=1;j++){const x=px+Math.sin(a)*(w/2+.08)+Math.cos(a)*j*w*.23,z=pz+Math.cos(a)*(w/2+.08)-Math.sin(a)*j*w*.23;box('glass',x,y+.5,z,w*.14,3.1,.15,a);}}
 }
 for(let i=0;i<7;i++)box('stone',px,islandY+i*.18,pz+16-i*.9,7,.18,1.7);
 // 岛北部的小亭与曲折水榭，按图只保留低矮体量。
 for(const [dx,dz] of [[8,-68],[29,-49],[-16,-32]]){box('wood',px+dx,islandY+.2,pz+dz,5,2.7,5);box('roof',px+dx,islandY+2.9,pz+dz,7,.55,7);}
 const pond=ellipse(px+8,pz-44,19,12);slab('water',pond,islandY+.02,.06);
 strip('stone',[[px-13,pz-58],[px+2,pz-58],[px+2,pz-38],[px+28,pz-38]],islandY+.3,2.5);
 // 西侧橙色曲桥：平面走向按图，拱度和栏杆为估算。
 const bp=data.bridge.map(local),curve=new THREE.CatmullRomCurve3(bp.map(([x,z],i)=>new THREE.Vector3(x,waterY+3+Math.sin(i/(bp.length-1)*Math.PI)*3,z))),bridge=curve.getPoints(24);
 for(let i=0;i<bridge.length-1;i++){
  const a=bridge[i],b=bridge[i+1],dir=b.clone().sub(a).normalize(),n=new THREE.Vector3(-dir.z,0,dir.x);beam('wood',a,b,4.8,.65);
  for(const side of [-1,1]){const aa=a.clone().addScaledVector(n,side*2.15),bb=b.clone().addScaledVector(n,side*2.15);aa.y+=1.3;bb.y+=1.3;beam('stone',aa,bb,.16);if(i%2===0)box('stone',aa.x,a.y,aa.z,.18,1.3,.18);}
 }
 // 确定性低多边形植被，仅在岸线和建筑外围，地理位置为景观示意。
 let seed=73421;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const trees:{x:number,z:number,y:number,r:number}[]=[];
 const plantEdge=(p:Pt[],offset:number,y:number,spacing:number)=>{const c=mean(p);for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.floor(len/spacing);for(let j=0;j<n;j++){const t=(j+.5)/Math.max(1,n);let x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,dx=x-c[0],dz=z-c[1],dist=Math.hypot(dx,dz);x+=dx/dist*(offset+rand()*4);z+=dz/dist*(offset+rand()*4);trees.push({x,z,y,r:3.8+rand()*2.3});}}};
 plantEdge(lake,8,waterY+.2,14);plantEdge(island,-4,islandY,16);
 for(const f of data.fields)plantEdge(f.map(local),3,height(mean(f))+.4,48);
 for(let i=0;i<26;i++){const a=i*Math.PI*2/26;trees.push({x:ix+Math.cos(a)*190,z:iz+Math.sin(a)*65,y:iy,r:4+rand()*2});}
 for(const t of trees.slice(0,210)){
  add('wood',new THREE.CylinderGeometry(.42,.65,4.2,5).translate(t.x,t.y+2.1,t.z));add('leaf',new THREE.IcosahedronGeometry(t.r,0).scale(1,1.15,1).rotateY(rand()*6).translate(t.x,t.y+4+t.r*.55,t.z));
 }
 for(const k of Object.keys(mats) as Key[]){if(!batch[k].length){mats[k].dispose();continue;}const g=mergeGeometries(batch[k],false)!;batch[k].forEach(v=>v.dispose());g.computeBoundingSphere();const mesh=new THREE.Mesh(g,mats[k]);mesh.name=`科学公园规划/${k}`;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
 root.userData={id:'science-park-details',status:data.meta.status,scale:1,estimates:data.meta.limitations,source:data.meta.sources};return root;
}
