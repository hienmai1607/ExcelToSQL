import {useEffect,useState} from 'react';
import {draftFromTCB,contextDrafts,type TCBData,type TCBVersion,type VersionReply,type ComparisonReply} from './tcb-draft';
import {savedProcessTree,classifyProcessLeaves} from './grade-process';
import {withTCBGrades,activeCostInputs} from './tcb-grade-pricing';
import {TCBVersionControls} from './tcb-versions';
import {TCBComparison} from './tcb-comparison';
import {ProcessLossEditor} from './process-loss-editor';
import type {GradeLossResult} from './grade-process-loss';
import {call,type Row} from './api';
import {Modal,Notification} from './ui';
import {IconButton} from './icons';
import {objectValue} from './packaging-summary-model';
import {processOptions,lossFieldIssues,type LossStep} from './loss-processes';
import {manualCostInputs,type TCBInputs,type TCBSelection,type TCBGrade} from './tcb-model';
import {OpportunityTCBTab} from './opportunity-tcb-tab';
import {tcbInputIssues} from './tcb-validation';
import {gradeError,type GradeItem,type RawGradeOption,type RawMaterialOption} from './product-grades';
import {parseGradeSnapshot} from './opportunity-grade-snapshot';
import {TCBAnalysis} from './tcb-analysis';

import './opportunity-losses.css';

