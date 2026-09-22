import {useEffect,useRef,useState} from 'react';
import {text,type Row} from './api';
import './attachments.css';

export const allowed='.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.txt,.csv,.eml,.msg';
export interface PickedFile {id:string;file:File}
interface Job {id:string;user:string;creationKey:string;sourceID:number;itemID?:number;file:File;error?:string}
const notify=()=>window.dispatchEvent(new Event('attachment-queue'));
async function db(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('bridge-attachments',1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function jobs():Promise<Job[]>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('jobs');const r=t.objectStore('jobs').getAll();t.oncomplete=()=>{d.close();resolve(r.result)};t.onerror=()=>{d.close();reject(t.error)}})}
async function save(rows:Job[],remove:string[]=[]){const d=await db();return new Promise<void>((resolve,reject)=>{const t=d.transaction('jobs','readwrite');for(const r of rows)t.objectStore('jobs').put(r);for(const id of remove)t.objectStore('jobs').delete(id);t.oncomplete=()=>{d.close();notify();resolve()};t.onerror=()=>{d.close();reject(t.error)};t.onabort=()=>{d.close();reject(t.error)}})}
export async function stageFiles(user:string,key:string,selected:Set<number>,files:Record<number,PickedFile[]>){
 const rows:Job[]=[];for(const id of selected)for(const f of files[id]||[])rows.push({id:f.id,user,creationKey:key,sourceID:id,file:f.file});
 if(rows.length)await save(rows);
}
export async function bindFiles(user:string,key:string,items:Row[]){
 const rows=(await jobs()).filter(j=>j.user===user&&j.creationKey===key);
 for(const row of rows){const item=items.find(i=>Number(i.OpportunityItemID)===row.sourceID);if(!item)throw new Error('Cannot link an attachment to its created request item. Retry the saved request.');row.itemID=Number(item.ID)}
 if(rows.length)await save(rows);
}
export async function discardStaged(user:string,key:string){await save([], (await jobs()).filter(j=>j.user===user&&j.creationKey===key&&!j.itemID).map(j=>j.id))}
function headers(){const h:Record<string,string>={};const user=sessionStorage.getItem('bridge.testUser');if(user)h['X-User-Name']=user;return h}
async function failure(response:Response){const data=await response.json().catch(()=>null);throw new Error(typeof data?.detail==='string'?data.detail:'Attachment request failed ('+response.status+').')}
export function FilePicker({files,onChange,disabled,label}:{files:PickedFile[];onChange:(f:PickedFile[])=>void;disabled:boolean;label:string}){
 const [error,setError]=useState('');
 return <div className="attachment-picker"><input type="file" multiple accept={allowed} disabled={disabled} aria-label={label} onChange={e=>{
  const selected=Array.from(e.target.files||[]);e.target.value='';
  if(selected.some(f=>f.size===0||f.size>10*1024*1024)){setError('Each file must be nonempty and at most 10 MB.');return}
  if(files.length+selected.length>20){setError('Maximum 20 files per item.');return}
  if(selected.some(f=>!allowed.split(',').some(ext=>f.name.toLowerCase().endsWith(ext)))){setError('This file type is not supported.');return}
  setError('');onChange([...files,...selected.map(file=>({id:crypto.randomUUID(),file}))]);
 }}/>{files.map(f=><div key={f.id} className="file-name"><span>{f.file.name} ({Math.ceil(f.file.size/1024)} KB)</span><button type="button" disabled={disabled} aria-label={'Remove '+f.file.name} onClick={()=>onChange(files.filter(x=>x.id!==f.id))}>×</button></div>)}{error&&<small role="alert">{error}</small>}</div>
}
export function AttachmentQueue({user}:{user:string}){
 const [rows,setRows]=useState<Job[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const working=useRef(false);
 async function refresh(){try{setRows((await jobs()).filter(j=>j.user===user))}catch{setError('Browser file storage is unavailable. Keep this page open and allow IndexedDB storage.')}}
 useEffect(()=>{void refresh();const listener=()=>void refresh();window.addEventListener('attachment-queue',listener);return()=>window.removeEventListener('attachment-queue',listener)},[user]);
 async function upload(){if(working.current)return;working.current=true;setBusy(true);setError('');
  try{for(const job of (await jobs()).filter(j=>j.user===user&&j.itemID)){
   try{
    const response=await fetch('/api/packaging/items/'+job.itemID+'/attachments/'+job.id+'?filename='+encodeURIComponent(job.file.name),{method:'PUT',headers:{...headers(),'Content-Type':'application/octet-stream'},body:job.file,credentials:'same-origin'});
    if(!response.ok)await failure(response);await save([],[job.id]);
   }catch(e){await save([{...job,error:(e as Error).message}])}
  }}catch(e){setError((e as Error).message)}finally{working.current=false;setBusy(false);await refresh();window.dispatchEvent(new Event('attachments-updated'))}
 }
 // Initial linked jobs are attempted automatically; failed jobs require explicit retry.
 useEffect(()=>{if(rows.some(r=>r.itemID&&!r.error)&&!working.current)void upload()},[rows]);
 if(!rows.length&&!error)return null;
 return <section className="notice pending" aria-label="Attachment upload queue"><strong>{busy?'Uploading attachments…':'Attachment upload queue'}</strong><p>Files are retained in this browser until uploaded. Request creation is not repeated.</p>{rows.map(j=><div className="file-name" key={j.id}><span>{j.file.name} · {j.itemID?'Request item '+j.itemID:'Waiting for request creation'}{j.error&&<small role="alert">{j.error}</small>}</span>{j.error&&<button disabled={busy} onClick={()=>{if(window.confirm('Remove this file from the local retry queue? A previously completed server upload is not deleted.'))void save([],[j.id])}}>Remove from queue</button>}</div>)}{error&&<p role="alert">{error}</p>}<button disabled={busy||!rows.some(r=>r.itemID)} onClick={()=>void upload()}>Retry attachments</button></section>
}
export function ItemAttachments({item,user,canUpload}:{item:Row;user:string;canUpload:boolean}){
 const [opened,setOpened]=useState(false);
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[picked,setPicked]=useState<PickedFile[]>([]),[saving,setSaving]=useState(false);
 const itemID=Number(item.ItemID);
 async function refresh(){try{const r=await fetch('/api/packaging/items/'+itemID+'/attachments',{headers:headers(),credentials:'same-origin'});if(!r.ok)await failure(r);setRows((await r.json()).rows);setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{if(!opened)return;void refresh();const listener=()=>void refresh();window.addEventListener('attachments-updated',listener);return()=>window.removeEventListener('attachments-updated',listener)},[itemID,opened]);
 async function download(row:Row){try{const response=await fetch('/api/packaging/items/'+itemID+'/attachments/'+row.ID+'/download',{headers:headers(),credentials:'same-origin'});if(!response.ok)await failure(response);const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=String(row.OriginalName);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setError((e as Error).message)}}
 async function add(){setSaving(true);try{await save(picked.map(p=>({id:p.id,user,creationKey:'existing',sourceID:0,itemID,file:p.file})));setPicked([])}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
 return <details className="item-attachments" onToggle={e=>setOpened(e.currentTarget.open)}><summary>Attachments{opened?' ('+rows.length+')':''}</summary>{rows.map(r=><div key={String(r.ID)}><button className="link" onClick={()=>void download(r)}>{text(r.OriginalName)}</button><small>{text(r.UploadedByName)} · {Math.ceil(Number(r.SizeBytes)/1024)} KB</small></div>)}{canUpload&&['Assigned','Working','Returned'].includes(String(item.ItemStage))&&<><FilePicker files={picked} onChange={setPicked} disabled={saving} label={'Attach to item '+itemID}/><button disabled={saving||!picked.length} onClick={()=>void add()}>Upload files</button></>}{error&&<small role="alert">{error}</small>}</details>
}
