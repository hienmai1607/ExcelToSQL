import {ResizableTable,ColumnResizer,columnWidth} from './column-widths';
import {numberDisplay} from './number-format';
import {PackagingChanges} from './packaging-changes';
import {OpportunityExcel} from './opportunity-excel';
import {RequestEditor} from './request-editor';
import {useSession} from './session';
import {itemTabs,itemTabColumns,type ItemTab} from './opportunity-view';
import {timestamp} from './datetime';
import {useEffect,useState} from 'react';
import {api,date,text,type Page,type Row} from './api';
import {Badge,ErrorNote,Pager} from './ui';
import {IconButton} from './icons';
import {ItemAttachments} from './attachments';
import {useOpportunityView,OpportunityViewTools,ViewHeading,activeFilters,requestFilters} from './opportunity-view';
const empty:Page={rows:[],page:1,total:0};
export function Requests({canAssign,user}:{canAssign:boolean;user:string}){
 const headerView=useOpportunityView('header','requests'),itemView=useOpportunityView('items','requests');
 const session=useSession();
 const [changes,setChanges]=useState<Row|null>(null);
 const [itemTab,setItemTab]=useState<ItemTab>('all'),[editing,setEditing]=useState<Row|null>(null);
 const itemColumns=itemTabColumns(itemView.view,itemTab);
 const canEdit=canAssign||session.is_admin||session.scopes.includes('Packaging');
 const headerSort=JSON.stringify(headerView.view.sort),itemSort=JSON.stringify(itemView.view.sort);
 const visibleFilters=headerView.view.filters??['search','status'];
 const filterKey=JSON.stringify(visibleFilters);
 const [data,setData]=useState<Page>(empty),[page,setPage]=useState(1),[size,setSize]=useState(25),[filters,setFilters]=useState({search:'',status:''}),[reload,setReload]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null);
 const [details,setDetails]=useState<Page>(empty),[itemPage,setItemPage]=useState(1),[itemSize,setItemSize]=useState(200),[detailBusy,setDetailBusy]=useState(false),[detailTick,setDetailTick]=useState(0);
 const [message,setMessage]=useState('');
 useEffect(()=>setPage(1),[headerSort]);
 useEffect(()=>setItemPage(1),[itemSort]);
 useEffect(()=>{const v=JSON.parse(headerView.savedFilters);setFilters({search:v.search||'',status:v.status||''});setPage(1)},[headerView.savedFilters]);
 useEffect(()=>{setFilters(f=>({search:visibleFilters.includes('search')?f.search:'',status:visibleFilters.includes('status')?f.status:''}));setPage(1)},[filterKey]);
 useEffect(()=>{let active=true;setLoading(true);setSelected(null);setError('');api.requests(page,size,filters.search,filters.status,headerSort).then(d=>{if(active)setData(d)}).catch(e=>{if(active){setData(empty);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,size,filters,reload,headerSort]);
 useEffect(()=>{let active=true;if(!selected)return;setDetailBusy(true);setDetails(empty);setError('');api.requestItems(Number(selected.RequestID),itemPage,itemSize,itemSort).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setDetailBusy(false)});return()=>{active=false}},[selected,itemPage,itemSize,detailTick,itemSort]);
 return <div className="customers-page opportunity-page">
 <div className="customer-heading"><h1>Packaging requests</h1></div>
 <OpportunityViewTools control={headerView}><IconButton icon="refresh" label="Refresh Packaging requests" disabled={loading} onClick={()=>{setPage(1);setReload(n=>n+1)}}/><OpportunityExcel entity="packaging" header={headerView.view} items={itemView.view} page={page} pageSize={size} filters={filters} disabled={loading} onMessage={setMessage} onError={setError}/></OpportunityViewTools>
 <ErrorNote value={error}/>{message&&<div className="notice success" role="status">{message}</div>}
 {visibleFilters.length>0&&<form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);const v=activeFilters(headerView.view);setFilters({search:v.search||'',status:v.status||''})}}>
 {visibleFilters.map(f=><label key={f}>{requestFilters[f]}{f==='status'?<select aria-label="Status" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}><option value="">All statuses</option>{['Open','Completed','Canceled'].map(x=><option key={x}>{x}</option>)}</select>:<input aria-label={requestFilters[f]} maxLength={200} placeholder="Starts with…" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}/>}</label>)}
 <button className="primary" disabled={loading}>Apply filters</button><button type="button" disabled={loading} onClick={()=>{headerView.setView(v=>({...v,values:{}}));setFilters({search:'',status:''});setPage(1)}}>Clear filters</button></form>}
 <section className="panel"><div className="table-wrap"><ResizableTable aria-label="Packaging requests" disabled={!headerView.canSave} columns={headerView.view.columns} widths={headerView.view.column_widths} trailing={[columnWidth(headerView.view.column_widths,'_Actions')]} onResize={(key,width)=>headerView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr>{headerView.view.columns.map(c=><ViewHeading key={c} column={c} control={headerView}/>)}<th className="customer-actions"><span className="sr-only">Details</span><ColumnResizer column="_Actions" label="Actions"/></th></tr></thead>
 <tbody>{!loading&&data.rows.map(r=><tr key={String(r.RequestID)} className={selected?.RequestID===r.RequestID?'selected':''}>{headerView.view.columns.map(c=><td key={c}>{c==='RequestNumber'?<button className="link opportunity-link"  onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}>{text(numberDisplay(c,r[c]))}</button>:c==='RequestStatus'?<Badge value={r[c]}/>:c==='RequestedAt'?text(timestamp(r[c])):c==='ResponseDue'?date(r[c]):text(numberDisplay(c,r[c]))}</td>)}<td className="customer-actions"><IconButton icon="package" label="View request"  onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}/>{canEdit&&<IconButton icon="edit" label={'Edit request '+r.RequestNumber} onClick={()=>setEditing(r)}/>}</td></tr>)}</tbody></ResizableTable></div>
 {loading?<div className="empty">Loading requests…</div>:!data.rows.length&&<div className="empty">No packaging requests match these filters.</div>}
 <Pager page={page} size={size} total={data.total} busy={loading} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="requests"/></section>
 {selected&&<section className="detail request-items">
 <OpportunityViewTools control={itemView} trailing={<div className="item-view-tabs" role="group" aria-label="Request item field groups">{(Object.keys(itemTabs) as ItemTab[]).map(tab=><button key={tab} aria-pressed={itemTab===tab} onClick={()=>setItemTab(tab)}>{itemTabs[tab]}</button>)}</div>}><IconButton icon="close" label="Close request details"  onClick={()=>setSelected(null)}/><IconButton icon="history" label="Packaging Request change log" onClick={()=>setChanges(selected)}/><IconButton icon="refresh" label="Refresh items" disabled={detailBusy} onClick={()=>setDetailTick(n=>n+1)}/></OpportunityViewTools>
 {details.rows[0]?.SnapshotOrigin&&<div className="notice">{details.rows[0].SnapshotOrigin==='Migration'?'Migration-time snapshot — original submission values are unavailable for the added fields.':'Request-time snapshot'} · {timestamp(details.rows[0].SnapshotCapturedAt)}{details.rows[0].SourceCurrencyCode&&<> · {text(details.rows[0].SourceCurrencyCode)} / VND: {text(details.rows[0].SourceExchangeRateToVND)}</>}</div>}
 {details.rows[0]?.RequestNotes&&<div className="notice"><strong>Request notes</strong><p>{text(details.rows[0].RequestNotes)}</p></div>}
 <div className="panel"><div className="table-wrap"><ResizableTable aria-label="Packaging request items" disabled={!itemView.canSave} columns={itemColumns} widths={itemView.view.column_widths} trailing={[columnWidth(itemView.view.column_widths,'_Documents')]} onResize={(key,width)=>itemView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:width}}))}><thead><tr>{itemColumns.map(c=><ViewHeading key={c} column={c} control={itemView}/>)}<th>Documents<ColumnResizer column="_Documents" label="Documents"/></th></tr></thead>
 <tbody>{details.rows.map(r=><tr key={String(r.ItemID)}>{itemColumns.map(c=><td key={c}>{c==='ItemStage'?<Badge value={r[c]}/>:text(numberDisplay(c,r[c]))}</td>)}<td className="customer-actions"><ItemAttachments item={r} user={user} canUpload={false}/></td></tr>)}</tbody></ResizableTable></div>
 {detailBusy?<div className="empty">Loading request items…</div>:!details.rows.length&&<div className="empty">No items available.</div>}
 <Pager page={itemPage} size={itemSize} total={details.total} busy={detailBusy} onPage={setItemPage} onSize={n=>{setItemSize(n);setItemPage(1)}} unit="items"/></div></section>}
 {changes&&<PackagingChanges id={Number(changes.RequestID)} number={String(changes.RequestNumber)} onClose={()=>setChanges(null)}/>}
 {editing&&<RequestEditor request={editing} canAssign={canAssign} user={user} onSaved={()=>setDetailTick(n=>n+1)} onClose={()=>{setEditing(null);setReload(n=>n+1)}}/>}
 </div>;
}
