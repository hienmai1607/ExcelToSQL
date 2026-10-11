import {test,expect,type Page} from '@playwright/test';
const gradeNames=["Existing","Root","Child A","Child B","Blend A","Blend B","Ingredient A","Detail A","Revised","Component","A","B","A1","B1","Revision","Child","Updated root","Grandchild","Edited blend"];
const gradeID=(name:string)=>gradeNames.indexOf(name)+1;
const gradeParent:Record<string,string>={'A1':'A','B1':'B','Child':'Root','Child A':'Updated root','Child B':'Updated root','Grandchild':'Child A','Ingredient A':'Blend A','Detail A':'Ingredient A','Component':'Revised'};
const rv='AAAAAAAAAAE=';
async function setup(page:Page){
 const writes:any[]=[];
 const product={ID:7,ProductCode:'PRD-0000000007',ProductName:'Almonds',Category:'Nuts',WeightGrams:'100',Status:'Active',RowVersion:rv};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/raw-grade-lookups'))return route.fulfill({json:{rows:gradeNames.map((GradeName,i)=>({ID:i+1,GradeName,ParentGradeID:gradeParent[GradeName]?gradeID(gradeParent[GradeName]):null,MaterialCode:'RAW-1',MaterialName:'Raw nuts'})),materials:[{ID:101,GradeID:gradeID('A1'),MaterialCode:'RAW-101',MaterialName:'Nuts A',Status:'Active'},{ID:102,GradeID:gradeID('A1'),MaterialCode:'RAW-102',MaterialName:'Nuts B',Status:'Active'},{ID:201,GradeID:gradeID('B1'),MaterialCode:'RAW-201',MaterialName:'Other',Status:'Active'}]}});
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:['Product'],is_admin:false}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,masters:{}},version:0}});
  if(p.endsWith('/lookups'))return route.fulfill({json:{categories:[{ID:1,CategoryName:'Nuts',Status:'Active'}],customers:[{ID:1,CustomerName:"Northstar",Status:"Active"}],materials:[],currencies:[],creators:[]}});
  if(p.endsWith('/masters/products'))return route.fulfill({json:{rows:[product],total:1,page:1}});
  if(p==='/api/product/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  if(p.endsWith('/products/7/grades'))return route.fulfill({json:{product,versions:[{ID:3,Version:1,Status:'Active',RowVersion:rv}],items:[{VersionID:3,ParentID:'0',ID:1,Grade:'Existing',RawGradeID:gradeID('Existing'),RatioPct:100}]}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,product};
}
test('new Product has automatic code and nested tree grades persist in the Product draft',async({page})=>{
 const {writes}=await setup(page);
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await expect(form.getByLabel('Product code',{exact:true})).toHaveCount(0);
 await expect(form.getByText('Product code: Assigned on save')).toBeVisible();
 await form.getByLabel('Customer',{exact:true}).selectOption('1');
 await form.getByLabel('Product name',{exact:true}).fill('Blend');
 await form.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await form.getByLabel('Weight',{exact:true}).fill('100');
 await form.getByRole('button',{name:'Grades for record 1'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("A")));
 await grades.getByLabel('Ratio 0/1',{exact:true}).fill('60');
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();
 await grades.getByLabel('Grade 0/2',{exact:true}).selectOption(String(gradeID("B")));
 await grades.getByLabel('Ratio 0/2',{exact:true}).fill('40');
 await grades.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 await grades.getByLabel('Grade 0/1/1',{exact:true}).selectOption(String(gradeID("A1")));
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('90');
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades.getByRole('alert')).toContainText('parent 0/1 must total 100%');
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('100');
 await grades.getByRole('button',{name:'Add child grade to 0/2',exact:true}).click();
 await grades.getByLabel('Grade 0/2/1',{exact:true}).selectOption(String(gradeID("B1")));
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID("A")));
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades).toHaveCount(0);
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].ProductCode).toBeUndefined();
 expect(writes[0].rows[0].GradeVersion.items).toHaveLength(4);
 expect(writes[0].rows[0].GradeVersion.items[3]).toMatchObject({ParentID:'0/2',ID:1,RatioPct:'100'});
});

