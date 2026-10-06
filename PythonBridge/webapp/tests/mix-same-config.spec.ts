import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const root={RequestID:9,ItemID:1,OpportunityItemID:10,ProductID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',ItemStage:'Assigned',PIC:'Admin',ItemRowVersion:rv,IsMixParent:true,SameConfig:false,ResponseDefaultsInitialized:true,ResponseLayerCount:1,RequestedLayerCount:1,WeightGrams:750,ConfigurationRequest:'Floor load',ContainerRequest:'Dry',FirstPMType:'Carton',NutDensity:null,
 ProductMixSnapshot:JSON.stringify({items:[{ProductID:2,ProductCode:'PRD-A',UnitQuantity:2},{ProductID:3,ProductCode:'PRD-B',UnitQuantity:1}]})};
const child=(id:number,weight:number)=>({RequestID:9,ItemID:id,OpportunityItemID:10+id,ParentItemID:10,ProductID:id,MixChildNumber:id-1,ProductCode:id===2?'PRD-A':'PRD-B',ProductName:'Child '+id,ItemStage:'Assigned',PIC:'Admin',ItemRowVersion:rv,WeightGrams:weight,ResponseDefaultsInitialized:true,ResponseLayerCount:1,RequestedLayerCount:1,FirstPMType:id===2?'Film':'Jar',FirstPMMOQ:1000,PrimaryPricePerUnit:'.6',PrimaryPriceCurrencyCode:'USD',NutDensity:id===2?'.6':'.8',UnitsPerCarton:12,LayerDimensionCaptures:{Primary:{PackagingTypeName:id===2?'Film':'Jar',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'100'},{Name:'Width',Unit:'mm',Value:'80'}]}}});
const input={PackagingOrder:'Primary',LayerCount:1,PackagingTypeID:11,DimensionID:5,DimensionRowVersion:rv,D1:'100',D2:'80',D3:null,SquareMeterUoMID:8,components:[],Fingerprint:'source-only'};
async function setup(page:Page,options:{size?:number;saved?:boolean;blocked?:boolean;conflict?:boolean;reverse?:boolean}={}){
 const rows:any[]=[{...root,SameConfig:!!options.saved},child(2,150),{...child(3,450),...(options.saved?{FirstPMType:'Film'}:{}),...(options.blocked?{ItemStage:'Approved'}:{})}];
 if(options.reverse)rows.reverse();
 const writes:any[]=[],previews:any[]=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{requests:{editor_page_size:options.size??25}},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:9,RequestNumber:'PCR-MIX',OpportunityNumber:'OPP-MIX',RequestStatus:'Open',ItemCount:3}],total:1}});
  if(path==='/api/packaging/requests'){const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('page_size')||25);return route.fulfill({json:{rows:rows.slice((page-1)*size,page*size),total:rows.length,page}})}
  if(path==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[{ID:11,PackagingOrder:'Primary',PackagingType:'Film',Shipping:false},{ID:12,PackagingOrder:'Primary',PackagingType:'Jar',Shipping:false},{ID:13,PackagingOrder:'Secondary',PackagingType:'Carton',Shipping:true}]}});
  if(path.endsWith('/pricing/preview')){
   const data=route.request().postDataJSON(),id=Number(path.split('/')[4]);previews.push({id,data});
   return route.fulfill({json:{calculation:{FinalMOQ:'1000',UnitPrice:'.6',CurrencyCode:'USD',UnitUSDPrice:'.6',Fingerprint:'fp-'+id,ParentDimension:{ID:5,RowVersion:rv,D1Name:'Length',D2Name:'Width',D1Unit:'mm',D2Unit:'mm'},components:[]}}});
  }
  if(path.endsWith('/pricing'))return route.fulfill({json:{saved:[{IsCurrent:true,PackagingTypeID:11,PackagingTypeName:'Film',InputJSON:JSON.stringify(input)}]}});
  if(path==='/api/packaging/response/batch'){
   const data=route.request().postDataJSON();writes.push(data);
   if(!options.conflict)for(const saved of data.rows)Object.assign(rows.find(r=>r.ItemID===saved.ID),saved,{ItemRowVersion:'AAAAAAAAAAI='});
   return route.fulfill({json:{results:data.rows.map((r:any)=>({RowNum:r.RowNum,Status:options.conflict?'ERROR':'OK',Message:options.conflict?'Conflict: refresh required.':undefined}))}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-MIX',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 return {editor,writes,previews,rows,item:(id:number)=>editor.getByRole('region',{name:'Request item '+id,exact:true})};
}
test('toggle appears only on Mix parent; copied packaging is read-only while density and weights remain independent',async({page},info)=>{
 const {editor,item,writes}=await setup(page);
 await expect(editor.getByRole('switch',{name:'Same config',exact:true})).toHaveCount(1);
 const toggle=item(1).locator('.same-config-toggle'),help='Copy the first child’s packaging settings to the other children. Density stays separate.';
 const helpIcon=toggle.getByRole('note',{name:help,exact:true});
 await expect(helpIcon).toHaveCount(1);await expect(toggle.locator('small')).toHaveCount(0);
 await expect(toggle.locator('.field-label')).toContainText('Same config');
 await helpIcon.focus();await expect(helpIcon).toBeFocused();
 expect(await helpIcon.evaluate(node=>getComputedStyle(node,'::after').content)).toContain('Density stays separate');
 await toggle.getByText('Same config',{exact:true}).click();
 await expect(toggle.getByRole('switch',{name:'Same config',exact:true})).toBeChecked();
 await toggle.getByRole('switch',{name:'Same config',exact:true}).uncheck();
 await item(1).getByRole('switch',{name:'Same config',exact:true}).check();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Film');
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeDisabled();
 const copiedHelp=item(3).getByRole('note',{name:'Packaging settings copied from PRD-A. Nut Density remains independent.',exact:true});
 await expect(copiedHelp).toHaveCount(1);
 await expect(copiedHelp.locator('..')).toContainText('Confirmed packaging layers');
 await expect(editor.locator('.same-config-note')).toHaveCount(0);
 await expect(item(2).getByLabel('Primary Type',{exact:true})).toBeEnabled();
 await expect(item(3).getByLabel('Nut Density (g/ml)',{exact:true})).toBeEnabled();
 await expect(item(3).getByLabel('Nut Density (g/ml)',{exact:true})).toHaveValue('.8');
 await item(3).getByLabel('Nut Density (g/ml)',{exact:true}).fill('.9');
 await expect(item(2).getByLabel('Nut Density (g/ml)',{exact:true})).toHaveValue('.6');
 await expect(item(3).getByText('Net weight: 450 g',{exact:false})).toBeVisible();
 await item(2).getByLabel('Primary Type',{exact:true}).selectOption('Jar');
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Jar');
 await item(1).getByRole('switch',{name:'Same config',exact:true}).uncheck();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeEnabled();
 await item(2).getByLabel('Primary Type',{exact:true}).selectOption('Film');
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Jar');
 await editor.screenshot({path:info.outputPath('same-config-desktop.png')});
 expect(writes).toEqual([]);
});
test('saved toggle, copied dimensions and child density survive one atomic group save',async({page})=>{
 const {editor,item,writes,previews}=await setup(page);
 await item(1).getByRole('switch',{name:'Same config',exact:true}).check();
 await expect(item(3).getByLabel('Primary captured dimensions',{exact:true})).toContainText('100mm × 80mm');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm request save',exact:true}).getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('3 item(s) saved');
 expect(writes).toHaveLength(1);expect(writes[0].rows.map((r:any)=>r.ID)).toEqual([1,2,3]);
 expect(writes[0].rows[0].SameConfig).toBe(true);
 expect(writes[0].rows[1].NutDensity).toBe('.6');expect(writes[0].rows[2].NutDensity).toBe('.8');
 for(const id of [2,3]){
  expect(previews.some(p=>p.id===id&&p.data.Fingerprint===undefined)).toBe(true);
  const saved=writes[0].rows.find((r:any)=>r.ID===id);
  expect(saved.PricingCalculations[0].Fingerprint).toBe('fp-'+id);
  expect(saved.PricingCalculations[0].D1).toBe('100');
  expect(saved.ResponsePalletSize).toBeUndefined();
 }
 await expect(item(1).getByRole('switch',{name:'Same config',exact:true})).toBeChecked();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeDisabled();
});
test('first child comes from captured mix order even if display sorting reverses the rows',async({page})=>{
 const {item}=await setup(page,{reverse:true});
 await item(1).getByRole('switch',{name:'Same config',exact:true}).check();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Film');
 await expect(item(2).getByLabel('Primary Type',{exact:true})).toBeEnabled();
});
test('paging keeps the first-child draft and shows copied siblings on later pages',async({page})=>{
 const {editor,item}=await setup(page,{size:1});
 await item(1).getByRole('switch',{name:'Same config',exact:true}).check();
 await editor.getByRole('button',{name:'Next',exact:true}).click();
 await item(2).getByLabel('Primary Type',{exact:true}).selectOption('Jar');
 await editor.getByRole('button',{name:'Next',exact:true}).click();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Jar');
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Previous',exact:true}).click();
 await expect(item(2).getByLabel('Primary Type',{exact:true})).toHaveValue('Jar');
});
test('saved Same config is restored; disabling retains values and unlocks independent packaging edits',async({page})=>{
 const {item}=await setup(page,{saved:true});
 await expect(item(1).getByRole('switch',{name:'Same config',exact:true})).toBeChecked();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeDisabled();
 await item(1).getByRole('switch',{name:'Same config',exact:true}).uncheck();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toBeEnabled();
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Film');
});
test('locked children cannot be overwritten by enabling Same config',async({page})=>{
 const {editor,item,writes}=await setup(page,{blocked:true});
 await item(1).getByRole('switch',{name:'Same config',exact:true}).click();
 await expect(item(1).getByRole('switch',{name:'Same config',exact:true})).not.toBeChecked();
 await expect(editor.getByRole('alert')).toContainText('editable');
 await expect(item(3).getByLabel('Primary Type',{exact:true})).toHaveValue('Jar');
 expect(writes).toEqual([]);
});
test('group conflict keeps all drafts and never reports a partially saved child',async({page})=>{
 const {editor,item,writes}=await setup(page,{conflict:true});
 await item(1).getByRole('switch',{name:'Same config',exact:true}).check();
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm request save',exact:true}).getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('0 item(s) saved');
 await expect(item(2).getByRole('alert')).toContainText('Conflict');
 await expect(item(3).getByRole('alert')).toContainText('Conflict');
 expect(writes).toHaveLength(1);
});
