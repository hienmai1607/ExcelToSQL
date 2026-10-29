import type {Row} from './api';

export function mixPackingWay(quantity:unknown,response:Record<string,unknown>|undefined):string|null{
 const layers=Number(response?.ResponseLayerCount),q=String(quantity??'');
 if(![1,2,3,4].includes(layers)||!/^\d+(?:\.0+)?$/.test(q)||BigInt(q.split('.')[0])<1n)return null;
 const factors=['UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'].slice(0,layers-1).map(key=>String(response?.[key]??''));
 if(factors.some(v=>!/^\d+(?:\.0+)?$/.test(v)||BigInt(v.split('.')[0])<1n))return null;
 const counts=factors.map(v=>BigInt(v.split('.')[0])),units=counts.reduce((a,b)=>a*b,1n),total=BigInt(q.split('.')[0]);
 if(total%units!==0n)return null;
 const packs=total/units;
 // Group the child's complete packing configuration separately from parent usage.
 return '('+[...counts,1n].join('x')+')x'+packs;
}

export function capturedMixQuantity(child:Row,rows:Row[]):string|null{
 if(!child.ParentItemID)return null;
 const parent=rows.find(r=>r.RequestID===child.RequestID&&r.OpportunityItemID===child.ParentItemID);
 try{
  const data=typeof parent?.ProductMixSnapshot==='string'?JSON.parse(parent.ProductMixSnapshot):parent?.ProductMixSnapshot;
  const matches=data?.items?.filter((r:Row)=>String(r.ProductID)===String(child.ProductID));
  if(matches?.length!==1)return null;
  return String(matches[0].UnitQuantity??matches[0].MixUnitQuantity??'');
 }catch{return null}
}

export function mixPackingError(quantity:unknown,values:Record<string,string>):string{
 const factors=['UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'].slice(0,Number(values.ResponseLayerCount||1)-1).map(k=>values[k]);
 if(factors.some(v=>v==null||v===''))return '';
 if(factors.some(v=>!/^\d+$/.test(v)||BigInt(v)<1n))return 'Use positive whole child packing quantities.';
 const q=String(quantity??'');
 if(!/^\d+(?:\.0+)?$/.test(q)||Number(q)<1)return 'The parent needs a valid captured smallest-unit quantity for this child.';
 const units=factors.reduce((n,v)=>n*BigInt(v),1n);
 return BigInt(q.split('.')[0])%units===0n?'':'Child final-package units must be an exact divisor of the parent captured quantity ('+q+').';
}
