import * as THREE from 'three';
import data from '../../../public/sandbox/landmarks/fenghuang-town-station.json';
import {landmarkKit,type LandmarkContext,type LL,type ColorKey} from './_landmark-kit';
/** 凤凰城站：实景暖白铝板、香槟金凤凰纹、灰绿玻璃和红色站名。
 * 主轴由既有轮廓推导；楼层标高、构造尺寸及纹样为估算与简化。 */
export function buildFenghuangTownStation(ctx:LandmarkContext):THREE.Group{
 const k=landmarkKit(ctx,data.anchor as LL,'凤凰城地铁站','#ad9b68',{white:'#e5e4d9',silver:'#afb8b5',stone:'#bbbdb4',glass:'#344b49',glazing:'#637c77',glazingLight:'#8b9c94',red:'#ad292c',roof:'#515d58'});
 const v=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
 const box=k.box;
 // 独立高架段，两股道、纵梁与Y形墩；不生成地面道路。
 box('stone',0,10,0,14,1.6,270);
 for(const x of [-5,5]){box('silver',x,12,0,.8,1.6,270);for(const dx of [-.72,.72])box('roof',x+dx,11.65,0,.13,.18,270);}
 for(let z=-125;z<=125;z+=25){box('stone',0,0,z,2.2,7.6,2.6);for(const side of [-1,1])k.beam('stone',v(0,6,z),v(side*5.3,10,z),1.8,2.1);}
 // 三层站厅，四层站台。暖白楼板下有灰绿玻璃层和竖向混凝土支座。
 box('white',0,13.2,0,24,1.2,178);box('white',0,19,0,25,1,179);
 for(let z=-78;z<=78;z+=13)for(const side of [-1,1]){box('stone',side*8,0,z,1.6,14,2.3);box('white',side*11.8,14.4,z,.55,5,.7);}
 for(const side of [-1,1]){
  box('glazing',side*11.5,14.4,0,.2,3.1,176);
  for(let z=-87;z<=87;z+=3.2)box('silver',side*11.67,14.4,z,.12,3.1,.1);
  box('silver',side*11.7,16.6,0,.15,.13,176);
 }
 // 起伏檐线与连续弧形屋顶；所有尺寸为照片比例估算。
 const top=(z:number)=>27.3+2.9*Math.exp(-(((z+65)/24)**2))+1.2*Math.exp(-(((z-67)/22)**2))-1.1*Math.exp(-(((z-8)/28)**2));
 const half=(z:number)=>12.8-.8*Math.pow(Math.abs(z)/92,4);
 for(let j=0;j<60;j++){
  const z=-90+j*3,zz=z+3;
  for(let i=0;i<10;i++){
   const x=-1+i*.2,xx=x+.2;
   const pt=(a:number,b:number)=>v(a*half(b),top(b)+2.1*(1-a*a),b).toArray();
   k.triangles(i>=4&&i<=5?'roof':'white',[...pt(x,z),...pt(xx,z),...pt(xx,zz),...pt(x,z),...pt(xx,zz),...pt(x,zz)]);
  }
  for(const side of [-1,1]){
   const x=side*half(z),xx=side*half(zz);
   k.triangles('white',[x,17.5,z,xx,17.5,zz,xx,top(zz),zz,x,17.5,z,xx,top(zz),zz,x,top(z),z]);
  }
 }
 // 金色凤凰镂空屏：金色底形、深色小孔与白色曲线羽脉；非贴图。
 for(const side of [-1,1]){
  const low=(z:number)=>18.6+1.5*Math.sin((z+70)/38)+1.2*Math.cos(z/17);
  const high=(z:number)=>top(z)-.7;
  const sideX=(z:number)=>side*(half(z)+.04);
  for(let j=0;j<57;j++){
   const z=-85+j*3,zz=z+3;
   k.triangles('accent',[sideX(z),low(z),z,sideX(zz),low(zz),zz,sideX(zz),high(zz),zz,sideX(z),low(z),z,sideX(zz),high(zz),zz,sideX(z),high(z),z]);
  }
  // 细孔在远景表现为低对比度点阵，单孔四边形以控制面数。
  for(let z=-83;z<84;z+=1.35)for(let y=19;y<31;y+=1.1){if(y<low(z)+.3||y>high(z)-.25)continue;const x=sideX(z)+side*.025,r=.18;k.triangles('roof',[x,y-r,z-r,x,y+r,z-r,x,y+r,z+r,x,y-r,z-r,x,y+r,z+r,x,y-r,z+r]);}
  const line=(points:THREE.Vector3[],width:number,key:ColorKey='white')=>k.path(key,points,width,width*.7);
  for(let feather=0;feather<4;feather++){
   const pts=Array.from({length:52},(_,i)=>{const z=-82+i*3.2;const y=21.9+feather*1.1+3.5*Math.sin((z+55+feather*8)/31);return v(sideX(z)+side*.16,Math.min(top(z)-.4,Math.max(18.7,y)),z);});line(pts,.43+feather*.1);
  }
  // 凤凰颈部回环，以实景轮廓概括；避免整面只是普通金色幕墙。
  const neck=Array.from({length:36},(_,i)=>{const t=i/35*Math.PI*1.65,z=-25+13*Math.cos(t),y=23+4*Math.sin(t);return v(sideX(z)+side*.2,y,z);});line(neck,1.2);
  for(let z=-88;z<89;z+=7.5)k.beam('silver',v(sideX(z)+side*.08,20,z),v(sideX(z)+side*.08,top(z),z),.045,.045);
 }
 // 站台两端的玻璃山墙、横梁、遮阳框。
 for(const end of [-1,1]){
  box('glazing',0,20,end*89.7,23,7,.2);
  for(let x=-11;x<=11;x+=2.2)box('white',x,20,end*90,.16,7,.35);
  box('white',0,23,end*90,24,.22,.4);
 }
 // 四组过街连廊与双跑楼梯，位置依据建筑外轮廓概括。
 for(const end of [-1,1])for(const side of [-1,1]){
  const z=end*58;
  box('stone',side*23,12.6,z,22,1,6);
  box('glazing',side*23,13.6,z-2.8,22,3.5,.13);box('glazing',side*23,13.6,z+2.8,22,3.5,.13);
  box('white',side*23,17.1,z,24,.65,6.8);
  for(let x=14;x<35;x+=3){for(const dz of [-2.9,2.9])box('white',side*x,13.6,z+dz,.18,3.5,.18);}
  box('stone',side*33,0,z,1.1,13,1.2);
  const a=v(side*34,13,z),b=v(side*34,1,z+end*28);
  k.beam('stone',a,b,5,.9);
  for(let i=0;i<38;i++)box('stone',side*34,1+(37-i)*12/38,z+end*(i+.5)*28/38,4.5,.32,.76);
  for(const dx of [-2.4,2.4]){k.beam('glazing',a.clone().add(v(dx,1.1,0)),b.clone().add(v(dx,1.1,0)),.14,1.1);k.beam('silver',a.clone().add(v(dx,1.7,0)),b.clone().add(v(dx,1.7,0)),.12,.12);}
  k.beam('white',a.clone().add(v(0,3.8,0)),b.clone().add(v(0,3.8,0)),5.5,.4);
  for(let i=0;i<6;i++){const t=i/5;for(const dx of [-2.5,2.5])box('silver',side*34+dx,1+12*(1-t),z+end*28*t,.15,3.7,.15);}
  box('white',side*34,.3,z+end*29,6.4,.35,4.5);
  box('red',side*34,4.25,z+end*29,5,.65,.2);
 }
 // 红色中文站名使用简化几何笔画，无贴图；字形与大小估算。
 const glyphs:number[][][]=[[[0,0,0,7],[0,0,5,0],[5,0,5,7],[5,7,6,6],[1,2,4,6],[4,2,1,6]],[[0,0,0,7],[0,0,6,0],[6,0,6,7],[1,6,5,6],[2,1,2,4],[2,1,5,1],[5,1,5,4],[2,3,5,3],[1,5,5,5],[3,4,3,6]],[[0,2,2,2],[1,0,1,6],[0,6,2,5],[3,2,6,2],[3,2,3,6],[3,4,5,4],[5,4,4,7],[5,0,6,7],[6,7,7,6]],[[0,2,3,2],[1,0,2,1],[0,3,1,6],[3,3,2,6],[0,7,3,6],[5,0,5,4],[5,2,7,2],[4,4,7,4],[4,4,4,7],[7,4,7,7],[4,7,7,7]]];
 for(const side of [-1,1])glyphs.forEach((strokes,gi)=>strokes.forEach(([x1,y1,x2,y2])=>{
  const pt=(x:number,y:number)=>v(side*(half(-65)+.3),19.5-y*.28,-78+(gi*8+x)*.43);
  k.beam('red',pt(x1,y1),pt(x2,y2),.15,.15);
 }));
 const result=k.finish();result.rotation.y=-data.bearingDeg*Math.PI/180;
 result.userData={id:'fenghuang-town-station',sources:data.meta.sources,estimates:data.meta.limitations};return result;
}
