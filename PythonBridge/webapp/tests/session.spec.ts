import {test,expect,type Page} from '@playwright/test';
async function mock(page:Page){
 let identity={user_id:1,username:'Alice',scopes:['Customer'],is_admin:false},fail=false,calls=0,writes=0;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session')){calls++;return fail?route.fulfill({status:401,json:{detail:'Username is incorrect.'}}):route.fulfill({json:identity})}
  if(route.request().method()==='POST')writes++;
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[{ID:1,MarketCode:'US'}],currencies:[{ID:2,CurrencyCode:'USD'}]}});
  if(path==='/api/customer')return route.fulfill({json:{rows:[],total:0,page:1}});
  return route.fulfill({status:404,json:{detail:'Not configured in test'}});
 });
 return {setIdentity:(id:number,name:string)=>{identity={...identity,user_id:id,username:name}},fail:(v:boolean)=>{fail=v},calls:()=>calls,writes:()=>writes};
}
test('login, exact idle boundary and same-user draft restoration',async({page})=>{
 await page.clock.install();const state=await mock(page);await page.goto('./');
 await expect(page.getByRole('dialog',{name:'Sign in',exact:true})).toBeVisible();
 await expect(page.getByText('Presales PL3.0',{exact:true})).toBeVisible();
 await expect(page).toHaveTitle('Presales PL3.0');
 expect(state.calls()).toBe(0);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New customer',exact:true}).click();
 await page.getByRole('dialog',{name:'New customer'}).getByLabel('Customer name *').fill('Unsaved draft');
 await page.clock.runFor(599000);
 await expect(page.getByRole('dialog',{name:'Session locked'})).toHaveCount(0);
 await page.clock.runFor(1001);
 await expect(page.getByRole('dialog',{name:'Session locked'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'New customer'})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Session locked'})).toBeVisible();
 await page.getByRole('button',{name:'Sign in to resume'}).click();
 await expect(page.getByRole('dialog',{name:'New customer'}).getByLabel('Customer name *')).toHaveValue('Unsaved draft');
 expect(state.calls()).toBe(2);expect(state.writes()).toBe(0);
});
test('activity extends timeout; failed or different identity cannot reveal work',async({page})=>{
 await page.clock.install();const state=await mock(page);await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New customer',exact:true}).click();await page.getByLabel('Customer name *').fill('Private draft');
 await page.clock.runFor(540000);await page.getByLabel('Customer name *').press('ArrowLeft');
 await page.clock.runFor(120000);await expect(page.getByRole('dialog',{name:'Session locked'})).toHaveCount(0);
 await page.clock.runFor(480001);await expect(page.getByRole('dialog',{name:'Session locked'})).toBeVisible();
 state.fail(true);await page.getByRole('button',{name:'Sign in to resume'}).click();await expect(page.getByRole('alert')).toContainText('Username is incorrect');
 state.fail(false);state.setIdentity(2,'Bob');await page.getByRole('button',{name:'Sign in to resume'}).click();
 await expect(page.getByRole('alert')).toContainText('Sign in as Alice');
 await expect(page.getByRole('dialog',{name:'New customer'})).toHaveCount(0);
 state.setIdentity(1,'Alice');await page.getByRole('button',{name:'Sign in to resume'}).click();
 await expect(page.getByLabel('Customer name *')).toHaveValue('Private draft');
});
test('sleep/resume checks elapsed wall time before allowing interaction',async({page})=>{
 await page.clock.install();await mock(page);await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.clock.setSystemTime(new Date(Date.now()+11*60*1000));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('dialog',{name:'Session locked'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'test-results/login-mobile.png',fullPage:true});
});
