import {useState} from 'react';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';

import {warehouseFields,warehouseValues,warehouseTotal} from './warehouse-cost-model';
import './warehouse-cost.css';
export function WarehouseCost({value,currency,readOnly=false,onApply,onClose}:{value:string;currency:string;readOnly?:boolean;onApply:(breakdown:string,total:string)=>void;onClose:()=>void}){
 const [values,setValues]=useState(()=>warehouseValues(value));const total=warehouseTotal(values);
 return <Modal label="Warehouse cost calculator" className="dialog warehouse-cost-dialog" onClose={onClose}>
 <header className="customer-editor-heading"><h2>WH Cost ({currency||'customer currency'}/pallet)</h2><IconButton icon="close" label="Close warehouse calculator" onClick={onClose}/></header>
 <div className="warehouse-cost-content"><p className="warehouse-cost-formula">Unloading + Palletize + Inbound + Outbound + Storage cost per month × Storage month + Order fee/Admin cost + Others cost.</p>
 <div className="warehouse-cost-grid">{warehouseFields.map(([key,label])=><label key={key}>{label}<input aria-label={label} inputMode="decimal" readOnly={readOnly} value={values[key]} onChange={event=>setValues({...values,[key]:event.target.value})}/></label>)}</div>
 <ErrorNote value={total===null?'Use nonnegative values with up to two decimals. Total must fit 17 whole digits and two decimals.':''}/></div>
 <footer className="warehouse-cost-footer"><strong role="status">WH Cost: {total??'—'} {currency||'customer currency'}/pallet</strong><div className="actions"><button type="button" onClick={onClose}>Cancel</button>{!readOnly&&<button type="button" className="primary" disabled={total===null} onClick={()=>{onApply(JSON.stringify(Object.fromEntries(warehouseFields.map(([key])=>[key,values[key]||'0']))),total!);onClose()}}>Apply warehouse cost</button>}</div></footer></Modal>;
}
