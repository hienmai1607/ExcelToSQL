import {canRespondPackaging} from './packaging-access';
import {useSession} from './session';
import {useEffect,useState,useRef} from 'react';
import {call,type Row} from './api';
import {Modal,ErrorNote,InfoTip,Notification} from './ui';
import {ResponseSections,responseChange} from './response-sections';
import {prepareResponsePricing,activeResponsePricing} from './response-pricing';
import {IconButton} from './icons';
import {webResponseFields as responseFields,fieldValues,fieldPayload,responseFieldActive} from './packaging-fields';
import {useResponseTypes,responseTypeError,responseValues} from './response-input';
import {numericEntryError} from './numeric-input';
import {pricingResponseValues,type PricingCalculation} from './pkg-pricing';
import {containerProfileError} from './container-loading';import {isMixParent} from './packaging-orders';

export function PackagingResponse({row,onClose,onSaved}:{row:Row;onClose:()=>void;onSaved:()=>void}){
 const editable=canRespondPackaging(useSession(),row);
 const [values,setValues]=useState(()=>responseValues(row));
 const [pricing,setPricing]=useState<Record<string,PricingCalculation>>({});

 const responseTypes=useResponseTypes(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const [uncertain,setUncertain]=useState(false);
 const guard=useRef(false);
 const dirty=Object.keys(pricing).length>0||JSON.stringify(values)!==JSON.stringify(fieldValues(row,responseFields));
 function change(key:string,value:string){const next=responseChange(values,pricing,key,value,responseTypes.pallets,row.ConfigurationRequest,row);setValues(next.values);setPricing(next.pricing)}
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved response?')))onClose()}

 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty,busy]);
 async function review(){
  if(!editable)return;
  const profileError=containerProfileError(values,row.ConfigurationRequest,!!row.ParentItemID);if(profileError){setError(profileError);return}
  for(const f of responseFields){if(f.readOnly||!responseFieldActive(f.key,values,row.ConfigurationRequest,!!row.ParentItemID,isMixParent(row)))continue;const v=values[f.key];const typeError=responseTypeError(f.key,v,row[f.key],responseTypes.types,values.ResponseLayerCount,row.ResponseLayerCount??row.RequestedLayerCount,!!row.ParentItemID,isMixParent(row));if(typeError){setError(typeError);return}if(v&&f.numeric&&((numericEntryError(f.key,v))||(f.integer&&(!/^\d+$/.test(v)||Number(v)<=0)))){setError('Check '+f.label+'.');return}}


  setBusy(true);setError('');
  try{const prepared=await prepareResponsePricing(row,values,pricing,responseTypes.types);setValues(prepared.values);setPricing(prepared.pricing);setConfirm(true)}catch(err){setError((err as Error).message)}finally{setBusy(false)}
 }
 async function save(){
  if(guard.current)return;guard.current=true;setBusy(true);setError('');
  try{
   const existing=Object.fromEntries(['MaterialID','WidthMM','LengthMM','ResponseNotes'].map(k=>[k,row[k]??null]));
   const reply=await call<{results:Row[]}>('/api/packaging/response/batch',{rows:[{...existing,...fieldPayload(values,responseFields,row.ConfigurationRequest,!!row.ParentItemID,isMixParent(row)),RowNum:1,ID:row.ItemID,RowVersion:row.ItemRowVersion,...(Object.keys(pricing).length?{PricingCalculations:activeResponsePricing(values,pricing)}:{})}]});
   if(reply.results?.length!==1||reply.results[0].Status!=='OK')throw new Error(String(reply.results?.[0]?.Message||'Save outcome unknown. Close and refresh before retrying.'));
   onSaved();onClose();
  }catch(e){setError((e as Error).message);if(!(e as {status?:number}).status||(e as {status:number}).status>=500)setUncertain(true)}
  finally{setBusy(false);guard.current=false;setConfirm(false)}
 }
 return <Modal label="Packaging response" className="dialog opportunity-editor record-dialog" onClose={close}>
  <div className="customer-editor-heading"><h2>Packaging response — {row.ProductCode}<InfoTip text="You can save an incomplete response. Type and calculated MOQ are required for every confirmed layer before submission. Packing Way needs the unit count for every non-final layer; the final layer is fixed at 1."/></h2><IconButton icon="close" label="Close response" disabled={busy} onClick={close}/></div>

  <form className="record-dialog-form" onSubmit={e=>{e.preventDefault();review()}}>
   <div className="record-dialog-content"><ErrorNote value={error||responseTypes.error}/>
   <fieldset disabled={!editable||busy||uncertain}><ResponseSections values={values} requestedLayers={row.RequestedLayerCount} netWeight={row.WeightGrams} configuration={row.ConfigurationRequest} product={row} onChange={change} types={responseTypes.types} pallets={responseTypes.pallets} loading={responseTypes.loading} itemID={Number(row.ItemID)} pricing={pricing} onPricingApply={(input,result)=>{setPricing(xs=>({...xs,[input.PackagingOrder]:input}));setValues(xs=>({...xs,...pricingResponseValues(input,result)}))}}/></fieldset>

   </div><div className="actions record-action-bar"><button className="primary" disabled={!editable||busy||uncertain||!dirty}>Review & save</button></div>
  </form>
  {confirm&&<Modal label="Confirm response save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save this response?</h2><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 </Modal>
}
