import {FieldLabel,InfoTip} from './ui';import {useState} from 'react';
import {text,type Row} from './api';
import {IconButton} from './icons';
import {PkgPricing,type PricingCalculation,type PricingResult} from './pkg-pricing';
import {webResponseFields} from './packaging-fields';
import {ResponseInput} from './response-input';
import {usedVolumeDisplay} from './response-volume';
import {packingWeights,loadSections} from './packing-way';
import {decimalDisplay,numberDisplay} from './number-format';
import {layerCount,responseOrderFields,selectableType,type PackagingOrder} from './packaging-orders';
import {GradeSnapshotIcon,parseGradeSnapshot} from './opportunity-grade-snapshot';
import {responseEfficiency} from './response-efficiency';
import {capturedDimensions,dimensionDisplay,savedLayerDimensions} from './response-dimensions';
import {allowedContainerTypes,containerChange} from './container-loading';

const sections=[
 {label:'Primary packaging',level:1,keys:['FirstPMType','FirstPMMOQ','PrimaryPricePerUnit']},
 {label:'Secondary packaging',level:2,keys:['SecondPMType','SecondPMMOQ','SecondaryPricePerUnit']},
 {label:'Tertiary packaging',level:3,keys:['ThirdPMType','ThirdPMMOQ','TertiaryPricePerUnit']},
 {label:'Palletization',level:1,keys:['CartonsPerLayer','LayersPerPallet','UnitsPerPallet']}
];

export function responseChange(values:Record<string,string>,pricing:Record<string,PricingCalculation>,key:string,value:string,pallets:Row[]=[],configuration?:unknown){
 const next=containerChange(values,key,value,pallets,configuration),calculations={...pricing};
 const changed=responseOrderFields.find(f=>f.type===key||f.moq===key);
 if(key==='HeightMM')next.LayersPerPallet='';
 if(key==='ResponseLayerCount'||responseOrderFields[layerCount(values.ResponseLayerCount)-1].type===key){next.HeightMM='';next.LayersPerPallet=''}
 if(changed){delete calculations[changed.order];next[changed.moq]='';next[changed.price]='';next[changed.currency]=''}
 if(key==='ResponseLayerCount'){
  // Reconfirming layers invalidates unsaved previews; historical snapshots are retained.
  for(const order of Object.keys(calculations))delete calculations[order];
  responseOrderFields.forEach((f,i)=>{if(i>=layerCount(value)){next[f.type]='';next[f.moq]='';next[f.price]='';next[f.currency]=''}});
  if(layerCount(value)<2)next.UnitsPerCarton='';
  if(layerCount(value)<3)next.UnitsPerTertiary='';
 }
 return {values:next,pricing:calculations};
}

