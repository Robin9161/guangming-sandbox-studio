import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type ColorKey, type P } from "../_landmark-kit";

/**
 * 平安金融中心 · futian；仅北塔本体与紧接南侧的商业裙楼。
 * 真实依据：
 * - public/sandbox/districts/futian/sandbox.json buildings[3926] 的 20 点轮廓，
 *   面积 5061.04m²、包络 76.3×76m；h=320 明显偏低，改用任务给定 599m。
 *   面积形心 (12456.394773857213,25074.112035846178) 反投影得到 anchor。
 *   buildings[3886] 为紧接南侧的裙房轮廓（h=55）；其商业归属为位置推定。
 *   投影同 sandbox.json：origin=[113.929007,22.76207], k=0.9221194861972872。
 * - KPF：石材/玻璃、chevron 竖向构件、五层退台商业及中庭：
 *   https://www.kpf.com/project/ping-an-finance-centre （页面高度取整为600m）。
 * - 平安官方2018可持续报告采用118层口径：
 *   https://www.pingan.com/app_upload/images/info/upload/ba7ad86a-64e5-40d1-a1c2-1b090e2cd8af.pdf
 * - 599m、2017竣工、无原计划天线：采用任务指定的已建成状态。
 * 估算：上部逐高收分、圆角、巨柱截面/节点、V撑、118道楼层节奏、裙楼层高与中庭。
 * 裙楼采用真实轮廓，五层商场体量按30m估算，不把来源h=55当成五层实际檐高。
 * 石质尖冠为任务要求的浅色几何表达，不声称已核实顶部所有覆面材料。
 * 地面形心等比放大1.25×；模型高748.75m。外露构件截面另适度夸张便于5–10km辨认。
 * 春笋同色覆盖；夜景仅用kit glazing/glazingLight；无纹理、透明或额外夜景系统。
 */
type Ctx = LandmarkContext;
type V = [number, number, number];
export const PINGAN_IFC_ANCHOR: [number, number] = [114.05035537163596, 22.536640129325253];
const CENTER: P = [12456.394773857213, 25074.112035846178];
const FOOTPRINT = [12434.3,25043,12425.2,25043.1,12425.2,25052,12418.3,25053.7,12418.2,25094.6,12425.3,25096.3,12425.2,25105.2,12434.4,25105.3,12435.7,25112.1,12476.9,25112.1,12478.5,25105.2,12487.6,25105.3,12487.7,25096.2,12494.5,25094.6,12494.5,25053.7,12487.7,25051.9,12487.6,25042.9,12478.5,25043,12476.8,25036.1,12435.8,25036.1];
const PODIUM = [12476.9,25112.1,12435.7,25112.1,12428.7,25124.3,12438,25165,12437.1,25185.9,12483.2,25185,12501.8,25201.8,12513.4,25190.6,12512.3,25148.8,12476.9,25116.3];
// 米制截面：高度、相对首层宽度。冠肩以下保持方塔，最后64m形成有实体的尖冠。
const PROFILE: P[] = [[0,1],[24,1],[100,.995],[190,.975],[290,.945],[390,.9],[475,.83],[535,.73],[555,.57],[578,.30],[591,.11],[599,0]];
const factor = (y:number) => {
  for(let j=1;j<PROFILE.length;j++) if(y<=PROFILE[j][0]) {
    const [a,s]=PROFILE[j-1],[b,t]=PROFILE[j];return s+(t-s)*(y-a)/(b-a);
  }
  return 0;
};

