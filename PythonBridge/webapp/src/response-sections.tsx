import {mixPackingError} from './mix-packing';
import {FloorLoadProposals} from './floor-load-proposals';
import {AddMasterButton,canCreateMaster} from './add-master-button';
import {InlineMasterCreate} from './inline-master-create';
import {useSession} from './session';
import {palletDimensionLabel} from './pallet-label';
import {PalletCalculator,readPalletPricing} from './pallet-calculator';
import {savedLoadPlan,containerPlans} from './load-plan-values';
import {LoadPlanner} from './load-planner';
import {FieldLabel,InfoTip} from './ui';
import {layerTares,packagingGross,mixContentsGross} from './packaging-weight';
import {useEffect,useState,type CSSProperties} from 'react';
import {call,text,type Row} from './api';
import {IconButton} from './icons';
import {PkgPricing,PricingHistory,type PricingCalculation,type PricingResult} from './pkg-pricing';
import {webResponseFields} from './packaging-fields';
import {ResponseInput,ResponseEditable} from './response-input';
import {usedVolumeDisplay} from './response-volume';
import {packingWeights,loadSections} from './packing-way';
import {decimalDisplay,numberDisplay} from './number-format';
import {layerCount,responseOrderFields,selectableType,isMixParent,packagingStart,globalOrder,packagingOrders,type PackagingOrder} from './packaging-orders';
import {GradeSnapshotIcon,parseGradeSnapshot} from './opportunity-grade-snapshot';import {parseMixStructure,mixFormula} from './mix-structure';
import {responseEfficiency,mixTotals,mixVolumeDisplay,mixWeightValue} from './response-efficiency';
import {capturedDimensions,dimensionDisplay,savedLayerDimensions,shippingDimensionsMM,type CapturedDimension} from './response-dimensions';
import {allowedContainerTypes,containerChange,parseContainerProfiles,proposedContainers,proposalProfiles,containerTypes,requestedContainers,requiredContainers} from './container-loading';

const sections=[
 {label:'Primary packaging',level:1,keys:['FirstPMType','FirstPMMOQ','PrimaryPricePerUnit']},
 {label:'Secondary packaging',level:2,keys:['SecondPMType','SecondPMMOQ','SecondaryPricePerUnit']},
 {label:'Tertiary packaging',level:3,keys:['ThirdPMType','ThirdPMMOQ','TertiaryPricePerUnit']},
 {label:'Quaternary packaging',level:4,keys:['FourthPMType','FourthPMMOQ','QuaternaryPricePerUnit']},
 {label:'Palletization',level:1,keys:['CartonsPerLayer','LayersPerPallet','UnitsPerPallet']}
];

