import {DateInput} from './date-input';
import {AddMasterButton,canCreateMaster} from './add-master-button';
import {InlineMasterCreate} from './inline-master-create';
import {useSession} from './session';
import {pageAccess} from './workspace-access';
import {newId} from './id';
import {scrollExpandedSection,scrollExpandedItem} from './expand-scroll';
import {useEffect,useRef,useState,useMemo} from 'react';
import {ApiError,call,type Row} from './api';
import {Modal,ErrorNote,Badge,FieldLabel,Notification,Pager} from './ui';
import {useProfile} from './profile';
import {GradeSnapshotIcon,parseGradeSnapshot,type GradeSnapshot} from './opportunity-grade-snapshot';
import {RequirementSections,webRequirementValues,webRequirementPayload,requirementError,copyWebRequirements} from './requirement-sections';
import {IconButton} from './icons';
import {mixAnnualUnits,mixNetWeight} from './opportunity-mix';import {parseMixStructure,withMixPacking} from './mix-structure';
import {decimalDisplay} from './number-format';
import {ShipmentSections,shipmentValues,shipmentPayload,shipmentError,scopedShipment,type ShipmentScope} from './shipment-sections';
import {OpportunityEntryTabs,OpportunityItemSummary,type EntryTab,type EntrySummary} from './opportunity-testing-layout';
import './opportunity-testing-layout.css';

// Hard rollback: disable the experiment; stored preferences cannot re-enable it.
export const opportunityTestingLayoutEnabled=false;
export const defaultOpportunityTestingLayout=false;

