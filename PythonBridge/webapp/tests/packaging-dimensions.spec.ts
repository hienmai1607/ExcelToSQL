import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const area='D1*D2/1000000',volume='D1*D2*D3/1000000000',consumption='(D2*2+25)*D1/1000000';
async function setup(page:Page,{scope='Admin',review=false,conflict=false,child=false}={}){
 const writes:any[]=[],previews:any[]=[];
 const parent={ID:1,RowVersion:rv,PackagingTypeID:1,ParentTypeID:null,PackagingOrder:'Secondary',PackagingType:'RSC',Shipping:true,PriceBasis:'Count',D1:'Length',D2:'Width',D3:'Height',D1UoMID:2,D2UoMID:2,D3UoMID:2,D1Unit:'mm',D2Unit:'mm',D3Unit:'mm',OccupiedM2Formula:review?null:area,OccupiedM3Formula:volume,ConvertFromParentFormula:null,ConvertFromSupplierFormula:null,OccupiedFormulaNeedsReview:review,Status:'Active'};
 const row=child?{...parent,ID:2,PackagingTypeID:2,ParentTypeID:1,RootTypeID:1,ParentDimensionID:1,ParentDimensionRowVersion:rv,PackagingType:'Film',PriceBasis:'Square meter',OccupiedM2Formula:null,OccupiedM3Formula:null,ConvertFromParentFormula:consumption,ConvertFromSupplierFormula:area}:parent;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],page_size:25,dark:false,nav_hidden:false,masters:{}},version:0}});
  if(path==='/api/packaging/dimensions/lookups')return route.fulfill({json:{uoms:[{ID:1,UoMCode:'m',Status:'Active'},{ID:2,UoMCode:'mm',Status:'Active'}],parentDimensions:[parent],packagingTypes:[
   {ID:1,RootTypeID:1,ParentTypeID:null,PackagingType:'RSC',PackagingOrder:'Secondary',Shipping:true,PriceBasis:'Count',Status:'Active'},
   {ID:2,RootTypeID:1,ParentTypeID:1,PackagingType:'Film',PackagingOrder:'Secondary',Shipping:true,PriceBasis:'Square meter',Status:'Active'},
   {ID:3,RootTypeID:3,ParentTypeID:null,PackagingType:'Pillow',PackagingOrder:'Primary',Shipping:false,PriceBasis:'Square meter',Status:'Active'},
   {ID:4,RootTypeID:4,ParentTypeID:null,PackagingType:'Blocked',PackagingOrder:'Primary',Shipping:false,PriceBasis:'Count',Status:'Block'}
  ]}});
  if(path==='/api/packaging/dimensions/preview-formula'){
   const body=route.request().postDataJSON();previews.push(body);
   const fx=body[body.FormulaRole],d1=Number(body.TestD1),d2=Number(body.TestD2),d3=Number(body.TestD3);
   if(fx==='D1/0')return route.fulfill({json:{FormulaRole:body.FormulaRole,Value:null,CalculationStatus:'Formula divides by zero.'}});
   if(fx==='D1**2')return route.fulfill({status:422,json:{detail:'Powers are not supported.'}});
   const value=fx==='1'?1:body.FormulaRole==='OccupiedM3Formula'?d1*d2*d3/1e9:fx===consumption?(d2*2+25)*d1/1e6:d1*d2/1e6;
   return route.fulfill({json:{FormulaRole:body.FormulaRole,Value:String(value),OutputUnit:body.FormulaRole==='OccupiedM3Formula'?'m³':'m²',CalculationStatus:'Ready'}});
  }
  if(path==='/api/packaging/dimensions'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill(conflict?{status:409,json:{detail:'Concurrency conflict. Refresh first.'}}:{json:{row:{ID:row.ID,RowVersion:rv}}})}
   return route.fulfill({json:{rows:[row],total:1,page:1}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Dimension Master',exact:true}).click();
 await expect(page.getByRole('cell',{name:child?'Film':'RSC',exact:true})).toBeVisible();
 return {writes,previews,row};
}
async function edit(page:Page,child=false){
 await page.getByRole('button',{name:'Edit packaging dimension '+(child?2:1),exact:true}).click();
 return page.getByRole('dialog',{name:'Edit packaging dimension',exact:true});
}
async function values(page:Page){
 const dialog=page.getByRole('dialog');
 await dialog.getByText('Test Calculation',{exact:true}).click();
 await dialog.getByLabel('D1 Test value',{exact:true}).fill('200');
 await dialog.getByLabel('D2 Test value',{exact:true}).fill('100');
 await dialog.getByLabel('D3 Test value',{exact:true}).fill('250');
 return dialog;
}

test('Shipping parent exposes only occupied formulas and fixes D3 as Height',async({page})=>{
 const state=await setup(page);const dialog=await edit(page);
 await expect(dialog.getByLabel('Occupied m² fx',{exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Occupied m³ fx',{exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Convert from parent fx',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Convert from supplier fx',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('D3',{exact:true})).toHaveValue('Height');
 await expect(dialog.getByLabel('D3',{exact:true})).toHaveAttribute('readonly','');
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes[0]).toMatchObject({OccupiedM2Formula:area,OccupiedM3Formula:volume,ConvertFromParentFormula:null,ConvertFromSupplierFormula:null});
 expect(state.writes[0]).not.toHaveProperty('SquareMeterFormula');
});
test('Child names and units are editable independently of its Shipping parent',async({page})=>{
 const state=await setup(page,{child:true});const dialog=await edit(page,true);
 await expect(dialog.getByLabel('Occupied m² fx',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Convert from parent fx',{exact:true})).toHaveValue(consumption);
 await expect(dialog.getByLabel('Convert from supplier fx',{exact:true})).toHaveValue(area);
 await expect(dialog.getByLabel('D1',{exact:true})).toBeEditable();
 await expect(dialog.getByLabel('D1 Unit',{exact:true})).toBeEnabled();
 await expect(dialog.getByLabel('D3',{exact:true})).toBeEditable();
 await dialog.getByLabel('D1',{exact:true}).fill('Roll width');
 await dialog.getByLabel('D1 Unit',{exact:true}).selectOption('1');
 await dialog.getByLabel('D2',{exact:true}).fill('');
 await dialog.getByLabel('D3',{exact:true}).fill('');
 await dialog.getByLabel('Convert from supplier fx',{exact:true}).fill('D1');
 await dialog.getByLabel('Parent dimension definition',{exact:true}).selectOption('');
 await dialog.getByLabel('Parent dimension definition',{exact:true}).selectOption('1');
 await expect(dialog.getByLabel('D1',{exact:true})).toHaveValue('Roll width');
 await expect(dialog.getByLabel('D1 Unit',{exact:true})).toHaveValue('1');
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes[0]).toMatchObject({ParentDimensionID:1,ParentDimensionRowVersion:rv,D1:'Roll width',D1UoMID:1,D2:null,D3:null,ConvertFromParentFormula:consumption,ConvertFromSupplierFormula:'D1',OccupiedM2Formula:null,OccupiedM3Formula:null});
});
test('Independent child metadata does not relabel parent preview measurements',async({page})=>{
 const state=await setup(page,{child:true});const dialog=await edit(page,true);
 await dialog.getByLabel('D1',{exact:true}).fill('Roll width');
 await dialog.getByLabel('D1 Unit',{exact:true}).selectOption('1');
 await dialog.getByLabel('D2',{exact:true}).fill('');
 await dialog.getByLabel('D3',{exact:true}).fill('');
 await dialog.getByLabel('Convert from supplier fx',{exact:true}).fill('1');
 await values(page);
 await expect(dialog.getByLabel('D1 Test value',{exact:true}).locator('..')).toContainText('Length (mm)');
 await expect(dialog.getByLabel('D3 Test value',{exact:true}).locator('..')).toContainText('Height (mm)');
 await expect(dialog.getByLabel('Supplier D1 Test value',{exact:true}).locator('..')).toContainText('Roll width (m)');
 await expect(dialog.getByLabel('Supplier D3 Test value',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByLabel('Convert from parent fx result',{exact:true})).toHaveValue('0.045');
 expect(state.previews.find(p=>p.FormulaRole==='ConvertFromParentFormula')).toMatchObject({D1:'Roll width',D1UoMID:1,D3:null,TestD1:'200',TestD2:'100'});
});
test('Nonshipping parent has no formula fields and switching roles clears hidden formulas',async({page})=>{
 const state=await setup(page);const dialog=await edit(page);
 await dialog.getByLabel('Packaging Type',{exact:true}).selectOption('3');
 await expect(dialog.getByLabel('Occupied m² fx',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Convert from parent fx',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes[0]).toMatchObject({OccupiedM2Formula:null,OccupiedM3Formula:null,ConvertFromParentFormula:null,ConvertFromSupplierFormula:null});
});
test('Occupied m2 and m3 preview independently; temporary measurements are never saved',async({page})=>{
 const state=await setup(page);await edit(page);const dialog=await values(page);
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByLabel('Occupied m² fx result',{exact:true})).toHaveValue('0.02');
 await expect(dialog.getByLabel('Occupied m³ fx result',{exact:true})).toHaveValue('0.005');
 expect(state.previews).toHaveLength(2);expect(state.writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 for(const k of ['TestD1','TestD2','TestD3'])expect(state.writes[0]).not.toHaveProperty(k);
});
test('Child previews use parent and supplier measurement sets separately',async({page})=>{
 const state=await setup(page,{child:true});await edit(page,true);const dialog=await values(page);
 await dialog.getByLabel('Supplier D1 Test value',{exact:true}).fill('1000');
 await dialog.getByLabel('Supplier D2 Test value',{exact:true}).fill('500');
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByLabel('Convert from parent fx result',{exact:true})).toHaveValue('0.045');
 await expect(dialog.getByLabel('Convert from supplier fx result',{exact:true})).toHaveValue('0.5');
 expect(state.previews.find(p=>p.FormulaRole==='ConvertFromParentFormula')).toMatchObject({TestD1:'200',TestD2:'100',TestD3:null});
 expect(state.previews.find(p=>p.FormulaRole==='ConvertFromSupplierFormula')).toMatchObject({TestD1:'1000',TestD2:'500',TestD3:null});
});
test('Missing child consumption blocks save and does not inherit occupied area',async({page})=>{
 const state=await setup(page,{child:true});const dialog=await edit(page,true);
 await dialog.getByLabel('Convert from parent fx',{exact:true}).fill('');
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes).toHaveLength(0);
 await dialog.getByLabel('Convert from parent fx',{exact:true}).fill(consumption);
 await dialog.getByLabel('Convert from supplier fx',{exact:true}).fill('');
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes[0].ConvertFromSupplierFormula).toBeNull();
});
test('Constant conversion factors preview without measurements',async({page})=>{
 const state=await setup(page,{child:true});const dialog=await edit(page,true);
 await dialog.getByLabel('Convert from parent fx',{exact:true}).fill('1');
 await dialog.getByLabel('Convert from supplier fx',{exact:true}).fill('1');
 await dialog.getByText('Test Calculation',{exact:true}).click();
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByLabel('Convert from parent fx result',{exact:true})).toHaveValue('1');
 expect(state.previews).toHaveLength(2);
});
test('Migrated occupied footprint remains blank until reviewed, never relabels cut area',async({page})=>{
 const state=await setup(page,{review:true});const dialog=await edit(page);
 await expect(dialog.getByLabel('Occupied m² fx',{exact:true})).toHaveValue('');
 await expect(dialog.getByRole('button',{name:'Save dimension',exact:true})).toBeDisabled();
 await dialog.getByLabel('Occupied m² fx',{exact:true}).fill(area);
 await dialog.getByRole('checkbox').check();
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 expect(state.writes[0]).toMatchObject({FormulaReviewed:true,OccupiedM2Formula:area});
});
test('Formula errors do not persist test inputs',async({page})=>{
 const state=await setup(page);const dialog=await edit(page);await values(page);
 await dialog.getByLabel('Occupied m² fx',{exact:true}).fill('D1/0');
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByText('Formula divides by zero.',{exact:true})).toBeVisible();
 expect(state.writes).toHaveLength(0);
 await dialog.getByLabel('Occupied m² fx',{exact:true}).fill('D1**2');
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByText('Powers are not supported.',{exact:true})).toBeVisible();
});
test('Read-only formula preview permits calculation and Close without writes',async({page})=>{
 const state=await setup(page,{scope:'PackagingManager'});
 await page.getByRole('button',{name:'Test calculation for packaging dimension 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Test packaging dimension',exact:true});
 await expect(dialog.getByLabel('Occupied m² fx',{exact:true})).toBeDisabled();
 await dialog.getByLabel('D1 Test value',{exact:true}).fill('200');
 await dialog.getByLabel('D2 Test value',{exact:true}).fill('100');
 await dialog.getByLabel('D3 Test value',{exact:true}).fill('250');
 await dialog.getByRole('button',{name:'Test calculation',exact:true}).click();
 await expect(dialog.getByLabel('Occupied m² fx result',{exact:true})).toHaveValue('0.02');
 await dialog.getByRole('button',{name:'Close dimension editor',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('Child editor fits mobile and keeps both conversion formulas accessible',async({page})=>{
 await setup(page,{child:true});const dialog=await edit(page,true);
 await page.setViewportSize({width:390,height:844});
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBeTruthy();
 await expect(dialog.getByLabel('Convert from supplier fx',{exact:true})).toBeVisible();
});
test('Concurrency conflict leaves draft open without automatic retries',async({page})=>{
 const state=await setup(page,{conflict:true});const dialog=await edit(page);
 await dialog.getByRole('button',{name:'Save dimension',exact:true}).click();
 await expect(dialog.getByText('Concurrency conflict. Refresh first.',{exact:true})).toBeVisible();
 expect(state.writes).toHaveLength(1);await expect(dialog).toBeVisible();
});
