import type {TCBInputs} from './tcb-model';
import type {Draft} from './opportunity-losses';
import {savedProcessTree,gradePath} from './grade-process';
import {quantity,multiply,quantityDisplay,type Fraction} from './packaging-summary-model';

export type GradeLoss={Path:string;Ratios:string[];Formula?:string|null};
export type GradeLossResult=GradeLoss&{LossPct:string;WeightGrams?:unknown};
const zero=()=>quantity('0',true)!;
const equal=(a:unknown,b:unknown)=>{const x=quantity(a,true),y=quantity(b,true);return !!x&&!!y&&x.n*y.d===y.n*x.d};
export function processLossValue(inputs:TCBInputs,path:string):Fraction|null{
 const row=inputs.ProcessLosses?.find(r=>r.Path===path);
 if(!row)return zero();
 if(row.Ratios.some(r=>!/^\d+(?:\.\d{1,2})?$/.test(r)||!quantity(r,true)||Number(r)>100))return null;
 if(row.Formula?.trim()){
  const result=inputs.ProcessLossResults?.find(r=>r.Path===path&&(r.Formula??'').trim()===row.Formula!.trim()&&r.Ratios.length===row.Ratios.length&&r.Ratios.every((v,i)=>equal(v,row.Ratios[i]))&&(!/\bNW\b/.test(row.Formula!)||equal(r.WeightGrams,inputs.ProcessLossWeight)));
  const value=quantity(result?.LossPct,true);return value&&value.n<100n*value.d?value:null;
 }
 let surviving=quantity('1')!;
 for(const ratio of row.Ratios){const v=quantity(ratio,true)!;surviving=multiply(surviving,{n:100n*v.d-v.n,d:100n*v.d})}
 return surviving.n>0n?{n:100n*(surviving.d-surviving.n),d:surviving.d}:null;
}
export function processLossRows(d:Draft):GradeLoss[]{
 const steps=d.steps.filter(s=>s.ProcessType==='Processing'||s.ProcessType==='Sorting');
 return savedProcessTree(d.grades).filter(g=>g.Process).map(g=>{
  const path=gradePath(g),saved=d.costingInputs.ProcessLosses?.find(r=>r.Path===path);
  return saved?{...saved,Ratios:[...saved.Ratios]}:{Path:path,Ratios:steps.map(s=>String(Array.isArray(d.costingInputs.ProcessLosses)?'0':s.LossPct)),Formula:Array.isArray(d.costingInputs.ProcessLosses)?'':d.formula};
 });
}
export const processLossDisplay=(inputs:TCBInputs,path:string)=>{const value=processLossValue(inputs,path);return value?quantityDisplay(value,6)+'%':'—'};
