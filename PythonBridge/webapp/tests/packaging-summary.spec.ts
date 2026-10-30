import {test,expect,type Page} from '@playwright/test';

const rv='AAAAAAAAAAE=';
const header={OpportunityID:1,OpportunityNumber:'OPP-SUMMARY',HeaderStage:'Draft',HeaderRowVersion:rv,CustomerName:'Customer',ItemCount:1,CustomerCurrencyCode:'VND',ExchangeRateVNDPerUSD:'25000',ExchangeRateCustomerCurrencyPerUSD:'25000'};
const base={RequestID:9,ItemStage:'Approved',ResponseLayerCount:3,RequestedLayerCount:3,
 FirstPMType:'Film',SecondPMType:'Box',ThirdPMType:'Shipping carton',UnitsPerCarton:12,UnitsPerTertiary:5,
 PrimaryPricePerUnit:'100',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'300',SecondaryPriceCurrencyCode:'VND',
 TertiaryPricePerUnit:'900',TertiaryPriceCurrencyCode:'VND',FirstPMMOQ:1000,SecondPMMOQ:500,ThirdPMMOQ:100,
 PrimaryNetWeightGrams:150,SecondaryNetWeightGrams:1800,TertiaryNetWeightGrams:9000,
 LayerDimensionCaptures:{Primary:{PackagingTypeName:'Film',LayerCount:3,Dimensions:[{Name:'Length',Unit:'mm',Value:'100'},{Name:'Width',Unit:'mm',Value:'200'}]},
  Secondary:{PackagingTypeName:'Box',LayerCount:3,Dimensions:[{Name:'Length',Unit:'cm',Value:'10'},{Name:'Width',Unit:'cm',Value:'20'},{Name:'Height',Unit:'cm',Value:'30'}]}},
 ConfigurationRequest:'Both',ContainerRequest:'Both',ResponsePalletSize:'1.1 × 1.1m',ResponsePalletStacking:'Single',CartonsPerLayer:10,LayersPerPallet:6,PalletHeightMM:1800,NetWeightPerPalletKG:540,
 ContainerLoadProfiles:JSON.stringify({'20DC':{PalletsPerContainer:'10',CartonsPerContainerFloor:'100'},'20RC':{PalletsPerContainer:'8',CartonsPerContainerFloor:'80'}}),
 ContainerLoadResults:{'20DC':{LayersPerContainer:6,CalculatedCartonsPerContainer:600,NetWeightPerContainerKG:5400,NetWeightPerContainerFloorKG:900},
  '20RC':{LayersPerContainer:6,CalculatedCartonsPerContainer:480,NetWeightPerContainerKG:4320,NetWeightPerContainerFloorKG:720}}};
const normal={...base,ItemID:101,OpportunityItemID:10,ProductID:20,ProductCode:'PRD-ROOT',ProductName:'Almonds'};
const mix={...normal,IsMixParent:true,ResponseLayerCount:2,UnitsPerCarton:6,PrimaryPricePerUnit:'24',SecondaryPricePerUnit:'18',PrimaryNetWeightGrams:750,SecondaryNetWeightGrams:4500,
 ProductMixSnapshot:JSON.stringify({items:[{ProductID:1,ProductCode:'PRD-A',ProductName:'Almonds A',UnitQuantity:'2'},{ProductID:2,ProductCode:'PRD-B',ProductName:'Almonds B',UnitQuantity:'1'}]})};
