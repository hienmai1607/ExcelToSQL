import {useState} from 'react';
import {type Row} from './api';
import {SharedMasterEditor} from './shared-master-editor';
import {SharedMasterView} from './shared-master-view';

import {processOptions} from './loss-processes';
export const masterTypes=[...processOptions(false,3),...processOptions(true,3)];
export const processLabel=(value:unknown)=>masterTypes.find(([type])=>type===value)?.[1]??String(value);
function Editor({row,canWrite,onClose,onSaved}:{row:Row|null;canWrite:boolean;onClose:()=>void;onSaved:()=>void}){
 return <SharedMasterEditor row={row} canWrite={canWrite} title="Loss Process" endpoint="/api/loss-processes" onClose={onClose} onSaved={onSaved}
 initial={()=>({ProcessType:String(row?.ProcessType??''),Status:String(row?.Status??'Active')})}
 validate={v=>!v.ProcessType.trim()?'Process Type is required.':''}
 payload={v=>({...v,ProcessType:v.ProcessType.trim()})}
 fields={(v,change)=><>
 <label>Process Type *<input aria-label="Process Type" maxLength={100} value={v.ProcessType} onChange={e=>change('ProcessType',e.target.value)}/></label>
 <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label></>}/>
}
export function LossProcessMaster({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null);
 return <section className="customers-page"><SharedMasterView entity="loss-processes" title="Loss Master" newLabel="New loss process" recordLabel="View Loss Process" canWrite={canWrite} initialSort="ProcessType" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{ProcessType:'Process Type',Status:'Status'}} display={(row,column)=>column==='LossPct'?Number(row[column]).toFixed(2)+'%':String(row[column]??'')} onEdit={row=>setEditing({row})}/>
 {editing&&<Editor row={editing.row} canWrite={canWrite} onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Loss Process saved.');setRevision(n=>n+1)}}/>}</section>
}
