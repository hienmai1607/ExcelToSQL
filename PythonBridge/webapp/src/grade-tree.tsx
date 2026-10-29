import {editableProcessTree} from './grade-process';
import {decimalDisplay} from './number-format';
import {useRef,type ReactNode,type CSSProperties} from 'react';
import {useGradeMaterialAlignment} from './grade-material-alignment';
import {AddMasterButton} from './add-master-button';
import type {Row} from './api';
import {IconButton} from './icons';
import type {GradeItem,RawGradeOption,RawMaterialOption} from './product-grades';

type Props={autoFirstRatio?:boolean;compactCards?:boolean;renderPricing?:(item:GradeItem)=>ReactNode;rawGrades?:RawGradeOption[];rawMaterials?:RawMaterialOption[];items:GradeItem[];busy:boolean;readonly:boolean;disabled:boolean;
 onNewGrade?:(item:GradeItem)=>void;onNewMaterial?:(item:GradeItem)=>void;onGradeEdited?:(item:GradeItem,record:Row)=>void;onMaterialEdited?:(item:GradeItem,record:Row)=>void;
 onAdd:(parent:string)=>void;onRemove:(item:GradeItem)=>void;
 onChange:(item:GradeItem,patch:Partial<Pick<GradeItem,'Grade'|'RawGradeID'|'RawMaterialID'|'RatioPct'|'Process'>>)=>void};
