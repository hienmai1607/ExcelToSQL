import {PalletCalculator,readPalletPricing} from './pallet-calculator';
import {savedLoadPlan,containerPlans} from './load-plan-values';
import {LoadPlanner} from './load-planner';
import {FieldLabel,InfoTip} from './ui';
import {layerTares,packagingGross,mixContentsGross} from './packaging-weight';
import {useEffect,useState} from 'react';
import {call,text,type Row} from './api';
import {IconButton} from './icons';
import {PkgPricing,type PricingCalculation,type PricingResult} from './pkg-pricing';
import {webResponseFields} from './packaging-fields';
import {ResponseInput} from './response-input';
import {usedVolumeDisplay} from './response-volume';
import {packingWeights,loadSections} from './packing-way';
import {decimalDisplay,numberDisplay} from './number-format';
import {layerCount,responseOrderFields,selectableType,isMixParent,type PackagingOrder} from './packaging-orders';
import {GradeSnapshotIcon,parseGradeSnapshot} from './opportunity-grade-snapshot';import {parseMixStructure,mixFormula} from './mix-structure';
import {responseEfficiency,mixTotals,mixVolumeDisplay,mixWeightDisplay} from './response-efficiency';
import {capturedDimensions,dimensionDisplay,savedLayerDimensions} from './response-dimensions';
import {allowedContainerTypes,containerChange,parseContainerProfiles} from './container-loading';

const sections=[
 {label:'Primary packaging',level:1,keys:['FirstPMType','FirstPMMOQ','PrimaryPricePerUnit']},
 {label:'Secondary packaging',level:2,keys:['SecondPMType','SecondPMMOQ','SecondaryPricePerUnit']},
 {label:'Tertiary packaging',level:3,keys:['ThirdPMType','ThirdPMMOQ','TertiaryPricePerUnit']},
 {label:'Palletization',level:1,keys:['CartonsPerLayer','LayersPerPallet','UnitsPerPallet']}
];

export function responseChange(values:Record<string,string>,pricing:Record<string,PricingCalculation>,key:string,value:string,pallets:Row[]=[],configuration?:unknown,source?:Row){
 const next=containerChange(values,key,value,pallets,configuration),calculations={...pricing};if(key==='NutDensity')next.NutDensityDefaultUpdate='0';
 if(key==='ResponsePalletSize'&&value!==values[key])next.PalletPricingJSON='';
 if(key==='PalletPricingJSON')next.LoadPlanJSON='';
 if(key==='LoadPlanJSON'){const plan=savedLoadPlan(value);if(plan&&['Floor load','Both'].includes(String(configuration))){next.CartonsPerContainer=String(plan.Result.cartons)}}
 if(['ApplicableNetWeightGrams','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','SelectedContainerType','ResponseLayerCount','FirstPMType','SecondPMType','ThirdPMType','UnitsPerCarton','UnitsPerTertiary'].includes(key)&&value!==values[key])next.LoadPlanJSON='';
 const changed=responseOrderFields.find(f=>f.type===key||f.moq===key);
 if(key==='HeightMM')next.LayersPerPallet='';
 if(key==='ResponseLayerCount'||responseOrderFields[layerCount(values.ResponseLayerCount)-1].type===key){next.HeightMM='';next.LayersPerPallet=''}
 if(changed){const tares=layerTares(values.LayerTareJSON);delete tares[changed.order];next.LayerTareJSON=JSON.stringify(tares);delete calculations[changed.order];next[changed.moq]='';next[changed.price]='';next[changed.currency]=''}
 if(key==='ResponseLayerCount'&&source&&layerCount(value)===layerCount(source.ResponseLayerCount??source.RequestedLayerCount)){
  const field=responseOrderFields[layerCount(value)-1];
  if(next[field.type]===String(source[field.type]??'')&&next[field.moq]===String(source[field.moq]??''))next.HeightMM=String(source.HeightMM??'');
 }
 if(key==='LoadPlanJSON'&&value){const plan=savedLoadPlan(value);if(plan?.Code){const plans=containerPlans(values.ContainerPlansJSON);plans[plan.Code]=plan;next.ContainerPlansJSON=JSON.stringify(plans);next.SelectedContainerType=plan.Code}}
 if(key==='SelectedContainerType'){const plans=containerPlans(values.ContainerPlansJSON),old=savedLoadPlan(values.LoadPlanJSON);if(old?.Code)plans[old.Code]=old;next.ContainerPlansJSON=JSON.stringify(plans);next.LoadPlanJSON=plans[value]?JSON.stringify(plans[value]):''}
 if(['ApplicableNetWeightGrams','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','ResponseLayerCount','FirstPMType','SecondPMType','ThirdPMType','UnitsPerCarton','UnitsPerTertiary','PalletPricingJSON'].includes(key)&&value!==values[key])next.ContainerPlansJSON='{}';
 const selectedPlan=savedLoadPlan(next.LoadPlanJSON);
 if(selectedPlan&&['Floor load','Both'].includes(String(configuration))&&['LoadPlanJSON','SelectedContainerType'].includes(key)){
  next.CartonsPerContainer=String(selectedPlan.Result.cartons);
  if(allowedContainerTypes('Both').some(kind=>kind===next.SelectedContainerType)){
   const profiles=parseContainerProfiles(next.ContainerLoadProfiles);
   profiles[next.SelectedContainerType]={...profiles[next.SelectedContainerType],PalletsPerContainer:null,CartonsPerContainer:next.CartonsPerContainer};
   next.ContainerLoadProfiles=JSON.stringify(profiles);
  }
 }
 // Keep every layer's draft when counts change. Review revalidates active pricing;
 // save excludes inactive inputs, and SQL clears unused layers only after save.
 return {values:next,pricing:calculations};
}

