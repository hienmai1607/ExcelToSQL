import {useRef,useState,type FormEvent} from 'react';
import {ApiError,date,text,type Row} from './api';
import {DateInput} from './date-input';
import {parseDate} from './date-format';
import {parseGradeSnapshot} from './opportunity-grade-snapshot';
import {LinkedRecipeRecord} from './npd';
import {useSession} from './session';
import {pageAccess} from './workspace-access';
import {npd} from './npd-model';
import {Badge,Notification} from './ui';
type RequestPayload={CreationKey:string;RequestDue:string;RequestNote:string|null;Items:{OpportunityItemID:number;RowVersion:string}[]};
export function OpportunityRecipeRequests({items,onSaved,canWrite}:{canWrite:boolean;items:Row[];onSaved:()=>void}){
 const session=useSession(),[linked,setLinked]=useState<{kind:'request'|'sheet';id:number;focusItem?:number}|null>(null);
 const [checked,setChecked]=useState<number[]>([]),[due,setDue]=useState(''),[notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState<RequestPayload|null>(null);
 const posting=useRef(false);
 const enabled=(row:Row)=>!!parseGradeSnapshot(row.ProductGradeSnapshot)?.RequiresRecipeConfirmation;
 const selectable=(row:Row)=>canWrite&&enabled(row)&&!row.HasLinkedRecipeRequest&&row.ItemStage==='Draft'&&row.HeaderStage==='Draft';
 const selected=items.filter(row=>checked.includes(Number(row.ItemID))&&selectable(row));
 const frozen=busy||!!pending,count=pending?.Items.length??selected.length;
 async function create(event:FormEvent){
  event.preventDefault();if(posting.current||!canWrite||!pending&&(!selected.length||!parseDate(due)))return;
  const body=pending??{CreationKey:crypto.randomUUID(),RequestDue:parseDate(due)!,RequestNote:notes.trim()||null,Items:selected.map(row=>({OpportunityItemID:Number(row.ItemID),RowVersion:String(row.ItemRowVersion??row.RowVersion)}))};
  posting.current=true;setBusy(true);setError('');setNotice('');setPending(body);
  try{
   const result=await npd.save('requests',body);
   setChecked([]);setDue('');setNotes('');setPending(null);
   setNotice(String(result.row.RequestNumber)+' created. Grades and Recipe requirements are now locked.');onSaved();
  }catch(exc){
   const uncertain=!(exc instanceof ApiError)||exc.status===0||exc.status===408||exc.status>=500;
   setError((exc instanceof Error?exc.message:'Could not create the Recipe Request.')+(uncertain?' Retry creation to recover the same request.':''));
   if(!uncertain)setPending(null);
  }finally{posting.current=false;setBusy(false)}
 }
 return <section className="panel opportunity-recipe-request" aria-busy={busy}>
  <Notification value={notice}/><Notification value={error} error/>
  <div className="table-wrap"><table aria-label="Opportunity Recipe Request items"><thead><tr><th>Select</th><th>Item</th><th>Product</th><th>Recipe confirmation</th><th>Launching date</th><th>Special comments</th><th>Linked Recipe Request</th><th>Linked Recipe Sheet</th></tr></thead><tbody>{items.map(row=>{
   const grade=parseGradeSnapshot(row.ProductGradeSnapshot),id=Number(row.ItemID);
   return <tr key={id}><td><input type="checkbox" aria-label={'Select recipe item '+id} disabled={frozen||!selectable(row)} checked={checked.includes(id)} onChange={e=>setChecked(ids=>e.target.checked?[...ids,id]:ids.filter(i=>i!==id))}/></td><td>{text(row.ItemNumber)}</td><td>{text(row.ProductCode)} · {text(row.ProductName)}</td><td><Badge value={enabled(row)?'Required':'Not require'}/></td><td>{date(grade?.RecipeRequirements?.LaunchingDate)}</td><td>{text(grade?.RecipeRequirements?.SpecialComments)}</td><td>{Number(row.RecipeRequestID)>0&&pageAccess(session,'recipe-requests')?<button className="record-link" aria-label={'View Recipe Request '+row.RecipeRequestNumber+' for item '+id} onClick={()=>setLinked({kind:'request',id:Number(row.RecipeRequestID),focusItem:Number(row.RecipeRequestItemID)||undefined})}>{text(row.RecipeRequestNumber)}</button>:text(row.RecipeRequestNumber)}</td><td>{Number(row.RecipeSheetID)>0&&pageAccess(session,'recipe-sheets')?<button className="record-link" aria-label={'View Recipe Sheet '+row.RecipeSheetNumber+' for item '+id} onClick={()=>setLinked({kind:'sheet',id:Number(row.RecipeSheetID)})}>{text(row.RecipeSheetNumber)}</button>:text(row.RecipeSheetNumber)}</td></tr>;
  })}</tbody></table></div>
  {canWrite&&<form className="request-form recipe-request-form" aria-label="Create Recipe Request" onSubmit={create}>
   <label>Response due<DateInput aria-label="Response due" required disabled={frozen} value={due} onValueChange={setDue}/></label>
   <label className="grow">Request notes<textarea aria-label="Request notes" rows={1} maxLength={2000} placeholder="Context for the NPD team" disabled={frozen} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <button className="primary" disabled={busy||!count||!pending&&!parseDate(due)}>{busy?'Creating…':pending?'Retry creation':`Create Recipe Request (${count})`}</button>
  </form>}
 {linked&&<LinkedRecipeRecord key={linked.kind+':'+linked.id} {...linked} onClose={()=>setLinked(null)}/>}
 </section>;
}
