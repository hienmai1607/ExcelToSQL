import {test,expect} from '@playwright/test';

const opportunity=process.env.NPD_COMPLEX_REVIEW;
const requestNumber=process.env.NPD_COMPLEX_REQUEST;
test.skip(!opportunity||!requestNumber,'Opt-in read-only retained desktop review case.');

test('retained complex review has complete Analysis and approved-only recipe links',async({page,request},info)=>{
 test.setTimeout(120000);
 const headers={'X-User-Name':'Admin'};
 const response=await request.get('http://127.0.0.1:8000/api/opportunity/grid?opportunity_number='+opportunity+'&page=1&page_size=100',{headers});
 expect(response.ok()).toBeTruthy();const {rows}=await response.json();
 expect(rows).toHaveLength(7);expect(rows.filter((r:any)=>!r.ParentItemID)).toHaveLength(4);
 const writes:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&r.method()==='POST'&&!r.url().includes('/session')&&!r.url().endsWith('/preview')&&!r.url().endsWith('/loss-formula')&&!r.url().endsWith('/eligibility'))writes.push(r.url())});
 page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(r.status()+' '+r.url())});
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeEnabled();
 await expect(page.getByRole('table',{name:'Opportunity overview',exact:true}).locator('tbody tr').first()).toBeVisible();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page.getByRole('table',{name:'Opportunity overview',exact:true}).locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Recipe Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity Recipe Request items',exact:true});
 const child=rows.find((r:any)=>r.ProductCode==='PRD-0000000642');
 await table.getByRole('button',{name:'View Recipe Request '+requestNumber+' for item '+child.ItemID,exact:true}).click();
 const req=page.getByRole('dialog',{name:requestNumber,exact:true});
 await expect(req.getByRole('heading',{name:requestNumber!,exact:true})).toBeVisible({timeout:30000});
 const versions=req.getByRole('table',{name:'Recipe Sheet versions for PRD-0000000642',exact:true});
 await expect(versions.locator('tbody tr')).toHaveCount(2);
 await expect(versions.getByText('Current approved sheet',{exact:true})).toHaveCount(1);
 await expect(versions.getByText('Draft',{exact:true})).toHaveCount(2);
 await req.screenshot({path:info.outputPath('recipe-versions.png')});
 await req.getByRole('button',{name:'Close recipe request',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 for(let index=0;index<4;index++){
  await page.getByRole('button',{name:/^TCB Review for/}).nth(index).click();
  const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
  await expect(dialog.getByRole('button',{name:'Analysis',exact:true})).toBeEnabled({timeout:20000});
  await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
  await expect(dialog.getByRole('table',{name:'Opportunity item analysis',exact:true})).toBeVisible();
  await expect(dialog.getByText('Incomplete',{exact:true})).toHaveCount(0);
  await dialog.screenshot({path:info.outputPath('analysis-item-'+(index+1)+'.png')});
  await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 }
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('NPD manager can inspect the retained pending revision and approval controls',async({page},info)=>{
 const errors:string[]=[],writes:string[]=[];
 page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)errors.push(r.status()+' '+r.url())});
 page.on('request',r=>{if(r.url().includes('/api/npd/')&&r.method()==='POST'&&!r.url().endsWith('/preview'))writes.push(r.url())});
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','hien.mai'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeEnabled();
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh NPD',exact:true})).toBeEnabled();
 await page.getByLabel('Code, description or reference',{exact:true}).fill(requestNumber!);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'View items for '+requestNumber,exact:true}).click();
 const table=page.getByRole('table',{name:'Recipe Request items',exact:true});
 await expect(table.locator('tbody tr')).toHaveCount(5);
 const pending=table.locator('tbody tr').filter({has:page.getByRole('button',{name:'Open Recipe Request item PRD-0000000647',exact:true})});
 await expect(pending.getByRole('combobox')).toHaveCount(0);
 await pending.getByRole('button',{name:'Review Recipe Sheet for PRD-0000000647',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:/^RCP-/});
 await expect(sheet.getByText('Approval: Pending',{exact:true})).toBeVisible();
 await expect(sheet.getByLabel('Ratio line 1',{exact:true})).toBeEnabled();
 await expect(sheet.getByRole('button',{name:'Approve recipe',exact:true})).toBeEnabled();
 await expect(sheet.getByRole('button',{name:'Save changes',exact:true})).toBeEnabled();
 await sheet.screenshot({path:info.outputPath('manager-pending-review.png')});
 await sheet.getByRole('button',{name:'Close',exact:true}).click();
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});
