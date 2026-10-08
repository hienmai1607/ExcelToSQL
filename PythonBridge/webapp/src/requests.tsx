import {ResizableTable,ColumnResizer,columnWidth} from './column-widths';
import {numberDisplay} from './number-format';
import {PackagingChanges} from './packaging-changes';
import {OpportunityExcel} from './opportunity-excel';
import {RequestEditor} from './request-editor';import {ItemReviewActions} from './item-review-actions';
import {useSession} from './session';
import {useProfile} from './profile';
import {itemTabs,itemTabColumns,type ItemTab} from './opportunity-view';
import {timestamp} from './datetime';
import {useEffect,useRef,useState} from 'react';
import {api,date,text,type Page,type Row} from './api';
import {Badge,ErrorNote,Pager,Notification,InfoTip} from './ui';
import {IconButton} from './icons';
import {useOpportunityView,OpportunityViewTools,ViewHeading,activeFilters,requestFilters} from './opportunity-view';
const empty:Page={rows:[],page:1,total:0};
export function Requests({canAssign,user}:{canAssign:boolean;user:string}){
 const headerView=useOpportunityView('header','requests'),itemView=useOpportunityView('items','requests');
 const session=useSession();
 const {profile}=useProfile();
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width:700px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width:700px)'),update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 const reviewWidth=itemView.view.column_widths?._Documents??360;
 const itemWidths={...itemView.view.column_widths,_Documents:narrow?Math.min(220,reviewWidth):reviewWidth};
 const [changes,setChanges]=useState<Row|null>(null);
 const [itemTab,setItemTab]=useState<ItemTab>('all'),[editing,setEditing]=useState<Row|null>(null),[editorFocus,setEditorFocus]=useState<{page:number;itemID?:number}>({page:1});
 const itemColumns=itemTabColumns(itemView.view,itemTab),headerColumns=headerView.view.columns.filter(c=>c!=='RequestNumber');
 const canEdit=canAssign||session.is_admin||session.scopes.includes('Packaging');
 const headerSort=JSON.stringify(headerView.view.sort),itemSort=JSON.stringify(itemView.view.sort);
 const size=headerView.view.page_size??25,itemSize=itemView.view.page_size??25;
 useEffect(()=>setPage(1),[size]);useEffect(()=>setItemPage(1),[itemSize]);
 const visibleFilters=headerView.view.filters??['search','status'];
 const filterKey=JSON.stringify(visibleFilters);
 const [data,setData]=useState<Page>(empty),[page,setPage]=useState(1),[filters,setFilters]=useState({search:'',status:''}),[reload,setReload]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null);
 const [details,setDetails]=useState<Page>(empty),[itemPage,setItemPage]=useState(1),[detailBusy,setDetailBusy]=useState(false),[detailTick,setDetailTick]=useState(0);
 const [savedDetailTick,setSavedDetailTick]=useState(0),detailQuery=useRef('');
 const [message,setMessage]=useState('');
 const snapshot=details.rows[0];
 const snapshotInfo=snapshot?.SnapshotOrigin?[(snapshot.SnapshotOrigin==='Migration'?'Migration-time snapshot — original submission values are unavailable for the added fields.':'Request-time snapshot'),timestamp(snapshot.SnapshotCapturedAt),snapshot.SourceCurrencyCode?text(snapshot.SourceCurrencyCode)+' / VND: '+text(numberDisplay('SourceExchangeRateToVND',snapshot.SourceExchangeRateToVND)):null].filter(Boolean).join(' · '):'';
 const [pics,setPics]=useState<Row[]>([]);
 useEffect(()=>{let active=true;if(canAssign&&selected)api.pics().then(d=>{if(active)setPics(d.rows)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[canAssign,selected?.RequestID]);
 useEffect(()=>setPage(1),[headerSort]);
 useEffect(()=>setItemPage(1),[itemSort]);
 useEffect(()=>{const v=JSON.parse(headerView.savedFilters);setFilters({search:v.search||'',status:v.status||''});setPage(1)},[headerView.savedFilters]);
 useEffect(()=>{setFilters(f=>({search:visibleFilters.includes('search')?f.search:'',status:visibleFilters.includes('status')?f.status:''}));setPage(1)},[filterKey]);
 useEffect(()=>{let active=true;setLoading(true);setSelected(null);setError('');api.requests(page,size,filters.search,filters.status,headerSort).then(d=>{if(active)setData(d)}).catch(e=>{if(active){setData(empty);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,size,filters,reload,headerSort]);
 useEffect(()=>{
  let active=true;if(!selected){detailQuery.current='';return}
  const query=JSON.stringify([selected.RequestID,itemPage,itemSize,itemSort,detailTick]);
  // A row save refreshes data without unmounting sibling PIC drafts. Explicit
  // refresh and query changes still clear rows, including uncertain outcomes.
  if(detailQuery.current!==query)setDetails(empty);
  detailQuery.current=query;setDetailBusy(true);setError('');
  api.requestItems(Number(selected.RequestID),itemPage,itemSize,itemSort).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setDetailBusy(false)});
  return()=>{active=false};
 },[selected,itemPage,itemSize,detailTick,savedDetailTick,itemSort]);
 return <div className="customers-page opportunity-page">
 <div className="customer-heading"><h1>Packaging requests</h1></div>
 <OpportunityViewTools control={headerView}><IconButton icon="refresh" label="Refresh Packaging requests" disabled={loading} onClick={()=>{setPage(1);setReload(n=>n+1)}}/><OpportunityExcel entity="packaging" header={headerView.view} items={itemView.view} page={page} pageSize={size} filters={filters} disabled={loading} onMessage={setMessage} onError={setError}/></OpportunityViewTools>
 <ErrorNote value={error}/><Notification value={message} onDismiss={()=>setMessage('')}/>
 {visibleFilters.length>0&&<form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);const v=activeFilters(headerView.view);setFilters({search:v.search||'',status:v.status||''})}}>
 {visibleFilters.map(f=><label key={f}>{requestFilters[f]}{f==='status'?<select aria-label="Status" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}><option value="">All statuses</option>{['Open','Completed','Canceled'].map(x=><option key={x}>{x}</option>)}</select>:<input aria-label={requestFilters[f]} maxLength={200} placeholder="Starts with…" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}/>}</label>)}
 <button className="primary" disabled={loading}>Search</button><button type="button" disabled={loading} onClick={()=>{headerView.setView(v=>({...v,values:{}}));setFilters({search:'',status:''});setPage(1)}}>Clear</button></form>}
 <section className="panel"><div className="table-wrap"><ResizableTable pinFirstColumn aria-label="Packaging requests" disabled={!headerView.canSave} columns={headerColumns} widths={headerView.view.column_widths} leading={[columnWidth(headerView.view.column_widths,'RequestNumber')]} onResize={(key,width)=>headerView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr><ViewHeading className="customer-actions record-id-column" column="RequestNumber" control={headerView}/>{headerColumns.map(c=><ViewHeading key={c} column={c} control={headerView}/>)}</tr></thead>
 <tbody>{!loading&&data.rows.map(r=><tr key={String(r.RequestID)} className={selected?.RequestID===r.RequestID?'selected':''}><td className="customer-actions record-id-column"><button className="record-link" aria-label={(canEdit?'Edit request ':'View request ')+r.RequestNumber} onClick={()=>{setEditorFocus({page:1});setEditing(r)}}>{text(r.RequestNumber)}</button></td>{headerColumns.map(c=><td key={c}>{c==='RequestNumber'?<button className="link opportunity-link"  onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}>{text(numberDisplay(c,r[c]))}</button>:c==='ItemCount'?<button className="record-count" aria-label="View request" title={'View items for '+r.RequestNumber} onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}>{text(r.ItemCount??0)} items</button>:c==='RequestStatus'?<Badge value={r[c]}/>:c==='RequestedAt'?text(timestamp(r[c])):c==='ResponseDue'?date(r[c]):text(numberDisplay(c,r[c]))}</td>)}</tr>)}</tbody></ResizableTable></div>
 {loading?<div className="empty">Loading requests…</div>:!data.rows.length&&<div className="empty">No packaging requests match these filters.</div>}
 <Pager page={page} size={size} total={data.total} busy={loading} onPage={setPage} onSize={n=>{headerView.setView(v=>({...v,page_size:n}));setPage(1)}} unit="requests"/></section>
 {selected&&<section className="detail request-items">
 <OpportunityViewTools control={itemView} trailing={<><div className="item-view-tabs" role="group" aria-label="Request item field groups">{(Object.keys(itemTabs) as ItemTab[]).filter(tab=>tab!=='tcb').map(tab=><button key={tab} aria-pressed={itemTab===tab} onClick={()=>setItemTab(tab)}>{itemTabs[tab]}</button>)}</div>{snapshotInfo&&<span className="tab-line-info"><InfoTip text={snapshotInfo}/></span>}</>}><IconButton icon="close" label="Close request details"  onClick={()=>setSelected(null)}/><IconButton icon="history" label="Packaging Request change log" onClick={()=>setChanges(selected)}/><IconButton icon="refresh" label="Refresh items" disabled={detailBusy} onClick={()=>setDetailTick(n=>n+1)}/></OpportunityViewTools>
 {details.rows[0]?.RequestNotes&&<div className="notice"><strong>Request notes</strong><p>{text(details.rows[0].RequestNotes)}</p></div>}
 <div className="panel"><div className="table-wrap"><ResizableTable pinFirstColumn aria-label="Packaging request items" disabled={!itemView.canSave} columns={itemColumns} widths={itemWidths} leading={[columnWidth(itemWidths,'_Documents')]} onResize={(key,width)=>itemView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr><th>Review{!narrow&&<ColumnResizer column="_Documents" label="Review"/>}</th>{itemColumns.map(c=><ViewHeading key={c} column={c} control={itemView}/>)}</tr></thead>
 <tbody>{details.rows.map(r=><tr key={String(r.ItemID)}><td className="customer-actions"><div className="review-document-row"><ItemReviewActions item={r} canAssign={canAssign} user={user} pics={pics} refreshing={detailBusy} onSaved={()=>{setSavedDetailTick(n=>n+1);setMessage('Item updated.')}}/></div></td>{itemColumns.map(c=><td key={c}>{c==='ItemStage'?<Badge value={r[c]}/>:c==='ProductCode'?<button className="record-link" aria-label={'Open response '+r.ProductCode} onClick={()=>{setEditorFocus({page:Math.floor(((itemPage-1)*itemSize+details.rows.indexOf(r))/(profile.settings.requests?.editor_page_size??25))+1,itemID:Number(r.ItemID)});setEditing(selected)}}>{text(r[c])}</button>:text(numberDisplay(c,r[c]))}</td>)}</tr>)}</tbody></ResizableTable></div>
 {detailBusy?<div className="empty">Loading request items…</div>:!details.rows.length&&<div className="empty">No items available.</div>}
 <Pager page={itemPage} size={itemSize} total={details.total} busy={detailBusy} onPage={setItemPage} onSize={n=>{itemView.setView(v=>({...v,page_size:n}));setItemPage(1)}} unit="items"/></div></section>}
 {changes&&<PackagingChanges id={Number(changes.RequestID)} number={String(changes.RequestNumber)} onClose={()=>setChanges(null)}/>}
 {editing&&<RequestEditor request={editing} initialPage={editorFocus.page} focusItemID={editorFocus.itemID} sort={itemSort} canAssign={canAssign} user={user} onSaved={()=>setDetailTick(n=>n+1)} onClose={()=>{setEditing(null);setReload(n=>n+1)}}/>}
 </div>;
}