export function responseChange(values:Record<string,string>,pricing:Record<string,PricingCalculation>,key:string,value:string,pallets:Row[]=[],configuration?:unknown,source?:Row){
 let floorProposalCode:string|null=null;
 if(key==='FloorProposal'){
  const proposal=JSON.parse(value);floorProposalCode=proposal.checked?proposal.code:null;
  key='ContainerLoadProfiles';value=proposalProfiles(values,source??{},proposal.code,proposal.checked,proposal.count);
 }
 const next=containerChange(values,key,value,pallets,configuration),calculations={...pricing};if(key==='NutDensity')next.NutDensityDefaultUpdate='0';
 if(key==='ResponsePalletMaterialID'){next.CartonsPerLayer='';next.LayersPerPallet='';let selected:any=null;try{selected=JSON.parse(value)}catch{}next.ResponsePalletMaterialID=selected?.ID?String(selected.ID):'';next.ResponsePalletSize=selected?.PalletSize||'';next.PalletPricingJSON='';next.LoadPlanJSON='';next.ContainerPlansJSON='{}';}
 if(key==='ResponsePalletSize'&&value!==values[key])next.PalletPricingJSON='';
 if(key==='ResponseMaxPalletHeightMM'&&value!==values[key]){next.CartonsPerLayer='';next.LayersPerPallet='';}
 if(key==='PalletPricingJSON'){next.LoadPlanJSON='';try{const p=JSON.parse(value);if(p?.PalletMaterialID)next.ResponsePalletMaterialID=String(p.PalletMaterialID)}catch{}}
 if(key==='LoadPlanJSON'){const plan=savedLoadPlan(value);if(plan&&['Floor load','Both'].includes(String(configuration))){next.CartonsPerContainer=String(plan.Result.cartons)}}
 if(['ApplicableNetWeightGrams','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','LayersPerPallet','SelectedContainerType','ResponseLayerCount','FirstPMType','SecondPMType','ThirdPMType','FourthPMType','UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary'].includes(key)&&value!==values[key])next.LoadPlanJSON='';
 const changed=responseOrderFields.find(f=>f.type===key||f.moq===key);
 if(key==='HeightMM')next.LayersPerPallet='';
 if(key==='CartonsPerContainer'&&value!==values[key]){next.LoadPlanJSON='';const plans=containerPlans(values.ContainerPlansJSON);delete plans[values.SelectedContainerType];next.ContainerPlansJSON=JSON.stringify(plans);}
 if(key==='ContainerLoadProfiles'){
  const before=parseContainerProfiles(values.ContainerLoadProfiles),after=parseContainerProfiles(value),plans=containerPlans(values.ContainerPlansJSON);
  for(const code of Object.keys(after))if((after[code].CartonsPerContainer??null)!==(before[code]?.CartonsPerContainer??null)){delete plans[code];if(code===values.SelectedContainerType){next.LoadPlanJSON='';next.CartonsPerContainer=after[code].CartonsPerContainer??''}}
  if(floorProposalCode&&plans[floorProposalCode]?.Inputs.mode==='pallet'){delete plans[floorProposalCode];if(floorProposalCode===values.SelectedContainerType)next.LoadPlanJSON=''}
  if(floorProposalCode&&!values.SelectedContainerType){next.SelectedContainerType=floorProposalCode;next.CartonsPerContainer=after[floorProposalCode]?.CartonsPerContainer??'';next.LoadPlanJSON=''}
  next.ContainerPlansJSON=JSON.stringify(plans);
 }
 if(key==='ResponseLayerCount'||responseOrderFields[layerCount(values.ResponseLayerCount)-1].type===key){next.HeightMM='';next.LayersPerPallet=''}
 if(changed){const tares=layerTares(values.LayerTareJSON);delete tares[changed.order];next.LayerTareJSON=JSON.stringify(tares);delete calculations[changed.order];next[changed.moq]='';next[changed.price]='';next[changed.currency]=''}
 if(key==='ResponseLayerCount'&&source&&layerCount(value)===layerCount(source.ResponseLayerCount??source.RequestedLayerCount)){
  const field=responseOrderFields[layerCount(value)-1];
  if(next[field.type]===String(source[field.type]??'')&&next[field.moq]===String(source[field.moq]??''))next.HeightMM=String(source.HeightMM??'');
 }
 if(key==='LoadPlanJSON'&&value){const plan=savedLoadPlan(value);if(plan?.Code){const plans=containerPlans(values.ContainerPlansJSON);plans[plan.Code]=plan;next.ContainerPlansJSON=JSON.stringify(plans);next.SelectedContainerType=plan.Code}}
 if(key==='SelectedContainerType'){const plans=containerPlans(values.ContainerPlansJSON),old=savedLoadPlan(values.LoadPlanJSON);if(old?.Code)plans[old.Code]=old;next.ContainerPlansJSON=JSON.stringify(plans);next.LoadPlanJSON=plans[value]?JSON.stringify(plans[value]):''}
 if(['ApplicableNetWeightGrams','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','LayersPerPallet','ResponseLayerCount','FirstPMType','SecondPMType','ThirdPMType','FourthPMType','UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary','PalletPricingJSON'].includes(key)&&value!==values[key])next.ContainerPlansJSON='{}';
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
 if(source&&['SelectedContainerType','CartonsPerContainer','LoadPlanJSON','ContainerLoadProfiles'].includes(key)){
  const profiles=parseContainerProfiles(next.ContainerLoadProfiles);
  if(!Object.values(profiles).some(p=>p.Proposal!=null)){
   const existing=proposedContainers(values,source);
   for(const code of containerTypes)profiles[code]={...profiles[code],Proposal:existing.includes(code)?'1':'0'};
   next.ContainerLoadProfiles=JSON.stringify(profiles);
  }
  const requested=requestedContainers(source);
  if(!requested.some(code=>profiles[code]?.Proposal==='1')){profiles[requested[0]]={...profiles[requested[0]],Proposal:'1'};next.ContainerLoadProfiles=JSON.stringify(profiles)}
 }
 return {values:next,pricing:calculations};
}

