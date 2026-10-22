import {quantity,multiply,type Fraction} from './packaging-summary-model';
import {money,type TCBInputs} from './tcb-model';
export const lossFields=['LossProductPct','PrimaryLossPct','SecondaryLossPct','TertiaryLossPct','MixPrimaryLossPct','MixSecondaryLossPct','MixTertiaryLossPct'] as const;
export type LossField=typeof lossFields[number];
export const processFields={Sorting:'LossProductPct',Processing:'LossProductPct',PrimaryPackaging:'PrimaryLossPct',SecondaryPackaging:'SecondaryLossPct',TertiaryPackaging:'TertiaryLossPct',MixPrimaryPackaging:'MixPrimaryLossPct',MixSecondaryPackaging:'MixSecondaryLossPct',MixTertiaryPackaging:'MixTertiaryLossPct'} as const;
export type ProcessType=keyof typeof processFields;
export type LossStep={ProcessType:ProcessType;ProcessName?:string|null;Sequence:number|string;LossPct:string;MasterID?:number|null;MasterVersion?:string|null;Shared?:boolean};
export const lossCodeIdentity=(step:LossStep)=>step.MasterID?'master:'+step.MasterID:'name:'+(step.ProcessName||step.ProcessType).trim().toLowerCase();
export function processOptions(mix:boolean,layers:number):[ProcessType,string][]{
 const options:[ProcessType,string][]=mix?[]:[['Sorting','Sorting'],['Processing','Processing / Roasting']];
 (['Primary','Secondary','Tertiary'] as const).slice(0,layers).forEach((layer,index)=>options.push([(mix?'Mix':'')+layer+'Packaging' as ProcessType,'Packaging ('+(mix?'Mix ':'')+['1st','2nd','3rd'][index]+' PM)']));
 return options;
}
export function migrateLossProcesses(inputs:TCBInputs):LossStep[]{
 if(Array.isArray(inputs.LossProcesses))return inputs.LossProcesses as LossStep[];
 // Preserve historical aggregate losses, without inventing their original steps.
 const result:LossStep[]=[];
 for(const field of lossFields){
  const pct=quantity(inputs[field],true);
  if(pct&&pct.n>0n){const type=field==='LossProductPct'?'Processing':field.replace('LossPct','Packaging') as ProcessType;result.push({ProcessType:type,Sequence:result.length+1,LossPct:String(inputs[field])})}
 }
 return result;
}
export function lossError(rows:LossStep[],allowed:[ProcessType,string][]){
 if(rows.length>100)return 'Up to 100 loss processes are allowed.';
 const sequences=new Set<string>();
 for(const row of rows){
  const seq=Number(row.Sequence),loss=quantity(row.LossPct,true);
  if(!Number.isInteger(seq)||seq<1||seq>1000||sequences.has(processFields[row.ProcessType]+':'+seq))return 'Within each loss group, process sequence must be unique whole numbers from 1 to 1,000.';
  sequences.add(processFields[row.ProcessType]+':'+seq);
  if(!loss||loss.n>100n*loss.d||!/^\d+(?:\.\d{1,2})?$/.test(String(row.LossPct)))return 'Each process loss must be 0–100%, with at most two decimals.';
  if(!allowed.some(([type])=>type===row.ProcessType))return 'Remove or change a process that does not apply to the current product or packaging layers.';
 }
 return '';
}
export function lossFieldIssues(rows:LossStep[],allowed:[ProcessType,string][]){
 const issues=rows.flatMap((row,index)=>{const message=lossError([row],allowed);return message?[{index,message}]:[]});
 const aggregate=lossError(rows,allowed);
 if(!issues.length&&aggregate)issues.push({index:-1,message:aggregate});
 return issues;
}
export function lossTotals(rows:LossStep[]):Record<LossField,Fraction|null>{
 const surviving=Object.fromEntries(lossFields.map(field=>[field,{n:1n,d:1n}])) as Record<LossField,Fraction|null>;
 for(const step of [...rows].sort((a,b)=>Number(a.Sequence)-Number(b.Sequence))){
  const loss=quantity(step.LossPct,true),field=processFields[step.ProcessType];
  if(!field)continue;
  surviving[field]=surviving[field]&&loss&&loss.n<=100n*loss.d?multiply(surviving[field]!,{n:100n*loss.d-loss.n,d:100n*loss.d}):null;
 }
 return Object.fromEntries(lossFields.map(field=>{const yieldValue=surviving[field];return [field,yieldValue?{n:100n*(yieldValue.d-yieldValue.n),d:yieldValue.d}:null]})) as Record<LossField,Fraction|null>;
}
export const lossDisplay=(value:Fraction|null)=>money(value).replace(' USD','%');
