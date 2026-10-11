import { pairs } from '../../scene/types';
import { animation, arrow, areaPolygons, clamp, curve, distance, fallbackPlaces, inPolygons, inside, nearest, partial, place, polygonPath, riverTrunk, smooth, stroke, type HistoryContext, type Pt } from './core';
export type { StoryAnim, HistoryContext } from './core';
export { riverTrunk } from './core';

export function createRiverFlowAnim(ctx:HistoryContext){
 const a=animation(ctx,12),river=riverTrunk(ctx.data),mouth=river[river.length-1];a.anim.group.name='history-river';
 if(mouth)a.label('流向珠江口',[mouth[0]-700,mouth[1]-350],8);
 else a.label('茅洲河主干数据缺失',[0,0],0);
 a.anim.paint=(c,to,s)=>{const t=a.time();c.save();stroke(c,to,river,'#5fa5b8',Math.max(4,170*s));c.setLineDash([150*s,125*s]);c.lineDashOffset=-t*180*s;stroke(c,to,partial(river,t/8),'#f4fbff',Math.max(3,80*s));c.setLineDash([]);if(mouth&&t>8){c.globalAlpha=smooth(t-8);arrow(c,to,[mouth,[mouth[0]-900,mouth[1]+50]],'#3f8aa3',Math.max(3,70*s));}c.restore();};return a.anim;
}

export function createAlluvialPlainAnim(ctx:HistoryContext){
 const a=animation(ctx,14),river=riverTrunk(ctx.data),boundary=pairs(ctx.data.boundary),cells:{p:Pt;d:number;up:number}[]=[];
 const limit=ctx.alluvialHeight??30,step=65;
 for(let x=-7000;x<4000;x+=step)for(let z=-5400;z<5000;z+=step){const p:Pt=[x,z],n=nearest(p,river);if(n.d>2100||!inside(p,boundary))continue;
 // Check every corner as well as the centre: no stamp bleeds onto sampled hills.
 if([[x,z],[x+step/2,z+step/2],[x-step/2,z-step/2],[x+step/2,z-step/2],[x-step/2,z+step/2]].some(q=>ctx.groundAt(q[0],q[1])>limit))continue;
 cells.push({p,d:n.d,up:1-n.along/(n.total||1)});}
 a.anim.group.userData.heightLimit=limit;a.label('河到碗口慢下来，泥沙落成平原',[-1800,-1700],10);
 a.anim.paint=(c,to,s)=>{c.save();for(const cell of cells){const arrive=cell.up*5+cell.d/500;const growth=smooth((a.time()-arrive)/3);if(!growth)continue;const band=.76+.24*Math.cos(cell.d/170-cell.up*4);c.fillStyle=`rgba(222,193,144,${growth*.5*band})`;const p=to(cell.p[0]-step/2,cell.p[1]-step/2),q=to(cell.p[0]+step/2,cell.p[1]+step/2);c.fillRect(Math.round(p[0]),Math.round(p[1]),Math.round(q[0])-Math.round(p[0]),Math.round(q[1])-Math.round(p[1]));}c.restore();};return a.anim;
}

