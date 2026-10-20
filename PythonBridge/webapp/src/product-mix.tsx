import {GradeTree} from './grade-tree';
import {decimalDisplay} from './number-format';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ApiError,call,type Row} from './api';
import {Badge,ErrorNote,Modal} from './ui';
import {IconButton} from './icons';
import {ProductGrades} from './product-grades';
type Version={ID:number;Version:number;Status:string;RowVersion:string};
type Line={ProductID:string;UnitQuantity:string};
type MixData={product:Row;versions:Version[];items:Row[];choices:Row[]};
export function ProductStructure({product,onClose,onSaved}:{product:Row;onClose:()=>void;onSaved:()=>void}){
 const [mix,setMix]=useState(!!product.IsMix);
 function switchView(next:boolean){if(next===mix)return;if(window.dispatchEvent(new Event('bridge:navigate',{cancelable:true})))setMix(next)}
 const tabs=product.IsMix?<div className="grade-view-switch" role="group" aria-label="Product structure view"><button aria-pressed={!mix} onClick={()=>switchView(false)}>Grade</button><button aria-pressed={mix} onClick={()=>switchView(true)}>Product Mix</button></div>:undefined;
 return mix?<ProductMix product={product} tabs={tabs} onClose={onClose} onSaved={onSaved}/>:product.IsMix?<MixChildGrades product={product} tabs={tabs} onClose={onClose}/>:<ProductGrades product={product} onClose={onClose} onSaved={onSaved}/>;
}

type ChildGradeData={versions:{ID:number;Version:number;Status:string}[];items:Row[]};
function MixChildGrades({product,tabs,onClose}:{product:Row;tabs:ReactNode;onClose:()=>void}){
 const [data,setData]=useState<ChildGradeData|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setBusy(true);setError('');
 call<ChildGradeData>('/api/workbench/products/'+product.ID+'/mix/grades').then(x=>{if(active){setData(x);setSelected(old=>x.versions.some(v=>String(v.ID)===old)?old:String((x.versions.find(v=>v.Status==='Active')||x.versions[0])?.ID||''))}}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false};
 },[product.ID,revision]);
 const rows=data?.items.filter(i=>String(i.MixVersionID)===selected)||[],children=[...new Set(rows.map(i=>Number(i.ProductID)))];
 return <Modal label="Product grades" className="dialog grade-dialog" onClose={onClose}>
  <div className="customer-editor-heading"><div><h2>Child Product grades</h2><p>{String(product.ProductCode)} · {String(product.ProductName)}</p></div><IconButton icon="close" label="Close child grades" onClick={onClose}/></div>
  {tabs}<ErrorNote value={error}/>
  <div className="grade-controls"><div className="grade-version-bar"><label>Product Mix version<select aria-label="Product Mix version" value={selected} disabled={busy||!data?.versions.length} onChange={e=>setSelected(e.target.value)}>{!data?.versions.length&&<option value="">No saved versions</option>}{data?.versions.map(v=><option value={v.ID} key={v.ID}>Version {v.Version} · {v.Status}</option>)}</select></label><IconButton icon="refresh" label="Refresh child grades" disabled={busy} onClick={()=>setRevision(n=>n+1)}/></div><Badge value="Read only"/></div>
  <p className="grade-readonly-note">Current active grades of the saved mix's child Products. Maintain grades in each child Product, not on this mix.</p>
  {busy?<p>Loading child grades…</p>:!error&&!children.length?<p>No child Products in this saved mix version.</p>:!error&&<div className="grade-groups">{children.map(id=>{
   const grades=rows.filter(r=>Number(r.ProductID)===id),first=grades[0];
   return <section className="panel grade-group" key={id} aria-label={'Child grades '+first.ProductCode}>
    <header className="grade-group-heading"><h3>{String(first.ProductCode)} · {String(first.ProductName)}</h3><span>Quantity {String(first.UnitQuantity)}</span>{first.GradeVersion!=null&&<Badge value={'Grade version '+first.GradeVersion+' · Active'}/>}</header>
    {first.GradeVersion==null?<p className="empty">No active grade version for this child Product.</p>:<GradeTree items={grades.map(g=>({ParentID:String(g.ParentID),ID:Number(g.ID),Grade:String(g.Grade??''),RatioPct:String(g.RatioPct??'')}))} busy={false} readonly disabled onAdd={()=>{}} onRemove={()=>{}} onChange={()=>{}}/>}
   </section>;
  })}</div>}

 </Modal>;
}

