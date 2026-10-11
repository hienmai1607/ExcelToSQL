import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {useSession} from './session';
import {IconButton} from './icons';
import {Badge,ErrorNote,Pager,Notification} from './ui';
import {SharedMasterEditor} from './shared-master-editor';
import {workspacePages} from './workspace-access';
import './administrator.css';
type Entity='roles'|'users'|'markets'|'currencies';
type AdminRow={ID:number;RowVersion:string;RoleName?:string;UserName?:string;IsActive?:boolean;Permissions?:Record<string,string>;DirectScopes?:string[];RoleIDs?:number[];MarketCode?:string;MarketName?:string;CurrencyCode?:string;CurrencyName?:string};
const titles={roles:'User role',users:'User master',markets:'Market Master',currencies:'Currency Master'};
const scopes=['Admin','Customer','Product','Opportunity','Packaging','PackagingManager','RawMaterial'];
const adminEditOnly=new Set<string>();
export function Administrator({entity}:{entity:Entity}){
 const session=useSession(),[rows,setRows]=useState<AdminRow[]>([]),[roles,setRoles]=useState<AdminRow[]>([]),[revision,setRevision]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(25),[editing,setEditing]=useState<{row:AdminRow|null}|null>(null);
 useEffect(()=>{if(!session.is_admin)return;let active=true;setBusy(true);setError('');
 Promise.all([call<{rows:AdminRow[]}>('/api/administrator/'+entity),entity==='users'?call<{rows:AdminRow[]}>('/api/administrator/roles'):Promise.resolve({rows:[]})]).then(([data,roleData])=>{if(active){setRows(data.rows);setRoles(roleData.rows)}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}
 },[entity,revision,session.is_admin]);
 if(!session.is_admin)return <ErrorNote value="Administrator access is required."/>;
 const name=(r:AdminRow)=>entity==='roles'?r.RoleName:entity==='users'?r.UserName:entity==='markets'?r.MarketName:r.CurrencyName;
 const code=(r:AdminRow)=>entity==='markets'?r.MarketCode:r.CurrencyCode;
 const filtered=rows.filter(r=>(String(name(r))+' '+String(code(r)||'')+' '+r.ID).toLowerCase().includes(search.trim().toLowerCase()));
 const visible=filtered.slice((page-1)*size,page*size),title=titles[entity],current=editing?.row;
 function initial():Record<string,string>{
  if(entity==='roles')return {RoleName:current?.RoleName||'',IsActive:current?.IsActive===false?'0':'1',...Object.fromEntries(Object.keys(workspacePages).map(key=>['page:'+key,current?.Permissions?.[key]||'none']))};
  if(entity==='users')return {UserName:current?.UserName||'',IsActive:current?.IsActive===false?'0':'1',...Object.fromEntries(scopes.map(scope=>['scope:'+scope,current?.DirectScopes?.includes(scope)?'1':'0'])),...Object.fromEntries(roles.map(role=>['role:'+role.ID,current?.RoleIDs?.includes(role.ID)?'1':'0']))};
  return {Code:String(code(current??({} as AdminRow))||''),Name:String(name(current??({} as AdminRow))||'')};
 }
 function payload(v:Record<string,string>){
  if(entity==='roles')return {RoleName:v.RoleName.trim(),IsActive:v.IsActive==='1',Permissions:Object.fromEntries(Object.keys(workspacePages).map(key=>[key,v['page:'+key]]))};
  if(entity==='users')return {UserName:v.UserName.trim(),IsActive:v.IsActive==='1',DirectScopes:scopes.filter(scope=>v['scope:'+scope]==='1'),RoleIDs:roles.filter(role=>v['role:'+role.ID]==='1').map(role=>role.ID)};
  return {Code:v.Code.trim().toUpperCase(),Name:v.Name.trim()};
 }
 return <div className="customers-page administrator-page">
 <div className="customer-heading"><h1>{title}</h1></div>
 <div className="view-toolbar" role="toolbar" aria-label="Administrator tasks"><IconButton icon="refresh" label={'Refresh '+title} disabled={busy} onClick={()=>setRevision(n=>n+1)}/></div>
 <Notification value={notice} onDismiss={()=>setNotice('')}/><ErrorNote value={error}/>
 <form className="filters" onSubmit={e=>e.preventDefault()}><label>Search {title}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><button type="button" onClick={()=>{setSearch('');setPage(1)}}>Clear</button></form>
 {entity==='roles'&&<p className="administrator-help">Roles grant page-level Display or Edit access. Multiple roles combine using the highest access. PIC ownership and workflow rules still apply. Administrator pages remain restricted to the Admin role.</p>}
 <section className="panel"><div className="table-wrap"><table aria-label={title}><thead><tr><th className="customer-actions record-id-column"><span>ID</span><IconButton icon="plus" label={'New '+title} disabled={busy||!!error} onClick={()=>setEditing({row:null})}/></th>{['markets','currencies'].includes(entity)&&<th>Code</th>}<th>{entity==='roles'?'Role name':entity==='users'?'Login name':'Name'}</th>{['roles','users'].includes(entity)&&<th>Access</th>}{entity==='users'&&<th>User roles / direct access</th>}</tr></thead>
 <tbody>{visible.map(row=><tr key={row.ID}><td><button className="record-link" aria-label={'Edit '+title+' '+row.ID} onClick={()=>setEditing({row})}>#{row.ID}</button></td>{['markets','currencies'].includes(entity)&&<td>{code(row)}</td>}<td>{name(row)}</td>{['roles','users'].includes(entity)&&<td><Badge value={row.IsActive?'Active':'Inactive'}/></td>}{entity==='users'&&<td>{[...(row.RoleIDs||[]).map(id=>roles.find(r=>r.ID===id)?.RoleName||'#'+id),...(row.DirectScopes||[]).map(scope=>scope+' (direct)')].join(', ')||'No access assigned'}</td>}</tr>)}</tbody></table></div>
 {!busy&&!visible.length&&<p className="empty">No records found.</p>}<Pager page={page} size={size} total={filtered.length} busy={busy} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="records"/></section>
 {editing&&<SharedMasterEditor key={entity+':'+(current?.ID||'new')} row={current as unknown as Row|null} canWrite={true} title={title} endpoint={'/api/administrator/'+entity} initial={initial} payload={payload}
 validate={v=>!String(v[entity==='roles'?'RoleName':entity==='users'?'UserName':'Name']||'').trim()?'Name is required.':!['roles','users'].includes(entity)&&!v.Code.trim()?'Code is required.':entity==='currencies'&&!/^[a-z]{3}$/i.test(v.Code.trim())?'Use a three-letter currency code.':''}
 onClose={()=>setEditing(null)} onSaved={()=>{setNotice(title+' saved.');setRevision(n=>n+1)}}
 fields={(v,change)=><>
 {current&&<label>User / record ID<input readOnly value={current.ID}/></label>}
 {['roles','users'].includes(entity)?<><label>{entity==='roles'?'Role name':'Login name'} *<input aria-label={entity==='roles'?'Role name *':'Login name *'} maxLength={100} value={v[entity==='roles'?'RoleName':'UserName']} disabled={entity==='users'&&current?.ID===session.user_id} onChange={e=>change(entity==='roles'?'RoleName':'UserName',e.target.value)}/></label>
 <label>Access<select aria-label="Access" value={v.IsActive} disabled={entity==='users'&&current?.ID===session.user_id} onChange={e=>change('IsActive',e.target.value)}><option value="1">Active</option><option value="0">Inactive</option></select></label></>:<><label>Code *<input aria-label="Code *" maxLength={entity==='currencies'?3:10} value={v.Code} onChange={e=>change('Code',e.target.value)}/></label><label>Name *<input aria-label="Name *" maxLength={entity==='currencies'?50:100} value={v.Name} onChange={e=>change('Name',e.target.value)}/></label></>}
 {entity==='roles'&&<div className="role-permission-list" role="group" aria-label="Page permissions">{Object.entries(workspacePages).map(([key,label])=><label key={key}>{label}<select aria-label={label+' access'} value={v['page:'+key]} onChange={e=>change('page:'+key,e.target.value)}><option value="none">No access</option><option value="display">Display</option>{!adminEditOnly.has(key)&&<option value="edit">Edit</option>}</select></label>)}</div>}
 {entity==='users'&&<><fieldset className="admin-role-options"><legend>User roles</legend>{roles.length?roles.map(role=><label key={role.ID}><input type="checkbox" aria-label={'Role '+role.RoleName} checked={v['role:'+role.ID]==='1'} disabled={!role.IsActive&&v['role:'+role.ID]!=='1'} onChange={e=>change('role:'+role.ID,e.target.checked?'1':'0')}/>{role.RoleName}{!role.IsActive?' (inactive)':''}</label>):<p>Create a User role to assign page permissions.</p>}</fieldset>
 <fieldset className="admin-role-options"><legend>Direct access (existing scopes)</legend><p>Preserved for existing users. Direct access combines with user roles. Clear a direct scope to restrict that access using roles.</p>{scopes.map(scope=><label key={scope}><input type="checkbox" aria-label={'Direct access '+scope} checked={v['scope:'+scope]==='1'} disabled={scope==='Admin'&&current?.ID===session.user_id} onChange={e=>change('scope:'+scope,e.target.checked?'1':'0')}/>{scope}</label>)}</fieldset></>}
 </>}/>}
 </div>;
}
