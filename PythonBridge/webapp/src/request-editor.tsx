import {layerTares,packagingGross} from './packaging-weight';
import {layerCount,responseOrderFields} from './packaging-orders';
import {requestFamilies} from './request-families';
import {ItemReviewActions} from './item-review-actions';
import {canRespondPackaging} from './packaging-access';
import {useEffect,useRef,useState} from 'react';
import {api,call,ApiError,text,date,type Row} from './api';
import {Modal,ErrorNote,Badge,Pager,Notification,FieldLabel} from './ui';
import {IconButton} from './icons';
import {useSession} from './session';
import {webResponseFields as responseFields,fieldValues,fieldPayload,responseFieldActive} from './packaging-fields';
import {RequirementSections,webRequirementValues} from './requirement-sections';
import {numericEntryError} from './numeric-input';
import {useResponseTypes,responseTypeError,responseValues} from './response-input';
import {useProfile} from './profile';
import {ResponseSections,responseChange} from './response-sections';
import {prepareResponsePricing,activeResponsePricing} from './response-pricing';
import {pricingResponseValues,type PricingCalculation} from './pkg-pricing';
import {PricingHistory} from './pkg-pricing';
import {containerProfileError} from './container-loading';import {isMixParent} from './packaging-orders';
import {sameConfig,mixChildren,sameConfigRoot,mixConfigError,synchronizeMixConfigs,loadMixRequest,prepareSameConfigGroups,type ResponseEntry} from './mix-same-config';
function mixResponseChildren(row:Row,entries:Entry[]){
 try{
  const children=JSON.parse(String(row.MixResponseChildren??'null'));
  if(!Array.isArray(children))return null;
  return JSON.stringify(children.map((child:Row)=>{
   const draft=entries.find(entry=>entry.row.ItemID===child.ItemID&&entry.row.RequestID===row.RequestID);if(!draft)return child;
   const grams=draft.values.ApplicableNetWeightGrams||String(draft.row.WeightGrams??''),tares=layerTares(draft.values.LayerTareJSON);
   for(const order of responseOrderFields){const result=draft.pricingResults[order.order];if(result?.Tare&&draft.pricing[order.order]?.Fingerprint===result.Fingerprint)tares[order.order]=result.Tare}
   const layers=layerCount(draft.values.ResponseLayerCount),gross=packagingGross(grams,draft.values,layers,tares);
   return {...child,...draft.values,ApplicableNetWeightGrams:grams,CartonGrossWeightKG:gross[responseOrderFields[layers-1].order],NutDensity:numericEntryError('NutDensity',draft.values.NutDensity)?null:draft.values.NutDensity};
  }));
 }catch{return null}
}
type Entry=ResponseEntry;
const savedValues=(row:Row)=>({...fieldValues(row,responseFields),SameConfig:sameConfig(row.SameConfig)?'1':'0'});
const entry=(row:Row,editable:boolean):Entry=>({row,values:{...(editable?responseValues(row):fieldValues(row,responseFields)),SameConfig:sameConfig(row.SameConfig)?'1':'0'},done:false,error:'',pricing:{},pricingResults:{}});
const responseDirty=(e:Entry)=>Object.keys(e.pricing).length>0||JSON.stringify(e.values)!==JSON.stringify(savedValues(e.row));
const changed=(e:Entry)=>!e.done&&responseDirty(e);
export function RequestEditor({request,canAssign,user,onClose,onSaved,initialPage=1,focusItemID,sort='[]'}:{request:Row;canAssign:boolean;user:string;onClose:()=>void;onSaved:()=>void;initialPage?:number;focusItemID?:number;sort?:string}){
 const [pics,setPics]=useState<Row[]>([]);
 useEffect(()=>{let active=true;if(canAssign)api.pics().then(d=>{if(active)setPics(d.rows)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[canAssign]);
 const session=useSession(),guard=useRef(false),content=useRef<HTMLDivElement>(null),focused=useRef(false);
 const {profile,ready,saving:profileSaving,save:saveProfile}=useProfile();
 const [entries,setEntries]=useState<Entry[]>([]),responseTypes=useResponseTypes();
 const [mixFull,setMixFull]=useState(false),loadedMix=useRef('');
 const [page,setPage]=useState(initialPage),[size,setSize]=useState(profile.settings.requests?.editor_page_size??25),[total,setTotal]=useState(0),[tick,setTick]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [confirm,setConfirm]=useState(false);
 const [pricingHistory,setPricingHistory]=useState<number|null>(null);
 const canResponse=(r:Row)=>canRespondPackaging(session,r);
 const dirty=entries.some(changed);
 function leave(){if(!busy&&(!dirty||window.confirm('Discard unsaved request changes?')))onClose()}
 function move(action:()=>void,keepDraft=false){if(!busy&&(mixFull&&keepDraft||!dirty||window.confirm('Discard unsaved request changes?')))action()}
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};
 const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved request changes?')))e.preventDefault()};
 window.addEventListener('beforeunload',warn);window.addEventListener('bridge:navigate',nav);
 return()=>{window.removeEventListener('beforeunload',warn);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 useEffect(()=>{let active=true;const key=request.RequestID+':'+tick+':'+sort;
 if(mixFull&&loadedMix.current===key)return;
 setLoading(true);setError('');
 api.requestItems(Number(request.RequestID),page,size,sort).then(async d=>{
  const full=d.total>d.rows.length||d.rows.some(r=>isMixParent(r)||!!r.ParentItemID||sameConfig(r.MixSameConfig));
  const data=full?await loadMixRequest(Number(request.RequestID),sort,api.requestItems):d;
  if(active){setEntries(data.rows.map(r=>entry(r,canResponse(r))));setTotal(data.total);setMixFull(full);loadedMix.current=full?key:''}
 }).catch(e=>{if(active){setEntries([]);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});
 return()=>{active=false}},[request.RequestID,page,size,tick,sort]);
 useEffect(()=>{if(!loading&&focusItemID&&!focused.current){const target=content.current?.querySelector<HTMLElement>('[data-item-id="'+focusItemID+'"]');if(target){target.scrollIntoView({block:'start'});focused.current=true}}},[loading,entries,focusItemID]);
 async function savePageSize(){setError('');try{await saveProfile({...profile.settings,requests:{...profile.settings.requests,editor_page_size:size}});setMessage('Edit view item page size saved to your profile.')}catch(e){setError((e as Error).message)}}
 function update(id:unknown,patch:Partial<Entry>){setEntries(xs=>{const previous=xs.find(e=>e.row.ItemID===id);let next=xs.map(e=>e.row.ItemID===id?{...e,...patch,error:''}:e);
 const member=next.find(e=>e.row.ItemID===id),root=member&&sameConfigRoot(member,next);
 if(member?.row.ParentItemID&&previous&&(['ApplicableNetWeightGrams','UnitsPerCarton','UnitsPerTertiary','ResponseLayerCount','FirstPMType','SecondPMType','ThirdPMType','LayerTareJSON'].some(k=>member.values[k]!==previous.values[k])||JSON.stringify(member.pricing)!==JSON.stringify(previous.pricing))){
  next=next.map(e=>e.row.RequestID===member.row.RequestID&&e.row.OpportunityItemID===member.row.ParentItemID?{...e,values:{...e.values,LoadPlanJSON:'',ContainerPlansJSON:'{}'}}:e);
 }
 return root?synchronizeMixConfigs(next,new Set([root.row.ItemID])):next})}
 function toggleSameConfig(e:Entry,enabled:boolean){
  if(enabled){const issue=mixConfigError(e,entries,canResponse);if(issue){setError(issue);return}}
  setError('');update(e.row.ItemID,{values:{...e.values,SameConfig:enabled?'1':'0'}});
 }
 const families=requestFamilies(entries,e=>e.row);
 const visibleGroups=mixFull?families.slice((page-1)*size,page*size):families;
 const groupCount=mixFull?families.length:total;
 function saveGroups(){
  const pending=entries.filter(changed),used=new Set<unknown>(),groups:Entry[][]=[];
  for(const e of pending){if(used.has(e.row.ItemID))continue;const group=families.find(group=>group.includes(e))||[e];
   for(const member of group)used.add(member.row.ItemID);groups.push(group);
  }
  return groups;
 }
 async function review(){
  for(const root of entries.filter(e=>isMixParent(e.row)&&sameConfig(e.values.SameConfig)&&saveGroups().some(g=>g.includes(e)))){const issue=mixConfigError(root,entries,canResponse);if(issue){setError(issue);return}}
  for(const e of saveGroups().flat()){
   if(responseDirty(e)){
    const profileError=containerProfileError(e.values,e.row.ConfigurationRequest,!!e.row.ParentItemID);if(profileError){setError(profileError);return}
    if(!canResponse(e.row)){setError('This response is not editable. Refresh the request.');return}
    for(const f of responseFields){if(f.readOnly||!responseFieldActive(f.key,e.values,e.row.ConfigurationRequest,!!e.row.ParentItemID,isMixParent(e.row)))continue;const v=e.values[f.key];const typeError=responseTypeError(f.key,v,e.row[f.key],responseTypes.types,e.values.ResponseLayerCount,e.row.ResponseLayerCount??e.row.RequestedLayerCount,!!e.row.ParentItemID,isMixParent(e.row));if(typeError){setError(typeError);return}if(v&&f.numeric&&((v!==String(e.row[f.key]??'')&&numericEntryError(f.key,v))||(f.integer&&(!/^\d+$/.test(v)||Number(v)<=0)))){setError('Check '+f.label+' for '+text(e.row.ProductCode));return}}


   }
  }
  setBusy(true);setError('');
  try{
   const pendingIDs=new Set(saveGroups().flat().map(e=>e.row.ItemID));
   let next=await prepareSameConfigGroups(entries,responseTypes.types,pendingIDs,prepareResponsePricing);
   const prepared:Entry[]=[];
   for(const e of next)prepared.push(pendingIDs.has(e.row.ItemID)&&!sameConfigRoot(e,next)?{...e,...await prepareResponsePricing(e.row,e.values,e.pricing,responseTypes.types)}:e);
   next=prepared;
   setEntries(next);setConfirm(true);
  }catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(guard.current||uncertain)return;guard.current=true;setBusy(true);setError('');let saved=0,failed=false;
  try{for(const group of saveGroups()){
   const e=group[0];let row=e.row;
   try{
    if(group.length>1||responseDirty(e)){
     const payload=group.map((member,index)=>{
      const r=member.row,existing=Object.fromEntries(['MaterialID','WidthMM','LengthMM','ResponseNotes'].map(k=>[k,r[k]??null]));
      return {...existing,...fieldPayload(member.values,responseFields,r.ConfigurationRequest,!!r.ParentItemID,isMixParent(r)),RowNum:index+1,ID:r.ItemID,RowVersion:r.ItemRowVersion,...(isMixParent(r)?{SameConfig:sameConfig(member.values.SameConfig)}:{}),...(Object.keys(member.pricing).length?{PricingCalculations:activeResponsePricing(member.values,member.pricing)}:{})};
     });
     const result=await call<{results:Row[]}>('/api/packaging/response/batch',{rows:payload});
     if(result.results?.length!==group.length||result.results.some(r=>!['OK','ERROR'].includes(String(r.Status))))throw new Error('Save outcome unknown. Close and refresh before retrying.');
     if(result.results.some(r=>r.Status!=='OK'))throw new ApiError(409,String(result.results.find(r=>r.Status!=='OK')?.Message||'Response was not saved.'));
     onSaved();
    }
    setEntries(xs=>xs.map(x=>group.some(g=>g.row.ItemID===x.row.ItemID)?{...x,done:true}:x));saved+=group.length;
   }catch(err){failed=true;const message=(err as Error).message;
    setEntries(xs=>xs.map(x=>group.some(g=>g.row.ItemID===x.row.ItemID)?{...x,error:message}:x));
    if(!(err instanceof ApiError)||err.status===0||err.status>=500){setUncertain(true);break}
   }
  }
  setMessage(saved+' item(s) saved.'+(failed?' Some changes were not saved; see the item messages.':''));
  if(!failed)setTick(n=>n+1);
  }finally{guard.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label="Edit Packaging request" className="dialog opportunity-editor record-dialog" onClose={leave}>
 <div className="customer-editor-heading"><h2>{text(request.RequestNumber)}</h2><IconButton icon="close" label="Close request editor" disabled={busy} onClick={leave}/></div>
 <div className="record-dialog-content" ref={content}><section className="panel request-editor-header"><strong>{text(request.OpportunityNumber)} · {text(request.CustomerName)}</strong><span>Response due: {date(request.ResponseDue)}</span><span>Requested by: {text(request.RequestedByName)}</span><Badge value={request.RequestStatus}/><div className="request-header-note"><span>Request note</span><p>{text(request.RequestNotes??entries[0]?.row.RequestNotes)}</p></div></section>
 <ErrorNote value={error||responseTypes.error}/><Notification value={message} onDismiss={()=>setMessage('')}/>{uncertain&&<ErrorNote value="Save outcome uncertain. Close and refresh before making further changes."/>}
 {loading?<p>Loading items…</p>:<div className="request-editor-list">{visibleGroups.map(group=><section className="request-editor-family" key={String(group[0].row.ItemID)} aria-label={'Item group '+group[0].row.ItemID}>{group.length>1&&<h3>Parent item · {text(group[0].row.ProductCode)} <small>{group.length-1} child item(s)</small></h3>}{group.map(e=>{const r=e.row,id=Number(r.ItemID),root=sameConfigRoot(e,entries),first=root?mixChildren(root,entries)[0]:undefined,linked=!!root&&!!r.ParentItemID&&first?.row.ItemID!==id,blocked=!!root&&!!mixConfigError(root,entries,canResponse);
 return <section className={'panel request-editor-item'+(r.ParentItemID?' request-editor-child':'')} key={id} data-item-id={id} aria-label={'Request item '+id}>
 <header><strong>{r.ParentItemID&&<small className="request-child-label">Child {text(r.MixChildNumber)} of {text(group[0].row.ProductCode)} · </small>}{text(r.ProductCode)} · {text(r.ItemDescription)}</strong><div className="request-item-assignment">{!r.ParentItemID&&<ItemReviewActions item={r} group={group.map(e=>e.row)} canAssign={canAssign} user={user} pics={pics} refreshing={busy||loading||uncertain||dirty} onSaved={()=>{setTick(n=>n+1);onSaved()}}/>}<span className="item-review-pic">PIC: {text(r.PIC)}</span>{!!r.ParentItemID&&<Badge value={r.ItemStage}/>}{(session.is_admin||session.scopes.some(s=>['Packaging','PackagingManager'].includes(s)))&&<IconButton icon="history" label={'View saved pricing for item '+id} disabled={busy} onClick={()=>setPricingHistory(id)}/>}</div></header>

 <details><summary>Packaging request</summary><RequirementSections row={r} values={webRequirementValues(r)} child={!!r.ParentItemID} shelfLife={r.ShelfLifeDays}/></details>
 <ErrorNote value={e.error}/>{e.done&&<p>Saved</p>}


<details open><summary>Packaging response</summary><fieldset className={!canResponse(r)||e.done?"display-only-fields":undefined} disabled={busy||uncertain}><ResponseSections editable={canResponse(r)&&!e.done&&!uncertain&&!busy} values={e.values} requestedLayers={r.RequestedLayerCount} netWeight={r.WeightGrams} configuration={r.ConfigurationRequest} product={{...r,...(linked?{LayerDimensionCaptures:e.copiedDimensions??first?.row.LayerDimensionCaptures,ResponseLayerCount:first?.row.ResponseLayerCount??first?.row.RequestedLayerCount??null}:{}),MixResponseChildren:mixResponseChildren(r,entries)}} configHelp={linked?'Packaging settings copied from '+text(first?.row.ProductCode)+'. Nut Density remains independent.':undefined} sameConfigControl={isMixParent(r)?<label className="same-config-toggle"><FieldLabel help={'Copy the first child’s packaging settings to the other children. Density stays separate.'+(blocked&&root===e?' Linked packaging cannot be edited until all children are editable. Turn off Same config to edit independently.':'')}>Same config</FieldLabel><input type="checkbox" role="switch" aria-label="Same config" disabled={!canResponse(r)||e.done} checked={sameConfig(e.values.SameConfig)} onChange={event=>toggleSameConfig(e,event.target.checked)}/></label>:undefined} configReadOnly={linked||blocked} onChange={(key,value)=>{update(id,responseChange(e.values,e.pricing,key,value,responseTypes.pallets,r.ConfigurationRequest,r))}} types={responseTypes.types} pallets={responseTypes.pallets} loading={responseTypes.loading} itemID={id} pricing={e.pricing} pricingResults={e.pricingResults} onPricingApply={(input,result)=>update(id,{pricing:{...e.pricing,[input.PackagingOrder]:input},pricingResults:{...e.pricingResults,[input.PackagingOrder]:result},values:{...e.values,...pricingResponseValues(input,result)}})}/></fieldset></details>

 </section>})}</section>)}</div>}
 </div><footer className="record-dialog-footer"><Pager page={page} size={size} total={groupCount} busy={loading||busy||uncertain} onPage={n=>move(()=>setPage(n),true)} onSize={n=>move(()=>{setSize(n);setPage(1)},true)} unit="parent / standalone items"/>
 <div className="actions record-action-bar"><IconButton icon="refresh" label="Refresh items" disabled={busy||loading||uncertain} onClick={()=>move(()=>setTick(n=>n+1))}/><IconButton icon="save" label="Save item page size" disabled={!ready||profileSaving||busy} onClick={savePageSize}/><button className="primary" disabled={!dirty||busy||loading||uncertain} onClick={review}>Review &amp; save</button></div></footer>
 {confirm&&<Modal label="Confirm request save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save changes to {saveGroups().flat().length} item(s)?</h2><p>Each parent and its children are saved together atomically. Standalone items are saved independently. Same config is a separate choice for copying packaging settings.</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 {pricingHistory!==null&&<PricingHistory itemID={pricingHistory} onClose={()=>setPricingHistory(null)}/>}
 </Modal>;
}
