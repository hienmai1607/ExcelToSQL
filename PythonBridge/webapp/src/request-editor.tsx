import {useEffect,useRef,useState} from 'react';
import {api,call,ApiError,text,type Row} from './api';
import {Modal,ErrorNote,Badge,Pager,Notification} from './ui';
import {IconButton} from './icons';
import {useSession} from './session';
import {webResponseFields as responseFields,fieldValues,fieldPayload,responseFieldActive} from './packaging-fields';
import {RequirementSections,webRequirementValues} from './requirement-sections';
import {numericEntryError} from './numeric-input';
import {useResponseTypes,responseTypeError,responseValues} from './response-input';
import {useProfile} from './profile';
import {ResponseSections,responseChange} from './response-sections';
import {pricingResponseValues,type PricingCalculation} from './pkg-pricing';
import {PricingHistory} from './pkg-pricing';
import {containerProfileError} from './container-loading';
type Entry={row:Row;values:Record<string,string>;done:boolean;error:string;pricing:Record<string,PricingCalculation>};
const stages=new Set(['Assigned','Working','Returned']);
const entry=(row:Row,editable:boolean):Entry=>({row,values:editable?responseValues(row):fieldValues(row,responseFields),done:false,error:'',pricing:{}});
const responseDirty=(e:Entry)=>Object.keys(e.pricing).length>0||JSON.stringify(e.values)!==JSON.stringify(fieldValues(e.row,responseFields));
const changed=(e:Entry)=>!e.done&&responseDirty(e);
export function RequestEditor({request,canAssign,user,onClose,onSaved,initialPage=1,focusItemID,sort='[]'}:{request:Row;canAssign:boolean;user:string;onClose:()=>void;onSaved:()=>void;initialPage?:number;focusItemID?:number;sort?:string}){
 const session=useSession(),guard=useRef(false),content=useRef<HTMLDivElement>(null),focused=useRef(false);
 const {profile,ready,saving:profileSaving,save:saveProfile}=useProfile();
 const [entries,setEntries]=useState<Entry[]>([]),responseTypes=useResponseTypes();
 const [page,setPage]=useState(initialPage),[size,setSize]=useState(profile.settings.requests?.editor_page_size??25),[total,setTotal]=useState(0),[tick,setTick]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [confirm,setConfirm]=useState(false);
 const [pricingHistory,setPricingHistory]=useState<number|null>(null);
 const canResponse=(r:Row)=>stages.has(String(r.ItemStage))&&(session.is_admin||(session.scopes.includes('Packaging')&&r.PIC===user));
 const dirty=entries.some(changed);
 function leave(){if(!busy&&(!dirty||window.confirm('Discard unsaved request changes?')))onClose()}
 function move(action:()=>void){if(!busy&&(!dirty||window.confirm('Discard unsaved request changes?')))action()}
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};
 const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved request changes?')))e.preventDefault()};
 window.addEventListener('beforeunload',warn);window.addEventListener('bridge:navigate',nav);
 return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 useEffect(()=>{let active=true;setLoading(true);setError('');
 api.requestItems(Number(request.RequestID),page,size,sort).then(d=>{if(active){setEntries(d.rows.map(r=>entry(r,canResponse(r))));setTotal(d.total)}}).catch(e=>{if(active){setEntries([]);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});
 return()=>{active=false}},[request.RequestID,page,size,tick,sort]);
 useEffect(()=>{if(!loading&&focusItemID&&!focused.current){const target=content.current?.querySelector<HTMLElement>('[data-item-id="'+focusItemID+'"]');if(target){target.scrollIntoView({block:'start'});focused.current=true}}},[loading,entries,focusItemID]);
 async function savePageSize(){setError('');try{await saveProfile({...profile.settings,requests:{...profile.settings.requests,editor_page_size:size}});setMessage('Edit view item page size saved to your profile.')}catch(e){setError((e as Error).message)}}
 function update(id:unknown,patch:Partial<Entry>){setEntries(xs=>xs.map(e=>e.row.ItemID===id?{...e,...patch,error:''}:e))}
 function review(){
  for(const e of entries.filter(changed)){
   if(responseDirty(e)){
    const profileError=containerProfileError(e.values);if(profileError){setError(profileError);return}
    if(!canResponse(e.row)){setError('This response is not editable. Refresh the request.');return}
    for(const f of responseFields){if(f.readOnly||!responseFieldActive(f.key,e.values,e.row.ConfigurationRequest))continue;const v=e.values[f.key];const typeError=responseTypeError(f.key,v,e.row[f.key],responseTypes.types,e.values.ResponseLayerCount,e.row.ResponseLayerCount??e.row.RequestedLayerCount);if(typeError){setError(typeError);return}if(v&&f.numeric&&((v!==String(e.row[f.key]??'')&&numericEntryError(f.key,v))||(f.integer&&(!/^\d+$/.test(v)||Number(v)<=0)))){setError('Check '+f.label+' for '+text(e.row.ProductCode));return}}


   }
  }setError('');setConfirm(true);
 }
 async function save(){
  if(guard.current||uncertain)return;guard.current=true;setBusy(true);setError('');let saved=0,failed=false;
  try{for(const e of entries.filter(changed)){
   let row=e.row;
   try{
    if(responseDirty(e)){
     const existing=Object.fromEntries(['MaterialID','WidthMM','LengthMM','ResponseNotes'].map(k=>[k,row[k]??null]));
     const result=await call<{results:Row[]}>('/api/packaging/response/batch',{rows:[{...existing,...fieldPayload(e.values,responseFields,row.ConfigurationRequest),RowNum:1,ID:row.ItemID,RowVersion:row.ItemRowVersion,...(Object.keys(e.pricing).length?{PricingCalculations:Object.values(e.pricing)}:{})}]});
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
 return <Modal label="Edit Packaging request" className="dialog opportunity-editor record-dialog" onClose={leave}>
 <div className="customer-editor-heading"><h2>{text(request.RequestNumber)}</h2><IconButton icon="close" label="Close request editor" disabled={busy} onClick={leave}/></div>
 <div className="record-dialog-content" ref={content}><section className="panel request-editor-header"><strong>{text(request.OpportunityNumber)} · {text(request.CustomerName)}</strong><span>Response due: {text(request.ResponseDue).slice(0,10)}</span><span>Requested by: {text(request.RequestedByName)}</span><Badge value={request.RequestStatus}/><div className="request-header-note"><span>Request note</span><p>{text(request.RequestNotes??entries[0]?.row.RequestNotes)}</p></div></section>
 <ErrorNote value={error||responseTypes.error}/><Notification value={message} onDismiss={()=>setMessage('')}/>{uncertain&&<ErrorNote value="Save outcome uncertain. Close and refresh before making further changes."/>}
 {loading?<p>Loading items…</p>:<div className="request-editor-list">{entries.map(e=>{const r=e.row,id=Number(r.ItemID),locked=!stages.has(String(r.ItemStage));
 return <section className="panel request-editor-item" key={id} data-item-id={id} aria-label={'Request item '+id}>
 <header><strong>{text(r.ProductCode)} · {text(r.ItemDescription)}</strong><div className="request-item-assignment"><span className="item-review-pic">PIC: {text(r.PIC)}</span><Badge value={r.ItemStage}/>{(session.is_admin||session.scopes.some(s=>['Packaging','PackagingManager'].includes(s)))&&<IconButton icon="history" label={'View saved pricing for item '+id} disabled={busy} onClick={()=>setPricingHistory(id)}/>}</div></header>

 <details><summary>Packaging request</summary><RequirementSections row={r} values={webRequirementValues(r)} child={!!r.ParentItemID} shelfLife={r.ShelfLifeDays}/></details>
 <ErrorNote value={e.error}/>{e.done&&<p>Saved</p>}


<details open><summary>Packaging response</summary><fieldset className={!canResponse(r)||e.done?"display-only-fields":undefined} disabled={!canResponse(r)||busy||uncertain||e.done}><ResponseSections values={e.values} requestedLayers={r.RequestedLayerCount} netWeight={r.WeightGrams} configuration={r.ConfigurationRequest} product={r} onChange={(key,value)=>{update(id,responseChange(e.values,e.pricing,key,value,responseTypes.pallets,r.ConfigurationRequest))}} types={responseTypes.types} pallets={responseTypes.pallets} loading={responseTypes.loading} itemID={id} pricing={e.pricing} onPricingApply={(input,result)=>update(id,{pricing:{...e.pricing,[input.PackagingOrder]:input},values:{...e.values,...pricingResponseValues(input,result)}})}/></fieldset></details>

 </section>})}</div>}
 </div><footer className="record-dialog-footer"><Pager page={page} size={size} total={total} busy={loading||busy||uncertain} onPage={n=>move(()=>setPage(n))} onSize={n=>move(()=>{setSize(n);setPage(1)})} unit="items"/>
 <div className="actions record-action-bar"><IconButton icon="refresh" label="Refresh items" disabled={busy||loading||uncertain} onClick={()=>move(()=>setTick(n=>n+1))}/><IconButton icon="save" label="Save item page size" disabled={!ready||profileSaving||busy} onClick={savePageSize}/><button className="primary" disabled={!dirty||busy||loading||uncertain} onClick={review}>Review &amp; save</button></div></footer>
 {confirm&&<Modal label="Confirm request save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save changes to {entries.filter(changed).length} item(s)?</h2><p>Each item is saved independently. Any failures are shown beside the item.</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 {pricingHistory!==null&&<PricingHistory itemID={pricingHistory} onClose={()=>setPricingHistory(null)}/>}
 </Modal>;
}