export function ResponseSections({values,requestedLayers,netWeight,configuration,product,sameConfigControl,configHelp,configReadOnly=false,onChange,types,pallets=[],loading,itemID,pricing,pricingResults,onPricingApply}:{values:Record<string,string>;requestedLayers?:unknown;netWeight:unknown;configuration?:unknown;product?:Row;sameConfigControl?:React.ReactNode;configHelp?:string;configReadOnly?:boolean;onChange:(key:string,value:string)=>void;types:Row[];pallets?:Row[];loading:boolean;itemID?:number;pricing?:Record<string,PricingCalculation>;pricingResults?:Record<string,PricingResult>;onPricingApply?:(input:PricingCalculation,result:PricingResult)=>void}){
 const [feedbackContainers,setFeedbackContainers]=useState<Row[]>([]);
 useEffect(()=>{if(!product?.ParentItemID)call<{rows:Row[]}>('/api/load-planning/containers').then(x=>setFeedbackContainers(x.rows.filter(r=>r.Status==='Active'))).catch(()=>setFeedbackContainers([]))},[product?.ParentItemID]);
 const [palletCalculator,setPalletCalculator]=useState(false);
 const [loadPlanner,setLoadPlanner]=useState<'pallet'|'container'|null>(null);
 const [calculator,setCalculator]=useState<{order:PackagingOrder;typeID:number}|null>(null);
 const [appliedResults,setAppliedResults]=useState<Record<string,PricingResult>>({});
 const results={...appliedResults,...pricingResults};
 const mixParent=isMixParent(product);const mixChild=!!product?.ParentItemID,mix=mixChild?null:parseMixStructure(product?.ProductMixSnapshot),unitHelp=mixFormula(mix),unitLabel=(layer:string)=>'No of '+layer+(mix?' Mix':'');const layers=layerCount(values.ResponseLayerCount),layerField=webResponseFields.find(f=>f.key==='ResponseLayerCount')!;
 const totals=mixParent&&product?.ProductMixSnapshot?mixTotals(product?.ProductMixSnapshot,product?.MixResponseChildren):undefined;
 const applicable=mixParent&&totals?mixWeightDisplay(totals):values.ApplicableNetWeightGrams||String(netWeight??'');
 const activePlan=savedLoadPlan(values.LoadPlanJSON);
 const weights=packingWeights(applicable,{...values,ApplicableNetWeightGrams:applicable},configuration),load=activePlan?{pallet:activePlan.Inputs.mode==='pallet',floor:activePlan.Inputs.mode==='floor'}:loadSections(configuration);
 const finalOrder=responseOrderFields[layers-1];
 const applied=pricing?.[finalOrder.order]?.LayerCount===layers&&pricing?.[finalOrder.order]?.Fingerprint===results[finalOrder.order]?.Fingerprint?results[finalOrder.order]:undefined;
 useEffect(()=>{
  // Returning to an applied layer restores its trusted server-converted height,
  // never the height from a different final packaging layer.
  if(!mixChild&&!values.HeightMM&&applied?.FinalLayerHeightMM!=null)onChange('HeightMM',applied.FinalLayerHeightMM);
 },[layers,values[finalOrder.type],values.HeightMM,applied?.FinalLayerHeightMM,mixChild]);
 const savedGeometry=Number(product?.EfficiencyLayerCount)===layers&&product?.EfficiencyTypeName===values[finalOrder.type]
  ?{AreaM2:product?.FinalLayerAreaM2,VolumeM3:product?.FinalLayerVolumeM3}:{};
 const loadPlan=savedLoadPlan(values.LoadPlanJSON);
 const tares=layerTares(values.LayerTareJSON);
 for(const order of ['Primary','Secondary','Tertiary'] as const){const result=results[order];if(result?.Tare&&pricing?.[order]?.Fingerprint===result.Fingerprint)tares[order]=result.Tare;}
 const gross=packagingGross(applicable,values,layers,tares,mixParent?mixContentsGross(product?.ProductMixSnapshot,product?.MixResponseChildren):undefined);
 const palletPricing=readPalletPricing(values.PalletPricingJSON);
 const cartonsOnPallet=loadPlan?.Result.cartons_per_pallet??(Number(values.CartonsPerLayer)*Number(weights.layersPerPallet));
 const palletGross=palletPricing?.PalletSize===values.ResponsePalletSize&&palletPricing?.TareKG!=null&&gross[finalOrder.order]!=null&&cartonsOnPallet>0?String(Number((gross[finalOrder.order]!*cartonsOnPallet+Number(palletPricing.TareKG)).toFixed(6))):loadPlan?.Inputs.carton_kg!=null&&loadPlan?.Inputs.pallet_kg!=null?String(Number(loadPlan.Inputs.carton_kg)*loadPlan.Result.cartons_per_pallet+Number(loadPlan.Inputs.pallet_kg)):'';
 const grossDisplay=(v:number|null|undefined)=>decimalDisplay(v,3)??'';
 const selectedPallet=pallets.find(p=>p.PalletSize===values.ResponsePalletSize);
 const palletArea=selectedPallet?.PalletAreaMM2??(product?.ResponsePalletSize===values.ResponsePalletSize?product?.ResponsePalletAreaMM2:null);
 const efficiency=responseEfficiency(applicable,{...values,ApplicableNetWeightGrams:applicable},applied?.ParentGeometryMetrics??savedGeometry,palletArea,totals);
 const unitInput=(key:string,fixed:boolean)=><ResponseInput field={{...webResponseFields.find(f=>f.key===key)!,label:unitLabel(key==='UnitsPerCarton'?'Primary':'Secondary')+' Unit',readOnly:fixed}} value={fixed?'1':values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent}/>;
 const loadInput=(key:string)=>{const base=webResponseFields.find(f=>f.key===key)!,field={...base,readOnly:base.readOnly||!values.SelectedContainerType&&['CartonsPerContainer'].includes(key)};return <label><FieldLabel help={key==='HeightMM'?'From D3 Height in the last confirmed Shipping layer Pricing Calculator. Apply pricing to update it.':undefined}>{field.label}</FieldLabel><span className="pricing-type-field"><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent}/>{key==='ResponsePalletSize'&&itemID&&<IconButton icon="calculator" label="Pallet Pricing Calculator" disabled={loading||!values.ResponsePalletSize} onClick={()=>setPalletCalculator(true)}/>}</span></label>};
 const density=webResponseFields.find(f=>f.key==='NutDensity')!;
 const layerWeights=(order:PackagingOrder,net:string)=><><label className="packing-layer-weight">Net weight (g)<input aria-label={order+' net weight (g)'} size={10} readOnly value={net}/></label><label className="packing-layer-weight">Gross weight (g)<input aria-label={order+' gross weight (g)'} size={10} readOnly value={gross[order]==null?'':grossDisplay(gross[order]!*1000)}/></label></>;
 const dimensionCapture=(order:PackagingOrder)=>{
  const field=responseOrderFields.find(f=>f.order===order)!,input=pricing?.[order],result=results[order];
  const definitionMatches=input&&result&&(input.Fingerprint===result.Fingerprint||input.DimensionID===Number(result.ParentDimension?.ID)&&input.DimensionRowVersion===String(result.ParentDimension?.RowVersion));
  const dimensions=definitionMatches
   ?capturedDimensions(result.ParentDimension,{D1:input.D1??null,D2:input.D2??null,D3:input.D3??null})
   :savedLayerDimensions(product?.LayerDimensionCaptures,order,values[field.type]||'',layers,layers!==layerCount(product?.ResponseLayerCount??product?.RequestedLayerCount));
  const display=dimensionDisplay(dimensions),measured=dimensions.filter(d=>d.Name&&d.Unit&&Number.isFinite(Number(d.Value))&&Number(d.Value)>0);
  return <label className="captured-dimensions" aria-label={order+' captured dimensions'}><span title={display.label}>Dimension</span><span className="captured-dimensions-value">{measured.length?measured.map((d,i)=><span key={i}>{i>0&&String.fromCharCode(32,215,32)}{!mixChild&&order===finalOrder.order&&/height/i.test(d.Name)?<mark className="dimension-height" aria-label={order+" dimension height"}>{decimalDisplay(d.Value,6)}{d.Unit}</mark>:<span>{decimalDisplay(d.Value,6)}{d.Unit}</span>}</span>):display.value}</span></label>;
 };
 const finalDims=applied?capturedDimensions(applied.ParentDimension,pricing?.[finalOrder.order] as unknown as Row):savedLayerDimensions(product?.LayerDimensionCaptures,finalOrder.order,values[finalOrder.type]||'',layers);
 const measuredMM=(name:string)=>{const d=finalDims.find(d=>d.Name.toLowerCase()===name&&d.Unit.toLowerCase()==='mm');return d?Number(d.Value):0};
 const plannerCarton={length:measuredMM('length'),width:measuredMM('width'),height:measuredMM('height')||Number(values.HeightMM)||0};
 const containerSelector=<label><FieldLabel>Container type</FieldLabel><select aria-label="Container type" value={values.SelectedContainerType||''} disabled={loading} onChange={e=>onChange('SelectedContainerType',e.target.value)}><option value="">Choose container type</option>{(feedbackContainers.length?feedbackContainers.map(r=>String(r.Code)):allowedContainerTypes('Both')).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>;
 return <div className="requirement-sections response-sections">
 <section aria-label="Product Info response"><h4>Product Info</h4><div className="packaging-entry-grid">
  <div className="response-product-summary"><strong>{text(product?.ProductCode)} · {text(product?.ProductName)}</strong><span>Net weight: {numberDisplay('WeightGrams',netWeight)??'—'} g · Annual units: {numberDisplay('AnnualUnit',product?.AnnualUnit)??'—'}</span></div>
  <label><FieldLabel help={mixParent?"Sum of each child applicable weight multiplied by its Mix quantity.":"Defaults to the captured Product weight. This weight is used throughout the response calculations."}>Applicable Net weight (g)</FieldLabel><ResponseInput field={{...webResponseFields.find(f=>f.key==='ApplicableNetWeightGrams')!,readOnly:mixParent}} value={applicable} onChange={value=>onChange('ApplicableNetWeightGrams',value)} types={types} loading={loading}/></label>
  <label>Shelf life (days)<input aria-label="Shelf life (days)" readOnly value={decimalDisplay(product?.ShelfLifeDays,0)||''}/></label>
  <GradeSnapshotIcon mix={mix} value={parseGradeSnapshot(product?.ProductGradeSnapshot)}/>
  {!mixParent&&<label><FieldLabel help="Density defaults match the exact Nuts grade, nut type and final ratio. Changing this response does not overwrite an existing shared default unless you select Update.">{density.label}</FieldLabel><span className="response-density-input"><ResponseInput field={density} value={values.NutDensity||''} onChange={value=>onChange('NutDensity',value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent}/>{product?.NutDensityDefault!=null&&values.NutDensity&&decimalDisplay(values.NutDensity,6)!==decimalDisplay(product.NutDensityDefault,6)&&<IconButton icon={values.NutDensityDefaultUpdate==='1'?'check':'refresh'} label={values.NutDensityDefaultUpdate==='1'?'Cancel grade density default update':'Update grade density default'} aria-pressed={values.NutDensityDefaultUpdate==='1'} onClick={()=>onChange('NutDensityDefaultUpdate',values.NutDensityDefaultUpdate==='1'?'0':'1')}/>}</span>{product?.NutDensityDefault!=null&&<small>Grade default: {decimalDisplay(product.NutDensityDefault,6)} g/ml{values.NutDensityDefaultUpdate==='1'?' - will update on Confirm save':''}</small>}{product?.NutDensityCombinationAvailable&&product.NutDensityDefault==null&&<small>New grade combination: default created on save.</small>}</label>}
  <label><FieldLabel help={mixParent?'Sum of each captured child quantity × child net weight (g) / child density (g/ml), from responses in this request. All child densities must be available.':undefined}>{mixParent?'Total Used volume (ml)':'Used volume (ml)'}</FieldLabel><input aria-label={mixParent?'Total Used volume (ml)':'Used volume (ml)'} readOnly value={decimalDisplay((totals?mixVolumeDisplay(totals):usedVolumeDisplay(applicable,values.NutDensity||'')).replaceAll(',',''),3)??''} placeholder={mixParent?'Awaiting child densities':'Net weight / density'}/></label>
  {mixParent&&sameConfigControl}
 </div></section>
 <fieldset className={'response-configuration-fields'+(configReadOnly?' display-only-fields':'')} disabled={configReadOnly}>
 <section aria-label="Packing Way response"><div className="response-section-heading"><h4>Packing Way<InfoTip text="Primary units per Secondary · Secondary units per Tertiary · Final layer = 1"/><small className="response-requested-layers">Requested layers: {layerCount(requestedLayers)}.</small></h4><label><FieldLabel help={configHelp}>{layerField.label}</FieldLabel><ResponseInput field={layerField} value={String(layers)} onChange={v=>onChange(layerField.key,v)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent}/></label></div><div className="packing-way-grid" data-layers={layers}>
  <div className="packing-way-layer" data-shipping={layers===1}><label className="packing-layer-quantity"><FieldLabel help={unitHelp}>{unitLabel('Primary')}</FieldLabel>{unitInput('UnitsPerCarton',layers===1)}</label>{layerWeights('Primary',weights.primary)}{dimensionCapture('Primary')}</div>
  {layers>=2&&<div className="packing-way-layer" data-shipping={layers===2}><label className="packing-layer-quantity"><FieldLabel help={unitHelp}>{unitLabel('Secondary')}</FieldLabel>{unitInput('UnitsPerTertiary',layers===2)}</label>{layerWeights('Secondary',weights.secondary)}{dimensionCapture('Secondary')}</div>}
  {layers===3&&<div className="packing-way-layer" data-shipping><label className="packing-layer-quantity">No of Tertiary<input aria-label="No of Tertiary Unit" readOnly value="1"/></label>{layerWeights('Tertiary',weights.tertiary)}{dimensionCapture('Tertiary')}</div>}
 </div><div hidden>{!mixChild&&loadInput('HeightMM')}</div></section>
 <div className="packaging-layer-sections" data-layers={layers}>{sections.filter(s=>s.level<=layers&&s.label!=='Palletization').map(section=><section key={section.label} aria-label={section.label+' response'}>
  <h4 className="response-layer-symbol" aria-label={section.label} title={section.label}>{["I","II","III"][section.level-1]}</h4><div className="packaging-entry-grid">{section.keys.map(key=>{
   const field=webResponseFields.find(f=>f.key===key)!;
   const order=responseOrderFields.find(f=>f.type===key)?.order;
   const selected=types.find(t=>!!order&&selectableType(t,order,layers,mixChild,mixParent)&&t.PackagingType===values[key]);
   const priceField=responseOrderFields.find(f=>f.price===key);
   return <label key={key}>{field.label}<span className={order?'pricing-type-field':priceField?'response-price-field':''}><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent}/>{priceField&&values[key]&&<span className="response-price-currency">{values[priceField.currency]}</span>}{order&&itemID&&<IconButton icon="calculator" label={order+' Pricing Calculator'} disabled={loading||!selected} onClick={()=>setCalculator({order,typeID:Number(selected!.ID)})}/>}</span></label>;
  })}</div>
 </section>)}</div>
 {!mixChild&&<><section aria-label="Palletization response"><h4>Palletization</h4>
 <div className="response-palletization-grid"><div className="packaging-entry-grid response-pallet-specs">{loadInput('ResponsePalletSize')}{loadInput('ResponsePalletStacking')}{loadInput('ResponseMaxPalletHeightMM')}</div>
 <div className="packaging-entry-grid response-pallet-loading">{loadInput('CartonsPerLayer')}
 <label><FieldLabel help="Whole Shipping layers fitting within maximum height after subtracting pallet base height.">Layers / pallet</FieldLabel><input aria-label="Layers / pallet" readOnly value={weights.layersPerPallet}/></label>
 <label>Units / pallet<input aria-label="Units / pallet" readOnly value={weights.unitsPerPallet}/></label>
 <label>Net weight / Pallet (kg)<input readOnly value={weights.palletKG}/></label>
 <label>Gross weight / Pallet (kg)<input aria-label="Gross weight / Pallet (kg)" readOnly value={decimalDisplay(palletGross,3)??''}/></label>
 </div></div></section>
 <section aria-label="Efficiency response"><h4>Efficiency</h4><div className="packaging-entry-grid response-efficiency-grid">
  <label><FieldLabel help={mixParent?'Sum of captured child quantity × child net weight (g), converted to kg / Shipping occupied m³. No parent density is used.':"Last packaging layer net weight (kg) / Shipping parent's Occupied m³ fx. Missing formula or measurements leave this blank."}>{mixParent?'Mix Carton Efficiency (kg/m3)':'Carton Efficiency (kg/m3)'}</FieldLabel><input readOnly aria-label={mixParent?'Mix Carton Efficiency (kg/m3)':'Carton Efficiency (kg/m3)'} value={efficiency.carton}/></label>
  <label><FieldLabel help={mixParent?'Total Used volume (ml) / 1,000,000 / Shipping occupied m³ × 100.':'Carton Efficiency / Nuts density (g/ml) / 1000 × 100.'}>{mixParent?'Relative mix carton efficiency %':'Relative carton efficiency %'}</FieldLabel><input readOnly aria-label={mixParent?'Relative mix carton efficiency %':'Relative carton efficiency %'} value={efficiency.relative}/></label>
  <label><FieldLabel help="Last Shipping parent's Occupied m² fx × Cartons / layer / Pallet Master area (m²) × 100. This is footprint, not material consumption.">Pallet Utilization %</FieldLabel><input readOnly aria-label="Pallet Utilization %" value={efficiency.utilization}/></label>
  <label>Pallet height (mm)<input aria-label="Pallet height (mm)" readOnly value={efficiency.palletHeight}/></label>
  <label><FieldLabel help="Pallet height / Max pallet height × 100. Pallet height = selected pallet base height (legacy default 150 mm) + Layers / pallet × Shipping height (mm).">Pallet height efficiency %</FieldLabel><input readOnly aria-label="Pallet height efficiency %" value={efficiency.heightEfficiency}/></label>
 </div></section></>}

 {!mixChild&&<section aria-label="Container Load response"><h4 className="container-load-heading">Container Load{itemID&&<IconButton icon="cube" label="3D container load" disabled={values.PalletPricingJSON!==String(product?.PalletPricingJSON??'')} onClick={()=>setLoadPlanner('container')}/>}<InfoTip text="Pallet loading: Carton / Container = Pallet / Container x Layers / pallet x Cartons / layer. Floor load and Both require manual Carton / Container. Net weight uses the applicable final-layer weight."/></h4><div className="packaging-entry-grid response-container-load-grid">
  {containerSelector}{load.pallet&&(loadPlan?<label>Pallet / Container<input readOnly value={loadPlan.Result.loaded_units}/></label>:loadInput('PalletsPerContainer'))}
  {load.pallet||loadPlan?<label>Carton / Container<input aria-label="Carton / Container" readOnly value={weights.containerCartons}/></label>:loadInput('CartonsPerContainer')}
  <label>Net weight / Container (kg)<input aria-label="Net weight / Container (kg)" readOnly value={weights.containerKG}/></label>
  <label>Gross weight / Container (kg)<input aria-label="Gross weight / Container (kg)" readOnly value={loadPlan?grossDisplay(loadPlan.Result.gross_kg):!load.pallet&&gross[finalOrder.order]!=null&&Number(values.CartonsPerContainer)>0?grossDisplay(gross[finalOrder.order]!*Number(values.CartonsPerContainer)):''}/></label>
 </div></section>}
 </fieldset>
 {palletCalculator&&itemID&&<PalletCalculator itemID={itemID} itemVersion={String(product?.ItemRowVersion??product?.RowVersion??'')} size={values.ResponsePalletSize} initial={palletPricing} onApply={p=>onChange('PalletPricingJSON',JSON.stringify(p))} onClose={()=>setPalletCalculator(false)}/>}
 {loadPlanner&&itemID&&<LoadPlanner itemID={itemID} itemVersion={String(product?.ItemRowVersion??product?.RowVersion??'')} configuration={configuration} initialCode={values.SelectedContainerType||loadPlan?.Code} responsePallet={cartonsOnPallet>0?{cartons:cartonsOnPallet,grossKG:palletGross===''?null:Number(palletGross),loadedHeight:efficiency.palletHeight?Number(efficiency.palletHeight.replaceAll(',','')):null}:undefined} palletAssembly={palletPricing} onClear={loadPlan?()=>{onChange('LoadPlanJSON','');setLoadPlanner(null)}:undefined} onConfirm={plan=>onChange('LoadPlanJSON',JSON.stringify(plan))} initial={{cartons_per_layer:Number(values.CartonsPerLayer)||null,mode:load.pallet?'pallet':'floor',max_pallet_height:Number(values.ResponseMaxPalletHeightMM)||null,double_stack:values.ResponsePalletStacking==='Double',stackable:values.ResponsePalletStacking==='Double',carton:plannerCarton}} onClose={()=>setLoadPlanner(null)}/>}
 {calculator&&!configReadOnly&&itemID&&<PkgPricing itemID={itemID} order={calculator.order} layerCount={layers} typeID={calculator.typeID} initial={pricing?.[calculator.order]} initialResult={pricing?.[calculator.order]?.Fingerprint===appliedResults[calculator.order]?.Fingerprint?appliedResults[calculator.order]:undefined} onClose={()=>setCalculator(null)} onApply={(input,result)=>{onPricingApply?.(input,result);setAppliedResults(xs=>({...xs,[input.PackagingOrder]:result}));setCalculator(null)}}/>}</div>;
}
