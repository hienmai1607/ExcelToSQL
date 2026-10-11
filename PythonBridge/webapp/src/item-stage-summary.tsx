import {useId,useState} from 'react';
import type {Row} from './api';
import {timestamp} from './datetime';
import './item-stage-summary.css';

type Evidence={ProductInfoComplete?:boolean;PackagingRequirementsComplete?:boolean;ProductReviewComplete?:boolean;ProductReviewMissingFields?:string[];TCBEntriesComplete?:boolean;TCBReviewComplete?:boolean;AnalysisMissingFields?:string[];PricesFromChildren?:boolean;TCBBlockedByChildren?:boolean;PackagingStage?:string;RequestNumber?:string;PIC?:string;RequestedAt?:string;SubmittedAt?:string;ReviewedAt?:string;Reason?:string;TCBSaved?:boolean;TCBCalculated?:boolean;ShipmentSaved?:boolean;LossSaved?:boolean;PricesSaved?:boolean;GradesSaved?:boolean;ShipmentInherited?:boolean};
const steps=['Initial','Product Review','Packaging requested','PIC Assigned','Review Submitted','Review result','TCB Review','Customer proposal','Customer result'];
const stageColors=['#ff2600','#ff5100','#ff9100','#ffc400','#ffff00','#d4ff00','#00ee00','#008e8e','#003bff'];
function evidence(row:Row):Evidence{
 try{return row.StageSummaryJSON?JSON.parse(String(row.StageSummaryJSON)):{}}
 catch{return {}}
}
function packagingPosition(row:Row,e:Evidence){
 const item=String(row.ItemStage??'Draft'),stage=e.PackagingStage??String(row.OpenPackagingRequestStage??row.PackagingResponseStage??'');
 if(stage==='Canceled')return 1;
 if(stage==='Approved')return 6;
 if(['Rejected','Returned'].includes(stage))return 5;
 if(stage==='Pending Review')return 4;
 if(e.PIC||stage==='Working')return 3;
 if(e.RequestNumber||row.PackagingRequestNumber||row.HasOpenPackagingRequest)return 2;
 return e.ProductReviewComplete!==undefined?1:item==='Draft'?0:1;
}
export function stagePosition(row:Row,e:Evidence){
 if(row.ItemStage==='Awarded'||row.ItemStage==='Lost')return 8;
 if(row.ItemStage==='Proposed')return 7;
 const stage=e.PackagingStage??String(row.OpenPackagingRequestStage??row.PackagingResponseStage??'');
 if(['Returned','Rejected','Canceled'].includes(stage)||row.ItemStage==='Canceled')return packagingPosition(row,e);
 if(e.TCBReviewComplete&&!e.TCBBlockedByChildren)return 7;
 if(e.TCBEntriesComplete&&!e.TCBBlockedByChildren)return 6;
 return packagingPosition(row,e);
}
export function ItemStageSummary({items}:{items:Row[]}){
 const gradientPrefix=useId().replace(/:/g,'');
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const toggle=(key:string)=>setExpanded(current=>({...current,[key]:!current[key]}));
 return <section className="item-stage-summary panel" aria-label="Stage Summary">
 <h2>Stage Summary</h2>
 <p className="muted">Current saved progress for every item, including children. TCB Entries branches from Product Review and joins packaging at TCB Review before Customer proposal; completed entries advance to TCB Review, which completes when every Analysis field is available.</p>
 <div className="stage-legend"><span>Completed / reached</span><span>Current</span><span>Not reached</span></div>
 {items.map(row=>{
  const e=evidence(row),position=stagePosition(row,e),packPosition=packagingPosition(row,e),stage=e.PackagingStage??String(row.OpenPackagingRequestStage??row.PackagingResponseStage??''),canceled=stage==='Canceled',itemCanceled=row.ItemStage==='Canceled',blocked=['Returned','Rejected','Canceled'].includes(stage),flowBlocked=blocked||itemCanceled||!!e.TCBBlockedByChildren,entriesComplete=!!e.TCBEntriesComplete&&!flowBlocked,reviewComplete=!!e.TCBReviewComplete&&!flowBlocked;
  const edgeReached=(edge:number)=>!itemCanceled&&(edge<0?false:edge<5?edge<packPosition:edge===5?stage==='Approved'&&!blocked&&position>=6:edge===6?reviewComplete||!flowBlocked&&position>=7:!flowBlocked&&position>=8);
  const details=['Initial item',e.ProductReviewComplete===undefined?'Not reviewed':e.ProductReviewComplete?'Complete':'Incomplete',[e.RequestNumber??String(row.PackagingRequestNumber??''),timestamp(e.RequestedAt)].filter(Boolean).join(' - '),e.PIC??(position<2?'Not assigned':position===2?'Awaiting PIC':'PIC assigned'),timestamp(e.SubmittedAt)||(stage==='Pending Review'?'Awaiting review':''),['Approved','Rejected','Returned','Canceled'].includes(stage)?[canceled?'Rejected / Canceled':stage,timestamp(e.ReviewedAt)].filter(Boolean).join(' - '):'Awaiting result',reviewComplete?'Analysis complete':e.TCBBlockedByChildren?'Child item returned/rejected':(e.AnalysisMissingFields?.length?e.AnalysisMissingFields.length+' Analysis fields unavailable':e.TCBSaved?'Entries saved; Analysis incomplete':'Awaiting entries'),row.ItemStage==='Proposed'?'Proposed':reviewComplete?'Ready for proposal':'',row.ItemStage==='Awarded'?'Awarded':row.ItemStage==='Lost'?'Lost':''];
  return <article key={String(row.ItemID)} className={'stage-item'+(row.ParentItemID?' stage-child':'')} aria-label={'Stage for Item '+row.ItemNumber}>
   <header><h3>Item {String(row.ItemNumber??row.ItemID)} <small>{row.ParentItemID?'Child item':''}</small></h3><p>{String(row.ProductCode??'')} &middot; {String(row.ProductName??'')}</p><span className="stage-current-label">{itemCanceled?'Item canceled':position===7&&row.ItemStage!=='Proposed'?'Ready for Customer proposal':steps[position]}{position===1&&e.ProductReviewComplete?' - Complete':position===5?' - '+stage:''}</span></header>
   <div className="stage-flow-scroll" tabIndex={0} aria-label={'Workflow for Item '+row.ItemNumber}>
    <div className="stage-workflow">
    <svg className="stage-branch-connectors" viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true" style={{'--branch-color':stageColors[1],'--branch-merge':'url(#'+gradientPrefix+'-'+row.ItemID+')'} as React.CSSProperties}>
     <defs><linearGradient id={gradientPrefix+'-'+row.ItemID} gradientUnits="userSpaceOnUse" x1="444.4444" y1="0" x2="722.2222" y2="0"><stop offset="0%" stopColor={stageColors[1]}/><stop offset="66.6667%" stopColor={stageColors[1]}/><stop offset="100%" stopColor={stageColors[5]}/></linearGradient></defs>
     <path className={(e.TCBSaved||position>=7)&&!itemCanceled?'reached':'pending'} data-from="Product Review" data-to="TCB Entries" d="M166.6667 0 H190 C240 0 230 140 277.7778 140 H444.4444"/>
     <path className={(entriesComplete||reviewComplete||position>=7)&&!flowBlocked?'reached':'pending'} data-from="TCB Entries" data-to="TCB Review" d="M444.4444 140 H600 C680 140 655 0 700 0 H722.2222"/>
    </svg>
    <ol className="stage-flow">{steps.map((label,index)=>{
     const nodePosition=index<6?packPosition:position;const state=blocked&&index===5?'blocked':itemCanceled?'pending':index===1&&e.ProductReviewComplete!==undefined?(e.ProductReviewComplete?'complete':'current'):index===6&&reviewComplete?'complete':index<nodePosition?'complete':index===nodePosition?'current':'pending';
     return <li key={label} className={'stage-node '+state} aria-current={!itemCanceled&&index===position?'step':undefined} style={{'--stage-in':edgeReached(index-1)?'var(--stage-color)':'#c5cecc','--stage-out':edgeReached(index)?'var(--stage-color)':'#c5cecc','--stage-color':stageColors[index]} as React.CSSProperties}>
      <button type="button" className="stage-milestone-toggle" aria-label={'View details for '+label+' item '+row.ItemNumber} aria-expanded={!!expanded[row.ItemID+':'+index]} aria-controls={gradientPrefix+'-'+row.ItemID+'-note-'+index} onClick={()=>toggle(row.ItemID+':'+index)}><span className="stage-dot" aria-hidden="true">{state==='blocked'?'\u00d7':state==='complete'?'\u2713':index+1}</span><strong><span>{label}</span></strong></button><small title={index===1?'Product Info: '+(e.ProductInfoComplete?'Complete':'Incomplete')+' / Packaging requirements: '+(e.PackagingRequirementsComplete?'Complete':'Incomplete')+(e.ProductReviewMissingFields?.length?' - Missing: '+e.ProductReviewMissingFields.join(', '):''):index===6?e.AnalysisMissingFields?.join(', '):undefined}><div className="stage-note-details"><span className="stage-note-status">{index===1?details[index]:state==='blocked'?stage==='Returned'?'Returned':'Rejected':state==='complete'?'Complete':state==='current'?'In progress':'Not reached'}</span><div className="stage-note-content" id={gradientPrefix+'-'+row.ItemID+'-note-'+index} hidden={!expanded[row.ItemID+':'+index]}>{details[index]||'Not reached'}{index===1&&<p>Product Info: {e.ProductInfoComplete?'Complete':'Incomplete'}<br/>Packaging requirements: {e.PackagingRequirementsComplete?'Complete':'Incomplete'}</p>}{(index===1?e.ProductReviewMissingFields:index===6?e.AnalysisMissingFields:undefined)?.length?<p>Missing: {(index===1?e.ProductReviewMissingFields:e.AnalysisMissingFields)?.join(', ')}</p>:null}</div></div></small><span className="sr-only">{state==='blocked'?stage==='Returned'?'Returned - next step blocked':'Rejected / Canceled - next step blocked':state}</span>
     </li>
    })}</ol>

   <div className="stage-tcb-track" style={{'--stage-color':stageColors[1]} as React.CSSProperties} role="region" aria-label="TCB Entries branch from Product Review to TCB Review">
    <button type="button" className="stage-milestone-toggle" aria-label={'View details for TCB Entries item '+row.ItemNumber} aria-expanded={!!expanded[row.ItemID+':tcb']} aria-controls={gradientPrefix+'-'+row.ItemID+'-tcb-notes'} onClick={()=>toggle(row.ItemID+':tcb')}><span className={'stage-dot stage-tcb-dot '+(entriesComplete||e.TCBSaved?'saved':'pending')} aria-hidden="true">{entriesComplete?'\u2713':'T'}</span><span className="stage-tcb-heading" role="heading" aria-level={4}>TCB Entries</span></button><div className="stage-tcb-details"><p className="stage-tcb-status">{entriesComplete?'Entries complete':e.TCBCalculated?'Calculation saved':e.TCBSaved?'Inputs saved':'Not started'}</p><div className="stage-tcb-content" id={gradientPrefix+'-'+row.ItemID+'-tcb-notes'} hidden={!expanded[row.ItemID+':tcb']}>
    <ul>{[['Shipment / Logistics / Others',e.ShipmentSaved],['Loss',e.LossSaved],['Grades',e.GradesSaved],['Price entries',e.PricesSaved]].map(([label,saved])=><li key={String(label)} className={saved?'saved':''}>{String(label)}: {label==='Price entries'&&e.PricesFromChildren?(saved?'From child items':'Child prices incomplete'):saved?'Saved':'Not saved'}</li>)}</ul>
    {row.ParentItemID&&<p className="muted">Shipment / Logistics / Others inherited from the parent item; grades, losses and prices are tracked for this child.</p>}
   </div></div></div>
   </div></div>
   {(canceled||itemCanceled||stage==='Returned'||stage==='Rejected')&&<div className="stage-exception" role="note"><strong>{canceled?'Rejected / Canceled -> Product Review':itemCanceled?'Item canceled':stage==='Returned'?'Returned for revision':'Rejected'}</strong><span>Reason: {e.Reason||'Not recorded or not available with your access.'}</span></div>}
  </article>
 })}
 {!items.length&&<p>No items to track.</p>}
 <p className="muted">Product Review completes when required Product Info and Packaging requirements are saved. Optional blanks do not block completion; click the milestone to see missing required fields. Customer results use Awarded/Lost. Rejected uses the existing Canceled action.</p>
 </section>;
}
