import {useEffect,useRef,useState} from 'react';
import {api,date,text,type Page,type Row} from './api';
import {Badge,ErrorNote,Pager,Modal} from './ui';
import {IconButton} from './icons';
import {ItemAttachments} from './attachments';
import {useOpportunityView,OpportunityViewTools,ViewHeading,activeFilters,requestFilters} from './opportunity-view';
const empty:Page={rows:[],page:1,total:0};
const editable=new Set(['Assigned','Working','Returned']);
export function Requests({canAssign,user}:{canAssign:boolean;user:string}){
 const headerView=useOpportunityView('header','requests'),itemView=useOpportunityView('items','requests');
 const headerSort=JSON.stringify(headerView.view.sort),itemSort=JSON.stringify(itemView.view.sort);
 const visibleFilters=headerView.view.filters??['search','status'];
 const filterKey=JSON.stringify(visibleFilters);
 const [data,setData]=useState<Page>(empty),[page,setPage]=useState(1),[size,setSize]=useState(25),[filters,setFilters]=useState({search:'',status:''}),[reload,setReload]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null);
 const [details,setDetails]=useState<Page>(empty),[itemPage,setItemPage]=useState(1),[itemSize,setItemSize]=useState(200),[detailBusy,setDetailBusy]=useState(false),[detailTick,setDetailTick]=useState(0),[pics,setPics]=useState<Row[]>([]);
 const [choices,setChoices]=useState<Record<number,string>>({}),[assigning,setAssigning]=useState<number|null>(null),[confirm,setConfirm]=useState<Row|null>(null),[message,setMessage]=useState('');
 const assigningRef=useRef(false);
 useEffect(()=>setPage(1),[headerSort]);
 useEffect(()=>setItemPage(1),[itemSort]);
 useEffect(()=>{const v=JSON.parse(headerView.savedFilters);setFilters({search:v.search||'',status:v.status||''});setPage(1)},[headerView.savedFilters]);
 useEffect(()=>{setFilters(f=>({search:visibleFilters.includes('search')?f.search:'',status:visibleFilters.includes('status')?f.status:''}));setPage(1)},[filterKey]);
 useEffect(()=>{let active=true;setLoading(true);setSelected(null);setError('');api.requests(page,size,filters.search,filters.status,headerSort).then(d=>{if(active)setData(d)}).catch(e=>{if(active){setData(empty);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[page,size,filters,reload,headerSort]);
 useEffect(()=>{let active=true;if(canAssign)api.pics().then(d=>{if(active)setPics(d.rows)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[canAssign]);
 useEffect(()=>{let active=true;if(!selected)return;setDetailBusy(true);setDetails(empty);setChoices({});setError('');api.requestItems(Number(selected.RequestID),itemPage,itemSize,itemSort).then(d=>{if(active)setDetails(d)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setDetailBusy(false)});return()=>{active=false}},[selected,itemPage,itemSize,detailTick,itemSort]);
 async function assign(){
  if(!confirm||assigningRef.current)return;const item=confirm;const pic=Number(choices[Number(item.ItemID)]);
  assigningRef.current=true;setAssigning(Number(item.ItemID));setError('');
  try{const res=await api.assign(item,pic);setDetails(d=>({...d,rows:d.rows.map(r=>r.ItemID===item.ItemID?{...r,PICUserID:pic,PIC:pics.find(p=>Number(p.ID)===pic)?.UserName||'',ItemRowVersion:res.result.RowVersion}:r)}));setMessage('PIC assigned for '+text(item.ProductCode)+'.');setConfirm(null);setChoices(c=>{const n={...c};delete n[Number(item.ItemID)];return n});setDetailTick(n=>n+1);setData(d=>({...d,rows:d.rows.map(r=>r.RequestID===item.RequestID?{...r,Unassigned:Math.max(0,Number(r.Unassigned)-(item.PICUserID?0:1))}:r)}))}
  catch(e){setError((e as Error).message+' Refresh request items before retrying.');setConfirm(null)}
  finally{assigningRef.current=false;setAssigning(null)}
 }
 return <div className="customers-page opportunity-page">
 <div className="customer-heading"><h1>Packaging requests</h1></div>
 <OpportunityViewTools control={headerView}><IconButton icon="refresh" label="Refresh Packaging requests" disabled={loading||assigning!==null} onClick={()=>{setPage(1);setReload(n=>n+1)}}/></OpportunityViewTools>
 <ErrorNote value={error}/>{message&&<div className="notice success" role="status">{message}</div>}
 {visibleFilters.length>0&&<form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);const v=activeFilters(headerView.view);setFilters({search:v.search||'',status:v.status||''})}}>
 {visibleFilters.map(f=><label key={f}>{requestFilters[f]}{f==='status'?<select aria-label="Status" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}><option value="">All statuses</option>{['Open','Completed','Canceled'].map(x=><option key={x}>{x}</option>)}</select>:<input aria-label={requestFilters[f]} maxLength={200} placeholder="Starts with…" value={headerView.view.values?.[f]||''} onChange={e=>headerView.setView(v=>({...v,values:{...v.values,[f]:e.target.value}}))}/>}</label>)}
 <button className="primary" disabled={loading||assigning!==null}>Apply filters</button><button type="button" disabled={loading||assigning!==null} onClick={()=>{headerView.setView(v=>({...v,values:{}}));setFilters({search:'',status:''});setPage(1)}}>Clear filters</button></form>}
 <section className="panel"><div className="table-wrap"><table aria-label="Packaging requests"><thead><tr>{headerView.view.columns.map(c=><ViewHeading key={c} column={c} control={headerView}/>)}<th><span className="sr-only">Details</span></th></tr></thead>
 <tbody>{!loading&&data.rows.map(r=><tr key={String(r.RequestID)} className={selected?.RequestID===r.RequestID?'selected':''}>{headerView.view.columns.map(c=><td key={c}>{c==='RequestNumber'?<button className="link opportunity-link" disabled={assigning!==null} onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}>{text(r[c])}</button>:c==='RequestStatus'?<Badge value={r[c]}/>:c==='ResponseDue'||c==='RequestedAt'?date(r[c]):text(r[c])}</td>)}<td><IconButton icon="package" label="View request" disabled={assigning!==null} onClick={()=>{setSelected(r);setItemPage(1);setMessage('')}}/></td></tr>)}</tbody></table></div>
 {loading?<div className="empty">Loading requests…</div>:!data.rows.length&&<div className="empty">No packaging requests match these filters.</div>}
 <Pager page={page} size={size} total={data.total} busy={loading||assigning!==null} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="requests"/></section>
 {selected&&<section className="detail request-items">
 <OpportunityViewTools control={itemView}><IconButton icon="close" label="Close request details" disabled={assigning!==null} onClick={()=>setSelected(null)}/><IconButton icon="refresh" label="Refresh items" disabled={detailBusy||assigning!==null} onClick={()=>setDetailTick(n=>n+1)}/></OpportunityViewTools>
 {details.rows[0]?.RequestNotes&&<div className="notice"><strong>Request notes</strong><p>{text(details.rows[0].RequestNotes)}</p></div>}
 {!canAssign&&<div className="notice">PackagingManager or Admin access is required to assign PICs.</div>}
 <div className="panel"><div className="table-wrap"><table aria-label="Packaging request items"><thead><tr>{itemView.view.columns.map(c=><ViewHeading key={c} column={c} control={itemView}/>)}<th>Assign PIC</th><th/><th>Documents</th></tr></thead>
 <tbody>{details.rows.map(r=>{const id=Number(r.ItemID),locked=!editable.has(String(r.ItemStage));return <tr key={id}>{itemView.view.columns.map(c=><td key={c}>{c==='ItemStage'?<Badge value={r[c]}/>:text(r[c])}</td>)}
 <td><select aria-label={'PIC for item '+id} disabled={!canAssign||locked||assigning!==null} value={choices[id]??String(r.PICUserID||'')} onChange={e=>setChoices({...choices,[id]:e.target.value})}><option value="">Choose a person…</option>{r.PICUserID&&!pics.some(p=>p.ID===r.PICUserID)&&<option value={String(r.PICUserID)}>{text(r.PIC)} (unavailable)</option>}{pics.map(p=><option key={String(p.ID)} value={String(p.ID)}>{text(p.UserName)}</option>)}</select></td>
 <td><IconButton icon="save" label="Assign" disabled={!canAssign||locked||!choices[id]||choices[id]===String(r.PICUserID)||assigning!==null} onClick={()=>setConfirm(r)}/></td>
 <td><ItemAttachments item={r} user={user} canUpload={canAssign||r.RequestedByName===user||r.PIC===user}/></td></tr>})}</tbody></table></div>
 {detailBusy?<div className="empty">Loading request items…</div>:!details.rows.length&&<div className="empty">No items available.</div>}
 <Pager page={itemPage} size={itemSize} total={details.total} busy={detailBusy||assigning!==null} onPage={setItemPage} onSize={n=>{setItemSize(n);setItemPage(1)}} unit="items"/></div></section>}
 {confirm&&<Modal label="Confirm PIC assignment" onClose={()=>{if(assigning===null)setConfirm(null)}}><h2>Assign this packaging item?</h2><p>{text(confirm.ProductCode)} → {text(pics.find(p=>Number(p.ID)===Number(choices[Number(confirm.ItemID)]))?.UserName)}</p><div className="actions"><button disabled={assigning!==null} onClick={()=>setConfirm(null)}>Cancel</button><button className="primary" disabled={assigning!==null} onClick={assign}>Confirm assignment</button></div></Modal>}
 </div>;
}
