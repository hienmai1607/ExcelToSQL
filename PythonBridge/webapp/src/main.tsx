import {DateInput} from './date-input';
import {ViewTrailRoot} from './view-trail';
import './view-trail.css';
import {BusinessDelete} from './business-delete';
import {LocalAI} from './local-ai';
import {GradeDensityMaster} from './grade-density-master';
import {canAssignPackaging} from './packaging-access';
import {ContainerMaster} from './container-master';
import './load-planning.css';
import {Administrator} from './administrator';
import {pageAccess} from './workspace-access';
import {scrollRevealedContent} from './expand-scroll';
import {ItemStageSummary} from './item-stage-summary';
import {tcbHeaders} from './tcb-columns';
import {newId} from './id';
import {ResizableTable,ColumnResizer,columnWidth} from './column-widths';
import {mixItemTree} from './opportunity-mix';
import {opportunityDisplay} from './number-format';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,ApiError,date,text,type Page,type Row,type Session,type RequestPayload} from './api';
import './style.css';
import {Badge,ErrorNote,Pager,Notification} from './ui';
import {PackagingSummary} from './packaging-summary';
import {TCBReview} from './opportunity-losses';
import {tcbReviewItems} from './tcb-review-model';
import {Customers} from './customers';
import {Ports} from './ports';import {CategoryMaster} from './category-master';
import {LossProcessMaster} from './loss-process-master';
import {Requests} from './requests';
import {LinkedPackagingRequestView} from './linked-packaging-request';
import {UnitConversions} from './unit-conversions';
import {PackagingMaster} from './packaging-master';
import {PackagingDimensions} from './packaging-dimensions';
import {SessionGate,useSession} from './session';
import {Icon,IconButton} from './icons';
import {OpportunityCreate} from './opportunity-create';
import {OpportunityExcel} from './opportunity-excel';
import {OpportunityChanges} from './opportunity-changes';
import './opportunities.css';
import {itemTabs,itemTabColumns,type ItemTab,useOpportunityView,OpportunityViewTools,ViewHeading,sortItems,opportunityFilters,defaultFilters,activeFilters} from './opportunity-view';
import './compact.css';
import {ProfileProvider,WorkspaceFrame} from './profile';
import {WorkspaceSidebar} from './workspace-sidebar';
import './professional-workspace.css';import './workspace-refinements.css';
import './editor-typography.css';
import {AttachmentQueue,ItemAttachments,stageFiles,bindFiles,discardStaged,type PickedFile} from './attachments';

