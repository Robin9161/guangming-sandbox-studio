import {architecturalColors} from "./_architectural-colors";
import * as THREE from "three";
import data from "../../../public/sandbox/landmarks/mall-bluewhale.json";
import {landmarkKit,rounded,scaled,circle,mean,tower,facade,type LandmarkContext,type LL} from "./_landmark-kit";
/** 双塔位置、商业足迹与130°主轴依项目资料；商业层高、塔冠和雕塑比例为估算。 */
export function buildMallBluewhale(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,"光明蓝鲸世界","#527e9d",architecturalColors.bluewhale);
 const f=data.features[0],ring=rounded(f.ring.map(k.local),5),base=k.yAt(f.center)+.4;
 // 裙房为厚实浅金石材体块，只有首层和入口为通高玻璃，避免整栋条纹化。
 k.slab("stone",ring,base,28.8);
 facade(k,scaled(ring,1.002),base+.6,5.2,3.2,5.8);
 for(const h of [6,16.8,24.2,28.8])k.slab("white",scaled(ring,1.009),base+h,.32);
 k.ribbon("roof",scaled(ring,1.003),base+17.2,.5);
 k.ribbon("glazing",scaled(ring,1.004),base+24.6,3.2);
 for(const f of data.features.slice(1)){
  const p=rounded(f.ring.map(k.local),3),c=mean(p),y=k.yAt(f.center)+29.2;
  tower(k,p,y,164);
  for(let h=4.2;h<162;h+=4.2)k.ribbon("silver",scaled(p,1.008),y+h,.22);
  // 顶部飘带向两端抬升：估算，呼应参考图的柔和弧形塔冠。
  const pos:number[]=[];for(let j=0;j<p.length;j++){const a=p[j],b=p[(j+1)%p.length],ha=7+3*Math.abs(a[0]-c[0])/28,hb=7+3*Math.abs(b[0]-c[0])/28;
   pos.push(a[0],y+164,a[1],b[0],y+164,b[1],b[0],y+164+hb,b[1],a[0],y+164,a[1],b[0],y+164+hb,b[1],a[0],y+164+ha,a[1]);}
  k.triangles("glazingLight",pos);
  facade(k,scaled(p,1.002),y+164,7,2.3,10);
  for(let j=0;j<p.length;j++){const a=p[j],b=p[(j+1)%p.length];k.box("white",a[0],y,a[1],.55,171+3*Math.abs(a[0]-c[0])/28,.55);k.beam("white",new THREE.Vector3(a[0],y+164+7+3*Math.abs(a[0]-c[0])/28,a[1]),new THREE.Vector3(b[0],y+164+7+3*Math.abs(b[0]-c[0])/28,b[1]),.8);}
 }
 for(const [x,z,rx,rz] of [[48,21,25,13],[-39,48,18,10]]){
  k.add("glass",new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2).scale(rx,4,rz).translate(x,base+29,z));
  k.slab("green",circle(x,z,rx+5,24).map(([a,b])=>[a,z+(b-z)*.62]),base+28.85,.18);
 }
 // 圆形玻璃入口与细金属肋，尺寸为估算。
 const atrium=circle(52,52,8.5,24);
 k.slab("glass",atrium,base,25);facade(k,scaled(atrium,1.003),base+.5,24,2,5);
 k.slab("silver",scaled(atrium,1.06),base+25,.55);
 // 主入口鲸尾：深蓝色多面雕塑，下宽上细，顶部双尾鳍；尺寸为沙盘识别估算。
 const x=15,z=68,y=base;
 k.cylinder("stone",x,z,y,18,.7);k.cylinder("water",x,z,y+.75,14,.15);
 const body=new THREE.LatheGeometry([new THREE.Vector2(4.8,0),new THREE.Vector2(6,3),new THREE.Vector2(4,7),new THREE.Vector2(2.1,13),new THREE.Vector2(1.3,20),new THREE.Vector2(2.7,23)],10);
 body.translate(x,y+.9,z);k.add("accent",body);
 for(const side of [-1,1]){
  const shape=new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(side*3,2),new THREE.Vector2(side*12,4),new THREE.Vector2(side*9,.6),new THREE.Vector2(side*4,-1)]);
  k.add("accent",new THREE.ExtrudeGeometry(shape,{depth:1.3,bevelEnabled:false}).translate(x,y+23,z-.65));
 }
 for(let i=0;i<14;i++){const a=i*Math.PI*2/14;k.tree(x+Math.cos(a)*22,z+Math.sin(a)*22,y,2.2);}
 k.group.userData={id:"mall-bluewhale",bearingDeg:data.bearingDeg,scale:1,sources:data.meta.sources,estimates:data.meta.limitations};
 return k.finish();
}
