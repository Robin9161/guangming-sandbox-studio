import type { SandboxData } from "../../scene/types";
import source from "./coastal-expressway-source.json";

/**
 * S3 海上桥梁被陆地区界反复裁断，不能用直线连接双向车道的最近端点。
 * 只在前海高速构建时，以原始 OSM 曲线恢复已展示范围内的完整主线。
 * 不写 sandbox.json，避免覆盖同时进行的建筑数据重建；不延伸现有展示边界。
 */
export function coastalExpressways(data: SandboxData): SandboxData["roads"] {
  const existing = data.roads.filter(r => r.c === "motorway" && r.n === "广深沿江高速" && !r.l);
  if (!existing.length) return [];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const road of existing)for(let i=0;i<road.p.length;i+=2) {
    minX=Math.min(minX,road.p[i]);maxX=Math.max(maxX,road.p[i]);
    minZ=Math.min(minZ,road.p[i+1]);maxZ=Math.max(maxZ,road.p[i+1]);
  }
  const {origin,k}=data.meta.projection,R=6378137,rad=Math.PI/180;
  const my0=Math.log(Math.tan(Math.PI/4+origin[1]*rad/2));
  const project=([lng,lat]:number[])=>[R*(lng-origin[0])*rad*k,-R*(Math.log(Math.tan(Math.PI/4+lat*rad/2))-my0)*k];
  // Liang–Barsky：裁到现有主线包围盒，不再以海陆多边形切掉海上桥梁。
  const clip=(a:number[],b:number[])=>{
    const dx=b[0]-a[0],dz=b[1]-a[1];let lo=0,hi=1;
    const p=[-dx,dx,-dz,dz],q=[a[0]-minX,maxX-a[0],a[1]-minZ,maxZ-a[1]];
    for(let i=0;i<4;i++) {
      if(Math.abs(p[i])<1e-12){if(q[i]<0)return null;continue;}
      const t=q[i]/p[i];if(p[i]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
      if(lo>hi)return null;
    }
    return [[a[0]+dx*lo,a[1]+dz*lo],[a[0]+dx*hi,a[1]+dz*hi]];
  };
  const roads: SandboxData["roads"]=[];
  for(const road of source.roads) {
    const points=road.p.map(project);let run:number[]=[];
    const flush=()=>{if(run.length>=4)roads.push({c:"motorway",n:"广深沿江高速",b:road.bridge?1:0,l:0,p:run});run=[];};
    for(let i=1;i<points.length;i++) {
      const clipped=clip(points[i-1],points[i]);
      if(!clipped){flush();continue;}
      const [a,b]=clipped;
      if(run.length&&Math.hypot(run[run.length-2]-a[0],run[run.length-1]-a[1])>.1)flush();
      if(!run.length)run.push(...a);run.push(...b);
    }
    flush();
  }
  return roads;
}
