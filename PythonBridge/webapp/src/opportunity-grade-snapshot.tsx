import {useState} from 'react';
import {call} from './api';
import {Modal,ErrorNote,FieldLabel} from './ui';
import {IconButton,Icon} from './icons';
import {ProductGrades,type GradeItem} from './product-grades';
import {GradeTree} from './grade-tree';import {MixStructureDialog,type MixStructure} from './mix-structure';

export type GradeSnapshot={items:(GradeItem&{RawMaterialCode?:string|null;RawMaterialName?:string|null})[]};
export function parseGradeSnapshot(value:unknown):GradeSnapshot|null{
 try{const snapshot=typeof value==='string'?JSON.parse(value):value;if(snapshot&&Array.isArray(snapshot.items))return {items:snapshot.items.map((i:GradeItem)=>({...i,RatioPct:String(i.RatioPct)}))}}catch{/* Missing legacy snapshots stay missing. */}
 return null;
}
export function GradeSnapshotIcon({value,productID,onChange,mix}:{value:GradeSnapshot|null;productID?:number;onChange?:(value:GradeSnapshot)=>void;mix?:MixStructure|null}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState<GradeSnapshot|null>(null);
 const materials=(draft?.items||[]).filter(i=>i.RawMaterialID&&i.RawMaterialCode&&i.RawMaterialName).map(i=>({ID:i.RawMaterialID!,GradeID:i.RawGradeID!,MaterialCode:i.RawMaterialCode!,MaterialName:i.RawMaterialName!,Status:'Active'}));
 async function show(){
  setError('');if(mix){setOpen(true);return}if(value||!onChange){setDraft(value);setOpen(true);return}
  if(!productID)return;
  setBusy(true);try{const snapshot=await call<GradeSnapshot>('/api/opportunity/products/'+productID+'/grade-snapshot');setDraft(snapshot);setOpen(true)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="product-grade-snapshot"><FieldLabel>Grades</FieldLabel>{onChange&&!mix?<IconButton icon="grade" label="Edit Opportunity grade snapshot" disabled={busy||!productID} onClick={show}/>:<span role="button" tabIndex={0} className="icon-button" aria-label="View grade snapshot" title="View grade snapshot" onClick={show} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();void show()}}}><Icon name="grade"/></span>}<ErrorNote value={error}/>
 {open&&(mix?<MixStructureDialog mix={mix} onClose={()=>setOpen(false)}/>:onChange?<ProductGrades snapshotMode initial={{Status:'Draft',items:draft?.items||[]}} onApply={d=>onChange({items:d.items})} onClose={()=>setOpen(false)}/>:<Modal label="Grade snapshot" className="dialog grade-dialog" onClose={()=>setOpen(false)}><header className="customer-editor-heading"><h2>Grade snapshot</h2><IconButton icon="close" label="Close grade snapshot" onClick={()=>setOpen(false)}/></header><p>Captured for this request. Product Master changes do not update this copy.</p>{draft?.items.length?<GradeTree items={draft.items} readonly busy={false} disabled rawGrades={[]} rawMaterials={materials} onAdd={()=>{}} onRemove={()=>{}} onChange={()=>{}}/>:<p>No grade snapshot was captured.</p>}</Modal>)}
 </div>;
}
