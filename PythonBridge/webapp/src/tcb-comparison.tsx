import {useEffect,useState} from 'react';
import {call,type Row} from './api';
import {Modal} from './ui';
import {IconButton} from './icons';
import type {Draft} from './opportunity-losses';
import {contextDrafts,draftFromTCB,type ComparisonReply,type VersionReply} from './tcb-draft';
import {buildTCBAnalysis} from './tcb-analysis-model';
import {TCBCostTable,type TCBCostColumn} from './tcb-analysis';
export function TCBComparison({mode,drafts,onClose}:{mode:'versions'|'items';drafts:Draft[];onClose:()=>void}){
 const [item,setItem]=useState(String(drafts.find(d=>!d.mix)?.row.ItemID??drafts[0]?.row.ItemID??'')),[columns,setColumns]=useState<TCBCostColumn[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[choices,setChoices]=useState<Row[]>([]),[selected,setSelected]=useState('');
 const title=mode==='versions'?'Compare TCB versions':'Compare opportunity items';
 function fromContext(reply:ComparisonReply,itemID:number,key:string,label:string,active=false){
  return buildTCBAnalysis(contextDrafts(reply)).flatMap((s,si)=>s.columns.filter(c=>c.id===itemID).map(c=>({key:key+':'+si,label:label+' · '+s.label,currency:s.currency,cells:c.cells,active})));
 }
 useEffect(()=>{let live=true;if(!item)return;setLoading(true);setError('');setColumns([]);
  (async()=>{
   const list=await call<{versions:VersionReply[]}>('/api/opportunity/items/'+item+'/tcb-version-comparison'),result:TCBCostColumn[]=[];
   for(const reply of (list.versions??[]).filter(r=>mode==='versions'||r.version.IsActive)){
    if(!live)return;
    const v=reply.version;
    const own=reply.rows.find(r=>Number(r.ItemID)===Number(item))??drafts.find(d=>String(d.row.ItemID)===item)!.row;
    const ownDraft=draftFromTCB(own,reply.tcb,v);
    // Include captured Mix parent/siblings for allocation, then replace this item's approach.
    const captured=reply.rows.filter(r=>r.TCBContext).map(r=>draftFromTCB(r,r.TCBContext!));
    const related=captured.length?captured.map(d=>Number(d.row.ItemID)===Number(item)?ownDraft:d):[ownDraft];
    for(const s of buildTCBAnalysis(related))for(const c of s.columns.filter(c=>c.id===Number(item)||ownDraft.mix&&related.some(d=>Number(d.row.ItemID)===c.id&&Number(d.row.ParentItemID)===Number(item))))
     result.push({key:(mode==='items'?'baseline:':'')+v.ID+':'+c.id+':'+s.label,label:(mode==='items'?own.OpportunityNumber+' · '+own.ProductCode+' · '+own.ProductName+' · ':'')+'V'+v.Version+' · '+v.Name+' · '+(ownDraft.mix?c.label+' · ':'')+s.label,currency:s.currency,cells:c.cells,active:v.IsActive});
   }
   if(live)setColumns(result);
  })().catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[mode,item]);
 async function find(){
  setLoading(true);setError('');try{const r=await call<{rows:Row[]}>('/api/opportunity/tcb-comparison/items?search='+encodeURIComponent(search));setChoices(r.rows??[]);setSelected('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}
 }
 async function add(){
  if(!selected||selected===item||!columns.some(c=>c.active))return;setLoading(true);setError('');
  try{
   const choice=choices.find(r=>String(r.ItemID)===selected)!;
   const reply=await call<ComparisonReply>('/api/opportunity/items/'+selected+'/tcb-comparison');
   const label=String(choice.OpportunityNumber)+' · '+choice.ProductCode+' · '+choice.ProductName;
   const next=fromContext(reply,Number(selected),'item:'+selected,label);
   if(!next.length)throw new Error('This item has no comparable standalone or child analysis.');
   setColumns(old=>[...old.filter(c=>!c.key.startsWith('item:'+selected+':')),...next]);
  }catch(e){setError((e as Error).message)}finally{setLoading(false)}
 }
 return <Modal label={title} className="dialog opportunity-loss-dialog" onClose={onClose}>
  <header className="customer-editor-heading"><h2>{title}</h2><IconButton icon="close" label={'Close '+title} onClick={onClose}/></header>
  {mode==='versions'?<label>Opportunity item<select aria-label="Compare versions for item" value={item} disabled={loading} onChange={e=>setItem(e.target.value)}>{drafts.map(d=><option key={String(d.row.ItemID)} value={String(d.row.ItemID)}>{d.row.ProductCode+' · '+d.row.ProductName}</option>)}</select></label>:
   <div className="tcb-comparison-picker"><label>Opportunity, product or customer<input aria-label="Find comparison item" maxLength={120} value={search} onChange={e=>setSearch(e.target.value)}/></label><button disabled={loading} onClick={find}>Search items</button>
    <label>Item<select aria-label="Comparison item" value={selected} disabled={loading} onChange={e=>setSelected(e.target.value)}><option value="">Choose opportunity item</option>{choices.map(r=><option key={String(r.ItemID)} value={String(r.ItemID)} disabled={String(r.ItemID)===item}>{r.OpportunityNumber+' · '+r.ProductCode+' · '+r.ProductName}</option>)}</select></label><button disabled={loading||!selected||selected===item||!columns.some(c=>c.active)} onClick={add}>Add comparison</button>
   </div>}
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Loading comparison…</p>}
  <p>Saved approaches, per smallest product unit. Each column retains its own container and currency. Comparing or removing a column does not change any item.</p>
  {columns.length?<TCBCostTable name={title} columns={columns.map(c=>({...c,onRemove:mode==='items'&&!c.active?()=>setColumns(old=>old.filter(x=>x.key!==c.key)):undefined}))}/>:!loading&&<p>No comparison columns yet.</p>}
 </Modal>;
}
