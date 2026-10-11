import * as THREE from 'three/webgpu';
import { abs, float, max, mix, positionLocal, pow, sin, uniform, vec3 } from 'three/tsl';
import { addColorMod } from '../scene/nodes';
import data from '../../../public/sandbox/landmarks/guangming-mass-sports-center.json';
import {landmarkKit,scaled,circle,facade,type LL,type P,type ColorKey} from './_landmark-kit';
import {trail,bench,lamp} from './_park-details';
/** 光明群众体育中心。场地按卫星轮廓定位；层高、棚架截面、泳道分格为估算。 */
export function buildGuangmingMassSportsCenter(ctx:{project:(lngLat:LL)=>THREE.Vector3;groundAt:(lngLat:LL)=>number}):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'光明群众体育中心','#267fd1',{accent:'#267fd1',leaf:'#36a968',red:'#ed7044',water:'#28bbee',glazing:'#164e85'});
 const poolDetails=landmarkKit(ctx,data.anchor as LL,'泳池边框与泳圈','#ee8fa2',{red:'#f187a7',white:'#fff1dc',stone:'#f2b3ae'});
 k.slab('stone',data.boundary.map(k.local),-.12,.22);
 // 运动场地各自采用中心地面标高，避免把室外网球场误当成十几米高建筑。
 const angle=.12,ca=Math.cos(angle),sa=Math.sin(angle);
 const frame=(ll:number[])=>{const p=k.local(ll),y=k.yAt(ll)+.5;return{x:p[0],z:p[1],y,at:(x:number,z:number,h=0)=>new THREE.Vector3(p[0]+x*ca-z*sa,y+h,p[1]+x*sa+z*ca)};};
 const quad=(key:ColorKey,a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>k.triangles(key,[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()]);
 const line=(a:THREE.Vector3,b:THREE.Vector3,width=.3,key:ColorKey='white')=>{const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1,n=new THREE.Vector3(-dz/len*width/2,0,dx/len*width/2);quad(key,a.clone().add(n),b.clone().add(n),b.clone().sub(n),a.clone().sub(n));};
 const rectangle=(at:(x:number,z:number,h?:number)=>THREE.Vector3,w:number,d:number,h=0,key:ColorKey='white')=>{const p=[at(-w/2,-d/2,h),at(w/2,-d/2,h),at(w/2,d/2,h),at(-w/2,d/2,h)];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4],.32,key);};
 const tennis=(at:(x:number,z:number,h?:number)=>THREE.Vector3)=>{
  quad('leaf',at(-8.3,-17),at(8.3,-17),at(8.3,17),at(-8.3,17));
  quad('accent',at(-5.485,-11.885,.015),at(5.485,-11.885,.015),at(5.485,11.885,.015),at(-5.485,11.885,.015));
  rectangle(at,10.97,23.77,.04);
  for(const x of [-4.115,4.115])line(at(x,-11.885,.045),at(x,11.885,.045));
  for(const z of [-6.4,0,6.4])line(at(-4.115,z,.045),at(4.115,z,.045));
  line(at(0,-6.4,.045),at(0,6.4,.045));
  for(const x of [-6,6]){const q=at(x,0);k.cylinder('roof',q.x,q.z,q.y,.08,1.08,.08,6);}
  k.beam('white',at(-6,0,1.04),at(6,0,1.04),.07);
  for(const h of [.25,.5,.75])k.beam('roof',at(-6,0,h),at(6,0,h),.025);
  for(let x=-5.7;x<6;x+=.7)k.beam('roof',at(x,0,.15),at(x,0,1.02),.025);
 };
 const fence=(at:(x:number,z:number,h?:number)=>THREE.Vector3,w:number,d:number)=>{
  const corners=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
  for(let i=0;i<4;i++){
   const a=corners[i],b=corners[(i+1)%4],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/7);
   for(const h of [.6,2.8])k.beam('roof',at(...a as P,h),at(...b as P,h),.06);
   for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;k.beam('roof',at(x,z),at(x,z,3),.09);}
  }
 };
 // 沙盘表达：北侧六片合并为三片，位置取相邻场地中心，平面放大1.4倍。
 const enlarge=(at:(x:number,z:number,h?:number)=>THREE.Vector3,s:number)=>(x:number,z:number,h=0)=>at(x*s,z*s,h);
 for(let i=0;i<data.tennisNorth.length;i+=2){const a=data.tennisNorth[i],b=data.tennisNorth[i+1]??a;const f=frame([(a[0]+b[0])/2,(a[1]+b[1])/2]);tennis(enlarge(f.at,1.4));}
 const nc=data.tennisNorth[0].map((_,i)=>data.tennisNorth.reduce((s,p)=>s+p[i],0)/6),nf=frame(nc);fence(nf.at,112,49);
 const roof=frame(data.canopy),rp=k.local(data.canopyEdge),radius=Math.hypot(rp[0]-roof.x,rp[1]-roof.z);
 k.slab('stone',circle(roof.x,roof.z,radius+2,48),roof.y-.3,.2);
 // 棚下八片合并为四片，保留十字通道，场地放大20%。
 for(const z of [-22,22])for(const x of [-20,20])tennis((u,v,h=0)=>roof.at(x+u*1.2,z+v*1.2,h));
 // 圆形空间桁架采用开放骨架表达；外圈、内圈和放射斜撑均合并。
 const ring=(r:number,h:number)=>circle(roof.x,roof.z,r,48).map(p=>new THREE.Vector3(p[0],roof.y+h,p[1]));
 for(const [r,h] of [[radius,12],[radius,13.2],[radius*.27,16],[radius*.27,17.2]]){const ps=ring(r,h);k.path('silver',[...ps,ps[0]],.45);}
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,point=(r:number,h:number,t=a)=>new THREE.Vector3(roof.x+Math.cos(t)*r,roof.y+h,roof.z+Math.sin(t)*r);
  k.beam('white',point(radius,12),point(radius*.27,17.2),.35);
  k.beam('white',point(radius,13.2),point(radius*.27,16),.3);
  k.beam('white',point(radius,12),point(radius*.27,16,a+Math.PI/8),.22);
  if(i%2===0)k.beam('silver',point(radius,0),point(radius,12),.38);
 }
 // 西侧室内球馆及南侧低层配套：复用真实建筑足迹，不把室内场地搬到室外。
 for(const f of data.features){const p=f.ring.map(k.local),y=k.yAt(f.center)+.3;k.slab('stone',p,y,f.height);facade(k,scaled(p,1.003),y+.7,f.height-1.5,3.5,3.6);k.slab('white',scaled(p,1.013),y+f.height,.45);k.slab('green',scaled(p,.94),y+f.height+.46,.16);
  for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if(Math.hypot(b[0]-a[0],b[1]-a[1])<18)continue;k.beam('white',new THREE.Vector3(a[0],y+3.7,a[1]),new THREE.Vector3(b[0],y+3.7,b[1]),.4);}}
 // 标准池真实长度50m；按用户要求沙盘平面放大20%至60m，保留十泳道。
 const poolBase=frame(data.pool),pool={...poolBase,at:enlarge(poolBase.at,1.2)},pr=(w:number,d:number)=>[pool.at(-w/2,-d/2),pool.at(w/2,-d/2),pool.at(w/2,d/2),pool.at(-w/2,d/2)].map(v=>[v.x,v.z] as P);
 poolDetails.slab('stone',pr(35,60),pool.y-.1,.2);poolDetails.slab('white',pr(29,54),pool.y+.12,.52,[pr(25,50)]);
 quad('water',pool.at(-12.5,-25,.23),pool.at(12.5,-25,.23),pool.at(12.5,25,.23),pool.at(-12.5,25,.23));
 for(let i=0;i<10;i++){
  const x=-11.25+i*2.5;line(pool.at(x,-22,.25),pool.at(x,22,.25),.16,'water');for(const z of [-22,22])line(pool.at(x-.65,z,.25),pool.at(x+.65,z,.25),.16,'water');
  const q=pool.at(x,-26,.3);k.box('silver',q.x,q.y,q.z,.6,.45,.7,-angle);k.box('accent',q.x,q.y+.45,q.z,.72,.12,.8,-angle);
  if(i<9){k.beam('white',pool.at(x+1.25,-25,.34),pool.at(x+1.25,25,.34),.16);for(const z of [-22,-18,18,22])k.beam('red',pool.at(x+1.25,z-1,.35),pool.at(x+1.25,z+1,.35),.2);}
 }
 for(const z of [-18,0,18]){for(const x of [12.9,13.5])k.beam('silver',pool.at(x,z,.4),pool.at(x,z,1.15),.06);k.beam('silver',pool.at(12.9,z,1.15),pool.at(13.5,z,1.15),.06);}
 const child=data.children.map(k.local),childY=k.yAt(data.children[0])+1;poolDetails.slab('stone',scaled(child,1.22),childY-.4,.2);poolDetails.slab('white',scaled(child,1.12),childY-.2,.55,[child]);k.slab('water',child,childY+.21,.03);

 // 按用户参考图加入夸张的粉白泳圈；仅作沙盘装饰，不代表现场固定设施。
 const buoy=(x:number,z:number,y:number,r:number)=>{
  for(let i=0;i<8;i++)poolDetails.add(i%2===0?'red':'white',new THREE.TorusGeometry(r,r*.29,6,6,Math.PI/4).rotateZ(i*Math.PI/4).rotateX(-Math.PI/2).translate(x,y,z));
 };
 for(const [x,z,r] of [[-7,-12,1.9],[6,11,2.15],[-3,19,1.75]]){const p=pool.at(x,z,.85);buoy(p.x,p.z,p.y,r);}
 const cc=child.reduce((a,p)=>[a[0]+p[0]/child.length,a[1]+p[1]/child.length] as P,[0,0] as P);buoy(cc[0],cc[1],childY+.9,2);
 // 放大弧形扶梯，奶白扶手在沙盘远景仍清楚可见。
 for(const z of [-15,15])for(const dz of [-.8,.8]){
  const points=[pool.at(11.8,z+dz,-.3),pool.at(11.8,z+dz,1.6),pool.at(12.2,z+dz,2),pool.at(13,z+dz,2),pool.at(13.6,z+dz,1.6),pool.at(13.6,z+dz,.7)];poolDetails.path('white',points,.2);
 }
 for(let i=0;i<4;i++){const p=pool.at(18,i*12-18,.5);bench(k,p.x,p.z,p.y,-angle);k.cylinder('silver',p.x+2,p.z,p.y,.06,2.7,.06,6);k.cylinder('white',p.x+2,p.z,p.y+2.7,2.2,.65,.15,8);}
 // 沙盘表达：三片篮球场保留两端两片，平面放大30%，增强辨识度。
 const displayedBasketball=[data.basketball[0],data.basketball[data.basketball.length-1]];
 for(const ll of displayedBasketball){const base=frame(ll),f={...base,at:enlarge(base.at,1.3)};
  quad('leaf',f.at(-9,-15),f.at(9,-15),f.at(9,15),f.at(-9,15));quad('red',f.at(-7.5,-14,.015),f.at(7.5,-14,.015),f.at(7.5,14,.015),f.at(-7.5,14,.015));rectangle(f.at,15,28,.04);line(f.at(-7.5,0,.04),f.at(7.5,0,.04));
  const arc=(cx:number,cz:number,r:number,start=0,end=Math.PI*2)=>{let prev=f.at(cx+Math.cos(start)*r,cz+Math.sin(start)*r,.045);for(let j=1;j<=24;j++){const a=start+(end-start)*j/24,q=f.at(cx+Math.cos(a)*r,cz+Math.sin(a)*r,.045);line(prev,q);prev=q;}};arc(0,0,1.8);
  for(const side of [-1,1]){arc(0,side*12.4,6.75,side===1?Math.PI:0,side===1?Math.PI*2:Math.PI);for(const x of [-2.45,2.45])line(f.at(x,side*14,.045),f.at(x,side*8.2,.045));line(f.at(-2.45,side*8.2,.045),f.at(2.45,side*8.2,.045));
   const q=f.at(0,side*15),board=f.at(0,side*12.8,2.9);k.beam('silver',q,q.clone().add(new THREE.Vector3(0,3.4,0)),.16);k.beam('silver',q.clone().add(new THREE.Vector3(0,3.4,0)),board,.14);k.box('white',board.x,board.y,board.z,1.8,1.05,.1,-angle);const hoop=f.at(0,side*12.35,3.05);const ps=circle(hoop.x,hoop.z,.3,12).map(p=>new THREE.Vector3(p[0],hoop.y,p[1]));k.path('red',[...ps,ps[0]],.045);}
 }
 for(const p of data.paths)trail(k,p,4.5);
 trail(k,[data.gate,...data.basketball.map(p=>[p[0]+.00015,p[1]])],3.2);
 for(const ll of data.basketball){const f=frame(ll);for(const side of [-1,1]){const p=f.at(side*11,0);lamp(k,p.x,p.z,p.y,6);}}
 const gate=frame(data.gate);for(const x of [-7,7]){const p=gate.at(x,0);k.box('white',p.x,p.y,p.z,.7,4.2,.7);}k.beam('silver',gate.at(-8,0,4.2),gate.at(8,0,4.2),1.4,.45);
 for(let i=0;i<12;i++){const a=i*Math.PI/6,p=roof.at(Math.cos(a)*(radius+7),Math.sin(a)*(radius+7));lamp(k,p.x,p.z,p.y,7);if(i%2===0)bench(k,p.x+2,p.z,p.y);}
 for(let i=0;i<18;i++){const f=nf.at(-55+i*6.5,-23);k.tree(f.x,f.z,f.y,2.8);}
 k.group.userData={id:'guangming-mass-sports-center',previewFocus:{lngLat:data.pool,distance:70,direction:[.2,1,1]},outdoorTennisCourts:7,basketballCourts:2,standardPoolLength:50,displayPoolLength:60,schematicScale:{tennisNorth:1.4,tennisCanopy:1.2,basketball:1.3,pool:1.2},sources:data.meta.sources,estimates:data.meta.limitations};
 const model=k.finish(),details=poolDetails.finish();details.position.set(0,0,0);model.add(details);
 // 无贴图的程序化水波：保留MeshStandardMaterial光照，仅给水材质注入缓慢变化的色差。
 const water=model.children.find(o=>o.name.endsWith('/water')) as THREE.Mesh;
 if(water){const material=water.material as THREE.MeshStandardMaterial,time=uniform(0);material.roughness=.4;material.metalness=0;
  addColorMod(material,rgb=>{const p=positionLocal.xz,t=time;
   const a=sin(p.x.mul(.38).add(sin(p.y.mul(.29).add(t.mul(.32))).mul(1.2)).add(t.mul(.45)));
   const b=sin(p.y.mul(.43).add(sin(p.x.mul(.26).sub(t.mul(.24))).mul(1.1)).sub(t.mul(.36)));
   const ripple=pow(max(0,float(1).sub(abs(a.add(b)).mul(.7))),12.0);
   return mix(rgb,vec3(.52,.89,1.0),ripple.mul(.32)) as unknown as typeof rgb;});
  water.onBeforeRender=()=>{time.value=performance.now()/1000;};
 }
 model.userData.animatedWater=true;
 return model;
}
