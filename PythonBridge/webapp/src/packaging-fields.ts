import {parseContainerProfiles} from './container-loading';
export type PackagingField={key:string;label:string;numeric?:boolean;integer?:boolean;max?:number;parentOnly?:boolean;readOnly?:boolean};
export const productInfoLabels:Record<string,string>={ProductName:'Product name',WeightGrams:'Net weight (g)',Category:'Category',Grade:'Grade',MixRatioPct:'Mix ratio %'};
export const requirementFields:PackagingField[]=[
 {
  "key": "PalletSize",
  "parentOnly": true,
  "label": "Pallet size",
  "max": 100
 },
 {
  "key": "PalletStacking",
  "parentOnly": true,
  "label": "Pallet stacking",
  "max": 100
 },
 {
  "key": "MaxPalletHeightM",
  "parentOnly": true,
  "label": "Max pallet height (m)",
  "numeric": true,
  "integer": false
 },
 {
  "key": "ContainerRequest",
  "parentOnly": true,
  "label": "Container Type",
  "max": 200
 },
 {
  "key": "ConfigurationRequest",
  "label": "Loading request",
  "max": 500
 },
 {
  "key": "PackagingType",
  "label": "Packaging type",
  "max": 100
 },
 {
  "key": "RecyclableRequirement",
  "label": "Recyclable requirement",
  "max": 200
 },
 {
  "key": "RecycledContent",
  "label": "Recycled content",
  "max": 200
 },
 {
  "key": "Transparency",
  "label": "Transparent / opaque",
  "max": 100
 },
 {
  "key": "MetalizedAluminum",
  "label": "Metalized / aluminum",
  "max": 100
 },
 {
  "key": "ShelfLifeDays",
  "readOnly": true,
  "label": "Shelf life (days)",
  "numeric": true,
  "integer": true
 },
 {
  "key": "SpecialComments",
  "label": "Special comments",
  "max": 1000
 }
];
export const responseFields:PackagingField[]=[
 {
  "key": "FirstPMType",
  "label": "Primary Type",
  "max": 100
 },
 {
  "key": "SecondPMType",
  "label": "Secondary Type",
  "max": 100
 },
 {
  "key": "UnitsPerCarton",
  "label": "Unit / CTN",
  "numeric": true,
  "integer": true
 },
 {
  "key": "PackagingDescription",
  "label": "Packaging description",
  "max": 500
 },
 {
  "key": "FirstPMMOQ",
  "label": "1st PM MOQ",
  "numeric": true,
  "integer": false
 },
 {
  "key": "SecondPMMOQ",
  "label": "2nd PM MOQ",
  "numeric": true,
  "integer": false
 },
 {
  "key": "CartonsPerLayer",
  "label": "Cartons / layer",
  "numeric": true,
  "integer": true
 },
 {
  "key": "LayersPerPallet",
  "label": "Layers / pallet",
  "numeric": true,
  "integer": true
 },
 {
  "key": "PacksPerPallet",
  "label": "Packs / pallet",
  "numeric": true,
  "integer": true
 },
 {
  "key": "CartonsPerContainer",
  "label": "Cartons / container",
  "numeric": true,
  "integer": true
 }
];
export const requirementLabels=Object.fromEntries(requirementFields.map(f=>[f.key,f.label]));
// Web response inputs only. Keep the legacy column and Excel/Layout contract intact.
export const webResponseFields:PackagingField[]=[
 {key:'LoadPlanJSON',label:'3D load plan'},
 {key:'ContainerPlansJSON',label:'Container load plans'},
 {key:'PalletPricingJSON',label:'Pallet pricing'},
 {key:'LayerTareJSON',label:'Packaging tare',readOnly:true},
 {key:'SelectedContainerType',label:'Container type'},
 {key:'ApplicableNetWeightGrams',label:'Applicable Net weight (g)',numeric:true},
 {key:'NutDensityDefaultUpdate',label:'Update grade density default'},
 {key:'NutDensityDefaultRowVersion',label:'Grade density version'},
 {key:'ContainerLoadProfiles',label:'Container loading profiles'},
 {key:'ResponseLayerCount',label:'Confirmed packaging layers',numeric:true,integer:true},
 ...responseFields.filter(f=>!['PackagingDescription','PacksPerPallet'].includes(f.key)).map(f=>f.key==='FirstPMMOQ'?{...f,label:'Primary MOQ unit',readOnly:true}:f.key==='SecondPMMOQ'?{...f,label:'Secondary MOQ unit',readOnly:true}:f.key==='UnitsPerCarton'?{...f,label:'No of Primary Unit'}:f.key==='LayersPerPallet'?{...f,readOnly:true}:f.key==='CartonsPerContainer'?{...f,label:'Carton / Container'}:f),
 {key:'ResponsePalletSize',label:'Pallet size',max:100},
 {key:'ResponsePalletStacking',label:'Pallet stacking',max:100},
 {key:'ResponseMaxPalletHeightMM',label:'Max pallet height (mm)',numeric:true,integer:true},
 {key:'HeightMM',label:'Shipping height (mm)',numeric:true,readOnly:true},
 {key:'UnitsPerPallet',label:'Units / pallet',numeric:true,readOnly:true},
 {key:'PrimaryPricePerUnit',label:'Primary price per unit',numeric:true,readOnly:true},
 {key:'PrimaryPriceCurrencyCode',label:'Primary price currency',readOnly:true},
 {key:'SecondaryPricePerUnit',label:'Secondary price per unit',numeric:true,readOnly:true},
 {key:'SecondaryPriceCurrencyCode',label:'Secondary price currency',readOnly:true},
 {key:'NutDensity',label:'Nut Density (g/ml)',numeric:true},
 {key:'ThirdPMType',label:'Tertiary Type',max:100},
 {key:'UnitsPerTertiary',label:'No of Secondary Unit',numeric:true,integer:true},
 {key:'ThirdPMMOQ',label:'Tertiary MOQ unit',numeric:true,readOnly:true},
 {key:'TertiaryPricePerUnit',label:'Tertiary price per unit',numeric:true,readOnly:true},
 {key:'TertiaryPriceCurrencyCode',label:'Tertiary price currency',readOnly:true},
 {key:'PalletsPerContainer',label:'Pallet / Container',numeric:true,integer:true,readOnly:true},
];
export const responseLabels:Record<string,string>=Object.fromEntries(responseFields.map(f=>[f.key,f.label]));
export const retiredResponseColumns=new Set(['BarrierRequirement','PalletType','PMCost','PMCostCurrencyCode','LayersPerContainer','CartonsPerContainerFloor','NetWeightPerContainerFloorKG']);
export function fieldValues(row:Record<string,unknown>|undefined,fields:PackagingField[]){return Object.fromEntries(fields.map(f=>[f.key,f.key==='NutDensityDefaultUpdate'?'0':f.key==='ApplicableNetWeightGrams'?String(row?.ApplicableNetWeightGrams??row?.WeightGrams??''):f.key==='ResponseLayerCount'?String(row?.ResponseLayerCount??row?.RequestedLayerCount??2):row?.[f.key]==null?'':typeof row[f.key]==='object'?JSON.stringify(row[f.key]):String(row[f.key])]))}
export function requirementFieldsFor(child:boolean){return requirementFields.filter(f=>!child||!f.parentOnly)}
export function responseFieldActive(key:string,values:Record<string,string>,configuration?:unknown,mixChild=false,mixParent=false){if(mixParent&&['NutDensity','ApplicableNetWeightGrams','NutDensityDefaultUpdate','NutDensityDefaultRowVersion'].includes(key))return false;if(mixChild&&['ContainerPlansJSON','PalletPricingJSON','LoadPlanJSON','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','LayersPerPallet','PacksPerPallet','CartonsPerContainer','LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor','SelectedContainerType','ContainerLoadProfiles'].includes(key))return false;const load=String(configuration??'').trim();if(['LayersPerContainer','PalletsPerContainer'].includes(key)&&['Floor load','Both'].includes(load))return false;if(key==='CartonsPerContainer'&&!['Floor load','Both'].includes(load))return false;if(key==='CartonsPerContainerFloor'&&!['Floor load','Both'].includes(load))return false;const layers=Number(values.ResponseLayerCount||3);return !((layers<2&&['SecondPMType','SecondPMMOQ','UnitsPerCarton'].includes(key))||(layers<3&&['ThirdPMType','ThirdPMMOQ','UnitsPerTertiary'].includes(key)))}
export function fieldPayload(values:Record<string,string>,fields:PackagingField[],configuration?:unknown,mixChild=false,mixParent=false){const result=Object.fromEntries(fields.filter(f=>!f.readOnly&&responseFieldActive(f.key,values,configuration,mixChild,mixParent)).map(f=>[['LoadPlanJSON','PalletPricingJSON'].includes(f.key)?(f.key==='LoadPlanJSON'?'LoadPlanID':'PalletPricingID'):f.key,['LoadPlanJSON','PalletPricingJSON'].includes(f.key)?(values[f.key]?JSON.parse(values[f.key]).ID:null):f.key==='NutDensityDefaultUpdate'?values[f.key]==='1':f.key==='ContainerLoadProfiles'?(values[f.key]?parseContainerProfiles(values[f.key]):null):values[f.key]?.trim()||null]));
 if('ContainerPlansJSON' in result){let plans:any=JSON.parse(String(result.ContainerPlansJSON||'{}'));if(Array.isArray(plans))plans=Object.fromEntries(plans.map((p:any)=>[p.Code,p]));result.ContainerLoadPlanIDs=Object.fromEntries(Object.values(plans).map((p:any)=>[p.ContainerID,p.ID]));delete result.ContainerPlansJSON}
 if(result.SelectedContainerType&&!['20DC','40DC','40HC','20RC','40RHC'].includes(String(result.SelectedContainerType)))result.SelectedContainerType=null;
 return result}
