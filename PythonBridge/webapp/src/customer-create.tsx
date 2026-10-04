import {useEffect,useRef,useState} from 'react';
import {api,ApiError,type Row} from './api';
import {Modal,ErrorNote,Badge} from './ui';
import {IconButton} from './icons';
type Entry={key:number;name:string;market:string;currency:string;errors:Record<string,string>;message:string;saved:boolean};
const blank=(key:number):Entry=>({key,name:'',market:'',currency:'',errors:{},message:'',saved:false});
export function CustomerCreate({lookups,onClose,onSaved}:{lookups:{markets:Row[];currencies:Row[]};onClose:()=>void;onSaved:(count:number)=>void}){
 const [entries,setEntries]=useState<Entry[]>([blank(1)]),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const sequence=useRef(1),lock=useRef(false),first=useRef<HTMLInputElement>(null);
 const pending=entries.filter(x=>!x.saved),dirty=pending.some(x=>x.name||x.market||x.currency);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const navigate=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved customers?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',navigate);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',navigate)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved customers?')))onClose()}
 function change(key:number,field:'name'|'market'|'currency',value:string){setEntries(list=>list.map(x=>x.key===key?{...x,[field]:value,errors:{...x.errors,[field]:''},message:''}:x))}
 function review(){
  const names=new Map<string,number>();for(const x of pending){const name=x.name.trim().toLowerCase();if(name)names.set(name,(names.get(name)||0)+1)}
  const checked=entries.map(x=>{if(x.saved)return x;const errors:Record<string,string>={};
   if(!x.name.trim())errors.name='Enter a customer name.';else if((names.get(x.name.trim().toLowerCase())||0)>1)errors.name='This name appears in another section.';
   if(!lookups.markets.some(r=>String(r.ID)===x.market))errors.market='Choose a valid market.';
   if(!lookups.currencies.some(r=>String(r.ID)===x.currency))errors.currency='Choose a valid currency.';
   return {...x,errors};
  });setEntries(checked);
  if(checked.some(x=>Object.keys(x.errors).length)){first.current?.focus();return}
  if(pending.length)setConfirm(true);
 }
 async function save(){
  if(lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');
  const submitted=pending;
  try{
   const response=await api.saveCustomers(submitted.map(x=>({RowNum:x.key,Command:'C',ID:null,RowVersion:null,CustomerName:x.name.trim(),MarketID:Number(x.market),CurrencyID:Number(x.currency),Status:null})));
   const results=response?.results;
   if(!Array.isArray(results)||results.length!==submitted.length||submitted.some(x=>results.filter(r=>Number(r.RowNum)===x.key).length!==1)||results.some(r=>!['OK','ERROR'].includes(String(r.Status)))){
    setUncertain(true);throw new Error('Save outcome unknown. Close and refresh the list before trying again.');
   }
   const successes=results.filter(r=>r.Status==='OK').length;
   setEntries(list=>list.map(x=>{if(x.saved)return x;const r=results.find(r=>Number(r.RowNum)===x.key)!;return {...x,saved:r.Status==='OK',message:r.Status==='OK'?'Created':String(r.Message||'Could not save this customer.')};}));
   if(successes)onSaved(successes);
   if(successes===submitted.length)onClose();else setError('Some customers were not saved. Correct the marked sections and save again. Created records will not be resubmitted.');
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Close and refresh the list before trying again.')}else setError(e instanceof Error?e.message:'Save failed.')}
  finally{setConfirm(false);setBusy(false);lock.current=false}
 }
 const label=(r:Row,kind:string)=>String(r[kind+'Code'])+(r[kind+'Name']?' — '+r[kind+'Name']:'');
 return <Modal label="New customer" className="customer-drawer batch-drawer" onClose={close}>
 <div className="customer-editor-heading"><h2>New customers</h2><IconButton icon="close" label="Close customer form" disabled={busy} onClick={close}/></div>
 <ErrorNote value={error}/>
 <form noValidate onSubmit={e=>{e.preventDefault();review()}}>
 <div className="customer-sections">{entries.map((x,index)=><section className={'customer-entry'+(x.saved?' entry-saved':'')} key={x.key} aria-label={'Customer '+(index+1)}>
 <header><h3>Customer {index+1}</h3>{x.saved?<Badge value="Created"/>:<IconButton icon="close" label={'Remove customer '+(index+1)} disabled={busy||uncertain||pending.length<=1} onClick={()=>setEntries(list=>list.filter(r=>r.key!==x.key))}/>}</header>
 {x.message&&<p className={x.saved?'':'field-error'}>{x.message}</p>}
 <fieldset disabled={busy||uncertain||x.saved}>
 <label>Customer name *<input ref={index===0?first:undefined} autoFocus={index===0} aria-label="Customer name *" maxLength={200} value={x.name} onChange={e=>change(x.key,'name',e.target.value)} aria-invalid={!!x.errors.name} aria-describedby={'name-'+x.key}/><span id={'name-'+x.key} className="field-error">{x.errors.name}</span></label>
 <div className="customer-form-grid"><label>Market *<select aria-label="Market *" value={x.market} onChange={e=>change(x.key,'market',e.target.value)} aria-invalid={!!x.errors.market} aria-describedby={'market-'+x.key}><option value="">Choose market</option>{lookups.markets.map(r=><option key={String(r.ID)} value={String(r.ID)}>{label(r,'Market')}</option>)}</select><span id={'market-'+x.key} className="field-error">{x.errors.market}</span></label>
 <label>Currency *<select aria-label="Currency *" value={x.currency} onChange={e=>change(x.key,'currency',e.target.value)} aria-invalid={!!x.errors.currency} aria-describedby={'currency-'+x.key}><option value="">Choose currency</option>{lookups.currencies.map(r=><option key={String(r.ID)} value={String(r.ID)}>{label(r,'Currency')}</option>)}</select><span id={'currency-'+x.key} className="field-error">{x.errors.currency}</span></label></div>
 </fieldset></section>)}</div>
 <button className="add-section" type="button" disabled={busy||uncertain||entries.length>=500} onClick={()=>{const entry=blank(++sequence.current);setEntries(x=>[...x,entry])}}>+ Add customer section</button>
 <div className="actions batch-actions"><button type="submit" className="primary" disabled={busy||uncertain||!pending.length||!lookups.markets.length||!lookups.currencies.length}>Review & save</button></div>
 </form>
 {confirm&&<Modal label="Confirm customer save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Create {pending.length} {pending.length===1?'customer':'customers'}?</h2><ul className="batch-review">{pending.map(x=><li key={x.key}>{x.name.trim()}</li>)}</ul><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving…':'Confirm save'}</button></div></Modal>}
 </Modal>
}
