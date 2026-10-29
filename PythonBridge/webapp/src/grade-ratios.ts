import type {GradeItem} from './product-grades';

// Balance only this sibling group; never alter another level of the tree.
export function balanceFirstGradeRatio(items:GradeItem[],parent:string):GradeItem[]{
 const siblings=items.filter(i=>i.ParentID===parent).sort((a,b)=>a.ID-b.ID);
 if(!siblings.length)return items;
 let rest=0;
 for(const item of siblings.slice(1)){
  if(!item.RatioPct.trim())continue;
  if(!/^\d{1,3}(\.\d{1,2})?$/.test(item.RatioPct))return items;
  rest+=Math.round(Number(item.RatioPct)*100);
 }
 const ratio=String((10000-rest)/100),first=siblings[0];
 return items.map(i=>i===first?{...i,RatioPct:ratio}:i);
}
