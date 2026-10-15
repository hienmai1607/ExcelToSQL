import type {Row} from './api';
export function requestFamilies<T>(items:T[],row:(item:T)=>Row):T[][]{
 const roots=items.filter(item=>!row(item).ParentItemID),attached=new Set<T>();
 const groups=roots.map(root=>{
  const r=row(root),children=items.filter(item=>row(item).ParentItemID!=null&&String(row(item).RequestID)===String(r.RequestID)&&String(row(item).ParentItemID)===String(r.OpportunityItemID));
  children.sort((a,b)=>Number(row(a).MixChildNumber||0)-Number(row(b).MixChildNumber||0)||Number(row(a).ItemID)-Number(row(b).ItemID));
  attached.add(root);children.forEach(child=>attached.add(child));return [root,...children];
 });
 // Never guess an orphan's parent from a duplicate product code.
 for(const item of items)if(!attached.has(item))groups.push([item]);
 return groups;
}
export const groupVersions=(rows:Row[])=>rows.length>1?{ExpectedGroupVersions:Object.fromEntries(rows.map(r=>[String(r.ItemID),String(r.ItemRowVersion)]))}:{};
