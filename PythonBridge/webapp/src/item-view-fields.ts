import {tcbColumnGroups,tcbColumnLabels} from './tcb-columns';
import {costSections} from './shipment-sections';
export const shipmentFieldGroups=[
 {title:'Shipment',fields:{ContainerRequest:'Container Type',ConfigurationRequest:'Loading request',FloorLoadUSDPerMT:'Floor load cost ($/MT)',Incoterm:'Incoterm',PortOfEntryName:'Port of Entry'} as Record<string,string>},
 ...costSections.map(section=>({title:section.title,fields:Object.fromEntries([...section.fields.map(field=>[field.key,field.label]),...(section.title==='Others'?[['MarginMode','Margin basis'],['InitialDesignCustomer','Initial Design (customer currency)']]:section.title==='Logistics'?[['PortToWHUSDPerContainer','Legacy Port - WH ($/cont)'],['WHCostUSDPerPallet','Legacy WH Cost ($/pallet)']]:[])])})),
];
export const productFields:Record<string,string>={
 ProductCode:'Product',ProductName:'Product name',AnnualUnit:'Annual units',
 WeightGrams:'Net weight (g)',ApplicableNetWeightGrams:'Applicable Net weight (g)',ShelfLifeDays:'Shelf life (days)',ItemStage:'Stage',NutDensity:'Nut density (g/ml)',UsedVolumeML:'Used volume (ml)',
};
export const requestFields:Record<string,string>={
 RequestedLayerCount:'Requested packaging layers',PalletSize:'Pallet size',PalletStacking:'Pallet stacking',MaxPalletHeightMM:'Max pallet height (mm)',
 ContainerRequest:'Container Type',ConfigurationRequest:'Loading request',
 PrimaryTypeName:'Requested Primary Type',Transparency:'Primary Transparent / opaque',
 SecondaryTypeName:'Requested Secondary Type',NumberOfPrimary:'No of Primary Unit',SecondaryTransparency:'Secondary Transparent / opaque',
 TertiaryTypeName:'Requested Tertiary Type',NumberOfSecondary:'No of Secondary Unit',TertiaryTransparency:'Tertiary Transparent / opaque',
 RecyclableRequirement:'Primary recyclable requirement',RecycledContent:'Primary recycled content',MetalizedAluminum:'Primary metalized / aluminum',SpecialComments:'Primary special comments',
 ...Object.fromEntries(['Secondary','Tertiary'].flatMap(layer=>[['RecyclableRequirement','recyclable requirement'],['RecycledContent','recycled content'],['MetalizedAluminum','metalized / aluminum'],['SpecialComments','special comments']].map(([key,label])=>[layer+key,layer+' '+label]))),
};
export const responseFields:Record<string,string>={
 SelectedContainerType:'Container type',
 ResponseLayerCount:'Confirmed packaging layers',
 NoOfPrimaryUnit:'No of Primary Unit',PrimaryNetWeightGrams:'Primary net weight (g)',
 NoOfSecondaryUnit:'No of Secondary Unit',SecondaryNetWeightGrams:'Secondary net weight (g)',
 NoOfTertiaryUnit:'No of Tertiary Unit',TertiaryNetWeightGrams:'Tertiary net weight (g)',
 FirstPMType:'Primary Type',FirstPMMOQ:'Primary MOQ unit',PrimaryPricePerUnit:'Primary price per unit',PrimaryPriceCurrencyCode:'Primary currency',
 SecondPMType:'Secondary Type',SecondPMMOQ:'Secondary MOQ unit',SecondaryPricePerUnit:'Secondary price per unit',SecondaryPriceCurrencyCode:'Secondary currency',
 ThirdPMType:'Tertiary Type',ThirdPMMOQ:'Tertiary MOQ unit',TertiaryPricePerUnit:'Tertiary price per unit',TertiaryPriceCurrencyCode:'Tertiary currency',
 ResponsePalletSize:'Response pallet size',ResponsePalletStacking:'Response pallet stacking',ResponseMaxPalletHeightMM:'Response max pallet height (mm)',HeightMM:'Shipping height (mm)',
 CartonsPerLayer:'Cartons / layer',LayersPerPallet:'Layers / pallet',UnitsPerPallet:'Units / pallet',NetWeightPerPalletKG:'Net weight / pallet (kg)',
 PalletHeightMM:'Pallet height (mm)',CartonEfficiencyKGM3:'Carton Efficiency (kg/m3)',RelativeCartonEfficiencyPct:'Relative carton efficiency %',
 PalletUtilizationPct:'Pallet Utilization %',PalletHeightEfficiencyPct:'Pallet height efficiency %',
 PalletsPerContainer:'Pallets / container',CalculatedCartonsPerContainer:'Cartons / container',NetWeightPerContainerKG:'Net weight / container (kg)',
};
export const linkedRequestFields:Record<string,string>={PackagingRequestNumber:'Current linked PCR'};
export const calculatedFields=new Set(['ApplicableNetWeightGrams','UsedVolumeML','LayersPerContainer','LayersPerPallet','NoOfPrimaryUnit','NoOfSecondaryUnit','NoOfTertiaryUnit','PrimaryNetWeightGrams','SecondaryNetWeightGrams','TertiaryNetWeightGrams','NetWeightPerPalletKG','UnitsPerPallet','CalculatedCartonsPerContainer','NetWeightPerContainerKG','NetWeightPerContainerFloorKG']);
export const efficiencyFields=['PalletHeightMM','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct'];
efficiencyFields.forEach(key=>calculatedFields.add(key));
Object.keys(tcbColumnLabels).forEach(key=>calculatedFields.add(key));
export function itemFieldGroups(domain:'opportunity'|'requests'):{title:string;subgroup?:string;fields:Record<string,string>}[]{
 return [
  {title:'Product Info',fields:{...productFields,...(domain==='opportunity'?{EstPctAwarded:'Estimated award %',ShelfPrice:'Shelf price'}:{PIC:'Current PIC'})}},
  {title:'Packaging Request',fields:domain==='opportunity'?Object.fromEntries(Object.entries(requestFields).filter(([key])=>!['ContainerRequest','ConfigurationRequest'].includes(key))):requestFields},
  ...(domain==='opportunity'?shipmentFieldGroups:[]),
  ...(domain==='opportunity'?tcbColumnGroups:[]),
  {title:'Packaging Responses',fields:{...(domain==='opportunity'?linkedRequestFields:{}),...responseFields}},
 ];
}
export const itemFieldLabels=(domain:'opportunity'|'requests')=>Object.assign({},...itemFieldGroups(domain).map(g=>g.fields)) as Record<string,string>;