const children=[
 {...base,ItemID:102,OpportunityItemID:11,ParentItemID:10,ProductID:1,ProductCode:'PRD-A',ProductName:'Almonds A',ResponseLayerCount:2,
  UnitsPerCarton:3,PrimaryPricePerUnit:'10',SecondaryPricePerUnit:'60',SecondaryNetWeightGrams:450},
 {...base,ItemID:103,OpportunityItemID:12,ParentItemID:10,ProductID:2,ProductCode:'PRD-B',ProductName:'Almonds B',ResponseLayerCount:1,PrimaryPricePerUnit:'5',PrimaryNetWeightGrams:450}
];
async function setup(page:Page,root:any=normal,childRows:any[]=[],fail=false,opportunity:Record<string,unknown>={}){
 const reads:string[]=[],writes:string[]=[];
 await page.route('**/api/**',route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path.endsWith('/eligibility'))return route.fulfill({json:{rows:[]}}); // read-only POST, not a business mutation
  if(request.method()!=='GET'){writes.push(path);return route.fulfill({status:500,json:{detail:'Unexpected write'}})}
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:1,is_admin:false,scopes:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{version:0,settings:{}}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[{...header,...opportunity,ItemID:10,ProductID:20,ProductCode:'PRD-ROOT',ProductName:'Almonds',PackagingRequestID:9,PackagingRequestNumber:'PCR-30293'},
   ...childRows.map(child=>({...header,...opportunity,ItemID:child.OpportunityItemID,ParentItemID:10,ProductID:child.ProductID,ProductCode:child.ProductCode,ProductName:child.ProductName,PackagingRequestID:99,PackagingRequestNumber:'PCR-OTHER'}))],total:1,page:1}});
  if(path==='/api/packaging/requests'){
   reads.push(url.search);
   if(fail)return route.fulfill({status:403,json:{detail:'Packaging Request access is required.'}});
   const first=url.searchParams.get('page')==='1';
   const fillers=childRows.length?Array.from({length:199},(_,index)=>({ItemID:1000+index,OpportunityItemID:1000+index,RequestID:9})):[];
   return route.fulfill({json:{rows:first?[root,...fillers]:childRows,total:1+fillers.length+childRows.length,page:first?1:2}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Responses',exact:true}).click();
 return {reads,writes,open:async()=>{
  await page.getByRole('button',{name:'Packaging Summary for PRD-ROOT item 10',exact:true}).click();
  return page.getByRole('dialog',{name:'Packaging Summary',exact:true});
 }};
}

test('normal packaging tree shows layers, dimensions, price flow and one unified container branch without writes',async({page},info)=>{
 const {open,writes}=await setup(page);const dialog=await open();
 await expect(dialog.getByRole('region',{name:'Packaging response tree',exact:true})).toBeVisible();
 const layers=dialog.locator('.summary-layer-chain .summary-node');await expect(layers).toHaveCount(3);
 await expect(layers.nth(0)).toContainText('100mm × 200mm');await expect(layers.nth(1)).toContainText('10cm × 20cm × 30cm');
 await expect(layers.nth(2)).toContainText('8,400.00 VND');
 await expect(dialog.getByText(/Response: Approved|packaging · Layer|from Packing Way/)).toHaveCount(0);
 await expect(layers.nth(0).getByRole('table',{name:'Primary packaging details',exact:true})).toBeVisible();
 expect(await dialog.locator('table.summary-details').evaluateAll(tables=>tables.every(table=>Array.from(table.querySelectorAll('tr')).every(row=>row.children.length===2)))).toBe(true);
 expect(await dialog.locator('.summary-edge').first().evaluate(el=>getComputedStyle(el,'::before').width)).toBe('3px');
 const table=dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true});await expect(table).toContainText('140.00 VND');
 await expect(dialog.getByRole('region',{name:'Palletization branch',exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'Container Load branch',exact:true})).toBeVisible();
 await expect(dialog.locator('.summary-container')).toHaveCount(5);
 await expect(dialog.getByRole('article',{name:'Container Load 20DC',exact:true})).toContainText('900');
 await expect(dialog.getByRole('article',{name:'Container Load 40HC',exact:true})).toContainText('Not configured');
 await expect(dialog).toContainText('Not configured — excluded');
 await dialog.screenshot({path:info.outputPath('normal-packaging-tree.png')});
 await dialog.getByRole('button',{name:'Close Packaging Summary',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('table',{name:'Opportunity items',exact:true})).toBeVisible();expect(writes).toEqual([]);
});

test('captured VND pallet cost uses Opportunity USD exchange rate without requiring load quantities',async({page})=>{
 const {open,writes}=await setup(page,{...normal,CartonsPerLayer:null,LayersPerPallet:null,PalletPricingJSON:JSON.stringify({ID:77,UnitPrice:'400000',CurrencyCode:'VND',UnitUSDPrice:null})});
 const dialog=await open();
 const pallet=dialog.getByRole('table',{name:'Palletization details',exact:true});
 await expect(pallet.getByRole('row').filter({hasText:/^Pallet cost/})).toContainText('400,000.00 VND / 16.00 USD');
 expect(writes).toEqual([]);
});
test('each container shows separate Fobbing and Freight fees with USD equivalents even before loading is configured',async({page},info)=>{
 const {open,writes}=await setup(page,{...normal,ConfigurationRequest:'Floor load',ContainerRequest:'Dry'},[],false,
  {CustomerCurrencyCode:'EUR',ExchangeRateCustomerCurrencyPerUSD:'.8',ShipmentCostInfo:JSON.stringify({FobbingUSDPerContainer:'35',FreightUSDPerContainer:'1200'})});
 const dialog=await open(),container=dialog.getByRole('article',{name:'Container Load 40DC',exact:true});
 await expect(container).toContainText('Not configured');
 await expect(container.getByRole('row').filter({hasText:/^Fobbing fee \/ Container/})).toContainText('35.00 USD');
 await expect(container.getByRole('row').filter({hasText:/^Freight \/ Container/})).toContainText('1,200.00 USD');
 await container.scrollIntoViewIfNeeded();
 expect(await container.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await container.screenshot({path:info.outputPath('container-commercial-costs.png')});
 expect(writes).toEqual([]);
});
test('summary displays gross below net for every parent and child layer without writes',async({page})=>{
 const {open,writes}=await setup(page,{...mix,PrimaryGrossWeightKG:'5.78885',SecondaryGrossWeightKG:'10.88885'},[
  {...children[0],PrimaryGrossWeightKG:'0.160123456',SecondaryGrossWeightKG:'0.580370368'},
  {...children[1],PrimaryGrossWeightKG:null}
 ]);
 const dialog=await open(),nodes=dialog.locator('.summary-layer-chain .summary-node');
 await expect(nodes).toHaveCount(5);
 const expected=['160.123','580.37','—','5,788.85','10,888.85'];
 for(let i=0;i<expected.length;i++){
  const rows=nodes.nth(i).getByRole('row');
  await expect(rows.nth(0).getByRole('rowheader')).toHaveText('Net weight (g)');
  await expect(rows.nth(1).getByRole('rowheader')).toHaveText('Gross weight (g)');
  await expect(rows.nth(1).getByRole('cell')).toHaveText(expected[i]);
 }
 expect(writes).toEqual([]);
});

test('mix tree loads every parent-PCR child and splits shared cost equally down to smallest units',async({page},info)=>{
 const {open,reads,writes}=await setup(page,mix,children);const dialog=await open();
 const costs=dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true});
 await expect(costs).toContainText('92.00 VND');
 await expect(costs.getByRole('row').nth(1)).toContainText('39.00 VND');await expect(costs.getByRole('row').nth(2)).toContainText('14.00 VND');
 await expect(dialog.locator('.summary-mix-children .summary-product')).toHaveCount(2);
 await expect(dialog.locator('.summary-mix-children .summary-layer-chain .summary-node')).toHaveCount(3);
 expect(new Set(reads).size).toBe(2);for(const read of reads)expect(new URLSearchParams(read).get('request_id')).toBe('9');
 await dialog.screenshot({path:info.outputPath('mix-packaging-tree.png')});
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Summary for PRD-A item 11',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true})).toContainText('92.00 VND');
 await expect(dialog.locator('.summary-focused')).toContainText('PRD-A');
 for(const read of reads)expect(new URLSearchParams(read).get('request_id')).toBe('9');
 expect(writes).toEqual([]);
});

