import {editableProcessTree,savedProcessTree} from './grade-process';
import {CopyGrades} from './copy-grades';
import {pageAccess} from './workspace-access';
import {useSession} from './session';
import {canCreateMaster,type InlineMasterEntity} from './add-master-button';
import {InlineMasterCreate} from './inline-master-create';
import {RawPricing} from './raw-pricing';
import {GradeTree} from './grade-tree';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ApiError,call,type Row} from './api';
import {Badge,ErrorNote,Modal} from './ui';
import {IconButton} from './icons';
import './product-grades.css';

export type RawGradeOption={ID:number;ParentGradeID?:number|null;GradeName:string;FinalGrade?:boolean};
export type RawMaterialOption={ID:number;GradeID:number;MaterialCode:string;MaterialName:string;Status:string};
export type GradeItem={Process?:boolean|null;RawGradeID?:number|null;RawMaterialID?:number|null;ParentID:string;ID:number;Grade:string;RatioPct:string};
export type GradeDraft={Status:'Draft'|'Active';items:GradeItem[]};
type Version={ID:number;Version:number;Status:'Draft'|'Active'|'Inactive';RowVersion:string};
type GradeData={product:Row;versions:Version[];items:(GradeItem&{VersionID:number})[]};
const path=(i:GradeItem)=>i.ParentID+'/'+i.ID;
const depth=(s:string)=>s.split('/').length-1;
const copy=(items:GradeItem[])=>editableProcessTree(items).map(i=>({Process:i.Process,ParentID:i.ParentID,ID:i.ID,Grade:i.Grade,RawGradeID:i.RawGradeID??null,RawMaterialID:i.RawMaterialID??null,RatioPct:String(i.RatioPct)}));
function cents(value:string){if(!/^\d{1,3}(\.\d{1,2})?$/.test(value))return null;const [a,b='']=value.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return n>0&&n<=10000?n:null}
export function gradeError(items:GradeItem[]){
 if(!items.length)return 'Add at least one grade.';
 if(items.length>1000)return 'A version can contain up to 1,000 grades.';
 const paths=new Set(items.map(path)),totals=new Map<string,number>();
 if(paths.size!==items.length)return 'Grade IDs must be unique under each parent.';
 for(const i of items){
  if(!/^0(?:\/[1-9][0-9]{0,3}){0,11}$/.test(i.ParentID)||!Number.isInteger(i.ID)||i.ID<1||i.ID>9999)return 'Invalid grade path.';
  if(i.ParentID!=='0'&&!paths.has(i.ParentID))return 'Parent '+i.ParentID+' does not exist.';
  if(!i.RawGradeID)return 'Choose a Raw Grade for '+path(i)+'.';
  if(!i.Grade.trim()||i.Grade.trim().length>100)return 'Enter a grade for '+path(i)+'.';
  const n=cents(i.RatioPct);if(n===null)return 'Enter a percentage above 0 and up to 100, with at most 2 decimals, for '+path(i)+'.';
  totals.set(i.ParentID,(totals.get(i.ParentID)||0)+n);
 }
 for(const [parent,total] of totals)if(total!==10000)return 'Ratios under parent '+parent+' must total 100% (currently '+(total/100)+'%).';
 return '';
}

