import {test,expect} from '@playwright/test';
import type {Locator} from '@playwright/test';
test.skip(process.env.DESKTOP_PACKING_GROUP_CHECK!=='1','Opt-in read-only check of retained packaging case.');
test('saved four-layer response keeps quantities and pricing within each layer section',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-33493',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 await expect(packing.getByLabel('Quaternary gross weight (g)',{exact:true})).toHaveValue('7,520');
 for(const width of [1920,1366]){
  await page.setViewportSize({width,height:1080});
  for(const layer of ['Primary','Secondary','Tertiary','Quaternary']){
   const section=packing.getByRole('region',{name:layer+' packaging response',exact:true});
   const quantity=await section.locator('.packing-way-layer').boundingBox();
   const pricing=await section.locator('.response-layer-pricing').boundingBox();
   expect(pricing!.y).toBeGreaterThanOrEqual(quantity!.y+quantity!.height);
   await expect(section.getByLabel(layer+' Type',{exact:true})).toBeVisible();
  }
  expect(await packing.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await packing.screenshot({path:'../artifacts/qa-review/QA-LAYOUT-1029-90C6/grouped-packing-'+width+'.png'});
 }
});

async function checkRequirementCards(scope:Locator){
 const cards=scope.locator('.packaging-request-layers>section');
 await expect(cards).toHaveCount(4);
 const colors=[];
 for(const card of await cards.all()){
  const fields=card.locator('.packaging-entry-grid');
  const boxes=await fields.locator(':scope>*').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width}}));
  expect(boxes).toHaveLength(6);
  expect(Math.max(...boxes.slice(0,4).map(b=>b.width))-Math.min(...boxes.slice(0,4).map(b=>b.width))).toBeLessThan(2);
  expect(Math.max(...boxes.slice(0,4).map(b=>b.y))-Math.min(...boxes.slice(0,4).map(b=>b.y))).toBeLessThan(2);
  expect(boxes[5].y).toBeGreaterThan(boxes[0].y);
  expect(boxes[5].width).toBeGreaterThan(boxes[0].width*2.8);
  colors.push(await card.evaluate(el=>getComputedStyle(el).backgroundColor));
 }
 expect(new Set(colors).size).toBe(4);
 const pallet=scope.getByRole('region',{name:'Palletization request',exact:true});
 const grid=await pallet.locator('.pallet-requirement-grid').boundingBox();
 const comments=await pallet.locator('.requirement-comments').boundingBox();
 expect(comments!.width).toBeGreaterThan(grid!.width*.98);
}

test('Opportunity and Packaging Request share colored four-column requirements and wide comments',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('bridge.testUser','Admin'));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill('OPP-2026-10336');await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity OPP-2026-10336',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await expect(editor.getByText('Loading customers and products...',{exact:true})).toHaveCount(0);
 const item=editor.getByRole('region',{name:'Item 4',exact:true});
 await item.locator('summary').filter({hasText:'Packaging requirements'}).click();
 await checkRequirementCards(item);
 await item.locator('.packaging-request-layers').screenshot({path:'../artifacts/qa-review/QA-LAYOUT-1029-90C6/opportunity-requirement-colors.png'});
 await editor.getByRole('button',{name:'Close Opportunity form',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-33493',exact:true}).click();
 const request=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await request.locator('summary').filter({hasText:/^Packaging request$/}).click();
 await checkRequirementCards(request);
 await request.locator('.packaging-request-layers').screenshot({path:'../artifacts/qa-review/QA-LAYOUT-1029-90C6/request-requirement-colors.png'});
});