export type Draft={tcbVersion?:TCBVersion;row:Row;version:string;mix:boolean;readonly:boolean;layers:number;masters:LossStep[];steps:LossStep[];formula:string;grades:GradeItem[];baselineGrades:string;selections:TCBSelection[];baselinePrices:string;quoteGrades:TCBGrade[];quotes:Row[];costingInputs:TCBInputs;baselineCosts:string;pricingGradeKey:string;gradeLocked:boolean;baseline:string};
const signature=(d:Pick<Draft,'steps'|'formula'|'grades'|'selections'|'costingInputs'>)=>JSON.stringify({steps:d.steps,formula:d.formula,grades:d.grades,selections:d.selections,costs:activeCostInputs(d)});
const label=(d:Draft)=>String(d.row.ItemNumber??d.row.ItemID)+' · '+d.row.ProductCode+' · '+d.row.ProductName;
const payload=(d:Draft)=>({RowVersion:d.version,Inputs:{...(Array.isArray(d.costingInputs.ProcessLosses)?{ProcessLosses:activeCostInputs(d).ProcessLosses}:{}),ProductLossFormula:d.formula||null,LossProcesses:d.steps.map(s=>({...s,Sequence:Number(s.Sequence)}))}});
const commercialChanged=(d:Draft)=>JSON.stringify(d.grades)!==d.baselineGrades||JSON.stringify(d.selections)!==d.baselinePrices||JSON.stringify(activeCostInputs(d))!==d.baselineCosts;
const commercialPayload=(d:Draft)=>({...payload(d),...(JSON.stringify(d.grades)!==d.baselineGrades?{Grades:{items:savedProcessTree(d.grades)}}:{}),Prices:d.selections,...(JSON.stringify(activeCostInputs(d))!==d.baselineCosts?{CostInputs:activeCostInputs(d)}:{})});
export function TCBReview({rows,onClose,onSaved}:{rows:Row[];onClose:()=>void;onSaved:(id:number,version:string)=>void}){
 const [analysis,setAnalysis]=useState(false);
 const [analysisDrafts,setAnalysisDrafts]=useState<Draft[]>([]);
 const [comparison,setComparison]=useState<'versions'|'items'|null>(null);
 const [formulaResults,setFormulaResults]=useState<Record<number,string>>({});
 const [gradeLookups,setGradeLookups]=useState<{rows:RawGradeOption[];materials:RawMaterialOption[]}>({rows:[],materials:[]});
 useEffect(()=>{let active=true;call<{rows:RawGradeOption[];materials:RawMaterialOption[]}>('/api/opportunity/grade-lookups').then(r=>{if(active)setGradeLookups(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 const [drafts,setDrafts]=useState<Draft[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[saveNotice,setSaveNotice]=useState<{value:string;severity:'error'|'warning'}|null>(null),[review,setReview]=useState<{id:number;name:string;loss:string;rm?:string|null}[]|null>(null);
 useEffect(()=>{let active=true;
 const all=[...new Map(rows.filter(r=>r.ItemID).map(r=>[Number(r.ItemID),r])).values()],items:Row[]=[],seen=new Set<number>();
 const visit=(r:Row)=>{const id=Number(r.ItemID);if(seen.has(id))return;seen.add(id);items.push(r);all.filter(c=>Number(c.ParentItemID)===id).forEach(visit)};
 all.filter(r=>!r.ParentItemID||!all.some(p=>Number(p.ItemID)===Number(r.ParentItemID))).forEach(visit);all.forEach(visit);
 Promise.all(items.map(async row=>{
  const next=await call<TCBData>('/api/opportunity/items/'+row.ItemID+'/tcb');
  return draftFromTCB(row,next);
 })).then(ds=>{if(active)setDrafts(ds)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
 return()=>{active=false};
 },[rows]);
 const changed=drafts.filter(d=>!d.readonly&&signature(d)!==d.baseline);
 const validationIssues=drafts.filter(d=>!d.readonly).flatMap(d=>{
  const losses=lossFieldIssues(d.steps,processOptions(d.mix,d.layers)),grades=JSON.stringify(d.grades)!==d.baselineGrades?gradeError(d.grades):'';
  return [...losses.map(issue=>({field:issue.index<0?'Losses':'Loss:'+issue.index,message:issue.message})),...(grades?[{field:'Grades',message:grades}]:[]),...(commercialChanged(d)?tcbInputIssues(d):[])].map(issue=>({...issue,id:Number(d.row.ItemID),name:label(d)}));
 });
 const validation=validationIssues.length>0;
 function focusIssue(id:number,field:string){
  if(field.startsWith('Recipe:'))window.dispatchEvent(new CustomEvent('bridge:reveal-recipe',{detail:{id,path:field.split(':')[1]}}));
  setAnalysis(false);
  requestAnimationFrame(()=>{
   const item=document.getElementById('tcb-item-'+id) as HTMLDetailsElement|null;if(!item)return;
   item.open=true;
   const group=[...item.querySelectorAll<HTMLElement>('[data-tcb-field]')].find(node=>node.dataset.tcbField===field)??item;
   let ancestor:HTMLElement|null=group;while(ancestor&&ancestor!==item){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement}
   const control=group.matches('input,select')?group:group.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),summary')??item.querySelector<HTMLElement>('summary');
   control?.focus();group.scrollIntoView({block:'center',behavior:'smooth'});
  });
 }
 function close(){if(!busy&&(!changed.length||window.confirm('Discard unsaved Opportunity item changes?')))onClose()}
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(changed.length||busy){e.preventDefault();e.returnValue=''}},nav=(e:Event)=>{if(busy||(changed.length&&!window.confirm('Discard unsaved Opportunity item changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[changed.length,busy]);
 function update(id:number,fn:(d:Draft)=>Draft){setFormulaResults(results=>{const next={...results};delete next[id];return next});setDrafts(ds=>ds.map(d=>Number(d.row.ItemID)===id?fn(d):d));setReview(null);setMessage('');setError('')}
 function changeGrades(id:number,fn:(items:GradeItem[])=>GradeItem[]){update(id,d=>withTCBGrades(d,fn(d.grades)))}
 function versionPayload(d:Draft){return {...commercialPayload(d),CostInputs:activeCostInputs(d),VersionRowVersion:d.tcbVersion!.RowVersion}}
 function previewPath(d:Draft){return '/api/opportunity/items/'+d.row.ItemID+(d.tcbVersion?'/tcb-versions/'+d.tcbVersion.ID+'/preview':'/commercial/preview')}
 function previewPayload(d:Draft){return d.tcbVersion?versionPayload(d):commercialPayload(d)}
 function loadVersion(d:Draft,r:VersionReply){
  const row={...d.row,...r.rows.find(row=>Number(row.ItemID)===Number(d.row.ItemID))};
  setFormulaResults(results=>{const next={...results};delete next[Number(d.row.ItemID)];return next});
  setDrafts(ds=>ds.map(x=>x.row.ItemID===d.row.ItemID?draftFromTCB(row,r.tcb,r.version):x));setReview(null);setMessage('');setError('');
 }
 async function loadPrices(d:Draft){
  setBusy(true);setError('');
  try{const result=await call<{grades:TCBGrade[];prices:Row[]}>(previewPath(d),previewPayload(d));setDrafts(ds=>ds.map(x=>x===d?{...x,quoteGrades:classifyProcessLeaves(x.grades,result.grades),quotes:result.prices,pricingGradeKey:JSON.stringify(x.grades)}:x))}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function prepare(){
  if(busy||validation||!changed.length)return;setBusy(true);setError('');
  try{const list=[];for(const d of changed){const commercial=commercialChanged(d);const result=await call<{LossProductPct:string;saved?:Record<string,unknown>}>(d.tcbVersion?previewPath(d):'/api/opportunity/items/'+d.row.ItemID+(commercial?'/commercial/preview':'/loss-formula'),d.tcbVersion?versionPayload(d):commercial?commercialPayload(d):payload(d));list.push({id:Number(d.row.ItemID),name:label(d),loss:d.mix?'':result.LossProductPct,rm:commercial?String(result.saved?.RMCostUSDPerLb??'Unpriced'):undefined})}setReview(list)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(busy||!review)return;setBusy(true);setError('');setMessage('');setSaveNotice(null);let saved=0;
  try{for(const entry of review){
   const d=drafts.find(d=>Number(d.row.ItemID)===entry.id)!;
   const commercial=commercialChanged(d);const result=await call<{RowVersion:string;saved?:Record<string,unknown>;snapshot?:unknown;grades?:TCBGrade[];prices?:Row[];version?:TCBVersion}>('/api/opportunity/items/'+entry.id+(d.tcbVersion?'/tcb-versions/'+d.tcbVersion.ID:commercial?'/commercial':'/loss-processes'),d.tcbVersion?versionPayload(d):commercial?commercialPayload(d):payload(d));
   setDrafts(ds=>ds.map(x=>{if(Number(x.row.ItemID)!==entry.id)return x;const grades=parseGradeSnapshot(result.snapshot)?.items??x.grades,costingInputs={...x.costingInputs,...objectValue(result.saved?.Inputs),ProcessLossResults:(result.saved?.ProcessLossSnapshots as GradeLossResult[]|undefined)??x.costingInputs.ProcessLossResults,ProcessLossWeight:x.row.WeightGrams} as TCBInputs,next={...x,tcbVersion:result.version??x.tcbVersion,grades,costingInputs,row:{...x.row,...('PalletUSDPerEA' in objectValue(result.saved?.Inputs)?{DefaultPalletUSDPerEA:costingInputs.PalletUSDPerEA==null?null:String(costingInputs.PalletUSDPerEA)}:{})},version:result.RowVersion,quoteGrades:classifyProcessLeaves(grades,result.grades??x.quoteGrades),quotes:result.prices??x.quotes,baselineGrades:JSON.stringify(grades),baselinePrices:JSON.stringify(x.selections),baselineCosts:JSON.stringify(manualCostInputs(costingInputs)),pricingGradeKey:JSON.stringify(grades)};return {...next,baseline:signature(next)}}));
   if(!d.tcbVersion||d.tcbVersion.IsActive)onSaved(entry.id,result.RowVersion);saved++;
  }setMessage('Saved '+(review.some(r=>r.rm!==undefined)?'item settings':'losses')+' for '+saved+' item(s).');setReview(null)}
  catch(e){setReview(null);setSaveNotice({severity:saved?'warning':'error',value:'Saved '+saved+' item(s). Remaining changes are retained; retry after resolving: '+(e as Error).message})}
  finally{setBusy(false)}
 }
 async function showAnalysis(){
  if(busy||loading||review)return;setBusy(true);setError('');
  try{const entries=await Promise.all(drafts.filter(d=>!d.mix&&d.formula).map(async d=>{const result=await call<{LossProductPct:string}>(d.tcbVersion?previewPath(d):'/api/opportunity/items/'+d.row.ItemID+'/loss-formula',d.tcbVersion?versionPayload(d):payload(d));return [Number(d.row.ItemID),result.LossProductPct] as const}));setFormulaResults(results=>({...results,...Object.fromEntries(entries)}));
   const context=await call<ComparisonReply>('/api/opportunity/items/'+drafts[0].row.ItemID+'/tcb-comparison');
   const evaluated=await Promise.all(drafts.map(async d=>{
    if(!d.costingInputs.ProcessLosses?.some(r=>r.Formula?.trim()))return d;
    const result=await call<{ProcessLossSnapshots?:GradeLossResult[];saved?:{ProcessLossSnapshots?:GradeLossResult[]}}>(d.tcbVersion?previewPath(d):'/api/opportunity/items/'+d.row.ItemID+'/loss-formula',d.tcbVersion?versionPayload(d):payload(d));
    return {...d,costingInputs:{...d.costingInputs,ProcessLossResults:result.ProcessLossSnapshots??result.saved?.ProcessLossSnapshots??[],ProcessLossWeight:d.row.WeightGrams}};
   }));
   const others=context.entries?contextDrafts(context):[];
   setDrafts(evaluated);
   setAnalysisDrafts([...others.map(x=>evaluated.find(d=>d.row.ItemID===x.row.ItemID)??x),...evaluated.filter(d=>!others.some(x=>x.row.ItemID===d.row.ItemID))]);setAnalysis(true)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function testProcessLoss(d:Draft){
  if(busy||review)return;setBusy(true);setError('');
  const id=Number(d.row.ItemID);update(id,()=>d);
  try{
   const selected=activeCostInputs(d).ProcessLosses??[],paths=new Set(selected.map(r=>r.Path));
   const body=d.tcbVersion?{...versionPayload(d),CostInputs:{...activeCostInputs(d),ProcessLosses:selected}}:{...payload(d),Inputs:{...payload(d).Inputs,ProcessLosses:selected}};
   const result=await call<{ProcessLossSnapshots?:GradeLossResult[];saved?:{ProcessLossSnapshots?:GradeLossResult[]}}>(d.tcbVersion?previewPath(d):'/api/opportunity/items/'+id+'/loss-formula',body);
   const values=result.ProcessLossSnapshots??result.saved?.ProcessLossSnapshots??[];
   update(id,x=>({...x,costingInputs:{...x.costingInputs,ProcessLossResults:[...(x.costingInputs.ProcessLossResults??[]).filter(r=>!paths.has(r.Path)),...values],ProcessLossWeight:x.row.WeightGrams}}));
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 function renderProductLoss(d:Draft){
  return <ProcessLossEditor d={d} busy={busy} review={!!review} update={update} onTest={testProcessLoss}/>;
 }
 return <Modal label="TCB Review" className="dialog opportunity-loss-dialog tcb-review-dialog" onClose={close}>
 <header className="customer-editor-heading"><div><h2>TCB Review</h2><div className="tcb-review-header-line"><p>{String(rows[0]?.OpportunityNumber??'')}</p>{drafts.length>0&&<IconButton icon="history" label="Compare TCB versions" disabled={busy||loading||!!review} onClick={()=>setComparison('versions')}/>}
 {drafts.some(d=>!d.mix)&&<IconButton icon={analysis?'left':'analysis'} label={analysis?'Back to TCB inputs':'Analysis'} title={analysis?'Back to TCB inputs':'View all items in this opportunity'} aria-pressed={analysis} disabled={busy||loading||!!review} onClick={()=>analysis?setAnalysis(false):showAnalysis()}/>}
 <IconButton icon="layout" label="Compare opportunity items" disabled={busy||loading||!!review} onClick={()=>setComparison('items')}/></div></div><IconButton icon="close" label="Close TCB Review" disabled={busy} onClick={close}/></header>
 <Notification value={error} severity="error" onDismiss={()=>setError('')}/>
 {validationIssues.length>0&&<section className="tcb-validation-summary" role="region" aria-label="TCB validation summary"><h3>Check these fields before saving</h3><ul>{validationIssues.map((issue,index)=><li key={index}><button type="button" className="link" onClick={()=>focusIssue(issue.id,issue.field)}>{issue.name+': '+issue.message}</button></li>)}</ul></section>}
 {loading?<p role="status">Loading TCB Review…</p>:<>
 {analysis?<TCBAnalysis drafts={analysisDrafts.length?analysisDrafts:drafts} tested={formulaResults}/>:<>
 <OpportunityTCBTab drafts={drafts} lookups={gradeLookups} busy={busy} review={!!review} update={update} changeGrades={changeGrades} loadPrices={loadPrices} renderProductLoss={renderProductLoss} renderVersions={d=><TCBVersionControls d={d} dirty={signature(d)!==d.baseline} busy={busy||!!review} onWorking={setBusy} onMetadata={v=>setDrafts(ds=>ds.map(x=>x.row.ItemID===d.row.ItemID&&!x.tcbVersion?{...x,tcbVersion:v}:x))} onLoad={r=>loadVersion(d,r)} onActivated={token=>onSaved(Number(d.row.ItemID),token)}/>}/></>}
 {review&&<section aria-label="Review Opportunity losses"><h3>Review changes</h3>{review.map(r=><p key={r.id}>{r.name+(r.loss?' · Product loss: '+r.loss+'%':' · Mix packaging losses')+(r.rm!==undefined?' · RM Cost: '+r.rm+(r.rm==='Unpriced'?'':' USD/lb'):'')}</p>)}<p>Changed items save individually. If a save fails, completed items remain saved and unsaved changes stay available to retry.</p></section>}
 <Notification value={message} onDismiss={()=>setMessage('')}/><Notification value={saveNotice?.value??''} severity={saveNotice?.severity} onDismiss={()=>setSaveNotice(null)}/>
 <div className="actions"><button disabled={busy} onClick={close}>Close</button>{review?<><button disabled={busy} onClick={()=>setReview(null)}>Back to editing</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></>:<button className="primary" disabled={busy||!!validation||!changed.length} onClick={prepare}>{busy?'Checking…':'Review & save'}</button>}</div>
 </>}
 {comparison&&<TCBComparison mode={comparison} drafts={drafts} onClose={()=>setComparison(null)}/>}
 </Modal>;
}
