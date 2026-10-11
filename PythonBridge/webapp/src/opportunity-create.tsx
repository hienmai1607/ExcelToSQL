import {newId} from './id';
import {scrollExpandedSection,scrollExpandedItem} from './expand-scroll';
import {useEffect,useRef,useState,useMemo} from 'react';
import {ApiError,call,type Row} from './api';
import {Modal,ErrorNote,Badge,FieldLabel,Notification,Pager} from './ui';
import {useProfile} from './profile';
import {GradeSnapshotIcon,parseGradeSnapshot,type GradeSnapshot} from './opportunity-grade-snapshot';
import {RequirementSections,webRequirementValues,webRequirementPayload,requirementError,copyWebRequirements} from './requirement-sections';
import {IconButton} from './icons';
import {mixAnnualUnits} from './opportunity-mix';import {parseMixStructure} from './mix-structure';
import {decimalDisplay} from './number-format';
import {ShipmentSections,shipmentValues,shipmentPayload,shipmentError} from './shipment-sections';

type Line={shipment:Record<string,string>;grade?:GradeSnapshot|null;id?:number;version?:string;locked?:boolean;shipmentLocked?:boolean;parent?:number;quantity?:string;code?:string;name?:string;mixVersion?:number;snapshot?:boolean;key:number;requirements:Record<string,string>;product:string;description:string;units:string;percent:string;price:string};
const blank=(key:number):Line=>({key,shipment:shipmentValues(),requirements:webRequirementValues(),product:'',description:'',units:'',percent:'',price:''});
function PackagingCopy({sources,onCopy}:{sources:{key:number;label:string}[];onCopy:(key:number)=>void}){
 const [source,setSource]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false);
 const selected=sources.find(x=>String(x.key)===source);
 return <div className="packaging-copy"><IconButton icon="copy" label="Copy packaging" disabled={!sources.length} onClick={()=>{setSource('');setOpen(true)}}/>{open&&<Modal className="dialog packaging-copy-dialog" label="Choose packaging source" onClose={()=>setOpen(false)}><header className="copy-dialog-heading"><h2>Copy packaging</h2><IconButton icon="close" label="Close copy popup" onClick={()=>setOpen(false)}/></header><label><FieldLabel help="Replaces applicable packaging fields, including blanks. Product details and shelf life stay unchanged.">Copy from item</FieldLabel><select aria-label="Copy packaging from item" value={selected?source:''} onChange={e=>setSource(e.target.value)}><option value="">Choose another item</option>{sources.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label><div className="actions"><button type="button" className="primary" disabled={!selected} onClick={()=>{if(selected){onCopy(selected.key);setOpen(false);setNotice('Packaging copied from '+selected.label+'. Review before saving.')}}}>Copy packaging</button></div></Modal>}<Notification value={notice} onDismiss={()=>setNotice('')}/></div>;
}
export function OpportunityCreate({onClose,onSaved,rows,focusItem}:{onClose:()=>void;onSaved:(number:string)=>void;rows?:Row[];focusItem?:number}){
 const {profile,ready,saving:profileSaving,save:saveProfile}=useProfile();
 const [page,setPage]=useState(1),[size,setSize]=useState(profile.settings.opportunity?.editor_page_size??25),[message,setMessage]=useState('');
 const header=rows?.[0],editing=!!header;
 const value=(x:unknown)=>x==null?'':String(x);
 const originals:Line[]=useMemo(()=>{
  const items=rows?.filter(r=>r.ItemID!=null);
  return items?items.map((r,i)=>({key:i+2,id:Number(r.ItemID),version:value(r.ItemRowVersion),locked:r.ItemStage!=='Draft'||!!r.HasOpenPackagingRequest,shipmentLocked:r.ItemStage!=='Draft',parent:r.ParentItemID?items.findIndex(p=>p.ItemID===r.ParentItemID)+2:undefined,quantity:value(r.MixUnitQuantity),code:value(r.ProductCode),name:value(r.ProductName),snapshot:!!r.MixVersionID,shipment:shipmentValues(r.ShipmentCostInfo),requirements:webRequirementValues(r),product:value(r.ProductID),description:value(r.ItemDescription),units:r.ParentItemID?value(r.AnnualUnit):value(r.AnnualUnit).replace(/\.0+$/,''),percent:value(r.EstPctAwarded),price:value(r.ShelfPrice)})):[blank(2)];
 },[rows]);
 const originalById=useMemo(()=>new Map(originals.map(x=>[x.id,x])),[originals]);
 const title=editing?'Edit Opportunity':'New Opportunity';
 const [lookups,setLookups]=useState<{customers:Row[];products:Row[];currencies?:Row[];ports?:Row[];mix_children?:Row[];pallets?:Row[];packagingTypes?:Row[]}>({customers:[],products:[]}),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [customer,setCustomer]=useState(value(header?.CustomerID)),[description,setDescription]=useState(value(header?.OpportunityDesc)),[open,setOpen]=useState(value(header?.BidOpen).slice(0,10)),[closeDate,setCloseDate]=useState(value(header?.BidClose).slice(0,10));
 const [rate,setRate]=useState(value(header?.ExchangeRateVNDPerUSD)),[customerRate,setCustomerRate]=useState(value(header?.ExchangeRateCustomerCurrencyPerUSD));
 const customerCurrency=String(lookups.customers.find(c=>String(c.ID)===customer)?.CustomerCurrencyCode??(customer===value(header?.CustomerID)?header?.CustomerCurrencyCode:'')??'');
 const [lines,setLines]=useState<Line[]>(originals),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const sequence=useRef(originals.length+1),posting=useRef(false);
 const [expanded,setExpanded]=useState<Set<number>>(new Set());
 const roots=lines.filter(x=>!x.parent);
 const activePage=Math.min(page,Math.max(1,Math.ceil(roots.length/size)));
 const pageRoots=new Set(roots.slice((activePage-1)*size,activePage*size).map(x=>x.key));
 async function savePageSize(){try{await saveProfile({...profile.settings,opportunity:{...profile.settings.opportunity,editor_page_size:size}});setMessage('Edit view item page size saved to your profile.')}catch(e){setError((e as Error).message)}}
 function itemNumber(x:Line){return x.parent?(roots.findIndex(r=>r.key===x.parent)+1)+'.'+(lines.filter(c=>c.parent===x.parent).findIndex(c=>c.key===x.key)+1):String(roots.findIndex(r=>r.key===x.key)+1)}
 function copyPackaging(targetKey:number,sourceKey:number){
  setLines(xs=>{const source=xs.find(x=>x.key===sourceKey);return source?xs.map(x=>x.key===targetKey&&!x.locked?{...x,requirements:copyWebRequirements(x.requirements,source.requirements,!!x.parent,!!source.parent)}:x):xs});
 }
 const shipmentOnly=(x:Line)=>!!x.locked&&!x.parent&&!x.shipmentLocked;
 const submitted=lines.filter(x=>(!x.locked&&(!x.parent||x.id)&&(!x.id||JSON.stringify(x)!==JSON.stringify(originalById.get(x.id))))||(shipmentOnly(x)&&JSON.stringify(x.shipment)!==JSON.stringify(originalById.get(x.id)?.shipment)));
 const dirty=customerRate!==value(header?.ExchangeRateCustomerCurrencyPerUSD)||rate!==value(header?.ExchangeRateVNDPerUSD)||(editing?(customer!==value(header?.CustomerID)||description!==value(header?.OpportunityDesc)||open!==value(header?.BidOpen).slice(0,10)||closeDate!==value(header?.BidClose).slice(0,10)||submitted.length>0):!!(customer||description||open||closeDate||lines.length>1||lines.some(x=>x.product||x.description||x.units||x.percent||x.price||Object.values(x.requirements).some(Boolean)||Object.entries(x.shipment).some(([key,value])=>key!=='MarginMode'&&!!value))));
 useEffect(()=>{if(!focusItem)return;const target=originals.find(x=>x.id===focusItem);if(!target)return;const index=originals.filter(x=>!x.parent).findIndex(x=>x.key===(target.parent??target.key));setPage(Math.floor(Math.max(0,index)/size)+1);if(target.parent)setExpanded(xs=>new Set([...xs,target.parent!]));},[focusItem,size,originals]);
 useEffect(()=>{if(!loading&&focusItem)document.getElementById('opp-edit-item-'+focusItem)?.scrollIntoView({block:'center'})},[loading,focusItem,activePage]);
 useEffect(()=>{let active=true;setLoading(true);setError('');call<typeof lookups>('/api/opportunity/lookups').then(x=>{if(active)setLookups(x)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[retry]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved Opportunity?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved Opportunity?')))onClose()}
 function change(key:number,field:'product'|'units'|'percent'|'price',value:string){
  if(field!=='product'){setLines(xs=>xs.map(x=>x.key===key?{...x,[field]:value}:x));return}
  const children=(lookups.mix_children||[]).filter(c=>String(c.ParentProductID)===value);
  setLines(xs=>xs.filter(x=>x.parent!==key).flatMap(x=>x.key===key?[
   {...x,product:value,grade:null,mixVersion:children.length?Number(children[0].MixVersionID):undefined},
   ...children.map(c=>({...blank(++sequence.current),parent:key,product:String(c.ProductID),code:String(c.ProductCode),name:String(c.ProductName),description:String(c.ProductName),quantity:String(c.UnitQuantity)}))
  ]:[x]));
  setExpanded(xs=>new Set([...xs,key]));
 }
 const products=lookups.products.filter(p=>String(p.CustomerID)===customer);
 function chooseCustomer(next:string){setCustomer(next);setCustomerRate('');setLines(xs=>xs.filter(x=>!x.parent).map(x=>({...x,shipment:{...x.shipment,PortOfEntryID:''},product:lookups.products.some(p=>String(p.ID)===x.product&&String(p.CustomerID)===next)?x.product:'',mixVersion:undefined})));}
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
   if(editing&&!submitted.some(y=>y.key===x.key)&&!(x.parent&&!x.id))continue;
   const requirementsError=requirementError(x.requirements,originalById.get(x.id)?.requirements,lookups.packagingTypes||[],lookups.pallets||[],!!x.parent,!x.parent&&!!(x.mixVersion||x.snapshot||lookups.products.find(p=>String(p.ID)===x.product)?.IsMix));
   if(!shipmentOnly(x)&&requirementsError)errors.push(prefix+requirementsError);
   if(x.parent)continue; if(!x.locked){if(!x.requirements.PalletSize.trim())errors.push(prefix+'Pallet size is required.');if(!['20DC','20RC','40DC','40HC','40RHC'].includes(x.requirements.ContainerRequest))errors.push(prefix+'Container Type is required.');}
   const shipmentIssue=shipmentError(x.shipment,originalById.get(x.id)?.shipment,lookups.customers.find(c=>String(c.ID)===customer),lookups.ports||[]);
   if(shipmentIssue)errors.push(prefix+shipmentIssue);
   if(x.id&&!x.version)errors.push(prefix+'refresh to load the current version.');
   if(shipmentOnly(x))continue;
   if(!products.some(p=>String(p.ID)===x.product)&&!(x.id&&originalById.get(x.id)?.product===x.product&&customer===value(header?.CustomerID)))errors.push(prefix+'choose an active product belonging to this Customer.');
   else if(roots.filter(y=>y.product===x.product).length>1)errors.push(prefix+'this product is already used in another item.');
   if(!/^\d+$/.test(x.units)||Number(x.units)>2147483647)errors.push(prefix+'annual units must be a whole number from 0 to 2,147,483,647.');
   if(x.percent&&(!/^\d{1,3}(\.\d{1,2})?$/.test(x.percent)||Number(x.percent)>100))errors.push(prefix+'estimated award must be 0 to 100, with up to two decimals.');
   if(x.price&&!/^\d{1,8}(\.\d{1,2})?$/.test(x.price))errors.push(prefix+'shelf price must be nonnegative, with up to eight whole digits and two decimals.');
  }
  setError(errors.join(' '));if(!errors.length)setConfirm(true);
 }
 async function save(){
  if(posting.current||uncertain)return;posting.current=true;setBusy(true);setError('');
  // This key connects the header and items inside one SQL transaction, not a retry token.
  const key=editing?String(header!.OpportunityNumber):'WEB-'+newId().replaceAll('-','').slice(0,16);
  const changed=editing?submitted:roots;
  try{
   const result=await call<{header_results:Row[];item_results:Row[]}>('/api/opportunity/batch',{
    header_rows:[{RowNum:1,Command:editing?'U':'C',ID:editing?header!.OpportunityID:null,RowVersion:editing?header!.HeaderRowVersion:null,OpportunityNumber:key,CustomerID:Number(customer),ExchangeRateVNDPerUSD:rate,ExchangeRateCustomerCurrencyPerUSD:customerRate,OpportunityDesc:description.trim(),BidOpen:open,BidClose:closeDate}],
    item_rows:changed.map(x=>shipmentOnly(x)?{RowNum:x.key,Command:'U',ID:x.id,RowVersion:x.version,OpportunityNumber:key,ShipmentCostInfo:shipmentPayload(x.shipment)}:({...webRequirementPayload(x.requirements,!!x.parent),...(!x.parent?{ShipmentCostInfo:shipmentPayload(x.shipment)}:{}),...(x.grade!==undefined?{ProductGradeSnapshot:x.grade}:{}),RowNum:x.key,Command:x.id?'U':'C',ID:x.id||null,RowVersion:x.version||null,OpportunityNumber:key,...(x.parent?{}:{ProductID:Number(x.product),AnnualUnit:Number(x.units),EstPctAwarded:x.percent===''?null:Number(x.percent),ShelfPrice:x.price===''?null:Number(x.price)}),...(x.mixVersion?{MixVersionID:x.mixVersion,MixChildren:lines.filter(c=>c.parent===x.key).map(c=>({ProductID:Number(c.product),...webRequirementPayload(c.requirements,true),...(c.grade!==undefined?{ProductGradeSnapshot:c.grade}:{})}))}:{})}))
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
 return <Modal label={title} className="dialog opportunity-editor opportunity-entry-dialog record-dialog" onClose={close}>
  <div className="customer-editor-heading"><h2>{title}</h2><IconButton icon="close" label="Close Opportunity form" disabled={busy} onClick={close}/></div>
  <ErrorNote value={error}/>{loading?<p>Loading customers and products...</p>:(!lookups.customers.length||!lookups.products.length)&&<div className="notice">Active customers and products are required.<IconButton icon="refresh" label="Reload choices" onClick={()=>setRetry(n=>n+1)}/></div>}
  <form noValidate className="record-dialog-form" onSubmit={e=>{e.preventDefault();review()}}>
   <div className="record-dialog-content"><fieldset className={editing&&header?.HeaderStage!=='Draft'?'display-only-fields':undefined} disabled={busy||uncertain||loading||(editing&&header?.HeaderStage!=='Draft')}><div className="panel opportunity-header-box"><section className="customer-entry" aria-label="Header Info"><header><h3>Header Info</h3><Badge value={header?.HeaderStage||"Draft"}/></header>
    <div className="opportunity-header-fields"><label>Customer *<select aria-label="Customer *" required value={customer} disabled={editing&&originals.some(x=>!!x.id)} onChange={e=>chooseCustomer(e.target.value)}><option value="">Choose customer</option>{customer&&!lookups.customers.some(x=>String(x.ID)===customer)&&<option value={customer}>{value(header?.CustomerName)} (unavailable)</option>}{lookups.customers.map(x=><option key={String(x.ID)} value={String(x.ID)}>{x.CustomerName}</option>)}</select></label>
    <label>Description *<input required maxLength={300} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <div className="opportunity-bid-dates"><label>Bid open *<input required type="date" max="9999-12-31" value={open} onChange={e=>setOpen(e.target.value)}/></label><label>Bid close *<input required type="date" min={open||undefined} max="9999-12-31" value={closeDate} onChange={e=>setCloseDate(e.target.value)}/></label></div>
    <label className="opportunity-currency">Customer currency<input aria-label="Customer currency" readOnly value={customerCurrency} placeholder="From Customer Master"/></label>
    <label className="opportunity-rate"><FieldLabel help="1 USD = this many VND">VND / USD *</FieldLabel><input aria-label="Exchange rate VND per USD *" required inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)}/></label>
    <label className="opportunity-rate"><FieldLabel help={'1 USD = this many '+(customerCurrency||'customer currency units')}>Customer currency / USD *</FieldLabel><input aria-label="Exchange rate Customer Currency per USD *" required inputMode="decimal" value={customerRate} onChange={e=>setCustomerRate(e.target.value)}/></label>
<div className="opportunity-entry-summary" aria-label="Opportunity summary"><div><span>Items</span><strong>{roots.length}{lines.length>roots.length?' + '+(lines.length-roots.length)+' mix children':''}</strong></div><div><span>Available products</span><strong>{customer?products.length:"Choose customer"}</strong></div><div><span>Read-only items</span><strong>{lines.filter(x=>x.locked).length}</strong></div></div>
   </div></section></div>
   <section className="panel opportunity-entry-items" aria-label="Item Details"><div className="section-label"><h3>Item Details ({roots.length})</h3><IconButton icon="plus" label="Add item" disabled={roots.length>=500} onClick={()=>{const x=blank(++sequence.current);setLines(xs=>[...xs,x]);setPage(Math.ceil((roots.length+1)/size))}}/></div>
   <div className="opportunity-entry-list">{lines.filter(x=>pageRoots.has(x.parent??x.key)&&(!x.parent||expanded.has(x.parent))).map(x=>{
    const parent=lines.find(p=>p.key===x.parent),children=lines.filter(c=>c.parent===x.key);
    const number=itemNumber(x);
    const units=x.parent?decimalDisplay(mixAnnualUnits(parent?.units||'',x.quantity||''),4)||'':x.units;
    const selectedProduct=lookups.products.find(p=>String(p.ID)===x.product)??lookups.mix_children?.find(p=>String(p.ProductID)===x.product);
    const savedProduct=originalById.get(x.id)?.product===x.product?rows?.find(r=>Number(r.ItemID)===x.id):undefined;
    const netWeight=savedProduct?savedProduct.WeightGrams:selectedProduct?.WeightGrams;const capturedMix=parseMixStructure(savedProduct?.MixStructure);const mix=!x.parent&&(children.length||x.mixVersion||selectedProduct?.IsMix)?{MixVersionID:x.mixVersion,items:children.map(c=>{const saved=capturedMix?.items.find(i=>Number(i.ProductID)===Number(c.product)),choice=lookups.products.find(p=>String(p.ID)===c.product)??lookups.mix_children?.find(p=>String(p.ProductID)===c.product);return {...saved,ProductID:Number(c.product),ProductCode:c.code??choice?.ProductCode,ProductName:c.name??choice?.ProductName,UnitQuantity:c.quantity,WeightGrams:rows?.find(r=>Number(r.ItemID)===c.id)?.WeightGrams??choice?.WeightGrams,ProductGradeSnapshot:c.grade!==undefined?c.grade:saved?.ProductGradeSnapshot??choice?.ProductGradeSnapshot};})}:null;
    const shelfLife=selectedProduct&&'ShelfLifeDays' in selectedProduct?selectedProduct.ShelfLifeDays:x.requirements.ShelfLifeDays;
    return <section className={'opportunity-entry-row'+(x.parent?' opportunity-mix-child':'')} key={x.key} id={'opp-edit-item-'+(x.id||x.key)} aria-label={'Item '+number}><header><h3>Item {number}</h3>{x.locked&&<Badge value={shipmentOnly(x)?"Packaging locked":"Read only"}/>}{!x.parent&&<IconButton icon="close" label={'Remove item '+number} disabled={!!x.id||roots.length===1} onClick={()=>setLines(xs=>xs.filter(y=>y.key!==x.key&&y.parent!==x.key))}/>}</header>
    <div className="opportunity-entry-fields"><fieldset className={"opportunity-protected-fields"+(x.locked?" display-only-fields":"")} disabled={x.locked}><section className="opportunity-product-section" aria-label="Product Info"><h4>Product Info</h4><div className="opportunity-product-fields">{x.parent?<label>Product<input aria-label="Product" readOnly value={(x.code||'')+' — '+(x.name||'')}/></label>:<label>Product *<select className={x.snapshot?"display-value":undefined} aria-label="Product *" required disabled={!customer||x.snapshot} value={x.product} onChange={e=>change(x.key,'product',e.target.value)}><option value="">Choose product</option>{x.product&&!products.some(p=>String(p.ID)===x.product)&&<option value={x.product}>{value(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductCode)} &mdash; {value(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductName)} (unavailable)</option>}{products.map(p=><option key={String(p.ID)} value={String(p.ID)}>{p.ProductCode} &mdash; {p.ProductName}</option>)}</select></label>}
    <label>Net weight (g)<input aria-label="Net weight (g)" readOnly value={decimalDisplay(netWeight,2)||''}/></label>
    <div className="opportunity-numbers"><label><FieldLabel help={x.parent?'Parent annual units × '+decimalDisplay(x.quantity,4)+' mix quantity.':undefined}>Annual units{x.parent?'':' *'}</FieldLabel><input aria-label={x.parent?'Annual units':'Annual units *'} required={!x.parent} readOnly={!!x.parent} disabled={!x.parent&&children.some(c=>c.locked)} inputMode="numeric" value={units} onChange={e=>change(x.key,'units',e.target.value)}/></label>{!x.parent&&<><label>Estimated award %<input inputMode="decimal" value={x.percent} onChange={e=>change(x.key,'percent',e.target.value)}/></label><label className="estimated-award-units">Estimated awarded units<input aria-label="Estimated awarded units" readOnly value={x.percent.trim()!==''&&x.units.trim()!==''&&Number.isFinite(Number(x.percent))&&Number.isFinite(Number(x.units))?(decimalDisplay(Number(x.units)*Number(x.percent)/100,4)||''):''}/></label><label>Shelf price ({customerCurrency||'customer currency'})<input aria-label="Shelf price" inputMode="decimal" value={x.price} onChange={e=>change(x.key,'price',e.target.value)}/></label></>}</div>
   <div className="opportunity-product-info requirement-sections"><div className="packaging-entry-grid"><label>Shelf life (days)<input aria-label="Shelf life (days)" readOnly value={decimalDisplay(shelfLife,0)||''}/></label><GradeSnapshotIcon mix={mix} productID={Number(x.product)} value={x.grade!==undefined?x.grade:parseGradeSnapshot(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductGradeSnapshot)} onChange={x.locked?undefined:grade=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,grade}:y))}/></div></div></div></section>
   <details className="opportunity-requirements" onToggle={scrollExpandedSection}><summary>Packaging requirements</summary>
    <PackagingCopy sources={lines.filter(y=>y.key!==x.key&&!!y.product).map(y=>{const product=lookups.products.find(p=>String(p.ID)===y.product)??lookups.mix_children?.find(p=>String(p.ProductID)===y.product);return {key:y.key,label:'Item '+itemNumber(y)+' - '+(y.code||product?.ProductCode||'')+' - '+(y.name||product?.ProductName||y.description)}})} onCopy={source=>copyPackaging(x.key,source)}/>
    <RequirementSections mix={mix} showShipment={false} values={x.requirements} types={lookups.packagingTypes} pallets={lookups.pallets} child={!!x.parent} shelfLife={shelfLife} row={rows?.find(r=>Number(r.ItemID)===x.id)} onChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,requirements:{...y.requirements,[key]:value}}:y))}/>
   </details>
   </fieldset><fieldset className={"opportunity-protected-fields"+(x.shipmentLocked||x.parent?" display-only-fields":"")} disabled={!!x.shipmentLocked}><details className="opportunity-requirements" onToggle={scrollExpandedSection}><summary><FieldLabel help={x.parent?'Inherited from the Mix parent. Children do not maintain shipment or cost inputs.':'Costs are USD except import clearance, entered in customer currency per pallet. New Packaging Requests capture Container Type and Loading request. Pallet size and Container Type are required.'}>Shipment, Logistics, Co-Man &amp; Others info</FieldLabel></summary><ShipmentSections values={(lines.find(y=>y.key===x.parent)??x).shipment} requirements={(lines.find(y=>y.key===x.parent)??x).requirements} customer={lookups.customers.find(c=>String(c.ID)===customer)} currency={customerCurrency} exchangeRate={customerCurrency==='VND'?rate:customerRate} ports={lookups.ports} child={!!x.parent} requirementsLocked={!!x.locked} onChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,shipment:{...y.shipment,[key]:value}}:y))} onRequirementChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,requirements:{...y.requirements,[key]:value}}:y))}/></details>
   </fieldset></div>{children.length>0&&<button type="button" className="link mix-child-toggle" aria-label={'Show mix children for Item '+number} aria-expanded={expanded.has(x.key)} onClick={event=>{const expanding=!expanded.has(x.key);setExpanded(prev=>{const next=new Set(prev);next.has(x.key)?next.delete(x.key):next.add(x.key);return next});if(expanding)scrollExpandedItem(event.currentTarget)}}>{expanded.has(x.key)?'▾':'▸'} Mix children ({children.length})</button>}</section>;
   })}</div></section></fieldset></div>
   <footer className="record-dialog-footer opportunity-entry-actions"><Pager page={activePage} size={size} total={roots.length} busy={busy||uncertain||loading} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="items"/><div className="actions record-action-bar"><IconButton icon="save" label="Save item page size to profile" disabled={!ready||profileSaving||busy} onClick={savePageSize}/><button className="primary" disabled={busy||uncertain||loading||(editing&&!dirty)||!lookups.customers.length||(!editing&&!products.length)}>Review & save</button></div></footer>
  </form>
  <Notification value={message} onDismiss={()=>setMessage('')}/>{confirm&&<Modal label="Confirm Opportunity save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{editing?'Save Opportunity changes?':'Create this Opportunity?'}</h2><p>{description.trim()}</p><p>{editing?submitted.length:roots.length} {editing?'changed/new items':'items'} · Draft</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving...':'Confirm save'}</button></div></Modal>}
 </Modal>
}
