import {useEffect,useRef,useState} from 'react';
import {call,ApiError,type Row} from './api';
import {Modal,ErrorNote,Badge} from './ui';
import {IconButton} from './icons';
import {masterConfig,lookupLabel,type MasterEntity,type Lookups,type Field} from './master-config';
type Entry={key:number;values:Record<string,string>;errors:Record<string,string>;message:string;saved:boolean};
function scaled(v:string){const [a,b='']=v.split('.');return BigInt(a)*10000n+BigInt(b.padEnd(4,'0'))}
export function MasterEditor({entity,row,lookups,onClose,onSaved}:{entity:MasterEntity;row:Row|null;lookups:Lookups;onClose:()=>void;onSaved:(count:number)=>void}){
 const config=masterConfig[entity],fields:Field[]=[...config.fields,...(row?[{key:'Status',label:'Status',kind:'status' as const}]:[])];
 const productWeight=(f:Field)=>f.key==='WeightValue'?(Number(row?.WeightGrams)>999999.9999?(Number(row?.WeightGrams)/28.3495231).toFixed(4):String(row?.WeightGrams??'')):f.key==='WeightUnit'?(Number(row?.WeightGrams)>999999.9999?'oz':'g'):undefined;
 const create=(key:number):Entry=>({key,values:Object.fromEntries(fields.map(f=>[f.key,entity==='products'&&row&&productWeight(f)!==undefined?productWeight(f)!:row?.[f.key]!=null?(f.kind==='date'?String(row[f.key]).slice(0,10):String(row[f.key])):f.initial||''])),errors:{},message:'',saved:false});
 const [entries,setEntries]=useState<Entry[]>(()=>[create(1)]),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const serial=useRef(1),lock=useRef(false),initial=useRef(JSON.stringify(entries.map(e=>e.values)));
 const pending=entries.filter(e=>!e.saved),dirty=JSON.stringify(pending.map(e=>e.values))!==initial.current;
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved changes?')))onClose()}
 function change(key:number,field:string,value:string){setEntries(list=>list.map(e=>e.key===key?{...e,values:{...e.values,[field]:value},errors:{...e.errors,[field]:''},message:''}:e))}
 function review(){
  const checked=entries.map(e=>{if(e.saved)return e;const errors:Record<string,string>={};
   for(const f of fields){const value=e.values[f.key]?.trim()||'';
    if(f.required&&!value)errors[f.key]='Required.';
    else if(value&&f.kind==='decimal'&&!/^\d{1,14}(\.\d{1,4})?$/.test(value))errors[f.key]='Use a non-negative number with up to 4 decimals.';
    else if(value&&f.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))errors[f.key]='Choose a date.';
    else if(value&&(f.kind==='material'||f.kind==='currency')&&!(f.kind==='material'?lookups.materials:lookups.currencies).some(r=>String(r.ID)===value))errors[f.key]='Choose a valid option.';
   }
   if(entity==='products'){
    const v=e.values;
    if(!/^\d{1,6}(\.\d{1,4})?$/.test(v.WeightValue)||Number(v.WeightValue)<=0)errors.WeightValue='Use a positive weight with up to 6 whole digits and 4 decimals.';
    else if(Number(v.WeightValue)*(v.WeightUnit==='oz'?28.3495231:1)<0.005)errors.WeightValue='Weight must round to at least 0.01 g.';
    if(!['g','oz'].includes(v.WeightUnit))errors.WeightUnit='Choose g or oz.';
    if(!row)for(const key of ['ProductCode','ProductName'])if(pending.filter(x=>x.values[key].trim().toLowerCase()===v[key].trim().toLowerCase()).length>1)errors[key]='Duplicate value in this form.';
   }
   if(entity==='prices'){const v=e.values;
    if(v.QuantityTo&&!errors.QuantityTo&&!errors.QuantityFrom&&v.QuantityFrom&&scaled(v.QuantityTo)<=scaled(v.QuantityFrom))errors.QuantityTo='Must be greater than quantity from.';
    if(v.EffectiveTo&&v.EffectiveFrom&&v.EffectiveTo<v.EffectiveFrom)errors.EffectiveTo='Must be on or after effective from.';
   }
   if(entity==='materials'&&!row&&pending.filter(x=>x.values.MaterialCode.trim().toLowerCase()===e.values.MaterialCode.trim().toLowerCase()).length>1)errors.MaterialCode='Duplicate material code in this form.';
   return {...e,errors};
  });setEntries(checked);if(!checked.some(e=>Object.keys(e.errors).length)&&pending.length)setConfirm(true);
 }
 async function save(){
  if(lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');
  try{
   const rows=pending.map(e=>{const values:Row={RowNum:e.key,Command:row?'U':'C',ID:row?.ID??null,RowVersion:row?.RowVersion??null};
    for(const f of fields){const v=e.values[f.key]?.trim()||'';values[f.key]=v===''?null:(f.kind==='material'||f.kind==='currency'?Number(v):v)}
    return values;
   });
   const reply=await call<{results:Row[]}>((entity==='products'?'/api/product/batch':'/api/packaging/'+config.endpoint+'/batch'),{rows});
   const results=reply?.results;
   if(!Array.isArray(results)||results.length!==pending.length||pending.some(e=>results.filter(r=>Number(r.RowNum)===e.key).length!==1)||results.some(r=>!['OK','ERROR'].includes(String(r.Status)))){setUncertain(true);throw new Error('Save outcome unknown. Close and refresh before trying again.')}
   const count=results.filter(r=>r.Status==='OK').length;
   setEntries(list=>list.map(e=>{if(e.saved)return e;const r=results.find(r=>Number(r.RowNum)===e.key)!;return {...e,saved:r.Status==='OK',message:r.Status==='OK'?'Saved':String(r.Message||'Save failed.')};}));
   if(count)onSaved(count);
   if(count===pending.length)onClose();else setError('Some records were not saved. Correct the marked sections. Saved records will not be resubmitted.');
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Close and refresh before trying again.')}else setError(e instanceof Error?e.message:'Save failed.')}
  finally{lock.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label={(row?'Edit ':'New ')+config.singular} className="customer-drawer batch-drawer" onClose={close}>
 <div className="customer-editor-heading"><h2>{row?'Edit':'New'} {config.singular}</h2><IconButton icon="close" label="Close form" disabled={busy} onClick={close}/></div>
 <ErrorNote value={error}/>
 <form noValidate onSubmit={e=>{e.preventDefault();review()}}><div className="customer-sections">{entries.map((e,index)=><section className={'customer-entry'+(e.saved?' entry-saved':'')} aria-label={'Record '+(index+1)} key={e.key}>
 <header><h3>{row?'Details':'Record '+(index+1)}</h3>{e.saved?<Badge value="Saved"/>:!row&&<IconButton icon="close" label={'Remove record '+(index+1)} disabled={busy||uncertain||pending.length<=1} onClick={()=>setEntries(list=>list.filter(x=>x.key!==e.key))}/>}</header>
 {e.message&&<p className={e.saved?'':'field-error'}>{e.message}</p>}
 <fieldset disabled={busy||uncertain||e.saved}><div className="master-fields">{fields.map(f=><label key={f.key}>{f.label}{f.required?' *':''}
 {f.kind==='material'||f.kind==='currency'?<select aria-label={f.label} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}><option value="">Choose {f.label.toLowerCase()}</option>{(f.kind==='material'?lookups.materials:lookups.currencies).map(r=><option key={String(r.ID)} value={String(r.ID)} disabled={f.kind==='material'&&r.Status==='Block'&&String(row?.MaterialID)!==String(r.ID)}>{lookupLabel(r,f.kind as 'material'|'currency')}{r.Status==='Block'?' (Blocked)':''}</option>)}</select>:f.kind==='unit'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option value="g">Grams (g)</option><option value="oz">Ounces (oz)</option></select>:f.kind==='status'?<select aria-label={f.label} value={e.values[f.key]} onChange={v=>change(e.key,f.key,v.target.value)}><option>Active</option><option>Block</option></select>:<input aria-label={f.label} type={f.kind==='date'?'date':'text'} inputMode={f.kind==='decimal'?'decimal':undefined} maxLength={f.max|| (f.kind==='decimal'?19:undefined)} value={e.values[f.key]} aria-invalid={!!e.errors[f.key]} aria-describedby={f.key+e.key} onChange={v=>change(e.key,f.key,v.target.value)}/>}
 <span id={f.key+e.key} className="field-error">{e.errors[f.key]}</span></label>)}</div></fieldset>
 </section>)}</div>
 {!row&&<button className="add-section" type="button" disabled={busy||uncertain||entries.length>=500} onClick={()=>{const entry=create(++serial.current);setEntries(x=>[...x,entry])}}>+ Add record section</button>}
 <div className="actions batch-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy||uncertain||!pending.length||(!!row&&!dirty)} type="submit">Review & save</button></div></form>
 {confirm&&<Modal label="Confirm master save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{row?'Update':'Create'} {pending.length} {pending.length===1?'record':'records'}?</h2><ul className="batch-review">{pending.map(e=><li key={e.key}>{entity==='products'?e.values.ProductCode+' — '+e.values.ProductName:entity==='materials'?e.values.MaterialCode+' — '+e.values.MaterialName:lookupLabel(lookups.materials.find(r=>String(r.ID)===e.values.MaterialID)!,'material')+' · '+e.values.PriceBasis+' · '+e.values.UnitPrice}</li>)}</ul><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving…':'Confirm save'}</button></div></Modal>}
 </Modal>
}
