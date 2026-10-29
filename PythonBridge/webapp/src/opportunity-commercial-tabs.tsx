import {balanceFirstGradeRatio} from './grade-ratios';
import {rawPriceOption} from './number-format';
import {useEffect,useState} from 'react';
import {IconButton} from './icons';
import {type Row} from './api';
import {InlineMasterCreate} from './inline-master-create';
import {AddMasterButton,canCreateMaster} from './add-master-button';
import {useSession} from './session';
import {withTCBGrades} from './tcb-grade-pricing';
import {materialRecipe,changeRecipe,recipeRows,rawPrice,matchesRawQuote,productFields,money,type TCBGrade} from './tcb-model';

import {FieldLabel,Notification} from './ui';
import {quantityDisplay} from './packaging-summary-model';
import {savedProcessTree} from './grade-process';
import {tcbInputIssues} from './tcb-validation';
import {GradeTree} from './grade-tree';
import {gradeError,type GradeItem,type RawGradeOption,type RawMaterialOption} from './product-grades';
import type {Draft} from './opportunity-losses';
export type CommercialProps={d:Draft;lookups:{rows:RawGradeOption[];materials:RawMaterialOption[]};busy:boolean;review:boolean;update:(id:number,fn:(d:Draft)=>Draft)=>void;changeGrades:(id:number,fn:(items:GradeItem[])=>GradeItem[])=>void;loadPrices:(d:Draft)=>void|Promise<boolean|void>;refreshLookups?:()=>Promise<void>};
export function ItemGradeEditor({d,lookups,busy,review,changeGrades,update,loadPrices,refreshLookups}:CommercialProps){
 const id=Number(d.row.ItemID),locked=d.readonly||d.gradeLocked,ready=d.pricingGradeKey===JSON.stringify(d.grades);
 const session=useSession();
 type Target={entity:'raw-materials'|'raw-prices';path:string;gradeID:number;materialID?:number};
 const [master,setMaster]=useState<Target|null>(null),[masterBusy,setMasterBusy]=useState(false),[notice,setNotice]=useState(''),[masterError,setMasterError]=useState('');
 const [retryMaster,setRetryMaster]=useState<{target:Target;records:Row[]}|null>(null);
 async function created(target:Target,records:Row[]){
  setMaster(null);setMasterBusy(true);setMasterError('');
  try{
   await refreshLookups?.();
   let next=d;
   const record=records[0];
   if(target.entity==='raw-materials'&&record?.ID){
    next=withTCBGrades(d,d.grades.map(item=>item.ParentID+'/'+item.ID===target.path?{...item,RawMaterialID:Number(record.ID)}:item));
    update(id,()=>next);
   }
   const ok=await loadPrices(next);
   if(ok===false)throw new Error('Pricing could not be refreshed.');
   if(target.entity==='raw-prices'&&record?.ID)update(id,x=>{
    const price=x.quotes.find(quote=>Number(quote.PriceID)===Number(record.ID));
    return price?{...x,selections:[...x.selections.filter(s=>s.Path!==target.path),{Path:target.path,PriceID:Number(price.PriceID),PriceVersion:String(price.PriceVersion),ExpectedUSDPerLb:String(price.USDPerLb)}]}:x;
   });
   setRetryMaster(null);setNotice('Master saved and choices refreshed. Review the selection before saving TCB.');
  }catch(error){setRetryMaster({target,records});setMasterError('Master saved, but choices could not be refreshed. Do not create it again. '+(error as Error).message)}
  finally{setMasterBusy(false)}
 }
 return <>
 {JSON.stringify(d.grades)!==d.baselineGrades&&gradeError(d.grades)&&<p className="tcb-field-error">{gradeError(d.grades)}</p>}
 {d.gradeLocked&&<p>Grades are captured by an active Packaging Request. Complete or cancel that request before changing the snapshot.</p>}

 <GradeTree compactCards autoFirstRatio onMaterialEdited={(item,record)=>void created({entity:'raw-materials',path:item.ParentID+'/'+item.ID,gradeID:Number(item.RawGradeID)},[record])} onNewMaterial={!locked&&canCreateMaster(session,'raw-materials')?item=>setMaster({entity:'raw-materials',path:item.ParentID+'/'+item.ID,gradeID:Number(item.RawGradeID)}):undefined} renderPricing={ready?item=>{const leaf=d.quoteGrades.find(g=>g.Path===item.ParentID+'/'+item.ID);return leaf?<GradePrice d={d} leaf={leaf} busy={busy||masterBusy} review={review} update={update} onPriceEdited={record=>void created({entity:'raw-prices',path:leaf.Path,gradeID:Number(leaf.RawGradeID),materialID:Number(leaf.RawMaterialID)},[record])} onNewPrice={canCreateMaster(session,'raw-prices')?()=>setMaster({entity:'raw-prices',path:leaf.Path,gradeID:Number(leaf.RawGradeID),materialID:Number(leaf.RawMaterialID)}):undefined}/>:<small>Select a final grade and load its pricing.</small>}:undefined} items={d.grades} rawGrades={lookups.rows} rawMaterials={lookups.materials} busy={busy||masterBusy} readonly={locked} disabled={locked||busy||review||masterBusy}
 onAdd={parent=>changeGrades(id,items=>[...items,{ParentID:parent,ID:Math.max(0,...items.filter(i=>i.ParentID===parent).map(i=>i.ID))+1,Grade:'',Process:false,RawGradeID:null,RawMaterialID:null,RatioPct:items.some(i=>i.ParentID===parent)?'':'100'}])}
 onRemove={item=>changeGrades(id,items=>{const path=item.ParentID+'/'+item.ID;return balanceFirstGradeRatio(items.filter(i=>i!==item&&i.ParentID!==path&&!i.ParentID.startsWith(path+'/')),item.ParentID)})}
 onChange={(item,patch)=>changeGrades(id,items=>{const path=item.ParentID+'/'+item.ID;const next=items.filter(i=>patch.RawGradeID===undefined||i===item||(i.ParentID!==path&&!i.ParentID.startsWith(path+'/'))).map(i=>i===item?{...i,...patch}:i);return patch.RatioPct===undefined?next:balanceFirstGradeRatio(next,item.ParentID)})}/>
 <Notification value={notice} onDismiss={()=>setNotice('')}/><Notification value={masterError} severity="warning" onDismiss={()=>setMasterError('')}/>
 {retryMaster&&<IconButton icon="refresh" label="Reload saved master choices" disabled={busy||masterBusy||review} onClick={()=>void created(retryMaster.target,retryMaster.records)}/>}
 {master&&<InlineMasterCreate entity={master.entity} initialValues={master.entity==='raw-materials'?{GradeID:String(master.gradeID)}:{MaterialID:String(master.materialID)}} lockedFields={master.entity==='raw-materials'?['GradeID']:['MaterialID']} onClose={()=>setMaster(null)} onSaved={records=>void created(master,records)}/>}
 </>;
}
function GradePrice({d,leaf,busy,review,update,onNewPrice,onPriceEdited}:Pick<CommercialProps,'d'|'busy'|'review'|'update'>&{leaf:TCBGrade;onNewPrice?:()=>void;onPriceEdited?:(record:Row)=>void}){
 const id=Number(d.row.ItemID),disabled=d.readonly||busy||review;
 const selected=d.selections.find(p=>p.Path===leaf.Path),manual=!!selected&&!selected.PriceID&&'DirectUSDPerLb' in selected,candidates=leaf.RawMaterialID?d.quotes.filter(p=>p.RawGradeID===leaf.RawGradeID&&p.MaterialID===leaf.RawMaterialID):[];
 const key=(p:Row)=>p.PriceID+':'+p.PriceVersion+':'+p.USDPerLb;
 const quote=candidates.find(p=>matchesRawQuote(p,selected));
 const value=selected&&!manual?quote?key(quote):selected.PriceID+':'+selected.PriceVersion+':'+selected.ExpectedUSDPerLb:'';
 const error=disabled?'':tcbInputIssues(d).find(x=>x.field==='Price:'+leaf.Path)?.message,errorId='tcb-price-error-'+id+'-'+leaf.Path;
 function select(value:Draft['selections'][number]|null){update(id,x=>({...x,selections:[...x.selections.filter(s=>s.Path!==leaf.Path),...(value?[value]:[])]}))}
 return <div className="tcb-grade-price" data-tcb-field={'Price:'+leaf.Path}>
  <div className="grade-pricing-heading"><div className="grade-direct-price"><label><input type="checkbox" aria-label={'Direct price item '+id+' grade '+leaf.Path} checked={manual} disabled={disabled} onChange={e=>select(e.target.checked?{Path:leaf.Path,DirectUSDPerLb:null}:null)}/>Direct price</label><FieldLabel help="Opportunity-only USD/lb price. Does not change the pricing master. Uncheck to choose a master quote.">{null}</FieldLabel>
  {manual&&<span className="grade-direct-amount"><input aria-label={'Direct USD/lb item '+id+' grade '+leaf.Path} aria-invalid={!!error} aria-describedby={error?errorId:undefined} type="number" min="0" step="0.000001" value={selected?.DirectUSDPerLb??''} disabled={disabled} onChange={e=>select({Path:leaf.Path,DirectUSDPerLb:e.target.value===''?null:e.target.value})}/><span>USD/lbs</span></span>}{!manual&&<output aria-label={'RM ($/lbs) item '+id+' grade '+leaf.Path}>{money(rawPrice({...d.costingInputs,Prices:d.selections},leaf,d.quotes)).replace(/ USD$/,' USD/lbs')}</output>}</div></div>
  <label>Material / vendor / quantity tier<span className="master-lookup-control"><select aria-label={'Raw price item '+id+' grade '+leaf.Path} disabled={disabled||manual||!leaf.RawMaterialID} title={!leaf.RawMaterialID?'Select a raw material first.':undefined} value={value} onChange={e=>{
   if(!leaf.RawMaterialID)return;
   const p=candidates.find(p=>key(p)===e.target.value);select(p?{Path:leaf.Path,PriceID:Number(p.PriceID),PriceVersion:String(p.PriceVersion),ExpectedUSDPerLb:String(p.USDPerLb)}:null);
  }}><option value="">Choose existing material price</option>{selected&&!manual&&!quote&&<option value={value}>Saved quote is unavailable; select a current price</option>}{candidates.map(p=><option key={key(p)} value={key(p)} disabled={p.USDPerLb==null}>{rawPriceOption(p)}</option>)}</select>{onNewPrice&&<AddMasterButton entity="raw-prices" selectedValue={!manual?selected?.PriceID:undefined} onEdited={onPriceEdited} label={'Add new Raw Pricing master for '+leaf.Path} disabled={disabled||!leaf.RawMaterialID} onClick={onNewPrice}/>}</span></label>
  {error&&<small id={errorId} className="tcb-field-error">{error}</small>}
 </div>;
}

