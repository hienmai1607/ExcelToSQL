import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const header={ContainerRequest:'20DC',CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityID:1,OpportunityNumber:'OPP-1',CustomerID:1,CustomerName:'Northstar',OpportunityDesc:'Retail',BidOpen:'2026-09-01',BidClose:'2026-10-01',HeaderStage:'Draft',HeaderRowVersion:rv};
// Saved Mix item captured mix version 6: Almonds x2 + Cashews x1.
const rows=[
 {...header,ItemID:21,ProductID:20,ProductCode:'MIX',ProductName:'Gift mix',ItemDescription:'Gift mix',AnnualUnit:100,ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAI=',MixVersionID:6},
 {...header,ItemID:22,ParentItemID:21,ProductID:2,ProductCode:'Almonds',ProductName:'Roasted almonds',ItemDescription:'Roasted almonds',AnnualUnit:200,MixUnitQuantity:'2',ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAM='},
 {...header,ItemID:23,ParentItemID:21,ProductID:3,ProductCode:'Cashews',ProductName:'Cashew pack',ItemDescription:'Cashew pack',AnnualUnit:100,MixUnitQuantity:'1',ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAQ='},
];
// Like the real /api/opportunity/lookups, Products carry no IsMix flag.
const products=[{ID:20,CustomerID:1,ProductCode:'MIX',ProductName:'Gift mix'},{ID:2,CustomerID:1,ProductCode:'Almonds',ProductName:'Roasted almonds'},{ID:3,CustomerID:1,ProductCode:'Cashews',ProductName:'Cashew pack'},{ID:4,CustomerID:1,ProductCode:'Walnuts',ProductName:'Walnut pack'}];
// Product's Active mix is now version 7: Almonds x3 + Walnuts x1.
const mix_children=[{ParentProductID:20,MixVersionID:7,ProductID:2,ProductCode:'Almonds',ProductName:'Roasted almonds',UnitQuantity:3},{ParentProductID:20,MixVersionID:7,ProductID:4,ProductCode:'Walnuts',ProductName:'Walnut pack',UnitQuantity:1}];
async function setup(page:Page,scopes=['Opportunity','Product']){
 const writes:any[]=[],masters:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,scopes,is_admin:false}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows,total:1,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],products,mix_children,pallets:[],packagingTypes:[]}});
  if(path==='/api/workbench/products/20/mix')return route.fulfill({json:{product:{ID:20,CustomerID:1,ProductCode:'MIX',ProductName:'Gift mix',IsMix:true,RowVersion:rv},versions:[{ID:7,Version:2,Status:'Active',RowVersion:rv},{ID:6,Version:1,Status:'Inactive',RowVersion:rv}],items:[{VersionID:7,ProductID:2,UnitQuantity:3,ProductCode:'Almonds',ProductName:'Roasted almonds',WeightGrams:100},{VersionID:7,ProductID:4,UnitQuantity:1,ProductCode:'Walnuts',ProductName:'Walnut pack',WeightGrams:100}],choices:products.filter(p=>p.ID!==20).map(p=>({...p,WeightGrams:100,RowVersion:rv}))}});
  if(path==='/api/inline-masters/products/20'){
   if(route.request().method()==='POST'){masters.push(route.request().postDataJSON());return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:20,NewRowVersion:rv}]}})}
   return route.fulfill({json:{row:{ID:20,ProductCode:'MIX',ProductName:'Gift mix',CustomerID:1,CategoryID:1,IsMix:true,WeightGrams:400,Status:'Active',RowVersion:rv},editable:true,reason:'',lockedFields:['CustomerID']}});
  }
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{customers:[{ID:1,CustomerName:'Northstar',Status:'Active'}],categories:[{ID:1,CategoryName:'Nuts',Status:'Active'}],materials:[],currencies:[],creators:[],uoms:[{ID:9,UoMCode:'g',UoMName:'Grams',Category:'Weight/Mass',BaseFactor:1,Status:'Active'}],
   products:products.filter(x=>x.ID!==20).map(x=>({...x,Status:'Active',WeightGrams:100,RowVersion:rv}))}});
  if(path==='/api/opportunity/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-1'}],item_results:body.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 return {form,writes,masters,item:form.getByRole('region',{name:'Item 1',exact:true})};
}
test('saved Mix item previews and requests an update to the current mix version on save',async({page},info)=>{
 const {form,item,writes}=await setup(page);
 const notice=item.getByRole('status',{name:'Mix version for item 1',exact:true});
 await expect(notice).toContainText('newer Active version');
 await notice.getByRole('button',{name:'Update to current mix version',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'Update to current mix version',exact:true});
 await expect(preview.locator('.mix-update-preview li')).toHaveText(['Almonds Roasted almonds (quantity 2 → 3)','Walnuts Walnut pack × 1','Cashews Cashew pack']);
 await page.screenshot({path:info.outputPath('mix-update-preview.png')});
 await preview.getByRole('button',{name:'Update on save',exact:true}).click();
 await expect(notice).toContainText('will be updated to the current Active version');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 const parent=writes[0].item_rows.find((r:any)=>r.ID===21);
 expect(parent).toMatchObject({Command:'U',RefreshMixVersion:true});
 expect(writes[0].item_rows.filter((r:any)=>r.RefreshMixVersion)).toHaveLength(1);
});
test('a pending mix update can be cancelled and is then not sent',async({page})=>{
 const {item}=await setup(page);
 await item.getByRole('button',{name:'Update to current mix version',exact:true}).click();
 await page.getByRole('dialog',{name:'Update to current mix version',exact:true}).getByRole('button',{name:'Update on save',exact:true}).click();
 await item.getByRole('button',{name:'Cancel update',exact:true}).click();
 await expect(item.getByRole('button',{name:'Update to current mix version',exact:true})).toBeVisible();
});
test('Product users edit the Mix Product in the side popup and save a new mix version',async({page},info)=>{
 const {item,masters}=await setup(page);
 await item.getByRole('button',{name:'Edit Mix Product for item 1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:/Edit product/i});
 await expect(page.getByRole('dialog',{name:'Product grades',exact:true})).toHaveCount(0);
 // Same Product Mix children section as New product, prefilled from the current Active version.
 await editor.getByLabel('Create a new mix version',{exact:true}).check();
 await expect(editor.getByLabel('Child Product 1',{exact:true})).toHaveValue('2');await expect(editor.getByLabel('Child quantity 1',{exact:true})).toHaveValue('3');
 await expect(editor.getByLabel('Child Product 2',{exact:true})).toHaveValue('4');
 await expect(editor.getByRole('button',{name:'New child Product'})).toBeVisible();
 await editor.getByLabel('Child quantity 1',{exact:true}).fill('4');
 await page.screenshot({path:info.outputPath('mix-new-version-edit.png')});
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>masters.length).toBe(1);
 const sent=masters[0].payload.rows[0];
 expect(sent).toMatchObject({Command:'U',ID:20,MixVersion:{Status:'Active',items:[{ProductID:2,UnitQuantity:'4'},{ProductID:4,UnitQuantity:'1'}]}});
});
test('Sales-only users do not get the Mix structure editor',async({page})=>{
 const {item}=await setup(page,['Opportunity']);
 await expect(item.getByRole('button',{name:'Edit Mix Product for item 1',exact:true})).toHaveCount(0);
 await expect(item.getByRole('button',{name:'Update to current mix version',exact:true})).toBeVisible();
});
