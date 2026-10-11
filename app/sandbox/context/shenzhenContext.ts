import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

type XY = [number, number];
export type ContextGeometry = { type: string; coordinates: unknown };
export type ContextFeature = {
  id: string; name: string; status: string; geometry: ContextGeometry | null;
  localGeometry: ContextGeometry | null; landGeometry?: ContextGeometry; renderLocalGeometry?: ContextGeometry | null;
  kind?: string; color?: string; label?: { coordinates: XY; local: XY };
};
export type ShenzhenContextData = {
  meta: { projection: { origin: XY; k: number }; [key: string]: unknown };
  districts: ContextFeature[]; cityOutline: ContextFeature; neighbors: ContextFeature[];
  water: ContextFeature[]; routes: ContextFeature[]; places: ContextFeature[];
};
const BASE = -250;
function polygons(g: ContextGeometry | null | undefined): XY[][][] {
  if (g?.type === 'Polygon') return [g.coordinates as XY[][]];
  if (g?.type === 'MultiPolygon') return g.coordinates as XY[][][];
  return [];
}
function lines(g: ContextGeometry | null | undefined): XY[][] {
  if (g?.type === 'LineString') return [g.coordinates as XY[]];
  if (g?.type === 'MultiLineString') return g.coordinates as XY[][];
  return polygons(g).flat();
}
function fillGeometry(g: ContextGeometry | null | undefined, y: number) {
  const geometries: THREE.BufferGeometry[] = [];
  for (const rings of polygons(g)) {
    if (!rings.length) continue;
    const shape = new THREE.Shape(rings[0].map(([x,z]) => new THREE.Vector2(x,-z)));
    for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x,z]) => new THREE.Vector2(x,-z))));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); geo.translate(0,y,0); geometries.push(geo);
  }
  return geometries;
}
function ribbonGeometry(paths: XY[][], width: number, y: number) {
  const positions: number[] = [];
  for (const path of paths) for (let i=1;i<path.length;i++) {
    const [ax,az]=path[i-1], [bx,bz]=path[i]; const len=Math.hypot(bx-ax,bz-az);
    if (!len) continue;
    const dx=-(bz-az)/len*width/2, dz=(bx-ax)/len*width/2;
    positions.push(ax+dx,y,az+dz,bx+dx,y,bz+dz,ax-dx,y,az-dz,
      ax-dx,y,az-dz,bx+dx,y,bz+dz,bx-dx,y,bz-dz);
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geo.computeVertexNormals();
  return geo;
}
function meshBatch(group: THREE.Group, name: string, geos: THREE.BufferGeometry[], color: string) {
  if (!geos.length) return;
  const normalized=geos.map(g=>g.index?g.toNonIndexed():g);
  const merged=mergeGeometries(normalized);
  new Set([...geos,...normalized]).forEach(g=>g.dispose());
  if (!merged) return;
  const material=new THREE.MeshStandardMaterial({color,roughness:0.8,metalness:0,side:THREE.DoubleSide,transparent:true});
  const mesh=new THREE.Mesh(merged,material); mesh.name=name;group.add(mesh);return mesh;
}
/** No textures, timers or render loop. Render with the host's renderer + CSS2DRenderer.
 * Guangming is outline-only: its interior belongs to the existing sandbox.
 * setOpacity affects meshes and DOM labels, and hides the group at zero.
 * group.userData.dispose() releases all owned GPU and DOM resources.
 */
export function buildShenzhenContext(data: ShenzhenContextData): { group: THREE.Group; setOpacity: (t:number)=>void } {
  const group=new THREE.Group();group.name='shenzhen-context';
  const labels: HTMLElement[]=[];
  const label=(name:string,xy:XY,kind:string)=>{
    if (typeof document==='undefined') return;
    const el=document.createElement('div'); el.textContent=name;
    const district=kind==='district',gm=name==='光明区';
    el.style.cssText=`font-family:system-ui,"PingFang SC",sans-serif;white-space:nowrap;pointer-events:none;user-select:none;font-size:${gm?18:district?14:11}px;font-weight:${district?650:450};letter-spacing:${district?'0.12em':'0'};color:${gm?'#a8553a':district?'#6b6c65':'#646d72'};text-shadow:0 1px 3px #fff,0 0 7px #fff;`;
    const obj=new CSS2DObject(el);obj.position.set(xy[0],BASE+70,xy[1]);obj.name=name;group.add(obj);labels.push(el);
  };
  meshBatch(group,'neighbors',data.neighbors.flatMap(f=>fillGeometry(f.landGeometry,BASE-10)),'#f3efe6');
  meshBatch(group,'sea',data.water.filter(f=>f.kind==='sea').flatMap(f=>fillGeometry(f.localGeometry,BASE-30)),'#9ed3e3');
  meshBatch(group,'district-land',data.districts.filter(f=>f.name!=='光明区').flatMap(f=>fillGeometry(f.landGeometry??f.localGeometry,BASE)),'#ece6d8');
  meshBatch(group,'reservoirs',data.water.filter(f=>f.kind==='reservoir'||f.kind==='lake').flatMap(f=>fillGeometry(f.renderLocalGeometry === undefined ? f.localGeometry : f.renderLocalGeometry,BASE+8)),'#7fd3e0');
  meshBatch(group,'district-boundaries',[ribbonGeometry(data.districts.filter(f=>f.name!=='光明区').flatMap(f=>lines(f.landGeometry??f.localGeometry)),65,BASE+14)],'#ffffff');
  const gm=data.districts.find(f=>f.name==='光明区');
  if(gm){
    meshBatch(group,'guangming-coral-outline',[ribbonGeometry(lines(gm.localGeometry),360,BASE+18)],'#f2a38a');
    meshBatch(group,'guangming-white-outline',[ribbonGeometry(lines(gm.localGeometry),100,BASE+20)],'#ffffff');
  }
  for(const color of [...new Set(data.routes.map(r=>r.color))]){
    if(color)meshBatch(group,'corridor-'+color,[ribbonGeometry(data.routes.filter(r=>r.color===color).flatMap(r=>lines(r.localGeometry)),85,BASE+25)],color);
  }
  const dots:THREE.BufferGeometry[]=[];
  const leaders:XY[][]=[];
  const labelOffsets:Record<string,XY>={'福田中心区':[4800,3200],'福田站':[4700,6600],'前海':[-5500,2100],'南山后海':[-4600,6600],'深圳湾口岸':[4500,9200]};
  for(const f of data.places){
    if(f.localGeometry?.type!=='Point')continue;
    const [x,z]=f.localGeometry.coordinates as XY;
    const dot=new THREE.CircleGeometry(145,12);dot.rotateX(-Math.PI/2);dot.translate(x,BASE+35,z);dots.push(dot);
    const [dx,dz]=labelOffsets[f.name]??[0,700];
    label(f.name,[x+dx,z+dz],'place');
    if(labelOffsets[f.name])leaders.push([[x,z],[x+dx,z+dz-500]]);
  }
  meshBatch(group,'place-dots',dots,'#657783');
  meshBatch(group,'place-label-leaders',[ribbonGeometry(leaders,25,BASE+28)],'#89999b');
  data.districts.forEach(f=>{if(f.label)label(f.name,f.label.local,'district');});
  // Geographic anchors for regional labels, not invented feature geometries.
  const project=([lng,lat]:XY):XY=>{
    const {origin,k}=data.meta.projection,R=6378137;
    const my=(a:number)=>R*Math.log(Math.tan(Math.PI/4+a*Math.PI/360));
    return [(lng-origin[0])*Math.PI/180*R*k,-(my(lat)-my(origin[1]))*k];
  };
  for(const [name,xy] of [['东 莞',[113.94,22.96]],['惠 州',[114.48,22.89]],['香 港',[114.14,22.40]],['伶 仃 洋',[113.78,22.48]],['大 鹏 湾',[114.38,22.51]],['大 亚 湾',[114.62,22.60]]] as [string,XY][])label(name,project(xy),'region');
  const materials:THREE.Material[]=[];let triangles=0;
  group.traverse(o=>{if(o instanceof THREE.Mesh){materials.push(o.material as THREE.Material);triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
  group.userData.triangles=triangles;
  group.userData.dispose=()=>{group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});materials.forEach(m=>m.dispose());labels.forEach(e=>e.remove());};
  return {group,setOpacity(t:number){const opacity=Number.isFinite(t)?THREE.MathUtils.clamp(t,0,1):0;group.visible=opacity>0;materials.forEach(m=>{m.opacity=opacity;m.depthWrite=opacity>=0.999;});labels.forEach(el=>{el.style.opacity=String(opacity);});}};
}
/** Standalone preview only; do not add when the actual Guangming terrain is present. */
export function buildGuangmingPreviewFill(data:ShenzhenContextData) {
  const group=new THREE.Group();group.name='preview-only-guangming-fill';
  const gm=data.districts.find(d=>d.name==='光明区');
  if(gm)meshBatch(group,'highlight',fillGeometry(gm.landGeometry??gm.localGeometry,BASE+1),'#f2a38a');
  return group;
}