test('grade toolbar displays compact structural summary',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Grades for product 7',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(dialog.getByLabel('Grade summary')).toContainText('Balanced parents');
 await expect(dialog.getByLabel('Grade summary')).toContainText('1 / 1');
 await page.screenshot({path:'test-results/product-grade-layout.png',fullPage:true});
});
test('active version is immutable; copying supports activation and retains conflicts',async({page})=>{
 await setup(page);let submitted:any;
 await page.route('**/products/7/grades',async route=>{
  if(route.request().method()==='GET')return route.fallback();
  submitted=route.request().postDataJSON();
  return route.fulfill({status:409,json:{detail:'Product or its grade versions changed. Refresh before saving.'}});
 });
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(grades.getByRole('region',{name:'Horizontal grade tree'}).getByRole('textbox')).toHaveCount(0);
 await grades.getByRole('button',{name:'New version',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Revision")));
 await grades.getByRole('combobox',{name:'Grade status'}).selectOption('Active');
 await grades.getByRole('button',{name:'Review & save'}).click();
 const confirm=page.getByRole('dialog',{name:'Confirm grade save'});
 await expect(confirm.getByText('The currently active version will become Inactive.')).toBeVisible();
 await confirm.getByRole('button',{name:'Confirm save'}).click();
 await expect(grades.getByRole('alert')).toContainText('Refresh before saving');
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID("Revision")));
 expect(submitted).toMatchObject({VersionID:null,RowVersion:null,ProductRowVersion:rv,Status:'Active'});
});
test('removing a parent removes descendants with confirmation',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();await grades.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Root")));
 await grades.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();await grades.getByLabel('Grade 0/1/1',{exact:true}).selectOption(String(gradeID("Child")));
 page.once('dialog',dialog=>dialog.accept());
 await grades.getByRole('button',{name:'Remove grade 0/1',exact:true}).click();
 await expect(grades.getByText('No grades yet. Use Add root grade to begin.')).toBeVisible();
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades.getByRole('alert')).toHaveText('Add at least one grade.');
});

test('tree edits descendants and saves the complete structure',async({page})=>{
 const {product}=await setup(page);let submitted:any;
 let items=[
  {VersionID:3,ParentID:'0',ID:1,Grade:'Root',RawGradeID:gradeID('Root'),RatioPct:'100'},
  {VersionID:3,ParentID:'0/1',ID:1,Grade:'Child A',RawGradeID:gradeID('Child A'),RatioPct:'60'},
  {VersionID:3,ParentID:'0/1',ID:2,Grade:'Child B',RawGradeID:gradeID('Child B'),RatioPct:'40'}
 ];
 await page.route('**/products/7/grades',route=>{
  if(route.request().method()==='POST'){
   submitted=route.request().postDataJSON();
   items=submitted.items.map((i:any)=>({...i,VersionID:3}));
   return route.fulfill({json:{ID:3}});
  }
  return route.fulfill({json:{product,versions:[{ID:3,Version:1,Status:'Draft',RowVersion:rv}],items}});
 });
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(grades.getByRole('group',{name:'Grade view',exact:true})).toHaveCount(0);
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toBeVisible();
 await expect(grades.getByLabel('Grade 0/1/1',{exact:true})).toBeVisible();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Updated root")));
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('50');
 await grades.getByRole('button',{name:'Review & save'}).click();
 await expect(grades.getByRole('alert')).toContainText('parent 0/1 must total 100%');
 await grades.getByLabel('Ratio 0/1/2',{exact:true}).fill('50');
 await grades.getByRole('button',{name:'Add child grade to 0/1/1',exact:true}).click();
 await grades.getByLabel('Grade 0/1/1/1',{exact:true}).selectOption(String(gradeID("Grandchild")));
 await expect(grades.getByText('Parent 0/1/1: 100% / 100%',{exact:true})).toBeVisible();
 await expect(grades.getByLabel('Grade 0/1/1/1',{exact:true})).toHaveValue(String(gradeID("Grandchild")));
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID("Updated root")));
 await grades.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('dialog',{name:'Confirm grade save'}).getByRole('button',{name:'Confirm save'}).click();
 await expect.poll(()=>submitted?.items.length).toBe(4);
 expect(submitted.items[0].Grade).toBe('Updated root');
 expect(submitted.items[1].RatioPct).toBe('50');
 await expect(grades.getByLabel('Grade 0/1/1/1',{exact:true})).toHaveValue(String(gradeID("Grandchild")));
});

