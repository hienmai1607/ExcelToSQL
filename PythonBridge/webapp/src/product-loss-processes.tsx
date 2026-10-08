import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote,InfoTip} from './ui';
import {IconButton} from './icons';
import './product-loss-processes.css';
import {lossTotals,lossDisplay,lossError,type LossStep} from './loss-processes';
export function ProductLossProcesses({product,canWrite,onClose,onSaved}:{product:Row;canWrite:boolean;onClose:()=>void;onSaved:()=>void}){
 const [data,setData]=useState<{product:Row;processes:LossStep[];masters:LossStep[]}|null>(null),[steps,setSteps]=useState<LossStep[]>([]),[baseline,setBaseline]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const path='/api/workbench/products/'+product.ID+'/loss-processes';
 useEffect(()=>{let active=true;call<NonNullable<typeof data>>(path).then(next=>{if(active){setData(next);setSteps(next.processes);setBaseline(JSON.stringify(next.processes))}}).catch(e=>setError(e.message));return()=>{active=false}},[path]);
 const dirty=JSON.stringify(steps)!==baseline,validation=lossError(steps,[['Processing','Product']]);
 const key=(step:LossStep)=>step.MasterID+':'+step.MasterVersion;
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(canWrite&&dirty||busy){event.preventDefault();event.returnValue=''}};const nav=(event:Event)=>{if(busy||canWrite&&dirty&&!window.confirm('Discard unsaved Product loss processes?'))event.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[canWrite,dirty,busy]);
 function close(){if(!busy&&(!canWrite||!dirty||window.confirm('Discard unsaved Product loss processes?')))onClose()}
 async function save(){if(!data||busy||validation||!canWrite)return;setBusy(true);setError('');try{await call(path,{RowVersion:data.product.RowVersion,processes:steps.map(step=>({...step,Sequence:Number(step.Sequence)}))});onSaved();onClose()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <Modal label="Product loss processes" className="dialog product-loss-dialog" onClose={close}><header className="customer-editor-heading"><div><h2>Product loss processes</h2><p>{String(product.ProductCode)} — {String(product.ProductName)}</p></div><IconButton icon="close" label="Close Product loss processes" disabled={busy} onClick={close}/></header><ErrorNote value={error||validation}/>
 {data&&<section className="product-loss-section"><h3>Product loss<InfoTip text="Assign process types, sequence and default Loss %. New Opportunity items capture these assignments and can override Loss %. Packaging loss is maintained separately per Opportunity layer."/></h3>
 {data.product.IsMix?<p>Product loss belongs to each child product, not the Mix parent.</p>:<><table className="product-loss-table"><colgroup><col/><col/><col/><col/></colgroup><thead><tr><th>Process Type</th><th>Process sequence</th><th>Loss %</th><th/></tr></thead><tbody>{steps.map((step,index)=><tr key={index}><td data-label="Process Type"><select aria-label={'Product process '+(index+1)} disabled={!canWrite||busy} value={key(step)} onChange={e=>{const master=data.masters.find(m=>key(m)===e.target.value);if(master)setSteps(list=>list.map((s,i)=>i===index?{...master,Sequence:s.Sequence,LossPct:s.LossPct}:s))}}>
 {!data.masters.some(m=>key(m)===key(step))&&<option value={key(step)}>{step.ProcessName||step.ProcessType} (saved snapshot)</option>}{data.masters.map(m=><option key={key(m)} value={key(m)}>{m.ProcessName}</option>)}</select></td>
 <td data-label="Process sequence"><input aria-label={'Product process sequence '+(index+1)} type="number" min="1" max="1000" value={step.Sequence} disabled={!canWrite||busy} onChange={e=>setSteps(list=>list.map((s,i)=>i===index?{...s,Sequence:e.target.value}:s))}/></td>
 <td data-label="Loss %"><input aria-label={'Product process loss '+(index+1)} type="number" min="0" max="100" step="0.01" value={step.LossPct} disabled={!canWrite||busy} onChange={e=>setSteps(list=>list.map((s,i)=>i===index?{...s,LossPct:e.target.value}:s))}/></td><td className="product-loss-remove">{canWrite&&<IconButton icon="close" label={'Remove Product process '+(index+1)} disabled={busy} onClick={()=>setSteps(list=>list.filter((_,i)=>i!==index))}/>}</td></tr>)}</tbody></table>
 <div className="product-loss-summary">{canWrite&&<button disabled={busy||!data.masters.length||steps.length>=100} onClick={()=>setSteps(list=>[...list,{...data.masters[0],Sequence:Math.max(0,...list.map(s=>Number(s.Sequence)))+1}])}>Assign Product process</button>}
 <label>Combined Product loss<output>{lossDisplay(lossTotals(steps).LossProductPct)}</output></label></div></>}
 </section>}
 {data&&canWrite&&!data.product.IsMix&&<div className="product-loss-actions"><button className="primary" disabled={busy||!!validation||!dirty} onClick={save}>Save Product loss processes</button></div>}</Modal>
}
