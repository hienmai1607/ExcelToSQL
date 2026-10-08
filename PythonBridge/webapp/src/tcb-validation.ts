import type {Draft} from './opportunity-losses';
import {costs,productFields} from './tcb-model';
import {quantity} from './packaging-summary-model';

export type TCBIssue={field:string;message:string};
export function tcbInputIssues(d:Draft):TCBIssue[]{
 const i=d.costingInputs,issues:TCBIssue[]=[];
 for(const price of d.selections)if(!price.PriceID&&'DirectUSDPerLb' in price&&(price.DirectUSDPerLb==null||!/^\d{1,13}(\.\d{1,6})?$/.test(price.DirectUSDPerLb)))issues.push({field:'Price:'+price.Path,message:'Enter a non-negative direct USD/lb price (up to 6 decimals).'});
 for(const [key,value] of Object.entries(i).filter(([key])=>(key==='PalletUSDPerEA'&&!d.row.ParentItemID)||(!d.mix&&productFields.some(([k])=>k===key)))){
  if(value!==null&&value!==''&&!quantity(value,true))issues.push({field:key,message:'Enter a non-negative numeric value.'});
  else if((key.endsWith('Ratio')||key==='OilPct')&&Number(value)>100)issues.push({field:key,message:'Ratios must be between 0 and 100%.'});
 }
 if(!d.mix){
  if(!costs({...i,Prices:d.selections},d.quoteGrades,d.quotes).balanced&&!issues.some(x=>['RMRatio','SeasoningRatio','OilPct'].includes(x.field)))issues.push({field:'RMRatio',message:'RM + Seasoning/salt + Oil ratios must total 100%.'});
  if(Number(i.SeasoningRatio)>0&&quantity(i.SeasoningUSDPerLb,true)===null)issues.push({field:'SeasoningUSDPerLb',message:'Enter Seasoning/salt cost when its ratio is above zero.'});
  if(Number(i.OilPct)>0&&quantity(i.OilUSDPerLb,true)===null)issues.push({field:'OilUSDPerLb',message:'Enter Oil cost when its percentage is above zero.'});
  if(quantity(i.ProcessingUSDPerLb,true)===null&&!issues.some(x=>x.field==='ProcessingUSDPerLb'))issues.push({field:'ProcessingUSDPerLb',message:'Enter Processing cost (zero is allowed).'});
 }
 return issues;
}
export const tcbInputError=(d:Draft)=>tcbInputIssues(d)[0]?.message??'';