test('horizontal grade tree connects levels and preserves draft edits',async({page})=>{
 const {product}=await setup(page);
 await page.route('**/products/7/grades',r=>r.fulfill({json:{product,versions:[{ID:3,Version:1,Status:'Draft',RowVersion:rv}],items:[
 {VersionID:3,ParentID:'0',ID:1,Grade:'Blend A',RawGradeID:gradeID('Blend A'),RatioPct:'60'},
 {VersionID:3,ParentID:'0',ID:2,Grade:'Blend B',RawGradeID:gradeID('Blend B'),RatioPct:'40'},
 {VersionID:3,ParentID:'0/1',ID:1,Grade:'Ingredient A',RawGradeID:gradeID('Ingredient A'),RatioPct:'100'},
 {VersionID:3,ParentID:'0/1/1',ID:1,Grade:'Detail A',RawGradeID:gradeID('Detail A'),RatioPct:'100'}
 ]}}));
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await dialog.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Edited blend")));
 const tree=dialog.getByRole('region',{name:'Horizontal grade tree',exact:true});
 await expect(tree.getByLabel('Grade 0/1',{exact:true})).toBeVisible();
 await expect(tree.getByRole('heading',{name:'Level 3',exact:true})).toBeVisible();
 await expect(tree.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID("Edited blend")));
 const parent=await tree.locator('[data-grade-path="0/1"]').boundingBox();
 const child=await tree.locator('[data-grade-path="0/1/1"]').boundingBox();
 const leaf=await tree.locator('[data-grade-path="0/1/1/1"]').boundingBox();
 expect(child!.x).toBeGreaterThan(parent!.x+parent!.width);
 expect(leaf!.x).toBeGreaterThan(child!.x+child!.width);
 const nameBox=await tree.getByLabel('Grade 0/1',{exact:true}).boundingBox();
 const ratioBox=await tree.getByLabel('Ratio 0/1',{exact:true}).boundingBox();
 expect(Math.abs(nameBox!.y-ratioBox!.y)).toBeLessThan(2);
 expect(parent!.height).toBeLessThan(190);
 expect((await dialog.boundingBox())!.width).toBeGreaterThan(1250);
 await page.screenshot({path:'test-results/product-grade-tree.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 const scroll=tree.getByRole('region',{name:'Scrollable grade levels'});
 expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 await expect(dialog.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID("Edited blend")));
});
test('empty grade tree explains how to add grades',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(dialog.getByText('No grades yet. Use Add root grade to begin.')).toBeVisible();
});

