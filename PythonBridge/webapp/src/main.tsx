import {newId} from './id';
import {ResizableTable,ColumnResizer,columnWidth} from './column-widths';
import {opportunityDisplay} from './number-format';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,ApiError,date,text,type Page,type Row,type Session,type RequestPayload} from './api';
import './style.css';
import {Badge,ErrorNote,Pager} from './ui';
import {Customers} from './customers';
import {Requests} from './requests';
import {PackagingMaster} from './packaging-master';
import {SessionGate,useSession} from './session';
import {Icon,IconButton} from './icons';
import {OpportunityCreate} from './opportunity-create';
import {OpportunityExcel} from './opportunity-excel';
import {OpportunityChanges} from './opportunity-changes';
import './opportunities.css';
import {itemTabs,itemTabColumns,type ItemTab,useOpportunityView,OpportunityViewTools,ViewHeading,sortItems,opportunityFilters,defaultFilters,activeFilters} from './opportunity-view';
import './compact.css';
import {ProfileProvider,WorkspaceFrame,AppearanceControls} from './profile';
import {AttachmentQueue,ItemAttachments,stageFiles,bindFiles,discardStaged,type PickedFile} from './attachments';

const empty:Page={rows:[],page:1,total:0};
function App(){
 const session=useSession();
 const [tab,setTab]=useState(()=>session.is_admin||session.scopes.includes('Opportunity')?'opportunities':session.scopes.includes('Customer')?'customers':session.scopes.includes('Product')?'products':'requests');
 const canSales=!!session&&(session.is_admin||session.scopes.includes('Opportunity'));
 const canRequests=!!session&&(session.is_admin||session.scopes.some(x=>['Opportunity','Packaging','PackagingManager'].includes(x)));
 const canProduct=session.is_admin||session.scopes.includes('Product');
 const canCustomer=!!session&&(session.is_admin||session.scopes.includes('Customer'));
 const canMasters=session.is_admin||session.scopes.some(x=>['Packaging','PackagingManager'].includes(x));
 const canMaintain=session.is_admin||session.scopes.includes('Packaging');
 const canAssign=!!session&&(session.is_admin||session.scopes.includes('PackagingManager'));
 return <ProfileProvider key={session?.username||"anonymous"} enabled={!!session}><WorkspaceFrame><aside className="sidebar"><div className="brand"><span className="logo">P</span><div>Presales PL3.0<small>Commercial workspace</small></div></div><div className="nav-label">WORKSPACE</div><nav><button title="Opportunities" aria-label="Opportunities" className={tab==='opportunities'?'active':''} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('opportunities')}} disabled={!canSales}><Icon name="opportunity"/><span className="nav-text">Opportunities</span></button><button title="Packaging requests" aria-label="Packaging requests" className={tab==='requests'?'active':''} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('requests')}} disabled={!canRequests}><Icon name="package"/><span className="nav-text">Packaging requests</span></button><button title="Customers" aria-label="Customers" className={tab==='customers'?'active':''} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('customers')}} disabled={!canCustomer}><Icon name="customer"/><span className="nav-text">Customers</span></button><button title="Products" aria-label="Products" className={tab==='products'?'active':''} disabled={!canProduct} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('products')}}><Icon name="package"/><span className="nav-text">Products</span></button><button title="Packaging Material" aria-label="Packaging Material" className={tab==='materials'?'active':''} disabled={!canMasters} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('materials')}}><Icon name="package"/><span className="nav-text">Packaging Material</span></button><button title="Packaging Material Pricing" aria-label="Packaging Material Pricing" className={tab==='prices'?'active':''} disabled={!canMasters} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('prices')}}><Icon name="price"/><span className="nav-text">Material Pricing</span></button><button title="Vendors" aria-label="Vendors" className={tab==='vendors'?'active':''} disabled={!canMasters} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('vendors')}}><Icon name="customer"/><span className="nav-text">Vendors</span></button>{session.is_admin&&<button title="Units of Measure" aria-label="Units of Measure" className={tab==='uoms'?'active':''} onClick={()=>{if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setTab('uoms')}}><Icon name="package"/><span className="nav-text">Units of Measure</span></button>}</nav><AppearanceControls/><div className="sidebar-note">Sales → Packaging<p>Keep requests connected to the opportunity that started them.</p></div><div className="identity"><span className="avatar">{session?.username.slice(0,1).toUpperCase()||'?'}</span><div>{session?.username||'Connecting…'}<small>{session?.scopes.join(' · ')||'Local workspace'}</small></div></div></aside>
 <main>{!['requests','opportunities','customers','products','materials','prices','vendors','uoms'].includes(tab)&&<header className="topbar"><span>Commercial operations / {tab==='opportunities'?'Sales pipeline':tab==='customers'?'Customer master':'Packaging team'}</span><span className="live"><i/> {session?'Connected to your API':'Connecting to API…'}</span></header>}
 <><AttachmentQueue user={session.username}/>{tab==='opportunities'&&canSales?<Opportunities key={session.username} session={session}/>:tab==='customers'&&canCustomer?<Customers/>:tab==='products'&&canProduct?<PackagingMaster key="products" entity="products" canWrite={canProduct}/>:tab==='uoms'&&session.is_admin?<PackagingMaster key="uoms" entity="uoms" canWrite={true}/>:(tab==='materials'||tab==='prices'||tab==='vendors')&&canMasters?<PackagingMaster key={tab} entity={tab} canWrite={canMaintain}/>:canRequests?<Requests canAssign={canAssign} user={session.username}/>:<p>No workspace access is assigned to this user.</p>}</>
 </main></WorkspaceFrame></ProfileProvider>
}
function Opportunities({session}:{session:Session}){
 const [log,setLog]=useState<{id:number;number:string}|null>(null);
 const [creating,setCreating]=useState(false),[editing,setEditing]=useState<{rows:Row[];focusItem?:number}|null>(null);
 const headerView=useOpportunityView('header'),itemView=useOpportunityView('items');
 const [itemTab,setItemTab]=useState<ItemTab>('all');
 const itemColumns=itemTabColumns(itemView.view,itemTab),showPackaging=itemTab==='packaging';
 const headerSort=JSON.stringify(headerView.view.sort);
 useEffect(()=>setPage(1),[headerSort]);
 const [data,setData]=useState<Page>(empty),[page,setPage]=useState(1),[size,setSize]=useState(25),[loading,setLoading]=useState(false),[error,setError]=useState('');
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
 const header=selected?.[0];const items=sortItems(selected?.filter(x=>x.ItemID!==null&&x.ItemID!==undefined)||[],itemView.view.sort);
 const canCreate=header?.HeaderStage==='Draft';
 function open(rows:Row[]){setSelected(rows);setChecked(new Set());setRequirements({});setFiles({});setNotes('');setDue('');setError('');}
 function prepare(){if(items.some(x=>checked.has(Number(x.ItemID))&&!String(x.PackagingType||'').trim())){setError('Enter Packaging type for each selected item using Edit Opportunity before creating a request.');return}if(!header||!checked.size||!due){setError('Select at least one Draft item and enter a response due date.');return}if(items.some(x=>checked.has(Number(x.ItemID))&&x.HasOpenPackagingRequest)){setError('A selected item already has an active Packaging Request. Refresh Opportunities.');return}setError('');setConfirm(true)}
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
 {log&&<OpportunityChanges id={log.id} number={log.number} onClose={()=>setLog(null)}/>}
 <OpportunityViewTools control={headerView}><IconButton icon="refresh" label="Refresh Opportunities" disabled={loading||saving} onClick={()=>{setPage(1);setReload(n=>n+1)}}/><OpportunityExcel header={headerView.view} items={itemView.view} page={page} pageSize={size} filters={filters} disabled={loading||saving} onMessage={setSuccess} onError={setError}/></OpportunityViewTools>
 {editing&&<OpportunityCreate rows={editing.rows} focusItem={editing.focusItem} onClose={()=>setEditing(null)} onSaved={number=>{setSuccess(number+' updated.');setReload(n=>n+1)}}/>}
 {creating&&<OpportunityCreate onClose={()=>setCreating(false)} onSaved={number=>{setSuccess(number+' created.');setPage(1);setReload(n=>n+1)}}/>}
 {success&&<div className="notice success" role="status">{success}</div>}<ErrorNote value={error}/>
 {pending&&<div className="notice pending"><strong>A request needs confirmation</strong><p>Its last result is uncertain. Retry the same {pending.items.length}-item request to retrieve or complete it safely.</p><button disabled={saving} onClick={()=>create(pending)}>{saving?'Checking…':'Retry saved request'}</button></div>}
 {visibleFilters.length>0&&<form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);setFilters(activeFilters(headerView.view))}}>{visibleFilters.map(f=><label key={f}>{opportunityFilters[f]}{f==='stage'?<select aria-label="Stage" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}><option value="">All stages</option>{['Draft','In progress','Closed','Canceled'].map(x=><option key={x}>{x}</option>)}</select>:<input type={f.startsWith('bid_open_')?'date':'text'} maxLength={f==='opportunity_number'?20:200} value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}/>}</label>)}<button className="primary" disabled={loading||saving}>Apply filters</button><button type="button" disabled={loading||saving} onClick={()=>{headerView.setView(v=>({...v,values:{}}));setFilters({});setPage(1)}}>Clear filters</button></form>}
 <section className="panel"><div className="table-wrap"><ResizableTable aria-label="Opportunity overview" disabled={!headerView.canSave} columns={headerView.view.columns} widths={headerView.view.column_widths} trailing={[columnWidth(headerView.view.column_widths,'_Actions')]} onResize={(key,width)=>headerView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr>{headerView.view.columns.map(c=><ViewHeading key={c} column={c} control={headerView}/>)}<th className="customer-actions"><ColumnResizer column="_Actions" label="Actions"/><IconButton icon="plus" label="New Opportunity" disabled={saving||!!pending} onClick={()=>setCreating(true)}/></th></tr></thead><tbody>{!loading&&groups.map(rows=>{const r=rows[0];return <tr key={String(r.OpportunityID)} className={header?.OpportunityID===r.OpportunityID?'selected':''}>{headerView.view.columns.map(c=><td key={c}>{c==='OpportunityNumber'?<button className="link opportunity-link" disabled={saving} onClick={()=>open(rows)}>{text(opportunityDisplay(r,c))}</button>:c==='HeaderStage'?<Badge value={r[c]}/>:c==='ItemCount'?rows.filter(x=>x.ItemID).length:c==='BidOpen'||c==='BidClose'?date(r[c]):text(opportunityDisplay(r,c))}</td>)}<td className="customer-actions"><IconButton icon="opportunity" label="View details" disabled={saving} onClick={()=>open(rows)}/><IconButton icon="edit" label={'Edit Opportunity '+r.OpportunityNumber} disabled={saving||!!pending||r.HeaderStage!=='Draft'} onClick={()=>setEditing({rows})}/></td></tr>})}</tbody></ResizableTable></div>{!loading&&!groups.length&&<div className="empty">No opportunities match these filters.</div>}<Pager page={page} size={size} total={data.total} busy={loading||saving} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="opportunities"/></section>
 {header&&<section className="detail opportunity-items">
 {!canCreate&&<div className="notice">Packaging requests can only be created from a Draft Opportunity and Draft items.</div>}
 <OpportunityViewTools control={itemView} trailing={<div className="item-view-tabs" role="group" aria-label="Item field groups">{(Object.keys(itemTabs) as ItemTab[]).map(tab=><button key={tab} type="button" aria-pressed={itemTab===tab} onClick={()=>setItemTab(tab)}>{itemTabs[tab]}</button>)}</div>}><IconButton icon="close" label="Close Opportunity details" disabled={saving} onClick={()=>setSelected(null)}/><IconButton icon="history" label="Opportunity change log" onClick={()=>setLog({id:Number(header.OpportunityID),number:String(header.OpportunityNumber)})}/></OpportunityViewTools>
 <div className="panel opportunity-items-box"><div className="table-wrap"><ResizableTable aria-label="Opportunity items" disabled={!itemView.canSave} columns={itemColumns} widths={itemView.view.column_widths} leading={[140]} onResize={(key,width)=>itemView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr><th><span className="sr-only">{showPackaging?'Select':'Packaging status'}</span></th>{itemColumns.map(c=><ViewHeading key={c} column={c} control={itemView}/>)}</tr></thead><tbody>{items.map(item=>{const id=Number(item.ItemID);return <tr key={id}><td>{showPackaging&&<input type="checkbox" aria-label={'Select '+text(item.ProductCode)+' item '+id} disabled={!canCreate||item.ItemStage!=='Draft'||!!item.HasOpenPackagingRequest||saving||!!pending} checked={checked.has(id)} onChange={e=>{const checked=e.currentTarget.checked;setChecked(prev=>{const next=new Set(prev);checked?next.add(id):next.delete(id);return next})}}/>}{!!item.HasOpenPackagingRequest&&<small className="active-packaging-request" title="This item already has an active Packaging Request. Complete or cancel that request item before requesting again.">{text(item.OpenPackagingRequestNumber)} · {text(item.OpenPackagingRequestStage)}</small>}</td>{itemColumns.map(c=><td key={c}>{c==='ItemStage'?<Badge value={item[c]}/>:text(opportunityDisplay(item,c))}</td>)}</tr>})}</tbody></ResizableTable></div></div>
 {showPackaging&&checked.size>0&&<div className="panel opportunity-request-box" role="region" aria-label="Packaging request"><div className="request-form"><label>Response due<input type="date" required disabled={saving||!!pending} min={new Date().toISOString().slice(0,10)} value={due} onChange={e=>setDue(e.target.value)}/></label><label className="grow">Request notes<textarea aria-label="Request notes" rows={2} maxLength={1000} placeholder="Context for the Packaging team" disabled={saving||!!pending} value={notes} onChange={e=>setNotes(e.target.value)}/></label><button className="primary" disabled={!canCreate||!checked.size||!due||saving||!!pending} onClick={prepare}>Create Packaging Request ({checked.size})</button></div></div>}</section>}
 {confirm&&<div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="eyebrow">CONFIRM REQUEST</div><h2 id="create-title">Send {checked.size} items to Packaging?</h2><p>{text(header?.OpportunityNumber)} · Response due {due}</p><p>A new request will contain only the selected items and their current Opportunity information.</p><div className="actions"><button autoFocus disabled={saving} onClick={()=>setConfirm(false)}>Cancel</button><button className="primary" disabled={saving} onClick={()=>create()}>{saving?'Creating…':'Create request'}</button></div></div></div>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionGate><App/></SessionGate></React.StrictMode>);
