import {test,expect,type Page} from '@playwright/test';
import {flattenDetails,detailsFromFlat,type RecipeDetails} from '../src/recipe-levels';
import {type RecipeLine} from '../src/npd-model';
const raw:RecipeLine={Kind:'Raw',GradePath:'0/1',IngredientID:null,RatioPct:'100',LossPct:'0',PriceID:null};
const level=(ProcessName:string,BaseRatioPct:string,Ingredients:{IngredientID:number;RatioPct:string}[]=[])=>({ProcessName,OutputName:'',BaseRatioPct,Ingredients});
test('repeated oil is flattened across levels and nut blend weights',()=>{
 const details:RecipeDetails={Version:1,Nuts:[{GradePath:'0/1',BlendRatioPct:'40',Levels:[level('Oil roast','96',[{IngredientID:1,RatioPct:'4'}]),level('Seasoning','94',[{IngredientID:1,RatioPct:'3'},{IngredientID:2,RatioPct:'3'}])]},{GradePath:'0/2',BlendRatioPct:'40',Levels:[level('Dry roast','100')]},{GradePath:'0/3',BlendRatioPct:'20',Levels:[level('Dry roast','100')]}]};
 const full=flattenDetails(details,[]);
 expect(full.map(r=>r.RatioPct)).toEqual(['36.096000','40.000000','20.000000','2.704000','1.200000']);
 expect(full.filter(r=>r.IngredientID===1)).toHaveLength(1);
});
test('existing flat recipe can initialize levels without changing ingredient totals',()=>{
 const lines:RecipeLine[]=[{...raw,RatioPct:'57'},{...raw,GradePath:'0/2',RatioPct:'38'},{...raw,Kind:'Seasoning',GradePath:null,IngredientID:1,RatioPct:'5'}];
 expect(flattenDetails(detailsFromFlat(lines),lines).map(r=>Number(r.RatioPct))).toEqual([57,38,5]);
});
async function setup(page:Page,mixed=false){
 const writes:any[]=[];let lines=mixed?[{...raw,RatioPct:'40'},{...raw,GradePath:'0/2',RatioPct:'40'},{...raw,GradePath:'0/3',RatioPct:'20'}]:[raw];let details:RecipeDetails|undefined;
 const row={ID:21,RowVersion:'AAAAAAAAAAE=',SheetNumber:'RCP-LEVELS',RequestNumber:'RRQ-1',Revision:1,RequestItemID:11,Status:'Draft',ApprovalStatus:'Draft',PICUserID:2,PIC:'npd.member',IsOpen:true,IsLinked:true,WeightGrams:200,AnnualUnit:100000,EstPctAwarded:50,ExchangeRateVNDPerUSD:'26500',GradeSnapshot:JSON.stringify({items:(mixed?['Cashews','Almonds','Macadamias']:['Cashews']).map((Grade,i)=>({ParentID:'0',ID:i+1,Grade,RatioPct:mixed?[40,40,20][i]:100}))}),ProductCode:'PRD-1',ProductName:'Cashews'};
 const calc=(list=lines)=>({RecipeDetails:details,Lines:list.map(r=>({...r,BufferRatio:r.RatioPct,TotalQtyMT:Number(r.RatioPct)/10,Candidates:[],USDPerKg:r.DirectPricePerKg??'0'})),Issues:[],Warnings:[],RatioTotal:list.reduce((sum,r)=>sum+Number(r.RatioPct),0),SeasoningRatio:list.filter(r=>r.Kind==='Seasoning').reduce((sum,r)=>sum+Number(r.RatioPct),0),LossWeightBasis:'Recipe',SeasoningLossPct:0});
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().method()==='GET'?null:route.request().postDataJSON();
  let result:unknown={rows:[],total:0};
  if(path.endsWith('/session'))result={username:'npd.member',user_id:2,is_admin:false,scopes:['NPD'],permissions:{'recipe-sheets':'edit','recipe-requests':'display',ingredients:'edit','ingredient-prices':'edit'}};
  else if(path.endsWith('/preferences'))result={settings:{},version:0};
  else if(path==='/api/npd/lookups')result={units:[],currencies:[],vendors:[],members:[],ingredients:[{ID:1,IngredientCode:'ING-OIL',Description:'Sunflower oil',GradeNature:'Refined',Origin:'Vietnam',Status:'Active'},{ID:2,IngredientCode:'ING-SALT',Description:'Salt',Status:'Active'}]};
  else if(path==='/api/npd/sheets')result={rows:[row],total:1};
  else if(path==='/api/npd/sheets/21'&&!body)result={row,lines,calculation:calc()};
  else if(path.startsWith('/api/npd/sheets/21')&&body){details=body.RecipeDetails??details;const next=details?flattenDetails(details,body.Lines):body.Lines;result={row,lines:next,calculation:calc(next)};if(path==='/api/npd/sheets/21'){writes.push(body);lines=next}}
  return route.fulfill({json:result});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-LEVELS',exact:true}).click();
 return writes;
}
test('Details levels feed a read-only Full ratio with shared ingredient pricing and reopen intact',async({page},info)=>{
 const writes=await setup(page),sheet=page.getByRole('dialog',{name:'RCP-LEVELS',exact:true});
 await sheet.getByRole('tab',{name:'Details',exact:true}).click();
 await expect(sheet.getByLabel('Nut recipe',{exact:true})).toBeVisible();
 await expect(sheet.getByText('Process type',{exact:true})).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Remove nut from sheet',exact:true})).toHaveCount(0);
 await sheet.getByLabel('Output name 0/1 Level 1',{exact:true}).fill('Oil roasted Cashews');
 await sheet.getByLabel('Base ratio 0/1 Level 1',{exact:true}).fill('96');
 await sheet.getByRole('button',{name:'Add ingredient',exact:true}).click();
 await sheet.getByLabel('Ingredient 0/1 Level 1 line 2',{exact:true}).selectOption('1');await sheet.getByLabel('Ingredient ratio 0/1 Level 1 line 2',{exact:true}).fill('4');
 await expect(sheet.locator('.recipe-level-card > header').getByRole('button',{name:'Add level',exact:true})).toHaveCount(1);await sheet.getByRole('button',{name:'Add level',exact:true}).click();
 await expect(sheet.locator('.recipe-level-card').first().getByRole('button',{name:'Add level',exact:true})).toHaveCount(0);
 await expect(sheet.locator('.recipe-level-card').last().getByRole('button',{name:'Add level',exact:true})).toHaveCount(1);
 await sheet.getByLabel('Output name 0/1 Level 2',{exact:true}).fill('Seasoned Cashews');await sheet.getByLabel('Base ratio 0/1 Level 2',{exact:true}).fill('97');
 // Sections use their table to scope the second level?s ingredient control.
 await expect(sheet.getByRole('table',{name:'Cashews Level 2 ingredients',exact:true}).getByText('Oil roasted Cashews',{exact:false})).toBeVisible();
 await sheet.locator('.recipe-level-card').nth(1).getByRole('button',{name:'Add ingredient',exact:true}).click();
 await sheet.getByLabel('Ingredient 0/1 Level 2 line 2',{exact:true}).selectOption('1');await sheet.getByLabel('Ingredient ratio 0/1 Level 2 line 2',{exact:true}).fill('3');
 for(const width of [1920,1366]){await page.setViewportSize({width,height:1000});expect(await sheet.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);expect(await sheet.locator('.recipe-level-card').evaluateAll(cards=>cards.every(card=>Array.from(card.querySelectorAll('input,select,button')).every(control=>control.getBoundingClientRect().right<=card.getBoundingClientRect().right+1)))).toBe(true)}
 await sheet.screenshot({path:info.outputPath('recipe-details.png')});
 await expect(sheet.getByRole('columnheader',{name:'Ingredient Code',exact:true})).toHaveCount(2);
 await expect(sheet.getByRole('cell',{name:'ING-OIL',exact:true})).toHaveCount(2);
 await sheet.getByRole('tab',{name:'Full view',exact:true}).click();
 await expect(sheet.getByPlaceholder('Manual ingredient description')).toHaveCount(0);
 await expect(sheet.getByRole('table',{name:'Recipe ingredients',exact:true}).locator('tbody tr')).toHaveCount(2);
 await expect(sheet.getByLabel('Ratio line 1',{exact:true})).toHaveText('93.12');await expect(sheet.getByLabel('Ratio line 2',{exact:true})).toHaveText('6.88');
 await expect(sheet.getByRole('button',{name:'Add seasoning ingredient',exact:true})).toHaveCount(0);
 await sheet.getByLabel('Price (USD/KG) line 2',{exact:true}).fill('2');await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].RecipeDetails.Nuts[0].Levels).toHaveLength(2);expect(writes[0].Lines.filter((r:RecipeLine)=>r.IngredientID===1)).toHaveLength(1);
 await sheet.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'RCP-LEVELS',exact:true}).click();await sheet.getByRole('tab',{name:'Details',exact:true}).click();await expect(sheet.getByLabel('Output name 0/1 Level 1',{exact:true})).toHaveValue('Oil roasted Cashews');
});