test('tree creates nested grades, validates totals and retains them in the product draft',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await dialog.getByRole('button',{name:'Add root grade',exact:true}).click();
 await dialog.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Root")));
 await dialog.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 await dialog.getByLabel('Grade 0/1/1',{exact:true}).selectOption(String(gradeID("Child")));
 await dialog.getByLabel('Ratio 0/1/1',{exact:true}).fill('50');
 await dialog.getByRole('button',{name:'Use grades'}).click();
 await expect(dialog.getByRole('alert')).toContainText('parent 0/1 must total 100%');
 await dialog.getByLabel('Ratio 0/1/1',{exact:true}).fill('100');
 await dialog.getByRole('button',{name:'Use grades'}).click();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 await expect(dialog.getByLabel('Grade 0/1/1',{exact:true})).toHaveValue(String(gradeID("Child")));
 page.once('dialog',d=>d.accept());
 await dialog.getByRole('button',{name:'Remove grade 0/1',exact:true}).click();
 await expect(dialog.getByLabel('Grade 0/1/1',{exact:true})).toHaveCount(0);
 await expect(dialog.getByText('No grades yet. Use Add root grade to begin.')).toBeVisible();
});
test('tree respects active version lock and submits a new edited version',async({page})=>{
 await setup(page);let payload:any;
 await page.route('**/products/7/grades',r=>{
  if(r.request().method()==='GET')return r.fallback();
  payload=r.request().postDataJSON();
  return r.fulfill({status:409,json:{detail:'Version conflict'}});
 });
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(dialog.getByLabel('Grade summary')).toContainText('1 / 1');
 const tree=dialog.getByRole('region',{name:'Horizontal grade tree'});
 await expect(tree.getByRole('textbox')).toHaveCount(0);
 await expect(tree.getByRole('button',{name:'Add root grade'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'New version',exact:true}).click();
 await tree.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID("Revised")));
 await tree.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 await tree.getByLabel('Grade 0/1/1',{exact:true}).selectOption(String(gradeID("Component")));
 await dialog.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Version conflict');
 expect(payload.items).toEqual([{ParentID:'0',ID:1,Grade:'Revised',RawGradeID:gradeID('Revised'),RawMaterialID:null,RatioPct:'100'},{ParentID:'0/1',ID:1,Grade:'Component',RawGradeID:gradeID('Component'),RawMaterialID:null,RatioPct:'100'}]);
 await expect(tree.getByLabel('Grade 0/1/1',{exact:true})).toHaveValue(String(gradeID("Component")));
});

test('child options follow Raw Grade Master parent and reject stale child selections',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await dialog.getByRole('button',{name:'Add root grade',exact:true}).click();
 await dialog.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID('A')));
 await dialog.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 const child=dialog.getByLabel('Grade 0/1/1',{exact:true});
 await expect(child.locator('option[value="'+gradeID('A1')+'"]')).toHaveCount(1);
 await expect(child.locator('option[value="'+gradeID('B1')+'"]')).toHaveCount(0);
 await child.selectOption(String(gradeID('A1')));
 await dialog.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID('B')));
 await expect(child.locator('option[value="'+gradeID('A1')+'"]')).toHaveJSProperty('disabled',true);
 await dialog.getByRole('button',{name:'Use grades'}).click();
 await expect(dialog.getByRole('alert')).toContainText('Each child grade must belong');
 await child.selectOption(String(gradeID('B1')));
 await dialog.getByRole('button',{name:'Use grades'}).click();
 await expect(dialog).toHaveCount(0);
});

test('child grade chooses a linked Raw Material and Raw Pricing follows the choice',async({page})=>{
 const {writes}=await setup(page);
 await page.route('**/products/raw-pricing',route=>route.fulfill({json:{as_of:'2026-09-30',rows:[
  {RawGradeID:gradeID('A1'),MaterialID:101,MaterialCode:'RAW-101',MaterialName:'Nuts A',PricingStatus:'No current price'},
  {RawGradeID:gradeID('A1'),MaterialID:102,MaterialCode:'RAW-102',MaterialName:'Nuts B',PricingStatus:'No current price'}
 ]}}));
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await form.getByLabel('Customer',{exact:true}).selectOption('1');
 await form.getByLabel('Product name',{exact:true}).fill('Material choice');
 await form.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await form.getByLabel('Weight',{exact:true}).fill('100');
 await form.getByRole('button',{name:'Grades for record 1'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade'}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID('A')));
 await grades.getByRole('button',{name:'Add child grade to 0/1'}).click();
 await grades.getByLabel('Grade 0/1/1',{exact:true}).selectOption(String(gradeID('A1')));
 const material=grades.getByLabel('Raw Material 0/1/1',{exact:true});
 await expect(material.locator('option[value="201"]')).toHaveCount(0);
 await material.selectOption('101');
 await grades.getByRole('button',{name:'Raw Pricing',exact:true}).click();
 await expect(grades.getByRole('table')).toContainText('RAW-101');
 await expect(grades.getByRole('table')).not.toContainText('RAW-102');
 await grades.getByRole('button',{name:'Tree',exact:true}).click();
 await expect(material).toHaveValue('101');
 await grades.getByRole('button',{name:'Use grades'}).click();
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].GradeVersion.items[1]).toMatchObject({RawGradeID:gradeID('A1'),RawMaterialID:101});
});

