import {test,expect,type Page} from '@playwright/test';
import {LOCAL_AI_LAUNCHER_DISABLED} from '../src/feature-flags';
async function setup(page:Page,{available=true,sources=['products'],permissions,openChat=true}:{available?:boolean;sources?:string[];permissions?:Record<string,string>;openChat?:boolean}={}){
 test.skip(LOCAL_AI_LAUNCHER_DISABLED&&openChat,'AI launcher temporarily disabled for VM rollout; retain chat regressions for re-enabling.');
 const requests:any[]=[];const saved:Record<string,any[]>={};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:2,scopes:['Product'],is_admin:false,...(permissions?{permissions}:{})}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/ai/status')return route.fulfill({json:{enabled:true,available,model:'qwen3.5:4b',read_only:true,sources}});
  if(path==='/api/ai/conversations')return route.fulfill({json:{conversations:Object.keys(saved)}});
  if(path.endsWith('/feedback')){const body=route.request().postDataJSON(),id=path.split('/').at(-2)!;const turn=saved[id]?.find(t=>t.request_id===body.request_id);if(!turn)return route.fulfill({status:404,json:{detail:'Reply not found'}});turn.feedback=body.comment;return route.fulfill({json:{saved:true}})}
  if(path.startsWith('/api/ai/conversations/')){const id=path.split('/').pop()!;if(route.request().method()==='DELETE')delete saved[id];return route.fulfill({json:{turns:saved[id]||[]}})}
  if(path==='/api/ai/chat/preview'){
   const body=route.request().postDataJSON();requests.push(body);
   const lookup=/show.*products/i.test(body.message),extract=/extract.*requirements/i.test(body.message);
   const result={model:'qwen3.5:4b',answer:'Record 7 matches.',citations:[7],evidence:lookup?[{ID:7,ProductName:'<img src=x onerror=alert(1)>',WeightGrams:'150'}]:[],truncated:lookup,extracted:extract?{customer:'Demo',net_weight_g:'150',annual_units:null,notes:['Container not supplied.']}:null};
   (saved[body.conversation_id]||=[]).push({id:requests.length,question:body.message,result,request_id:body.request_id,feedback:null});
   return route.fulfill({json:result});
  }
  return route.fulfill({json:{rows:[],total:0,page:1,materials:[],currencies:[],creators:[]}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 if(openChat)await page.getByRole('button',{name:'AI assistant',exact:true}).click();
 return {dialog:page.getByRole('dialog',{name:'Local AI assistant',exact:true}),requests};
}
test('AI launcher is temporarily disabled and makes no AI requests',async({page})=>{
 test.skip(!LOCAL_AI_LAUNCHER_DISABLED,'Rollout pause lifted.');
 const aiRequests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/ai/'))aiRequests.push(request.url())});
 await setup(page,{openChat:false});
 const button=page.getByRole('button',{name:'AI assistant',exact:true});
 await expect(button).toBeVisible();await expect(button).toBeDisabled();
 await expect(button).toHaveAttribute('title','AI assistant temporarily disabled');
 await expect(page.getByRole('dialog',{name:'Local AI assistant',exact:true})).toHaveCount(0);
 await page.keyboard.press('Enter');
 expect(aiRequests).toEqual([]);
});

test('natural lookup needs no task or dataset selection and evidence renders as text',async({page})=>{
 const {dialog,requests}=await setup(page,{permissions:{products:'display'}});
 await expect(dialog.getByLabel('AI task')).toHaveCount(0);
 await expect(dialog.getByLabel('AI dataset')).toHaveCount(0);
 await expect(dialog.getByLabel('AI search')).toHaveCount(0);
 await dialog.getByLabel('AI question').fill('Show these products.');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toContainText('Record 7 matches.');
 await expect(dialog).toContainText('Only the first 10 matches');
 await expect(dialog.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
 await expect(dialog.locator('img')).toHaveCount(0);
 expect(requests.map(({conversation_id,request_id,...body})=>body)).toEqual([{message:'Show these products.'}]);
});
test('extraction shows a draft without any save action',async({page})=>{
 const {dialog,requests}=await setup(page);
 await dialog.getByLabel('AI question').fill('Extract requirements: Demo 150g');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog).toContainText('Extracted draft fields');
 await expect(dialog).toContainText('Not supplied');
 await expect(dialog.getByRole('button',{name:/save/i})).toHaveCount(0);
 expect(requests.map(({conversation_id,request_id,...body})=>body)).toEqual([{message:'Extract requirements: Demo 150g'}]);
});
test('busy response preserves the question and permits a deliberate retry',async({page})=>{
 const {dialog}=await setup(page);
 await page.route('**/api/ai/chat/preview',route=>route.fulfill({status:429,json:{detail:'AI is busy. Try again shortly.'}}));
 await dialog.getByLabel('AI question').fill('How do I maintain a mix?');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog).toContainText('AI is busy.');
 await expect(dialog.getByLabel('AI question')).toHaveValue('How do I maintain a mix?');
 await expect(dialog.getByRole('button',{name:'Ask local AI',exact:true})).toBeEnabled();
});
test('missing runtime has a clear retry path and closing does not dismiss the workspace',async({page})=>{
 const {dialog}=await setup(page,{available:false});
 await expect(dialog).toContainText('Local AI is unavailable');
 await expect(dialog.getByRole('button',{name:'Retry AI connection',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'AI assistant',exact:true})).toBeVisible();
});
test('help-only users can ask naturally without seeing technical controls',async({page})=>{
 const {dialog}=await setup(page,{sources:[]});
 await expect(dialog.getByLabel('AI task')).toHaveCount(0);
 await dialog.getByLabel('AI question').fill('How do I create a Product?');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog).toContainText('Record 7 matches.');
});