export function ResponseSections({values,requestedLayers,netWeight,configuration,product,sameConfigControl,configHelp,configReadOnly=false,editable=true,onChange,types:providedTypes,onTypesChanged,pallets=[],loading,itemID,pricing,pricingResults,onPricingApply}:{values:Record<string,string>;requestedLayers?:unknown;netWeight:unknown;configuration?:unknown;product?:Row;sameConfigControl?:React.ReactNode;configHelp?:string;configReadOnly?:boolean;editable?:boolean;onChange:(key:string,value:string)=>void;types:Row[];onTypesChanged?:(types:Row[])=>void;pallets?:Row[];loading:boolean;itemID?:number;pricing?:Record<string,PricingCalculation>;pricingResults?:Record<string,PricingResult>;onPricingApply?:(input:PricingCalculation,result:PricingResult)=>void}){
 const session=useSession(),[masterTypes,setMasterTypes]=useState<Row[]|null>(null),[typeTarget,setTypeTarget]=useState<string|null>(null);
 const types=onTypesChanged?providedTypes:masterTypes??providedTypes;
 const [newMaster,setNewMaster]=useState<'materials'|'containers'|null>(null);
 async function refreshPallets(record?:Row){const data=await call<{rows:Row[]}>('/api/pallet-pricing/pallets');setPalletMaterials(data.rows);if(record){const selected=data.rows.find(r=>Number(r.ID)===Number(record.ID));if(selected)onChange('ResponsePalletMaterialID',JSON.stringify(selected));else if(String(record.ID)===values.ResponsePalletMaterialID)onChange('ResponsePalletMaterialID','null')}}
 async function refreshContainers(record?:Row){const data=await call<{rows:Row[]}>('/api/load-planning/containers');setFeedbackContainers(data.rows.filter(r=>r.Status==='Active'));if(record&&record.Status==='Active')onChange('SelectedContainerType',String(record.Code))}
 async function refreshTypes(){const d=await call<{packagingTypes:Row[]}>('/api/packaging/lookups');setMasterTypes(d.packagingTypes);onTypesChanged?.(d.packagingTypes)}
 const [palletMaterials,setPalletMaterials]=useState<Row[]>([]);
 useEffect(()=>{if(!product?.ParentItemID)call<{rows:Row[]}>('/api/pallet-pricing/pallets').then(x=>setPalletMaterials(x.rows)).catch(()=>setPalletMaterials([]))},[product?.ParentItemID]);
 const [feedbackContainers,setFeedbackContainers]=useState<Row[]>([]);
 useEffect(()=>{if(!product?.ParentItemID)call<{rows:Row[]}>('/api/load-planning/containers').then(x=>setFeedbackContainers(x.rows.filter(r=>r.Status==='Active'))).catch(()=>setFeedbackContainers([]))},[product?.ParentItemID]);
 const [reviewContainer,setReviewContainer]=useState('');
 const [palletCalculator,setPalletCalculator]=useState(false);
 const [loadPlanner,setLoadPlanner]=useState<'pallet'|'container'|null>(null);
 const [calculator,setCalculator]=useState<{order:PackagingOrder;typeID:number}|null>(null);
 const [appliedResults,setAppliedResults]=useState<Record<string,PricingResult>>({});
 const results={...appliedResults,...pricingResults};
 const start=packagingStart(product);
 const mixParent=isMixParent(product);const mixChild=!!product?.ParentItemID,mix=mixChild?null:parseMixStructure(product?.ProductMixSnapshot),unitHelp=mixFormula(mix),unitLabel=(layer:string)=>'No of '+globalOrder(layer,start);const layers=layerCount(values.ResponseLayerCount),layerField=webResponseFields.find(f=>f.key==='ResponseLayerCount')!;
 function copiedDimensions(order:PackagingOrder):CapturedDimension[]|null{try{const copy=JSON.parse(values.ReferenceSetupJSON||'{}')[globalOrder(order,start)],field=responseOrderFields.find(f=>f.order===order)!;return copy?.values?.[field.type]===values[field.type]&&Array.isArray(copy.dimensions)?copy.dimensions:null}catch{return null}}
 const totals=mixParent?mixTotals(product?.ProductMixSnapshot,product?.MixResponseChildren):undefined;
 const applicable=mixParent&&totals?mixWeightValue(totals):values.ApplicableNetWeightGrams||String(netWeight??'');
 const displayValues=(!editable||configReadOnly)&&reviewContainer?responseChange(values,{},'SelectedContainerType',reviewContainer,pallets,configuration).values:values;
 values=displayValues;
 const activePlan=savedLoadPlan(values.LoadPlanJSON);
 const finalOrder=responseOrderFields[layers-1];
 const applied=pricing?.[finalOrder.order]?.LayerCount===layers&&pricing?.[finalOrder.order]?.Fingerprint===results[finalOrder.order]?.Fingerprint?results[finalOrder.order]:undefined;
 const finalDims=applied?capturedDimensions(applied.ParentDimension,pricing?.[finalOrder.order] as unknown as Row):copiedDimensions(finalOrder.order)??savedLayerDimensions(product?.LayerDimensionCaptures,finalOrder.order,values[finalOrder.type]||'',layers);
 // Preview from the same matched final-layer geometry that is displayed. Do not
 // mutate the draft or persist derived totals merely because the screen renders.
 const capturedHeight=finalDims.find(d=>d.Name.trim().toLowerCase()==='height'&&d.Unit.toLowerCase()==='mm');
 const height=applied?.FinalLayerHeightMM??(values.HeightMM||(capturedHeight&&Number(capturedHeight.Value)>0?capturedHeight.Value:''));
 const previewValues:Record<string,string>={...values,HeightMM:String(height??''),ApplicableNetWeightGrams:applicable};
 const palletPricing=readPalletPricing(values.PalletPricingJSON);
 const palletMaterial=palletMaterials.find(p=>String(p.ID)===values.ResponsePalletMaterialID);
 const palletTare=palletPricing?.PalletSize===values.ResponsePalletSize?palletPricing.TareKG:editable&&!configReadOnly?palletMaterial?.TareKG:undefined;
 const palletBase=palletMaterial?.Dimensions as {height?:string}|undefined;
 if(editable&&!configReadOnly&&!palletPricing&&palletBase?.height)previewValues.PalletPricingJSON=JSON.stringify({PalletSize:values.ResponsePalletSize,Dimensions:palletBase});
 const weights=packingWeights(applicable,previewValues,configuration),load=activePlan?{pallet:activePlan.Inputs.mode==='pallet',floor:activePlan.Inputs.mode==='floor'}:loadSections(configuration);
 useEffect(()=>{
  // Returning to an applied layer restores its trusted server-converted height,
  // never the height from a different final packaging layer.
  if(editable&&!configReadOnly&&!mixChild&&!values.HeightMM&&applied?.FinalLayerHeightMM!=null)onChange('HeightMM',applied.FinalLayerHeightMM);
 },[layers,values[finalOrder.type],values.HeightMM,applied?.FinalLayerHeightMM,mixChild,editable,configReadOnly]);
 const savedGeometry=Number(product?.EfficiencyLayerCount)===layers&&product?.EfficiencyTypeName===values[finalOrder.type]
  ?{AreaM2:product?.FinalLayerAreaM2,VolumeM3:product?.FinalLayerVolumeM3}:{};
 const loadPlan=savedLoadPlan(values.LoadPlanJSON);
 const tares=layerTares(values.LayerTareJSON);
 for(const order of packagingOrders){const result=results[order];if(result?.Tare&&pricing?.[order]?.Fingerprint===result.Fingerprint)tares[order]=result.Tare;}
 const gross=packagingGross(applicable,values,layers,tares,mixParent?mixContentsGross(product?.ProductMixSnapshot,product?.MixResponseChildren):undefined);

 const cartonsOnPallet=loadPlan?.Result.cartons_per_pallet??(Number(values.CartonsPerLayer)*Number(weights.layersPerPallet));
 const palletGross=palletTare!=null&&gross[finalOrder.order]!=null&&cartonsOnPallet>0?String(Number((gross[finalOrder.order]!*cartonsOnPallet+Number(palletTare)).toFixed(6))):loadPlan?.Inputs.carton_kg!=null&&loadPlan?.Inputs.pallet_kg!=null?String(Number(loadPlan.Inputs.carton_kg)*loadPlan.Result.cartons_per_pallet+Number(loadPlan.Inputs.pallet_kg)):'';
 const grossDisplay=(v:number|null|undefined)=>decimalDisplay(v,3)??'';
 const selectedPallet=pallets.find(p=>p.PalletSize===values.ResponsePalletSize);
 const palletArea=selectedPallet?.PalletAreaMM2??(product?.ResponsePalletSize===values.ResponsePalletSize?product?.ResponsePalletAreaMM2:null);
 const efficiency=responseEfficiency(applicable,previewValues,applied?.ParentGeometryMetrics??savedGeometry,palletArea,totals);
 const unitInput=(key:string,fixed:boolean)=><ResponseInput field={{...webResponseFields.find(f=>f.key===key)!,label:unitLabel(key==='UnitsPerCarton'?'Primary':key==='UnitsPerTertiary'?'Secondary':'Tertiary')+' Unit',readOnly:fixed}} value={fixed?'1':values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent} start={start}/>;
 const loadInput=(key:string)=>{const base=webResponseFields.find(f=>f.key===key)!,field={...base,readOnly:base.readOnly||!values.SelectedContainerType&&['CartonsPerContainer'].includes(key)};return <label><FieldLabel help={key==='HeightMM'?'From D3 Height in the last confirmed Shipping layer Pricing Calculator. Apply pricing to update it.':undefined}>{field.label}</FieldLabel><span className="pricing-type-field"><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent} start={start}/>{key==='ResponsePalletSize'&&itemID&&<IconButton icon="calculator" label="Pallet Pricing Calculator" disabled={loading||!values.ResponsePalletSize} onClick={()=>setPalletCalculator(true)}/>}</span></label>};
 const density=webResponseFields.find(f=>f.key==='NutDensity')!;
 const layerWeights=(order:PackagingOrder,net:string)=><><label className="packing-layer-weight">Net weight (g)<input aria-label={order+' net weight (g)'} size={10} readOnly value={net}/></label><label className="packing-layer-weight">Gross weight (g)<input aria-label={order+' gross weight (g)'} size={10} readOnly value={gross[order]==null?'':grossDisplay(gross[order]!*1000)}/></label></>;
 const dimensionCapture=(order:PackagingOrder)=>{
  const field=responseOrderFields.find(f=>f.order===order)!,input=pricing?.[order],result=results[order];
  const definitionMatches=input&&result&&(input.Fingerprint===result.Fingerprint||input.DimensionID===Number(result.ParentDimension?.ID)&&input.DimensionRowVersion===String(result.ParentDimension?.RowVersion));
  const dimensions=definitionMatches
   ?capturedDimensions(result.ParentDimension,{D1:input.D1??null,D2:input.D2??null,D3:input.D3??null})
   :copiedDimensions(order)??savedLayerDimensions(product?.LayerDimensionCaptures,order,values[field.type]||'',layers,layers!==layerCount(product?.ResponseLayerCount??product?.RequestedLayerCount));
  const display=dimensionDisplay(dimensions),measured=dimensions.filter(d=>d.Name&&d.Unit&&Number.isFinite(Number(d.Value))&&Number(d.Value)>0);
  return <label className="captured-dimensions" aria-label={order+' captured dimensions'}><span title={display.label}>Dimension</span><span className="captured-dimensions-value">{measured.length?measured.map((d,i)=><span key={i}>{i>0&&String.fromCharCode(32,215,32)}{!mixChild&&order===finalOrder.order&&/height/i.test(d.Name)?<mark className="dimension-height" aria-label={order+" dimension height"}>{decimalDisplay(d.Value,6)}{d.Unit}</mark>:<span>{decimalDisplay(d.Value,6)}{d.Unit}</span>}</span>):display.value}</span></label>;
 };

 const shippingDimensions=shippingDimensionsMM(finalDims);
 const plannerCarton={...shippingDimensions,height:shippingDimensions.height||Number(previewValues.HeightMM)||0};
 const [capacityError,setCapacityError]=useState('');
 const capacityBody=JSON.stringify({PalletMaterialID:Number(values.ResponsePalletMaterialID)||null,Carton:plannerCarton,CartonGrossKG:gross[finalOrder.order],TareKG:palletTare,MaxPalletHeightMM:Number(values.ResponseMaxPalletHeightMM)||null});
 useEffect(()=>{const body=JSON.parse(capacityBody);if(!itemID||!editable||configReadOnly||mixChild||!body.PalletMaterialID||!body.CartonGrossKG||body.TareKG==null||!body.MaxPalletHeightMM||Object.values(body.Carton).some(v=>!v))return;let active=true;const timer=setTimeout(()=>{call<{cartons_per_layer:number;pallet_layers:number}>('/api/packaging/items/'+itemID+'/pallet-capacity',body).then(c=>{if(!active)return;setCapacityError('');if(!values.CartonsPerLayer&&c.cartons_per_layer>0){onChange('CartonsPerLayer',String(c.cartons_per_layer));return;}if(!values.LayersPerPallet&&c.pallet_layers>0)onChange('LayersPerPallet',String(c.pallet_layers))}).catch(e=>{if(active)setCapacityError(e.message)})},300);return()=>{active=false;clearTimeout(timer)}},[capacityBody,itemID,editable,configReadOnly,values.CartonsPerLayer,values.LayersPerPallet]);
 const containerSelector=<label><FieldLabel>Container type</FieldLabel><span className="pricing-type-field"><select aria-label="Container type" value={values.SelectedContainerType||''} disabled={loading} onChange={e=>editable&&!configReadOnly?onChange('SelectedContainerType',e.target.value):setReviewContainer(e.target.value)}><option value="">Choose container type</option>{(feedbackContainers.length?feedbackContainers.map(r=>String(r.Code)):allowedContainerTypes('Both')).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>{editable&&!configReadOnly&&canCreateMaster(session,'containers')&&<AddMasterButton entity="containers" selectedValue={values.SelectedContainerType} disabled={loading} onClick={()=>setNewMaster('containers')} onEdited={refreshContainers}/>}</span></label>;
 return <ResponseEditable.Provider value={editable}><div className="requirement-sections response-sections">
 {newMaster&&<InlineMasterCreate entity={newMaster} materialType={newMaster==='materials'?'Pallet':undefined} onClose={()=>setNewMaster(null)} onSaved={records=>{setNewMaster(null);void (newMaster==='materials'?refreshPallets(records[0]):refreshContainers(records[0]))}}/>}
 <section aria-label="Product Info response"><h4>Product Info</h4><div className="packaging-entry-grid">
  <div className="response-product-summary"><strong>{text(product?.ProductCode)} · {text(product?.ProductName)}</strong><span>Net weight: {numberDisplay('WeightGrams',netWeight)??'—'} g · Annual units: {numberDisplay('AnnualUnit',product?.AnnualUnit)??'—'}</span></div>
  <label><FieldLabel help={mixParent?"Sum of each child applicable weight multiplied by its Mix quantity.":"Defaults to the captured Product weight. This weight is used throughout the response calculations."}>Applicable Net weight (g)</FieldLabel><ResponseInput field={{...webResponseFields.find(f=>f.key==='ApplicableNetWeightGrams')!,readOnly:mixParent}} value={applicable} onChange={value=>onChange('ApplicableNetWeightGrams',value)} types={types} loading={loading}/></label>
  <label>Shelf life (days)<input aria-label="Shelf life (days)" readOnly value={decimalDisplay(product?.ShelfLifeDays,0)||''}/></label>
  <GradeSnapshotIcon mix={mix} value={parseGradeSnapshot(product?.ProductGradeSnapshot)}/>
  {!mixParent&&<label><FieldLabel help="Density defaults match the exact Nuts grade, nut type and final ratio. Changing this response does not overwrite an existing shared default unless you select Update.">{density.label}</FieldLabel><span className="response-density-input"><ResponseInput field={density} value={values.NutDensity||''} onChange={value=>onChange('NutDensity',value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent} start={start}/>{editable&&product?.NutDensityDefault!=null&&values.NutDensity&&decimalDisplay(values.NutDensity,6)!==decimalDisplay(product.NutDensityDefault,6)&&<IconButton icon={values.NutDensityDefaultUpdate==='1'?'check':'refresh'} label={values.NutDensityDefaultUpdate==='1'?'Cancel grade density default update':'Update grade density default'} aria-pressed={values.NutDensityDefaultUpdate==='1'} onClick={()=>onChange('NutDensityDefaultUpdate',values.NutDensityDefaultUpdate==='1'?'0':'1')}/>}</span>{product?.NutDensityDefault!=null&&<small>Grade default: {decimalDisplay(product.NutDensityDefault,6)} g/ml{values.NutDensityDefaultUpdate==='1'?' - will update on Confirm save':''}</small>}{product?.NutDensityCombinationAvailable&&product.NutDensityDefault==null&&<small>New grade combination: default created on save.</small>}</label>}
  <label><FieldLabel help={mixParent?'Sum of each captured child quantity × child net weight (g) / child density (g/ml), from responses in this request. All child densities must be available.':undefined}>{mixParent?'Total Used volume (ml)':'Used volume (ml)'}</FieldLabel><input aria-label={mixParent?'Total Used volume (ml)':'Used volume (ml)'} readOnly value={decimalDisplay((totals?mixVolumeDisplay(totals):usedVolumeDisplay(applicable,values.NutDensity||'')).replaceAll(',',''),3)??''} placeholder={mixParent?'Awaiting child densities':'Net weight / density'}/></label>
  {mixParent&&sameConfigControl}
 </div></section>
 <fieldset className={'response-configuration-fields'+(configReadOnly?' display-only-fields':'')} ><ResponseEditable.Provider value={editable&&!configReadOnly}>
 <section aria-label="Packing Way response"><div className="response-section-heading"><h4>Packing Way<InfoTip text="Primary units per Secondary · Secondary units per Tertiary · Final layer = 1"/><small className="response-requested-layers">Requested layers: {layerCount(requestedLayers)}.</small></h4><label><FieldLabel help={configHelp}>{layerField.label}</FieldLabel><ResponseInput field={layerField} value={String(layers)} onChange={v=>onChange(layerField.key,v)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent} start={start}/></label></div><div className="packing-way-grid" data-layers={layers}>
  <div className="packing-way-layer" data-shipping={layers===1}><label className="packing-layer-quantity"><FieldLabel help={unitHelp}>{unitLabel('Primary')}</FieldLabel>{unitInput('UnitsPerCarton',layers===1)}</label>{layerWeights('Primary',weights.primary)}{dimensionCapture('Primary')}</div>
  {layers>=2&&<div className="packing-way-layer" data-shipping={layers===2}><label className="packing-layer-quantity"><FieldLabel help={unitHelp}>{unitLabel('Secondary')}</FieldLabel>{unitInput('UnitsPerTertiary',layers===2)}</label>{layerWeights('Secondary',weights.secondary)}{dimensionCapture('Secondary')}</div>}
  {layers>=3&&<div className="packing-way-layer" data-shipping={layers===3}><label className="packing-layer-quantity">{unitLabel('Tertiary')}{unitInput('UnitsPerQuaternary',layers===3)}</label>{layerWeights('Tertiary',weights.tertiary)}{dimensionCapture('Tertiary')}</div>}
 {layers===4&&<div className="packing-way-layer" data-shipping><label className="packing-layer-quantity">{unitLabel('Quaternary')}<input readOnly value="1"/></label>{layerWeights('Quaternary',weights.quaternary)}{dimensionCapture('Quaternary')}</div>}
 </div>{mixChild&&<><small>Parent composition: {String(product?.CapturedMixUnitQuantity??'not captured')} smallest units. Final-package units must divide this quantity exactly.</small>{mixPackingError(product?.CapturedMixUnitQuantity,values)&&<p role="alert">{mixPackingError(product?.CapturedMixUnitQuantity,values)}</p>}</>}<div hidden>{!mixChild&&loadInput('HeightMM')}</div></section>
 <div className="packaging-layer-sections" data-layers={layers}>{sections.filter(s=>s.level<=layers&&s.label!=='Palletization').map(section=><section key={section.label} aria-label={section.label+' response'}>
  <h4 className="response-layer-symbol" aria-label={section.label} title={section.label}>{["I","II","III","IV"][start+section.level-2]}</h4><div className="packaging-entry-grid">{section.keys.map(key=>{
   const field=webResponseFields.find(f=>f.key===key)!;
   const order=responseOrderFields.find(f=>f.type===key)?.order;
   const selected=types.find(t=>!!order&&selectableType(t,order,layers,mixChild,mixParent,start)&&t.PackagingType===values[key]);
   const priceField=responseOrderFields.find(f=>f.price===key);
   return <label key={key}>{order?globalOrder(order,start)+' Type':priceField?'Price per Unit':'MOQ Unit'}<span className={order?'pricing-type-field':priceField?'response-price-field':''} style={priceField?{'--price-width':(decimalDisplay(values[key],9)?.length||1)+'ch'} as CSSProperties:undefined}><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers} mixChild={mixChild} mixParent={mixParent} start={start}/>{priceField&&values[key]&&<span className="response-price-currency">{values[priceField.currency]}</span>}{order&&editable&&!configReadOnly&&canCreateMaster(session,'packaging-types')&&<AddMasterButton entity="packaging-types" selectedValue={selected?.ID as number|undefined} onEdited={async record=>{await refreshTypes();onChange(key,String(record.PackagingType))}} onClick={()=>setTypeTarget(key)}/>} {order&&itemID&&<IconButton icon="calculator" label={globalOrder(order,start)+' Pricing Calculator'} disabled={loading||editable&&!configReadOnly&&!selected} onClick={()=>setCalculator({order,typeID:Number(selected?.ID)||0})}/>}</span></label>;
  })}</div>
 </section>)}</div>
 {!mixChild&&<><section aria-label="Palletization response"><h4>Palletization</h4>{capacityError&&<p role="alert">{capacityError}</p>}
 <div className="response-palletization-grid"><div className="packaging-entry-grid response-pallet-specs"><label>Pallet<span className="pricing-type-field"><select aria-label="Pallet" disabled={!editable||configReadOnly} value={values.ResponsePalletMaterialID|| (values.ResponsePalletSize?'legacy':'')} onChange={e=>onChange('ResponsePalletMaterialID',JSON.stringify(palletMaterials.find(m=>String(m.ID)===e.target.value)||null))}><option value="">Choose pallet material</option>{!values.ResponsePalletMaterialID&&values.ResponsePalletSize&&<option value="legacy" disabled>{palletDimensionLabel({PalletSize:values.ResponsePalletSize})}</option>}{values.ResponsePalletMaterialID&&!palletMaterials.some(m=>String(m.ID)===values.ResponsePalletMaterialID)&&<option value={values.ResponsePalletMaterialID} disabled>{palletDimensionLabel({PalletSize:values.ResponsePalletSize})||'Unavailable pallet'} — material #{values.ResponsePalletMaterialID}</option>}{palletMaterials.map(m=><option key={String(m.ID)} value={String(m.ID)}>{palletDimensionLabel(m)} — {String(m.MaterialName)}</option>)}</select>{editable&&!configReadOnly&&canCreateMaster(session,'materials')&&<AddMasterButton entity="materials" label="Add new Pallet master" disabled={loading} onClick={()=>setNewMaster('materials')} onEdited={refreshPallets}/>}{itemID&&<IconButton icon="calculator" label="Pallet Pricing Calculator" disabled={loading||!values.ResponsePalletSize} onClick={()=>setPalletCalculator(true)}/>}</span>{palletMaterial?.MaxPayloadKG!=null&&<small aria-label="Pallet max payload">Max payload: {decimalDisplay(palletMaterial.MaxPayloadKG,3)} kg</small>}</label>{loadInput('ResponsePalletStacking')}{loadInput('ResponseMaxPalletHeightMM')}</div>
 <div className="packaging-entry-grid response-pallet-loading">{loadInput('CartonsPerLayer')}
 <label><FieldLabel help="Whole Shipping layers fitting within maximum height after subtracting pallet base height.">Layers / pallet</FieldLabel><ResponseInput field={{key:"LayersPerPallet",label:"Layers / pallet",numeric:true,integer:true}} value={values.LayersPerPallet||weights.layersPerPallet} onChange={v=>onChange("LayersPerPallet",v)} types={types} loading={loading}/></label>
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

 {!mixChild&&<section aria-label="Container Load response"><h4 className="container-load-heading">Container Load{itemID&&<IconButton icon="cube" label="3D container load" disabled={!['Floor load','Both'].includes(String(configuration))&&values.PalletPricingJSON!==String(product?.PalletPricingJSON??'')} onClick={()=>setLoadPlanner('container')}/>}<InfoTip text="Pallet loading: Carton / Container = Pallet / Container x Layers / pallet x Cartons / layer. Floor load and Both propose feasible Carton / Container with manual overrides. Net weight uses the applicable final-layer weight."/></h4><div className="packaging-entry-grid response-container-load-grid">
  {containerSelector}{load.pallet&&(loadPlan?<label>Pallet / Container<input readOnly value={loadPlan.Result.loaded_units}/></label>:loadInput('PalletsPerContainer'))}
  {load.pallet?<label>Carton / Container<input aria-label="Carton / Container" readOnly value={weights.containerCartons}/></label>:loadInput('CartonsPerContainer')}
  <label>Net weight / Container (kg)<input aria-label="Net weight / Container (kg)" readOnly value={weights.containerKG}/></label>
  <label>Gross weight / Container (kg)<input aria-label="Gross weight / Container (kg)" readOnly value={loadPlan?grossDisplay(loadPlan.Result.gross_kg):!load.pallet&&gross[finalOrder.order]!=null&&Number(values.CartonsPerContainer)>0?grossDisplay(gross[finalOrder.order]!*Number(values.CartonsPerContainer)):''}/></label>
 </div>{itemID&&['Floor load','Both'].includes(String(configuration))&&<FloorLoadProposals required={requiredContainers(proposedContainers(values,product??{}),product??{})} palletCodes={Object.values(containerPlans(values.ContainerPlansJSON)).filter(p=>p.Inputs.mode==='pallet').map(p=>p.Code!)} profilesJSON={values.ContainerLoadProfiles||''} proposed={proposedContainers(values,product??{})} onProposal={(code,checked,count)=>onChange('FloorProposal',JSON.stringify({code,checked,count}))} netKG={Number([weights.primary,weights.secondary,weights.tertiary,weights.quaternary][layers-1].replaceAll(',',''))/1000||null} open={loadPlanner==='container'} renderPlanner={(floorPanel,floorActions)=><LoadPlanner requiredProposed={requiredContainers(proposedContainers(values,product??{}),product??{})} floorProposed={proposedContainers(values,product??{}).filter(code=>containerPlans(values.ContainerPlansJSON)[code]?.Inputs.mode!=='pallet'&&configuration!=='Pallet load')} proposed={proposedContainers(values,product??{})} onProposal={editable&&!configReadOnly?(code,checked,count)=>onChange('ContainerLoadProfiles',proposalProfiles(values,product??{},code,checked,count)):undefined} itemID={itemID!} itemVersion={String(product?.ItemRowVersion??product?.RowVersion??'')} configuration={configuration} initialCode={values.SelectedContainerType||loadPlan?.Code||requestedContainers(product??{})[0]} responsePallet={cartonsOnPallet>0?{cartons:cartonsOnPallet,grossKG:palletGross===''?null:Number(palletGross),loadedHeight:efficiency.palletHeight?Number(efficiency.palletHeight.replaceAll(',','')):null}:undefined} initial={{mode:'floor',double_stack:values.ResponsePalletStacking==='Double',stackable:values.ResponsePalletStacking==='Double',carton:plannerCarton,max_pallet_height:Number(values.ResponseMaxPalletHeightMM)||null,cartons_per_layer:Number(values.CartonsPerLayer)||null}} palletAssembly={palletPricing} onConfirm={editable&&!configReadOnly?plan=>onChange('LoadPlanJSON',JSON.stringify(plan)):undefined} onClose={()=>setLoadPlanner(null)} floorPanel={floorPanel} floorActions={floorActions}/>} onClose={()=>setLoadPlanner(null)} itemID={itemID} carton={plannerCarton} grossKG={gross[finalOrder.order]} selected={values.SelectedContainerType||''} count={values.CartonsPerContainer||''} editable={editable&&!configReadOnly} onSelect={value=>onChange('SelectedContainerType',value)} onCount={value=>onChange('CartonsPerContainer',value)}/>}</section>}
 </ResponseEditable.Provider></fieldset>
 {typeTarget&&<InlineMasterCreate entity="packaging-types" initialValues={{PackagingOrders:responseOrderFields.find(f=>f.type===typeTarget)?.order?globalOrder(responseOrderFields.find(f=>f.type===typeTarget)!.order,start):'Primary'}} onClose={()=>setTypeTarget(null)} onSaved={records=>{if(records[0])onChange(typeTarget,String(records[0].PackagingType));setTypeTarget(null);void refreshTypes()}}/>}
 {palletCalculator&&itemID&&<PalletCalculator editable={editable&&!configReadOnly} itemID={itemID} itemVersion={String(product?.ItemRowVersion??product?.RowVersion??'')} size={values.ResponsePalletSize} materialID={Number(values.ResponsePalletMaterialID)||undefined} initial={palletPricing} onMasterChanged={refreshPallets} referenceMaterials={(()=>{try{const copy=JSON.parse(values.ReferenceSetupJSON||'{}').Palletization;return Number(copy?.values?.ResponsePalletMaterialID)===Number(values.ResponsePalletMaterialID)?copy?.materials:undefined}catch{return undefined}})()} onApply={p=>onChange('PalletPricingJSON',JSON.stringify(p))} onClose={()=>setPalletCalculator(false)}/>}
 {loadPlanner&&itemID&&!(loadPlanner==='container'&&['Floor load','Both'].includes(String(configuration)))&&<LoadPlanner requiredProposed={requiredContainers(proposedContainers(values,product??{}),product??{})} floorProposed={proposedContainers(values,product??{}).filter(code=>containerPlans(values.ContainerPlansJSON)[code]?.Inputs.mode!=='pallet'&&configuration!=='Pallet load')} proposed={proposedContainers(values,product??{})} onProposal={editable&&!configReadOnly?(code,checked,count)=>onChange('ContainerLoadProfiles',proposalProfiles(values,product??{},code,checked,count)):undefined} itemID={itemID} itemVersion={String(product?.ItemRowVersion??product?.RowVersion??'')} configuration={configuration} initialCode={values.SelectedContainerType||loadPlan?.Code||requestedContainers(product??{})[0]} responsePallet={cartonsOnPallet>0?{cartons:cartonsOnPallet,grossKG:palletGross===''?null:Number(palletGross),loadedHeight:efficiency.palletHeight?Number(efficiency.palletHeight.replaceAll(',','')):null}:undefined} palletAssembly={palletPricing} onClear={editable&&!configReadOnly&&loadPlan?()=>{onChange('LoadPlanJSON','');setLoadPlanner(null)}:undefined} onConfirm={editable&&!configReadOnly?plan=>onChange('LoadPlanJSON',JSON.stringify(plan)):undefined} initial={{cartons_per_layer:Number(values.CartonsPerLayer)||null,mode:load.pallet?'pallet':'floor',max_pallet_height:Number(values.ResponseMaxPalletHeightMM)||null,double_stack:values.ResponsePalletStacking==='Double',stackable:values.ResponsePalletStacking==='Double',carton:plannerCarton}} onClose={()=>setLoadPlanner(null)}/>}
 {calculator&&(!editable||configReadOnly)&&itemID&&<PricingHistory itemID={itemID} order={calculator.order} onClose={()=>setCalculator(null)}/>}
 {calculator&&editable&&!configReadOnly&&itemID&&<PkgPricing itemID={itemID} order={calculator.order} displayOrder={globalOrder(calculator.order,start)} layerCount={layers} typeID={calculator.typeID} referenceSetup={(()=>{try{return JSON.parse(values.ReferenceSetupJSON||'{}')[globalOrder(calculator.order,start)]}catch{return undefined}})()} initial={pricing?.[calculator.order]} initialResult={pricing?.[calculator.order]?.Fingerprint===appliedResults[calculator.order]?.Fingerprint?appliedResults[calculator.order]:undefined} onClose={()=>setCalculator(null)} onApply={(input,result)=>{onPricingApply?.(input,result);setAppliedResults(xs=>({...xs,[input.PackagingOrder]:result}));setCalculator(null)}}/>}</div></ResponseEditable.Provider>;
}
