import {useEffect,useState} from 'react';
import {call,text,type Row} from './api';
import {ErrorNote,Modal} from './ui';
import {IconButton} from './icons';
import {SharedMasterView} from './shared-master-view';
import {SharedMasterEditor} from './shared-master-editor';

type PortLookups={customers:Row[];markets:Row[]};
export function PortEditor({row,lookups,canWrite,onClose,onSaved,customerID='',saveEndpoint}:{row:Row|null;lookups:PortLookups;canWrite:boolean;onClose:()=>void;onSaved:(records:Row[])=>void;customerID?:string;saveEndpoint?:string}){
 return <SharedMasterEditor row={row} canWrite={canWrite} saveEndpoint={saveEndpoint} title="Port of Entry" endpoint="/api/ports" onClose={onClose} onSaved={onSaved}
 initial={()=>Object.fromEntries(['CustomerID','MarketID','PortName','Status'].map(key=>[key,String(row?.[key]??(key==='Status'?'Active':key==='CustomerID'?customerID:key==='MarketID'?String(lookups.customers.find(c=>String(c.ID)===customerID)?.MarketID??''):''))]))}
 validate={v=>!v.CustomerID||!v.MarketID||!v.PortName.trim()?'Customer, Market and Port name are required.':''}
 payload={v=>({CustomerID:Number(v.CustomerID),MarketID:Number(v.MarketID),PortName:v.PortName.trim(),Status:v.Status})}
 fields={(v,change)=><>
 <label>Customer *<select aria-label="Customer" disabled={!!saveEndpoint} value={v.CustomerID} onChange={e=>{change('CustomerID',e.target.value);change('MarketID',String(lookups.customers.find(c=>String(c.ID)===e.target.value)?.MarketID??''))}}><option value="">Choose customer</option>{lookups.customers.filter(c=>c.Status==='Active'||String(c.ID)===v.CustomerID).map(c=><option key={String(c.ID)} value={String(c.ID)}>{text(c.CustomerName)}</option>)}</select></label>
 <label>Market *<select aria-label="Market" disabled={!!saveEndpoint} value={v.MarketID} onChange={e=>change('MarketID',e.target.value)}><option value="">Choose market</option>{lookups.markets.map(m=><option key={String(m.ID)} value={String(m.ID)}>{text(m.MarketCode)} — {text(m.MarketName)}</option>)}</select></label>
 <label>Port name *<input aria-label="Port name" maxLength={200} value={v.PortName} onChange={e=>change('PortName',e.target.value)}/></label>
 <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label></>}/>
}
export function Ports({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[lookups,setLookups]=useState<PortLookups>({customers:[],markets:[]}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null);
 useEffect(()=>{let active=true;setError('');call<PortLookups>('/api/ports/lookups').then(result=>{if(active)setLookups(result)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[revision]);
 return <section className="customers-page"><ErrorNote value={error}/><SharedMasterView entity="ports" title="Ports of Entry" newLabel="New port" recordLabel="View Port" canWrite={canWrite&&!error} initialSort="PortName" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{PortName:'Port name',CustomerName:'Customer',MarketName:'Market',Status:'Status'}} onEdit={row=>setEditing({row})}/>
 {editing&&<PortEditor row={editing.row} lookups={lookups} canWrite={canWrite&&!error} onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Port saved.');setRevision(n=>n+1)}}/>}</section>;
}
export function InlinePortCreate({customerID,onClose,onSaved}:{customerID:string;onClose:()=>void;onSaved:(records:Row[])=>void}){
 const [lookups,setLookups]=useState<PortLookups|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError('');call<PortLookups>('/api/ports/lookups').then(r=>{if(active)setLookups(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[retry]);
 if(lookups)return <PortEditor row={null} lookups={lookups} canWrite customerID={customerID} onClose={onClose} onSaved={onSaved}/>;
 return <Modal label="New Port of Entry" onClose={onClose}><header className="customer-editor-heading"><h2>New Port of Entry</h2><IconButton icon="close" label="Close Port of Entry" onClick={onClose}/></header><ErrorNote value={error}/>{error?<button onClick={()=>setRetry(n=>n+1)}>Retry loading ports</button>:<p>Loading port choices…</p>}</Modal>;
}
