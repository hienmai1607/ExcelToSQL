/** Render complete loads without allocating one scene object per carton. */
export type Dimensions3D={length:number;width:number;height:number};
export type FloorPosition={x:number;y:number;length:number;width:number};
export type Box3D=FloorPosition&{z:number;height:number;color:string;grid?:{x:number;y:number;z:number};aggregate?:boolean;opacity?:number;cartons?:number};
export type LoadSection={cartons:number;rows:number;acrossMin:number;acrossMax:number;layers:number;fullRows:number;partialCartons:number;envelope:boolean};
export type FloorVisualization={boxes:Box3D[];detailed:LoadSection;grouped:LoadSection;cutMM:number;total:number;error?:string};
type Row={x:number;positions:FloorPosition[];cells:{position:FloorPosition;layers:number}[];cartons:number;full:boolean};
const epsilon=1e-6,near=(a:number,b:number)=>Math.abs(a-b)<epsilon;
const empty=():LoadSection=>({cartons:0,rows:0,acrossMin:0,acrossMax:0,layers:0,fullRows:0,partialCartons:0,envelope:false});

export function floorVisualization(positions:FloorPosition[],count:number,tiers:number,height:number,bounds:Dimensions3D):FloorVisualization{
 const result:FloorVisualization={boxes:[],detailed:empty(),grouped:empty(),cutMM:0,total:count};
 if(count===0)return result;
 const fail=(message:string)=>({...result,error:message});
 if(!Number.isSafeInteger(count)||count<0||!Number.isInteger(tiers)||tiers<1||!Number.isFinite(height)||height<=0||!positions.length)return fail('Complete carton layout and stacking data are required to draw this load.');
 if(tiers*height>bounds.height+epsilon)return fail('The supplied carton layers exceed the container height.');
 if(count>positions.length*tiers)return fail('The supplied layout fits '+positions.length*tiers+' cartons, not '+count+'. Recalculate the proposal.');
 if(positions.some(p=>![p.x,p.y,p.length,p.width].every(Number.isFinite)||p.x<0||p.y<0||p.length<=0||p.width<=0||p.x+p.length>bounds.length+epsilon||p.y+p.width>bounds.width+epsilon))return fail('The supplied carton layout extends outside the container.');

 // Fill complete cross-container depth rows, from the back wall towards doors.
 const sorted=[...positions].sort((a,b)=>a.x-b.x||a.y-b.y),groups:FloorPosition[][]=[];
 for(const p of sorted){const previous=groups[groups.length-1];if(previous&&near(previous[0].x,p.x))previous.push(p);else groups.push([p])}
 const rows:Row[]=[];let left=count;
 for(const group of groups){
  if(!left)break;
  const take=Math.min(left,group.length*tiers),fullLayers=Math.floor(take/group.length),extra=take%group.length;
  rows.push({x:group[0].x,positions:group,cartons:take,full:take===group.length*tiers,cells:group.flatMap((position,i)=>{const layers=fullLayers+(i<extra?1:0);return layers?[{position,layers}]:[]})});
  left-=take;
 }
 const cells=rows.flatMap(row=>row.cells),target=bounds.length/3,cuts:number[]=[];
 let end=0;
 for(const {position:p} of cells){
  if(p.x>=end-epsilon&&end>epsilon)cuts.push(Math.max(end,Math.min(target,p.x)));
  end=Math.max(end,p.x+p.length);
 }
 cuts.push(end);
 const cut=cuts.filter(x=>x>epsilon).reduce((best,x)=>Math.abs(x-target)<Math.abs(best-target)?x:best,end);
 result.cutMM=cut;
 const detailed=rows.filter(row=>row.cells.every(c=>c.position.x+c.position.length<=cut+epsilon)),detailedSet=new Set(detailed),grouped=rows.filter(row=>!detailedSet.has(row));
 const first=sorted[0],across=groups[0].length;
 const regular=groups.every((row,i)=>row.length===across&&near(row[0].x,first.x+i*first.length)&&row.every((p,j)=>near(p.length,first.length)&&near(p.width,first.width)&&near(p.y,first.y+j*first.width)));
 function stats(section:Row[],envelope=false):LoadSection{
  if(!section.length)return empty();
  return {cartons:section.reduce((n,r)=>n+r.cartons,0),rows:section.length,acrossMin:Math.min(...section.map(r=>r.positions.length)),acrossMax:Math.max(...section.map(r=>r.positions.length)),layers:Math.max(...section.flatMap(r=>r.cells.map(c=>c.layers))),fullRows:section.filter(r=>r.full).length,partialCartons:section.filter(r=>!r.full).reduce((n,r)=>n+r.cartons,0),envelope};
 }
 result.detailed=stats(detailed);result.grouped=stats(grouped,!regular||grouped.some(r=>!r.full));
 if(regular){
  for(let i=0;i<detailed.length;){
   const row=detailed[i];
   if(row.full){
    let stop=i+1;while(stop<detailed.length&&detailed[stop].full&&near(detailed[stop].x,detailed[stop-1].x+first.length))stop++;
    const n=stop-i;
    result.boxes.push({x:row.x,y:first.y,z:0,length:n*first.length,width:across*first.width,height:tiers*height,color:'#499d91',grid:{x:n,y:across,z:tiers},cartons:n*across*tiers});i=stop;
   }else{
    const full=Math.floor(row.cartons/across),extra=row.cartons%across;
    if(full)result.boxes.push({x:row.x,y:first.y,z:0,length:first.length,width:across*first.width,height:full*height,color:'#499d91',grid:{x:1,y:across,z:full},cartons:full*across});
    if(extra)result.boxes.push({x:row.x,y:first.y,z:full*height,length:first.length,width:extra*first.width,height,color:'#499d91',grid:{x:1,y:extra,z:1},cartons:extra});
    i++;
   }
  }
 }else{
  for(const row of detailed)for(const {position:p,layers} of row.cells)result.boxes.push({...p,z:0,height:layers*height,color:'#499d91',grid:{x:1,y:1,z:layers},cartons:layers});
 }
 if(grouped.length){
  const rest=grouped.flatMap(row=>row.cells),x=Math.min(...rest.map(c=>c.position.x)),y=Math.min(...rest.map(c=>c.position.y));
  result.boxes.push({x,y,z:0,length:Math.max(...rest.map(c=>c.position.x+c.position.length))-x,width:Math.max(...rest.map(c=>c.position.y+c.position.width))-y,height:Math.max(...rest.map(c=>c.layers))*height,color:'#799eaf',opacity:.38,aggregate:true,cartons:result.grouped.cartons});
 }
 return result;
}

export function sectionDescription(section:LoadSection):string{
 if(!section.cartons)return '0 cartons';
 const format=(n:number)=>n.toLocaleString('en-US');
 if(section.acrossMin===section.acrossMax&&section.fullRows===section.rows)return format(section.rows)+' rows × '+format(section.acrossMax)+' cartons/row/layer × '+format(section.layers)+' layers = '+format(section.cartons)+' cartons';
 const across=section.acrossMin===section.acrossMax?format(section.acrossMax):format(section.acrossMin)+'–'+format(section.acrossMax);
 return format(section.rows)+' rows; '+across+' cartons/row/layer; up to '+format(section.layers)+' layers; '+format(section.cartons)+' cartons'+(section.partialCartons?' ('+format(section.partialCartons)+' in a partial row)':'');
}
