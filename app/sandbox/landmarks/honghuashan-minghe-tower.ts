import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";
import data from "../../../public/sandbox/landmarks/honghuashan-minghe-tower.json";

type Context = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };
/** 明和塔：官方八面九层47m。塔径、层高分配、栏杆/檐口/塔刹为估算；定位和朝向限制见 JSON meta。 */
export function buildHonghuashanMingheTower(ctx: Context): THREE.Group {
  const root=new THREE.Group();root.name="红花山公园·明和塔";
  const anchor=data.anchor as [number,number];root.position.copy(ctx.project(anchor));root.position.y=ctx.groundAt(anchor);
  // +z 为入口方向。没有权威 bearingDeg；225°朝登山路仅为估算，不改变塔的地理位置。
  root.rotation.y=THREE.MathUtils.degToRad(180-data.bearingDeg);
  const mats={
    red:new THREE.MeshStandardMaterial({color:"#ac5951",roughness:.68}),
    roof:new THREE.MeshStandardMaterial({color:"#33475c",roughness:.7}),
    stone:new THREE.MeshStandardMaterial({color:"#ede4d3",roughness:.78}),
    trim:new THREE.MeshStandardMaterial({color:"#dde2e8",roughness:.58}),
    gold:new THREE.MeshStandardMaterial({color:"#bb9468",roughness:.55,metalness:.18}),
    dark:new THREE.MeshStandardMaterial({color:"#293b48",roughness:.64}),
  };
  glowColor(mats.dark,"#ffe2b0",1);
  type Key=keyof typeof mats;
  const batch:Record<Key,THREE.BufferGeometry[]>={red:[],roof:[],stone:[],trim:[],gold:[],dark:[]};
  function add(k:Key,g:THREE.BufferGeometry){const v=g.index?g.toNonIndexed():g;if(v!==g)g.dispose();v.deleteAttribute("uv");batch[k].push(v);}
  function cylinder(k:Key,r:number,top:number,y:number,h:number,sides=8){add(k,new THREE.CylinderGeometry(top,r,h,sides,1,false,Math.PI/8).translate(0,y+h/2,0));}
  function box(k:Key,x:number,y:number,z:number,w:number,h:number,d:number,angle=0){const g=new THREE.BoxGeometry(w,h,d);g.rotateY(angle).translate(x,y+h/2,z);add(k,g);}
  function beam(k:Key,a:THREE.Vector3,b:THREE.Vector3,r:number){const delta=b.clone().sub(a);const g=new THREE.BoxGeometry(r*2,delta.length(),r*2);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);add(k,g);}
  const point=(r:number,a:number,y:number)=>new THREE.Vector3(Math.sin(a)*r,y,Math.cos(a)*r);
  // 每片八角屋面分四段，檐口角部翘起；连成有厚度屋面，不用层层圆锥替代。
  function roof(radius:number,neck:number,y:number,height:number,key:Key){
    const rings=[[radius,y+.1],[radius*.91,y-.1],[radius*.76,y+height*.18],[neck,y+height]];
    const positions:number[]=[];const vertices:THREE.Vector3[][]=[];
    for(let ring=0;ring<rings.length;ring++){
      const [r,h]=rings[ring],pts:THREE.Vector3[]=[];
      for(let side=0;side<8;side++)for(let j=0;j<4;j++){
        const t=j/4,a=point(r,Math.PI/8+side*Math.PI/4,h),b=point(r,Math.PI/8+(side+1)*Math.PI/4,h);
        const p=a.lerp(b,t);p.y+=(ring===0?.46:ring===1?.18:0)*Math.pow(Math.abs(t-.5)*2,2);pts.push(p);
      }vertices.push(pts);
    }
    const tri=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>positions.push(...a.toArray(),...b.toArray(),...c.toArray());
    for(let r=0;r<3;r++)for(let j=0;j<32;j++){const n=(j+1)%32,a=vertices[r][j],b=vertices[r][n],c=vertices[r+1][n],d=vertices[r+1][j];tri(a,b,c);tri(a,c,d);}
    // 底面：完整向下封闭，投影不会透光。
    for(let j=0;j<32;j++){const n=(j+1)%32;tri(new THREE.Vector3(0,y-.15,0),vertices[0][n],vertices[0][j]);}
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();add(key,g);
    for(let side=0;side<8;side++){
      const a=Math.PI/8+side*Math.PI/4;
      beam("gold",point(neck,a,y+height+.06),point(radius*.76,a,y+height*.18+.07),.055);
      beam("gold",point(radius*.76,a,y+height*.18+.07),point(radius,a,y+.58),.055);
    }
    for(let j=0;j<32;j++)beam("red",vertices[0][j],vertices[0][(j+1)%32],.07);
  }
  // 估算：约18m八角台基，47m总高，不放大，不内置假山以免重复地形高程。
  cylinder("stone",9.4,9.4,0,.45);cylinder("stone",8.9,8.9,.45,.45);cylinder("stone",8.4,8.4,.9,.4);
  for(let i=0;i<4;i++)box("stone",0,i*.325,10.5-i*.62,4.8,.325,1.3);
  const floorHeight=4.45;
  for(let level=0;level<9;level++){
    const y=1.3+level*floorHeight, radius=6.35-level*.19,core=radius-1.15;
    // 塔心深色窗洞/砖壁和红色回廊柱梁。
    cylinder("dark",core,core,y+.12,3.48);
    cylinder("red",radius,radius,y,.25);
    cylinder("red",core+.05,core+.05,y+3.4,.32);
    const colR=radius-.27,railR=radius-.14;
    for(let side=0;side<8;side++){
      const a=Math.PI/8+side*Math.PI/4,b=a+Math.PI/4;
      const cp=point(colR,a,y+.2);
      add("red",new THREE.CylinderGeometry(.14,.17,3.4,6).translate(cp.x,y+1.9,cp.z));
      // 单面窗框位置与开间数量为估算，使用空的回廊而非整层不透明红柱体。
      const mid=a+Math.PI/8,cr=core*Math.cos(Math.PI/8)+.03;
      box("red",Math.sin(mid)*cr,y+.28,Math.cos(mid)*cr,core*.72,.15,.14,mid);
      for(const offset of [-.74,.74]){
        const p=point(cr,mid,y+.25);p.x+=Math.cos(mid)*offset;p.z-=Math.sin(mid)*offset;
        box("red",p.x,y+.25,p.z,.12,3.15,.16,mid);
      }
      // 首层入口留开口；其余栏杆每边四格，按材质一次合并。
      if(level===0 && side===7)continue;
      for(const h of [.46,1.03])beam("red",point(railR,a,y+h),point(railR,b,y+h),.065);
      const pa=point(railR,a,y+.27),pb=point(railR,b,y+.27);
      for(let j=0;j<=4;j++){const p=pa.clone().lerp(pb,j/4);box("red",p.x,y+.27,p.z,.10,.85,.10);}
    }
    // 每层斗拱简化成短挑梁，九层檐口均保留。
    for(let side=0;side<8;side++){const a=Math.PI/8+side*Math.PI/4,p=point(radius-.1,a,y+3.25);box("red",p.x,y+3.2,p.z,.28,.27,1.0,a);}
    const roofY=y+3.62;
    roof(radius+1.0,level===8?.5:core*.92,roofY,level===8?2.95:1.05,level===8?"gold":"roof");
  }
  // 顶层 y=36.9，屋顶最高43.47m，刹尖严格到47m（分配估算）。
  cylinder("gold",.44,.3,43.47,.65);
  for(let i=0;i<5;i++)cylinder("gold",.3-i*.025,.3-i*.025,44.15+i*.36,.09,8);
  cylinder("roof",.15,.04,44.1,2.7,8);cylinder("gold",.12,0,46.8,.2,8);
  for(const k of Object.keys(mats) as Key[]){if(!batch[k].length){mats[k].dispose();continue;}const g=mergeGeometries(batch[k],false)!;batch[k].forEach(v=>v.dispose());g.computeBoundingSphere();const m=new THREE.Mesh(g,mats[k]);m.name=`明和塔/${k}`;m.castShadow=true;m.receiveShadow=true;root.add(m);}
  root.userData={landmarkId:"honghuashan-minghe-tower",height:47,storeys:9,scale:1,coordinateStatus:"塔基候选轮廓中心，约±15m",bearingStatus:"估算",sources:data.meta.sources};
  return root;
}