export function buildPinganIfc(ctx: Ctx): THREE.Group {
  const k=landmarkKit(ctx,PINGAN_IFC_ANCHOR,"平安金融中心",undefined,{
    silver:"#f7f5ef",white:"#fdfcf8",glass:"#a8bfcc",glazing:"#a8bfcc",glazingLight:"#cfdde4",
  });
  const faces:Partial<Record<ColorKey,number[]>>={};
  const tri=(key:ColorKey,a:V,b:V,c:V)=>{(faces[key]??(faces[key]=[])).push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);};
  const quad=(key:ColorKey,a:V,b:V,c:V,d:V)=>{tri(key,a,b,c);tri(key,a,c,d);};
  const sourceRing=(p:number[]):P[]=>Array.from({length:p.length/2},(_,i)=>[p[2*i]-CENTER[0],p[2*i+1]-CENTER[1]]);
  // 真实轮廓保留在基座；上部角弧分为3段，圆角方形而不是圆塔。
  const ring:P[]=[];
  for(let c=0;c<4;c++) for(let j=0;j<=3;j++) {
    const a=c*Math.PI/2+j*Math.PI/6;
    const sx=c===0||c===3?1:-1,sz=c<2?1:-1;
    ring.push([sx*25+13*Math.cos(a),sz*25+13*Math.sin(a)]);
  }
  const at=(p:P,y:number,out=0):V=>{
    const f=factor(y),len=Math.hypot(...p);return [p[0]*(f+out/len),y,p[1]*(f+out/len)];
  };
  // 批量写杆件，避免数百次BoxGeometry创建；截面有真实厚度和封口。
  const beam=(key:ColorKey,a:V,b:V,width:number,depth=width)=>{
    const d=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();
    const reference=Math.abs(d.y)>.95?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
    const u=new THREE.Vector3().crossVectors(d,reference).normalize().multiplyScalar(width/2);
    const v=new THREE.Vector3().crossVectors(d,u).normalize().multiplyScalar(depth/2);
    const corners=(p:V):V[]=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>[p[0]+s*u.x+t*v.x,p[1]+s*u.y+t*v.y,p[2]+s*u.z+t*v.z]);
    const aa=corners(a),bb=corners(b);
    for(let i=0;i<4;i++)quad(key,aa[i],aa[(i+1)%4],bb[(i+1)%4],bb[i]);
    quad(key,aa[3],aa[2],aa[1],aa[0]);quad(key,bb[0],bb[1],bb[2],bb[3]);
  };
  // 直接三角剖分封闭楼板，避免逐层ExtrudeGeometry的临时法线/UV与去索引成本。
  const deck=(key:ColorKey,r:P[],y:number,h:number)=>{
    const indices=THREE.ShapeUtils.triangulateShape(r.map(([x,z])=>new THREE.Vector2(x,z)),[]);
    for(const [a,b,c] of indices) {
      tri(key,[r[a][0],y+h,r[a][1]],[r[c][0],y+h,r[c][1]],[r[b][0],y+h,r[b][1]]);
      tri(key,[r[a][0],y,r[a][1]],[r[b][0],y,r[b][1]],[r[c][0],y,r[c][1]]);
    }
    for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];quad(key,[a[0],y,a[1]],[a[0],y+h,a[1]],[b[0],y+h,b[1]],[b[0],y,b[1]]);}
  };
  deck("stone",sourceRing(FOOTPRINT),0,.65);
  // 南侧五层退台裙楼；无整块广场、无南塔，控制白模移除范围。
  const podium=sourceRing(PODIUM);
  const pc:P=[podium.reduce((s,p)=>s+p[0],0)/podium.length,podium.reduce((s,p)=>s+p[1],0)/podium.length];
  for(let floor=0;floor<5;floor++) {
    const s=1-floor*.038;
    const r:P[]=podium.map(([x,z])=>[pc[0]+(x-pc[0])*s,pc[1]+(z-pc[1])*s]);
    const y=floor*6;
    deck("white",r,y,1.15);deck("silver",r,y+5.7,.3);
    for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];quad("glazingLight",[a[0],y+1.15,a[1]],[a[0],y+5.7,a[1]],[b[0],y+5.7,b[1]],[b[0],y+1.15,b[1]]);}
    for(let i=0;i<r.length;i++) {
      const a=r[i],b=r[(i+1)%r.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/6);
      for(let j=0;j<n;j++) {const t=j/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        beam("white",[x,y+1,z],[x,y+5.75,z],.65,.75);
      }
    }
  }
  // 中庭天窗低矮折顶，尺寸/位置估算。裙房顶部不增加邻楼或景观范围。
  const ax=pc[0],az=pc[1];
  quad("glazingLight",[ax-9,30,az-19],[ax,33,az-19],[ax,33,az+19],[ax-9,30,az+19]);
  quad("glazing",[ax,33,az-19],[ax+9,30,az-19],[ax+9,30,az+19],[ax,33,az+19]);
  tri("glazingLight",[ax-9,30,az-19],[ax+9,30,az-19],[ax,33,az-19]);
  tri("glazingLight",[ax-9,30,az+19],[ax,33,az+19],[ax+9,30,az+19]);
  for(let z=az-19;z<=az+19;z+=6.3333333333) {
    beam("white",[ax-9,30.12,z],[ax,33.12,z],.35);beam("white",[ax,33.12,z],[ax+9,30.12,z],.35);
  }
  // 塔身表皮。四个圆角分别3面，主立面完整，顶部以单三角收尖避免退化面。
  for(let j=1;j<PROFILE.length;j++) {
    const y0=PROFILE[j-1][0],y1=PROFILE[j][0];
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length];
      const key:ColorKey=y0>=535?(i%4===3?"silver":"white"):(i%4===3?"glazing":"glazingLight");
      if(y1===599)tri(key,at(a,y0),[0,599,0],at(b,y0));
      else quad(key,at(a,y0),at(a,y1),at(b,y1),at(b,y0));
    }
  }
  // 八根巨柱，两根一组夹住圆角，截面八边形；纵向连续至冠肩后归并成四条冠脊。
  const columns:P[]=[];
  for(const sx of [-1,1])for(const sz of [-1,1])columns.push([sx*25,sz*38],[sx*38,sz*25]);
  for(const p of columns) {
    const sections=PROFILE.filter(([y])=>y<=535).map(([y])=>{
      const c=at(p,y,.75),r=2.45-(y/535)*.75;
      return Array.from({length:8},(_,i):V=>[c[0]+Math.cos(i*Math.PI/4)*r,y,c[2]+Math.sin(i*Math.PI/4)*r]);
    });
    for(let j=1;j<sections.length;j++)for(let i=0;i<8;i++)quad(i%3===0?"white":"silver",sections[j-1][i],sections[j][i],sections[j][(i+1)%8],sections[j-1][(i+1)%8]);
    for(const end of [0,sections.length-1])for(let i=1;i<7;i++)tri("silver",sections[end][0],sections[end][i],sections[end][i+1]);
    const mid:P=[Math.sign(p[0])*34.1924,Math.sign(p[1])*34.1924];
    beam("white",at(p,535,.65),at(mid,555,.35),2.4,1.8);
  }
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    const p:P=[sx*34.1924,sz*34.1924];
    for(const [lo,hi,w] of [[555,578,1.8],[578,591,1],[591,598.5,.4]])beam("white",at(p,lo,.18),at(p,hi,.06),w,w);
    // 各角成组V撑；撑只跨角部，不把整个塔身变成通体菱格。
    for(const [lo,hi] of [[32,100],[120,190],[215,290],[315,390],[410,475],[487,535]]) {
      const bottom=at(p,lo,1.1);
      beam("silver",bottom,at([sx*25,sz*38],hi,1.1),1.3,1.1);
      beam("silver",bottom,at([sx*38,sz*25],hi,1.1),1.3,1.1);
    }
  }
  // 每主立面细长白肋，细框只分面，不创建每窗一个Mesh。
  for(let side=0;side<4;side++)for(let x=-20;x<=20;x+=5) {
    const p:P=side===0?[x,38]:side===1?[-38,x]:side===2?[x,-38]:[38,x];
    const a:P=side%2===0?[p[0]-.275,p[1]]:[p[0],p[1]-.275];
    const b:P=side%2===0?[p[0]+.275,p[1]]:[p[0],p[1]+.275];
    for(let j=1;j<PROFILE.length-3;j++)quad("silver",at(a,PROFILE[j-1][0],.28),at(a,PROFILE[j][0],.28),at(b,PROFILE[j][0],.28),at(b,PROFILE[j-1][0],.28));
  }
  // 118层为标注口径；118条均匀分格仅是视觉节奏，不表示真实楼层标高。
  for(let floor=1;floor<=118;floor++) {
    const y=10+floor*4.42;
    for(let i=0;i<ring.length;i++)quad("silver",at(ring[i],y,.07),at(ring[i],y+.18,.07),at(ring[(i+1)%ring.length],y+.18,.07),at(ring[(i+1)%ring.length],y,.07));
  }
  // 北面入口的悬挑雨棚，范围保持贴近塔身。
  k.box("white",0,9,-39,24,.9,6);
  for(const x of [-10,10])beam("white",[x,.65,-40],[x,9,-40],.65);
  for(const key of Object.keys(faces) as ColorKey[])k.triangles(key,faces[key]!);
  const group=k.finish();group.scale.setScalar(1.25);
  group.userData.evidence={district:"futian",height:599,floors:118,completed:2017,architect:"KPF",scale:1.25,
    footprintSource:"public/sandbox/districts/futian/sandbox.json buildings[3926]",footprint:[...FOOTPRINT],footprintCentroid:[...CENTER],footprintArea:5061.04,sourceHeight:320,
    podiumSourceIndex:3886,podiumFootprint:[...PODIUM],podiumAssociation:"位置推定",podiumHeightEstimated:30,
    estimated:"上部收分、圆角、巨柱/斜撑截面及节点、层线标高、裙房退台及中庭"};
  return group;
}