test('floating non-modal chat keeps follow-ups, restores history and supports deletion',async({page})=>{
 const {dialog,requests}=await setup(page);
 await expect(page.locator('.sidebar .local-ai-launch')).toHaveCount(0);
 await expect(dialog).toHaveAttribute('aria-modal','false');
 const launcher=page.getByRole('button',{name:'AI assistant',exact:true});
 expect(await launcher.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 await dialog.getByLabel('AI question').fill('How do I create a Product?');
 await dialog.getByLabel('AI question').press('Enter');
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(1);
 await dialog.getByLabel('AI question').fill('Explain its mix children.');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(2);
 expect(requests[0].conversation_id).toBe(requests[1].conversation_id);
 expect(requests[0].request_id).not.toBe(requests[1].request_id);
 await dialog.getByRole('button',{name:'Close AI assistant',exact:true}).click();
 await launcher.click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(2);
 await dialog.getByRole('button',{name:'New chat',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(0);
 await dialog.getByLabel('Chat history').selectOption(requests[0].conversation_id);
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(2);
 page.once('dialog',d=>d.accept());
 await dialog.getByRole('button',{name:'Delete conversation',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(0);
 await expect(dialog.getByLabel('Chat history').locator('option')).toHaveCount(1);
});
test('uncertain retries reuse the request identifier and chat fits mobile',async({page})=>{
 const {dialog}=await setup(page);const sent:any[]=[];
 await page.route('**/api/ai/chat/preview',route=>{sent.push(route.request().postDataJSON());return route.fulfill({status:503,json:{detail:'Temporarily unavailable'}})});
 await page.setViewportSize({width:390,height:844});
 await dialog.getByLabel('AI question').fill('Please explain.');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog).toContainText('Temporarily unavailable');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect.poll(()=>sent.length).toBe(2);
 expect(sent[0].request_id).toBe(sent[1].request_id);
 const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);
});


test('private chat is hidden by idle lock and restored only on resume',async({page})=>{
 await page.clock.install();const {dialog}=await setup(page);
 await dialog.getByLabel('AI question').fill('Private draft chat');
 await page.clock.runFor(600001);
 await expect(page.getByRole('dialog',{name:'Session locked',exact:true})).toBeVisible();
 await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Sign in to resume',exact:true}).click();
 await expect(dialog.getByLabel('AI question')).toHaveValue('Private draft chat');
});


test('minimizing during a reply keeps it and does not reload stale history',async({page})=>{
 const {dialog}=await setup(page);let release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/ai/chat/preview',async route=>{await waiting;await route.fulfill({json:{model:'qwen3.5:4b',answer:'Completed while minimized.',evidence:[],citations:[],truncated:false,extracted:null}})});
 await dialog.getByLabel('AI question').fill('Explain Product Mix.');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Thinking locally');
 await dialog.getByRole('button',{name:'Close AI assistant',exact:true}).click();
 await page.getByRole('button',{name:'AI assistant',exact:true}).click();
 release();
 await expect(dialog.getByRole('region',{name:'AI result'})).toContainText('Completed while minimized.');
});
test('permission revocation on resume clears cached chat from the workspace',async({page})=>{
 await page.clock.install();const {dialog}=await setup(page);
 await dialog.getByLabel('AI question').fill('Private message');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'AI result'})).toHaveCount(1);
 await page.clock.runFor(600001);
 await page.route('**/api/workbench/session',route=>route.fulfill({json:{username:'Tester',user_id:2,scopes:['Product'],is_admin:false,permissions:{products:'none'}}}));
 await page.getByRole('button',{name:'Sign in to resume',exact:true}).click();
 await expect(page.getByRole('button',{name:'AI assistant',exact:true})).toHaveCount(0);
 await expect(page.locator('.local-ai-messages')).toHaveCount(0);
});


