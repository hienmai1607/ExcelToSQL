import {useEffect,useState} from 'react';
import {api,type Row} from './api';
import {Modal,ErrorNote} from './ui';
import {IconButton} from './icons';
import {RequestEditor} from './request-editor';
import {useSession} from './session';

// Resolve through the authorized read, not an editable header assembled from the Opportunity grid.
export function LinkedPackagingRequestView({id,number,onClose}:{id:number;number:string;onClose:()=>void}){
 const session=useSession();
 const [request,setRequest]=useState<Row|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  let active=true;
  setRequest(null);setError('');
  async function load(){
   for(let page=1;active;page++){
    const result=await api.requests(page,50,number,'','[]');
    if(!active)return;
    const match=result.rows.find(row=>Number(row.RequestID)===id);
    if(match){setRequest(match);return}
    if(!result.rows.length||page*50>=result.total)break;
   }
   if(active)setError('This linked Packaging Request is no longer available. Refresh the Opportunity and try again.');
  }
  void load().catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[id,number,retry]);
 if(request)return <RequestEditor request={request} readOnly canAssign={false} user={session.username} onClose={onClose} onSaved={()=>{}}/>;
 return <Modal label="Packaging request view" className="dialog opportunity-editor record-dialog" onClose={onClose}>
  <header className="customer-editor-heading"><h2>{number}</h2><IconButton icon="close" label="Close request view" onClick={onClose}/></header>
  {error?<><ErrorNote value={error}/><button type="button" onClick={()=>setRetry(n=>n+1)}>Retry request</button></>:<p role="status">Loading Packaging Request…</p>}
 </Modal>;
}
