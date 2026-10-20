import {useState} from 'react';
import {IconButton} from './icons';
import {Modal} from './ui';
import {decimalDisplay} from './number-format';

export function LossFormulaVariables({weight,losses}:{weight:unknown;losses:number}){
 const [open,setOpen]=useState(false);
 return <><IconButton icon="list" label="Product Loss variables" onClick={()=>setOpen(true)}/>
 {open&&<Modal label="Product Loss variables" onClose={()=>setOpen(false)}>
 <div className="customer-editor-heading"><h2>Product Loss variables</h2><IconButton icon="close" label="Close variables" onClick={()=>setOpen(false)}/></div>
 <table><thead><tr><th>Variable</th><th>Meaning</th><th>Current value</th></tr></thead><tbody>
 <tr><td>NW</td><td>Net weight (g), from this Opportunity's Product snapshot</td><td>{decimalDisplay(weight,4)??'Unavailable'}</td></tr>
 {Array.from({length:losses},(_,i)=><tr key={i}><td>{'L'+(i+1)}</td><td>Loss row {i+1}, as a decimal ratio</td><td>Ratio (%) ÷ 100</td></tr>)}
 </tbody></table><p>Use + − * / and parentheses. Formula results are multiplied by 100 for percentage display. NW is read-only and resolved by the server. Example: 1/NW.</p>
 <div className="actions"><button onClick={()=>setOpen(false)}>Close</button></div>
 </Modal>}</>;
}
