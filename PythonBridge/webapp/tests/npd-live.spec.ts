import {test,expect} from '@playwright/test';
test.skip(process.env.NPD_DESKTOP_LIVE!=='1','Opt in against the desktop API after migrations 154 through 157.');
test('desktop NPD pages and Recipe Request items load without writing data',async({page},info)=>{
 const failures:string[]=[];
 page.on('response',r=>{if(r.url().includes('/api/npd/')&&r.status()>=400)failures.push(r.status()+' '+r.url())});
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 for(const name of ['Ingredients Master','Ingredient Pricing','Recipe Sheets','Recipe Requests']){
  await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:['Ingredients Master','Ingredient Pricing'].includes(name)?'Refresh':'Refresh NPD',exact:true})).toBeEnabled();
 }
 await expect(page.getByRole('button',{name:'New Recipe Request',exact:true})).toHaveCount(0);
 const links=page.getByRole('button',{name:/^View items for RRQ-/});
 if(await links.count()){await links.first().click();await expect(page.getByRole('table',{name:'Recipe Request items',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Refresh Recipe Request items',exact:true})).toBeEnabled()}
 await page.screenshot({path:info.outputPath('desktop-recipe-request-items.png')});expect(failures).toEqual([]);
});

test('desktop Opportunity displays its linked Recipe Request and Recipe Sheet without writes',async({page},info)=>{
 const failures:string[]=[],writes:string[]=[];
 page.on('response',r=>{if(r.url().includes('/api/npd/')&&r.status()>=400)failures.push(r.status()+' '+r.url())});
 page.on('request',r=>{if(r.url().includes('/api/npd/')&&r.method()==='POST')writes.push(r.url())});
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Opportunities',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill('OPP-2026-10336');await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page.getByRole('table',{name:'Opportunity overview',exact:true}).locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Recipe Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity Recipe Request items',exact:true});await expect(table.getByRole('columnheader',{name:'Linked Recipe Sheet',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('desktop-opportunity-recipe-links.png')});
 await table.getByRole('button',{name:'View Recipe Request RRQ-0000000175 for item 3813986',exact:true}).click();const request=page.getByRole('dialog',{name:'RRQ-0000000175',exact:true});await expect(request.getByRole('heading',{name:'RRQ-0000000175',exact:true})).toBeVisible();
 const versions=request.getByRole('table',{name:'Recipe Sheet versions for PRD-0000000646',exact:true});await expect(versions.getByText('Current approved sheet',{exact:true})).toHaveCount(1);await expect(request.getByRole('button',{name:'Open RCP-0000000175',exact:true})).toHaveCount(0);await expect(versions.getByRole('button',{name:'View Recipe Sheet RCP-0000000175 version 1',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('desktop-recipe-sheet-versions.png')});
 await request.getByRole('button',{name:'Close recipe request',exact:true}).click();
 await table.getByRole('button',{name:'View Recipe Sheet RCP-0000000175 for item 3813986',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-0000000175',exact:true});await expect(sheet.getByLabel('Ratio line 1',{exact:true})).toBeDisabled();await expect(sheet.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('desktop-opportunity-linked-recipe-sheet.png')});await sheet.getByRole('button',{name:'Close',exact:true}).click();await expect(table).toBeVisible();expect(failures).toEqual([]);expect(writes).toEqual([]);
});

test('desktop Recipe Sheet filters and Recipe workflow branch use saved records',async({page},info)=>{
 const writes:string[]=[];page.on('request',r=>{if(r.url().includes('/api/npd/')&&r.method()==='POST')writes.push(r.url())});
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();
 const panel=page.locator('.npd-sheets-page');await panel.getByLabel('Code, description or reference',{exact:true}).fill('RCP-0000000175');await panel.getByLabel('PIC',{exact:true}).fill('hien.npd');await panel.getByLabel('Status',{exact:true}).selectOption('Approved');await panel.getByRole('button',{name:'Search',exact:true}).click();await expect(panel.getByRole('button',{name:'RCP-0000000175',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('desktop-recipe-sheet-filters.png')});
 await page.getByRole('navigation').getByRole('button',{name:'Opportunities',exact:true}).click();await page.getByLabel('Opportunity number',{exact:true}).fill('OPP-2026-10336');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.getByRole('table',{name:'Opportunity overview',exact:true}).locator('tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const card=page.getByRole('article',{name:'Stage for Item 2',exact:true}),branch=card.getByRole('region',{name:'Recipe branch from Product Review to TCB Review',exact:true});await expect(branch.locator('strong')).toHaveText(['Recipe Requested','PIC Assigned','Review Submitted','Review Result']);await card.scrollIntoViewIfNeeded();await card.screenshot({path:info.outputPath('desktop-recipe-stage-branch.png')});expect(writes).toEqual([]);
});
