/** Web editor fields only. Legacy Excel field catalogs remain unchanged. */
export const productFields:Record<string,string>={
 ProductCode:'Product',ProductName:'Product name',AnnualUnit:'Annual units',
 WeightGrams:'Net weight (g)',ShelfLifeDays:'Shelf life (days)',ItemStage:'Stage',NutDensity:'Nut density (g/ml)',UsedVolumeML:'Used volume (ml)',
};
export const requestFields:Record<string,string>={
 RequestedLayerCount:'Requested packaging layers',PalletSize:'Pallet size',PalletStacking:'Pallet stacking',MaxPalletHeightMM:'Max pallet height (mm)',
 ContainerRequest:'Container request',ConfigurationRequest:'Configuration request',
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
 LayersPerContainer:'Layers / container',PalletsPerContainer:'Pallets / container',CalculatedCartonsPerContainer:'Cartons / container',NetWeightPerContainerKG:'Net weight / container (kg)',
 CartonsPerContainerFloor:'Cartons / container floor',NetWeightPerContainerFloorKG:'Net weight / container floor (kg)',
};
export const linkedRequestFields:Record<string,string>={PackagingRequestNumber:'Current linked PCR'};
export const calculatedFields=new Set(['UsedVolumeML','LayersPerContainer','LayersPerPallet','NoOfPrimaryUnit','NoOfSecondaryUnit','NoOfTertiaryUnit','PrimaryNetWeightGrams','SecondaryNetWeightGrams','TertiaryNetWeightGrams','NetWeightPerPalletKG','UnitsPerPallet','CalculatedCartonsPerContainer','NetWeightPerContainerKG','NetWeightPerContainerFloorKG']);
export const efficiencyFields=['PalletHeightMM','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct'];
efficiencyFields.forEach(key=>calculatedFields.add(key));
export function itemFieldGroups(domain:'opportunity'|'requests'){
 return [
  {title:'Product Info',fields:{...productFields,...(domain==='opportunity'?{EstPctAwarded:'Estimated award %',ShelfPrice:'Shelf price'}:{PIC:'Current PIC'})}},
  {title:'Packaging Request',fields:requestFields},
  {title:'Packaging Responses',fields:{...(domain==='opportunity'?linkedRequestFields:{}),...responseFields}},
 ];
}
export const itemFieldLabels=(domain:'opportunity'|'requests')=>Object.assign({},...itemFieldGroups(domain).map(g=>g.fields)) as Record<string,string>;
