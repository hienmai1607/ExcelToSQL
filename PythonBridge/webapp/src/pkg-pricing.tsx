import {useEffect,useState} from 'react';
import {call,date,type Row} from './api';
import {Modal,ErrorNote,InfoTip,Notification} from './ui';
import {IconButton} from './icons';
import './pkg-pricing.css';
import {decimalDisplay} from './number-format';
import {type GeometryMetrics} from './response-efficiency';

export type PricingComponent={PriceID:number;PriceRowVersion:string;Quantity:string;DimensionID:number|null;DimensionRowVersion:string|null;D1:string|null;D2:string|null;D3:string|null};
type ParentGeometry={DimensionID:number|null;DimensionRowVersion:string|null;D1:string|null;D2:string|null;D3:string|null};
export type PricingCalculation=Partial<ParentGeometry>&{PackagingOrder:'Primary'|'Secondary'|'Tertiary';LayerCount?:number;PackagingTypeID:number;SquareMeterUoMID:number|null;ReferencePricingMasterID?:number|null;components:PricingComponent[];Fingerprint?:string};
type Options={parentType?:Row;isMixChild?:boolean;materials:(Row&{CopiedDimensions?:ParentGeometry})[];dimensions:Row[];uoms:Row[];types:(Row&{AncestorIDs:number[]})[];saved:Row[];savedComponents:Row[];componentSnapshot?:Row|null};
export type PricingResult={FinalMOQ:string;UnitPrice:string;CurrencyCode:string;UnitUSDPrice:string|null;Fingerprint:string;Tare?:{KG:string|null;Missing:string[]};FinalLayerHeightMM?:string|null;ParentGeometryMetrics?:GeometryMetrics;ParentDimension?:Row|null;ParentMeasurements?:Row;components:(Row&Geometry)[]};
type Result=PricingResult;
type Geometry={PriceID:number;Factor:string|null;ReverseFactor:string|null;SourceUoMCode:string;TargetUoMCode:string|null;AreaPerMaterial:string|null;AreaPerProductUnit:string|null;AreaStatus:string|null;ConversionStatus:string|null};
const fmt=(v:unknown)=>decimalDisplay(v,9)??'—';
const conversionFmt=(v:unknown)=>{const shown=decimalDisplay(v,9);return shown==='0'&&Number(v)>0?decimalDisplay(v,18)??'—':shown??'—'};
const effectiveDate=(p:Row)=>p.EffectiveFrom?date(p.EffectiveFrom)+' → '+(p.EffectiveTo?date(p.EffectiveTo):'Open-ended'):'—';
const validMeasurement=(v:string|null)=>v===null||/^\d{1,12}(\.\d{1,6})?$/.test(v)&&Number(v)>0;
const materialLabel=(p:Row)=>String(p.MaterialCode)+' — '+String(p.MaterialName)+' · '+String(p.PackagingType);
const seed=(p:Row):PricingComponent=>({PriceID:Number(p.PriceID),PriceRowVersion:String(p.PriceRowVersion),Quantity:'1',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null});
const dimensionLabel=(d:Row)=>String(d.PackagingType)+' · '+['D1','D2','D3'].filter(k=>d[k+'Name']).map(k=>String(d[k+'Name'])).join(' / ');
const snapshotLabel=(s:Row|undefined|null)=>s?'Saved pricing #'+String(s.ID)+' · '+String(s.CreatedAt):'Previous saved calculation';
function dimensionChoices(data:Options,price:Row):Row[]{
 const ancestors=data.types.find(t=>Number(t.ID)===Number(price.PackagingTypeID))?.AncestorIDs||[];
 return data.dimensions.filter(d=>ancestors.includes(Number(d.PackagingTypeID)));
}
function previousComponent(components:Row[],price:Row):Row|undefined{
 const exact=components.find(c=>Number(c.CurrentPriceID??c.PriceID)===Number(price.PriceID));
 if(exact)return exact;
 // Compare a replaced price tier only when its material/vendor/basis/tier is unambiguous.
 const matches=components.filter(c=>Number(c.MaterialID)===Number(price.MaterialID)&&c.VendorID===price.VendorID&&c.CurrencyCode===price.CurrencyCode&&c.PriceUoM===price.PriceUoM&&Number(c.VendorMOQ)===Number(price.VendorMOQ)&&Number(c.QuantityTo)===Number(price.QuantityTo));
 return matches.length===1?matches[0]:undefined;
}

