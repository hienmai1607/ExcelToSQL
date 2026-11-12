import {useId,useState} from 'react';
import type {Row} from './api';
import {timestamp} from './datetime';
import './item-stage-summary.css';

type RecipeEvidence={ManagerApproved?:boolean;ManagerApprovedCount?:number;ApprovedCount?:number;ApprovalStatus?:string;SalesReviewStatus?:string;Required?:boolean;State?:string;Requested?:boolean;Assigned?:boolean;Submitted?:boolean;Reviewed?:boolean;Approved?:boolean;RequestNumber?:string;PIC?:string;SheetNumber?:string;RequestedAt?:string;AssignedAt?:string;SubmittedAt?:string;ReviewedAt?:string;ReviewedBy?:string;Reason?:string;RequiredCount?:number;RequestedCount?:number;AssignedCount?:number;SubmittedCount?:number;ReviewedCount?:number;ItemNumber?:string;ProductCode?:string;Children?:RecipeEvidence[]};
type Evidence={SalesReviewStatus?:string;Recipe?:RecipeEvidence;ProductInfoComplete?:boolean;PackagingRequirementsComplete?:boolean;ProductReviewComplete?:boolean;ProductReviewMissingFields?:string[];TCBEntriesComplete?:boolean;TCBReviewComplete?:boolean;AnalysisMissingFields?:string[];PricesFromChildren?:boolean;TCBBlockedByChildren?:boolean;PackagingStage?:string;RequestNumber?:string;PIC?:string;RequestedAt?:string;SubmittedAt?:string;ReviewedAt?:string;Reason?:string;TCBSaved?:boolean;TCBCalculated?:boolean;ShipmentSaved?:boolean;LossSaved?:boolean;PricesSaved?:boolean;GradesSaved?:boolean;ShipmentInherited?:boolean};
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
 if(stage==='Awaiting Sales')return 5;
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
 if(stage!=='Awaiting Sales'&&e.TCBReviewComplete&&!e.TCBBlockedByChildren&&(!e.Recipe?.Required||e.Recipe.Approved))return 7;
 if(e.TCBEntriesComplete&&!e.TCBBlockedByChildren)return 6;
 return packagingPosition(row,e);
}
export function ItemStageSummary({items}:{items:Row[]}){
 const gradientPrefix=useId().replace(/:/g,'');
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const toggle=(key:string)=>setExpanded(current=>({...current,[key]:!current[key]}));
 return <section className="item-stage-summary panel" aria-label="Stage Summary">
 <h2>Stage Summary</h2>
 <p className="muted">Current saved progress for every item, including children. Packaging, Recipe and TCB Entries run in parallel from Product Review to TCB Review. Required recipes show their request, assignment, submission and review progress.</p>
 <div className="stage-legend"><span>Completed / reached</span><span>Current</span><span>Not reached</span></div>
 {items.map(row=>{
  const e=evidence(row),position=stagePosition(row,e),packPosition=packagingPosition(row,e),stage=e.PackagingStage??String(row.OpenPackagingRequestStage??row.PackagingResponseStage??''),canceled=stage==='Canceled',itemCanceled=row.ItemStage==='Canceled',blocked=['Returned','Rejected','Canceled'].includes(stage),flowBlocked=blocked||itemCanceled||!!e.TCBBlockedByChildren,entriesComplete=!!e.TCBEntriesComplete&&!flowBlocked,recipeRequired=!!e.Recipe?.Required,recipeReady=!recipeRequired||!!e.Recipe?.Approved,reviewComplete=!!e.TCBReviewComplete&&!flowBlocked&&recipeReady&&stage!=='Awaiting Sales';
  const edgeReached=(edge:number)=>!itemCanceled&&(edge<0?false:edge<5?edge<packPosition:edge===5?stage==='Approved'&&!blocked&&position>=6:edge===6?reviewComplete||!flowBlocked&&position>=7:!flowBlocked&&position>=8);
  const details=['Initial item',e.ProductReviewComplete===undefined?'Not reviewed':e.ProductReviewComplete?'Complete':'Incomplete',[e.RequestNumber??String(row.PackagingRequestNumber??''),timestamp(e.RequestedAt)].filter(Boolean).join(' - '),e.PIC??(position<2?'Not assigned':position===2?'Awaiting PIC':'PIC assigned'),timestamp(e.SubmittedAt)||(stage==='Pending Review'?'Awaiting review':''),['Approved','Awaiting Sales','Rejected','Returned','Canceled'].includes(stage)?[canceled?'Rejected / Canceled':stage,timestamp(e.ReviewedAt)].filter(Boolean).join(' - '):'Awaiting result',!recipeReady?'Awaiting recipe approval':reviewComplete?'Analysis complete':e.TCBBlockedByChildren?'Child item returned/rejected':(e.AnalysisMissingFields?.length?e.AnalysisMissingFields.length+' Analysis fields unavailable':e.TCBSaved?'Entries saved; Analysis incomplete':'Awaiting entries'),row.ItemStage==='Proposed'?'Proposed':reviewComplete?'Ready for proposal':'',row.ItemStage==='Awarded'?'Awarded':row.ItemStage==='Lost'?'Lost':''];
  return <article key={String(row.ItemID)} className={'stage-item'+(row.ParentItemID?' stage-child':'')} aria-label={'Stage for Item '+row.ItemNumber}>
   <header><h3>Item {String(row.ItemNumber??row.ItemID)} <small>{row.ParentItemID?'Child item':''}</small></h3><p>{String(row.ProductCode??'')} &middot; {String(row.ProductName??'')}</p><span className="stage-current-label">{itemCanceled?'Item canceled':position===7&&row.ItemStage!=='Proposed'?'Ready for Customer proposal':steps[position]}{position===1&&e.ProductReviewComplete?' - Complete':position===5?' - '+stage:''}</span></header>
   <div className="stage-flow-scroll" tabIndex={0} aria-label={'Workflow for Item '+row.ItemNumber}>
    <div className={"stage-workflow"+(recipeRequired?" has-recipe-branch":"")}>
    <svg className="stage-branch-connectors" viewBox={recipeRequired?"0 0 1000 280":"0 0 1000 140"} preserveAspectRatio="none" aria-hidden="true" style={{height:recipeRequired?280:140,'--branch-color':stageColors[1],'--branch-merge':'url(#'+gradientPrefix+'-'+row.ItemID+')'} as React.CSSProperties}>
     <defs><linearGradient id={gradientPrefix+'-'+row.ItemID} gradientUnits="userSpaceOnUse" x1="444.4444" y1="0" x2="722.2222" y2="0"><stop offset="0%" stopColor={stageColors[1]}/><stop offset="66.6667%" stopColor={stageColors[1]}/><stop offset="100%" stopColor={stageColors[5]}/></linearGradient>{recipeRequired&&<linearGradient id={gradientPrefix+'-'+row.ItemID+'-junction'} gradientUnits="userSpaceOnUse" x1="722.2222" y1="24" x2="722.2222" y2="0"><stop offset="0%" stopColor={stageColors[5]}/><stop offset="100%" stopColor={stageColors[6]}/></linearGradient>}</defs>
     <path className={(e.TCBSaved||position>=7)&&!itemCanceled?'reached':'pending'} data-from={recipeRequired?'Recipe branch':'Product Review'} data-to="TCB Entries" d={recipeRequired?"M216 96 V260 Q216 280 236 280 H444.4444":"M166.6667 0 H190 C240 0 230 140 277.7778 140 H444.4444"}/>
     <path className={(entriesComplete||reviewComplete||position>=7)&&!flowBlocked?'reached':'pending'} data-from="TCB Entries" data-to="TCB Review" d={recipeRequired?"M444.4444 280 H650 Q670 280 670 260 V120":"M444.4444 140 H600 C680 140 655 0 700 0 H722.2222"}/>
     {recipeRequired&&<path className={(entriesComplete||recipeReady)&&!flowBlocked?'reached':'pending'} data-from="Recipe / TCB merge" data-to="Branch junction" d="M670 120 V55 Q670 24 700 24 H722.2222" style={{stroke:(entriesComplete||recipeReady)&&!flowBlocked?stageColors[5]:'#c5cecc'}}/>}
     {recipeRequired&&<path className={(entriesComplete||reviewComplete||position>=7)&&recipeReady&&!flowBlocked?'reached':'pending'} data-from="Branch junction" data-to="TCB Review junction" d="M722.2222 24 V0" style={{stroke:(entriesComplete||reviewComplete||position>=7)&&recipeReady&&!flowBlocked?'url(#'+gradientPrefix+'-'+row.ItemID+'-junction)':'#c5cecc'}}/>}
    </svg>
    <ol className="stage-flow">{steps.map((label,index)=>{
     const nodePosition=index<6?packPosition:position;const state=blocked&&index===5?'blocked':itemCanceled?'pending':index===1&&e.ProductReviewComplete!==undefined?(e.ProductReviewComplete?'complete':'current'):index===6&&reviewComplete?'complete':index<nodePosition?'complete':index===nodePosition?'current':'pending';
     return <li key={label} className={'stage-node '+state} aria-current={!itemCanceled&&index===position?'step':undefined} style={{'--stage-in':edgeReached(index-1)?'var(--stage-color)':'#c5cecc','--stage-out':edgeReached(index)?'var(--stage-color)':'#c5cecc','--stage-color':stageColors[index]} as React.CSSProperties}>
      <button type="button" className="stage-milestone-toggle" aria-label={'View details for '+label+' item '+row.ItemNumber} aria-expanded={!!expanded[row.ItemID+':'+index]} aria-controls={gradientPrefix+'-'+row.ItemID+'-note-'+index} onClick={()=>toggle(row.ItemID+':'+index)}><span className="stage-dot" aria-hidden="true">{state==='blocked'?'\u00d7':state==='complete'?'\u2713':index+1}</span><strong><span>{label}</span></strong></button><small title={index===1?'Product Info: '+(e.ProductInfoComplete?'Complete':'Incomplete')+' / Packaging requirements: '+(e.PackagingRequirementsComplete?'Complete':'Incomplete')+(e.ProductReviewMissingFields?.length?' - Missing: '+e.ProductReviewMissingFields.join(', '):''):index===6?e.AnalysisMissingFields?.join(', '):undefined}><div className="stage-note-details"><span className="stage-note-status">{index===5?<ReviewResult manager={['Approved','Awaiting Sales'].includes(stage)||e.SalesReviewStatus==='Returned'?'Approved':stage==='Returned'?'Returned':stage==='Canceled'||stage==='Rejected'?'Rejected':'Pending'} sales={e.SalesReviewStatus||(stage==='Approved'?'Accepted':stage==='Awaiting Sales'?'Pending':'Not submitted')}/>:index===1?details[index]:state==='blocked'?stage==='Returned'?'Returned':'Rejected':state==='complete'?'Complete':state==='current'?'In progress':'Not reached'}</span><div className="stage-note-content" id={gradientPrefix+'-'+row.ItemID+'-note-'+index} hidden={!expanded[row.ItemID+':'+index]}>{details[index]||'Not reached'}{index===1&&<p>Product Info: {e.ProductInfoComplete?'Complete':'Incomplete'}<br/>Packaging requirements: {e.PackagingRequirementsComplete?'Complete':'Incomplete'}</p>}{(index===1?e.ProductReviewMissingFields:index===6?e.AnalysisMissingFields:undefined)?.length?<p>Missing: {(index===1?e.ProductReviewMissingFields:e.AnalysisMissingFields)?.join(', ')}</p>:null}</div></div></small><span className="sr-only">{state==='blocked'?stage==='Returned'?'Returned - next step blocked':'Rejected / Canceled - next step blocked':state}</span>
     </li>
    })}</ol>

   {e.Recipe&&<RecipeBranch recipe={e.Recipe} itemNumber={String(row.ItemNumber)} canceled={itemCanceled}/> }
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


function RecipeBranch({recipe,itemNumber,canceled}:{recipe:RecipeEvidence;itemNumber:string;canceled:boolean}){
 const [expanded,setExpanded]=useState<number|null>(null),id=useId();
 if(!recipe.Required)return <div className="stage-recipe-optional" role="region" aria-label="Recipe branch"><strong>Recipe</strong><span>Not required</span></div>;
 const fields=['Requested','Assigned','Submitted','Reviewed'] as const,labels=['Recipe Requested','PIC Assigned','Review Submitted','Review Result'];
 const colors=stageColors.slice(2,6),values=[recipe.RequestNumber,recipe.PIC,recipe.SheetNumber,[recipe.State,recipe.ReviewedBy].filter(Boolean).join(' / ')],dates=[recipe.RequestedAt,recipe.AssignedAt,recipe.SubmittedAt,recipe.ReviewedAt];
 const returned=['Returned','Closed'].includes(recipe.State??''),firstPending=fields.findIndex((key,index)=>index===3?!recipe.Approved:!recipe[key]);
 return <>
 <svg className="stage-recipe-connectors" viewBox="0 0 1000 140" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id={id+'-request'} gradientUnits="userSpaceOnUse" x1="200" y1="0" x2="277.7778" y2="140"><stop offset="0%" stopColor={stageColors[1]}/><stop offset="100%" stopColor={colors[0]}/></linearGradient></defs>
  <path className={recipe.Requested&&!canceled?'reached':'pending'} data-from="Product Review" data-to="Recipe Requested" d="M180 10 H200 Q216 10 216 24 V96 Q216 140 277.7778 140" style={{stroke:recipe.Requested&&!canceled?'url(#'+id+'-request)':'#c5cecc'}}/>
  <path className={recipe.Approved&&!canceled?'reached':'pending'} data-from="Recipe Review Result" data-to="Recipe / TCB Review" d="M611.1111 140 H650 Q670 140 670 120" style={{stroke:recipe.Approved&&!canceled?colors[3]:'#c5cecc'}}/>
 </svg>
 <section className="stage-recipe-track" role="region" aria-label="Recipe branch from Product Review to TCB Review">
 <ol>{fields.map((key,index)=>{
  const state=canceled?'pending':index===3&&returned?'blocked':(index===3?recipe.Approved:recipe[key])?'complete':index===firstPending?'current':'pending';
  const count=recipe[(key+'Count') as keyof RecipeEvidence];
  const status=recipe.RequiredCount?String(count??0)+' / '+recipe.RequiredCount+(index===3?' reviewed':''):index===3&&recipe.Reviewed?recipe.State:state==='complete'?'Complete':state==='current'?'In progress':'Not reached';
  return <li key={key} className={'stage-recipe-node '+state} style={{'--stage-color':colors[index],'--stage-in':recipe[key]&&!canceled?colors[index]:'#c5cecc','--stage-out':recipe[fields[index+1]]&&!canceled?colors[index]:'#c5cecc'} as React.CSSProperties}>
   <button className="stage-milestone-toggle" aria-label={'View details for Recipe '+labels[index]+' item '+itemNumber} aria-expanded={expanded===index} aria-controls={id+'-'+index} onClick={()=>setExpanded(expanded===index?null:index)}><span className="stage-dot" aria-hidden="true">{state==='blocked'?'\u00d7':state==='complete'?'\u2713':index+1}</span><strong>{labels[index]}</strong></button>
   <small>{index===3?<RecipeReviewResult recipe={recipe}/>:status}</small><div className="stage-note-content" id={id+'-'+index} hidden={expanded!==index}>{values[index]||'Not reached'}{dates[index]&&<p>{timestamp(dates[index])}</p>}{index===3&&recipe.Reason&&<p>{recipe.Reason}</p>}{recipe.Children?.map(child=><p key={child.ItemNumber}>Item {child.ItemNumber} / {child.ProductCode}: {index===0?child.RequestNumber||'Not requested':index===1?child.PIC||'Not assigned':index===2?child.SheetNumber||'Not submitted':child.State}</p>)}</div>
  </li>;
 })}</ol></section></>;
}

function ReviewResult({manager,sales}:{manager:string;sales:string}){
 return <span className="stage-review-results"><span>Manager: {manager}</span><span>Sales: {sales==='Not submitted'?'Not reached':sales==='Pending'?'Awaiting acceptance':sales}</span></span>;
}
function RecipeReviewResult({recipe}:{recipe:RecipeEvidence}){
 if(recipe.Children?.length){
  const total=recipe.Children.length;
  const managers=recipe.Children.filter(r=>r.ManagerApproved??(r.ApprovalStatus==='Approved'||r.Approved||r.State==='Awaiting Sales')).length;
  const accepted=recipe.Children.filter(r=>r.Approved).length;
  return <span className="stage-review-results"><span>Manager: {managers} / {total} approved</span><span>Sales: {accepted} / {total} accepted{recipe.Children.some(r=>r.SalesReviewStatus==='Returned')?' ? Returned':''}</span></span>;
 }
 const manager=recipe.ManagerApproved??(recipe.ApprovalStatus==='Approved'||recipe.Approved||recipe.State==='Awaiting Sales');
 return <ReviewResult manager={manager?'Approved':recipe.State==='Returned'?'Returned':'Pending'} sales={recipe.SalesReviewStatus||(recipe.Approved?'Accepted':manager?'Pending':'Not submitted')}/>;
}