for(const family of ['Dry','Reefer'])test('container tree respects '+family+' family and floor-only configuration',async({page})=>{
 const {open}=await setup(page,{...normal,ContainerRequest:family,ConfigurationRequest:'Floor load'});const dialog=await open();
 await expect(dialog.getByRole('region',{name:'Container Load branch',exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'Palletization branch',exact:true})).toBeVisible();
 await expect(dialog.locator('.summary-container h4')).toHaveText(family==='Dry'?['20DC','40DC','40HC']:['20RC','40RHC']);
});

test('Opportunity summary shares only checked alternatives even outside the requested type',async({page})=>{
 const {open}=await setup(page,{...normal,ContainerRequest:'40DC',ResponseContainerFamily:'40DC',ShipmentContainerSizeFT:'40FT',ConfigurationRequest:'Floor load',ContainerLoadProfiles:JSON.stringify({'40DC':{CartonsPerContainerFloor:100,Proposal:true},'20RC':{CartonsPerContainerFloor:80,Proposal:true},'40HC':{CartonsPerContainerFloor:120,Proposal:false}})});
 const dialog=await open();
 await expect(dialog.locator('.summary-container h4')).toHaveText(['40DC','20RC']);
 await expect(dialog.getByRole('region',{name:'Container Load branch',exact:true})).toBeVisible();
});

