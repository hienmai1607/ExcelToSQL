import {test,expect} from '@playwright/test';
for(const mix of [false,true])test('Product Master '+(mix?'has no Mix-parent loss setup':'has no Product loss setup'),async({page})=>{
 await page.setViewportSize({width:1020,height:1240});
 const rv='AAAAAAAAAAE=',version='0x0000000000000001',writes:any[]=[];
 const product={ID:1,ProductCode:'PRD-1',ProductName:'Almonds',IsMix:mix,RowVersion:rv,WeightGrams:150,Status:'Active',CustomerName:'Northstar'};
 const masters=['Sorting','Roasting'].map((ProcessName,i)=>({MasterID:i+1,MasterVersion:version,ProcessType:'Processing',ProcessName,Sequence:i+1,LossPct:'5'}));
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin','Product']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/masters/products')return route.fulfill({json:{rows:[product],total:1,page:1}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[],customers:[]}});
  if(path==='/api/workbench/products/1/loss-processes'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{RowVersion:rv}})}
   return route.fulfill({json:{product,processes:[],masters}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await expect(page.getByRole('button',{name:'Loss processes for product 1',exact:true})).toHaveCount(0);
});
