import {timestamp} from './datetime';
import {useEffect,useState} from 'react';
import {call,type Page} from './api';
import {ErrorNote,Modal,Pager} from './ui';
import {IconButton} from './icons';
import './opportunity-changes.css';

const fields:Record<string,string>={OpportunityNumber:'Opportunity number',CustomerID:'Customer',OpportunityDesc:'Description',BidOpen:'Bid open',BidClose:'Bid close',Stage:'Stage',OpportunityID:'Opportunity ID',ProductID:'Product',ItemDescription:'Item description',AnnualUnit:'Annual units',EstPctAwarded:'Estimated award %',ShelfPrice:'Shelf price'};
const value=(v:unknown)=>v===null?'(blank)':v===''?'(empty text)':String(v??'');
export function OpportunityChanges(props:{id:number;number:string;onClose:()=>void}){
 return <EntityChanges {...props} endpoint="/api/opportunity" entity="Opportunity" fields={fields}/>;
}
export function EntityChanges({id,number,onClose,endpoint,entity,fields}:{id:number;number:string;onClose:()=>void;endpoint:string;entity:string;fields:Record<string,string>}){
 const [data,setData]=useState<Page>({rows:[],total:0,page:1}),[page,setPage]=useState(1),[size,setSize]=useState(50);
 const [level,setLevel]=useState(''),[source,setSource]=useState(''),[field,setField]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;setBusy(true);setError('');const q=new URLSearchParams({page:String(page),page_size:String(size)});if(level)q.set('level',level);if(source)q.set('source',source);if(field)q.set('field',field);
 call<Page>(endpoint+'/'+id+'/changes?'+q).then(result=>{if(active)setData(result)}).catch(e=>{if(active){setError(e.message);setData({rows:[],total:0,page})}}).finally(()=>{if(active)setBusy(false)});
 return()=>{active=false}},[id,page,size,level,source,field,revision,endpoint]);
 return <Modal label={'Changes: '+number} onClose={onClose} className="dialog change-log">
 <div className="change-log-heading"><h2>Changes · {number}</h2><IconButton icon="close" label="Close change log" onClick={onClose}/></div>
 <div className="view-toolbar"><IconButton icon="refresh" label="Refresh change log" disabled={busy} onClick={()=>setRevision(n=>n+1)}/></div>
 <div className="filters">
 <label>Level<select aria-label="Level" value={level} onChange={e=>{setLevel(e.target.value);setPage(1)}}><option value="">All</option><option>Header</option><option>Item</option></select></label>
 <label>Source<select aria-label="Source" value={source} onChange={e=>{setSource(e.target.value);setPage(1)}}><option value="">All</option><option>User</option><option>System</option><option>Database</option></select></label>
 <label>Field<select aria-label="Field" value={field} onChange={e=>{setField(e.target.value);setPage(1)}}><option value="">All</option>{Object.entries(fields).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 </div><ErrorNote value={error}/>
 <div className="panel table-wrap"><table aria-label={entity+' change log'}><thead><tr>{['Time (UTC+7)','Changed by','Source','Level','Item','Action','Field','Old value','New value','Reason'].map(x=><th key={x}>{x}</th>)}</tr></thead>
 <tbody>{busy?<tr><td colSpan={10}>Loading changes...</td></tr>:data.rows.map(r=><tr key={String(r.ID)}><td>{timestamp(r.ChangedAt)}</td><td>{r.ChangedBy}</td><td>{r.Source}</td><td>{r.EntityLevel}</td><td>{r.ItemID==null?'—':String(r.ItemLabel||'Item')+' (#'+r.ItemID+')'}</td><td>{r.Action}</td><td>{fields[String(r.FieldName)]||r.FieldName}</td><td className="change-value">{value(r.OldValue)}</td><td className="change-value">{value(r.NewValue)}</td><td className="change-value">{r.Reason}</td></tr>)}
 {!busy&&!error&&!data.rows.length&&<tr><td colSpan={10}>No changes recorded for this selection. Logging begins when enabled.</td></tr>}</tbody></table></div>
 <Pager page={page} size={size} total={data.total} busy={busy} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="changes"/>
 </Modal>;
}
