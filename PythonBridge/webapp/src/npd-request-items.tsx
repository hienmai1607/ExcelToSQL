import {ResizableTable} from './column-widths';
import {RecipeViewTools,RecipeViewHeading,useRecipeView,recipeActiveFilters,recipeFilters} from './npd-view';
import {useEffect,useRef,useState} from 'react';
import {date,text,type Row} from './api';
import {IconButton} from './icons';
import {Badge,Notification,Pager} from './ui';
import {npd,recipeRequestState,type NPDRow} from './npd-model';

const tabs={all:'All Fields',product:'Product Info',requirements:'Recipe Request',sheets:'Recipe Sheets'};
type ItemTab=keyof typeof tabs;
const fields={ProductName:'Product name',AnnualUnit:'Annual units',WeightGrams:'Net weight (g)',EstimatedAwardedMT:'Estimated awarded MT',LaunchingDate:'Launching date',SpecialComments:'Special comments',Sheet:'Recipe Sheet',Status:'Stage'};
const groups:Record<ItemTab,(keyof typeof fields)[]>={all:['ProductName','AnnualUnit','WeightGrams','EstimatedAwardedMT','LaunchingDate','SpecialComments','Sheet','Status'],product:['ProductName','AnnualUnit','WeightGrams','EstimatedAwardedMT','Status'],requirements:['LaunchingDate','SpecialComments','Status'],sheets:['Sheet','Status']};