const empty:Page={rows:[],page:1,total:0};
function App(){
 const session=useSession();
 const [tab,setTab]=useState(()=>session.permissions&&!session.is_admin?(Object.keys(session.permissions).find(key=>pageAccess(session,key))||"no-access"):session.is_admin||session.scopes.includes('Opportunity')?'opportunities':session.scopes.includes('Customer')?'customers':session.scopes.includes('Product')?'products':session.scopes.includes('RawMaterial')?'raw-materials':'requests');
 const canSales=!!session&&(session.is_admin||session.scopes.includes('Opportunity'));
 const canRequests=!!session&&(session.is_admin||session.scopes.some(x=>['Opportunity','Packaging','PackagingManager'].includes(x)));
 const canProduct=session.is_admin||session.scopes.includes('Product');
 const canCustomer=!!session&&(session.is_admin||session.scopes.includes('Customer'));
 const canMasters=session.is_admin||session.scopes.some(x=>['Packaging','PackagingManager'].includes(x));
 const canRaw=session.is_admin||session.scopes.includes('RawMaterial');
 const canMaintain=session.is_admin||session.scopes.includes('Packaging');
 const canAssign=!!session&&canAssignPackaging(session);
 return <ProfileProvider key={session?.username||"anonymous"} enabled={!!session}><WorkspaceFrame><WorkspaceSidebar session={session} tab={tab} onNavigate={next=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab(next)}}/>
 <ViewTrailRoot page={tab}><main>{!['grade-densities','containers','requests','opportunities','customers','products','materials','prices','raw-materials','raw-prices','raw-grades','vendors','categories','ports','loss-processes','uoms','pallets','packaging-types','packaging-dimensions','conversions','admin-roles','admin-users','admin-markets','admin-currencies'].includes(tab)&&<header className="topbar"><span>Commercial operations / {tab==='opportunities'?'Sales pipeline':tab==='customers'?'Customer master':'Packaging team'}</span><span className="live"><i/> {session?'Connected to your API':'Connecting to API…'}</span></header>}
 <><AttachmentQueue user={session.username}/>{!tab.startsWith('admin-')&&!pageAccess(session,tab)?<p>No access is assigned for this page.</p>:tab.startsWith('admin-')&&session.is_admin?<Administrator key={tab} entity={tab==='admin-roles'?'roles':tab==='admin-users'?'users':tab==='admin-markets'?'markets':'currencies'}/>:tab==='containers'&&session.is_admin?<ContainerMaster canWrite/>:tab==='grade-densities'&&canMasters?<GradeDensityMaster canWrite={canMaintain&&pageAccess(session,tab,true)}/>:tab==='packaging-dimensions'&&canMasters?<PackagingDimensions canWrite={canMaintain&&pageAccess(session,tab,true)}/>:tab==='conversions'&&(canMasters||canRaw)?<UnitConversions session={session}/>:tab==='opportunities'&&canSales?<Opportunities key={session.username} session={session}/>:tab==='customers'&&canCustomer?<Customers canWrite={pageAccess(session,'customers',true)}/>:tab==='products'&&canProduct?<PackagingMaster key="products" entity="products" canWrite={canProduct&&pageAccess(session,'products',true)}/>:tab==='categories'&&canProduct?<CategoryMaster canWrite={session.is_admin||session.permissions?.categories==='edit'}/>:tab==='loss-processes'&&(canSales||canProduct)?<LossProcessMaster canWrite={session.is_admin||session.permissions?.['loss-processes']==='edit'}/>:tab==='ports'&&(canSales||canCustomer)?<Ports canWrite={session.is_admin||session.permissions?.ports==='edit'}/>:tab==='uoms'&&(session.is_admin||pageAccess(session,'uoms')&&!!session.permissions)?<PackagingMaster key="uoms" entity="uoms" canWrite={session.is_admin||session.permissions?.uoms==="edit"}/>:(tab==='raw-materials'||tab==='raw-prices'||tab==='raw-grades')&&canRaw?<PackagingMaster key={tab} entity={tab} canWrite={canRaw&&pageAccess(session,tab,true)}/>:(tab==='materials'||tab==='prices'||tab==='vendors'||tab==='pallets'||tab==='packaging-types')&&canMasters?<PackagingMaster key={tab} entity={tab} canWrite={canMaintain&&pageAccess(session,tab,true)}/>:canRequests?<Requests canAssign={canAssign} user={session.username}/>:<p>No workspace access is assigned to this user.</p>}</>
 </main></ViewTrailRoot>{(canSales||canRequests||canProduct||canCustomer||canMasters||canRaw)&&(session.is_admin||!session.permissions||Object.values(session.permissions).some(v=>v==='display'||v==='edit'))&&<LocalAI key={JSON.stringify([session.user_id,session.scopes,session.permissions])}/>}</WorkspaceFrame></ProfileProvider>
}
function Opportunities({session}:{session:Session}){
 const [expandedMixes,setExpandedMixes]=useState<Set<number>>(new Set());
 const [summaryItem,setSummaryItem]=useState<Row|null>(null);
 const [linkedRequest,setLinkedRequest]=useState<{id:number;number:string}|null>(null);
 const [allLossRows,setAllLossRows]=useState<Row[]|null>(null);
 const itemSettingsSaved=useRef(false);
 const [log,setLog]=useState<{id:number;number:string}|null>(null);
 const [creating,setCreating]=useState(false),[editing,setEditing]=useState<{rows:Row[];focusItem?:number}|null>(null);
 const headerView=useOpportunityView('header'),itemView=useOpportunityView('items');
 const [itemTab,setItemTab]=useState<ItemTab>('all');
 const [stageSummary,setStageSummary]=useState(false);
 const itemColumns=itemTabColumns(itemView.view,itemTab),showPackaging=itemTab==='packaging';
 const headerSort=JSON.stringify(headerView.view.sort),size=headerView.view.page_size??25;
 const headerColumns=headerView.view.columns.filter(c=>c!=='OpportunityNumber');
 useEffect(()=>setPage(1),[size]);
 useEffect(()=>setPage(1),[headerSort]);
 const [data,setData]=useState<Page>(empty),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [filters,setFilters]=useState<Record<string,string>>({}),[reload,setReload]=useState(0);
 const visibleFilters=headerView.view.filters??defaultFilters;
 const visibleFilterKey=JSON.stringify(visibleFilters);
 useEffect(()=>{setFilters(JSON.parse(headerView.savedFilters));setPage(1)},[headerView.savedFilters]);
 useEffect(()=>{setFilters(current=>Object.fromEntries(Object.entries(current).filter(([k])=>visibleFilters.includes(k))));setPage(1)},[visibleFilterKey]);
 const [selected,setSelected]=useState<Row[]|null>(null),[checked,setChecked]=useState<Set<number>>(new Set()),[requirements,setRequirements]=useState<Record<number,string>>({});
 const [due,setDue]=useState(''),[notes,setNotes]=useState(''),[confirm,setConfirm]=useState(false),[saving,setSaving]=useState(false),[success,setSuccess]=useState('');
 const [files,setFiles]=useState<Record<number,PickedFile[]>>({});
 const pendingKey='bridge.request.'+session.username;
 const [pending,setPending]=useState<RequestPayload|null>(()=>{try{return JSON.parse(localStorage.getItem(pendingKey)||'null')}catch{return null}});
 const posting=useRef(false);
 useEffect(()=>{let active=true;setLoading(true);setError('');setSelected(null);setChecked(new Set());api.opportunities(page,size,{...filters,sort:headerSort}).then(d=>{if(active)setData(d)}).catch(e=>{if(active){setData(empty);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,size,filters,reload,headerSort]);
 const grouped=new Map<number,Row[]>(); for(const row of data.rows){const id=Number(row.OpportunityID);if(!grouped.has(id))grouped.set(id,[]);grouped.get(id)!.push(row)} const groups=Array.from(grouped.values());
 const header=selected?.[0];const items=mixItemTree(selected?.filter(x=>x.ItemID!==null&&x.ItemID!==undefined)||[],itemView.view.sort);
 const visibleItems=items.filter(x=>!x.ParentItemID||expandedMixes.has(Number(x.ParentItemID)));
 const canEdit=pageAccess(session,'opportunities',true);const canCreate=header?.HeaderStage==='Draft'&&canEdit;
 function open(rows:Row[]){scrollRevealedContent(()=>document.querySelector<HTMLElement>('.opportunity-items'));setStageSummary(false);setSummaryItem(null);setSelected(rows);setExpandedMixes(new Set());setChecked(new Set());setRequirements({});setFiles({});setNotes('');setDue('');setError('');}
 function canSelectItem(item:Row){return canCreate&&item.ItemStage==='Draft'&&!item.HasOpenPackagingRequest&&!saving&&!pending}
 function selectItem(item:Row,select:boolean){
  if(select)scrollRevealedContent(()=>document.querySelector<HTMLElement>('.opportunity-request-box'));
  const group=item.ParentItemID?[item]:[item,...items.filter(child=>Number(child.ParentItemID)===Number(item.ItemID))];
  setChecked(prev=>{const next=new Set(prev);for(const member of group){const id=Number(member.ItemID);if(select){if(canSelectItem(member))next.add(id)}else next.delete(id)}return next});
 }
 function prepare(){if(items.some(x=>checked.has(Number(x.ItemID))&&!x.PrimaryTypeID&&!String(x.PackagingType||'').trim())){setError('Choose Primary Type for each selected item using Edit Opportunity before creating a request.');return}if(!header||!checked.size||!due){setError('Select at least one Draft item and enter a response due date.');return}if(items.some(x=>checked.has(Number(x.ItemID))&&x.HasOpenPackagingRequest)){setError('A selected item already has an active Packaging Request. Refresh Opportunities.');return}setError('');setConfirm(true)}
 async function create(payload?:RequestPayload){
  if(posting.current)return;
  let body:RequestPayload|null=null;
  posting.current=true;setSaving(true);setError('');
  try {
  body=payload||pending||(header?{OpportunityID:Number(header.OpportunityID),ExpectedRowVersion:String(header.HeaderRowVersion),CreationKey:newId(),ResponseDue:due,RequestNotes:notes||null,items:items.filter(x=>checked.has(Number(x.ItemID))).map(x=>({OpportunityItemID:Number(x.ItemID),ExpectedRowVersion:String(x.ItemRowVersion),PackagingRequirement:requirements[Number(x.ItemID)]||null}))}:null);
  if(!body)throw new Error('Select Opportunity items before creating a request.');
   // Persist BEFORE POST. A lost reply can be retried using the identical payload.
   await stageFiles(session.username,body.CreationKey,checked,files);
   localStorage.setItem(pendingKey,JSON.stringify(body));setPending(body);
   const result=await api.create(body);
   await bindFiles(session.username,body.CreationKey,result.items);
   localStorage.removeItem(pendingKey);setPending(null);setFiles({});setConfirm(false);setSelected(null);setChecked(new Set());
   setSuccess('Request '+result.header.RequestNumber+' '+(result.replayed?'recovered':'created')+' with '+result.items.length+' item(s).');setReload(n=>n+1);
  }catch(e){const err=e as ApiError;setConfirm(false);setError(err.message+(err.status===409?' Refresh the Opportunity and check for an existing open request.':''));if(body&&err.status>=400&&err.status<500&&err.status!==408){localStorage.removeItem(pendingKey);setPending(null);await discardStaged(session.username,body.CreationKey)}}
  finally{posting.current=false;setSaving(false)}
 }
 return <div className="customers-page opportunity-page"><div className="customer-heading"><h1>Opportunities</h1></div>
 {allLossRows&&<TCBReview rows={allLossRows} onClose={()=>{setAllLossRows(null);if(itemSettingsSaved.current){itemSettingsSaved.current=false;api.opportunities(page,size,{...filters,sort:headerSort}).then(fresh=>{setData(fresh);setSelected(current=>{if(!current)return null;const matching=fresh.rows.filter(r=>Number(r.OpportunityID)===Number(current[0]?.OpportunityID));return matching.length?matching:current})}).catch(e=>setError(e.message))}}} onSaved={(id,version)=>{const update=(r:Row)=>Number(r.ItemID)===id?{...r,ItemRowVersion:version}:r;setSelected(current=>current?.map(update)??null);setData(current=>({...current,rows:current.rows.map(update)}));itemSettingsSaved.current=true}}/>}
 {linkedRequest&&<LinkedPackagingRequestView id={linkedRequest.id} number={linkedRequest.number} onClose={()=>setLinkedRequest(null)}/>}
 {summaryItem&&selected&&<PackagingSummary row={summaryItem} rows={selected} opportunity={header??{}} onClose={()=>setSummaryItem(null)}/>}
 {log&&<OpportunityChanges id={log.id} number={log.number} onClose={()=>setLog(null)}/>}
 <OpportunityViewTools control={headerView}><IconButton icon="refresh" label="Refresh Opportunities" disabled={loading||saving} onClick={()=>{setPage(1);setReload(n=>n+1)}}/><OpportunityExcel header={headerView.view} items={itemView.view} page={page} pageSize={size} filters={filters} disabled={loading||saving} onMessage={setSuccess} onError={setError}/></OpportunityViewTools>
 {editing&&<OpportunityCreate rows={editing.rows} focusItem={editing.focusItem} onClose={()=>setEditing(null)} onSaved={number=>{setSuccess(number+' updated.');setReload(n=>n+1)}}/>}
 {creating&&<OpportunityCreate onClose={()=>setCreating(false)} onSaved={number=>{setSuccess(number+' created.');setPage(1);setReload(n=>n+1)}}/>}
 <Notification value={success} onDismiss={()=>setSuccess('')}/><ErrorNote value={error}/>
 {pending&&<div className="notice pending"><strong>A request needs confirmation</strong><p>Its last result is uncertain. Retry the same {pending.items.length}-item request to retrieve or complete it safely.</p><button disabled={saving} onClick={()=>create(pending)}>{saving?'Checking…':'Retry saved request'}</button></div>}
 {visibleFilters.length>0&&<form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);setFilters(activeFilters(headerView.view))}}>{visibleFilters.map(f=><label key={f}>{opportunityFilters[f]}{f==='stage'?<select aria-label="Stage" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}><option value="">All stages</option>{['Draft','In progress','Closed','Canceled'].map(x=><option key={x}>{x}</option>)}</select>:f.startsWith('bid_open_')?<DateInput aria-label={opportunityFilters[f]} value={headerView.view.values?.[f]||''} onValueChange={value=>headerView.setView(v=>({...v,values:{...v.values,[f]:value}}))}/>:<input type="text" maxLength={f==='opportunity_number'?20:200} value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}/>}</label>)}<button className="primary" disabled={loading||saving}>Search</button><button type="button" disabled={loading||saving} onClick={()=>{headerView.setView(v=>({...v,values:{}}));setFilters({});setPage(1)}}>Clear</button></form>}
