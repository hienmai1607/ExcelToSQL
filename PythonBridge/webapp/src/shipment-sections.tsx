import type {Row} from './api';
import {FieldLabel} from './ui';

type CostField={key:string;label:string;kind:'usd'|'pct'|'months'};
export const costSections:{title:string;fields:CostField[]}[]=[
 {title:'Logistics',fields:[
  {key:'FreightUSDPerContainer',label:'Freight ($/Container)',kind:'usd'},
  {key:'DutyPct',label:'Duty %',kind:'pct'},
  {key:'ImportClearanceUSDPerContainer',label:'Import clearance ($/cont)',kind:'usd'},
  {key:'PortToWHUSDPerContainer',label:'Port - WH ($/cont)',kind:'usd'},
  {key:'WHCostUSDPerPallet',label:'WH Cost ($/pallet)',kind:'usd'},
  {key:'OverageShortageDamagePct',label:'Overage, Shortage & Damage %',kind:'pct'}]},
 {title:'Co-Man',fields:[
  {key:'WHToCoManWHUSDPerPallet',label:'WH - Co-Man WH ($/pallet)',kind:'usd'},
  {key:'CoManOverheadUSDPerPallet',label:'Co-Man Overhead ($/pallet)',kind:'usd'},
  {key:'FreightToCustomerUSDPerPallet',label:'Freight to Customer ($/pallet)',kind:'usd'},
  {key:'SpoilageAllowancePct',label:'Spoilage Allowance %',kind:'pct'},
  {key:'PaymentTermPct',label:'Payment Term %',kind:'pct'},
  {key:'CoManFeePct',label:'Co-Man fee %',kind:'pct'},
  {key:'BrokerFeePct',label:'Broker Fee %',kind:'pct'}]},
 {title:'Others',fields:[
  {key:'PackingUSDPerLb',label:'Packing cost ($/lbs)',kind:'usd'},
  {key:'InitialDesignUSD',label:'Initial Design ($)',kind:'usd'},
  {key:'OtherFixedCostsUSD',label:'Other fixed costs ($)',kind:'usd'},
  {key:'FobbingUSDPerContainer',label:'Fobbing/container ($)',kind:'usd'},
  {key:'InterestPct',label:'Interest %',kind:'pct'},
  {key:'InterestMonths',label:'Interest months',kind:'months'},
  {key:'MarginPct',label:'Margin %',kind:'pct'}]}
];
const fields=costSections.flatMap(s=>s.fields);
const keys=['Incoterm','PortOfEntryID','ContainerSizeFT',...fields.map(f=>f.key)];
export function shipmentValues(raw?:unknown):Record<string,string>{
 let data:Row={};
 try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed as Row}catch{}
 return Object.fromEntries(keys.map(key=>[key,String(data[key]??'')]));
}
export function shipmentPayload(values:Record<string,string>){
 if(!keys.some(key=>values[key]))return null;
 return Object.fromEntries(keys.map(key=>[key,!values[key]?null:['PortOfEntryID','InterestMonths'].includes(key)?Number(values[key]):values[key]]));
}
export function fixedCost(value:string){
 if(!/^\d+(\.\d{1,2})?$/.test(value))return value;
 const [whole,fraction='']=value.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.padEnd(2,'0');
}
export function shipmentError(values:Record<string,string>,original:Record<string,string>|undefined,customer:Row|undefined,ports:Row[]){
 if(values.Incoterm&&!['CFA','DDP','EXW','FOB'].includes(values.Incoterm))return 'Choose a valid Incoterm.';
 if(values.ContainerSizeFT&&!['20FT','40FT'].includes(values.ContainerSizeFT))return 'Choose 20FT or 40FT.';
 if(values.PortOfEntryID&&values.PortOfEntryID!==original?.PortOfEntryID&&!ports.some(p=>String(p.ID)===values.PortOfEntryID&&String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID)))return 'Choose a Port of Entry for this Customer and Market.';
 for(const field of fields){
  const value=values[field.key]||'';if(!value)continue;
  if(field.kind==='months'?(!/^\d{1,10}$/.test(value)||Number(value)>2147483647):(!/^\d{1,17}(\.\d{1,2})?$/.test(value)||field.kind==='pct'&&Number(value)>100))return 'Check '+field.label+': '+(field.kind==='months'?'use whole nonnegative months.':field.kind==='pct'?'use 0 to 100 with up to two decimals.':'use nonnegative USD with up to two decimals.');
 }
 return '';
}
export function ShipmentSections({values,requirements,customer,ports=[],child=false,requirementsLocked=false,onChange,onRequirementChange}:{values:Record<string,string>;requirements:Record<string,string>;customer?:Row;ports?:Row[];child?:boolean;requirementsLocked?:boolean;onChange:(key:string,value:string)=>void;onRequirementChange:(key:string,value:string)=>void}){
 const available=ports.filter(p=>String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID));
 function select(key:string,label:string,options:{id:string;label:string}[],value:string,help?:string,requirement=false){
  const known=options.some(o=>o.id===value);
  return <label key={key} className={requirement&&requirementsLocked?'display-only-fields':undefined}><FieldLabel help={requirement&&requirementsLocked?(help||'')+' Locked while a Packaging Request is processing.':help}>{label}</FieldLabel>{child?<input aria-label={label} readOnly value={options.find(o=>o.id===value)?.label||value}/>:<select aria-label={label} disabled={requirement&&requirementsLocked} value={value} onChange={event=>(requirement?onRequirementChange:onChange)(key,event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{value&&!known&&<option value={value} disabled>Existing {key==='PortOfEntryID'?'port #':''}{value} (unavailable)</option>}{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>}</label>;
 }
 const options=(values:string[])=>values.map(value=>({id:value,label:value}));
 return <div className={'requirement-sections shipment-sections'+(child?' display-only-fields':'')}>
 <section aria-label="Shipment"><h4>Shipment</h4><div className="shipment-entry-grid">
  {select('ContainerRequest','Configuration request',options(['Dry','Reefer']),requirements.ContainerRequest||'','Transport category. Captured in each new Packaging Request.',true)}
  {select('ConfigurationRequest','Loading request',options(['Pallet load','Floor load','Both']),requirements.ConfigurationRequest||'','Container and loading selections remain frozen in an existing PCR.',true)}
  {select('Incoterm','Incoterm',options(['CFA','DDP','EXW','FOB']),values.Incoterm||'')}
  {select('PortOfEntryID','Port of Entry',available.map(p=>({id:String(p.ID),label:String(p.PortName)})),values.PortOfEntryID||'','Filtered by this Customer and its Market. Admin maintains Ports of Entry in Shared masters.')}
  {select('ContainerSizeFT','Container',options(['20FT','40FT']),values.ContainerSizeFT||'','20FT: 20DC for Dry or 20RC for Reefer. 40FT: 40DC/40HC for Dry or 40RHC for Reefer. New PCR responses follow this captured size.')}
 </div></section>
 {costSections.map(section=><section key={section.title} aria-label={section.title}><h4>{section.title}</h4><div className="shipment-entry-grid">{section.fields.map(field=><label key={field.key}><FieldLabel>{field.label}</FieldLabel><input aria-label={field.label} inputMode={field.kind==='months'?'numeric':'decimal'} readOnly={child} value={child&&field.kind!=='months'?fixedCost(values[field.key]||''):values[field.key]||''} onChange={event=>onChange(field.key,event.target.value)} onBlur={()=>{if(!child&&field.kind!=='months')onChange(field.key,fixedCost(values[field.key]||''))}}/></label>)}</div></section>)}
 </div>;
}
