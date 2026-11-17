import {useState} from 'react';
import {call,type Row} from './api';
import {IconButton} from './icons';
import {Modal,ErrorNote,FieldLabel} from './ui';

/** Copy another item's information into this line. The line keeps its own Product. */
export function ItemInfoCopy({number,sources,disabled,onCopy}:{number:string;sources:{key:number;label:string}[];disabled?:boolean;onCopy:(key:number)=>void}){
 const [open,setOpen]=useState(false),[source,setSource]=useState('');
 return <><IconButton icon="copy" label={'Copy information into item '+number} disabled={disabled||!sources.length} onClick={()=>{setSource('');setOpen(true)}}/>
 {open&&<Modal className="dialog packaging-copy-dialog" label="Copy item information" onClose={()=>setOpen(false)}>
  <header className="copy-dialog-heading"><h2>Copy into Item {number}</h2><IconButton icon="close" label="Close copy popup" onClick={()=>setOpen(false)}/></header>
  <label><FieldLabel help="Replaces Product info (annual units, award %, shelf price), Packaging requirements and Shipment, Logistics & Others with the chosen item's values. This item keeps its Product; grades are not copied. Locked sections stay unchanged.">Copy from item</FieldLabel>
  <select aria-label="Copy information from item" value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose item</option>{sources.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
  <div className="actions"><button type="button" className="primary" disabled={!source} onClick={()=>{onCopy(Number(source));setOpen(false)}}>Copy information</button></div>
 </Modal>}</>;
}

/** Copy all items of another Opportunity of the same Customer into this (unsaved) form. */
export function OpportunityItemsCopy({customerID,customerName,currentID,disabled,onCopy}:{customerID:string;customerName:string;currentID?:unknown;disabled?:boolean;onCopy:(rows:Row[],label:string)=>void}){
 const [open,setOpen]=useState(false),[groups,setGroups]=useState<{id:string;label:string;rows:Row[]}[]|null>(null),[source,setSource]=useState(''),[error,setError]=useState('');
 async function load(){
  setOpen(true);setSource('');setError('');setGroups(null);
  try{
   const data=await call<{rows:Row[]}>('/api/opportunity/grid?'+new URLSearchParams({customer_name:customerName,page_size:'500'}));
   const byOpportunity=new Map<string,Row[]>();
   // The customer filter is a name prefix; keep only this exact Customer and other Opportunities.
   for(const row of data.rows)if(String(row.CustomerID)===customerID&&String(row.OpportunityID)!==String(currentID??''))byOpportunity.set(String(row.OpportunityID),[...(byOpportunity.get(String(row.OpportunityID))??[]),row]);
   setGroups([...byOpportunity].map(([id,rows])=>({id,rows,label:String(rows[0].OpportunityNumber)+' · '+String(rows[0].OpportunityDesc??'')+' ('+rows.filter(r=>r.ItemID!=null&&!r.ParentItemID).length+' items)'})).filter(g=>g.rows.some(r=>r.ItemID!=null)));
  }catch(e){setError((e as Error).message);setGroups([])}
 }
 const chosen=groups?.find(g=>g.id===source);
 return <><IconButton icon="copy" label="Copy items from another Opportunity" disabled={disabled||!customerID} onClick={()=>void load()}/>
 {open&&<Modal className="dialog packaging-copy-dialog" label="Copy items from Opportunity" onClose={()=>setOpen(false)}>
  <header className="copy-dialog-heading"><h2>Copy items from Opportunity</h2><IconButton icon="close" label="Close copy popup" onClick={()=>setOpen(false)}/></header>
  <ErrorNote value={error}/>
  <label><FieldLabel help="Adds every item of the chosen Opportunity (Mix products with their children) with Product info, Packaging requirements and Shipment, Logistics & Others. Products already in this Opportunity are skipped. Nothing is saved until you review and save.">Opportunity of {customerName}</FieldLabel>
  <select aria-label="Copy items from Opportunity" disabled={!groups} value={source} onChange={e=>setSource(e.target.value)}><option value="">{groups?(groups.length?'Choose Opportunity':'No other Opportunities for this Customer'):'Loading…'}</option>{groups?.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
  <div className="actions"><button type="button" className="primary" disabled={!chosen} onClick={()=>{onCopy(chosen!.rows,String(chosen!.rows[0].OpportunityNumber));setOpen(false)}}>Copy items</button></div>
 </Modal>}</>;
}
