import * as THREE from 'three';
import {landmarkKit,circle,type LL,type P,type ColorKey} from './_landmark-kit';
type Kit=ReturnType<typeof landmarkKit>;
export function inRing(p:number[],ring:number[][]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
/** 贴地面片和步道：只使用调用者地形，不自行造山。 */
export function parkSurface(k:Kit,source:number[][],key:ColorKey='green',spacing=32,offset=.24){
 const ring=source.slice();if(ring[0][0]===ring.at(-1)![0]&&ring[0][1]===ring.at(-1)![1])ring.pop();
 const flat=ring.map(k.local),faces=THREE.ShapeUtils.triangulateShape(flat.map(p=>new THREE.Vector2(...p)),[]),pos:number[]=[];
 const emit=(ps:number[][],depth=0):void=>{const ls=ps.map(k.local),lengths=ls.map((p,i)=>Math.hypot(p[0]-ls[(i+1)%3][0],p[1]-ls[(i+1)%3][1])),n=lengths.indexOf(Math.max(...lengths));
  if(lengths[n]>spacing&&depth<15){const a=ps[n],b=ps[(n+1)%3],c=ps[(n+2)%3],m=[(a[0]+b[0])/2,(a[1]+b[1])/2];emit([a,m,c],depth+1);emit([m,b,c],depth+1);return;}
  ps.forEach((p,i)=>pos.push(ls[i][0],k.yAt(p)+offset,ls[i][1]));};
 faces.forEach(f=>emit(f.map(i=>ring[i])));k.triangles(key,pos);
}
export function trail(k:Kit,route:number[][],width=3,key:ColorKey='stone',offset=.5){
 const ps:THREE.Vector3[]=[];
 for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],u=k.local(a),v=k.local(b),n=Math.max(1,Math.ceil(Math.hypot(v[0]-u[0],v[1]-u[1])/5));for(let j=0;j<n;j++){const t=j/n,ll=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],p=k.local(ll);ps.push(new THREE.Vector3(p[0],k.yAt(ll)+offset,p[1]));}}
 const ll=route.at(-1)!;if(!ll)return ps;const p=k.local(ll);ps.push(new THREE.Vector3(p[0],k.yAt(ll)+offset,p[1]));
 const sides=ps.map((p,i)=>{const prev=ps[Math.max(0,i-1)],next=ps[Math.min(ps.length-1,i+1)],dx=next.x-prev.x,dz=next.z-prev.z,len=Math.hypot(dx,dz)||1;return [new THREE.Vector3(p.x-dz/len*width/2,p.y,p.z+dx/len*width/2),new THREE.Vector3(p.x+dz/len*width/2,p.y,p.z-dx/len*width/2)];});
 const pos:number[]=[];for(let i=1;i<sides.length;i++){const[a,b]=sides[i-1],[c,d]=sides[i];pos.push(...a.toArray(),...b.toArray(),...c.toArray(),...b.toArray(),...d.toArray(),...c.toArray());}k.triangles(key,pos);return ps;
}
export function bench(k:Kit,x:number,z:number,y:number,angle=0){
 k.box('wood',x,y+.55,z,2.8,.18,.8,angle);k.box('wood',x-Math.sin(angle)*.32,y+.72,z-Math.cos(angle)*.32,2.8,.65,.13,angle);
 for(const side of [-1,1])k.box('silver',x+Math.cos(angle)*side,y,z-Math.sin(angle)*side,.16,.55,.65,angle);
}
export function lamp(k:Kit,x:number,z:number,y:number,h=5){k.box('roof',x,y,z,.16,h,.16);k.box('silver',x,y+h,z,1.1,.14,.65);k.box('white',x,y+h-.08,z,.85,.12,.45);}
/** 实景为灰白石柱、红褐匾额、三门七楼高低檐；尺寸、斗拱简化为估算。 */
export function honghuaGate(k:Kit,ll:LL,angle:number){
 const p=k.local(ll),y=k.yAt(ll)+.4;
 const at=(x:number,h:number,z=0)=>new THREE.Vector3(p[0]+x*Math.cos(angle)+z*Math.sin(angle),y+h,p[1]-x*Math.sin(angle)+z*Math.cos(angle));
 const box=(key:ColorKey,x:number,h:number,z:number,w:number,height:number,d:number)=>{const q=at(x,h,z);k.box(key,q.x,q.y,q.z,w,height,d,angle);};
 for(const x of [-19,-7,7,19]){box('stone',x,0,0,2.5,.7,3);box('white',x,.7,0,1.65,10.1,2);box('red',x,1.1,1.03,.86,7.7,.09);}
 for(const [x,w,h] of [[-13,12,8.1],[0,14,9.5],[13,12,8.1]]){
  box('stone',x,h-1.5,0,w,1,2);box('white',x,h-.5,0,w,2.5,2.1);box('red',x,h+.25,1.07,w*.68,.95,.13);
 }
 const roof=(x:number,w:number,h:number,d:number)=>{
  const pos:number[]=[];
  for(const side of [-1,1])for(let i=0;i<4;i++){
   const x0=x-w/2+i*w/4,x1=x-w/2+(i+1)*w/4;
   const rise=(xx:number)=>.5*Math.pow(Math.abs(xx-x)/(w/2),4);
   const a=at(x0,h+rise(x0),side*d/2),b=at(x1,h+rise(x1),side*d/2),c=at(x1,h+1.05,0),e=at(x0,h+1.05,0);
   pos.push(...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...e.toArray());
   k.beam('stone',a,b,.15);if(i%2===0)k.beam('silver',a,e,.09);
  }
  k.triangles('roof',pos);k.beam('roof',at(x-w*.48,h+1.12),at(x+w*.48,h+1.12),.22);
  for(let xx=x-w*.43;xx<x+w*.44;xx+=1.3){box('red',xx,h-.6,0,.32,.6,d*.72);box('red',xx,h-.3,0,.7,.18,d*.84);}
 };
 roof(0,17,12.2,4.6);roof(-13,13.3,11.1,4.3);roof(13,13.3,11.1,4.3);
 for(const x of [-19,-7,7,19])roof(x,5.2,9.4,3.8);
 // 狮子仅概括轮廓，不臆造雕刻纹样。
 for(const x of [-20.6,20.6]){box('stone',x,0,2.8,1.9,.7,2.2);for(const [h,r,z]of[[1.3,.8,2.8],[2.3,.65,3.1]]){const q=at(x,h,z);k.add('stone',new THREE.IcosahedronGeometry(r,0).scale(.8,1,1).translate(q.x,q.y,q.z));}}
}
export function pavilion(k:Kit,ll:number[],r=5){const p=k.local(ll),y=k.yAt(ll);k.slab('stone',circle(...p,r+1,8),y+.25,.35);for(let i=0;i<6;i++){const a=i*Math.PI/3;k.cylinder('wood',p[0]+Math.cos(a)*r*.7,p[1]+Math.sin(a)*r*.7,y+.6,.18,3.8,.18,6);}k.cylinder('roof',p[0],p[1],y+4.4,r+1,1.6,.35,6);}