<section className="panel"><div className="table-wrap"><ResizableTable pinFirstColumn aria-label="Opportunity overview" disabled={!headerView.canSave} columns={headerColumns} widths={headerView.view.column_widths} leading={[columnWidth(headerView.view.column_widths,'OpportunityNumber')]} onResize={(key,width)=>headerView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr><ViewHeading className="customer-actions record-id-column" column="OpportunityNumber" control={headerView}><IconButton icon="plus" label="New Opportunity" disabled={saving||!!pending||!canEdit} onClick={()=>setCreating(true)}/></ViewHeading>{headerColumns.map(c=><ViewHeading key={c} column={c} control={headerView}/>)}</tr></thead><tbody>{!loading&&groups.map(rows=>{const r=rows[0];return <tr key={String(r.OpportunityID)} className={header?.OpportunityID===r.OpportunityID?'selected':''}><td className="customer-actions record-id-column"><button className="record-link" aria-label={(r.HeaderStage==='Draft'&&canEdit?'Edit Opportunity ':'View Opportunity ')+r.OpportunityNumber} disabled={saving||!!pending} onClick={()=>r.HeaderStage==='Draft'&&canEdit?setEditing({rows}):open(rows)}>{text(r.OpportunityNumber)}</button><BusinessDelete entity="opportunities" id={r.OpportunityID} version={r.HeaderRowVersion} label={'Opportunity '+r.OpportunityNumber} allowed={canEdit&&r.HeaderStage==='Draft'} disabled={saving||!!pending} onDeleted={()=>{setSelected(null);setReload(n=>n+1)}}/></td>{headerColumns.map(c=><td key={c}>{c==='OpportunityNumber'?<button className="link opportunity-link" disabled={saving} onClick={()=>open(rows)}>{text(opportunityDisplay(r,c))}</button>:c==='HeaderStage'?<Badge value={r[c]}/>:c==='ItemCount'?<button className="record-count" aria-label="View details" title={'View items for '+r.OpportunityNumber} disabled={saving} onClick={()=>open(rows)}>{rows.filter(x=>x.ItemID&&!x.ParentItemID).length} items</button>:c==='BidOpen'||c==='BidClose'?date(r[c]):text(opportunityDisplay(r,c))}</td>)}</tr>})}</tbody></ResizableTable></div>{!loading&&!groups.length&&<div className="empty">No opportunities match these filters.</div>}<Pager page={page} size={size} total={data.total} busy={loading||saving} onPage={setPage} onSize={n=>{headerView.setView(v=>({...v,page_size:n}));setPage(1)}} unit="opportunities"/></section>
 {header&&<section className="detail opportunity-items">
 {!canCreate&&<div className="notice">Packaging Requests can only be created from a Draft Opportunity and Draft items.</div>}
 <OpportunityViewTools control={itemView} trailing={<div className="item-view-tabs" role="group" aria-label="Item field groups">{(Object.keys(itemTabs) as ItemTab[]).map(tab=><button key={tab} type="button" aria-pressed={!stageSummary&&itemTab===tab} onClick={()=>{setStageSummary(false);setItemTab(tab)}}>{itemTabs[tab]}</button>)}<button type="button" aria-pressed={stageSummary} onClick={()=>setStageSummary(true)}>Stage Summary</button></div>}><IconButton icon="close" label="Close Opportunity details" disabled={saving} onClick={()=>setSelected(null)}/><IconButton icon="history" label="Opportunity change log" onClick={()=>setLog({id:Number(header.OpportunityID),number:String(header.OpportunityNumber)})}/></OpportunityViewTools>
 {stageSummary?<ItemStageSummary items={items}/>:<div className="panel opportunity-items-box"><div className="table-wrap"><ResizableTable pinFirstColumn aria-label="Opportunity items" disabled={!itemView.canSave} columns={itemColumns} widths={itemView.view.column_widths} leading={[200]} onResize={(key,width)=>itemView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead>{itemTab==='tcb'&&<tr className="tcb-column-subgroups"><th/><>{tcbHeaders(itemColumns).map((group,index)=><th key={index} colSpan={group.span} scope="colgroup">{group.label}</th>)}</></tr>}<tr><th><span className="sr-only">{showPackaging?'Select':'Packaging status'}</span></th>{itemColumns.map(c=><ViewHeading key={c} column={c} control={itemView}/>)}</tr></thead><tbody>{visibleItems.map(item=>{const id=Number(item.ItemID);return <tr key={id} className={item.ParentItemID?'opportunity-mix-child':''}><td><span className="opportunity-item-controls"><span className="mix-item-number">{text(item.ItemNumber)}</span><BusinessDelete entity="opportunity-items" id={item.ItemID} version={item.ItemRowVersion} label={'Opportunity item '+item.ItemNumber} allowed={canEdit&&item.ItemStage==='Draft'} disabled={saving} onDeleted={()=>{setSelected(null);setReload(n=>n+1)}}/>{items.some(c=>Number(c.ParentItemID)===id)&&<button type="button" className="link mix-child-toggle" aria-label={'Show mix children for Item '+item.ItemNumber} aria-expanded={expandedMixes.has(id)} onClick={()=>setExpandedMixes(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next})}>{expandedMixes.has(id)?'▾':'▸'}</button>}{itemTab==='tcb'&&!item.ParentItemID&&<IconButton icon="calculator" label={'TCB Review for '+text(item.ProductCode)+' item '+id} disabled={saving||!canEdit} onClick={()=>setAllLossRows(tcbReviewItems(selected??[],id))}/>}{itemTab==='responses'&&<IconButton icon="packagingTree" label={'Packaging Summary for '+text(item.ProductCode)+' item '+id} onClick={()=>setSummaryItem(item)}/>}{showPackaging&&<input type="checkbox" aria-label={'Select '+text(item.ProductCode)+' item '+id} disabled={!canSelectItem(item)} checked={checked.has(id)} onChange={e=>selectItem(item,e.currentTarget.checked)}/>}</span>{!!item.HasOpenPackagingRequest&&<small className="active-packaging-request" title="This item already has an active Packaging Request. Complete or cancel that request item before requesting again.">{text(item.OpenPackagingRequestNumber)} · {text(item.OpenPackagingRequestStage)}</small>}</td>{itemColumns.map(c=><td key={c}>{c==='ItemStage'?<Badge value={item[c]}/>:c==='PackagingRequestNumber'&&String(item[c]??'').trim()&&Number.isSafeInteger(Number(item.PackagingRequestID))&&Number(item.PackagingRequestID)>0?<button type="button" className="record-link" aria-label={'View Packaging Request '+item[c]} onClick={()=>setLinkedRequest({id:Number(item.PackagingRequestID),number:String(item[c])})}>{text(item[c])}</button>:text(opportunityDisplay(item,c))}</td>)}</tr>})}</tbody></ResizableTable></div></div>}
 {!stageSummary&&showPackaging&&checked.size>0&&<div className="panel opportunity-request-box" role="region" aria-label="Packaging request"><div className="request-form"><label>Response due<DateInput aria-label="Response due" required disabled={saving||!!pending} min={new Date().toISOString().slice(0,10)} value={due} onValueChange={setDue}/></label><label className="grow">Request notes<textarea aria-label="Request notes" rows={2} maxLength={1000} placeholder="Context for the Packaging team" disabled={saving||!!pending} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className="primary" disabled={!canCreate||!checked.size||!due||saving||!!pending} onClick={prepare}>Create Packaging Request ({checked.size})</button></div></div>}</section>}
 {confirm&&<div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="eyebrow">CONFIRM REQUEST</div><h2 id="create-title">Send {checked.size} items to Packaging?</h2><p>{text(header?.OpportunityNumber)} · Response due {due}</p><p>A new request will contain only the selected items and their current Opportunity information.</p><div className="actions"><button autoFocus disabled={saving} onClick={()=>setConfirm(false)}>Cancel</button><button className="primary" disabled={saving} onClick={()=>create()}>{saving?'Creating…':'Create request'}</button></div></div></div>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionGate><App/></SessionGate></React.StrictMode>);
