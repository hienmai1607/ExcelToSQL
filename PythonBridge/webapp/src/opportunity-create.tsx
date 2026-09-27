import {useEffect,useRef,useState,useMemo} from 'react';
import {ApiError,call,type Row} from './api';
import {Modal,ErrorNote,Badge} from './ui';
import {requirementFields,fieldValues,fieldPayload} from './packaging-fields';
import {IconButton} from './icons';

type Line={id?:number;version?:string;locked?:boolean;key:number;requirements:Record<string,string>;product:string;description:string;units:string;percent:string;price:string};
const blank=(key:number):Line=>({key,requirements:fieldValues(undefined,requirementFields),product:'',description:'',units:'',percent:'',price:''});
export function OpportunityCreate({onClose,onSaved,rows,focusItem}:{onClose:()=>void;onSaved:(number:string)=>void;rows?:Row[];focusItem?:number}){
 const header=rows?.[0],editing=!!header;
 const value=(x:unknown)=>x==null?'':String(x);
 const originals:Line[]=useMemo(()=>rows?rows.filter(r=>r.ItemID!=null).map((r,i)=>({key:i+2,id:Number(r.ItemID),version:value(r.ItemRowVersion),locked:r.ItemStage!=='Draft'||!!r.HasOpenPackagingRequest,requirements:fieldValues(r,requirementFields),product:value(r.ProductID),description:value(r.ItemDescription),units:value(r.AnnualUnit),percent:value(r.EstPctAwarded),price:value(r.ShelfPrice)})):[blank(2)],[rows]);
 const originalById=useMemo(()=>new Map(originals.map(x=>[x.id,x])),[originals]);
 const title=editing?'Edit Opportunity':'New Opportunity';
 const [lookups,setLookups]=useState<{customers:Row[];products:Row[];currencies?:Row[]}>({customers:[],products:[]}),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [customer,setCustomer]=useState(value(header?.CustomerID)),[description,setDescription]=useState(value(header?.OpportunityDesc)),[open,setOpen]=useState(value(header?.BidOpen).slice(0,10)),[closeDate,setCloseDate]=useState(value(header?.BidClose).slice(0,10));
 const [rate,setRate]=useState(value(header?.ExchangeRateVNDPerUSD)),[customerRate,setCustomerRate]=useState(value(header?.ExchangeRateCustomerCurrencyPerUSD));
 const customerCurrency=String(lookups.customers.find(c=>String(c.ID)===customer)?.CustomerCurrencyCode??(customer===value(header?.CustomerID)?header?.CustomerCurrencyCode:'')??'');
 const [lines,setLines]=useState<Line[]>(originals),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const sequence=useRef(originals.length+1),posting=useRef(false);
 const submitted=lines.filter(x=>!x.locked&&(!x.id||JSON.stringify(x)!==JSON.stringify(originalById.get(x.id))));
 const dirty=customerRate!==value(header?.ExchangeRateCustomerCurrencyPerUSD)||rate!==value(header?.ExchangeRateVNDPerUSD)||(editing?(customer!==value(header?.CustomerID)||description!==value(header?.OpportunityDesc)||open!==value(header?.BidOpen).slice(0,10)||closeDate!==value(header?.BidClose).slice(0,10)||submitted.length>0):!!(customer||description||open||closeDate||lines.length>1||lines.some(x=>x.product||x.description||x.units||x.percent||x.price||Object.values(x.requirements).some(Boolean))));
 useEffect(()=>{if(!loading&&focusItem)document.getElementById('opp-edit-item-'+focusItem)?.scrollIntoView({block:'center'})},[loading,focusItem]);
 useEffect(()=>{let active=true;setLoading(true);setError('');call<typeof lookups>('/api/opportunity/lookups').then(x=>{if(active)setLookups(x)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[retry]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved Opportunity?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved Opportunity?')))onClose()}
 function change(key:number,field:'product'|'description'|'units'|'percent'|'price',value:string){setLines(xs=>xs.map(x=>x.key===key?{...x,[field]:value}:x))}
 const products=lookups.products.filter(p=>String(p.CustomerID)===customer);
 function chooseCustomer(next:string){setCustomer(next);setCustomerRate('');setLines(xs=>xs.map(x=>({...x,product:lookups.products.some(p=>String(p.ID)===x.product&&String(p.CustomerID)===next)?x.product:''})));}
 function review(){
  const errors:string[]=[];
  if(submitted.length>500)errors.push('Save no more than 500 changed items at a time.');
  if(editing&&(header?.HeaderStage!=='Draft'||!header?.HeaderRowVersion)){setError('Only a Draft Opportunity with a current version can be edited. Refresh the overview.');return}
  if(!lookups.customers.some(x=>String(x.ID)===customer))errors.push('Choose an active customer.');
  if(!customerCurrency)errors.push('Maintain currency in Customer Master first.');
  if(!/^\d{1,13}(\.\d{1,6})?$/.test(rate)||Number(rate)<=0)errors.push('Enter a positive VND per USD rate (up to 6 decimals).');
  if(!/^\d{1,13}(\.\d{1,6})?$/.test(customerRate)||Number(customerRate)<=0)errors.push('Enter a positive Customer Currency per USD rate (up to 6 decimals).');
  if(!description.trim())errors.push('Enter an Opportunity description.');
  if(!open||!closeDate)errors.push('Enter both bid dates.');else if(closeDate<open)errors.push('Bid close must be on or after bid open.');
  for(const [i,x] of lines.entries()){
   const prefix='Item '+(i+1)+': ';
   if(editing&&!submitted.some(y=>y.key===x.key))continue;
   for(const f of requirementFields){const v=x.requirements[f.key];if(v&&f.numeric&&(!/^\d+(\.\d+)?$/.test(v)||(f.integer&&!/^\d+$/.test(v))))errors.push(prefix+f.label+': enter a valid nonnegative number.');}
   if(x.id&&!x.version)errors.push(prefix+'refresh to load the current version.');
   if(!products.some(p=>String(p.ID)===x.product)&&!(x.id&&originalById.get(x.id)?.product===x.product&&customer===value(header?.CustomerID)))errors.push(prefix+'choose an active product belonging to this Customer.');
   else if(lines.filter(y=>y.product===x.product).length>1)errors.push(prefix+'this product is already used in another item.');
   if(!x.description.trim())errors.push(prefix+'enter a description.');
   if(!/^\d+$/.test(x.units)||Number(x.units)>2147483647)errors.push(prefix+'annual units must be a whole number from 0 to 2,147,483,647.');
   if(x.percent&&(!/^\d{1,3}(\.\d{1,2})?$/.test(x.percent)||Number(x.percent)>100))errors.push(prefix+'estimated award must be 0 to 100, with up to two decimals.');
   if(x.price&&!/^\d{1,8}(\.\d{1,2})?$/.test(x.price))errors.push(prefix+'shelf price must be nonnegative, with up to eight whole digits and two decimals.');
  }
  setError(errors.join(' '));if(!errors.length)setConfirm(true);
 }
 async function save(){
  if(posting.current||uncertain)return;posting.current=true;setBusy(true);setError('');
  // This key connects the header and items inside one SQL transaction, not a retry token.
  const key=editing?String(header!.OpportunityNumber):'WEB-'+crypto.randomUUID().replaceAll('-','').slice(0,16);
  const changed=editing?submitted:lines;
  try{
   const result=await call<{header_results:Row[];item_results:Row[]}>('/api/opportunity/batch',{
    header_rows:[{RowNum:1,Command:editing?'U':'C',ID:editing?header!.OpportunityID:null,RowVersion:editing?header!.HeaderRowVersion:null,OpportunityNumber:key,CustomerID:Number(customer),ExchangeRateVNDPerUSD:rate,ExchangeRateCustomerCurrencyPerUSD:customerRate,OpportunityDesc:description.trim(),BidOpen:open,BidClose:closeDate}],
    item_rows:changed.map(x=>({...fieldPayload(x.requirements,requirementFields),RowNum:x.key,Command:x.id?'U':'C',ID:x.id||null,RowVersion:x.version||null,OpportunityNumber:key,ProductID:Number(x.product),ItemDescription:x.description.trim(),AnnualUnit:Number(x.units),EstPctAwarded:x.percent===''?null:Number(x.percent),ShelfPrice:x.price===''?null:Number(x.price)}))
   });
   const headers=result?.header_results,items=result?.item_results;
   if(!Array.isArray(headers)||!Array.isArray(items)||headers.length!==1||Number(headers[0].RowNum)!==1||items.length!==changed.length||changed.some(x=>items.filter(r=>Number(r.RowNum)===x.key).length!==1)||[...headers,...items].some(r=>!['OK','ERROR'].includes(String(r.Status)))){
    setUncertain(true);throw new Error('Save outcome unknown. Close and refresh the list before saving this Opportunity again.');
   }
   const failures=[...headers,...items].filter(r=>r.Status!=='OK');
   if(failures.length){setError([...new Set(failures.map(r=>String(r.Message||'The Opportunity was not saved.')))].join(' '));return}
   onSaved(String(headers[0].OpportunityNumber||header?.OpportunityNumber||'Opportunity'));onClose();
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Close and refresh the list before saving this Opportunity again.')}else setError((e as Error).message)}
  finally{posting.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label={title} className="dialog opportunity-editor opportunity-entry-dialog" onClose={close}>
  <div className="customer-editor-heading"><h2>{title}</h2><IconButton icon="close" label="Close Opportunity form" disabled={busy} onClick={close}/></div>
  <ErrorNote value={error}/>{loading?<p>Loading customers and products...</p>:(!lookups.customers.length||!lookups.products.length)&&<div className="notice">Active customers and products are required.<IconButton icon="refresh" label="Reload choices" onClick={()=>setRetry(n=>n+1)}/></div>}
  <form onSubmit={e=>{e.preventDefault();review()}}>
   <fieldset disabled={busy||uncertain||loading||(editing&&header?.HeaderStage!=='Draft')}><div className="panel opportunity-header-box"><section className="customer-entry" aria-label="Header Info"><header><h3>Header Info</h3><Badge value={header?.HeaderStage||"Draft"}/></header>
    <div className="opportunity-header-fields"><label>Customer *<select aria-label="Customer *" required value={customer} disabled={editing&&originals.some(x=>!!x.id)} onChange={e=>chooseCustomer(e.target.value)}><option value="">Choose customer</option>{customer&&!lookups.customers.some(x=>String(x.ID)===customer)&&<option value={customer}>{value(header?.CustomerName)} (unavailable)</option>}{lookups.customers.map(x=><option key={String(x.ID)} value={String(x.ID)}>{x.CustomerName}</option>)}</select></label>
    <label>Description *<input required maxLength={300} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <div className="opportunity-bid-dates"><label>Bid open *<input required type="date" max="9999-12-31" value={open} onChange={e=>setOpen(e.target.value)}/></label><label>Bid close *<input required type="date" min={open||undefined} max="9999-12-31" value={closeDate} onChange={e=>setCloseDate(e.target.value)}/></label></div>
    <label className="opportunity-currency">Customer currency<input aria-label="Customer currency" readOnly value={customerCurrency} placeholder="From Customer Master"/></label>
    <label className="opportunity-rate">Exchange rate VND per USD *<input aria-label="Exchange rate VND per USD *" required inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)}/><small>1 USD = this many VND</small></label>
    <label className="opportunity-rate">Exchange rate Customer Currency per USD *<input aria-label="Exchange rate Customer Currency per USD *" required inputMode="decimal" value={customerRate} onChange={e=>setCustomerRate(e.target.value)}/><small>1 USD = this many {customerCurrency||'customer currency units'}</small></label>
   <div className="opportunity-entry-summary" aria-label="Opportunity summary"><div><span>Items</span><strong>{lines.length}</strong></div><div><span>Available products</span><strong>{customer?products.length:"Choose customer"}</strong></div><div><span>Read-only items</span><strong>{lines.filter(x=>x.locked).length}</strong></div></div>
   </div></section></div>
   <section className="panel opportunity-entry-items" aria-label="Item Details"><div className="section-label"><h3>Item Details ({lines.length})</h3><IconButton icon="plus" label="Add item" disabled={lines.length>=500} onClick={()=>{const x=blank(++sequence.current);setLines(xs=>[...xs,x])}}/></div>
   <div className="opportunity-entry-list">{lines.map((x,i)=><section className="opportunity-entry-row" key={x.key} id={'opp-edit-item-'+(x.id||x.key)} aria-label={'Item '+(i+1)}><header><h3>Item {i+1}</h3>{x.locked&&<Badge value="Read only"/>}<IconButton icon="close" label={'Remove item '+(i+1)} disabled={!!x.id||lines.length===1} onClick={()=>setLines(xs=>xs.filter(y=>y.key!==x.key))}/></header>
    <fieldset className="opportunity-entry-fields" disabled={x.locked}><label>Product *<select aria-label="Product *" required disabled={!customer} value={x.product} onChange={e=>change(x.key,'product',e.target.value)}><option value="">Choose product</option>{x.product&&!products.some(p=>String(p.ID)===x.product)&&<option value={x.product}>{value(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductCode)} (unavailable)</option>}{products.map(p=><option key={String(p.ID)} value={String(p.ID)}>{p.ProductCode}</option>)}</select></label>
    <label>Item description *<input required maxLength={300} value={x.description} onChange={e=>change(x.key,'description',e.target.value)}/></label>
    <div className="opportunity-numbers"><label>Annual units *<input required inputMode="numeric" value={x.units} onChange={e=>change(x.key,'units',e.target.value)}/></label><label>Estimated award %<input inputMode="decimal" value={x.percent} onChange={e=>change(x.key,'percent',e.target.value)}/></label><label>Shelf price<input inputMode="decimal" value={x.price} onChange={e=>change(x.key,'price',e.target.value)}/></label></div>
   <details className="opportunity-requirements"><summary>Packaging requirements</summary><div className="packaging-entry-grid">{requirementFields.map(f=><label className={["ConfigurationRequest","SpecialComments"].includes(f.key)?"packaging-wide":undefined} key={f.key}>{f.label}<input aria-label={f.label} maxLength={f.max||24} inputMode={f.numeric?'decimal':undefined} value={x.requirements[f.key]||''} onChange={e=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,requirements:{...y.requirements,[f.key]:e.target.value}}:y))}/></label>)}</div></details>
   </fieldset></section>)}</div></section></fieldset>
   <div className="actions opportunity-entry-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy||uncertain||loading||(editing&&!dirty)||!lookups.customers.length||(!editing&&!products.length)}>Review & save</button></div>
  </form>
  {confirm&&<Modal label="Confirm Opportunity save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{editing?'Save Opportunity changes?':'Create this Opportunity?'}</h2><p>{description.trim()}</p><p>{editing?submitted.length:lines.length} {editing?'changed/new items':'items'} · Draft</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving...':'Confirm save'}</button></div></Modal>}
 </Modal>
}
