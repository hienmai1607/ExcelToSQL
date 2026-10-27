import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {packagingOrders,type PackagingOrder} from './packaging-orders';
import {objectValue} from './packaging-summary-model';
import type {CapturedDimension} from './response-dimensions';
import type {PricingCalculation,PricingResult} from './pkg-pricing';

export type CopiedSection={values:Record<string,string>;input?:PricingCalculation|null;result?:PricingResult|null;materials:Row[];dimensions?:CapturedDimension[];warnings:string[];SourceItemID:number;calculation?:Row|null};
type Reply={sections:Record<string,CopiedSection>};
type Draft={values:Record<string,string>;pricing:Record<string,PricingCalculation>;pricingResults:Record<string,PricingResult>};
export function clearCopiedSection(values:Record<string,string>,section:string){
 const setup=objectValue(values.ReferenceSetupJSON);
 delete setup[section];
 return {...values,ReferenceSetupJSON:JSON.stringify(setup)};
}
export function applyReference(draft:Draft,reply:Reply,start:number):Draft{
 const values:Record<string,string>={...draft.values,LoadPlanJSON:'',ContainerPlansJSON:'{}'},pricing={...draft.pricing},pricingResults={...draft.pricingResults};
 const setup=objectValue(values.ReferenceSetupJSON),tares=objectValue(values.LayerTareJSON);
 for(const [section,copied] of Object.entries(reply.sections)){
  Object.assign(values,copied.values);setup[section]={SourceItemID:copied.SourceItemID,input:copied.input,materials:copied.materials,dimensions:copied.dimensions,values:copied.values,calculation:copied.calculation};
  if(section==='Palletization')continue;
  const order=packagingOrders[packagingOrders.indexOf(section as PackagingOrder)-start+1];
  delete pricing[order];delete pricingResults[order];delete tares[order];
  if(copied.input&&copied.result){pricing[order]=copied.input;pricingResults[order]=copied.result}
 }
 values.LayerTareJSON=JSON.stringify(tares);values.ReferenceSetupJSON=JSON.stringify(setup);
 return {values,pricing,pricingResults};
}

export function CopyReference({itemID,start,layers,child,onClose,onApply}:{itemID:number;start:number;layers:number;child:boolean;onClose:()=>void;onApply:(reply:Reply)=>void}){
 const sections=[...packagingOrders.slice(start-1,start-1+layers),...(!child?['Palletization']:[])];
 const [rows,setRows]=useState<Row[]>([]),[search,setSearch]=useState(''),[all,setAll]=useState(true),[same,setSame]=useState(''),[choices,setChoices]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[preview,setPreview]=useState<Reply|null>(null);
 useEffect(()=>{let active=true;setLoading(true);const timer=window.setTimeout(()=>{
  call<{rows:Row[]}>('/api/packaging/items/'+itemID+'/copy-references?search='+encodeURIComponent(search)).then(d=>{if(active)setRows(d.rows)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});
 },200);return()=>{active=false;window.clearTimeout(timer)}},[itemID,search]);
 const has=(r:Row,section:string)=>Array.isArray(r.sections)&&r.sections.includes(section);
 const label=(r:Row)=>String(r.RequestNumber)+' / '+String(r.OpportunityNumber)+' · '+String(r.ProductCode)+' · '+String(r.ProductName??'');
 const selected=rows.find(r=>String(r.ID)===same);
 const selection=Object.fromEntries(sections.flatMap(section=>all?(selected&&has(selected,section)?[[section,Number(same)]]:[]):choices[section]?[[section,Number(choices[section])]]:[]));
 async function load(){setBusy(true);setError('');try{setPreview(await call<Reply>('/api/packaging/items/'+itemID+'/copy-references/preview',{LayerCount:layers,sections:selection}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <Modal label="Copy reference" className="dialog pkg-pricing-dialog packaging-reference-dialog" onClose={()=>{if(!busy)onClose()}}>
  <header className="customer-editor-heading"><h2>Copy reference</h2><IconButton icon="close" label="Close copy reference" disabled={busy} onClick={onClose}/></header>
  <ErrorNote value={error}/>
  <p>Copy configuration, dimensions and materials. Current applicable prices are recalculated; unavailable prices remain blank. Original references and pricing history are unchanged.</p>
  <label>Find reference<input aria-label="Find packaging reference" value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setPreview(null)}} placeholder="Request, opportunity or product"/></label>
  <label className="reference-copy-toggle"><input type="checkbox" checked={all} disabled={busy} onChange={e=>{setAll(e.target.checked);setPreview(null)}}/>Use one reference for all available sections</label>
  {all?<label>Reference for all sections<select aria-label="Reference for all sections" value={same} disabled={busy||loading} onChange={e=>{setSame(e.target.value);setPreview(null)}}><option value="">Choose a reference</option>{rows.map(r=><option key={String(r.ID)} value={String(r.ID)}>{label(r)}</option>)}</select></label>:<div className="pricing-entry-grid">{sections.map(section=><label key={section}>{section}<select aria-label={section+' reference'} value={choices[section]??''} disabled={busy||loading} onChange={e=>{setChoices({...choices,[section]:e.target.value});setPreview(null)}}><option value="">Do not copy this section</option>{rows.filter(r=>has(r,section)).map(r=><option key={String(r.ID)} value={String(r.ID)}>{label(r)}</option>)}</select></label>)}</div>}
  {all&&selected&&<p>Will copy: {sections.filter(s=>has(selected,s)).join(', ')||'No matching sections'}. Other sections remain unchanged.</p>}
  {loading&&<p>Loading references…</p>}
  {preview&&<section className="panel reference-copy-preview" aria-label="Reference copy preview">{Object.entries(preview.sections).map(([section,copied])=><div key={section}><h3>{section}</h3><p>{copied.materials.map(m=>String(m.MaterialCode)+' — '+String(m.MaterialName)+(m.UnitPrice==null?' (price blank)':'')).join('; ')||'No captured materials'}</p>{copied.warnings.map((w,i)=><p role="status" key={i}>{w}</p>)}</div>)}</section>}
  <div className="actions"><button disabled={busy||loading||!Object.keys(selection).length} onClick={load}>Preview copy</button><button className="primary" disabled={busy||!preview} onClick={()=>{if(preview)onApply(preview)}}>Copy to response</button><button disabled={busy} onClick={onClose}>Cancel</button></div>
 </Modal>;
}