export function pricingResponseValues(input:PricingCalculation,result:PricingResult):Record<string,string>{
 const price:Record<string,string>=input.PackagingOrder==='Primary'?{FirstPMMOQ:result.FinalMOQ,PrimaryPricePerUnit:result.UnitPrice,PrimaryPriceCurrencyCode:result.CurrencyCode}:input.PackagingOrder==='Secondary'?{SecondPMMOQ:result.FinalMOQ,SecondaryPricePerUnit:result.UnitPrice,SecondaryPriceCurrencyCode:result.CurrencyCode}:{ThirdPMMOQ:result.FinalMOQ,TertiaryPricePerUnit:result.UnitPrice,TertiaryPriceCurrencyCode:result.CurrencyCode};
 return {LoadPlanJSON:'',ContainerPlansJSON:'{}',...price,...(result.FinalLayerHeightMM!=null?{HeightMM:result.FinalLayerHeightMM}:{})};
}

const blankParent:ParentGeometry={DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null};
function restoredParent(input:PricingCalculation|undefined,data:Options,typeID:number):ParentGeometry{
 const parents=data.dimensions.filter(d=>Number(d.PackagingTypeID)===typeID);
 const selected=parents.find(d=>Number(d.ID)===input?.DimensionID)??(parents.length===1?parents[0]:undefined);
 // Legacy component measurements stay in history; explicitly re-enter them at parent level.
 const current=selected&&input?.DimensionID===Number(selected.ID)&&input.DimensionRowVersion===String(selected.RowVersion);
 return selected?{DimensionID:Number(selected.ID),DimensionRowVersion:String(selected.RowVersion),D1:current?input?.D1??null:null,D2:current?input?.D2??null:null,D3:current?input?.D3??null:null}:blankParent;
}

