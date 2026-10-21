import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bridgeProfile } from './hongqiao-profile';

type Coordinate = [number, number];
type Route = { id: number; kind: string; coordinates: Coordinate[] };
export type HongqiaoData = { meta: { widthMeters: number; nominalClearanceMeters: number }; spans: Route[]; connections?: Route[]; ramps: Route[]; paths: Route[] };

export function createHongqiaoBridge(data: HongqiaoData, project: (p: Coordinate) => THREE.Vector3, sample: (p: Coordinate) => number, canPlant: (p: Coordinate) => boolean = () => true) {
  const group = new THREE.Group(); group.name = 'hongqiao-park';
  const metersPerMapMeter = Math.cos(22.749 * Math.PI / 180);
  const surfaces: THREE.BufferGeometry[] = [], edges: THREE.BufferGeometry[] = [], paths: THREE.BufferGeometry[] = [];
  const supports: { x: number; z: number; bottom: number; top: number }[] = [];
  const decks: { points: THREE.Vector3[]; ground: number[]; distance: number[] }[] = [];

  function pointsFor(route: Route) {
    const coordinates: Coordinate[] = [route.coordinates[0]];
    for (let i = 1; i < route.coordinates.length; i++) {
      const a = route.coordinates[i-1], b = route.coordinates[i];
      const steps = Math.max(1, Math.ceil(project(a).distanceTo(project(b)) * metersPerMapMeter / 4));
      for (let j = 1; j <= steps; j++) coordinates.push([a[0]+(b[0]-a[0])*j/steps, a[1]+(b[1]-a[1])*j/steps]);
    }
    const points = coordinates.map(project), ground = coordinates.map(sample), distance = [0];
    for (let i = 1; i < points.length; i++) distance.push(distance[i-1] + points[i].distanceTo(points[i-1]) * metersPerMapMeter);
    return { points, ground, distance };
  }

  // Continuous mitered strips, not disconnected boxes/tubes. Guard panels also
  // describe the silhouette in a close oblique view without thousands of objects.
  function strip(points: THREE.Vector3[], lateral: number, width: number, bottom: number, top: number) {
    const positions: number[] = [], indices: number[] = [];
    const normals = points.map((p, i) => {
      const prev = points[Math.max(0,i-1)], next = points[Math.min(points.length-1,i+1)];
      return new THREE.Vector2(-(next.z-prev.z), next.x-prev.x).normalize();
    });
    points.forEach((p,i) => {
      for (const [offset, y] of [[lateral-width/2,bottom],[lateral+width/2,bottom],[lateral-width/2,top],[lateral+width/2,top]]) {
        positions.push(p.x+normals[i].x*offset/metersPerMapMeter,p.y+y,p.z+normals[i].y*offset/metersPerMapMeter);
      }
      if (!i) return;
      const a=(i-1)*4,b=i*4;
      for (const [u,v] of [[0,1],[1,3],[3,2],[2,0]]) indices.push(a+u,b+u,a+v,a+v,b+u,b+v);
    });
    indices.push(0,2,1,1,2,3);
    const end=(points.length-1)*4; indices.push(end,end+1,end+2,end+1,end+3,end+2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function addDeck(points: THREE.Vector3[], ground: number[], distance: number[], width: number) {
    surfaces.push(strip(points,0,width,-.5,0));
    for (const side of [-1,1]) {
      edges.push(strip(points,side*(width/2-.12),.24,-.65,1.3));
      edges.push(strip(points,side*(width/2-.12),.38,1.3,1.42));
    }
    let lastPier = -25;
    for (let i=1;i<points.length-1;i++) if (distance[i]-lastPier>=25) {
      const p=points[i]; supports.push({x:p.x,z:p.z,bottom:ground[i]-.4,top:p.y-.5}); lastPier=distance[i];
    }
  }
  for (const route of data.spans) {
    const deck=pointsFor(route);
    const profile=bridgeProfile(deck.distance,deck.ground,data.meta.nominalClearanceMeters);
    deck.points.forEach((p,i)=>p.y=profile[i]); decks.push(deck);
    addDeck(deck.points,deck.ground,deck.distance,data.meta.widthMeters);
  }
  // Both ends use the exact existing deck endpoint height. The middle follows
  // the mapped park/underpass route near ground; transition heights are 估算.
  for (const route of data.connections ?? []) {
    const link = pointsFor(route);
    const endpoints = decks.flatMap(d => [d.points[0], d.points.at(-1)!]);
    const nearest = (p: THREE.Vector3) => endpoints.reduce((a,b) =>
      Math.hypot(b.x-p.x,b.z-p.z) < Math.hypot(a.x-p.x,a.z-p.z) ? b : a);
    const start = nearest(link.points[0]), end = nearest(link.points.at(-1)!);
    const total = link.distance.at(-1)!;
    const ease = (v: number) => { const t = THREE.MathUtils.clamp(v,0,1); return t*t*(3-2*t); };
    link.points.forEach((p,i) => {
      const base = link.ground[i] + .35;
      const fromStart = 1-ease(link.distance[i]/80);
      const fromEnd = 1-ease((total-link.distance[i])/80);
      p.y = base + (start.y-link.ground[0]-.35)*fromStart
        + (end.y-link.ground.at(-1)!-.35)*fromEnd;
    });
    link.points[0].copy(start); link.points.at(-1)!.copy(end);
    addDeck(link.points,link.ground,link.distance,data.meta.widthMeters);
  }
  for (const route of data.ramps) {
    const ramp=pointsFor(route);
    // The OSM spiral starts at an actual shared node on the entrance bridge.
    const joint=decks.flatMap(d=>d.points).reduce((best,p)=>Math.hypot(p.x-ramp.points[0].x,p.z-ramp.points[0].z)<Math.hypot(best.x-ramp.points[0].x,best.z-ramp.points[0].z)?p:best);
    const length=ramp.distance.at(-1)!;
    ramp.points.forEach((p,i)=>p.y=THREE.MathUtils.lerp(joint.y,ramp.ground.at(-1)!+.3,ramp.distance[i]/length));
    addDeck(ramp.points,ramp.ground,ramp.distance,2.5);
  }
  for (const route of data.paths) {
    const path=pointsFor(route); path.points.forEach((p,i)=>p.y=path.ground[i]+.35);
    paths.push(strip(path.points,0,3,0,.12));
  }
  function batch(geometries: THREE.BufferGeometry[], color: string) {
    if (!geometries.length) return;
    const mesh=new THREE.Mesh(mergeGeometries(geometries),new THREE.MeshStandardMaterial({color,roughness:1,metalness:0,side:THREE.DoubleSide}));
    mesh.castShadow=true; mesh.receiveShadow=true; group.add(mesh); geometries.forEach(g=>g.dispose());
  }
  batch(surfaces,'#e27669'); batch(edges,'#c3372d'); batch(paths,'#d9c8b4');
  const piers=new THREE.InstancedMesh(new THREE.CylinderGeometry(.6,.85,1,8),new THREE.MeshStandardMaterial({color:'#bc4c3c',roughness:1}),supports.length);
  const matrix=new THREE.Matrix4(); supports.forEach((p,i)=>{
    matrix.makeScale(1/metersPerMapMeter,Math.max(.1,p.top-p.bottom),1/metersPerMapMeter); matrix.setPosition(p.x,(p.top+p.bottom)/2,p.z); piers.setMatrixAt(i,matrix);
  });
  piers.castShadow=true; piers.receiveShadow=true; group.add(piers);
  // Satellite reference shows woodland south of the forest span. Individual
  // crowns are a deterministic illustrative planting, not a tree inventory.
  // Exclude mapped water, playing fields and the full bridge corridor.
  const crowns: { point: THREE.Vector3; radius: number }[]=[];
  const forest=data.spans.find(s=>s.kind==='forest');
  if (forest) for (let i=0;i<forest.coordinates.length;i+=2) {
    const c=forest.coordinates[i]; if(c[0]<113.9535)continue;
    for (let row=0;row<4;row++) {
      const seed=(i*73+row*137)%997;
      const p:Coordinate=[c[0]+((seed%29)-14)/102650,c[1]-(20+row*23+(seed%13))/111320];
      if(!canPlant(p))continue;
      const local=project(p);
      if(decks.some(d=>d.points.some(q=>Math.hypot(q.x-local.x,q.z-local.z)<13/metersPerMapMeter)))continue;
      local.y=sample(p); crowns.push({point:local,radius:4+(seed%5)*.5});
    }
  }
  // The planted centre of the OSM/satellite-verified spiral ramp.
  const island=project([113.946887,22.749304]); island.y=sample([113.946887,22.749304]);
  const islandMesh=new THREE.Mesh(new THREE.CylinderGeometry(5.6,5.6,.25,24),new THREE.MeshStandardMaterial({color:'#a5bd6c',roughness:1}));
  islandMesh.position.copy(island); islandMesh.position.y+=.15; group.add(islandMesh);
  crowns.push({point:island,radius:2.8});
  const trees=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,flatShading:true}),crowns.length);
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.5,1,5),new THREE.MeshStandardMaterial({color:'#82704e',roughness:1}),crowns.length);
  const palette=['#9fba69','#b7cc7b','#8da965','#abc67a'];
  crowns.forEach(({point:p,radius:r},i)=>{
    matrix.makeScale(r/metersPerMapMeter,r*1.1,r/metersPerMapMeter); matrix.setPosition(p.x,p.y+r*1.4,p.z); trees.setMatrixAt(i,matrix);
    trees.setColorAt(i,new THREE.Color(palette[i%palette.length]));
    matrix.makeScale(1,r,1); matrix.setPosition(p.x,p.y+r*.5,p.z); trunks.setMatrixAt(i,matrix);
  });
  trees.castShadow=true; trees.receiveShadow=true; group.add(trees,trunks);
  // No per-frame work. Parent scaling follows the existing elevation slider.
  group.userData = { spans: data.spans.length, piers: supports.length, illustrativeTrees: crowns.length, illustrativeHeight: true };
  return group;
}
