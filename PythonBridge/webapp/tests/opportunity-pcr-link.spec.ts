import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,{admin=false,id=77,mode='ok'}:{admin?:boolean;id?:number|null;mode?:'ok'|'denied'|'missing'|'paged'}={}){
 const reads:URL[]=[],writes:string[]=[];
 const item={OpportunityID:1,OpportunityNumber:'OPP-LINK',CustomerName:'Customer',HeaderStage:'Draft',HeaderRowVersion:rv,ItemID:11,ItemNumber:'1',ProductID:1,ProductCode:'PRD-1',ProductName:'Almonds',ItemStage:'Draft',ItemRowVersion:rv,WeightGrams:150,AnnualUnit:1000,PackagingRequestID:id,PackagingRequestItemID:88,PackagingRequestNumber:'PCR-33178'};
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(req.method()!=='GET'&&!path.includes('/auth/')&&!path.endsWith('/session')&&!path.endsWith('/eligibility'))writes.push(path);
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:[admin?'Admin':'Opportunity'],is_admin:admin}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[item,{...item,ItemID:12,ItemNumber:'2',ProductCode:'PRD-2'}],page:1,total:1}});
  if(path==='/api/workbench/requests'){
   reads.push(url);
   if(mode==='denied')return route.fulfill({status:403,json:{detail:'No permission to read this request.'}});
   const match={RequestID:77,RequestNumber:'PCR-33178',OpportunityNumber:'OPP-LINK',CustomerName:'Customer',ResponseDue:'2026-10-30',RequestedByName:'Requester',RequestStatus:'Open',RequestNotes:'Keep the original request notes.',ItemCount:1};
   const decoy={...match,RequestID:78,RequestNumber:'PCR-331780'};
   const rows=mode==='missing'?[decoy]:mode==='paged'&&url.searchParams.get('page')==='1'?[decoy]:[decoy,match];
   return route.fulfill({json:{rows,total:mode==='paged'?51:rows.length,page:Number(url.searchParams.get('page'))}});
  }
  if(path==='/api/packaging/requests'){
   reads.push(url);
   return route.fulfill({json:{rows:[{...item,ItemID:88,OpportunityItemID:11,RequestID:77,ItemStage:'Assigned',PICUserID:1,PIC:'Tester',RequestedLayerCount:1,ResponseLayerCount:1,NutDensity:'.6',ShelfLifeDays:365,RequestNotes:'Keep the original request notes.'}],total:1,page:1}});
  }
  if(path==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[],pallets:[]}});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Responses',exact:true}).click();
 return {reads,writes,link:page.getByRole('button',{name:'View Packaging Request PCR-33178',exact:true}).first()};
}
test('linked PCR opens the matching read-only request and closing retains the Opportunity view',async({page})=>{
 const {link,reads,writes}=await setup(page);
 await link.focus();await page.keyboard.press('Enter');
 const view=page.getByRole('dialog',{name:'Packaging request view',exact:true});
 await expect(view.getByRole('heading',{name:'PCR-33178',exact:true})).toBeVisible();
 await expect(view.getByText('Keep the original request notes.',{exact:true})).toBeVisible();
 await expect(view.getByRole('region',{name:'Request item 88',exact:true})).toBeVisible();
 await expect(view.locator('details').filter({has:page.locator('summary').getByText('Packaging request',{exact:true})})).toHaveAttribute('open','');
 await expect(view.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 expect(reads.find(u=>u.pathname==='/api/packaging/requests')?.searchParams.get('request_id')).toBe('77');
 expect(reads.find(u=>u.pathname==='/api/workbench/requests')?.searchParams.get('search')).toBe('PCR-33178');
 await page.keyboard.press('Escape');await expect(view).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Packaging Responses',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(link).toBeVisible();expect(writes).toEqual([]);
});
test('linked request is read only even for its assigned Admin',async({page})=>{
 const {link,writes}=await setup(page,{admin:true});await link.click();
 const view=page.getByRole('dialog',{name:'Packaging request view',exact:true});
 await expect(view.getByRole('region',{name:'Request item 88',exact:true})).toBeVisible();
 await expect(view.locator('.request-editor-item select:not(:disabled):not([aria-label="Container type"])')).toHaveCount(0);
 await expect(view.locator('.request-editor-item input:not(:disabled):not([readonly])')).toHaveCount(0);
 await expect(view.locator('.item-review-actions button')).toHaveCount(0);
 await expect(view.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 await view.getByRole('button',{name:'Close request editor',exact:true}).click();
 expect(writes).toEqual([]);
});
test('request access failures remain closable and do not fetch or expose items',async({page})=>{
 const {link,reads,writes}=await setup(page,{mode:'denied'});await link.click();
 const view=page.getByRole('dialog',{name:'Packaging request view',exact:true});
 await expect(view).toContainText('No permission to read this request.');
 expect(reads.some(u=>u.pathname==='/api/packaging/requests')).toBe(false);
 await view.getByRole('button',{name:'Close request view'}).click();
 await expect(link).toBeVisible();expect(writes).toEqual([]);
});
test('missing linked ID never opens a different PCR with a matching number prefix',async({page})=>{
 const {link,reads}=await setup(page,{mode:'missing'});await link.click();
 await expect(page.getByRole('dialog',{name:'Packaging request view',exact:true})).toContainText('no longer available');
 expect(reads.some(u=>u.pathname==='/api/packaging/requests')).toBe(false);
});
test('header lookup can find the exact linked request beyond the first matching page',async({page})=>{
 const {link,reads}=await setup(page,{mode:'paged'});await link.click();
 await expect(page.getByRole('dialog',{name:'Packaging request view',exact:true}).getByRole('region',{name:'Request item 88',exact:true})).toBeVisible();
 expect([...new Set(reads.filter(u=>u.pathname==='/api/workbench/requests').map(u=>u.searchParams.get('page')))]).toEqual(['1','2']);
});
test('request number without a valid linked ID remains plain text',async({page})=>{
 await setup(page,{id:null});
 await expect(page.getByRole('button',{name:'View Packaging Request PCR-33178',exact:true})).toHaveCount(0);
 await expect(page.getByRole('table',{name:'Opportunity items',exact:true}).getByText('PCR-33178',{exact:true})).toHaveCount(2);
});
