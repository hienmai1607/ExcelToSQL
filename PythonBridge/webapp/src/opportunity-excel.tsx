import {useState} from 'react';
import type {OpportunityView} from './opportunity-view';
import {IconButton} from './icons';
export function OpportunityExcel({entity='opportunity',header,items,page,pageSize,filters,disabled,onMessage,onError}:{entity?:'opportunity'|'packaging';header:OpportunityView;items:OpportunityView;page:number;pageSize:number;filters:Record<string,string>;disabled:boolean;onMessage:(s:string)=>void;onError:(s:string)=>void}){
 const [busy,setBusy]=useState(false);
 async function download(){
  setBusy(true);onError('');
  try{
   const headers:Record<string,string>={'Content-Type':'application/json'};
   const user=sessionStorage.getItem('bridge.testUser');if(user)headers['X-User-Name']=user;
   const response=await fetch('/api/workbench/'+entity+'-excel/download',{method:'POST',credentials:'same-origin',headers,
    body:JSON.stringify({views:{header:{...header,values:filters},items},page,page_size:pageSize})});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'Excel download failed ('+response.status+').')}
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
   link.href=url;link.download=entity==='packaging'?'Packaging_Request_Local_Update.xlsm':'Opportunity_Local_Update.xlsm';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
   onMessage('Downloaded combined Header / Item workbook. Use Controls for Save, Refresh, filters and pages. Enable macros only through your company-approved trust policy.');
  }catch(e){onError((e as Error).message)}finally{setBusy(false)}
 }
 return <IconButton icon="save" label="Excel Local Update" disabled={disabled||busy} onClick={download}/>;
}