test('hidden responses and denied access show incomplete data, never a fabricated zero cost',async({page})=>{
 const {open,writes}=await setup(page,{...normal,ResponseLayerCount:null,PrimaryPricePerUnit:null});const dialog=await open();
 await expect(dialog).toContainText('Cost summary is incomplete');
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs'})).toContainText('Incomplete');
 await expect(dialog.getByRole('region',{name:'Shipping configuration tree'})).toHaveCount(0);
 expect(writes).toEqual([]);
});

test('read failures retain a working Close control and the Opportunity view',async({page})=>{
 const {open,writes}=await setup(page,normal,[],true);const dialog=await open();
 await expect(dialog.getByRole('alert')).toContainText('access is required');
 await dialog.getByRole('button',{name:'Close Packaging Summary',exact:true}).click();
 await expect(page.getByRole('table',{name:'Opportunity items'})).toBeVisible();expect(writes).toEqual([]);
});

test('all tree and logistics currency fields use Opportunity master FX and two decimals',async({page})=>{
 const {open,writes}=await setup(page,{...normal,PrimaryPricePerUnit:'25000.125',PrimaryPriceUSDPerUnit:'99',SecondaryPricePerUnit:'2',SecondaryPriceCurrencyCode:'USD',TertiaryPricePerUnit:'100'},[],false,{CustomerCurrencyCode:'EUR',ExchangeRateVNDPerUSD:'25000',ExchangeRateCustomerCurrencyPerUSD:'.8'});
 const dialog=await open();
 const primary=dialog.getByRole('table',{name:'Primary packaging details',exact:true});
 await expect(primary.getByRole('row').filter({hasText:/^Packaging cost \/ unit/})).toContainText('25,000.13 VND / 1.00 USD');
 const unit=dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true});
 await expect(unit).toContainText('1.17 USD');
 await expect(dialog.getByRole('article',{name:'Container Load 20DC',exact:true})).toContainText('175,010,750.00 VND / 7,000.43 USD');
 await expect(dialog).not.toContainText('99.00 EUR');
 expect(writes).toEqual([]);
});
test('missing Opportunity exchange rate warns without assuming a rate',async({page})=>{
 const {open}=await setup(page,normal,[],false,{CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:null});
 const dialog=await open();
 await expect(dialog).toContainText('Opportunity exchange rate or saved USD price is unavailable');
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true})).toContainText('Incomplete');
});
test('child summary uses the parent Opportunity currency for the entire mix',async({page})=>{
 const {open,writes}=await setup(page,mix,children,false,{CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:'100'});
 const dialog=await open();
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true})).toContainText('0.92 USD');
 await dialog.getByRole('button',{name:'Close Packaging Summary',exact:true}).click();
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Summary for PRD-A item 11',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true})).toContainText('0.39 USD');
 await expect(dialog.locator('.summary-focused')).toContainText('PRD-A');
 expect(writes).toEqual([]);
});

