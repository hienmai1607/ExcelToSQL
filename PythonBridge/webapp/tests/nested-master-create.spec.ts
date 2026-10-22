import {test,expect,type Page,type Locator} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,session:Record<string,unknown>={username:'Tester',user_id:1,is_admin:true,scopes:['Admin']}){
 const writes:{path:string;body:any}[]=[];
 const customers:any[]=[{ID:1,CustomerName:'Customer one',Status:'Active'}];
 const categories:any[]=[{ID:1,CategoryName:'Nuts',Status:'Active'}];
 const types:any[]=[{ID:7,PackagingType:'Pouch',PackagingOrdersJSON:'["Primary"]',ParentTypeID:null,Shipping:false,FinalComponent:true,CopyDim:true,HasChildren:false,Status:'Active'}];
 const grades:any[]=[{ID:1,GradeName:'Root',FinalGrade:false,ParentGradeID:null,HasChildren:false,Status:'Active'}];
 const materials:any[]=[];
 const dimensions:any[]=[];
 const uoms:any[]=[{ID:99,UoMCode:'g',UoMName:'Grams',Category:'Weight/Mass',BaseFactor:1,Status:'Active'},{ID:1,UoMCode:'EA',UoMName:'Each',Status:'Active'},{ID:2,UoMCode:'mm',UoMName:'Millimeter',Category:'Length/Distance',Status:'Active'}];
 let failRefresh=false;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:session});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/masters/lookups'){
   if(failRefresh)return route.fulfill({status:503,json:{detail:'Refresh temporarily unavailable.'}});
   return route.fulfill({json:{customers,categories,packagingTypes:types,rawGrades:grades,products:[],materials,materialDimensions:dimensions,uoms,vendors:[],currencies:[],creators:[]}});
  }
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[],currencies:[]}});
  if(path==='/api/packaging/dimensions/lookups')return route.fulfill({json:{packagingTypes:types,uoms,parentDimensions:[]}});
  if(path.endsWith('/raw-grade-lookups'))return route.fulfill({json:{rows:grades,materials}});
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();writes.push({path,body});
   if(path==='/api/categories'){
    const row={...body,ID:20};categories.push(row);
    return route.fulfill({json:{rows:[row]}});
   }
   if(path==='/api/packaging/dimensions'){
    const row={...body,ID:30,RowVersion:rv,D1Name:body.D1,D1Unit:'mm'};dimensions.push(row);
    return route.fulfill({json:{row}});
   }
   if(path.endsWith('/batch')){
    const rows=body.rows.map((r:any,index:number)=>({...r,ID:40+index,Status:'Active',HasChildren:false}));
    if(path==='/api/packaging/type/batch')types.push(...rows);
    if(path==='/api/raw-material/grade/batch')grades.push(...rows);
    if(path==='/api/raw-material/material/batch')materials.push(...rows);
    if(path==='/api/packaging/uom/batch')uoms.push(...rows);
    return route.fulfill({json:{results:rows.map((r:any,index:number)=>({RowNum:body.rows[index].RowNum,Status:'OK',NewID:r.ID}))}});
   }
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,types,grades,categories,materials,setFailRefresh:(value:boolean)=>{failRefresh=value}};
}
async function product(page:Page){
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New product',exact:true});
 await parent.getByLabel('Product name',{exact:true}).fill('Keep unsaved product');
 return parent;
}
async function save(page:Page,form:Locator){
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm master save',exact:true}).getByRole('button',{name:'Confirm save',exact:true}).click();
}

test('selected Category switches to Edit and refreshes its renamed selection without saving the Product',async({page})=>{
 const state=await setup(page),parent=await product(page),writes:any[]=[];
 await parent.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await page.route('**/api/inline-masters/categories/Nuts',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{row:{...state.categories[0],RowVersion:rv},editable:true,lockedFields:[]}});
  const body=route.request().postDataJSON();writes.push(body);Object.assign(state.categories[0],body.payload,{RowVersion:'AAAAAAAAAAI='});
  return route.fulfill({json:{row:state.categories[0]}});
 });
 const edit=parent.getByRole('button',{name:'Edit Category master',exact:true});
 await expect(edit.locator('.edit-master-mark')).toBeVisible();await edit.click();
 const nested=page.getByRole('dialog',{name:'Edit Category',exact:true});
 await nested.getByLabel('Category name',{exact:true}).fill('Renamed nuts');await save(page,nested);
 await expect(nested).toHaveCount(0);await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Renamed nuts');
 await expect(parent.getByLabel('Product name',{exact:true})).toHaveValue('Keep unsaved product');
 expect(writes).toHaveLength(1);expect(writes[0].payload.ID).toBe(1);expect(state.writes).toHaveLength(0);
 await parent.getByLabel('Category',{exact:true}).selectOption('');
 await expect(parent.getByRole('button',{name:'Add new Category master',exact:true})).toBeVisible();
});

