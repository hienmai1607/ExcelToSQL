import {test,expect} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const header={OpportunityID:1,OpportunityNumber:'OPP-MIX',HeaderStage:'Draft',HeaderRowVersion:rv,CustomerID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityDesc:'Mix launch',BidOpen:'2026-09-01',BidClose:'2026-10-01'};
const parent={...header,ItemID:10,ItemNumber:'1',ProductID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',ItemDescription:'Mix pack',AnnualUnit:'10.0000',ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7};
const child={...header,ItemID:11,ItemNumber:'1.1',ParentItemID:10,ProductID:2,ProductCode:'PRD-ALM',ProductName:'Almonds',ItemDescription:'Almonds',AnnualUnit:'12.5000',ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7,MixUnitQuantity:'1.2500',MixChildNumber:1};
test('a Draft Mix item is deleted from its parent row; children have no delete icon',async({page})=>{
 const asked:number[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',scopes:['Opportunity'],is_admin:false,user_id:10}});
  if(path==='/api/workbench/preferences')return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[parent,child],total:1,page:1}});
  if(path==='/api/business-records/opportunity-items/eligibility'){
   const rows=route.request().postDataJSON().rows;asked.push(...rows.map((r:any)=>r.ID));
   return route.fulfill({json:{rows:rows.map((r:any)=>({...r,available:true}))}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(page.getByRole('button',{name:'Delete Opportunity item 1',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Delete Opportunity item 1.1',exact:true})).toHaveCount(0);
 expect(asked).not.toContain(11);
});