type Line={weight?:string;refreshWeight?:boolean;shipment:Record<string,string>;grade?:GradeSnapshot|null;id?:number;version?:string;locked?:boolean;shipmentLocked?:boolean;parent?:number;quantity?:string;code?:string;name?:string;mixVersion?:number;snapshot?:boolean;key:number;requirements:Record<string,string>;product:string;description:string;units:string;percent:string;price:string};
const blank=(key:number):Line=>({key,shipment:shipmentValues(),requirements:webRequirementValues(),product:'',description:'',units:'',percent:'',price:''});
function PackagingCopy({sources,onCopy}:{sources:{key:number;label:string}[];onCopy:(key:number)=>void}){
 const [source,setSource]=useState(''),[notice,setNotice]=useState(''),[open,setOpen]=useState(false);
 const selected=sources.find(x=>String(x.key)===source);
 return <div className="packaging-copy"><IconButton icon="copy" label="Copy packaging" disabled={!sources.length} onClick={()=>{setSource('');setOpen(true)}}/>{open&&<Modal className="dialog packaging-copy-dialog" label="Choose packaging source" onClose={()=>setOpen(false)}><header className="copy-dialog-heading"><h2>Copy packaging</h2><IconButton icon="close" label="Close copy popup" onClick={()=>setOpen(false)}/></header><label><FieldLabel help="Replaces applicable packaging fields, including blanks. Product details and shelf life stay unchanged.">Copy from item</FieldLabel><select aria-label="Copy packaging from item" value={selected?source:''} onChange={e=>setSource(e.target.value)}><option value="">Choose another item</option>{sources.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label><div className="actions"><button type="button" className="primary" disabled={!selected} onClick={()=>{if(selected){onCopy(selected.key);setOpen(false);setNotice('Packaging copied from '+selected.label+'. Review before saving.')}}}>Copy packaging</button></div></Modal>}<Notification value={notice} onDismiss={()=>setNotice('')}/></div>;
}
export function OpportunityCreate({onClose,onSaved,rows,focusItem}:{onClose:()=>void;onSaved:(number:string)=>void;rows?:Row[];focusItem?:number}){
 const session=useSession();
 const canAddCustomer=(session.is_admin||session.scopes.includes('Customer'))&&pageAccess(session,'customers',true);
 const canAddProduct=(session.is_admin||session.scopes.includes('Product'))&&pageAccess(session,'products',true);
 const [inlineMaster,setInlineMaster]=useState<{entity:'customers'|'products'|'ports';line?:number;product?:string;port?:string}|null>(null),[refreshingMaster,setRefreshingMaster]=useState(false),[masterReloadRequired,setMasterReloadRequired]=useState(false);
 const {profile,ready,saving:profileSaving,save:saveProfile}=useProfile();
 const [page,setPage]=useState(1),[size,setSize]=useState(profile.settings.opportunity?.editor_page_size??25),[message,setMessage]=useState('');
 const header=rows?.[0],editing=!!header;
 const value=(x:unknown)=>x==null?'':String(x);
 const originals:Line[]=useMemo(()=>{
  const items=rows?.filter(r=>r.ItemID!=null);
  return items?items.map((r,i)=>({key:i+2,id:Number(r.ItemID),version:value(r.ItemRowVersion),locked:r.ItemStage!=='Draft'||!!r.HasOpenPackagingRequest,shipmentLocked:r.ItemStage!=='Draft',parent:r.ParentItemID?items.findIndex(p=>p.ItemID===r.ParentItemID)+2:undefined,quantity:value(r.MixUnitQuantity),code:value(r.ProductCode),name:value(r.ProductName),snapshot:!!r.MixVersionID,shipment:shipmentValues(r.ParentItemID?r.OwnShipmentCostInfo:r.ShipmentCostInfo),requirements:webRequirementValues(r),product:value(r.ProductID),description:value(r.ItemDescription),units:r.ParentItemID?value(r.AnnualUnit):value(r.AnnualUnit).replace(/\.0+$/,''),percent:value(r.EstPctAwarded),price:value(r.ShelfPrice)})):[blank(2)];
 },[rows]);
 const originalById=useMemo(()=>new Map(originals.map(x=>[x.id,x])),[originals]);
 const title=editing?'Edit Opportunity':'New Opportunity';
 const [lookups,setLookups]=useState<{customers:Row[];products:Row[];unready_products?:Row[];currencies?:Row[];ports?:Row[];mix_children?:Row[];pallets?:Row[];packagingTypes?:Row[]}>({customers:[],products:[]}),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [customer,setCustomer]=useState(value(header?.CustomerID)),[description,setDescription]=useState(value(header?.OpportunityDesc)),[open,setOpen]=useState(value(header?.BidOpen).slice(0,10)),[closeDate,setCloseDate]=useState(value(header?.BidClose).slice(0,10));
 const [rate,setRate]=useState(value(header?.ExchangeRateVNDPerUSD)),[customerRate,setCustomerRate]=useState(value(header?.ExchangeRateCustomerCurrencyPerUSD));
 const customerCurrency=String(lookups.customers.find(c=>String(c.ID)===customer)?.CustomerCurrencyCode??(customer===value(header?.CustomerID)?header?.CustomerCurrencyCode:'')??'');
 const [lines,setLines]=useState<Line[]>(originals),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const layoutKey='bridge.opportunityLayout.'+(session.user_id??session.username);
 const [testingLayout,setTestingLayout]=useState(()=>{if(!opportunityTestingLayoutEnabled)return false;try{return (localStorage.getItem(layoutKey)??(defaultOpportunityTestingLayout?'testing':'current'))==='testing'}catch{return defaultOpportunityTestingLayout}});
 const [entryTab,setEntryTab]=useState<EntryTab>('product'),[focusedItem,setFocusedItem]=useState<number|null>(()=>focusItem?originals.find(x=>x.id===focusItem)?.key??null:null),[headerExpanded,setHeaderExpanded]=useState(!focusItem);
 const entryScroll=useRef<HTMLDivElement>(null);
 const scrollToEntryTop=()=>requestAnimationFrame(()=>entryScroll.current?.scrollTo({top:0}));
 function switchLayout(testing:boolean){testing=testing&&opportunityTestingLayoutEnabled;if(!testing&&focusedItem!==null){const child=lines.find(x=>x.key===focusedItem);if(child?.parent)setExpanded(xs=>new Set([...xs,child.parent!]));}setTestingLayout(testing);try{localStorage.setItem(layoutKey,testing?'testing':'current')}catch{/* Layout choice does not affect saving. */}}
 function editItem(key:number){setFocusedItem(key);setHeaderExpanded(!customer);scrollToEntryTop()}
 function changeEntryTab(tab:EntryTab){setEntryTab(tab);scrollToEntryTop()}
 function addItem(){const x=blank(++sequence.current);setLines(xs=>[...xs,x]);setPage(Math.ceil((roots.length+1)/size));if(testingLayout){setEntryTab('product');editItem(x.key)}}
 const masterRefreshSequence=useRef(0);
 const draftRef=useRef({customer,lines});draftRef.current={customer,lines};
 const sequence=useRef(originals.length+1),posting=useRef(false);
 const [expanded,setExpanded]=useState<Set<number>>(new Set());
 const roots=lines.filter(x=>!x.parent);
 const focusedEntry=lines.find(x=>x.key===focusedItem);
 useEffect(()=>{if(focusedItem!==null&&!lines.some(x=>x.key===focusedItem))setFocusedItem(null)},[lines,focusedItem]);
 const activePage=Math.min(page,Math.max(1,Math.ceil(roots.length/size)));
 const pageRoots=new Set(roots.slice((activePage-1)*size,activePage*size).map(x=>x.key));
 async function savePageSize(){try{await saveProfile({...profile.settings,opportunity:{...profile.settings.opportunity,editor_page_size:size}});setMessage('Edit view item page size saved to your profile.')}catch(e){setError((e as Error).message)}}
 function itemNumber(x:Line){return x.parent?(roots.findIndex(r=>r.key===x.parent)+1)+'.'+(lines.filter(c=>c.parent===x.parent).findIndex(c=>c.key===x.key)+1):String(roots.findIndex(r=>r.key===x.key)+1)}
 function copyPackaging(targetKey:number,sourceKey:number){
  setLines(xs=>{const source=xs.find(x=>x.key===sourceKey);return source?xs.map(x=>x.key===targetKey&&!x.locked?{...x,requirements:copyWebRequirements(x.requirements,source.requirements,!!x.parent,!!source.parent)}:x):xs});
 }
 const shipmentOnly=(x:Line)=>!!x.locked&&!x.shipmentLocked;
 const shipmentScope=(x:Line):ShipmentScope=>x.parent?'child-others':lines.some(c=>c.parent===x.key)||x.mixVersion||x.snapshot||lookups.products.find(p=>String(p.ID)===x.product)?.IsMix?'mix-parent':'all';
 function itemWeight(x:Line):unknown{
  const children=lines.filter(c=>c.parent===x.key);
  if(!x.parent&&(children.length||x.mixVersion||x.snapshot||lookups.products.find(p=>String(p.ID)===x.product)?.IsMix))return mixNetWeight(children.map(c=>({WeightGrams:itemWeight(c),UnitQuantity:c.quantity})));
  const captured=rows?.find(r=>Number(r.ItemID)===x.id&&String(r.ProductID)===x.product);
  const product=lookups.products.find(r=>String(r.ID)===x.product)??lookups.mix_children?.find(r=>String(r.ProductID)===x.product);
  return x.weight??(!x.refreshWeight&&captured?captured.WeightGrams:product?.WeightGrams);
 }
 function summary(x:Line):EntrySummary{
  const source=lookups.products.find(p=>String(p.ID)===x.product)??lookups.mix_children?.find(p=>String(p.ProductID)===x.product),captured=rows?.find(r=>Number(r.ItemID)===x.id&&String(r.ProductID)===x.product);
  const children=lines.filter(c=>c.parent===x.key),parent=lines.find(p=>p.key===x.parent),shared=parent??x;
  const layers=Math.max(1,Math.min(4,Number(x.requirements.PackagingLayerCount)||2));
  const factors=['NumberOfPrimary','NumberOfSecondary','NumberOfTertiary'].slice(0,layers-1).map(k=>x.requirements[k]||'?');
  const types=['Primary','Secondary','Tertiary','Quaternary'].slice(0,layers).map(order=>String(lookups.packagingTypes?.find(t=>String(t.ID)===x.requirements[order+'TypeID'])?.PackagingType??captured?.[order+'TypeName']??'—')).join(' / ');
  const code=String(source?.ProductCode??captured?.ProductCode??x.code??''),name=String(source?.ProductName??captured?.ProductName??x.name??'');
  return {key:x.key,number:itemNumber(x),parent:x.parent,product:[code,name].filter(Boolean).join(' · '),kind:x.parent?'Child of Item '+itemNumber(parent!):children.length?'Mix · '+children.length+' child products':'Standalone product',weight:decimalDisplay(itemWeight(x),2)||'—',quantity:x.parent?decimalDisplay(x.quantity,4)||'—':'—',annual:decimalDisplay(x.parent?mixAnnualUnits(parent?.units||'',x.quantity||''):x.units,4)||'—',packing:[...factors,'1'].join(' × '),types,pallet:x.parent?'Parent item':x.requirements.PalletSize||'—',height:x.parent?'—':x.requirements.MaxPalletHeightMM||'—',comments:x.parent?'—':x.requirements.PalletSpecialComments||'—',container:shared.requirements.ContainerRequest||'—',loading:shared.requirements.ConfigurationRequest||'—',incoterm:shared.shipment.Incoterm||'—',port:String(lookups.ports?.find(p=>String(p.ID)===shared.shipment.PortOfEntryID)?.PortName??'—'),shelf:x.parent?'Parent item':x.price||'—',design:children.length?'Child items':x.shipment.InitialDesignMode==='Customer'?(x.shipment.InitialDesignCustomer||'0')+' '+customerCurrency:(x.shipment.InitialDesignUSD||'0')+' USD',interest:children.length?'Child items':x.shipment.InterestPct||'0',status:x.locked?shipmentOnly(x)?'Packaging locked':'Read only':x.product?'Draft':'Choose product'};
 }
 useEffect(()=>{if(customerCurrency==='USD')setCustomerRate('1')},[customerCurrency]);
 const submitted=lines.filter(x=>(!x.locked&&(!x.parent||x.id)&&(!x.id||JSON.stringify(x)!==JSON.stringify(originalById.get(x.id))))||(shipmentOnly(x)&&JSON.stringify(x.shipment)!==JSON.stringify(originalById.get(x.id)?.shipment)));
 const dirty=customerRate!==value(header?.ExchangeRateCustomerCurrencyPerUSD)||rate!==value(header?.ExchangeRateVNDPerUSD)||(editing?(customer!==value(header?.CustomerID)||description!==value(header?.OpportunityDesc)||open!==value(header?.BidOpen).slice(0,10)||closeDate!==value(header?.BidClose).slice(0,10)||submitted.length>0):!!(customer||description||open||closeDate||lines.length>1||lines.some(x=>x.product||x.description||x.units||x.percent||x.price||Object.values(x.requirements).some(Boolean)||Object.entries(x.shipment).some(([key,value])=>key!=='MarginMode'&&!!value))));
 useEffect(()=>{if(!focusItem)return;const target=originals.find(x=>x.id===focusItem);if(!target)return;const index=originals.filter(x=>!x.parent).findIndex(x=>x.key===(target.parent??target.key));setPage(Math.floor(Math.max(0,index)/size)+1);if(target.parent)setExpanded(xs=>new Set([...xs,target.parent!]));},[focusItem,size,originals]);
 useEffect(()=>{if(!loading&&focusItem)document.getElementById('opp-edit-item-'+focusItem)?.scrollIntoView({block:'center'})},[loading,focusItem,activePage]);
 useEffect(()=>{let active=true;setLoading(true);setError('');call<typeof lookups>('/api/opportunity/lookups').then(x=>{if(active)setLookups(x)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[retry]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved Opportunity?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved Opportunity?')))onClose()}
 function change(key:number,field:'product'|'units'|'percent'|'price'|'weight',value:string,source=lookups){
  if(field==='weight'&&lines.some(x=>x.key===key&&shipmentScope(x)==='mix-parent'))return;
  if(field!=='product'){setLines(xs=>xs.map(x=>x.key===key?{...x,[field]:value,...(field==='weight'?{refreshWeight:false}:{})}:x));return}
  const children=(source.mix_children||[]).filter(c=>String(c.ParentProductID)===value);
  setLines(xs=>xs.filter(x=>x.parent!==key).flatMap(x=>x.key===key?[
   {...x,product:value,weight:undefined,refreshWeight:!!x.id&&!!value&&value===originalById.get(x.id)?.product,grade:null,mixVersion:children.length?Number(children[0].MixVersionID):undefined},
   ...children.map(c=>({...blank(++sequence.current),parent:key,product:String(c.ProductID),code:String(c.ProductCode),name:String(c.ProductName),description:String(c.ProductName),quantity:String(c.UnitQuantity)}))
  ]:[x]));
  setExpanded(xs=>new Set([...xs,key]));
 }
 async function refreshWeight(key:number,product:string){
  const beforeWeight=draftRef.current.lines.find(x=>x.key===key)?.weight;
  setRefreshingMaster(true);setError('');
  try{
   const fresh=await call<typeof lookups>('/api/opportunity/lookups');setLookups(fresh);
   if(!fresh.products.some(p=>String(p.ID)===product)&&!fresh.mix_children?.some(p=>String(p.ProductID)===product))throw new Error('Product is no longer active. Refresh the Opportunity.');
   setLines(xs=>xs.map(x=>x.key===key&&x.product===product&&!x.locked&&x.weight===beforeWeight?{...x,weight:undefined,refreshWeight:!!x.id}:x));
   setMessage('Current Product weight loaded. Review and save the Opportunity to capture it.');
  }catch(e){setError((e as Error).message)}finally{setRefreshingMaster(false)}
 }
 async function masterCreated(records:Row[],override:typeof inlineMaster=inlineMaster){
  const target=override,refresh=++masterRefreshSequence.current;setRefreshingMaster(true);
  try{
   const fresh=await call<typeof lookups>('/api/opportunity/lookups');if(refresh!==masterRefreshSequence.current)return;setLookups(fresh);
   const created=records.find(r=>r.ID);
   if(target?.entity==='ports'){
    const port=fresh.ports?.find(p=>records.some(r=>Number(r.ID)===Number(p.ID))&&String(p.CustomerID)===draftRef.current.customer);
    if(port&&target.line)setLines(xs=>xs.map(x=>x.key===target.line&&x.shipment.PortOfEntryID===(target.port||'')?{...x,shipment:{...x.shipment,PortOfEntryID:String(port.ID)}}:x));
    setMessage('Port saved and added to choices.');
   }else if(target?.entity==='customers'){
    if(!draftRef.current.customer&&created&&fresh.customers.some(c=>Number(c.ID)===Number(created.ID)))chooseCustomer(String(created.ID));
    setMessage('Customer created and added to choices.');
   }else{
    const product=fresh.products.find(p=>Number(p.ID)===Number(created?.ID)&&String(p.CustomerID)===draftRef.current.customer);
    if(target?.line&&product&&draftRef.current.lines.find(line=>line.key===target.line)?.product===target.product)change(target.line,'product',String(product.ID),fresh);
    setMessage(product?'Product ready and added to choices.':'Product saved. Activate a Product Mix version before selecting it for this Opportunity.');
   }
  }catch(e){if(refresh!==masterRefreshSequence.current)return;setMasterReloadRequired(true);setError('Master saved, but choices could not be refreshed. Reload choices to select the saved record; do not create it again. '+(e as Error).message)}
  finally{if(refresh===masterRefreshSequence.current)setRefreshingMaster(false)}
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
   const prefix='Item '+itemNumber(x)+': ';
   if(editing&&!submitted.some(y=>y.key===x.key)&&!(x.parent&&!x.id))continue;
   const requirementsError=requirementError(x.requirements,originalById.get(x.id)?.requirements,lookups.packagingTypes||[],lookups.pallets||[],!!x.parent,!x.parent&&!!(x.mixVersion||x.snapshot||lookups.products.find(p=>String(p.ID)===x.product)?.IsMix),lines.some(c=>c.parent===x.key)?Math.max(...lines.filter(c=>c.parent===x.key).map(c=>Number(c.requirements.PackagingLayerCount)||2))+1:1);
   if(!shipmentOnly(x)&&requirementsError)errors.push(prefix+requirementsError);
   if(x.weight!==undefined&&(!/^\d{1,8}(\.\d{1,2})?$/.test(x.weight)||Number(x.weight)<=0))errors.push(prefix+'net weight must be positive grams with up to two decimals.');
   if(!x.parent&&!x.locked){if(!['20DC','20RC','40DC','40HC','40RHC'].includes(x.requirements.ContainerRequest))errors.push(prefix+'Container Type is required.');}
   const shipmentIssue=shipmentError(scopedShipment(x.shipment,shipmentScope(x)),originalById.get(x.id)?.shipment,lookups.customers.find(c=>String(c.ID)===customer),lookups.ports||[]);
   if(shipmentIssue)errors.push(prefix+shipmentIssue);
   if(x.parent){if(x.id&&!x.version)errors.push(prefix+'refresh to load the current version.');continue;}
   if(x.id&&!x.version)errors.push(prefix+'refresh to load the current version.');
   if(shipmentOnly(x))continue;
   if(!products.some(p=>String(p.ID)===x.product)&&!(x.id&&originalById.get(x.id)?.product===x.product&&customer===value(header?.CustomerID)))errors.push(prefix+'choose an active product belonging to this Customer.');
   else if(roots.filter(y=>y.product===x.product).length>1)errors.push(prefix+'this product is already used in another item.');
   if(!/^\d+$/.test(x.units)||Number(x.units)>2147483647)errors.push(prefix+'annual units must be a whole number from 0 to 2,147,483,647.');
   if(x.percent&&(!/^\d{1,3}(\.\d{1,2})?$/.test(x.percent)||Number(x.percent)>100))errors.push(prefix+'estimated award must be 0 to 100, with up to two decimals.');
   if(x.price&&!/^\d{1,8}(\.\d{1,2})?$/.test(x.price))errors.push(prefix+'shelf price must be nonnegative, with up to eight whole digits and two decimals.');
  }
  setError(errors.join(' '));if(!errors.length)setConfirm(true);
  else if(testingLayout){
   const invalid=lines.find(x=>errors.some(e=>e.startsWith('Item '+itemNumber(x)+': ')));
   if(invalid){editItem(invalid.key);const text=errors.find(e=>e.startsWith('Item '+itemNumber(invalid)+': '))!.toLowerCase();setEntryTab(text.includes('pallet')?'palletization':text.includes('container')||text.includes('shipment')?'logistics':text.includes('type')||text.includes('packaging')||text.includes('layer')?'packaging':text.includes('interest')||text.includes('margin')||text.includes('design')?'financials':'product')}
   else setHeaderExpanded(true);
  }
 }
 async function save(){
  if(posting.current||uncertain)return;posting.current=true;setBusy(true);setError('');
  // This key connects the header and items inside one SQL transaction, not a retry token.
  const key=editing?String(header!.OpportunityNumber):'WEB-'+newId().replaceAll('-','').slice(0,16);
  const changed=editing?submitted:roots;
  try{
   const result=await call<{header_results:Row[];item_results:Row[]}>('/api/opportunity/batch',{
    header_rows:[{RowNum:1,Command:editing?'U':'C',ID:editing?header!.OpportunityID:null,RowVersion:editing?header!.HeaderRowVersion:null,OpportunityNumber:key,CustomerID:Number(customer),ExchangeRateVNDPerUSD:rate,ExchangeRateCustomerCurrencyPerUSD:customerCurrency==='USD'?'1':customerRate,OpportunityDesc:description.trim(),BidOpen:open,BidClose:closeDate}],
    item_rows:changed.map(x=>shipmentOnly(x)?{RowNum:x.key,Command:'U',ID:x.id,RowVersion:x.version,OpportunityNumber:key,ShipmentCostInfo:shipmentPayload(x.shipment,shipmentScope(x))}:({...webRequirementPayload(x.requirements,!!x.parent),ShipmentCostInfo:shipmentPayload(x.shipment,shipmentScope(x)),...(x.grade!==undefined?{ProductGradeSnapshot:x.grade}:{}),...(shipmentScope(x)!=='mix-parent'&&x.weight!==undefined?{NetWeightGrams:x.weight}:{}),...(shipmentScope(x)!=='mix-parent'&&x.refreshWeight?{RefreshProductWeight:true}:{}),RowNum:x.key,Command:x.id?'U':'C',ID:x.id||null,RowVersion:x.version||null,OpportunityNumber:key,...(x.parent?{}:{ProductID:Number(x.product),AnnualUnit:Number(x.units),EstPctAwarded:x.percent===''?null:Number(x.percent),ShelfPrice:x.price===''?null:Number(x.price)}),...(x.mixVersion?{MixVersionID:x.mixVersion,MixChildren:lines.filter(c=>c.parent===x.key).map(c=>({ProductID:Number(c.product),ShipmentCostInfo:shipmentPayload(c.shipment,'child-others'),...webRequirementPayload(c.requirements,true),...(c.weight!==undefined?{NetWeightGrams:c.weight}:{}),...(c.grade!==undefined?{ProductGradeSnapshot:c.grade}:{})}))}:{})}))
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
 return <Modal label={title} className={"dialog opportunity-editor opportunity-entry-dialog record-dialog"+(testingLayout?" opportunity-layout-testing":"")} onClose={close}>
  <div className="customer-editor-heading"><h2>{title}</h2>{opportunityTestingLayoutEnabled&&<div className="opportunity-layout-switch" role="group" aria-label="Opportunity layout">{testingLayout&&<span className="opportunity-testing-label">Layout testing</span>}<button type="button" aria-pressed={testingLayout} disabled={busy} onClick={()=>switchLayout(true)}>Testing layout</button><button type="button" aria-pressed={!testingLayout} disabled={busy} onClick={()=>switchLayout(false)}>Current layout</button></div>}<IconButton icon="close" label="Close Opportunity form" disabled={busy} onClick={close}/></div>
  <ErrorNote value={error}/>{masterReloadRequired&&<IconButton icon="refresh" label="Reload master choices" disabled={refreshingMaster} onClick={()=>{setRefreshingMaster(true);call<typeof lookups>('/api/opportunity/lookups').then(fresh=>{setLookups(fresh);setMasterReloadRequired(false);setError('')}).catch(e=>setError((e as Error).message)).finally(()=>setRefreshingMaster(false))}}/>}{loading?<p>Loading customers and products...</p>:(!lookups.customers.length||!lookups.products.length)&&<div className="notice">Active customers and products are required.<IconButton icon="refresh" label="Reload choices" onClick={()=>setRetry(n=>n+1)}/></div>}
  <form noValidate className="record-dialog-form" onSubmit={e=>{e.preventDefault();review()}}>
   <div ref={entryScroll} className="record-dialog-content"><fieldset className={editing&&header?.HeaderStage!=='Draft'?'display-only-fields':undefined} disabled={busy||uncertain||loading||(editing&&header?.HeaderStage!=='Draft')}><div className="panel opportunity-header-box"><section className="customer-entry" aria-label="Header Info"><header><h3>Header Info</h3>{testingLayout&&<button type="button" className="opportunity-testing-header-toggle" aria-expanded={headerExpanded} onClick={()=>setHeaderExpanded(v=>!v)}>{headerExpanded?"Collapse header":"Show header info"}</button>}<Badge value={header?.HeaderStage||"Draft"}/></header>{testingLayout&&!headerExpanded&&<p className="opportunity-testing-header-brief">{lookups.customers.find(c=>String(c.ID)===customer)?.CustomerName} / {description}</p>}
    <div className="opportunity-header-fields" hidden={testingLayout&&!headerExpanded}><label>Customer *<span className="inline-master-field"><select aria-label="Customer *" required value={customer} disabled={editing&&originals.some(x=>!!x.id)} onChange={e=>chooseCustomer(e.target.value)}><option value="">Choose customer</option>{customer&&!lookups.customers.some(x=>String(x.ID)===customer)&&<option value={customer}>{value(header?.CustomerName)} (unavailable)</option>}{lookups.customers.map(x=><option key={String(x.ID)} value={String(x.ID)}>{x.CustomerName}</option>)}</select>{canAddCustomer&&<AddMasterButton entity="customers" selectedValue={customer} onEdited={record=>masterCreated([record],{entity:'customers'})} label="Add new Customer" disabled={refreshingMaster||!!inlineMaster} onClick={()=>setInlineMaster({entity:'customers'})}/>}</span></label>
    <label>Description *<input required maxLength={300} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <div className="opportunity-bid-dates"><label>Bid open *<DateInput aria-label="Bid open" required max="9999-12-31" value={open} onValueChange={setOpen}/></label><label>Bid close *<DateInput aria-label="Bid close" required min={open||undefined} max="9999-12-31" value={closeDate} onValueChange={setCloseDate}/></label></div>

    <label className="opportunity-rate"><FieldLabel help="1 USD = this many VND">VND / USD *</FieldLabel><input aria-label="Exchange rate VND per USD *" required inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)}/></label>
    <label className="opportunity-rate"><FieldLabel help={'1 USD = this many '+(customerCurrency||'customer currency units')}>{(customerCurrency||'Customer currency')+' / USD *'}</FieldLabel><input aria-label="Exchange rate Customer Currency per USD *" required inputMode="decimal" readOnly={customerCurrency==='USD'} value={customerCurrency==='USD'?'1':customerRate} onChange={e=>setCustomerRate(e.target.value)}/></label>
<div className="opportunity-entry-summary" aria-label="Opportunity summary"><div><span>Items</span><strong>{roots.length}{lines.length>roots.length?' + '+(lines.length-roots.length)+' mix children':''}</strong></div><div><span>Available products</span><strong>{customer?products.length:"Choose customer"}</strong></div><div><span>Read-only items</span><strong>{lines.filter(x=>x.locked).length}</strong></div></div>
   </div></section></div>
   <section className="panel opportunity-entry-items" aria-label="Item Details"><div className="section-label"><h3>{testingLayout&&focusedItem!==null?'Item details':'Item Details ('+roots.length+')'}</h3><IconButton icon="plus" label="Add item" disabled={roots.length>=500} onClick={addItem}/></div>
   {testingLayout&&<><OpportunityEntryTabs tab={entryTab} onChange={changeEntryTab}/>{focusedEntry&&<div className="opportunity-testing-context"><div><button type="button" onClick={()=>{setFocusedItem(null);setHeaderExpanded(true)}}>Back to items</button><strong> Item {itemNumber(focusedEntry!)} / {summary(focusedEntry!).product||'New product'}</strong><small>{summary(focusedEntry!).kind}</small></div><select aria-label="Edit Opportunity item" value={focusedEntry.key} onChange={e=>editItem(Number(e.target.value))}>{lines.map(x=><option key={x.key} value={x.key}>Item {itemNumber(x)} / {summary(x).product||'New product'}</option>)}</select></div>}</>}
   <div id={testingLayout?'entry-tab-panel':undefined} role={testingLayout?'tabpanel':undefined} aria-labelledby={testingLayout?'entry-tab-'+entryTab:undefined}>
   {testingLayout&&focusedItem===null&&<p className="opportunity-testing-hint">Choose Edit details to update an item. Review &amp; save confirms the whole Opportunity.</p>}
   {testingLayout&&focusedItem===null&&<OpportunityItemSummary items={lines.filter(x=>pageRoots.has(x.parent??x.key)).map(summary)} tab={entryTab} onEdit={editItem}/>}
   <div className="opportunity-entry-list">{lines.filter(x=>testingLayout?x.key===focusedItem:pageRoots.has(x.parent??x.key)&&(!x.parent||expanded.has(x.parent))).map(x=>{
    const parent=lines.find(p=>p.key===x.parent),children=lines.filter(c=>c.parent===x.key);
    const number=itemNumber(x);
    const units=x.parent?decimalDisplay(mixAnnualUnits(parent?.units||'',x.quantity||''),4)||'':x.units;
    const selectedProduct=lookups.products.find(p=>String(p.ID)===x.product)??lookups.mix_children?.find(p=>String(p.ProductID)===x.product);
    const savedProduct=originalById.get(x.id)?.product===x.product?rows?.find(r=>Number(r.ItemID)===x.id):undefined;
    const capturedWeight=x.weight??(savedProduct&&!x.refreshWeight?savedProduct.WeightGrams:selectedProduct?.WeightGrams);const capturedMix=parseMixStructure(savedProduct?.MixStructure);const mix=withMixPacking(!x.parent&&(children.length||x.mixVersion||x.snapshot||selectedProduct?.IsMix)?{MixVersionID:x.mixVersion,items:children.map(c=>{const saved=capturedMix?.items.find(i=>Number(i.ProductID)===Number(c.product)),choice=lookups.products.find(p=>String(p.ID)===c.product)??lookups.mix_children?.find(p=>String(p.ProductID)===c.product);return {...saved,ProductID:Number(c.product),ProductCode:c.code??choice?.ProductCode,ProductName:c.name??choice?.ProductName,UnitQuantity:c.quantity,WeightGrams:c.weight??rows?.find(r=>Number(r.ItemID)===c.id)?.WeightGrams??choice?.WeightGrams,ProductGradeSnapshot:c.grade!==undefined?c.grade:saved?.ProductGradeSnapshot??choice?.ProductGradeSnapshot};})}:null,children.flatMap(c=>{const r=rows?.find(r=>Number(r.ItemID)===c.id&&Number(r.ProductID)===Number(c.product));return r?[r]:[]}));const netWeight=mix?mixNetWeight(mix.items):capturedWeight;
    const shelfLife=selectedProduct&&'ShelfLifeDays' in selectedProduct?selectedProduct.ShelfLifeDays:x.requirements.ShelfLifeDays;
    return <section className={'opportunity-entry-row'+(x.parent?' opportunity-mix-child':'')} key={x.key} id={'opp-edit-item-'+(x.id||x.key)} aria-label={'Item '+number}><header><h3>Item {number}</h3>{x.locked&&<Badge value={shipmentOnly(x)?"Packaging locked":"Read only"}/>}{!x.parent&&<IconButton icon="close" label={'Remove item '+number} disabled={!!x.id||roots.length===1} onClick={()=>setLines(xs=>xs.filter(y=>y.key!==x.key&&y.parent!==x.key))}/>}</header>
    <div className="opportunity-entry-fields"><fieldset className={"opportunity-protected-fields"+(x.locked?" display-only-fields":"")} disabled={x.locked}>{(!testingLayout||entryTab==='product')&&<section className="opportunity-product-section" aria-label="Product Info"><h4>Product Info</h4><div className="opportunity-product-fields">{x.parent?<label>Product<input aria-label="Product" readOnly value={(x.code||'')+' — '+(x.name||'')}/></label>:<label>Product *<span className="inline-master-field"><select className={x.snapshot?"display-value":undefined} aria-label="Product *" required disabled={!customer||x.snapshot} value={x.product} onChange={e=>change(x.key,'product',e.target.value)}><option value="">Choose product</option>{x.product&&!products.some(p=>String(p.ID)===x.product)&&<option value={x.product}>{value(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductCode)} &mdash; {value(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductName)} (unavailable)</option>}{products.map(p=><option key={String(p.ID)} value={String(p.ID)}>{p.ProductCode} &mdash; {p.ProductName}</option>)}</select>{canAddProduct&&<AddMasterButton entity="products" selectedValue={x.product} onEdited={record=>masterCreated([record],{entity:'products',line:x.key,product:x.product})} label={'Add new Product for item '+number} disabled={!customer||x.snapshot||refreshingMaster||!!inlineMaster} onClick={()=>setInlineMaster({entity:'products',line:x.key,product:x.product})}/>}</span></label>}
    <label>Net weight (g)<span className="inline-master-field"><input aria-label="Net weight (g)" readOnly={!!mix} inputMode="decimal" value={!mix&&x.weight!==undefined?x.weight:netWeight==null?'':String(netWeight).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1')} onChange={e=>change(x.key,'weight',e.target.value)}/>{!mix&&!x.locked&&<IconButton icon="refresh" label={'Refresh Product weight for item '+number} disabled={refreshingMaster||!x.product} onClick={()=>void refreshWeight(x.key,x.product)}/>}</span></label>
    <div className="opportunity-numbers"><label><FieldLabel help={x.parent?'Parent annual units × '+decimalDisplay(x.quantity,4)+' mix quantity.':undefined}>Annual units{x.parent?'':' *'}</FieldLabel><input aria-label={x.parent?'Annual units':'Annual units *'} required={!x.parent} readOnly={!!x.parent} disabled={!x.parent&&children.some(c=>c.locked)} inputMode="numeric" value={units} onChange={e=>change(x.key,'units',e.target.value)}/></label>{!x.parent&&<><label>Estimated award %<input inputMode="decimal" value={x.percent} onChange={e=>change(x.key,'percent',e.target.value)}/></label><label className="estimated-award-units">Estimated awarded units<input aria-label="Estimated awarded units" readOnly value={x.percent.trim()!==''&&x.units.trim()!==''&&Number.isFinite(Number(x.percent))&&Number.isFinite(Number(x.units))?(decimalDisplay(Number(x.units)*Number(x.percent)/100,4)||''):''}/></label>{!testingLayout&&<label>Shelf price ({customerCurrency||'customer currency'}/unit)<input aria-label="Shelf price" inputMode="decimal" value={x.price} onChange={e=>change(x.key,'price',e.target.value)}/></label>}</>}</div>
   <div className="opportunity-product-info requirement-sections"><div className="packaging-entry-grid"><label>Shelf life (days)<input aria-label="Shelf life (days)" readOnly value={decimalDisplay(shelfLife,0)||''}/></label><GradeSnapshotIcon mix={mix} productID={Number(x.product)} value={x.grade!==undefined?x.grade:parseGradeSnapshot(rows?.find(r=>Number(r.ItemID)===x.id)?.ProductGradeSnapshot)} onChange={x.locked?undefined:grade=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,grade}:y))}/></div></div></div></section>}
   {testingLayout&&entryTab==='product'&&children.length>0&&<section className="opportunity-testing-child-summary"><h4>Mix children ({children.length})</h4><OpportunityItemSummary items={children.map(summary)} tab="product" onEdit={editItem}/></section>}
   {(!testingLayout||entryTab==='packaging'||entryTab==='palletization')&&<details open={testingLayout||undefined} className="opportunity-requirements" onToggle={scrollExpandedSection}><summary>Packaging requirements</summary>
    <PackagingCopy sources={lines.filter(y=>y.key!==x.key&&!!y.product).map(y=>{const product=lookups.products.find(p=>String(p.ID)===y.product)??lookups.mix_children?.find(p=>String(p.ProductID)===y.product);return {key:y.key,label:'Item '+itemNumber(y)+' - '+(y.code||product?.ProductCode||'')+' - '+(y.name||product?.ProductName||y.description)}})} onCopy={source=>copyPackaging(x.key,source)}/>
    <RequirementSections compact={testingLayout} view={testingLayout?(entryTab==='palletization'?'palletization':'packaging'):'all'} mix={mix} showShipment={false} values={x.requirements} types={lookups.packagingTypes} pallets={lookups.pallets} child={!!x.parent} shelfLife={shelfLife} row={{...rows?.find(r=>Number(r.ItemID)===x.id),PackagingLayerStart:children.length?Math.max(...children.map(c=>Number(c.requirements.PackagingLayerCount)||2))+1:1}} onChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,requirements:{...y.requirements,[key]:value}}:y))}/>
   </details>}
   </fieldset><fieldset className={"opportunity-protected-fields"+(x.shipmentLocked?" display-only-fields":"")} disabled={!!x.shipmentLocked}>{(!testingLayout||entryTab==='logistics'||entryTab==='financials')&&<details open={testingLayout||undefined} className="opportunity-requirements" onToggle={scrollExpandedSection}><summary><FieldLabel help={x.parent?'Maintain this child design, fixed costs, interest and margin. Packing cost is maintained in TCB on the Mix parent.':'Import clearance, Port–WH and WH Cost are entered in customer currency with USD conversion. Initial Design supports USD or customer currency. New Packaging Requests capture Container Type and Loading request. Pallet size and Container Type are required.'}>{x.parent?'Others Info':'Shipment, Logistics, Co-Man & Others info'}</FieldLabel></summary>{testingLayout&&entryTab==='financials'&&!x.parent&&<label>Shelf price ({customerCurrency||'customer currency'}/unit)<input aria-label="Shelf price" inputMode="decimal" value={x.price} onChange={e=>change(x.key,'price',e.target.value)}/></label>}{testingLayout&&entryTab==='financials'&&children.length>0?<section className="opportunity-testing-child-summary"><h4>Child financials</h4><OpportunityItemSummary items={children.map(summary)} tab="financials" onEdit={editItem}/></section>:testingLayout&&entryTab==='logistics'&&x.parent?<p className="opportunity-testing-empty">Shipment, logistics and Co-Man costs are maintained on the parent item. Use Financials for this child's own costs.</p>:<ShipmentSections view={testingLayout?(entryTab==='financials'?'financials':'logistics'):'all'} values={x.shipment} scope={shipmentScope(x)} requirements={(lines.find(y=>y.key===x.parent)??x).requirements} customer={lookups.customers.find(c=>String(c.ID)===customer)} currency={customerCurrency} exchangeRate={customerCurrency==='VND'?rate:customerRate} ports={lookups.ports} onPortEdited={record=>masterCreated([record],{entity:'ports',line:x.key,port:x.shipment.PortOfEntryID})} onAddPort={!x.parent&&canCreateMaster(session,'ports')&&!x.shipmentLocked?()=>setInlineMaster({entity:'ports',line:x.key,port:x.shipment.PortOfEntryID}):undefined} requirementsLocked={!!x.locked} onChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,shipment:{...y.shipment,[key]:value}}:y))} onRequirementChange={(key,value)=>setLines(xs=>xs.map(y=>y.key===x.key?{...y,requirements:{...y.requirements,[key]:value}}:y))}/>}</details>}
   </fieldset></div>{!testingLayout&&children.length>0&&<button type="button" className="link mix-child-toggle" aria-label={'Show mix children for Item '+number} aria-expanded={expanded.has(x.key)} onClick={event=>{const expanding=!expanded.has(x.key);setExpanded(prev=>{const next=new Set(prev);next.has(x.key)?next.delete(x.key):next.add(x.key);return next});if(expanding)scrollExpandedItem(event.currentTarget)}}>{expanded.has(x.key)?'▾':'▸'} Mix children ({children.length})</button>}</section>;
   })}</div></div></section></fieldset></div>
   <footer className="record-dialog-footer opportunity-entry-actions">{(!testingLayout||focusedItem===null)&&<Pager page={activePage} size={size} total={roots.length} busy={busy||uncertain||loading} onPage={setPage} onSize={n=>{setSize(n);setPage(1)}} unit="items"/>}<div className="actions record-action-bar">{testingLayout&&focusedItem!==null&&<button type="button" disabled={busy} onClick={()=>{setFocusedItem(null);setHeaderExpanded(true)}}>Apply to item list</button>}{(!testingLayout||focusedItem===null)&&<IconButton icon="save" label="Save item page size to profile" disabled={!ready||profileSaving||busy} onClick={savePageSize}/>}<button className="primary" disabled={busy||uncertain||loading||(editing&&!dirty)||!lookups.customers.length||(!editing&&!products.length)}>Review & save</button></div></footer>
  </form>
  {inlineMaster&&<InlineMasterCreate entity={inlineMaster.entity} customerID={customer} onClose={()=>setInlineMaster(null)} onSaved={records=>{void masterCreated(records)}}/>}
  <Notification value={message} onDismiss={()=>setMessage('')}/>{confirm&&<Modal label="Confirm Opportunity save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>{editing?'Save Opportunity changes?':'Create this Opportunity?'}</h2><p>{description.trim()}</p><p>{editing?submitted.length:roots.length} {editing?'changed/new items':'items'} · Draft</p><div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back to form</button><button className="primary" disabled={busy} onClick={save}>{busy?'Saving...':'Confirm save'}</button></div></Modal>}
 </Modal>
}
