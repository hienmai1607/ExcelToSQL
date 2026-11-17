import {useState} from 'react';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import './warehouse-cost.css';
import {dutyLines,dutyTotal,type DutyLine} from './duty-model';
export {dutyLines,dutyTotal,dutyDisplay,type DutyLine} from './duty-model';

export function DutyCalculator({value,current,readOnly=false,onApply,onClose}:{value:string;current:string;readOnly?:boolean;onApply:(breakdown:string,total:string)=>void;onClose:()=>void}){
 const [lines,setLines]=useState<DutyLine[]>(()=>dutyLines(value,current));
 const total=dutyTotal(lines),patch=(index:number,change:Partial<DutyLine>)=>setLines(rows=>rows.map((row,i)=>i===index?{...row,...change}:row));
 return <Modal label="Duty calculator" className="dialog warehouse-cost-dialog duty-calculator-dialog" onClose={onClose}>
 <header className="customer-editor-heading"><h2>Duty %</h2><IconButton icon="close" label="Close duty calculator" onClick={onClose}/></header>
 <div className="warehouse-cost-content"><p className="warehouse-cost-formula">Duty % is the sum of all tax lines.</p>
 <table className="duty-lines" aria-label="Duty tax lines"><thead><tr><th>Tax type</th><th>Percentage (%)</th><th>{!readOnly&&lines.length<50&&<IconButton icon="plus" label="Add tax line" onClick={()=>setLines(rows=>[...rows,{TaxType:'',Pct:''}])}/>}</th></tr></thead>
 <tbody>{lines.map((line,index)=><tr key={index}><td><input aria-label={'Tax type line '+(index+1)} maxLength={100} readOnly={readOnly} value={line.TaxType} onChange={e=>patch(index,{TaxType:e.target.value})}/></td><td><input aria-label={'Percentage line '+(index+1)} inputMode="decimal" readOnly={readOnly} value={line.Pct} onChange={e=>patch(index,{Pct:e.target.value})}/></td><td>{!readOnly&&<IconButton icon="close" label={'Remove tax line '+(index+1)} onClick={()=>setLines(rows=>rows.filter((_,i)=>i!==index))}/>}</td></tr>)}
 {!lines.length&&<tr><td colSpan={3} className="empty">No tax lines. Add one, or apply to clear Duty %.</td></tr>}</tbody></table>
 <ErrorNote value={total===null?'Each line needs a Tax type and a percentage from 0 to 100 with up to four decimals; the total must not exceed 100%.':''}/></div>
 <footer className="warehouse-cost-footer"><strong role="status">Duty: {lines.length?total??'—':'—'}%</strong>{!readOnly&&<div className="actions"><button type="button" className="primary" disabled={total===null} onClick={()=>{onApply(lines.length?JSON.stringify(lines.map(line=>({TaxType:line.TaxType.trim(),Pct:line.Pct}))):'',lines.length?total!:'');onClose()}}>Apply duty</button></div>}</footer></Modal>;
}
