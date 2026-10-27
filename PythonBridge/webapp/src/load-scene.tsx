import {IconButton} from './icons';
import {useEffect,useRef,useState} from 'react';
import type {Box3D} from './load-visualization';
export type {Box3D} from './load-visualization';

export function LoadScene({boxes,bounds,label,loadingDirection=false}:{boxes:Box3D[];bounds:{length:number;width:number;height:number};label:string;loadingDirection?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),drag=useRef<{x:number;y:number}|null>(null);
 const [view,setView]=useState({yaw:-.65,pitch:.65,zoom:1}),[size,setSize]=useState({w:700,h:430});
 useEffect(()=>{const node=canvas.current!;const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setSize({w:r.width,h:r.height})});observer.observe(node);return()=>observer.disconnect()},[]);
 useEffect(()=>{
  const node=canvas.current!,ctx=node.getContext('2d');if(!ctx)return;
  const dpr=Math.min(window.devicePixelRatio||1,2);node.width=size.w*dpr;node.height=size.h*dpr;ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,size.w,size.h);
  const {length:L,width:W,height:H}=bounds;
  const projectedWidth=Math.abs(L*Math.cos(view.yaw))+Math.abs(W*Math.sin(view.yaw));
  const projectedHeight=Math.abs(L*Math.sin(view.yaw)*Math.sin(view.pitch))+Math.abs(W*Math.cos(view.yaw)*Math.sin(view.pitch))+H*Math.cos(view.pitch);
  const scale=Math.min((size.w-64)/Math.max(1,projectedWidth),(size.h-64)/Math.max(1,projectedHeight))*view.zoom;
  function point(x:number,y:number,z:number){x-=L/2;y-=W/2;z-=H/2;const a=x*Math.cos(view.yaw)-y*Math.sin(view.yaw),b=x*Math.sin(view.yaw)+y*Math.cos(view.yaw);return {x:size.w/2+a*scale,y:size.h/2+(b*Math.sin(view.pitch)-z*Math.cos(view.pitch))*scale,depth:b*Math.cos(view.pitch)+z*Math.sin(view.pitch)}}
  const corners=(b:Box3D)=>[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(([x,y,z])=>point(b.x+x*b.length,b.y+y*b.width,b.z+z*b.height));
  const axes:[keyof NonNullable<Box3D['grid']>,keyof NonNullable<Box3D['grid']>][]=[['x','y'],['x','z'],['y','z'],['x','z'],['y','z'],['x','y']];
  const faces=boxes.flatMap(b=>{const p=corners(b);return [[0,1,2,3],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].map((indices,i)=>({points:indices.map(k=>p[k]),depth:indices.reduce((sum,k)=>sum+p[k].depth,0)/4,color:b.color,opacity:b.opacity??1,aggregate:!!b.aggregate,u:b.grid?.[axes[i][0]]??1,v:b.grid?.[axes[i][1]]??1,shade:[.55,.7,.8,.75,.65,1][i]}))}).sort((a,b)=>a.depth-b.depth);
  const between=(a:{x:number;y:number},b:{x:number;y:number},t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  for(const f of faces){
   ctx.globalAlpha=f.opacity;ctx.beginPath();f.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.fillStyle='rgba(0,0,0,'+(1-f.shade)+')';ctx.fill();ctx.strokeStyle=f.aggregate?'#36576b':'#ffffff99';ctx.lineWidth=f.aggregate?1:.5;ctx.stroke();
   if(!f.aggregate){
    for(const [n,a,b,c,d] of [[f.u,0,1,3,2],[f.v,0,3,1,2]]){
     const span=Math.hypot(f.points[a].x-f.points[b].x,f.points[a].y-f.points[b].y),step=Math.max(1,Math.ceil(n/Math.max(1,span/2)));
     for(let j=step;j<n;j+=step){const from=between(f.points[a],f.points[b],j/n),to=between(f.points[c],f.points[d],j/n);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke()}
    }
   }
  }
  ctx.globalAlpha=1;
  const p=corners({x:0,y:0,z:0,...bounds,color:''});ctx.strokeStyle='#546d7c';ctx.lineWidth=1.2;
  for(const [a,b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]){ctx.beginPath();ctx.moveTo(p[a].x,p[a].y);ctx.lineTo(p[b].x,p[b].y);ctx.stroke()}
  if(loadingDirection){
   const badge=(text:string,x:number,y:number,z:number,color='#284a56')=>{const position=point(x,y,z);ctx.font='11px system-ui';const width=ctx.measureText(text).width+10,left=Math.max(4,Math.min(size.w-width-4,position.x-width/2)),top=Math.max(3,Math.min(size.h-20,position.y-19));ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(left,top,width,17);ctx.fillStyle=color;ctx.fillText(text,left+5,top+12)};
   badge('Back wall',0,W/2,H);badge('Doors',L,W/2,H);
   for(const aggregate of [false,true]){
    const group=boxes.filter(b=>!!b.aggregate===aggregate);if(!group.length)continue;
    const x=Math.min(...group.map(b=>b.x)),end=Math.max(...group.map(b=>b.x+b.length)),y=Math.min(...group.map(b=>b.y)),side=Math.max(...group.map(b=>b.y+b.width)),top=Math.max(...group.map(b=>b.z+b.height)),count=group.reduce((n,b)=>n+(b.cartons??0),0);
    badge((aggregate?'Grouped: ':'Detailed: ')+count.toLocaleString('en-US'),(x+end)/2,(y+side)/2,top,aggregate?'#36576b':'#176252');
   }
  }
 },[boxes,bounds,view,size,loadingDirection]);
 return <div className="load-scene"><canvas ref={canvas} role="img" aria-label={label} onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;drag.current={x:e.clientX,y:e.clientY};setView(v=>({...v,yaw:v.yaw+dx*.008,pitch:Math.max(.05,Math.min(1.56,v.pitch+dy*.008))}))}}/>
 <div className="load-view-controls"><IconButton icon="zoomIn" label="Zoom in" onClick={()=>setView(v=>({...v,zoom:Math.min(3,v.zoom*1.2)}))}/><IconButton icon="zoomOut" label="Zoom out" onClick={()=>setView(v=>({...v,zoom:Math.max(.3,v.zoom/1.2)}))}/><IconButton icon="topView" label="Top view" onClick={()=>setView({yaw:0,pitch:1.56,zoom:1})}/><IconButton icon="refresh" label="Reset view" onClick={()=>setView({yaw:-.65,pitch:.65,zoom:1})}/></div><small>Drag to rotate.</small></div>
}
