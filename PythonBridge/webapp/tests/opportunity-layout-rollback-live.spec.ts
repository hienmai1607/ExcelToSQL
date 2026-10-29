import {test,expect} from '@playwright/test';
test.skip(process.env.DESKTOP_LAYOUT_ROLLBACK_CHECK!=='1','Opt-in read-only desktop rollback check.');

test('saved Testing preference cannot enable the retired layout',async({page})=>{
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','Admin');localStorage.setItem('bridge.opportunityLayout.1','testing')});
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Opportunity number',{exact:true}).fill('OPP-2026-10336');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('button',{name:'Edit Opportunity OPP-2026-10336',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await expect(editor.getByRole('group',{name:'Opportunity layout',exact:true})).toHaveCount(0);
 await expect(editor.getByText('Layout testing',{exact:true})).toHaveCount(0);
 await expect(editor.getByRole('table',{name:'Opportunity item summary',exact:true})).toHaveCount(0);
 await expect(editor.getByRole('tablist',{name:'Opportunity sections',exact:true})).toHaveCount(0);
 await expect(editor.getByRole('heading',{name:'Item Details (4)',exact:true})).toBeVisible();
 await expect(editor.getByLabel('Net weight (g)',{exact:true})).toHaveCount(4);
 await expect(editor.getByLabel('Net weight (g)',{exact:true}).first()).toHaveValue('2800');
 await expect(editor.getByLabel('Net weight (g)',{exact:true}).first()).toHaveAttribute('readonly','');
 await expect(editor.getByText('Loading customers and products...',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(editor.getByLabel('Net weight (g)',{exact:true})).toHaveCount(7);
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeVisible();
 await editor.screenshot({path:'../artifacts/layout-testing/previous-layout-restored.png'});
});
