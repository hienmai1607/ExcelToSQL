export type PackagingField={key:string;label:string;numeric?:boolean;integer?:boolean;max?:number};
export const productInfoLabels:Record<string,string>={ProductName:'Product name',WeightGrams:'Net weight (g)',Category:'Category',Grade:'Grade',MixRatioPct:'Mix ratio %'};
export const requirementFields:PackagingField[]=[
 {
  "key": "PalletSize",
  "label": "Pallet size",
  "max": 100
 },
 {
  "key": "PalletStacking",
  "label": "Pallet stacking",
  "max": 100
 },
 {
  "key": "MaxPalletHeightM",
  "label": "Max pallet height (m)",
  "numeric": true,
  "integer": false
 },
 {
  "key": "ContainerRequest",
  "label": "Container request",
  "max": 200
 },
 {
  "key": "ConfigurationRequest",
  "label": "Configuration request",
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
  "key": "BarrierRequirement",
  "label": "Barrier requirement",
  "max": 500
 },
 {
  "key": "ShelfLifeDays",
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
  "label": "1st PM Type",
  "max": 100
 },
 {
  "key": "SecondPMType",
  "label": "2nd PM Type",
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
  "key": "PalletType",
  "label": "Pallet type",
  "max": 100
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
export const responseLabels:Record<string,string>={...Object.fromEntries(responseFields.map(f=>[f.key,f.label])),PMCost:'PM cost',PMCostCurrencyCode:'Cost currency'};
export function fieldValues(row:Record<string,unknown>|undefined,fields:PackagingField[]){return Object.fromEntries(fields.map(f=>[f.key,row?.[f.key]==null?'':String(row[f.key])]))}
export function fieldPayload(values:Record<string,string>,fields:PackagingField[]){return Object.fromEntries(fields.map(f=>[f.key,values[f.key]?.trim()||null]))}
