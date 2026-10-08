import type {Row} from './api';
// Review one top-level product and its descendants, including collapsed grid rows.
export function tcbReviewItems(rows:Row[],rootID:number){
 const root=rows.find(r=>Number(r.ItemID)===rootID);
 if(!root||root.ParentItemID)return [];
 const included=new Set<number>([rootID]);
 let added=true;
 while(added){added=false;for(const row of rows)if(row.ParentItemID&&included.has(Number(row.ParentItemID))&&!included.has(Number(row.ItemID))){included.add(Number(row.ItemID));added=true}}
 return rows.filter(row=>included.has(Number(row.ItemID)));
}
