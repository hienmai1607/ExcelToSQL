import {Fragment,useState} from 'react';
import {AddMasterButton} from './add-master-button';
import type {Row} from './api';
import {WarehouseCost} from './warehouse-cost';
import {IconButton} from './icons';
import {FieldLabel} from './ui';
import {quantity,divide,quantityDisplay} from './packaging-summary-model';
import {containerTypes} from './container-loading';
import {childOtherKeys,type ShipmentScope} from './shipment-ownership';
import {requestedContainerType,costSections,fields,customerCosts,fixedCost,incoterms,type CostField} from './shipment-model';
export {requestedContainerType,costSections,shipmentValues,shipmentPayload,shipmentError,fixedCost,incoterms,scopedShipment,type ShipmentScope} from './shipment-model';

export function ShipmentSections({values,requirements,customer,currency='',exchangeRate='',ports=[],child=false,scope='all',requirementsLocked=false,onAddPort,onPortEdited,onChange,onRequirementChange}:{onAddPort?:()=>void;onPortEdited?:(record:Row)=>void|Promise<void>;values:Record<string,string>;requirements:Record<string,string>;customer?:Row;currency?:string;exchangeRate?:string;ports?:Row[];child?:boolean;scope?:ShipmentScope;requirementsLocked?:boolean;onChange:(key:string,value:string)=>void;onRequirementChange:(key:string,value:string)=>void}){
 const [warehouseOpen,setWarehouseOpen]=useState(false);
 const available=ports.filter(p=>String(p.CustomerID)===String(customer?.ID)&&String(p.MarketID)===String(customer?.MarketID));
 function select(key:string,label:string,options:{id:string;label:string}[],value:string,help?:string,requirement=false){
  const known=options.some(o=>o.id===value);
  return <label key={key} className={requirement&&requirementsLocked?'display-only-fields':undefined}><FieldLabel help={requirement&&requirementsLocked?(help||'')+' Locked while a Packaging Request is processing.':help}>{label}</FieldLabel><span className="inline-master-field">{child?<input aria-label={label} readOnly value={options.find(o=>o.id===value)?.label||value}/>:<select aria-label={label} disabled={requirement&&requirementsLocked} value={value} onChange={event=>(requirement?onRequirementChange:onChange)(key,event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{value&&!known&&<option value={value} disabled>Existing {key==='PortOfEntryID'?'port #':''}{value} (unavailable)</option>}{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>}{key==='PortOfEntryID'&&!child&&onAddPort&&<AddMasterButton entity="ports" selectedValue={value} onEdited={onPortEdited} label="Add new Port of Entry master" onClick={onAddPort}/>}</span></label>;
 }
 const options=(values:string[])=>values.map(value=>({id:value,label:value}));
 const costLabel=(field:CostField)=>['InitialDesignUSD','InitialDesignCustomer'].includes(field.key)?'Initial Design':customerCosts[field.key]?customerCosts[field.key].name+' ('+(currency||'customer currency')+(customerCosts[field.key].unit?'/'+customerCosts[field.key].unit:'')+')':field.key==='InitialDesignUSD'?'Initial Design (USD)':field.label;
 function costInput(field:CostField){
  const value=values[field.key]||'';
  return <input aria-label={costLabel(field)} inputMode={field.kind==='days'?'numeric':'decimal'} readOnly={child||field.key==='WHCostCustomerPerPallet'} value={child&&field.kind!=='days'?fixedCost(value):value} onChange={event=>{onChange(field.key,event.target.value);if(field.key==='WHCostCustomerPerPallet')onChange('WHCostBreakdown','');const legacy=customerCosts[field.key]?.legacy;if(legacy)onChange(legacy,'');if(field.key==='ImportClearanceCustomerPerContainer'){onChange('ImportClearanceUSDPerContainer','');onChange('ImportClearanceCustomerPerPallet','')}}} onBlur={()=>{if(!child&&field.key!=='WHCostCustomerPerPallet'&&field.kind!=='days')onChange(field.key,fixedCost(value))}}/>;
 }
 function cost(field:CostField){
  const design=field.key==='InitialDesignUSD';
  if(design&&values.InitialDesignMode==='Customer')field={...field,key:'InitialDesignCustomer'};
  const value=values[field.key]||'',amount=quantity(value,true),fx=currency==='USD'?quantity('1'):quantity(exchangeRate);
  const customerCost=customerCosts[field.key],suffix=customerCost?.unit?'/'+customerCost.unit:'';
  const legacy=customerCost?.legacy?values[customerCost.legacy]:'';
  const conversion=field.key==='WHCostCustomerPerPallet'&&currency==='USD'&&value?'':customerCost&&value?(amount&&fx?quantityDisplay(divide(amount,fx),2)+' USD'+suffix:'USD: enter exchange rate'):legacy?'Saved: '+fixedCost(legacy)+' USD'+suffix:'';
  return <div key={design?'InitialDesign':field.key} className="shipment-cost-field"><FieldLabel>{costLabel(field)}</FieldLabel><span className="shipment-cost-input">{costInput(field)}{field.key==='WHCostCustomerPerPallet'&&<IconButton icon="calculator" label="Calculate warehouse cost" onClick={()=>setWarehouseOpen(true)}/>} {design&&<select aria-label="Initial Design currency" disabled={child} value={values.InitialDesignMode==='Customer'&&currency!=='USD'?'Customer':'USD'} onChange={e=>{onChange('InitialDesignMode',e.target.value==='Customer'?'Customer':'')}}><option value="USD">USD</option>{currency&&currency!=='USD'&&<option value="Customer">{currency}</option>}</select>}{conversion&&<output aria-label={customerCost.name+' USD'+(customerCost.unit?' per '+customerCost.unit:'')}>{conversion}</output>}</span></div>;
 }
 function margin(){
  const dollar=values.MarginMode==='USDPerLb',field=fields.find(f=>f.key===(dollar?'MarginUSDPerLb':'MarginPct'))!;
  return <div className="margin-cost-field" role="group" aria-label="Margin"><FieldLabel>{field.label}</FieldLabel><span className="shipment-cost-input margin-cost-input"><select aria-label="Margin basis" disabled={child} value={dollar?'USDPerLb':'Percent'} onChange={e=>onChange('MarginMode',e.target.value)}><option value="Percent">Margin %</option><option value="USDPerLb">Margin (USD/lbs)</option></select>{costInput(field)}</span></div>;
 }
 return <div className={'requirement-sections shipment-sections'+(child?' display-only-fields':'')}>
 {warehouseOpen&&<WarehouseCost currency={currency} value={values.WHCostBreakdown||''} readOnly={child} onClose={()=>setWarehouseOpen(false)} onApply={(breakdown,total)=>{onChange('WHCostBreakdown',breakdown);onChange('WHCostCustomerPerPallet',total);onChange('WHCostUSDPerPallet','')}}/>}
 {scope!=='child-others'&&<section aria-label="Shipment"><h4>Shipment</h4><div className="shipment-entry-grid">
  <label className={requirementsLocked?'display-only-fields':undefined}><FieldLabel help="Required. The exact container type is captured in each new Packaging Request and locked while it is processing.">Container Type *</FieldLabel>{child?<input aria-label="Container Type" readOnly value={requestedContainerType(requirements,values)||requirements.ContainerRequest||''}/>:<select aria-label="Container Type" required aria-required="true" disabled={requirementsLocked} value={requestedContainerType(requirements,values)} onChange={event=>{const kind=event.target.value;onRequirementChange('ContainerRequest',kind);onChange('ContainerSizeFT',kind?kind.slice(0,2)+'FT':'')}}><option value="">Choose container type</option>{containerTypes.map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>}</label>
  {select('ConfigurationRequest','Loading request',options(['Pallet load','Floor load','Both']),requirements.ConfigurationRequest||'','Container and loading selections remain frozen in an existing PCR.',true)}
  {['Floor load','Both'].includes(requirements.ConfigurationRequest)&&cost({key:'FloorLoadUSDPerMT',label:'Floor load cost (USD/MT)',kind:'usd'})}
  {select('Incoterm','Incoterm',options(incoterms),values.Incoterm||'')}
  {select('PortOfEntryID','Port of Entry',available.map(p=>({id:String(p.ID),label:String(p.PortName)})),values.PortOfEntryID||'','Filtered by this Customer and its Market. Admin maintains Ports of Entry in Shared masters.')}
 </div></section>}
 {costSections.filter(section=>(scope!=='child-others'||section.title==='Others')).map(section=><section key={section.title} aria-label={section.title}><h4>{section.title}</h4><div className="shipment-entry-grid">{section.fields.filter(field=>field.key!=='MarginUSDPerLb'&&(scope==='all'||(scope==='child-others'?childOtherKeys.has(field.key):!childOtherKeys.has(field.key)))).map(field=>field.key==='MarginPct'?<Fragment key={field.key}>{margin()}</Fragment>:cost(field))}</div></section>)}

 </div>;
}
