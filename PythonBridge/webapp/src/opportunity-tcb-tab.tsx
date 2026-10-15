import {type ReactNode} from 'react';
import {decimalDisplay} from './number-format';
import {FieldLabel} from './ui';
import {costs,money,packagingUSD,palletizationValue} from './tcb-model';
import {ItemGradeEditor,ItemRawPricing,type CommercialProps} from './opportunity-commercial-tabs';
import type {Draft} from './opportunity-losses';
import './tcb-calculator.css';

import {tcbInputIssues} from './tcb-validation';
import {lossFieldIssues,processOptions} from './loss-processes';
export function OpportunityTCBTab({drafts,renderProductLoss,...props}:Omit<CommercialProps,'d'>&{drafts:Draft[];renderProductLoss:(d:Draft)=>ReactNode}){
 const {busy,review,update}=props;
 return <div aria-label="TCB Review items">{drafts.map(d=>{
  const id=Number(d.row.ItemID),disabled=d.readonly||busy||review,i=d.costingInputs,issues=disabled?[]:tcbInputIssues(d),lossIssues=disabled?[]:lossFieldIssues(d.steps,processOptions(d.mix,d.layers));
  const calc=costs({...i,Prices:d.selections},d.quoteGrades,d.quotes);
  const gradesReady=d.pricingGradeKey===JSON.stringify(d.grades);
  function input(key:string,label:string){const error=issues.find(x=>x.field===key)?.message;const errorId='tcb-error-'+id+'-'+key;return <label key={key} data-tcb-field={key}><FieldLabel>{label}</FieldLabel><input aria-label={label} aria-invalid={!!error} aria-describedby={error?errorId:undefined} type="number" min="0" max={key.endsWith('Ratio')||key==='OilPct'?100:undefined} step={key.endsWith('Ratio')||key==='OilPct'?'0.01':'0.000001'} value={String(i[key]??'')} disabled={disabled} onChange={e=>update(id,x=>({...x,costingInputs:{...x.costingInputs,[key]:e.target.value===''?null:e.target.value}}))}/>{error&&<small id={errorId} className="tcb-field-error">{error}</small>}</label>}
  return <details open id={'tcb-item-'+id} key={id} className={d.row.ParentItemID?'loss-child':''}><summary>{String(d.row.ItemNumber??id)+' · '+d.row.ProductCode+' · '+d.row.ProductName}{d.readonly?' · Read only':''}</summary>
   {!d.mix&&<section aria-label="Product"><h3>Product</h3>
    <details className="tcb-grade-editor" data-tcb-field="Grades"><summary>{d.gradeLocked?'View grades (captured by Packaging Request)':'Edit grades'}</summary><ItemGradeEditor {...props} d={d}/></details>
    <ItemRawPricing {...props} d={d}/>
    <div className="tcb-product-scroll" role="region" aria-label={'Product costs item '+id} tabIndex={0}>
     <table className="tcb-product-table" aria-label={'Product costs item '+id}>
      <thead><tr><th scope="col">Raw material</th><th scope="col">Seasoning/salt</th><th scope="col">Oil</th></tr></thead>
      <tbody><tr>
       <td><div className="tcb-product-cost-ratio"><label><FieldLabel help="Sum of final grade proportion × selected master or direct price in USD/lb.">RM Cost ($/lbs)</FieldLabel><output>{money(gradesReady?calc.rm:null)}</output></label>{input('RMRatio','RM Ratio (%)')}</div></td>
       <td><div className="tcb-product-cost-ratio">{input('SeasoningUSDPerLb','Seasoning/salt ($/lbs)')}{input('SeasoningRatio','Seasoning/salt Ratio (%)')}</div></td>
       <td><div className="tcb-product-cost-ratio">{input('OilUSDPerLb','Oil ($/lbs)')}{input('OilPct','Oil %')}</div></td>
      </tr></tbody>
     </table>
    </div>
    <div className="tcb-grid tcb-product-totals">
     {input('ProcessingUSDPerLb','Processing ($/lbs)')}
     <label><FieldLabel help="Weighted RM, seasoning/salt and oil costs plus Processing. Losses are separate inputs.">Product ($/lbs)</FieldLabel><output>{money(gradesReady?calc.product:null)}</output></label>
    </div>
   </section>}
   {!d.mix&&renderProductLoss(d)}
   <section aria-label="Packaging"><h3>Packaging</h3>{d.mix&&<h4>Mix packaging</h4>}
    <div className="tcb-packaging-scroll" role="region" aria-label={'Packaging layers item '+id} tabIndex={0}>
     <table className="tcb-packaging-table" aria-label={'Packaging layers item '+id}>
      <thead><tr><th scope="col">Packaging layer</th>{['Primary','Secondary','Tertiary'].slice(0,d.layers).map(layer=><th scope="col" key={layer}>{(d.mix?'Mix ':'')+layer+' PM ($/EA)'}</th>)}</tr></thead>
      <tbody><tr><th scope="row">PM price ($/EA) / Loss ratio (%)</th>{['Primary','Secondary','Tertiary'].slice(0,d.layers).map((layer,index)=>{
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