export function PkgPricing({itemID,order,typeID,layerCount=2,initial,initialResult,editable=true,onClose,onApply}:{itemID:number;order:'Primary'|'Secondary'|'Tertiary';typeID:number;layerCount?:number;initial?:PricingCalculation;initialResult?:PricingResult;editable?:boolean;onClose:()=>void;onApply:(input:PricingCalculation,result:Result)=>void}){
 const [options,setOptions]=useState<Options|null>(null),[lines,setLines]=useState<PricingComponent[]>([]),[areaUnit,setAreaUnit]=useState('');
 const [parent,setParent]=useState<ParentGeometry>(blankParent);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null),[search,setSearch]=useState(''),[dirty,setDirty]=useState(false);
 const [references,setReferences]=useState<Row[]>([]),[referenceChoice,setReferenceChoice]=useState(''),[referenceID,setReferenceID]=useState<number|null>(null),[unavailable,setUnavailable]=useState<Row[]>([]);
 const [previousComponents,setPreviousComponents]=useState<Row[]>([]),[previousSource,setPreviousSource]=useState('');
 const [geometry,setGeometry]=useState<{key:string;rows:Geometry[];error:string;loading:boolean}>({key:'',rows:[],error:'',loading:false});
 useEffect(()=>{let active=true;call<{references:Row[]}>('/api/packaging/items/'+itemID+'/pricing/references?packaging_type_id='+typeID+'&packaging_order='+order).then(data=>{if(active)setReferences(data.references||[])}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[itemID,typeID,order]);
 useEffect(()=>{let active=true;setBusy(true);
  call<Options>('/api/packaging/items/'+itemID+'/pricing?packaging_type_id='+typeID+'&packaging_order='+order).then(data=>{
   if(!active)return;setOptions(data);
   const applied=initialResult&&initial?.Fingerprint===initialResult.Fingerprint;
   setPreviousComponents(applied?initialResult.components:data.savedComponents||[]);
   setPreviousSource(applied?'Last applied calculation (not saved yet)':snapshotLabel(data.componentSnapshot));
   const unit=data.uoms.find(u=>u.IsSquareMeter||['m2','m²','sqm'].includes(String(u.UoMCode).toLowerCase()));setAreaUnit(String(unit?.ID??''));
   const saved=data.saved.find(s=>s.IsCurrent&&Number(s.PackagingTypeID)===typeID);
   const prior=initial??(saved?.InputJSON?JSON.parse(String(saved.InputJSON)) as PricingCalculation:undefined);
   setParent(restoredParent(prior,data,typeID));
   if(prior?.components.some(c=>c.D1||c.D2||c.D3))setError('This older setup stored child measurements. Enter them once in Parent dimensions; the saved history is unchanged.');
   else if(prior?.DimensionID&&String(data.dimensions.find(d=>Number(d.ID)===prior.DimensionID)?.RowVersion)!==prior.DimensionRowVersion)setError('Parent dimension definition changed. Re-enter parent measurements.');
   if(initial||saved?.InputJSON){const previous=initial??JSON.parse(String(saved!.InputJSON)) as PricingCalculation;
    setReferenceID(previous.ReferencePricingMasterID??null);
    setLines(previous.components.filter(c=>data.materials.some(p=>Number(p.PriceID)===c.PriceID)).map(c=>{
     const price=data.materials.find(p=>Number(p.PriceID)===c.PriceID)!,dimension=dimensionChoices(data,price).find(d=>Number(d.ID)===c.DimensionID);
     const changed=c.DimensionID!==null&&(!dimension||String(dimension.RowVersion)!==c.DimensionRowVersion);
     if(changed)setError('Dimension definitions changed. Re-enter measurements before recalculating.');
     return {...c,PriceRowVersion:String(price.PriceRowVersion),DimensionID:dimension&&!changed&&dimension.ParentDimensionID!=null?c.DimensionID:null,DimensionRowVersion:dimension&&!changed&&dimension.ParentDimensionID!=null?String(dimension.RowVersion):null,D1:null,D2:null,D3:null};
    }));setAreaUnit(String(previous.SquareMeterUoMID??unit?.ID??''));
   }
  }).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false};
 },[itemID,typeID,order]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard calculator changes?')))onClose()}
 function invalidate(){setResult(null);setDirty(true);setError('')}
 function change(index:number,patch:Partial<PricingComponent>){invalidate();setLines(xs=>xs.map((x,i)=>i===index?{...x,...patch}:x))}
 function add(p:Row){if(lines.length&&(options?.parentType?.CopyDim||p.CopyDim||lines.some(c=>options?.materials.find(m=>Number(m.PriceID)===c.PriceID)?.CopyDim)))return;invalidate();setLines(xs=>[...xs,seed(p)])}
 const copyDim=!!options?.parentType?.CopyDim||lines.some(c=>!!options?.materials.find(p=>Number(p.PriceID)===c.PriceID)?.CopyDim);
 const copyPrice=lines.length===1?options?.materials.find(p=>Number(p.PriceID)===lines[0].PriceID):undefined;
 useEffect(()=>{if(copyDim){setResult(null);setParent(copyPrice?.CopiedDimensions||blankParent)}},[copyDim,copyPrice]);
 const parentDimensions=options?.dimensions.filter(d=>Number(d.PackagingTypeID)===typeID)||[];
 const parentDefinition=parentDimensions.find(d=>Number(d.ID)===parent.DimensionID);
 const shipping=!!options?.parentType?.Shipping;
 const heightRequired=shipping&&!options?.isMixChild&&(['Primary','Secondary','Tertiary'].indexOf(order)+1===layerCount);
 const hasArea=lines.some(c=>options?.materials.find(p=>Number(p.PriceID)===c.PriceID)?.CalculationBasis==='Square meter');
 const geometryRequest=JSON.stringify({PackagingOrder:order,PackagingTypeID:typeID,SquareMeterUoMID:Number(areaUnit)||null,...parent,
  components:lines.filter(c=>options?.materials.find(p=>Number(p.PriceID)===c.PriceID)?.CalculationBasis==='Square meter'&&validMeasurement(c.Quantity)&&(['D1','D2','D3'] as const).every(k=>validMeasurement(parent[k])))});
 useEffect(()=>{
  const input=JSON.parse(geometryRequest) as PricingCalculation;if(!input.components.length)return;
  let active=true;setGeometry({key:geometryRequest,rows:[],error:'',loading:true});
  const timer=window.setTimeout(()=>{call<{components:Geometry[]}>('/api/packaging/items/'+itemID+'/pricing/geometry',input)
   .then(reply=>{if(active)setGeometry({key:geometryRequest,rows:reply.components,error:'',loading:false})})
   .catch(e=>{if(active)setGeometry({key:geometryRequest,rows:[],error:(e as Error).message,loading:false})})},300);
  return()=>{active=false;window.clearTimeout(timer)};
 },[itemID,geometryRequest]);
 function payload():PricingCalculation{return {PackagingOrder:order,LayerCount:layerCount,PackagingTypeID:typeID,SquareMeterUoMID:hasArea?Number(areaUnit)||null:null,ReferencePricingMasterID:referenceID,...parent,components:lines}}
 async function loadReference(){
  if(!referenceChoice||busy||dirty&&!window.confirm('Replace the current calculator setup with this reference?'))return;
  setBusy(true);setError('');
  try{const reply=await call<{input:PricingCalculation;warnings:string[];unavailable:Row[];previousComponents?:Row[];componentSnapshot?:Row}>('/api/packaging/items/'+itemID+'/pricing/references/'+referenceChoice+'?packaging_type_id='+typeID+'&packaging_order='+order);
   setLines(reply.input.components.map(c=>({...c,D1:null,D2:null,D3:null})));if(options)setParent(restoredParent(reply.input,options,typeID));setPreviousComponents(reply.previousComponents||[]);setPreviousSource(snapshotLabel(reply.componentSnapshot));setAreaUnit(String(reply.input.SquareMeterUoMID??''));setReferenceID(Number(referenceChoice));setUnavailable(reply.unavailable);setResult(null);setDirty(true);setError(reply.warnings.join(' '));
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function calculate(){setBusy(true);setError('');setResult(null);
  try{if(copyDim&&(lines.length!==1||copyPrice?.CopyDimensionError))throw new Error(String(copyPrice?.CopyDimensionError||'Copy Dim. requires exactly one material with maintained dimensions.'));if(heightRequired&&!parent.D3)throw new Error('Enter the parent D3 Height for the last confirmed packaging layer.');const reply=await call<{calculation:Result}>('/api/packaging/items/'+itemID+'/pricing/preview',payload());setResult(reply.calculation)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <Modal label={order+' Pricing Calculator'} className="dialog pkg-pricing-dialog" onClose={close}>
  <div className="pricing-calculator-layout" onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();if(lines.length&&!busy&&!unavailable.length)void calculate()}}}>
  <header className="customer-editor-heading"><h2>{order} Pricing Calculator<InfoTip text={"Effective prices today (UTC), from active child types. Quantity from is used as vendor MOQ. Quantities and totals are per one "+order.toLowerCase()+" packaging unit. Apply, then save the response to store the snapshot."}/></h2><IconButton icon="close" label="Close pricing calculator" disabled={busy} onClick={close}/></header>

  <div className="pricing-calculator-body"><ErrorNote value={error}/>{!options?<p>Loading materials…</p>:<>
   <div className="pricing-reference"><label>Reference from another request<select aria-label="Pricing reference" value={referenceChoice} disabled={busy} onChange={e=>setReferenceChoice(e.target.value)}><option value="">Choose a saved setup</option>{references.map(r=><option key={String(r.ID)} value={String(r.ID)}>{String(r.RequestNumber)} / {String(r.OpportunityNumber)} · {String(r.ProductCode)} · {String(r.PackagingTypeName)} · {String(r.CreatedAt)}</option>)}</select></label><button type="button" disabled={busy||!referenceChoice} onClick={loadReference}>Load reference</button></div>
   {referenceID&&<p className="muted">Reference pricing #{referenceID}. Inputs can be edited; current effective prices are used after recalculation.</p>}
   {unavailable.length>0&&<section className="panel" role="alert"><strong>Review unavailable reference components before calculating</strong>{unavailable.map((r,i)=><p key={i}>{String(r.MaterialCode)} — {String(r.MaterialName)}: {String(r.Reason)}</p>)}<p>Add suitable replacements from the current material list, then confirm the omitted lines.</p><button type="button" onClick={()=>{setUnavailable([]);setResult(null)}}>Confirm omitted reference components</button></section>}
   {options.saved.length>0&&<details className="pricing-history"><summary>Saved pricing snapshots ({options.saved.length})</summary><table><thead><tr><th>Saved</th><th>Type</th><th>Product MOQ</th><th>Unit price</th><th>State</th></tr></thead><tbody>{options.saved.map(s=><tr key={String(s.ID)}><td>{String(s.CreatedAt)}</td><td>{String(s.PackagingTypeName)}</td><td>{fmt(s.FinalMOQ)}</td><td>{fmt(s.UnitPrice)} {String(s.CurrencyCode)}</td><td>{s.IsCurrent?'Current':'Superseded'}</td></tr>)}</tbody></table><p className="muted">Stored totals are snapshots. Recalculate explicitly to use current master data.</p></details>}
   <section className="panel" aria-label="Parent dimensions"><h3>{copyDim?'Final dimensions (copied)':'Parent dimensions'}{shipping&&<InfoTip text="Shipping D3 is Height. It is required only for the last confirmed packaging layer of a normal or mix parent Product, where it supplies Shipping height (mm). Mix children and intermediate layers need it only when a component formula uses D3."/>}</h3>
    <div className="pricing-entry-grid"><label>Parent dimension definition<select aria-label="Parent dimension definition" value={parent.DimensionID??''} disabled={busy||copyDim} onChange={e=>{invalidate();const d=parentDimensions.find(d=>String(d.ID)===e.target.value);setParent(d?{...blankParent,DimensionID:Number(d.ID),DimensionRowVersion:String(d.RowVersion)}:blankParent);setLines(xs=>xs.map(x=>({...x,DimensionID:null,DimensionRowVersion:null})))}}><option value="">Choose parent definition</option>{parentDimensions.map(d=><option key={String(d.ID)} value={String(d.ID)}>{dimensionLabel(d)}</option>)}</select></label>
    {parentDefinition&&(['D1','D2','D3'] as const).filter(k=>parentDefinition[k+'Name']).map(k=><label key={k}>{k+' — '+(shipping&&k==='D3'?'Height':String(parentDefinition[k+'Name']))+' ('+String(parentDefinition[k+'Unit'])+')'+(heightRequired&&k==='D3'?' *':'')}<input aria-label={'Parent '+k} type="number" min="0.000001" step="0.000001" required={heightRequired&&k==='D3'} disabled={busy||copyDim} value={parent[k]??''} onChange={e=>{invalidate();setParent(p=>({...p,[k]:e.target.value||null}))}}/></label>)}</div>
    {!parentDimensions.length&&<p className="muted">Maintain a dimension definition on the parent Packaging Type before entering measurements.</p>}
    {copyDim&&<p className="muted">Copy Dim.: select exactly one material. Final dimensions are copied from its Packaging Material record and cannot be entered manually.</p>}
    {copyPrice?.CopyDimensionError&&<p role="alert">{String(copyPrice.CopyDimensionError)}</p>}
    <p className="muted">Parent measurements feed each child's Convert from parent fx. Occupied m²/m³ describe shipping space only. Material measurements are maintained once in Packaging Material.</p>
   </section>
   <label>Find material<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Material code, name or type"/></label>
   <div className="pricing-catalog"><table><thead><tr><th>Select</th><th>Material / child type</th><th>Basis</th><th>Tare weight</th><th>Vendor</th><th>Effective price</th><th>Effective date</th><th>Vendor MOQ</th><th>Quantity to (exclusive)</th></tr></thead><tbody>{options.materials.filter(p=>materialLabel(p).toLowerCase().includes(search.toLowerCase())).map((p,i)=><tr key={String(p.PriceID??'none-'+p.MaterialID)+'-'+i}>
    <td><IconButton icon="plus" label={'Add '+String(p.MaterialCode)+' price '+String(p.PriceID??'unavailable')} disabled={busy||!p.PriceID||p.CalculationBasis==='Volume'||lines.some(l=>l.PriceID===Number(p.PriceID))||(lines.length>0&&(copyDim||!!p.CopyDim))||!!p.CopyDimensionError} onClick={()=>add(p)}/></td>
    <td>{materialLabel(p)}{p.CopyDimensionError&&<small role="alert">{String(p.CopyDimensionError)}</small>}</td><td>{String(p.CalculationBasis)}</td><td style={{whiteSpace:'nowrap'}}>{p.TareWeight!=null&&p.TareWeightBasis?fmt(p.TareWeight)+' '+String(p.TareWeightBasis).replace('kg/m2','kg/m²'):'—'}</td><td>{String(p.VendorName??'No vendor')}</td><td>{p.PriceID?fmt(p.UnitPrice)+' '+String(p.CurrencyCode)+' / '+String(p.PriceUoM):'No effective price'}</td><td className="pricing-effective-date">{effectiveDate(p)}</td><td>{fmt(p.VendorMOQ)}</td><td>{fmt(p.QuantityTo)}</td>
   </tr>)}</tbody></table>{options.materials.length===0&&<p>No active materials for this type. Assign materials and effective prices in the masters.</p>}</div>
   {hasArea&&<label>Square-meter UoM (formula output)<select aria-label="Square-meter UoM" disabled={busy} value={areaUnit} onChange={e=>{invalidate();setAreaUnit(e.target.value)}}><option value="">Choose the UoM representing m²</option>{options.uoms.filter(u=>u.IsSquareMeter||['m2','m²','m^2','sqm','sq m'].includes(String(u.UoMCode).toLowerCase())).map(u=><option key={String(u.ID)} value={String(u.ID)}>{String(u.UoMCode)} — {String(u.UoMName??'')}</option>)}</select></label>}
   <div className="pricing-components">{lines.map((line,index)=>{
    const price=options.materials.find(p=>Number(p.PriceID)===line.PriceID)!;
    const dimensions=dimensionChoices(options,price).filter(d=>Number(d.ParentDimensionID)===parent.DimensionID&&Number(d.PackagingTypeID)===Number(price.PackagingTypeID));
    const childDefinition=dimensions.find(d=>Number(d.ID)===line.DimensionID)??(dimensions.length===1?dimensions[0]:undefined);
    const supplierDefinition=options.dimensions.find(d=>Number(d.ID)===Number(price.SupplierDimensionID));
    const computed=result?.components[index];
    const previous=previousComponent(previousComponents,price);
    const live=computed?.Factor!=null?computed:geometry.key===geometryRequest?geometry.rows.find(g=>g.PriceID===line.PriceID):undefined;
    const liveError=!computed&&geometry.key===geometryRequest?geometry.error:'';
    const geometryPending=!computed&&geometry.key===geometryRequest&&geometry.loading;
    return <section className="panel" key={line.PriceID} aria-label={'Pricing component '+(index+1)}><header><strong>{index+1}. {materialLabel(price)}</strong><IconButton icon="close" label={'Remove component '+(index+1)} disabled={busy} onClick={()=>{invalidate();setLines(xs=>xs.filter((_,i)=>i!==index))}}/></header><div className="pricing-entry-grid">
     <label>Quantity per product packaging unit<input aria-label={'Component '+(index+1)+' quantity'} type="number" min="0.000001" step={price.CalculationBasis==='Count'?'1':'0.000001'} value={line.Quantity} disabled={busy} onChange={e=>change(index,{Quantity:e.target.value})}/></label>
     {dimensions.length>1&&<label>Convert from parent definition<select aria-label={'Component '+(index+1)+' conversion definition'} value={line.DimensionID??''} disabled={busy} onChange={e=>{const d=dimensions.find(x=>String(x.ID)===e.target.value);change(index,{DimensionID:d?Number(d.ID):null,DimensionRowVersion:d?String(d.RowVersion):null})}}><option value="">Choose child definition</option>{dimensions.map(d=><option key={String(d.ID)} value={String(d.ID)}>{String(d.ConvertFromParentFormula??'Count: 1')} (#{String(d.ID)})</option>)}</select></label>}
     {price.CalculationBasis==='Square meter'&&<label>Material dimensions<span>{['D1','D2','D3'].filter(k=>price['Supplier'+k]!=null).map(k=>k+': '+fmt(price['Supplier'+k])).join(' × ')||'Not maintained; update Packaging Material.'}</span></label>}
     {dimensions.length===0&&price.CalculationBasis==='Square meter'&&<p className="muted">No square-meter dimension definition available. Maintain one before calculating.</p>}
    </div><p className="muted">Effective date: {effectiveDate(price)}</p>
    {parentDefinition&&<p className="muted">Convert from parent fx: {String(childDefinition?.ConvertFromParentFormula??(price.CalculationBasis==='Count'?'1':'Missing child formula'))}</p>}
    {supplierDefinition&&<p className="muted">Material yield fx: {String(supplierDefinition.ConvertFromSupplierFormula??'Missing material formula')}</p>}
    {price.CalculationBasis==='Square meter'&&<section className="pricing-area-details" aria-label={'Component '+(index+1)+' square-meter details'} aria-busy={geometryPending}>
     <div className="pricing-conversion"><span>Price-UoM conversion</span><strong>{live?.Factor!=null?'1 '+live.SourceUoMCode+' = '+conversionFmt(live.Factor)+' '+live.TargetUoMCode+(live.SourceUoMCode!==live.TargetUoMCode?' · 1 '+live.TargetUoMCode+' = '+conversionFmt(live.ReverseFactor)+' '+live.SourceUoMCode:''):'—'}</strong><small>{live?.ConversionStatus||'Supplier dimensions from Packaging Material Pricing; m² prices use factor 1.'}</small></div>
     <label>Calculated area per material (m²)<input readOnly aria-label={'Component '+(index+1)+' area per material'} value={live?.AreaPerMaterial!=null?fmt(live.AreaPerMaterial):''}/></label>
     <label>Calculated area per product packaging unit (m²)<input readOnly aria-label={'Component '+(index+1)+' area per packaging unit'} value={live?.AreaPerProductUnit!=null?fmt(live.AreaPerProductUnit):''}/></label>
     {(geometryPending||liveError||live?.AreaStatus||!live)&&<p className="muted">{geometryPending?'Calculating area/conversion…':liveError||live?.AreaStatus||'Enter a positive quantity and valid dimension measurements.'}</p>}
    </section>}
    {previous&&<p className="pricing-previous" aria-label={'Component '+(index+1)+' previous calculation'}>Previous calculated price: <strong>{fmt(previous.ProductUnitPrice)} {String(previous.CurrencyCode)} / packaging unit</strong> · Quantity: {fmt(previous.Quantity)} · Product MOQ: {fmt(previous.ProductMOQ)}<small>{previousSource}</small></p>}
    {computed&&<p>Price units used: {fmt(computed.Consumption)} · Product MOQ: {fmt(computed.ProductMOQ)} · Unit price: {fmt(computed.ProductUnitPrice)} {String(computed.CurrencyCode)}</p>}
    </section>;
   })}</div>
   {result&&<div className="panel pricing-total" role="status"><strong>Packaging tare: {result.Tare?.KG!=null?fmt(result.Tare.KG)+' kg':'Incomplete'}</strong>{!!result.Tare?.Missing.length&&<span>Maintain tare for: {result.Tare.Missing.join(', ')}</span>}<strong>Final MOQ: {fmt(result.FinalMOQ)}</strong><strong>Unit packaging price: {fmt(result.UnitPrice)} {result.CurrencyCode}</strong>{result.UnitUSDPrice!==null&&<span>USD: {fmt(result.UnitUSDPrice)}</span>}</div>}

  </>}</div>
   <div className="actions pricing-calculator-actions"><button type="button" disabled={busy||!options||lines.length===0||unavailable.length>0} onClick={calculate}>Calculate pricing</button>{editable&&<button type="button" className="primary" disabled={busy||!result||unavailable.length>0} onClick={()=>{if(result)onApply({...payload(),Fingerprint:result.Fingerprint},result)}}>Apply to response</button>}<button type="button" disabled={busy} onClick={close}>Close</button></div>
  </div></Modal>;
}

function PricingSnapshotContext({header}:{header:Row}){
 let context:{Request?:Row;Product?:Row;ProductGradeVersion?:Row;ProductMixVersion?:Row}={};
 try{if(header.ContextSnapshotJSON)context=JSON.parse(String(header.ContextSnapshotJSON))}catch{/* Older snapshots have no captured context. */}
 return <details><summary>Opportunity item and product versions</summary>
  <p>Opportunity item: {String(header.OpportunityItemID??'Not captured')} · Product: {String(context.Request?.ProductCode??context.Product?.ProductCode??header.ProductID??'Not captured')}{context.Request?.ProductName?' — '+String(context.Request.ProductName):''}</p>
  {context.Request&&<p>Request: {String(context.Request.RequestNumber)} · Opportunity: {String(context.Request.OpportunityNumber)} · Net weight: {fmt(context.Request.WeightGrams)} g · Shelf life: {fmt(context.Request.ShelfLifeDays)} days</p>}
  <p>Grade version: {String(context.ProductGradeVersion?.Version??header.ProductGradeVersionID??'Not captured')} · Mix version: {String(context.ProductMixVersion?.Version??header.ProductMixVersionID??'Not captured')}</p>
  {context.Product?.RowVersion&&<p>Product row version: {String(context.Product.RowVersion)}</p>}
  {header.SourcePricingMasterID&&<p>Reference pricing #{String(header.SourcePricingMasterID)}</p>}
  {!header.ContextSnapshotJSON&&<p className="muted">This older snapshot has no captured product-version context.</p>}
 </details>;
}

function StoredDimensions({value}:{value:unknown}){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const dimension=value as Row;
 return <p>Dimension definition #{String(dimension.ID)}: {['D1','D2','D3'].filter(k=>dimension[k+'Name']).map(k=>String(dimension[k+'Name'])+' ('+String(dimension[k+'Unit'])+')').join(' / ')} · Formula: {String(dimension.ConvertFromParentFormula??dimension.ConvertFromSupplierFormula??dimension.SquareMeterFormula??'None')}</p>;
}

function StoredParentPricing({value}:{value:unknown}){
 let snapshot:Record<string,unknown>={};try{snapshot=typeof value==='string'?JSON.parse(value):value as Record<string,unknown>||{}}catch{}
 const dimension=snapshot.ParentDimension as Row|undefined,measurements=snapshot.ParentMeasurements as Row|undefined;
 if(!dimension||!measurements)return null;
 return <section aria-label="Saved parent dimensions"><h4>Saved parent dimensions</h4><StoredDimensions value={dimension}/>
 <p>{['D1','D2','D3'].filter(k=>dimension[k+'Name']).map(k=>String(dimension[k+'Name'])+': '+fmt(measurements[k])+' '+String(dimension[k+'Unit']??'')).join(' · ')}</p></section>;
}

export function PricingHistory({itemID,order,onClose}:{itemID:number;order?:string;onClose:()=>void}){
 const [data,setData]=useState<{header:Row;components:Row[]}[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;call<{snapshots:{header:Row;components:Row[]}[]}>('/api/packaging/items/'+itemID+'/pricing/history').then(reply=>{if(active)setData((reply.snapshots||[]).filter(s=>!order||s.header.PackagingOrder===order))}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[itemID,order]);
 return <Modal label="Saved packaging pricing" className="dialog pkg-pricing-dialog" onClose={onClose}>
  <header className="customer-editor-heading"><h2>Saved packaging pricing</h2><IconButton icon="close" label="Close saved pricing" onClick={onClose}/></header>
  <ErrorNote value={error}/>
  {data===null&&!error?<p>Loading snapshots…</p>:data?.length===0?<p>No saved calculations for this request item.</p>:data?.map(s=><section className="panel" key={String(s.header.ID)}>
   <h3>{String(s.header.PackagingOrder)} — {String(s.header.PackagingTypeName)} · {s.header.IsCurrent?'Current':'Superseded'}</h3>
   <p>MOQ: {fmt(s.header.FinalMOQ)} · Unit price: {fmt(s.header.UnitPrice)} {String(s.header.CurrencyCode)} · Saved by {String(s.header.CreatedByName)} on {String(s.header.CreatedAt)}</p>
   <PricingSnapshotContext header={s.header}/><StoredParentPricing value={s.header.SnapshotJSON}/>
   <div className="pricing-catalog"><table><thead><tr><th>Material</th><th>Vendor</th><th>Quantity / pkg unit</th><th>Area (m²)</th><th>Product MOQ</th><th>Unit price</th></tr></thead><tbody>{s.components.map((c,index)=><tr key={index}><td>{String(c.MaterialCode)} — {String(c.MaterialName)}</td><td>{String(c.VendorName??'No vendor')}</td><td>{fmt(c.Quantity)}</td><td>{c.CalculationBasis==='Count'?'—':fmt(c.Area)}</td><td>{fmt(c.ProductMOQ)}</td><td>{fmt(c.ProductUnitPrice)} {String(c.CurrencyCode)}</td></tr>)}</tbody></table></div>
   <details><summary>Stored dimensions, vendor prices and conversions</summary>{s.components.map((c,index)=><section key={index}>
    <p>{String(c.MaterialName)}: vendor price {fmt(c.UnitPrice)} {String(c.CurrencyCode)} / {String(c.PriceUoM)}, vendor MOQ {fmt(c.VendorMOQ)}, quantity to (exclusive) {fmt(c.QuantityTo)}. Effective {String(c.EffectiveFrom??'Not captured')} to {String(c.EffectiveTo??'No end date')}.</p>
    <p>Conversion factor: {fmt(c.Factor)} · Price units consumed: {fmt(c.Consumption)} · Exchange rate: {fmt(c.ExchangeRateToUSD)} {String(c.CurrencyCode)} / USD</p>
    <StoredDimensions value={c.Dimension}/>
    <p>Measurements: {JSON.stringify(c.Measurements)}</p>
    {c.Conversion&&typeof c.Conversion==='object'&&<><StoredDimensions value={(c.Conversion as Row).Dimension}/><p>Supplier measurements (one Price UoM): {JSON.stringify((c.Conversion as Row).Measurements)}</p></>}
   </section>)}</details>
  </section>)}
  <p className="muted">Read only. Up to 20 recent snapshots are shown, including superseded calculations. Master changes do not rewrite stored values.</p>
  
 </Modal>;
}
