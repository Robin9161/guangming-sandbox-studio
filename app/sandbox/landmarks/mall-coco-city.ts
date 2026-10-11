import {architecturalColors} from "./_architectural-colors";
import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/mall-coco-city.json";
import {landmarkKit,scaled,rounded,mean,tower,facade,circle,blockSign,type LandmarkContext,type LL,type P} from "./_landmark-kit";
/** 光明星河COCO City商业核心。A/B馆分界、退台与高度为估算，外轮廓取现有矢量。 */
export function buildMallCocoCity(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"光明星河 COCO City","#ae698a",architecturalColors.cocoCity);
 const f=data.features[0],p=rounded(f.ring.map(k.local),5),y=k.yAt(f.center)+.4,c=mean(p);
 // 开放中庭是官方开业实景的主要特征；位置、曲率和开间为估算。
 const raw=f.ring.map(k.local),a=raw[0],b=raw[1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
 const u:P=[(b[0]-a[0])/length,(b[1]-a[1])/length],v:P=[-u[1],u[0]];
 const hc:P=[c[0]-u[0]*27,c[1]-u[1]*27];
 const hole=(level:number):P[]=>circle(0,0,1,24).map(([x,z])=>[hc[0]+u[0]*x*(20+level*1.3)+v[0]*z*(7+level*.65),hc[1]+u[1]*x*(20+level*1.3)+v[1]*z*(7+level*.65)]);
 k.slab("stone",p,y,.35);
 for(let i=0;i<4;i++){
  const ring=scaled(p,1-i*.009),inner=hole(i);
  k.slab("white",ring,y+i*5.3+.35,5.05,[inner]);
  facade(k,scaled(ring,1.002),y+i*5.3+.8,3.35,3.4,5.3);
  facade(k,scaled(inner,.993),y+i*5.3+.8,3.35,3,5.3);
  k.slab("white",scaled(ring,1.012),y+(i+1)*5.3-.5,.55,[hole(i+.35)]);
  k.ribbon("glazingLight",hole(i+.35),y+(i+1)*5.3+.08,1.05);
  k.ribbon("silver",hole(i+.35),y+(i+1)*5.3+1.1,.09);
  // 外侧石材分缝、内侧细栏杆和花槽，保持真实的层叠尺度。
  for(let j=0;j<inner.length;j+=2){const q=inner[j];k.box("silver",q[0],y+(i+1)*5.3,q[1],.12,1.2,.12);}
 }
 // 中庭两段扶梯按照片概括，落在开放空间内。
 for(let i=0;i<2;i++){
  const start=new THREE.Vector3(hc[0]-u[0]*14+v[0]*i*3,y+.5+i*5.3,hc[1]-u[1]*14+v[1]*i*3);
  const end=start.clone().add(new THREE.Vector3(u[0]*17,5.3,u[1]*17));
  k.beam("roof",start,end,2.2,.4);
  for(const side of [-1,1])k.beam("silver",start.clone().add(new THREE.Vector3(v[0]*side*1.1,.8,v[1]*side*1.1)),end.clone().add(new THREE.Vector3(v[0]*side*1.1,.8,v[1]*side*1.1)),.1,.6);
 }
 const tf=data.features[1];tower(k,tf.ring.map(k.local),k.yAt(tf.center)+21,tf.height-21,true);
 blockSign(k,"COCO CITY",c[0]-19,y+22,c[1]-31,.65);
 k.group.userData={id:"mall-coco-city",scale:1,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
