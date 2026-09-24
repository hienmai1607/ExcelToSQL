import {timestamp} from './datetime';
import type {Row} from './api';
export type MasterEntity='materials'|'prices'|'products';
export const productRequiredColumns=['ProductCode','ProductName','Category','WeightGrams'];
export function requiredMasterColumns(entity:MasterEntity){return entity==='products'?productRequiredColumns:entity==='materials'?['MaterialCode','MaterialName','UnitOfMeasure']:['MaterialCode','CurrencyCode','PriceBasis','QuantityFrom','UnitPrice','EffectiveFrom']}
export function enforceMasterColumns(entity:MasterEntity,layout:MasterLayout):MasterLayout{
 return {...layout,columns:[...layout.columns,...requiredMasterColumns(entity).filter(c=>!layout.columns.includes(c))]};
}
export type MasterRule={column:string;direction:'asc'|'desc'};
export type MasterLayout={columns:string[];filters:string[];values:Record<string,string>;sort:MasterRule[];page_size:number};
export type Field={key:string;label:string;kind?:'decimal'|'date'|'material'|'currency'|'status'|'unit'|'text';required?:boolean;max?:number;initial?:string};
const audit={CreatedAt:'Created at',CreatedByName:'Created by',UpdatedAt:'Updated at',UpdatedByName:'Updated by'};
export const masterConfig={
 products:{title:'Products',singular:'product',endpoint:'product',columns:{ProductCode:'Product code',ProductName:'Product name',Category:'Category',Grade:'Grade',MixRatioPct:'Mix ratio %',WeightGrams:'Weight (g)',WeightOz:'Weight (oz)',Status:'Status',...audit} as Record<string,string>,
 defaults:['ProductCode','ProductName','Category','Grade','MixRatioPct','WeightGrams','WeightOz','Status'],filters:['search','status','created_by'],
 fields:[{key:'ProductCode',label:'Product code',required:true,max:20},{key:'ProductName',label:'Product name',required:true,max:200},{key:'Category',label:'Category',max:100},{key:'Grade',label:'Grade',max:100},{key:'MixRatioPct',label:'Mix ratio %',kind:'decimal'},{key:'WeightValue',label:'Weight',kind:'decimal',required:true},{key:'WeightUnit',label:'Weight unit',kind:'unit',required:true,initial:'g'}] as Field[]},
 materials:{title:'Packaging Material',singular:'material',endpoint:'material',columns:{MaterialCode:'Material code',MaterialName:'Material name',Description:'Description',UnitOfMeasure:'Unit of measure',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','MaterialName','UnitOfMeasure','Status'],filters:['search','status','created_by'],
 fields:[{key:'MaterialCode',label:'Material code',required:true,max:40},{key:'MaterialName',label:'Material name',required:true,max:200},{key:'Description',label:'Description',max:500},{key:'UnitOfMeasure',label:'Unit of measure',required:true,max:20}] as Field[]},
 prices:{title:'Packaging Material Pricing',singular:'price',endpoint:'price',columns:{MaterialCode:'Material',MaterialName:'Material name',CurrencyCode:'Currency',PriceBasis:'Price basis',QuantityFrom:'Quantity from',QuantityTo:'Quantity to',UnitPrice:'Unit price',EffectiveFrom:'Effective from',EffectiveTo:'Effective to',Status:'Status',...audit} as Record<string,string>,
 defaults:['MaterialCode','CurrencyCode','PriceBasis','QuantityFrom','QuantityTo','UnitPrice','EffectiveFrom','EffectiveTo','Status'],filters:['search','material_id','currency_id','as_of','status','created_by'],
 fields:[{key:'MaterialID',label:'Material',kind:'material',required:true},{key:'CurrencyID',label:'Currency',kind:'currency',required:true},{key:'PriceBasis',label:'Price basis',required:true,max:40},{key:'QuantityFrom',label:'Quantity from (inclusive)',kind:'decimal',required:true,initial:'0'},{key:'QuantityTo',label:'Quantity to (exclusive)',kind:'decimal'},{key:'UnitPrice',label:'Unit price',kind:'decimal',required:true},{key:'EffectiveFrom',label:'Effective from',kind:'date',required:true},{key:'EffectiveTo',label:'Effective to',kind:'date'}] as Field[]}
};
export const filterLabels:Record<string,string>={search:'Search',status:'Status',created_by:'Created by',material_id:'Material',currency_id:'Currency',as_of:'Effective on'};
export type Lookups={materials:Row[];currencies:Row[];creators:Row[]};
export const lookupLabel=(r:Row,kind:'material'|'currency')=>kind==='material'?String(r.MaterialCode)+' — '+String(r.MaterialName):String(r.CurrencyCode)+(r.CurrencyName?' — '+r.CurrencyName:'');
export function defaultLayout(entity:MasterEntity):MasterLayout{const c=masterConfig[entity];return {columns:c.defaults,filters:entity!=='prices'?['search','status']:['search','material_id','currency_id','status'],values:{},sort:[{column:entity==='products'?'ProductCode':'MaterialCode',direction:'asc'}],page_size:25}}
export function displayValue(row:Row,key:string):string|null{const v=row[key];if(v===null||v===undefined||v==='')return null;if(key.endsWith('At'))return timestamp(v);if(key.startsWith('Effective'))return String(v).slice(0,10);return String(v)}
