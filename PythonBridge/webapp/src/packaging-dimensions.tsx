import {useEffect,useRef,useState} from 'react';
import {call,text,type Row,type Page} from './api';
import {Modal,ErrorNote,Badge,Pager,FieldLabel,InfoTip,Notification} from './ui';
import {IconButton} from './icons';
import {typeLabel} from './packaging-orders';
import {ResizableTable} from './column-widths';
import {useListLayout,ListLayoutTools} from './profile';
import {decimalDisplay} from './number-format';
import './packaging-dimensions.css';

type Options={uoms:Row[];packagingTypes:Row[];parentDimensions?:Row[]};
type Draft=Record<string,string>;
type Calculation={Value:string|null;CalculationStatus:string;OutputUnit:string};
const dimensions=['D1','D2','D3'];
const formulaRoles=['OccupiedM2Formula','OccupiedM3Formula','ConvertFromParentFormula','ConvertFromSupplierFormula'] as const;
const formulaLabels:Record<string,string>={OccupiedM2Formula:'Occupied m² fx',OccupiedM3Formula:'Occupied m³ fx',ConvertFromParentFormula:'Convert from parent fx',ConvertFromSupplierFormula:'Convert from supplier fx'};
const formulaHelp:Record<string,string>={OccupiedM2Formula:'Footprint of one Shipping parent, in m². Used for Pallet Utilization; not material cut area.',OccupiedM3Formula:'External volume of one Shipping parent, in m³. Used for Carton Efficiency.',ConvertFromParentFormula:'Material required per child occurrence, using parent D1–D3. Do not include child quantity N. Results use the shared Formula output UoM; pricing converts to m² for area pricing or the Material base unit for Count.',ConvertFromSupplierFormula:'Material supplied per ONE vendor Price UoM, using supplier D1–D3 in Packaging Material Pricing. Output the same unit as Convert from parent. No parent formula is inherited.'};
const columns=['PackagingType','D1','D1Unit','D2','D2Unit','D3','D3Unit',...formulaRoles,'ConversionOutputUnit','Status'];
const labels=['Packaging Type','D1','D1 Unit','D2','D2 Unit','D3','D3 Unit',...formulaRoles.map(k=>formulaLabels[k]),'Formula output UoM','Status'];
const widths=Object.fromEntries(columns.map((c,i)=>[c,i===0?180:formulaRoles.includes(c as typeof formulaRoles[number])?300:c==='Status'?100:i%2===0?90:130]));
const inputs=['PackagingTypeID','ParentDimensionID','ParentDimensionRowVersion',...dimensions,...dimensions.map(n=>n+'UoMID'),'ConversionOutputUoMID',...formulaRoles];
const positive=/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/;
function visibleRoles(child:boolean,shipping:boolean){return child?formulaRoles.slice(2):shipping?formulaRoles.slice(0,2):[]}
function payload(draft:Draft,child:boolean,shipping=false,areaRequired=false,outputRequired=true){
 if(!draft.PackagingTypeID||!draft.D1?.trim()||!draft.D1UoMID)throw new Error('Choose Packaging Type, D1 name and unit.');
 if(areaRequired&&!draft.ConvertFromParentFormula?.trim())throw new Error('Enter Convert from parent fx.');
 if(shipping&&dimensions.some(key=>!draft[key]?.trim()||!draft[key+'UoMID']))throw new Error('Shipping types require D1, D2 and D3 names and units.');
 for(const key of dimensions)if(!!draft[key]?.trim()!==!!draft[key+'UoMID'])throw new Error(key+' needs both a name and a unit, or both must be blank.');
 if(child&&outputRequired&&(draft.Status||'Active')==='Active'&&formulaRoles.slice(2).some(k=>draft[k]?.trim())&&!draft.ConversionOutputUoMID)throw new Error('Choose the shared Formula output UoM for both conversion formulas.'); const roles=visibleRoles(child,shipping);
 for(const role of roles.filter(k=>k!=='ConvertFromParentFormula'))for(const match of (draft[role]||'').matchAll(/D[123]/g))if(!draft[match[0]]?.trim())throw new Error('Define a name and unit for '+match[0]+' used in the formula.');
 return Object.fromEntries(inputs.map(key=>[key,key==='ConversionOutputUoMID'&&!child?null:formulaRoles.includes(key as typeof formulaRoles[number])&&!roles.includes(key as typeof formulaRoles[number])?null:key.endsWith('ID')?(draft[key]?Number(draft[key]):null):(draft[key]?.trim()||null)]));
}
const areaText=(value:unknown)=>value==null?'':decimalDisplay(value,9)||'';
const eligibleType=(type:Row)=>type.Status==='Active';

