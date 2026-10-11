import {useState} from 'react';
import type {Row} from './api';
import {SharedMasterView} from './shared-master-view';
import {SharedMasterEditor} from './shared-master-editor';

export function CategoryMaster({canWrite}:{canWrite:boolean}){
 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[editing,setEditing]=useState<{row:Row|null}|null>(null);
 return <section className="customers-page">
 <SharedMasterView entity="categories" title="Category Master" newLabel="New category" recordLabel="View category" canWrite={canWrite} initialSort="CategoryName" revision={revision} notice={notice} onDismiss={()=>setNotice('')} columns={{CategoryName:'Category name',Status:'Status'}} onEdit={row=>setEditing({row})}/>
 {editing&&<SharedMasterEditor row={editing.row} canWrite={canWrite} title="Category" endpoint="/api/categories" onClose={()=>setEditing(null)} onSaved={()=>{setNotice('Category saved.');setRevision(n=>n+1)}}
 initial={()=>({CategoryName:String(editing.row?.CategoryName??''),Status:String(editing.row?.Status??'Active')})}
 validate={v=>!v.CategoryName.trim()?'Category name is required.':''}
 payload={v=>({CategoryName:v.CategoryName.trim(),Status:v.Status})}
 fields={(v,change)=><>
 <label>Category name *<input aria-label="Category name" maxLength={100} value={v.CategoryName} onChange={e=>change('CategoryName',e.target.value)}/></label>
 <label>Status<select aria-label="Status" value={v.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label>
 <p className="muted">Blocked categories remain on existing Products, but cannot be newly assigned. Names used by Products cannot be renamed; create a new category instead.</p>
 </>}/>}
 </section>;
}
