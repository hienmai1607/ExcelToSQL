import type {Row} from './api';

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
