import {typeFlagOrders} from './packaging-orders';
import {numberDisplay,isNumericField} from './number-format';
import {palletCapacityLabels,palletCapacityKeys} from './pallet-capacities';
import {supplierLabels} from './supplier-geometry';
import {timestamp} from './datetime';
import {date,type Row} from './api';
export type MasterEntity='materials'|'prices'|'raw-materials'|'raw-prices'|'raw-grades'|'products'|'vendors'|'uoms'|'pallets'|'packaging-types';
export const productRequiredColumns=['CustomerName','ProductName','Category','WeightGrams'];
export function requiredMasterColumns(entity:MasterEntity){return entity==='packaging-types'?['PackagingType','FinalComponent','Shipping',...Object.keys(typeFlagOrders)]:entity==='pallets'?['UnitOfMeasure','Width','Length']:entity==='raw-grades'?['GradeName','FinalGrade']:entity==='uoms'?['UoMCode','Category','BaseFactor']:entity==='vendors'?['VendorName']:entity==='products'?productRequiredColumns:(entity==='materials'||entity==='raw-materials')?['MaterialName','UnitOfMeasure']:['MaterialCode','CurrencyCode','BaseUoM','QuantityFrom','UnitPrice','EffectiveFrom']}
export function enforceMasterColumns(entity:MasterEntity,layout:MasterLayout):MasterLayout{
 if((entity==='prices'||entity==='raw-prices'))layout={...layout,columns:[...new Set(layout.columns.map(c=>c==='PriceBasis'?'BaseUoM':c))],sort:layout.sort.map(r=>({...r,column:r.column==='PriceBasis'?'BaseUoM':r.column}))};
 const retired=entity==='prices'?['SupplierDimensionID','SupplierD1','SupplierD2','SupplierD3','SupplierAreaPerPriceUnit','MaterialDimensionID','MaterialD1','MaterialD2','MaterialD3']:(entity==='materials'||entity==='raw-materials')?['Description']:entity==='products'?['Grade','MixRatioPct']:entity==='raw-grades'?['MaterialAssign','ParentMaterialCode','MaterialCode','MaterialName']:entity==='packaging-types'?['TareWeight','PriceBasis','CopyDim','PackagingOrder']:[];
 layout={...layout,columns:layout.columns.filter(c=>!retired.includes(c)),sort:layout.sort.filter(s=>!retired.includes(s.column)),column_widths:Object.fromEntries(Object.entries(layout.column_widths||{}).filter(([key])=>!retired.includes(key)))};
 return {...layout,columns:[...layout.columns,...requiredMasterColumns(entity).filter(c=>!layout.columns.includes(c))]};
}
export type MasterRule={column:string;direction:'asc'|'desc'};
export type MasterLayout={column_widths?:Record<string,number>;columns:string[];filters:string[];values:Record<string,string>;sort:MasterRule[];page_size:number};
export type Field={key:string;label:string;kind?:'category'|'materialdimension'|'supplierdimension'|'orders'|'parents'|'packagingtype'|'choice'|'rawgrade'|'uom'|'boolean'|'decimal'|'date'|'material'|'vendor'|'customer'|'currency'|'status'|'unit'|'text';required?:boolean;max?:number;initial?:string;options?:string[]};
const audit={CreatedAt:'Created at',CreatedByName:'Created by',UpdatedAt:'Updated at',UpdatedByName:'Updated by'};
const baseMasterConfig={
 'packaging-types':{title:'Packaging Type Master',singular:'packaging type',endpoint:'type',
 columns:{ParentType:'Parent Types',...typeFlagOrders,Palletization:'Palletization',PackagingType:'Packaging Type',Shipping:'Shipping',FinalComponent:'Single',Status:'Status',...audit} as Record<string,string>,
 defaults:['PackagingType','ParentType',...Object.keys(typeFlagOrders),'Shipping','FinalComponent','Status'],filters:['search','status','created_by'],
 fields:[{key:'ParentTypeIDs',label:'Parent Types',kind:'parents'},{key:'PackagingType',label:'Packaging Type',required:true,max:100},{key:'PackagingOrders',label:'',kind:'orders',required:true,options:Object.values(typeFlagOrders)},{key:'FinalComponent',label:'Single',kind:'boolean',initial:'false'},{key:'Shipping',label:'Shipping',kind:'boolean',initial:'false'}] as Field[]},
 pallets:{title:'Pallet Master',singular:'pallet',endpoint:'pallet',
 columns:{PalletPriceUSDPerEA:'Pallet price ($/EA)',UnitOfMeasure:'UoM',Width:'Width',Length:'Length',PalletAreaMM2:'Pallet area (mm²)',PalletSize:'Pallet size',...palletCapacityLabels,ConversionStatus:'Conversion status',Status:'Status',...audit} as Record<string,string>,
 defaults:['UnitOfMeasure','Width','Length','PalletPriceUSDPerEA','PalletAreaMM2','PalletSize',...palletCapacityKeys,'Status'],filters:['search','status','created_by'],
 fields:[{key:'UnitOfMeasure',label:'UoM',kind:'uom',required:true},{key:'Width',label:'Width',kind:'decimal',required:true},{key:'Length',label:'Length',kind:'decimal',required:true},{key:'PalletPriceUSDPerEA',label:'Pallet price ($/EA)',kind:'decimal'},...Object.entries(palletCapacityLabels).map(([key,label])=>({key,label,kind:'decimal'}))] as Field[]},
 'raw-grades':{title:'Raw Grade Master',singular:'raw grade',endpoint:'grade',
 columns:{ParentGradeName:'Parent grade',GradeName:'Grade name',FinalGrade:'Final grade',Status:'Status',...audit} as Record<string,string>,
 defaults:['GradeName','FinalGrade','ParentGradeName','Status'],filters:['search','status','created_by'],
 fields:[{key:'GradeName',label:'Grade name',required:true,max:100},{key:'FinalGrade',label:'Final grade',kind:'boolean',initial:'false'},{key:'ParentGradeID',label:'Parent grade',kind:'rawgrade'}] as Field[]},
 uoms:{title:'Units of Measure',singular:'UoM',endpoint:'uom',columns:{UoMCode:'UoM code',UoMName:'UoM name',Category:'Category',BaseFactor:'Factor to category base unit',Status:'Status',...audit} as Record<string,string>,
 defaults:['UoMCode','UoMName','Category','BaseFactor','Status'],filters:['search','status','created_by'],
 fields:[{key:'UoMCode',label:'UoM code',required:true,max:40},{key:'UoMName',label:'UoM name',max:500},{key:'Category',label:'Category',kind:'choice',options:['Weight/Mass','Length/Distance','Area','Volume','Unit/Count','Other'],required:true,initial:'Unit/Count'},{key:'BaseFactor',label:'Factor to category base unit',kind:'decimal',required:true,initial:'1'}] as Field[]},
 vendors:{title:'Vendors',singular:'vendor',endpoint:'vendor',columns:{VendorName:'Vendor name',Address:'Address',CurrencyCode:'Currency',Status:'Status',...audit} as Record<string,string>,
 defaults:['VendorName','Address','CurrencyCode','Status'],filters:['search','status','created_by'],
 fields:[{key:'VendorName',label:'Vendor name',required:true,max:200},{key:'Address',label:'Address',max:500},{key:'CurrencyID',label:'Currency',kind:'currency'}] as Field[]},
 products:{title:'Products',singular:'product',endpoint:'product',columns:{IsMix:'Product Mix',CustomerName:'Customer',ProductCode:'Product code',ProductName:'Product name',Category:'Category',WeightGrams:'Net Weight (g)',WeightOz:'Net Weight (oz)',ShelfLifeDays:'Shelf life (days)',Status:'Status',...audit} as Record<string,string>,
 defaults:['IsMix','CustomerName','ProductCode','ProductName','Category','WeightGrams','WeightOz','ShelfLifeDays','Status'],filters:['search','status','created_by'],
 fields:[{key:'IsMix',label:'Product Mix',kind:'boolean',initial:'false'},{key:'CustomerID',label:'Customer',kind:'customer',required:true},{key:'ProductName',label:'Product name',required:true,max:200},{key:'Category',label:'Category',kind:'category',max:100},{key:'WeightValue',label:'Weight',kind:'decimal',required:true},{key:'WeightUnit',label:'Weight unit',kind:'unit',required:true,initial:'g'},{key:'ShelfLifeDays',label:'Shelf life (days)',kind:'decimal'}] as Field[]},
 materials:{title:'Packaging Material',singular:'material',endpoint:'material',columns:{PackagingType:'Packaging Type',MaterialCode:'Material code',MaterialName:'Material name',UnitOfMeasure:'Base UoM',TareWeight:'Tare weight',TareWeightBasis:'Tare basis',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','MaterialName','PackagingType','UnitOfMeasure','TareWeight','TareWeightBasis','Status'],filters:['search','status','created_by'],
 fields:[{key:'PackagingTypeID',label:'Packaging Type',kind:'packagingtype'},{key:'MaterialName',label:'Material name',required:true,max:200},{key:'UnitOfMeasure',label:'Base UoM',kind:'uom',required:true,max:20},{key:'TareWeight',label:'Tare weight',kind:'decimal'},{key:'TareWeightBasis',label:'Tare basis',kind:'choice',options:['kg/EA','kg/m2']}] as Field[]},
 prices:{title:'Packaging Pricing',singular:'price',endpoint:'price',columns:{MaterialBaseUoM:'Material Base UoM',ConversionFactor:'Conversion factor',BaseUnitPrice:'Base unit price (Vendor currency)',BaseUnitUSDPrice:'Base unit USD price',ConversionStatus:'Conversion status',VendorName:'Vendor',MaterialCode:'Material',MaterialName:'Material name',CurrencyCode:'Vendor currency',ExchangeRateToUSD:'Exchange rate (Vendor currency per USD)',UnitUSDPrice:'Unit USD price',BaseUoM:'Price UoM',QuantityFrom:'Quantity from',QuantityTo:'Quantity to',UnitPrice:'Unit price (Vendor currency)',EffectiveFrom:'Effective from',EffectiveTo:'Effective to',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','VendorName','CurrencyCode','BaseUoM','QuantityFrom','QuantityTo','UnitPrice','ExchangeRateToUSD','UnitUSDPrice','EffectiveFrom','EffectiveTo','Status'],filters:['search','material_id','currency_id','as_of','status','created_by'],
 fields:[{key:'VendorID',label:'Vendor',kind:'vendor'},{key:'CurrencyID',label:'Vendor currency',kind:'currency',required:true},{key:'MaterialID',label:'Material',kind:'material',required:true},{key:'BaseUoM',label:'Price UoM',kind:'uom',required:true},{key:'QuantityFrom',label:'Quantity from (inclusive)',kind:'decimal',required:true,initial:'0'},{key:'QuantityTo',label:'Quantity to (exclusive)',kind:'decimal'},{key:'UnitPrice',label:'Unit price (Vendor currency)',kind:'decimal',required:true},{key:'ExchangeRateToUSD',label:'Exchange rate (Vendor currency per USD)',kind:'decimal'},{key:'EffectiveFrom',label:'Effective from',kind:'date',required:true},{key:'EffectiveTo',label:'Effective to',kind:'date'}] as Field[]}
};
export const masterConfig={...baseMasterConfig,
 'raw-materials':{...baseMasterConfig.materials,title:'Raw Material',singular:'raw material',endpoint:'material',
 columns:{...Object.fromEntries(Object.entries(baseMasterConfig.materials.columns).filter(([key])=>!['PackagingType','TareWeight','TareWeightBasis'].includes(key))),Origin:'Origin',GradeName:'Grade'} as Record<string,string>,defaults:['MaterialCode','MaterialName','Origin','GradeName','UnitOfMeasure','Status'],
 fields:[...baseMasterConfig.materials.fields.filter(f=>!['PackagingTypeID','TareWeight','TareWeightBasis'].includes(f.key)),{key:'Origin',label:'Origin',max:200},{key:'GradeID',label:'Grade',kind:'rawgrade'} as Field]},
 'raw-prices':{...baseMasterConfig.prices,title:'Raw Pricing',singular:'raw material price',endpoint:'price'},
 materials:{...baseMasterConfig.materials,columns:{...baseMasterConfig.materials.columns,MaterialDimensionID:'Dimension definition',MaterialD1:'Material D1',MaterialD2:'Material D2',MaterialD3:'Material D3',MaterialDimensionsNeedsReview:'Dimensions need review'} as Record<string,string>,
  fields:[...baseMasterConfig.materials.fields,{key:'MaterialDimensionID',label:'Material dimension definition',kind:'materialdimension'},...['D1','D2','D3'].map(k=>({key:'Material'+k,label:'Material '+k,kind:'decimal' as const}))] as Field[]},
 prices:{...baseMasterConfig.prices}
};
export const filterLabels:Record<string,string>={search:'Search',status:'Status',created_by:'Created by',material_id:'Material',currency_id:'Currency',as_of:'Effective on'};
export type Lookups={products?:Row[];materialDimensions?:Row[];categories?:Row[];supplierDimensions?:Row[];packagingTypes?:Row[];rawGrades?:Row[];uoms?:Row[];vendors?:Row[];customers?:Row[];materials:Row[];currencies:Row[];creators:Row[]};
export const lookupLabel=(r:Row,kind:'material'|'currency'|'customer'|'vendor')=>kind==='vendor'?String(r.VendorName):kind==='customer'?String(r.CustomerName):kind==='material'?String(r.MaterialCode)+' — '+String(r.MaterialName):String(r.CurrencyCode)+(r.CurrencyName?' — '+r.CurrencyName:'');
export function defaultLayout(entity:MasterEntity):MasterLayout{const c=masterConfig[entity];return {columns:c.defaults,filters:(entity!=='prices'&&entity!=='raw-prices')?['search','status']:['search','material_id','currency_id','status'],values:{},sort:entity==='packaging-types'?[{column:'PackagingOrder',direction:'asc'},{column:'PackagingType',direction:'asc'}]:[{column:entity==='pallets'?'PalletSize':entity==='raw-grades'?'GradeName':entity==='uoms'?'UoMCode':entity==='vendors'?'VendorName':entity==='products'?'ProductCode':'MaterialCode',direction:'asc'}],page_size:25}}
export function displayValue(row:Row,key:string):string|null{const v=row[key];if(key==='ParentType'&&v!=null)return String(v).replace(/^(?:Primary|Secondary|Tertiary)(?:,\s*(?:Primary|Secondary|Tertiary))*\s*\/\s*/,'');if(key==='FinalComponent'||key==='CopyDim')return v?'True':'False';if(key==='Shipping')return row.ParentTypeID!=null?null:v?'True':'False';if(key==='PackagingOrder'&&row.ParentTypeID!=null)return null;if(key==='PackagingOrder'&&Array.isArray(row.PackagingOrders))return row.PackagingOrders.join(', ');if(key==='IsMix'||key==='MaterialAssign')return v?'Yes':'No';if(v===null||v===undefined||v==='')return null;if(key.endsWith('At'))return timestamp(v);if(key.startsWith('Effective'))return date(v);const formatted=numberDisplay(key,v);
 const currency=String(row.CurrencyCode??'').trim();
 if(key==='UnitUSDPrice'||key==='BaseUnitUSDPrice')return formatted+' USD';
 if((key==='UnitPrice'||key==='BaseUnitPrice')&&currency)return formatted+' '+currency;
 if(key==='ExchangeRateToUSD'&&currency)return formatted+' '+currency+' / USD';
 return formatted}

export function exportValue(row:Row,key:string):string|null{
 if(isNumericField(key))return row[key]===null||row[key]===undefined||row[key]===''?null:String(row[key]);
 return displayValue(row,key);
}
