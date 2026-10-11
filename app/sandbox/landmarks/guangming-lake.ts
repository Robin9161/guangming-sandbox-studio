import * as THREE from 'three/webgpu';
import { attribute, pow } from 'three/tsl';
import {glowColor,nightUniform} from '../scene/atmosphere';
import data from '../../../public/sandbox/landmarks/guangming-lake.json';
import {landmarkKit,circle,mean,scaled,type LandmarkContext,type LL,type P,type ColorKey} from './_landmark-kit';
import {inRing} from './_park-details';
/** 光明湖（公明水库）。轮廓由现有水面数据定位并经卫星复核细化，岛、坝和取水建筑位置由卫星描摹。
 * 建筑尺寸、坝坡断面和岛屿高差均为估算。接入时应替换旧光明湖水面。
 */
export function buildGuangmingLake(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'光明湖','#aeb6a9',{water:'#477e80',green:'#718a38',leaf:'#52765a',stone:'#b9b5a1',silver:'#b6bec0',white:'#efeee4'});
 const lightPositions:number[]=[],lightFalloff:number[]=[];
 const y=.8, islands=data.islands.map(r=>r.map(k.local));
 k.slab('water',data.ring.map(k.local),y-.3,.3,islands);
 // 缓坡岛体用同心不规则地形环连接，避免竖直的圆柱形岛岸。高差为估算。
 islands.forEach((ring,index)=>{
  const height=index===2?2.2:index===0?15:19;
  const rings=[ring,scaled(ring,.86),scaled(ring,.53),scaled(ring,.1)],levels=[y,y+2,y+height*.73,y+height];
  for(let j=1;j<rings.length;j++){
   const pos:number[]=[];for(let i=0;i<ring.length;i++){const n=(i+1)%ring.length,a=rings[j-1][i],b=rings[j-1][n],c=rings[j][n],d=rings[j][i];pos.push(a[0],levels[j-1],a[1],b[0],levels[j-1],b[1],c[0],levels[j],c[1],a[0],levels[j-1],a[1],c[0],levels[j],c[1],d[0],levels[j],d[1]);}k.triangles(j===1?'stone':'green',pos);
  }
  k.slab('green',rings[3],levels[3]-.2,.2);
  const c=mean(ring),bounds=new THREE.Box2().setFromPoints(ring.map(p=>new THREE.Vector2(...p)));
  let seed=91+index;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<(index===2?3:245);i++){
   const p:P=[bounds.min.x+random()*(bounds.max.x-bounds.min.x),bounds.min.y+random()*(bounds.max.y-bounds.min.y)];
   if(!inRing(p,rings[1]))continue;
   const d=Math.hypot((p[0]-c[0])/(bounds.max.x-bounds.min.x)*2,(p[1]-c[1])/(bounds.max.y-bounds.min.y)*2);
   // 植被位置与冠幅为示意；基部用分环表面插值近似。
   let f=0;for(let j=1;j<=100;j++)if(inRing(p,scaled(ring,j/100))){f=j/100;break;}
   const h=f>.53?2+( .86-f)/.33*(height*.73-2):height*.73+(.53-f)/.43*height*.27;
   k.tree(p[0],p[1],y+Math.min(height,Math.max(2,h))-.3,5+random()*5+d);
  }
 });
 const v=(p:P,h:number)=>new THREE.Vector3(p[0],h,p[1]);
 // 暖色灯头与路面光斑使用共享昼夜系数，无逐帧计算、无逐灯动态阴影。
 const roadLights=(a:P,b:P)=>{
  const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<1)return;
  const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len,nx=-uz,nz=ux,count=Math.max(1,Math.ceil(len/42));
  for(let i=0;i<count;i++){
   const t=(i+.5)*len/count,cx=a[0]+ux*t,cz=a[1]+uz*t,px=cx-nx*5,pz=cz-nz*5;
   k.box('white',px,y+18,pz,.45,7,.45);
   k.beam('white',new THREE.Vector3(px,y+25,pz),new THREE.Vector3(px+nx*3,y+25,pz+nz*3),.35,.35);
   k.box('accent',px+nx*3,y+24.7,pz+nz*3,1.3,.45,1.3);
   // 灯下路面椭圆渐变，长轴沿路，边缘透明；仅照亮坝顶道路。
   for(let j=0;j<12;j++){
    const point=(angle:number)=>{const t=Math.cos(angle)*28,d=Math.sin(angle)*5.3;return[cx+ux*t+nx*d,y+18.59,cz+uz*t+nz*d];};
    lightPositions.push(cx,y+18.59,cz,...point(j*Math.PI/6),...point((j+1)*Math.PI/6));lightFalloff.push(1,0,0);
   }
  }
 };
 // 坝顶、迎水护坡、背水草坡及检修步道。断面估算，不使用虚构精确工程高程。
 data.dams.forEach((route,di)=>{
  const points=route.map(k.local);
  for(let s=1;s<points.length;s++){
   const a=points[s-1],b=points[s],len=Math.hypot(b[0]-a[0],b[1]-a[1]),u:P=[(b[0]-a[0])/len,(b[1]-a[1])/len],n:P=[-u[1],u[0]];
   const offset=(p:P,d:number):P=>[p[0]+n[0]*d,p[1]+n[1]*d];
   const quad=(d1:number,h1:number,d2:number,h2:number,key:'green'|'stone')=>{const p=offset(a,d1),q=offset(b,d1),r=offset(b,d2),t=offset(a,d2);k.triangles(key,[...v(p,h1).toArray(),...v(q,h1).toArray(),...v(r,h2).toArray(),...v(p,h1).toArray(),...v(r,h2).toArray(),...v(t,h2).toArray()]);};
   // 为沙盘辨识度放大坝坡断面：宽214米、高60米为视觉估算；真实岸线保持原位置。
   quad(-24,y,-6,y+18,'stone');quad(6,y+18,220,y-42,'green');
   quad(220,y-42,232,y-42,'stone');
   k.beam('stone',v(a,y+18),v(b,y+18),12,1.1);
   for(const d of [-5.6,5.6])k.beam('silver',v(offset(a,d),y+19),v(offset(b,d),y+19),.3,.8);
   for(let t=0;t<len;t+=75){const p:P=[a[0]+u[0]*t,a[1]+u[1]*t];k.beam('stone',v(offset(p,6),y+18),v(offset(p,220),y-42),1.1,.25);}
   // 横向检修带、坝顶灯杆与背水坡脚道路，间距为示意。
   quad(113,y-12,116,y-12.84,'stone');
   roadLights(a,b);
   if(di===2||di===4){
    // 手工笔画几何字，不使用贴图；白色坝字依据2021航拍。字形及定位为估算。
    const glyphs:number[][][]=[[[3,0,0,4],[6,0,9,4],[4,3,1,8],[1,8,8,8],[6,5,9,9]],[[0,1,0,8],[0,1,4,1],[4,1,4,8],[0,4,4,4],[0,8,4,8],[6,0,6,7],[6,0,10,0],[10,0,10,9],[6,3,10,3],[6,6,10,6],[10,9,8,9]],[[5,0,5,9],[5,9,3,8],[0,3,3,3],[3,3,0,8],[5,4,9,1],[5,4,10,8]],[[5,0,6,1],[1,2,10,2],[1,2,1,8],[1,8,0,9],[3,4,9,4],[6,3,3,7],[3,7,10,7],[7,5,7,10],[2,9,10,9]]];
    glyphs.forEach((strokes,gi)=>strokes.forEach(([x1,z1,x2,z2])=>{
     const at=(x:number,z:number)=>{const along=len/2+(gi-1.5)*Math.min(135,len/5)+(x-5)*6.2,d=45+z*11;return v([a[0]+u[0]*along+n[0]*d,a[1]+u[1]*along+n[1]*d],y+18-(d-6)*60/214+.7);};
     k.beam('white',at(x1,z1),at(x2,z2),5.5,1.2);
    }));
   }
  }
 });
 // 原描摹坝线分段之间补齐连接断面，保持坝顶、绿坡和坡脚连续。
 // 端部连接采用两段各自法向的四边形，避免直线延长造成错台或裂缝；断面仍为沙盘估算。
 const damEnds=data.dams.map(route=>route.map(k.local));
 const edgeNormal=(a:P,b:P):P=>{const l=Math.hypot(b[0]-a[0],b[1]-a[1]);return[-(b[1]-a[1])/l,(b[0]-a[0])/l];};
 const join=(a:P,na:P,b:P,nb:P)=>{
  const p=(q:P,n:P,d:number,h:number)=>new THREE.Vector3(q[0]+n[0]*d,h,q[1]+n[1]*d);
  const strip=(key:ColorKey,d0:number,h0:number,d1:number,h1:number)=>{
   const aa=p(a,na,d0,h0),bb=p(b,nb,d0,h0),cc=p(b,nb,d1,h1),dd=p(a,na,d1,h1);
   k.triangles(key,[...aa.toArray(),...bb.toArray(),...cc.toArray(),...aa.toArray(),...cc.toArray(),...dd.toArray()]);
  };
  roadLights(a,b);
  strip('stone',-24,y,-6,y+18);strip('stone',-6,y+18,6,y+18);
  strip('green',6,y+18,220,y-42);strip('stone',220,y-42,232,y-42);
  strip('stone',113,y-12,116,y-12.84);
  for(const d of [-5.6,5.6])k.beam('silver',p(a,na,d,y+19),p(b,nb,d,y+19),.3,.8);
 };
 for(const route of damEnds)for(let j=1;j<route.length-1;j++)join(route[j],edgeNormal(route[j-1],route[j]),route[j],edgeNormal(route[j],route[j+1]));
 // 第一段北坝的起点接西侧坝线起点，其余各段按描摹顺序首尾衔接。
 join(damEnds[0][0],edgeNormal(damEnds[0][0],damEnds[0][1]),damEnds[1][0],edgeNormal(damEnds[1][0],damEnds[1][1]));
 for(let i=1;i<damEnds.length-1;i++){
  const a=damEnds[i],b=damEnds[i+1];
  join(a[a.length-1],edgeNormal(a[a.length-2],a[a.length-1]),b[0],edgeNormal(b[0],b[1]));
 }
 const center=k.local(data.intake.center),start=k.local(data.intake.bridge),deck=y+16;
 k.slab('stone',circle(start[0],start[1],18,8),y-2,18);
 k.slab('stone',circle(start[0],start[1],20,8),deck,1);
 // 照片中的圆形取水塔：实心下部、拱形开口上部、顶部环廊和工作架。尺度估算。
 k.cylinder('silver',...center,y-2,13,13,13,16);
 k.slab('stone',circle(...center,14,24),y+10.5,.8,[circle(...center,10.8,24)]);
 for(let i=0;i<12;i++){
  const a=i*Math.PI/6,c=Math.cos(a),s=Math.sin(a);
  k.box('silver',center[0]+c*12,y+10,center[1]+s*12,1.5,7,1.5);
  const mid=a+Math.PI/12,tangent:P=[-Math.sin(mid),Math.cos(mid)],normal:P=[Math.cos(mid),Math.sin(mid)];
  for(let j=0;j<6;j++){
   const t1=Math.PI*j/6,t2=Math.PI*(j+1)/6;
   const p=(t:number)=>new THREE.Vector3(center[0]+normal[0]*12+tangent[0]*2.7*Math.cos(t),y+14+2.5*Math.sin(t),center[1]+normal[1]*12+tangent[1]*2.7*Math.cos(t));
   k.beam('silver',p(t1),p(t2),.8,.8);
  }
 }
 k.slab('stone',circle(...center,14,24),deck+1,.9);
 const railing=(points:P[],height:number)=>{k.path('silver',points.map(p=>v(p,height)),.15,.15);for(const p of points)k.box('silver',p[0],height-1.1,p[1],.13,1.1,.13);};
 const rr=circle(...center,13.6,32);railing([...rr,rr[0]],deck+3);
 k.beam('stone',v(start,deck),v(center,deck),5,1.3);
 const d=new THREE.Vector2(center[0]-start[0],center[1]-start[1]).normalize(),normal:P=[-d.y,d.x];
 for(const side of [-1,1]){const ps:P[]=Array.from({length:18},(_,i)=>[start[0]+(center[0]-start[0])*i/17+normal[0]*side*2.3,start[1]+(center[1]-start[1])*i/17+normal[1]*side*2.3]);railing(ps,deck+1.5);}
 for(let i=1;i<4;i++){const p:P=[start[0]+(center[0]-start[0])*i/4,start[1]+(center[1]-start[1])*i/4];k.box('silver',p[0],y-2,p[1],2.2,18,4);}
 for(const x of [-4,4])k.box('roof',center[0]+x,deck+2,center[1],.6,5,.6);
 k.box('roof',center[0],deck+6.5,center[1],9,.7,.7);
 k.box('silver',center[0],deck+2,center[1],3,1.8,4);
 const small=k.local(data.smallIntake.center),shore=k.local(data.smallIntake.bridge);
 k.box('silver',small[0],y,small[1],4,15,5);k.box('roof',small[0],y+15,small[1],5,.8,6);k.beam('stone',v(shore,y+12),v(small,y+12),2.2,.7);
 k.group.userData={id:'guangming-lake',sources:data.meta.sources,estimates:data.meta.limitations,previewFocus:{lngLat:data.intake.center,distance:90,direction:[-1,.75,1]},previewDetails:[{label:'坝顶路灯',lngLat:[(data.dams[4][0][0]+data.dams[4][1][0])/2,(data.dams[4][0][1]+data.dams[4][1][1])/2],distance:100,direction:[-1,1.5,.35]},{label:'湖心小岛',lngLat:data.islands[1][4],distance:240,direction:[-1,1,1]},{label:'大坝字标',lngLat:[(data.dams[4][0][0]+data.dams[4][1][0])/2,(data.dams[4][0][1]+data.dams[4][1][1])/2],distance:480,direction:[-1,.65,.35]}]};
 const group=k.finish();
 group.traverse(o=>{if(o instanceof THREE.Mesh&&o.name.endsWith('/accent'))glowColor(o.material as THREE.MeshStandardMaterial,'#ffe2b0',3);});
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lightPositions,3));geometry.setAttribute('lampFalloff',new THREE.Float32BufferAttribute(lightFalloff,1));geometry.computeVertexNormals();
 const material=new THREE.MeshStandardMaterial({color:'#ffe2b0',roughness:.65,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
 glowColor(material,'#ffe2b0',1.35);
 material.opacityNode=nightUniform.mul(pow(attribute('lampFalloff','float'),0.7)).mul(0.8);
 const pools=new THREE.Mesh(geometry,material);pools.name='坝顶路灯暖光';pools.receiveShadow=true;pools.castShadow=false;group.add(pools);
 return group;
}
