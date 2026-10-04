import {type Row} from './api';
import {sortItems,type OpportunityRule} from './opportunity-view';

// A four-decimal multiplier times an integer, without floating-point rounding.
export function mixAnnualUnits(units:string,quantity:string):string{
 if(!/^\d+$/.test(units)||!/^\d+(\.\d{1,4})?$/.test(quantity))return '';
 const [whole,fraction='']=quantity.split('.');
 const scaled=BigInt(units)*(BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')));
 return (scaled/10000n).toString()+'.'+(scaled%10000n).toString().padStart(4,'0');
}

export function mixItemTree(rows:Row[],sort:OpportunityRule[]):Row[]{
 const roots=sortItems(rows.filter(r=>!r.ParentItemID),sort);
 return roots.flatMap((root,index)=>[
  {...root,ItemNumber:String(index+1)},
  ...rows.filter(r=>Number(r.ParentItemID)===Number(root.ItemID))
   .sort((a,b)=>Number(a.MixChildNumber)-Number(b.MixChildNumber))
   .map(child=>({...child,ItemNumber:(index+1)+'.'+child.MixChildNumber}))
 ]);
}
