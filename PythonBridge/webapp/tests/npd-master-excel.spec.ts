import {test,expect,type Page} from '@playwright/test';
import {workspacePages} from '../src/workspace-access';
const ingredient={ID:1,RowVersion:'AAAAAAAAAAE=',IngredientCode:'ING-1',Description:'Salt',GradeNature:'Fine',Origin:'Vietnam',BaseUoM:'KG',Status:'Active'};
async function setup(page:Page,access:'edit'|'display',calls:{path:string;body:any}[]){
 const permissions={...Object.fromEntries(Object.keys(workspacePages).map(k=>[k,'none'])),ingredients:access,'ingredient-prices':access};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(body)calls.push({path,body});
  if(path.endsWith('/session'))return route.fulfill({json:{username:'npd.member',user_id:2,is_admin:false,scopes:['NPD'],permissions}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{shared_masters:{ingredients:{columns:['Description','BaseUoM'],filters:['search','status'],values:{},sort:[{column:'IngredientCode',direction:'asc'}],page_size:50}}},version:0}});
  if(path.includes('/master-excel/'))return route.fulfill({body:'test workbook'});
  if(path.endsWith('/export'))return route.fulfill({body:'xlsx'});
  if(path==='/api/npd/lookups')return route.fulfill({json:{units:[],vendors:[],currencies:[],ingredients:[ingredient],members:[]}});
  return route.fulfill({json:{rows:path.endsWith('/ingredients')?[ingredient]:[],total:path.endsWith('/ingredients')?1:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
for(const [entity,label,file] of [['ingredients','Ingredients Master','Ingredients_Master_Local_Update.xlsm'],['ingredient-prices','Ingredient Pricing','Ingredient_Pricing_Local_Update.xlsm']] as const){
 test(label+' editors download the Excel Local Update workbook with the current view',async({page})=>{
  const calls:{path:string;body:any}[]=[];await setup(page,'edit',calls);
  await page.getByRole('navigation').getByRole('button',{name:label,exact:true}).click();
  await page.getByLabel('Search '+label,{exact:true}).fill('Sa');await page.getByRole('button',{name:'Search',exact:true}).click();
  const action=page.getByRole('button',{name:'Excel local template',exact:true});
  // Editors can download even an empty page to create the first records.
  await expect(action).toBeEnabled();
  const download=page.waitForEvent('download');await action.click();
  expect((await download).suggestedFilename()).toBe(file);
  const sent=calls.find(c=>c.path==='/api/workbench/master-excel/'+entity+'/download')!;
  expect(sent.body.page).toBe(1);expect(sent.body.layout.values.search).toBe('Sa');
  if(entity==='ingredients'){expect(sent.body.layout.columns).toEqual(['Description','BaseUoM']);expect(sent.body.layout.page_size).toBe(50)}
  await expect(page.getByText('Open the downloaded workbook in desktop Excel',{exact:false})).toBeVisible();
 });
}
test('read-only ingredient users keep the static current-view export',async({page})=>{
 const calls:{path:string;body:any}[]=[];await setup(page,'display',calls);
 await page.getByRole('navigation').getByRole('button',{name:'Ingredients Master',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Excel local template',exact:true}).click();
 expect((await download).suggestedFilename()).toBe('ingredients-current-view.xlsx');
 expect(calls.some(c=>c.path.includes('master-excel'))).toBe(false);
});
