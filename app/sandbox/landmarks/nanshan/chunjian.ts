/**
 * 深圳湾体育中心 · 春茧 / nanshan
 * 真实依据：南山区 sandbox.json buildings[18236,18234,18237,18238] 的连续轮廓，
 * 共边消去后 513.4 × 242.1m；来源为 OSM / Overture，不能把混合数据全部称为 OSM。
 * 提取脚本及原始 p/h/e 保存于 public/sandbox/landmarks/chunjian.json。
 * 形心反投影 anchor=[113.94520172050836,22.52076052007092]，位于春笋东北约496m，
 * 用户约略点在其东南约447m；沿用光明 WebMercator×k 投影，不混用 GCJ-02。
 * 南山区政府：“一场两馆”、白色连续屋盖与场馆资料：
 * https://www.szns.gov.cn/mlns/whns/tycg/content/post_12589347.html
 * 深圳博物馆：白色巨型网格钢结构屋面整合三馆：
 * https://mobile.shenzhenmuseum.com/motalDetial?clazzName=CmsInformation&resId=10ee76b3190441b99b072bb846629586
 * 估算：曲面剖面、网格疏密/杆径、体育场洞口、内部看台与场地、两馆屋顶、
 * 门厅、广场台阶与铺装。输入 h=40 为数据属性，不等于验证后的结构最高点。
 * 整体绕轮廓形心地面等比放大 1.25×（含平台与高度）；无贴图，按颜色合批。
 */
import * as THREE from 'three';
import { landmarkKit, type LandmarkContext, type ColorKey, type P } from '../_landmark-kit';
import evidence from '../../../../public/sandbox/landmarks/chunjian.json';
type Ctx = LandmarkContext;
type V = [number, number, number];
export const CHUNJIAN_ANCHOR: [number, number] = [113.94520172050836, 22.52076052007092];
const SCALE=1.25, N=56, ROWS=9, TAU=Math.PI*2;

