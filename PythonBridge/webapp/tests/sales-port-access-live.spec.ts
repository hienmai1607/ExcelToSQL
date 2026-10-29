import {test,expect} from '@playwright/test';

test.skip(process.env.DESKTOP_SALES_PORT_CHECK!=='1','Opt-in check of desktop Sales Port of Entry access.');
test('hien.sales can open Add and Edit Port of Entry from Opportunity',async({page,request})=>{
 const headers={'X-User-Name':'hien.sales'};
 const session=await (await request.get('http://127.0.0.1:8000/api/workbench/session',{headers})).json();
 expect(session.permissions.ports).toBe('edit');expect(session.is_admin).toBe(false);
 const lookups=await (await request.get('http://127.0.0.1:8000/api/opportunity/lookups',{headers})).json();
 const port=lookups.ports.find((p:any)=>lookups.customers.some((c:any)=>c.ID===p.CustomerID&&c.MarketID===p.MarketID));
 expect(port).toBeTruthy();
 await page.addInitScript(()=>{sessionStorage.setItem('bridge.testUser','hien.sales');localStorage.setItem('bridge.opportunityLayout.13285','current')});
 await page.goto('./');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await editor.locator('summary').filter({hasText:'Shipment, Logistics, Co-Man & Others info'}).click();
 const add=editor.getByRole('button',{name:'Add new Port of Entry master',exact:true});
 await expect(add).toBeVisible();await expect(add).toBeDisabled();
 await editor.getByLabel('Customer *',{exact:true}).selectOption(String(port.CustomerID));
 await expect(add).toBeEnabled();await add.click();
 const create=page.getByRole('dialog',{name:'New Port of Entry',exact:true});
 await expect(create).toBeVisible();
 await create.getByRole('button',{name:/^Close/}).click();
 await editor.getByLabel('Port of Entry',{exact:true}).selectOption(String(port.ID));
 await editor.getByRole('button',{name:'Modify Port of Entry master',exact:true}).click();
 const edit=page.getByRole('dialog',{name:'Edit Port of Entry',exact:true});
 await expect(edit.getByLabel('Port name',{exact:true})).toHaveValue(port.PortName);
 await edit.screenshot({path:'../artifacts/permission-checks/hien-sales-port-edit.png'});
});
