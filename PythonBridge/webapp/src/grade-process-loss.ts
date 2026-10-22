import type {TCBInputs} from './tcb-model';

import {savedProcessTree,gradePath} from './grade-process';
import {quantity,multiply,quantityDisplay,type Fraction} from './packaging-summary-model';
import type {GradeItem} from './product-grades';
import type {LossStep} from './loss-processes';
import type {Row} from './api';

export type ProcessCode={MasterID?:number|null;MasterVersion?:string|null;ProcessName:string;Shared?:boolean;DefaultID?:number;DefaultVersion?:string};
export type GradeLoss={Path:string;Codes?:ProcessCode[]|null;Ratios:string[];Formula?:string|null};
export type GradeLossResult=Omit<GradeLoss,'Codes'>&{Codes?:(ProcessCode|null)[]|null;LossPct:string;WeightGrams?:unknown};
const zero=()=>quantity('0',true)!;
const equal=(a:unknown,b:unknown)=>{const x=quantity(a,true),y=quantity(b,true);return !!x&&!!y&&x.n*y.d===y.n*x.d};
export function processLossValue(inputs:TCBInputs,path:string,sourcePaths?:string[]):Fraction|null{
 const row=inputs.ProcessLossMode==='GradePath'?pathLossRow(inputs,path,sourcePaths):inputs.ProcessLosses?.find(r=>r.Path===path);
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
type ProcessDraft={grades:GradeItem[];costingInputs:TCBInputs;steps?:LossStep[];formula?:string;masters?:LossStep[];lossDefaults?:Row[]};
export type PathLossRow=Omit<GradeLoss,'Codes'>&{Codes:(ProcessCode|null)[];Sources:({Path:string;Index:number}|undefined)[]};
export function processLossSlots(rows:GradeLoss[]){
 const offsets=new Map<string,number>();
 for(const stage of rows.filter(r=>r.Path!=='0').sort((a,b)=>b.Path.split('/').length-a.Path.split('/').length)){
  offsets.set(stage.Path,Math.max(0,...rows.filter(r=>r.Path.startsWith(stage.Path+'/')).map(r=>offsets.get(r.Path)!+r.Ratios.length)));
 }
 offsets.set('0',Math.max(0,...rows.filter(r=>r.Path!=='0').map(r=>offsets.get(r.Path)!+r.Ratios.length)));
 return {offsets,width:offsets.get('0')!+(rows.find(r=>r.Path==='0')?.Ratios.length??0)};
}
function lossChain(inputs:TCBInputs,path:string,sourcePaths?:string[]){
 return (inputs.ProcessLosses??[]).filter(r=>r.Path==='0'||(sourcePaths?sourcePaths.includes(r.Path):r.Path===path||path.startsWith(r.Path+'/'))).sort((a,b)=>b.Path.split('/').length-a.Path.split('/').length);
}
export function pathLossRow(inputs:TCBInputs,path:string,sourcePaths?:string[]):PathLossRow{
 const chain=lossChain(inputs,path,sourcePaths);
 if(inputs.ProcessLossLayout==='Aligned'){
  const {offsets,width}=processLossSlots(inputs.ProcessLosses??[]),Ratios=Array<string>(width).fill('0'),Codes=Array<ProcessCode|null>(width).fill(null),Sources:PathLossRow['Sources']=Array(width).fill(undefined);
  for(const stage of chain)stage.Ratios.forEach((value,Index)=>{const slot=offsets.get(stage.Path)!+Index;Ratios[slot]=value;Codes[slot]=stage.Codes?.[Index]??null;Sources[slot]={Path:stage.Path,Index}});
  return {Path:path,Codes,Ratios,Sources,Formula:inputs.ProcessLossFormulas?.[path]??''};
 }
 return {Path:path,Codes:chain.flatMap(r=>r.Codes??[]),Ratios:chain.flatMap(r=>r.Ratios),Formula:inputs.ProcessLossFormulas?.[path]??'',Sources:chain.flatMap(r=>r.Ratios.map((_,Index)=>({Path:r.Path,Index})))};
}
function remapFormula(formula:string,previous:PathLossRow,next:PathLossRow){
 return formula.replace(/\bL(\d+)\b/g,(original,n)=>{
  const source=previous.Sources[Number(n)-1];if(!source)return Number(n)<=previous.Ratios.length?'0':original;
  const code=previous.Codes[Number(n)-1],identity=code?.MasterID??code?.ProcessName;
  const sameCount=previous.Sources.filter(s=>s?.Path===source.Path).length===next.Sources.filter(s=>s?.Path===source.Path).length;
  const slot=next.Sources.findIndex((s,i)=>s?.Path===source.Path&&(!sameCount&&identity!=null?identity===(next.Codes[i]?.MasterID??next.Codes[i]?.ProcessName):s.Index===source.Index));
  return slot<0?'0':'L'+(slot+1);
 });
}
export function remapAlignedLossFormulas<T extends TCBInputs>(before:TCBInputs,after:T,targets:string[]):T{
 if(before.ProcessLossMode!=='GradePath'||before.ProcessLossLayout!=='Aligned')return after;
 const formulas={...after.ProcessLossFormulas};
 for(const path of targets)if(formulas[path])formulas[path]=remapFormula(formulas[path],pathLossRow(before,path),pathLossRow(after,path));
 return {...after,ProcessLossFormulas:formulas};
}
export function processLossTargets(grades:GradeItem[]):string[]{
 const tree=savedProcessTree(grades),parents=new Set(tree.map(g=>g.ParentID));
 return [...new Set(tree.filter(g=>!parents.has(gradePath(g))).map(g=>{
  const path=gradePath(g);
  return tree.filter(p=>p.Process&&(path===gradePath(p)||path.startsWith(gradePath(p)+'/'))).sort((a,b)=>gradePath(b).length-gradePath(a).length).map(gradePath)[0]??path;
 }))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
}
export function processLossTableRows(d:ProcessDraft):PathLossRow[]{
 const inputs={...d.costingInputs,ProcessLosses:processLossRows(d)};
 return processLossTargets(d.grades).map(path=>{
  const row=pathLossRow({...inputs,ProcessLossLayout:'Aligned'},path),local=pathLossRow({...inputs,ProcessLossLayout:'Local'},path);
  if(inputs.ProcessLossMode==='GradePath')return inputs.ProcessLossLayout==='Aligned'?row:{...row,Formula:remapFormula(local.Formula??'',local,row)};
  // Preserve old stage-formula mathematics when explicitly switching an existing draft.
  let offset=0;
  const parts=lossChain(inputs,path).map(stage=>{
   const formula=stage.Formula?.trim();
   const part=formula?formula.replace(/\bL(\d+)\b/g,(_,n)=>'L'+(Number(n)+offset)):stage.Ratios.length?'1-'+stage.Ratios.map((_,i)=>'(1-L'+(offset+i+1)+')').join('*'):'';
   offset+=stage.Ratios.length;return part;
  }).filter(Boolean);
  const formula=parts.length>1?'1-'+parts.map(p=>'(1-('+p+'))').join('*'):parts[0]??'';
  return {...row,Formula:remapFormula(formula,local,row)};
 });
}
export function gradePathDraft<T extends ProcessDraft>(d:T):T{
 const rows=processLossTableRows(d),inputs={...d.costingInputs,ProcessLosses:processLossRows(d)};
 const results=inputs.ProcessLossMode==='GradePath'&&inputs.ProcessLossLayout!=='Aligned'?inputs.ProcessLossResults?.map(result=>{
  const aligned=rows.find(r=>r.Path===result.Path);
  return aligned&&processLossValue(inputs,result.Path)?{...result,Codes:aligned.Codes,Ratios:aligned.Ratios,Formula:aligned.Formula}:result;
 }):inputs.ProcessLossResults;
 return {...d,formula:'',costingInputs:{...inputs,ProcessLossMode:'GradePath',ProcessLossLayout:'Aligned',ProcessLossResults:results,ProcessLossFormulas:{...d.costingInputs.ProcessLossFormulas,...Object.fromEntries(rows.map(r=>[r.Path,r.Formula??'']))}}};
}
export const packingType=(name:string)=>['packing','packing loss'].includes(name.trim().toLowerCase());
export function processCode(master:LossStep):ProcessCode{
 return {MasterID:master.MasterID,MasterVersion:master.MasterVersion,ProcessName:master.ProcessName||master.ProcessType,Shared:!!master.Shared};
}
export function defaultProcessCode(d:ProcessDraft,path:string,master:LossStep){
 const grade=d.grades.find(g=>gradePath(g)===path);
 const candidates=(d.lossDefaults??[]).filter(r=>Number(r.ProcessTypeID)===master.MasterID);
 const selected=(path!=='0'?candidates.find(r=>r.RawGradeID!=null&&Number(r.RawGradeID)===grade?.RawGradeID):undefined)??candidates.find(r=>r.RawGradeID==null);
 return {code:{...processCode(master),...(selected?{DefaultID:Number(selected.ID),DefaultVersion:String(selected.DefaultVersion)}:{})},ratio:String(selected?.LossPct??'0')};
}
export function processLossRows(d:ProcessDraft):GradeLoss[]{
 const steps=(d.steps??[]).filter(s=>s.ProcessType==='Processing'||s.ProcessType==='Sorting');
 const legacy=steps.map(processCode),hasLegacyPacking=legacy.some(c=>packingType(c.ProcessName))&&(d.costingInputs.ProcessLosses??[]).some(r=>r.Codes==null);
 const rows=savedProcessTree(d.grades).filter(g=>g.Process).map(g=>{
  const path=gradePath(g),saved=d.costingInputs.ProcessLosses?.find(r=>r.Path===path);
  if(saved)return {...saved,Codes:saved.Codes??legacy,Ratios:[...saved.Ratios]};
  if(!Array.isArray(d.costingInputs.ProcessLosses)&&steps.length)return {Path:path,Codes:legacy,Ratios:steps.map(s=>String(s.LossPct)),Formula:d.formula??''};
  const defaults=(d.masters??[]).filter(m=>!packingType(m.ProcessName||m.ProcessType)&&(d.lossDefaults??[]).some(r=>Number(r.ProcessTypeID)===m.MasterID&&r.RawGradeID!=null&&Number(r.RawGradeID)===g.RawGradeID)).map(m=>defaultProcessCode(d,path,m));
  if(defaults.length)return {Path:path,Codes:defaults.map(v=>v.code),Ratios:defaults.map(v=>v.ratio),Formula:''};
  return {Path:path,Codes:legacy,Ratios:steps.map(s=>String(Array.isArray(d.costingInputs.ProcessLosses)?'0':s.LossPct)),Formula:Array.isArray(d.costingInputs.ProcessLosses)?'':d.formula};
 }).sort((a,b)=>a.Path.localeCompare(b.Path,undefined,{numeric:true}));
 if(d.grades.length){
  const saved=d.costingInputs.ProcessLosses?.find(r=>r.Path==='0'),master=(d.masters??[]).find(m=>packingType(m.ProcessName||m.ProcessType));
  const value=master&&!hasLegacyPacking&&!(!Array.isArray(d.costingInputs.ProcessLosses)&&steps.length)?defaultProcessCode(d,'0',master):null;
  rows.push(saved?{...saved,Codes:saved.Codes??[],Ratios:[...saved.Ratios]}:{Path:'0',Codes:value?[value.code]:[],Ratios:value?[value.ratio]:[],Formula:''});
 }
 const shared=new Map<number|string,string>();
 return rows.map(row=>({...row,Ratios:row.Ratios.map((value,index)=>{
  const code=row.Codes?.[index];if(!code?.Shared)return value;
  const key=code.MasterID??code.ProcessName;if(!shared.has(key))shared.set(key,value);
  return shared.get(key)!;
 })}));
}
export const processLossDisplay=(inputs:TCBInputs,path:string)=>{const value=processLossValue(inputs,path);return value?quantityDisplay(value,6)+'%':'—'};
