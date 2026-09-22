import {test,expect} from '@playwright/test';
test('create links files to returned request item; failed upload survives reload with the same key',async({page})=>{
 let createCount=0;const uploads:{url:string;body:string}[]=[];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let body:unknown;
  if(url.pathname.endsWith('/session'))body={username:'Admin',scopes:['Admin'],is_admin:true};
  else if(url.pathname==='/api/opportunity/grid')body={total:1,page:1,rows:[{OpportunityID:1,OpportunityNumber:'OPP-1',CustomerName:'Customer',HeaderStage:'Draft',HeaderRowVersion:'AAAAAAAAAAE=',ItemID:11,ProductCode:'P1',ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAE='}]};
  else if(url.pathname==='/api/packaging/manual'){createCount++;body={header:{RequestNumber:'PKG-1'},items:[{ID:901,OpportunityItemID:11}],replayed:false}}
  else if(request.method()==='PUT'){
   uploads.push({url:request.url(),body:request.postDataBuffer()!.toString()});
   if(uploads.length===1)return route.fulfill({status:500,json:{detail:'Temporary upload failure'}});
   body={attachment:{ID:'test'}};
  }else return route.fulfill({status:500,json:{detail:'Unexpected request'}});
  return route.fulfill({json:body});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details'}).click();
 await page.getByRole('checkbox',{name:'Select P1 item 11'}).check();
 await page.getByLabel('Files for item 11').setInputFiles({name:'drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfile content')});
 await page.getByLabel('Response due',{exact:true}).fill('2099-10-01');
 await page.getByRole('button',{name:'Create Packaging Request (1)'}).click();await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByText('Temporary upload failure')).toBeVisible();
 expect(createCount).toBe(1);
 expect(uploads[0].url).toContain('/items/901/attachments/');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByText('Temporary upload failure')).toBeVisible();
 await page.getByRole('button',{name:'Retry attachments',exact:true}).click();
 await expect(page.getByRole('region',{name:'Attachment upload queue'})).toHaveCount(0);
 expect(uploads).toHaveLength(2);expect(uploads[1]).toEqual(uploads[0]);expect(createCount).toBe(1);
});
