import {IconButton} from './icons';
import {useEffect,useRef,useState} from 'react';

export type Box3D={x:number;y:number;z:number;length:number;width:number;height:number;color:string};
export function LoadScene({boxes,bounds,label}:{boxes:Box3D[];bounds:{length:number;width:number;height:number};label:string}){
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
  const faces=boxes.slice(0,2500).flatMap(b=>{const p=corners(b);return [[0,1,2,3],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].map((indices,i)=>({points:indices.map(k=>p[k]),depth:indices.reduce((sum,k)=>sum+p[k].depth,0)/4,color:b.color,shade:[.55,.7,.8,.75,.65,1][i]}))}).sort((a,b)=>a.depth-b.depth);
  for(const f of faces){ctx.beginPath();f.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.fillStyle='rgba(0,0,0,'+(1-f.shade)+')';ctx.fill();ctx.strokeStyle='#ffffff66';ctx.lineWidth=.5;ctx.stroke()}
  const p=corners({x:0,y:0,z:0,...bounds,color:''});ctx.strokeStyle='#546d7c';ctx.lineWidth=1.2;
  for(const [a,b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]){ctx.beginPath();ctx.moveTo(p[a].x,p[a].y);ctx.lineTo(p[b].x,p[b].y);ctx.stroke()}
 },[boxes,bounds,view,size]);
 return <div className="load-scene"><canvas ref={canvas} role="img" aria-label={label} onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onPointerMove={e=>{if(!drag.current)return;const dx=e.clientX-drag.current.x,dy=e.clientY-drag.current.y;drag.current={x:e.clientX,y:e.clientY};setView(v=>({...v,yaw:v.yaw+dx*.008,pitch:Math.max(.05,Math.min(1.56,v.pitch+dy*.008))}))}}/>
 <div className="load-view-controls"><IconButton icon="zoomIn" label="Zoom in" onClick={()=>setView(v=>({...v,zoom:Math.min(3,v.zoom*1.2)}))}/><IconButton icon="zoomOut" label="Zoom out" onClick={()=>setView(v=>({...v,zoom:Math.max(.3,v.zoom/1.2)}))}/><IconButton icon="topView" label="Top view" onClick={()=>setView({yaw:0,pitch:1.56,zoom:1})}/><IconButton icon="refresh" label="Reset view" onClick={()=>setView({yaw:-.65,pitch:.65,zoom:1})}/></div><small>Drag to rotate. {boxes.length>2500?'Preview shows the first 2,500 units; totals include all units.':''}</small></div>
}
