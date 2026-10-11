import {architecturalColors} from "./_architectural-colors";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";
import data from "../../../public/sandbox/landmarks/nantai-inno-valley.json";

type LngLat = [number, number];
type Point = [number, number];
type Context = {
  project: (lngLat: LngLat) => THREE.Vector3;
  groundAt: (lngLat: LngLat) => number;
};

/** 南太云创谷：真实地理轮廓；高度、幕墙、屋面与景观细节为估算。原尺寸，无逐帧计算。 */
export function buildNantaiInnoValley(ctx: Context): THREE.Group {
  const root = new THREE.Group();
  root.name = "南太云创谷";
  const anchor = data.anchor as LngLat;
  const origin = ctx.project(anchor);
  const ground = ctx.groundAt(anchor);
  root.position.copy(origin);
  root.position.y = ground;
  const point = (p: number[]): Point => {
    const q = ctx.project(p as LngLat);
    return [q.x - origin.x, q.z - origin.z];
  };
  const average = (ring: Point[]): Point => [
    ring.reduce((s,p)=>s+p[0],0)/ring.length,
    ring.reduce((s,p)=>s+p[1],0)/ring.length,
  ];
  const materials = {
    glass: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.glass,roughness:.43,metalness:.16,side:THREE.DoubleSide}),
    silver: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.silver,roughness:.6,side:THREE.DoubleSide}),
    white: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.white,roughness:.68}),
    stone: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.stone,roughness:.78}),
    green: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.green,roughness:.8}),
    leaf: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.leaf,roughness:.8,flatShading:true}),
    bronze: new THREE.MeshStandardMaterial({color:architecturalColors.nantai.bronze,roughness:.65,side:THREE.DoubleSide}),
  };
  glowColor(materials.glass, "#ffe2b0", 1);
  type Key = keyof typeof materials;
  const batches: Record<Key,THREE.BufferGeometry[]> = {glass:[],silver:[],white:[],stone:[],green:[],leaf:[],bronze:[]};
  const add = (key: Key, g: THREE.BufferGeometry) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    batches[key].push(geometry);
  };
  const slab = (key: Key, ring: Point[], y: number, h: number) => {
    const shape = new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z)));
    add(key,new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1}).rotateX(-Math.PI/2).translate(0,y,0));
  };
  const box = (key: Key,x:number,y:number,z:number,w:number,h:number,d:number,rotation=0) =>
    add(key,new THREE.BoxGeometry(w,h,d).rotateY(rotation).translate(x,y+h/2,z));
  const scale = (ring:Point[],s:number):Point[] => {
    const c=average(ring);return ring.map(([x,z])=>[c[0]+(x-c[0])*s,c[1]+(z-c[1])*s]);
  };
  // 圆角在真实轮廓内切；两段折线保留低多边形风格，半径为估算。
  const round = (ring:Point[],r=4.5):Point[] => ring.flatMap((p,i)=>{
    const prev=ring[(i+ring.length-1)%ring.length],next=ring[(i+1)%ring.length];
    const la=Math.hypot(prev[0]-p[0],prev[1]-p[1]),lb=Math.hypot(next[0]-p[0],next[1]-p[1]);
    const t=Math.min(r,la*.15,lb*.15);
    const a:Point=[p[0]+(prev[0]-p[0])*t/la,p[1]+(prev[1]-p[1])*t/la];
    const b:Point=[p[0]+(next[0]-p[0])*t/lb,p[1]+(next[1]-p[1])*t/lb];
    return [a,[(a[0]+2*p[0]+b[0])/4,(a[1]+2*p[1]+b[1])/4] as Point,b];
  });
  // 立面带由双面材质显示，仅生成竖直四边形，避免每层堆叠实体造成面数浪费。
  const ribbon=(key:Key,ring:Point[],y:number,h:number)=>{
    const positions:number[]=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      const v=[a[0],y,a[1], b[0],y,b[1], b[0],y+h,b[1], a[0],y+h,a[1]];
      for(const j of [0,1,2,0,2,3])positions.push(...v.slice(j*3,j*3+3));
    }
    const g=new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    g.computeVertexNormals();add(key,g);
  };
  const path=(points:Point[],y:number,width:number,key:Key="stone")=>{
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
      box(key,(a[0]+b[0])/2,y,(a[1]+b[1])/2,width,.15,len,Math.atan2(dx,dz));
    }
  };
  // 边界取OSM；薄地台不另造高程。局部景观平面为估算。
  const boundary=data.boundary.map(point);
  slab("stone",boundary,.05,.3);
  const lawn:Point[]=[[-108,-15],[-64,-36],[9,-17],[81,24],[99,54],[41,56],[-16,26],[-76,12]];
  slab("green",lawn,.4,.2);
  path([[-150,-2],[-75,-18],[0,6],[75,37],[133,45]],.65,5);
  path([[-10,-88],[-12,-33],[8,11],[23,64],[54,103]],.65,4);
  for(const feature of data.features){
    const raw=feature.ring.map(point);
    const c=average(raw),base=ctx.groundAt(feature.center as LngLat)-ground+.5;
    const h=feature.height; // 估算：未找到可靠测高资料，不沿用自动推断高度。
    const office=feature.kind==="office",residential=feature.kind==="residential";
    const ring=office||feature.kind==="podium"?round(raw):raw;
    slab(office||!residential?"glass":"white",ring,base,h);
    const skin=scale(ring,1.012);
    if(office){
      // 银灰横向金属带、参考图中的蓝灰玻璃；颜色为目视估算。
      for(let y=4;y<h-2;y+=4.1)ribbon("silver",skin,base+y,.7);
      ribbon("silver",scale(ring,1.019),base+h*.34,1.25);
      ribbon("silver",scale(ring,1.019),base+h*.68,1.25);
      slab("white",scale(ring,1.016),base+h,.85);
      slab("silver",scale(ring,.86),base+h+.85,.45);
      // 竖向细窗梃按简化开间布置，非精确幕墙施工分格。
      for(let i=0;i<raw.length;i++){
        const a=raw[i],b=raw[(i+1)%raw.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        const count=Math.floor(len/6);
        for(let j=1;j<count;j++){
          const t=j/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
          box("silver",c[0]+(x-c[0])*1.009,base+4,c[1]+(z-c[1])*1.009,.2,h-5,.2);
        }
      }
      box("silver",c[0]-6,base+h+1.3,c[1],8,3,9);
      box("silver",c[0]+7,base+h+1.3,c[1],7,3,9);
      // 底部浅金色商业入口层。
      ribbon("bronze",skin,base+1,.55);
    }else if(residential){
      // 浅色公寓的深窗带与竖向墙垛；同组多个真实轮廓使用相同层高。
      for(let y=3;y<h-2;y+=3.6)ribbon("glass",skin,base+y,1.65);
      for(let i=0;i<raw.length;i++){
        const a=raw[i],b=raw[(i+1)%raw.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
        const n=Math.max(1,Math.floor(len/7));
        for(let j=0;j<n;j++){
          const t=(j+.5)/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
          box("white",c[0]+(x-c[0])*1.025,base,c[1]+(z-c[1])*1.025,1.2,h,1.2);
        }
      }
      slab("silver",scale(raw,1.015),base+h,.7);
      box("white",c[0],base+h,c[1],7,3,8);
    }else{
      for(let y=3;y<h;y+=3.5)ribbon("silver",scale(ring,1.025),base+y,.6);
      slab("stone",scale(ring,1.03),base+h,.65);
      slab("green",scale(ring,.77),base+h+.65,.15);
    }
  }
  // 固定种子布置低多边形乔木；避让已有建筑包围盒，植被位置为示意。
  const boxes=data.features.map(f=>{
    const p=f.ring.map(point);
    return [Math.min(...p.map(v=>v[0]))-5,Math.max(...p.map(v=>v[0]))+5,Math.min(...p.map(v=>v[1]))-5,Math.max(...p.map(v=>v[1]))+5];
  });
  const tree=(x:number,z:number,y:number)=>{
    if(boxes.some(b=>x>b[0]&&x<b[1]&&z>b[2]&&z<b[3]))return;
    add("bronze",new THREE.CylinderGeometry(.35,.5,3,5).translate(x,y+1.5,z));
    add("leaf",new THREE.IcosahedronGeometry(3.3,0).scale(1,1.3,1).translate(x,y+5,z));
  };
  for(let i=0;i<boundary.length;i++){
    const a=boundary[i],b=boundary[(i+1)%boundary.length],n=Math.floor(Math.hypot(b[0]-a[0],b[1]-a[1])/17);
    for(let j=0;j<n;j++){
      const t=(j+.5)/n,x=(a[0]+(b[0]-a[0])*t)*.95,z=(a[1]+(b[1]-a[1])*t)*.95;
      const geo=data.boundary[i];tree(x,z,ctx.groundAt(geo as LngLat)-ground+.5);
    }
  }
  for(let i=0;i<23;i++)tree(-109+i*10,17+Math.sin(i*.36)*23,.7);
  for(const key of Object.keys(materials) as Key[]){
    if(!batches[key].length){materials[key].dispose();continue;}
    const geometry=mergeGeometries(batches[key],false)!;
    batches[key].forEach(g=>g.dispose());
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials[key]);mesh.name="南太云创谷/"+key;
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  root.userData={id:"nantai-inno-valley",scale:1,source:data.meta.sources,estimates:data.meta.limitations};
  return root;
}
