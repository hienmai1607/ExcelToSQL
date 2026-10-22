import {ResizableTable,ColumnResizer,columnWidth} from './column-widths';
import {timestamp} from './datetime';
import {useEffect,useRef,useState} from 'react';
import {api,ApiError,call,date,text,type Row,type Page} from './api';
import {Badge,ErrorNote,Modal,Pager,PageSizeSetting,LayoutPanel,ColumnOrder,Notification,InfoTip} from './ui';
import './customers.css';
import {BusinessDelete} from './business-delete';
import {IconButton} from './icons';
import {CustomerCreate} from './customer-create';
import {SortPanel,defaultSort} from './customer-sort';
import {useProfile,columnLabels,defaults,exportCustomerView,type Column,type Filter,type SortRule} from './profile';

type Lookups={markets:Row[];currencies:Row[];creators?:Row[]};
const lookupLabel=(row:Row,kind:"Market"|"Currency")=>String(row[kind+"Code"])+(row[kind+"Name"]?" — "+row[kind+"Name"]:"");
const filterLabels={customer_name:"Customer name",market_id:"Market",currency_id:"Currency",created_by:"Created by",status:"Status"};
const initial=(r:Row|null)=>({name:String(r?.CustomerName||''),market:String(r?.MarketID||''),currency:String(r?.CurrencyID||''),status:String(r?.Status||'Active')});
export function Customers({canWrite=true}:{canWrite?:boolean}){
 const {profile,ready,saving:profileSaving,save:saveProfile,reload:reloadProfile}=useProfile();
 const savedView=JSON.stringify({...profile.settings,dark:false,nav_hidden:false});
 const [sort,setSort]=useState<SortRule[]>(defaultSort),[sortOpen,setSortOpen]=useState(false);
 function applySort(next:SortRule[]){setSort(next);setPage(1)}
 function headerSort(column:Column,append:boolean){const existing=sort.find(r=>r.column===column);const rule:SortRule={column,direction:existing?.direction==='asc'?'desc':'asc'};applySort(append?(existing?sort.map(r=>r.column===column?rule:r):[...sort,rule]):[rule])}
 const [actionError,setActionError]=useState('');
 const [widths,setWidths]=useState<Record<string,number>>({});
 const [columns,setColumns]=useState<Column[]>(defaults.columns),[visibleFilters,setVisibleFilters]=useState<Filter[]>(defaults.filters),[layout,setLayout]=useState(false),[exporting,setExporting]=useState(false);
 useEffect(()=>{if(!ready)return;const s=profile.settings;setWidths(s.column_widths||{});setSort(s.sort||defaultSort);setColumns([...new Set(s.columns)]);setVisibleFilters([...new Set(s.filters)]);setSearch(s.customer_name);setMarket(s.market_id);setStatus(s.status);setCurrency(s.currency_id||'');setCreator(s.created_by||'');setFilters({customer_name:s.customer_name,market_id:s.market_id,status:s.status,currency_id:s.currency_id||'',created_by:s.created_by||''});setSize(s.page_size);setPage(1)},[ready,savedView]);
 function toggleFilter(key:Filter){setVisibleFilters(x=>x.includes(key)?x.filter(k=>k!==key):[...x,key]);if(visibleFilters.includes(key)){if(key==='customer_name')setSearch('');if(key==='market_id')setMarket('');if(key==='status')setStatus('');if(key==='currency_id')setCurrency('');if(key==='created_by')setCreator('');setFilters(x=>({...x,[key]:''}));setPage(1)}}
 async function persist(){setActionError('');try{await saveProfile({...profile.settings,column_widths:widths,sort,columns,filters:visibleFilters,customer_name:visibleFilters.includes('customer_name')?search.trim():'',market_id:visibleFilters.includes('market_id')?market:'',status:visibleFilters.includes('status')?status:'',currency_id:visibleFilters.includes('currency_id')?currency:'',created_by:visibleFilters.includes('created_by')?creator:'',page_size:size});setNotice('Layout and filters saved to your profile.')}catch(e){setNotice('');setActionError(e instanceof Error?e.message:'Profile save failed.')}}
 const value=(row:Row,key:Column)=>(key==='UpdatedAt'||key==='CreatedAt')?timestamp(row[key]):row[key]===null||row[key]===undefined?null:String(row[key]);
 async function exportView(){setExporting(true);setActionError('');try{await exportCustomerView(columns,data.rows.map(r=>columns.map(c=>value(r,c))));setNotice('Read-only Excel template downloaded: current page and visible columns.')}catch(e){setActionError(e instanceof Error?e.message:'Export failed.')}finally{setExporting(false)}}
 const [data,setData]=useState<Page>({rows:[],total:0,page:1}),[lookups,setLookups]=useState<Lookups>({markets:[],currencies:[]});
 const [page,setPage]=useState(1),[size,setSize]=useState(25),[revision,setRevision]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(''),[lookupError,setLookupError]=useState('');
 const [currency,setCurrency]=useState(''),[creator,setCreator]=useState('');
 const [search,setSearch]=useState(''),[market,setMarket]=useState(''),[status,setStatus]=useState(''),[filters,setFilters]=useState<Record<string,string>>({});
 const [editing,setEditing]=useState<{row:Row|null}|null>(null),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;setLookupError('');api.customerLookups().then(x=>{if(active)setLookups(x)}).catch(e=>{if(active)setLookupError(e.message)});return()=>{active=false}},[revision]);
 useEffect(()=>{let active=true;setBusy(true);setError('');api.customers(page,size,{...filters,sort:JSON.stringify(sort)}).then(x=>{if(active){setData(x);if(page>1&&!x.rows.length)setPage(Math.max(1,Math.ceil(x.total/size)))}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false}},[page,size,filters,revision,sort]);
 return <section className="customers-page">
 <div className="page-heading customer-heading"><h1>Customers</h1></div>
 <div className="view-toolbar" role="toolbar" aria-label="Customer tasks"><IconButton icon="refresh" label="Refresh" disabled={busy} onClick={()=>setRevision(x=>x+1)}/><IconButton icon="sort" label="Sort options" aria-expanded={sortOpen} onClick={()=>setSortOpen(x=>!x)}/><IconButton icon="layout" label="Layout options" aria-expanded={layout} onClick={()=>setLayout(x=>!x)}/><IconButton icon="export" label="Excel local template" disabled={busy||!!error||!data.rows.length||exporting} onClick={exportView}/></div>
 {sortOpen&&<SortPanel rules={sort} onChange={applySort} onClose={()=>setSortOpen(false)}/>}

 {layout&&<LayoutPanel className="layout-panel" aria-label="Customer layout"><h2>Your Customer layout<InfoTip text="Choose the columns and filters you use. Save to keep them with your signed-in profile."/></h2><PageSizeSetting value={size} onChange={n=>{setSize(n);setPage(1)}}/><div className="layout-options"><fieldset><legend>Visible columns</legend>{Object.entries(columnLabels).sort(([,a],[,b])=>a.localeCompare(b,'en',{sensitivity:'base'})).map(([key,label])=><label key={key}><input type="checkbox" checked={columns.includes(key as Column)} disabled={columns.length===1&&columns.includes(key as Column)} onChange={()=>setColumns(x=>x.includes(key as Column)?x.filter(c=>c!==key):[...x,key as Column])}/>{label}</label>)}</fieldset><fieldset><legend>Column order</legend><ColumnOrder columns={columns} labels={columnLabels} onChange={setColumns}/></fieldset><fieldset><legend>Visible filters<InfoTip text="Hiding a filter clears its value. Saved filter values are applied when you return."/></legend>{(['customer_name','market_id','currency_id','created_by','status'] as Filter[]).map(key=><label key={key}><input type="checkbox" checked={visibleFilters.includes(key)} onChange={()=>toggleFilter(key)}/>{filterLabels[key]}</label>)}</fieldset></div><div className="actions"><button onClick={()=>{setWidths({});setSort(defaultSort);setColumns(defaults.columns);setVisibleFilters(defaults.filters);setSearch('');setMarket('');setStatus('');setCurrency('');setCreator('');setFilters({});setSize(25);setPage(1)}}>Reset layout</button><button disabled={profileSaving} onClick={reloadProfile}>Reload profile</button><button className="primary" disabled={!ready||profileSaving} onClick={persist}>{profileSaving?'Saving…':'Save layout to profile'}</button><button onClick={()=>setLayout(false)}>Hide layout</button></div></LayoutPanel>}
 <Notification value={notice} onDismiss={()=>setNotice('')}/>
 <form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);setFilters({customer_name:search.trim(),market_id:market,status,currency_id:currency,created_by:creator})}}>
 {visibleFilters.includes('customer_name')&&<label>Customer name<input placeholder="Starts with a name…" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
 {visibleFilters.includes('market_id')&&<label>Market<select value={market} onChange={e=>setMarket(e.target.value)}><option value="">All markets</option>{lookups.markets.map(r=><option key={String(r.ID)} value={String(r.ID)}>{lookupLabel(r,"Market")}</option>)}</select></label>}
 {visibleFilters.includes('status')&&<label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option><option>Active</option><option>Block</option></select></label>}
 {visibleFilters.includes('currency_id')&&<label>Currency<select aria-label="Currency" value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">All currencies</option>{lookups.currencies.map(r=><option key={String(r.ID)} value={String(r.ID)}>{lookupLabel(r,"Currency")}</option>)}</select></label>}
 {visibleFilters.includes('created_by')&&<label>Created by<select aria-label="Created by" value={creator} onChange={e=>setCreator(e.target.value)}><option value="">All creators</option>{(lookups.creators||[]).map(r=><option key={String(r.ID)} value={String(r.ID)}>{text(r.UserName)}</option>)}</select></label>}
 <button className="primary" type="submit" disabled={busy}>Search</button><button type="button" onClick={()=>{setSearch('');setMarket('');setStatus('');setCurrency('');setCreator('');setFilters({});setPage(1)}}>Clear</button></form>
 <ErrorNote value={actionError||error||lookupError}/>
 <div className="panel" aria-label="Customers" aria-busy={busy}>
 <div className="table-wrap"><ResizableTable pinFirstColumn disabled={!ready||profileSaving} columns={columns} widths={widths} leading={[columnWidth(widths,'_Actions')]} onResize={(key,width)=>setWidths(v=>({...v,[key]:width}))}><thead><tr><th className="customer-actions record-id-column">Customer ID<ColumnResizer column="_Actions" label="Actions"/><IconButton icon="plus" label="New customer" disabled={!canWrite||!!editing||!!lookupError} onClick={()=>setEditing({row:null})}/></th>{columns.map(c=>{const priority=sort.findIndex(r=>r.column===c);return <th key={c} aria-sort={priority===0?(sort[0].direction==='asc'?'ascending':'descending'):'none'}><button className="sort-heading" aria-label={'Sort by '+columnLabels[c]} title="Click to sort; Shift-click to add a sort column" onClick={e=>headerSort(c,e.shiftKey)}>{columnLabels[c]}{priority>=0&&<span aria-hidden="true"> {sort[priority].direction==='asc'?'↑':'↓'}{priority+1}</span>}</button><ColumnResizer column={c} label={columnLabels[c]}/></th>})}</tr></thead><tbody>
 {busy?<tr><td className="empty" colSpan={columns.length+1}>Loading customers…</td></tr>:error?<tr><td className="empty" colSpan={columns.length+1}>Unable to load customers. Please refresh.</td></tr>:!data.rows.length?<tr><td className="empty" colSpan={columns.length+1}><h2>No customers found</h2><p>Try another filter or add a customer.</p></td></tr>:data.rows.map(row=><tr key={String(row.ID)}><td className="customer-actions record-id-column"><button className="record-link" aria-label={(canWrite?'Edit ':'View ')+row.CustomerName} disabled={!!editing} onClick={()=>setEditing({row})}>#{text(row.ID)}</button><BusinessDelete entity="customers" id={row.ID} version={row.RowVersion} label={'customer '+row.CustomerName} allowed={canWrite} disabled={!!editing} onDeleted={()=>setRevision(x=>x+1)}/></td>{columns.map(c=><td key={c}>{c==='Status'?<Badge value={row.Status}/>:c==='CustomerName'?<button className="record-link" disabled={!!editing} onClick={()=>setEditing({row})}>{text(value(row,c))}</button>:text(value(row,c))}</td>)}</tr>)}
 </tbody></ResizableTable></div>
 <Pager page={page} size={size} total={data.total} busy={busy} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="customers"/></div>

 {editing&&!editing.row&&<CustomerCreate lookups={lookups} onClose={()=>setEditing(null)} onSaved={count=>{setNotice(count+' customer(s) created.');setRevision(x=>x+1)}}/>}
 {editing?.row&&<CustomerEditor canWrite={canWrite} row={editing.row} lookups={lookups} lookupError={lookupError} onClose={()=>setEditing(null)} onSaved={(name,action)=>{setNotice(name+' '+action+'.');setRevision(x=>x+1)}}/>}
 </section>
}
export function CustomerEditor({row,lookups,lookupError,onClose,onSaved,canWrite=true,saveEndpoint}:{row:Row|null;lookups:Lookups;lookupError:string;onClose:()=>void;onSaved:(name:string,action:string,record?:Row)=>void;canWrite?:boolean;saveEndpoint?:string}){
 const [fields,setFields]=useState(()=>initial(row)),[errors,setErrors]=useState<Record<string,string>>({}),[error,setError]=useState(''),[confirm,setConfirm]=useState<'save'|'block'|null>(null),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false);
 const lock=useRef(false),dirty=JSON.stringify(fields)!==JSON.stringify(initial(row));
 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(dirty||saving){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)},[dirty,saving]);
 useEffect(()=>{const guard=(e:Event)=>{if(saving||(dirty&&!window.confirm('Discard your unsaved customer changes?')))e.preventDefault()};window.addEventListener('bridge:navigate',guard);return()=>window.removeEventListener('bridge:navigate',guard)},[dirty,saving]);
 function close(){if(!saving&&(!dirty||window.confirm('Discard your unsaved customer changes?')))onClose()}
 function change(key:keyof typeof fields,value:string){setFields(x=>({...x,[key]:value}));setErrors(x=>({...x,[key]:''}))}
 function review(){if(!canWrite)return;const next:Record<string,string>={};if(!fields.name.trim())next.name='Enter a customer name.';if(!lookups.markets.some(x=>String(x.ID)===fields.market))next.market='Choose a valid market.';if(!lookups.currencies.some(x=>String(x.ID)===fields.currency))next.currency='Choose a valid currency.';setErrors(next);if(!Object.keys(next).length)setConfirm('save')}
 async function save(){
  if(!canWrite||lock.current||uncertain)return;lock.current=true;setSaving(true);setError('');
  const action=confirm,name=action==='block'?String(row!.CustomerName):fields.name.trim();
  try{
   const submitted={RowNum:1,Command:action==='block'?'D':row?'U':'C',ID:row?.ID??null,CustomerName:name,MarketID:Number(fields.market),CurrencyID:Number(fields.currency),Status:row?fields.status:null,RowVersion:row?.RowVersion??null};
   const response=saveEndpoint?await call<{results:Row[];row?:Row}>(saveEndpoint,{payload:{rows:[submitted]}}):await api.saveCustomer(submitted);
   const result=response?.results?.[0];
   if(!result){setUncertain(true);throw new Error('No save result received. Check the list before saving again.')}
   if(result.Status!=='OK')throw new Error(String(result.Message||'Could not save.'));
   onSaved(name,action==='block'?'blocked':row?'updated':'created','row' in response?response.row as Row:{...submitted,ID:result.NewID??row?.ID??null});
   onClose();
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Close the form and refresh the list before trying again to avoid duplicates.')}else setError(e instanceof Error?e.message:'Save failed.');setConfirm(null)}
  finally{lock.current=false;setSaving(false)}
 }
 const market=lookups.markets.find(x=>String(x.ID)===fields.market)?.MarketCode,currency=lookups.currencies.find(x=>String(x.ID)===fields.currency)?.CurrencyCode;
 return <Modal label={row?(canWrite?'Edit customer':'View customer'):'New customer'} className="customer-drawer" onClose={close}>
 <div className="customer-editor-heading"><div><span className="eyebrow">{row?'UPDATE RECORD':'CREATE RECORD'}</span><h2>{row?(canWrite?'Edit customer':'View customer'):'New customer'}</h2></div><button aria-label="Close customer form" onClick={close} disabled={saving}>×</button></div>
 <p>{!canWrite?'Display only.':row?'Update account details.':'Add a customer to your directory.'}</p>
 <ErrorNote value={error||lookupError}/>
 {error&&row&&<p>Your entries are kept here. For a version conflict, copy your edits, close this form, refresh, and reopen the latest customer.</p>}
 <form noValidate onSubmit={e=>{e.preventDefault();review()}}><fieldset disabled={!canWrite||saving||uncertain}>
 <label>Customer name *<input aria-label="Customer name *" autoFocus maxLength={200} value={fields.name} onChange={e=>change('name',e.target.value)} aria-required="true" aria-invalid={!!errors.name} aria-describedby="name-error" placeholder="e.g. Northstar Foods"/><span id="name-error" className="field-error">{errors.name}</span></label>
 <div className="customer-form-grid"><label>Market *<select aria-label="Market *" value={fields.market} onChange={e=>change('market',e.target.value)} aria-required="true" aria-invalid={!!errors.market} aria-describedby="market-error"><option value="">Choose market</option>{lookups.markets.map(x=><option key={String(x.ID)} value={String(x.ID)}>{lookupLabel(x,"Market")}</option>)}</select><span id="market-error" className="field-error">{errors.market}</span></label>
 <label>Currency *<select aria-label="Currency *" value={fields.currency} onChange={e=>change('currency',e.target.value)} aria-required="true" aria-invalid={!!errors.currency} aria-describedby="currency-error"><option value="">Choose currency</option>{lookups.currencies.map(x=><option key={String(x.ID)} value={String(x.ID)}>{lookupLabel(x,"Currency")}</option>)}</select><span id="currency-error" className="field-error">{errors.currency}</span></label></div>
 {row?<label>Status<select value={fields.status} onChange={e=>change('status',e.target.value)}><option>Active</option><option>Block</option></select></label>:null}
 </fieldset>{canWrite&&<div className="actions"><button className="primary" type="submit" disabled={saving||uncertain||!!lookupError||(!!row&&!dirty)}>Review & save</button></div>}</form>
 {confirm&&<Modal label="Confirm customer save" onClose={()=>{if(!saving)setConfirm(null)}}><span className="eyebrow">REVIEW YOUR CHANGE</span><h2>{confirm==='block'?'Block customer?':row?'Save customer changes?':'Create customer?'}</h2><p><strong>{confirm==='block'?String(row!.CustomerName):fields.name.trim()}</strong></p><p>{confirm==='block'?'The record will be retained with status Block.':String(market)+' · '+String(currency)+' · '+fields.status}</p><div className="actions"><button disabled={saving} onClick={()=>setConfirm(null)}>Back to form</button><button className="primary" disabled={saving} onClick={save}>{saving?'Saving…':'Confirm '+(confirm==='block'?'block':'save')}</button></div></Modal>}
 </Modal>
}
