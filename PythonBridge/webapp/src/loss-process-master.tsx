import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {SharedMasterEditor} from './shared-master-editor';
import {SharedMasterView} from './shared-master-view';

import {processOptions} from './loss-processes';
export const masterTypes=[...processOptions(false,3),...processOptions(true,3)];
export const processLabel=(value:unknown)=>masterTypes.find(([type])=>type===value)?.[1]??String(value);
function Editor({row,canWrite,onClose,onSaved}:{row:Row|null;canWrite:boolean;onClose:()=>void;onSaved:()=>void}){
 const [components,setComponents]=useState<Row[]>([]);useEffect(()=>{void call<{rows:Row[]}>('/api/recipe-components?page_size=500').then(r=>setComponents(r.rows))},[]);
 return <SharedMasterEditor row={row} canWrite={canWrite} title="Process Type" endpoint="/api/loss-processes" onClose={onClose} onSaved={onSaved}
 initial={()=>({ProcessType:String(row?.ProcessType??''),Shared:String(!!row?.Shared),Status:String(row?.Status??'Active'),ComponentIDs:JSON.stringify(JSON.parse(String(row?.ComponentIDs??'[]')).map((c:{ComponentID:number})=>c.ComponentID))})}
 validate={v=>!v.ProcessType.trim()?'Process Type is required.':''}
 payload={v=>({...v,Shared:v.Shared==='true',ProcessType:v.ProcessType.trim(),ComponentIDs:JSON.parse(v.ComponentIDs)})}
 fields={(v,change)=><>
 <label>Process Type *<input aria-label="Process Type" maxLength={100} value={v.ProcessType} onChange={e=>change('ProcessType',e.target.value)}/></label>
 <label><span>Shared</span><input type="checkbox" aria-label="Shared" checked={v.Shared==='true'} onChange={e=>change('Shared',String(e.target.checked))}/><small>Use one percentage wherever this type is shared. Final Packing is maintained once for all grades.</small></label>
 <fieldset className="admin-role-options"><legend>Recipe Components</legend>{components.map(component=><label key={String(component.ID)}><input type="checkbox" aria-label={'Component '+component.ComponentName} checked={(JSON.parse(v.ComponentIDs) as number[]).includes(Number(component.ID))} disabled={component.Status!=='Active'&&!(JSON.parse(v.ComponentIDs) as number[]).includes(Number(component.ID))} onChange={e=>{const ids=JSON.parse(v.ComponentIDs) as number[];change('ComponentIDs',JSON.stringify(e.target.checked?[...ids,Number(component.ID)]:ids.filter(id=>id!==Number(component.ID))))}}/>{component.ComponentName}</label>)}</fieldset>
 <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label></>}/>
}
export function LossProcessMaster({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null);
 return <section className="customers-page"><SharedMasterView entity="loss-processes" title="Process Types" newLabel="New process type" recordLabel="View Process Type" canWrite={canWrite} initialSort="ProcessType" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{ProcessType:'Process Type',ComponentNames:'Recipe Components',Shared:'Shared',Status:'Status'}} display={(row,column)=>column==='Shared'?(row.Shared?'Yes':'No'):column==='ComponentNames'?String(row[column]||'None'):String(row[column]??'')} onEdit={row=>setEditing({row})}/>
 {editing&&<Editor row={editing.row} canWrite={canWrite} onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Process Type saved.');setRevision(n=>n+1)}}/>}</section>
}
