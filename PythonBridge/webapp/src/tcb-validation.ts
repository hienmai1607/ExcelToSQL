import type {Draft} from './opportunity-losses';
import {materialRecipe,productFields,recipeCost,costGroups} from './tcb-model';
import {quantity} from './packaging-summary-model';
import {savedProcessTree,gradePath} from './grade-process';
import {lossCodeIdentity} from './loss-processes';

export type TCBIssue={field:string;message:string};
export function tcbInputIssues(d:Draft):TCBIssue[]{
 const issues:TCBIssue[]=[];
 if(Array.isArray(d.costingInputs.ProcessLosses)){
  const codes=d.steps.filter(step=>step.ProcessType==='Processing'||step.ProcessType==='Sorting');
  if(new Set(codes.map(lossCodeIdentity)).size!==codes.length)issues.push({field:'Losses',message:'Select each Process Loss type only once. Remove or change duplicate loss codes.'});
 }
 const active=new Set(savedProcessTree(d.grades).filter(g=>g.Process).map(gradePath));
 for(const row of (d.costingInputs.ProcessLosses??[]).filter(r=>active.has(r.Path))){
  const count=d.steps.filter(s=>s.ProcessType==='Processing'||s.ProcessType==='Sorting').length;
  if(row.Ratios.length!==count||row.Ratios.some(v=>!/^\d+(?:\.\d{1,2})?$/.test(v)||Number(v)<0||Number(v)>100))issues.push({field:'ProcessLoss:'+row.Path,message:'Enter one 0–100% ratio per loss code, with up to two decimals.'});
  else if(!row.Formula?.trim()&&row.Ratios.some(v=>Number(v)===100))issues.push({field:'ProcessLoss:'+row.Path,message:'Process loss must leave a positive yield below 100% loss.'});
 }
 for(const price of d.selections)if(!price.PriceID&&'DirectUSDPerLb' in price&&(price.DirectUSDPerLb==null||!/^(?:\d{1,13}(?:\.\d{1,6})?|\.\d{1,6})$/.test(price.DirectUSDPerLb)))issues.push({field:'Price:'+price.Path,message:'Enter a non-negative direct USD/lb price (up to 6 decimals).'});
 if(!d.mix)for(const leaf of costGroups({...d.costingInputs,Prices:d.selections},d.quoteGrades,d.quotes).filter(g=>g.process)){
  const i=materialRecipe(d.costingInputs,leaf.Path),prefix='Recipe:'+leaf.Path+':';
  for(const [key] of productFields){
   const value=i[key];
   if(value!==null&&value!==''&&!quantity(value,true))issues.push({field:prefix+key,message:'Enter a non-negative numeric value.'});
   else if((key.endsWith('Ratio')||key==='OilPct')&&Number(value)>100)issues.push({field:prefix+key,message:'Ratios must be between 0 and 100%.'});
   else if(value!==null&&value!==''&&!/^(?:\d{1,13}(?:\.\d{1,6})?|\.\d{1,6})$/.test(String(value)))issues.push({field:prefix+key,message:'Use up to 6 decimal places.'});
   else if((key.endsWith('Ratio')||key==='OilPct')&&value!=null&&!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(String(value)))issues.push({field:prefix+key,message:'Ratios support up to 2 decimal places.'});
  }
  if(!recipeCost(i,quantity('0',true)).balanced&&!issues.some(x=>x.field.startsWith(prefix)&&['RMRatio','SeasoningRatio','OilPct'].some(k=>x.field===prefix+k)))issues.push({field:prefix+'RMRatio',message:'RM + Seasoning/salt + Oil ratios must total 100%.'});
  if(Number(i.SeasoningRatio)>0&&quantity(i.SeasoningUSDPerLb,true)===null)issues.push({field:prefix+'SeasoningUSDPerLb',message:'Enter Seasoning/salt cost when its ratio is above zero.'});
  if(Number(i.OilPct)>0&&quantity(i.OilUSDPerLb,true)===null)issues.push({field:prefix+'OilUSDPerLb',message:'Enter Oil cost when its percentage is above zero.'});
  if(quantity(i.ProcessingUSDPerLb,true)===null&&!issues.some(x=>x.field===prefix+'ProcessingUSDPerLb'))issues.push({field:prefix+'ProcessingUSDPerLb',message:'Enter Processing cost (zero is allowed).'});
 }
 return issues;
}
export const tcbInputError=(d:Draft)=>tcbInputIssues(d)[0]?.message??'';
