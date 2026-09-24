import {useEffect,useState,useRef} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {responseFields,fieldValues,fieldPayload} from './packaging-fields';

export function PackagingResponse({row,onClose,onSaved}:{row:Row;onClose:()=>void;onSaved:()=>void}){
 const [values,setValues]=useState(()=>fieldValues(row,responseFields));
 const [cost,setCost]=useState(row.Cost==null?'':String(row.Cost)),[basis,setBasis]=useState(String(row.CostBasis||''));
 const [vnd,setVnd]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const guard=useRef(false);
 const dirty=JSON.stringify(values)!==JSON.stringify(fieldValues(row,responseFields))||cost!==(row.Cost==null?'':String(row.Cost))||basis!==String(row.CostBasis||'');
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved response?')))onClose()}
 useEffect(()=>{let active=true;call<{currencies:Row[]}>('/api/packaging/lookups').then(x=>{if(active)setVnd(Number(x.currencies.find(c=>c.CurrencyCode==='VND')?.ID)||null)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty,busy]);
 function review(){
  for(const f of responseFields){const v=values[f.key];if(v&&f.numeric&&(!/^\d+(\.\d{1,4})?$/.test(v)||(f.integer&&(!/^\d+$/.test(v)||Number(v)<=0)))){setError('Check '+f.label+'.');return}}
  if(cost&&(!/^\d{1,14}(\.\d{1,4})?$/.test(cost)||!basis.trim()||!vnd)){setError('For PM cost, enter a nonnegative amount, a cost basis, and maintain VND in Currency master.');return}
  if(cost&&row.PMCostCurrencyCode&&row.PMCostCurrencyCode!=='VND'&&cost===String(row.Cost)){setError('The existing cost is not VND. Enter a reviewed VND amount; no automatic conversion is applied.');return}
  setError('');setConfirm(true);
 }
 async function save(){
  if(guard.current)return;guard.current=true;setBusy(true);setError('');
  try{
   const existing=Object.fromEntries(['MaterialID','HeightMM','WidthMM','LengthMM','ResponseNotes'].map(k=>[k,row[k]??null]));
   const reply=await call<{results:Row[]}>('/api/packaging/response/batch',{rows:[{...existing,...fieldPayload(values,responseFields),RowNum:1,ID:row.ItemID,RowVersion:row.ItemRowVersion,Cost:cost||null,CurrencyID:cost?vnd:null,CostBasis:cost?basis.trim():null}]});
   if(reply.results?.length!==1||reply.results[0].Status!=='OK')throw new Error(String(reply.results?.[0]?.Message||'Save outcome unknown. Close and refresh before retrying.'));
   onSaved();onClose();
  }catch(e){setError((e as Error).message);if(!(e as {status?:number}).status||(e as {status:number}).status>=500)setUncertain(true)}
  finally{setBusy(false);guard.current=false;setConfirm(false)}
 }
 return <Modal label="Packaging response" className="dialog opportunity-editor" onClose={close}>
  <div className="customer-editor-heading"><h2>Packaging response — {row.ProductCode}</h2><IconButton icon="close" label="Close response" disabled={busy} onClick={close}/></div>
  <ErrorNote value={error}/>
  <form onSubmit={e=>{e.preventDefault();review()}}>
   <fieldset disabled={busy||uncertain}><div className="master-fields">{responseFields.map(f=><label key={f.key}>{f.label}<input maxLength={f.max||24} inputMode={f.numeric?'decimal':undefined} value={values[f.key]||''} onChange={e=>setValues({...values,[f.key]:e.target.value})}/></label>)}
   <label>PM cost (VND)<input inputMode="decimal" value={cost} onChange={e=>setCost(e.target.value)}/></label>
   <label>Cost basis<input maxLength={40} placeholder="Specify basis if entering a cost" value={basis} onChange={e=>setBasis(e.target.value)}/></label></div></fieldset>
   <p className="muted">You can save an incomplete response. Both PM types, Unit / CTN, packaging description and both MOQs are required before submission.</p>
   <div className="actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy||uncertain||!dirty}>Review & save</button></div>
  </form>
  {confirm&&<Modal label="Confirm response save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save this response?</h2><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 </Modal>
}
