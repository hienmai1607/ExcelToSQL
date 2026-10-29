import {test,expect} from '@playwright/test';
test.skip(true,'Testing layout was withdrawn; retained case is available in previous layout.');
import {tcbColumnGroups} from '../src/tcb-columns';
const opportunity=process.env.DESKTOP_MULTI_ITEM_REVIEW;
const output=process.env.DESKTOP_MULTI_ITEM_ARTIFACTS||'../artifacts/layout-testing';
test.skip(!opportunity,'Opt-in retained desktop four-item review case, read-only.');

test('four main items, Mix family, approved packaging and complete TCB in Testing layout',async({page,request})=>{
 test.setTimeout(90000);
 const headers={'X-User-Name':'Admin'};
 const grid=await request.get('http://127.0.0.1:8000/api/opportunity/grid?opportunity_number='+opportunity+'&page=1&page_size=100',{headers});
 expect(grid.ok()).toBeTruthy();const {rows}=await grid.json();
 expect(rows).toHaveLength(7);expect(rows.filter((r:any)=>!r.ParentItemID)).toHaveLength(4);
 const entries=[];
 for(const row of rows){
  const result=await request.get('http://127.0.0.1:8000/api/opportunity/items/'+row.ItemID+'/tcb',{headers});
  expect(result.ok()).toBeTruthy();entries.push({row,tcb:await result.json()});
 }
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','Admin');localStorage.setItem('bridge.opportunityLayout.1','testing')});
 await page.goto('./');
 const scenarios=await page.evaluate(async entries=>{
  const {draftFromTCB}=await import('/workbench/src/tcb-draft.ts');
  const {buildTCBAnalysis}=await import('/workbench/src/tcb-analysis-model.ts');
  const {quantityDisplay}=await import('/workbench/src/packaging-summary-model.ts');
  return buildTCBAnalysis(entries.map((e:any)=>draftFromTCB(e.row,e.tcb))).map((s:any)=>({label:s.label,columns:s.columns.map((c:any)=>({id:c.id,label:c.label,cells:c.cells.map((v:any)=>({value:v.value?quantityDisplay(v.value,12).replaceAll(',',''):null,issues:v.issues}))}))}));
 },entries);
 expect(scenarios).toHaveLength(4);
 expect(scenarios.map(s=>s.columns.length)).toEqual([3,1,1,1]);
 const fields=tcbColumnGroups.flatMap(g=>Object.keys(g.fields));
 for(const scenario of scenarios){
  for(const column of scenario.columns)for(const cell of column.cells)expect(cell.value,column.label+': '+cell.issues.join(' ')).not.toBeNull();
 }
 // Reconcile the selected Sales scenario against persisted grid calculations.
 for(const scenario of scenarios)for(const column of scenario.columns){
  const row=rows.find((r:any)=>r.ItemID===column.id);
  if(scenario.label!==String(row.ContainerRequest))continue;
  for(const [i,key] of fields.entries())expect(Math.abs(Number(column.cells[i].value)-Number(row[key])),column.label+' '+key).toBeLessThanOrEqual(.000001);
 }
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity '+opportunity,exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await expect(editor.getByText('Layout testing',{exact:true})).toBeVisible();
 const summary=editor.getByRole('table',{name:'Opportunity item summary',exact:true});
 await expect(summary.locator('tbody tr')).toHaveCount(7);
 await expect(editor.getByText('Loading customers and products...',{exact:true})).toHaveCount(0);
 for(const n of ['1','1.1','1.2','1.3','2','3','4'])await expect(summary.getByRole('button',{name:'Edit details item '+n,exact:true})).toBeVisible();
 expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
 await editor.screenshot({path:output+'/opportunity-summary.png'});
 await editor.getByRole('button',{name:'Edit details item 4',exact:true}).click();
 await editor.getByRole('tab',{name:'Packaging',exact:true}).click();
 for(const layer of ['Primary','Secondary','Tertiary','Quaternary']){
  await editor.getByRole('group',{name:'Packaging layers',exact:true}).getByRole('button',{name:layer,exact:true}).click();
  await expect(editor.getByLabel(layer+' Type',{exact:true})).toBeVisible();
 }
 await editor.screenshot({path:output+'/four-layer-item.png'});
 await editor.getByRole('button',{name:'Back to items',exact:true}).click();
 await editor.getByRole('tab',{name:'Product Info',exact:true}).click();
 await editor.getByRole('button',{name:'Edit details item 1',exact:true}).click();
 await expect(editor.getByLabel('Net weight (g)',{exact:true})).toHaveValue('2800');
 await expect(editor.getByLabel('Net weight (g)',{exact:true})).toHaveAttribute('readonly','');
 await editor.getByRole('button',{name:'View grade snapshot',exact:true}).click();
 const structure=page.getByRole('dialog',{name:'Product structure',exact:true});
 await expect(structure.locator('tbody tr td:last-child')).toHaveText(['(3x2x1)x1','(2x1)x2','(1)x10']);
 await structure.screenshot({path:output+'/mix-structure.png'});
 await structure.getByRole('button',{name:'Close product structure',exact:true}).click();
 await editor.getByRole('button',{name:'Close Opportunity form',exact:true}).click();
 await page.getByTitle('View items for '+opportunity,{exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 for(let i=0;i<4;i++){
  await page.getByRole('button',{name:/^TCB Review for/}).nth(i).click();
  const review=page.getByRole('dialog',{name:'TCB Review',exact:true});
  await expect(review.getByRole('button',{name:'Analysis',exact:true})).toBeEnabled({timeout:20000});
  await review.getByRole('button',{name:'Analysis',exact:true}).click();
  await expect(review.getByRole('table',{name:'Opportunity item analysis',exact:true})).toBeVisible();
  await expect(review.getByText('Incomplete',{exact:true})).toHaveCount(0);
  await review.screenshot({path:output+'/tcb-analysis-item-'+(i+1)+'.png'});
  await review.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 }
});
