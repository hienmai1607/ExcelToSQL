import type {Draft} from './opportunity-losses';
import type {CommercialProps} from './opportunity-commercial-tabs';
import {lossCodeIdentity,type LossStep} from './loss-processes';
import {IconButton} from './icons';
import {LossFormulaVariables} from './loss-formula-variables';
import {processLossRows,processLossDisplay,type GradeLoss} from './grade-process-loss';
import {savedProcessTree,gradePath} from './grade-process';
import {tcbInputIssues} from './tcb-validation';

export function ProcessLossEditor({d,busy,review,update,onTest}:Pick<CommercialProps,'d'|'busy'|'review'|'update'>&{onTest:(d:Draft)=>void}){
 const id=Number(d.row.ItemID),disabled=d.readonly||busy||review;
 const codes=d.steps.filter(s=>s.ProcessType==='Processing'||s.ProcessType==='Sorting');
 const rows=processLossRows(d),nodes=savedProcessTree(d.grades),issues=disabled?[]:tcbInputIssues(d);
 const key=(s:LossStep)=>s.MasterID?s.MasterID+':'+s.MasterVersion:'';
 const unused=d.masters.filter(master=>!codes.some(code=>lossCodeIdentity(code)===lossCodeIdentity(master)));
 function activate(x:Draft,values:GradeLoss[],steps=x.steps):Draft{
  const paths=new Set(values.map(r=>r.Path));
  const retained=(x.costingInputs.ProcessLosses??[]).filter(r=>!paths.has(r.Path));
  return {...x,formula:'',steps:steps.map(s=>s.ProcessType==='Processing'||s.ProcessType==='Sorting'?{...s,LossPct:'0'}:s),costingInputs:{...x.costingInputs,ProcessLosses:[...retained,...values],ProcessLossWeight:x.row.WeightGrams}};
 }
 function change(path:string,fn:(row:GradeLoss)=>GradeLoss){update(id,x=>activate(x,processLossRows(x).map(r=>r.Path===path?fn(r):r)))}
 function changeCodes(next:LossStep[],remove?:number){update(id,x=>{
  const active=processLossRows(x),paths=new Set(active.map(r=>r.Path));
  const all=[...active,...(x.costingInputs.ProcessLosses??[]).filter(r=>!paths.has(r.Path))];
  return activate(x,all.map(r=>({...r,Ratios:remove===undefined?[...r.Ratios,'0']:r.Ratios.filter((_,i)=>i!==remove)})),[...next.map((s,i)=>({...s,ProcessType:'Processing' as const,Sequence:i+1})),...x.steps.filter(s=>s.ProcessType!=='Processing'&&s.ProcessType!=='Sorting')]);
 })}
 return <section className="tcb-process-loss" data-tcb-field="Losses" aria-label={'Process Loss item '+id}>
  <h3 className="product-loss-heading">Process Loss <LossFormulaVariables weight={d.row.WeightGrams} losses={codes.length}/></h3>
  <div className="process-loss-types"><span>Loss type</span>{codes.map((s,i)=><div key={i} className="process-loss-type"><strong>{'L'+(i+1)}</strong><select aria-label={'Loss type item '+id+' code L'+(i+1)} disabled={disabled} value={key(s)} onChange={e=>{const master=d.masters.find(m=>key(m)===e.target.value);if(master&&!codes.some((code,j)=>j!==i&&lossCodeIdentity(code)===lossCodeIdentity(master)))update(id,x=>activate(x,processLossRows(x),x.steps.map(p=>p===s?{...master,Sequence:s.Sequence,LossPct:'0'}:p)))}}>
   {!d.masters.some(m=>key(m)===key(s))&&<option value={key(s)}>{s.ProcessName||s.ProcessType} (saved)</option>}{d.masters.map(m=><option key={key(m)} value={key(m)} disabled={codes.some((code,j)=>j!==i&&lossCodeIdentity(code)===lossCodeIdentity(m))}>{m.ProcessName||m.ProcessType}</option>)}</select>
   <IconButton icon="close" label={'Remove loss code L'+(i+1)+' item '+id} disabled={disabled} onClick={()=>changeCodes(codes.filter((_,j)=>j!==i),i)}/></div>)}
   <IconButton icon="plus" label={'Add loss type item '+id} disabled={disabled||!unused.length||d.steps.length>=100} onClick={()=>{if(unused.length)changeCodes([...codes,{...unused[0],LossPct:'0'}])}}/>
  </div>
  {!rows.length?<p>Tick Process on a grade to maintain its loss.</p>:<div className="table-scroll"><table className="process-loss-table" style={{minWidth:Math.max(620,360+codes.length*100)}} aria-label={'Process Loss grades item '+id}><thead><tr><th>Process grade</th>{codes.map((_,i)=><th className="process-loss-code-column" key={i}>{'L'+(i+1)+' (%)'}</th>)}<th>Loss formula</th><th><span className="process-loss-result-heading"><IconButton icon="calculator" label={'Test all Process Loss item '+id} disabled={disabled} onClick={()=>onTest(activate(d,rows))}/>Loss (%)</span></th></tr></thead><tbody>{rows.map(row=>{
   const node=nodes.find(g=>gradePath(g)===row.Path)!;
   const issue=issues.find(i=>i.field==='ProcessLoss:'+row.Path),errorID='process-loss-error-'+id+'-'+row.Path;
   const inputs={...d.costingInputs,ProcessLosses:rows,ProcessLossWeight:d.row.WeightGrams};
   return <tr key={row.Path} data-tcb-field={'ProcessLoss:'+row.Path}><th scope="row">{row.Path+' · '+node.Grade}{issue&&<small id={errorID} className="tcb-field-error">{issue.message}</small>}</th>{codes.map((_,i)=><td key={i}><input aria-label={'Process loss '+row.Path+' L'+(i+1)+' item '+id} aria-invalid={!!issue} aria-describedby={issue?errorID:undefined} type="number" min="0" max="100" step="0.01" disabled={disabled} value={row.Ratios[i]??'0'} onChange={e=>change(row.Path,r=>({...r,Ratios:r.Ratios.map((v,j)=>j===i?e.target.value:v)}))}/></td>)}
    <td><input aria-label={'Process loss formula '+row.Path+' item '+id} maxLength={200} placeholder="Sequential yields" disabled={disabled} value={row.Formula??''} onChange={e=>change(row.Path,r=>({...r,Formula:e.target.value}))}/></td>

    <td><output aria-label={'Process Loss result '+row.Path+' item '+id}>{processLossDisplay(inputs,row.Path)}</output></td>
   </tr>;
  })}</tbody></table></div>}
  {!Array.isArray(d.costingInputs.ProcessLosses)&&(d.formula||codes.some(s=>Number(s.LossPct)>0))&&<small>Saved overall loss is retained until Process Loss is edited. New grade losses apply to RM only.</small>}
 </section>;
}
