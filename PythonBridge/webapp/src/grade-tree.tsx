import {decimalDisplay} from './number-format';
import {IconButton} from './icons';
import type {GradeItem,RawGradeOption} from './product-grades';

type Props={rawGrades?:RawGradeOption[];items:GradeItem[];busy:boolean;readonly:boolean;disabled:boolean;
 onAdd:(parent:string)=>void;onRemove:(item:GradeItem)=>void;
 onChange:(item:GradeItem,patch:Partial<Pick<GradeItem,'Grade'|'RawGradeID'|'RatioPct'>>)=>void};
export function GradeTree({rawGrades=[],items,busy,readonly,disabled,onAdd,onRemove,onChange}:Props){
 const children=new Map<string,GradeItem[]>();
 for(const item of items){const list=children.get(item.ParentID)||[];list.push(item);children.set(item.ParentID,list)}
 for(const list of children.values())list.sort((a,b)=>a.ID-b.ID);
 const levels=Math.max(1,...items.map(i=>i.ParentID.split('/').length));
 function total(parent:string){
  const siblings=children.get(parent)||[];
  const valid=siblings.every(i=>/^\d{1,3}(\.\d{1,2})?$/.test(i.RatioPct)&&Number(i.RatioPct)>0&&Number(i.RatioPct)<=100);
  const sum=siblings.reduce((n,i)=>n+Math.round(Number(i.RatioPct)*100),0);
  return <small className={'grade-tree-total'+(valid&&sum===10000?'':' grade-tree-unbalanced')}>Parent {parent}: {valid?decimalDisplay(String(sum/100),2):'Check ratios'}{valid?'% / 100%':''}</small>;
 }
 function branch(parent:string,depth:number){
  if(depth>12)return null;
  return <ul className="grade-tree-branches" aria-label={'Children of '+parent}>{(children.get(parent)||[]).map(item=>{
   const id=parent+'/'+item.ID,hasChildren=children.has(id);
   const parentGrade=items.find(p=>p.ParentID+'/'+p.ID===parent)?.RawGradeID;
   const options=parent==='0'?rawGrades:rawGrades.filter(g=>!!parentGrade&&g.ParentGradeID===parentGrade);
   return <li key={id}><div className="grade-tree-node" data-grade-path={id}>
    <div className="grade-tree-node-heading"><small>{id}</small>{!readonly&&<div className="grade-tree-actions">
    <IconButton icon="plus" label={'Add child grade to '+id} disabled={disabled||items.length>=1000||depth>=12} onClick={()=>onAdd(id)}/>
    <IconButton icon="close" label={'Remove grade '+id} disabled={disabled} onClick={()=>onRemove(item)}/>
    </div>}</div>
    {readonly?<div className="grade-tree-readonly-fields"><strong>{item.Grade||'Unnamed grade'}</strong><span className="grade-tree-ratio">{decimalDisplay(item.RatioPct,2)??'—'}%</span></div>:
    <fieldset disabled={disabled}><label>Grade<select aria-label={'Grade '+id} value={item.RawGradeID??''} onChange={e=>{const grade=rawGrades.find(g=>g.ID===Number(e.target.value));onChange(item,{RawGradeID:grade?.ID??null,Grade:grade?.GradeName||''})}}>
     <option value="">{item.Grade&&!item.RawGradeID?item.Grade+' (legacy - select Raw Grade)':'Choose Raw Grade'}</option>
     {item.RawGradeID&&!options.some(g=>g.ID===item.RawGradeID)&&<option value={item.RawGradeID} disabled>{item.Grade} (unavailable for this parent)</option>}
     {options.map(g=><option key={g.ID} value={g.ID}>{g.GradeName} - {g.MaterialCode?[g.MaterialCode,g.MaterialName].filter(Boolean).join(' - '):'Group grade'}</option>)}
    </select>{parent!=='0'&&!options.length&&<small>{parentGrade?'No active child grades for this parent in Raw Grade Master.':'Choose the parent grade first.'}</small>}</label>
    <label>Ratio %<input aria-label={'Ratio '+id} inputMode="decimal" maxLength={6} value={item.RatioPct} onChange={e=>onChange(item,{RatioPct:e.target.value})}/></label></fieldset>}
    {hasChildren&&<>{total(id)}<small>{children.get(id)!.length} child grade{children.get(id)!.length===1?'':'s'}</small></>}

   </div>{hasChildren&&branch(id,depth+1)}</li>;
  })}</ul>;
 }
 return <section aria-label="Horizontal grade tree">
 <div className="grade-tree-toolbar"><p className="grade-readonly-note">Ratios under each parent must total 100%.</p>
 {!readonly&&<IconButton icon="plus" label="Add root grade" disabled={disabled||items.length>=1000} onClick={()=>onAdd('0')}/>}</div>
 {!!items.length&&total('0')}
 {!items.length?<div className="empty">{busy?'Loading grades…':readonly?'No grades in this version.':'No grades yet. Use Add root grade to begin.'}</div>:
 <div className="grade-tree-scroll" tabIndex={0} role="region" aria-label="Scrollable grade levels">
 <div className="grade-tree-canvas">
 <div className="grade-tree-levels">{Array.from({length:levels},(_,i)=><h3 key={i}>Level {i+1}</h3>)}</div>
 {branch('0',1)}
 </div></div>}
 </section>;
}
