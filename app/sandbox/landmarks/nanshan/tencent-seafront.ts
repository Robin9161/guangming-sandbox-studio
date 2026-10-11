/**
 * 腾讯滨海大厦 · 南山科技园南区。所属区 nanshan。
 * 真实依据：
 * - public/sandbox/districts/nanshan/sandbox.json buildings[12173,12174,12175,12176,12177,12179]
 *   原始 p 轮廓（OSM/Overture，e=0）；保留双塔不平行的真实平面与三层连接体走向。
 *   北塔 h=194.8、南塔 h=245.8；连接体顶标高 h=35、121.8、175.8，门厅 h=14。
 * - WSP 中文工程项目页：南塔约248m、北塔约194m，三条腰带，遮阳幕墙。
 *   https://www.wsp.com/zh-cn/projects/tencent-seafront-tower-shenzhen-china
 * - NBBJ：两座错高且轻微旋转的塔楼、三座水平连桥、屋顶花园及模块化遮阳。
 *   https://www.nbbj.cn/work/tencent-global-headquarters/
 * - 高度口径：CTBUH 北塔194.8m，与本地数据吻合；本模型采用本地较精确245.8/194.8m，
 *   WSP的248/194m作为约数交叉核验，不把不同口径当作同一精度。
 *   https://www.skyscrapercenter.com/building/id/13861
 * - 投影同 scene/landmarks.ts：WebMercator × k，origin=[113.929007,22.76207]，
 *   k=0.9221194861972872。锚点取双塔间本地坐标[145,26277]反投影。
 *   题目约略坐标偏东南约512m；以真实轮廓校正，不平移轮廓去迎合约略点。
 * 估算：连廊底标高22/105/160.8m、遮阳片间距/深度、窗格、屋面格栅、入口柱、
 *   花池及连廊淡香槟色，均为微缩表达；无施工图尺寸依据。
 * 风格：暖白实体遮阳片+浅蓝灰玻璃，无贴图；kit glazing/glazingLight 管理夜景。
 * 绕锚点地面整体等比放大1.25×（含高度）；按颜色合批，不覆盖整块矩形街区。
 */
import * as THREE from "three";
import { landmarkKit, type LandmarkContext, type ColorKey, type P, type LL } from "../_landmark-kit";

type Ctx = LandmarkContext;
type V = [number, number, number];
export const TENCENT_SEAFRONT_ANCHOR: [number, number] = [113.93041956874133, 22.525816223833296];
const SCALE = 1.25;
const SOURCE_ORIGIN: LL = [113.929007, 22.76207];
const SOURCE_K = 0.9221194861972872;
// 原始轮廓内嵌，不在运行时加载34785栋建筑的全区JSON。h仅为顶标高，连廊不可从地面挤出。
const FOOTPRINTS = [
  {
    "index": 12173,
    "h": 194.8,
    "p": [
      111.9,
      26236.4,
      84.5,
      26251.7,
      98.7,
      26277.1,
      153.8,
      26248.3,
      167.7,
      26238.4,
      153.7,
      26213.3
    ]
  },
  {
    "index": 12179,
    "h": 245.8,
    "p": [
      131,
      26300.9,
      109.4,
      26307.8,
      115.7,
      26337.4,
      208.9,
      26317.6,
      202.6,
      26288.1,
      179.4,
      26290.5
    ]
  },
  {
    "index": 12174,
    "h": 35,
    "p": [
      172.9,
      26243.6,
      162.3,
      26208.8,
      126,
      26199.2,
      120.1,
      26231.8,
      153.7,
      26213.3,
      167.7,
      26238.4,
      153.8,
      26248.3,
      114.1,
      26270.3,
      107.9,
      26307.7,
      109.6,
      26340.7,
      160.3,
      26340.2,
      165,
      26326.9,
      115.7,
      26337.4,
      109.4,
      26307.8,
      131,
      26300.9,
      179.4,
      26290.5
    ]
  },
  {
    "index": 12176,
    "h": 121.8,
    "p": [
      168.2,
      26237.6,
      154,
      26208.4,
      131.8,
      26224.5,
      153.7,
      26213.3,
      167.7,
      26238.4,
      153.8,
      26248.3,
      114.9,
      26269.8,
      108.4,
      26307.8,
      112.2,
      26340.3,
      153.4,
      26330.3,
      115.7,
      26337.4,
      109.4,
      26307.8,
      131,
      26300.9,
      168.7,
      26292.8
    ]
  },
  {
    "index": 12175,
    "h": 175.8,
    "p": [
      208.3,
      26289.3,
      148.9,
      26251,
      98.7,
      26277.1,
      84.5,
      26251.7,
      111.9,
      26236.4,
      108.3,
      26234.6,
      82.2,
      26251,
      94.1,
      26276.5,
      131,
      26300.9,
      179.4,
      26290.5,
      202.6,
      26288.1,
      208.9,
      26317.6,
      181.2,
      26323.5,
      183.2,
      26324.2,
      211.6,
      26320.4
    ]
  },
  {
    "index": 12177,
    "h": 14,
    "p": [
      165.6,
      26269.7,
      153.8,
      26248.3,
      114.1,
      26270.3,
      131,
      26300.9,
      177.4,
      26291
    ]
  }
];

