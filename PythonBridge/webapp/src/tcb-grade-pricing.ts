import type {Draft} from './opportunity-losses';
import {classifyProcessLeaves,gradePath,savedProcessTree,processRecipePaths} from './grade-process';
import {processLossRows,processLossTargets,remapAlignedLossFormulas} from './grade-process-loss';
import {manualCostInputs,materialRecipe,productFields,recipePath} from './tcb-model';
type GradePricing=Pick<Draft,'grades'|'selections'|'costingInputs'>&Partial<Pick<Draft,'quoteGrades'|'pricingGradeKey'|'steps'|'masters'|'formula'|'lossDefaults'>>;
export function activeCostInputs(d:GradePricing){
 const active=d.grades.length?new Set(savedProcessTree(d.grades).filter(g=>g.Process).map(gradePath)):processRecipePaths(d.quoteGrades??[]);
 const roots=d.grades.length?d.grades.filter(g=>g.ParentID==='0').map(gradePath):[...new Set((d.quoteGrades??[]).map(g=>recipePath(g.Path)))];
 const targets=new Set(processLossTargets(d.grades));
 return {...manualCostInputs(d.costingInputs),MaterialCosts:roots.map(Path=>({Path,...Object.fromEntries(productFields.map(([key])=>[key,materialRecipe(d.costingInputs,Path)[key]]))})),...(Array.isArray(d.costingInputs.ProcessLosses)?{ProcessLosses:processLossRows(d).filter(r=>r.Path==='0'||active.has(r.Path)),...(d.costingInputs.ProcessLossMode==='GradePath'?{ProcessLossMode:'GradePath' as const,ProcessLossFormulas:Object.fromEntries(Object.entries(d.costingInputs.ProcessLossFormulas??{}).filter(([path])=>targets.has(path)))}:{})}:{})};
}
export function withTCBGrades<T extends GradePricing>(d:T,grades:Draft['grades']):T{
 const parents=new Set(grades.map(g=>g.ParentID)),oldParents=new Set(d.grades.map(g=>g.ParentID));
 const previous=new Map(d.grades.map(g=>[gradePath(g),g]));
 const same=grades.filter(g=>{
  const old=previous.get(gradePath(g));
  return old&&(old.RawGradeID??null)===(g.RawGradeID??null)&&(old.RawMaterialID??null)===(g.RawMaterialID??null)&&
   (g.RawGradeID!=null||old.Grade===g.Grade);
 });
 const leaves=new Set(same.filter(g=>!parents.has(gradePath(g))&&!oldParents.has(gradePath(g))).map(gradePath));
 const sameGrade=grades.filter(g=>{const old=previous.get(gradePath(g));return old&&(old.RawGradeID??null)===(g.RawGradeID??null)&&(g.RawGradeID!=null||old.Grade===g.Grade)});
 const recipePaths=new Set(sameGrade.filter(g=>g.Process!=null||!parents.has(gradePath(g))).map(gradePath));
 const recipes=(d.costingInputs.MaterialCosts??[]).filter(r=>recipePaths.has(r.Path));
 const structure=(items:Draft['grades'])=>JSON.stringify(items.map(g=>({...g,Process:undefined})));
 const processOnly=structure(grades)===structure(d.grades)&&d.pricingGradeKey===JSON.stringify(d.grades);
 const next={...d,grades,selections:d.selections.filter(s=>leaves.has(s.Path)),costingInputs:{...d.costingInputs,MaterialCosts:recipes,...(Array.isArray(d.costingInputs.ProcessLosses)?{ProcessLosses:d.costingInputs.ProcessLosses.filter(r=>r.Path==='0'||recipePaths.has(r.Path)),...(d.costingInputs.ProcessLossMode==='GradePath'?{ProcessLossFormulas:Object.fromEntries(Object.entries(d.costingInputs.ProcessLossFormulas??{}).filter(([path])=>recipePaths.has(path)))}:{})}:{})},
  ...(processOnly&&d.quoteGrades?{quoteGrades:classifyProcessLeaves(grades,d.quoteGrades),pricingGradeKey:JSON.stringify(grades)}:{})};
 if(Array.isArray(next.costingInputs.ProcessLosses)||(next.lossDefaults?.length??0)>0){
  const active=processLossRows(next),paths=new Set(active.map(r=>r.Path));
  next.costingInputs.ProcessLosses=[...next.costingInputs.ProcessLosses?.filter(r=>!paths.has(r.Path))??[],...active];
 }
 if(next.costingInputs.ProcessLossLayout==='Aligned')next.costingInputs.ProcessLossFormulas=remapAlignedLossFormulas({...d.costingInputs,ProcessLosses:processLossRows(d)},{...next.costingInputs,ProcessLosses:processLossRows(next)},processLossTargets(grades)).ProcessLossFormulas;
 return next;
}
