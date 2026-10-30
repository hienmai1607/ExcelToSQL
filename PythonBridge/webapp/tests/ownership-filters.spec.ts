import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page){
 const queries:URL[]=[];let profile:any={version:0,settings:{requests:{header:{field_version:8,columns:['RequestNumber','ItemCount','Unassigned','RequestedByName'],sort:[],filters:['search','status'],values:{},page_size:5}}}};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'PIC.A',user_id:2,scopes:['Admin'],is_admin:true}});
  if(path.endsWith('/preferences')){
   if(request.method()==='POST')profile={version:profile.version+1,settings:request.postDataJSON().settings};
   return route.fulfill({json:profile});
  }
  if(path==='/api/opportunity/grid'){
   queries.push(url);return route.fulfill({json:{rows:[{OpportunityID:1,OpportunityNumber:'OPP-1',CustomerName:'Customer',HeaderStage:'Draft',ItemCount:1}],total:12,page:Number(url.searchParams.get('page'))}});
  }
  if(path==='/api/workbench/requests'){
   queries.push(url);return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:3,Unassigned:1,AssignedToMe:2,RequestedByName:'Sales.A',RequestStatus:'Open'}],total:12,page:Number(url.searchParams.get('page'))}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {queries};
}

test('Opportunity Created by filter is optional, saved and sent before pagination',async({page})=>{
 const {queries}=await setup(page);
 await page.getByRole('button',{name:'Opportunity layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Opportunity layout',exact:true});
 await layout.getByRole('checkbox',{name:'Created by',exact:true}).check();
 await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 await page.getByLabel('Created by',{exact:true}).fill('Sales.A');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect.poll(()=>queries.filter(q=>q.pathname==='/api/opportunity/grid').at(-1)?.searchParams.get('created_by')).toBe('Sales.A');
 await page.getByRole('button',{name:'Opportunity layout',exact:true}).click();
 await layout.getByRole('button',{name:'Save layout to profile',exact:true}).click();
 await expect(layout).toContainText('Layout and sort saved.');
 await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByLabel('Created by',{exact:true})).toHaveValue('Sales.A');
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await expect.poll(()=>queries.filter(q=>q.pathname==='/api/opportunity/grid').at(-1)?.searchParams.has('created_by')).toBe(false);
});

test('Request filters preserve the creator and assignee across pages and hide clears the filter',async({page})=>{
 const {queries}=await setup(page);
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:'Sort by Assigned to me',exact:false})).toBeVisible();
 const table=page.getByRole('table',{name:'Packaging Requests',exact:true});
 const assignedIndex=(await table.locator('thead th').allTextContents()).findIndex(label=>label.includes('Assigned to me'));
 await expect(table.locator('tbody tr').first().locator('td').nth(assignedIndex)).toHaveText('2');
 await page.getByRole('button',{name:'Sort by Assigned to me',exact:true}).click();
 await expect.poll(()=>queries.filter(q=>q.pathname==='/api/workbench/requests').at(-1)?.searchParams.get('sort')).toContain('AssignedToMe');
 await page.getByRole('button',{name:'Request layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Request layout',exact:true});
 await layout.getByRole('checkbox',{name:'Created by',exact:true}).check();
 await layout.getByRole('checkbox',{name:'Assigned to',exact:true}).check();
 await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 await page.getByLabel('Created by',{exact:true}).fill('Sales.A');
 await page.getByLabel('Assigned to',{exact:true}).fill('PIC.A');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 const latest=()=>queries.filter(q=>q.pathname==='/api/workbench/requests').at(-1)!;
 await expect.poll(()=>latest()?.searchParams.get('assigned_to')).toBe('PIC.A');
 await page.screenshot({path:'../artifacts/layout-testing/request-ownership-filters.png'});
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect.poll(()=>latest()?.searchParams.get('page')).toBe('2');
 expect(latest().searchParams.get('created_by')).toBe('Sales.A');
 expect(latest().searchParams.get('assigned_to')).toBe('PIC.A');
 await page.getByRole('button',{name:'Request layout',exact:true}).click();
 await layout.getByRole('checkbox',{name:'Assigned to',exact:true}).uncheck();
 await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 await expect(page.getByLabel('Assigned to',{exact:true})).toHaveCount(0);
 await expect.poll(()=>latest()?.searchParams.has('assigned_to')).toBe(false);
 expect(latest().searchParams.get('created_by')).toBe('Sales.A');
});
