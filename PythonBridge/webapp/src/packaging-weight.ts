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
   const gross='CartonGrossWeightKG' in c?c.CartonGrossWeightKG:packagingGross(String(c.ApplicableNetWeightGrams??c.WeightGrams??''),c,layers,layerTares(c.LayerTareJSON))[['Primary','Secondary','Tertiary','Quaternary'][layers-1]];
   if(gross==null||gross===''||!Number.isFinite(Number(gross))||Number(gross)<0)return null;
   // Product Mix quantities refer to the smallest child units. The read API
   // supplies final-carton gross, so allocate its packaging on that unit basis.
   const unitLayers=Number(c.ResponseLayerCount||c.RequestedLayerCount||1);
   if(![1,2,3,4].includes(unitLayers))return null;
   let units=1;
   for(const field of ['UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'].slice(0,unitLayers-1)){
    const factor=Number(c[field]);
    if(!Number.isInteger(factor)||factor<1||factor>2147483647)return null;
    units*=factor;
   }
   total+=Number(gross)*q/units;
  }
  return quantities&&seen.size!==quantities.size?null:total;
 }catch{return null}
}
export function packagingGross(netGrams:string,values:Record<string,string>,layers:number,tares:Record<string,Tare|undefined>,contentsKG?:number|null){
 let previous=contentsKG!==undefined?contentsKG:netGrams!==''&&Number.isFinite(Number(netGrams))?Number(netGrams)/1000:null;
 const gross:Record<string,number|null>={};
 for(const [index,order] of ['Primary','Secondary','Tertiary','Quaternary'].slice(0,layers).entries()){
  const own=tares[order]?.KG,count=values[index===1?'UnitsPerCarton':index===2?'UnitsPerTertiary':'UnitsPerQuaternary'];
  if(index>0)previous=previous!==null&&count&&Number(count)>0?previous*Number(count):null;
  previous=previous!==null&&own!==undefined&&own!==null?previous+Number(own):null;
  gross[order]=previous;
 }
 return gross;
}
