import {scrollAddedRecord} from './expand-scroll';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ApiError,call,type Row} from './api';
import {Modal,ErrorNote,Badge} from './ui';
import {IconButton} from './icons';
type Values=Record<string,string>;
type Entry={key:number;values:Values;saved:boolean;error:string};
export function SharedMasterEditor({row,canWrite,title,endpoint,initial,fields,validate,payload,onClose,onSaved}:{row:Row|null;canWrite:boolean;title:string;endpoint:string;initial:()=>Values;fields:(values:Values,change:(key:string,value:string)=>void)=>ReactNode;validate:(values:Values)=>string;payload:(values:Values)=>Record<string,unknown>;onClose:()=>void;onSaved:()=>void}){
 const [entries,setEntries]=useState<Entry[]>(()=>[{key:1,values:initial(),saved:false,error:''}]),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const serial=useRef(1),lock=useRef(false),baseline=useRef(JSON.stringify(entries.map(e=>e.values)));
 const pending=entries.filter(e=>!e.saved),dirty=JSON.stringify(entries.map(e=>e.values))!==baseline.current;
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(canWrite&&dirty||busy){event.preventDefault();event.returnValue=''}};const nav=(event:Event)=>{if(busy||canWrite&&dirty&&!window.confirm('Discard unsaved changes?'))event.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[canWrite,dirty,busy]);
 function close(){if(!busy&&(!canWrite||!dirty||window.confirm('Discard unsaved changes?')))onClose()}
 function review(){const checked=entries.map(e=>({...e,error:e.saved?'':validate(e.values)}));setEntries(checked);if(!checked.some(e=>e.error)&&pending.length)setConfirm(true)}
 async function save(){if(lock.current||uncertain||!canWrite)return;lock.current=true;setBusy(true);setError('');
 try{
  let count=0;
  for(const entry of pending){try{
   await call(endpoint,{ID:row?.ID??null,RowVersion:row?.RowVersion??null,...payload(entry.values)});
   count++;setEntries(list=>list.map(e=>e.key===entry.key?{...e,saved:true,error:''}:e));
  }catch(exc){
   if(exc instanceof ApiError&&(exc.status===0||exc.status>=500)){setUncertain(true);setError('Save outcome unknown. Close and refresh before retrying.');break}
   setEntries(list=>list.map(e=>e.key===entry.key?{...e,error:(exc as Error).message}:e));
  }}
  if(count)onSaved();if(count===pending.length)onClose();
 }finally{lock.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label={(canWrite?(row?'Edit ':'New '):'View ')+title} className="customer-drawer batch-drawer" onClose={close}>
 <div className="customer-editor-heading"><h2>{canWrite?(row?'Edit':'New'):'View'} {title}</h2><IconButton icon="close" label={'Close '+title} disabled={busy} onClick={close}/></div><ErrorNote value={error}/>
 <form noValidate onSubmit={e=>{e.preventDefault();if(canWrite)review()}}><div className="customer-sections">{entries.map((entry,index)=><section className={'customer-entry'+(entry.saved?' entry-saved':'')} aria-label={'Record '+(index+1)} key={entry.key}>
 <header><h3>{row?'Details':'Record '+(index+1)}</h3>{entry.saved?<Badge value="Saved"/>:!row&&canWrite&&<IconButton icon="close" label={'Remove record '+(index+1)} disabled={busy||uncertain||pending.length<=1} onClick={()=>setEntries(list=>list.filter(e=>e.key!==entry.key))}/>}</header>
 <ErrorNote value={entry.error}/><fieldset disabled={!canWrite||busy||uncertain||entry.saved} className={!canWrite||entry.saved?'display-only-fields':undefined}><div className="master-fields">{fields(entry.values,(key,value)=>setEntries(list=>list.map(e=>e.key===entry.key?{...e,values:{...e.values,[key]:value},error:''}:e)))}</div></fieldset></section>)}</div>
 {!row&&canWrite&&<button type="button" className="add-section" disabled={busy||uncertain||entries.length>=100} onClick={event=>{scrollAddedRecord(event.currentTarget);setEntries(list=>[...list,{key:++serial.current,values:initial(),saved:false,error:''}])}}>+ Add record section</button>}
 {canWrite&&<div className="actions batch-actions"><button className="primary" disabled={busy||uncertain||!pending.length||!!row&&!dirty}>Review &amp; save</button></div>}</form>
 {confirm&&<Modal label="Confirm master save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{row?'Update':'Create'} {pending.length} {pending.length===1?'record':'records'}?</h2><ul className="batch-review">{pending.map(e=><li key={e.key}>{e.values.ProcessType||e.values.PortName||e.values.CategoryName||e.values.RoleName||e.values.UserName||e.values.Name}</li>)}</ul><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving...':'Confirm save'}</button></div></Modal>}
 </Modal>
}
