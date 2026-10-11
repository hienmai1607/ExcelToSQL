import {scrollAddedRecord} from './expand-scroll';
import {NumericInput,numericEntryError} from './numeric-input';
import {palletPreview} from './pallet-calculation';
import {typeOrders,typeLabel} from './packaging-orders';
import {useEffect,useRef,useState} from 'react';
import {call,ApiError,type Row} from './api';
import {Modal,ErrorNote,Badge,FieldLabel,Notification} from './ui';
import {IconButton} from './icons';
import {ProductGrades,type GradeDraft} from './product-grades';
import {masterConfig,lookupLabel,type MasterEntity,type Lookups,type Field} from './master-config';
import {supplierChoices} from './supplier-geometry';
type Entry={key:number;values:Record<string,string>;errors:Record<string,string>;message:string;saved:boolean;grade?:GradeDraft};
function scaled(v:string){const [a,b='']=v.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'))}
export function MasterEditor({entity,row,lookups,onClose,onSaved,readOnly=false}:{entity:MasterEntity;row:Row|null;lookups:Lookups;onClose:()=>void;onSaved:(count:number)=>void;readOnly?:boolean}){
 const config=masterConfig[entity],fields:Field[]=[...config.fields.map(f=>({...f,required:f.key==='Category'?!row:f.required})),...(row?[{key:'Status',label:'Status',kind:'status' as const}]:[])];
 const productWeight=(f:Field)=>f.key==='WeightValue'?(Number(row?.WeightGrams)>999999.9999?(Number(row?.WeightGrams)/28.3495231).toFixed(4):String(row?.WeightGrams??'')):f.key==='WeightUnit'?(Number(row?.WeightGrams)>999999.9999?'oz':'g'):undefined;
 const create=(key:number):Entry=>({key,values:Object.fromEntries(fields.map(f=>[f.key,f.kind==='orders'?(row?typeOrders(row).join(','):''):entity==='products'&&row&&productWeight(f)!==undefined?productWeight(f)!:row?.[f.key]!=null?(f.kind==='date'?String(row[f.key]).slice(0,10):String(row[f.key])):f.initial||''])),errors:{},message:'',saved:false});
 const [entries,setEntries]=useState<Entry[]>(()=>[create(1)]),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[gradeEntry,setGradeEntry]=useState<number|null>(null);
 const serial=useRef(1),lock=useRef(false),initial=useRef(JSON.stringify(entries.map(e=>({values:e.values,grade:e.grade}))));
 const pending=entries.filter(e=>!e.saved),dirty=JSON.stringify(pending.map(e=>({values:e.values,grade:e.grade})))!==initial.current;
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved changes?')))onClose()}
 function materialTypeAllowed(candidate:Row){return candidate.Status==='Active'&&!!candidate.FinalComponent&&!candidate.HasChildren}
 function packagingParentAllowed(candidate:Row){
  if(candidate.FinalComponent)return false;if(candidate.Status!=='Active'&&String(candidate.ID)!==String(row?.ParentTypeID))return false;
  const visited=new Set<number>();let id=Number(candidate.ID);
  while(id){if(id===Number(row?.ID)||visited.has(id))return false;visited.add(id);id=Number(lookups.packagingTypes?.find(t=>Number(t.ID)===id)?.ParentTypeID||0)}
  return true;
 }
 function parentAllowed(candidate:Row){
  if(String(candidate.ID)===String(row?.ParentGradeID))return true;
  if(candidate.Status!=='Active')return false;
  const visited=new Set<number>();let id=Number(candidate.ID);
  while(id){if(id===Number(row?.ID)||visited.has(id))return false;visited.add(id);id=Number(lookups.rawGrades?.find(g=>Number(g.ID)===id)?.ParentGradeID||0)}
  return true;
 }
 function supplierDefinition(entry:Entry){return lookups.supplierDimensions?.find(d=>String(d.ID)===entry.values.SupplierDimensionID)}
 const supplierChanged=entity==='prices'&&row?.SupplierDimensionID!=null&&String(row.SupplierDimensionRowVersion)!==String(lookups.supplierDimensions?.find(d=>Number(d.ID)===Number(row.SupplierDimensionID))?.RowVersion);
 useEffect(()=>{if(supplierChanged&&!readOnly)setEntries(list=>list.map(e=>({...e,values:{...e.values,SupplierD1:'',SupplierD2:'',SupplierD3:''}})))},[supplierChanged,readOnly]);
 function supplierSetup(key:number,field:string,value:string){
  change(key,field,value);
  if(entity!=='prices')return;
  if(field==='MaterialID'||field==='BaseUoM'){
   setEntries(list=>list.map(e=>{if(e.key!==key)return e;
    const choices=supplierChoices(e.values.MaterialID,lookups.materials,lookups.supplierDimensions||[]);
    return {...e,values:{...e.values,SupplierDimensionID:choices.length===1?String(choices[0].ID):'',SupplierD1:'',SupplierD2:'',SupplierD3:''}};
   }));
  }
 }
 function change(key:number,field:string,value:string){setEntries(list=>list.map(e=>e.key===key?{...e,values:{...e.values,[field]:value,...((entity==='prices'||entity==='raw-prices')&&field==='VendorID'?{CurrencyID:String(lookups.vendors?.find(v=>String(v.ID)===value)?.CurrencyID??''),ExchangeRateToUSD:''}:{}),...((entity==='prices'||entity==='raw-prices')&&field==='CurrencyID'?{ExchangeRateToUSD:''}:{})},errors:{...e.errors,[field]:fields.some(f=>f.key===field&&f.kind==='decimal')?numericEntryError(field,value):''},message:''}:e))}
 function review(){
  if(readOnly)return;
  const checked=entries.map(e=>{if(e.saved)return e;const errors:Record<string,string>={};
   for(const f of fields){if((f.kind==='orders'||f.key==='Shipping')&&e.values.ParentTypeID)continue;const value=e.values[f.key]?.trim()||'';
    if(f.required&&!value&&!(entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'))errors[f.key]='Required.';
    else if(value&&f.kind==='decimal'&&value!==create(e.key).values[f.key]&&numericEntryError(f.key,value))errors[f.key]=numericEntryError(f.key,value);
    else if(value&&f.key==='ExchangeRateToUSD'&&Number(value)<=0)errors[f.key]='Use a positive rate.';
    else if(value&&f.kind==='decimal'&&value.split('.')[0].length>(f.key==='ExchangeRateToUSD'?8:14))errors[f.key]='Number is too large.';
    else if(value&&f.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))errors[f.key]='Choose a date.';
    else if(value&&f.kind==='orders'&&(!value.split(',').every(v=>f.options?.includes(v))||new Set(value.split(',')).size!==value.split(',').length))errors[f.key]='Choose one or more distinct orders.';
    else if(value&&f.kind==='category'&&value!==String(row?.Category??'')&&!(lookups.categories||[]).some(c=>c.CategoryName===value&&c.Status==='Active'))errors[f.key]='Choose an active category.'; else if(value&&f.kind==='choice'&&!f.options?.includes(value))errors[f.key]='Choose a valid option.';
    else if(value&&f.kind==='packagingtype'&&!(lookups.packagingTypes||[]).some(t=>String(t.ID)===value&&(f.key==='ParentTypeID'?packagingParentAllowed(t):(materialTypeAllowed(t)||value===String(row?.[f.key]??'')))))errors[f.key]=f.key==='ParentTypeID'?'Choose a valid Parent Type.':'Choose an active Final component Packaging Type with no children.';
    else if(value&&f.kind==='rawgrade'&&!(lookups.rawGrades||[]).some(r=>String(r.ID)===value&&(f.key==='GradeID'?(r.Status==='Active'&&!r.HasChildren):parentAllowed(r))))errors[f.key]=f.key==='GradeID'?'Choose an active grade with no children.':'Choose a valid Parent Grade.';
    else if(value&&f.kind==='uom'&&!(lookups.uoms||[]).some(r=>r.UoMCode===value&&(r.Status==='Active'||value===row?.[f.key])))errors[f.key]='Choose an active unit of measure.';
    else if(value&&(f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor')&&!(f.kind==='vendor'?(lookups.vendors||[]):f.kind==='customer'?(lookups.customers||[]):f.kind==='material'?lookups.materials:lookups.currencies).some(r=>String(r.ID)===value))errors[f.key]='Choose a valid option.';
   }
   if(entity==='pallets'&&e.values.PalletPriceUSDPerEA&&!/^\d{1,17}(\.\d{1,2})?$/.test(e.values.PalletPriceUSDPerEA))errors.PalletPriceUSDPerEA='Use nonnegative USD with up to two decimals.';
   if(entity==='pallets'&&(e.values.Status||'Active')==='Active'){
    const calculation=palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,lookups.uoms?.find(u=>u.UoMCode===e.values.UnitOfMeasure)?.FactorToMM);
    if(calculation.error)errors.UnitOfMeasure=calculation.error;
   }
   if(entity==='products'){
    const v=e.values;
    if(v.IsMix!=='true'&&(!/^\d{1,6}(\.\d{1,4})?$/.test(v.WeightValue)||Number(v.WeightValue)<=0))errors.WeightValue='Use a positive weight with up to 6 whole digits and 3 decimals.';
    else if(v.IsMix!=='true'&&Number(v.WeightValue)*(v.WeightUnit==='oz'?28.3495231:1)<0.005)errors.WeightValue='Weight must round to at least 0.01 g.';
    if(!['g','oz'].includes(v.WeightUnit))errors.WeightUnit='Choose g or oz.';
    if(!row)for(const key of ['ProductName'])if(pending.filter(x=>x.values[key].trim().toLowerCase()===v[key].trim().toLowerCase()).length>1)errors[key]='Duplicate value in this form.';
   }
   if((entity==='prices'||entity==='raw-prices')){const v=e.values;
    if(v.QuantityTo&&!errors.QuantityTo&&!errors.QuantityFrom&&v.QuantityFrom&&scaled(v.QuantityTo)<=scaled(v.QuantityFrom))errors.QuantityTo='Must be greater than quantity from.';
    if(v.EffectiveTo&&v.EffectiveFrom&&v.EffectiveTo<v.EffectiveFrom)errors.EffectiveTo='Must be on or after effective from.';
    if(entity==='prices'){
     const definition=supplierDefinition(e);
     if(v.SupplierDimensionID&&!supplierChoices(v.MaterialID,lookups.materials,lookups.supplierDimensions||[]).some(d=>String(d.ID)===v.SupplierDimensionID))errors.SupplierDimensionID='Choose a child definition for this material.';
     for(const k of ['D1','D2','D3']){
      if(definition&&String(definition.ConvertFromSupplierFormula||'').includes(k)&&!v['Supplier'+k])errors['Supplier'+k]='Required for the supplier conversion formula.';
      if(v['Supplier'+k]&&(!definition||Number(v['Supplier'+k])<=0))errors['Supplier'+k]='Choose a supplier definition and enter a positive measurement.';
     }
    }
   }
   return {...e,errors};
  });setEntries(checked);if(!checked.some(e=>Object.keys(e.errors).length)&&pending.length)setConfirm(true);
 }
 async function save(){
  if(readOnly)return;
  if(lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');
  try{
   const rows=pending.map(e=>{const values:Record<string,unknown>={RowNum:e.key,Command:row?'U':'C',ID:row?.ID??null,RowVersion:row?.RowVersion??null};
    for(const f of fields){if((f.kind==='orders'||f.key==='Shipping')&&e.values.ParentTypeID)continue;const v=e.values[f.key]?.trim()||'';values[f.key]=f.kind==='orders'?v.split(','):f.kind==='boolean'?v==='true':v===''?null:(f.kind==='supplierdimension'||f.kind==='packagingtype'||f.kind==='rawgrade'||f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor'?Number(v):v)}
    if(entity==='packaging-types'&&e.values.ParentTypeID)values.Shipping=false; if(entity==='products'&&e.values.IsMix==='true'){values.WeightValue=0;values.WeightUnit='g'}
    if(entity==='products'&&!row&&e.values.IsMix!=='true'&&e.grade)values.GradeVersion=e.grade;
    if(entity==='prices')values.SupplierDimensionRowVersion=supplierDefinition(e)?.RowVersion??null;
    return values;
   });
   const reply=await call<{results:Row[]}>((entity==='products'?'/api/product/batch':(entity.startsWith('raw-')?'/api/raw-material/':'/api/packaging/')+config.endpoint+'/batch'),{rows});
   const results=reply?.results;
   if(!Array.isArray(results)||results.length!==pending.length||pending.some(e=>results.filter(r=>Number(r.RowNum)===e.key).length!==1)||results.some(r=>!['OK','ERROR'].includes(String(r.Status)))){setUncertain(true);throw new Error('Save outcome unknown. Close and refresh before trying again.')}
   const count=results.filter(r=>r.Status==='OK').length;
   setEntries(list=>list.map(e=>{if(e.saved)return e;const r=results.find(r=>Number(r.RowNum)===e.key)!;return {...e,saved:r.Status==='OK',message:r.Status==='OK'?'Saved':String(r.Message||'Save failed.')};}));
   if(count)onSaved(count);
   if(count===pending.length)onClose();else setError('Some records were not saved. Correct the marked sections. Saved records will not be resubmitted.');
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Close and refresh before trying again.')}else setError(e instanceof Error?e.message:'Save failed.')}
  finally{lock.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label={(readOnly?'View ':row?'Edit ':'New ')+config.singular} className="customer-drawer batch-drawer" onClose={close}>
 <div className="customer-editor-heading"><h2>{readOnly?'View':row?'Edit':'New'} {config.singular}</h2><IconButton icon="close" label="Close form" disabled={busy} onClick={close}/></div>
 <ErrorNote value={error}/>
 {supplierChanged&&<div className="notice">The supplier dimension definition changed. Re-enter measurements using its current names and units before saving this price.</div>}
 <form noValidate onSubmit={e=>{e.preventDefault();if(!readOnly)review()}}><div className="customer-sections">{entries.map((e,index)=><section className={'customer-entry'+(e.saved?' entry-saved':'')} aria-label={'Record '+(index+1)} key={e.key}>
 <header><h3>{row?'Details':'Record '+(index+1)}</h3>{e.saved?<Badge value="Saved"/>:!row&&<IconButton icon="close" label={'Remove record '+(index+1)} disabled={busy||uncertain||pending.length<=1} onClick={()=>setEntries(list=>list.filter(x=>x.key!==e.key))}/>}</header>
 {e.message&&<p className={e.saved?'':'field-error'}>{e.message}</p>}

 {entity==='products'&&!row&&e.values.IsMix!=='true'&&<div className="grade-entry-action"><IconButton icon="grade" label={'Grades for record '+(index+1)} disabled={readOnly||busy||uncertain||e.saved} onClick={()=>setGradeEntry(e.key)}/><span>{e.grade?e.grade.items.length+' grades · '+e.grade.Status:'Grades'}</span></div>}

 {(entity==='materials'||entity==='raw-materials')&&<p>Material code: {row?String(row.MaterialCode):'Assigned on save'}</p>}
 {entity==='products'&&<p>Product code: {row?String(row.ProductCode):'Assigned on save'}</p>}
 {entity==='products'&&e.values.IsMix==='true'&&<p className="mix-help">Net weight is calculated from the active mix. {row?'Open the Grade / Product Mix icon to maintain child Products.':'Save this Product, then open Product Mix to add its children.'}</p>}
 <fieldset className={readOnly||e.saved?"display-only-fields":undefined} disabled={readOnly||busy||uncertain||e.saved}><div className={'master-fields'+(entity==='packaging-types'?' packaging-type-fields':'')}>{fields.filter(f=>!f.key.startsWith('SupplierD')||f.key==='SupplierDimensionID'||!!supplierDefinition(e)?.[f.key.replace('Supplier','')+'Name']||!!e.values[f.key]).filter(f=>!(e.values.ParentTypeID&&(f.kind==='orders'||f.key==='Shipping'))).map(f=><label key={f.key} data-field={f.key}>{f.key.startsWith('SupplierD')&&f.key!=='SupplierDimensionID'?'Supplier '+f.key.replace('Supplier','')+' — '+String(supplierDefinition(e)?.[f.key.replace('Supplier','')+'Name']??f.label)+' ('+String(supplierDefinition(e)?.[f.key.replace('Supplier','')+'Unit']??'')+')':f.label}{f.required&&f.kind!=='orders'?' *':''}
 {f.kind==='category'?<><select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">Choose category</option>{e.values[f.key]&&!(lookups.categories||[]).some(c=>c.CategoryName===e.values[f.key]&&c.Status==='Active')&&<option value={e.values[f.key]} disabled>{e.values[f.key]} (Blocked or unavailable - retained)</option>}{(lookups.categories||[]).filter(c=>c.Status==='Active').map(c=><option key={String(c.ID)} value={String(c.CategoryName)}>{String(c.CategoryName)}</option>)}</select>{!(lookups.categories||[]).some(c=>c.Status==='Active')&&<small>No active categories. Ask an Admin to maintain Category Master.</small>}</>:f.kind==='supplierdimension'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>{change(e.key,f.key,v.target.value);for(const k of ['SupplierD1','SupplierD2','SupplierD3'])change(e.key,k,'')}}><option value="">No supplier conversion dimensions</option>{supplierChoices(e.values.MaterialID,lookups.materials,lookups.supplierDimensions||[]).map(d=><option key={String(d.ID)} value={String(d.ID)}>{String(d.PackagingType)+' · '+String(d.ConvertFromSupplierFormula||'No formula')+' (#'+String(d.ID)+')'}</option>)}</select>:f.kind==='orders'?<span role="group" aria-label="Packaging orders">{(f.options||[]).map(order=><label key={order} className="packaging-order-option"><input type="checkbox" aria-label={order+' order'} checked={e.values[f.key].split(',').includes(order)} onChange={v=>change(e.key,f.key,(f.options||[]).filter(o=>o===order?v.target.checked:e.values[f.key].split(',').includes(o)).join(','))}/>{order}</label>)}</span>:f.kind==='packagingtype'?<select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">{f.key==='ParentTypeID'?'None (root type)':'No packaging type'}</option>{e.values[f.key]&&!(lookups.packagingTypes||[]).some(t=>String(t.ID)===e.values[f.key]&&(f.key==='ParentTypeID'||materialTypeAllowed(t)||String(t.ID)===String(row?.[f.key])))&&<option value={e.values[f.key]} disabled>{String((f.key==='ParentTypeID'?row?.ParentType:row?.PackagingType)||'Unavailable type')}</option>}{(lookups.packagingTypes||[]).filter(t=>(f.key==='ParentTypeID'?! (String(t.ID)===String(row?.ID)):(materialTypeAllowed(t)||String(t.ID)===String(row?.[f.key])))&&(t.Status==='Active'||String(t.ID)===String(row?.[f.key]))).map(t=><option key={String(t.ID)} value={String(t.ID)} disabled={f.key==='ParentTypeID'?!packagingParentAllowed(t):!materialTypeAllowed(t)}>{f.key==='ParentTypeID'?String(t.PackagingType):typeLabel(t)}{t.Status!=='Active'?' (Blocked)':''}</option>)}</select>:f.kind==='choice'?<select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>supplierSetup(e.key,f.key,v.target.value)}><option value="">Choose {f.label.toLowerCase()}</option>{(f.options||[]).map(option=><option key={option} value={option}>{option}</option>)}</select>:f.kind==='rawgrade'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">{f.key==='GradeID'?'No grade':'None (root grade)'}</option>{(lookups.rawGrades||[]).filter(r=>f.key!=='GradeID'||!r.HasChildren).map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={f.key==='GradeID'?(r.Status!=='Active'||!!r.HasChildren):!parentAllowed(r)}>{f.key==='GradeID'&&r.ParentGradeName?String(r.ParentGradeName)+' > ':''}{String(r.GradeName)}{f.key==='GradeID'?' (#'+String(r.ID)+')':''}</option>)}</select>:f.kind==='uom'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">Choose {f.label.toLowerCase()}</option>{(lookups.uoms||[]).map(r=><option key={String(r.ID)} value={String(r.UoMCode)} disabled={r.Status!=='Active'&&r.UoMCode!==row?.[f.key]}>{String(r.UoMCode)}{r.UoMName?' — '+r.UoMName:''}</option>)}</select>:f.kind==='boolean'?<input type="checkbox" aria-label={f.label} checked={e.values[f.key]==='true'} onChange={v=>change(e.key,f.key,String(v.target.checked))}/>:f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor'?<select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>supplierSetup(e.key,f.key,v.target.value)}><option value="">{f.kind==='vendor'?'No vendor':'Choose '+f.label.toLowerCase()}</option>{(f.kind==='vendor'?(lookups.vendors||[]):f.kind==='customer'?(lookups.customers||[]):f.kind==='material'?lookups.materials:lookups.currencies).map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={r.Status==='Block'&&String(row?.[f.key])!==String(r.ID)}>{lookupLabel(r,f.kind as 'material'|'currency'|'customer'|'vendor')}{r.Status==='Block'?' (Blocked)':''}</option>)}</select>:f.kind==='unit'?<select disabled={e.values.IsMix==='true'} aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="g">Grams (g)</option><option value="oz">Ounces (oz)</option></select>:f.kind==='status'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option>Active</option><option>Block</option></select> :f.kind==='decimal'?<NumericInput field={f.key} value={e.values[f.key]} onValueChange={value=>change(e.key,f.key,value)} readOnly={entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'} aria-label={f.label} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key}/>:<input readOnly={entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'} placeholder={e.values.IsMix==='true'&&f.key==='WeightValue'?'Calculated from active mix':undefined} aria-label={f.label} type={f.kind==='date'?'date':'text'} maxLength={f.max} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}/>}
 <span id={f.key+e.key} className="field-error">{e.errors[f.key]}</span></label>)}</div></fieldset>
 {entity==='prices'&&<p className="muted">Supplier dimensions describe exactly 1 {e.values.BaseUoM||'Price UoM'}. Convert from supplier fx returns material units per Price UoM (m² for area pricing). Convert from parent fx uses response calculator measurements.</p>}
 {entity==='pallets'&&(()=>{const preview=palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,lookups.uoms?.find(u=>u.UoMCode===e.values.UnitOfMeasure)?.FactorToMM);return <div className="master-fields"><label>Pallet area (mm²)<input aria-label="Pallet area (mm²)" readOnly value={preview.area} placeholder="Calculated"/></label><label>Pallet size<input aria-label="Pallet size" readOnly value={preview.size} placeholder="Calculated"/></label>{preview.error&&<p className="field-error">{preview.error}</p>}</div>})()}
 </section>)}</div>
 {!readOnly&&!row&&<button className="add-section" type="button" disabled={busy||uncertain||entries.length>=500} onClick={event=>{scrollAddedRecord(event.currentTarget);const entry=create(++serial.current);setEntries(x=>[...x,entry])}}>+ Add record section</button>}
 {!readOnly&&<div className="actions batch-actions"><button className="primary" disabled={busy||uncertain||!pending.length||(!!row&&!dirty)} type="submit">Review & save</button></div>}</form>
 {confirm&&<Modal label="Confirm master save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{row?'Update':'Create'} {pending.length} {pending.length===1?'record':'records'}?</h2><ul className="batch-review">{pending.map(e=><li key={e.key}>{entity==='packaging-types'?(e.values.ParentTypeID?'':e.values.PackagingOrders.split(',').join(', ')+' / ')+e.values.PackagingType:entity==='pallets'?palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,null).size:entity==='raw-grades'?e.values.GradeName:entity==='uoms'?e.values.UoMCode:entity==='vendors'?e.values.VendorName:entity==='products'?e.values.ProductName:(entity==='materials'||entity==='raw-materials')?e.values.MaterialName:lookupLabel(lookups.materials.find(r=>String(r.ID)===e.values.MaterialID)!,'material')+' · '+e.values.BaseUoM+' · '+e.values.UnitPrice}</li>)}</ul><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving…':'Confirm save'}</button></div></Modal>}
 {gradeEntry!==null&&<ProductGrades initial={entries.find(e=>e.key===gradeEntry)?.grade} onClose={()=>setGradeEntry(null)} onApply={grade=>setEntries(all=>all.map(e=>e.key===gradeEntry?{...e,grade}:e))}/>}
 </Modal>
}
