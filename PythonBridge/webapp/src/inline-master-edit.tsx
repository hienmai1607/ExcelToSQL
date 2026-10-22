import {useEffect,useState} from 'react';
import {api,call,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {MasterEditor} from './master-editor';
import {CustomerEditor} from './customers';
import {CategoryEditor} from './category-master';
import {PortEditor} from './ports';
import {PackagingDimensions} from './packaging-dimensions';
import {type Lookups,type MasterEntity} from './master-config';
import {masterNames,type InlineMasterEntity} from './add-master-button';

type Context={row:Row;editable:boolean;reason:string;lockedFields:string[]};
export function InlineMasterEdit({entity,selected,onClose,onSaved}:{entity:InlineMasterEntity;selected:string;onClose:()=>void;onSaved:(records:Row[])=>void}){
 const endpoint='/api/inline-masters/'+entity+'/'+encodeURIComponent(selected);
 const [context,setContext]=useState<Context|null>(null),[lookups,setLookups]=useState<Lookups|null>(null),[special,setSpecial]=useState<Record<string,Row[]>|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError('');setContext(null);
  void (async()=>{
   const result=await call<Context>(endpoint);if(!active)return;setContext(result);if(!result.editable)return;
   if(entity==='customers'){const data=await api.customerLookups();if(active)setSpecial(data)}
   else if(entity==='ports'){const data=await call<Record<string,Row[]>>('/api/ports/lookups');if(active)setSpecial(data)}
   else if(entity!=='categories'&&entity!=='packaging-dimensions'){const data=await call<Lookups>('/api/workbench/masters/lookups?entity='+entity);if(active)setLookups(data)}
  })().catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[endpoint,entity,retry]);
 if(context?.editable&&!error){
  if(entity==='categories')return <CategoryEditor row={context.row} canWrite saveEndpoint={endpoint} onClose={onClose} onSaved={onSaved}/>;
  if(entity==='ports'&&special)return <PortEditor row={context.row} canWrite lookups={{customers:special.customers,markets:special.markets}} saveEndpoint={endpoint} onClose={onClose} onSaved={onSaved}/>;
  if(entity==='packaging-dimensions')return <PackagingDimensions canWrite inline initialRecord={context.row} saveEndpoint={endpoint} onClose={onClose} onCreated={onSaved}/>;
  if(entity==='customers'&&special)return <CustomerEditor row={context.row} canWrite lookups={{markets:special.markets,currencies:special.currencies}} lookupError="" saveEndpoint={endpoint} onClose={onClose} onSaved={(_,__,record)=>onSaved([record??context.row])}/>;
  if(lookups)return <MasterEditor entity={entity as MasterEntity} row={context.row} lookups={lookups} lockedFields={context.lockedFields} saveEndpoint={endpoint} onClose={onClose} onSaved={(_,records)=>onSaved(records??[])}/>;
 }
 return <Modal label={'Edit '+masterNames[entity]} className="customer-drawer" onClose={onClose}><header className="customer-editor-heading"><h2>Edit {masterNames[entity]}</h2><IconButton icon="close" label="Close master edit" onClick={onClose}/></header><ErrorNote value={error||context?.reason||''}/>{error?<button onClick={()=>setRetry(n=>n+1)}>Retry loading master</button>:context&&!context.editable?<p>This master is not available for editing. No data was changed.</p>:<p>Loading master…</p>}</Modal>;
}
