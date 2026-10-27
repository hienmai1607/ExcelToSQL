import {call,type Row} from './api';
import {isMixParent,responseOrderFields,layerCount} from './packaging-orders';
import {objectValue} from './packaging-summary-model';
import type {PricingCalculation,PricingResult} from './pkg-pricing';
import {layerTares} from './packaging-weight';

export type ResponseEntry={row:Row;values:Record<string,string>;done:boolean;error:string;pricing:Record<string,PricingCalculation>;pricingResults:Record<string,PricingResult>;copiedDimensions?:Row[string]};
export const sameConfig=(value:unknown)=>value===true||value===1||value==='1'||value==='true';
export const sameConfigFields=['ResponseLayerCount','UnitsPerCarton','UnitsPerTertiary',...responseOrderFields.flatMap(f=>[f.type,f.moq,f.price,f.currency])];
export function mixChildren(root:ResponseEntry,entries:ResponseEntry[]){
 const parentID=root.row.OpportunityItemID,items=objectValue(root.row.ProductMixSnapshot).items;
 const children=entries.filter(e=>Number(e.row.RequestID)===Number(root.row.RequestID)&&Number(e.row.ParentItemID)===Number(parentID));
 if(!Array.isArray(items)||!items.length)return children.sort((a,b)=>Number(a.row.MixChildNumber)-Number(b.row.MixChildNumber)||Number(a.row.ItemID)-Number(b.row.ItemID));
 return items.flatMap(item=>children.filter(e=>String(e.row.ProductID)===String(item.ProductID)));
}
export function sameConfigRoot(entry:ResponseEntry,entries:ResponseEntry[]){return entries.find(root=>isMixParent(root.row)&&sameConfig(root.values.SameConfig)&&Number(root.row.RequestID)===Number(entry.row.RequestID)&&(root===entry||Number(root.row.OpportunityItemID)===Number(entry.row.ParentItemID)))}
export function mixConfigError(root:ResponseEntry,entries:ResponseEntry[],editable:(row:Row)=>boolean){
 const children=mixChildren(root,entries),items=objectValue(root.row.ProductMixSnapshot).items;
 if(!root.row.OpportunityItemID||children.length<2||Array.isArray(items)&&children.length!==items.length||new Set(children.map(e=>e.row.ItemID)).size!==children.length)return 'Same config requires every child response from the captured Mix structure in this request.';
 if([root,...children].some(e=>!editable(e.row)||e.done))return 'Same config requires all child responses and the Mix parent to be editable by you. Approved, canceled or other-PIC items cannot be overwritten.';
 return '';
}
export function synchronizeMixConfigs(entries:ResponseEntry[],rootIDs?:Set<unknown>){
 const copies=new Map<unknown,ResponseEntry>();
 for(const root of entries.filter(e=>isMixParent(e.row)&&sameConfig(e.values.SameConfig)&&(!rootIDs||rootIDs.has(e.row.ItemID)))){
  const children=mixChildren(root,entries),source=children[0];if(!source)continue;
  for(const child of children.slice(1)){
   const values={...child.values};for(const key of sameConfigFields)values[key]=source.values[key]||'';
   const tares=layerTares(source.values.LayerTareJSON);
   for(const [order,result] of Object.entries(source.pricingResults))if(result.Tare&&source.pricing[order]?.Fingerprint===result.Fingerprint)tares[order]=result.Tare;
   values.LayerTareJSON=JSON.stringify(tares);
   // Fingerprints are item-specific. Every copied input must be previewed for its target.
   const pricing=Object.fromEntries(Object.entries(source.pricing).map(([order,input])=>[order,{...structuredClone(input),Fingerprint:undefined}]));
   copies.set(child.row.ItemID,{...child,values,pricing,pricingResults:source.pricingResults,copiedDimensions:source.row.LayerDimensionCaptures,error:''});
  }
 }
 return entries.map(e=>copies.get(e.row.ItemID)??e);
}
export async function loadMixRequest(id:number,sort:string,read:(id:number,page:number,size:number,sort:string)=>Promise<{rows:Row[];total:number}>){
 const rows:Row[]=[];let total=0;
 for(let page=1;page===1||rows.length<total;page++){
  const result=await read(id,page,200,sort);
  if(!Number.isSafeInteger(result.total)||result.total<0||page>1&&total!==result.total||result.rows.length!==Math.min(200,result.total-(page-1)*200)||result.rows.some(row=>Number(row.RequestID)!==id))throw new Error('Mix request changed while loading. Refresh and retry.');
  total=result.total;rows.push(...result.rows);
 }
 if(new Set(rows.map(row=>row.ItemID)).size!==rows.length)throw new Error('Mix request changed while loading. Refresh and retry.');
 return {rows,total};
}
export async function prepareSameConfigGroups(entries:ResponseEntry[],types:Row[],pendingIDs:Set<unknown>,preparePricing:typeof import('./response-pricing').prepareResponsePricing){
 let next=entries;
 for(const root of entries.filter(e=>isMixParent(e.row)&&sameConfig(e.values.SameConfig)&&pendingIDs.has(e.row.ItemID))){
  const children=mixChildren(root,next),source=children[0];if(!source)continue;
  const pricing={...source.pricing};
  for(const field of responseOrderFields.slice(0,layerCount(source.values.ResponseLayerCount))){
   if(pricing[field.order]||!source.values[field.type]||source.values[field.type]!==source.row[field.type]||source.row[field.price]==null)continue;
   const type=types.find(t=>t.ParentTypeID==null&&t.PackagingType===source.values[field.type]);if(!type)continue;
   const options=await call<{saved:Row[]}>('/api/packaging/items/'+source.row.ItemID+'/pricing?packaging_type_id='+type.ID+'&packaging_order='+field.order);
   const saved=options.saved?.find(p=>p.IsCurrent&&Number(p.PackagingTypeID)===Number(type.ID)&&p.PackagingTypeName===source.values[field.type]);
   if(!saved?.InputJSON)throw new Error('The first child has no reusable '+field.order+' pricing inputs. Apply its Pricing Calculator first.');
   pricing[field.order]={...JSON.parse(String(saved.InputJSON)),Fingerprint:undefined};
  }
  next=next.map(e=>e===source?{...e,pricing}:e);
 }
 next=synchronizeMixConfigs(next,pendingIDs);
 const prepared:ResponseEntry[]=[];
 for(const entry of next){
  const root=sameConfigRoot(entry,next);
  if(root&&pendingIDs.has(root.row.ItemID)&&entry.row.ParentItemID){const patch=await preparePricing(entry.row,entry.values,entry.pricing,types);prepared.push({...entry,...patch});}
  else prepared.push(entry);
 }
 return prepared;
}
