import {useEffect,useRef,useState} from 'react';
import {api,call,ApiError,text,type Row} from './api';
import {useSession} from './session';
import {Badge,ErrorNote,InfoTip,Modal,Notification} from './ui';
import {IconButton} from './icons';

const editableStages=new Set(['Assigned','Working','Returned']);
export function ItemReviewActions({item,canAssign,user,pics,onSaved}:{item:Row;canAssign:boolean;user:string;pics:Row[];onSaved:()=>void}){
 const session=useSession(),guard=useRef(false);
 const [pic,setPic]=useState(String(item.PICUserID??''));
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [target,setTarget]=useState<string|null>(null),[reason,setReason]=useState('');
 useEffect(()=>{setPic(String(item.PICUserID??''));setUncertain(false);setError('')},[item.ItemID,item.ItemRowVersion]);
 const assigned=Number(item.PICUserID)>0;
 const canRespond=assigned&&editableStages.has(String(item.ItemStage))&&(session.is_admin||(session.scopes.includes('Packaging')&&item.PIC===user));
 const canSetPic=canAssign&&editableStages.has(String(item.ItemStage));
 const actions=(canRespond?['Pending Review']:[]).concat(canAssign&&item.ItemStage==='Pending Review'?['Approved','Returned']:[],assigned&&canAssign&&!['Approved','Canceled'].includes(String(item.ItemStage))?['Canceled']:[]);
 async function perform(assign=false){
  if(!assign&&!assigned&&['Pending Review','Canceled'].includes(String(target))){setError('Assign PIC before submitting or canceling this item.');return}
  if(guard.current||uncertain)return;guard.current=true;setBusy(true);setError('');
  try{
   if(assign){
    const result=await api.assign(item,Number(pic));
    if(!result.result?.RowVersion)throw new Error('Assignment outcome unknown. Refresh items before retrying.');
   }else await call('/api/packaging/items/'+item.ItemID+'/transition',{ExpectedRowVersion:item.ItemRowVersion,TargetStage:target,Comment:reason.trim()||null});
   setMessage(assign?'PIC assigned.':'Stage updated.');setTarget(null);onSaved();
  }catch(e){setError((e as Error).message);if(!(e instanceof ApiError)||e.status===0||e.status>=500)setUncertain(true)}
  finally{guard.current=false;setBusy(false)}
 }
 return <div className="item-review" aria-label={'Review item '+item.ItemID}>
  <div className="item-review-top"><Badge value={item.ItemStage}/><InfoTip text="Assign PIC and review this item here. Submit and Cancel are available after the assignment is saved. Open its Product ID to edit the response."/></div>
  {canSetPic?<div className="item-review-assignment"><select aria-label={'PIC for item '+item.ItemID} value={pic} disabled={busy||uncertain} onChange={e=>setPic(e.target.value)}><option value="">Choose a person</option>{pic&&!pics.some(p=>String(p.ID)===pic)&&<option value={pic}>{text(item.PIC)}</option>}{pics.map(p=><option key={String(p.ID)} value={String(p.ID)}>{text(p.UserName)}</option>)}</select><IconButton icon="save" label={'Assign PIC for item '+item.ItemID} disabled={busy||uncertain||pic===String(item.PICUserID??'')||!pics.some(p=>String(p.ID)===pic)} onClick={()=>perform(true)}/></div>:<span className="item-review-pic">{text(item.PIC)||'Unassigned'}</span>}
  <div className="item-review-buttons">{actions.map(stage=><IconButton key={stage} icon={stage==='Returned'?'left':stage==='Canceled'?'close':stage==='Approved'?'check':'right'} label={(stage==='Pending Review'?'Submit':stage==='Approved'?'Approve':stage==='Returned'?'Return':'Cancel request item')+' '+item.ItemID} disabled={busy||uncertain||pic!==String(item.PICUserID??'')} onClick={()=>{setTarget(stage);setReason('')}}/>)}</div>
  {!target&&<ErrorNote value={error}/>}<Notification value={message} onDismiss={()=>setMessage('')}/>{uncertain&&<InfoTip text="Outcome uncertain. Refresh items before making another change."/>}
  {target&&<Modal label="Confirm response action" onClose={()=>{if(!busy)setTarget(null)}}><ErrorNote value={error}/><h2>{target==='Canceled'?'Cancel request item?':'Change stage to '+target+'?'}</h2><p>{text(item.ProductCode)} · {text(item.ItemDescription)}</p>{['Canceled','Returned'].includes(target)&&<label>Reason<textarea aria-label="Reason" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}<div className="actions"><button disabled={busy} onClick={()=>setTarget(null)}>Back</button><button disabled={busy||uncertain||(['Canceled','Returned'].includes(target)&&!reason.trim())} onClick={()=>perform()}>Confirm</button></div></Modal>}
 </div>;
}
