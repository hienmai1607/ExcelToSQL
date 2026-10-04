import {useEffect,useState} from 'react';
import {call,text,type Row,type Session} from './api';
import {Modal,ErrorNote,Badge,Pager,FieldLabel,Notification} from './ui';
import {IconButton} from './icons';
import {useListLayout,ListLayoutTools} from './profile';
import {NumericInput,numericEntryError} from './numeric-input';
import {numberDisplay} from './number-format';
import {timestamp} from './datetime';

type Lookups={uoms:Row[];packaging:Row[];raw:Row[];vendors:Row[]};
type Draft={ID?:number;RowVersion?:string;scope:string;material:string;vendor:string;from:string;to:string;factor:string;status:string};
export function UnitConversions({session}:{session:Session}){
 const layout=useListLayout('unit-conversions',50),size=layout.pageSize;
 const [readOnly,setReadOnly]=useState(false);
 useEffect(()=>setPage(1),[size]);
 const admin=session.is_admin,pkg=admin||session.scopes.includes('Packaging'),raw=admin||session.scopes.includes('RawMaterial');
 const [rows,setRows]=useState<Row[]>([]),[more,setMore]=useState(false),[total,setTotal]=useState<number|undefined>(),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[revision,setRevision]=useState(0);
 const [lookups,setLookups]=useState<Lookups>({uoms:[],packaging:[],raw:[],vendors:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[formError,setFormError]=useState(''),[draft,setDraft]=useState<Draft|null>(null);
 useEffect(()=>{let alive=true;setBusy(true);setError('');
 Promise.all([call<{rows:Row[];has_more:boolean;total?:number}>('/api/unit-conversions?page='+page+'&page_size='+size+'&search='+encodeURIComponent(query)),call<Lookups>('/api/unit-conversions/lookups')])
 .then(([data,options])=>{if(alive){setRows(data.rows);setMore(data.has_more);setTotal(data.total??(data.has_more===false&&(page===1||data.rows.length>0)?(page-1)*size+data.rows.length:undefined));setLookups(options)}}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setBusy(false)});
 return()=>{alive=false};
 },[page,size,query,revision]);
 useEffect(()=>{const guard=(e:Event)=>{if(draft&&!readOnly&&(saving||!window.confirm('Discard unsaved conversion changes?')))e.preventDefault()};
 const unload=(e:BeforeUnloadEvent)=>{if(draft&&!readOnly){e.preventDefault();e.returnValue=''}};
 window.addEventListener('bridge:navigate',guard);window.addEventListener('beforeunload',unload);
 return()=>{window.removeEventListener('bridge:navigate',guard);window.removeEventListener('beforeunload',unload)};
 },[draft,saving,readOnly]);
 const canEdit=(r:Row)=>r.PackagingMaterialID?pkg:r.RawMaterialID?raw:admin;
 function edit(r?:Row){setReadOnly(!!r&&!canEdit(r));setFormError('');setUncertain(false);setDraft(r?{ID:Number(r.ID),RowVersion:String(r.RowVersion),scope:r.PackagingMaterialID?'packaging':r.RawMaterialID?'raw':'general',material:String(r.PackagingMaterialID||r.RawMaterialID||''),vendor:String(r.VendorID||''),from:String(r.FromUoMID),to:String(r.ToUoMID),factor:String(r.Factor),status:String(r.Status)}:{scope:admin?'general':pkg?'packaging':'raw',material:'',vendor:'',from:'',to:'',factor:'',status:'Active'})}
 function close(){if(!saving&&(readOnly||window.confirm('Close and discard unsaved conversion changes?')))setDraft(null)}
 function change(key:keyof Draft,value:string){setDraft(d=>d?{...d,[key]:value,...(key==='scope'?{material:'',vendor:''}:{})}:d)}
 async function save(){
 if(!draft||saving||uncertain||readOnly)return;
 if(!draft.from||!draft.to||draft.from===draft.to||!draft.factor||Number(draft.factor)<=0||numericEntryError('Factor',draft.factor)||draft.scope!=='general'&&!draft.material){setFormError('Choose different units, a positive factor (up to 9 decimals), and a material for specific conversions.');return}
 setSaving(true);setFormError('');
 try{await call('/api/unit-conversions',{ID:draft.ID||null,RowVersion:draft.RowVersion||null,FromUoMID:Number(draft.from),ToUoMID:Number(draft.to),Factor:draft.factor,PackagingMaterialID:draft.scope==='packaging'?Number(draft.material):null,RawMaterialID:draft.scope==='raw'?Number(draft.material):null,VendorID:draft.scope==='general'?null:Number(draft.vendor)||null,Status:draft.status});setDraft(null);setRevision(x=>x+1)}
 catch(e){const err=e as Error&{status?:number};if(!err.status||err.status>=500){setUncertain(true);setFormError('Save outcome unknown. Close and refresh before retrying.')}else setFormError(err.message)}
 finally{setSaving(false)}
 }
 return <section className="customers-page conversions-page"><header className="customer-heading"><h1>Unit Conversions</h1></header><div className="view-toolbar">{(admin||pkg||raw)&&<IconButton icon="plus" label="New conversion" onClick={()=>edit()} disabled={busy}/>}<IconButton icon="refresh" label="Refresh" disabled={busy} onClick={()=>setRevision(x=>x+1)}/><ListLayoutTools control={layout}/></div>

 <ErrorNote value={error}/><form className="filters" onSubmit={e=>{e.preventDefault();setQuery(search);setPage(1)}}><label><FieldLabel help="1 From UoM = factor × To UoM. Saving automatically maintains the reverse conversion (1 / factor). General conversions are Admin-managed.">Search units or material code</FieldLabel><input value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/></label><button className="primary" disabled={busy}>Search</button><button type="button" disabled={busy} onClick={()=>{setSearch('' );setQuery('');setPage(1)}}>Clear</button></form>
 <div className="panel"><div className="table-wrap"><table className="pin-first-column" aria-label="Unit conversions"><thead><tr>{['Conversion ID','Scope','Material','Vendor','From UoM','To UoM','Factor','Direction','Status','Updated / Created','User'].map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{!busy&&!error&&rows.map(r=><tr key={String(r.ID)}><td><button className="record-link" aria-label={(canEdit(r)?'Edit':'View')+' conversion '+r.ID} onClick={()=>edit(r)}>#{String(r.ID)}</button></td><td>{r.PackagingMaterialID?'Packaging':r.RawMaterialID?'Raw Material':'General'}</td><td>{text(r.MaterialCode)}</td><td>{r.VendorID?text(r.VendorName):'All vendors'}</td><td>{text(r.FromUoM)}</td><td>{text(r.ToUoM)}</td><td>{numberDisplay('Factor',r.Factor)}</td><td>{r.IsAutoGenerated?'Automatic reverse':'Maintained'}</td><td><Badge value={r.Status}/></td><td>{timestamp(r.UpdatedAt||r.CreatedAt)}</td><td>{text(r.UpdatedByName||r.CreatedByName)}</td></tr>)}{(busy||error||!rows.length)&&<tr><td colSpan={11} className="empty">{busy?'Loading…':error?'Unable to load conversions.':'No conversions found.'}</td></tr>}</tbody></table></div>
 <Pager page={page} size={size} total={total} hasMore={more} busy={busy} onPage={setPage} onSize={n=>{layout.setPageSize(n);setPage(1)}}/></div>
 {draft&&<Modal label={readOnly?'View conversion':draft.ID?'Edit conversion':'New conversion'} onClose={close}><header className="customer-editor-heading"><h2>{readOnly?'View':draft.ID?'Edit':'New'} conversion</h2><IconButton icon="close" label="Close conversion editor" disabled={saving} onClick={close}/></header><ErrorNote value={formError}/><form onSubmit={e=>{e.preventDefault();save()}}><fieldset disabled={saving||uncertain||readOnly} className={'master-fields'+(readOnly?' display-only-fields':'')}>
 <label>Scope<select aria-label="Conversion scope" value={draft.scope} onChange={e=>change('scope',e.target.value)}>{(admin||draft.scope==='general')&&<option value="general">General</option>}{(pkg||draft.scope==='packaging')&&<option value="packaging">Packaging Material</option>}{(raw||draft.scope==='raw')&&<option value="raw">Raw Material</option>}</select></label>
 {draft.scope!=='general'&&<><label>Material *<select required aria-label="Conversion material" value={draft.material} onChange={e=>change('material',e.target.value)}><option value="">Choose material</option>{lookups[draft.scope as 'packaging'|'raw'].map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={r.Status!=='Active'&&String(r.ID)!==draft.material}>{text(r.MaterialCode)} — {text(r.MaterialName)}</option>)}</select></label><label>Vendor<select aria-label="Vendor" value={draft.vendor} onChange={e=>change('vendor',e.target.value)}><option value="">All vendors</option>{lookups.vendors.map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={r.Status!=='Active'&&String(r.ID)!==draft.vendor}>{text(r.VendorName)}</option>)}</select></label></>}
 {(['from','to'] as const).map(key=><label key={key}>{key==='from'?'From UoM':'To UoM'} *<select required aria-label={key==='from'?'From UoM':'To UoM'} value={draft[key]} onChange={e=>change(key,e.target.value)}><option value="">Choose unit</option>{lookups.uoms.map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={r.Status!=='Active'&&String(r.ID)!==draft[key]}>{text(r.UoMCode)}</option>)}</select></label>)}
 <label><FieldLabel help="Price per To UoM = price per From UoM / factor. Saving maintains both directions (reverse factor = 1 / factor), including status and material/vendor scope. Factors apply to current price comparisons, not historical snapshots.">Conversion factor *</FieldLabel><NumericInput required aria-label="Conversion factor" field="Factor" value={draft.factor} onValueChange={v=>change('factor',v)}/></label><label>Status<select aria-label="Status" value={draft.status} onChange={e=>change('status',e.target.value)}><option>Active</option><option>Block</option></select></label>
 </fieldset>{!readOnly&&<div className="actions"><button className="primary" disabled={saving||uncertain}>Save conversion</button></div>}</form></Modal>}
 </section>
}