test('captured VND prices show VND / USD for layer, allocated, pallet and container costs',async({page})=>{
 const {open,writes}=await setup(page,mix,children,false,{CustomerCurrencyCode:'AUD',ExchangeRateVNDPerUSD:'100',ExchangeRateCustomerCurrencyPerUSD:'1.5'});
 const dialog=await open();
 await expect(dialog.locator('.summary-mix-children .summary-node').first()).toContainText('10.00 VND / 0.10 USD');
 const costs=dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true});
 await expect(costs.getByRole('row').nth(1)).toContainText('39.00 VND / 0.39 USD');
 await expect(costs).toContainText('92.00 VND / 0.92 USD');
 await dialog.screenshot({path:'../artifacts/layout-testing/packaging-summary-vnd-usd.png'});
 await expect(dialog.getByRole('table',{name:'Palletization details',exact:true})).toContainText('33,120.00 VND / 331.20 USD');
 await expect(dialog.getByRole('article',{name:'Container Load 20DC',exact:true})).toContainText('55,200.00 VND / 552.00 USD');
 expect(writes).toEqual([]);
});
test('USD customer prices appear once without a duplicate USD equivalent',async({page})=>{
 const {open}=await setup(page,normal,[],false,{CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:'100'});
 const dialog=await open();
 await expect(dialog.getByRole('table',{name:'Primary packaging details',exact:true})).toContainText('1.00 USD');
 await expect(dialog).not.toContainText('(1.00 USD)');
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs',exact:true})).toContainText('1.40 USD');
});

test('packaging summary remains usable on narrow screens',async({page})=>{
 const {open}=await setup(page,{...mix,PalletPricingJSON:{UnitPrice:'400000',CurrencyCode:'VND'}},children,false,{ShipmentCostInfo:{FobbingUSDPerContainer:'35',FreightUSDPerContainer:'1200'}});await page.setViewportSize({width:390,height:844});const dialog=await open();
 await expect(dialog.getByRole('region',{name:'Smallest unit packaging costs'})).toContainText('92.00 VND');
 expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await expect(dialog.getByRole('button',{name:'Close Packaging Summary'})).toBeInViewport();
});

test('saved container plan is configured even without legacy profiles',async({page})=>{
 const {open}=await setup(page,{...normal,ConfigurationRequest:'Pallet load',ContainerRequest:'40DC',ContainerLoadProfiles:null,SelectedContainerType:'20DC',
 ContainerPlansJSON:JSON.stringify([{ID:7,Code:'40DC',Inputs:{mode:'pallet'},Result:{loaded_units:40,cartons:4000,cartons_per_pallet:100}}]),
 ContainerLoadResults:{'40DC':{CalculatedCartonsPerContainer:4000,NetWeightPerContainerKG:9600}}});
 const dialog=await open(),container=dialog.getByRole('article',{name:'Container Load 40DC',exact:true});
 await expect(container.getByText('Not configured',{exact:true})).toHaveCount(0);
 await expect(container.getByRole('row').filter({hasText:'Pallet / Container'})).toContainText('40');
 await expect(container).toContainText('4,000');
});

test('USD sourced pricing stays USD only even for an AUD customer',async({page})=>{
 const root={...normal,ResponseLayerCount:1,PrimaryPricePerUnit:'2',PrimaryPriceCurrencyCode:'USD'};
 const {open}=await setup(page,root,[],false,{CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5'});
 const dialog=await open();
 const primary=dialog.getByRole('table',{name:'Primary packaging details',exact:true});
 await expect(primary).toContainText('2.00 USD');
 await expect(primary).not.toContainText('VND');await expect(primary).not.toContainText('AUD');
});
