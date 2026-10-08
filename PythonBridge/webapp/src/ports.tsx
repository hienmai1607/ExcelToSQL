import {useEffect,useState} from 'react';
import {call,text,type Row} from './api';
import {ErrorNote} from './ui';
import {SharedMasterView} from './shared-master-view';
import {SharedMasterEditor} from './shared-master-editor';

type PortLookups={customers:Row[];markets:Row[]};
function PortEditor({row,lookups,canWrite,onClose,onSaved}:{row:Row|null;lookups:PortLookups;canWrite:boolean;onClose:()=>void;onSaved:()=>void}){
 return <SharedMasterEditor row={row} canWrite={canWrite} title="Port of Entry" endpoint="/api/ports" onClose={onClose} onSaved={onSaved}
 initial={()=>Object.fromEntries(['CustomerID','MarketID','PortName','Status'].map(key=>[key,String(row?.[key]??(key==='Status'?'Active':''))]))}
 validate={v=>!v.CustomerID||!v.MarketID||!v.PortName.trim()?'Customer, Market and Port name are required.':''}
 payload={v=>({CustomerID:Number(v.CustomerID),MarketID:Number(v.MarketID),PortName:v.PortName.trim(),Status:v.Status})}
 fields={(v,change)=><>
 <label>Customer *<select aria-label="Customer" value={v.CustomerID} onChange={e=>{change('CustomerID',e.target.value);change('MarketID',String(lookups.customers.find(c=>String(c.ID)===e.target.value)?.MarketID??''))}}><option value="">Choose customer</option>{lookups.customers.filter(c=>c.Status==='Active'||String(c.ID)===v.CustomerID).map(c=><option key={String(c.ID)} value={String(c.ID)}>{text(c.CustomerName)}</option>)}</select></label>
 <label>Market *<select aria-label="Market" value={v.MarketID} onChange={e=>change('MarketID',e.target.value)}><option value="">Choose market</option>{lookups.markets.map(m=><option key={String(m.ID)} value={String(m.ID)}>{text(m.MarketCode)} — {text(m.MarketName)}</option>)}</select></label>
 <label>Port name *<input aria-label="Port name" maxLength={200} value={v.PortName} onChange={e=>change('PortName',e.target.value)}/></label>
 <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label></>}/>
}
export function Ports({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[lookups,setLookups]=useState<PortLookups>({customers:[],markets:[]}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null);
 useEffect(()=>{let active=true;setError('');call<PortLookups>('/api/ports/lookups').then(result=>{if(active)setLookups(result)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[revision]);
 return <section className="customers-page"><ErrorNote value={error}/><SharedMasterView entity="ports" title="Ports of Entry" newLabel="New port" recordLabel="View Port" canWrite={canWrite&&!error} initialSort="PortName" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{PortName:'Port name',CustomerName:'Customer',MarketName:'Market',Status:'Status'}} onEdit={row=>setEditing({row})}/>
 {editing&&<PortEditor row={editing.row} lookups={lookups} canWrite={canWrite&&!error} onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Port saved.');setRevision(n=>n+1)}}/>}</section>;
}
