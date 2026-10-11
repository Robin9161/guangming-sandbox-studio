import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glowColor } from "../scene/atmosphere";

type Context = { project: (lngLat: [number, number]) => THREE.Vector3; groundAt: (lngLat: [number, number]) => number };
type Point = [number, number];

/**
 * 依据：data/hero-landmarks.json、data/landmark-production.json（87.5°），
 * 用户 2026-10-04 提供的东南航拍、北立面、南入口照片；既有 refs 卫星图。
 * 白色南翼、中央深入口/拱窗、弧面银色北翼、东端玻璃、圆头平台和下沉庭院有照片依据。
 * 所有米制尺寸、曲率、开孔定位和幕墙网格密度均为估算；非测绘或施工模型。
 * sandbox.json 最近的非填充轮廓仅覆盖施工阶段西侧局部，未冒充完整主馆轮廓。
 * 大型长条建筑保持 1:1，不额外放大。模型无纹理、无帧更新，按材质合并。
 */
export function buildShenzhenInternationalArtMuseum(ctx: Context): THREE.Group {
  const anchor: [number, number] = [113.934026, 22.774474];
  const group = new THREE.Group();
  group.name = "深圳国际美术馆 · 双馆方舟";
  group.position.copy(ctx.project(anchor));
  group.position.y = ctx.groundAt(anchor);
  // 局部 +x 东、+z 南；Three.js 正 y 旋转把 +x 转向负 z。
  group.rotation.y = THREE.MathUtils.degToRad(90 - 87.5);
  const materials = {
    white: new THREE.MeshStandardMaterial({ color: "#fbfbf9", roughness: .66 }),
    stone: new THREE.MeshStandardMaterial({ color: "#ede4d3", roughness: .76 }),
    silver: new THREE.MeshStandardMaterial({ color: "#dde2e8", roughness: .48, metalness: .24 }),
    screen: new THREE.MeshStandardMaterial({ color: "#aebbc3", roughness: .57, metalness: .15 }),
    glass: new THREE.MeshStandardMaterial({ color: "#33475c", roughness: .42, metalness: .18 }),
    shadow: new THREE.MeshStandardMaterial({ color: "#697882", roughness: .8 }),
    green: new THREE.MeshStandardMaterial({ color: "#a6b98c", roughness: .8 }),
    bronze: new THREE.MeshStandardMaterial({ color: "#9c8b72", roughness: .65 }),
  };
  glowColor(materials.glass, "#ffe2b0", 1);
  type Key = keyof typeof materials;
  const batches: Record<Key, THREE.BufferGeometry[]> = { white: [], stone: [], silver: [], screen: [], glass: [], shadow: [], green: [], bronze: [] };
  const add = (key: Key, g: THREE.BufferGeometry) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    batches[key].push(geometry);
  };
  const box = (key: Key, x: number, y: number, z: number, w: number, h: number, d: number) => add(key, new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z));
  const quad = (key: Key, a: number[], b: number[], c: number[], d: number[]) => {
    const g = new THREE.BufferGeometry();
    // 双面实几何保证从庭院内/外观察均正常，不依赖透明贴面。
    g.setAttribute("position", new THREE.Float32BufferAttribute([...a,...b,...c,...a,...c,...d,...c,...b,...a,...d,...c,...a], 3));
    g.computeVertexNormals(); add(key, g);
  };
  const polygon = (p: Point[]) => new THREE.Shape(p.map(([x,z]) => new THREE.Vector2(x,-z)));
  const slab = (key: Key, shape: THREE.Shape, y: number, h: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24, steps: 1 });
    g.rotateX(-Math.PI / 2).translate(0,y,0); add(key,g);
  };
  const rectangle = (x0: number, z0: number, x1: number, z1: number) => polygon([[x0,z0],[x1,z0],[x1,z1],[x0,z1]]);
  const holeRect = (s: THREE.Shape, x0: number, z0: number, x1: number, z1: number) => s.holes.push(new THREE.Path([new THREE.Vector2(x0,-z0),new THREE.Vector2(x1,-z0),new THREE.Vector2(x1,-z1),new THREE.Vector2(x0,-z1)]));
  const annulus = (key: Key, x: number, z: number, r: number, inner: number, y: number, h: number) => {
    const s = new THREE.Shape(); s.absarc(x,-z,r,0,Math.PI*2,false);
    const hole = new THREE.Path(); hole.absarc(x,-z,inner,0,Math.PI*2,true); s.holes.push(hole); slab(key,s,y,h);
  };

  // 估算：平台长约 340m、宽 126m；保留卫星图标记点为地理锚点。
  const outline: Point[] = [[-130,-62],[143,-62]];
  for(let i=0;i<=32;i++){const a=-Math.PI/2+i*Math.PI/32;outline.push([143+64*Math.cos(a),64*Math.sin(a)]);}
  outline.push([-130,64]);
  const platform = polygon(outline);
  const court = new THREE.Path(); court.absarc(169,-17,19,0,Math.PI*2,true); platform.holes.push(court);
  slab("stone",platform,1,6);
  // 真开洞的庭院：低底面、内壁和石材扶墙，平台顶面不覆盖庭院。
  add("shadow",new THREE.CylinderGeometry(18.8,18.8,.4,48).translate(169,.6,17));
  annulus("white",169,17,20.2,19,1,6.5);
  annulus("green",169,17,24,20.3,7.02,.18);
  annulus("silver",169,17,20.5,20.05,7.5,.22);
  // 东端弧形下降台阶（位置、级数估算）。
  for(let i=0;i<12;i++){
    const s = new THREE.Shape(); const r=20.5+i*.58;
    s.absarc(169,-17,r+.6,-.9,.8,false); s.absarc(169,-17,r,.8,-.9,true); s.closePath();
    slab("stone",s,1.2+i*.48,.48);
  }
  // 圆头平台女儿墙，只沿外缘，西端留开放广场。
  for(let i=0;i<outline.length-1;i++){
    const a=outline[i],b=outline[i+1]; const dx=b[0]-a[0],dz=b[1]-a[1];
    const g=new THREE.BoxGeometry(Math.hypot(dx,dz),1.2,.7);
    g.rotateY(-Math.atan2(dz,dx)).translate((a[0]+b[0])/2,7.6,(a[1]+b[1])/2);add("white",g);
  }

  // 南翼：单一高大白石体量，屋顶两个开敞庭院，中央贯通式深门厅。
  const southRoof=rectangle(-115,7,119,52);
  holeRect(southRoof,77,17,108,43); holeRect(southRoof,32,20,62,39);
  slab("white",southRoof,46,2);
  box("white",-113,9,29.5,4,37,45);box("white",117,9,29.5,4,37,45);
  box("white",2,9,8.5,230,37,3);
  box("shadow",2,7,29,226,1,40);
  for(const [x0,x1,z0,z1] of [[77,108,17,43],[32,62,20,39]]) {
    box("white",(x0+x1)/2,35,z0,x1-x0,11,1);box("white",(x0+x1)/2,35,z1,x1-x0,11,1);
    box("white",x0,35,(z0+z1)/2,1,11,z1-z0);box("white",x1,35,(z0+z1)/2,1,11,z1-z0);
    box("shadow",(x0+x1)/2,34.8,(z0+z1)/2,x1-x0,.2,z1-z0);
  }
  // 南正立面：真实镂空的矩形大门洞 + 两侧狭长拱顶窗。
  const facade = new THREE.Shape();facade.moveTo(-115,9);facade.lineTo(119,9);facade.lineTo(119,48);facade.lineTo(-115,48);facade.closePath();
  const portal = new THREE.Path();portal.moveTo(-26,9);portal.lineTo(15,9);portal.lineTo(15,39);portal.lineTo(-26,39);portal.closePath();facade.holes.push(portal);
  for(const x of [-38,27]){const p=new THREE.Path();p.moveTo(x-2.5,10);p.lineTo(x+2.5,10);p.lineTo(x+2.5,33);p.absarc(x,33,2.5,0,Math.PI,false);p.closePath();facade.holes.push(p);
    box("glass",x,10,50.6,4.9,25.6,.25);
    for(let j=-1;j<=1;j++)box("silver",x+j*1.5,10,50.8,.13,25,.2);
  }
  const fg = new THREE.ExtrudeGeometry(facade,{depth:2,bevelEnabled:false,curveSegments:12});fg.translate(0,0,51);add("white",fg);
  quad("stone",[-26,9,51],[-26,39,51],[-21,33,35],[-21,9,35]);
  quad("stone",[15,39,51],[15,9,51],[10,9,35],[10,33,35]);
  quad("stone",[-26,39,51],[15,39,51],[10,33,35],[-21,33,35]);
  box("glass",-5.5,9,34.8,31,24,.4);
  for(let i=0;i<=10;i++)box("silver",-21+i*3.1,9,35.1,.15,24,.18);
  for(let y=9;y<34;y+=6)box("silver",-5.5,y,35.2,31,.18,.2);
  for(let i=0;i<8;i++)box("stone",-5.5,7+i*.25,57-i*.65,32,.25,1.3);
  // 阶梯/细长天窗，不铺平屋顶成色块。
  box("glass",-74,48.03,29,27,.25,3.5);
  for(let i=0;i<13;i++)box("silver",34+i*2.1,48.1,13, .3,.55,9);
  box("glass",2,22,-1,220,1,12);

  // 北翼：长轴两端上翘，北立面内凹；两片银色屏风之间露出中央玻璃大厅。
  const northZ=(x:number)=>-51+12*(1-Math.pow(x/120,2));
  const roofY=(x:number)=>45+5*Math.pow(x/120,2);
  const innerZ=(x:number)=>-7-6*(1-Math.pow(x/120,2));
  const segments=32;
  for(let i=0;i<segments;i++){
    const a=-115+i*234/segments,b=-115+(i+1)*234/segments;
    const za=northZ(a),zb=northZ(b),ya=roofY(a),yb=roofY(b);
    quad("glass",[a,10,za+.6],[b,10,zb+.6],[b,yb,zb+.6],[a,ya,za+.6]);
    quad("silver",[a,ya,za-1],[b,yb,zb-1],[b,yb,innerZ(b)],[a,ya,innerZ(a)]);
    quad("bronze",[a,ya+.25,za-1],[b,yb+.25,zb-1],[b,yb+.25,zb+.2],[a,ya+.25,za+.2]);
    quad("screen",[a,12,innerZ(a)],[b,12,innerZ(b)],[b,yb-.3,innerZ(b)],[a,ya-.3,innerZ(a)]);
    for(let row=0;row<18;row++){
      const y=13+row*1.75;if(y>Math.min(ya,yb)-1)continue;
      for(let col=0;col<2;col++){
        const x=a+(col+.5)*(b-a)/2,w=(b-a)/2-.3,left=x-w/2,right=x+w/2;
        quad("silver",[left,y,innerZ(left)+.4],[right,y,innerZ(right)+.4],[right,y+.48,innerZ(right)+.75],[left,y+.48,innerZ(left)+.75]);
      }
    }
    if(b < -9 || a > 13){
      quad("screen",[a,14,za],[b,14,zb],[b,yb-3.2,zb],[a,ya-3.2,za]);
      // 简化金属编织幕墙：交错的短水平百叶，合并后仍只有一个材质网格。
      for(let row=0;row<17;row++){
        const y=15+row*1.65; if(y>Math.min(ya,yb)-3.5)continue;
        for(let col=0;col<2;col++){
          const x=a+(col+.5)*((b-a)/2);const w=(b-a)/2-.38;
          const left=x-w/2,right=x+w/2;
          quad("silver",[left,y,northZ(left)-.55],[right,y,northZ(right)-.55],[right,y+.48,northZ(right)-.8],[left,y+.48,northZ(left)-.8]);
        }
      }
    }
  }
  box("shadow",2,12,-23,232,27,25);
  // 北翼东端落地玻璃和四道楼板；幕墙仍在盒体外，端面可以透读。
  box("glass",119.6,10,-30,1,39,42);
  for(let y=10;y<=49;y+=9.5)box("silver",120.3,y,-30,1.2,.8,43);
  for(let z=-49;z<-9;z+=3.5)box("silver",120.5,10,z,.6,39,.23);
  box("glass",-115.4,10,-29,1,39,43);
  for(let x=-109;x<116;x+=11)box("silver",x,7,-22,1,5,1);
  // 两翼之间的中庭、连桥，以及照片可见的北翼顶面浅矩形开口示意。
  for(const x of [-65,8,76])box("glass",x,roofY(x)+.1,-26,24,.4,15);
  for(const x of [-85,28])box("silver",x,30,-1,18,1.2,17);
  // 东平台几何花坛和步道，分布按航拍作简化，非实测景观图。
  for(const p of [[133,-30,17,22],[145,-4,22,14],[139,39,20,12],[183,-15,10,16]] ){
    const [x,z,w,d]=p;box("white",x,7,z,w+1,.5,d+1);box("green",x,7.5,z,w,.15,d);
  }
  for(const key of Object.keys(materials) as Key[]){
    if(!batches[key].length){materials[key].dispose();continue;}
    const geometry=mergeGeometries(batches[key],false)!;
    batches[key].forEach(g=>g.dispose());geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials[key]);mesh.name=`国际美术馆/${key}`;
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData.evidence={bearingDeg:87.5,anchor,scale:1,referenceDate:"2026-10-04",dimensions:"估算",detail:"用户航拍/北立面/南入口照片"};
  return group;
}
