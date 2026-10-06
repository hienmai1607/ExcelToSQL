import {useState} from 'react';
// Mix rows can contain nested captured grade data.
import {decimalDisplay} from './number-format';
import {GradeTree} from './grade-tree';
import {Modal,Badge} from './ui';
import {IconButton} from './icons';

export type MixStructure={MixVersionID?:unknown;items:Record<string,unknown>[]};
export function parseMixStructure(value:unknown):MixStructure|null{
 try{const result=typeof value==='string'?JSON.parse(value):value;if(result&&Array.isArray(result.items))return result as MixStructure}catch{/* Old requests are not reconstructed from today's Master. */}
 return null;
}
export function mixFormula(mix:MixStructure|null|undefined){
 return mix?'Mix Product = '+(mix.items.map(c=>(decimalDisplay(c.UnitQuantity??c.MixUnitQuantity,4)||'?')+' × '+String(c.ProductName??c.ProductCode??'Product')).join(' + ')||'No captured child Products.') : undefined;
}
export function MixStructureDialog({mix,onClose}:{mix:MixStructure;onClose:()=>void}){
 const [grades,setGrades]=useState(false);
 return <Modal label="Product structure" className="dialog grade-dialog" onClose={onClose}>
  <div className="customer-editor-heading"><div><h2>Product structure</h2><p>Saved mix composition. Packaging requirements remain separate for each child Product.</p></div><IconButton icon="close" label="Close product structure" onClick={onClose}/></div>
  <div className="grade-view-switch" role="group" aria-label="Product structure view"><button aria-pressed={!grades} onClick={()=>setGrades(false)}>Product Mix</button><button aria-pressed={grades} onClick={()=>setGrades(true)}>Grade</button></div>
  <Badge value="Read only"/><p>{mixFormula(mix)}</p>
  {!mix.items.length?<p>No Product Mix structure was captured.</p>:!grades?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Unit quantity</th><th>Net weight (g)</th></tr></thead><tbody>{mix.items.map((c,i)=><tr key={String(c.ProductID??i)}><td>{String(c.ProductCode??'')} · {String(c.ProductName??'')}</td><td>{decimalDisplay(c.UnitQuantity??c.MixUnitQuantity,4)}</td><td>{decimalDisplay(c.WeightGrams,2)||'—'}</td></tr>)}</tbody></table></div>:<div className="grade-groups">{mix.items.map((c,i)=>{
   let snapshot:any=c.ProductGradeSnapshot;try{if(typeof snapshot==='string')snapshot=JSON.parse(snapshot)}catch{snapshot=null}
   const items=(snapshot?.items||[]).map((g:any)=>({...g,ParentID:String(g.ParentID),RatioPct:String(g.RatioPct)}));
   const materials=items.filter((g:any)=>g.RawMaterialID&&g.RawMaterialCode&&g.RawMaterialName).map((g:any)=>({ID:g.RawMaterialID,GradeID:g.RawGradeID,MaterialCode:g.RawMaterialCode,MaterialName:g.RawMaterialName,Status:'Active'}));
   return <section className="panel grade-group" key={String(c.ProductID??i)} aria-label={'Child grades '+c.ProductCode}><header className="grade-group-heading"><h3>{String(c.ProductCode??'')} · {String(c.ProductName??'')}</h3><span>Quantity {decimalDisplay(c.UnitQuantity??c.MixUnitQuantity,4)}</span></header>{items.length?<GradeTree items={items} readonly busy={false} disabled rawGrades={[]} rawMaterials={materials} onAdd={()=>{}} onRemove={()=>{}} onChange={()=>{}}/>:<p>No grade snapshot was captured for this child Product.</p>}</section>;
  })}</div>}
 </Modal>;
}
