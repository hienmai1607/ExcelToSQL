import {test,expect} from '@playwright/test';
import {sameConfigFields,synchronizeMixConfigs,mixChildren,mixConfigError,loadMixRequest,type ResponseEntry} from '../src/mix-same-config';
const entry=(row:any,values:Record<string,string>={}):ResponseEntry=>({row,values,pricing:{},pricingResults:{},done:false,error:''});
const root=entry({ItemID:1,OpportunityItemID:10,RequestID:9,IsMixParent:true,ProductMixSnapshot:JSON.stringify({items:[{ProductID:2},{ProductID:3}]})},{SameConfig:'1'});
const first=entry({ItemID:2,ProductID:2,RequestID:9,ParentItemID:10,WeightGrams:150,LayerDimensionCaptures:'source-dims'},{ResponseLayerCount:'2',FirstPMType:'Film',SecondPMType:'Box',UnitsPerCarton:'12',NutDensity:'.6'});
const second=entry({ItemID:3,ProductID:3,RequestID:9,ParentItemID:10,WeightGrams:450},{ResponseLayerCount:'1',FirstPMType:'Jar',NutDensity:'.8'});
test('copies only packaging; densities, product identities, weights and snapshots stay separate',()=>{
 const [parent,a,b]=synchronizeMixConfigs([root,first,second]);
 expect(parent).toBe(root);expect(a).toBe(first);
 expect(b.values).toMatchObject({ResponseLayerCount:'2',FirstPMType:'Film',SecondPMType:'Box',UnitsPerCarton:'12',NutDensity:'.8'});
 expect(b.row).toBe(second.row);expect(b.row.WeightGrams).toBe(450);expect(b.copiedDimensions).toBe('source-dims');
 expect(sameConfigFields).not.toContain('NutDensity');
});
test('first child follows captured mix order, not grid sorting; other mix groups are untouched',()=>{
 expect(mixChildren(root,[root,second,first]).map(e=>e.row.ItemID)).toEqual([2,3]);
 const other=entry({...second.row,ItemID:99,ParentItemID:20,RequestID:10},second.values);
 expect(synchronizeMixConfigs([root,second,other,first]).find(e=>e.row.ItemID===99)).toBe(other);
 expect(synchronizeMixConfigs([{...root,values:{SameConfig:'0'}},first,second])[2]).toBe(second);
});
test('targeted copying leaves other enabled groups and their errors unchanged',()=>{
 const otherRoot=entry({...root.row,ItemID:10,OpportunityItemID:20},{SameConfig:'1'});
 const otherFirst=entry({...first.row,ItemID:20,ParentItemID:20},first.values);
 const otherSecond={...entry({...second.row,ItemID:30,ParentItemID:20},second.values),error:'Protected group error'};
 const next=synchronizeMixConfigs([root,first,second,otherRoot,otherFirst,otherSecond],new Set([1]));
 expect(next[2].values.FirstPMType).toBe('Film');expect(next[5]).toBe(otherSecond);
});

test('copied calculator inputs do not reuse fingerprints or mutable component arrays',()=>{
 const source={...first,pricing:{Primary:{PackagingOrder:'Primary' as const,LayerCount:2,PackagingTypeID:1,SquareMeterUoMID:null,components:[{PriceID:1,PriceRowVersion:'rv',Quantity:'1',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}],Fingerprint:'first-child'}}};
 const b=synchronizeMixConfigs([root,source,second])[2];
 expect(b.pricing.Primary.Fingerprint).toBeUndefined();expect(b.pricing.Primary.components).toEqual(source.pricing.Primary.components);
 expect(b.pricing.Primary.components).not.toBe(source.pricing.Primary.components);
});
test('missing, duplicate and inaccessible children cannot be silently overwritten',()=>{
 expect(mixConfigError(root,[root,first],()=>true)).toContain('every child');
 expect(mixConfigError(root,[root,first,second],row=>row.ItemID!==3)).toContain('editable');
 expect(mixConfigError(root,[root,first,first],()=>true)).toContain('every child');
 expect(mixConfigError(root,[root,first,second],()=>true)).toBe('');
});
test('request loader reads all pages and rejects changed or unrelated request data',async()=>{
 const rows=[root.row,...Array.from({length:199},(_,i)=>({ItemID:i+100,RequestID:9})),first.row,second.row],pages:number[]=[];
 const result=await loadMixRequest(9,'[]',async(id,page,size)=>{expect(id).toBe(9);expect(size).toBe(200);pages.push(page);return {rows:rows.slice((page-1)*size,page*size),total:rows.length}});
 expect(pages).toEqual([1,2]);expect(result.rows).toHaveLength(202);
 await expect(loadMixRequest(9,'[]',async()=>({rows:[{...root.row,RequestID:99}],total:1}))).rejects.toThrow(/changed/);
});
