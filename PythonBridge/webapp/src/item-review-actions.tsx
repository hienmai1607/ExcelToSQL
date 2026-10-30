import {groupVersions} from './request-families';
import {PackagingPeople} from './packaging-people';
import {canRespondPackaging} from './packaging-access';
import {useEffect,useRef,useState} from 'react';
import {call,ApiError,text,type Row} from './api';
import {useSession} from './session';
import {Badge,ErrorNote,InfoTip,Modal} from './ui';
import {IconButton} from './icons';

const editableStages=new Set(['Assigned','Working','Returned']);
export function ItemReviewActions({item,canAssign,user,pics,onSaved,refreshing=false,group}:{item:Row;group?:Row[];canAssign:boolean;user:string;pics:Row[];onSaved:()=>void;refreshing?:boolean}){
 const session=useSession(),guard=useRef(false);
 const [pic,setPic]=useState(String(item.PICUserID??''));
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const [target,setTarget]=useState<string|null>(null),[reason,setReason]=useState('');
 useEffect(()=>{setPic(String(item.PICUserID??''));setUncertain(false);setError('')},[item.ItemID,item.ItemRowVersion]);
 const members=group?.length?group:[item];
 const assigned=members.every(r=>Number(r.PICUserID)>0);
 const samePic=members.every(r=>String(r.PICUserID??'')===pic);
 const canRespond=members.every(r=>canRespondPackaging(session,r));
 const canSetPic=canAssign&&members.every(r=>editableStages.has(String(r.ItemStage)));
 const pending=canAssign&&members.every(r=>r.ItemStage==='Pending Review');
 const approve=pending&&(session.is_admin||members.every(r=>Number(r.PICUserID)!==session.user_id));
 const actions=(canRespond?['Pending Review']:[]).concat(approve?['Approved']:[],pending?['Returned']:[],assigned&&canAssign&&members.every(r=>!['Approved','Canceled'].includes(String(r.ItemStage)))?['Canceled']:[]);
 async function perform(assign=false){
  if(!assign&&!assigned&&['Pending Review','Canceled'].includes(String(target))){setError('Assign PIC before submitting or canceling this item.');return}
  if(guard.current||uncertain||refreshing)return;guard.current=true;setBusy(true);setError('');
  try{
   if(assign){
    const result=await call<{result:Row}>('/api/packaging/items/'+item.ItemID+'/assign',{PICUserID:Number(pic),ExpectedRowVersion:item.ItemRowVersion,...groupVersions(members)});
    if(!result.result?.RowVersion)throw new Error('Assignment outcome unknown. Refresh items before retrying.');
   }else await call('/api/packaging/items/'+item.ItemID+'/transition',{ExpectedRowVersion:item.ItemRowVersion,TargetStage:target,Comment:reason.trim()||null,...groupVersions(members)});
   setTarget(null);onSaved();
  }catch(e){setError((e as Error).message);if(!(e instanceof ApiError)||e.status===0||e.status>=500)setUncertain(true)}
  finally{guard.current=false;setBusy(false)}
 }
 return <div className="item-review" aria-label={'Review item '+item.ItemID}>
  <div className="item-review-top"><Badge value={item.ItemStage}/><InfoTip text="Assign PIC and review the parent together with all its children. Every member is validated and updated atomically. Save response edits before submitting."/></div>
  {canSetPic?<div className="item-review-assignment"><span className="item-review-pic">PIC:</span><select aria-label={'PIC for item '+item.ItemID} value={pic} disabled={busy||uncertain||refreshing} onChange={e=>setPic(e.target.value)}><option value="">Choose Packaging member</option>{pic&&!pics.some(p=>String(p.ID)===pic)&&<option value={pic} disabled>{text(item.PIC)} (unavailable)</option>}{pics.map(p=><option key={String(p.ID)} value={String(p.ID)}>{text(p.UserName)}</option>)}</select><IconButton icon="save" label={'Assign PIC for item '+item.ItemID} disabled={busy||uncertain||refreshing||samePic||!pics.some(p=>String(p.ID)===pic)} onClick={()=>perform(true)}/></div>:null}<PackagingPeople item={item} showPIC={!canSetPic}/>
  <div className="item-review-buttons">{actions.map(stage=><IconButton key={stage} icon={stage==='Returned'?'left':stage==='Canceled'?'close':stage==='Approved'?'check':'right'} label={(stage==='Pending Review'?'Submit':stage==='Approved'?'Approve':stage==='Returned'?'Return':'Cancel request item')+' '+item.ItemID} disabled={busy||uncertain||refreshing||pic!==String(item.PICUserID??'')} onClick={()=>{setTarget(stage);setReason('')}}/>)}</div>
  {!target&&<ErrorNote value={error}/>}{uncertain&&<InfoTip text="Outcome uncertain. Refresh items before making another change."/>}
  {target&&<Modal label="Confirm response action" onClose={()=>{if(!busy)setTarget(null)}}><ErrorNote value={error}/><h2>{target==='Canceled'?'Cancel request item?':'Change stage to '+target+'?'}</h2><p>{text(item.ProductCode)} · {text(item.ItemDescription)}{members.length>1&&' — includes all '+(members.length-1)+' child item(s). No partial updates.'}</p>{['Canceled','Returned'].includes(target)&&<label>Reason<textarea aria-label="Reason" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>}<div className="actions"><button disabled={busy} onClick={()=>setTarget(null)}>Back</button><button disabled={busy||uncertain||refreshing||(['Canceled','Returned'].includes(target)&&!reason.trim())} onClick={()=>perform()}>Confirm</button></div></Modal>}
 </div>;
}
