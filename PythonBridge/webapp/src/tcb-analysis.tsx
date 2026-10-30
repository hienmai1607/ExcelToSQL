import type {Draft} from './opportunity-losses';
import {Fragment} from 'react';
import {finalBoxDisplay} from './tcb-final-box';
import {FieldLabel} from './ui';
import {IconButton} from './icons';
import {costDisplay} from './packaging-summary-model';
import {analysisRows,buildTCBAnalysis,type AnalysisCell,type FinalBoxTotals} from './tcb-analysis-model';
export type TCBCostColumn={key:string;label:string;currency:string;cells:AnalysisCell[];cfrCustomer?:AnalysisCell;finalBox?:FinalBoxTotals;active?:boolean;onRemove?:()=>void};
export const analysisLabel=(label:string)=>label.replace(' ($/unit)','').replace(' (customer currency/unit)',' (customer currency)');
function value(cell:AnalysisCell|undefined,currency:string,up=false){
 if(cell?.value){
  if(up)return finalBoxDisplay(cell.value,currency);
  return costDisplay({amounts:{[currency]:cell.value},complete:true,issues:[]});
 }
 return <span className="analysis-incomplete"><span>Incomplete</span><small>{cell?.issues.join(' ')||'Missing final-box calculation.'}</small></span>;
}
export function TCBCostTable({name,columns}:{name:string;columns:TCBCostColumn[]}){
 function finalBoxRow(term:'FOB'|'CFR'|'DDP'){
  const cells=[];
  for(let i=0;i<columns.length;){
   const column=columns[i];let span=1;
   while(column.finalBox&&i+span<columns.length&&columns[i+span].finalBox===column.finalBox&&columns[i+span].currency===column.currency&&columns[i+span].active===column.active)span++;
   cells.push(<td colSpan={span} key={column.key} className={column.active?'tcb-active-version':undefined}>{value(column.finalBox?.[term].usd,'USD',true)}{column.currency!=='USD'&&<> / {value(column.finalBox?.[term].customer,column.currency,true)}</>}</td>);i+=span;
  }
  return <tr className="analysis-total analysis-final-box"><th scope="row" aria-label={term+' (per final box)'}><FieldLabel help="Sum of unrounded product-unit prices multiplied by the captured quantities in the final carton. Each currency total is rounded upward to two decimals.">{term+' (per final box)'}</FieldLabel></th>{cells}</tr>;
 }
 return <div className="table-scroll tcb-cost-scroll" role="region" aria-label={name+' table'} tabIndex={0}><table className="tcb-analysis-table" aria-label={name}>
 <thead><tr><th scope="col">Cost component</th>{columns.map(c=><th scope="col" className={c.active?'tcb-active-version':undefined} key={c.key}>
  <div className="tcb-comparison-column"><span>{c.label}{c.active&&<span className="tcb-active-badge">Active</span>}</span>{c.onRemove&&<IconButton icon="close" label={'Remove comparison column '+c.label} onClick={c.onRemove}/>}</div><small>Per smallest product unit</small>
 </th>)}</tr></thead>
 <tbody>{analysisRows.map((row,i)=>i===11||i===27?null:<Fragment key={row.label}><tr className={[10,25,26].includes(i)?'analysis-total':i===12?'analysis-section-start':undefined}>
  <th scope="row" aria-label={analysisLabel(row.label)}><FieldLabel help={row.help}>{analysisLabel(row.label)}</FieldLabel></th>{columns.map(c=><td className={c.active?'tcb-active-version':undefined} key={c.key} title={c.cells[i].issues.join(' ')}>
   {value(c.cells[i],'USD')}{[10,25,26].includes(i)&&c.currency!=='USD'&&<> / {value(i===10?c.cells[11]:i===25?c.cfrCustomer:c.cells[27],c.currency)}</>}
  </td>)}</tr>{[10,25,26].includes(i)&&finalBoxRow(i===10?'FOB':i===25?'CFR':'DDP')}</Fragment>)}</tbody></table></div>;
}
export function TCBAnalysis({drafts,tested}:{drafts:Draft[];tested:Record<number,string>}){
 const scenarios=buildTCBAnalysis(drafts,tested);
 return <section aria-label="TCB Analysis" className="tcb-analysis"><h3><FieldLabel help="Current TCB inputs, including unsaved edits. Container Type and loading request follow Sales Shipment, not the response planner selection. Matching Packaging Response capacities are references only. Component amounts are per smallest product unit. Rows marked per final box total all units in the final carton. Blank optional costs are zero; missing required inputs are marked Incomplete.">Analysis</FieldLabel></h3>
 <TCBCostTable name="Opportunity item analysis" columns={scenarios.flatMap((scenario,si)=>scenario.columns.map(c=>({...c,key:si+':'+c.id,label:c.label+' · '+scenario.label,currency:scenario.currency})))}/>
 </section>;
}
