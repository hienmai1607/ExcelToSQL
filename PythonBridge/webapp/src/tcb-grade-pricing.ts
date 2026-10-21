import type {Draft} from './opportunity-losses';
import {classifyProcessLeaves,gradePath,savedProcessTree,processRecipePaths} from './grade-process';
import {defaultInputs,manualCostInputs,productFields} from './tcb-model';
type GradePricing=Pick<Draft,'grades'|'selections'|'costingInputs'>&Partial<Pick<Draft,'quoteGrades'|'pricingGradeKey'>>;
export function activeCostInputs(d:GradePricing){
 const active=d.grades.length?new Set(savedProcessTree(d.grades).filter(g=>g.Process).map(gradePath)):processRecipePaths(d.quoteGrades??[]);
 return {...manualCostInputs(d.costingInputs),MaterialCosts:(d.costingInputs.MaterialCosts??[]).filter(r=>active.has(r.Path)),...(Array.isArray(d.costingInputs.ProcessLosses)?{ProcessLosses:d.costingInputs.ProcessLosses.filter(r=>active.has(r.Path))}:{})};
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
 const recipePaths=new Set(same.filter(g=>g.Process!=null||!parents.has(gradePath(g))).map(gradePath));
 const recipes=(d.costingInputs.MaterialCosts??[]).filter(r=>recipePaths.has(r.Path));
 for(const g of savedProcessTree(grades).filter(g=>g.Process&&parents.has(gradePath(g)))){
  if(!recipes.some(r=>r.Path===gradePath(g)))recipes.push({Path:gradePath(g),...Object.fromEntries(productFields.map(([key])=>[key,defaultInputs()[key]]))});
 }
 const structure=(items:Draft['grades'])=>JSON.stringify(items.map(g=>({...g,Process:undefined})));
 const processOnly=structure(grades)===structure(d.grades)&&d.pricingGradeKey===JSON.stringify(d.grades);
 return {...d,grades,selections:d.selections.filter(s=>leaves.has(s.Path)),costingInputs:{...d.costingInputs,MaterialCosts:recipes,...(Array.isArray(d.costingInputs.ProcessLosses)?{ProcessLosses:d.costingInputs.ProcessLosses.filter(r=>recipePaths.has(r.Path))}:{})},
  ...(processOnly&&d.quoteGrades?{quoteGrades:classifyProcessLeaves(grades,d.quoteGrades),pricingGradeKey:JSON.stringify(grades)}:{})};
}
