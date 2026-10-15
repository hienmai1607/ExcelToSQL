type Tare={KG:string|null;Missing?:string[]};
export function layerTares(value:unknown):Record<string,Tare|undefined>{
 try{const parsed=typeof value==='string'?JSON.parse(value||'{}'):value;if(Array.isArray(parsed))return Object.fromEntries(parsed.map(x=>[x.PackagingOrder,x.Tare]));return parsed||{}}catch{return {}}
}

export function mixContentsGross(snapshot:unknown,responses:unknown):number|null{
 try{
  const structure=typeof snapshot==='string'?JSON.parse(snapshot):snapshot;
  const children=typeof responses==='string'?JSON.parse(responses):responses;
  if(!Array.isArray(children)||!children.length)return null;
  const quantities=structure?.items?new Map<string,number>(structure.items.map((c:any)=>[String(c.ProductID),Number(c.UnitQuantity??c.MixUnitQuantity)])):null;
  const seen=new Set<string>();let total=0;
  for(const c of children){
   const key=String(c.ProductID),q=quantities?quantities.get(key):Number(c.UnitQuantity);
   if(seen.has(key)||!q||!Number.isFinite(q)||q<=0)return null;seen.add(key);
   const layers=Number(c.ResponseLayerCount||c.RequestedLayerCount||2);
   const gross='CartonGrossWeightKG' in c?c.CartonGrossWeightKG:packagingGross(String(c.ApplicableNetWeightGrams??c.WeightGrams??''),c,layers,layerTares(c.LayerTareJSON))[['Primary','Secondary','Tertiary'][layers-1]];
   if(gross==null||gross===''||!Number.isFinite(Number(gross)))return null;
   total+=Number(gross)*q;
  }
  return quantities&&seen.size!==quantities.size?null:total;
 }catch{return null}
}
export function packagingGross(netGrams:string,values:Record<string,string>,layers:number,tares:Record<string,Tare|undefined>,contentsKG?:number|null){
 let previous=contentsKG!==undefined?contentsKG:netGrams!==''&&Number.isFinite(Number(netGrams))?Number(netGrams)/1000:null;
 const gross:Record<string,number|null>={};
 for(const [index,order] of ['Primary','Secondary','Tertiary'].slice(0,layers).entries()){
  const own=tares[order]?.KG,count=values[index===1?'UnitsPerCarton':'UnitsPerTertiary'];
  if(index>0)previous=previous!==null&&count&&Number(count)>0?previous*Number(count):null;
  previous=previous!==null&&own!==undefined&&own!==null?previous+Number(own):null;
  gross[order]=previous;
 }
 return gross;
}
