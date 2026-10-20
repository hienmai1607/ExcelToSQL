import {useEffect,useRef,useState} from 'react';
import {call,ApiError} from './api';
import {IconButton} from './icons';
import {Modal,ErrorNote} from './ui';

type Check={ID:number;RowVersion:string;resolve:(available:boolean)=>void};
const queued=new Map<string,Check[]>(),pendingChecks=new Map<string,Promise<boolean>>();let scheduled=false;
function checkAvailability(entity:string,ID:number,RowVersion:string):Promise<boolean>{
 const checkKey=entity+':'+ID+':'+RowVersion,existing=pendingChecks.get(checkKey);if(existing)return existing;
 const result=new Promise<boolean>(done=>{
  const resolve=(available:boolean)=>{pendingChecks.delete(checkKey);done(available)};
  queued.set(entity,[...(queued.get(entity)||[]),{ID,RowVersion,resolve}]);
  if(!scheduled){scheduled=true;window.setTimeout(()=>{
   scheduled=false;const groups=[...queued];queued.clear();
   void (async()=>{for(const [entity,checks] of groups)for(let start=0;start<checks.length;start+=50){
    const batch=checks.slice(start,start+50);
    try{
     const reply=await call<{rows:{ID:number;RowVersion:string;available:boolean}[]}>('/api/business-records/'+entity+'/eligibility',{rows:batch.map(({ID,RowVersion})=>({ID,RowVersion}))});
     for(const check of batch)check.resolve(reply?.rows?.some(r=>r.ID===check.ID&&r.RowVersion===check.RowVersion&&r.available===true)===true);
    }catch{for(const check of batch)check.resolve(false)}
   }})();
  },0)}
 });
 pendingChecks.set(checkKey,result);return result;
}
const supported=new Set(['customers','products','materials','prices','raw-materials','raw-prices','raw-grades','vendors','packaging-types','packaging-dimensions','pallets','conversions','opportunities','opportunity-items','requests','request-items']);
export function BusinessDelete({entity,id,version,label,allowed,onDeleted,disabled=false}:{entity:string;id:unknown;version:unknown;label:string;allowed:boolean;onDeleted:()=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),lock=useRef(false);
 const key=entity+':'+String(id)+':'+String(version);
 const [availability,setAvailability]=useState<{key:string;available:boolean}|null>(null);
 useEffect(()=>{
  let active=true;setAvailability(null);
  if(allowed&&supported.has(entity)&&id&&typeof version==='string'&&version)
   void checkAvailability(entity,Number(id),version).then(available=>{if(active)setAvailability({key,available})});
  return()=>{active=false};
 },[allowed,entity,id,version,key]);
 if(!allowed||!supported.has(entity)||!id||typeof version!=='string'||!version)return null;
 const available=availability?.key===key&&availability.available;
 if(!available&&!open)return null;
 async function remove(){
  if(lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');
  try{
   const reply=await call<{deleted:boolean;ID:number}>('/api/business-records/'+entity+'/delete',{ID:Number(id),RowVersion:version});
   if(reply?.deleted!==true||reply.ID!==Number(id))throw new Error('Unexpected deletion response.');
   setOpen(false);onDeleted();
  }catch(e){
   const unknown=!(e instanceof ApiError)||e.status===0||e.status>=500;setUncertain(unknown);
   if(!unknown)setAvailability({key,available:false});
   setError(unknown?'Deletion outcome is unknown. Close and refresh before doing anything else.':(e as Error).message);
  }finally{lock.current=false;setBusy(false)}
 }
 return <>{available&&!uncertain&&<IconButton icon="trash" label={'Delete '+label} disabled={disabled||busy||uncertain} onClick={()=>{setError('');setOpen(true)}}/>}{open&&<Modal label="Confirm permanent deletion" onClose={()=>{if(!busy)setOpen(false)}}>
  <h2>Delete {label}?</h2><p>This permanently removes this record and cannot be undone. Only unprocessed records with no business references can be deleted. No connected records or history will be removed.</p>
  <ErrorNote value={error}/><div className="actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button type="button" disabled={busy||uncertain} onClick={remove}>{busy?'Deleting…':'Delete permanently'}</button></div>
 </Modal>}</>;
}
