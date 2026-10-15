import type {PalletPricing} from './pallet-calculator';
import {useEffect,useMemo,useRef,useState} from 'react';
import {call} from './api';
import {Modal,ErrorNote} from './ui';
import {NumericInput} from './numeric-input';
import {decimalDisplay} from './number-format';
import {IconButton} from './icons';
import {LoadScene,type Box3D} from './load-scene';
import type {ContainerRecord} from './container-master';
type D={length:number;width:number;height:number};
type Position={x:number;y:number;length:number;width:number};
type Result={pallet_layer:Position[];pallet_layers:number;cartons_per_pallet:number;container_layer:Position[];loaded_units:number;floor_positions:number;cartons:number;loaded_unit_height:number;gross_kg:number|null;volume_percent:number;warnings:string[]};
type Inputs={cartons_per_layer?:number|null;weight_source?:'manual'|'response';mode:'pallet'|'floor';carton:D;carton_kg:number|null;pallet:D|null;pallet_kg:number|null;max_pallet_height:number|null;pallet_payload_kg:number|null;container:D;rotate:boolean;double_stack:boolean;stackable:boolean};
type Preview={Inputs:Inputs;Result:Result};
type CachedPreview={data?:Preview;error?:string};
function normalized(v:Inputs):Inputs{
 const dims=(d:D|null)=>d?Object.fromEntries(Object.entries(d).map(([k,n])=>[k,Number(n)])) as D:null;
 return {...v,carton:dims(v.carton)!,container:dims(v.container)!,pallet:dims(v.pallet)};
}
export function LoadPlanner({itemID,itemVersion,configuration,initial,initialCode,responsePallet,palletAssembly,onConfirm,onClear,onClose}:{itemID:number;itemVersion:string;configuration:unknown;initial:Partial<Inputs>;initialCode?:string;responsePallet?:{cartons:number;grossKG:number|null;loadedHeight:number|null};palletAssembly?:PalletPricing|null;onConfirm?:(plan:unknown)=>void;onClear?:()=>void;onClose:()=>void}){
 const allowedModes:Inputs['mode'][]=configuration==='Both'?['pallet','floor']:configuration==='Floor load'?['floor']:['pallet'];
 const defaults:Inputs={weight_source:'response',carton:{length:0,width:0,height:0},carton_kg:null,pallet:{length:0,width:0,height:0},pallet_kg:null,max_pallet_height:null,pallet_payload_kg:null,container:{length:0,width:0,height:0},rotate:true,double_stack:false,stackable:false,...initial,mode:initial.mode&&allowedModes.includes(initial.mode)?initial.mode:allowedModes[0],...(palletAssembly?{pallet:Object.fromEntries(Object.entries(palletAssembly.Dimensions).map(([k,v])=>[k,Number(v)])) as D,pallet_kg:palletAssembly.TareKG==null?null:Number(palletAssembly.TareKG)}:{})};

 const [base,setBase]=useState<Inputs>(defaults),[mode,setMode]=useState<Inputs['mode']>(defaults.mode);
 const [containers,setContainers]=useState<ContainerRecord[]>([]),[containerID,setContainerID]=useState('');
 const [previews,setPreviews]=useState<Record<string,CachedPreview>>({}),[retry,setRetry]=useState(0);
 const [error,setError]=useState(''),[lookupErrors,setLookupErrors]=useState<string[]>([]),[weightsLoaded,setWeightsLoaded]=useState(false),[busy,setBusy]=useState(false);
 const requestPending=useRef(false);
 const container=containers.find(c=>String(c.ID)===containerID);
 const key=mode+':'+containerID,entry=previews[key];
 const inputs=useMemo(()=>entry?.data?normalized(entry.data.Inputs):{...base,mode,container:container?{length:Number(container.Specifications.length),width:Number(container.Specifications.width),height:Number(container.Specifications.height)}:base.container},[entry?.data,base,mode,container]);
 const result=entry?.data?.Result??null;
 const ready=weightsLoaded&&base.carton_kg!=null&&(mode==='floor'||!!palletAssembly&&!!base.cartons_per_layer&&!!base.max_pallet_height);
 useEffect(()=>{
  let active=true;
  async function lookup<T>(path:string,label:string,fallback:T):Promise<T>{
   try{return await call<T>(path)}catch(e){if(active)setLookupErrors(v=>[...v,label+': '+(e as Error).message]);return fallback}
  }
  setLookupErrors([]);setWeightsLoaded(false);setPreviews({});setMode(defaults.mode);
  Promise.all([
   lookup<{rows:ContainerRecord[]}>('/api/load-planning/containers','Container types',{rows:[]}),
   lookup<{CartonGrossWeightKG:string|null;FinalCartonDimensions?:D|null}|null>('/api/load-planning/items/'+itemID+'/weights','Carton gross weight',null)
  ]).then(([c,w])=>{
   if(!active)return;
   const rows=c.rows.filter(c=>c.Status==='Active');
   setContainers(rows);
   if(!rows.length)setLookupErrors(v=>[...v,'No active container types are available. Ask Admin to maintain Container Type Master.']);
   setBase(normalized({...defaults,rotate:true,carton:w?.FinalCartonDimensions??defaults.carton,carton_kg:w?.CartonGrossWeightKG==null?null:Number(w.CartonGrossWeightKG)}));
   setContainerID(String((rows.find(c=>c.Code===initialCode)??rows[0])?.ID??''));
   setWeightsLoaded(true);
  });
  return()=>{active=false}
 },[itemID,configuration]);
 useEffect(()=>{
  if(!ready)return;
  let active=true;
  // Cache by container and required loading mode. Changing the selected row does
  // not restart the batch; stale mode responses cannot replace the active view.
  const queue=[...containers].sort((a,b)=>Number(String(b.ID)===containerID)-Number(String(a.ID)===containerID)).filter(c=>!previews[mode+':'+c.ID]);
  async function worker(){
   while(active&&queue.length){
    const c=queue.shift()!,cacheKey=mode+':'+c.ID;
    try{
     const data=await call<Preview>('/api/load-planning/items/'+itemID+'/preview',{ContainerID:c.ID,ContainerRowVersion:c.RowVersion,Inputs:{...base,mode,rotate:true,container:{length:Number(c.Specifications.length),width:Number(c.Specifications.width),height:Number(c.Specifications.height)}}});
     if(data.Inputs.mode!==mode)throw new Error('Loading mode does not match the request requirement. Refresh the viewer.');
     if(active)setPreviews(v=>({...v,[cacheKey]:{data}}));
    }catch(e){if(active)setPreviews(v=>({...v,[cacheKey]:{error:(e as Error).message}}))}
   }
  }
  // Debounce quick mode changes and bound background comparisons to two calls.
  const timer=window.setTimeout(()=>{void worker();void worker()},150);
  return()=>{active=false;window.clearTimeout(timer)}
 },[containers,base,mode,ready,retry,itemID]);
 function selectContainer(id:string){setContainerID(id);setError('')}
 function retryPreview(c:ContainerRecord){setPreviews(v=>{const next={...v};delete next[mode+':'+c.ID];return next});setRetry(v=>v+1);setError('')}
 async function confirmPreview(){
  if(!container||!result||requestPending.current)return;
  requestPending.current=true;setBusy(true);setError('');
  try{
   const response=await call<Preview & {ID:number}>('/api/load-planning/items/'+itemID+'/save',{ContainerID:container.ID,ContainerRowVersion:container.RowVersion,Inputs:inputs,ItemRowVersion:itemVersion});
   if(response.Inputs.mode!==mode)throw new Error('Loading mode does not match the request requirement. Refresh the viewer.');
   if(!response.ID)throw new Error('Confirmation returned no saved setup. Reopen the viewer before retrying.');
   onConfirm?.({...response,ContainerID:container.ID,Code:container.Code});onClose();
  }catch(e){
   const message=(e as Error).message;setError(message);setPreviews(v=>({...v,[key]:{error:message}}));
  }finally{requestPending.current=false;setBusy(false)}
 }
 const boxes=useMemo(()=>{
  if(!result)return [];const all:Box3D[]=[];
  for(let n=0;n<Math.min(result.loaded_units,2501);n++){
   const p=result.container_layer[n%result.container_layer.length];if(!p)break;
   const z=Math.floor(n/result.container_layer.length)*result.loaded_unit_height;
   if(inputs.mode==='pallet'&&inputs.pallet){all.push({...p,z,height:inputs.pallet.height,color:'#ab845b'});all.push({...p,z:z+inputs.pallet.height,height:result.loaded_unit_height-inputs.pallet.height,color:'#499d91'})}
   else all.push({...p,z,height:inputs.carton.height,color:'#499d91'});
  }return all;
 },[result,inputs]);

 const dimensions=()=><div className="load-input-grid">{(['length','width','height'] as const).map(axis=><label key={axis}>{axis[0].toUpperCase()+axis.slice(1)} (mm)<NumericInput field="MaterialD1" aria-label={'carton '+axis} readOnly value={String(inputs.carton[axis]??'')} onValueChange={()=>{}}/></label>)}</div>;
 const palletCartons=result?.cartons_per_pallet??responsePallet?.cartons??null;
 const palletGross=result?(inputs.carton_kg!=null&&inputs.pallet_kg!=null?inputs.carton_kg*result.cartons_per_pallet+Number(inputs.pallet_kg):null):responsePallet?.grossKG??null;
 const loadedHeight=result?.loaded_unit_height??responsePallet?.loadedHeight;
 const loadedDimensions=inputs.pallet&&inputs.pallet.length>0&&inputs.pallet.width>0&&loadedHeight!=null?[inputs.pallet.length,inputs.pallet.width,loadedHeight].map(v=>decimalDisplay(v,3)).join(' × '):'';

 return <Modal label="3D load planner" className="dialog record-dialog load-planner" onClose={()=>!busy&&onClose()}>
 <div className="customer-editor-heading"><h2>3D container load</h2><IconButton icon="close" label="Close load planner" disabled={busy} onClick={onClose}/></div>
 <ErrorNote value={[...lookupErrors,error||entry?.error].filter(Boolean).join(' ')}/><div className="load-planner-layout">
 <fieldset className="load-planner-controls" disabled={busy}><div className="load-two-columns">
 <label>Container type<select aria-label="Container type" value={containerID} onChange={e=>selectContainer(e.target.value)}><option value="">Choose container</option>{containers.map(c=><option key={c.ID} value={c.ID}>{c.Code}</option>)}</select></label>
 <label>Loading mode<select aria-label="Loading mode" value={mode} disabled={allowedModes.length===1} onChange={e=>{setMode(e.target.value as Inputs['mode']);setError('')}}>{allowedModes.map(m=><option key={m} value={m}>{m==='pallet'?'Pallet loaded':'Floor-loaded cartons'}</option>)}</select></label></div>
 {container&&<small>{decimalDisplay(container.Specifications.length,6)} × {decimalDisplay(container.Specifications.width,6)} × {decimalDisplay(container.Specifications.height,6)} mm · Maximum container payload: {decimalDisplay(container.Specifications.payload_kg,3)??'Not maintained'} kg</small>}

 <fieldset><legend>Final carton — from saved response</legend>{dimensions()}<label>Carton gross weight (kg)<input aria-label="Carton gross weight (kg)" readOnly value={decimalDisplay(inputs.carton_kg,3)??''}/></label>{weightsLoaded&&inputs.carton_kg==null&&<small role="status">Carton gross weight is unavailable. Save response quantities and material tare for every layer and child item.</small>}</fieldset>
 {inputs.mode==='pallet'&&<fieldset><legend>Palletization</legend><label>Gross weight / Pallet (kg)<input aria-label="Gross weight / Pallet (kg)" readOnly value={decimalDisplay(palletGross,3)??''}/></label><label>Cartons / Pallet<input aria-label="Cartons / Pallet" readOnly value={decimalDisplay(palletCartons,0)??''}/></label><label>Loaded pallet dimension (mm)<input aria-label="Loaded pallet dimension (mm)" readOnly value={loadedDimensions}/></label>{!palletAssembly&&<small role="status">Save pallet pricing in the response before viewing a pallet load.</small>}</fieldset>}
 </fieldset><div className="load-planner-preview">{result?<><LoadScene boxes={boxes} bounds={inputs.container} label="3D container load layout"/>
 {!!result.warnings.length&&<details className="load-warnings"><summary>{result.warnings.length} loading notice(s)</summary>{result.warnings.map(w=><p className="load-warning" key={w}>{w}</p>)}</details>}<small>Best tested rectangular layout; maximum capacity is not guaranteed.</small></>:<p aria-live="polite">{entry?.error?'Preview unavailable. Retry this container below.':ready&&container?'Calculating container load…':'Complete the saved response data to view the container load.'}</p>}
 <div className="load-container-table"><table aria-label="Container load summary"><caption>Container summary · {mode==='pallet'?'Pallet loaded':'Floor-loaded cartons'}</caption><thead><tr><th>Container</th><th>Pallets</th><th>Cartons</th><th>Gross (kg)</th><th>Payload (kg)</th><th>Volume %</th></tr></thead><tbody>{containers.map(c=>{
 const row=previews[mode+':'+c.ID],r=row?.data?.Result;
 return <tr key={c.ID} className={String(c.ID)===containerID?'selected':''}><td><button type="button" aria-label={'View '+c.Code} aria-pressed={String(c.ID)===containerID} disabled={busy} onClick={()=>selectContainer(String(c.ID))}>{c.Code}</button></td>{r?<><td>{mode==='pallet'?decimalDisplay(r.loaded_units,0):'—'}</td><td>{decimalDisplay(r.cartons,0)}</td><td>{decimalDisplay(r.gross_kg,3)??'Unknown'}</td><td>{decimalDisplay(c.Specifications.payload_kg,3)??'—'}</td><td>{decimalDisplay(r.volume_percent,1)}%</td></>:<td colSpan={5}>{row?.error?<span title={row.error}>Unavailable <button type="button" disabled={busy} onClick={()=>retryPreview(c)} aria-label={'Retry '+c.Code}>Retry</button></span>:ready?'Calculating…':'—'}</td>}</tr>
 })}</tbody></table></div>
 </div></div><div className="actions record-action-bar">{onClear&&<IconButton icon="refresh" label="Clear load plan" disabled={busy} onClick={onClear}/>}<button type="button" disabled={busy} onClick={onClose}>Close</button>{onConfirm&&<button type="button" className="primary" disabled={busy||!container||!result||result.cartons<=0} onClick={confirmPreview}>Preview confirm</button>}</div></Modal>
}
