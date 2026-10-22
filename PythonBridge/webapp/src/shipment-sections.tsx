import {Fragment} from 'react';
import {AddMasterButton} from './add-master-button';
import type {Row} from './api';
import {FieldLabel} from './ui';
import {quantity,divide,quantityDisplay} from './packaging-summary-model';
import {allowedContainerTypes,containerTypes} from './container-loading';
import {childOtherKeys,scopedShipment,type ShipmentScope} from './shipment-ownership';
export {scopedShipment,type ShipmentScope} from './shipment-ownership';

export function requestedContainerType(requirements:Record<string,string>,values:Record<string,string>){
 const request=requirements.ContainerRequest||'';
 if(containerTypes.includes(request as typeof containerTypes[number]))return request;
 if(!values.ContainerSizeFT||!['Dry','Reefer'].includes(request))return '';
 const types=allowedContainerTypes(request,values.ContainerSizeFT);
 return types.length===1?types[0]:'';
}

type CostField={key:string;label:string;kind:'usd'|'pct'|'days'};
export const costSections:{title:string;fields:CostField[]}[]=[
 {title:'Logistics',fields:[
  {key:'FreightUSDPerContainer',label:'Freight ($/Container)',kind:'usd'},
  {key:'DutyPct',label:'Duty %',kind:'pct'},
  {key:'ImportClearanceCustomerPerContainer',label:'Import clearance (customer currency/container)',kind:'usd'},
  {key:'PortToWHCustomerPerContainer',label:'Port - WH (customer currency/container)',kind:'usd'},
  {key:'WHCostCustomerPerPallet',label:'WH Cost (customer currency/pallet)',kind:'usd'},
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
  {key:'InterestDays',label:'Interest days',kind:'days'},
  {key:'MarginPct',label:'Margin %',kind:'pct'},
  {key:'MarginUSDPerLb',label:'Margin ($/lbs)',kind:'usd'},
  {key:'PaymentTermDays',label:'Payment term (days)',kind:'days'}]}
];
const fields=costSections.flatMap(s=>s.fields);
const keys=['Incoterm','PortOfEntryID','ContainerSizeFT','FloorLoadUSDPerMT','MarginMode','ImportClearanceUSDPerContainer','ImportClearanceCustomerPerPallet','InterestMonths','PortToWHUSDPerContainer','WHCostUSDPerPallet','InitialDesignCustomer',...fields.map(f=>f.key)];
const customerCosts:Record<string,{name:string;unit:string;legacy?:string}>={
 ImportClearanceCustomerPerContainer:{name:'Import clearance',unit:'container'},
 PortToWHCustomerPerContainer:{name:'Port - WH',unit:'container',legacy:'PortToWHUSDPerContainer'},
 WHCostCustomerPerPallet:{name:'WH Cost',unit:'pallet',legacy:'WHCostUSDPerPallet'},
 InitialDesignCustomer:{name:'Initial Design',unit:''}
};
export function shipmentValues(raw?:unknown):Record<string,string>{
 let data:Row={};
 try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed as Row}catch{}
 const values=Object.fromEntries(keys.map(key=>[key,String(data[key]??'')]));
 if(data.InterestDays==null&&data.InterestMonths!=null)values.InterestDays=String(Number(data.InterestMonths)*30);
 values.MarginMode=String(data.MarginMode??(data.MarginUSDPerLb!=null?'USDPerLb':'Percent'));
 values.InitialDesignMode=data.InitialDesignCustomer!=null?'Customer':'';
 return values;
}
export function shipmentPayload(values:Record<string,string>,scope:ShipmentScope='all'){
 values=scopedShipment(values,scope);
 const selectedKeys=keys.filter(key=>scope==='all'||(scope==='child-others'?childOtherKeys.has(key):!childOtherKeys.has(key)));
 if(!selectedKeys.some(key=>key!=='MarginMode'&&values[key]))return null;
 return Object.fromEntries(selectedKeys.map(key=>[key,key==='InitialDesignUSD'&&values.InitialDesignMode==='Customer'||key==='InitialDesignCustomer'&&values.InitialDesignMode!=='Customer'||key==='InterestMonths'&&values.InterestDays!==''||key==='MarginPct'&&values.MarginMode==='USDPerLb'||key==='MarginUSDPerLb'&&values.MarginMode!=='USDPerLb'?null:!values[key]?null:['PortOfEntryID','InterestMonths','InterestDays','PaymentTermDays'].includes(key)?Number(values[key]):values[key]]));
}
export function fixedCost(value:string){
 if(!/^\d+(\.\d{1,2})?$/.test(value))return value;
 const [whole,fraction='']=value.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.padEnd(2,'0');
}
export function shipmentError(values:Record<string,string>,original:Record<string,string>|undefined,customer:Row|undefined,ports:Row[]){
 if(values.Incoterm&&!['CFA','DDP','EXW','FOB'].includes(values.Incoterm))return 'Choose a valid Incoterm.';
 if(values.ContainerSizeFT&&!['20FT','40FT'].includes(values.ContainerSizeFT))return 'Choose 20FT or 40FT.';
 if(values.PortOfEntryID&&values.PortOfEntryID!==original?.PortOfEntryID&&!ports.some(p=>String(p.ID)===values.PortOfEntryID&&String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID)))return 'Choose a Port of Entry for this Customer and Market.';
 if(values.MarginMode&&!['Percent','USDPerLb'].includes(values.MarginMode))return 'Choose a Margin basis.';
 for(const field of [...fields,{key:'InitialDesignCustomer',label:'Initial Design (customer currency)',kind:'usd'},{key:'FloorLoadUSDPerMT',label:'Floor load cost ($/MT)',kind:'usd'} as CostField]){
  if(field.key==='InitialDesignUSD'&&values.InitialDesignMode==='Customer'||field.key==='InitialDesignCustomer'&&values.InitialDesignMode!=='Customer')continue;
  const value=values[field.key]||'';if(!value||field.key==='MarginPct'&&values.MarginMode==='USDPerLb'||field.key==='MarginUSDPerLb'&&values.MarginMode!=='USDPerLb')continue;
  if(field.kind==='days'?(!/^\d{1,10}$/.test(value)||Number(value)>2147483647):(!/^\d{1,17}(\.\d{1,2})?$/.test(value)||field.kind==='pct'&&Number(value)>100))return 'Check '+field.label+': '+(field.kind==='days'?'use whole nonnegative days.':field.kind==='pct'?'use 0 to 100 with up to two decimals.':'use nonnegative amounts with up to two decimals.');
 }
 return '';
}
export function ShipmentSections({values,requirements,customer,currency='',exchangeRate='',ports=[],child=false,scope='all',requirementsLocked=false,onAddPort,onPortEdited,onChange,onRequirementChange}:{onAddPort?:()=>void;onPortEdited?:(record:Row)=>void|Promise<void>;values:Record<string,string>;requirements:Record<string,string>;customer?:Row;currency?:string;exchangeRate?:string;ports?:Row[];child?:boolean;scope?:ShipmentScope;requirementsLocked?:boolean;onChange:(key:string,value:string)=>void;onRequirementChange:(key:string,value:string)=>void}){
 const available=ports.filter(p=>String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID));
 function select(key:string,label:string,options:{id:string;label:string}[],value:string,help?:string,requirement=false){
  const known=options.some(o=>o.id===value);
  return <label key={key} className={requirement&&requirementsLocked?'display-only-fields':undefined}><FieldLabel help={requirement&&requirementsLocked?(help||'')+' Locked while a Packaging Request is processing.':help}>{label}</FieldLabel><span className="inline-master-field">{child?<input aria-label={label} readOnly value={options.find(o=>o.id===value)?.label||value}/>:<select aria-label={label} disabled={requirement&&requirementsLocked} value={value} onChange={event=>(requirement?onRequirementChange:onChange)(key,event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{value&&!known&&<option value={value} disabled>Existing {key==='PortOfEntryID'?'port #':''}{value} (unavailable)</option>}{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>}{key==='PortOfEntryID'&&!child&&onAddPort&&<AddMasterButton entity="ports" selectedValue={value} onEdited={onPortEdited} label="Add new Port of Entry master" onClick={onAddPort}/>}</span></label>;
 }
 const options=(values:string[])=>values.map(value=>({id:value,label:value}));
 const costLabel=(field:CostField)=>['InitialDesignUSD','InitialDesignCustomer'].includes(field.key)?'Initial Design':customerCosts[field.key]?customerCosts[field.key].name+' ('+(currency||'customer currency')+(customerCosts[field.key].unit?'/'+customerCosts[field.key].unit:'')+')':field.key==='InitialDesignUSD'?'Initial Design (USD)':field.label;
 function costInput(field:CostField){
  const value=values[field.key]||'';
  return <input aria-label={costLabel(field)} inputMode={field.kind==='days'?'numeric':'decimal'} readOnly={child} value={child&&field.kind!=='days'?fixedCost(value):value} onChange={event=>{onChange(field.key,event.target.value);const legacy=customerCosts[field.key]?.legacy;if(legacy)onChange(legacy,'');if(field.key==='ImportClearanceCustomerPerContainer'){onChange('ImportClearanceUSDPerContainer','');onChange('ImportClearanceCustomerPerPallet','')}}} onBlur={()=>{if(!child&&field.kind!=='days')onChange(field.key,fixedCost(value))}}/>;
 }
 function cost(field:CostField){
  const design=field.key==='InitialDesignUSD';
  if(design&&values.InitialDesignMode==='Customer')field={...field,key:'InitialDesignCustomer'};
  const value=values[field.key]||'',amount=quantity(value,true),fx=currency==='USD'?quantity('1'):quantity(exchangeRate);
  const customerCost=customerCosts[field.key],suffix=customerCost?.unit?'/'+customerCost.unit:'';
  const legacy=customerCost?.legacy?values[customerCost.legacy]:'';
  const conversion=customerCost&&value?(amount&&fx?quantityDisplay(divide(amount,fx),2)+' USD'+suffix:'USD: enter exchange rate'):legacy?'Saved: '+fixedCost(legacy)+' USD'+suffix:'';
  return <div key={design?'InitialDesign':field.key} className="shipment-cost-field"><FieldLabel>{costLabel(field)}</FieldLabel><span className="shipment-cost-input">{costInput(field)}{design&&<select aria-label="Initial Design currency" disabled={child} value={values.InitialDesignMode==='Customer'&&currency!=='USD'?'Customer':'USD'} onChange={e=>{onChange('InitialDesignMode',e.target.value==='Customer'?'Customer':'')}}><option value="USD">USD</option>{currency&&currency!=='USD'&&<option value="Customer">{currency}</option>}</select>}{conversion&&<output aria-label={customerCost.name+' USD'+(customerCost.unit?' per '+customerCost.unit:'')}>{conversion}</output>}</span></div>;
 }
 function margin(){
  const dollar=values.MarginMode==='USDPerLb',field=fields.find(f=>f.key===(dollar?'MarginUSDPerLb':'MarginPct'))!;
  return <div className="margin-cost-field" role="group" aria-label="Margin"><FieldLabel>{field.label}</FieldLabel><span className="shipment-cost-input margin-cost-input"><select aria-label="Margin basis" disabled={child} value={dollar?'USDPerLb':'Percent'} onChange={e=>onChange('MarginMode',e.target.value)}><option value="Percent">Margin %</option><option value="USDPerLb">Margin ($/lbs)</option></select>{costInput(field)}</span></div>;
 }
 return <div className={'requirement-sections shipment-sections'+(child?' display-only-fields':'')}>
 {scope!=='child-others'&&<section aria-label="Shipment"><h4>Shipment</h4><div className="shipment-entry-grid">
  <label className={requirementsLocked?'display-only-fields':undefined}><FieldLabel help="Required. The exact container type is captured in each new Packaging Request and locked while it is processing.">Container Type *</FieldLabel>{child?<input aria-label="Container Type" readOnly value={requestedContainerType(requirements,values)||requirements.ContainerRequest||''}/>:<select aria-label="Container Type" required aria-required="true" disabled={requirementsLocked} value={requestedContainerType(requirements,values)} onChange={event=>{const kind=event.target.value;onRequirementChange('ContainerRequest',kind);onChange('ContainerSizeFT',kind?kind.slice(0,2)+'FT':'')}}><option value="">Choose container type</option>{containerTypes.map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>}</label>
  {select('ConfigurationRequest','Loading request',options(['Pallet load','Floor load','Both']),requirements.ConfigurationRequest||'','Container and loading selections remain frozen in an existing PCR.',true)}
  {['Floor load','Both'].includes(requirements.ConfigurationRequest)&&cost({key:'FloorLoadUSDPerMT',label:'Floor load cost ($/MT)',kind:'usd'})}
  {select('Incoterm','Incoterm',options(['CFA','DDP','EXW','FOB']),values.Incoterm||'')}
  {select('PortOfEntryID','Port of Entry',available.map(p=>({id:String(p.ID),label:String(p.PortName)})),values.PortOfEntryID||'','Filtered by this Customer and its Market. Admin maintains Ports of Entry in Shared masters.')}
 </div></section>}
 {costSections.filter(section=>(scope!=='child-others'||section.title==='Others')&&(section.title!=='Co-Man'||values.Incoterm==='DDP')).map(section=><section key={section.title} aria-label={section.title}><h4>{section.title}</h4><div className="shipment-entry-grid">{section.fields.filter(field=>field.key!=='MarginUSDPerLb'&&(scope==='all'||(scope==='child-others'?childOtherKeys.has(field.key):!childOtherKeys.has(field.key)))).map(field=>field.key==='MarginPct'?<Fragment key={field.key}>{margin()}</Fragment>:cost(field))}</div></section>)}

 </div>;
}
