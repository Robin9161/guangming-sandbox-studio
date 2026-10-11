import * as THREE from 'three';
import data from '../../../public/sandbox/landmarks/dadingling-bridges.json';
import {landmarkKit,circle,type LL,type P,type LandmarkContext,type ColorKey} from './_landmark-kit';
import {parkSurface} from './_park-details';
type Kind='float'|'explore'|'suspend';
/** 三桥以卫星地理坐标布置；栏杆、标高和树木为估算。每个桥可单独调用。 */
export function buildDadinglingBridges(ctx:LandmarkContext):THREE.Group{return build(ctx,['float','explore','suspend']);}
export function buildDadinglingFloatBridge(ctx:LandmarkContext):THREE.Group{return build(ctx,['float']);}
export function buildDadinglingExploreBridge(ctx:LandmarkContext):THREE.Group{return build(ctx,['explore']);}
export function buildDadinglingSuspendedBridge(ctx:LandmarkContext):THREE.Group{return build(ctx,['suspend']);}
function build(ctx:LandmarkContext,kinds:Kind[]){
 const k=landmarkKit(ctx,data.anchor as LL,'大顶岭三桥','#b46f56',{white:'#f3f2e9',silver:'#aeb8b5',roof:'#596968',leaf:'#719570',green:'#bac99b'});
 const quad=(key:ColorKey,a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>k.triangles(key,[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()]);
 // 细网/细杆使用面条带，远景适度加粗，两面材质，避免大量圆柱。
 const thin=(key:ColorKey,a:THREE.Vector3,b:THREE.Vector3,width=.06)=>{const d=b.clone().sub(a).normalize(),n=new THREE.Vector3(-d.z,0,d.x);if(n.length()<.1)n.set(1,0,0);n.normalize().multiplyScalar(width/2);quad(key,a.clone().add(n),b.clone().add(n),b.clone().sub(n),a.clone().sub(n));};
 const rail=(points:THREE.Vector3[],key:ColorKey='white',height=1.3)=>{
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];thin(key,a.clone().add(new THREE.Vector3(0,height,0)),b.clone().add(new THREE.Vector3(0,height,0)),.13);thin(key,a,b,.1);
   const n=Math.max(1,Math.ceil(a.distanceTo(b)/.85));for(let j=0;j<n;j++){const p=a.clone().lerp(b,j/n);thin(key,p,p.clone().add(new THREE.Vector3(0,height,0)),.065);}}
 };
 const strip=(points:THREE.Vector3[],width:number)=>{
  const left:THREE.Vector3[]=[],right:THREE.Vector3[]=[];
  points.forEach((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=b.clone().sub(a),n=new THREE.Vector3(-d.z,0,d.x).normalize().multiplyScalar(width/2);left.push(p.clone().add(n));right.push(p.clone().sub(n));});
  for(let i=1;i<points.length;i++){quad('silver',left[i-1],right[i-1],right[i],left[i]);for(const r of [left,right])quad('white',r[i-1],r[i],r[i].clone().add(new THREE.Vector3(0,-.35,0)),r[i-1].clone().add(new THREE.Vector3(0,-.35,0)));}
  rail(left);rail(right);return{left,right};
 };
 const forest=(anchor:number[],r:number,count:number)=>{const patch=Array.from({length:24},(_,i)=>{const a=i*Math.PI/12;return[anchor[0]+Math.cos(a)*r*1.2/103000,anchor[1]+Math.sin(a)*r*1.2/111000];});parkSurface(k,patch,'green',12,.08);for(let i=0;i<count;i++){const a=i*2.39996,rad=r*(.38+.62*Math.sqrt((i*37%101)/101)),ll:LL=[anchor[0]+Math.cos(a)*rad/103000,anchor[1]+Math.sin(a)*rad/111000],p=k.local(ll);k.tree(p[0],p[1],k.yAt(ll),2.5+(i%4)*.5);}};
 if(kinds.includes('float')){
  const f=data.float,base=Math.max(...f.approaches.flat().map(p=>k.yAt(p)))+.6;
  f.rings.forEach((r,ri)=>{const c=k.local(r.center),y=base+r.height,points=circle(...c,r.radius,72).map(([x,z])=>new THREE.Vector3(x,y,z));points.push(points[0].clone());strip(points,2.25);
   // 墩柱落到实际地面；上层小环保留轻巧细柱。
   for(let i=0;i<8;i++){const a=i*Math.PI/4,x=c[0]+Math.cos(a)*r.radius,z=c[1]+Math.sin(a)*r.radius,ll:LL=[r.center[0]+Math.cos(a)*r.radius/103000,r.center[1]-Math.sin(a)*r.radius/111000],lo=k.yAt(ll);k.cylinder('roof',x,z,lo,.33,Math.max(.5,y-lo),.33,8);}
   // 横向格栅强调镂空金属步道。
   for(let i=0;i<72;i++){const a=i*Math.PI/36;thin('white',new THREE.Vector3(c[0]+Math.cos(a)*(r.radius-1),y+.02,c[1]+Math.sin(a)*(r.radius-1)),new THREE.Vector3(c[0]+Math.cos(a)*(r.radius+1),y+.02,c[1]+Math.sin(a)*(r.radius+1)),.08);}
  });
  const centers=f.rings.map(r=>k.local(r.center));
  // 环环相切处以短过渡平台连通；通往高环的缓坡沿同一接点上升。
  for(const [a,b] of [[0,1],[1,2]]){const p=centers[a],q=centers[b],dir=new THREE.Vector2(q[0]-p[0],q[1]-p[1]).normalize(),ra=f.rings[a],rb=f.rings[b];strip([new THREE.Vector3(p[0]+dir.x*(ra.radius-1),base+ra.height,p[1]+dir.y*(ra.radius-1)),new THREE.Vector3(q[0]-dir.x*(rb.radius-1),base+rb.height,q[1]-dir.y*(rb.radius-1))],2.6);}
  f.approaches.forEach((route,i)=>{const ps=route.map(k.local);strip(ps.map((p,j)=>new THREE.Vector3(p[0],base+(j===0?.2:8),p[1])),2.5);});
  forest(f.anchor,49,42);
 }
 if(kinds.includes('explore')){
  const e=data.explore,c=k.local(e.anchor),y=k.yAt(e.anchor)+4,rx=e.radius[0],rz=e.radius[1];
  const ellipse=(s:number,h:number)=>Array.from({length:81},(_,i)=>{const a=i*Math.PI/40;return new THREE.Vector3(c[0]+Math.cos(a)*rx*s,y+h,c[1]+Math.sin(a)*rz*s);});
  const outer=ellipse(1,0),inner=ellipse(.82,0);
  for(let i=1;i<outer.length;i++){quad('silver',outer[i-1],outer[i],inner[i],inner[i-1]);thin('white',inner[i-1],inner[i],.12);}rail(outer);
  const treeRing=ellipse(.22,.2),mid=ellipse(.46,-1.6);rail(treeRing);for(let i=1;i<mid.length;i++)thin('white',mid[i-1],mid[i],.13);
  // 橙棕色下凹索网：径向与同心网线均为真实空隙，保留中心活树。
  for(let i=0;i<100;i++){const a=i*Math.PI/50;const pts=[.22,.46,.82].map((s,j)=>new THREE.Vector3(c[0]+Math.cos(a)*rx*s,y+[.2,-1.6,0][j],c[1]+Math.sin(a)*rz*s));thin('accent',pts[0],pts[1],.065);thin('accent',pts[1],pts[2],.065);}
  for(let j=1;j<15;j++){const s=.22+j*.04,h=s<.46?.2-(s-.22)/.24*1.8:-1.6+(s-.46)/.36*1.6,ring=ellipse(s,h);for(let i=1;i<ring.length;i++)thin('accent',ring[i-1],ring[i],.055);}
  for(const a of [0,1.6,3.1,4.7]){const x=c[0]+Math.cos(a)*rx*.92,z=c[1]+Math.sin(a)*rz*.92;k.box('wood',x,y+.15,z,2.5,.4,.6,-a);}
  for(let i=0;i<6;i++){const t=i*Math.PI/3;k.cylinder('roof',c[0]+Math.cos(t)*rx*.94,c[1]+Math.sin(t)*rz*.94,y-4,.2,4,.2,6);}
  strip(e.approach.map(p=>{const q=k.local(p);return new THREE.Vector3(q[0],y,q[1]);}),2.2);
  k.tree(...c,k.yAt(e.anchor),4.2);forest(e.anchor,24,30);
 }
 if(kinds.includes('suspend')){
  const s=data.suspend,a=k.local(s.ends[0]),b=k.local(s.ends[1]),base=Math.max(...s.ends.map(p=>k.yAt(p))),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const at=(t:number,h:number)=>new THREE.Vector3(a[0]+(b[0]-a[0])*t,base+h,a[1]+(b[1]-a[1])*t);
  // 两跨悬带，支柱处形成高点，无虚构的主缆高塔。高差估算。
  const ya=k.yAt(s.ends[0])-base+.45,yb=k.yAt(s.ends[1])-base+.45,peak=Math.max(ya,yb)+2;
  const deck=(t:number)=>t<.28?ya+(peak-ya)*t/.28-1.1*Math.sin(t/.28*Math.PI):peak+(yb-peak)*(t-.28)/.72-3.2*Math.sin((t-.28)/.72*Math.PI);
  const ps=Array.from({length:65},(_,i)=>at(i/64,deck(i/64)));strip(ps,3.2);
  const n=new THREE.Vector3(-(b[1]-a[1])/length,0,(b[0]-a[0])/length);
  for(const side of [-1,1]){const top=at(.28,peak-.35).addScaledVector(n,side*1.05),foot=at(.53,k.yAt([s.ends[0][0]+(s.ends[1][0]-s.ends[0][0])*.53,s.ends[0][1]+(s.ends[1][1]-s.ends[0][1])*.53])-base).addScaledVector(n,side*1.05);k.beam('silver',foot,top,.85,1.3);for(let j=1;j<4;j++){const p=foot.clone().lerp(top,j/4);k.beam('silver',p,p.clone().addScaledVector(n,-side*2.1),.23);}}
  for(let i=0;i<65;i+=2){const p=ps[i];thin('white',p.clone().addScaledVector(n,-1.6),p.clone().addScaledVector(n,1.6),.08);}
  for(const p of [ps[0],ps[64]])k.box('stone',p.x,p.y-2,p.z,5,2,4);
  forest(s.anchor,48,35);
 }
 k.group.userData={id:'dadingling-bridges',sources:data.meta.sources,estimates:data.meta.limitations};return k.finish();
}
