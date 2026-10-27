import {tareBasisLabel,tareMassSelection} from './tare-basis';
import {DateInput} from './date-input';
import {scrollAddedRecord} from './expand-scroll';
import {NumericInput,numericEntryError} from './numeric-input';
import {palletPreview} from './pallet-calculation';
import {typeOrders,typeLabel,parentTypeIDs} from './packaging-orders';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {call,ApiError,type Row} from './api';
import {Modal,ErrorNote,Badge,FieldLabel,Notification} from './ui';
import {IconButton} from './icons';
import {ProductGrades,type GradeDraft} from './product-grades';
import {masterConfig,lookupLabel,type MasterEntity,type Lookups,type Field} from './master-config';
import {useSession} from './session';
import {AddMasterButton,canCreateMaster,type InlineMasterEntity} from './add-master-button';
import {InlineMasterCreate} from './inline-master-create';
import {supplierChoices} from './supplier-geometry';
import {ProductMixDraft,emptyMix,mixChoices,mixWeight,mixError,type MixDraft} from './product-mix-draft';
function MasterFieldControl({enabled,children}:{enabled:boolean;children:ReactNode}){
 return enabled?<span className="master-lookup-control">{children}</span>:<>{children}</>;
}
type Entry={key:number;values:Record<string,string>;errors:Record<string,string>;message:string;saved:boolean;mix?:MixDraft;grade?:GradeDraft};
function scaled(v:string){const [a,b='']=v.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'))}
export function MasterEditor({entity,row,lookups:initialLookups,onClose,onSaved,readOnly=false,initialValues={},normalProductOnly=false,customerLocked=false,lockedFields=[],saveEndpoint}:{saveEndpoint?:string;entity:MasterEntity;row:Row|null;lookups:Lookups;onClose:()=>void;onSaved:(count:number,records?:Row[])=>void;readOnly?:boolean;initialValues?:Record<string,string>;normalProductOnly?:boolean;customerLocked?:boolean;lockedFields?:string[]}){
 const session=useSession(),[lookups,setLookups]=useState(initialLookups);
 type Target={entity:InlineMasterEntity;entryKey:number;field:Field;previousValue:string};
 const [inlineTarget,setInlineTarget]=useState<Target|null>(null),[masterRefresh,setMasterRefresh]=useState(false),[retryMaster,setRetryMaster]=useState<{target:Target;records:Row[]}|null>(null);
 function targetFor(f:Field):InlineMasterEntity|null{
  if(f.kind==='customer'&&(normalProductOnly||customerLocked))return null;
  return ({category:'categories',customer:'customers',material:entity==='raw-prices'?'raw-materials':'materials',vendor:'vendors',packagingtype:'packaging-types',rawgrade:'raw-grades',materialdimension:'packaging-dimensions'} as Partial<Record<NonNullable<Field['kind']>,InlineMasterEntity>>)[f.kind!]||null;
 }
 function canAdd(f:Field){const target=targetFor(f);return !readOnly&&!!target&&target!==entity&&canCreateMaster(session,target)}
 const config=masterConfig[entity],fields:Field[]=[...config.fields.filter(f=>!normalProductOnly||f.key!=='IsMix').map(f=>({...f,required:f.key==='Category'?!row:f.required})),...(entity==='prices'&&!row?[{key:'ResolveOverlap',label:'Resolve overlap automatically',kind:'boolean' as const,initial:'false'}]:[]),...(row?[{key:'Status',label:'Status',kind:'status' as const}]:[])];
 const productWeight=(f:Field)=>f.key==='WeightValue'?(Number(row?.WeightGrams)>999999.9999?(Number(row?.WeightGrams)/28.3495231).toFixed(4):String(row?.WeightGrams??'')):f.key==='WeightUnit'?(Number(row?.WeightGrams)>999999.9999?'oz':'g'):undefined;
 function isUSD(currency:string){return lookups.currencies.find(c=>String(c.ID)===currency)?.CurrencyCode==='USD'}
 function pricingDefaults(values:Record<string,string>){
  if(entity!=='prices'&&entity!=='raw-prices')return values;
  return {...values,BaseUoM:values.BaseUoM||String(lookups.materials.find(m=>String(m.ID)===values.MaterialID)?.UnitOfMeasure??''),...(isUSD(values.CurrencyID)?{ExchangeRateToUSD:'1'}:{})};
 }
 const create=(key:number):Entry=>({key,values:pricingDefaults(Object.fromEntries(fields.map(f=>[f.key,f.kind==='parents'?(row?parentTypeIDs(row).join(','):''):f.kind==='orders'?(row?typeOrders(row).join(','):''):entity==='products'&&row&&productWeight(f)!==undefined?productWeight(f)!:row?.[f.key]!=null?(f.kind==='date'?String(row[f.key]).slice(0,10):String(row[f.key])):initialValues[f.key]??f.initial??'']))),errors:{},message:'',saved:false});
 const [entries,setEntries]=useState<Entry[]>(()=>[create(1)]),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[gradeEntry,setGradeEntry]=useState<number|null>(null);
 const [productChoices,setProductChoices]=useState<Row[]>(lookups.products||[]),[childEntry,setChildEntry]=useState<number|null>(null),[childRefresh,setChildRefresh]=useState(false);
 const serial=useRef(1),lock=useRef(false),initial=useRef(JSON.stringify(entries.map(e=>({values:e.values,grade:e.grade,mix:e.mix}))));
 const pending=entries.filter(e=>!e.saved),dirty=JSON.stringify(pending.map(e=>({values:e.values,grade:e.grade,mix:e.mix})))!==initial.current;
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved changes?')))onClose()}
 function materialTypeAllowed(candidate:Row){return candidate.Status==='Active'&&!!candidate.FinalComponent&&!candidate.HasChildren}
 function packagingParentAllowed(candidate:Row,choices=lookups.packagingTypes||[]){
  if(candidate.FinalComponent||typeOrders(candidate).includes('Pallet'))return false;
  if(candidate.Status!=='Active'&&!parentTypeIDs(row??{}).includes(Number(candidate.ID)))return false;
  const visited=new Set<number>(),pending=[Number(candidate.ID)];
  while(pending.length){const id=pending.pop()!;if(id===Number(row?.ID))return false;if(visited.has(id))continue;visited.add(id);const node=choices.find(t=>Number(t.ID)===id);if(node)pending.push(...parentTypeIDs(node))}
  return true;
 }
 function parentAllowed(candidate:Row,choices=lookups.rawGrades||[]){
  if(candidate.FinalGrade)return false;
  if(String(candidate.ID)===String(row?.ParentGradeID))return true;
  if(candidate.Status!=='Active')return false;
  const visited=new Set<number>();let id=Number(candidate.ID);
  while(id){if(id===Number(row?.ID)||visited.has(id))return false;visited.add(id);id=Number(choices.find(g=>Number(g.ID)===id)?.ParentGradeID||0)}
  return true;
 }
 function copyMaterial(entry:Entry){return entity==='materials'||!!lookups.materials.find(m=>String(m.ID)===entry.values.MaterialID)?.CopyDim}
 function materialChoices(entry:Entry){const type=entity==='materials'?entry.values.PackagingTypeID:lookups.materials.find(m=>String(m.ID)===entry.values.MaterialID)?.PackagingTypeID;return (lookups.materialDimensions||[]).filter(d=>Number(d.PackagingTypeID)===Number(type)&&d.Status==='Active')}
 function materialDefinition(entry:Entry){return materialChoices(entry).find(d=>String(d.ID)===entry.values.MaterialDimensionID)}
 function supplierDefinition(entry:Entry){return lookups.supplierDimensions?.find(d=>String(d.ID)===entry.values.SupplierDimensionID)}
 const materialChanged=entity==='materials'&&!!row?.MaterialDimensionID&&!!lookups.materialDimensions?.some(d=>String(d.ID)===String(row.MaterialDimensionID)&&String(d.RowVersion)!==String(row.MaterialDimensionRowVersion));
 useEffect(()=>{if(materialChanged&&!readOnly)setEntries(list=>list.map(e=>({...e,values:{...e.values,MaterialD1:'',MaterialD2:'',MaterialD3:''}})))},[materialChanged,readOnly]);
 const supplierChanged=false;
 useEffect(()=>{if(supplierChanged&&!readOnly)setEntries(list=>list.map(e=>({...e,values:{...e.values,SupplierD1:'',SupplierD2:'',SupplierD3:''}})))},[supplierChanged,readOnly]);
 function supplierSetup(key:number,field:string,value:string){
  change(key,field,value);
  if(entity!=='prices')return;
  if(field==='MaterialID'||field==='BaseUoM'){
   setEntries(list=>list.map(e=>{if(e.key!==key)return e;
    const choices=supplierChoices(e.values.MaterialID,lookups.materials,lookups.supplierDimensions||[]);
    return {...e,values:{...e.values,SupplierDimensionID:choices.length===1?String(choices[0].ID):'',SupplierD1:'',SupplierD2:'',SupplierD3:'',MaterialDimensionID:materialChoices(e).length===1?String(materialChoices(e)[0].ID):'',MaterialD1:'',MaterialD2:'',MaterialD3:''}};
   }));
  }
 }
 function change(key:number,field:string,value:string){if(customerLocked&&field==='CustomerID')return;if(field==='PackagingOrders'&&value.split(',').includes('Pallet')&&value!=='Pallet'){value=value.endsWith('Pallet')?'Pallet':value.split(',').filter(v=>v!=='Pallet').join(',')}setEntries(list=>list.map(e=>e.key===key?{...e,...(field==='CustomerID'?{mix:emptyMix()}:{}),values:{...e.values,[field]:value,...(field==='PackagingTypeID'?{MaterialDimensionID:'',MaterialD1:'',MaterialD2:'',MaterialD3:''}:{}),...(field==='PackagingOrders'&&value==='Pallet'?{FinalComponent:'true',CopyDim:'true',Shipping:'false',ParentTypeIDs:''}:{}),...((field==='FinalComponent'&&value!=='true'||field==='ParentTypeIDs'&&!!value)?{CopyDim:'false'}:{}),...((entity==='prices'||entity==='raw-prices')&&field==='MaterialID'?{BaseUoM:String(lookups.materials.find(m=>String(m.ID)===value)?.UnitOfMeasure??'')}:{}),...((entity==='prices'||entity==='raw-prices')&&field==='VendorID'?{CurrencyID:String(lookups.vendors?.find(v=>String(v.ID)===value)?.CurrencyID??''),ExchangeRateToUSD:isUSD(String(lookups.vendors?.find(v=>String(v.ID)===value)?.CurrencyID??''))?'1':''}:{}),...((entity==='prices'||entity==='raw-prices')&&field==='CurrencyID'?{ExchangeRateToUSD:isUSD(value)?'1':''}:{})},errors:{...e.errors,[field]:fields.some(f=>f.key===field&&f.kind==='decimal')?numericEntryError(field,value):''},message:''}:e))}
 async function childCreated(key:number,customer:string,records:Row[]){
  setChildRefresh(true);
  try{
   const fresh=await call<Lookups>('/api/workbench/masters/lookups?entity=products');setProductChoices(fresh.products||[]);
   const children=mixChoices(fresh.products||[],customer).filter(p=>records.some(r=>Number(r.ID)===Number(p.ID)));
   setEntries(all=>all.map(e=>e.key===key&&e.values.CustomerID===customer?{...e,mix:{...(e.mix??emptyMix()),items:[...(e.mix?.items||[]),...children.map(p=>({ProductID:String(p.ID),UnitQuantity:'1'}))].slice(0,500)}}:e));
  }catch(e){setError('Child Product saved, but choices could not be refreshed. Do not create it again. '+(e as Error).message)}
  finally{setChildRefresh(false)}
 }
 async function masterCreated(target:Target,records:Row[]){
  setMasterRefresh(true);setRetryMaster({target,records});setError('');
  try{
   const fresh=await call<Lookups>('/api/workbench/masters/lookups?entity='+entity);setLookups(fresh);
   if(fresh.products)setProductChoices(fresh.products);
   const f=target.field;
   const choices=f.kind==='category'?fresh.categories||[]:f.kind==='customer'?fresh.customers||[]:f.kind==='material'?fresh.materials:f.kind==='vendor'?fresh.vendors||[]:f.kind==='uom'?fresh.uoms||[]:f.kind==='rawgrade'?fresh.rawGrades||[]:f.kind==='packagingtype'?fresh.packagingTypes||[]:fresh.materialDimensions||[];
   const created=choices.find(c=>c.Status==='Active'&&records.some(r=>Number(r.ID)>0&&Number(r.ID)===Number(c.ID)||f.kind==='category'&&r.CategoryName===c.CategoryName||f.kind==='uom'&&r.UoMCode===c.UoMCode)&&(f.kind!=='packagingtype'||(f.key==='ParentTypeIDs'?packagingParentAllowed(c,fresh.packagingTypes):materialTypeAllowed(c)))&&(f.kind!=='rawgrade'||(f.key==='GradeID'?c.FinalGrade===true:parentAllowed(c,fresh.rawGrades))));
   setEntries(all=>all.map(e=>{
    if(e.key!==target.entryKey||e.saved||!created||e.values[f.key]!==target.previousValue)return e;
    if(f.kind==='materialdimension'&&Number(created.PackagingTypeID)!==Number(e.values.PackagingTypeID))return e;
    const value=String(f.kind==='category'?created.CategoryName:f.kind==='uom'?created.UoMCode:created.ID);
    const resets:Record<string,string>=f.kind==='materialdimension'||f.key==='PackagingTypeID'?{MaterialDimensionID:f.kind==='materialdimension'?value:'',MaterialD1:'',MaterialD2:'',MaterialD3:''}:f.kind==='customer'?{}:f.kind==='vendor'?{CurrencyID:String(created.CurrencyID??''),ExchangeRateToUSD:fresh.currencies.find(c=>Number(c.ID)===Number(created.CurrencyID))?.CurrencyCode==='USD'?'1':''}:f.kind==='material'&&(entity==='prices'||entity==='raw-prices')?{BaseUoM:String(created.UnitOfMeasure??'')}:{};
    return {...e,...(f.kind==='customer'&&value!==e.values[f.key]?{mix:emptyMix()}:{}),values:{...e.values,...resets,[f.key]:value},errors:{...e.errors,[f.key]:''}};
   }));
   setRetryMaster(null);
  }catch(exc){setError('Master saved, but choices could not be refreshed. Do not create it again. Retry refreshing choices. '+(exc as Error).message)}
  finally{setMasterRefresh(false)}
 }
 function review(){
  if(readOnly||childRefresh||masterRefresh||retryMaster)return;
  const checked=entries.map(e=>{if(e.saved)return e;const errors:Record<string,string>={};
   for(const f of fields){if((f.kind==='orders'||f.key==='Shipping')&&e.values.ParentTypeIDs)continue;const value=e.values[f.key]?.trim()||'';
    if(f.required&&!value&&!(entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'))errors[f.key]='Required.';
    else if(value&&f.kind==='decimal'&&value!==create(e.key).values[f.key]&&numericEntryError(f.key,value))errors[f.key]=numericEntryError(f.key,value);
    else if(value&&(f.key==='ExchangeRateToUSD'||f.key==='BaseFactor')&&Number(value)<=0)errors[f.key]='Use a positive rate.';
    else if(value&&f.kind==='decimal'&&value.split('.')[0].length>(f.key==='ExchangeRateToUSD'?8:14))errors[f.key]='Number is too large.';
    else if(value&&f.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))errors[f.key]='Choose a date.';
    else if(value&&f.kind==='orders'&&(!value.split(',').every(v=>f.options?.includes(v))||new Set(value.split(',')).size!==value.split(',').length))errors[f.key]='Choose one or more distinct orders.';
    else if(value&&f.kind==='category'&&value!==String(row?.Category??'')&&!(lookups.categories||[]).some(c=>c.CategoryName===value&&c.Status==='Active'))errors[f.key]='Choose an active category.'; else if(value&&f.kind==='choice'&&!f.options?.includes(value))errors[f.key]='Choose a valid option.';
    else if(f.kind==='parents'&&value.split(',').filter(Boolean).some(id=>!(lookups.packagingTypes||[]).some(t=>String(t.ID)===id&&packagingParentAllowed(t))))errors[f.key]='Choose valid Parent Types; descendants and Single types cannot be parents.';
    else if(value&&f.kind==='packagingtype'&&!(lookups.packagingTypes||[]).some(t=>String(t.ID)===value&&(f.key==='ParentTypeIDs'?packagingParentAllowed(t):(materialTypeAllowed(t)||value===String(row?.[f.key]??'')))))errors[f.key]=f.key==='ParentTypeIDs'?'Choose a valid Parent Type.':'Choose an active Single Packaging Type with no children.';
    else if(value&&f.kind==='rawgrade'&&!(lookups.rawGrades||[]).some(r=>String(r.ID)===value&&(f.key==='GradeID'?(r.Status==='Active'&&r.FinalGrade===true):parentAllowed(r))))errors[f.key]=f.key==='GradeID'?'Choose an active final grade.':'Choose a valid Parent Grade.';
    else if(value&&f.kind==='uom'&&!(lookups.uoms||[]).some(r=>r.UoMCode===value&&(r.Status==='Active'||value===row?.[f.key])))errors[f.key]='Choose an active unit of measure.';
    else if(value&&(f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor')&&!(f.kind==='vendor'?(lookups.vendors||[]):f.kind==='customer'?(lookups.customers||[]):f.kind==='material'?lookups.materials:lookups.currencies).some(r=>String(r.ID)===value))errors[f.key]='Choose a valid option.';
   }
   if(entity==='materials'&&Boolean(e.values.TareWeight)!==Boolean(e.values.TareWeightBasis))errors.TareWeight='Enter both tare weight and basis, or clear both.';
   if(entity==='pallets'&&e.values.PalletPriceUSDPerEA&&!/^\d{1,17}(\.\d{1,2})?$/.test(e.values.PalletPriceUSDPerEA))errors.PalletPriceUSDPerEA='Use nonnegative USD with up to two decimals.';
   if(entity==='pallets'&&(e.values.Status||'Active')==='Active'){
    const calculation=palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,lookups.uoms?.find(u=>u.UoMCode===e.values.UnitOfMeasure)?.FactorToMM);
    if(calculation.error)errors.UnitOfMeasure=calculation.error;
   }
   if(entity==='products'){
    const v=e.values;
    if(v.IsMix!=='true'&&(!/^\d{1,6}(\.\d{1,4})?$/.test(v.WeightValue)||Number(v.WeightValue)<=0))errors.WeightValue='Use a positive weight with up to 6 whole digits and 3 decimals.';
    else if(v.IsMix!=='true'&&Number(v.WeightValue)*Number(lookups.uoms?.find(u=>String(u.UoMCode).toLowerCase()===v.WeightUnit.toLowerCase())?.BaseFactor??1)<0.005)errors.WeightValue='Weight must round to at least 0.01 g.';
    if(!(lookups.uoms||[]).some(u=>String(u.UoMCode).toLowerCase()===v.WeightUnit.toLowerCase()&&u.Category==='Weight/Mass'&&u.Status==='Active'))errors.WeightUnit='Choose an active Weight/Mass UoM.';
    if(!row)for(const key of ['ProductName'])if(pending.filter(x=>x.values[key].trim().toLowerCase()===v[key].trim().toLowerCase()).length>1)errors[key]='Duplicate value in this form.';
   }
   if(entity==='materials'&&e.values.MaterialDimensionID){const v=e.values;const md=materialDefinition(e);if(!md)errors.MaterialDimensionID='Choose a current material definition.';for(const k of ['D1','D2','D3'])if(md?.[k+'Name']&&(!v['Material'+k]||Number(v['Material'+k])<=0))errors['Material'+k]='Enter a positive material measurement.';}
   if((entity==='prices'||entity==='raw-prices')){const v=e.values;
    if(v.QuantityTo&&!errors.QuantityTo&&!errors.QuantityFrom&&v.QuantityFrom&&scaled(v.QuantityTo)<=scaled(v.QuantityFrom))errors.QuantityTo='Must be greater than quantity from.';
    if(v.EffectiveTo&&v.EffectiveFrom&&v.EffectiveTo<v.EffectiveFrom)errors.EffectiveTo='Must be on or after effective from.';
    if(entity==='prices'&&fields.some(f=>f.key==='SupplierDimensionID')){
     if(copyMaterial(e)){const md=materialDefinition(e);if(!md)errors.MaterialDimensionID='Required for Copy Dim.';for(const k of ['D1','D2','D3'])if(md?.[k+'Name']&&(!v['Material'+k]||Number(v['Material'+k])<=0))errors['Material'+k]='Required for Copy Dim.';}
     const definition=supplierDefinition(e);
     if(v.SupplierDimensionID&&!supplierChoices(v.MaterialID,lookups.materials,lookups.supplierDimensions||[]).some(d=>String(d.ID)===v.SupplierDimensionID))errors.SupplierDimensionID='Choose a child definition for this material.';
     for(const k of ['D1','D2','D3']){
      if(definition&&String(definition.ConvertFromSupplierFormula||'').includes(k)&&!v['Supplier'+k])errors['Supplier'+k]='Required for the supplier conversion formula.';
      if(v['Supplier'+k]&&(!definition||Number(v['Supplier'+k])<=0))errors['Supplier'+k]='Choose a supplier definition and enter a positive measurement.';
     }
    }
   }
   if(entity==='products'&&!row&&e.values.IsMix==='true')errors.MixVersion=mixError(e.mix??emptyMix(),mixChoices(productChoices,e.values.CustomerID));
   return {...e,errors};
  });setEntries(checked);if(!checked.some(e=>Object.values(e.errors).some(Boolean))&&pending.length)setConfirm(true);
 }
 async function save(){
  if(readOnly)return;
  if(lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');
  try{
   const rows=pending.map(e=>{const values:Record<string,unknown>={RowNum:e.key,Command:row?'U':'C',ID:row?.ID??null,RowVersion:row?.RowVersion??null};
    for(const f of fields){if((f.kind==='orders'||f.key==='Shipping')&&e.values.ParentTypeIDs)continue;const v=e.values[f.key]?.trim()||'';values[f.key]=f.kind==='parents'?v.split(',').filter(Boolean).map(Number):f.kind==='orders'?v.split(','):f.kind==='boolean'?v==='true':v===''?null:(f.kind==='materialdimension'||f.kind==='supplierdimension'||f.kind==='packagingtype'||f.kind==='rawgrade'||f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor'?Number(v):v)}
    if(entity==='packaging-types'){values.CopyDim=e.values.FinalComponent==='true'&&!e.values.ParentTypeIDs;if(e.values.ParentTypeIDs)values.Shipping=false;} if(entity==='products'&&e.values.IsMix==='true'){values.WeightValue=0;values.WeightUnit='g'}
    if(entity==='products'&&!row&&e.values.IsMix!=='true'&&e.grade)values.GradeVersion=e.grade;
    if(entity==='products'&&!row&&e.values.IsMix==='true'){const mix=e.mix??emptyMix();values.MixVersion={Status:mix.Status,items:mix.items.map(i=>({ProductID:Number(i.ProductID),UnitQuantity:i.UnitQuantity,RowVersion:productChoices.find(p=>String(p.ID)===i.ProductID)?.RowVersion}))}}
    if(entity==='materials')values.MaterialDimensionRowVersion=materialDefinition(e)?.RowVersion??null;
    return values;
   });
   const reply=await call<{results:Row[]}>(saveEndpoint??(entity==='products'?'/api/product/batch':(entity.startsWith('raw-')?'/api/raw-material/':'/api/packaging/')+config.endpoint+'/batch'),saveEndpoint?{payload:{rows}}:{rows});
   const results=reply?.results;
   if(!Array.isArray(results)||results.length!==pending.length||pending.some(e=>results.filter(r=>Number(r.RowNum)===e.key).length!==1)||results.some(r=>!['OK','ERROR'].includes(String(r.Status)))){setUncertain(true);throw new Error('Save outcome unknown. Close and refresh before trying again.')}
   const count=results.filter(r=>r.Status==='OK').length;
   setEntries(list=>list.map(e=>{if(e.saved)return e;const r=results.find(r=>Number(r.RowNum)===e.key)!;return {...e,saved:r.Status==='OK',message:r.Status==='OK'?'Saved':String(r.Message||'Save failed.')};}));
   if(count)onSaved(count,results.filter(r=>r.Status==='OK'&&r.NewID!=null).map(r=>({...rows.find(v=>v.RowNum===Number(r.RowNum)),ID:Number(r.NewID)} as Row)));
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
 {entity==='products'&&row&&e.values.IsMix==='true'&&<p className="mix-help">Net weight is calculated from the active mix. Open the Grade / Product Mix icon to maintain child Products.</p>}
 <fieldset className={readOnly||e.saved?"display-only-fields":undefined} disabled={readOnly||busy||uncertain||e.saved}><div className={'master-fields'+(entity==='products'?' product-master-fields':entity==='raw-grades'?' raw-grade-fields':'')+(entity==='packaging-types'?' packaging-type-fields':entity==='prices'||entity==='raw-prices'?' pricing-master-fields':'')}>{fields.filter(f=>f.key!=='MaxPayloadKG'||lookups.packagingTypes?.find(t=>String(t.ID)===e.values.PackagingTypeID)?.PackagingType==='Pallet').filter(f=>!f.key.startsWith('MaterialD')||copyMaterial(e)&&(f.key==='MaterialDimensionID'||!!materialDefinition(e)?.[f.key.replace('Material','')+'Name'])).filter(f=>!f.key.startsWith('SupplierD')||f.key==='SupplierDimensionID'||!!supplierDefinition(e)?.[f.key.replace('Supplier','')+'Name']||!!e.values[f.key]).filter(f=>!(e.values.ParentTypeIDs&&(f.kind==='orders'||f.key==='Shipping'))).map(f=><label key={f.key} data-field={f.key}>{f.key.startsWith('MaterialD')&&f.key!=='MaterialDimensionID'?'Material '+f.key.replace('Material','')+' — '+String(materialDefinition(e)?.[f.key.replace('Material','')+'Name']??f.label)+' ('+String(materialDefinition(e)?.[f.key.replace('Material','')+'Unit']??'')+')':f.key.startsWith('SupplierD')&&f.key!=='SupplierDimensionID'?'Supplier '+f.key.replace('Supplier','')+' — '+String(supplierDefinition(e)?.[f.key.replace('Supplier','')+'Name']??f.label)+' ('+String(supplierDefinition(e)?.[f.key.replace('Supplier','')+'Unit']??'')+')':f.label}{f.required&&f.kind!=='orders'?' *':''}
 <MasterFieldControl enabled={!!targetFor(f)}>{f.kind==='parents'?<span className="packaging-parent-options" role="group" aria-label="Parent Types"><small>Leave all unchecked for a root type.</small>{(lookups.packagingTypes||[]).filter(t=>packagingParentAllowed(t)||e.values[f.key].split(',').includes(String(t.ID))).map(t=><label key={String(t.ID)}><input type="checkbox" aria-label={'Parent '+String(t.PackagingType)} checked={e.values[f.key].split(',').includes(String(t.ID))} disabled={lockedFields.includes(f.key)||!packagingParentAllowed(t)||e.values.PackagingOrders==='Pallet'} onChange={v=>change(e.key,f.key,v.target.checked?[...e.values[f.key].split(',').filter(Boolean),String(t.ID)].join(','):e.values[f.key].split(',').filter(id=>id!==String(t.ID)).join(','))}/>{String(t.PackagingType)}{t.Status!=='Active'?' (Blocked)':''}</label>)}</span>:f.kind==='category'?<><select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">Choose category</option>{e.values[f.key]&&!(lookups.categories||[]).some(c=>c.CategoryName===e.values[f.key]&&c.Status==='Active')&&<option value={e.values[f.key]} disabled>{e.values[f.key]} (Blocked or unavailable - retained)</option>}{(lookups.categories||[]).filter(c=>c.Status==='Active').map(c=><option key={String(c.ID)} value={String(c.CategoryName)}>{String(c.CategoryName)}</option>)}</select></>:f.kind==='materialdimension'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>{change(e.key,f.key,v.target.value);for(const k of ['MaterialD1','MaterialD2','MaterialD3'])change(e.key,k,'')}}><option value="">Choose material dimensions</option>{materialChoices(e).map(d=><option key={String(d.ID)} value={String(d.ID)}>{['D1','D2','D3'].map(k=>d[k+'Name']).filter(Boolean).join(' / ')} (#{String(d.ID)})</option>)}</select>:f.kind==='supplierdimension'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>{change(e.key,f.key,v.target.value);for(const k of ['SupplierD1','SupplierD2','SupplierD3'])change(e.key,k,'')}}><option value="">No supplier conversion dimensions</option>{supplierChoices(e.values.MaterialID,lookups.materials,lookups.supplierDimensions||[]).map(d=><option key={String(d.ID)} value={String(d.ID)}>{String(d.PackagingType)+' · '+String(d.ConvertFromSupplierFormula||'No formula')+' (#'+String(d.ID)+')'}</option>)}</select>:f.kind==='orders'?<span role="group" aria-label="Packaging orders">{(f.options||[]).map(order=><label key={order} className="packaging-order-option" data-order={order} title={order.endsWith(' Mix')?'Applies to Parent Mix':order==='Pallet'?'Palletization':'Applies to child units and standalone Products'}><input type="checkbox" aria-label={(order==='Pallet'?'Palletization':order)+' order'} checked={e.values[f.key].split(',').includes(order)} onChange={v=>change(e.key,f.key,(f.options||[]).filter(o=>o===order?v.target.checked:e.values[f.key].split(',').includes(o)).join(','))}/>{order==='Pallet'?'Palletization':order}</label>)}</span>:f.kind==='packagingtype'?<select disabled={lockedFields.includes(f.key)||f.key==='ParentTypeIDs'&&e.values.PackagingOrders==='Pallet'} aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">{f.key==='ParentTypeIDs'?'None (root type)':'No packaging type'}</option>{e.values[f.key]&&!(lookups.packagingTypes||[]).some(t=>String(t.ID)===e.values[f.key]&&(f.key==='ParentTypeIDs'&&packagingParentAllowed(t)||materialTypeAllowed(t)||String(t.ID)===String(row?.[f.key])))&&<option value={e.values[f.key]} disabled hidden>{String((f.key==='ParentTypeIDs'?row?.ParentType:row?.PackagingType)||'Unavailable type')}</option>}{(lookups.packagingTypes||[]).filter(t=>(f.key==='ParentTypeIDs'?packagingParentAllowed(t):(materialTypeAllowed(t)||String(t.ID)===String(row?.[f.key])))&&(t.Status==='Active'||String(t.ID)===String(row?.[f.key]))).map(t=><option key={String(t.ID)} value={String(t.ID)} disabled={f.key==='ParentTypeIDs'?!packagingParentAllowed(t):!materialTypeAllowed(t)}>{f.key==='ParentTypeIDs'?String(t.PackagingType):typeLabel(t)}{t.Status!=='Active'?' (Blocked)':''}</option>)}</select> :f.key==='TareWeightBasis'?<select aria-label={f.label} disabled={!e.values.UnitOfMeasure} value={tareMassSelection(e.values.TareWeightBasis,e.values.UnitOfMeasure)} onChange={event=>change(e.key,f.key,event.target.value)}><option value="">Choose tare basis</option>{tareMassSelection(e.values.TareWeightBasis,e.values.UnitOfMeasure)==='legacy'&&<option value="legacy" disabled>{e.values.TareWeightBasis} (saved basis)</option>}{['g','kg'].map(mass=><option key={mass} value={mass}>{tareBasisLabel(mass,e.values.UnitOfMeasure)}</option>)}</select>:f.kind==='choice'?<select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>supplierSetup(e.key,f.key,v.target.value)}><option value="">Choose {f.label.toLowerCase()}</option>{(f.options||[]).map(option=><option key={option} value={option}>{option}</option>)}</select>:f.kind==='rawgrade'?<select disabled={lockedFields.includes(f.key)} aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">{f.key==='GradeID'?'No grade':'None (root grade)'}</option>{(lookups.rawGrades||[]).filter(r=>f.key!=='GradeID'||r.FinalGrade===true).map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={f.key==='GradeID'?(r.Status!=='Active'||r.FinalGrade!==true):!parentAllowed(r)}>{f.key==='GradeID'&&r.ParentGradeName?String(r.ParentGradeName)+' > ':''}{String(r.GradeName)}{f.key==='GradeID'?' (#'+String(r.ID)+')':''}</option>)}</select>:f.kind==='uom'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">Choose {f.label.toLowerCase()}</option>{(lookups.uoms||[]).map(r=><option key={String(r.ID)} value={String(r.UoMCode)} disabled={r.Status!=='Active'&&r.UoMCode!==row?.[f.key]}>{String(r.UoMCode)}{r.UoMName?' — '+r.UoMName:''}</option>)}</select>:f.kind==='boolean'?<input type="checkbox" aria-label={f.label} checked={e.values[f.key]==='true'} disabled={f.key==='CopyDim'&&(e.values.FinalComponent!=='true'||!!e.values.ParentTypeIDs)} onChange={v=>change(e.key,f.key,String(v.target.checked))}/>:f.kind==='material'||f.kind==='currency'||f.kind==='customer'||f.kind==='vendor'?<select disabled={lockedFields.includes(f.key)||(normalProductOnly||customerLocked)&&f.key==='CustomerID'} aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>supplierSetup(e.key,f.key,v.target.value)}><option value="">{f.kind==='vendor'?'No vendor':'Choose '+f.label.toLowerCase()}</option>{(f.kind==='vendor'?(lookups.vendors||[]):f.kind==='customer'?(lookups.customers||[]):f.kind==='material'?lookups.materials:lookups.currencies).map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={r.Status==='Block'&&String(row?.[f.key])!==String(r.ID)}>{lookupLabel(r,f.kind as 'material'|'currency'|'customer'|'vendor')}{r.Status==='Block'?' (Blocked)':''}</option>)}</select>:f.kind==='date'?<DateInput aria-label={f.label} value={e.values[f.key]} onValueChange={value=>change(e.key,f.key,value)} aria-invalid={!!e.errors[f.key]}/>:f.kind==='unit'?<select disabled={e.values.IsMix==='true'} aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}>{(lookups.uoms||[]).filter(u=>u.Category==='Weight/Mass'&&u.Status==='Active').map(u=><option key={String(u.ID)} value={String(u.UoMCode)}>{String(u.UoMName||u.UoMCode)+' ('+String(u.UoMCode)+')'}</option>)}</select>:f.kind==='status'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option>Active</option><option>Block</option></select> :f.kind==='decimal'?<span className={f.key==='UnitPrice'?'master-price-value':f.key==='QuantityTo'?'master-open-ended':undefined}><NumericInput field={f.key} value={entity==='products'&&!row&&e.values.IsMix==='true'&&f.key==='WeightValue'?String(mixWeight(e.mix??emptyMix(),productChoices)):e.values[f.key]} onValueChange={value=>change(e.key,f.key,value)} readOnly={entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'||f.key==='ExchangeRateToUSD'&&isUSD(e.values.CurrencyID)} aria-label={f.label} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} placeholder={f.key==='QuantityTo'?'Unlimited':undefined}/>{f.key==='UnitPrice'&&<span className="master-unit-currency">{String(lookups.currencies.find(c=>String(c.ID)===e.values.CurrencyID)?.CurrencyCode??'')}</span>}</span>:<span className={f.key==='EffectiveTo'?'master-open-ended':undefined}><input readOnly={entity==='products'&&e.values.IsMix==='true'&&f.key==='WeightValue'} placeholder={e.values.IsMix==='true'&&f.key==='WeightValue'?'Calculated from active mix':undefined} aria-label={f.label} type="text" maxLength={f.max} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}/>{(entity==='prices'||entity==='raw-prices')&&f.key==='EffectiveTo'&&!e.values.EffectiveTo&&<span className="master-unlimited">Unlimited</span>}</span>}
 {!lockedFields.includes(f.key)&&canAdd(f)&&<AddMasterButton entity={targetFor(f)!} selectedValue={e.values[f.key]} onEdited={record=>void masterCreated({entity:targetFor(f)!,entryKey:e.key,field:f,previousValue:e.values[f.key]},[record])} disabled={masterRefresh||!!retryMaster||!!inlineTarget||f.key==='ParentTypeIDs'&&e.values.PackagingOrders==='Pallet'||f.kind==='materialdimension'&&!e.values.PackagingTypeID} onClick={()=>setInlineTarget({entity:targetFor(f)!,entryKey:e.key,field:f,previousValue:e.values[f.key]})}/>}</MasterFieldControl>{f.kind==='category'&&!(lookups.categories||[]).some(c=>c.Status==='Active')&&<small>No active categories. Maintain Category Master if permitted.</small>}
 <span id={f.key+e.key} className="field-error">{e.errors[f.key]}</span></label>)}</div></fieldset>
 {entity==='products'&&!row&&e.values.IsMix==='true'&&<ProductMixDraft value={e.mix??emptyMix()} choices={mixChoices(productChoices,e.values.CustomerID)} disabled={readOnly||busy||uncertain||e.saved||childRefresh||!e.values.CustomerID} error={e.errors.MixVersion} onChange={mix=>setEntries(all=>all.map(x=>x.key===e.key?{...x,mix,errors:{...x.errors,MixVersion:''}}:x))} onNewChild={()=>setChildEntry(e.key)}/>}
 {materialChanged&&!readOnly&&<p role="status">The material dimension definition changed. Re-enter measurements using the current names and units.</p>}
 {entity==='prices'&&!row&&<p className="muted">Optional: cap the new quantity range at the next tier, or end the previous same-tier price the day before the new start date. Other conflicts remain blocked.</p>}
 {entity==='prices'&&<p className="muted">Physical dimensions are maintained once in Packaging Material.</p>}
 {entity==='pallets'&&(()=>{const preview=palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,lookups.uoms?.find(u=>u.UoMCode===e.values.UnitOfMeasure)?.FactorToMM);return <div className="master-fields"><label>Pallet area (mm²)<input aria-label="Pallet area (mm²)" readOnly value={preview.area} placeholder="Calculated"/></label><label>Pallet size<input aria-label="Pallet size" readOnly value={preview.size} placeholder="Calculated"/></label>{preview.error&&<p className="field-error">{preview.error}</p>}</div>})()}
 </section>)}</div>
 {!readOnly&&!row&&<button className="add-section" type="button" disabled={busy||uncertain||entries.length>=500} onClick={event=>{scrollAddedRecord(event.currentTarget);const entry=create(++serial.current);setEntries(x=>[...x,entry])}}>+ Add record section</button>}
 {retryMaster&&<button type="button" disabled={masterRefresh} onClick={()=>void masterCreated(retryMaster.target,retryMaster.records)}>Retry refreshing choices</button>}
 {!readOnly&&<div className="actions batch-actions"><button className="primary" disabled={busy||uncertain||childRefresh||masterRefresh||!!retryMaster||!pending.length||(!!row&&!dirty)} type="submit">Review & save</button></div>}</form>
 {inlineTarget&&<InlineMasterCreate entity={inlineTarget.entity} initialValues={inlineTarget.entity==='packaging-dimensions'?{PackagingTypeID:entries.find(e=>e.key===inlineTarget.entryKey)?.values.PackagingTypeID||''}:{}} onClose={()=>setInlineTarget(null)} onSaved={records=>void masterCreated(inlineTarget,records)}/>}
 {confirm&&<Modal label="Confirm master save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{row?'Update':'Create'} {pending.length} {pending.length===1?'record':'records'}?</h2><ul className="batch-review">{pending.map(e=><li key={e.key}>{entity==='packaging-types'?(e.values.ParentTypeIDs?'':e.values.PackagingOrders.split(',').join(', ')+' / ')+e.values.PackagingType:entity==='pallets'?palletPreview(e.values.Width,e.values.Length,e.values.UnitOfMeasure,null).size:entity==='raw-grades'?e.values.GradeName:entity==='uoms'?e.values.UoMCode:entity==='vendors'?e.values.VendorName:entity==='products'?e.values.ProductName:(entity==='materials'||entity==='raw-materials')?e.values.MaterialName:lookupLabel(lookups.materials.find(r=>String(r.ID)===e.values.MaterialID)!,'material')+' · '+e.values.BaseUoM+' · '+e.values.UnitPrice}{entity==='products'&&!row&&e.values.IsMix==='true'&&<span> · {e.mix?.items.length||0} child Products · {e.mix?.Status??'Active'} · {mixWeight(e.mix??emptyMix(),productChoices).toFixed(2)} g</span>}</li>)}</ul>{entity==='prices'&&pending.some(e=>e.values.ResolveOverlap==='true')&&<p role="note">Automatic resolution may cap the new quantity range or end the previous same-tier price the day before the new start date. These changes are applied together when you confirm.</p>}<div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving…':'Confirm save'}</button></div></Modal>}
 {childEntry!==null&&<MasterEditor entity="products" row={null} lookups={{...lookups,products:productChoices}} normalProductOnly initialValues={{CustomerID:entries.find(e=>e.key===childEntry)!.values.CustomerID}} onClose={()=>setChildEntry(null)} onSaved={(_,records)=>{const target=entries.find(e=>e.key===childEntry)!;void childCreated(target.key,target.values.CustomerID,records||[])}}/>}
 {gradeEntry!==null&&<ProductGrades initial={entries.find(e=>e.key===gradeEntry)?.grade} onClose={()=>setGradeEntry(null)} onApply={grade=>setEntries(all=>all.map(e=>e.key===gradeEntry?{...e,grade}:e))}/>}
 </Modal>
}
