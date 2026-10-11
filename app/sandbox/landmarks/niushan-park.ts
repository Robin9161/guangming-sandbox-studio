import * as THREE from 'three';
import data from '../../../public/sandbox/landmarks/niushan-park.json';
import {landmarkKit,circle,type LL,type P} from './_landmark-kit';
import {parkSurface,trail,inRing,bench,lamp,pavilion} from './_park-details';
/** 牛山公园即光明新城公园；真实边界，地面均来自groundAt。树木与设施细部为估算。 */
export function buildNiushanPark(ctx:{project:(lngLat:LL)=>THREE.Vector3;groundAt:(lngLat:LL)=>number}):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'牛山公园 · 光明新城公园','#bd7d98');
 parkSurface(k,data.boundary,'green',38);parkSurface(k,data.plaza,'stone',12,.4);
 const trailSegments:{a:P;b:P}[]=[];
 for(const [index,path]of data.paths.entries()){
  const ps=trail(k,path,index<2?4.5:2.8,'stone',.65);
  for(let j=1;j<ps.length;j++)trailSegments.push({a:[ps[j-1].x,ps[j-1].z],b:[ps[j].x,ps[j].z]});
  for(let j=12;j<ps.length;j+=24){const p=ps[j];if(index<2)lamp(k,p.x+3.4,p.z,p.y,4.3);if(index%2===0)bench(k,p.x-4,p.z,p.y);}
 }
 let seed=310;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const minX=Math.min(...data.boundary.map(p=>p[0])),maxX=Math.max(...data.boundary.map(p=>p[0])),minY=Math.min(...data.boundary.map(p=>p[1])),maxY=Math.max(...data.boundary.map(p=>p[1]));
 for(let i=0,count=0;i<2200&&count<290;i++){
  const ll:LL=[minX+(maxX-minX)*rand(),minY+(maxY-minY)*rand()];if(!inRing(ll,data.boundary)||inRing(ll,data.plaza))continue;
  const p=k.local(ll);if(trailSegments.some(({a,b})=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<8;}))continue;
  k.tree(...p,k.yAt(ll)+.3,6+rand()*4);count++;
 }
 // 花廊只沿官方资料所述簕杜鹃步道作节奏化表达，花盆位置为估算。
 for(const ll of data.flowerWalk){const p=k.local(ll),y=k.yAt(ll);for(const side of [-1,1]){k.cylinder('stone',p[0],p[1]+side*7,y,.9,.8,.75,8);k.add('accent',new THREE.IcosahedronGeometry(2.7,0).scale(1,.65,1).translate(p[0],y+2.2,p[1]+side*7));}}
 for(const ll of data.pavilions)pavilion(k,ll,5);
 // 开放式入口：景石、导览牌和两侧低墙，未虚构传统牌楼。
 for(const [index,ll] of [data.entrance,data.eastEntrance,data.southEntrance].entries()){
  const p=k.local(ll),y=k.yAt(ll);k.slab('stone',circle(...p,index===0?17:10,24),y+.25,.35);
  k.add('stone',new THREE.IcosahedronGeometry(1,0).scale(4.6,2,1.2).translate(p[0]-7,y+1.9,p[1]));
  k.box('wood',p[0]+9,y,p[1],.25,3,.25);k.box('wood',p[0]+11,y,p[1],.25,3,.25);k.box('roof',p[0]+10,y+1,p[1],2.5,1.8,.15);
  for(const side of [-1,1]){k.box('white',p[0]+side*16,y,p[1],7,.65,1.1);lamp(k,p[0]+side*12,p[1]-3,y,4);}
 }
 k.group.userData={id:'niushan-park',previewFocus:{lngLat:data.entrance,distance:48,direction:[-.7,.6,1]},scale:1,sources:data.meta.sources,estimates:data.meta.limitations};return k.finish();
}