test('referenced master opens and uses the normal save-time validation',async({page})=>{
 await setup(page);const parent=await product(page);
 await parent.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await page.route('**/api/inline-masters/categories/Nuts',route=>route.request().method()==='GET'?route.fulfill({json:{row:{ID:1,CategoryName:'Nuts',Status:'Active',RowVersion:rv},editable:true,lockedFields:[]}}):route.fulfill({status:422,json:{detail:'This Category is used by Products. Keep its name, or create a new Category.'}}));
 await parent.getByRole('button',{name:'Edit Category master',exact:true}).click();
 const nested=page.getByRole('dialog',{name:'Edit Category',exact:true});
 await nested.getByLabel('Category name',{exact:true}).fill('Renamed nuts');await save(page,nested);
 await expect(page.getByRole('alert')).toContainText('used by Products');
 await expect(nested.getByLabel('Category name',{exact:true})).toHaveValue('Renamed nuts');
 page.once('dialog',dialog=>dialog.accept());
 await page.keyboard.press('Escape');await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Nuts');
});

test('master changed after opening keeps the edited form and parent draft intact',async({page})=>{
 await setup(page);const parent=await product(page);
 await parent.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await page.route('**/api/inline-masters/categories/Nuts',route=>route.request().method()==='GET'?route.fulfill({json:{row:{ID:1,CategoryName:'Nuts',Status:'Active',RowVersion:rv},editable:true,lockedFields:[]}}):route.fulfill({status:409,json:{detail:'The selected master changed. Close, refresh and reopen it.'}}));
 await parent.getByRole('button',{name:'Edit Category master',exact:true}).click();
 const nested=page.getByRole('dialog',{name:'Edit Category',exact:true});
 await nested.getByLabel('Category name',{exact:true}).fill('My edit');await save(page,nested);
 await expect(page.getByRole('alert')).toContainText('selected master changed');
 await expect(nested.getByLabel('Category name',{exact:true})).toHaveValue('My edit');
 await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Nuts');
});

test('generic Raw Material edit locks its Grade and preserves the invoking grade ratios',async({page})=>{
 const state=await setup(page);state.grades.push({ID:2,GradeName:'Child',FinalGrade:true,ParentGradeID:1,Status:'Active'});
 state.materials.push({ID:9,MaterialName:'Raw nuts',MaterialCode:'RAW-9',GradeID:2,UnitOfMeasure:'EA',Origin:'US',Status:'Active',RowVersion:rv});
 const writes:any[]=[];
 await page.route('**/api/inline-masters/raw-materials/9',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{row:state.materials[0],editable:true,lockedFields:['GradeID']}});
  const body=route.request().postDataJSON(),row=body.payload.rows[0];writes.push(row);Object.assign(state.materials[0],row);
  return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:9}]}});
 });
 const parent=await product(page);await parent.getByRole('button',{name:'Grades for record 1',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();await grades.getByLabel('Grade 0/1',{exact:true}).selectOption('1');
 await grades.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();await grades.getByLabel('Grade 0/1/1',{exact:true}).selectOption('2');
 await grades.getByLabel('Raw Material 0/1/1',{exact:true}).selectOption('9');
 await grades.getByRole('button',{name:'Edit Raw Material master for 0/1/1',exact:true}).click();
 const edit=page.getByRole('dialog',{name:'Edit raw material',exact:true});
 await expect(edit.getByLabel('Grade',{exact:true})).toBeDisabled();await expect(edit.getByLabel('Grade',{exact:true})).toHaveValue('2');
 await edit.getByLabel('Material name',{exact:true}).fill('Edited raw nuts');await save(page,edit);
 await expect(edit).toHaveCount(0);await expect(grades.getByLabel('Raw Material 0/1/1',{exact:true})).toHaveValue('9');
 await expect(grades.getByLabel('Raw Material 0/1/1',{exact:true})).toContainText('Edited raw nuts');
 await expect(grades.getByLabel('Ratio 0/1/1',{exact:true})).toHaveValue('100');expect(writes[0].GradeID).toBe(2);
});