export function RecipeRequestItems({request,revision,canReadSheets,allowDraftSheets,canAssign,members,onAssigned,onClose,onOpenItem,onSheet}:{request:NPDRow;revision:number;canAssign:boolean;members:Row[];onAssigned:()=>void;canReadSheets:boolean;allowDraftSheets:boolean;onClose:()=>void;onOpenItem:(item:NPDRow)=>void;onSheet:(id:number)=>void}){
 const itemView=useRecipeView('items'),[filters,setFilters]=useState<Record<string,string>>({});
 useEffect(()=>{setFilters({});setPage(1)},[itemView.filterReset]);
 const size=itemView.view.page_size,sortKey=JSON.stringify(itemView.view.sort),filterKeys=JSON.stringify(itemView.view.filters);
 useEffect(()=>{setFilters(JSON.parse(itemView.savedFilters));setPage(1)},[itemView.savedFilters]);
 useEffect(()=>{setFilters(v=>Object.fromEntries(Object.entries(v).filter(([k])=>itemView.view.filters.includes(k))));setPage(1)},[filterKeys]);
 useEffect(()=>setPage(1),[size,sortKey]);
 const [pics,setPics]=useState<Record<number,string>>({}),[saving,setSaving]=useState<number|null>(null),[assignmentError,setAssignmentError]=useState(''),[notice,setNotice]=useState('');
 const assigning=useRef(false);
 const [items,setItems]=useState<NPDRow[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[tab,setTab]=useState<ItemTab>('all'),[page,setPage]=useState(1);
 useEffect(()=>{
  let active=true;setBusy(true);setError('');setItems([]);
  npd.items(request.ID).then(data=>{if(active){setItems(data.rows);setPage(p=>Math.min(p,Math.max(1,Math.ceil(data.rows.length/size))))}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load Recipe Request items.')}).finally(()=>{if(active)setBusy(false)});
  return()=>{active=false};
 },[request.ID,revision,refresh]);
 async function assign(item:NPDRow){
  const pic=Number(pics[item.ID]??item.PICUserID);if(!canAssign||!recipeRequestState(item).assignable||assigning.current||!members.some(member=>Number(member.ID)===pic)||pic===Number(item.PICUserID))return;
  assigning.current=true;setSaving(item.ID);setAssignmentError('');setNotice('');
  try{
   const result=await npd.save(`request-items/${item.ID}/assign`,{RowVersion:item.RowVersion,PICUserID:pic});
   const name=String(members.find(member=>Number(member.ID)===pic)?.UserName??'');
   setItems(rows=>rows.map(row=>row.ID===item.ID?{...row,...result.row,PIC:name}:row));
   setPics(values=>{const next={...values};delete next[item.ID];return next});setNotice('PIC assigned to '+name+'.');onAssigned();
  }catch(e){setAssignmentError(e instanceof Error?e.message:'Could not assign the PIC.')}
  finally{assigning.current=false;setSaving(null)}
 }
 const columns=itemView.view.columns.filter(key=>key==='Review'||key==='ProductCode'||key==='PIC'||groups[tab].includes(key as keyof typeof fields));
 function sheetLabel(item:NPDRow){const id=Number(allowDraftSheets?item.LatestSheetID:item.ActiveSheetID);return {id,label:id===Number(item.LatestSheetID)?text(item.LatestSheetNumber):id?'Approved sheet #'+id:'\u2014'}}
 const value=(item:NPDRow,key:string)=>key==='Status'?recipeRequestState(item).stage:key==='Sheet'?sheetLabel(item).label:item[key];
 const filtered=items.filter(item=>(!filters.search||[item.ProductCode,item.ProductName,item.SpecialComments].some(v=>String(v??'').toLocaleLowerCase().startsWith(filters.search.toLocaleLowerCase())))&&(!filters.pic||String(item.PIC??'').toLocaleLowerCase().startsWith(filters.pic.toLocaleLowerCase()))&&(!filters.status||recipeRequestState(item).stage===filters.status));
 const numericKeys=new Set(['AnnualUnit','WeightGrams','EstimatedAwardedMT']);
 const sorted=[...filtered].sort((a,b)=>{for(const rule of itemView.view.sort){const x=value(a,rule.column),y=value(b,rule.column);if(x==null&&y==null)continue;if(x==null)return 1;if(y==null)return -1;const delta=numericKeys.has(rule.column)?Number(x)-Number(y):String(x).localeCompare(String(y));if(delta)return rule.direction==='asc'?delta:-delta}return a.ID-b.ID});
 const visible=sorted.slice((page-1)*size,page*size);
 const numeric=(value:unknown)=>value==null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:6});
 function cell(item:NPDRow,key:string){
  if(key==='Status')return <Badge value={recipeRequestState(item).stage}/>;
  if(key==='Sheet'){
   const {id,label}=sheetLabel(item);
   return id&&canReadSheets?<button className="record-link" onClick={()=>onSheet(id)}>{label}</button>:label;
  }
  if(key==='LaunchingDate')return date(item[key]);
  if(['AnnualUnit','WeightGrams','EstimatedAwardedMT'].includes(key))return numeric(item[key]);
  return text(item[key]);
 }
 return <section className="detail request-items npd-request-items" aria-label={'Items for '+request.RequestNumber}>
  <RecipeViewTools control={itemView} trailing={<><div className="item-view-tabs" role="group" aria-label="Recipe Request item field groups">{(Object.keys(tabs) as ItemTab[]).map(key=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{tabs[key]}</button>)}</div><span className="npd-item-reference">{text(request.RequestNumber)}</span></>}><IconButton icon="close" label="Close Recipe Request items" onClick={onClose}/><IconButton icon="refresh" label="Refresh Recipe Request items" disabled={busy} onClick={()=>setRefresh(n=>n+1)}/></RecipeViewTools>
  {itemView.view.filters.length>0&&<form className="filters npd-item-filters" onSubmit={e=>{e.preventDefault();setFilters(recipeActiveFilters(itemView.view));setPage(1)}}>{itemView.view.filters.map(key=><label key={key}>{recipeFilters.items[key as keyof typeof recipeFilters.items]}{key==='status'?<select value={itemView.view.values[key]||''} onChange={e=>itemView.setView(v=>({...v,values:{...v.values,[key]:e.target.value}}))}><option value="">All stages</option>{['Open','Assigned','Submitted','Approved','Returned','Closed'].map(stage=><option key={stage}>{stage}</option>)}</select>:<input placeholder="Starts with..." maxLength={200} value={itemView.view.values[key]||''} onChange={e=>itemView.setView(v=>({...v,values:{...v.values,[key]:e.target.value}}))}/>}</label>)}<button className="primary" disabled={busy}>Search</button><button type="button" onClick={()=>{itemView.setView(v=>({...v,values:{}}));setFilters({});setPage(1)}}>Clear</button></form>}
  <Notification value={notice}/><Notification value={error||assignmentError} error/>
  <div className="panel"><div className="table-wrap"><ResizableTable aria-label="Recipe Request items" columns={columns} widths={{...itemView.view.column_widths,Review:Math.max(360,itemView.view.column_widths?.Review??360)}} disabled={!itemView.canSave} onResize={(key,width)=>itemView.setView(v=>({...v,column_widths:{...v.column_widths,[key]:key==='Review'?Math.max(360,width):width}}))}><thead><tr>{columns.map(key=><RecipeViewHeading key={key} column={key} control={itemView}/>)}</tr></thead><tbody>{busy||error||!visible.length?<tr><td colSpan={columns.length} className="empty">{busy?'Loading request items...':error?'Unable to load items.':'No items available.'}</td></tr>:visible.map(item=><tr key={item.ID}>{columns.map(key=><td key={key} className={key==='SpecialComments'?'npd-item-comments':undefined}>{key==='Review'?<div className="npd-item-review"><Badge value={recipeRequestState(item).stage}/>{!(canAssign&&recipeRequestState(item).assignable)&&<span>PIC: {text(item.PIC)}</span>}{canAssign&&recipeRequestState(item).assignable&&<span className="npd-pic-assignment"><span>PIC:</span><select aria-label={'Assign PIC for '+item.ProductCode} value={pics[item.ID]??String(item.PICUserID??'')} disabled={busy||saving!==null||!members.length} onChange={e=>setPics(values=>({...values,[item.ID]:e.target.value}))}><option value="">Choose NPD member</option>{!!item.PICUserID&&!members.some(member=>Number(member.ID)===Number(item.PICUserID))&&<option value={String(item.PICUserID)} disabled>{text(item.PIC)} (unavailable)</option>}{members.map(member=><option key={String(member.ID)} value={String(member.ID)}>{text(member.UserName)}</option>)}</select><IconButton icon="save" label={'Save PIC for '+item.ProductCode} disabled={busy||saving!==null||!members.some(member=>Number(member.ID)===Number(pics[item.ID]??item.PICUserID))||Number(pics[item.ID]??item.PICUserID)===Number(item.PICUserID)} onClick={()=>void assign(item)}/></span>}{recipeRequestState(item).pending&&canAssign&&canReadSheets&&!!item.LatestSheetID&&<IconButton icon="right" label={'Review Recipe Sheet for '+item.ProductCode} disabled={busy||saving!==null} onClick={()=>onSheet(Number(item.LatestSheetID))}/>} {recipeRequestState(item).stage==='Approved'&&<span>Approved by: {text(item.LatestSheetApprovedByName)}</span>}</div>:key==='ProductCode'?<button className="record-link" aria-label={'Open Recipe Request item '+item.ProductCode} onClick={()=>onOpenItem(item)}>{text(item.ProductCode)}</button>:cell(item,key)}</td>)}</tr>)}</tbody></ResizableTable></div>
   <Pager page={page} size={size} total={filtered.length} busy={busy} onPage={setPage} onSize={n=>{itemView.setView(v=>({...v,page_size:n}));setPage(1)}} unit="items"/>
  </div>
 </section>;
}
