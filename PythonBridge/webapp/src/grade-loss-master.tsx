import {useState} from 'react';
import {call,type Row} from './api';
import {SharedMasterEditor} from './shared-master-editor';
import {SharedMasterView} from './shared-master-view';
import {Notification} from './ui';

type Choices={grades:Row[];types:Row[]};
export function GradeLossMaster({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [editing,setEditing]=useState<{row:Row|null;choices:Choices}|null>(null);
 async function edit(row:Row|null){
  if(loading)return;setLoading(true);setError('');
  try{const choices=await call<Choices>('/api/loss-defaults/lookups');setEditing({row,choices})}
  catch(e){setError((e as Error).message)}finally{setLoading(false)}
 }
 const row=editing?.row;
 return <section className="customers-page">
  <SharedMasterView entity="loss-defaults" title="Loss Process Master" newLabel="New loss default" recordLabel="View Loss Default" canWrite={canWrite&&!loading} initialSort="GradeName" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{GradeName:'Grade',ProcessType:'Process Type',LossPct:'Loss (%)',Status:'Status'}} display={(row,key)=>key==='LossPct'?String(row[key])+'%':String(row[key]??'')} onEdit={row=>void edit(row)}/>
  <Notification value={error} severity="error" onDismiss={()=>setError('')}/>
  {editing&&<SharedMasterEditor row={row??null} canWrite={canWrite} title="Loss Default" endpoint="/api/loss-defaults" onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Loss default saved.');setRevision(n=>n+1)}}
   initial={()=>({RawGradeID:String(row?.RawGradeID??''),ProcessTypeID:String(row?.ProcessTypeID??''),LossPct:String(row?.LossPct??'0'),Status:String(row?.Status??'Active')})}
   validate={v=>!v.ProcessTypeID?'Choose a Process Type.':!/^\d+(?:\.\d{1,2})?$/.test(v.LossPct)||Number(v.LossPct)>=100?'Enter a loss from 0 to below 100%, with up to two decimals.':''}
   payload={v=>({...v,RawGradeID:v.RawGradeID?Number(v.RawGradeID):null,ProcessTypeID:Number(v.ProcessTypeID)})}
   fields={(v,change)=><>
    <label>Grade<select aria-label="Grade" value={v.RawGradeID} onChange={e=>change('RawGradeID',e.target.value)}><option value="">All grades</option>{v.RawGradeID&&!editing.choices.grades.some(g=>String(g.ID)===v.RawGradeID)&&<option value={v.RawGradeID}>{String(row?.GradeName??'Saved grade')} (saved)</option>}{editing.choices.grades.map(g=><option key={String(g.ID)} value={String(g.ID)}>{g.ParentGradeID?String(editing.choices.grades.find(p=>p.ID===g.ParentGradeID)?.GradeName??'')+' / ':''}{String(g.GradeName)}</option>)}</select><small>Use All grades for the final common Packing loss.</small></label>
    <label>Process Type *<select aria-label="Process Type" value={v.ProcessTypeID} onChange={e=>change('ProcessTypeID',e.target.value)}><option value="">Choose process type</option>{v.ProcessTypeID&&!editing.choices.types.some(t=>String(t.ID)===v.ProcessTypeID)&&<option value={v.ProcessTypeID}>{String(row?.ProcessType??'Saved type')} (saved)</option>}{editing.choices.types.map(t=><option key={String(t.ID)} value={String(t.ID)}>{String(t.ProcessType)}</option>)}</select></label>
    <label>Loss (%)<input aria-label="Loss (%)" inputMode="decimal" value={v.LossPct} onChange={e=>change('LossPct',e.target.value)}/></label>
    <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label>
   </>}/>}
 </section>;
}
