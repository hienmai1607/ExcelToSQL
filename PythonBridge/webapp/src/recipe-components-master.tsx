import {useState} from 'react';
import {SharedMasterView} from './shared-master-view';
import {SharedMasterEditor} from './shared-master-editor';
import type {Row} from './api';
export function RecipeComponentsMaster({canWrite}:{canWrite:boolean}){
 const [editing,setEditing]=useState<{row:Row|null}|null>(null),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
 return <section className="customers-page"><SharedMasterView entity="recipe-components" title="Recipe Components" newLabel="New Recipe Component" recordLabel="Edit Recipe Component" columns={{ComponentName:'Component name',Status:'Status'}} initialSort="ComponentName" revision={revision} notice={notice} onDismiss={()=>setNotice('')} canWrite={canWrite} onEdit={row=>setEditing({row})}/>
 {editing&&<SharedMasterEditor row={editing.row} title="Recipe Component" endpoint="/api/recipe-components" canWrite={canWrite} onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Recipe Component saved.');setRevision(n=>n+1)}} initial={()=>({ComponentName:String(editing.row?.ComponentName??''),Status:String(editing.row?.Status??'Active')})} validate={v=>v.ComponentName.trim()?'':'Enter a component name.'} payload={v=>v} fields={(v,change)=><><label>Component name<input aria-label="Component name" maxLength={100} value={v.ComponentName} onChange={e=>change('ComponentName',e.target.value)}/></label><label>Status<select value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label></>}/>}
 </section>;
}
