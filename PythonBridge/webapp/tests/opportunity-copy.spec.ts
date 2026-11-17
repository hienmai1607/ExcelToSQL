import {test,expect,type Page} from '@playwright/test';
const customers=[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'AUD',MarketID:5},{ID:2,CustomerName:'Northstar Foods',CustomerCurrencyCode:'USD',MarketID:6}];
const products=[{ID:2,ProductCode:'PRD-2',ProductName:'Almonds',CustomerID:1,WeightGrams:150},{ID:3,ProductCode:'PRD-3',ProductName:'Cashews',CustomerID:1,WeightGrams:450},{ID:20,ProductCode:'PRD-MIX',ProductName:'Mix nuts',CustomerID:1,WeightGrams:750,IsMix:true}];
const mix_children=[{ParentProductID:20,MixVersionID:7,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',UnitQuantity:2},{ParentProductID:20,MixVersionID:7,ProductID:3,ProductCode:'PRD-3',ProductName:'Cashews',UnitQuantity:1}];
const head={OpportunityID:50,OpportunityNumber:'OPP-SRC',OpportunityDesc:'Last season',CustomerID:1,CustomerName:'Northstar',HeaderStage:'Draft'};
// Source Opportunity: Almonds (duplicate of the new form's Product), Cashews, and a Mix with children.
const source=[
 {...head,ItemID:501,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',ItemDescription:'Almonds',AnnualUnit:'100',ItemStage:'Draft'},
 {...head,ItemID:502,ProductID:3,ProductCode:'PRD-3',ProductName:'Cashews',ItemDescription:'Cashews 450g',AnnualUnit:'500.00',EstPctAwarded:'40',ShelfPrice:'9.5',ItemStage:'Draft',ContainerRequest:'40HC',PalletSize:'1200 x 1000 mm',ShipmentCostInfo:JSON.stringify({FreightUSDPerContainer:'1800.00',DutyPct:'4.5',PaymentTerm:'Net 30'})},
 {...head,ItemID:503,ProductID:20,ProductCode:'PRD-MIX',ProductName:'Mix nuts',ItemDescription:'Mix gift',AnnualUnit:'300',ItemStage:'Draft',MixVersionID:6,ContainerRequest:'20DC',ShipmentCostInfo:JSON.stringify({FreightUSDPerContainer:'900.00'})},
 {...head,ItemID:504,ParentItemID:503,ProductID:3,ProductCode:'PRD-3',ProductName:'Cashews',ItemStage:'Draft',MixUnitQuantity:'1',OwnShipmentCostInfo:JSON.stringify({PackingUSDPerLb:'0.35'})},
 // Another Customer whose name shares the prefix must never be offered.
 {...head,OpportunityID:60,OpportunityNumber:'OPP-OTHER',CustomerID:2,CustomerName:'Northstar Foods',ItemID:601,ProductID:3,ProductCode:'PRD-3',AnnualUnit:'1',ItemStage:'Draft'},
];
async function setup(page:Page){
 const writes:any[]=[],grids:string[]=[];
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,scopes:['Opportunity'],is_admin:false}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid'){grids.push(url.search);return route.fulfill({json:{rows:url.searchParams.get('customer_name')?source:[],total:0,page:1}})}
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers,products,ports:[],pallets:[{ID:1,PalletSize:'1200 x 1000 mm'}],packagingTypes:[],mix_children}});
  if(path==='/api/opportunity/batch'){const payload=route.request().postDataJSON();writes.push(payload);return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-NEW'}],item_results:payload.item_rows.map((row:any)=>({RowNum:row.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Description *',{exact:true}).fill('Copy test');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1.5');
 await form.getByLabel('Bid open',{exact:true}).fill('10/01/2026');await form.getByLabel('Bid close',{exact:true}).fill('10/10/2026');
 const item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByLabel('Product *').selectOption('2');await item.getByLabel('Annual units *').fill('1000');
 await item.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();await item.getByLabel('Container Type',{exact:true}).selectOption('20DC');
 return {form,item,writes,grids};
}
test('header copy adds same-Customer Opportunity items, skips existing Products and keeps Mix children',async({page},info)=>{
 const {form,writes,grids}=await setup(page);
 await form.getByRole('button',{name:'Copy items from another Opportunity',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Copy items from Opportunity',exact:true});
 const choice=dialog.getByLabel('Copy items from Opportunity',{exact:true});
 await expect(choice.locator('option')).toHaveText(['Choose Opportunity','OPP-SRC · Last season (3 items)']);
 expect(new URLSearchParams(grids.at(-1)).get('customer_name')).toBe('Northstar');
 await choice.selectOption({label:'OPP-SRC · Last season (3 items)'});
 await dialog.getByRole('button',{name:'Copy items',exact:true}).click();
 await expect(page.getByText('Copied 2 items from OPP-SRC',{exact:false})).toBeVisible();
 await expect(page.getByText('Skipped: Item 1 PRD-2 (already in this Opportunity)',{exact:false})).toBeVisible();
 const cashews=form.getByRole('region',{name:'Item 2',exact:true});
 await expect(cashews.getByLabel('Product *')).toHaveValue('3');await expect(cashews.getByLabel('Annual units *')).toHaveValue('500');
 await expect(cashews.getByLabel('Estimated award %')).toHaveValue('40');
 await expect(form.getByRole('region',{name:'Item 3',exact:true}).getByLabel('Product *')).toHaveValue('20');
 await expect(form.getByRole('region',{name:'Item 3.1',exact:true})).toBeAttached();await expect(form.getByRole('region',{name:'Item 3.2',exact:true})).toBeAttached();
 await page.screenshot({path:info.outputPath('opportunity-header-copy.png')});
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 const rows=writes[0].item_rows;
 const copied=rows.find((r:any)=>String(r.ProductID)==='3'&&!r.ParentRowNum&&r.ShipmentCostInfo?.FreightUSDPerContainer);
 expect(copied).toMatchObject({ContainerRequest:'40HC',PalletSize:'1200 x 1000 mm',ShipmentCostInfo:{FreightUSDPerContainer:'1800.00',DutyPct:'4.5',PaymentTerm:'Net 30'}});
 // New Mix parents carry their children nested; each child keeps its own Others info from the matching source child.
 const mix=rows.find((r:any)=>String(r.ProductID)==='20');
 expect(mix.MixChildren.map((c:any)=>[c.ProductID,c.ShipmentCostInfo?.PackingUSDPerLb??null])).toEqual([[2,null],[3,'0.35']]);
});
test('line copy fills another item but keeps its own Product',async({page})=>{
 const {form,item}=await setup(page);
 await item.getByLabel('Estimated award %').fill('35');
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 const second=form.getByRole('region',{name:'Item 2',exact:true});
 await second.getByLabel('Product *').selectOption('3');
 await second.getByRole('button',{name:'Copy information into item 2',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Copy item information',exact:true});
 await dialog.getByLabel('Copy information from item',{exact:true}).selectOption({index:1});
 await dialog.getByRole('button',{name:'Copy information',exact:true}).click();
 await expect(second.getByLabel('Product *')).toHaveValue('3');
 await expect(second.getByLabel('Annual units *')).toHaveValue('1000');await expect(second.getByLabel('Estimated award %')).toHaveValue('35');
});
