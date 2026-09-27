import {test,expect} from '@playwright/test';
test('Packaging PIC edits response fields then submits with confirmation',async({page})=>{
 let response:any,transition:any;
 const row={SnapshotOrigin:'Request',SnapshotCapturedAt:'2026-09-23T09:00:00',SourceCurrencyCode:'VND',SourceExchangeRateToVND:'1.000000',RequestID:1,ItemID:7,ProductCode:'P1',ProductName:'Roasted almonds',WeightGrams:'100.00',ItemDescription:'Pack',ItemStage:'Assigned',PICUserID:2,PIC:'PIC',AnnualUnit:100,ItemRowVersion:'AAAAAAAAAAE=',RequestedByName:'Sales',Category:'Nuts',PackagingType:'Pouch'};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'PIC',user_id:2,scopes:['Packaging'],is_admin:false}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,dark:false,nav_hidden:false},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',OpportunityNumber:'OPP-1',CustomerName:'Customer',RequestStatus:'Open',RequestedByName:'Sales',ResponseDue:'2026-10-01',ItemCount:1,Unassigned:0}],total:1,page:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1,page:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[{ID:1,CurrencyCode:'VND'}],materials:[]}});
  if(p==='/api/packaging/response/batch'){response=route.request().postDataJSON();return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewRowVersion:'AAAAAAAAAAI='}]}})}
  if(p.endsWith('/transition')){transition=route.request().postDataJSON();return route.fulfill({json:{result:{Stage:'Pending Review'}}})}
  return route.fulfill({json:{rows:[]}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View request'}).click();
 await expect(page.getByText('Request-time snapshot',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items'});
 await expect(table.getByRole('button',{name:'Sort by Category',exact:true})).toBeVisible();
 await expect(table.getByText('Roasted almonds',{exact:true})).toBeVisible();
 await expect(table.getByText('100',{exact:true}).first()).toBeVisible();
 await expect(table.getByRole('textbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(table.getByText('Pouch',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Packaging Responses',exact:true}).click();
 await expect(table.getByRole('button',{name:'Sort by Category',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const form=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await form.getByLabel('1st PM Type',{exact:true}).fill('Film');
 await form.getByLabel('2nd PM Type',{exact:true}).fill('Carton');
 await form.getByLabel('Unit / CTN',{exact:true}).fill('12');
 await form.getByLabel('Packaging description',{exact:true}).fill('Film pouch and carton');
 await form.getByLabel('1st PM MOQ',{exact:true}).fill('0');
 await form.getByLabel('2nd PM MOQ',{exact:true}).fill('50');
 await form.getByLabel('PM cost (VND)',{exact:true}).fill('1200');
 await form.getByLabel('Cost basis',{exact:true}).fill('per pack');
 await form.getByRole('button',{name:'Review & save'}).click();
 expect(response).toBeUndefined();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(form.getByRole('status')).toContainText('1 item(s) saved.');
 expect(response.rows[0]).toMatchObject({ID:7,FirstPMType:'Film',UnitsPerCarton:'12',FirstPMMOQ:'0',Cost:'1200',CurrencyID:1,CostBasis:'per pack',RowVersion:'AAAAAAAAAAE='});
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 expect(transition).toBeUndefined();
 await page.getByRole('dialog',{name:'Confirm response action'}).getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(()=>transition?.TargetStage).toBe('Pending Review');
});
