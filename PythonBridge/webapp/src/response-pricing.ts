/** Layer-count changes keep drafts; only active, current-context calculations are saved. */
import {call,type Row} from './api';
import {layerCount,responseOrderFields} from './packaging-orders';
import {pricingResponseValues,type PricingCalculation,type PricingResult} from './pkg-pricing';

export function activeResponsePricing(values:Record<string,string>,pricing:Record<string,PricingCalculation>){
 return responseOrderFields.slice(0,layerCount(values.ResponseLayerCount))
  .filter(f=>values[f.type]?.trim()&&pricing[f.order]).map(f=>pricing[f.order]);
}

export async function prepareResponsePricing(row:Row,values:Record<string,string>,pricing:Record<string,PricingCalculation>,types:Row[]){
 const layers=layerCount(values.ResponseLayerCount),changed=layers!==layerCount(row.ResponseLayerCount??row.RequestedLayerCount);
 const nextValues={...values},nextPricing={...pricing},pricingResults:Record<string,PricingResult>={};
 for(const field of responseOrderFields.slice(0,layers)){
  if(!values[field.type]?.trim())continue;
  let input=pricing[field.order];
  // Previously saved active layers are defaults too, not only unsaved calculator inputs.
  if(!input&&changed&&values[field.type]===row[field.type]&&values[field.moq]&&row[field.price]!=null){
   const type=types.find(t=>t.ParentTypeID==null&&t.PackagingType===values[field.type]);
   if(type){
    const data=await call<{saved:Row[]}>('/api/packaging/items/'+row.ItemID+'/pricing?packaging_type_id='+type.ID+'&packaging_order='+field.order);
    const saved=data.saved?.find(s=>s.IsCurrent&&Number(s.PackagingTypeID)===Number(type.ID)&&s.PackagingTypeName===values[field.type]);
    if(saved?.InputJSON)input=JSON.parse(String(saved.InputJSON)) as PricingCalculation;
   }
  }
  if(!input||pricing[field.order]&&input.LayerCount===layers&&input.Fingerprint)continue;
  const updated={...input,LayerCount:layers,Fingerprint:undefined};
  const {calculation}=await call<{calculation:PricingResult}>('/api/packaging/items/'+row.ItemID+'/pricing/preview',updated);
  nextPricing[field.order]={...updated,Fingerprint:calculation.Fingerprint};
  pricingResults[field.order]=calculation;
  Object.assign(nextValues,pricingResponseValues(updated,calculation));
 }
 return {values:nextValues,pricing:nextPricing,pricingResults};
}