export function buildChunjian(ctx: Ctx): THREE.Group {
 const k=landmarkKit(ctx,CHUNJIAN_ANCHOR,'深圳湾体育中心 · 春茧','#d4aaa1',{
  silver:'#f7f5ef',white:'#fdfcf8',glass:'#a8bfcc',glazing:'#a8bfcc',glazingLight:'#cfdde4',
  stone:'#e9e3d6',green:'#b7cba2',red:'#d5aaa0',
 });
 const [cx,cz]=evidence.meta.center;
 const {origin,k:pk}=evidence.meta.projection, R=6378137,rad=Math.PI/180;
 const ll=(x:number,z:number):[number,number]=>[origin[0]+x/pk/R/rad,(2*Math.atan(Math.exp(Math.log(Math.tan(Math.PI/4+origin[1]*rad/2))-z/pk/R))-Math.PI/2)/rad];
 // 校准 ctx 投影，既适用于正式绝对坐标，也适用于局部预览；不重复叠加 anchor。
 const o=k.local(ll(cx,cz)),ex=k.local(ll(cx+1,cz)),ez=k.local(ll(cx,cz+1));
 const at=(x:number,y:number,z:number):V=>[o[0]+(x-cx)*(ex[0]-o[0])+(z-cz)*(ez[0]-o[0]),y,o[1]+(x-cx)*(ex[1]-o[1])+(z-cz)*(ez[1]-o[1])];
 const p2=(x:number,z:number):P=>{const p=at(x,0,z);return [p[0],p[2]];};
 const faces:Partial<Record<ColorKey,number[]>>={};
 const tri=(key:ColorKey,a:V,b:V,c:V)=>{const f=faces[key]??(faces[key]=[]);f.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);};
 const quad=(key:ColorKey,a:V,b:V,c:V,d:V)=>{tri(key,a,b,c);tri(key,a,c,d);};
 // 四面实体杆、端头隐藏于节点；直接写三角形，避免几千次 BoxGeometry 分配。
 const rod=(a:V,b:V,w=.8,key:ColorKey='white')=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz);if(len<1e-6)return;
  const h=Math.hypot(dx,dz);const u:V=h>1e-6?[-dz/h*w/2,0,dx/h*w/2]:[w/2,0,0];
  const v:V=[(dy*u[2]-dz*u[1])/len,(dz*u[0]-dx*u[2])/len,(dx*u[1]-dy*u[0])/len];
  const corners=(p:V)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t]):V=>[p[0]+s*u[0]+t*v[0],p[1]+s*u[1]+t*v[1],p[2]+s*u[2]+t*v[2]]);
  const aa=corners(a),bb=corners(b);for(let i=0;i<4;i++)quad(key,aa[i],aa[(i+1)%4],bb[(i+1)%4],bb[i]);
 };
 const ring=evidence.ring as P[];
 // 实心平台顶面用于占地栅格化，镂空网壳下不会残留普通白模。
 const platform=(s:number)=>ring.map(([x,z])=>p2(cx+(x-cx)*s,cz+(z-cz)*s));
 k.slab('stone',platform(1.09),-.7,1.2);
 k.slab('silver',platform(1.055),.5,.65);
 k.slab('stone',platform(1.018),1.15,.5);
 const ellipse=(x:number,z:number,rx:number,rz:number,n=N):P[]=>Array.from({length:n},(_,i)=>p2(x+rx*Math.cos(i*TAU/n),z+rz*Math.sin(i*TAU/n)));
 // 东侧露天场芯：低饱和跑道、足球场与阶梯看台；不是黑色深洞。
 const sx=1780,sz=26855;
 k.slab('red',ellipse(sx,sz,65,91),1.66,.18);
 k.slab('green',ellipse(sx,sz,54,79),1.85,.15);
 const box=(key:ColorKey,x:number,z:number,y:number,w:number,h:number,d:number)=>{const p=p2(x,z);k.box(key,p[0],y,p[1],w,h,d);};
 box('green',sx,sz,2.02,68,.1,105);
 for(const x of [-34,34])box('white',sx+x,sz,2.16,.35,.06,105);
 for(const z of [-52.5,0,52.5])box('white',sx,sz+z,2.16,68,.06,.35);
 for(let j=0;j<48;j++){
  const a=j*TAU/48,b=(j+1)*TAU/48;
  rod(at(sx+9.15*Math.cos(a),2.18,sz+9.15*Math.sin(a)),at(sx+9.15*Math.cos(b),2.18,sz+9.15*Math.sin(b)),.28);
 }
 for(let lane=0;lane<4;lane++){
  const p=ellipse(sx,sz,57+lane*2,82+lane*2);
  for(let j=0;j<N;j++)rod([p[j][0],2.02,p[j][1]],[p[(j+1)%N][0],2.02,p[(j+1)%N][1]],.2);
 }
 for(let tier=0;tier<7;tier++){
  const outer=ellipse(sx,sz,69+tier*3.5,94+tier*2.2),inner=ellipse(sx,sz,66+tier*3.5,91.9+tier*2.2);
  const key:ColorKey=tier%3===0?'glazingLight':'silver',y=2+tier*2;
  const v=(p:P,h:number):V=>[p[0],h,p[1]];
  for(let i=0;i<N;i++){
   const n=(i+1)%N,a=outer[i],b=outer[n],c=inner[n],d=inner[i];
   quad(key,v(a,y+1.4),v(b,y+1.4),v(c,y+1.4),v(d,y+1.4));
   quad(key,v(a,y),v(b,y),v(b,y+1.4),v(a,y+1.4));
   quad(key,v(c,y),v(d,y),v(d,y+1.4),v(c,y+1.4));
  }
 }
 // 西部两馆置于同一层连续网壳下：内退玻璃壁、暖白屋面，保留中部透空大树广场。
 for(const b of evidence.parts.slice(0,2)){
  const p:P[]=[];for(let i=0;i<b.p.length;i+=2)p.push(p2(b.p[i],b.p[i+1]));
  const mx=p.reduce((s,q)=>s+q[0],0)/p.length,mz=p.reduce((s,q)=>s+q[1],0)/p.length;
  const inset=p.map(([x,z]):P=>[mx+(x-mx)*.8,mz+(z-mz)*.76]);
  k.slab('white',inset,1.65,2);k.ribbon('glazing',inset,3.65,5);
  k.slab('silver',inset,8.65,.6);
 }
 // 从场洞中心发射射线，与实测外轮廓相交，形成真实边界的连续偏心茧壳。
 const outside=(a:number):P=>{
  const dx=Math.cos(a),dz=Math.sin(a);let best=Infinity;
  for(let i=0;i<ring.length;i++){
   const p=ring[i],q=ring[(i+1)%ring.length],vx=q[0]-p[0],vz=q[1]-p[1],den=dx*vz-dz*vx;
   if(Math.abs(den)<1e-8)continue;
   const t=((p[0]-sx)*vz-(p[1]-sz)*vx)/den,u=((p[0]-sx)*dz-(p[1]-sz)*dx)/den;
   if(t>0&&u>=0&&u<=1)best=Math.min(best,t);
  }
  return [sx+dx*best,sz+dz*best];
 };
 const grid:V[][]=[],raw:P[][]=[];
 for(let j=0;j<=ROWS;j++){
  const t=j/ROWS;grid[j]=[];raw[j]=[];
  for(let i=0;i<N;i++){
   const a=(i+(j%2)*.5)*TAU/N,out=outside(a);
   const inner:P=[sx+72*Math.cos(a),sz+96*Math.sin(a)];
   const x=out[0]*(1-t)+inner[0]*t,z=out[1]*(1-t)+inner[1]*t;
   const y=7+25*Math.sin(t*Math.PI/2)+11*Math.sin(t*Math.PI);
   raw[j][i]=[x,z];grid[j][i]=at(x,y,z);
  }
 }
 for(let j=0;j<=ROWS;j++)for(let i=0;i<N;i++){
  rod(grid[j][i],grid[j][(i+1)%N],j===ROWS?1.6:j===0?1.2:.72);
  if(j===ROWS)continue;
  const next=(i+(j%2?1:-1)+N)%N;
  rod(grid[j][i],grid[j+1][i],.82);rod(grid[j][i],grid[j+1][next],.82);
  // 西部室内馆上方局部暖白面板；庭院与场芯上方保持实际镂空。
  const lower=(p:V):V=>[p[0],p[1]-.65,p[2]];
  const skin=(points:V[],xs:number[])=>{
   if(xs.reduce((sum,x)=>sum+x,0)/3<1592)
    tri((i+j)%13===0?'glazingLight':'silver',lower(points[0]),lower(points[1]),lower(points[2]));
  };
  skin([grid[j][i],grid[j+1][i],grid[j+1][next]],[raw[j][i][0],raw[j+1][i][0],raw[j+1][next][0]]);
  const n=(i+1)%N,u=(i+(j%2?1:0))%N;
  skin([grid[j][i],grid[j][n],grid[j+1][u]],[raw[j][i][0],raw[j][n][0],raw[j+1][u][0]]);
 }
 // 裙边柱脚与入口玻璃小段：可从镂空壳边看到内退的体量。
 for(let i=0;i<N;i+=4){const p=raw[0][i],g=grid[0][i];rod(at(p[0],1.65,p[1]),g,1.35);}
 for(let i=0;i<5;i++){
  const x=1615+i*7,z=26833+i*9,p=p2(x,z);k.tree(p[0],p[1],1.65,3.8);
 }
 // 广场铺装缝，限制在平台边缘；不过度侵占相邻建筑或道路。
 for(let i=0;i<N;i+=2){const p=raw[0][i];rod(at(cx+(p[0]-cx)*1.025,1.18,cz+(p[1]-cz)*1.025),at(cx+(p[0]-cx)*1.052,1.18,cz+(p[1]-cz)*1.052),.35,'white');}
 for(const key of Object.keys(faces) as ColorKey[])k.triangles(key,faces[key]!);
 const group=k.finish();group.scale.setScalar(SCALE);
 group.userData.evidence={anchor:CHUNJIAN_ANCHOR,scale:SCALE,footprintSource:evidence.meta.source,indices:evidence.meta.sourceIndices,footprintArea:evidence.meta.footprintArea,estimated:'曲面、开口、网格、内部场地看台、屋顶、平台',district:'nanshan'};
 return group;
}
