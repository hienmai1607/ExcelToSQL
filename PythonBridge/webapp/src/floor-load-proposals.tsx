import {useEffect,useState,type ReactNode} from 'react';
import {call} from './api';
import {ErrorNote,InfoTip} from './ui';
import {FloorLoadScene} from './floor-load-scene';
import {parseContainerProfiles} from './container-loading';
import {decimalDisplay} from './number-format';
import './pkg-pricing.css';

type Dimensions={length:number;width:number;height:number};
type Position={x:number;y:number;length:number;width:number};
type Proposal={Code:string;ContainerID:number;error?:string;Inputs:{carton:Dimensions;container:Dimensions;carton_kg:number;payload_kg?:number};Result:{cartons:number;container_tiers?:number;container_layer:Position[];container_layout_optimal:boolean;container_layer_upper_bound:number;gross_kg:number;volume_percent?:number;warnings:string[]}};
export function FloorLoadProposals({itemID,carton,grossKG,selected,count,editable,onSelect,onCount,open,renderPlanner,onClose,profilesJSON,proposed,onProposal,netKG,palletCodes,required}:{required:string[];palletCodes:string[];profilesJSON:string;proposed:string[];onProposal:(code:string,checked:boolean,count?:string)=>void;netKG:number|null;open:boolean;renderPlanner:(panel:(modeControl:ReactNode)=>ReactNode,actions:ReactNode)=>ReactNode;onClose:()=>void;itemID:number;carton:Dimensions;grossKG:number|null;selected:string;count:string;editable:boolean;onSelect:(code:string)=>void;onCount:(value:string)=>void}){
 const profiles=parseContainerProfiles(profilesJSON);
 const rowCount=(row:Proposal)=>palletCodes.includes(row.Code)?String(row.Result?.cartons??''):row.Code===selected&&count?count:profiles[row.Code]?.CartonsPerContainer??String(row.Result?.cartons??'');
 const key=JSON.stringify({Carton:carton,CartonGrossKG:grossKG});
 const [reply,setReply]=useState<{key:string;rows:Proposal[]}|null>(null),[error,setError]=useState('');
 const [view,setView]=useState<string|null>(null),[manual,setManual]=useState(''),[pending,setPending]=useState<{code:string;count:string}|null>(null);
 const rows=reply?.key===key?reply.rows:[];
 const valid=Object.values(carton).every(v=>Number.isFinite(v)&&v>0)&&grossKG!=null&&grossKG>0;
 useEffect(()=>{
  if(!valid){setReply(null);setError('');return}
  let active=true;setError('');const timer=setTimeout(()=>{call<{rows:Proposal[]}>('/api/packaging/items/'+itemID+'/floor-capacity',JSON.parse(key)).then(r=>{if(active)setReply({key,rows:r.rows})}).catch(e=>{if(active)setError(e.message)})},300);
  return()=>{active=false;clearTimeout(timer)};
 },[key,itemID,valid]);
 useEffect(()=>{
  if(!editable)return;
  if(pending){if(selected===pending.code){onCount(pending.count);setPending(null)}return}
  const proposed=rows.find(r=>r.Code===selected);
  if(!count&&proposed&&proposed.Result?.cartons>0)onCount(String(proposed.Result.cartons));
 },[rows,selected,count,pending,editable]);
 useEffect(()=>{if(!editable)return;for(const code of required){const row=rows.find(r=>r.Code===code);if(!palletCodes.includes(code)&&row&&row.Result?.cartons>0&&(!proposed.includes(code)||!profiles[code]?.CartonsPerContainer)){onProposal(code,true,rowCount(row));break}}},[reply,editable,profilesJSON,required.join(','),proposed.join(','),palletCodes.join(',')]);
 function apply(code:string,value:string){if(code===selected)onCount(value);else{setPending({code,count:value});onSelect(code)}}
 useEffect(()=>{if(open){setView(selected||required[0]||'');setManual(count)}},[open]);
 const proposal=rows.find(r=>r.Code===view)??rows.find(r=>r.Code===selected)??rows.find(r=>required.includes(r.Code))??rows[0],number=Number(manual),maximum=proposal?.Result?.cartons??0;
 useEffect(()=>{if(open&&proposal)setManual(rowCount(proposal))},[open,proposal?.Code]);
 const manualValid=/^[1-9]\d*$/.test(manual)&&number<=maximum;
 if(!open)return null;
 const panel=(modeControl:ReactNode)=><div className="load-planner-layout floor-load-proposals" aria-label="Floor load proposals">
  <fieldset className="load-planner-controls"><div className="load-two-columns"><label>Container type<select aria-label="Container type" value={proposal?.Code??''} onChange={e=>{const row=rows.find(r=>r.Code===e.target.value);if(row){setView(row.Code);setManual(rowCount(row))}}}>{rows.map(row=><option key={row.Code}>{row.Code}</option>)}</select></label>{modeControl}</div>
   {proposal&&!proposal.error&&<small>{(['length','width','height'] as const).map(k=>decimalDisplay(proposal.Inputs.container[k],3)).join(' × ')} mm · Maximum container payload: {decimalDisplay(proposal.Inputs.payload_kg,3)??'Not maintained'} kg</small>}
   <fieldset><legend>Final carton — from response</legend>{(['length','width','height'] as const).map(axis=><label key={axis}>{axis[0].toUpperCase()+axis.slice(1)} (mm)<input aria-label={'carton '+axis} readOnly value={decimalDisplay(carton[axis],3)??''}/></label>)}<label>Carton gross weight (kg)<input readOnly value={decimalDisplay(grossKG,3)??''}/></label></fieldset>
   {proposal&&!proposal.error&&<fieldset><legend>Floor loading<InfoTip text="Tick Proposal for every container to share with Opportunity. Viewing a container alone does not propose it."/></legend><label>Cartons / Container<input aria-label="Floor preview Cartons / Container" readOnly={!editable} inputMode="numeric" value={manual} onChange={e=>{const value=e.target.value;setManual(value);if(proposed.includes(proposal.Code)&&!palletCodes.includes(proposal.Code)&&/^[1-9]\d*$/.test(value)&&Number(value)<=maximum)onProposal(proposal.Code,true,value)}}/></label><small>Maximum found: {decimalDisplay(maximum,0)} cartons</small><label>Net weight (kg)<input readOnly value={netKG==null?'':decimalDisplay((manualValid?number:maximum)*netKG,3)??''}/></label><label>Gross weight (kg)<input readOnly value={decimalDisplay((manualValid?number:maximum)*Number(proposal.Inputs.carton_kg),3)??''}/></label>{!manualValid&&<p role="alert">Enter a whole count from 1 to {maximum}.</p>}</fieldset>}
   <ErrorNote value={error}/>{!valid&&<small>Maintain final carton dimensions and gross weight to propose container loads.</small>}
  </fieldset>
  <div className="load-planner-preview">{proposal&&!proposal.error?<><FloorLoadScene positions={proposal.Result.container_layer} count={manualValid?number:maximum} tiers={proposal.Result.container_tiers} cartonHeight={Number(proposal.Inputs.carton.height)} bounds={Object.fromEntries(Object.entries(proposal.Inputs.container).map(([k,v])=>[k,Number(v)])) as Dimensions} label={'3D floor arrangement '+proposal.Code}/><small>Best feasible upright arrangement found; overall 3D maximum is not guaranteed.</small></>:<p>{proposal?.error||(!valid?'Complete carton dimensions and gross weight.':reply?.key===key?'No active containers match this request.':'Calculating container proposals…')}</p>}</div>
  <div className="load-container-table"><table aria-label="Proposed floor loads"><caption>Container summary · Floor-loaded cartons</caption><thead><tr><th>Container</th><th>Dimensions (mm)<small>L × W × H</small></th><th>Proposal</th><th>Cartons</th><th>Net (kg)</th><th>Gross (kg)</th><th>Payload (kg)</th><th>Volume %</th></tr></thead><tbody>{rows.map(row=>{
   const quantity=row.Code===proposal?.Code&&manualValid?number:Number(rowCount(row)),factor=row.Result?.cartons?quantity/row.Result.cartons:0;
   return <tr key={row.Code} className={row.Code===proposal?.Code?'selected':''}><td><button type="button" aria-label={'View '+row.Code} aria-pressed={row.Code===proposal?.Code} onClick={()=>{setView(row.Code);setManual(rowCount(row))}}>{row.Code}</button></td><td className="load-container-dimensions">{row.Inputs?(['length','width','height'] as const).map(k=>decimalDisplay(row.Inputs.container[k],3)).join(' × '):'—'}</td><td><input type="checkbox" aria-label={'Proposal '+row.Code} checked={proposed.includes(row.Code)&&!palletCodes.includes(row.Code)} title={required.includes(row.Code)?'The requested container option must remain proposed.':undefined} disabled={!editable||(required.includes(row.Code)&&proposed.includes(row.Code)&&!palletCodes.includes(row.Code))||(!(proposed.includes(row.Code)&&!palletCodes.includes(row.Code))&&(!!row.error||row.Result?.cartons<1))} onChange={e=>onProposal(row.Code,e.target.checked,String(quantity))}/></td>{row.error?<td colSpan={5}>{row.error}</td>:<><td>{decimalDisplay(quantity,0)}</td><td>{netKG==null?'Unknown':decimalDisplay(quantity*netKG,3)}</td><td>{decimalDisplay(quantity*Number(row.Inputs.carton_kg),3)}</td><td>{decimalDisplay(row.Inputs.payload_kg,3)??'—'}</td><td>{decimalDisplay((row.Result.volume_percent??0)*factor,1)}%</td></>}</tr>
  })}</tbody></table></div>
 </div>;
 return renderPlanner(panel,editable&&<button type="button" className="primary" disabled={!proposal||!!proposal.error||!manualValid} onClick={()=>{apply(proposal!.Code,manual);onClose()}}>Use carton count</button>);
}