export function GradeTree({rawGrades=[],rawMaterials=[],items,busy,readonly,disabled,onNewGrade,onNewMaterial,onGradeEdited,onMaterialEdited,onAdd,onRemove,onChange,renderPricing,compactCards=false,autoFirstRatio=false}:Props){
 const canvas=useRef<HTMLDivElement>(null);
 const processItems=editableProcessTree(items);
 const aligned=useGradeMaterialAlignment(canvas,JSON.stringify([readonly,!!renderPricing,items.map(i=>[i.ParentID,i.ID,i.RawGradeID,i.RawMaterialID]),rawGrades.map(g=>[g.ID,g.FinalGrade])]),compactCards);
 const children=new Map<string,GradeItem[]>();
 for(const item of items){const list=children.get(item.ParentID)||[];list.push(item);children.set(item.ParentID,list)}
 for(const list of children.values())list.sort((a,b)=>a.ID-b.ID);
 const levels=Math.max(1,...items.map(i=>i.ParentID.split('/').length));
 function total(parent:string){
  const siblings=children.get(parent)||[];
  const valid=siblings.every(i=>/^\d{1,3}(\.\d{1,2})?$/.test(i.RatioPct)&&Number(i.RatioPct)>0&&Number(i.RatioPct)<=100);
  const sum=siblings.reduce((n,i)=>n+Math.round(Number(i.RatioPct)*100),0);
  return <small title={'Parent '+parent+' ratios'} aria-label={'Parent '+parent+' ratios'} className={'grade-tree-total'+(valid&&sum===10000?'':' grade-tree-unbalanced')}>{valid?decimalDisplay(String(sum/100),2):'Check ratios'}{valid?'% / 100%':''}</small>;
 }
 function branch(parent:string,depth:number){
  if(depth>12)return null;
  return <ul className="grade-tree-branches" aria-label={'Children of '+parent}>{(children.get(parent)||[]).map(item=>{
   const id=parent+'/'+item.ID,hasChildren=children.has(id),finalGrade=rawGrades.some(g=>g.ID===item.RawGradeID&&g.FinalGrade===true);
   const parentGrade=items.find(p=>p.ParentID+'/'+p.ID===parent)?.RawGradeID;
   const options=parent==='0'?rawGrades.filter(g=>g.ParentGradeID==null):rawGrades.filter(g=>!!parentGrade&&g.ParentGradeID===parentGrade);

   return <li key={id}><div className="grade-tree-node" data-grade-path={id} style={{minHeight:aligned.rows[id]?.minHeight}}>
    <div className="grade-tree-node-heading"><small>{id}</small><label className="grade-process-toggle"><input type="checkbox" aria-label={'Process '+id} checked={!!processItems.find(g=>g.ParentID+'/'+g.ID===id)?.Process} disabled={readonly||disabled} onChange={e=>onChange(item,{Process:e.target.checked})}/>Process</label>{hasChildren&&<span className="grade-tree-node-summary">{total(id)}<small>{children.get(id)!.length} child{children.get(id)!.length===1?'':'ren'}</small></span>}{!readonly&&<div className="grade-tree-actions">
    <IconButton icon="plus" label={'Add child grade to '+id} disabled={disabled||items.length>=1000||depth>=12||finalGrade} onClick={()=>onAdd(id)}/>
    <IconButton icon="close" label={'Remove grade '+id} disabled={disabled} onClick={()=>onRemove(item)}/>
    </div>}</div>
    {readonly?<><div className="grade-tree-readonly-fields"><strong>{item.Grade||'Unnamed grade'}</strong><span className="grade-tree-ratio">{decimalDisplay(item.RatioPct,2)??'—'}%</span></div></>:
    <fieldset disabled={disabled}><label>Grade<span className="master-lookup-control"><select aria-label={'Grade '+id} value={item.RawGradeID??''} onChange={e=>{const grade=rawGrades.find(g=>g.ID===Number(e.target.value));onChange(item,{RawGradeID:grade?.ID??null,RawMaterialID:null,Grade:grade?.GradeName||''})}}>
     <option value="">{item.Grade&&!item.RawGradeID?item.Grade+' (legacy - select Raw Grade)':'Choose Raw Grade'}</option>
     {item.RawGradeID&&!options.some(g=>g.ID===item.RawGradeID)&&<option value={item.RawGradeID} disabled>{item.Grade} (unavailable for this parent)</option>}
     {options.map(g=><option key={g.ID} value={g.ID}>{g.GradeName}</option>)}
    </select>{onNewGrade&&<AddMasterButton entity="raw-grades" selectedValue={item.RawGradeID} onEdited={record=>onGradeEdited?.(item,record)} label={'Add new Raw Grade master for '+id} disabled={parent!=='0'&&!parentGrade} onClick={()=>onNewGrade(item)}/>}</span>{parent!=='0'&&!options.length&&<small>{parentGrade?'No active child grades for this parent in Raw Grade Master.':'Choose the parent grade first.'}</small>}</label>
    <label>Ratio %<input aria-label={'Ratio '+id} inputMode="decimal" maxLength={6} readOnly={autoFirstRatio&&children.get(item.ParentID)?.[0]===item} title={autoFirstRatio&&children.get(item.ParentID)?.[0]===item?'Automatically calculated as 100% minus the other ratios in this group.':undefined} value={item.RatioPct} onChange={e=>onChange(item,{RatioPct:e.target.value})}/></label>
    </fieldset>}

   </div>{hasChildren&&branch(id,depth+1)}</li>;
  })}</ul>;
 }
 return <section aria-label="Horizontal grade tree">
 {!items.length&&!readonly&&<div className="grade-tree-toolbar"><IconButton icon="plus" label="Add root grade" disabled={disabled||items.length>=1000} onClick={()=>onAdd('0')}/></div>}
 {!items.length?<div className="empty">{busy?'Loading grades…':readonly?'No grades in this version.':'No grades yet. Use Add root grade to begin.'}</div>:
 <div className="grade-tree-scroll" tabIndex={0} role="region" aria-label="Scrollable grade levels">
 <div className="grade-tree-canvas" ref={canvas} style={{'--grade-columns':levels+(renderPricing?2:1),'--grade-card-height':(aligned.cardHeight??112)+'px'} as CSSProperties}>{compactCards&&<svg className="grade-tree-links" aria-hidden="true">{aligned.connections?.map(link=><path key={link.id} data-connection={link.kind} data-path={link.path} d={link.d}/>)}</svg>}<div className="grade-tree-hierarchy">
 <div className="grade-tree-levels">{Array.from({length:levels},(_,i)=><div className="grade-tree-level-heading" key={i}><h3>Level {i+1}</h3>{i===0&&<>{total('0')}{!readonly&&<IconButton icon="plus" label="Add root grade" disabled={disabled||items.length>=1000} onClick={()=>onAdd('0')}/>}</>}</div>)}</div>
 {branch('0',1)}
 </div><section className="grade-material-section" aria-label="Raw Material" style={{width:'var(--grade-card-width)'}}><h3>Raw Material</h3>
 <div className="grade-material-list" style={{height:aligned.height}}>{items.filter(item=>rawGrades.some(g=>g.ID===item.RawGradeID&&g.FinalGrade===true)||(readonly&&!!item.RawMaterialID)).map(item=>{
  const id=item.ParentID+'/'+item.ID;
  const materials=rawMaterials.filter(m=>m.GradeID===item.RawGradeID);
  const selectedMaterial=rawMaterials.find(m=>m.ID===item.RawMaterialID);
  return <div className="grade-material-card" key={id} data-material-path={id} style={{top:aligned.rows[id]?.top??0,left:0}}><div className="grade-material-heading"><small>{id}</small><strong>{item.Grade||'Choose a grade'}</strong></div>
   {readonly?<><div className="grade-material-label">Raw Material{selectedMaterial&&<small>{selectedMaterial.MaterialCode}</small>}</div><p>{selectedMaterial?selectedMaterial.MaterialName:item.RawMaterialID?'Raw Material #'+item.RawMaterialID+' (unavailable)':'No material selected'}</p></>:<fieldset disabled={disabled}><label className="grade-tree-material"><span className="grade-material-label">Raw Material{selectedMaterial&&<small>{selectedMaterial.MaterialCode}</small>}</span><span className="master-lookup-control"><select aria-label={'Raw Material '+id} value={item.RawMaterialID??''} onChange={e=>onChange(item,{RawMaterialID:e.target.value?Number(e.target.value):null})}><option value="">No material selected</option>{item.RawMaterialID&&!materials.some(m=>m.ID===item.RawMaterialID)&&<option value={item.RawMaterialID} disabled>Raw Material #{item.RawMaterialID} (unavailable for this grade)</option>}{materials.map(m=><option key={m.ID} value={m.ID} disabled={m.Status!=='Active'}>{m.MaterialName}{m.Status!=='Active'?' (Blocked)':''}</option>)}</select>{onNewMaterial&&<AddMasterButton entity="raw-materials" selectedValue={item.RawMaterialID} onEdited={record=>onMaterialEdited?.(item,record)} label={'Add new Raw Material master for '+id} disabled={!item.RawGradeID} onClick={()=>onNewMaterial(item)}/>}</span>{item.RawGradeID&&!materials.length&&<small>No Raw Materials assigned to this grade.</small>}</label></fieldset>}
  </div>;
 })}</div>{!items.some(item=>rawGrades.some(g=>g.ID===item.RawGradeID&&g.FinalGrade===true)||(readonly&&!!item.RawMaterialID))&&<p className="grade-material-empty">Choose a final grade to select its assigned Raw Material.</p>}
 </section>{renderPricing&&<section className="grade-pricing-section" aria-label="Grade pricing"><h3>Pricing</h3><div className="grade-pricing-list" style={{height:aligned.height}}>{items.filter(item=>!children.has(item.ParentID+'/'+item.ID)).sort((a,b)=>(a.ParentID+'/'+a.ID).localeCompare(b.ParentID+'/'+b.ID,undefined,{numeric:true})).map(item=>{const id=item.ParentID+'/'+item.ID;return <div className="grade-pricing-card" key={id} data-pricing-path={id} data-cost-grade={id} style={{top:aligned.rows[id]?.pricingTop??0}}>{renderPricing(item)}</div>})}</div></section>}</div></div>}
 </section>;
}
