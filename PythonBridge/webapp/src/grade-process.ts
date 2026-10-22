import type {GradeItem} from './product-grades';
import type {TCBGrade} from './tcb-model';
import {add,quantity,quantityDisplay} from './packaging-summary-model';
export const gradePath=(g:GradeItem)=>g.ParentID+'/'+g.ID;
export function processAncestor(items:GradeItem[],path:string){
 return items.find(g=>g.Process===true&&path.startsWith(gradePath(g)+'/'));
}
// Legacy snapshots keep their previous per-leaf processing until explicitly edited.
export function editableProcessTree(items:GradeItem[]):GradeItem[]{
 if(items.some(g=>g.Process!=null))return items.map(g=>({...g}));
 const parents=new Set(items.map(g=>g.ParentID));
 return items.map(g=>({...g,Process:!parents.has(gradePath(g))}));
}
export function savedProcessTree(items:GradeItem[]):GradeItem[]{
 return editableProcessTree(items).map(g=>({...g,Process:!!g.Process}));
}
export function classifyProcessLeaves(items:GradeItem[],leaves:TCBGrade[]):TCBGrade[]{
 const processes=savedProcessTree(items).filter(g=>g.Process);
 const result=leaves.map(leaf=>{
  const owner=processes.find(g=>leaf.Path===gradePath(g)||leaf.Path.startsWith(gradePath(g)+'/'));
  return {...leaf,ProcessPaths:JSON.stringify(processes.filter(g=>leaf.Path===gradePath(g)||leaf.Path.startsWith(gradePath(g)+'/')).map(gradePath).sort((a,b)=>b.split('/').length-a.split('/').length)),ProcessPath:owner?gradePath(owner):null,ProcessGrade:owner?.Grade??null};
 });
 return result.map(leaf=>{
  const share=result.filter(g=>g.ProcessPath===leaf.ProcessPath).reduce((sum,g)=>add(sum,quantity(g.Proportion,true)??quantity('0',true)!),quantity('0',true)!);
  return {...leaf,ProcessProportion:leaf.ProcessPath?quantityDisplay(share,28).replaceAll(',',''):leaf.Proportion};
 });
}
export const processRecipePaths=(leaves:TCBGrade[])=>new Set(leaves.map(g=>g.ProcessPath===undefined?g.Path:g.ProcessPath).filter((path):path is string=>typeof path==='string'&&!!path));