export function createMigrationAnim(ctx:HistoryContext){
 const a=animation(ctx,18),river=riverTrunk(ctx.data),mouth=river[river.length-1]??[-5800,-4000],north:Pt=[-1300,-11000],dongguan:Pt=[3900,-6500];
 const main=[...curve(north,dongguan,900),...curve(dongguan,mouth,1200).slice(1)];
 // The northern origin is intentionally outside the model; label sits at its visible entry.
 a.label('南雄珠玑巷 · 北方来路（示意）',[-1000,-6800],.2);a.label('东莞',[3900,-6100],2);
 const ids=['village-yulu','village-heshuikou','village-loucun','village-dongkeng'];
 const routes=ids.map((id,i)=>{const p=place(ctx,id);const history=p.era&&p.clan?`${p.era} · ${p.clan}`:i===0?'北宋 · 莫氏':'年代待核 · 姓氏待核';a.label(`${history} · ${p.name}${p.temporary?'（坐标待替换）':''}`,[p.p[0],p.p[1]+(i===1?200:0)],7+i*1.7);return {p:p.p,path:curve(mouth,p.p,(i-1.5)*240),start:5+i*1.7};});
 const jing=place(ctx,'village-jingkou'),fujian:Pt=[6800,-4200],jingPath=curve(fujian,jing.p,-500);a.label('福建来路（示意）',[5700,-3900],10);a.label(`${jing.era&&jing.clan?`据记载${jing.era} · ${jing.clan}`:'南宋末 · 黄氏'} · ${jing.name}${jing.temporary?'（坐标待替换）':''}`,jing.p,14);
 a.anim.paint=(c,to,s)=>{c.save();arrow(c,to,partial(main,a.time()/6),'#b9654c',Math.max(4,120*s));for(const r of routes){if(a.time()<=r.start)continue;arrow(c,to,partial(r.path,(a.time()-r.start)/2),'#b9654c',Math.max(3,80*s));const p=to(...r.p);c.globalAlpha=smooth((a.time()-r.start-1.6)/.8);c.fillStyle='#f0b878';c.beginPath();c.arc(...p,230*s,0,Math.PI*2);c.fill();c.globalAlpha=1;}if(a.time()>10)arrow(c,to,partial(jingPath,(a.time()-10)/4),'#7f9a8c',Math.max(3,70*s));c.restore();};return a.anim;
}

export function createWindAnim(ctx:HistoryContext){
 const a=animation(ctx,12);a.label('夏天的南风，从西边的口子吹进来',[-1300,1800],2);
 const paths=Array.from({length:11},(_,i)=>curve(i<6?[-8400,-2100+i*410]:[-7100+(i-6)*650,6700],[-200+i*300,-2800+(i%3)*550],i<6?650:-700));
 a.anim.paint=(c,to,s)=>{c.save();for(const [i,path] of paths.entries()){const progress=clamp(a.time()/3);for(let j=1;j<path.length*progress;j++){const u=j/(path.length-1),wave=.55+.45*Math.sin(u*14-a.time()*2+i);c.globalAlpha=(1-u*.8)*.85*wave*smooth(a.time());stroke(c,to,[path[j-1],path[j]],'#5f9c92',Math.max(2.5,75*s));}const front=(a.time()*.15+i*.09)%1;const index=Math.min(47,Math.floor(front*47));if(front<progress){c.globalAlpha=(1-front)*.8;arrow(c,to,path.slice(index,index+2),'#4f8c83',Math.max(2.5,50*s));}}c.restore();};return a.anim;
}

export function createFloodAnim(ctx:HistoryContext){
 const a=animation(ctx,13),river=riverTrunk(ctx.data);let polygons=areaPolygons(ctx,'area-flood-risk');const temporary=!polygons.length;
 if(temporary)polygons=[[[[-5900,-4550],[-3700,-4200],[-1300,-3500],[-1100,-1700],[-800,400],[-1600,2900],[-2700,4400],[-3700,3700],[-3800,600],[-4000,-2200],[-6200,-3500],[-5900,-4550]]]];
 a.anim.group.userData.temporaryArea=temporary;a.label('到今天，这里仍是最容易被淹的地方',[-2700,-1100],8);if(temporary)a.label('洪涝范围待替换 · 示意，不作风险判定',[-2900,2600],.3);
 const points=polygons.flat(2),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),step=75,cells:{p:Pt;d:number}[]=[];
 for(let x=Math.min(...xs);x<=Math.max(...xs);x+=step)for(let z=Math.min(...zs);z<=Math.max(...zs);z+=step){const p:Pt=[x,z];if(inPolygons(p,polygons))cells.push({p,d:nearest(p,river).d});}
 const max=Math.max(1,...cells.map(v=>v.d));
 a.anim.paint=(c,to,s)=>{c.save();polygonPath(c,to,polygons);c.clip('evenodd');const growth=smooth(a.time()/9);for(const cell of cells){const wave=Math.sin(cell.p[0]/340+cell.p[1]/480+a.time()*1.4)*25;const alpha=clamp((growth*(max+170)-cell.d+wave)/140)*.48;if(!alpha)continue;c.fillStyle=`rgba(137,188,206,${alpha})`;const p=to(cell.p[0]-step/2,cell.p[1]-step/2),q=to(cell.p[0]+step/2,cell.p[1]+step/2);c.fillRect(Math.round(p[0]),Math.round(p[1]),Math.round(q[0])-Math.round(p[0]),Math.round(q[1])-Math.round(p[1]));}if(a.time()>8){c.globalAlpha=.16+.07*Math.sin(a.time()*1.4);polygonPath(c,to,polygons);c.strokeStyle='#81b5c9';c.lineWidth=65*s;c.stroke();}c.restore();};return a.anim;
}

