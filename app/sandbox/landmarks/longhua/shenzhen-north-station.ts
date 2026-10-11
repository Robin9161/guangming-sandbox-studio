/**
 * 深圳北站 · 龙华民治。
 * 真实依据：龙华 sandbox.json buildings[5550] 的 20 点十字形轮廓，
 * 与 OSM way/1212433645 及本地 place-深圳北站.json 的范围相符。
 * https://www.openstreetmap.org/way/1212433645 （© OpenStreetMap contributors, ODbL）
 * 原始 p/h、投影、形心存 public/sandbox/landmarks/shenzhen-north-station.json。
 * 国家铁路局：站房 409×208m、高43.6m，上平下曲屋盖；两端雨棚260×130m、高18.1m。
 * https://www.nra.gov.cn/ztzl/hy/gcjs2023/sljj/201403/t20140307_344188.shtml
 * 深圳交通局：11台20线，地铁4/5/6号线接驳（不是20台36线）。
 * https://jtys.sz.gov.cn/jtzx/wycx/hccx/hczfb/content/post_12904228.html
 * 估算：屋盖条带密度、下弦曲线、柱网、广场边界/铺装、入口、标识字形与层高。
 * OSM轮廓包含雨棚；不得把它整体挤出成43.6m实心站房。原h=16不作真实高度。
 * 全部几何绕轮廓面积形心地面等比放大1.25×，含广场；不生成轨道或地铁线路。
 * 白/暖白外框、浅蓝灰玻璃，kit glazing/glazingLight 管理夜景；颜色合批无贴图。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type ColorKey, type P } from "../_landmark-kit";
import evidence from "../../../../public/sandbox/landmarks/shenzhen-north-station.json";
type Ctx = LandmarkContext;
type V = [number, number, number];
export const SZ_NORTH_ANCHOR: [number, number] = [114.02410814356318, 22.612203733654173];

export function buildShenzhenNorthStation(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, SZ_NORTH_ANCHOR, "深圳北站", "#bc6256", {
    white: "#fdfcf8", silver: "#f7f5ef", glass: "#a8bfcc", glazing: "#a8bfcc", glazingLight: "#cfdde4",
    stone: "#e8e1d4", roof: "#dae0df", green: "#bdcdb0",
  });
  // 直接写入低多边形构件，避免逐根框柱临时几何对象影响冷构建耗时。
  const batches: Partial<Record<ColorKey, number[]>> = {};
  const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => {
    (batches[key] ??= []).push(...a,...b,...c,...a,...c,...d);
  };
  const box = (key: ColorKey, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const a:V=[x-w/2,y,z-d/2],b:V=[x+w/2,y,z-d/2],c:V=[x+w/2,y,z+d/2],e:V=[x-w/2,y,z+d/2];
    const A:V=[a[0],y+h,a[2]],B:V=[b[0],y+h,b[2]],C:V=[c[0],y+h,c[2]],E:V=[e[0],y+h,e[2]];
    quad(key,a,b,B,A);quad(key,b,c,C,B);quad(key,c,e,E,C);quad(key,e,a,A,E);quad(key,A,B,C,E);quad(key,e,c,b,a);
  };
  const beam = (a:V,b:V,w:number) => {
    const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
    const u=new THREE.Vector3(0,1,0).cross(v); if(u.lengthSq()<.001)u.set(1,0,0);u.normalize().multiplyScalar(w/2);
    const n=v.clone().cross(u).normalize().multiplyScalar(w/2);
    const ends=[a,b].map(p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t]):V=>[p[0]+u.x*s+n.x*t,p[1]+u.y*s+n.y*t,p[2]+u.z*s+n.z*t]));
    for(let i=0;i<4;i++)quad("silver",ends[0][i],ends[0][(i+1)%4],ends[1][(i+1)%4],ends[1][i]);
    quad("silver",...ends[0] as [V,V,V,V]);quad("silver",...ends[1] as [V,V,V,V]);
  };
  // 薄基座严格沿真实十字轮廓；不以整块包围盒覆盖周边白模。
  k.slab("stone", evidence.localRing as P[], 0, .45);
  // 11座站台：两侧式 + 九岛式，空隙保留给已有铁路图层。
  for(let i=0;i<11;i++) {
    const x=-145+i*25.2,w=i===0||i===10?5.5:11.4;
    box("silver",x,.45,0,w,1.25,444);
    for(const side of [-1,1])box("stone",x+side*(w/2-.6),1.72,0,.4,.08,442);
  }
  // 上跨候车大厅，底部保留穿站空间；两侧入口体量托起长悬挑屋盖。
  box("silver",15,10.6,0,392,2.4,199);
  box("glazing",15,13,0,348,22,183);
  for(const x of [-171,193]) {
    box("white",x,.45,0,20,12.5,186);
    box("glazingLight",x,13,0,20,20,182);
    for(let z=-84;z<=84;z+=12)box("white",x+(x<0?-10.3:10.3),1,z,1.4,34,1.6);
    box("silver",x,21.4,0,22,.8,186);
  }
  for(const side of [-1,1])for(let x=-156;x<=186;x+=14) {
    box("white",x,13,side*92,1.05,22,1.05);
    box("silver",x,24,side*92,14,.45,.55);
  }
  // 特征屋面：顶面齐平，东西端收薄、下弦弧曲；19条白翼与18条浅蓝采光槽。
  const xs=[-186,-162,-126,-75,0,75,135,180,216];
  const underside=[42.0,39.8,36.5,34.0,33.1,34.4,37.0,40.0,42.0];
  for(let j=0;j<37;j++) {
    const z0=-103+j*206/37,z1=-103+(j+1)*206/37;
    const key:ColorKey=j%2===0?"white":"glazingLight";
    for(let i=1;i<xs.length;i++) {
      const a=xs[i-1],b=xs[i],lo=underside[i-1],hi=underside[i];
      quad(key,[a,43.6,z0],[b,43.6,z0],[b,43.6,z1],[a,43.6,z1]);
      quad("silver",[a,lo,z1],[b,hi,z1],[b,hi,z0],[a,lo,z0]);
      for(const z of [z0,z1])quad("white",[a,lo,z],[b,hi,z],[b,43.6,z],[a,43.6,z]);
    }
    box("white",-186,42,z0+(z1-z0)/2,.4,1.6,z1-z0);
    box("white",216,42,z0+(z1-z0)/2,.4,1.6,z1-z0);
  }
  // 南北雨棚按OSM端部边界铺开，较主屋盖显著低；六跨浅折面并置。
  for(const side of [-1,1]) {
    const z0=side<0?-226.6:104,z1=side<0?-104:226.6;
    for(let span=0;span<6;span++) {
      const x0=-149.5+span*43.55,x1=x0+43.55,mid=(x0+x1)/2;
      for(const [a,b,ya,yb] of [[x0,mid,16.3,18.1],[mid,x1,18.1,16.3]]) {
        quad("white",[a,ya,z0],[b,yb,z0],[b,yb,z1],[a,ya,z1]);
        for(const z of [z0,z1])quad("silver",[a,ya-.9,z],[b,yb-.9,z],[b,yb,z],[a,ya,z]);
      }
      box("glazingLight",mid,18.13,(z0+z1)/2,2.1,.12,z1-z0);
      for(let z=z0+9;z<z1;z+=28) {
        box("silver",mid,.5,z,1.25,9,1.25);
        beam([mid,9,z],[x0+3,16.4,z],.7);beam([mid,9,z],[x1-3,16.4,z],.7);
        beam([x0,16.5,z],[mid,18.35,z],.35);beam([mid,18.35,z],[x1,16.5,z],.35);
      }
      for(const x of [x0,x1])box("silver",x,16.25,(z0+z1)/2,.7,.55,z1-z0);
    }
  }
  // 东西近身广场：只做出入口周围，不扩展商业体及线路；尺寸为估算。
  for(const side of [-1,1]) {
    const edge=side<0?-186:216,center=edge+side*43;
    box("stone",center,0,0,86,.55,182);
    for(let z=-72;z<=72;z+=24)box("white",center,.57,z,84,.06,.8);
    for(let x=0;x<4;x++)box("white",edge+side*(12+x*20),.57,0,.8,.06,176);
    // 中轴阶梯、遮雨廊，玻璃始终为浅蓝灰。
    for(let step=0;step<8;step++)box("silver",edge+side*(3+step*2.4),.6,0,2.4,(8-step)*.65,58);
    box("white",edge+side*29,9.4,0,48,1,62);
    for(const z of [-28,28])for(const dx of [12,43])box("white",edge+side*dx,.5,z,1.2,8.9,1.2);
    for(const z of [-70,70]) {
      box("white",center,.6,z,52,.65,12);box("green",center,1.25,z,49,.25,9);
      for(const dx of [-18,0,18]) {
        box("wood",center+dx,1.5,z,.7,3.8,.7);
        // 小型四棱树冠，无大面积深色或高树遮挡站房。
        const tip:V=[center+dx,8,z];
        const a:V=[center+dx-3,4,z-3],b:V=[center+dx+3,4,z-3],c:V=[center+dx+3,4,z+3],d:V=[center+dx-3,4,z+3];
        const out=batches.green??=[];for(const [p,q]of [[a,b],[b,c],[c,d],[d,a]])out.push(...p,...tip,...q);
      }
    }
  }
  // 红色“深圳北站”9×9几何点阵字标，朝东西广场，无贴图。
  const glyphs=[['100010010','010010010','001111111','100000000','010010010','000101100','100010000','101111110','100010000'],['001001001','101001001','101001001','111001001','101001001','101001001','101001001','111001001','100010001'],['001001000','001001000','111001010','001001100','001001000','001001000','011001001','101001001','001000110'],['010001000','111101000','000001111','101001000','101001000','101011110','010010010','111110010','000011110']];
  for(const side of [-1,1])for(let g=0;g<4;g++)glyphs[g].forEach((row,r)=>[...row].forEach((cell,c)=>{
    if(cell==='1')box("accent",side<0?-181:210,44.4+(8-r)*.67,side*(-17+g*9+c*.67),.8,.64,.64);
  }));
  for(const key of Object.keys(batches) as ColorKey[])k.triangles(key,batches[key]!);
  const group=k.finish();
  // 局部横向为东北、纵向为东南；角度从真实轮廓长直边求得。
  group.rotation.y=Math.atan2(.675,.738);
  group.scale.setScalar(1.25);
  group.userData.evidence={...evidence,scale:1.25,platforms:11,tracks:20,tracksModeled:false,estimated:'屋盖分带/下弦、柱网、广场、站名点阵、入口及层高'};
  return group;
}