export function ProductGrades({product,initial,onApply,onClose,onSaved,tabs,snapshotMode=false}:{snapshotMode?:boolean;tabs?:ReactNode;product?:Row;initial?:GradeDraft|null;onApply?:(draft:GradeDraft)=>void;onClose:()=>void;onSaved?:()=>void}){
 const session=useSession();
 type Target={entity:InlineMasterEntity;item:GradeItem};
 const [masterTarget,setMasterTarget]=useState<Target|null>(null),[masterRefresh,setMasterRefresh]=useState(false),[retryMaster,setRetryMaster]=useState<{target:Target;records:Row[]}|null>(null);
 const [view,setView]=useState<'tree'|'pricing'>('tree');
 const [copyOpen,setCopyOpen]=useState(false),[copyNotice,setCopyNotice]=useState('');
 const [rawGrades,setRawGrades]=useState<RawGradeOption[]>([]),[rawMaterials,setRawMaterials]=useState<RawMaterialOption[]>([]),[gradeLookupError,setGradeLookupError]=useState(''),[lookupBusy,setLookupBusy]=useState(true);
 useEffect(()=>{let active=true;call<{rows:RawGradeOption[];materials?:RawMaterialOption[]}>(snapshotMode?'/api/opportunity/grade-lookups':'/api/workbench/products/raw-grade-lookups')
 .then(r=>{if(active){setRawGrades(r.rows);setRawMaterials(r.materials||[]);setGradeLookupError('')}}).catch(e=>{if(active)setGradeLookupError('Unable to load Raw Grade Master: '+e.message)}).finally(()=>{if(active)setLookupBusy(false)});
 return()=>{active=false}},[snapshotMode]);
 const [data,setData]=useState<GradeData|null>(null),[version,setVersion]=useState<Version|null>(null);
 const [items,setItems]=useState<GradeItem[]>(()=>copy(initial?.items||[])),[status,setStatus]=useState<'Draft'|'Active'>(initial?.Status||'Draft');
 const [busy,setBusy]=useState(!!product),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[uncertain,setUncertain]=useState(false);
 const baseline=useRef(JSON.stringify({items:copy(initial?.items||[]),status:initial?.Status||'Draft'})),lock=useRef(false);
 const dirty=JSON.stringify({items,status})!==baseline.current;
 const readonly=!!version&&version.Status!=='Draft';
 function select(v:Version|null,all:GradeData){
  const next=v?copy(all.items.filter(i=>i.VersionID===v.ID)):[];
  setVersion(v);setItems(next);setStatus(v?.Status==='Active'?'Active':'Draft');setError('');setUncertain(false);
  baseline.current=JSON.stringify({items:next,status:v?.Status==='Active'?'Active':'Draft'});
 }
 async function load(preferred?:number){
  setBusy(true);setError('');
  try{const next=await call<GradeData>('/api/workbench/products/'+product!.ID+'/grades');setData(next);select(next.versions.find(v=>v.ID===preferred)||next.versions.find(v=>v.Status==='Active')||next.versions[0]||null,next)}
  catch(e){setError(e instanceof Error?e.message:'Unable to load grades.')}
  finally{setBusy(false)}
 }
 useEffect(()=>{if(product)void load()},[product?.ID]);
 useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved grade changes?')))e.preventDefault()};window.addEventListener('beforeunload',unload);window.addEventListener('bridge:navigate',nav);return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('bridge:navigate',nav)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved grade changes?')))onClose()}
 function add(target:string){const siblings=items.filter(i=>i.ParentID===target);const id=Math.max(0,...siblings.map(i=>i.ID))+1;if(id>9999){setError('No more IDs available under this parent.');return}setItems(x=>[...x,{ParentID:target,ID:id,Grade:'',Process:false,RawMaterialID:null,RatioPct:siblings.length?'':'100'}]);setError('')}
 function remove(item:GradeItem){const prefix=path(item);if(items.some(i=>i.ParentID===prefix||i.ParentID.startsWith(prefix+'/'))&&!window.confirm('Remove this grade and all its child grades?'))return;setItems(x=>x.filter(i=>path(i)!==prefix&&!i.ParentID.startsWith(prefix+'/')&&i.ParentID!==prefix))}
 async function masterCreated(target:Target,records:Row[]){
  setMasterRefresh(true);setRetryMaster({target,records});setGradeLookupError('');
  try{
   const fresh=await call<{rows:RawGradeOption[];materials?:RawMaterialOption[]}>(snapshotMode?'/api/opportunity/grade-lookups':'/api/workbench/products/raw-grade-lookups');
   setRawGrades(fresh.rows);setRawMaterials(fresh.materials||[]);
   setItems(all=>all.map(item=>{
    if(path(item)!==path(target.item)||item.RawGradeID!==target.item.RawGradeID||item.RawMaterialID!==target.item.RawMaterialID)return item;
    const parentGrade=all.find(p=>path(p)===item.ParentID)?.RawGradeID;
    if(target.entity==='raw-grades'){
     const created=fresh.rows.find(g=>records.some(r=>Number(r.ID)===g.ID)&&(item.ParentID==='0'||g.ParentGradeID===parentGrade));
     return created?{...item,RawGradeID:created.ID,Grade:created.GradeName,RawMaterialID:created.ID===item.RawGradeID?item.RawMaterialID:null}:item;
    }
    const created=fresh.materials?.find(m=>records.some(r=>Number(r.ID)===m.ID)&&m.Status==='Active'&&m.GradeID===item.RawGradeID);
    return created?{...item,RawMaterialID:created.ID}:item;
   }));setRetryMaster(null);
  }catch(exc){setGradeLookupError('Master saved, but choices could not be refreshed. Do not create it again. '+(exc as Error).message)}
  finally{setMasterRefresh(false)}
 }
 function review(){if(lookupBusy||gradeLookupError||masterRefresh||retryMaster)return;const message=gradeError(items)||(items.some(i=>rawGrades.some(g=>g.ID===i.RawGradeID&&g.FinalGrade===true)&&items.some(child=>child.ParentID===path(i)))?'A final grade cannot have child grades.':'')|| (items.some(i=>i.ParentID!=='0'&&!rawGrades.some(g=>g.ID===i.RawGradeID&&g.ParentGradeID===items.find(p=>path(p)===i.ParentID)?.RawGradeID))?'Each child grade must belong to its selected parent in Raw Grade Master. Reselect incompatible children.':'')|| (items.some(i=>!rawGrades.some(g=>g.ID===i.RawGradeID))?'Choose an active Raw Grade for every item. Legacy or blocked grades must be reselected.':'')|| (items.some(i=>i.RawMaterialID&&(!rawGrades.some(g=>g.ID===i.RawGradeID&&g.FinalGrade===true)||!rawMaterials.some(m=>m.ID===i.RawMaterialID&&m.GradeID===i.RawGradeID&&m.Status==='Active')))?'Choose an active Raw Material assigned to the selected final grade.':'');setError(message);if(message)return;if(!product){onApply?.({Status:status,items:savedProcessTree(copy(items))});onClose()}else setConfirm(true)}
 async function save(){
  if(lock.current||!data||uncertain)return;lock.current=true;setBusy(true);setError('');
  try{
   const result=await call<{ID:number}>('/api/workbench/products/'+product!.ID+'/grades',{VersionID:version?.ID??null,RowVersion:version?.RowVersion??null,ProductRowVersion:data.product.RowVersion,Status:status,items:savedProcessTree(items)});
   onSaved?.();await load(result.ID);
  }catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Reload versions before trying again.')}else setError(e instanceof Error?e.message:'Unable to save grades.')}
  finally{lock.current=false;setBusy(false);setConfirm(false)}
 }
 const headerControls=<div className="grade-header-controls"><IconButton icon="copy" label="Copy grades" disabled={readonly||busy||uncertain||lookupBusy||masterRefresh||!!retryMaster||!!gradeLookupError||!!product&&!data} onClick={()=>setCopyOpen(true)}/>{(product||!snapshotMode)&&<div className="grade-controls"><div className="grade-version-bar">
   {product&&<><label>Version<select aria-label="Grade version" disabled={busy||!data} value={version?.ID||''} onChange={e=>{if(dirty&&!window.confirm('Discard unsaved grade changes?'))return;select(data!.versions.find(v=>String(v.ID)===e.target.value)||null,data!)}}><option value="">New version</option>{data?.versions.map(v=><option key={v.ID} value={v.ID}>{'Version '+v.Version+' · '+v.Status}</option>)}</select></label>
   <IconButton icon="plus" label="New version" disabled={view==='pricing'||busy||!data||uncertain} onClick={()=>{if(dirty&&!window.confirm('Create a new version from these unsaved grades?'))return;setVersion(null);setStatus('Draft');baseline.current=JSON.stringify({items:[],status:'Draft'});setError('')}}/>
   <IconButton icon="refresh" label="Reload grade versions" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard unsaved grade changes and reload?'))void load(version?.ID)}}/></>}
   {!snapshotMode&&<label>Status{readonly?<Badge value={version.Status}/>:<select aria-label="Grade status" value={status} disabled={view==='pricing'||busy||uncertain} onChange={e=>setStatus(e.target.value as 'Draft'|'Active')}><option>Draft</option><option>Active</option></select>}</label>}
  </div>
  </div>}
{!snapshotMode&&<div className="grade-view-tabs" role="group" aria-label="Product Grade view"><IconButton icon="packagingTree" label="Tree" aria-pressed={view==='tree'} onClick={()=>setView('tree')}/><IconButton icon="price" label="Raw Pricing" aria-pressed={view==='pricing'} onClick={()=>setView('pricing')}/></div>}</div>;
 return <Modal label="Product grades" className="dialog grade-dialog" onClose={close}>
  <div className="customer-editor-heading"><div className="grade-heading-title"><h2>{snapshotMode?'Opportunity grade snapshot':'Product grades'}</h2><p>{snapshotMode?'Edits apply to this Opportunity item only, not Product Master.':product?String(product.ProductCode)+' · '+String(product.ProductName):'New product'}</p></div>{headerControls}<dl className="grade-summary" aria-label="Grade summary"><div><dt>Grades</dt><dd>{items.length}</dd></div><div><dt>Levels</dt><dd>{items.length?Math.max(...items.map(i=>depth(path(i)))):0}</dd></div><div><dt>Balanced parents</dt><dd>{[...new Set(items.map(i=>i.ParentID))].filter(p=>items.filter(i=>i.ParentID===p).every(i=>cents(i.RatioPct)!==null)&&items.filter(i=>i.ParentID===p).reduce((n,i)=>n+(cents(i.RatioPct)||0),0)===10000).length} / {new Set(items.map(i=>i.ParentID)).size}</dd></div></dl><IconButton icon="close" label="Close grades" disabled={busy} onClick={close}/></div>
  {copyNotice&&<p role="status">{copyNotice}</p>}
  {copyOpen&&<CopyGrades excludeProduct={product?Number(product.ID):undefined} hasItems={!!items.length} onClose={()=>setCopyOpen(false)} onCopy={(next,source)=>{setItems(copy(next));setView("tree");setError("");setCopyNotice("Grades copied from "+source+". Review before saving.");}}/>}
  {tabs}<ErrorNote value={error}/>{!readonly&&<><ErrorNote value={gradeLookupError}/>{!lookupBusy&&!gradeLookupError&&!rawGrades.length&&<p>No active Raw Grades. Ask a RawMaterial user or Admin to maintain Raw Grade Master first.</p>}</>}

  {readonly&&<p className="grade-readonly-note">Use New version to revise this structure.</p>}

  {retryMaster&&<button type="button" disabled={masterRefresh} onClick={()=>void masterCreated(retryMaster.target,retryMaster.records)}>Retry refreshing choices</button>}
  {masterTarget&&<InlineMasterCreate entity={masterTarget.entity} initialValues={masterTarget.entity==='raw-grades'?{ParentGradeID:String(items.find(i=>path(i)===masterTarget.item.ParentID)?.RawGradeID??'')}:{GradeID:String(masterTarget.item.RawGradeID??'')}} onClose={()=>setMasterTarget(null)} onSaved={records=>void masterCreated(masterTarget,records)}/>}
  {view==='pricing'?<RawPricing items={items}/>:<GradeTree onGradeEdited={(item,record)=>void masterCreated({entity:'raw-grades',item},[record])} onMaterialEdited={(item,record)=>void masterCreated({entity:'raw-materials',item},[record])} onNewGrade={pageAccess(session,snapshotMode?'opportunities':'products',true)&&canCreateMaster(session,'raw-grades')?item=>setMasterTarget({entity:'raw-grades',item}):undefined} onNewMaterial={pageAccess(session,snapshotMode?'opportunities':'products',true)&&canCreateMaster(session,'raw-materials')?item=>setMasterTarget({entity:'raw-materials',item}):undefined} rawGrades={rawGrades} rawMaterials={rawMaterials} items={items} busy={busy} readonly={readonly} disabled={busy||uncertain||lookupBusy||masterRefresh||!!retryMaster||!!gradeLookupError||!!product&&!data} onAdd={add} onRemove={remove} onChange={(item,patch)=>setItems(all=>all.map(i=>path(i)===path(item)?{...i,...patch}:i))}/>}
  {view==='tree'&&!readonly&&<div className="actions"><button className="primary" type="button" disabled={busy||uncertain||lookupBusy||masterRefresh||!!retryMaster||!!gradeLookupError||!!product&&!data} onClick={review}>{product?'Review & save':'Use grades'}</button></div>}
  {confirm&&<Modal label="Confirm grade save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save grade version?</h2><p>{items.length} grades · {status}</p>{status==='Active'&&<p>The currently active version will become Inactive.</p>}<div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 </Modal>
}