export function ItemProcessInfo({d,busy,review,update}:CommercialProps){
 const [expanded,setExpanded]=useState<string[]>([]);
 const id=Number(d.row.ItemID),ready=d.pricingGradeKey===JSON.stringify(d.grades),disabled=d.readonly||busy||review;
 const groups=recipeRows({...d.costingInputs,Prices:d.selections},savedProcessTree(d.grades),d.quoteGrades,d.quotes),issues=disabled?[]:tcbInputIssues(d);
 useEffect(()=>{const reveal=(event:Event)=>{const detail=(event as CustomEvent<{id:number;path:string}>).detail;if(detail.id!==id)return;const ancestors=detail.path.split('/').slice(1,-1).map((_,index)=>detail.path.split('/').slice(0,index+2).join('/'));setExpanded(paths=>[...new Set([...paths,...ancestors])])};window.addEventListener('bridge:reveal-recipe',reveal);return()=>window.removeEventListener('bridge:reveal-recipe',reveal)},[id]);
 const visible=groups.filter(group=>!groups.some(parent=>group.Path.startsWith(parent.Path+'/')&&!expanded.includes(parent.Path)));

 return <section className="tcb-process-info" aria-label="Recipe Info"><h3>Recipe Info</h3>{!ready?<p>Load pricing for the current grades to show Recipe Info.</p>:!groups.length?<p>No grades selected.</p>:
  <div className="table-scroll"><table className="commercial-price-table tcb-process-info-table" aria-label="Recipe Info"><thead><tr><th>Grade</th><th>Grade ratio</th><th className="recipe-process-loss">Loss Process %</th><th>Line RM ($/lbs)</th>{productFields.map(([field,label])=><th key={field}>{label}</th>)}<th>Line product ($/lbs)</th></tr></thead><tbody>{visible.map(group=><tr key={group.Path} className={'tcb-process-group tcb-process-row tcb-recipe-family-'+((Number(group.Path.split('/')[1])-1)%2)+(!group.process?' tcb-recipe-summary':'')} data-process-path={group.Path} data-tcb-field={'Recipe:'+group.Path}>
   <td data-label="Grade" style={{paddingLeft:12+group.depth*12}}><div className="recipe-grade-label">{groups.some(child=>child.Path.startsWith(group.Path+'/'))&&<IconButton icon={expanded.includes(group.Path)?'down':'right'} label={'Toggle child grades '+group.Path+' item '+id} aria-expanded={expanded.includes(group.Path)} onClick={()=>setExpanded(paths=>paths.includes(group.Path)?paths.filter(path=>path!==group.Path):[...paths,group.Path])}/>}<strong>{group.Path+' · '+group.Grade}</strong></div></td><td data-label="Grade ratio">{group.RatioPct+'%'}</td><td className="recipe-process-loss" data-label="Loss Process %"><output aria-label={'Loss Process % '+group.Path+' item '+id}>{group.lossPct===null?'—':quantityDisplay(group.lossPct,6)+'%'}</output></td><td data-label="Line RM ($/lbs)"><div className="recipe-rm-prices"><span><small title="Without loss">W/o</small><output aria-label={'RM without loss '+group.Path+' item '+id}>{money(group.rmWithoutLoss)}</output></span><span className="recipe-rm-with-loss"><small title="With loss">With</small><output aria-label={'RM with loss '+group.Path+' item '+id}>{money(group.rm)}</output></span></div></td>
   {productFields.map(([field,label])=>{
    if(!group.process)return <td key={field} data-label={label}>—</td>;
    const values=materialRecipe(d.costingInputs,group.Path),fieldError=issues.find(x=>x.field==='Recipe:'+group.Path+':'+field)?.message;
    return <td key={field} data-label={label} data-tcb-field={'Recipe:'+group.Path+':'+field}><input aria-label={label} aria-invalid={!!fieldError} type="number" min="0" max={field.endsWith('Ratio')||field==='OilPct'?100:undefined} step={field.endsWith('Ratio')||field==='OilPct'?'0.01':'0.000001'} disabled={disabled} value={String(values[field]??'')} onChange={e=>update(id,x=>{
     const previous=Object.fromEntries(productFields.map(([key])=>[key,materialRecipe(x.costingInputs,group.Path)[key]]));
     return {...x,costingInputs:{...x.costingInputs,MaterialCosts:[...(x.costingInputs.MaterialCosts??[]).filter(r=>r.Path!==group.Path),{...changeRecipe(previous,field,e.target.value===''?null:e.target.value),Path:group.Path}]}};
    })}/>{fieldError&&<small className="tcb-field-error">{fieldError}</small>}</td>;
   })}
   <td className="material-line-total" data-label="Line product ($/lbs)"><output>{money(group.product)}</output></td>
  </tr>)}</tbody></table></div>}
 </section>;
}
