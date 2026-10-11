import * as THREE from "three";
import {mergeGeometries} from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {glowColor} from "../scene/atmosphere";
export type LL=[number,number];
export type P=[number,number];
export type LandmarkContext={project:(lngLat:LL)=>THREE.Vector3;groundAt:(lngLat:LL)=>number};
export type ColorKey="white"|"silver"|"stone"|"glass"|"green"|"leaf"|"water"|"accent"|"wood"|"red"|"roof"|"glazing"|"glazingLight";
export const mean=(p:P[]):P=>[p.reduce((s,v)=>s+v[0],0)/p.length,p.reduce((s,v)=>s+v[1],0)/p.length];
export const scaled=(p:P[],scale:number):P[]=>{const c=mean(p);return p.map(([x,z])=>[c[0]+(x-c[0])*scale,c[1]+(z-c[1])*scale]);};
export const circle=(x:number,z:number,r:number,n=32):P[]=>Array.from({length:n},(_,i)=>[x+Math.cos(i*2*Math.PI/n)*r,z+Math.sin(i*2*Math.PI/n)*r]);
export const rounded=(ring:P[],radius=3):P[]=>ring.flatMap((p,i)=>{
 const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],la=Math.hypot(a[0]-p[0],a[1]-p[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]),r=Math.min(radius,la*.2,lb*.2);
 if(!la||!lb)return[p];
 const u:P=[p[0]+(a[0]-p[0])*r/la,p[1]+(a[1]-p[1])*r/la],v:P=[p[0]+(b[0]-p[0])*r/lb,p[1]+(b[1]-p[1])*r/lb];
 return[u,[(u[0]+2*p[0]+v[0])/4,(u[1]+2*p[1]+v[1])/4] as P,v];
});
export function landmarkKit(ctx:LandmarkContext,anchor:LL,name:string,accent="#b98173",colors:Partial<Record<ColorKey,string>>={}){
 const group=new THREE.Group();group.name=name;
 const origin=ctx.project(anchor),ground=ctx.groundAt(anchor);group.position.copy(origin);group.position.y=ground;
 const mat=(color:string,roughness=.68)=>new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});
 const materials={white:mat("#fbfbf9"),silver:mat("#dde2e8",.55),stone:mat("#ede4d3",.78),glass:mat("#33475c",.42),green:mat("#b3c898",.8),leaf:mat("#85ad91",.8),water:mat("#82b6bc",.4),accent:mat(accent,.6),wood:mat("#bc9266",.72),red:mat("#a85c58",.68),roof:mat("#33475c",.72),glazing:mat("#526d80",.4),glazingLight:mat("#77909f",.4)};
 for(const [key,color] of Object.entries(colors))materials[key as ColorKey].color.set(color);
 materials.glazing.metalness=.3;materials.glazingLight.metalness=.25;glowColor(materials.glazing,"#ffe2b0",.35);glowColor(materials.glazingLight,"#ffe2b0",.25);materials.glass.metalness=.12;materials.water.metalness=.12;glowColor(materials.glass,"#ffe2b0",1);
 const batches:Record<ColorKey,THREE.BufferGeometry[]>={white:[],silver:[],stone:[],glass:[],green:[],leaf:[],water:[],accent:[],wood:[],red:[],roof:[],glazing:[],glazingLight:[]};
 const local=(p:number[]):P=>{const v=ctx.project(p as LL);return[v.x-origin.x,v.z-origin.z];};
 const yAt=(p:number[])=>ctx.groundAt(p as LL)-ground;
 const add=(key:ColorKey,g:THREE.BufferGeometry)=>{const t=g.index?g.toNonIndexed():g;if(t!==g)g.dispose();t.deleteAttribute("uv");batches[key].push(t);};
 const triangles=(key:ColorKey,positions:number[])=>{const g=new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();add(key,g);};
 const slab=(key:ColorKey,ring:P[],y:number,h:number,holes:P[][]=[])=>{
  const shape=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z)));
  for(const hole of holes)shape.holes.push(new THREE.Path(hole.map(([x,z])=>new THREE.Vector2(x,-z))));
  add(key,new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1}).rotateX(-Math.PI/2).translate(0,y,0));
 };
 const box=(key:ColorKey,x:number,y:number,z:number,w:number,h:number,d:number,angle=0)=>add(key,new THREE.BoxGeometry(w,h,d).rotateY(angle).translate(x,y+h/2,z));
 const beam=(key:ColorKey,a:THREE.Vector3,b:THREE.Vector3,w:number,h=w)=>{const v=b.clone().sub(a),len=v.length();if(len<.001)return;add(key,new THREE.BoxGeometry(w,h,len).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v.normalize())).translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2));};
 const ribbon=(key:ColorKey,p:P[],y:number,h:number)=>{
  const pos:number[]=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];pos.push(a[0],y,a[1],b[0],y,b[1],b[0],y+h,b[1],a[0],y,a[1],b[0],y+h,b[1],a[0],y+h,a[1]);}triangles(key,pos);
 };
 const cylinder=(key:ColorKey,x:number,z:number,y:number,r:number,h:number,top=r,sides=24)=>add(key,new THREE.CylinderGeometry(top,r,h,sides).translate(x,y+h/2,z));
 const path=(key:ColorKey,points:THREE.Vector3[],w:number,h=.16)=>{for(let i=1;i<points.length;i++)beam(key,points[i-1],points[i],w,h);};
 const geoPath=(key:ColorKey,points:number[][],w:number,offset=.2)=>{
  const v:THREE.Vector3[]=[];
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],pa=ctx.project(a as LL),pb=ctx.project(b as LL),n=Math.max(1,Math.ceil(pa.distanceTo(pb)/7));
   for(let j=0;j<n;j++){const t=j/n,ll:LL=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],p=local(ll);v.push(new THREE.Vector3(p[0],yAt(ll)+offset,p[1]));}}
  const last=points[points.length-1];if(last){const p=local(last);v.push(new THREE.Vector3(p[0],yAt(last)+offset,p[1]));}path(key,v,w);
 };
 const tree=(x:number,z:number,y:number,r=3.2,palm=false)=>{
  cylinder("wood",x,z,y,.45,palm?8:4,.28,5);
  if(!palm)add("leaf",new THREE.IcosahedronGeometry(r,0).scale(1,1.12,1).translate(x,y+4+r*.55,z));
  else {for(let i=0;i<7;i++){const a=i*Math.PI*2/7;const g=new THREE.ConeGeometry(1.8,6,3).rotateZ(Math.PI*.42).rotateY(a).translate(x+Math.cos(a)*2,y+8,z-Math.sin(a)*2);add("leaf",g);}}
 };
 /** 记录当前各批次长度；scaleSince 把之后新增的几何体绕 (cx,cy,cz) 等比放大（沙盘地标感） */
 const mark=()=>Object.fromEntries(Object.entries(batches).map(([k,v])=>[k,v.length])) as Record<ColorKey,number>;
 const scaleSince=(m:Record<ColorKey,number>,s:number,cx:number,cy:number,cz:number)=>{for(const key of Object.keys(batches) as ColorKey[])for(let i=m[key];i<batches[key].length;i++)batches[key][i].translate(-cx,-cy,-cz).scale(s,s,s).translate(cx,cy,cz);};
 const finish=()=>{for(const key of Object.keys(materials) as ColorKey[]){if(!batches[key].length){materials[key].dispose();continue;}const g=mergeGeometries(batches[key],false)!;batches[key].forEach(v=>v.dispose());g.computeBoundingSphere();const m=new THREE.Mesh(g,materials[key]);m.name=name+"/"+key;m.castShadow=true;m.receiveShadow=true;group.add(m);}return group;};
 return {group,local,yAt,add,triangles,slab,box,beam,ribbon,cylinder,path,geoPath,tree,mark,scaleSince,finish};
}
/** 幕墙分格依据照片节奏概括；开间和窗框尺寸为估算。薄面合并，避免每扇窗独立 Mesh。 */
export function facade(k:ReturnType<typeof landmarkKit>,ring:P[],y:number,h:number,bay=3.2,floor=4.2,frame:ColorKey="silver",frameWidth=.09){
 const center=mean(ring);
 const quad=(key:ColorKey,a:P,b:P,lo:number,hi:number)=>{
  // 将细框放到玻璃表面之外，避免共面闪烁。
  if(key===frame){const mid:P=[(a[0]+b[0])/2,(a[1]+b[1])/2],len=Math.hypot(mid[0]-center[0],mid[1]-center[1])||1,dx=(mid[0]-center[0])/len*.045,dz=(mid[1]-center[1])/len*.045;a=[a[0]+dx,a[1]+dz];b=[b[0]+dx,b[1]+dz];}
  k.triangles(key,[a[0],lo,a[1],b[0],lo,b[1],b[0],hi,b[1],a[0],lo,a[1],b[0],hi,b[1],a[0],hi,a[1]]);
 };
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(len/bay));
  const at=(t:number):P=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  for(let j=0;j<n;j++){
   quad((i+j)%4===0?"glazingLight":"glazing",at(j/n),at((j+1)/n),y,y+h);
   const t=j/n,w=Math.min(frameWidth/Math.max(len,.01),.35/n);quad(frame,at(t),at(Math.min(1,t+w)),y,y+h);
  }
  for(let v=floor;v<h;v+=floor)quad(frame,a,b,y+v-.08,y+v+.08);
 }
}
export function tower(k:ReturnType<typeof landmarkKit>,ring:P[],y:number,h:number,apartment=false){
 const skin=scaled(ring,1.004);
 k.slab(apartment?"white":"glass",ring,y,h);
 facade(k,skin,y+.4,h-.8,apartment?3.5:2.7,apartment?3.6:4.2,apartment?"white":"silver",apartment?.65:.09);
 // 办公塔细框玻璃；住宅塔保留更厚楼板、竖向墙肢与内凹窗带。
 for(let v=3.6;v<h-1;v+=apartment?3.6:16.8)k.ribbon(apartment?"white":"roof",scaled(ring,1.007),y+v,apartment?.45:.2);
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/(apartment?8:24)));
  for(let j=0;j<n;j++){const t=j/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;k.box(apartment?"white":"silver",x,y,z,apartment?.65:.32,h,apartment?.65:.32);}
 }
 k.slab("silver",scaled(ring,1.009),y+h,.4);
 if(apartment)k.slab("white",scaled(ring,.76),y+h+.4,1.4);
 else {facade(k,skin,y+h+.4,3.5,2.7,4);k.slab("roof",scaled(ring,.75),y+h+.1,.3);}
}
/** 简化字标，以几何体构造，无贴图。 */
export function blockSign(k:ReturnType<typeof landmarkKit>,word:string,x:number,y:number,z:number,s:number,angle=0){
 const glyphs:Record<string,string[]>={W:["10001","10001","10101","10101","11011"],A:["01110","10001","11111","10001","10001"],N:["10001","11001","10101","10011","10001"],D:["11110","10001","10001","10001","11110"],C:["01111","10000","10000","10000","01111"],O:["01110","10001","10001","10001","01110"],I:["111","010","010","010","111"],T:["11111","00100","00100","00100","00100"],Y:["10001","01010","00100","00100","00100"]};
 let offset=0;for(const letter of word){const rows=glyphs[letter];if(!rows){offset+=3*s;continue;}rows.forEach((row,i)=>[...row].forEach((v,j)=>{if(v==="1"){const dx=offset+j*s;k.box("accent",x+dx*Math.cos(angle),y+(4-i)*s,z-dx*Math.sin(angle),s*.9,s*.9,s*.5,angle);}}));offset+=(rows[0].length+1)*s;}
}
