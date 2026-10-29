import {test,expect} from '@playwright/test';
import {tcbColumnGroups} from '../src/tcb-columns';
const opportunity=process.env.DESKTOP_FOUR_LAYER_OPPORTUNITY;
test.skip(!opportunity,'Opt-in desktop standalone four-layer case.');
test('four-layer saved case, compact header, request comments and in-place TCB comparisons',async({page,request})=>{
 test.setTimeout(60000);
 const headers={'X-User-Name':'Admin'};
 const grid=await (await request.get('http://127.0.0.1:8000/api/opportunity/grid?opportunity_number='+opportunity+'&page=1&page_size=100',{headers})).json();
 expect(grid.rows).toHaveLength(1);const row=grid.rows[0];expect(row.ParentItemID).toBeNull();expect(row.ResponseLayerCount).toBe(4);
 const tcb=await (await request.get('http://127.0.0.1:8000/api/opportunity/items/'+row.ItemID+'/tcb',{headers})).json();
 const req=await (await request.get('http://127.0.0.1:8000/api/packaging/requests?request_id='+row.PackagingRequestID+'&page=1&page_size=100&sort=[]',{headers})).json();
 expect(req.rows[0].PalletSpecialComments).toBe(row.PalletSpecialComments);
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','Admin');localStorage.setItem('bridge.opportunityLayout.1','current')});await page.goto('./');
 const cells=await page.evaluate(async({row,tcb})=>{
  const {draftFromTCB}=await import('/workbench/src/tcb-draft.ts');const {buildTCBAnalysis}=await import('/workbench/src/tcb-analysis-model.ts');
  const {quantityDisplay}=await import('/workbench/src/packaging-summary-model.ts');
  return buildTCBAnalysis([draftFromTCB(row,tcb)])[0].columns[0].cells.map((c:any)=>c.value?quantityDisplay(c.value,12).replaceAll(',',''):null);
 },{row,tcb});
 for(const [i,key] of tcbColumnGroups.flatMap(g=>Object.keys(g.fields)).entries()){
  expect(cells[i],key).not.toBeNull();expect(Math.abs(Number(cells[i])-Number(row[key])),key).toBeLessThan(.000001);
 }
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill(opportunity!);await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity '+opportunity,exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 const boxes=await Promise.all(['Bid open','Bid close','Exchange rate VND per USD *','Exchange rate Customer Currency per USD *'].map(name=>editor.getByLabel(name,{exact:true}).boundingBox()));
 expect(Math.max(...boxes.map(b=>b!.width))-Math.min(...boxes.map(b=>b!.width))).toBeLessThan(2);
 expect((await editor.getByLabel('Description *',{exact:true}).boundingBox())!.width).toBeGreaterThan(boxes[0]!.width*2);
 await editor.locator('summary').filter({hasText:'Packaging requirements'}).click();
 const pallet=editor.getByRole('region',{name:'Palletization request',exact:true});
 await expect(pallet.getByLabel('Special comments',{exact:true})).toHaveValue(row.PalletSpecialComments);
 await editor.screenshot({path:'../artifacts/qa-review/QA-4L-1029-88DA/opportunity-verified.png'});
 await editor.getByRole('button',{name:'Close Opportunity form',exact:true}).click();
 await page.getByTitle('View items for '+opportunity,{exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:/^TCB Review for/}).click();
 const review=page.getByRole('dialog',{name:'TCB Review',exact:true});
 for(const name of ['Primary','Secondary','Tertiary','Quaternary'])await expect(review.getByRole('columnheader',{name:new RegExp('^'+name+' PM')})).toBeVisible();
 const loss=review.getByLabel('Packaging loss ratio item '+row.ItemID+' layer 4',{exact:true});
 await loss.fill('4.25');
 for(const name of ['Compare TCB versions','Compare opportunity items']){
  await review.getByRole('button',{name,exact:true}).click();
  await expect(review.getByRole('region',{name,exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name,exact:true})).toHaveCount(0);
  await expect(review.getByRole('table',{name,exact:true})).toBeVisible();
  await review.screenshot({path:'../artifacts/qa-review/QA-4L-1029-88DA/'+(name==='Compare TCB versions'?'versions':'items')+'-verified.png'});
  await review.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
  await expect(review.getByRole('heading',{name:'Recipe Info',exact:true})).toBeVisible();
  await expect(loss).toHaveValue('4.25');
 }
 await loss.fill('4');
 await review.getByRole('button',{name:'Analysis',exact:true}).click();
 await expect(review.getByText('Incomplete',{exact:true})).toHaveCount(0);
 await review.screenshot({path:'../artifacts/qa-review/QA-4L-1029-88DA/analysis-verified.png'});
});
