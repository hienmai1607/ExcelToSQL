import type {Row} from './api';
import {allowedContainerTypes,containerTypes} from './container-loading';
import {childOtherKeys,scopedShipment,type ShipmentScope} from './shipment-ownership';
import {warehouseValues,warehouseTotal} from './warehouse-cost-model';
export {scopedShipment,type ShipmentScope} from './shipment-ownership';

export function requestedContainerType(requirements:Record<string,string>,values:Record<string,string>){
 const request=requirements.ContainerRequest||'';
 if(containerTypes.includes(request as typeof containerTypes[number]))return request;
 if(!values.ContainerSizeFT||!['Dry','Reefer'].includes(request))return '';
 const types=allowedContainerTypes(request,values.ContainerSizeFT);
 return types.length===1?types[0]:'';
}

export const incoterms=[...new Set(['CFA','FOB','FCA','FAS','CFR','CIF','CPT','CIP','EXW','DAP','DPU','DDP'])].sort();

export type CostField={key:string;label:string;kind:'usd'|'pct'|'days'};
export const costSections:{title:string;fields:CostField[]}[]=[
 {title:'Logistics',fields:[
  {key:'FobbingUSDPerContainer',label:'Fobbing (USD/cont)',kind:'usd'},
  {key:'FreightUSDPerContainer',label:'Freight (USD/cont)',kind:'usd'},
  {key:'DutyPct',label:'Duty %',kind:'pct'},
  {key:'ImportClearanceCustomerPerContainer',label:'Import clearance (customer currency/cont)',kind:'usd'},
  {key:'PortToWHCustomerPerContainer',label:'Port - WH (customer currency/cont)',kind:'usd'},
  {key:'WHCostCustomerPerPallet',label:'WH Cost (customer currency/pallet)',kind:'usd'},
  {key:'OverageShortageDamagePct',label:'Overage, Shortage & Damage %',kind:'pct'}]},
 {title:'Co-Man',fields:[
  {key:'WHToCoManWHUSDPerPallet',label:'WH - Co-Man WH (USD/pallet)',kind:'usd'},
  {key:'CoManOverheadUSDPerPallet',label:'Co-Man Overhead (USD/pallet)',kind:'usd'},
  {key:'FreightToCustomerUSDPerPallet',label:'Freight to Customer (USD/pallet)',kind:'usd'},
  {key:'SpoilageAllowancePct',label:'Spoilage Allowance %',kind:'pct'},
  {key:'PaymentTermPct',label:'Payment Term %',kind:'pct'},
  {key:'CoManFeePct',label:'Co-Man fee %',kind:'pct'},
  {key:'BrokerFeePct',label:'Broker Fee %',kind:'pct'}]},
 {title:'Others',fields:[
  {key:'PackingUSDPerLb',label:'Packing cost (USD/lbs)',kind:'usd'},
  {key:'InitialDesignUSD',label:'Initial Design (USD)',kind:'usd'},
  {key:'OtherFixedCostsUSD',label:'Other fixed costs (USD)',kind:'usd'},
  {key:'InterestPct',label:'Interest %',kind:'pct'},
  {key:'InterestDays',label:'Interest days',kind:'days'},
  {key:'MarginPct',label:'Margin %',kind:'pct'},
  {key:'MarginUSDPerLb',label:'Margin (USD/lbs)',kind:'usd'},
  {key:'PaymentTermDays',label:'Payment term (days)',kind:'days'}]}
];
export const fields=costSections.flatMap(s=>s.fields);
const keys=['WHCostBreakdown','Incoterm','PortOfEntryID','ContainerSizeFT','FloorLoadUSDPerMT','MarginMode','ImportClearanceUSDPerContainer','ImportClearanceCustomerPerPallet','InterestMonths','PortToWHUSDPerContainer','WHCostUSDPerPallet','InitialDesignCustomer',...fields.map(f=>f.key)];
export const customerCosts:Record<string,{name:string;unit:string;legacy?:string}>={
 ImportClearanceCustomerPerContainer:{name:'Import clearance',unit:'cont'},
 PortToWHCustomerPerContainer:{name:'Port - WH',unit:'cont',legacy:'PortToWHUSDPerContainer'},
 WHCostCustomerPerPallet:{name:'WH Cost',unit:'pallet',legacy:'WHCostUSDPerPallet'},
 InitialDesignCustomer:{name:'Initial Design',unit:''}
};
export function shipmentValues(raw?:unknown):Record<string,string>{
 let data:Row={};
 try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed as Row}catch{}
 const values=Object.fromEntries(keys.map(key=>[key,key==='WHCostBreakdown'&&data[key]!=null?JSON.stringify(data[key]):String(data[key]??'')]));
 if(data.InterestDays==null&&data.InterestMonths!=null)values.InterestDays=String(Number(data.InterestMonths)*30);
 values.MarginMode=String(data.MarginMode??(data.MarginUSDPerLb!=null?'USDPerLb':'Percent'));
 values.InitialDesignMode=data.InitialDesignCustomer!=null?'Customer':'';
 return values;
}
export function shipmentPayload(values:Record<string,string>,scope:ShipmentScope='all'){
 values=scopedShipment(values,scope);
 const selectedKeys=keys.filter(key=>scope==='all'||(scope==='child-others'?childOtherKeys.has(key):!childOtherKeys.has(key)));
 if(!selectedKeys.some(key=>key!=='MarginMode'&&values[key]))return null;
 return Object.fromEntries(selectedKeys.map(key=>[key,key==='WHCostBreakdown'?(values[key]?JSON.parse(values[key]):null):key==='InitialDesignUSD'&&values.InitialDesignMode==='Customer'||key==='InitialDesignCustomer'&&values.InitialDesignMode!=='Customer'||key==='InterestMonths'&&values.InterestDays!==''||key==='MarginPct'&&values.MarginMode==='USDPerLb'||key==='MarginUSDPerLb'&&values.MarginMode!=='USDPerLb'?null:!values[key]?null:['PortOfEntryID','InterestMonths','InterestDays','PaymentTermDays'].includes(key)?Number(values[key]):values[key]]));
}
export function fixedCost(value:string){
 if(!/^\d+(\.\d{1,2})?$/.test(value))return value;
 const [whole,fraction='']=value.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.padEnd(2,'0');
}
export function shipmentError(values:Record<string,string>,original:Record<string,string>|undefined,customer:Row|undefined,ports:Row[]){
 if(values.Incoterm&&!incoterms.includes(values.Incoterm))return 'Choose a valid Incoterm.';
 if(values.ContainerSizeFT&&!['20FT','40FT'].includes(values.ContainerSizeFT))return 'Choose 20FT or 40FT.';
 if(values.PortOfEntryID&&values.PortOfEntryID!==original?.PortOfEntryID&&!ports.some(p=>String(p.ID)===values.PortOfEntryID&&String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID)))return 'Choose a Port of Entry for this Customer and Market.';
 if(values.WHCostBreakdown){try{const total=warehouseTotal(warehouseValues(values.WHCostBreakdown));if(total===null||total!==fixedCost(values.WHCostCustomerPerPallet||'0'))return 'WH Cost must match its calculation breakdown.'}catch{return 'Check WH Cost calculation.'}}
 if(values.MarginMode&&!['Percent','USDPerLb'].includes(values.MarginMode))return 'Choose a Margin basis.';
 for(const field of [...fields,{key:'InitialDesignCustomer',label:'Initial Design (customer currency)',kind:'usd'},{key:'FloorLoadUSDPerMT',label:'Floor load cost (USD/MT)',kind:'usd'} as CostField]){
  if(field.key==='InitialDesignUSD'&&values.InitialDesignMode==='Customer'||field.key==='InitialDesignCustomer'&&values.InitialDesignMode!=='Customer')continue;
  const value=values[field.key]||'';if(!value||field.key==='MarginPct'&&values.MarginMode==='USDPerLb'||field.key==='MarginUSDPerLb'&&values.MarginMode!=='USDPerLb')continue;
  if(field.kind==='days'?(!/^\d{1,10}$/.test(value)||Number(value)>2147483647):(!/^\d{1,17}(\.\d{1,2})?$/.test(value)||field.kind==='pct'&&Number(value)>100))return 'Check '+field.label+': '+(field.kind==='days'?'use whole nonnegative days.':field.kind==='pct'?'use 0 to 100 with up to two decimals.':'use nonnegative amounts with up to two decimals.');
 }
 return '';
}
