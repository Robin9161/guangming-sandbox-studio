import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { FeatureCollection } from 'geojson';
import { pairs, type SandboxData } from '../../scene/types';
export type Pt = [number, number];
export type StoryAnim = { group: THREE.Group; paint?: (c: CanvasRenderingContext2D, toPixel: (x:number,z:number)=>Pt, metersToPixels:number)=>void; duration:number; seek:(t:number)=>void; dispose:()=>void };
export type HistoryContext = { groundAt:(x:number,z:number)=>number; data:SandboxData; places:Record<string,{x:number;z:number;name:string;era?:string;clan?:string}>; areas?:FeatureCollection; /** 沙盘高度，不是原始海拔 */ alluvialHeight?:number };
export const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
export const distance=(a:Pt,b:Pt)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function inside(p:Pt,ring:Pt[]){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function nearest(p:Pt,line:Pt[]){let d=Infinity,along=0,total=0;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],l=distance(a,b);const t=clamp(((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/(l*l||1));const nd=distance(p,[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);if(nd<d){d=nd;along=total+t*l;}total+=l;}return {d,along,total};}
/** Endpoint graph + shortest route south→west excludes the northeastern tributary. */
export function riverTrunk(data:SandboxData):Pt[]{
 const segments=data.water.lines.filter(l=>l.n==='茅洲河').map(l=>pairs(l.p)).filter(l=>l.length>1);
 if(!segments.length)return [];
 const nodes:Pt[]=[],edges:{to:number;path:Pt[];cost:number}[][]=[];
 const node=(p:Pt)=>{const old=nodes.findIndex(q=>distance(p,q)<3);if(old>=0)return old;nodes.push(p);edges.push([]);return nodes.length-1;};
 for(const path of segments){const a=node(path[0]),b=node(path[path.length-1]),cost=path.slice(1).reduce((s,p,i)=>s+distance(path[i],p),0);edges[a].push({to:b,path,cost});edges[b].push({to:a,path:[...path].reverse(),cost});}
 // Only bridge short missing endpoint gaps; never reorder arbitrary vertices.
 for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){const cost=distance(nodes[a],nodes[b]);if(cost<=600&&!edges[a].some(e=>e.to===b)){edges[a].push({to:b,path:[nodes[a],nodes[b]],cost});edges[b].push({to:a,path:[nodes[b],nodes[a]],cost});}}
 const start=nodes.reduce((s,p,i)=>p[1]>nodes[s][1]?i:s,0),end=nodes.reduce((s,p,i)=>p[0]<nodes[s][0]?i:s,0);
 const costs=nodes.map(()=>Infinity),previous=new Map<number,{from:number;path:Pt[]}>(),todo=new Set(nodes.map((_,i)=>i));costs[start]=0;
 while(todo.size){const a=[...todo].reduce((s,i)=>costs[i]<costs[s]?i:s);todo.delete(a);if(!Number.isFinite(costs[a])||a===end)break;for(const e of edges[a])if(costs[a]+e.cost<costs[e.to]){costs[e.to]=costs[a]+e.cost;previous.set(e.to,{from:a,path:e.path});}}
 if(!previous.has(end))return [];
 const chunks:Pt[][]=[];for(let n=end;n!==start;){const p=previous.get(n)!;chunks.unshift(p.path);n=p.from;}return chunks.flatMap((p,i)=>i?p.slice(1):p);
}
export function partial(path:Pt[],progress:number):Pt[]{if(!path.length)return [];let left=path.slice(1).reduce((s,p,i)=>s+distance(path[i],p),0)*clamp(progress);const out=[path[0]];for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],l=distance(a,b);if(left>=l){out.push(b);left-=l;}else{out.push([a[0]+(b[0]-a[0])*left/(l||1),a[1]+(b[1]-a[1])*left/(l||1)]);break;}}return out;}
export function curve(a:Pt,b:Pt,bend=800):Pt[]{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;return Array.from({length:49},(_,i)=>{const t=i/48;return [a[0]+dx*t-dz/l*Math.sin(t*Math.PI)*bend,a[1]+dz*t+dx/l*Math.sin(t*Math.PI)*bend];});}
export function stroke(c:CanvasRenderingContext2D,to:(x:number,z:number)=>Pt,path:Pt[],color:string,width:number){if(path.length<2)return;c.beginPath();path.forEach((p,i)=>{const q=to(...p);if(i)c.lineTo(...q);else c.moveTo(...q);});c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();}
export function arrow(c:CanvasRenderingContext2D,to:(x:number,z:number)=>Pt,path:Pt[],color:string,width:number){stroke(c,to,path,color,width);if(path.length<2)return;const a=to(...path[path.length-2]),b=to(...path[path.length-1]),angle=Math.atan2(b[1]-a[1],b[0]-a[0]),r=width*4;c.beginPath();c.moveTo(...b);c.lineTo(b[0]-r*Math.cos(angle-.48),b[1]-r*Math.sin(angle-.48));c.lineTo(b[0]-r*Math.cos(angle+.48),b[1]-r*Math.sin(angle+.48));c.closePath();c.fillStyle=color;c.fill();}
export function animation(ctx:HistoryContext,duration:number){const group=new THREE.Group();let time=0,disposed=false;const labels:{inner:HTMLElement;start:number}[]=[];
 const label=(text:string,p:Pt,start:number)=>{const outer=document.createElement('div'),inner=document.createElement('div');inner.textContent=text;inner.style.cssText='font:500 13px system-ui,"PingFang SC",sans-serif;color:#526762;background:#fffaf0eb;border:1px solid #dcded0;border-radius:12px;padding:7px 11px;white-space:nowrap;box-shadow:0 3px 12px #68796c10;opacity:0';outer.append(inner);const object=new CSS2DObject(outer);object.position.set(p[0],ctx.groundAt(...p)+130,p[1]);group.add(object);labels.push({inner,start});return object;};
 const anim:StoryAnim={group,duration,seek(t){if(disposed)return;time=Number.isFinite(t)?Math.max(0,Math.min(duration,t)):0;for(const l of labels)l.inner.style.opacity=String(smooth((time-l.start)/.8));},dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o instanceof CSS2DObject)o.element.remove();if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});group.removeFromParent();group.clear();}};
 return {anim,label,time:()=>time};
}
export const fallbackPlaces:HistoryContext['places']={
 'village-yulu':{x:-3300,z:2900,name:'玉律'},'village-heshuikou':{x:-4900,z:-100,name:'合水口'},'village-loucun':{x:-700,z:-3400,name:'楼村'},'village-dongkeng':{x:-400,z:850,name:'东坑'},'village-jingkou':{x:2857,z:-195,name:'迳口'},
};
/** 年代简写：去掉括注，如"明永乐二十一年（1423）"→"明永乐二十一年" */
const shortEra=(era?:string)=>era?.replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').trim();
export function place(ctx:HistoryContext,id:string){const p=ctx.places[id]??fallbackPlaces[id];return {p:[p.x,p.z] as Pt,name:p.name,temporary:!ctx.places[id],era:shortEra(p.era),clan:p.clan?.replace(/（[^）]*）/g,'').trim()};}
/** GeoJSON defaults to WGS84; properties.coordinateSystem="local" opts into metre x/z. */
export function areaPolygons(ctx:HistoryContext,id:string):Pt[][][]{const result:Pt[][][]=[];for(const f of ctx.areas?.features??[]){if(f.id!==id&&f.properties?.id!==id)continue;const g=f.geometry;if(!g||!['Polygon','MultiPolygon'].includes(g.type))continue;const polygons=g.type==='Polygon'?[g.coordinates]:(g as GeoJSON.MultiPolygon).coordinates;const {origin:[lng0,lat0],k}=ctx.data.meta.projection;const merc=(lat:number)=>6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));for(const polygon of polygons)result.push((polygon as number[][][]).map(r=>r.map(p=>f.properties?.coordinateSystem==='local'?[p[0],p[1]]:[6378137*(p[0]-lng0)*Math.PI/180*k,-(merc(p[1])-merc(lat0))*k])));}return result;}
export const inPolygons=(p:Pt,polygons:Pt[][][])=>polygons.some(r=>inside(p,r[0])&&!r.slice(1).some(h=>inside(p,h)));
export function polygonPath(c:CanvasRenderingContext2D,to:(x:number,z:number)=>Pt,polygons:Pt[][][]){c.beginPath();for(const polygon of polygons)for(const ring of polygon){ring.forEach((p,i)=>{if(i)c.lineTo(...to(...p));else c.moveTo(...to(...p));});c.closePath();}}
