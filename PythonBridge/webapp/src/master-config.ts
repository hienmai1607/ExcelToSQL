import {numberDisplay,isNumericField} from './number-format';
import {timestamp} from './datetime';
import type {Row} from './api';
export type MasterEntity='materials'|'prices'|'products'|'vendors'|'uoms';
export const productRequiredColumns=['CustomerName','ProductName','Category','WeightGrams'];
export function requiredMasterColumns(entity:MasterEntity){return entity==='uoms'?['UoMCode']:entity==='vendors'?['VendorName']:entity==='products'?productRequiredColumns:entity==='materials'?['MaterialName','UnitOfMeasure']:['MaterialCode','CurrencyCode','BaseUoM','QuantityFrom','UnitPrice','EffectiveFrom']}
export function enforceMasterColumns(entity:MasterEntity,layout:MasterLayout):MasterLayout{
 if(entity==='prices')layout={...layout,columns:[...new Set(layout.columns.map(c=>c==='PriceBasis'?'BaseUoM':c))],sort:layout.sort.map(r=>({...r,column:r.column==='PriceBasis'?'BaseUoM':r.column}))};
 const retired=entity==='products'?['Grade','MixRatioPct']:[];
 layout={...layout,columns:layout.columns.filter(c=>!retired.includes(c)),sort:layout.sort.filter(s=>!retired.includes(s.column))};
 return {...layout,columns:[...layout.columns,...requiredMasterColumns(entity).filter(c=>!layout.columns.includes(c))]};
}
export type MasterRule={column:string;direction:'asc'|'desc'};
export type MasterLayout={column_widths?:Record<string,number>;columns:string[];filters:string[];values:Record<string,string>;sort:MasterRule[];page_size:number};
export type Field={key:string;label:string;kind?:'uom'|'boolean'|'decimal'|'date'|'material'|'vendor'|'customer'|'currency'|'status'|'unit'|'text';required?:boolean;max?:number;initial?:string};
const audit={CreatedAt:'Created at',CreatedByName:'Created by',UpdatedAt:'Updated at',UpdatedByName:'Updated by'};
export const masterConfig={
 uoms:{title:'Units of Measure',singular:'UoM',endpoint:'uom',columns:{UoMCode:'UoM code',UoMName:'UoM name',Status:'Status',...audit} as Record<string,string>,
 defaults:['UoMCode','UoMName','Status'],filters:['search','status','created_by'],
 fields:[{key:'UoMCode',label:'UoM code',required:true,max:40},{key:'UoMName',label:'UoM name',max:500}] as Field[]},
 vendors:{title:'Vendors',singular:'vendor',endpoint:'vendor',columns:{VendorName:'Vendor name',Address:'Address',CurrencyCode:'Currency',Status:'Status',...audit} as Record<string,string>,
 defaults:['VendorName','Address','CurrencyCode','Status'],filters:['search','status','created_by'],
 fields:[{key:'VendorName',label:'Vendor name',required:true,max:200},{key:'Address',label:'Address',max:500},{key:'CurrencyID',label:'Currency',kind:'currency'}] as Field[]},
 products:{title:'Products',singular:'product',endpoint:'product',columns:{IsMix:'Product Mix',CustomerName:'Customer',ProductCode:'Product code',ProductName:'Product name',Category:'Category',WeightGrams:'Net Weight (g)',WeightOz:'Net Weight (oz)',Status:'Status',...audit} as Record<string,string>,
 defaults:['IsMix','CustomerName','ProductCode','ProductName','Category','WeightGrams','WeightOz','Status'],filters:['search','status','created_by'],
 fields:[{key:'IsMix',label:'Product Mix',kind:'boolean',initial:'false'},{key:'CustomerID',label:'Customer',kind:'customer',required:true},{key:'ProductName',label:'Product name',required:true,max:200},{key:'Category',label:'Category',max:100},{key:'WeightValue',label:'Weight',kind:'decimal',required:true},{key:'WeightUnit',label:'Weight unit',kind:'unit',required:true,initial:'g'}] as Field[]},
 materials:{title:'Packaging Material',singular:'material',endpoint:'material',columns:{MaterialCode:'Material code',MaterialName:'Material name',Description:'Description',UnitOfMeasure:'Base UoM',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','MaterialName','UnitOfMeasure','Status'],filters:['search','status','created_by'],
 fields:[{key:'MaterialName',label:'Material name',required:true,max:200},{key:'Description',label:'Description',max:500},{key:'UnitOfMeasure',label:'Base UoM',kind:'uom',required:true,max:20}] as Field[]},
 prices:{title:'Packaging Material Pricing',singular:'price',endpoint:'price',columns:{VendorName:'Vendor',MaterialCode:'Material',MaterialName:'Material name',CurrencyCode:'Vendor currency',ExchangeRateToUSD:'Exchange rate (Vendor currency per USD)',UnitUSDPrice:'Unit USD price',BaseUoM:'Price UoM',QuantityFrom:'Quantity from',QuantityTo:'Quantity to',UnitPrice:'Unit price (Vendor currency)',EffectiveFrom:'Effective from',EffectiveTo:'Effective to',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','VendorName','CurrencyCode','BaseUoM','QuantityFrom','QuantityTo','UnitPrice','ExchangeRateToUSD','UnitUSDPrice','EffectiveFrom','EffectiveTo','Status'],filters:['search','material_id','currency_id','as_of','status','created_by'],
 fields:[{key:'VendorID',label:'Vendor',kind:'vendor'},{key:'MaterialID',label:'Material',kind:'material',required:true},{key:'CurrencyID',label:'Vendor currency',kind:'currency',required:true},{key:'BaseUoM',label:'Price UoM',kind:'uom',required:true},{key:'QuantityFrom',label:'Quantity from (inclusive)',kind:'decimal',required:true,initial:'0'},{key:'QuantityTo',label:'Quantity to (exclusive)',kind:'decimal'},{key:'UnitPrice',label:'Unit price (Vendor currency)',kind:'decimal',required:true},{key:'ExchangeRateToUSD',label:'Exchange rate (Vendor currency per USD)',kind:'decimal'},{key:'EffectiveFrom',label:'Effective from',kind:'date',required:true},{key:'EffectiveTo',label:'Effective to',kind:'date'}] as Field[]}
};
export const filterLabels:Record<string,string>={search:'Search',status:'Status',created_by:'Created by',material_id:'Material',currency_id:'Currency',as_of:'Effective on'};
export type Lookups={uoms?:Row[];vendors?:Row[];customers?:Row[];materials:Row[];currencies:Row[];creators:Row[]};
export const lookupLabel=(r:Row,kind:'material'|'currency'|'customer'|'vendor')=>kind==='vendor'?String(r.VendorName):kind==='customer'?String(r.CustomerName):kind==='material'?String(r.MaterialCode)+' — '+String(r.MaterialName):String(r.CurrencyCode)+(r.CurrencyName?' — '+r.CurrencyName:'');
export function defaultLayout(entity:MasterEntity):MasterLayout{const c=masterConfig[entity];return {columns:c.defaults,filters:entity!=='prices'?['search','status']:['search','material_id','currency_id','status'],values:{},sort:[{column:entity==='uoms'?'UoMCode':entity==='vendors'?'VendorName':entity==='products'?'ProductCode':'MaterialCode',direction:'asc'}],page_size:25}}
export function displayValue(row:Row,key:string):string|null{const v=row[key];if(key==='IsMix')return v?'Yes':'No';if(v===null||v===undefined||v==='')return null;if(key.endsWith('At'))return timestamp(v);if(key.startsWith('Effective'))return String(v).slice(0,10);const formatted=numberDisplay(key,v);
 const currency=String(row.CurrencyCode??'').trim();
 if(key==='UnitUSDPrice')return formatted+' USD';
 if(key==='UnitPrice'&&currency)return formatted+' '+currency;
 if(key==='ExchangeRateToUSD'&&currency)return formatted+' '+currency+' / USD';
 return formatted}

export function exportValue(row:Row,key:string):string|null{
 if(isNumericField(key))return row[key]===null||row[key]===undefined||row[key]===''?null:String(row[key]);
 return displayValue(row,key);
}
