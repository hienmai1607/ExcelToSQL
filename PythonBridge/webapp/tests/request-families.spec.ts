import {test,expect,type Page} from '@playwright/test';
import {requestFamilies} from '../src/request-families';
const rv='AAAAAAAAAAE=';
function fixture(stage='Assigned'){
 const common={RequestID:31668,ItemStage:stage,PICUserID:1,PIC:'Admin',ItemRowVersion:rv,WeightGrams:100,ApplicableNetWeightGrams:100,AnnualUnit:100,ResponseDefaultsInitialized:true,NutDensityDefaultUpdate:false,SameConfig:false,ResponseLayerCount:2,RequestedLayerCount:2,UnitsPerCarton:10};
 return [{...common,ItemID:1,OpportunityItemID:100,ProductCode:'MIX-138',ItemDescription:'Mix parent',IsMixParent:true},{...common,ItemID:2,OpportunityItemID:101,ParentItemID:100,MixChildNumber:1,ProductCode:'PRD-111',ItemDescription:'Natural Almonds 150g'},{...common,ItemID:3,OpportunityItemID:102,ParentItemID:100,MixChildNumber:2,ProductCode:'PRD-112',ItemDescription:'Natural Almonds 450g'},{...common,ItemID:4,OpportunityItemID:200,ProductCode:'PRD-111',ItemDescription:'Standalone 150g'}];
}
async function setup(page:Page,stage='Assigned'){
 const rows=fixture(stage),writes:{path:string;body:any}[]=[];
 await page.route('**/api/**',route=>{
  const request=route.request(),u=new URL(request.url()),p=u.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin'],can_assign_packaging:true,permissions:{requests:'edit'}}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{requests:{editor_page_size:1}},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:31668,RequestNumber:'PCR-31668',ItemCount:2,RequestStatus:'Open'}],total:1}});
  if(p==='/api/packaging/requests'){const size=Number(u.searchParams.get('page_size')||200),page=Number(u.searchParams.get('page')||1);return route.fulfill({json:{rows:rows.slice((page-1)*size,page*size),total:rows.length,page}})}
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'},{ID:2,UserName:'Packaging member'}]}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[],pallets:[]}});
  if(request.method()==='POST'&&(p.endsWith('/assign')||p.endsWith('/transition'))){const body=request.postDataJSON();writes.push({path:p,body});for(const row of rows.slice(0,3)){if(p.endsWith('/assign'))row.PICUserID=body.PICUserID;else row.ItemStage=body.TargetStage;row.ItemRowVersion='AAAAAAAAAAI='}return route.fulfill({json:{result:{ID:1,RowVersion:'AAAAAAAAAAI='},GroupItemIDs:[1,2,3]}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 return {rows,writes};
}
test('membership uses actual parent identity, including duplicate products and shuffled child rows',()=>{
 const rows=fixture(),groups=requestFamilies([rows[2],rows[3],rows[1],rows[0]],r=>r);
 expect(groups.map(g=>g.map(r=>r.ItemID))).toEqual([[4],[1,2,3]]);
});

test('parent primary gross sums child final gross plus parent tare and updates with child edits',async({page})=>{
 const {rows}=await setup(page);
 Object.assign(rows[0],{ProductMixSnapshot:JSON.stringify({items:[{ProductID:11,UnitQuantity:1,WeightGrams:150},{ProductID:12,UnitQuantity:1,WeightGrams:600}]}),MixResponseChildren:JSON.stringify([{ItemID:2,ProductID:11,UnitQuantity:1},{ItemID:3,ProductID:12,UnitQuantity:1}]),ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'5'}})});
 Object.assign(rows[1],{ProductID:11,ApplicableNetWeightGrams:150,WeightGrams:150,ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'16.368'}})});
 Object.assign(rows[2],{ProductID:12,ApplicableNetWeightGrams:600,WeightGrams:600,ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'13.659'}})});
 await page.getByRole('button',{name:'Edit request PCR-31668',exact:true}).click();
 const root=page.getByRole('region',{name:'Request item 1',exact:true});
 await expect(root.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('35,777');
 const child=page.getByRole('region',{name:'Request item 2',exact:true});
 await child.getByLabel('Applicable Net weight (g)',{exact:true}).fill('151');
 await expect(root.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('35,778');
});
test('editor keeps children nested on the parent page and standalone duplicate on its own page',async({page},info)=>{
 await setup(page);
 await page.getByRole('button',{name:'Edit request PCR-31668',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 const family=editor.getByRole('region',{name:'Item group 1',exact:true});
 await expect(family.getByRole('region',{name:'Request item 2',exact:true})).toBeVisible();
 await expect(family.getByRole('region',{name:'Request item 3',exact:true})).toBeVisible();
 await expect(family.getByText('Child 1 of MIX-138',{exact:false})).toBeVisible();
 await expect(editor.getByRole('region',{name:'Request item 4',exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('PIC for item 2',{exact:true})).toHaveCount(0);
 await editor.screenshot({path:info.outputPath('parent-family.png')});
 await editor.getByRole('button',{name:'Next',exact:true}).click();
 await expect(editor.getByRole('region',{name:'Request item 4',exact:true})).toBeVisible();
 await expect(editor.getByRole('region',{name:'Request item 2',exact:true})).toHaveCount(0);
});
for(const action of ['assign','submit','approve'])test('parent '+action+' includes all children but not standalone duplicate',async({page})=>{
 const {rows,writes}=await setup(page,action==='approve'?'Pending Review':'Assigned');
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items',exact:true});
 await expect(table.getByRole('row')).toHaveCount(3);
 expect((await table.locator('.item-review').allTextContents()).join(' ')).not.toContain('Parent +');
 await expect(table.getByLabel('PIC for item 2',{exact:true})).toHaveCount(0);
 if(action==='assign'){await table.getByLabel('PIC for item 1',{exact:true}).selectOption('2');await table.getByRole('button',{name:'Assign PIC for item 1',exact:true}).click()}
 else{await table.getByRole('button',{name:(action==='submit'?'Submit':'Approve')+' 1',exact:true}).click();await page.getByRole('dialog',{name:'Confirm response action'}).getByRole('button',{name:'Confirm',exact:true}).click()}
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0].body.ExpectedGroupVersions).toEqual({'1':rv,'2':rv,'3':rv});
 expect(writes[0].path).toBe('/api/packaging/items/1/'+(action==='assign'?'assign':'transition'));
 expect(rows[3].PICUserID).toBe(1);expect(rows[3].ItemStage).toBe(action==='approve'?'Pending Review':'Assigned');
});
