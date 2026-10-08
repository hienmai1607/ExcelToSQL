import type {Draft} from './opportunity-losses';
import {FieldLabel} from './ui';
import {costDisplay} from './packaging-summary-model';
import {analysisRows,buildTCBAnalysis} from './tcb-analysis-model';
export function TCBAnalysis({drafts,tested}:{drafts:Draft[];tested:Record<number,string>}){
 const scenarios=buildTCBAnalysis(drafts,tested);
 return <section aria-label="TCB Analysis" className="tcb-analysis"><h3><FieldLabel help="Current TCB inputs, including unsaved edits. Standalone and child products are shown; Mix parents are excluded. Shared parent costs are equal per smallest child unit. Loading-dependent costs for Both are deferred. Blank optional shipment costs are treated as zero; missing required inputs are marked Incomplete.">Analysis</FieldLabel></h3>
 {scenarios.map((scenario,index)=><section key={index} aria-label={scenario.label}><h4>{scenario.label}</h4><div className="table-scroll" role="region" aria-label={scenario.label+' analysis table'} tabIndex={0}><table className="tcb-analysis-table" aria-label={scenario.label+' analysis'}>
 <thead><tr><th scope="col">Cost component</th>{scenario.columns.map(c=><th scope="col" key={c.id}>{c.label}<small>Per smallest product unit</small></th>)}</tr></thead>
 <tbody>{analysisRows.map((row,i)=><tr key={row.label} className={[10,11,25,26,27].includes(i)?'analysis-total':i===12?'analysis-section-start':undefined}><th scope="row" aria-label={row.label}><FieldLabel help={row.help}>{row.label}</FieldLabel></th>{scenario.columns.map(c=>{
 const cell=c.cells[i];return <td key={c.id} title={cell.issues.join(' ')}>{cell.value?costDisplay({amounts:{[i===11||i===27?scenario.currency:'USD']:cell.value},complete:true,issues:[]}):<span className="analysis-incomplete"><span>Incomplete</span><small>{cell.issues.join(' ')}</small></span>}</td>;
 })}</tr>)}</tbody></table></div></section>)}
 </section>;
}
