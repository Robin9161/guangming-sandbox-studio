import * as THREE from 'three';
import data from '../../../public/sandbox/landmarks/gongming-old-market.json';
import {landmarkKit,type LandmarkContext,type LL,type P,type ColorKey} from './_landmark-kit';
import {bench,lamp} from './_park-details';
/** 公明老墟解放街骑楼片段。街屋轮廓按保护图沿OSM街轴配准，墙体高度、窗洞和柱廊为估算。 */
export function buildGongmingOldMarket(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'公明老墟','#b39977',{white:'#deddd3',stone:'#aaa99c',silver:'#a4a79d',roof:'#5e6663',glass:'#384c49',wood:'#b88a49',red:'#713d32',accent:'#bd874e',glazing:'#447d86',leaf:'#72906a'});
 const a=k.local(data.axis[0]),b=k.local(data.axis[1]),len=Math.hypot(b[0]-a[0],b[1]-a[1]),u:P=[(b[0]-a[0])/len,(b[1]-a[1])/len],n:P=[-u[1],u[0]],angle=Math.atan2(-u[1],u[0]);
 const at=(t:number,d:number,h=0)=>new THREE.Vector3(a[0]+u[0]*t+n[0]*d,h,a[1]+u[1]*t+n[1]*d);
 // 原轴线保留，铺装不过度拓宽，中央休憩构筑物只放在较宽的北段。
 k.beam('stone',at(0,0,.15),at(len,0,.15),13,.25);
 for(let t=4;t<len;t+=6)k.beam('silver',at(t,-6.3,.3),at(t,6.3,.3),.07,.04);
 data.features.forEach((f,idx)=>{
  const p=f.ring.map(k.local),center=k.local(f.center),y=k.yAt(f.center),key:ColorKey=idx%3===0?'stone':'white';
  // 楼上严格沿足迹挤出，底层退入2.2m形成真正的通行柱廊。
  k.slab(key,p,y+3.5,f.height-3.5);
  const edges=p.map((q,i)=>{const r=p[(i+1)%p.length],mid:P=[(q[0]+r[0])/2,(q[1]+r[1])/2],along=(mid[0]-a[0])*u[0]+(mid[1]-a[1])*u[1],dist=Math.abs((mid[0]-a[0])*n[0]+(mid[1]-a[1])*n[1]);return{q,r,dist,along,length:Math.hypot(r[0]-q[0],r[1]-q[1])};}).filter(e=>e.length>3).sort((x,y)=>x.dist-y.dist);
  const front=edges[0],du=new THREE.Vector2(front.r[0]-front.q[0],front.r[1]-front.q[1]).normalize(),inward=new THREE.Vector2(center[0]-(front.q[0]+front.r[0])/2,center[1]-(front.q[1]+front.r[1])/2).normalize();
  const pos=(t:number,d:number,h:number)=>new THREE.Vector3(front.q[0]+du.x*t+inward.x*d,y+h,front.q[1]+du.y*t+inward.y*d);
  const nBays=Math.max(1,Math.round(front.length/4.2)),bay=front.length/nBays;
  k.beam('stone',pos(0,2.3,1.7),pos(front.length,2.3,1.7),.35,3.4);
  k.beam('white',pos(0,-.12,3.45),pos(front.length,-.12,3.45),.5,.45);
  k.beam('stone',pos(0,-.15,f.height-.3),pos(front.length,-.15,f.height-.3),.48,.3);
  k.beam('white',pos(0,-.3,f.height+.12),pos(front.length,-.3,f.height+.12),.65,.26);
  const wallAngle=Math.atan2(-du.y,du.x);
  for(let j=0;j<=nBays;j++){const q=pos(j*bay,.2,0);k.box('white',q.x,q.y,q.z,.43,3.5,.5,wallAngle);k.box('stone',q.x,q.y,q.z,.6,.35,.65,wallAngle);const up=pos(j*bay,-.12,3.7);k.box('stone',up.x,up.y,up.z,.18,f.height-3.7,.16,wallAngle);}
  for(let j=0;j<nBays;j++){
   const t=(j+.5)*bay,back=pos(t,2.05,.12);k.box('wood',back.x,back.y,back.z,bay*.7,2.65,.12,wallAngle);
   // 用户实景：半圆拱窗、红褐木窗及金黄细框；尺寸与装饰纹样为概括估算。
   // 立面细节使用薄面合并，避免大量小盒体增加面数。
   const face=(key:ColorKey,x0:number,x1:number,h0:number,h1:number,d=-.17)=>{
    const a=pos(x0,d,h0),b=pos(x1,d,h0),c=pos(x1,d,h1),e=pos(x0,d,h1);
    k.triangles(key,[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...e.toArray()]);
   };
   const ww=bay*.67,r=ww/2,spring=6.35,base=4.25;
   face('red',t-r,t+r,base,spring);
   face('glass',t-r+.13,t+r-.13,base+.12,spring,-.19);
   const arc=(key:ColorKey,rad:number,thick:number,d:number)=>{
    for(let i=0;i<10;i++){
     const a=i*Math.PI/10,b=(i+1)*Math.PI/10;
     const v=(ang:number,rr:number)=>pos(t+Math.cos(ang)*rr,d,spring+Math.sin(ang)*rr);
     k.triangles(key,[...v(a,rad).toArray(),...v(b,rad).toArray(),...v(b,rad+thick).toArray(),...v(a,rad).toArray(),...v(b,rad+thick).toArray(),...v(a,rad+thick).toArray()]);
    }
   };
   for(let i=0;i<10;i++){const aa=i*Math.PI/10,bb=(i+1)*Math.PI/10;k.triangles('glass',[...pos(t,-.18,spring).toArray(),...pos(t+r*Math.cos(aa),-.18,spring+r*Math.sin(aa)).toArray(),...pos(t+r*Math.cos(bb),-.18,spring+r*Math.sin(bb)).toArray()]);}
   arc('red',r-.12,.12,-.22);arc('white',r,.19,-.25);arc('stone',r+.23,.06,-.23);
   for(const dx of [-r+.08,0,r-.08])face('wood',t+dx-.035,t+dx+.035,base,spring,-.24);
   for(const h of [base+.08,4.95,5.65,spring])face('wood',t-r,t+r,h,h+.065,-.25);
   for(const aa of [Math.PI/4,Math.PI/2,3*Math.PI/4]){
    const c=pos(t,-.25,spring),e=pos(t+Math.cos(aa)*(r-.12),-.25,spring+Math.sin(aa)*(r-.12)),off=new THREE.Vector3(du.x*.035,0,du.y*.035);
    k.triangles('wood',[...c.clone().sub(off).toArray(),...e.clone().sub(off).toArray(),...e.clone().add(off).toArray(),...c.clone().sub(off).toArray(),...e.clone().add(off).toArray(),...c.clone().add(off).toArray()]);
   }
   face('white',t-r-.12,t+r+.12,base-.23,base-.08,-.26);
   // 赭色分节壁柱；蓝绿屋顶栏板只概括彩饰色块，不虚构具体历史画面。
   if(j%3===0){const cp=pos(j*bay,-.28,0);k.box('accent',cp.x,cp.y,cp.z,.48,f.height+1.3,.38,wallAngle);
    for(const h of [1.5,3.5,5.5,7.4,f.height+1.15]){const q=pos(j*bay,-.3,h);k.box('wood',q.x,q.y,q.z,.68,.17,.5,wallAngle);}}
   const ph=f.height+.4+(Math.floor(j/3)%2)*.28;
   face('white',j*bay,(j+1)*bay,f.height-.05,ph+1.05,-.2);
   face('glazing',t-bay*.37,t+bay*.37,ph+.12,ph+.8,-.24);
   face('stone',j*bay,(j+1)*bay,ph+.95,ph+1.08,-.28);
   // 浅色菱形与卷叶感条带为远景装饰示意。
   const ornament=[pos(t-bay*.25,-.27,ph+.46),pos(t,-.27,ph+.73),pos(t+bay*.25,-.27,ph+.46),pos(t,-.27,ph+.21)];
   k.triangles('white',[...ornament[0].toArray(),...ornament[1].toArray(),...ornament[2].toArray(),...ornament[0].toArray(),...ornament[2].toArray(),...ornament[3].toArray()]);
   const sign=pos(t,.05,3.03);k.box('wood',sign.x,sign.y,sign.z,bay*.65,.33,.15,wallAngle);
  }
  // 女儿墙后的灰瓦双坡顶，坡高与瓦垄间距为估算。
  const zs=p.map(q=>(q[0]-center[0])*inward.x+(q[1]-center[1])*inward.y),depth=Math.max(...zs)-Math.min(...zs),roofAt=(t:number,d:number,h:number)=>pos(t,d,h);
  const q=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3)=>k.triangles('roof',[...a.toArray(),...b.toArray(),...c.toArray(),...a.toArray(),...c.toArray(),...d.toArray()]);
  // 每个铺面独立的纵深双坡瓦顶，保留联排屋的细碎屋面节奏。
  for(let j=0;j<nBays;j++){
   const lo=j*bay,hi=(j+1)*bay,mid=(lo+hi)/2,h=f.height+(j%3)*.16;
   q(roofAt(lo,.5,h),roofAt(mid,.5,h+.45),roofAt(mid,depth,h+.45),roofAt(lo,depth,h));
   q(roofAt(mid,.5,h+.45),roofAt(hi,.5,h),roofAt(hi,depth,h),roofAt(mid,depth,h+.45));
   k.beam('silver',roofAt(mid,.5,h+.5),roofAt(mid,depth,h+.5),.18,.14);
   const fascia=pos(mid,-.2,f.height);k.box(j%5===0?'stone':'white',fascia.x,fascia.y,fascia.z,bay-.08,.4+(j%3)*.2,.24,wallAngle);

  }

 });
 for(let t=110;t<len-12;t+=17){const p=at(t,-2,.25);bench(k,p.x,p.z,p.y,angle);lamp(k,p.x+1,p.z,p.y,3.5);if(t%2<1)k.tree(p.x-1.8,p.z,p.y,2.1);}
 k.group.userData={id:'gongming-old-market',previewFocus:{lngLat:[data.axis[0][0]*.25+data.axis[1][0]*.75,data.axis[0][1]*.25+data.axis[1][1]*.75],distance:18,direction:[1,.3,.4]},sources:data.meta.sources,estimates:data.meta.limitations};return k.finish();
}