export function ProductMix({product,tabs,onClose,onSaved}:{product:Row;tabs?:ReactNode;onClose:()=>void;onSaved:()=>void}){
 const [data,setData]=useState<MixData|null>(null),[version,setVersion]=useState<Version|null>(null),[lines,setLines]=useState<Line[]>([]),[status,setStatus]=useState('Draft');
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[uncertain,setUncertain]=useState(false);
 const baseline=useRef(''),lock=useRef(false),dirty=baseline.current!==JSON.stringify({lines,status}),readonly=!!version&&version.Status!=='Draft';
 const child=(id:string)=>data?.choices.find(p=>String(p.ID)===id)||data?.items.find(p=>String(p.ProductID)===id);
 const total=lines.reduce((n,l)=>n+Number(child(l.ProductID)?.WeightGrams||0)*Number(l.UnitQuantity||0),0);
 function select(v:Version|null,all:MixData){
  const next=v?all.items.filter(i=>i.VersionID===v.ID).map(i=>({ProductID:String(i.ProductID),UnitQuantity:String(i.UnitQuantity)})):[];
  const st=v?.Status==='Active'?'Active':'Draft';setVersion(v);setLines(next);setStatus(st);setError('');setUncertain(false);baseline.current=JSON.stringify({lines:next,status:st});
 }
 async function load(id?:number){setBusy(true);setError('');try{const all=await call<MixData>('/api/workbench/products/'+product.ID+'/mix');setData(all);select(all.versions.find(v=>v.ID===id)||all.versions.find(v=>v.Status==='Active')||all.versions[0]||null,all)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{void load()},[product.ID]);
 useEffect(()=>{const nav=(e:Event)=>{if(busy||(dirty&&!window.confirm('Discard unsaved mix changes?')))e.preventDefault()};const unload=(e:BeforeUnloadEvent)=>{if(dirty||busy){e.preventDefault();e.returnValue=''}};window.addEventListener('bridge:navigate',nav);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('bridge:navigate',nav);window.removeEventListener('beforeunload',unload)}},[dirty,busy]);
 function close(){if(!busy&&(!dirty||window.confirm('Discard unsaved mix changes?')))onClose()}
 function change(index:number,key:keyof Line,value:string){setLines(xs=>xs.map((x,i)=>i===index?{...x,[key]:value}:x))}
 function review(){
  if(!lines.length){setError('Add at least one child Product.');return}
  if(lines.some(l=>!data?.choices.some(p=>String(p.ID)===l.ProductID))){setError('Choose active normal Products belonging to this Customer.');return}
  if(new Set(lines.map(l=>l.ProductID)).size!==lines.length){setError('Each child Product can appear only once.');return}
  if(lines.some(l=>!/^\d{1,8}(\.\d{1,4})?$/.test(l.UnitQuantity)||Number(l.UnitQuantity)<=0)){setError('Use positive unit quantities with up to 4 decimal places.');return}
  if(!Number.isFinite(total)||total<0.005||total>99999999.99){setError('Calculated net weight is outside the supported range.');return}
  setError('');setConfirm(true);
 }
 async function save(){
  if(lock.current||!data||uncertain)return;lock.current=true;setBusy(true);
  try{const result=await call<{ID:number}>('/api/workbench/products/'+product.ID+'/mix',{VersionID:version?.ID??null,RowVersion:version?.RowVersion??null,ProductRowVersion:data.product.RowVersion,Status:status,items:lines.map(l=>({ProductID:Number(l.ProductID),UnitQuantity:l.UnitQuantity,RowVersion:data.choices.find(p=>String(p.ID)===l.ProductID)!.RowVersion}))});onSaved();await load(result.ID)}
  catch(e){if(e instanceof ApiError&&(e.status===0||e.status>=500)){setUncertain(true);setError('Save outcome unknown. Reload before retrying.')}else setError((e as Error).message)}
  finally{lock.current=false;setBusy(false);setConfirm(false)}
 }
 return <Modal label="Product Mix" className="dialog grade-dialog" onClose={close}>
  <div className="customer-editor-heading"><div><h2>Product structure</h2><p>{String(data?.product.ProductCode??product.ProductCode??'')} · {String(data?.product.ProductName??product.ProductName)}</p></div><IconButton icon="close" label="Close mix" disabled={busy} onClick={close}/></div>
  {tabs}<ErrorNote value={error}/>
  <div className="grade-controls"><div className="grade-version-bar">
   <label>Version<select aria-label="Mix version" value={version?.ID||''} disabled={busy||!data} onChange={e=>{if(dirty&&!window.confirm('Discard unsaved mix changes?'))return;select(data!.versions.find(v=>String(v.ID)===e.target.value)||null,data!)}}><option value="">New version</option>{data?.versions.map(v=><option key={v.ID} value={v.ID}>Version {v.Version} · {v.Status}</option>)}</select></label>
   <button disabled={busy||!data||uncertain} onClick={()=>{if(dirty&&!window.confirm('Copy unsaved mix into a new version?'))return;setVersion(null);setStatus('Draft');baseline.current=JSON.stringify({lines:[],status:'Draft'})}}>New version</button>
   <IconButton icon="refresh" label="Reload mix" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Discard unsaved mix changes?'))void load(version?.ID)}}/>
   <label>Status{readonly?<Badge value={version!.Status}/>:<select aria-label="Mix status" disabled={busy||uncertain} value={status} onChange={e=>setStatus(e.target.value)}><option>Draft</option><option>Active</option></select>}</label>
  </div><dl className="grade-summary"><div><dt>Child Products</dt><dd>{lines.length}</dd></div><div><dt>Calculated net weight (g)</dt><dd>{Number.isFinite(total)?decimalDisplay(total,3):'—'}</dd></div></dl></div>
  <p className="grade-readonly-note">{readonly?'Use New version to revise this mix.':'One level · Same Customer · Net weight = sum of child weight × quantity.'} Draft versions do not change the Product weight.</p>
  <section className="panel"><div className="table-wrap"><table className="mix-table"><thead><tr><th>Child Product</th><th>Net weight (g)</th><th>Unit quantity</th><th>Total weight (g)</th><th>{!readonly&&<IconButton icon="plus" label="Add mix item" disabled={busy||uncertain||!data||lines.length>=500} onClick={()=>setLines(xs=>[...xs,{ProductID:'',UnitQuantity:'1'}])}/>}</th></tr></thead><tbody>
  {lines.map((l,i)=><tr key={i}><td>{readonly?<span>{String(child(l.ProductID)?.ProductCode||l.ProductID)} · {String(child(l.ProductID)?.ProductName||'')}</span>:<select aria-label={'Child Product '+(i+1)} disabled={busy||uncertain} value={l.ProductID} onChange={e=>change(i,'ProductID',e.target.value)}><option value="">Choose Product</option>{l.ProductID&&!data?.choices.some(p=>String(p.ID)===l.ProductID)&&<option value={l.ProductID}>{String(child(l.ProductID)?.ProductCode||l.ProductID)} (unavailable)</option>}{data?.choices.map(p=><option value={String(p.ID)} key={String(p.ID)} disabled={lines.some((x,j)=>i!==j&&x.ProductID===String(p.ID))}>{p.ProductCode} · {p.ProductName}</option>)}</select>}</td><td>{decimalDisplay(child(l.ProductID)?.WeightGrams,3)??'—'}</td><td><input aria-label={'Unit quantity '+(i+1)} readOnly={readonly} disabled={busy||uncertain} inputMode="decimal" value={l.UnitQuantity} onChange={e=>change(i,'UnitQuantity',e.target.value)}/></td><td>{decimalDisplay(Number(child(l.ProductID)?.WeightGrams||0)*Number(l.UnitQuantity||0),3)}</td><td>{!readonly&&<IconButton icon="close" label={'Remove mix item '+(i+1)} disabled={busy||uncertain} onClick={()=>setLines(xs=>xs.filter((_,j)=>j!==i))}/>}</td></tr>)}
  {!lines.length&&<tr><td colSpan={5} className="empty">{busy?'Loading…':'Add child Products to configure this mix.'}</td></tr>}
  </tbody></table></div></section>
  {!readonly&&<div className="actions"><button className="primary" disabled={busy||uncertain||!data} onClick={review}>Review & save</button></div>}
  {confirm&&<Modal label="Confirm mix save" onClose={()=>{if(!busy)setConfirm(false)}}><h2>Save Product Mix?</h2><p>{lines.length} child Products · {status} · {decimalDisplay(total,3)} g</p>{status==='Active'&&<p>The previous active version will become Inactive and the Product net weight will be recalculated.</p>}<div className="actions"><button disabled={busy} onClick={()=>setConfirm(false)}>Back</button><button className="primary" disabled={busy} onClick={save}>Confirm save</button></div></Modal>}
 </Modal>;
}
