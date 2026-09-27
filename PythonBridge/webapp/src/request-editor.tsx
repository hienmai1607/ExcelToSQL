import {useEffect,useRef,useState} from 'react';
import {api,call,ApiError,text,type Row} from './api';
import {Modal,ErrorNote,Badge,Pager} from './ui';
import {IconButton} from './icons';
import {ItemAttachments} from './attachments';
import {useSession} from './session';
import {responseFields,requirementFields,fieldValues,fieldPayload} from './packaging-fields';
import {NumericInput,numericEntryError} from './numeric-input';
import {numberDisplay} from './number-format';
type Entry={row:Row;values:Record<string,string>;cost:string;basis:string;pic:string;done:boolean;error:string};
const stages=new Set(['Assigned','Working','Returned']);
const entry=(row:Row):Entry=>({row,values:fieldValues(row,responseFields),cost:String(row.Cost??''),basis:String(row.CostBasis??''),pic:String(row.PICUserID??''),done:false,error:''});
const responseDirty=(e:Entry)=>JSON.stringify(e.values)!==JSON.stringify(fieldValues(e.row,responseFields))||e.cost!==String(e.row.Cost??'')||e.basis!==String(e.row.CostBasis??'');
const changed=(e:Entry)=>!e.done&&(responseDirty(e)||e.pic!==String(e.row.PICUserID??''));
export function RequestEditor({request,canAssign,user,onClose,onSaved}:{request:Row;canAssign:boolean;user:string;onClose:()=>void;onSaved:()=>void}){
 const session=useSession(),guard=useRef(false);
 const [entries,setEntries]=useState<Entry[]>([]),[pics,setPics]=useState<Row[]>([]),[vnd,setVnd]=useState<number|null>(null);
 const [page,setPage]=useState(1),[size,setSize]=useState(25),[total,setTotal]=useState(0),[tick,setTick]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [confirm,setConfirm]=useState(false),[workflow,setWorkflow]=useState<{row:Row;stage:string}|null>(null),[reason,setReason]=useState('');
 const canResponse=(r:Row)=>stages.has(String(r.ItemStage))&&(session.is_admin||(session.scopes.includes('Packaging')&&r.PIC===user));
 const dirty=entries.some(changed);
 function leave(){if(!busy&&(!dirty||window.confirm('Discard unsaved request changes?')))onClose()}
 function move(action:()=>void){if(!busy&&(!dirty||window.confirm('Discard unsaved request changes?')))action()}
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};
 const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved request changes?')))e.preventDefault()};
 window.addEventListener('beforeunload',warn);window.addEventListener('bridge:navigate',nav);
 return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 useEffect(()=>{let active=true;setLoading(true);setError('');
 api.requestItems(Number(request.RequestID),page,size).then(d=>{if(active){setEntries(d.rows.map(entry));setTotal(d.total)}}).catch(e=>{if(active){setEntries([]);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});
 return()=>{active=false}},[request.RequestID,page,size,tick]);
 useEffect(()=>{let active=true;
 if(canAssign)api.pics().then(d=>{if(active)setPics(d.rows)}).catch(e=>{if(active)setError(e.message)});
 call<{currencies:Row[]}>('/api/packaging/lookups').then(d=>{if(active)setVnd(Number(d.currencies?.find(c=>c.CurrencyCode==='VND')?.ID)||null)}).catch(e=>{if(active)setError(e.message)});
 return()=>{active=false}},[canAssign]);
 function update(id:unknown,patch:Partial<Entry>){setEntries(xs=>xs.map(e=>e.row.ItemID===id?{...e,...patch,error:''}:e))}
 function review(){
  for(const e of entries.filter(changed)){
   if(e.pic!==String(e.row.PICUserID??'')&&(!canAssign||!stages.has(String(e.row.ItemStage))||!pics.some(p=>String(p.ID)===e.pic))){setError('Choose a valid PIC for '+text(e.row.ProductCode));return}
   if(responseDirty(e)){
    if(!canResponse(e.row)){setError('This response is not editable. Refresh the request.');return}
    for(const f of responseFields){const v=e.values[f.key];if(v&&f.numeric&&((v!==String(e.row[f.key]??'')&&numericEntryError(f.key,v))||(f.integer&&(!/^\d+$/.test(v)||Number(v)<=0)))){setError('Check '+f.label+' for '+text(e.row.ProductCode));return}}
    if(e.cost&&((e.cost!==String(e.row.Cost??'')&&numericEntryError('UnitPrice',e.cost))||!e.basis.trim()||!vnd)){setError('PM cost requires a valid amount, cost basis and VND currency.');return}
    if(e.cost&&e.row.PMCostCurrencyCode&&e.row.PMCostCurrencyCode!=='VND'&&e.cost===String(e.row.Cost)){setError('Enter a reviewed VND cost; no automatic conversion is applied.');return}
   }
  }setError('');setConfirm(true);
 }
 async function save(){
  if(guard.current||uncertain)return;guard.current=true;setBusy(true);setError('');let saved=0,failed=false;
  try{for(const e of entries.filter(changed)){
   let row=e.row;
   try{
    if(e.pic!==String(row.PICUserID??'')){
     const result=await api.assign(row,Number(e.pic));
     if(!result.result?.RowVersion)throw new Error('Assignment outcome unknown. Close and refresh before retrying.');
     row={...row,PICUserID:Number(e.pic),PIC:pics.find(p=>String(p.ID)===e.pic)?.UserName??'',ItemRowVersion:result.result.RowVersion};
     update(row.ItemID,{row});onSaved();
    }
    if(responseDirty(e)){
     const existing=Object.fromEntries(['MaterialID','HeightMM','WidthMM','LengthMM','ResponseNotes'].map(k=>[k,row[k]??null]));
     const result=await call<{results:Row[]}>('/api/packaging/response/batch',{rows:[{...existing,...fieldPayload(e.values,responseFields),RowNum:1,ID:row.ItemID,RowVersion:row.ItemRowVersion,Cost:e.cost||null,CurrencyID:e.cost?vnd:null,CostBasis:e.cost?e.basis.trim():null}]});
     if(result.results?.length!==1||!['OK','ERROR'].includes(String(result.results[0].Status)))throw new Error('Save outcome unknown. Close and refresh before retrying.');
     if(result.results[0].Status!=='OK')throw new ApiError(409,String(result.results[0].Message||'Response was not saved.'));
     onSaved();
    }
    update(row.ItemID,{row,done:true});saved++;
   }catch(err){failed=true;const message=(err as Error).message;
    setEntries(xs=>xs.map(x=>x.row.ItemID===row.ItemID?{...x,row,error:message}:x));
    if(!(err instanceof ApiError)||err.status===0||err.status>=500){setUncertain(true);break}
   }
  }
  setMessage(saved+' item(s) saved.'+(failed?' Some changes were not saved; see the item messages.':''));
  if(!failed)setTick(n=>n+1);
  }finally{guard.current=false;setBusy(false);setConfirm(false)}
 }
 async function transition(){
  if(!workflow||guard.current)return;guard.current=true;setBusy(true);setError('');
  try{await call('/api/packaging/items/'+workflow.row.ItemID+'/transition',{ExpectedRowVersion:workflow.row.ItemRowVersion,TargetStage:workflow.stage,Comment:reason.trim()||null});onSaved();setTick(n=>n+1);setMessage('Stage updated.')}
  catch(e){setError((e as Error).message);if(!(e instanceof ApiError)||e.status===0||e.status>=500)setUncertain(true)}
  finally{guard.current=false;setBusy(false);setWorkflow(null)}
 }
 return <Modal label="Edit Packaging request" className="dialog opportunity-editor" onClose={leave}>
 <div className="customer-editor-heading"><h2>{text(request.RequestNumber)}</h2><IconButton icon="close" label="Close request editor" disabled={busy} onClick={leave}/></div>
 <section className="panel request-editor-header"><strong>{text(request.OpportunityNumber)} · {text(request.CustomerName)}</strong><span>Response due: {text(request.ResponseDue).slice(0,10)}</span><span>Requested by: {text(request.RequestedByName)}</span><Badge value={request.RequestStatus}/></section>
 <ErrorNote value={error}/>{message&&<p role="status">{message}</p>}{uncertain&&<ErrorNote value="Save outcome uncertain. Close and refresh before making further changes."/>}
 {loading?<p>Loading items…</p>:<div className="request-editor-list">{entries.map(e=>{const r=e.row,id=Number(r.ItemID),locked=!stages.has(String(r.ItemStage));
 return <section className="panel request-editor-item" key={id} aria-label={'Request item '+id}>
 <header><strong>{text(r.ProductCode)} · {text(r.ItemDescription)}</strong><Badge value={r.ItemStage}/></header>
 <p className="muted">{text(r.ProductName)} · Net weight: {numberDisplay('WeightGrams',r.WeightGrams)??'—'} g · Annual units: {numberDisplay('AnnualUnit',r.AnnualUnit)??'—'}</p>
 <details><summary>Packaging request</summary><div className="packaging-entry-grid">{requirementFields.filter(f=>r[f.key]!=null&&r[f.key]!=='').map(f=><div key={f.key}><strong>{f.label}</strong><p>{f.numeric?numberDisplay(f.key,r[f.key]):text(r[f.key])}</p></div>)}</div>{r.RequestNotes&&<p>{text(r.RequestNotes)}</p>}</details>
 <ErrorNote value={e.error}/>{e.done&&<p>Saved</p>}
 <label>PIC<select aria-label={'PIC for item '+id} disabled={!canAssign||locked||busy||uncertain||e.done} value={e.pic} onChange={v=>update(id,{pic:v.target.value})}><option value="">Choose a person</option>{e.pic&&!pics.some(p=>String(p.ID)===e.pic)&&<option value={e.pic}>{text(r.PIC)}</option>}{pics.map(p=><option key={String(p.ID)} value={String(p.ID)}>{text(p.UserName)}</option>)}</select></label>
 <details open><summary>Packaging response</summary><fieldset disabled={!canResponse(r)||busy||uncertain||e.done}><div className="packaging-entry-grid">
 {responseFields.map(f=><label key={f.key}>{f.label}{f.numeric?<NumericInput field={f.key} value={e.values[f.key]||''} onValueChange={v=>update(id,{values:{...e.values,[f.key]:v}})}/>:<input maxLength={f.max||200} value={e.values[f.key]||''} onChange={v=>update(id,{values:{...e.values,[f.key]:v.target.value}})}/>}</label>)}
 <label>PM cost (VND)<NumericInput field="UnitPrice" value={e.cost} onValueChange={v=>update(id,{cost:v})}/></label><label>Cost basis<input maxLength={40} value={e.basis} onChange={v=>update(id,{basis:v.target.value})}/></label>
 </div></fieldset></details>
 <ItemAttachments item={r} user={user} canUpload={!busy&&!uncertain&&(canAssign||r.PIC===user)}/>
 <div className="actions">{(canResponse(r)?['Pending Review']:[]).concat(canAssign&&r.ItemStage==='Pending Review'?['Approved','Returned']:[],canAssign&&!['Approved','Canceled'].includes(String(r.ItemStage))?['Canceled']:[]).map(stage=><button key={stage} disabled={dirty||busy||uncertain||loading||e.done} onClick={()=>{setWorkflow({row:r,stage});setReason('')}}>{stage==='Pending Review'?'Submit':stage==='Approved'?'Approve':stage==='Returned'?'Return':'Cancel request item'}</button>)}</div>
 </section>})}</div>}
 <Pager page={page} size={size} total={total} busy={loading||busy||uncertain} onPage={n=>move(()=>setPage(n))} onSize={n=>move(()=>{setSize(n);setPage(1)})} unit="items"/>
 <div className="actions"><button disabled={busy} onClick={leave}>Close</button><button disabled={busy||loading||uncertain} onClick={()=>move(()=>setTick(n=>n+1))}>Refresh items</button><button className="primary" disabled={!dirty||busy||loading||uncertain} onClick={review}>Review &amp; save</button></div>
 {confirm&&<Modal label="Confirm request save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save changes to {entries.filter(changed).length} item(s)?</h2><p>Each item is saved independently. Any failures are shown beside the item.</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 {workflow&&<Modal label="Confirm response action" onClose={()=>{if(!busy)setWorkflow(null)}}><h2>{workflow.stage==='Canceled'?'Cancel request item?':'Change stage to '+workflow.stage+'?'}</h2>{['Canceled','Returned'].includes(workflow.stage)&&<label>Reason<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}<div className="actions"><button disabled={busy} onClick={()=>setWorkflow(null)}>Back</button><button disabled={busy||(['Canceled','Returned'].includes(workflow.stage)&&!reason.trim())} onClick={transition}>Confirm</button></div></Modal>}
 </Modal>;
}