function unproject(x: number, z: number): LL {
  const r = Math.PI / 180, R = 6378137;
  const north = Math.log(Math.tan(Math.PI / 4 + SOURCE_ORIGIN[1] * r / 2));
  return [SOURCE_ORIGIN[0] + x / (R * r * SOURCE_K),
    (2 * Math.atan(Math.exp(north - z / (R * SOURCE_K))) - Math.PI / 2) / r];
}

export function buildTencentSeafront(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, TENCENT_SEAFRONT_ANCHOR, "腾讯滨海大厦", "#dac6a8", {
    silver: "#f7f5ef", white: "#fdfcf8", glass: "#a8bfcc", glazing: "#a8bfcc",
    glazingLight: "#cfdde4", roof: "#c3ced0", stone: "#ede6da",
  });
  const faces: Partial<Record<ColorKey, number[]>> = {};
  const quad = (key: ColorKey, a: V, b: V, c: V, d: V) => {
    const out = faces[key] ?? (faces[key] = []);
    for (const p of [a, b, c, a, c, d]) out.push(p[0], p[1], p[2]);
  };
  // 定向实体薄肋直接积累三角面，避免为数百根遮阳片创建临时BoxGeometry。
  const bar = (key: ColorKey, p: P, u: P, width: number, depth: number, y: number, h: number) => {
    const v: P = [-u[1], u[0]];
    const corners = (height: number): V[] => [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b]) => [
      p[0] + a*u[0]*width/2 + b*v[0]*depth/2, height,
      p[1] + a*u[1]*width/2 + b*v[1]*depth/2,
    ]);
    const a = corners(y), b = corners(y+h);
    for(let i=0;i<4;i++)quad(key,a[i],b[i],b[(i+1)%4],a[(i+1)%4]);
    quad(key,a[3],a[2],a[1],a[0]);quad(key,b[0],b[1],b[2],b[3]);
  };
  const rings = FOOTPRINTS.map(({p}) => {
    const ring: P[] = [];
    for(let i=0;i<p.length;i+=2)ring.push(k.local(unproject(p[i],p[i+1])));
    return ring;
  });
  const skin = (ring: P[], y: number, h: number, bridge = false) => {
    const signed = ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0);
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(length<.05)continue;
      const u:P=[(b[0]-a[0])/length,(b[1]-a[1])/length];
      const n:P=signed>0?[u[1],-u[0]]:[-u[1],u[0]];
      const at=(t:number,offset=0):P=>[a[0]+u[0]*length*t+n[0]*offset,a[1]+u[1]*length*t+n[1]*offset];
      const q=(key:ColorKey,start:P,end:P,lo:number,hi:number)=>quad(key,[start[0],lo,start[1]],
        [start[0],hi,start[1]],[end[0],hi,end[1]],[end[0],lo,end[1]]);
      const bays=Math.max(1,Math.round(length/(bridge?3.1:2.2)));
      for(let j=0;j<bays;j++) {
        q((i+j)%5===0?"glazingLight":"glazing",at(j/bays,.035),at((j+1)/bays,.035),y,y+h);
        bar(bridge?"accent":"silver",at(j/bays,.44),u,bridge?.28:.58,bridge?.5:1.02,y,h);
      }
      // 细水平楼层线贴近幕墙，竖向遮阳肋保持完整的长向读感。
      for(let level=y+4.5;level<y+h-.4;level+=4.5)
        q(bridge?"accent":"silver",at(0,.07),at(1,.07),level,level+.16);
      bar(bridge?"accent":"white",at(0,.28),u,bridge?.5:1.12,bridge?.6:1.22,y,h);
    }
  };

  // 两座真实六边轮廓塔楼：白色顶盖、浅玻璃内核、密集实体竖向百叶。
  for(let i=0;i<2;i++) {
    const ring=rings[i], height=FOOTPRINTS[i].h;
    k.slab("glazing",ring,0,height-.85);
    skin(ring,8,height-9.6);
    k.slab("white",ring,height-1.6,1.6);
    // 内退玻璃门厅与白柱；底层保留轻巧入口读感。
    skin(ring,.5,7.5,true);
    const center:P=ring.reduce((s,p)=>[s[0]+p[0]/ring.length,s[1]+p[1]/ring.length] as P,[0,0] as P);
    const inset=ring.map(p=>[center[0]+(p[0]-center[0])*.7,center[1]+(p[1]-center[1])*.7] as P);
    k.slab("roof",inset,height+.03,.18);
    // 顶面浅色设备格栅只是平面线条，不加虚构尖顶或标志。
    for(let j=-2;j<=2;j++)bar("silver",[center[0]+j*2,center[1]],[0,1],.35,12,height+.22,.1);
  }

  // 原始连接层轮廓已包含绕塔折转；分别在其实际高度范围建模，塔间保持真实空洞。
  const bottoms=[22,105,160.8];
  for(let i=2;i<5;i++) {
    const ring=rings[i],top=FOOTPRINTS[i].h,bottom=bottoms[i-2];
    k.slab("accent",ring,bottom,1.2);
    k.slab("glazingLight",ring,bottom+1.2,top-bottom-2.4);
    skin(ring,bottom+1.2,top-bottom-2.4,true);
    k.slab("white",ring,top-1.2,1.2);
    // 外侧上下两根连续浅香槟边框，带出连廊与竖向百叶的方向差异。
    k.ribbon("accent",ring,top-.5,.45);
  }
  // 地面接待厅取真实中央五边形，薄石材基座仅落在该轮廓内。
  k.slab("stone",rings[5],0,.45);
  k.slab("glazingLight",rings[5],.45,13.55);
  skin(rings[5],.5,12.7,true);
  k.slab("white",rings[5],13.3,.7);
  // 低层连廊屋顶的两组小花池，位置/尺寸估算，不扩大占地到周边街道。
  for(const [x,z] of [[137,26212],[131,26334]]) {
    const p=k.local(unproject(x,z));
    bar("white",p,[1,0],7,3,35.1,.7);
    bar("green",p,[1,0],6.5,2.5,35.8,.2);
  }
  for(const key of Object.keys(faces) as ColorKey[])k.triangles(key,faces[key]!);
  const group=k.finish();
  group.scale.setScalar(SCALE);
  group.userData.evidence={district:"nanshan",anchor:[...TENCENT_SEAFRONT_ANCHOR],scale:SCALE,
    towerHeights:[194.8,245.8],bridgeTops:[35,121.8,175.8],bridgeBottoms:bottoms,
    footprintSource:"public/sandbox/districts/nanshan/sandbox.json",footprints:FOOTPRINTS,
    estimated:"连廊底标高、百叶与窗框尺寸、入口细节、花池、屋顶格栅及颜色风格化"};
  return group;
}
