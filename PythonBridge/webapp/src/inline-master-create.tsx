import {useEffect,useState} from 'react';
import {api,call,type Row} from './api';
import {CustomerCreate} from './customer-create';
import {InlinePortCreate} from './ports';
import {CategoryEditor} from './category-master';
import {PackagingDimensions} from './packaging-dimensions';
import {MasterEditor} from './master-editor';
import type {Lookups} from './master-config';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {useSession} from './session';
import {canCreateMaster,masterNames,type InlineMasterEntity} from './add-master-button';

export function InlineMasterCreate({entity,customerID='',initialValues={},lockedFields=[],onClose,onSaved}:{entity:InlineMasterEntity;customerID?:string;initialValues?:Record<string,string>;lockedFields?:string[];onClose:()=>void;onSaved:(records:Row[])=>void}){
 const allowed=canCreateMaster(useSession(),entity);
 const [lookups,setLookups]=useState<Lookups|null>(null),[customers,setCustomers]=useState<{markets:Row[];currencies:Row[]}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError('');
  if(!allowed||entity==='categories'||entity==='packaging-dimensions'||entity==='ports')return;
  (entity==='customers'?api.customerLookups().then(r=>{if(active)setCustomers(r)}):call<Lookups>('/api/workbench/masters/lookups?entity='+entity).then(r=>{if(active)setLookups(r)})).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[entity,retry,allowed]);
 if(allowed&&entity==='ports')return <InlinePortCreate customerID={customerID} onClose={onClose} onSaved={onSaved}/>;
 if(allowed&&entity==='categories')return <CategoryEditor row={null} canWrite onClose={onClose} onSaved={onSaved}/>;
 if(allowed&&entity==='packaging-dimensions')return <PackagingDimensions canWrite inline initialTypeID={initialValues.PackagingTypeID} onClose={onClose} onCreated={onSaved}/>;
 if(allowed&&entity==='customers'&&customers)return <CustomerCreate lookups={customers} onClose={onClose} onSaved={(_,records)=>onSaved(records||[])}/>;
 if(allowed&&entity!=='customers'&&entity!=='categories'&&entity!=='packaging-dimensions'&&entity!=='ports'&&lookups)return <MasterEditor lockedFields={lockedFields} entity={entity} row={null} customerLocked={entity==='products'&&!!customerID} lookups={lookups} initialValues={{...((entity==='raw-prices'||entity==='prices')?{BaseUoM:String(lookups.materials.find(m=>String(m.ID)===initialValues.MaterialID)?.UnitOfMeasure??'')}:{}),...initialValues,...(entity==='products'&&customerID?{CustomerID:customerID}:{})}} onClose={onClose} onSaved={(_,records)=>onSaved(records||[])}/>;
 return <Modal label={'New '+masterNames[entity].toLowerCase()} className="customer-drawer" onClose={onClose}>
  <header className="customer-editor-heading"><h2>{masterNames[entity]} Master</h2><IconButton icon="close" label="Close new master" onClick={onClose}/></header>
  {!allowed?<ErrorNote value="You do not have permission to create this master."/>:<><ErrorNote value={error}/>{error?<button type="button" onClick={()=>setRetry(n=>n+1)}>Retry loading master</button>:<p>Loading master…</p>}</>}
 </Modal>;
}