test('Raw Pricing is read only, shows current tiers and preserves the grade draft',async({page})=>{
 await setup(page);const requests:any[]=[];
 await page.route('**/products/raw-pricing',route=>{
  requests.push(route.request().postDataJSON());
  return route.fulfill({json:{as_of:'2026-09-29',rows:[
   {RawGradeID:gradeID('A'),PriceID:1,MaterialCode:'RAW-1',MaterialName:'Nuts',VendorName:'Vendor A',CurrencyCode:'VND',PriceUoM:'KG',QuantityFrom:'0',QuantityTo:'100',UnitPrice:'25000',ExchangeRateToUSD:'25000',UnitUSDPrice:'1',MaterialBaseUoM:'G',ConversionFactor:'1000',BaseUnitUSDPrice:'0.001',PricingStatus:'Current'},
   {RawGradeID:gradeID('A'),PriceID:2,MaterialCode:'RAW-1',MaterialName:'Nuts',VendorName:'Vendor B',CurrencyCode:'USD',PriceUoM:'KG',QuantityFrom:'100',QuantityTo:null,UnitPrice:'0.8',ExchangeRateToUSD:'1',UnitUSDPrice:'0.8',PricingStatus:'Conversion required'}
  ]}});
 });
 await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await dialog.getByRole('button',{name:'Add root grade',exact:true}).click();
 await dialog.getByLabel('Grade 0/1',{exact:true}).selectOption(String(gradeID('A')));
 await dialog.getByRole('button',{name:'Add root grade',exact:true}).click();
 await dialog.getByLabel('Grade 0/2',{exact:true}).selectOption(String(gradeID('Existing')));
 await dialog.getByRole('button',{name:'Raw Pricing',exact:true}).click();
 const treeTab=await dialog.getByRole('button',{name:'Tree',exact:true}).boundingBox();
 const priceTab=await dialog.getByRole('button',{name:'Raw Pricing',exact:true}).boundingBox();
 expect(priceTab!.x-(treeTab!.x+treeTab!.width)).toBeLessThan(20);
 await expect(dialog.getByRole('button',{name:'Refresh prices'}).locator('svg')).toHaveCount(1);
 await expect(dialog.getByRole('table')).not.toContainText('Existing');
 await expect(dialog.getByRole('table')).toContainText('25,000.00 VND');
 await expect(dialog.getByRole('table')).toContainText('25,000 VND / USD');
 await expect(dialog.getByRole('table')).toContainText('Vendor B');
 await expect(dialog.getByRole('table')).toContainText('Conversion required');
 await expect(dialog.getByRole('button',{name:'Use grades'})).toHaveCount(0);
 await expect(dialog.getByRole('region',{name:'Raw Pricing',exact:true}).getByRole('textbox')).toHaveCount(0);
 expect(requests[0]).toEqual({grade_ids:[gradeID('Existing'),gradeID('A')]});
 const beforeRefresh=requests.length;
 await dialog.getByRole('button',{name:'Refresh prices'}).click();
 await expect.poll(()=>requests.length).toBeGreaterThan(beforeRefresh);
 await dialog.getByRole('button',{name:'Tree',exact:true}).click();
 await expect(dialog.getByLabel('Grade 0/1',{exact:true})).toHaveValue(String(gradeID('A')));
 await expect(dialog.getByLabel('Ratio 0/1',{exact:true})).toHaveValue('100');
});
test('Raw Pricing errors do not appear as zero prices',async({page})=>{
 await setup(page);
 await page.route('**/products/raw-pricing',r=>r.fulfill({status:503,json:{detail:'Pricing unavailable'}}));
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await dialog.getByRole('button',{name:'Raw Pricing',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Pricing unavailable');
 await expect(dialog.getByRole('table')).toHaveCount(0);
});
