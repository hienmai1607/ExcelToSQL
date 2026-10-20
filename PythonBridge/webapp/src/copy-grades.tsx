import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import type {GradeItem} from './product-grades';

export function CopyGrades({excludeProduct,hasItems,onCopy,onClose}:{excludeProduct?:number;hasItems:boolean;onCopy:(items:GradeItem[],source:string)=>void;onClose:()=>void}){
 const [sources,setSources]=useState<Row[]>([]),[source,setSource]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;
  call<{rows:Row[]}>('/api/workbench/products/grade-copy/sources').then(r=>{if(active)setSources(r.rows.filter(p=>Number(p.ID)!==excludeProduct))}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[excludeProduct]);
 async function copy(){
  if(!source||busy)return;
  setBusy(true);setError('');
  try{
   const result=await call<{product:Row;items:GradeItem[]}>('/api/workbench/products/grade-copy/'+source);
   if(!result.items.length)throw new Error('The source Product has no active grades. Choose another Product.');
   if(hasItems&&!window.confirm('Replace the current grades with the selected active grade structure?'))return;
   onCopy(result.items,String(result.product.ProductCode)+' - Version '+String(result.product.Version));onClose();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <Modal label="Copy grades from Product" className="dialog packaging-copy-dialog" onClose={()=>{if(!busy)onClose()}}>
  <header className="copy-dialog-heading"><h2>Copy grades</h2><IconButton icon="close" label="Close copy grades" disabled={busy} onClick={onClose}/></header>
  <ErrorNote value={error}/>
  <label>Source Product<select aria-label="Copy grades from Product" disabled={loading||busy} value={source} onChange={e=>setSource(e.target.value)}><option value="">{loading?'Loading Products...':'Choose a Product with active grades'}</option>{sources.map(p=><option key={String(p.ID)} value={String(p.ID)}>{String(p.ProductCode)+' - '+String(p.ProductName)+' - Version '+String(p.Version)}</option>)}</select></label>
  {!loading&&!sources.length&&!error&&<p>No other Products with active grade versions are available.</p>}
  <p>Copies grades, ratios and Raw Material selections into this draft. The source Product is unchanged.</p>
  <div className="actions"><button type="button" className="primary" disabled={busy||loading||!source} onClick={()=>void copy()}>{busy?'Copying...':'Copy grades'}</button></div>
 </Modal>;
}
