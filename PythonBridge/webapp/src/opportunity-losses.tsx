import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,FieldLabel} from './ui';
import {IconButton} from './icons';
import {objectValue,quantityDisplay} from './packaging-summary-model';
import {migrateLossProcesses,lossTotals,processOptions,lossError,lossFieldIssues,type LossStep} from './loss-processes';
import {defaultInputs,manualCostInputs,type TCBInputs,type TCBSelection,type TCBGrade} from './tcb-model';
import {OpportunityTCBTab} from './opportunity-tcb-tab';
import {tcbInputIssues} from './tcb-validation';
import {gradeError,type GradeItem,type RawGradeOption,type RawMaterialOption} from './product-grades';
import {parseGradeSnapshot} from './opportunity-grade-snapshot';
import {TCBAnalysis} from './tcb-analysis';
import {productLossValue} from './tcb-analysis-model';
import './opportunity-losses.css';

export type Draft={row:Row;version:string;mix:boolean;readonly:boolean;layers:number;masters:LossStep[];steps:LossStep[];formula:string;grades:GradeItem[];baselineGrades:string;selections:TCBSelection[];baselinePrices:string;quoteGrades:TCBGrade[];quotes:Row[];costingInputs:TCBInputs;baselineCosts:string;pricingGradeKey:string;gradeLocked:boolean;baseline:string};
const product=(s:LossStep)=>s.ProcessType==='Processing'||s.ProcessType==='Sorting';
const signature=(d:Pick<Draft,'steps'|'formula'|'grades'|'selections'|'costingInputs'>)=>JSON.stringify({steps:d.steps,formula:d.formula,grades:d.grades,selections:d.selections,costs:manualCostInputs(d.costingInputs)});
const label=(d:Draft)=>String(d.row.ItemNumber??d.row.ItemID)+' · '+d.row.ProductCode+' · '+d.row.ProductName;
const payload=(d:Draft)=>({RowVersion:d.version,Inputs:{ProductLossFormula:d.formula||null,LossProcesses:d.steps.map(s=>({...s,Sequence:Number(s.Sequence)}))}});
const commercialChanged=(d:Draft)=>JSON.stringify(d.grades)!==d.baselineGrades||JSON.stringify(d.selections)!==d.baselinePrices||JSON.stringify(manualCostInputs(d.costingInputs))!==d.baselineCosts;
const commercialPayload=(d:Draft)=>({...payload(d),...(JSON.stringify(d.grades)!==d.baselineGrades?{Grades:{items:d.grades}}:{}),Prices:d.selections,...(JSON.stringify(manualCostInputs(d.costingInputs))!==d.baselineCosts?{CostInputs:manualCostInputs(d.costingInputs)}:{})});
export function TCBReview({rows,onClose,onSaved}:{rows:Row[];onClose:()=>void;onSaved:(id:number,version:string)=>void}){
 const [analysis,setAnalysis]=useState(false);
 const [formulaResults,setFormulaResults]=useState<Record<number,string>>({});
 const [gradeLookups,setGradeLookups]=useState<{rows:RawGradeOption[];materials:RawMaterialOption[]}>({rows:[],materials:[]});
 useEffect(()=>{let active=true;call<{rows:RawGradeOption[];materials:RawMaterialOption[]}>('/api/opportunity/grade-lookups').then(r=>{if(active)setGradeLookups(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[]);
 const [drafts,setDrafts]=useState<Draft[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[review,setReview]=useState<{id:number;name:string;loss:string;rm?:string|null}[]|null>(null);
 useEffect(()=>{let active=true;
 const all=[...new Map(rows.filter(r=>r.ItemID).map(r=>[Number(r.ItemID),r])).values()],items:Row[]=[],seen=new Set<number>();
 const visit=(r:Row)=>{const id=Number(r.ItemID);if(seen.has(id))return;seen.add(id);items.push(r);all.filter(c=>Number(c.ParentItemID)===id).forEach(visit)};
 all.filter(r=>!r.ParentItemID||!all.some(p=>Number(p.ItemID)===Number(r.ParentItemID))).forEach(visit);all.forEach(visit);
 Promise.all(items.map(async row=>{
  const next=await call<{item:Row;saved:Record<string,unknown>;lossMasters:LossStep[];grades:TCBGrade[];prices:Row[]}>('/api/opportunity/items/'+row.ItemID+'/tcb');
  const inputs=objectValue(next.saved.Inputs) as TCBInputs,mix=!!next.item.IsMixParent,layers=Number(next.item.LossLayerCount??row.ResponseLayerCount??row.RequestedLayerCount??row.PackagingLayerCount??1);
  const old=migrateLossProcesses(inputs),totals=lossTotals(old);
  const steps=[...(!mix?old.filter(product).map((s,i)=>({...s,ProcessType:'Processing' as const,Sequence:i+1})):[]),...processOptions(mix,layers).filter(([t])=>t!=='Sorting'&&t!=='Processing').map(([t])=>({ProcessType:t,Sequence:1,LossPct:quantityDisplay(totals[t.replace('Packaging','LossPct') as keyof typeof totals],2).replaceAll(',','')}))];
  const grades=parseGradeSnapshot(next.item.ProductGradeSnapshot??row.ProductGradeSnapshot)?.items??[],selections=Array.isArray(inputs.Prices)?inputs.Prices:[];
  const d:Draft={grades,baselineGrades:JSON.stringify(grades),selections,baselinePrices:JSON.stringify(selections),quoteGrades:next.grades??[],quotes:next.prices??[],costingInputs:{...defaultInputs(),...inputs},baselineCosts:JSON.stringify(manualCostInputs({...defaultInputs(),...inputs})),pricingGradeKey:JSON.stringify(grades),gradeLocked:!!(next.item.HasOpenPackagingRequest??row.HasOpenPackagingRequest),row,version:String(next.item.RowVersion),mix,readonly:next.item.ItemStage!=='Draft'||next.item.HeaderStage!=='Draft',layers,masters:next.lossMasters??[],steps,formula:mix?'':String(inputs.ProductLossFormula??''),baseline:''};
  d.baseline=signature(d);return d;
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
 function setProduct(d:Draft,steps:LossStep[]){return {...d,steps:[...steps.map((s,i)=>({...s,ProcessType:'Processing' as const,Sequence:i+1})),...d.steps.filter(s=>!product(s))]}}
 function changeGrades(id:number,fn:(items:GradeItem[])=>GradeItem[]){update(id,d=>({...d,grades:fn(d.grades),selections:[]}))}
 async function loadPrices(d:Draft){
  setBusy(true);setError('');
  try{const result=await call<{grades:TCBGrade[];prices:Row[]}>('/api/opportunity/items/'+d.row.ItemID+'/commercial/preview',commercialPayload(d));setDrafts(ds=>ds.map(x=>x===d?{...x,quoteGrades:result.grades,quotes:result.prices,pricingGradeKey:JSON.stringify(x.grades)}:x))}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function prepare(){
  if(busy||validation||!changed.length)return;setBusy(true);setError('');
  try{const list=[];for(const d of changed){const commercial=commercialChanged(d);const result=await call<{LossProductPct:string;saved?:Record<string,unknown>}>('/api/opportunity/items/'+d.row.ItemID+(commercial?'/commercial/preview':'/loss-formula'),commercial?commercialPayload(d):payload(d));list.push({id:Number(d.row.ItemID),name:label(d),loss:d.mix?'':result.LossProductPct,rm:commercial?String(result.saved?.RMCostUSDPerLb??'Unpriced'):undefined})}setReview(list)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(busy||!review)return;setBusy(true);setError('');let saved=0;
  try{for(const entry of review){
   const d=drafts.find(d=>Number(d.row.ItemID)===entry.id)!;
   const commercial=commercialChanged(d);const result=await call<{RowVersion:string;saved?:Record<string,unknown>;snapshot?:unknown;grades?:TCBGrade[];prices?:Row[]}>('/api/opportunity/items/'+entry.id+(commercial?'/commercial':'/loss-processes'),commercial?commercialPayload(d):payload(d));
   setDrafts(ds=>ds.map(x=>{if(Number(x.row.ItemID)!==entry.id)return x;const grades=parseGradeSnapshot(result.snapshot)?.items??x.grades,costingInputs={...x.costingInputs,...objectValue(result.saved?.Inputs)} as TCBInputs,next={...x,grades,costingInputs,version:result.RowVersion,quoteGrades:result.grades??x.quoteGrades,quotes:result.prices??x.quotes,baselineGrades:JSON.stringify(grades),baselinePrices:JSON.stringify(x.selections),baselineCosts:JSON.stringify(manualCostInputs(costingInputs)),pricingGradeKey:JSON.stringify(grades)};return {...next,baseline:signature(next)}}));
   onSaved(entry.id,result.RowVersion);saved++;
  }setMessage('Saved '+(review.some(r=>r.rm!==undefined)?'item settings':'losses')+' for '+saved+' item(s).');setReview(null)}
  catch(e){setReview(null);setError('Saved '+saved+' item(s). Remaining changes are retained; retry after resolving: '+(e as Error).message)}
  finally{setBusy(false)}
 }
 async function showAnalysis(){
  if(busy||loading||review)return;setBusy(true);setError('');
  try{const entries=await Promise.all(drafts.filter(d=>!d.mix&&d.formula).map(async d=>{const result=await call<{LossProductPct:string}>('/api/opportunity/items/'+d.row.ItemID+'/loss-formula',payload(d));return [Number(d.row.ItemID),result.LossProductPct] as const}));setFormulaResults(results=>({...results,...Object.fromEntries(entries)}));setAnalysis(true)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function testFormula(d:Draft){
  if(busy||review)return;setBusy(true);setError('');
  const id=Number(d.row.ItemID);
  setFormulaResults(results=>{const next={...results};delete next[id];return next});
  try{const result=await call<{LossProductPct:string}>('/api/opportunity/items/'+id+'/loss-formula',payload(d));setFormulaResults(results=>({...results,[id]:result.LossProductPct}))}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 function renderProductLoss(d:Draft){
  const id=Number(d.row.ItemID),ps=d.steps.filter(product);
  const loss=productLossValue(d,formulaResults[id]);
  const result=loss?quantityDisplay(loss,6)+'%':'';
  return <section data-tcb-field="Losses" aria-label={'Product Loss item '+id}><h3>Product Loss</h3>
 <div className="table-scroll product-loss-scroll" role="region" aria-label={'Product loss processes item '+id} tabIndex={0}>
 <table className="product-loss-horizontal"><thead><tr><th scope="col"><div className="product-loss-code"><span>Loss code</span><IconButton icon="plus" label={'Add Product loss item '+id} disabled={d.readonly||busy||!!review||!d.masters.length||d.steps.length>=100} onClick={()=>update(id,x=>setProduct(x,[...ps,{...d.masters[0],LossPct:'0'}]))}/></div></th>{ps.map((_,i)=><th scope="col" key={i} aria-label={'L'+(i+1)}><div className="product-loss-code"><span>{'L'+(i+1)}</span><IconButton icon="close" label={'Remove Product loss item '+id+' row '+(i+1)} disabled={d.readonly||busy||!!review} onClick={()=>update(id,x=>setProduct(x,ps.filter((_,j)=>i!==j)))}/></div></th>)}</tr></thead><tbody>
 <tr><th scope="row">Loss type / Ratio (%)</th>{ps.map((s,i)=>{
 const key=(m:LossStep)=>m.MasterID?m.MasterID+':'+m.MasterVersion:'';
 const index=d.steps.indexOf(s),error=lossFieldIssues(d.steps,processOptions(d.mix,d.layers)).find(issue=>issue.index===index)?.message,errorId='tcb-loss-error-'+id+'-'+index;
 return <td key={i}><div className="product-loss-inputs"><select aria-label={'Loss type item '+id+' row '+(i+1)} disabled={d.readonly||busy||!!review} value={key(s)} onChange={e=>{const m=d.masters.find(m=>key(m)===e.target.value);if(m)update(id,x=>setProduct(x,ps.map((p,j)=>j===i?{...m,LossPct:p.LossPct}:p)))}}>
 {!d.masters.some(m=>key(m)===key(s))&&<option value={key(s)}>{s.ProcessName||s.ProcessType} (saved snapshot)</option>}{d.masters.map(m=><option key={key(m)} value={key(m)}>{m.ProcessName||m.ProcessType}</option>)}</select><span className="product-loss-ratio" data-tcb-field={'Loss:'+index}><input aria-invalid={!!error} aria-describedby={error?errorId:undefined} aria-label={'Product loss ratio item '+id+' row '+(i+1)} type="number" min="0" max="100" step="0.01" disabled={d.readonly||busy||!!review} value={s.LossPct} onChange={e=>update(id,x=>setProduct(x,ps.map((p,j)=>j===i?{...p,LossPct:e.target.value}:p)))}/>{error&&<small id={errorId} className="tcb-field-error">{error}</small>}</span></div></td>})}</tr>
 </tbody></table></div>
 <div className="product-loss-formula"><label><FieldLabel help="L1, L2, … follow left-to-right order. Variables are decimal ratios (3% becomes 0.03). The result is automatically multiplied by 100 for percentage display. Example: 1-(1-L1)*(1-L2). Use + - * / and parentheses. Blank uses sequential yields. Review formulas after removing rows.">Product Loss Formula</FieldLabel><input aria-label={'Product Loss Formula item '+id} maxLength={200} disabled={d.readonly||busy||!!review} value={d.formula} onChange={e=>update(id,x=>({...x,formula:e.target.value}))}/></label><button aria-label={'Test calculation item '+id} disabled={busy||!!review||!!lossError(d.steps,processOptions(d.mix,d.layers))} onClick={()=>testFormula(d)}>Test calculation</button><label className="product-loss-result"><FieldLabel help="Calculated from the Product loss formula, or sequential yields when the formula is blank. Test calculation uses the current loss ratios without saving.">Loss product (%)</FieldLabel><output aria-label={'Product Loss Formula result item '+id} aria-live="polite">{result}</output></label></div>
  </section>;
 }
 return <Modal label="TCB Review" className="dialog opportunity-loss-dialog" onClose={close}>
 <header className="customer-editor-heading"><div><h2>TCB Review</h2><div className="tcb-review-header-line"><p>{String(rows[0]?.OpportunityNumber??'')}</p>{drafts.some(d=>!d.mix)&&<IconButton icon={analysis?'left':'analysis'} label={analysis?'Back to TCB inputs':'Analysis'} aria-pressed={analysis} disabled={busy||loading||!!review} onClick={()=>analysis?setAnalysis(false):showAnalysis()}/>}</div></div><IconButton icon="close" label="Close TCB Review" disabled={busy} onClick={close}/></header>
 {error&&<p className="tcb-error-banner" role="alert">{error}</p>}
 {validationIssues.length>0&&<section className="tcb-validation-summary" role="region" aria-label="TCB validation summary"><h3>Check these fields before saving</h3><ul>{validationIssues.map((issue,index)=><li key={index}><button type="button" className="link" onClick={()=>focusIssue(issue.id,issue.field)}>{issue.name+': '+issue.message}</button></li>)}</ul></section>}
 {loading?<p role="status">Loading TCB Review…</p>:<>
 {analysis?<TCBAnalysis drafts={drafts} tested={formulaResults}/>:<>
 <OpportunityTCBTab drafts={drafts} lookups={gradeLookups} busy={busy} review={!!review} update={update} changeGrades={changeGrades} loadPrices={loadPrices} renderProductLoss={renderProductLoss}/></>}
 {review&&<section aria-label="Review Opportunity losses"><h3>Review changes</h3>{review.map(r=><p key={r.id}>{r.name+(r.loss?' · Product loss: '+r.loss+'%':' · Mix packaging losses')+(r.rm!==undefined?' · RM Cost: '+r.rm+(r.rm==='Unpriced'?'':' USD/lb'):'')}</p>)}<p>Changed items save individually. If a save fails, completed items remain saved and unsaved changes stay available to retry.</p></section>}
 {message&&<p role="status">{message}</p>}
 <div className="actions"><button disabled={busy} onClick={close}>Close</button>{review?<><button disabled={busy} onClick={()=>setReview(null)}>Back to editing</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></>:<button className="primary" disabled={busy||!!validation||!changed.length} onClick={prepare}>{busy?'Checking…':'Review & save'}</button>}</div>
 </>}
 </Modal>;
}
