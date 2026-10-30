import type {Draft} from './opportunity-losses';
import type {CommercialProps} from './opportunity-commercial-tabs';
import {IconButton} from './icons';
import {LossFormulaVariables} from './loss-formula-variables';
import {processLossRows,processLossTableRows,processLossDisplay,gradePathDraft,remapAlignedLossFormulas,defaultProcessCode,packingType,type GradeLoss} from './grade-process-loss';
import {gradePath} from './grade-process';
import {tcbInputIssues} from './tcb-validation';

export function ProcessLossEditor({d,busy,review,update,onTest}:Pick<CommercialProps,'d'|'busy'|'review'|'update'>&{onTest:(d:Draft)=>void}){
 const id=Number(d.row.ItemID),disabled=d.readonly||busy||review,sources=processLossRows(d),rows=processLossTableRows(d);
 const issues=disabled?[]:tcbInputIssues(d);

 const label=(path:string)=>path==='0'?'Packing · All grades':path+' · '+(d.grades.find(g=>gradePath(g)===path)?.Grade??'');
 const choices=(path:string)=>(d.masters??[]).filter(m=>(path==='0')===packingType(m.ProcessName||m.ProcessType));
 const sharedPaths=sources.filter(source=>source.Path==='0'||rows.some(row=>row.Path!==source.Path&&row.Sources.some(s=>s?.Path===source.Path))).map(source=>source.Path);
 const tone=(path:string)=>path==='0'?'packing':sharedPaths.includes(path)?String(sharedPaths.filter(p=>p!=='0').indexOf(path)%5):undefined;

 const count=Math.max(0,...rows.map(r=>r.Ratios.length));
 function activate(x:Draft):Draft{
  const next=gradePathDraft(x);
  return {...next,costingInputs:{...next.costingInputs,ProcessLossWeight:x.row.WeightGrams}};
 }
 function change(path:string,fn:(row:GradeLoss)=>GradeLoss){update(id,x=>{
  const next=activate(x),active=processLossRows(next).map(row=>row.Path===path?fn(row):row);
  const before={...next.costingInputs},paths=new Set(active.map(r=>r.Path));
  next.costingInputs.ProcessLosses=[...(x.costingInputs.ProcessLosses??[]).filter(r=>!paths.has(r.Path)),...active];
  const normalized=processLossRows(next);
  next.costingInputs.ProcessLosses=[...next.costingInputs.ProcessLosses.filter(r=>!paths.has(r.Path)),...normalized];
  next.costingInputs.ProcessLossFormulas=remapAlignedLossFormulas(before,{...next.costingInputs,ProcessLosses:normalized},rows.map(r=>r.Path)).ProcessLossFormulas;
  return next;
 })}
 function addButton(path:string){
  const unused=choices(path).filter(m=>!sources.find(r=>r.Path===path)?.Codes?.some(c=>c.MasterID===m.MasterID));
  return <IconButton icon="plus" label={'Add process type '+path+' item '+id} disabled={disabled||!unused.length||(sources.find(r=>r.Path===path)?.Codes?.length??0)>=100} onClick={()=>{const value=defaultProcessCode(d,path,unused[0]);change(path,r=>({...r,Codes:[...(r.Codes??[]),value.code],Ratios:[...r.Ratios,value.ratio]}))}}/>;
 }
 const effective={...gradePathDraft(d).costingInputs,ProcessLossWeight:d.row.WeightGrams};
 return <section className="tcb-process-loss" data-tcb-field="Losses" aria-label={'Process Loss item '+id}>
  <h3 className="product-loss-heading">Process Loss <LossFormulaVariables weight={d.row.WeightGrams} losses={count}/></h3>
  <small>Each grade formula includes its own processes, shared parent processes and Packing. Loss adjusts RM and Processing before the Line product.</small>
  {d.grades.length>0&&<>
   <div className="process-loss-toolbar">
    {sources.filter(source=>!rows.some(r=>r.Path===source.Path)).map(source=><span className="process-loss-source" data-loss-group={source.Path} data-loss-tone={tone(source.Path)} key={source.Path}>{label(source.Path)}{addButton(source.Path)}</span>)}

   </div>
   {(d.costingInputs.ProcessLossMode!=='GradePath'||d.costingInputs.ProcessLossLayout!=='Aligned')&&<small>Saved formula references are aligned below. Editing or testing preserves their meaning with the new L-numbers.</small>}
   <div className="process-loss-table-scroll"><table className="process-loss-table">
    <thead><tr><th>Process Code</th>{Array.from({length:count},(_,i)=><th key={i}>{'L'+(i+1)+' (%)'}</th>)}<th>Loss formula</th><th><span className="process-loss-test"><IconButton icon="calculator" label={'Test all Process Loss item '+id} disabled={disabled} onClick={()=>onTest(activate(d))}/>Loss (%)</span></th></tr></thead>
    <tbody>{rows.map((row,rowIndex)=>{
     const issue=issues.find(i=>i.field==='ProcessLoss:'+row.Path||row.Sources.some(s=>s&&i.field==='ProcessLoss:'+s.Path));
     return <tr key={row.Path} data-process-grade={row.Path} data-tcb-field={'ProcessLoss:'+row.Path}>
      <th scope="row"><div className="process-loss-grade"><span>{label(row.Path)}</span>{sources.some(source=>source.Path===row.Path)&&addButton(row.Path)}</div></th>
      {Array.from({length:count},(_,index)=>{
       const source=row.Sources[index],code=row.Codes?.[index];if(!source||!code)return <td key={index} data-empty="true"/>;
       const saved=sources.find(r=>r.Path===source.Path)!;
       const repeated=rows.slice(0,rowIndex).some(r=>r.Sources.some(s=>s?.Path===source.Path&&s.Index===source.Index));
       const sharedOwner=code.Shared?sources.find(r=>r.Codes?.some(c=>c.Shared&&(c.MasterID??c.ProcessName)===(code.MasterID??code.ProcessName)))?.Path:source.Path;
       const copied=repeated||sharedOwner!==source.Path,options=choices(source.Path),sourceIssue=issues.find(i=>i.field==='ProcessLoss:'+source.Path);
       return <td key={index} className="process-loss-cell" data-process-column={'L'+(index+1)} title={label(source.Path)} data-tcb-field={'ProcessLoss:'+source.Path}>

        <div className="process-loss-type" data-loss-group={tone(source.Path)!=null?source.Path:undefined} data-loss-tone={tone(source.Path)}>
         <select aria-label={'Process type '+row.Path+' L'+(index+1)+' item '+id} disabled={disabled||repeated} value={String(code.MasterID??'legacy')} onChange={e=>{
          const master=options.find(m=>String(m.MasterID)===e.target.value);if(!master)return;
          const value=defaultProcessCode(d,source.Path,master);change(source.Path,r=>({...r,Codes:r.Codes!.map((c,i)=>i===source.Index?value.code:c),Ratios:r.Ratios.map((v,i)=>i===source.Index?value.ratio:v)}));
         }}>{!options.some(m=>m.MasterID===code.MasterID)&&<option value={String(code.MasterID??'legacy')}>{code.ProcessName} (saved)</option>}{options.map(m=><option key={m.MasterID} value={String(m.MasterID)} disabled={saved.Codes?.some((c,i)=>i!==source.Index&&c.MasterID===m.MasterID)}>{m.ProcessName||m.ProcessType}</option>)}</select>
         <input aria-label={'Process loss '+row.Path+' L'+(index+1)+' item '+id} aria-invalid={!!sourceIssue} inputMode="decimal" disabled={disabled||copied} title={copied?'Shared value; edit its first occurrence':undefined} value={row.Ratios[index]??'0'} onChange={e=>change(source.Path,r=>({...r,Ratios:r.Ratios.map((v,i)=>i===source.Index?e.target.value:v)}))}/>
         {!repeated&&<IconButton icon="close" label={'Remove process type '+row.Path+' L'+(index+1)+' item '+id} disabled={disabled} onClick={()=>change(source.Path,r=>({...r,Codes:r.Codes!.filter((_,i)=>i!==source.Index),Ratios:r.Ratios.filter((_,i)=>i!==source.Index)}))}/>}
        </div>
       </td>;
      })}
      <td className="process-loss-formula"><input aria-label={'Process loss formula '+row.Path+' item '+id} aria-invalid={!!issue} maxLength={200} placeholder="Enter formula using L1, L2, …, NW" disabled={disabled} value={row.Formula??''} onChange={e=>{const value=e.target.value;update(id,x=>{const next=activate(x);return {...next,costingInputs:{...next.costingInputs,ProcessLossFormulas:{...next.costingInputs.ProcessLossFormulas,[row.Path]:value}}}})}}/>{issue&&<small className="tcb-field-error">{issue.message}</small>}</td>
      <td><output aria-label={'Process Loss result '+row.Path+' item '+id}>{processLossDisplay(effective,row.Path)}</output></td>
     </tr>;
    })}</tbody>
   </table></div>
  </>}
  {!d.grades.length&&<p>Maintain grades before adding processing stages.</p>}
 </section>;
}
