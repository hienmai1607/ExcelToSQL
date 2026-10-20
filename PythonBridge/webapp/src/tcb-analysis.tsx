import type {Draft} from './opportunity-losses';
import {FieldLabel} from './ui';
import {IconButton} from './icons';
import {costDisplay} from './packaging-summary-model';
import {analysisRows,buildTCBAnalysis,type AnalysisCell} from './tcb-analysis-model';
export type TCBCostColumn={key:string;label:string;currency:string;cells:AnalysisCell[];active?:boolean;onRemove?:()=>void};
export const analysisLabel=(label:string)=>label.replace(' ($/unit)','').replace(' (customer currency/unit)',' (customer currency)');
function value(cell:AnalysisCell,currency:string){
 return cell.value?costDisplay({amounts:{[currency]:cell.value},complete:true,issues:[]}):<span className="analysis-incomplete"><span>Incomplete</span><small>{cell.issues.join(' ')}</small></span>;
}
export function TCBCostTable({name,columns}:{name:string;columns:TCBCostColumn[]}){
 return <div className="table-scroll" role="region" aria-label={name+' table'} tabIndex={0}><table className="tcb-analysis-table" aria-label={name}>
 <thead><tr><th scope="col">Cost component</th>{columns.map(c=><th scope="col" className={c.active?'tcb-active-version':undefined} key={c.key}>
  <div className="tcb-comparison-column"><span>{c.label}{c.active&&<span className="tcb-active-badge">Active</span>}</span>{c.onRemove&&<IconButton icon="close" label={'Remove comparison column '+c.label} onClick={c.onRemove}/>}</div><small>Per smallest product unit</small>
 </th>)}</tr></thead>
 <tbody>{analysisRows.map((row,i)=>i===11?null:<tr key={row.label} className={[10,25,26,27].includes(i)?'analysis-total':i===12?'analysis-section-start':undefined}>
  <th scope="row" aria-label={analysisLabel(row.label)}><FieldLabel help={row.help}>{analysisLabel(row.label)}</FieldLabel></th>{columns.map(c=><td className={c.active?'tcb-active-version':undefined} key={c.key} title={c.cells[i].issues.join(' ')}>
   {value(c.cells[i],i===27?c.currency:'USD')}{i===10&&c.currency!=='USD'&&<> / {value(c.cells[11],c.currency)}</>}
  </td>)}</tr>)}</tbody></table></div>;
}
export function TCBAnalysis({drafts,tested}:{drafts:Draft[];tested:Record<number,string>}){
 const scenarios=buildTCBAnalysis(drafts,tested);
 return <section aria-label="TCB Analysis" className="tcb-analysis"><h3><FieldLabel help="Current TCB inputs, including unsaved edits. Container Type and loading request follow Sales Shipment, not the response planner selection. Matching Packaging Response capacities are references only. All amounts are per smallest product unit. Blank optional costs are zero; missing required inputs are marked Incomplete.">Analysis</FieldLabel></h3>
 <TCBCostTable name="Opportunity item analysis" columns={scenarios.flatMap((scenario,si)=>scenario.columns.map(c=>({key:si+':'+c.id,label:c.label+' · '+scenario.label,cells:c.cells,currency:scenario.currency})))}/>
 </section>;
}
