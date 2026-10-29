import {test,expect} from '@playwright/test';
import {tcbColumnGroups} from '../src/tcb-columns';
// Opt-in, read-only integration check for the retained desktop review case.
const opportunity=process.env.DESKTOP_REVIEW_OPPORTUNITY;
test.skip(!opportunity,'Set DESKTOP_REVIEW_OPPORTUNITY to a retained desktop case.');

test('TCB balances the first grade ratio per level and puts packaging loss beside price',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByTitle('View items for '+opportunity,{exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:/^TCB Review for/}).first().click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('button',{name:'Analysis',exact:true})).toBeEnabled({timeout:20000});
 const first=dialog.getByLabel('Ratio 0/1',{exact:true}).first();
 await expect(first).toHaveAttribute('readonly','');
 await dialog.getByLabel('Ratio 0/2',{exact:true}).first().fill('35');
 await expect(first).toHaveValue('65');
 await dialog.getByLabel('Ratio 0/1/2',{exact:true}).first().fill('22.22');
 await expect(dialog.getByLabel('Ratio 0/1/1',{exact:true}).first()).toHaveValue('77.78');
 await expect(first).toHaveValue('65');
 const cell=dialog.locator('.tcb-packaging-price-loss').first();
 const price=await cell.locator('output').boundingBox();
 const loss=await cell.locator('input').boundingBox();
 expect(loss!.x-price!.x-price!.width).toBeLessThan(30);
 // No save: the retained review case stays unchanged.
});
test('Product structure shows each child packing way in the Opportunity editor',async({page})=>{
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','Admin');localStorage.setItem('bridge.opportunityLayout.1','current')});
 await page.goto('./');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity '+opportunity,exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 const parentWeight=editor.getByLabel('Net weight (g)',{exact:true}).first();
 await expect(parentWeight).toHaveAttribute('readonly','');
 await expect(parentWeight).toHaveValue('2800');
 await expect(editor.getByRole('button',{name:'Refresh Product weight for item 1',exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'View grade snapshot',exact:true}).first().click();
 const structure=page.getByRole('dialog',{name:'Product structure',exact:true});
 await expect(structure.getByRole('columnheader',{name:'Packing way',exact:true})).toBeVisible();
 const packingCells=structure.locator('tbody tr td:last-child');
 await expect(packingCells).toHaveText(['(3x2x1)x1','(2x1)x2','(1)x10']);
 expect(await structure.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
 await structure.screenshot({path:'../artifacts/qa-review/QA-MIX-1028-9628/packing-way-verified.png'});
 await structure.getByRole('button',{name:'Close product structure',exact:true}).click();
 await editor.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const childWeight=editor.getByLabel('Net weight (g)',{exact:true}).nth(1);
 await expect(childWeight).not.toHaveAttribute('readonly','');
 await childWeight.fill('210');
 await expect(parentWeight).toHaveValue('2860');
 await childWeight.fill('200');
 await expect(parentWeight).toHaveValue('2800');
});
test('retained Mix case opens with complete Analysis and current raw quote selections',async({page,request})=>{
 test.setTimeout(60000);
 const headers={'X-User-Name':'Admin'};
 const response=await request.get('http://127.0.0.1:8000/api/opportunity/grid?opportunity_number='+encodeURIComponent(opportunity!)+'&page=1&page_size=100',{headers});
 expect(response.ok()).toBeTruthy();const {rows}=await response.json();
 const entries=[];
 for(const row of rows)entries.push({row,tcb:await (await request.get('http://127.0.0.1:8000/api/opportunity/items/'+row.ItemID+'/tcb',{headers})).json()});
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','Admin');localStorage.setItem('bridge.opportunityLayout.1','current')});
 await page.goto('./');
 const columns=await page.evaluate(async entries=>{
  const {draftFromTCB}=await import('/workbench/src/tcb-draft.ts');
  const {buildTCBAnalysis}=await import('/workbench/src/tcb-analysis-model.ts');
  const {quantityDisplay}=await import('/workbench/src/packaging-summary-model.ts');
  return buildTCBAnalysis(entries.map((e:any)=>draftFromTCB(e.row,e.tcb)))[0].columns.map((c:any)=>({id:c.id,label:c.label,cells:c.cells.map((v:any)=>({value:v.value?quantityDisplay(v.value,12).replaceAll(',',''):null,issues:v.issues}))}));
 },entries);
 expect(columns).toHaveLength(3);
 for(const column of columns)for(const cell of column.cells)expect(cell.value,column.label+': '+cell.issues.join(' ')).not.toBeNull();
 const fields=tcbColumnGroups.flatMap(group=>Object.keys(group.fields));
 for(const column of columns){
  const row=rows.find((r:any)=>r.ItemID===column.id);
  for(const [i,key] of fields.entries())expect(Math.abs(Number(column.cells[i].value)-Number(row[key])),column.label+' '+key).toBeLessThanOrEqual(.000001);
 }
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByTitle('View items for '+opportunity,{exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:/^TCB Review for/}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('button',{name:'Analysis',exact:true})).toBeEnabled({timeout:20000});
 const pickers=dialog.getByRole('combobox',{name:/^Raw price item/});
 await expect(pickers).toHaveCount(6);
 for(const picker of await pickers.all())expect(await picker.locator('option:checked').innerText()).not.toContain('unavailable');
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const table=dialog.getByRole('table',{name:'Opportunity item analysis',exact:true});
 await expect(table).toBeVisible({timeout:20000});
 await expect(table.getByText('Incomplete',{exact:true})).toHaveCount(0);
 await expect(table.getByRole('rowheader',{name:'Product',exact:true})).toBeVisible();
 await dialog.screenshot({path:'../artifacts/qa-review/QA-MIX-1028-9628/analysis-verified.png'});
});
