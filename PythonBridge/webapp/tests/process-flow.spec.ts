import {test,expect,type Page} from '@playwright/test';
import {costs,defaultInputs} from '../src/tcb-model';
import {classifyProcessLeaves,savedProcessTree} from '../src/grade-process';
import {pathLossRow,processLossTableRows,processLossTargets,gradePathDraft,remapAlignedLossFormulas} from '../src/grade-process-loss';
import {quantityDisplay} from '../src/packaging-summary-model';
import type {GradeItem} from '../src/product-grades';
const rv='AAAAAAAAAAE=',version='0x0000000000000001';
const masters=['Sorting','Roasting','Packing','NPD Recipe'].map((ProcessName,i)=>({MasterID:i+1,MasterVersion:version,ProcessName,ProcessType:'Processing',Sequence:1,LossPct:'0'}));
const defaults=[{ID:1,RawGradeID:2,ProcessTypeID:1,LossPct:'5',DefaultVersion:version},{ID:2,RawGradeID:2,ProcessTypeID:2,LossPct:'10',DefaultVersion:version},{ID:3,RawGradeID:3,ProcessTypeID:2,LossPct:'8',DefaultVersion:version},{ID:4,RawGradeID:1,ProcessTypeID:2,LossPct:'7',DefaultVersion:version},{ID:5,RawGradeID:null,ProcessTypeID:3,LossPct:'2',DefaultVersion:version}];
function tree(parent:boolean,children:boolean):GradeItem[]{return [
 {ParentID:'0',ID:1,RawGradeID:1,Grade:'Cashews',RatioPct:'100',Process:parent},
 {ParentID:'0/1',ID:1,RawGradeID:2,Grade:'W210',RatioPct:'40',Process:children},
 {ParentID:'0/1',ID:2,RawGradeID:3,Grade:'W320',RatioPct:'60',Process:children}
]}
async function open(page:Page,parent=false,children=true,legacy=false,preset?:{items:GradeItem[];inputs:ReturnType<typeof defaultInputs>;grades:{Path:string;Grade:string;RawGradeID:number;Proportion:string}[]}){
 const writes:any[]=[],items=preset?.items??tree(parent,children),snapshot={items};
 const grades=preset?.grades??[{Path:'0/1/1',Grade:'W210',RawGradeID:2,Proportion:'.4'},{Path:'0/1/2',Grade:'W320',RawGradeID:3,Proportion:'.6'}];
 const inputs=preset?.inputs??{...defaultInputs(),Prices:[{Path:'0/1/1',DirectUSDPerLb:'2'},{Path:'0/1/2',DirectUSDPerLb:'4'}]};
 if(legacy)Object.assign(inputs,{LossProcesses:[{...masters[0],LossPct:'5'}]});
 const row={OpportunityID:1,OpportunityNumber:'OPP-GRAPH',CustomerName:'Customer',HeaderStage:'Draft',HeaderRowVersion:rv,ItemID:11,ItemStage:'Draft',ItemRowVersion:rv,ProductCode:'CASE',ProductName:'Cashews',ProductID:1,WeightGrams:150,ProductGradeSnapshot:JSON.stringify(snapshot),ResponseLayerCount:1};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:1,is_admin:false,scopes:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[row],total:1,page:1}});
  if(path.endsWith('/grade-lookups'))return route.fulfill({json:{rows:[{ID:1,GradeName:'Cashews',FinalGrade:false},{ID:2,GradeName:'W210',ParentGradeID:1,FinalGrade:true},{ID:3,GradeName:'W320',ParentGradeID:1,FinalGrade:true}],materials:[]}});
  if(path==='/api/opportunity/items/11/tcb')return route.fulfill({json:{item:{...row,ID:11,RowVersion:rv,IsMixParent:false,LossLayerCount:1},saved:{Inputs:inputs},lossMasters:masters,lossDefaults:defaults,grades,prices:[]}});
  if(path.endsWith('/loss-formula')||path.endsWith('/commercial/preview')){
   const body=route.request().postDataJSON(),lossRows=body.CostInputs?.ProcessLosses??body.Inputs.ProcessLosses??[];
   return route.fulfill({json:{LossProductPct:'0',grades,prices:[],ProcessLossSnapshots:processLossTargets(items).map(path=>{const r=pathLossRow({...body.Inputs,...body.CostInputs,ProcessLosses:lossRows},path);return {...r,LossPct:r.Formula&&/^L\d+(?:\+L\d+)*$/.test(r.Formula)?String(r.Formula.split('+').reduce((sum,variable)=>sum+Number(r.Ratios[Number(variable.slice(1))-1]),0)):String((1-r.Ratios.reduce((v:number,n:string)=>v*(1-Number(n)/100),1))*100),WeightGrams:'150'}}),saved:{}}});
  }
  if(path.endsWith('/commercial')){
   const body=route.request().postDataJSON();writes.push(body);
   return route.fulfill({json:{RowVersion:rv,snapshot:body.Grades??snapshot,grades,prices:[],saved:{Inputs:{...inputs,...body.CostInputs,...body.Inputs}}}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review for CASE item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('region',{name:'Process Loss item 11',exact:true})).toBeVisible();
 return {dialog,writes};
}
for(const [parent,children,name] of [[false,true,'child processes'],[true,false,'blended parent'],[true,true,'child then parent']] as const)test(name+' use one table and a complete formula per grade',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});const {dialog,writes}=await open(page,parent,children);
 const loss=dialog.getByRole('region',{name:'Process Loss item 11',exact:true});
 await expect(loss.locator('.process-loss-table')).toHaveCount(1);
 await expect(loss.locator('.process-flow')).toHaveCount(0);
 await expect(loss.getByRole('button',{name:'Test all Process Loss item 11',exact:true})).toHaveCount(1);
 await expect(loss.locator('thead').getByRole('button',{name:'Test all Process Loss item 11',exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Process 0/1/1',{exact:true})).toBeEnabled();
 await expect(dialog.getByLabel('Process 0/1',{exact:true})).toHaveJSProperty('checked',parent);
 const path=children?'0/1/1':'0/1',packingIndex=children?(parent?4:3):2;
 await expect(loss.getByLabel('Process loss '+path+' L1 item 11',{exact:true})).toHaveValue(children?'5':'7');
 await expect(loss.getByLabel('Process loss '+path+' L'+packingIndex+' item 11',{exact:true})).toHaveValue('2');
 await expect(loss.getByLabel('Process loss formula '+path+' item 11',{exact:true})).toHaveValue('');
 if(children){
  await expect(loss.getByLabel('Process loss 0/1/1 L2 item 11',{exact:true})).toHaveValue('10');
  await expect(loss.getByLabel('Process type 0/1/2 L1 item 11',{exact:true})).toHaveValue('2');
  await expect(loss.getByLabel('Process type 0/1/1 L2 item 11',{exact:true}).locator('option[value="1"]')).toBeDisabled();
  await expect(loss.getByLabel('Process loss 0/1/2 L'+packingIndex+' item 11',{exact:true})).toBeDisabled();
  if(parent){
   const roast=loss.getByLabel('Process loss 0/1/1 L3 item 11',{exact:true});
   await expect(roast).toHaveValue('7');await roast.fill('11');
   await expect(loss.getByLabel('Process loss 0/1/2 L3 item 11',{exact:true})).toHaveValue('11');
   await expect(loss.getByLabel('Process loss 0/1/2 L3 item 11',{exact:true})).toBeDisabled();
   await expect(loss.locator('[data-process-grade="0/1"]')).toHaveCount(0);
   const group=loss.locator('.process-loss-source[data-loss-group="0/1"]'),packing=loss.locator('.process-loss-source[data-loss-group="0"]');
   const background=(el:typeof group)=>el.evaluate(node=>getComputedStyle(node).backgroundColor);
   const parentColor=await background(group),packingColor=await background(packing);
   expect(parentColor).not.toBe(packingColor);
   for(const path of ['0/1/1','0/1/2']){
    const row=loss.locator('[data-process-grade="'+path+'"]');
    expect(await background(row.locator('.process-loss-type[data-loss-group="0/1"]'))).toBe(parentColor);
    expect(await background(row.locator('.process-loss-type[data-loss-group="0"]'))).toBe(packingColor);
   }
  }
 }else await expect(loss.locator('[data-process-grade="0/1/1"]')).toHaveCount(0);
 await loss.getByLabel('Process loss '+path+' L'+packingIndex+' item 11',{exact:true}).fill('3');
 if(children)await expect(loss.getByLabel('Process loss 0/1/2 L'+packingIndex+' item 11',{exact:true})).toHaveValue('3');
 await loss.getByLabel('Process loss formula '+path+' item 11',{exact:true}).fill('L1+L2');
 await loss.getByRole('button',{name:'Test all Process Loss item 11',exact:true}).click();
 await expect(loss.getByLabel('Process Loss result '+path+' item 11',{exact:true})).toHaveText(children?'15%':'10%');
 const recipe=dialog.getByRole('region',{name:'Recipe Info',exact:true});
 await recipe.getByRole('button',{name:'Toggle child grades 0/1 item 11',exact:true}).click();
 await expect(recipe.getByLabel('Loss Process % '+path+' item 11',{exact:true})).toHaveText(children?'15%':'10%');
 if(!children)await expect(recipe.getByLabel('Loss Process % 0/1/1 item 11',{exact:true})).toHaveText('10%');
 expect(await loss.locator('.process-loss-table-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await loss.screenshot({path:info.outputPath('loss-table.png')});
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes).toHaveLength(1);expect(writes[0].CostInputs.ProcessLossMode).toBe('GradePath');
 expect(writes[0].CostInputs.ProcessLossFormulas[path]).toBe('L1+L2');
 expect(writes[0].CostInputs.ProcessLosses.filter((r:any)=>r.Path!=='0')).toHaveLength((children?2:0)+(parent?1:0));
});

test('six compact columns align parent Roasting and Packing across every grade without scrolling',async({page},info)=>{
 const items:GradeItem[]=[{ParentID:'0',ID:1,Grade:'Cashews',RawGradeID:1,RatioPct:'40',Process:true},
  {ParentID:'0/1',ID:1,Grade:'W210',RawGradeID:2,RatioPct:'40',Process:true},{ParentID:'0/1',ID:2,Grade:'W320',RawGradeID:3,RatioPct:'60',Process:false},
  ...['Almonds','Pistachios','Macadamia'].map((Grade,i)=>({ParentID:'0',ID:i+2,Grade,RawGradeID:i+4,RatioPct:'20',Process:false}))];
 const stage=(Path:string,names:string[],Ratios:string[])=>({Path,Codes:names.map(name=>{const m=masters.find(m=>m.ProcessName===name)!;return {MasterID:m.MasterID,MasterVersion:m.MasterVersion,ProcessName:m.ProcessName}}),Ratios});
 const inputs={...defaultInputs(),ProcessLossMode:'GradePath' as const,ProcessLossLayout:'Local' as const,
  ProcessLosses:[stage('0/1',['Sorting','Roasting'],['4','5']),stage('0/1/1',['Sorting','Roasting','NPD Recipe'],['1','2','3']),stage('0',['Packing'],['6'])],
  ProcessLossFormulas:{'0/1':'L1+L2+L3','0/1/1':'L1+L2+L3+L4+L5+L6','0/2':'L1','0/3':'L1','0/4':'L1'}};
 const grades=[{Path:'0/1/1',Grade:'W210',RawGradeID:2,Proportion:'.16'},{Path:'0/1/2',Grade:'W320',RawGradeID:3,Proportion:'.24'},...items.filter(g=>g.ParentID==='0'&&g.ID!==1).map(g=>({Path:'0/'+g.ID,Grade:g.Grade,RawGradeID:g.RawGradeID!,Proportion:'.2'}))];
 const {dialog}=await open(page,true,true,false,{items,inputs,grades}),loss=dialog.getByRole('region',{name:'Process Loss item 11',exact:true});
 await expect(loss.getByRole('columnheader',{name:'Process Code',exact:true})).toBeVisible();
 for(const path of ['0/1','0/1/1','0/2','0/3','0/4'])await expect(loss.getByLabel('Process type '+path+' L6 item 11',{exact:true})).toHaveValue('3');
 for(const path of ['0/1','0/1/1'])await expect(loss.getByLabel('Process type '+path+' L5 item 11',{exact:true})).toHaveValue('2');
 await expect(loss.getByLabel('Process loss formula 0/1 item 11',{exact:true})).toHaveValue('L4+L5+L6');
 await expect(loss.getByLabel('Process loss formula 0/2 item 11',{exact:true})).toHaveValue('L6');
 for(const width of [1920,1440,1280,1024,390]){
  await page.setViewportSize({width,height:1080});
  expect(await loss.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const type=(await loss.getByLabel('Process type 0/1/1 L1 item 11',{exact:true}).boundingBox())!,ratio=(await loss.getByLabel('Process loss 0/1/1 L1 item 11',{exact:true}).boundingBox())!;
  expect(Math.abs(type.y+type.height/2-ratio.y-ratio.height/2)).toBeLessThan(1);
  expect(ratio.width).toBeLessThanOrEqual(34);
  expect(type.width).toBeGreaterThan(ratio.width);
  const close=(await loss.getByRole('button',{name:'Remove process type 0/1/1 L1 item 11',exact:true}).boundingBox())!;
  expect(close.width).toBeLessThanOrEqual(16);
  if(width>=1280)expect((await loss.locator('[data-process-grade="0/1/1"]').boundingBox())!.height).toBeLessThanOrEqual(48);
  if(width===1440||width===390)await loss.screenshot({path:info.outputPath('compact-six-'+width+'.png')});
 }
 await loss.getByRole('button',{name:'Test all Process Loss item 11',exact:true}).click();
 await expect(loss.getByLabel('Process Loss result 0/1 item 11',{exact:true})).toHaveText('15%');
 await expect(loss.getByLabel('Process Loss result 0/1/1 item 11',{exact:true})).toHaveText('21%');
 await expect(loss.getByLabel('Process Loss result 0/2 item 11',{exact:true})).toHaveText('6%');
});

test('local saved formula results remain valid when remapped to aligned parent columns',()=>{
 const items=tree(true,true),formula='L1+L2';
 const d={grades:items,costingInputs:{...defaultInputs(),ProcessLossMode:'GradePath' as const,ProcessLossLayout:'Local' as const,ProcessLossFormulas:{'0/1/2':formula},ProcessLosses:[{Path:'0/1/1',Codes:[{ProcessName:'Sorting'},{ProcessName:'Roasting'}],Ratios:['1','2']},{Path:'0/1/2',Codes:[],Ratios:[]},{Path:'0/1',Codes:[{ProcessName:'Roasting'}],Ratios:['5']},{Path:'0',Codes:[{ProcessName:'Packing'}],Ratios:['6']}],ProcessLossResults:[{Path:'0/1/2',Ratios:['5','6'],Formula:formula,LossPct:'11'}]}};
 const aligned=gradePathDraft(d);
 expect(aligned.costingInputs.ProcessLossFormulas?.['0/1/2']).toBe('L3+L4');
 expect(aligned.costingInputs.ProcessLossResults?.[0]).toMatchObject({Ratios:['0','0','5','6'],Formula:'L3+L4',LossPct:'11'});
});

test('aligned formulas follow their original source when another child process adds a column',()=>{
 const stage=(Path:string,names:string[])=>({Path,Codes:names.map(ProcessName=>({ProcessName})),Ratios:names.map(()=>'1')});
 const before={...defaultInputs(),ProcessLossMode:'GradePath' as const,ProcessLossLayout:'Aligned' as const,ProcessLosses:[stage('0/1/1',['Sorting']),stage('0/1',['Roasting']),stage('0',['Packing'])],ProcessLossFormulas:{'0/1':'L2+L3','0/1/1':'L1+L2+L3','0/2':'L3'}};
 const after={...before,ProcessLosses:[stage('0/1/1',['Sorting','NPD Recipe']),stage('0/1',['Roasting']),stage('0',['Packing'])]};
 expect(remapAlignedLossFormulas(before,after,['0/1','0/1/1','0/2']).ProcessLossFormulas).toEqual({'0/1':'L3+L4','0/1/1':'L1+L3+L4','0/2':'L4'});
});

test('complete manual formula applies once to RM and does not reapply parent or Packing',()=>{
 const items=tree(true,true),grades=classifyProcessLeaves(items,[{Path:'0/1/1',Proportion:'.4'},{Path:'0/1/2',Proportion:'.6'}]);
 const formula='L1+L2+L3';
 const inputs={...defaultInputs(),ProcessLossMode:'GradePath' as const,ProcessLossFormulas:{'0/1/1':formula,'0/1/2':formula},Prices:[{Path:'0/1/1',DirectUSDPerLb:'2'},{Path:'0/1/2',DirectUSDPerLb:'4'}],ProcessLosses:[{Path:'0/1/1',Ratios:['5']},{Path:'0/1/2',Ratios:['3']},{Path:'0/1',Ratios:['10']},{Path:'0',Ratios:['2']}],ProcessLossResults:[{Path:'0/1/1',Ratios:['5','10','2'],Formula:formula,LossPct:'17'},{Path:'0/1/2',Ratios:['3','10','2'],Formula:formula,LossPct:'15'}],MaterialCosts:[{Path:'0/1',RMRatio:'90',SeasoningRatio:'10',SeasoningUSDPerLb:'1',OilPct:'0',ProcessingUSDPerLb:'.2'}]};
 const result=costs(inputs,grades,[]),rm=2/.83*.4+4/.85*.6;
 expect(Number(quantityDisplay(result.rm,12))).toBeCloseTo(rm,10);
 expect(Number(quantityDisplay(result.product,12))).toBeCloseTo(rm*.9+.1+.2,10);
 const changed={...inputs,ProcessLosses:inputs.ProcessLosses.map(r=>r.Path==='0/1'?{...r,Ratios:['11']}:r)};
 expect(costs(changed,grades,[]).rm).toBeNull();
 expect(savedProcessTree(items).filter(g=>g.Process)).toHaveLength(3);
});

test('new defaults do not overwrite a captured legacy loss or add other process types',async({page})=>{
 const {dialog}=await open(page,false,true,true);
 await expect(dialog.getByLabel('Process loss 0/1/1 L1 item 11',{exact:true})).toHaveValue('5');
 await expect(dialog.getByLabel('Process loss 0/1/1 L2 item 11',{exact:true})).toHaveCount(0);
});

test('validation focuses an invalid inherited parent percentage in its first occurrence',async({page})=>{
 const {dialog}=await open(page,true,true),loss=dialog.getByRole('region',{name:'Process Loss item 11',exact:true});
 const ratio=loss.getByLabel('Process loss 0/1/1 L3 item 11',{exact:true});
 await ratio.fill('101');await expect(ratio).toHaveAttribute('aria-invalid','true');
 await dialog.getByRole('region',{name:'TCB validation summary'}).getByRole('button').first().click();
 await expect(ratio).toBeFocused();
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});

test('saved stage formulas are explicitly combined without changing their meaning',()=>{
 const grades=tree(true,true),d={grades,costingInputs:{...defaultInputs(),ProcessLosses:[{Path:'0/1/1',Codes:[{ProcessName:'Sorting'}],Ratios:['5'],Formula:'L1/2'},{Path:'0/1/2',Codes:[],Ratios:[]},{Path:'0/1',Codes:[{ProcessName:'Roasting'}],Ratios:['10'],Formula:'L1'},{Path:'0',Codes:[{ProcessName:'Packing'}],Ratios:['2'],Formula:'L1'}]}};
 const converted=gradePathDraft(d);
 expect(converted.costingInputs.ProcessLossFormulas?.['0/1/1']).toBe('1-(1-(L1/2))*(1-(L2))*(1-(L3))');
 expect(converted.costingInputs.ProcessLossMode).toBe('GradePath');
 expect(d.costingInputs.ProcessLossMode).toBeUndefined();
});