test('a natural opportunity count has no task fields and shows the exact total separately from sampled rows',async({page})=>{
 const {dialog,requests}=await setup(page);
 const question='How many Opportunities are in processing now, and created by me? Please list with basics details';
 await page.route('**/api/ai/chat/preview',route=>{
  const body=route.request().postDataJSON();requests.push(body);
  return route.fulfill({json:{model:'qwen3.5:4b',answer:'Found 27 matching opportunities (created by you, header stage In progress). Showing the latest 10 of 27; the count covers all matches.',total:27,citations:[7],evidence:[{ID:7,OpportunityNumber:'OPP-7',Status:'In progress',CreatedBy:'Tester'}],truncated:true,extracted:null}});
 });
 await expect(dialog.getByLabel('AI task')).toHaveCount(0);
 await expect(dialog.getByLabel('AI dataset')).toHaveCount(0);
 await dialog.getByLabel('AI question').fill(question);
 await dialog.getByLabel('AI question').press('Enter');
 await expect(dialog.getByRole('region',{name:'AI result'})).toContainText('Found 27 matching opportunities');
 await expect(dialog.getByText('OPP-7',{exact:true})).toBeVisible();
 await expect(dialog).not.toContainText('Draft extraction only');
 await expect(dialog).not.toContainText('not a complete dataset');
 expect(Object.keys(requests[0]).sort()).toEqual(['conversation_id','message','request_id']);
});


test('incorrect-answer reports stay private, survive reopening, and do not retrain or alter chat requests',async({page})=>{
 const {dialog,requests}=await setup(page);
 await dialog.getByLabel('AI question').fill('How do I maintain a Product Mix?');
 await dialog.getByRole('button',{name:'Ask local AI',exact:true}).click();
 await dialog.getByRole('button',{name:'Report incorrect answer',exact:true}).click();
 await dialog.getByLabel('Answer correction').fill('I meant open Packaging Requests, not historical requests. Expected 4 items; check the Opportunity screen.');
 await dialog.getByRole('button',{name:'Save correction report',exact:true}).click();
 await expect(dialog).toContainText('Report saved for review');
 await expect(dialog).toContainText('No automatic retraining or business-data changes');
 await dialog.getByRole('button',{name:'Close AI assistant',exact:true}).click();
 await page.getByRole('button',{name:'AI assistant',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Update incorrect-answer report',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Update incorrect-answer report',exact:true}).click();
 await expect(dialog.getByLabel('Answer correction')).toContainText('Expected 4 items');
 expect(requests).toHaveLength(1);
 expect(Object.keys(requests[0]).sort()).toEqual(['conversation_id','message','request_id']);
});
