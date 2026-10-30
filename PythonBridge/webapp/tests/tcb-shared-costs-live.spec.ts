import {test,expect,type Page} from '@playwright/test';
test.skip(process.env.DESKTOP_TCB_SHARED_CHECK!=='1','Opt-in desktop review case; writes intercepted.');
const number='OPP-2026-10336';
async function open(page:Page){
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(number);await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByTitle('View items for '+number,{exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:/^TCB Review for/}).first().click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('button',{name:'Analysis',exact:true})).toBeEnabled({timeout:40000});
 return dialog;
}
test('parent packing, processing yield, dual currencies and shared final-box totals agree in live TCB',async({page})=>{
 test.setTimeout(60000);
 const writes:any[]=[];
 await page.route('**/api/opportunity/items/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'&&!path.endsWith('/preview')&&!path.endsWith('/loss-formula')){
   writes.push(route.request().postDataJSON());return route.fulfill({status:422,json:{detail:'Read-only test: save captured without writing.'}});
  }
  return route.continue();
 });
 const dialog=await open(page);
 const packing=dialog.getByLabel(/^Packing cost \(USD\/lbs\) item/);
 await expect(packing).toHaveCount(1);await expect(packing).toHaveValue('0.242857');
 await expect(dialog.getByLabel('Floor load cost (USD/MT)',{exact:true})).toHaveValue('20.00');
 const packingBox=await packing.boundingBox(),palletBox=await dialog.getByLabel('Floor load cost (USD/MT)',{exact:true}).boundingBox();
 expect(packingBox!.x).toBeLessThan(palletBox!.x);
 await expect(dialog.getByLabel(/^Total RM w\/o Loss item/).first()).toContainText('3.07 USD');
 await packing.fill('.35');
 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).first().fill('.5');
 const processing=dialog.getByLabel(/^Processing with Loss 0\/1 item/).first();
 expect(Number((await processing.innerText()).split(' ')[0])).toBeGreaterThan(.5);
 await dialog.screenshot({path:'../artifacts/layout-testing/tcb-shared-inputs.png'});
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const table=dialog.getByRole('table',{name:'Opportunity item analysis',exact:true});
 await expect(table).toBeVisible();await expect(table.getByText('Incomplete',{exact:true})).toHaveCount(0);
 const scroll=dialog.getByRole('region',{name:'Opportunity item analysis table',exact:true});
 const header=table.locator('thead th').first();
 const initialHeader=await header.boundingBox();
 await scroll.evaluate(el=>{el.scrollTop=450});
 await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(200);
 expect(Math.abs((await header.boundingBox())!.y-initialHeader!.y)).toBeLessThan(2);
 await expect(header).toBeVisible();
 await dialog.screenshot({path:'../artifacts/layout-testing/tcb-analysis-frozen-header.png'});
 await scroll.evaluate(el=>{el.scrollTop=0});

 for(const term of ['FOB','CFR','DDP']){
  const row=table.getByRole('rowheader',{name:term+' (per final box)',exact:true}).locator('..');
  await expect(row.locator('td')).toHaveCount(4);await expect(row.locator('td').first()).toHaveAttribute('colspan','3');
  for(const cell of await row.locator('td').all())await expect(cell).toHaveText(/^\d[\d,]*\.\d{2} USD \/ \d[\d,]*\.\d{2} AUD$/);
  await expect(table.getByRole('rowheader',{name:term,exact:true}).locator('..').locator('td').first()).toContainText('USD /');
 }
 await expect(table.getByRole('rowheader',{name:'DDP (customer currency)',exact:true})).toHaveCount(0);
 const packingRow=table.getByRole('rowheader',{name:'Packing',exact:true}).locator('..');
 expect((await packingRow.locator('td').allTextContents()).slice(0,3)).toEqual(['0.15 USD','0.12 USD','0.08 USD']);
 await dialog.screenshot({path:'../artifacts/layout-testing/tcb-final-box-analysis.png'});
 await dialog.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Confirm save',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0].CostInputs.PackingUSDPerLb).toBe('.35');
});

test('saved Mix comparison merges final-box totals across the complete family',async({page})=>{
 test.setTimeout(60000);
 const dialog=await open(page);
 const root=await dialog.getByLabel(/^Packing cost \(USD\/lbs\) item/).getAttribute('aria-label');
 const id=root!.split(' ').at(-1)!;
 await dialog.getByRole('button',{name:'Compare TCB versions',exact:true}).click();
 await dialog.getByLabel('Compare versions for item',{exact:true}).selectOption(id);
 const table=dialog.getByRole('table',{name:'Compare TCB versions',exact:true});
 await expect(table.locator('thead th')).toHaveCount(4);
 for(const term of ['FOB','CFR','DDP']){
  const cell=table.getByRole('rowheader',{name:term+' (per final box)',exact:true}).locator('..').locator('td');
  await expect(cell).toHaveCount(1);await expect(cell).toHaveAttribute('colspan','3');
 }
 await expect(table.getByText('Incomplete',{exact:true})).toHaveCount(0);
 await dialog.screenshot({path:'../artifacts/layout-testing/tcb-final-box-comparison.png'});
});

for(const title of ['Compare TCB versions','Compare opportunity items'])test(title+' keeps the complete header visible while scrolling',async({page})=>{
 test.setTimeout(60000);
 const dialog=await open(page);
 await dialog.getByRole('button',{name:title,exact:true}).click();
 const table=dialog.getByRole('table',{name:title,exact:true});
 await expect(table).toBeVisible({timeout:40000});
 const scroll=dialog.getByRole('region',{name:title+' table',exact:true});
 const header=table.locator('thead th').first();
 const before=await header.boundingBox();
 await scroll.evaluate(el=>{el.scrollTop=500});
 await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(200);
 const after=await header.boundingBox();
 expect(Math.abs(after!.y-before!.y)).toBeLessThan(2);
 const heading=await dialog.locator(':scope > header').boundingBox();
 expect(after!.y).toBeGreaterThanOrEqual(heading!.y+heading!.height);
 await dialog.screenshot({path:'../artifacts/layout-testing/'+(title.includes('versions')?'tcb-versions-frozen-header':'tcb-items-frozen-header')+'.png'});
});

for(const mode of ['Pallet load','Floor load'])test(mode+' shows the corresponding loading rate',async({page})=>{
 test.setTimeout(60000);
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();
  if(!response.headers()['content-type']?.includes('application/json'))return route.fulfill({response});
  const data=await response.json();
  function change(value:any){
   if(!value||typeof value!=='object')return;
   if('ConfigurationRequest' in value)value.ConfigurationRequest=mode;
   Object.values(value).forEach(change);
  }
  change(data);await route.fulfill({response,json:data});
 });
 const dialog=await open(page);
 const label=mode==='Pallet load'?'Palletization ($/EA)':'Floor load cost (USD/MT)';
 await expect(dialog.getByLabel(label,{exact:true})).toHaveValue(mode==='Pallet load'?'11.32':'20.00');
 await expect(dialog.getByLabel(label,{exact:true})).toHaveAttribute('readonly','');
 await expect(dialog.getByLabel(mode==='Pallet load'?'Floor load cost (USD/MT)':'Palletization ($/EA)',{exact:true})).toHaveCount(0);
 await page.unrouteAll({behavior:'wait'});
});
