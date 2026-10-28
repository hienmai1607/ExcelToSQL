import {type ReactNode} from 'react';
import {packagingOrders} from './packaging-orders';
import {decimalDisplay} from './number-format';
import {FieldLabel} from './ui';
import {IconButton} from './icons';
import {gradeError} from './product-grades';
import {costs,money,packagingUSD,palletizationValue} from './tcb-model';
import {ItemGradeEditor,ItemProcessInfo,type CommercialProps} from './opportunity-commercial-tabs';
import type {Draft} from './opportunity-losses';
import './tcb-calculator.css';
import './tcb-review-layout.css';

import {lossFieldIssues,processOptions} from './loss-processes';
export function OpportunityTCBTab({drafts,renderProductLoss,renderVersions,...props}:Omit<CommercialProps,'d'>&{drafts:Draft[];renderProductLoss:(d:Draft)=>ReactNode;renderVersions?:(d:Draft)=>ReactNode}){
 const {busy,review,update}=props;
 return <div aria-label="TCB Review items">{drafts.map(d=>{
  const id=Number(d.row.ItemID),disabled=d.readonly||busy||review,i=d.costingInputs,lossIssues=disabled?[]:lossFieldIssues(d.steps,processOptions(d.mix,d.layers,Number(d.row.PackagingLayerStart)||1));
  const calc=costs({...i,Prices:d.selections},d.quoteGrades,d.quotes);
  const gradesReady=d.pricingGradeKey===JSON.stringify(d.grades);
  return <details open id={'tcb-item-'+id} key={id} className={'tcb-item'+(d.row.ParentItemID?' loss-child':'')}><summary className="tcb-item-title">{String(d.row.ItemNumber??id)+' · '+d.row.ProductCode+' · '+d.row.ProductName}{d.readonly?' · Read only':''}</summary>
   {renderVersions?.(d)}
   {!d.mix&&<section aria-label="Product"><header className="tcb-product-heading"><h3>Product</h3>{!gradesReady&&<IconButton icon="refresh" label="Load pricing for current grades" disabled={busy||review||!!gradeError(d.grades)} onClick={()=>props.loadPrices(d)}/>}</header>
    <section className="tcb-grade-editor" aria-label="Grades & pricing" data-tcb-field="Grades"><ItemGradeEditor {...props} d={d}/></section>
    {renderProductLoss(d)}
    <ItemProcessInfo {...props} d={d}/>
    <div className="tcb-grid tcb-product-totals">
     <label><FieldLabel help="Raw material prices weighted by grade ratios, before Process Loss.">Total RM w/o Loss ($/lbs)</FieldLabel><output aria-label={'Total RM w/o Loss item '+id}>{money(gradesReady?calc.rmWithoutLoss:null)}</output></label>
     <label><FieldLabel help="Sum of each Level 1 grade Line RM × its Level 1 ratio, after grade Process Loss.">Total RM with Loss ($/lbs)</FieldLabel><output aria-label={'Total RM with Loss item '+id}>{money(gradesReady?calc.rm:null)}</output></label>
     <label><FieldLabel help="Sum of each Level 1 grade Line product × its Level 1 ratio, after Process Loss. Process recipes blend RM, seasoning and oil, plus Processing.">Total Product with Loss ($/lbs)</FieldLabel><output aria-label={'Total Product with Loss item '+id}>{money(gradesReady?calc.product:null)}</output></label>
    </div>
   </section>}

   <section aria-label="Packaging"><h3>Packaging</h3>{d.mix&&<h4>Mix packaging</h4>}
    <div className="tcb-packaging-scroll" role="region" aria-label={'Packaging layers item '+id} tabIndex={0}>
     <table className="tcb-packaging-table" aria-label={'Packaging layers item '+id}>
      <thead><tr><th scope="col">Packaging layer</th>{packagingOrders.slice(0,d.layers).map(layer=><th scope="col" key={layer}>{(d.mix?'Mix ':'')+layer+' PM ($/EA)'}</th>)}</tr></thead>
      <tbody><tr><th scope="row">PM price ($/EA) / Loss ratio (%)</th>{packagingOrders.slice(0,d.layers).map((layer,index)=>{
       const stepIndex=d.steps.findIndex(s=>s.ProcessType===(d.mix?'Mix':'')+layer+'Packaging'),error=lossIssues.find(issue=>issue.index===stepIndex)?.message,errorId='tcb-loss-error-'+id+'-'+stepIndex;
       return <td key={layer}>
       <div className="tcb-packaging-price-loss"><output>{money(packagingUSD(d.row,index,d.row))}</output>
        <span className="tcb-packaging-ratio" data-tcb-field={'Loss:'+stepIndex}><input aria-invalid={!!error} aria-describedby={error?errorId:undefined} aria-label={'Packaging loss ratio item '+id+' layer '+(index+1)} type="number" min="0" max="100" step="0.01" value={d.steps.find(s=>s.ProcessType===(d.mix?'Mix':'')+layer+'Packaging')?.LossPct??'0'} disabled={disabled} onChange={e=>update(id,x=>({...x,steps:x.steps.map(s=>s.ProcessType===(d.mix?'Mix':'')+layer+'Packaging'?{...s,LossPct:e.target.value}:s)}))}/>{error&&<small id={errorId} className="tcb-field-error">{error}</small>}</span>
       </div>
      </td>})}</tr>
      </tbody>
     </table>
    </div>
    {!d.row.ParentItemID&&<div className="tcb-grid tcb-packaging-pallet"><label><FieldLabel help="Copied from Packaging response: pallet plus accessories, in USD per pallet (EA).">Palletization ($/EA)</FieldLabel><input aria-label="Palletization ($/EA)" readOnly value={decimalDisplay(palletizationValue(d.row,i),6)??''}/></label></div>}
   </section>
  </details>;
 })}</div>;
}