test('Category can be created inside an unsaved Product and selected without saving Product',async({page})=>{
 const {writes}=await setup(page);const parent=await product(page);
 await parent.getByRole('button',{name:'Add new Category master',exact:true}).click();
 const nested=page.getByRole('dialog',{name:'New Category',exact:true});
 await nested.getByLabel('Category name',{exact:true}).fill('New category');
 await save(page,nested);
 await expect(nested).toHaveCount(0);
 await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('New category');
 await expect(parent.getByLabel('Product name',{exact:true})).toHaveValue('Keep unsaved product');
 expect(writes.map(w=>w.path)).toEqual(['/api/categories']);
});

test('distinct master controls exclude Admin references and Escape preserves the parent draft',async({page})=>{
 await setup(page);const parent=await product(page);
 const add=parent.getByRole('button',{name:'Add new Customer master',exact:true});
 await expect(add).toHaveClass('add-master-button');await expect(add).not.toContainText('Master');await expect(add).toHaveAttribute('title','Add new Customer master');
 await expect(parent.getByRole('button',{name:'+ Add record section',exact:true})).not.toHaveClass(/add-master/);
 await add.click();
 const nested=page.getByRole('dialog',{name:'New customer',exact:true});
 await expect(nested.getByLabel('Customer name *',{exact:true})).toBeVisible();
 await expect(nested.locator('.add-master-button')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(nested).toHaveCount(0);
 await expect(parent.getByLabel('Product name',{exact:true})).toHaveValue('Keep unsaved product');
});

test('target edit permission is required and read-only master forms have no master-create buttons',async({page})=>{
 await setup(page,{username:'Tester',user_id:1,is_admin:false,scopes:['Product'],permissions:{products:'edit',customers:'display',categories:'display'}});
 const parent=await product(page);
 await expect(parent.locator('.add-master-button')).toHaveCount(0);
});

test('failed refresh does not imply failed save and retry does not duplicate the master',async({page})=>{
 const state=await setup(page);const parent=await product(page);
 await parent.getByRole('button',{name:'Add new Category master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New Category',exact:true});
 await child.getByLabel('Category name',{exact:true}).fill('Saved once');
 state.setFailRefresh(true);await save(page,child);
 await expect(page.getByRole('alert')).toContainText('Master saved, but choices could not be refreshed');
 await expect(parent.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await expect(parent.getByRole('button',{name:'Add new Category master',exact:true})).toBeDisabled();
 state.setFailRefresh(false);await parent.getByRole('button',{name:'Retry refreshing choices',exact:true}).click();
 await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Saved once');
 await expect(parent.getByRole('button',{name:'Review & save',exact:true})).toBeEnabled();
 expect(state.writes.map(w=>w.path)).toEqual(['/api/categories']);
});

test('Packaging Material creates a dimension definition in the same flow and keeps its draft',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New material',exact:true});
 await parent.getByLabel('Material name',{exact:true}).fill('Keep draft material');
 await parent.getByLabel('Packaging Type',{exact:true}).selectOption('7');
 await parent.getByRole('button',{name:'Add new Packaging Dimension master',exact:true}).click();
 const nested=page.getByRole('dialog',{name:'New packaging dimension',exact:true});
 await expect(nested.getByLabel('Packaging Type',{exact:true})).toHaveValue('7');
 await nested.getByLabel('D1',{exact:true}).fill('Length');
 await nested.getByLabel('D1 Unit',{exact:true}).selectOption('2');
 await nested.getByRole('button',{name:'Save dimension',exact:true}).click();
 await expect(nested).toHaveCount(0);
 await expect(parent.getByLabel('Material dimension definition',{exact:true})).toHaveValue('30');
 await expect(parent.getByLabel('Material name',{exact:true})).toHaveValue('Keep draft material');
 await expect(parent.getByLabel('Material D1',{exact:true})).toBeVisible();
 expect(state.writes.map(w=>w.path)).toEqual(['/api/packaging/dimensions']);
});

test('Packaging Material can create a final Packaging Type before its own save',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New material',exact:true});
 await parent.getByLabel('Material name',{exact:true}).fill('Unsaved material');
 await parent.getByRole('button',{name:'Add new Packaging Type master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await child.getByLabel('Packaging Type',{exact:true}).fill('New final type');
 await child.getByLabel('Primary order',{exact:true}).check();
 await child.getByLabel('Single',{exact:true}).check();
 await save(page,child);
 await expect(child).toHaveCount(0);
 await expect(parent.getByLabel('Packaging Type',{exact:true})).toHaveValue('40');
 expect(state.writes.map(w=>w.path)).toEqual(['/api/packaging/type/batch']);
});

test('Grade tree creates a related Raw Grade while preserving ratios and the unsaved Product',async({page})=>{
 const state=await setup(page);const parent=await product(page);
 await parent.getByRole('button',{name:'Grades for record 1',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption('1');
 await grades.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 await grades.getByRole('button',{name:'Add new Raw Grade master for 0/1/1',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New raw grade',exact:true});
 await expect(child.getByLabel('Parent grade',{exact:true})).toHaveValue('1');
 await child.getByLabel('Grade name',{exact:true}).fill('New child grade');await save(page,child);
 await expect(child).toHaveCount(0);
 await expect(grades.getByLabel('Grade 0/1/1',{exact:true})).toHaveValue('40');
 await expect(grades.getByLabel('Ratio 0/1',{exact:true})).toHaveValue('100');
 await grades.getByRole('button',{name:'Use grades',exact:true}).click();
 await expect(parent.getByLabel('Product name',{exact:true})).toHaveValue('Keep unsaved product');
 expect(state.writes.map(w=>w.path)).toEqual(['/api/raw-material/grade/batch']);
});

test('related master creation updates only the invoking batch record',async({page})=>{
 const state=await setup(page);const parent=await product(page);
 await parent.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await parent.getByRole('button',{name:'+ Add record section',exact:true}).click();
 const second=parent.getByRole('region',{name:'Record 2',exact:true});
 await second.getByRole('button',{name:'Add new Category master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New Category',exact:true});
 await child.getByLabel('Category name',{exact:true}).fill('Second category');await save(page,child);
 await expect(second.getByLabel('Category',{exact:true})).toHaveValue('Second category');
 await expect(parent.getByRole('region',{name:'Record 1',exact:true}).getByLabel('Category',{exact:true})).toHaveValue('Nuts');
 expect(state.writes.map(w=>w.path)).toEqual(['/api/categories']);
});

test('a non-Admin with explicit Category edit access can create the related Category',async({page})=>{
 const state=await setup(page,{username:'Tester',user_id:1,is_admin:false,scopes:['Product'],permissions:{products:'edit',categories:'edit',customers:'display'}});
 const parent=await product(page);
 await parent.getByRole('button',{name:'Add new Category master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New Category',exact:true});
 await child.getByLabel('Category name',{exact:true}).fill('Permitted category');await save(page,child);
 await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Permitted category');
 expect(state.writes.map(w=>w.path)).toEqual(['/api/categories']);
});

test('read-only Product cannot launch nested master creation even with Customer edit access',async({page})=>{
 await setup(page,{username:'Tester',user_id:1,is_admin:false,scopes:['Product','Customer'],permissions:{products:'display',categories:'edit',customers:'edit'}});
 await page.route('**/api/workbench/masters/products?**',r=>r.fulfill({json:{rows:[{ID:3,ProductCode:'PRD-3',ProductName:'Existing Product',CustomerID:1,WeightGrams:100,Category:'Nuts',Status:'Active',RowVersion:rv}],total:1,page:1}}));
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await page.getByRole('button',{name:'View product 3',exact:true}).click();
 const form=page.getByRole('dialog',{name:'View product',exact:true});
 await expect(form.getByLabel('Product name',{exact:true})).toBeDisabled();
 await expect(form.locator('.add-master-button')).toHaveCount(0);
});

test('Unit selectors never expose inline creation, including for Admin',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New material',exact:true});
 await expect(parent.getByRole('button',{name:'Add new UoM master',exact:true})).toHaveCount(0);
 await expect(parent.getByLabel('Base UoM',{exact:true})).toBeEnabled();
 await parent.getByLabel('Packaging Type',{exact:true}).selectOption('7');
 await parent.getByRole('button',{name:'Add new Packaging Dimension master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New packaging dimension',exact:true});
 await child.getByLabel('D1',{exact:true}).fill('Length');
 await expect(child.getByRole('button',{name:'Add new UoM master',exact:true})).toHaveCount(0);
 await expect(child.getByLabel('D1 Unit',{exact:true})).toBeEnabled();
});

test('Grade tree can create a Raw Material linked to the selected child grade',async({page})=>{
 const state=await setup(page);state.grades.push({ID:2,GradeName:'Child',FinalGrade:true,ParentGradeID:1,Status:'Active',HasChildren:false});
 const parent=await product(page);
 await parent.getByRole('button',{name:'Grades for record 1',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'Add root grade',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption('1');
 await grades.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 await grades.getByLabel('Grade 0/1/1',{exact:true}).selectOption('2');
 await grades.getByRole('button',{name:'Add new Raw Material master for 0/1/1',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New raw material',exact:true});
 await expect(child.getByLabel('Grade',{exact:true})).toHaveValue('2');
 await child.getByLabel('Material name',{exact:true}).fill('New raw nuts');
 await child.getByLabel('Base UoM',{exact:true}).selectOption('EA');await save(page,child);
 await expect(grades.getByLabel('Raw Material 0/1/1',{exact:true})).toHaveValue('40');
 await expect(grades.getByLabel('Ratio 0/1/1',{exact:true})).toHaveValue('100');
 await page.setViewportSize({width:390,height:844});
 expect(await grades.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/nested-master-grade-mobile.png'});
 expect(state.writes.map(w=>w.path)).toEqual(['/api/raw-material/material/batch']);
});

test('refresh retry preserves a selector changed after the related master was saved',async({page})=>{
 const state=await setup(page);const parent=await product(page);
 await parent.getByRole('button',{name:'Add new Category master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New Category',exact:true});
 await child.getByLabel('Category name',{exact:true}).fill('Saved category');state.setFailRefresh(true);await save(page,child);
 await expect(parent.getByRole('button',{name:'Retry refreshing choices',exact:true})).toBeVisible();
 await parent.getByLabel('Category',{exact:true}).selectOption('Nuts');
 state.setFailRefresh(false);await parent.getByRole('button',{name:'Retry refreshing choices',exact:true}).click();
 await expect(parent.getByRole('button',{name:'Review & save',exact:true})).toBeEnabled();
 await expect(parent.getByLabel('Category',{exact:true})).toHaveValue('Nuts');
 expect(state.writes.map(w=>w.path)).toEqual(['/api/categories']);
});

test('non-final Packaging Type is saved but not assigned to a Material',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New material',exact:true});
 await parent.getByLabel('Packaging Type',{exact:true}).selectOption('');
 await parent.getByRole('button',{name:'Add new Packaging Type master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await child.getByLabel('Packaging Type',{exact:true}).fill('Assembly type');
 await child.getByLabel('Primary order',{exact:true}).check();await save(page,child);
 await expect(child).toHaveCount(0);
 await expect(parent.getByLabel('Packaging Type',{exact:true})).toHaveValue('');
 await expect(parent.getByLabel('Packaging Type',{exact:true}).locator('option[value="40"]')).toHaveCount(0);
 expect(state.writes.map(w=>w.path)).toEqual(['/api/packaging/type/batch']);
});

test('floating trail tracks pricing and nested Vendor views without discarding the pricing draft',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const parent=page.getByRole('dialog',{name:'New price',exact:true});
 await parent.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('77');
 await parent.getByRole('button',{name:'Add new Vendor master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New vendor',exact:true});
 const trail=child.getByRole('navigation',{name:'Open views',exact:true});
 await expect(trail).toBeVisible();
 expect(await trail.getByRole('listitem').allTextContents()).toEqual(['Packaging Pricing List','Add new Pricing','Add new Vendor']);
 await expect(trail.getByText('Add new Vendor',{exact:true}).locator('..')).toHaveAttribute('aria-current','location');
 await page.screenshot({path:'test-results/nested-view-trail.png',fullPage:true});
 await page.keyboard.press('Escape');
 await expect(child).toHaveCount(0);
 await expect(parent.getByLabel('Unit price (Vendor currency)',{exact:true})).toHaveValue('77.00');
 expect(await parent.getByRole('navigation',{name:'Open views',exact:true}).getByRole('listitem').allTextContents()).toEqual(['Packaging Pricing List','Add new Pricing']);
 expect(state.writes).toEqual([]);
 await page.setViewportSize({width:390,height:844});
 expect(await parent.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('inline master buttons match their dropdown height and stay within the field',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New material',exact:true});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===390?844:1080});
  for(const group of await form.locator('.master-lookup-control').all()){
   const button=group.locator('.add-master-button');if(!await button.count())continue;
   const select=(await group.locator('select').boundingBox())!,box=(await button.boundingBox())!,outer=(await group.boundingBox())!;
   expect(Math.abs(box.y-select.y)).toBeLessThanOrEqual(1);
   expect(Math.abs(box.height-select.height)).toBeLessThanOrEqual(1);
   expect(box.x+box.width).toBeLessThanOrEqual(outer.x+outer.width+1);
  }
  expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 }
});

test('open-view navigation does not cover sticky Save actions in a long material editor',async({page})=>{
 await setup(page);await page.setViewportSize({width:984,height:740});
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New material',exact:true});
 await form.getByRole('button',{name:'+ Add record section',exact:true}).click();
 const save=form.getByRole('button',{name:'Review & save',exact:true});
 const trail=form.getByRole('navigation',{name:'Open views',exact:true});
 for(const width of [984,390]){
 await page.setViewportSize({width,height:740});
 for(const position of [0,.5,1]){
  await form.evaluate((el,p)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*p},position);
  const a=await save.boundingBox(),b=await trail.boundingBox();
  expect(a).not.toBeNull();expect(b).not.toBeNull();
  expect(a!.x+a!.width<=b!.x||b!.x+b!.width<=a!.x||a!.y+a!.height<=b!.y||b!.y+b!.height<=a!.y).toBe(true);
  await save.click({trial:true});
 }
 }
 await form.getByLabel('Packaging Type',{exact:true}).first().selectOption('7');
 await form.getByRole('button',{name:'Add new Packaging Dimension master',exact:true}).first().click();
 const dimension=page.getByRole('dialog',{name:'New packaging dimension',exact:true});
 await dimension.getByLabel('D1',{exact:true}).fill('Length');
 await dimension.getByLabel('D1 Unit',{exact:true}).selectOption('2');
 await dimension.getByRole('button',{name:'Save dimension',exact:true}).click({trial:true});
 const action=await dimension.getByRole('button',{name:'Save dimension',exact:true}).boundingBox();
 const nav=await dimension.getByRole('navigation',{name:'Open views',exact:true}).boundingBox();
 expect(action!.y+action!.height).toBeLessThanOrEqual(nav!.y);
 await page.screenshot({path:'test-results/navigation-save-mobile.png'});
});

test('Raw Material uses Origin instead of Description and saves it',async({page})=>{
 const {writes}=await setup(page);
 await page.getByRole('button',{name:'Raw Material',exact:true}).click();
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New raw material',exact:true});
 await expect(form.getByLabel('Description',{exact:true})).toHaveCount(0);
 await form.getByLabel('Material name',{exact:true}).fill('Cashews W210');
 await form.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await form.getByLabel('Origin',{exact:true}).fill('Vietnam');
 await save(page,form);
 expect(writes[0].body.rows[0].Origin).toBe('Vietnam');
 expect(writes[0].body.rows[0]).not.toHaveProperty('Description');
});

test('shared master save panel follows every record instead of overlaying inputs',async({page})=>{
 await setup(page);await page.setViewportSize({width:1000,height:740});
 await page.getByRole('button',{name:'Raw Material',exact:true}).click();
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New raw material',exact:true});
 for(let i=0;i<3;i++)await form.getByRole('button',{name:'+ Add record section',exact:true}).click();
 const actions=form.locator('.batch-actions');
 expect(await actions.evaluate(el=>getComputedStyle(el).position)).toBe('static');
 await actions.scrollIntoViewIfNeeded();
 const record=await form.getByRole('region',{name:'Record 4',exact:true}).boundingBox(),footer=await actions.boundingBox();
 expect(record!.y+record!.height).toBeLessThanOrEqual(footer!.y);
});