test('nut dropdown preserves separate outputs and keeps nut information inline',async({page})=>{
 await setup(page,true);
 const sheet=page.getByRole('dialog',{name:'RCP-LEVELS',exact:true});
 await sheet.getByRole('tab',{name:'Details',exact:true}).click();
 const picker=sheet.getByLabel('Nut recipe',{exact:true});
 await expect(picker.locator('option')).toHaveCount(3);
 await sheet.getByLabel('Output name 0/1 Level 1',{exact:true}).fill('Roasted Cashews');
 await picker.selectOption('0/2');
 await expect(sheet.getByLabel('Nut blend ratio 0/2',{exact:true})).toHaveValue('40.00');
 await sheet.getByLabel('Output name 0/2 Level 1',{exact:true}).fill('Roasted Almonds');
 await picker.selectOption('0/1');
 await expect(sheet.getByLabel('Output name 0/1 Level 1',{exact:true})).toHaveValue('Roasted Cashews');
 for(const width of [1920,1366]){
  await page.setViewportSize({width,height:1000});
  expect(await sheet.locator('.recipe-nut-heading').evaluate(e=>{const controls=Array.from(e.querySelectorAll('select,input'));return Math.abs(controls[0].getBoundingClientRect().top-controls[1].getBoundingClientRect().top)<2})).toBe(true);
  expect(await sheet.locator('.recipe-level-card tbody tr').first().evaluate(e=>e.getBoundingClientRect().height)).toBeLessThan(50);
 }
});