export function ResponseSections({values,requestedLayers,netWeight,configuration,product,onChange,types,pallets=[],loading,itemID,pricing,onPricingApply}:{values:Record<string,string>;requestedLayers?:unknown;netWeight:unknown;configuration?:unknown;product?:Row;onChange:(key:string,value:string)=>void;types:Row[];pallets?:Row[];loading:boolean;itemID?:number;pricing?:Record<string,PricingCalculation>;onPricingApply?:(input:PricingCalculation,result:PricingResult)=>void}){
 const [calculator,setCalculator]=useState<{order:PackagingOrder;typeID:number}|null>(null);
 const [appliedResults,setAppliedResults]=useState<Record<string,PricingResult>>({});
 const layers=layerCount(values.ResponseLayerCount),layerField=webResponseFields.find(f=>f.key==='ResponseLayerCount')!;
 const weights=packingWeights(netWeight,values,configuration),load=loadSections(configuration);
 const finalOrder=responseOrderFields[layers-1];
 const applied=pricing?.[finalOrder.order]?.Fingerprint===appliedResults[finalOrder.order]?.Fingerprint?appliedResults[finalOrder.order]:undefined;
 const savedGeometry=Number(product?.EfficiencyLayerCount)===layers&&product?.EfficiencyTypeName===values[finalOrder.type]
  ?{AreaM2:product?.FinalLayerAreaM2,VolumeM3:product?.FinalLayerVolumeM3}:{};
 const selectedPallet=pallets.find(p=>p.PalletSize===values.ResponsePalletSize);
 const palletArea=selectedPallet?.PalletAreaMM2??(product?.ResponsePalletSize===values.ResponsePalletSize?product?.ResponsePalletAreaMM2:null);
 const efficiency=responseEfficiency(netWeight,values,applied?.ParentGeometryMetrics??savedGeometry,palletArea);
 const unitInput=(key:string,fixed:boolean)=><ResponseInput field={{...webResponseFields.find(f=>f.key===key)!,readOnly:fixed}} value={fixed?'1':values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers}/>;
 const loadInput=(key:string)=>{const base=webResponseFields.find(f=>f.key===key)!,field={...base,readOnly:base.readOnly||!values.SelectedContainerType&&['LayersPerContainer','CartonsPerContainerFloor'].includes(key)};return <label><FieldLabel help={key==='HeightMM'?'From D3 Height in the last confirmed Shipping layer Pricing Calculator. Apply pricing to update it.':undefined}>{field.label}</FieldLabel><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers}/></label>};
 const density=webResponseFields.find(f=>f.key==='NutDensity')!;
 const dimensionCapture=(order:PackagingOrder)=>{
  const field=responseOrderFields.find(f=>f.order===order)!,input=pricing?.[order],result=appliedResults[order];
  const dimensions=input&&input.LayerCount===layers&&result&&input.Fingerprint===result.Fingerprint
   ?capturedDimensions(result.ParentDimension,result.ParentMeasurements)
   :savedLayerDimensions(product?.LayerDimensionCaptures,order,values[field.type]||'',layers);
  const display=dimensionDisplay(dimensions);
  return <label className="captured-dimensions" aria-label={order+' captured dimensions'}><span>{display.label}</span><span className="captured-dimensions-value">{display.value}</span></label>;
 };
 const containerSelector=<label><FieldLabel>Container type</FieldLabel><select aria-label="Container type" value={values.SelectedContainerType||''} disabled={loading} onChange={e=>onChange('SelectedContainerType',e.target.value)}><option value="">Choose container type</option>{allowedContainerTypes(product?.ResponseContainerFamily??product?.ContainerRequest).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>;
 return <div className="requirement-sections response-sections">
 <section aria-label="Product Info response"><h4>Product Info</h4><div className="packaging-entry-grid">
  <div className="response-product-summary"><strong>{text(product?.ProductCode)} · {text(product?.ProductName)}</strong><span>Net weight: {numberDisplay('WeightGrams',netWeight)??'—'} g · Annual units: {numberDisplay('AnnualUnit',product?.AnnualUnit)??'—'}</span></div>
  <label>Shelf life (days)<input aria-label="Shelf life (days)" readOnly value={decimalDisplay(product?.ShelfLifeDays,0)||''}/></label>
  <GradeSnapshotIcon value={parseGradeSnapshot(product?.ProductGradeSnapshot)}/>
  <label>{density.label}<ResponseInput field={density} value={values.NutDensity||''} onChange={value=>onChange('NutDensity',value)} types={types} pallets={pallets} loading={loading} layers={layers}/></label>
  <label>Used volume (ml)<input readOnly value={usedVolumeDisplay(netWeight,values.NutDensity||'')} placeholder="Net weight / density"/></label>
 </div></section>
 <section aria-label="Packing Way response"><div className="response-section-heading"><h4>Packing Way<InfoTip text="Primary units per Secondary · Secondary units per Tertiary · Final layer = 1"/><small className="response-requested-layers">Requested layers: {layerCount(requestedLayers)}.</small></h4><label title={'Requested layers: '+layerCount(requestedLayers)+'. The request snapshot stays unchanged.'}>{layerField.label}<ResponseInput field={layerField} value={String(layers)} onChange={v=>onChange(layerField.key,v)} types={types} pallets={pallets} loading={loading} layers={layers}/></label></div><div className="packing-way-grid" data-layers={layers}>
  <div className="packing-way-layer" data-shipping={layers===1}><label>No of Primary Unit{unitInput('UnitsPerCarton',layers===1)}</label><label className="packing-layer-weight">Primary net weight (g)<input readOnly value={weights.primary}/></label>{dimensionCapture('Primary')}{layers===1&&loadInput('HeightMM')}</div>
  {layers>=2&&<div className="packing-way-layer" data-shipping={layers===2}><label>No of Secondary Unit{unitInput('UnitsPerTertiary',layers===2)}</label><label className="packing-layer-weight">Secondary net weight (g)<input readOnly value={weights.secondary}/></label>{dimensionCapture('Secondary')}{layers===2&&loadInput('HeightMM')}</div>}
  {layers===3&&<div className="packing-way-layer" data-shipping><label>No of Tertiary Unit<input readOnly value="1"/></label><label className="packing-layer-weight">Tertiary net weight (g)<input readOnly value={weights.tertiary}/></label>{dimensionCapture('Tertiary')}{loadInput('HeightMM')}</div>}
 </div></section>
 <div className="packaging-layer-sections" data-layers={layers}>{sections.filter(s=>s.level<=layers&&s.label!=='Palletization').map(section=><section key={section.label} aria-label={section.label+' response'}>
  <h4>{section.label}</h4><div className="packaging-entry-grid">{section.keys.map(key=>{
   const field=webResponseFields.find(f=>f.key===key)!;
   const order=responseOrderFields.find(f=>f.type===key)?.order;
   const selected=types.find(t=>!!order&&selectableType(t,order,layers)&&t.PackagingType===values[key]);
   const priceField=responseOrderFields.find(f=>f.price===key);
   return <label key={key}>{field.label}<span className={order?'pricing-type-field':priceField?'response-price-field':''}><ResponseInput field={field} value={values[key]||''} onChange={value=>onChange(key,value)} types={types} pallets={pallets} loading={loading} layers={layers}/>{priceField&&values[key]&&<span className="response-price-currency">{values[priceField.currency]}</span>}{order&&itemID&&<IconButton icon="calculator" label={order+' Pricing Calculator'} disabled={loading||!selected} onClick={()=>setCalculator({order,typeID:Number(selected!.ID)})}/>}</span></label>;
  })}</div>
 </section>)}</div>
 <section aria-label="Palletization response"><h4>Palletization</h4><div className="response-palletization-grid">
  <div className="packaging-entry-grid response-pallet-specs">{loadInput('ResponsePalletSize')}{loadInput('ResponsePalletStacking')}{loadInput('ResponseMaxPalletHeightMM')}</div>
  <div className="packaging-entry-grid response-pallet-loading">{loadInput('CartonsPerLayer')}
   <label><FieldLabel help="Round down ((Max pallet height − 150 mm pallet base) / Shipping height (mm), representing the last packaging layer). Existing counts are retained until Shipping height is entered.">Layers / pallet</FieldLabel><input aria-label="Layers / pallet" readOnly value={weights.layersPerPallet}/></label>
   <label>Units / pallet<input aria-label="Units / pallet" readOnly value={weights.unitsPerPallet}/></label>
   <label>Net weight per pallet (kg)<input readOnly value={weights.palletKG}/></label>
   <label>Pallet height (mm)<input aria-label="Pallet height (mm)" readOnly value={efficiency.palletHeight}/></label>
  </div>
 </div></section>
 <section aria-label="Efficiency response"><h4>Efficiency</h4><div className="packaging-entry-grid response-efficiency-grid">
  <label><FieldLabel help="Last packaging layer net weight (kg) / Shipping parent's Occupied m³ fx. Missing formula or measurements leave this blank.">Carton Efficiency (kg/m3)</FieldLabel><input readOnly aria-label="Carton Efficiency (kg/m3)" value={efficiency.carton}/></label>
  <label><FieldLabel help="Carton Efficiency / Nuts density (g/ml) / 1000 × 100.">Relative carton efficiency %</FieldLabel><input readOnly aria-label="Relative carton efficiency %" value={efficiency.relative}/></label>
  <label><FieldLabel help="Last Shipping parent's Occupied m² fx × Cartons / layer / Pallet Master area (m²) × 100. This is footprint, not material consumption.">Pallet Utilization %</FieldLabel><input readOnly aria-label="Pallet Utilization %" value={efficiency.utilization}/></label>
  <label><FieldLabel help="Pallet height / Max pallet height × 100. Pallet height = 150 mm + Layers / pallet × Shipping height (mm).">Pallet height efficiency %</FieldLabel><input readOnly aria-label="Pallet height efficiency %" value={efficiency.heightEfficiency}/></label>
 </div></section>

 {load.pallet&&<section aria-label="Pallet load response"><h4>Pallet load<InfoTip text="Carton / Container = Pallet / Container × Cartons / layer × Layer / Container. Net weight / Container = Carton / Container × last layer net weight (kg). Pallet capacity is captured from Pallet Master for the selected container type."/></h4><div className="packaging-entry-grid response-container-load-grid">
  {containerSelector}<label><FieldLabel help="Round down (container clearance / Shipping height in mm). Clearance is 2070 mm for 20RC; 2090 mm for all other types.">Layer / Container</FieldLabel><input readOnly aria-label="Layer / Container" value={weights.layersPerContainer}/></label>{loadInput('PalletsPerContainer')}
  <label><FieldLabel>Carton / Container</FieldLabel><input readOnly value={weights.containerCartons}/></label>
  <label><FieldLabel>Net weight / Container (kg)</FieldLabel><input readOnly value={weights.containerKG}/></label>
 </div></section>}
 {load.floor&&<section aria-label="Floor load response"><h4>Floor load<InfoTip text="Net weight / Container Floor = final packaging layer net weight (kg) × Carton / Container Floor. Counts are saved separately for each selected container type."/></h4><div className={'packaging-entry-grid response-floor-load-grid'+(!load.pallet?' response-floor-container-grid':'')}>
  {!load.pallet&&containerSelector}{loadInput('CartonsPerContainerFloor')}
  <label>Net weight / Container Floor (kg)<input readOnly value={weights.floorKG}/></label>
 </div></section>}
 {calculator&&itemID&&<PkgPricing itemID={itemID} order={calculator.order} layerCount={layers} typeID={calculator.typeID} initial={pricing?.[calculator.order]} initialResult={pricing?.[calculator.order]?.Fingerprint===appliedResults[calculator.order]?.Fingerprint?appliedResults[calculator.order]:undefined} onClose={()=>setCalculator(null)} onApply={(input,result)=>{onPricingApply?.(input,result);setAppliedResults(xs=>({...xs,[input.PackagingOrder]:result}));setCalculator(null)}}/>}</div>;
}