export function PackagingDimensions({canWrite}:{canWrite:boolean}){
 const [data,setData]=useState<Page>({rows:[],total:0,page:1}),[options,setOptions]=useState<Options>({uoms:[],packagingTypes:[]});
 const layout=useListLayout('packaging-dimensions'),size=layout.pageSize;
 useEffect(()=>setPage(1),[size]);
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[optionsReady,setOptionsReady]=useState(false);
 const [draft,setDraft]=useState<Draft|null>(null),[original,setOriginal]=useState<Draft|null>(null),[testOnly,setTestOnly]=useState(false),[needsReview,setNeedsReview]=useState(false),[reviewed,setReviewed]=useState(false);
 const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[formError,setFormError]=useState('');
 const [testValues,setTestValues]=useState<Draft>({}),[supplierTestValues,setSupplierTestValues]=useState<Draft>({}),[preview,setPreview]=useState<Record<string,Calculation>|null>(null),[calculating,setCalculating]=useState(false),[testError,setTestError]=useState('');
 const posting=useRef(false),testRevision=useRef(0),testing=useRef(false);
 const selectedType=options.packagingTypes.find(t=>String(t.ID)===draft?.PackagingTypeID);
 const child=selectedType?.ParentTypeID!=null;
 const parents=(options.parentDimensions||[]).filter(d=>Number(d.PackagingTypeID)===Number(selectedType?.RootTypeID??selectedType?.ID)&&(d.Status==='Active'||String(d.ID)===draft?.ParentDimensionID));
 const parentDefinition=parents.find(d=>String(d.ID)===draft?.ParentDimensionID);
 const shipping=!child&&!!selectedType?.Shipping,areaRequired=child&&selectedType?.PriceBasis==='Square meter',roles=visibleRoles(child,shipping),usesArea=roles.length>0;
 const dirty=!testOnly&&!!draft&&(JSON.stringify(draft)!==JSON.stringify(original)||reviewed);
 useEffect(()=>{let alive=true;setBusy(true);setError('');setOptionsReady(false);
  Promise.all([call<Page>('/api/packaging/dimensions?page='+page+'&page_size='+size+'&search='+encodeURIComponent(query)+(status?'&status='+status:'')),call<Options>('/api/packaging/dimensions/lookups')])
   .then(([rows,lookups])=>{if(alive){setData(rows);setOptions(lookups);setOptionsReady(true)}})
   .catch(e=>{if(alive){setError(e.message);setData({rows:[],total:0,page})}})
   .finally(()=>{if(alive)setBusy(false)});
  return()=>{alive=false};
 },[page,size,query,status,revision]);
 useEffect(()=>{const nav=(e:Event)=>{if(saving||(dirty&&!window.confirm('Discard unsaved dimension changes?')))e.preventDefault()};
  const unload=(e:BeforeUnloadEvent)=>{if(dirty||saving){e.preventDefault();e.returnValue=''}};
  window.addEventListener('bridge:navigate',nav);window.addEventListener('beforeunload',unload);
  return()=>{window.removeEventListener('bridge:navigate',nav);window.removeEventListener('beforeunload',unload)};
 },[dirty,saving]);
 useEffect(()=>()=>{testRevision.current++},[]);
 function clearTest(){testRevision.current++;setPreview(null);setTestError('')}
 function edit(row?:Row,viewOnly=false){
  clearTest();setTestValues({});setSupplierTestValues({});setTestOnly(viewOnly);setNeedsReview(!!row?.FormulaNeedsReview||!!row?.OccupiedFormulaNeedsReview);setReviewed(false);
  const values=Object.fromEntries(inputs.map(key=>[key,String(row?.[key]??'')]));
  const next={...values,Status:String(row?.Status??'Active'),...(row?{ID:String(row.ID),RowVersion:String(row.RowVersion)}:{})};
  setDraft(next);setOriginal(next);setFormError('');setUncertain(false);
 }
 function close(){if(!saving&&(!dirty||window.confirm('Discard unsaved dimension changes?'))){clearTest();setDraft(null)}}
 function change(key:string,value:string){
  clearTest();setDraft(d=>{
   if(!d)return d;
   const next={...d,[key]:value,...(dimensions.includes(key)&&!value.trim()?{[key+'UoMID']:''}:{})};
   const type=options.packagingTypes.find(t=>String(t.ID)===next.PackagingTypeID);
   if(key==='PackagingTypeID'||key==='ParentDimensionID'){
    if(key==='PackagingTypeID'){for(const role of formulaRoles)next[role]='';next.ConversionOutputUoMID='';}
    const choices=(options.parentDimensions||[]).filter(p=>Number(p.PackagingTypeID)===Number(type?.RootTypeID)&&p.Status==='Active');
    const parent=key==='ParentDimensionID'?choices.find(p=>String(p.ID)===value):choices.length===1?choices[0]:undefined;
    next.ParentDimensionID=type?.ParentTypeID!=null?String(parent?.ID??''):'';
    next.ParentDimensionRowVersion=type?.ParentTypeID!=null?String(parent?.RowVersion??''):'';
    // Linking parent consumption never overwrites the child's supplier names/units.
    if(type?.Shipping&&!type.ParentTypeID)next.D3='Height';
   }
   return next;
  });setFormError('');
 }
 async function testCalculation(){
  if(!draft||!usesArea||testing.current)return;
  const requests:{role:string;body:Record<string,unknown>}[]=[];
  try{
   const base=payload(draft,child,shipping,false,!testOnly);if(testOnly&&!draft.ConversionOutputUoMID)delete base.ConversionOutputUoMID;
   for(const role of roles){
    if(!draft[role]?.trim())continue;
    const body={...base,...Object.fromEntries(formulaRoles.map(k=>[k,k===role?draft[k].trim():null])),FormulaRole:role};
    const used=new Set(Array.from(draft[role].matchAll(/D[123]/g),m=>m[0]));
    const source=role==='ConvertFromSupplierFormula'?supplierTestValues:testValues;
    for(const key of dimensions){
     const value=source[key]?.trim();
     if(used.has(key)&&(!value||!positive.test(value)||Number(value)<=0||Number(value)>=1e12))throw new Error('Enter a positive '+(role==='ConvertFromSupplierFormula'?'supplier ':'parent ')+'test value for '+key+'.');
     (body as Record<string,unknown>)['Test'+key]=used.has(key)?value:null;
    }
    requests.push({role,body});
   }
   if(!requests.length)throw new Error('Enter a formula before testing.');
  }catch(e){setTestError((e as Error).message);setPreview(null);return}
  const request=++testRevision.current;testing.current=true;setCalculating(true);setPreview(null);setTestError('');
  try{
   const results=await Promise.all(requests.map(async({role,body})=>[role,await call<Calculation>('/api/packaging/dimensions/preview-formula',body)] as const));
   if(request===testRevision.current)setPreview(Object.fromEntries(results));
  }catch(e){if(request===testRevision.current)setTestError((e as Error).message)}
  finally{testing.current=false;setCalculating(false)}
 }
 async function save(){
  if(!draft||posting.current||uncertain||testOnly)return;
  let body:Record<string,unknown>;try{body=payload(draft,child,shipping,areaRequired)}catch(e){setFormError((e as Error).message);return}
  if(child&&!draft.ParentDimensionID){setFormError('Choose a parent dimension definition.');return}
  const type=options.packagingTypes.find(t=>String(t.ID)===draft.PackagingTypeID);
  if((!type||!eligibleType(type))&&!(draft.ID&&draft.Status==='Block'&&draft.PackagingTypeID===original?.PackagingTypeID)){
   setFormError('Choose an active Packaging Type.');return;
  }
  if(needsReview&&!reviewed&&draft.Status==='Active'){setFormError('Review the legacy formula using the selected input units before saving.');return}
  posting.current=true;setSaving(true);setFormError('');
  try{await call('/api/packaging/dimensions',{...body,Status:draft.Status,ID:draft.ID?Number(draft.ID):null,RowVersion:draft.RowVersion||null,FormulaReviewed:reviewed});setDraft(null);setSuccess('Packaging dimension saved.');setRevision(x=>x+1)}
  catch(e){const err=e as Error&{status?:number};if(!err.status||err.status>=500){setUncertain(true);setFormError('Save outcome unknown. Close and refresh before retrying.')}else setFormError(err.message)}
  finally{posting.current=false;setSaving(false)}
 }
 return <section className="customers-page dimension-page"><header className="customer-heading"><h1>Packaging Dimension Master<InfoTip text="D1–D3 define dimension names and units. Use Test Calculation to verify the formula with temporary measurements."/></h1></header>
  <div className="view-toolbar"><ListLayoutTools control={layout}/><IconButton icon="refresh" label="Refresh packaging dimensions" disabled={busy||!!draft} onClick={()=>setRevision(x=>x+1)}/></div>

  <ErrorNote value={error}/><Notification value={success} onDismiss={()=>setSuccess('')}/>
  <form className="filters" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search)}}><label>Search<input value={search} maxLength={200} onChange={e=>setSearch(e.target.value)}/></label><label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All statuses</option><option>Active</option><option>Block</option></select></label><button className="primary" disabled={busy}>Search</button><button type="button" disabled={busy} onClick={()=>{setSearch('');setQuery('');setStatus('');setPage(1)}}>Clear</button></form>
  <div className="panel"><div className="table-wrap"><ResizableTable pinFirstColumn columns={columns} widths={widths} leading={[155]} disabled onResize={()=>{}} aria-label="Packaging dimensions"><thead><tr><th className="customer-actions record-id-column"><span>Dimension ID</span>{canWrite&&<IconButton icon="plus" label="New packaging dimension" disabled={busy||!!draft||!optionsReady} onClick={()=>edit()}/>}</th>{labels.map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>
   {busy||!data.rows.length?<tr><td colSpan={columns.length+1} className="empty">{busy?'Loading…':error?'Unable to load dimensions.':'No dimensions found.'}</td></tr>:data.rows.map(row=><tr key={String(row.ID)}><td><div className="record-reference"><button className="record-link" aria-label={(canWrite?'Edit':'View')+' packaging dimension '+row.ID} disabled={!!draft||!optionsReady} onClick={()=>edit(row,!canWrite)}>#{String(row.ID)}</button></div></td>{columns.map(key=><td key={key} title={String(row[key]??'')}>{key==='Status'?<Badge value={row.Status}/>:<>{text(row[key])}{((key==='OccupiedM2Formula'&&!!row.OccupiedFormulaNeedsReview)||(key==='ConvertFromParentFormula'&&!!row.FormulaNeedsReview))&&<small className="dimension-review-tag">Formula review required</small>}</>}</td>)}</tr>)}
  </tbody></ResizableTable></div><Pager page={page} size={size} total={data.total} busy={busy||!!draft} onPage={setPage} onSize={n=>{layout.setPageSize(n);setPage(1)}}/></div>
  {draft&&<Modal label={testOnly?'View packaging dimension':draft.ID?'Edit packaging dimension':'New packaging dimension'} className="dialog dimension-dialog" onClose={close}><form onSubmit={e=>{e.preventDefault();if(!testOnly)void save()}}>
   <header className="dimension-heading"><h2>{testOnly?'Test packaging dimension':draft.ID?'Edit packaging dimension':'New packaging dimension'}</h2><IconButton icon="close" label="Close dimension editor" disabled={saving} onClick={close}/></header>
   <ErrorNote value={formError}/>
   {draft.PackagingTypeID&&!options.packagingTypes.some(t=>String(t.ID)===draft.PackagingTypeID&&eligibleType(t))&&<div className="notice">The existing Packaging Type is blocked. Choose an active type before saving Active. You can still block this record.</div>}
   {needsReview&&<div className="notice">Review the migrated formulas and output units. The previous parent material-area formula was not copied into occupied footprint. Original formulas and snapshots are preserved.</div>}
   <fieldset disabled={saving||uncertain||testOnly}>
    <div className="dimension-type-row"><label>Packaging Type<select aria-label="Packaging Type" required value={draft.PackagingTypeID} onChange={e=>change('PackagingTypeID',e.target.value)}><option value="">Choose packaging type</option>{options.packagingTypes.filter(t=>eligibleType(t)||String(t.ID)===draft.PackagingTypeID).map(t=><option key={String(t.ID)} value={String(t.ID)} disabled={!eligibleType(t)}>{typeLabel(t,' — ')+(!eligibleType(t)?' (existing - '+text(t.PriceBasis)+(t.Status!=='Active'?', blocked':'')+')':'')}</option>)}</select></label>{draft.ID&&<label>Status<select aria-label="Status" value={draft.Status} onChange={e=>change('Status',e.target.value)}><option>Active</option><option>Block</option></select></label>}</div>
    {child&&<label>Parent dimension definition<select aria-label="Parent dimension definition" required value={draft.ParentDimensionID} onChange={e=>change('ParentDimensionID',e.target.value)}><option value="">Choose parent definition</option>{parents.map(d=><option key={String(d.ID)} value={String(d.ID)}>{String(d.PackagingType)+' · '+dimensions.filter(k=>d[k]).map(k=>String(d[k])).join(' / ')}</option>)}</select><small>This link supplies parent D1–D3 to Convert from parent. Maintain independent child names and units below for Convert from supplier; they are not inherited.</small></label>}
    <div className="dimension-input-grid">{dimensions.map((name,i)=><div key={name}><label>{name+(i&&!shipping?' (optional)':'')}<input aria-label={name} readOnly={shipping&&name==='D3'} required={!i||shipping} maxLength={100} placeholder={['Length','Width','Height / Gusset'][i]} value={draft[name]} onChange={e=>change(name,e.target.value)}/></label><label>{name+' Unit'}<select aria-label={name+' Unit'} required={!!draft[name]?.trim()} disabled={!draft[name]?.trim()} value={draft[name+'UoMID']} onChange={e=>change(name+'UoMID',e.target.value)}><option value="">Choose UoM</option>{options.uoms.filter(u=>u.Status==='Active'||String(u.ID)===draft[name+'UoMID']).map(u=><option key={String(u.ID)} value={String(u.ID)}>{text(u.UoMCode)+(u.UoMName?' — '+u.UoMName:'')+(u.Status!=='Active'?' (blocked)':'')}</option>)}</select></label></div>)}</div>
    {roles.map(role=><div key={role} className={'dimension-formula-row'+(role==='ConvertFromParentFormula'?' with-output-uom':'')}><label><FieldLabel help={formulaHelp[role]}>{formulaLabels[role]}</FieldLabel><input aria-label={formulaLabels[role]} required={role==='ConvertFromParentFormula'&&areaRequired} maxLength={200} placeholder={role==='OccupiedM2Formula'?'D1*D2/1000000':role==='OccupiedM3Formula'?'D1*D2*D3/1000000000':role==='ConvertFromParentFormula'?'(D2*2+25)*D1/1000000':'D1*D2/1000000'} value={draft[role]} onChange={e=>change(role,e.target.value)}/></label>{role==='ConvertFromParentFormula'&&<label><FieldLabel help="One shared output unit for Convert from parent and Convert from supplier. Formula values are in this unit, not the D1-D3 input units. Maintain a unit conversion when the pricing unit differs.">Formula output UoM</FieldLabel><select aria-label="Formula output UoM" required={(draft.Status||'Active')==='Active'&&formulaRoles.slice(2).some(k=>!!draft[k]?.trim())} value={draft.ConversionOutputUoMID} onChange={e=>change('ConversionOutputUoMID',e.target.value)}><option value="">Choose UoM</option>{draft.ConversionOutputUoMID&&!options.uoms.some(u=>String(u.ID)===draft.ConversionOutputUoMID)&&<option value={draft.ConversionOutputUoMID} disabled>Unavailable unit (retained)</option>}{options.uoms.filter(u=>u.Status==='Active'||String(u.ID)===draft.ConversionOutputUoMID).map(u=><option key={String(u.ID)} value={String(u.ID)} disabled={u.Status!=='Active'}>{text(u.UoMCode)+(u.UoMName?' - '+u.UoMName:'')+(u.Status!=='Active'?' (blocked)':'')}</option>)}</select></label>}</div>)}
    {needsReview&&<label className="dimension-review-checkbox"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the formulas and their output units.</label>}
   </fieldset>
   {usesArea&&<details className="dimension-test"  onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();void testCalculation()}}}><summary><FieldLabel help="Temporary measurements only; they are not saved. Supplier and parent measurements are independent.">Test Calculation</FieldLabel></summary>
    <fieldset disabled={saving||calculating||uncertain}>{(child?['parent','supplier']:['parent']).map(source=><section key={source}><h3>{source==='supplier'?'Supplier measurements (one Price UoM)':'Parent measurements'}</h3><div className="dimension-input-grid">{dimensions.filter(name=>(child&&source==='parent'?parentDefinition?.[name]:draft[name])?.toString().trim()).map(name=>{
     const definition=child&&source==='parent'?parentDefinition:draft,unit=options.uoms.find(u=>String(u.ID)===String(definition?.[name+'UoMID'])),values=source==='supplier'?supplierTestValues:testValues;
     return <label key={name}>{name+' — '+String(definition?.[name]??'')+(unit?' ('+unit.UoMCode+')':'')}<input aria-label={(source==='supplier'?'Supplier ':'')+name+' Test value'} inputMode="decimal" maxLength={20} value={values[name]||''} onChange={e=>{clearTest();(source==='supplier'?setSupplierTestValues:setTestValues)(v=>({...v,[name]:e.target.value}))}}/></label>;
    })}</div></section>)}<button type="button" onClick={()=>void testCalculation()}>Test calculation</button></fieldset>
    <ErrorNote value={testError}/>
    {roles.map(role=><div key={role}><ErrorNote value={preview?.[role]?.Value==null?preview?.[role]?.CalculationStatus||'':''}/><label>{formulaLabels[role]+' result'+(preview?.[role]?.OutputUnit?' ('+preview[role].OutputUnit+')':'')}<input aria-label={formulaLabels[role]+' result'} readOnly value={calculating?'Calculating…':areaText(preview?.[role]?.Value)}/></label></div>)}
   </details>}
   {!testOnly&&<div className="actions"><button className="primary" disabled={saving||uncertain||(needsReview&&!reviewed&&draft.Status==='Active')}>Save dimension</button></div>}
  </form></Modal>}
 </section>;
}