export function createFarmAnim(ctx:HistoryContext){
 const a=animation(ctx,12),river=riverTrunk(ctx.data);let polygons=areaPolygons(ctx,'area-farm-1958');const temporary=!polygons.length;
 // Clip each land-use polygon by the east bank at its own latitude, not a global x cutoff.
 if(temporary)polygons=ctx.data.landuse.filter(l=>['farmland','meadow','orchard'].includes(l.c)).map(l=>[pairs(l.p)]);
 const east=(p:Pt)=>{let riverX=-Infinity;for(let i=1;i<river.length;i++){const u=river[i-1],v=river[i];if((u[1]<=p[1]&&v[1]>=p[1])||(v[1]<=p[1]&&u[1]>=p[1])){const t=(p[1]-u[1])/(v[1]-u[1]||1);riverX=Math.max(riverX,u[0]+t*(v[0]-u[0]));}}return riverX!==-Infinity&&p[0]>riverX;};
 const villages=Object.keys({...fallbackPlaces,...ctx.places}).filter(id=>id.startsWith('village-')).map(id=>place(ctx,id)).filter(v=>inPolygons(v.p,polygons)&&(!temporary||east(v.p)));
 for(const v of villages)a.label(`${v.name}${v.temporary?'（坐标待替换）':''}`,[v.p[0],v.p[1]-330],5);
 if(!villages.length)a.label('范围内村落坐标待替换',[1600,0],5);
 a.label(temporary?'东岸田园 · 1958 年范围待替换':'1958 · 农场与村岛',[1900,2100],1);
 a.anim.group.userData.temporaryArea=temporary;
 a.anim.paint=(c,to,s)=>{c.save();c.globalAlpha=smooth(a.time()/5);polygonPath(c,to,polygons);c.clip('evenodd');
 if(temporary){c.beginPath();for(let z=-6000;z<5500;z+=55){const valid=river.flatMap((u,i)=>{const v=river[i+1];if(!v||(u[1]-z)*(v[1]-z)>0)return [];return [u[0]+(v[0]-u[0])*(z-u[1])/(v[1]-u[1]||1)];});if(!valid.length)continue;const p=to(Math.max(...valid),z),q=to(11000,z+55);c.rect(p[0],p[1],q[0]-p[0],q[1]-p[1]);}c.clip();}
 c.fillStyle='#b5ce98';c.fillRect(0,0,c.canvas.width,c.canvas.height);c.strokeStyle='#72966c66';c.lineWidth=Math.max(1,12*s);for(let x=-20000;x<20000;x+=220)stroke(c,to,[[x,-12000],[x+24000,12000]],'#779c7066',Math.max(1,12*s));
 for(const v of villages){const p=to(...v.p);c.fillStyle='#fffaf0';c.beginPath();c.ellipse(...p,240*s,185*s,.2,0,Math.PI*2);c.fill();}c.restore();};return a.anim;
}
